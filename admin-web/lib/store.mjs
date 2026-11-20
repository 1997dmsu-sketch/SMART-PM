import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { HttpError } from "./model.mjs";
import { isH4cCollection, H4C_AUDIT_COLLECTION, H4C_COLLECTION_NAMES } from "./h4c-collections.mjs";
const collections = [
  "houses",
  "content",
  "users",
  "rooms",
  "admin_audit",
  "property_catalog",
  "organizations",
  "org_memberships",
  "unique_claims",
  "lifecycle_guards",
  "operation_keys",
  // DB-04/05：身份、黑名单、入住周期（本分支基线）
  "auth_identities",
  "persons",
  "identity_domains",
  "identity_applications",
  "identity_reviews",
  "identity_private",
  "blacklist_entries",
  "blacklist_decisions",
  "eligibility_guards",
  "occupancy_cycles",
  "occupancies",
  "occupancy_applications",
  "room_primary_slots",
  "occupancy_materializations",
  // DB-07：统一文件资源（追加，不改变既有集合语义）
  "file_assets",
  "file_links",
  "file_access_log",
  // HK-AI-04：全局设备摘要域（跨组织共享）
  "device_digest_domains",
  "face_credentials",
  "device_access_grants",
  "device_operation_jobs",
  "device_operation_logs",
  "device_claims",
  "grant_slot_claims",
  "access_devices",
  "operation_key_domains",
  "device_operation_evidence",
  "device_operation_evidence_heads",
  "evidence_digest_domains",
  "device_claim_release_guards",
];
const AUDIT_INPUT_FIELDS = new Set([
  "auditId",
  "orgId",
  "actorId",
  "actorType",
  "action",
]);
function boundedAuditField(value, field) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new HttpError(400, `${field} 非法`);
  return value;
}
function deterministicAudit(audit) {
  if (!audit || typeof audit !== "object" || Array.isArray(audit) ||
      !Object.hasOwn(audit, "auditId")) return null;
  for (const key of Object.keys(audit)) {
    if (!AUDIT_INPUT_FIELDS.has(key))
      throw new HttpError(400, `确定性审计字段非法: ${key}`);
  }
  return {
    auditId: boundedAuditField(audit.auditId, "auditId"),
    orgId: boundedAuditField(audit.orgId, "orgId"),
    actorId: boundedAuditField(audit.actorId, "actorId"),
    actorType: boundedAuditField(audit.actorType, "actorType"),
    action: boundedAuditField(audit.action, "action"),
  };
}
function uniqueRefs(refs) {
  if (!Array.isArray(refs)) throw new HttpError(400, "事务引用非法");
  return [...new Map(refs.map((item) => [
    `${item?.collection}/${item?.id}`,
    item,
  ])).values()];
}
function prepareDeterministicAudit(refs, audit) {
  const config = deterministicAudit(audit);
  if (!config) return { config: null, refs };
  const normalized = uniqueRefs(refs);
  if (normalized.length > 90)
    throw new HttpError(400, "一次操作涉及记录过多，请缩小选择范围");
  if (!normalized.some(({ collection, id }) =>
    collection === "admin_audit" && id === config.auditId))
    throw new HttpError(400, "确定性审计引用缺失");
  return { config, refs: normalized };
}
// H4-c C1: evidence/head/K3-domain writes keep the caller's exact fields.
// LocalStore must not merge old rows or inject `updatedAt`: the evidence record
// is immutable and the head's updatedAt is the reconcile clock value.
const exactWriteCollections = new Set([
  "device_operation_evidence",
  "device_operation_evidence_heads",
  "evidence_digest_domains",
]);
// Evidence and both K3 domain records are create-only. The per-job head is the
// only mutable record and is still CAS-checked by the H4-c append helper.
const createOnlyCollections = new Set([
  "device_operation_evidence",
  "evidence_digest_domains",
]);

// H4-c S4: closed H4-c collection list used by Store-side checks. It reuses the
// frozen enumeration from h4c-collections so the eight names are never written
// a second time in this module.
const H4C_STORE_COLLECTIONS = H4C_COLLECTION_NAMES;
// C1 audit record is exactly these 7 fields (S4 §3.3).
// C1 runtime may write only these three business collections (S4 §3.4 / M13).
const C1_WRITABLE_COLLECTIONS = Object.freeze([
  "device_operation_evidence",
  "device_operation_evidence_heads",
  "evidence_chain_anchors",
]);
const H4C_AUDIT_FIELDS = Object.freeze([
  "_id",
  "orgId",
  "actorId",
  "actorType",
  "action",
  "target",
  "createdAt",
]);

