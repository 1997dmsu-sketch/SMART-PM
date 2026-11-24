'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMain } = require('../cloudfunctions/phoneLogin');
const { TenantAuthMemoryDB } = require('./support/tenant-auth-memory-db.cjs');
const { TenantAccountService } = require('../cloudfunctions/accountLogin/lib/service');
const CONTEXT = { APPID: 'wx-synthetic-app', OPENID: 'trusted-openid' };
const NOW = 1795564800000;

function harness(options = {}) {
  const db = options.db || new TenantAuthMemoryDB();
  for (const user of options.users || []) db._write('users', user._id, { _openid: CONTEXT.OPENID, ...user });
  for (const [index, owner] of (options.owners || []).entries()) db._write('owners', `owner-${index}`, { phone: 'test-phone', ...owner });
  const originalCollection = db.collection.bind(db);
  db.collection = (name) => {
    const collection = originalCollection(name);
    if (!(name === 'users' && options.usersError) && !(name === 'owners' && options.ownersError)) return collection;
    return { ...collection, where() { return { limit() { return this; }, async get() { throw new Error('SYNTHETIC_DATABASE_FAILURE'); } }; } };
  };
  const phoneCalls = [];
  const cloud = { getWXContext: () => options.context || CONTEXT,
    openapi: { phonenumber: { async getPhoneNumber(argument) {
      phoneCalls.push(argument);
      if (options.phoneError) throw options.phoneError;
      return options.phoneResult || { phoneInfo: { purePhoneNumber: 'test-phone' } };
    } } } };
  const before = db.snapshot();
  return { db, before, phoneCalls, run: createMain({ cloud, db, now: () => NOW }) };
}

test('login rejects missing authorization or identity before cloud calls', async () => {
  for (const [options, event, code] of [[{}, {}, 400], [{ context: {} }, { code: 'temporary-code' }, 403]]) {
    const h = harness(options);
    assert.equal((await h.run(event)).code, code);
    assert.equal(h.phoneCalls.length, 0);
    assert.deepEqual(h.db.snapshot(), h.before);
  }
});
test('new login uses trusted WeChat identity and creates an unbound user', async () => {
  const h = harness();
  const result = await h.run({ code: 'temporary-code', OPENID: 'spoofed' });
  assert.equal(result.code, 0);
  assert.equal(result.bound, false);
  assert.equal(h.db.rows('users').length, 1);
  assert.equal(h.db.rows('users')[0]._openid, CONTEXT.OPENID);
  assert.equal(h.db.rows('users')[0].role, 'user');
  assert.equal(h.phoneCalls[0].code, 'temporary-code');
});
test('returning user updates existing account without duplicate creation', async () => {
  const h = harness({ users: [{ _id: 'existing', houses: [] }] });
  assert.equal((await h.run({ code: 'code' })).code, 0);
  assert.equal(h.db.rows('users').length, 1);
  assert.equal(h.db.rows('users')[0]._id, 'existing');
  assert.equal(h.db.rows('users')[0].phone, 'test-phone');
  assert.equal(h.db.rows('tenant_auth_identities')[0].userId, 'existing');
});
test('注册本身不自动新增房屋或门禁权限：匹配 owners 行也不导入', async () => {
  const h = harness({ owners: [{ name: '测试业主', houses: [{ houseId: 'house-1' }, {}] }] });
  const result = await h.run({ code: 'code' });
  assert.equal(result.code, 0);
  assert.equal(result.bound, false);
  assert.deepEqual(result.userInfo.houses, []);
  assert.equal(result.userInfo.name, undefined, '不导入旧业主姓名');
  assert.equal(h.db.rows('users')[0].housesManaged, undefined);
});

