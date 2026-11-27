'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');
const guard = globalThis.__DSH_D_NETWORK_GUARD__;
let baseline;
test.before(() => { assert.ok(guard, 'preload the D network guard'); guard.assertLoadTimeClean(); });
test.beforeEach(() => { baseline = guard.snapshot(); });
test.afterEach(() => guard.assertNoViolations(baseline, 'signed lease frontend'));
const plain = value => JSON.parse(JSON.stringify(value));
const USER = { _id: 'synthetic-user', role: 'user', houses: [], points: 0 };
const TASK_ID = 'open_' + 'a'.repeat(64);
const DOOR = { contractId: 'synthetic-contract', doorBindingId: 'synthetic-binding', displayName: 'Synthetic door', houseId: 'synthetic-house',
  startDate: '2026-11-26', endDate: '2026-11-26',
  validFrom: Date.parse('2026-11-25T16:00:00Z'), validUntil: Date.parse('2026-11-26T16:00:00Z'), canOpen: true, reason: 'READY' };

function actualAPI(configOverrides = {}) {
  const config = { mode: 'live', cloudEnv: 'synthetic-env', signedLeaseRemoteEnabled: true, allowDeviceOperations: true, ...configOverrides };
  const calls = [];
  let reply = async request => {
    if (request.name === 'phoneLogin') return { result: { code: 0, userInfo: USER } };
    if (request.name === 'getDevices') return { result: { code: 0, data: { devices: [{ deviceId: 'synthetic-legacy', name: 'Legacy' }] } } };
    if (request.data.action === 'listDoors') return { result: { code: 0, data: { enabled: true, doors: [DOOR] } } };
    if (request.data.action === 'getOpenResult') return { result: { code: 0, data: { taskId: TASK_ID, status: 'device_confirmed', expiresAt: 123456, message: 'Device accepted; physical result unverified', resolved: false } } };
    return { result: { code: 0, data: { taskId: TASK_ID, status: 'queued', expiresAt: 123456 } } };
  };
  const wx = { cloud: { callFunction(request) { calls.push(plain(request)); return reply(request); } } };
  const file = path.join(ROOT, 'miniprogram/services/api.js');
  const requireActual = createRequire(file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, wx,
    require(name) { return name === '../config/runtime' ? config : requireActual(name); } }, { filename: file });
  return { api: module.exports, config, calls, reply(fn) { reply = fn; }, async login() {
    await module.exports.loginWithPhone('synthetic-authorization'); calls.length = 0;
  } };
}

test('signed APIs require login and explicit feature/device switches without cloud calls', async () => {
  const f = actualAPI();
  for (const action of [() => f.api.listDoors(), () => f.api.requestOpen({ contractId: DOOR.contractId, requestId: 'synthetic_request' }),
    () => f.api.getOpenResult({ taskId: TASK_ID })]) await assert.rejects(action(), error => error.code === 'AUTH_REQUIRED');
  assert.equal(f.calls.length, 0);
  await f.login(); f.config.signedLeaseRemoteEnabled = false;
  assert.deepEqual(plain(await f.api.listDoors()), { enabled: false, doors: [] });
  await assert.rejects(f.api.requestOpen({ contractId: DOOR.contractId, requestId: 'synthetic_request' }), error => error.code === 'SIGNED_REMOTE_DISABLED');
  assert.equal(f.calls.length, 0);
  f.config.signedLeaseRemoteEnabled = true; f.config.allowDeviceOperations = false;
  await assert.rejects(f.api.requestOpen({ contractId: DOOR.contractId, requestId: 'synthetic_request' }), error => error.code === 'DEVICE_OPERATIONS_DISABLED');
  assert.equal(f.calls.length, 0);
});

