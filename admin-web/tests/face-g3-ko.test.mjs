/**
 * HK-AI-07D G3「冻结矩阵验证」K（幂等键 / K2 域）与 O（公开 DTO / 整体门禁）两个系列。
 *
 * 硬边界：
 *  - 只 import ./face-g3-testkit.mjs（网络 guard 必须先于被测模块加载），
 *    本文件【不】静态 import 任何被测模块，也不发网络/启动 HTTP。
 *  - 全部 fixture 由 testkit 合成，失败分支统一用 expectError（code+status 双断言 +
 *    全库零写 + Provider/网络 0）。
 *  - O10 用本文件内的动态 gate 判定：三子项全 true → PASS，任一 false → BLOCKED 并登记；
 *    不硬编码某一子项必须失败，故独立 Q8 清理 routes.mjs 描述行后同一用例自动转 PASS。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  setupG3, expectError, assertZeroWrite, assertSuccessWriteSet, assertReceiptShape,
  expectBlocked, getBlockedRecords, getViolations, assertSafeError, assertNoNetworkViolation,
  JOB, JOB_REV, NOW, AUDIT_COLLECTION, JOBS, LOGS, OP_KEYS, DOMAINS,
  ORG, ORG_OTHER, MEMBERSHIP, ACTOR,
  K2_ENV, K2_ENV_B,
  // ID 类预期值一律用测试侧独立 oracle（不复用生产 helper，防「改错生产前缀测试仍过」）。
  // opContextFor 仅在 K09/K10 取 domain head/version ID（非 opKey/auditId/logId）。
  opContextFor, digestOf,
  independentOpKey, independentAuditId, independentLogId,
  putRecord, removeRecord, find, count, semanticKeys,
  makeEnrollJob, makeRevokeJob, StrictRetryService,
  OPKEY_FIELDS, LOG_FIELDS,
} from "./face-g3-testkit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// 独立 oracle 重算 queued log ID（occurrence = expectedJobRevision + 1）。
const LOG_ID = independentLogId(JOB, "queued", JOB_REV + 1);
const RECEIPT_KEYS = ["attempts", "jobId", "nextAttemptAt", "revision", "state"];

const failureOf = async (action) => {
  let captured;
  await assert.rejects(action, (e) => { captured = e; return true; });
  return captured;
};

// ===========================================================================
// K 系列 K01–K16
// ===========================================================================

test("K01 缺 Idempotency-Key → PARAM_ERROR/400 且不建 op key", async (t) => {
  const h = await setupG3(t);
  const opBefore = count(h.store, OP_KEYS);
  await expectError(h.store,
    () => h.service.retry(JOB, { expectedJobRevision: JOB_REV }, {}),
    "PARAM_ERROR", 400);
  assert.equal(count(h.store, OP_KEYS), opBefore, "缺 key 不得建 op key");
  // headers 整体缺省同样失败关闭
  await expectError(h.store,
    () => h.service.retry(JOB, { expectedJobRevision: JOB_REV }),
    "PARAM_ERROR", 400);
  assert.equal(count(h.store, OP_KEYS), opBefore);
});

test("K02 Idempotency-Key 六类非法形状 → PARAM_ERROR/400", async (t) => {
  const cases = [
    ["15 位", "a".repeat(15)],
    ["129 位", "a".repeat(129)],
    ["空格", "g3 bad key 00000001"],
    ["斜杠", "g3/bad/key-00000001"],
    ["数组", ["g3-array-key-0000001"]],
    // 重复头在 HTTP 层被合并为逗号串，含非法字符，服务层必须失败关闭
    ["重复头", "g3-key-a-00000001, g3-key-b-00000002"],
  ];
  for (const [name, value] of cases) {
    await t.test(name, async (st) => {
      const h = await setupG3(st);
      const before = count(h.store, OP_KEYS);
      await expectError(h.store,
        () => h.service.retry(JOB, { expectedJobRevision: JOB_REV }, { idempotencyKey: value }),
        "PARAM_ERROR", 400);
      assert.equal(count(h.store, OP_KEYS), before, `${name} 不得建 op key`);
    });
  }
});

test("K03 合法首次 → op key 六字段/回执五字段/摘要绑定/原始 key 零落库/写集 J+L+O+A(D=0)", async (t) => {
  const h = await setupG3(t);
  assert.ok(count(h.store, DOMAINS) > 0, "前置：domain 已预建（D=0）");
  const domainsBefore = structuredClone(h.store.data[DOMAINS]);
  const auditsBefore = count(h.store, AUDIT_COLLECTION);
  const key = h.nextKey();

  const receipt = await h.retry(JOB, JOB_REV, key);
  assertReceiptShape(receipt);

  const op = find(h.store, OP_KEYS, independentOpKey({ env: h.env, idempotencyKey: key }));
  assert.ok(op, "op key 必须存在");
  assert.deepEqual(semanticKeys(op), [...OPKEY_FIELDS].sort(), "op key 精确六语义字段");
  assert.deepEqual(Object.keys(op.result).sort(), [...RECEIPT_KEYS].sort(), "result 精确五字段");
  assert.equal(op.requestDigest, digestOf({ jobId: JOB, expectedJobRevision: JOB_REV }),
    "requestDigest 仅绑定 jobId + expectedJobRevision");
  assert.ok(!JSON.stringify(h.store.data).includes(key), "原始 Idempotency-Key 零落库");

  assertSuccessWriteSet(h, { key });
  assert.deepEqual(h.store.data[DOMAINS], domainsBefore, "D=0：domain 零写");
  assert.equal(count(h.store, AUDIT_COLLECTION) - auditsBefore, 1, "只新增 1 条 audit");
});

test("K04 同键同摘要重放 → 原回执逐字段相等、audit 不新增、全库 Z", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  assertNoNetworkViolation(); // P1：成功路径一旦有被 guard 截获的网络调用即失败
  const auditsBefore = count(h.store, AUDIT_COLLECTION);
  const netBefore = getViolations().runtime.length;
  const before = structuredClone(h.store.data);

  const replay = await h.retry(JOB, JOB_REV, key);
  assert.deepEqual(replay, receipt, "合法重放回执逐字段相等");
  for (const field of RECEIPT_KEYS) assert.equal(replay[field], receipt[field]);
  assert.equal(count(h.store, AUDIT_COLLECTION), auditsBefore, "重放不得新增 audit");
  assertZeroWrite(h.store, before, "全库 Z");
  assert.equal(getViolations().runtime.length, netBefore, "重放零网络/Provider");
  assertNoNetworkViolation(); // 重放成功路径同样必须零网络违规
});

test("K05 同键改 expectedJobRevision → CONFLICT/409 且 op key 不变", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  await h.retry(JOB, JOB_REV, key);
  assertNoNetworkViolation();
  const opId = independentOpKey({ env: h.env, idempotencyKey: key });
  const opBefore = structuredClone(find(h.store, OP_KEYS, opId));

  await expectError(h.store, () => h.retry(JOB, JOB_REV + 1, key), "CONFLICT", 409);
  assert.deepEqual(find(h.store, OP_KEYS, opId), opBefore, "op key 内容不得被改写");
});

test("K06 同键改 jobId → CONFLICT/409", async (t) => {
  const otherJob = "job-g3-enroll-2";
  const h = await setupG3(t, { jobs: [makeEnrollJob(), makeEnrollJob({ _id: otherJob })] });
  const key = h.nextKey();
  await h.retry(JOB, JOB_REV, key);
  assertNoNetworkViolation();
  const opId = independentOpKey({ env: h.env, idempotencyKey: key });
  const opBefore = structuredClone(find(h.store, OP_KEYS, opId));

  await expectError(h.store, () => h.retry(otherJob, JOB_REV, key), "CONFLICT", 409);
  assert.deepEqual(find(h.store, OP_KEYS, opId), opBefore, "op key 内容不得被改写");
});

test("K07 同键重放但 job 已推进 sending/succeeded → 仍返回原快照、不读当前状态、Z", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  const netBefore = getViolations().runtime.length;
  assertNoNetworkViolation();

  for (const advanced of ["sending", "succeeded"]) {
    const job = find(h.store, JOBS, JOB);
    job.state = advanced;
    job.leaseOwner = advanced === "sending" ? "worker-g3" : null;
    const before = structuredClone(h.store.data);
    const replay = await h.retry(JOB, JOB_REV, key);
    assert.deepEqual(replay, receipt, `job=${advanced} 必须返回原五字段快照（不读当前状态）`);
    assertZeroWrite(h.store, before, `job=${advanced} 重放全库 Z`);
    assert.equal(getViolations().runtime.length, netBefore);
  }
});

test("K08 K2 配置非法（Base64/长度/版本/realm）→ NOT_CONFIGURED/503，权限预读须先通过", async (t) => {
  const cases = [
    ["Base64 非法", { OPERATION_KEY_HMAC_KEY_B64: "not-base64!!", OPERATION_KEY_VERSION: "1", OPERATION_KEY_REALM: "g3-realm" }],
    ["长度非法(16 字节)", { OPERATION_KEY_HMAC_KEY_B64: Buffer.alloc(16, 9).toString("base64"), OPERATION_KEY_VERSION: "1", OPERATION_KEY_REALM: "g3-realm" }],
    ["版本非法(0)", { ...K2_ENV, OPERATION_KEY_VERSION: "0" }],
    ["realm 非法(大写)", { ...K2_ENV, OPERATION_KEY_REALM: "G3-REALM" }],
  ];
  for (const [name, env] of cases) {
    await t.test(name, async (st) => {
      const h = await setupG3(st, { env });
      await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "NOT_CONFIGURED", 503);
    });
  }
  // 证明权限预读先于 K2：同样非法配置 + 无权限时先返回 FORBIDDEN
  await t.test("权限预读先于 K2", async (st) => {
    const h = await setupG3(st, {
      env: { ...K2_ENV, OPERATION_KEY_VERSION: "0" },
      memberOverrides: { permissions: [] },
    });
    await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "FORBIDDEN", 403);
  });
});

test("K09 withDomains:false → 写 head+version(D=2)、audit.target 五条有序引用，该形态合法重放零写", async (t) => {
  const h = await setupG3(t, { withDomains: false });
  assert.equal(count(h.store, DOMAINS), 0, "前置：DOMAINS=0");
  const key = h.nextKey();

  const receipt = await h.retry(JOB, JOB_REV, key);
  assertReceiptShape(receipt);
  assertNoNetworkViolation();
  assert.equal(count(h.store, DOMAINS), 2, "首次 retry 写入 head+version 两条");

  const ctx = opContextFor({ env: h.env, idempotencyKey: key }); // 仅取 domain head/version ID
  const opId = independentOpKey({ env: h.env, idempotencyKey: key });
  assert.ok(find(h.store, DOMAINS, ctx.headId), "head 存在");
  assert.ok(find(h.store, DOMAINS, ctx.versionId), "version 存在");
  const expectedTarget = [
    `${DOMAINS}/${ctx.headId}`,
    `${DOMAINS}/${ctx.versionId}`,
    `${JOBS}/${JOB}`,
    `${LOGS}/${independentLogId(JOB, "queued", JOB_REV + 1)}`,
    `${OP_KEYS}/${opId}`,
  ].join(", ");
  assert.equal(find(h.store, AUDIT_COLLECTION, independentAuditId(opId)).target, expectedTarget,
    "audit.target 必须是五条有序引用 join(', ')");

  // 该形态的合法重放：仍返回原回执、全库零写（含 domain/audit 不变）
  const auditsBefore = count(h.store, AUDIT_COLLECTION);
  const domainsBefore = structuredClone(h.store.data[DOMAINS]);
  const before = structuredClone(h.store.data);
  const replay = await h.retry(JOB, JOB_REV, key);
  assert.deepEqual(replay, receipt, "五条 target 形态重放返回原回执");
  assertNoNetworkViolation();
  assertZeroWrite(h.store, before, "五条 target 形态重放全库零写");
  assert.equal(count(h.store, AUDIT_COLLECTION), auditsBefore);
  assert.deepEqual(h.store.data[DOMAINS], domainsBefore);
});

test("K10 domain 单边缺（删 version）→ DOMAIN_INCOMPLETE/409", async (t) => {
  const h = await setupG3(t, { withDomains: true });
  const key = h.nextKey();
  const ctx = opContextFor({ env: h.env, idempotencyKey: key });
  removeRecord(h.store, DOMAINS, ctx.versionId);
  assert.ok(find(h.store, DOMAINS, ctx.headId), "前置：head 在、version 缺");

  await expectError(h.store, () => h.retry(JOB, JOB_REV, key), "DOMAIN_INCOMPLETE", 409);
  assert.equal(find(h.store, DOMAINS, ctx.versionId), undefined, "失败不得补写 version");
});

test("K11 换钥（域用 K2_ENV 预建、service 用 K2_ENV_B）→ DOMAIN_MISMATCH/409", async (t) => {
  const h = await setupG3(t, { withDomains: true });
  const serviceB = new StrictRetryService({
    store: h.store, orgId: ORG,
    actor: { actorId: ACTOR, membershipId: MEMBERSHIP, actorType: "user" },
    now: () => NOW, env: { ...K2_ENV_B },
  });
  const key = h.nextKey();
  await expectError(h.store,
    () => serviceB.retry(JOB, { expectedJobRevision: JOB_REV }, { idempotencyKey: key }),
    "DOMAIN_MISMATCH", 409);
});

test("K12 op key result 12 种损坏 → CONFLICT/409 不修复，每次恢复原值", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  await h.retry(JOB, JOB_REV, key);
  assertNoNetworkViolation();
  const opId = independentOpKey({ env: h.env, idempotencyKey: key });
  const original = structuredClone(find(h.store, OP_KEYS, opId).result);
  const good = () => ({ jobId: JOB, state: "queued", revision: JOB_REV + 1, attempts: 2, nextAttemptAt: NOW - 5_000 });
  const variants = [
    ["null", () => null],
    ["数组", () => []],
    ["错 jobId", () => ({ ...good(), jobId: "job-g3-tampered" })],
    ["state≠queued", () => ({ ...good(), state: "sending" })],
    ["revision 非安全整数", () => ({ ...good(), revision: 1.5 })],
    ["revision 超上限", () => ({ ...good(), revision: Number.MAX_SAFE_INTEGER })],
    ["revision≠expected+1", () => ({ ...good(), revision: JOB_REV + 2 })],
    ["attempts=0", () => ({ ...good(), attempts: 0 })],
    ["attempts=4", () => ({ ...good(), attempts: 4 })],
    ["nextAttemptAt 超范围", () => ({ ...good(), nextAttemptAt: -1 })],
    ["多字段", () => ({ ...good(), leaked: "x" })],
    ["少字段", () => { const r = good(); delete r.nextAttemptAt; return r; }],
  ];
  assert.equal(variants.length, 12, "必须覆盖 12 种损坏");
  for (const [name, make] of variants) {
    await t.test(name, async (st) => {
      putRecord(h.store, OP_KEYS, opId, { ...find(h.store, OP_KEYS, opId), result: make() });
      await expectError(h.store, () => h.retry(JOB, JOB_REV, key), "CONFLICT", 409);
      putRecord(h.store, OP_KEYS, opId, { ...find(h.store, OP_KEYS, opId), result: structuredClone(original) });
      assert.deepEqual(find(h.store, OP_KEYS, opId).result, original, `${name}：损坏值须原样恢复，不修复`);
    });
  }
});

test("K13 有 op key 无 audit → CONFLICT/409", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  await h.retry(JOB, JOB_REV, key);
  assertNoNetworkViolation();
  const auditId = independentAuditId(independentOpKey({ env: h.env, idempotencyKey: key }));
  removeRecord(h.store, AUDIT_COLLECTION, auditId);

  await expectError(h.store, () => h.retry(JOB, JOB_REV, key), "CONFLICT", 409);
  assert.equal(find(h.store, AUDIT_COLLECTION, auditId), undefined,
    "失败不得替 Store 补写 audit");
});

test("K14 有 audit 无 op key → CONFLICT/409", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  await h.retry(JOB, JOB_REV, key);
  assertNoNetworkViolation();
  const opId = independentOpKey({ env: h.env, idempotencyKey: key });
  const auditId = independentAuditId(opId);
  const auditBefore = structuredClone(find(h.store, AUDIT_COLLECTION, auditId));
  removeRecord(h.store, OP_KEYS, opId);

  await expectError(h.store, () => h.retry(JOB, JOB_REV, key), "CONFLICT", 409);
  assert.deepEqual(find(h.store, AUDIT_COLLECTION, auditId), auditBefore,
    "孤立 audit 不得被改写或迁移");
});

test("K15 同键在 job 再次失败后复用（revision 变）→ CONFLICT/409", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  await h.retry(JOB, JOB_REV, key);
  assertNoNetworkViolation();

  // 模拟下一次失败：revision 前进、回到 retryable_failed
  const job = find(h.store, JOBS, JOB);
  job.state = "retryable_failed";
  job.revision = JOB_REV + 1;
  job.result = { attempt: 2, outcome: "retryable_failed", errorKind: "RETRYABLE",
    reasonCode: "PRIOR_RETRYABLE", finishedAt: NOW - 1 };
  job.nextAttemptAt = NOW;

  await expectError(h.store, () => h.retry(JOB, JOB_REV + 1, key), "CONFLICT", 409);
  assert.equal(find(h.store, OP_KEYS, independentOpKey({ env: h.env, idempotencyKey: key })).requestDigest,
    digestOf({ jobId: JOB, expectedJobRevision: JOB_REV }), "摘要仍绑定旧 revision，不被覆盖");
});

test("K16 op.result.revision 篡改为 JOB_REV+2 → CONFLICT/409，不当成功重放", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  await h.retry(JOB, JOB_REV, key);
  assertNoNetworkViolation();
  const opId = independentOpKey({ env: h.env, idempotencyKey: key });
  const original = structuredClone(find(h.store, OP_KEYS, opId).result);
  const auditsBefore = count(h.store, AUDIT_COLLECTION);

  putRecord(h.store, OP_KEYS, opId, { ...find(h.store, OP_KEYS, opId),
    result: { ...original, revision: JOB_REV + 2 } });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, key), "CONFLICT", 409);
  assert.equal(find(h.store, OP_KEYS, opId).result.revision, JOB_REV + 2,
    "篡改值原样保留，服务不得修复/覆盖");
  assert.equal(count(h.store, AUDIT_COLLECTION), auditsBefore, "失败路径不得新增 audit");

  putRecord(h.store, OP_KEYS, opId, { ...find(h.store, OP_KEYS, opId), result: original });
});

// ===========================================================================
// O 系列 O01–O13
// ===========================================================================

test("O01 成功响应键集合精确 [attempts,jobId,nextAttemptAt,revision,state]", async (t) => {
  const h = await setupG3(t);
  const receipt = await h.retry(JOB, JOB_REV, h.nextKey());
  assertNoNetworkViolation();
  assert.deepEqual(Object.keys(receipt).sort(), [...RECEIPT_KEYS].sort());
  assertReceiptShape(receipt);
});

test("O02 同键重放响应逐字段相等", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  const replay = await h.retry(JOB, JOB_REV, key);
  assertNoNetworkViolation();
  assert.deepEqual(replay, receipt);
  for (const field of RECEIPT_KEYS) assert.equal(replay[field], receipt[field]);
});

/** 响应 JSON 不得出现指定字段名或字面量。 */
function assertResponseClean(receipt, forbidden) {
  const serialized = JSON.stringify(receipt);
  for (const key of Object.keys(receipt))
    assert.ok(!forbidden.includes(key), `响应字段名不得出现 ${key}`);
  for (const token of forbidden)
    assert.ok(!serialized.includes(token), `响应 JSON 不得出现 ${token}`);
}

