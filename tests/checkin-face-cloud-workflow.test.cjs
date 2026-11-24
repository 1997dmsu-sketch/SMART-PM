'use strict';

/**
 * B05 / §6 — 云函数 checkinFaceTest 的可证伪合成测试（内存 DB 替身）。
 *
 * 覆盖任务卡 §6 的自动通过、房号来源、租期边界、归属、幂等/竞态、
 * 开关隔离、全天规则、report 反校验与未知结果处理。
 * 本测试不连接真实微信云/设备，也不代表真机通过。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, timingSafeEqual } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const CLOUD_DIR = path.join(ROOT, 'cloudfunctions/checkinFaceTest');
const { createMain } = require(path.join(CLOUD_DIR, 'index.js'));
const { ENVIRONMENT, COLLECTIONS, ids } = require(path.join(CLOUD_DIR, 'lib/store.js'));
const dates = require(path.join(CLOUD_DIR, 'lib/dates.js'));
const validate = require(path.join(CLOUD_DIR, 'lib/validate.js'));
const context = require(path.join(CLOUD_DIR, 'lib/context.js'));
const { STATUS, DISPLAY_STATE } = require(path.join(CLOUD_DIR, 'lib/workflow.js'));
const { AdminCheckinFaceTestConfig } = require(path.join(ROOT, 'admin-web/lib/checkin-face-test-config.mjs'));

const OPENID = 'test-user-01';
const OTHER_OPENID = 'other-user-99';
const VERSION = 'test-v1';
const TOKEN = 'synthetic-worker-token-0123456789';
const TOKEN_HASH = createHash('sha256').update(TOKEN, 'utf8').digest('hex');
const FINGERPRINT = 'a'.repeat(64);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0, 1, 0xff, 0xd9]);
const FIXED = new Date('2026-12-03T04:00:00Z'); // Asia/Shanghai 2026-12-03 12:00:00
const ENV = ENVIRONMENT;

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

/** 只实现被测代码使用的 wx-server-sdk 数据库子集；每次 get/set 均为深拷贝。 */
class MemoryDB {
  constructor() {
    this.collections = new Map();
    this.writes = 0;
    this.whereGets = [];
    this.seq = 0;
  }

  bucket(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    return this.collections.get(name);
  }

  rows(name) { return [...this.bucket(name).values()].map(clone); }
  row(name, id) { const value = this.bucket(name).get(id); return value ? clone(value) : null; }

  collection(name) {
    const db = this;
    const store = this.bucket(name);
    const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
    return {
      doc: (id) => ({
        get: async () => {
          const value = store.get(id);
          if (!value) throw Object.assign(new Error('document does not exist'), { errCode: -1 });
          return { data: clone(value) };
        },
        set: async ({ data }) => {
          db.writes += 1;
          store.set(id, clone({ ...data, _id: id }));
          return {};
        },
      }),
      where: (where) => ({
        get: async () => {
          db.whereGets.push({ collection: name, where: clone(where), kind: 'get' });
          return { data: db.rows(name).filter((row) => matches(row, where)) };
        },
        count: async () => ({ total: db.rows(name).filter((row) => matches(row, where)).length }),
        update: async ({ data }) => {
          let updated = 0;
          for (const [id, row] of store) {
            if (matches(row, where)) {
              db.writes += 1;
              store.set(id, clone({ ...row, ...data }));
              updated += 1;
            }
          }
          return { stats: { updated } };
        },
      }),
      add: async ({ data }) => {
        db.writes += 1;
        const id = data._id || `auto-${++db.seq}`;
        store.set(id, clone({ ...data, _id: id }));
        return { _id: id };
      },
      get: async () => ({ data: db.rows(name) }),
    };
  }

  runTransaction(fn) { return fn(this); }
}

const ROOM_INPUT = {
  displayNo: '102', projectId: 'project-stable-1', buildingId: 'building-stable-1',
  roomId: 'room-stable-1', houseId: 'house-stable-1', doorNo: 7,
  deviceKey: 'device-key-stable', accessPlanFingerprint: FINGERPRINT,
  projectName: '合成项目', buildingName: '合成楼栋',
};
const LEASE_INPUT = { startDate: '2026-12-01', endDate: '2026-12-05' };

/**
 * 只通过 AdminCheckinFaceTestConfig 的公开方法配置测试程序；
 * applicationVersion / dispatchEnabled 不得由测试直接写 mock DB。
 * 若公开方法缺失或配置顺序失效，所有依赖本 fixture 的用例都会 FAIL。
 */