test('merged locks explicitly tag contract Hikvision access and strip server-only fields', async () => {
  const f = actualAPI(); await f.login();
  f.reply(async request => request.name === 'getDevices'
    ? { result: { code: 0, data: { devices: [{ deviceId: 'legacy', name: 'Legacy' }, { deviceId: 'forbidden-legacy', platform: 'hikvision' }] } } }
    : { result: { code: 0, data: { enabled: true, doors: [{ ...DOOR, deviceKey: 'synthetic-secret-target', tokenHash: 'synthetic-secret-hash' }] } } });
  const locks = plain(await f.api.listLocks());
  assert.equal(locks.length, 2);
  assert.equal(locks[1].platform, 'hikvision'); assert.equal(locks[1].authorizationSource, 'signed_lease');
  assert.equal(locks[1].canOpen, true); assert.match(locks[1].address, /2026-11-26 至 2026-11-26/);
  assert.equal(JSON.stringify(locks).includes('synthetic-secret'), false);
  assert.deepEqual(f.calls.map(call => call.name), ['getDevices', 'signedLeaseAccess']);
  await assert.rejects(f.api.unlockDevice(locks[1]), /专属开门接口/);
  assert.equal(f.calls.length, 2, 'Hikvision never enters legacy unlock');
});

test('feature-off legacy listing remains unchanged and signed service failure has no legacy fallback', async () => {
  const f = actualAPI({ signedLeaseRemoteEnabled: false }); await f.login();
  assert.equal((await f.api.listLocks()).length, 1); assert.deepEqual(f.calls.map(call => call.name), ['getDevices']);
  f.config.signedLeaseRemoteEnabled = true;
  f.reply(async request => {
    if (request.name === 'getDevices') return { result: { code: 0, data: { devices: [] } } };
    throw new Error('synthetic unavailable');
  });
  await assert.rejects(f.api.listLocks(), /signedLeaseAccess/);
});

test('lease labels use validated server calendar dates across historical Shanghai daylight saving time', async () => {
  const f = actualAPI(); await f.login();
  const historical = { ...DOOR, startDate: '1989-06-01', endDate: '1989-06-02',
    validFrom: Date.parse('1989-05-31T15:00:00Z'), validUntil: Date.parse('1989-06-02T15:00:00Z') };
  const respond = door => f.reply(async request => request.name === 'getDevices'
    ? { result: { code: 0, data: { devices: [] } } }
    : { result: { code: 0, data: { enabled: true, doors: [door] } } });
  respond(historical);
  assert.equal((await f.api.listLocks())[0].address, '租期 1989-06-01 至 1989-06-02');
  for (const dates of [{ startDate: undefined }, { startDate: '1989-6-01' }, { startDate: '1989-02-30' }, { endDate: '1989-05-31' }]) {
    respond({ ...historical, ...dates });
    await assert.rejects(f.api.listDoors(), error => error.code === 'SIGNED_REMOTE_RESPONSE_INVALID');
  }
});

test('signed request payload is closed and concurrent submission sends exactly once without a face prerequisite', async () => {
  const f = actualAPI(); await f.login();
  for (const extra of ['houseId', 'doorNo', 'validFrom', 'userId', 'approved', 'faceStatus']) {
    await assert.rejects(f.api.requestOpen({ contractId: DOOR.contractId, requestId: 'synthetic_request', [extra]: 'forged' }));
  }
  let getterCalls = 0;
  await assert.rejects(f.api.requestOpen(Object.defineProperty({}, 'contractId', { get() { getterCalls++; return DOOR.contractId; } })));
  assert.equal(getterCalls, 0); assert.equal(f.calls.length, 0);
  let finish;
  f.reply(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.api.requestOpen({ contractId: DOOR.contractId, requestId: 'synthetic_request' });
  await assert.rejects(f.api.requestOpen({ contractId: DOOR.contractId, requestId: 'synthetic_other' }), error => error.code === 'SIGNED_OPEN_PENDING');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].data, { action: 'requestOpen', contractId: DOOR.contractId, requestId: 'synthetic_request' });
  finish({ result: { code: 0, data: { taskId: TASK_ID, status: 'queued', expiresAt: 123456 } } });
  assert.equal((await pending).status, 'queued'); assert.equal(f.calls.length, 1);
});

