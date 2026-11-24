import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { AdminTenantPasswordAccounts } from "../lib/tenant-password-accounts.mjs";
import { accountView, createTenantPasswordAccountsPage } from "../public/tenant-password-accounts.js";

const require = createRequire(import.meta.url);
const { TenantAccountService } = require("../../cloudfunctions/accountLogin/lib/service.js");
const { MemoryDB } = require("../../tests/support/tenant-auth-memory-db.cjs");
const NOW = 1_800_000_000_000;
const ADMIN = { id: "synthetic-admin", name: "合成管理员", role: "admin" };
const PASSWORD = "  Synthetic-password-01  ";
const PUBLIC_KEYS = ["id", "username", "userId", "status", "revision", "credentialVersion", "createdAt", "updatedAt"].sort();

async function fixture() {
  const db = new MemoryDB();
  const now = () => NOW;
  const tenant = new TenantAccountService({ db, now });
  const service = new AdminTenantPasswordAccounts({ database: db, now });
  const identity = { APPID: "synthetic-app", OPENID: "synthetic-wx-user", UNIONID: "synthetic-union" };
  const prepared = await tenant.prepare(identity, {});
  assert.equal(prepared.code, 0);
  assert.equal(typeof prepared.requestCode, "string");
  return { db, tenant, service, identity, requestCode: prepared.requestCode };
}

test("后台薄服务只用本人开通码，返回闭式DTO，不能把管理员账号变成租客凭据", async () => {
  const ctx = await fixture();
  const created = await ctx.service.createAccount(ADMIN, { requestCode: ctx.requestCode, username: "Tenant.One", password: PASSWORD });
  assert.deepEqual(Object.keys(created).sort(), PUBLIC_KEYS);
  assert.equal(created.username, "tenant.one");
  assert.equal(created.status, "active");
  assert.equal(created.revision, 1);
  assert.equal(created.credentialVersion, 1);
  const login = await ctx.tenant.login(ctx.identity, { username: created.username, password: PASSWORD });
  assert.equal(login.code, 0, "后台提交的密码原文必须可通过实际密码服务验证");
  assert.equal(login.userInfo._id, created.userId);
  const listed = await ctx.service.listAccounts(ADMIN);
  assert.deepEqual(listed, [created]);
  assert.ok(!JSON.stringify(listed).includes(PASSWORD));
  assert.ok(!JSON.stringify(listed).includes(ctx.identity.OPENID));
  const before = ctx.db.snapshot();
  await assert.rejects(async () => ctx.service.createAccount(ADMIN, {
    requestCode: ctx.requestCode, username: "another.user", password: PASSWORD,
    userId: "another-user", openid: "another-wechat", role: "admin",
  }));
  assert.deepEqual(ctx.db.snapshot(), before, "客户端指定身份/权限或复用码均不得留下写入");
});

test("开通/列表/重置/停用均在服务层拒绝非管理员，逐次全库零变化", async () => {
  const ctx = await fixture();
  const created = await ctx.service.createAccount(ADMIN, { requestCode: ctx.requestCode, username: "tenant.two", password: PASSWORD });
  const viewer = { id: "synthetic-viewer", name: "只读管理员", role: "viewer" };
  for (const action of [
    () => ctx.service.listAccounts(viewer),
    () => ctx.service.createAccount(viewer, { requestCode: ctx.requestCode, username: "bad.user", password: PASSWORD }),
    () => ctx.service.resetPassword(viewer, { accountId: created.id, newPassword: "Synthetic-new-password-02", expectedRevision: created.revision }),
    () => ctx.service.setStatus(viewer, { accountId: created.id, status: "disabled", expectedRevision: created.revision }),
  ]) {
    const before = ctx.db.snapshot();
    await assert.rejects(async () => action(), (error) => error.code === "ADMIN_REQUIRED" && error.status === 403);
    assert.deepEqual(ctx.db.snapshot(), before);
  }
});

