import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CloudStore, LocalStore } from "../lib/store.mjs";
import { HttpError } from "../lib/model.mjs";
import { prepareGrantEligibility } from "../lib/face-service/qualification.mjs";
import { occupancyClaimId, primarySlotId } from "../lib/face-service/eligibility.mjs";

const ORG = "org-point-read";
const PERSON = "person-point";
const IDENTITY = "id-point";
const OCCUPANCY = "occ-point";
const CYCLE = "cycle-point";
const ROOM = "room-point";
const FLOOR = "floor-point";
const BUILDING = "building-point";
const COMMUNITY = "community-point";
const audit = { actor: "system", actorId: "system", action: "点查合约测试" };
const ref = (collection, id) => ({ collection, id });

function cloudHarness({ rows = [], fail = false, throwOnGet = false } = {}) {
  const calls = { where: [], limits: [], gets: 0, skips: 0, orderBys: 0, docs: 0 };
  const db = {
    collection(name) {
      return {
        where(query) {
          calls.where.push({ name, query: structuredClone(query) });
          const chain = {
            limit(value) { calls.limits.push(value); return chain; },
            skip() { calls.skips += 1; return chain; },
            orderBy() { calls.orderBys += 1; return chain; },
            async get() {
              calls.gets += 1;
              if (throwOnGet) throw Error("SDK transport failed");
              if (fail) return { code: "DB_ERROR", data: null };
              return {
                data: rows.filter((row) => row._id === query._id &&
                  (!query.orgId || row.orgId === query.orgId)),
              };
            },
          };
          return chain;
        },
        // 真实点查必须把 orgId 与 _id 都下推；退化为 doc(id) 会在测试中直接失败。
        doc() {
          calls.docs += 1;
          throw Error("点查必须使用 where({_id, orgId})");
        },
      };
    },
  };
  return { store: new CloudStore({ database: () => db }), calls };
}

function qualificationWrites() {
  return [
    {
      collection: "persons", id: PERSON,
      data: { orgId: ORG, status: "active", userId: null, revision: 1 },
    },
    {
      collection: "identity_applications", id: IDENTITY,
      data: {
        orgId: ORG, personId: PERSON, state: "approved",
        identityDigest: "digest-point", keyVersion: 1, revision: 1,
      },
    },
    {
      collection: "occupancies", id: OCCUPANCY,
      data: {
        orgId: ORG, personId: PERSON, roomId: ROOM, cycleId: CYCLE,
        role: "primary", state: "active", startsAt: 100, endsAt: 10_000,
        sponsorOccupancyId: null, revision: 1,
      },
    },
    {
      collection: "occupancy_cycles", id: CYCLE,
      data: {
        orgId: ORG, roomId: ROOM, state: "active", primaryOccupancyId: OCCUPANCY,
        startsAt: 100, endsAt: 10_000, endedAt: null, epoch: 1, revision: 1,
      },
    },
    {
      collection: "rooms", id: ROOM,
      data: {
        orgId: ORG, status: "active", floorId: FLOOR, buildingId: BUILDING,
        communityId: COMMUNITY, revision: 1,
      },
    },
    {
      collection: "property_catalog", id: FLOOR,
      data: { orgId: ORG, kind: "floor", status: "active", parentId: BUILDING, revision: 1 },
    },
    {
      collection: "property_catalog", id: BUILDING,
      data: { orgId: ORG, kind: "building", status: "active", parentId: COMMUNITY, revision: 1 },
    },
    {
      collection: "property_catalog", id: COMMUNITY,
      data: { orgId: ORG, kind: "community", status: "active", revision: 1 },
    },
    {
      collection: "unique_claims", id: occupancyClaimId(ORG, ROOM, CYCLE, PERSON),
      data: { orgId: ORG, state: "bound", ownerId: OCCUPANCY, revision: 1 },
    },
    {
      collection: "room_primary_slots", id: primarySlotId(ORG, ROOM),
      data: {
        orgId: ORG, currentCycleId: CYCLE, currentOccupancyId: OCCUPANCY,
        currentPersonId: PERSON, revision: 1,
      },
    },
  ];
}

async function localStore(t) {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-point-read-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  const writes = qualificationWrites();
  await store.transact(writes.map((w) => ref(w.collection, w.id)), () => writes, audit);
  return store;
}

class PointOnlyStore {
  constructor(inner) {
    this.inner = inner;
    this.gets = [];
    this.listCalls = 0;
  }
  async get(name, id, orgId) {
    this.gets.push({ name, id, orgId });
    return this.inner.get(name, id, orgId);
  }
  async list() {
    this.listCalls += 1;
    throw new HttpError(503, "资格预读不得全组织分页");
  }
}

