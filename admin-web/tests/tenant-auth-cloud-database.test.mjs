import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { TenantAuthCloudDatabase } from "../lib/tenant-auth-cloud-database.mjs";
import { AdminTenantPasswordAccounts } from "../lib/tenant-password-accounts.mjs";
import { createApp } from "../server.mjs";

const require = createRequire(import.meta.url);
const { TenantAuthMemoryDB } = require("../../tests/support/tenant-auth-memory-db.cjs");
const { createMain: phoneMain } = require("../../cloudfunctions/phoneLogin");
const { createMain: passwordMain } = require("../../cloudfunctions/accountLogin");
const guard = globalThis.__DSH_D_NETWORK_GUARD__;
let baseline;
test.before(() => guard.assertLoadTimeClean());
test.beforeEach(() => { baseline = guard.snapshot(); });
test.afterEach(() => guard.assertNoViolations(baseline, "tenant management SDK adapter"));
const CONTEXT = { APPID: "synthetic-management-app", OPENID: "synthetic-management-resident" };
const ACTOR = { id: "synthetic-management-admin", role: "admin" };
const NOW = Date.now() - 1000;
const PASSWORD = "synthetic-management-password";
const NEW_PASSWORD = "synthetic-replacement-password";

// Strict management-SDK-shaped boundary, backed only by the existing synthetic
// MVCC transaction oracle. Base get is data:[row], transaction get is data:row;
// SDK set accepts bare records and rejects wx envelopes or writable _id.
class StrictManagementDatabase {
  constructor() {
    this.memory = new TenantAuthMemoryDB();
    this.setCalls = [];
    this.queryCalls = [];
    this.setResult = null;
    this.getResult = null;
  }

  context(source, transaction) {
    const database = this;
    function query(ref, name) {
      return {
        where(filter) { database.queryCalls.push({ method: "where", filter }); return query(ref.where(filter), name); },
        orderBy(field, direction) { database.queryCalls.push({ method: "orderBy", field, direction }); return query(ref.orderBy(field, direction), name); },
        skip(offset) { database.queryCalls.push({ method: "skip", offset }); return query(ref.skip(offset), name); },
        limit(count) { database.queryCalls.push({ method: "limit", count }); return query(ref.limit(count), name); },
        async get() {
          if (database.getResult) return database.getResult({ name, transaction, query: true });
          return ref.get();
        },
      };
    }
    return {
      collection(name) {
        const collection = source.collection(name);
        return {
          ...(!transaction ? query(collection, name) : {}),
          doc(id) {
            const ref = collection.doc(id);
            return {
              async get() {
                if (database.getResult) return database.getResult({ name, id, transaction, query: false });
                let row;
                try { row = (await ref.get()).data; }
                catch (error) { if (error.code !== "DOCUMENT_NOT_EXISTS") throw error; row = null; }
                return { data: transaction ? row : row ? [row] : [] };
              },
              async set(data) {
                assert.ok(data && typeof data === "object" && !Array.isArray(data));
                assert.equal(Object.hasOwn(data, "data"), false, "raw management SDK rejects wx data envelope");
                assert.equal(Object.hasOwn(data, "_id"), false, "raw management SDK rejects writable _id");
                database.setCalls.push({ name, id, transaction, data: structuredClone(data) });
                const outcome = database.setResult?.({ name, id, transaction });
                if (outcome !== undefined) return outcome;
                await ref.set({ data: { ...data, _id: id } });
                return { updated: 1, requestId: "synthetic-request" };
              },
            };
          },
        };
      },
    };
  }

  collection(name) { return this.context(this.memory, false).collection(name); }
  runTransaction(work) { return this.memory.runTransaction((tx) => work(this.context(tx, true))); }
  snapshot() { return structuredClone(this.memory.snapshot()); }
}

function fixture() {
  const raw = new StrictManagementDatabase();
  const db = new TenantAuthCloudDatabase(raw);
  const cloud = { getWXContext: () => CONTEXT, openapi: { phonenumber: {
    getPhoneNumber: async () => ({ phoneInfo: { purePhoneNumber: "13800000001" } }),
  } } };
  const now = () => NOW;
  return { raw, db, cloud, now, admin: new AdminTenantPasswordAccounts({ database: db, now }),
    phone: phoneMain({ db, cloud, now }), password: passwordMain({ db, cloud, now }) };
}

async function registered(h) {
  const result = await h.phone({ code: "synthetic-phone-authorization" });
  assert.equal(result.code, 0);
  return result.userInfo._id;
}

