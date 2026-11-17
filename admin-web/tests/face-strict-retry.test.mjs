/**
 * HK-AI-07D G2「严格人工 retry 服务」服务层契约测试。
 *
 * 权威依据：
 *  - admin-web/lib/face-service/retry.mjs（被测模块，StrictRetryService）
 *  - docs/tasks/HK-AI-07D-G2-STRICT-RETRY-TASK-2026-11-16.md §2 冻结契约 10 条 / §3 LC01–LC10
 *  - docs/tasks/HK-AI-07D-RETRY-REQUEUE-DESIGN-2026-11-15.md §4.1–§4.10 / §5 / 附录 A
 *
 * 全部使用合成 fixture（无真实人员/设备/组织/凭据/AppID/商户号/密钥）。
 * 每个失败分支使用全库 structuredClone 前后 content-level deepEqual 证明零写。
 * 探针/自检均实际触发并验证 +1，且精确恢复原函数身份，避免嵌套污染。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";

import { LocalStore } from "../lib/store.mjs";
import {
  COLLECTIONS,
  operationKey,
  operationKeyConfig,
  operationKeyDomainIds,
  operationKeyFingerprint,
  applyOperationKeyDomain,
  deterministicLogId,
} from "../lib/face-service/collections.mjs";
import { validateDispatchJob } from "../lib/face-service/h3a.mjs";
import { validateRevokeJob } from "../lib/face-service/h4b.mjs";
import { StrictRetryService } from "../lib/face-service/retry.mjs";
import * as retryModule from "../lib/face-service/retry.mjs";

// ---------------------------------------------------------------------------
// 合成 fixture 常量（全部虚构，不含任何真实标识）
// ---------------------------------------------------------------------------
const ORG = "org-g2-synthetic";
const ORG_OTHER = "org-g2-other";
const MEMBERSHIP = "mem-g2-synthetic";
const MEMBERSHIP_B = "mem-g2-other-actor";
const ACTOR = "user-g2-actor";
const ACTOR_B = "user-g2-actor-b";
const PERSON = "person-g2-synthetic";
const IDENTITY = "identity-g2-synthetic";
const OCC = "occ-g2-synthetic";
const CYCLE = "cycle-g2-synthetic";
const GRANT = "grant-g2-synthetic";
const CREDENTIAL = "cred-g2-synthetic";
const FILE = "file-g2-synthetic";
const DEVICE = "device-g2-synthetic";
const CLAIM = "claim-g2-synthetic";
const SLOT = "slot-g2-synthetic";

const NOW = 1_700_000_000_000;
const JOB = "job-g2-enroll";
const JOB_REV = 4;
const RETRY_PERMISSION = "device.operation.retry";
const REQ_METHOD = "face.operation.retry";
const AUDIT_ACTION = "HK-AI-07D retry";

const K2_ENV = Object.freeze({
  OPERATION_KEY_HMAC_KEY_B64: Buffer.alloc(32, 9).toString("base64"),
  OPERATION_KEY_VERSION: "1",
  OPERATION_KEY_REALM: "g2-realm",
});
const K2_ENV_B = Object.freeze({
  ...K2_ENV,
  OPERATION_KEY_HMAC_KEY_B64: Buffer.alloc(32, 11).toString("base64"),
});
const K2_CONFIG = operationKeyConfig(K2_ENV);
const DOMAIN_IDS = operationKeyDomainIds(K2_CONFIG.realm);
const DOMAIN_VERSION_ID = `${DOMAIN_IDS.versionIdPrefix}${K2_CONFIG.version}`;

const SEED_AUDIT = { actor: "g2-seed", actorId: "g2-seed", action: "seed" };
const AUDIT_COLLECTION = "admin_audit";
const JOBS = COLLECTIONS.DEVICE_OPERATION_JOBS;
const LOGS = COLLECTIONS.DEVICE_OPERATION_LOGS;
const OP_KEYS = COLLECTIONS.OPERATION_KEYS;
const DOMAINS = COLLECTIONS.OPERATION_KEY_DOMAINS;

const here = dirname(fileURLToPath(import.meta.url));

// 与 retry.mjs 内 digestOf 同源（stable：key 递归升序、数组保序、去 undefined）。
const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]))
      : value;
const digestOf = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

const ref = (collection, id) => ({ collection, id });
const find = (store, collection, id) => (store.data[collection] || []).find((r) => r._id === id);
const count = (store, collection) => (store.data[collection] || []).length;

function putRecord(store, collection, id, data) {
  const rows = (store.data[collection] ||= []);
  const record = { ...data, _id: id, updatedAt: NOW };
  const index = rows.findIndex((r) => r._id === id);
  if (index < 0) rows.push(record);
  else rows[index] = record;
  return record;
}
function removeRecord(store, collection, id) {
  const rows = store.data[collection] || [];
  const index = rows.findIndex((r) => r._id === id);
  if (index >= 0) rows.splice(index, 1);
}

// op key / log / audit ID 派生（仅测试侧独立计算，用于定位写集，不复制被测逻辑的校验）
function opContextFor({ env = K2_ENV, idempotencyKey, orgId = ORG, actorId = ACTOR } = {}) {
  const config = operationKeyConfig(env);
  const opKey = operationKey({
    orgId, method: REQ_METHOD, actorType: "user", actorId, idempotencyKey, config,
  });
  const { headId, versionIdPrefix } = operationKeyDomainIds(config.realm);
  return {
    config, opKey, headId, versionId: `${versionIdPrefix}${config.version}`,
    fingerprint: operationKeyFingerprint(config),
  };
}
const auditIdFor = (opKey, { orgId = ORG, jobId = JOB } = {}) =>
  `audit-07d-v1:${digestOf(["HK-AI-07D/retry-audit", "v1", orgId, jobId, opKey]).slice(0, 32)}`;

// 合法存量 audit fixture：必须精确含 §4.9.3 六个语义字段（_id/updatedAt 由 Store/putRecord 注入），
// 否则新实现的 audit 白名单会失败关闭。
const auditFixture = (opKey, overrides = {}) => ({
  orgId: ORG, actorId: ACTOR, actorType: "user", action: AUDIT_ACTION,
  target: `device_operation_jobs/${JOB}, operation_keys/${opKey}`, createdAt: NOW,
  ...overrides,
});

// ---------------------------------------------------------------------------
// job fixtures（可被 validateDispatchJob / validateRevokeJob 正面接受）
// ---------------------------------------------------------------------------
function makeDispatchSnapshot(overrides = {}) {
  const witness = (collection, id) => ({
    collection, id, present: true, revision: 1, epoch: null, keyVersion: null,
  });
  const versions = [
    witness("organizations", ORG),
    witness("org_memberships", MEMBERSHIP),
    witness("persons", PERSON),
    witness("identity_applications", IDENTITY),
    witness("occupancies", OCC),
    witness("occupancy_cycles", CYCLE),
    witness("device_access_grants", GRANT),
    witness("face_credentials", CREDENTIAL),
    witness("file_assets", FILE),
    witness("access_devices", DEVICE),
    witness("device_claims", CLAIM),
    witness("grant_slot_claims", SLOT),
    witness("device_digest_domains", DOMAIN_IDS.headId),
    witness("device_digest_domains", DOMAIN_VERSION_ID),
  ];
  return {
    schemaVersion: 1,
    createdAt: 1,
    creatorActorId: ACTOR,
    membershipId: MEMBERSHIP,
    identityApplicationId: IDENTITY,
    personId: PERSON,
    occupancyId: OCC,
    cycleId: CYCLE,
    fileId: FILE,
    claimId: CLAIM,
    slotId: SLOT,
    domainHeadId: DOMAIN_IDS.headId,
    domainVersionId: DOMAIN_VERSION_ID,
    restriction: "occupancy.activate",
    versions,
    ...overrides,
  };
}

function makeEnrollJob(overrides = {}) {
  const job = {
    _id: JOB,
    orgId: ORG,
    revision: JOB_REV,
    credentialId: CREDENTIAL,
    grantId: GRANT,
    deviceId: DEVICE,
    action: "enroll",
    state: "retryable_failed",
    executionMode: "test",
    provider: "mock",
    evidenceScope: "simulated",
    dispatchSnapshot: makeDispatchSnapshot(),
    attempts: 2,
    leaseGeneration: 2,
    leaseOwner: null,
    leaseExpiresAt: null,
    dispatchAuthorizedAt: null,
    nextAttemptAt: NOW - 5_000,
    result: { attempt: 2, outcome: "retryable_failed", errorKind: "RETRYABLE",
      reasonCode: "PRIOR_RETRYABLE", finishedAt: NOW - 10_000 },
    createdAt: 1,
    updatedAt: 1,
  };
  return { ...job, ...overrides };
}

function makeRevokeJob(overrides = {}) {
  const job = {
    _id: JOB,
    orgId: ORG,
    revision: JOB_REV,
    credentialId: CREDENTIAL,
    grantId: GRANT,
    deviceId: DEVICE,
    action: "revoke",
    state: "retryable_failed",
    executionMode: "test",
    provider: "mock",
    evidenceScope: "simulated",
    attempts: 1,
    leaseGeneration: 1,
    leaseOwner: null,
    leaseExpiresAt: null,
    dispatchAuthorizedAt: null,
    nextAttemptAt: NOW - 5_000,
    result: { attempt: 1, outcome: "retryable_failed", errorKind: "RETRYABLE",
      reasonCode: "PRIOR_RETRYABLE", finishedAt: NOW - 10_000 },
    cleanupPhase: "dispatch",
    providerOutcome: null,
    finalizeAttempts: 0,
    cleanupSnapshot: {
      schemaVersion: 1,
      grantId: GRANT,
      grantRevision: 1,
      credentialId: CREDENTIAL,
      credentialRevision: 1,
      deviceId: DEVICE,
      deviceRevision: 1,
      claimId: CLAIM,
      claimRevision: 1,
      slotId: SLOT,
      slotRevision: 1,
      releaseGuardId: "guard-g2-synthetic",
      releaseGuardRevision: 1,
      releaseGuardEpoch: 1,
      originalGrantState: "effective",
      createdAt: 1,
    },
    createdAt: 1,
    updatedAt: 1,
  };
  return { ...job, ...overrides };
}

// ---------------------------------------------------------------------------
// setup / 断言工具
// ---------------------------------------------------------------------------
async function setup(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "g2-retry-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  const env = options.env ?? { ...K2_ENV };
  const now = options.now ?? NOW;
  const jobs = options.jobs ?? [options.job ?? makeEnrollJob()];

  const writes = [
    { collection: "organizations", id: ORG, data: {
      name: "合成组织", status: "active", revision: 1, ...(options.orgOverrides ?? {}),
    } },
    { collection: "org_memberships", id: MEMBERSHIP, data: {
      orgId: ORG, status: "active", role: "admin", principalType: "adminAccount",
      principalId: ACTOR, permissions: [RETRY_PERMISSION, "device.audit.read"], revision: 1,
      ...(options.memberOverrides ?? {}),
    } },
    ...jobs.map((j) => ({ collection: JOBS, id: j._id, data: j })),
    ...(options.extra ?? []),
  ];
  if (options.withDomains !== false) {
    try {
      const config = operationKeyConfig(env);
      writes.push(...applyOperationKeyDomain({}, {
        realm: config.realm, version: config.version,
        fingerprint: operationKeyFingerprint(config), now,
      }));
    } catch {
      // 非法 env：不预建 domain，交由被测服务返回 NOT_CONFIGURED。
    }
  }
  const unique = [...new Map(writes.map((w) => [`${w.collection}/${w.id}`, w])).values()];
  await store.transact(unique.map((w) => ref(w.collection, w.id)), () => unique, SEED_AUDIT);

  const service = new StrictRetryService({
    store, orgId: ORG,
    actor: { actorId: ACTOR, membershipId: MEMBERSHIP, actorType: options.actorType ?? "user" },
    now: () => now,
    env,
  });
  let seq = 0;
  return {
    store, service, env, now, jobs,
    seedAuditCount: count(store, AUDIT_COLLECTION),
    nextKey: () => `g2-idem-key-${String(++seq).padStart(8, "0")}`,
    retry: (jobId = JOB, expectedJobRevision = JOB_REV, key) =>
      service.retry(jobId, { expectedJobRevision }, { idempotencyKey: key ?? `g2-idem-key-${String(++seq).padStart(8, "0")}` }),
  };
}

const SENSITIVE_TOKENS = [ORG, ORG_OTHER, MEMBERSHIP, MEMBERSHIP_B, ACTOR, ACTOR_B, JOB];
function assertSafeError(err) {
  assert.ok(err instanceof Error, "失败必须是 Error");
  assert.ok(typeof err.code === "string" && err.code, "失败必须携带冻结错误码");
  // §4.10：DOMAIN_* 必须携带 409 映射；E07 边界负责补齐，收紧断言防止同类缺陷漏检。
  if (err.code === "DOMAIN_INCOMPLETE" || err.code === "DOMAIN_MISMATCH")
    assert.equal(err.status, 409, `${err.code} 必须携带 status=409`);
  if (err.status !== undefined)
    assert.ok(err.status >= 400 && err.status <= 503, "失败状态必须是既有 HTTP 映射");
  const message = String(err.message);
  for (const token of SENSITIVE_TOKENS)
    assert.ok(!message.includes(token), `错误消息不得包含合成标识 ${token}`);
  assert.ok(!/\bat\s+\S+\s*\(/.test(message), "错误消息不得包含 stack 帧");
}

async function expectError(action, code, status) {
  await assert.rejects(action, (err) => {
    assertSafeError(err);
    assert.equal(err.code, code, `期望错误码 ${code}，实际 ${err.code}`);
    if (status !== undefined && err.status !== undefined) assert.equal(err.status, status);
    return true;
  });
}

// 零写：全库 structuredClone 内容级前后对比（非引用比较）。
async function expectErrorZeroWrite(store, action, code, status) {
  const before = structuredClone(store.data);
  await expectError(action, code, status);
  const after = structuredClone(store.data);
  assert.deepEqual(after, before, "零写分支必须全库内容级不变（含 log/audit/op key/domain/计数/排序）");
}

function assertReceiptShape(receipt, { jobId = JOB, revision = JOB_REV + 1, attempts = 2, nextAttemptAt = NOW - 5_000 } = {}) {
  assert.ok(receipt && typeof receipt === "object" && !Array.isArray(receipt));
  assert.deepEqual(Object.keys(receipt).sort(), ["attempts", "jobId", "nextAttemptAt", "revision", "state"]);
  assert.equal(receipt.jobId, jobId);
  assert.equal(receipt.state, "queued");
  assert.equal(receipt.revision, revision);
  assert.equal(receipt.attempts, attempts);
  assert.equal(receipt.nextAttemptAt, nextAttemptAt);
}

const LOG_FIELDS = [
  "orgId", "jobId", "action", "fromState", "state", "actorType", "actorId", "at",
  "revision", "attempt", "leaseGeneration", "evidenceScope", "errorKind", "reasonCode", "alertCode",
];
const OPKEY_FIELDS = ["orgId", "realm", "keyVersion", "requestDigest", "result", "createdAt"];
const semanticKeys = (record) => Object.keys(record).filter((k) => k !== "_id" && k !== "updatedAt").sort();

function assertSuccessWriteSet(h, { jobId = JOB, revision = JOB_REV + 1, key, enroll = true,
  expectedAttempts = 2, expectedNextAttemptAt = NOW - 5_000 } = {}) {
  const ctx = opContextFor({ env: h.env, idempotencyKey: key });

  // job
  const job = find(h.store, JOBS, jobId);
  assert.ok(job, "job 必须存在");
  assert.equal(job.state, "queued");
  assert.equal(job.revision, revision);
  assert.equal(job.attempts, expectedAttempts, "attempts 不增");
  assert.equal(job.leaseOwner, null);
  assert.equal(job.leaseExpiresAt, null);
  assert.equal(job.dispatchAuthorizedAt, null);
  if (enroll) {
    assert.equal(job.nextAttemptAt, expectedNextAttemptAt, "enroll 保留到期原值");
    assert.ok(job.result && job.result.outcome === "retryable_failed", "enroll 保留原 result");
    assert.doesNotThrow(() => validateDispatchJob(job), "改写后的 enroll job 必须通过 validateDispatchJob");
  } else {
    assert.equal(job.nextAttemptAt, null, "revoke 清空 nextAttemptAt");
    assert.equal(job.result, null, "revoke 清空 result");
    assert.equal(job.cleanupPhase, "dispatch");
    assert.doesNotThrow(() => validateRevokeJob(job), "改写后的 revoke job 必须通过 validateRevokeJob");
  }

  // log：15 语义字段 + Store 注入元数据
  const logId = deterministicLogId(jobId, "queued", revision);
  const log = find(h.store, LOGS, logId);
  assert.ok(log, "log 必须存在");
  assert.deepEqual(semanticKeys(log), [...LOG_FIELDS].sort(), "log 精确 15 语义字段");
  assert.equal(log.jobId, jobId);
  assert.equal(log.fromState, "retryable_failed");
  assert.equal(log.state, "queued");
  assert.equal(log.actorType, "user");
  assert.equal(log.actorId, ACTOR);
  assert.equal(log.revision, revision);
  assert.equal(log.attempt, expectedAttempts);
  assert.equal(log.errorKind, null);
  assert.equal(log.reasonCode, null);
  assert.equal(log.alertCode, null);
  assert.equal(log.evidenceScope, "simulated");

  // op key：精确六字段 + result 五字段
  const op = find(h.store, OP_KEYS, ctx.opKey);
  assert.ok(op, "op key 必须存在");
  assert.deepEqual(semanticKeys(op), [...OPKEY_FIELDS].sort(), "op key 精确六语义字段");
  assert.equal(op.orgId, ORG);
  assert.equal(op.realm, ctx.config.realm);
  assert.equal(op.keyVersion, ctx.config.version);
  assert.equal(op.requestDigest, digestOf({ jobId, expectedJobRevision: revision - 1 }));
  assert.equal(op.createdAt, h.now);
  assertReceiptShape(op.result, { jobId, revision, attempts: expectedAttempts, nextAttemptAt: expectedNextAttemptAt });

  // audit：新命名空间、固定 action、恰好 1 条
  const auditId = auditIdFor(ctx.opKey, { jobId });
  const audit = find(h.store, AUDIT_COLLECTION, auditId);
  assert.ok(audit, "新命名空间 audit 必须存在");
  assert.equal(audit.action, AUDIT_ACTION);
  assert.equal(audit.orgId, ORG);
  assert.equal(audit.actorId, ACTOR);
  assert.equal(audit.actorType, "user");
  assert.equal(count(h.store, AUDIT_COLLECTION) - h.seedAuditCount, 1, "成功只新增 1 条 audit");
  assert.ok(!JSON.stringify(audit).includes(key), "audit 不得含原始 Idempotency-Key");
  assert.ok(!JSON.stringify(audit).includes(op.requestDigest), "audit 不得含 requestDigest 原值");
}

// ---------------------------------------------------------------------------
// G2-LC01 方法与导出面
// ---------------------------------------------------------------------------
test("LC01：StrictRetryService.retry 存在且命名正确；无 requeue 别名/转发/隐藏开关；源码不引用旧入口", async (t) => {
  assert.equal(typeof StrictRetryService, "function");
  assert.equal(retryModule.default, StrictRetryService, "默认导出必须指向同一类");
  assert.equal(Object.prototype.hasOwnProperty.call(retryModule, "retry"), false, "模块不得导出独立 retry 别名");
  for (const key of Object.keys(retryModule))
    assert.ok(!/requeue/i.test(key), `retry 模块不得导出 requeue 别名：${key}`);

  const h = await setup(t);
  assert.equal(typeof h.service.retry, "function", "实例必须暴露 retry 方法");
  let depth = 0;
  for (let proto = h.service; proto; proto = Object.getPrototypeOf(proto)) {
    assert.equal(Object.getOwnPropertyDescriptor(proto, "requeue"), undefined,
      `原型链第 ${depth} 层不得存在 requeue`);
    depth += 1;
  }
  assert.ok(depth >= 2, "原型链检查必须至少覆盖实例与类原型");

  const source = await readFile(join(here, "..", "lib", "face-service", "retry.mjs"), "utf8");
  assert.doesNotMatch(source, /\brequeue\b/, "retry.mjs 不得残留 requeue 标识符");
  assert.doesNotMatch(source, /_requeue/, "retry.mjs 不得改名保留旧入口");
  assert.doesNotMatch(source, /H3MockDispatcher|H4MockRevoker/, "retry.mjs 不得引用旧 requeue 实现类");
  assert.match(source, /validateDispatchJob/, "必须复用 h3a validator");
  assert.match(source, /validateRevokeJob/, "必须复用 h4b validator");
  assert.doesNotMatch(source, /from ["'].*routes\.mjs|from ["'].*server\.mjs/, "服务模块不得注册 HTTP");

  const before = structuredClone(h.store.data);
  assert.equal(h.service.requeue, undefined);
  assert.deepEqual(structuredClone(h.store.data), before);
});

// ---------------------------------------------------------------------------
// G2-LC02 唯一合法前置（§4.1 九条逐条不成立 → 零写 + 冻结错误码）
// ---------------------------------------------------------------------------
test("LC02：§4.1 九条前置逐条证伪，每条独立零写且返回冻结码", async (t) => {
  const cases = [
    {
      name: "1 state≠retryable_failed",
      opts: { job: makeEnrollJob({ state: "sending" }) },
      code: "INVALID_STATE", status: 409,
    },
    {
      name: "2 action 非法（非可派发阶段）",
      opts: { job: makeEnrollJob({ action: "bogus" }) },
      code: "INVALID_JOB", status: 409,
    },
    {
      name: "3 result.outcome 非 retryable_failed",
      opts: { job: makeEnrollJob({ result: { attempt: 2, outcome: "succeeded", errorKind: "RETRYABLE", reasonCode: "X", finishedAt: NOW - 10_000 } }) },
      code: "INVALID_JOB", status: 409,
    },
    {
      name: "3b result 多字段",
      opts: { job: makeEnrollJob({ result: { attempt: 2, outcome: "retryable_failed", errorKind: "RETRYABLE", reasonCode: "X", finishedAt: NOW - 10_000, extra: 1 } }) },
      code: "INVALID_JOB", status: 409,
    },
    {
      name: "4 attempts=4 越界",
      opts: { job: makeEnrollJob({ attempts: 4, leaseGeneration: 4, result: { attempt: 4, outcome: "retryable_failed", errorKind: "RETRYABLE", reasonCode: "X", finishedAt: NOW - 10_000 } }) },
      code: "INVALID_JOB", status: 409,
    },
    {
      name: "5 nextAttemptAt 未到期",
      opts: { job: makeEnrollJob({ nextAttemptAt: NOW + 100_000 }) },
      code: "RETRY_NOT_DUE", status: 409,
    },
    {
      name: "6 lease 字段非 null",
      opts: { job: makeEnrollJob({ leaseOwner: "lease-g2" }) },
      code: "INVALID_JOB", status: 409,
    },
    {
      name: "7 expectedJobRevision≠job.revision",
      opts: {}, wrongRevision: JOB_REV + 1,
      code: "REVISION_CONFLICT", status: 409,
    },
    {
      name: "8 缺 device.operation.retry 权限",
      opts: { memberOverrides: { permissions: ["device.audit.read"] } },
      code: "FORBIDDEN", status: 403,
    },
    {
      name: "9 K2 重放命中异摘要（预置不同 digest 的 op key）",
      opts: {}, corrupt: "digest",
      code: "CONFLICT", status: 409,
    },
  ];

  for (const c of cases) {
    await t.test(c.name, async (st) => {
      const h = await setup(st, c.opts);
      const key = h.nextKey();
      if (c.corrupt === "digest") {
        const ctx = opContextFor({ env: h.env, idempotencyKey: key });
        putRecord(h.store, OP_KEYS, ctx.opKey, {
          orgId: ORG, realm: ctx.config.realm, keyVersion: ctx.config.version,
          requestDigest: digestOf({ jobId: JOB, expectedJobRevision: JOB_REV + 99 }),
          result: { jobId: JOB, state: "queued", revision: JOB_REV + 1, attempts: 2, nextAttemptAt: NOW - 5_000 },
          createdAt: NOW,
        });
        putRecord(h.store, AUDIT_COLLECTION, auditIdFor(ctx.opKey), auditFixture(ctx.opKey));
      }
      await expectErrorZeroWrite(
        h.store,
        () => h.retry(JOB, c.wrongRevision ?? JOB_REV, key),
        c.code, c.status,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// G2-LC03 逐状态拒绝（§4.2 全部行）
// ---------------------------------------------------------------------------
test("LC03：§4.2 逐状态/情形返回冻结码，状态门禁先于 validator，错误消息固定", async (t) => {
  const rows = [
    { name: "queued→INVALID_STATE", job: makeEnrollJob({ state: "queued", nextAttemptAt: null, result: null }), code: "INVALID_STATE" },
    { name: "sending→INVALID_STATE（lease 零改）", job: makeEnrollJob({ state: "sending", leaseOwner: "owner", leaseExpiresAt: NOW + 9_000, nextAttemptAt: null, result: null }), code: "INVALID_STATE" },
    { name: "awaiting_result→INVALID_JOB", job: makeEnrollJob({ state: "awaiting_result", nextAttemptAt: null, result: { attempt: 2, outcome: "awaiting_result", errorKind: null, reasonCode: null, finishedAt: NOW - 10_000 } }), code: "INVALID_JOB" },
    { name: "succeeded→INVALID_STATE", job: makeEnrollJob({ state: "succeeded", nextAttemptAt: null, result: { attempt: 2, outcome: "succeeded", errorKind: null, reasonCode: null, finishedAt: NOW - 10_000 } }), code: "INVALID_STATE" },
    { name: "terminal_failed→INVALID_STATE", job: makeEnrollJob({ state: "terminal_failed", nextAttemptAt: null, result: { attempt: 2, outcome: "terminal_failed", errorKind: "RETRY_EXHAUSTED", reasonCode: null, finishedAt: NOW - 10_000 } }), code: "INVALID_STATE" },
    { name: "cancelled(enroll)→INVALID_STATE", job: makeEnrollJob({ state: "cancelled", nextAttemptAt: null, result: null }), code: "INVALID_STATE" },
    { name: "cancelled(revoke)→INVALID_STATE（状态门禁先于 validator）", job: makeRevokeJob({ state: "cancelled", nextAttemptAt: null, result: null, cleanupPhase: "finalize", providerOutcome: "confirmed_removed", finalizeAttempts: 1 }), code: "INVALID_STATE" },
    { name: "revoke finalize 阶段→INVALID_STATE", job: makeRevokeJob({ cleanupPhase: "finalize", providerOutcome: "confirmed_removed", finalizeAttempts: 1 }), code: "INVALID_STATE" },
    { name: "errorKind=UNKNOWN_RESULT→INVALID_JOB", job: makeEnrollJob({ result: { attempt: 2, outcome: "retryable_failed", errorKind: "UNKNOWN_RESULT", reasonCode: null, finishedAt: NOW - 10_000 } }), code: "INVALID_JOB" },
    { name: "errorKind=LOCAL_FINALIZE→INVALID_JOB", job: makeEnrollJob({ result: { attempt: 2, outcome: "retryable_failed", errorKind: "LOCAL_FINALIZE", reasonCode: null, finishedAt: NOW - 10_000 } }), code: "INVALID_JOB" },
    { name: "attempts=0→INVALID_JOB", job: makeEnrollJob({ attempts: 0, leaseGeneration: 0, result: { attempt: 0, outcome: "retryable_failed", errorKind: "RETRYABLE", reasonCode: null, finishedAt: NOW - 10_000 } }), code: "INVALID_JOB" },
    { name: "未知状态→INVALID_JOB", job: makeEnrollJob({ state: "mystery" }), code: "INVALID_JOB" },
  ];

  for (const row of rows) {
    await t.test(row.name, async (st) => {
      const h = await setup(st, { job: row.job });
      await expectErrorZeroWrite(h.store, () => h.retry(), row.code, 409);
    });
  }

  // queued/sending 等状态下 lease 三字段必须零改（内容级）
  await t.test("sending 被拒后 lease 三字段与全库零改", async (st) => {
    const h = await setup(st, { job: makeEnrollJob({ state: "sending", leaseOwner: "owner", leaseExpiresAt: NOW + 9_000, dispatchAuthorizedAt: NOW - 1, nextAttemptAt: null, result: null }) });
    const before = structuredClone(h.store.data);
    await expectError(() => h.retry(), "INVALID_STATE", 409);
    assert.deepEqual(structuredClone(h.store.data), before);
  });
});

// ---------------------------------------------------------------------------
// G2-LC04 两种 job 写集（enroll 保留 / revoke 清空）
// ---------------------------------------------------------------------------
test("LC04：enroll 写集保留 result/nextAttemptAt，且改写后通过 validateDispatchJob", async (t) => {
  const h = await setup(t, { withDomains: true });
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  assertReceiptShape(receipt);
  const jobBefore = find(h.store, JOBS, JOB);
  assertSuccessWriteSet(h, { key });
  // 正面证明：保留字段内容逐字段等于重试前
  assert.equal(jobBefore.result.attempt, 2);
  assert.equal(find(h.store, JOBS, JOB).result.outcome, "retryable_failed");
  assert.equal(find(h.store, JOBS, JOB).nextAttemptAt, NOW - 5_000);
});

test("LC04：revoke 写集清空 result/nextAttemptAt，且改写后通过 validateRevokeJob", async (t) => {
  const h = await setup(t, { job: makeRevokeJob(), withDomains: true });
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  assertReceiptShape(receipt, { attempts: 1, nextAttemptAt: null });
  assertSuccessWriteSet(h, { key, enroll: false, expectedAttempts: 1, expectedNextAttemptAt: null });
});

// ---------------------------------------------------------------------------
// G2-LC05 K2 / domain / 严格重放全表
// ---------------------------------------------------------------------------
test("LC05：独立 method 分段 + op key 六字段 + requestDigest 仅两字段（不受 reason/时间影响）", async (t) => {
  const h = await setup(t);
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  const ctx = opContextFor({ env: h.env, idempotencyKey: key });
  const methodSegment = Buffer.from(REQ_METHOD, "utf8").toString("base64url");
  assert.ok(ctx.opKey.includes(`:${methodSegment}:`), "op key 必须含 face.operation.retry 分段");
  assert.notEqual(ctx.opKey, operationKey({
    orgId: ORG, method: "face.submit", actorType: "user", actorId: ACTOR,
    idempotencyKey: key, config: ctx.config,
  }), "不同 method 的 op key 必须不同");

  const op = find(h.store, OP_KEYS, ctx.opKey);
  assert.deepEqual(semanticKeys(op), [...OPKEY_FIELDS].sort());
  assert.equal(op.requestDigest, digestOf({ jobId: JOB, expectedJobRevision: JOB_REV }));
  assert.notEqual(op.requestDigest, digestOf({ jobId: JOB, expectedJobRevision: JOB_REV, reason: "r" }));
  assert.notEqual(op.requestDigest, digestOf({ jobId: JOB, expectedJobRevision: JOB_REV, now: NOW }));
  assertReceiptShape(receipt);

  // 行为证明：同 key + 不同注入时钟 → 仍命中合法重放、零写、返回原快照（时间不进入摘要）。
  // 注意：实现已按 §4.3 对 DTO 额外字段改为 PARAM_ERROR，故不能再借“多传字段”证明摘要稳定性；
  // 这里改用不同可信时钟 + 直接比对 requestDigest 与含 reason/now 的变体摘要来证伪。
  const serviceLater = new StrictRetryService({
    store: h.store, orgId: ORG,
    actor: { actorId: ACTOR, membershipId: MEMBERSHIP, actorType: "user" },
    now: () => NOW + 60_000, env: h.env,
  });
  const before = structuredClone(h.store.data);
  const replay = await serviceLater.retry(JOB, { expectedJobRevision: JOB_REV }, { idempotencyKey: key });
  assert.deepEqual(replay, receipt, "不同注入时间不得影响摘要，必须返回原五字段回执");
  assert.deepEqual(structuredClone(h.store.data), before, "合法重放零写");
});

test("LC05：actorType≠user → FORBIDDEN", async (t) => {
  const h = await setup(t, { actorType: "system" });
  await expectErrorZeroWrite(h.store, () => h.retry(), "FORBIDDEN", 403);
});

test("LC05：domain 全缺写两条、完整写零条", async (t) => {
  await t.test("全缺→写 head+version 两条", async (st) => {
    const h = await setup(st, { withDomains: false });
    assert.equal(count(h.store, DOMAINS), 0);
    const key = h.nextKey();
    await h.retry();
    assert.equal(count(h.store, DOMAINS), 2);
    const ctx = opContextFor({ env: h.env, idempotencyKey: key });
    assert.ok(find(h.store, DOMAINS, ctx.headId), "head 记录必须存在");
    assert.ok(find(h.store, DOMAINS, ctx.versionId), "version 记录必须存在");
  });
  await t.test("完整→domain 零写", async (st) => {
    const h = await setup(st, { withDomains: true });
    const beforeDomains = structuredClone(h.store.data[DOMAINS]);
    await h.retry();
    assert.deepEqual(h.store.data[DOMAINS], beforeDomains, "完整 domain 必须零写");
  });
});

test("LC05：domain 单边缺 → DOMAIN_INCOMPLETE；换钥 → DOMAIN_MISMATCH", async (t) => {
  await t.test("单边缺（删 version）→DOMAIN_INCOMPLETE 零写", async (st) => {
    const h = await setup(st, { withDomains: true });
    const ctx = opContextFor({ env: h.env, idempotencyKey: h.nextKey() });
    removeRecord(h.store, DOMAINS, ctx.versionId);
    await expectErrorZeroWrite(h.store, () => h.retry(), "DOMAIN_INCOMPLETE", 409);
  });
  await t.test("换钥（fingerprint 不符）→DOMAIN_MISMATCH 零写", async (st) => {
    // domain 用原始 K2_ENV 预建，服务改用不同密钥的 K2_ENV_B → 同 realm 但 fingerprint 不符。
    const h = await setup(st, { withDomains: true });
    const serviceB = new StrictRetryService({
      store: h.store, orgId: ORG,
      actor: { actorId: ACTOR, membershipId: MEMBERSHIP, actorType: "user" },
      now: () => NOW, env: { ...K2_ENV_B },
    });
    await expectErrorZeroWrite(h.store,
      () => serviceB.retry(JOB, { expectedJobRevision: JOB_REV }, { idempotencyKey: h.nextKey() }),
      "DOMAIN_MISMATCH", 409);
  });
});

test("LC05：K2 配置缺失/非法 → NOT_CONFIGURED 零写", async (t) => {
  const h = await setup(t, {
    env: { OPERATION_KEY_HMAC_KEY_B64: "not-base64!!", OPERATION_KEY_VERSION: "1", OPERATION_KEY_REALM: "g2-realm" },
  });
  await expectErrorZeroWrite(h.store, () => h.retry(), "NOT_CONFIGURED", 503);
});

test("LC05：严格重放——合法快照零写（job 仍 retryable_failed）", async (t) => {
  const h = await setup(t);
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  const auditsBefore = count(h.store, AUDIT_COLLECTION);
  const before = structuredClone(h.store.data);
  const replay = await h.retry(JOB, JOB_REV, key);
  assert.deepEqual(replay, receipt);
  assert.deepEqual(structuredClone(h.store.data), before, "合法重放零写（含不新增 audit）");
  assert.equal(count(h.store, AUDIT_COLLECTION), auditsBefore, "合法重放不得新增 audit");
});

test("LC05：严格重放——job 已推进到 sending/succeeded 仍返回原快照、零写", async (t) => {
  const h = await setup(t);
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  for (const advanced of ["sending", "succeeded"]) {
    const job = find(h.store, JOBS, JOB);
    job.state = advanced;
    job.leaseOwner = advanced === "sending" ? "worker-x" : null;
    const before = structuredClone(h.store.data);
    const replay = await h.retry(JOB, JOB_REV, key);
    assert.deepEqual(replay, receipt, `job=${advanced} 时必须返回原回执`);
    assert.deepEqual(structuredClone(h.store.data), before, `job=${advanced} 重放零写`);
  }
});

test("LC05：严格重放——异摘要（改 expectedJobRevision / jobId）→ CONFLICT 零写", async (t) => {
  await t.test("expectedJobRevision 改变", async (st) => {
    const h = await setup(st);
    const key = h.nextKey();
    await h.retry(JOB, JOB_REV, key);
    await expectErrorZeroWrite(h.store, () => h.retry(JOB, JOB_REV + 1, key), "CONFLICT", 409);
  });
  await t.test("jobId 改变", async (st) => {
    const h = await setup(st, { jobs: [makeEnrollJob(), makeEnrollJob({ _id: "job-g2-enroll-2" })] });
    const key = h.nextKey();
    await h.retry(JOB, JOB_REV, key);
    await expectErrorZeroWrite(h.store, () => h.retry("job-g2-enroll-2", JOB_REV, key), "CONFLICT", 409);
  });
});

test("LC05：严格重放——op key result 的 12 种损坏情形全部 CONFLICT 零写、不修复", async (t) => {
  const h = await setup(t);
  const key = h.nextKey();
  await h.retry(JOB, JOB_REV, key);
  const ctx = opContextFor({ env: h.env, idempotencyKey: key });
  const opId = ctx.opKey;
  const original = structuredClone(find(h.store, OP_KEYS, opId).result);
  const good = () => ({ jobId: JOB, state: "queued", revision: JOB_REV + 1, attempts: 2, nextAttemptAt: NOW - 5_000 });
  const variants = [
    ["null", () => null],
    ["数组", () => []],
    ["错 jobId", () => ({ ...good(), jobId: "job-g2-tampered" })],
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
  for (const [name, make] of variants) {
    await t.test(name, async (st) => {
      putRecord(h.store, OP_KEYS, opId, { ...find(h.store, OP_KEYS, opId), result: make() });
      await expectErrorZeroWrite(h.store, () => h.retry(JOB, JOB_REV, key), "CONFLICT", 409);
      putRecord(h.store, OP_KEYS, opId, { ...find(h.store, OP_KEYS, opId), result: structuredClone(original) });
      assert.deepEqual(find(h.store, OP_KEYS, opId).result, original, "损坏必须原样恢复，不修复");
    });
  }
});

test("LC05：op key / audit 记录字段越界（多字段或少字段）一律 CONFLICT 零写", async (t) => {
  const cases = [
    ["op key 多一个语义字段", (h, opKey, auditId) => {
      putRecord(h.store, OP_KEYS, opKey, { ...find(h.store, OP_KEYS, opKey), leaked: "x" });
    }],
    ["op key 少一个语义字段", (h, opKey) => {
      const rec = { ...find(h.store, OP_KEYS, opKey) };
      delete rec.createdAt;
      putRecord(h.store, OP_KEYS, opKey, rec);
    }],
    ["audit 多一个语义字段", (h, opKey, auditId) => {
      putRecord(h.store, AUDIT_COLLECTION, auditId, { ...find(h.store, AUDIT_COLLECTION, auditId), leaked: "x" });
    }],
    ["audit 少一个语义字段", (h, opKey, auditId) => {
      const rec = { ...find(h.store, AUDIT_COLLECTION, auditId) };
      delete rec.target;
      putRecord(h.store, AUDIT_COLLECTION, auditId, rec);
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async (st) => {
      const h = await setup(st);
      const key = h.nextKey();
      await h.retry(JOB, JOB_REV, key);
      const ctx = opContextFor({ env: h.env, idempotencyKey: key });
      mutate(h, ctx.opKey, auditIdFor(ctx.opKey));
      await expectErrorZeroWrite(h.store, () => h.retry(JOB, JOB_REV, key), "CONFLICT", 409);
    });
  }
});

test("LC05：audit 成对性——op key 存在但 audit 缺失 / audit 存在但 op key 缺失 → CONFLICT 零写", async (t) => {
  await t.test("op key 存在、audit 缺失", async (st) => {
    const h = await setup(st);
    const key = h.nextKey();
    await h.retry(JOB, JOB_REV, key);
    const ctx = opContextFor({ env: h.env, idempotencyKey: key });
    removeRecord(h.store, AUDIT_COLLECTION, auditIdFor(ctx.opKey));
    await expectErrorZeroWrite(h.store, () => h.retry(JOB, JOB_REV, key), "CONFLICT", 409);
  });
  await t.test("audit 存在、op key 缺失（预占/损坏）", async (st) => {
    const h = await setup(st);
    const key = h.nextKey();
    await h.retry(JOB, JOB_REV, key);
    const ctx = opContextFor({ env: h.env, idempotencyKey: key });
    removeRecord(h.store, OP_KEYS, ctx.opKey);
    await expectErrorZeroWrite(h.store, () => h.retry(JOB, JOB_REV, key), "CONFLICT", 409);
  });
});

test("LC05：不同 actor 同原始 key 互不重放（各自按自身权限）", async (t) => {
  const h = await setup(t, {
    extra: [{ collection: "org_memberships", id: MEMBERSHIP_B, data: {
      orgId: ORG, status: "active", principalType: "adminAccount", principalId: ACTOR_B,
      permissions: [RETRY_PERMISSION], revision: 1,
    } }],
  });
  const key = "g2-shared-raw-key-0001";
  await h.retry(JOB, JOB_REV, key);

  // 把 job 复位到 retryable_failed 并推进 revision，供第二主体用新 revision 成功重试
  const job = find(h.store, JOBS, JOB);
  job.state = "retryable_failed";
  job.revision = JOB_REV + 1;

  const serviceB = new StrictRetryService({
    store: h.store, orgId: ORG,
    actor: { actorId: ACTOR_B, membershipId: MEMBERSHIP_B, actorType: "user" },
    now: () => NOW, env: h.env,
  });
  const receiptB = await serviceB.retry(JOB, { expectedJobRevision: JOB_REV + 1 }, { idempotencyKey: key });
  assertReceiptShape(receiptB, { revision: JOB_REV + 2 });

  const ctxA = opContextFor({ env: h.env, idempotencyKey: key, actorId: ACTOR });
  const ctxB = opContextFor({ env: h.env, idempotencyKey: key, actorId: ACTOR_B });
  assert.notEqual(ctxA.opKey, ctxB.opKey, "不同 actor 的 op key 必须不同");
  assert.ok(find(h.store, OP_KEYS, ctxA.opKey) && find(h.store, OP_KEYS, ctxB.opKey), "两条 op key 各自存在");
});

// ---------------------------------------------------------------------------
// G2-LC06 校验顺序与零写
// ---------------------------------------------------------------------------
test("LC06：权限失败优先于 op key 损坏（op key 分支在权限之后）", async (t) => {
  const h = await setup(t, { memberOverrides: { permissions: [] } });
  const key = h.nextKey();
  const ctx = opContextFor({ env: h.env, idempotencyKey: key });
  putRecord(h.store, OP_KEYS, ctx.opKey, { result: "tampered" });
  putRecord(h.store, AUDIT_COLLECTION, auditIdFor(ctx.opKey), auditFixture(ctx.opKey));
  await expectErrorZeroWrite(h.store, () => h.retry(JOB, JOB_REV, key), "FORBIDDEN", 403);
});

test("LC06：op key 损坏优先于状态门禁（重放分支在状态门禁之前）", async (t) => {
  const h = await setup(t, { job: makeEnrollJob({ state: "queued", nextAttemptAt: null, result: null }) });
  const key = h.nextKey();
  const ctx = opContextFor({ env: h.env, idempotencyKey: key });
  putRecord(h.store, OP_KEYS, ctx.opKey, {
    orgId: ORG, realm: ctx.config.realm, keyVersion: ctx.config.version,
    requestDigest: digestOf({ jobId: JOB, expectedJobRevision: JOB_REV }),
    result: { jobId: JOB, state: "queued", revision: JOB_REV + 2, attempts: 2, nextAttemptAt: null },
    createdAt: NOW,
  });
  putRecord(h.store, AUDIT_COLLECTION, auditIdFor(ctx.opKey), auditFixture(ctx.opKey));
  await expectErrorZeroWrite(h.store, () => h.retry(JOB, JOB_REV, key), "CONFLICT", 409);
});

test("LC06：状态门禁优先于 revision（cancelled + 错 revision → INVALID_STATE）", async (t) => {
  const h = await setup(t, { job: makeEnrollJob({ state: "cancelled", nextAttemptAt: null, result: null }) });
  await expectErrorZeroWrite(h.store, () => h.retry(JOB, JOB_REV + 7), "INVALID_STATE", 409);
});

test("LC06：revision 优先于时间（错 revision + 未到期 → REVISION_CONFLICT）", async (t) => {
  const h = await setup(t, { job: makeEnrollJob({ nextAttemptAt: NOW + 100_000 }) });
  await expectErrorZeroWrite(h.store, () => h.retry(JOB, JOB_REV + 1), "REVISION_CONFLICT", 409);
});

// ---------------------------------------------------------------------------
// G2-LC07 时间门禁
// ---------------------------------------------------------------------------
test("LC07：now===nextAttemptAt 算到期；now<nextAttemptAt → RETRY_NOT_DUE", async (t) => {
  await t.test("等于到期→成功", async (st) => {
    const h = await setup(st, { job: makeEnrollJob({ nextAttemptAt: NOW }), now: NOW });
    const key = h.nextKey();
    const receipt = await h.retry(JOB, JOB_REV, key);
    assertReceiptShape(receipt, { nextAttemptAt: NOW });
  });
  await t.test("未到期→RETRY_NOT_DUE 零写", async (st) => {
    const h = await setup(st, { job: makeEnrollJob({ nextAttemptAt: NOW + 1 }), now: NOW });
    await expectErrorZeroWrite(h.store, () => h.retry(), "RETRY_NOT_DUE", 409);
  });
});

test("LC07：时钟非法（非安全整数/负数/回拨）→ ADAPTER_UNAVAILABLE 零写", async (t) => {
  await t.test("非安全整数", async (st) => {
    const h = await setup(st, { now: 1.5 });
    await expectErrorZeroWrite(h.store, () => h.retry(), "ADAPTER_UNAVAILABLE", 503);
  });
  await t.test("负数", async (st) => {
    const h = await setup(st, { now: -1 });
    await expectErrorZeroWrite(h.store, () => h.retry(), "ADAPTER_UNAVAILABLE", 503);
  });
  await t.test("回拨 now<finishedAt", async (st) => {
    const h = await setup(st, {
      job: makeEnrollJob({ result: { attempt: 2, outcome: "retryable_failed", errorKind: "RETRYABLE", reasonCode: "X", finishedAt: NOW + 10_000 } }),
      now: NOW,
    });
    await expectErrorZeroWrite(h.store, () => h.retry(), "ADAPTER_UNAVAILABLE", 503);
  });
});

test("LC07：newRevision 溢出 → INVALID_JOB 零写", async (t) => {
  const big = Number.MAX_SAFE_INTEGER - 2;
  await t.test("revision=MAX-2（+1 越过 stored 上限）", async (st) => {
    const h = await setup(st, { job: makeEnrollJob({ revision: big }) });
    await expectErrorZeroWrite(h.store, () => h.retry(JOB, big), "INVALID_JOB", 409);
  });
  await t.test("revision=MAX_SAFE_INTEGER", async (st) => {
    const h = await setup(st, { job: makeEnrollJob({ revision: Number.MAX_SAFE_INTEGER }) });
    await expectErrorZeroWrite(h.store, () => h.retry(JOB, Number.MAX_SAFE_INTEGER), "INVALID_JOB", 409);
  });
});

test("LC07：无 force/now/nextAttemptAt/delay/backoff 入参——额外字段 PARAM_ERROR 零写", async (t) => {
  // 实现已按 §4.3/§4.5 第 1 步落实严格 DTO 白名单：body 仅 expectedJobRevision、
  // headers 仅 idempotencyKey，任何额外字段一律 PARAM_ERROR/400 零写，不静默忽略。
  const cases = [
    ["body force", { body: { force: true } }],
    ["body now", { body: { now: 1 } }],
    ["body nextAttemptAt", { body: { nextAttemptAt: 1 } }],
    ["body delay", { body: { delay: 0 } }],
    ["body backoff", { body: { backoff: 0 } }],
    ["body reason", { body: { reason: "ignored" } }],
    ["body expectedRevision 旧名", { body: { expectedRevision: JOB_REV } }],
    ["headers force", { headers: { force: true } }],
    ["headers now", { headers: { now: 1 } }],
    ["headers nextAttemptAt", { headers: { nextAttemptAt: 1 } }],
    ["headers reason", { headers: { reason: "ignored" } }],
  ];
  for (const [name, spec] of cases) {
    await t.test(name, async (st) => {
      const h = await setup(st);
      const key = h.nextKey();
      const body = { expectedJobRevision: JOB_REV, ...(spec.body ?? {}) };
      const headers = { idempotencyKey: key, ...(spec.headers ?? {}) };
      await expectErrorZeroWrite(h.store,
        () => h.service.retry(JOB, body, headers), "PARAM_ERROR", 400);
    });
  }
  await t.test("无额外字段仍成功，服务端只用注入时钟", async (st) => {
    const h = await setup(st, { now: NOW });
    const key = h.nextKey();
    const receipt = await h.retry(JOB, JOB_REV, key);
    assertReceiptShape(receipt);
    assertSuccessWriteSet(h, { key });
    const job = find(h.store, JOBS, JOB);
    assert.equal(job.nextAttemptAt, NOW - 5_000, "服务端不得重设退避时间");
  });
});

// ---------------------------------------------------------------------------
// G2-LC08 公开 DTO
// ---------------------------------------------------------------------------
test("LC08：成功回执精确五字段，无敏感/内部字段；重放回执逐字段相等", async (t) => {
  const h = await setup(t);
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  assertReceiptShape(receipt);

  const FORBIDDEN_KEYS = ["leaseOwner", "leaseExpiresAt", "leaseGeneration", "requestDigest",
    "orgId", "actorId", "membershipId", "errorKind", "reasonCode", "message", "stack",
    "auditId", "logId", "createdAt", "updatedAt", "deviceId", "personId", "objectKey"];
  for (const k of Object.keys(receipt))
    assert.ok(!FORBIDDEN_KEYS.includes(k), `回执不得含内部字段 ${k}`);
  const serialized = JSON.stringify(receipt);
  for (const token of [ORG, ACTOR, MEMBERSHIP, DEVICE, PERSON, key])
    assert.ok(!serialized.includes(token), `回执不得泄露合成标识 ${token}`);

  const replay = await h.retry(JOB, JOB_REV, key);
  assert.deepEqual(replay, receipt);
});

// ---------------------------------------------------------------------------
// G2-LC09 与 G1 兼容
// ---------------------------------------------------------------------------
test("LC09：旧 requeue 的 queued job/log/audit 不被误用为新 K2 成功", async (t) => {
  const oldLogId = deterministicLogId(JOB, "queued", JOB_REV + 1);
  const oldAuditId = "audit-legacy-requeue";
  const h = await setup(t, {
    job: makeEnrollJob({ state: "queued", nextAttemptAt: null, result: null }),
    extra: [
      { collection: LOGS, id: oldLogId, data: { orgId: ORG, jobId: JOB, action: "enroll", state: "queued", fromState: "retryable_failed", revision: JOB_REV + 1, actorType: "system", actorId: "legacy", at: NOW, attempt: 2, leaseGeneration: 2, evidenceScope: "simulated", errorKind: null, reasonCode: null, alertCode: null } },
      { collection: AUDIT_COLLECTION, id: oldAuditId, data: { orgId: ORG, actorId: "legacy", actorType: "system", action: "H4 requeue" } },
    ],
  });
  const key = h.nextKey();
  await expectErrorZeroWrite(h.store, () => h.retry(), "INVALID_STATE", 409);
  const ctx = opContextFor({ env: h.env, idempotencyKey: key });
  assert.equal(find(h.store, OP_KEYS, ctx.opKey), undefined, "不得从旧 log/audit 反推或补写 op key");
  assert.ok(find(h.store, AUDIT_COLLECTION, oldAuditId), "旧 audit 不被改写");
});

test("LC09：旧 job 再次失败可用新 key 重试成功；同 key 复用 → CONFLICT", async (t) => {
  const h = await setup(t, {
    extra: [{ collection: AUDIT_COLLECTION, id: "audit-legacy-requeue", data: { orgId: ORG, actorId: "legacy", action: "重排合成门禁任务" } }],
  });
  const key = h.nextKey();
  const receipt = await h.retry(JOB, JOB_REV, key);
  assertReceiptShape(receipt);
  assert.ok(find(h.store, AUDIT_COLLECTION, "audit-legacy-requeue"), "旧 audit 保留不迁移");

  // 模拟 job 再次失败：revision 前进、回到 retryable_failed
  const job = find(h.store, JOBS, JOB);
  job.state = "retryable_failed";
  job.revision = JOB_REV + 1;
  job.result = { attempt: 2, outcome: "retryable_failed", errorKind: "RETRYABLE", reasonCode: "PRIOR_RETRYABLE", finishedAt: NOW - 1 };
  job.nextAttemptAt = NOW;

  // 同 key + 新 revision → 摘要不同 → CONFLICT
  await expectErrorZeroWrite(h.store, () => h.retry(JOB, JOB_REV + 1, key), "CONFLICT", 409);

  // 新 key + 新 revision → 成功
  const newKey = h.nextKey();
  const receipt2 = await h.retry(JOB, JOB_REV + 1, newKey);
  assertReceiptShape(receipt2, { revision: JOB_REV + 2, nextAttemptAt: NOW });
});

// ---------------------------------------------------------------------------
// G2-LC10 零副作用（Provider / 网络 / 不改实现文件）
// ---------------------------------------------------------------------------
function ownMethodNames(obj) {
  const names = new Set();
  for (let proto = obj; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor") continue;
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (desc && typeof desc.value === "function") names.add(name);
    }
  }
  return [...names].sort();
}

test("LC10：网络/Provider 副作用探针——成功与失败路径均为 0，正控 +1，原函数身份精确恢复", async (t) => {
  const netOriginals = {
    fetch: globalThis.fetch,
    httpRequest: http.request, httpGet: http.get,
    httpsRequest: https.request, httpsGet: https.get,
  };
  const h = await setup(t);
  const counts = { network: 0 };
  const records = [];
  const active = new WeakMap();
  const wrap = (obj, key, bucket) => {
    if (!obj || typeof obj[key] !== "function") return false;
    let keys = active.get(obj);
    if (!keys) { keys = new Set(); active.set(obj, keys); }
    if (keys.has(key)) throw new Error(`嵌套污染：${key} 已被包裹`);
    const original = obj[key];
    const hadOwn = Object.prototype.hasOwnProperty.call(obj, key);
    const slot = { impl: original };
    obj[key] = function (...args) { counts[bucket] += 1; return Reflect.apply(slot.impl, obj, args); };
    keys.add(key);
    records.push({ obj, key, bucket, hadOwn, original, slot });
    return true;
  };
  const wrappedNetwork = [];
  for (const [obj, label, key] of [
    [globalThis, "globalThis", "fetch"],
    [http, "http", "request"], [http, "http", "get"],
    [https, "https", "request"], [https, "https", "get"],
  ]) if (wrap(obj, key, "network")) wrappedNetwork.push(`${label}.${key}`);

  const serviceMethods = ownMethodNames(h.service);
  assert.ok(serviceMethods.includes("retry"), "服务真实方法集合应含 retry");
  // 服务层不存在任何 Provider 入口：源码中不含 Provider/fetch/http/device 网络调用。
  const source = await readFile(join(here, "..", "lib", "face-service", "retry.mjs"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\bprovider\.\w+\s*\(/i, "服务源码不得调用 Provider 方法");
  assert.doesNotMatch(code, /from\s+["'][^"']*provider/i, "服务源码不得 import Provider 模块");
  assert.doesNotMatch(code, /\bfetch\s*\(/, "服务源码不得调用 fetch");
  assert.doesNotMatch(code, /\bhttps?\.(request|get)\s*\(/, "服务源码不得使用 http/https 网络模块");

  const restore = () => {
    for (const r of [...records].reverse()) {
      if (r.hadOwn) r.obj[r.key] = r.original;
      else delete r.obj[r.key];
      active.get(r.obj)?.delete(r.key);
    }
  };
  try {
    // 正控：实际触发一次网络包裹方法并验证 +1，证明探针确实生效；随后回滚计数不污染窗口。
    {
      const rec = records.find((r) => r.bucket === "network");
      assert.ok(rec, "network: 必须至少包裹一个真实方法");
      const before = counts.network;
      const real = rec.slot.impl;
      rec.slot.impl = () => undefined;
      try { Reflect.apply(rec.obj[rec.key], rec.obj, []); }
      finally { rec.slot.impl = real; }
      assert.equal(counts.network - before, 1, "network: 正控失败——触发后计数未 +1");
      counts.network = before;
    }
    assert.ok(wrappedNetwork.length >= 4, "网络入口必须包裹 http/https request/get");

    const base = { ...counts };
    const key = h.nextKey();
    await h.retry(JOB, JOB_REV, key);                                 // 成功路径
    await expectError(() => h.retry(JOB, JOB_REV + 1, key), "CONFLICT"); // 失败路径（异摘要）
    const delta = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v - base[k]]));
    assert.deepEqual(delta, { network: 0 }, `网络副作用必须为 0，实测 ${JSON.stringify(delta)}`);
  } finally {
    restore();
  }
  assert.equal(globalThis.fetch, netOriginals.fetch, "fetch 原函数身份必须精确恢复");
  assert.equal(http.request, netOriginals.httpRequest, "http.request 原函数身份必须精确恢复");
  assert.equal(http.get, netOriginals.httpGet, "http.get 原函数身份必须精确恢复");
  assert.equal(https.request, netOriginals.httpsRequest, "https.request 原函数身份必须精确恢复");
  assert.equal(https.get, netOriginals.httpsGet, "https.get 原函数身份必须精确恢复");
});

test("LC10：构造与失败分支均不写 Store（全库零写）——覆盖 PARAM_ERROR 与 FORBIDDEN", async (t) => {
  await t.test("idempotencyKey 非法 → PARAM_ERROR 零写", async (st) => {
    const h = await setup(st);
    await expectErrorZeroWrite(h.store, () => h.service.retry(JOB, { expectedJobRevision: JOB_REV }, { idempotencyKey: "short" }), "PARAM_ERROR", 400);
  });
  await t.test("expectedJobRevision 非法 → PARAM_ERROR 零写", async (st) => {
    const h = await setup(st);
    await expectErrorZeroWrite(h.store, () => h.retry(JOB, 0), "PARAM_ERROR", 400);
  });
});

// ---------------------------------------------------------------------------
// 复审 8 项缺陷回归（每条负向用例在修复前均失败）
// ---------------------------------------------------------------------------
test("REG-P1-1：确定性 log ID 被预占 → CONFLICT/409 零写，预占记录不被覆盖", async (t) => {
  const h = await setup(t);
  const logId = deterministicLogId(JOB, "queued", JOB_REV + 1);
  putRecord(h.store, LOGS, logId, {
    orgId: ORG, jobId: JOB, action: "enroll", fromState: "PRESEEDED", state: "queued",
    actorType: "PRESEEDED", actorId: "PRESEEDED", at: NOW, revision: JOB_REV + 1, attempt: 99,
    leaseGeneration: 99, evidenceScope: "PRESEEDED", errorKind: null, reasonCode: null, alertCode: null,
    sentinelMarker: "MUST_SURVIVE",
  });
  await expectErrorZeroWrite(h.store, () => h.retry(), "CONFLICT", 409);
  assert.equal(find(h.store, LOGS, logId).sentinelMarker, "MUST_SURVIVE", "预占 log 不得被合并覆盖");
});

test("REG-P1-2：非 LocalStore 适配器构造即 NOT_CONFIGURED/503、零写", async (t) => {
  const h = await setup(t);
  let transactCalls = 0;
  const fakeStore = {
    data: structuredClone(h.store.data),
    transact: async () => { transactCalls += 1; return []; },
  };
  const before = structuredClone(fakeStore.data);
  await expectError(async () => {
    new StrictRetryService({
      store: fakeStore, orgId: ORG,
      actor: { actorId: ACTOR, membershipId: MEMBERSHIP, actorType: "user" },
      now: () => NOW, env: h.env,
    });
  }, "NOT_CONFIGURED", 503);
  assert.equal(transactCalls, 0, "非 LocalStore 不得触发任何 transact");
  assert.deepEqual(fakeStore.data, before, "零写");
});

test("REG-P1-3：actor 缺失 actorType → FORBIDDEN/403 零写（对照 system 见 LC05）", async (t) => {
  const h = await setup(t);
  const service = new StrictRetryService({
    store: h.store, orgId: ORG,
    actor: { actorId: ACTOR, membershipId: MEMBERSHIP }, // 无 actorType
    now: () => NOW, env: h.env,
  });
  await expectErrorZeroWrite(h.store,
    () => service.retry(JOB, { expectedJobRevision: JOB_REV }, { idempotencyKey: h.nextKey() }),
    "FORBIDDEN", 403);
});

test("REG-P2-4：嵌套回执 result 含 _id/updatedAt → CONFLICT/409 零写", async (t) => {
  for (const extra of ["_id", "updatedAt"]) {
    await t.test(`result 多一个存储字段 ${extra}`, async (st) => {
      const h = await setup(st);
      const key = h.nextKey();
      await h.retry(JOB, JOB_REV, key);
      const ctx = opContextFor({ env: h.env, idempotencyKey: key });
      const original = structuredClone(find(h.store, OP_KEYS, ctx.opKey).result);
      putRecord(h.store, OP_KEYS, ctx.opKey, {
        ...find(h.store, OP_KEYS, ctx.opKey),
        result: { ...original, [extra]: "SHOULD_BE_REJECTED" },
      });
      await expectErrorZeroWrite(h.store, () => h.retry(JOB, JOB_REV, key), "CONFLICT", 409);
    });
  }
});

test("REG-P2-5：K2 配置非法 + 成员无权限 → FORBIDDEN/403（权限优先于 K2）", async (t) => {
  const h = await setup(t, {
    env: { OPERATION_KEY_HMAC_KEY_B64: "not-base64!!", OPERATION_KEY_VERSION: "1", OPERATION_KEY_REALM: "g2-realm" },
    memberOverrides: { permissions: [] },
  });
  await expectErrorZeroWrite(h.store, () => h.retry(), "FORBIDDEN", 403);
});

test("REG-P2-6：domain 错误必须携带 status=409（直接断言，不依赖 assertSafeError）", async (t) => {
  await t.test("DOMAIN_INCOMPLETE", async (st) => {
    const h = await setup(st);
    const ctx = opContextFor({ env: h.env, idempotencyKey: h.nextKey() });
    removeRecord(h.store, DOMAINS, ctx.versionId);
    const before = structuredClone(h.store.data);
    await assert.rejects(() => h.retry(), (err) => {
      assert.equal(err.code, "DOMAIN_INCOMPLETE");
      assert.equal(err.status, 409, "DOMAIN_INCOMPLETE 必须 status=409");
      return true;
    });
    assert.deepEqual(structuredClone(h.store.data), before, "零写");
  });
  await t.test("DOMAIN_MISMATCH", async (st) => {
    const h = await setup(st);
    const serviceB = new StrictRetryService({
      store: h.store, orgId: ORG,
      actor: { actorId: ACTOR, membershipId: MEMBERSHIP, actorType: "user" },
      now: () => NOW, env: { ...K2_ENV_B },
    });
    const before = structuredClone(h.store.data);
    await assert.rejects(
      () => serviceB.retry(JOB, { expectedJobRevision: JOB_REV }, { idempotencyKey: h.nextKey() }),
      (err) => {
        assert.equal(err.code, "DOMAIN_MISMATCH");
        assert.equal(err.status, 409, "DOMAIN_MISMATCH 必须 status=409");
        return true;
      });
    assert.deepEqual(structuredClone(h.store.data), before, "零写");
  });
});

test("REG-P2-7：audit 语义字段值损坏 → CONFLICT/409 零写", async (t) => {
  const cases = [
    ["actorId", "TAMPERED_ACTOR"],
    ["actorType", "system"],
    ["action", "H4 requeue"],
    ["target", "TAMPERED_TARGET"],
  ];
  for (const [field, bad] of cases) {
    await t.test(`audit.${field} 篡改`, async (st) => {
      const h = await setup(st);
      const key = h.nextKey();
      await h.retry(JOB, JOB_REV, key);
      const ctx = opContextFor({ env: h.env, idempotencyKey: key });
      const auditId = auditIdFor(ctx.opKey);
      putRecord(h.store, AUDIT_COLLECTION, auditId, {
        ...find(h.store, AUDIT_COLLECTION, auditId), [field]: bad,
      });
      await expectErrorZeroWrite(h.store, () => h.retry(JOB, JOB_REV, key), "CONFLICT", 409);
    });
  }
});

test("REG-P2-8：jobId 不符合冻结正则 → PARAM_ERROR/400 零写", async (t) => {
  for (const badId of ["bad job", "-lead", "job@x", "é"]) {
    await t.test(`jobId=${JSON.stringify(badId)}`, async (st) => {
      const h = await setup(st);
      await expectErrorZeroWrite(h.store, () => h.retry(badId, JOB_REV), "PARAM_ERROR", 400);
    });
  }
});
