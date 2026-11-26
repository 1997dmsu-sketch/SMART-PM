import https from 'node:https';
import tls from 'node:tls';
import { isIP } from 'node:net';
import { createHash, randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+/;

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function configurationError() {
  return failure('HIKVISION_CONFIGURATION', 'Invalid Hikvision client configuration.');
}

function transportError() {
  return failure('HIKVISION_TRANSPORT', 'Hikvision connection failed.');
}

function challengeError() {
  return failure('HIKVISION_AUTH_CHALLENGE', 'Unsupported Hikvision authentication challenge.');
}

function certificatePin(certificate) {
  return createHash('sha256').update(new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' })).digest();
}

// The socket is deliberately returned ONLY through the callback after TLS and
// pin verification. Returning it here would let ClientRequest write too early.
class PinnedAgent extends https.Agent {
  #hostname;
  #port;
  #pin;
  #developmentTls;
  #absoluteDeadline;
  #sockets = new Set();
  #closed = false;

  constructor({ hostname, port, pin, developmentTls, absoluteDeadline }) {
    super({ keepAlive: false, maxSockets: 1 });
    this.#hostname = hostname;
    this.#port = port;
    this.#pin = pin;
    this.#developmentTls = developmentTls;
    this.#absoluteDeadline = absoluteDeadline;
  }

  createConnection(_options, callback) {
    let completed = false;
    let socket;
    const finish = (error) => {
      if (completed) return;
      // Relative timers can run late while the event loop is occupied. Even a
      // correctly pinned socket must not release queued HTTP bytes after this
      // task's absolute authorization deadline.
      if (!error && this.#absoluteDeadline !== undefined && Date.now() >= this.#absoluteDeadline) {
        error = failure('HIKVISION_TIMEOUT', 'Hikvision request timed out.');
      }
      completed = true;
      if (error) {
        socket?.destroy();
        callback(error);
      } else {
        callback(null, socket);
      }
    };
    if (this.#closed) {
      finish(transportError());
      return;
    }
    if (this.#absoluteDeadline !== undefined && Date.now() >= this.#absoluteDeadline) {
      finish(failure('HIKVISION_TIMEOUT', 'Hikvision request timed out.'));
      return;
    }
    try {
      socket = tls.connect({
        host: this.#hostname,
        port: this.#port,
        servername: isIP(this.#hostname) ? undefined : this.#hostname,
        rejectUnauthorized: !this.#developmentTls,
        checkServerIdentity: tls.checkServerIdentity,
        ALPNProtocols: ['http/1.1'],
      });
      this.#sockets.add(socket);
      socket.once('close', () => this.#sockets.delete(socket));
      socket.once('error', () => finish(transportError()));
      socket.setTimeout(_options.timeout, () => finish(failure('HIKVISION_TIMEOUT', 'Hikvision request timed out.')));
      socket.once('secureConnect', () => {
        try {
          socket.setTimeout(0);
          const raw = socket.getPeerCertificate(true)?.raw;
          if (!raw || !timingSafeEqual(certificatePin(raw), this.#pin)) {
            finish(failure('HIKVISION_TLS_PIN', 'Hikvision certificate pin verification failed.'));
            return;
          }
          if (this.#closed) {
            finish(transportError());
            return;
          }
          finish();
        } catch {
          finish(failure('HIKVISION_TLS_PIN', 'Hikvision certificate pin verification failed.'));
        }
      });
    } catch {
      finish(transportError());
    }
    // Do not return socket: see the pin-before-send invariant above.
  }

  destroy() {
    this.#closed = true;
    for (const socket of this.#sockets) socket.destroy();
    super.destroy();
  }
}

function parseChallenge(header) {
  const text = Array.isArray(header) ? header.join(', ') : header;
  if (typeof text !== 'string' || /[\x00-\x1f\x7f]/.test(text)) throw challengeError();
  let start = -1;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    if (!quoted && (index === 0 || text[index - 1] === ',')) {
      const match = /^\s*Digest\s+/i.exec(text.slice(index));
      if (match) {
        start = index + match[0].length;
        break;
      }
    }
    if (escaped) escaped = false;
    else if (quoted && text[index] === '\\') escaped = true;
    else if (text[index] === '"') quoted = !quoted;
  }
  if (start < 0) throw challengeError();
  const fields = new Map();
  let index = start;
  while (index < text.length) {
    while (/\s/.test(text[index] || '') && index < text.length) index += 1;
    const keyMatch = TOKEN.exec(text.slice(index));
    if (!keyMatch) throw challengeError();
    const key = keyMatch[0].toLowerCase();
    index += keyMatch[0].length;
    while (/\s/.test(text[index] || '') && index < text.length) index += 1;
    // Never downgrade malformed qop/algorithm parameters to legacy Digest.
    if (text[index] !== '=') throw challengeError();
    index += 1;
    while (/\s/.test(text[index] || '') && index < text.length) index += 1;
    let value = '';
    if (text[index] === '"') {
      index += 1;
      let closed = false;
      while (index < text.length) {
        const character = text[index++];
        if (character === '"') {
          closed = true;
          break;
        }
        if (character === '\\') {
          if (index >= text.length) throw challengeError();
          value += text[index++];
        } else value += character;
      }
      if (!closed) throw challengeError();
    } else {
      const valueMatch = TOKEN.exec(text.slice(index));
      if (!valueMatch) throw challengeError();
      value = valueMatch[0];
      index += value.length;
    }
    if (fields.has(key)) throw challengeError();
    fields.set(key, value);
    while (/\s/.test(text[index] || '') && index < text.length) index += 1;
    if (index === text.length) break;
    if (text[index] !== ',') throw challengeError();
    index += 1;
  }
  if (!fields.has('realm') || !fields.get('nonce')) throw challengeError();
  const algorithm = (fields.get('algorithm') || 'MD5').toUpperCase();
  if (!['MD5', 'MD5-SESS', 'SHA-256', 'SHA-256-SESS'].includes(algorithm)) throw challengeError();
  const qop = fields.has('qop') ? fields.get('qop').split(',').map(value => value.trim().toLowerCase()) : undefined;
  if (qop && !qop.includes('auth')) throw challengeError();
  if (fields.get('userhash')?.toLowerCase() === 'true') throw challengeError();
  return { fields, algorithm, qop: qop ? 'auth' : undefined };
}

function authorization(challenge, username, password, method, uri) {
  const { fields, algorithm, qop } = challenge;
  const hashName = algorithm.startsWith('SHA-256') ? 'sha256' : 'md5';
  const hash = value => createHash(hashName).update(value, 'utf8').digest('hex');
  const quote = value => `"${value.replace(/["\\]/g, '\\$&')}"`;
  const nonce = fields.get('nonce');
  const realm = fields.get('realm');
  const cnonce = randomBytes(16).toString('hex');
  const nc = '00000001';
  let ha1 = hash(`${username}:${realm}:${password}`);
  if (algorithm.endsWith('-SESS')) ha1 = hash(`${ha1}:${nonce}:${cnonce}`);
  const ha2 = hash(`${method}:${uri}`);
  const response = qop ? hash(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : hash(`${ha1}:${nonce}:${ha2}`);
  const values = [
    `username=${quote(username)}`, `realm=${quote(realm)}`, `nonce=${quote(nonce)}`,
    `uri=${quote(uri)}`, `response=${quote(response)}`, `algorithm=${algorithm.replace('-SESS', '-sess')}`,
  ];
  if (fields.has('opaque')) values.push(`opaque=${quote(fields.get('opaque'))}`);
  if (qop) values.push(`qop=${qop}`, `nc=${nc}`, `cnonce=${quote(cnonce)}`);
  else if (algorithm.endsWith('-SESS')) values.push(`cnonce=${quote(cnonce)}`);
  return `Digest ${values.join(', ')}`;
}

export class HikvisionClient {
  #origin;
  #username;
  #password;
  #agent;
  #timeoutMs;
  #maxResponseBytes;
  #absoluteDeadline;
  #requests = new Set();
  #closed = false;

  constructor(config) {
    try {
      if (!config || typeof config !== 'object') throw configurationError();
      const { origin, username, password, certificate, certificateBase64, developmentTls = false, timeoutMs = 5000, maxResponseBytes = 1048576, absoluteDeadline } = config;
      if (typeof origin !== 'string' || typeof username !== 'string' || !username || /[:\x00-\x1f\x7f]/.test(username) || typeof password !== 'string' || typeof developmentTls !== 'boolean') throw configurationError();
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) throw configurationError();
      if (absoluteDeadline !== undefined && (!Number.isSafeInteger(absoluteDeadline) || absoluteDeadline <= 0)) throw configurationError();
      const parsed = new URL(origin);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw configurationError();
      if ((certificate !== undefined) === (certificateBase64 !== undefined)) throw configurationError();
      let source;
      if (certificate !== undefined) {
        if (!Buffer.isBuffer(certificate) || !certificate.length) throw configurationError();
        source = certificate;
      } else {
        if (typeof certificateBase64 !== 'string' || !certificateBase64.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(certificateBase64)) throw configurationError();
        source = Buffer.from(certificateBase64, 'base64');
      }
      const pin = certificatePin(source);
      this.#origin = parsed;
      this.#username = username;
      this.#password = password;
      this.#timeoutMs = timeoutMs;
      this.#maxResponseBytes = maxResponseBytes;
      this.#absoluteDeadline = absoluteDeadline;
      this.#agent = new PinnedAgent({ hostname: parsed.hostname.replace(/^\[|\]$/g, ''), port: Number(parsed.port || 443), pin, developmentTls, absoluteDeadline });
    } catch {
      throw configurationError();
    }
  }

  async request({ method, path, body, contentType } = {}) {
    if (this.#closed) throw failure('HIKVISION_CLOSED', 'Hikvision client is closed.');
    if (typeof method !== 'string' || !/^[A-Za-z]+$/.test(method) || typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\x00-\x20\x7f-\uffff\\#]/.test(path)) throw failure('HIKVISION_REQUEST', 'Invalid Hikvision request.');
    if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string') throw failure('HIKVISION_REQUEST', 'Invalid Hikvision request body.');
    if (contentType !== undefined && (typeof contentType !== 'string' || !contentType || /[\x00-\x1f\x7f-\uffff]/.test(contentType))) throw failure('HIKVISION_REQUEST', 'Invalid Hikvision content type.');
    const bytes = body === undefined ? undefined : Buffer.from(body);
    const verb = method.toUpperCase();
    const relativeDeadline = Date.now() + this.#timeoutMs;
    const deadline = this.#absoluteDeadline === undefined ? relativeDeadline : Math.min(relativeDeadline, this.#absoluteDeadline);
    const initial = await this.#send({ method: verb, path, body: bytes, contentType, deadline });
    if (initial.status !== 401) return initial;
    const challenge = parseChallenge(initial.headers['www-authenticate']);
    if (this.#closed) throw failure('HIKVISION_CLOSED', 'Hikvision client is closed.');
    const auth = authorization(challenge, this.#username, this.#password, verb, path);
    return this.#send({ method: verb, path, body: bytes, contentType, authorization: auth, deadline });
  }

  #send({ method, path, body, contentType, authorization: auth, deadline }) {
    return new Promise((resolve, reject) => {
      let request;
      let response;
      let timer;
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (request) this.#requests.delete(request);
        if (error) {
          response?.destroy();
          request?.destroy();
          reject(error);
        } else resolve(result);
      };
      const currentTime = Date.now();
      const remaining = deadline - currentTime;
      if (remaining <= 0 || (this.#absoluteDeadline !== undefined && currentTime >= this.#absoluteDeadline)) {
        finish(failure('HIKVISION_TIMEOUT', 'Hikvision request timed out.'));
        return;
      }
      try {
        const headers = {};
        if (body !== undefined) headers['Content-Length'] = String(body.length);
        if (contentType !== undefined) headers['Content-Type'] = contentType;
        if (auth !== undefined) headers.Authorization = auth;
        request = https.request({
          hostname: this.#origin.hostname.replace(/^\[|\]$/g, ''),
          port: this.#origin.port || 443,
          protocol: 'https:', method, path, headers, agent: this.#agent, timeout: remaining,
        }, incoming => {
          response = incoming;
          if (incoming.statusCode >= 300 && incoming.statusCode < 400) {
            finish(failure('HIKVISION_REDIRECT', 'Hikvision redirects are not permitted.'));
            return;
          }
          const chunks = [];
          let length = 0;
          incoming.on('data', chunk => {
            if (settled) return;
            length += chunk.length;
            if (length > this.#maxResponseBytes) {
              finish(failure('HIKVISION_RESPONSE_SIZE', 'Hikvision response exceeds the size limit.'));
            } else chunks.push(chunk);
          });
          incoming.once('end', () => {
            if (settled) return;
            const responseHeaders = {};
            for (const [key, value] of Object.entries(incoming.headers)) responseHeaders[key.toLowerCase()] = Array.isArray(value) ? [...value] : value;
            finish(undefined, { status: incoming.statusCode, headers: responseHeaders, body: Buffer.concat(chunks, length) });
          });
          incoming.once('aborted', () => finish(transportError()));
          incoming.once('error', () => finish(transportError()));
        });
        this.#requests.add(request);
        request.once('error', error => {
          if (error?.code === 'HIKVISION_TLS_PIN') finish(failure('HIKVISION_TLS_PIN', 'Hikvision certificate pin verification failed.'));
          else if (error?.code === 'HIKVISION_TIMEOUT') finish(failure('HIKVISION_TIMEOUT', 'Hikvision request timed out.'));
          else finish(transportError());
        });
        const writeRemaining = this.#absoluteDeadline === undefined ? remaining : Math.min(remaining, this.#absoluteDeadline - Date.now());
        if (writeRemaining <= 0) {
          finish(failure('HIKVISION_TIMEOUT', 'Hikvision request timed out.'));
          return;
        }
        timer = setTimeout(() => finish(failure('HIKVISION_TIMEOUT', 'Hikvision request timed out.')), writeRemaining);
        request.end(body);
      } catch {
        finish(transportError());
      }
    });
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#username = undefined;
    this.#password = undefined;
    for (const request of this.#requests) request.destroy();
    this.#requests.clear();
    this.#agent.destroy();
  }
}