test("重置与停用保留身份绑定，推进版本；陈旧管理员修改CAS拒绝", async () => {
  const ctx = await fixture();
  const created = await ctx.service.createAccount(ADMIN, { requestCode: ctx.requestCode, username: "tenant.three", password: PASSWORD });
  const reset = await ctx.service.resetPassword(ADMIN, { accountId: created.id, newPassword: "Synthetic-new-password-02", expectedRevision: created.revision });
  assert.equal(reset.id, created.id);
  assert.equal(reset.userId, created.userId);
  assert.equal(reset.username, created.username);
  assert.equal(reset.status, created.status);
  assert.equal(reset.revision, created.revision + 1);
  assert.equal(reset.credentialVersion, created.credentialVersion + 1);
  const before = ctx.db.snapshot();
  await assert.rejects(async () => ctx.service.setStatus(ADMIN, { accountId: reset.id, status: "disabled", expectedRevision: created.revision }),
    (error) => error.code === "REVISION_CONFLICT" && error.status === 409);
  assert.deepEqual(ctx.db.snapshot(), before);
  const disabled = await ctx.service.setStatus(ADMIN, { accountId: reset.id, status: "disabled", expectedRevision: reset.revision });
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.userId, created.userId);
  assert.equal(disabled.username, created.username);
  assert.equal(disabled.revision, reset.revision + 1);
  assert.deepEqual(Object.keys(disabled).sort(), PUBLIC_KEYS);
});

test("配置没有真实事务时管理员写入失败关闭，不能回退串行非原子写", async () => {
  const db = new MemoryDB();
  db.runTransaction = undefined;
  const service = new AdminTenantPasswordAccounts({ database: db, now: () => NOW });
  const before = db.snapshot();
  await assert.rejects(async () => service.createAccount(ADMIN, { requestCode: "A".repeat(16), username: "tenant.none", password: PASSWORD }),
    (error) => error.code === "SERVICE_UNAVAILABLE" && error.status === 503);
  assert.deepEqual(db.snapshot(), before);
});

test("账号公共展示投影不保留身份、密码和其他服务端额外字段", () => {
  const row = accountView({ id: "synthetic-account", username: "tenant.safe", status: "active", revision: 3, updatedAt: NOW,
    userId: "private-user", openid: "private-openid", password: PASSWORD, hashHex: "private-hash", saltHex: "private-salt" });
  assert.deepEqual(Object.keys(row).sort(), ["id", "username", "status", "revision", "updatedAt"].sort());
  assert.ok(!JSON.stringify(row).includes("private"));
  assert.throws(() => accountView({ id: "account", username: "<script>", status: "active", revision: 1 }));
  assert.throws(() => accountView({ id: "account", username: "tenant.safe", status: "active", revision: 0 }));
});

class Element {
  constructor(id = "") { this.id = id; this.value = ""; this.hidden = true; this.disabled = false; this.textContent = ""; this.children = []; this.listeners = new Map(); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  emit(type) { return this.listeners.get(type)?.({ preventDefault() {} }); }
}
function documentFixture() {
  const ids = ["account-message", "create-password", "reset-password", "account-content", "account-login", "login-message",
    "account-rows", "accounts-empty", "reset-account", "status-account", "create-account-form", "enrollment-code",
    "create-username", "reset-password-form", "account-status-form", "password-status", "reload-accounts"];
  const nodes = new Map(ids.map((id) => [id, new Element(id)]));
  return {
    getElementById(id) { const node = nodes.get(id); assert.ok(node, `actual page requested unknown element ${id}`); return node; },
    querySelectorAll() { return [...nodes.values()]; },
    createElement() { return new Element(); },
    createDocumentFragment() { return new Element(); },
  };
}
const uiAccount = (overrides = {}) => ({ id: "synthetic-account", username: "tenant.safe", userId: "synthetic-user", status: "active",
  revision: 1, credentialVersion: 1, createdAt: NOW, updatedAt: NOW, ...overrides });
const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });

