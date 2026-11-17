/**
 * HK-AI-07D G3「冻结矩阵验证」公共测试基础设施（testkit）。
 *
 * 设计意图（用户三项硬要求）：
 *  1) 网络 guard 必须在被测模块加载【之前】安装。ESM 静态 import 会提升，
 *     因此本文件顶层【不得】静态 import retry.mjs / store.mjs / collections.mjs /
 *     h3a.mjs / h4b.mjs / model.mjs 等被测模块；只用 top-level await：
 *     installNetworkGuard() -> await import(...) -> assertNoLoadTimeViolation()。
 *  2) 违规记录分两类：loadTimeViolations（加载期捕获，永久保留、任何情况下不得清除）；
 *     runtimeViolations（运行期捕获，可被正控重置）。getViolations() 供断言「零网络」。
 *  3) 正控【绝不转发】真实原始函数：被拦截桩只记录违规 + 计数 + 返回安全 sentinel，
 *     随后仅把 runtimeViolations 归零，绝不触碰 loadTimeViolations。
 *
 * 恢复语义：restoreNetworkGuard() 把每个入口恢复为原始函数【身份】与【原始属性描述符】
 * （writable/enumerable/configurable/get/set），不用 bind 副本冒充；active WeakMap 防嵌套污染。
 *
 * 全部 fixture 合成（无真实人员/设备/组织/凭据/AppID/商户号/密钥）。
 */

// ---------------------------------------------------------------------------
// 顶层只允许静态 import Node 内建模块（guard 自身的依赖，不触网），
// 被测模块一律走下方 top-level await 动态 import。
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";

const here = dirname(fileURLToPath(import.meta.url));

// ===========================================================================
// A. 网络 guard
// ===========================================================================

/** 安全哨兵值：证明桩返回的是 mock 而不是真实 Server/ClientRequest/Response。 */
function g3Mock(name) {
  return Object.freeze({ __g3Mock: true, __g3Entry: name });
}

/**
 * 创建一台独立网络 guard 实例（工厂）。主守卫用默认真实入口；
 * self-check 的负向验证用自定义 mock 入口，做到「不污染主测试」。
 */
