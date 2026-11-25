'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'miniprogram/pages/account-login/index.js');
const PROFILE_FILE = path.join(ROOT, 'miniprogram/pages/profile/index.js');
const guard = globalThis.__DSH_D_NETWORK_GUARD__;
let network;
test.before(() => guard.assertLoadTimeClean());
test.beforeEach(() => { network = guard.snapshot(); });
test.afterEach(() => guard.assertNoViolations(network, 'account login pages'));

function pageFixture(overrides = {}) {
  let definition;
  const events = [];
  const api = {
    loginWithPassword: async input => { events.push(['login', input]); return {}; },
    cancelPasswordLogin: () => events.push(['cancel']),
    ...overrides,
  };
  const forbidden = () => { events.push(['forbidden-storage']); throw new Error('storage is forbidden'); };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), {
    require: id => id === '../../services/api' ? api : { getNavigationLayout: () => ({ statusBarHeight: 20, navHeight: 44, navSideWidth: 104 }) },
    Page: config => { definition = config; },
    wx: { switchTab: input => events.push(['tab', input.url]), navigateBack: () => {},
      setStorageSync: forbidden, setStorage: forbidden, setClipboardData: forbidden },
    console: { log: forbidden, error: forbidden, warn: forbidden },
  }, { filename: FILE });
  const page = { ...definition, data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values); } };
  page.onLoad();
  return { page, events };
}

test('密码输入隐藏且不进storage/URL；原手机号按钮仍保留，新页已注册', () => {
  const template = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/account-login/index.wxml'), 'utf8');
  assert.match(template, /password="\{\{true\}\}"/);
  assert.match(template, /bindinput="onPasswordInput"/);
  assert.doesNotMatch(template, /获取开户码|prepareOpening|requestCode/, '获取开户码入口必须已移除');
  const style = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/account-login/index.wxss'), 'utf8');
  assert.doesNotMatch(style, /opening-code|code-label|\.code\b|\.secondary\b/);
  const profile = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/index.wxml'), 'utf8');
  assert.match(profile, /open-type="getPhoneNumber"/);
  assert.match(profile, /bindtap="openAccountLogin"/);
  assert.match(profile, /首次授权成功后自动注册/);
  assert.match(profile, /复用原账号/);
  assert.match(profile, /取消授权不会注册或登录/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/app.json'))).pages.includes('pages/account-login/index'));
  const source = fs.readFileSync(FILE, 'utf8');
  assert.doesNotMatch(source, /setStorage|setClipboardData|console\.|openid|unionid|prepareAccountOpening/);
});

test('提交立即清密码，busy阻重复；成功回我的，不把凭据放导航', async () => {
  let resolve;
  const inputs = [];
  const { page, events } = pageFixture({ loginWithPassword: input => { inputs.push(input); return new Promise(r => { resolve = r; }); } });
  page.onUsernameInput({ detail: { value: 'resident01' } });
  page.onPasswordInput({ detail: { value: '  Synthetic-password  ' } });
  const pending = page.submit();
  assert.equal(page.data.password, '');
  assert.equal(page.data.submitting, true);
  await page.submit();
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].password, '  Synthetic-password  ');
  resolve({});
  await pending;
  assert.equal(page.data.password, '');
  assert.equal(page.data.submitting, false);
  assert.ok(events.some(e => e[0] === 'tab' && e[1] === '/pages/profile/index'));
  assert.ok(!events.some(e => e[0] === 'forbidden-storage'));
});

test('失败、隐藏和卸载均清密码；晚返不跳页、不恢复私有输入', async () => {
  const failed = pageFixture({ loginWithPassword: async () => { throw new Error('合成认证失败'); } });
  failed.page.onPasswordInput({ detail: { value: 'Synthetic-password' } });
  await failed.page.submit();
  assert.equal(failed.page.data.password, '');
  assert.match(failed.page.data.error, /认证失败/);
  for (const lifecycle of ['onHide', 'onUnload']) {
    const idle = pageFixture();
    idle.page.onPasswordInput({ detail: { value: 'Synthetic-password-not-submitted' } });
    idle.page[lifecycle]();
    assert.equal(idle.page.data.password, '', '尚未提交的密码也必须在离开时清除');
    assert.ok(idle.events.some(e => e[0] === 'cancel'));
    let finish;
    const f = pageFixture({ loginWithPassword: () => new Promise(resolve => { finish = resolve; }) });
    f.page.onPasswordInput({ detail: { value: 'Synthetic-password' } });
    const pending = f.page.submit();
    f.page[lifecycle]();
    finish({});
    await pending;
    assert.equal(f.page.data.password, '');
    assert.equal(f.page.data.submitting, false);
    assert.ok(f.events.some(e => e[0] === 'cancel'));
    assert.ok(!f.events.some(e => e[0] === 'tab'));
  }
});

test('页面不再提供获取开户码：无 prepareOpening 处理器与相关状态', () => {
  const { page } = pageFixture();
  assert.equal(typeof page.prepareOpening, 'undefined');
  assert.equal(Object.hasOwn(page.data, 'requestCode'), false);
  assert.equal(Object.hasOwn(page.data, 'preparing'), false);
  const source = fs.readFileSync(FILE, 'utf8');
  assert.doesNotMatch(source, /prepareOpening|prepareAccountOpening|requestCode|expiresAt|openingCode/);
  page.onPasswordInput({ detail: { value: 'Synthetic-password' } });
  page.onHide();
  assert.equal(page.data.password, '', '离开页面仍必须清除密码输入');
});

