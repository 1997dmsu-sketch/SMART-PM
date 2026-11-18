/**
 * HK-AI-07D G3「冻结矩阵验证」P/S/R/T/N 五系列（52 个 ID）。
 *
 * 硬边界：
 *  - 被测模块与网络 guard 全部来自 ./face-g3-testkit.mjs（顶层不允许静态 import 被测模块）；
 *  - 每个失败用例经 expectError(store, action, code, status)：内含 code+status 双断言、
 *    全库 structuredClone 内容级零写、Provider/网络 0；
 *  - 成功用例用 assertSuccessWriteSet / assertReceiptShape + 显式字段断言；
 *  - 不启动 HTTP、不监听端口、不发真实网络请求。
 *
 * 子场景用 t.test 展开，父测试名以 ID 开头，便于冻结矩阵核对。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  setupG3, expectError, assertSuccessWriteSet, assertReceiptShape,
  assertNoNetworkViolation, getViolations, resetRuntimeViolations,
  ORG, ORG_OTHER, MEMBERSHIP, ACTOR, ACTOR_B, JOB, JOB_REV, NOW, RETRY_PERMISSION,
  K2_ENV, K2_ENV_B,
  JOBS, DOMAINS, AUDIT_COLLECTION,
  makeEnrollJob, makeRevokeJob, makeDispatchSnapshot,
  find, count, removeRecord,
  independentOpKey, independentAuditId,
  StrictRetryService,
} from "./face-g3-testkit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RETRY_SRC_PATH = join(here, "..", "lib", "face-service", "retry.mjs");

/**
 * 归一化错误断言：复用 expectError（code+status+零写+网络 0），
 * 额外捕获异常并断言消息不泄露 validator 内部码/短语。
 */
async function expectNormalized(store, action, code, status, forbiddenTokens = []) {
  let captured = null;
  await expectError(store, async () => {
    try {
      await action();
    } catch (err) {
      captured = err;
      throw err;
    }
  }, code, status);
  assert.ok(captured instanceof Error, "必须捕获到异常");
  const message = String(captured.message);
  for (const token of forbiddenTokens)
    assert.ok(!message.includes(token), `错误消息不得泄露内部码/短语：${token}`);
  return captured;
}

// ===========================================================================
// P 系列 P01–P13（权限 / 组织 / 主体门禁）
// ===========================================================================

test("P01：默认 setupG3 成功——回执五字段 + 写集 J+L+O+D+A（D=0）", async (t) => {
  const h = await setupG3(t);
  const domainsBefore = count(h.store, DOMAINS);
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  assertReceiptShape(receipt, {
    jobId: JOB, revision: JOB_REV + 1, attempts: 2, nextAttemptAt: NOW - 5_000,
  });
  assertSuccessWriteSet(h, { key });
  assert.equal(count(h.store, DOMAINS), domainsBefore, "默认已预建 domain，本事务 domain 零写 D=0");
});

test("P02：permissions=[audit.read, operation.reconcile] 缺 retry → FORBIDDEN/403", async (t) => {
  const h = await setupG3(t, {
    memberOverrides: { permissions: ["device.audit.read", "device.operation.reconcile"] },
  });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "FORBIDDEN", 403);
});

test("P03：仅 device.audit.read → FORBIDDEN/403", async (t) => {
  const h = await setupG3(t, { memberOverrides: { permissions: ["device.audit.read"] } });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "FORBIDDEN", 403);
});

test("P04：仅 device.operation.reconcile → FORBIDDEN/403", async (t) => {
  const h = await setupG3(t, { memberOverrides: { permissions: ["device.operation.reconcile"] } });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "FORBIDDEN", 403);
});

test("P05：role=admin 但 permissions=[] → FORBIDDEN/403", async (t) => {
  const h = await setupG3(t, { memberOverrides: { role: "admin", permissions: [] } });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "FORBIDDEN", 403);
});

test("P06：member status=suspended → FORBIDDEN/403", async (t) => {
  const h = await setupG3(t, { memberOverrides: { status: "suspended" } });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "FORBIDDEN", 403);
});