function createNetworkGuard(entriesOverride = null) {
  const state = {
    installed: false,
    phase: "idle", // "load" | "runtime" | "restored"
    active: new WeakMap(), // obj -> Set(keys)，防同一(obj,key)嵌套包裹
    records: [], // {name,obj,key,original,hadOwn,originalDescriptor,mock,count,stub}
    loadTimeViolations: [],
    runtimeViolations: [],
  };

  function resolveEntries() {
    if (entriesOverride) return entriesOverride;
    const list = [
      { name: "net.createServer", obj: net, key: "createServer", mock: () => g3Mock("net.createServer") },
      { name: "http.Server.prototype.listen", obj: http.Server.prototype, key: "listen", mock: () => g3Mock("http.Server.prototype.listen") },
      { name: "https.Server.prototype.listen", obj: https.Server.prototype, key: "listen", mock: () => g3Mock("https.Server.prototype.listen") },
      { name: "http.request", obj: http, key: "request", mock: () => g3Mock("http.request") },
      { name: "http.get", obj: http, key: "get", mock: () => g3Mock("http.get") },
      { name: "https.request", obj: https, key: "request", mock: () => g3Mock("https.request") },
      { name: "https.get", obj: https, key: "get", mock: () => g3Mock("https.get") },
      { name: "globalThis.fetch", obj: globalThis, key: "fetch", mock: () => Promise.resolve(g3Mock("globalThis.fetch")) },
      { name: "dns.lookup", obj: dns, key: "lookup", mock: () => g3Mock("dns.lookup") },
      { name: "net.connect", obj: net, key: "connect", mock: () => g3Mock("net.connect") },
      { name: "net.createConnection", obj: net, key: "createConnection", mock: () => g3Mock("net.createConnection") },
    ];
    // dns.resolve* 全部入口逐一包裹，每个都有正控。
    for (const key of Object.getOwnPropertyNames(dns).sort()) {
      if (/^resolve/.test(key) && typeof dns[key] === "function")
        list.push({ name: `dns.${key}`, obj: dns, key, mock: () => Promise.resolve(g3Mock(`dns.${key}`)) });
    }
    return list;
  }

  function recordViolation(rec) {
    const violation = Object.freeze({
      name: rec.name,
      phase: state.phase,
      at: Date.now(),
    });
    // 加载期违规永久保留，任何情况下不得清除；运行期违规可重置。
    if (state.phase === "load") state.loadTimeViolations.push(violation);
    else if (state.phase === "runtime") state.runtimeViolations.push(violation);
    return violation;
  }

  function makeStub(rec) {
    // 关键：桩【绝不】调用 rec.original。original 仅用于精确恢复。
    return function g3GuardedStub() {
      rec.count += 1;
      recordViolation(rec);
      return rec.mock();
    };
  }

  function install() {
    if (state.installed) throw new Error("网络 guard 已安装，拒绝嵌套安装（防污染）");
    const entries = resolveEntries();
    for (const spec of entries) {
      const { name, obj, key, mock } = spec;
      if (!obj || typeof obj[key] !== "function") continue;
      let keys = state.active.get(obj);
      if (!keys) { keys = new Set(); state.active.set(obj, keys); }
      if (keys.has(key)) throw new Error(`嵌套污染：${name} 已被包裹`);
      const original = obj[key];
      const hadOwn = Object.prototype.hasOwnProperty.call(obj, key);
      const originalDescriptor = hadOwn
        ? Object.getOwnPropertyDescriptor(obj, key)
        : null;
      if (originalDescriptor && originalDescriptor.configurable === false)
        throw new Error(`${name} 原始属性不可配置，无法安全包裹`);
      const rec = { name, obj, key, original, hadOwn, originalDescriptor, mock, count: 0, stub: null };
      const stub = makeStub(rec);
      rec.stub = stub;
      Object.defineProperty(obj, key, {
        value: stub,
        writable: true,
        enumerable: hadOwn ? originalDescriptor.enumerable : true,
        configurable: true,
      });
      keys.add(key);
      state.records.push(rec);
    }
    state.installed = true;
    state.phase = "load";
    return state.records.map((r) => r.name);
  }

  /** 加载期违规断言：有违规则抛错且不切换阶段；干净则切到 runtime。 */
  function assertNoLoadTimeViolation() {
    if (state.loadTimeViolations.length > 0) {
      const names = [...new Set(state.loadTimeViolations.map((v) => v.name))];
      const err = new Error(
        `模块加载期检测到网络调用（${state.loadTimeViolations.length} 次）：${names.join(", ")}`,
      );
      err.code = "G3_LOADTIME_NETWORK_VIOLATION";
      throw err;
    }
    if (state.phase === "load") state.phase = "runtime";
    return { loadTime: [] };
  }

  function getViolations() {
    return {
      loadTime: state.loadTimeViolations.map((v) => ({ ...v })),
      runtime: state.runtimeViolations.map((v) => ({ ...v })),
    };
  }

  /** 只清运行期违规，绝不触碰 loadTimeViolations。 */
  function resetRuntimeViolations() {
    state.runtimeViolations.length = 0;
  }

  /** 单个入口正控：调用桩本身，断言计数+1/违规+1/返回 sentinel，然后只清运行期违规。 */
  async function positiveControlOne(name) {
    const rec = state.records.find((r) => r.name === name);
    assert.ok(rec, `入口 ${name} 未安装，无法正控`);
    const countBefore = rec.count;
    const runtimeBefore = state.runtimeViolations.length;
    const loadBefore = state.loadTimeViolations.length;
    const ret = await rec.stub(); // 直接调用桩；桩不转发原始函数
    assert.equal(rec.count, countBefore + 1, `${name}: 正控计数未 +1`);
    assert.equal(state.runtimeViolations.length, runtimeBefore + 1, `${name}: 正控违规未 +1`);
    assert.equal(state.loadTimeViolations.length, loadBefore, `${name}: 正控不得触碰 loadTimeViolations`);
    const value = await ret;
    // 真实函数会返回 Server/ClientRequest/Response 等真对象；sentinel 证明未转发。
    assert.ok(value && value.__g3Mock === true && value.__g3Entry === name,
      `${name}: 桩返回值必须是安全 sentinel（证明未转发真实原始函数）`);
    resetRuntimeViolations();
    return { name, ret: value };
  }

  async function positiveControlAll() {
    const out = [];
    for (const rec of state.records) out.push(await positiveControlOne(rec.name));
    return out;
  }

  /** 精确恢复：原始身份 + 原始属性描述符；清 active，防后续误判嵌套。 */
  function restore() {
    for (const rec of [...state.records].reverse()) {
      if (rec.hadOwn) Object.defineProperty(rec.obj, rec.key, rec.originalDescriptor);
      else delete rec.obj[rec.key];
      state.active.get(rec.obj)?.delete(rec.key);
    }
    state.installed = false;
    state.phase = "restored";
    return state.records.length;
  }

  return {
    state, install, assertNoLoadTimeViolation, getViolations,
    resetRuntimeViolations, positiveControlOne, positiveControlAll, restore,
    entries: () => state.records.map((r) => r.name),
  };
}

