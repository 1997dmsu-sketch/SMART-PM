import { types } from "node:util";

const IDS = Object.freeze([
  "deviceInfo", "acsCapabilities", "userInfoCapabilities",
  "fdlibCapabilities", "fdlibList", "fdlibCount",
]);
const STATUS = Object.freeze(["BLOCKED", "COMPLETED", "FAILED", "UNKNOWN"]);
const ENDPOINT_STATE = Object.freeze(["NOT_ATTEMPTED", "OK", "FAILED", "UNKNOWN"]);
const CODES = Object.freeze([
  "OK", "CONFIG_UNVERIFIED", "APPROVAL_UNVERIFIED", "AUTHORIZATION_INVALID",
  "CONFIG_REJECTED", "RUNNER_MODEL_INCOMPATIBLE", "PLAN_INVALID",
  "EVIDENCE_GATE_UNVERIFIED", "EVIDENCE_GATE_FAILED", "EVIDENCE_GATE_INVALID",
  "PLAN_CONSUMED", "REQUEST_OUT_OF_SCOPE", "PROBE_FAILED",
  "REQUEST_OUTCOME_UNKNOWN", "EVIDENCE_WRITE_FAILED", "INTERNAL_ERROR",
]);
const CHECKS = Object.freeze(["checkerPassed", "runnerCompatible", "evidenceGateVerified", "singleUseConsumed"]);
const COUNTS = Object.freeze(["logicalEndpointsAttempted", "wrapperAttemptCount", "transportInvocationCount", "confirmedResponses"]);
const ROOT_KEYS = Object.freeze([
  "status", "code", "planRef", "evidenceRef", "checks", "counts",
  "requestOutcomeUnknown", "endpoints",
]);
const INVALID = Symbol("invalid-public-context");
const ABSENT = Symbol("absent-data-slot");
const UNREADABLE = Symbol("unreadable-data-slot");

function readRecord(value, allowed, required = []) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) throw INVALID;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw INVALID;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key)) ||
      required.some((key) => !keys.includes(key))) throw INVALID;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const copy = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw INVALID;
    copy[key] = descriptor.value;
  }
  return copy;
}

function defaultChecks() { return Object.fromEntries(CHECKS.map((key) => [key, false])); }
function defaultCounts() { return Object.fromEntries(COUNTS.map((key) => [key, 0])); }
function defaultEndpoints() { return IDS.map((id) => ({ id, state: "NOT_ATTEMPTED" })); }

function checkedReference(value, prefix) {
  if (value === null) return null;
  const pattern = prefix === "plan"
    ? /^plan-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    : /^evidence-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (typeof value !== "string" || !pattern.test(value)) throw INVALID;
  return value;
}

function checkedCounts(value) {
  const data = readRecord(value, COUNTS, COUNTS);
  if (COUNTS.some((key) => !Number.isSafeInteger(data[key]) || data[key] < 0) ||
      data.logicalEndpointsAttempted > 6 || data.transportInvocationCount > 12 ||
      data.logicalEndpointsAttempted > data.transportInvocationCount ||
      data.confirmedResponses > data.transportInvocationCount ||
      data.transportInvocationCount > data.wrapperAttemptCount) throw INVALID;
  return Object.fromEntries(COUNTS.map((key) => [key, data[key]]));
}

function checkedChecks(value) {
  const data = readRecord(value, CHECKS, CHECKS);
  if (CHECKS.some((key) => typeof data[key] !== "boolean")) throw INVALID;
  return Object.fromEntries(CHECKS.map((key) => [key, data[key]]));
}

function checkedEndpoints(value) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) throw INVALID;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== IDS.length + 1 || !keys.includes("length")) throw INVALID;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (descriptors.length.value !== IDS.length) throw INVALID;
  return IDS.map((id, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw INVALID;
    const data = readRecord(descriptor.value, ["id", "state"], ["id", "state"]);
    if (data.id !== id || typeof data.state !== "string" || !ENDPOINT_STATE.includes(data.state)) throw INVALID;
    return { id, state: data.state };
  });
}

