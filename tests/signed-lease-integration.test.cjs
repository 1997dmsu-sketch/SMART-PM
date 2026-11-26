'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const guard = require('./support/d-network-guard.cjs');
const { TenantAuthMemoryDB } = require('./support/tenant-auth-memory-db.cjs');
const { createMain: phoneMain } = require('../cloudfunctions/phoneLogin');
const { createMain: accessMain } = require('../cloudfunctions/signedLeaseAccess');
const { COLLECTIONS } = require('../cloudfunctions/signedLeaseAccess/lib/service');
const runtime = require('../miniprogram/config/runtime');
const CONTEXT = { APPID: 'synthetic-integration-app', OPENID: 'synthetic-integration-resident' };
const TOKEN = 'synthetic-integration-worker-token-0123456789';
const ADMIN = { kind: 'admin', id: 'synthetic-admin' };
const CONTRACT = 'synthetic-signed-contract';
const HOUSE = 'synthetic-residence-102';
const MODEL = 'SYNTHETIC-TERMINAL';

guard.assertLoadTimeClean();
const baseline = guard.snapshot();
test.afterEach(() => guard.assertNoViolations(baseline, 'signed-lease full synthetic integration'));

async function fixture(t, time = Date.parse('2026-11-26T04:00:00Z')) {
  const db = new TenantAuthMemoryDB();
  let now = time;
  const { AdminSignedLeaseAccess } = await import('../admin-web/lib/signed-lease-administration.mjs');
  const { HikvisionDoorProvider } = await import('../admin-web/lib/hikvision-door.mjs');
  const { processOnce } = await import('../tools/signed-remote-worker/worker-runtime.mjs');
  const admin = new AdminSignedLeaseAccess({ database: db, now: () => now });
  const sdk = { getWXContext: () => CONTEXT,
    openapi: { phonenumber: { getPhoneNumber: async () => ({ phoneInfo: { purePhoneNumber: '13800000003' } }) } } };
  const login = phoneMain({ cloud: sdk, db, now: () => now });
  const access = accessMain({ cloud: sdk, db, now: () => now });
  const saved = { ...runtime };
  runtime.mode = 'live'; runtime.cloudEnv = 'synthetic-integration-env';
  // Explicit opt-ins in a synthetic-only process. Production files stay false.
  runtime.signedLeaseRemoteEnabled = true; runtime.allowDeviceOperations = true;
  const previousWx = global.wx;
  global.wx = { cloud: { callFunction: async ({ name, data }) => {
    if (name === 'phoneLogin') return { result: await login(data) };
    if (name === 'signedLeaseAccess') return { result: await access(data) };
    throw new Error('Unexpected integration function');
  } } };
  delete require.cache[require.resolve('../miniprogram/services/api')];
  const api = require('../miniprogram/services/api');
  t.after(() => { Object.assign(runtime, saved); global.wx = previousWx; delete require.cache[require.resolve('../miniprogram/services/api')]; });
  await api.loginWithPhone('synthetic-one-time-wechat-code');
  const user = db.rows('users')[0];
  db._write('rooms', 'synthetic-room-doc', { houseId: HOUSE, displayNo: '102' });
  await admin.setDoorBinding(ADMIN, { bindingId: 'synthetic-bound-door', expectedRevision: 0,
    houseId: HOUSE, displayName: 'Synthetic leased door', deviceKey: 'synthetic-local-key',
    doorNo: 7, expectedModel: MODEL, enabled: true });
  await admin.setWorker(ADMIN, { workerId: 'synthetic-worker', expectedRevision: 0,
    deviceKey: 'synthetic-local-key', tokenHash: createHash('sha256').update(TOKEN).digest('hex'), enabled: true });
  const confirm = () => admin.confirmSignedLease(ADMIN, { contractId: CONTRACT, expectedRevision: 0,
    userId: user._id, houseId: HOUSE, doorBindingId: 'synthetic-bound-door',
    startDate: '2026-11-26', endDate: '2026-11-26', signedEvidenceRef: 'synthetic-existing-signed-evidence' });
  const config = { workerId: 'synthetic-worker', token: TOKEN, deviceKey: 'synthetic-local-key',
    expectedModel: MODEL, allowedDoorNos: [7], device: { origin: 'https://synthetic.invalid',
      username: 'synthetic-user', password: 'synthetic-password', certificatePath: '/synthetic-public-cert', developmentTls: false } };
  const events = [];
  const workerCloud = { async callFunction(action, input) {
    events.push(action); const result = await access({ action, ...input });
    if (result.code !== 0) throw Object.assign(new Error(result.code), { code: result.code });
    return result.data;
  } };
  const runWorker = async (onGet = async () => {}) => processOnce({ config, cloud: workerCloud, nowMs: () => now,
    readCertificate: async () => Buffer.from('synthetic-public-certificate-only'),
    createProvider: async () => new HikvisionDoorProvider({
      async request(request) {
        events.push(request.method);
        if (request.method === 'GET') {
          await onGet();
          return { status: 200, body: Buffer.from(`<DeviceInfo><model>${MODEL}</model></DeviceInfo>`) };
        }
        assert.equal(request.method, 'PUT');
        assert.equal(request.path, '/ISAPI/AccessControl/RemoteControl/door/7');
        assert.match(request.body, /<cmd>open<\/cmd>/);
        return { status: 200, body: Buffer.from('<ResponseStatus><statusCode>1</statusCode><statusString>OK</statusString><subStatusCode>ok</subStatusCode></ResponseStatus>') };
      }, close() { events.push('close'); },
    }),
  });
  return { db, api, admin, user, confirm, runWorker, events, enable: () => admin.configureProgram(ADMIN,
    { expectedRevision: 0, enabled: true, dispatchEnabled: true }), advance: delta => { now += delta; } };
}

