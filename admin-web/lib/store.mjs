import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { HttpError } from "./model.mjs";
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
];
export function seed() {
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
  };
}
export class LocalStore {
  #dispatchNow;
  #dispatchTime = 0;

  constructor(directory, { dispatchNow = Date.now } = {}) {
    this.#dispatchNow = dispatchNow;
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
      await this.persist(this.data);
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
    return this;
  }
  async persist(data) {
    const file = join(this.directory, "demo-data.json");
    await writeFile(file + ".tmp", JSON.stringify(data), { mode: 0o600 });
    await rename(file + ".tmp", file);
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
    return this.#transact(refs, build, audit);
  }
  // H3 runs only on a single, shared synthetic LocalStore instance.
  faceDispatchTime() {
    const now = this.#dispatchNow();
    if (!Number.isSafeInteger(now) || now < this.#dispatchTime) {
      throw new HttpError(503, "派发时钟不可用");
    }
    this.#dispatchTime = now;
    return now;
  }
  async transactFaceDispatch(refs, build) {
    if (refs.length > 90) throw new HttpError(400, "派发事务引用超限");
    return this.#transact(refs, (state) => build(state, this.faceDispatchTime()), null, true);
  }
  async #transact(refs, build, audit, dispatch = false) {
    const task = this.queue.then(async () => {
      const next = structuredClone(this.data);
      const state = Object.fromEntries(
        refs.map(({ collection, id }) => [
          `${collection}/${id}`,
          structuredClone(
            (next[collection] || []).find((r) => r._id === id) || null,
          ),
        ]),
      );
      const writes = await build(state);
      if (dispatch && writes.length === 0) return;
      const allowed = new Set(refs.map((r) => `${r.collection}/${r.id}`));
      for (const w of writes) {
        if (!allowed.has(`${w.collection}/${w.id}`))
          throw Error("Undeclared transaction write");
        const rows = (next[w.collection] ||= []);
        const index = rows.findIndex((r) => r._id === w.id);
        if (w.collection === "face_dispatch_snapshots" && index >= 0) {
          throw new HttpError(409, "派发快照不可覆盖");
        }
        if (dispatch && (w.collection !== "device_operation_jobs" &&
            (w.collection !== "device_operation_logs" || index >= 0))) {
          throw Error("Invalid dispatch write");
        }
        const record = {
          ...(index < 0 ? {} : rows[index]),
          ...w.data,
          _id: w.id,
          ...(!dispatch && w.collection !== "face_dispatch_snapshots" ? { updatedAt: Date.now() } : {}),
        };
        if (index < 0) rows.push(record);
        else rows[index] = record;
      }
      if (!dispatch) next.admin_audit.unshift({
        ...audit,
        _id: randomUUID(),
        target: writes.map((w) => `${w.collection}/${w.id}`).join(", "),
        createdAt: Date.now(),
      });
      await this.persist(next);
      this.data = next;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async change(name, id, build, audit) {
    if (name === "face_dispatch_snapshots") throw new HttpError(409, "派发快照不可覆盖");
    const task = this.queue.then(async () => {
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
      await this.persist(next);
      this.data = next;
      return structuredClone(record);
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
export class CloudStore {
  constructor(app) {
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
    const unique = [
      ...new Map(refs.map((r) => [`${r.collection}/${r.id}`, r])).values(),
    ];
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
      const allowed = new Set(unique.map((r) => `${r.collection}/${r.id}`));
      for (const w of writes) {
        const k = `${w.collection}/${w.id}`;
        if (!allowed.has(k)) throw Error("Undeclared transaction write");
        const data = { ...state[k], ...w.data, updatedAt: Date.now() };
        delete data._id;
        const result = await tx.collection(w.collection).doc(w.id).set(data);
        if (result.code) throw new HttpError(503, "批量写入失败，整批回滚");
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
  async change(name, id, build, audit) {
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
