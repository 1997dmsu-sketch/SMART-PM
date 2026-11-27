import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import tls from 'node:tls';
import { FaceReadonlyHost } from '../lib/face-readonly-host.mjs';
import { SYNTHETIC_CERT, SYNTHETIC_OTHER_CERT, SYNTHETIC_RENEWED_CERT } from './fixtures/hikvision-synthetic-certificates.mjs';
import {
  installFakeTransport, createSyntheticResponseMap, syntheticConfig,
  SYNTHETIC_ORIGIN, SYNTHETIC_USERNAME, SYNTHETIC_PASSWORD,
  SYNTHETIC_PATHS as paths, jsonReply, textReply,
} from './fixtures/face-readonly-fake-transport.mjs';

// Process-local patches are serial and restored by t.after. These tests do not
// listen, perform DNS, connect to a device, or load any real configuration/photo.
const safeCode = /^(?:READONLY_[A-Z0-9_]+|HIKVISION_(?:CONFIGURATION|TLS_PIN|AUTH_CHALLENGE|TIMEOUT|TRANSPORT|REDIRECT|RESPONSE_SIZE|REQUEST|CLOSED))$/;
const writes = ['enroll', 'retry', 'verify', 'prepareDelete', 'delete', 'followDelete'];

function hostFor(t, options) {
  const host = new FaceReadonlyHost(options);
  t.after(() => host.close());
  return host;
}

function hostilePrototypeInput() {
  let codeReads = 0;
  const thrown = Object.defineProperty({}, 'code', {
    get() { codeReads += 1; throw new Error('SYNTHETIC_UNTRUSTED_ERROR_GETTER'); },
  });
  return {
    value: new Proxy({}, { getPrototypeOf() { throw thrown; } }),
    get codeReads() { return codeReads; },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(fulfill => { resolve = fulfill; });
  return { promise, resolve };
}

async function promptly(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Host cancellation waited for the SDK response deadline')), 250);
    })]);
  } finally { clearTimeout(timer); }
}

function assertSafeOutput(value) {
  const text = JSON.stringify(value);
  for (const forbidden of [
    SYNTHETIC_ORIGIN, SYNTHETIC_USERNAME, SYNTHETIC_PASSWORD,
    'SYNTHETIC_PERSON_PASSWORD', 'SYNTHETIC_CARD_NUMBER',
    'SYNTHETIC_PERSON_MODEL_DATA', 'SYNTHETIC_FACE_MODEL_DATA',
    'synthetic-private.invalid', 'faceURL', 'modelData', 'certificateBase64',
    'BEGIN CERTIFICATE', 'photoBase64',
  ]) assert(!text.includes(forbidden), `Output exposed a synthetic sensitive field: ${forbidden}`);
  for (const forbidden of ['origin', 'username', 'password', 'certificate', 'cardNo', 'authorization']) {
    assert(!text.includes(`"${forbidden}"`), `Output exposed field: ${forbidden}`);
  }
}

async function expectBlocked(host, operation, expectedCode) {
  let caught;
  await assert.rejects(operation, error => {
    assert.match(error?.code ?? '', safeCode);
    if (expectedCode) assert.equal(error.code, expectedCode);
    caught = error;
    return true;
  });
  const state = host.state();
  assert.equal(state.readonly.blocked, true);
  assert.equal(state.readonly.errorCode, caught.code);
  assertSafeOutput(state);
  assertSafeOutput({ code: caught.code, message: caught.message });
  return caught.code;
}

async function assertNoRequestsAfterBlock(host, network, firstCode) {
  const before = { http: network.httpRequests, https: network.httpsCalls, tls: network.tlsConnections };
  for (const operation of [
    () => host.connect(syntheticConfig()),
    () => host.list(),
    () => host.dispatch('list', {}),
    () => host.dispatch('POST /ISAPI/AccessControl/UserInfo/Record?format=json', {}),
    () => host.enroll({ employeeNo: 'EMP3' }),
  ]) {
    await assert.rejects(operation, error => {
      assert.match(error?.code ?? '', safeCode);
      return true;
    });
    assert.equal(host.state().readonly.errorCode, firstCode);
  }
  // Closing remains synchronous, idempotent, and cannot erase the first fault.
  const closed = host.close();
  assert.equal(typeof closed?.then, 'undefined');
  host.close();
  assert.equal(host.state().readonly.errorCode, firstCode);
  assert.deepEqual({ http: network.httpRequests, https: network.httpsCalls, tls: network.tlsConnections }, before);
  assert.equal(network.earlyHttpRequests, 0);
  assert(network.sockets.every(socket => socket.destroyed));
  assertSafeOutput(host.state());
}

