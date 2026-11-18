/**
 * HK-AI-07D G3 冻结矩阵 —— C 系列（C01–C09）。
 *
 * 硬约束：
 *  - C03/C04/C09 必须通过 testkit 转发的【真实 claimDispatchJob】交互完成；
 *    不得用纯手改 job 状态代替 claim 步骤。
 *  - 失败用例统一用 expectError（code+status 双断言 + 全库零写 + Provider/网络 0）。
 *  - 只 import 本目录 testkit，不静态 import 任何被测模块（guard 在 testkit 顶层先安装）。
 *
 * 用户裁定1：C05 只验 retry 侧；E08（真实 reconcile 并发）未实现，
 * 本文件不实现、不调用 reconcile，未验证真实 reconcile 并发交互。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  // guard / 断言 helper
  expectError, assertZeroWrite, assertSuccessWriteSet, assertSafeError, assertNoNetworkViolation,
  getViolations,
  // 真实 claim helper（由 testkit 从 h3aModule guard 安装后动态转发）
  claimDispatchJob, assertLeaseFence,
  // fixture 工厂 / 常量
  setupG3, makeEnrollJob, putRecord, find, count,
  // 测试侧独立 oracle（P2-3：预期 ID 不得复用生产 operationKey/deterministicLogId/auditIdFor）
  independentOpKey, independentLogId, independentAuditId,
  ORG, JOB, JOB_REV, NOW, JOBS, LOGS, OP_KEYS, DOMAINS, AUDIT_COLLECTION,
} from "./face-g3-testkit.mjs";

const leaseTriple = (job) => ({
  leaseOwner: job.leaseOwner,
  leaseExpiresAt: job.leaseExpiresAt,
  leaseGeneration: job.leaseGeneration,
});

// ---------------------------------------------------------------------------
// C01 同键两并发
// ---------------------------------------------------------------------------
test("C01：同键两并发 → 两回执 deepEqual，OP_KEYS/LOGS/AUDIT 各仅 1 条，写集 J+L+O+D+A(D=0)", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  const domainsBefore = structuredClone(h.store.data[DOMAINS]);

  const [r1, r2] = await Promise.all([
    h.retry(JOB, JOB_REV, key),
    h.retry(JOB, JOB_REV, key),
  ]);

  assert.deepEqual(r1, r2, "同键并发两回执必须逐字段相等");
  // 胜者写集 J+L+O+A 内容级断言（D=0 见下）
  assertSuccessWriteSet(h, { key });
  // P2-3：独立交叉校验写集 ID（即便 testkit 内部仍用生产 helper，本文件也不漏判）。
  assert.ok(find(h.store, OP_KEYS, independentOpKey({ env: h.env, idempotencyKey: key })),
    "op key 必须命中测试侧独立 oracle");
  assert.ok(find(h.store, LOGS, independentLogId(JOB, "queued", JOB_REV + 1)),
    "log 必须命中测试侧独立 oracle");
  assert.ok(find(h.store, AUDIT_COLLECTION,
    independentAuditId(independentOpKey({ env: h.env, idempotencyKey: key }), { jobId: JOB })),
    "audit 必须命中测试侧独立 oracle");
  assert.equal(count(h.store, OP_KEYS), 1, "OP_KEYS 仅 1 条（重放零写）");
  assert.equal(count(h.store, LOGS), 1, "LOGS 仅 1 条（确定性 log 去重）");
  assert.equal(count(h.store, AUDIT_COLLECTION) - h.seedAuditCount, 1, "AUDIT 仅新增 1 条");
  assert.deepEqual(h.store.data[DOMAINS], domainsBefore, "D=0：Domains 零写");
});

// ---------------------------------------------------------------------------
// C02 异键同 revision 两并发
// ---------------------------------------------------------------------------
test("C02：异键同 revision 两并发 → 一 fulfilled、一 INVALID_STATE/409，败者全库零写", async (t) => {
  const h = await setupG3(t);
  const keyA = h.nextKey();
  const keyB = h.nextKey();
  const netBefore = getViolations().runtime.length;
  const before = structuredClone(h.store.data);

  // 异键 → 两条不同 op key；LocalStore.transact 串行，胜者先把 job 推到 queued，
  // 败者随后在 stateGate 命中 sending/queued → INVALID_STATE。
  const results = await Promise.allSettled([
    h.retry(JOB, JOB_REV, keyA),
    h.retry(JOB, JOB_REV, keyB),
  ]);

  const ok = results.filter((r) => r.status === "fulfilled");
  const bad = results.filter((r) => r.status === "rejected");
  assert.equal(ok.length, 1, "恰一成功");
  assert.equal(bad.length, 1, "恰一失败");
  assertSafeError(bad[0].reason);
  assert.equal(bad[0].reason.code, "INVALID_STATE", "败者错误码必须是 INVALID_STATE");
  assert.equal(bad[0].reason.status, 409, "败者 status 必须是 409");

  // 胜者写集 J+L+O+A 内容级断言（保留）。
  // P2-3：预期 opKey 由测试侧独立 oracle 计算，不复用生产 operationKey()。
  const opKeyA = independentOpKey({ env: h.env, idempotencyKey: keyA });
  const opKeyB = independentOpKey({ env: h.env, idempotencyKey: keyB });
  const hasA = !!find(h.store, OP_KEYS, opKeyA);
  const hasB = !!find(h.store, OP_KEYS, opKeyB);
  assert.ok(hasA !== hasB, "恰好一个 op key 落库（败者零写）");
  const winnerKey = hasA ? keyA : keyB;
  assertSuccessWriteSet(h, { key: winnerKey });
  assert.equal(count(h.store, OP_KEYS), 1, "OP_KEYS 仅胜者 1 条");
  assert.equal(count(h.store, LOGS), 1, "LOGS 仅胜者 1 条");
  assert.equal(count(h.store, AUDIT_COLLECTION) - h.seedAuditCount, 1, "AUDIT 仅胜者 1 条");
  assert.equal(getViolations().runtime.length, netBefore, "并发两路均不得产生网络/Provider 调用");

  // ---- 败者全库零写的【内容级】证据（任务卡 §2.2）----
  // 最终库态 = 初始快照 + 胜者合法写集；败者不得产生任何额外写入。
  const winnerOpKey = independentOpKey({ env: h.env, idempotencyKey: winnerKey });
  const winnerLogId = independentLogId(JOB, "queued", JOB_REV + 1);
  const winnerAuditId = independentAuditId(winnerOpKey, { jobId: JOB });
  const asRows = (v) => structuredClone(v || []);
  const WRITE_SET = new Set([JOBS, LOGS, OP_KEYS, AUDIT_COLLECTION, DOMAINS]);

  // (a) 非写集集合：逐一内容级对比（也覆盖败者可能写入的新集合）。
  for (const col of new Set([...Object.keys(before), ...Object.keys(h.store.data)])) {
    if (WRITE_SET.has(col)) continue;
    assert.deepEqual(asRows(h.store.data[col]), asRows(before[col]),
      `非写集集合 ${col} 内容级零变化（败者零写）`);
  }

  // (b) 追加型写集集合：剔除胜者那一条后必须与初始快照内容级相等。
  //     DOMAINS 为 D=0，winnerId=null 表示应完全零变化。
  for (const [col, winnerId] of [
    [LOGS, winnerLogId],
    [OP_KEYS, winnerOpKey],
    [AUDIT_COLLECTION, winnerAuditId],
    [DOMAINS, null],
  ]) {
    const afterRows = asRows(h.store.data[col]);
    const withoutWinner = winnerId === null ? afterRows : afterRows.filter((r) => r._id !== winnerId);
    assert.deepEqual(withoutWinner, asRows(before[col]),
      `写集集合 ${col} 除胜者外内容级零变化（败者零写）`);
  }

  // (c) JOBS：仅允许 retry 合法改写的 state/revision/updatedAt，其余字段逐字段零变化。
  const jobAfter = structuredClone(find(h.store, JOBS, JOB));
  const jobBefore = structuredClone(before[JOBS].find((r) => r._id === JOB));
  for (const field of ["state", "revision", "updatedAt"]) {
    delete jobAfter[field];
    delete jobBefore[field];
  }
  assert.deepEqual(jobAfter, jobBefore, "job 除 retry 合法改写字段外内容级零变化（败者零写）");
});

// ---------------------------------------------------------------------------
// C03 retry 先提交，随后真实 claim
// ---------------------------------------------------------------------------
test("C03：retry 先提交（lease 三字段保持 null/原值），随后真实 claimDispatchJob 读取 queued 并领取", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  const pre = structuredClone(find(h.store, JOBS, JOB));

  const receipt = await h.retry(JOB, JOB_REV, key);
  assert.equal(receipt.state, "queued", "retry 成功推进到 queued");
  assertSuccessWriteSet(h, { key });
  // P2-3：独立交叉校验写集 ID（即便 testkit 内部仍用生产 helper，本文件也不漏判）。
  const expOpKey = independentOpKey({ env: h.env, idempotencyKey: key });
  assert.ok(find(h.store, OP_KEYS, expOpKey), "op key 必须命中测试侧独立 oracle");
  assert.ok(find(h.store, LOGS, independentLogId(JOB, "queued", JOB_REV + 1)),
    "log 必须命中测试侧独立 oracle");
  assert.ok(find(h.store, AUDIT_COLLECTION, independentAuditId(expOpKey, { jobId: JOB })),
    "audit 必须命中测试侧独立 oracle");

  const afterRetry = find(h.store, JOBS, JOB);
  // retry 侧不得改写 lease 三字段（保持 null / 原值）与 attempts
  assert.deepEqual(leaseTriple(afterRetry), leaseTriple(pre), "retry 不改 lease 三字段");
  assert.equal(afterRetry.dispatchAuthorizedAt, pre.dispatchAuthorizedAt);
  assert.equal(afterRetry.attempts, pre.attempts, "retry 不增 attempts");

  // 真实 claim（非手改状态）：必须读到 retry 产出的 queued job 并领取。
  const claimed = await claimDispatchJob({
    store: h.store, orgId: ORG, jobId: JOB, owner: "worker-g3", now: () => NOW,
  });
  assert.ok(claimed && claimed.job && claimed.fence, "claimDispatchJob 必须返回 {job,fence,logId}");
  const stored = find(h.store, JOBS, JOB);
  for (const k of ["state", "revision", "attempts", "nextAttemptAt", "result", "leaseOwner",
    "leaseExpiresAt", "leaseGeneration", "dispatchAuthorizedAt"]) {
    assert.equal(stored[k], claimed.job[k], `claim 持久化与返回一致：${k}`);
  }
  assert.equal(stored.state, "sending", "claim 读到 queued 并置 sending");
  assert.equal(stored.attempts, pre.attempts + 1, "claim attempts+1");
  assert.equal(stored.nextAttemptAt, null, "claim 清空 nextAttemptAt");
  assert.equal(stored.result, null, "claim 清空 result");
  assert.equal(stored.leaseOwner, "worker-g3", "claim 写入 leaseOwner");
  assert.equal(stored.leaseExpiresAt, NOW + 60_000, "claim 写入 leaseExpiresAt");
  assert.equal(stored.leaseGeneration, pre.leaseGeneration + 1, "claim generation+1");
  assert.equal(claimed.fence.owner, "worker-g3");
  assert.equal(claimed.fence.generation, pre.leaseGeneration + 1);
  assert.doesNotThrow(() => assertLeaseFence(stored, claimed.fence, NOW), "claim fence 必须通过 fence 校验");
  // P1：retry 成功写集断言在 claim 之前；claim 之后整条成功路径同样必须零网络/Provider。
  assertNoNetworkViolation();
});

// ---------------------------------------------------------------------------
// C04 claim 先提交，随后 retry
// ---------------------------------------------------------------------------
test("C04：真实 claimDispatchJob 先提交 sending+lease/fence，随后 retry → INVALID_STATE/409，lease 与 fence 零改（全库 Z）", async (t) => {
  // claim 候选需要 queued 且通过 validateDispatchJob（保留 nextAttemptAt 与 retryable_failed result）
  const h = await setupG3(t, { job: makeEnrollJob({ state: "queued" }) });

  // 真实 claim 产生 sending + lease + fence。
  const claimed = await claimDispatchJob({
    store: h.store, orgId: ORG, jobId: JOB, owner: "worker-first", now: () => NOW,
  });
  const fenceSnapshot = structuredClone(claimed.fence);
  const sentJob = find(h.store, JOBS, JOB);
  assert.equal(sentJob.state, "sending", "claim 已置 sending");
  assert.doesNotThrow(() => assertLeaseFence(sentJob, fenceSnapshot, NOW), "claim fence 有效");

  const before = structuredClone(h.store.data);
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "INVALID_STATE", 409);

  // expectError 内含全库零写 + 网络 0；显式复核 lease 三字段与 fence 未被改写。
  const after = find(h.store, JOBS, JOB);
  assert.deepEqual(leaseTriple(after), leaseTriple(sentJob), "lease 三字段零改");
  assert.deepEqual(claimed.fence, fenceSnapshot, "fence 快照零改");
  assert.doesNotThrow(() => assertLeaseFence(after, fenceSnapshot, NOW), "fence 仍有效且未被 retry 消费");
  assertZeroWrite(h.store, before);
});

// ---------------------------------------------------------------------------
// C05 awaiting_result（用户裁定1：仅验 retry 侧）
// ---------------------------------------------------------------------------
test("C05：awaiting_result job → INVALID_JOB/409 + Z（裁定1：仅验 retry 侧；E08 未实现，未验证真实 reconcile 并发交互）", async (t) => {
  // 用户裁定1：E08（真实 reconcile 并发）未实现。本用例只验 retry 侧状态门禁，
  // 不实现、不调用 reconcile，【未验证真实 reconcile 并发交互】。
  const awaiting = makeEnrollJob({
    state: "awaiting_result",
    nextAttemptAt: null,
    result: {
      attempt: 2, outcome: "awaiting_result", errorKind: "PENDING",
      reasonCode: "AWAIT_PROVIDER", finishedAt: NOW - 10_000,
    },
  });
  const h = await setupG3(t, { job: awaiting });
  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "INVALID_JOB", 409);
});

// ---------------------------------------------------------------------------
// C06 其他路径推终态
// ---------------------------------------------------------------------------
test("C06：其他路径推终态（succeeded/terminal_failed/cancelled）→ 新 key retry INVALID_STATE/409 + Z", async (t) => {
  const h = await setupG3(t);
  await h.retry(JOB, JOB_REV, h.nextKey()); // 先成功一次（queued, revision=5）
  assertNoNetworkViolation(); // P1：该成功 retry 未走 assertSuccessWriteSet，显式断言零网络违规

  for (const terminal of ["succeeded", "terminal_failed", "cancelled"]) {
    const job = find(h.store, JOBS, JOB);
    job.state = terminal; // 外部路径推进到终态
    await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "INVALID_STATE", 409);
  }
});

// ---------------------------------------------------------------------------
// C07 ack loss 同键重放
// ---------------------------------------------------------------------------
test("C07：ack loss 同键重放 → 原快照逐字段相等、不新增 op/log/audit/domain、不读当前 job、Z", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key); // 模拟成功但回执丢失

  const opBefore = count(h.store, OP_KEYS);
  const logBefore = count(h.store, LOGS);
  const auditBefore = count(h.store, AUDIT_COLLECTION);
  const domainBefore = structuredClone(h.store.data[DOMAINS]);

  // 破坏当前 job（推进到 sending + 写 lease），证明重放不读当前 job、仍返回原快照。
  const job = find(h.store, JOBS, JOB);
  job.state = "sending";
  job.leaseOwner = "worker-late";
  const before = structuredClone(h.store.data);

  const replay = await h.retry(JOB, JOB_REV, key);
  assert.deepEqual(replay, receipt, "同键重放必须返回原回执（逐字段相等）");
  assertZeroWrite(h.store, before, "重放必须全库零写");
  assert.equal(count(h.store, OP_KEYS), opBefore, "不新增 op key");
  assert.equal(count(h.store, LOGS), logBefore, "不新增 log");
  assert.equal(count(h.store, AUDIT_COLLECTION), auditBefore, "不新增 audit");
  assert.deepEqual(h.store.data[DOMAINS], domainBefore, "不新增/改写 domain");
  // P1：首次成功 retry 与同键合法重放均未走 assertSuccessWriteSet，显式断言零网络违规。
  assertNoNetworkViolation();
});

// ---------------------------------------------------------------------------
// C08 事务 callback 重跑 / 预占 ID
// ---------------------------------------------------------------------------
test("C08：预占确定性 log ID（哨兵 MUST_SURVIVE）→ retry CONFLICT/409 整事务回滚、哨兵保留、全库 Z", async (t) => {
  const h = await setupG3(t);
  const logId = independentLogId(JOB, "queued", JOB_REV + 1);
  const squatter = putRecord(h.store, LOGS, logId, {
    orgId: ORG, jobId: JOB, state: "squatter", sentinelMarker: "MUST_SURVIVE",
  });

  await expectError(h.store, () => h.retry(JOB, JOB_REV, h.nextKey()), "CONFLICT", 409);

  const after = find(h.store, LOGS, logId);
  assert.deepEqual(after, squatter, "预占记录必须原样保留（整事务回滚）");
  assert.equal(after.sentinelMarker, "MUST_SURVIVE", "预占哨兵必须存活");
});

// C08 子场景（不新增矩阵 ID）：事务 callback 被重跑（re-run）时的确定性 / 幂等性。
// 设计依据：retry-requeue 设计 §4.8「事务 callback 重跑 → 确定性 log/audit ID + create-only，
// 仅一次提交；预占 ID → 整事务回滚」与 §4.5 原子性「build 在克隆态构建、抛错不落盘」。
// 实现：测试侧可控桩包裹 store.transact，让 retry 传给 Store 的 build 在同一初始 state 上
// 被调用两次（模拟 CloudStore.runTransaction 重跑 callback），捕获两次写集对比后只提交第二次。
// 不改生产 store.mjs / retry.mjs。
test("C08-RERUN：事务 callback 重跑两次 → 两次确定性写集逐字段相等、只提交一次、全库除合法写集零变化、零网络", async (t) => {
  const h = await setupG3(t);
  const key = h.nextKey();

  // P2-3：预期 ID 全部来自测试侧独立 oracle，不调用生产 helper。
  const expectedOpKey = independentOpKey({ env: h.env, idempotencyKey: key });
  const expectedLogId = independentLogId(JOB, "queued", JOB_REV + 1);
  const expectedAuditId = independentAuditId(expectedOpKey, { jobId: JOB });

  const before = structuredClone(h.store.data);

  // 测试侧桩：包裹实例 transact，把 build 包装成「同一 state 连跑两次、捕获写集、只提交第二次」。
  const realTransact = h.store.transact.bind(h.store);
  const captured = [];
  h.store.transact = async (refs, build, audit) => {
    const rerunBuild = async (state) => {
      // 两次调用各拿一份独立 state 克隆，避免相互污染；build 内权威校验均为纯读，不改 state。
      const writes1 = await build(structuredClone(state));
      const writes2 = await build(structuredClone(state));
      captured.push({
        writes1: structuredClone(writes1),
        writes2: structuredClone(writes2),
        auditId: audit?.auditId,
      });
      return writes2; // 只有第二次写集进入 Store 提交
    };
    return realTransact(refs, rerunBuild, audit);
  };
  t.after(() => { delete h.store.transact; }); // 还原为原型方法，避免影响后续断言

  const receipt = await h.retry(JOB, JOB_REV, key);

  // ① callback 恰被重跑一次（共两次调用），两次产出逐字段相同的确定性写集。
  assert.equal(captured.length, 1, "wrapper 必须恰好捕获一次重跑事件");
  const { writes1, writes2, auditId } = captured[0];
  assert.deepEqual(writes2, writes1,
    "callback 重跑两次必须产出逐字段相同的确定性写集（非确定 ID 会在此 FAIL）");
  assert.ok(Array.isArray(writes1) && writes1.length > 0, "首次 build 必须产出非空写集");

  // 写集内 log ID / op key 与测试侧独立 oracle 一致；audit ID 同理由独立 oracle 校验。
  const writeIds = writes1.map((w) => `${w.collection}/${w.id}`);
  assert.ok(writeIds.includes(`${LOGS}/${expectedLogId}`), "重跑写集 log ID 必须等于独立 oracle");
  assert.ok(writeIds.includes(`${OP_KEYS}/${expectedOpKey}`), "重跑写集 op key 必须等于独立 oracle");
  assert.equal(auditId, expectedAuditId, "重跑事务 audit ID 必须等于独立 oracle");
  assert.ok(writes1.every((w) => w.collection !== DOMAINS), "domain 已预建，成功写集 D=0");

  // ② 最终库态只有一条 job / log / audit / op key（幂等去重，无重复写）。
  assertSuccessWriteSet(h, { key }); // 内含成功写集断言 + 零网络违规断言
  assert.equal(count(h.store, JOBS), 1, "JOBS 仅 1 条（无重复 job）");
  assert.equal(count(h.store, LOGS), 1, "LOGS 仅 1 条（无重复 log）");
  assert.equal(count(h.store, OP_KEYS), 1, "OP_KEYS 仅 1 条（无重复 op key）");
  assert.equal(count(h.store, AUDIT_COLLECTION) - h.seedAuditCount, 1, "AUDIT 仅新增 1 条（无重复 audit）");

  // ②b：提交完成后 callback 再次被真实驱动（同 key 二次 retry，已卸载桩、走生产 transact）
  //     → 合法重放零写、返回原回执，进一步证明重跑幂等去重、不产生第二条核心写。
  delete h.store.transact;
  const beforeReplay = structuredClone(h.store.data);
  const replay = await h.retry(JOB, JOB_REV, key);
  assert.deepEqual(replay, receipt, "重跑提交后同键再次提交必须返回原回执");
  assertZeroWrite(h.store, beforeReplay, "重跑提交后同键再次提交必须零写（幂等去重）");

  // ③ 全库除合法写集（J+L+O+A，D=0）外内容级零变化。
  const WRITE_SET = new Set([JOBS, LOGS, OP_KEYS, AUDIT_COLLECTION, DOMAINS]);
  const rows = (v) => structuredClone(v || []);
  for (const col of new Set([...Object.keys(before), ...Object.keys(h.store.data)])) {
    if (WRITE_SET.has(col)) continue;
    assert.deepEqual(rows(h.store.data[col]), rows(before[col]),
      `非写集集合 ${col} 内容级零变化（重跑无额外写）`);
  }
  for (const [col, id] of [
    [LOGS, expectedLogId],
    [OP_KEYS, expectedOpKey],
    [AUDIT_COLLECTION, expectedAuditId],
  ]) {
    const afterRows = rows(h.store.data[col]).filter((r) => r._id !== id);
    assert.deepEqual(afterRows, rows(before[col]),
      `写集集合 ${col} 除合法写入外内容级零变化（重跑无重复写）`);
  }
  assert.deepEqual(rows(h.store.data[DOMAINS]), rows(before[DOMAINS]), "D=0：Domains 内容级零变化");
  const jobAfter = structuredClone(find(h.store, JOBS, JOB));
  const jobBefore = structuredClone(before[JOBS].find((r) => r._id === JOB));
  for (const field of ["state", "revision", "updatedAt"]) {
    delete jobAfter[field];
    delete jobBefore[field];
  }
  assert.deepEqual(jobAfter, jobBefore, "job 除 retry 合法改写字段外内容级零变化");

  // ④ 零网络 / Provider。
  assertNoNetworkViolation();
});

// ---------------------------------------------------------------------------
// C09 旧 worker fence 观察（真实 claim 交互）
// ---------------------------------------------------------------------------
test("C09：旧 worker fence 观察——真实 claim 产生 fence 后复位 retryable_failed，retry 不消费/不改 lease 三字段", async (t) => {
  // 1) 真实 claim 产生旧 fence。
  const h = await setupG3(t, { job: makeEnrollJob({ state: "queued" }) });
  const claimed = await claimDispatchJob({
    store: h.store, orgId: ORG, jobId: JOB, owner: "worker-old", now: () => NOW,
  });
  const fenceSnapshot = structuredClone(claimed.fence);
  const sentJob = find(h.store, JOBS, JOB);
  assert.equal(sentJob.state, "sending");
  assert.doesNotThrow(() => assertLeaseFence(sentJob, fenceSnapshot, NOW), "旧 fence 在 sending 期有效");

  // 2) 模拟旧 fence 失效回收：复位为可重试的 retryable_failed，lease 三字段回到基线（无活动租约）。
  putRecord(h.store, JOBS, JOB, makeEnrollJob());
  const baseline = find(h.store, JOBS, JOB);
  assert.equal(baseline.state, "retryable_failed");
  assert.equal(baseline.leaseOwner, null);
  assert.equal(baseline.leaseExpiresAt, null);
  assert.equal(baseline.leaseGeneration, 2);

  // 3) retry 成功（revision 复位到 JOB_REV）。
  await h.retry(JOB, JOB_REV, h.nextKey());
  const after = find(h.store, JOBS, JOB);
  assert.equal(after.state, "queued");

  // lease 三字段 retry 前后零改
  assert.equal(after.leaseOwner, baseline.leaseOwner, "retry 不改 leaseOwner");
  assert.equal(after.leaseExpiresAt, baseline.leaseExpiresAt, "retry 不改 leaseExpiresAt");
  assert.equal(after.leaseGeneration, baseline.leaseGeneration, "retry 不改 leaseGeneration");
  assert.equal(after.dispatchAuthorizedAt, baseline.dispatchAuthorizedAt);

  // fence 未被 retry 消费/改写
  assert.deepEqual(claimed.fence, fenceSnapshot, "fence 快照未被改写");
  assert.notEqual(after.leaseOwner, fenceSnapshot.owner, "retry 未采纳旧 fence 的 owner");
  assert.notEqual(after.leaseGeneration, fenceSnapshot.generation, "retry 未采纳旧 fence 的 generation");
  assert.throws(
    () => assertLeaseFence(after, fenceSnapshot, NOW),
    (e) => e && e.code === "LEASE_FENCE_REJECTED",
    "旧 fence 在 retry 后失效（job 回到 queued），未被 retry 消费",
  );
  // P1：本用例含真实 claim + 成功 retry，均未走 assertSuccessWriteSet，整条路径零网络违规。
  assertNoNetworkViolation();
});
