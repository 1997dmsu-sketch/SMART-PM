'use strict';

/**
 * Fail-closed configuration gates for the isolated test program.
 *
 * The 102 binding is read by its deterministic _id only. Duplicate display
 * numbers are detected with a count query; no code path takes the first row
 * of a displayNo lookup.
 */

const { ids, COLLECTIONS } = require('./store');
const dates = require('./dates');

class WorkflowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
  }
}

const MESSAGES = Object.freeze({
  TEST_DISABLED: '测试入住当前未启用',
  ACCOUNT_NOT_ALLOWED: '当前账号不在测试名单内',
  ROOM_UNCONFIGURED: '102 房间尚未唯一绑定',
  ROOM_NOT_UNIQUE: '102 房间存在多条绑定，未选择任何一条',
  LEASE_UNCONFIGURED: '测试租期尚未配置',
  LEASE_EXPIRED: '测试租期无效或已过期',
  VERSION_MISMATCH: '申请版本与测试配置不一致',
  CONCURRENT_APPLICATION: '已有同名申请正在处理',
  INVALIDATED: '配置或租期已变化，任务已失效',
});

/** @returns {object} default, disabled configuration when no document exists. */
function defaultConfig(environment) {
  return {
    _id: ids.configId(environment),
    environment,
    enabled: false,
    dispatchEnabled: false,
    applicationVersion: '',
    workerTokenHash: '',
    storageNamespace: '',
    revision: 0,
    configured: false,
  };
}

async function loadConfig(store) {
  const doc = await store.get(COLLECTIONS.CONFIG, ids.configId(store.environment));
  if (!doc) return defaultConfig(store.environment);
  return { ...defaultConfig(store.environment), ...doc, configured: true, enabled: doc.enabled === true };
}

async function loadAllowlistEntry(store, openid) {
  return store.get(COLLECTIONS.ALLOWLIST, ids.allowlistId(store.environment, openid));
}

/**
 * Single-point read of the 102 binding, with a uniqueness count that never
 * selects a row. The count is a collection query and therefore unavailable
 * inside a transaction: callers evaluating inside a transaction pass
 * checkUniqueness:false and rely on the deterministic-id point read plus the
 * admin-side write-time count gate (documented in INTERFACES.md §3.3).
 * @param {{get:Function,count:Function,environment:string}} store
 * @param {{checkUniqueness?:boolean}} options
 * @throws {WorkflowError} ROOM_NOT_UNIQUE when duplicates exist (base context).
 */
async function loadRoomBinding(store, { checkUniqueness = true } = {}) {
  const doc = await store.get(COLLECTIONS.ROOM, ids.roomBindingId(store.environment));
  if (!doc || doc.displayNo !== '102' || doc.environment !== store.environment) return null;
  if (checkUniqueness) {
    const duplicates = await store.count(COLLECTIONS.ROOM, { environment: store.environment, displayNo: '102' });
    if (duplicates > 1) throw new WorkflowError('ROOM_NOT_UNIQUE', MESSAGES.ROOM_NOT_UNIQUE);
  }
  return doc;
}

async function loadLease(store) {
  return store.get(COLLECTIONS.LEASE, ids.leaseId(store.environment));
}

function roomView(room) {
  if (!room) return null;
  return {
    displayNo: '102',
    roomId: room.roomId || '',
    houseId: room.houseId || '',
    projectId: room.projectId || '',
    buildingId: room.buildingId || '',
    // Names come only from the admin binding. When the administrator did not
    // enter a name, fall back to the stable id string; never infer a name from
    // displayNo 102 and never fabricate one.
    projectName: room.projectName || room.projectId || '',
    buildingName: room.buildingName || room.buildingId || '',
  };
}

function leaseView(lease) {
  if (!lease) return null;
  return {
    status: lease.status || '',
    startDate: lease.startDate || '',
    endDate: lease.endDate || '',
    validFrom: lease.validFrom || '',
    validTo: lease.validTo || '',
    timezone: dates.TIMEZONE,
    dailyHours: dates.DAILY_HOURS,
  };
}

function failure(code) {
  return { ok: false, code, reason: MESSAGES[code] || code };
}

/**
 * All conditions required for automatic approval of a test account.
 * When `inTransaction` is true only point reads are performed: the room
 * uniqueness count and the concurrent-application query are skipped (the
 * caller runs them as a non-transactional preflight). No query is silently
 * served by the outer DB.
 * @returns {Promise<object>} ok result with trusted snapshots, or a failure code.
 */
