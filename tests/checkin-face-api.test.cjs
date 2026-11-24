'use strict';

/**
 * B05 / §6 — API 适配层合成测试。
 *
 * 目的：证伪“客户端可以提交 approved/testMode/房号/租期/设备字段”以及
 * “云端失败后前端静默降级成功”的实现。所有调用都走 wx.cloud.callFunction 替身，
 * 不连接真实云环境，不代表真机通过。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const API_FILE = path.join(ROOT, 'miniprogram/services/api.js');

/** 在隔离作用域内加载 CJS 页面/服务，只注入显式依赖，避免真实 wx 环境。 */
function loadCjs(filename, { requires = {}, globals = {} } = {}) {
  const source = fs.readFileSync(filename, 'utf8');
  const module = { exports: {} };
  const customRequire = (id) => Object.prototype.hasOwnProperty.call(requires, id) ? requires[id] : require(id);
  const names = [...Object.keys(globals), 'require', 'module', 'exports'];
  const values = [...Object.values(globals), customRequire, module, module.exports];
  const wrapper = vm.runInThisContext(`(function (${names.join(', ')}) {\n${source}\n})`, { filename });
  wrapper(...values);
  return module.exports;
}

function fixture({ result = { code: 0, data: { ok: 1 }, msg: '' } } = {}) {
  const calls = [];
  const uploads = [];
  const wx = {
    cloud: {
      callFunction: async (payload) => { calls.push(payload); return { result }; },
      uploadFile: async (payload) => { uploads.push(payload); return { fileID: 'cloud://synthetic/photo.jpg' }; },
    },
    showToast: () => {},
    navigateTo: () => {},
    navigateBack: () => {},
    stopPullDownRefresh: () => {},
  };
  const runtime = { mode: 'live', cloudEnv: 'synthetic-env', allowDeviceOperations: false, checkinFaceTestEntry: true };
  const demo = { houses: [], feed: [], locks: [], records: [], conversations: [], profile: {}, family: [], property: {}, meter: {} };
  const api = loadCjs(API_FILE, {
    requires: { '../config/runtime': runtime, './demo': demo },
    globals: { wx },
  });
  return { api, calls, uploads, wx, runtime };
}

const FORBIDDEN_FIELDS = [
  'approved', 'testMode', 'mode', 'validityMode', 'roomNo', 'roomId', 'houseId',
  'doorNo', 'employeeNo', 'validFrom', 'validTo', 'status', 'openid',
  'password', 'pin', 'privateKey', 'origin', 'workerToken',
  'leaseRevision', 'configRevision', 'deviceKey', 'siteVerification',
];

const CASES = [
  { name: 'getCheckinFaceConfig', fn: 'getCheckinFaceConfig', input: {}, expected: { action: 'getConfig' } },
  { name: 'applyTestCheckin', fn: 'applyTestCheckin', input: { applicationVersion: 'test-v1' }, expected: { action: 'applyCheckin', applicationVersion: 'test-v1' } },
  { name: 'createFaceTask', fn: 'createFaceTask', input: { applicationId: 'app-1', fileId: 'test-face/env/openid/app-1/photo.jpg', consent: true }, expected: { action: 'createFaceTask', applicationId: 'app-1', fileId: 'test-face/env/openid/app-1/photo.jpg', consent: true } },
  { name: 'getFaceTask', fn: 'getFaceTask', input: { applicationId: 'app-1' }, expected: { action: 'getMyTask', applicationId: 'app-1' } },
];

test('五个新 API 都只下发精确白名单载荷', async () => {
  for (const item of CASES) {
    const { api, calls } = fixture();
    const data = await api[item.fn](item.input);
    assert.equal(calls.length, 1, `${item.name} 必须调用云端一次`);
    assert.equal(calls[0].name, 'checkinFaceTest');
    assert.deepEqual(calls[0].data, item.expected, `${item.name} 下发字段必须精确`);
    assert.deepEqual(data, { ok: 1 });
  }
  const { api, calls, uploads } = fixture();
  const cloudPath = 'test-face/synthetic-env/openid/app-1/photo.jpg';
  const fileId = await api.uploadTestFace({ applicationId: 'app-1', cloudPath, filePath: '/tmp/photo.jpg' });
  assert.equal(fileId, 'cloud://synthetic/photo.jpg');
  assert.deepEqual(calls, [], 'uploadTestFace 不得调用云函数之外的 action');
  assert.deepEqual(uploads, [{ cloudPath, filePath: '/tmp/photo.jpg', config: { env: 'synthetic-env' } }]);
});

