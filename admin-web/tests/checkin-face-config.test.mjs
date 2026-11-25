/**
 * B05 / §6 — 本地管理后台配置服务合成测试。
 *
 * 断言默认关闭、102 唯一、手填租期边界、名单、worker token 只存哈希、
 * revision 递增与失败关闭。不依赖 npm 依赖，不代表后台页面真机操作通过。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { AdminCheckinFaceTestConfig } from '../lib/checkin-face-test-config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const cloudValidate = require('../../cloudfunctions/checkinFaceTest/lib/validate.js');
const { COLLECTIONS, ids } = require('../../cloudfunctions/checkinFaceTest/lib/store.js');
const CLOUD_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV = 'checkin-face-test';
const TOKEN = 'SyntheticWorkerToken-0123456789abcdef';
const TOKEN_HASH = createHash('sha256').update(TOKEN, 'utf8').digest('hex');

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

class MemoryDB {
  constructor(options = {}) {
    // strictId=true 时 doc().set 的 data 载荷携带 _id 即抛错（复现真实云端 SDK -501007）。
    this.strictId = !!options.strictId;
    this.collections = new Map();
    this.buckets = this.collections;
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

function service(db = new MemoryDB()) {
  return { db, config: new AdminCheckinFaceTestConfig(null, { database: db, environment: ENV, operator: 'synthetic-admin', now: () => new Date('2026-11-24T10:00:00Z') }) };
}

const ROOM_INPUT = {
  displayNo: '102', projectId: 'project-stable-1', buildingId: 'building-stable-1',
  roomId: 'room-stable-1', houseId: 'house-stable-1', doorNo: 7, deviceKey: 'device-key-stable',
  accessPlanFingerprint: 'a'.repeat(64),
};
const LEASE_INPUT = { startDate: '2026-12-01', endDate: '2026-12-05' };
const STORAGE_NAMESPACE = 'synthetic-env-1g2h3j4k.7465-synthetic-env-1g2h3j4k-1300000000';

async function configuredService() {
  const ctx = service();
  await ctx.config.upsertRoomBinding(ROOM_INPUT);
  // upsertLease 的生产前置要求版本已配置；提前配版本才能形成一致租期快照。
  await ctx.config.setApplicationVersion('test-v1');
  await ctx.config.upsertLease(LEASE_INPUT);
  return ctx;
}

test('缺省关闭：空库 getConfig 不包含 token/哈希，revision=0', async () => {
  const { config } = service();
  const snapshot = await config.getConfig();
  assert.equal(snapshot.config.enabled, false);
  assert.equal(snapshot.config.dispatchEnabled, false);
  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.config.workerTokenConfigured, false);
  assert.equal(snapshot.config.storageNamespaceConfigured, false, '空库时可信命名空间必须为未配置');
  assert.equal(snapshot.config.storageNamespace, '');
  assert.ok(!('workerTokenHash' in snapshot.config));
  assert.ok(!JSON.stringify(snapshot).includes(TOKEN_HASH));
});

test('setSwitch(true) 在版本/凭据/102 绑定/租期任一缺失时分别被拒', async () => {
  // 四项前置逐一隔离，只有对应项缺失；命名空间预先配好，避免抢占错误码。
  const scenarios = [
    ['VERSION_UNCONFIGURED', async (config) => { await config.setStorageNamespace(STORAGE_NAMESPACE); }],
    ['WORKER_TOKEN_UNCONFIGURED', async (config) => {
      await config.setStorageNamespace(STORAGE_NAMESPACE);
      await config.setApplicationVersion('test-v1');
    }],
    ['ROOM_UNCONFIGURED', async (config) => {
      await config.setStorageNamespace(STORAGE_NAMESPACE);
      await config.setApplicationVersion('test-v1');
      await config.setWorkerToken(TOKEN);
    }],
    ['LEASE_UNCONFIGURED', async (config) => {
      await config.setStorageNamespace(STORAGE_NAMESPACE);
      await config.setApplicationVersion('test-v1');
      await config.setWorkerToken(TOKEN);
      await config.upsertRoomBinding(ROOM_INPUT);
    }],
  ];
  for (const [code, prepare] of scenarios) {
    const { db, config } = service();
    await prepare(config);
    const before = db.writes;
    await assert.rejects(() => config.setSwitch(true), (error) => error.code === code, `${code} 必须由 setSwitch 守门`);
    assert.equal(db.writes, before, `${code} 时不得写库`);
    assert.equal((await config.getConfig()).config.enabled, false);
  }

  const { config: ready } = await configuredService();
  await ready.setStorageNamespace(STORAGE_NAMESPACE);
  await ready.setWorkerToken(TOKEN);
  const snapshotBefore = await ready.getConfig();
  const switched = await ready.setSwitch(true, '合成测试开启');
  assert.equal(switched.enabled, true);
  assert.equal(switched.revision, snapshotBefore.revision + 1);
  assert.equal((await ready.getConfig()).config.enabled, true);
});

test('setDispatchEnabled 默认 false，只接受严格 boolean', async () => {
  const { db, config } = service();
  assert.equal((await config.getConfig()).config.dispatchEnabled, false);
  const before = db.writes;
  for (const value of ['true', 1, 0, null, undefined, {}, []]) {
    await assert.rejects(() => config.setDispatchEnabled(value), (error) => error.code === 'INVALID_INPUT');
  }
  assert.equal(db.writes, before, '非法派发开关输入必须零写入');
  const opened = await config.setDispatchEnabled(true);
  assert.equal(opened.dispatchEnabled, true);
  assert.equal((await config.getConfig()).config.dispatchEnabled, true);
  assert.equal((await config.setDispatchEnabled(false)).dispatchEnabled, false);
});

test('P0 配置面守门：公开方法即可产出非空版本、租期快照同版本、worker token 与派发开关', async () => {
  const { config } = await configuredService();
  await config.setAllowlist(['test-user-01']);
  await config.setWorkerToken(TOKEN);
  await config.setStorageNamespace(STORAGE_NAMESPACE);
  await config.setDispatchEnabled(true);
  await config.setSwitch(true);
  const snapshot = await config.getConfig();
  assert.equal(snapshot.config.applicationVersion, 'test-v1');
  assert.ok(snapshot.config.applicationVersion.length > 0);
  assert.equal(snapshot.lease.applicationVersion, 'test-v1', '租期快照必须跟随公开配置的版本');
  assert.equal(snapshot.config.workerTokenConfigured, true);
  assert.equal(snapshot.config.storageNamespaceConfigured, true);
  assert.equal(snapshot.config.dispatchEnabled, true);
  assert.equal(snapshot.config.enabled, true);
});

test('upsertRoomBinding：102 唯一确定性 id、名称可选持久化、同号多条拒绝', async () => {
  const { db, config } = service();
  const withNames = await config.upsertRoomBinding({ ...ROOM_INPUT, projectName: '合成项目', buildingName: '合成楼栋' });
  assert.equal(withNames._id, `${ENV}|102`);
  assert.equal(withNames.displayNo, '102');
  assert.equal(withNames.projectName, '合成项目');
  assert.equal(withNames.buildingName, '合成楼栋');
  assert.equal(withNames.doorNo, 7);
  const snapshot = await config.getConfig();
  assert.equal(snapshot.room.roomId, 'room-stable-1');
  assert.equal(snapshot.config.revision, 1, '每次配置写操作只递增一次 revision');

  const { config: minimal } = service();
  await minimal.upsertRoomBinding(ROOM_INPUT);
  const names = await minimal.getConfig();
  assert.equal(names.room.projectName, undefined, '未填写名称时不伪造');

  await db.collection('test_room_binding_102').doc(`${ENV}|duplicate`).set({ data: { ...ROOM_INPUT, environment: ENV } });
  const before = db.writes;
  await assert.rejects(() => config.upsertRoomBinding(ROOM_INPUT), (error) => error.code === 'ROOM_NOT_UNIQUE');
  assert.equal(db.writes, before, '歧义绑定时零写入');
  await assert.rejects(() => config.upsertRoomBinding({ ...ROOM_INPUT, displayNo: '101' }), (error) => error.code === 'INVALID_ROOM');
});

test('upsertLease：手填起止映射 T00:00:00/T23:59:59；非法日期/越界零写入', async () => {
  const { db, config } = await configuredService();
  const snapshot = await config.getConfig();
  assert.deepEqual(
    { validFrom: snapshot.lease.validFrom, validTo: snapshot.lease.validTo, timezone: snapshot.lease.timezone, dailyHours: snapshot.lease.dailyHours },
    { validFrom: '2026-12-01T00:00:00', validTo: '2026-12-05T23:59:59', timezone: 'Asia/Shanghai', dailyHours: '24x7' },
  );
  assert.equal(snapshot.lease.status, 'active');
  assert.equal(snapshot.lease.roomBindingId, `${ENV}|102`);
  assert.equal(snapshot.revision, 3, 'room+version+lease 三次配置各递增一次');
  const audits = db.rows('test_checkin_face_audit').filter((row) => row.action === 'upsertLease');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].after.validTo, '2026-12-05T23:59:59');

  for (const bad of [
    { startDate: '2026-13-01', endDate: '2026-12-05' },
    { startDate: '2026-12-06', endDate: '2026-12-05' },
    { startDate: '2026-12-01T00:00:00', endDate: '2026-12-05' },
    { startDate: 'today', endDate: 'long-term' },
  ]) {
    const before = db.writes;
    await assert.rejects(() => config.upsertLease(bad), (error) => /INVALID_DATE/.test(error.code || error.message));
    assert.equal(db.writes, before, '非法日期不得写库');
  }
  const noRoom = service();
  await assert.rejects(() => noRoom.config.upsertLease(LEASE_INPUT), (error) => error.code === 'ROOM_UNCONFIGURED');
});

test('setApplicationVersion 接受云端同样接受的合法版本并持久化', async () => {
  const valid = ['0.1.0-beta.19-checkin-face.1', 'v1', 'A', 'a_b-c.d', '9'.repeat(64)];
  const { config } = service();
  for (const version of valid) {
    assert.doesNotThrow(() => cloudValidate.validateApplicationVersion(version), `${version} 必须被云端 validator 接受`);
    assert.ok(CLOUD_VERSION_PATTERN.test(version));
    const result = await config.setApplicationVersion(version);
    assert.equal(result.applicationVersion, version);
    assert.equal((await config.getConfig()).config.applicationVersion, version);
  }
});

test('setApplicationVersion 与云端版本正则一致：中文/空格/!/超64/符号开头均双端拒绝且零写入', async () => {
  const invalid = ['bad version 版本!', '中文版本', 'ver sion', 'bad!', '-bad', '_bad', '.bad', 'a'.repeat(63) + '!', 'a'.repeat(65), '', '   ', null, 123];
  for (const version of invalid) {
    if (typeof version === 'string') {
      assert.ok(!CLOUD_VERSION_PATTERN.test(version), `样本 ${JSON.stringify(version)} 必须也在云端正则之外`);
    }
    assert.throws(() => cloudValidate.validateApplicationVersion(version), undefined, `云端必须拒绝 ${JSON.stringify(version)}`);
    const { db, config } = service();
    const before = db.writes;
    await assert.rejects(() => config.setApplicationVersion(version), (error) => error.code === 'INVALID_APPLICATION_VERSION');
    assert.equal(db.writes, before, `非法版本 ${JSON.stringify(version)} 必须零写入`);
    assert.equal((await config.getConfig()).config.applicationVersion, '');
    assert.equal(db.rows('test_checkin_face_audit').length, 0, '非法版本不得留审计');
  }
});

test('upsertLease 在版本未配置时零写入失败关闭（不得落地空版本快照）', async () => {
  const { db, config } = service();
  await config.upsertRoomBinding(ROOM_INPUT);
  const before = db.writes;
  await assert.rejects(() => config.upsertLease(LEASE_INPUT), (error) => error.code === 'VERSION_UNCONFIGURED');
  assert.equal(db.writes, before, '半配置租期必须零写入');
  assert.equal((await config.getConfig()).lease, null);
});

test('setApplicationVersion 轮换时同步租期快照版本与 revision，并只在实际变更时同步', async () => {
  const { db, config } = await configuredService();
  const before = await config.getConfig();
  const rotated = await config.setApplicationVersion('test-v2');
  assert.equal(rotated.applicationVersion, 'test-v2');
  assert.equal(rotated.leaseVersionSynced, true);
  assert.equal(rotated.revision, before.revision + 1);
  const after = await config.getConfig();
  assert.equal(after.config.applicationVersion, 'test-v2');
  assert.equal(after.lease.applicationVersion, 'test-v2');
  assert.equal(after.lease.revision, before.lease.revision + 1, '同步租期版本必须递增 lease.revision');
  assert.deepEqual(after.lease, { ...before.lease, applicationVersion: 'test-v2', revision: before.lease.revision + 1 });
  const audit = db.rows('test_checkin_face_audit').filter((row) => row.action === 'APPLICATION_VERSION_SET').at(-1);
  assert.equal(audit.after.applicationVersion, 'test-v2');
  assert.equal(audit.after.leaseVersionSynced, true);
  const again = await config.setApplicationVersion('test-v2');
  assert.equal(again.leaseVersionSynced, false, '同版本重复设置不应再次改租期');
  assert.equal((await config.getConfig()).lease.revision, after.lease.revision);
});

test('setSwitch(true) 拒绝被 DB 绕过制造的租期版本不一致半配置态', async () => {
  const { db, config } = await configuredService();
  await config.setWorkerToken(TOKEN);
  await config.setStorageNamespace(STORAGE_NAMESPACE);
  // 模拟绕过公开方法直接改库：config=test-v1 但 lease 快照残留 stale-version。
  const leaseId = `${ENV}|lease|102`;
  const current = (await db.collection('test_lease_snapshot').doc(leaseId).get()).data;
  const stale = { ...current, applicationVersion: 'stale-version' };
  await db.collection('test_lease_snapshot').doc(leaseId).set({ data: stale });
  const before = db.writes;
  await assert.rejects(() => config.setSwitch(true), (error) => error.code === 'LEASE_VERSION_MISMATCH');
  assert.equal(db.writes, before, '半配置态不得写库');
  assert.equal((await config.getConfig()).config.enabled, false);
});

test('setAllowlist：名单持久化、重复/非法账号拒绝、移除账号转为 inactive', async () => {
  const { db, config } = await configuredService();
  await config.setAllowlist([{ openid: 'test-user-01', displayLabel: '合成成员' }, 'test-user-02']);
  const first = await config.getConfig();
  assert.equal(first.allowlist.length, 2);
  assert.ok(first.allowlist.every((row) => !('workerTokenHash' in row)));
  assert.equal(first.revision, 4);

  const beforeInvalid = db.writes;
  await assert.rejects(() => config.setAllowlist(['test-user-01', 'test-user-01']), (error) => error.code === 'DUPLICATE_OPENID');
  await assert.rejects(() => config.setAllowlist(['ab!']), (error) => error.code === 'INVALID_OPENID');
  assert.equal(db.writes, beforeInvalid, '非法名单零写入');

  await config.setAllowlist(['test-user-02']);
  const after = await config.getConfig();
  assert.equal(after.allowlist.find((row) => row.openid === 'test-user-01').status, 'inactive');
  assert.equal(after.allowlist.find((row) => row.openid === 'test-user-02').status, 'active');
  assert.equal(after.revision, 5);
});

test('setWorkerToken：至少 32 字符、只存 SHA-256、审计仅记前 8 位、非法输入零写入', async () => {
  const { db, config } = service();
  const beforeInvalid = db.writes;
  for (const token of ['short', 'x'.repeat(31), TOKEN.slice(0, 40) + '\n', 12345]) {
    await assert.rejects(() => config.setWorkerToken(token), (error) => error.code === 'INVALID_WORKER_TOKEN');
  }
  assert.equal(db.writes, beforeInvalid, '非法 token 不得写库');

  const result = await config.setWorkerToken(TOKEN, { operator: 'synthetic-admin', reason: '合成轮换' });
  assert.equal(result.workerTokenConfigured, true);
  assert.equal(result.revision, 1);
  const configRow = db.rows('test_program_config')[0];
  assert.equal(configRow.workerTokenHash, TOKEN_HASH);
  const serialized = JSON.stringify([...db.buckets.values()].map((bucket) => [...bucket.values()]));
  assert.ok(!serialized.includes(TOKEN), '明文 token 不得出现在序列化库中');
  const audit = db.rows('test_checkin_face_audit').find((row) => row.action === 'WORKER_TOKEN_SET');
  assert.deepEqual(audit.after, { workerTokenPrefix: TOKEN_HASH.slice(0, 8), revision: 1 });
  assert.ok(!audit.reason.includes(TOKEN));

  const snapshot = await config.getConfig();
  assert.equal(snapshot.config.workerTokenConfigured, true);
  assert.ok(!('workerTokenHash' in snapshot.config));
  assert.ok(!JSON.stringify(snapshot).includes(TOKEN_HASH));
  assert.ok(!JSON.stringify(snapshot).includes(TOKEN));
});

test('setStorageNamespace：与云端校验器同源正则，持久化+审计+revision，非法零写入', async () => {
  const { db, config } = service();
  assert.ok(cloudValidate.STORAGE_NAMESPACE_PATTERN.test(STORAGE_NAMESPACE), '合法样本必须通过云端正则');
  const saved = await config.setStorageNamespace(STORAGE_NAMESPACE, { reason: '合成配置' });
  assert.equal(saved.storageNamespace, STORAGE_NAMESPACE);
  assert.equal(saved.revision, 1);
  const snapshot = await config.getConfig();
  assert.equal(snapshot.config.storageNamespace, STORAGE_NAMESPACE, 'getConfig 必须回读命名空间值');
  assert.equal(snapshot.config.storageNamespaceConfigured, true);
  const audit = db.rows('test_checkin_face_audit').find((row) => row.action === 'STORAGE_NAMESPACE_SET');
  assert.equal(audit.after.storageNamespace, STORAGE_NAMESPACE, '审计必须记录命名空间值');
  assert.equal(audit.revision, 1);

  // 双端一致：admin 拒绝集与云端正则拒绝集完全相同。
  const samples = ['ok-1.ab_c-9', 'A', '-bad', '_bad', 'has space', 'a/b', 'a'.repeat(129), '中文', '', '   '];
  for (const sample of samples) {
    const patternOk = cloudValidate.STORAGE_NAMESPACE_PATTERN.test(sample);
    const { db: freshDb, config: fresh } = service();
    let rejected = false;
    try { await fresh.setStorageNamespace(sample); } catch (error) { rejected = error.code === 'INVALID_STORAGE_NAMESPACE'; }
    assert.equal(rejected, !patternOk, `样本 ${JSON.stringify(sample)} 双端必须一致`);
    if (rejected) assert.equal(freshDb.writes, 0, '非法命名空间必须零写入');
    else assert.equal(freshDb.writes, 2, '合法命名空间写配置+审计各一次');
  }
  const { db: nullDb, config: nullConfig } = service();
  const before = nullDb.writes;
  await assert.rejects(() => nullConfig.setStorageNamespace(null), (error) => error.code === 'INVALID_STORAGE_NAMESPACE');
  await assert.rejects(() => nullConfig.setStorageNamespace(123), (error) => error.code === 'INVALID_STORAGE_NAMESPACE');
  assert.equal(nullDb.writes, before, '非字符串输入零写入');
});

test('setSwitch(true) 新增前置：可信云存储命名空间未配置时 STORAGE_NAMESPACE_UNCONFIGURED 且零写入', async () => {
  // 其余四项前置（版本/凭据/102/租期）已满足，仅缺命名空间。
  const { db, config } = service();
  await config.setApplicationVersion('test-v1');
  await config.setWorkerToken(TOKEN);
  await config.upsertRoomBinding(ROOM_INPUT);
  await config.upsertLease(LEASE_INPUT);
  const before = db.writes;
  await assert.rejects(() => config.setSwitch(true), (error) => error.code === 'STORAGE_NAMESPACE_UNCONFIGURED');
  assert.equal(db.writes, before, '缺命名空间时开启开关必须零写入');
  assert.equal((await config.getConfig()).config.enabled, false);

  // 配置命名空间后开启成功。
  await config.setStorageNamespace(STORAGE_NAMESPACE, { reason: '合成配置' });
  const opened = await config.setSwitch(true, '合成开启');
  assert.equal(opened.enabled, true);
  assert.equal((await config.getConfig()).config.storageNamespaceConfigured, true);
});

test('publicDoc 过滤秘密字段；后台路由保持 admin-only + CSRF/origin 校验', async () => {
  const { db, config } = service();
  db.collection('test_room_binding_102').doc(`${ENV}|102`).set({
    data: { ...ROOM_INPUT, _id: `${ENV}|102`, password: 'synthetic-device-password', origin: 'https://synthetic.invalid', pin: '123456', privateKey: 'synthetic-key' },
  });
  const snapshot = await config.getConfig();
  const serialized = JSON.stringify(snapshot);
  for (const secret of ['synthetic-device-password', 'https://synthetic.invalid', '123456', 'synthetic-key']) {
    assert.ok(!serialized.includes(secret), `getConfig 返回了秘密 ${secret}`);
  }
  assert.equal(snapshot.room.roomId, 'room-stable-1');

  const server = readFileSync(join(ROOT, 'admin-web/server.mjs'), 'utf8');
  assert.match(server, /CHECKIN_FACE_TEST_API\s*=\s*"\/api\/checkin-face-test\//);
  assert.match(server, /if\s*\(account\.role\s*!==\s*"admin"\)/);
  assert.ok(/csrf/i.test(server) && /origin/i.test(server), '后台写操作必须延续 session+CSRF+origin 校验');
  assert.match(server, /workerTokenConfigured/);
  // R01 新增公开配置路由：命名空间必须走同一 admin-only 路由并复用云端正则。
  assert.match(server, /CHECKIN_FACE_STORAGE_NAMESPACE_PATTERN/, '路由必须复用云端命名空间正则');
  assert.match(server, /\$\{CHECKIN_FACE_TEST_API\}storage/, '必须存在 /api/checkin-face-test/storage 路由');
  assert.match(server, /setStorageNamespace/, '路由必须调用配置服务的 setStorageNamespace');
});


function fullSnapshot(db) {
  return structuredClone([...db.buckets].map(([name, rows]) => [name, [...rows]]));
}

test('CF-R2-02：namespace 与关停交错时自动重试，不能复活开关或复用 revision', async () => {
  const { db, config } = await configuredService();
  await config.setWorkerToken(TOKEN);
  await config.setStorageNamespace(STORAGE_NAMESPACE);
  await config.setSwitch(true);
  const initial = await config.getConfig();
  let pause;
  let resume;
  const paused = new Promise((resolve) => { pause = resolve; });
  const resumed = new Promise((resolve) => { resume = resolve; });
  let first = true;
  const pauseOnce = async () => { if (first) { first = false; pause(); await resumed; } };
  db.beforeCommit = pauseOnce;
  // Also schedule a base set: disabling the production transaction wrapper
  // must reproduce the old lost-disable assertion, not merely hang the test.
  const originalCollection = db.collection.bind(db);
  db.collection = (name) => {
    const collection = originalCollection(name);
    if (name !== 'test_program_config') return collection;
    return { ...collection, doc(id) {
      const doc = collection.doc(id);
      return { ...doc, async set(argument) {
        if (argument.data.storageNamespace === 'replacement-synthetic-env') await pauseOnce();
        return doc.set(argument);
      } };
    } };
  };
  const savingNamespace = config.setStorageNamespace('replacement-synthetic-env');
  await paused;
  const disabled = await config.setSwitch(false);
  assert.equal((await config.getConfig()).config.enabled, false);
  resume();
  await savingNamespace;
  const after = await config.getConfig();
  assert.equal(after.config.enabled, false);
  assert.equal(after.config.storageNamespace, 'replacement-synthetic-env');
  assert.equal(disabled.revision, initial.revision + 1);
  assert.equal(after.revision, disabled.revision + 1);
  assert.ok(db.commitLog.some((entry) => entry.outcome === 'conflict-retry'));
  const revisions = db.rows('test_checkin_face_audit').filter((row) => ['STORAGE_NAMESPACE_SET', 'setSwitch'].includes(row.action))
    .map((row) => row.revision);
  assert.equal(new Set(revisions).size, revisions.length, '已提交配置审计 revision 不重复');
});

test('CF-R2-02：全部公开配置写与审计同事务，任一提交失败全库回滚', async () => {
  const mutations = [
    (config) => config.setWorkerToken(TOKEN + '-rotated'),
    (config) => config.setApplicationVersion('test-v2'),
    (config) => config.setDispatchEnabled(true),
    (config) => config.setStorageNamespace(STORAGE_NAMESPACE),
    (config) => config.setSwitch(false),
    (config) => config.upsertRoomBinding({ ...ROOM_INPUT, doorNo: 8 }),
    (config) => config.upsertLease({ startDate: '2026-12-02', endDate: '2026-12-06' }),
    (config) => config.setAllowlist(['test-user-02']),
  ];
  for (const mutate of mutations) {
    const { db, config } = await configuredService();
    await config.setAllowlist(['test-user-01']);
    const before = fullSnapshot(db);
    const writes = db.writes;
    db.failCommits = 1;
    await assert.rejects(() => mutate(config), (error) => error.code === 'SIMULATED_COMMIT_FAILURE');
    const after = fullSnapshot(db);
    assert.deepEqual(after, before);
    assert.equal(db.writes, writes);
  }
});

test('CF-R2-02：并发替换名单以事务内当前索引撤销，不遗留孤立 active 账号', async () => {
  const { db, config } = await configuredService();
  await config.setAllowlist(['test-user-01']);
  let pause;
  let resume;
  const paused = new Promise((resolve) => { pause = resolve; });
  const resumed = new Promise((resolve) => { resume = resolve; });
  let first = true;
  db.beforeCommit = async () => { if (first) { first = false; pause(); await resumed; } };
  const firstReplacement = config.setAllowlist(['test-user-02']);
  await paused;
  await config.setAllowlist(['test-user-03']);
  resume();
  await firstReplacement;
  const snapshot = await config.getConfig();
  assert.deepEqual(snapshot.allowlist.filter((row) => row.status === 'active').map((row) => row.openid), ['test-user-02']);
  assert.deepEqual(snapshot.config.allowlistOpenids, ['test-user-02']);
  assert.equal(snapshot.allowlist.find((row) => row.openid === 'test-user-03').status, 'inactive');
  assert.ok(db.commitLog.some((entry) => entry.outcome === 'conflict-retry'));
});

test('CF-R2-02：旧非空名单无索引不自动回填；版本未绑定的空盘点也失败关闭', async () => {
  const { db, config } = await configuredService();
  await config.setAllowlist(['test-user-01']);
  const row = (await db.collection('test_program_config').doc(`${ENV}|config`).get()).data;
  delete row.allowlistOpenids;
  await db.collection('test_program_config').doc(row._id).set({ data: row });
  const before = fullSnapshot(db);
  await assert.rejects(() => config.setAllowlist(['test-user-02']), (error) => error.code === 'ALLOWLIST_INDEX_UNVERIFIED');
  const after = fullSnapshot(db);
  assert.deepEqual(after, before);

  const empty = await configuredService();
  const originalCollection = empty.db.collection.bind(empty.db);
  let injectChange = true;
  empty.db.collection = (name) => {
    const collection = originalCollection(name);
    if (name !== 'test_account_allowlist') return collection;
    return { ...collection, where(query) {
      const ref = collection.where(query);
      return { ...ref, async get() {
        if (injectChange) { injectChange = false; await empty.config.setDispatchEnabled(false); }
        return ref.get();
      } };
    } };
  };
  // The observed config revision is now stale when the transaction begins.
  await assert.rejects(() => empty.config.setAllowlist(['test-user-02']), (error) => error.code === 'ALLOWLIST_INDEX_UNVERIFIED');
  assert.equal((await empty.config.getConfig()).allowlist.length, 0);
});

test('CF-R2-02：无真实事务不降级，外部 constructor transaction=true 也不能绕过', async () => {
  const db = new MemoryDB();
  db.runTransaction = undefined;
  const config = new AdminCheckinFaceTestConfig(null, { database: db, environment: ENV, transaction: true });
  const before = fullSnapshot(db);
  await assert.rejects(() => config.setDispatchEnabled(true), (error) => error.code === 'TRANSACTION_UNAVAILABLE');
  const after = fullSnapshot(db);
  assert.deepEqual(after, before);
});

test("admin config #set payload never carries _id (real cloud SDK rejects -501007)", async () => {
  const db = new MemoryDB({ strictId: true });
  const service = new AdminCheckinFaceTestConfig(db, { operator: "synthetic-admin" });
  const result = await service.setApplicationVersion("v1", { reason: "严格模式回归" });
  assert.equal(result.applicationVersion, "v1");
  assert.equal(db.row(COLLECTIONS.CONFIG, ids.configId(ENV)).applicationVersion, "v1");
});
