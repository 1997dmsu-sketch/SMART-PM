import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { HikvisionClient } from '../lib/hikvision-client.mjs';
import { SYNTHETIC_KEY, SYNTHETIC_CERT, SYNTHETIC_RENEWED_CERT, SYNTHETIC_OTHER_CERT } from './fixtures/hikvision-synthetic-certificates.mjs';

const username = 'test-admin';
const password = 'test-only-password-not-a-device-secret';
const realm = 'synthetic-realm';
const nonce = 'synthetic-nonce';
const image = Buffer.from([0xff, 0xd8, 0x00, 0x0d, 0x0a, 0x80, 0xfe, 0xff, 0xd9]);

async function localServer(t, handler, cert = SYNTHETIC_CERT) {
  const requests = [];
  const applicationBytes = [];
  const server = https.createServer({ key: SYNTHETIC_KEY, cert }, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ method: request.method, path: request.url, headers: request.headers, body: Buffer.concat(chunks) });
    handler(requests.at(-1), response, requests.length);
  });
  server.on('secureConnection', socket => socket.on('data', chunk => applicationBytes.push(chunk)));
  server.on('tlsClientError', () => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return { origin: `https://127.0.0.1:${server.address().port}`, requests, applicationBytes, server };
}

function client(t, origin, overrides = {}) {
  const instance = new HikvisionClient({ origin, username, password, certificate: Buffer.from(SYNTHETIC_CERT), developmentTls: true, ...overrides });
  t.after(() => instance.close());
  return instance;
}

function parseAuthorization(value) {
  assert.match(value, /^Digest /);
  const values = {};
  for (const match of value.slice(7).matchAll(/([\w-]+)=(?:"((?:\\.|[^"])*)"|([^,\s]+))/g)) values[match[1]] = match[2] === undefined ? match[3] : match[2].replace(/\\(.)/g, '$1');
  return values;
}

for (const algorithm of ['MD5', 'SHA-256', 'MD5-sess', 'SHA-256-sess']) {
  test(`${algorithm}: Digest retries once and preserves multipart bytes`, async t => {
    const path = '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json';
    const boundary = 'synthetic-boundary';
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="img"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), image, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const { origin, requests } = await localServer(t, (request, response, count) => {
      if (count === 1) {
        response.writeHead(401, { 'WWW-Authenticate': `Digest realm="${realm}", nonce="${nonce}", qop="auth-int, auth", algorithm=${algorithm}, opaque="test-opaque"` });
        response.end('authenticate');
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json', 'X-Test': 'response' });
        response.end('{"ok":true}');
      }
    });
    const result = await client(t, origin).request({ method: 'post', path, body, contentType: `multipart/form-data; boundary=${boundary}` });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, Buffer.from('{"ok":true}'));
    assert.equal(Object.getPrototypeOf(result.headers), Object.prototype);
    assert.equal(result.headers['x-test'], 'response');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].headers.authorization, undefined);
    for (const request of requests) {
      assert.equal(request.path, path);
      assert.equal(request.method, 'POST');
      assert.deepEqual(request.body, body);
      assert.equal(request.headers['content-length'], String(body.length));
      assert.equal(request.headers['content-type'], `multipart/form-data; boundary=${boundary}`);
    }
    const auth = parseAuthorization(requests[1].headers.authorization);
    assert.equal(auth.username, username);
    assert.equal(auth.realm, realm);
    assert.equal(auth.nonce, nonce);
    assert.equal(auth.uri, path);
    assert.equal(auth.algorithm, algorithm);
    assert.equal(auth.qop, 'auth');
    assert.equal(auth.nc, '00000001');
    assert.equal(auth.opaque, 'test-opaque');
    const hash = value => createHash(algorithm.startsWith('SHA-256') ? 'sha256' : 'md5').update(value).digest('hex');
    let ha1 = hash(`${username}:${realm}:${password}`);
    if (algorithm.endsWith('-sess')) ha1 = hash(`${ha1}:${nonce}:${auth.cnonce}`);
    assert.equal(auth.response, hash(`${ha1}:${nonce}:${auth.nc}:${auth.cnonce}:auth:${hash(`POST:${path}`)}`));
  });
}

