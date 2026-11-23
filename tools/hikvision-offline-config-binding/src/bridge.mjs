import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { checkOfflineConfig } from "../../hikvision-offline-config-checker/src/check-config.mjs";
import { decodeSyntheticConfigBytes } from "../../hikvision-offline-entry/src/bytes.mjs";
import {
  createNativeEvidenceBroker, validateNativeEvidence, writeNativeEvidence,
  closeNativeEvidence, observeNativeEvidence,
} from "../../hikvision-windows-evidence-sink/src/native-broker.mjs";

// Legacy modes remain pure-memory. The separate Windows mode owns only a
// fixed local synthetic evidence broker; it has no real transport/live permit.
const SCOPE = "synthetic-config-binding-only";
const ENTRY_SCOPE = "synthetic-offline-entry-only";
const WINDOWS_SCOPE = "synthetic-windows-evidence-sink-only";
const WINDOWS_POLICY = "synthetic-windows-handle-acl-v1";
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

function compareExecution(binding, expected) {
  const snapshot = binding.snapshot;
  const view = executionView(snapshot);
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
  return deepFreeze(observation);
}

function fakeInvocation(fake, binding) {
  fake.calls += 1;
  const observation = compareExecution(binding, fake.expected);
  fake.last = observation;
  if (!observation.matched) return "FAKE_EXPECTATION_MISMATCH";
  if (fake.outcome === "throw") throw SIMULATED_FAILURE;
  return fake.outcome === "fail" ? "FAKE_EXECUTOR_FAILED" : "OK";
}

function handle() { return Object.freeze(Object.create(null)); }
function belongs(map, value) {
  return value !== null && typeof value === "object" && !types.isProxy(value) && map.has(value);
}
function scopedResult(scope, code, fields = {}, status = code === "OK" ? "PASS" : "FAIL") {
  return deepFreeze({ scope, status, code, ...fields });
}

