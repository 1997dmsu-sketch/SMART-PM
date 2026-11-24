'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const guard = globalThis.__DSH_D_NETWORK_GUARD__;
const USER = { _id: 'synthetic-user', role: 'user', houses: [], points: 0 };
let network;
test.before(() => guard.assertLoadTimeClean());
test.beforeEach(() => { network = guard.snapshot(); });
test.afterEach(() => guard.assertNoViolations(network, 'login gate'));

function gate(profile = null, answer = false) {
  const file = require.resolve('../miniprogram/utils/require-login');
  delete require.cache[file];
  const helper = require(file);
  const calls = [];
  const api = { getProfile: async () => profile, isDemo: () => false };
  global.wx = { showModal(options) { calls.push(['modal', options]); if (answer !== null) options.success({ confirm: answer }); },
    switchTab(options) { calls.push(['tab', options]); } };
  return { helper, api, calls, setProfile(value) { profile = value; } };
}

test('guest cancellation and confirmation stop the original operation and go only to login', async () => {
  for (const confirm of [false, true]) {
    const f = gate(null, confirm);
    assert.equal(await f.helper.requireLogin(f.api, '电话咨询'), false);
    assert.equal(f.calls[0][1].title, '请先登录');
    assert.equal(f.calls[0][1].confirmText, '去登录');
    assert.equal(f.calls.filter(([kind]) => kind === 'tab').length, confirm ? 1 : 0);
    if (confirm) assert.equal(f.calls[1][1].url, '/pages/profile/index');
  }
});

test('missing, failed and malformed identity are never treated as logged in', async () => {
  const f = gate();
  for (const value of [null, {}, { authenticated: false }, { authenticated: true },
    { authenticated: true, _id: 'invalid/id' }]) {
    f.setProfile(value);
    assert.equal(await f.helper.hasLogin(f.api), false);
  }
  assert.equal(await f.helper.hasLogin({}), false);
  assert.equal(await f.helper.hasLogin({ getProfile: async () => { throw Error('unavailable'); } }), false);
  f.setProfile({ ...USER, authenticated: true });
  assert.equal(await f.helper.requireLogin(f.api, '操作'), true);
  assert.equal(f.calls.length, 0);
  f.api.isAuthenticated = () => false;
  assert.equal(await f.helper.hasLogin(f.api), false, 'a stale awaited profile cannot survive logout');
});

test('parallel protected actions share one prompt and never auto-resume after login', async () => {
  const f = gate(null, null);
  const one = f.helper.requireLogin(f.api, '收藏');
  const two = f.helper.requireLogin(f.api, '咨询');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  f.setProfile({ ...USER, authenticated: true });
  f.calls[0][1].success({ confirm: true });
  assert.deepEqual(await Promise.all([one, two]), [false, false]);
});

function actualApi() {
  const configFile = require.resolve('../miniprogram/config/runtime');
  const apiFile = require.resolve('../miniprogram/services/api');
  delete require.cache[apiFile];
  const config = require(configFile);
  Object.assign(config, { mode: 'live', cloudEnv: 'synthetic-env', allowDeviceOperations: true });
  const calls = [];
  global.wx = { cloud: { callFunction: async request => { calls.push(request); return { result: { code: 0, userInfo: USER } }; },
    uploadFile: async request => { calls.push(request); return { fileID: 'cloud://synthetic/test-face/photo.jpg' }; } } };
  return { api: require(apiFile), config, calls };
}

test('all private API families reject guests without cloud or upload calls', async () => {
  const { api, calls } = actualApi();
  for (const operation of [
    () => api.listLocks(), () => api.listUnlockRecords(), () => api.unlockDevice({ deviceId: 'synthetic-door' }),
    () => api.listConversations(), () => api.markRead('synthetic-chat'), () => api.getMessages('synthetic-chat'),
    () => api.sendMessage('synthetic-chat', 'synthetic-text'), () => api.listFamily(), () => api.addFamily(),
    () => api.getProperty(), () => api.listMeters('water'), () => api.getCheckinFaceConfig(),
    () => api.applyTestCheckin({ applicationVersion: 'synthetic-v1' }),
    () => api.uploadTestFace({ applicationId: 'synthetic-app', cloudPath: 'test-face/synthetic.jpg', filePath: 'synthetic-local-photo' }),
    () => api.createFaceTask({ applicationId: 'synthetic-app', fileId: 'synthetic-id', consent: true }),
    () => api.getFaceTask('synthetic-app'),
  ]) await assert.rejects(operation(), error => error.code === 'AUTH_REQUIRED');
  assert.equal(calls.length, 0);
});

test('logout rejects late private data and file upload receipts', async () => {
  const f = actualApi();
  await f.api.loginWithPhone('synthetic-phone-code');
  let complete;
  wx.cloud.callFunction = () => new Promise(resolve => { complete = resolve; });
  const pending = f.api.getMessages('synthetic-chat');
  f.api.logout();
  complete({ result: { code: 0, data: [{ text: 'private' }] } });
  await assert.rejects(pending, error => error.code === 'AUTH_REQUIRED');
  wx.cloud.callFunction = async () => ({ result: { code: 0, userInfo: USER } });
  await f.api.loginWithPhone('synthetic-phone-code');
  wx.cloud.uploadFile = () => new Promise(resolve => { complete = resolve; });
  const upload = f.api.uploadTestFace({ applicationId: 'synthetic-app', cloudPath: 'test-face/synthetic.jpg', filePath: 'synthetic-local-photo' });
  f.api.logout();
  complete({ fileID: 'cloud://synthetic/test-face/synthetic.jpg' });
  await assert.rejects(upload, error => error.code === 'AUTH_REQUIRED');
});

