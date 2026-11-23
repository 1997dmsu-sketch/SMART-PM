import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { checkOfflineConfig } from "../../hikvision-offline-config-checker/src/check-config.mjs";

// Pure in-memory synthetic model. There is deliberately no caller callback,
// configuration loader, real transport, filesystem operation or live permit.
const SCOPE = "synthetic-config-binding-only";
const INPUT_SCHEMA = "hk-ai-08-synthetic-binding-v1";
const CHECKER_SCHEMA = "hk-ai-08-offline-config-v1";
const INVALID = Symbol("invalid-input");
const SIMULATED_FAILURE = Symbol("simulated-failure");
const TARGET_KEYS = ["deviceRef", "host", "port", "model"];
const CANDIDATE_KEYS = ["deviceRef", "host", "allowedHosts", "port", "allowedPorts", "expectedModel", "allowRead"];
const VERSION_KEYS = ["tool", "checker", "adapter", "endpoints"];
const OUTPUT_KEYS = ["rootRef", "policyRef"];
const LIMIT_KEYS = ["timeoutMs", "requestDeadlineMs", "sessionDeadlineMs", "maxBytes"];
const ENDPOINT_KEYS = ["id", "method", "path", "expect"];

function invalid() { throw INVALID; }

function dataRecord(value, keys) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some((key) => typeof key !== "string" || !keys.includes(key))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const copy = Object.create(null);
  for (const key of keys) {
    const property = descriptors[key];
    if (!property || !property.enumerable || !Object.hasOwn(property, "value")) invalid();
    copy[key] = property.value;
  }
  return copy;
}

function dataArray(value, maximum, minimum = 0) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length < minimum || length > maximum) invalid();
  const names = Reflect.ownKeys(value);
  if (names.length !== length + 1 || names.some((key) => typeof key !== "string" ||
      (key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key)))) invalid();
  const copy = [];
  for (let index = 0; index < length; index += 1) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !property.enumerable || !Object.hasOwn(property, "value")) invalid();
    copy.push(property.value);
  }
  return copy;
}

function text(value, maximum = 128) {
  if (typeof value !== "string" || !value.length || value.length > maximum) invalid();
  return value;
}

function syntheticRef(value) {
  text(value);
  if (!/^synthetic-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) invalid();
  return value;
}

function label(value) {
  text(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) invalid();
  return value;
}

