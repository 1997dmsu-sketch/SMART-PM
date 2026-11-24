import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createApp } from "../server.mjs";
import { FaceEnrollmentService, SimulatedFaceProvider } from "../lib/face-enrollment.mjs";

// Synthetic JPEG framing only: never a face, and never sent outside this process.
const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0, 1, 0xff, 0xd9]);
const accountPassword = "synthetic-account-password-123";
const deviceConfig = {
  mode: "device",
  origin: "https://synthetic.invalid",
  username: "synthetic-device-admin",
  password: "synthetic-device-password-no-network",
  certificateBase64: "synthetic-certificate-no-network",
  developmentTls: true,
};
const input = (overrides = {}) => ({
  employeeNo: "SYNTHETIC_HTTP_01",
  name: "合成接口测试人员",
  doorNo: 1,
  FDID: "SIMULATION_FD_01",
  faceLibType: "blackFD",
  validFrom: "2026-11-24T09:00",
  validTo: "2026-11-24T10:00",
  photoBase64: photo.toString("base64"),
  photoName: "synthetic-http-photo.jpg",
  consent: true,
  ...overrides,
});

class TrackingProvider extends SimulatedFaceProvider {
  closeCount = 0;
  photoMatched = false;
  async putFace(person, bytes) {
    this.photoMatched = bytes.equals(photo);
    return super.putFace(person, bytes);
  }
  close() {
    this.closeCount += 1;
    super.close();
  }
}

async function localApp(t) {
  const directory = await mkdtemp(join(tmpdir(), "smartpm-face-server-"));
  const services = [], providers = [];
  const app = await createApp({
    directory,
    faceServiceFactory: () => {
      const service = new FaceEnrollmentService({
        providerFactory: (config) => {
          // This factory replaces device transport completely: no DNS or TLS.
          assert.equal(config.origin, deviceConfig.origin);
          assert.equal(config.username, deviceConfig.username);
          assert.equal(config.password, deviceConfig.password);
          const provider = new TrackingProvider();
          providers.push(provider);
          return provider;
        },
      });
      services.push(service);
      return service;
    },
  });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const close = async () => {
    if (!app.server.listening) return;
    await new Promise((resolve, reject) => {
      app.server.close(error => error ? reject(error) : resolve());
      app.server.closeAllConnections();
    });
  };
  t.after(async () => {
    await close();
    // Verify the recursive cleanup target is this test's own temporary directory.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("smartpm-face-server-"));
    await rm(directory, { recursive: true, force: true });
  });
  async function request(path, { method = "GET", data, auth, origin = url, csrf = true } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (origin !== null) headers.Origin = origin;
    if (auth) {
      headers.Cookie = auth.cookie;
      if (csrf !== false) headers["X-CSRF-Token"] = csrf === true ? auth.csrf : csrf;
    }
    const response = await fetch(`${url}/api/${path}`, {
      method, headers, body: data === undefined ? undefined : JSON.stringify(data),
    });
    const text = await response.text();
    return {
      status: response.status,
      data: JSON.parse(text),
      text,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      setCookie: response.headers.get("set-cookie"),
    };
  }
  async function demoLogin() {
    const response = await request("demo-login", { method: "POST", data: {} });
    assert.equal(response.status, 200);
    assert.ok(response.cookie);
    return { ...response.data, cookie: response.cookie };
  }
  async function accountLogin(role, username = `face_${role}`) {
    const account = await app.accounts.save({ username, name: username, role, password: accountPassword, enabled: true });
    const response = await request("login", { method: "POST", data: { username, password: accountPassword } });
    assert.equal(response.status, 200);
    return { ...response.data, cookie: response.cookie, id: account._id };
  }
  return { app, request, demoLogin, accountLogin, services, providers, close };
}

function assertNoSecrets(response) {
  const denied = new Set(["password", "credentials", "authorization", "certificate", "certificatebase64", "photobase64", "photobytes", "photoname"]);
  const visit = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!denied.has(key.toLowerCase()), `response exposed ${key}`);
      visit(child);
    }
  };
  visit(response.data);
  for (const secret of [deviceConfig.username, deviceConfig.password, deviceConfig.certificateBase64, photo.toString("base64"), "synthetic-http-photo.jpg"])
    assert.ok(!response.text.includes(secret), "response contained synthetic secret/photo material");
}

test("face endpoints require login and admin role before creating device sessions", async t => {
  const fixture = await localApp(t);
  const { request, services, providers } = fixture;
  const mutations = ["connect", "disconnect", "enroll", "retry", "verify"];
  assert.equal((await request("face/state")).status, 401);
  for (const endpoint of mutations)
    assert.equal((await request(`face/${endpoint}`, { method: "POST", data: {} })).status, 401);
  for (const role of ["viewer", "editor"]) {
    const auth = await fixture.accountLogin(role);
    assert.equal((await request("face/state", { auth })).status, 403);
    for (const endpoint of mutations)
      assert.equal((await request(`face/${endpoint}`, { method: "POST", auth, data: {} })).status, 403);
  }
  assert.equal(services.length, 0);
  assert.equal(providers.length, 0);
});