test("实际页面提交：密码及开户码在等待响应前清空，原文密码仅送同源CSRF请求且不重试", async () => {
  const doc = documentFixture(), calls = [];
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const page = createTenantPasswordAccountsPage({ document: doc, fetch: async (path, init) => {
    calls.push({ path, ...init });
    if (path === "/api/me") return response({ account: { role: "admin" }, csrf: "synthetic-csrf" });
    if (path === "/api/tenant-password-accounts") return response({ rows: [] });
    assert.equal(path, "/api/tenant-password-accounts/create");
    await pending;
    return response(uiAccount());
  } });
  await page.start();
  doc.getElementById("enrollment-code").value = "synthetic-request-code";
  doc.getElementById("create-username").value = "Tenant.Safe";
  doc.getElementById("create-password").value = PASSWORD;
  const submitting = doc.getElementById("create-account-form").emit("submit");
  assert.equal(doc.getElementById("create-password").value, "");
  assert.equal(doc.getElementById("enrollment-code").value, "");
  const call = calls.find((item) => item.method === "POST");
  assert.deepEqual(JSON.parse(call.body), { requestCode: "synthetic-request-code", username: "Tenant.Safe", password: PASSWORD });
  assert.equal(call.credentials, "same-origin");
  assert.equal(call.headers["X-CSRF-Token"], "synthetic-csrf");
  release();
  await submitting;
  assert.equal(calls.filter((item) => item.method === "POST").length, 1);
  assert.ok(!doc.getElementById("account-message").textContent.includes(PASSWORD));
});

test("页面重置/停用使用当前列表revision，不发送任意userId或微信标识", async () => {
  const doc = documentFixture(), calls = [];
  let current = uiAccount();
  const page = createTenantPasswordAccountsPage({ document: doc, fetch: async (path, init) => {
    calls.push({ path, ...init });
    if (path === "/api/me") return response({ account: { role: "admin" }, csrf: "synthetic-csrf" });
    if (path === "/api/tenant-password-accounts") return response({ rows: [current] });
    const data = JSON.parse(init.body);
    assert.equal(data.accountId, current.id);
    assert.equal(data.expectedRevision, current.revision);
    if (path.endsWith("/reset")) assert.deepEqual(Object.keys(data).sort(), ["accountId", "newPassword", "expectedRevision"].sort());
    else assert.deepEqual(Object.keys(data).sort(), ["accountId", "status", "expectedRevision"].sort());
    current = { ...current, revision: current.revision + 1, ...(data.status ? { status: data.status } : {}) };
    return response(current);
  } });
  await page.start();
  doc.getElementById("reset-account").value = current.id;
  doc.getElementById("reset-password").value = PASSWORD;
  const resetting = doc.getElementById("reset-password-form").emit("submit");
  assert.equal(doc.getElementById("reset-password").value, "");
  await resetting;
  doc.getElementById("status-account").value = current.id;
  doc.getElementById("password-status").value = "disabled";
  await doc.getElementById("account-status-form").emit("submit");
  assert.equal(current.status, "disabled");
  assert.equal(current.revision, 3);
  assert.equal(calls.filter((call) => call.method === "POST").length, 2);
  assert.match(doc.getElementById("account-message").textContent, /微信／手机号登录及房产权限未改变/);
});

