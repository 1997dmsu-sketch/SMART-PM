/**
 * HK-AI-07B：queryJob revision 权威读模型定向测试。
 *
 * 只经过服务层 queryJob；不注册 HTTP、不启动 server、不连接 Provider/云/设备。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalStore } from "../lib/store.mjs";
import {
  FaceCredentialService,
  PUBLIC_JOB_FAILURE_REASONS,
} from "../lib/face-service/service.mjs";

const orgId = "org-queryjob-revision";
const otherOrgId = "org-queryjob-other";
const now = 1_700_000_000_000;
const audit = { actor: "system", actorId: "system", action: "HK-AI-07B queryJob revision" };
const ref = (collection, id) => ({ collection, id });

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
  assert.deepEqual(Object.keys(dto).sort(), [
    "attempts", "failureReason", "jobId", "lastSuccessAt", "revision", "state",
  ]);
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

test("07B-06 无批准公开 failureReason 值：null 原样，任何非 null 值失败关闭", async () => {
  // 冻结契约只定义 string|null，未批准任何公开 failureReason 值；
  // 服务层唯一权威 Set 为空，测试直接复用，不维护并行列表。
  assert.equal(PUBLIC_JOB_FAILURE_REASONS.size, 0, "冻结契约未批准任何公开 failureReason 值");
  for (const approved of PUBLIC_JOB_FAILURE_REASONS) {
    assert.fail(`未预期的公开 failureReason：${approved}`);
  }

  // null、缺失、成功/无失败状态：固定投影 null，不凭空生成原因。
  for (const id of ["job-qjr-fr-null", "job-qjr-queued", "job-qjr-rev2"]) {
    const dto = await service("mem-audit").queryJob(id);
    assert.equal(dto.failureReason, null, id);
    assert.deepEqual(Object.keys(dto).sort(), [
      "attempts", "failureReason", "jobId", "lastSuccessAt", "revision", "state",
    ], id);
  }

  for (const id of [
    "job-qjr-fr-internal",   // 内部 reasonCode
    "job-qjr-fr-provider",   // 格式合法的 Provider 原始短码
    "job-qjr-fr-lower",      // 小写
    "job-qjr-fr-empty",      // 空串
    "job-qjr-fr-long",       // 超长
    "job-qjr-fr-control",    // 控制字符
    "job-qjr-fr-object",     // 对象
    "job-qjr-fr-stack",      // 原始 stack
    "job-qjr-fr-message",    // message/路径
    "job-qjr-fr-array",      // 数组
  ]) {
    await expectInvalidJob(id);
  }
});

test("07B-07 不存在与跨组织同态 404", async () => {
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

test("07B-08 无权 403；撤权后下一次立即拒绝", async () => {
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

test("07B-09 响应敏感字段扫描零命中", async () => {
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

test("07B-10 读路径零写入：所有集合 deepEqual、transact 0、list 0", async () => {
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

test("07B-11 全程 Provider/网络/私密文件调用为零，服务层零写", () => {
  assert.equal(providerCalls.count, 0);
  assert.equal(networkCalls, 0);
  assert.equal(fileCalls.count, 0);
  assert.equal(serviceWrites, 0);
});