test("face mutations enforce CSRF and same-origin checks before any provider work", async t => {
  const fixture = await localApp(t);
  const auth = await fixture.demoLogin();
  for (const endpoint of ["connect", "disconnect", "enroll", "retry", "verify"]) {
    for (const protection of [
      { csrf: false }, { csrf: "incorrect-csrf-token" },
      { origin: "https://attacker.invalid" }, { origin: null },
    ]) {
      const response = await fixture.request(`face/${endpoint}`, { method: "POST", auth, data: deviceConfig, ...protection });
      assert.equal(response.status, 403);
      assertNoSecrets(response);
    }
  }
  assert.equal(fixture.services.length, 0);
  assert.equal(fixture.providers.length, 0);
  assert.equal((await fixture.request("face/state", { auth, csrf: false })).status, 200);
});

test("simulation HTTP flow connects, enrolls to ready, verifies and disconnects", async t => {
  const fixture = await localApp(t);
  const auth = await fixture.demoLogin();
  const send = (endpoint, data) => fixture.request(`face/${endpoint}`, { method: "POST", auth, data });
  const initial = await fixture.request("face/state", { auth });
  assert.equal(initial.status, 200);
  assert.equal(initial.data.connected, false);
  assert.deepEqual(initial.data.enrollments, []);
  assert.equal((await send("enroll", input())).status, 409);
  const connected = await send("connect", { mode: "simulation" });
  assert.equal(connected.status, 200);
  assert.equal(connected.data.mode, "simulation");
  assert.equal(connected.data.connected, true);
  assert.deepEqual(connected.data.capabilities.doorNumbers, [1]);
  const enrolled = await send("enroll", input());
  assert.equal(enrolled.status, 200);
  const row = enrolled.data.enrollment;
  assert.equal(row.status, "ready");
  assert.equal(row.mode, "simulation");
  assert.deepEqual(row.steps.map(step => [step.key, step.state]), [["person", "success"], ["face", "success"], ["access", "success"], ["verify", "success"]]);
  assert.equal(row.validFrom, "2026-11-24T09:00:00");
  assert.equal(row.validTo, "2026-11-24T10:00:00");
  const state = await fixture.request("face/state", { auth });
  assert.equal(state.status, 200);
  assert.equal(state.data.enrollments.length, 1);
  assert.equal(state.data.enrollments[0].id, row.id);
  const verified = await send("verify", { id: row.id });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.enrollment.status, "ready");
  assert.equal(verified.data.enrollment.id, row.id);
  for (const response of [initial, connected, enrolled, state, verified]) assertNoSecrets(response);
  const disconnected = await send("disconnect", {});
  assert.equal(disconnected.status, 200);
  assert.equal(disconnected.data.connected, false);
  assert.deepEqual(disconnected.data.enrollments, []);
  assert.equal((await send("verify", { id: row.id })).status, 404);
  assert.equal(fixture.providers.length, 0, "simulation must not invoke the device provider factory");
});

test("two sessions of the same admin keep connections and enrollment records isolated", async t => {
  const fixture = await localApp(t);
  const first = await fixture.demoLogin();
  const second = await fixture.demoLogin();
  assert.notEqual(first.cookie, second.cookie);
  assert.equal(first.account._id, second.account._id);
  const send = (auth, endpoint, data) => fixture.request(`face/${endpoint}`, { method: "POST", auth, data });
  assert.equal((await send(first, "connect", { mode: "simulation" })).status, 200);
  const secondInitial = await fixture.request("face/state", { auth: second });
  assert.equal(secondInitial.data.connected, false);
  assert.deepEqual(secondInitial.data.enrollments, []);
  assert.equal((await send(second, "connect", { mode: "simulation" })).status, 200);
  const firstRow = (await send(first, "enroll", input({ name: "第一会话合成人员" }))).data.enrollment;
  const secondRow = (await send(second, "enroll", input({ name: "第二会话合成人员" }))).data.enrollment;
  assert.equal(firstRow.status, "ready");
  assert.equal(secondRow.status, "ready");
  assert.notEqual(firstRow.id, secondRow.id);
  for (const [auth, own, foreign] of [[first, firstRow, secondRow], [second, secondRow, firstRow]]) {
    const state = await fixture.request("face/state", { auth });
    assert.deepEqual(state.data.enrollments.map(row => row.id), [own.id]);
    for (const endpoint of ["verify", "retry"])
      assert.equal((await send(auth, endpoint, { id: foreign.id })).status, 404);
    assertNoSecrets(state);
  }
  assert.equal(fixture.services.length, 2);
  assert.equal((await send(first, "disconnect", {})).status, 200);
  const secondState = await fixture.request("face/state", { auth: second });
  assert.equal(secondState.data.connected, true);
  assert.deepEqual(secondState.data.enrollments.map(row => row.id), [secondRow.id]);
  assert.equal((await send(second, "verify", { id: secondRow.id })).data.enrollment.status, "ready");
});

