import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptDatabase } from "../lib/sdk-database-adapter.mjs";

// 最小 node-sdk 形状的假库：doc.set/add/update 直接收数据对象、doc.get 返回 {data:[doc]} 数组。
function makeNodeDb() {
  const store = new Map();
  function rows(name) {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  }
  function coll(name) {
    const map = rows(name);
    const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
    const query = {
      doc: (id) => ({
        get: async () => { const v = map.get(id); return v === undefined ? { data: [] } : { data: [v] }; },
        set: async (payload) => { map.set(id, payload); return {}; },
        update: async (payload) => { map.set(id, { ...(map.get(id) || {}), ...payload }); return {}; },
        remove: async () => { map.delete(id); return {}; },
      }),
      add: async (payload) => { const id = payload._id || `auto-${map.size}`; map.set(id, { ...payload, _id: id }); return { _id: id }; },
      get: async () => ({ data: [...map.values()] }),
    };
    const makeWhere = (where) => {
      const q = {
        get: async () => ({ data: [...map.values()].filter((r) => matches(r, where)) }),
        count: async () => ({ total: [...map.values()].filter((r) => matches(r, where)).length }),
        update: async (payload) => { let n = 0; for (const [id, r] of map) if (matches(r, where)) { map.set(id, { ...r, ...payload }); n++; } return { stats: { updated: n } }; },
      };
      q.limit = () => q; q.skip = () => q; q.orderBy = () => q;
      return q;
    };
    query.where = makeWhere;
    query.limit = () => query; query.skip = () => query; query.orderBy = () => query;
    return query;
  }
  return {
    collection: (n) => coll(n),
    runTransaction: (fn) => fn({ collection: (n) => coll(n) }),
  };
}

test("adapter unwraps {data} on set and returns a single doc on get", async () => {
  const db = adaptDatabase(makeNodeDb());
  await db.collection("users").doc("u1").set({ data: { name: "x", _id: undefined } });
  const got = await db.collection("users").doc("u1").get();
  assert.deepEqual(got.data, { name: "x", _id: undefined }, "set 载荷应原样存储，不再被包进 data.data");
});

test("adapter maps where().get()/count() and collection queries to array results", async () => {
  const db = adaptDatabase(makeNodeDb());
  await db.collection("users").doc("a").set({ data: { role: "user" } });
  await db.collection("users").doc("b").set({ data: { role: "admin" } });
  const all = await db.collection("users").where({ role: "user" }).get();
  assert.equal(all.data.length, 1);
  assert.equal((await db.collection("users").where({ role: "user" }).count()).total, 1);
  const ordered = await db.collection("users").orderBy("_id", "asc").skip(0).limit(100).get();
  assert.equal(ordered.data.length, 2);
});

test("adapter wraps runTransaction so tx.collection uses the same shape", async () => {
  const db = adaptDatabase(makeNodeDb());
  await db.runTransaction(async (tx) => {
    await tx.collection("users").doc("t1").set({ data: { name: "in-tx" } });
  });
  const got = await db.collection("users").doc("t1").get();
  assert.equal(got.data.name, "in-tx");
});
