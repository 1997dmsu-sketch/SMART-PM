'use strict';
const { test, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const guard = require('./support/d-network-guard.cjs');
const ROOT = path.resolve(__dirname, '..');
const REVIEW = ['APPLICATION_FORBIDDEN', 'APPLICATION_NOT_APPROVED', 'ACCOUNT_NOT_ALLOWED'];
const CONFIG = {
  enabled: true, configured: true, accountEligible: true, storageNamespaceConfigured: true,
  applicationVersion: 'private-version-A', room: { displayNo: '102', projectName: 'private-project-A' },
  lease: { status: 'active', startDate: '2026-12-01', endDate: '2026-12-05' },
};
const TASK = {
  status: 'NOT_FOUND', uploadEligible: true, cloudPath: 'test-face/private-A/app-A/photo.jpg',
  room: CONFIG.room, lease: CONFIG.lease,
};
let beforeNetwork;
before(() => guard.assertLoadTimeClean());
beforeEach(() => { beforeNetwork = guard.snapshot(); });
afterEach(() => guard.assertNoViolations(beforeNetwork, 'action-login checkin pages'));

function evaluate(file, requires, globals) {
  const module = { exports: {} };
  const names = Object.keys(globals);
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const loader = vm.runInThisContext(`(function(require,module,exports,${names.join(',')}){\n${code}\n})`, { filename: file });
  loader((id) => {
    if (!Object.hasOwn(requires, id)) throw new Error(`UNDECLARED_TEST_REQUIRE ${id}`);
    return requires[id];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function flush() { await new Promise((resolve) => setImmediate(resolve)); }
function fixture(pageName, options = {}) {
  let profile = Object.hasOwn(options, 'profile') ? options.profile : null;
  let picker = null;
  let authEpoch = 1;
  const calls = { config: 0, apply: 0, task: 0, choose: 0, upload: 0, create: 0, appSnapshot: 0, interval: 0, clearInterval: 0 };
  const dialogs = [], navigation = [], payloads = [];
  const wx = {
    showModal(arg) { dialogs.push(arg); if (!options.deferDialog) arg.success({ confirm: true }); },
    showToast() {}, switchTab(arg) { navigation.push(arg); }, navigateTo(arg) { navigation.push(arg); },
    navigateBack() {}, stopPullDownRefresh() {},
    chooseMedia(arg) {
      calls.choose += 1;
      if (options.deferPicker) picker = arg;
      else arg.success({ tempFilePaths: ['/tmp/synthetic-private-photo.jpg'] });
    },
  };
  const api = {
    isDemo: () => false,
    getProfile: async () => profile,
    isAuthenticated: () => !!profile && profile.authenticated === true && typeof profile._id === 'string' && profile._id.length > 0 && !/[\x00-\x20\x7f/\\]/.test(profile._id),
    getLoginEpoch: () => api.isAuthenticated() ? authEpoch : null,
    isReviewChannelCode: (code) => REVIEW.includes(code),
    getCheckinFaceConfig: async () => { calls.config += 1; return structuredClone(CONFIG); },
    applyTestCheckin: async (input) => { calls.apply += 1; payloads.push(input); return { result: 'auto_approved', applicationId: 'app-A' }; },
    getFaceTask: async () => { calls.task += 1; return structuredClone(TASK); },
    uploadTestFace: async (input) => { calls.upload += 1; payloads.push(input); return 'cloud://synthetic/private-photo.jpg'; },
    createFaceTask: async (input) => { calls.create += 1; payloads.push(input); return { status: 'PHOTO_RECEIVED' }; },
  };
  if (options.noGetProfile) delete api.getProfile;
  if (options.overrides) Object.assign(api, options.overrides(calls));
  const helper = evaluate('miniprogram/utils/require-login.js', {}, { wx });
  let definition;
  evaluate(`miniprogram/pages/${pageName}/index.js`, {
    '../../services/api': api,
    '../../utils/layout': { getNavigationLayout: () => ({ statusBarHeight: 20, navHeight: 44, navSideWidth: 104 }) },
    '../../utils/require-login': helper,
  }, {
    wx, Page(value) { definition = value; },
    getApp() { calls.appSnapshot += 1; return { globalData: { checkinApplicationId: 'private-app-global-A' } }; },
    setInterval() { calls.interval += 1; return calls.interval; },
    clearInterval() { calls.clearInterval += 1; },
  });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data) });
  page.setData = (patch, done) => { Object.assign(page.data, patch); if (done) done(); };
  return { page, api, calls, dialogs, navigation, payloads, setProfile(value) { profile = value; authEpoch += 1; }, pick() { picker.success({ tempFilePaths: ['/tmp/synthetic-private-photo.jpg'] }); } };
}
function logged() { return { _id: 'synthetic-account-A', authenticated: true }; }
function assertGuestCleared(page, kind) {
  const serialized = JSON.stringify(page.data);
  assert.equal(serialized.includes('private-'), false, 'previous private room/lease/version/path/result must be cleared');
  if (kind === 'checkin') {
    assert.equal(page.data.eligible, false); assert.equal(page.data.applied, false);
    assert.equal(page.data.primaryConfirmed, false); assert.equal(page.data.result, null);
  } else {
    assert.equal(page._applicationId, ''); assert.equal(page.data.consentConfirmed, false);
    assert.equal(page.data.canUpload, false); assert.equal(page.data.cloudPathReady, false);
    assert.equal(page.data.showUpload, false);
  }
}
function seedPrivate(page, kind) {
  if (kind === 'checkin') page.setData({ config: structuredClone(CONFIG), eligible: true, leaseConfigured: true, primaryConfirmed: true, applied: true, result: { applicationId: 'private-app-A' } });
  else {
    page._applicationId = 'private-app-A';
    page.setData({ task: structuredClone(TASK), consentConfirmed: true, cloudPathReady: true, showUpload: true, canUpload: true, projectBuilding: 'private-project-A', leaseText: 'private-lease-A' });
  }
}

test('guest直接打开测试入住：先提示登录，无配置读取并清除私密状态', async () => {
  const f = fixture('checkin');
  seedPrivate(f.page, 'checkin');
  f.page.onLoad();
  await flush();
  assert.equal(f.calls.config, 0); assert.equal(f.calls.apply, 0);
  assert.equal(f.dialogs.length, 1);
  assert.deepEqual(f.navigation, [{ url: '/pages/profile/index' }]);
  assertGuestCleared(f.page, 'checkin');
});

test('guest伪造已批准/可申请视图也不能提交或进入人脸页', async () => {
  for (const action of ['submit', 'goFaceEnroll']) {
    const f = fixture('checkin'); seedPrivate(f.page, 'checkin');
    if (action === 'submit') f.page.setData({ applied: false });
    await f.page[action]();
    assert.equal(f.calls.apply, 0); assert.equal(f.calls.config, 0);
    assert.ok(f.navigation.every((item) => item.url === '/pages/profile/index'));
    assertGuestCleared(f.page, 'checkin');
  }
});

test('guest人脸深链不读取getApp申请快照、不查任务、不建立轮询', async () => {
  const f = fixture('face-enroll'); seedPrivate(f.page, 'face');
  await f.page.onLoad({ applicationId: 'private-route-app' });
  assert.equal(f.calls.appSnapshot, 0); assert.equal(f.calls.task, 0);
  assert.equal(f.calls.config, 0); assert.equal(f.calls.interval, 0);
  assert.deepEqual(f.navigation, [{ url: '/pages/profile/index' }]);
  assertGuestCleared(f.page, 'face');
});

test('guest查询/选图上传均零云调用、零选择器，清空旧cloudPath并停轮询', async () => {
  for (const action of ['refreshTask', 'chooseAndUpload', 'retry']) {
    const f = fixture('face-enroll'); seedPrivate(f.page, 'face');
    f.page._timer = 3;
    await f.page[action]();
    assert.deepEqual([f.calls.config, f.calls.task, f.calls.choose, f.calls.upload, f.calls.create], [0, 0, 0, 0, 0]);
    assert.equal(f.calls.clearInterval, 1);
    assertGuestCleared(f.page, 'face');
  }
});

test('无getProfile、伪认证、坏身份或本地身份读取异常一律失败关闭', async () => {
  const variants = [
    { noGetProfile: true }, { profile: {} }, { profile: { _id: 'synthetic-account-A', authenticated: false } },
    { profile: { authenticated: true } }, { profile: { _id: 'bad/id', authenticated: true } },
    { overrides: () => ({ getProfile: async () => { throw new Error('synthetic unavailable'); } }) },
  ];
  for (const options of variants) {
    for (const name of ['checkin', 'face-enroll']) {
      const f = fixture(name, options);
      if (name === 'checkin') await f.page.loadConfig();
      else { f.page._applicationId = 'private-app'; await f.page.refreshTask(); }
      assert.equal(f.calls.config, 0); assert.equal(f.calls.task, 0);
      assert.ok(f.dialogs.length > 0);
      assertGuestCleared(f.page, name === 'checkin' ? 'checkin' : 'face');
    }
  }
});

test('登录提示尚未关闭时，之前的私密视图已经清空', async () => {
  const f = fixture('checkin', { deferDialog: true }); seedPrivate(f.page, 'checkin');
  const pending = f.page.loadConfig();
  await flush();
  assert.equal(f.dialogs.length, 1);
  assertGuestCleared(f.page, 'checkin');
  f.dialogs[0].success({ confirm: false });
  await pending;
  assert.equal(f.calls.config, 0);
});

test('已登录读配置/申请/导航保留原版本和审批门禁', async () => {
  const f = fixture('checkin', { profile: logged() });
  await f.page.loadConfig();
  assert.equal(f.calls.config, 1);
  await f.page.submit();
  assert.equal(f.calls.apply, 0, '原本人确认门禁保留');
  f.page.onPrimaryChange({ detail: { value: ['primary'] } });
  await Promise.all([f.page.submit(), f.page.submit(), f.page.submit()]);
  assert.equal(f.calls.apply, 1);
  assert.deepEqual(f.payloads, [{ applicationVersion: CONFIG.applicationVersion }]);
  await f.page.goFaceEnroll();
  assert.deepEqual(f.navigation, [{ url: '/pages/face-enroll/index?applicationId=app-A' }]);
});

test('已登录人脸流程仍须用途确认且只上传/创建一次', async () => {
  const f = fixture('face-enroll', { profile: logged() });
  f.page._applicationId = 'app-A';
  await f.page.refreshTask();
  await f.page.chooseAndUpload();
  assert.equal(f.calls.choose, 0);
  f.page.onConsentChange({ detail: { value: ['consent'] } });
  await Promise.all([f.page.chooseAndUpload(), f.page.chooseAndUpload(), f.page.chooseAndUpload()]);
  assert.equal(f.calls.choose, 1); assert.equal(f.calls.upload, 1); assert.equal(f.calls.create, 1);
  assert.deepEqual(f.payloads[0], { applicationId: 'app-A', cloudPath: TASK.cloudPath, filePath: '/tmp/synthetic-private-photo.jpg' });
  assert.deepEqual(f.payloads[1], { applicationId: 'app-A', fileId: 'cloud://synthetic/private-photo.jpg', consent: true });
});

test('配置和申请迟到响应在退出登录后均不得回填私密快照', async () => {
  for (const phase of ['config', 'apply']) {
    const delayed = deferred();
    const f = fixture('checkin', { profile: logged(), overrides: (calls) => phase === 'config'
      ? { getCheckinFaceConfig: async () => { calls.config += 1; return delayed.promise; } }
      : { applyTestCheckin: async () => { calls.apply += 1; return delayed.promise; } } });
    if (phase === 'apply') { await f.page.loadConfig(); f.page.setData({ primaryConfirmed: true }); }
    const request = phase === 'config' ? f.page.loadConfig() : f.page.submit();
    await flush(); f.setProfile(null);
    delayed.resolve(phase === 'config' ? structuredClone(CONFIG) : { result: 'auto_approved', applicationId: 'private-app-A' });
    await request;
    assertGuestCleared(f.page, 'checkin');
  }
});

test('任务迟到响应遇退出或换账号均丢弃，不显示上一账号的房租/cloudPath', async () => {
  for (const next of [null, { _id: 'synthetic-account-B', authenticated: true }]) {
    const delayed = deferred();
    const f = fixture('face-enroll', { profile: logged(), overrides: (calls) => ({ getFaceTask: async () => { calls.task += 1; return delayed.promise; } }) });
    f.page._applicationId = 'app-A';
    const request = f.page.refreshTask();
    await flush(); f.setProfile(next); delayed.resolve(structuredClone(TASK));
    await request;
    assertGuestCleared(f.page, 'face');
    assert.equal(f.calls.upload, 0); assert.equal(f.calls.create, 0);
  }
});

test('资格读取期间退出：尚未打开照片选择器，更不会上传', async () => {
  const delayed = deferred();
  const f = fixture('face-enroll', { profile: logged(), overrides: (calls) => ({ getCheckinFaceConfig: async () => { calls.config += 1; return delayed.promise; } }) });
  f.page._applicationId = 'app-A'; await f.page.refreshTask();
  f.page.onConsentChange({ detail: { value: ['consent'] } });
  const request = f.page.chooseAndUpload();
  await flush(); f.setProfile(null); delayed.resolve(structuredClone(CONFIG)); await request;
  assert.deepEqual([f.calls.choose, f.calls.upload, f.calls.create], [0, 0, 0]);
  assertGuestCleared(f.page, 'face');
});

test('选图期间退出：回调文件不上传，也不创建任务', async () => {
  const f = fixture('face-enroll', { profile: logged(), deferPicker: true });
  f.page._applicationId = 'app-A'; await f.page.refreshTask();
  f.page.onConsentChange({ detail: { value: ['consent'] } });
  const request = f.page.chooseAndUpload();
  await flush(); assert.equal(f.calls.choose, 1); f.setProfile(null); f.pick(); await request;
  assert.equal(f.calls.upload, 0); assert.equal(f.calls.create, 0);
  assertGuestCleared(f.page, 'face');
});

test('上传期间退出：保留已发上传调用事实，迟到fileID不再创建任务', async () => {
  const delayed = deferred();
  const f = fixture('face-enroll', { profile: logged(), overrides: (calls) => ({ uploadTestFace: async () => { calls.upload += 1; return delayed.promise; } }) });
  f.page._applicationId = 'app-A'; await f.page.refreshTask();
  f.page.onConsentChange({ detail: { value: ['consent'] } });
  const request = f.page.chooseAndUpload();
  await flush(); assert.equal(f.calls.upload, 1); f.setProfile(null); delayed.resolve('cloud://synthetic/private-photo.jpg'); await request;
  assert.equal(f.calls.create, 0); assertGuestCleared(f.page, 'face');
});

test('返回页面时已退出，onShow重新验证并清除已显示的本人数据', async () => {
  for (const kind of ['checkin', 'face-enroll']) {
    const f = fixture(kind, { profile: logged() });
    if (kind === 'checkin') await f.page.loadConfig();
    else { f.page._applicationId = 'app-A'; await f.page.refreshTask(); }
    f.setProfile(null); await f.page.onShow();
    assertGuestCleared(f.page, kind === 'checkin' ? 'checkin' : 'face');
  }
});

function logoutAfterGate(f, when) {
  const realGate = f.page.loginGate.bind(f.page);
  let scheduled = 0;
  f.page.loginGate = async function (...args) {
    const result = await realGate(...args);
    if (result && scheduled === 0 && when(args)) {
      scheduled += 1;
      // Deliberately between the async gate's return and its caller continuation.
      queueMicrotask(() => f.setProfile(null));
    }
    return result;
  };
  return () => scheduled;
}

test('最终同步门：loginGate返回与caller继续之间微任务退登阻止入住提交/导航和私密回填', async () => {
  for (const phase of ['view', 'submit', 'navigate']) {
    const f = fixture('checkin', { profile: logged() });
    if (phase !== 'view') { await f.page.loadConfig(); f.page.setData({ primaryConfirmed: true }); }
    if (phase === 'navigate') f.page.setData({ applied: true, result: { applicationId: 'private-app-A' } });
    const scheduled = logoutAfterGate(f, (args) => phase === 'view' ? !!args[1] : !args[1]);
    if (phase === 'view') await f.page.loadConfig();
    if (phase === 'submit') await f.page.submit();
    if (phase === 'navigate') await f.page.goFaceEnroll();
    assert.equal(scheduled(), 1, phase);
    assert.equal(f.calls.apply, 0, phase);
    assert.equal(f.navigation.length, 0, phase);
    assertGuestCleared(f.page, 'checkin');
  }
});

test('最终同步门：资格gate返回后的微任务退登不得打开选图器', async () => {
  const f = fixture('face-enroll', { profile: logged() });
  f.page._applicationId = 'app-A'; await f.page.refreshTask();
  f.page.onConsentChange({ detail: { value: ['consent'] } });
  const scheduled = logoutAfterGate(f, (args) => !!args[1] && f.calls.config === 1);
  await f.page.chooseAndUpload();
  assert.equal(scheduled(), 1);
  assert.deepEqual([f.calls.choose, f.calls.upload, f.calls.create], [0, 0, 0]);
  assertGuestCleared(f.page, 'face');
});

test('最终同步门：选图/上传返回后的微任务退登阻止下一个副作用', async () => {
  for (const phase of ['upload', 'create']) {
    const f = fixture('face-enroll', { profile: logged() });
    f.page._applicationId = 'app-A'; await f.page.refreshTask();
    f.page.onConsentChange({ detail: { value: ['consent'] } });
    const scheduled = logoutAfterGate(f, (args) => !!args[1] && (phase === 'upload'
      ? f.calls.choose === 1 && f.calls.upload === 0
      : f.calls.upload === 1 && f.calls.create === 0));
    await f.page.chooseAndUpload();
    assert.equal(scheduled(), 1, phase);
    assert.equal(f.calls.choose, 1, phase);
    assert.equal(f.calls.upload, phase === 'upload' ? 0 : 1, phase);
    assert.equal(f.calls.create, 0, phase);
    assertGuestCleared(f.page, 'face');
  }
});

test('最终同步门：任务gate最后返回后的微任务退登不显示私密状态', async () => {
  const f = fixture('face-enroll', { profile: logged() });
  f.page._applicationId = 'app-A';
  const scheduled = logoutAfterGate(f, (args) => !!args[1] && f.calls.task === 1);
  await f.page.refreshTask();
  assert.equal(scheduled(), 1);
  assertGuestCleared(f.page, 'face');
});

test('同一用户退出再登录也变更epoch，旧照片选择回调不可恢复上传', async () => {
  const f = fixture('face-enroll', { profile: logged(), deferPicker: true });
  f.page._applicationId = 'app-A'; await f.page.refreshTask();
  f.page.onConsentChange({ detail: { value: ['consent'] } });
  const pending = f.page.chooseAndUpload();
  await flush(); assert.equal(f.calls.choose, 1);
  f.setProfile(null); f.setProfile(logged());
  f.pick(); await pending;
  assert.equal(f.calls.upload, 0); assert.equal(f.calls.create, 0);
  assertGuestCleared(f.page, 'face');
});

test('缺少同步身份或epoch能力不能由异步profile默认放行', async () => {
  for (const missing of ['isAuthenticated', 'getLoginEpoch']) {
    const f = fixture('checkin', { profile: logged() });
    delete f.api[missing];
    await f.page.loadConfig();
    assert.equal(f.calls.config, 0);
    assertGuestCleared(f.page, 'checkin');
  }
});
