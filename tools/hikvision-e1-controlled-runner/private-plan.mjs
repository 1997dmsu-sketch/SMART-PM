import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { checkOfflineConfig } from "../hikvision-offline-config-checker/src/check-config.mjs";

// CR-1 has only a synthetic memory model. These registries never constitute
// externally verified approval, a native evidence capability, or device access.
const cores = new WeakMap();
const states = new WeakMap();
const tickets = new WeakMap();
const INVALID = Symbol("invalid-plan-input");
const SCHEMA = "hk-ai-08-controlled-e1-v1";
const TERMINAL = new Set(["COMPLETED", "FAILED", "UNKNOWN", "INVALIDATED"]);
const EDGES = Object.freeze({
  SEALED: ["EVIDENCE_READY"],
  EVIDENCE_READY: ["ARMED"], ARMED: ["CONSUMED"], CONSUMED: ["COMPLETED"],
});
const EVENTS = new Set([
  "CAPTURED", "CHECKER", "CHECKED", "SEALED", "EVIDENCE_READY", "ARMED",
  "CONSUMED", "SYNTHETIC_MINT", "SYNTHETIC_ACTIVE", "COMPLETED", "FAILED",
  "UNKNOWN", "INVALIDATED", "CONTROL_CHECKED", "GATE_PREPARING",
]);
const CODES = new Set([
  "OK", "CONFIG_UNVERIFIED", "APPROVAL_UNVERIFIED", "AUTHORIZATION_INVALID",
  "CONFIG_REJECTED", "RUNNER_MODEL_INCOMPATIBLE", "PLAN_INVALID",
  "EVIDENCE_GATE_UNVERIFIED", "EVIDENCE_GATE_FAILED", "EVIDENCE_GATE_INVALID",
  "PLAN_CONSUMED", "REQUEST_OUT_OF_SCOPE", "PROBE_FAILED",
  "REQUEST_OUTCOME_UNKNOWN", "EVIDENCE_WRITE_FAILED", "INTERNAL_ERROR",
]);

function record(value, keys) {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) throw INVALID;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw INVALID;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((key) => typeof key !== "string" || !keys.includes(key))) throw INVALID;
  const desc = Object.getOwnPropertyDescriptors(value);
  const output = Object.create(null);
  for (const key of keys) {
    const slot = desc[key];
    if (!slot || !slot.enumerable || !Object.hasOwn(slot, "value")) throw INVALID;
    output[key] = slot.value;
  }
  return output;
}

function string(value, maximum) {
  if (typeof value !== "string" || value.length > maximum) throw INVALID;
  return value;
}

function pinArray(value) {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype) throw INVALID;
  const desc = Object.getOwnPropertyDescriptors(value);
  const length = desc.length?.value;
  if (!Number.isInteger(length) || length < 1 || length > 2) throw INVALID;
  const allowed = ["length", ...Array.from({ length }, (_, i) => String(i))];
  const own = Reflect.ownKeys(value);
  if (own.length !== allowed.length || own.some((key) => typeof key !== "string" || !allowed.includes(key))) throw INVALID;
  return Array.from({ length }, (_, i) => {
    const slot = desc[String(i)];
    if (!slot || !slot.enumerable || !Object.hasOwn(slot, "value")) throw INVALID;
    return string(slot.value, 16384);
  });
}

function freezeTree(value) {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) freezeTree(value[key]);
    Object.freeze(value);
  }
  return value;
}