async function evaluateApply({ store, openid, applicationVersion, now = new Date(), inTransaction = false }) {
  const config = await loadConfig(store);
  const allowlist = await loadAllowlistEntry(store, openid);
  const accountEligible = !!allowlist && allowlist.status === 'active';
  const base = { config, allowlist, accountEligible };

  if (!accountEligible) return { ...failure('ACCOUNT_NOT_ALLOWED'), ...base };
  if (config.enabled !== true) return { ...failure('TEST_DISABLED'), ...base };
  if (typeof applicationVersion !== 'string' || applicationVersion !== config.applicationVersion) {
    return { ...failure('VERSION_MISMATCH'), ...base };
  }

  let room;
  try { room = await loadRoomBinding(store, { checkUniqueness: !inTransaction }); }
  catch (error) {
    if (error instanceof WorkflowError) return { ...failure(error.code), ...base };
    throw error;
  }
  if (!room) return { ...failure('ROOM_UNCONFIGURED'), ...base };

  const lease = await loadLease(store);
  if (!lease || !dates.isValidWindowSnapshot(lease)) return { ...failure('LEASE_UNCONFIGURED'), ...base };
  if (lease.roomBindingId !== room._id) return { ...failure('ROOM_UNCONFIGURED'), ...base };
  if (lease.status !== 'active' || lease.applicationVersion !== config.applicationVersion
    || !dates.isWithinWindow(lease, now)) return { ...failure('LEASE_EXPIRED'), ...base, room, lease };

  if (!inTransaction) {
    const concurrent = await store.list(COLLECTIONS.APPLICATION, { environment: store.environment, openid });
    const colliding = concurrent.find((row) => row.result !== 'auto_approved'
      && row._id !== ids.applicationId(store.environment, openid, applicationVersion, lease.revision, room.revision));
    if (colliding) return { ...failure('CONCURRENT_APPLICATION'), ...base, room, lease };
  }

  return {
    ok: true,
    code: '',
    reason: '',
    config,
    allowlist,
    accountEligible,
    room,
    lease,
    roomView: roomView(room),
    leaseView: leaseView(lease),
  };
}

/**
 * Re-run every gate before dispatch, before beginning device execution and
 * before finalizing a device report. Point reads only; when run inside a
 * transaction `inTransaction:true` skips the room uniqueness count (see
 * loadRoomBinding).
 * @returns {Promise<object>} ok result with trusted snapshots, or INVALIDATED.
 */
async function evaluateDispatch({ store, task, now = new Date(), inTransaction = false }) {
  const config = await loadConfig(store);
  if (config.enabled !== true || config.dispatchEnabled !== true) return failure('INVALIDATED');
  if (!task || task.configRevision !== config.revision) return failure('INVALIDATED');

  const allowlist = await loadAllowlistEntry(store, task.openid);
  if (!allowlist || allowlist.status !== 'active') return failure('INVALIDATED');

  const application = await store.get(COLLECTIONS.APPLICATION, task.applicationId);
  if (!application || application.openid !== task.openid || application.result !== 'auto_approved'
    || application.applicationVersion !== config.applicationVersion
    || application.leaseRevision !== task.leaseRevision || application.roomRevision !== task.roomRevision
    || application._id !== task.applicationId) return failure('INVALIDATED');

  let room;
  try { room = await loadRoomBinding(store, { checkUniqueness: !inTransaction }); }
  catch { return failure('INVALIDATED'); }
  if (!room || room._id !== task.roomBindingId || room.revision !== task.roomRevision) return failure('INVALIDATED');

  const lease = await store.get(COLLECTIONS.LEASE, ids.leaseId(store.environment));
  if (!lease || lease.revision !== task.leaseRevision || lease._id !== task.leaseSnapshotId
    || lease.status !== 'active' || !dates.isValidWindowSnapshot(lease)
    || !dates.isWithinWindow(lease, now)
    || lease.validFrom !== task.validFrom || lease.validTo !== task.validTo
    || room.doorNo !== task.doorNo) return failure('INVALIDATED');

  return { ok: true, code: '', reason: '', config, allowlist, application, room, lease };
}

module.exports = {
  WorkflowError,
  MESSAGES,
  failure,
  defaultConfig,
  loadConfig,
  loadAllowlistEntry,
  loadRoomBinding,
  loadLease,
  roomView,
  leaseView,
  evaluateApply,
  evaluateDispatch,
};