// --- 主守卫：必须先安装，再加载被测模块 ------------------------------------
const networkGuard = createNetworkGuard();
const installedEntries = networkGuard.install();

// 被测模块动态导入（guard 已安装，加载期任何网络调用都会被捕获）。
const storeModule = await import("../lib/store.mjs");
const collectionsModule = await import("../lib/face-service/collections.mjs");
const h3aModule = await import("../lib/face-service/h3a.mjs");
const h4bModule = await import("../lib/face-service/h4b.mjs");
const retryModule = await import("../lib/face-service/retry.mjs");
const modelModule = await import("../lib/model.mjs");

// 断言加载期零网络；通过后将阶段切到 runtime。有违规直接抛错终止加载。
networkGuard.assertNoLoadTimeViolation();

// 便捷具名 API（下游矩阵文件可直接 import 使用）。
export const installNetworkGuard = () => networkGuard.install();
export const assertNoLoadTimeViolation = () => networkGuard.assertNoLoadTimeViolation();
export const restoreNetworkGuard = () => networkGuard.restore();
export const getViolations = () => networkGuard.getViolations();
export const resetRuntimeViolations = () => networkGuard.resetRuntimeViolations();
export const positiveControlOne = (name) => networkGuard.positiveControlOne(name);
export const positiveControlAll = () => networkGuard.positiveControlAll();
export const guardEntryNames = () => networkGuard.entries();
export { networkGuard };

// 被测模块具名导出（供下游矩阵文件复用，不重复动态导入）。
export const { LocalStore } = storeModule;
export const {
  COLLECTIONS, deterministicLogId, applyOperationKeyDomain, operationKey,
  operationKeyConfig, operationKeyDomainIds, operationKeyFingerprint,
  assertIdempotencyKey,
} = collectionsModule;
export const { validateDispatchJob } = h3aModule;
export const { validateRevokeJob } = h4bModule;
export const { StrictRetryService } = retryModule;
export const { failCode, HttpError } = modelModule;

// ===========================================================================
// B. 合成 fixture（仿 G2 setup，全合成）
// ===========================================================================
export const ORG = "org-g3-synthetic";
export const ORG_OTHER = "org-g3-other";
export const MEMBERSHIP = "mem-g3-synthetic";
export const MEMBERSHIP_B = "mem-g3-other-actor";
export const ACTOR = "user-g3-actor";
export const ACTOR_B = "user-g3-actor-b";
export const PERSON = "person-g3-synthetic";
export const IDENTITY = "identity-g3-synthetic";
export const OCC = "occ-g3-synthetic";
export const CYCLE = "cycle-g3-synthetic";
export const GRANT = "grant-g3-synthetic";
export const CREDENTIAL = "cred-g3-synthetic";
export const FILE = "file-g3-synthetic";
export const DEVICE = "device-g3-synthetic";
export const CLAIM = "claim-g3-synthetic";
export const SLOT = "slot-g3-synthetic";

