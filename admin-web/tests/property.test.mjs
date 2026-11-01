import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalStore, CloudStore } from "../lib/store.mjs";
import { PropertyService } from "../lib/property.mjs";
const audit = { actor: "test-admin", action: "物业管理测试" };
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-property-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init(),
    service = new PropertyService(store);
  const community = await service.createCatalog(
    { kind: "community", name: "测试小区" },
    audit,
  );
  const building = await service.createCatalog(
    { kind: "building", name: "1栋", parentId: community._id },
    audit,
  );
  const floor = await service.createCatalog(
    { kind: "floor", name: "1层", level: 1, parentId: building._id },
    audit,
  );
  const layout = await service.createCatalog(
    {
      kind: "layout",
      name: "一房一厅",
      code: "A1",
      bedrooms: 1,
      livingRooms: 1,
      parentId: building._id,
    },
    audit,
  );
  return { dir, store, service, community, building, floor, layout };
}
test("layout code uniqueness is scoped to building, and names remain separate", async (t) => {
  const x = await setup(t);
  await assert.rejects(
    x.service.createCatalog(
      {
        kind: "layout",
        name: "不同名称",
        code: "a1",
        bedrooms: 2,
        livingRooms: 1,
        parentId: x.building._id,
      },
      audit,
    ),
    /已存在/,
  );
  const building = await x.service.createCatalog(
    { kind: "building", name: "2栋", parentId: x.community._id },
    audit,
  );
  const other = await x.service.createCatalog(
    {
      kind: "layout",
      name: "单间",
      code: "A1",
      bedrooms: 1,
      livingRooms: 0,
      parentId: building._id,
    },
    audit,
  );
  assert.equal(other.name, "单间");
  assert.equal(other.rooms, "1室0厅");
  assert.notEqual(other._id, x.layout._id);
});
test("catalog rejects mismatched hierarchy and invalid room counts", async (t) => {
  const x = await setup(t);
  await assert.rejects(
    x.service.createCatalog(
      { kind: "floor", name: "错误层", level: 2, parentId: x.community._id },
      audit,
    ),
    /层级不匹配/,
  );
  await assert.rejects(
    x.service.createCatalog(
      {
        kind: "layout",
        name: "错误户型",
        code: "B1",
        bedrooms: -1,
        livingRooms: 1,
        parentId: x.building._id,
      },
      audit,
    ),
    /整数/,
  );
});
test("batch creation preserves room numbers and rolls back all rooms on duplicate", async (t) => {
  const x = await setup(t);
  const result = await x.service.createRooms(
    {
      floorId: x.floor._id,
      layoutId: x.layout._id,
      numbers: ["101", "102", "103"],
    },
    audit,
  );
  const rooms = (await x.store.list("rooms")).filter((r) =>
    result.ids.includes(r._id),
  );
  assert.equal(rooms.length, 3);
  assert.equal(rooms[0].layoutCode, "A1");
  assert.equal(rooms[0].layoutName, "一房一厅");
  assert.equal(rooms[0].rooms, "1室1厅");
  await assert.rejects(
    x.service.createRooms(
      { floorId: x.floor._id, numbers: ["104", "101"] },
      audit,
    ),
    /整批未保存/,
  );
  assert.equal(
    (await x.store.list("rooms")).some((r) => r.roomNo === "104"),
    false,
  );
});
test("concurrent batches cannot create duplicate room numbers", async (t) => {
  const x = await setup(t);
  const result = await Promise.allSettled(
    [1, 2].map(() =>
      x.service.createRooms({ floorId: x.floor._id, numbers: ["101"] }, audit),
    ),
  );
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await x.store.list("rooms")).filter((r) => r.roomNo === "101").length,
    1,
  );
});
test("batch layout synchronizes linked listings without changing price, area, status or bindings", async (t) => {
  const x = await setup(t);
  const added = await x.service.createRooms(
    { floorId: x.floor._id, layoutId: x.layout._id, numbers: ["101", "102"] },
    audit,
  );
  const users = await x.store.list("users");
  const listing = await x.service.saveListing(
    null,
    { title: "出租", price: 2300, area: 55, status: "在租" },
    added.ids[0],
    audit,
  );
  const layout = await x.service.createCatalog(
    {
      kind: "layout",
      name: "单间",
      code: "B1",
      bedrooms: 1,
      livingRooms: 0,
      parentId: x.building._id,
    },
    audit,
  );
  await x.service.batchLayout({ ids: added.ids, layoutId: layout._id }, audit);
  const house = (await x.store.list("houses")).find(
    (h) => h._id === listing._id,
  );
  assert.equal(house.rooms, "1室0厅");
  assert.equal(house.layoutCode, "B1");
  assert.equal(house.layoutName, "单间");
  assert.equal(house.price, 2300);
  assert.equal(house.area, 55);
  assert.equal(house.status, "在租");
  assert.deepEqual(await x.store.list("users"), users);
  assert.equal(
    (await x.store.list("rooms")).filter(
      (r) => added.ids.includes(r._id) && r.layoutId === layout._id,
    ).length,
    2,
  );
});
test("cross-building selection is rejected atomically", async (t) => {
  const x = await setup(t);
  const building = await x.service.createCatalog(
    { kind: "building", name: "2栋", parentId: x.community._id },
    audit,
  );
  const floor = await x.service.createCatalog(
    { kind: "floor", name: "1层", level: 1, parentId: building._id },
    audit,
  );
  const a = await x.service.createRooms(
      { floorId: x.floor._id, numbers: ["101"] },
      audit,
    ),
    b = await x.service.createRooms(
      { floorId: floor._id, numbers: ["101"] },
      audit,
    );
  await assert.rejects(
    x.service.batchLayout(
      { ids: [...a.ids, ...b.ids], layoutId: x.layout._id },
      audit,
    ),
    /整批未保存/,
  );
  assert.equal(
    (await x.store.list("rooms")).find((r) => r._id === a.ids[0]).layoutId,
    "",
  );
});
test("legacy rooms can be explicitly archived without changing houseId or occupants", async (t) => {
  const x = await setup(t);
  const before = await x.store.list("users");
  await x.service.assignRoom(
    "demo-room-1",
    { floorId: x.floor._id, roomNo: "101", layoutId: x.layout._id },
    audit,
  );
  const room = (await x.store.list("rooms")).find(
    (r) => r._id === "demo-room-1",
  );
  assert.equal(room.houseId, "ROOM-101");
  assert.equal(room.floorId, x.floor._id);
  assert.deepEqual(await x.store.list("users"), before);
  await assert.rejects(
    x.service.assignRoom(
      "demo-room-2",
      { floorId: x.floor._id, roomNo: "101" },
      audit,
    ),
    /已存在/,
  );
});
test("old local data gains empty catalog without destructive migration", async (t) => {
  const x = await setup(t);
  const data = JSON.parse(
    await readFile(join(x.dir, "demo-data.json"), "utf8"),
  );
  delete data.property_catalog;
  await writeFile(join(x.dir, "demo-data.json"), JSON.stringify(data));
  const reopened = await new LocalStore(x.dir).init();
  assert.deepEqual(await reopened.list("property_catalog"), []);
  assert.deepEqual(await reopened.list("users"), data.users);
  assert.deepEqual(await reopened.list("rooms"), data.rooms);
});
test("listing ownership cannot be reassigned or duplicate-created", async (t) => {
  const x = await setup(t);
  const a = await x.service.createRooms(
    { floorId: x.floor._id, layoutId: x.layout._id, numbers: ["101", "102"] },
    audit,
  );
  const listing = await x.service.saveListing(
    null,
    { price: 1000 },
    a.ids[0],
    audit,
  );
  await assert.rejects(
    x.service.saveListing(null, { price: 2000 }, a.ids[0], audit),
    /已有出租房源/,
  );
  await assert.rejects(
    x.service.saveListing(listing._id, { price: 2000 }, a.ids[1], audit),
    /不可更换房间/,
  );
});
test("cloud multi-record batch reads before writes and rolls back on log failure", async () => {
  let pending = [],
    committed = [],
    rollback = false;
  const db = {
    runTransaction: async (callback) => {
      try {
        await callback({
          collection: (name) => ({
            doc: (id) => ({
              get: async () => ({ data: { _id: id, value: 1 } }),
              set: async (data) => {
                if (name === "admin_audit") return { code: "DENIED" };
                pending.push({ name, id, data });
                return {};
              },
            }),
          }),
        });
        committed = pending;
      } catch (e) {
        rollback = true;
        throw e;
      }
    },
  };
  const store = new CloudStore({ database: () => db });
  await assert.rejects(
    store.transact(
      [
        { collection: "rooms", id: "r1" },
        { collection: "houses", id: "h1" },
      ],
      () => [
        { collection: "rooms", id: "r1", data: { layoutCode: "A1" } },
        { collection: "houses", id: "h1", data: { layoutCode: "A1" } },
      ],
      audit,
    ),
    /整批回滚/,
  );
  assert.equal(pending.length, 2);
  assert.equal(committed.length, 0);
  assert.equal(rollback, true);
});
