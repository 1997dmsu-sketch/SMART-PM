'use strict';

// Page VM -> real services/api -> canonical public preset. No API/preset mock.
const { test, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const runtime = require('../miniprogram/config/runtime');

const networkGuard = globalThis.__DSH_D_NETWORK_GUARD__;
let networkBaseline;
before(() => {
  assert.ok(networkGuard, 'preload tests/support/d-network-guard.cjs before the synthetic page suite');
  networkGuard.assertLoadTimeClean();
});
afterEach(() => networkGuard.assertNoViolations(networkBaseline, 'qishanyuan page/API business window'));
let api, calls, storage, storageWrites;
beforeEach(() => {
  networkBaseline = networkGuard.snapshot();
  runtime.mode = 'live';
  runtime.cloudEnv = '';
  runtime.allowDeviceOperations = false;
  runtime.testPropertyPreset = 'qishanyuan-test-v1';
  calls = { cloud: 0, cloudInit: 0, payments: 0, phones: 0, navigation: [], toasts: [], modals: [] };
  storage = new Map();
  storageWrites = [];
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => { storageWrites.push(key); storage.set(key, value); },
    showToast: (value) => calls.toasts.push(value),
    showModal: (value) => {
      calls.modals.push(value);
      if (value.success) value.success({ confirm: false, cancel: true });
      if (value.complete) value.complete();
    },
    navigateTo: (value) => calls.navigation.push(value),
    switchTab: (value) => calls.navigation.push(value),
    makePhoneCall: () => { calls.phones += 1; throw new Error('UNEXPECTED_PHONE'); },
    requestPayment: () => { calls.payments += 1; throw new Error('UNEXPECTED_PAYMENT'); },
    stopPullDownRefresh() {},
    cloud: {
      init: () => { calls.cloudInit += 1; throw new Error('UNEXPECTED_CLOUD_INIT'); },
      callFunction: async () => { calls.cloud += 1; throw new Error('SYNTHETIC_CLOUD_UNAVAILABLE'); },
    },
  };
  delete require.cache[require.resolve('../miniprogram/services/api')];
  api = require('../miniprogram/services/api');
});

function page(name) {
  const filename = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: createRequire(filename), Page: (value) => { definition = value; },
    wx: global.wx, getApp: () => ({ globalData: { statusBarHeight: 24 } }),
    getCurrentPages: () => [{}], console, Date, setTimeout, clearTimeout,
  }, { filename });
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(values) {
      for (const [key, value] of Object.entries(values)) {
        const fields = key.split('.');
        let current = this.data;
        for (const field of fields.slice(0, -1)) current = current[field];
        current[fields.at(-1)] = value;
      }
    },
  };
}
async function signIn() {
  const originalCall = global.wx.cloud.callFunction;
  const originalEnv = runtime.cloudEnv;
  runtime.cloudEnv = 'synthetic-login-env';
  global.wx.cloud.callFunction = async (payload) => {
    calls.cloud += 1;
    assert.equal(payload.name, 'phoneLogin');
    return { result: { code: 0, userInfo: { _id: 'synthetic-page-user', role: 'user', houses: [], points: 0 } } };
  };
  try {
    await api.loginWithPhone('synthetic-authorized-phone-code');
    assert.equal((await api.getProfile()).authenticated, true);
    assert.equal((await api.getProfile())._id, 'synthetic-page-user');
  } finally {
    global.wx.cloud.callFunction = originalCall;
    runtime.cloudEnv = originalEnv;
  }
  assert.equal(calls.cloud, 1, 'one explicit synthetic login preparation');
  calls.cloud = 0;
}

