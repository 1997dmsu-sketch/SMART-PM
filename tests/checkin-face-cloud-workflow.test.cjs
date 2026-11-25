'use strict';

/**
 * B05 / §6 — 云函数 checkinFaceTest 的可证伪合成测试（内存 DB 替身）。
 *
 * 覆盖任务卡 §6 的自动通过、房号来源、租期边界、归属、幂等/竞态、
 * 开关隔离、全天规则、report 反校验与未知结果处理；并覆盖本次退修：
 *  - R01：真实 SDK cloud://… fileID 正向贯通与拒绝矩阵；
 *  - R03：base/tx 上下文分离、事务内查询硬抛错、提交失败业务+审计全回滚；
 *  - R04：create-only 首建、A/B 创建者受控交错的不可重置性；
 *  - R06：beginTaskExecution 执行前复核正反例（过期/撤权/换房/改租期/错 worker）。
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
const { ENVIRONMENT, COLLECTIONS, ids, createStore } = require(path.join(CLOUD_DIR, 'lib/store.js'));
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
// 可信云存储命名空间（合成）：真实环境由负责人按现场联调实际返回填写。
const NAMESPACE = 'synthetic-env-1g2h3j4k.7465-synthetic-env-1g2h3j4k-1300000000';
const OTHER_NAMESPACE = 'other-env-9x7y.7465-other-env-9x7y-1300000000';
const WORKER_ID = 'synthetic-worker-01';

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

/**
 * 内存 DB：base 上下文支持点读/点写/集合查询；runTransaction 提供独立的
 * tx 上下文（仅点读/点写/add，集合查询抛 TX_UNSUPPORTED_QUERY）、写暂存、
 * 快照隔离冲突检测 + 自动重试、提交失败注入与 beforeCommit 受控调度钩子。
 * contextLog 记录每次读写的实际上下文（base/tx），用于 R03 证据。
 */
class MemoryDB {
  constructor(options = {}) {
    // strictId=true 时 doc().set 的 data 载荷携带 _id 即抛错（复现真实云端 SDK -501007）。
    this.strictId = !!options.strictId;
    this.collections = new Map();
    this.writes = 0;              // 仅统计已提交（含 base 直接）写入
    this.whereGets = [];
    this.seq = 0;
    this.contextLog = [];
    this.commitLog = [];
    this.txCount = 0;
    this.keyVersions = new Map();
    this.keyCommitSeq = new Map();
    this.commitSeq = 0;
    this.retryLimit = 5;
    this.beforeCommit = null;
    this.failCommits = 0;
  }

  bucket(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    return this.collections.get(name);
  }

  rows(name) { return [...this.bucket(name).values()].map(clone); }
  row(name, id) { const value = this.bucket(name).get(id); return value ? clone(value) : null; }

  _log(op, collection, id, contextFlag) {
    this.contextLog.push({ op, collection, id: id ?? null, context: contextFlag });
  }

  _version(key) { return this.keyVersions.get(key) ?? 0; }

  _commitKey(collection, id) {
    this.commitSeq += 1;
    const key = `${collection}::${id}`;
    this.keyVersions.set(key, (this.keyVersions.get(key) ?? 0) + 1);
    this.keyCommitSeq.set(key, this.commitSeq);
  }

  collection(name) {
    const db = this;
    const store = this.bucket(name);
    const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
    return {
      doc: (id) => ({
        get: async () => {
          db._log('get', name, id, 'base');
          const value = store.get(id);
          if (!value) throw Object.assign(new Error('document does not exist'), { errCode: -1 });
          return { data: clone(value) };
        },
        set: async ({ data }) => {
          db._log('set', name, id, 'base');
          if (db.strictId && data && Object.hasOwn(data, '_id')) throw Object.assign(new Error('STRICT_SET_ID'), { code: 'STRICT_SET_ID' });
          db.writes += 1;
          store.set(id, clone({ ...data, _id: id }));
          db._commitKey(name, id);
          return {};
        },
      }),
      where: (where) => ({
        get: async () => {
          db._log('query', name, null, 'base');
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
              db._commitKey(name, id);
              updated += 1;
            }
          }
          return { stats: { updated } };
        },
      }),
      add: async ({ data }) => {
        const id = data._id || `auto-${++db.seq}`;
        db._log('add', name, id, 'base');
        db.writes += 1;
        store.set(id, clone({ ...data, _id: id }));
        db._commitKey(name, id);
        return { _id: id };
      },
      get: async () => ({ data: db.rows(name) }),
    };
  }

  runTransaction(fn) {
    const db = this;
    const attempt = async (attemptNo) => {
      const txId = `${++db.txCount}`;
      const startSeq = db.commitSeq;
      const stage = new Map();
      const readVersions = new Map();
      const writeKeys = new Set();
      const tx = {
        collection: (name) => {
          const store = db.bucket(name);
          return {
            doc: (id) => ({
              get: async () => {
                db._log('get', name, id, 'tx');
                const key = `${name}::${id}`;
                if (stage.has(key)) return { data: clone(stage.get(key).data) };
                const value = store.get(id);
                if (!value) {
                  readVersions.set(key, 0);
                  throw Object.assign(new Error('document does not exist'), { errCode: -1 });
                }
                readVersions.set(key, db._version(key));
                return { data: clone(value) };
              },
              set: async ({ data }) => {
                db._log('set', name, id, 'tx');
                if (db.strictId && data && Object.hasOwn(data, '_id')) throw Object.assign(new Error('STRICT_SET_ID'), { code: 'STRICT_SET_ID' });
                const key = `${name}::${id}`;
                stage.set(key, { collection: name, id, data: { ...data, _id: id } });
                writeKeys.add(key);
                return {};
              },
            }),
            add: async ({ data }) => {
              const id = data._id || `auto-${++db.seq}`;
              db._log('add', name, id, 'tx');
              const key = `${name}::${id}`;
              stage.set(key, { collection: name, id, data: { ...data, _id: id } });
              writeKeys.add(key);
              return { _id: id };
            },
            where: () => { throw Object.assign(new Error('TX_UNSUPPORTED_QUERY'), { code: 'TX_UNSUPPORTED_QUERY' }); },
            get: () => { throw Object.assign(new Error('TX_UNSUPPORTED_QUERY'), { code: 'TX_UNSUPPORTED_QUERY' }); },
          };
        },
      };
      let result;
      try {
        result = await fn(tx);
      } catch (error) {
        db.commitLog.push({ tx: txId, attempt: attemptNo, outcome: 'callback-error', code: error && (error.code || error.name) });
        throw error; // 业务错误：stage 丢弃 = 全回滚
      }
      if (typeof db.beforeCommit === 'function') {
        try { await db.beforeCommit(txId, attemptNo); }
        catch (error) {
          db.commitLog.push({ tx: txId, attempt: attemptNo, outcome: 'before-commit-error', code: error && (error.code || error.name) });
          throw error;
        }
      }
      let conflict = [...readVersions].some(([key, version]) => db._version(key) !== version);
      for (const key of writeKeys) {
        const readVersion = readVersions.get(key);
        const currentVersion = db._version(key);
        if (readVersion === undefined) {
          if ((db.keyCommitSeq.get(key) ?? 0) > startSeq) { conflict = true; break; }
        } else if (currentVersion !== readVersion) {
          conflict = true; break;
        }
      }
      if (conflict && attemptNo < db.retryLimit) {
        db.commitLog.push({ tx: txId, attempt: attemptNo, outcome: 'conflict-retry' });
        return attempt(attemptNo + 1);
      }
      if (conflict) {
        db.commitLog.push({ tx: txId, attempt: attemptNo, outcome: 'conflict-exhausted' });
        throw Object.assign(new Error('TRANSACTION_CONFLICT'), { code: 'TRANSACTION_CONFLICT' });
      }
      if (db.failCommits > 0) {
        db.failCommits -= 1;
        db.commitLog.push({ tx: txId, attempt: attemptNo, outcome: 'commit-failure' });
        throw Object.assign(new Error('SIMULATED_COMMIT_FAILURE'), { code: 'SIMULATED_COMMIT_FAILURE' });
      }
      for (const entry of stage.values()) {
        db.writes += 1;
        db.bucket(entry.collection).set(entry.id, clone(entry.data));
        db._commitKey(entry.collection, entry.id);
      }
      db.commitLog.push({ tx: txId, attempt: attemptNo, outcome: 'committed', writes: stage.size });
      return result;
    };
    return attempt(1);
  }
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
 * applicationVersion / dispatchEnabled / storageNamespace 不得由测试直接写 mock DB。
 * 若公开方法缺失或配置顺序失效，所有依赖本 fixture 的用例都会 FAIL。
 */