test("O03 响应 JSON 无 lease/digest/op key/原始 key 痕迹", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  assertNoNetworkViolation();
  assertResponseClean(receipt, [
    "leaseOwner", "leaseExpiresAt", "leaseGeneration", "lease",
    "requestDigest", "digest", "opKey", "op_key", "op:",
    key,
  ]);
});

test("O04 响应 JSON 无 result/errorKind/reasonCode/message/stack", async (t) => {
  const h = await setupG3(t);
  const receipt = await h.retry(JOB, JOB_REV, h.nextKey());
  assertNoNetworkViolation();
  assertResponseClean(receipt, [
    "result", "errorKind", "reasonCode", "message", "stack",
  ]);
});

test("O05 响应 JSON 无 org/actor/凭证/设备/人员/文件字段", async (t) => {
  const h = await setupG3(t);
  const receipt = await h.retry(JOB, JOB_REV, h.nextKey());
  assertNoNetworkViolation();
  assertResponseClean(receipt, [
    "orgId", "actorId", "actorType", "membershipId", "principalId",
    "credentialId", "credentials", "deviceId", "serial", "serialNumber",
    "personId", "identityId", "occupancyId", "cycleId", "fileId", "objectKey",
    "grantId", "claimId", "slotId", "provider", "evidenceScope",
  ]);
});