function visibleCards(listPage) { return Array.from(listPage.data.columns).flat(); }
function assertNoExternalEffects() {
  assert.equal(calls.cloud, 0);
  assert.equal(calls.cloudInit, 0);
  assert.equal(calls.payments, 0);
  assert.equal(calls.phones, 0);
}
function template(name) {
  return fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages', name, 'index.wxml'), 'utf8');
}
// Evaluate each actual WXML currency-unit visibility binding against the page's
// real view-model. This is a binding contract check, not a WeChat compiler claim.
function visibleCurrencyUnits(markup, scope) {
  const nodes = [...markup.matchAll(/<text\b([^>]*)>元\/月<\/text>/g)];
  assert.ok(nodes.length > 0, 'the currency assertions must inspect real template nodes');
  return nodes.filter(([, attrs]) => {
    const condition = attrs.match(/wx:if="{{([^}]+)}}"/);
    return !condition || vm.runInNewContext(condition[1], scope) === true;
  }).length;
}

test('life consumes the real preset API and displays all 232 public single rooms', async () => {
  const life = page('life');
  await life.loadHouses();
  const rows = visibleCards(life);
  assert.equal(life.data.error, '');
  assert.equal(life.data.total, 232);
  assert.equal(rows.length, 232, 'the page must not silently stop at its initial pageSize 100');
  assert.equal(life.data.isTestPreset, true);
  assert.equal(life.data.community, '栖山苑');
  const expected = [];
  for (let floor = 2; floor <= 9; floor++) {
    for (let slot = 1; slot <= 29; slot++) expected.push(`qsy-test-v1-room-${floor * 100 + slot}`);
  }
  assert.deepEqual(new Set(rows.map((room) => room.id)), new Set(expected));
  for (const room of rows) {
    assert.equal(room.price, null);
    assert.equal(room.area, null);
    assert.equal(room.priceText, '待配置');
    assert.equal(room.areaText, '待配置');
    assert.equal(room.rooms, '单间');
    assert.equal(room.hasPrice, false);
    assert.equal(room.isTestPreset, true);
    assert.equal(room.canBook, false);
  }
  assertNoExternalEffects();
});

test('life search uses the actual preset rows; 929 is visible and 102 is absent', async () => {
  const life = page('life');
  await life.loadHouses();
  life.onSearch({ detail: { value: '929' } });
  assert.equal(visibleCards(life).length, 1);
  assert.equal(visibleCards(life)[0].id, 'qsy-test-v1-room-929');
  life.onSearch({ detail: { value: '102' } });
  assert.equal(visibleCards(life).length, 0);
  assert.equal(life.data.empty, true);
  assertNoExternalEffects();
});

test('unknown rent is not treated as zero by the list price filter', async () => {
  const life = page('life');
  life.data.filters.price = 'low';
  await life.loadHouses();
  assert.equal(visibleCards(life).length, 0);
  assert.equal(life.data.total, 0);
  assert.equal(life.data.empty, true);
  assert.equal(life.data.isTestPreset, true, 'empty filtered results retain their test-source label');
  assertNoExternalEffects();
});

test('rental consumes real getHouse/recommendation data with unknown values intact', async () => {
  const rental = page('rental');
  rental.houseId = '201';
  await rental.load();
  const room = rental.data.house;
  assert.ok(room);
  assert.equal(room.id, 'qsy-test-v1-room-201');
  assert.equal(room.price, null);
  assert.equal(room.area, null);
  assert.equal(room.priceText, '待配置');
  assert.equal(room.areaText, '待配置');
  assert.equal(room.depositText, '待配置');
  assert.equal(room.agencyFee, '待配置');
  assert.equal(room.rooms, '单间');
  assert.equal(room.floorText, '2层');
  assert.equal(room.isTestPreset, true);
  assert.equal(room.isPublic, false, 'hidden floor rules do not misuse the public-facility flag');
  assert.equal(room.canBook, false);
  assert.equal(room.hasPrice, false);
  assert.equal(rental.data.recommendations.length, 5);
  for (const recommendation of rental.data.recommendations) {
    assert.notEqual(recommendation.id, room.id);
    assert.equal(recommendation.isTestPreset, true);
    assert.equal(recommendation.canBook, false);
    assert.equal(recommendation.price, null);
    assert.equal(recommendation.area, null);
  }
  assertNoExternalEffects();
});