export const NOW = 1_700_000_000_000;
export const JOB = "job-g3-enroll";
export const JOB_REV = 4;
export const RETRY_PERMISSION = "device.operation.retry";
export const REQ_METHOD = "face.operation.retry";
export const AUDIT_ACTION = "HK-AI-07D retry";

export const K2_ENV = Object.freeze({
  OPERATION_KEY_HMAC_KEY_B64: Buffer.alloc(32, 9).toString("base64"),
  OPERATION_KEY_VERSION: "1",
  OPERATION_KEY_REALM: "g3-realm",
});
export const K2_ENV_B = Object.freeze({
  ...K2_ENV,
  OPERATION_KEY_HMAC_KEY_B64: Buffer.alloc(32, 11).toString("base64"),
});
export const K2_CONFIG = operationKeyConfig(K2_ENV);
export const DOMAIN_IDS = operationKeyDomainIds(K2_CONFIG.realm);
export const DOMAIN_VERSION_ID = `${DOMAIN_IDS.versionIdPrefix}${K2_CONFIG.version}`;

export const SEED_AUDIT = { actor: "g3-seed", actorId: "g3-seed", action: "seed" };
export const AUDIT_COLLECTION = "admin_audit";
export const JOBS = COLLECTIONS.DEVICE_OPERATION_JOBS;
export const LOGS = COLLECTIONS.DEVICE_OPERATION_LOGS;
export const OP_KEYS = COLLECTIONS.OPERATION_KEYS;
export const DOMAINS = COLLECTIONS.OPERATION_KEY_DOMAINS;

export const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]))
      : value;
export const digestOf = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

export const ref = (collection, id) => ({ collection, id });
export const find = (store, collection, id) => (store.data[collection] || []).find((r) => r._id === id);
export const count = (store, collection) => (store.data[collection] || []).length;

export function putRecord(store, collection, id, data) {
  const rows = (store.data[collection] ||= []);
  const record = { ...data, _id: id, updatedAt: NOW };
  const index = rows.findIndex((r) => r._id === id);
  if (index < 0) rows.push(record);
  else rows[index] = record;
  return record;
}
export function removeRecord(store, collection, id) {
  const rows = store.data[collection] || [];
  const index = rows.findIndex((r) => r._id === id);
  if (index >= 0) rows.splice(index, 1);
}

export function opContextFor({ env = K2_ENV, idempotencyKey, orgId = ORG, actorId = ACTOR } = {}) {
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
export const auditIdFor = (opKey, { orgId = ORG, jobId = JOB } = {}) =>
  `audit-07d-v1:${digestOf(["HK-AI-07D/retry-audit", "v1", orgId, jobId, opKey]).slice(0, 32)}`;

export const auditFixture = (opKey, overrides = {}) => ({
  orgId: ORG, actorId: ACTOR, actorType: "user", action: AUDIT_ACTION,
  target: `device_operation_jobs/${JOB}, operation_keys/${opKey}`, createdAt: NOW,
  ...overrides,
});

export function makeDispatchSnapshot(overrides = {}) {
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
    schemaVersion: 1, createdAt: 1, creatorActorId: ACTOR,
    membershipId: MEMBERSHIP, identityApplicationId: IDENTITY, personId: PERSON,
    occupancyId: OCC, cycleId: CYCLE, fileId: FILE, claimId: CLAIM, slotId: SLOT,
    domainHeadId: DOMAIN_IDS.headId, domainVersionId: DOMAIN_VERSION_ID,
    restriction: "occupancy.activate", versions, ...overrides,
  };
}