test("device-mode injection stays local, hides credentials/photos, and logout closes its provider", async t => {
  const fixture = await localApp(t);
  const auth = await fixture.demoLogin();
  const connected = await fixture.request("face/connect", { method: "POST", auth, data: deviceConfig });
  assert.equal(connected.status, 200);
  assert.equal(connected.data.mode, "device");
  assert.equal(connected.data.device.origin, deviceConfig.origin);
  const enrolled = await fixture.request("face/enroll", { method: "POST", auth, data: input() });
  assert.equal(enrolled.status, 200);
  assert.equal(enrolled.data.enrollment.status, "ready");
  const state = await fixture.request("face/state", { auth });
  const verified = await fixture.request("face/verify", { method: "POST", auth, data: { id: enrolled.data.enrollment.id } });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.enrollment.status, "ready");
  const provider = fixture.providers[0];
  assert.equal(provider.photoMatched, true);
  assert.equal(provider.people.size, 1);
  assert.equal(provider.closeCount, 0);
  const loggedOut = await fixture.request("logout", { method: "POST", auth, data: {} });
  assert.equal(loggedOut.status, 200);
  assert.deepEqual(loggedOut.data, { ok: true });
  assert.match(loggedOut.setCookie, /Max-Age=0/);
  assert.equal(provider.closeCount, 1);
  assert.equal(provider.people.size, 0);
  assert.equal(provider.faces.size, 0);
  assert.deepEqual(fixture.services[0].state().enrollments, []);
  assert.equal((await fixture.request("face/state", { auth })).status, 401);
  for (const response of [connected, enrolled, state, verified, loggedOut]) assertNoSecrets(response);
  const newAuth = await fixture.demoLogin();
  const newState = await fixture.request("face/state", { auth: newAuth });
  assert.equal(newState.data.connected, false);
  assert.deepEqual(newState.data.enrollments, []);
  assertNoSecrets(newState);
});

test("an expired login closes its face provider before rejecting the old session", async t => {
  const fixture = await localApp(t);
  const auth = await fixture.demoLogin();
  assert.equal((await fixture.request("face/connect", { method: "POST", auth, data: deviceConfig })).status, 200);
  assert.equal((await fixture.request("face/enroll", { method: "POST", auth, data: input() })).data.enrollment.status, "ready");
  const expiredAt = Date.now() + 8 * 60 * 60 * 1000 + 1000;
  t.mock.method(Date, "now", () => expiredAt);
  try {
    const response = await fixture.request("face/state", { auth });
    assert.equal(response.status, 401);
    assertNoSecrets(response);
  } finally {
    t.mock.restoreAll();
  }
  assert.equal(fixture.providers[0].closeCount, 1);
  assert.deepEqual(fixture.services[0].state().enrollments, []);
});

test("a revoked admin session closes its provider before returning unauthorized", async t => {
  const fixture = await localApp(t);
  const auth = await fixture.accountLogin("admin");
  assert.equal((await fixture.request("face/connect", { method: "POST", auth, data: deviceConfig })).status, 200);
  await fixture.app.accounts.save({ username: auth.account.username, name: auth.account.name, role: "viewer", enabled: true }, auth.id);
  assert.equal((await fixture.request("face/state", { auth })).status, 401);
  assert.equal(fixture.providers[0].closeCount, 1);
});

test("closing the HTTP server closes every connected face provider and releases records", async t => {
  const fixture = await localApp(t);
  for (let index = 0; index < 2; index += 1) {
    const auth = await fixture.demoLogin();
    assert.equal((await fixture.request("face/connect", { method: "POST", auth, data: deviceConfig })).status, 200);
    assert.equal((await fixture.request("face/enroll", { method: "POST", auth, data: input() })).data.enrollment.status, "ready");
  }
  assert.equal(fixture.providers.length, 2);
  await fixture.close();
  for (const provider of fixture.providers) {
    assert.equal(provider.closeCount, 1);
    assert.equal(provider.people.size, 0);
    assert.equal(provider.faces.size, 0);
  }
  for (const service of fixture.services) assert.deepEqual(service.state().enrollments, []);
});

test("unknown face endpoints and incorrect endpoint methods return 404", async t => {
  const fixture = await localApp(t);
  const auth = await fixture.demoLogin();
  for (const [path, method] of [
    ["face", "GET"], ["face/", "GET"], ["face/unknown", "GET"], ["face/unknown", "POST"],
    ["face/state", "POST"], ["face/connect", "GET"], ["face/enroll", "GET"], ["face/verify", "PUT"],
  ]) {
    const response = await fixture.request(path, { auth, method, data: method === "GET" ? undefined : {} });
    assert.equal(response.status, 404, `${method} /api/${path}`);
    assertNoSecrets(response);
  }
  assert.equal(fixture.providers.length, 0);
});