test("O06 响应 JSON 无 auditId/logId/createdAt/updatedAt", async (t) => {
  const h = await setupG3(t);
  const receipt = await h.retry(JOB, JOB_REV, h.nextKey());
  assertNoNetworkViolation();
  assertResponseClean(receipt, ["auditId", "logId", "createdAt", "updatedAt"]);
});

test("O07 state=queued；enroll 的 nextAttemptAt 为 number，revoke 为 null", async (t) => {
  await t.test("enroll：nextAttemptAt 为 number", async (st) => {
    const h = await setupG3(st);
    const key = h.nextKey();
    const receipt = await h.retry(JOB, JOB_REV, key);
    assert.equal(receipt.state, "queued");
    assert.equal(typeof receipt.nextAttemptAt, "number");
    assert.equal(receipt.nextAttemptAt, NOW - 5_000);
    assertSuccessWriteSet(h, { key, enroll: true });
  });

  await t.test("revoke：nextAttemptAt 为 null", async (st) => {
    const h = await setupG3(st, { job: makeRevokeJob() });
    const key = h.nextKey();
    const receipt = await h.retry(JOB, JOB_REV, key);
    assert.equal(receipt.state, "queued");
    assert.equal(receipt.nextAttemptAt, null);
    assertSuccessWriteSet(h, { key, enroll: false,
      expectedAttempts: 1, expectedNextAttemptAt: null });
  });
});

