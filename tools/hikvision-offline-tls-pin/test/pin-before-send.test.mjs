// Run only this synthetic suite:
// node --experimental-vm-modules tools/hikvision-offline-tls-pin/test/pin-before-send.test.mjs
// SourceTextModule restricts business-module imports and globals. It is NOT an
// operating-system sandbox. No real TLS connection or server is involved.
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { createHash, timingSafeEqual } from 'node:crypto';
import { types } from 'node:util';
import vm from 'node:vm';

const SCOPE = 'synthetic-tls-pin-before-send-only';
const CURRENT = 'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD';
const NEXT = '2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824';
const CURRENT_RAW = [97, 98, 99]; // Published SHA-256 vector: UTF-8 "abc".
const NEXT_RAW = [104, 101, 108, 108, 111]; // UTF-8 "hello".
const IDS = ['deviceInfo', 'acsCapabilities', 'userInfoCapabilities', 'fdlibCapabilities', 'fdlibList', 'fdlibCount'];
// This table and wire formatter are test-owned expectations, not imported data.
const PATHS = [
  '/ISAPI/System/deviceInfo',
  '/ISAPI/AccessControl/capabilities',
  '/ISAPI/AccessControl/UserInfo/capabilities?format=json',
  '/ISAPI/Intelligent/FDLib/capabilities?format=json',
  '/ISAPI/Intelligent/FDLib?format=json',
  '/ISAPI/Intelligent/FDLib/Count?format=json',
];
const BASE = {
  schemaVersion: 'hk-ai-08-synthetic-tls-pin-v1',
  dataClass: 'synthetic-only',
  allowRead: false,
  mode: 'fingerprint-pinned',
  fingerprints: [CURRENT, NEXT],
};
const SUMMARY_KEYS = ['allowReadStayedFalse', 'pinMatched', 'pinnedSlot', 'certificateExpired', 'httpWrites', 'httpBytes', 'clientTrace'];
const OBSERVATION_KEYS = ['connections', 'handshakes', 'certificateReads', 'httpWrites', 'httpBytes', 'authorizationPresent', 'closed', 'trace'];
const cases = [];
const test = (id, title, run) => cases.push({ id, title, run });
class AssertionFailure extends Error {}
class TimeoutFailure extends Error {}

function assertionContext() {
  let count = 0;
  const check = (condition) => {
    count += 1;
    if (!condition) throw new AssertionFailure();
  };
  return {
    get count() { return count; },
    ok: check,
    eq(actual, expected) { check(Object.is(actual, expected)); },
    deep(actual, expected) { check(JSON.stringify(actual) === JSON.stringify(expected)); },
    keys(actual, expected) { check(JSON.stringify(Object.keys(actual).sort()) === JSON.stringify([...expected].sort())); },
  };
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new TimeoutFailure()), 2000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function loadBusinessModule() {
  // This is the only source-file read. No config, credential, fixture residue,
  // device/native probe, socket, listener or network dependency is loaded.
  const source = await readFile(new URL('../src/pin-before-send.mjs', import.meta.url), 'utf8');
  // Capture client serialization separately from the module's private receiver.
  // Every returned buffer is a real Node Buffer. Test diagnostics never print
  // these bytes; receiver-side counters still come from receiveHttpBytes.
  const wireRecords = [];
  const bufferCapability = Object.freeze({
    from(...args) {
      const value = Buffer.from(...args);
      if (typeof args[0] === 'string' && args[1] === 'ascii' && args[0].startsWith('GET ')) wireRecords.push(Buffer.from(value));
      return value;
    },
    isBuffer: Buffer.isBuffer,
  });
  const context = vm.createContext(Object.assign(Object.create(null), { Buffer: bufferCapability }));
  const linked = [];
  const module = new vm.SourceTextModule(source, {
    context,
    identifier: 'synthetic:pin-before-send',
    initializeImportMeta(meta) { meta.url = 'synthetic:pin-before-send'; },
    importModuleDynamically() { throw new Error('SYNTHETIC_IMPORT_BLOCKED'); },
  });
  await module.link(async (specifier) => {
    linked.push(specifier);
    if (specifier === 'node:crypto') {
      return new vm.SyntheticModule(['createHash', 'timingSafeEqual'], function () {
        this.setExport('createHash', createHash);
        this.setExport('timingSafeEqual', timingSafeEqual);
      }, { context });
    }
    if (specifier === 'node:util') {
      return new vm.SyntheticModule(['types'], function () {
        this.setExport('types', Object.freeze({ isProxy: types.isProxy }));
      }, { context });
    }
    throw new Error('SYNTHETIC_IMPORT_BLOCKED');
  });
  await module.evaluate();
  const local = (value) => vm.runInContext(`(${JSON.stringify(value)})`, context);
  const expression = (code) => vm.runInContext(code, context);
  return {
    context, linked, local, expression, wireRecords,
    factory: module.namespace.createSyntheticPinnedSendHarness,
    create(config = BASE) { return module.namespace.createSyntheticPinnedSendHarness(local(config)); },
  };
}

function fixedResult(t, result, status, code, extra = []) {
  t.keys(result, ['scope', 'status', 'code', ...extra]);
  t.eq(result.scope, SCOPE);
  t.eq(result.status, status);
  t.eq(result.code, code);
  t.ok(Object.isFrozen(result));
}

