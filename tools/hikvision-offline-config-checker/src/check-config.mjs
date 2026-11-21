import { Buffer } from "node:buffer";
import { isIP } from "node:net";
import { types } from "node:util";

// These results concern submitted data only. No approval or device operation is
// validated, authorized, or started by this module.
const SCHEMA = "hk-ai-08-offline-config-v1";
const MAX_BYTES = 16 * 1024;
const ROOT_KEYS = Object.freeze(["schemaVersion", "approvalRef", "approvedTarget", "candidate"]);
const TARGET_KEYS = Object.freeze(["deviceRef", "host", "port", "model"]);
const CANDIDATE_KEYS = Object.freeze([
  "deviceRef", "host", "allowedHosts", "port", "allowedPorts", "expectedModel", "allowRead",
]);
const BOOLEAN_CHECKS = Object.freeze([
  "schemaValid", "deviceRefMatches", "hostExplicit", "hostSyntaxValid",
  "hostMatchesApproval", "allowedHostMatchesTarget", "portExplicit", "portValid",
  "allowedPortsExplicit", "allowedPortsValid", "portMatchesApproval",
  "allowedPortMatchesTarget", "modelExplicit", "modelMatchesApproval", "allowReadDisabled",
]);

function emptyChecks() {
  return {
    ...Object.fromEntries(BOOLEAN_CHECKS.map((key) => [key, false])),
    submittedTargetCount: 0,
    allowedHostCount: 0,
    allowedPortCount: 0,
  };
}

function makeResult(code, checks = emptyChecks()) {
  return {
    schemaVersion: SCHEMA,
    scope: "offline-format-and-match-only",
    status: code === "OK" ? "PASS" : "FAIL",
    code,
    checks,
  };
}

// Unknown thrown values may themselves be hostile proxies. Strict identity
// comparison with this private sentinel does not inspect the thrown value.
const INVALID_INPUT = Symbol("invalid-input");

function readRecord(value, keys) {
  if (value === null || typeof value !== "object" || types.isProxy(value)) throw INVALID_INPUT;
  if (Array.isArray(value)) throw INVALID_INPUT;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw INVALID_INPUT;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) {
    throw INVALID_INPUT;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const copy = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw INVALID_INPUT;
    copy[key] = descriptor.value;
  }
  return copy;
}

function assertString(value, maximum = MAX_BYTES) {
  if (typeof value !== "string" || value.length > maximum) throw INVALID_INPUT;
}

function snapshot(input) {
  const root = readRecord(input, ROOT_KEYS);
  const target = readRecord(root.approvedTarget, TARGET_KEYS);
  const candidate = readRecord(root.candidate, CANDIDATE_KEYS);
  if (root.schemaVersion !== SCHEMA) throw INVALID_INPUT;
  assertString(root.approvalRef, 128);
  if (!root.approvalRef.trim()) throw INVALID_INPUT;
  for (const object of [target, candidate]) {
    assertString(object.deviceRef, 128);
    assertString(object.host, 253);
    assertString(object.port);
  }
  assertString(target.model, 128);
  assertString(candidate.expectedModel, 128);
  assertString(candidate.allowedHosts);
  assertString(candidate.allowedPorts);
  if (typeof candidate.allowRead !== "boolean") throw INVALID_INPUT;
  // Stringify only the private descriptor-based snapshot: never the caller's
  // object, its getters, inherited methods, or toJSON implementation.
  root.approvedTarget = target;
  root.candidate = candidate;
  if (Buffer.byteLength(JSON.stringify(root), "utf8") > MAX_BYTES) throw INVALID_INPUT;
  return root;
}

function normalizedHost(text) {
  return text.trim().toLowerCase();
}