function copyInput(input) {
  const root = record(input, ["schemaVersion", "checkerInput", "credentials", "tls", "bounds", "authorization", "outputPolicy"]);
  if (root.schemaVersion !== SCHEMA) throw INVALID;
  const checker = record(root.checkerInput, ["schemaVersion", "approvalRef", "approvedTarget", "candidate"]);
  const target = record(checker.approvedTarget, ["deviceRef", "host", "port", "model"]);
  const candidate = record(checker.candidate, ["deviceRef", "host", "allowedHosts", "port", "allowedPorts", "expectedModel", "allowRead"]);
  for (const [key, value] of Object.entries(target)) string(value, key === "host" ? 253 : 128);
  for (const [key, value] of Object.entries(candidate)) {
    if (key === "allowRead") { if (typeof value !== "boolean") throw INVALID; }
    else string(value, key === "expectedModel" || key === "deviceRef" ? 128 : 16384);
  }
  string(checker.schemaVersion, 128);
  string(checker.approvalRef, 128);
  checker.approvedTarget = target;
  checker.candidate = candidate;
  const credentials = record(root.credentials, ["username", "password"]);
  string(credentials.username, 128);
  string(credentials.password, 4096);
  const tls = record(root.tls, ["mode", "fingerprints"]);
  string(tls.mode, 64);
  tls.fingerprints = pinArray(tls.fingerprints);
  const bounds = record(root.bounds, ["timeoutMs", "maxBytes"]);
  if (typeof bounds.timeoutMs !== "number" || typeof bounds.maxBytes !== "number") throw INVALID;
  const authorization = record(root.authorization, ["windowStartMs", "windowEndMs"]);
  if (typeof authorization.windowStartMs !== "number" || typeof authorization.windowEndMs !== "number") throw INVALID;
  const outputPolicy = record(root.outputPolicy, ["version"]);
  string(outputPolicy.version, 128);
  return freezeTree({ schemaVersion: SCHEMA, checkerInput: checker, credentials, tls, bounds, authorization, outputPolicy });
}

function fault(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function stateFor(plan) {
  const state = states.get(plan);
  if (!state) throw fault("PLAN_INVALID");
  return state;
}

function result(state, ok, code = state.code) {
  return Object.freeze({ ok, code, state: state.state });
}

function fail(plan, code, stateName = "FAILED") {
  const state = stateFor(plan);
  if (!TERMINAL.has(state.state)) {
    state.state = stateName;
    state.code = CODES.has(code) ? code : "INTERNAL_ERROR";
    state.stopLatched = true;
    state.trace.push(stateName);
  }
  return result(state, false);
}

/** Capture submitted data exactly once; no source callback, getter, I/O or env. */
export function capturePlan(input) {
  try {
    const captured = copyInput(input);
    const plan = Object.freeze(Object.create(null));
    cores.set(plan, Object.freeze({ captured }));
    states.set(plan, {
      state: "CAPTURED", code: "OK", checkerPassed: false, runnerCompatible: false,
      sourceCaptureCount: 1, checkerInvocationCount: 0, consumed: false,
      stopLatched: false, mintCount: 0, activationCount: 0,
      evidenceSessionClaimed: false,
      planRef: "plan-" + randomUUID(), trace: ["CAPTURED"],
    });
    return Object.freeze({ ok: true, code: "OK", plan });
  } catch {
    return Object.freeze({ ok: false, code: "CONFIG_UNVERIFIED", plan: null });
  }
}

export function isPlanToken(plan) {
  return !!plan && (typeof plan === "object" || typeof plan === "function") && cores.has(plan);
}

/** Internal synthetic-model validation. This does not verify real approval. */
export function checkCapturedPlan(plan) {
  const state = stateFor(plan);
  if (state.state !== "CAPTURED") return result(state, false, state.consumed ? "PLAN_CONSUMED" : "PLAN_INVALID");
  const captured = cores.get(plan).captured;
  state.checkerInvocationCount += 1;
  state.trace.push("CHECKER");
  const checked = checkOfflineConfig(captured.checkerInput);
  state.checkerPassed = checked.status === "PASS";
  if (!state.checkerPassed) return fail(plan, "CONFIG_REJECTED");
  state.state = "CHECKED";
  state.trace.push("CHECKED");
  const candidate = captured.checkerInput.candidate;
  if (candidate.expectedModel.trim() !== candidate.expectedModel) return fail(plan, "RUNNER_MODEL_INCOMPATIBLE");
  // Exact fixed P:http.mjs normalizeFingerprint semantics, after the input is
  // already proven to be a primitive string. No arbitrary String()/toString.
  const normalizedPins = captured.tls.fingerprints.map((pin) => pin.replace(/[^0-9a-f]/gi, "").toUpperCase());
  const pins = [...new Set(normalizedPins)];
  const { timeoutMs, maxBytes } = captured.bounds;
  const { windowStartMs, windowEndMs } = captured.authorization;
  if (!captured.credentials.username.trim() || !captured.credentials.password ||
      captured.tls.mode !== "fingerprint-pinned" || !normalizedPins.every((pin) => /^[0-9A-F]{64}$/.test(pin)) ||
      pins.length < 1 || pins.length > 2 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 262144 ||
      !Number.isSafeInteger(windowStartMs) || windowStartMs < 0 ||
      !Number.isSafeInteger(windowEndMs) || windowEndMs <= windowStartMs ||
      captured.outputPolicy.version !== "hk-ai-08-windows-evidence-v1") return fail(plan, "CONFIG_UNVERIFIED");
  const binding = freezeTree({
    deviceRef: candidate.deviceRef, host: candidate.host.trim().toLowerCase(), port: Number(candidate.port),
    allowedHosts: candidate.allowedHosts.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean),
    allowedPorts: candidate.allowedPorts.split(",").map((port) => Number(port.trim())),
    expectedModel: candidate.expectedModel, username: captured.credentials.username,
    password: captured.credentials.password, fingerprints: pins,
    timeoutMs, maxBytes, tlsMode: "fingerprint-pinned",
  });
  // Stable core is replaced exactly once during sealing, never after SEALED.
  cores.set(plan, Object.freeze({ captured, binding }));
  state.runnerCompatible = true;
  state.state = "SEALED";
  state.trace.push("SEALED");
  return result(state, true, "OK");
}