function deeplyFrozen(t, value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  t.ok(Object.isFrozen(value));
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    t.ok(Object.hasOwn(descriptor, 'value'));
    deeplyFrozen(t, descriptor.value, seen);
  }
}

function request(t, realm, api, endpointId = 'deviceInfo', attempt = 1) {
  const result = api.prepareRequest(realm.local({ endpointId, attempt }));
  fixedResult(t, result, 'PASS', 'OK', ['request']);
  t.eq(Object.getPrototypeOf(result.request), null);
  t.ok(Object.isFrozen(result.request));
  t.keys(result.request, []);
  return result.request;
}

function peer(t, realm, api, rawCertificate = CURRENT_RAW, expired = false, outcome = 'success') {
  const result = api.createFakePeer(realm.local({ rawCertificate, expired, outcome }));
  fixedResult(t, result, 'PASS', 'OK', ['peer']);
  t.eq(Object.getPrototypeOf(result.peer), null);
  t.ok(Object.isFrozen(result.peer));
  t.keys(result.peer, []);
  return result.peer;
}

function observe(t, api, handle) {
  const result = api.observePeer(handle);
  fixedResult(t, result, 'PASS', 'OK', ['observation']);
  t.keys(result.observation, OBSERVATION_KEYS);
  deeplyFrozen(t, result);
  for (const item of result.observation.trace) {
    t.keys(item, ['event', 'sequence']);
    t.ok(['CONNECT', 'HANDSHAKE', 'HTTP_RECEIVED', 'CLOSE'].includes(item.event));
    t.ok(Number.isSafeInteger(item.sequence) && item.sequence > 0);
  }
  return result.observation;
}

function sendResult(t, result, status, code) {
  fixedResult(t, result, status, code, ['summary']);
  t.keys(result.summary, SUMMARY_KEYS);
  t.eq(result.summary.allowReadStayedFalse, true);
  deeplyFrozen(t, result);
  for (const item of result.summary.clientTrace) {
    t.keys(item, ['event', 'sequence']);
    t.ok(['HANDSHAKE_WAIT', 'CERTIFICATE_READ', 'PIN_VERIFIED', 'HTTP_WRITE', 'FAILED', 'CANCELLED'].includes(item.event));
    t.ok(Number.isSafeInteger(item.sequence) && item.sequence > 0);
  }
  return result.summary;
}

function noHttp(t, summary, observation) {
  t.eq(summary.httpWrites, 0);
  t.eq(summary.httpBytes, 0);
  t.eq(observation.httpWrites, 0);
  t.eq(observation.httpBytes, 0);
  t.eq(observation.authorizationPresent, false);
  t.eq(summary.clientTrace.filter((item) => item.event === 'HTTP_WRITE').length, 0);
  t.eq(observation.trace.filter((item) => item.event === 'HTTP_RECEIVED').length, 0);
}

function expectedWire(index, attempt) {
  return `GET ${PATHS[index]} HTTP/1.1\r\nHost: example.invalid\r\n${attempt === 2 ? 'Authorization: SYNTHETIC_DIGEST_AUTH\r\n' : ''}\r\n`;
}

function order(t, summary, observation) {
  const client = (name) => summary.clientTrace.filter((entry) => entry.event === name);
  const receiver = (name) => observation.trace.filter((entry) => entry.event === name);
  for (const name of ['HANDSHAKE_WAIT', 'CERTIFICATE_READ', 'PIN_VERIFIED', 'HTTP_WRITE']) t.eq(client(name).length, 1);
  for (const name of ['CONNECT', 'HANDSHAKE', 'HTTP_RECEIVED', 'CLOSE']) t.eq(receiver(name).length, 1);
  t.ok(receiver('CONNECT')[0].sequence < receiver('HANDSHAKE')[0].sequence);
  t.ok(receiver('HANDSHAKE')[0].sequence < client('CERTIFICATE_READ')[0].sequence);
  t.ok(client('CERTIFICATE_READ')[0].sequence < client('PIN_VERIFIED')[0].sequence);
  t.ok(client('PIN_VERIFIED')[0].sequence < client('HTTP_WRITE')[0].sequence);
  t.ok(client('HTTP_WRITE')[0].sequence < receiver('HTTP_RECEIVED')[0].sequence);
  t.ok(receiver('HTTP_RECEIVED')[0].sequence < receiver('CLOSE')[0].sequence);
}

function rejectsFactory(t, realm, input) {
  let thrown;
  try { realm.factory(input); } catch (error) { thrown = error; }
  t.ok(thrown !== undefined);
  t.eq(thrown?.message, 'SYNTHETIC_TLS_CONFIG_INVALID');
}

test('TP-01', 'independent SHA-256 vectors and restricted module loading', async (t, realm) => {
  t.eq(createHash('sha256').update(Buffer.from(CURRENT_RAW)).digest('hex').toUpperCase(), CURRENT);
  t.eq(createHash('sha256').update(Buffer.from(NEXT_RAW)).digest('hex').toUpperCase(), NEXT);
  t.deep([...realm.linked].sort(), ['node:crypto', 'node:util']);
  t.deep(realm.expression('[typeof process, typeof require, typeof fetch, typeof setTimeout, typeof setInterval, typeof WebSocket]'), Array(6).fill('undefined'));
  const api = realm.create();
  t.keys(api, ['prepareRequest', 'createFakePeer', 'send', 'releaseHandshake', 'cancelPeer', 'observePeer']);
  t.ok(Object.isFrozen(api));
});