test('unknown reason fails closed and private signed receipts cannot survive logout', async () => {
  const f = actualAPI(); await f.login();
  f.reply(async () => ({ result: { code: 0, data: { enabled: true, doors: [{ ...DOOR, reason: 'UNRECOGNIZED' }] } } }));
  assert.equal((await f.api.listDoors()).doors[0].canOpen, false);
  let finish;
  f.reply(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.api.getOpenResult({ taskId: TASK_ID });
  f.api.logout(); finish({ result: { code: 0, data: { taskId: TASK_ID, status: 'device_confirmed', expiresAt: 123456, message: 'synthetic', resolved: false } } });
  await assert.rejects(pending, error => error.code === 'AUTH_REQUIRED');
});

function pageFixture(overrides = {}) {
  const state = { authenticated: true, epoch: 1 };
  const calls = { request: [], result: [], legacy: [], modals: [], toasts: [] };
  const lock = { ...DOOR, id: 'signed-door', name: DOOR.displayName, platform: 'hikvision', authorizationSource: 'signed_lease' };
  const api = { isDemo: () => false, isSignedLeaseRemoteEnabled: () => true,
    isAuthenticated: () => state.authenticated, getLoginEpoch: () => state.authenticated ? state.epoch : null,
    getProfile: async () => state.authenticated ? { _id: USER._id, authenticated: true } : null,
    listLocks: async () => [lock], listUnlockRecords: async () => [], listFamily: async () => [],
    requestOpen: async input => { calls.request.push(plain(input)); return { taskId: TASK_ID, status: 'queued', expiresAt: 123456 }; },
    getOpenResult: async input => { calls.result.push(plain(input)); return { taskId: TASK_ID, status: 'device_confirmed', expiresAt: 123456, message: 'synthetic', resolved: false }; },
    unlockDevice: async input => { calls.legacy.push(input); }, ...overrides };
  const wx = { showModal(options) { calls.modals.push(options); if (options.title === '请先登录') options.success({ confirm: false }); },
    showToast(options) { calls.toasts.push(options); }, stopPullDownRefresh() {}, showActionSheet() {}, switchTab() {} };
  const gateModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'miniprogram/utils/require-login.js'), 'utf8'), { module: gateModule, wx });
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'miniprogram/pages/unlock/index.js'), 'utf8'), {
    require(name) { if (name === '../../services/api') return api; if (name === '../../utils/require-login') return gateModule.exports; throw new Error(name); },
    Page(value) { definition = value; }, wx, getApp: () => ({ globalData: {} }) });
  const page = { ...definition, data: plain(definition.data), setData(value) { Object.assign(this.data, value); } };
  return { page, api, state, calls, lock, async confirm() {
    await page.requestUnlock(lock);
    const modal = calls.modals.filter(value => value.title === '确认远程开门').at(-1);
    assert.ok(modal); return modal.success({ confirm: true });
  } };
}

test('signed page queues once, queries only on user action and describes device acceptance without claiming release', async () => {
  const f = pageFixture(); await f.page.onLoad({}); await f.confirm();
  assert.equal(f.calls.request.length, 1); assert.equal(f.calls.legacy.length, 0); assert.equal(f.calls.result.length, 0);
  assert.equal(f.page.data.signedOpen.status, 'queued'); assert.match(f.page.data.signedOpen.hint, /尚未确认设备接收/);
  assert.match(f.calls.request[0].requestId, /^[A-Za-z0-9_-]{8,128}$/);
  await f.page.requestUnlock(f.lock); assert.equal(f.calls.request.length, 1);
  await Promise.all([f.page.querySignedOpen(), f.page.querySignedOpen()]);
  assert.equal(f.calls.result.length, 1); assert.equal(f.page.data.signedOpen.label, '设备已接受指令');
  assert.match(f.page.data.signedOpen.hint, /不代表门锁已释放/);
});

test('lost submission receipt remains unknown through page refresh and never retries or polls automatically', async () => {
  let attempts = 0;
  const f = pageFixture({ requestOpen: async () => { attempts++; throw new Error('synthetic lost receipt'); } });
  await f.page.onLoad({}); await f.confirm();
  assert.equal(f.page.data.signedOpen.status, 'unknown'); assert.match(f.page.data.signedOpen.hint, /不会自动重试或补发/);
  await f.page.onShow(); await f.page.requestUnlock(f.lock);
  assert.equal(f.page.data.signedOpen.status, 'unknown'); assert.equal(attempts, 1); assert.equal(f.calls.result.length, 0);
});