test("P07：org status=suspended → FORBIDDEN/403", async (t) => {
  const h = await setupG3(t, { orgOverrides: { status: "suspended" } });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "FORBIDDEN", 403);
});

test("P08：member orgId=ORG_OTHER → NOT_FOUND/404（与跨组织同态）", async (t) => {
  const h = await setupG3(t, { memberOverrides: { orgId: ORG_OTHER } });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "NOT_FOUND", 404);
});

test("P09：job orgId=ORG_OTHER → NOT_FOUND/404（不得 403）", async (t) => {
  const h = await setupG3(t, { job: makeEnrollJob({ orgId: ORG_OTHER }) });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "NOT_FOUND", 404);
});

test("P10：预读后提交前撤权（事务内权威复核）→ FORBIDDEN/403", async (t) => {
  const h = await setupG3(t);
  // 真实 store.data 中成员无 retry 权限；但代理 store.get 让事务外预读拿到"带权限克隆"。
  const member = find(h.store, "org_memberships", MEMBERSHIP);
  member.permissions = [];
  const originalGet = h.store.get;
  const realGet = originalGet.bind(h.store);
  h.store.get = async (name, id, orgIdArg) => {
    const row = await realGet(name, id, orgIdArg);
    if (name === "org_memberships" && id === MEMBERSHIP && row)
      return { ...row, permissions: [RETRY_PERMISSION, "device.audit.read"] };
    return row;
  };
  try {
    // transact 直接从 store.data 读快照，不走 store.get → 事务内 #authorize 见真实空权限。
    await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "FORBIDDEN", 403);
  } finally {
    h.store.get = originalGet;
  }
});

test("P11：成功后再撤权限同键重放 → FORBIDDEN/403 且不命中旧回执", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  const first = await h.retry(JOB, JOB_REV, key);
  assertReceiptShape(first);
  // 仅断言 receipt 的成功路径也必须显式证明零网络/Provider 违规，
  // 不能依赖后续失败分支 expectError 的 netBefore（它只查「无新增」）。
  assertNoNetworkViolation();
  const member = find(h.store, "org_memberships", MEMBERSHIP);
  member.permissions = [];
  await expectError(h.store, () => h.retry(JOB, JOB_REV, key), "FORBIDDEN", 403);
});

test("P12：member principalId 不符 → FORBIDDEN/403", async (t) => {
  const h = await setupG3(t, { memberOverrides: { principalId: ACTOR_B } });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "FORBIDDEN", 403);
});

test("P13：actorType=system 与缺失 actorType 两子场景 → FORBIDDEN/403", async (t) => {
  await t.test("actorType=system", async (st) => {
    const h = await setupG3(st, { actorType: "system" });
    await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "FORBIDDEN", 403);
  });
  await t.test("actorType 缺失", async (st) => {
    const h = await setupG3(st);
    const serviceNoType = new StrictRetryService({
      store: h.store, orgId: ORG,
      actor: { actorId: ACTOR, membershipId: MEMBERSHIP }, // 故意不带 actorType
      now: () => NOW, env: h.env,
    });
    await expectError(h.store,
      () => serviceNoType.retry(JOB, { expectedJobRevision: JOB_REV }, { idempotencyKey: h.nextKey() }),
      "FORBIDDEN", 403);
  });
});

// ===========================================================================
// S 系列 S01–S16（状态 / 形状 / validator 门禁）
// ===========================================================================

test("S01：enroll 成功写集字段保留（result/nextAttemptAt 原值）", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  const before = find(h.store, JOBS, JOB);
  const resultBefore = structuredClone(before.result);
  const receipt = await h.retry(JOB, JOB_REV, key);
  assertReceiptShape(receipt);
  assertSuccessWriteSet(h, { key });
  const job = find(h.store, JOBS, JOB);
  assert.deepEqual(job.result, resultBefore, "enroll 保留原 result 内容");
  assert.equal(job.nextAttemptAt, NOW - 5_000, "enroll 保留 nextAttemptAt 原值");
});