test('TP-02', 'current pin passes only after completed handshake', async (t, realm) => {
  const api = realm.create();
  const req = request(t, realm, api);
  const fake = peer(t, realm, api);
  let settled = false;
  const pending = api.send(req, fake).then((result) => { settled = true; return result; });
  await Promise.resolve();
  const waiting = observe(t, api, fake);
  t.eq(settled, false);
  t.eq(waiting.connections, 1);
  t.eq(waiting.handshakes, 0);
  t.eq(waiting.certificateReads, 0);
  t.eq(waiting.httpWrites, 0);
  t.eq(waiting.httpBytes, 0);
  t.eq(waiting.authorizationPresent, false);
  fixedResult(t, api.releaseHandshake(fake), 'PASS', 'OK');
  const summary = sendResult(t, await pending, 'PASS', 'OK');
  const observation = observe(t, api, fake);
  t.eq(summary.pinMatched, true);
  t.eq(summary.pinnedSlot, 0);
  t.eq(summary.certificateExpired, false);
  t.eq(summary.httpWrites, 1);
  t.eq(summary.httpBytes, Buffer.byteLength(expectedWire(0, 1), 'utf8'));
  t.eq(observation.httpBytes, summary.httpBytes);
  t.eq(observation.certificateReads, 1);
  t.eq(observation.closed, true);
  order(t, summary, observation);
});

test('TP-03', 'next rotation pin passes in slot one', async (t, realm) => {
  const api = realm.create();
  const fake = peer(t, realm, api, NEXT_RAW, null);
  const pending = api.send(request(t, realm, api), fake);
  fixedResult(t, api.releaseHandshake(fake), 'PASS', 'OK');
  const summary = sendResult(t, await pending, 'PASS', 'OK');
  const observation = observe(t, api, fake);
  t.eq(summary.pinMatched, true);
  t.eq(summary.pinnedSlot, 1);
  t.eq(summary.certificateExpired, null);
  order(t, summary, observation);
});

test('TP-04', 'one configured fingerprint is sufficient', async (t, realm) => {
  const api = realm.create({ ...BASE, fingerprints: [NEXT] });
  const fake = peer(t, realm, api, NEXT_RAW);
  fixedResult(t, api.releaseHandshake(fake), 'PASS', 'OK');
  const summary = sendResult(t, await api.send(request(t, realm, api), fake), 'PASS', 'OK');
  t.eq(summary.pinnedSlot, 0);
  t.eq(observe(t, api, fake).httpBytes, Buffer.byteLength(expectedWire(0, 1)));
});

for (const [id, raw, code] of [
  ['TP-05', [120], 'TLS_PIN_MISMATCH'],
  ['TP-06', null, 'TLS_CERTIFICATE_MISSING'],
  ['TP-07', [], 'TLS_CERTIFICATE_MISSING'],
]) {
  test(id, `${code} closes with zero independently observed HTTP`, async (t, realm) => {
    const api = realm.create();
    const fake = peer(t, realm, api, raw);
    const pending = api.send(request(t, realm, api), fake);
    api.releaseHandshake(fake);
    const summary = sendResult(t, await pending, 'FAIL', code);
    const observation = observe(t, api, fake);
    noHttp(t, summary, observation);
    t.eq(summary.pinMatched, false);
    t.eq(summary.pinnedSlot, null);
    t.eq(observation.closed, true);
    t.eq(observation.certificateReads, 1);
    t.eq(observation.trace.filter((entry) => entry.event === 'CLOSE').length, 1);
  });
}

test('TP-08', 'TLS handshake failure cannot inspect or send certificate payload', async (t, realm) => {
  const api = realm.create();
  const fake = peer(t, realm, api, CURRENT_RAW, false, 'tls-error');
  const pending = api.send(request(t, realm, api, 'deviceInfo', 2), fake);
  api.releaseHandshake(fake);
  const summary = sendResult(t, await pending, 'FAIL', 'TLS_HANDSHAKE_FAILED');
  const observation = observe(t, api, fake);
  noHttp(t, summary, observation);
  t.eq(observation.certificateReads, 0);
  t.eq(observation.closed, true);
  t.eq(summary.pinMatched, false);
});

for (const [id, raw, code] of [
  ['TP-09', [120], 'TLS_PIN_MISMATCH'],
  ['TP-10', null, 'TLS_CERTIFICATE_MISSING'],
  ['TP-11', [], 'TLS_CERTIFICATE_MISSING'],
]) {
  test(id, 'authentication retry is blocked before any Authorization bytes', async (t, realm) => {
    const api = realm.create();
    const fake = peer(t, realm, api, raw);
    const pending = api.send(request(t, realm, api, 'deviceInfo', 2), fake);
    api.releaseHandshake(fake);
    const summary = sendResult(t, await pending, 'FAIL', code);
    noHttp(t, summary, observe(t, api, fake));
  });
}

test('TP-12', 'matched expired certificate is observable without rejecting the pin', async (t, realm) => {
  const api = realm.create();
  const fake = peer(t, realm, api, CURRENT_RAW, true);
  api.releaseHandshake(fake);
  const summary = sendResult(t, await api.send(request(t, realm, api), fake), 'PASS', 'OK');
  t.eq(summary.certificateExpired, true);
  t.eq(summary.pinMatched, true);
  t.eq(observe(t, api, fake).httpWrites, 1);
});

