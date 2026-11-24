import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createApp } from "../server.mjs";
import { LocalStore } from "../lib/store.mjs";
import { LocalCloudDatabase } from "../lib/local-cloud-database.mjs";
const { TenantAccountService } = createRequire(import.meta.url)("../../cloudfunctions/accountLogin/lib/service.js");
const guard = globalThis.__DSH_D_NETWORK_GUARD__;
let baseline;
test.before(() => guard.assertLoadTimeClean());
test.beforeEach(() => { baseline = guard.snapshot(); });
test.afterEach(() => guard.assertNoViolations(baseline, "tenant-admin routes"));

async function harness(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "smartpm-admin-route-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = options.store || await new LocalStore(directory).init();
  const account = { _id: "synthetic-admin", username: "local.test", enabled: true,
    revision: 1, role: options.role || "admin", name: "测试管理员" };
  const accounts = { rows: [account], login: async () => account };
  let handler;
  const origin = "http://127.0.0.1:4173";
  await createApp({ directory, store, accounts, origin, mode: options.mode || "demo",
    serverFactory(fn) { handler = fn; return { on() {}, address() { return { port: 4173 }; } }; } });
  let cookie, csrf;
  async function request(path, { method = "GET", data, authenticated = true, withCsrf = true, withOrigin = true } = {}) {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    Object.assign(req, { url: path, method, socket: { remoteAddress: "127.0.0.1" }, headers: {
      ...(withOrigin ? { origin } : {}), ...(authenticated && cookie ? { cookie } : {}),
      ...(withCsrf && csrf ? { "x-csrf-token": csrf } : {}),
    } });
    const headers = {};
    const result = {};
    const res = { headersSent: false, setHeader(key, value) { headers[key.toLowerCase()] = value; },
      writeHead(status) { this.headersSent = true; result.status = status; },
      end(value) { result.payload = value === undefined ? null : JSON.parse(String(value)); } };
    await handler(req, res);
    result.headers = headers;
    return result;
  }
  async function login() {
    const response = await request("/api/login", { method: "POST", data: { username: "local.test", password: "synthetic-admin-input" } });
    assert.equal(response.status, 200);
    cookie = response.headers["set-cookie"].split(";")[0];
    csrf = response.payload.csrf;
  }
  return { store, accounts, request, login };
}

test("actual admin handler enforces session, origin, CSRF and current administrator", async (t) => {
  const h = await harness(t);
  assert.equal((await h.request("/api/tenant-password-accounts")).status, 401);
  await h.login();
  const before = structuredClone(h.store.data);
  assert.equal((await h.request("/api/tenant-password-accounts/create", { method: "POST", data: {}, withCsrf: false })).status, 403);
  assert.equal((await h.request("/api/tenant-password-accounts/create", { method: "POST", data: {}, withOrigin: false })).status, 403);
  assert.deepEqual(h.store.data, before);
  assert.deepEqual((await h.request("/api/tenant-password-accounts")).payload, { rows: [] });
  const preset = await h.request("/api/test-property-preset");
  assert.equal(preset.payload.preset.rooms.length, 242);
  h.accounts.rows = [{ ...h.accounts.rows[0], revision: 2 }];
  assert.equal((await h.request("/api/tenant-password-accounts")).status, 401);
});

