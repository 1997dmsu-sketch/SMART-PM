/**
 * @cloudbase/node-sdk 直传约定 → wx-server-sdk 形状 的适配层。
 *
 * admin-web live 模式下 store.app.database() 返回 node-sdk 数据库，其
 * doc.set/add/update 直接接收数据对象（不含 {data} 包装）、doc.get 返回
 * {data: [doc]} 数组；而仓库内的受信模块（TenantAccountService 的
 * identity-core.putDoc、AdminCheckinFaceTestConfig.#set、checkinFaceTest
 * store.setById 等）按 wx-server-sdk 约定使用 {data} 包装与单文档返回。
 * 本适配层把 node-sdk 数据库包成 wx-server-sdk 形状，使 live 模式复用同一
 * 套已审查的业务模块，避免两套约定并行漂移。demo 模式仍用 LocalCloudDatabase。
 *
 * 只做形态转换，不做任何字段校验或裁剪（_id 剔除由各业务模块自身负责）。
 */

function adaptDoc(docRef) {
  return {
    get: async () => {
      const result = await docRef.get();
      const value = result && result.data;
      return { data: Array.isArray(value) ? (value[0] ?? null) : (value ?? null) };
    },
    set: async ({ data }) => docRef.set(data),
    update: async ({ data }) => docRef.update(data),
    remove: async () => docRef.remove(),
  };
}

function adaptQuery(queryRef) {
  const q = {
    get: async () => {
      const result = await queryRef.get();
      return { data: result && Array.isArray(result.data) ? result.data : [] };
    },
    count: async () => {
      const result = await queryRef.count();
      return { total: Number(result && (result.total ?? result.count) || 0) };
    },
    update: async ({ data }) => queryRef.update(data),
  };
  q.limit = (n) => adaptQuery(queryRef.limit(n));
  q.skip = (n) => adaptQuery(queryRef.skip(n));
  q.orderBy = (field, direction) => adaptQuery(queryRef.orderBy(field, direction));
  return q;
}

function adaptCollection(collectionRef) {
  const coll = {
    doc: (id) => adaptDoc(collectionRef.doc(id)),
    add: async ({ data }) => collectionRef.add(data),
    get: async () => {
      const result = await collectionRef.get();
      return { data: result && Array.isArray(result.data) ? result.data : [] };
    },
  };
  coll.where = (where) => adaptQuery(collectionRef.where(where));
  coll.limit = (n) => adaptCollection(collectionRef.limit(n));
  coll.skip = (n) => adaptCollection(collectionRef.skip(n));
  coll.orderBy = (field, direction) => adaptCollection(collectionRef.orderBy(field, direction));
  return coll;
}

export function adaptDatabase(db) {
  if (!db || typeof db.collection !== "function") throw new Error("INVALID_DATABASE");
  const adapted = {
    collection: (name) => adaptCollection(db.collection(name)),
  };
  if (typeof db.runTransaction === "function") {
    adapted.runTransaction = (work) => db.runTransaction(async (tx) => {
      if (!tx || typeof tx.collection !== "function") throw new Error("INVALID_TRANSACTION");
      return work({ ...tx, collection: (name) => adaptCollection(tx.collection(name)) });
    });
  }
  return adapted;
}

export default adaptDatabase;