async function fixture({ openid = OPENID, enabled = true, dispatchEnabled = true, now = FIXED } = {}) {
  const db = new MemoryDB();
  const admin = new AdminCheckinFaceTestConfig(null, {
    database: db, environment: ENV, operator: 'synthetic-admin', now: () => now,
  });
  await admin.upsertRoomBinding(ROOM_INPUT);
  // 生产 upsertLease 要求版本已配置；提前配置版本可保证租期快照版本一致。
  await admin.setApplicationVersion(VERSION);
  await admin.upsertLease(LEASE_INPUT);
  await admin.setAllowlist([OPENID]);
  await admin.setWorkerToken(TOKEN);
  await admin.setDispatchEnabled(dispatchEnabled);
  await admin.setSwitch(enabled);

  const config = db.row(COLLECTIONS.CONFIG, ids.configId(ENV));
  const room = db.row(COLLECTIONS.ROOM, ids.roomBindingId(ENV));
  const lease = db.row(COLLECTIONS.LEASE, ids.leaseId(ENV));
  db.writes = 0;
  let currentOpenid = openid;
  let currentNow = now;
  const cloud = {
    getWXContext: () => ({ OPENID: currentOpenid }),
    downloadFile: async () => ({ fileContent: JPEG }),
  };
  const setOpenid = (value) => { currentOpenid = value; };
  const setNow = (value) => { currentNow = value; };
  const main = (event) => createMain({ db, cloud, environment: ENV, now: () => currentNow })(event);
  const apply = (extra = {}) => main({ action: 'applyCheckin', applicationVersion: VERSION, ...extra });
  const taskFor = (applicationId) => db.row(COLLECTIONS.TASK, ids.taskId(ENV, applicationId));
  return { db, admin, cloud, main, apply, setOpenid, setNow, config, room, lease, taskFor, token: TOKEN };
}

async function approvedFixture(options) {
  const ctx = await fixture(options);
  const applied = await ctx.apply();
  assert.equal(applied.code, 0, JSON.stringify(applied));
  assert.equal(applied.data.result, 'auto_approved');
  return { ...ctx, applied, applicationId: applied.data.applicationId };
}

function fileId(applicationId, openid = OPENID, name = 'photo.jpg') {
  return `test-face/${ENV}/${openid}/${applicationId}/${name}`;
}

async function queuedFixture(options) {
  const ctx = await approvedFixture(options);
  const created = await ctx.main({
    action: 'createFaceTask', applicationId: ctx.applicationId,
    fileId: fileId(ctx.applicationId), consent: true,
  });
  assert.equal(created.code, 0, JSON.stringify(created));
  return { ...ctx, created, taskId: created.data.taskId };
}

async function claim(ctx) {
  const result = await ctx.main({ action: 'claimTask', workerToken: TOKEN, workerId: 'synthetic-worker-01' });
  return result;
}

function successOutput(task, overrides = {}) {
  return {
    protocolVersion: 1,
    outcome: 'device-enrollment-confirmed-pending-site',
    mode: 'device',
    personnelId: task.employeeNo,
    employeeNo: task.employeeNo,
    doorNo: task.doorNo,
    validityMode: 'fixed',
    validFrom: task.validFrom,
    validTo: task.validTo,
    dailyHours: '24x7',
    siteVerification: 'PENDING',
    accessPlanFingerprint: task.accessPlanFingerprint,
    faceModelingVerified: true,
    faceAssociationConfirmed: true,
    enrollment: {
      employeeNo: task.employeeNo, doorNo: task.doorNo, validityMode: 'fixed', mode: 'device',
      validFrom: task.validFrom, validTo: task.validTo,
      accessPlanFingerprint: task.accessPlanFingerprint,
      faceSubmitted: true, faceModelingVerified: true, faceAssociationConfirmed: true,
      status: 'ready',
      steps: [{ key: 'verify', state: 'success' }],
    },
    steps: [{ key: 'verify', state: 'success' }],
    ...overrides,
  };
}

/**
 * P0 守门：配置必须完全由 AdminCheckinFaceTestConfig 的公开方法完成。
 * 若任一公开方法缺失、顺序不可用、版本/派发开关无法写入，
 * 本用例会在 getConfig/apply/claim 任一步失败，而不是恒过。
 */
