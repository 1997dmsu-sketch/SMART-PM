import https from 'node:https';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { X509Certificate } from 'node:crypto';
import { SYNTHETIC_CERT } from './hikvision-synthetic-certificates.mjs';

// This fixture never opens a socket, resolves a hostname, or reads device files.
// Only the bottom TLS/HTTPS transport is replaced: the SDK's PinnedAgent,
// certificate parsing, SPKI hashing, comparison and Digest implementation run.
export const SYNTHETIC_ORIGIN = 'https://readonly-synthetic.invalid:8443';
export const SYNTHETIC_USERNAME = 'SYNTHETIC_READONLY_USERNAME';
export const SYNTHETIC_PASSWORD = 'SYNTHETIC_READONLY_PASSWORD';
export const SYNTHETIC_LIBRARIES = [
  { FDID: '1', faceLibType: 'blackFD' },
  { FDID: '2', faceLibType: 'infraredFD' },
];
export const SYNTHETIC_PATHS = {
  device: '/ISAPI/System/deviceInfo',
  userCapabilities: '/ISAPI/AccessControl/UserInfo/capabilities?format=json',
  faceCapabilities: '/ISAPI/Intelligent/FDLib/capabilities?format=json',
  libraries: '/ISAPI/Intelligent/FDLib?format=json',
  doorCapabilities: '/ISAPI/AccessControl/RemoteControl/door/capabilities',
  templateCapabilities: '/ISAPI/AccessControl/UserRightPlanTemplate/capabilities?format=json',
  template: '/ISAPI/AccessControl/UserRightPlanTemplate/1?format=json',
  week: '/ISAPI/AccessControl/UserRightWeekPlanCfg/1?format=json',
  holidayGroup: '/ISAPI/AccessControl/UserRightHolidayGroupCfg/32?format=json',
  holiday: '/ISAPI/AccessControl/UserRightHolidayPlanCfg/128?format=json',
  people: '/ISAPI/AccessControl/UserInfo/Search?format=json',
  faces: '/ISAPI/Intelligent/FDLib/FDSearch?format=json',
};

export function syntheticConfig(overrides = {}) {
  return {
    mode: 'device', origin: SYNTHETIC_ORIGIN,
    username: SYNTHETIC_USERNAME, password: SYNTHETIC_PASSWORD,
    certificate: Buffer.from(SYNTHETIC_CERT), developmentTls: true,
    ...overrides,
  };
}

export function syntheticPeople() {
  return ['EMP1', 'EMP2'].map((employeeNo, index) => ({
    employeeNo, name: index ? '另一合成人员' : '合成人员',
    doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
    Valid: { enable: false, beginTime: '1970-01-01T00:00:00', endTime: '1970-01-01T00:00:00' },
    password: 'SYNTHETIC_PERSON_PASSWORD', cardNo: 'SYNTHETIC_CARD_NUMBER',
    faceURL: 'https://synthetic-private.invalid/person.jpg',
    modelData: 'SYNTHETIC_PERSON_MODEL_DATA', numOfFace: 2,
  }));
}

export const jsonReply = (value, status = 200, headers = {}) => ({
  status, headers: { 'content-type': 'application/json', ...headers },
  body: Buffer.from(JSON.stringify(value)),
});
export const textReply = (value, status = 200, headers = {}) => ({
  status, headers, body: Buffer.from(value),
});