test('unknown disposition requires a server boolean and permits a fresh command only after an explicit new action', async () => {
  const f = actualAPI(); await f.login();
  for (const resolved of [undefined, 'true', 1]) {
    f.reply(async () => ({ result: { code: 0, data: { taskId: TASK_ID, status: 'unknown', expiresAt: 123456, message: 'synthetic', resolved } } }));
    await assert.rejects(f.api.getOpenResult({ taskId: TASK_ID }), error => error.code === 'SIGNED_REMOTE_RESPONSE_INVALID');
  }
  f.reply(async () => ({ result: { code: 0, data: { taskId: TASK_ID, status: 'unknown', expiresAt: 123456, message: 'synthetic', resolved: true } } }));
  const result = await f.api.getOpenResult({ taskId: TASK_ID });
  assert.equal(result.status, 'unknown'); assert.equal(result.resolved, true);
  const p = pageFixture({ getOpenResult: async () => ({ taskId: TASK_ID, status: 'unknown', expiresAt: 123456, message: 'synthetic', resolved: true }) });
  await p.page.onLoad({}); await p.confirm();
  const firstRequestId = p.calls.request[0].requestId;
  await p.page.querySignedOpen();
  assert.equal(p.page.data.signedOpen.status, 'unknown');
  assert.match(p.page.data.signedOpen.hint, /先前结果仍未知，人工核查已记录；再次操作将发送新指令/);
  assert.equal(p.calls.request.length, 1, 'querying never submits another command');
  await p.confirm(); assert.equal(p.calls.request.length, 2);
  assert.notEqual(p.calls.request[1].requestId, firstRequestId);
});

test('lease-disabled door and confirmation crossing a login epoch issue zero signed commands', async () => {
  const f = pageFixture(); await f.page.onLoad({});
  f.lock.canOpen = false; f.lock.status = '租期已结束';
  await f.page.requestUnlock(f.lock); assert.equal(f.calls.modals.length, 0); assert.equal(f.calls.request.length, 0);
  f.lock.canOpen = true; await f.page.requestUnlock(f.lock);
  const modal = f.calls.modals.at(-1); f.state.epoch++;
  await modal.success({ confirm: true }); assert.equal(f.calls.request.length, 0);
});

test('signed receipt received while hidden is retained only for the same login epoch', async () => {
  let finish;
  const f = pageFixture({ requestOpen: () => new Promise(resolve => { finish = resolve; }) });
  await f.page.onLoad({});
  const pending = f.confirm();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  f.page.onHide(); finish({ taskId: TASK_ID, status: 'queued', expiresAt: 123456 }); await pending;
  assert.equal(f.page.data.signedOpen.status, 'requesting', 'hidden pages receive no result rendering');
  await f.page.onShow(); assert.equal(f.page.data.signedOpen.taskId, TASK_ID);
  f.state.authenticated = false; await f.page.onShow(); assert.equal(f.page.data.signedOpen, null);
});

test('same-epoch receipt arriving after hide then show updates the visible page without another open', async () => {
  let finish, attempts = 0;
  const f = pageFixture({ requestOpen: () => { attempts++; return new Promise(resolve => { finish = resolve; }); } });
  await f.page.onLoad({});
  const pending = f.confirm();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  f.page.onHide(); await f.page.onShow();
  assert.equal(f.page.data.signedOpen.status, 'requesting');
  finish({ taskId: TASK_ID, status: 'queued', expiresAt: 123456 }); await pending;
  assert.equal(f.page.data.signedOpen.status, 'queued');
  assert.equal(f.page.data.signedOpen.taskId, TASK_ID);
  assert.equal(f.page.data.pendingId, ''); assert.equal(attempts, 1);
  await f.page.querySignedOpen(); assert.equal(f.calls.result.length, 1); assert.equal(attempts, 1);
});

test('a receipt from a previous login epoch cannot revive a cleared signed result', async () => {
  let finish, attempts = 0;
  const f = pageFixture({ requestOpen: () => { attempts++; return new Promise(resolve => { finish = resolve; }); } });
  await f.page.onLoad({}); const pending = f.confirm();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  f.state.epoch++; await f.page.onShow(); assert.equal(f.page.data.signedOpen, null);
  finish({ taskId: TASK_ID, status: 'queued', expiresAt: 123456 }); await pending;
  assert.equal(f.page.data.signedOpen, null); assert.equal(f.page._signedOpenState, null); assert.equal(attempts, 1);
});