function deepFreeze(value) {
  // Only freshly created, descriptor-checked records/arrays reach this helper.
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const ENDPOINTS = deepFreeze([
  { id: "deviceInfo", method: "GET", path: "/ISAPI/System/deviceInfo", expect: "xml" },
  { id: "acsCapabilities", method: "GET", path: "/ISAPI/AccessControl/capabilities", expect: "xml" },
  { id: "userInfoCapabilities", method: "GET", path: "/ISAPI/AccessControl/UserInfo/capabilities?format=json", expect: "json" },
  { id: "fdlibCapabilities", method: "GET", path: "/ISAPI/Intelligent/FDLib/capabilities?format=json", expect: "json" },
  { id: "fdlibList", method: "GET", path: "/ISAPI/Intelligent/FDLib?format=json", expect: "json" },
  { id: "fdlibCount", method: "GET", path: "/ISAPI/Intelligent/FDLib/Count?format=json", expect: "json" },
]);

function copyVersions(value) {
  const record = dataRecord(value, VERSION_KEYS);
  if (typeof record.tool !== "string" || !/^[0-9a-f]{40}$/.test(record.tool) ||
      typeof record.checker !== "string" || !/^[0-9a-f]{40}$/.test(record.checker)) invalid();
  label(record.adapter); label(record.endpoints);
  return record;
}

function copyOutput(value) {
  const record = dataRecord(value, OUTPUT_KEYS);
  syntheticRef(record.rootRef); syntheticRef(record.policyRef);
  return record;
}

function copyContext(value) {
  const record = dataRecord(value, ["versions", "output"]);
  record.versions = copyVersions(record.versions);
  record.output = copyOutput(record.output);
  return deepFreeze(record);
}

function copyTls(value, requirePinned = true) {
  const record = dataRecord(value, ["mode", "fingerprints", "caBytes"]);
  text(record.mode, 64);
  if (!/^[\x20-\x7e]+$/.test(record.mode) || (requirePinned && record.mode !== "fingerprint-pinned")) invalid();
  record.fingerprints = dataArray(record.fingerprints, 2, 1);
  if (record.fingerprints.some((pin) => typeof pin !== "string" || !/^[0-9A-F]{64}$/.test(pin)) ||
      new Set(record.fingerprints).size !== record.fingerprints.length) invalid();
  // Plain byte arrays only: no input iterator, slice, toJSON, Buffer or view.
  record.caBytes = dataArray(record.caBytes, 4096);
  if (record.caBytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) invalid();
  return record;
}

function copyLimits(value) {
  const record = dataRecord(value, LIMIT_KEYS);
  if (LIMIT_KEYS.some((key) => !Number.isSafeInteger(record[key]) || record[key] <= 0) ||
      record.timeoutMs > 120000 || record.requestDeadlineMs > 120000 ||
      record.sessionDeadlineMs > 600000 || record.maxBytes > 262144 ||
      record.timeoutMs > record.requestDeadlineMs || record.requestDeadlineMs > record.sessionDeadlineMs) invalid();
  return record;
}

function copyCredentials(value) {
  const record = dataRecord(value, ["username", "password"]);
  if (typeof record.username !== "string" || typeof record.password !== "string" ||
      record.username.length > 128 || record.password.length > 128 ||
      !/^SYNTHETIC_[A-Za-z0-9._-]+$/.test(record.username) ||
      !/^SYNTHETIC_[A-Za-z0-9._-]+$/.test(record.password)) invalid();
  return record;
}

function copyEndpoints(value, requireExact) {
  const copied = dataArray(value, ENDPOINTS.length, ENDPOINTS.length).map((endpoint, index) => {
    const record = dataRecord(endpoint, ENDPOINT_KEYS);
    for (const key of ENDPOINT_KEYS) {
      text(record[key], key === "path" ? 256 : 64);
      if (!/^[\x20-\x7e]+$/.test(record[key])) invalid();
      if (requireExact && record[key] !== ENDPOINTS[index][key]) invalid();
    }
    return record;
  });
  return copied;
}

function reservedHost(value) {
  if (value === "example.invalid") return true;
  if (!/^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.(?:0|[1-9][0-9]{0,2})$/.test(value)) return false;
  return Number(value.slice(value.lastIndexOf(".") + 1)) <= 255;
}

function copyRawTarget(value) {
  const record = dataRecord(value, TARGET_KEYS);
  syntheticRef(record.deviceRef);
  text(record.host, 253); text(record.port, 32); text(record.model);
  return record;
}

function copyRawCandidate(value) {
  const record = dataRecord(value, CANDIDATE_KEYS);
  syntheticRef(record.deviceRef);
  text(record.host, 253); text(record.port, 32); text(record.allowedHosts, 2048);
  text(record.allowedPorts, 256); text(record.expectedModel);
  if (typeof record.allowRead !== "boolean") invalid();
  return record;
}

function checkerProjection(approvalRef, target, candidate) {
  return deepFreeze({
    schemaVersion: CHECKER_SCHEMA,
    approvalRef,
    approvedTarget: { ...target },
    candidate: { ...candidate },
  });
}

function copyRawInput(value) {
  const root = dataRecord(value, ["schemaVersion", "dataClass", "approvalRef", "approvedTarget", "candidate", "execution"]);
  if (root.schemaVersion !== INPUT_SCHEMA || root.dataClass !== "synthetic-only") invalid();
  syntheticRef(root.approvalRef);
  root.approvedTarget = copyRawTarget(root.approvedTarget);
  root.candidate = copyRawCandidate(root.candidate);
  const execution = dataRecord(root.execution, ["tls", "limits", "output", "versions", "credentials", "endpoints"]);
  execution.tls = copyTls(execution.tls);
  execution.limits = copyLimits(execution.limits);
  execution.output = copyOutput(execution.output);
  execution.versions = copyVersions(execution.versions);
  execution.credentials = copyCredentials(execution.credentials);
  execution.endpoints = copyEndpoints(execution.endpoints, true);
  root.execution = execution;
  return root;
}

function canonicalize(raw) {
  const target = { ...raw.approvedTarget,
    host: raw.approvedTarget.host.trim().toLowerCase(), port: String(Number(raw.approvedTarget.port)) };
  const candidate = { ...raw.candidate,
    host: raw.candidate.host.trim().toLowerCase(), port: String(Number(raw.candidate.port)),
    allowedHosts: raw.candidate.allowedHosts.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean).join(","),
    allowedPorts: String(Number(raw.candidate.allowedPorts.trim())) };
  if (!reservedHost(target.host) || target.model !== "DS-K1T671BM" || candidate.allowRead !== false) invalid();
  return deepFreeze({
    approvalRef: raw.approvalRef,
    target,
    candidate,
    execution: raw.execution,
  });
}

