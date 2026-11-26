import test from "node:test";
import assert from "node:assert/strict";
import { AdminSignedLeaseAccess } from "../lib/signed-lease-administration.mjs";
import { readFileSync } from "node:fs";
import { operationInput, receiptView, recordView, createSignedLeaseAccessPage } from "../public/signed-lease-access.js";
import { Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createApp } from "../server.mjs";
import { LocalStore } from "../lib/store.mjs";
import { TenantAuthCloudDatabase } from "../lib/tenant-auth-cloud-database.mjs";
import { LocalCloudDatabase } from "../lib/local-cloud-database.mjs";
const { createMain: createPhoneLogin } = createRequire(import.meta.url)("../../cloudfunctions/phoneLogin");


const guard = globalThis.__DSH_D_NETWORK_GUARD__;
let baseline;
test.before(() => { assert.ok(guard, "preload the D network guard"); guard.assertLoadTimeClean(); });
test.beforeEach(() => { baseline = guard.snapshot(); });
test.afterEach(() => guard.assertNoViolations(baseline, "signed lease administrator facade"));
const actor = { kind: "admin", id: "synthetic-admin" };

test("administrator facade directly calls all six core operations and projects receipts", async () => {
  const database = {}, now = () => 1800000000000, calls = [];
  const cases = [
    ["configureProgram", { expectedRevision: 0, enabled: false, dispatchEnabled: false }, { revision: 1, enabled: false, dispatchEnabled: false }],
    ["setDoorBinding", { bindingId: "synthetic-binding", expectedRevision: 0, houseId: "synthetic-house", displayName: "合成门", deviceKey: "synthetic-device", doorNo: 2, expectedModel: "synthetic-model", enabled: false },
      { bindingId: "synthetic-binding", revision: 1, houseId: "synthetic-house", displayName: "合成门", deviceKey: "synthetic-device", doorNo: 2, expectedModel: "synthetic-model", enabled: false }],
    ["setWorker", { workerId: "synthetic-worker", expectedRevision: 0, deviceKey: "synthetic-device", tokenHash: "a".repeat(64), enabled: false },
      { workerId: "synthetic-worker", revision: 1, deviceKey: "synthetic-device", enabled: false }],
    ["confirmSignedLease", { contractId: "synthetic-contract", expectedRevision: 0, userId: "synthetic-user", houseId: "synthetic-house", doorBindingId: "synthetic-binding", startDate: "2026-12-01", endDate: "2026-12-02", signedEvidenceRef: "synthetic-evidence" },
      { contractId: "synthetic-contract", revision: 1, status: "signed", userId: "synthetic-user", houseId: "synthetic-house", doorBindingId: "synthetic-binding", startDate: "2026-12-01", endDate: "2026-12-02", validFrom: 1796054400000, validUntil: 1796227200000 }],
    ["revokeLease", { contractId: "synthetic-contract", expectedRevision: 1, reason: "合成撤销原因" }, { contractId: "synthetic-contract", revision: 2, status: "revoked" }],
    ["resolveUnknown", { taskId: "synthetic-task", expectedRevision: 2, reason: "合成人工核查" }, { taskId: "synthetic-task", revision: 3, status: "unknown", resolved: true }],
  ];
  const service = new AdminSignedLeaseAccess({ database, now, serviceFactory(options) {
    assert.equal(options.db, database); assert.equal(options.now, now);
    return Object.fromEntries(cases.map(([operation, , receipt]) => [operation, async (trusted, input) => {
      calls.push({ operation, trusted, input });
      return { ...receipt, tokenHash: "SYNTHETIC_PRIVATE_HASH", signedEvidenceRef: "SYNTHETIC_PRIVATE_EVIDENCE", internal: { secret: "SYNTHETIC_INTERNAL" } };
    }]));
  } });
  for (const [operation, input, receipt] of cases) {
    assert.deepEqual(await service[operation](actor, input), receipt);
    assert.deepEqual(calls.at(-1), { operation, trusted: actor, input });
  }
  assert.equal(calls.length, 6);
});

test("facade rejects forged actor and unrecognized input without calling the core", async () => {
  let calls = 0;
  const service = new AdminSignedLeaseAccess({ serviceFactory: () => ({ configureProgram: async () => { calls += 1; } }) });
  for (const value of [{ kind: "tenant", id: "synthetic-user" }, { kind: "admin", id: "synthetic-admin", role: "admin" }, null]) {
    await assert.rejects(service.configureProgram(value, {}), { code: "ADMIN_REQUIRED", status: 403 });
  }
  for (const input of [{ enabled: false, role: "admin" }, { enabled: false, userId: "forged" }, null, []]) {
    await assert.rejects(service.configureProgram(actor, input), { code: "INVALID_INPUT", status: 400 });
  }
  assert.equal(calls, 0);
});