test('TP-13', 'expired certificate with the wrong pin still fails closed', async (t, realm) => {
  const api = realm.create();
  const fake = peer(t, realm, api, [120], true);
  api.releaseHandshake(fake);
  const summary = sendResult(t, await api.send(request(t, realm, api), fake), 'FAIL', 'TLS_PIN_MISMATCH');
  t.eq(summary.certificateExpired, true);
  noHttp(t, summary, observe(t, api, fake));
});

test('TP-14', 'cancellation before send permanently closes the peer', async (t, realm) => {
  const api = realm.create();
  const fake = peer(t, realm, api);
  fixedResult(t, api.cancelPeer(fake), 'FAIL', 'TLS_CANCELLED');
  const summary = sendResult(t, await api.send(request(t, realm, api, 'deviceInfo', 2), fake), 'FAIL', 'TLS_CANCELLED');
  const observation = observe(t, api, fake);
  noHttp(t, summary, observation);
  t.eq(observation.connections, 0);
  t.eq(observation.closed, true);
  fixedResult(t, api.cancelPeer(fake), 'FAIL', 'PEER_CLOSED');
});

test('TP-15', 'cancellation settles a send awaiting handshake release', async (t, realm) => {
  const api = realm.create();
  const fake = peer(t, realm, api);
  const pending = api.send(request(t, realm, api, 'deviceInfo', 2), fake);
  fixedResult(t, api.cancelPeer(fake), 'FAIL', 'TLS_CANCELLED');
  const summary = sendResult(t, await pending, 'FAIL', 'TLS_CANCELLED');
  const observation = observe(t, api, fake);
  noHttp(t, summary, observation);
  t.eq(observation.connections, 1);
  t.eq(observation.handshakes, 0);
  t.eq(observation.certificateReads, 0);
  t.eq(observation.closed, true);
});

test('TP-16', 'cancellation after pin verification beats the HTTP microtask', async (t, realm) => {
  const api = realm.create();
  const fake = peer(t, realm, api);
  const pending = api.send(request(t, realm, api, 'deviceInfo', 2), fake);
  api.releaseHandshake(fake);
  await Promise.resolve();
  fixedResult(t, api.cancelPeer(fake), 'FAIL', 'TLS_CANCELLED');
  const summary = sendResult(t, await pending, 'FAIL', 'TLS_CANCELLED');
  const observation = observe(t, api, fake);
  t.eq(summary.pinMatched, true);
  t.eq(summary.pinnedSlot, 0);
  t.eq(summary.clientTrace.filter((entry) => entry.event === 'PIN_VERIFIED').length, 1);
  noHttp(t, summary, observation);
  t.eq(observation.closed, true);
});

test('TP-17', 'settled PASS is immutable and its closed peer cannot be reused', async (t, realm) => {
  const api = realm.create();
  const fake = peer(t, realm, api);
  api.releaseHandshake(fake);
  const result = await api.send(request(t, realm, api), fake);
  sendResult(t, result, 'PASS', 'OK');
  const snapshot = JSON.stringify(result);
  const before = observe(t, api, fake);
  fixedResult(t, api.cancelPeer(fake), 'FAIL', 'PEER_CLOSED');
  sendResult(t, await api.send(request(t, realm, api, 'deviceInfo', 2), fake), 'FAIL', 'PEER_USED');
  t.eq(JSON.stringify(result), snapshot);
  t.eq(result.status, 'PASS');
  t.deep(observe(t, api, fake), before);
});

test('TP-18', 'handshake may be released once before send without bypassing pinning', async (t, realm) => {
  const api = realm.create();
  const fake = peer(t, realm, api, [120]);
  fixedResult(t, api.releaseHandshake(fake), 'PASS', 'OK');
  fixedResult(t, api.releaseHandshake(fake), 'FAIL', 'HANDSHAKE_ALREADY_RELEASED');
  const before = observe(t, api, fake);
  t.eq(before.connections, 0);
  t.eq(before.handshakes, 0);
  t.eq(before.httpBytes, 0);
  const summary = sendResult(t, await api.send(request(t, realm, api), fake), 'FAIL', 'TLS_PIN_MISMATCH');
  noHttp(t, summary, observe(t, api, fake));
});

test('TP-19', 'request and peer ownership is consumed synchronously', async (t, realm) => {
  const api = realm.create();
  const firstRequest = request(t, realm, api);
  const secondRequest = request(t, realm, api, 'deviceInfo', 2);
  const firstPeer = peer(t, realm, api);
  const unusedPeer = peer(t, realm, api);
  const pending = api.send(firstRequest, firstPeer);
  sendResult(t, await api.send(firstRequest, unusedPeer), 'FAIL', 'REQUEST_USED');
  sendResult(t, await api.send(secondRequest, firstPeer), 'FAIL', 'PEER_USED');
  const untouched = observe(t, api, unusedPeer);
  t.eq(untouched.connections, 0);
  t.eq(untouched.httpBytes, 0);
  t.eq(observe(t, api, firstPeer).httpBytes, 0);
  api.releaseHandshake(firstPeer);
  sendResult(t, await pending, 'PASS', 'OK');
  sendResult(t, await api.send(firstRequest, firstPeer), 'FAIL', 'REQUEST_USED');
  t.eq(observe(t, api, firstPeer).httpWrites, 1);
});

