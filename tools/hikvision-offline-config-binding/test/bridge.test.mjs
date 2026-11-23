import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { types } from "node:util";

// All configuration and expectations in this file are synthetic literals.
// No environment, file, credential, transport, listener or process is read/run.
const SCOPE = "synthetic-config-binding-cb01-cb06-tests";
const RESULT_SCOPE = "synthetic-config-binding-only";
const GROUPS = ["CB-01", "CB-02", "CB-03", "CB-04", "CB-05", "CB-06"];

function contextFixture() {
  return {
    versions: {
      tool: "558b9c864a4b820e397336200758b143556a4d87",
      checker: "31f20c9a372c447f142312f6e95e0400372f9ee8",
      adapter: "synthetic-binding-v1",
      endpoints: "hk-ai-08-six-get-v1",
    },
    output: { rootRef: "synthetic-root-1", policyRef: "synthetic-windows-acl-v1" },
  };
}

function inputFixture() {
  return {
    schemaVersion: "hk-ai-08-synthetic-binding-v1",
    dataClass: "synthetic-only",
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

// Written independently from the raw input: no production projection, binding,
// normalization helper or returned private object constructs this expectation.
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
  return { scope: "synthetic-fake-execution-only", approvalRef: "synthetic-approval-1", windowStart: 0, windowEnd: 10 };
}

function pass(result) {
  assert.equal(result.scope, RESULT_SCOPE);
  assert.equal(result.status, "PASS");
  assert.equal(result.code, "OK");
  assert.equal(Object.isFrozen(result), true);
  return result;
}

function rejected(result, code) {
  assert.equal(result.scope, RESULT_SCOPE);
  assert.equal(result.status, "FAIL");
  if (code !== undefined) assert.equal(result.code, code);
  assert.equal(Object.isFrozen(result), true);
  return result;
}

function observe(bridge, fake) {
  const result = pass(bridge.observeFake(fake));
  assert.deepEqual(Object.keys(result).sort(), ["scope", "status", "code", "calls", "last"].sort());
  if (result.last !== null) {
    assert.deepEqual(Object.keys(result.last).sort(), [
      "targetMatches", "tlsMatches", "limitsMatch", "outputMatches", "versionsMatch",
      "credentialsMatch", "endpointsMatch", "projectionMatches", "allowReadStayedFalse",
      "metadataFrozen", "privateBytesIsolated", "matched",
    ].sort());
    for (const value of Object.values(result.last)) assert.equal(typeof value, "boolean");
    assert.equal(Object.isFrozen(result.last), true);
  }
  return result;
}

function assertMatched(bridge, fake, calls = 1) {
  const result = observe(bridge, fake);
  assert.equal(result.calls, calls);
  for (const value of Object.values(result.last)) assert.equal(value, true);
  return result;
}

// Descriptor snapshots never evaluate getters, invoke toJSON, or inspect Proxy
// traps. Getter/setter/function identities and hidden/symbol keys are retained.
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

function nullRecords(value) {
  if (Array.isArray(value)) return value.map(nullRecords);
  if (value === null || typeof value !== "object") return value;
  const result = Object.create(null);
  for (const [key, nested] of Object.entries(value)) result[key] = nullRecords(nested);
  return result;
}

const cases = [];
const ids = new Set();
function test(id, run) {
  assert.equal(ids.has(id), false);
  ids.add(id);
  cases.push({ id, group: id.slice(0, 5), run });
}

let createSyntheticBindingBridge;
try {
  ({ createSyntheticBindingBridge } = await import("../src/bridge.mjs"));
  assert.equal(typeof createSyntheticBindingBridge, "function");
} catch {
  process.stdout.write(`${JSON.stringify({ scope: SCOPE, status: "FAIL", counts: { groups: 6, total: 1, passed: 0, failed: 1 }, failedCaseIds: ["HARNESS_IMPORT"], groupCounts: [] })}\n`);
  process.exitCode = 1;
}

function setup(options = {}) {
  const bridge = createSyntheticBindingBridge(options.context || contextFixture());
  const input = options.input || inputFixture();
  const before = inertSnapshot(input);
  const prepared = pass(bridge.prepare(input));
  assert.deepEqual(inertSnapshot(input), before);
  const fake = pass(bridge.createFakeExecutor({ expected: options.expected || expectedFixture(), outcome: options.outcome || "success" })).fakeExecutor;
  const permit = pass(bridge.issueSyntheticPermit(prepared.binding, options.grant || grantFixture())).token;
  return { bridge, input, prepared, binding: prepared.binding, fake, permit };
}

if (createSyntheticBindingBridge) {
  test("CB-01.01", async () => {
    const { bridge, prepared, binding, fake, permit } = setup();
    assert.equal(Object.isFrozen(bridge), true);
    assert.deepEqual(Object.keys(bridge).sort(), [
      "prepare", "createFakeExecutor", "issueSyntheticPermit", "executeSynthetic",
      "revokeSyntheticPermit", "advanceSyntheticTime", "replaceSyntheticRuntime", "observeFake",
    ].sort());
    assert.deepEqual(Object.keys(prepared).sort(), ["scope", "status", "code", "binding", "configBindingRef", "checker"].sort());
    assert.equal(Object.getPrototypeOf(binding), null);
    assert.equal(Object.getPrototypeOf(permit), null);
    assert.deepEqual(Reflect.ownKeys(binding), []);
    assert.deepEqual(Reflect.ownKeys(permit), []);
    assert.equal(Object.isFrozen(binding), true);
    assert.equal(Object.isFrozen(permit), true);
    assert.equal(typeof prepared.configBindingRef, "string");
    assert.ok(prepared.configBindingRef.length > 0);
    assert.equal(prepared.checker.scope, "offline-format-and-match-only");
    assert.equal(prepared.checker.status, "PASS");
    assert.equal(prepared.checker.checks.allowReadDisabled, true);
    assert.equal(prepared.checker.checks.submittedTargetCount, 1);
    assert.equal(prepared.checker.checks.allowedHostCount, 1);
    assert.equal(prepared.checker.checks.allowedPortCount, 1);
    const executed = pass(await bridge.executeSynthetic(binding, permit, fake));
    assert.equal(executed.fakeCalls, 1);
    assert.equal(executed.configBindingRef, prepared.configBindingRef);
    assertMatched(bridge, fake);
  });

  test("CB-01.02", async () => {
    const input = nullRecords(inputFixture());
    const { bridge, binding, fake, permit } = setup({ input, context: nullRecords(contextFixture()) });
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assertMatched(bridge, fake);
  });

  test("CB-01.03", async () => {
    const input = inputFixture();
    input.approvedTarget.host = " EXAMPLE.INVALID ";
    input.candidate.host = "example.invalid";
    input.candidate.allowedHosts = " EXAMPLE.INVALID ";
    const expected = expectedFixture();
    expected.target.host = "example.invalid";
    const { bridge, binding, fake, permit } = setup({ input, expected });
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assertMatched(bridge, fake);
  });

  const mismatches = [
    ["targetMatches", (view) => { view.target.host = "192.0.2.11"; }],
    ["targetMatches", (view) => { view.target.port = 8443; }],
    ["targetMatches", (view) => { view.target.deviceRef = "synthetic-device-other"; }],
    ["targetMatches", (view) => { view.target.model = "SYNTHETIC_OTHER_MODEL"; }],
    ["tlsMatches", (view) => { view.tls.mode = "synthetic-other-mode"; }],
    ["tlsMatches", (view) => { view.tls.fingerprints = ["B".repeat(64)]; }],
    ["tlsMatches", (view) => { view.tls.caBytes[0] = 84; }],
    ["limitsMatch", (view) => { view.limits.timeoutMs = 999; }],
    ["limitsMatch", (view) => { view.limits.requestDeadlineMs = 1999; }],
    ["limitsMatch", (view) => { view.limits.sessionDeadlineMs = 9999; }],
    ["limitsMatch", (view) => { view.limits.maxBytes = 262143; }],
    ["outputMatches", (view) => { view.output.rootRef = "synthetic-root-other"; }],
    ["outputMatches", (view) => { view.output.policyRef = "synthetic-policy-other"; }],
    ["versionsMatch", (view) => { view.versions.tool = "0".repeat(40); }],
    ["versionsMatch", (view) => { view.versions.checker = "1".repeat(40); }],
    ["versionsMatch", (view) => { view.versions.adapter = "synthetic-binding-v2"; }],
    ["versionsMatch", (view) => { view.versions.endpoints = "hk-ai-08-six-get-other"; }],
    ["credentialsMatch", (view) => { view.credentials.username = "SYNTHETIC_OTHER_USER"; }],
    ["credentialsMatch", (view) => { view.credentials.password = "SYNTHETIC_WRONG"; }],
  ];
  // Every position and field is a separate negative control. These mutations
  // alter only the fake's expected view; prepare retains its exact six GETs.
  for (let endpointIndex = 0; endpointIndex < 6; endpointIndex += 1) {
    for (const field of ["id", "method", "path", "expect"]) {
      mismatches.push(["endpointsMatch", (view) => {
        view.endpoints[endpointIndex][field] += "SyntheticMismatch";
      }]);
    }
  }
  mismatches.forEach(([flag, change], index) => test(`CB-01.${String(index + 4).padStart(2, "0")}`, async () => {
    const expected = expectedFixture();
    change(expected);
    const { bridge, binding, fake, permit } = setup({ expected });
    const result = rejected(await bridge.executeSynthetic(binding, permit, fake), "FAKE_EXPECTATION_MISMATCH");
    assert.equal(result.fakeCalls, 1);
    const observed = observe(bridge, fake);
    assert.equal(observed.calls, 1);
    assert.equal(observed.last[flag], false);
    assert.equal(observed.last.matched, false);
    for (const [key, value] of Object.entries(observed.last)) {
      if (key !== flag && key !== "matched") assert.equal(value, true);
    }
    rejected(await bridge.executeSynthetic(binding, permit, fake), "PERMIT_USED");
    assert.equal(observe(bridge, fake).calls, 1);
  }));

  test("CB-02.01", async () => {
    const { bridge, input, binding, fake, permit } = setup();
    input.approvedTarget.host = "192.0.2.99";
    input.approvedTarget.port = "8443";
    input.candidate.host = "203.0.113.3";
    input.candidate.allowedHosts = "203.0.113.3";
    input.candidate.allowRead = true;
    input.execution.output.rootRef = "synthetic-replaced-root";
    input.execution.versions.tool = "0".repeat(40);
    input.execution.credentials.password = "SYNTHETIC_CHANGED";
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assertMatched(bridge, fake);
  });

  test("CB-02.02", async () => {
    const { bridge, input, binding, fake, permit } = setup();
    input.execution.tls.caBytes.fill(0);
    input.execution.tls.caBytes.length = 0;
    input.execution.tls.fingerprints[0] = "B".repeat(64);
    input.execution.endpoints[0].method = "POST";
    input.execution.endpoints.reverse();
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assertMatched(bridge, fake);
  });

  test("CB-02.03", async () => {
    const expected = expectedFixture();
    const { bridge, binding, fake, permit } = setup({ expected });
    expected.target.host = "192.0.2.99";
    expected.tls.caBytes.fill(0);
    expected.tls.fingerprints[0] = "B".repeat(64);
    expected.credentials.password = "SYNTHETIC_CHANGED";
    expected.endpoints[0].path = "/ISAPI/System/deviceInfoOther";
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assertMatched(bridge, fake);
  });

  test("CB-02.04", async () => {
    const { bridge, binding, prepared, fake, permit } = setup();
    assert.equal(Reflect.set(binding, "configBindingRef", prepared.configBindingRef), false);
    assert.equal(Reflect.set(permit, "used", false), false);
    assert.equal(Reflect.set(prepared.checker, "status", "FAIL"), false);
    assert.equal(Reflect.set(prepared.checker.checks, "allowReadDisabled", false), false);
    pass(await bridge.executeSynthetic(binding, permit, fake));
    const result = assertMatched(bridge, fake);
    assert.equal(result.last.privateBytesIsolated, true);
    assert.equal(result.last.metadataFrozen, true);
  });

  test("CB-02.05", async () => {
    const sourceContext = contextFixture();
    const bridge = createSyntheticBindingBridge(sourceContext);
    sourceContext.versions.tool = "0".repeat(40);
    sourceContext.output.rootRef = "synthetic-mutated-source";
    const prepared = pass(bridge.prepare(inputFixture()));
    const fake = pass(bridge.createFakeExecutor({ expected: expectedFixture(), outcome: "success" })).fakeExecutor;
    const token = pass(bridge.issueSyntheticPermit(prepared.binding, grantFixture())).token;
    pass(await bridge.executeSynthetic(prepared.binding, token, fake));
    assertMatched(bridge, fake);
  });

  test("CB-02.06", async () => {
    const { bridge, binding, prepared, fake, permit } = setup();
    const result = pass(await bridge.executeSynthetic(binding, permit, fake));
    const publicText = JSON.stringify([prepared, result, observe(bridge, fake)]);
    for (const value of ["192.0.2.10", "SYNTHETIC_USER", "SYNTHETIC_PASSWORD", "A".repeat(64), "83,89,78,84,72", "synthetic-root-1"]) {
      assert.equal(publicText.includes(value), false);
    }
    assert.equal(publicText.includes("approvalValid"), false);
    assert.equal(publicText.includes("sameConfigBound"), false);
  });

  test("CB-03.01", async () => {
    const { bridge, input, binding, fake, permit } = setup();
    const probe = { calls: 0 };
    for (const key of Object.keys(input)) getter(input, key, probe);
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assert.equal(probe.calls, 0);
    assertMatched(bridge, fake);
  });

  test("CB-03.02", async () => {
    const { bridge, input, binding, fake, permit } = setup();
    const probe = { calls: 0 };
    for (const [record, key] of [
      [input.approvedTarget, "host"], [input.candidate, "host"], [input.candidate, "allowedHosts"],
      [input.candidate, "allowRead"], [input.execution.tls, "caBytes"], [input.execution.tls, "fingerprints"],
      [input.execution.output, "rootRef"], [input.execution.versions, "tool"],
      [input.execution.credentials, "password"], [input.execution, "endpoints"],
    ]) getter(record, key, probe);
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assert.equal(probe.calls, 0);
    assertMatched(bridge, fake);
  });

  test("CB-03.03", async () => {
    const { bridge, input, binding, fake, permit } = setup();
    const probe = { calls: 0 };
    getter(input.execution.tls.caBytes, "0", probe);
    getter(input.execution.tls.fingerprints, "0", probe);
    getter(input.execution.endpoints, "0", probe);
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assert.equal(probe.calls, 0);
    assertMatched(bridge, fake);
  });

  test("CB-03.04", async () => {
    const grant = grantFixture();
    const { bridge, binding, fake, permit } = setup({ grant });
    const probe = { calls: 0 };
    for (const key of Object.keys(grant)) getter(grant, key, probe);
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assert.equal(probe.calls, 0);
    assertMatched(bridge, fake);
  });

  test("CB-03.05", async () => {
    const expected = expectedFixture();
    const { bridge, binding, fake, permit } = setup({ expected });
    const probe = { calls: 0 };
    getter(expected.target, "host", probe);
    getter(expected.tls, "caBytes", probe);
    getter(expected.credentials, "password", probe);
    getter(expected, "endpoints", probe);
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assert.equal(probe.calls, 0);
    assertMatched(bridge, fake);
  });

  const invalidInputs = [
    (input, probe) => trappedProxy(input, probe),
    (input, probe) => { input.candidate = trappedProxy(input.candidate, probe); return input; },
    (input, probe) => { getter(input, "execution", probe); return input; },
    (input, probe) => { getter(input.candidate, "host", probe); return input; },
    (input) => { input[Symbol("synthetic-extra")] = true; return input; },
    (input) => { Object.defineProperty(input, "hidden", { value: true, enumerable: false }); return input; },
    (input, probe) => { input.toJSON = () => { probe.calls += 1; return {}; }; return input; },
    (input, probe) => { const prototype = {}; getter(prototype, "inherited", probe); Object.setPrototypeOf(input, prototype); return input; },
    (input) => { Object.setPrototypeOf(input.execution.limits, { bad: true }); return input; },
    (input) => { delete input.execution.tls.caBytes[0]; return input; },
    (input, probe) => { getter(input.execution.tls.caBytes, "0", probe); return input; },
    (input, probe) => { input.execution.tls.caBytes.toJSON = () => { probe.calls += 1; return []; }; return input; },
    (input) => { input.execution.tls.caBytes[Symbol("synthetic-extra")] = 1; return input; },
    (input) => { delete input.execution.endpoints[0]; return input; },
    (input) => { delete input.execution.tls.fingerprints[0]; return input; },
    (input) => { input.execution.tls.caBytes = Buffer.from([83, 89, 78]); return input; },
    (input) => { input.execution.tls.caBytes = new Uint8Array([83, 89, 78]); return input; },
    (input) => { input.execution.tls.caBytes = new SharedArrayBuffer(3); return input; },
    (input) => { input.approvedTarget = [input.approvedTarget]; return input; },
    (input) => { input.candidate.allowedHosts = "192.0.2.10,192.0.2.11"; return input; },
    (input) => { input.approvedTarget.port = ""; return input; },
    (input) => { delete input.candidate.port; return input; },
    (input) => { input.candidate.allowRead = true; return input; },
    (input) => { input.approvedTarget.host = "K.example.invalid"; input.candidate.host = "K.example.invalid"; input.candidate.allowedHosts = "K.example.invalid"; return input; },
    (input) => { input.candidate.port = " 443"; return input; },
    (input) => { input.candidate.expectedModel = "DS-K1T671BM "; return input; },
    (input) => { input.execution.limits.timeoutMs = 0; return input; },
    (input) => { input.execution.limits.requestDeadlineMs = 999; return input; },
    (input) => { input.execution.limits.maxBytes = 262145; return input; },
    (input) => { input.execution.limits.sessionDeadlineMs = 600001; return input; },
    (input) => { delete input.execution.limits.maxBytes; return input; },
    (input) => { input.execution.tls.mode = "system-store"; return input; },
    (input) => { input.execution.tls.fingerprints = ["A".repeat(64), "A".repeat(64)]; return input; },
    (input) => { input.execution.tls.fingerprints = ["a".repeat(64)]; return input; },
    (input) => { input.execution.tls.caBytes[0] = 256; return input; },
    (input) => { input.execution.tls.caBytes = Array(4097).fill(1); return input; },
    (input) => { input.execution.endpoints[0].method = "POST"; return input; },
    (input) => { input.execution.endpoints[0].path += "?extra=1"; return input; },
    (input) => { input.execution.endpoints.reverse(); return input; },
    (input) => { input.execution.extra = true; return input; },
    (input) => { input.execution.output.rootRef = "C:\\synthetic-not-an-output-path"; return input; },
    (input) => { input.execution.credentials.password = "not-a-synthetic-marker"; return input; },
    () => JSON.stringify({ schemaVersion: "hk-ai-08-synthetic-binding-v1" }),
    () => Buffer.from("SYNTHETIC_CONFIG_ONLY"),
    () => [],
    (input) => { input.approvalRef = "synthetic-" + "A".repeat(100000); return input; },
    (input) => { input.approvedTarget.host = "198.18.0.1"; input.candidate.host = "198.18.0.1"; input.candidate.allowedHosts = "198.18.0.1"; return input; },
    (input) => { input.execution.versions.adapter = "synthetic-binding-other"; return input; },
  ];
  invalidInputs.forEach((change, index) => test(`CB-04.${String(index + 1).padStart(2, "0")}`, () => {
    const bridge = createSyntheticBindingBridge(contextFixture());
    const probe = { calls: 0 };
    const input = change(inputFixture(), probe);
    const before = inertSnapshot(input);
    const result = rejected(bridge.prepare(input));
    assert.notEqual(result.code, "INTERNAL_ERROR");
    assert.equal(result.binding, null);
    assert.equal(result.configBindingRef, null);
    if (index === 22) {
      assert.equal(result.code, "CHECKER_REJECTED");
      assert.equal(result.checker.scope, "offline-format-and-match-only");
      assert.equal(result.checker.status, "FAIL");
      assert.equal(result.checker.code, "READ_NOT_DISABLED");
      assert.equal(result.checker.checks.allowReadDisabled, false);
    }
    if (index === 23) {
      assert.equal(result.code, "CHECKER_REJECTED");
      assert.equal(result.checker.scope, "offline-format-and-match-only");
      assert.equal(result.checker.status, "FAIL");
      assert.equal(result.checker.code, "INVALID_TARGET");
      assert.equal(result.checker.checks.hostSyntaxValid, false);
    }
    assert.deepEqual(inertSnapshot(input), before);
    assert.equal(probe.calls, 0);
  }));

  test("CB-04.49", () => {
    const probe = { calls: 0 };
    const source = trappedProxy(contextFixture(), probe);
    assert.throws(() => createSyntheticBindingBridge(source), { name: "TypeError", message: "SYNTHETIC_CONTEXT_INVALID" });
    assert.equal(probe.calls, 0);
  });

  test("CB-04.50", () => {
    const context = contextFixture();
    const probe = { calls: 0 };
    getter(context, "output", probe);
    const before = inertSnapshot(context);
    assert.throws(() => createSyntheticBindingBridge(context), { name: "TypeError", message: "SYNTHETIC_CONTEXT_INVALID" });
    assert.deepEqual(inertSnapshot(context), before);
    assert.equal(probe.calls, 0);
  });

  test("CB-05.01", async () => {
    const { bridge, binding, fake } = setup();
    const result = rejected(await bridge.executeSynthetic(binding, undefined, fake), "INVALID_PERMIT");
    assert.equal(result.fakeCalls, 0);
    assert.equal(observe(bridge, fake).calls, 0);
  });

  const forgeries = [
    () => ({}),
    (token) => ({ ...token }),
    (token) => JSON.parse(JSON.stringify(token)),
    (token, probe) => trappedProxy(token, probe),
  ];
  forgeries.forEach((makeToken, index) => test(`CB-05.${String(index + 2).padStart(2, "0")}`, async () => {
    const { bridge, binding, fake, permit } = setup();
    const probe = { calls: 0 };
    const forged = makeToken(permit, probe);
    rejected(await bridge.executeSynthetic(binding, forged, fake), "INVALID_PERMIT");
    assert.equal(probe.calls, 0);
    assert.equal(observe(bridge, fake).calls, 0);
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assertMatched(bridge, fake);
  }));

  test("CB-05.06", async () => {
    const left = setup();
    const right = setup();
    rejected(await right.bridge.executeSynthetic(right.binding, left.permit, right.fake), "INVALID_PERMIT");
    assert.equal(observe(right.bridge, right.fake).calls, 0);
    pass(await left.bridge.executeSynthetic(left.binding, left.permit, left.fake));
    assertMatched(left.bridge, left.fake);
  });

  test("CB-05.07", async () => {
    const { bridge, binding, fake, permit } = setup();
    const another = pass(bridge.prepare(inputFixture()));
    rejected(await bridge.executeSynthetic(another.binding, permit, fake), "PERMIT_BINDING_MISMATCH");
    assert.equal(observe(bridge, fake).calls, 0);
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assertMatched(bridge, fake);
  });

  test("CB-05.08", () => {
    const { bridge, binding } = setup();
    const result = rejected(bridge.issueSyntheticPermit(binding, grantFixture()), "PERMIT_ALREADY_ISSUED");
    assert.equal(result.token, null);
  });

  test("CB-05.09", async () => {
    const { bridge, binding, fake, permit } = setup();
    pass(await bridge.executeSynthetic(binding, permit, fake));
    const result = rejected(await bridge.executeSynthetic(binding, permit, fake), "PERMIT_USED");
    assert.equal(result.fakeCalls, 0);
    assert.equal(observe(bridge, fake).calls, 1);
  });

  test("CB-05.10", async () => {
    const { bridge, binding, fake, permit } = setup();
    pass(bridge.advanceSyntheticTime(10));
    rejected(await bridge.executeSynthetic(binding, permit, fake), "PERMIT_EXPIRED");
    assert.equal(observe(bridge, fake).calls, 0);
  });

  test("CB-05.11", async () => {
    const grant = grantFixture();
    grant.windowStart = 5;
    const { bridge, binding, fake, permit } = setup({ grant });
    rejected(await bridge.executeSynthetic(binding, permit, fake), "PERMIT_NOT_YET_VALID");
    assert.equal(observe(bridge, fake).calls, 0);
    pass(bridge.advanceSyntheticTime(5));
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assertMatched(bridge, fake);
  });

  test("CB-05.12", async () => {
    const { bridge, binding, fake, permit } = setup();
    pass(bridge.revokeSyntheticPermit(permit));
    rejected(await bridge.executeSynthetic(binding, permit, fake), "PERMIT_REVOKED");
    assert.equal(observe(bridge, fake).calls, 0);
  });

  test("CB-05.13", async () => {
    const { bridge, binding, fake, permit } = setup();
    const results = await Promise.all([
      bridge.executeSynthetic(binding, permit, fake), bridge.executeSynthetic(binding, permit, fake),
    ]);
    assert.equal(results.filter((item) => item.status === "PASS").length, 1);
    assert.equal(results.filter((item) => item.code === "PERMIT_USED").length, 1);
    assertMatched(bridge, fake);
  });

  test("CB-05.14", async () => {
    const { bridge, binding, fake, permit } = setup();
    const pending = bridge.executeSynthetic(binding, permit, fake);
    pass(bridge.revokeSyntheticPermit(permit));
    const result = rejected(await pending, "PERMIT_REVOKED");
    assert.equal(result.fakeCalls, 0);
    assert.equal(observe(bridge, fake).calls, 0);
    rejected(await bridge.executeSynthetic(binding, permit, fake));
  });

  test("CB-05.15", async () => {
    const { bridge, binding, fake, permit } = setup();
    const pending = bridge.executeSynthetic(binding, permit, fake);
    pass(bridge.advanceSyntheticTime(10));
    const result = rejected(await pending, "PERMIT_EXPIRED");
    assert.equal(result.fakeCalls, 0);
    assert.equal(observe(bridge, fake).calls, 0);
    rejected(await bridge.executeSynthetic(binding, permit, fake));
  });

  test("CB-05.16", async () => {
    const { bridge, binding, fake, permit } = setup();
    const pending = bridge.executeSynthetic(binding, permit, fake);
    const changed = contextFixture();
    changed.output.rootRef = "synthetic-root-2";
    pass(bridge.replaceSyntheticRuntime(changed));
    const result = rejected(await pending, "CONTEXT_CHANGED");
    assert.equal(result.fakeCalls, 0);
    assert.equal(observe(bridge, fake).calls, 0);
  });

  for (const [index, outcome] of ["fail", "throw"].entries()) test(`CB-05.${index + 17}`, async () => {
    const { bridge, binding, fake, permit } = setup({ outcome });
    const result = rejected(await bridge.executeSynthetic(binding, permit, fake), "FAKE_EXECUTOR_FAILED");
    assert.equal(result.fakeCalls, 1);
    assertMatched(bridge, fake);
    const replay = rejected(await bridge.executeSynthetic(binding, permit, fake), "PERMIT_USED");
    assert.equal(replay.fakeCalls, 0);
    assert.equal(observe(bridge, fake).calls, 1);
  });

  test("CB-05.19", async () => {
    const { bridge, binding, fake, permit } = setup();
    let callbackCalls = 0;
    const callback = () => { callbackCalls += 1; };
    rejected(await bridge.executeSynthetic(binding, permit, callback), "INVALID_FAKE_EXECUTOR");
    assert.equal(callbackCalls, 0);
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assertMatched(bridge, fake);
  });

  test("CB-05.20", async () => {
    const current = setup();
    const other = setup();
    rejected(await current.bridge.executeSynthetic(current.binding, current.permit, other.fake), "INVALID_FAKE_EXECUTOR");
    assert.equal(observe(current.bridge, current.fake).calls, 0);
    pass(await current.bridge.executeSynthetic(current.binding, current.permit, current.fake));
    assertMatched(current.bridge, current.fake);
  });

  test("CB-05.21", async () => {
    const { bridge, binding, fake, permit } = setup();
    pass(bridge.advanceSyntheticTime(5));
    rejected(bridge.advanceSyntheticTime(4), "CLOCK_ROLLBACK");
    rejected(bridge.advanceSyntheticTime(-1), "INVALID_TIME");
    rejected(bridge.advanceSyntheticTime(NaN), "INVALID_TIME");
    pass(await bridge.executeSynthetic(binding, permit, fake));
    assertMatched(bridge, fake);
  });

  test("CB-05.22", () => {
    const bridge = createSyntheticBindingBridge(contextFixture());
    const prepared = pass(bridge.prepare(inputFixture()));
    const grant = grantFixture();
    grant.approvalRef = "synthetic-wrong-approval";
    assert.equal(rejected(bridge.issueSyntheticPermit(prepared.binding, grant)).token, null);
    grant.approvalRef = "synthetic-approval-1";
    grant.approvalValid = true;
    assert.equal(rejected(bridge.issueSyntheticPermit(prepared.binding, grant)).token, null);
    pass(bridge.issueSyntheticPermit(prepared.binding, grantFixture()));
  });

  test("CB-05.23", async () => {
    const { bridge, fake, permit, prepared } = setup();
    const forged = { configBindingRef: prepared.configBindingRef };
    rejected(await bridge.executeSynthetic(forged, permit, fake), "INVALID_BINDING");
    assert.equal(observe(bridge, fake).calls, 0);
  });

  const runtimeChanges = [
    (context) => { context.versions.tool = "0".repeat(40); },
    (context) => { context.versions.checker = "1".repeat(40); },
    (context) => { context.versions.adapter = "synthetic-binding-v2"; },
    (context) => { context.versions.endpoints = "synthetic-six-get-v2"; },
    (context) => { context.output.rootRef = "synthetic-root-2"; },
    (context) => { context.output.policyRef = "synthetic-windows-acl-v2"; },
  ];
  runtimeChanges.forEach((change, index) => test(`CB-06.${String(index + 1).padStart(2, "0")}`, async () => {
    const { bridge, binding, fake, permit } = setup();
    const context = contextFixture();
    change(context);
    pass(bridge.replaceSyntheticRuntime(context));
    rejected(await bridge.executeSynthetic(binding, permit, fake), "CONTEXT_CHANGED");
    assert.equal(observe(bridge, fake).calls, 0);
  }));

  test("CB-06.07", async () => {
    const { bridge, binding, fake, permit } = setup();
    const changed = contextFixture();
    changed.versions.adapter = "synthetic-binding-v2";
    pass(bridge.replaceSyntheticRuntime(changed));
    pass(bridge.replaceSyntheticRuntime(contextFixture()));
    rejected(await bridge.executeSynthetic(binding, permit, fake), "CONTEXT_CHANGED");
    assert.equal(observe(bridge, fake).calls, 0);
  });

  test("CB-06.08", async () => {
    const { bridge, binding, fake, permit } = setup();
    pass(bridge.replaceSyntheticRuntime(contextFixture()));
    rejected(await bridge.executeSynthetic(binding, permit, fake), "CONTEXT_CHANGED");
    assert.equal(observe(bridge, fake).calls, 0);
  });

  test("CB-06.09", async () => {
    const old = setup();
    const changed = contextFixture();
    changed.output.rootRef = "synthetic-root-2";
    changed.versions.adapter = "synthetic-binding-v2";
    pass(old.bridge.replaceSyntheticRuntime(changed));
    const input = inputFixture();
    input.execution.output.rootRef = "synthetic-root-2";
    input.execution.versions.adapter = "synthetic-binding-v2";
    const expected = expectedFixture();
    expected.output.rootRef = "synthetic-root-2";
    expected.versions.adapter = "synthetic-binding-v2";
    const prepared = pass(old.bridge.prepare(input));
    const fake = pass(old.bridge.createFakeExecutor({ expected, outcome: "success" })).fakeExecutor;
    const permit = pass(old.bridge.issueSyntheticPermit(prepared.binding, grantFixture())).token;
    pass(await old.bridge.executeSynthetic(prepared.binding, permit, fake));
    assertMatched(old.bridge, fake);
    rejected(await old.bridge.executeSynthetic(old.binding, old.permit, old.fake), "CONTEXT_CHANGED");
    assert.equal(observe(old.bridge, old.fake).calls, 0);
  });

  test("CB-06.10", () => {
    const bridge = createSyntheticBindingBridge(contextFixture());
    const first = pass(bridge.prepare(inputFixture()));
    const second = pass(bridge.prepare(inputFixture()));
    assert.notEqual(first.binding, second.binding);
    assert.notEqual(first.configBindingRef, second.configBindingRef);
    assert.equal(bridge.issueSyntheticPermit({ configBindingRef: first.configBindingRef }, grantFixture()).code, "INVALID_BINDING");
  });

  const failedCaseIds = [];
  const groupCounts = GROUPS.map((id) => ({ id, total: 0, passed: 0, failed: 0 }));
  for (const item of cases) {
    const group = groupCounts.find((entry) => entry.id === item.group);
    if (!group) { failedCaseIds.push("HARNESS_GROUP"); continue; }
    group.total += 1;
    try {
      await item.run();
      group.passed += 1;
    } catch {
      failedCaseIds.push(item.id);
      group.failed += 1;
    }
  }
  const failed = failedCaseIds.length;
  process.stdout.write(`${JSON.stringify({
    scope: SCOPE, status: failed === 0 ? "PASS" : "FAIL",
    counts: { groups: groupCounts.length, total: cases.length, passed: cases.length - failed, failed },
    failedCaseIds, groupCounts,
  })}\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}