test("direct facade rejects symbol, hidden, prototype and accessor inputs without evaluating getters", async () => {
  let getters = 0, calls = 0;
  const service = new AdminSignedLeaseAccess({ serviceFactory: () => ({ configureProgram: async () => { calls += 1; } }) });
  const getterInput = Object.defineProperty({}, "enabled", { enumerable: true, get() { getters += 1; return false; } });
  const getterActor = Object.defineProperty({ kind: "admin" }, "id", { enumerable: true, get() { getters += 1; return "synthetic-admin"; } });
  const hiddenInput = Object.defineProperty({}, "enabled", { value: false, enumerable: false });
  for (const input of [{ enabled: false, [Symbol("synthetic-hidden")]: true }, getterInput, hiddenInput, Object.create({ enabled: false })]) {
    await assert.rejects(service.configureProgram(actor, input), { code: "INVALID_INPUT", status: 400 });
  }
  for (const trusted of [{ ...actor, [Symbol("synthetic-role")]: "admin" }, getterActor, Object.create(actor)]) {
    await assert.rejects(service.configureProgram(trusted, {}), { code: "ADMIN_REQUIRED", status: 403 });
  }
  assert.equal(getters, 0); assert.equal(calls, 0);
});

test("facade fails closed for absent or malformed core receipts and preserves safe core conflicts", async () => {
  const malformed = new AdminSignedLeaseAccess({ serviceFactory: () => ({ setWorker: async () => ({ workerId: "synthetic-worker", revision: 1, enabled: false }) }) });
  await assert.rejects(malformed.setWorker(actor, {}), { code: "SERVICE_UNAVAILABLE", status: 503 });
  const conflict = Object.assign(new Error("synthetic core conflict"), { code: "REVISION_CONFLICT", status: 409 });
  const rejecting = new AdminSignedLeaseAccess({ serviceFactory: () => ({ revokeLease: async () => { throw conflict; } }) });
  await assert.rejects(rejecting.revokeLease(actor, {}), (error) => error === conflict);
});

test("administrator record facade projects each read kind, keeps null, accepts revoked contracts and never returns secrets", async () => {
  const records = {
    contract: { contractId: "synthetic-contract", revision: 2, status: "revoked", userId: "synthetic-user", houseId: "synthetic-house", doorBindingId: "synthetic-binding", startDate: "1970-01-01", endDate: "1970-01-01", validFrom: -28800000, validUntil: 57600000 },
    binding: { bindingId: "synthetic-binding", revision: 1, houseId: "synthetic-house", displayName: "合成门", deviceKey: "synthetic-device", doorNo: 2, expectedModel: "synthetic-model", enabled: false },
    worker: { workerId: "synthetic-worker", revision: 1, deviceKey: "synthetic-device", enabled: false },
    program: { revision: 1, enabled: false, dispatchEnabled: false },
    task: { taskId: "synthetic-task", revision: 3, status: "unknown", resolved: false, contractId: "synthetic-contract", expiresAt: 1800000000000, message: "设备结果未知，请勿重复开门，需人工核对" },
  };
  const ids = { contract: "synthetic-contract", binding: "synthetic-binding", worker: "synthetic-worker", task: "synthetic-task" };
  let calls = 0;
  const service = new AdminSignedLeaseAccess({ serviceFactory: () => ({ getAdminRecord: async (trusted, input) => {
    assert.deepEqual(trusted, actor); calls += 1;
    return { kind: input.kind, record: input.id === "synthetic-missing" ? null : { ...records[input.kind], tokenHash: "SYNTHETIC_PRIVATE_HASH", signedEvidenceRef: "SYNTHETIC_EVIDENCE", internal: "SYNTHETIC_INTERNAL" } };
  } }) });
  for (const kind of Object.keys(records)) {
    assert.deepEqual(await service.getAdminRecord(actor, { kind, ...(ids[kind] ? { id: ids[kind] } : {}) }), { kind, record: records[kind] });
  }
  assert.deepEqual(await service.getAdminRecord(actor, { kind: "program", id: "program" }), { kind: "program", record: records.program });
  assert.deepEqual(await service.getAdminRecord(actor, { kind: "contract", id: "synthetic-missing" }), { kind: "contract", record: null });
  assert.equal(calls, 7);
  for (const input of [{ kind: "other", id: "synthetic" }, { kind: "worker" }, { kind: "program", id: "other" },
    { kind: "worker", id: "synthetic-worker", role: "admin" }, { kind: "worker", id: "synthetic-worker", [Symbol("hidden")]: true },
    Object.defineProperty({}, "kind", { enumerable: true, get() { throw Error("GETTER_MUST_NOT_RUN"); } })]) {
    await assert.rejects(service.getAdminRecord(actor, input), { code: "INVALID_INPUT", status: 400 });
  }
  await assert.rejects(service.getAdminRecord({ kind: "tenant", id: "synthetic-user" }, { kind: "program" }), { code: "ADMIN_REQUIRED", status: 403 });
  assert.equal(calls, 7, "invalid reads never enter the core");
});