test('TP-20', 'two concurrent independent peers each require their own pin', async (t, realm) => {
  const api = realm.create();
  const good = peer(t, realm, api);
  const wrong = peer(t, realm, api, [120]);
  const a = api.send(request(t, realm, api), good);
  const b = api.send(request(t, realm, api, 'deviceInfo', 2), wrong);
  api.releaseHandshake(good);
  api.releaseHandshake(wrong);
  const [first, second] = await Promise.all([a, b]);
  sendResult(t, first, 'PASS', 'OK');
  const badSummary = sendResult(t, second, 'FAIL', 'TLS_PIN_MISMATCH');
  t.eq(observe(t, api, good).httpWrites, 1);
  noHttp(t, badSummary, observe(t, api, wrong));
});

test('TP-21', 'new authentication connection cannot inherit an earlier successful pin', async (t, realm) => {
  const api = realm.create();
  const first = peer(t, realm, api);
  api.releaseHandshake(first);
  sendResult(t, await api.send(request(t, realm, api), first), 'PASS', 'OK');
  const retry = peer(t, realm, api, [120]);
  api.releaseHandshake(retry);
  const summary = sendResult(t, await api.send(request(t, realm, api, 'deviceInfo', 2), retry), 'FAIL', 'TLS_PIN_MISMATCH');
  t.eq(observe(t, api, first).httpWrites, 1);
  noHttp(t, summary, observe(t, api, retry));
});

test('TP-22', 'forged and cross-harness handles cannot authorize transport', async (t, realm) => {
  const api = realm.create();
  const other = realm.create();
  const req = request(t, realm, api);
  const fake = peer(t, realm, api);
  const foreignReq = request(t, realm, other);
  const foreignPeer = peer(t, realm, other);
  const forged = Object.freeze(Object.create(null));
  for (const invalid of [null, {}, forged, fake, foreignReq]) {
    sendResult(t, await api.send(invalid, fake), 'FAIL', 'INVALID_REQUEST');
  }
  for (const invalid of [null, {}, forged, req, foreignPeer]) {
    sendResult(t, await api.send(req, invalid), 'FAIL', 'INVALID_PEER');
    fixedResult(t, api.releaseHandshake(invalid), 'FAIL', 'INVALID_PEER');
    fixedResult(t, api.cancelPeer(invalid), 'FAIL', 'INVALID_PEER');
    const invalidObservation = api.observePeer(invalid);
    fixedResult(t, invalidObservation, 'FAIL', 'INVALID_PEER', ['observation']);
    t.eq(invalidObservation.observation, null);
  }
  const observation = observe(t, api, fake);
  t.eq(observation.connections, 0);
  t.eq(observation.httpBytes, 0);
});

test('TP-23', 'cross-VM handles and input records are rejected', async (t, realm) => {
  const foreign = await loadBusinessModule();
  const api = realm.create();
  const other = foreign.create();
  const req = request(t, realm, api);
  const fake = peer(t, realm, api);
  sendResult(t, await api.send(request(t, foreign, other), fake), 'FAIL', 'INVALID_REQUEST');
  sendResult(t, await api.send(req, peer(t, foreign, other)), 'FAIL', 'INVALID_PEER');
  fixedResult(t, api.prepareRequest({ endpointId: 'deviceInfo', attempt: 1 }), 'FAIL', 'INVALID_REQUEST', ['request']);
  fixedResult(t, api.createFakePeer({ rawCertificate: CURRENT_RAW, expired: false, outcome: 'success' }), 'FAIL', 'INVALID_PEER', ['peer']);
  rejectsFactory(t, realm, { ...BASE, fingerprints: [...BASE.fingerprints] });
  t.eq(observe(t, api, fake).connections, 0);
});

test('TP-24', 'all six fixed GET paths and both attempts have independent expected byte totals', async (t, realm) => {
  const api = realm.create();
  let totalWrites = 0;
  let actualBytes = 0;
  let expectedBytes = 0;
  for (let index = 0; index < IDS.length; index += 1) {
    for (const attempt of [1, 2]) {
      const fake = peer(t, realm, api);
      const wireOffset = realm.wireRecords.length;
      api.releaseHandshake(fake);
      const summary = sendResult(t, await api.send(request(t, realm, api, IDS[index], attempt), fake), 'PASS', 'OK');
      const observation = observe(t, api, fake);
      const length = Buffer.byteLength(expectedWire(index, attempt), 'utf8');
      t.eq(summary.httpBytes, length);
      t.eq(observation.httpBytes, length);
      t.eq(observation.httpWrites, 1);
      t.eq(observation.authorizationPresent, attempt === 2);
      t.eq(observation.certificateReads, 1);
      t.eq(realm.wireRecords.length, wireOffset + 1);
      t.eq(realm.wireRecords[wireOffset].toString('ascii'), expectedWire(index, attempt));
      order(t, summary, observation);
      totalWrites += observation.httpWrites;
      actualBytes += observation.httpBytes;
      expectedBytes += length;
    }
  }
  t.eq(totalWrites, 12);
  t.eq(actualBytes, expectedBytes);
});

