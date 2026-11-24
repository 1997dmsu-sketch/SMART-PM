'use strict';

// All accounts, identities, codes and passwords below are synthetic. These
// tests exercise the production service and real scrypt, never a live SDK.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scryptSync, createHash } = require('node:crypto');
const { TenantAuthMemoryDB } = require('./support/tenant-auth-memory-db.cjs');
const { TenantAccountService, COLLECTIONS } = require('../cloudfunctions/accountLogin/lib/service.js');
const { createMain } = require('../cloudfunctions/accountLogin/index.js');

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

async function provision(ctx, { context = CONTEXT, username = 'tenant.alice', password = PASSWORD } = {}) {
  const prepared = await ctx.service.prepare(context, {});
  assert.equal(prepared.code, 0, JSON.stringify(prepared));
  assert.match(prepared.requestCode, /^[A-Z2-7]{16}$/);
  const account = await ctx.service.createAccount(ADMIN, { requestCode: prepared.requestCode, username, password });
  assertPublicAccount(account);
  return { prepared, account, context, username, password };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('prepare 只生成绑定可信微信的短期开户码，不返回认证 profile 或凭据', async () => {
  const ctx = fixture();
  const prepared = await ctx.service.prepare(CONTEXT, {});
  assert.deepEqual(Object.keys(prepared).sort(), ['code', 'expiresAt', 'requestCode']);
  assert.equal(prepared.code, 0);
  assert.match(prepared.requestCode, /^[A-Z2-7]{16}$/);
  assert.equal(prepared.expiresAt, FIXED_NOW + 10 * 60 * 1000);
  assert.equal(ctx.db.rows(COLLECTIONS.ACCOUNTS).length, 0);
  const users = ctx.db.rows(COLLECTIONS.USERS);
  assert.equal(users.length, 1);
  assert.equal(users[0]._openid, CONTEXT.OPENID);
  assert.deepEqual(users[0].houses, []);
  assert.equal(users[0].role, 'user');
  const enrollment = ctx.db.rows(COLLECTIONS.ENROLLMENTS)[0];
  assert.equal(enrollment.status, 'pending');
  assert.ok(!JSON.stringify(enrollment).includes(prepared.requestCode), '数据库不保存原始开户码');
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

test('开户码新的替换旧的、仅使用一次，等于截止时过期', async () => {
  const ctx = fixture();
  const first = await ctx.service.prepare(CONTEXT, {});
  const latest = await ctx.service.prepare(CONTEXT, {});
  assert.equal(first.code, 0);
  assert.equal(latest.code, 0);
  assert.notEqual(latest.requestCode, first.requestCode);
  let before = ctx.db.snapshot();
  await assert.rejects(() => ctx.service.createAccount(ADMIN, { requestCode: first.requestCode, username: 'tenant.alice', password: PASSWORD }),
    (error) => error.code === 'REQUEST_INVALID');
  let after = ctx.db.snapshot();
  assert.deepEqual(after, before);
  const account = await ctx.service.createAccount(ADMIN, { requestCode: latest.requestCode, username: 'tenant.alice', password: PASSWORD });
  assertPublicAccount(account);
  before = ctx.db.snapshot();
  await assert.rejects(() => ctx.service.createAccount(ADMIN, { requestCode: latest.requestCode, username: 'another.tenant', password: PASSWORD }),
    (error) => error.code === 'REQUEST_INVALID');
  after = ctx.db.snapshot();
  assert.deepEqual(after, before);

  const expired = fixture();
  const pending = await expired.service.prepare(CONTEXT, {});
  expired.setNow(pending.expiresAt);
  before = expired.db.snapshot();
  await assert.rejects(() => expired.service.createAccount(ADMIN, { requestCode: pending.requestCode, username: 'tenant.alice', password: PASSWORD }),
    (error) => error.code === 'REQUEST_INVALID');
  after = expired.db.snapshot();
  assert.deepEqual(after, before);
});

test('prepare 持久每分钟3次，登录持久每15分钟10次，成功也消耗预算', async () => {
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

  const prepareCtx = fixture();
  for (let i = 0; i < 3; i += 1) assert.equal((await new TenantAccountService({ db: prepareCtx.db, now: prepareCtx.now }).prepare(CONTEXT, {})).code, 0);
  before = exceptRate(prepareCtx.db);
  assert.equal((await prepareCtx.service.prepare(CONTEXT, {})).code, 'AUTH_FAILED');
  after = exceptRate(prepareCtx.db);
  assert.deepEqual(after, before);
  prepareCtx.setNow(FIXED_NOW + 60 * 1000);
  assert.equal((await prepareCtx.service.prepare(CONTEXT, {})).code, 0);
});

test('管理员开通/重置/状态与审计原子回滚；无事务不降级', async () => {
  const creation = fixture();
  const pending = await creation.service.prepare(CONTEXT, {});
  let before = creation.db.snapshot();
  creation.db.failCommits = 1;
  await assert.rejects(() => creation.service.createAccount(ADMIN, { requestCode: pending.requestCode, username: 'tenant.alice', password: PASSWORD }),
    (error) => error.code === 'SERVICE_UNAVAILABLE');
  let after = creation.db.snapshot();
  assert.deepEqual(after, before);
  assert.equal(creation.db.rows(COLLECTIONS.ACCOUNTS).length, 0);
  for (const action of ['reset', 'disable']) {
    const ctx = fixture();
    const { account } = await provision(ctx);
    before = ctx.db.snapshot();
    ctx.db.failCommits = 1;
    const op = action === 'reset'
      ? () => ctx.service.resetPassword(ADMIN, { accountId: account.id, newPassword: NEW_PASSWORD, expectedRevision: account.revision })
      : () => ctx.service.setStatus(ADMIN, { accountId: account.id, status: 'disabled', expectedRevision: account.revision });
    await assert.rejects(op, (error) => error.code === 'SERVICE_UNAVAILABLE');
    after = ctx.db.snapshot();
    assert.deepEqual(after, before);
  }
  const unavailable = fixture();
  unavailable.db.runTransaction = undefined;
  before = unavailable.db.snapshot();
  assert.equal((await unavailable.service.prepare(CONTEXT, {})).code, 'SERVICE_UNAVAILABLE');
  after = unavailable.db.snapshot();
  assert.deepEqual(after, before);
});

test('同一开户码两个创建者真实交错，仅一个账户/绑定/消费审计提交', async () => {
  const ctx = fixture();
  const pending = await ctx.service.prepare(CONTEXT, {});
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
  const lateCreator = ctx.service.createAccount(ADMIN, { requestCode: pending.requestCode, username: 'late.tenant', password: PASSWORD });
  await paused.promise;
  const winner = await ctx.service.createAccount(ADMIN, { requestCode: pending.requestCode, username: 'winner.tenant', password: NEW_PASSWORD });
  resumed.resolve();
  await assert.rejects(() => lateCreator, (error) => error.code === 'REQUEST_INVALID');
  assert.equal(ctx.db.rows(COLLECTIONS.ACCOUNTS).length, 1);
  assert.equal(ctx.db.rows(COLLECTIONS.ACCOUNTS)[0]._id, winner.id);
  assert.equal(ctx.db.rows(COLLECTIONS.ENROLLMENTS).filter((row) => row.status === 'consumed').length, 1);
  assert.equal(ctx.db.rows(COLLECTIONS.AUDIT).length, 1);
  assert.ok(ctx.db.commitLog.some((entry) => entry.result === 'conflict-retry'), '确实发生提交冲突后重试');
});

test('规范化同名账户 create-only，不能重绑给另一微信用户', async () => {
  const ctx = fixture();
  const first = await provision(ctx);
  const second = await ctx.service.prepare(OTHER_CONTEXT, {});
  const before = ctx.db.snapshot();
  await assert.rejects(() => ctx.service.createAccount(ADMIN, { requestCode: second.requestCode, username: ' TENANT.ALICE ', password: NEW_PASSWORD }),
    (error) => error.code === 'ACCOUNT_EXISTS');
  const after = ctx.db.snapshot();
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
  let before = ctx.db.snapshot();
  await assert.rejects(() => ctx.service.setStatus(ADMIN, { accountId: account.id, status: 'disabled', expectedRevision: account.revision }),
    (error) => error.code === 'REVISION_CONFLICT');
  let after = ctx.db.snapshot();
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

test('非管理员不能列出、开通、重置或停用租客账号，全部零写', async () => {
  const ctx = fixture();
  const { account, prepared } = await provision(ctx);
  const actions = [
    (actor) => ctx.service.listAccounts(actor),
    (actor) => ctx.service.createAccount(actor, { requestCode: prepared.requestCode, username: 'another.tenant', password: PASSWORD }),
    (actor) => ctx.service.resetPassword(actor, { accountId: account.id, newPassword: NEW_PASSWORD, expectedRevision: account.revision }),
    (actor) => ctx.service.setStatus(actor, { accountId: account.id, status: 'disabled', expectedRevision: account.revision }),
  ];
  for (const actor of [null, { id: 'synthetic-user', role: 'user' }, { role: 'admin' }]) {
    for (const action of actions) {
      const before = ctx.db.snapshot();
      await assert.rejects(() => action(actor), (error) => error.code === 'ADMIN_REQUIRED');
      const after = ctx.db.snapshot();
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
    const pending = await ctx.service.prepare(CONTEXT, {});
    const before = ctx.db.snapshot();
    await assert.rejects(() => ctx.service.createAccount(ADMIN, { requestCode: pending.requestCode, username, password: PASSWORD }),
      (error) => error.code === 'INVALID_INPUT');
    const after = ctx.db.snapshot();
    assert.deepEqual(after, before);
  }
  const invalidPasswords = ['x'.repeat(11), 'x'.repeat(129), '界'.repeat(86), null, undefined, 999];
  for (const password of invalidPasswords) {
    const ctx = fixture();
    const pending = await ctx.service.prepare(CONTEXT, {});
    const before = ctx.db.snapshot();
    await assert.rejects(() => ctx.service.createAccount(ADMIN, { requestCode: pending.requestCode, username: 'tenant.alice', password }),
      (error) => error.code === 'INVALID_INPUT');
    const after = ctx.db.snapshot();
    assert.deepEqual(after, before);
  }
  for (const [username, password] of [['a000', 'x'.repeat(12)], ['a'.repeat(32), 'x'.repeat(128)], ['tenant.utf8', '界'.repeat(85)]]) {
    const ctx = fixture();
    const created = await provision(ctx, { username, password });
    const result = await ctx.service.login(CONTEXT, { username, password });
    assert.equal(result.code, 0);
    assert.equal(result.userInfo._id, created.account.userId);
  }
});

test('缺少可信APPID/OPENID或自报客户端身份拒绝，不创建用户或开户码', async () => {
  const ctx = fixture();
  const invalidContexts = [{ OPENID: CONTEXT.OPENID }, { APPID: CONTEXT.APPID }, {}, null];
  for (const context of invalidContexts) {
    const before = ctx.db.snapshot();
    const prepared = await ctx.service.prepare(context, {});
    const loggedIn = await ctx.service.login(context, { username: 'tenant.alice', password: PASSWORD });
    const after = ctx.db.snapshot();
    assert.equal(prepared.code, 'AUTH_FAILED');
    assert.equal(loggedIn.code, 'AUTH_FAILED');
    assert.deepEqual(after, before);
  }
  for (const input of [{ OPENID: OTHER_CONTEXT.OPENID }, { userId: 'forged-user' }, { actor: ADMIN }, { approved: true }]) {
    const before = ctx.db.snapshot();
    const response = await ctx.service.prepare(CONTEXT, input);
    const after = ctx.db.snapshot();
    assert.equal(response.code, 'AUTH_FAILED');
    assert.deepEqual(after, before);
  }
  const provisioned = fixture();
  await provision(provisioned);
  const before = provisioned.db.snapshot();
  const response = await provisioned.service.login(CONTEXT, { username: 'tenant.alice', password: PASSWORD, OPENID: OTHER_CONTEXT.OPENID });
  const after = provisioned.db.snapshot();
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
  const before = ctx.db.snapshot();
  const response = await ctx.service.login(CONTEXT, { username: 'tenant.alice', password: PASSWORD });
  const after = ctx.db.snapshot();
  assert.equal(response.code, 'SERVICE_UNAVAILABLE');
  assert.deepEqual(after, before);
});

test('真实云入口只信 getWXContext，不暴露管理员动作或接受伪造身份', async () => {
  const ctx = fixture();
  let currentContext = CONTEXT;
  const calls = [];
  const main = createMain({ db: ctx.db, now: ctx.now, cloud: {
    getWXContext() { calls.push('getWXContext'); return currentContext; },
  } });
  for (const request of [
    { action: 'prepare', OPENID: OTHER_CONTEXT.OPENID },
    { action: 'createAccount', requestCode: 'A'.repeat(16), username: 'tenant.alice', password: PASSWORD, actor: ADMIN },
    { action: 'resetPassword', accountId: 'forged-account', newPassword: NEW_PASSWORD, expectedRevision: 1 },
  ]) {
    const before = ctx.db.snapshot();
    const result = await main(request);
    const after = ctx.db.snapshot();
    assert.equal(result.code, 'AUTH_FAILED');
    assert.deepEqual(after, before);
  }
  const prepared = await main({ action: 'prepare' });
  assert.equal(prepared.code, 0);
  const account = await ctx.service.createAccount(ADMIN, { requestCode: prepared.requestCode, username: 'tenant.alice', password: PASSWORD });
  const loggedIn = await main({ action: 'login', username: 'tenant.alice', password: PASSWORD });
  assert.equal(loggedIn.code, 0);
  assert.equal(loggedIn.userInfo._id, account.userId);
  currentContext = OTHER_CONTEXT;
  const before = exceptRate(ctx.db);
  const wrongWechat = await main({ action: 'login', username: 'tenant.alice', password: PASSWORD });
  const after = exceptRate(ctx.db);
  assert.equal(wrongWechat.code, 'AUTH_FAILED');
  assert.deepEqual(after, before);
  assert.ok(calls.length >= 3);
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
  const before = ctx.db.snapshot();
  const listed = await ctx.service.listAccounts(ADMIN);
  const after = ctx.db.snapshot();
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
  const damagedBefore = ctx.db.snapshot();
  await assert.rejects(() => ctx.service.listAccounts(ADMIN), (error) => error.code === 'ACCOUNT_DATA_UNVERIFIED');
  const damagedAfter = ctx.db.snapshot();
  assert.deepEqual(damagedAfter, damagedBefore);
});
