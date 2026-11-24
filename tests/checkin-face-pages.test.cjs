'use strict';

/**
 * B05 / §6 — 小程序两页面逻辑合成测试。
 *
 * 通过轻量 Page/wx 注入读取真实页面 JS，断言页面只渲染服务端事实、
 * 不伪造识别结果、不重复提交、普通账号不显示成功或人脸入口。
 * R02 部分同时做真实 WXML 组件结构静态断言：直接调用 handler 的单测
 * 不能独自证明组件接线，必须校验 checkbox-group 结构与事件归属。
 * 此处的页面逻辑通过不代表真机流程通过。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const CHECKIN_JS = path.join(ROOT, 'miniprogram/pages/checkin/index.js');
const CHECKIN_WXML = path.join(ROOT, 'miniprogram/pages/checkin/index.wxml');
const FACE_JS = path.join(ROOT, 'miniprogram/pages/face-enroll/index.js');
const FACE_WXML = path.join(ROOT, 'miniprogram/pages/face-enroll/index.wxml');
const PROFILE_JS = path.join(ROOT, 'miniprogram/pages/profile/index.js');

// 与 miniprogram/services/api.js 的 REVIEW_CHANNEL_CODES 保持一致（INTERFACES.md §5 对齐；
// api 测试侧有反向校验）。
const REVIEW_CHANNEL_CODES = ['APPLICATION_FORBIDDEN', 'APPLICATION_NOT_APPROVED', 'ACCOUNT_NOT_ALLOWED'];

function augmentApi(api) {
  if (typeof api.isReviewChannelCode !== 'function') {
    api.isReviewChannelCode = (code) => REVIEW_CHANNEL_CODES.includes(code);
  }
  return api;
}

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
  api = augmentApi(api);
  let captured;
  loadModule(CHECKIN_JS, {
    requires: { '../../services/api': api, '../../utils/layout': { getNavigationLayout: () => ({ statusBarHeight: 20, navHeight: 44, navSideWidth: 104 }) } },
    globals: { Page: (config) => { captured = config; }, wx },
  });
  const page = instantiate(captured);
  page.__rawConfig = captured;
  return page;
}

function facePage(api, wx) {
  api = augmentApi(api);
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
  const page = instantiate(captured);
  page.__rawConfig = captured;
  return { page, intervals };
}

const FULL_CONFIG = {
  enabled: true, configured: true, accountEligible: true, applicationVersion: 'test-v1',
  room: { displayNo: '102', roomId: 'room-stable-1', houseId: 'house-stable-1', projectName: '合成项目', buildingName: '合成楼栋' },
  lease: { status: 'active', startDate: '2026-12-01', endDate: '2026-12-05', validFrom: '2026-12-01T00:00:00', validTo: '2026-12-05T23:59:59', timezone: 'Asia/Shanghai', dailyHours: '24x7' },
};

function scanCheckboxGroups(wxml) {
  const groups = [];
  const re = /<checkbox-group\b([^>]*)>([\s\S]*?)<\/checkbox-group>/g;
  let match;
  while ((match = re.exec(wxml))) groups.push({ attrs: match[1] || '', body: match[2] || '' });
  return groups;
}

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
  const wxml = fs.readFileSync(CHECKIN_WXML, 'utf8');
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
  assert.equal(page.data.reviewRequired, false);
});

test('六态文案逐项映射；ready 与 pending-site 都显示待现场刷脸验证', async () => {
  const expected = [
    [{ status: 'NOT_FOUND', uploadEligible: true, cloudPath: 'test-face/e/o/a/p.jpg' }, '尚未上传照片'],
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
    FACE_WXML,
    CHECKIN_JS,
    CHECKIN_WXML,
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const phrase of ['识别通过', '已通过', '已开门', '识别成功']) {
      assert.ok(!text.includes(phrase), `${path.relative(ROOT, file)} 不得出现「${phrase}」`);
    }
  }
});

// ---- R02：真实 checkbox-group 结构与事件归属（静态 WXML + 处理器配套）----

test('R02：两页为真实 checkbox-group bindchange 结构，事件归属与处理器配套', () => {
  const checkinWxml = fs.readFileSync(CHECKIN_WXML, 'utf8');
  const faceWxml = fs.readFileSync(FACE_WXML, 'utf8');

  const checkinGroups = scanCheckboxGroups(checkinWxml);
  assert.ok(checkinGroups.length >= 1, 'checkin 页必须存在 checkbox-group 组件');
  assert.match(checkinGroups[0].attrs, /bindchange\s*=\s*"onPrimaryChange"/, 'checkin 组事件必须绑定 onPrimaryChange');
  assert.match(checkinGroups[0].body, /<checkbox\b[^>]*value\s*=\s*"primary"/, 'checkin 组内必须有 value=primary 的 checkbox 子组件');

  const faceGroups = scanCheckboxGroups(faceWxml);
  assert.ok(faceGroups.length >= 1, 'face-enroll 页必须存在 checkbox-group 组件');
  assert.match(faceGroups[0].attrs, /bindchange\s*=\s*"onConsentChange"/, 'face 组事件必须绑定 onConsentChange');
  assert.match(faceGroups[0].body, /<checkbox\b[^>]*value\s*=\s*"consent"/, 'face 组内必须有 value=consent 的 checkbox 子组件');

  // 组外不得再出现旧接线：单 checkbox 直接挂 bindchange。
  for (const [name, wxml] of [['checkin/index.wxml', checkinWxml], ['face-enroll/index.wxml', faceWxml]]) {
    const withoutGroups = wxml.replace(/<checkbox-group\b[\s\S]*?<\/checkbox-group>/g, '');
    assert.ok(!/<checkbox\b[^>]*\bbindchange\s*=/.test(withoutGroups), `${name} 组外不得有 checkbox 直接挂 bindchange`);
  }

  // 事件归属：bindchange 指名的处理器必须真实存在于 Page 配置中。
  const checkinPageInstance = checkinPage({ getCheckinFaceConfig: async () => FULL_CONFIG }, makeWx().wx);
  assert.equal(typeof checkinPageInstance.__rawConfig.onPrimaryChange, 'function', 'onPrimaryChange 必须存在于 checkin Page 配置');
  const faceInstance = facePage({ getFaceTask: async () => ({}) }, makeWx().wx).page;
  assert.equal(typeof faceInstance.__rawConfig.onConsentChange, 'function', 'onConsentChange 必须存在于 face Page 配置');

  // 按钮禁用表达式必须消费对应确认值：取消勾选即恢复禁用。
  assert.match(checkinWxml, /disabled="\{\{[^}]*!primaryConfirmed[^}]*\}\}"/, 'checkin 提交按钮禁用必须依赖 !primaryConfirmed');
  assert.match(faceWxml, /disabled="\{\{!canUpload\}\}"/, 'face 上传按钮禁用必须依赖 !canUpload');
});

test('R02：勾选/取消勾选与提交按钮状态联动（真实数组事件）', async () => {
  const api = {
    getCheckinFaceConfig: async () => FULL_CONFIG,
    applyTestCheckin: async () => ({ applicationId: 'app-1', result: 'auto_approved' }),
  };
  const { wx, toasts } = makeWx();
  const page = checkinPage(api, wx);
  page.setData({ loading: false });
  await page.loadConfig();
  assert.equal(page.data.primaryConfirmed, false);
  page.onPrimaryChange({ detail: { value: ['primary'] } });
  assert.equal(page.data.primaryConfirmed, true, '勾选后确认值必须更新');
  page.onPrimaryChange({ detail: { value: [] } });
  assert.equal(page.data.primaryConfirmed, false, '取消勾选必须恢复未确认');
  await page.submit();
  assert.ok(toasts.some((t) => /请先确认主入住人信息/.test(t.title)), '取消勾选后提交必须被原门禁拦下');
  // 非法事件形状不得误判为已勾选。
  page.onPrimaryChange({ detail: { value: 'primary' } });
  assert.equal(page.data.primaryConfirmed, false);
  page.onPrimaryChange(null);
  assert.equal(page.data.primaryConfirmed, false);
});

test('R02：用途确认勾选/取消与上传按钮状态联动', async () => {
  const api = {
    getFaceTask: async () => ({ status: 'NOT_FOUND', uploadEligible: true, cloudPath: 'test-face/e/o/a/p.jpg', room: {}, lease: {} }),
    getCheckinFaceConfig: async () => FULL_CONFIG,
  };
  const { page } = facePage(api, makeWx().wx);
  page._applicationId = 'app-1';
  await page.refreshTask();
  assert.equal(page.data.consentConfirmed, false);
  assert.equal(page.data.canUpload, false);
  page.onConsentChange({ detail: { value: ['consent'] } });
  assert.equal(page.data.consentConfirmed, true);
  assert.equal(page.data.canUpload, true, '勾选用途后上传可用');
  page.onConsentChange({ detail: { value: [] } });
  assert.equal(page.data.consentConfirmed, false);
  assert.equal(page.data.canUpload, false, '取消勾选必须恢复禁用');
});

// ---- R11 / C2：applyTestCheckin 结果分类与普通账号反馈 ----

test('R11：仅 auto_approved 且有效非空 applicationId 显示受理与人脸入口', async () => {
  const outcomes = [
    { name: '正常自动通过', response: { applicationId: 'app-1', result: 'auto_approved', employeeNo: 'F001' }, applied: true, review: false, entry: true },
    { name: 'pending_review（普通账号）', response: { applicationId: '', result: 'pending_review', reason: '请走既有审核流程', idempotent: false }, applied: false, review: true, entry: false },
    { name: '空返回', response: {}, applied: false, review: true, entry: false },
    { name: '空 applicationId', response: { applicationId: '', result: 'auto_approved' }, applied: false, review: true, entry: false },
    { name: '畸形 applicationId', response: { applicationId: '../evil', result: 'auto_approved' }, applied: false, review: true, entry: false },
    { name: '未知 result', response: { applicationId: 'app-1', result: 'mystery' }, applied: false, review: true, entry: false },
  ];
  for (const item of outcomes) {
    let applyCalls = 0;
    const api = {
      getCheckinFaceConfig: async () => FULL_CONFIG,
      applyTestCheckin: async () => { applyCalls += 1; return item.response; },
    };
    const { wx, navigations } = makeWx();
    const page = checkinPage(api, wx);
    page.setData({ loading: false });
    await page.loadConfig();
    page.setData({ primaryConfirmed: true });
    await page.submit();
    assert.equal(applyCalls, 1, `${item.name}: 必须实际提交一次`);
    assert.equal(page.data.applied, item.applied, `${item.name}: applied 状态`);
    assert.equal(page.data.reviewRequired, item.review, `${item.name}: reviewRequired 状态`);
    page.goFaceEnroll();
    assert.equal(navigations.length, item.entry ? 1 : 0, `${item.name}: 人脸入口导航`);
    if (item.entry) assert.deepEqual(navigations[0], { url: '/pages/face-enroll/index?applicationId=app-1' });
    if (item.review) assert.ok(page.data.reviewReason && page.data.reviewReason.length > 0, `${item.name}: 必须给出审核渠道/明确错误文案`);
  }
});

test('R11：受理卡片与人脸入口互斥——人脸入口只存在于 applied 卡片', () => {
  const checkinWxml = fs.readFileSync(CHECKIN_WXML, 'utf8');
  const appliedBlock = (checkinWxml.match(/<view wx:if="\{\{applied\}\}"[\s\S]*?<\/view>/) || [])[0];
  const reviewBlock = (checkinWxml.match(/<view wx:if="\{\{reviewRequired\}\}"[\s\S]*?<\/view>/) || [])[0];
  assert.ok(appliedBlock, '必须存在 applied 受理卡片');
  assert.match(appliedBlock, /bindtap="goFaceEnroll"/, '人脸入口只应出现在受理卡片内');
  assert.ok(reviewBlock, '必须存在 reviewRequired 审核渠道卡片');
  assert.ok(!/bindtap="goFaceEnroll"/.test(reviewBlock), '审核渠道卡片不得提供人脸入口');
  const faceWxml = fs.readFileSync(FACE_WXML, 'utf8');
  const faceReviewBlock = (faceWxml.match(/<view wx:if="\{\{reviewRequired\}\}"[\s\S]*?<\/view>/) || [])[0];
  assert.ok(faceReviewBlock, 'face 页必须存在审核渠道卡片');
  assert.ok(!/chooseAndUpload/.test(faceReviewBlock), 'face 审核渠道卡片不得提供上传按钮');
});

test('C2：普通账号反馈不冒称人工申请已提交，并明确提示既有审核渠道', () => {
  const checkinWxml = fs.readFileSync(CHECKIN_WXML, 'utf8');
  const faceWxml = fs.readFileSync(FACE_WXML, 'utf8');
  for (const [name, wxml] of [['checkin/index.wxml', checkinWxml], ['face-enroll/index.wxml', faceWxml]]) {
    assert.ok(!/人工审核已提交|已提交人工审核|人工申请已入队|审核单已提交/.test(wxml), `${name} 不得声称人工审核单已提交/已入队`);
    assert.match(wxml, /请走既有审核流程/, `${name} 必须明确提示既有审核渠道`);
  }
});

test('R11：名单在页面加载后撤销——提交得到 pending_review 不显示成功与人脸入口', async () => {
  let configCalls = 0;
  const api = {
    getCheckinFaceConfig: async () => { configCalls += 1; return configCalls === 1 ? FULL_CONFIG : { ...FULL_CONFIG, accountEligible: false }; },
    applyTestCheckin: async () => ({ applicationId: '', result: 'pending_review', reason: '请走既有审核流程', idempotent: false }),
  };
  const { wx, navigations } = makeWx();
  const page = checkinPage(api, wx);
  page.setData({ loading: false });
  await page.loadConfig();
  assert.equal(page.data.eligible, true, '页面加载时仍在名单内，属合法竞态起点');
  page.setData({ primaryConfirmed: true });
  await page.submit();
  assert.equal(page.data.applied, false, '撤销后不得显示已受理');
  assert.equal(page.data.reviewRequired, true, '撤销后必须显示既有审核渠道');
  assert.match(page.data.reviewReason, /既有审核流程/);
  page.goFaceEnroll();
  assert.equal(navigations.length, 0, '未通过者不得出现人脸入口导航');
});

// ---- face-enroll：名单撤销竞态与审核渠道 ----

test('face-enroll：名单撤销后上传前复核拒绝——零照片上传、零 createFaceTask、零入口', async () => {
  let polls = 0;
  const uploads = [];
  const creates = [];
  const api = {
    getFaceTask: async () => { polls += 1; return polls === 1 ? { status: 'NOT_FOUND', uploadEligible: true, cloudPath: 'test-face/e/o/a/p.jpg', room: {}, lease: {} } : { status: 'NOT_FOUND', uploadEligible: true, cloudPath: '', room: {}, lease: {} }; },
    getCheckinFaceConfig: async () => ({ enabled: true, configured: true, accountEligible: false }),
    uploadTestFace: async (input) => { uploads.push(input); return 'cloud://synthetic/f.jpg'; },
    createFaceTask: async (input) => { creates.push(input); return {}; },
  };
  const { page } = facePage(api, makeWx().wx);
  page._applicationId = 'app-1';
  await page.refreshTask();
  assert.equal(page.data.cloudPathReady, true, '页面加载时仍在名单内、已有服务端上传路径');
  page.onConsentChange({ detail: { value: ['consent'] } });
  await page.chooseAndUpload();
  assert.equal(page.data.reviewRequired, true, '上传前复核发现名单撤销，必须进入审核渠道态');
  assert.equal(page.data.showUpload, false, '审核态不得再显示上传卡片');
  assert.equal(uploads.length, 0, '未通过者零照片上传');
  assert.equal(creates.length, 0, '未通过者零 createFaceTask');
  await page.chooseAndUpload();
  assert.equal(uploads.length, 0, '审核态重复点击仍零上传');
  assert.equal(creates.length, 0);
});

test('face-enroll：上传前复核发现存储命名空间未配置（§1.2）——零照片上传、零 createFaceTask', async () => {
  const uploads = [];
  const creates = [];
  const api = {
    getFaceTask: async () => ({ status: 'NOT_FOUND', uploadEligible: true, cloudPath: 'test-face/e/o/a/p.jpg', room: {}, lease: {} }),
    getCheckinFaceConfig: async () => ({ enabled: true, configured: true, accountEligible: true, storageNamespaceConfigured: false }),
    uploadTestFace: async (input) => { uploads.push(input); return 'cloud://synthetic/f.jpg'; },
    createFaceTask: async (input) => { creates.push(input); return {}; },
  };
  const { page } = facePage(api, makeWx().wx);
  page._applicationId = 'app-1';
  await page.refreshTask();
  page.onConsentChange({ detail: { value: ['consent'] } });
  await page.chooseAndUpload();
  assert.equal(page.data.reviewRequired, true, '命名空间未配置必须在上传前失败关闭');
  assert.equal(page.data.showUpload, false);
  assert.equal(uploads.length, 0, '命名空间未配置时零照片上传');
  assert.equal(creates.length, 0, '命名空间未配置时零 createFaceTask');
});

test('face-enroll：申请被拒（APPLICATION_FORBIDDEN）时显示审核渠道、无上传卡片', async () => {
  const err = new Error('未找到本人申请');
  err.code = 'APPLICATION_FORBIDDEN';
  const uploads = [];
  const api = {
    getFaceTask: async () => { throw err; },
    getCheckinFaceConfig: async () => FULL_CONFIG,
    uploadTestFace: async (input) => { uploads.push(input); return 'cloud://synthetic/f.jpg'; },
    createFaceTask: async () => ({}),
  };
  const { page } = facePage(api, makeWx().wx);
  page._applicationId = 'app-1';
  await page.refreshTask();
  assert.equal(page.data.reviewRequired, true, 'APPLICATION_FORBIDDEN 必须进入审核渠道态（不能按文案猜成无任务）');
  assert.equal(page.data.showUpload, false);
  assert.equal(page.data.loading, false);
  page.onConsentChange({ detail: { value: ['consent'] } });
  assert.equal(page.data.canUpload, false, '审核态即使勾选用途也不得上传');
  await page.chooseAndUpload();
  assert.equal(uploads.length, 0);
});

test('face-enroll：createFaceTask 被服务端以审核码拒绝时不显示成功、不保留可用入口', async () => {
  const err = new Error('当前账号不在测试名单内');
  err.code = 'ACCOUNT_NOT_ALLOWED';
  const uploads = [];
  let createCalls = 0;
  const api = {
    getFaceTask: async () => ({ status: 'NOT_FOUND', uploadEligible: true, cloudPath: 'test-face/e/o/a/p.jpg', room: {}, lease: {} }),
    getCheckinFaceConfig: async () => ({ enabled: true, configured: true, accountEligible: true }),
    uploadTestFace: async (input) => { uploads.push(input); return 'cloud://synthetic/f.jpg'; },
    createFaceTask: async () => { createCalls += 1; throw err; },
  };
  const { page } = facePage(api, makeWx().wx);
  page._applicationId = 'app-1';
  await page.refreshTask();
  page.onConsentChange({ detail: { value: ['consent'] } });
  await page.chooseAndUpload();
  assert.equal(page.data.reviewRequired, true, '任务创建被服务端拒绝即进入审核渠道态');
  assert.equal(page.data.showUpload, false, '不得保留可用上传入口');
  assert.equal(page.data.taskView.label, '尚未上传照片', '不得显示任何成功/处理中状态');
  assert.equal(createCalls, 1, 'createFaceTask 被调用一次即被服务端拒绝');
  assert.equal(uploads.length, 1, '复核与建任务之间的最后一跳竞态由服务端关闭：照片已到服务端路径但任务未建立');
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
        ? { status: 'NOT_FOUND', uploadEligible: true, cloudPath: serverPath, room: FULL_CONFIG.room, lease: FULL_CONFIG.lease }
        : { status: 'PHOTO_RECEIVED', cloudPath: serverPath, room: FULL_CONFIG.room, lease: FULL_CONFIG.lease };
    },
    getCheckinFaceConfig: async () => FULL_CONFIG,
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
  assert.equal(page.data.reviewRequired, false);
  assert.ok(!/识别通过|识别成功/.test(page.data.taskView.hint + page.data.taskView.label));
});

test('上传按钮 busy 锁：并发点击只建一次任务，未勾选用途不得上传', async () => {
  let uploads = 0;
  let creates = 0;
  const api = {
    getFaceTask: async () => ({ status: 'NOT_FOUND', uploadEligible: true, cloudPath: 'test-face/e/o/a/p.jpg', room: {}, lease: {} }),
    getCheckinFaceConfig: async () => FULL_CONFIG,
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


// CF-R2-10：实际 Page.refreshTask 编排，旧可查询记录不能重获上传资格。
test('CF-R2-10：撤权锁存跨旧任务轮询，权威重授权后恢复且真实调用上传一次', async (t) => {
  const events = [];
  let currentEligible = false;
  let view = {
    status: 'NOT_FOUND', uploadEligible: true,
    cloudPath: 'test-face/synthetic-env/openid/app-1/photo.jpg',
    room: FULL_CONFIG.room, lease: FULL_CONFIG.lease,
  };
  const uploads = [];
  const creates = [];
  const api = {
    getFaceTask: async () => { events.push('task'); return structuredClone(view); },
    getCheckinFaceConfig: async () => {
      events.push('config');
      return { ...FULL_CONFIG, storageNamespaceConfigured: true, accountEligible: currentEligible };
    },
    uploadTestFace: async (input) => { events.push('upload'); uploads.push(input); return 'cloud://synthetic-env.synthetic-bucket/photo.jpg'; },
    createFaceTask: async (input) => {
      events.push('create'); creates.push(input);
      view = { ...view, status: 'PHOTO_RECEIVED', uploadEligible: false };
      return { status: 'PHOTO_RECEIVED' };
    },
  };
  const { wx } = makeWx();
  const chooseMedia = wx.chooseMedia;
  wx.chooseMedia = (options) => { events.push('choose'); chooseMedia(options); };
  const { page } = facePage(api, wx);
  page._applicationId = 'app-1';
  await page.refreshTask();
  page.onConsentChange({ detail: { value: ['consent'] } });
  assert.equal(page.data.canUpload, true);

  await page.chooseAndUpload();
  assert.equal(page.data.reviewRequired, true);
  assert.equal(page.data.showUpload, false);
  assert.equal(page.data.canUpload, false);
  assert.equal(uploads.length, 0);
  assert.equal(creates.length, 0);

  // 缺/false 权威标记：旧 SDK 形状 cloudPath 仍返回，但不能清审核态。
  for (const flag of [false, undefined]) {
    view = { ...view, uploadEligible: flag };
    await page.refreshTask();
    assert.equal(page.data.reviewRequired, true);
    assert.equal(page.data.showUpload, false);
    assert.equal(page.data.cloudPathReady, false);
    assert.equal(page.data.canUpload, false);
  }
  assert.equal(events.filter((name) => name === 'task').length, 3, '必须真实调用轮询依赖');
  assert.equal(events.filter((name) => name === 'config').length, 1, '无申请资格标记时不以全局名单代替');

  // 即使旧/在途任务声称 uploadEligible，名单仍撤销时也不能恢复。
  view = { ...view, uploadEligible: true };
  await page.refreshTask();
  page.applyTask(structuredClone(view));
  assert.equal(page.data.reviewRequired, true, 'applyTask 显示旧数据不能清审核锁存');
  assert.equal(page.data.showUpload, false);
  assert.equal(page.data.canUpload, false);
  assert.equal(uploads.length, 0);
  assert.equal(creates.length, 0);

  currentEligible = true;
  await page.refreshTask();
  assert.equal(page.data.reviewRequired, false, '本人申请和当前名单均重新授权后可恢复');
  assert.equal(page.data.showUpload, true);
  assert.equal(page.data.canUpload, true);
  await page.chooseAndUpload();
  assert.equal(uploads.length, 1, '正向恢复必须真实走页面上传依赖，不是永远为零的计数');
  assert.equal(creates.length, 1);
  assert.equal(page.data.taskView.label, '照片收件');
  assert.equal(page.data.showUpload, false);
  assert.deepEqual(events.slice(-5), ['config', 'choose', 'upload', 'create', 'task']);
  assert.equal(events.filter((name) => name === 'task').length, 6);
  assert.equal(events.filter((name) => name === 'config').length, 4);
  t.diagnostic(`CF-R2-10 calls=${JSON.stringify({ polls: events.filter((name) => name === 'task').length, currentEligibility: events.filter((name) => name === 'config').length, uploads: uploads.length, creates: creates.length })}`);
});

test('CF-R2-10：资格读取失败及非法/关闭配置保持审核态，终态历史查询也不恢复上传', async () => {
  const attempts = [];
  let gate;
  let view = { status: 'NOT_FOUND', uploadEligible: true, cloudPath: 'test-face/e/o/app-1/photo.jpg' };
  const api = {
    getFaceTask: async () => { attempts.push('task'); return structuredClone(view); },
    getCheckinFaceConfig: async () => {
      attempts.push('config');
      if (gate instanceof Error) throw gate;
      return gate;
    },
    uploadTestFace: async () => { attempts.push('upload'); throw new Error('unexpected upload'); },
    createFaceTask: async () => { attempts.push('create'); throw new Error('unexpected create'); },
  };
  const { page } = facePage(api, makeWx().wx);
  page._applicationId = 'app-1';
  page.toReviewRequired('资格已撤销');
  const invalidGates = [
    new Error('synthetic eligibility unavailable'), null, {},
    { ...FULL_CONFIG, enabled: false },
    { ...FULL_CONFIG, configured: false },
    { ...FULL_CONFIG, accountEligible: false },
    { ...FULL_CONFIG, accountEligible: 'true' },
    { ...FULL_CONFIG, storageNamespaceConfigured: false },
  ];
  for (gate of invalidGates) {
    await page.refreshTask();
    assert.equal(page.data.reviewRequired, true);
    assert.equal(page.data.showUpload, false);
    assert.equal(page.data.canUpload, false);
    await page.chooseAndUpload();
  }
  assert.equal(attempts.filter((name) => name === 'task').length, invalidGates.length);
  assert.equal(attempts.filter((name) => name === 'config').length, invalidGates.length);
  assert.equal(attempts.filter((name) => name === 'upload').length, 0);
  assert.equal(attempts.filter((name) => name === 'create').length, 0);

  // 终态事实仍更新显示；不能用终态记录或只恢复全局名单恢复上传。
  view = { status: 'PENDING_SITE_VERIFICATION', uploadEligible: false, cloudPath: 'test-face/e/o/app-1/photo.jpg' };
  gate = FULL_CONFIG;
  await page.refreshTask();
  assert.equal(page.data.taskView.label, '待现场刷脸验证');
  assert.equal(page.data.reviewRequired, true);
  assert.equal(page.data.showUpload, false);
  assert.equal(attempts.filter((name) => name === 'config').length, invalidGates.length);
});

test('CF-R2-10：撤权前已开始的旧任务查询晚返回，不能覆盖新的审核锁存', async () => {
  let releaseOldQuery;
  const oldQuery = new Promise((resolve) => { releaseOldQuery = resolve; });
  const calls = [];
  const oldView = { status: 'NOT_FOUND', uploadEligible: true, cloudPath: 'test-face/e/o/app-1/photo.jpg' };
  const api = {
    getFaceTask: async () => { calls.push('task'); return oldQuery; },
    getCheckinFaceConfig: async () => { calls.push('config'); return { ...FULL_CONFIG, accountEligible: false }; },
    uploadTestFace: async () => { calls.push('upload'); throw new Error('unexpected upload'); },
    createFaceTask: async () => { calls.push('create'); throw new Error('unexpected create'); },
  };
  const { page } = facePage(api, makeWx().wx);
  page._applicationId = 'app-1';
  page.applyTask(structuredClone(oldView));
  page.onConsentChange({ detail: { value: ['consent'] } });
  const polling = page.refreshTask();
  await page.chooseAndUpload();
  assert.equal(page.data.reviewRequired, true);
  releaseOldQuery(structuredClone(oldView));
  await polling;
  assert.equal(page.data.reviewRequired, true);
  assert.equal(page.data.showUpload, false);
  assert.equal(page.data.canUpload, false);
  assert.deepEqual(calls, ['task', 'config', 'config']);
});