test("O08 遍历失败：code∈§4.10 既有码、status 匹配、消息固定无泄漏、全库零写", async (t) => {
  // §4.10 冻结错误码 → 既有 HTTP 映射（与 model.mjs / retry.mjs / collections.mjs 一致）
  const CODE_STATUS = Object.freeze({
    PARAM_ERROR: 400, FORBIDDEN: 403, NOT_FOUND: 404,
    CONFLICT: 409, REVISION_CONFLICT: 409, INVALID_STATE: 409,
    INVALID_JOB: 409, RETRY_NOT_DUE: 409, DOMAIN_INCOMPLETE: 409, DOMAIN_MISMATCH: 409,
    NOT_CONFIGURED: 503, ADAPTER_UNAVAILABLE: 503,
  });
  const cases = [
    ["PARAM_ERROR", async (st) => {
      const h = await setupG3(st);
      return { h, action: () => h.service.retry(JOB, { expectedJobRevision: JOB_REV }, {}),
        code: "PARAM_ERROR", status: 400, message: "Idempotency-Key 必须是 16–128 位 [A-Za-z0-9._:-]" };
    }],
    ["FORBIDDEN", async (st) => {
      const h = await setupG3(st, { memberOverrides: { permissions: [] } });
      return { h, action: () => h.retry(JOB, JOB_REV, h.nextKey()),
        code: "FORBIDDEN", status: 403, message: "当前成员关系无权人工重试" };
    }],
    ["NOT_FOUND", async (st) => {
      const h = await setupG3(st);
      const alien = new StrictRetryService({
        store: h.store, orgId: ORG_OTHER,
        actor: { actorId: ACTOR, membershipId: MEMBERSHIP, actorType: "user" },
        now: () => NOW, env: h.env,
      });
      return { h, action: () => alien.retry(JOB, { expectedJobRevision: JOB_REV }, { idempotencyKey: h.nextKey() }),
        code: "NOT_FOUND", status: 404, message: "组织不可用" };
    }],
    ["CONFLICT", async (st) => {
      const h = await setupG3(st);
      const key = h.nextKey();
      await h.retry(JOB, JOB_REV, key);
      return { h, action: () => h.retry(JOB, JOB_REV + 1, key),
        code: "CONFLICT", status: 409, message: "请求与既有记录不一致" };
    }],
    ["REVISION_CONFLICT", async (st) => {
      const h = await setupG3(st);
      return { h, action: () => h.retry(JOB, JOB_REV + 1, h.nextKey()),
        code: "REVISION_CONFLICT", status: 409, message: "任务已被修改，请刷新后重试" };
    }],
    ["INVALID_STATE", async (st) => {
      const h = await setupG3(st, { job: makeEnrollJob({ state: "queued" }) });
      return { h, action: () => h.retry(JOB, JOB_REV, h.nextKey()),
        code: "INVALID_STATE", status: 409, message: "任务当前不可重试" };
    }],
    ["INVALID_JOB", async (st) => {
      const h = await setupG3(st, { job: makeEnrollJob({ action: "update" }) });
      return { h, action: () => h.retry(JOB, JOB_REV, h.nextKey()),
        code: "INVALID_JOB", status: 409, message: "任务当前不可重试" };
    }],
    ["RETRY_NOT_DUE", async (st) => {
      const h = await setupG3(st, { job: makeEnrollJob({ nextAttemptAt: NOW + 60_000 }) });
      return { h, action: () => h.retry(JOB, JOB_REV, h.nextKey()),
        code: "RETRY_NOT_DUE", status: 409, message: "未到重试时间" };
    }],
    ["DOMAIN_INCOMPLETE", async (st) => {
      const h = await setupG3(st, { withDomains: true });
      const key = h.nextKey();
      removeRecord(h.store, DOMAINS, opContextFor({ env: h.env, idempotencyKey: key }).versionId);
      return { h, action: () => h.retry(JOB, JOB_REV, key),
        code: "DOMAIN_INCOMPLETE", status: 409, message: "operation key domain 记录不完整或损坏，需受控修复" };
    }],
    ["DOMAIN_MISMATCH", async (st) => {
      const h = await setupG3(st, { withDomains: true });
      const serviceB = new StrictRetryService({
        store: h.store, orgId: ORG,
        actor: { actorId: ACTOR, membershipId: MEMBERSHIP, actorType: "user" },
        now: () => NOW, env: { ...K2_ENV_B },
      });
      return { h, action: () => serviceB.retry(JOB, { expectedJobRevision: JOB_REV }, { idempotencyKey: h.nextKey() }),
        code: "DOMAIN_MISMATCH", status: 409, message: "operation key domain 与当前配置不一致" };
    }],
    ["NOT_CONFIGURED", async (st) => {
      const h = await setupG3(st, { env: { OPERATION_KEY_HMAC_KEY_B64: "not-base64!!",
        OPERATION_KEY_VERSION: "1", OPERATION_KEY_REALM: "g3-realm" } });
      return { h, action: () => h.retry(JOB, JOB_REV, h.nextKey()),
        code: "NOT_CONFIGURED", status: 503, message: "OPERATION_KEY_HMAC_KEY_B64 不是规范的 Base64" };
    }],
    ["ADAPTER_UNAVAILABLE", async (st) => {
      const h = await setupG3(st);
      const broken = new StrictRetryService({
        store: h.store, orgId: ORG,
        actor: { actorId: ACTOR, membershipId: MEMBERSHIP, actorType: "user" },
        now: () => -1, env: h.env,
      });
      return { h, action: () => broken.retry(JOB, { expectedJobRevision: JOB_REV }, { idempotencyKey: h.nextKey() }),
        code: "ADAPTER_UNAVAILABLE", status: 503, message: "可信时钟不可用" };
    }],
  ];
  assert.equal(cases.length, 12, "O08 必须遍历全部 12 个既有错误码");

  for (const [name, make] of cases) {
    await t.test(name, async (st) => {
      const { h, action, code, status, message } = await make(st);
      const before = structuredClone(h.store.data);
      const err = await failureOf(action);
      assertSafeError(err, "失败不得泄漏合成标识或 stack");
      assert.equal(err.code, code, "错误码必须是 §4.10 既有码");
      assert.equal(err.status, status, "status 必须按冻结映射匹配");
      assert.ok(Object.hasOwn(CODE_STATUS, err.code), `${err.code} 不在 §4.10 既有码集合`);
      assert.equal(CODE_STATUS[err.code], status, `${code}/status 冻结映射不匹配`);
      assert.equal(err.message, message, "消息必须是固定短语，无存在性/内部字段泄漏");
      assert.deepEqual(structuredClone(h.store.data), before, "失败分支全库零写");
    });
  }
});