function createBridge(initialContext, entryMode, windowsMode = false) {
  const scope = windowsMode ? WINDOWS_SCOPE : entryMode ? ENTRY_SCOPE : SCOPE;
  const result = (code, fields = {}, status) => scopedResult(scope, code, fields, status);
  let runtime;
  try {
    runtime = copyContext(initialContext);
    if (windowsMode && runtime.output.policyRef !== WINDOWS_POLICY) invalid();
  }
  catch { throw new TypeError("SYNTHETIC_CONTEXT_INVALID"); }
  let epoch = 0n;
  let now = 0;
  const bindings = new WeakMap();
  const permits = new WeakMap();
  const fakes = new WeakMap();
  const transports = new WeakMap();
  const outputs = new WeakMap();

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
      const state = { snapshot, projection, checker: deepFreeze(checker), epoch, configBindingRef, permitIssued: false, cancelled: false };
      if (windowsMode) Object.assign(state, {
        nativeClosed: false, nativeFailureCode: null, nativeLast: null, nativeClosePromise: null,
      });
      bindings.set(binding, state);
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

  function copyGrant(state, input) {
    const grant = dataRecord(input, ["scope", "approvalRef", "windowStart", "windowEnd"]);
    if (grant.scope !== "synthetic-fake-execution-only" || grant.approvalRef !== state.snapshot.approvalRef ||
        !Number.isSafeInteger(grant.windowStart) || !Number.isSafeInteger(grant.windowEnd) ||
        grant.windowStart < 0 || grant.windowEnd <= grant.windowStart) invalid();
    return grant;
  }

  function issueSyntheticPermit(binding, input) {
    try {
      if (!belongs(bindings, binding)) return result("INVALID_BINDING", { token: null });
      const state = bindings.get(binding);
      if (state.cancelled) return result("SESSION_CANCELLED", { token: null });
      if (state.epoch !== epoch) return result("CONTEXT_CHANGED", { token: null });
      if (state.permitIssued) return result("PERMIT_ALREADY_ISSUED", { token: null });
      const grant = copyGrant(state, input);
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

  function prepareBytes(bytes) {
    const decoded = decodeSyntheticConfigBytes(bytes);
    if (decoded.code !== "OK") {
      return result(decoded.code, { binding: null, configBindingRef: null, checker: null });
    }
    return prepare(decoded.input);
  }

  function safeNative(record) {
    if (record === null || typeof record !== "object") return null;
    // The trusted broker provides fresh closed observations. In particular its
    // create-only capability never enters a public bridge result.
    const safe = {};
    for (const key of ["status", "code", "evidenceRef", "compilerRef", "checks", "counts",
      "newObjectStateUnverified", "retained", "closed"]) safe[key] = record[key];
    return deepFreeze(safe);
  }

  function windowsResult(code, fields, native, status) {
    return result(code, { ...fields, native },
      status ?? (native?.status === "BLOCKED" && native.code === code ? "BLOCKED" : undefined));
  }

  function nativeUnknown(state) {
    // If an internal/RPC failure escapes the broker, keep the last verified
    // quantities but explicitly stop treating them as a complete object count.
    if (state?.nativeLast !== null && state?.nativeLast !== undefined) {
      state.nativeLast = deepFreeze({ ...state.nativeLast,
        status: "FAIL", code: "NATIVE_IO_FAILED", newObjectStateUnverified: true,
      });
    }
  }

  function windowsControlCode(state) {
    if (state.nativeClosed) return "NATIVE_BINDING_CLOSED";
    if (state.epoch !== epoch) return "CONTEXT_CHANGED";
    if (state.cancelled) return "SESSION_CANCELLED";
    if (state.nativeFailureCode !== null) return state.nativeFailureCode;
    if (state.snapshot.execution.output.policyRef !== WINDOWS_POLICY) return "NATIVE_POLICY_UNSUPPORTED";
    return "OK";
  }

  function rootEvidenceVerified(observed) {
    return observed !== null && observed.checks !== null && typeof observed.checks === "object" &&
      ["platformSupported", "identitySupported", "locationSupported", "ancestorHandlesHeld",
        "rootCreatedExclusive", "rootAclValid", "nativeIdentityValid", "rootEntriesValid", "deleteSharingDenied"]
        .every((name) => observed.checks[name] === true) &&
      observed.counts?.directoriesCreated === 1 && observed.newObjectStateUnverified === false &&
      observed.retained === true && observed.closed === false;
  }

  async function refreshNative(state) {
    const observed = safeNative(await validateNativeEvidence(state.nativeCapability));
    if (observed === null) throw new Error("NATIVE_IO_FAILED");
    state.nativeLast = observed;
    if (observed.status !== "PASS" || observed.code !== "OK") state.nativeFailureCode = observed.code;
    else if (!rootEvidenceVerified(observed)) state.nativeFailureCode = "NATIVE_ROOT_UNVERIFIED";
    return observed;
  }

  async function closeNativeState(state) {
    if (state.nativeClosePromise !== null) return state.nativeClosePromise;
    // Synchronous invalidation precedes the first close await. Closing retains
    // every directory/file and never permits a new signature or execution.
    state.nativeClosed = true;
    state.nativeClosePromise = (async () => {
      try {
        const observed = safeNative(await closeNativeEvidence(state.nativeCapability));
        if (observed === null) {
          nativeUnknown(state);
          return windowsResult("NATIVE_IO_FAILED", {}, state.nativeLast);
        }
        state.nativeLast = observed;
        if (observed.status === "PASS" && observed.code === "OK" && observed.closed !== true) {
          return windowsResult("NATIVE_CLOSE_UNVERIFIED", {}, observed);
        }
        return windowsResult(observed.code, {}, observed);
      } catch {
        nativeUnknown(state);
        return windowsResult("NATIVE_IO_FAILED", {}, state.nativeLast);
      }
    })();
    return state.nativeClosePromise;
  }

  async function prepareWindowsBytes(bytes) {
    let state = null;
    try {
      const prepared = prepareBytes(bytes);
      if (prepared.code !== "OK") {
        return windowsResult(prepared.code, { binding: null, configBindingRef: null, checker: null }, null);
      }
      state = bindings.get(prepared.binding);
      let code = windowsControlCode(state);
      if (code !== "OK") return windowsResult(code, { binding: null, configBindingRef: null, checker: null }, null);
      const created = await createNativeEvidenceBroker();
      state.nativeLast = safeNative(created);
      if (created.capability !== null && created.capability !== undefined) {
        Object.defineProperty(state, "nativeCapability", {
          value: created.capability, enumerable: false, writable: false, configurable: false,
        });
      }
      if (created.status !== "PASS" || created.code !== "OK" || !Object.hasOwn(state, "nativeCapability")) {
        code = created.code === "OK" ? "NATIVE_IO_FAILED" : created.code;
        const failedStatus = created.status === "BLOCKED" ? "BLOCKED" : undefined;
        if (Object.hasOwn(state, "nativeCapability")) await closeNativeState(state);
        return windowsResult(code, { binding: null, configBindingRef: null, checker: null }, state.nativeLast, failedStatus);
      }
      code = windowsControlCode(state);
      if (code === "OK") {
        const observed = await refreshNative(state);
        code = observed.status === "PASS" && observed.code === "OK" ? windowsControlCode(state) : observed.code;
      }
      if (code !== "OK") {
        const failedStatus = state.nativeLast?.status === "BLOCKED" ? "BLOCKED" : undefined;
        await closeNativeState(state);
        return windowsResult(code, { binding: null, configBindingRef: null, checker: null }, state.nativeLast, failedStatus);
      }
      return windowsResult("OK", {
        binding: prepared.binding, configBindingRef: prepared.configBindingRef, checker: prepared.checker,
      }, state.nativeLast);
    } catch {
      nativeUnknown(state);
      if (state && Object.hasOwn(state, "nativeCapability")) await closeNativeState(state);
      return windowsResult("NATIVE_IO_FAILED", { binding: null, configBindingRef: null, checker: null }, state?.nativeLast ?? null);
    }
  }

  async function issueWindowsPermit(binding, input) {
    let state = null;
    try {
      if (!belongs(bindings, binding)) return windowsResult("INVALID_BINDING", { token: null }, null);
      state = bindings.get(binding);
      let code = windowsControlCode(state);
      if (code !== "OK") return windowsResult(code, { token: null }, state.nativeLast);
      if (!Object.hasOwn(state, "nativeCapability")) return windowsResult("INVALID_BINDING", { token: null }, state.nativeLast);
      if (state.permitIssued) return windowsResult("PERMIT_ALREADY_ISSUED", { token: null }, state.nativeLast);
      const grant = copyGrant(state, input);
      const observed = await refreshNative(state);
      code = observed.status === "PASS" && observed.code === "OK" ? windowsControlCode(state) : observed.code;
      if (code !== "OK") return windowsResult(code, { token: null }, state.nativeLast);
      const issued = issueSyntheticPermit(binding, grant);
      return windowsResult(issued.code, { token: issued.token }, state.nativeLast);
    } catch (error) {
      if (error !== INVALID) nativeUnknown(state);
      return windowsResult(error === INVALID ? "INVALID_INPUT" : "NATIVE_IO_FAILED", { token: null }, state?.nativeLast ?? null);
    }
  }

  async function closeWindowsBinding(binding) {
    if (!belongs(bindings, binding)) return windowsResult("INVALID_BINDING", {}, null);
    const state = bindings.get(binding);
    if (!Object.hasOwn(state, "nativeCapability")) return windowsResult("INVALID_BINDING", {}, state.nativeLast);
    return closeNativeState(state);
  }

  function observeWindows(binding) {
    if (!belongs(bindings, binding)) return windowsResult("INVALID_BINDING", {}, null);
    const state = bindings.get(binding);
    if (!Object.hasOwn(state, "nativeCapability")) return windowsResult("INVALID_BINDING", {}, state.nativeLast);
    try {
      const observed = observeNativeEvidence(state.nativeCapability);
      const native = safeNative(observed);
      if (native === null || typeof observed.busy !== "boolean" ||
          !["idle", "validate", "write", "close"].includes(observed.operation)) {
        throw new Error("NATIVE_IO_FAILED");
      }
      return windowsResult(native.code, {}, deepFreeze({ ...native, busy: observed.busy, operation: observed.operation }));
    } catch {
      nativeUnknown(state);
      return windowsResult("NATIVE_IO_FAILED", {}, state.nativeLast);
    }
  }

  function copyResponses(value) {
    return deepFreeze(dataArray(value, 12, 1).map((response) => {
      const frame = dataRecord(response, ["endpointId", "attempt", "status", "parseable", "model", "capability", "challenge", "elapsedMs"]);
      if (!ENDPOINTS.some((endpoint) => endpoint.id === frame.endpointId) ||
          (frame.attempt !== 1 && frame.attempt !== 2) || !Number.isInteger(frame.status) ||
          frame.status < 100 || frame.status > 599 || typeof frame.parseable !== "boolean" ||
          !["DS-K1T671BM", "SYNTHETIC_OTHER_MODEL", "SYNTHETIC_UNKNOWN_MODEL"].includes(frame.model) ||
          !["confirmed", "unsupported", "unknown"].includes(frame.capability) ||
          !Number.isInteger(frame.elapsedMs) || frame.elapsedMs < 0 || frame.elapsedMs > 600000) invalid();
      if (frame.status !== 401 && frame.challenge !== null) invalid();
      if (frame.challenge !== null) {
        const challenge = dataRecord(frame.challenge, ["algorithm", "qop"]);
        if (!["SHA-256", "MD5", "unsupported", "malformed", "absent"].includes(challenge.algorithm) ||
            !["auth", "auth-int", "unsupported", "malformed", "absent"].includes(challenge.qop)) invalid();
        frame.challenge = challenge;
      }
      return frame;
    }));
  }

  function createFakeTransport(input) {
    try {
      const data = dataRecord(input, ["expected", "responses"]);
      const expected = copyExpected(data.expected);
      const responses = copyResponses(data.responses);
      const fakeTransport = handle();
      transports.set(fakeTransport, { expected, responses, position: 0, calls: 0, trace: [], last: null });
      return result("OK", { fakeTransport });
    } catch (error) {
      return result(error === INVALID ? "INVALID_INPUT" : "INTERNAL_ERROR", { fakeTransport: null });
    }
  }

  function createFakeOutput(input) {
    try {
      const data = dataRecord(input, ["outcome"]);
      if (!["success", "fail", "throw"].includes(data.outcome)) invalid();
      const fakeOutput = handle();
      outputs.set(fakeOutput, { outcome: data.outcome, calls: 0, last: null });
      return result("OK", { fakeOutput });
    } catch (error) {
      return result(error === INVALID ? "INVALID_INPUT" : "INTERNAL_ERROR", { fakeOutput: null });
    }
  }

  function cancelSyntheticBinding(binding) {
    try {
      if (!belongs(bindings, binding)) return result("INVALID_BINDING");
      bindings.get(binding).cancelled = true;
      return result("OK");
    } catch { return result("INTERNAL_ERROR"); }
  }

  function observeTransport(fakeTransport) {
    try {
      if (!belongs(transports, fakeTransport)) {
        return result("INVALID_TRANSPORT", { calls: 0, trace: [], last: null, remainingResponses: 0 });
      }
      const transport = transports.get(fakeTransport);
      // Observing an in-flight session must not freeze its private trace array.
      return result("OK", {
        calls: transport.calls, trace: transport.trace.map((entry) => ({ ...entry })),
        last: transport.last, remainingResponses: transport.responses.length - transport.position,
      });
    } catch {
      return result("INTERNAL_ERROR", { calls: 0, trace: [], last: null, remainingResponses: 0 });
    }
  }

  function observeOutput(fakeOutput) {
    try {
      if (!belongs(outputs, fakeOutput)) return result("INVALID_OUTPUT", { calls: 0, last: null });
      const output = outputs.get(fakeOutput);
      return result("OK", { calls: output.calls, last: output.last });
    } catch { return result("INTERNAL_ERROR", { calls: 0, last: null }); }
  }

  async function runOffline(binding, token, fakeTransport, fakeOutput, windowsExecution) {
    let configBindingRef = null;
    let state;
    let permit;
    let transport;
    let output;
    let sessionStarted;
    let counts;
    let stages;
    let currentStage = null;

    function sessionCode() {
      // Only private records captured after brand validation reach this helper.
      if (!belongs(bindings, binding) || bindings.get(binding) !== state ||
          !belongs(permits, token) || permits.get(token) !== permit || permit.binding !== binding) return "INVALID_PERMIT";
      if (permit.revoked) return "PERMIT_REVOKED";
      if (state.epoch !== epoch || permit.epoch !== epoch) return "CONTEXT_CHANGED";
      if (state.cancelled) return "SESSION_CANCELLED";
      if (windowsExecution) {
        const nativeCode = windowsControlCode(state);
        if (nativeCode !== "OK") return nativeCode;
      }
      if (now < permit.windowStart) return "PERMIT_NOT_YET_VALID";
      if (now >= permit.windowEnd) return "PERMIT_EXPIRED";
      if (now - sessionStarted >= state.snapshot.execution.limits.sessionDeadlineMs) return "SESSION_DEADLINE_EXCEEDED";
      return "OK";
    }

    function summaryFor(code) {
      return deepFreeze({
        schemaVersion: "hk-ai-08-offline-summary-v1", phase: "synthetic-offline-only",
        status: code === "OK" ? "PASS" : "FAIL", code,
        counts: { ...counts, unknownEndpoints: stages.filter((stage) => stage.state === "unknown").length },
        stages: stages.map((stage) => ({ ...stage })),
        allowReadStayedFalse: state.snapshot.candidate.allowRead === false,
      });
    }

    function executionResult(code, summary) {
      if (windowsExecution) {
        return windowsResult(code, { configBindingRef, summary }, state?.nativeLast ?? null);
      }
      return result(code, { configBindingRef, summary });
    }

    function markBlocked(code) {
      if (currentStage !== null && currentStage.transmissions !== 0) {
        currentStage.state = "blocked";
        currentStage.code = code;
      }
    }

    async function finishWindows(code) {
      try {
      let controlCode = sessionCode();
      if (controlCode !== "OK") {
        markBlocked(controlCode);
        return executionResult(controlCode, summaryFor(controlCode));
      }
      if (counts.transmissions === 0) return executionResult(code, summaryFor(code));
      const validated = await refreshNative(state);
      controlCode = sessionCode();
      if (controlCode !== "OK") {
        markBlocked(controlCode);
        return executionResult(controlCode, summaryFor(controlCode));
      }
      if (validated.status !== "PASS" || validated.code !== "OK") {
        markBlocked(validated.code);
        return executionResult(validated.code, summaryFor(validated.code));
      }
      // Only the closed session projection crosses the broker pipe. Native
      // files are CreateNew records of this pre-final-output summary; they are
      // never overwritten to conceal a later control or output failure.
      const written = safeNative(await writeNativeEvidence(state.nativeCapability, summaryFor(code)));
      if (written === null) throw new Error("NATIVE_IO_FAILED");
      state.nativeLast = written;
      if (written.status !== "PASS" || written.code !== "OK") state.nativeFailureCode = written.code;
      controlCode = sessionCode();
      if (controlCode !== "OK") {
        markBlocked(controlCode);
        return executionResult(controlCode, summaryFor(controlCode));
      }
      if (written.status !== "PASS" || written.code !== "OK") {
        markBlocked(written.code);
        return executionResult(written.code, summaryFor(written.code));
      }
      const checkNames = ["platformSupported", "identitySupported", "locationSupported", "ancestorHandlesHeld",
        "rootCreatedExclusive", "rootAclValid", "nativeIdentityValid", "rootEntriesValid", "filesCreatedExclusive",
        "fileAclsValid", "contentVerified", "flushVerified", "deleteSharingDenied"];
      if (written.checks === null || typeof written.checks !== "object" ||
          Object.keys(written.checks).length !== checkNames.length ||
          !checkNames.every((name) => written.checks[name] === true) ||
          written.counts?.directoriesCreated !== 1 || written.counts?.filesCreated !== 2 ||
          !Number.isSafeInteger(written.counts?.bytesWritten) || written.counts.bytesWritten <= 0 ||
          written.counts.bytesVerified !== written.counts.bytesWritten || written.counts.flushes !== 2 ||
          written.newObjectStateUnverified !== false || written.retained !== true || written.closed !== false) {
        state.nativeFailureCode = "NATIVE_WRITE_UNVERIFIED";
        markBlocked(state.nativeFailureCode);
        return executionResult(state.nativeFailureCode, summaryFor(state.nativeFailureCode));
      }
      return executionResult(code, summaryFor(code));
      } catch {
        nativeUnknown(state);
        state.nativeFailureCode = "NATIVE_IO_FAILED";
        markBlocked(state.nativeFailureCode);
        return executionResult(state.nativeFailureCode, summaryFor(state.nativeFailureCode));
      }
    }

    function finish(code) {
      if (windowsExecution) return finishWindows(code);
      const controlCode = sessionCode();
      if (controlCode !== "OK") {
        code = controlCode;
        if (currentStage !== null && currentStage.transmissions !== 0) {
          currentStage.state = "blocked";
          currentStage.code = code;
        }
      }
      let summary = summaryFor(code);
      if (counts.transmissions !== 0 && controlCode === "OK") {
        output.calls += 1;
        output.last = summary;
        try {
          if (output.outcome === "throw") throw SIMULATED_FAILURE;
          if (output.outcome === "fail") code = "FAKE_OUTPUT_FAILED";
        } catch { code = "FAKE_OUTPUT_FAILED"; }
        // A failed output attempt keeps its attempted summary in output.last;
        // the execute result separately records that output failure.
        if (code !== summary.code) summary = summaryFor(code);
      }
      return executionResult(code, summary);
    }

    function block(code) {
      if (currentStage !== null && currentStage.transmissions !== 0) {
        currentStage.state = "blocked";
        currentStage.code = code;
      }
      return finish(code);
    }

    async function invoke(endpoint, attempt) {
      let code = sessionCode();
      if (code !== "OK") return { code, response: null };
      await Promise.resolve();
      code = sessionCode();
      if (code !== "OK") return { code, response: null };
      if (windowsExecution) {
        const validated = await refreshNative(state);
        code = sessionCode();
        if (code !== "OK") return { code, response: null };
        if (validated.status !== "PASS" || validated.code !== "OK") return { code: validated.code, response: null };
      }
      if (counts.transmissions >= 12) return { code: "TRANSMISSION_BUDGET_EXCEEDED", response: null };
      const requestStarted = now;
      if (currentStage.transmissions === 0) counts.logicalEndpoints += 1;
      currentStage.transmissions += 1;
      currentStage.state = "blocked";
      currentStage.code = "INTERNAL_ERROR";
      counts.transmissions += 1;
      if (attempt === 2) counts.authRetries += 1;
      transport.calls += 1;
      transport.last = compareExecution(state, transport.expected);
      const trace = { endpointId: endpoint.id, attempt, authenticated: attempt === 2, requestMatched: false };
      transport.trace.push(trace);
      if (!transport.last.matched) return { code: "FAKE_EXPECTATION_MISMATCH", response: null };
      if (transport.position >= transport.responses.length) return { code: "FAKE_SCRIPT_EXHAUSTED", response: null };
      const response = transport.responses[transport.position++];
      trace.requestMatched = response.endpointId === endpoint.id && response.attempt === attempt;
      if (!trace.requestMatched) return { code: "FAKE_SCRIPT_MISMATCH", response: null };
      await Promise.resolve();
      code = sessionCode();
      if (code !== "OK") return { code, response: null };
      if (!Number.isSafeInteger(now + response.elapsedMs)) return { code: "CLOCK_OVERFLOW", response: null };
      now += response.elapsedMs;
      code = sessionCode();
      if (code !== "OK") return { code, response: null };
      const elapsed = now - requestStarted;
      const limits = state.snapshot.execution.limits;
      if (elapsed >= limits.requestDeadlineMs) return { code: "REQUEST_DEADLINE_EXCEEDED", response: null };
      if (elapsed >= limits.timeoutMs) return { code: "INACTIVITY_TIMEOUT", response: null };
      return { code: "OK", response };
    }

    try {
      if (!belongs(bindings, binding)) return executionResult("INVALID_BINDING", null);
      state = bindings.get(binding);
      configBindingRef = state.configBindingRef;
      if (!belongs(transports, fakeTransport)) return executionResult("INVALID_TRANSPORT", null);
      if (windowsExecution) {
        const nativeCode = windowsControlCode(state);
        if (nativeCode !== "OK") return executionResult(nativeCode, null);
        if (!Object.hasOwn(state, "nativeCapability")) return executionResult("INVALID_BINDING", null);
      } else if (!belongs(outputs, fakeOutput)) return executionResult("INVALID_OUTPUT", null);
      if (!belongs(permits, token)) return executionResult("INVALID_PERMIT", null);
      if (state.cancelled) return executionResult("SESSION_CANCELLED", null);
      permit = permits.get(token);
      const code = permitCode(binding, state, permit);
      if (code !== "OK") return executionResult(code, null);
      transport = transports.get(fakeTransport);
      if (!windowsExecution) output = outputs.get(fakeOutput);
      counts = { logicalEndpoints: 0, transmissions: 0, authRetries: 0, unknownEndpoints: 0 };
      stages = ENDPOINTS.map((endpoint) => ({ id: endpoint.id, state: "NOT_EXECUTED", code: "NOT_EXECUTED", httpStatus: null, transmissions: 0 }));
      sessionStarted = now;
      // One permit authorizes only this synthetic session; it is consumed
      // before the first await and never restored by any finish/error path.
      permit.used = true;
      await Promise.resolve();
      let controlCode = sessionCode();
      if (controlCode !== "OK") return finish(controlCode);
      for (let index = 0; index < ENDPOINTS.length; index += 1) {
        const endpoint = ENDPOINTS[index];
        currentStage = stages[index];
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const invocation = await invoke(endpoint, attempt);
          if (invocation.code !== "OK") return block(invocation.code);
          controlCode = sessionCode();
          if (controlCode !== "OK") return block(controlCode);
          const response = invocation.response;
          currentStage.httpStatus = response.status;
          if (response.status === 401) {
            if (attempt === 2) return block("AUTH_RETRY_EXHAUSTED");
            if (!response.parseable || response.challenge === null ||
                response.challenge.algorithm !== "SHA-256" || response.challenge.qop !== "auth") {
              return block("AUTH_CHALLENGE_REJECTED");
            }
            continue;
          }
          if (index === 0) {
            if (response.status !== 200) return block("G1_HTTP_STATUS");
            if (!response.parseable) return block("G1_RESPONSE_INVALID");
            if (response.model !== state.snapshot.target.model) return block("G1_MODEL_MISMATCH");
            currentStage.state = "confirmed";
            currentStage.code = "OK";
          } else if (response.status !== 200) {
            currentStage.state = "unknown";
            currentStage.code = "HTTP_STATUS";
          } else if (!response.parseable) {
            currentStage.state = "unknown";
            currentStage.code = "RESPONSE_INVALID";
          } else {
            currentStage.state = response.capability;
            currentStage.code = "OK";
          }
          break;
        }
      }
      currentStage = null;
      controlCode = sessionCode();
      if (controlCode !== "OK") return finish(controlCode);
      if (transport.position !== transport.responses.length) return finish("FAKE_SCRIPT_REMAINS");
      return finish("OK");
    } catch {
      if (!counts || !stages || !state || !permit || (!windowsExecution && !output)) return executionResult("INTERNAL_ERROR", null);
      if (windowsExecution) {
        nativeUnknown(state);
        state.nativeFailureCode = "NATIVE_IO_FAILED";
        markBlocked(state.nativeFailureCode);
        return executionResult(state.nativeFailureCode, summaryFor(state.nativeFailureCode));
      }
      return block("INTERNAL_ERROR");
    }
  }

  function executeOffline(binding, token, fakeTransport, fakeOutput) {
    return runOffline(binding, token, fakeTransport, fakeOutput, false);
  }

  function executeWindows(binding, token, fakeTransport) {
    return runOffline(binding, token, fakeTransport, null, true);
  }

  if (windowsMode) {
    return Object.freeze({
      prepareWindowsBytes, createFakeTransport, issueWindowsPermit, executeWindows,
      closeWindowsBinding, observeWindows, revokeSyntheticPermit, advanceSyntheticTime,
      replaceSyntheticRuntime, cancelSyntheticBinding, observeTransport,
    });
  }

  if (entryMode) {
    return Object.freeze({
      prepareBytes, createFakeTransport, createFakeOutput, issueSyntheticPermit,
      revokeSyntheticPermit, advanceSyntheticTime, replaceSyntheticRuntime,
      cancelSyntheticBinding, executeOffline, observeTransport, observeOutput,
    });
  }

  return Object.freeze({
    prepare, createFakeExecutor, issueSyntheticPermit, executeSynthetic,
    revokeSyntheticPermit, advanceSyntheticTime, replaceSyntheticRuntime, observeFake,
  });
}

export function createSyntheticBindingBridge(initialContext) {
  return createBridge(initialContext, false);
}

export function createSyntheticOfflineEntry(initialContext) {
  return createBridge(initialContext, true);
}

export function createSyntheticWindowsEvidenceEntry(initialContext) {
  return createBridge(initialContext, true, true);
}