export function advancePlan(plan, next, event = next) {
  const state = stateFor(plan);
  if (state.stopLatched || !EDGES[state.state]?.includes(next) || !EVENTS.has(event)) throw fault(state.consumed ? "PLAN_CONSUMED" : "PLAN_INVALID");
  state.state = next;
  state.trace.push(event);
  return result(state, true, "OK");
}

export function consumeCapturedPlan(plan) {
  const state = stateFor(plan);
  if (state.consumed) throw fault("PLAN_CONSUMED");
  if (state.stopLatched || state.state !== "ARMED") throw fault("PLAN_INVALID");
  // No await or caller callback occurs between the final check and this write.
  state.consumed = true;
  state.state = "CONSUMED";
  state.trace.push("CONSUMED");
  const ticket = Object.freeze(Object.create(null));
  tickets.set(ticket, { plan, claimed: false });
  state.mintCount += 1;
  state.trace.push("SYNTHETIC_MINT");
  return ticket;
}

/** One irreversible evidence-session claim per private plan, across models. */
export function claimEvidenceSession(plan) {
  if (!isPlanToken(plan)) return false;
  const state = states.get(plan);
  if (state.stopLatched || state.state !== "SEALED" || state.evidenceSessionClaimed) return false;
  state.evidenceSessionClaimed = true;
  return true;
}

export function claimActivationTicket(ticket, plan) {
  if (!isPlanToken(plan) || !ticket || (typeof ticket !== "object" && typeof ticket !== "function")) return false;
  const state = states.get(plan);
  const item = tickets.get(ticket);
  if (!item || item.plan !== plan || item.claimed || !state.consumed || state.stopLatched || state.state !== "CONSUMED") return false;
  item.claimed = true;
  state.activationCount += 1;
  state.trace.push("SYNTHETIC_ACTIVE");
  return true;
}

export function stopPlan(plan, code, stateName = "FAILED") {
  if (!["FAILED", "UNKNOWN", "INVALIDATED"].includes(stateName)) throw fault("PLAN_INVALID");
  return fail(plan, code, stateName);
}

export function getSyntheticWindow(plan) {
  stateFor(plan);
  const window = cores.get(plan).captured.authorization;
  return Object.freeze({ windowStartMs: window.windowStartMs, windowEndMs: window.windowEndMs });
}