test("O09 跨组织 / 不存在 job 的 NOT_FOUND/404 三要素完全同态", async (t) => {
  const h = await setupG3(t, { jobs: [makeEnrollJob({ orgId: ORG_OTHER })] });
  const netBefore = getViolations().runtime.length;

  const beforeAlien = structuredClone(h.store.data);
  const alienJob = await failureOf(() => h.retry(JOB, JOB_REV, h.nextKey()));
  assert.deepEqual(structuredClone(h.store.data), beforeAlien, "跨组织 NOT_FOUND 全库内容级零写");
  assert.equal(getViolations().runtime.length, netBefore, "跨组织 NOT_FOUND 零 Provider/网络调用");

  const beforeMissing = structuredClone(h.store.data);
  const missingJob = await failureOf(() => h.retry("job-g3-missing-0001", JOB_REV, h.nextKey()));
  assert.deepEqual(structuredClone(h.store.data), beforeMissing, "不存在 job 的 NOT_FOUND 全库内容级零写");
  assert.equal(getViolations().runtime.length, netBefore, "不存在 job 的 NOT_FOUND 零 Provider/网络调用");

  const tuple = (e) => [e.code, e.status, e.message];
  assert.deepEqual(tuple(alienJob), ["NOT_FOUND", 404, "任务不可用"]);
  assert.deepEqual(tuple(missingJob), ["NOT_FOUND", 404, "任务不可用"]);
  assert.deepEqual(tuple(alienJob), tuple(missingJob), "三要素完全同态，不泄漏存在性");
});