test('real phone registration + admin signed fact + tenant API + queued worker complete without any face dependency', async t => {
  const h = await fixture(t);
  assert.deepEqual(h.user.houses, []);
  assert.equal((await h.api.listDoors()).doors.length, 0);
  assert.equal(h.db.rows(COLLECTIONS.GRANTS).length, 0);
  await h.confirm();
  assert.equal(h.db.rows(COLLECTIONS.CONTRACTS).length, 1);
  assert.equal(h.db.rows(COLLECTIONS.GRANTS).length, 1);
  assert.equal(h.db.rows('users')[0].houses.length, 0);
  assert.equal((await h.api.listDoors()).doors[0].canOpen, false);
  await h.enable();
  const available = await h.api.listDoors();
  assert.equal(available.doors[0].canOpen, true);
  const request = await h.api.requestOpen({ contractId: CONTRACT, requestId: 'synthetic-click-0001' });
  assert.equal(request.status, 'queued'); assert.deepEqual(h.events, []);
  assert.equal((await h.runWorker()).status, 'device_confirmed');
  assert.deepEqual(h.events, ['claimOpen', 'GET', 'beginOpen', 'PUT', 'close', 'reportOpen']);
  const result = await h.api.getOpenResult({ taskId: request.taskId });
  assert.equal(result.status, 'device_confirmed');
  assert.equal(result.resolved, false);
  assert.match(result.message, /不代表现场/);
  assert.equal((await h.api.requestOpen({ contractId: CONTRACT, requestId: 'synthetic-click-0001' })).taskId, request.taskId);
  assert.equal((await h.runWorker()).status, 'idle');
  assert.equal(h.events.filter(x => x === 'PUT').length, 1);
  assert.equal(h.db.rows('test_face_tasks').length, 0);
  assert.equal(h.db.rows('test_checkin_applications').length, 0);
});

test('revocation during the model query is rejected by final server begin with zero ordinary open', async t => {
  const h = await fixture(t); await h.confirm(); await h.enable();
  const request = await h.api.requestOpen({ contractId: CONTRACT, requestId: 'synthetic-revoked-01' });
  const result = await h.runWorker(async () => { await h.admin.revokeLease(ADMIN,
    { contractId: CONTRACT, expectedRevision: 1, reason: 'synthetic confirmed cancellation' }); });
  assert.equal(result.status, 'not_executed');
  assert.equal(h.events.filter(x => x === 'PUT').length, 0);
  assert.equal(h.events.filter(x => x === 'reportOpen').length, 0);
  assert.equal((await h.api.getOpenResult({ taskId: request.taskId })).status, 'denied');
  await assert.rejects(h.api.requestOpen({ contractId: CONTRACT, requestId: 'synthetic-revoked-02' }), e => e.code === 'ACCESS_REVOKED');
});

test('lease upper boundary reached during read-only preparation prevents begin and open', async t => {
  const h = await fixture(t, Date.parse('2026-11-26T15:59:59Z')); await h.confirm(); await h.enable();
  const request = await h.api.requestOpen({ contractId: CONTRACT, requestId: 'synthetic-midnight-01' });
  assert.equal(request.expiresAt, Date.parse('2026-11-26T16:00:00Z'));
  const result = await h.runWorker(async () => h.advance(1000));
  assert.equal(result.status, 'not_executed');
  assert.equal(h.events.filter(x => x === 'beginOpen' || x === 'PUT').length, 0);
  assert.equal((await h.api.getOpenResult({ taskId: request.taskId })).status, 'expired');
  await assert.rejects(h.api.requestOpen({ contractId: CONTRACT, requestId: 'synthetic-midnight-02' }), e => e.code === 'LEASE_EXPIRED');
});