test("record facade rejects mismatched kinds, ids, invalid status and revision zero, while 1970 Shanghai confirmation receipts remain valid", async () => {
  let result = { kind: "program", record: null };
  const service = new AdminSignedLeaseAccess({ serviceFactory: () => ({ getAdminRecord: async () => result }) });
  await assert.rejects(service.getAdminRecord(actor, { kind: "worker", id: "synthetic-worker" }), { code: "SERVICE_UNAVAILABLE" });
  for (const record of [{ revision: 0, enabled: false, dispatchEnabled: false }, { revision: 1, enabled: "false", dispatchEnabled: false }]) {
    result = { kind: "program", record };
    await assert.rejects(service.getAdminRecord(actor, { kind: "program" }), { code: "SERVICE_UNAVAILABLE" });
  }
  result = { kind: "task", record: { taskId: "synthetic-other", revision: 1, status: "unknown", resolved: false, contractId: "synthetic-contract", expiresAt: 1800000000000, message: "合成未知结果" } };
  await assert.rejects(service.getAdminRecord(actor, { kind: "task", id: "synthetic-task" }), { code: "SERVICE_UNAVAILABLE" });
  result.record.taskId = "synthetic-task"; result.record.status = "opened";
  await assert.rejects(service.getAdminRecord(actor, { kind: "task", id: "synthetic-task" }), { code: "SERVICE_UNAVAILABLE" });
  result.record.status = "unknown"; result.record.resolved = "false";
  await assert.rejects(service.getAdminRecord(actor, { kind: "task", id: "synthetic-task" }), { code: "SERVICE_UNAVAILABLE" });
  const receipt = { contractId: "synthetic-epoch-contract", revision: 1, status: "signed", userId: "synthetic-user", houseId: "synthetic-house", doorBindingId: "synthetic-binding", startDate: "1970-01-01", endDate: "1970-01-01", validFrom: -28800000, validUntil: 57600000 };
  const confirming = new AdminSignedLeaseAccess({ serviceFactory: () => ({ confirmSignedLease: async () => receipt }) });
  assert.deepEqual(await confirming.confirmSignedLease(actor, {}), receipt);
  assert.deepEqual(receiptView("confirm", receipt), receipt);
  assert.deepEqual(recordView({ kind: "contract", record: receipt }, "contract", receipt.contractId), { kind: "contract", record: receipt });
});

async function harness(t, { role = "admin", mode = "demo", store, factory } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "smartpm-signed-admin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  store ||= await new LocalStore(directory).init();
  const account = { _id: "synthetic-admin", username: "synthetic.admin", name: "合成管理员", enabled: true, revision: 1, role };
  const accounts = { rows: [account], login: async () => account };
  let handler;
  const origin = "http://synthetic.invalid";
  await createApp({ directory, store, accounts, origin, mode,
    ...(factory ? { signedLeaseAdministrationFactory: factory } : {}),
    serverFactory(fn) { handler = fn; return { on() {}, address() { return { port: 0 }; } }; },
  });
  let cookie, csrf;
  async function request(url, { method = "GET", data, authenticated = true, withCsrf = true, withOrigin = true } = {}) {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    Object.assign(req, { url, method, socket: { remoteAddress: "127.0.0.1" }, headers: {
      ...(withOrigin ? { origin } : {}), ...(authenticated && cookie ? { cookie } : {}),
      ...(withCsrf && csrf ? { "x-csrf-token": csrf } : {}),
    } });
    const headers = {}, result = {};
    const res = { headersSent: false, setHeader(key, value) { headers[key.toLowerCase()] = value; },
      writeHead(status) { this.headersSent = true; result.status = status; },
      end(value) { result.payload = JSON.parse(String(value)); } };
    await handler(req, res);
    return { ...result, headers };
  }
  async function login() {
    const response = await request("/api/login", { method: "POST", data: { username: account.username, password: "synthetic-admin-password" } });
    assert.equal(response.status, 200); cookie = response.headers["set-cookie"].split(";")[0]; csrf = response.payload.csrf;
  }
  return { request, login, store, accounts };
}