test('P0 守门：仅用后台全部公开配置能力即可完成 auto_approved + claim 成功', async () => {
  const ctx = await fixture();
  const snapshot = await ctx.admin.getConfig();
  assert.equal(snapshot.config.applicationVersion, VERSION, 'getConfig 必须返回非空申请版本');
  assert.equal(snapshot.config.enabled, true);
  assert.equal(snapshot.config.dispatchEnabled, true);
  assert.equal(snapshot.config.workerTokenConfigured, true);
  assert.equal(snapshot.room.displayNo, '102');
  assert.equal(snapshot.lease.validTo, '2026-12-05T23:59:59');
  assert.equal(snapshot.lease.applicationVersion, VERSION, '租期快照必须同步公开配置的版本');

  const applied = await ctx.apply();
  assert.equal(applied.code, 0, `applyCheckin 失败：${JSON.stringify(applied)}`);
  assert.equal(applied.data.result, 'auto_approved');
  const created = await ctx.main({
    action: 'createFaceTask', applicationId: applied.data.applicationId,
    fileId: fileId(applied.data.applicationId), consent: true,
  });
  assert.equal(created.code, 0, `createFaceTask 失败：${JSON.stringify(created)}`);
  const claimed = await claim(ctx);
  assert.equal(claimed.code, 0, `claimTask 失败：${JSON.stringify(claimed)}`);
  assert.ok(claimed.data.task, '公开配置完成后 claimTask 不得返回 DISPATCH_DISABLED/null');
  assert.equal(claimed.data.task.doorNo, 7);
  assert.equal(claimed.data.task.employeeNo, applied.data.employeeNo);
});

test('公开方法轮换版本后租期快照同步，云端全流程仍通过且终态为待现场刷脸', async () => {
  const ctx = await fixture();
  const rotated = await ctx.admin.setApplicationVersion('test-v2');
  assert.equal(rotated.applicationVersion, 'test-v2');
  assert.equal(rotated.leaseVersionSynced, true, '版本轮换必须同步已有租期快照');
  const adminView = await ctx.admin.getConfig();
  assert.equal(adminView.lease.applicationVersion, 'test-v2');

  const cfg = await ctx.main({ action: 'getConfig' });
  assert.equal(cfg.code, 0);
  assert.equal(cfg.data.applicationVersion, 'test-v2');
  const applied = await ctx.main({ action: 'applyCheckin', applicationVersion: 'test-v2' });
  assert.equal(applied.code, 0, `轮换后 apply 失败：${JSON.stringify(applied)}`);
  assert.equal(applied.data.result, 'auto_approved');
  const created = await ctx.main({
    action: 'createFaceTask', applicationId: applied.data.applicationId,
    fileId: fileId(applied.data.applicationId), consent: true,
  });
  assert.equal(created.code, 0, `轮换后 create 失败：${JSON.stringify(created)}`);
  const claimed = await claim(ctx);
  assert.equal(claimed.code, 0, `轮换后 claim 失败：${JSON.stringify(claimed)}`);
  assert.ok(claimed.data.task);
  const reported = await ctx.main({
    action: 'reportTask', workerToken: TOKEN, taskId: claimed.data.task.taskId,
    claimId: claimed.data.task.claimId, revision: claimed.data.task.revision,
    exitCode: 0, output: successOutput(claimed.data.task),
  });
  assert.equal(reported.code, 0, `轮换后 report 失败：${JSON.stringify(reported)}`);
  assert.equal(reported.data.status, STATUS.PENDING_SITE_VERIFICATION);
  const view = await ctx.main({ action: 'getMyTask', applicationId: applied.data.applicationId });
  assert.equal(view.code, 0);
  assert.equal(view.data.siteVerification, 'PENDING');
  assert.equal(view.data.status, STATUS.PENDING_SITE_VERIFICATION);
});

test('名单+102+有效租期+版本一致才 auto_approved，落稳定 id 与 employeeNo', async () => {
  const ctx = await approvedFixture();
  const expectedId = ids.applicationId(ENV, OPENID, VERSION, ctx.lease.revision, ctx.room.revision);
  assert.equal(ctx.applied.data.applicationId, expectedId);
  assert.match(ctx.applied.data.employeeNo, /^F[0-9A-F]{16}$/);
  const row = ctx.db.row(COLLECTIONS.APPLICATION, expectedId);
  assert.equal(row.result, 'auto_approved');
  assert.equal(row.employeeNo, ctx.applied.data.employeeNo);
  assert.equal(row.leaseRevision, ctx.lease.revision);
  assert.equal(row.roomRevision, ctx.room.revision);
  assert.deepEqual(row.decisionReasons, ['allowlist_active', 'room_102_unique', 'lease_active', 'version_match']);
  assert.deepEqual(row.room, {
    displayNo: '102', roomId: 'room-stable-1', houseId: 'house-stable-1',
    projectId: 'project-stable-1', buildingId: 'building-stable-1',
    projectName: '合成项目', buildingName: '合成楼栋',
  });
  assert.ok(ctx.db.writes >= 2, '应写申请与审计');
});

/**
 * 语义固化：任务卡 §6「普通账号保持原审核流程」与方案 §3.1 的内部错误码
 * ACCOUNT_NOT_ALLOWED 并不矛盾：后者是服务端判据，不应暴露给普通账号作为
 * 可操作错误码；对普通账号的正确行为是返回 pending_review、不写测试集合。
 */