test('TP-25', 'configuration is closed and allowRead true is rejected immediately', async (t, realm) => {
  const invalids = [
    null, [], true, 'config', 1,
    { ...BASE, allowRead: true }, { ...BASE, allowRead: 0 },
    { ...BASE, schemaVersion: 'other' }, { ...BASE, dataClass: 'real' },
    { ...BASE, mode: 'ca' }, { ...BASE, extra: false },
    { ...BASE, path: '/override' }, { ...BASE, host: 'elsewhere.invalid' },
    { ...BASE, headers: {} }, { ...BASE, Authorization: 'OVERRIDE' },
    ...Object.keys(BASE).map((key) => Object.fromEntries(Object.entries(BASE).filter(([name]) => name !== key))),
  ];
  for (const input of invalids) rejectsFactory(t, realm, realm.local(input));
  const nullPrototype = realm.expression(`Object.assign(Object.create(null), ${JSON.stringify(BASE)})`);
  const api = realm.factory(nullPrototype);
  t.ok(Object.isFrozen(api));
});

test('TP-26', 'fingerprint grammar, uniqueness and dense array limits are enforced', async (t, realm) => {
  for (const fingerprints of [
    [], [CURRENT, NEXT, '0'.repeat(64)], [CURRENT, CURRENT], [CURRENT.toLowerCase()],
    [CURRENT.slice(1)], [CURRENT + '0'], ['G'.repeat(64)], [CURRENT.match(/../g).join(':')],
    [null], [1], CURRENT,
  ]) rejectsFactory(t, realm, realm.local({ ...BASE, fingerprints }));
  for (const expression of [
    `Object.assign(${JSON.stringify(BASE)}, { fingerprints: new Uint8Array(32) })`,
    `Object.assign(${JSON.stringify(BASE)}, { fingerprints: Array(1) })`,
    `(() => { const c = ${JSON.stringify(BASE)}; c.fingerprints.extra = 1; return c; })()`,
    `(() => { const c = ${JSON.stringify(BASE)}; c.fingerprints[Symbol('extra')] = 1; return c; })()`,
    `(() => { const c = ${JSON.stringify(BASE)}; Object.setPrototypeOf(c.fingerprints, null); return c; })()`,
  ]) rejectsFactory(t, realm, realm.expression(expression));
});

test('TP-27', 'factory getters and proxies are rejected without executing caller code', async (t, realm) => {
  realm.expression('globalThis.inputTrapHits = 0');
  const expressions = [
    `(() => { const c = ${JSON.stringify(BASE)}; Object.defineProperty(c, 'allowRead', { get() { inputTrapHits++; return false; }, enumerable: true }); return c; })()`,
    `(() => { const c = ${JSON.stringify(BASE)}; Object.defineProperty(c.fingerprints, '0', { get() { inputTrapHits++; return ${JSON.stringify(CURRENT)}; }, enumerable: true }); return c; })()`,
    `new Proxy(${JSON.stringify(BASE)}, { ownKeys() { inputTrapHits++; throw 0; }, get() { inputTrapHits++; throw 0; }, getPrototypeOf() { inputTrapHits++; throw 0; } })`,
    `(() => { const c = ${JSON.stringify(BASE)}; c.fingerprints = new Proxy(c.fingerprints, { ownKeys() { inputTrapHits++; throw 0; }, get() { inputTrapHits++; throw 0; }, getPrototypeOf() { inputTrapHits++; throw 0; } }); return c; })()`,
    `(() => { const p = Proxy.revocable(${JSON.stringify(BASE)}, {}); p.revoke(); return p.proxy; })()`,
    `(() => { const c = ${JSON.stringify(BASE)}; Object.defineProperty(c, 'extra', { get() { inputTrapHits++; return 1; } }); return c; })()`,
    `(() => { const c = ${JSON.stringify(BASE)}; c[Symbol('extra')] = 1; return c; })()`,
    `Object.create(${JSON.stringify(BASE)})`,
  ];
  for (const code of expressions) rejectsFactory(t, realm, realm.expression(code));
  t.eq(realm.expression('inputTrapHits'), 0);
});

test('TP-28', 'caller mutations cannot alter copied pins, peer bytes or prepared requests', async (t, realm) => {
  const config = realm.local(BASE);
  const api = realm.factory(config);
  config.allowRead = true;
  config.fingerprints[0] = '0'.repeat(64);
  config.fingerprints.splice(1, 1);
  const peerInput = realm.local({ rawCertificate: CURRENT_RAW, expired: false, outcome: 'success' });
  const created = api.createFakePeer(peerInput);
  fixedResult(t, created, 'PASS', 'OK', ['peer']);
  peerInput.rawCertificate.fill(0);
  peerInput.expired = true;
  peerInput.outcome = 'tls-error';
  const requestInput = realm.local({ endpointId: 'deviceInfo', attempt: 1 });
  const prepared = api.prepareRequest(requestInput);
  fixedResult(t, prepared, 'PASS', 'OK', ['request']);
  requestInput.endpointId = 'fdlibCount';
  requestInput.attempt = 2;
  t.eq(Reflect.set(created.peer, 'rawCertificate', CURRENT_RAW), false);
  t.eq(Reflect.set(prepared.request, 'attempt', 2), false);
  api.releaseHandshake(created.peer);
  const summary = sendResult(t, await api.send(prepared.request, created.peer), 'PASS', 'OK');
  const observation = observe(t, api, created.peer);
  t.eq(summary.pinnedSlot, 0);
  t.eq(summary.certificateExpired, false);
  t.eq(observation.httpBytes, Buffer.byteLength(expectedWire(0, 1)));
  t.eq(observation.authorizationPresent, false);
});

