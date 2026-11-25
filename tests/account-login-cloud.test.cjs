'use strict';

// All accounts, identities, users and passwords below are synthetic. These
// tests exercise the production service and real scrypt, never a live SDK.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scryptSync, createHash } = require('node:crypto');
const { TenantAuthMemoryDB } = require('./support/tenant-auth-memory-db.cjs');
const { TenantAccountService, COLLECTIONS } = require('../cloudfunctions/accountLogin/lib/service.js');
const { createMain } = require('../cloudfunctions/accountLogin/index.js');
const { createMain: createPhoneMain } = require('../cloudfunctions/phoneLogin/index.js');

const CONTEXT = Object.freeze({ APPID: 'synthetic-app-main', OPENID: 'synthetic-wechat-alice' });
const OTHER_CONTEXT = Object.freeze({ APPID: 'synthetic-app-main', OPENID: 'synthetic-wechat-bob' });
const ADMIN = Object.freeze({ id: 'synthetic-admin-1', role: 'admin' });
const PASSWORD = 'Synthetic correct password 784! ';
const NEW_PASSWORD = 'Synthetic replacement password 928!';
const FIXED_NOW = Date.parse('2026-11-25T03:00:00.000Z');
const DTO_KEYS = ['createdAt', 'credentialVersion', 'id', 'revision', 'status', 'updatedAt', 'userId', 'username'];

function fixture() {
  const db = new TenantAuthMemoryDB();
  let currentNow = FIXED_NOW;
  const now = () => currentNow;
  return { db, now, service: new TenantAccountService({ db, now }),
    setNow(value) { currentNow = value; } };
}

// The only authentication fact in a verified fixture comes from the real phone
// entry point with a synthetic WeChat server response. Legacy profile data is
// ordinary test data and never supplies a phone or verification timestamp.
async function seedVerifiedUser(db, { id = 'wxuser_verified', openid = CONTEXT.OPENID,
  appId = CONTEXT.APPID, phone = '13800000001', name = '验证住户', houses = [] } = {}) {
  db._write(COLLECTIONS.USERS, id, { _id: id, _openid: openid, role: 'user',
    houses, points: 0, name, createdAt: FIXED_NOW, lastLoginAt: FIXED_NOW });
  const main = createPhoneMain({ db, now: () => FIXED_NOW, cloud: {
    getWXContext: () => ({ APPID: appId, OPENID: openid }),
    openapi: { phonenumber: { getPhoneNumber: async () => ({ phoneInfo: { purePhoneNumber: phone } }) } },
  } });
  const result = await main({ code: 'synthetic-phone-code' });
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.userInfo._id, id);
  const bindingId = `wx_${createHash('sha256').update(`${appId}\0${openid}`).digest('hex')}`;
  return { userId: result.userInfo._id, openid, appId, phone, bindingId };
}

function exceptRate(db) {
  return db.snapshot().filter(([collection]) => collection !== COLLECTIONS.RATE_LIMITS);
}

function assertPublicAccount(account) {
  assert.deepEqual(Object.keys(account).sort(), DTO_KEYS);
  assert.equal(typeof account.id, 'string');
  assert.equal(typeof account.userId, 'string');
  assert.ok(account.id && account.userId);
  assert.ok(Number.isSafeInteger(account.revision) && account.revision > 0);
  assert.ok(Number.isSafeInteger(account.credentialVersion) && account.credentialVersion > 0);
}