function profileFixture(overrides = {}) {
  let definition, user = null, epoch = null;
  const events = [];
  const api = {
    isDemo: () => false,
    isAuthenticated: () => Boolean(user),
    getLoginEpoch: () => epoch,
    getProfile: async () => user,
    loginWithPhone: async code => { events.push(['phoneLogin', code]); epoch = 1;
      user = { _id: 'synthetic-resident', authenticated: true, nickname: '合成住户', houses: [] }; },
    cancelPhoneLogin: () => events.push(['cancelPhone']),
    ...overrides,
  };
  const forbidden = () => { events.push(['forbidden-effect']); throw new Error('unexpected private effect'); };
  vm.runInNewContext(fs.readFileSync(PROFILE_FILE, 'utf8'), {
    require(id) {
      if (id === '../../services/api') return api;
      if (id === '../../utils/require-login') return require('../miniprogram/utils/require-login');
      if (id === '../../utils/layout') return { getNavigationLayout: () => ({ statusBarHeight: 20, navHeight: 44, navSideWidth: 104 }) };
      if (id === '../../config/runtime') return {};
      if (id === '../../config/version') return { version: 'synthetic', channel: 'test' };
      throw new Error('Unexpected page dependency');
    },
    Page: value => { definition = value; },
    wx: { showToast: input => events.push(['toast', input.title]),
      navigateTo: input => events.push(['navigate', input.url]), makePhoneCall: forbidden,
      setStorageSync: forbidden, setStorage: forbidden, uploadFile: forbidden, sendMessage: forbidden },
  }, { filename: PROFILE_FILE });
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  page.onLoad();
  return { page, api, events };
}

test('取消微信手机号授权零注册调用、零存储/拨打/发送，保留游客状态', async () => {
  const f = profileFixture();
  await f.page.login({ detail: { errMsg: 'getPhoneNumber:fail user deny' } });
  assert.equal(f.page.data.authenticated, false);
  assert.equal(f.page.data.loggingIn, false);
  assert.equal(f.page.data.profile.nickname, '未登录');
  assert.deepEqual(f.events, [['toast', '已取消授权，未注册或登录']]);
});

test('手机号授权成功展示同一住户，等待时不重复提交、不自动导航或发起业务动作', async () => {
  let release;
  const f = profileFixture();
  const login = f.api.loginWithPhone;
  f.api.loginWithPhone = async code => { await new Promise(resolve => { release = resolve; }); return login(code); };
  const pending = f.page.login({ detail: { code: 'synthetic-phone-credential' } });
  await f.page.login({ detail: { code: 'synthetic-duplicate' } });
  release();
  await pending;
  assert.equal(f.page.data.authenticated, true);
  assert.equal(f.page.data.profile._id, 'synthetic-resident');
  assert.equal(f.page.data.loggingIn, false);
  assert.deepEqual(f.events, [['phoneLogin', 'synthetic-phone-credential']]);
});

test('手机号授权等待中隐藏或卸载，迟到成功/失败均不渲染、不提示、不恢复登录按钮busy', async () => {
  for (const lifecycle of ['onHide', 'onUnload']) {
    for (const outcome of ['success', 'failure']) {
      let finish;
      const f = profileFixture({ loginWithPhone: () => new Promise((resolve, reject) => {
        finish = () => outcome === 'success' ? resolve({}) : reject(new Error('late-private-server-detail'));
      }) });
      const pending = f.page.login({ detail: { code: 'synthetic-phone-credential' } });
      f.page[lifecycle]();
      finish();
      await pending;
      assert.equal(f.page.data.authenticated, false);
      assert.equal(f.page.data.loggingIn, false);
      assert.equal(f.page.data.profile.nickname, '未登录');
      assert.deepEqual(f.events, [['cancelPhone']]);
      await f.page.loadProfile();
      assert.equal(f.page.data.loading, false, '隐藏后迟到的退出/刷新回调不能留下永久loading');
    }
  }
});

test('资料请求等待中换号或退出，旧身份snapshot不能借新登录状态显示', async () => {
  for (const replacementEpoch of [2, null]) {
    let epoch = 1, finish;
    const f = profileFixture({ getLoginEpoch: () => epoch, isAuthenticated: () => epoch !== null,
      getProfile: () => new Promise(resolve => { finish = resolve; }) });
    const pending = f.page.loadProfile();
    epoch = replacementEpoch;
    finish({ _id: 'private-old-user', authenticated: true, nickname: 'private-old-user', houses: [] });
    await pending;
    assert.equal(f.page.data.authenticated, false);
    assert.equal(f.page.data.profile.nickname, '未登录');
    assert.equal(f.page.data.loading, false);
    assert.ok(!JSON.stringify(f.page.data).includes('private-old-user'));
  }
});

test('手机号登录期间刷新尚未完成，成功登录启动新资料请求且旧刷新不能清掉新住户', async () => {
  let finishLogin, finishRefresh;
  const f = profileFixture();
  const login = f.api.loginWithPhone, getProfile = f.api.getProfile;
  f.api.loginWithPhone = async code => { await new Promise(resolve => { finishLogin = resolve; }); return login(code); };
  let firstRead = true;
  f.api.getProfile = () => {
    if (firstRead) { firstRead = false; return new Promise(resolve => { finishRefresh = resolve; }); }
    return getProfile();
  };
  const pendingLogin = f.page.login({ detail: { code: 'synthetic-phone-credential' } });
  const pendingRefresh = f.page.loadProfile();
  assert.equal(f.page.data.loading, true);
  finishLogin();
  await pendingLogin;
  finishRefresh(null);
  await pendingRefresh;
  assert.equal(f.page.data.authenticated, true);
  assert.equal(f.page.data.profile._id, 'synthetic-resident');
  assert.equal(f.page.data.loading, false);
  assert.equal(f.page.data.loggingIn, false);
});
