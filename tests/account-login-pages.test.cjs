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
    prepareAccountOpening: async () => { events.push(['prepare']); return { requestCode: 'ABCDEFGHIJKLMNOP', expiresAt: 1900000000000 }; },
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
  const profile = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/index.wxml'), 'utf8');
  assert.match(profile, /open-type="getPhoneNumber"/);
  assert.match(profile, /bindtap="openAccountLogin"/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/app.json'))).pages.includes('pages/account-login/index'));
  const source = fs.readFileSync(FILE, 'utf8');
  assert.doesNotMatch(source, /setStorage|setClipboardData|console\.|openid|unionid/);
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

test('获取开户码不登录；离开后清除，迟到prepare不重新显示', async () => {
  const f = pageFixture();
  f.page.onPasswordInput({ detail: { value: 'Synthetic-password' } });
  await f.page.prepareOpening();
  assert.equal(f.page.data.requestCode, 'ABCDEFGHIJKLMNOP');
  assert.equal(f.page.data.password, '');
  assert.equal(f.events.filter(e => e[0] === 'login').length, 0);
  assert.equal(f.events.filter(e => e[0] === 'prepare').length, 1);
  f.page.onHide();
  assert.equal(f.page.data.requestCode, '');
  let finish;
  const late = pageFixture({ prepareAccountOpening: () => new Promise(resolve => { finish = resolve; }) });
  const pending = late.page.prepareOpening();
  late.page.onHide();
  finish({ requestCode: 'ABCDEFGHIJKLMNOP', expiresAt: 1900000000000 });
  await pending;
  assert.equal(late.page.data.requestCode, '');
  assert.equal(late.page.data.preparing, false);
});