const request = () => ({
  orgId: ORG,
  personId: PERSON,
  occupancyId: OCCUPANCY,
  cycleId: CYCLE,
  identityApplicationId: IDENTITY,
  validFrom: 100,
  validUntil: 1_000,
});

test("CloudStore.get 把 orgId + _id 下推到服务端且不做分页", async () => {
  const row = { _id: OCCUPANCY, orgId: ORG, kind: "occupancy" };
  const { store, calls } = cloudHarness({
    rows: [row, { _id: OCCUPANCY, orgId: "org-other", kind: "other" }],
  });
  const found = await store.get("occupancies", OCCUPANCY, ORG);
  assert.deepEqual(found, row);
  assert.deepEqual(calls.where, [{
    name: "occupancies", query: { _id: OCCUPANCY, orgId: ORG },
  }]);
  assert.deepEqual(calls.limits, [1]);
  assert.equal(calls.gets, 1);
  assert.equal(calls.skips, 0, "点查不得 skip 分页");
  assert.equal(calls.orderBys, 0, "点查不得排序全量");
  assert.equal(calls.docs, 0, "点查必须显式下推 orgId，而不是 doc(id)");
});

test("CloudStore.get 跨组织与缺失同态返回 null，查询仍带请求 orgId", async () => {
  const { store, calls } = cloudHarness({ rows: [{ _id: OCCUPANCY, orgId: ORG }] });
  assert.equal(await store.get("occupancies", OCCUPANCY, "org-other"), null);
  assert.deepEqual(calls.where[0].query, { _id: OCCUPANCY, orgId: "org-other" });
  assert.equal(await store.get("occupancies", "missing", ORG), null);
  assert.deepEqual(calls.where[1].query, { _id: "missing", orgId: ORG });
});

test("CloudStore.get 把读取故障区分为 503，而不是缺失 null", async () => {
  const coded = cloudHarness({ fail: true });
  await assert.rejects(
    () => coded.store.get("occupancies", OCCUPANCY, ORG),
    (error) => error.status === 503 && error.code === null,
  );
  const thrown = cloudHarness({ throwOnGet: true });
  await assert.rejects(
    () => thrown.store.get("occupancies", OCCUPANCY, ORG),
    (error) => error.status === 503 && error.code === null,
  );
});

test("LocalStore.get 与 CloudStore.get 同契约：组织隔离、缺失 null、返回副本", async (t) => {
  const store = await localStore(t);
  const person = await store.get("persons", PERSON, ORG);
  assert.equal(person._id, PERSON);
  assert.equal(await store.get("persons", PERSON, "org-other"), null);
  assert.equal(await store.get("persons", "missing", ORG), null);
  person.status = "mutated";
  assert.equal((await store.get("persons", PERSON, ORG)).status, "active", "点查不得暴露内部引用");
});

test("资格预读只用 (orgId,_id) 点查，records 存在时不受全组织分页上限影响", async (t) => {
  const inner = await localStore(t);
  const store = new PointOnlyStore(inner);
  const planned = await prepareGrantEligibility(store, request());

  assert.equal(store.listCalls, 0, "资格预读不得调用 list");
  assert.ok(store.gets.length >= 8);
  for (const read of store.gets) {
    assert.equal(read.orgId, ORG, `每次点查都必须带 orgId: ${read.name}`);
    assert.equal(typeof read.id, "string");
    assert.ok(read.id.length > 0);
  }
  const collectionsRead = new Set(store.gets.map((read) => read.name));
  for (const name of [
    "persons", "identity_applications", "occupancies", "occupancy_cycles",
    "rooms", "property_catalog", "lifecycle_guards",
  ]) assert.ok(collectionsRead.has(name), `缺少点查 ${name}`);
  assert.ok(planned.refs.some((item) => item.collection === "occupancies"));
});

test("资格预读的缺失是 404，读取故障是 503，两者不混淆", async (t) => {
  const inner = await localStore(t);
  const point = new PointOnlyStore(inner);
  await assert.rejects(
    () => prepareGrantEligibility(point, { ...request(), occupancyId: "missing" }),
    (error) => error.code === "NOT_FOUND" && error.status === 404,
  );
  assert.equal(point.listCalls, 0);

  class FailingStore extends PointOnlyStore {
    async get(name, id, orgId) {
      if (name === "occupancies") throw new HttpError(503, "云数据库查询失败");
      return super.get(name, id, orgId);
    }
  }
  const failing = new FailingStore(inner);
  await assert.rejects(
    () => prepareGrantEligibility(failing, request()),
    (error) => error.status === 503 && error.code === null,
  );
});