test("非管理员或无CSRF页面不开通操作；未知网络错误不泄露响应内容或自动重发", async () => {
  for (const me of [{ account: { role: "viewer" }, csrf: "synthetic-csrf" }, { account: { role: "admin" } }]) {
    const forbiddenDoc = documentFixture(), forbiddenCalls = [];
    const forbidden = createTenantPasswordAccountsPage({ document: forbiddenDoc, fetch: async (path) => {
      forbiddenCalls.push(path); return response(me);
    } });
    await forbidden.start();
    assert.deepEqual(forbiddenCalls, ["/api/me"]);
    assert.equal(forbiddenDoc.getElementById("account-content").hidden, true);
    forbiddenDoc.getElementById("create-username").value = "tenant.blocked";
    forbiddenDoc.getElementById("enrollment-code").value = "synthetic-code";
    forbiddenDoc.getElementById("create-password").value = PASSWORD;
    await forbiddenDoc.getElementById("create-account-form").emit("submit");
    assert.deepEqual(forbiddenCalls, ["/api/me"], "手工触发被隐藏表单也不能发出开户请求");
  }
  const doc = documentFixture(), calls = [];
  const page = createTenantPasswordAccountsPage({ document: doc, fetch: async (path, init) => {
    calls.push({ path, ...init });
    if (path === "/api/me") return response({ account: { role: "admin" }, csrf: "synthetic-csrf" });
    if (path === "/api/tenant-password-accounts") return response({ rows: [] });
    throw new Error(PASSWORD + " private-openid");
  } });
  await page.start();
  doc.getElementById("create-password").value = PASSWORD;
  doc.getElementById("enrollment-code").value = "synthetic-request-code";
  doc.getElementById("create-username").value = "tenant.safe";
  await doc.getElementById("create-account-form").emit("submit");
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.ok(!doc.getElementById("account-message").textContent.includes(PASSWORD));
  assert.ok(!doc.getElementById("account-message").textContent.includes("private-openid"));
  assert.equal(doc.getElementById("create-password").value, "");
});

test("列表容量/损坏记录失败关闭显示维护提示，不展示服务端原始错误或假装列表完整", async () => {
  for (const code of ["ACCOUNT_LIST_LIMIT", "ACCOUNT_DATA_UNVERIFIED"]) {
    const doc = documentFixture(), calls = [];
    const page = createTenantPasswordAccountsPage({ document: doc, fetch: async (path, init) => {
      calls.push({ path, ...init });
      if (path === "/api/me") return response({ account: { role: "admin" }, csrf: "synthetic-csrf" });
      return response({ code, error: "synthetic-private-hash-and-openid", rows: [uiAccount()] }, 503);
    } });
    await page.start();
    assert.equal(doc.getElementById("account-content").hidden, true, "不能把错误响应里的部分列表当成完整成功");
    assert.match(doc.getElementById("login-message").textContent, /维护/);
    assert.ok(!doc.getElementById("login-message").textContent.includes("synthetic-private"));
    assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  }
});


test("后台开户/重置表单统一八位最低，七位不请求、八位及旧十二位均可提交", async () => {
  const html = readFileSync(new URL('../public/tenant-password-accounts.html', import.meta.url), 'utf8');
  for (const id of ['create-password', 'reset-password']) {
    assert.match(html, new RegExp('<input[^>]+id="' + id + '"[^>]+minlength="8"[^>]+maxlength="128"'));
  }
  assert.ok(!html.includes('12–128'));
  for (const form of ['create', 'reset']) {
    for (const length of [7, 8, 12]) {
      const doc = documentFixture();
      const posts = [];
      const page = createTenantPasswordAccountsPage({ document: doc, fetch: async (path, init) => {
        if (path === '/api/me') return response({ account: { role: 'admin' }, csrf: 'synthetic-csrf' });
        if (path === '/api/tenant-password-accounts') return response({ rows: [uiAccount()] });
        posts.push({ path, payload: JSON.parse(init.body) });
        return response(uiAccount());
      } });
      await page.start();
      const synthetic = 's'.repeat(length);
      if (form === 'create') {
        doc.getElementById('enrollment-code').value = 'synthetic-code';
        doc.getElementById('create-username').value = 'tenant.safe';
        doc.getElementById('create-password').value = synthetic;
        await doc.getElementById('create-account-form').emit('submit');
        assert.equal(doc.getElementById('create-password').value, '');
      } else {
        doc.getElementById('reset-account').value = uiAccount().id;
        doc.getElementById('reset-password').value = synthetic;
        await doc.getElementById('reset-password-form').emit('submit');
        assert.equal(doc.getElementById('reset-password').value, '');
      }
      assert.equal(posts.length, length < 8 ? 0 : 1);
      if (length < 8) assert.match(doc.getElementById('account-message').textContent, /8–128/);
      else {
        assert.equal(posts[0].path, '/api/tenant-password-accounts/' + form);
        assert.equal(posts[0].payload[form === 'create' ? 'password' : 'newPassword'], synthetic);
      }
    }
  }
});
