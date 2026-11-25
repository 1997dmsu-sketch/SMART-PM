'use strict';

// Synthetic SDK-shaped database. Point reads use a transaction-start snapshot;
// writes and audits commit together after read/write version conflict checks.
// This model is a test oracle, not evidence about a live CloudBase deployment.
const copy = (value) => value === undefined ? undefined : structuredClone(value);
const missing = () => Object.assign(new Error('DOCUMENT_NOT_EXISTS'), { code: 'DOCUMENT_NOT_EXISTS', errCode: -1 });

class TenantAuthMemoryDB {
  constructor(options = {}) {
    // strictId=true 时 doc().set 的 data 载荷携带 _id 即抛错，
    // 复现真实云端 SDK 的 -501007（不能更新_id的值）语义；默认关闭保持旧宽容行为。
    this.strictId = !!options.strictId;
    this.collections = new Map();
    this.versions = new Map();
    this.sequence = 0;
    this.transactionSequence = 0;
    this.writes = 0;
    this.failCommits = 0;
    this.retryLimit = 8;
    this.beforeCommit = null;
    this.afterRead = null;
    this.contextLog = [];
    this.commitLog = [];
    this.failReads = false;
  }

  serverDate() { return new Date('2026-11-25T00:00:00.000Z'); }
  _key(collection, id) { return `${collection}\u0000${id}`; }
  _version(collection, id) { return this.versions.get(this._key(collection, id)) || 0; }
  _bucket(collection) { return this.collections.get(collection); }
  rows(collection) { return [...(this._bucket(collection)?.values() || [])].map(copy); }
  row(collection, id) { return copy(this._bucket(collection)?.get(id) ?? null); }
  snapshot() { return copy([...this.collections].map(([name, rows]) => [name, [...rows]])); }

  _write(collection, id, data) {
    if (!this.collections.has(collection)) this.collections.set(collection, new Map());
    if (data === null) this.collections.get(collection).delete(id);
    else this.collections.get(collection).set(id, copy({ ...data, _id: id }));
    this.versions.set(this._key(collection, id), this._version(collection, id) + 1);
    this.writes += 1;
  }

  async _readHook(collection, id, context) {
    if (this.failReads) throw Object.assign(new Error('SYNTHETIC_DATABASE_FAILURE'), { code: 'DATABASE_FAILURE' });
    this.contextLog.push({ op: 'get', collection, id, context });
    if (this.afterRead) await this.afterRead({ collection, id, context });
  }