export function makeEnrollJob(overrides = {}) {
  const job = {
    _id: JOB, orgId: ORG, revision: JOB_REV,
    credentialId: CREDENTIAL, grantId: GRANT, deviceId: DEVICE,
    action: "enroll", state: "retryable_failed",
    executionMode: "test", provider: "mock", evidenceScope: "simulated",
    dispatchSnapshot: makeDispatchSnapshot(),
    attempts: 2, leaseGeneration: 2,
    leaseOwner: null, leaseExpiresAt: null, dispatchAuthorizedAt: null,
    nextAttemptAt: NOW - 5_000,
    result: { attempt: 2, outcome: "retryable_failed", errorKind: "RETRYABLE",
      reasonCode: "PRIOR_RETRYABLE", finishedAt: NOW - 10_000 },
    createdAt: 1, updatedAt: 1,
  };
  return { ...job, ...overrides };
}

export function makeRevokeJob(overrides = {}) {
  const job = {
    _id: JOB, orgId: ORG, revision: JOB_REV,
    credentialId: CREDENTIAL, grantId: GRANT, deviceId: DEVICE,
    action: "revoke", state: "retryable_failed",
    executionMode: "test", provider: "mock", evidenceScope: "simulated",
    attempts: 1, leaseGeneration: 1,
    leaseOwner: null, leaseExpiresAt: null, dispatchAuthorizedAt: null,
    nextAttemptAt: NOW - 5_000,
    result: { attempt: 1, outcome: "retryable_failed", errorKind: "RETRYABLE",
      reasonCode: "PRIOR_RETRYABLE", finishedAt: NOW - 10_000 },
    cleanupPhase: "dispatch", providerOutcome: null, finalizeAttempts: 0,
    cleanupSnapshot: {
      schemaVersion: 1, grantId: GRANT, grantRevision: 1,
      credentialId: CREDENTIAL, credentialRevision: 1,
      deviceId: DEVICE, deviceRevision: 1,
      claimId: CLAIM, claimRevision: 1,
      slotId: SLOT, slotRevision: 1,
      releaseGuardId: "guard-g3-synthetic", releaseGuardRevision: 1,
      releaseGuardEpoch: 1, originalGrantState: "effective", createdAt: 1,
    },
    createdAt: 1, updatedAt: 1,
  };
  return { ...job, ...overrides };
}

/**
 * 合成 store/service/fixture。选项与 G2 setup 兼容：
 * withDomains / memberOverrides / orgOverrides / job / jobs / extra / actorType / env / now。
 */
export async function setupG3(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "g3-retry-"));
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
    now: () => now, env,
  });
  let seq = 0;
  return {
    store, service, env, now, jobs,
    seedAuditCount: count(store, AUDIT_COLLECTION),
    nextKey: () => `g3-idem-key-${String(++seq).padStart(8, "0")}`,
    retry: (jobId = JOB, expectedJobRevision = JOB_REV, key) =>
      service.retry(jobId, { expectedJobRevision }, { idempotencyKey: key ?? `g3-idem-key-${String(++seq).padStart(8, "0")}` }),
  };
}

