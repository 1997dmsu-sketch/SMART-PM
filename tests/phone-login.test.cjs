'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMain } = require('../cloudfunctions/phoneLogin');
const { TenantAuthMemoryDB } = require('./support/tenant-auth-memory-db.cjs');
const { TenantAccountService } = require('../cloudfunctions/accountLogin/lib/service');
const core = require('../cloudfunctions/phoneLogin/lib/identity-core');
const { PHONE_BINDINGS, phoneBindingIdFor } = require('../cloudfunctions/phoneLogin/lib/phone-proof');
const CONTEXT = { APPID: 'wx-synthetic-app', OPENID: 'trusted-openid' };
const PHONE = '13800000001';
const NOW = 1795564800000;
const snapshot = (db) => structuredClone(db.snapshot());

function harness(options = {}) {
  const db = options.db || new TenantAuthMemoryDB();
  for (const user of options.users || []) db._write('users', user._id, { _openid: CONTEXT.OPENID, ...user });
  for (const [index, owner] of (options.owners || []).entries()) db._write('owners', `owner-${index}`, { phone: PHONE, ...owner });
  const originalCollection = db.collection.bind(db);
  db.collection = (name) => {
    const collection = originalCollection(name);
    if (!(name === 'users' && options.usersError) && !(name === 'owners' && options.ownersError)) return collection;
    return { ...collection, where() { return { limit() { return this; }, async get() { throw new Error('SYNTHETIC_DATABASE_FAILURE'); } }; } };
  };
  const phoneCalls = [];
  const cloud = { getWXContext: () => Object.hasOwn(options, 'context') ? options.context : CONTEXT,
    openapi: { phonenumber: { async getPhoneNumber(argument) {
      phoneCalls.push(argument);
      if (options.phoneError) throw options.phoneError;
      return Object.hasOwn(options, 'phoneResult') ? options.phoneResult : { phoneInfo: { purePhoneNumber: PHONE } };
    } } } };
  return { db, before: snapshot(db), phoneCalls, run: createMain({ cloud, db, now: () => NOW }) };
}
function gateFirstCommits(db) {
  let entered = 0;
  let resolve;
  const gate = new Promise((done) => { resolve = done; });
  db.beforeCommit = async () => {
    entered += 1;
    if (entered === 2) resolve();
    if (entered <= 2) await gate;
  };
}

test('missing/malformed authorization and client identity fields fail before WeChat or database writes', async () => {
  let getterCalls = 0;
  const getter = Object.defineProperty({}, 'code', { enumerable: true, get() { getterCalls += 1; return 'code'; } });
  const inputs = [{}, null, [], { code: '' }, { code: ' ' }, { code: '\0code' }, { code: 1 }, { code: 'x'.repeat(2049) },
    { code: 'code', phone: PHONE }, { code: 'code', OPENID: 'forged' }, { code: 'code', openid: 'forged' },
    { code: 'code', userId: 'forged' }, { code: 'code', action: 'prepare' }, { requestCode: 'old-code' },
    getter, new Proxy({ code: 'code' }, {}), { code: 'code', [Symbol('hidden')]: 'forged' }];
  for (const input of inputs) {
    const h = harness();
    const before = snapshot(h.db);
    assert.equal((await h.run(input)).code, 400);
    assert.equal(h.phoneCalls.length, 0);
    assert.deepEqual(snapshot(h.db), before);
  }
  assert.equal(getterCalls, 0);
});

test('invalid trusted APPID/OPENID fails before phone exchange with zero writes', async () => {
  let getterCalls = 0;
  const getter = Object.defineProperty({ OPENID: CONTEXT.OPENID }, 'APPID', { enumerable: true, get() { getterCalls += 1; return CONTEXT.APPID; } });
  for (const context of [{}, null, { OPENID: CONTEXT.OPENID }, { APPID: CONTEXT.APPID },
    { APPID: 'bad/app', OPENID: CONTEXT.OPENID }, { ...CONTEXT, OPENID: 'bad openid' }, getter, new Proxy(CONTEXT, {})]) {
    const h = harness({ context });
    const before = snapshot(h.db);
    assert.equal((await h.run({ code: 'code' })).code, 403);
    assert.equal(h.phoneCalls.length, 0);
    assert.deepEqual(snapshot(h.db), before);
  }
  assert.equal(getterCalls, 0);
});

