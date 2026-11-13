import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CloudStore, LocalStore } from "../lib/store.mjs";

const AUDIT_ID = "audit-h4-v1:0123456789abcdef";
const audit = () => ({
  auditId: AUDIT_ID,
  orgId: "org-audit",
  actorId: "h4-mock-revoker",
  actorType: "system",
  action: "face.cleanup.finalize",
});
const ref = (collection, id) => ({ collection, id });
const auditRef = () => ref("admin_audit", AUDIT_ID);
const roomWrite = (id = "room-audit") => ({
  collection: "rooms",
  id,
  data: { orgId: "org-audit", name: "audit contract" },
});

async function localHarness(t) {
  const directory = await mkdtemp(join(tmpdir(), "smartpm-audit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new LocalStore(directory).init();
}

function cloudHarness({ initial = [], replay = 1, failSet = null } = {}) {
  let records = new Map(initial.map(({ collection, id, data }) => [
    `${collection}/${id}`,
    structuredClone(data),
  ]));
  const calls = { transactions: 0, attempts: 0, gets: [], sets: [] };
  const db = {
    async runTransaction(callback) {
      calls.transactions += 1;
      let answer;
      for (let attempt = 1; attempt <= replay; attempt += 1) {
        calls.attempts += 1;
        const staged = new Map([...records].map(([key, value]) => [key, structuredClone(value)]));
        const tx = {
          collection(collection) {
            return {
              doc(id) {
                const key = `${collection}/${id}`;
                return {
                  async get() {
                    calls.gets.push({ attempt, key });
                    const value = staged.get(key);
                    return { data: value === undefined ? [] : [structuredClone(value)] };
                  },
                  async set(data) {
                    calls.sets.push({ attempt, key, data: structuredClone(data) });
                    if (failSet === key) return { code: "WRITE_FAILED" };
                    staged.set(key, structuredClone(data));
                    return {};
                  },
                };
              },
            };
          },
        };
        answer = await callback(tx);
        if (attempt === replay) records = staged;
      }
      return answer;
    },
  };
  return {
    store: new CloudStore({ database: () => db }),
    calls,
    record(collection, id) {
      const value = records.get(`${collection}/${id}`);
      return value === undefined ? null : structuredClone(value);
    },
  };
}

test("H4-0A LocalStore 确定性 audit 与业务写原子提交且字段严格白名单", async (t) => {
  const store = await localHarness(t);
  const write = roomWrite();
  await store.transact([ref(write.collection, write.id), auditRef()], () => [write], audit());

  assert.equal((await store.get("rooms", write.id, "org-audit")).name, "audit contract");
  const saved = await store.get("admin_audit", AUDIT_ID, "org-audit");
  assert.deepEqual(Object.keys(saved).sort(), [
    "_id", "action", "actorId", "actorType", "createdAt", "orgId", "target",
  ]);
  assert.deepEqual({ ...saved, createdAt: 0 }, {
    _id: AUDIT_ID,
    orgId: "org-audit",
    actorId: "h4-mock-revoker",
    actorType: "system",
    action: "face.cleanup.finalize",
    target: "rooms/room-audit",
    createdAt: 0,
  });
  assert.ok(Number.isSafeInteger(saved.createdAt) && saved.createdAt >= 0);
});

test("H4-0A LocalStore 严格校验 audit 输入、引用、90 上限与 Store 专属写入", async (t) => {
  const store = await localHarness(t);
  let builds = 0;
  await assert.rejects(
    () => store.transact([ref("rooms", "r"), auditRef()], () => [], { ...audit(), target: "forged" }),
    (error) => error.status === 400,
  );
  for (const auditId of [" ", "bad\u0000id", "x".repeat(129)]) {
    await assert.rejects(
      () => store.transact([ref("admin_audit", auditId)], () => [], { ...audit(), auditId }),
      (error) => error.status === 400,
    );
  }
  await assert.rejects(
    () => store.transact([ref("rooms", "r")], () => [], audit()),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () => store.transact([auditRef()], () => [{
      collection: "admin_audit", id: AUDIT_ID, data: { action: "forged" },
    }], audit()),
    (error) => error.status === 400,
  );

  const eightyNine = Array.from({ length: 89 }, (_, index) => ref("rooms", `r-${index}`));
  const audit90 = `${AUDIT_ID}-90`;
  await store.transact([...eightyNine, eightyNine[0], ref("admin_audit", audit90)], () => {
    builds += 1;
    return [];
  }, { ...audit(), auditId: audit90 });
  assert.equal(builds, 1, "重复 ref 去重，90 条可进入事务");

  const ninety = Array.from({ length: 90 }, (_, index) => ref("rooms", `x-${index}`));
  await assert.rejects(
    () => store.transact([...ninety, ref("admin_audit", `${AUDIT_ID}-91`)], () => {
      builds += 1;
      return [];
    }, { ...audit(), auditId: `${AUDIT_ID}-91` }),
    (error) => error.status === 400,
  );
  assert.equal(builds, 1, "91 条必须在 build 前拒绝");
});

test("H4-0A LocalStore 已有 audit 允许零写重放、拒绝重复业务写", async (t) => {
  const store = await localHarness(t);
  const write = roomWrite("room-ack");
  let builds = 0;
  await store.transact([ref("rooms", write.id), auditRef()], () => {
    builds += 1;
    return [write];
  }, audit());

  await store.transact([ref("rooms", write.id), auditRef()], (state) => {
    builds += 1;
    assert.equal(state[`admin_audit/${AUDIT_ID}`]._id, AUDIT_ID);
    return [];
  }, audit());
  assert.equal(builds, 2, "合法重放必须进入 callback 后零写返回");

  await assert.rejects(
    () => store.transact([ref("rooms", write.id), auditRef()], () => {
      builds += 1;
      return [{ ...write, data: { ...write.data, name: "duplicate" } }];
    }, audit()),
    (error) => error.status === 409,
  );
  assert.equal(builds, 3, "重复业务写在 callback 后由 Store 拒绝");
  assert.equal((await store.get("rooms", write.id, "org-audit")).name, "audit contract");
  assert.equal((await store.list("admin_audit")).filter((row) => row._id === AUDIT_ID).length, 1);
});

test("H4-0A LocalStore 首次零写仍创建 audit，已有 audit 的 build 错误照常透传", async (t) => {
  const store = await localHarness(t);
  await store.transact([auditRef()], () => [], audit());
  const saved = await store.get("admin_audit", AUDIT_ID, "org-audit");
  assert.equal(saved.target, "");

  await assert.rejects(
    () => store.transact([auditRef()], () => { throw Error("replay validation failed"); }, audit()),
    /replay validation failed/,
  );
  assert.equal((await store.list("admin_audit")).filter((row) => row._id === AUDIT_ID).length, 1);
});

test("H4-0A LocalStore 业务异常或持久化失败时审计与业务同回滚", async (t) => {
  const store = await localHarness(t);
  const write = roomWrite("room-rollback");
  await assert.rejects(
    () => store.transact([ref("rooms", write.id), auditRef()], () => { throw Error("business failed"); }, audit()),
    /business failed/,
  );
  assert.equal(await store.get("rooms", write.id), null);
  assert.equal(await store.get("admin_audit", AUDIT_ID), null);

  const persist = store.persist.bind(store);
  store.persist = async () => { throw Error("audit persistence failed"); };
  await assert.rejects(
    () => store.transact([ref("rooms", write.id), auditRef()], () => [write], audit()),
    /audit persistence failed/,
  );
  store.persist = persist;
  assert.equal(await store.get("rooms", write.id), null);
  assert.equal(await store.get("admin_audit", AUDIT_ID), null);
});

test("H4-0A CloudStore callback 重放使用同一 transaction 与确定性 doc ID", async () => {
  const cloud = cloudHarness({ replay: 2 });
  const write = roomWrite("room-cloud");
  let builds = 0;
  await cloud.store.transact([ref("rooms", write.id), auditRef(), auditRef()], () => {
    builds += 1;
    return [write];
  }, audit());

  assert.equal(cloud.calls.transactions, 1);
  assert.equal(cloud.calls.attempts, 2);
  assert.equal(builds, 2, "SDK callback 重跑时 build 允许重算");
  assert.equal(cloud.record("rooms", write.id).name, "audit contract");
  const saved = cloud.record("admin_audit", AUDIT_ID);
  assert.deepEqual(Object.keys(saved).sort(), [
    "action", "actorId", "actorType", "createdAt", "orgId", "target",
  ]);
  assert.equal(saved.target, "rooms/room-cloud");
  assert.equal(cloud.calls.sets.filter((call) => call.key === `admin_audit/${AUDIT_ID}`).length, 2);
  assert.ok(cloud.calls.sets.every((call) => call.attempt === 1 || call.attempt === 2));
});

test("H4-0A CloudStore 已有 audit 允许零写重放、拒绝重复业务写", async () => {
  const cloud = cloudHarness({ replay: 2, initial: [{
    collection: "admin_audit", id: AUDIT_ID,
    data: { orgId: "org-audit", action: "existing" },
  }] });
  let builds = 0;
  await cloud.store.transact([ref("rooms", "room-cloud"), auditRef()], (state) => {
    builds += 1;
    assert.equal(state[`admin_audit/${AUDIT_ID}`].action, "existing");
    return [];
  }, audit());
  assert.equal(builds, 2, "SDK callback 重跑仍保持零写重放");
  assert.equal(cloud.record("admin_audit", AUDIT_ID).action, "existing");

  await assert.rejects(
    () => cloud.store.transact([ref("rooms", "room-cloud"), auditRef()], () => {
      builds += 1;
      return [roomWrite("room-cloud")];
    }, audit()),
    (error) => error.status === 409,
  );
  assert.equal(builds, 3);
  assert.equal(cloud.record("rooms", "room-cloud"), null);
  assert.equal(cloud.record("admin_audit", AUDIT_ID).action, "existing");
});

test("H4-0A CloudStore 首次零写创建 audit，已有 audit 的 build 错误照常透传", async () => {
  const cloud = cloudHarness();
  await cloud.store.transact([auditRef()], () => [], audit());
  assert.equal(cloud.record("admin_audit", AUDIT_ID).target, "");

  await assert.rejects(
    () => cloud.store.transact([auditRef()], () => { throw Error("replay invalid"); }, audit()),
    /replay invalid/,
  );
  assert.equal(cloud.calls.sets.filter((call) => call.key === `admin_audit/${AUDIT_ID}`).length, 1);
});

test("H4-0A CloudStore 业务写或审计写失败均由同一云事务回滚", async () => {
  const write = roomWrite("room-cloud-fail");
  const businessFail = cloudHarness({ failSet: `rooms/${write.id}` });
  await assert.rejects(
    () => businessFail.store.transact([ref("rooms", write.id), auditRef()], () => [write], audit()),
    (error) => error.status === 503,
  );
  assert.equal(businessFail.record("rooms", write.id), null);
  assert.equal(businessFail.record("admin_audit", AUDIT_ID), null);
  assert.equal(businessFail.calls.sets.some((call) => call.key === `admin_audit/${AUDIT_ID}`), false);

  const auditFail = cloudHarness({ failSet: `admin_audit/${AUDIT_ID}` });
  await assert.rejects(
    () => auditFail.store.transact([ref("rooms", write.id), auditRef()], () => [write], audit()),
    (error) => error.status === 503,
  );
  assert.equal(auditFail.record("rooms", write.id), null);
  assert.equal(auditFail.record("admin_audit", AUDIT_ID), null);
  assert.ok(auditFail.calls.sets.some((call) => call.key === `admin_audit/${AUDIT_ID}`));
});

test("H4-0A 未带 auditId 的 Local/Cloud 旧调用继续生成随机审计", async (t) => {
  const local = await localHarness(t);
  const legacy = { actor: "legacy", actorId: "legacy", action: "legacy action" };
  const localWrite = roomWrite("room-legacy-local");
  await local.transact([ref("rooms", localWrite.id)], () => [localWrite], legacy);
  const localAudit = (await local.list("admin_audit"))[0];
  assert.equal(localAudit.actor, "legacy");
  assert.notEqual(localAudit._id, AUDIT_ID);

  const cloud = cloudHarness();
  const cloudWrite = roomWrite("room-legacy-cloud");
  await cloud.store.transact([ref("rooms", cloudWrite.id)], () => [cloudWrite], legacy);
  const auditSets = cloud.calls.sets.filter((call) => call.key.startsWith("admin_audit/"));
  assert.equal(auditSets.length, 1);
  assert.notEqual(auditSets[0].key, `admin_audit/${AUDIT_ID}`);
  assert.equal(auditSets[0].data.actor, "legacy");
});