function result(data) {
  const endpoints = Object.freeze(data.endpoints.map((entry) => Object.freeze(entry)));
  return Object.freeze({
    schemaVersion: "controlled-e1-binding-v1",
    scope: "single-authorized-e1-read-only",
    planRef: data.planRef, evidenceRef: data.evidenceRef,
    status: data.status, code: data.code,
    checks: Object.freeze(data.checks), counts: Object.freeze(data.counts),
    requestOutcomeUnknown: data.requestOutcomeUnknown, endpoints,
  });
}

// This narrower salvage path never evaluates a property, accepts only known
// primitive facts, and never serializes the rejected context. A malformed
// metadata field must not erase separately valid counts of earlier effects.
function ownData(value, key) {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return UNREADABLE;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return ABSENT;
    return Object.hasOwn(descriptor, "value") ? descriptor.value : UNREADABLE;
  } catch {
    return UNREADABLE;
  }
}

function knownFields(value, keys) {
  const output = Object.create(null);
  for (const key of keys) {
    const item = ownData(value, key);
    if (item === ABSENT || item === UNREADABLE) return null;
    output[key] = item;
  }
  return output;
}

function failureWithFacts(input) {
  let contextUnreadable = true;
  if (input !== null && typeof input === "object" && !types.isProxy(input) && !Array.isArray(input)) {
    const prototype = Object.getPrototypeOf(input);
    contextUnreadable = prototype !== Object.prototype && prototype !== null;
  }
  let counts = null;
  const rawCounts = ownData(input, "counts");
  try {
    const fields = knownFields(rawCounts, COUNTS);
    if (fields) counts = checkedCounts(fields);
  } catch { /* Invalid count groups are not treated as trustworthy facts. */ }
  const trustedCounts = counts !== null;
  counts ??= defaultCounts();
  const rawUnknown = ownData(input, "requestOutcomeUnknown");
  const rawStatus = ownData(input, "status");
  const rawCode = ownData(input, "code");
  let unknown = contextUnreadable || rawUnknown === UNREADABLE || rawUnknown === true ||
    (rawUnknown !== ABSENT && typeof rawUnknown !== "boolean") ||
    rawStatus === UNREADABLE || rawCode === UNREADABLE ||
    rawStatus === "UNKNOWN" || rawCode === "REQUEST_OUTCOME_UNKNOWN" ||
    (trustedCounts && counts.transportInvocationCount > counts.confirmedResponses) ||
    (!trustedCounts && rawCounts !== ABSENT);

  const checks = defaultChecks();
  const rawChecks = ownData(input, "checks");
  for (const key of CHECKS) {
    const value = ownData(rawChecks, key);
    if (typeof value === "boolean") checks[key] = value;
  }
  let planRef = null;
  let evidenceRef = null;
  try { planRef = checkedReference(ownData(input, "planRef"), "plan"); } catch { /* Drop unsafe reference. */ }
  try { evidenceRef = checkedReference(ownData(input, "evidenceRef"), "evidence"); } catch { /* Drop unsafe reference. */ }

  const rawEndpoints = ownData(input, "endpoints");
  if (rawEndpoints !== ABSENT && (rawEndpoints === UNREADABLE || rawEndpoints === null ||
      typeof rawEndpoints !== "object" || types.isProxy(rawEndpoints) || !Array.isArray(rawEndpoints))) unknown = true;
  const endpointFacts = IDS.map((id, index) => {
    const entry = ownData(rawEndpoints, String(index));
    const entryId = ownData(entry, "id");
    const state = ownData(entry, "state");
    if (rawEndpoints !== ABSENT && (entry === UNREADABLE || entryId === UNREADABLE || state === UNREADABLE)) unknown = true;
    if (entryId === id && typeof state === "string" && ENDPOINT_STATE.includes(state)) return { id, state };
    return null;
  });
  const endpoints = IDS.map((id, index) => endpointFacts[index] ??
    { id, state: unknown || counts.transportInvocationCount > 0 ? "UNKNOWN" : "NOT_ATTEMPTED" });
  const endpointAttempt = endpoints.some((entry) => entry.state !== "NOT_ATTEMPTED");
  if (!trustedCounts && endpointAttempt) unknown = true;
  const attemptsKnown = counts.transportInvocationCount > 0 || endpointAttempt;
  return result({
    status: unknown ? "UNKNOWN" : attemptsKnown ? "FAILED" : "BLOCKED",
    code: "INTERNAL_ERROR", planRef, evidenceRef, checks, counts,
    requestOutcomeUnknown: unknown, endpoints,
  });
}

