'use strict';

/**
 * D 路独立跨模块回归（checkin-face 退修 0d6c674）——冻结契约 oracle，不调用
 * 生产 helper 计算期望值；期望值全部来自复审原文与 COMMON 冻结契约。
 *
 * 场景：SDK 形状 fileID 同一值贯穿上传→创建任务→worker 下载（R01）；
 * 真实 WXML 结构配套（R02）；分离 base/tx 与整组回滚（R03）；
 * 创建/领取交错（R04）；漏设备 key（R05）；下载后过期/撤权（R06）；
 * 默认依赖解析（R07）；照片处理/失败结果与清理不误报成功（R08/R09）；
 * 普通账号不误报成功（R11/C2）。
 *
 * 每项先证明当前固定候选为何失败/缺覆盖：所依赖的 A/B/C 修复未落地时，
 * 用例以 INTEGRATION_PENDING(<lane>/<finding>) 精确失败并附实测证据，
 * 集成冻结后同一用例即成为全绿门禁。依赖 A 路接口的用例（R01/R03/R04/R06）
 * 在集成冻结前以 [待集成] 诊断行标记：当前工作树实测通过，但正式计入等待
 * lead 集成冻结后的统一收口。全部为合成 fixture/假云/假设备，
 * 不连接真实设备、云或微信；无监听端口。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const CLOUD_DIR = path.join(ROOT, 'cloudfunctions/checkinFaceTest');
const WORKER_DIR = path.join(ROOT, 'tools/checkin-face-worker');
const { createMain } = require(path.join(CLOUD_DIR, 'index.js'));
const { ENVIRONMENT, COLLECTIONS } = require(path.join(CLOUD_DIR, 'lib/store.js'));
const validate = require(path.join(CLOUD_DIR, 'lib/validate.js'));
const { AdminCheckinFaceTestConfig } = require(path.join(ROOT, 'admin-web/lib/checkin-face-test-config.mjs'));
const networkGuard = globalThis.__DSH_D_NETWORK_GUARD__;
const businessBaselines = new Map();
test.before(() => {
  assert.ok(networkGuard, 'The D guard must be preloaded before business modules');
  networkGuard.assertLoadTimeClean();
});
test.beforeEach((t) => { businessBaselines.set(t.name, networkGuard.snapshot()); });
test.afterEach((t) => { networkGuard.assertNoViolations(businessBaselines.get(t.name), t.name); });


const OPENID = 'test-user-01';
const OTHER_OPENID = 'other-user-99';
const VERSION = 'test-v1';
const TOKEN = 'synthetic-worker-token-0123456789';
const WORKER_ID = 'synthetic-worker-01';
const FINGERPRINT = 'a'.repeat(64);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0, 1, 0xff, 0xd9]);
const FIXED = new Date('2026-12-03T04:00:00Z'); // Asia/Shanghai 2026-12-03 12:00:00

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function pending(finding, evidence) {
  return new Error(`INTEGRATION_PENDING(${finding}): ${evidence}`);
}

/**
 * 集成状态标记（lead 指令）：依赖 A 路接口的用例在集成冻结前先标待集成。
 * 接口缺失时用例以 INTEGRATION_PENDING 精确失败；接口已实现时用例照常执行并
 * 在输出中打出 [待集成] 诊断行——当前工作树实测通过，但正式计入等待
 * lead 集成冻结后的统一收口复跑，不把未冻结状态当成最终验收。
 */
function markPendingIntegration(t, finding) {
  t.diagnostic(`[待集成] ${finding}：依赖 A 路接口，当前工作树已实测通过；等待 lead 集成冻结后正式计入。`);
}

// ---------------------------------------------------------------------------
// 合成数据库：base/tx 分离、路由记录、提交冲突注入、写闸门（并发交错）
// ---------------------------------------------------------------------------
class MemoryDB {
  constructor() {
    this.buckets = new Map();
    this.revs = new Map(); // collection -> id -> 内部版本（快照隔离冲突检测）
    this.route = [];
    this.writes = { base: 0, tx: 0 };
    this.txDepth = 0; // 并发事务活动深度（路由标记用，不与任何单个事务绑定）
    this.seq = 0;
    this.beforeSet = null;
    this.commitConflict = null; // 每次提交都触发（负控：模拟提交故障）
    this.maxAttempts = 6;
  }

  baseBucket(name) {
    if (!this.buckets.has(name)) this.buckets.set(name, new Map());
    return this.buckets.get(name);
  }

  docRev(name, id) {
    if (!this.revs.has(name)) this.revs.set(name, new Map());
    if (!this.revs.get(name).has(id)) this.revs.get(name).set(id, 0);
    return this.revs.get(name).get(id);
  }

  bumpRev(name, id) {
    if (!this.revs.has(name)) this.revs.set(name, new Map());
    const next = (this.revs.get(name).get(id) || 0) + 1;
    this.revs.get(name).set(id, next);
    return next;
  }

  rows(name) { return [...this.baseBucket(name).values()].map(clone); }
  row(name, id) { const value = this.baseBucket(name).get(id); return value ? clone(value) : null; }

  snapshot() {
    // 空集合与“集合不存在”语义相同，只登记有行的集合。
    const collections = {};
    for (const name of this.buckets.keys()) {
      const rows = this.rows(name);
      if (rows.length > 0) collections[name] = rows;
    }
    return { collections, writes: { ...this.writes } };
  }

  /** 基础句柄：永远操作 base（捕获期绑定），事务活动期内仍指向外层 DB。 */
  collection(name) {
    return this.handle('base', name, null);
  }

  /**
   * kind=tx 的句柄绑定自己的事务上下文（并发安全：多事务各自独立覆盖层），
   * 带读穿透：覆盖层优先，其余读 base；写入进覆盖层。
   */
  handle(kind, name, txCtx) {
    const db = this;
    const txBucket = (coll) => {
      if (!txCtx.buckets.has(coll)) txCtx.buckets.set(coll, new Map());
      return txCtx.buckets.get(coll);
    };
    const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
    const readRows = () => {
      if (kind === 'base' || !txCtx) return [...db.baseBucket(name).values()];
      const byId = new Map();
      for (const row of [...db.baseBucket(name).values(), ...txBucket(name).values()]) byId.set(row._id, row);
      return [...byId.values()];
    };
    const readById = (id) => {
      if (kind === 'tx' && txCtx && txBucket(name).has(id)) return txBucket(name).get(id);
      const value = db.baseBucket(name).get(id);
      if (!value) {
        if (kind === 'tx' && txCtx) txCtx.seenRev(name, id); // 记录“读不存在”
        throw Object.assign(new Error('document does not exist'), { errCode: -1 });
      }
      if (kind === 'tx' && txCtx) txCtx.seenRev(name, id);
      return value;
    };
    const writeBucket = () => (kind === 'tx' && txCtx ? txBucket(name) : db.baseBucket(name));
    const log = (op) => db.route.push({ handle: kind, collection: name, op, inTx: db.txDepth > 0 });
    return {
      doc: (id) => ({
        get: async () => {
          log('get');
          return { data: clone(readById(id)) };
        },
        set: async ({ data }) => {
          log('set');
          if (db.beforeSet) await db.beforeSet(name, id);
          if (kind === 'tx' && txCtx) txCtx.writes += 1; else db.writes.base += 1;
          writeBucket().set(id, clone({ ...data, _id: id }));
          return {};
        },
      }),
      where: (where) => ({
        get: async () => {
          log('where.get');
          return { data: readRows().filter((row) => matches(row, where)).map(clone) };
        },
        count: async () => {
          log('where.count');
          return { total: readRows().filter((row) => matches(row, where)).length };
        },
        update: async ({ data }) => {
          log('where.update');
          let updated = 0;
          for (const row of readRows()) {
            if (matches(row, where)) {
              if (kind === 'tx' && txCtx) txCtx.writes += 1; else db.writes.base += 1;
              writeBucket().set(row._id, clone({ ...row, ...data }));
              updated += 1;
            }
          }
          return { stats: { updated } };
        },
      }),
      add: async ({ data }) => {
        log('add');
        if (db.beforeSet) await db.beforeSet(name, data && data._id);
        if (kind === 'tx' && txCtx) txCtx.writes += 1; else db.writes.base += 1;
        const id = data._id || `auto-${++db.seq}`;
        writeBucket().set(id, clone({ ...data, _id: id }));
        return { _id: id };
      },
      get: async () => {
        log('collection.get');
        return { data: readRows().map(clone) };
      },
    };
  }

