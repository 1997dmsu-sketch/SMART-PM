'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash, pbkdf2Sync } = require('node:crypto');
const { TenantAuthMemoryDB } = require('./support/tenant-auth-memory-db.cjs');
const identity = require('../cloudfunctions/accountLogin/lib/identity-core');
const { createMain: silentMain } = require('../cloudfunctions/login');
const { createMain: phoneMain } = require('../cloudfunctions/phoneLogin');
const ROOT = path.resolve(__dirname, '..');
const CONTEXT = { APPID: 'wx-synthetic-app', OPENID: 'synthetic-user-01', UNIONID: 'synthetic-union-01' };
const NOW = 1795564800000;
function cloud(db, context = CONTEXT) {
  return { init() {}, database: () => db, getWXContext: () => context,
    openapi: { phonenumber: { getPhoneNumber: async () => ({ phoneInfo: { purePhoneNumber: 'synthetic-phone' } }) } } };
}

test('identity helper bytes are identical and each cloud function is deployment self-contained', () => {
  const files = ['accountLogin', 'login', 'phoneLogin', 'adminLogin'].map((name) =>
    path.join(ROOT, 'cloudfunctions', name, 'lib/identity-core.js'));
  const hashes = files.map((file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  assert.equal(new Set(hashes).size, 1);
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /require\(['"]\.\.\//);
});

test('silent login and phone login concurrently create exactly one canonical user', async () => {
  const db = new TenantAuthMemoryDB();
  const sdk = cloud(db);
  const [silent, phone] = await Promise.all([
    silentMain({ cloud: sdk, db, now: () => NOW })({ OPENID: 'spoofed' }),
    phoneMain({ cloud: sdk, db, now: () => NOW })({ code: 'synthetic-phone-code' }),
  ]);
  for (const result of [silent, phone]) assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(db.rows('users').length, 1);
  assert.equal(db.rows('tenant_auth_identities').length, 1);
  assert.equal(silent.userInfo._id, phone.userInfo._id);
  assert.equal(db.rows('tenant_auth_identities')[0].userId, silent.userInfo._id);
  assert.equal(db.rows('users')[0]._openid, CONTEXT.OPENID);
  assert.equal(db.rows('users')[0].role, 'user');
  assert.deepEqual(db.rows('users')[0].houses, []);
});

test('unique legacy user keeps id and house bindings; duplicate legacy users fail closed', async () => {
  const db = new TenantAuthMemoryDB();
  db._write('users', 'legacy-user', { _id: 'legacy-user', _openid: CONTEXT.OPENID,
    houses: ['admin-house'], housesManaged: true, points: 8, role: 'user', phone: 'synthetic-phone' });
  const result = await silentMain({ cloud: cloud(db), db, now: () => NOW })();
  assert.equal(result.code, 0);
  assert.equal(result.userInfo._id, 'legacy-user');
  assert.deepEqual(result.userInfo.houses, ['admin-house']);
  assert.equal(db.rows('users').length, 1);
  assert.equal(db.rows('tenant_auth_identities')[0].userId, 'legacy-user');

  const duplicates = new TenantAuthMemoryDB();
  duplicates._write('users', 'legacy-A', { _openid: CONTEXT.OPENID, houses: ['A'] });
  duplicates._write('users', 'legacy-B', { _openid: CONTEXT.OPENID, houses: ['B'] });
  const before = duplicates.snapshot();
  const rejected = await silentMain({ cloud: cloud(duplicates), db: duplicates, now: () => NOW })();
  const after = duplicates.snapshot();
  assert.equal(rejected.code, 'SERVICE_UNAVAILABLE');
  assert.deepEqual(after, before, '不能按第一条选择或自动合并既有房产');
});

test('a raw OPENID collision under another APPID cannot claim the old user or permissions', async () => {
  const db = new TenantAuthMemoryDB();
  await identity.withIdentity({ db, context: CONTEXT, now: () => NOW });
  const before = db.snapshot();
  const other = { ...CONTEXT, APPID: 'wx-other-app' };
  const result = await silentMain({ cloud: cloud(db, other), db, now: () => NOW })();
  const after = db.snapshot();
  assert.equal(result.code, 'SERVICE_UNAVAILABLE');
  assert.deepEqual(after, before);
});

test('missing transaction support and generic database -1 errors never create an identity', async () => {
  const db = new TenantAuthMemoryDB();
  db.runTransaction = undefined;
  const before = db.snapshot();
  const result = await silentMain({ cloud: cloud(db), db, now: () => NOW })();
  assert.equal(result.code, 'SERVICE_UNAVAILABLE');
  assert.deepEqual(db.snapshot(), before);
  await assert.rejects(() => identity.readDoc({ collection: () => ({ doc: () => ({ get: async () => {
    throw Object.assign(new Error('SYNTHETIC_DATABASE_UNAVAILABLE'), { errCode: -1 });
  } }) }) }, 'users', 'irrelevant'), /SYNTHETIC_DATABASE_UNAVAILABLE/);
});

test('legacy admin login changes only its canonical user writer and preserves houses', async () => {
  const db = new TenantAuthMemoryDB();
  await identity.withIdentity({ db, context: CONTEXT, now: () => NOW });
  const id = db.rows('users')[0]._id;
  db._write('users', id, { ...db.row('users', id), houses: ['admin-house'], housesManaged: true });
  const password = 'Synthetic-admin-password-784';
  const salt = Buffer.alloc(16, 7);
  const hash = pbkdf2Sync(password, salt, 100000, 64, 'sha512');
  db._write('sys_config', 'admin-user', { key: 'admin_username', value: 'synthetic-admin' });
  db._write('sys_config', 'admin-password', { key: 'admin_password_hash',
    value: `pbkdf2_sha512$100000$${salt.toString('hex')}$${hash.toString('hex')}` });
  const file = path.join(ROOT, 'cloudfunctions/adminLogin/index.js');
  const requireActual = createRequire(file);
  const exports = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    exports, require: (name) => name === 'wx-server-sdk' ? cloud(db) : requireActual(name),
    Buffer, console: { error() {}, warn() {} },
  }, { filename: file });
  const result = await exports.main({ action: 'login', username: 'synthetic-admin', password });
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.userInfo._id, id);
  assert.equal(result.userInfo.role, 'admin');
  assert.deepEqual(result.userInfo.houses, ['admin-house']);
  assert.equal(db.rows('users').length, 1);
  assert.equal(db.rows('tenant_auth_identities').length, 1);
});

test('set 载荷绝不携带 _id（真实云端 SDK 拒绝 -501007 不能更新_id）', async () => {
  const db = new TenantAuthMemoryDB({ strictId: true });
  const sdk = cloud(db);
  const silent = await silentMain({ cloud: sdk, db, now: () => NOW })();
  assert.equal(silent.code, 0, JSON.stringify(silent));
  const phone = await phoneMain({ cloud: sdk, db, now: () => NOW })({ code: 'synthetic-phone-code' });
  assert.equal(phone.code, 0, JSON.stringify(phone));
  assert.equal(db.rows('users').length, 1);
  assert.equal(db.rows('tenant_auth_identities').length, 1);
});

test('closedInput 放行平台注入的 tcbContext/userInfo 字段，其余未知字段仍拒绝', () => {
  const allowed = identity.closedInput({ action: 'login', username: 'u', password: 'p', tcbContext: { envId: 'x' }, userInfo: { nickName: 'y' } }, ['action', 'username', 'password']);
  assert.deepEqual(allowed, { action: 'login', username: 'u', password: 'p' });
  assert.equal(Object.hasOwn(allowed, 'tcbContext'), false, '平台字段只放行不读取');
  assert.equal(Object.hasOwn(allowed, 'userInfo'), false, '平台字段只放行不读取');
  assert.throws(() => identity.closedInput({ action: 'login', bogus: 1 }, ['action']), (error) => error.code === 'INVALID_INPUT');
  const protoObj = JSON.parse('{"action":"login","__proto__":1}');
  assert.throws(() => identity.closedInput(protoObj, ['action']), (error) => error.code === 'INVALID_INPUT');
});