function copyExpected(value) {
  const view = dataRecord(value, ["target", "tls", "limits", "output", "versions", "credentials", "endpoints", "allowRead"]);
  const target = dataRecord(view.target, TARGET_KEYS);
  syntheticRef(target.deviceRef);
  text(target.model);
  if (typeof target.host !== "string" || !reservedHost(target.host) ||
      target.host !== target.host.trim().toLowerCase() || !Number.isSafeInteger(target.port) ||
      target.port < 1 || target.port > 65535 || !/^[\x20-\x7e]+$/.test(target.model) || view.allowRead !== false) invalid();
  view.target = target;
  view.tls = copyTls(view.tls, false);
  view.limits = copyLimits(view.limits);
  view.output = copyOutput(view.output);
  view.versions = copyVersions(view.versions);
  view.credentials = copyCredentials(view.credentials);
  // Expected values never construct requests. Legal literal differences here
  // let an independent test demonstrate that all endpoint fields are compared.
  view.endpoints = copyEndpoints(view.endpoints, false);
  return deepFreeze(view);
}

function equalRecord(left, right, keys) { return keys.every((key) => left[key] === right[key]); }
function equalArray(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function equalEndpoints(left, right) {
  return left.length === right.length && left.every((endpoint, index) => equalRecord(endpoint, right[index], ENDPOINT_KEYS));
}
function contextMatches(snapshot, context) {
  return equalRecord(snapshot.execution.versions, context.versions, VERSION_KEYS) &&
    equalRecord(snapshot.execution.output, context.output, OUTPUT_KEYS);
}
function frozenTree(value) {
  return value === null || typeof value !== "object" ||
    (Object.isFrozen(value) && Object.values(value).every(frozenTree));
}

function executionView(snapshot) {
  const execution = snapshot.execution;
  return deepFreeze({
    target: { ...snapshot.target, port: Number(snapshot.target.port) },
    tls: { mode: execution.tls.mode, fingerprints: [...execution.tls.fingerprints], caBytes: [...execution.tls.caBytes] },
    limits: { ...execution.limits }, output: { ...execution.output }, versions: { ...execution.versions },
    credentials: { ...execution.credentials }, endpoints: execution.endpoints.map((endpoint) => ({ ...endpoint })),
    allowRead: snapshot.candidate.allowRead,
  });
}

function projectionMatches(projection, snapshot, view) {
  const target = projection.approvedTarget;
  const candidate = projection.candidate;
  return projection.schemaVersion === CHECKER_SCHEMA && projection.approvalRef === snapshot.approvalRef &&
    target.deviceRef === view.target.deviceRef && target.host === view.target.host &&
    target.port === String(view.target.port) && target.model === view.target.model &&
    candidate.deviceRef === view.target.deviceRef && candidate.host === view.target.host &&
    candidate.port === String(view.target.port) && candidate.allowedHosts === view.target.host &&
    candidate.allowedPorts === String(view.target.port) && candidate.expectedModel === view.target.model &&
    candidate.allowRead === false && view.allowRead === false && frozenTree(projection);
}

function fakeInvocation(fake, binding) {
  fake.calls += 1;
  const snapshot = binding.snapshot;
  const view = executionView(snapshot);
  const expected = fake.expected;
  // This mutable material is exclusively owned by the internal fake transport;
  // the canonical bytes stay a frozen, non-aliased private ordinary array.
  const transportCa = Uint8Array.from(snapshot.execution.tls.caBytes);
  const beforeCa = [...snapshot.execution.tls.caBytes];
  const tlsMatches = view.tls.mode === expected.tls.mode &&
    equalArray(view.tls.fingerprints, expected.tls.fingerprints) &&
    equalArray(view.tls.caBytes, expected.tls.caBytes) && equalArray([...transportCa], expected.tls.caBytes);
  if (transportCa.length) transportCa[0] ^= 255;
  const observation = {
    targetMatches: equalRecord(view.target, expected.target, TARGET_KEYS),
    tlsMatches,
    limitsMatch: equalRecord(view.limits, expected.limits, LIMIT_KEYS),
    outputMatches: equalRecord(view.output, expected.output, OUTPUT_KEYS),
    versionsMatch: equalRecord(view.versions, expected.versions, VERSION_KEYS),
    credentialsMatch: equalRecord(view.credentials, expected.credentials, ["username", "password"]),
    endpointsMatch: equalEndpoints(view.endpoints, expected.endpoints),
    projectionMatches: projectionMatches(binding.projection, snapshot, view),
    allowReadStayedFalse: view.allowRead === false && expected.allowRead === false && snapshot.candidate.allowRead === false,
    metadataFrozen: frozenTree(view) && frozenTree(snapshot),
    privateBytesIsolated: equalArray(beforeCa, snapshot.execution.tls.caBytes) &&
      transportCa.buffer !== snapshot.execution.tls.caBytes,
  };
  observation.matched = Object.values(observation).every((value) => value === true);
  fake.last = deepFreeze(observation);
  if (!observation.matched) return "FAKE_EXPECTATION_MISMATCH";
  if (fake.outcome === "throw") throw SIMULATED_FAILURE;
  return fake.outcome === "fail" ? "FAKE_EXECUTOR_FAILED" : "OK";
}

function handle() { return Object.freeze(Object.create(null)); }
function belongs(map, value) {
  return value !== null && typeof value === "object" && !types.isProxy(value) && map.has(value);
}
function result(code, fields = {}) {
  return deepFreeze({ scope: SCOPE, status: code === "OK" ? "PASS" : "FAIL", code, ...fields });
}

export function createSyntheticBindingBridge(initialContext) {
  let runtime;
  try { runtime = copyContext(initialContext); }
  catch { throw new TypeError("SYNTHETIC_CONTEXT_INVALID"); }
  let epoch = 0n;
  let now = 0;
  const bindings = new WeakMap();
  const permits = new WeakMap();
  const fakes = new WeakMap();

  function prepare(input) {
    let checker = null;
    try {
      const raw = copyRawInput(input);
      const rawProjection = checkerProjection(raw.approvalRef, raw.approvedTarget, raw.candidate);
      checker = checkOfflineConfig(rawProjection);
      if (checker.status !== "PASS" || checker.code !== "OK") {
        return result("CHECKER_REJECTED", { binding: null, configBindingRef: null, checker });
      }
      const snapshot = canonicalize(raw);
      const projection = checkerProjection(snapshot.approvalRef, snapshot.target, snapshot.candidate);
      checker = checkOfflineConfig(projection);
      if (checker.status !== "PASS" || checker.code !== "OK") {
        return result("CHECKER_REJECTED", { binding: null, configBindingRef: null, checker });
      }
      if (!contextMatches(snapshot, runtime)) {
        return result("CONTEXT_MISMATCH", { binding: null, configBindingRef: null, checker });
      }
      const binding = handle();
      const configBindingRef = `hk-bind-${randomUUID().replaceAll("-", "")}`;
      bindings.set(binding, { snapshot, projection, checker: deepFreeze(checker), epoch, configBindingRef, permitIssued: false });
      return result("OK", { binding, configBindingRef, checker });
    } catch (error) {
      return result(error === INVALID ? "INVALID_INPUT" : "INTERNAL_ERROR", { binding: null, configBindingRef: null, checker: null });
    }
  }

  function createFakeExecutor(input) {
    try {
      const data = dataRecord(input, ["expected", "outcome"]);
      if (!["success", "fail", "throw"].includes(data.outcome)) invalid();
      const expected = copyExpected(data.expected);
      const fakeExecutor = handle();
      fakes.set(fakeExecutor, { expected, outcome: data.outcome, calls: 0, last: null });
      return result("OK", { fakeExecutor });
    } catch (error) {
      return result(error === INVALID ? "INVALID_INPUT" : "INTERNAL_ERROR", { fakeExecutor: null });
    }
  }

  function issueSyntheticPermit(binding, input) {
    try {
      if (!belongs(bindings, binding)) return result("INVALID_BINDING", { token: null });
      const state = bindings.get(binding);
      if (state.epoch !== epoch) return result("CONTEXT_CHANGED", { token: null });
      if (state.permitIssued) return result("PERMIT_ALREADY_ISSUED", { token: null });
      const grant = dataRecord(input, ["scope", "approvalRef", "windowStart", "windowEnd"]);
      if (grant.scope !== "synthetic-fake-execution-only" || grant.approvalRef !== state.snapshot.approvalRef ||
          !Number.isSafeInteger(grant.windowStart) || !Number.isSafeInteger(grant.windowEnd) ||
          grant.windowStart < 0 || grant.windowEnd <= grant.windowStart) invalid();
      const token = handle();
      permits.set(token, { binding, epoch, windowStart: grant.windowStart, windowEnd: grant.windowEnd, used: false, revoked: false });
      state.permitIssued = true;
      return result("OK", { token });
    } catch (error) {
      return result(error === INVALID ? "INVALID_INPUT" : "INTERNAL_ERROR", { token: null });
    }
  }

  function permitCode(binding, state, permit) {
    if (permit.binding !== binding) return "PERMIT_BINDING_MISMATCH";
    if (permit.used) return "PERMIT_USED";
    if (permit.revoked) return "PERMIT_REVOKED";
    if (state.epoch !== epoch || permit.epoch !== epoch) return "CONTEXT_CHANGED";
    if (now < permit.windowStart) return "PERMIT_NOT_YET_VALID";
    if (now >= permit.windowEnd) return "PERMIT_EXPIRED";
    return "OK";
  }

  async function executeSynthetic(binding, token, fakeExecutor) {
    let configBindingRef = null;
    let fakeCalls = 0;
    try {
      if (!belongs(fakes, fakeExecutor)) return result("INVALID_FAKE_EXECUTOR", { configBindingRef, fakeCalls });
      if (!belongs(bindings, binding)) return result("INVALID_BINDING", { configBindingRef, fakeCalls });
      const state = bindings.get(binding);
      configBindingRef = state.configBindingRef;
      if (!belongs(permits, token)) return result("INVALID_PERMIT", { configBindingRef, fakeCalls });
      const permit = permits.get(token);
      const code = permitCode(binding, state, permit);
      if (code !== "OK") return result(code, { configBindingRef, fakeCalls });
      // Consume synchronously before any fake work or microtask suspension.
      // Neither errors nor changing synthetic controls restore this permit.
      permit.used = true;
      await Promise.resolve();
      if (permit.revoked) return result("PERMIT_REVOKED", { configBindingRef, fakeCalls });
      if (state.epoch !== epoch || permit.epoch !== epoch) return result("CONTEXT_CHANGED", { configBindingRef, fakeCalls });
      if (now < permit.windowStart) return result("PERMIT_NOT_YET_VALID", { configBindingRef, fakeCalls });
      if (now >= permit.windowEnd) return result("PERMIT_EXPIRED", { configBindingRef, fakeCalls });
      fakeCalls = 1;
      return result(fakeInvocation(fakes.get(fakeExecutor), state), { configBindingRef, fakeCalls });
    } catch (error) {
      return result(error === SIMULATED_FAILURE ? "FAKE_EXECUTOR_FAILED" : "INTERNAL_ERROR", { configBindingRef, fakeCalls });
    }
  }

  function revokeSyntheticPermit(token) {
    try {
      if (!belongs(permits, token)) return result("INVALID_PERMIT");
      permits.get(token).revoked = true;
      return result("OK");
    } catch { return result("INTERNAL_ERROR"); }
  }

  function advanceSyntheticTime(value) {
    if (!Number.isSafeInteger(value) || value < 0) return result("INVALID_TIME");
    if (value < now) return result("CLOCK_ROLLBACK");
    now = value;
    return result("OK");
  }

  function replaceSyntheticRuntime(value) {
    try {
      const replacement = copyContext(value);
      runtime = replacement;
      epoch += 1n;
      return result("OK");
    } catch (error) { return result(error === INVALID ? "INVALID_INPUT" : "INTERNAL_ERROR"); }
  }

  function observeFake(fakeExecutor) {
    try {
      if (!belongs(fakes, fakeExecutor)) return result("INVALID_FAKE_EXECUTOR", { calls: 0, last: null });
      const fake = fakes.get(fakeExecutor);
      return result("OK", { calls: fake.calls, last: fake.last });
    } catch { return result("INTERNAL_ERROR", { calls: 0, last: null }); }
  }

  return Object.freeze({
    prepare, createFakeExecutor, issueSyntheticPermit, executeSynthetic,
    revokeSyntheticPermit, advanceSyntheticTime, replaceSyntheticRuntime, observeFake,
  });
}