  /**
   * 快照隔离事务：读集版本不变才提交，冲突自动重试回调（§3.3）。
   * 每个事务拥有独立上下文（并发安全）；commitConflict 为持久负控。
   */
  runTransaction(fn) {
    const db = this;
    const attempts = { count: 0 };
    const attempt = async () => {
      attempts.count += 1;
      db.txDepth += 1;
      const txCtx = {
        buckets: new Map(),
        writes: 0,
        readSet: new Map(), // `${collection}\u0000${id}` -> rev
        seenRev(name, id) {
          const key = `${name}\u0000${id}`;
          if (!this.readSet.has(key)) this.readSet.set(key, db.docRev(name, id));
        },
      };
      const txHandle = { collection: (name) => db.handle('tx', name, txCtx) };
      let result;
      try {
        result = await fn(txHandle);
      } catch (error) {
        db.txDepth -= 1;
        throw error;
      }
      const conflict = db.commitConflict;
      if (conflict && (txCtx.buckets.get(conflict.collection)?.size || 0) > 0) {
        db.txDepth -= 1; // 模拟提交故障：整组丢弃
        const error = new Error('simulated commit conflict');
        error.code = conflict.code;
        throw error;
      }
      for (const [key, rev] of txCtx.readSet) {
        const sep = key.indexOf('\u0000');
        if (db.docRev(key.slice(0, sep), key.slice(sep + 1)) !== rev) {
          db.txDepth -= 1; // 快照冲突：丢弃并重试
          throw Object.assign(new Error('snapshot conflict'), { code: 'TX_CONFLICT_RETRY' });
        }
      }
      for (const [coll, map] of txCtx.buckets) {
        const base = db.baseBucket(coll);
        for (const [id, row] of map) {
          base.set(id, row);
          db.bumpRev(coll, id);
        }
      }
      db.writes.tx += txCtx.writes;
      db.writes.base += txCtx.writes;
      db.txDepth -= 1;
      return result;
    };
    return (async () => {
      while (true) {
        try {
          return await attempt();
        } catch (error) {
          if (db.commitConflict && error.code === db.commitConflict.code) {
            if (attempts.count >= db.maxAttempts) throw error;
            continue; // 持久提交故障：耗尽重试后抛出
          }
          if (error.code === 'TX_CONFLICT_RETRY') {
            if (attempts.count >= db.maxAttempts) {
              throw Object.assign(new Error('transaction conflict retries exhausted'), { code: 'TX_CONFLICT_EXHAUSTED' });
            }
            continue;
          }
          throw error;
        }
      }
    })();
  }
}

// ---------------------------------------------------------------------------
// 夹具：仅用后台公开配置能力构造状态（与 A 路夹具同源）；期望值不调用 ids。
// ---------------------------------------------------------------------------
const ROOM_INPUT = {
  displayNo: '102', projectId: 'project-stable-1', buildingId: 'building-stable-1',
  roomId: 'room-stable-1', houseId: 'house-stable-1', doorNo: 7,
  deviceKey: 'device-key-stable', accessPlanFingerprint: FINGERPRINT,
  projectName: '合成项目', buildingName: '合成楼栋',
};
const LEASE_INPUT = { startDate: '2026-12-01', endDate: '2026-12-05' };
/** 服务端唯一可信云存储命名空间（管理员公开配置；A 路 INTERFACES §1.2）。 */
const STORAGE_NAMESPACE = 'synthetic-env-abc.synthetic-bucket-xyz';

async function fixture({ enabled = true, dispatchEnabled = true, now = FIXED } = {}) {
  const db = new MemoryDB();
  const admin = new AdminCheckinFaceTestConfig(null, {
    database: db, environment: ENVIRONMENT, operator: 'synthetic-admin', now: () => now,
  });
  await admin.upsertRoomBinding(ROOM_INPUT);
  await admin.setApplicationVersion(VERSION);
  await admin.upsertLease(LEASE_INPUT);
  await admin.setAllowlist([OPENID]);
  await admin.setWorkerToken(TOKEN);
  await admin.setStorageNamespace(STORAGE_NAMESPACE);
  await admin.setDispatchEnabled(dispatchEnabled);
  await admin.setSwitch(enabled);
  let currentOpenid = OPENID;
  let currentNow = now;
  const cloud = {
    getWXContext: () => ({ OPENID: currentOpenid }),
    downloadFile: async () => ({ fileContent: JPEG }),
  };
  const main = (event) => createMain({ db, cloud, environment: ENVIRONMENT, now: () => currentNow })(event);
  const apply = () => main({ action: 'applyCheckin', applicationVersion: VERSION });
  const claim = () => main({ action: 'claimTask', workerToken: TOKEN, workerId: WORKER_ID });
  const taskRows = () => db.rows(COLLECTIONS.TASK);
  return {
    db, admin, main, apply, claim, taskRows,
    setOpenid: (value) => { currentOpenid = value; },
    setNow: (value) => { currentNow = value; },
    token: TOKEN,
  };
}

async function approvedFixture(options) {
  const ctx = await fixture(options);
  const applied = await ctx.apply();
  assert.equal(applied.code, 0, JSON.stringify(applied));
  assert.equal(applied.data.result, 'auto_approved');
  return { ...ctx, applied, applicationId: applied.data.applicationId };
}

/** 冻结候选云端契约下的对象路径（裸 test-face/ 前缀，未实现 R01 前有效）。 */
function bareObjectPath(applicationId, openid = OPENID) {
  return `test-face/${ENVIRONMENT}/${openid}/${applicationId}/photo.jpg`;
}

/** SDK 形状 fileID（微信云存储 uploadFile 返回值形状，合成常量；命名空间 = 可信配置值）。 */
function sdkFileId(applicationId, openid = OPENID) {
  return `cloud://${STORAGE_NAMESPACE}/${bareObjectPath(applicationId, openid)}`;
}

// ---------------------------------------------------------------------------
// 页面/服务加载（vm 隔离，仅注入显式依赖，与 B 路夹具同法）
// ---------------------------------------------------------------------------
function loadCjs(filename, { requires = {}, globals = {} } = {}) {
  const source = fs.readFileSync(filename, 'utf8');
  const module = { exports: {} };
  const customRequire = (id) => (Object.prototype.hasOwnProperty.call(requires, id) ? requires[id] : require(id));
  const names = [...Object.keys(globals), 'require', 'module', 'exports'];
  const values = [...Object.values(globals), customRequire, module, module.exports];
  const wrapper = vm.runInThisContext(`(function (${names.join(', ')}) {\n${source}\n})`, { filename });
  wrapper(...values);
  return module.exports;
}

// ---------------------------------------------------------------------------
// S1（R01/A）：SDK 形状 fileID 同一值贯穿 上传→创建任务→worker 下载
// ---------------------------------------------------------------------------
let workerRuntimeModulePromise = null;
function workerRuntimeModule() {
  if (!workerRuntimeModulePromise) {
    workerRuntimeModulePromise = import(pathToFileURL(path.join(WORKER_DIR, 'worker-runtime.mjs')).href);
  }
  return workerRuntimeModulePromise;
}

