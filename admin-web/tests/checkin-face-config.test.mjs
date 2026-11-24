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
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { AdminCheckinFaceTestConfig } from '../lib/checkin-face-test-config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV = 'checkin-face-test';
const TOKEN = 'SyntheticWorkerToken-0123456789abcdef';
const TOKEN_HASH = createHash('sha256').update(TOKEN, 'utf8').digest('hex');

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

class MemoryDB {
  constructor() {
    this.buckets = new Map();
    this.writes = 0;
  }

  bucket(name) {
    if (!this.buckets.has(name)) this.buckets.set(name, new Map());
    return this.buckets.get(name);
  }

  rows(name) { return [...this.bucket(name).values()].map(clone); }

  collection(name) {
    const db = this;
    const store = this.bucket(name);
    const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
    return {
      doc: (id) => ({
        get: async () => {
          const row = store.get(id);
          if (!row) throw Object.assign(new Error('document not found'), { errCode: -1 });
          return { data: clone(row) };
        },
        set: async ({ data }) => { db.writes += 1; store.set(id, clone({ ...data, _id: id })); return {}; },
      }),
      where: (where) => ({
        get: async () => ({ data: db.rows(name).filter((row) => matches(row, where)) }),
        count: async () => ({ total: db.rows(name).filter((row) => matches(row, where)).length }),
      }),
      add: async ({ data }) => {
        db.writes += 1;
        const id = data._id || `auto-${db.writes}`;
        store.set(id, clone({ ...data, _id: id }));
        return { _id: id };
      },
    };
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

async function configuredService() {
  const ctx = service();
  await ctx.config.upsertRoomBinding(ROOM_INPUT);
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
  assert.ok(!('workerTokenHash' in snapshot.config));
  assert.ok(!JSON.stringify(snapshot).includes(TOKEN_HASH));
});

test('未唯一绑定 102 / 未手填租期时开开关被拒，前置条件满足后才可开启且 revision 递增', async () => {
  const { db, config } = service();
  const before = db.writes;
  await assert.rejects(() => config.setSwitch(true), (error) => error.code === 'ROOM_UNCONFIGURED');
  await config.upsertRoomBinding(ROOM_INPUT);
  await assert.rejects(() => config.setSwitch(true), (error) => error.code === 'LEASE_UNCONFIGURED');
  assert.ok(db.writes > before, '绑定本身允许写库');
  const { config: ready } = await configuredService();
  const snapshotBefore = await ready.getConfig();
  const switched = await ready.setSwitch(true, '合成测试开启');
  assert.equal(switched.enabled, true);
  assert.equal(switched.revision, snapshotBefore.revision + 1);
  const snapshotAfter = await ready.getConfig();
  assert.equal(snapshotAfter.config.enabled, true);
  assert.equal(snapshotAfter.revision, switched.revision);
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

  await db.collection('test_room_binding_102').doc(`${ENV}|duplicate`).set({ data: { ...ROOM_INPUT, environment: ENV, _id: `${ENV}|duplicate` } });
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
  assert.equal(snapshot.revision, 2, 'room+lease 两次配置各递增一次');
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

test('setAllowlist：名单持久化、重复/非法账号拒绝、移除账号转为 inactive', async () => {
  const { db, config } = await configuredService();
  await config.setAllowlist([{ openid: 'test-user-01', displayLabel: '合成成员' }, 'test-user-02']);
  const first = await config.getConfig();
  assert.equal(first.allowlist.length, 2);
  assert.ok(first.allowlist.every((row) => !('workerTokenHash' in row)));
  assert.equal(first.revision, 3);

  const beforeInvalid = db.writes;
  await assert.rejects(() => config.setAllowlist(['test-user-01', 'test-user-01']), (error) => error.code === 'DUPLICATE_OPENID');
  await assert.rejects(() => config.setAllowlist(['ab!']), (error) => error.code === 'INVALID_OPENID');
  assert.equal(db.writes, beforeInvalid, '非法名单零写入');

  await config.setAllowlist(['test-user-02']);
  const after = await config.getConfig();
  assert.equal(after.allowlist.find((row) => row.openid === 'test-user-01').status, 'inactive');
  assert.equal(after.allowlist.find((row) => row.openid === 'test-user-02').status, 'active');
  assert.equal(after.revision, 4);
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
});