test("actual no-listener handler enforces session, Origin, CSRF, role and session revision before core entry", async (t) => {
  let calls = 0;
  const factory = () => ({ confirmSignedLease: async () => { calls += 1; return {}; } });
  const h = await harness(t, { factory });
  const path = "/api/signed-lease-access/confirm";
  assert.equal((await h.request(path, { method: "POST", data: {} })).status, 401);
  await h.login();
  for (const options of [{ withCsrf: false }, { withOrigin: false }]) assert.equal((await h.request(path, { method: "POST", data: {}, ...options })).status, 403);
  assert.equal((await h.request(path, { method: "HEAD", data: {} })).status, 405);
  h.accounts.rows = [{ ...h.accounts.rows[0], revision: 2 }];
  assert.equal((await h.request(path, { method: "POST", data: {} })).status, 401);
  const ordinary = await harness(t, { role: "viewer", factory });
  await ordinary.login();
  for (const path of ["options", "confirm", "revoke", "program", "binding", "worker", "resolve-unknown"]) {
    assert.equal((await ordinary.request(`/api/signed-lease-access/${path}`, { method: path === "options" ? "GET" : "POST", data: {} })).status, 403);
  }
  assert.equal(calls, 0);
});

test("all six routes derive the admin actor from the active session and use the management SDK adapter", async (t) => {
  const calls = [];
  const names = { confirm: "confirmSignedLease", revoke: "revokeLease", program: "configureProgram", binding: "setDoorBinding", worker: "setWorker", "resolve-unknown": "resolveUnknown" };
  const rawDatabase = { collection() { return {}; }, runTransaction() {} };
  const h = await harness(t, { mode: "live", store: { app: { database: () => rawDatabase } }, factory({ database }) {
    assert.ok(database instanceof TenantAuthCloudDatabase);
    return Object.fromEntries(Object.values(names).map((operation) => [operation, async (actor, data) => {
      calls.push({ operation, actor, data }); return { revision: 1 };
    }]));
  } });
  await h.login();
  for (const [route, operation] of Object.entries(names)) {
    const input = { syntheticMarker: route, actor: { kind: "admin", id: "forged-user" } };
    const response = await h.request(`/api/signed-lease-access/${route}`, { method: "POST", data: input });
    assert.equal(response.status, 200);
    assert.deepEqual(calls.at(-1), { operation, actor: { kind: "admin", id: "synthetic-admin" }, data: input });
  }
  assert.equal(calls.length, 6);
  assert.equal((await h.request("/api/signed-lease-access/confirm")).status, 404);
  assert.equal((await h.request("/api/signed-lease-access/unknown", { method: "POST", data: {} })).status, 404);
});