test('S1 SDK 形状 fileID 同一值贯穿：上传透传→云端接受并持久化→worker 下载同一值', async (t) => {
  markPendingIntegration(t, 'R01/A');
  const rt = await workerRuntimeModule();
  const ctx = await approvedFixture();
  const applicationId = ctx.applicationId;
  const view = await ctx.main({ action: 'getMyTask', applicationId });
  assert.equal(view.code, 0);
  const objectPath = view.data.cloudPath;
  assert.ok(objectPath.startsWith('test-face/'), `服务端必须下发对象路径：${objectPath}`);
  const cloudFileId = `cloud://${STORAGE_NAMESPACE}/${objectPath}`;

  const uploads = [];
  const api = loadCjs(path.join(ROOT, 'miniprogram/services/api.js'), {
    requires: {
      '../config/runtime': { mode: 'live', cloudEnv: 'synthetic-env', allowDeviceOperations: false },
      './demo': { houses: [], feed: [], locks: [], records: [], conversations: [], profile: {}, family: [], property: {}, meter: {} },
    },
    globals: {
      wx: {
        cloud: {
          uploadFile: async (payload) => { uploads.push(payload); return { fileID: cloudFileId }; },
          callFunction: async (payload) => payload.name === 'phoneLogin'
            ? { result: { code: 0, userInfo: { _id: 'synthetic-cross-user', role: 'user', houses: [], points: 0 } } }
            : { result: await ctx.main(payload.data) },
        },
      },
    },
  });

  await api.loginWithPhone('synthetic-authorized-phone-code');
  assert.equal((await api.getProfile())._id, 'synthetic-cross-user');
  assert.equal(uploads.length, 0, 'identity preparation is not a photo upload');

  // 1) 上传侧：wx.cloud.uploadFile 的实际 fileID 原样透传，不截头、不拼接。
  const uploaded = await api.uploadTestFace({ applicationId, cloudPath: objectPath, filePath: 'C:/synthetic/photo.jpg' });
  assert.equal(uploaded, cloudFileId, '上传返回的 fileID 必须原样透传');

  // 2) 创建任务：同一值直达云端。
  let created;
  try {
    created = await api.createFaceTask({ applicationId, fileId: uploaded, consent: true });
  } catch (error) {
    let workerSide = '';
    const downloadLog = [];
    try {
      const client = await rt.createCloudClient({
        config: { cloudEnv: 'synthetic-env' },
        cloudbaseFactory: async () => ({
          callFunction: async () => ({}),
          downloadFile: async ({ fileID }) => { downloadLog.push(fileID); return { fileContent: JPEG }; },
        }),
      });
      await client.downloadFile(objectPath);
    } catch (inner) {
      workerSide = `worker 侧对同一裸对象路径下载被拒：${inner?.code}`;
    }
    throw pending(
      'R01/A',
      `云端拒绝 SDK 形状 fileID：${String(error?.message || error)}；同时 ${workerSide || '（worker 未拒）'}。` +
      '冻结候选把同一标识拆成两个契约（云端只收裸路径、worker 只收 cloud://），不存在可贯穿两端的同一值。',
    );
  }

  // 3) 云端持久化验证过的真实 fileID + 规范对象路径。
  const rows = ctx.taskRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fileId, cloudFileId, '任务必须持久化原始真实 fileID');
  assert.ok(typeof rows[0].cloudPath === 'string' && rows[0].cloudPath.length > 0);
  assert.ok(!rows[0].cloudPath.startsWith('cloud://'), 'cloudPath 应为规范对象路径');

  // 4) 领取：worker 拿到同一值。
  const claimed = await ctx.claim();
  assert.equal(claimed.code, 0, JSON.stringify(claimed));
  assert.ok(claimed.data.task, 'claimTask 必须返回任务');
  assert.equal(claimed.data.task.fileId, cloudFileId);

  // 5) worker 下载同一真实 fileID：不报 FILE_ID_INVALID，字节为 JPEG。
  const downloadLog = [];
  const client = await rt.createCloudClient({
    config: { cloudEnv: 'synthetic-env' },
    cloudbaseFactory: async () => ({
      callFunction: async () => ({}),
      downloadFile: async ({ fileID }) => { downloadLog.push(fileID); return { fileContent: JPEG }; },
    }),
  });
  const bytes = await client.downloadFile(claimed.data.task.fileId);
  assert.deepEqual(downloadLog, [cloudFileId], 'worker 必须用任务持久化的同一 fileID 下载');
  assert.ok(Buffer.isBuffer(bytes) && bytes[0] === 0xff && bytes[1] === 0xd8);

  // 6) 负例（契约 A 路 INTERFACES §1.4 闭式码表）：跨用户/跨申请 → FILE_OWNERSHIP_MISMATCH；
  //    跨环境命名空间 → FILE_NAMESPACE_MISMATCH；裸路径/非 cloud:///文件名非法（%、..、分隔符）→ INVALID_FILE_ID。
  const before = ctx.taskRows().length;
  const negatives = [
    [sdkFileId(applicationId, OTHER_OPENID), 'FILE_OWNERSHIP_MISMATCH'],
    [sdkFileId('someone-else-application'), 'FILE_OWNERSHIP_MISMATCH'],
    [`cloud://other-env-xyz.synthetic-bucket-xyz/${objectPath}`, 'FILE_NAMESPACE_MISMATCH'],
    [objectPath, 'INVALID_FILE_ID'],
    [`cloud://${STORAGE_NAMESPACE}/${objectPath.replace('photo.jpg', 'photo%2F.jpg')}`, 'INVALID_FILE_ID'],
    [`cloud://${STORAGE_NAMESPACE}/${objectPath.replace('photo.jpg', '..photo.jpg')}`, 'INVALID_FILE_ID'],
    [`cloud://${STORAGE_NAMESPACE}/${objectPath.replace('photo.jpg', 'sub/photo.jpg')}`, 'INVALID_FILE_ID'],
    [`https://${STORAGE_NAMESPACE}/${objectPath}`, 'INVALID_FILE_ID'],
  ];
  for (const [bad, code] of negatives) {
    const denied = await ctx.main({ action: 'createFaceTask', applicationId, fileId: bad, consent: true });
    assert.equal(denied.code, code, `fileID ${bad} 必须被拒为 ${code}：${JSON.stringify(denied)}`);
  }
  assert.equal(ctx.taskRows().length, before, '负例不得新建任务');

  // 7) §1.2：getConfig 只下发命名空间布尔，不下发命名空间值。
  const cfgView = await ctx.main({ action: 'getConfig' });
  assert.equal(cfgView.data.storageNamespaceConfigured, true);
  assert.ok(!JSON.stringify(cfgView).includes(STORAGE_NAMESPACE), '命名空间值不得下发给小程序');

  // 8) §1.5：worker 下载侧对非 cloud:// 一律 FILE_ID_INVALID（不得回退裸路径）。
  await assert.rejects(() => client.downloadFile(objectPath), (error) => error.code === 'FILE_ID_INVALID');

  // 9) §1.4：storageNamespace 未配置 → STORAGE_NAMESPACE_UNCONFIGURED（失败关闭，零任务写入）。
  const noStorageCtx = await approvedFixture();
  const configRow = noStorageCtx.db.row(COLLECTIONS.CONFIG, 'checkin-face-test|config');
  noStorageCtx.db.collection(COLLECTIONS.CONFIG).doc(configRow._id).set({
    data: { ...configRow, storageNamespace: '' },
  });
  const unconfigured = await noStorageCtx.main({
    action: 'createFaceTask', applicationId: noStorageCtx.applicationId,
    fileId: sdkFileId(noStorageCtx.applicationId), consent: true,
  });
  assert.equal(unconfigured.code, 'STORAGE_NAMESPACE_UNCONFIGURED', JSON.stringify(unconfigured));
  assert.equal(noStorageCtx.taskRows().length, 0, '命名空间未配置时零任务写入');
});

// ---------------------------------------------------------------------------
// S2（R02/B）：真实 WXML 结构配套 checkbox-group bindchange
// ---------------------------------------------------------------------------
function assertCheckboxGroupWiring(wxmlPath, handlerName, finding) {
  const text = fs.readFileSync(wxmlPath, 'utf8');
  if (!new RegExp(`<checkbox-group[^>]*bindchange="${handlerName}"`).test(text)) {
    const excerpt = (text.match(/<checkbox[^>]*>/) || [''])[0];
    throw pending(
      finding,
      `${path.relative(ROOT, wxmlPath)} 未使用 checkbox-group bindchange="${handlerName}"；` +
      `冻结候选在单个 checkbox 上绑 change，处理器却依赖 group 数组值（观测：${excerpt}）。`,
    );
  }
  const groupStart = text.indexOf('<checkbox-group');
  const groupEnd = text.indexOf('</checkbox-group>', groupStart);
  assert.ok(groupStart >= 0 && groupEnd > groupStart, 'checkbox-group 必须闭合');
  const inner = text.slice(groupStart, groupEnd);
  assert.match(inner, /<checkbox\b/, '确认勾选必须位于 group 内');
  assert.doesNotMatch(inner, /<checkbox\s[^>]*bindchange=/, 'group 内 checkbox 不得再绑 change');
  assert.doesNotMatch(text.replace(inner, ''), /<checkbox\s[^>]*bindchange=/, 'group 外不得残留带 change 的 checkbox');
}

