'use strict';

// Guard real built-in entry points before loading any business source. The VM
// receives separate in-memory transports; this test never replaces guard slots.
const fakes = globalThis.__DSH_D_NETWORK_GUARD__
  ? globalThis.__DSH_D_NETWORK_FAKES__ || null
  : require('./support/d-network-fakes.cjs');
const guard = globalThis.__DSH_D_NETWORK_GUARD__ || require('./support/d-network-guard.cjs');
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { readFileSync } = require('node:fs');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { isIP } = require('node:net');
const installed = guard.snapshot();
const fakeInstalled = fakes && fakes.snapshotCounts();
const START = 1800000000000;
const BODY = '<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>';
let certificate;

before(async () => {
  ({ SYNTHETIC_CERT: certificate } = await import('../admin-web/tests/fixtures/hikvision-synthetic-certificates.mjs'));
  guard.assertNoViolations(installed, 'deadline fixture loading');
});
after(() => {
  guard.assertNoViolations(installed, 'actual client in-memory deadline suite');
  if (fakes) assert.deepEqual(fakes.snapshotCounts(), fakeInstalled);
});

function actualClientWithInjectedTransports(hooks = {}) {
  let source = readFileSync(require.resolve('../admin-web/lib/hikvision-client.mjs'), 'utf8');
  // Only import/export syntax is changed, by exact one-occurrence anchors. All
  // client/agent/authentication/deadline logic executes verbatim from its file.
  const anchors = [
    ["import https from 'node:https';", 'const https = dependencies.https;'],
    ["import tls from 'node:tls';", 'const tls = dependencies.tls;'],
    ["import { isIP } from 'node:net';", 'const { isIP } = dependencies.net;'],
    ["import { createHash, randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';", 'const { createHash, randomBytes, timingSafeEqual, X509Certificate } = dependencies.crypto;'],
    ['export class HikvisionClient {', 'exports.HikvisionClient = class HikvisionClient {'],
  ];
  for (const [from, to] of anchors) {
    assert.equal(source.split(from).length - 1, 1, `actual-source anchor changed: ${from}`);
    source = source.replace(from, to);
  }
  // The old implementation has no monotonic import. Keeping that old source
  // executable is necessary to preserve the red control; the repaired import
  // is replaced exactly once, without changing any deadline business logic.
  const perfImport = "import { performance } from 'node:perf_hooks';";
  const perfOccurrences = source.split(perfImport).length - 1;
  assert.ok(perfOccurrences === 0 || perfOccurrences === 1, 'monotonic import anchor duplicated');
  if (perfOccurrences) source = source.replace(perfImport, 'const { performance } = dependencies.perf;');
  const clock = { now: START, mono: 5000 };
  const sockets = [];
  const requests = [];
  const successfulSocketCallbacks = [];
  const timers = [];
  const raw = new crypto.X509Certificate(certificate).raw;
  class MemorySocket extends EventEmitter {
    constructor() { super(); this.destroyed = false; this.writes = []; }
    getPeerCertificate() { return { raw }; }
    setTimeout(milliseconds, callback) { this.timeout = milliseconds; this.timeoutCallback = callback; return this; }
    write(bytes) { assert.equal(this.destroyed, false); this.writes.push(Buffer.from(bytes)); return true; }
    destroy(error) {
      if (!this.destroyed) {
        this.destroyed = true; this.emit('close');
        if (error) process.nextTick(() => { if (this.listenerCount('error')) this.emit('error', error); });
      }
    }
  }
  class MemoryRequest extends EventEmitter {
    constructor(options, onResponse) { super(); this.options = options; this.onResponse = onResponse; this.destroyed = false; this.ended = false; this.flushed = false; this.flushCalls = 0; }
    end(body) { this.body = body === undefined ? undefined : Buffer.from(body); this.ended = true; if (this.socket) this._flush(); }
    onSocket(socket) {
      // Mirror Node's callback -> onSocket -> nextTick(onSocketNT) gap. The
      // response is NOT synchronously flushed inside the agent callback.
      process.nextTick(() => {
        if (this.destroyed) { socket.destroy(); return; }
        this.socket = socket;
        socket.on('error', error => { if (!this.destroyed) this.emit('error', error); });
        this.emit('socket', socket);
        this._flush();
      });
    }
    _flush() {
      this.flushCalls += 1;
      if (!this.socket || !this.ended || this.destroyed || this.flushed) return;
      this.flushed = true;
      const headers = Object.entries(this.options.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n');
      hooks.beforeWrite?.(this);
      this.socket.write(Buffer.concat([Buffer.from(`${this.options.method} ${this.options.path} HTTP/1.1\r\n${headers}\r\n\r\n`), this.body || Buffer.alloc(0)]));
    }
    destroy(error) {
      if (this.destroyed) return;
      this.destroyed = true; this.socket?.destroy();
      if (error) process.nextTick(() => this.emit('error', error));
    }
    respond(status, headers = {}, body = '') {
      const response = new EventEmitter();
      response.statusCode = status; response.headers = headers; response.destroy = () => {};
      this.onResponse(response);
      if (body) response.emit('data', Buffer.from(body));
      response.emit('end');
    }
  }
  class MemoryAgent { destroy() {} }
  const dependencies = {
    crypto, net: { isIP }, perf: { performance: { now: () => clock.mono } },
    tls: { checkServerIdentity() {}, connect(options) { const socket = new MemorySocket(); socket.options = options; sockets.push(socket); return socket; } },
    https: {
      Agent: MemoryAgent,
      request(options, onResponse) {
        const request = new MemoryRequest(options, onResponse);
        requests.push(request);
        const returned = options.agent.createConnection({ timeout: options.timeout }, (error, socket) => {
          if (error) request.emit('error', error);
          else { successfulSocketCallbacks.push(socket); request.onSocket(socket); }
        });
        assert.equal(returned, undefined, 'agent must not expose an unchecked socket');
        return request;
      },
    },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports, dependencies, Buffer, URL, Date: { now: () => clock.now },
    setTimeout(callback, milliseconds) { const timer = { callback, milliseconds, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
  }, { filename: 'actual-hikvision-client-in-memory.cjs' });
  const create = (options = {}) => new exports.HikvisionClient({
    origin: 'https://synthetic.invalid', username: 'synthetic-user', password: 'synthetic-password',
    certificate: Buffer.from(certificate), developmentTls: false, timeoutMs: 5000, ...options,
  });
  return { create, clock, sockets, requests, successfulSocketCallbacks, timers };
}
const timeout = (error) => error?.code === 'HIKVISION_TIMEOUT';
const challenge = { 'www-authenticate': 'Digest realm="synthetic", nonce="synthetic-nonce", algorithm=SHA-256, qop="auth"' };
async function microtasks() { await Promise.resolve(); await Promise.resolve(); }
async function socketTicks() { await new Promise(resolve => process.nextTick(resolve)); }
function completeIfWritten(request) { if (request.flushed && !request.destroyed) request.respond(200); }

test('pin-valid TLS completing exactly at the absolute deadline exposes no socket or HTTP bytes', async () => {
  const memory = actualClientWithInjectedTransports();
  const deadline = START + 100;
  const client = memory.create({ absoluteDeadline: deadline });
  const pending = client.request({ method: 'PUT', path: '/ISAPI/AccessControl/RemoteControl/door/7', body: BODY, contentType: 'application/xml' });
  assert.equal(memory.sockets.length, 1);
  assert.equal(memory.sockets[0].options.rejectUnauthorized, true);
  assert.equal(memory.sockets[0].writes.length, 0);
  memory.clock.now = deadline;
  memory.sockets[0].emit('secureConnect');
  await assert.rejects(pending, timeout);
  assert.equal(memory.successfulSocketCallbacks.length, 0);
  assert.equal(memory.sockets[0].writes.length, 0);
  assert.equal(memory.sockets[0].destroyed, true);
  client.close();
});

test('a 401 arriving at the absolute deadline creates no second HTTP request', async () => {
  const memory = actualClientWithInjectedTransports();
  const deadline = START + 100;
  const client = memory.create({ absoluteDeadline: deadline });
  const pending = client.request({ method: 'PUT', path: '/ISAPI/AccessControl/RemoteControl/door/7', body: BODY });
  memory.sockets[0].emit('secureConnect');
  await socketTicks();
  assert.equal(memory.sockets[0].writes.length, 1, 'positive control: before-deadline socket permits the first request');
  memory.clock.now = deadline;
  memory.requests[0].respond(401, challenge);
  await assert.rejects(pending, timeout);
  assert.equal(memory.requests.length, 1);
  assert.equal(memory.sockets.length, 1);
  assert.doesNotMatch(Buffer.concat(memory.sockets[0].writes).toString('utf8'), /Authorization:/);
  client.close();
});

test('Digest TLS crossing the absolute deadline sends neither Authorization nor the body', async () => {
  const memory = actualClientWithInjectedTransports();
  const deadline = START + 100;
  const client = memory.create({ absoluteDeadline: deadline });
  const pending = client.request({ method: 'PUT', path: '/ISAPI/AccessControl/RemoteControl/door/7', body: BODY });
  memory.sockets[0].emit('secureConnect');
  await socketTicks();
  memory.clock.now = deadline - 1;
  memory.requests[0].respond(401, challenge);
  await microtasks();
  assert.equal(memory.requests.length, 2, 'the actual Digest path creates its authenticated request');
  assert.match(memory.requests[1].options.headers.Authorization, /^Digest /);
  assert.equal(memory.sockets[1].writes.length, 0);
  memory.clock.now = deadline;
  memory.sockets[1].emit('secureConnect');
  await assert.rejects(pending, timeout);
  assert.equal(memory.successfulSocketCallbacks.length, 1, 'only the first pre-deadline socket was exposed');
  assert.equal(memory.sockets[1].writes.length, 0);
  assert.equal(memory.sockets[1].destroyed, true);
  client.close();
});

test('B-01 first socket handoff crosses deadline in nextTick without flushing HTTP bytes', async () => {
  const memory = actualClientWithInjectedTransports();
  const deadline = START + 100;
  const client = memory.create({ absoluteDeadline: deadline, monotonicDeadline: 5100 });
  const pending = client.request({ method: 'PUT', path: '/ISAPI/AccessControl/RemoteControl/door/7', body: BODY });
  pending.catch(() => {});
  memory.clock.now = deadline - 1; memory.clock.mono = 5099;
  memory.sockets[0].emit('secureConnect');
  assert.equal(memory.successfulSocketCallbacks.length, 1, 'pin passed before deadline');
  assert.equal(memory.sockets[0].writes.length, 0, 'agent callback must not synchronously flush');
  memory.clock.now = deadline; memory.clock.mono = 5100;
  await socketTicks();
  completeIfWritten(memory.requests[0]);
  await assert.rejects(pending, timeout);
  assert.equal(memory.sockets[0].writes.length, 0);
  assert.equal(memory.requests[0].destroyed, true);
  client.close();
});

test('B-01 authenticated socket handoff crosses deadline in nextTick without Authorization or body', async () => {
  const memory = actualClientWithInjectedTransports();
  const deadline = START + 100;
  const client = memory.create({ absoluteDeadline: deadline, monotonicDeadline: 5100 });
  const pending = client.request({ method: 'PUT', path: '/ISAPI/AccessControl/RemoteControl/door/7', body: BODY });
  pending.catch(() => {});
  memory.sockets[0].emit('secureConnect'); await socketTicks();
  memory.clock.now = deadline - 2; memory.clock.mono = 5098;
  memory.requests[0].respond(401, challenge); await microtasks();
  assert.match(memory.requests[1].options.headers.Authorization, /^Digest /);
  memory.clock.now = deadline - 1; memory.clock.mono = 5099;
  memory.sockets[1].emit('secureConnect');
  assert.equal(memory.successfulSocketCallbacks.length, 2);
  assert.equal(memory.sockets[1].writes.length, 0);
  memory.clock.now = deadline; memory.clock.mono = 5100;
  await socketTicks(); completeIfWritten(memory.requests[1]);
  await assert.rejects(pending, timeout);
  assert.equal(memory.sockets[1].writes.length, 0);
  client.close();
});

test('B-01 final application write boundary rechecks time after socket event and inside flush', async () => {
  let memory;
  memory = actualClientWithInjectedTransports({ beforeWrite() { memory.clock.now = START + 100; memory.clock.mono = 5100; } });
  const client = memory.create({ absoluteDeadline: START + 100, monotonicDeadline: 5100 });
  const pending = client.request({ method: 'PUT', path: '/ISAPI/AccessControl/RemoteControl/door/7', body: BODY });
  pending.catch(() => {});
  memory.clock.now = START + 99; memory.clock.mono = 5099;
  memory.sockets[0].emit('secureConnect'); await socketTicks();
  completeIfWritten(memory.requests[0]);
  await assert.rejects(pending, timeout);
  assert.equal(memory.requests[0].flushCalls, 1, 'negative control enters the simulated Node flush');
  assert.equal(memory.sockets[0].writes.length, 0, 'expiry before underlying TLS.write must block bytes');
  client.close();
});

test('B-02 wall rollback cannot extend the original 401/TLS monotonic budget', async () => {
  const memory = actualClientWithInjectedTransports();
  const client = memory.create({ absoluteDeadline: START + 100, monotonicDeadline: 5100 });
  const pending = client.request({ method: 'PUT', path: '/ISAPI/AccessControl/RemoteControl/door/7', body: BODY });
  pending.catch(() => {});
  memory.sockets[0].emit('secureConnect'); await socketTicks();
  assert.equal(memory.sockets[0].writes.length, 1);
  memory.clock.now = START - 40; memory.clock.mono = 5060;
  memory.requests[0].respond(401, challenge); await microtasks();
  const authenticated = memory.requests[1];
  assert.ok(authenticated, 'remaining monotonic time permits construction before expiry');
  assert.match(authenticated.options.headers.Authorization, /^Digest /);
  memory.clock.now = START + 20; memory.clock.mono = 5120;
  memory.sockets[1].emit('secureConnect'); await socketTicks();
  completeIfWritten(authenticated);
  await assert.rejects(pending, timeout);
  assert.ok(authenticated.options.timeout <= 40, '401 gets only the unspent original budget');
  assert.equal(memory.sockets[1].writes.length, 0);
  assert.equal(memory.successfulSocketCallbacks.length, 1);
  client.close();
});

test('B-02 wall rollback after pin cannot extend async socket handoff or final write', async () => {
  for (const phase of ['handoff', 'write']) {
    let memory;
    memory = actualClientWithInjectedTransports(phase === 'write' ? { beforeWrite() { memory.clock.now = START - 100; memory.clock.mono = 5100; } } : {});
    const client = memory.create({ absoluteDeadline: START + 100, monotonicDeadline: 5100 });
    const pending = client.request({ method: 'PUT', path: '/ISAPI/AccessControl/RemoteControl/door/7', body: BODY });
    pending.catch(() => {});
    memory.clock.now = START + 99; memory.clock.mono = 5099;
    memory.sockets[0].emit('secureConnect');
    if (phase === 'handoff') { memory.clock.now = START - 100; memory.clock.mono = 5100; }
    await socketTicks(); completeIfWritten(memory.requests[0]);
    await assert.rejects(pending, timeout);
    assert.equal(memory.sockets[0].writes.length, 0, phase);
    client.close();
  }
});

test('B-02 absolute-only clients anchor a nonrenewable budget and no-deadline clients keep legacy semantics', async () => {
  const memory = actualClientWithInjectedTransports();
  const client = memory.create({ absoluteDeadline: START + 100 });
  const pending = client.request({ method: 'PUT', path: '/ISAPI/AccessControl/RemoteControl/door/7', body: BODY });
  pending.catch(() => {});
  memory.clock.now = START - 100; memory.clock.mono = 5100;
  memory.sockets[0].emit('secureConnect'); await socketTicks();
  completeIfWritten(memory.requests[0]);
  await assert.rejects(pending, timeout);
  assert.equal(memory.sockets[0].writes.length, 0);
  client.close();

  const legacy = actualClientWithInjectedTransports();
  const oldClient = legacy.create();
  const oldPending = oldClient.request({ method: 'GET', path: '/ISAPI/System/deviceInfo' });
  legacy.sockets[0].emit('secureConnect');
  legacy.clock.now = START + 100000; legacy.clock.mono += 100000;
  await socketTicks(); legacy.requests[0].respond(200);
  assert.equal((await oldPending).status, 200);
  assert.equal(legacy.sockets[0].writes.length, 1, 'no optional authorization deadline retains old behavior');
  oldClient.close();
});

test('B-02 a task budget consumed before client construction is never recreated from a rolled-back wall clock', async () => {
  const memory = actualClientWithInjectedTransports();
  memory.clock.now = START - 100; memory.clock.mono = 5100;
  const client = memory.create({ absoluteDeadline: START + 100, monotonicDeadline: 5100 });
  const pending = client.request({ method: 'GET', path: '/ISAPI/System/deviceInfo' });
  pending.catch(() => {});
  if (memory.sockets.length) {
    memory.sockets[0].emit('secureConnect'); await socketTicks();
    completeIfWritten(memory.requests[0]);
  }
  await assert.rejects(pending, timeout);
  assert.equal(memory.requests.length, 0, 'the caller-supplied original budget was already exhausted');
  client.close();
});

test('absolute deadline is optional, validates epoch milliseconds and bounds the relative timeout', async () => {
  const invalid = actualClientWithInjectedTransports();
  for (const absoluteDeadline of [null, 0, -1, 1.5, '1800000000100', Infinity, NaN]) {
    assert.throws(() => invalid.create({ absoluteDeadline }), (error) => error?.code === 'HIKVISION_CONFIGURATION');
  }
  for (const monotonicDeadline of [null, '5100', Infinity, NaN, -1]) {
    assert.throws(() => invalid.create({ absoluteDeadline: START + 100, monotonicDeadline }), (error) => error?.code === 'HIKVISION_CONFIGURATION');
  }
  assert.throws(() => invalid.create({ monotonicDeadline: 5100 }), (error) => error?.code === 'HIKVISION_CONFIGURATION');
  assert.equal(invalid.requests.length, 0);
  for (const [options, expected] of [
    [{ absoluteDeadline: START + 400 }, 400],
    [{ absoluteDeadline: START + 400, timeoutMs: 100 }, 100],
    [{ absoluteDeadline: START + 400, monotonicDeadline: 5015 }, 15],
    [{}, 5000],
  ]) {
    const memory = actualClientWithInjectedTransports();
    const client = memory.create(options);
    const pending = client.request({ method: 'GET', path: '/ISAPI/System/deviceInfo' });
    assert.equal(memory.requests[0].options.timeout, expected);
    memory.sockets[0].emit('secureConnect');
    await socketTicks();
    memory.requests[0].respond(200, {}, '<DeviceInfo/>');
    assert.equal((await pending).status, 200);
    assert.equal(memory.sockets[0].writes.length, 1);
    client.close();
  }
  const expired = actualClientWithInjectedTransports();
  const client = expired.create({ absoluteDeadline: START });
  await assert.rejects(client.request({ method: 'GET', path: '/ISAPI/System/deviceInfo' }), timeout);
  assert.equal(expired.requests.length, 0);
  client.close();
});