test("S02：revoke 成功写集 nextAttemptAt=null / result=null", async (t) => {
  const h = await setupG3(t, { job: makeRevokeJob() });
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  assertReceiptShape(receipt, { attempts: 1, nextAttemptAt: null });
  assertSuccessWriteSet(h, { key, enroll: false, expectedAttempts: 1, expectedNextAttemptAt: null });
  const job = find(h.store, JOBS, JOB);
  assert.equal(job.nextAttemptAt, null);
  assert.equal(job.result, null);
});

test("S03：state=queued → INVALID_STATE/409", async (t) => {
  const h = await setupG3(t, { job: makeEnrollJob({ state: "queued", nextAttemptAt: null, result: null }) });
  await expectError(h.store, () => h.retry(), "INVALID_STATE", 409);
});

test("S04：state=sending → INVALID_STATE/409（lease 三字段零改）", async (t) => {
  const h = await setupG3(t, {
    job: makeEnrollJob({
      state: "sending", leaseOwner: "owner", leaseExpiresAt: NOW + 9_000,
      dispatchAuthorizedAt: NOW - 1, nextAttemptAt: null, result: null,
    }),
  });
  const before = structuredClone(find(h.store, JOBS, JOB));
  await expectError(h.store, () => h.retry(), "INVALID_STATE", 409);
  const after = find(h.store, JOBS, JOB);
  for (const field of ["leaseOwner", "leaseExpiresAt", "dispatchAuthorizedAt"])
    assert.deepEqual(after[field], before[field], `${field} 必须零改`);
});

test("S05：state=awaiting_result → INVALID_JOB/409", async (t) => {
  const h = await setupG3(t, {
    job: makeEnrollJob({
      state: "awaiting_result", nextAttemptAt: null,
      result: { attempt: 2, outcome: "awaiting_result", errorKind: null, reasonCode: null, finishedAt: NOW - 10_000 },
    }),
  });
  await expectError(h.store, () => h.retry(), "INVALID_JOB", 409);
});

test("S06：state=succeeded → INVALID_STATE/409", async (t) => {
  const h = await setupG3(t, {
    job: makeEnrollJob({
      state: "succeeded", nextAttemptAt: null,
      result: { attempt: 2, outcome: "succeeded", errorKind: null, reasonCode: null, finishedAt: NOW - 10_000 },
    }),
  });
  await expectError(h.store, () => h.retry(), "INVALID_STATE", 409);
});

test("S07：state=terminal_failed(RETRY_EXHAUSTED) → INVALID_STATE/409", async (t) => {
  const h = await setupG3(t, {
    job: makeEnrollJob({
      state: "terminal_failed", nextAttemptAt: null,
      result: { attempt: 2, outcome: "terminal_failed", errorKind: "RETRY_EXHAUSTED", reasonCode: null, finishedAt: NOW - 10_000 },
    }),
  });
  await expectError(h.store, () => h.retry(), "INVALID_STATE", 409);
});

test("S08：state=cancelled 两形状（enroll / revoke）→ INVALID_STATE/409", async (t) => {
  await t.test("cancelled(enroll)", async (st) => {
    const h = await setupG3(st, { job: makeEnrollJob({ state: "cancelled", nextAttemptAt: null, result: null }) });
    await expectError(h.store, () => h.retry(), "INVALID_STATE", 409);
  });
  await t.test("cancelled(revoke, finalize 形状)", async (st) => {
    const h = await setupG3(st, {
      job: makeRevokeJob({ state: "cancelled", nextAttemptAt: null, result: null,
        cleanupPhase: "finalize", providerOutcome: "confirmed_removed", finalizeAttempts: 1 }),
    });
    await expectError(h.store, () => h.retry(), "INVALID_STATE", 409);
  });
});

test("S09：revoke cleanupPhase=finalize → INVALID_STATE/409（用户裁定2：只验 finalize 被拒，不要求 E09）", async (t) => {
  const h = await setupG3(t, {
    job: makeRevokeJob({ cleanupPhase: "finalize", providerOutcome: "confirmed_removed", finalizeAttempts: 1 }),
  });
  await expectError(h.store, () => h.retry(), "INVALID_STATE", 409);
});

