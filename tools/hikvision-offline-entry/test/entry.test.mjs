import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { types } from "node:util";

// Synthetic literals only. This driver does not read files, environment,
// credentials or sockets, create listeners, or launch child processes.
const SCOPE = "synthetic-offline-entry-tests";

function contextFixture() {
  return {
    versions: {
      tool: "558b9c864a4b820e397336200758b143556a4d87",
      checker: "31f20c9a372c447f142312f6e95e0400372f9ee8",
      adapter: "synthetic-binding-v1", endpoints: "hk-ai-08-six-get-v1",
    },
    output: { rootRef: "synthetic-root-1", policyRef: "synthetic-windows-acl-v1" },
  };
}

function inputFixture() {
  return {
    schemaVersion: "hk-ai-08-synthetic-binding-v1", dataClass: "synthetic-only",
    approvalRef: "synthetic-approval-1",
    approvedTarget: {
      deviceRef: "synthetic-device-1", host: " 192.0.2.10 ", port: "0443", model: "DS-K1T671BM",
    },
    candidate: {
      deviceRef: "synthetic-device-1", host: "192.0.2.10", allowedHosts: " 192.0.2.10 ",
      port: "443", allowedPorts: "0443", expectedModel: "DS-K1T671BM", allowRead: false,
    },
    execution: {
      tls: { mode: "fingerprint-pinned", fingerprints: ["A".repeat(64)], caBytes: [83, 89, 78, 84, 72] },
      limits: { timeoutMs: 1000, requestDeadlineMs: 2000, sessionDeadlineMs: 10000, maxBytes: 262144 },
      output: { rootRef: "synthetic-root-1", policyRef: "synthetic-windows-acl-v1" },
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

// Independently authored canonical execution expectation: no production
// projection, returned private object or normalizer supplies these values.
function expectedFixture() {
  return {
    target: { deviceRef: "synthetic-device-1", host: "192.0.2.10", port: 443, model: "DS-K1T671BM" },
    tls: { mode: "fingerprint-pinned", fingerprints: ["A".repeat(64)], caBytes: [83, 89, 78, 84, 72] },
    limits: { timeoutMs: 1000, requestDeadlineMs: 2000, sessionDeadlineMs: 10000, maxBytes: 262144 },
    output: { rootRef: "synthetic-root-1", policyRef: "synthetic-windows-acl-v1" },
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

function inertSnapshot(value, seen = new Map()) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return { primitive: value };
  if (types.isProxy(value)) return { proxy: value };
  if (typeof value === "function") return { function: value };
  if (seen.has(value)) return { reference: seen.get(value) };
  const index = seen.size;
  seen.set(value, index);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return {
    index, prototype: Object.getPrototypeOf(value),
    properties: Reflect.ownKeys(descriptors).map((key) => {
      const descriptor = descriptors[key];
      return {
        key, enumerable: descriptor.enumerable, configurable: descriptor.configurable,
        writable: descriptor.writable, get: descriptor.get, set: descriptor.set,
        value: Object.hasOwn(descriptor, "value") ? inertSnapshot(descriptor.value, seen) : null,
      };
    }),
  };
}

function trappedProxy(value, probe) {
  const hit = () => { probe.calls += 1; throw new Error("SYNTHETIC_TRAP"); };
  return new Proxy(value, { get: hit, ownKeys: hit, getOwnPropertyDescriptor: hit, getPrototypeOf: hit });
}

function getter(object, key, probe) {
  Object.defineProperty(object, key, {
    enumerable: true, configurable: true,
    get() { probe.calls += 1; throw new Error("SYNTHETIC_GETTER"); },
  });
}

const RESULT_SCOPE = "synthetic-offline-entry-only";
const GROUPS = ["LOADER", "BINDING", "FLOW", "AUTH", "PERMIT", "OUTPUT"];
const IDS = ["deviceInfo", "acsCapabilities", "userInfoCapabilities", "fdlibCapabilities", "fdlibList", "fdlibCount"];
const COMPARISONS = [
  "targetMatches", "tlsMatches", "limitsMatch", "outputMatches", "versionsMatch",
  "credentialsMatch", "endpointsMatch", "projectionMatches", "allowReadStayedFalse",
  "metadataFrozen", "privateBytesIsolated", "matched",
];
const cases = [];
const nextId = new Map(GROUPS.map((group) => [group, 0]));
function test(group, run) {
  const index = nextId.get(group) + 1;
  assert.equal(Number.isSafeInteger(index), true);
  nextId.set(group, index);
  cases.push({ group, id: `${group}-${String(index).padStart(3, "0")}`, run });
}

function pass(result) {
  assert.equal(result.scope, RESULT_SCOPE);
  assert.equal(result.status, "PASS");
  assert.equal(result.code, "OK");
  assert.equal(Object.isFrozen(result), true);
  if (Object.hasOwn(result, "summary") && result.summary !== null) {
    assertSummary(result.summary);
    assert.equal(result.summary.status, result.status);
    assert.equal(result.summary.code, result.code);
  }
  return result;
}

function rejected(result, code) {
  assert.equal(result.scope, RESULT_SCOPE);
  assert.equal(result.status, "FAIL");
  assert.notEqual(result.code, "INTERNAL_ERROR");
  if (code !== undefined) assert.equal(result.code, code);
  assert.equal(Object.isFrozen(result), true);
  if (Object.hasOwn(result, "summary") && result.summary !== null) {
    assertSummary(result.summary);
    assert.equal(result.summary.status, result.status);
    assert.equal(result.summary.code, result.code);
  }
  return result;
}

function responseFixture(endpointId, attempt = 1) {
  return {
    endpointId, attempt, status: 200, parseable: true, model: "DS-K1T671BM",
    capability: "confirmed", challenge: null, elapsedMs: 0,
  };
}

const responsesFixture = () => IDS.map((id) => responseFixture(id));
function challengeFixture() { return { algorithm: "SHA-256", qop: "auth" }; }
function challengedResponses(indices = [0]) {
  return IDS.flatMap((id, index) => {
    if (!indices.includes(index)) return [responseFixture(id)];
    const challenge = responseFixture(id);
    challenge.status = 401;
    challenge.challenge = challengeFixture();
    return [challenge, responseFixture(id, 2)];
  });
}

function transportState(entry, transport) {
  const state = pass(entry.observeTransport(transport));
  assert.deepEqual(Object.keys(state).sort(), ["scope", "status", "code", "calls", "trace", "last", "remainingResponses"].sort());
  assert.equal(Object.isFrozen(state.trace), true);
  assert.equal(state.calls, state.trace.length);
  for (const item of state.trace) {
    assert.deepEqual(Object.keys(item).sort(), ["endpointId", "attempt", "authenticated", "requestMatched"].sort());
    assert.equal(Object.isFrozen(item), true);
    assert.equal(IDS.includes(item.endpointId), true);
    assert.equal([1, 2].includes(item.attempt), true);
    assert.equal(item.authenticated, item.attempt === 2);
    assert.equal(typeof item.requestMatched, "boolean");
  }
  if (state.last !== null) {
    assert.deepEqual(Object.keys(state.last).sort(), [...COMPARISONS].sort());
    assert.equal(Object.isFrozen(state.last), true);
    for (const value of Object.values(state.last)) assert.equal(typeof value, "boolean");
  }
  return state;
}

function outputState(entry, output) {
  const state = pass(entry.observeOutput(output));
  assert.deepEqual(Object.keys(state).sort(), ["scope", "status", "code", "calls", "last"].sort());
  if (state.last !== null) assertSummary(state.last);
  return state;
}

function assertSummary(summary) {
  assert.deepEqual(Object.keys(summary).sort(), ["schemaVersion", "phase", "status", "code", "counts", "stages", "allowReadStayedFalse"].sort());
  assert.equal(summary.schemaVersion, "hk-ai-08-offline-summary-v1");
  assert.equal(summary.phase, "synthetic-offline-only");
  assert.equal(["PASS", "FAIL"].includes(summary.status), true);
  assert.equal(typeof summary.code, "string");
  assert.equal(summary.allowReadStayedFalse, true);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.counts), true);
  assert.equal(Object.isFrozen(summary.stages), true);
  assert.deepEqual(Object.keys(summary.counts).sort(), ["logicalEndpoints", "transmissions", "authRetries", "unknownEndpoints"].sort());
  for (const value of Object.values(summary.counts)) assert.equal(Number.isSafeInteger(value) && value >= 0, true);
  assert.equal(summary.stages.length, 6);
  summary.stages.forEach((stage, index) => {
    assert.equal(Object.isFrozen(stage), true);
    assert.deepEqual(Object.keys(stage).sort(), ["id", "state", "code", "httpStatus", "transmissions"].sort());
    assert.equal(stage.id, IDS[index]);
    assert.equal(["NOT_EXECUTED", "confirmed", "unsupported", "unknown", "blocked"].includes(stage.state), true);
    assert.equal(typeof stage.code, "string");
    assert.equal(stage.httpStatus === null || (Number.isInteger(stage.httpStatus) && stage.httpStatus >= 100 && stage.httpStatus <= 599), true);
    assert.equal(Number.isSafeInteger(stage.transmissions) && stage.transmissions >= 0 && stage.transmissions <= 2, true);
    if (stage.state === "NOT_EXECUTED") {
      assert.equal(stage.code, "NOT_EXECUTED");
      assert.equal(stage.httpStatus, null);
      assert.equal(stage.transmissions, 0);
    }
  });
  assert.equal(summary.counts.transmissions, summary.stages.reduce((sum, stage) => sum + stage.transmissions, 0));
  return summary;
}

let createSyntheticOfflineEntry;
try {
  ({ createSyntheticOfflineEntry } = await import("../src/entry.mjs"));
  assert.equal(typeof createSyntheticOfflineEntry, "function");
} catch {
  process.stdout.write(`${JSON.stringify({ scope: SCOPE, status: "FAIL", counts: { groups: 0, total: 1, passed: 0, failed: 1 }, failedCaseIds: ["HARNESS_IMPORT"], groupCounts: [] })}\n`);
  process.exitCode = 1;
}

function setup(options = {}) {
  const sourceContext = options.context || contextFixture();
  const entry = createSyntheticOfflineEntry(sourceContext);
  const bytes = options.bytes || inputBytes(options.input || inputFixture());
  const byteSnapshot = inertSnapshot(bytes);
  const prepared = pass(entry.prepareBytes(bytes));
  assert.deepEqual(inertSnapshot(bytes), byteSnapshot);
  const expected = options.expected || expectedFixture();
  const responses = options.responses || responsesFixture();
  const transport = pass(entry.createFakeTransport({ expected, responses })).fakeTransport;
  const output = pass(entry.createFakeOutput({ outcome: options.outcome || "success" })).fakeOutput;
  const grant = options.grant || grantFixture();
  const token = pass(entry.issueSyntheticPermit(prepared.binding, grant)).token;
  return { entry, bytes, prepared, binding: prepared.binding, expected, responses, transport, output, token, grant, sourceContext };
}

function notExecutedAfter(summary, count) {
  assertSummary(summary);
  for (const stage of summary.stages.slice(count)) assert.equal(stage.state, "NOT_EXECUTED");
}

async function injectAfterCalls(session, target, action) {
  const pending = session.entry.executeOffline(session.binding, session.token, session.transport, session.output);
  let injected = false;
  for (let index = 0; index < 512; index += 1) {
    if (transportState(session.entry, session.transport).calls >= target) {
      action();
      injected = true;
      break;
    }
    await Promise.resolve();
  }
  const result = await pending;
  assert.equal(injected, true);
  return result;
}

if (createSyntheticOfflineEntry) {
  // Exactly-at-limit valid bytes distinguish loader acceptance from a later
  // closed-schema rejection; no malformed object is used as the positive bound.
  test("LOADER", () => {
    const entry = createSyntheticOfflineEntry(contextFixture());
    const text = JSON.stringify(inputFixture());
    const bytes = bytesFromText(text + " ".repeat(65536 - bytesFromText(text).length));
    assert.equal(bytes.length, 65536);
    pass(entry.prepareBytes(bytes));
  });
  test("LOADER", () => {
    const entry = createSyntheticOfflineEntry(contextFixture());
    rejected(entry.prepareBytes(Array(65537).fill(32)), "INPUT_TOO_LARGE");
  });
  test("LOADER", () => {
    const entry = createSyntheticOfflineEntry(contextFixture());
    const bytes = [];
    bytes.length = 1000000000;
    const probe = { calls: 0 };
    getter(bytes, "0", probe);
    rejected(entry.prepareBytes(bytes), "INPUT_TOO_LARGE");
    assert.equal(probe.calls, 0);
  });
  test("LOADER", () => {
    const entry = createSyntheticOfflineEntry(contextFixture());
    pass(entry.prepareBytes(Object.freeze(inputBytes())));
  });

  const invalidByteInputs = [
    () => [], () => null, () => undefined, () => "SYNTHETIC_CONFIG_ONLY",
    () => inputFixture(), () => Buffer.from("SYNTHETIC_CONFIG_ONLY"),
    () => new Uint8Array(inputBytes()), () => new SharedArrayBuffer(8),
    () => [256], () => [-1], () => [1.5], () => [NaN], () => [Infinity],
    () => { const value = inputBytes(); delete value[0]; return value; },
    (_probe) => { const value = inputBytes(); Object.setPrototypeOf(value, null); return value; },
    (probe) => trappedProxy(inputBytes(), probe),
    (probe) => { const value = inputBytes(); getter(value, "0", probe); return value; },
    () => { const value = inputBytes(); value.extra = 1; return value; },
    () => { const value = inputBytes(); value[Symbol("synthetic-extra")] = true; return value; },
    () => { const value = inputBytes(); Object.defineProperty(value, "hidden", { value: true }); return value; },
    (probe) => { const value = inputBytes(); value.toJSON = () => { probe.calls += 1; return []; }; return value; },
  ];
  invalidByteInputs.forEach((make) => test("LOADER", () => {
    const entry = createSyntheticOfflineEntry(contextFixture());
    const probe = { calls: 0 };
    const source = make(probe);
    const before = inertSnapshot(source);
    const result = rejected(entry.prepareBytes(source), "INVALID_BYTES");
    assert.equal(result.binding, null);
    assert.equal(result.configBindingRef, null);
    assert.equal(result.checker, null);
    assert.deepEqual(inertSnapshot(source), before);
    assert.equal(probe.calls, 0);
  }));

  for (const bytes of [[0xc0, 0xaf], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xff], [0xf4, 0x90, 0x80, 0x80]]) {
    test("LOADER", () => rejected(createSyntheticOfflineEntry(contextFixture()).prepareBytes(bytes), "INVALID_UTF8"));
  }
  test("LOADER", () => rejected(createSyntheticOfflineEntry(contextFixture()).prepareBytes([0xef, 0xbb, 0xbf, ...inputBytes()]), "BOM_NOT_ALLOWED"));
  const invalidJson = [" ", "{} trailing", "[1,]", "{\"a\":1,}", "{\"a\":01}", "NaN", "Infinity", "1e999", '"\\uD800"', '"\\uDC00"', '"\\uD800x"'];
  invalidJson.forEach((text) => test("LOADER", () => rejected(createSyntheticOfflineEntry(contextFixture()).prepareBytes(bytesFromText(text)), "INVALID_JSON")));
  const duplicates = [
    '{"schemaVersion":1,"schemaVersion":2}',
    '{"schemaVersion":1,"schema\\u0056ersion":2}',
    '{"outer":{"password":1,"pass\\u0077ord":2}}',
    '{"__proto__":1,"\\u005f_proto__":2}',
  ];
  duplicates.forEach((text) => test("LOADER", () => rejected(createSyntheticOfflineEntry(contextFixture()).prepareBytes(bytesFromText(text)), "DUPLICATE_KEY")));
  test("LOADER", () => rejected(createSyntheticOfflineEntry(contextFixture()).prepareBytes(bytesFromText("[".repeat(17) + "0" + "]".repeat(17))), "INPUT_TOO_DEEP"));
  test("LOADER", () => {
    const result = rejected(createSyntheticOfflineEntry(contextFixture()).prepareBytes(bytesFromText("[".repeat(16) + "0" + "]".repeat(16))));
    assert.notEqual(result.code, "INPUT_TOO_DEEP");
    assert.notEqual(result.code, "INVALID_JSON");
  });
  for (const text of ['"\\uD83D\\uDE00"', "null", "false", "0", "[]", "{}"] ) {
    test("LOADER", () => {
      const result = rejected(createSyntheticOfflineEntry(contextFixture()).prepareBytes(bytesFromText(text)));
      assert.notEqual(result.code, "INVALID_JSON");
    });
  }
  const invalidConfig = [
    (input) => { delete input.candidate.port; },
    (input) => { input.candidate.port = ""; },
    (input) => { input.candidate.allowedPorts = "443,8443"; },
    (input) => { input.candidate.allowedHosts = "192.0.2.10,192.0.2.11"; },
    (input) => { input.execution.output.rootRef = "C:\\synthetic-path-is-not-a-ref"; },
    (input) => { input.execution.credentials.password = "not-a-synthetic-marker"; },
    (input) => { input.execution.endpoints[0].method = "POST"; },
    (input) => { input.execution.endpoints[0].path += "?extra=1"; },
    (input) => { input.execution.limits.timeoutMs = 0; },
    (input) => { input.execution.extra = true; },
    (input) => { input.schemaVersion = "unknown"; },
  ];
  invalidConfig.forEach((change) => test("LOADER", () => {
    const input = inputFixture(); change(input);
    const result = rejected(createSyntheticOfflineEntry(contextFixture()).prepareBytes(inputBytes(input)));
    assert.equal(result.binding, null);
  }));
  test("LOADER", () => {
    const input = inputFixture(); input.candidate.allowRead = true;
    const result = rejected(createSyntheticOfflineEntry(contextFixture()).prepareBytes(inputBytes(input)), "CHECKER_REJECTED");
    assert.equal(result.checker.code, "READ_NOT_DISABLED");
  });

  test("BINDING", async () => {
    const session = setup();
    const { entry, prepared, binding, token, transport, output } = session;
    assert.equal(Object.isFrozen(entry), true);
    assert.deepEqual(Object.keys(entry).sort(), ["prepareBytes", "createFakeTransport", "createFakeOutput", "issueSyntheticPermit", "revokeSyntheticPermit", "advanceSyntheticTime", "replaceSyntheticRuntime", "cancelSyntheticBinding", "executeOffline", "observeTransport", "observeOutput"].sort());
    assert.equal(entry.prepare, undefined);
    assert.equal(entry.executeSynthetic, undefined);
    for (const handle of [binding, token, transport, output]) {
      assert.equal(Object.getPrototypeOf(handle), null);
      assert.deepEqual(Reflect.ownKeys(handle), []);
      assert.equal(Object.isFrozen(handle), true);
    }
    assert.equal(prepared.checker.scope, "offline-format-and-match-only");
    assert.equal(prepared.checker.checks.allowReadDisabled, true);
    const result = pass(await entry.executeOffline(binding, token, transport, output));
    assert.equal(result.configBindingRef, prepared.configBindingRef);
    assertSummary(result.summary);
    assert.equal(transportState(entry, transport).last.matched, true);
  });
  test("BINDING", async () => {
    const session = setup();
    session.bytes.fill(0); session.bytes.length = 0;
    pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
    assert.equal(transportState(session.entry, session.transport).last.matched, true);
  });
  test("BINDING", async () => {
    const session = setup(); const probe = { calls: 0 };
    getter(session.bytes, "0", probe);
    pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
    assert.equal(probe.calls, 0);
  });
  test("BINDING", async () => {
    const session = setup();
    session.expected.target.host = "192.0.2.99";
    session.expected.credentials.password = "SYNTHETIC_CHANGED";
    session.expected.tls.caBytes.fill(0);
    session.responses[0].status = 500;
    session.responses[0].model = "SYNTHETIC_OTHER_MODEL";
    session.responses.reverse();
    session.grant.windowEnd = 0;
    session.sourceContext.output.rootRef = "synthetic-mutated-source";
    pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
    assert.equal(transportState(session.entry, session.transport).last.matched, true);
  });
  test("BINDING", async () => {
    const session = setup(); const probe = { calls: 0 };
    getter(session.expected, "target", probe);
    getter(session.responses, "0", probe);
    getter(session.grant, "approvalRef", probe);
    getter(session.sourceContext, "output", probe);
    pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
    assert.equal(probe.calls, 0);
  });

  const mismatches = [
    (view) => { view.target.deviceRef = "synthetic-device-other"; },
    (view) => { view.target.host = "192.0.2.11"; },
    (view) => { view.target.port = 8443; },
    (view) => { view.target.model = "SYNTHETIC_OTHER_MODEL"; },
    (view) => { view.tls.mode = "synthetic-other-mode"; },
    (view) => { view.tls.fingerprints = ["B".repeat(64)]; },
    (view) => { view.tls.caBytes[0] = 84; },
    (view) => { view.limits.timeoutMs = 999; },
    (view) => { view.limits.requestDeadlineMs = 1999; },
    (view) => { view.limits.sessionDeadlineMs = 9999; },
    (view) => { view.limits.maxBytes = 262143; },
    (view) => { view.output.rootRef = "synthetic-other-root"; },
    (view) => { view.output.policyRef = "synthetic-other-policy"; },
    (view) => { view.versions.tool = "0".repeat(40); },
    (view) => { view.versions.checker = "1".repeat(40); },
    (view) => { view.versions.adapter = "synthetic-other-adapter"; },
    (view) => { view.versions.endpoints = "synthetic-other-endpoints"; },
    (view) => { view.credentials.username = "SYNTHETIC_OTHER_USER"; },
    (view) => { view.credentials.password = "SYNTHETIC_OTHER_PASSWORD"; },
  ];
  for (let index = 0; index < 6; index += 1) for (const key of ["id", "method", "path", "expect"]) {
    mismatches.push((view) => { view.endpoints[index][key] += "SyntheticMismatch"; });
  }
  mismatches.forEach((change) => test("BINDING", async () => {
    const expected = expectedFixture(); change(expected);
    const session = setup({ expected });
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "FAKE_EXPECTATION_MISMATCH");
    assertSummary(result.summary);
    const observed = transportState(session.entry, session.transport);
    assert.equal(observed.calls, 1);
    assert.equal(observed.trace[0].requestMatched, false);
    assert.equal(observed.last.matched, false);
    assert.equal(observed.remainingResponses, 6);
    rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "PERMIT_USED");
    assert.equal(transportState(session.entry, session.transport).calls, 1);
  }));

  test("FLOW", async () => {
    const session = setup();
    const result = pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
    assertSummary(result.summary);
    assert.deepEqual(result.summary.counts, { logicalEndpoints: 6, transmissions: 6, authRetries: 0, unknownEndpoints: 0 });
    assert.deepEqual(result.summary.stages.map((stage) => stage.state), Array(6).fill("confirmed"));
    assert.deepEqual(result.summary.stages.map((stage) => stage.httpStatus), Array(6).fill(200));
    assert.deepEqual(result.summary.stages.map((stage) => stage.transmissions), Array(6).fill(1));
    const state = transportState(session.entry, session.transport);
    assert.deepEqual(state.trace, IDS.map((endpointId) => ({ endpointId, attempt: 1, authenticated: false, requestMatched: true })));
    assert.equal(state.remainingResponses, 0);
    assert.equal(outputState(session.entry, session.output).calls, 1);
    assert.deepEqual(outputState(session.entry, session.output).last, result.summary);
  });
  for (const status of [100, 204, 301, 403, 404, 500, 599]) test("FLOW", async () => {
    const responses = responsesFixture(); responses[0].status = status;
    const session = setup({ responses });
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "G1_HTTP_STATUS");
    assert.equal(transportState(session.entry, session.transport).calls, 1);
    notExecutedAfter(result.summary, 1);
    assert.equal(result.summary.stages[0].state, "blocked");
  });
  test("FLOW", async () => {
    const responses = responsesFixture(); responses[0].parseable = false;
    const session = setup({ responses });
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "G1_RESPONSE_INVALID");
    assert.equal(transportState(session.entry, session.transport).calls, 1); notExecutedAfter(result.summary, 1);
  });
  for (const model of ["SYNTHETIC_OTHER_MODEL", "SYNTHETIC_UNKNOWN_MODEL"]) test("FLOW", async () => {
    const responses = responsesFixture(); responses[0].model = model;
    const session = setup({ responses });
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "G1_MODEL_MISMATCH");
    assert.equal(transportState(session.entry, session.transport).calls, 1); notExecutedAfter(result.summary, 1);
  });
  for (const index of [1, 2, 3, 4, 5]) for (const status of [403, 404, 500]) test("FLOW", async () => {
    const responses = responsesFixture(); responses[index].status = status;
    const session = setup({ responses });
    const result = pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
    assertSummary(result.summary);
    assert.equal(result.summary.stages[index].state, "unknown");
    assert.equal(result.summary.stages[index].code, "HTTP_STATUS");
    assert.equal(result.summary.stages[index].httpStatus, status);
    assert.equal(result.summary.counts.unknownEndpoints, 1);
    assert.equal(transportState(session.entry, session.transport).calls, 6);
  });
  for (const index of [1, 2, 3, 4, 5]) test("FLOW", async () => {
    const responses = responsesFixture(); responses[index].parseable = false;
    responses[index].capability = "confirmed";
    const session = setup({ responses });
    const result = pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
    assert.equal(result.summary.stages[index].state, "unknown");
    assert.equal(result.summary.stages[index].code, "RESPONSE_INVALID");
    assert.equal(result.summary.counts.unknownEndpoints, 1);
  });
  for (const capability of ["unsupported", "unknown"]) test("FLOW", async () => {
    const responses = responsesFixture(); responses[3].capability = capability;
    const session = setup({ responses });
    const result = pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
    assert.equal(result.summary.stages[3].state, capability);
    assert.equal(result.summary.counts.unknownEndpoints, capability === "unknown" ? 1 : 0);
  });
  test("FLOW", async () => {
    const responses = responsesFixture(); responses[0].endpointId = "acsCapabilities";
    const session = setup({ responses });
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "FAKE_SCRIPT_MISMATCH");
    assert.equal(transportState(session.entry, session.transport).calls, 1);
    assert.equal(transportState(session.entry, session.transport).trace[0].requestMatched, false);
    notExecutedAfter(result.summary, 1);
  });
  test("FLOW", async () => {
    const responses = responsesFixture(); responses[0].attempt = 2;
    const session = setup({ responses });
    rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "FAKE_SCRIPT_MISMATCH");
    assert.equal(transportState(session.entry, session.transport).trace[0].authenticated, false);
  });
  test("FLOW", async () => {
    const session = setup({ responses: [responseFixture("deviceInfo")] });
    rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "FAKE_SCRIPT_EXHAUSTED");
    assert.equal(transportState(session.entry, session.transport).calls, 2);
  });
  test("FLOW", async () => {
    const responses = responsesFixture(); responses.push(responseFixture("deviceInfo"));
    const session = setup({ responses });
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "FAKE_SCRIPT_REMAINS");
    assert.equal(transportState(session.entry, session.transport).calls, 6);
    assert.deepEqual(result.summary.stages.map((stage) => stage.state), Array(6).fill("confirmed"));
    const stored = outputState(session.entry, session.output);
    assert.equal(stored.calls, 1);
    assert.equal(stored.last.status, "FAIL");
    assert.equal(stored.last.code, "FAKE_SCRIPT_REMAINS");
    assert.deepEqual(stored.last, result.summary);
  });

  for (const indices of [[0], [1], [2], [3], [4], [5], [0, 1, 2, 3, 4, 5]]) test("AUTH", async () => {
    const session = setup({ responses: challengedResponses(indices) });
    const result = pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
    assertSummary(result.summary);
    assert.equal(result.summary.counts.authRetries, indices.length);
    assert.equal(result.summary.counts.transmissions, 6 + indices.length);
    assert.equal(result.summary.counts.logicalEndpoints, 6);
    assert.equal(transportState(session.entry, session.transport).calls, 6 + indices.length);
    assert.equal(transportState(session.entry, session.transport).remainingResponses, 0);
    assert.equal(transportState(session.entry, session.transport).trace.filter((frame) => frame.authenticated).length, indices.length);
  });
  for (const index of [0, 1, 2, 3, 4, 5]) test("AUTH", async () => {
    const responses = challengedResponses([index]);
    const retry = responses.find((frame) => frame.endpointId === IDS[index] && frame.attempt === 2);
    retry.status = 401; retry.challenge = challengeFixture();
    const session = setup({ responses });
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "AUTH_RETRY_EXHAUSTED");
    assert.equal(transportState(session.entry, session.transport).calls, index + 2);
    notExecutedAfter(result.summary, index + 1);
  });
  const invalidChallenges = [
    null,
    { algorithm: "MD5", qop: "auth" },
    { algorithm: "unsupported", qop: "auth" },
    { algorithm: "malformed", qop: "auth" },
    { algorithm: "absent", qop: "auth" },
    { algorithm: "SHA-256", qop: "auth-int" },
    { algorithm: "SHA-256", qop: "unsupported" },
    { algorithm: "SHA-256", qop: "malformed" },
    { algorithm: "SHA-256", qop: "absent" },
  ];
  invalidChallenges.forEach((challenge) => test("AUTH", async () => {
    const responses = challengedResponses(); responses[0].challenge = challenge;
    const session = setup({ responses });
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "AUTH_CHALLENGE_REJECTED");
    assert.equal(transportState(session.entry, session.transport).calls, 1);
    assert.equal(result.summary.counts.authRetries, 0);
    notExecutedAfter(result.summary, 1);
  }));
  test("AUTH", async () => {
    const responses = challengedResponses(); responses[0].parseable = false;
    const session = setup({ responses });
    rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "AUTH_CHALLENGE_REJECTED");
    assert.equal(transportState(session.entry, session.transport).calls, 1);
  });

  for (const makeToken of [() => undefined, () => ({}), (token) => ({ ...token }), (token) => JSON.parse(JSON.stringify(token)), (token, probe) => trappedProxy(token, probe)]) test("PERMIT", async () => {
    const session = setup(); const probe = { calls: 0 };
    const result = rejected(await session.entry.executeOffline(session.binding, makeToken(session.token, probe), session.transport, session.output), "INVALID_PERMIT");
    assert.equal(result.summary, null);
    assert.equal(probe.calls, 0);
    assert.equal(transportState(session.entry, session.transport).calls, 0);
    assert.equal(outputState(session.entry, session.output).calls, 0);
    pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
  });
  test("PERMIT", async () => {
    const session = setup(); const other = setup();
    rejected(await session.entry.executeOffline(session.binding, other.token, session.transport, session.output), "INVALID_PERMIT");
    pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
  });
  for (const makeBinding of [
    () => ({}),
    (session) => ({ configBindingRef: session.prepared.configBindingRef }),
    (session) => JSON.parse(JSON.stringify(session.binding)),
    (session, probe) => trappedProxy(session.binding, probe),
    () => setup().binding,
  ]) test("PERMIT", async () => {
    const session = setup(); const probe = { calls: 0 };
    const forged = makeBinding(session, probe);
    const result = rejected(await session.entry.executeOffline(forged, session.token, session.transport, session.output), "INVALID_BINDING");
    assert.equal(result.configBindingRef, null);
    assert.equal(result.summary, null);
    assert.equal(probe.calls, 0);
    assert.equal(transportState(session.entry, session.transport).calls, 0);
    assert.equal(outputState(session.entry, session.output).calls, 0);
    pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
  });
  test("PERMIT", async () => {
    const session = setup(); const another = pass(session.entry.prepareBytes(inputBytes()));
    rejected(await session.entry.executeOffline(another.binding, session.token, session.transport, session.output), "PERMIT_BINDING_MISMATCH");
    assert.equal(transportState(session.entry, session.transport).calls, 0);
    pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
  });
  test("PERMIT", async () => {
    const session = setup();
    rejected(session.entry.issueSyntheticPermit(session.binding, grantFixture()), "PERMIT_ALREADY_ISSUED");
    pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
    rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "PERMIT_USED");
    assert.equal(transportState(session.entry, session.transport).calls, 6);
    assert.equal(outputState(session.entry, session.output).calls, 1);
  });
  test("PERMIT", async () => {
    const session = setup();
    const results = await Promise.all([session.entry.executeOffline(session.binding, session.token, session.transport, session.output), session.entry.executeOffline(session.binding, session.token, session.transport, session.output)]);
    assert.equal(results.filter((result) => result.status === "PASS").length, 1);
    assert.equal(results.filter((result) => result.code === "PERMIT_USED").length, 1);
    assert.equal(transportState(session.entry, session.transport).calls, 6);
    assert.equal(outputState(session.entry, session.output).calls, 1);
  });
  for (const [code, action] of [
    ["PERMIT_REVOKED", (session) => pass(session.entry.revokeSyntheticPermit(session.token))],
    ["SESSION_CANCELLED", (session) => pass(session.entry.cancelSyntheticBinding(session.binding))],
    ["PERMIT_EXPIRED", (session) => pass(session.entry.advanceSyntheticTime(100000))],
    ["CONTEXT_CHANGED", (session) => pass(session.entry.replaceSyntheticRuntime(contextFixture()))],
  ]) test("PERMIT", async () => {
    const session = setup();
    const pending = session.entry.executeOffline(session.binding, session.token, session.transport, session.output);
    action(session);
    const result = rejected(await pending, code);
    assertSummary(result.summary);
    assert.equal(transportState(session.entry, session.transport).calls, 0);
    assert.equal(outputState(session.entry, session.output).calls, 0);
    rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
  });
  for (const [code, action] of [
    ["PERMIT_REVOKED", (session) => pass(session.entry.revokeSyntheticPermit(session.token))],
    ["SESSION_CANCELLED", (session) => pass(session.entry.cancelSyntheticBinding(session.binding))],
    ["PERMIT_EXPIRED", (session) => pass(session.entry.advanceSyntheticTime(100000))],
    ["CONTEXT_CHANGED", (session) => pass(session.entry.replaceSyntheticRuntime(contextFixture()))],
  ]) for (const target of [1, 3, 6]) test("PERMIT", async () => {
    const session = setup();
    const result = rejected(await injectAfterCalls(session, target, () => action(session)), code);
    assertSummary(result.summary);
    assert.equal(transportState(session.entry, session.transport).calls, target);
    assert.equal(outputState(session.entry, session.output).calls, 0);
    rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
  });
  for (const [code, action] of [
    ["PERMIT_REVOKED", (session) => pass(session.entry.revokeSyntheticPermit(session.token))],
    ["SESSION_CANCELLED", (session) => pass(session.entry.cancelSyntheticBinding(session.binding))],
    ["PERMIT_EXPIRED", (session) => pass(session.entry.advanceSyntheticTime(100000))],
    ["CONTEXT_CHANGED", (session) => pass(session.entry.replaceSyntheticRuntime(contextFixture()))],
  ]) test("PERMIT", async () => {
    const session = setup({ responses: challengedResponses() });
    rejected(await injectAfterCalls(session, 1, () => action(session)), code);
    assert.equal(transportState(session.entry, session.transport).calls, 1);
    assert.equal(transportState(session.entry, session.transport).trace.some((frame) => frame.attempt === 2), false);
    assert.equal(outputState(session.entry, session.output).calls, 0);
  });
  test("PERMIT", async () => {
    const grant = grantFixture(); grant.windowStart = 5;
    const session = setup({ grant });
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "PERMIT_NOT_YET_VALID");
    assert.equal(result.summary, null);
    pass(session.entry.advanceSyntheticTime(5));
    pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
  });
  test("PERMIT", async () => {
    const session = setup(); pass(session.entry.revokeSyntheticPermit(session.token));
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "PERMIT_REVOKED");
    assert.equal(result.summary, null);
    assert.equal(transportState(session.entry, session.transport).calls, 0);
  });
  test("PERMIT", async () => {
    const session = setup(); pass(session.entry.advanceSyntheticTime(100000));
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "PERMIT_EXPIRED");
    assert.equal(result.summary, null);
    assert.equal(transportState(session.entry, session.transport).calls, 0);
    assert.equal(outputState(session.entry, session.output).calls, 0);
  });
  test("PERMIT", () => {
    const entry = createSyntheticOfflineEntry(contextFixture());
    const prepared = pass(entry.prepareBytes(inputBytes()));
    pass(entry.cancelSyntheticBinding(prepared.binding));
    rejected(entry.issueSyntheticPermit(prepared.binding, grantFixture()), "SESSION_CANCELLED");
  });
  test("PERMIT", () => {
    const entry = createSyntheticOfflineEntry(contextFixture());
    rejected(entry.cancelSyntheticBinding({}), "INVALID_BINDING");
  });
  test("PERMIT", () => {
    const entry = createSyntheticOfflineEntry(contextFixture());
    const prepared = pass(entry.prepareBytes(inputBytes()));
    const grant = grantFixture(); grant.approvalValid = true;
    rejected(entry.issueSyntheticPermit(prepared.binding, grant), "INVALID_INPUT");
    pass(entry.issueSyntheticPermit(prepared.binding, grantFixture()));
  });
  const runtimeChanges = [
    (context) => { context.versions.tool = "0".repeat(40); },
    (context) => { context.versions.checker = "1".repeat(40); },
    (context) => { context.versions.adapter = "synthetic-binding-v2"; },
    (context) => { context.versions.endpoints = "synthetic-endpoints-v2"; },
    (context) => { context.output.rootRef = "synthetic-root-v2"; },
    (context) => { context.output.policyRef = "synthetic-policy-v2"; },
  ];
  runtimeChanges.forEach((change) => test("PERMIT", async () => {
    const session = setup(); const context = contextFixture(); change(context);
    pass(session.entry.replaceSyntheticRuntime(context));
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "CONTEXT_CHANGED");
    assert.equal(result.summary, null);
    assert.equal(transportState(session.entry, session.transport).calls, 0);
    assert.equal(outputState(session.entry, session.output).calls, 0);
  }));
  test("PERMIT", async () => {
    const session = setup(); const context = contextFixture(); context.versions.adapter = "synthetic-binding-v2";
    pass(session.entry.replaceSyntheticRuntime(context));
    pass(session.entry.replaceSyntheticRuntime(contextFixture()));
    rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "CONTEXT_CHANGED");
    assert.equal(transportState(session.entry, session.transport).calls, 0);
  });
  for (const [elapsed, code] of [[10000, "SESSION_DEADLINE_EXCEEDED"], [2000, "REQUEST_DEADLINE_EXCEEDED"], [1000, "INACTIVITY_TIMEOUT"]]) test("PERMIT", async () => {
    const responses = responsesFixture(); responses[0].elapsedMs = elapsed;
    const session = setup({ responses });
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), code);
    assertSummary(result.summary);
    assert.equal(transportState(session.entry, session.transport).calls, 1);
    rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "PERMIT_USED");
  });
  test("PERMIT", async () => {
    const input = inputFixture(); input.execution.limits.sessionDeadlineMs = 5000;
    const expected = expectedFixture(); expected.limits.sessionDeadlineMs = 5000;
    const responses = responsesFixture(); for (const frame of responses) frame.elapsedMs = 999;
    const session = setup({ input, expected, responses });
    rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "SESSION_DEADLINE_EXCEEDED");
    assert.equal(transportState(session.entry, session.transport).calls, 6);
  });
  test("PERMIT", async () => {
    const responses = responsesFixture(); responses[0].elapsedMs = 6;
    const grant = grantFixture(); grant.windowEnd = Number.MAX_SAFE_INTEGER;
    const session = setup({ grant, responses });
    pass(session.entry.advanceSyntheticTime(Number.MAX_SAFE_INTEGER - 5));
    rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "CLOCK_OVERFLOW");
    assert.equal(transportState(session.entry, session.transport).calls, 1);
  });
  test("PERMIT", async () => {
    const session = setup();
    pass(session.entry.advanceSyntheticTime(5));
    rejected(session.entry.advanceSyntheticTime(4), "CLOCK_ROLLBACK");
    rejected(session.entry.advanceSyntheticTime(-1), "INVALID_TIME");
    rejected(session.entry.advanceSyntheticTime(NaN), "INVALID_TIME");
    pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
  });

  for (const outcome of ["fail", "throw"]) test("OUTPUT", async () => {
    const session = setup({ outcome });
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "FAKE_OUTPUT_FAILED");
    assertSummary(result.summary);
    assert.equal(transportState(session.entry, session.transport).calls, 6);
    assert.equal(outputState(session.entry, session.output).calls, 1);
    const attempted = outputState(session.entry, session.output).last;
    assert.equal(attempted.status, "PASS");
    assert.equal(attempted.code, "OK");
    assert.equal(result.summary.status, "FAIL");
    assert.equal(result.summary.code, "FAKE_OUTPUT_FAILED");
    assert.deepEqual(attempted.counts, result.summary.counts);
    assert.deepEqual(attempted.stages, result.summary.stages);
    rejected(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output), "PERMIT_USED");
    assert.equal(outputState(session.entry, session.output).calls, 1);
  });
  test("OUTPUT", async () => {
    const session = setup();
    const result = pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
    const text = JSON.stringify([session.prepared, result, transportState(session.entry, session.transport), outputState(session.entry, session.output)]);
    for (const secret of ["192.0.2.10", "SYNTHETIC_USER", "SYNTHETIC_PASSWORD", "A".repeat(64), "83,89,78,84,72", "synthetic-root-1", "SYNTHETIC_REALM", "Authorization"]) assert.equal(text.includes(secret), false);
    assert.equal(Reflect.set(result.summary.counts, "transmissions", 999), false);
    assert.equal(Reflect.set(outputState(session.entry, session.output).last.stages[0], "id", "other"), false);
  });

  for (const field of ["transport", "output"]) for (const make of [() => ({}), (value) => ({ ...value }), (value) => JSON.parse(JSON.stringify(value)), (value, probe) => trappedProxy(value, probe), () => () => { throw new Error("SYNTHETIC_CALLBACK_MUST_NOT_RUN"); }]) test("OUTPUT", async () => {
    const session = setup(); const probe = { calls: 0 };
    const forged = make(session[field], probe);
    const transport = field === "transport" ? forged : session.transport;
    const output = field === "output" ? forged : session.output;
    const result = rejected(await session.entry.executeOffline(session.binding, session.token, transport, output), field === "transport" ? "INVALID_TRANSPORT" : "INVALID_OUTPUT");
    assert.equal(result.summary, null); assert.equal(probe.calls, 0);
    assert.equal(transportState(session.entry, session.transport).calls, 0);
    assert.equal(outputState(session.entry, session.output).calls, 0);
    pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
  });
  for (const field of ["transport", "output"]) test("OUTPUT", async () => {
    const session = setup(); const other = setup();
    rejected(await session.entry.executeOffline(session.binding, session.token, field === "transport" ? other.transport : session.transport, field === "output" ? other.output : session.output), field === "transport" ? "INVALID_TRANSPORT" : "INVALID_OUTPUT");
    pass(await session.entry.executeOffline(session.binding, session.token, session.transport, session.output));
  });
  const badScripts = [
    (_frames) => [],
    (frames) => [...frames, ...frames, frames[0]],
    (frames) => { frames[0].endpointId = "unknown"; return frames; },
    (frames) => { frames[0].attempt = 3; return frames; },
    (frames) => { frames[0].status = 99; return frames; },
    (frames) => { frames[0].status = 600; return frames; },
    (frames) => { frames[0].parseable = "true"; return frames; },
    (frames) => { frames[0].model = "not-an-allowed-model"; return frames; },
    (frames) => { frames[0].capability = "implicit-zero"; return frames; },
    (frames) => { frames[0].challenge = challengeFixture(); return frames; },
    (frames) => { frames[0].elapsedMs = -1; return frames; },
    (frames) => { frames[0].elapsedMs = 600001; return frames; },
    (frames) => { frames[0].rawError = "SYNTHETIC_DO_NOT_PRINT"; return frames; },
    (frames) => { delete frames[0].elapsedMs; return frames; },
    (frames) => { delete frames[0]; return frames; },
    (frames, probe) => { getter(frames[0], "status", probe); return frames; },
    (frames, probe) => trappedProxy(frames, probe),
    (frames, probe) => { frames[0] = trappedProxy(frames[0], probe); return frames; },
  ];
  badScripts.forEach((change) => test("OUTPUT", () => {
    const entry = createSyntheticOfflineEntry(contextFixture()); const probe = { calls: 0 };
    const responses = change(responsesFixture(), probe);
    const before = inertSnapshot(responses);
    const result = rejected(entry.createFakeTransport({ expected: expectedFixture(), responses }), "INVALID_INPUT");
    assert.equal(result.fakeTransport, null);
    assert.deepEqual(inertSnapshot(responses), before);
    assert.equal(probe.calls, 0);
    assert.equal(JSON.stringify(result).includes("SYNTHETIC_DO_NOT_PRINT"), false);
  }));
  for (const make of [
    () => ({ outcome: "other" }),
    () => ({ outcome: "success", extra: true }),
    (probe) => { const value = { outcome: "success" }; getter(value, "outcome", probe); return value; },
    (probe) => trappedProxy({ outcome: "success" }, probe),
  ]) test("OUTPUT", () => {
    const entry = createSyntheticOfflineEntry(contextFixture()); const probe = { calls: 0 };
    const result = rejected(entry.createFakeOutput(make(probe)), "INVALID_INPUT");
    assert.equal(result.fakeOutput, null); assert.equal(probe.calls, 0);
  });

  const failedCaseIds = [];
  const groupCounts = GROUPS.map((id) => ({ id, total: 0, passed: 0, failed: 0 }));
  const uniqueIds = new Set();
  for (const item of cases) {
    const group = groupCounts.find((record) => record.id === item.group);
    if (!group || uniqueIds.has(item.id)) { failedCaseIds.push("HARNESS_REGISTRATION"); continue; }
    uniqueIds.add(item.id);
    group.total += 1;
    try { await item.run(); group.passed += 1; }
    catch { failedCaseIds.push(item.id); group.failed += 1; }
  }
  const failed = failedCaseIds.length;
  process.stdout.write(`${JSON.stringify({ scope: SCOPE, status: failed === 0 ? "PASS" : "FAIL", counts: { groups: groupCounts.length, total: cases.length, passed: cases.length - failed, failed }, failedCaseIds, groupCounts })}\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}
