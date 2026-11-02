import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server.mjs";
import { OrgService } from "../lib/org.mjs";
let app, dir, url, admin, reviewer;
async function request(path, { method = "GET", data, auth = admin, headers = {} } = {}) {
  const h = { Origin: url, ...headers };
  if (auth) {
    h.Cookie = auth.cookie;
    h["X-CSRF-Token"] = auth.csrf;
  }
  if (data !== undefined) h["Content-Type"] = "application/json";
  if (method === "POST") h["Idempotency-Key"] = randomUUID();
  const r = await fetch(`${url}/api/v2/${path}`, {
    method,
    headers: h,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: r.status, data: await r.json() };
}
const post = (path, data, opts = {}) => request(path, { method: "POST", data, ...opts });
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-verify-http-"));
  app = await createApp({ directory: dir, fileValidator: async () => true });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${app.server.address().port}`;
  const login = async (body) => {
    const r = await fetch(`${url}/api/${body.username ? "login" : "demo-login"}`, {
      method: "POST",
      headers: { Origin: url, "Content-Type": "application/json" },
      body: JSON.stringify(body.username ? body : {}),
    });
    return { cookie: r.headers.get("set-cookie")?.split(";")[0], csrf: (await r.json()).csrf };
  };
  admin = await login({});
  await app.accounts.save({
    username: "reviewer1",
    name: "审核员",
    role: "admin",
    password: "test-only-password-123",
    enabled: true,
  });
  reviewer = await login({ username: "reviewer1", password: "test-only-password-123" });
  const orgs = new OrgService(app.store);
  await orgs.grantMembership(
    {
      orgId: "org-demo",
      principalType: "adminAccount",
      principalId: app.accounts.rows.find((a) => a.username === "reviewer1")._id,
      role: "admin",
      permissions: ["identity.review", "identity.readPrivate"],
    },
    { actor: "test", actorId: "demo-admin", action: "授权审核员" },
  );
});
after(async () => {
  await new Promise((r) => app.server.close(r));
  await rm(dir, { recursive: true, force: true });
});
test("identity application HTTP flow with explicit permission points", async () => {
  const person = await post("persons", { name: "张住户" });
  const personId = person.data.data.personId;
  const created = await post("identity-applications", { personId, documentType: "id-card" });
  assert.equal(created.status, 201);
  const id = created.data.data.applicationId;
  const draft = await request(`identity-applications/${id}`);
  assert.equal(draft.data.data.state, "draft");
  const submitted = await post(`identity-applications/${id}/submit`, {
    expectedRevision: draft.data.data.revision,
    document: { name: "测试住户", documentNumber: "110101199001011234" },
    fileIds: ["file-http-1"],
  });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.data.state, "submitted");
  // org admin WITHOUT identity.review cannot review or list the queue.
  const adminReview = await post(`identity-applications/${id}/review`, {
    decision: "approve", reason: "越权", expectedRevision: submitted.data.data.documentVersion ? draft.data.data.revision + 1 : 1, documentVersion: 1,
  });
  assert.equal(adminReview.status, 403);
  const adminQueue = await request("identity-applications?state=submitted");
  assert.equal(adminQueue.status, 403);
  const reviewed = await post(`identity-applications/${id}/review`, {
    decision: "approve", reason: "通过", expectedRevision: draft.data.data.revision + 1, documentVersion: 1,
  }, { auth: reviewer });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.data.data.state, "approved");
  // Repeat review is an invalid state.
  const again = await post(`identity-applications/${id}/review`, {
    decision: "reject", reason: "重复", expectedRevision: draft.data.data.revision + 2, documentVersion: 1,
  }, { auth: reviewer });
  assert.equal(again.status, 409);
  assert.equal(again.data.error.code, "INVALID_STATE");
  // Masked read for anyone; private read only with identity.readPrivate.
  const masked = await request(`identity-applications/${id}`);
  assert.ok(!("identityDigest" in masked.data.data));
  const adminPrivate = await request(`identity-applications/${id}/private`);
  assert.equal(adminPrivate.status, 403);
  const secret = await request(`identity-applications/${id}/private`, { auth: reviewer });
  assert.equal(secret.status, 200);
  assert.equal(secret.data.data.documentNumber, "110101199001011234");
  const queue = await request("identity-applications?state=approved", { auth: reviewer });
  assert.equal(queue.status, 200);
  assert.equal(queue.data.data.length, 1);
  const disabled = await post(`identity-applications/${id}/provider-start`, {});
  assert.equal(disabled.status, 503);
  assert.equal(disabled.data.error.code, "PROVIDER_DISABLED");
  const forged = await request("identity-applications", { headers: { "X-Org-Id": "org-other" } });
  assert.equal(forged.status, 404);
});
test("reviewers cannot approve their own submission over HTTP", async () => {
  const person = await post("persons", { name: "李住户" });
  const created = await post("identity-applications", {
    personId: person.data.data.personId, documentType: "id-card",
  }, { auth: reviewer });
  const id = created.data.data.applicationId;
  const draft = await request(`identity-applications/${id}`, { auth: reviewer });
  await post(`identity-applications/${id}/submit`, {
    expectedRevision: draft.data.data.revision,
    document: { name: "审核员甲", documentNumber: "110101199001019999" },
    fileIds: ["file-http-2"],
  }, { auth: reviewer });
  const selfReview = await post(`identity-applications/${id}/review`, {
    decision: "approve", reason: "自审", expectedRevision: draft.data.data.revision + 1, documentVersion: 1,
  }, { auth: reviewer });
  assert.equal(selfReview.status, 403);
  assert.match(selfReview.data.error.message, /提交人/);
});
