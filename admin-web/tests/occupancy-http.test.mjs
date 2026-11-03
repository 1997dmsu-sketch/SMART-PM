import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createApp } from "../server.mjs";
import { OrgService } from "../lib/org.mjs";
import { OrgPropertyService } from "../lib/property-v2.mjs";

let app, dir, url, admin, reviewer, viewer, roomId;
async function request(path, { method = "GET", data, auth = admin, headers = {} } = {}) {
  const h = { Origin: url, ...headers };
  if (auth) {
    h.Cookie = auth.cookie;
    h["X-CSRF-Token"] = auth.csrf;
  }
  if (data !== undefined) h["Content-Type"] = "application/json";
  if (method === "POST" && !h["Idempotency-Key"]) h["Idempotency-Key"] = randomUUID();
  const response = await fetch(`${url}/api/v2/${path}`, {
    method, headers: h, body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, data: await response.json() };
}
const post = (path, data, options = {}) => request(path, { method: "POST", data, ...options });
async function login(username = null, password = null) {
  const response = await fetch(`${url}/api/${username ? "login" : "demo-login"}`, {
    method: "POST", headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify(username ? { username, password } : {}),
  });
  return {
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    csrf: (await response.json()).csrf,
  };
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-occupancy-http-"));
  app = await createApp({ directory: dir, fileValidator: async () => true });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${app.server.address().port}`;
  admin = await login();
  const orgs = new OrgService(app.store);
  for (const [username, role, permissions] of [
    ["occupancy-reviewer", "admin", [
      "identity.review", "blacklist.review", "blacklist.manage", "blacklist.read",
    ]],
    ["occupancy-viewer", "viewer", []],
  ]) {
    await app.accounts.save({
      username, name: username, role, password: "test-only-password-123", enabled: true,
    });
    await orgs.grantMembership({
      orgId: "org-demo", principalType: "adminAccount",
      principalId: app.accounts.rows.find((a) => a.username === username)._id,
      role, permissions,
    }, { actor: "test", actorId: "demo-admin", action: "入住 HTTP 测试授权" });
  }
  reviewer = await login("occupancy-reviewer", "test-only-password-123");
  viewer = await login("occupancy-viewer", "test-only-password-123");
  const membership = (await app.store.list("org_memberships"))
    .find((m) => m.orgId === "org-demo" && m.principalId === "demo-admin");
  const property = new OrgPropertyService(app.store, "org-demo", { membershipId: membership._id });
  const { buildingId } = await property.createProperty({
    mode: "new", communityName: "HTTP 入住小区", buildingName: "1栋",
  }, { actor: "test", actorId: "demo-admin", action: "HTTP 测试物业" });
  const floor = await property.createCatalog({
    kind: "floor", name: "1层", level: 1, parentId: buildingId,
  }, { actor: "test", actorId: "demo-admin", action: "HTTP 测试物业" });
  const rooms = await property.createRooms({
    floorId: floor._id, numbers: ["101"],
  }, { actor: "test", actorId: "demo-admin", action: "HTTP 测试物业" });
  roomId = rooms.ids[0];
});
after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});
async function approvedPerson(name, documentNumber) {
  const person = await post("persons", { name });
  assert.equal(person.status, 201);
  const personId = person.data.data.personId;
  const created = await post("identity-applications", { personId, documentType: "id-card" });
  const applicationId = created.data.data.applicationId;
  const draft = await request(`identity-applications/${applicationId}`);
  const submitted = await post(`identity-applications/${applicationId}/submit`, {
    expectedRevision: draft.data.data.revision,
    document: { name, documentNumber }, fileIds: ["file-http-identity"],
  });
  assert.equal(submitted.status, 200);
  const current = await request(`identity-applications/${applicationId}`, { auth: reviewer });
  const reviewed = await post(`identity-applications/${applicationId}/review`, {
    decision: "approve", reason: "HTTP 测试通过", expectedRevision: current.data.data.revision,
    documentVersion: 1,
  }, { auth: reviewer });
  assert.equal(reviewed.status, 200);
  return { personId, applicationId };
}

test("DB-05 HTTP flow: idempotent cycle, identity-gated activation, member, list and whole-cycle end", async () => {
  const primary = await approvedPerson("HTTP 主租客", "110101199001013011");
  const member = await approvedPerson("HTTP 成员", "110101199001013012");
  const now = Date.now();
  const body = { primaryPersonId: primary.personId, startsAt: now - 1000, endsAt: null };
  const key = randomUUID();
  const cycle = await post(`rooms/${roomId}/occupancy-cycles`, body, {
    headers: { "Idempotency-Key": key },
  });
  assert.equal(cycle.status, 201);
  assert.equal(cycle.data.data.storedState, "pending_review");
  const replay = await post(`rooms/${roomId}/occupancy-cycles`, body, {
    headers: { "Idempotency-Key": key },
  });
  assert.equal(replay.status, 201);
  assert.equal(replay.data.data.cycleId, cycle.data.data.cycleId);
  assert.equal((await app.store.list("occupancy_cycles")).length, 1);
  const activated = await post(`occupancies/${cycle.data.data.occupancyId}/activate`, {
    expectedRevision: 1, identityApplicationId: primary.applicationId,
  });
  assert.equal(activated.status, 200);
  assert.equal(activated.data.data.effectiveState, "active");
  const invited = await post("occupancies", {
    roomId, cycleId: cycle.data.data.cycleId, personId: member.personId,
    role: "member", startsAt: now - 1000, endsAt: null,
  });
  assert.equal(invited.status, 201);
  assert.equal(invited.data.data.storedState, "invited");
  const memberActive = await post(`occupancies/${invited.data.data.occupancyId}/activate`, {
    expectedRevision: 1, identityApplicationId: member.applicationId,
  });
  assert.equal(memberActive.status, 200);
  const listed = await request(`rooms/${roomId}/occupancies`);
  assert.equal(listed.status, 200);
  assert.equal(listed.data.data.length, 2);
  assert.ok(listed.data.data.every((o) => o.effectiveState === "active"));
  assert.ok(listed.data.data.every((o) => o.storedState && o.cycleId && "effectiveEndsAt" in o));
  assert.equal((await request(`rooms/${roomId}/occupancies`, { auth: viewer })).status, 403);
  assert.equal((await request(`rooms/${roomId}/occupancies?limit=0`)).status, 400);
  assert.equal((await request(`rooms/${roomId}/occupancies?cursor=missing`)).status, 400);
  const ended = await post(`occupancies/${cycle.data.data.occupancyId}/end`, {
    expectedRevision: 2, reason: "HTTP 整户退租", endsAt: Date.now(),
  });
  assert.equal(ended.status, 200);
  assert.ok(ended.data.data.materializationJobId);
  const afterEnd = await request(`rooms/${roomId}/occupancies`);
  assert.ok(afterEnd.data.data.every((o) => o.effectiveState === "ended"));
  assert.equal(afterEnd.data.data.find((o) => o.role === "member").storedState, "active");
  const job = await request(`occupancy-materializations/${ended.data.data.materializationJobId}`);
  assert.equal(job.status, 200);
  assert.equal(job.data.data.state, "pending");
});

test("DB-05 HTTP create review returns an opaque retry reference and keeps list reasons private", async () => {
  const primary = await approvedPerson("HTTP 创建复核主租客", "110101199001013013");
  const entry = await post("blacklist", {
    subjectType: "person", personId: primary.personId, reason: "HTTP 创建复核敏感理由",
    evidenceFileIds: [], restrictions: ["occupancy.create"],
    startsAt: Date.now() - 1000, endsAt: null,
  }, { auth: reviewer });
  assert.equal(entry.status, 201);
  const body = {
    primaryPersonId: primary.personId, startsAt: Date.now() - 1000, endsAt: null,
  };
  const blocked = await post(`rooms/${roomId}/occupancy-cycles`, body);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error.code, "BLACKLIST_REVIEW_REQUIRED");
  assert.equal(blocked.data.error.restriction, "occupancy.create");
  assert.ok(blocked.data.error.occupancyId);
  assert.ok(!("reason" in blocked.data.error) && !("evidenceFileIds" in blocked.data.error));
  const applicationRef = blocked.data.error.occupancyId;
  const pending = (await app.store.list("occupancy_applications", "org-demo"))
    .find((application) => application._id === applicationRef);
  assert.equal(pending.state, "pending_review");
  assert.equal(pending.roomId, roomId);
  assert.equal(pending.personId, primary.personId);
  const reviewed = await post(`occupancies/${applicationRef}/blacklist-review`, {
    restriction: "occupancy.create", decision: "allow", reason: "HTTP 允许本次创建",
    entryIds: [entry.data.data.entryId], entryRevisions: [1],
  }, { auth: reviewer });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.data.data.restriction, "occupancy.create");
  assert.equal(reviewed.data.data.requestVersion, 1);
  const tampered = await post(`rooms/${roomId}/occupancy-cycles`, {
    ...body, endsAt: Date.now() + 86400000, occupancyId: applicationRef,
  });
  assert.equal(tampered.status, 409);
  assert.equal(tampered.data.error.code, "OCCUPANCY_APPLICATION_CONFLICT");
  const created = await post(`rooms/${roomId}/occupancy-cycles`, {
    ...body, occupancyId: applicationRef,
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.data.occupancyId, applicationRef);
  assert.equal((await app.store.list("occupancy_applications", "org-demo"))
    .find((application) => application._id === applicationRef).state, "consumed");
  const activated = await post(`occupancies/${applicationRef}/activate`, {
    expectedRevision: 1, identityApplicationId: primary.applicationId,
  });
  assert.equal(activated.status, 200);
  assert.equal(activated.data.data.effectiveState, "active");
});
