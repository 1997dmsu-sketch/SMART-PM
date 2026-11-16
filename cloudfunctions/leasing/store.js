"use strict";
const { randomUUID } = require("node:crypto");
// Missing documents are distinct from missing collections, permission errors and outages.
function absent(error) {
  const message = String(error?.errMsg || error?.message || "");
  return (
    !/collection[^\n]*(not\s*exist|not\s*found)/i.test(message) &&
    /(?:document|\bdoc\b)[^\n]{0,80}(?:not\s*exist|does\s*not\s*exist|not\s*found)/i.test(
      message,
    )
  );
}
async function readDocument(doc) {
  try {
    const r = await doc.get();
    if (r.code || r.errCode) throw new Error("数据库读取失败");
    return Array.isArray(r.data) ? r.data[0] || null : r.data || null;
  } catch (e) {
    if (absent(e)) return null;
    throw e;
  }
}
function createStore(db) {
  const allowed = new Set([
    "houses",
    "rooms",
    "property_catalog",
    "users",
    "rental_settings",
    "rental_appointments",
    "rental_preleases",
    "rental_room_holds",
    "rental_identity_documents",
    "admin_audit",
  ]);
  const check = (c) => {
    if (!allowed.has(c)) throw new Error("Invalid collection");
    return c;
  };
  return {
    async get(c, id) {
      return readDocument(db.collection(check(c)).doc(id));
    },
    async list(c, { where, fields } = {}) {
      const rows = [];
      for (let offset = 0; offset < 20000; offset += 100) {
        let query = db.collection(check(c));
        if (where) query = query.where(where);
        if (fields)
          query = query.field(Object.fromEntries(fields.map((k) => [k, true])));
        const r = await query
          .orderBy("_id", "asc")
          .skip(offset)
          .limit(100)
          .get();
        if (r.code || r.errCode || !Array.isArray(r.data))
          throw new Error("Invalid response");
        rows.push(...r.data);
        if (r.data.length < 100) return rows;
      }
      throw new Error("Collection capacity reached");
    },
    async transact(refs, build, audit) {
      const unique = [
        ...new Map(refs.map((r) => [`${r.collection}/${r.id}`, r])).values(),
      ];
      if (unique.length > 90) throw new Error("Too many references");
      return db.runTransaction(async (tx) => {
        const state = {};
        for (const { collection: c, id } of unique)
          state[`${c}/${id}`] = await readDocument(
            tx.collection(check(c)).doc(id),
          );
        const writes = await build(state),
          keys = new Set(unique.map((r) => `${r.collection}/${r.id}`));
        for (const w of writes) {
          if (!keys.has(`${w.collection}/${w.id}`))
            throw new Error("Undeclared write");
          const data = { ...w.data, updatedAt: Date.now() };
          delete data._id;
          const saved = await tx
            .collection(w.collection)
            .doc(w.id)
            .set({ data });
          if (saved.code || saved.errCode) throw new Error("数据库写入失败");
        }
        const logged = await tx
          .collection("admin_audit")
          .doc(randomUUID())
          .set({ data: { ...audit, createdAt: Date.now() } });
        if (logged.code || logged.errCode) throw new Error("审计写入失败");
      });
    },
  };
}
module.exports = { createStore, readDocument };