// Keys are exact "METHOD /path?query" strings. Entries may be a response or a
// function receiving the synthetic request (including parsed request.json).
// The map includes a complete seven-day plan and its referenced holiday plan.
export function createSyntheticResponseMap({ people = syntheticPeople(), model = 'DS-K1T671BM' } = {}) {
  const paths = SYNTHETIC_PATHS;
  const fullSlot = extra => ({
    id: 1, enable: true, authenticationTimesEnabled: false,
    TimeSegment: { beginTime: '00:00:00', endTime: '23:59:59' }, ...extra,
  });
  return new Map([
    [`GET ${paths.device}`, textReply(`<DeviceInfo><model>${model}</model><firmwareVersion>V3.3.180</firmwareVersion></DeviceInfo>`, 200, { 'content-type': 'application/xml' })],
    [`GET ${paths.userCapabilities}`, jsonReply({ UserInfo: {
      supportFunction: { '@opt': 'get,post,put' },
      employeeNo: { '@max': 32 }, name: { '@max': 128 },
      RightPlan: { doorNo: { '@min': 1, '@max': 1 } },
      UserInfoSearchCond: { maxResults: { '@max': 1 }, isSupportNumOfFace: true },
      Valid: { enable: { '@opt': 'true,false' }, timeType: { '@opt': 'local' }, timeRangeBegin: '1970-01-01T00:00:00', timeRangeEnd: '2037-12-31T23:59:59' },
      userType: { '@opt': 'normal' },
    } })],
    [`GET ${paths.faceCapabilities}`, jsonReply({ FDLibCap: { supportFDFunction: { '@opt': 'get,setUp' }, isSupportFDSearch: true } })],
    [`GET ${paths.libraries}`, jsonReply({ FDLib: structuredClone(SYNTHETIC_LIBRARIES) })],
    [`GET ${paths.doorCapabilities}`, textReply('<RemoteControlDoor><doorNo min="1" max="1"/></RemoteControlDoor>')],
    [`GET ${paths.templateCapabilities}`, jsonReply({ UserRightPlanTemplate: { templateNo: { '@min': 1, '@max': 128 } } })],
    [`GET ${paths.template}`, jsonReply({ UserRightPlanTemplate: { enable: true, templateName: '合成全天模板', weekPlanNo: 1, holidayGroupNo: '32' } })],
    [`GET ${paths.week}`, jsonReply({ UserRightWeekPlanCfg: { enable: true, WeekPlanCfg: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(week => fullSlot({ week })) } })],
    [`GET ${paths.holidayGroup}`, jsonReply({ UserRightHolidayGroupCfg: { enable: true, groupName: '合成假日组', holidayPlanNo: '128' } })],
    [`GET ${paths.holiday}`, jsonReply({ UserRightHolidayPlanCfg: { enable: true, beginDate: '2000-01-01', endDate: '2000-01-01', HolidayPlanCfg: [fullSlot()] } })],
    [`POST ${paths.people}`, request => {
      const condition = request.json.UserInfoSearchCond;
      const selected = people.filter(row => !condition.EmployeeNoList || condition.EmployeeNoList.some(filter => filter.employeeNo === row.employeeNo));
      const rows = selected.slice(condition.searchResultPosition, condition.searchResultPosition + condition.maxResults);
      return jsonReply({ UserInfoSearch: {
        totalMatches: selected.length, numOfMatches: rows.length,
        responseStatusStrg: !selected.length ? 'NO MATCH' : condition.searchResultPosition + rows.length < selected.length ? 'MORE' : 'OK',
        UserInfo: structuredClone(rows),
      } });
    }],
    [`POST ${paths.faces}`, request => jsonReply({
      totalMatches: 1, numOfMatches: 1, responseStatusStrg: 'OK',
      MatchList: [{ FPID: request.json.FPID, isInLibrary: 'yes',
        faceURL: 'https://synthetic-private.invalid/face.jpg', modelData: 'SYNTHETIC_FACE_MODEL_DATA' }],
    })],
  ]);
}

