import { MAX_TRANSACTION_REFS } from "./manifest.mjs";

export const GLOBAL_COLLECTIONS = ["users", "auth_identities", "identity_domains"];
export const ORG_COLLECTIONS = [
  "organizations", "org_memberships", "unique_claims", "lifecycle_guards",
  "operation_keys", "persons", "identity_applications", "identity_reviews",
  "identity_private", "blacklist_entries", "blacklist_decisions",
  "eligibility_guards", "occupancy_cycles", "occupancies",
  "occupancy_applications", "room_primary_slots", "occupancy_materializations",
  "property_catalog", "rooms", "houses", "file_assets", "file_links",
  "content", "admin_audit",
];
export const COLLECTIONS = [...GLOBAL_COLLECTIONS, ...ORG_COLLECTIONS];
const COLLECTION_SET = new Set(COLLECTIONS);
const ORG_SET = new Set(ORG_COLLECTIONS);
const GLOBAL_SET = new Set(GLOBAL_COLLECTIONS);
const keyOf = ({ collection, id }) => `${collection}/${id}`;
const clone = (value) => value === undefined ? undefined : structuredClone(value);

export class ProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function invariant(condition, code, message) {
  if (!condition) throw new ProbeError(code, message);
}

export class ProbeBackend {
  constructor(config, { now = Date.now } = {}) {
    this.config = config;
    this.prefix = config.prefix;
    this.runId = config.runId;
    this.orgs = new Set([config.orgA, config.orgB]);
    this.now = now;
    this.auditSequence = 0;
    this.metrics = {
      transactionsStarted: 0,
      transactionsCommitted: 0,
      transactionsFailed: 0,
      cloudCalls: 0,
      cloudWrites: 0,
    };
  }

  id(label) {
    const id = `${this.prefix}${label}`;
    this.validateId(id);
    return id;
  }

  validateId(id) {
    invariant(typeof id === "string" && id.startsWith(this.prefix) &&
      /^[a-z0-9][a-z0-9_-]{2,159}$/.test(id),
    "PREFIX_VIOLATION", `文档 ID 必须使用本批次前缀 ${this.prefix}`);
    return id;
  }

  validateOrg(orgId) {
    invariant(this.orgs.has(orgId), "ORG_VIOLATION", "只能使用本批次的两个专用测试组织");
    return orgId;
  }

  validateCollection(collection) {
    invariant(COLLECTION_SET.has(collection), "COLLECTION_VIOLATION", "探针集合不在允许清单中");
    return collection;
  }

  refs(input, { withAudit = true } = {}) {
    invariant(Array.isArray(input), "REF_VIOLATION", "事务引用必须是数组");
    const unique = [...new Map(input.map((ref) => {
      this.validateCollection(ref?.collection);
      this.validateId(ref?.id);
      return [keyOf(ref), { collection: ref.collection, id: ref.id }];
    })).values()];
    const total = unique.length + (withAudit ? 1 : 0);
    invariant(total <= MAX_TRANSACTION_REFS, "TRANSACTION_REF_LIMIT",
      `事务总引用 ${total} 超过 ${MAX_TRANSACTION_REFS}；已在任何网络请求前拒绝`);
    return unique;
  }

  validateWrite(write, state) {
    this.validateCollection(write?.collection);
    this.validateId(write?.id);
    invariant(write.data === undefined || (write.data && typeof write.data === "object" &&
      !Array.isArray(write.data)), "WRITE_VIOLATION", "写入数据必须是对象");
    const previous = state?.[keyOf(write)] || null;
    const merged = { ...previous, ...(write.data || {}) };
    if (ORG_SET.has(write.collection)) this.validateOrg(merged.orgId);
    if (merged.orgId !== undefined) this.validateOrg(merged.orgId);
    invariant(!merged._openid && !merged.phone && !merged.documentNumber,
      "SENSITIVE_VALUE_VIOLATION", "探针禁止写入原始手机号、OPENID 或证件号");
    return merged;
  }

  audit(audit) {
    const id = this.id(`audit-${String(++this.auditSequence).padStart(6, "0")}`);
    return {
      collection: "admin_audit", id,
      data: {
        orgId: this.validateOrg(audit?.orgId || this.config.orgA),
        actorType: "db08-probe",
        actorId: this.id("actor"),
        action: String(audit?.action || "DB-08 isolated probe").slice(0, 120),
        schemaVersion: 1,
        revision: 1,
      },
    };
  }

  async transact() {
    throw new ProbeError("BACKEND_REQUIRED", "必须显式选择 LocalProbeBackend 或 CloudProbeBackend");
  }