export function matchesCapturedInput(plan, input) {
  if (!isPlanToken(plan)) return false;
  try { return isDeepStrictEqual(copyInput(input), cores.get(plan).captured); }
  catch { return false; }
}

function primitiveArray(value, kind, minimum, maximum) {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype) throw INVALID;
  const desc = Object.getOwnPropertyDescriptors(value);
  const length = desc.length?.value;
  if (!Number.isInteger(length) || length < minimum || length > maximum) throw INVALID;
  const allowed = ["length", ...Array.from({ length }, (_, i) => String(i))];
  const own = Reflect.ownKeys(value);
  if (own.length !== allowed.length || own.some((key) => typeof key !== "string" || !allowed.includes(key))) throw INVALID;
  return Array.from({ length }, (_, i) => {
    const slot = desc[String(i)];
    if (!slot || !slot.enumerable || !Object.hasOwn(slot, "value") || typeof slot.value !== kind) throw INVALID;
    return slot.value;
  });
}

/** Boolean-only oracle for the synthetic fixture; never returns private data. */
export function matchesNormalizedBinding(plan, expected) {
  if (!isPlanToken(plan) || !cores.get(plan).binding) return false;
  try {
    const copy = record(expected, ["deviceRef", "host", "port", "allowedHosts", "allowedPorts", "expectedModel", "username", "password", "fingerprints", "timeoutMs", "maxBytes", "tlsMode"]);
    for (const key of ["deviceRef", "host", "expectedModel", "username", "password", "tlsMode"]) string(copy[key], 4096);
    for (const key of ["port", "timeoutMs", "maxBytes"]) if (typeof copy[key] !== "number") throw INVALID;
    copy.allowedHosts = primitiveArray(copy.allowedHosts, "string", 1, 1);
    copy.allowedPorts = primitiveArray(copy.allowedPorts, "number", 1, 1);
    copy.fingerprints = primitiveArray(copy.fingerprints, "string", 1, 2);
    return isDeepStrictEqual({ ...copy }, cores.get(plan).binding);
  } catch { return false; }
}

export function inspectPlan(plan) {
  const state = stateFor(plan);
  const core = cores.get(plan);
  return freezeTree({
    scope: "cr1-synthetic-only", state: state.state, code: state.code, planRef: state.planRef,
    checkerPassed: state.checkerPassed, runnerCompatible: state.runnerCompatible,
    consumed: state.consumed, stopLatched: state.stopLatched,
    sourceCaptureCount: state.sourceCaptureCount, checkerInvocationCount: state.checkerInvocationCount,
    mintCount: state.mintCount, activationCount: state.activationCount,
    invokeCount: 0, transportInvocationCount: 0,
    checkerAllowReadDisabled: core.captured.checkerInput.candidate.allowRead === false,
    coreFrozen: Object.isFrozen(core) && Object.isFrozen(core.captured),
    configurationFrozen: !!core.binding && Object.isFrozen(core.binding),
    trace: [...state.trace],
  });
}

export function fixedErrorCode(error) {
  if (!error || typeof error !== "object" || types.isProxy(error)) return "INTERNAL_ERROR";
  const slot = Object.getOwnPropertyDescriptor(error, "code");
  return slot && Object.hasOwn(slot, "value") && CODES.has(slot.value) ? slot.value : "INTERNAL_ERROR";
}

export function snapshotSyntheticControl(value, confirmed = false) {
  try {
    const control = record(value, confirmed ? ["nowMs", "fresh", "revoked", "approval", "confirmed"] : ["nowMs", "fresh", "revoked", "approval"]);
    if (typeof control.nowMs !== "number" || typeof control.fresh !== "boolean" || typeof control.revoked !== "boolean" ||
        typeof control.approval !== "string" || (confirmed && typeof control.confirmed !== "boolean")) throw INVALID;
    return Object.freeze(control);
  } catch { throw fault("APPROVAL_UNVERIFIED"); }
}