test("S10：attempts=4 → INVALID_JOB/409", async (t) => {
  const h = await setupG3(t, {
    job: makeEnrollJob({ attempts: 4, leaseGeneration: 4,
      result: { attempt: 4, outcome: "retryable_failed", errorKind: "RETRYABLE", reasonCode: "PRIOR_RETRYABLE", finishedAt: NOW - 10_000 } }),
  });
  await expectError(h.store, () => h.retry(), "INVALID_JOB", 409);
});

test("S11：attempts=0 → INVALID_JOB/409", async (t) => {
  const h = await setupG3(t, {
    job: makeEnrollJob({ attempts: 0, leaseGeneration: 0,
      result: { attempt: 0, outcome: "retryable_failed", errorKind: "RETRYABLE", reasonCode: "PRIOR_RETRYABLE", finishedAt: NOW - 10_000 } }),
  });
  await expectError(h.store, () => h.retry(), "INVALID_JOB", 409);
});

test("S12：errorKind=UNKNOWN_RESULT → INVALID_JOB/409", async (t) => {
  const h = await setupG3(t, {
    job: makeEnrollJob({ result: { attempt: 2, outcome: "retryable_failed", errorKind: "UNKNOWN_RESULT", reasonCode: null, finishedAt: NOW - 10_000 } }),
  });
  await expectError(h.store, () => h.retry(), "INVALID_JOB", 409);
});

test("S13：errorKind∈{LOCAL_FINALIZE,PRE_SEND_BLOCKED,TERMINAL} → INVALID_JOB/409", async (t) => {
  for (const errorKind of ["LOCAL_FINALIZE", "PRE_SEND_BLOCKED", "TERMINAL"]) {
    await t.test(errorKind, async (st) => {
      const h = await setupG3(st, {
        job: makeEnrollJob({ result: { attempt: 2, outcome: "retryable_failed", errorKind, reasonCode: null, finishedAt: NOW - 10_000 } }),
      });
      await expectError(h.store, () => h.retry(), "INVALID_JOB", 409);
    });
  }
});

test("S14：result 五种损坏 → INVALID_JOB/409，消息不泄露内部码", async (t) => {
  const good = () => ({ attempt: 2, outcome: "retryable_failed", errorKind: "RETRYABLE", reasonCode: "PRIOR_RETRYABLE", finishedAt: NOW - 10_000 });
  const variants = [
    ["null", () => null],
    ["数组", () => []],
    ["多字段", () => ({ ...good(), extra: 1 })],
    ["少字段", () => { const r = good(); delete r.reasonCode; return r; }],
    ["outcome 非 retryable_failed", () => ({ ...good(), outcome: "succeeded" })],
  ];
  const forbidden = ["任务结果结构非法", "CONFLICT", "INVALID_JOB"];
  for (const [name, make] of variants) {
    await t.test(name, async (st) => {
      const h = await setupG3(st, { job: makeEnrollJob({ result: make() }) });
      await expectNormalized(h.store, () => h.retry(), "INVALID_JOB", 409, forbidden);
    });
  }
});

test("S15：action 非法三子场景 → INVALID_JOB/409", async (t) => {
  const variants = [
    ["action=bogus", "bogus"],
    ["action=ENROLL", "ENROLL"],
    ["action 缺失", undefined],
  ];
  for (const [name, action] of variants) {
    await t.test(name, async (st) => {
      const job = makeEnrollJob();
      if (action === undefined) delete job.action;
      else job.action = action;
      const h = await setupG3(st, { job });
      await expectError(h.store, () => h.retry(), "INVALID_JOB", 409);
    });
  }
});

test("S16：validator 结构码四子场景归一化 → INVALID_JOB/409，消息不泄露内部码", async (t) => {
  const forbidden = [
    "DISPATCH_SNAPSHOT_REQUIRED", "CLEANUP_SNAPSHOT_REQUIRED", "PARAM_ERROR",
    "DEVICE_CLAIM", "GRANT_SLOT", "旧任务缺少派发快照", "派发快照结构非法",
    "派发快照缺少", "任务不属于 H3 合成派发",
  ];
  const variants = [
    ["缺派发快照", () => makeEnrollJob({ dispatchSnapshot: undefined })],
    ["派发快照缺版本见证", () => {
      const snap = makeDispatchSnapshot();
      snap.versions = snap.versions.filter((v) => v.collection !== "access_devices");
      return makeEnrollJob({ dispatchSnapshot: snap });
    }],
    ["派发快照 schemaVersion 非法", () => {
      const snap = makeDispatchSnapshot({ schemaVersion: 99 });
      return makeEnrollJob({ dispatchSnapshot: snap });
    }],
    ["provider 非 mock", () => makeEnrollJob({ provider: "real" })],
  ];
  for (const [name, make] of variants) {
    await t.test(name, async (st) => {
      const h = await setupG3(st, { job: make() });
      await expectNormalized(h.store, () => h.retry(), "INVALID_JOB", 409, forbidden);
    });
  }
});