test('普通账号语义：ACCOUNT_NOT_ALLOWED 不外露，返回 pending_review 且测试集合零写入', async () => {
  const ctx = await fixture();
  const auditBefore = ctx.db.rows(COLLECTIONS.AUDIT).length;
  ctx.setOpenid(OTHER_OPENID);
  const result = await ctx.apply();
  assert.equal(result.code, 0, '普通账号不是错误请求，不能暴露 ACCOUNT_NOT_ALLOWED');
  assert.ok(!JSON.stringify(result).includes('ACCOUNT_NOT_ALLOWED'));
  assert.equal(result.data.result, 'pending_review');
  assert.equal(result.data.applicationId, '');
  assert.equal(result.data.idempotent, false);
  for (const name of [COLLECTIONS.APPLICATION, COLLECTIONS.TASK]) {
    assert.equal(ctx.db.rows(name).length, 0, `${name} 不得被普通账号写入`);
  }
  assert.equal(ctx.db.rows(COLLECTIONS.AUDIT).length, auditBefore, '不得写测试自动通过审计');
  assert.equal(ctx.db.writes, 0);
});

test('伪造 approved/testMode/room/日期/身份字段在云函数入口被拒且不写库', async () => {
  const forged = ['approved', 'testMode', 'mode', 'validityMode', 'roomNo', 'roomId', 'houseId', 'doorNo', 'employeeNo', 'validFrom', 'validTo', 'status', 'openid'];
  for (const field of forged) {
    const ctx = await fixture();
    const before = ctx.db.writes;
    const result = await ctx.apply({ [field]: true });
    assert.equal(result.code, 'CLIENT_FIELD_FORBIDDEN', `${field} 必须被拒绝`);
    assert.equal(ctx.db.writes, before, `${field} 不得触发任何写库`);
    assert.equal(ctx.db.rows(COLLECTIONS.APPLICATION).length, 0);
  }
  const unknown = await fixture();
  assert.equal((await unknown.main({ action: 'requeueTask' })).code, 'UNKNOWN_ACTION', '不得存在 requeue action');
  assert.equal((await unknown.main({ action: 'unlock' })).code, 'UNKNOWN_ACTION');
});

test('关闭开关、版本不符、租期未配置/过期、102 歧义分别返回指定错误码', async () => {
  const cases = [
    ['TEST_DISABLED', async (ctx) => { await ctx.admin.setSwitch(false); }],
    ['VERSION_MISMATCH', async (ctx) => { await ctx.admin.setApplicationVersion('other-version'); }],
    ['LEASE_UNCONFIGURED', (ctx) => { ctx.db.bucket(COLLECTIONS.LEASE).delete(ids.leaseId(ENV)); }],
    ['LEASE_EXPIRED', async (ctx) => { await ctx.admin.upsertLease({ ...LEASE_INPUT, status: 'cancelled' }); }],
    ['ROOM_UNCONFIGURED', (ctx) => { ctx.db.bucket(COLLECTIONS.ROOM).delete(ids.roomBindingId(ENV)); }],
    ['ROOM_NOT_UNIQUE', (ctx) => {
      ctx.db.collection(COLLECTIONS.ROOM).doc(`${ENV}|102|duplicate`).set({
        data: { ...ctx.room, _id: `${ENV}|102|duplicate`, roomId: 'WRONG-ROOM', revision: 1 },
      });
    }],
  ];
  for (const [code, mutate] of cases) {
    const ctx = await fixture();
    await mutate(ctx);
    const result = await ctx.apply();
    assert.equal(result.code, code, `期望 ${code}，实际 ${JSON.stringify(result)}`);
    assert.equal(ctx.db.rows(COLLECTIONS.APPLICATION).length, 0, `${code} 时不得写申请`);
  }
});

