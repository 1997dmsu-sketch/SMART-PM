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