function validHost(host) {
  if (!host || host.length > 253) return false;
  if (host.includes(":")) return !host.includes("%") && isIP(host) === 6;
  const numeric = /^(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+))*$/;
  if (numeric.test(host)) {
    const octets = host.split(".");
    return octets.length === 4 && octets.every((octet) => /^(?:0|[1-9][0-9]{0,2})$/.test(octet) && Number(octet) <= 255);
  }
  return host.split(".").every((label) => label.length >= 1 && label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

function portNumber(text) {
  if (!/^[0-9]+$/.test(text)) return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null;
}

/** Check one explicitly supplied data object without I/O or input mutation. */
export function checkOfflineConfig(input) {
  try {
    const { approvedTarget: target, candidate } = snapshot(input);
    const checks = emptyChecks();
    checks.schemaValid = true;
    checks.submittedTargetCount = 1;

    const targetHost = normalizedHost(target.host);
    const candidateHost = normalizedHost(candidate.host);
    const allowedHosts = candidate.allowedHosts.split(",").map(normalizedHost).filter(Boolean);
    checks.allowedHostCount = allowedHosts.length;
    checks.hostExplicit = Boolean(targetHost && candidateHost);
    checks.hostSyntaxValid = checks.hostExplicit && validHost(targetHost) && validHost(candidateHost) &&
      allowedHosts.length === 1 && validHost(allowedHosts[0]);
    if (!target.deviceRef.trim() || !candidate.deviceRef.trim() || !checks.hostSyntaxValid) {
      return makeResult("INVALID_TARGET", checks);
    }
    checks.deviceRefMatches = target.deviceRef === candidate.deviceRef;
    checks.hostMatchesApproval = targetHost === candidateHost;
    checks.allowedHostMatchesTarget = allowedHosts[0] === candidateHost;
    if (!checks.deviceRefMatches || !checks.hostMatchesApproval || !checks.allowedHostMatchesTarget) {
      return makeResult("TARGET_MISMATCH", checks);
    }

    const targetPort = portNumber(target.port);
    const candidatePort = portNumber(candidate.port);
    const allowedPorts = candidate.allowedPorts.split(",").map((port) => port.trim());
    checks.allowedPortCount = allowedPorts.length;
    checks.portExplicit = Boolean(target.port && candidate.port);
    checks.portValid = targetPort !== null && candidatePort !== null;
    checks.allowedPortsExplicit = Boolean(candidate.allowedPorts);
    checks.allowedPortsValid = allowedPorts.length === 1 && portNumber(allowedPorts[0]) !== null;
    if (!checks.portValid || !checks.allowedPortsValid) return makeResult("INVALID_PORT", checks);
    checks.portMatchesApproval = targetPort === candidatePort;
    checks.allowedPortMatchesTarget = portNumber(allowedPorts[0]) === candidatePort;
    if (!checks.portMatchesApproval || !checks.allowedPortMatchesTarget) return makeResult("PORT_MISMATCH", checks);

    checks.modelExplicit = Boolean(target.model.trim() && candidate.expectedModel.trim());
    checks.modelMatchesApproval = checks.modelExplicit && target.model === candidate.expectedModel;
    if (!checks.modelMatchesApproval) return makeResult("MODEL_MISMATCH", checks);
    checks.allowReadDisabled = candidate.allowRead === false;
    if (!checks.allowReadDisabled) return makeResult("READ_NOT_DISABLED", checks);
    return makeResult("OK", checks);
  } catch (error) {
    return makeResult(error === INVALID_INPUT ? "INVALID_INPUT" : "INTERNAL_ERROR");
  }
}

// Parse JSON with duplicate keys rejected *after* JSON escape decoding. Objects
// are constructed without a prototype, so even a rejected __proto__ key cannot
// modify a parser object. The depth bound only rejects shapes outside our schema.
function parseJson(text) {
  let cursor = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[cursor] || "\0")) cursor += 1; };
  const reject = () => { throw INVALID_INPUT; };
  function string() {
    if (text[cursor] !== '"') reject();
    const start = cursor++;
    while (cursor < text.length) {
      const character = text[cursor++];
      if (character === '"') {
        try { return JSON.parse(text.slice(start, cursor)); } catch { reject(); }
      }
      if (character.charCodeAt(0) < 32) reject();
      if (character === "\\") cursor += 1;
    }
    reject();
  }
  function value(depth) {
    if (depth > 32) reject();
    whitespace();
    const first = text[cursor];
    if (first === '"') return string();
    if (first === "{") {
      cursor += 1;
      const object = Object.create(null);
      const keys = new Set();
      whitespace();
      if (text[cursor] === "}") { cursor += 1; return object; }
      for (;;) {
        whitespace();
        const key = string();
        if (keys.has(key)) reject();
        keys.add(key);
        whitespace();
        if (text[cursor++] !== ":") reject();
        object[key] = value(depth + 1);
        whitespace();
        const separator = text[cursor++];
        if (separator === "}") return object;
        if (separator !== ",") reject();
      }
    }
    if (first === "[") {
      cursor += 1;
      const array = [];
      whitespace();
      if (text[cursor] === "]") { cursor += 1; return array; }
      for (;;) {
        array.push(value(depth + 1));
        whitespace();
        const separator = text[cursor++];
        if (separator === "]") return array;
        if (separator !== ",") reject();
      }
    }
    for (const [token, parsed] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(token, cursor)) { cursor += token.length; return parsed; }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(cursor));
    if (!number) reject();
    cursor += number[0].length;
    return Number(number[0]);
  }
  const parsed = value(0);
  whitespace();
  if (cursor !== text.length) reject();
  return parsed;
}

/** Parse a bounded JSON text; parser diagnostics never leave this function. */
export function checkOfflineConfigJson(text) {
  try {
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_BYTES) throw INVALID_INPUT;
    return checkOfflineConfig(parseJson(text));
  } catch (error) {
    return makeResult(error === INVALID_INPUT ? "INVALID_INPUT" : "INTERNAL_ERROR");
  }
}