// ===========================================================================
// C. 断言 helper
// ===========================================================================
const SENSITIVE_TOKENS = [ORG, ORG_OTHER, MEMBERSHIP, MEMBERSHIP_B, ACTOR, ACTOR_B, JOB];
export function assertSafeError(err) {
  assert.ok(err instanceof Error, "失败必须是 Error");
  assert.ok(typeof err.code === "string" && err.code, "失败必须携带冻结错误码");
  assert.notEqual(err.status, 500, "失败不得为 500");
  if (err.status !== undefined)
    assert.ok(err.status >= 400 && err.status <= 503, "失败状态必须是既有 HTTP 映射");
  const message = String(err.message);
  for (const token of SENSITIVE_TOKENS)
    assert.ok(!message.includes(token), `错误消息不得包含合成标识 ${token}`);
  assert.ok(!/\bat\s+\S+\s*\(/.test(message), "错误消息不得包含 stack 帧");
}

/**
 * 失败断言：同时断言 err.code === code 且 err.status === status（status 是契约断言项），
 * 并断言全库零写（structuredClone 前后 content-level deepEqual）与 Provider/网络 0。
 */
export async function expectError(store, action, code, status) {
  const before = structuredClone(store.data);
  const netBefore = getViolations().runtime.length;
  await assert.rejects(action, (err) => {
    assertSafeError(err);
    assert.equal(err.code, code, `期望错误码 ${code}，实际 ${err.code}`);
    if (status === undefined) assert.ok(err.status >= 400 && err.status <= 503);
    else assert.equal(err.status, status, `${code} 的 status 必须是契约值 ${status}，实际 ${err.status}`);
    return true;
  });
  assert.deepEqual(structuredClone(store.data), before, "零写分支必须全库内容级不变");
  assert.equal(getViolations().runtime.length, netBefore,
    "失败分支不得产生任何网络/Provider 调用（Provider 0）");
}

/** 零写：全库 structuredClone 内容级前后对比（非引用比较）。 */
export function assertZeroWrite(store, before) {
  assert.deepEqual(structuredClone(store.data), before, "必须全库内容级零变化");
}

export function assertReceiptShape(receipt, { jobId = JOB, revision = JOB_REV + 1, attempts = 2, nextAttemptAt = NOW - 5_000 } = {}) {
  assert.ok(receipt && typeof receipt === "object" && !Array.isArray(receipt));
  assert.deepEqual(Object.keys(receipt).sort(), ["attempts", "jobId", "nextAttemptAt", "revision", "state"]);
  assert.equal(receipt.jobId, jobId);
  assert.equal(receipt.state, "queued");
  assert.equal(receipt.revision, revision);
  assert.equal(receipt.attempts, attempts);
  assert.equal(receipt.nextAttemptAt, nextAttemptAt);
}

export const LOG_FIELDS = [
  "orgId", "jobId", "action", "fromState", "state", "actorType", "actorId", "at",
  "revision", "attempt", "leaseGeneration", "evidenceScope", "errorKind", "reasonCode", "alertCode",
];
export const OPKEY_FIELDS = ["orgId", "realm", "keyVersion", "requestDigest", "result", "createdAt"];
export const semanticKeys = (record) => Object.keys(record).filter((k) => k !== "_id" && k !== "updatedAt").sort();

/** 成功写集 J+L+O+D+A 内容级断言。 */
export function assertSuccessWriteSet(h, { jobId = JOB, revision = JOB_REV + 1, key, enroll = true,
  expectedAttempts = 2, expectedNextAttemptAt = NOW - 5_000 } = {}) {
  const ctx = opContextFor({ env: h.env, idempotencyKey: key });

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
  assert.equal(log.evidenceScope, "simulated");

  const op = find(h.store, OP_KEYS, ctx.opKey);
  assert.ok(op, "op key 必须存在");
  assert.deepEqual(semanticKeys(op), [...OPKEY_FIELDS].sort(), "op key 精确六语义字段");
  assert.equal(op.orgId, ORG);
  assert.equal(op.realm, ctx.config.realm);
  assert.equal(op.keyVersion, ctx.config.version);
  assert.equal(op.requestDigest, digestOf({ jobId, expectedJobRevision: revision - 1 }));
  assert.equal(op.createdAt, h.now);
  assertReceiptShape(op.result, { jobId, revision, attempts: expectedAttempts, nextAttemptAt: expectedNextAttemptAt });

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

/** O10 取证用：记录子项 pass/fail，整体 blocked 不计通过。 */
const BLOCKED_RECORDS = [];
export function expectBlocked(name, checks) {
  const results = [];
  for (const c of checks) {
    try { c.fn(); results.push({ label: c.label, ok: true }); }
    catch (e) { results.push({ label: c.label, ok: false, error: String(e && e.message || e) }); }
  }
  const record = Object.freeze({ name, blocked: true, results, at: Date.now() });
  BLOCKED_RECORDS.push(record);
  return record; // 整体 blocked：调用方不得据此计入「通过」
}
export function getBlockedRecords() { return BLOCKED_RECORDS.map((r) => ({ ...r })); }

// ===========================================================================
// D. self-check（必须真跑，证明 guard 有效）
// ===========================================================================

test("SELF-CHECK-1：guard 在模块加载前已安装 + 加载期零违规 + 模块成功加载", async (t) => {
  assert.equal(networkGuard.state.installed, true, "主守卫必须处于已安装状态");
  assert.equal(networkGuard.state.phase, "runtime", "assertNoLoadTimeViolation 通过后应切到 runtime");
  const v = getViolations();
  assert.deepEqual(v.loadTime, [], "加载期违规必须为空（被测模块加载期不得触网）");
  assert.ok(v.loadTime.length === 0, "loadTimeViolations 永久为空");

  // 被测模块必须与 guard 同处一个进程且成功加载。
  assert.equal(typeof StrictRetryService, "function", "StrictRetryService 必须已加载");
  assert.equal(typeof LocalStore, "function", "LocalStore 必须已加载");
  assert.ok(COLLECTIONS && typeof COLLECTIONS === "object", "COLLECTIONS 必须已加载");
  assert.ok(retryModule.default === StrictRetryService, "retry 模块默认导出必须指向同一类");

  // 入口覆盖清单：用户要求的每一类都必须被包裹。
  const required = [
    "net.createServer", "http.Server.prototype.listen", "https.Server.prototype.listen",
    "http.request", "http.get", "https.request", "https.get", "globalThis.fetch",
    "dns.lookup", "net.connect", "net.createConnection",
  ];
  const names = networkGuard.entries();
  for (const r of required) assert.ok(names.includes(r), `缺少必需拦截入口：${r}`);
  assert.ok(names.some((n) => n.startsWith("dns.resolve")), "dns.resolve* 入口必须被覆盖");
  assert.ok(names.length >= 20, `拦截入口总数应 >= 20，实际 ${names.length}`);

  // 顶层无被测模块静态 import 的结构性证据。
  const src = await readFile(join(here, "face-g3-testkit.mjs"), "utf8");
  assert.doesNotMatch(src, /import\s+[^;]*?\bfrom\s+["']\.\.\/lib\//,
    "testkit 顶层不得静态 import 被测模块（应全部走 top-level await 动态 import）");

  // 真实跑一次成功 + 一次失败，运行期网络违规必须为 0（Provider 0 / 无网络）。
  resetRuntimeViolations();
  const h = await setupG3(t);
  const key = h.nextKey();
  await h.retry(JOB, JOB_REV, key);
  await expectError(h.store, () => h.retry(JOB, JOB_REV + 1, key), "CONFLICT", 409);
  assert.deepEqual(getViolations().runtime, [], "成功/失败路径运行期网络违规必须为 0");
  assert.deepEqual(getViolations().loadTime, [], "运行期操作不得触碰 loadTimeViolations");
});

test("SELF-CHECK-2：每个拦截入口正控均 +1、无真实网络、runtime 可清零而 loadTime 不变", async () => {
  const results = await networkGuard.positiveControlAll();
  assert.equal(results.length, networkGuard.entries().length, "每个入口都必须有正控结果");
  for (const r of results) {
    assert.equal(r.ret.__g3Mock, true, `${r.name}: 正控返回 sentinel`);
  }
  assert.deepEqual(getViolations().runtime, [], "全部正控后运行期违规应被归零");
  assert.deepEqual(getViolations().loadTime, [], "正控绝不触碰 loadTimeViolations");
  // 正控桩未转发：用独立 mock 的 original 计数器做 airtight 证明（见 SELF-CHECK-4）。
});

test("SELF-CHECK-3：精确恢复——原始函数身份 + 原始属性描述符（含 get/set）", () => {
  const originalFetch = () => "REAL_FETCH";
  const originalGet = () => "REAL_GET";
  const target = {};
  Object.defineProperty(target, "fetch", {
    value: originalFetch, writable: true, enumerable: false, configurable: true,
  });
  Object.defineProperty(target, "get", {
    value: originalGet, writable: false, enumerable: true, configurable: true,
  });
  const accessorFn = () => "ACCESSOR_CALLED";
  const backing = () => accessorFn;
  Object.defineProperty(target, "accessor", {
    get: backing, enumerable: false, configurable: true,
  });
  const descFetch = Object.getOwnPropertyDescriptor(target, "fetch");
  const descGet = Object.getOwnPropertyDescriptor(target, "get");
  const descAccessor = Object.getOwnPropertyDescriptor(target, "accessor");

  const iso = createNetworkGuard([
    { name: "mock.fetch", obj: target, key: "fetch", mock: () => g3Mock("mock.fetch") },
    { name: "mock.get", obj: target, key: "get", mock: () => g3Mock("mock.get") },
    { name: "mock.accessor", obj: target, key: "accessor", mock: () => g3Mock("mock.accessor") },
  ]);
  iso.install();
  assert.notEqual(target.fetch, originalFetch, "安装后 fetch 应换成桩");
  assert.notEqual(target.accessor, accessorFn, "安装后 accessor 应换成桩");

  iso.restore();
  assert.equal(target.fetch, originalFetch, "fetch 必须恢复原始身份（非 bind 副本）");
  assert.equal(target.get, originalGet, "get 必须恢复原始身份");
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, "fetch"), descFetch,
    "fetch 描述符（writable/enumerable/configurable/value）必须逐项一致");
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, "get"), descGet,
    "get 描述符 writable:false/enumerable:true 必须精确恢复");
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, "accessor"), descAccessor,
    "accessor 描述符 get/set 必须精确恢复");
  assert.equal(target.accessor, accessorFn, "访问器恢复后必须重新经 getter 求值");
  assert.equal(iso.state.installed, false, "恢复后 installed 必须为 false");
});