  async query(collection, spec = {}) {
    this.validateCollection(collection);
    const orgId = spec.orgId ?? null;
    if (ORG_SET.has(collection)) this.validateOrg(orgId);
    if (GLOBAL_SET.has(collection)) invariant(orgId === null, "ORG_VIOLATION", "全局集合不能伪加组织过滤");
    const where = spec.where || {};
    invariant(where && typeof where === "object" && !Array.isArray(where),
      "QUERY_VIOLATION", "查询等值条件必须是对象");
    for (const field of Object.keys(where))
      invariant(/^(?:_id|[a-zA-Z][a-zA-Z0-9_]*)$/.test(field), "QUERY_VIOLATION", "查询字段无效");
    const orderBy = spec.orderBy || ["_id"];
    invariant(Array.isArray(orderBy) && orderBy.length >= 1 && orderBy.length <= 3 &&
      orderBy.every((field) => /^(?:_id|[a-zA-Z][a-zA-Z0-9_]*)$/.test(field)),
    "QUERY_VIOLATION", "排序字段无效");
    const limit = spec.limit ?? 100;
    const skip = spec.skip ?? 0;
    invariant(Number.isInteger(limit) && limit >= 1 && limit <= 100 &&
      Number.isInteger(skip) && skip >= 0 && skip <= 20000,
    "QUERY_VIOLATION", "查询分页超出探针边界");
    return { collection, orgId, where, orderBy, limit, skip };
  }

  async listAll(collection, spec = {}) {
    const rows = [];
    let skip = 0;
    while (true) {
      const page = await this.query(collection, { ...spec, skip, limit: 100 });
      rows.push(...page);
      if (page.length < 100) return rows;
      skip += 100;
      invariant(skip < 20000, "QUERY_CAPACITY", "探针查询超过 20,000 条容量边界");
    }
  }

  async cleanup() {
    let removed = 0;
    const verify = [];
    for (const collection of COLLECTIONS) {
      const scopes = ORG_SET.has(collection)
        ? [this.config.orgA, this.config.orgB].map((orgId) => ({ orgId }))
        : [{ orgId: null }];
      for (const scope of scopes) {
        const rows = await this.listAll(collection, {
          ...scope, where: { probeRunId: this.runId }, orderBy: ["_id"],
        });
        verify.push({ collection, scope });
        for (let offset = 0; offset < rows.length; offset += 25) {
          const refs = rows.slice(offset, offset + 25).map((row) => ({ collection, id: row._id }));
          if (!refs.length) continue;
          await this.transact(refs, () => refs.map((ref) => ({ ...ref, remove: true })),
            { action: "DB-08 fixture cleanup" }, { withAudit: false });
          removed += refs.length;
        }
      }
    }
    for (const { collection, scope } of verify) {
      const left = await this.listAll(collection, {
        ...scope, where: { probeRunId: this.runId }, orderBy: ["_id"],
      });
      invariant(!left.length, "CLEANUP_FAILED", `${collection} 仍有 ${left.length} 条本批次记录`);
    }
    return { status: "cleaned", removed, verifiedEmpty: true };
  }
}

export class LocalProbeBackend extends ProbeBackend {
  constructor(config, options = {}) {
    super(config, options);
    this.rows = new Map();
    this.queue = Promise.resolve();
  }

  seedDocument(collection, data) {
    this.validateCollection(collection);
    this.validateId(data?._id);
    const row = clone(data);
    if (ORG_SET.has(collection)) this.validateOrg(row.orgId);
    this.rows.set(`${collection}/${row._id}`, row);
  }

  async get(collection, id) {
    this.validateCollection(collection);
    this.validateId(id);
    return clone(this.rows.get(`${collection}/${id}`) || null);
  }