// ─────────────────────────────────────────────────────────────────────────────
// CR-2 single private runtime owner. The original controller/session
// implementations are mechanically relocated into this module scope so that
// plan, session, control state, identity and invoke claim share one owner.
// The former modules remain byte-compatible facades only. No second plan,
// control state or session registry is created anywhere.

const IDS = Object.freeze([
  "deviceInfo", "acsCapabilities", "userInfoCapabilities",
  "fdlibCapabilities", "fdlibList", "fdlibCount",
]);
const FAULTS = Object.freeze([
  "NONE", "PREFLIGHT_WRITE", "PREFLIGHT_READ", "PREFLIGHT_CLEANUP",
  "WRITE", "READ", "CLEANUP",
]);
const typedArrayLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), "byteLength",
).get;

function fixedError(code) {
  const error = new Error(code);
  Object.defineProperty(error, "code", { value: code, enumerable: true });
  return error;
}

function recordData(value, allowed, required = allowed) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) {
    throw fixedError("EVIDENCE_GATE_INVALID");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw fixedError("EVIDENCE_GATE_INVALID");
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key)) ||
      required.some((key) => !keys.includes(key))) throw fixedError("EVIDENCE_GATE_INVALID");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const copy = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw fixedError("EVIDENCE_GATE_INVALID");
    copy[key] = descriptor.value;
  }
  return copy;
}

function bodyCopy(body) {
  let copy;
  if (typeof body === "string") {
    if (Buffer.byteLength(body, "utf8") > 262144) throw fixedError("EVIDENCE_WRITE_FAILED");
    copy = new Uint8Array(Buffer.from(body, "utf8"));
  } else {
    if (body === null || typeof body !== "object" || types.isProxy(body) || !types.isUint8Array(body)) {
      throw fixedError("EVIDENCE_WRITE_FAILED");
    }
    const length = Reflect.apply(typedArrayLength, body, []);
    if (length > 262144) throw fixedError("EVIDENCE_WRITE_FAILED");
    copy = new Uint8Array(length);
    // Intrinsic typed-array copying does not read caller accessors or species.
    Reflect.apply(Uint8Array.prototype.set, copy, [body]);
  }
  return copy;
}

/**
 * A fixed in-memory CR-1 model. It cannot create a native/Windows resource,
 * invoke a writer callback, or be supplied to the real public entry point.
 */