test('new WeChat phone login creates one canonical user with private proof and no houses', async () => {
  const h = harness({ owners: [{ name: '旧业主', houses: [{ houseId: 'legacy-house' }] }] });
  const result = await h.run({ code: 'temporary-code' });
  assert.equal(result.code, 0);
  assert.equal(result.phone, PHONE);
  assert.equal(result.bound, false);
  assert.equal(h.db.rows('users').length, 1);
  assert.deepEqual(result.userInfo.houses, []);
  const user = h.db.rows('users')[0];
  assert.equal(user._openid, CONTEXT.OPENID);
  assert.equal(user.wechatAppId, CONTEXT.APPID);
  assert.equal(user.role, 'user');
  assert.equal(user.name, undefined);
  assert.equal(user.housesManaged, undefined);
  assert.deepEqual(h.phoneCalls, [{ code: 'temporary-code' }]);
  assert.equal(h.db.rows('tenant_auth_identities')[0].userId, user._id);
  const proof = h.db.row(PHONE_BINDINGS, phoneBindingIdFor(CONTEXT.APPID, PHONE));
  assert.equal(proof.userId, user._id);
  assert.equal(proof.identityId, core.identityIdFor(CONTEXT));
  assert.equal(proof.verifiedAt, user.phoneBoundAt);
  assert.equal(proof.phoneHash, core.sha256(PHONE));
  assert.equal(proof.phone, undefined);
  assert.equal(h.db.rows('tenant_auth_accounts').length, 0);
  assert.equal(h.db.rows('tenant_auth_enrollments').length, 0);
  assert.equal(h.db.rows('tenant_auth_rate_limits').length, 0);
});

test('returning legacy user reauthorizes the same number, preserves id and admin houses', async () => {
  for (const houses of [[], ['admin-house']]) {
    const h = harness({ users: [{ _id: 'existing', phone: PHONE, phoneBoundAt: NOW - 1000, houses, housesManaged: true }],
      ownersError: true, owners: [{ houses: [{ houseId: 'legacy-house' }] }] });
    const result = await h.run({ code: 'code' });
    assert.equal(result.code, 0);
    assert.equal(result.userInfo._id, 'existing');
    assert.equal(result.bound, houses.length > 0);
    assert.deepEqual(result.userInfo.houses, houses);
    assert.equal(h.db.rows('users').length, 1);
    assert.equal(h.db.rows(PHONE_BINDINGS).length, 1);
  }
});

test('authorization refusal, exchange failure and invalid returned phone leave the entire database unchanged', async () => {
  const invalid = [undefined, null, '', 'test-phone', '138', '+8613800000001', '138 00000001', '13800000001\n', '1'.repeat(16), 13800000001];
  const options = [{ phoneError: { errMsg: '授权已过期' } }, { phoneError: { errno: 1400001 } },
    { phoneResult: {} }, { phoneResult: null },
    { phoneResult: { errCode: 40029, phoneInfo: { purePhoneNumber: PHONE } } }, ...invalid.map((phone) => ({ phoneResult: { phoneInfo: { purePhoneNumber: phone } } }))];
  for (const option of options) {
    const h = harness(option);
    const before = snapshot(h.db);
    assert.equal((await h.run({ code: 'code' })).code, 500);
    assert.deepEqual(snapshot(h.db), before);
  }
});

test('historical OPENID or phone queries unavailable/malformed fail closed with zero writes', async () => {
  for (const filterKey of ['_openid', 'phone']) {
    for (const outcome of ['throw', 'malformed', 'null-row']) {
      const db = new TenantAuthMemoryDB();
      const original = db.collection.bind(db);
      db.collection = (name) => {
        const collection = original(name);
        if (name !== 'users') return collection;
        return { ...collection, where(filter) {
          if (!Object.hasOwn(filter, filterKey)) return collection.where(filter);
          return { limit() { return this; }, async get() {
            if (outcome === 'throw') throw new Error('SYNTHETIC_DATABASE_FAILURE');
            return { data: outcome === 'null-row' ? [null] : null };
          } };
        } };
      };
      const h = harness({ db });
      const before = snapshot(db);
      assert.equal((await h.run({ code: 'code' })).code, 'SERVICE_UNAVAILABLE');
      assert.deepEqual(snapshot(db), before);
    }
  }
});