test('注入服务端字段时五个函数在云端调用前本地拒绝（调用计数不变）', async () => {
  for (const item of [...CASES, { name: 'uploadTestFace', fn: 'uploadTestFace', input: { applicationId: 'app-1', cloudPath: 'test-face/env/openid/app-1/p.jpg', filePath: '/tmp/p.jpg' } }]) {
    for (const field of FORBIDDEN_FIELDS) {
      const { api, calls, uploads } = fixture();
      await assert.rejects(
        () => api[item.fn]({ ...item.input, [field]: 'forged' }),
        (error) => /由服务端决定，客户端禁止提交|不支持的字段/.test(error.message),
        `${item.name} 必须拒绝字段 ${field}`,
      );
      assert.equal(calls.length, 0, `${item.name}/${field} 不得下发云端`);
      assert.equal(uploads.length, 0, `${item.name}/${field} 不得触发上传`);
    }
  }
});

test('consent 必须严格等于 true，不是真值即可', async () => {
  for (const consent of [false, 'true', 1, {}, undefined, null]) {
    const { api, calls } = fixture();
    await assert.rejects(() => api.createFaceTask({ applicationId: 'app-1', fileId: 'test-face/e/o/a/p.jpg', consent }), /本人确认照片用途/);
    assert.equal(calls.length, 0, `consent=${String(consent)} 不得下发云端`);
  }
  const { api, calls } = fixture();
  await api.createFaceTask({ applicationId: 'app-1', fileId: 'test-face/e/o/a/p.jpg', consent: true });
  assert.equal(calls.length, 1);
});

test('uploadTestFace 只接受服务端下发的 test-face/ 前缀，页面不拼接路径', async () => {
  const { api, uploads } = fixture();
  for (const cloudPath of ['photos/photo.jpg', '/test-face/e/o/a/p.jpg', 123, undefined]) {
    await assert.rejects(() => api.uploadTestFace({ applicationId: 'a', cloudPath, filePath: '/tmp/p.jpg' }), /上传路径必须由服务端下发/);
  }
  assert.equal(uploads.length, 0);
  const serverPath = 'test-face/synthetic-env/openid/app-1/sub/photo.jpg';
  await api.uploadTestFace({ applicationId: 'app-1', cloudPath: serverPath, filePath: '/tmp/p.jpg' });
  assert.equal(uploads[0].cloudPath, serverPath, '原样透传服务端路径，不做拼接');
});

test('云端 code!==0 一律抛错，绝不返回 data 降级', async () => {
  const { api } = fixture({ result: { code: 4103, data: { result: 'auto_approved' }, msg: 'TEST_DISABLED' } });
  await assert.rejects(() => api.applyTestCheckin({ applicationVersion: 'test-v1' }), /TEST_DISABLED/);
  for (const fn of ['getCheckinFaceConfig', 'getFaceTask']) {
    const failed = fixture({ result: { code: 9001, data: { configured: true }, msg: '服务端失败' } });
    await assert.rejects(() => failed.api[fn](fn === 'getFaceTask' ? { applicationId: 'app-1' } : {}), /服务端失败/);
  }
  const empty = fixture({ result: null });
  await assert.rejects(() => empty.api.getCheckinFaceConfig(), /服务返回异常/);
});

test('getFaceTask 同时支持字符串与对象入参，但仍拒绝服务端字段', async () => {
  const { api, calls } = fixture();
  await api.getFaceTask('app-1');
  assert.deepEqual(calls[0].data, { action: 'getMyTask', applicationId: 'app-1' });
  await assert.rejects(() => api.getFaceTask({ applicationId: 'app-1', status: 'DEVICE_CONFIRMED' }), /禁止提交/);
  assert.equal(calls.length, 1);
});