test('last-floor last room resolves through the actual page/API path', async () => {
  const rental = page('rental');
  rental.houseId = 'QSY-TEST-929';
  await rental.load();
  assert.equal(rental.data.house.id, 'qsy-test-v1-room-929');
  assert.equal(rental.data.house.floorText, '9层');
  assert.equal(rental.data.house.rooms, '单间');
  assertNoExternalEffects();
});

test('all first-floor rooms reject all supported public identifier forms', async () => {
  for (let room = 101; room <= 110; room++) {
    for (const id of [String(room), `qsy-test-v1-room-${room}`, `QSY-TEST-${room}`]) {
      assert.equal(await api.getHouse(id), null, `first-floor public lookup must reject ${id}`);
      const rental = page('rental');
      rental.houseId = id;
      await rental.load();
      assert.equal(rental.data.house, null);
      assert.equal(rental.data.recommendations.length, 0);
      assert.equal(rental.data.error, '');
    }
  }
  assertNoExternalEffects();
});

test('102 direct navigation clears previously visible details and cannot book', async () => {
  const rental = page('rental');
  rental.houseId = '201';
  await rental.load();
  assert.ok(rental.data.house);
  rental.houseId = '102';
  await rental.load();
  assert.equal(rental.data.house, null);
  assert.equal(rental.data.recommendations.length, 0);
  assert.equal(rental.data.galleryImages.length, 0);
  await rental.openAppointment();
  await rental.saveAppointment({ detail: { value: {} } });
  assert.equal(rental.data.appointmentOpen, false);
  assert.equal(storageWrites.length, 0);
  assertNoExternalEffects();
});

test('anonymous preset browsing stays public but identity actions uniformly prompt before business rules', async () => {
  const rental = page('rental');
  rental.houseId = '201';
  await rental.load();
  assert.ok(rental.data.house);
  assert.equal(await api.getProfile(), null);
  await rental.openAppointment();
  await rental.saveAppointment({ detail: { value: {} } });
  await rental.contactPhone();
  await rental.consult();
  assert.equal(calls.modals.length, 4);
  assert.ok(calls.modals.every((item) => item.title === '请先登录'));
  assert.equal(calls.toasts.length, 0, 'anonymous actions must not bypass the common login prompt for an unavailable-service message');
  assert.equal(calls.navigation.length, 0);
  assert.equal(storageWrites.length, 0);
  assertNoExternalEffects();
});

test('authenticated preset appointment and direct-submit handlers still cannot persist or send bookings', async () => {
  await signIn();
  const rental = page('rental');
  rental.houseId = '201';
  await rental.load();
  await rental.openAppointment();
  assert.equal(rental.data.appointmentOpen, false);
  rental.data.appointmentDate = '2099-01-01';
  rental.data.appointmentTime = '12:00';
  await rental.saveAppointment({ detail: { value: { name: '合成测试', phone: '13800000000', note: 'synthetic' } } });
  await rental.contactPhone();
  await rental.consult();
  assert.equal(storageWrites.length, 0);
  assert.equal(calls.navigation.length, 0);
  assert.equal(rental.data.appointmentOpen, false);
  assert.ok(calls.toasts.some((item) => item.title.includes('测试房源')));
  assert.equal(calls.modals.filter((item) => item.title === '请先登录').length, 0, 'business restriction is tested after a real synthetic login');
  assertNoExternalEffects();
});

test('actual list/detail WXML bindings hide currency units for pending values', async () => {
  const life = page('life');
  await life.loadHouses();
  const rental = page('rental');
  rental.houseId = '201';
  await rental.load();
  assert.equal(visibleCurrencyUnits(template('life'), { house: visibleCards(life)[0] }), 0);
  assert.equal(visibleCurrencyUnits(template('rental'), { house: rental.data.house, item: rental.data.recommendations[0] }), 0);
  assert.match(template('life'), /wx:if="{{isTestPreset}}"[^>]*>栖山苑测试基准/);
  assert.match(template('rental'), /wx:if="{{house\.isTestPreset}}"[^>]*>栖山苑测试基准/);
  assert.match(template('rental'), /disabled="{{!house\.canBook}}"[^>]*bindtap="openAppointment"/);
  assertNoExternalEffects();
});

