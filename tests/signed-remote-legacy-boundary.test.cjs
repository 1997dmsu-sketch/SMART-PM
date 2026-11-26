'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const guard = require('./support/d-network-guard.cjs');
guard.assertLoadTimeClean();
const networkBaseline = guard.snapshot();

function legacy(file, platform, options = {}) {
  const counters = { fetch: 0, writes: 0, configReads: 0 };
  const device = { _id: 'device-doc', deviceId: 'door-selection', platform,
    houseId: options.public ? 'public' : 'synthetic-house', deviceName: 'Synthetic door' };
  if (platform === undefined) delete device.platform;
  const db = { command: { in: (value) => value }, serverDate: () => 1, collection(name) {
    if (name === 'sys_config') counters.configReads += 1;
    const rows = name === 'devices' ? [device]
      : name === 'users' ? [{ _id: 'user', _openid: 'trusted-openid', role: options.admin ? 'admin' : 'user', houses: ['synthetic-house'] }] : [];
    return {
      where() { return this; }, orderBy() { return this; }, async get() { return { data: rows }; },
      doc() { return { async update() { counters.writes += 1; } }; },
      async add() { counters.writes += 1; },
    };
  } };
  const cloud = { init() {}, getWXContext: () => ({ OPENID: 'trusted-openid' }), database: () => db };
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', file, 'index.js'), 'utf8'), {
    exports, require(name) {
      if (name === 'wx-server-sdk') return cloud;
      if (name === 'node-fetch') return async () => { counters.fetch += 1; throw new Error('unexpected legacy transport'); };
      if (name === 'crypto') return crypto;
      throw new Error('unexpected require');
    }, console: { log() {}, warn() {}, error() {} }, Date, URLSearchParams,
  });
  return { run: exports.main, counters };
}

test('legacy unlock rejects Hikvision/unknown platforms even with houses, public or admin privileges', async () => {
  for (const platform of ['hikvision', 'HIKVISION', 'isapi', '', null, 'unknown']) {
    for (const mode of [{}, { public: true }, { admin: true }]) {
      const h = legacy('unlock', platform, mode);
      assert.equal((await h.run({ deviceId: 'door-selection' })).code, 403);
      assert.deepEqual(h.counters, { fetch: 0, writes: 0, configReads: 0 });
    }
  }
  guard.assertNoViolations(networkBaseline);
});

test('legacy device list never exposes a Hikvision door through public/houses/admin shortcuts', async () => {
  for (const platform of ['hikvision', 'HIKVISION', '', null, 'unknown']) {
    const h = legacy('getDevices', platform, { admin: true });
    const result = await h.run({});
    assert.equal(result.code, 0);
    assert.equal(result.data.devices.length, 0);
  }
  for (const platform of [undefined, 'ttlock', 'tuya']) {
    const h = legacy('getDevices', platform);
    assert.equal((await h.run({})).data.devices.length, 1);
  }
  guard.assertNoViolations(networkBaseline);
});