// ===========================================================================
// R 系列 R01–R09（expectedJobRevision / revision 门禁）
// ===========================================================================

test("R01：expected=4 成功，revision=5", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  const receipt = await h.retry(JOB, 4, key);
  assertReceiptShape(receipt, { revision: 5 });
  assertSuccessWriteSet(h, { key, revision: 5 });
});

test("R02：expected 落后（job.revision=5 传 4）→ REVISION_CONFLICT/409", async (t) => {
  const h = await setupG3(t, { job: makeEnrollJob({ revision: 5 }) });
  await expectError(h.store, () => h.retry(JOB, 4, h.nextKey()), "REVISION_CONFLICT", 409);
});

test("R03：expected 超前（传 5，job.revision=4）→ REVISION_CONFLICT/409", async (t) => {
  const h = await setupG3(t);
  await expectError(h.store, () => h.retry(JOB, 5, h.nextKey()), "REVISION_CONFLICT", 409);
});

test("R04：expected 缺失 → PARAM_ERROR/400", async (t) => {
  const h = await setupG3(t);
  await expectError(h.store,
    () => h.service.retry(JOB, {}, { idempotencyKey: h.nextKey() }), "PARAM_ERROR", 400);
});

test("R05：expected∈{0,-1,1.5,\"7\",NaN,Infinity,2^53} → PARAM_ERROR/400", async (t) => {
  const values = [0, -1, 1.5, "7", NaN, Infinity, 2 ** 53];
  for (const value of values) {
    await t.test(String(value), async (st) => {
      const h = await setupG3(st);
      await expectError(h.store,
        () => h.service.retry(JOB, { expectedJobRevision: value }, { idempotencyKey: h.nextKey() }),
        "PARAM_ERROR", 400);
    });
  }
});

test("R06：旧名 expectedRevision → PARAM_ERROR/400", async (t) => {
  const h = await setupG3(t);
  await expectError(h.store,
    () => h.service.retry(JOB, { expectedRevision: JOB_REV }, { idempotencyKey: h.nextKey() }),
    "PARAM_ERROR", 400);
});

test("R07：expected=MAX_SAFE_INTEGER-2（job.revision 同值）→ INVALID_JOB/409", async (t) => {
  const big = Number.MAX_SAFE_INTEGER - 2;
  const h = await setupG3(t, { job: makeEnrollJob({ revision: big }) });
  await expectError(h.store, () => h.retry(JOB, big, h.nextKey()), "INVALID_JOB", 409);
});

test("R08：expected=MAX_SAFE_INTEGER → INVALID_JOB/409", async (t) => {
  const h = await setupG3(t, { job: makeEnrollJob({ revision: Number.MAX_SAFE_INTEGER }) });
  await expectError(h.store, () => h.retry(JOB, Number.MAX_SAFE_INTEGER, h.nextKey()), "INVALID_JOB", 409);
});

test("R09：body 额外字段 → PARAM_ERROR/400", async (t) => {
  const h = await setupG3(t);
  await expectError(h.store,
    () => h.service.retry(JOB, { expectedJobRevision: JOB_REV, extra: 1 }, { idempotencyKey: h.nextKey() }),
    "PARAM_ERROR", 400);
});

// ===========================================================================
// T 系列 T01–T06（时间门禁 / DTO 白名单 / 源码审计）
// ===========================================================================