/**
 * O10 专用「动态门禁」helper（本文件内实现，不改 testkit）。
 * - testkit.expectBlocked 整体永远 blocked；这里 blocked 由三子项实际结果动态推导：
 *   三子项全 true → PASS（不进 BLOCKED_RECORDS）；任一 false → BLOCKED 并登记。
 * - 因此「独立 Q8 清理 routes.mjs 的 retry 描述行后，同一用例自动转 PASS」可被证伪。
 * - 登记时借用 testkit 的 BLOCKED_RECORDS 通道（expectBlocked 恒 blocked），
 *   仅传入按已算结果重放的 check，避免重复扫描源文件。
 */
function o10DynamicGate(name, checks, { register = true } = {}) {
  const results = [];
  for (const c of checks) {
    try { c.fn(); results.push({ label: c.label, ok: true }); }
    catch (e) { results.push({ label: c.label, ok: false, error: String((e && e.message) || e) }); }
  }
  const blocked = results.some((r) => !r.ok);
  const record = Object.freeze({ name, blocked, results, at: Date.now() });
  if (blocked && register) {
    expectBlocked(name, results.map((r) => ({
      label: r.label,
      fn: () => assert.ok(r.ok, r.error || `子项未通过：${r.label}`),
    })));
  }
  return record;
}

