'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'miniprogram/pages/account-login/index.js');

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
  const profile = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/index.wxml'), 'utf8');
  assert.match(profile, /open-type="getPhoneNumber"/);
  assert.match(profile, /bindtap="openAccountLogin"/);
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
  page.onPasswordInput({ detail: { value: 'Synthetic-password' } });
  page.onHide();
  assert.equal(page.data.password, '', '离开页面仍必须清除密码输入');
});