test("actual admin route records externally signed facts through the real core without face, payment, houses mutation or an open task", async (t) => {
  const h = await harness(t); await h.login();
  h.store.data.rooms = [{ _id: "synthetic-room-document", houseId: "synthetic-house", name: "合成房产" }];
  const phoneLogin = createPhoneLogin({ db: new LocalCloudDatabase(h.store), now: () => 1800000000000, cloud: {
    getWXContext: () => ({ APPID: "synthetic-app", OPENID: "synthetic-resident" }),
    openapi: { phonenumber: { getPhoneNumber: async () => ({ phoneInfo: { purePhoneNumber: "13800000000" } }) } },
  } });
  const registered = await phoneLogin({ code: "synthetic-phone-authorization" });
  assert.equal(registered.code, 0);
  const userId = registered.userInfo._id;
  const originalHouses = structuredClone(h.store.data.users.find((row) => row._id === userId).houses);
  const options = await h.request("/api/signed-lease-access/options");
  assert.equal(options.payload.residents[0].userId, userId);
  const binding = await h.request("/api/signed-lease-access/binding", { method: "POST", data: {
    bindingId: "synthetic-binding", expectedRevision: 0, houseId: "synthetic-house", displayName: "合成门",
    deviceKey: "synthetic-device", doorNo: 2, expectedModel: "synthetic-model", enabled: false,
  } });
  assert.equal(binding.status, 200);
  const input = { contractId: "synthetic-contract", expectedRevision: 0, userId, houseId: "synthetic-house",
    doorBindingId: "synthetic-binding", startDate: "2026-12-01", endDate: "2026-12-02", signedEvidenceRef: "synthetic-signed-evidence" };
  const confirmed = await h.request("/api/signed-lease-access/confirm", { method: "POST", data: input });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.payload.status, "signed"); assert.equal(confirmed.payload.revision, 1);
  assert.equal(confirmed.payload.validUntil - confirmed.payload.validFrom, 2 * 86400000);
  assert.equal(JSON.stringify(confirmed.payload).includes(input.signedEvidenceRef), false);
  assert.deepEqual(h.store.data.users.find((row) => row._id === userId).houses, originalHouses);
  assert.equal(h.store.data.remote_unlock_tasks, undefined);
  assert.equal(h.store.data.signed_lease_grants.length, 1);
  const count = h.store.data.remote_unlock_audits.length;
  assert.deepEqual((await h.request("/api/signed-lease-access/confirm", { method: "POST", data: input })).payload, confirmed.payload);
  assert.equal(h.store.data.remote_unlock_audits.length, count, "identical fact is idempotent");
  const forged = await h.request("/api/signed-lease-access/confirm", { method: "POST", data: { ...input, role: "admin" } });
  assert.equal(forged.status, 400); assert.equal(forged.payload.code, "INVALID_INPUT");
  const revoked = await h.request("/api/signed-lease-access/revoke", { method: "POST", data: {
    contractId: input.contractId, expectedRevision: 1, reason: "合成撤销核查",
  } });
  assert.equal(revoked.status, 200); assert.deepEqual(revoked.payload, { contractId: input.contractId, revision: 2, status: "revoked" });
  assert.equal(h.store.data.signed_lease_grants[0].status, "revoked");
  assert.equal(h.store.data.remote_unlock_tasks, undefined);
  const snapshot = structuredClone(h.store.data);
  const read = await h.request(`/api/signed-lease-access/record?kind=contract&id=${input.contractId}`, { withOrigin: false, withCsrf: false });
  assert.equal(read.status, 200); assert.equal(read.payload.kind, "contract");
  assert.equal(read.payload.record.status, "revoked"); assert.equal(read.payload.record.revision, 2);
  assert.equal(JSON.stringify(read.payload).includes(input.signedEvidenceRef), false);
  assert.deepEqual((await h.request("/api/signed-lease-access/record?kind=program")).payload, { kind: "program", record: null });
  assert.deepEqual((await h.request("/api/signed-lease-access/record?kind=contract&id=synthetic-missing")).payload, { kind: "contract", record: null });
  assert.deepEqual(h.store.data, snapshot, "GET does not persist, audit, expire, grant or revoke anything");
});

test("record GET requires a current administrator and rejects write methods and ambiguous query keys before reading", async (t) => {
  let reads = 0;
  const h = await harness(t, { factory: () => ({ getAdminRecord: async (trusted, data) => {
    assert.deepEqual(trusted, actor); assert.deepEqual(data, { kind: "program" }); reads += 1;
    return { kind: "program", record: null };
  } }) });
  const path = "/api/signed-lease-access/record?kind=program";
  assert.equal((await h.request(path)).status, 401); await h.login();
  const snapshot = structuredClone(h.store.data);
  for (const method of ["POST", "PUT"]) assert.equal((await h.request(path, { method, data: {} })).status, 404);
  assert.equal((await h.request(path, { method: "HEAD" })).status, 405);
  for (const query of ["kind=program&kind=worker", "kind=worker&id=a&id=b", "kind=program&role=admin", "id=program"]) {
    const response = await h.request(`/api/signed-lease-access/record?${query}`);
    assert.equal(response.status, 400); assert.equal(response.payload.code, "INVALID_INPUT");
  }
  assert.equal(reads, 0);
  assert.deepEqual((await h.request(path, { withCsrf: false, withOrigin: false })).payload, { kind: "program", record: null });
  assert.equal(reads, 1); assert.deepEqual(h.store.data, snapshot);
  h.accounts.rows = [{ ...h.accounts.rows[0], revision: 2 }];
  assert.equal((await h.request(path)).status, 401);
  const viewer = await harness(t, { role: "viewer", factory: () => ({ getAdminRecord: async () => { reads += 1; } }) });
  await viewer.login(); assert.equal((await viewer.request(path)).status, 403); assert.equal(reads, 1);
});