export function installFakeTransport(t, {
  peerCertificate = SYNTHETIC_CERT,
  tlsMode = 'secure',
  responses = createSyntheticResponseMap(),
  onRequest,
} = {}) {
  const originalTlsConnect = tls.connect;
  const originalHttpsRequest = https.request;
  const requests = [];
  const tlsCalls = [];
  const sockets = [];
  const pending = new Set();
  let httpsCalls = 0;
  let earlyHttpRequests = 0;
  let restored = false;

  class FakeTlsSocket extends EventEmitter {
    destroyed = false;
    secureConnecting = true;
    timeout = 0;
    setTimeout(milliseconds, callback) {
      this.timeout = milliseconds;
      this.timeoutCallback = callback;
      if (milliseconds && tlsMode === 'timeout') queueMicrotask(() => {
        if (!this.destroyed && this.timeout) this.timeoutCallback?.();
      });
      return this;
    }
    getPeerCertificate() {
      return peerCertificate == null ? {} : { raw: new X509Certificate(peerCertificate).raw };
    }
    destroy(error) {
      if (this.destroyed) return this;
      this.destroyed = true;
      this.timeout = 0;
      queueMicrotask(() => {
        if (error) this.emit('error', error);
        this.emit('close');
      });
      return this;
    }
  }

  tls.connect = options => {
    const socket = new FakeTlsSocket();
    tlsCalls.push({ ...options });
    sockets.push(socket);
    queueMicrotask(() => {
      if (socket.destroyed || tlsMode === 'timeout') return;
      if (tlsMode === 'error') socket.emit('error', new Error('Synthetic TLS transport failure'));
      else {
        socket.secureConnecting = false;
        socket.emit('secureConnect');
      }
    });
    return socket;
  };

  https.request = (options, onResponse) => {
    httpsCalls += 1;
    const request = new EventEmitter();
    request.destroyed = false;
    request.ended = false;
    request.completed = false;
    let released = false;
    let dispatched = false;
    let errorEmitted = false;
    let body = Buffer.alloc(0);
    pending.add(request);
    const fail = error => {
      if (errorEmitted) return;
      errorEmitted = true;
      request.emit('error', error);
    };
    const pump = () => {
      if (dispatched || !released || !request.ended || request.destroyed || request.socket.destroyed) return;
      dispatched = true;
      if (request.socket.secureConnecting) earlyHttpRequests += 1;
      let json;
      try { json = JSON.parse(body.toString('utf8')); } catch { /* GET and harness controls have no JSON. */ }
      const entry = { method: options.method ?? 'GET', path: options.path, headers: { ...options.headers }, body: Buffer.from(body), json };
      requests.push(entry);
      queueMicrotask(async () => {
        if (request.destroyed) return;
        try {
          let response = onRequest?.(entry, requests.length);
          if (response === undefined) response = responses.get(`${entry.method} ${entry.path}`);
          if (typeof response === 'function') response = response(entry);
          response = await response;
          if (!response) throw new Error('Unexpected synthetic endpoint');
          if (response.type === 'timeout') return; // SDK's real request deadline expires.
          if (response.type === 'error') {
            fail(new Error('Synthetic HTTPS transport failure'));
            return;
          }
          if (request.destroyed) return;
          const incoming = Readable.from([Buffer.from(response.body ?? '')]);
          incoming.statusCode = response.status ?? 200;
          incoming.headers = { ...(response.headers ?? {}) };
          request.response = incoming;
          incoming.once('end', () => { request.completed = true; pending.delete(request); });
          onResponse(incoming);
        } catch (error) {
          if (!request.destroyed) fail(error);
        }
      });
    };
    request.end = value => {
      if (value !== undefined) body = Buffer.concat([body, Buffer.from(value)]);
      request.ended = true;
      pump();
      return request;
    };
    request.write = value => { body = Buffer.concat([body, Buffer.from(value)]); return true; };
    request.destroy = error => {
      if (request.destroyed) return request;
      request.destroyed = true;
      request.response?.destroy();
      request.socket?.destroy();
      pending.delete(request);
      const failure = error ?? (!request.completed && !errorEmitted
        ? Object.assign(new Error('Synthetic request was closed'), { code: 'ECONNRESET' }) : undefined);
      queueMicrotask(() => { if (failure) fail(failure); request.emit('close'); });
      return request;
    };
    const release = (error, socket) => {
      if (released || request.destroyed) return;
      if (error) {
        queueMicrotask(() => { if (!request.destroyed) fail(error); });
        return;
      }
      released = true;
      request.socket = socket;
      pump();
    };
    try {
      const returnedSocket = options.agent.createConnection({ timeout: options.timeout }, release);
      // Node's Agent also accepts a synchronously returned socket. Releasing it
      // immediately makes a regressed pin-before-send implementation observable:
      // .end() transmits before the queued secureConnect/pin-verification event.
      if (returnedSocket) release(null, returnedSocket);
    } catch (error) {
      queueMicrotask(() => { if (!request.destroyed) fail(error); });
    }
    return request;
  };

  const restore = () => {
    if (restored) return;
    restored = true;
    for (const request of pending) request.destroy();
    for (const socket of sockets) socket.destroy();
    tls.connect = originalTlsConnect;
    https.request = originalHttpsRequest;
  };
  t.after(restore);
  return {
    requests, tlsCalls, sockets, responses, restore,
    get tlsConnections() { return tlsCalls.length; },
    get httpRequests() { return requests.length; },
    get httpsCalls() { return httpsCalls; },
    get earlyHttpRequests() { return earlyHttpRequests; },
  };
}
