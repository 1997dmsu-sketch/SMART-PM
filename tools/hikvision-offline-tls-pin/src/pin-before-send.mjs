import { createHash, timingSafeEqual } from "node:crypto";
import { types } from "node:util";

const SCOPE = "synthetic-tls-pin-before-send-only";
const SCHEMA = "hk-ai-08-synthetic-tls-pin-v1";
const INVALID = Symbol("invalid-synthetic-input");
const AUTHORIZATION_LINE = "Authorization: SYNTHETIC_DIGEST_AUTH\r\n";
const ENDPOINTS = Object.freeze({
  deviceInfo: "/ISAPI/System/deviceInfo",
  acsCapabilities: "/ISAPI/AccessControl/capabilities",
  userInfoCapabilities: "/ISAPI/AccessControl/UserInfo/capabilities?format=json",
  fdlibCapabilities: "/ISAPI/Intelligent/FDLib/capabilities?format=json",
  fdlibList: "/ISAPI/Intelligent/FDLib?format=json",
  fdlibCount: "/ISAPI/Intelligent/FDLib/Count?format=json",
});

function invalid() { throw INVALID; }

// Descriptor reads occur only after the non-Proxy and prototype checks. Nothing
// supplied by the caller is coerced, invoked, or read through a getter.
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

function deepFreeze(value) {
  // Only fresh private copies, result records, and empty handles reach here.
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function result(status, code, extra = {}) {
  return deepFreeze({ scope: SCOPE, status, code, ...extra });
}

function copyConfiguration(input) {
  const copy = dataRecord(input, ["schemaVersion", "dataClass", "allowRead", "mode", "fingerprints"]);
  if (copy.schemaVersion !== SCHEMA || copy.dataClass !== "synthetic-only" ||
      copy.allowRead !== false || copy.mode !== "fingerprint-pinned") invalid();
  copy.fingerprints = dataArray(copy.fingerprints, 2, 1);
  if (copy.fingerprints.some((pin) => typeof pin !== "string" || !/^[0-9A-F]{64}$/.test(pin)) ||
      new Set(copy.fingerprints).size !== copy.fingerprints.length) invalid();
  return deepFreeze(copy);
}

// Static semantic reuse of matchFingerprint from the local Git blob
// 558b9c864a4b820e397336200758b143556a4d87:tools/hikvision-probe/src/http.mjs.
// The original network module is neither imported nor executed.
function matchFingerprint(rawCertificate, fingerprints) {
  const actual = createHash("sha256").update(Buffer.from(rawCertificate)).digest();
  let slot = null;
  for (let index = 0; index < fingerprints.length; index += 1) {
    const expected = Buffer.from(fingerprints[index], "hex");
    if (expected.length === actual.length && timingSafeEqual(actual, expected) && slot === null) slot = index;
  }
  return slot;
}

export function createSyntheticPinnedSendHarness(input) {
  let configuration;
  try { configuration = copyConfiguration(input); }
  catch { throw new TypeError("SYNTHETIC_TLS_CONFIG_INVALID"); }

  const requests = new WeakMap();
  const peers = new WeakMap();
  let sequence = 0;
  const event = (name) => ({ event: name, sequence: ++sequence });
  const handle = () => Object.freeze(Object.create(null));

  function closePeer(state) {
    if (state.closed) return;
    state.closed = true;
    state.trace.push(event("CLOSE"));
  }

  function completeHandshake(state) {
    if (!state.connected || !state.released || state.closed || state.handshakeFinished) return;
    state.handshakeFinished = true;
    state.handshakes += 1;
    state.trace.push(event("HANDSHAKE"));
    if (state.script.outcome === "tls-error") {
      state.terminal = "TLS_HANDSHAKE_FAILED";
      closePeer(state);
    }
    state.resolveHandshake();
  }

  function connectPeer(state) {
    if (state.connected || state.closed || state.terminal !== null) return false;
    state.connected = true;
    state.connections += 1;
    state.trace.push(event("CONNECT"));
    completeHandshake(state);
    return true;
  }

  function readPeerCertificate(state) {
    if (!state.handshakeFinished || state.closed || state.terminal !== null) throw INVALID;
    state.certificateReads += 1;
    return state.script.rawCertificate;
  }

  // This is the sole HTTP receiver. Counters and authorization observation are
  // derived from the bytes actually received here, independently of send's
  // requested endpoint/attempt and result construction. It is never exposed.
  function receiveHttpBytes(state, serializedBytes) {
    if (!state.connected || !state.handshakeFinished || state.closed || state.terminal !== null ||
        state.httpWrites !== 0 || !Buffer.isBuffer(serializedBytes)) throw INVALID;
    const received = Buffer.from(serializedBytes);
    state.httpWrites += 1;
    state.httpBytes += received.length;
    state.authorizationPresent = received.includes(Buffer.from(`\r\n${AUTHORIZATION_LINE}`, "ascii"));
    state.trace.push(event("HTTP_RECEIVED"));
  }

  function prepareRequest(inputRequest) {
    try {
      const request = dataRecord(inputRequest, ["endpointId", "attempt"]);
      if (typeof request.endpointId !== "string" || !Object.hasOwn(ENDPOINTS, request.endpointId) ||
          (request.attempt !== 1 && request.attempt !== 2)) invalid();
      const requestHandle = handle();
      requests.set(requestHandle, {
        specification: deepFreeze(request),
        used: false,
      });
      return result("PASS", "OK", { request: requestHandle });
    } catch { return result("FAIL", "INVALID_REQUEST", { request: null }); }
  }

  function createFakePeer(inputPeer) {
    try {
      const script = dataRecord(inputPeer, ["rawCertificate", "expired", "outcome"]);
      if (script.rawCertificate !== null) {
        script.rawCertificate = dataArray(script.rawCertificate, 4096);
        if (script.rawCertificate.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) invalid();
      }
      if (script.expired !== null && script.expired !== true && script.expired !== false) invalid();
      if (script.outcome !== "success" && script.outcome !== "tls-error") invalid();
      const peerHandle = handle();
      let resolveHandshake;
      const handshake = new Promise((resolve) => { resolveHandshake = resolve; });
      peers.set(peerHandle, {
        script: deepFreeze(script),
        handshake,
        resolveHandshake,
        used: false,
        released: false,
        connected: false,
        handshakeFinished: false,
        terminal: null,
        closed: false,
        connections: 0,
        handshakes: 0,
        certificateReads: 0,
        httpWrites: 0,
        httpBytes: 0,
        authorizationPresent: false,
        trace: [],
      });
      return result("PASS", "OK", { peer: peerHandle });
    } catch { return result("FAIL", "INVALID_PEER", { peer: null }); }
  }

  function releaseHandshake(peerHandle) {
    const state = peers.get(peerHandle);
    if (!state) return result("FAIL", "INVALID_PEER");
    if (state.released) return result("FAIL", "HANDSHAKE_ALREADY_RELEASED");
    if (state.closed) return result("FAIL", "PEER_CLOSED");
    state.released = true;
    completeHandshake(state);
    return result("PASS", "OK");
  }

  function observePeer(peerHandle) {
    const state = peers.get(peerHandle);
    if (!state) return result("FAIL", "INVALID_PEER", { observation: null });
    return result("PASS", "OK", {
      observation: {
        connections: state.connections,
        handshakes: state.handshakes,
        certificateReads: state.certificateReads,
        httpWrites: state.httpWrites,
        httpBytes: state.httpBytes,
        authorizationPresent: state.authorizationPresent,
        closed: state.closed,
        trace: state.trace.map((item) => ({ ...item })),
      },
    });
  }

  function cancelPeer(peerHandle) {
    const state = peers.get(peerHandle);
    if (!state) return result("FAIL", "INVALID_PEER");
    if (state.closed) return result("FAIL", "PEER_CLOSED");
    state.terminal = "TLS_CANCELLED";
    closePeer(state);
    // Resolving the private gate also settles a send cancelled before release.
    state.resolveHandshake();
    return result("FAIL", "TLS_CANCELLED");
  }

  async function send(requestHandle, peerHandle) {
    const clientTrace = [];
    let state = null;
    let pinMatched = false;
    let pinnedSlot = null;
    let certificateExpired = null;
    let reserved = false;

    const summary = () => ({
      allowReadStayedFalse: configuration.allowRead === false,
      pinMatched,
      pinnedSlot,
      certificateExpired,
      httpWrites: reserved ? state.httpWrites : 0,
      httpBytes: reserved ? state.httpBytes : 0,
      clientTrace: clientTrace.map((item) => ({ ...item })),
    });
    const fail = (code) => {
      if (reserved) {
        if (state.terminal === null) state.terminal = code;
        closePeer(state);
      }
      clientTrace.push(event(code === "TLS_CANCELLED" ? "CANCELLED" : "FAILED"));
      return result("FAIL", code, { summary: summary() });
    };

    try {
      const request = requests.get(requestHandle);
      if (!request) return fail("INVALID_REQUEST");
      state = peers.get(peerHandle);
      if (!state) return fail("INVALID_PEER");
      if (request.used) return fail("REQUEST_USED");
      if (state.used) return fail("PEER_USED");

      // Both branded handles are consumed synchronously, before the first
      // await, so concurrent calls cannot reserve either capability twice.
      request.used = true;
      state.used = true;
      reserved = true;
      if (state.terminal !== null) return fail(state.terminal);
      if (state.closed) return fail("PEER_CLOSED");

      clientTrace.push(event("HANDSHAKE_WAIT"));
      if (!connectPeer(state)) return fail("PEER_CLOSED");
      await state.handshake;
      if (state.terminal !== null) return fail(state.terminal);
      if (state.closed) return fail("PEER_CLOSED");

      const rawCertificate = readPeerCertificate(state);
      clientTrace.push(event("CERTIFICATE_READ"));
      if (rawCertificate === null || rawCertificate.length === 0) return fail("TLS_CERTIFICATE_MISSING");
      certificateExpired = state.script.expired;
      pinnedSlot = matchFingerprint(rawCertificate, configuration.fingerprints);
      if (pinnedSlot === null) return fail("TLS_PIN_MISMATCH");
      pinMatched = true;
      clientTrace.push(event("PIN_VERIFIED"));

      // Give cancellation a defined microtask boundary after verification.
      // No HTTP message is serialized or delivered until this final check.
      await Promise.resolve();
      if (state.terminal !== null) return fail(state.terminal);
      if (state.closed) return fail("PEER_CLOSED");

      const specification = request.specification;
      const message = `GET ${ENDPOINTS[specification.endpointId]} HTTP/1.1\r\nHost: example.invalid\r\n` +
        (specification.attempt === 2 ? AUTHORIZATION_LINE : "") + "\r\n";
      const serializedBytes = Buffer.from(message, "ascii");
      clientTrace.push(event("HTTP_WRITE"));
      receiveHttpBytes(state, serializedBytes);
      closePeer(state);
      return result("PASS", "OK", { summary: summary() });
    } catch { return fail("INTERNAL_ERROR"); }
  }

  return Object.freeze({ prepareRequest, createFakePeer, releaseHandshake, send, observePeer, cancelPeer });
}
