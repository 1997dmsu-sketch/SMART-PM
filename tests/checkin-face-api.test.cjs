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

function fixture({ result = { code: 0, data: { ok: 1 }, msg: '' }, uploadFileID = 'cloud://synthetic/photo.jpg' } = {}) {
  const calls = [];
  const uploads = [];
  const wx = {
    cloud: {
      callFunction: async (payload) => { calls.push(payload); return { result }; },
      uploadFile: async (payload) => { uploads.push(payload); return { fileID: uploadFileID }; },
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

test('非零错误码透传给页面：err.code 必须保留服务端 code（C2 分类依据）', async () => {
  const { api, calls } = fixture({ result: { code: 'TEST_DISABLED', data: null, msg: '测试入住当前未启用' } });
  await assert.rejects(
    () => api.applyTestCheckin({ applicationVersion: 'test-v1' }),
    (err) => err instanceof Error && err.code === 'TEST_DISABLED' && /测试入住当前未启用/.test(err.message),
    'applyTestCheckin 抛错必须携带 code=TEST_DISABLED',
  );
  assert.equal(calls.length, 1, '错误码不改变下发载荷');
  const forbidden = fixture({ result: { code: 'APPLICATION_FORBIDDEN', data: null, msg: '未找到本人申请' } });
  await assert.rejects(
    () => forbidden.api.getFaceTask({ applicationId: 'app-1' }),
    (err) => err.code === 'APPLICATION_FORBIDDEN',
  );
  // 连接类失败无服务端 code，不得伪造 code。
  const dead = fixture({ result: { code: 0, data: {}, msg: '' } });
  dead.wx.cloud.callFunction = async () => { throw new Error('network down'); };
  await assert.rejects(
    () => dead.api.getFaceTask({ applicationId: 'app-1' }),
    (err) => err.code === undefined && /服务连接失败/.test(err.message),
  );
});

test('审核渠道错误码分类是闭式集合：只认申请/账号拒绝码，不吞并任务与配置码', async () => {
  const { api } = fixture();
  assert.equal(typeof api.isReviewChannelCode, 'function', 'api 必须导出 isReviewChannelCode');
  assert.ok(Array.isArray(api.REVIEW_CHANNEL_CODES), 'api 必须导出 REVIEW_CHANNEL_CODES');
  assert.equal(api.REVIEW_CHANNEL_CODES.length, 3, '审核渠道码为闭式集合，大小固定为 3（INTERFACES.md §5 对齐）');
  for (const code of ['APPLICATION_FORBIDDEN', 'APPLICATION_NOT_APPROVED', 'ACCOUNT_NOT_ALLOWED']) {
    assert.equal(api.isReviewChannelCode(code), true, `${code} 属于审核渠道码`);
  }
  // 清单 §5 存在但不属于审核渠道语义、以及 §5 不存在的码，一律不得归类为审核渠道码。
  for (const code of [
    'APPLICATION_NOT_FOUND', 'APPLICATION_INVALID', 'APPLICATION_REVOKED', 'ACCOUNT_REVOKED',
    'APPLICATION_CONFLICT', 'TASK_FORBIDDEN', 'TASK_NOT_FOUND', 'NO_TASK', 'TASK_ALREADY_CLAIMED',
    'TEST_DISABLED', 'VERSION_MISMATCH', 'ROOM_UNCONFIGURED', 'ROOM_NOT_UNIQUE', 'LEASE_UNCONFIGURED',
    'LEASE_EXPIRED', 'INVALIDATED', 'INVALID_FILE_ID', 'FILE_NAMESPACE_MISMATCH',
    'FILE_OWNERSHIP_MISMATCH', 'STORAGE_NAMESPACE_UNCONFIGURED', 'PHOTO_INVALID', 'INVALID_VERSION',
    'INVALID_APPLICATION_ID', 'CLAIM_EXPIRED', 'EXECUTION_INVALIDATED', 'REVISION_CONFLICT',
    'INTERNAL_ERROR', '', 123, null, undefined,
  ]) {
    assert.equal(api.isReviewChannelCode(code), false, `${String(code)} 不得归类为审核渠道码`);
  }
});

test('演示模式不提供入住/人脸成功 fallback，一律拒绝且不调用云端与上传', async () => {
  const { api, calls, uploads, runtime } = fixture();
  runtime.mode = 'demo';
  await assert.rejects(() => api.getCheckinFaceConfig(), /演示模式不会调用云端服务/);
  await assert.rejects(() => api.applyTestCheckin({ applicationVersion: 'test-v1' }), /演示模式不会调用云端服务/);
  await assert.rejects(() => api.createFaceTask({ applicationId: 'app-1', fileId: 'f', consent: true }), /演示模式不会调用云端服务/);
  await assert.rejects(() => api.getFaceTask({ applicationId: 'app-1' }), /演示模式不会调用云端服务/);
  await assert.rejects(
    () => api.uploadTestFace({ applicationId: 'app-1', cloudPath: 'test-face/e/o/a/p.jpg', filePath: '/tmp/p.jpg' }),
    /演示模式不会上传真实人脸照片/,
  );
  assert.equal(calls.length, 0, '演示模式不得调用云端');
  assert.equal(uploads.length, 0, '演示模式不得上传照片');
});

test('上传输出与建任务输入使用同一个 SDK 形状 fileID，原样透传不重造（R01 客户端侧）', async () => {
  const sdkFileId = 'cloud://checkin-env-synthetic.636c-checkin-env-synthetic-1250000000/test-face/synthetic-env/openid/app-1/photo.jpg';
  const { api, calls, uploads } = fixture({ uploadFileID: sdkFileId });
  const fileId = await api.uploadTestFace({
    applicationId: 'app-1',
    cloudPath: 'test-face/synthetic-env/openid/app-1/photo.jpg',
    filePath: '/tmp/photo.jpg',
  });
  assert.equal(fileId, sdkFileId, '返回的必须是 wx.cloud.uploadFile 的原始 fileID');
  assert.equal(typeof fileId, 'string');
  assert.ok(fileId.startsWith('cloud://'), 'fileID 保持微信 SDK 原始形状');
  await api.createFaceTask({ applicationId: 'app-1', fileId, consent: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.fileId, sdkFileId, '下一步输入必须与上传输出为同一字符串');
  assert.ok(!calls[0].data.fileId.startsWith('test-face/'), '不得把 cloud:// fileID 去头成裸路径再提交');
  assert.equal(uploads.length, 1);
});