const admissionRequired = (message) =>
  new HttpError(409, message, "EVIDENCE_CHAIN_ADMISSION_REQUIRED");

/**
 * S4: the single explicit H4-c transaction carries exactly one admin_audit
 * write with the frozen 7 fields, target computed from the sorted business
 * writes and createdAt equal to the caller-supplied `now`.
 */
function finalAuditWrite(writes, now) {
  const audits = writes.filter((w) => w?.collection === H4C_AUDIT_COLLECTION);
  if (audits.length !== 1) throw admissionRequired("H4-c 事务必须恰好包含一条审计记录");
  const audit = audits[0];
  const data = audit.data;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw admissionRequired("H4-c 审计记录缺失");
  const own = Reflect.ownKeys(data);
  if (own.length !== H4C_AUDIT_FIELDS.length ||
      !own.every((key) => typeof key === "string" && H4C_AUDIT_FIELDS.includes(key)))
    throw admissionRequired("H4-c 审计记录字段非法");
  const target = writes
    .filter((w) => w !== audit)
    .map((w) => `${w.collection}/${w.id}`)
    .sort()
    .join(", ");
  if (data.target !== target || data.createdAt !== now || data._id !== audit.id)
    throw admissionRequired("H4-c 审计记录目标或时间非法");
  return audit;
}

// Private H4-c snapshot: used to prove no caller mutated H4-c collection state
// directly in memory outside an authorised transactFinal commit.
function h4cSnapshot(data) {
  const snapshot = {};
  for (const name of H4C_STORE_COLLECTIONS) snapshot[name] = data?.[name] ?? [];
  return structuredClone(snapshot);
}