test('TP-29', 'request descriptors reject endpoint, method, path and header overrides', async (t, realm) => {
  const api = realm.create();
  const inputs = [
    null, [], {}, { endpointId: 'unknown', attempt: 1 },
    ...[0, 3, '1', true, null].map((attempt) => ({ endpointId: 'deviceInfo', attempt })),
    { endpointId: 'deviceInfo', attempt: 1, method: 'POST' },
    { endpointId: 'deviceInfo', attempt: 1, path: '/override' },
    { endpointId: 'deviceInfo', attempt: 1, host: 'elsewhere.invalid' },
    { endpointId: 'deviceInfo', attempt: 1, headers: { Authorization: 'OVERRIDE' } },
    { endpointId: 'deviceInfo', attempt: 1, authorization: 'OVERRIDE' },
    { endpointId: 'deviceInfo', attempt: 1, body: 'PAYLOAD' },
  ];
  for (const input of inputs) {
    const result = api.prepareRequest(realm.local(input));
    fixedResult(t, result, 'FAIL', 'INVALID_REQUEST', ['request']);
    t.eq(result.request, null);
  }
});

test('TP-30', 'fake peer input requires bounded dense integer bytes and closed options', async (t, realm) => {
  const api = realm.create();
  const base = { rawCertificate: CURRENT_RAW, expired: false, outcome: 'success' };
  const inputs = [
    null, [], {}, { ...base, rawCertificate: 'abc' }, { ...base, rawCertificate: [-1] },
    { ...base, rawCertificate: [256] }, { ...base, rawCertificate: [1.5] },
    { ...base, rawCertificate: [null] }, { ...base, rawCertificate: Array(4097).fill(0) },
    { ...base, expired: 'false' }, { ...base, expired: 0 }, { ...base, outcome: 'other' },
    { ...base, extra: false }, { ...base, hostname: 'elsewhere.invalid' },
    ...Object.keys(base).map((key) => Object.fromEntries(Object.entries(base).filter(([name]) => name !== key))),
  ];
  for (const input of inputs) {
    const result = api.createFakePeer(realm.local(input));
    fixedResult(t, result, 'FAIL', 'INVALID_PEER', ['peer']);
    t.eq(result.peer, null);
  }
  const maximum = api.createFakePeer(realm.local({ ...base, rawCertificate: Array(4096).fill(0) }));
  fixedResult(t, maximum, 'PASS', 'OK', ['peer']);
  const fake = maximum.peer;
  api.releaseHandshake(fake);
  const summary = sendResult(t, await api.send(request(t, realm, api), fake), 'FAIL', 'TLS_PIN_MISMATCH');
  noHttp(t, summary, observe(t, api, fake));
});

test('TP-31', 'request and peer accessors, proxies and exotic arrays execute no caller code', async (t, realm) => {
  const api = realm.create();
  realm.expression('globalThis.inputTrapHits = 0');
  const requestExpressions = [
    `({ get endpointId() { inputTrapHits++; return 'deviceInfo'; }, attempt: 1 })`,
    `new Proxy({endpointId:'deviceInfo',attempt:1}, {get(){inputTrapHits++;throw 0},ownKeys(){inputTrapHits++;throw 0},getPrototypeOf(){inputTrapHits++;throw 0}})`,
    `Object.create({endpointId:'deviceInfo',attempt:1})`,
    `(() => { const x={endpointId:'deviceInfo',attempt:1}; Object.defineProperty(x,'extra',{get(){inputTrapHits++;return 1}}); return x; })()`,
  ];
  for (const code of requestExpressions) fixedResult(t, api.prepareRequest(realm.expression(code)), 'FAIL', 'INVALID_REQUEST', ['request']);
  const peerExpressions = [
    `({ get rawCertificate() { inputTrapHits++; return [97,98,99]; }, expired:false,outcome:'success' })`,
    `new Proxy({rawCertificate:[97,98,99],expired:false,outcome:'success'}, {get(){inputTrapHits++;throw 0},ownKeys(){inputTrapHits++;throw 0},getPrototypeOf(){inputTrapHits++;throw 0}})`,
    `({rawCertificate:new Proxy([97,98,99], {get(){inputTrapHits++;throw 0},ownKeys(){inputTrapHits++;throw 0},getPrototypeOf(){inputTrapHits++;throw 0}}),expired:false,outcome:'success'})`,
    `({rawCertificate:Array(3),expired:false,outcome:'success'})`,
    `({rawCertificate:new Uint8Array([97,98,99]),expired:false,outcome:'success'})`,
    `(() => { const a=[97,98,99]; Object.defineProperty(a,'0',{get(){inputTrapHits++;return 97}}); return {rawCertificate:a,expired:false,outcome:'success'}; })()`,
    `(() => { const a=[97,98,99]; a.extra=1; return {rawCertificate:a,expired:false,outcome:'success'}; })()`,
    `(() => { const a=[97,98,99]; a[Symbol('extra')]=1; return {rawCertificate:a,expired:false,outcome:'success'}; })()`,
    `(() => { const p=Proxy.revocable([97,98,99],{});p.revoke();return {rawCertificate:p.proxy,expired:false,outcome:'success'}; })()`,
  ];
  for (const code of peerExpressions) fixedResult(t, api.createFakePeer(realm.expression(code)), 'FAIL', 'INVALID_PEER', ['peer']);
  t.eq(realm.expression('inputTrapHits'), 0);
});