test('legacy Digest without qop and mixed Basic challenge are supported', async t => {
  const { origin, requests } = await localServer(t, (request, response, count) => {
    response.writeHead(count === 1 ? 401 : 200, count === 1 ? { 'WWW-Authenticate': `Basic realm="other", Digest realm="${realm}", nonce="${nonce}"` } : {});
    response.end();
  });
  assert.equal((await client(t, origin).request({ method: 'GET', path: '/legacy' })).status, 200);
  const auth = parseAuthorization(requests[1].headers.authorization);
  assert.equal(auth.qop, undefined);
  assert.equal(auth.cnonce, undefined);
  const hash = value => createHash('md5').update(value).digest('hex');
  assert.equal(auth.response, hash(`${hash(`${username}:${realm}:${password}`)}:${nonce}:${hash('GET:/legacy')}`));
});

test('a second 401 is returned without any third attempt', async t => {
  const { origin, requests } = await localServer(t, (_request, response) => {
    response.writeHead(401, { 'WWW-Authenticate': `Digest realm="${realm}", nonce="${nonce}", qop="auth"` });
    response.end('denied');
  });
  assert.equal((await client(t, origin).request({ method: 'GET', path: '/' })).status, 401);
  assert.equal(requests.length, 2);
});

test('unsupported qop, algorithms, and malformed challenges never send authenticated bytes', async t => {
  for (const challenge of [
    `Digest realm="${realm}", nonce="${nonce}", qop="auth-int"`,
    `Digest realm="${realm}", nonce="${nonce}", qop=""`,
    `Digest realm="${realm}", nonce="${nonce}", algorithm=SHA-512`,
    `Digest realm="${realm}", nonce="${nonce}", qop auth-int`,
    `Digest realm="${realm}", nonce="${nonce}", nonce="duplicate"`,
    `Digest realm="${realm}", nonce="${nonce}`, 'Basic realm="only-basic"',
  ]) {
    const { origin, requests } = await localServer(t, (_request, response) => {
      response.writeHead(401, { 'WWW-Authenticate': challenge });
      response.end();
    });
    await assert.rejects(client(t, origin).request({ method: 'POST', path: '/upload', body: image }), error => {
      assert.equal(error.code, 'HIKVISION_AUTH_CHALLENGE');
      for (const secret of [password, realm, nonce, image.toString('hex'), 'Authorization']) assert.ok(!error.message.includes(secret));
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.authorization, undefined);
  }
});

test('mismatched pin prevents all HTTP bytes even in development TLS mode', async t => {
  const { origin, requests, applicationBytes } = await localServer(t, (_request, response) => response.end('must not happen'));
  await assert.rejects(client(t, origin, { certificate: Buffer.from(SYNTHETIC_OTHER_CERT) }).request({ method: 'POST', path: '/upload', body: image }), { code: 'HIKVISION_TLS_PIN' });
  assert.equal(requests.length, 0);
  assert.equal(Buffer.concat(applicationBytes).length, 0);
});

test('missing or malformed certificate pins fail before connecting', async t => {
  const { origin, requests, server } = await localServer(t, (_request, response) => response.end());
  let connections = 0;
  server.on('connection', () => connections += 1);
  for (const options of [{}, { certificate: Buffer.alloc(0) }, { certificate: Buffer.from('not a certificate') }, { certificateBase64: '***' }, { certificate: Buffer.from(SYNTHETIC_CERT), certificateBase64: 'AAAA' }]) {
    assert.throws(() => new HikvisionClient({ origin, username, password, developmentTls: true, ...options }), { code: 'HIKVISION_CONFIGURATION' });
  }
  assert.equal(connections, 0);
  assert.equal(requests.length, 0);
});

test('strict TLS is the default and rejects an untrusted self-signed certificate before HTTP', async t => {
  const { origin, requests, applicationBytes } = await localServer(t, (_request, response) => response.end());
  const instance = new HikvisionClient({ origin, username, password, certificate: Buffer.from(SYNTHETIC_CERT) });
  t.after(() => instance.close());
  await assert.rejects(instance.request({ method: 'GET', path: '/' }), { code: 'HIKVISION_TRANSPORT' });
  assert.equal(requests.length, 0);
  assert.equal(Buffer.concat(applicationBytes).length, 0);
});

test('pin matches the public key across certificate renewal and accepts base64 DER', async t => {
  const { X509Certificate } = await import('node:crypto');
  const { origin } = await localServer(t, (_request, response) => response.end('renewed'), SYNTHETIC_RENEWED_CERT);
  const instance = client(t, origin, { certificate: undefined, certificateBase64: new X509Certificate(SYNTHETIC_CERT).raw.toString('base64') });
  assert.equal((await instance.request({ method: 'GET', path: '/' })).body.toString(), 'renewed');
});

test('redirects are rejected without following Location or sending credentials to its destination', async t => {
  const target = await localServer(t, (_request, response) => response.end('must not happen'));
  const { origin, requests } = await localServer(t, (_request, response, count) => {
    if (count === 1) {
      response.writeHead(401, { 'WWW-Authenticate': `Digest realm="${realm}", nonce="${nonce}", qop="auth"` });
    } else response.writeHead(302, { Location: `${target.origin}/stolen` });
    response.end();
  });
  await assert.rejects(client(t, origin).request({ method: 'POST', path: '/upload', body: image }), { code: 'HIKVISION_REDIRECT' });
  assert.equal(requests.length, 2);
  assert.equal(target.requests.length, 0);
});

test('absolute, cross-origin, fragment, backslash, whitespace and invalid bodies are rejected locally', async t => {
  const { origin, requests } = await localServer(t, (_request, response) => response.end());
  const instance = client(t, origin);
  for (const path of ['https://example.com/upload', '//example.com/upload', '/\\example.com', '/a#fragment', '/a\r\nHeader: test', '/has space']) {
    await assert.rejects(instance.request({ method: 'POST', path, body: image }), { code: 'HIKVISION_REQUEST' });
  }
  await assert.rejects(instance.request({ method: 'GET', path: '/', body: {} }), { code: 'HIKVISION_REQUEST' });
  await assert.rejects(instance.request({ method: 'GET', path: '/', contentType: 'text/plain\r\nInjected: yes' }), { code: 'HIKVISION_REQUEST' });
  assert.equal(requests.length, 0);
});

test('configuration fields are private and invalid options are rejected', () => {
  const valid = { origin: 'https://127.0.0.1:443', username, password, certificate: Buffer.from(SYNTHETIC_CERT) };
  for (const override of [
    { origin: 'http://127.0.0.1' }, { origin: 'https://user:pass@127.0.0.1' }, { origin: 'https://127.0.0.1/path' },
    { timeoutMs: 0 }, { timeoutMs: 1.5 }, { timeoutMs: 2147483648 }, { maxResponseBytes: 0 },
    { developmentTls: 'true' }, { username: 'a:b' }, { password: 123 },
  ]) assert.throws(() => new HikvisionClient({ ...valid, ...override }), { code: 'HIKVISION_CONFIGURATION' });
  const instance = new HikvisionClient(valid);
  assert.equal(JSON.stringify(instance), '{}');
  assert.deepEqual(Object.keys(instance), []);
  instance.close();
  instance.close();
});

test('response size limit accepts its boundary and rejects larger streaming responses', async t => {
  const { origin } = await localServer(t, (request, response) => {
    response.writeHead(200);
    response.write('1234');
    response.end(request.path === '/large' ? '56' : '5');
  });
  const instance = client(t, origin, { maxResponseBytes: 5 });
  assert.equal((await instance.request({ method: 'GET', path: '/boundary' })).body.toString(), '12345');
  await assert.rejects(instance.request({ method: 'GET', path: '/large' }), { code: 'HIKVISION_RESPONSE_SIZE' });
});

test('total timeout bounds a stalled response', async t => {
  const { origin, requests } = await localServer(t, () => {});
  await assert.rejects(client(t, origin, { timeoutMs: 100 }).request({ method: 'GET', path: '/' }), { code: 'HIKVISION_TIMEOUT' });
  assert.equal(requests.length, 1);
});

test('timeout also closes a stalled TLS handshake before sending HTTP', async t => {
  const sockets = new Set();
  const received = [];
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('data', chunk => received.push(chunk));
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    for (const socket of sockets) socket.destroy();
    server.close(resolve);
  }));
  const origin = `https://127.0.0.1:${server.address().port}`;
  await assert.rejects(client(t, origin, { timeoutMs: 100 }).request({ method: 'POST', path: '/secret-path', body: image }), { code: 'HIKVISION_TIMEOUT' });
  assert.ok(received.length > 0, 'server received a TLS ClientHello');
  assert.ok(!Buffer.concat(received).includes(Buffer.from('/secret-path')));
  assert.ok(!Buffer.concat(received).includes(image));
});

test('close aborts active work, clears public state, and prevents further requests', async t => {
  let observed;
  const requestObserved = new Promise(resolve => observed = resolve);
  const { origin, requests } = await localServer(t, () => observed());
  const instance = client(t, origin);
  const pending = instance.request({ method: 'POST', path: '/upload', body: image });
  const rejected = assert.rejects(pending, { code: 'HIKVISION_TRANSPORT' });
  await requestObserved;
  instance.close();
  await rejected;
  await assert.rejects(instance.request({ method: 'GET', path: '/' }), { code: 'HIKVISION_CLOSED' });
  assert.equal(requests.length, 1);
  assert.deepEqual(Object.keys(instance), []);
});
