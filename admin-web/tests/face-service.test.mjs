/**
 * HK-AI-07B：queryJob revision 权威读模型定向测试。
 *
 * 只经过服务层 queryJob；不注册 HTTP、不启动 server、不连接 Provider/云/设备。
 *
 * 公开 failureReason 的唯一权威策略是 service.mjs 模块私有空 Set；命名空间
 * 不得导出 PUBLIC_JOB_FAILURE_REASONS（含 Symbol、default、对象属性、getter）
 * 或任何集合引用，只读复用面只有 isPublicJobFailureReason(value) => Set.has(value)。
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
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalStore } from "../lib/store.mjs";
import * as serviceModule from "../lib/face-service/service.mjs";
import {
  FaceCredentialService,
  isPublicJobFailureReason,
} from "../lib/face-service/service.mjs";

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

const providerCalls = { count: 0 };
const fileCalls = { count: 0 };
const reads = [];
let serviceWrites = 0;
let networkCalls = 0;

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
const originalFetch = globalThis.fetch;

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

function assertNoWhitelistExport(ns) {
  assert.equal(Object.hasOwn(ns, "PUBLIC_JOB_FAILURE_REASONS"), false, "命名空间不得导出 PUBLIC_JOB_FAILURE_REASONS");
  assert.equal("PUBLIC_JOB_FAILURE_REASONS" in ns, false, "命名空间不得导出 PUBLIC_JOB_FAILURE_REASONS");
  assert.equal(ns.PUBLIC_JOB_FAILURE_REASONS, undefined, "命名空间不得经属性读出白名单");
  assert.equal(Object.hasOwn(ns, "default"), false, "不得导出 default");
  assert.deepEqual(
    Object.getOwnPropertySymbols(ns).filter((symbol) => symbol !== Symbol.toStringTag),
    [],
    "不得导出 Symbol 键",
  );
  assert.deepEqual(Object.keys(ns).sort(), EXPECTED_EXPORTS, "导出面只允许服务类与只读判定");
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(ns))) {
    assert.equal(typeof descriptor.get, "undefined", `${key} 不得是 getter 导出`);
    assert.equal(
      descriptor.value instanceof Set || descriptor.value instanceof Map ||
      descriptor.value instanceof WeakSet || descriptor.value instanceof WeakMap,
      false,
      `${key} 不得导出集合引用`,
    );
  }
}

function attemptPolicyMutation(ns) {
  // 若未来有人把白名单或可变副本挂到导出面，这里会真实调用其 add/set/push：
  // 调用后策略必须仍是空集，否则说明外部可修改公开策略。
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
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("queryJob 不得发起网络请求");
  };

  dir = await mkdtemp(join(tmpdir(), "smartpm-face-queryjob-revision-"));
  store = new LocalStore(dir);
  await store.init();

  const memberships = [
    ["mem-audit", ["device.audit.read"]],
    ["mem-none", []],
    ["mem-revoke", ["device.audit.read"]],
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
      ...memberships.map(([id, permissions]) => ({
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
        },
      })),
      ...jobs.map(([id, data]) => ({ collection: "device_operation_jobs", id, data })),
    ],
    audit,
  );
});

after(async () => {
  globalThis.fetch = originalFetch;
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

  // 重复 import 得到独立模块实例：导出面与只读策略必须保持一致且仍为空。
  const reimported = await import("../lib/face-service/service.mjs?policy-reimport=1");
  assertNoWhitelistExport(reimported);
  attemptPolicyMutation(reimported);
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
      assert.equal(descriptor.value instanceof Set, false, `${key} 不得暴露集合引用`);
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
