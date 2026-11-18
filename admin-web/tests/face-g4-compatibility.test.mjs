/**
 * HK-AI-07D G4 兼容与封闭审查（独立重建）
 *
 * 依据：批准任务卡 ff02f3a（G4-04 三场景澄清版）§2–§5。
 * 边界：
 *  - 只做本文件内的合成 fixture 与断言；不修改任何生产文件/既有测试；
 *  - 复用 face-g3-testkit.mjs 的 guard 与 LocalStore/fixture 基础构造（已批准）；
 *  - G4-04 三场景的旧 queued job、旧 log/audit、旧 op key 记录与断言均在本文件独立构造，
 *    不 import / 不复制 face-g3-ko.test.mjs 的 O11 用例代码；
 *  - 不启动 HTTP、不监听端口、不调用 Provider/设备/业务云/支付。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getViolations, resetRuntimeViolations, positiveControlAll, guardEntryNames,
  validateDispatchJob, validateRevokeJob,
  ORG, MEMBERSHIP, NOW,
  JOBS, LOGS, OP_KEYS, DOMAINS, AUDIT_COLLECTION,
  makeEnrollJob, makeRevokeJob,
  putRecord, find, count, digestOf, semanticKeys,
  independentOpKey,
  expectError, assertZeroWrite, assertNoNetworkViolation, assertReceiptShape,
  setupG3, operationKeyConfig,
  OPKEY_FIELDS,
} from "./face-g3-testkit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const serviceDir = join(here, "..", "lib", "face-service");
const adminDir = join(here, "..");

// 注释剥离：块注释 + 整行注释；用于静态封闭扫描（与 G1 证据口径一致）。
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// 独立 fixture：旧 requeue 遗留记录（非 O11 代码；字段来自旧行为契约）
// ---------------------------------------------------------------------------
function legacyLog(jobId, overrides = {}) {
  return {
    orgId: ORG, jobId, action: "enroll", fromState: "sending", state: "queued",
    actorType: "system", actorId: "legacy-requeue-worker", at: NOW - 60_000,
    revision: 1, attempt: 1, leaseGeneration: 1, evidenceScope: "simulated",
    errorKind: null, reasonCode: null, alertCode: null, ...overrides,
  };
}
function legacyAudit(jobId, overrides = {}) {
  return {
    orgId: ORG, actorId: "legacy-requeue-worker", actorType: "system",
    action: "H4 requeue", target: `device_operation_jobs/${jobId}`,
    createdAt: NOW - 60_000, ...overrides,
  };
}
function seedLegacy(store, jobId, tag) {
  const logId = `log-legacy-${tag}`;
  const auditId = `audit-legacy-${tag}`;
  putRecord(store, LOGS, logId, legacyLog(jobId));
  putRecord(store, AUDIT_COLLECTION, auditId, legacyAudit(jobId));
  return { logId, auditId };
}
const beforeRecord = (before, collection, id) =>
  (before[collection] || []).find((row) => row._id === id);

function assertCollectionsUnchanged(before, after, allowed) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const name of names) {
    if (allowed.has(name)) continue;
    assert.deepEqual(after[name] ?? [], before[name] ?? [],
      `集合 ${name} 必须内容/排序/计数零变化`);
  }
}

// ---------------------------------------------------------------------------
// Guard：加载前预装 + 入口覆盖 + 正控自检（不转发真实网络函数）
// ---------------------------------------------------------------------------
test("G4-GUARD：guard 预装覆盖网络入口，正控逐入口命中且不转发真实函数", async () => {
  const entries = guardEntryNames();
  assert.ok(entries.length >= 40, `guard 入口数不足：${entries.length}`);
  for (const required of [
    "net.createServer", "http.Server.prototype.listen", "https.Server.prototype.listen",
    "net.Server.prototype.listen", "globalThis.fetch", "tls.connect",
    "dgram.createSocket", "dns.lookup",
  ]) {
    assert.ok(entries.includes(required), `guard 缺少入口 ${required}`);
  }
  assert.deepEqual(getViolations().loadTime, [], "加载期网络违规必须为零");
  const results = await positiveControlAll();
  assert.equal(results.length, entries.length, "每个入口都必须有正控");
  assert.deepEqual(getViolations().runtime, [], "正控后 runtime 必须可清零");
  assertNoNetworkViolation();
  resetRuntimeViolations();
});

// ---------------------------------------------------------------------------
// G4-01：H3/H4 原型链与公共导出面无旧 requeue 入口（静态 + 运行时独立重建）
// ---------------------------------------------------------------------------
test("G4-01：H3/H4 原型链、实例与模块导出面无 requeue；源码剥离注释后无 requeue", async () => {
  const h3b = await import("../lib/face-service/h3b.mjs");
  const h4b = await import("../lib/face-service/h4b.mjs");

  for (const [mod, className, label] of [
    [h3b, "H3MockDispatcher", "H3"],
    [h4b, "H4MockRevoker", "H4"],
  ]) {
    assert.ok(!Object.keys(mod).includes("requeue"), `${label} 模块不得导出 requeue`);
    const cls = mod[className];
    assert.equal(typeof cls, "function", `${label} 类必须存在`);

    // 原型链逐级描述符（含继承链）。
    let proto = cls.prototype;
    while (proto) {
      assert.equal(Object.getOwnPropertyDescriptor(proto, "requeue"), undefined,
        `${label} 原型链不得存在 requeue`);
      proto = Object.getPrototypeOf(proto);
    }
    assert.equal(Object.getOwnPropertyDescriptor(cls.prototype, "requeue"), undefined);

    // 实例属性 + 实例上的查找结果（构造器依赖 LocalStore/Mock，故用原型实例做表面检查）。
    const instance = Object.create(cls.prototype);
    assert.ok(instance instanceof cls, `${label} 原型实例必须 instanceof`);
    assert.equal(instance.requeue, undefined, `${label} 实例不得暴露 requeue`);
    assert.equal(Object.getOwnPropertyDescriptor(instance, "requeue"), undefined);
    assert.ok(!Object.keys(instance).includes("requeue"));
  }

  // 静态封闭：lib/face-service 全部生产模块剥离注释后不得残留 requeue 标识符。
  const files = readdirSync(serviceDir).filter((name) => name.endsWith(".mjs"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = stripComments(readFileSync(join(serviceDir, file), "utf8"));
    assert.doesNotMatch(source, /\brequeue\b/i, `${file} 不得残留 requeue 可调用入口`);
  }
});

// ---------------------------------------------------------------------------
// G4-02：server 无 retry handler；routes 无旧 retry 描述；运行时负向路由匹配
// ---------------------------------------------------------------------------
test("G4-02：routes/server 无 retry 封闭面，list/reconcile 保留，路由负向匹配不命中", async () => {
  const routes = await import("../lib/face-service/routes.mjs");
  const ids = routes.FACE_ROUTES.map((route) => route.id);
  assert.ok(ids.includes("device-operation-job-list"), "list 描述必须保留");
  assert.ok(ids.includes("device-operation-job-reconcile"), "reconcile 描述必须保留");
  assert.ok(!ids.some((id) => /retry/i.test(id)), "不得存在 retry 路由 id");

  assert.equal(
    routes.matchFaceRoute("POST", "/api/v2/device-operation-jobs/job-g4-x/retry"),
    null, "retry 路径必须不匹配任何路由",
  );
  const reconcile = routes.matchFaceRoute("POST", "/api/v2/device-operation-jobs/job-g4-x/reconcile");
  assert.ok(reconcile && reconcile.route.id === "device-operation-job-reconcile");
  const list = routes.matchFaceRoute("GET", "/api/v2/device-operation-jobs");
  assert.ok(list && list.route.id === "device-operation-job-list");

  const serverSrc = stripComments(readFileSync(join(adminDir, "server.mjs"), "utf8"));
  assert.doesNotMatch(serverSrc, /device-operation-job-retry/i, "server 不得含旧 retry 描述");
  assert.doesNotMatch(serverSrc, /\bretry\b/i, "server 不得含 retry handler");
  assert.deepEqual(getViolations().runtime, [], "路由静态检查不得触发网络");
});

// ---------------------------------------------------------------------------
// G4-03：两种旧 queued 形状 + 新 key → INVALID_STATE/409，全库零写
// ---------------------------------------------------------------------------
test("G4-03：旧 enroll/revoke queued 形状 + 新 key → INVALID_STATE/409 全库零写", async (t) => {
  const enroll = makeEnrollJob({
    _id: "job-g4-old-enroll-03", state: "queued", revision: 7, attempts: 2,
    nextAttemptAt: NOW + 60_000, leaseOwner: "legacy-worker", leaseExpiresAt: NOW + 30_000,
  });
  const revoke = makeRevokeJob({
    _id: "job-g4-old-revoke-03", state: "queued", revision: 5, attempts: 1,
    nextAttemptAt: NOW + 60_000,
  });
  const h = await setupG3(t, { jobs: [enroll, revoke] });
  const legacyEnroll = seedLegacy(h.store, enroll._id, "03-enroll");
  const legacyRevoke = seedLegacy(h.store, revoke._id, "03-revoke");
  const opKeysBefore = count(h.store, OP_KEYS);
  const beforeData = structuredClone(h.store.data);

  for (const [index, job] of [enroll, revoke].entries()) {
    await expectError(h.store,
      () => h.service.retry(job._id, { expectedJobRevision: job.revision },
        { idempotencyKey: `g4-03-new-key-000${index}` }),
      "INVALID_STATE", 409);
    const current = find(h.store, JOBS, job._id);
    assert.equal(current.state, "queued", "旧 queued 状态不得被改写");
    assert.equal(current.revision, job.revision, "旧 revision 不得推进");
    assert.deepEqual(current.result, job.result, "旧 result 必须逐字段原样");
    assert.equal(current.nextAttemptAt, job.nextAttemptAt, "旧 due 语义不得被修改");
    assert.equal(current.leaseOwner, job.leaseOwner, "旧 worker lease 不得被改写");
  }
  assert.equal(count(h.store, OP_KEYS), opKeysBefore, "拒绝路径不得新增 op key");
  assert.deepEqual(find(h.store, LOGS, legacyEnroll.logId), beforeRecord(beforeData, LOGS, legacyEnroll.logId));
  assert.deepEqual(find(h.store, LOGS, legacyRevoke.logId), beforeRecord(beforeData, LOGS, legacyRevoke.logId));
});

// ---------------------------------------------------------------------------
// G4-04(a)：旧 queued job + 新 key → 拒绝先于任何 key/回执写入
// ---------------------------------------------------------------------------
test("G4-04(a)：旧 queued job + 新 key → INVALID_STATE/409，operation_keys 零新增", async (t) => {
  const enroll = makeEnrollJob({ _id: "job-g4-04a-enroll", state: "queued", revision: 6, attempts: 2 });
  const revoke = makeRevokeJob({ _id: "job-g4-04a-revoke", state: "queued", revision: 2, attempts: 1 });
  const h = await setupG3(t, { jobs: [enroll, revoke] });
  seedLegacy(h.store, enroll._id, "04a-enroll");
  seedLegacy(h.store, revoke._id, "04a-revoke");
  const opKeysBefore = structuredClone(h.store.data[OP_KEYS] ?? []);

  for (const [index, job] of [enroll, revoke].entries()) {
    const key = `g4-04a-fresh-key-${index}`;
    await expectError(h.store,
      () => h.service.retry(job._id, { expectedJobRevision: job.revision }, { idempotencyKey: key }),
      "INVALID_STATE", 409);
    const wouldBeOpKey = independentOpKey({ env: h.env, idempotencyKey: key });
    assert.equal(find(h.store, OP_KEYS, wouldBeOpKey), undefined,
      "INVALID_STATE 必须在 op key 创建之前命中");
  }
  assert.deepEqual(h.store.data[OP_KEYS] ?? [], opKeysBefore,
    "operation_keys 集合必须零新增/零变化");
});

// ---------------------------------------------------------------------------
// G4-04(b)：旧 job 再次合法失败 + 全新 key → 成功（合法写集）
// ---------------------------------------------------------------------------
test("G4-04(b)：旧 job retryable_failed + 全新 key → 成功，旧记录原样，写集精确", async (t) => {
  const job = makeEnrollJob({
    _id: "job-g4-old-failed-04b", revision: 6, attempts: 2, nextAttemptAt: NOW - 1,
  });
  const h = await setupG3(t, { jobs: [job] });
  const legacy = seedLegacy(h.store, job._id, "04b");
  const before = structuredClone(h.store.data);
  const key = "g4-04b-brand-new-key-0001";

  const receipt = await h.service.retry(job._id, { expectedJobRevision: 6 }, { idempotencyKey: key });
  assertReceiptShape(receipt, {
    jobId: job._id, revision: 7, attempts: 2, nextAttemptAt: NOW - 1,
  });

  const current = find(h.store, JOBS, job._id);
  assert.equal(current.state, "queued");
  assert.equal(current.revision, 7);
  assert.equal(current.attempts, 2);
  assert.equal(current.nextAttemptAt, NOW - 1, "enroll 保留到期原值");
  assert.ok(current.result, "enroll 保留原 result");
  assert.doesNotThrow(() => validateDispatchJob(current), "成功后必须通过原 validator");

  const opKey = independentOpKey({ env: h.env, idempotencyKey: key });
  const op = find(h.store, OP_KEYS, opKey);
  assert.ok(op, "新 key 必须创建 op key");
  assert.deepEqual(semanticKeys(op), [...OPKEY_FIELDS].sort(), "op key 精确六语义字段");
  assert.equal(op.requestDigest, digestOf({ jobId: job._id, expectedJobRevision: 6 }));
  assert.equal(op.result.revision, 7, "回执绑定 expectedJobRevision + 1");

  assert.deepEqual(find(h.store, LOGS, legacy.logId), beforeRecord(before, LOGS, legacy.logId),
    "旧 legacy log 必须原样");
  assert.deepEqual(find(h.store, AUDIT_COLLECTION, legacy.auditId),
    beforeRecord(before, AUDIT_COLLECTION, legacy.auditId), "旧 legacy audit 必须原样");
  assertCollectionsUnchanged(before, h.store.data,
    new Set([JOBS, LOGS, OP_KEYS, DOMAINS, AUDIT_COLLECTION]));
});

// ---------------------------------------------------------------------------
// G4-04(c)：严格 retry 已用 key 在请求 revision 改变后复用 → CONFLICT/409 零写
// ---------------------------------------------------------------------------
test("G4-04(c)：严格 retry 已用 key 改请求 revision 复用 → CONFLICT/409 全库零写", async (t) => {
  const job = makeEnrollJob({ _id: "job-g4-reuse-04c", revision: 4, attempts: 2 });
  const h = await setupG3(t, { jobs: [job] });
  const key = "g4-04c-strict-key-0001";

  const first = await h.service.retry(job._id, { expectedJobRevision: 4 }, { idempotencyKey: key });
  assert.equal(first.revision, 5, "首次成功必须推进到 R+1");

  const opKey = independentOpKey({ env: h.env, idempotencyKey: key });
  const created = find(h.store, OP_KEYS, opKey);
  assert.ok(created, "CONFLICT 断言前必须先证明 key 由严格 retry 创建");
  assert.equal(created.requestDigest, digestOf({ jobId: job._id, expectedJobRevision: 4 }));

  await expectError(h.store,
    () => h.service.retry(job._id, { expectedJobRevision: 5 }, { idempotencyKey: key }),
    "CONFLICT", 409);

  const current = find(h.store, JOBS, job._id);
  assert.equal(current.revision, 5, "CONFLICT 不得推进 job");
  assert.deepEqual(find(h.store, OP_KEYS, opKey), created, "原 op key/回执必须原样");
});

// ---------------------------------------------------------------------------
// G4-05：旧记录作哨兵 + 跨 method op key 隔离（不迁移/不回填/不重放）
// ---------------------------------------------------------------------------
test("G4-05：旧 log/audit 哨兵共存，跨 method op key 互不重放/互不影响", async (t) => {
  const job = makeEnrollJob({ _id: "job-g4-sentinel-05", revision: 3, attempts: 2 });
  const h = await setupG3(t, { jobs: [job] });
  const legacy = seedLegacy(h.store, job._id, "05");
  const cfg = operationKeyConfig(h.env);
  const foreignIdem = "g4-05-foreign-method-key-0001";
  const foreignOpKey = independentOpKey({
    env: h.env, idempotencyKey: foreignIdem, method: "face.operation.reconcile",
  });
  putRecord(h.store, OP_KEYS, foreignOpKey, {
    orgId: ORG, realm: cfg.realm, keyVersion: cfg.version,
    requestDigest: digestOf({ jobId: job._id, expectedJobRevision: 3 }),
    result: { jobId: job._id, state: "queued", revision: 4, attempts: 1, nextAttemptAt: NOW - 5_000 },
    createdAt: NOW,
  });
  const before = structuredClone(h.store.data);

  // 同一 Idempotency-Key，不同 K2 method：op key 必须不同，不得命中其他 method 的回执。
  const receipt = await h.service.retry(job._id, { expectedJobRevision: 3 },
    { idempotencyKey: foreignIdem });
  assert.equal(receipt.revision, 4);
  const retryOpKey = independentOpKey({ env: h.env, idempotencyKey: foreignIdem });
  assert.notEqual(retryOpKey, foreignOpKey, "跨 method 的 op key 必须不同");
  assert.ok(find(h.store, OP_KEYS, retryOpKey), "本方法必须创建自己的 op key");
  assert.deepEqual(find(h.store, OP_KEYS, foreignOpKey), beforeRecord(before, OP_KEYS, foreignOpKey),
    "其他 method 的 op key 必须原样");
  assert.equal(count(h.store, OP_KEYS), (before[OP_KEYS] || []).length + 1,
    "成功只新增本方法 1 条 op key");
  assert.deepEqual(find(h.store, LOGS, legacy.logId), beforeRecord(before, LOGS, legacy.logId));
  assert.deepEqual(find(h.store, AUDIT_COLLECTION, legacy.auditId),
    beforeRecord(before, AUDIT_COLLECTION, legacy.auditId));
  assertCollectionsUnchanged(before, h.store.data,
    new Set([JOBS, LOGS, OP_KEYS, DOMAINS, AUDIT_COLLECTION]));
});

// ---------------------------------------------------------------------------
// G4-06：两种 job 相反 queued 不变量保留，成功后通过原 validator；lease 不改写
// ---------------------------------------------------------------------------
test("G4-06：enroll/revoke 两种形状成功且通过原 validator，lease/fence 不被改写", async (t) => {
  const enroll = makeEnrollJob({
    _id: "job-g4-enroll-06", revision: 4, attempts: 2, leaseGeneration: 2,
    nextAttemptAt: NOW - 1,
  });
  const revoke = makeRevokeJob({
    _id: "job-g4-revoke-06", revision: 5, attempts: 3, leaseGeneration: 3,
    nextAttemptAt: NOW - 1,
    result: { attempt: 3, outcome: "retryable_failed", errorKind: "RETRYABLE",
      reasonCode: "PRIOR_RETRYABLE", finishedAt: NOW - 10_000 },
  });
  const h = await setupG3(t, { jobs: [enroll, revoke] });

  await h.service.retry(enroll._id, { expectedJobRevision: 4 }, { idempotencyKey: "g4-06-enroll-key-0001" });
  const enrollAfter = find(h.store, JOBS, enroll._id);
  assert.equal(enrollAfter.state, "queued");
  assert.equal(enrollAfter.nextAttemptAt, NOW - 1, "enroll 保留 due");
  assert.ok(enrollAfter.result, "enroll 保留 result");
  assert.equal(enrollAfter.leaseGeneration, 2, "leaseGeneration 不被 retry 改写");
  assert.equal(enrollAfter.leaseOwner, null);
  assert.doesNotThrow(() => validateDispatchJob(enrollAfter));

  await h.service.retry(revoke._id, { expectedJobRevision: 5 }, { idempotencyKey: "g4-06-revoke-key-0001" });
  const revokeAfter = find(h.store, JOBS, revoke._id);
  assert.equal(revokeAfter.state, "queued");
  assert.equal(revokeAfter.nextAttemptAt, null, "revoke 清空 due");
  assert.equal(revokeAfter.result, null, "revoke 清空 result");
  assert.equal(revokeAfter.cleanupPhase, "dispatch");
  assert.equal(revokeAfter.leaseGeneration, 3, "leaseGeneration 不被 retry 改写");
  assert.doesNotThrow(() => validateRevokeJob(revokeAfter));
});

// ---------------------------------------------------------------------------
// G4-07：合法重放/ack loss 零写；权限撤销与损坏回执仍 fail-closed
// ---------------------------------------------------------------------------
test("G4-07：同键重放与 ack loss 零写返回同回执；撤销权限/损坏回执 fail-closed", async (t) => {
  const job = makeEnrollJob({ _id: "job-g4-replay-07", revision: 4, attempts: 2 });
  const h = await setupG3(t, { jobs: [job] });
  const key = "g4-07-replay-key-0001";

  const first = await h.service.retry(job._id, { expectedJobRevision: 4 }, { idempotencyKey: key });
  const afterFirst = structuredClone(h.store.data);
  const replay = await h.service.retry(job._id, { expectedJobRevision: 4 }, { idempotencyKey: key });
  assert.deepEqual(replay, first, "ack loss 重放必须返回同一回执");
  assertZeroWrite(h.store, afterFirst);

  const advanced = find(h.store, JOBS, job._id);
  assert.equal(advanced.revision, 5, "job 已推进后的快照语义稳定");
  assert.equal(advanced.state, "queued");

  // 权限撤销：成员 suspended 后，即使 key/回执存在也必须 FORBIDDEN，不得回放成功。
  const member = find(h.store, "org_memberships", MEMBERSHIP);
  putRecord(h.store, "org_memberships", MEMBERSHIP, { ...member, status: "suspended" });
  await expectError(h.store,
    () => h.service.retry(job._id, { expectedJobRevision: 4 }, { idempotencyKey: key }),
    "FORBIDDEN", 403);
  putRecord(h.store, "org_memberships", MEMBERSHIP, { ...member, status: "active" });

  // 损坏回执：op key.result 多出字段 → 严格重放必须 CONFLICT/409 零写。
  const opKey = independentOpKey({ env: h.env, idempotencyKey: key });
  const op = find(h.store, OP_KEYS, opKey);
  putRecord(h.store, OP_KEYS, opKey, { ...op, result: { ...op.result, tampered: true } });
  await expectError(h.store,
    () => h.service.retry(job._id, { expectedJobRevision: 4 }, { idempotencyKey: key }),
    "CONFLICT", 409);
});