test("options expose only verified residents and house display fields, with no invented signing facts", async (t) => {
  const h = await harness(t); await h.login();
  h.store.data.rooms = [{ _id: "synthetic-room-document", houseId: "synthetic-house", name: "合成房产", deviceSecret: "SYNTHETIC_PRIVATE" }];
  const response = await h.request("/api/signed-lease-access/options");
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, { residents: [], rooms: [{ houseId: "synthetic-house", displayName: "合成房产" }] });
  assert.equal(JSON.stringify(response).includes("SYNTHETIC_PRIVATE"), false);
  assert.equal(h.store.data.signed_lease_contracts, undefined);
});

test("route redacts arbitrary database and core messages and reports safe revision conflicts", async (t) => {
  const broken = await harness(t, { mode: "live", store: { app: { database() { throw Error("SYNTHETIC_DATABASE_SECRET"); } } } });
  await broken.login();
  const failure = await broken.request("/api/signed-lease-access/confirm", { method: "POST", data: {} });
  assert.equal(failure.status, 503); assert.equal(failure.payload.code, "SERVICE_UNAVAILABLE");
  assert.equal(JSON.stringify(failure).includes("SYNTHETIC_DATABASE_SECRET"), false);
  const conflict = await harness(t, { factory: () => ({ revokeLease: async () => { throw Object.assign(Error("SYNTHETIC_CORE_SECRET"), { code: "REVISION_CONFLICT", status: 409 }); } }) });
  await conflict.login();
  const response = await conflict.request("/api/signed-lease-access/revoke", { method: "POST", data: {} });
  assert.equal(response.status, 409); assert.equal(response.payload.code, "REVISION_CONFLICT");
  assert.equal(JSON.stringify(response).includes("SYNTHETIC_CORE_SECRET"), false);
});

class Element {
  constructor(name = "") { this.name = name; this.value = ""; this.textContent = ""; this.hidden = false; this.disabled = false; this.listeners = new Map(); this.children = []; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  replaceChildren(...children) { this.children = children; }
  async emit(name) { return this.listeners.get(name)?.({ preventDefault() {} }); }
}
function pageDocument() {
  const nodes = new Map(), forms = [], controls = [];
  for (const id of ["lease-message", "lease-worker-hash", "lease-receipt", "lease-content", "lease-login", "lease-login-message", "lease-reload", "lease-record-form", "lease-record-kind", "lease-record-id", "lease-record-result"]) nodes.set(id, new Element());
  const formFields = {
    confirm: ["contractId", "expectedRevision", "userId", "houseId", "doorBindingId", "startDate", "endDate", "signedEvidenceRef"],
    revoke: ["contractId", "expectedRevision", "reason"], program: ["expectedRevision", "enabled", "dispatchEnabled"],
    binding: ["bindingId", "expectedRevision", "houseId", "displayName", "deviceKey", "doorNo", "expectedModel", "enabled"],
    worker: ["workerId", "expectedRevision", "deviceKey", "tokenHash", "enabled"],
    "resolve-unknown": ["taskId", "expectedRevision", "reason"],
  };
  const byOperation = new Map();
  for (const [operation, fields] of Object.entries(formFields)) {
    const form = new Element(); form.dataset = { operation }; form.elements = fields.map((name) => new Element(name));
    forms.push(form); byOperation.set(operation, form); controls.push(...form.elements);
    if (operation === "confirm") {
      nodes.set("lease-resident", form.elements.find((control) => control.name === "userId"));
      nodes.set("lease-house", form.elements.find((control) => control.name === "houseId"));
    }
    if (operation === "worker") nodes.set("lease-worker-hash", form.elements.find((control) => control.name === "tokenHash"));
  }
  const houses = [nodes.get("lease-house"), byOperation.get("binding").elements.find((control) => control.name === "houseId")];
  controls.push(nodes.get("lease-record-kind"), nodes.get("lease-record-id"));
  return { nodes, forms: byOperation, getElementById: (id) => nodes.get(id), createElement: () => new Element(),
    querySelectorAll(selector) { return selector === "form[data-operation]" ? forms : selector === "[data-house-options]" ? houses : controls; },
    fill(operation, values) { for (const control of byOperation.get(operation).elements) control.value = values[control.name] ?? ""; },
  };
}
const uiConfirm = { contractId: "synthetic-contract", expectedRevision: "0", userId: "synthetic-user", houseId: "synthetic-house", doorBindingId: "synthetic-binding", startDate: "2026-12-01", endDate: "2026-12-02", signedEvidenceRef: "synthetic-evidence" };
const uiReceipt = { contractId: "synthetic-contract", revision: 1, status: "signed", userId: "synthetic-user", houseId: "synthetic-house", doorBindingId: "synthetic-binding", startDate: "2026-12-01", endDate: "2026-12-02", validFrom: 1796054400000, validUntil: 1796227200000 };
const response = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload });
function optionsResponse() { return response({ residents: [{ userId: "synthetic-user", phone: "13800000000", name: "合成住户", openid: "SYNTHETIC_PRIVATE_OPENID" }], rooms: [{ houseId: "synthetic-house", displayName: "合成房产" }] }); }

