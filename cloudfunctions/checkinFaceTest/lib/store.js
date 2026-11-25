'use strict';

/**
 * Cloud database access for the isolated check-in / face-enrollment namespace.
 *
 * Every identifier is deterministic and anchored to the environment prefix,
 * so no caller can select a different room/application/task by supplying an
 * id. The room binding is read by its deterministic _id only; duplicate
 * display numbers are detected with a count query (base context only), never
 * by taking the first row of a query.
 *
 * Transaction contract (R03):
 *  - Inside a transaction only point operations are supported:
 *    doc(id).get() / doc(id).set() / collection.add().
 *  - Collection queries (where/count/collection.get) are NOT supported in a
 *    transaction on wx-server-sdk. A transactional store therefore throws
 *    TX_UNSUPPORTED_QUERY instead of silently falling back to the outer DB.
 *  - writeAudit() and every business write of an atomic path run against the
 *    SAME context object, so a failed commit rolls back business + audit
 *    together. Missing runTransaction support fails closed with
 *    TRANSACTION_UNAVAILABLE; there is no silent serial fallback.
 */

const { randomUUID } = require('node:crypto');

const ENVIRONMENT = 'checkin-face-test';
const COLLECTIONS = Object.freeze({
  CONFIG: 'test_program_config',
  ALLOWLIST: 'test_account_allowlist',
  ROOM: 'test_room_binding_102',
  LEASE: 'test_lease_snapshot',
  APPLICATION: 'test_checkin_application',
  TASK: 'test_face_enrollment_task',
  AUDIT: 'test_checkin_face_audit',
});

/** Build an environment-anchored deterministic document id. */
function docId(environment, ...parts) {
  if (typeof environment !== 'string' || !environment) throw new Error('INVALID_ENVIRONMENT');
  return [environment, ...parts].join('|');
}

const ids = {
  configId: (env) => docId(env, 'config'),
  allowlistId: (env, openid) => docId(env, 'account', openid),
  roomBindingId: (env) => docId(env, '102'),
  leaseId: (env) => docId(env, 'lease', '102'),
  applicationId: (env, openid, applicationVersion, leaseRevision, roomRevision) =>
    docId(env, 'application', openid, applicationVersion, `lease${leaseRevision}`, `room${roomRevision}`),
  taskId: (env, applicationId) => docId(env, 'task', applicationId),
};

/** @returns {boolean} whether an error represents a missing document. */
function isNotFound(error) {
  if (!error) return false;
  const code = error.errCode ?? error.code;
  if (code === -1 || code === 1 || code === 'DOCUMENT_NOT_EXISTS' || code === 'NOT_FOUND') return true;
  return /not\s*found|not\s*exist|不存在|没有找到/i.test(String(error.message || ''));
}

function normalizeStats(result) {
  if (!result || typeof result !== 'object') return 0;
  const stats = result.stats || result;
  return Number(stats.updated ?? stats.updatedCount ?? 0);
}

/** Error helpers used by transactional paths; codes are closed-form. */
function storeError(code, message) {
  return Object.assign(new Error(message || code), { code });
}

/**
 * Create a small async data-access facade over a wx-server-sdk database (or a
 * compatible injected mock). No SDK import happens here so the module can be
 * unit tested and reused by the local admin configuration service.
 *
 * The facade is context-bound: every operation is performed through the exact
 * object passed in (`db`), which is either the base database or a transaction
 * handle. There is no closure that reaches the outer database from a
 * transactional store.
 *
 * @param {object} db injected database handle or transaction handle.
 * @param {{environment?:string,now?:Function,transaction?:boolean}} options
 */