async function provision(ctx, { userId, username = 'tenant.alice', password = PASSWORD } = {}) {
  if (!userId) userId = (await seedVerifiedUser(ctx.db)).userId;
  const account = await ctx.service.createAccount(ADMIN, { userId, username, password });
  assertPublicAccount(account);
  return { account, userId, username, password };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('开户码已按最新需求停用：云入口拒绝 prepare，服务层不再生成码，零写', async () => {
  const ctx = fixture();
  const main = createMain({ db: ctx.db, now: ctx.now, cloud: { getWXContext: () => CONTEXT } });
  ctx.db._write('tenant_auth_enrollments', 'historic-code', {
    requestCodeHash: 'historic-synthetic-hash', userId: 'historic-user', status: 'pending',
  });
  for (const request of [{ action: 'prepare' }, { action: 'prepare', requestCode: 'ABCDEFGHIJKLMNOP' },
    { action: 'login', requestCode: 'ABCDEFGHIJKLMNOP', username: 'tenant.old', password: PASSWORD }]) {
    const before = structuredClone(ctx.db.snapshot());
    const result = await main(request);
    const after = structuredClone(ctx.db.snapshot());
    assert.equal(result.code, 'AUTH_FAILED');
    assert.deepEqual(after, before, '旧开户码调用不得新增、消费或删除历史数据');
    assert.equal(JSON.stringify(result).includes('requestCode'), false);
  }
  assert.equal(typeof ctx.service.prepare, 'undefined', '服务层不再提供 prepare');
});

test('旧开户码不得继续开户：createAccount 拒绝 requestCode 输入，零写', async () => {
  const ctx = fixture();
  await seedVerifiedUser(ctx.db, {});
  const before = structuredClone(ctx.db.snapshot());
  await assert.rejects(() => ctx.service.createAccount(ADMIN, { requestCode: 'ABCDEFGHIJKLMNOP', username: 'tenant.old', password: PASSWORD }),
    (error) => error.code === 'INVALID_INPUT');
  const after = structuredClone(ctx.db.snapshot());
  assert.deepEqual(after, before);
  assert.equal(ctx.db.rows(COLLECTIONS.ACCOUNTS).length, 0);
});

test('只为已完成可信手机号注册的住户开通：未验证/伪造 userId 拒绝且零写', async () => {
  const noPhone = fixture();
  noPhone.db._write(COLLECTIONS.USERS, 'wxuser-nophone', { _id: 'wxuser-nophone', _openid: CONTEXT.OPENID,
    wechatAppId: CONTEXT.APPID, role: 'user', houses: [], points: 0, createdAt: FIXED_NOW });
  let before = structuredClone(noPhone.db.snapshot());
  await assert.rejects(() => noPhone.service.createAccount(ADMIN, { userId: 'wxuser-nophone', username: 'tenant.one', password: PASSWORD }),
    (error) => error.code === 'USER_NOT_VERIFIED' && error.status === 409);
  assert.deepEqual(structuredClone(noPhone.db.snapshot()), before, '未验证手机号住户不得开通账号');

  for (const userId of ['', 'missing-user', 'a/b', null, 7]) {
    const ctx = fixture();
    const before2 = structuredClone(ctx.db.snapshot());
    await assert.rejects(() => ctx.service.createAccount(ADMIN, { userId, username: 'tenant.one', password: PASSWORD }),
      (error) => ['INVALID_INPUT', 'USER_NOT_VERIFIED'].includes(error.code));
    assert.deepEqual(structuredClone(ctx.db.snapshot()), before2);
  }

  const noIdentity = fixture();
  const seeded = await seedVerifiedUser(noIdentity.db, {});
  noIdentity.db._write(COLLECTIONS.IDENTITIES, seeded.bindingId, null);
  before = structuredClone(noIdentity.db.snapshot());
  await assert.rejects(() => noIdentity.service.createAccount(ADMIN, { userId: seeded.userId, username: 'tenant.one', password: PASSWORD }),
    (error) => error.code === 'IDENTITY_UNVERIFIED');
  assert.deepEqual(structuredClone(noIdentity.db.snapshot()), before);
});

test('真实 salted scrypt 验证原文密码，公开 DTO/users/audit 不泄露凭据', async () => {
  const ctx = fixture();
  const { account } = await provision(ctx, { username: '  TENANT.Alice  ' });
  assert.equal(account.username, 'tenant.alice');
  const stored = ctx.db.row(COLLECTIONS.ACCOUNTS, account.id);
  assert.equal(stored.password.algorithm, 'scrypt-v1');
  assert.match(stored.password.saltHex, /^[a-f0-9]{64}$/);
  assert.match(stored.password.hashHex, /^[a-f0-9]{128}$/);
  const actual = scryptSync(PASSWORD, Buffer.from(stored.password.saltHex, 'hex'), 64,
    { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  assert.equal(actual.toString('hex'), stored.password.hashHex);
  const success = await ctx.service.login(CONTEXT, { username: ' TENANT.ALICE ', password: PASSWORD });
  assert.equal(success.code, 0);
  assert.equal(success.userInfo._id, account.userId);
  assert.equal(ctx.db.row(COLLECTIONS.USERS, account.userId)._openid, CONTEXT.OPENID);
  for (const value of [PASSWORD, stored.password.saltHex, stored.password.hashHex]) {
    assert.ok(!JSON.stringify(success).includes(value));
    assert.ok(!JSON.stringify(await ctx.service.listAccounts(ADMIN)).includes(value));
    assert.ok(!JSON.stringify(ctx.db.rows(COLLECTIONS.USERS)).includes(value));
    assert.ok(!JSON.stringify(ctx.db.rows(COLLECTIONS.AUDIT)).includes(value));
  }
  const listed = await ctx.service.listAccounts(ADMIN);
  assert.equal(Array.isArray(listed), true);
  assert.equal(listed.length, 1);
  assertPublicAccount(listed[0]);
  const trimmed = await ctx.service.login(CONTEXT, { username: 'tenant.alice', password: PASSWORD.trim() });
  assert.equal(trimmed.code, 'AUTH_FAILED', '密码不得 trim 后再核验');
});

test('未知账号、错误密码、不同微信/APPID、停用统一失败且除限速外零写', async () => {
  const scenarios = [
    { context: CONTEXT, username: 'unknown.tenant', password: PASSWORD },
    { context: CONTEXT, username: 'tenant.alice', password: NEW_PASSWORD },
    { context: OTHER_CONTEXT, username: 'tenant.alice', password: PASSWORD },
    { context: { ...CONTEXT, APPID: 'synthetic-other-app' }, username: 'tenant.alice', password: PASSWORD },
    { context: CONTEXT, username: 'tenant.alice', password: PASSWORD, disabled: true },
  ];
  let uniform;
  for (const scenario of scenarios) {
    const ctx = fixture();
    const { account } = await provision(ctx);
    if (scenario.disabled) await ctx.service.setStatus(ADMIN, { accountId: account.id, status: 'disabled', expectedRevision: account.revision });
    const before = exceptRate(ctx.db);
    const result = await ctx.service.login(scenario.context, { username: scenario.username, password: scenario.password });
    const after = exceptRate(ctx.db);
    assert.equal(result.code, 'AUTH_FAILED');
    assert.deepEqual(after, before, '失败不能更新 users、绑定、凭据或审计');
    if (!uniform) uniform = result;
    else assert.deepEqual(result, uniform, '失败 DTO 不区分账号存在、绑定和启停');
  }
});

test('登录持久每15分钟10次，成功也消耗预算', async () => {
  const ctx = fixture();
  const { account } = await provision(ctx);
  for (let i = 1; i <= 10; i += 1) {
    const freshService = new TenantAccountService({ db: ctx.db, now: ctx.now });
    const result = await freshService.login(CONTEXT, { username: 'tenant.alice', password: PASSWORD });
    assert.equal(result.code, 0, `第${i}次应在预算内`);
    assert.equal(result.userInfo._id, account.userId);
  }
  let before = exceptRate(ctx.db);
  const limited = await new TenantAccountService({ db: ctx.db, now: ctx.now }).login(CONTEXT, { username: 'tenant.alice', password: PASSWORD });
  let after = exceptRate(ctx.db);
  assert.equal(limited.code, 'AUTH_FAILED');
  assert.deepEqual(after, before);
  ctx.setNow(FIXED_NOW + 15 * 60 * 1000);
  assert.equal((await ctx.service.login(CONTEXT, { username: 'tenant.alice', password: PASSWORD })).code, 0);
});

test('管理员开通/重置/状态与审计原子回滚；无事务不降级', async () => {
  const creation = fixture();
  await seedVerifiedUser(creation.db, {});
  let before = structuredClone(creation.db.snapshot());
  creation.db.failCommits = 1;
  await assert.rejects(() => creation.service.createAccount(ADMIN, { userId: 'wxuser_verified', username: 'tenant.alice', password: PASSWORD }),
    (error) => error.code === 'SERVICE_UNAVAILABLE');
  let after = structuredClone(creation.db.snapshot());
  assert.deepEqual(after, before);
  assert.equal(creation.db.rows(COLLECTIONS.ACCOUNTS).length, 0);
  for (const action of ['reset', 'disable']) {
    const ctx = fixture();
    const { account } = await provision(ctx);
    before = structuredClone(ctx.db.snapshot());
    ctx.db.failCommits = 1;
    const op = action === 'reset'
      ? () => ctx.service.resetPassword(ADMIN, { accountId: account.id, newPassword: NEW_PASSWORD, expectedRevision: account.revision })
      : () => ctx.service.setStatus(ADMIN, { accountId: account.id, status: 'disabled', expectedRevision: account.revision });
    await assert.rejects(op, (error) => error.code === 'SERVICE_UNAVAILABLE');
    after = structuredClone(ctx.db.snapshot());
    assert.deepEqual(after, before);
  }
  const unavailable = fixture();
  await seedVerifiedUser(unavailable.db, {});
  unavailable.db.runTransaction = undefined;
  before = structuredClone(unavailable.db.snapshot());
  await assert.rejects(() => unavailable.service.createAccount(ADMIN, { userId: 'wxuser_verified', username: 'tenant.alice', password: PASSWORD }),
    (error) => error.code === 'SERVICE_UNAVAILABLE');
  after = structuredClone(unavailable.db.snapshot());
  assert.deepEqual(after, before);
});

test('同一住户两个创建者真实交错，仅一个账户/绑定/审计提交', async () => {
  const ctx = fixture();
  const seeded = await seedVerifiedUser(ctx.db, {});
  const paused = deferred();
  const resumed = deferred();
  let first = true;
  ctx.db.beforeCommit = async (info) => {
    if (first && info.writes.some((write) => write.collection === COLLECTIONS.ACCOUNTS)) {
      first = false;
      paused.resolve();
      await resumed.promise;
    }
  };
  const lateCreator = ctx.service.createAccount(ADMIN, { userId: seeded.userId, username: 'late.tenant', password: PASSWORD });
  await paused.promise;
  const winner = await ctx.service.createAccount(ADMIN, { userId: seeded.userId, username: 'winner.tenant', password: NEW_PASSWORD });
  resumed.resolve();
  await assert.rejects(() => lateCreator, (error) => error.code === 'ACCOUNT_EXISTS');
  assert.equal(ctx.db.rows(COLLECTIONS.ACCOUNTS).length, 1);
  assert.equal(ctx.db.rows(COLLECTIONS.ACCOUNTS)[0]._id, winner.id);
  assert.equal(ctx.db.rows(COLLECTIONS.AUDIT).length, 1);
  assert.ok(ctx.db.commitLog.some((entry) => entry.result === 'conflict-retry'), '确实发生提交冲突后重试');
});

test('规范化同名账户 create-only，不能重绑给另一微信用户', async () => {
  const ctx = fixture();
  const first = await provision(ctx);
  const other = await seedVerifiedUser(ctx.db, { id: 'wxuser_bob', openid: OTHER_CONTEXT.OPENID, phone: '13800000002' });
  const before = structuredClone(ctx.db.snapshot());
  await assert.rejects(() => ctx.service.createAccount(ADMIN, { userId: other.userId, username: ' TENANT.ALICE ', password: NEW_PASSWORD }),
    (error) => error.code === 'ACCOUNT_EXISTS');
  const after = structuredClone(ctx.db.snapshot());
  assert.deepEqual(after, before);
  assert.equal(ctx.db.row(COLLECTIONS.ACCOUNTS, first.account.id).userId, first.account.userId);
});

test('重置换盐推进版本，旧密码/陈旧CAS拒绝；停用不改变微信用户或房产', async () => {
  const ctx = fixture();
  const { account } = await provision(ctx);
  const storedBefore = ctx.db.row(COLLECTIONS.ACCOUNTS, account.id);
  const changed = await ctx.service.resetPassword(ADMIN, { accountId: account.id, newPassword: NEW_PASSWORD, expectedRevision: account.revision });
  assertPublicAccount(changed);
  assert.equal(changed.revision, account.revision + 1);
  assert.equal(changed.credentialVersion, account.credentialVersion + 1);
  const storedAfter = ctx.db.row(COLLECTIONS.ACCOUNTS, account.id);
  assert.notEqual(storedAfter.password.saltHex, storedBefore.password.saltHex);
  assert.notEqual(storedAfter.password.hashHex, storedBefore.password.hashHex);
  assert.equal((await ctx.service.login(CONTEXT, { username: 'tenant.alice', password: PASSWORD })).code, 'AUTH_FAILED');
  assert.equal((await ctx.service.login(CONTEXT, { username: 'tenant.alice', password: NEW_PASSWORD })).code, 0);
  let before = structuredClone(ctx.db.snapshot());
  await assert.rejects(() => ctx.service.setStatus(ADMIN, { accountId: account.id, status: 'disabled', expectedRevision: account.revision }),
    (error) => error.code === 'REVISION_CONFLICT');
  let after = structuredClone(ctx.db.snapshot());
  assert.deepEqual(after, before);
  const usersBefore = structuredClone(ctx.db.rows(COLLECTIONS.USERS));
  const disabled = await ctx.service.setStatus(ADMIN, { accountId: account.id, status: 'disabled', expectedRevision: changed.revision });
  assert.equal(disabled.status, 'disabled');
  assert.deepEqual(ctx.db.rows(COLLECTIONS.USERS), usersBefore);
  assert.equal((await ctx.service.login(CONTEXT, { username: 'tenant.alice', password: NEW_PASSWORD })).code, 'AUTH_FAILED');
});

test('密码证明已捕获后重置或停用再启用，旧版本证明不能完成登录', async () => {
  for (const mutate of ['reset', 'disable-enable']) {
    const ctx = fixture();
    const { account } = await provision(ctx);
    const paused = deferred();
    const resumed = deferred();
    let first = true;
    ctx.db.afterRead = async ({ collection }) => {
      if (first && collection === COLLECTIONS.ACCOUNTS) {
        first = false;
        paused.resolve();
        await resumed.promise;
      }
    };
    const loggingIn = ctx.service.login(CONTEXT, { username: 'tenant.alice', password: PASSWORD });
    await paused.promise;
    if (mutate === 'reset') {
      await ctx.service.resetPassword(ADMIN, { accountId: account.id, newPassword: NEW_PASSWORD, expectedRevision: account.revision });
    } else {
      const disabled = await ctx.service.setStatus(ADMIN, { accountId: account.id, status: 'disabled', expectedRevision: account.revision });
      await ctx.service.setStatus(ADMIN, { accountId: account.id, status: 'active', expectedRevision: disabled.revision });
    }
    const before = exceptRate(ctx.db);
    resumed.resolve();
    const result = await loggingIn;
    const after = exceptRate(ctx.db);
    assert.equal(result.code, 'AUTH_FAILED', `${mutate} 必须使旧证明失效`);
    assert.deepEqual(after, before);
  }
});

test('非管理员不能列出/选择住户、开通、重置或停用租客账号，全部零写', async () => {
  const ctx = fixture();
  const { account, userId } = await provision(ctx);
  const actions = [
    (actor) => ctx.service.listAccounts(actor),
    (actor) => ctx.service.listVerifiedUsers(actor),
    (actor) => ctx.service.createAccount(actor, { userId, username: 'another.tenant', password: PASSWORD }),
    (actor) => ctx.service.resetPassword(actor, { accountId: account.id, newPassword: NEW_PASSWORD, expectedRevision: account.revision }),
    (actor) => ctx.service.setStatus(actor, { accountId: account.id, status: 'disabled', expectedRevision: account.revision }),
  ];
  for (const actor of [null, { id: 'synthetic-user', role: 'user' }, { role: 'admin' }]) {
    for (const action of actions) {
      const before = structuredClone(ctx.db.snapshot());
      await assert.rejects(() => action(actor), (error) => error.code === 'ADMIN_REQUIRED');
      const after = structuredClone(ctx.db.snapshot());
      assert.deepEqual(after, before);
    }
  }
});

test('数据库故障只返回 SERVICE_UNAVAILABLE，不泄露异常或密码', async () => {
  const ctx = fixture();
  await provision(ctx);
  ctx.db.failReads = true;
  const result = await ctx.service.login(CONTEXT, { username: 'tenant.alice', password: PASSWORD });
  assert.equal(result.code, 'SERVICE_UNAVAILABLE');
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('SYNTHETIC_DATABASE_FAILURE'));
  assert.ok(!serialized.includes(PASSWORD));
  assert.ok(!serialized.includes('saltHex'));
  assert.ok(!serialized.includes('hashHex'));
});

test('用户名/密码冻结边界：规范化账号，保留密码原文及 UTF8 字节上限', async () => {
  const invalidNames = ['abc', '.abcd', '_abcd', '-abcd', 'ab cd', '租客abcd', 'a'.repeat(33), '', null, 7];
  for (const username of invalidNames) {
    const ctx = fixture();
    await seedVerifiedUser(ctx.db, {});
    const before = structuredClone(ctx.db.snapshot());
    await assert.rejects(() => ctx.service.createAccount(ADMIN, { userId: 'wxuser_verified', username, password: PASSWORD }),
      (error) => error.code === 'INVALID_INPUT');
    const after = structuredClone(ctx.db.snapshot());
    assert.deepEqual(after, before);
  }
  const invalidPasswords = ['x'.repeat(7), 'x'.repeat(129), '界'.repeat(86), null, undefined, 999];
  for (const password of invalidPasswords) {
    const ctx = fixture();
    await seedVerifiedUser(ctx.db, {});
    const before = structuredClone(ctx.db.snapshot());
    await assert.rejects(() => ctx.service.createAccount(ADMIN, { userId: 'wxuser_verified', username: 'tenant.alice', password }),
      (error) => error.code === 'INVALID_INPUT');
    const after = structuredClone(ctx.db.snapshot());
    assert.deepEqual(after, before);
  }
  for (const [username, password] of [['tenant.eight', 'x'.repeat(8)], ['a000', 'x'.repeat(12)], ['a'.repeat(32), 'x'.repeat(128)], ['tenant.utf8', '界'.repeat(85)]]) {
    const ctx = fixture();
    const created = await provision(ctx, { username, password });
    const result = await ctx.service.login(CONTEXT, { username, password });
    assert.equal(result.code, 0);
    assert.equal(result.userInfo._id, created.account.userId);
  }
});

test('缺少可信APPID/OPENID或自报客户端身份拒绝，不创建用户或账户', async () => {
  const ctx = fixture();
  const invalidContexts = [{ OPENID: CONTEXT.OPENID }, { APPID: CONTEXT.APPID }, {}, null];
  for (const context of invalidContexts) {
    const before = structuredClone(ctx.db.snapshot());
    const loggedIn = await ctx.service.login(context, { username: 'tenant.alice', password: PASSWORD });
    const after = structuredClone(ctx.db.snapshot());
    assert.equal(loggedIn.code, 'AUTH_FAILED');
    assert.deepEqual(after, before);
  }
  const provisioned = fixture();
  await provision(provisioned);
  const before = structuredClone(provisioned.db.snapshot());
  const response = await provisioned.service.login(CONTEXT, { username: 'tenant.alice', password: PASSWORD, OPENID: OTHER_CONTEXT.OPENID });
  const after = structuredClone(provisioned.db.snapshot());
  assert.equal(response.code, 'AUTH_FAILED');
  assert.deepEqual(after, before);
});

test('并发争用最后一个登录预算，最多一项获得认证，记录不丢失', async () => {
  const ctx = fixture();
  await provision(ctx);
  for (let i = 0; i < 9; i += 1) assert.equal((await ctx.service.login(CONTEXT, { username: 'tenant.alice', password: PASSWORD })).code, 0);
  const results = await Promise.all([
    new TenantAccountService({ db: ctx.db, now: ctx.now }).login(CONTEXT, { username: 'tenant.alice', password: PASSWORD }),
    new TenantAccountService({ db: ctx.db, now: ctx.now }).login(CONTEXT, { username: 'tenant.alice', password: PASSWORD }),
  ]);
  assert.equal(results.filter((result) => result.code === 0).length, 1);
  assert.equal(results.filter((result) => result.code === 'AUTH_FAILED').length, 1);
  const rate = ctx.db.rows(COLLECTIONS.RATE_LIMITS).find((row) => row.operation === 'login');
  assert.equal(rate.attempts, 10);
  assert.ok(ctx.db.commitLog.some((entry) => entry.result === 'conflict-retry'));
});

test('登录无真实事务失败关闭，凭据和既有用户保持不变', async () => {
  const ctx = fixture();
  await provision(ctx);
  ctx.db.runTransaction = undefined;
  const before = structuredClone(ctx.db.snapshot());
  const response = await ctx.service.login(CONTEXT, { username: 'tenant.alice', password: PASSWORD });
  const after = structuredClone(ctx.db.snapshot());
  assert.equal(response.code, 'SERVICE_UNAVAILABLE');
  assert.deepEqual(after, before);
});

test('真实云入口只信 getWXContext：prepare 拒绝、管理员动作不暴露、登录正常', async () => {
  const ctx = fixture();
  await seedVerifiedUser(ctx.db, {});
  let currentContext = CONTEXT;
  const calls = [];
  const main = createMain({ db: ctx.db, now: ctx.now, cloud: {
    getWXContext() { calls.push('getWXContext'); return currentContext; },
  } });
  for (const request of [
    { action: 'prepare' },
    { action: 'createAccount', userId: 'wxuser_verified', username: 'tenant.alice', password: PASSWORD, actor: ADMIN },
    { action: 'resetPassword', accountId: 'forged-account', newPassword: NEW_PASSWORD, expectedRevision: 1 },
  ]) {
    const before = structuredClone(ctx.db.snapshot());
    const result = await main(request);
    const after = structuredClone(ctx.db.snapshot());
    assert.equal(result.code, 'AUTH_FAILED');
    assert.deepEqual(after, before);
  }
  const account = await ctx.service.createAccount(ADMIN, { userId: 'wxuser_verified', username: 'tenant.alice', password: PASSWORD });
  const loggedIn = await main({ action: 'login', username: 'tenant.alice', password: PASSWORD });
  assert.equal(loggedIn.code, 0);
  assert.equal(loggedIn.userInfo._id, account.userId);
  currentContext = OTHER_CONTEXT;
  const before = exceptRate(ctx.db);
  const wrongWechat = await main({ action: 'login', username: 'tenant.alice', password: PASSWORD });
  const after = exceptRate(ctx.db);
  assert.equal(wrongWechat.code, 'AUTH_FAILED');
  assert.deepEqual(after, before);
  assert.equal(calls.length, 2, '只有两个合法 login 动作读取可信上下文');
});

test('账号列表稳定分页覆盖101项，损坏凭据不可被静默过滤', async () => {
  const ctx = fixture();
  const { account } = await provision(ctx);
  const original = ctx.db.row(COLLECTIONS.ACCOUNTS, account.id);
  const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
  // Pagination data is explicit synthetic storage, not a claim that 100
  // additional real accounts were provisioned or used for authentication.
  for (let i = 0; i < 100; i += 1) {
    const suffix = String(i).padStart(3, '0');
    const username = `tenant.list.${suffix}`;
    const openid = `synthetic-wechat-list-${suffix}`;
    const bindingHash = hash(`${CONTEXT.APPID}\0${openid}`);
    const userId = `wxuser_${bindingHash}`;
    const identityId = `wx_${bindingHash}`;
    const accountId = `acct_${hash(username)}`;
    await ctx.db.collection(COLLECTIONS.USERS).doc(userId).set({ data: {
      _openid: openid, role: 'user', houses: [], createdAt: FIXED_NOW, lastLoginAt: FIXED_NOW,
    } });
    await ctx.db.collection(COLLECTIONS.IDENTITIES).doc(identityId).set({ data: {
      schemaVersion: 1, appId: CONTEXT.APPID, openid, userId, accountId,
      revision: 1, createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
    } });
    await ctx.db.collection(COLLECTIONS.ACCOUNTS).doc(accountId).set({ data: {
      ...original, _id: accountId, username, identityId, userId, openid,
    } });
  }
  const before = structuredClone(ctx.db.snapshot());
  const listed = await ctx.service.listAccounts(ADMIN);
  const after = structuredClone(ctx.db.snapshot());
  assert.deepEqual(after, before);
  assert.equal(listed.length, 101);
  assert.equal(new Set(listed.map((item) => item.id)).size, 101);
  assert.deepEqual(listed.map((item) => item.id), [...listed.map((item) => item.id)].sort());
  listed.forEach(assertPublicAccount);
  const damagedId = listed[100].id;
  const damaged = ctx.db.row(COLLECTIONS.ACCOUNTS, damagedId);
  await ctx.db.collection(COLLECTIONS.ACCOUNTS).doc(damagedId).set({ data: {
    ...damaged, password: { ...damaged.password, hashHex: 'damaged' },
  } });
  const damagedBefore = structuredClone(ctx.db.snapshot());
  await assert.rejects(() => ctx.service.listAccounts(ADMIN), (error) => error.code === 'ACCOUNT_DATA_UNVERIFIED');
  const damagedAfter = structuredClone(ctx.db.snapshot());
  assert.deepEqual(damagedAfter, damagedBefore);
});

test('八位最低密码：七位拒绝、八位真实scrypt可登录，十二位旧密码仍可重置使用', async () => {
  const ctx = fixture();
  await seedVerifiedUser(ctx.db, {});
  const seven = 's'.repeat(7);
  const eight = ' ' + 's'.repeat(6) + ' ';
  const twelve = 't'.repeat(12);
  const before = structuredClone(ctx.db.snapshot());
  await assert.rejects(() => ctx.service.createAccount(ADMIN, {
    userId: 'wxuser_verified', username: 'tenant.eight', password: seven,
  }), (error) => error.code === 'INVALID_INPUT');
  const after = structuredClone(ctx.db.snapshot());
  assert.deepEqual(after, before);
  const account = await ctx.service.createAccount(ADMIN, {
    userId: 'wxuser_verified', username: 'tenant.eight', password: eight,
  });
  const stored = ctx.db.row(COLLECTIONS.ACCOUNTS, account.id);
  const derived = scryptSync(eight, Buffer.from(stored.password.saltHex, 'hex'), 64,
    { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  assert.equal(derived.toString('hex'), stored.password.hashHex);
  assert.equal((await ctx.service.login(CONTEXT, { username: account.username, password: eight })).code, 0);
  assert.equal((await ctx.service.login(CONTEXT, { username: account.username, password: eight.trim() })).code, 'AUTH_FAILED');
  const beforeReset = structuredClone(ctx.db.snapshot());
  await assert.rejects(() => ctx.service.resetPassword(ADMIN, {
    accountId: account.id, newPassword: seven, expectedRevision: account.revision,
  }), (error) => error.code === 'INVALID_INPUT');
  const afterReset = structuredClone(ctx.db.snapshot());
  assert.deepEqual(afterReset, beforeReset);
  await ctx.service.resetPassword(ADMIN, { accountId: account.id, newPassword: twelve, expectedRevision: account.revision });
  assert.equal((await ctx.service.login(CONTEXT, { username: account.username, password: twelve })).code, 0);
  assert.equal((await ctx.service.login(CONTEXT, { username: account.username, password: eight })).code, 'AUTH_FAILED');
});

test('已验证住户列表：只含手机号核验完成的住户，安全投影不含 openid，分页稳定', async () => {
  const ctx = fixture();
  // 1 个已验证（含手机号）+ 2 个未验证 + 1 个字段损坏
  await seedVerifiedUser(ctx.db, { id: 'wxuser_verified', phone: '13800000000', name: '验证住户', houses: ['house-1'] });
  ctx.db._write(COLLECTIONS.USERS, 'wxuser_nophone', { _id: 'wxuser_nophone', _openid: 'openid-nophone',
    wechatAppId: CONTEXT.APPID, role: 'user', houses: [], points: 0, createdAt: FIXED_NOW });
  ctx.db._write(COLLECTIONS.USERS, 'wxuser_badphone', { _id: 'wxuser_badphone', _openid: 'openid-badphone',
    wechatAppId: CONTEXT.APPID, role: 'user', houses: [], points: 0, phone: '138', phoneBoundAt: 'not-a-number', createdAt: FIXED_NOW });
  ctx.db._write(COLLECTIONS.USERS, 'bad/id', { _id: 'bad/id', _openid: 'openid-badid',
    wechatAppId: CONTEXT.APPID, role: 'user', houses: [], points: 0, phone: '13700000000', phoneBoundAt: FIXED_NOW, createdAt: FIXED_NOW });
  const before = structuredClone(ctx.db.snapshot());
  const rows = await ctx.service.listVerifiedUsers(ADMIN);
  const after = structuredClone(ctx.db.snapshot());
  assert.deepEqual(after, before, '列表只读，不产生任何写入');
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['houses', 'name', 'phone', 'userId'].sort());
  assert.equal(rows[0].userId, 'wxuser_verified');
  assert.equal(rows[0].phone, '13800000000');
  assert.deepEqual(rows[0].houses, ['house-1']);
  assert.ok(!JSON.stringify(rows).includes('openid'));

  // 101 项分页稳定覆盖
  for (let i = 0; i < 100; i += 1) {
    const suffix = String(i).padStart(3, '0');
    await seedVerifiedUser(ctx.db, { id: `wxuser_page_${suffix}`, openid: `openid-page-${suffix}`, phone: `139${suffix.padStart(8, '0')}` });
  }
  const paged = await ctx.service.listVerifiedUsers(ADMIN);
  assert.equal(paged.length, 101);
  assert.equal(new Set(paged.map((row) => row.userId)).size, 101);
  assert.deepEqual(paged.map((row) => row.userId), [...paged.map((row) => row.userId)].sort());
});


test('仅伪造 phoneBoundAt 与微信绑定不能开户；手机号证明来自实际换号入口', async () => {
  const ctx = fixture();
  const userId = 'synthetic-forged-user';
  const bindingId = `wx_${createHash('sha256').update(`${CONTEXT.APPID}\0${CONTEXT.OPENID}`).digest('hex')}`;
  ctx.db._write(COLLECTIONS.USERS, userId, { _openid: CONTEXT.OPENID, wechatAppId: CONTEXT.APPID,
    role: 'user', houses: [], phone: '13800000001', phoneBoundAt: FIXED_NOW });
  ctx.db._write(COLLECTIONS.IDENTITIES, bindingId, { schemaVersion: 1, appId: CONTEXT.APPID,
    openid: CONTEXT.OPENID, userId, revision: 1, createdAt: FIXED_NOW, updatedAt: FIXED_NOW });
  const before = structuredClone(ctx.db.snapshot());
  await assert.rejects(() => ctx.service.createAccount(ADMIN, { userId, username: 'tenant.forged', password: PASSWORD }),
    (error) => error.code === 'USER_NOT_VERIFIED');
  assert.deepEqual(structuredClone(ctx.db.snapshot()), before);
  assert.deepEqual(await ctx.service.listVerifiedUsers(ADMIN), []);
  assert.deepEqual(structuredClone(ctx.db.snapshot()), before);
});

test('管理员开户逐项核验完整微信身份及当前手机号证明，字段篡改全部零写', async () => {
  const mutations = [
    (ctx, seeded) => ctx.db._write(COLLECTIONS.IDENTITIES, seeded.bindingId, {
      ...ctx.db.row(COLLECTIONS.IDENTITIES, seeded.bindingId), appId: 'synthetic-other-app',
    }),
    (ctx, seeded) => ctx.db._write(COLLECTIONS.IDENTITIES, seeded.bindingId, {
      ...ctx.db.row(COLLECTIONS.IDENTITIES, seeded.bindingId), openid: OTHER_CONTEXT.OPENID,
    }),
    (ctx, seeded) => ctx.db._write(COLLECTIONS.IDENTITIES, seeded.bindingId, {
      ...ctx.db.row(COLLECTIONS.IDENTITIES, seeded.bindingId), userId: 'synthetic-other-user',
    }),
    (ctx, seeded) => ctx.db._write(COLLECTIONS.IDENTITIES, seeded.bindingId, {
      ...ctx.db.row(COLLECTIONS.IDENTITIES, seeded.bindingId), schemaVersion: 99,
    }),
    (ctx, seeded) => ctx.db._write(COLLECTIONS.IDENTITIES, seeded.bindingId, {
      ...ctx.db.row(COLLECTIONS.IDENTITIES, seeded.bindingId), revision: 0,
    }),
    (ctx, seeded) => ctx.db._write(COLLECTIONS.USERS, seeded.userId, {
      ...ctx.db.row(COLLECTIONS.USERS, seeded.userId), phone: '13800000099',
    }),
    (ctx) => {
      const proof = ctx.db.rows('tenant_auth_phone_bindings')[0];
      assert.ok(proof, 'real phone registration must create private proof');
      ctx.db._write('tenant_auth_phone_bindings', proof._id, null);
    },
  ];
  for (const mutate of mutations) {
    const ctx = fixture();
    const seeded = await seedVerifiedUser(ctx.db);
    mutate(ctx, seeded);
    const before = structuredClone(ctx.db.snapshot());
    await assert.rejects(() => ctx.service.createAccount(ADMIN, { userId: seeded.userId,
      username: 'tenant.tampered', password: PASSWORD }),
    (error) => ['USER_NOT_VERIFIED', 'IDENTITY_UNVERIFIED'].includes(error.code));
    assert.deepEqual(structuredClone(ctx.db.snapshot()), before);
    assert.deepEqual(await ctx.service.listVerifiedUsers(ADMIN), []);
    assert.deepEqual(structuredClone(ctx.db.snapshot()), before);
  }
});

test('审计写入本身失败时账号与身份修改原子回滚', async () => {
  const ctx = fixture();
  const seeded = await seedVerifiedUser(ctx.db);
  const originalTransaction = ctx.db.runTransaction.bind(ctx.db);
  ctx.db.runTransaction = (work) => originalTransaction(async (tx) => {
    const originalCollection = tx.collection.bind(tx);
    const guarded = { ...tx, collection(name) {
      if (name !== COLLECTIONS.AUDIT) return originalCollection(name);
      const collection = originalCollection(name);
      return { ...collection, doc(id) {
        return { ...collection.doc(id), async set() { throw new Error('SYNTHETIC_AUDIT_WRITE_FAILURE'); } };
      } };
    } };
    return work(guarded);
  });
  const before = structuredClone(ctx.db.snapshot());
  await assert.rejects(() => ctx.service.createAccount(ADMIN, { userId: seeded.userId,
    username: 'tenant.audit', password: PASSWORD }), (error) => error.code === 'SERVICE_UNAVAILABLE');
  assert.deepEqual(structuredClone(ctx.db.snapshot()), before);
  assert.equal(ctx.db.rows(COLLECTIONS.ACCOUNTS).length, 0);
  assert.equal(ctx.db.rows(COLLECTIONS.AUDIT).length, 0);
});


test('私有手机号证明任一关键字段失真，管理员开户拒绝且不写库', async () => {
  const changes = [
    { schemaVersion: 99 }, { appId: 'synthetic-other-app' }, { phoneHash: '0'.repeat(64) },
    { identityId: 'wx_unrelated' }, { userId: 'synthetic-other-user' },
    { verifiedAt: FIXED_NOW + 1 },
  ];
  for (const change of changes) {
    const ctx = fixture();
    const seeded = await seedVerifiedUser(ctx.db);
    const proof = ctx.db.rows(COLLECTIONS.PHONE_BINDINGS)[0];
    assert.ok(proof);
    ctx.db._write(COLLECTIONS.PHONE_BINDINGS, proof._id, { ...proof, ...change });
    const before = structuredClone(ctx.db.snapshot());
    await assert.rejects(() => ctx.service.createAccount(ADMIN, { userId: seeded.userId,
      username: 'tenant.badproof', password: PASSWORD }), (error) => error.code === 'USER_NOT_VERIFIED');
    assert.deepEqual(structuredClone(ctx.db.snapshot()), before);
    assert.deepEqual(await ctx.service.listVerifiedUsers(ADMIN), []);
    assert.deepEqual(structuredClone(ctx.db.snapshot()), before);
  }
});

test('遗留密码账号缺手机号、缺证明或手机号遭篡改时失败关闭，仅登录预算可写', async () => {
  for (const mutation of ['no-phone', 'no-proof', 'different-phone']) {
    const ctx = fixture();
    const { account } = await provision(ctx);
    const user = ctx.db.row(COLLECTIONS.USERS, account.userId);
    const proof = ctx.db.rows(COLLECTIONS.PHONE_BINDINGS)[0];
    if (mutation === 'no-phone') {
      delete user.phone;
      delete user.phoneBoundAt;
      ctx.db._write(COLLECTIONS.USERS, user._id, user);
    } else if (mutation === 'no-proof') {
      ctx.db._write(COLLECTIONS.PHONE_BINDINGS, proof._id, null);
    } else {
      ctx.db._write(COLLECTIONS.USERS, user._id, { ...user, phone: '13800000099' });
    }
    const before = structuredClone(exceptRate(ctx.db));
    const result = await ctx.service.login(CONTEXT, { username: account.username, password: PASSWORD });
    assert.equal(result.code, 'AUTH_FAILED', mutation);
    assert.deepEqual(structuredClone(exceptRate(ctx.db)), before, mutation);
    const rates = ctx.db.rows(COLLECTIONS.RATE_LIMITS);
    assert.equal(rates.length, 1);
    assert.equal(rates[0].operation, 'login');
    assert.equal(rates[0].attempts, 1);
  }
});

test('遗留账号同号重新微信授权补证明后恢复原用户、房屋与密码登录', async () => {
  const ctx = fixture();
  const seeded = await seedVerifiedUser(ctx.db, { houses: ['admin-house-1'] });
  const { account } = await provision(ctx, { userId: seeded.userId });
  const originalAccount = structuredClone(ctx.db.row(COLLECTIONS.ACCOUNTS, account.id));
  const proof = ctx.db.rows(COLLECTIONS.PHONE_BINDINGS)[0];
  ctx.db._write(COLLECTIONS.PHONE_BINDINGS, proof._id, null);
  const before = structuredClone(exceptRate(ctx.db));
  assert.equal((await ctx.service.login(CONTEXT, { username: account.username, password: PASSWORD })).code, 'AUTH_FAILED');
  assert.deepEqual(structuredClone(exceptRate(ctx.db)), before);

  const authorize = createPhoneMain({ db: ctx.db, now: () => FIXED_NOW + 1000, cloud: {
    getWXContext: () => CONTEXT,
    openapi: { phonenumber: { getPhoneNumber: async () => ({ phoneInfo: { purePhoneNumber: seeded.phone } }) } },
  } });
  const phone = await authorize({ code: 'synthetic-reauthorization-code' });
  assert.equal(phone.code, 0);
  assert.equal(phone.userInfo._id, seeded.userId);
  assert.deepEqual(phone.userInfo.houses, ['admin-house-1']);
  const password = await ctx.service.login(CONTEXT, { username: account.username, password: PASSWORD });
  assert.equal(password.code, 0);
  assert.equal(password.userInfo._id, seeded.userId);
  assert.deepEqual(password.userInfo.houses, ['admin-house-1']);
  assert.equal(ctx.db.rows(COLLECTIONS.USERS).length, 1);
  assert.equal(ctx.db.rows(COLLECTIONS.ACCOUNTS).length, 1);
  assert.deepEqual(ctx.db.row(COLLECTIONS.ACCOUNTS, account.id), originalAccount);
});

// Inject only base query status while retaining real data and point reads.
function queryStatus(db, status) {
  const original = db.collection.bind(db);
  function wrap(reference) {
    return { ...reference,
      where(...args) { return wrap(reference.where(...args)); },
      orderBy(...args) { return wrap(reference.orderBy(...args)); },
      skip(...args) { return wrap(reference.skip(...args)); },
      limit(...args) { return wrap(reference.limit(...args)); },
      async get() { return { ...await reference.get(), ...status }; },
    };
  }
  db.collection = (name) => wrap(original(name));
}

test('nonzero status with otherwise valid query data cannot open accounts, list trusted residents or authenticate', async () => {
  for (const status of [{ code: 'SYNTHETIC_QUERY_FAILURE' }, { errCode: 7 }]) {
    const ctx = fixture();
    const { userId } = await seedVerifiedUser(ctx.db);
    queryStatus(ctx.db, status);
    const before = structuredClone(ctx.db.snapshot());
    await assert.rejects(() => ctx.service.createAccount(ADMIN, { userId, username: 'tenant.status', password: PASSWORD }),
      (error) => error.code === 'SERVICE_UNAVAILABLE');
    assert.deepEqual(structuredClone(ctx.db.snapshot()), before);
    assert.equal(ctx.db.rows(COLLECTIONS.ACCOUNTS).length, 0);
    for (const list of [() => ctx.service.listVerifiedUsers(ADMIN), () => ctx.service.listAccounts(ADMIN)]) {
      const beforeList = structuredClone(ctx.db.snapshot());
      await assert.rejects(list, (error) => error.code === 'SERVICE_UNAVAILABLE');
      assert.deepEqual(structuredClone(ctx.db.snapshot()), beforeList);
    }
    const existing = fixture();
    await provision(existing);
    queryStatus(existing.db, status);
    const beforePassword = structuredClone(exceptRate(existing.db));
    const loggedIn = await existing.service.login(CONTEXT, { username: 'tenant.alice', password: PASSWORD });
    assert.equal(loggedIn.code, 'SERVICE_UNAVAILABLE');
    assert.deepEqual(structuredClone(exceptRate(existing.db)), beforePassword);
    const writes = existing.db.commitLog.filter((entry) => entry.result === 'committed').at(-1);
    assert.equal(writes.writes, 1, 'failed login may only reserve its existing rate budget');
    assert.equal(existing.db.rows(COLLECTIONS.RATE_LIMITS)[0].attempts, 1);
  }
});