export function createSyntheticEvidenceModel() {
  const sessions = new WeakMap();
  const events = [];

  function get(session, plan) {
    if (!sessions.has(session)) throw fixedError("EVIDENCE_GATE_INVALID");
    const state = sessions.get(session);
    if (!isPlanToken(plan) || state.plan !== plan) trip(state, "EVIDENCE_GATE_INVALID");
    return state;
  }

  function trip(state, code) {
    if (state.state !== "FAILED" && state.state !== "CLOSED") {
      state.state = "FAILED";
      state.latched = true;
      events.push("FAILED");
    }
    // A failed evidence attempt consumes this bound plan's usable lifetime;
    // another model may not reclaim it and manufacture a fresh READY session.
    stopPlan(state.plan, code);
    throw fixedError(code);
  }

  function requireState(state, allowedStates) {
    if (state.latched || !allowedStates.includes(state.state)) trip(state, "EVIDENCE_GATE_INVALID");
  }

  function requireLivePlan(state, allowedStates) {
    const plan = inspectPlan(state.plan);
    if (plan.stopLatched || !allowedStates.includes(plan.state)) trip(state, "EVIDENCE_GATE_INVALID");
  }

  function prepare(plan, options = {}) {
    if (!isPlanToken(plan)) throw fixedError("EVIDENCE_GATE_INVALID");
    if (inspectPlan(plan).state !== "SEALED" || !claimEvidenceSession(plan)) {
      stopPlan(plan, "EVIDENCE_GATE_INVALID");
      throw fixedError("EVIDENCE_GATE_INVALID");
    }
    const session = Object.freeze(Object.create(null));
    const state = {
      plan, state: "NEW", latched: false, fault: "NONE", records: new Map(),
      recordCount: 0, bytesWritten: 0, closed: false,
    };
    sessions.set(session, state);
    events.push("NEW");
    state.state = "PREPARING";
    events.push("PREPARING");
    let data;
    try { data = recordData(options, ["fault"], []); } catch { trip(state, "EVIDENCE_GATE_FAILED"); }
    const fault = Object.hasOwn(data, "fault") ? data.fault : "NONE";
    if (typeof fault !== "string" || !FAULTS.includes(fault)) trip(state, "EVIDENCE_GATE_FAILED");
    state.fault = fault;
    if (fault.startsWith("PREFLIGHT_")) trip(state, "EVIDENCE_GATE_FAILED");
    state.state = "READY";
    events.push("READY");
    return session;
  }

  function assertReady(session, plan) {
    const state = get(session, plan);
    requireState(state, ["READY"]);
    requireLivePlan(state, ["SEALED", "EVIDENCE_READY", "ARMED"]);
    return true;
  }

  function activate(session, plan, ticket) {
    const state = get(session, plan);
    requireState(state, ["READY"]);
    if (!claimActivationTicket(ticket, plan)) trip(state, "EVIDENCE_GATE_INVALID");
    state.state = "ACTIVE";
    events.push("ACTIVE");
  }

  function writeResponse(session, plan, response) {
    const state = get(session, plan);
    requireState(state, ["ACTIVE"]);
    requireLivePlan(state, ["CONSUMED"]);
    let data;
    try { data = recordData(response, ["endpointId", "attempt", "body"]); } catch { trip(state, "EVIDENCE_WRITE_FAILED"); }
    if (typeof data.endpointId !== "string" || !IDS.includes(data.endpointId) ||
        !Number.isSafeInteger(data.attempt) || data.attempt < 1 || data.attempt > 2) {
      trip(state, "EVIDENCE_WRITE_FAILED");
    }
    const key = `${data.endpointId}:${data.attempt}`;
    if (state.records.has(key)) trip(state, "EVIDENCE_WRITE_FAILED");
    let bytes;
    try { bytes = bodyCopy(data.body); } catch { trip(state, "EVIDENCE_WRITE_FAILED"); }
    if (state.fault === "WRITE") trip(state, "EVIDENCE_WRITE_FAILED");
    state.records.set(key, bytes);
    state.recordCount += 1;
    state.bytesWritten += bytes.byteLength;
    events.push("MEMORY_WRITE");
    if (state.fault === "READ") trip(state, "EVIDENCE_WRITE_FAILED");
    // Read-back remains internal. No raw response or writer ability escapes.
    const readBack = state.records.get(key);
    if (readBack !== bytes || readBack.byteLength !== bytes.byteLength) trip(state, "EVIDENCE_WRITE_FAILED");
    events.push("MEMORY_READ");
    return Object.freeze({ bytes: bytes.byteLength, recordCount: state.recordCount });
  }

  function seal(session, plan) {
    const state = get(session, plan);
    requireState(state, ["ACTIVE"]);
    requireLivePlan(state, ["CONSUMED"]);
    state.state = "SEALED";
    events.push("SEALED");
  }

  function close(session, plan) {
    const state = get(session, plan);
    requireState(state, ["SEALED"]);
    // Closing only clears already-known private memory; it grants no READY or
    // write ability and remains safe if the bound plan was stopped after seal.
    if (state.fault === "CLEANUP") trip(state, "CLEANUP_UNVERIFIED");
    for (const bytes of state.records.values()) Reflect.apply(Uint8Array.prototype.fill, bytes, [0]);
    state.records.clear();
    state.closed = true;
    state.state = "CLOSED";
    events.push("CLOSED");
  }

  function fail(session, plan) {
    const state = get(session, plan);
    if (state.state === "CLOSED") throw fixedError("EVIDENCE_GATE_INVALID");
    if (state.state !== "FAILED") {
      state.state = "FAILED";
      state.latched = true;
      events.push("FAILED");
    }
    stopPlan(state.plan, "EVIDENCE_GATE_INVALID");
  }

  function inspect(session, plan) {
    const state = get(session, plan);
    return Object.freeze({
      scope: "synthetic-memory-only", state: state.state, latched: state.latched,
      recordCount: state.recordCount, bytesWritten: state.bytesWritten, closed: state.closed,
    });
  }

  return Object.freeze({
    prepare, assertReady, activate, writeResponse, seal, close, fail, inspect,
    trace: () => Object.freeze([...events]),
  });
}

