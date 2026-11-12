import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server.mjs";
import { OrgService } from "../lib/org.mjs";

let app, dir, url, admin, manager, reviewer;
async function request(path, { method = "GET", data, auth = admin, headers = {} } = {}) {
  const h = { Origin: url, ...headers };
  if (auth) {
    h.Cookie = auth.cookie;
    h["X-CSRF-Token"] = auth.csrf;
  }
  if (data !== undefined) h["Content-Type"] = "application/json";
  if (method === "POST" && !h["Idempotency-Key"]) h["Idempotency-Key"] = randomUUID();
  const response = await fetch(`${url}/api/v2/${path}`, {
    method,
    headers: h,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, data: await response.json() };
}
const post = (path, data, options = {}) => request(path, { method: "POST", data, ...options });
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-blacklist-http-"));
  app = await createApp({ directory: dir, fileValidator: async () => true });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${app.server.address().port}`;
  const login = async (body) => {
    const response = await fetch(`${url}/api/${body.username ? "login" : "demo-login"}`, {
      method: "POST",
      headers: { Origin: url, "Content-Type": "application/json" },
      body: JSON.stringify(body.username ? body : {}),
    });
    return {
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      csrf: (await response.json()).csrf,
    };
  };
  admin = await login({});
  const orgs = new OrgService(app.store);
  for (const [username, permissions] of [
    ["blacklist-manager", ["blacklist.manage", "blacklist.read"]],
    ["blacklist-reviewer", ["blacklist.review", "blacklist.read"]],
  ]) {
    await app.accounts.save({
      username, name: username, role: "admin", password: "test-only-password-123", enabled: true,
    });
    await orgs.grantMembership({
      orgId: "org-demo",
      principalType: "adminAccount",
      principalId: app.accounts.rows.find((a) => a.username === username)._id,
      role: "admin",
      permissions,
    }, { actor: "test", actorId: "demo-admin", action: "授权黑名单账号" });
  }
  manager = await login({ username: "blacklist-manager", password: "test-only-password-123" });
  reviewer = await login({ username: "blacklist-reviewer", password: "test-only-password-123" });
});
after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});
const payload = (personId, extra = {}) => ({
  subjectType: "person",
  personId,
  reasonCode: "manual-review",
  reason: "HTTP 测试名单",
  evidenceFileIds: ["evidence-http-1"],
  restrictions: ["occupancy.activate"],
  startsAt: 1000,
  endsAt: null,
  ...extra,
});
test("blacklist HTTP flow enforces permission points, idempotency, review and org scope", async () => {
  const person = await post("persons", { name: "黑名单住户" });
  const personId = person.data.data.personId;
  const body = payload(personId);
  assert.equal((await post("blacklist", body)).status, 403); // demo admin has no point
  assert.equal((await post("blacklist", body, { auth: reviewer })).status, 403);
  const key = "blacklist-http-create-key-1";
  const created = await post("blacklist", body, {
    auth: manager, headers: { "Idempotency-Key": key },
  });
  assert.equal(created.status, 201);
  const entryId = created.data.data.entryId;
  const replay = await post("blacklist", body, {
    auth: manager, headers: { "Idempotency-Key": key },
  });
  assert.equal(replay.status, 201);
  assert.equal(replay.data.data.entryId, entryId);
  assert.equal((await app.store.list("blacklist_entries")).length, 1);
  const conflict = await post("blacklist", payload(personId, { reason: "不同请求体" }), {
    auth: manager, headers: { "Idempotency-Key": key },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal((await request("blacklist")).status, 403);
  const listed = await request("blacklist", { auth: reviewer });
  assert.equal(listed.status, 200);
  assert.equal(listed.data.data.length, 1);
  assert.equal(listed.data.data[0].personId, personId);
  assert.ok(!("subjectKey" in listed.data.data[0]));
  assert.ok((await app.store.list("admin_audit")).some((a) => a.action === "读取内部黑名单"));
  assert.equal((await post(`occupancies/occ-http-1/blacklist-review`, {
    decision: "allow", reason: "无权限", entryIds: [entryId], entryRevisions: [1],
  }, { auth: manager })).status, 403);
  const stale = await post(`occupancies/occ-http-1/blacklist-review`, {
    decision: "allow", reason: "旧版本", entryIds: [entryId], entryRevisions: [99],
  }, { auth: reviewer });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error.code, "REVISION_CONFLICT");
  const reviewed = await post(`occupancies/occ-http-1/blacklist-review`, {
    decision: "allow", reason: "HTTP 复核通过", entryIds: [entryId], entryRevisions: [1],
  }, { auth: reviewer });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.data.data.occupancyId, "occ-http-1");
  // The opaque DB-05 reference is reviewed without fabricating an occupancy.
  assert.equal(app.store.data.occupancies, undefined);
  const wrongRevision = await post(`blacklist/${entryId}/revoke`, {
    expectedRevision: 99, reason: "错误版本",
  }, { auth: manager });
  assert.equal(wrongRevision.status, 409);
  const revoked = await post(`blacklist/${entryId}/revoke`, {
    expectedRevision: 1, reason: "HTTP 解除",
  }, { auth: manager });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.data.data.revision, 2);
  assert.equal((await request("blacklist?state=active", { auth: reviewer })).data.data.length, 0);
  assert.equal((await request("blacklist?state=revoked", { auth: reviewer })).data.data.length, 1);
  const forged = await request("blacklist", {
    auth: reviewer, headers: { "X-Org-Id": "org-other" },
  });
  assert.equal(forged.status, 404);
});

test("blacklist HTTP list returns all pages without duplicates", async () => {
  const person = await post("persons", { name: "分页名单住户" });
  const expected = [];
  for (let i = 0; i < 22; i++) {
    const created = await post("blacklist", payload(person.data.data.personId, {
      reason: `分页名单${i}`, evidenceFileIds: [],
    }), { auth: manager });
    assert.equal(created.status, 201);
    expected.push(created.data.data.entryId);
  }
  const first = await request("blacklist?state=active&limit=20", { auth: reviewer });
  assert.equal(first.status, 200);
  assert.equal(first.data.data.length, 20);
  assert.ok(first.data.nextCursor);
  const second = await request(
    `blacklist?state=active&limit=20&cursor=${encodeURIComponent(first.data.nextCursor)}`,
    { auth: reviewer },
  );
  assert.equal(second.status, 200);
  assert.equal(second.data.data.length, 2);
  assert.equal(second.data.nextCursor, undefined);
  const actual = [...first.data.data, ...second.data.data].map((e) => e.entryId);
  assert.equal(new Set(actual).size, 22);
  assert.deepEqual(new Set(actual), new Set(expected));
});