test("O10 整体门禁动态判定：lib 无 requeue 入口 / server.mjs 无 /retry 分支 / routes.mjs 无 retry 描述行", async (t) => {
  // 三子项全部成立 → O10 计 PASS（不进 BLOCKED_RECORDS）；任一不成立 → O10 BLOCKED 并登记。
  // 不硬编码「③必须失败」：当前 routes.mjs 描述行仍在 → ③=false → BLOCKED；
  // 一旦 Q8 清理该描述行 → ③=true → 同一用例自动 PASS，而非假失败。
  const listMjs = async (dir) => {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await listMjs(p));
      else if (entry.name.endsWith(".mjs")) out.push(p);
    }
    return out;
  };
  // 注释里引用设计文档文件名（...-RETRY-REQUEUE-DESIGN-...）不是可调用入口，先剥离注释。
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const libSources = [];
  for (const file of await listMjs(join(here, "..", "lib")))
    libSources.push({ file, source: stripComments(await readFile(file, "utf8")) });
  const serverSource = await readFile(join(here, "..", "server.mjs"), "utf8");
  const routesSource = await readFile(join(here, "..", "lib", "face-service", "routes.mjs"), "utf8");

  // 三子项判定：routesSource 作为参数注入，便于内存证伪（不改生产文件）。
  const buildChecks = (routesSrc) => [
    { label: "① grep admin-web/lib：无 requeue 可调用入口", fn: () => {
      for (const { file, source } of libSources)
        assert.doesNotMatch(source, /\brequeue\b/i, `${file} 不得残留 requeue 标识符/入口`);
    } },
    { label: "② server.mjs 无 /retry 分支", fn: () => {
      assert.doesNotMatch(serverSource, /\/retry\b/, "server.mjs 不得注册 /retry 分支");
      assert.doesNotMatch(serverSource, /device-operation-job-retry/, "server.mjs 不得引用 retry 路由 id");
    } },
    { label: "③ routes.mjs 无 device-operation-job-retry 描述行", fn: () => {
      assert.doesNotMatch(routesSrc, /["']device-operation-job-retry["']/,
        "routes.mjs 应已清理旧 retry 描述行");
    } },
  ];

  const record = o10DynamicGate("O10", buildChecks(routesSource));

  assert.equal(record.results.length, 3, "O10 必须记录三个子项");
  assert.equal(record.blocked, !record.results.every((r) => r.ok),
    "blocked 判定必须与三子项实际结果一致（全 true → PASS，任一 false → BLOCKED）");
  // ①②为局部通过证据，当前与清理后都应成立；③不再硬编码真假。
  assert.equal(record.results[0].ok, true, "① 局部通过证据");
  assert.equal(record.results[1].ok, true, "② 局部通过证据");
  // BLOCKED_RECORDS 登记须与 blocked 判定一致：blocked 进、PASS 不进。
  const registered = getBlockedRecords().some((r) => r.name === "O10" && r.blocked === true);
  assert.equal(registered, record.blocked, "BLOCKED_RECORDS 登记须与 blocked 判定一致");
  // 用例本身永远 PASS：成功记录一个动态判定的 blocked（或清理后的 pass），不 throw。
  t.diagnostic(`O10 动态判定 ${record.blocked ? "BLOCKED" : "PASS"}：${JSON.stringify(record.results.map((r) => [r.label, r.ok]))}`);

  // 可证伪：在内存中把 routes 源码的 retry 描述行替换为「已清理」形态，
  // 用同一 gate 判定应自动转为 PASS（证明「Q8 清理后同一用例复验通过」）。
  const cleanedRoutesSource = routesSource.replace(/device-operation-job-retry/g, "g3-falsify-cleaned");
  const cleaned = o10DynamicGate("O10-falsify", buildChecks(cleanedRoutesSource), { register: false });
  assert.equal(cleaned.results[2].ok, true, "内存清理后 ③ 应通过");
  assert.equal(cleaned.blocked, false, "内存清理后 O10 应自动转 PASS（可证伪）");
  t.diagnostic(`O10 可证伪（内存清理 routes 描述行）：${cleaned.blocked ? "BLOCKED" : "PASS"}，证明 Q8 清理后同一用例自动 PASS`);
});

