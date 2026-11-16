import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";

import { LocalStore } from "../lib/store.mjs";
import { FileService } from "../lib/files.mjs";
import { BlacklistService } from "../lib/blacklist.mjs";
import { MockFaceAccessProvider } from "../lib/face-service/mock-provider.mjs";

// 直接从生产模块 import（LC01/LC02 要求：不得仅依靠 index 不导出掩盖直接 import 入口）
import { H3MockDispatcher } from "../lib/face-service/h3b.mjs";
import { H4MockRevoker, validateRevokeJob } from "../lib/face-service/h4b.mjs";
import * as h3bModule from "../lib/face-service/h3b.mjs";
import * as h4bModule from "../lib/face-service/h4b.mjs";
import * as serviceIndex from "../lib/face-service/index.mjs";

const ORG = "org-g1";
const NOW = 1_700_000_000_000;
const audit = { actor: "g1", actorId: "g1", action: "seed", orgId: ORG };
const here = dirname(fileURLToPath(import.meta.url));

function assertNoRequeueInChain(instance, label) {
  assert.equal(instance.requeue, undefined, `${label}: 实例不得暴露 requeue`);
  let depth = 0;
  for (let proto = instance; proto; proto = Object.getPrototypeOf(proto)) {
    assert.equal(
      Object.getOwnPropertyDescriptor(proto, "requeue"),
      undefined,
      `${label}: 原型链第 ${depth} 层不得存在 requeue`,
    );
    depth += 1;
  }
  assert.ok(depth >= 2, `${label}: 原型链检查必须至少覆盖实例与类原型`);
}

function assertThrowsTypeError(instance, args, label) {
  assert.throws(
    () => instance.requeue(...args),
    (error) => error instanceof TypeError,
    `${label}: 旧入口调用必须抛 TypeError`,
  );
}