test('historical duplicate identities or phones never choose a first row or merge permissions', async () => {
  for (const users of [
    [{ _id: 'A', houses: ['A'] }, { _id: 'B', houses: ['B'] }],
    [{ _id: 'A', _openid: 'other-A', phone: PHONE }, { _id: 'B', _openid: 'other-B', phone: PHONE }],
    [{ _id: 'A', _openid: 'other-A', phone: PHONE }],
  ]) {
    const h = harness({ users });
    const before = snapshot(h.db);
    const result = await h.run({ code: 'code' });
    assert.ok(['SERVICE_UNAVAILABLE', 409].includes(result.code));
    assert.deepEqual(snapshot(h.db), before);
  }
});

test('repeated and concurrent same-WeChat registration reuse exactly one user/identity/phone proof', async () => {
  const h = harness();
  gateFirstCommits(h.db);
  const results = await Promise.all([h.run({ code: 'code-a' }), h.run({ code: 'code-b' })]);
  assert.ok(results.every((result) => result.code === 0));
  assert.equal(new Set(results.map((result) => result.userInfo._id)).size, 1);
  assert.equal(h.db.rows('users').length, 1);
  assert.equal(h.db.rows('tenant_auth_identities').length, 1);
  assert.equal(h.db.rows(PHONE_BINDINGS).length, 1);
  assert.ok(h.db.commitLog.some((entry) => entry.result === 'conflict-retry'));
  const again = await h.run({ code: 'code-c' });
  assert.equal(again.userInfo._id, results[0].userInfo._id);
  assert.equal(h.db.rows('users').length, 1);
});

test('concurrent different WeChat identities claiming one number have only one winner and no loser records', async () => {
  const db = new TenantAuthMemoryDB();
  const first = harness({ db });
  const otherContext = { ...CONTEXT, OPENID: 'other-openid' };
  const second = harness({ db, context: otherContext });
  gateFirstCommits(db);
  const results = await Promise.all([first.run({ code: 'first' }), second.run({ code: 'second' })]);
  assert.equal(results.filter((result) => result.code === 0).length, 1);
  assert.equal(results.filter((result) => result.code === 409).length, 1);
  assert.equal(db.rows('users').length, 1);
  assert.equal(db.rows('tenant_auth_identities').length, 1);
  assert.equal(db.rows(PHONE_BINDINGS).length, 1);
  const winner = results.find((result) => result.code === 0).userInfo._id;
  assert.equal(db.rows('users')[0]._id, winner);
  assert.equal(db.rows('tenant_auth_identities')[0].userId, winner);
  assert.equal(db.rows(PHONE_BINDINGS)[0].userId, winner);
  assert.ok(db.commitLog.some((entry) => entry.result === 'conflict-retry'));
  const loser = results[0].code === 409 ? first : second;
  const before = snapshot(db);
  assert.equal((await loser.run({ code: 'retry-loser' })).code, 409);
  assert.deepEqual(snapshot(db), before, 'loser must not commit a new user, identity or proof');
});

test('verified phone changes and corrupt phone proofs fail closed without altering the existing user', async () => {
  const h = harness();
  assert.equal((await h.run({ code: 'first' })).code, 0);
  const changed = harness({ db: h.db, phoneResult: { phoneInfo: { purePhoneNumber: '13900000002' } } });
  let before = snapshot(h.db);
  assert.equal((await changed.run({ code: 'new-phone' })).code, 409);
  assert.deepEqual(snapshot(h.db), before);
  const proof = h.db.rows(PHONE_BINDINGS)[0];
  h.db._write(PHONE_BINDINGS, proof._id, { ...proof, phoneHash: core.sha256('13900000002') });
  before = snapshot(h.db);
  assert.equal((await h.run({ code: 'same-phone' })).code, 'SERVICE_UNAVAILABLE');
  assert.deepEqual(snapshot(h.db), before);
});

test('transaction support/commit/proof read failures roll back user, identity and proof atomically', async () => {
  for (const failure of ['no-transaction', 'commit', 'proof-read']) {
    const h = harness();
    if (failure === 'no-transaction') h.db.runTransaction = undefined;
    if (failure === 'commit') h.db.failCommits = 1;
    if (failure === 'proof-read') h.db.afterRead = ({ collection }) => {
      if (collection === PHONE_BINDINGS) throw new Error('SYNTHETIC_PROOF_FAILURE');
    };
    const before = snapshot(h.db);
    assert.equal((await h.run({ code: 'code' })).code, 'SERVICE_UNAVAILABLE');
    assert.deepEqual(snapshot(h.db), before);
  }
});