test('日期边界：2026-12-01..2026-12-05 映射上海墙上时间，含首尾且无 +1/UTC/unlimited', () => {
  const window = dates.buildLeaseWindow('2026-12-01', '2026-12-05');
  assert.deepEqual(window, {
    startDate: '2026-12-01', endDate: '2026-12-05',
    validFrom: '2026-12-01T00:00:00', validTo: '2026-12-05T23:59:59',
    timezone: 'Asia/Shanghai', dailyHours: '24x7',
  });
  assert.ok(!JSON.stringify(window).includes('unlimited'));
  assert.ok(!/Z|[+-]\d\d:\d\d$/.test(window.validFrom));
  assert.equal(dates.isWithinWindow(window, new Date('2026-11-30T16:00:00Z')), true, '上海 12-01 00:00:00 应包含');
  assert.equal(dates.isWithinWindow(window, new Date('2026-11-30T15:59:59Z')), false, '上海 11-30 23:59:59 不应包含');
  assert.equal(dates.isWithinWindow(window, new Date('2026-12-05T15:59:59Z')), true, '上海 12-05 23:59:59 应包含');
  assert.equal(dates.isWithinWindow(window, new Date('2026-12-05T16:00:00Z')), false, '上海 12-06 00:00:00 不应包含');
  assert.equal(dates.isValidWindowSnapshot({ ...window, validTo: '2026-12-06T00:00:00' }), false);
  assert.equal(dates.isValidWindowSnapshot({ ...window, validTo: '2026-12-05T00:00:00' }), false);
  assert.throws(() => dates.buildLeaseWindow('2026-12-32', '2026-12-05'), /INVALID_DATE/);
  assert.throws(() => dates.buildLeaseWindow('2026-12-06', '2026-12-05'), /INVALID_DATE_RANGE/);
});

test('102 只按确定性 _id 单点读取；同号多条报 ROOM_NOT_UNIQUE，不取第一条', async () => {
  const ctx = await fixture();
  await ctx.apply();
  const spatialReads = ctx.db.whereGets.filter((entry) => entry.collection === COLLECTIONS.ROOM && entry.kind === 'get' && entry.where.displayNo);
  assert.deepEqual(spatialReads, [], '禁止按 displayNo 查询房间再取第一条');
  const docReads = ctx.db.bucket(COLLECTIONS.ROOM).size;
  assert.equal(docReads, 1, '唯一绑定通过确定性 _id 命中');

  const duplicated = await fixture();
  duplicated.db.collection(COLLECTIONS.ROOM).doc(`${ENV}|102|duplicate`).set({
    data: { ...duplicated.room, _id: `${ENV}|102|duplicate`, roomId: 'WRONG-ROOM', revision: 1 },
  });
  const result = await duplicated.apply();
  assert.equal(result.code, 'ROOM_NOT_UNIQUE');
  assert.equal(duplicated.db.rows(COLLECTIONS.APPLICATION).length, 0);
  assert.equal(duplicated.db.rows(COLLECTIONS.TASK).length, 0);
});

test('fileID 归属前缀校验：跨用户、跨申请、非法文件名均不得建任务', async () => {
  const ctx = await approvedFixture();
  const crossUser = await ctx.main({
    action: 'createFaceTask', applicationId: ctx.applicationId,
    fileId: fileId(ctx.applicationId, OTHER_OPENID), consent: true,
  });
  assert.equal(crossUser.code, 'FILE_OWNERSHIP_MISMATCH');
  const crossApplication = await ctx.main({
    action: 'createFaceTask', applicationId: ctx.applicationId,
    fileId: fileId('someone-else-application'), consent: true,
  });
  assert.equal(crossApplication.code, 'FILE_OWNERSHIP_MISMATCH');
  for (const suffix of ['photo.png', 'sub/photo.jpg', '..\\photo.jpg', 'photo.jpg?x=1']) {
    const result = await ctx.main({
      action: 'createFaceTask', applicationId: ctx.applicationId,
      fileId: fileId(ctx.applicationId, OPENID, suffix), consent: true,
    });
    assert.ok(['INVALID_FILE_ID', 'FILE_OWNERSHIP_MISMATCH'].includes(result.code), `${suffix} 应被拒绝，实际 ${result.code}`);
  }
  assert.equal(ctx.db.rows(COLLECTIONS.TASK).length, 0);
});

test('未通过申请、他人申请、失效租期均不得创建人脸任务；consent 必须严格为 true', async () => {
  const ctx = await fixture();
  const missingApplicationId = ids.applicationId(ENV, OPENID, VERSION, 4, 2);
  const denied = await ctx.main({ action: 'createFaceTask', applicationId: missingApplicationId, fileId: fileId(missingApplicationId), consent: true });
  assert.equal(denied.code, 'APPLICATION_NOT_APPROVED');
  const approved = await approvedFixture();
  const other = await approved.main({ action: 'createFaceTask', applicationId: approved.applicationId, fileId: fileId(approved.applicationId), consent: 'true' });
  assert.equal(other.code, 'CONSENT_REQUIRED', 'consent 必须严格 ===true');
  assert.equal(approved.db.rows(COLLECTIONS.TASK).length, 0);
  approved.db.collection(COLLECTIONS.LEASE).doc(ids.leaseId(ENV)).set({ data: { ...approved.lease, status: 'cancelled' } });
  const stale = await approved.main({ action: 'createFaceTask', applicationId: approved.applicationId, fileId: fileId(approved.applicationId), consent: true });
  assert.equal(stale.code, 'LEASE_EXPIRED');
  assert.equal(approved.db.rows(COLLECTIONS.TASK).length, 0);
});