describe('FaceReadonlyHost with the real SDK and synthetic bottom transport', { concurrency: false }, () => {
  test('the transport control detects a socket returned before TLS/pin verification', async t => {
    const network = installFakeTransport(t, {
      peerCertificate: SYNTHETIC_OTHER_CERT,
      onRequest: () => textReply('synthetic harness control'),
    });
    const result = new Promise((resolve, reject) => {
      const request = https.request({
        method: 'GET', path: '/synthetic-harness-control', timeout: 50,
        agent: { createConnection: () => tls.connect({ host: 'synthetic.invalid' }) },
      }, response => { response.resume(); response.once('end', resolve); });
      request.once('error', reject);
      request.end();
    });
    // A negative control must be observable before the queued secureConnect.
    assert.equal(network.httpRequests, 1);
    assert.equal(network.earlyHttpRequests, 1);
    await result;
  });

  test('describe and one complete list traverse synthetic people, both face libraries and the complete all-day plan', async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t);
    const connected = await host.connect(syntheticConfig({ planTemplateNo: '1' }));
    assert.equal(connected.device.model, 'DS-K1T671BM');
    assert.equal(connected.capabilities.allDayPlan.templateNo, '1');
    assert.equal(connected.capabilities.allDayPlan.name, '每天24小时');
    assert.deepEqual(connected.capabilities.allDayPlan.holidayGroupNos, ['32']);
    assert.match(connected.capabilities.allDayPlan.fingerprint, /^[a-f0-9]{64}$/);
    const result = await host.list();
    assert.equal(result.complete, true);
    assert.equal(result.total, 2);
    assert.deepEqual(result.people.map(person => person.employeeNo), ['EMP1', 'EMP2']);
    for (const person of result.people) {
      assert.equal(person.deleteAllowed, false);
      assert.equal(person.managementSearchObserved, true);
      assert.equal(person.faces.blackFD.status, 'present');
      assert.equal(person.faces.infraredFD.status, 'present');
    }
    assert.equal(host.state().readonly.status, 'COMPLETE');
    assert.equal(host.state().readonly.blocked, false);
    assert.equal(host.state().readonly.logicalRequests, 15);
    assert.equal(network.httpRequests, 15);
    assert.equal(network.tlsConnections, 15);
    assert.equal(network.earlyHttpRequests, 0);
    assert(network.sockets.every(socket => socket.destroyed));
    const pages = network.requests.filter(request => request.path === paths.people);
    assert.deepEqual(pages.map(request => request.json.UserInfoSearchCond.searchResultPosition), [0, 1]);
    assert.equal(network.requests.filter(request => request.path === paths.faces).length, 4);
    for (const path of [paths.templateCapabilities, paths.template, paths.week, paths.holidayGroup, paths.holiday]) {
      assert(network.requests.some(request => request.method === 'GET' && request.path === path));
    }
    assert(network.requests.every(request => request.method === 'GET' || request.method === 'POST' && [paths.people, paths.faces].includes(request.path)));
    assertSafeOutput({ connected, result, state: host.state() });
    const disconnected = await host.disconnect();
    assertSafeOutput(disconnected);
    assert.equal(host.state().connected, false);
    assert.equal(network.httpRequests, 15);
  });

  test('dispatch exposes only the four read session actions', async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t);
    assertSafeOutput(await host.dispatch('state'));
    await host.dispatch('connect', syntheticConfig());
    const result = await host.dispatch('list', {});
    assert.equal(result.complete, true);
    assert.equal(result.total, 2);
    assertSafeOutput(await host.dispatch('state', {}));
    assertSafeOutput(await host.dispatch('disconnect', {}));
    assert.equal(network.httpRequests, 15);
    assert.equal(network.earlyHttpRequests, 0);
  });

  test('a same-public-key renewed certificate is accepted without exposing configuration, faceURL or modelData', async t => {
    const network = installFakeTransport(t, { peerCertificate: SYNTHETIC_RENEWED_CERT });
    const host = hostFor(t);
    const connected = await host.connect(syntheticConfig());
    const result = await host.list({});
    assert.equal(result.complete, true);
    assert.equal(network.httpRequests, 15);
    assert.equal(network.earlyHttpRequests, 0);
    assertSafeOutput({ connected, result, state: host.state() });
  });

  test('strict base64 certificate configuration follows the same real pin gate', async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t);
    const config = syntheticConfig({ certificateBase64: Buffer.from(SYNTHETIC_CERT).toString('base64') });
    delete config.certificate;
    await host.connect(config);
    assert.equal((await host.list()).total, 2);
    assert.equal(network.earlyHttpRequests, 0);
    assertSafeOutput(host.state());
  });

  test('the real SDK Digest retry uses one logical request and passes TLS pinning again', async t => {
    const network = installFakeTransport(t, {
      onRequest: (_request, count) => count === 1 ? textReply('synthetic authenticate', 401, {
        'www-authenticate': 'Digest realm="synthetic-realm", nonce="synthetic-nonce", algorithm=SHA-256, qop="auth"',
      }) : undefined,
    });
    const host = hostFor(t);
    await host.connect(syntheticConfig());
    const result = await host.list();
    assert.equal(result.complete, true);
    assert.equal(network.httpRequests, 16);
    assert.equal(host.state().readonly.logicalRequests, 15);
    assert.equal(network.requests[0].headers.Authorization, undefined);
    assert.match(network.requests[1].headers.Authorization, /^Digest /);
    assert.equal(network.requests[0].path, network.requests[1].path);
    assert.equal(network.earlyHttpRequests, 0);
    assertSafeOutput({ result, state: host.state() });
  });

  for (const [label, mutate] of [
    ['missing expected certificate', config => { delete config.certificate; }],
    ['both certificate forms', config => { config.certificateBase64 = Buffer.from(SYNTHETIC_CERT).toString('base64'); }],
    ['invalid certificate bytes', config => { config.certificate = Buffer.from('synthetic-invalid-certificate'); }],
    ['invalid base64 certificate', config => { delete config.certificate; config.certificateBase64 = 'not strict base64!'; }],
    ['simulation mode', config => { config.mode = 'simulation'; }],
    ['HTTP origin', config => { config.origin = 'http://synthetic.invalid'; }],
    ['an origin containing credentials', config => { config.origin = 'https://synthetic-user:synthetic-pass@synthetic.invalid'; }],
    ['an origin containing a path', config => { config.origin = 'https://synthetic.invalid/ISAPI'; }],
    ['a nonboolean TLS switch', config => { config.developmentTls = 'true'; }],
    ['a different template number', config => { config.planTemplateNo = '2'; }],
    ['a caller timeout override', config => { config.timeoutMs = 10; }],
    ['a caller factory override', config => { config.clientFactory = () => { throw new Error('must not run'); }; }],
    ['an unknown configuration field', config => { config.unknownField = true; }],
  ]) test(`${label} is rejected before any TLS or HTTP`, async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t);
    const config = syntheticConfig();
    mutate(config);
    const code = await expectBlocked(host, () => host.connect(config));
    assert.equal(network.tlsConnections, 0);
    assert.equal(network.httpsCalls, 0);
    assert.equal(network.httpRequests, 0);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  test('a throwing constructor prototype trap is sanitized without reading the thrown code getter', t => {
    const network = installFakeTransport(t);
    const input = hostilePrototypeInput();
    assert.throws(() => new FaceReadonlyHost(input.value), error => {
      assert.equal(error.code, 'READONLY_OPTIONS');
      assert(!error.message.includes('SYNTHETIC_UNTRUSTED_ERROR_GETTER'));
      return true;
    });
    assert.equal(input.codeReads, 0);
    assert.equal(network.tlsConnections, 0);
    assert.equal(network.httpsCalls, 0);
    assert.equal(network.httpRequests, 0);
  });

  test('a READY list prototype trap is sanitized, closes the client and cannot bypass the first-fault latch', async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t);
    await host.connect(syntheticConfig());
    const before = network.httpRequests;
    const input = hostilePrototypeInput();
    const code = await expectBlocked(host, () => host.list(input.value), 'READONLY_INPUT');
    assert.equal(input.codeReads, 0);
    assert.equal(network.httpRequests, before);
    assert(network.sockets.every(socket => socket.destroyed));
    await assertNoRequestsAfterBlock(host, network, code);
    assert.equal(input.codeReads, 0);
  });

  for (const [label, peerCertificate] of [
    ['different public key', SYNTHETIC_OTHER_CERT],
    ['missing peer certificate', null],
  ]) test(`${label} fails actual SDK pin verification before any HTTP`, async t => {
    const network = installFakeTransport(t, { peerCertificate });
    const host = hostFor(t);
    const code = await expectBlocked(host, () => host.connect(syntheticConfig()), 'HIKVISION_TLS_PIN');
    assert.equal(network.tlsConnections, 1);
    assert.equal(network.httpsCalls, 1);
    assert.equal(network.httpRequests, 0);
    assert.equal(network.earlyHttpRequests, 0);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  for (const method of writes) test(`${method} is a blocked compatibility method and latches before connection`, async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t);
    assert.equal(typeof host[method], 'function');
    const code = await expectBlocked(host, () => host[method]({ employeeNo: 'EMP1', photoBase64: 'SYNTHETIC_DO_NOT_READ' }));
    assert.equal(network.tlsConnections, 0);
    assert.equal(network.httpRequests, 0);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  for (const method of writes) test(`${method} cannot delegate to a connected enrollment service`, async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t);
    await host.connect(syntheticConfig());
    const before = network.httpRequests;
    const code = await expectBlocked(host, () => host[method]({ employeeNo: 'EMP1' }));
    assert.equal(network.httpRequests, before);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  for (const action of [
    ...writes, 'request', 'POST', 'POSTRecord',
    '/ISAPI/AccessControl/UserInfo/Record?format=json',
    'POST /ISAPI/AccessControl/UserInfo/Record?format=json',
    'PUT /ISAPI/Intelligent/FDLib/FDSetUp?format=json',
    'GET /ISAPI/System/deviceInfo', 'unknown', '__proto__',
  ]) test(`unknown or write dispatch ${action} closes the session before subsequent traffic`, async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t);
    await host.connect(syntheticConfig());
    const before = network.httpRequests;
    const code = await expectBlocked(host, () => host.dispatch(action, { employeeNo: 'EMP1' }));
    assert.equal(network.httpRequests, before);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  for (const [label, operation] of [
    ['connect extra argument', host => host.connect(syntheticConfig(), {})],
    ['list extra argument', host => host.list({}, {})],
    ['list unknown input', host => host.list({ employeeNo: 'EMP1' })],
    ['dispatch extra argument', host => host.dispatch('list', {}, {})],
    ['dispatch state unknown input', host => host.dispatch('state', { unknown: true })],
    ['dispatch disconnect unknown input', host => host.dispatch('disconnect', { unknown: true })],
    ['disconnect extra argument', host => host.disconnect({}, {})],
  ]) test(`${label} latches without TLS or HTTP`, async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t);
    const code = await expectBlocked(host, () => operation(host));
    assert.equal(network.tlsConnections, 0);
    assert.equal(network.httpRequests, 0);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  test('a second connect cannot replace a connected session or open another socket', async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t);
    await host.connect(syntheticConfig());
    const before = network.httpRequests;
    const code = await expectBlocked(host, () => host.connect(syntheticConfig()));
    assert.equal(network.httpRequests, before);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  test('list before connect permanently closes the host', async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t);
    const code = await expectBlocked(host, () => host.list());
    assert.equal(network.httpRequests, 0);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  test('one completed list cannot be repeated or followed by reconnect', async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t);
    await host.connect(syntheticConfig());
    await host.list();
    const before = network.httpRequests;
    const code = await expectBlocked(host, () => host.list());
    assert.equal(network.httpRequests, before);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  for (const operation of ['disconnect', 'close']) test(`${operation} disposes a live session and prevents reuse`, async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t);
    await host.connect(syntheticConfig());
    const before = network.httpRequests;
    if (operation === 'disconnect') await host.disconnect();
    else assert.equal(typeof host.close()?.then, 'undefined');
    assert.equal(host.state().connected, false);
    assert(network.sockets.every(socket => socket.destroyed));
    const code = await expectBlocked(host, () => host.connect(syntheticConfig()));
    assert.equal(network.httpRequests, before);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  test('concurrent entry attempts close an in-flight TLS gate before HTTP release', async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t);
    const results = await Promise.allSettled([host.connect(syntheticConfig()), host.list()]);
    assert(results.every(result => result.status === 'rejected'));
    assert.equal(host.state().readonly.blocked, true);
    const code = host.state().readonly.errorCode;
    assert.match(code, safeCode);
    assert.equal(network.httpRequests, 0);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  for (const stage of ['connect', 'list']) for (const operation of ['close', 'disconnect']) {
    test(`${operation} promptly cancels a pending ${stage}, rejects late state changes and zeroes the late SDK body`, async t => {
      const builtinHttpsRequest = https.request;
      const originalConcat = Buffer.concat;
      const gate = deferred();
      const response = deferred();
      const responses = createSyntheticResponseMap();
      const target = stage === 'connect' ? paths.device : paths.people;
      let targetRequest;
      let targetDestroy;
      let lateResponse;
      const lateBuffers = [];
      const network = installFakeTransport(t, {
        responses,
        onRequest: request => {
          if (request.path !== target) return undefined;
          const entry = responses.get(`${request.method} ${request.path}`);
          lateResponse = typeof entry === 'function' ? entry(request) : entry;
          gate.resolve();
          return response.promise;
        },
      });
      const fakeRequest = https.request;
      https.request = (options, callback) => {
        const request = fakeRequest(options, callback);
        if (options.path === target) {
          targetRequest = request;
          targetDestroy = request.destroy;
          // Model a transport that ignores cancellation until its response
          // arrives. This makes prompt settlement depend on the host's own
          // cancellation race, rather than the fixture's ECONNRESET event.
          request.destroy = () => request;
        }
        return request;
      };
      t.after(() => { https.request = builtinHttpsRequest; Buffer.concat = originalConcat; });
      const host = hostFor(t);
      let outcome;
      try {
        if (stage === 'list') await host.connect(syntheticConfig());
        const pending = stage === 'connect' ? host.connect(syntheticConfig()) : host.list();
        outcome = pending.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
        await promptly(gate.promise);
        assert(targetRequest);
        const before = { http: network.httpRequests, https: network.httpsCalls, tls: network.tlsConnections };
        if (operation === 'disconnect') await host.disconnect();
        else assert.equal(typeof host.close()?.then, 'undefined');
        const settled = await promptly(outcome);
        assert.equal(settled.status, 'rejected');
        assert.equal(settled.reason.code, 'READONLY_CLOSED');
        assert.equal(host.state().readonly.errorCode, 'READONLY_CLOSED');
        assert.equal(host.state().connected, false);
        assert.equal(host.state().busy, false);
        assert(network.sockets.every(socket => socket.destroyed));

        // Observe the body that the real SDK builds after cancellation. The
        // fixture owns its source response; the host owns and must wipe the
        // Buffer.concat result passed back by HikvisionClient.
        Buffer.concat = (chunks, length) => {
          const result = originalConcat.call(Buffer, chunks, length);
          if (result.equals(lateResponse.body)) lateBuffers.push(result);
          return result;
        };
        response.resolve(lateResponse);
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        assert(lateBuffers.length > 0, 'The delayed synthetic response must traverse the real SDK');
        assert(lateBuffers.every(buffer => buffer.every(byte => byte === 0)), 'The abandoned SDK response body was not zeroed');
        assert.equal(host.state().readonly.errorCode, 'READONLY_CLOSED');
        assert(!['READY', 'COMPLETE'].includes(host.state().readonly.status));
        assert.equal(host.state().connected, false);
        assert.deepEqual({ http: network.httpRequests, https: network.httpsCalls, tls: network.tlsConnections }, before);
        await assertNoRequestsAfterBlock(host, network, 'READONLY_CLOSED');
      } finally {
        // Release even on assertion failure so the real SDK clears its timer.
        if (lateResponse) response.resolve(lateResponse);
        if (targetRequest && targetDestroy) {
          targetRequest.destroy = targetDestroy;
          if (!targetRequest.completed) targetRequest.destroy();
        }
        host.close();
        https.request = fakeRequest;
        Buffer.concat = originalConcat;
        if (outcome) await outcome;
      }
    });
  }

  for (const [label, options, expectedCode, httpCount] of [
    ['TLS transport error', { tlsMode: 'error' }, 'HIKVISION_TRANSPORT', 0],
    ['TLS handshake timeout', { tlsMode: 'timeout' }, 'HIKVISION_TIMEOUT', 0],
    ['HTTPS transport error', { onRequest: () => ({ type: 'error' }) }, 'HIKVISION_TRANSPORT', 1],
    ['HTTPS response watchdog timeout', { onRequest: () => ({ type: 'timeout' }) }, 'READONLY_REQUEST_TIMEOUT', 1],
    ['HTTP redirect', { onRequest: () => textReply('synthetic redirect', 302, { location: 'https://must-never-follow.invalid/' }) }, 'HIKVISION_REDIRECT', 1],
    ['unsupported Digest challenge', { onRequest: () => textReply('synthetic auth', 401, { 'www-authenticate': 'Basic realm="synthetic"' }) }, 'HIKVISION_AUTH_CHALLENGE', 1],
  ]) test(`${label} from the real SDK latches and prevents every later request`, async t => {
    const network = installFakeTransport(t, options);
    const host = hostFor(t, { requestTimeoutMs: 25 });
    const code = await expectBlocked(host, () => host.connect(syntheticConfig()), expectedCode);
    assert.equal(network.httpRequests, httpCount);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  test('malformed describe JSON latches after the bounded reads and cannot be retried', async t => {
    const responses = createSyntheticResponseMap();
    responses.set(`GET ${paths.userCapabilities}`, textReply('{"UserInfo":', 200, { 'content-type': 'application/json' }));
    const network = installFakeTransport(t, { responses });
    const host = hostFor(t);
    const code = await expectBlocked(host, () => host.connect(syntheticConfig()));
    assert.equal(network.httpRequests, 2);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  test('malformed list JSON latches and stops before face reads', async t => {
    const responses = createSyntheticResponseMap();
    responses.set(`POST ${paths.people}`, textReply('{synthetic-invalid-json'));
    const network = installFakeTransport(t, { responses });
    const host = hostFor(t);
    await host.connect(syntheticConfig());
    const before = network.httpRequests;
    const code = await expectBlocked(host, () => host.list());
    assert.equal(network.httpRequests, before + 1);
    assert.equal(network.requests.filter(request => request.path === paths.faces).length, 0);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  test('an error during a management face read cannot be swallowed into further network requests', async t => {
    const responses = createSyntheticResponseMap();
    responses.set(`POST ${paths.faces}`, { type: 'error' });
    const network = installFakeTransport(t, { responses });
    const host = hostFor(t);
    await host.connect(syntheticConfig());
    const before = network.httpRequests;
    const code = await expectBlocked(host, () => host.list(), 'HIKVISION_TRANSPORT');
    // Two person pages plus the first face read; the service may attempt further
    // reads internally, but the fail-closed wrapper must stop all of them.
    assert.equal(network.httpRequests, before + 3);
    assert.equal(network.requests.filter(request => request.path === paths.faces).length, 1);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  test('malformed management face JSON is latched even if the enrollment service would tolerate an unknown face', async t => {
    const responses = createSyntheticResponseMap();
    responses.set(`POST ${paths.faces}`, textReply('synthetic invalid face JSON'));
    const network = installFakeTransport(t, { responses });
    const host = hostFor(t);
    await host.connect(syntheticConfig());
    const code = await expectBlocked(host, () => host.list());
    assert.equal(network.requests.filter(request => request.path === paths.faces).length, 1);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  test('device model mismatch closes the underlying transport before listing', async t => {
    const network = installFakeTransport(t, { responses: createSyntheticResponseMap({ model: 'SYNTHETIC_OTHER_MODEL' }) });
    const host = hostFor(t);
    const code = await expectBlocked(host, () => host.connect(syntheticConfig()));
    assert.equal(network.requests.filter(request => request.path === paths.people).length, 0);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  test('an incomplete all-day plan is rejected without returning a usable session', async t => {
    const responses = createSyntheticResponseMap();
    responses.set(`GET ${paths.week}`, jsonReply({ UserRightWeekPlanCfg: { enable: true, WeekPlanCfg: [] } }));
    const network = installFakeTransport(t, { responses });
    const host = hostFor(t);
    const code = await expectBlocked(host, () => host.connect(syntheticConfig()));
    assert.equal(network.requests.filter(request => request.path === paths.people).length, 0);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  test('the logical request budget fails closed before the next physical request', async t => {
    const network = installFakeTransport(t);
    const host = hostFor(t, { maxRequests: 1 });
    const code = await expectBlocked(host, () => host.connect(syntheticConfig()));
    assert.equal(network.httpRequests, 1);
    assert.equal(network.tlsConnections, 1);
    await assertNoRequestsAfterBlock(host, network, code);
  });

  test('the total session deadline disposes a stalled real SDK request', async t => {
    const network = installFakeTransport(t, { onRequest: () => ({ type: 'timeout' }) });
    const host = hostFor(t, { totalTimeoutMs: 15, requestTimeoutMs: 5000 });
    const code = await expectBlocked(host, () => host.connect(syntheticConfig()));
    assert(['READONLY_SESSION_TIMEOUT', 'READONLY_REQUEST_TIMEOUT'].includes(code));
    assert.equal(network.httpRequests, 1);
    await assertNoRequestsAfterBlock(host, network, code);
  });
});