test("T01：now===nextAttemptAt 算到期，成功", async (t) => {
  const h = await setupG3(t, { job: makeEnrollJob({ nextAttemptAt: NOW }), now: NOW });
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  assertReceiptShape(receipt, { nextAttemptAt: NOW });
  assertSuccessWriteSet(h, { key, expectedNextAttemptAt: NOW });
});

test("T02：now===nextAttemptAt-1 → RETRY_NOT_DUE/409", async (t) => {
  const h = await setupG3(t, { job: makeEnrollJob({ nextAttemptAt: NOW + 1 }), now: NOW });
  await expectError(h.store, () => h.retry(), "RETRY_NOT_DUE", 409);
});

test("T03：enroll / revoke 成功边界字段断言", async (t) => {
  await t.test("enroll 保留", async (st) => {
    const h = await setupG3(st);
    const key = h.nextKey();
    const receipt = await h.retry(JOB, JOB_REV, key);
    assertReceiptShape(receipt, { attempts: 2, nextAttemptAt: NOW - 5_000 });
    assertSuccessWriteSet(h, { key, expectedAttempts: 2, expectedNextAttemptAt: NOW - 5_000 });
  });
  await t.test("revoke 清空", async (st) => {
    const h = await setupG3(st, { job: makeRevokeJob() });
    const key = h.nextKey();
    const receipt = await h.retry(JOB, JOB_REV, key);
    assertReceiptShape(receipt, { attempts: 1, nextAttemptAt: null });
    assertSuccessWriteSet(h, { key, enroll: false, expectedAttempts: 1, expectedNextAttemptAt: null });
  });
});

test("T04：body 传 now/nextAttemptAt/delay/backoff/force → PARAM_ERROR/400", async (t) => {
  for (const field of ["now", "nextAttemptAt", "delay", "backoff", "force"]) {
    await t.test(`body ${field}`, async (st) => {
      const h = await setupG3(st);
      const body = { expectedJobRevision: JOB_REV, [field]: 1 };
      await expectError(h.store,
        () => h.service.retry(JOB, body, { idempotencyKey: h.nextKey() }), "PARAM_ERROR", 400);
    });
  }
});

test("T05：now=1.5 / now=-1 / result.finishedAt>now → ADAPTER_UNAVAILABLE/503", async (t) => {
  await t.test("now=1.5", async (st) => {
    const h = await setupG3(st, { now: 1.5 });
    await expectError(h.store, () => h.retry(), "ADAPTER_UNAVAILABLE", 503);
  });
  await t.test("now=-1", async (st) => {
    const h = await setupG3(st, { now: -1 });
    await expectError(h.store, () => h.retry(), "ADAPTER_UNAVAILABLE", 503);
  });
  await t.test("finishedAt>now", async (st) => {
    const h = await setupG3(st, {
      job: makeEnrollJob({ result: { attempt: 2, outcome: "retryable_failed", errorKind: "RETRYABLE", reasonCode: "X", finishedAt: NOW + 10_000 } }),
      now: NOW,
    });
    await expectError(h.store, () => h.retry(), "ADAPTER_UNAVAILABLE", 503);
  });
});

test("T06：源码无 setTimeout/setInterval/Retry-After + 运行期零网络 + store 无后续写入", async (t) => {
  const src = await readFile(RETRY_SRC_PATH, "utf8");
  assert.doesNotMatch(src, /\bsetTimeout\b/, "retry.mjs 不得含 setTimeout");
  assert.doesNotMatch(src, /\bsetInterval\b/, "retry.mjs 不得含 setInterval");
  assert.doesNotMatch(src, /Retry-After/i, "retry.mjs 不得含 Retry-After");
  assert.doesNotMatch(src, /\bfetch\s*\(/, "retry.mjs 不得含 fetch 调用");
  assert.doesNotMatch(src, /\b(?:http|https|net)\.(?:request|get|createServer|connect)\s*\(/, "retry.mjs 不得含网络入口调用");

  resetRuntimeViolations();
  const h = await setupG3(t, { now: NOW });
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  assertReceiptShape(receipt, { nextAttemptAt: NOW - 5_000 });
  assert.deepEqual(getViolations().runtime, [], "运行期零网络/Provider 违规");
  assert.deepEqual(getViolations().loadTime, [], "运行期不得触碰 loadTimeViolations");

  const afterSuccess = structuredClone(h.store.data);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(structuredClone(h.store.data), afterSuccess, "成功后 store 无后续写入（无定时器补写）");
});

// ===========================================================================
// N 系列 N01–N08（失败零写汇总：每类一条代表性注入，code+status+Z+P0）
// ===========================================================================

test("N01：PARAM_ERROR/400 代表性失败零写", async (t) => {
  const h = await setupG3(t);
  await expectError(h.store, () => h.retry(JOB, 0, h.nextKey()), "PARAM_ERROR", 400);
});

test("N02：FORBIDDEN/403 代表性失败零写", async (t) => {
  const h = await setupG3(t, { memberOverrides: { permissions: ["device.audit.read"] } });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "FORBIDDEN", 403);
});

test("N03：NOT_FOUND/404 代表性失败零写", async (t) => {
  const h = await setupG3(t, { job: makeEnrollJob({ orgId: ORG_OTHER }) });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "NOT_FOUND", 404);
});