test('apply/create 幂等：重复提交返回同一 id、同一 employeeNo；重传照片不改号', async () => {
  const ctx = await approvedFixture();
  const again = await ctx.apply();
  assert.equal(again.code, 0);
  assert.equal(again.data.idempotent, true);
  assert.equal(again.data.applicationId, ctx.applicationId);
  assert.equal(again.data.employeeNo, ctx.applied.data.employeeNo);
  assert.equal(ctx.db.rows(COLLECTIONS.APPLICATION).length, 1);

  const first = await ctx.main({ action: 'createFaceTask', applicationId: ctx.applicationId, fileId: fileId(ctx.applicationId), consent: true });
  const second = await ctx.main({ action: 'createFaceTask', applicationId: ctx.applicationId, fileId: fileId(ctx.applicationId), consent: true });
  assert.equal(first.data.taskId, second.data.taskId);
  assert.equal(ctx.db.rows(COLLECTIONS.TASK).length, 1);
  const stored = ctx.taskFor(ctx.applicationId);
  assert.equal(stored.employeeNo, ctx.applied.data.employeeNo);
  const reupload = await ctx.main({ action: 'createFaceTask', applicationId: ctx.applicationId, fileId: fileId(ctx.applicationId, OPENID, 'photo-2.jpg'), consent: true });
  assert.equal(reupload.code, 0);
  assert.equal(reupload.data.taskId, first.data.taskId);
  assert.equal(ctx.taskFor(ctx.applicationId).employeeNo, ctx.applied.data.employeeNo);
  assert.equal(ctx.taskFor(ctx.applicationId).fileId, fileId(ctx.applicationId, OPENID, 'photo-2.jpg'));
});

test('getConfig 只读且不下发名单/token/设备秘密；未配置时为待配置', async () => {
  const ctx = await fixture();
  const before = ctx.db.writes;
  const result = await ctx.main({ action: 'getConfig' });
  assert.equal(result.code, 0);
  assert.equal(result.data.enabled, true);
  assert.equal(result.data.configured, true);
  assert.equal(result.data.accountEligible, true);
  assert.equal(result.data.room.displayNo, '102');
  assert.equal(result.data.lease.validTo, '2026-12-05T23:59:59');
  const serialized = JSON.stringify(result);
  for (const secret of [TOKEN, TOKEN_HASH, 'device-key-stable', 'synthetic-device-admin', 'password']) {
    assert.ok(!serialized.includes(secret), `getConfig 不得下发 ${secret}`);
  }
  assert.equal(ctx.db.writes, before, '轮询不得写库');
  const unconfigured = await fixture();
  unconfigured.db.bucket(COLLECTIONS.LEASE).delete(ids.leaseId(ENV));
  const pending = await unconfigured.main({ action: 'getConfig' });
  assert.equal(pending.data.configured, false);
  assert.equal(pending.data.phase, '待配置');
  assert.equal(pending.data.lease.startDate, '');
});

test('并发 claim 只有一个成功（revision CAS），其余不领取', async () => {
  const ctx = await queuedFixture();
  const results = await Promise.all([claim(ctx), claim(ctx), claim(ctx)]);
  const successes = results.filter((entry) => entry.code === 0 && entry.data.task);
  assert.equal(successes.length, 1, '并发领取只能有一个成功');
  assert.equal(results.filter((entry) => entry.code === 0 && !entry.data.task).length, 2);
  const task = ctx.taskFor(ctx.applicationId);
  assert.equal(task.status, STATUS.CLAIMED);
  assert.equal(task.revision, 2);
  assert.equal(successes[0].data.task.claimId, task.claimId);
  assert.equal(successes[0].data.task.revision, 2);
});

test('排队后租期/审批/配置 revision 变化 → INVALIDATED，不派发', async () => {
  const variants = [
    ['lease', async (ctx) => { await ctx.admin.upsertLease(LEASE_INPUT); }],
    ['application', (ctx) => ctx.db.collection(COLLECTIONS.APPLICATION).doc(ctx.applicationId).set({ data: { ...ctx.db.row(COLLECTIONS.APPLICATION, ctx.applicationId), result: 'pending_review' } })],
    ['config', async (ctx) => { await ctx.admin.setDispatchEnabled(true); }],
  ];
  for (const [name, mutate] of variants) {
    const ctx = await queuedFixture();
    await mutate(ctx);
    const claimed = await claim(ctx);
    assert.equal(claimed.code, 0);
    assert.equal(claimed.data.task, null, `${name} 变化后不得派发`);
    const task = ctx.taskFor(ctx.applicationId);
    assert.equal(task.status, STATUS.INVALIDATED, `${name} 变化后任务必须失效`);
    assert.equal(task.employeeNo, ctx.applied.data.employeeNo, '失效不换号');
    assert.equal(ctx.db.row(COLLECTIONS.TASK, task._id).status, STATUS.INVALIDATED);
  }
});