test('an older result query cannot overwrite a new explicit open attempt', async () => {
  const f = pageFixture(); const nextTask = 'open_' + 'b'.repeat(64);
  f.api.requestOpen = async input => {
    f.calls.request.push(plain(input));
    return { taskId: f.calls.request.length === 1 ? TASK_ID : nextTask, status: 'queued', expiresAt: 123456 };
  };
  await f.page.onLoad({}); await f.confirm(); await f.page.querySignedOpen();
  assert.equal(f.page.data.signedOpen.status, 'device_confirmed');
  let finish;
  f.api.getOpenResult = () => new Promise(resolve => { finish = resolve; });
  const oldQuery = f.page.querySignedOpen();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await f.confirm(); const newRequestId = f.calls.request[1].requestId;
  assert.equal(f.page.data.signedOpen.taskId, nextTask);
  finish({ taskId: TASK_ID, status: 'device_confirmed', expiresAt: 123456, resolved: false, message: 'synthetic old result' });
  await oldQuery;
  assert.equal(f.page.data.signedOpen.taskId, nextTask);
  assert.equal(f.page.data.signedOpen.status, 'queued'); assert.equal(f.page.data.signedOpen.requestId, newRequestId);
  assert.equal(f.calls.request.length, 2);
});

test('confirmation keeps its operation lock across delayed identity checking and cannot create a second modal', async () => {
  let attempts = 0;
  const f = pageFixture({ requestOpen: async () => {
    attempts++;
    if (attempts > 1) throw Object.assign(new Error('synthetic singleflight rejection'), { code: 'REQUEST_IN_FLIGHT' });
    return { taskId: TASK_ID, status: 'queued', expiresAt: 123456 };
  } });
  await f.page.onLoad({}); await f.page.requestUnlock(f.lock);
  const first = f.calls.modals.filter(modal => modal.title === '确认远程开门')[0];
  const original = f.page.requirePrivate.bind(f.page);
  let pause = true, release;
  f.page.requirePrivate = async (...args) => {
    const allowed = await original(...args);
    if (pause) { pause = false; await new Promise(resolve => { release = resolve; }); }
    return allowed;
  };
  const confirming = first.success({ confirm: true });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  try {
    await f.page.requestUnlock(f.lock);
  } finally { release(); }
  await confirming;
  const modals = f.calls.modals.filter(modal => modal.title === '确认远程开门');
  if (modals[1]) await modals[1].success({ confirm: true });
  assert.equal(attempts, 1, `confirmation modals=${modals.length}, final status=${f.page.data.signedOpen.status}, task=${f.page.data.signedOpen.taskId}`);
  assert.equal(modals.length, 1); assert.equal(f.page.data.signedOpen.taskId, TASK_ID);
});

test('cancelled modal callbacks cannot release or execute a newer confirmation operation', async () => {
  const f = pageFixture(); await f.page.onLoad({}); await f.page.requestUnlock(f.lock);
  const first = f.calls.modals.at(-1); await first.success({ confirm: false });
  await f.page.requestUnlock(f.lock); const second = f.calls.modals.at(-1);
  first.fail(); assert.equal(f.page.data.confirming, true, 'stale cancellation must not release the new owner');
  await first.success({ confirm: true }); assert.equal(f.calls.request.length, 0);
  await second.success({ confirm: true });
  assert.equal(f.calls.request.length, 1); assert.equal(f.page.data.signedOpen.taskId, TASK_ID);
});