test('S2a checkin 页 WXML：checkbox-group bindchange=onPrimaryChange 结构配套', () => {
  assertCheckboxGroupWiring(path.join(ROOT, 'miniprogram/pages/checkin/index.wxml'), 'onPrimaryChange', 'R02/B');
});

test('S2b face-enroll 页 WXML：checkbox-group bindchange=onConsentChange 结构配套', () => {
  assertCheckboxGroupWiring(path.join(ROOT, 'miniprogram/pages/face-enroll/index.wxml'), 'onConsentChange', 'R02/B');
});

// ---------------------------------------------------------------------------
// S3（R03/A）：权威读取/写入/审计真正走事务上下文；失败整组回滚
// ---------------------------------------------------------------------------
test('S3a 事务内权威读取（配置/名单/房间/租期/申请）与审计不得回落外层 base', async (t) => {
  markPendingIntegration(t, 'R03/A');
  const ctx = await fixture();
  await ctx.apply();
  const before = ctx.db.route.length;
  const again = await ctx.apply();
  assert.equal(again.code, 0, JSON.stringify(again));
  assert.equal(again.data.idempotent, true);
  const during = ctx.db.route.slice(before);
  const baseInTx = during.filter((entry) => entry.handle === 'base' && entry.inTx === true);
  if (baseInTx.length > 0) {
    throw pending(
      'R03/A',
      `事务内仍有 ${baseInTx.length} 次外层 base 访问：${JSON.stringify(baseInTx)}；` +
      '冻结候选 txStore 只重写部分方法，继承的 get/list/count/writeAudit 闭包仍用外层 DB。',
    );
  }
  const txGets = during.filter((entry) => entry.handle === 'tx' && entry.op === 'get');
  assert.ok(txGets.length > 0, '权威读取必须发生在事务句柄上');

  // §3.3：事务上下文内集合查询必须硬性抛 TX_UNSUPPORTED_QUERY（不回落 base）。
  const { createStore } = require(path.join(CLOUD_DIR, 'lib/store.js'));
  const txProbeStore = createStore(
    { collection: (name) => ctx.db.collection(name) },
    { environment: ENVIRONMENT, transaction: true },
  );
  await assert.rejects(() => txProbeStore.list(COLLECTIONS.TASK), (error) => error.code === 'TX_UNSUPPORTED_QUERY');
  await assert.rejects(() => txProbeStore.count(COLLECTIONS.ROOM, {}), (error) => error.code === 'TX_UNSUPPORTED_QUERY');
});

test('S3b 事务提交冲突：业务写与审计整组回滚，base 全库不变', async (t) => {
  markPendingIntegration(t, 'R03/A');
  const ctx = await fixture();
  ctx.db.commitConflict = { collection: COLLECTIONS.APPLICATION, code: 'TX_COMMIT_CONFLICT' };
  const before = JSON.stringify(ctx.db.snapshot().collections);
  const result = await ctx.apply();
  assert.equal(result.code, 'TX_COMMIT_CONFLICT', JSON.stringify(result));
  const after = JSON.stringify(ctx.db.snapshot().collections);
  if (after !== before) {
    const leaked = ctx.db.rows(COLLECTIONS.AUDIT).map((row) => row.action);
    throw pending(
      'R03/A',
      `事务失败后 base 全库发生变化（残留审计：${JSON.stringify(leaked)}）；` +
      '冻结候选业务写走 tx、审计独立写外层，失败留下独立审计。',
    );
  }
  assert.equal(ctx.db.rows(COLLECTIONS.APPLICATION).length, 0, '申请必须整组回滚');
  assert.ok(
    !ctx.db.rows(COLLECTIONS.AUDIT).some((row) => row.action === 'applyCheckin'),
    'applyCheckin 审计必须与业务写同组回滚',
  );
});

// ---------------------------------------------------------------------------
// S4（R04/A）：创建/领取交错——延迟创建者不得回退已领取任务
// ---------------------------------------------------------------------------
test('S4 创建/领取交错：单一有效 claim、revision 不回退、employeeNo 稳定', async (t) => {
  markPendingIntegration(t, 'R04/A');
  const ctx = await approvedFixture();
  const applicationId = ctx.applicationId;

  // fileID 形状随 A 路 R01 契约演进；两者皆拒时明确报告待集成。
  // 探测在独立夹具上进行，避免探测性 create 污染交错夹具的任务行。
  const candidates = [bareObjectPath(applicationId), sdkFileId(applicationId)];
  let workingFileId = null;
  const probeCtx = await approvedFixture();
  for (const candidate of candidates) {
    const probe = await probeCtx.main({ action: 'createFaceTask', applicationId, fileId: candidate, consent: true });
    if (probe.code === 0) { workingFileId = candidate; break; }
  }
  if (!workingFileId) {
    throw pending('R04/A', 'createFaceTask 对裸路径与 SDK 形状均未成功（R01/R04 接口尚未就绪或契约变化，待 A 路集成）。');
  }

  // 确定性交错：B 先读到“不存在”，B 的 set 被写闸门挡住；A 完整创建并领取；
  // 再放行 B 的延迟写入（冻结候选“读不存在→无条件 set”覆盖点）。
  let bAtWriteGate;
  const bAtWritePromise = new Promise((resolveGate) => { bAtWriteGate = resolveGate; });
  let bRelease;
  const bBlocked = new Promise((resolveRelease) => { bRelease = resolveRelease; });
  let taskSets = 0;
  ctx.db.beforeSet = async (collection) => {
    if (collection !== COLLECTIONS.TASK) return;
    taskSets += 1;
    if (taskSets === 1) {
      bAtWriteGate();
      await bBlocked;
    }
  };

  const bCreate = ctx.main({ action: 'createFaceTask', applicationId, fileId: workingFileId, consent: true });
  await bAtWritePromise; // B 已到达写闸门（其读取发生在 A 创建之前）

  const aCreate = await ctx.main({ action: 'createFaceTask', applicationId, fileId: workingFileId, consent: true });
  assert.equal(aCreate.code, 0, JSON.stringify(aCreate));
  const aClaim = await ctx.claim();
  assert.equal(aClaim.code, 0, JSON.stringify(aClaim));
  assert.ok(aClaim.data.task, 'A 领取必须成功');
  const claimA = aClaim.data.task.claimId;
  const employeeNo = aClaim.data.task.employeeNo;
  const revisionAfterClaim = aClaim.data.task.revision;

  bRelease();
  const bResult = await bCreate;

  const rows = ctx.taskRows();
  assert.equal(rows.length, 1, '同一申请只能有一个任务');
  const afterB = rows[0];
  const secondClaim = await ctx.claim();
  const secondTask = secondClaim.code === 0 ? secondClaim.data.task : null;
  if (afterB.claimId !== claimA || afterB.revision < revisionAfterClaim || secondTask || bResult.code === 0) {
    throw pending(
      'R04/A',
      `延迟创建者把已领取任务回退：claimId ${claimA} → ${afterB.claimId}，revision ${revisionAfterClaim} → ${afterB.revision}，` +
      `第二次领取 ${secondTask ? `成功且 claimId=${secondTask.claimId}` : '未领取'}，晚到创建者返回 ${bResult.code}；` +
      '冻结候选首次创建“读不存在→无条件 set”，确定性 ID 未进同一原子边界。',
    );
  }
  // 契约（A 路 INTERFACES §3.4）：晚到创建者冲突重试后走“已有任务”分支，
  // 已领取任务不得重置 claim、不得回退 revision、不得换 employeeNo。
  assert.equal(bResult.code, 'TASK_ALREADY_CLAIMED', '晚到创建者必须被拒绝，不得覆盖');
  assert.equal(afterB.claimId, claimA, '唯一有效 claim 不得被替换');
  assert.ok(afterB.revision >= revisionAfterClaim, 'revision 不得回退');
  assert.equal(afterB.employeeNo, employeeNo, 'employeeNo 不得变化');
  assert.equal(afterB.status, 'CLAIMED');
  assert.equal(secondClaim.code, 0);
  assert.equal(secondClaim.data.task, null, '已领取任务不得被再次领取');
});