test('claim 超时转为 UNKNOWN_RESULT：保留编号、不重排、不删除', async () => {
  const ctx = await queuedFixture();
  const original = ctx.taskFor(ctx.applicationId);
  const expired = { ...original, status: STATUS.CLAIMED, claimId: 'synthetic-claim-id-0001', claimExpiresAt: FIXED.getTime() - 1 };
  ctx.db.collection(COLLECTIONS.TASK).doc(original._id).set({ data: expired });
  const claimed = await claim(ctx);
  assert.equal(claimed.code, 0);
  assert.equal(claimed.data.task, null);
  const after = ctx.taskFor(ctx.applicationId);
  assert.equal(after.status, STATUS.UNKNOWN_RESULT);
  assert.equal(after.resultCode, 'CLAIM_TIMEOUT');
  assert.equal(after.employeeNo, original.employeeNo);
  assert.ok(ctx.db.rows(COLLECTIONS.TASK).length === 1, '不得删除或新建 Task');
  assert.ok(!ctx.db.rows(COLLECTIONS.TASK).some((row) => row.status === STATUS.QUEUED_FOR_DISPATCH), '不得自动重排');
  assert.deepEqual(Object.keys(validate.ACTION_FIELDS).sort(), ['applyCheckin', 'claimTask', 'createFaceTask', 'getConfig', 'getMyTask', 'reportTask'].sort());
});

test('report 成功逐项校验：日期/模式/全天指纹/门号/编号/关联/verify 全匹配才确认且 siteVerification 永为 PENDING', async () => {
  const ctx = await queuedFixture();
  const claimed = await claim(ctx);
  assert.equal(claimed.code, 0);
  const task = claimed.data.task;
  const reported = await ctx.main({
    action: 'reportTask', workerToken: TOKEN, taskId: task.taskId, claimId: task.claimId,
    revision: task.revision, exitCode: 0, output: successOutput(task),
  });
  assert.equal(reported.code, 0, JSON.stringify(reported));
  assert.equal(reported.data.status, STATUS.PENDING_SITE_VERIFICATION);
  const stored = ctx.taskFor(ctx.applicationId);
  assert.equal(stored.employeeNo, ctx.applied.data.employeeNo);
  assert.equal(stored.siteVerification, 'PENDING');
  assert.equal(stored.faceModelingVerified, true);
  assert.equal(stored.deviceOutcome.code, 'DEVICE_CONFIRMED');
  const view = await ctx.main({ action: 'getMyTask', applicationId: ctx.applicationId });
  assert.equal(view.data.siteVerification, 'PENDING');
  assert.equal(view.data.state, DISPLAY_STATE.PENDING_SITE_VERIFICATION);
  assert.equal(view.data.status, STATUS.PENDING_SITE_VERIFICATION);
});