test('private result mapping also rechecks login after the inner request promise', async () => {
  const f = actualApi();
  await f.api.loginWithPhone('synthetic-phone-code');
  wx.cloud.callFunction = async () => ({ result: { code: 0, data: { devices: [{ deviceId: 'synthetic-door' }] } } });
  const result = f.api.listLocks();
  queueMicrotask(() => queueMicrotask(() => f.api.logout()));
  await assert.rejects(result, error => error.code === 'AUTH_REQUIRED');
});

test('a pending replacement login cannot issue a usable epoch for the previous profile', async () => {
  const f = actualApi();
  await f.api.loginWithPhone('synthetic-phone-code');
  const previous = f.api.getLoginEpoch();
  assert.equal(f.api.isAuthenticated(), true);
  let complete;
  wx.cloud.callFunction = () => new Promise(resolve => { complete = resolve; });
  const pending = f.api.loginWithPassword({ username: 'synthetic.user', password: 'AbCdEf78' });
  assert.equal(f.api.isAuthenticated(), false);
  assert.equal(f.api.getLoginEpoch(), null);
  await assert.rejects(f.api.listLocks(), error => error.code === 'AUTH_REQUIRED');
  complete({ result: { code: 0, userInfo: { ...USER, _id: 'synthetic-next-user' } } });
  await pending;
  assert.equal(f.api.isAuthenticated(), true);
  assert.notEqual(f.api.getLoginEpoch(), previous);
  assert.equal((await f.api.getProfile())._id, 'synthetic-next-user');
});

test('password API accepts the new eight-character boundary and rejects seven before cloud', async () => {
  const f = actualApi();
  await assert.rejects(f.api.loginWithPassword({ username: 'synthetic.user', password: 'AbCdEf7' }));
  assert.equal(f.calls.length, 0);
  await f.api.loginWithPassword({ username: 'synthetic.user', password: 'AbCdEf78' });
  assert.equal(f.calls.length, 1);
  assert.equal((await f.api.getProfile())._id, USER._id);
});

function rentalFixture(loggedIn) {
  let profile = loggedIn ? { ...USER, authenticated: true } : null;
  const calls = [];
  const house = { id: 'synthetic-house', title: '合成房源', price: 1000, area: 20,
    canBook: true, images: [], phone: '13800000000' };
  const api = { isDemo: () => false, getProfile: async () => profile,
    isAuthenticated: () => Boolean(profile && profile.authenticated === true),
    getHouse: async () => house, listHouses: async () => ({ houses: [] }) };
  global.wx = {
    showModal(options) { calls.push(['modal', options]); if (options.success) options.success({ confirm: false }); },
    showToast(options) { calls.push(['toast', options]); },
    getStorageSync(key) { calls.push(['read', key]); return [{ id: house.id }]; },
    setStorageSync(key, value) { calls.push(['write', key, value]); },
    switchTab(options) { calls.push(['tab', options]); },
    makePhoneCall(options) { calls.push(['phone', options]); },
  };
  const file = path.resolve(__dirname, '../miniprogram/pages/rental/index.js');
  let definition;
  const realRequire = createRequire(file);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { require: name => name === '../../services/api' ? api : realRequire(name),
    Page(value) { definition = value; }, wx: global.wx, Date, getApp: () => ({ globalData: {} }), getCurrentPages: () => [] });
  const page = { ...definition, houseId: house.id, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  return { page, calls, house, logout() { profile = null; } };
}

test('rental browsing remains public while guest calls, consult, favorites and appointments prompt login', async () => {
  const f = rentalFixture(false);
  await f.page.load();
  assert.equal(f.page.data.house.id, f.house.id);
  assert.equal(f.calls.length, 0, 'anonymous public detail must not read personal storage or prompt');
  for (const operation of [() => f.page.toggleFavorite(), () => f.page.openAppointment(),
    () => f.page.saveAppointment({ detail: { value: {} } }), () => f.page.contactPhone(), () => f.page.consult()]) await operation();
  assert.equal(f.calls.filter(([kind]) => kind === 'modal').length, 5);
  assert.equal(f.calls.some(([kind]) => ['read', 'write', 'phone', 'tab'].includes(kind)), false);
  assert.equal(f.page.data.appointmentOpen, false);
});

test('authenticated rental actions retain normal behavior and logout clears personalized state', async () => {
  const f = rentalFixture(true);
  await f.page.load();
  assert.equal(f.page.data.favorite, true);
  await f.page.contactPhone();
  await f.page.consult();
  await f.page.openAppointment();
  assert.equal(f.calls.filter(([kind]) => kind === 'phone').length, 1);
  assert.equal(f.calls.filter(([kind]) => kind === 'tab').length, 1);
  assert.equal(f.page.data.appointmentOpen, true);
  f.logout();
  await f.page.onShow();
  assert.equal(f.page.data.favorite, false);
  assert.equal(f.page.data.appointmentOpen, false);
});

test('logout in the login-gate microtask gap prevents direct phone, cache and appointment effects', async () => {
  for (const name of ['contactPhone', 'toggleFavorite', 'loadFavorite', 'openAppointment', 'consult']) {
    const f = rentalFixture(true);
    f.page.data.house = { ...f.house, images: [] };
    const pending = f.page[name]();
    queueMicrotask(() => f.logout());
    await pending;
    assert.equal(f.calls.some(([kind]) => ['read', 'write', 'phone', 'tab'].includes(kind)), false, name);
    assert.equal(f.page.data.favorite, false, name);
    assert.equal(f.page.data.appointmentOpen, false, name);
  }
});
