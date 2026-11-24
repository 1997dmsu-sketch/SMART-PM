'use strict';

/**
 * Cloud database access for the isolated check-in / face-enrollment namespace.
 *
 * Every identifier is deterministic and anchored to the environment prefix,
 * so no caller can select a different room/application/task by supplying an
 * id. The room binding is read by its deterministic _id only; duplicate
 * display numbers are detected with a count query, never by taking the first
 * row of a query.
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

/**
 * Create a small async data-access facade over a wx-server-sdk database (or a
 * compatible injected mock). No SDK import happens here so the module can be
 * unit tested and reused by the local admin configuration service.
 *
 * @param {object} db injected database handle.
 */
function createStore(db, options = {}) {
  if (!db || typeof db.collection !== 'function') throw new Error('INVALID_DATABASE');
  const environment = options.environment || ENVIRONMENT;
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const time = () => {
    const value = now();
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  };

  function stamp(value) {
    return { ...value, environment, updatedAt: time() };
  }

  async function getById(collection, id) {
    const result = await db.collection(collection).doc(id).get();
    return result && result.data ? result.data : null;
  }

  async function setById(collection, id, value) {
    const data = stamp({ ...value, _id: id });
    await db.collection(collection).doc(id).set({ data });
    return data;
  }

  async function add(collection, value) {
    const data = stamp({ ...value, _id: value._id || docId(environment, collection, randomUUID()) });
    const result = await db.collection(collection).add({ data });
    return result && result._id ? result._id : data._id;
  }

  async function list(collection, where = {}) {
    let query = db.collection(collection);
    if (Object.keys(where).length > 0 && typeof query.where === 'function') query = query.where(where);
    if (typeof query.get !== 'function') return [];
    const result = await query.get();
    const rows = result && Array.isArray(result.data) ? result.data : [];
    if (!query.where || Object.keys(where).length === 0) return rows;
    return rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
  }

  async function count(collection, where = {}) {
    let query = db.collection(collection);
    if (Object.keys(where).length > 0 && typeof query.where === 'function') query = query.where(where);
    if (typeof query.count === 'function') {
      const result = await query.count();
      return Number(result && (result.total ?? result.count) || 0);
    }
    return (await list(collection, where)).length;
  }

  async function updateIfRevision(collection, id, expectedRevision, patch, forceSequential = false) {
    if (!forceSequential && typeof db.collection(collection).where === 'function') {
      const result = await db.collection(collection)
        .where({ _id: id, revision: expectedRevision })
        .update({ data: { ...patch, revision: expectedRevision + 1, updatedAt: time() } });
      return normalizeStats(result) === 1;
    }
    const current = await getById(collection, id);
    if (!current || current.revision !== expectedRevision) return false;
    await setById(collection, id, { ...current, ...patch, revision: expectedRevision + 1 });
    return true;
  }

  async function writeAudit(entry) {
    return add(COLLECTIONS.AUDIT, { ...entry, createdAt: time() });
  }

  const store = {
    environment,
    collections: COLLECTIONS,
    getById,
    setById,
    add,
    list,
    count,
    updateIfRevision,
    writeAudit,
    get: async (collection, id) => {
      try { return await getById(collection, id); }
      catch (error) { if (isNotFound(error)) return null; throw error; }
    },
  };

  store.withTransaction = async (work) => {
    if (typeof db.runTransaction !== 'function') return work(store);
    return db.runTransaction(async (tx) => {
      if (!tx || typeof tx.collection !== 'function') throw new Error('INVALID_TRANSACTION');
      const txGetById = async (collection, id) => {
        const result = await tx.collection(collection).doc(id).get();
        return result && result.data ? result.data : null;
      };
      const txSetById = async (collection, id, value) => {
        const data = stamp({ ...value, _id: id });
        await tx.collection(collection).doc(id).set({ data });
        return data;
      };
      const txStore = {
        ...store,
        getById: txGetById,
        setById: txSetById,
        add: async (collection, value) => {
          const data = stamp({ ...value, _id: value._id || docId(environment, collection, randomUUID()) });
          await tx.collection(collection).add({ data });
          return data._id;
        },
        // wx-server-sdk transactions cannot use where().update(); a read/set
        // with an explicit revision check is the atomic equivalent inside a tx.
        updateIfRevision: async (collection, id, expected, patch) => {
          const current = await txGetById(collection, id);
          if (!current || current.revision !== expected) return false;
          await txSetById(collection, id, { ...current, ...patch, revision: expected + 1 });
          return true;
        },
        withTransaction: undefined,
      };
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
  createStore,
};