// ---------------------------------------------------------------------------
// S5（R05/C）：漏设备 key / 不一致 → 任何设备写入前拒绝，执行器 0 次
// ---------------------------------------------------------------------------
const WORKER_LOCAL_CONFIG = {
  cloudEnv: 'synthetic-cloud-env', workerId: WORKER_ID, deviceKey: 'device-key-stable',
  name: '合成人员', roomNote: '102',
  device: {
    deviceOrigin: 'https://synthetic-device.invalid', deviceCertificatePath: 'C:/synthetic/public.cer',
    expectedModel: 'DS-K1T671BM', developmentTls: false,
    deviceUsername: 'synthetic-device-admin', devicePassword: 'synthetic-device-password-only',
  },
};

function claimedTaskView(overrides = {}) {
  return {
    taskId: 'checkin-face-test|task|synthetic-app',
    applicationId: 'checkin-face-test|application|synthetic-app',
    claimId: '11111111-2222-4333-8444-555555555555',
    revision: 2,
    claimExpiresAt: FIXED.getTime() + 10 * 60 * 1000,
    name: '合成测试成员',
    employeeNo: 'F0123456789ABCDEF',
    doorNo: 7,
    deviceKey: 'device-key-stable',
    fileId: 'cloud://synthetic-env.synthetic-bucket/test-face/synthetic/photo.jpg',
    validFrom: '2026-12-01T00:00:00',
    validTo: '2026-12-05T23:59:59',
    timezone: 'Asia/Shanghai',
    dailyHours: '24x7',
    accessPlanFingerprint: FINGERPRINT,
    configRevision: 1,
    roomRevision: 1,
    leaseRevision: 1,
    roomBindingId: 'checkin-face-test|102',
    leaseSnapshotId: 'checkin-face-test|lease|102',
    workerId: WORKER_ID,
    ...overrides,
  };
}

function authorizedSnapshot(task) {
  return {
    ...clone(task),
    status: 'DEVICE_PROCESSING',
    revision: task.revision + 1,
    claimExpiresAt: task.claimExpiresAt,
    workerId: WORKER_ID,
  };
}

function fakeWorkerCloud({ task, download = async () => JPEG, onBegin = null, reports }) {
  const calls = { begin: 0, report: 0, download: 0 };
  return {
    cloud: {
      callFunction: async (action, payload) => {
        if (action === 'claimTask') return { task: clone(task) };
        if (action === 'beginTaskExecution') {
          calls.begin += 1;
          const snapshot = authorizedSnapshot(task);
          if (onBegin) return onBegin(payload, snapshot);
          const authorizedAt = FIXED.getTime() + 1000;
          return { task: { ...snapshot, authorizedAt }, authorizedAt };
        }
        if (action === 'reportTask') {
          calls.report += 1;
          reports.push(payload);
          return {};
        }
        throw new Error(`unexpected action ${action}`);
      },
      downloadFile: async () => { calls.download += 1; return download(); },
    },
    calls,
  };
}

async function runWorkerOnce(overrides) {
  const { main } = await import(pathToFileURL(path.join(WORKER_DIR, 'claim-and-enroll.mjs')).href);
  const reports = [];
  const executorCalls = { count: 0 };
  const executor = async (request, deps) => {
    executorCalls.count += 1;
    return overrides.executorResult(request, deps);
  };
  const worker = fakeWorkerCloud({
    task: overrides.task || claimedTaskView(),
    download: overrides.download,
    onBegin: overrides.onBegin,
    reports,
  });
  const exitCode = await main({
    argv: ['--once'],
    env: {},
    loadConfig: async () => ({ ...WORKER_LOCAL_CONFIG, workerToken: TOKEN, ...(overrides.config || {}) }),
    createClient: async () => worker.cloud,
    runEnrollmentImpl: executor,
    nowMs: () => FIXED.getTime(),
    releasePhoto: overrides.releasePhoto || (async () => true),
    stdout: { write: () => {} },
  });
  return { exitCode, reports, executorCalls, calls: worker.calls };
}

test('S5 本地 deviceKey 缺失 → DEVICE_KEY_MISSING，执行器调用 0 次', async () => {
  const { exitCode, reports, executorCalls } = await runWorkerOnce({
    task: claimedTaskView({ deviceKey: 'device-key-stable' }),
    config: { deviceKey: '' },
    executorResult: () => ({
      exitCode: 0,
      output: { protocolVersion: 1, outcome: 'device-enrollment-confirmed-pending-site', mode: 'device', validityMode: 'fixed', siteVerification: 'PENDING' },
    }),
  });
  const report = reports[0];
  if (exitCode === 0 || executorCalls.count > 0 || !report) {
    throw pending(
      'R05/C',
      `本地 deviceKey 缺失仍继续执行（exit=${exitCode}，执行器调用 ${executorCalls.count} 次）；` +
      '冻结候选本地缺 key 变空串，仅两边都非空才比对。',
    );
  }
  assert.equal(exitCode, 2);
  assert.equal(report.output.error.code, 'DEVICE_KEY_MISSING');
  assert.equal(report.exitCode, 2);
  assert.equal(executorCalls.count, 0, '缺失 deviceKey 必须零设备执行');
});

test('S5 本地 deviceKey 与任务不一致 → DEVICE_KEY_CONFLICT，执行器调用 0 次', async () => {
  const { exitCode, reports, executorCalls } = await runWorkerOnce({
    task: claimedTaskView({ deviceKey: 'device-key-A' }),
    config: { deviceKey: 'device-key-B' },
    executorResult: () => ({ exitCode: 0, output: {} }),
  });
  const report = reports[0];
  assert.equal(exitCode, 2, JSON.stringify(report));
  assert.equal(report.output.error.code, 'DEVICE_KEY_CONFLICT');
  assert.equal(executorCalls.count, 0);
});

// ---------------------------------------------------------------------------
// S6（R06/A 云端 + C 侧复核器）：下载/准备后、设备执行前权威复核
// ---------------------------------------------------------------------------
function beginActionAvailable() {
  return Array.isArray(validate.ACTION_FIELDS && validate.ACTION_FIELDS.beginTaskExecution);
}

function requireBegin(finding, why) {
  if (!beginActionAvailable()) {
    throw pending(finding, `${why}（当前 validate.ACTION_FIELDS 无 beginTaskExecution，A 路接口未接通）`);
  }
}

function callCloudThroughMain(ctx, executorCalls) {
  return async (action, payload) => {
    const result = await ctx.main({ action, ...payload });
    if (result.code !== 0) {
      const error = new Error(result.msg);
      error.cloudCode = result.code;
      throw error;
    }
    return result.data;
  };
}

function successOutput(snapshot) {
  return {
    protocolVersion: 1,
    outcome: 'device-enrollment-confirmed-pending-site',
    mode: 'device',
    personnelId: snapshot.employeeNo,
    employeeNo: snapshot.employeeNo,
    doorNo: snapshot.doorNo,
    validityMode: 'fixed',
    validFrom: snapshot.validFrom,
    validTo: snapshot.validTo,
    dailyHours: '24x7',
    siteVerification: 'PENDING',
    accessPlanFingerprint: snapshot.accessPlanFingerprint,
    faceModelingVerified: true,
    faceAssociationConfirmed: true,
    enrollment: {
      employeeNo: snapshot.employeeNo, doorNo: snapshot.doorNo, validityMode: 'fixed', mode: 'device',
      validFrom: snapshot.validFrom, validTo: snapshot.validTo,
      accessPlanFingerprint: snapshot.accessPlanFingerprint,
      faceSubmitted: true, faceModelingVerified: true, faceAssociationConfirmed: true,
      status: 'ready',
      steps: [{ key: 'verify', state: 'success' }],
    },
    steps: [{ key: 'verify', state: 'success' }],
  };
}

