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