function sameH4c(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function auditRecord(config, writes, createdAt) {
  return {
    _id: config.auditId,
    orgId: config.orgId,
    actorId: config.actorId,
    actorType: config.actorType,
    action: config.action,
    target: writes.map((write) => `${write.collection}/${write.id}`).join(", "),
    createdAt,
  };
}
export function seed(injection) {
  if (injection !== undefined && injection !== null &&
      typeof injection === "object") {
    for (const key of Reflect.ownKeys(injection)) {
      if (typeof key !== "string" || !isH4cCollection(key)) continue;
      const value = injection[key];
      if (Array.isArray(value) ? value.length > 0 : value !== undefined)
        throw admissionRequired("seed 不得注入 H4-c 数据");
    }
  }
  return {
    houses: Array.from({ length: 16 }, (_, i) => ({
      _id: `demo-house-${i + 1}`,
      title: [
        "采光充足 · 温馨两居室",
        "公园旁的精装一居",
        "宽敞三居 · 即刻入住",
        "阳光小屋 · 独立阳台",
      ][i % 4],
      community: ["宇宙花园", "星河雅苑", "云端公寓"][i % 3],
      address: `${(i % 4) + 1} 栋 ${i + 1}02 室`,
      price: [2600, 1800, 3600, 2200][i % 4],
      area: [86, 48, 118, 62][i % 4],
      rooms: ["2室1厅", "1室1厅", "3室2厅", "2室1厅"][i % 4],
      orientation: "南",
      rentType: i % 4 ? "整租" : "合租",
      status: i % 5 === 0 ? "下架" : i % 7 === 0 ? "已租" : "在租",
      description: "本地演示房源，可自由编辑。修改不会同步至微信云环境。",
      cover: `/assets/room-${(i % 3) + 1}.jpg`,
      images: [],
      tags: ["近地铁", "采光好"],
      updatedAt: Date.now() - i * 3600000,
    })),
    content: [
      {
        _id: "demo-content-1",
        title: "让每一次归家，都更安心",
        type: "share",
        description: "欢迎来到宇宙物业智联。这里是本地演示内容。",
        author: "物业服务中心",
        image: "",
        enabled: true,
        sortOrder: 1,
      },
      {
        _id: "demo-content-2",
        title: "十一月社区便民服务日",
        type: "share",
        description: "一起让社区生活更美好。活动时间与地点待发布。",
        author: "物业服务中心",
        image: "",
        enabled: false,
        sortOrder: 2,
      },
    ],
    users: [
      {
        _id: "demo-user-1",
        name: "张女士（演示）",
        phone: "演示号码 001",
        houses: ["ROOM-101"],
      },
      {
        _id: "demo-user-2",
        name: "李先生（演示）",
        phone: "演示号码 002",
        houses: [],
      },
      {
        _id: "demo-user-3",
        name: "王女士（演示）",
        phone: "演示号码 003",
        houses: ["ROOM-102"],
      },
    ],
    rooms: [
      {
        _id: "demo-room-1",
        houseId: "ROOM-101",
        name: "1 栋 101 室",
        community: "宇宙花园",
        address: "1 栋 101 室",
        sortOrder: 1,
      },
      {
        _id: "demo-room-2",
        houseId: "ROOM-102",
        name: "1 栋 102 室",
        community: "宇宙花园",
        address: "1 栋 102 室",
        sortOrder: 2,
      },
    ],
    property_catalog: [],
    admin_audit: [],
    file_assets: [],
    file_links: [],
    file_access_log: [],
  device_digest_domains: [],
  face_credentials: [],
  device_access_grants: [],
  device_operation_jobs: [],
  device_operation_logs: [],
  device_claims: [],
  grant_slot_claims: [],
  access_devices: [],
  operation_key_domains: [],
  device_operation_evidence: [],
  device_operation_evidence_heads: [],
  evidence_digest_domains: [],
  device_claim_release_guards: [],
  };
}
export class LocalStore {
  #h4cGate;
  #h4cCommitted;
  constructor(directory, { h4cGate = null } = {}) {
    if (h4cGate !== null && typeof h4cGate?.verify !== "function")
      throw new TypeError("h4cGate 必须提供 verify 方法");
    this.#h4cGate = h4cGate;
    this.#h4cCommitted = null;
    this.directory = directory;
    this.queue = Promise.resolve();
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    try {
      this.data = JSON.parse(
        await readFile(join(this.directory, "demo-data.json"), "utf8"),
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      this.data = seed();
      await this.#persist(this.data);
    }
    this.data.property_catalog ||= [];
    // DB-07: on-demand initialization for existing local data files that
    // predate the file collections (same pattern as property_catalog above).
    this.data.file_assets ||= [];
    this.data.file_links ||= [];
    this.data.file_access_log ||= [];
    this.data.device_digest_domains ||= [];
    this.data.face_credentials ||= [];
    this.data.device_access_grants ||= [];
    this.data.device_operation_jobs ||= [];
    this.data.device_operation_logs ||= [];
    this.data.device_claims ||= [];
    this.data.grant_slot_claims ||= [];
    this.data.access_devices ||= [];
    this.data.operation_key_domains ||= [];
    for (const name of H4C_STORE_COLLECTIONS) {
      if (!Object.hasOwn(this.data, name)) {
        // S4: missing H4-c arrays are filled in memory only; init never
        // persists them and never rewrites the data file.
        this.data[name] = [];
        continue;
      }
      if (!Array.isArray(this.data[name]))
        throw new HttpError(409, "H4-c 集合数据非法", "EVIDENCE_INVALID");
    }
    this.data.device_claim_release_guards ||= [];
    this.#h4cCommitted = h4cSnapshot(this.data);
    return this;
  }
  async #persist(data) {
    const file = join(this.directory, "demo-data.json");
    await writeFile(file + ".tmp", JSON.stringify(data), { mode: 0o600 });
    await rename(file + ".tmp", file);
  }
  #assertH4cUnchanged() {
    if (this.#h4cCommitted === null) return;
    if (!sameH4c(this.#h4cCommitted, h4cSnapshot(this.data)))
      throw admissionRequired("H4-c 集合只能通过 transactFinal 写入");
  }
  async list(name, orgId = null) {
    const rows = this.data[name] || [];
    return structuredClone(
      orgId ? rows.filter((r) => r.orgId === orgId) : rows,
    );
  }
  // 最小按组织 + ID 点查：与 CloudStore.get 同契约，避免为一条资格/凭证记录
  // 扫描整个集合；跨组织与缺失同样返回 null。
  async get(name, id, orgId = null) {
    const row = (this.data[name] || []).find((r) => r._id === id);
    if (!row) return null;
    if (orgId && row.orgId !== orgId) return null;
    return structuredClone(row);
  }
  async transact(refs, build, audit) {
    if (Array.isArray(refs) && refs.some((r) => isH4cCollection(r?.collection)))
      throw admissionRequired("H4-c 集合必须通过 transactFinal 写入");
    const prepared = prepareDeterministicAudit(refs, audit);
    const task = this.queue.then(async () => {
      this.#assertH4cUnchanged();
      const next = structuredClone(this.data);
      const state = Object.fromEntries(
        prepared.refs.map(({ collection, id }) => [
          `${collection}/${id}`,
          structuredClone(
            (next[collection] || []).find((r) => r._id === id) || null,
          ),
        ]),
      );
      const existingDeterministicAudit = prepared.config
        ? state[`admin_audit/${prepared.config.auditId}`]
        : null;
      const writes = await build(state);
      if (!Array.isArray(writes))
        throw new HttpError(400, "事务写入必须是数组");
      if (existingDeterministicAudit) {
        if (writes.length)
          throw new HttpError(409, "确定性审计记录已存在");
        return;
      }
      const allowed = new Set(prepared.refs.map((r) => `${r.collection}/${r.id}`));
      for (const w of writes) {
        if (prepared.config && w.collection === "admin_audit")
          throw new HttpError(400, "确定性审计记录只能由 Store 写入");
        if (!allowed.has(`${w.collection}/${w.id}`)) {
          if (isH4cCollection(w.collection))
            throw admissionRequired("H4-c 集合必须通过 transactFinal 写入");
          throw Error("Undeclared transaction write");
        }
        const rows = (next[w.collection] ||= []);
        const index = rows.findIndex((r) => r._id === w.id);
        if (createOnlyCollections.has(w.collection) && index >= 0)
          throw new HttpError(409, "记录已存在");
        const exact = exactWriteCollections.has(w.collection);
        if (exact && (!w.data || typeof w.data !== "object" || Array.isArray(w.data) ||
            w.data._id !== w.id))
          throw new HttpError(400, "事务写入数据非法");
        const record = exact
          ? { ...w.data, _id: w.id }
          : { ...(index < 0 ? {} : rows[index]), ...w.data, _id: w.id, updatedAt: Date.now() };
        if (index < 0) rows.push(record);
        else rows[index] = record;
      }
      next.admin_audit.unshift(prepared.config
        ? auditRecord(prepared.config, writes, Date.now())
        : {
            ...audit,
            _id: randomUUID(),
            target: writes.map((w) => `${w.collection}/${w.id}`).join(", "),
            createdAt: Date.now(),
          });
      await this.#persist(next);
      this.data = next;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  /**
   * S4: the only authorised H4-c explicit write path. Gate verification and all
   * Store-side checks run before anything is written; the committed H4-c
   * baseline advances only after a successful persist.
   */
  async transactFinal(refs, build, admission, { now, auditMode = "explicit" } = {}) {
    if (this.#h4cGate === null) throw admissionRequired("H4-c gate 未配置");
    if (auditMode !== "explicit")
      throw admissionRequired("H4-c 只接受 explicit 审计模式");
    if (!Number.isSafeInteger(now) || now < 0)
      throw new HttpError(409, "H4-c 提交时间非法", "EVIDENCE_INVALID");
    const unique = uniqueRefs(refs);
    if (unique.length > 90)
      throw new HttpError(400, "一次操作涉及记录过多，请缩小选择范围");
    const task = this.queue.then(async () => {
      this.#assertH4cUnchanged();
      const next = structuredClone(this.data);
      const state = Object.fromEntries(
        unique.map(({ collection, id }) => [
          `${collection}/${id}`,
          structuredClone(
            (next[collection] || []).find((r) => r._id === id) || null,
          ),
        ]),
      );
      const writes = await build(state);
      if (!Array.isArray(writes))
        throw new HttpError(400, "事务写入必须是数组");
      const audit = finalAuditWrite(writes, now);
      const allowed = new Set(unique.map((r) => `${r.collection}/${r.id}`));
      if (!allowed.has(`${audit.collection}/${audit.id}`))
        throw admissionRequired("H4-c 审计记录未在 refs 中声明");
      for (const w of writes) {
        if (w === audit) continue;
        if (!allowed.has(`${w.collection}/${w.id}`))
          throw admissionRequired("H4-c 事务包含未声明写入");
        if (!isH4cCollection(w.collection))
          throw admissionRequired("H4-c 事务不得写非 H4-c 集合");
      }
      const business = writes.filter((w) => w !== audit);
      if (business.length !== 2 && business.length !== 3)
        throw admissionRequired("H4-c 业务写必须为 2 或 3 条");
      if (business.some((w) => !C1_WRITABLE_COLLECTIONS.includes(w.collection)))
        throw admissionRequired("H4-c 运行时不得写域/证明/栅栏/标记/计划集合");
      await this.#h4cGate.verify({ state, refs: unique, writes, admission, now });
      for (const w of writes) {
        if (w === audit) continue;
        const rows = (next[w.collection] ||= []);
        const index = rows.findIndex((r) => r._id === w.id);
        if (createOnlyCollections.has(w.collection) && index >= 0)
          throw new HttpError(409, "记录已存在", "CONFLICT");
        const exact = exactWriteCollections.has(w.collection);
        if (exact && (!w.data || typeof w.data !== "object" ||
            Array.isArray(w.data) || w.data._id !== w.id))
          throw new HttpError(400, "事务写入数据非法");
        const record = exact
          ? { ...w.data, _id: w.id }
          : { ...(index < 0 ? {} : rows[index]), ...w.data, _id: w.id };
        if (index < 0) rows.push(record);
        else rows[index] = record;
      }
      const auditRows = (next[H4C_AUDIT_COLLECTION] ||= []);
      if (auditRows.some((r) => r._id === audit.id))
        throw new HttpError(409, "确定性审计记录已存在", "CONFLICT");
      auditRows.unshift({ ...audit.data, _id: audit.id });
      await this.#persist(next);
      this.data = next;
      this.#h4cCommitted = h4cSnapshot(next);
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async change(name, id, build, audit) {
    if (isH4cCollection(name))
      throw admissionRequired("H4-c 集合必须通过 transactFinal 写入");
    const task = this.queue.then(async () => {
      this.#assertH4cUnchanged();
      const next = structuredClone(this.data);
      const rows = next[name];
      const old = id ? rows.find((r) => r._id === id) : null;
      if (id && !old) throw new HttpError(404, "记录不存在");
      const value = await build(old);
      if (
        name === "rooms" &&
        rows.some((r) => r.houseId === value.houseId && r._id !== id)
      )
        throw new HttpError(409, "房产编号已存在");
      id = id || randomUUID();
      const record = { ...old, ...value, _id: id, updatedAt: Date.now() };
      if (old)
        rows.splice(
          rows.findIndex((r) => r._id === id),
          1,
          record,
        );
      else rows.push(record);
      next.admin_audit.unshift({
        ...audit,
        _id: randomUUID(),
        target: `${name}/${id}`,
        createdAt: Date.now(),
      });
      await this.#persist(next);
      this.data = next;
      return structuredClone(record);
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
export class CloudStore {
  #h4cGate;
  constructor(app, { h4cGate = null } = {}) {
    if (h4cGate !== null && typeof h4cGate?.verify !== "function")
      throw new TypeError("h4cGate 必须提供 verify 方法");
    this.#h4cGate = h4cGate;
    this.app = app;
    this.db = app.database({ throwOnCode: true });
  }
  async list(name, orgId = null) {
    if (!collections.includes(name)) throw Error("Invalid collection");
    const result = [];
    let skip = 0;
    while (true) {
      // DB-02: organization filtering is pushed down to the database query so
      // unrelated organizations' volume cannot exhaust the 20,000-row budget.
      let query = this.db.collection(name);
      if (orgId) query = query.where({ orgId });
      const r = await query.orderBy("_id", "asc").skip(skip).limit(100).get();
      if (r.code || !Array.isArray(r.data))
        throw new HttpError(503, "云数据库查询失败");
      result.push(...r.data);
      if (r.data.length < 100) break;
      skip += 100;
      if (skip >= 20000)
        throw new HttpError(503, "集合超出本期查询容量，请升级服务端分页查询");
    }
    return result;
  }
  /**
   * 最小按组织 + ID 点查。查询条件 `{_id, orgId}` 由数据库服务端执行，
   * 不使用 list 的全组织分页，因此目标记录存在时不会受 20,000 行容量拒绝影响。
   * 缺失与跨组织同态返回 null；SDK/查询故障仍以 503 区分。
   */
  async get(name, id, orgId = null) {
    if (!collections.includes(name)) throw Error("Invalid collection");
    if (typeof id !== "string" || !id) throw Error("Invalid record id");
    const where = orgId ? { _id: id, orgId } : { _id: id };
    let r;
    try {
      r = await this.db.collection(name).where(where).limit(1).get();
    } catch {
      throw new HttpError(503, "云数据库查询失败");
    }
    if (r?.code || !Array.isArray(r?.data))
      throw new HttpError(503, "云数据库查询失败");
    const row = r.data[0];
    if (!row || row._id !== id || (orgId && row.orgId !== orgId)) return null;
    return row;
  }
  async transact(refs, build, audit) {
    if (Array.isArray(refs) && refs.some((r) => isH4cCollection(r?.collection)))
      throw admissionRequired("H4-c 集合必须通过 transactFinal 写入");
    const prepared = prepareDeterministicAudit(refs, audit);
    const unique = prepared.config ? prepared.refs : uniqueRefs(refs);
    if (unique.length > 90)
      throw new HttpError(400, "一次操作涉及记录过多，请缩小选择范围");
    return this.db.runTransaction(async (tx) => {
      const state = {};
      for (const r of unique) {
        const result = await tx.collection(r.collection).doc(r.id).get();
        if (result.code) throw new HttpError(503, "云数据库读取失败");
        state[`${r.collection}/${r.id}`] = Array.isArray(result.data)
          ? result.data[0]
          : result.data;
      }
      const existingDeterministicAudit = prepared.config
        ? state[`admin_audit/${prepared.config.auditId}`]
        : null;
      const writes = await build(state);
      if (!Array.isArray(writes))
        throw new HttpError(400, "事务写入必须是数组");
      if (existingDeterministicAudit) {
        if (writes.length)
          throw new HttpError(409, "确定性审计记录已存在");
        return;
      }
      const allowed = new Set(unique.map((r) => `${r.collection}/${r.id}`));
      const written = new Set();
      for (const w of writes) {
        if (prepared.config && w.collection === "admin_audit")
          throw new HttpError(400, "确定性审计记录只能由 Store 写入");
        const k = `${w.collection}/${w.id}`;
        if (!allowed.has(k)) {
          if (isH4cCollection(w.collection))
            throw admissionRequired("H4-c 集合必须通过 transactFinal 写入");
          throw Error("Undeclared transaction write");
        }
        if (createOnlyCollections.has(w.collection) && (state[k] || written.has(k)))
          throw new HttpError(409, "记录已存在");
        const exact = exactWriteCollections.has(w.collection);
        if (exact && (!w.data || typeof w.data !== "object" || Array.isArray(w.data) ||
            w.data._id !== w.id))
          throw new HttpError(400, "事务写入数据非法");
        const data = exact
          ? { ...w.data }
          : { ...state[k], ...w.data, updatedAt: Date.now() };
        delete data._id;
        const result = await tx.collection(w.collection).doc(w.id).set(data);
        if (result.code) throw new HttpError(503, "批量写入失败，整批回滚");
        written.add(k);
      }
      if (prepared.config) {
        const record = auditRecord(prepared.config, writes, Date.now());
        delete record._id;
        const logged = await tx
          .collection("admin_audit")
          .doc(prepared.config.auditId)
          .set(record);
        if (logged?.code) throw new HttpError(503, "日志保存失败，整批回滚");
        return;
      }
      const logged = await tx
        .collection("admin_audit")
        .doc(randomUUID())
        .set({
          ...audit,
          target: writes.map((w) => `${w.collection}/${w.id}`).join(", "),
          createdAt: Date.now(),
        });
      if (logged.code) throw new HttpError(503, "日志保存失败，整批回滚");
    });
  }
  /** S4: Cloud equivalent of LocalStore#transactFinal (fake semantics only). */
  async transactFinal(refs, build, admission, { now, auditMode = "explicit" } = {}) {
    if (this.#h4cGate === null) throw admissionRequired("H4-c gate 未配置");
    if (auditMode !== "explicit")
      throw admissionRequired("H4-c 只接受 explicit 审计模式");
    if (!Number.isSafeInteger(now) || now < 0)
      throw new HttpError(409, "H4-c 提交时间非法", "EVIDENCE_INVALID");
    const unique = uniqueRefs(refs);
    if (unique.length > 90)
      throw new HttpError(400, "一次操作涉及记录过多，请缩小选择范围");
    return this.db.runTransaction(async (tx) => {
      const state = {};
      for (const r of unique) {
        const result = await tx.collection(r.collection).doc(r.id).get();
        if (result.code) throw new HttpError(503, "云数据库读取失败");
        state[`${r.collection}/${r.id}`] = Array.isArray(result.data)
          ? result.data[0]
          : result.data;
      }
      const writes = await build(state);
      if (!Array.isArray(writes))
        throw new HttpError(400, "事务写入必须是数组");
      const audit = finalAuditWrite(writes, now);
      const allowed = new Set(unique.map((r) => `${r.collection}/${r.id}`));
      if (!allowed.has(`${audit.collection}/${audit.id}`))
        throw admissionRequired("H4-c 审计记录未在 refs 中声明");
      for (const w of writes) {
        if (w === audit) continue;
        if (!allowed.has(`${w.collection}/${w.id}`))
          throw admissionRequired("H4-c 事务包含未声明写入");
        if (!isH4cCollection(w.collection))
          throw admissionRequired("H4-c 事务不得写非 H4-c 集合");
      }
      const business = writes.filter((w) => w !== audit);
      if (business.length !== 2 && business.length !== 3)
        throw admissionRequired("H4-c 业务写必须为 2 或 3 条");
      if (business.some((w) => !C1_WRITABLE_COLLECTIONS.includes(w.collection)))
        throw admissionRequired("H4-c 运行时不得写域/证明/栅栏/标记/计划集合");
      await this.#h4cGate.verify({ state, refs: unique, writes, admission, now });
      for (const w of writes) {
        if (w === audit) continue;
        const k = `${w.collection}/${w.id}`;
        if (createOnlyCollections.has(w.collection) && state[k])
          throw new HttpError(409, "记录已存在", "CONFLICT");
        const exact = exactWriteCollections.has(w.collection);
        if (exact && (!w.data || typeof w.data !== "object" ||
            Array.isArray(w.data) || w.data._id !== w.id))
          throw new HttpError(400, "事务写入数据非法");
        const data = exact ? { ...w.data } : { ...state[k], ...w.data };
        delete data._id;
        const result = await tx.collection(w.collection).doc(w.id).set(data);
        if (result.code) throw new HttpError(503, "批量写入失败，整批回滚");
      }
      const record = { ...audit.data };
      delete record._id;
      const logged = await tx
        .collection(H4C_AUDIT_COLLECTION)
        .doc(audit.id)
        .set(record);
      if (logged?.code) throw new HttpError(503, "日志保存失败，整批回滚");
    });
  }
  async change(name, id, build, audit) {
    if (isH4cCollection(name))
      throw admissionRequired("H4-c 集合必须通过 transactFinal 写入");
    const isNew = !id;
    const initial = isNew ? await build(null) : null;
    id =
      id ||
      (name === "rooms"
        ? "room-" +
          createHash("sha256")
            .update(initial.houseId)
            .digest("hex")
            .slice(0, 32)
        : randomUUID());
    return this.db.runTransaction(async (tx) => {
      const ref = tx.collection(name).doc(id);
      const found = await ref.get();
      if (found.code) throw new HttpError(503, "云数据库读取失败");
      const old = Array.isArray(found.data) ? found.data[0] : found.data;
      if (isNew && old) throw new HttpError(409, "记录已存在");
      const value = initial || (await build(old || null));
      const record = { ...old, ...value, updatedAt: Date.now() };
      delete record._id;
      const saved = await ref.set(record);
      if (saved?.code) throw new HttpError(503, "云数据库写入失败");
      const logged = await tx
        .collection("admin_audit")
        .doc(randomUUID())
        .set({ ...audit, target: `${name}/${id}`, createdAt: Date.now() });
      if (logged?.code)
        throw new HttpError(503, "操作日志保存失败，业务写入已回滚");
      return { ...record, _id: id };
    });
  }
}
