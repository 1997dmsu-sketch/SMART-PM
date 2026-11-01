import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { floorPlan, roomPlan } from "../public/auto-fill.js";
import { LocalStore } from "../lib/store.mjs";
import { PropertyService } from "../lib/property.mjs";
const floors = [1, 2, -1].map((level) => ({
  _id: "f" + level,
  kind: "floor",
  level,
  name: level + "层",
  parentId: "b",
}));
test("floor fill supports exclusion and custom naming", () => {
  assert.deepEqual(
    floorPlan({ start: 1, end: 5, skip: "4", template: "{n}F" }).map(
      (f) => f.name,
    ),
    ["1F", "2F", "3F", "5F"],
  );
  assert.equal(floorPlan({ start: -2, end: -1 })[0].name, "-2层");
});
test("room numbering uses floor, padded serial, prefix and complete exclusions", () => {
  assert.deepEqual(
    roomPlan(
      {
        buildingId: "b",
        start: 1,
        end: 2,
        count: 3,
        first: 1,
        digits: 2,
        prefix: "A-",
        skip: "A-102",
      },
      floors,
    ).map((r) => r.number),
    ["A-101", "A-103", "A-201", "A-202", "A-203"],
  );
  assert.equal(
    roomPlan(
      { buildingId: "b", start: -1, end: -1, count: 1, first: 1, digits: 2 },
      floors,
    )[0].number,
    "B101",
  );
});
test("invalid ranges, missing floors, excessive counts and width overflow are rejected", () => {
  for (const data of [
    { start: 5, end: 1 },
    { start: 1, end: 51 },
    { start: 1, end: 2, template: "no-placeholder" },
  ])
    assert.throws(() => floorPlan(data));
  const base = {
    buildingId: "b",
    start: 1,
    end: 1,
    count: 1,
    first: 1,
    digits: 2,
  };
  for (const patch of [
    { end: 3 },
    { end: 2, count: 30 },
    { count: 10, first: 95 },
    { digits: 0 },
    { prefix: "<script>" },
  ])
    assert.throws(() => roomPlan({ ...base, ...patch }, floors));
});
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "autofill-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init(),
    service = new PropertyService(store),
    audit = { actor: "test", action: "auto-fill" };
  const c = await service.createCatalog(
      { kind: "community", name: "自动填充测试" },
      audit,
    ),
    b = await service.createCatalog(
      { kind: "building", name: "1栋", parentId: c._id },
      audit,
    );
  return { store, service, audit, b };
}
test("floor auto-fill is idempotent and preserves existing floor names", async (t) => {
  const { service, store, audit, b } = await setup(t);
  await service.createCatalog(
    { kind: "floor", name: "首层大堂", level: 1, parentId: b._id },
    audit,
  );
  const data = { buildingId: b._id, start: 1, end: 3, template: "{n}F" };
  assert.deepEqual(await service.autoFloors(data, audit), {
    count: 2,
    skipped: 1,
  });
  assert.deepEqual(await service.autoFloors(data, audit), {
    count: 0,
    skipped: 3,
  });
  assert.equal(
    (await store.list("property_catalog")).find(
      (f) => f.kind === "floor" && f.level === 1,
    ).name,
    "首层大堂",
  );
});
test("multi-floor room fill creates and retries without overwriting records", async (t) => {
  const { service, store, audit, b } = await setup(t);
  await service.autoFloors({ buildingId: b._id, start: 1, end: 2 }, audit);
  const l = await service.createCatalog(
    {
      kind: "layout",
      parentId: b._id,
      name: "单间",
      code: "A1",
      bedrooms: 1,
      livingRooms: 0,
    },
    audit,
  );
  const data = {
    buildingId: b._id,
    start: 1,
    end: 2,
    count: 3,
    first: 1,
    digits: 2,
    layoutId: l._id,
    skip: "102",
  };
  assert.deepEqual(await service.autoRooms(data, audit), {
    count: 5,
    skipped: 0,
  });
  const before = await store.list("rooms");
  assert.deepEqual(await service.autoRooms({ ...data, layoutId: "" }, audit), {
    count: 0,
    skipped: 5,
  });
  assert.deepEqual(await store.list("rooms"), before);
  assert.equal(before.find((r) => r.roomNo === "201").layoutCode, "A1");
});
test("concurrent auto-fill cannot duplicate rooms and invalid layout leaves all floors unchanged", async (t) => {
  const { service, store, audit, b } = await setup(t);
  await service.autoFloors({ buildingId: b._id, start: 1, end: 2 }, audit);
  const data = {
    buildingId: b._id,
    start: 1,
    end: 2,
    count: 2,
    first: 1,
    digits: 2,
  };
  const before = await store.list("rooms");
  await assert.rejects(
    service.autoRooms({ ...data, layoutId: "missing" }, audit),
  );
  assert.deepEqual(await store.list("rooms"), before);
  const results = await Promise.all([
    service.autoRooms(data, audit),
    service.autoRooms(data, audit),
  ]);
  assert.equal(
    results.reduce((n, r) => n + r.count, 0),
    4,
  );
  assert.equal(
    (await store.list("rooms")).filter((r) => r.buildingId === b._id).length,
    4,
  );
});