test("O11 旧 requeue 遗留 queued job+log+audit + 新 key → INVALID_STATE/409，不误用/反推/迁移（G3 覆盖不替代 G4 独立复核）", async (t) => {
  const oldLogId = independentLogId(JOB, "queued", JOB_REV + 1);
  const oldAuditId = "audit-legacy-requeue";
  const h = await setupG3(t, {
    job: makeEnrollJob({ state: "queued", nextAttemptAt: null, result: null }),
    extra: [
      { collection: LOGS, id: oldLogId, data: {
        orgId: ORG, jobId: JOB, action: "enroll", fromState: "retryable_failed", state: "queued",
        actorType: "system", actorId: "legacy", at: NOW, revision: JOB_REV + 1, attempt: 2,
        leaseGeneration: 2, evidenceScope: "simulated", errorKind: null, reasonCode: null, alertCode: null,
      } },
      { collection: AUDIT_COLLECTION, id: oldAuditId, data: {
        orgId: ORG, actorId: "legacy", actorType: "system", action: "H4 requeue",
      } },
    ],
  });

  const key = h.nextKey();
  await expectError(h.store, () => h.retry(JOB, JOB_REV, key), "INVALID_STATE", 409);
  assert.equal(find(h.store, OP_KEYS, independentOpKey({ env: h.env, idempotencyKey: key })), undefined,
    "不得从旧 log/audit 反推或补写 op key");
  const oldAudit = find(h.store, AUDIT_COLLECTION, oldAuditId);
  assert.ok(oldAudit, "旧 audit 保留");
  assert.equal(oldAudit.action, "H4 requeue", "旧 audit 不被迁移/改写");
  assert.ok(find(h.store, LOGS, oldLogId), "旧 log 保留");
  // 证据：G3 覆盖不替代 G4 独立复核
  t.diagnostic("O11 证据：G3 覆盖不替代 G4 独立复核；此处仅证明旧遗留不被误用/反推/迁移");
});

test("O12 成功后全载体扫描：无原始 key、digest 原值、手机号/证件/序列号/objectKey", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  assertNoNetworkViolation();
  const opId = independentOpKey({ env: h.env, idempotencyKey: key });
  const log = find(h.store, LOGS, LOG_ID);
  const op = find(h.store, OP_KEYS, opId);
  const audit = find(h.store, AUDIT_COLLECTION, independentAuditId(opId));
  assert.ok(log && op && audit && receipt, "四类载体必须全部存在");

  // 原始 key 与合成 PII 字面量：四类载体一律不得出现。
  const universal = [
    key,
    "13800138000",            // 合成手机号
    "110101199001010011",     // 合成证件号
    "SN-G3-SYNTHETIC-0001",   // 合成设备序列号
    "private/g3/object-key",  // 合成 objectKey
    "credentialId", "personId", "serialNumber", "objectKey", "phone", "idCard",
  ];
  // requestDigest 是 op key 的冻结字段（K03），合法存在于 op 记录；
  // 对 log / audit / 响应三类对外载体必须完全不可见。
  const outward = [op.requestDigest, "requestDigest"];

  for (const [name, carrier] of [
    ["响应", receipt], ["log", log], ["audit", audit], ["op key", op],
  ]) {
    const serialized = JSON.stringify(carrier);
    for (const token of universal)
      assert.ok(!serialized.includes(token), `${name} 不得含 ${token}`);
    if (name !== "op key")
      for (const token of outward)
        assert.ok(!serialized.includes(token), `${name} 不得含 ${token}`);
  }
});

test("O13 成功写后 log 精确 15 字段（errorKind/reasonCode/alertCode=null）、audit 精确字段、二者无请求敏感痕迹", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  await h.retry(JOB, JOB_REV, key);
  assertNoNetworkViolation();
  const opId = independentOpKey({ env: h.env, idempotencyKey: key });
  const log = find(h.store, LOGS, LOG_ID);
  const audit = find(h.store, AUDIT_COLLECTION, independentAuditId(opId));

  assert.deepEqual(semanticKeys(log), [...LOG_FIELDS].sort(), "log 精确 15 语义字段");
  assert.equal(LOG_FIELDS.length, 15);
  assert.equal(log.errorKind, null);
  assert.equal(log.reasonCode, null);
  assert.equal(log.alertCode, null);

  assert.deepEqual(semanticKeys(audit),
    ["action", "actorId", "actorType", "createdAt", "orgId", "target"].sort(),
    "audit 精确六语义字段");
  assert.deepEqual(Object.keys(audit).sort(),
    ["_id", "action", "actorId", "actorType", "createdAt", "orgId", "target"].sort(),
    "audit 完整七字段（含 _id，无 updatedAt），对齐设计 §4.9.3/任务卡 §2.5");
  assert.ok(!Object.hasOwn(audit, "updatedAt"), "audit 为 create-only，不得含 updatedAt");

  for (const [name, carrier] of [["log", log], ["audit", audit]]) {
    const serialized = JSON.stringify(carrier);
    for (const token of [key, find(h.store, OP_KEYS, opId).requestDigest, "message", "stack"])
      assert.ok(!serialized.includes(token), `${name} 不得含 ${token}`);
  }
});
