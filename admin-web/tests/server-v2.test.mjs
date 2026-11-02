import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server.mjs";
import { OrgService } from "../lib/org.mjs";
let app, dir, url, admin, viewer;
async function request(
  path,
  { method = "GET", data, auth = admin, origin = url, csrf = true, headers = {} } = {},
) {
  const h = { Origin: origin, ...headers };
  if (auth) {
    h.Cookie = auth.cookie;
    if (csrf) h["X-CSRF-Token"] = auth.csrf;
  }
  if (data !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(`${url}/api/v2/${path}`, {
    method,
    headers: h,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
const post = (path, data, opts = {}) =>
  request(path, {
    method: "POST",
    data,
    headers: { "Idempotency-Key": randomUUID() },
    ...opts,
  });
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-v2-"));
  app = await createApp({ directory: dir });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${app.server.address().port}`;
  const r = await fetch(`${url}/api/demo-login`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: "{}",
  });
  admin = { cookie: r.headers.get("set-cookie")?.split(";")[0], csrf: (await r.json()).csrf };
  await app.accounts.save({
    username: "viewer2",
    name: "只读",
    role: "viewer",
    password: "test-only-password-123",
    enabled: true,
  });
  const login = await fetch(`${url}/api/login`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "viewer2", password: "test-only-password-123" }),
  });
  viewer = { cookie: login.headers.get("set-cookie")?.split(";")[0], csrf: (await login.json()).csrf };
});
after(async () => {
  await new Promise((r) => app.server.close(r));
  await rm(dir, { recursive: true, force: true });
});
test("v2 responses use the envelope and never leak other organizations", async () => {
  const orgs = await request("me/organizations");
  assert.equal(orgs.status, 200);
  assert.ok(orgs.data.requestId);
  assert.deepEqual(
    orgs.data.data.map((o) => o.orgId),
    ["org-demo"],
  );
  assert.equal(orgs.data.data[0].role, "admin");
  // An account without membership gets an empty list and a 404 org context.
  const outsiderOrgs = await request("me/organizations", { auth: viewer });
  assert.deepEqual(outsiderOrgs.data.data, []);
  const outsider = await request("property/catalog", { auth: viewer });
  assert.equal(outsider.status, 404);
  assert.equal(outsider.data.error.code, "NOT_FOUND");
  assert.ok(outsider.data.requestId);
  // A forged org id is indistinguishable from a missing one.
  const forged = await request("property/catalog", {
    headers: { "X-Org-Id": "org-other" },
  });
  assert.equal(forged.status, 404);
  assert.equal(forged.data.error.code, "NOT_FOUND");
  // Unauthenticated requests stay 401.
  assert.equal((await request("me/organizations", { auth: null })).status, 401);
});
test("v2 writes require Idempotency-Key and replay identical retries", async () => {
  const missing = await request("property/catalog", {
    method: "POST",
    data: { kind: "community", name: "无键小区" },
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.data.error.code, "PARAM_ERROR");
  const key = randomUUID();
  const first = await post(
    "property/catalog",
    { kind: "community", name: "幂等测试小区" },
    { headers: { "Idempotency-Key": key } },
  );
  assert.equal(first.status, 201);
  assert.equal(first.data.data.orgId, "org-demo");
  assert.equal(first.data.data.status, "active");
  // Identical retry returns the stored result and does not duplicate.
  const replay = await post(
    "property/catalog",
    { kind: "community", name: "幂等测试小区" },
    { headers: { "Idempotency-Key": key } },
  );
  assert.equal(replay.status, 201);
  assert.equal(replay.data.data._id, first.data.data._id);
  const list = await request("property/catalog?kind=community&limit=100");
  assert.equal(
    list.data.data.filter((c) => c.name === "幂等测试小区").length,
    1,
  );
  // Same key with a different body is rejected.
  const conflict = await post(
    "property/catalog",
    { kind: "community", name: "另一个小区" },
    { headers: { "Idempotency-Key": key } },
  );
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error.code, "IDEMPOTENCY_CONFLICT");
});
test("full org-scoped flow: create hierarchy, list with filters, archive with blockers", async () => {
  const community = await post("property/create", {
    mode: "new",
    communityName: "归档测试小区",
    buildingName: "1栋",
  });
  assert.equal(community.status, 201);
  const floor = await post("property/catalog", {
    kind: "floor",
    name: "1层",
    level: 1,
    parentId: community.data.data.buildingId,
  });
  assert.equal(floor.status, 201);
  const layout = await post("property/catalog", {
    kind: "layout",
    name: "单间",
    code: "T1",
    bedrooms: 1,
    livingRooms: 0,
    parentId: community.data.data.buildingId,
  });
  assert.equal(layout.status, 201);
  // Rooms are created through the service surface (old admin endpoints remain
  // the room-creation entry); v2 lists them with org scoping.
  const { OrgPropertyService } = await import("../lib/property-v2.mjs");
  const service = new OrgPropertyService(app.store, "org-demo");
  const rooms = await service.createRooms(
    { floorId: floor.data.data._id, numbers: ["101", "102"] },
    { actor: "test", actorId: "demo-admin", action: "测试建房" },
  );
  const listed = await request(`rooms?floorId=${floor.data.data._id}`);
  assert.equal(listed.status, 200);
  assert.equal(listed.data.data.length, 2);
  assert.ok(listed.data.data.every((r) => r.roomId && r.houseId));
  // Building archive is blocked while rooms are active.
  const building = (await request("property/catalog?kind=building&limit=100")).data.data.find(
    (b) => b._id === community.data.data.buildingId,
  );
  const blocked = await post(`property/building/${building._id}/archive`, {
    expectedRevision: building.revision,
    reason: "尝试归档",
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error.code, "ARCHIVE_BLOCKED");
  // Layout archive releases the code for reuse.
  const archived = await post(`property/layout/${layout.data.data._id}/archive`, {
    expectedRevision: layout.data.data.revision,
    reason: "户型调整",
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.data.data.status, "archived");
  const history = await request("property/catalog?kind=layout&status=archived");
  assert.equal(history.data.data.length, 1);
  const actives = await request("property/catalog?kind=layout&status=active");
  assert.equal(actives.data.data.length, 0);
  // Archived layout cannot take new rooms.
  const rejected = await service
    .createRooms(
      { floorId: floor.data.data._id, layoutId: layout.data.data._id, numbers: ["201"] },
      { actor: "test", actorId: "demo-admin", action: "测试建房" },
    )
    .then(
      () => null,
      (e) => e,
    );
  assert.equal(rejected.code, "INVALID_STATE");
});
test("granted non-admin membership can read but not write", async () => {
  const orgs = new OrgService(app.store);
  await orgs.grantMembership(
    {
      orgId: "org-demo",
      principalType: "adminAccount",
      principalId: app.accounts.rows.find((a) => a.username === "viewer2")._id,
      role: "viewer",
    },
    { actor: "system", actorId: "system", action: "测试授权" },
  );
  const read = await request("property/catalog?limit=5", { auth: viewer });
  assert.equal(read.status, 200);
  const denied = await post(
    "property/catalog",
    { kind: "community", name: "越权小区" },
    { auth: viewer },
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.data.error.code, "FORBIDDEN");
});
test("v2 cursor pagination is stable and org-filtered over HTTP", async () => {
  for (let i = 0; i < 23; i++)
    await post("property/catalog", {
      kind: "community",
      name: `分页小区${String(i).padStart(2, "0")}`,
    });
  const first = await request("property/catalog?kind=community&limit=20");
  assert.equal(first.data.data.length, 20);
  assert.ok(first.data.nextCursor);
  const second = await request(
    `property/catalog?kind=community&limit=20&cursor=${encodeURIComponent(first.data.nextCursor)}`,
  );
  assert.ok(second.data.data.length > 0);
  const names = new Set([
    ...first.data.data.map((r) => r._id),
    ...second.data.data.map((r) => r._id),
  ]);
  assert.equal(names.size, first.data.data.length + second.data.data.length);
});
test("F01: legacy endpoints never expose or mutate org-scoped records", async () => {
  const { OrgPropertyService } = await import("../lib/property-v2.mjs");
  const service = new OrgPropertyService(app.store, "org-demo", {
    membershipId: (await app.store.list("org_memberships")).find(
      (m) => m.orgId === "org-demo" && m.principalId === "demo-admin",
    )._id,
  });
  const audit = { actor: "test", actorId: "demo-admin", action: "F01 测试" };
  const { communityId, buildingId } = await service.createProperty(
    { mode: "new", communityName: "隔离小区", buildingName: "隔离栋" },
    audit,
  );
  const floor = await service.createCatalog(
    { kind: "floor", name: "1层", level: 1, parentId: buildingId },
    audit,
  );
  const { ids, } = await service.createRooms(
    { floorId: floor._id, numbers: ["601"] },
    audit,
  );
  const v2Room = (await app.store.list("rooms", "org-demo")).find(
    (r) => r._id === ids[0],
  );
  // Old snapshot and resource lists stay legacy-only — for any role.
  for (const auth of [admin, viewer]) {
    const snapshot = await request("property/snapshot", { auth });
    // request() prefixes /api/v2/ — call the legacy path directly.
    const legacy = await fetch(`${url}/api/property/snapshot`, {
      headers: { Origin: url, Cookie: auth.cookie },
    });
    assert.equal(legacy.status, 200);
    const body = await legacy.json();
    assert.ok(body.catalog.every((c) => !c.orgId));
    assert.ok(body.rooms.every((r) => !r.orgId));
    const roomsList = await fetch(`${url}/api/rooms`, {
      headers: { Origin: url, Cookie: auth.cookie },
    });
    const roomsBody = await roomsList.json();
    assert.ok(roomsBody.rows.every((r) => !r.orgId));
    void snapshot;
  }
  // Old write paths reject v2 parents and identifiers.
  const viaLegacyCatalog = await fetch(`${url}/api/property/catalog`, {
    method: "POST",
    headers: { Origin: url, Cookie: admin.cookie, "X-CSRF-Token": admin.csrf, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "floor", name: "2层", level: 2, parentId: buildingId }),
  });
  assert.equal(viaLegacyCatalog.status, 409);
  const viaLegacyBinding = await fetch(`${url}/api/users/demo-user-2/binding`, {
    method: "POST",
    headers: { Origin: url, Cookie: admin.cookie, "X-CSRF-Token": admin.csrf, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "bind", houseId: v2Room.houseId }),
  });
  assert.equal(viaLegacyBinding.status, 400);
  const viaLegacyRoomEdit = await fetch(`${url}/api/rooms/${v2Room._id}`, {
    method: "PUT",
    headers: { Origin: url, Cookie: admin.cookie, "X-CSRF-Token": admin.csrf, "Content-Type": "application/json" },
    body: JSON.stringify({ houseId: v2Room.houseId, name: "篡改", sortOrder: 0 }),
  });
  assert.equal(viaLegacyRoomEdit.status, 404);
  void communityId;
});
test("F04: archived listings cannot be re-published through the legacy endpoint", async () => {
  // A legacy-visible listing already archived (lifecycle) stays 下架.
  await app.store.transact(
    [{ collection: "houses", id: "house-archived-legacy" }],
    () => [
      {
        collection: "houses",
        id: "house-archived-legacy",
        data: {
          title: "已归档房源",
          community: "测试",
          price: 1000,
          area: 40,
          rooms: "1室1厅",
          rentType: "整租",
          status: "下架",
          lifecycle: "archived",
        },
      },
    ],
    { actor: "test", actorId: "demo-admin", action: "F04 测试" },
  );
  const republish = await fetch(`${url}/api/houses/house-archived-legacy`, {
    method: "PUT",
    headers: { Origin: url, Cookie: admin.cookie, "X-CSRF-Token": admin.csrf, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "已归档房源",
      community: "测试",
      price: 1000,
      area: 40,
      rooms: "1室1厅",
      rentType: "整租",
      status: "在租",
    }),
  });
  assert.equal(republish.status, 409);
  const house = (await app.store.list("houses")).find(
    (h) => h._id === "house-archived-legacy",
  );
  assert.equal(house.status, "下架");
});

test("R2-02: vr-download never serves org-scoped records; legacy records still download", async () => {
  const bytes = Buffer.from("<html>vr-content</html>");
  const upload = await fetch(`${url}/api/vr-upload?name=tour.html`, {
    method: "POST",
    headers: { Origin: url, Cookie: admin.cookie, "X-CSRF-Token": admin.csrf, "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  assert.equal(upload.status, 200);
  const vrFile = await upload.json();
  // Seed an org-scoped content record pointing at a REAL file, exactly like
  // the R2-02 reproduction: hiding the ID in lists is not download authz.
  await app.store.transact(
    [{ collection: "content", id: "content-org-scoped" }],
    () => [
      {
        collection: "content",
        id: "content-org-scoped",
        data: {
          title: "组织 VR",
          type: "share",
          orgId: "org-demo",
          schemaVersion: 2,
          vrFile,
        },
      },
    ],
    { actor: "test", actorId: "demo-admin", action: "R2-02 测试" },
  );
  // Fresh account with NO membership anywhere (viewer2 already holds an
  // org-demo membership from an earlier test, so it cannot play the outsider).
  await app.accounts.save({
    username: "vr-outsider",
    name: "无组织账号",
    role: "viewer",
    password: "test-only-password-123",
    enabled: true,
  });
  const login = await fetch(`${url}/api/login`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "vr-outsider", password: "test-only-password-123" }),
  });
  const outsiderAuth = { cookie: login.headers.get("set-cookie")?.split(";")[0] };
  const download = (id, auth) =>
    fetch(`${url}/api/vr-download?id=${id}`, {
      headers: { Origin: url, Cookie: auth.cookie },
    });
  // 1) Account without any membership: must not get the org-scoped file.
  const outsider = await download("content-org-scoped", outsiderAuth);
  assert.equal(outsider.status, 404);
  assert.notEqual(await outsider.text(), bytes.toString());
  // 2) Same account after joining ANOTHER org (not org-demo): still rejected.
  const orgs = new OrgService(app.store);
  await orgs.bootstrap(
    {
      id: "org-other",
      name: "其他组织",
      adminAccountIds: [app.accounts.rows.find((a) => a.username === "vr-outsider")._id],
    },
    { actor: "test", actorId: "demo-admin", action: "R2-02 测试" },
  );
  const otherOrg = await download("content-org-scoped", outsiderAuth);
  assert.equal(otherOrg.status, 404);
  // Even a global admin must not fetch org-scoped content via the legacy
  // endpoint (same rule as the other legacy paths closed under F01).
  assert.equal((await download("content-org-scoped", admin)).status, 404);
  // 3) Legacy content (no orgId) still downloads normally.
  await app.store.transact(
    [{ collection: "content", id: "content-legacy" }],
    () => [
      {
        collection: "content",
        id: "content-legacy",
        data: { title: "旧 VR", type: "share", vrFile },
      },
    ],
    { actor: "test", actorId: "demo-admin", action: "R2-02 测试" },
  );
  const ok = await download("content-legacy", outsiderAuth);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-disposition"), /^attachment/);
  assert.equal(await ok.text(), bytes.toString());
});

test("DB-03: persons HTTP endpoints are org-admin only and org-scoped", async () => {
  const created = await post("persons", { name: "张无账" });
  assert.equal(created.status, 201);
  assert.equal(created.data.data.orgId, "org-demo");
  assert.equal(created.data.data.nameMasked, "张**");
  assert.ok(!JSON.stringify(created.data).includes("张无账"));
  const list = await request("persons?limit=20");
  assert.equal(list.status, 200);
  const row = list.data.data.find((p) => p.personId === created.data.data.personId);
  assert.equal(row.userId, null);
  assert.ok(!("phone" in row));
  // Idempotent replay of the same creation returns the stored person.
  const key = randomUUID();
  const first = await post("persons", { name: "幂等人员" }, { headers: { "Idempotency-Key": key } });
  const replay = await post("persons", { name: "幂等人员" }, { headers: { "Idempotency-Key": key } });
  assert.equal(replay.data.data.personId, first.data.data.personId);
  // viewer2 holds an org-demo viewer membership: read yes, write no.
  const viewerRead = await request("persons?limit=5", { auth: viewer });
  assert.equal(viewerRead.status, 200);
  const viewerWrite = await post("persons", { name: "越权人员" }, { auth: viewer });
  assert.equal(viewerWrite.status, 403);
  // A forged org context is indistinguishable from a missing one.
  const forged = await request("persons?limit=5", { headers: { "X-Org-Id": "org-other" } });
  assert.equal(forged.status, 404);
});