test("SELF-CHECK-4：加载期违规负向验证 + 正控桩不转发原始函数（独立 mock，不污染主测试）", async () => {
  let forwarded = 0;
  const original = () => { forwarded += 1; return "REAL"; };
  const target = { call: original };
  const iso = createNetworkGuard([
    { name: "iso.call", obj: target, key: "call", mock: () => g3Mock("iso.call") },
  ]);
  iso.install();

  // 正控：调用桩（清理阶段在 runtime），断言计数 +1、返回 sentinel，且 original 从未被调用。
  iso.assertNoLoadTimeViolation(); // 干净 -> 切到 runtime
  const before = forwarded;
  const ret = await iso.positiveControlOne("iso.call");
  assert.equal(ret.ret.__g3Entry, "iso.call", "正控必须返回 sentinel");
  assert.equal(forwarded, before, "正控桩绝不转发到真实原始函数（original 调用计数不变）");

  // 负向：制造一次「加载期违规」，assertNoLoadTimeViolation 必须抛错。
  iso.state.phase = "load";
  target.call(); // 触发一次加载期违规
  assert.equal(iso.getViolations().loadTime.length, 1, "加载期违规必须被记录到 loadTimeViolations");
  assert.throws(
    () => iso.assertNoLoadTimeViolation(),
    (e) => e && e.code === "G3_LOADTIME_NETWORK_VIOLATION" && /加载期/.test(e.message),
    "assertNoLoadTimeViolation 必须捕获加载期违规",
  );
  assert.equal(iso.getViolations().loadTime.length, 1,
    "assertNoLoadTimeViolation 抛错时不得清除 loadTimeViolations（永久保留）");

  iso.restore();
  assert.equal(target.call, original, "独立 mock 恢复原始身份");
  assert.equal(forwarded, before, "整个过程中 original 从未被桩转发调用");

  // 主守卫完全未受污染。
  assert.deepEqual(getViolations().loadTime, [], "主守卫 loadTimeViolations 必须始终为空");
  assert.equal(networkGuard.state.phase, "runtime", "主守卫阶段必须仍为 runtime");
});
