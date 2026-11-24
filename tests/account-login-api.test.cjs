'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = path.resolve(__dirname, '../miniprogram/services/api.js');
const localRequire = createRequire(filename);
const VALID_USER = { _id: 'synthetic-user', role: 'user', houses: [], points: 0, name: '合成住户' };
const PASSWORD = 'Synthetic-passphrase-2026!';

function fixture({ respond, runtime = {} } = {}) {
  const config = { mode: 'live', cloudEnv: 'synthetic-env', allowDeviceOperations: false, ...runtime };
  const calls = [];
  const wx = { cloud: { callFunction: async input => {
    calls.push(input);
    return { result: respond ? await respond(input) : { code: 0, userInfo: VALID_USER } };
  } } };
  const module = { exports: {} };
  const requireMock = name => name === '../config/runtime' ? config : localRequire(name);
  vm.runInThisContext(`(function(require,module,exports,wx){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(requireMock, module, module.exports, wx);
  return { api: module.exports, calls, config };
}

test('开户只提交prepare，校验16位码和毫秒期限，不产生登录资料', async () => {
  const { api, calls } = fixture({ respond: () => ({ code: 0, requestCode: 'ABCDEFGHIJKLMNOP', expiresAt: 1900000000000 }) });
  assert.deepEqual(await api.prepareAccountOpening(), { requestCode: 'ABCDEFGHIJKLMNOP', expiresAt: 1900000000000 });
  assert.equal(await api.getProfile(), null);
  assert.deepEqual(calls.map(c => ({ name: c.name, data: c.data })), [{ name: 'accountLogin', data: { action: 'prepare' } }]);
  for (const payload of [{}, { requestCode: 'abcdefghijklmnop', expiresAt: 1 }, { requestCode: '0123456789ABCDEF', expiresAt: 1 }, { requestCode: 'ABCDEFGHIJKLMNOP', expiresAt: '1900000000000' }]) {
    const f = fixture({ respond: () => ({ code: 0, ...payload }) });
    await assert.rejects(f.api.prepareAccountOpening(), /开户信息/);
    assert.equal(await f.api.getProfile(), null);
  }
});

test('账号归一但密码保留原文；成功资料与手机号共用缓存，退出清空', async () => {
  const { api, calls } = fixture();
  const raw = '  Synthetic-password  ';
  const result = await api.loginWithPassword({ username: '  Resident.01 ', password: raw });
  assert.equal(result.authenticated, true);
  assert.equal(result._id, VALID_USER._id);
  assert.deepEqual(calls[0].data, { action: 'login', username: 'resident.01', password: raw });
  assert.equal(calls[0].name, 'accountLogin');
  assert.deepEqual(await api.getProfile(), result);
  api.logout();
  assert.equal(await api.getProfile(), null);
});

test('账号/密码边界在云调用前拒绝，UTF8字节上限不按字符数放宽', async () => {
  for (const [username, password] of [['abc', PASSWORD], ['bad account', PASSWORD], ['user01', 'short'], ['user01', 'x'.repeat(129)], ['user01', '界'.repeat(86)]]) {
    const f = fixture();
    await assert.rejects(f.api.loginWithPassword({ username, password }));
    assert.equal(f.calls.length, 0);
    assert.equal(await f.api.getProfile(), null);
  }
  const f = fixture();
  await f.api.loginWithPassword({ username: 'user01', password: '界'.repeat(85) });
  assert.equal(f.calls.length, 1);
});

test('code0仍必须有完整闭式身份DTO；拒空资料/隐藏凭据/错误类型/取值器', async () => {
  let getterReads = 0;
  const getter = { ...VALID_USER };
  Object.defineProperty(getter, 'phone', { enumerable: true, get() { getterReads++; return 'synthetic'; } });
  const hidden = { ...VALID_USER };
  Object.defineProperty(hidden, 'passwordHash', { value: 'synthetic-only' });
  const invalid = [undefined, {}, { ...VALID_USER, _id: '' }, { ...VALID_USER, role: 'owner' }, { ...VALID_USER, houses: '102' }, { ...VALID_USER, points: -1 }, { ...VALID_USER, passwordHash: 'synthetic-only' }, getter, hidden];
  for (const userInfo of invalid) {
    const f = fixture({ respond: () => ({ code: 0, userInfo }) });
    await assert.rejects(f.api.loginWithPassword({ username: 'user01', password: PASSWORD }), /资料异常/);
    assert.equal(await f.api.getProfile(), null);
  }
  assert.equal(getterReads, 0);
});

test('可选资料字符串按服务端512边界消费，不另缩短合法资料', async () => {
  const user = { ...VALID_USER, name: '名'.repeat(512), community: '苑'.repeat(512), avatar: 'a'.repeat(512) };
  const f = fixture({ respond: () => ({ code: 0, userInfo: user }) });
  const profile = await f.api.loginWithPassword({ username: 'user01', password: PASSWORD });
  assert.equal(profile.name.length, 512);
  assert.equal(profile.community.length, 512);
  for (const key of ['name', 'community', 'avatar']) {
    const bad = fixture({ respond: () => ({ code: 0, userInfo: { ...VALID_USER, [key]: 'x'.repeat(513) } }) });
    await assert.rejects(bad.api.loginWithPassword({ username: 'user01', password: PASSWORD }), /资料异常/);
  }
});

test('AUTH_FAILED统一提示、服务故障分开；不输出后端内部消息', async () => {
  for (const [code, message] of [['AUTH_FAILED', /账号或密码不正确/], ['SERVICE_UNAVAILABLE', /服务暂不可用/]]) {
    const f = fixture({ respond: () => ({ code, msg: 'synthetic internal detail' }) });
    await assert.rejects(f.api.loginWithPassword({ username: 'user01', password: PASSWORD }), error => error.code === code && message.test(error.message) && !error.message.includes('internal'));
    assert.equal(await f.api.getProfile(), null);
  }
});

test('取消/退出/手机号新登录后，密码请求晚返不能重新写入资料', async () => {
  for (const action of ['cancel', 'logout', 'phone']) {
    let finish;
    const f = fixture({ respond: input => input.name === 'phoneLogin'
      ? { code: 0, userInfo: { name: '手机号资料' } }
      : new Promise(resolve => { finish = resolve; }) });
    const pending = f.api.loginWithPassword({ username: 'user01', password: PASSWORD });
    if (action === 'cancel') f.api.cancelPasswordLogin();
    if (action === 'logout') f.api.logout();
    if (action === 'phone') await f.api.loginWithPhone('synthetic-phone-code');
    finish({ code: 0, userInfo: VALID_USER });
    await assert.rejects(pending, /登录已取消/);
    const current = await f.api.getProfile();
    assert.equal(current ? current.name : null, action === 'phone' ? '手机号资料' : null);
  }
});

test('显式栖山苑预设232可见且所有首层别名详情拒绝，无云调用', async () => {
  const f = fixture({ runtime: { testPropertyPreset: 'qishanyuan-test-v1' }, respond: () => { throw new Error('must not call cloud'); } });
  const result = await f.api.listHouses({ pageSize: 500, listingVisible: false, includeHidden: true });
  assert.equal(result.total, 232);
  assert.equal(result.houses.length, 232);
  assert.equal(result.isTestPreset, true);
  assert.ok(result.houses.every(h => h.isTestPreset === true && h.isPublic === false && h.canBook === false && h.price === null && h.area === null && h.floorNumber >= 2));
  const preset = localRequire('../data/qishanyuan-test-preset');
  for (const room of preset.getPreset().rooms.filter(r => r.floorNumber === 1)) {
    for (const id of [room.id, room._id, room.houseId, room.roomNo]) {
      assert.equal(await f.api.getHouse(id), null);
      assert.equal((await f.api.listHouses({ id, includeHidden: true })).total, 0);
    }
  }
  const room = result.houses[0];
  assert.equal((await f.api.getHouse(room.id)).roomNo, room.roomNo);
  assert.equal((await f.api.listHouses({ roomType: '1' })).total, 232);
  assert.equal((await f.api.listHouses({ roomType: '2' })).total, 0);
  assert.equal((await f.api.listHouses({ priceMin: 0 })).total, 0, '未知租金不是0元');
  const second = await f.api.listHouses({ page: 2, pageSize: 20 });
  assert.equal(second.houses[0].id, result.houses[20].id);
  assert.equal(f.calls.length, 0);
});

test('未显式选预设时真实云失败不fallback，错误开关也不启用预设', async () => {
  for (const testPropertyPreset of [undefined, true, 'qishanyuan-test-v2']) {
    const f = fixture({ runtime: { testPropertyPreset }, respond: () => { throw new Error('synthetic offline'); } });
    await assert.rejects(f.api.listHouses(), /服务连接失败/);
    await assert.rejects(f.api.getHouse('102'), /服务连接失败/);
    assert.equal(f.calls.length, 2);
  }
});