function createStore(db, options = {}) {
  if (!db || typeof db.collection !== 'function') throw new Error('INVALID_DATABASE');
  const environment = options.environment || ENVIRONMENT;
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const inTransaction = options.transaction === true;
  const time = () => {
    const value = now();
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  };

  function stamp(value) {
    return { ...value, environment, updatedAt: time() };
  }

  /** Collection queries are unavailable in transactions; never fall back. */
  function assertQueriesSupported() {
    if (inTransaction) throw storeError('TX_UNSUPPORTED_QUERY', '事务内不支持集合查询');
  }

  /** Point read — supported in both base and transaction contexts. */
  async function getById(collection, id) {
    const docRef = db.collection(collection).doc(id);
    if (!docRef || typeof docRef.get !== 'function') {
      throw storeError('INVALID_DATABASE_CONTEXT', '数据库上下文缺少点读能力');
    }
    const result = await docRef.get();
    return result && result.data ? result.data : null;
  }

  /** Point write — supported in both base and transaction contexts. */
  async function setById(collection, id, value) {
    // 真实云端 SDK 禁止在 set 的 data 中携带 _id（-501007），必须剔除；_id 由 doc(id) 路径决定。
    const { _id, ...rest } = value;
    const data = stamp(rest);
    const docRef = db.collection(collection).doc(id);
    if (!docRef || typeof docRef.set !== 'function') {
      throw storeError('INVALID_DATABASE_CONTEXT', '数据库上下文缺少点写能力');
    }
    await docRef.set({ data });
    return { ...data, _id: id };
  }

  /** Insert — supported in both base and transaction contexts. */
  async function add(collection, value) {
    const data = stamp({ ...value, _id: value._id || docId(environment, collection, randomUUID()) });
    const ref = db.collection(collection);
    if (typeof ref.add !== 'function') {
      throw storeError('INVALID_DATABASE_CONTEXT', '数据库上下文缺少新增能力');
    }
    const result = await ref.add({ data });
    return result && result._id ? result._id : data._id;
  }

  async function list(collection, where = {}) {
    assertQueriesSupported();
    let query = db.collection(collection);
    if (Object.keys(where).length > 0 && typeof query.where === 'function') query = query.where(where);
    if (typeof query.get !== 'function') return [];
    const result = await query.get();
    const rows = result && Array.isArray(result.data) ? result.data : [];
    if (!query.where || Object.keys(where).length === 0) return rows;
    return rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
  }

  async function count(collection, where = {}) {
    assertQueriesSupported();
    let query = db.collection(collection);
    if (Object.keys(where).length > 0 && typeof query.where === 'function') query = query.where(where);
    if (typeof query.count === 'function') {
      const result = await query.count();
      return Number(result && (result.total ?? result.count) || 0);
    }
    return (await list(collection, where)).length;
  }

  /**
   * Compare-and-set on revision. Inside a transaction this is a point
   * read + point set (the atomic equivalent of where().update under the
   * transaction's snapshot isolation). Outside a transaction the SDK's
   * where().update({_id, revision}) is the atomic form.
   * @returns {boolean} true when exactly the expected revision was advanced.
   */
  async function updateIfRevision(collection, id, expectedRevision, patch, forceSequential = false) {
    if (inTransaction) {
      const current = await get(collection, id);
      if (!current || Number(current.revision) !== Number(expectedRevision)) return false;
      await setById(collection, id, { ...current, ...patch, revision: Number(expectedRevision) + 1 });
      return true;
    }
    if (!forceSequential && typeof db.collection(collection).where === 'function') {
      const result = await db.collection(collection)
        .where({ _id: id, revision: expectedRevision })
        .update({ data: { ...patch, revision: expectedRevision + 1, updatedAt: time() } });
      return normalizeStats(result) === 1;
    }
    const current = await get(collection, id);
    if (!current || Number(current.revision) !== Number(expectedRevision)) return false;
    await setById(collection, id, { ...current, ...patch, revision: Number(expectedRevision) + 1 });
    return true;
  }

  /** Audit write uses the same context as the business write it documents. */
  async function writeAudit(entry) {
    return add(COLLECTIONS.AUDIT, { ...entry, createdAt: time() });
  }

  /** Point read that maps "not found" to null (both contexts). */
  async function get(collection, id) {
    try { return await getById(collection, id); }
    catch (error) { if (isNotFound(error)) return null; throw error; }
  }

  const store = {
    environment,
    collections: COLLECTIONS,
    inTransaction,
    getById,
    setById,
    add,
    list,
    count,
    updateIfRevision,
    writeAudit,
    get,
  };

  /**
   * Run work in a real transaction. The callback receives a store bound to
   * the transaction handle; queries throw TX_UNSUPPORTED_QUERY. When the
   * database has no transaction support the call fails closed.
   */
  store.withTransaction = async (work) => {
    if (inTransaction) throw storeError('TRANSACTION_NESTED', '事务不可嵌套');
    if (typeof db.runTransaction !== 'function') {
      throw storeError('TRANSACTION_UNAVAILABLE', '数据库不支持事务，写入失败关闭');
    }
    return db.runTransaction(async (tx) => {
      if (!tx || typeof tx.collection !== 'function') {
        throw storeError('INVALID_TRANSACTION', '事务句柄无效');
      }
      const txStore = createStore(tx, { environment, now, transaction: true });
      return work(txStore);
    });
  };

  return store;
}

module.exports = {
  ENVIRONMENT,
  COLLECTIONS,
  docId,
  ids,
  isNotFound,
  storeError,
  createStore,
};