test('without the explicit flag live failures remain errors, never preset fallback', async () => {
  delete runtime.testPropertyPreset;
  runtime.cloudEnv = 'synthetic-unavailable-env';
  const life = page('life');
  await life.loadHouses();
  assert.ok(life.data.error);
  assert.equal(visibleCards(life).length, 0);
  assert.equal(life.data.isTestPreset, false);
  const rental = page('rental');
  rental.houseId = '201';
  await rental.load();
  assert.ok(rental.data.error);
  assert.equal(rental.data.house, null);
  assert.equal(calls.cloud, 2);
  assert.equal(calls.payments, 0);
  assert.equal(calls.phones, 0);
});

test('turning the preset off cannot revive cached preset cards after a live failure', async () => {
  const life = page('life');
  await life.loadHouses();
  const rental = page('rental');
  rental.houseId = '201';
  await rental.load();
  assert.equal(visibleCards(life).length, 232);
  assert.ok(rental.data.house);
  delete runtime.testPropertyPreset;
  runtime.cloudEnv = 'synthetic-unavailable-env';
  await life.loadHouses();
  life.onSearch({ detail: { value: '' } });
  await rental.load();
  assert.ok(life.data.error);
  assert.equal(visibleCards(life).length, 0);
  assert.equal(life.data.isTestPreset, false);
  assert.equal(life.data.total, 0);
  assert.ok(rental.data.error);
  assert.equal(rental.data.house, null);
  assert.equal(rental.data.recommendations.length, 0);
  assert.equal(calls.cloud, 2);
  assert.equal(calls.payments, 0);
});

test('a similar but unapproved flag cannot activate the preset UI', async () => {
  runtime.testPropertyPreset = 'qishanyuan-test-v2';
  const life = page('life');
  await life.loadHouses();
  assert.ok(life.data.error);
  assert.equal(life.data.isTestPreset, false);
  assert.equal(visibleCards(life).length, 0);
  assertNoExternalEffects();
});

test('demo protection remains separate even when the test flag is present', async () => {
  runtime.mode = 'demo';
  const life = page('life');
  await life.loadHouses();
  assert.ok(visibleCards(life).length > 0);
  assert.equal(life.data.isTestPreset, false);
  assert.ok(visibleCards(life).every((room) => room.isTestPreset === false));
  assert.equal(await api.getHouse('qsy-test-v1-room-201'), null);
  assertNoExternalEffects();
});

test('ordinary live room prices, area and appointment availability keep their behaviour', async () => {
  await signIn();
  delete runtime.testPropertyPreset;
  runtime.cloudEnv = 'synthetic-env';
  global.wx.cloud.callFunction = async () => {
    calls.cloud += 1;
    return { result: { code: 0, data: { houses: [{ id: 'live-room', title: '合成普通房源', price: 2200, area: 35, isPublic: false }], total: 1 } } };
  };
  const rental = page('rental');
  rental.houseId = 'live-room';
  await rental.load();
  assert.equal(rental.data.house.priceText, '2200');
  assert.equal(rental.data.house.areaText, '35㎡');
  assert.equal(rental.data.house.hasPrice, true);
  assert.equal(rental.data.house.canBook, true);
  assert.equal(rental.data.house.isTestPreset, false);
  assert.ok(visibleCurrencyUnits(template('rental'), { house: rental.data.house, item: rental.data.house }) > 0);
  await rental.openAppointment();
  assert.equal(rental.data.appointmentOpen, true);
  assert.equal(calls.payments, 0);
  assert.equal(calls.phones, 0);
});