test("admin page requires explicit real inputs and projects payloads and receipts without secrets", () => {
  const html = readFileSync(new URL("../public/signed-lease-access.html", import.meta.url), "utf8");
  assert.equal(/<input\b[^>]*\bvalue\s*=/i.test(html), false, "no tenant, contract, dates, revision or device default");
  assert.match(html, /不生成合同或代替法律签字/); assert.match(html, /无需租客再次申请或二次审批/); assert.match(html, /人脸可之后补录/);
  assert.deepEqual(operationInput("confirm", { ...uiConfirm, role: "admin", signed: true }), { ...uiConfirm, expectedRevision: 0 });
  for (const missing of ["userId", "houseId", "startDate", "endDate", "signedEvidenceRef", "expectedRevision"]) assert.throws(() => operationInput("confirm", { ...uiConfirm, [missing]: "" }));
  assert.throws(() => operationInput("program", { expectedRevision: "0", enabled: "", dispatchEnabled: "false" }));
  assert.throws(() => operationInput("worker", { workerId: "synthetic-worker", expectedRevision: "0", deviceKey: "synthetic-device", enabled: "false", tokenHash: "plaintext-token" }));
  assert.deepEqual(receiptView("confirm", { ...uiReceipt, signedEvidenceRef: "SYNTHETIC_PRIVATE_EVIDENCE", tokenHash: "SYNTHETIC_PRIVATE_HASH" }), uiReceipt);
  assert.throws(() => receiptView("confirm", { ...uiReceipt, status: "device_confirmed" }));
  assert.throws(() => receiptView("resolve-unknown", { taskId: "synthetic-task", revision: 1, status: "device_confirmed", resolved: true }));
});

test("actual page submits signed facts once with current CSRF, preserves blank selections and never sends face/payment fields", async () => {
  const doc = pageDocument(), calls = [];
  let finish;
  const waiting = new Promise((resolve) => { finish = resolve; });
  const page = createSignedLeaseAccessPage({ document: doc, fetch: async (path, init) => {
    calls.push({ path, init });
    if (path === "/api/me") return response({ account: { role: "admin" }, csrf: "synthetic-csrf" });
    if (path.endsWith("/options")) return optionsResponse();
    return waiting;
  } });
  await page.start();
  assert.equal(doc.nodes.get("lease-content").hidden, false);
  assert.equal(doc.nodes.get("lease-resident").value, ""); assert.equal(doc.nodes.get("lease-house").value, "");
  assert.equal(doc.nodes.get("lease-resident").children[1].textContent.includes("SYNTHETIC_PRIVATE_OPENID"), false);
  doc.fill("confirm", uiConfirm);
  const first = doc.forms.get("confirm").emit("submit");
  await doc.forms.get("confirm").emit("submit");
  const writes = calls.filter((call) => call.init.method === "POST");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/api/signed-lease-access/confirm");
  assert.equal(writes[0].init.headers["X-CSRF-Token"], "synthetic-csrf");
  assert.deepEqual(JSON.parse(writes[0].init.body), { ...uiConfirm, expectedRevision: 0 });
  finish(response({ ...uiReceipt, tokenHash: "SYNTHETIC_PRIVATE_HASH" })); await first;
  assert.deepEqual(JSON.parse(doc.nodes.get("lease-receipt").textContent), uiReceipt);
  assert.match(doc.nodes.get("lease-message").textContent, /没有发送开门命令，人脸可之后补录/);
});