function deferredReceipt() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function accountSwitchFixture(source, phase) {
  const cloud = actualAPI();
  let account = 'A';
  const events = { opens: [], queries: [] };
  const oldReceipt = deferredReceipt(), oldStarted = deferredReceipt();
  const newReceipt = deferredReceipt(), newStarted = deferredReceipt();
  const newQueryReceipt = deferredReceipt(), newQueryStarted = deferredReceipt();
  const newViewReceipt = deferredReceipt(), newViewStarted = deferredReceipt(), newRecordsReceipt = deferredReceipt();
  const taskIds = { A: TASK_ID, B: 'open_' + 'b'.repeat(64) };
  const receipt = (owner, status = 'queued') => ({ taskId: taskIds[owner], status, expiresAt: 123456, resolved: false, message: `Synthetic ${owner} result` });
  const door = owner => ({ ...DOOR, contractId: `synthetic-contract-${owner}`, doorBindingId: `synthetic-binding-${owner}`,
    houseId: `synthetic-house-${owner}`, displayName: `Synthetic ${owner} door` });
  cloud.reply(async request => {
    const owner = account;
    let data;
    if (request.name === 'phoneLogin') return { result: { code: 0, userInfo: { ...USER, _id: `synthetic-user-${owner}` } } };
    if (request.name === 'getDevices') data = { devices: [] };
    else if (request.name === 'unlockRecords') {
      if (owner === 'B' && phase === 'refreshing') return newRecordsReceipt.promise;
      data = { records: [{ id: `record-${owner}`, doorName: `Synthetic ${owner} door`, success: false, time: 'synthetic' }] };
    } else if (request.data.action === 'listDoors') {
      if (owner === 'B' && phase === 'refreshing') { newViewStarted.resolve(); return newViewReceipt.promise; }
      data = { enabled: true, doors: [door(owner)] };
    }
    else if (request.data.action === 'requestOpen') {
      events.opens.push({ owner, data: plain(request.data) });
      if (owner === 'A' && source === 'request') { oldStarted.resolve(); return oldReceipt.promise; }
      if (owner === 'B' && phase === 'requesting') { newStarted.resolve(); return newReceipt.promise; }
      data = receipt(owner);
    } else if (request.data.action === 'getOpenResult') {
      events.queries.push({ owner, data: plain(request.data) });
      if (owner === 'A') { oldStarted.resolve(); return oldReceipt.promise; }
      newQueryStarted.resolve(); return newQueryReceipt.promise;
    } else throw new Error('unexpected synthetic cloud action');
    return { result: { code: 0, data } };
  });
  const f = pageFixture({ ...cloud.api });
  const login = async (owner) => { account = owner; await cloud.api.loginWithPhone(`synthetic-authorization-${owner}`); };
  const modal = async () => {
    await f.page.requestUnlock(f.page.data.locks[0]);
    return f.calls.modals.filter(item => item.title === '确认远程开门').at(-1);
  };
  await login('A'); await f.page.onLoad({});
  const first = await modal();
  let oldWork = first.success({ confirm: true });
  if (source === 'query') { await oldWork; oldWork = f.page.querySignedOpen(); }
  await oldStarted.promise;
  return { ...f, cloud, events, login, modal, oldWork, oldReceipt, taskIds, receipt, door,
    newReceipt, newStarted, newQueryReceipt, newQueryStarted, newViewReceipt, newViewStarted, newRecordsReceipt };
}

for (const source of ['request', 'query']) {
  for (const outcome of ['success', 'failure']) {
    for (const phase of ['confirming', 'requesting']) {
      test(`C-01 stale A ${source} ${outcome} cannot clear B ${phase} owner or private view`, async () => {
        const f = await accountSwitchFixture(source, phase);
        f.cloud.api.logout(); await f.login('B'); await f.page.onShow();
        const confirmation = await f.modal();
        let newWork;
        if (phase === 'requesting') { newWork = confirmation.success({ confirm: true }); await f.newStarted.promise; }
        const owner = f.page._unlockOperation, version = f.page._viewVersion;
        const before = plain({ locks: f.page.data.locks, records: f.page.data.records, signedOpen: f.page.data.signedOpen,
          pendingId: f.page.data.pendingId, confirming: f.page.data.confirming });
        try {
          if (outcome === 'success') f.oldReceipt.resolve({ result: { code: 0, data: f.receipt('A', 'device_confirmed') } });
          else f.oldReceipt.reject(new Error('synthetic old A transport rejection'));
          await f.oldWork;
          assert.equal(f.page._unlockOperation, owner, 'late A callback must preserve B operation identity');
          assert.equal(f.page._viewVersion, version, 'late A callback must not advance B view generation');
          assert.deepEqual(plain({ locks: f.page.data.locks, records: f.page.data.records, signedOpen: f.page.data.signedOpen,
            pendingId: f.page.data.pendingId, confirming: f.page.data.confirming }), before);
          if (phase === 'confirming') newWork = confirmation.success({ confirm: true });
        } finally {
          f.newReceipt.resolve({ result: { code: 0, data: f.receipt('B') } });
          if (newWork) await newWork;
        }
        assert.equal(f.events.opens.filter(event => event.owner === 'B').length, 1, 'one explicit B confirmation sends once');
        assert.equal(f.page.data.signedOpen.taskId, f.taskIds.B);
        assert.equal(f.page.data.signedOpen.contractId, 'synthetic-contract-B');
        assert.equal(JSON.stringify(f.page.data).includes('synthetic-contract-A'), false);
      });
    }
  }
}