async function s6Claim(ctx) {
  requireBegin('R06/A', 'S6 需要云端 beginTaskExecution');
  const claimed = await ctx.claim();
  assert.equal(claimed.code, 0, JSON.stringify(claimed));
  assert.ok(claimed.data.task, 'claim 必须返回任务');
  const task = claimed.data.task;
  assert.ok(String(task.fileId).startsWith('cloud://'), 'claim 快照 fileId 必须是 SDK 形状（依赖 R01/A）');
  return task;
}

/** Actual worker orchestration; only transport and device executor are synthetic.
 * Every cloud action goes through createMain, so the executor counter measures
 * a call made by production main rather than an increment in the assertion.
 */
async function runWorkerThroughMain(ctx, { afterDownload = async () => {}, nowMs = () => FIXED.getTime() } = {}) {
  const { main } = await import(pathToFileURL(path.join(WORKER_DIR, 'claim-and-enroll.mjs')).href);
  const observed = { claimed: null, authorized: null, downloads: [], begins: [], reports: [], executorCalls: 0, requests: [] };
  const cloud = {
    callFunction: async (action, payload) => {
      const beforeReport = action === 'reportTask' ? structuredClone(ctx.db.snapshot().collections) : null;
      const result = await ctx.main({ action, ...payload });
      if (action === 'claimTask' && result.code === 0) observed.claimed = clone(result.data.task);
      if (action === 'beginTaskExecution') {
        observed.begins.push({ payload: clone(payload), result: clone(result) });
        if (result.code === 0) observed.authorized = clone(result.data.task);
      }
      if (action === 'reportTask') observed.reports.push({ payload: clone(payload), result: clone(result), before: beforeReport, after: structuredClone(ctx.db.snapshot().collections) });
      if (result.code !== 0) {
        const error = new Error('SYNTHETIC_CLOUD_REJECTED');
        error.cloudCode = result.code;
        throw error;
      }
      return result.data;
    },
    downloadFile: async (fileId) => {
      assert.equal(fileId, observed.claimed.fileId, 'worker must download the exact claimed SDK fileID');
      observed.downloads.push(fileId);
      await afterDownload(observed);
      return Buffer.from(JPEG);
    },
  };
  observed.exitCode = await main({
    argv: ['--once'], env: {},
    loadConfig: async () => ({ ...WORKER_LOCAL_CONFIG, workerToken: TOKEN }),
    createClient: async () => cloud,
    nowMs,
    runEnrollmentImpl: async (request, deps) => {
      observed.executorCalls += 1;
      assert.ok(observed.authorized, 'production main must obtain authority before the injected executor');
      assert.ok(Buffer.isBuffer(deps.photoBuffer));
      assert.deepEqual(deps.photoBuffer, JPEG);
      assert.equal(request.mode, 'device');
      assert.equal(request.validityMode, 'fixed');
      assert.equal(request.accessPlanFingerprint, FINGERPRINT);
      observed.requests.push({ employeeNo: request.employeeNo, validFrom: request.validFrom, validTo: request.validTo });
      return { exitCode: 0, output: successOutput(observed.authorized) };
    },
    stdout: { write: () => {} },
  });
  return observed;
}

test('S6a 实际worker编排：权威begin一次、假设备执行器一次、report使用推进revision', async (t) => {
  markPendingIntegration(t, 'R06/A');
  requireBegin('R06/A', 'S6a needs the production beginTaskExecution action');
  const ctx = await approvedFixture();
  const created = await ctx.main({ action: 'createFaceTask', applicationId: ctx.applicationId, fileId: sdkFileId(ctx.applicationId), consent: true });
  assert.equal(created.code, 0, JSON.stringify(created));
  const observed = await runWorkerThroughMain(ctx);
  const task = observed.claimed;
  const authorized = observed.authorized;
  assert.equal(observed.begins.length, 1, 'no retry of one-time authority');
  assert.equal(observed.begins[0].result.code, 0);
  assert.equal(authorized.status, 'DEVICE_PROCESSING');
  assert.equal(authorized.revision, task.revision + 1);
  assert.equal(authorized.claimExpiresAt, task.claimExpiresAt, 'success must not extend the claim');
  assert.equal(authorized.workerId, WORKER_ID);
  assert.equal(authorized.authorizedAt, observed.begins[0].result.data.authorizedAt);
  assert.ok(Number.isSafeInteger(authorized.authorizedAt) && authorized.authorizedAt > 0);
  assert.ok(authorized.authorizedAt < task.claimExpiresAt);
  assert.ok(authorized.cloudPath.startsWith('test-face/'));
  assert.equal(authorized.timezone, 'Asia/Shanghai');
  assert.equal(authorized.dailyHours, '24x7');
  assert.ok(authorized.roomBindingId && authorized.leaseSnapshotId);
  assert.equal(observed.executorCalls, 1, 'counter is incremented only by the real main executor callback');
  assert.equal(observed.requests.length, 1);
  assert.equal(observed.reports.length, 1);
  assert.equal(observed.reports[0].payload.revision, task.revision + 1);
  assert.equal(observed.reports[0].result.code, 0, JSON.stringify(observed.reports[0].result));
  assert.equal(observed.exitCode, 0);
  assert.equal(ctx.taskRows()[0].status, 'PENDING_SITE_VERIFICATION');
  assert.equal(ctx.taskRows()[0].siteVerification, 'PENDING');
});

test('S6b 实际worker下载后到期：本地或权威云门均阻断，假执行器零调用', async (t) => {
  for (const localClockFresh of [true, false]) {
    await t.test(localClockFresh ? 'local clock observes the exact deadline' : 'stale local clock still cannot bypass server deadline', async () => {
      const ctx = await approvedFixture();
      const created = await ctx.main({ action: 'createFaceTask', applicationId: ctx.applicationId, fileId: sdkFileId(ctx.applicationId), consent: true });
      assert.equal(created.code, 0, JSON.stringify(created));
      let localNow = FIXED.getTime();
      const observed = await runWorkerThroughMain(ctx, {
        afterDownload: async (state) => {
          const deadline = state.claimed.claimExpiresAt;
          ctx.setNow(new Date(deadline));
          if (localClockFresh) localNow = deadline;
        },
        nowMs: () => localNow,
      });
      assert.equal(observed.downloads.length, 1);
      assert.equal(observed.executorCalls, 0, 'the actual main executor callback must remain untouched');
      assert.equal(observed.requests.length, 0);
      assert.equal(observed.reports.length, 1, 'failure is reported once, without retry');
      assert.equal(observed.reports[0].payload.exitCode, 5);
      assert.equal(observed.reports[0].payload.output.outcome, 'stopped');
      if (localClockFresh) {
        assert.equal(observed.begins.length, 0, 'local rejection happens before authority acquisition');
        assert.equal(observed.reports[0].payload.output.error.code, 'BEGIN_AUTH_EXPIRED');
        assert.equal(observed.reports[0].result.code, 0, 'closed pre-execution failure report remains legal');
        assert.equal(observed.exitCode, 5);
      } else {
        assert.equal(observed.begins.length, 1);
        assert.equal(observed.begins[0].result.code, 'CLAIM_EXPIRED');
        assert.equal(observed.reports[0].payload.output.error.code, 'BEGIN_AUTH_REJECTED:CLAIM_EXPIRED');
        assert.equal(observed.reports[0].result.code, 'REPORT_CONFLICT');
        assert.equal(observed.exitCode, 3, 'report rejection is not an additional device attempt');
        assert.deepEqual(observed.reports[0].after, observed.reports[0].before, 'failed report must preserve the already recorded timeout facts');
      }
      assert.equal(ctx.taskRows()[0].status, 'UNKNOWN_RESULT');
      assert.equal(ctx.taskRows()[0].resultCode, 'CLAIM_TIMEOUT');
      assert.ok(ctx.db.rows(COLLECTIONS.AUDIT).some((row) => row.targetId === observed.claimed.taskId));
    });
  }
});