async function makeH3(t) {
  const dir = await mkdtemp(join(tmpdir(), "g1-h3-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  const files = new FileService(store, ORG, {});
  const blacklist = new BlacklistService(store, ORG, null, { now: () => NOW });
  const provider = new MockFaceAccessProvider();
  const dispatcher = new H3MockDispatcher({
    store, orgId: ORG, files, blacklist, provider, now: () => NOW, owner: "g1-h3-owner",
  });
  return { dir, store, files, blacklist, provider, dispatcher };
}

async function makeH4(t) {
  const dir = await mkdtemp(join(tmpdir(), "g1-h4-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  // H4MockRevoker 本身不接收 FileService；此处仍构造一个真实实例，供 LC08 的
  // 私密文件副作用计数器包裹（H4 路径下该类别探针窗口内应为 0 次调用）。
  const files = new FileService(store, ORG, {});
  const provider = new MockFaceAccessProvider();
  const dispatcher = new H4MockRevoker({
    store, orgId: ORG, provider, now: () => NOW, owner: "g1-h4-owner",
  });
  return { dir, store, files, provider, dispatcher };
}

// 构造一个可被 validateRevokeJob 接受的 dispatch/retryable_failed 撤权任务（LC04/LC05 用）
function revokeJobFixture(overrides = {}) {
  const job = {
    _id: "job-g1", orgId: ORG, revision: 1,
    credentialId: "cred-g1", grantId: "grant-g1", deviceId: "device-g1",
    action: "revoke", state: "retryable_failed", executionMode: "test", provider: "mock",
    evidenceScope: "simulated", attempts: 1, leaseGeneration: 1,
    leaseOwner: null, leaseExpiresAt: null, dispatchAuthorizedAt: null,
    nextAttemptAt: NOW, result: { attempt: 1, outcome: "retryable_failed",
      errorKind: "RETRYABLE", reasonCode: "PRIOR", finishedAt: NOW },
    cleanupPhase: "dispatch", providerOutcome: null, finalizeAttempts: 0,
    cleanupSnapshot: {
      schemaVersion: 1, grantId: "grant-g1", grantRevision: 1,
      credentialId: "cred-g1", credentialRevision: 1, deviceId: "device-g1",
      deviceRevision: 1, claimId: "claim-g1", claimRevision: 1,
      slotId: "slot-g1", slotRevision: 1, releaseGuardId: "guard-g1",
      releaseGuardRevision: 1, releaseGuardEpoch: 1,
      originalGrantState: "effective", createdAt: 1,
    },
    createdAt: 1, updatedAt: 1,
  };
  return { ...job, ...overrides };
}

async function seed(h, collections) {
  const writes = [];
  for (const [collection, rows] of Object.entries(collections)) {
    for (const row of rows) writes.push({ collection, id: row._id, data: row });
  }
  await h.store.transact(writes.map((w) => ({ collection: w.collection, id: w.id })), () => writes, audit);
}

// 全库快照：直接 structuredClone(store.data)，覆盖 store 中每一个集合（含所有未知/未来集合），
// 而非固定白名单。任务卡 §4 要求每个独立场景动作前后分别保存 before/after 并 deepEqual。
function fullSnapshot(store) {
  return structuredClone(store.data);
}

test("LC01：直接 import h3b 的 H3MockDispatcher，实例与原型链无 requeue，导出面无替代", async (t) => {
  const h = await makeH3(t);
  assertNoRequeueInChain(h.dispatcher, "H3");
  assert.equal(Object.prototype.hasOwnProperty.call(h3bModule, "requeue"), false, "h3b 模块不得导出 requeue");
  assert.equal(Object.keys(h3bModule).some((key) => /requeue/i.test(key)), false, "h3b 不得有 requeue 别名导出");
  assert.equal(Object.keys(serviceIndex).some((key) => /requeue/i.test(key)), false, "公共 index 不得有 requeue 别名导出");
  assertThrowsTypeError(h.dispatcher, [], "H3 默认参数");
});

test("LC02：直接 import h4b 的 H4MockRevoker，实例与原型链无 requeue，导出面无替代", async (t) => {
  const h = await makeH4(t);
  assertNoRequeueInChain(h.dispatcher, "H4");
  assert.equal(Object.keys(h4bModule).some((key) => /requeue/i.test(key)), false, "h4b 不得有 requeue 别名导出");
  assertThrowsTypeError(h.dispatcher, [], "H4 默认参数");
  // H4 通过 index 重导出，同样验证直接入口已被封闭
  assert.equal(Object.getOwnPropertyDescriptor(serviceIndex.H4MockRevoker.prototype, "requeue"), undefined);
});

test("LC03：任意 actor/revision 组合均不可达，且每个独立场景全库内容级零变化", async (t) => {
  const actors = [undefined, null,
    { actorId: "u-normal", membershipId: "m-normal" },
    { actorId: "system", membershipId: "m-system" }];
  const revisions = [undefined, 1, 0];
  for (const instanceKind of ["h3", "h4"]) {
    const h = instanceKind === "h3" ? await makeH3(t) : await makeH4(t);
    for (const actor of actors) {
      for (const revision of revisions) {
        const label = `${instanceKind} actor=${JSON.stringify(actor)} revision=${JSON.stringify(revision)}`;
        // 逐场景：每个 actor/revision 组合独立保存动作前后全库快照
        const before = fullSnapshot(h.store);
        assertThrowsTypeError(h.dispatcher, ["job-g1", revision, actor], label);
        const after = fullSnapshot(h.store);
        assert.deepEqual(after, before, `${label}: 逐场景全库前后内容级相等`);
      }
    }
  }
});

test("LC04/LC05：retryable_failed（到期/未到期）及各旧状态作业均无法转 queued 或修改任何字段", async (t) => {
  const states = [
    revokeJobFixture({ _id: "job-due", nextAttemptAt: NOW, state: "retryable_failed" }),
    revokeJobFixture({ _id: "job-not-due", nextAttemptAt: NOW + 999_999, state: "retryable_failed" }),
    revokeJobFixture({ _id: "job-queued", state: "queued", nextAttemptAt: null, result: null, revision: 2 }),
    revokeJobFixture({ _id: "job-sending", state: "sending", leaseOwner: "worker",
      leaseExpiresAt: NOW + 60_000, nextAttemptAt: null, result: null, revision: 2 }),
    revokeJobFixture({ _id: "job-await", state: "awaiting_result", nextAttemptAt: null,
      result: { attempt: 1, outcome: "awaiting_result", errorKind: null, reasonCode: null, finishedAt: NOW }, revision: 2 }),
    revokeJobFixture({ _id: "job-terminal", state: "terminal_failed", nextAttemptAt: null,
      result: { attempt: 4, outcome: "terminal_failed", errorKind: "RETRYABLE",
        reasonCode: "PROVIDER_PRE_SEND", finishedAt: NOW }, revision: 2, attempts: 4, leaseGeneration: 4 }),
  ];
  const h = await makeH4(t);
  await seed(h, { device_operation_jobs: states });
  for (const job of states) {
    // 逐场景：每种 job 状态独立保存动作前后全库快照
    const before = fullSnapshot(h.store);
    assertThrowsTypeError(h.dispatcher, [job._id, job.revision, null], `作业 ${job._id}`);
    const after = fullSnapshot(h.store);
    assert.deepEqual(after, before, `作业 ${job._id}（${job.state}）: 逐场景全库前后内容级相等`);
  }
});

test("LC06：已有旧 queued/log/audit 数据不改写，不新增 op key/domain，不伪造服务回执", async (t) => {
  const h = await makeH4(t);
  const queued = revokeJobFixture({ _id: "job-legacy-queued", state: "queued",
    nextAttemptAt: null, result: null, revision: 3 });
  await seed(h, {
    device_operation_jobs: [queued],
    device_operation_logs: [{ _id: "log-legacy", orgId: ORG, jobId: queued._id,
      state: "queued", action: "revoke", revision: 3, at: 1 }],
    admin_audit: [{ _id: "audit-legacy", orgId: ORG, action: "legacy", actorId: "old", at: 1 }],
    operation_keys: [{ _id: "key-legacy", orgId: ORG, value: "unchanged" }],
    operation_key_domains: [{ _id: "domain-legacy", orgId: ORG, value: "unchanged" }],
  });
  const before = fullSnapshot(h.store);
  assertThrowsTypeError(h.dispatcher, [queued._id, queued.revision, null], "旧 queued 作业");
  const after = fullSnapshot(h.store);
  assert.deepEqual(after, before, "旧数据零改写、无新增 op key/domain（全库前后内容级相等）");
});

test("LC07：两种 job 的 queued 相反不变量仍由正式 validator 守卫", async (t) => {
  // revoke dispatch queued 必须清空 result/nextAttemptAt（与 enroll 相反）
  const validRevokeQueued = revokeJobFixture({ state: "queued", nextAttemptAt: null, result: null });
  assert.doesNotThrow(() => validateRevokeJob(validRevokeQueued), "合法 revoke queued fixture 必须通过 validator");
  assert.throws(
    () => validateRevokeJob({ ...validRevokeQueued, nextAttemptAt: NOW, result: validRevokeQueued.result }),
    /清理|任务/,
    "把 enroll 语义的 result/nextAttemptAt 塞进 revoke queued 必须被拒绝",
  );
});

// 安装真实副作用计数器，包裹实例的 Provider / 私密文件 / Store 写 / 业务网络入口。
// 关键约束（任务卡 §4）：guard 在模块加载与 fixture 就绪"之后"安装，安装时记录当前计数为
// baseline；自检绝不重置/清零计数，因此不会抹掉模块加载期已发生的调用。封闭探针只统计
// 安装后的增量（deltas），且与其他 dispatcher 回归使用的 Mock 调用口径分离。
// 从原型链动态枚举真实方法名，避免硬编码名单列入不存在的方法（如 deleteFace）
// 或遗漏真实方法（health/queryOperation/verifyEvent）。
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

function installSideEffectCounters(h) {
  const counts = { provider: 0, privateFile: 0, storeWrite: 0, network: 0 };
  const records = [];
  const active = new WeakMap(); // obj -> Set<key>，防止同一方法被二次包裹（嵌套污染）

  const wrap = (obj, key, bucket) => {
    if (!obj || typeof obj[key] !== "function") return false;
    let keys = active.get(obj);
    if (!keys) { keys = new Set(); active.set(obj, keys); }
    if (keys.has(key)) throw new Error(`副作用计数器嵌套污染：${key} 已被包裹`);
    const original = obj[key];                              // 原始函数引用，不 bind
    const hadOwn = Object.prototype.hasOwnProperty.call(obj, key);
    const slot = { impl: original };                        // 可变底层实现，供正控临时替换为 no-op
    const wrapped = function (...args) {
      counts[bucket] += 1;
      return Reflect.apply(slot.impl, obj, args);           // 保持 this，不产生新函数身份
    };
    obj[key] = wrapped;
    keys.add(key);
    records.push({ obj, key, bucket, original, hadOwn, slot });
    return true;
  };

  const wrappedBy = { provider: [], privateFile: [], storeWrite: [], network: [] };
  // Provider：从原型链动态枚举真实方法（含 health/queryOperation/verifyEvent，不含 deleteFace）
  for (const key of ownMethodNames(h.provider))
    if (wrap(h.provider, key, "provider")) wrappedBy.provider.push(key);
  // 私密文件：FileService 全部方法（含写与私密读，任何调用都视为副作用）
  for (const key of ownMethodNames(h.files))
    if (wrap(h.files, key, "privateFile")) wrappedBy.privateFile.push(key);
  // 服务写：Store 写入口（list/get 是读，不计入写）
  for (const key of ["transact", "change", "persist"])
    if (wrap(h.store, key, "storeWrite")) wrappedBy.storeWrite.push(key);
  // 业务网络：fetch 与 http/https 请求入口（模块/全局函数，无法从实例原型枚举）
  for (const [obj, label, key] of [
    [globalThis, "globalThis", "fetch"],
    [http, "http", "request"], [http, "http", "get"],
    [https, "https", "request"], [https, "https", "get"],
  ])
    if (wrap(obj, key, "network")) wrappedBy.network.push(`${label}.${key}`);

  const baseline = { ...counts }; // 安装时刻基线，含模块加载期既有的真实计数
  const restore = () => {
    for (const r of [...records].reverse()) {
      // 精确恢复：有自有属性则写回原始引用，否则删除遮蔽属性以恢复原型方法
      if (r.hadOwn) r.obj[r.key] = r.original;
      else delete r.obj[r.key];
      active.get(r.obj)?.delete(r.key);
    }
  };

  return {
    baseline,
    wrappedBy,
    // 自检：只读快照，绝不改写 counts，故不抹掉模块加载期调用
    selfCheck: () => ({ ...counts }),
    read: () => ({ ...counts }),
    deltas: () => Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, v - baseline[k]]),
    ),
    // 正控：实际触发每个类别的一个包裹方法，证明计数器确实会递增；
    // 底层临时替换为 no-op 杜绝真实副作用，完成后回滚计数不污染探针窗口。
    verifyCounters: () => {
      const before = { ...counts };
      for (const bucket of Object.keys(counts)) {
        const rec = records.find((r) => r.bucket === bucket);
        assert.ok(rec, `${bucket}: 必须至少包裹一个真实方法`);
        const realImpl = rec.slot.impl;
        rec.slot.impl = () => undefined;
        try {
          Reflect.apply(rec.obj[rec.key], rec.obj, []);
        } finally {
          rec.slot.impl = realImpl;
        }
      }
      const after = { ...counts };
      for (const bucket of Object.keys(counts))
        assert.equal(after[bucket] - before[bucket], 1,
          `${bucket}: 正控失败——触发一次包裹方法后计数未 +1（实测 ${after[bucket] - before[bucket]}）`);
      for (const bucket of Object.keys(counts)) counts[bucket] = before[bucket]; // 回滚，不污染探针窗口
    },
    restore,
  };
}

test("LC08：封闭探针四类真实副作用计数器（Provider/私密文件/服务写/业务网络）均为 0", async (t) => {
  for (const instanceKind of ["h3", "h4"]) {
    const h = instanceKind === "h3" ? await makeH3(t) : await makeH4(t);
    // 记录网络入口原始引用，用于窗口结束后核验身份精确恢复
    const netOriginals = {
      fetch: globalThis.fetch,
      httpRequest: http.request, httpGet: http.get,
      httpsRequest: https.request, httpsGet: https.get,
    };
    const counters = installSideEffectCounters(h);
    try {
      // P2-2a 正控：实际触发并验证计数有效（禁用递增或名单遗漏时此处即失败）
      counters.verifyCounters();
      // P2-2b 名单核验：Provider 精确覆盖真实方法，不得含不存在的 deleteFace
      assert.deepEqual(counters.wrappedBy.provider,
        ["enrollFace", "health", "queryOperation", "revokeFace", "updateFace", "verifyEvent"],
        "Provider 包裹名单必须精确等于 MockFaceAccessProvider 真实方法集合");
      assert.equal(counters.wrappedBy.provider.includes("deleteFace"), false, "不得列入不存在的 deleteFace");
      assert.ok(counters.wrappedBy.privateFile.length > 0, "私密文件类别必须有被包裹方法");
      assert.deepEqual(counters.wrappedBy.storeWrite, ["transact", "change", "persist"]);
      assert.equal(counters.wrappedBy.network.length, 5, "网络类别必须包裹 fetch/http/https 全部 5 个入口");

      const atInstall = counters.selfCheck();
      assert.deepEqual(atInstall, counters.baseline, `${instanceKind}: 自检只读，不得清零模块加载期计数`);

      const before = fullSnapshot(h.store);
      const callsBefore = h.provider.calls.length;
      assertThrowsTypeError(h.dispatcher, ["job-g1", 1, null], `${instanceKind} 零副作用探针`);

      const delta = counters.deltas();
      assert.deepEqual(delta, { provider: 0, privateFile: 0, storeWrite: 0, network: 0 },
        `${instanceKind}: 四类副作用增量必须为 0，实测 ${JSON.stringify(delta)}`);
      assert.equal(h.provider.calls.length - callsBefore, 0, `${instanceKind}: provider.calls 计数增量为 0`);
      assert.deepEqual(fullSnapshot(h.store), before, `${instanceKind}: 全库内容级零变化`);
    } finally {
      counters.restore(); // 即时精确恢复，不用 t.after()，避免 h3/h4 窗口嵌套
    }
    // P2-2c 恢复身份核验：原函数身份必须精确恢复，不得是 bind 后的新函数
    assert.equal(globalThis.fetch, netOriginals.fetch, "fetch 必须恢复原函数身份");
    assert.equal(http.request, netOriginals.httpRequest, "http.request 必须恢复原函数身份");
    assert.equal(http.get, netOriginals.httpGet, "http.get 必须恢复原函数身份");
    assert.equal(https.request, netOriginals.httpsRequest, "https.request 必须恢复原函数身份");
    assert.equal(https.get, netOriginals.httpsGet, "https.get 必须恢复原函数身份");
  }
});

test("LC09：生产源码无 requeue 标识符，无改名/转发/可调用 stub/隐藏开关", async (t) => {
  const h3Source = await readFile(join(here, "..", "lib", "face-service", "h3b.mjs"), "utf8");
  const h4Source = await readFile(join(here, "..", "lib", "face-service", "h4b.mjs"), "utf8");
  assert.doesNotMatch(h3Source, /\brequeue\b/, "h3b.mjs 不得残留 requeue 标识符");
  assert.doesNotMatch(h4Source, /\brequeue\b/, "h4b.mjs 不得残留 requeue 标识符");
  assert.doesNotMatch(h3Source, /_requeue/, "h3b.mjs 不得改名保留旧入口");
  assert.doesNotMatch(h4Source, /_requeue/, "h4b.mjs 不得改名保留旧入口");
  assert.doesNotMatch(h3Source, /actor\s*==\s*null/, "h3b.mjs 不得保留 actor=null 旁路分支");
  assert.doesNotMatch(h4Source, /actor\s*==\s*null/, "h4b.mjs 不得保留 actor=null 旁路分支");
});

test("LC10：公共 index 与导出面未产生无理由差异，HTTP/UI 层不含旧入口调用", async (t) => {
  // 仅验证导出面没有因封闭动作新增/改名；server/routes/UI 的零修改由交付 git diff 证据给出
  assert.equal(Object.keys(serviceIndex).includes("requeue"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(h3bModule, "H3MockDispatcher"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(h4bModule, "H4MockRevoker"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(serviceIndex, "H4MockRevoker"), true);
});
