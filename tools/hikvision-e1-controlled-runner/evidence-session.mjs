import { Buffer } from "node:buffer";
import { types } from "node:util";
import {
  isPlanToken, inspectPlan, claimEvidenceSession, claimActivationTicket, stopPlan,
} from "./private-plan.mjs";

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
