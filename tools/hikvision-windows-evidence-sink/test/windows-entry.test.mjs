import assert from "node:assert/strict";
import { types } from "node:util";

// Only synthetic literals enter this driver. Real native work is performed by
// the closed production entry, never by a caller path, transport or callback.
const SCOPE = "synthetic-windows-evidence-entry-tests";
const RESULT_SCOPE = "synthetic-windows-evidence-sink-only";
const GROUPS = ["PRECHECK", "NATIVE", "BRAND", "CONTROL", "WRITE", "OUTPUT"];
const IDS = ["deviceInfo", "acsCapabilities", "userInfoCapabilities", "fdlibCapabilities", "fdlibList", "fdlibCount"];
const CHECKS = [
  "platformSupported", "identitySupported", "locationSupported", "ancestorHandlesHeld",
  "rootCreatedExclusive", "rootAclValid", "nativeIdentityValid", "rootEntriesValid",
  "filesCreatedExclusive", "fileAclsValid", "contentVerified", "flushVerified", "deleteSharingDenied",
];
const COUNTS = ["directoriesCreated", "filesCreated", "bytesWritten", "bytesVerified", "flushes", "validationCalls"];

function contextFixture() {
  return {
    versions: {
      tool: "558b9c864a4b820e397336200758b143556a4d87",
      checker: "31f20c9a372c447f142312f6e95e0400372f9ee8",
      adapter: "synthetic-binding-v1", endpoints: "hk-ai-08-six-get-v1",
    },
    output: { rootRef: "synthetic-root-1", policyRef: "synthetic-windows-handle-acl-v1" },
  };
}

function inputFixture() {
  return {
    schemaVersion: "hk-ai-08-synthetic-binding-v1", dataClass: "synthetic-only",
    approvalRef: "synthetic-approval-1",
    approvedTarget: { deviceRef: "synthetic-device-1", host: " 192.0.2.10 ", port: "0443", model: "DS-K1T671BM" },
    candidate: {
      deviceRef: "synthetic-device-1", host: "192.0.2.10", allowedHosts: " 192.0.2.10 ",
      port: "443", allowedPorts: "0443", expectedModel: "DS-K1T671BM", allowRead: false,
    },
    execution: {
      tls: { mode: "fingerprint-pinned", fingerprints: ["A".repeat(64)], caBytes: [83, 89, 78, 84, 72] },
      limits: { timeoutMs: 1000, requestDeadlineMs: 2000, sessionDeadlineMs: 10000, maxBytes: 262144 },
      output: { rootRef: "synthetic-root-1", policyRef: "synthetic-windows-handle-acl-v1" },
      versions: {
        tool: "558b9c864a4b820e397336200758b143556a4d87",
        checker: "31f20c9a372c447f142312f6e95e0400372f9ee8",
        adapter: "synthetic-binding-v1", endpoints: "hk-ai-08-six-get-v1",
      },
      credentials: { username: "SYNTHETIC_USER", password: "SYNTHETIC_PASSWORD" },
      endpoints: [
        { id: "deviceInfo", method: "GET", path: "/ISAPI/System/deviceInfo", expect: "xml" },
        { id: "acsCapabilities", method: "GET", path: "/ISAPI/AccessControl/capabilities", expect: "xml" },
        { id: "userInfoCapabilities", method: "GET", path: "/ISAPI/AccessControl/UserInfo/capabilities?format=json", expect: "json" },
        { id: "fdlibCapabilities", method: "GET", path: "/ISAPI/Intelligent/FDLib/capabilities?format=json", expect: "json" },
        { id: "fdlibList", method: "GET", path: "/ISAPI/Intelligent/FDLib?format=json", expect: "json" },
        { id: "fdlibCount", method: "GET", path: "/ISAPI/Intelligent/FDLib/Count?format=json", expect: "json" },
      ],
    },
  };
}