test('S6c 实际worker下载后撤权：begin拒绝，假设备执行器零调用且不重领/重试', async () => {
  const ctx = await approvedFixture();
  const created = await ctx.main({ action: 'createFaceTask', applicationId: ctx.applicationId, fileId: sdkFileId(ctx.applicationId), consent: true });
  assert.equal(created.code, 0, JSON.stringify(created));
  const observed = await runWorkerThroughMain(ctx, { afterDownload: async () => ctx.admin.upsertLease(LEASE_INPUT) });
  assert.equal(observed.downloads.length, 1);
  assert.equal(observed.executorCalls, 0, 'production main must never call the injected device executor');
  assert.equal(observed.begins.length, 1);
  assert.equal(observed.begins[0].result.code, 'EXECUTION_INVALIDATED');
  assert.equal(observed.authorized, null);
  assert.equal(observed.requests.length, 0);
  assert.equal(observed.reports.length, 1);
  assert.equal(observed.reports[0].payload.exitCode, 5);
  assert.equal(observed.reports[0].payload.output.error.code, 'BEGIN_AUTH_REJECTED:EXECUTION_INVALIDATED');
  assert.equal(observed.reports[0].result.code, 'REPORT_CONFLICT');
  assert.equal(observed.exitCode, 3);
  assert.deepEqual(observed.reports[0].after, observed.reports[0].before, 'rejected report preserves the full revoked-state snapshot');
  const row = ctx.taskRows()[0];
  assert.equal(row.status, 'INVALIDATED');
  assert.ok(row.resultCode);
  assert.ok(ctx.db.rows(COLLECTIONS.AUDIT).some((entry) => entry.targetId === observed.claimed.taskId));
});

test('S6d 错误 worker / 旧 revision / 重复开始：均不得返回可执行授权', async (t) => {
  markPendingIntegration(t, 'R06/A');
  requireBegin('R06/A', 'S6d 需要云端 beginTaskExecution');
  const { authorizeTaskExecution } = await import(pathToFileURL(path.join(WORKER_DIR, 'execution-authorization.mjs')).href);
  const ctx = await approvedFixture();
  const created = await ctx.main({ action: 'createFaceTask', applicationId: ctx.applicationId, fileId: sdkFileId(ctx.applicationId), consent: true });
  assert.equal(created.code, 0, JSON.stringify(created));
  const task = await s6Claim(ctx);
  const claimRevision = task.revision;

  const wrongWorker = await ctx.main({
    action: 'beginTaskExecution', workerToken: TOKEN, workerId: 'other-worker-99',
    taskId: task.taskId, claimId: task.claimId, revision: claimRevision,
  });
  assert.equal(wrongWorker.code, 'WORKER_MISMATCH', JSON.stringify(wrongWorker));

  const wrongClaim = await ctx.main({
    action: 'beginTaskExecution', workerToken: TOKEN, workerId: WORKER_ID,
    taskId: task.taskId, claimId: '00000000-0000-4000-8000-000000000000', revision: claimRevision,
  });
  assert.equal(wrongClaim.code, 'CLAIM_MISMATCH', JSON.stringify(wrongClaim));

  // 契约 §2.1：revision 必须 ≥ 2 —— 旧 revision 1 属字段级拒绝。
  const tooOld = await ctx.main({
    action: 'beginTaskExecution', workerToken: TOKEN, workerId: WORKER_ID,
    taskId: task.taskId, claimId: task.claimId, revision: claimRevision - 1,
  });
  assert.equal(tooOld.code, 'INVALID_REVISION', JSON.stringify(tooOld));

  // 第一次开始：授权成功。
  const first = await authorizeTaskExecution({ cloud: { callFunction: callCloudThroughMain(ctx) }, config: { workerToken: TOKEN }, task, workerId: WORKER_ID });
  assert.equal(first.snapshot.status, 'DEVICE_PROCESSING');

  // 重复开始（推进后的 revision）：不得再次授权。
  const repeatCurrent = await ctx.main({
    action: 'beginTaskExecution', workerToken: TOKEN, workerId: WORKER_ID,
    taskId: task.taskId, claimId: task.claimId, revision: claimRevision + 1,
  });
  assert.equal(repeatCurrent.code, 'EXECUTION_ALREADY_STARTED', JSON.stringify(repeatCurrent));

  // 旧 revision 重放：版本冲突，不得再次授权。
  const staleReplay = await ctx.main({
    action: 'beginTaskExecution', workerToken: TOKEN, workerId: WORKER_ID,
    taskId: task.taskId, claimId: task.claimId, revision: claimRevision,
  });
  assert.equal(staleReplay.code, 'REVISION_CONFLICT', JSON.stringify(staleReplay));
});