  async transact(inputRefs, build, audit, { withAudit = true } = {}) {
    // Validate the full budget before entering either the local queue or a cloud transaction.
    const refs = this.refs(inputRefs, { withAudit });
    const auditWrite = withAudit ? this.audit(audit) : null;
    const task = this.queue.then(async () => {
      this.metrics.transactionsStarted += 1;
      try {
        const state = Object.fromEntries(refs.map((ref) => [keyOf(ref), clone(this.rows.get(keyOf(ref)) || null)]));
        const built = await build(state);
        const writes = Array.isArray(built) ? built : built?.writes;
        invariant(Array.isArray(writes), "WRITE_VIOLATION", "事务回调必须返回写入数组或 {writes,result}");
        const allWrites = auditWrite ? [...writes, auditWrite] : writes;
        const allowed = new Set([...refs.map(keyOf), ...(auditWrite ? [keyOf(auditWrite)] : [])]);
        for (const write of allWrites) {
          invariant(allowed.has(keyOf(write)), "UNDECLARED_WRITE", "不能写入未声明的事务引用");
          if (write.remove) {
            this.rows.delete(keyOf(write));
            continue;
          }
          const merged = this.validateWrite(write, state);
          const previous = state[keyOf(write)];
          this.rows.set(keyOf(write), {
            ...merged, _id: write.id, probeRunId: this.runId,
            createdAt: previous?.createdAt ?? merged.createdAt ?? this.now(),
            updatedAt: this.now(),
          });
        }
        this.metrics.transactionsCommitted += 1;
        return Array.isArray(built) ? undefined : built?.result;
      } catch (error) {
        this.metrics.transactionsFailed += 1;
        throw error;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async query(collection, spec = {}) {
    const query = await super.query(collection, spec);
    let rows = [...this.rows.values()].filter((row) => row._id.startsWith(`${collection}/`) ||
      row._collection === collection);
    // Keys, rather than a field on the record, are the authoritative collection boundary.
    rows = [...this.rows.entries()].filter(([key]) => key.startsWith(`${collection}/`)).map(([, row]) => row);
    rows = rows.filter((row) => !query.orgId || row.orgId === query.orgId);
    rows = rows.filter((row) => Object.entries(query.where).every(([field, value]) => row[field] === value));
    const compare = (a, b) => {
      for (const field of query.orderBy) {
        const av = a[field] ?? null;
        const bv = b[field] ?? null;
        if (av === bv) continue;
        if (av === null) return -1;
        if (bv === null) return 1;
        return av < bv ? -1 : 1;
      }
      return 0;
    };
    return clone(rows.sort(compare).slice(query.skip, query.skip + query.limit));
  }
}

export class CloudProbeBackend extends ProbeBackend {
  constructor(app, config, options = {}) {
    super(config, options);
    this.app = app;
    this.db = app.database({ throwOnCode: true });
  }

  async get(collection, id) {
    this.validateCollection(collection);
    this.validateId(id);
    this.metrics.cloudCalls += 1;
    const result = await this.db.collection(collection).doc(id).get();
    invariant(!result.code, "CLOUD_READ_FAILED", `云读取失败：${result.code}`);
    const data = Array.isArray(result.data) ? result.data[0] : result.data;
    return data || null;
  }

  async transact(inputRefs, build, audit, { withAudit = true } = {}) {
    const refs = this.refs(inputRefs, { withAudit });
    const auditWrite = withAudit ? this.audit(audit) : null;
    this.metrics.transactionsStarted += 1;
    try {
      let result;
      await this.db.runTransaction(async (tx) => {
        const state = {};
        for (const ref of refs) {
          this.metrics.cloudCalls += 1;
          const found = await tx.collection(ref.collection).doc(ref.id).get();
          invariant(!found.code, "CLOUD_READ_FAILED", `事务读取失败：${found.code}`);
          state[keyOf(ref)] = Array.isArray(found.data) ? found.data[0] : found.data;
        }
        const built = await build(state);
        const writes = Array.isArray(built) ? built : built?.writes;
        invariant(Array.isArray(writes), "WRITE_VIOLATION", "事务回调必须返回写入数组或 {writes,result}");
        result = Array.isArray(built) ? undefined : built?.result;
        const allWrites = auditWrite ? [...writes, auditWrite] : writes;
        const allowed = new Set([...refs.map(keyOf), ...(auditWrite ? [keyOf(auditWrite)] : [])]);
        for (const write of allWrites) {
          invariant(allowed.has(keyOf(write)), "UNDECLARED_WRITE", "不能写入未声明的事务引用");
          const target = tx.collection(write.collection).doc(write.id);
          let saved;
          if (write.remove) {
            this.metrics.cloudCalls += 1;
            this.metrics.cloudWrites += 1;
            saved = await target.remove();
          } else {
            const data = this.validateWrite(write, state);
            delete data._id;
            const previous = state[keyOf(write)];
            Object.assign(data, {
              probeRunId: this.runId,
              createdAt: previous?.createdAt ?? data.createdAt ?? this.now(),
              updatedAt: this.now(),
            });
            this.metrics.cloudCalls += 1;
            this.metrics.cloudWrites += 1;
            saved = await target.set(data);
          }
          invariant(!saved?.code, "CLOUD_WRITE_FAILED", `事务写入失败：${saved.code}`);
        }
      });
      this.metrics.transactionsCommitted += 1;
      return result;
    } catch (error) {
      this.metrics.transactionsFailed += 1;
      throw error;
    }
  }

  async query(collection, spec = {}) {
    const query = await super.query(collection, spec);
    let request = this.db.collection(collection).where({
      ...(query.orgId ? { orgId: query.orgId } : {}),
      ...query.where,
    });
    for (const field of query.orderBy) request = request.orderBy(field, "asc");
    this.metrics.cloudCalls += 1;
    const result = await request.skip(query.skip).limit(query.limit).get();
    invariant(!result.code && Array.isArray(result.data), "CLOUD_QUERY_FAILED", "云查询失败");
    return result.data;
  }
}

export async function createCloudBackend(config, env = process.env) {
  invariant(config.mode === "execute-isolated", "EXECUTE_REQUIRED", "dry-run 禁止初始化云后端");
  invariant(env.DB08_CLOUD_SECRET_ID && env.DB08_CLOUD_SECRET_KEY,
    "CREDENTIALS_REQUIRED", "真实隔离执行必须显式提供 DB08_CLOUD_SECRET_ID 和 DB08_CLOUD_SECRET_KEY");
  // Deliberately dynamic: importing or dry-running this module never loads the SDK or credentials.
  const { default: cloudbase } = await import("@cloudbase/node-sdk");
  const app = cloudbase.init({
    env: config.envId,
    secretId: env.DB08_CLOUD_SECRET_ID,
    secretKey: env.DB08_CLOUD_SECRET_KEY,
  });
  return new CloudProbeBackend(app, config);
}