test("N04：INVALID_STATE/409 代表性失败零写", async (t) => {
  const h = await setupG3(t, { job: makeEnrollJob({ state: "queued", nextAttemptAt: null, result: null }) });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "INVALID_STATE", 409);
});

test("N05：REVISION_CONFLICT/409 代表性失败零写", async (t) => {
  const h = await setupG3(t);
  await expectError(h.store, () => h.retry(JOB, JOB_REV + 1, h.nextKey()), "REVISION_CONFLICT", 409);
});

test("N06：RETRY_NOT_DUE/409 代表性失败零写", async (t) => {
  const h = await setupG3(t, { job: makeEnrollJob({ nextAttemptAt: NOW + 100_000 }) });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "RETRY_NOT_DUE", 409);
});

test("N07：DOMAIN_MISMATCH/409 与 CONFLICT/409 子场景失败零写", async (t) => {
  await t.test("DOMAIN_MISMATCH/409（换钥同 realm）", async (st) => {
    const h = await setupG3(st);
    const serviceB = new StrictRetryService({
      store: h.store, orgId: ORG,
      actor: { actorId: ACTOR, membershipId: MEMBERSHIP, actorType: "user" },
      now: () => NOW, env: K2_ENV_B,
    });
    await expectError(h.store,
      () => serviceB.retry(JOB, { expectedJobRevision: JOB_REV }, { idempotencyKey: h.nextKey() }),
      "DOMAIN_MISMATCH", 409);
  });
  await t.test("CONFLICT/409（同键异摘要重放）", async (st) => {
    const h = await setupG3(st);
    const key = h.nextKey();
    await h.retry(JOB, JOB_REV, key);
    assertNoNetworkViolation(); // 首次成功 retry 也必须零网络/Provider 违规
    await expectError(h.store, () => h.retry(JOB, JOB_REV + 1, key), "CONFLICT", 409);
  });
});

test("N08：INVALID_JOB/409 与 CONFLICT/409 子场景失败零写", async (t) => {
  await t.test("INVALID_JOB/409（revision 溢出）", async (st) => {
    const h = await setupG3(st);
    await expectError(h.store, () => h.retry(JOB, Number.MAX_SAFE_INTEGER, h.nextKey()), "INVALID_JOB", 409);
  });
  await t.test("CONFLICT/409（audit 缺失的预占态）", async (st) => {
    const h = await setupG3(st);
    const key = h.nextKey();
    await h.retry(JOB, JOB_REV, key);
    assertNoNetworkViolation(); // 首次成功 retry 也必须零网络/Provider 违规
    // 预期 ID 一律由测试侧独立 oracle 计算，不得复用生产 operationKey/auditIdFor，
    // 否则生产 op: 前缀被改错时本用例仍全过（循环认证）。
    const expectedOpKey = independentOpKey({ env: h.env, idempotencyKey: key });
    removeRecord(h.store, AUDIT_COLLECTION, independentAuditId(expectedOpKey, { jobId: JOB }));
    await expectError(h.store, () => h.retry(JOB, JOB_REV, key), "CONFLICT", 409);
  });
});
