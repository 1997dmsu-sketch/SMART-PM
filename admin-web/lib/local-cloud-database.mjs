import { randomUUID } from "node:crypto";
import { LocalStore } from "./store.mjs";

const clone = (value) => structuredClone(value);
const error = (code) => Object.assign(new Error(code), { code });
const safeKey = (value) => typeof value === "string" && value.length > 0
  && value.length <= 512 && !/[\u0000-\u001f]/.test(value)
  && !["__proto__", "prototype", "constructor"].includes(value);

/** Local demo only: one snapshot and one persist for the whole transaction.
 * Shares LocalStore.queue with existing property writes. It never emulates a
 * transaction using multiple independent writes, nor queries the outer DB
 * from a transaction handle. Cloud mode uses the actual database SDK instead.
 */
export class LocalCloudDatabase {
  constructor(store, audit = {}) {
    if (!(store instanceof LocalStore)) throw error("LOCAL_STORE_REQUIRED");
    this.store = store;
    this.audit = { actor: audit.actor || "local-admin", actorId: audit.actorId || "local-admin",
      action: audit.action || "本地测试配置事务" };
  }

  collection(name) { return this.context(() => this.store.data, false).collection(name); }

  context(snapshot, inTransaction, markWrite = () => {}) {
    const db = this;
    function collection(name) {
      if (!safeKey(name)) throw error("INVALID_COLLECTION");
      const rows = () => {
        const value = snapshot()[name];
        if (value !== undefined && !Array.isArray(value)) throw error("INVALID_COLLECTION_DATA");
        return value || [];
      };
      function query(filter = {}, cap = Infinity, offset = 0, ordering = null) {
        function supported() { if (inTransaction) throw error("TX_UNSUPPORTED_QUERY"); }
        return {
          where(next) { supported(); return query({ ...filter, ...next }, cap, offset, ordering); },
          limit(next) { supported(); if (!Number.isSafeInteger(next) || next < 1) throw error("INVALID_LIMIT"); return query(filter, next, offset, ordering); },
          skip(next) { supported(); if (!Number.isSafeInteger(next) || next < 0) throw error("INVALID_SKIP"); return query(filter, cap, next, ordering); },
          orderBy(key, direction) { supported(); if (!safeKey(key) || !["asc", "desc"].includes(direction)) throw error("INVALID_ORDER"); return query(filter, cap, offset, [key, direction]); },
          async get() {
            supported();
            const selected = rows().filter((row) => Object.entries(filter)
              .every(([key, value]) => Object.hasOwn(row, key) && row[key] === value));
            if (ordering) selected.sort((a, b) => {
              const [key, direction] = ordering;
              return (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (direction === "asc" ? 1 : -1);
            });
            return { data: clone(selected.slice(offset, offset + cap)) };
          },
          async count() { return { total: (await this.get()).data.length }; },
        };
      }
      const ref = {
        ...query(),
        doc(id) {
          if (!safeKey(id)) throw error("INVALID_DOCUMENT_ID");
          async function write(data, kind) {
            if (!inTransaction) return db.runTransaction((tx) => tx.collection(name).doc(id)[kind]({ data }));
            if (!data || typeof data !== "object" || Array.isArray(data)
              || (Object.hasOwn(data, "_id") && data._id !== id)) throw error("INVALID_DOCUMENT");
            const index = rows().findIndex((row) => row._id === id);
            if (kind === "update" && index < 0) throw error("DOCUMENT_NOT_EXISTS");
            const record = clone({ ...(kind === "update" ? rows()[index] : {}), ...data, _id: id });
            const target = (snapshot()[name] ||= []);
            if (index < 0) target.push(record); else target[index] = record;
            markWrite(name, id);
            return { stats: { updated: 1 } };
          }
          return {
            async get() { return { data: clone(rows().find((row) => row._id === id) || null) }; },
            async set({ data }) { return write(data, "set"); },
            async update({ data }) { return write(data, "update"); },
          };
        },
        async add({ data }) {
          if (!data || typeof data !== "object") throw error("INVALID_DOCUMENT");
          const id = data._id || randomUUID();
          if (!inTransaction) return db.runTransaction((tx) => tx.collection(name).add({ data: { ...data, _id: id } }));
          if ((await ref.doc(id).get()).data) throw error("ALREADY_EXISTS");
          await ref.doc(id).set({ data });
          return { _id: id, id };
        },
      };
      return ref;
    }
    return { collection };
  }

  async runTransaction(build) {
    if (typeof build !== "function") throw error("INVALID_TRANSACTION");
    const task = this.store.queue.then(async () => {
      const next = clone(this.store.data);
      const writes = new Set();
      let active = true;
      const tx = this.context(() => {
        if (!active) throw error("TRANSACTION_CLOSED");
        return next;
      }, true, (name, id) => writes.add(`${name}/${id}`));
      let result;
      try { result = await build(tx); } finally { active = false; }
      const receipt = clone(result);
      if (writes.size) {
        (next.admin_audit ||= []).unshift({ ...this.audit, _id: randomUUID(),
          target: [...writes].join(", "), createdAt: Date.now() });
        await this.store.persist(next);
        this.store.data = next;
      }
      return receipt;
    });
    this.store.queue = task.catch(() => {});
    return task;
  }
}