test('TP-32', 'proxy handles cannot execute caller traps through any API', async (t, realm) => {
  const api = realm.create();
  realm.expression('globalThis.handleTrapHits = 0');
  const proxy = realm.expression(`new Proxy({}, {get(){handleTrapHits++;throw 0},getPrototypeOf(){handleTrapHits++;throw 0},ownKeys(){handleTrapHits++;throw 0}})`);
  const req = request(t, realm, api);
  const fake = peer(t, realm, api);
  sendResult(t, await api.send(proxy, fake), 'FAIL', 'INVALID_REQUEST');
  sendResult(t, await api.send(req, proxy), 'FAIL', 'INVALID_PEER');
  for (const method of ['releaseHandshake', 'cancelPeer']) fixedResult(t, api[method](proxy), 'FAIL', 'INVALID_PEER');
  const invalidObservation = api.observePeer(proxy);
  fixedResult(t, invalidObservation, 'FAIL', 'INVALID_PEER', ['observation']);
  t.eq(invalidObservation.observation, null);
  t.eq(realm.expression('handleTrapHits'), 0);
  t.eq(observe(t, api, fake).connections, 0);
});

test('TP-33', 'observations and results disclose no pins, raw certificate or HTTP payload', async (t, realm) => {
  const api = realm.create();
  const req = request(t, realm, api, 'fdlibCapabilities', 2);
  const fake = peer(t, realm, api);
  const before = api.observePeer(fake);
  api.releaseHandshake(fake);
  const result = await api.send(req, fake);
  sendResult(t, result, 'PASS', 'OK');
  const after = api.observePeer(fake);
  const output = JSON.stringify({ req, fake, before, result, after });
  for (const marker of [CURRENT, NEXT, '[97,98,99]', '/ISAPI/', 'SYNTHETIC_DIGEST_AUTH', 'GET ', 'example.invalid', 'rawCertificate', 'fingerprints']) t.eq(output.includes(marker), false);
  t.eq(before.observation.httpBytes, 0);
  t.eq(before.observation.closed, false);
  deeplyFrozen(t, before);
  deeplyFrozen(t, after);
  t.eq(after.observation.httpBytes, Buffer.byteLength(expectedWire(3, 2)));
});

test('TP-34', 'separate returned snapshots and trace entries remain frozen', async (t, realm) => {
  const api = realm.create();
  const fake = peer(t, realm, api);
  const before = observe(t, api, fake);
  const snapshot = JSON.stringify(before);
  const pending = api.send(request(t, realm, api), fake);
  const waiting = observe(t, api, fake);
  api.releaseHandshake(fake);
  const result = await pending;
  sendResult(t, result, 'PASS', 'OK');
  t.eq(JSON.stringify(before), snapshot);
  t.eq(waiting.httpBytes, 0);
  t.eq(waiting.closed, false);
  t.eq(Reflect.set(result.summary, 'pinMatched', false), false);
  t.eq(Reflect.set(result.summary.clientTrace[0], 'event', 'HTTP_WRITE'), false);
  t.eq(result.summary.pinMatched, true);
});

function emit(record) { process.stdout.write(`${JSON.stringify(record)}\n`); }

emit({
  type: 'manifest', schemaVersion: 'hk-ai-08-synthetic-tls-pin-tests-v1',
  scope: SCOPE, dataClass: 'synthetic-only', caseCount: cases.length,
  moduleLoader: 'SourceTextModule', allowedBusinessImports: ['node:crypto', 'node:util'],
  vmProvidesProcess: false, vmProvidesNetwork: false, vmProvidesTimers: false,
  osSandboxClaimed: false, realTlsOrServerProofClaimed: false,
  receiverEvidence: 'private-fake-peer-http-byte-count',
});

let realm;
let passed = 0;
let failed = 0;
let assertions = 0;
try { realm = await loadBusinessModule(); } catch {
  emit({ type: 'summary', status: 'FAIL', cases: 0, passed, failed, assertions, failureClass: 'MODULE_LOAD_FAILED' });
  process.exitCode = 1;
}
if (realm) {
  for (const item of cases) {
    const t = assertionContext();
    let failureClass;
    try { await bounded(Promise.resolve().then(() => item.run(t, realm))); }
    catch (error) {
      failureClass = error instanceof AssertionFailure ? 'ASSERTION_FAILED' : error instanceof TimeoutFailure ? 'CASE_TIMEOUT' : 'CASE_EXECUTION_FAILED';
    }
    assertions += t.count;
    if (failureClass) failed += 1;
    else passed += 1;
    emit({ type: 'case', id: item.id, title: item.title, status: failureClass ? 'FAIL' : 'PASS', assertions: t.count, ...(failureClass ? { failureClass } : {}) });
  }
  emit({ type: 'summary', status: failed ? 'FAIL' : 'PASS', cases: passed + failed, passed, failed, assertions });
  if (failed) process.exitCode = 1;
}