// Independently written canonical view, not derived from production snapshots.
function expectedFixture() {
  return {
    target: { deviceRef: "synthetic-device-1", host: "192.0.2.10", port: 443, model: "DS-K1T671BM" },
    tls: { mode: "fingerprint-pinned", fingerprints: ["A".repeat(64)], caBytes: [83, 89, 78, 84, 72] },
    limits: { timeoutMs: 1000, requestDeadlineMs: 2000, sessionDeadlineMs: 10000, maxBytes: 262144 },
    output: { rootRef: "synthetic-root-1", policyRef: "synthetic-windows-handle-acl-v1" },
    versions: {
      tool: "558b9c864a4b820e397336200758b143556a4d87",
      checker: "31f20c9a372c447f142312f6e95e0400372f9ee8",
      adapter: "synthetic-binding-v1", endpoints: "hk-ai-08-six-get-v1",
    },
    credentials: { username: "SYNTHETIC_USER", password: "SYNTHETIC_PASSWORD" },
    endpoints: [
      { id: "deviceInfo", method: "GET", path: "/ISAPI/System/deviceInfo", expect: "xml" },
      { id: "acsCapabilities", method: "GET", path: "/ISAPI/AccessControl/capabilities", expect: "xml" },
      { id: "userInfoCapabilities", method: "GET", path: "/ISAPI/AccessControl/UserInfo/capabilities?format=json", expect: "json" },
      { id: "fdlibCapabilities", method: "GET", path: "/ISAPI/Intelligent/FDLib/capabilities?format=json", expect: "json" },
      { id: "fdlibList", method: "GET", path: "/ISAPI/Intelligent/FDLib?format=json", expect: "json" },
      { id: "fdlibCount", method: "GET", path: "/ISAPI/Intelligent/FDLib/Count?format=json", expect: "json" },
    ],
    allowRead: false,
  };
}

function grantFixture() {
  return { scope: "synthetic-fake-execution-only", approvalRef: "synthetic-approval-1", windowStart: 0, windowEnd: 100000 };
}
const bytesFromText = (text) => Array.from(new TextEncoder().encode(text));
const inputBytes = (input = inputFixture()) => bytesFromText(JSON.stringify(input));
function responseFixture(endpointId, attempt = 1) {
  return { endpointId, attempt, status: 200, parseable: true, model: "DS-K1T671BM", capability: "confirmed", challenge: null, elapsedMs: 0 };
}
const responsesFixture = () => IDS.map((id) => responseFixture(id));

const evidenceRefs = new Set();
const compilerRefs = new Set();
const sessions = [];
const cases = [];
const nextIds = new Map(GROUPS.map((group) => [group, 0]));
function test(group, run) {
  const index = nextIds.get(group) + 1;
  nextIds.set(group, index);
  cases.push({ id: `${group}-${String(index).padStart(3, "0")}`, group, run });
}
class RequiredNativeBlocked {
  constructor(code) { this.code = /^[A-Z0-9_]{1,80}$/.test(code) ? code : "NATIVE_CAPABILITY_BLOCKED"; }
}