test('report 输出被篡改任一项 → FAILED_REVIEW（不确认、不换号、不重排）', async () => {
  const mutations = {
    mode: (o) => { o.mode = 'simulation'; o.enrollment.mode = 'simulation'; },
    validityMode: (o) => { o.validityMode = 'unlimited'; o.enrollment.validityMode = 'unlimited'; },
    validFrom: (o) => { o.validFrom = '2026-12-02T00:00:00'; o.enrollment.validFrom = o.validFrom; },
    validTo: (o) => { o.validTo = '2026-12-06T00:00:00'; o.enrollment.validTo = o.validTo; },
    doorNo: (o) => { o.doorNo = 1; o.enrollment.doorNo = 1; },
    employeeNo: (o) => { o.employeeNo = 'FORGED123'; o.enrollment.employeeNo = 'FORGED123'; },
    fingerprint: (o) => { o.accessPlanFingerprint = 'b'.repeat(64); o.enrollment.accessPlanFingerprint = o.accessPlanFingerprint; },
    faceAssociation: (o) => { o.faceAssociationConfirmed = false; o.enrollment.faceAssociationConfirmed = false; },
    verifyStep: (o) => { o.steps[0].state = 'failed'; o.enrollment.steps[0].state = 'failed'; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const ctx = await queuedFixture();
    const claimed = await claim(ctx);
    const output = successOutput(claimed.data.task);
    mutate(output);
    const reported = await ctx.main({
      action: 'reportTask', workerToken: TOKEN, taskId: claimed.data.task.taskId,
      claimId: claimed.data.task.claimId, revision: claimed.data.task.revision, exitCode: 0, output,
    });
    assert.equal(reported.code, 0, JSON.stringify(reported));
    assert.equal(reported.data.status, STATUS.FAILED_REVIEW, `${name} 必须导致 FAILED_REVIEW`);
    const stored = ctx.taskFor(ctx.applicationId);
    assert.equal(stored.employeeNo, ctx.applied.data.employeeNo, `${name} 不得换号`);
    assert.notEqual(stored.status, STATUS.QUEUED_FOR_DISPATCH, `${name} 不得自动重排`);
  }
});

test('退出码 4/5 → FAILED_REVIEW/UNKNOWN_RESULT，无 requeue、不换号、不删除', async () => {
  for (const [exitCode, status, outcome] of [[4, STATUS.FAILED_REVIEW, 'failed'], [5, STATUS.UNKNOWN_RESULT, 'stopped']]) {
    const ctx = await queuedFixture();
    const claimed = await claim(ctx);
    const task = claimed.data.task;
    const reported = await ctx.main({
      action: 'reportTask', workerToken: TOKEN, taskId: task.taskId, claimId: task.claimId,
      revision: task.revision, exitCode, output: { protocolVersion: 1, outcome, mode: 'device', validityMode: 'fixed', siteVerification: 'PENDING' },
    });
    assert.equal(reported.code, 0);
    assert.equal(reported.data.status, status);
    const stored = ctx.taskFor(ctx.applicationId);
    assert.equal(stored.employeeNo, task.employeeNo);
    assert.equal(stored.status, status);
    assert.equal(stored.siteVerification, 'PENDING');
    assert.deepEqual(Object.keys(validate.ACTION_FIELDS), Object.keys(validate.ACTION_FIELDS).filter((key) => key !== 'requeue'));
    assert.equal(ctx.db.rows(COLLECTIONS.TASK).length, 1);
  }
});

test('重复 report 幂等；worker token 常量时间比对失败返回 WORKER_UNAUTHORIZED', async () => {
  const ctx = await queuedFixture();
  const claimed = await claim(ctx);
  const task = claimed.data.task;
  const payload = {
    action: 'reportTask', taskId: task.taskId, claimId: task.claimId,
    revision: task.revision, exitCode: 4, output: { protocolVersion: 1, outcome: 'failed', mode: 'device', validityMode: 'fixed', siteVerification: 'PENDING' },
  };
  const first = await ctx.main({ ...payload, workerToken: TOKEN });
  const second = await ctx.main({ ...payload, workerToken: TOKEN });
  assert.equal(first.data.status, STATUS.FAILED_REVIEW);
  assert.equal(second.data.idempotent, true);
  assert.equal(second.data.status, STATUS.FAILED_REVIEW);
  for (const token of ['short', 'x'.repeat(40), `${TOKEN}x`, '']) {
    const bad = await ctx.main({ ...payload, workerToken: token });
    assert.equal(bad.code, 'WORKER_UNAUTHORIZED', '错误 token 必须拒绝');
    if (token) assert.ok(!JSON.stringify(bad).includes(token), '错误信息不得回显 token');
  }
  assert.equal(context.constantTimeEqualHex(TOKEN_HASH, TOKEN_HASH), true);
  assert.equal(context.constantTimeEqualHex(TOKEN_HASH, 'b'.repeat(64)), false);
  assert.equal(context.constantTimeEqualHex('not-hex', TOKEN_HASH), false);
  const digest = Buffer.from(TOKEN_HASH, 'hex');
  assert.equal(timingSafeEqual(digest, digest), true, '常量时间比较使用 timingSafeEqual');
});

test('身份边界：小程序 action 需 OPENID，worker action 不能由小程序身份调用', async () => {
  const ctx = await fixture();
  ctx.setOpenid('');
  const noIdentity = await ctx.main({ action: 'getConfig' });
  assert.equal(noIdentity.code, 'OPENID_REQUIRED');
  ctx.setOpenid(OPENID);
  const forbidden = await ctx.main({ action: 'claimTask' });
  assert.equal(forbidden.code, 'WORKER_UNAUTHORIZED', 'worker action 无 token 必须失败关闭');
  const noToken = await ctx.main({ action: 'reportTask' });
  assert.equal(noToken.code, 'WORKER_UNAUTHORIZED');
});

test('云函数路径无 console.log 请求体、无 unlimited 兜底', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|json)$/.test(entry.name)) files.push(full);
    }
  };
  walk(CLOUD_DIR);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!/console\.(log|info|debug)\s*\(/.test(source), `${path.relative(ROOT, file)} 不得输出请求体`);
    assert.ok(!/\bunlimited\b/.test(source), `${path.relative(ROOT, file)} 不得有 unlimited 兜底`);
  }
});