test("adapter maps wx set to bare SDK data, preserves point ids and query pagination", async () => {
  const raw = new StrictManagementDatabase();
  const db = new TenantAuthCloudDatabase(raw);
  const record = { _id: "synthetic-user", role: "user", houses: ["synthetic-house"] };
  await db.collection("users").doc(record._id).set({ data: record });
  assert.deepEqual(record, { _id: "synthetic-user", role: "user", houses: ["synthetic-house"] });
  assert.deepEqual(raw.setCalls[0].data, { role: "user", houses: ["synthetic-house"] });
  assert.deepEqual((await db.collection("users").doc(record._id).get()).data, [record]);
  assert.deepEqual((await db.collection("users").doc("missing").get()).data, []);
  const page = await db.collection("users").where({ role: "user" }).orderBy("_id", "asc").skip(0).limit(1).get();
  assert.deepEqual(page.data, [record]);
  assert.deepEqual(raw.queryCalls, [{ method: "where", filter: { role: "user" } },
    { method: "orderBy", field: "_id", direction: "asc" }, { method: "skip", offset: 0 }, { method: "limit", count: 1 }]);
  await db.runTransaction(async (tx) => {
    assert.equal(tx.collection("users").where, undefined, "service transactions expose only point reads/writes");
    assert.deepEqual((await tx.collection("users").doc(record._id).get()).data, record);
    assert.equal((await tx.collection("users").doc("missing").get()).data, null);
  });
  const before = raw.snapshot();
  await assert.rejects(() => db.collection("users").doc(record._id).set({ data: { ...record, _id: "other" } }),
    (error) => error.code === "SERVICE_UNAVAILABLE");
  assert.deepEqual(raw.snapshot(), before);
});

test("returned SDK error codes and malformed operation results fail closed", async () => {
  for (const response of [{ code: "SYNTHETIC_SDK_ERROR" }, { errCode: -1 }, null]) {
    const raw = new StrictManagementDatabase();
    const db = new TenantAuthCloudDatabase(raw);
    raw.setResult = () => response;
    const before = raw.snapshot();
    await assert.rejects(() => db.collection("users").doc("synthetic").set({ data: { _id: "synthetic", role: "user" } }));
    assert.deepEqual(raw.snapshot(), before);
  }
  for (const response of [{ code: "SYNTHETIC_SDK_ERROR", data: [] }, { errCode: -1, data: null }, null]) {
    const raw = new StrictManagementDatabase();
    const db = new TenantAuthCloudDatabase(raw);
    raw.getResult = () => response;
    await assert.rejects(() => db.collection("users").doc("synthetic").get());
    await assert.rejects(() => db.collection("users").limit(1).get());
  }
});

test("public phone proof registration and admin create/reset/status/list share the original password user", async () => {
  const h = fixture();
  const userId = await registered(h);
  const profile = h.raw.memory.row("users", userId);
  // Ordinary trusted profile data is separate from phone authentication facts.
  h.raw.memory._write("users", userId, { ...profile, houses: ["synthetic-admin-house"] });
  assert.deepEqual((await h.admin.listVerifiedUsers(ACTOR)).map((row) => row.userId), [userId]);
  let account = await h.admin.createAccount(ACTOR, { userId, username: "tenant.management", password: PASSWORD });
  assert.equal((await h.password({ action: "login", username: account.username, password: PASSWORD })).userInfo._id, userId);
  account = await h.admin.resetPassword(ACTOR, { accountId: account.id, newPassword: NEW_PASSWORD, expectedRevision: account.revision });
  assert.equal((await h.password({ action: "login", username: account.username, password: PASSWORD })).code, "AUTH_FAILED");
  const reset = await h.password({ action: "login", username: account.username, password: NEW_PASSWORD });
  assert.equal(reset.code, 0);
  assert.deepEqual(reset.userInfo.houses, ["synthetic-admin-house"]);
  account = await h.admin.setStatus(ACTOR, { accountId: account.id, status: "disabled", expectedRevision: account.revision });
  assert.equal((await h.password({ action: "login", username: account.username, password: NEW_PASSWORD })).code, "AUTH_FAILED");
  account = await h.admin.setStatus(ACTOR, { accountId: account.id, status: "active", expectedRevision: account.revision });
  assert.equal((await h.password({ action: "login", username: account.username, password: NEW_PASSWORD })).userInfo._id, userId);
  assert.deepEqual(await h.admin.listAccounts(ACTOR), [account]);
  assert.equal(h.raw.memory.rows("users").length, 1);
  assert.equal(h.raw.memory.rows("tenant_auth_phone_bindings").length, 1);
  assert.equal(h.raw.memory.rows("tenant_auth_audit").length, 4);
  assert.ok(h.raw.setCalls.every((call) => !Object.hasOwn(call.data, "data") && !Object.hasOwn(call.data, "_id")));
});