test('phone login rechecks the user inside the transaction after concurrent admin binding', async () => {
  const h = harness({ users: [{ _id: 'existing', houses: [] }] });
  await core.withIdentity({ db: h.db, context: CONTEXT, now: () => NOW });
  let injected = false;
  h.db.beforeCommit = async () => {
    if (injected) return;
    injected = true;
    h.db._write('users', 'existing', { ...h.db.row('users', 'existing'), houses: ['admin-new-house'], housesManaged: true });
  };
  const result = await h.run({ code: 'code' });
  assert.equal(result.code, 0);
  assert.deepEqual(result.userInfo.houses, ['admin-new-house']);
  assert.ok(h.db.commitLog.some((entry) => entry.result === 'conflict-retry'));
});

test('password account requires prior phone verification then shares user and houses across both login paths', async () => {
  const h = harness({ users: [{ _id: 'existing', houses: ['manually-bound'], housesManaged: true }] });
  await core.withIdentity({ db: h.db, context: CONTEXT, now: () => NOW });
  const service = new TenantAccountService({ db: h.db, now: () => NOW });
  const input = { userId: 'existing', username: 'tenant-test', password: 'Valid password 123!' };
  const before = snapshot(h.db);
  await assert.rejects(() => service.createAccount({ id: 'admin-test', role: 'admin' }, input),
    (error) => error.code === 'USER_NOT_VERIFIED');
  assert.deepEqual(snapshot(h.db), before);
  const phone = await h.run({ code: 'code' });
  assert.equal(phone.code, 0);
  const account = await service.createAccount({ id: 'admin-test', role: 'admin' }, input);
  const password = await service.login(CONTEXT, { username: input.username, password: input.password });
  assert.equal(password.code, 0);
  assert.equal(phone.userInfo._id, account.userId);
  assert.equal(password.userInfo._id, phone.userInfo._id);
  assert.deepEqual(password.userInfo.houses, ['manually-bound']);
  assert.equal(h.db.rows('users').length, 1);
});

test('malformed phone binding point reads never treat an unreadable existing lock as missing', async () => {
  for (const malformed of [undefined, {}, { data: undefined }, { data: {} }, { data: { _id: 'wrong-id' } },
    { data: [{ _id: 'first' }, { _id: 'second' }] }, { code: 500, data: null }, { errCode: -1, data: [] }]) {
    const h = harness();
    const runTransaction = h.db.runTransaction.bind(h.db);
    h.db.runTransaction = (work) => runTransaction((tx) => {
      const collection = tx.collection.bind(tx);
      return work({ ...tx, collection(name) {
        const result = collection(name);
        if (name !== PHONE_BINDINGS) return result;
        return { ...result, doc(id) {
          const doc = result.doc(id);
          return { ...doc, async get() { return malformed; } };
        } };
      } });
    });
    const before = snapshot(h.db);
    assert.equal((await h.run({ code: 'code' })).code, 'SERVICE_UNAVAILABLE');
    assert.deepEqual(snapshot(h.db), before);
  }
});

test('an existing proof whose user timestamp was altered is not silently repaired by phone login', async () => {
  const h = harness();
  assert.equal((await h.run({ code: 'first' })).code, 0);
  const user = h.db.rows('users')[0];
  h.db._write('users', user._id, { ...user, phoneBoundAt: NOW - 1 });
  const before = snapshot(h.db);
  assert.equal((await h.run({ code: 'again' })).code, 'SERVICE_UNAVAILABLE');
  assert.deepEqual(snapshot(h.db), before);
});

test('nonzero query status with an apparently empty result cannot register a user or phone proof', async () => {
  for (const filterKey of ['phone', '_openid']) {
    for (const status of [{ code: 'SYNTHETIC_QUERY_FAILURE' }, { errCode: 7 }]) {
      const h = harness();
      const original = h.db.collection.bind(h.db);
      h.db.collection = (name) => {
        const collection = original(name);
        if (name !== 'users') return collection;
        return { ...collection, where(filter) {
          if (!Object.hasOwn(filter, filterKey)) return collection.where(filter);
          return { limit() { return this; }, async get() { return { ...status, data: [] }; } };
        } };
      };
      const before = snapshot(h.db);
      assert.equal((await h.run({ code: 'synthetic-code' })).code, 'SERVICE_UNAVAILABLE');
      assert.deepEqual(snapshot(h.db), before);
      assert.equal(h.db.rows('users').length, 0);
      assert.equal(h.db.rows(PHONE_BINDINGS).length, 0);
      assert.equal(h.db.rows('tenant_auth_accounts').length, 0);
    }
  }
});