function response(ok, code, state) {
  return Object.freeze({ ok, code, state });
}

/**
 * Pure CR-1 memory model with closed data controls, not a transport adapter.
 * No caller callback, source loader, writer, clock function or network factory
 * can be supplied. The production index never imports or accepts this model.
 */
export function createSyntheticController(input) {
  const captured = capturePlan(input);
  const plan = captured.plan;
  const model = createSyntheticEvidenceModel();
  let session = null;
  let currentControl = null;
  let lastNow = null;
  let preparing = false;

  const view = () => plan ? inspectPlan(plan) : Object.freeze({
    scope: "cr1-synthetic-only", state: "FAILED", code: captured.code,
    checkerPassed: false, runnerCompatible: false, consumed: false, stopLatched: true,
    sourceCaptureCount: 0, checkerInvocationCount: 0, mintCount: 0, activationCount: 0,
    invokeCount: 0, transportInvocationCount: 0, checkerAllowReadDisabled: false,
    coreFrozen: false, configurationFrozen: false, trace: Object.freeze([]),
  });
  function rejected(code) {
    return response(false, code, view().state);
  }
  function stop(code, stateName = "INVALIDATED") {
    if (plan && !TERMINAL.has(view().state)) stopPlan(plan, code, stateName);
    if (session) {
      try { model.fail(session, plan); } catch { /* fixed failure is retained */ }
    }
    return rejected(code);
  }
  function guardState(expected) {
    const state = view();
    if (!plan) return rejected(captured.code);
    if (state.consumed) return rejected("PLAN_CONSUMED");
    if (TERMINAL.has(state.state)) return rejected(state.code === "OK" ? "PLAN_INVALID" : state.code);
    if (!expected.includes(state.state)) return rejected("PLAN_INVALID");
    return null;
  }
  function control(value, requireConfirmed = false) {
    let next;
    try { next = snapshotSyntheticControl(value, requireConfirmed); }
    catch { return stop("APPROVAL_UNVERIFIED"); }
    if (next.approval !== "VERIFIED_SYNTHETIC" || !next.fresh) return stop("APPROVAL_UNVERIFIED");
    const { windowStartMs, windowEndMs } = getSyntheticWindow(plan);
    if (!Number.isSafeInteger(next.nowMs) || next.nowMs < 0 ||
        (lastNow !== null && next.nowMs < lastNow) ||
        !Number.isSafeInteger(windowStartMs) || !Number.isSafeInteger(windowEndMs) ||
        next.nowMs < windowStartMs || next.nowMs >= windowEndMs || next.revoked) {
      return stop("AUTHORIZATION_INVALID");
    }
    lastNow = next.nowMs;
    currentControl = Object.freeze({ nowMs: next.nowMs, fresh: next.fresh, revoked: next.revoked, approval: next.approval });
    if (requireConfirmed && !next.confirmed) return rejected("AUTHORIZATION_INVALID");
    return null;
  }

  function check(value) {
    const rejectedState = guardState(["CAPTURED"]);
    if (rejectedState) return rejectedState;
    const invalidControl = control(value);
    if (invalidControl) return invalidControl;
    try { return checkCapturedPlan(plan); }
    catch { return stop("INTERNAL_ERROR", "FAILED"); }
  }

  function setControl(value) {
    const state = view();
    if (!plan) return rejected(captured.code);
    if (TERMINAL.has(state.state)) return rejected(state.code === "OK" ? "PLAN_INVALID" : state.code);
    const invalidControl = control(value);
    return invalidControl || response(true, "OK", view().state);
  }

  async function prepare(options) {
    const rejectedState = guardState(["SEALED"]);
    if (rejectedState) return rejectedState;
    if (preparing) return rejected("PLAN_INVALID");
    const invalidControl = control(currentControl);
    if (invalidControl) return invalidControl;
    preparing = true;
    try {
      session = model.prepare(plan, options);
      // A fixed microtask boundary permits an interleaved data-only revoke or
      // expiry update; it never invokes a caller supplied callback.
      await Promise.resolve();
      const afterPrepare = guardState(["SEALED"]);
      if (afterPrepare) {
        model.fail(session, plan);
        return afterPrepare;
      }
      const stale = control(currentControl);
      if (stale) return stale;
      model.assertReady(session, plan);
      return advancePlan(plan, "EVIDENCE_READY");
    } catch (error) {
      const code = fixedErrorCode(error);
      return stop(code === "INTERNAL_ERROR" ? "EVIDENCE_GATE_FAILED" : code, "FAILED");
    } finally {
      preparing = false;
    }
  }

  function arm(value) {
    const rejectedState = guardState(["EVIDENCE_READY"]);
    if (rejectedState) return rejectedState;
    const invalidControl = control(value, true);
    if (invalidControl) return invalidControl;
    try {
      model.assertReady(session, plan);
      return advancePlan(plan, "ARMED");
    } catch { return stop("EVIDENCE_GATE_INVALID"); }
  }

  function consume(value) {
    const rejectedState = guardState(["ARMED"]);
    if (rejectedState) return rejectedState;
    const invalidControl = control(value);
    if (invalidControl) return invalidControl;
    try {
      model.assertReady(session, plan);
      // Final checks, CONSUMED, mint and activation all run synchronously.
      const ticket = consumeCapturedPlan(plan);
      model.activate(session, plan, ticket);
      return response(true, "OK", view().state);
    } catch (error) {
      const code = fixedErrorCode(error);
      return stop(code === "INTERNAL_ERROR" ? "EVIDENCE_GATE_INVALID" : code, "FAILED");
    }
  }

  function complete() {
    const state = view();
    if (!plan || state.state !== "CONSUMED" || state.stopLatched || !session) return rejected(state.consumed ? "PLAN_CONSUMED" : "PLAN_INVALID");
    try {
      model.seal(session, plan);
      model.close(session, plan);
      return advancePlan(plan, "COMPLETED");
    } catch { return stop("EVIDENCE_WRITE_FAILED", "FAILED"); }
  }

  function fail(options) {
    const state = view();
    if (!plan || TERMINAL.has(state.state)) return rejected(state.consumed ? "PLAN_CONSUMED" : "PLAN_INVALID");
    // Use the same closed descriptor reader without inspecting caller getters.
    try {
      if (!options || typeof options !== "object" || types.isProxy(options) || Array.isArray(options) ||
          ![null, Object.prototype].includes(Object.getPrototypeOf(options))) return stop("INTERNAL_ERROR", "FAILED");
      const own = Reflect.ownKeys(options);
      const slot = Object.getOwnPropertyDescriptor(options, "unknown");
      if (own.length !== 1 || own[0] !== "unknown" || !slot || !slot.enumerable ||
          !Object.hasOwn(slot, "value") || typeof slot.value !== "boolean") return stop("INTERNAL_ERROR", "FAILED");
      return stop(slot.value ? "REQUEST_OUTCOME_UNKNOWN" : "INTERNAL_ERROR", slot.value ? "UNKNOWN" : "FAILED");
    } catch { return stop("INTERNAL_ERROR", "FAILED"); }
  }

  return Object.freeze({
    check, setControl, prepare, arm, consume, complete, fail,
    invalidate: () => stop("AUTHORIZATION_INVALID"),
    snapshot: view,
    matchesCapturedInput: (other) => matchesCapturedInput(plan, other),
    matchesNormalizedBinding: (other) => matchesNormalizedBinding(plan, other),
  });
}
