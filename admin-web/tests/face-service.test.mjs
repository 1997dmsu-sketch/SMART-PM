/**
 * HK-AI-07B：queryJob revision 权威读模型定向测试。
 *
 * 只经过服务层 queryJob；不注册 HTTP、不启动 server、不连接 Provider/云/设备。
 *
 * 公开 failureReason 的唯一权威策略是 service.mjs 模块私有空 Set；命名空间
 * 不得导出 PUBLIC_JOB_FAILURE_REASONS（含 Symbol、default、对象属性、getter）
 * 或任何集合引用，只读复用面只有 isPublicJobFailureReason(value) => Set.has(value)。
 * 本测试显式执行 Reflect.set / Object.defineProperty / 判定函数替换并计数，
 * 只接受“全部失败、成功数为 0”，不允许按导出内容或集合方法的存在与否跳过。
 *
 * 网络零调用由运行时 guard 实测：globalThis.fetch、node:http request/get、
 * node:https request/get 五入口独立计数，覆盖 service.mjs 及其实际 adapter
 * （本提交 queryJob 不装配网络 adapter），不是 grep/静态判断。guard 在动态
 * import 之前安装，并在 before 自检/清零之前先断言模块加载期五计数全为零，
 * 避免加载期调用被清零掩盖（复审 P2）。
 *
 * 技术债（本提交不修复，统一策略落地前禁止绕过）：
 * - dto.mjs 的 publicJobResult 仍可能把 failureReason 原样投影（截断 120），
 *   且 mock-provider.mjs 仍在使用；E06 与相关 HTTP 继续 blocked。
 * - 统一策略前，publicJobResult 不得用于公开列表/读取。
 * - 后续 DTO 统一加固必须复用同一只读判定 isPublicJobFailureReason，
 *   禁止另建并行白名单或再次导出集合引用。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";

import { LocalStore } from "../lib/store.mjs";

// ---------------------------------------------------------------------------
// 运行时网络 guard：五入口独立计数，覆盖实际 adapter（若未来装配也在此计数）。
// 先安装再动态 import service.mjs，保证模块加载期也不存在未计数网络入口。
// ---------------------------------------------------------------------------
const NETWORK_KEYS = ["fetch", "httpRequest", "httpGet", "httpsRequest", "httpsGet"];
const ZERO_NETWORK = Object.freeze(Object.fromEntries(NETWORK_KEYS.map((key) => [key, 0])));
const network = { ...ZERO_NETWORK };
let networkCalls = 0; // 既有“fetch 0”证据沿用，由 guard 的 fetch 入口累加。
const networkGuard = { installed: false, originals: null, selfCheck: null, loadTime: null };

function installNetworkGuard() {
  if (networkGuard.installed) return;
  networkGuard.originals = {
    fetch: globalThis.fetch,
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
  };
  globalThis.fetch = () => {
    network.fetch += 1;
    networkCalls += 1;
    throw new Error("queryJob 不得发起 fetch");
  };
  http.request = () => {
    network.httpRequest += 1;
    throw new Error("queryJob 不得调用 node:http request");
  };
  http.get = () => {
    network.httpGet += 1;
    throw new Error("queryJob 不得调用 node:http get");
  };
  https.request = () => {
    network.httpsRequest += 1;
    throw new Error("queryJob 不得调用 node:https request");
  };
  https.get = () => {
    network.httpsGet += 1;
    throw new Error("queryJob 不得调用 node:https get");
  };
  // 同步 ESM 命名绑定（import { request } from "node:http" 也走同一实现）。
  syncBuiltinESMExports();
  networkGuard.installed = true;
}

function restoreNetworkGuard() {
  if (!networkGuard.installed) return;
  globalThis.fetch = networkGuard.originals.fetch;
  http.request = networkGuard.originals.httpRequest;
  http.get = networkGuard.originals.httpGet;
  https.request = networkGuard.originals.httpsRequest;
  https.get = networkGuard.originals.httpsGet;
  syncBuiltinESMExports();
  networkGuard.installed = false;
}

installNetworkGuard();

// 动态 import：命名空间对象在测试内可用于只读判定与篡改计数。
const serviceModule = await import("../lib/face-service/service.mjs");
const { FaceCredentialService, isPublicJobFailureReason } = serviceModule;

const orgId = "org-queryjob-revision";
const otherOrgId = "org-queryjob-other";
const now = 1_700_000_000_000;
const audit = { actor: "system", actorId: "system", action: "HK-AI-07B queryJob revision" };
const ref = (collection, id) => ({ collection, id });

// 导出面只允许服务类 + 只读判定；六个 DTO 字段按字典序冻结。
const EXPECTED_EXPORTS = ["FaceCredentialService", "isPublicJobFailureReason"];
const DTO_FIELDS = ["attempts", "failureReason", "jobId", "lastSuccessAt", "revision", "state"];
// 任何非 null 值（含合法短码）都必须被只读判定拒绝；null/undefined 由服务层先行投影。
const REJECTED_REASON_VALUES = [
  null,
  undefined,
  "INTERNAL_ONLY_REASON",
  "PROVIDER_TIMEOUT",
  "FACE_NOT_FOUND",
  "E1001",
  "A",
  "A".repeat(120),
  "result_unknown",
  "",
  "A".repeat(121),
  "BAD\u0000CODE",
  { message: "secret" },
  ["PROVIDER_TIMEOUT"],
  0,
  true,
];

// 篡改计数：每个显式尝试 +1，只有“调用成功且命名空间真的暴露了篡改值”才 +1。
const TAMPER = { attempts: 0, successes: 0 };

const providerCalls = { count: 0 };
const fileCalls = { count: 0 };
const reads = [];
let serviceWrites = 0;

const provider = {
  enrollFace() { providerCalls.count += 1; throw new Error("queryJob 不得调用 Provider"); },
  updateFace() { providerCalls.count += 1; throw new Error("queryJob 不得调用 Provider"); },
  revokeFace() { providerCalls.count += 1; throw new Error("queryJob 不得调用 Provider"); },
  queryOperation() { providerCalls.count += 1; throw new Error("queryJob 不得调用 Provider"); },
  verifyEvent() { providerCalls.count += 1; throw new Error("queryJob 不得调用 Provider"); },
};
const files = {
  prepareReference() { fileCalls.count += 1; throw new Error("queryJob 不得读取私密人脸文件"); },
  assertReference() { fileCalls.count += 1; throw new Error("queryJob 不得读取私密人脸文件"); },
  assertBinding() { fileCalls.count += 1; throw new Error("queryJob 不得读取私密人脸文件"); },
};

let dir;
let store;

const longJobId = "job-" + "a".repeat(125); // 129 字符，超出 assertBoundedId 上限

function trackedStore() {
  return {
    get: async (name, id, org) => {
      reads.push(`get:${name}`);
      return store.get(name, id, org);
    },
    list: async (...args) => {
      reads.push("list");
      return store.list(...args);
    },
    transact: async (...args) => {
      serviceWrites += 1;
      return store.transact(...args);
    },
  };
}

function forgedJobStore(id, patch) {
  return {
    get: async (name, jobId, org) => {
      reads.push(`get:${name}`);
      const row = await store.get(name, jobId, org);
      if (name === "device_operation_jobs" && jobId === id) return { ...row, ...patch };
      return row;
    },
    list: async (...args) => {
      reads.push("list");
      return store.list(...args);
    },
    transact: async (...args) => {
      serviceWrites += 1;
      return store.transact(...args);
    },
  };
}

function service(membershipId, storeOverride = trackedStore()) {
  return new FaceCredentialService({
    store: storeOverride,
    orgId,
    actor: { membershipId, actorType: "user", actorId: membershipId },
    files,
    blacklist: {},
    provider,
    now: () => now,
  });
}

async function expectInvalidJob(id, { storeOverride } = {}) {
  const before = structuredClone(store.data);
  reads.length = 0;
  await assert.rejects(
    () => service("mem-audit", storeOverride).queryJob(id),
    (error) => error.code === "INVALID_JOB" && error.status === 409,
    `queryJob(${id}) 必须 INVALID_JOB/409 失败关闭`,
  );
  assert.deepEqual(store.data, before, `queryJob(${id}) 不得写入任何集合`);
  assert.deepEqual(reads, ["get:org_memberships", "get:device_operation_jobs"], `queryJob(${id}) 只允许两次点查`);
}

async function rejectionOf(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail("预期 queryJob 失败关闭");
}

function assertSixPrimitiveFields(dto) {
  assert.deepEqual(Object.keys(dto).sort(), DTO_FIELDS);
  assert.equal(Object.keys(dto).length, 6);
  for (const [field, value] of Object.entries(dto)) {
    assert.ok(value === null || typeof value !== "object", `${field} 不得泄露对象/集合引用`);
  }
}

function assertNoCollectionExport(value, label) {
  assert.equal(value instanceof Set, false, `${label} 不得是 Set`);
  assert.equal(value instanceof Map, false, `${label} 不得是 Map`);
  assert.equal(value instanceof WeakSet, false, `${label} 不得是 WeakSet`);
  assert.equal(value instanceof WeakMap, false, `${label} 不得是 WeakMap`);
  assert.equal(value instanceof Array, false, `${label} 不得是 Array`);
  assert.equal(Array.isArray(value), false, `${label} 不得是 Array`);
}

function assertNoWhitelistExport(ns, label = "命名空间") {
  assert.equal(Object.hasOwn(ns, "PUBLIC_JOB_FAILURE_REASONS"), false, `${label} 不得导出 PUBLIC_JOB_FAILURE_REASONS`);
  assert.equal("PUBLIC_JOB_FAILURE_REASONS" in ns, false, `${label} 不得导出 PUBLIC_JOB_FAILURE_REASONS`);
  assert.equal(ns.PUBLIC_JOB_FAILURE_REASONS, undefined, `${label} 不得经属性读出白名单`);
  assert.equal(Object.hasOwn(ns, "default"), false, `${label} 不得导出 default`);
  assert.deepEqual(
    Object.getOwnPropertySymbols(ns).filter((symbol) => symbol !== Symbol.toStringTag),
    [],
    `${label} 不得导出 Symbol 键`,
  );
  assert.deepEqual(Object.keys(ns).sort(), EXPECTED_EXPORTS, `${label} 导出面只允许服务类与只读判定`);
  assert.equal(typeof ns.FaceCredentialService, "function", `${label} 必须导出服务类`);
  assert.equal(typeof ns.isPublicJobFailureReason, "function", `${label} 必须导出只读判定`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(ns))) {
    assert.equal(typeof descriptor.get, "undefined", `${key} 不得是 getter 导出`);
    assertNoCollectionExport(descriptor.value, `${label}.${key}`);
  }
}

// 篡改尝试后：命名空间仍不暴露白名单，判定仍拒绝内部码。
function assertPolicyStillClosed(ns, label) {
  assert.equal(Object.hasOwn(ns, "PUBLIC_JOB_FAILURE_REASONS"), false, `${label} 篡改后不得新增导出`);
  assert.equal(ns.PUBLIC_JOB_FAILURE_REASONS, undefined, `${label} 篡改后不得读出白名单`);
  assert.equal(ns.isPublicJobFailureReason("INTERNAL_ONLY_REASON"), false, `${label} 篡改后判定必须仍为 false`);
}

function attemptReflectSet(ns, key, value, label) {
  TAMPER.attempts += 1;
  let outcome;
  let threw = null;
  try {
    outcome = Reflect.set(ns, key, value);
  } catch (error) {
    threw = error;
  }
  assert.ok(threw === null || threw instanceof TypeError, `${label}: 只允许返回 false 或 TypeError`);
  const applied = threw === null && outcome === true;
  const persisted = applied && ns[key] === value;
  if (persisted) TAMPER.successes += 1;
  assert.equal(applied, false, `${label}: Reflect.set 必须失败（false 或 TypeError）`);
  assert.equal(persisted, false, `${label}: 篡改不得持久化`);
}

function attemptDefineProperty(ns, key, value, label) {
  TAMPER.attempts += 1;
  let succeeded = false;
  let error = null;
  try {
    Object.defineProperty(ns, key, {
      value, configurable: true, enumerable: true, writable: true,
    });
    succeeded = true;
  } catch (caught) {
    error = caught;
  }
  if (succeeded) TAMPER.successes += 1;
  assert.ok(error instanceof TypeError, `${label}: Object.defineProperty 必须 TypeError`);
  assert.equal(succeeded, false, `${label}: 篡改不得生效`);
}

function attemptReplacePredicate(ns, label) {
  const replacement = () => true;
  TAMPER.attempts += 1;
  const previous = ns.isPublicJobFailureReason;
  let outcome;
  let threw = null;
  try {
    outcome = Reflect.set(ns, "isPublicJobFailureReason", replacement);
  } catch (error) {
    threw = error;
  }
  assert.ok(threw === null || threw instanceof TypeError, `${label}: 只允许返回 false 或 TypeError`);
  const applied = threw === null && outcome === true;
  if (applied && ns.isPublicJobFailureReason === replacement) TAMPER.successes += 1;
  assert.equal(applied, false, `${label}: 判定函数不得被替换`);
  assert.equal(ns.isPublicJobFailureReason, previous, `${label}: 判定函数身份不变`);
  assert.equal(ns.isPublicJobFailureReason("INTERNAL_ONLY_REASON"), false, `${label}: 替换失败后判定仍为 false`);
}

function tamperNamespace(ns, label) {
  const privateShadow = new Set(["INTERNAL_ONLY_REASON"]);
  attemptReflectSet(ns, "PUBLIC_JOB_FAILURE_REASONS", privateShadow, `${label} Reflect.set(PUBLIC_JOB_FAILURE_REASONS)`);
  assertPolicyStillClosed(ns, `${label} Reflect.set 白名单后`);
  attemptDefineProperty(ns, "PUBLIC_JOB_FAILURE_REASONS", privateShadow, `${label} Object.defineProperty(PUBLIC_JOB_FAILURE_REASONS)`);
  assertPolicyStillClosed(ns, `${label} defineProperty 白名单后`);
  attemptReplacePredicate(ns, `${label} Reflect.set(isPublicJobFailureReason)`);
  assertPolicyStillClosed(ns, `${label} Reflect.set 判定函数后`);
  attemptDefineProperty(ns, "isPublicJobFailureReason", () => true, `${label} Object.defineProperty(isPublicJobFailureReason)`);
  assertPolicyStillClosed(ns, `${label} defineProperty 判定函数后`);
}

// 既有防御保留：若未来把集合挂到导出面，这里会真实调用 add/set/push/clear/delete，
// 调用后策略必须仍为空；不与上面的显式篡改计数混用，避免弱化任一侧。
function attemptPolicyMutation(ns) {
  for (const exported of Object.values(ns)) {
    for (const method of ["add", "set", "push", "clear", "delete"]) {
      const mutate = exported?.[method];
      if (typeof mutate === "function") {
        try {
          mutate.call(exported, "PROVIDER_TIMEOUT");
        } catch {
          // 拒绝调用同样不改变策略；统一在下面断言。
        }
      }
    }
  }
}

before(async () => {
  // 先冻结并断言“模块加载期”五类网络计数为零，再做 guard 自检与归零。
  // 顺序不可颠倒：自检会人为把计数加到 1 后清零，若加载期已有真实调用，
  // 清零就会把它掩盖掉（复审 P2）。此断言必须发生在任何清零之前。
  networkGuard.loadTime = { ...network };
  for (const key of NETWORK_KEYS) {
    assert.equal(
      networkGuard.loadTime[key], 0,
      `模块加载期 ${key} 计数必须为 0（不得被 guard 自检/清零掩盖）`,
    );
  }

  // guard 自检：确认五入口确实被替换并可计数，随后归零，正式场景从零开始计。
  networkGuard.selfCheck = {};
  for (const [key, probe] of [
    ["fetch", () => globalThis.fetch("https://network.invalid/queryjob")],
    ["httpRequest", () => http.request("http://127.0.0.1:9/queryjob")],
    ["httpGet", () => http.get("http://127.0.0.1:9/queryjob")],
    ["httpsRequest", () => https.request("https://127.0.0.1:9/queryjob")],
    ["httpsGet", () => https.get("https://127.0.0.1:9/queryjob")],
  ]) {
    const beforeCount = network[key];
    let threw = false;
    try {
      probe();
    } catch {
      threw = true;
    }
    networkGuard.selfCheck[key] = { threw, delta: network[key] - beforeCount };
  }
  networkCalls = 0;
  for (const key of NETWORK_KEYS) network[key] = 0;

  dir = await mkdtemp(join(tmpdir(), "smartpm-face-queryjob-revision-"));
  store = new LocalStore(dir);
  await store.init();

  const memberships = [
    ["mem-audit", ["device.audit.read"]],
    ["mem-none", []],
    ["mem-revoke", ["device.audit.read"]],
    ["mem-revoke-next", ["device.audit.read"]],
    ["mem-suspended", ["device.audit.read"], { status: "suspended" }],
  ];
  const jobs = [
    ["job-qjr-queued", { orgId, action: "enroll", state: "queued", revision: 1, attempts: 0 }],
    ["job-qjr-rev7", { orgId, action: "revoke", state: "retryable_failed", revision: 7, attempts: 2, lastSuccessAt: 1_699_999_999_000, failureReason: null }],
    ["job-qjr-rev2", { orgId, action: "enroll", state: "succeeded", revision: 2, attempts: 1, lastSuccessAt: 1_700_000_000_000 }],
    ["job-qjr-mutate", { orgId, action: "enroll", state: "queued", revision: 3, attempts: 0 }],
    ["job-qjr-other-org", { orgId: otherOrgId, action: "enroll", state: "queued", revision: 4, attempts: 0 }],
    ["job-qjr-missing-revision", { orgId, action: "enroll", state: "queued", attempts: 0 }],
    ["job-qjr-revision-string", { orgId, action: "enroll", state: "queued", revision: "1", attempts: 0 }],
    ["job-qjr-revision-zero", { orgId, action: "enroll", state: "queued", revision: 0, attempts: 0 }],
    ["job-qjr-revision-negative", { orgId, action: "enroll", state: "queued", revision: -1, attempts: 0 }],
    ["job-qjr-revision-fraction", { orgId, action: "enroll", state: "queued", revision: 1.5, attempts: 0 }],
    ["job-qjr-revision-over", { orgId, action: "enroll", state: "queued", revision: Number.MAX_SAFE_INTEGER + 1, attempts: 0 }],
    ["job-qjr-state", { orgId, action: "enroll", state: "paused", revision: 1, attempts: 0 }],
    ["job-qjr-attempts-string", { orgId, action: "enroll", state: "queued", revision: 1, attempts: "1" }],
    ["job-qjr-attempts-negative", { orgId, action: "enroll", state: "queued", revision: 1, attempts: -1 }],
    ["job-qjr-attempts-fraction", { orgId, action: "enroll", state: "queued", revision: 1, attempts: 1.5 }],
    ["job-qjr-attempts-over", { orgId, action: "enroll", state: "queued", revision: 1, attempts: Number.MAX_SAFE_INTEGER + 1 }],
    ["job-qjr-last-string", { orgId, action: "enroll", state: "queued", revision: 1, attempts: 0, lastSuccessAt: "1" }],
    ["job-qjr-last-negative", { orgId, action: "enroll", state: "queued", revision: 1, attempts: 0, lastSuccessAt: -1 }],
    ["job-qjr-last-fraction", { orgId, action: "enroll", state: "queued", revision: 1, attempts: 0, lastSuccessAt: 1.5 }],
    ["job-qjr-last-over", { orgId, action: "enroll", state: "queued", revision: 1, attempts: 0, lastSuccessAt: Number.MAX_SAFE_INTEGER + 1 }],
    ["job-qjr-fr-null", { orgId, action: "enroll", state: "queued", revision: 1, attempts: 0, failureReason: null }],
    ["job-qjr-fr-internal", { orgId, action: "enroll", state: "terminal_failed", revision: 1, attempts: 1, failureReason: "INTERNAL_ONLY_REASON" }],
    ["job-qjr-fr-provider", { orgId, action: "enroll", state: "terminal_failed", revision: 1, attempts: 1, failureReason: "PROVIDER_TIMEOUT" }],
    ["job-qjr-fr-valid-a", { orgId, action: "enroll", state: "terminal_failed", revision: 1, attempts: 1, failureReason: "A" }],
    ["job-qjr-fr-valid-120", { orgId, action: "enroll", state: "terminal_failed", revision: 1, attempts: 1, failureReason: "A".repeat(120) }],
    ["job-qjr-fr-lower", { orgId, action: "enroll", state: "terminal_failed", revision: 1, attempts: 1, failureReason: "result_unknown" }],
    ["job-qjr-fr-long", { orgId, action: "enroll", state: "terminal_failed", revision: 1, attempts: 1, failureReason: "A".repeat(121) }],
    ["job-qjr-fr-control", { orgId, action: "enroll", state: "terminal_failed", revision: 1, attempts: 1, failureReason: "BAD\u0000CODE" }],
    ["job-qjr-fr-array", { orgId, action: "enroll", state: "terminal_failed", revision: 1, attempts: 1, failureReason: ["PROVIDER_TIMEOUT"] }],
    ["job-qjr-fr-object", { orgId, action: "enroll", state: "queued", revision: 1, attempts: 0, failureReason: { message: "secret" } }],
    ["job-qjr-fr-stack", { orgId, action: "enroll", state: "queued", revision: 1, attempts: 0, failureReason: new Error("boom").stack }],
    ["job-qjr-fr-message", { orgId, action: "enroll", state: "queued", revision: 1, attempts: 0, failureReason: "/private/face/secret.jpg: permission denied" }],
    ["job-qjr-fr-empty", { orgId, action: "enroll", state: "queued", revision: 1, attempts: 0, failureReason: "" }],
    ["job-qjr-id-mismatch", { orgId, action: "enroll", state: "queued", revision: 1, attempts: 0, jobId: "job-qjr-other-id" }],
    [longJobId, { orgId, action: "enroll", state: "queued", revision: 1, attempts: 0 }],
  ];

  await store.transact(
    [
      ref("organizations", orgId),
      ref("organizations", otherOrgId),
      ...memberships.map(([id]) => ref("org_memberships", id)),
      ...jobs.map(([id]) => ref("device_operation_jobs", id)),
    ],
    () => [
      {
        collection: "organizations",
        id: orgId,
        data: { name: "QueryJob 组织", status: "active", revision: 1 },
      },
      {
        collection: "organizations",
        id: otherOrgId,
        data: { name: "QueryJob 其他组织", status: "active", revision: 1 },
      },
      ...memberships.map(([id, permissions, extra]) => ({
        collection: "org_memberships",
        id,
        data: {
          orgId,
          status: "active",
          role: "admin",
          principalType: "adminAccount",
          principalId: id,
          permissions,
          revision: 1,
          ...extra,
        },
      })),
      ...jobs.map(([id, data]) => ({ collection: "device_operation_jobs", id, data })),
    ],
    audit,
  );
});

after(async () => {
  restoreNetworkGuard();
  await rm(dir, { recursive: true, force: true });
});

test("07B-01 有权查询返回精确六字段 DTO，revision 取当前持久化记录", async () => {
  reads.length = 0;
  const dto = await service("mem-audit").queryJob("job-qjr-queued");
  assert.deepEqual(dto, {
    jobId: "job-qjr-queued",
    state: "queued",
    revision: 1,
    attempts: 0,
    lastSuccessAt: null,
    failureReason: null,
  });
  assertSixPrimitiveFields(dto);
  assert.deepEqual(reads, ["get:org_memberships", "get:device_operation_jobs"]);
});

test("07B-02 不同 job 各自 revision；同一 job 逐次读取当前持久化值", async () => {
  assert.equal((await service("mem-audit").queryJob("job-qjr-rev7")).revision, 7);
  assert.equal((await service("mem-audit").queryJob("job-qjr-rev2")).revision, 2);
  assert.equal((await service("mem-audit").queryJob("job-qjr-mutate")).revision, 3);

  for (const revision of [5, 9]) {
    await store.transact([ref("device_operation_jobs", "job-qjr-mutate")], (state) => [{
      collection: "device_operation_jobs",
      id: "job-qjr-mutate",
      data: { ...state["device_operation_jobs/job-qjr-mutate"], revision },
    }], audit);
    assert.equal((await service("mem-audit").queryJob("job-qjr-mutate")).revision, revision);
  }
  assert.equal((await service("mem-audit").queryJob("job-qjr-rev7")).revision, 7);
});

test("07B-03 revision 缺失/字符串/0/-1/小数/超安全整数失败关闭", async () => {
  for (const id of [
    "job-qjr-missing-revision",
    "job-qjr-revision-string",
    "job-qjr-revision-zero",
    "job-qjr-revision-negative",
    "job-qjr-revision-fraction",
    "job-qjr-revision-over",
  ]) {
    await expectInvalidJob(id);
  }
});

test("07B-04 state/attempts/lastSuccessAt 非法失败关闭", async () => {
  for (const id of [
    "job-qjr-state",
    "job-qjr-attempts-string",
    "job-qjr-attempts-negative",
    "job-qjr-attempts-fraction",
    "job-qjr-attempts-over",
    "job-qjr-last-string",
    "job-qjr-last-negative",
    "job-qjr-last-fraction",
    "job-qjr-last-over",
  ]) {
    await expectInvalidJob(id);
  }
});

test("07B-05 内部 _id 有界且等于查询目标；ID 不一致失败关闭", async () => {
  await expectInvalidJob("job-qjr-id-mismatch");
  await expectInvalidJob("job-qjr-queued", {
    storeOverride: forgedJobStore("job-qjr-queued", { _id: "job-qjr-forged" }),
  });
  await expectInvalidJob(longJobId);
});

test("07B-06 命名空间无 PUBLIC_JOB_FAILURE_REASONS/集合引用；add/set/push 不可改策略；重复 import 不变", async () => {
  assertNoWhitelistExport(serviceModule);

  // 导出面只允许函数类入口，不得存在 add/set/push 等可写集合方法。
  for (const exported of Object.values(serviceModule)) {
    for (const method of ["add", "set", "push", "clear", "delete"]) {
      assert.equal(Object.hasOwn(exported, method), false, `${method} 不得成为导出面可写入口`);
    }
  }

  attemptPolicyMutation(serviceModule);
  for (const value of REJECTED_REASON_VALUES) {
    assert.equal(isPublicJobFailureReason(value), false, `外部 add/set/push 后策略仍不得包含 ${String(value)}`);
  }
  assertPolicyStillClosed(serviceModule, "主命名空间");

  // 重复 import 得到独立模块实例：导出面与只读策略必须保持一致且仍为空。
  const reimported = await import("../lib/face-service/service.mjs?policy-reimport=1");
  assert.notEqual(reimported, serviceModule, "查询串 import 必须是新的模块实例");
  assertNoWhitelistExport(reimported, "重复 import 命名空间");
  attemptPolicyMutation(reimported);
  assertPolicyStillClosed(reimported, "重复 import 命名空间");
  for (const value of REJECTED_REASON_VALUES) {
    assert.equal(reimported.isPublicJobFailureReason(value), false);
    assert.equal(reimported.isPublicJobFailureReason(value), isPublicJobFailureReason(value));
  }

  // 导出类的实例与原型也不得暴露集合引用或 getter。
  const probe = new FaceCredentialService({
    store: {},
    orgId: "org-export-probe",
    actor: { membershipId: "mem-export-probe" },
    files: {},
    blacklist: {},
    provider: {},
  });
  for (const object of [probe, Object.getPrototypeOf(probe)]) {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(object))) {
      assert.equal(typeof descriptor.get, "undefined", `${key} 不得是实例/原型 getter`);
      assertNoCollectionExport(descriptor.value, key);
    }
  }
});

test("07B-07 只读判定：null 按契约、内部码/Provider 码/任意合法短码均 false", () => {
  assert.equal(typeof isPublicJobFailureReason, "function");
  assert.equal(typeof isPublicJobFailureReason("PROVIDER_TIMEOUT"), "boolean");
  // null 由 queryJobDto 先按契约投影为 null，不进入白名单，因此判定必须是 false。
  assert.equal(isPublicJobFailureReason(null), false);
  assert.equal(isPublicJobFailureReason(undefined), false);
  for (const value of [
    "INTERNAL_ONLY_REASON",
    "PROVIDER_TIMEOUT",
    "FACE_NOT_FOUND",
    "E1001",
    "A",
    "A".repeat(120),
  ]) {
    assert.equal(isPublicJobFailureReason(value), false, value);
  }
  // 非字符串一律 false：不字符串化、不正则匹配、不隐式放行。
  for (const value of [0, 1, true, false, {}, [], ["PROVIDER_TIMEOUT"], Symbol("PROVIDER_TIMEOUT"), "lower", ""]) {
    assert.equal(isPublicJobFailureReason(value), false);
  }
});

test("07B-08 null 正常投影且 DTO 恰好六字段；读路径不写任何集合", async () => {
  const snapshot = structuredClone(store.data);
  for (const id of ["job-qjr-fr-null", "job-qjr-queued", "job-qjr-rev2"]) {
    reads.length = 0;
    const dto = await service("mem-audit").queryJob(id);
    assertSixPrimitiveFields(dto);
    assert.equal(dto.failureReason, null, id);
    assert.deepEqual(reads, ["get:org_memberships", "get:device_operation_jobs"], id);
  }
  assert.deepEqual(store.data, snapshot);
});

test("07B-09 非 null 值全部 INVALID_JOB/409：合法短码/小写/空串/超长/NUL/对象/数组/stack/message", async () => {
  for (const id of [
    "job-qjr-fr-provider",    // 格式合法的 Provider 原始短码
    "job-qjr-fr-valid-a",     // 单字符合法短码
    "job-qjr-fr-valid-120",   // 120 字符合法边界
    "job-qjr-fr-internal",    // 内部 reasonCode
    "job-qjr-fr-lower",       // 小写
    "job-qjr-fr-empty",       // 空串
    "job-qjr-fr-long",        // 超长
    "job-qjr-fr-control",     // NUL/控制字符
    "job-qjr-fr-object",      // 对象
    "job-qjr-fr-stack",       // 原始 stack
    "job-qjr-fr-message",     // message/路径
    "job-qjr-fr-array",       // 数组
  ]) {
    // expectInvalidJob 每次调用都断言 store.data 前后 deepEqual、只允许两次点查。
    await expectInvalidJob(id);
  }
});

test("07B-10 不存在与跨组织同态 404", async () => {
  reads.length = 0;
  const missing = await rejectionOf(() => service("mem-audit").queryJob("job-qjr-missing"));
  assert.equal(missing.code, "NOT_FOUND");
  assert.equal(missing.status, 404);
  const missingReads = [...reads];

  reads.length = 0;
  const cross = await rejectionOf(() => service("mem-audit").queryJob("job-qjr-other-org"));
  assert.equal(cross.code, "NOT_FOUND");
  assert.equal(cross.status, 404);
  assert.equal(cross.message, missing.message);
  assert.deepEqual(reads, missingReads);
});

test("07B-11 无权 403；撤权后下一次立即拒绝", async () => {
  reads.length = 0;
  await assert.rejects(
    () => service("mem-none").queryJob("job-qjr-queued"),
    (error) => error.code === "FORBIDDEN" && error.status === 403,
  );
  assert.deepEqual(reads, ["get:org_memberships"]);

  assert.equal((await service("mem-revoke").queryJob("job-qjr-queued")).jobId, "job-qjr-queued");
  await store.transact([ref("org_memberships", "mem-revoke")], (state) => [{
    collection: "org_memberships",
    id: "mem-revoke",
    data: { ...state["org_memberships/mem-revoke"], permissions: [] },
  }], audit);
  const snapshot = structuredClone(store.data);
  reads.length = 0;
  await assert.rejects(
    () => service("mem-revoke").queryJob("job-qjr-queued"),
    (error) => error.code === "FORBIDDEN" && error.status === 403,
  );
  assert.deepEqual(store.data, snapshot);
  assert.deepEqual(reads, ["get:org_memberships"]);
});

test("07B-12 响应敏感字段扫描零命中", async () => {
  const dto = await service("mem-audit").queryJob("job-qjr-rev7");
  const text = JSON.stringify(dto);
  for (const token of [
    "orgId", "credentialId", "personId", "deviceId", "grantId", "claimId", "slotId",
    "lease", "leaseOwner", "leaseGeneration", "nextAttemptAt", "requestDigest",
    "operation", "key", "evidence", "digest", "cleanupSnapshot", "provider",
    "executionMode", "result", "stack", "message", "_id",
  ]) {
    assert.equal(text.includes(token), false, `敏感字段命中：${token}`);
  }
  assert.equal(text.includes("undefined"), false);
});

test("07B-13 读路径零写入：所有集合 deepEqual、transact 0、list 0", async () => {
  const snapshot = structuredClone(store.data);
  const writesBefore = serviceWrites;
  reads.length = 0;

  assert.equal((await service("mem-audit").queryJob("job-qjr-queued")).revision, 1);
  assert.equal((await service("mem-audit").queryJob("job-qjr-rev7")).revision, 7);
  for (const [id, code] of [
    ["job-qjr-revision-zero", "INVALID_JOB"],
    ["job-qjr-missing", "NOT_FOUND"],
    ["job-qjr-other-org", "NOT_FOUND"],
  ]) {
    await assert.rejects(
      () => service("mem-audit").queryJob(id),
      (error) => error.code === code,
    );
  }
  await assert.rejects(
    () => service("mem-none").queryJob("job-qjr-queued"),
    (error) => error.code === "FORBIDDEN",
  );

  assert.deepEqual(store.data, snapshot);
  assert.equal(serviceWrites, writesBefore);
  assert.equal(reads.includes("list"), false);
  for (const read of reads) {
    assert.ok(read === "get:org_memberships" || read === "get:device_operation_jobs", read);
  }
  assert.equal(reads.filter((read) => read === "get:org_memberships").length, 6);
  assert.equal(reads.filter((read) => read === "get:device_operation_jobs").length, 5);
});

test("07B-14 全程 Provider/网络/私密文件调用为零，服务层零写", () => {
  assert.equal(providerCalls.count, 0);
  assert.equal(networkCalls, 0);
  assert.equal(fileCalls.count, 0);
  assert.equal(serviceWrites, 0);
});

test("07B-15 成功场景与成员停用场景：请求前后 store.data 全量 deepEqual，正式错误码正确", async () => {
  // 成功场景：精确六字段 + 全量状态不变。
  const successSnapshot = structuredClone(store.data);
  const dto = await service("mem-audit").queryJob("job-qjr-queued");
  assert.deepEqual(dto, {
    jobId: "job-qjr-queued",
    state: "queued",
    revision: 1,
    attempts: 0,
    lastSuccessAt: null,
    failureReason: null,
  });
  assertSixPrimitiveFields(dto);
  const successAfter = structuredClone(store.data);
  assert.deepEqual(successAfter, successSnapshot, "成功场景不得改动任何集合");

  // fixture 已停用成员：正式权限错误，且不得点查任务记录。
  const suspendedSnapshot = structuredClone(store.data);
  reads.length = 0;
  const suspended = await rejectionOf(() => service("mem-suspended").queryJob("job-qjr-queued"));
  assert.equal(suspended.code, "FORBIDDEN", "成员停用必须 FORBIDDEN");
  assert.equal(suspended.status, 403, "成员停用必须 403");
  assert.deepEqual(reads, ["get:org_memberships"], "成员停用必须先于任务点查失败关闭");
  const suspendedAfter = structuredClone(store.data);
  assert.deepEqual(suspendedAfter, suspendedSnapshot, "成员停用场景不得改动任何集合");
});

test("07B-16 独立权限场景矩阵：每场景前后 structuredClone(store.data) deepEqual 且错误正式", async () => {
  const scenarios = [
    {
      label: "不存在任务 NOT_FOUND/404",
      code: "NOT_FOUND",
      status: 404,
      run: () => service("mem-audit").queryJob("job-qjr-missing"),
    },
    {
      label: "跨组织同态 NOT_FOUND/404",
      code: "NOT_FOUND",
      status: 404,
      run: () => service("mem-audit").queryJob("job-qjr-other-org"),
    },
    {
      label: "无 device.audit.read FORBIDDEN/403",
      code: "FORBIDDEN",
      status: 403,
      run: () => service("mem-none").queryJob("job-qjr-queued"),
    },
    {
      label: "预读成功后撤销权限，下一次 FORBIDDEN/403",
      // 权限撤销属于 fixture 变更，必须发生在 before 快照之前。
      prepare: async () => {
        assert.equal((await service("mem-revoke-next").queryJob("job-qjr-queued")).jobId, "job-qjr-queued");
        await store.transact([ref("org_memberships", "mem-revoke-next")], (state) => [{
          collection: "org_memberships",
          id: "mem-revoke-next",
          data: { ...state["org_memberships/mem-revoke-next"], permissions: [], revision: 2 },
        }], audit);
      },
      code: "FORBIDDEN",
      status: 403,
      run: () => service("mem-revoke-next").queryJob("job-qjr-queued"),
    },
    {
      label: "成员停用 FORBIDDEN/403",
      code: "FORBIDDEN",
      status: 403,
      run: () => service("mem-suspended").queryJob("job-qjr-queued"),
    },
  ];

  for (const scenario of scenarios) {
    if (scenario.prepare) await scenario.prepare();
    // 每个独立场景：请求前后各取一次 structuredClone(store.data) 全量快照。
    const beforeSnapshot = structuredClone(store.data);
    reads.length = 0;
    const error = await rejectionOf(scenario.run);
    const afterSnapshot = structuredClone(store.data);
    assert.equal(error.code, scenario.code, `${scenario.label}: 错误码`);
    assert.equal(error.status, scenario.status, `${scenario.label}: 状态码`);
    assert.deepEqual(afterSnapshot, beforeSnapshot, `${scenario.label}: 请求前后 store.data 全量 deepEqual`);
    assert.equal(reads.includes("list"), false, `${scenario.label}: 读路径不得 list`);
  }
});

test("07B-17 动态 import 命名空间篡改：显式 Reflect.set/defineProperty/替换判定全部失败并计数", async (t) => {
  const fresh = await import("../lib/face-service/service.mjs?tamper-instance=1");
  assert.notEqual(fresh, serviceModule, "查询串 import 必须是新的模块对象");
  assert.deepEqual(Object.keys(fresh).sort(), EXPECTED_EXPORTS, "新实例必须精确同样导出");
  assert.notEqual(fresh.FaceCredentialService, FaceCredentialService, "新实例必须是独立模块实例");
  assert.equal(typeof fresh.isPublicJobFailureReason, "function");
  assertNoWhitelistExport(fresh, "查询串实例");

  // 主命名空间：白名单键 Reflect.set / defineProperty、判定函数 Reflect.set / defineProperty。
  tamperNamespace(serviceModule, "主命名空间");
  // 查询串新实例：至少再实际尝试一轮同样的四条路径。
  tamperNamespace(fresh, "查询串实例");

  assert.ok(TAMPER.attempts >= 4, `篡改尝试次数必须 >= 4，实际 ${TAMPER.attempts}`);
  assert.equal(TAMPER.successes, 0, `篡改成功次数必须为 0，实际 ${TAMPER.successes}`);
  // 每次尝试内部都会断言判定仍拒绝内部码，这里再显式复核两个命名空间。
  assert.equal(serviceModule.isPublicJobFailureReason("INTERNAL_ONLY_REASON"), false);
  assert.equal(fresh.isPublicJobFailureReason("INTERNAL_ONLY_REASON"), false);
  assert.equal(isPublicJobFailureReason("INTERNAL_ONLY_REASON"), false);
  t.diagnostic(`tamperAttempts=${TAMPER.attempts} tamperSuccesses=${TAMPER.successes}`);
});

test("07B-18 运行时网络 guard 自检：五入口均已替换且可计数（自检后归零）", (t) => {
  assert.deepEqual(Object.keys(networkGuard.selfCheck).sort(), [...NETWORK_KEYS].sort());
  for (const key of NETWORK_KEYS) {
    assert.deepEqual(
      networkGuard.selfCheck[key],
      { threw: true, delta: 1 },
      `${key} 入口必须被 guard 替换并准确计数`,
    );
  }
  for (const key of NETWORK_KEYS) {
    assert.equal(network[key], 0, `自检归零后 ${key} 必须为 0`);
  }
  // 复审 P2：模块加载期（guard 安装后、before 自检前）的真实调用必须被单独记录并为零。
  assert.deepEqual(networkGuard.loadTime, { ...ZERO_NETWORK }, "模块加载期五类计数必须全为 0");
  t.diagnostic(`guardLoadTime=${JSON.stringify(networkGuard.loadTime)}`);
  t.diagnostic(`guardSelfCheck=${JSON.stringify(networkGuard.selfCheck)}`);
});

test("07B-19 成功/404/403/INVALID_JOB 四类 queryJob 路径：五类网络入口计数独立为零", async (t) => {
  const scenarios = [
    {
      label: "成功",
      run: async () => {
        const dto = await service("mem-audit").queryJob("job-qjr-queued");
        assert.equal(dto.jobId, "job-qjr-queued");
      },
    },
    {
      label: "404 NOT_FOUND",
      run: async () => {
        const error = await rejectionOf(() => service("mem-audit").queryJob("job-qjr-missing"));
        assert.equal(error.code, "NOT_FOUND");
        assert.equal(error.status, 404);
      },
    },
    {
      label: "403 FORBIDDEN",
      run: async () => {
        const error = await rejectionOf(() => service("mem-none").queryJob("job-qjr-queued"));
        assert.equal(error.code, "FORBIDDEN");
        assert.equal(error.status, 403);
      },
    },
    {
      label: "409 INVALID_JOB",
      run: async () => {
        const error = await rejectionOf(() => service("mem-audit").queryJob("job-qjr-revision-zero"));
        assert.equal(error.code, "INVALID_JOB");
        assert.equal(error.status, 409);
      },
    },
  ];

  try {
    for (const scenario of scenarios) {
      installNetworkGuard();
      const countsBefore = { ...network };
      const beforeSnapshot = structuredClone(store.data);
      try {
        await scenario.run();
        const afterSnapshot = structuredClone(store.data);
        const deltas = Object.fromEntries(
          NETWORK_KEYS.map((key) => [key, network[key] - countsBefore[key]]),
        );
        for (const key of NETWORK_KEYS) {
          assert.equal(deltas[key], 0, `${scenario.label}: ${key} 计数必须为 0`);
        }
        assert.deepEqual(afterSnapshot, beforeSnapshot, `${scenario.label}: 请求前后 store.data 全量 deepEqual`);
      } finally {
        restoreNetworkGuard();
      }
    }
  } finally {
    // 后续收尾测试仍在 guard 覆盖下运行。
    installNetworkGuard();
  }
  t.diagnostic(`networkCounters=${JSON.stringify(network)}`);
});

test("07B-20 收尾：Provider/私密文件/网络/服务写入总计为零，策略仍关闭", () => {
  assert.equal(providerCalls.count, 0);
  assert.equal(fileCalls.count, 0);
  assert.equal(serviceWrites, 0);
  assert.equal(networkCalls, 0);
  for (const key of NETWORK_KEYS) {
    assert.equal(network[key], 0, `${key} 总计必须为 0`);
  }
  assert.equal(TAMPER.successes, 0);
  assert.ok(TAMPER.attempts >= 4, `篡改尝试次数必须 >= 4，实际 ${TAMPER.attempts}`);
  assert.equal(isPublicJobFailureReason("INTERNAL_ONLY_REASON"), false);
});