test("SDK transaction retries retain adapter context and all admin writes roll back on audit/commit failure", async () => {
  const h = fixture();
  const userId = await registered(h);
  let injected = false;
  h.raw.memory.beforeCommit = async () => {
    if (injected) return;
    injected = true;
    const user = h.raw.memory.row("users", userId);
    h.raw.memory._write("users", userId, { ...user, houses: ["concurrent-admin-house"] });
  };
  const account = await h.admin.createAccount(ACTOR, { userId, username: "tenant.management", password: PASSWORD });
  assert.ok(h.raw.memory.commitLog.some((entry) => entry.result === "conflict-retry"));
  assert.equal(h.raw.memory.rows("tenant_auth_accounts").length, 1);
  assert.equal(h.raw.memory.rows("tenant_auth_audit").length, 1);
  assert.equal((await h.password({ action: "login", username: account.username, password: PASSWORD })).code, 0);
  for (const failure of ["audit", "commit"]) {
    if (failure === "audit") h.raw.setResult = ({ name }) => name === "tenant_auth_audit" ? { code: "SYNTHETIC_AUDIT_FAILURE" } : undefined;
    else { h.raw.setResult = null; h.raw.memory.failCommits = 1; }
    const before = h.raw.snapshot();
    await assert.rejects(() => h.admin.resetPassword(ACTOR, {
      accountId: account.id, newPassword: NEW_PASSWORD, expectedRevision: account.revision,
    }), (error) => error.code === "SERVICE_UNAVAILABLE");
    assert.deepEqual(h.raw.snapshot(), before);
  }
});

test("adapter throws an SDK conflict result so the SDK owns retry and commit", async () => {
  let attempts = 0;
  let commits = 0;
  let rollbacks = 0;
  const values = [];
  const raw = {
    collection() { throw new Error("unexpected base read"); },
    async runTransaction(work) {
      for (;;) {
        attempts += 1;
        const pending = [];
        try {
          const result = await work({ collection: () => ({ doc: (id) => ({
            async set(data) {
              assert.equal(Object.hasOwn(data, "data"), false);
              assert.equal(Object.hasOwn(data, "_id"), false);
              if (attempts === 1) return { code: "DATABASE_TRANSACTION_CONFLICT" };
              pending.push({ id, data });
              return { updated: 1 };
            },
          }) }) });
          values.push(...pending);
          commits += 1;
          return result;
        } catch (error) {
          rollbacks += 1;
          if (error.code !== "DATABASE_TRANSACTION_CONFLICT") throw error;
        }
      }
    },
  };
  const db = new TenantAuthCloudDatabase(raw);
  const result = await db.runTransaction(async (tx) => {
    await tx.collection("synthetic").doc("row").set({ data: { _id: "row", value: 1 } });
    return "synthetic-success";
  });
  assert.equal(result, "synthetic-success");
  assert.equal(attempts, 2);
  assert.equal(rollbacks, 1);
  assert.equal(commits, 1);
  assert.deepEqual(values, [{ id: "row", data: { value: 1 } }]);
});

// Invoke the public request handler directly. No HTTP client, listener, SDK
// initialization or real account participates in this server-wiring contract.
async function liveHandler(h) {
  let handler;
  let databaseCalls = 0;
  const account = { _id: ACTOR.id, username: "synthetic-admin", name: "Synthetic admin", enabled: true, revision: 1, role: "admin" };
  const origin = "http://synthetic.invalid";
  await createApp({ mode: "live", directory: "/tmp/unused-tenant-adapter", origin,
    store: { app: { database() { databaseCalls += 1; return h.raw; } } },
    accounts: { rows: [account], login: async () => account },
    serverFactory(fn) { handler = fn; return { on() {}, address() { return { port: 0 }; } }; },
  });
  let cookie, csrf;
  async function request(url, method = "GET", data) {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    Object.assign(req, { url, method, socket: { remoteAddress: "127.0.0.1" }, headers: {
      origin, ...(cookie ? { cookie } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}),
    } });
    const headers = {};
    const output = {};
    await handler(req, { setHeader(key, value) { headers[key.toLowerCase()] = value; },
      writeHead(status) { output.status = status; }, end(value) { output.data = JSON.parse(String(value)); } });
    return { ...output, headers };
  }
  const login = await request("/api/login", "POST", { username: account.username, password: "synthetic-admin-password" });
  assert.equal(login.status, 200);
  cookie = login.headers["set-cookie"].split(";")[0];
  csrf = login.data.csrf;
  return { request, databaseCalls: () => databaseCalls };
}

test("public live administrator handler wraps the strict management SDK for tenant account writes", async () => {
  const h = fixture();
  const userId = await registered(h);
  const route = await liveHandler(h);
  const residents = await route.request("/api/tenant-password-accounts/residents");
  assert.equal(residents.status, 200);
  assert.equal(residents.data.rows[0].userId, userId);
  const created = await route.request("/api/tenant-password-accounts/create", "POST", {
    userId, username: "tenant.route", password: PASSWORD,
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.userId, userId);
  const listed = await route.request("/api/tenant-password-accounts");
  assert.equal(listed.status, 200);
  assert.equal(listed.data.rows[0].id, created.data.id);
  assert.equal((await h.password({ action: "login", username: "tenant.route", password: PASSWORD })).code, 0);
  assert.equal(route.databaseCalls(), 3);
});
