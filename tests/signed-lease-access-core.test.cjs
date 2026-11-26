'use strict';

// Synthetic identities, signing references and database records only. The real
// service runs under the preloaded network guard; no SDK or device is used.
require('./support/d-network-guard.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { TenantAuthMemoryDB } = require('./support/tenant-auth-memory-db.cjs');
const { identityIdFor, userIdFor } = require('../cloudfunctions/phoneLogin/lib/identity-core.js');
const { phoneBindingIdFor } = require('../cloudfunctions/phoneLogin/lib/phone-proof.js');
const { createService, COLLECTIONS } = require('../cloudfunctions/signedLeaseAccess/lib/service.js');
const { createMain } = require('../cloudfunctions/signedLeaseAccess/index.js');

const ADMIN = Object.freeze({ kind: 'admin', id: 'synthetic-admin-1' });
const ALICE = Object.freeze({ APPID: 'synthetic-app', OPENID: 'synthetic-alice' });
const BOB = Object.freeze({ APPID: 'synthetic-app', OPENID: 'synthetic-bob' });
const NOW = Date.parse('2026-12-02T04:00:00.000Z');
const FROM = Date.parse('2026-11-30T16:00:00.000Z');
const UNTIL = Date.parse('2026-12-05T16:00:00.000Z');
const TOKEN = 'synthetic-worker-token-001-abcdefghijklmnopqrstuvwxyz';
const WORKER = { workerId: 'synthetic-worker-1', token: TOKEN };
const HOUSE = 'synthetic-house-1';
const BINDING = 'synthetic-binding-1';
const CONTRACT = 'synthetic-contract-1';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const safeFailure = (error) => !!error && typeof error.code === 'string' && error.code.length > 0;

function seedResident(db, context, phone) {
  const userId = userIdFor(context);
  const identityId = identityIdFor(context);
  db._write('users', userId, { _id: userId, _openid: context.OPENID,
    wechatAppId: context.APPID, role: 'user', houses: [], points: 0,
    phone, phoneBoundAt: NOW, createdAt: NOW, lastLoginAt: NOW });
  db._write('tenant_auth_identities', identityId, { _id: identityId,
    schemaVersion: 1, appId: context.APPID, openid: context.OPENID, userId,
    revision: 1, createdAt: NOW, updatedAt: NOW });
  db._write('tenant_auth_phone_bindings', phoneBindingIdFor(context.APPID, phone), {
    schemaVersion: 1, appId: context.APPID, phoneHash: hash(phone),
    identityId, userId, verifiedAt: NOW,
  });
  return { userId, identityId, proofId: phoneBindingIdFor(context.APPID, phone) };
}

function fixture() {
  const db = new TenantAuthMemoryDB();
  let current = NOW;
  const now = () => current;
  const alice = seedResident(db, ALICE, '13800000001');
  const bob = seedResident(db, BOB, '13800000002');
  db._write('houses', HOUSE, { _id: HOUSE, title: 'Synthetic listing' });
  db._write('rooms', 'synthetic-room-1', { _id: 'synthetic-room-1', houseId: HOUSE,
    name: 'Synthetic room', revision: 1 });
  return { db, alice, bob, service: createService({ db, now }), now,
    setNow(value) { current = value; } };
}

function fact(ctx, changes = {}) {
  return { contractId: CONTRACT, expectedRevision: 0, userId: ctx.alice.userId,
    houseId: HOUSE, doorBindingId: BINDING, startDate: '2026-12-01',
    endDate: '2026-12-05', signedEvidenceRef: 'synthetic-external-evidence-1', ...changes };
}

async function configured(ctx) {
  await ctx.service.configureProgram(ADMIN, { expectedRevision: 0, enabled: true, dispatchEnabled: true });
  await ctx.service.setDoorBinding(ADMIN, { bindingId: BINDING, expectedRevision: 0,
    houseId: HOUSE, displayName: 'Synthetic door', deviceKey: 'synthetic-device-1',
    doorNo: 7, expectedModel: 'Synthetic-DS-K1T', enabled: true });
  await ctx.service.setWorker(ADMIN, { workerId: WORKER.workerId, expectedRevision: 0,
    deviceKey: 'synthetic-device-1', tokenHash: hash(TOKEN), enabled: true });
  return ctx;
}

async function signed(ctx = fixture()) {
  await configured(ctx);
  ctx.lease = await ctx.service.confirmSignedLease(ADMIN, fact(ctx));
  return ctx;
}

async function requested(ctx, requestId = 'synthetic-request-0001') {
  return ctx.service.requestOpen(ALICE, { contractId: CONTRACT, requestId });
}

async function claimed(ctx) {
  const request = await requested(ctx);
  const result = await ctx.service.claimOpen(WORKER);
  assert.ok(result.task, 'one queued task is claimable');
  assert.equal(result.task.taskId, request.taskId);
  return result.task;
}

async function begun(ctx) {
  const claim = await claimed(ctx);
  const task = await ctx.service.beginOpen({ ...WORKER, taskId: claim.taskId,
    claimId: claim.claimId, revision: claim.revision });
  return { claim, task };
}

function report(task, status = 'device_confirmed', deviceStatusCode = '1') {
  return { ...WORKER, taskId: task.taskId, claimId: task.claimId,
    revision: task.revision, status, deviceStatusCode };
}

function withBadTxResponses(db, collectionName, operation) {
  const original = db.runTransaction.bind(db);
  db.runTransaction = (work) => original((tx) => work({
    collection(name) {
      const collection = tx.collection(name);
      return { ...collection,
        doc(id) {
          const document = collection.doc(id);
          return { ...document,
            async get() {
              const result = await document.get();
              return name === collectionName && operation === 'get'
                ? { ...result, errCode: 'SYNTHETIC_EXPLICIT_READ_FAILURE' } : result;
            },
            async set(input) {
              const result = await document.set(input);
              return name === collectionName && operation === 'write'
                ? { ...result, errCode: 'SYNTHETIC_EXPLICIT_WRITE_FAILURE' } : result;
            },
          };
        },
        async add(input) {
          const result = await collection.add(input);
          return name === collectionName && operation === 'write'
            ? { ...result, errCode: 'SYNTHETIC_EXPLICIT_WRITE_FAILURE' } : result;
        },
      };
    },
  }));
}

test('verified registration alone grants no remote door; confirmation is atomic and does not mutate houses', async () => {
  const ctx = await configured(fixture());
  const beforeUser = ctx.db.row('users', ctx.alice.userId);
  assert.deepEqual((await ctx.service.listDoors(ALICE, {})).doors, []);
  await assert.rejects(() => requested(ctx), safeFailure);
  assert.equal(ctx.db.rows(COLLECTIONS.TASKS).length, 0);

  const lease = await ctx.service.confirmSignedLease(ADMIN, fact(ctx));
  assert.equal(lease.contractId, CONTRACT);
  assert.equal(lease.revision, 1);
  assert.equal(lease.validFrom, FROM);
  assert.equal(lease.validUntil, UNTIL);
  const door = (await ctx.service.listDoors(ALICE, {})).doors[0];
  assert.equal(door.startDate, '2026-12-01');
  assert.equal(door.endDate, '2026-12-05');
  assert.deepEqual(ctx.db.row('users', ctx.alice.userId), beforeUser);
  assert.equal(ctx.db.rows(COLLECTIONS.CONTRACTS).length, 1);
  assert.equal(ctx.db.rows(COLLECTIONS.GRANTS).length, 1);
  assert.equal(ctx.db.rows(COLLECTIONS.USER_ACCESS).length, 1);
  assert.equal(ctx.db.rows(COLLECTIONS.TASKS).length, 0, 'confirmation never sends or queues an opening');
  const doors = await ctx.service.listDoors(ALICE, {});
  assert.equal(doors.doors.length, 1);
  assert.equal(doors.doors[0].canOpen, true, 'no face task, application or payment is required');
  assert.equal(JSON.stringify(doors).includes('signedEvidenceRef'), false);
  assert.equal(JSON.stringify(doors).includes(TOKEN), false);
});

test('confirmation requires trusted admin, complete canonical identity and private phone proof', async () => {
  for (const mutate of [
    (ctx) => { ctx.actor = { kind: 'tenant', id: ctx.alice.userId }; },
    (ctx) => ctx.db._write('tenant_auth_identities', ctx.alice.identityId, null),
    (ctx) => ctx.db._write('tenant_auth_phone_bindings', ctx.alice.proofId, null),
    (ctx) => ctx.db._write('users', ctx.alice.userId, { ...ctx.db.row('users', ctx.alice.userId), wechatAppId: 'another-app' }),
  ]) {
    const ctx = await configured(fixture());
    mutate(ctx);
    const before = ctx.db.snapshot();
    await assert.rejects(() => ctx.service.confirmSignedLease(ctx.actor || ADMIN, fact(ctx)), safeFailure);
    assert.deepEqual(ctx.db.snapshot(), before);
  }
});

test('invalid dates, unknown/ambiguous houses and injected authority fields fail without granting', async () => {
  for (const changes of [
    { startDate: '' }, { startDate: '2026-02-30' }, { endDate: '2026-11-30' },
    { endDate: undefined }, { signedEvidenceRef: '' }, { houseId: 'missing-house' },
    { role: 'admin' }, { validUntil: UNTIL + 86400000 },
  ]) {
    const ctx = await configured(fixture());
    const before = ctx.db.snapshot();
    await assert.rejects(() => ctx.service.confirmSignedLease(ADMIN, fact(ctx, changes)), safeFailure);
    assert.deepEqual(ctx.db.snapshot(), before);
  }
  const ctx = fixture();
  ctx.db._write('rooms', 'synthetic-room-duplicate', { houseId: HOUSE, revision: 1 });
  const before = ctx.db.snapshot();
  await assert.rejects(() => ctx.service.setDoorBinding(ADMIN, { bindingId: BINDING,
    expectedRevision: 0, houseId: HOUSE, displayName: 'Ambiguous', deviceKey: 'synthetic-device-1',
    doorNo: 7, expectedModel: 'Synthetic-DS-K1T', enabled: true }), safeFailure);
  assert.deepEqual(ctx.db.snapshot(), before);
});

test('contract confirmation is idempotent, rejects stale/conflicting ownership and updates exact dates with CAS', async () => {
  const ctx = await signed();
  const before = ctx.db.snapshot();
  const duplicate = await ctx.service.confirmSignedLease(ADMIN, fact(ctx));
  assert.equal(duplicate.revision, 1);
  assert.deepEqual(ctx.db.snapshot(), before, 'identical replay creates no second grant or audit');
  for (const changes of [
    { endDate: '2026-12-06' },
    { expectedRevision: 1, userId: ctx.bob.userId },
    { expectedRevision: 1, houseId: 'different-house' },
  ]) await assert.rejects(() => ctx.service.confirmSignedLease(ADMIN, fact(ctx, changes)), safeFailure);
  const corrected = await ctx.service.confirmSignedLease(ADMIN, fact(ctx, {
    expectedRevision: 1, endDate: '2026-12-06', signedEvidenceRef: 'synthetic-correction-evidence-2',
  }));
  assert.equal(corrected.revision, 2);
  assert.equal(corrected.validUntil, Date.parse('2026-12-06T16:00:00.000Z'));
});

test('explicit SDK error responses and commit failures roll back contract, grant, index and audit together', async () => {
  for (const failure of [
    (db) => { db.failCommits = 1; },
    (db) => withBadTxResponses(db, 'users', 'get'),
    (db) => withBadTxResponses(db, COLLECTIONS.AUDITS, 'write'),
  ]) {
    const ctx = await configured(fixture());
    const before = ctx.db.snapshot();
    failure(ctx.db);
    await assert.rejects(() => ctx.service.confirmSignedLease(ADMIN, fact(ctx)), safeFailure);
    assert.deepEqual(ctx.db.snapshot(), before);
  }
});

test('lease boundaries use Shanghai midnight and never rely on registration or cached visible doors', async () => {
  const ctx = await signed();
  ctx.setNow(FROM - 1);
  assert.equal((await ctx.service.listDoors(ALICE, {})).doors[0].canOpen, false);
  await assert.rejects(() => requested(ctx), safeFailure);
  ctx.setNow(FROM);
  const first = await requested(ctx);
  assert.equal(first.status, 'queued');
  assert.ok(first.expiresAt <= FROM + 30000);
  ctx.setNow(UNTIL);
  await assert.rejects(() => requested(ctx, 'synthetic-after-lease-end'), safeFailure);
  assert.equal((await ctx.service.listDoors(ALICE, {})).doors[0].canOpen, false);
});

test('tenant isolation and closed input prevent another resident from selecting a lease or task', async () => {
  const ctx = await signed();
  const first = await requested(ctx);
  assert.deepEqual((await ctx.service.listDoors(BOB, {})).doors, []);
  for (const call of [
    () => ctx.service.requestOpen(BOB, { contractId: CONTRACT, requestId: 'synthetic-other-resident' }),
    () => ctx.service.getOpenResult(BOB, { taskId: first.taskId }),
    () => ctx.service.requestOpen(ALICE, { contractId: CONTRACT, requestId: 'synthetic-injected', userId: ctx.bob.userId }),
    () => ctx.service.listDoors({ ...ALICE, APPID: 'another-app' }, {}),
  ]) await assert.rejects(call, safeFailure);
});

test('request idempotency and grant singleflight prevent concurrent queued resends', async () => {
  const ctx = await signed();
  const [one, two] = await Promise.all([requested(ctx), requested(ctx)]);
  assert.equal(one.taskId, two.taskId);
  assert.equal(ctx.db.rows(COLLECTIONS.TASKS).length, 1);
  await assert.rejects(() => requested(ctx, 'synthetic-request-0002'), safeFailure);
  assert.equal(ctx.db.rows(COLLECTIONS.TASKS).length, 1);
  const claim = (await ctx.service.claimOpen(WORKER)).task;
  assert.ok(claim);
  assert.equal((await ctx.service.claimOpen(WORKER)).task, null);
  assert.equal(JSON.stringify(claim).includes(TOKEN), false);
  assert.equal(claim.deviceKey, 'synthetic-device-1');
  assert.equal(claim.doorNo, 7);
});

test('worker begin rechecks revocation, private proof, binding revision and dispatch switch before executing', async () => {
  for (const invalidate of [
    (ctx) => ctx.service.revokeLease(ADMIN, { contractId: CONTRACT, expectedRevision: 1, reason: 'synthetic-revocation' }),
    (ctx) => { ctx.db._write('tenant_auth_phone_bindings', ctx.alice.proofId, null); },
    (ctx) => ctx.service.setDoorBinding(ADMIN, { bindingId: BINDING, expectedRevision: 1,
      houseId: HOUSE, displayName: 'Synthetic changed door', deviceKey: 'synthetic-device-1',
      doorNo: 8, expectedModel: 'Synthetic-DS-K1T', enabled: true }),
    (ctx) => ctx.service.configureProgram(ADMIN, { expectedRevision: 1, enabled: true, dispatchEnabled: false }),
  ]) {
    const ctx = await signed();
    const claim = await claimed(ctx);
    await invalidate(ctx);
    await assert.rejects(() => ctx.service.beginOpen({ ...WORKER, taskId: claim.taskId,
      claimId: claim.claimId, revision: claim.revision }), safeFailure);
    assert.notEqual(ctx.db.row(COLLECTIONS.TASKS, claim.taskId).status, 'executing');
  }
});

test('worker begin executes once; exact confirmed receipt is idempotent and releases singleflight', async () => {
  const ctx = await signed();
  const { claim, task } = await begun(ctx);
  await assert.rejects(() => ctx.service.beginOpen({ ...WORKER, taskId: claim.taskId,
    claimId: claim.claimId, revision: claim.revision }), safeFailure);
  const first = await ctx.service.reportOpen(report(task));
  assert.equal(first.status, 'device_confirmed');
  const after = ctx.db.snapshot();
  const duplicate = await ctx.service.reportOpen(report(task));
  assert.equal(duplicate.status, 'device_confirmed');
  assert.deepEqual(ctx.db.snapshot(), after);
  await assert.rejects(() => ctx.service.reportOpen(report(task, 'failed', '2')), safeFailure);
  const next = await requested(ctx, 'synthetic-request-after-known-result');
  assert.notEqual(next.taskId, task.taskId);
  assert.equal(next.status, 'queued');
});

test('expired executing task becomes unknown and blocks retry until an audited admin disposition', async () => {
  const ctx = await signed();
  const { task } = await begun(ctx);
  ctx.setNow(task.expiresAt + 1);
  const result = await ctx.service.getOpenResult(ALICE, { taskId: task.taskId });
  assert.equal(result.status, 'unknown');
  assert.equal((await ctx.service.claimOpen(WORKER)).task, null);
  await assert.rejects(() => requested(ctx, 'synthetic-after-unknown'), safeFailure);
  const record = ctx.db.row(COLLECTIONS.TASKS, task.taskId);
  await ctx.service.resolveUnknown(ADMIN, { taskId: task.taskId,
    expectedRevision: record.revision, reason: 'synthetic operator disposition; no assertion of physical release' });
  const disposed = await ctx.service.getOpenResult(ALICE, { taskId: task.taskId });
  assert.equal(disposed.status, 'unknown');
  assert.equal(disposed.resolved, true, 'disposition is visible without inventing a device success');
  const next = await requested(ctx, 'synthetic-after-disposition');
  assert.notEqual(next.taskId, task.taskId);
  assert.equal(ctx.db.rows(COLLECTIONS.TASKS).length, 2, 'disposition does not resend the original command');
});

test('a known device receipt after lease expiry is retained, while new authorization remains denied', async () => {
  const ctx = await signed();
  ctx.setNow(UNTIL - 500);
  const { task } = await begun(ctx);
  assert.equal(task.expiresAt, UNTIL);
  ctx.setNow(UNTIL + 1000);
  const result = await ctx.service.reportOpen(report(task));
  assert.equal(result.status, 'device_confirmed');
  assert.equal((await ctx.service.getOpenResult(ALICE, { taskId: task.taskId })).status, 'device_confirmed');
  await assert.rejects(() => requested(ctx, 'synthetic-expired-new-authorization'), safeFailure);
});

test('report status codes are closed and worker credentials never become task or audit content', async () => {
  const ctx = await signed();
  const { task } = await begun(ctx);
  for (const input of [
    { ...report(task), token: 'wrong-synthetic-token' },
    report(task, 'device_confirmed', '200'),
    report(task, 'unknown', 'SYNTHETIC_TIMEOUT'),
    report(task, 'failed', 'raw response body'),
    { ...report(task), rawResponse: 'arbitrary synthetic body' },
  ]) await assert.rejects(() => ctx.service.reportOpen(input), safeFailure);
  await ctx.service.reportOpen(report(task, 'unknown', null));
  assert.equal((await ctx.service.getOpenResult(ALICE, { taskId: task.taskId })).status, 'unknown');
  const stored = JSON.stringify([ctx.db.rows(COLLECTIONS.TASKS), ctx.db.rows(COLLECTIONS.AUDITS)]);
  assert.equal(stored.includes(TOKEN), false);
  assert.equal(stored.includes('raw response body'), false);
});

test('worker credential length matches the local loader exact 32 to 256 character boundary', async () => {
  for (const length of [31, 32, 256, 257]) {
    const ctx = await configured(fixture());
    const token = 's'.repeat(length);
    await ctx.service.setWorker(ADMIN, { workerId: WORKER.workerId, expectedRevision: 1,
      deviceKey: 'synthetic-device-1', tokenHash: hash(token), enabled: true });
    const before = ctx.db.snapshot();
    const call = () => ctx.service.claimOpen({ workerId: WORKER.workerId, token });
    if (length === 32 || length === 256) assert.deepEqual(await call(), { task: null });
    else await assert.rejects(call, (error) => error.code === 'WORKER_UNAUTHORIZED');
    assert.deepEqual(ctx.db.snapshot(), before);
  }
});

test('cloud boundary derives tenant/admin identity and authenticates workers independently of WX claims', async () => {
  const ctx = await signed();
  const main = createMain({ db: ctx.db, now: ctx.now, cloud: { getWXContext: () => ALICE } });
  const listed = await main({ action: 'listDoors' });
  assert.equal(listed.code, 0);
  assert.equal(listed.data.doors.length, 1);
  const before = ctx.db.snapshot();
  for (const event of [
    { action: 'confirmSignedLease', ...fact(ctx), actor: ADMIN },
    { action: 'configureProgram', expectedRevision: 1, enabled: true, dispatchEnabled: true, role: 'admin' },
    { action: 'listDoors', userId: ctx.bob.userId },
  ]) {
    const denied = await main(event);
    assert.notEqual(denied.code, 0);
    assert.deepEqual(ctx.db.snapshot(), before);
  }
  const request = await requested(ctx);
  const workerMain = createMain({ db: ctx.db, now: ctx.now, cloud: {
    getWXContext() { throw new Error('WORKER_MUST_NOT_TRUST_WX_CONTEXT'); },
  } });
  const result = await workerMain({ action: 'claimOpen', ...WORKER });
  assert.equal(result.code, 0);
  assert.equal(result.data.task.taskId, request.taskId);
  const failedMain = createMain({ db: ctx.db, now: ctx.now, cloud: { getWXContext() {
    throw Object.assign(new Error('synthetic private upstream details'), { code: 'SYNTHETIC_PRIVATE_UPSTREAM_ERROR', status: 409 });
  } } });
  assert.deepEqual(await failedMain({ action: 'listDoors' }), { code: 'SERVICE_UNAVAILABLE', status: 503, msg: 'SERVICE_UNAVAILABLE' });
});

test('listing many owned contracts stays within a bounded point-read transaction and preserves the user index', async () => {
  const ctx = await configured(fixture());
  await Promise.all([0, 1].map((number) => ctx.service.confirmSignedLease(ADMIN,
    fact(ctx, { contractId: `synthetic-concurrent-contract-${number}` }))));
  for (let number = 2; number < 20; number += 1) await ctx.service.confirmSignedLease(ADMIN,
    fact(ctx, { contractId: `synthetic-concurrent-contract-${number}` }));
  const index = ctx.db.rows(COLLECTIONS.USER_ACCESS)[0];
  assert.equal(index.contractIds.length, 20);
  const observed = [];
  ctx.db.beforeCommit = async ({ reads }) => {
    observed.push(reads.length);
    assert.ok(reads.length <= 16, `one list transaction read ${reads.length} references`);
  };
  const listing = await ctx.service.listDoors(ALICE, {});
  assert.equal(listing.doors.length, 20);
  assert.ok(listing.doors.every((door) => door.canOpen));
  assert.equal(observed.length, 21, 'identity/index snapshot plus one small transaction per contract');
});

test('queued expiry releases singleflight without requeueing or resending the old request key', async () => {
  const ctx = await signed();
  const first = await requested(ctx);
  ctx.setNow(first.expiresAt);
  assert.equal((await ctx.service.getOpenResult(ALICE, { taskId: first.taskId })).status, 'expired');
  assert.equal((await requested(ctx)).status, 'expired');
  const second = await requested(ctx, 'synthetic-fresh-after-unsent-expiry');
  assert.notEqual(second.taskId, first.taskId);
  assert.equal((await ctx.service.claimOpen(WORKER)).task.taskId, second.taskId);
});

test('a concurrent revocation forces authorization retry and leaves no queued opening', async () => {
  const ctx = await signed();
  let revoked = false;
  ctx.db.beforeCommit = async ({ writes }) => {
    if (revoked || !writes.some((write) => write.collection === COLLECTIONS.TASKS)) return;
    revoked = true;
    ctx.db.beforeCommit = null;
    await ctx.service.revokeLease(ADMIN, { contractId: CONTRACT, expectedRevision: 1, reason: 'synthetic concurrent revocation' });
  };
  await assert.rejects(() => requested(ctx), safeFailure);
  assert.equal(revoked, true);
  assert.equal(ctx.db.rows(COLLECTIONS.TASKS).length, 0);
  assert.ok(ctx.db.commitLog.some((entry) => entry.result === 'conflict-retry'));
});

test('trusted admin record lookup is read-only, point-based and returns only safe revision DTOs', async () => {
  const ctx = await signed();
  const { task } = await begun(ctx);
  const before = ctx.db.snapshot();
  for (const [kind, id, required] of [
    ['contract', CONTRACT, ['contractId', 'revision', 'status', 'userId', 'houseId', 'doorBindingId', 'startDate', 'endDate', 'validFrom', 'validUntil']],
    ['binding', BINDING, ['bindingId', 'revision', 'houseId', 'displayName', 'deviceKey', 'doorNo', 'expectedModel', 'enabled']],
    ['worker', WORKER.workerId, ['workerId', 'revision', 'deviceKey', 'enabled']],
    ['program', 'program', ['revision', 'enabled', 'dispatchEnabled']],
    ['task', task.taskId, ['taskId', 'revision', 'status', 'resolved', 'contractId', 'expiresAt', 'message']],
  ]) {
    const result = await ctx.service.getAdminRecord(ADMIN, { kind, id });
    assert.equal(result.kind, kind);
    assert.deepEqual(Object.keys(result.record).sort(), required.sort());
    assert.equal(typeof result.record.revision, 'number');
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
    assert.equal(JSON.stringify(result).includes(hash(TOKEN)), false);
  }
  assert.equal((await ctx.service.getAdminRecord(ADMIN, { kind: 'task', id: task.taskId })).record.resolved, false);
  assert.equal((await ctx.service.getAdminRecord(ADMIN, { kind: 'program' })).record.revision, 1);
  assert.deepEqual(await ctx.service.getAdminRecord(ADMIN, { kind: 'contract', id: 'synthetic-missing-record' }), { kind: 'contract', record: null });
  for (const [actor, input] of [
    [{ kind: 'user', id: ctx.alice.userId }, { kind: 'contract', id: CONTRACT }],
    [ADMIN, { kind: 'arbitrary-collection', id: CONTRACT }],
    [ADMIN, { kind: 'program', id: 'different-program' }],
    [ADMIN, { kind: 'worker', id: WORKER.workerId, tokenHash: hash(TOKEN) }],
  ]) await assert.rejects(() => ctx.service.getAdminRecord(actor, input), safeFailure);
  const tenantMain = createMain({ db: ctx.db, now: ctx.now, cloud: { getWXContext: () => ALICE } });
  assert.notEqual((await tenantMain({ action: 'getAdminRecord', kind: 'contract', id: CONTRACT })).code, 0);
  assert.deepEqual(ctx.db.snapshot(), before);
});

test('persisted signed-fact corruption never becomes an opening even when grant revisions match the corruption', async (t) => {
  const mutations = [
    ['wrong schema version', (contract) => { contract.schemaVersion = 2; }],
    ['zero revisions in contract and grant', (contract, grant) => {
      contract.revision = 0; grant.contractRevision = 0; grant.revision = 0;
    }],
    ['negative revisions in contract and grant', (contract, grant) => {
      contract.revision = -1; grant.contractRevision = -1; grant.revision = -1;
    }],
    ['fractional revisions in contract and grant', (contract, grant) => {
      contract.revision = 1.5; grant.contractRevision = 1.5; grant.revision = 1.5;
    }],
    ['unsafe revisions in contract and grant', (contract, grant) => {
      contract.revision = Number.MAX_SAFE_INTEGER + 1;
      grant.contractRevision = contract.revision; grant.revision = contract.revision;
    }],
    ['missing signing evidence', (contract) => { delete contract.signedEvidenceRef; }],
    ['noninteger signing timestamp', (contract) => { contract.signedAt = NOW + 0.5; }],
    ['unsafe signing timestamp', (contract) => { contract.signedAt = Number.MAX_SAFE_INTEGER + 1; }],
    ['noninteger creation timestamp', (contract) => { contract.createdAt = NOW + 0.5; }],
    ['unsafe creation timestamp', (contract) => { contract.createdAt = Number.MAX_SAFE_INTEGER + 1; }],
    ['noninteger update timestamps in contract and grant', (contract, grant) => {
      contract.updatedAt = NOW + 0.5; grant.updatedAt = contract.updatedAt;
    }],
    ['unsafe update timestamps in contract and grant', (contract, grant) => {
      contract.updatedAt = Number.MAX_SAFE_INTEGER + 1; grant.updatedAt = contract.updatedAt;
    }],
  ];
  for (const [label, corrupt] of mutations) {
    await t.test(label, async () => {
      const ctx = await signed();
      const contract = ctx.db.rows(COLLECTIONS.CONTRACTS)[0];
      const grant = ctx.db.rows(COLLECTIONS.GRANTS)[0];
      corrupt(contract, grant);
      ctx.db._write(COLLECTIONS.CONTRACTS, contract._id, contract);
      ctx.db._write(COLLECTIONS.GRANTS, grant._id, grant);
      await assert.rejects(() => requested(ctx), safeFailure);
      assert.equal(ctx.db.rows(COLLECTIONS.TASKS).length, 0,
        'a matching malformed contract/grant pair must not authorize a command');
    });
  }
});

test('identical confirmation refuses missing or mismatched grant/index records without silently repairing them', async (t) => {
  const mutations = [
    ['missing grant', (ctx, contract, grant) => ctx.db._write(COLLECTIONS.GRANTS, grant._id, null)],
    ['missing user index', (ctx, contract, grant, index) => ctx.db._write(COLLECTIONS.USER_ACCESS, index._id, null)],
    ['grant identity mismatch', (ctx, contract, grant) => {
      ctx.db._write(COLLECTIONS.GRANTS, grant._id, { ...grant, identityId: ctx.bob.identityId });
    }],
    ['grant user mismatch', (ctx, contract, grant) => {
      ctx.db._write(COLLECTIONS.GRANTS, grant._id, { ...grant, userId: ctx.bob.userId });
    }],
    ['grant contract mismatch', (ctx, contract, grant) => {
      ctx.db._write(COLLECTIONS.GRANTS, grant._id, { ...grant, contractId: 'synthetic-other-contract' });
    }],
    ['grant contract revision mismatch', (ctx, contract, grant) => {
      ctx.db._write(COLLECTIONS.GRANTS, grant._id, { ...grant, contractRevision: contract.revision + 1 });
    }],
    ['grant house mismatch', (ctx, contract, grant) => {
      ctx.db._write(COLLECTIONS.GRANTS, grant._id, { ...grant, houseId: 'synthetic-other-house' });
    }],
    ['grant binding mismatch', (ctx, contract, grant) => {
      ctx.db._write(COLLECTIONS.GRANTS, grant._id, { ...grant, doorBindingId: 'synthetic-other-binding' });
    }],
    ['grant revision corrupted', (ctx, contract, grant) => {
      ctx.db._write(COLLECTIONS.GRANTS, grant._id, { ...grant, revision: 0 });
    }],
    ['index identity mismatch', (ctx, contract, grant, index) => {
      ctx.db._write(COLLECTIONS.USER_ACCESS, index._id, { ...index, identityId: ctx.bob.identityId });
    }],
    ['index user mismatch', (ctx, contract, grant, index) => {
      ctx.db._write(COLLECTIONS.USER_ACCESS, index._id, { ...index, userId: ctx.bob.userId });
    }],
    ['index omits this contract', (ctx, contract, grant, index) => {
      ctx.db._write(COLLECTIONS.USER_ACCESS, index._id, { ...index, contractIds: [] });
    }],
    ['index duplicates this contract', (ctx, contract, grant, index) => {
      ctx.db._write(COLLECTIONS.USER_ACCESS, index._id, { ...index, contractIds: [CONTRACT, CONTRACT] });
    }],
    ['index revision corrupted', (ctx, contract, grant, index) => {
      ctx.db._write(COLLECTIONS.USER_ACCESS, index._id, { ...index, revision: 0 });
    }],
    ['contract schema corrupted', (ctx, contract) => {
      ctx.db._write(COLLECTIONS.CONTRACTS, contract._id, { ...contract, schemaVersion: 2 });
    }],
    ['contract application identity mismatch', (ctx, contract) => {
      ctx.db._write(COLLECTIONS.CONTRACTS, contract._id, { ...contract, appId: 'synthetic-other-app' });
    }],
    ['contract creation timestamp corrupted', (ctx, contract) => {
      ctx.db._write(COLLECTIONS.CONTRACTS, contract._id, { ...contract, createdAt: NOW + 0.5 });
    }],
  ];
  for (const [label, corrupt] of mutations) {
    await t.test(label, async () => {
      const ctx = await signed();
      const contract = ctx.db.rows(COLLECTIONS.CONTRACTS)[0];
      const grant = ctx.db.rows(COLLECTIONS.GRANTS)[0];
      const index = ctx.db.rows(COLLECTIONS.USER_ACCESS)[0];
      corrupt(ctx, contract, grant, index);
      const before = ctx.db.snapshot();
      await assert.rejects(() => ctx.service.confirmSignedLease(ADMIN, fact(ctx)), safeFailure);
      assert.deepEqual(ctx.db.snapshot(), before,
        'idempotent confirmation cannot certify or repair corrupted authority records');
      assert.equal(ctx.db.rows(COLLECTIONS.TASKS).length, 0);
    });
  }
});
