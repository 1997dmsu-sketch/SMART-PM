import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { LocalStore } from "../lib/store.mjs";
import { LocalCloudDatabase } from "../lib/local-cloud-database.mjs";
import { AdminTenantPasswordAccounts } from "../lib/tenant-password-accounts.mjs";
const { TenantAccountService } = createRequire(import.meta.url)("../../cloudfunctions/accountLogin/lib/service.js");
const { createMain: createPhoneLogin } = createRequire(import.meta.url)("../../cloudfunctions/phoneLogin");

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), "smartpm-local-tx-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await new LocalStore(directory).init();
  return { store, directory, db: new LocalCloudDatabase(store, { actorId: "test-admin" }) };
}

test("local transaction commits business and audit once; rollback is content-complete", async (t) => {
  const { db, store, directory } = await setup(t);
  const before = structuredClone(store.data);
  await assert.rejects(db.runTransaction(async (tx) => {
    await tx.collection("private_test").doc("a").set({ data: { value: 1 } });
    await tx.collection("private_audit").add({ data: { action: "CREATE" } });
    throw Error("abort");
  }), /abort/);
  assert.deepEqual(store.data, before);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "demo-data.json"))), before);
  await assert.rejects(db.runTransaction(async (tx) => {
    await tx.collection("private_test").doc("uncloneable").set({ data: { value: 9 } });
    return () => "not-a-receipt";
  }), { name: "DataCloneError" });
  assert.deepEqual(store.data, before);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "demo-data.json"))), before);
  const result = await db.runTransaction(async (tx) => {
    await tx.collection("private_test").doc("a").set({ data: { value: 2 } });
    await tx.collection("private_audit").add({ data: { action: "CREATE" } });
    return { ok: true };
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(store.data.private_test[0].value, 2);
  assert.equal(store.data.private_audit.length, 1);
  assert.equal(store.data.admin_audit.length, before.admin_audit.length + 1);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "demo-data.json"))), store.data);
});

test("parallel increments share the same LocalStore queue and preserve existing writes", async (t) => {
  const { db, store } = await setup(t);
  await db.collection("counters").doc("x").set({ data: { n: 0 } });
  await Promise.all(Array.from({ length: 12 }, () => db.runTransaction(async (tx) => {
    const value = (await tx.collection("counters").doc("x").get()).data;
    await Promise.resolve();
    await tx.collection("counters").doc("x").update({ data: { n: value.n + 1 } });
  })).concat(store.change("content", null, () => ({ title: "concurrent" }), { action: "test" })));
  assert.equal((await db.collection("counters").doc("x").get()).data.n, 12);
  assert.ok(store.data.content.some((row) => row.title === "concurrent"));
});

test("transaction forbids outer-query fallback, create-only conflicts and closed handles", async (t) => {
  const { db, store } = await setup(t);
  const before = structuredClone(store.data);
  await assert.rejects(db.runTransaction((tx) => tx.collection("users").where({}).get()), { code: "TX_UNSUPPORTED_QUERY" });
  assert.deepEqual(store.data, before);
  let leaked;
  await db.runTransaction(async (tx) => { leaked = tx; await tx.collection("records").add({ data: { _id: "once", ok: true } }); });
  const after = structuredClone(store.data);
  await assert.rejects(db.runTransaction((tx) => tx.collection("records").add({ data: { _id: "once", ok: false } })), { code: "ALREADY_EXISTS" });
  await assert.rejects(leaked.collection("records").doc("once").get(), { code: "TRANSACTION_CLOSED" });
  assert.deepEqual(store.data, after);
  assert.equal((await db.collection("records").limit(1).get()).data.length, 1);
  assert.throws(() => db.collection("__proto__"), { code: "INVALID_COLLECTION" });
});

test("read-only and persist failure are zero-write; audit never copies credential data", async (t) => {
  const { db, store } = await setup(t);
  const before = structuredClone(store.data);
  let persists = 0;
  const persist = store.persist.bind(store);
  store.persist = async () => { persists++; throw Error("disk unavailable"); };
  await db.runTransaction((tx) => tx.collection("missing").doc("none").get());
  assert.equal(persists, 0);
  await assert.rejects(db.runTransaction((tx) => tx.collection("credentials").doc("private").set({ data: { sensitiveTestValue: "never-audit" } })), /disk unavailable/);
  assert.deepEqual(store.data, before);
  store.persist = persist;
  await db.collection("credentials").doc("private").set({ data: { sensitiveTestValue: "never-audit" } });
  assert.equal(JSON.stringify(store.data.admin_audit).includes("never-audit"), false);
});

test("real local persistence supports verified registration, administrator account creation and same-user password reset", async (t) => {
  const { db, store, directory } = await setup(t);
  const service = new TenantAccountService({ db });
  const context = { APPID: "synthetic-app", OPENID: "synthetic-tenant" };
  const actor = { id: "synthetic-admin", role: "admin" };
  const register = createPhoneLogin({ db, cloud: {
    getWXContext: () => context,
    openapi: { phonenumber: { getPhoneNumber: async () => ({ phoneInfo: { purePhoneNumber: "13800000000" } }) } },
  } });
  const registration = await register({ code: "synthetic-phone-authorization" });
  assert.equal(registration.code, 0);
  const userId = registration.userInfo._id;
  assert.deepEqual(registration.userInfo.houses, []);
  const admin = new AdminTenantPasswordAccounts({ database: db });
  const residents = await admin.listVerifiedUsers(actor);
  assert.ok(residents.some((row) => row.userId === userId));
  const account = await admin.createAccount(actor, { userId,
    username: "tenant.test", password: "synthetic-first-value" });
  const first = await service.login(context, { username: "tenant.test", password: "synthetic-first-value" });
  assert.equal(first.code, 0);
  assert.equal(first.userInfo._id, account.userId);
  const repeated = await register({ code: "synthetic-phone-authorization-again" });
  assert.equal(repeated.userInfo._id, first.userInfo._id);
  assert.equal(store.data.users.filter((row) => row._id === userId).length, 1);
  await service.resetPassword(actor, { accountId: account.id, expectedRevision: 1,
    newPassword: "synthetic-second-value" });
  assert.equal((await service.login(context, { username: "tenant.test", password: "synthetic-first-value" })).code, "AUTH_FAILED");
  assert.equal((await service.login(context, { username: "tenant.test", password: "synthetic-second-value" })).userInfo._id, first.userInfo._id);
  const disk = await readFile(join(directory, "demo-data.json"), "utf8");
  for (const value of ["synthetic-first-value", "synthetic-second-value"]) assert.equal(disk.includes(value), false);
  assert.equal(JSON.stringify(store.data.admin_audit).includes("saltHex"), false);
  assert.equal(JSON.stringify(store.data.users).includes("hashHex"), false);
});
