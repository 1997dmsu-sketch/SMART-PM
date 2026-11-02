import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalStore } from "../lib/store.mjs";
import { OrgService, membershipId } from "../lib/org.mjs";
import { OrgPropertyService, OpReplay } from "../lib/property-v2.mjs";
import { guardId } from "../lib/claims.mjs";
const audit = { actor: "test-admin", actorId: "acc-1", action: "组织物业测试" };
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-orgv2-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  const orgs = new OrgService(store);
  await orgs.bootstrap(
    { id: "org-a", name: "组织A", adminAccountIds: ["acc-1"] },
    audit,
  );
  await orgs.bootstrap(
    { id: "org-b", name: "组织B", adminAccountIds: ["acc-2"] },
    audit,
  );
  const a = new OrgPropertyService(store, "org-a");
  const b = new OrgPropertyService(store, "org-b");
  const community = await a.createCatalog(
    { kind: "community", name: "甲小区" },
    audit,
  );
  const building = await a.createCatalog(
    { kind: "building", name: "1栋", parentId: community._id },
    audit,
  );
  const floor = await a.createCatalog(
    { kind: "floor", name: "1层", level: 1, parentId: building._id },
    audit,
  );
  const layout = await a.createCatalog(
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
  return { dir, store, orgs, a, b, community, building, floor, layout };
}
test("bootstrap is idempotent, creates guard and admin memberships, never from request-shaped input", async (t) => {
  const x = await setup(t);
  const again = await x.orgs.bootstrap(
    { id: "org-a", name: "改名不应生效", adminAccountIds: ["acc-1"] },
    audit,
  );
  assert.equal(again.orgId, "org-a");
  const org = await x.orgs.organization("org-a");
  assert.equal(org.name, "组织A");
  assert.equal(org.schemaVersion, 2);
  assert.equal(org.status, "active");
  const guard = (await x.store.list("lifecycle_guards")).find(
    (g) => g._id === guardId("org-a"),
  );
  // Bootstrap creates the guard; setup's v2 creations have already bumped it.
  assert.equal(guard.orgId, "org-a");
  assert.ok(Number.isInteger(guard.epoch) && guard.epoch >= 0);
  const memberships = await x.store.list("org_memberships");
  assert.equal(
    memberships.filter((m) => m.orgId === "org-a" && m.role === "admin").length,
    1,
  );
  for (const bad of [
    { id: "X", name: "短" },
    { id: "org x", name: "空格" },
    { id: "org-ok", name: "" },
  ])
    await assert.rejects(x.orgs.bootstrap(bad, audit), /PARAM_ERROR|组织/);
});
test("organizationsFor exposes only own memberships; requireMembership does not leak other orgs", async (t) => {
  const x = await setup(t);
  assert.deepEqual(
    (await x.orgs.organizationsFor("adminAccount", "acc-1")).map((o) => o.orgId),
    ["org-a"],
  );
  assert.deepEqual(await x.orgs.organizationsFor("adminAccount", "nobody"), []);
  const own = await x.orgs.requireMembership("adminAccount", "acc-1", "org-a");
  assert.equal(own.membership.role, "admin");
  // Wrong org and nonexistent org are indistinguishable (404).
  for (const orgId of ["org-b", "org-missing"])
    await assert.rejects(
      x.orgs.requireMembership("adminAccount", "acc-1", orgId),
      (e) => e.status === 404 && e.code === "NOT_FOUND",
    );
  // A visible membership without admin role cannot write.
  await x.orgs.grantMembership(
    { orgId: "org-a", principalType: "adminAccount", principalId: "acc-9", role: "viewer" },
    audit,
  );
  await assert.rejects(
    x.orgs.requireMembership("adminAccount", "acc-9", "org-a", { write: true }),
    (e) => e.status === 403,
  );
  await assert.rejects(
    x.orgs.grantMembership(
      { orgId: "org-a", principalType: "adminAccount", principalId: "acc-9", role: "viewer" },
      audit,
    ),
    /已存在/,
  );
});
test("layout code uniqueness is org+building scoped and claim-based; other orgs may reuse", async (t) => {
  const x = await setup(t);
  await assert.rejects(
    x.a.createCatalog(
      {
        kind: "layout",
        name: "冲突",
        code: "a1",
        bedrooms: 1,
        livingRooms: 1,
        parentId: x.building._id,
      },
      audit,
    ),
    (e) => e.code === "DUPLICATE" && e.status === 409,
  );
  // Same code in another organization is independent.
  const bCommunity = await x.b.createCatalog({ kind: "community", name: "乙小区" }, audit);
  const bBuilding = await x.b.createCatalog(
    { kind: "building", name: "1栋", parentId: bCommunity._id },
    audit,
  );
  const bLayout = await x.b.createCatalog(
    {
      kind: "layout",
      name: "同名户型",
      code: "A1",
      bedrooms: 2,
      livingRooms: 1,
      parentId: bBuilding._id,
    },
    audit,
  );
  assert.equal(bLayout.code, "A1");
  assert.notEqual(bLayout._id, x.layout._id);
  // Concurrent creation of the same code: exactly one wins.
  const outcomes = await Promise.allSettled(
    [1, 2].map(() =>
      x.a.createCatalog(
        {
          kind: "layout",
          name: "并发户型",
          code: "RACE",
          bedrooms: 1,
          livingRooms: 0,
          parentId: x.building._id,
        },
        audit,
      ),
    ),
  );
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  const claims = await x.store.list("unique_claims");
  assert.equal(
    claims.filter(
      (c) => c.namespace === "layout-code" && c.key === "RACE" && c.orgId === "org-a",
    ).length,
    1,
  );
});
test("room creation writes claim and slot consistently; concurrency cannot duplicate room numbers", async (t) => {
  const x = await setup(t);
  const created = await x.a.createRooms(
    { floorId: x.floor._id, layoutId: x.layout._id, numbers: ["101", "102"] },
    audit,
  );
  assert.equal(created.count, 2);
  const rooms = (await x.store.list("rooms")).filter((r) =>
    created.ids.includes(r._id),
  );
  assert.equal(rooms.length, 2);
  for (const room of rooms) {
    assert.equal(room.orgId, "org-a");
    assert.equal(room.status, "active");
    assert.equal(room.schemaVersion, 2);
    assert.equal(room.revision, 1);
    assert.match(room.houseId, /^PROP-/);
    assert.notEqual(room.houseId, room._id);
  }
  const floor = (await x.store.list("property_catalog")).find(
    (c) => c._id === x.floor._id,
  );
  assert.deepEqual(
    floor.slots.map((s) => s.number).sort(),
    ["101", "102"],
  );
  const claims = (await x.store.list("unique_claims")).filter(
    (c) => c.namespace === "room-no",
  );
  assert.equal(claims.length, 2);
  assert.ok(claims.every((c) => c.state === "bound"));
  const outcomes = await Promise.allSettled(
    [1, 2].map(() =>
      x.a.createRooms({ floorId: x.floor._id, numbers: ["101"] }, audit),
    ),
  );
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 0);
  await assert.rejects(
    x.b.createRooms({ floorId: x.floor._id, numbers: ["999"] }, audit),
    (e) => e.status === 404,
  );
});
test("listCatalog filters by organization before cursor pagination", async (t) => {
  const x = await setup(t);
  for (let i = 0; i < 24; i++)
    await x.a.createCatalog(
      { kind: "building", name: `B${String(i).padStart(2, "0")}`, parentId: x.community._id },
      audit,
    );
  const bCommunity = await x.b.createCatalog({ kind: "community", name: "乙小区" }, audit);
  for (let i = 0; i < 5; i++)
    await x.b.createCatalog(
      { kind: "building", name: `B${String(i).padStart(2, "0")}`, parentId: bCommunity._id },
      audit,
    );
  const first = await x.a.listCatalog({ kind: "building", limit: 20 });
  assert.equal(first.data.length, 20);
  assert.ok(first.nextCursor);
  assert.ok(first.data.every((r) => r.orgId === "org-a"));
  const second = await x.a.listCatalog({
    kind: "building",
    limit: 20,
    cursor: first.nextCursor,
  });
  assert.equal(second.data.length, 5); // 25 org-a buildings total, org-b never counted
  assert.equal(second.nextCursor, undefined);
  const bList = await x.b.listCatalog({ kind: "building", limit: 100 });
  assert.equal(bList.data.length, 5);
  await assert.rejects(x.a.listCatalog({ limit: 101 }), /limit/);
  await assert.rejects(
    x.a.listCatalog({ kind: "building", cursor: "cat-nonexistent" }),
    /游标/,
  );
});
test("legacy records without orgId stay invisible to the v2 surface", async (t) => {
  const x = await setup(t);
  const all = await x.a.listCatalog({ limit: 100 });
  assert.ok(all.data.every((r) => r.orgId === "org-a"));
  const rooms = await x.a.listRooms({ limit: 100 });
  assert.ok(rooms.data.every((r) => r.orgId === "org-a"));
  // Seed contains legacy rooms (demo-room-1) without orgId — never leaked.
  assert.equal(rooms.data.some((r) => r._id === "demo-room-1"), false);
});
test("archiving a layout releases its code claim and blocks dependent creation", async (t) => {
  const x = await setup(t);
  await assert.rejects(
    x.a.archive("layout", x.layout._id, { expectedRevision: 99, reason: "版本错" }, audit),
    (e) => e.code === "REVISION_CONFLICT",
  );
  const done = await x.a.archive(
    "layout",
    x.layout._id,
    { expectedRevision: 1, reason: "户型下线" },
    audit,
  );
  assert.equal(done.status, "archived");
  const layout = (await x.store.list("property_catalog")).find(
    (c) => c._id === x.layout._id,
  );
  assert.equal(layout.status, "archived");
  assert.equal(layout.archiveReason, "户型下线");
  assert.equal(layout.archivedBy, "acc-1");
  assert.equal(layout.revision, 2);
  await assert.rejects(
    x.a.archive("layout", x.layout._id, { expectedRevision: 2, reason: "重复" }, audit),
    (e) => e.code === "INVALID_STATE",
  );
  // Code can be reused after release; history record stays.
  const reused = await x.a.createCatalog(
    {
      kind: "layout",
      name: "新A1",
      code: "A1",
      bedrooms: 1,
      livingRooms: 1,
      parentId: x.building._id,
    },
    audit,
  );
  assert.notEqual(reused._id, x.layout._id);
  await assert.rejects(
    x.a.createRooms(
      { floorId: x.floor._id, layoutId: x.layout._id, numbers: ["201"] },
      audit,
    ),
    (e) => e.code === "INVALID_STATE",
  );
  const guard = (await x.store.list("lifecycle_guards")).find(
    (g) => g._id === guardId("org-a"),
  );
  assert.ok(guard.epoch >= 1);
});
test("archive is blocked by active rooms, listings and bound legacy users, with counts only", async (t) => {
  const x = await setup(t);
  const { ids } = await x.a.createRooms(
    { floorId: x.floor._id, layoutId: x.layout._id, numbers: ["101"] },
    audit,
  );
  const freshFloor = (await x.store.list("property_catalog")).find(
    (c) => c._id === x.floor._id,
  );
  await assert.rejects(
    x.a.archive("floor", x.floor._id, { expectedRevision: freshFloor.revision, reason: "有房间" }, audit),
    (e) => e.code === "ARCHIVE_BLOCKED" && /房间1项/.test(e.message),
  );
  await assert.rejects(
    x.a.archive("building", x.building._id, { expectedRevision: 1, reason: "有下级" }, audit),
    (e) => e.code === "ARCHIVE_BLOCKED" && /楼层1项/.test(e.message) && /房间1项/.test(e.message),
  );
  // Bound legacy user blocks room archive without exposing who.
  const boundHouseId = (await x.store.list("rooms")).find(
    (r) => r._id === ids[0],
  ).houseId;
  await x.store.change(
    "users",
    "demo-user-1",
    (old) => ({ houses: [...old.houses, boundHouseId] }),
    audit,
  );
  await assert.rejects(
    x.a.archive("room", ids[0], { expectedRevision: 1, reason: "有人绑定" }, audit),
    (e) => e.code === "ARCHIVE_BLOCKED" && /绑定用户1项/.test(e.message),
  );
  // Nothing was partially archived.
  assert.equal(
    (await x.store.list("rooms")).find((r) => r._id === ids[0]).status,
    "active",
  );
});
test("house archive keeps the room link and does not release the listing placeholder", async (t) => {
  const x = await setup(t);
  const { ids } = await x.a.createRooms(
    { floorId: x.floor._id, layoutId: x.layout._id, numbers: ["101"] },
    audit,
  );
  const listing = {
    _id: "listing-v2-1",
    orgId: "org-a",
    title: "在租房源",
    status: "在租",
    lifecycle: "active",
    propertyRoomId: ids[0],
    schemaVersion: 2,
    revision: 1,
  };
  await x.store.transact(
    [
      { collection: "houses", id: listing._id },
      { collection: "rooms", id: ids[0] },
    ],
    () => [
      { collection: "houses", id: listing._id, data: listing },
      { collection: "rooms", id: ids[0], data: { listingId: listing._id } },
    ],
    audit,
  );
  await assert.rejects(
    x.a.archive("room", ids[0], { expectedRevision: 1, reason: "有房源" }, audit),
    (e) => e.code === "ARCHIVE_BLOCKED" && /关联房源1项/.test(e.message),
  );
  const done = await x.a.archive(
    "house",
    listing._id,
    { expectedRevision: 1, reason: "停止出租" },
    audit,
  );
  assert.equal(done.status, "archived");
  const house = (await x.store.list("houses")).find((h) => h._id === listing._id);
  assert.equal(house.lifecycle, "archived");
  // F04: archiving also takes the listing off-market so the unchanged customer
  // query predicate (status=在租 && !isPublic) never returns it; the previous
  // business status is preserved for audit.
  assert.equal(house.status, "下架");
  assert.equal(house.statusBeforeArchive, "在租");
  const customerVisible = (h) =>
    h.status === "在租" && h.isPublic !== true && h.lifecycle !== "archived";
  assert.equal(customerVisible(house), false);
  assert.equal(house.propertyRoomId, ids[0]); // history link kept
  // Now the room can be archived; its number claim and slot are released.
  await x.a.archive("room", ids[0], { expectedRevision: 1, reason: "房间下线" }, audit);
  const floor = (await x.store.list("property_catalog")).find(
    (c) => c._id === x.floor._id,
  );
  assert.equal(floor.slots.length, 0);
  const claim = (await x.store.list("unique_claims")).find(
    (c) => c.namespace === "room-no" && c.key === "101",
  );
  assert.equal(claim.state, "released");
  const recreated = await x.a.createRooms(
    { floorId: x.floor._id, numbers: ["101"] },
    audit,
  );
  assert.equal(recreated.count, 1);
});
test("batchLayout checks expectedRevisions, rejects archived rooms and syncs listings", async (t) => {
  const x = await setup(t);
  const { ids } = await x.a.createRooms(
    { floorId: x.floor._id, layoutId: x.layout._id, numbers: ["101", "102"] },
    audit,
  );
  const layout2 = await x.a.createCatalog(
    {
      kind: "layout",
      name: "两房",
      code: "B1",
      bedrooms: 2,
      livingRooms: 1,
      parentId: x.building._id,
    },
    audit,
  );
  await assert.rejects(
    x.a.batchLayout(
      { ids, layoutId: layout2._id, expectedRevisions: { [ids[0]]: 1, [ids[1]]: 7 } },
      audit,
    ),
    (e) => e.code === "REVISION_CONFLICT",
  );
  const done = await x.a.batchLayout(
    { ids, layoutId: layout2._id, expectedRevisions: { [ids[0]]: 1, [ids[1]]: 1 } },
    audit,
  );
  assert.equal(done.count, 2);
  const rooms = await x.store.list("rooms");
  for (const id of ids) {
    const room = rooms.find((r) => r._id === id);
    assert.equal(room.layoutCode, "B1");
    assert.equal(room.revision, 2);
  }
  // Archived rooms cannot be re-assigned (revisions still required).
  await x.a.archive("room", ids[0], { expectedRevision: 2, reason: "下线" }, audit);
  await assert.rejects(
    x.a.batchLayout(
      { ids, layoutId: x.layout._id, expectedRevisions: { [ids[0]]: 3, [ids[1]]: 2 } },
      audit,
    ),
    (e) => e.code === "INVALID_STATE",
  );
});
test("batchLayout requires expectedRevisions and rejects cross-organization listing links", async (t) => {
  const x = await setup(t);
  const { ids } = await x.a.createRooms(
    { floorId: x.floor._id, layoutId: x.layout._id, numbers: ["101"] },
    audit,
  );
  await assert.rejects(
    x.a.batchLayout({ ids, layoutId: x.layout._id }, audit),
    (e) => e.code === "PARAM_ERROR" && /expectedRevisions/.test(e.message),
  );
  // A dirty link to another organization's listing rejects the whole batch.
  await x.store.transact(
    [
      { collection: "houses", id: "house-foreign" },
      { collection: "rooms", id: ids[0] },
    ],
    () => [
      {
        collection: "houses",
        id: "house-foreign",
        data: { orgId: "org-b", propertyRoomId: ids[0], lifecycle: "active", revision: 1 },
      },
      { collection: "rooms", id: ids[0], data: { listingId: "house-foreign" } },
    ],
    audit,
  );
  await assert.rejects(
    x.a.batchLayout(
      { ids, layoutId: x.layout._id, expectedRevisions: { [ids[0]]: 1 } },
      audit,
    ),
    (e) => e.code === "ORG_MISMATCH" && e.status === 409,
  );
  const rooms = await x.store.list("rooms");
  assert.equal(rooms.find((r) => r._id === ids[0]).revision, 1); // untouched
});
test("idempotent operations replay results and reject same-key different-body retries", async (t) => {
  const x = await setup(t);
  const op = {
    id: "op-test-1",
    actorId: "acc-1",
    orgId: "org-a",
    route: "/api/v2/property/catalog",
    keyDigest: "k",
    bodyDigest: "body-1",
  };
  const created = await x.a.createCatalog(
    { kind: "community", name: "幂等小区" },
    audit,
    op,
  );
  // Same key + same body replays the stored result without a second record.
  let replayed = null;
  try {
    await x.a.createCatalog({ kind: "community", name: "幂等小区" }, audit, op);
  } catch (e) {
    replayed = e;
  }
  assert.ok(replayed instanceof OpReplay);
  const stored = JSON.parse(replayed.resultRef);
  assert.equal(stored.status, 201);
  assert.equal(stored.body._id, created._id);
  assert.equal(
    (await x.store.list("property_catalog")).filter((c) => c.name === "幂等小区")
      .length,
    1,
  );
  // Same key + different body is a conflict.
  await assert.rejects(
    x.a.createCatalog(
      { kind: "community", name: "别的小区" },
      audit,
      { ...op, bodyDigest: "body-2" },
    ),
    (e) => e.code === "IDEMPOTENCY_CONFLICT" && e.status === 409,
  );
});
test("createProperty keeps new/existing modes with org-scoped name claims", async (t) => {
  const x = await setup(t);
  const created = await x.a.createProperty(
    { mode: "new", communityName: "新公寓", buildingName: "A栋" },
    audit,
  );
  const catalog = await x.store.list("property_catalog");
  assert.equal(
    catalog.find((c) => c._id === created.communityId).orgId,
    "org-a",
  );
  assert.equal(
    catalog.find((c) => c._id === created.buildingId).parentId,
    created.communityId,
  );
  await assert.rejects(
    x.a.createProperty({ mode: "new", communityName: "新公寓", buildingName: "B栋" }, audit),
    (e) => e.code === "DUPLICATE",
  );
  await assert.rejects(
    x.a.createProperty(
      { mode: "existing", communityId: created.communityId, buildingName: "A栋" },
      audit,
    ),
    (e) => e.code === "DUPLICATE",
  );
  const second = await x.a.createProperty(
    { mode: "existing", communityId: created.communityId, buildingName: "C栋" },
    audit,
  );
  assert.equal(second.communityId, created.communityId);
  // Another org cannot attach to org-a's community.
  await assert.rejects(
    x.b.createProperty(
      { mode: "existing", communityId: created.communityId, buildingName: "越权栋" },
      audit,
    ),
    (e) => e.status === 404,
  );
});
test("F02 barrier: a creation landing between archive scan and commit forces a rescan that blocks", async (t) => {
  const x = await setup(t);
  const origList = x.store.list.bind(x.store);
  let injected = false;
  // Pause point: right after the archive pre-scan reads the lifecycle guard,
  // a building creation commits (bumping the guard epoch) before the archive
  // transaction starts.
  x.store.list = async (name, scope) => {
    const rows = await origList(name, scope);
    if (!injected && name === "lifecycle_guards") {
      injected = true;
      await x.a.createCatalog(
        { kind: "building", name: "屏障插入栋", parentId: x.community._id },
        audit,
      );
    }
    return rows;
  };
  await assert.rejects(
    x.a.archive(
      "community",
      x.community._id,
      { expectedRevision: x.community.revision, reason: "屏障测试" },
      audit,
    ),
    (e) => e.code === "ARCHIVE_BLOCKED" && /楼栋1项/.test(e.message),
  );
  const catalog = await origList("property_catalog");
  assert.equal(
    catalog.find((c) => c._id === x.community._id).status,
    "active",
  );
  assert.equal(
    catalog.find((c) => c.name === "屏障插入栋").status,
    "active",
  );
});
test("F03 barrier: archiving the layout between pre-read and commit rejects room creation", async (t) => {
  const x = await setup(t);
  const origTransact = x.store.transact.bind(x.store);
  let injected = false;
  // Pause point: after createRooms pre-reads (valid layout), the layout is
  // archived before the create transaction runs.
  x.store.transact = async (refs, build, auditArg) => {
    if (!injected) {
      injected = true;
      await x.a.archive(
        "layout",
        x.layout._id,
        { expectedRevision: x.layout.revision, reason: "屏障归档" },
        audit,
      );
    }
    return origTransact(refs, build, auditArg);
  };
  await assert.rejects(
    x.a.createRooms(
      { floorId: x.floor._id, layoutId: x.layout._id, numbers: ["301"] },
      audit,
    ),
    (e) => e.code === "INVALID_STATE",
  );
  const rooms = await x.store.list("rooms");
  assert.equal(rooms.some((r) => r.roomNo === "301"), false);
  // The room-no claim was not left bound either.
  const claimsLeft = (await x.store.list("unique_claims")).filter(
    (c) => c.namespace === "room-no" && c.key === "301",
  );
  assert.equal(claimsLeft.length, 0);
});
test("expired idempotency keys are rejected instead of replayed or re-executed", async (t) => {
  const x = await setup(t);
  const op = {
    id: "op-expired",
    actorId: "acc-1",
    orgId: "org-a",
    route: "/api/v2/property/catalog",
    keyDigest: "k",
    bodyDigest: "body-1",
  };
  await x.store.transact(
    [{ collection: "operation_keys", id: op.id }],
    () => [
      {
        collection: "operation_keys",
        id: op.id,
        data: {
          ...op,
          state: "completed",
          resultRef: JSON.stringify({ status: 201, body: { _id: "old" } }),
          expiresAt: Date.now() - 1000,
        },
      },
    ],
    audit,
  );
  await assert.rejects(
    x.a.createCatalog({ kind: "community", name: "过期键小区" }, audit, op),
    (e) => e.code === "IDEMPOTENCY_EXPIRED" && e.status === 409,
  );
  assert.equal(
    (await x.store.list("property_catalog")).filter((c) => c.name === "过期键小区")
      .length,
    0,
  );
});
test("membership revoked after pre-check is caught inside the write transaction", async (t) => {
  const x = await setup(t);
  const membershipId = "mem-revoked";
  await x.store.transact(
    [{ collection: "org_memberships", id: membershipId }],
    () => [
      {
        collection: "org_memberships",
        id: membershipId,
        data: {
          orgId: "org-a",
          principalType: "adminAccount",
          principalId: "acc-temp",
          role: "admin",
          status: "active",
          schemaVersion: 2,
          revision: 1,
        },
      },
    ],
    audit,
  );
  const authed = new OrgPropertyService(x.store, "org-a", { membershipId });
  // Revoke the membership before the write; the in-transaction check must
  // refuse even though the service was constructed while it was valid.
  await x.store.transact(
    [{ collection: "org_memberships", id: membershipId }],
    () => [
      {
        collection: "org_memberships",
        id: membershipId,
        data: { status: "disabled", revision: 2 },
      },
    ],
    audit,
  );
  await assert.rejects(
    authed.createCatalog({ kind: "community", name: "撤权小区" }, audit),
    (e) => e.code === "FORBIDDEN" && e.status === 403,
  );
  assert.equal(
    (await x.store.list("property_catalog")).filter((c) => c.name === "撤权小区")
      .length,
    0,
  );
});