test('既有房屋绑定由用户自身档案保留，不依赖旧 owners 集合', async () => {
  for (const ownersError of [false, true]) {
    const h = harness({ users: [{ _id: 'existing', houses: ['house-1'] }], ownersError });
    const result = await h.run({ code: 'code' });
    assert.equal(result.code, 0);
    assert.equal(result.bound, true);
    assert.deepEqual(result.userInfo.houses, ['house-1']);
  }
});
test('phone exchange errors cannot create an account', async () => {
  for (const options of [{ phoneError: { errMsg: '授权已过期' } }, { phoneError: { errno: 1400001 } }, { phoneResult: {} }]) {
    const h = harness(options);
    assert.equal((await h.run({ code: 'code' })).code, 500);
    assert.deepEqual(h.db.snapshot(), h.before);
  }
});
test('user database failure returns login failure', async () => {
  const h = harness({ usersError: true });
  assert.equal((await h.run({ code: 'code' })).code, 'SERVICE_UNAVAILABLE');
  assert.deepEqual(h.db.snapshot(), h.before);
});
test('manual admin binding is not overwritten by any login path', async () => {
  for (const houses of [[], ['manually-bound']]) {
    const h = harness({ users: [{ _id: 'existing', houses, housesManaged: true }], owners: [{ houses: [{ houseId: 'legacy-house' }] }] });
    const result = await h.run({ code: 'code' });
    assert.equal(result.code, 0);
    assert.deepEqual(result.userInfo.houses, houses);
    assert.equal(result.bound, houses.length > 0);
    assert.equal(h.db.rows('users').length, 1);
  }
});

test('phone and password login remain the same canonical user and preserve admin houses', async () => {
  const h = harness({ users: [{ _id: 'existing', houses: ['manually-bound'], housesManaged: true, wechatAppId: 'wx-synthetic-app' }] });
  const service = new TenantAccountService({ db: h.db, now: () => NOW });
  const phone = await h.run({ code: 'code' });
  assert.equal(phone.code, 0);
  const account = await service.createAccount({ id: 'admin-test', role: 'admin' }, {
    userId: phone.userInfo._id, username: 'tenant-test', password: 'Valid password 123!',
  });
  const password = await service.login(CONTEXT, { username: 'tenant-test', password: 'Valid password 123!' });
  assert.equal(password.code, 0);
  assert.equal(phone.userInfo._id, account.userId);
  assert.equal(password.userInfo._id, phone.userInfo._id);
  assert.deepEqual(password.userInfo.houses, ['manually-bound']);
  assert.equal(h.db.rows('users').length, 1);
});

test('phone login rechecks the user inside the transaction after concurrent admin binding', async () => {
  const h = harness({ users: [{ _id: 'existing', houses: [] }] });
  const core = require('../cloudfunctions/phoneLogin/lib/identity-core');
  await core.withIdentity({ db: h.db, context: CONTEXT, now: () => NOW });
  let injected = false;
  h.db.beforeCommit = async () => {
    if (injected) return;
    injected = true;
    const user = h.db.row('users', 'existing');
    h.db._write('users', 'existing', { ...user, houses: ['admin-new-house'], housesManaged: true });
  };
  const result = await h.run({ code: 'code' });
  assert.equal(result.code, 0);
  assert.deepEqual(result.userInfo.houses, ['admin-new-house']);
  assert.ok(h.db.commitLog.some((entry) => entry.result === 'conflict-retry'));
});

test('同一手机号被其他微信身份使用时失败关闭，不重复建人', async () => {
  const first = harness();
  const firstResult = await first.run({ code: 'code' });
  assert.equal(firstResult.code, 0);
  assert.equal(first.db.rows('users').length, 1);

  const second = harness({ db: first.db, context: { APPID: 'wx-synthetic-app', OPENID: 'other-openid' } });
  const before = second.db.snapshot();
  const conflict = await second.run({ code: 'code' });
  const after = second.db.snapshot();
  assert.equal(conflict.code, 409);
  assert.deepEqual(after, before, '手机号冲突不得创建第二个用户或写入任何数据');

  const again = harness({ db: first.db });
  assert.equal((await again.run({ code: 'code' })).code, 0, '本人重登仍复用同一用户');
  assert.equal(again.db.rows('users').length, 1);
});

test('手机号冲突检查在查询不可用时保持登录可用（fail-open）', async () => {
  const db = new TenantAuthMemoryDB();
  const originalCollection = db.collection.bind(db);
  db.collection = (name) => {
    const collection = originalCollection(name);
    if (name !== 'users') return collection;
    return { ...collection, where(filter) {
      if (filter && Object.hasOwn(filter, 'phone')) {
        return { limit() { return this; }, async get() { throw new Error('SYNTHETIC_DATABASE_FAILURE'); } };
      }
      return collection.where(filter);
    } };
  };
  const h = harness({ db, users: [{ _id: 'existing', houses: [] }] });
  const result = await h.run({ code: 'code' });
  assert.equal(result.code, 0, '冲突检查查询不可用不得阻断既有用户登录');
  assert.equal(db.rows('users')[0].phone, 'test-phone');
});