for (const source of ['request', 'query']) {
  test(`C-01 B refresh clears old A data before claiming the view while ${source} receipt is pending`, async () => {
    const f = await accountSwitchFixture(source, 'refreshing');
    f.cloud.api.logout(); await f.login('B');
    const refreshing = f.page.refresh(); await f.newViewStarted.promise;
    try {
      assert.deepEqual(plain(f.page.data.locks), [], 'new login must remove old locks before awaiting its own list');
      assert.deepEqual(plain(f.page.data.records), [], 'new login must remove old records before awaiting its own list');
      assert.equal(f.page.data.signedOpen, null); assert.equal(f.page.data.loading, true);
      const version = f.page._viewVersion;
      f.oldReceipt.resolve({ result: { code: 0, data: f.receipt('A', 'device_confirmed') } }); await f.oldWork;
      assert.equal(f.page._viewVersion, version); assert.equal(f.page.data.loading, true);
      assert.deepEqual(plain(f.page.data.locks), []); assert.deepEqual(plain(f.page.data.records), []);
    } finally {
      f.oldReceipt.resolve({ result: { code: 0, data: f.receipt('A', 'device_confirmed') } }); await f.oldWork;
      f.newViewReceipt.resolve({ result: { code: 0, data: { enabled: true, doors: [f.door('B')] } } });
      f.newRecordsReceipt.resolve({ result: { code: 0, data: { records: [] } } }); await refreshing;
    }
    assert.equal(f.page.data.locks[0].contractId, 'synthetic-contract-B');
    assert.equal(f.page.data.loading, false); assert.equal(f.events.opens.filter(event => event.owner === 'B').length, 0);
  });
}

for (const outcome of ['success', 'failure']) {
  test(`C-01 stale A query ${outcome} and finally preserve B active query and task`, async () => {
    const f = await accountSwitchFixture('query', 'querying');
    f.cloud.api.logout(); await f.login('B'); await f.page.onShow();
    const confirmation = await f.modal(); await confirmation.success({ confirm: true });
    const newQuery = f.page.querySignedOpen(); await f.newQueryStarted.promise;
    const current = plain(f.page.data.signedOpen), version = f.page._viewVersion;
    try {
      if (outcome === 'success') f.oldReceipt.resolve({ result: { code: 0, data: f.receipt('A', 'device_confirmed') } });
      else f.oldReceipt.reject(new Error('synthetic old A query rejection'));
      await f.oldWork;
      assert.equal(f.page.data.signedResultLoading, true, 'old query finally must not clear B query lock');
      assert.equal(f.page._viewVersion, version);
      assert.deepEqual(plain(f.page.data.signedOpen), current);
      assert.equal(f.page.data.locks[0].contractId, 'synthetic-contract-B');
    } finally {
      f.newQueryReceipt.resolve({ result: { code: 0, data: f.receipt('B', 'device_confirmed') } });
      await newQuery;
    }
    assert.equal(f.page.data.signedOpen.taskId, f.taskIds.B);
    assert.equal(f.events.opens.filter(event => event.owner === 'B').length, 1);
  });
}

for (const source of ['request', 'query']) {
  for (const scenario of ['logout', 'view-still-owned-by-A']) {
    test(`C-01 ${source} completion still clears private A view after ${scenario}`, async () => {
      const f = await accountSwitchFixture(source, 'confirming');
      assert.equal(f.page.data.locks[0].contractId, 'synthetic-contract-A');
      f.cloud.api.logout();
      if (scenario === 'view-still-owned-by-A') await f.login('B');
      f.oldReceipt.resolve({ result: { code: 0, data: f.receipt('A', 'device_confirmed') } });
      await f.oldWork;
      assert.deepEqual(plain(f.page.data.locks), []); assert.deepEqual(plain(f.page.data.records), []);
      assert.equal(f.page.data.signedOpen, null); assert.equal(f.page.data.confirming, false);
      assert.equal(f.page._unlockOperation, null);
      assert.equal(f.events.opens.filter(event => event.owner === 'B').length, 0, 'cleanup never submits for B');
    });
  }
}
