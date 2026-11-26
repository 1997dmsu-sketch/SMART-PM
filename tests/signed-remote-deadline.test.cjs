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

function actualClientWithInjectedTransports() {
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
  const clock = { now: START };
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
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
  }
  class MemoryRequest extends EventEmitter {
    constructor(options, onResponse) { super(); this.options = options; this.onResponse = onResponse; this.destroyed = false; this.ended = false; this.flushed = false; }
    end(body) { this.body = body === undefined ? undefined : Buffer.from(body); this.ended = true; this.flush(); }
    flush() {
      if (!this.socket || !this.ended || this.destroyed || this.flushed) return;
      this.flushed = true;
      const headers = Object.entries(this.options.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n');
      this.socket.write(Buffer.concat([Buffer.from(`${this.options.method} ${this.options.path} HTTP/1.1\r\n${headers}\r\n\r\n`), this.body || Buffer.alloc(0)]));
    }
    destroy() { this.destroyed = true; this.socket?.destroy(); }
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
    crypto, net: { isIP },
    tls: { checkServerIdentity() {}, connect(options) { const socket = new MemorySocket(); socket.options = options; sockets.push(socket); return socket; } },
    https: {
      Agent: MemoryAgent,
      request(options, onResponse) {
        const request = new MemoryRequest(options, onResponse);
        requests.push(request);
        const returned = options.agent.createConnection({ timeout: options.timeout }, (error, socket) => {
          if (error) request.emit('error', error);
          else { successfulSocketCallbacks.push(socket); request.socket = socket; request.flush(); }
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

test('absolute deadline is optional, validates epoch milliseconds and bounds the relative timeout', async () => {
  const invalid = actualClientWithInjectedTransports();
  for (const absoluteDeadline of [null, 0, -1, 1.5, '1800000000100', Infinity, NaN]) {
    assert.throws(() => invalid.create({ absoluteDeadline }), (error) => error?.code === 'HIKVISION_CONFIGURATION');
  }
  assert.equal(invalid.requests.length, 0);
  for (const [options, expected] of [
    [{ absoluteDeadline: START + 400 }, 400],
    [{ absoluteDeadline: START + 400, timeoutMs: 100 }, 100],
    [{}, 5000],
  ]) {
    const memory = actualClientWithInjectedTransports();
    const client = memory.create(options);
    const pending = client.request({ method: 'GET', path: '/ISAPI/System/deviceInfo' });
    assert.equal(memory.requests[0].options.timeout, expected);
    memory.sockets[0].emit('secureConnect');
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