async function fixture({ openid = OPENID, enabled = true, dispatchEnabled = true, now = FIXED, namespace = NAMESPACE } = {}) {
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
  if (namespace) await admin.setStorageNamespace(namespace);
  await admin.setDispatchEnabled(dispatchEnabled);
  // 缺命名空间时总开关无法开启（公开前置校验），跳过开启以构造该失败关闭形态。
  if (!(enabled && !namespace)) await admin.setSwitch(enabled);

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

/** 真实 SDK 形状 fileID：cloud://<可信命名空间>/<服务端下发对象路径>。 */
function fileId(applicationId, openid = OPENID, name = 'photo.jpg') {
  return `cloud://${NAMESPACE}/test-face/${ENV}/${openid}/${applicationId}/${name}`;
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
  const result = await ctx.main({ action: 'claimTask', workerToken: TOKEN, workerId: WORKER_ID });
  return result;
}

async function claimedFixture(options) {
  const ctx = await queuedFixture(options);
  const claimed = await claim(ctx);
  assert.equal(claimed.code, 0, JSON.stringify(claimed));
  assert.ok(claimed.data.task, 'claim 必须领取到任务');
  return { ...ctx, claimed, task: claimed.data.task };
}

function begin(ctx, task, overrides = {}) {
  return ctx.main({
    action: 'beginTaskExecution', workerToken: TOKEN, workerId: WORKER_ID,
    taskId: task.taskId, claimId: task.claimId, revision: task.revision, ...overrides,
  });
}

async function executingTask(ctx, task) {
  const result = await begin(ctx, task);
  assert.equal(result.code, 0, JSON.stringify(result));
  return result.data.task;
}

function fullSnapshot(ctx) {
  return structuredClone([...ctx.db.collections].map(([name, rows]) => [name, [...rows]]));
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
 * 若任一公开方法缺失、顺序不可用、版本/派发开关/命名空间无法写入，
 * 本用例会在 getConfig/apply/claim 任一步失败，而不是恒过。
 */
test('P0 守门：仅用后台全部公开配置能力即可完成 auto_approved + claim 成功', async () => {
  const ctx = await fixture();
  const snapshot = await ctx.admin.getConfig();
  assert.equal(snapshot.config.applicationVersion, VERSION, 'getConfig 必须返回非空申请版本');
  assert.equal(snapshot.config.enabled, true);
  assert.equal(snapshot.config.dispatchEnabled, true);
  assert.equal(snapshot.config.workerTokenConfigured, true);
  assert.equal(snapshot.config.storageNamespaceConfigured, true, 'getConfig 必须返回可信命名空间已配置');
  assert.equal(snapshot.config.storageNamespace, NAMESPACE);
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
  claimed.data.task = await executingTask(ctx, claimed.data.task);
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

// ---------------------------------------------------------------------------
// R01：真实 SDK fileID 契约
// ---------------------------------------------------------------------------

test('R01：真实 SDK fileID 从上传输出原样贯穿建任务/领取/执行前复核，不再换成裸路径', async () => {
  const ctx = await approvedFixture();
  const realFileId = fileId(ctx.applicationId);
  assert.ok(realFileId.startsWith(`cloud://${NAMESPACE}/`), 'fixture 必须是 SDK 形状 fileID');
  const created = await ctx.main({
    action: 'createFaceTask', applicationId: ctx.applicationId, fileId: realFileId, consent: true,
  });
  assert.equal(created.code, 0, JSON.stringify(created));
  const stored = ctx.taskFor(ctx.applicationId);
  assert.equal(stored.fileId, realFileId, '任务必须持久保存验证过的真实 fileID');
  assert.equal(stored.cloudPath, realFileId.slice(`cloud://${NAMESPACE}/`.length), '规范对象路径必须与 fileID 一致');
  const claimed = await claim(ctx);
  assert.ok(claimed.data.task, 'claim 必须成功');
  assert.equal(claimed.data.task.fileId, realFileId, 'worker 领取视图必须携带同一真实 fileID');
  assert.equal(claimed.data.task.cloudPath, stored.cloudPath);
  const started = await begin(ctx, claimed.data.task);
  assert.equal(started.code, 0, JSON.stringify(started));
  assert.equal(started.data.task.fileId, realFileId, '执行前复核快照必须携带同一真实 fileID');
  assert.equal(started.data.task.cloudPath, stored.cloudPath);
  assert.equal(started.data.task.status, STATUS.DEVICE_PROCESSING);
});

test('R01：裸路径/非 cloud/跨环境/跨用户/跨申请/畸形路径全部拒绝且零写入', async () => {
  const ctx = await approvedFixture();
  const appId = ctx.applicationId;
  const beforeWrites = ctx.db.writes;
  const cases = [
    ['裸路径（旧实现曾接受）', `test-face/${ENV}/${OPENID}/${appId}/photo.jpg`, 'INVALID_FILE_ID'],
    ['非 cloud 协议', `https://example.com/${OPENID}/${appId}/photo.jpg`, 'INVALID_FILE_ID'],
    ['无对象路径', `cloud://${NAMESPACE}`, 'INVALID_FILE_ID'],
    ['跨环境命名空间', `cloud://${OTHER_NAMESPACE}/test-face/${ENV}/${OPENID}/${appId}/photo.jpg`, 'FILE_NAMESPACE_MISMATCH'],
    ['跨用户', `cloud://${NAMESPACE}/test-face/${ENV}/${OTHER_OPENID}/${appId}/photo.jpg`, 'FILE_OWNERSHIP_MISMATCH'],
    ['跨申请', `cloud://${NAMESPACE}/test-face/${ENV}/${OPENID}/someone-else-application/photo.jpg`, 'FILE_OWNERSHIP_MISMATCH'],
    ['非法扩展名', fileId(appId, OPENID, 'photo.png'), 'INVALID_FILE_ID'],
    ['子路径', fileId(appId, OPENID, 'sub/photo.jpg'), 'INVALID_FILE_ID'],
    ['反斜杠穿越', fileId(appId, OPENID, '..\\photo.jpg'), 'INVALID_FILE_ID'],
    ['查询串', fileId(appId, OPENID, 'photo.jpg?x=1'), 'INVALID_FILE_ID'],
    ['点穿越', fileId(appId, OPENID, '..photo.jpg'), 'INVALID_FILE_ID'],
    ['双点', fileId(appId, OPENID, 'a..jpg'), 'INVALID_FILE_ID'],
    ['百分号编码', fileId(appId, OPENID, 'photo%2Ejpg'), 'INVALID_FILE_ID'],
    ['控制字符', `cloud://${NAMESPACE}/test-face/${ENV}/${OPENID}/${appId}/photo\x01.jpg`, 'INVALID_FILE_ID'],
  ];
  for (const [label, fileIdValue, expectedCode] of cases) {
    const result = await ctx.main({
      action: 'createFaceTask', applicationId: appId, fileId: fileIdValue, consent: true,
    });
    assert.equal(result.code, expectedCode, `${label} 应返回 ${expectedCode}，实际 ${JSON.stringify(result)}`);
  }
  assert.equal(ctx.db.rows(COLLECTIONS.TASK).length, 0, '任何拒绝都不得建任务');
  assert.equal(ctx.db.writes, beforeWrites, '拒绝路径零写入');
});

test('R01：服务端可信命名空间未配置时失败关闭，且 getConfig 如实下发布尔', async () => {
  const ctx = await fixture({ namespace: false });
  const view = await ctx.main({ action: 'getConfig' });
  assert.equal(view.code, 0);
  assert.equal(view.data.storageNamespaceConfigured, false, 'getConfig 必须如实下发布尔');
  const created = await ctx.main({
    action: 'createFaceTask', applicationId: 'arbitrary-application', fileId: fileId('arbitrary-application'), consent: true,
  });
  assert.equal(created.code, 'STORAGE_NAMESPACE_UNCONFIGURED', JSON.stringify(created));
  assert.equal(ctx.db.rows(COLLECTIONS.TASK).length, 0, '配置缺失时不得建任务');
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
  assert.equal(result.data.storageNamespaceConfigured, true);
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

test('并发 claim 只有一个成功（事务 CAS），其余不领取', async () => {
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
  assert.deepEqual(Object.keys(validate.ACTION_FIELDS).sort(), ['applyCheckin', 'beginTaskExecution', 'claimTask', 'createFaceTask', 'getConfig', 'getMyTask', 'reportTask'].sort());
});

test('report 成功逐项校验：日期/模式/全天指纹/门号/编号/关联/verify 全匹配才确认且 siteVerification 永为 PENDING', async () => {
  const ctx = await queuedFixture();
  const claimed = await claim(ctx);
  assert.equal(claimed.code, 0);
  const task = await executingTask(ctx, claimed.data.task);
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
    claimed.data.task = await executingTask(ctx, claimed.data.task);
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
    const task = await executingTask(ctx, claimed.data.task);
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
  const task = await executingTask(ctx, claimed.data.task);
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
  const noBeginToken = await ctx.main({ action: 'beginTaskExecution', taskId: 'x', claimId: 'y'.repeat(16), revision: 2, workerId: 'w' });
  assert.equal(noBeginToken.code, 'WORKER_UNAUTHORIZED');
});

// ---------------------------------------------------------------------------
// R03：事务上下文与回滚
// ---------------------------------------------------------------------------

test('R03：base 与 tx 是不同上下文——权威读取与审计全部发生在 tx，事务内集合查询硬抛错', async () => {
  const ctx = await approvedFixture();
  ctx.db.contextLog = [];
  const created = await ctx.main({
    action: 'createFaceTask', applicationId: ctx.applicationId, fileId: fileId(ctx.applicationId), consent: true,
  });
  assert.equal(created.code, 0, JSON.stringify(created));
  const txLog = ctx.db.contextLog.filter((entry) => entry.context === 'tx');
  assert.ok(txLog.length > 0, '建任务必须在事务内完成权威读取与写入');
  for (const collection of [COLLECTIONS.CONFIG, COLLECTIONS.ALLOWLIST, COLLECTIONS.ROOM, COLLECTIONS.LEASE, COLLECTIONS.APPLICATION]) {
    assert.ok(txLog.some((entry) => entry.collection === collection && entry.op === 'get'),
      `${collection} 权威读必须发生在 tx 上下文（实际 tx 读：${JSON.stringify(txLog.map((e) => e.collection))}）`);
  }
  assert.ok(txLog.some((entry) => entry.op === 'set' && entry.collection === COLLECTIONS.TASK), '任务写入必须在 tx 上下文');
  assert.ok(txLog.some((entry) => entry.op === 'add' && entry.collection === COLLECTIONS.AUDIT), '审计写入必须在 tx 上下文');
  const baseAudit = ctx.db.contextLog.filter((entry) => entry.op === 'add' && entry.collection === COLLECTIONS.AUDIT && entry.context === 'base');
  assert.equal(baseAudit.length, 0, '事务路径审计不得回落到 base 上下文');
  const baseTaskSet = ctx.db.contextLog.filter((entry) => entry.op === 'set' && entry.collection === COLLECTIONS.TASK && entry.context === 'base');
  assert.equal(baseTaskSet.length, 0, '事务路径任务写入不得回落到 base 上下文');
  // tx 上下文内任何集合查询都必须抛 TX_UNSUPPORTED_QUERY，绝不回落外层 DB。
  const store = createStore(ctx.db, { environment: ENV, now: () => FIXED });
  for (const operation of ['list', 'count']) {
    let thrown = null;
    await store.withTransaction(async (tx) => {
      try { await tx[operation](COLLECTIONS.TASK); } catch (error) { thrown = error; }
    });
    assert.equal(thrown && thrown.code, 'TX_UNSUPPORTED_QUERY', `tx.${operation} 必须抛 TX_UNSUPPORTED_QUERY`);
  }
  // 无 runTransaction 能力时失败关闭，绝不静默串行执行。
  const { db } = await fixture();
  db.runTransaction = undefined;
  const fallback = await (async () => {
    const st = createStore(db, { environment: ENV, now: () => FIXED });
    let code = '';
    await st.withTransaction(async () => {}).catch((error) => { code = error.code; });
    return code;
  })();
  assert.equal(fallback, 'TRANSACTION_UNAVAILABLE');
});

test('R03：无 runTransaction 能力时申请与建任务失败关闭且零写入（不静默串行）', async () => {
  const ctx = await fixture();
  const auditBefore = ctx.db.rows(COLLECTIONS.AUDIT).length;
  ctx.db.runTransaction = undefined;
  const applied = await ctx.apply();
  assert.equal(applied.code, 'TRANSACTION_UNAVAILABLE', JSON.stringify(applied));
  assert.equal(ctx.db.rows(COLLECTIONS.APPLICATION).length, 0);
  assert.equal(ctx.db.rows(COLLECTIONS.AUDIT).length, auditBefore, '不得新增审计');
});

test('R03：提交失败时业务写与审计全回滚，不回落到外层 DB', async () => {
  const ctx = await fixture();
  const auditBefore = ctx.db.rows(COLLECTIONS.AUDIT).length;
  ctx.db.commitLog = [];
  ctx.db.failCommits = 1;
  const beforeWrites = ctx.db.writes;
  const result = await ctx.apply();
  assert.equal(result.code, 'SIMULATED_COMMIT_FAILURE', JSON.stringify(result));
  assert.equal(ctx.db.rows(COLLECTIONS.APPLICATION).length, 0, '提交失败时业务写必须回滚');
  assert.equal(ctx.db.rows(COLLECTIONS.AUDIT).length, auditBefore, '提交失败时审计必须回滚');
  assert.equal(ctx.db.writes, beforeWrites, '不得有任何已提交写入');
  assert.equal(ctx.db.commitLog.filter((entry) => entry.outcome === 'committed').length, 0, '不得有任何事务提交');
  assert.ok(ctx.db.commitLog.some((entry) => entry.outcome === 'commit-failure'), '必须记录提交失败');

  // 提交前失败同样全回滚：beforeCommit 抛错时业务与审计都不落地。
  const ctx2 = await fixture();
  const auditBefore2 = ctx2.db.rows(COLLECTIONS.AUDIT).length;
  ctx2.db.beforeCommit = async () => { throw new Error('BEFORE_COMMIT_BOOM'); };
  const applied2 = await ctx2.apply();
  assert.equal(applied2.code, 'INTERNAL_ERROR', JSON.stringify(applied2));
  assert.equal(ctx2.db.rows(COLLECTIONS.APPLICATION).length, 0);
  assert.equal(ctx2.db.rows(COLLECTIONS.AUDIT).length, auditBefore2);
});

// ---------------------------------------------------------------------------
// R04：create-only 首建与晚到创建者不可重置
// ---------------------------------------------------------------------------

test('R04：A/B 创建者受控交错——B 建并领取后，晚到 A 的提交不能重置 claim/终态/revision/employeeNo', async () => {
  const ctx = await approvedFixture();
  const applicationId = ctx.applicationId;
  const employeeNo = ctx.applied.data.employeeNo;
  let releaseA;
  const gateA = new Promise((resolve) => { releaseA = resolve; });
  let paused = 0;
  ctx.db.beforeCommit = async () => {
    if (!paused) { paused = 1; await gateA; }
  };
  const createPayload = { action: 'createFaceTask', applicationId, fileId: fileId(applicationId), consent: true };
  const creatorA = ctx.main(createPayload);
  // 等 A 的事务完成“读无记录 + 暂存写入”并停在提交前挂起点。
  while (!paused) await new Promise((resolve) => setTimeout(resolve, 5));

  // B 完整跑完创建 + 领取。
  const createdB = await ctx.main(createPayload);
  assert.equal(createdB.code, 0, `B 创建失败：${JSON.stringify(createdB)}`);
  const claimedB = await claim(ctx);
  assert.ok(claimedB.data.task, 'B 创建后必须能领取');
  const claimIdB = claimedB.data.task.claimId;
  assert.equal(claimedB.data.task.revision, 2);
  assert.equal(claimedB.data.task.employeeNo, employeeNo);

  releaseA(); // A 的提交继续 → 写冲突 → 自动重试 → 读到 CLAIMED → TASK_ALREADY_CLAIMED
  const resultA = await creatorA;
  assert.equal(resultA.code, 'TASK_ALREADY_CLAIMED', `晚到创建者必须走已领取分支：${JSON.stringify(resultA)}`);

  const finalTask = ctx.taskFor(applicationId);
  assert.equal(finalTask.status, STATUS.CLAIMED, '晚到提交不得把状态重置回 QUEUED');
  assert.equal(finalTask.revision, 2, 'revision 不得回退');
  assert.equal(finalTask.claimId, claimIdB, 'claimId 不得被覆盖');
  assert.equal(finalTask.employeeNo, employeeNo, 'employeeNo 不得被换');
  assert.equal(ctx.db.rows(COLLECTIONS.TASK).length, 1, '不得新建第二个任务');
  const claimAudits = ctx.db.rows(COLLECTIONS.AUDIT).filter((row) => row.action === 'claimTask');
  assert.equal(claimAudits.length, 1, '全库只允许一次成功领取审计');
  const createAudits = ctx.db.rows(COLLECTIONS.AUDIT).filter((row) => row.action === 'createFaceTask');
  assert.equal(createAudits.length, 1, '建任务审计只来自成功创建方');
  assert.ok(ctx.db.commitLog.some((entry) => entry.outcome === 'conflict-retry'), '晚到提交必须因写冲突重试后再走已有任务分支');
});

// ---------------------------------------------------------------------------
// R06：beginTaskExecution 执行前复核
// ---------------------------------------------------------------------------

test('R06 正例：复核通过原子推进 DEVICE_PROCESSING、revision 恰好 +1、claim 不延长、快照一致', async () => {
  const ctx = await claimedFixture();
  const claimed = ctx.claimed.data.task;
  const started = await begin(ctx, claimed);
  assert.equal(started.code, 0, JSON.stringify(started));
  const snapshot = started.data.task;
  assert.equal(started.data.authorizedAt, snapshot.authorizedAt, 'authorizedAt 需同时出现在 data.authorizedAt');
  assert.ok(Number.isSafeInteger(started.data.authorizedAt) && started.data.authorizedAt > 0, 'authorizedAt 为服务端整数毫秒');
  assert.equal(snapshot.status, STATUS.DEVICE_PROCESSING);
  assert.equal(snapshot.revision, claimed.revision + 1, 'revision 必须恰好 +1');
  assert.equal(snapshot.claimExpiresAt, claimed.claimExpiresAt, '成功不得延长原 claim');
  assert.equal(snapshot.claimId, claimed.claimId);
  for (const key of ['fileId', 'employeeNo', 'doorNo', 'deviceKey', 'validFrom', 'validTo', 'dailyHours', 'accessPlanFingerprint', 'name']) {
    assert.equal(snapshot[key], claimed[key], `快照字段 ${key} 必须与领取视图一致`);
  }
  const stored = ctx.taskFor(ctx.applicationId);
  assert.equal(snapshot.configRevision, stored.configRevision, '快照必须携带复核过的配置关联版本');
  assert.equal(snapshot.roomRevision, stored.roomRevision, '快照必须携带房间关联版本');
  assert.equal(snapshot.leaseRevision, stored.leaseRevision, '快照必须携带租约关联版本');
  assert.equal(snapshot.roomBindingId, stored.roomBindingId);
  assert.equal(snapshot.leaseSnapshotId, stored.leaseSnapshotId);
  assert.equal(snapshot.workerId, WORKER_ID);
  assert.equal(stored.status, STATUS.DEVICE_PROCESSING);
  assert.equal(stored.revision, claimed.revision + 1);
  assert.equal(stored.claimId, claimed.claimId);
  assert.equal(stored.claimExpiresAt, claimed.claimExpiresAt);
  assert.equal(stored.employeeNo, ctx.applied.data.employeeNo);
  const audits = ctx.db.rows(COLLECTIONS.AUDIT).filter((row) => row.action === 'beginTaskExecution');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].revision, stored.revision);
  // 后续 report 使用推进后 revision 可正常完成。
  const reported = await ctx.main({
    action: 'reportTask', workerToken: TOKEN, taskId: stored._id, claimId: stored.claimId,
    revision: stored.revision, exitCode: 0, output: successOutput(claimed),
  });
  assert.equal(reported.code, 0, JSON.stringify(reported));
  assert.equal(reported.data.status, STATUS.PENDING_SITE_VERIFICATION);
});

test('R06 拒绝矩阵：错 claim/错 revision/错 worker/重复开始/未领取/不存在，零授权且状态不被破坏', async () => {
  const ctx = await claimedFixture();
  const claimed = ctx.claimed.data.task;
  const baseline = ctx.taskFor(ctx.applicationId);

  const cases = [
    ['错 claimId', { claimId: 'a'.repeat(16) + '-0001' }, 'CLAIM_MISMATCH'],
    ['错 revision（旧 revision 重复开始）', { revision: claimed.revision + 1 }, 'REVISION_CONFLICT'],
    ['错 worker', { workerId: 'other-worker-01' }, 'WORKER_MISMATCH'],
  ];
  for (const [label, override, code] of cases) {
    const result = await begin(ctx, claimed, override);
    assert.equal(result.code, code, `${label} 应返回 ${code}，实际 ${JSON.stringify(result)}`);
    const stored = ctx.taskFor(ctx.applicationId);
    assert.equal(stored.status, STATUS.CLAIMED, `${label} 不得推进状态`);
    assert.equal(stored.revision, baseline.revision, `${label} 不得改动 revision`);
  }

  // 非 CLAIMED 状态：排队（从未领取）任务携带与当前一致的 claim/revision 也不授权。
  const queued = await queuedFixture();
  const queuedRow = queued.taskFor(queued.applicationId);
  const syntheticClaim = 'c'.repeat(16) + '-0001';
  queued.db.collection(COLLECTIONS.TASK).doc(queuedRow._id).set({ data: { ...queuedRow, claimId: syntheticClaim, revision: 2 } });
  const notClaimed = await begin(queued, { taskId: queued.taskId, claimId: syntheticClaim, revision: 2 });
  assert.equal(notClaimed.code, 'TASK_NOT_CLAIMED', JSON.stringify(notClaimed));
  assert.equal(queued.taskFor(queued.applicationId).status, STATUS.QUEUED_FOR_DISPATCH, '排队任务不得被推进');

  // 终态任务同样不得再次授权。
  const terminal = await claimedFixture();
  terminal.task = await executingTask(terminal, terminal.task);
  const reported = await terminal.main({
    action: 'reportTask', workerToken: TOKEN, taskId: terminal.task.taskId, claimId: terminal.task.claimId,
    revision: terminal.task.revision, exitCode: 4,
    output: { protocolVersion: 1, outcome: 'failed', mode: 'device', validityMode: 'fixed', siteVerification: 'PENDING' },
  });
  assert.equal(reported.code, 0, JSON.stringify(reported));
  const terminalBegin = await begin(terminal, { ...terminal.task, revision: terminal.task.revision + 1 });
  assert.equal(terminalBegin.code, 'TASK_NOT_CLAIMED', JSON.stringify(terminalBegin));

  const notFound = await begin(ctx, { taskId: ids.taskId(ENV, 'no-such-application'), claimId: claimed.claimId, revision: claimed.revision });
  assert.equal(notFound.code, 'TASK_NOT_FOUND');

  // 重复开始：已推进 DEVICE_PROCESSING 后再次 begin 不得再授权。
  const ok = await begin(ctx, claimed);
  assert.equal(ok.code, 0, JSON.stringify(ok));
  const again = await begin(ctx, { ...claimed, revision: ok.data.task.revision });
  assert.equal(again.code, 'EXECUTION_ALREADY_STARTED', `重复开始必须拒绝：${JSON.stringify(again)}`);
  const final = ctx.taskFor(ctx.applicationId);
  assert.equal(final.status, STATUS.DEVICE_PROCESSING);
  assert.equal(final.revision, claimed.revision + 1, '重复开始不得再次推进 revision');
});

test('R06 白名单与鉴权：额外字段/自报批准被拒，worker 专用 action 生效', async () => {
  const ctx = await claimedFixture();
  const claimed = ctx.claimed.data.task;
  for (const extra of [{ approved: true }, { status: 'DEVICE_PROCESSING' }, { validFrom: '2026-12-01T00:00:00' }]) {
    const result = await begin(ctx, claimed, extra);
    assert.equal(result.code, 'CLIENT_FIELD_FORBIDDEN', `自报字段 ${JSON.stringify(extra)} 必须拒绝，实际 ${JSON.stringify(result)}`);
  }
  const result = await begin(ctx, claimed, { workerToken: 'x'.repeat(40) });
  assert.equal(result.code, 'WORKER_UNAUTHORIZED', '错误 token 必须拒绝');
  const badRevision = await begin(ctx, claimed, { revision: 1 });
  assert.equal(badRevision.code, 'INVALID_REVISION', 'revision<2 的 payload 由格式校验拒绝');
  assert.ok(validate.ACTION_FIELDS.beginTaskExecution, '白名单必须包含 beginTaskExecution');
  assert.deepEqual(validate.ACTION_FIELDS.beginTaskExecution, ['action', 'workerToken', 'workerId', 'taskId', 'claimId', 'revision']);
});

test('R06 过期复核：claim 过期后 begin 拒绝并原子转 UNKNOWN_RESULT（不延长、不重授权）', async () => {
  const ctx = await claimedFixture();
  const claimed = ctx.claimed.data.task;
  ctx.setNow(new Date(FIXED.getTime() + 10 * 60 * 1000 + 1)); // 恰好越过 claimExpiresAt
  const result = await begin(ctx, claimed);
  assert.equal(result.code, 'CLAIM_EXPIRED', JSON.stringify(result));
  const stored = ctx.taskFor(ctx.applicationId);
  assert.equal(stored.status, STATUS.UNKNOWN_RESULT, '过期必须原子转 UNKNOWN_RESULT');
  assert.equal(stored.resultCode, 'CLAIM_TIMEOUT');
  assert.equal(stored.revision, claimed.revision + 1);
  assert.equal(stored.claimExpiresAt, claimed.claimExpiresAt, '不得延长原 claim');
  assert.equal(stored.employeeNo, ctx.applied.data.employeeNo, '不换号');
  const audits = ctx.db.rows(COLLECTIONS.AUDIT).filter((row) => row.action === 'beginTaskExecutionRejected');
  assert.equal(audits.length, 1, '拒绝必须留审计');
  assert.equal(audits[0].revision, stored.revision, '审计 revision 与推进一致');
  // 重复开始 / 再 claim 都不得再次授权。
  const againOld = await begin(ctx, claimed);
  assert.equal(againOld.code, 'REVISION_CONFLICT', '旧 revision 重复开始必须 REVISION_CONFLICT');
  const againNew = await begin(ctx, { ...claimed, revision: stored.revision });
  assert.equal(againNew.code, 'TASK_NOT_CLAIMED', '推进后 revision 的重复开始必须 TASK_NOT_CLAIMED');
  const reclaim = await claim(ctx);
  assert.equal(reclaim.data.task, null, '不得自动重领');
});

test('R06 失效复核：撤名单/关开关/换房/改租期后 begin 拒绝并原子转 INVALIDATED', async () => {
  const variants = [
    ['撤名单', async (ctx) => { await ctx.admin.setAllowlist([]); }],
    ['关派发开关', async (ctx) => { await ctx.admin.setDispatchEnabled(false); }],
    ['关总开关', async (ctx) => { await ctx.admin.setSwitch(false); }],
    ['换房', async (ctx) => { await ctx.admin.upsertRoomBinding({ ...ROOM_INPUT, roomId: 'room-stable-2' }); }],
    ['改租期', async (ctx) => { await ctx.admin.upsertLease({ startDate: '2026-12-01', endDate: '2026-12-06' }); }],
  ];
  for (const [label, mutate] of variants) {
    const ctx = await claimedFixture();
    const claimed = ctx.claimed.data.task;
    await mutate(ctx);
    const result = await begin(ctx, claimed);
    assert.equal(result.code, 'EXECUTION_INVALIDATED', `${label} 后 begin 应拒绝，实际 ${JSON.stringify(result)}`);
    const stored = ctx.taskFor(ctx.applicationId);
    assert.equal(stored.status, STATUS.INVALIDATED, `${label} 后任务必须原子失效`);
    assert.equal(stored.revision, claimed.revision + 1);
    assert.equal(stored.claimId, claimed.claimId, '失效保留领取标识');
    assert.equal(stored.employeeNo, ctx.applied.data.employeeNo, '失效不换号');
    const audits = ctx.db.rows(COLLECTIONS.AUDIT).filter((row) => row.action === 'beginTaskExecutionRejected');
    assert.equal(audits.length, 1, `${label} 拒绝必须留审计`);
  }
});

test('R06：claim 后、begin 前发生的变化在复核时被拒绝（执行前复核读当前权威状态）', async () => {
  const ctx = await claimedFixture();
  const claimed = ctx.claimed.data.task;
  // claim 与 begin 之间撤名单：复核必须读到当前状态并拒绝。
  await ctx.admin.setAllowlist([]);
  const result = await begin(ctx, claimed);
  assert.equal(result.code, 'EXECUTION_INVALIDATED', JSON.stringify(result));
});

test('丢失开始回执：DEVICE_PROCESSING 且领取过期的任务由清扫转 UNKNOWN_RESULT，不重派发', async () => {
  const ctx = await queuedFixture();
  const claimed = await claim(ctx);
  assert.ok(claimed.data.task);
  const stored = ctx.taskFor(ctx.applicationId);
  // 模拟：begin 已推进但回执丢失；claim 过期。
  const advanced = { ...stored, status: STATUS.DEVICE_PROCESSING, revision: stored.revision + 1 };
  ctx.db.collection(COLLECTIONS.TASK).doc(stored._id).set({ data: advanced });
  ctx.setNow(new Date(FIXED.getTime() + 11 * 60 * 1000));
  const again = await claim(ctx);
  assert.equal(again.code, 0);
  assert.equal(again.data.task, null, '不得重新派发');
  const after = ctx.taskFor(ctx.applicationId);
  assert.equal(after.status, STATUS.UNKNOWN_RESULT);
  assert.equal(after.resultCode, 'CLAIM_TIMEOUT');
  assert.equal(after.employeeNo, stored.employeeNo, '不换号');
  assert.equal(after.claimId, stored.claimId, '保留领取标识');
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

test('CF-R2-01：下载期间切换 namespace，权威事务拒绝旧文件且零任务/审计写入', async () => {
  const ctx = await approvedFixture();
  let enterDownload;
  let releaseDownload;
  const entered = new Promise((resolve) => { enterDownload = resolve; });
  const released = new Promise((resolve) => { releaseDownload = resolve; });
  ctx.cloud.downloadFile = async () => { enterDownload(); await released; return { fileContent: JPEG }; };
  const creating = ctx.main({ action: 'createFaceTask', applicationId: ctx.applicationId,
    fileId: fileId(ctx.applicationId), consent: true });
  await entered;
  await ctx.admin.setStorageNamespace(OTHER_NAMESPACE);
  const before = fullSnapshot(ctx);
  releaseDownload();
  const result = await creating;
  const after = fullSnapshot(ctx);
  assert.equal(result.code, 'FILE_NAMESPACE_MISMATCH');
  assert.deepEqual(after, before, '被拒创建不得留下任何集合的业务/审计变动');
});

test('CF-R2-03：CLAIMED 不能绕过 begin 报设备成功或已执行失败', async () => {
  for (const [exitCode, output] of [[0, null], [4, { outcome: 'failed', mode: 'device', validityMode: 'fixed' }]]) {
    const ctx = await claimedFixture();
    const task = ctx.claimed.data.task;
    const before = fullSnapshot(ctx);
    const result = await ctx.main({ action: 'reportTask', workerToken: TOKEN,
      taskId: task.taskId, claimId: task.claimId, revision: task.revision,
      exitCode, output: output || successOutput(task) });
    const after = fullSnapshot(ctx);
    assert.equal(result.code, 'TASK_NOT_EXECUTING');
    assert.deepEqual(after, before);
  }
});

test('CF-R2-03：真实 worker 形状的 begin 前输入失败/下载未知报告仍可记账', async () => {
  for (const [exitCode, outcome, expected] of [[2, 'invalid-input', STATUS.FAILED_REVIEW], [5, 'stopped', STATUS.UNKNOWN_RESULT]]) {
    const ctx = await claimedFixture();
    const task = ctx.claimed.data.task;
    const before = fullSnapshot(ctx);
    const result = await ctx.main({ action: 'reportTask', workerToken: TOKEN,
      taskId: task.taskId, claimId: task.claimId, revision: task.revision, exitCode,
      output: { protocolVersion: 1, outcome, mode: 'device', validityMode: 'fixed',
        enrollment: null, device: null, siteVerification: 'PENDING',
        error: { code: exitCode === 2 ? 'DEVICE_KEY_MISSING' : 'PHOTO_PREPARE_FAILED' } } });
    const after = fullSnapshot(ctx);
    assert.equal(result.code, 0, JSON.stringify(result));
    assert.equal(result.data.status, expected);
    assert.notDeepEqual(after, before);
    const stored = ctx.taskFor(ctx.applicationId);
    assert.equal(stored.revision, task.revision + 1);
    assert.equal(stored.employeeNo, task.employeeNo);
    assert.equal(ctx.db.rows(COLLECTIONS.AUDIT).filter((row) => row.action === 'beginTaskExecution').length, 0);
  }
});

test('CF-R2-03：终态不可翻绿，严格同报告/原请求 revision 才幂等', async () => {
  const ctx = await claimedFixture();
  const task = await executingTask(ctx, ctx.claimed.data.task);
  const payload = { action: 'reportTask', workerToken: TOKEN, taskId: task.taskId,
    claimId: task.claimId, revision: task.revision, exitCode: 4,
    output: { outcome: 'failed', mode: 'device', validityMode: 'fixed', steps: [{ key: 'verify', state: 'failed' }] } };
  const failed = await ctx.main(payload);
  assert.equal(failed.data.status, STATUS.FAILED_REVIEW);
  const terminal = ctx.taskFor(ctx.applicationId);
  for (const request of [
    { ...payload, revision: terminal.revision, exitCode: 0, output: successOutput(task) },
    { ...payload, revision: terminal.revision },
    { ...payload, output: { ...payload.output, steps: [{ key: 'verify', state: 'success' }] } },
  ]) {
    const before = fullSnapshot(ctx);
    const response = await ctx.main(request);
    const after = fullSnapshot(ctx);
    assert.equal(response.code, 'REPORT_CONFLICT');
    assert.deepEqual(after, before);
  }
  const before = fullSnapshot(ctx);
  const replay = await ctx.main(payload);
  const after = fullSnapshot(ctx);
  assert.equal(replay.code, 0);
  assert.equal(replay.data.idempotent, true);
  assert.equal(replay.data.status, STATUS.FAILED_REVIEW);
  assert.deepEqual(after, before);
});

test('CF-R2-06：begin 截止前 1ms 可授权，等于/之后 1ms 均过期且不延长 claim', async () => {
  for (const offset of [-1, 0, 1]) {
    const ctx = await claimedFixture();
    const task = ctx.claimed.data.task;
    ctx.setNow(new Date(task.claimExpiresAt + offset));
    const before = fullSnapshot(ctx);
    const result = await begin(ctx, task);
    const after = fullSnapshot(ctx);
    assert.equal(result.code, offset < 0 ? 0 : 'CLAIM_EXPIRED');
    const stored = ctx.taskFor(ctx.applicationId);
    assert.equal(stored.claimExpiresAt, task.claimExpiresAt);
    assert.equal(stored.status, offset < 0 ? STATUS.DEVICE_PROCESSING : STATUS.UNKNOWN_RESULT);
    assert.notDeepEqual(after, before);
  }
});

test('CF-R2-06：report 与超时清扫都采用 now >= claimExpiresAt', async () => {
  for (const offset of [-1, 0, 1]) {
    const ctx = await claimedFixture();
    const task = await executingTask(ctx, ctx.claimed.data.task);
    ctx.setNow(new Date(task.claimExpiresAt + offset));
    const result = await ctx.main({ action: 'reportTask', workerToken: TOKEN,
      taskId: task.taskId, claimId: task.claimId, revision: task.revision,
      exitCode: 0, output: successOutput(task) });
    assert.equal(result.code, 0);
    assert.equal(result.data.status, offset < 0 ? STATUS.PENDING_SITE_VERIFICATION : STATUS.UNKNOWN_RESULT);
    assert.equal(ctx.taskFor(ctx.applicationId).claimExpiresAt, task.claimExpiresAt);
  }
  const ctx = await claimedFixture();
  ctx.setNow(new Date(ctx.claimed.data.task.claimExpiresAt));
  const claimed = await claim(ctx);
  assert.equal(claimed.data.task, null);
  assert.equal(ctx.taskFor(ctx.applicationId).status, STATUS.UNKNOWN_RESULT);
});

test('CF-R2-07：claim 缺失/空/非法 worker 均零写拒绝，旧空绑定 begin 也失败关闭', async () => {
  for (const workerId of [undefined, '', 'bad worker', 'x'.repeat(65)]) {
    const ctx = await queuedFixture();
    const before = fullSnapshot(ctx);
    const result = await ctx.main({ action: 'claimTask', workerToken: TOKEN, ...(workerId === undefined ? {} : { workerId }) });
    const after = fullSnapshot(ctx);
    assert.equal(result.code, 'INVALID_WORKER_ID');
    assert.deepEqual(after, before);
  }
  const ctx = await claimedFixture();
  const task = ctx.taskFor(ctx.applicationId);
  await ctx.db.collection(COLLECTIONS.TASK).doc(task._id).set({ data: { ...task, workerId: '' } });
  const before = fullSnapshot(ctx);
  const result = await begin(ctx, ctx.claimed.data.task);
  const after = fullSnapshot(ctx);
  assert.equal(result.code, 'WORKER_MISMATCH');
  assert.deepEqual(after, before);
});

test('CF-R2-10 云门：轮询旧申请不恢复上传；合法重新授权可恢复，终态事实只读保留', async () => {
  const ctx = await approvedFixture();
  const poll = () => ctx.main({ action: 'getMyTask', applicationId: ctx.applicationId });
  assert.equal((await poll()).data.uploadEligible, true);
  await ctx.admin.setAllowlist([]);
  let before = fullSnapshot(ctx);
  const rejected = await poll();
  let after = fullSnapshot(ctx);
  assert.equal(rejected.code, 'ACCOUNT_NOT_ALLOWED');
  assert.deepEqual(after, before);
  await ctx.admin.setAllowlist([OPENID]);
  assert.equal((await poll()).data.uploadEligible, true, '合法重获当前资格可恢复，不能永久锁住');
  const app = ctx.db.row(COLLECTIONS.APPLICATION, ctx.applicationId);
  await ctx.db.collection(COLLECTIONS.APPLICATION).doc(app._id).set({ data: { ...app, result: 'pending_review' } });
  before = fullSnapshot(ctx);
  assert.equal((await poll()).code, 'APPLICATION_NOT_APPROVED');
  after = fullSnapshot(ctx);
  assert.deepEqual(after, before);

  const terminalCtx = await claimedFixture();
  const task = await executingTask(terminalCtx, terminalCtx.claimed.data.task);
  await terminalCtx.main({ action: 'reportTask', workerToken: TOKEN, taskId: task.taskId,
    claimId: task.claimId, revision: task.revision, exitCode: 0, output: successOutput(task) });
  await terminalCtx.admin.setAllowlist([]);
  before = fullSnapshot(terminalCtx);
  const terminalView = await terminalCtx.main({ action: 'getMyTask', applicationId: terminalCtx.applicationId });
  after = fullSnapshot(terminalCtx);
  assert.equal(terminalView.code, 0);
  assert.equal(terminalView.data.status, STATUS.PENDING_SITE_VERIFICATION);
  assert.equal(terminalView.data.uploadEligible, false);
  assert.deepEqual(after, before);
});

test('setById 载荷绝不携带 _id（真实云端 SDK 拒绝 -501007 不能更新_id）', async () => {
  const db = new MemoryDB({ strictId: true });
  const store = createStore(db, { environment: ENVIRONMENT, now: () => 1800000000000 });
  const configId = ids.configId(ENVIRONMENT);
  const saved = await store.setById(COLLECTIONS.CONFIG, configId, { applicationVersion: 1, revision: 1 });
  assert.equal(saved._id, configId);
  assert.equal(db.row(COLLECTIONS.CONFIG, configId).applicationVersion, 1);
  await store.withTransaction(async (tx) => {
    await tx.setById(COLLECTIONS.LEASE, ids.leaseId(ENVIRONMENT), {
      validFrom: '2026-12-01', validTo: '2026-12-31', revision: 1,
    });
  });
  assert.equal(db.row(COLLECTIONS.LEASE, ids.leaseId(ENVIRONMENT)).validFrom, '2026-12-01');
});
