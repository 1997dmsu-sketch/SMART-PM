'use strict';

/**
 * B05 / §6 — 小程序两页面逻辑合成测试。
 *
 * 通过轻量 Page/wx 注入读取真实页面 JS，断言页面只渲染服务端事实、
 * 不伪造识别结果、不重复提交。此处的页面逻辑通过不代表真机流程通过。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const CHECKIN_JS = path.join(ROOT, 'miniprogram/pages/checkin/index.js');
const FACE_JS = path.join(ROOT, 'miniprogram/pages/face-enroll/index.js');
const PROFILE_JS = path.join(ROOT, 'miniprogram/pages/profile/index.js');

function loadModule(filename, { requires = {}, globals = {} } = {}) {
  const source = fs.readFileSync(filename, 'utf8');
  const module = { exports: {} };
  const customRequire = (id) => Object.prototype.hasOwnProperty.call(requires, id) ? requires[id] : require(id);
  const names = [...Object.keys(globals), 'require', 'module', 'exports'];
  const values = [...Object.values(globals), customRequire, module, module.exports];
  const wrapper = vm.runInThisContext(`(function (${names.join(', ')}) {\n${source}\n})`, { filename });
  wrapper(...values);
  return { exports: module.exports, source };
}

function makeWx({ media = true } = {}) {
  const toasts = [];
  const navigations = [];
  const wx = {
    showToast: (arg) => toasts.push(arg),
    navigateTo: (arg) => navigations.push(arg),
    navigateBack: () => {},
    switchTab: () => {},
    stopPullDownRefresh: () => {},
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ width: 80, height: 32, left: 280, right: 360, top: 24 }),
  };
  if (media) {
    wx.chooseMedia = (arg) => arg.success({ tempFiles: [{ tempFilePath: '/tmp/synthetic-photo.jpg' }], tempFilePaths: ['/tmp/synthetic-photo.jpg'] });
  }
  return { wx, toasts, navigations };
}

function instantiate(config) {
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) });
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch);
    if (typeof callback === 'function') callback();
  };
  return page;
}

function checkinPage(api, wx) {
  let captured;
  loadModule(CHECKIN_JS, {
    requires: { '../../services/api': api, '../../utils/layout': { getNavigationLayout: () => ({ statusBarHeight: 20, navHeight: 44, navSideWidth: 104 }) } },
    globals: { Page: (config) => { captured = config; }, wx },
  });
  return instantiate(captured);
}

function facePage(api, wx) {
  let captured;
  const intervals = [];
  loadModule(FACE_JS, {
    requires: { '../../services/api': api, '../../utils/layout': { getNavigationLayout: () => ({ statusBarHeight: 20, navHeight: 44, navSideWidth: 104 }) } },
    globals: {
      Page: (config) => { captured = config; },
      wx,
      getApp: () => ({ globalData: {} }),
      setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
      clearInterval: () => {},
    },
  });
  return { page: instantiate(captured), intervals };
}

const FULL_CONFIG = {
  enabled: true, configured: true, accountEligible: true, applicationVersion: 'test-v1',
  room: { displayNo: '102', roomId: 'room-stable-1', houseId: 'house-stable-1', projectName: '合成项目', buildingName: '合成楼栋' },
  lease: { status: 'active', startDate: '2026-12-01', endDate: '2026-12-05', validFrom: '2026-12-01T00:00:00', validTo: '2026-12-05T23:59:59', timezone: 'Asia/Shanghai', dailyHours: '24x7' },
};

// onLoad 的顺序缺陷由单独用例守；其余用例显式把 loading 复位后驱动 loadConfig。
async function loadCheckin(page, config = FULL_CONFIG) {
  page.setData({ loading: false });
  const api = page.__api;
  await page.loadConfig();
  return api;
}

test('测试入住 onLoad 必须真正拉取服务端配置（当前实现缺陷守门）', async () => {
  let calls = 0;
  const api = { getCheckinFaceConfig: async () => { calls += 1; return FULL_CONFIG; }, applyTestCheckin: async () => ({}) };
  const { wx } = makeWx();
  const page = checkinPage(api, wx);
  page.onLoad();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1, 'onLoad 必须触发 getCheckinFaceConfig；loading 初值不应把首次加载短路');
  assert.equal(page.data.loading, false);
});

test('enabled/configured/accountEligible 任一不为 true 都禁止申请', async () => {
  for (const field of ['enabled', 'configured', 'accountEligible']) {
    let applyCalls = 0;
    const config = JSON.parse(JSON.stringify(FULL_CONFIG));
    config[field] = false;
    const api = {
      getCheckinFaceConfig: async () => config,
      applyTestCheckin: async () => { applyCalls += 1; return {}; },
    };
    const { wx, toasts } = makeWx();
    const page = checkinPage(api, wx);
    page.setData({ loading: false });
    await page.loadConfig();
    assert.equal(page.data.eligible, false, `${field}=false 时不得显示自动通过`);
    page.setData({ primaryConfirmed: true });
    await page.submit();
    assert.equal(applyCalls, 0, `${field}=false 时不得提交申请`);
    assert.ok(toasts.some((t) => /未开放测试入住自动通过/.test(t.title)));
  }
});

test('租期未配置显示待配置，不提交、不生成默认日期/一年/长期/今天', async () => {
  const source = fs.readFileSync(CHECKIN_JS, 'utf8');
  const wxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/checkin/index.wxml'), 'utf8');
  assert.ok(!/new\s+Date|Date\.now|setFullYear|365|unlimited|autoToday/i.test(source), '页面 JS 不得自造日期或长期规则');
  assert.ok(!/<input|<picker|bindinput/.test(wxml), '页面不得提供可编辑日期/房号控件');
  assert.ok(/待配置/.test(wxml));

  let applyCalls = 0;
  const api = {
    getCheckinFaceConfig: async () => ({ ...FULL_CONFIG, lease: { status: '', startDate: '', endDate: '' } }),
    applyTestCheckin: async () => { applyCalls += 1; return {}; },
  };
  const { wx, toasts } = makeWx();
  const page = checkinPage(api, wx);
  page.setData({ loading: false });
  await page.loadConfig();
  assert.equal(page.data.leaseConfigured, false);
  assert.match(page.data.ineligibleReason, /租期待配置/);
  page.setData({ primaryConfirmed: true });
  await page.submit();
  assert.equal(applyCalls, 0);
  assert.ok(toasts.some((t) => /租期待配置/.test(t.title)));
});

test('房号与租期只读来自服务端，提交载荷只有 applicationVersion；重复点击只提交一次', async () => {
  const payloads = [];
  const api = {
    getCheckinFaceConfig: async () => FULL_CONFIG,
    applyTestCheckin: async (payload) => { payloads.push(payload); await new Promise((r) => setTimeout(r, 5)); return { applicationId: 'app-1', result: 'auto_approved' }; },
  };
  const { wx } = makeWx();
  const page = checkinPage(api, wx);
  page.setData({ loading: false });
  await page.loadConfig();
  assert.deepEqual(page.data.config.room, FULL_CONFIG.room);
  assert.deepEqual(page.data.config.lease, FULL_CONFIG.lease);
  page.setData({ primaryConfirmed: true });
  await Promise.all([page.submit(), page.submit(), page.submit()]);
  assert.equal(payloads.length, 1, 'busy 锁必须阻止重复提交');
  assert.deepEqual(payloads[0], { applicationVersion: 'test-v1' });
  assert.deepEqual(Object.keys(payloads[0]), ['applicationVersion']);
  assert.equal(page.data.applied, true);
});

test('六态文案逐项映射；ready 与 pending-site 都显示待现场刷脸验证', async () => {
  const expected = [
    [{ status: 'NOT_FOUND', cloudPath: 'test-face/e/o/a/p.jpg' }, '尚未上传照片'],
    [{ status: 'PHOTO_RECEIVED' }, '照片收件'],
    [{ status: 'QUEUED_FOR_DISPATCH' }, '等待下发'],
    [{ status: 'DEVICE_PROCESSING' }, '设备处理中'],
    [{ status: 'DEVICE_CONFIRMED' }, '设备查询已确认'],
    [{ status: 'PENDING_SITE_VERIFICATION' }, '待现场刷脸验证'],
    [{ status: 'DEVICE_CONFIRMED', siteVerification: 'ready' }, '待现场刷脸验证'],
    [{ status: 'DEVICE_CONFIRMED', siteVerification: 'pending-site' }, '待现场刷脸验证'],
    [{ status: 'FAILED_REVIEW' }, '失败，待人工核查'],
    [{ status: 'UNKNOWN_RESULT' }, '结果待核'],
    [{ status: 'INVALIDATED' }, '已失效，待人工核查'],
  ];
  for (const [task, label] of expected) {
    const { page } = facePage({ getFaceTask: async () => ({}) }, makeWx().wx);
    page.applyTask(task);
    assert.equal(page.data.taskView.label, label, `status=${task.status}/${task.siteVerification || '-'}`);
  }
  const failed = facePage({ getFaceTask: async () => ({}) }, makeWx().wx).page;
  failed.applyTask({ status: 'FAILED_REVIEW' });
  const unknown = facePage({ getFaceTask: async () => ({}) }, makeWx().wx).page;
  unknown.applyTask({ status: 'UNKNOWN_RESULT' });
  assert.notEqual(failed.data.taskView.key, unknown.data.taskView.key, '失败态与待核态必须分离');
});

test('页面文件不得出现现场识别通过/已通过/已开门字样', () => {
  const files = [
    FACE_JS,
    path.join(ROOT, 'miniprogram/pages/face-enroll/index.wxml'),
    CHECKIN_JS,
    path.join(ROOT, 'miniprogram/pages/checkin/index.wxml'),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const phrase of ['识别通过', '已通过', '已开门', '识别成功']) {
      assert.ok(!text.includes(phrase), `${path.relative(ROOT, file)} 不得出现「${phrase}」`);
    }
  }
});

test('照片上传成功仅显示照片收件；上传 cloudPath 原样取服务端字段，不拼接', async () => {
  const serverPath = 'test-face/synthetic-env/openid/app-1/photo.jpg';
  const uploads = [];
  const created = [];
  let poll = 0;
  const api = {
    getFaceTask: async () => {
      poll += 1;
      return poll === 1
        ? { status: 'NOT_FOUND', cloudPath: serverPath, room: FULL_CONFIG.room, lease: FULL_CONFIG.lease }
        : { status: 'PHOTO_RECEIVED', cloudPath: serverPath, room: FULL_CONFIG.room, lease: FULL_CONFIG.lease };
    },
    uploadTestFace: async (input) => { uploads.push(input); return 'cloud://synthetic/file.jpg'; },
    createFaceTask: async (input) => { created.push(input); return { status: 'PHOTO_RECEIVED' }; },
  };
  const { page } = facePage(api, makeWx().wx);
  page._applicationId = 'app-1';
  await page.refreshTask();
  assert.equal(page.data.cloudPathReady, true);
  page.onConsentChange({ detail: { value: ['consent'] } });
  await page.chooseAndUpload();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].cloudPath, serverPath, '页面不得自行拼接上传路径');
  assert.deepEqual(created, [{ applicationId: 'app-1', fileId: 'cloud://synthetic/file.jpg', consent: true }]);
  assert.equal(page.data.taskView.label, '照片收件');
  assert.equal(page.data.showUpload, false);
  assert.ok(!/识别通过|识别成功/.test(page.data.taskView.hint + page.data.taskView.label));
});

test('上传按钮 busy 锁：并发点击只建一次任务，未勾选用途不得上传', async () => {
  let uploads = 0;
  let creates = 0;
  const api = {
    getFaceTask: async () => ({ status: 'NOT_FOUND', cloudPath: 'test-face/e/o/a/p.jpg', room: {}, lease: {} }),
    uploadTestFace: async () => { uploads += 1; await new Promise((r) => setTimeout(r, 5)); return 'cloud://synthetic/f.jpg'; },
    createFaceTask: async () => { creates += 1; return {}; },
  };
  const { page } = facePage(api, makeWx().wx);
  page._applicationId = 'app-1';
  await page.refreshTask();
  await page.chooseAndUpload();
  assert.equal(uploads, 0, '未勾选用途不得上传');
  page.onConsentChange({ detail: { value: ['consent'] } });
  await Promise.all([page.chooseAndUpload(), page.chooseAndUpload(), page.chooseAndUpload()]);
  assert.equal(uploads, 1);
  assert.equal(creates, 1);
});

test('资料页入口按 runtime.checkinFaceTestEntry && authenticated 显隐', async () => {
  for (const flag of [true, false]) {
    for (const authenticated of [true, false]) {
      let captured;
      const navigations = [];
      loadModule(PROFILE_JS, {
        requires: {
          '../../services/api': { isDemo: () => false, getProfile: async () => ({}), getCheckinFaceConfig: async () => ({}) },
          '../../config/runtime': { checkinFaceTestEntry: flag },
          '../../config/version': { version: '0.0.0-synthetic', channel: 'test' },
          '../../utils/layout': { getNavigationLayout: () => ({ statusBarHeight: 20, navHeight: 44, navSideWidth: 104 }) },
        },
        globals: {
          Page: (config) => { captured = config; },
          wx: { navigateTo: (arg) => navigations.push(arg), showModal: () => {}, showToast: () => {}, getWindowInfo: () => ({}), getMenuButtonBoundingClientRect: () => null },
          getApp: () => ({ globalData: {} }),
        },
      });
      const page = instantiate(captured);
      page.setData({ authenticated });
      page.openMenu({ currentTarget: { dataset: { id: 'checkinTest' } } });
      assert.equal(navigations.length, flag && authenticated ? 1 : 0, `entry=${flag} authenticated=${authenticated}`);
      if (navigations.length) assert.deepEqual(navigations[0], { url: '/pages/checkin/index' });
    }
  }
  const wxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/index.wxml'), 'utf8');
  assert.match(wxml, /checkinFaceEntry\s*&&\s*authenticated/);
});