/** Closed public DTO constructor: no object coercion, getters, or error text. */
export function makePublicResult(input = {}) {
  try {
    const data = readRecord(input, ROOT_KEYS);
    const status = Object.hasOwn(data, "status") ? data.status : "BLOCKED";
    const code = Object.hasOwn(data, "code") ? data.code : "INTERNAL_ERROR";
    if (typeof status !== "string" || !STATUS.includes(status) ||
        typeof code !== "string" || !CODES.includes(code) ||
        (status === "COMPLETED") !== (code === "OK")) throw INVALID;
    const unknown = Object.hasOwn(data, "requestOutcomeUnknown")
      ? data.requestOutcomeUnknown : status === "UNKNOWN" || code === "REQUEST_OUTCOME_UNKNOWN";
    if (typeof unknown !== "boolean" || (status === "UNKNOWN" && !unknown) ||
        (code === "REQUEST_OUTCOME_UNKNOWN" && (status !== "UNKNOWN" || !unknown))) throw INVALID;
    const facts = {
      status, code,
      planRef: checkedReference(Object.hasOwn(data, "planRef") ? data.planRef : null, "plan"),
      evidenceRef: checkedReference(Object.hasOwn(data, "evidenceRef") ? data.evidenceRef : null, "evidence"),
      checks: Object.hasOwn(data, "checks") ? checkedChecks(data.checks) : defaultChecks(),
      counts: Object.hasOwn(data, "counts") ? checkedCounts(data.counts) : defaultCounts(),
      requestOutcomeUnknown: unknown,
      endpoints: Object.hasOwn(data, "endpoints") ? checkedEndpoints(data.endpoints) : defaultEndpoints(),
    };
    if (status === "COMPLETED" && (
      !facts.planRef || !facts.evidenceRef || CHECKS.some((key) => facts.checks[key] !== true) ||
      facts.counts.logicalEndpointsAttempted !== 6 || facts.counts.transportInvocationCount < 6 ||
      facts.counts.confirmedResponses !== facts.counts.transportInvocationCount ||
      facts.requestOutcomeUnknown || facts.endpoints.some((entry) => entry.state !== "OK")
    )) throw INVALID;
    return result(facts);
  } catch {
    try { return failureWithFacts(input); } catch {
      // Even hostile thrown values cannot be inspected while reporting failure.
      return result({
        status: "UNKNOWN", code: "INTERNAL_ERROR", planRef: null, evidenceRef: null,
        checks: defaultChecks(), counts: defaultCounts(), requestOutcomeUnknown: true,
        endpoints: IDS.map((id) => ({ id, state: "UNKNOWN" })),
      });
    }
  }
}

/** Read only a safe own data-code; unknown thrown proxies are not inspected. */
export function errorToCode(error) {
  try {
    if (error === null || typeof error !== "object" || types.isProxy(error)) return "INTERNAL_ERROR";
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") return "INTERNAL_ERROR";
    return CODES.includes(descriptor.value) && descriptor.value !== "OK" ? descriptor.value : "INTERNAL_ERROR";
  } catch {
    return "INTERNAL_ERROR";
  }
}