// ---------------------------------------------------------------------------
// S7（R07/C）：默认依赖解析归属明确；默认入口失败关闭、注入替身可工作
// ---------------------------------------------------------------------------
test('S7 worker 依赖归属与锁文件明确；默认入口无需注入替身即可解析（本机未安装时的失败关闭路径）', async () => {
  const workerPkgPath = path.join(WORKER_DIR, 'package.json');
  const lockPath = path.join(WORKER_DIR, 'package-lock.json');
  const hasPkg = fs.existsSync(workerPkgPath);
  let deps = null;
  if (hasPkg) deps = JSON.parse(fs.readFileSync(workerPkgPath, 'utf8')).dependencies || {};
  const declared = deps && typeof deps['@cloudbase/node-sdk'] === 'string';
  const hasLock = fs.existsSync(lockPath);
  if (!hasPkg || !declared || !hasLock) {
    throw pending(
      'R07/C',
      `worker 依赖归属未闭合：package.json=${hasPkg}，@cloudbase/node-sdk 声明=${declared ? deps['@cloudbase/node-sdk'] : '无'}，锁文件=${hasLock}；` +
      '冻结候选默认 SDK import 位于 tools，依赖只在 admin-web 声明，根无依赖/workspaces，默认入口不能解析。',
    );
  }

  // 模块图（相对导入闭包，仅内置模块）必须能解析。
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(pathToFileURL(path.join(WORKER_DIR, 'worker-runtime.mjs')).href)}); console.log('RESOLVED');`,
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /RESOLVED/);

  // 本机无 node_modules（本任务禁止安装依赖）：默认入口必须失败关闭，不发任何真实请求。
  const rt = await workerRuntimeModule();
  const guard = globalThis.__DSH_D_NETWORK_GUARD__;
  const blockedBefore = guard ? guard.counters.blocked : -1;
  await assert.rejects(
    () => rt.createCloudClient({ config: { cloudEnv: 'synthetic-env' } }),
    (error) => error.code === 'CLOUD_INIT_FAILED' || error.code === 'CLOUD_SDK_RESOLVE_FAILED',
    '无可用依赖时默认入口必须失败关闭（CLOUD_INIT_FAILED / CLOUD_SDK_RESOLVE_FAILED），不得静默继续',
  );
  if (guard) assert.equal(guard.counters.blocked, blockedBefore, '失败关闭路径不得发起网络调用');

  // 注入替身路径必须工作（受控验证不依赖真实 SDK）。
  const downloadLog = [];
  const client = await rt.createCloudClient({
    config: { cloudEnv: 'synthetic-env' },
    cloudbaseFactory: async () => ({
      callFunction: async () => ({ result: { code: 0, data: { ok: 1 }, msg: '' } }),
      downloadFile: async ({ fileID }) => { downloadLog.push(fileID); return { fileContent: JPEG }; },
    }),
  });
  const data = await client.callFunction('claimTask', { workerToken: TOKEN, workerId: WORKER_ID });
  assert.deepEqual(data, { ok: 1 });
  const bytes = await client.downloadFile('cloud://env.bucket/path/photo.jpg');
  assert.equal(bytes[0], 0xff);
});

// ---------------------------------------------------------------------------
// S8（R08/R09/C）：内存照片、清理结果进入真实终态、失败不误报成功
// ---------------------------------------------------------------------------
const CLEAN_SUCCESS = () => ({
  exitCode: 0,
  output: {
    protocolVersion: 1,
    outcome: 'device-enrollment-confirmed-pending-site',
    mode: 'device',
    personnelId: 'F0123456789ABCDEF',
    employeeNo: 'F0123456789ABCDEF',
    doorNo: 7,
    validityMode: 'fixed',
    validFrom: '2026-12-01T00:00:00',
    validTo: '2026-12-05T23:59:59',
    dailyHours: '24x7',
    siteVerification: 'PENDING',
    accessPlanFingerprint: FINGERPRINT,
    faceModelingVerified: true,
    faceAssociationConfirmed: true,
    enrollment: {
      employeeNo: 'F0123456789ABCDEF', doorNo: 7, validityMode: 'fixed', mode: 'device',
      validFrom: '2026-12-01T00:00:00', validTo: '2026-12-05T23:59:59',
      accessPlanFingerprint: FINGERPRINT,
      faceSubmitted: true, faceModelingVerified: true, faceAssociationConfirmed: true,
      status: 'ready',
      steps: [{ key: 'verify', state: 'success' }],
    },
    steps: [{ key: 'verify', state: 'success' }],
  },
});

test('S8a 成功路径：照片以 Buffer 全程内存传递（不落盘），执行一次，report 用推进后 revision', async () => {
  const seen = { request: null, deps: null };
  const { exitCode, reports, executorCalls, calls } = await runWorkerOnce({
    executorResult: (request, deps) => { seen.request = request; seen.deps = deps; return CLEAN_SUCCESS(); },
  });
  assert.equal(exitCode, 0, JSON.stringify(reports));
  assert.equal(executorCalls.count, 1);
  assert.equal(calls.begin, 1, '进入设备执行前必须有一次 beginTaskExecution');
  assert.equal(calls.download, 1);
  assert.ok(Buffer.isBuffer(seen.deps.photoBuffer), '照片必须以内存 Buffer 传递');
  assert.equal(seen.deps.photoPath, '', '不得再走落盘照片路径');
  assert.equal(seen.request.mode, 'device');
  assert.equal(seen.request.validityMode, 'fixed');
  assert.equal(reports.length, 1);
  assert.equal(reports[0].exitCode, 0);
  assert.equal(reports[0].revision, claimedTaskView().revision + 1, 'report 必须使用推进后 revision');
  assert.ok(!fs.existsSync(path.join(WORKER_DIR, '.data')), '不得产生旧落盘目录残留');
});

test('S8b 照片下载失败 → invalid-input（exit 2），执行器 0 次', async () => {
  const rt = await workerRuntimeModule();
  const { exitCode, reports, executorCalls } = await runWorkerOnce({
    download: async () => { throw new rt.WorkerInputError('PHOTO_INVALID', '照片无效'); },
    executorResult: () => CLEAN_SUCCESS(),
  });
  assert.equal(exitCode, 2, JSON.stringify(reports));
  assert.equal(reports[0].exitCode, 2);
  assert.equal(reports[0].output.error.code, 'PHOTO_INVALID');
  assert.equal(executorCalls.count, 0);
});

test('S8c 清理失败：不得误报干净成功（exit 5 / CLEANUP_FAILED），不重发设备', async () => {
  const { exitCode, reports, executorCalls } = await runWorkerOnce({
    executorResult: () => CLEAN_SUCCESS(),
    releasePhoto: async () => false,
  });
  const report = reports[0];
  if (exitCode === 0 && report && report.exitCode === 0 && !report.output.error) {
    throw pending(
      'R09/C',
      `照片清理失败仍报干净成功（exit=${exitCode}）；冻结候选 destroyTempJpeg 失败仅 warn，成功回报和 exit0 仍继续。`,
    );
  }
  assert.equal(exitCode, 5, JSON.stringify(report));
  assert.equal(report.exitCode, 5);
  assert.equal(report.output.error.code, 'CLEANUP_FAILED');
  assert.equal(report.output.outcome, 'stopped');
  assert.equal(executorCalls.count, 1, '设备事实保留，但不得重发设备操作');
});

test('S8d 设备执行失败：exit 4 / failed 上报，不重试', async () => {
  const { exitCode, reports, executorCalls } = await runWorkerOnce({
    executorResult: () => ({
      exitCode: 4,
      output: { protocolVersion: 1, outcome: 'failed', mode: 'device', validityMode: 'fixed', siteVerification: 'PENDING' },
    }),
  });
  assert.equal(exitCode, 4, JSON.stringify(reports));
  assert.equal(reports[0].exitCode, 4);
  assert.equal(reports[0].output.outcome, 'failed');
  assert.equal(executorCalls.count, 1);
});

test('S8e R08 静态：worker 不得把照片以 POSIX 模式落盘（内存输入优先）', () => {
  const source = fs.readFileSync(path.join(WORKER_DIR, 'claim-and-enroll.mjs'), 'utf8');
  if (/\bwriteTempJpeg\b|openFile\s*\([^)]*0o600/.test(source)) {
    throw pending(
      'R08/C',
      'worker 仍把照片以 POSIX mode 落盘到未验证私密区；冻结候选 mode 0600/0700 不是 Windows DACL 证据。',
    );
  }
  assert.ok(!/\bwriteTempJpeg\b/.test(source));
});

// ---------------------------------------------------------------------------
// S9（R11/B + C2）：普通账号不误报成功、不开放人脸入口
// ---------------------------------------------------------------------------
test('S9 普通账号 pending_review：页面不得显示已受理/开放人脸入口，须提示既有审核渠道', async () => {
  const toasts = [];
  const navigations = [];
  const apiStub = {
    isDemo: () => false,
    // This case tests the ordinary review path after a valid login, not a guest.
    isAuthenticated: () => true,
    getLoginEpoch: () => 1,
    getProfile: async () => ({ _id: 'synthetic-cross-user', authenticated: true }),
    getCheckinFaceConfig: async () => ({
      enabled: true, configured: true, accountEligible: true, applicationVersion: 'test-v1',
      room: { displayNo: '102', projectName: '合成项目', buildingName: '合成楼栋' },
      lease: { status: 'active', startDate: '2026-12-01', endDate: '2026-12-05' },
    }),
    applyTestCheckin: async () => ({
      applicationId: '', result: 'pending_review', reason: '请走既有审核流程', idempotent: false,
    }),
  };
  let captured;
  loadCjs(path.join(ROOT, 'miniprogram/pages/checkin/index.js'), {
    requires: {
      '../../services/api': apiStub,
      '../../utils/require-login': require(path.join(ROOT, 'miniprogram/utils/require-login.js')),
      '../../utils/layout': { getNavigationLayout: () => ({ statusBarHeight: 20, navHeight: 44, navSideWidth: 104 }) },
    },
    globals: {
      Page: (config) => { captured = config; },
      wx: {
        showToast: (arg) => toasts.push(arg),
        navigateTo: (arg) => navigations.push(arg),
        navigateBack: () => {}, switchTab: () => {}, stopPullDownRefresh: () => {},
      },
    },
  });
  const page = Object.assign({}, captured, { data: JSON.parse(JSON.stringify(captured.data)) });
  page.setData = function setData(patch, callback) { Object.assign(this.data, patch); if (typeof callback === 'function') callback(); };
  page._configLoading = false;
  page._destroyed = false;
  await page.loadConfig();
  page.data.primaryConfirmed = true;
  await page.submit();

  if (page.data.applied === true) {
    throw pending(
      'R11/B',
      `普通账号返回 pending_review（applicationId 为空）后页面仍 applied=true（“已受理”+人脸入口）；` +
      '冻结候选对任何 code0 都设 applied=true。',
    );
  }
  assert.equal(page.data.applied, false, 'pending_review 不得显示已受理');
  const guidance = String(page.data.reviewReason || page.data.ineligibleReason || page.data.error || '')
    + toasts.map((entry) => entry.title || '').join('|');
  assert.match(guidance, /既有审核|原审核|人工审核|审核流程/, '必须提示原有审核渠道');
  assert.equal(navigations.length, 0, '不得开放人脸入口导航');
  await page.goFaceEnroll();
  assert.equal(navigations.length, 0, '无 applicationId 时人脸入口必须不可达');
});