function rememberNativeRefs(native) {
  if (native === null || typeof native !== "object" || types.isProxy(native)) return;
  for (const [key, collection, pattern] of [
    ["evidenceRef", evidenceRefs, /^hk-win-sink-[0-9a-f]{32}$/],
    ["compilerRef", compilerRefs, /^hk-win-compile-[0-9a-f]{32}$/],
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(native, key);
    if (descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string" && pattern.test(descriptor.value)) collection.add(descriptor.value);
  }
}

function assertNative(native) {
  // Preserve already-created object references before a DTO assertion can fail.
  rememberNativeRefs(native);
  assert.notEqual(native, null);
  assert.equal(typeof native, "object");
  const expectedKeys = ["status", "code", "evidenceRef", "compilerRef", "checks", "counts", "newObjectStateUnverified", "retained", "closed"];
  if (Object.hasOwn(native, "busy") || Object.hasOwn(native, "operation")) expectedKeys.push("busy", "operation");
  assert.deepEqual(Object.keys(native).sort(), expectedKeys.sort());
  assert.equal(["PASS", "FAIL", "BLOCKED"].includes(native.status), true);
  assert.match(native.code, /^[A-Z0-9_]{1,80}$/);
  assert.equal(native.retained, true);
  assert.equal(typeof native.closed, "boolean");
  assert.equal(typeof native.newObjectStateUnverified, "boolean");
  assert.equal(Object.isFrozen(native), true);
  assert.deepEqual(Object.keys(native.checks).sort(), [...CHECKS].sort());
  assert.deepEqual(Object.keys(native.counts).sort(), [...COUNTS].sort());
  for (const value of Object.values(native.checks)) assert.equal(typeof value, "boolean");
  for (const value of Object.values(native.counts)) assert.equal(Number.isSafeInteger(value) && value >= 0, true);
  for (const [key, collection, pattern] of [
    ["evidenceRef", evidenceRefs, /^hk-win-sink-[0-9a-f]{32}$/],
    ["compilerRef", compilerRefs, /^hk-win-compile-[0-9a-f]{32}$/],
  ]) {
    if (native[key] !== null) { assert.match(native[key], pattern); collection.add(native[key]); }
  }
  if (Object.hasOwn(native, "busy")) {
    assert.equal(typeof native.busy, "boolean");
    assert.equal(["idle", "validate", "write", "close"].includes(native.operation), true);
  }
  return native;
}

function assertSummary(summary) {
  assert.deepEqual(Object.keys(summary).sort(), ["schemaVersion", "phase", "status", "code", "counts", "stages", "allowReadStayedFalse"].sort());
  assert.equal(summary.schemaVersion, "hk-ai-08-offline-summary-v1");
  assert.equal(summary.phase, "synthetic-offline-only");
  assert.equal(summary.allowReadStayedFalse, true);
  assert.equal(["PASS", "FAIL"].includes(summary.status), true);
  assert.match(summary.code, /^[A-Z0-9_]{1,80}$/);
  assert.deepEqual(Object.keys(summary.counts).sort(), ["logicalEndpoints", "transmissions", "authRetries", "unknownEndpoints"].sort());
  assert.equal(summary.stages.length, 6);
  for (const value of Object.values(summary.counts)) assert.equal(Number.isSafeInteger(value) && value >= 0, true);
  summary.stages.forEach((stage, index) => {
    assert.deepEqual(Object.keys(stage).sort(), ["id", "state", "code", "httpStatus", "transmissions"].sort());
    assert.equal(stage.id, IDS[index]);
    assert.equal(["NOT_EXECUTED", "confirmed", "unsupported", "unknown", "blocked"].includes(stage.state), true);
    assert.equal(Number.isSafeInteger(stage.transmissions) && stage.transmissions >= 0 && stage.transmissions <= 2, true);
    if (stage.state === "NOT_EXECUTED") {
      assert.equal(stage.code, "NOT_EXECUTED"); assert.equal(stage.transmissions, 0); assert.equal(stage.httpStatus, null);
    }
    assert.equal(Object.isFrozen(stage), true);
  });
  assert.equal(summary.counts.transmissions, summary.stages.reduce((sum, item) => sum + item.transmissions, 0));
  assert.equal(Object.isFrozen(summary), true);
}

function baseResult(result) {
  if (result !== null && typeof result === "object" && !types.isProxy(result)) {
    const descriptor = Object.getOwnPropertyDescriptor(result, "native");
    if (descriptor && Object.hasOwn(descriptor, "value")) rememberNativeRefs(descriptor.value);
  }
  assert.equal(result.scope, RESULT_SCOPE);
  assert.equal(Object.isFrozen(result), true);
  if (Object.hasOwn(result, "native") && result.native !== null) assertNative(result.native);
  if (Object.hasOwn(result, "summary") && result.summary !== null) {
    assertSummary(result.summary);
    assert.equal(result.summary.status, result.status);
    assert.equal(result.summary.code, result.code);
  }
  return result;
}
function pass(result) {
  baseResult(result);
  if (result.status === "BLOCKED") throw new RequiredNativeBlocked(result.code);
  assert.equal(result.status, "PASS"); assert.equal(result.code, "OK");
  return result;
}
function rejected(result, code) {
  baseResult(result);
  assert.equal(result.status, "FAIL"); assert.notEqual(result.code, "INTERNAL_ERROR");
  if (code !== undefined) assert.equal(result.code, code);
  return result;
}
function transportState(session) { return pass(session.entry.observeTransport(session.transport)); }
function windowsState(session) { return pass(session.entry.observeWindows(session.binding)).native; }

function trap(value, probe) {
  const hit = () => { probe.calls += 1; throw new Error("SYNTHETIC_TRAP"); };
  return new Proxy(value, { get: hit, ownKeys: hit, getOwnPropertyDescriptor: hit, getPrototypeOf: hit });
}
function getter(value, key, probe) {
  Object.defineProperty(value, key, { enumerable: true, configurable: true, get() { probe.calls += 1; throw new Error("SYNTHETIC_GETTER"); } });
}

let createSyntheticWindowsEvidenceEntry;
let importFailed = false;
try {
  ({ createSyntheticWindowsEvidenceEntry } = await import("../src/entry.mjs"));
  assert.equal(typeof createSyntheticWindowsEvidenceEntry, "function");
} catch { importFailed = true; }

async function makeSession(options = {}) {
  const context = options.context || contextFixture();
  const entry = createSyntheticWindowsEvidenceEntry(context);
  const bytes = options.bytes || inputBytes(options.input || inputFixture());
  const prepared = pass(await entry.prepareWindowsBytes(bytes));
  const session = { entry, bytes, prepared, binding: prepared.binding, transport: null, token: null, context };
  sessions.push(session);
  const expected = options.expected || expectedFixture();
  const responses = options.responses || responsesFixture();
  session.expected = expected; session.responses = responses;
  session.transport = pass(entry.createFakeTransport({ expected, responses })).fakeTransport;
  if (options.issue !== false) session.token = pass(await entry.issueWindowsPermit(session.binding, options.grant || grantFixture())).token;
  return session;
}
async function closeSession(session) {
  const state = windowsState(session);
  if (state.closed) {
    assert.equal(state.status, "PASS"); assert.equal(state.code, "OK"); assert.equal(state.retained, true);
    return;
  }
  if (!state.closed) {
    const closed = pass(await session.entry.closeWindowsBinding(session.binding));
    assert.notEqual(closed.native, null);
    assert.equal(closed.native.closed, true);
    assert.equal(closed.native.retained, true);
  }
}
async function withSession(options, run) {
  const session = await makeSession(options);
  try { return await run(session); } finally { await closeSession(session); }
}

// Yield to I/O: a pure Promise.resolve spin would starve the native worker pipe.
async function injectWhile(session, predicate, action) {
  let settled = false;
  const pending = session.entry.executeWindows(session.binding, session.token, session.transport);
  const completed = pending.then((value) => { settled = true; return value; });
  let injected = false;
  for (let index = 0; index < 8192 && !settled; index += 1) {
    if (predicate(session)) { action(session); injected = true; break; }
    await new Promise((resolve) => index < 512 ? setImmediate(resolve) : setTimeout(resolve, 1));
  }
  const result = await completed;
  assert.equal(injected, true);
  return result;
}

let primary;
let primaryExecuted;
if (!importFailed) {
  test("PRECHECK", () => {
    const context = contextFixture(); context.output.policyRef = "synthetic-windows-acl-v1";
    assert.throws(() => createSyntheticWindowsEvidenceEntry(context), { name: "TypeError", message: "SYNTHETIC_CONTEXT_INVALID" });
  });
  test("PRECHECK", async () => {
    const entry = createSyntheticWindowsEvidenceEntry(contextFixture());
    const result = rejected(await entry.prepareWindowsBytes([0xef, 0xbb, 0xbf, ...inputBytes()]), "BOM_NOT_ALLOWED");
    assert.equal(result.binding, null); assert.equal(result.native, null);
  });
  test("PRECHECK", async () => {
    const entry = createSyntheticWindowsEvidenceEntry(contextFixture());
    const input = inputFixture(); input.candidate.allowRead = true;
    const result = rejected(await entry.prepareWindowsBytes(inputBytes(input)), "CHECKER_REJECTED");
    assert.equal(result.checker, null); assert.equal(result.binding, null); assert.equal(result.native, null);
  });
  test("PRECHECK", async () => {
    const probe = { calls: 0 };
    const entry = createSyntheticWindowsEvidenceEntry(contextFixture());
    const result = rejected(await entry.prepareWindowsBytes(trap(inputBytes(), probe)), "INVALID_BYTES");
    assert.equal(result.native, null); assert.equal(probe.calls, 0);
  });
  test("PRECHECK", async () => {
    const entry = createSyntheticWindowsEvidenceEntry(contextFixture());
    for (const operation of [
      () => entry.observeWindows({}), () => entry.issueWindowsPermit({}, grantFixture()),
      () => entry.executeWindows({}, {}, {}), () => entry.closeWindowsBinding({}),
    ]) rejected(await operation(), "INVALID_BINDING");
  });
  test("PRECHECK", async () => {
    const entry = createSyntheticWindowsEvidenceEntry(contextFixture());
    const context = contextFixture(); context.output.policyRef = "synthetic-other-policy";
    pass(entry.replaceSyntheticRuntime(context));
    const input = inputFixture(); input.execution.output.policyRef = "synthetic-other-policy";
    const result = rejected(await entry.prepareWindowsBytes(inputBytes(input)), "NATIVE_POLICY_UNSUPPORTED");
    assert.equal(result.binding, null); assert.equal(result.native, null);
  });

  test("NATIVE", async () => {
    primary = await makeSession();
    assert.deepEqual(Object.keys(primary.entry).sort(), [
      "prepareWindowsBytes", "createFakeTransport", "issueWindowsPermit", "executeWindows", "closeWindowsBinding", "observeWindows",
      "revokeSyntheticPermit", "advanceSyntheticTime", "replaceSyntheticRuntime", "cancelSyntheticBinding", "observeTransport",
    ].sort());
    for (const handle of [primary.binding, primary.transport, primary.token]) {
      assert.equal(Object.getPrototypeOf(handle), null); assert.deepEqual(Reflect.ownKeys(handle), []); assert.equal(Object.isFrozen(handle), true);
    }
    assert.equal(primary.prepared.checker.status, "PASS");
    const native = windowsState(primary);
    for (const key of CHECKS.slice(0, 8)) assert.equal(native.checks[key], true);
    assert.equal(native.counts.directoriesCreated, 1); assert.equal(native.counts.filesCreated, 0);
    assert.equal(native.closed, false); assert.equal(native.newObjectStateUnverified, false);
    assert.equal(transportState(primary).calls, 0);
  });

  const forgedValues = [() => ({}), (value) => ({ ...value }), (value) => JSON.parse(JSON.stringify(value)), (value, probe) => trap(value, probe)];
  forgedValues.forEach((make) => test("BRAND", async () => {
    const probe = { calls: 0 };
    const binding = make(primary.binding, probe);
    const result = rejected(await primary.entry.executeWindows(binding, primary.token, primary.transport), "INVALID_BINDING");
    assert.equal(result.summary, null); assert.equal(probe.calls, 0); assert.equal(transportState(primary).calls, 0);
  }));
  [() => undefined, ...forgedValues].forEach((make) => test("BRAND", async () => {
    const probe = { calls: 0 };
    const result = rejected(await primary.entry.executeWindows(primary.binding, make(primary.token, probe), primary.transport), "INVALID_PERMIT");
    assert.equal(result.summary, null); assert.equal(probe.calls, 0); assert.equal(windowsState(primary).counts.filesCreated, 0);
  }));
  [...forgedValues, () => () => { throw new Error("SYNTHETIC_CALLBACK_MUST_NOT_RUN"); }].forEach((make) => test("BRAND", async () => {
    const probe = { calls: 0 };
    rejected(await primary.entry.executeWindows(primary.binding, primary.token, make(primary.transport, probe)), "INVALID_TRANSPORT");
    assert.equal(probe.calls, 0); assert.equal(transportState(primary).calls, 0);
  }));
  test("BRAND", async () => {
    const other = createSyntheticWindowsEvidenceEntry(contextFixture());
    const otherTransport = pass(other.createFakeTransport({ expected: expectedFixture(), responses: responsesFixture() })).fakeTransport;
    rejected(await primary.entry.executeWindows(primary.binding, primary.token, otherTransport), "INVALID_TRANSPORT");
    rejected(await other.issueWindowsPermit(primary.binding, grantFixture()), "INVALID_BINDING");
    rejected(await other.closeWindowsBinding(primary.binding), "INVALID_BINDING");
    assert.equal(windowsState(primary).closed, false);
  });
  test("BRAND", async () => {
    const result = rejected(await primary.entry.issueWindowsPermit(primary.binding, grantFixture()), "PERMIT_ALREADY_ISSUED");
    assert.equal(result.token, null); assert.equal(windowsState(primary).counts.filesCreated, 0);
  });

  test("WRITE", async () => {
    primaryExecuted = pass(await primary.entry.executeWindows(primary.binding, primary.token, primary.transport));
    assert.deepEqual(primaryExecuted.summary.counts, { logicalEndpoints: 6, transmissions: 6, authRetries: 0, unknownEndpoints: 0 });
    const native = assertNative(primaryExecuted.native);
    assert.equal(native.status, "PASS"); assert.equal(native.code, "OK");
    for (const key of CHECKS) assert.equal(native.checks[key], true);
    assert.equal(native.counts.directoriesCreated, 1); assert.equal(native.counts.filesCreated, 2); assert.equal(native.counts.flushes, 2);
    assert.equal(native.counts.bytesWritten > 0, true); assert.equal(native.counts.bytesWritten, native.counts.bytesVerified);
    assert.equal(native.counts.validationCalls > 0, true); assert.equal(native.newObjectStateUnverified, false);
    assert.equal(native.closed, false); assert.equal(transportState(primary).calls, 6);
    assert.equal(transportState(primary).last.allowReadStayedFalse, true);
  });
  test("WRITE", async () => {
    const before = windowsState(primary).counts;
    rejected(await primary.entry.executeWindows(primary.binding, primary.token, primary.transport), "PERMIT_USED");
    assert.deepEqual(windowsState(primary).counts, before); assert.equal(transportState(primary).calls, 6);
  });
  test("OUTPUT", () => {
    const text = JSON.stringify([primary.prepared, primaryExecuted, transportState(primary), windowsState(primary)]);
    for (const privateValue of ["192.0.2.10", "SYNTHETIC_USER", "SYNTHETIC_PASSWORD", "A".repeat(64), "83,89,78,84,72", "synthetic-root-1", "Authorization", "C:\\Users\\"]) assert.equal(text.includes(privateValue), false);
    assert.equal(Reflect.set(primaryExecuted.summary.counts, "transmissions", 99), false);
    assert.equal(Reflect.set(primaryExecuted.native.checks, "rootAclValid", false), false);
  });
  test("OUTPUT", async () => {
    const closed = pass(await primary.entry.closeWindowsBinding(primary.binding));
    assert.equal(closed.native.closed, true); assert.equal(closed.native.retained, true); assert.equal(closed.native.counts.filesCreated, 2);
    const repeated = pass(await primary.entry.closeWindowsBinding(primary.binding));
    assert.deepEqual(repeated, closed);
    rejected(await primary.entry.issueWindowsPermit(primary.binding, grantFixture()), "NATIVE_BINDING_CLOSED");
    rejected(await primary.entry.executeWindows(primary.binding, primary.token, primary.transport), "NATIVE_BINDING_CLOSED");
  });

  test("NATIVE", async () => withSession({}, async (session) => {
    const probe = { calls: 0 };
    session.bytes.fill(0); getter(session.bytes, "0", probe);
    session.expected.credentials.password = "SYNTHETIC_CHANGED";
    session.expected.tls.caBytes.fill(0);
    session.responses[0].status = 500;
    getter(session.responses, "0", probe);
    const result = pass(await session.entry.executeWindows(session.binding, session.token, session.transport));
    assert.equal(result.native.counts.filesCreated, 2); assert.equal(result.native.checks.contentVerified, true);
    assert.equal(probe.calls, 0); assert.equal(transportState(session).last.matched, true);
  }));
  test("WRITE", async () => {
    const expected = expectedFixture(); expected.target.host = "192.0.2.11";
    await withSession({ expected }, async (session) => {
      const result = rejected(await session.entry.executeWindows(session.binding, session.token, session.transport), "FAKE_EXPECTATION_MISMATCH");
      assert.equal(result.summary.counts.transmissions, 1); assert.equal(result.native.checks.contentVerified, true);
      assert.equal(result.native.counts.filesCreated, 2); assert.equal(transportState(session).last.targetMatches, false);
      rejected(await session.entry.executeWindows(session.binding, session.token, session.transport), "PERMIT_USED");
    });
  });
  for (const [kind, code] of [["g1-status", "G1_HTTP_STATUS"], ["qop", "AUTH_CHALLENGE_REJECTED"]]) test("WRITE", async () => {
    const responses = responsesFixture();
    if (kind === "g1-status") responses[0].status = 403;
    else { responses[0].status = 401; responses[0].challenge = { algorithm: "SHA-256", qop: "auth-int" }; }
    await withSession({ responses }, async (session) => {
      const result = rejected(await session.entry.executeWindows(session.binding, session.token, session.transport), code);
      assert.equal(result.summary.counts.transmissions, 1);
      for (const stage of result.summary.stages.slice(1)) assert.equal(stage.state, "NOT_EXECUTED");
      assert.equal(result.native.status, "PASS"); assert.equal(result.native.counts.filesCreated, 2);
      assert.equal(result.native.checks.flushVerified, true); assert.equal(result.native.checks.contentVerified, true);
    });
  });

  const controls = [
    ["PERMIT_REVOKED", (session) => pass(session.entry.revokeSyntheticPermit(session.token))],
    ["SESSION_CANCELLED", (session) => pass(session.entry.cancelSyntheticBinding(session.binding))],
    ["PERMIT_EXPIRED", (session) => pass(session.entry.advanceSyntheticTime(100000))],
    ["CONTEXT_CHANGED", (session) => pass(session.entry.replaceSyntheticRuntime(contextFixture()))],
  ];
  controls.forEach(([code, action]) => test("CONTROL", async () => withSession({}, async (session) => {
    const pending = session.entry.executeWindows(session.binding, session.token, session.transport);
    action(session);
    const result = rejected(await pending, code);
    assert.notEqual(result.summary, null); assert.equal(transportState(session).calls, 0);
    assert.equal(result.native.counts.filesCreated, 0);
    rejected(await session.entry.executeWindows(session.binding, session.token, session.transport));
  })));
  controls.forEach(([code, action]) => test("CONTROL", async () => withSession({}, async (session) => {
    const result = rejected(await injectWhile(session, (item) => transportState(item).calls === 6, action), code);
    assert.equal(transportState(session).calls, 6); assert.equal(result.native.counts.filesCreated, 0);
    rejected(await session.entry.executeWindows(session.binding, session.token, session.transport));
  })));
  for (const [code, action] of [controls[0], controls[1]]) test("CONTROL", async () => withSession({}, async (session) => {
    const result = rejected(await injectWhile(session, (item) => {
      const native = windowsState(item); return native.busy === true && native.operation === "write";
    }, action), code);
    // In-flight IO can already have created zero, partial or complete objects.
    assert.equal(result.native.retained, true); assert.equal(result.native.counts.filesCreated >= 0 && result.native.counts.filesCreated <= 2, true);
    const counts = { ...result.native.counts };
    rejected(await session.entry.executeWindows(session.binding, session.token, session.transport));
    assert.deepEqual({ ...windowsState(session).counts }, counts);
  }));
  test("CONTROL", async () => {
    const session = await makeSession({ issue: false });
    try {
      const pending = session.entry.issueWindowsPermit(session.binding, grantFixture());
      pass(session.entry.replaceSyntheticRuntime(contextFixture()));
      const result = rejected(await pending, "CONTEXT_CHANGED");
      assert.equal(result.token, null); assert.equal(result.native.counts.filesCreated, 0);
    } finally { await closeSession(session); }
  });
  test("CONTROL", async () => {
    const entry = createSyntheticWindowsEvidenceEntry(contextFixture());
    const pending = entry.prepareWindowsBytes(inputBytes());
    pass(entry.replaceSyntheticRuntime(contextFixture()));
    const result = rejected(await pending, "CONTEXT_CHANGED");
    assert.equal(result.binding, null); assert.equal(result.configBindingRef, null); assert.equal(result.checker, null);
    assert.notEqual(result.native, null); assert.equal(result.native.retained, true); assert.equal(result.native.closed, true);
  });
}

const groupCounts = GROUPS.map((id) => ({ id, planned: cases.filter((item) => item.group === id).length, executed: 0, passed: 0, failed: 0, blocked: 0, notExecuted: 0 }));
const caseResults = [];
const failedCaseIds = [];
const blockedCaseIds = [];
const harnessFailures = [];
let blocked = false;
let dependencyFailed = false;
if (importFailed) {
  failedCaseIds.push("HARNESS_IMPORT");
  caseResults.push({ id: "HARNESS_IMPORT", status: "FAIL", code: "HARNESS_IMPORT" });
} else {
  for (const item of cases) {
    const group = groupCounts.find((record) => record.id === item.group);
    if (blocked || dependencyFailed) { group.notExecuted += 1; caseResults.push({ id: item.id, status: "NOT_EXECUTED", code: blocked ? "DEPENDENCY_BLOCKED" : "DEPENDENCY_FAILED" }); continue; }
    group.executed += 1;
    try { await item.run(); group.passed += 1; caseResults.push({ id: item.id, status: "PASS", code: "OK" }); }
    catch (error) {
      if (error instanceof RequiredNativeBlocked) {
        blocked = true; group.blocked += 1; blockedCaseIds.push(item.id);
        caseResults.push({ id: item.id, status: "BLOCKED", code: error.code });
      } else {
        group.failed += 1; failedCaseIds.push(item.id); caseResults.push({ id: item.id, status: "FAIL", code: "ASSERTION_FAILED" });
        dependencyFailed = true;
      }
    }
  }
}
// Release only our own handles/workers. No filesystem object is deleted.
for (const session of sessions) {
  try { await closeSession(session); }
  catch { harnessFailures.push({ id: `HARNESS_CLOSE-${String(harnessFailures.length + 1).padStart(3, "0")}`, code: "HANDLE_CLOSE_UNCONFIRMED" }); }
}
const counts = {
  planned: cases.length + (importFailed ? 1 : 0),
  executed: groupCounts.reduce((sum, group) => sum + group.executed, 0) + (importFailed ? 1 : 0),
  passed: groupCounts.reduce((sum, group) => sum + group.passed, 0),
  failed: failedCaseIds.length,
  blocked: blockedCaseIds.length,
  notExecuted: groupCounts.reduce((sum, group) => sum + group.notExecuted, 0),
};
const status = counts.failed || harnessFailures.length ? "FAIL" : counts.blocked ? "BLOCKED" : "PASS";
process.stdout.write(`${JSON.stringify({ scope: SCOPE, status, counts, failedCaseIds, blockedCaseIds, harnessFailures, groupCounts, caseResults, evidenceRefs: [...evidenceRefs], compilerRefs: [...compilerRefs], cleanup: "NOT_EXECUTED" })}\n`);
process.exitCode = status === "PASS" ? 0 : status === "BLOCKED" ? 2 : 1;