test("page treats ambiguous submission as unconfirmed without retry and locks after session denial", async () => {
  const doc = pageDocument(); let writes = 0, denied = false;
  const page = createSignedLeaseAccessPage({ document: doc, fetch: async (path) => {
    if (path === "/api/me") return response({ account: { role: "admin" }, csrf: "synthetic-csrf" });
    if (path.endsWith("/options")) return optionsResponse();
    writes += 1;
    if (denied) return response({ code: "ADMIN_REQUIRED", error: "SYNTHETIC_UNTRUSTED_MESSAGE" }, 403);
    throw Error("SYNTHETIC_TRANSPORT_BODY");
  } });
  await page.start(); doc.fill("confirm", uiConfirm);
  await doc.forms.get("confirm").emit("submit");
  assert.equal(writes, 1); assert.match(doc.nodes.get("lease-receipt").textContent, /未获确认/);
  assert.match(doc.nodes.get("lease-message").textContent, /不会自动重试/);
  assert.equal(doc.nodes.get("lease-message").textContent.includes("SYNTHETIC_TRANSPORT_BODY"), false);
  denied = true;
  await doc.forms.get("confirm").emit("submit");
  assert.equal(writes, 2); assert.equal(doc.nodes.get("lease-content").hidden, true);
  await doc.forms.get("confirm").emit("submit"); assert.equal(writes, 2);
  assert.equal(doc.nodes.get("lease-message").textContent.includes("SYNTHETIC_UNTRUSTED_MESSAGE"), false);
});

test("page record lookup uses only GET, keeps original forms and switches untouched, and clears stale display on error or denial", async () => {
  const doc = pageDocument(), calls = [];
  let mode = "record";
  const page = createSignedLeaseAccessPage({ document: doc, fetch: async (path, init) => {
    calls.push({ path, init });
    if (path === "/api/me") return response({ account: { role: "admin" }, csrf: "synthetic-csrf" });
    if (path.endsWith("/options")) return optionsResponse();
    assert.equal(init.method, "GET"); assert.equal(init.body, undefined);
    if (mode === "failure") throw Error("SYNTHETIC_PRIVATE_READ_ERROR");
    if (mode === "denied") return response({ code: "ADMIN_REQUIRED", error: "SYNTHETIC_PRIVATE_DENIAL" }, 401);
    if (path.endsWith("kind=program")) return response({ kind: "program", record: null });
    return response({ kind: "contract", record: { ...uiReceipt, status: "revoked", revision: 2,
      tokenHash: "SYNTHETIC_PRIVATE_HASH", signedEvidenceRef: "SYNTHETIC_PRIVATE_EVIDENCE" } });
  } });
  await page.start();
  assert.equal(calls.some((call) => call.path.includes("/record?")), false, "lookup requires an explicit user action");
  doc.fill("confirm", uiConfirm);
  doc.fill("program", { expectedRevision: "7", enabled: "false", dispatchEnabled: "false" });
  const formValues = () => [...doc.forms].map(([operation, form]) => [operation, form.elements.map((control) => [control.name, control.value])]);
  const original = formValues();
  doc.nodes.get("lease-record-kind").value = "contract";
  doc.nodes.get("lease-record-id").value = "synthetic-contract";
  await doc.nodes.get("lease-record-form").emit("submit");
  assert.equal(calls.at(-1).path, "/api/signed-lease-access/record?kind=contract&id=synthetic-contract");
  assert.deepEqual(JSON.parse(doc.nodes.get("lease-record-result").textContent), { kind: "contract", record: { ...uiReceipt, status: "revoked", revision: 2 } });
  assert.deepEqual(formValues(), original);
  assert.equal(calls.some((call) => call.init.method !== "GET"), false);
  doc.nodes.get("lease-record-kind").value = "program"; doc.nodes.get("lease-record-id").value = "";
  await doc.nodes.get("lease-record-form").emit("submit");
  assert.equal(calls.at(-1).path, "/api/signed-lease-access/record?kind=program");
  assert.deepEqual(JSON.parse(doc.nodes.get("lease-record-result").textContent), { kind: "program", record: null });
  assert.deepEqual(formValues(), original);
  mode = "failure";
  await doc.nodes.get("lease-record-form").emit("submit");
  assert.match(doc.nodes.get("lease-record-result").textContent, /未获得可核对的当前记录/);
  assert.equal(doc.nodes.get("lease-record-result").textContent.includes("synthetic-contract"), false);
  assert.equal(doc.nodes.get("lease-message").textContent.includes("SYNTHETIC_PRIVATE_READ_ERROR"), false);
  mode = "denied";
  await doc.nodes.get("lease-record-form").emit("submit");
  assert.equal(doc.nodes.get("lease-content").hidden, true);
  assert.equal(doc.nodes.get("lease-record-result").textContent.includes("synthetic-contract"), false);
  const count = calls.length;
  await doc.nodes.get("lease-record-form").emit("submit"); assert.equal(calls.length, count);
});