  collection(collection) {
    const db = this;
    function query(filter = {}, maximum = Infinity, projection = null, ordering = null, offset = 0) {
      return {
        where(next) { return query({ ...filter, ...next }, maximum, projection, ordering, offset); },
        limit(value) { return query(filter, value, projection, ordering, offset); },
        field(value) { return query(filter, maximum, value, ordering, offset); },
        orderBy(field, direction) { return query(filter, maximum, projection, { field, direction }, offset); },
        skip(value) { return query(filter, maximum, projection, ordering, value); },
        async get() {
          if (db.failReads) throw Object.assign(new Error('SYNTHETIC_DATABASE_FAILURE'), { code: 'DATABASE_FAILURE' });
          db.contextLog.push({ op: 'query', collection, context: 'base' });
          let rows = db.rows(collection).filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value));
          if (ordering) rows.sort((a, b) => (a[ordering.field] > b[ordering.field] ? 1 : a[ordering.field] < b[ordering.field] ? -1 : 0) * (ordering.direction === 'desc' ? -1 : 1));
          rows = rows.slice(offset, offset + maximum);
          if (projection) rows = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key === '_id' || projection[key])));
          return { data: rows };
        },
        async count() { return { total: (await query(filter).get()).data.length }; },
        async update({ data }) {
          const rows = (await query(filter).get()).data;
          for (const row of rows) db._write(collection, row._id, { ...row, ...data });
          return { stats: { updated: rows.length } };
        },
      };
    }
    return {
      ...query(),
      doc(id) {
        return {
          async get() {
            const value = db.row(collection, id);
            await db._readHook(collection, id, 'base');
            if (!value) throw missing();
            return { data: value };
          },
          async set({ data }) { db.contextLog.push({ op: 'set', collection, id, context: 'base' });
            if (db.strictId && data && Object.hasOwn(data, '_id')) throw Object.assign(new Error('STRICT_SET_ID'), { code: 'STRICT_SET_ID' });
            db._write(collection, id, data); return {}; },
          async update({ data }) {
            const value = db.row(collection, id);
            if (!value) throw missing();
            db._write(collection, id, { ...value, ...data });
            return { stats: { updated: 1 } };
          },
          async remove() { db._write(collection, id, null); return { stats: { removed: 1 } }; },
        };
      },
      async add({ data }) {
        const id = data._id || `synthetic-${++db.sequence}`;
        if (db.row(collection, id)) throw Object.assign(new Error('DUPLICATE_DOCUMENT'), { code: 'DUPLICATE_DOCUMENT' });
        db._write(collection, id, data);
        return { _id: id };
      },
    };
  }

  async runTransaction(work) {
    for (let attempt = 1; attempt <= this.retryLimit; attempt += 1) {
      const transactionId = ++this.transactionSequence;
      const start = new Map([...this.collections].map(([name, rows]) => [name, new Map([...rows].map(([id, value]) => [id, copy(value)]))]));
      const versions = new Map(this.versions);
      const readSet = new Map();
      const writeSet = new Map();
      const keyFor = (collection, id) => this._key(collection, id);
      const initialVersion = (key) => versions.get(key) || 0;
      const read = async (collection, id) => {
        const key = keyFor(collection, id);
        readSet.set(key, initialVersion(key));
        const value = writeSet.has(key) ? writeSet.get(key).data : start.get(collection)?.get(id);
        const captured = copy(value);
        await this._readHook(collection, id, 'tx');
        if (!captured) throw missing();
        return { data: captured };
      };
      const set = async (collection, id, data) => {
        const key = keyFor(collection, id);
        writeSet.set(key, { collection, id, data: copy(data) });
        this.contextLog.push({ op: 'set', collection, id, context: 'tx' });
        return {};
      };
      const unsupported = () => { throw Object.assign(new Error('TX_UNSUPPORTED_QUERY'), { code: 'TX_UNSUPPORTED_QUERY' }); };
      const tx = {
        collection: (collection) => ({
          where: unsupported, get: unsupported, count: unsupported, limit: unsupported, orderBy: unsupported,
          doc: (id) => ({
            get: () => read(collection, id),
            set: ({ data }) => {
              if (this.strictId && data && Object.hasOwn(data, '_id')) throw Object.assign(new Error('STRICT_SET_ID'), { code: 'STRICT_SET_ID' });
              return set(collection, id, { ...data, _id: id });
            },
            update: async ({ data }) => { const current = (await read(collection, id)).data; return set(collection, id, { ...current, ...data }); },
            remove: () => set(collection, id, null),
          }),
          add: async ({ data }) => {
            const id = data._id || `synthetic-${++this.sequence}`;
            const key = keyFor(collection, id);
            if (start.get(collection)?.has(id) || writeSet.has(key)) throw Object.assign(new Error('DUPLICATE_DOCUMENT'), { code: 'DUPLICATE_DOCUMENT' });
            await set(collection, id, { ...data, _id: id });
            return { _id: id };
          },
        }),
      };
      let result;
      try {
        result = await work(tx);
        if (this.beforeCommit) await this.beforeCommit({ transactionId, attempt,
          reads: [...readSet.keys()], writes: [...writeSet.values()].map(({ collection, id }) => ({ collection, id })) });
      } catch (error) {
        this.commitLog.push({ transactionId, attempt, result: 'callback-error', code: error.code || 'ERROR' });
        throw error;
      }
      const conflict = [...readSet].some(([key, version]) => (this.versions.get(key) || 0) !== version)
        || [...writeSet.keys()].some((key) => (this.versions.get(key) || 0) !== initialVersion(key));
      if (conflict) {
        this.commitLog.push({ transactionId, attempt, result: 'conflict-retry' });
        if (attempt === this.retryLimit) throw Object.assign(new Error('TRANSACTION_CONFLICT'), { code: 'TRANSACTION_CONFLICT' });
        continue;
      }
      if (this.failCommits > 0) {
        this.failCommits -= 1;
        this.commitLog.push({ transactionId, attempt, result: 'commit-failure' });
        throw Object.assign(new Error('SIMULATED_COMMIT_FAILURE'), { code: 'SIMULATED_COMMIT_FAILURE' });
      }
      for (const { collection, id, data } of writeSet.values()) this._write(collection, id, data);
      this.commitLog.push({ transactionId, attempt, result: 'committed', writes: writeSet.size });
      return result;
    }
    throw new Error('UNREACHABLE');
  }
}

module.exports = { TenantAuthMemoryDB, MemoryDB: TenantAuthMemoryDB };