test("actual admin route opens an account for a verified-phone resident through real local atomic service", async (t) => {
  const h = await harness(t);
  await h.login();
  const openid = "synthetic-tenant", appId = "synthetic-app";
  const bindingHash = createHash("sha256").update(`${appId}\0${openid}`).digest("hex");
  const userId = `wxuser_${bindingHash}`;
  const identityId = `wx_${bindingHash}`;
  h.store.data.users = [{ _id: userId, _openid: openid, wechatAppId: appId, role: "user", houses: [],
    points: 0, phone: "13800000000", phoneBoundAt: 1800000000000, name: "验证住户",
    createdAt: 1800000000000, lastLoginAt: 1800000000000 }];
  h.store.data.tenant_auth_identities = [{ _id: identityId, schemaVersion: 1, appId, openid, userId,
    revision: 1, createdAt: 1800000000000, updatedAt: 1800000000000 }];
  const residents = await h.request("/api/tenant-password-accounts/residents");
  assert.equal(residents.status, 200);
  assert.equal(residents.payload.rows.length, 1);
  assert.equal(residents.payload.rows[0].userId, userId);
  assert.equal(residents.payload.rows[0].phone, "13800000000");
  assert.equal(JSON.stringify(residents.payload).includes(openid), false);
  const response = await h.request("/api/tenant-password-accounts/create", { method: "POST", data: {
    userId, username: "tenant.route", password: "synthetic-tenant-input" } });
  assert.equal(response.status, 200);
  assert.equal(response.payload.username, "tenant.route");
  assert.equal(JSON.stringify(response.payload).includes("hashHex"), false);
  const service = new TenantAccountService({ db: new LocalCloudDatabase(h.store) });
  const result = await service.login({ APPID: appId, OPENID: openid }, { username: "tenant.route", password: "synthetic-tenant-input" });
  assert.equal(result.code, 0);
  assert.equal(result.userInfo._id, response.payload.userId);
  assert.equal((await h.request("/api/tenant-password-accounts")).payload.rows.length, 1);
});

test("unverified resident cannot be opened through the route and old codes stay rejected", async (t) => {
  const h = await harness(t);
  await h.login();
  h.store.data.users = [{ _id: "wxuser_nophone", _openid: "openid-nophone", wechatAppId: "synthetic-app",
    role: "user", houses: [], points: 0, createdAt: 1800000000000 }];
  const before = structuredClone(h.store.data);
  const rejected = await h.request("/api/tenant-password-accounts/create", { method: "POST", data: {
    userId: "wxuser_nophone", username: "tenant.none", password: "synthetic-tenant-input" } });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.payload.code, "USER_NOT_VERIFIED");
  assert.deepEqual(h.store.data, before);
  const oldCode = await h.request("/api/tenant-password-accounts/create", { method: "POST", data: {
    requestCode: "ABCDEFGHIJKLMNOP", username: "tenant.old", password: "synthetic-tenant-input" } });
  assert.equal(oldCode.status, 400);
  assert.equal(oldCode.payload.code, "INVALID_INPUT");
  assert.deepEqual(h.store.data, before);
});

test("HEAD requests are rejected on every API path before any write branch", async (t) => {
  const h = await harness(t);
  const beforeLogin = structuredClone(h.store.data);
  assert.equal((await h.request("/api/accounts", { method: "HEAD", authenticated: false, withOrigin: false, withCsrf: false })).status, 405);
  assert.equal((await h.request("/api/tenant-password-accounts", { method: "HEAD", authenticated: false, withOrigin: false, withCsrf: false })).status, 405);
  assert.deepEqual(h.store.data, beforeLogin);
  await h.login();
  const before = structuredClone(h.store.data);
  const injected = await h.request("/api/accounts", { method: "HEAD", withOrigin: false, withCsrf: false, data: {
    username: "head.inject", name: "注入", role: "admin", password: "synthetic-password-123" } });
  assert.equal(injected.status, 405);
  assert.deepEqual(h.store.data, before, "HEAD 携带请求体不得进入保存分支");
  assert.equal((await h.request("/api/accounts")).status, 200, "GET 保持可用");
});

test("ordinary staff cannot manage tenants or view internal rooms", async (t) => {
  const h = await harness(t, { role: "viewer" });
  await h.login();
  const before = structuredClone(h.store.data);
  for (const path of ["/api/tenant-password-accounts", "/api/test-property-preset"]) {
    assert.equal((await h.request(path)).status, 403);
  }
  assert.equal((await h.request("/api/tenant-password-accounts/create", { method: "POST", data: {} })).status, 403);
  assert.deepEqual(h.store.data, before);
});

test("database initialization failures are redacted inside tenant route boundary", async (t) => {
  const store = { app: { database() { throw Object.assign(Error("SYNTHETIC_INTERNAL_SENTINEL"), { status: 503 }); } } };
  const h = await harness(t, { mode: "live", store });
  await h.login();
  const response = await h.request("/api/tenant-password-accounts");
  assert.equal(response.status, 503);
  assert.equal(response.payload.code, "SERVICE_UNAVAILABLE");
  assert.equal(JSON.stringify(response).includes("SYNTHETIC_INTERNAL_SENTINEL"), false);
});
