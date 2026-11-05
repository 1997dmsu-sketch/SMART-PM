// DB-07 T03 文件服务层（docs/database/DB-07-IMPLEMENTATION.md §2/§3/§5/§7）。
//
// FileService 是 file_assets / file_links / file_access_log 的唯一写入口：
// 鉴权（组织上下文、purpose/visibility 分级）全部在服务层完成，适配器只做
// 传输，因此「鉴权先于读取」可被独立断言。审计由 store.transact / store.change
// 自动写入（store.mjs:163-168 / :196-201 / :260-268）。
//
// 约束：
// - 不改 server.mjs、不改云函数、不改小程序；本文件纯新增。
// - detach 只改 file_links.state，绝不改 file_assets.status、绝不删物理文件。
// - retire 只改 status，绝不删物理对象。
// - private 文件不得挂到 houses/content 的公开展示 usage。
// - NAS 未实现时任何路径都不回退到公开路径。
import { randomUUID, createHash } from "node:crypto";
import { failCode } from "./model.mjs";
import { OpReplay, pageParams } from "./property-v2.mjs";
import { operationKeyId } from "./claims.mjs";
import {
  selectStorage,
  storageConfigFromEnv,
  LocalStorageAdapter,
  CloudStorageAdapter,
} from "./storage.mjs";

const ref = (collection, id) => ({ collection, id });
const base = () => ({ schemaVersion: 2, revision: 1, createdAt: Date.now() });
const MB = 1024 * 1024;

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"];
const ALL_MIMES = [
  ...IMAGE_MIMES,
  "application/pdf",
  "application/zip",
  "text/html",
];

// purpose 决定大小 / mime / visibility / 权限点（§2.1、§5）。
// visibility 完全由服务端派生，不接受客户端入参；identity-document 与 evidence
// 强制 private，客户端传 public 无效。
//
// 复审（DB-07 二次审查）要求「区分私密文件的上传与读取权限」：二者不再共用
// 同一个权限点。规则如下——
//   writePermission：私密文件「写入」（上传/登记/关联/解绑/归档）所需权限点；
//     为 null 时回落到组织成员角色——仅组织管理员（membership.role==="admin"）
//     可写私密文件。写入按「角色」管控，与 DB-02/03 的组织角色模型一致。
//   readPermission：私密文件「读取」（下载/列表可见/关联可见）所需权限点；
//     为 null 时回落到组织管理员角色。读取按「权限点」管控，与 DB-04/06 的
//     证件审查 / 黑名单读取权限模型一致。
// 因此：无 readPermission 的组织管理员可上传证件、却无权下载他人证件；持有
// readPermission 的审阅员可下载、但（非管理员）无权上传——读写权限彻底分立。
export const PURPOSES = {
  "listing-image": {
    maxSize: 5 * MB,
    accept: IMAGE_MIMES,
    visibility: "public",
    private: false,
    writePermission: null,
    readPermission: null,
  },
  "content-image": {
    maxSize: 5 * MB,
    accept: IMAGE_MIMES,
    visibility: "public",
    private: false,
    writePermission: null,
    readPermission: null,
  },
  "vr-attachment": {
    maxSize: 50 * MB,
    accept: ["application/zip", "text/html"],
    visibility: "public",
    private: false,
    writePermission: null,
    readPermission: null,
  },
  "identity-document": {
    maxSize: 5 * MB,
    accept: [...IMAGE_MIMES, "application/pdf"],
    visibility: "private",
    private: true,
    writePermission: null, // 写入：组织管理员角色
    readPermission: "identity.readPrivate", // 读取：证件私密读取权限点（DB-04 证件审查「读」子集）
  },
  evidence: {
    maxSize: 50 * MB,
    accept: ALL_MIMES,
    visibility: "private",
    private: true,
    writePermission: null, // 写入：组织管理员角色
    readPermission: "blacklist.read", // 读取：黑名单读取权限点（DB-06）
  },
  // HK-AI-03：人脸生物特征。约束由任务卡与设备侧 ISAPI 文档共同决定：
  // - 只能 private，永远不得进入公开图片/内容/VR/房源/静态 /uploads 路由；
  // - 仅 JPEG/PNG，单文件 ≤200KB（与《人员管理(以人为中心)》人脸图片要求一致）；
  // - 写入需 device.face.submit，读取需 device.face.readPrivate；
  //   审核动作（device.face.review）不隐含读原图权限，由服务层单独校验。
  "face-biometric": {
    maxSize: 200 * 1024,
    accept: ["image/jpeg", "image/png"],
    visibility: "private",
    private: true,
    writePermission: "device.face.submit",
    readPermission: "device.face.readPrivate",
  },
  other: {
    maxSize: 5 * MB,
    accept: ALL_MIMES,
    visibility: "public",
    private: false,
    writePermission: null,
    readPermission: null,
  },
};

export const ENTITY_TYPES = [
  "houses",
  "content",
  "property_catalog",
  "rooms",
  "identity_application",
  "blacklist_entry",
];
export const USAGES = ["cover", "gallery", "vr", "identity-doc", "evidence", "other"];
const DISPLAY_USAGES = ["cover", "gallery", "vr"];
const PRIVATE_ENTITIES = ["identity_application", "blacklist_entry"];
// 本期已存在的业务集合；identity_application / blacklist_entry 由 DB-03/04
// 建立，尚未进入 store 白名单，故不做事务内 entity 复查（见回报）。
const KNOWN_ENTITY_COLLECTIONS = ["houses", "content", "property_catalog", "rooms"];

// mime 嗅探：复用 server.mjs:546-566 的图片 magic bytes 思路，并补上
// vr.mjs:46-73 的 ZIP/HTML 判定与 PDF 头。拒绝一切无法识别的内容。
export function sniffMime(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (
    b.length > 8 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { mime: "image/png", ext: "png" };
  if (b.length > 3 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return { mime: "image/jpeg", ext: "jpg" };
  if (
    b.length > 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return { mime: "image/webp", ext: "webp" };
  if (b.length >= 5 && b.toString("ascii", 0, 5) === "%PDF-")
    return { mime: "application/pdf", ext: "pdf" };
  if (
    b.length > 4 &&
    b[0] === 80 &&
    b[1] === 75 &&
    ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6))
  )
    return { mime: "application/zip", ext: "zip" };
  if (/<(!doctype\s+html|html|head|body)\b/i.test(b.subarray(0, 65536).toString("utf8")))
    return { mime: "text/html", ext: "html" };
  return null;
}

// ObjectKey 前缀约定（§5）：private/<orgId>/<purpose>/… 恒为私密前缀；
// 公开前缀按 storage 区分——cloud 用既有 cloudPath（admin/、admin-vr/），
// local 用 demo 既有相对路径（uploads/、vr-files/），保持 /uploads/* 静态
// 与旧前端兼容（§2.1「local=相对路径」、§1.1、§6）。
export function objectKeyFor(purpose, visibility, orgId, ext, storage) {
  const name = `${randomUUID()}.${ext}`;
  if (visibility === "private")
    return `private/${orgId}/${purpose}/${name}`;
  if (storage === "cloud")
    return purpose === "vr-attachment" ? `admin-vr/${name}` : `admin/${name}`;
  return purpose === "vr-attachment" ? `vr-files/${name}` : `uploads/${name}`;
}

// 确定性关联 ID，与 claims.mjs:7-8 同构（固定 ID 复用，重放安全）。
export const fileLinkId = (orgId, entityType, entityId, fileId, usage) =>
  `link-${createHash("sha256")
    .update(JSON.stringify([orgId, entityType, entityId, fileId, usage]))
    .digest("hex")}`;

// 旧 URL → 定位符/密级推导（与 scripts/file-inventory.mjs 的 classify 对齐）。
export function inferLegacy(url) {
  const u = String(url || "").trim();
  if (/^https:\/\//.test(u))
    return { storage: "external", objectKey: u, visibility: "public", purpose: "other" };
  if (/^cloud:\/\//.test(u)) {
    const match = u.match(/^cloud:\/\/[^/]+\/(.+)$/);
    const path = match ? match[1] : u;
    if (path.startsWith("private/"))
      return { storage: "cloud", objectKey: path, visibility: "private", purpose: "other" };
    if (path.startsWith("admin-vr/"))
      return { storage: "cloud", objectKey: path, visibility: "public", purpose: "vr-attachment" };
    if (path.startsWith("admin/"))
      return { storage: "cloud", objectKey: path, visibility: "public", purpose: "content-image" };
    return { storage: "cloud", objectKey: path, visibility: "unknown", purpose: "other" };
  }
  if (/^\/uploads\//.test(u))
    return { storage: "local", objectKey: u.replace(/^\//, ""), visibility: "public", purpose: "content-image" };
  if (/^\/vr-files\//.test(u))
    return { storage: "local", objectKey: u.replace(/^\//, ""), visibility: "public", purpose: "vr-attachment" };
  if (/^\/assets\//.test(u))
    return { storage: "local", objectKey: u.replace(/^\//, ""), visibility: "public", purpose: "other" };
  return { storage: "local", objectKey: u, visibility: "unknown", purpose: "other" };
}

// 便捷构造：把环境变量配置位与运行时注入（mode/app/root）合成 FileService 的
// config。值只从环境变量读取，不入库、不进日志。
export function fileServiceConfig(env = process.env, runtime = {}) {
  return {
    ...storageConfigFromEnv(env),
    mode: runtime.mode || env.ADMIN_MODE || "demo",
    app: runtime.app || null,
    root: runtime.root,
  };
}

// 与 server.mjs:327-334 同构的幂等键构造（复用 claims.mjs operationKeyId）。
export function makeFileOp({ actorId, orgId, route, key, body }) {
  return {
    id: operationKeyId(actorId, orgId, route, key),
    actorId,
    orgId,
    route,
    keyDigest: createHash("sha256").update(key).digest("hex"),
    bodyDigest: createHash("sha256")
      .update(JSON.stringify(body ?? null))
      .digest("hex"),
  };
}

// 与 property-v2.mjs:27-62 同构的 operation_keys 写入（该模块未导出 opWrite，
// 故在此复制其语义：事务内复查 + OpReplay，过期/冲突显式拒绝）。
function opWrite(state, op, result) {
  if (!op) return [];
  const existing = state[`operation_keys/${op.id}`];
  if (existing) {
    if (existing.expiresAt && existing.expiresAt < Date.now())
      failCode("IDEMPOTENCY_EXPIRED", "幂等键已过期，请先查询操作状态并使用新键", 409);
    if (existing.bodyDigest !== op.bodyDigest)
      failCode("IDEMPOTENCY_CONFLICT", "相同幂等键的请求内容不一致，请勿修改后重试", 409);
    throw new OpReplay(existing.resultRef);
  }
  return [
    {
      collection: "operation_keys",
      id: op.id,
      data: {
        actorId: op.actorId,
        orgId: op.orgId,
        route: op.route,
        keyDigest: op.keyDigest,
        bodyDigest: op.bodyDigest,
        state: "completed",
        resultRef: JSON.stringify(result),
        expiresAt: Date.now() + 24 * 3600 * 1000,
        ...base(),
      },
    },
  ];
}

// 事务外 fast path（与 server.mjs:335-353 一致）；事务内 opWrite 仍是权威复查。
async function checkOp(store, op) {
  if (!op) return;
  const existing = (await store.list("operation_keys")).find((r) => r._id === op.id);
  if (!existing) return;
  if (existing.expiresAt && existing.expiresAt < Date.now())
    failCode("IDEMPOTENCY_EXPIRED", "幂等键已过期，请先查询操作状态并使用新键", 409);
  if (existing.bodyDigest !== op.bodyDigest)
    failCode("IDEMPOTENCY_CONFLICT", "相同幂等键的请求内容不一致，请勿修改后重试", 409);
  throw new OpReplay(existing.resultRef);
}

// 结构性兜底（§5、§10 #8b）：private 文件不得挂到 houses/content 的
// cover/gallery/vr，只能挂 identity_application / blacklist_entry，或非展示 other。
function assertAttachUsage(file, entityType, usage) {
  if (file.visibility !== "private") return;
  const display = DISPLAY_USAGES.includes(usage);
  const allowedEntity = PRIVATE_ENTITIES.includes(entityType);
  if (display || (!allowedEntity && usage !== "other"))
    failCode("PURPOSE_FORBIDDEN", "私密文件不得用于公开展示用途", 403);
}

export class FileService {
  constructor(store, orgId, { auth = null, actor = null, config = {} } = {}) {
    this.store = store;
    this.orgId = orgId;
    // auth: {membershipId} —— 事务内复查成员关系（property-v2.mjs:158-172 同构）
    // actor: {actorType, actorId, role, permissions} —— 权限分级与操作者留痕
    this.auth = auth;
    this.actor = actor || {
      actorType: "unknown",
      actorId: "unknown",
      role: "viewer",
      permissions: [],
    };
    this.config = config;
    this.mode = config.mode || "demo";
  }

  own(record) {
    return record && record.orgId === this.orgId;
  }

  authRefs() {
    return [
      ref("organizations", this.orgId),
      ...(this.auth ? [ref("org_memberships", this.auth.membershipId)] : []),
    ];
  }

  authCheck(state, { requireAdmin = false } = {}) {
    const org = state[`organizations/${this.orgId}`];
    if (org && org.status !== "active")
      failCode("FORBIDDEN", "组织当前不可用", 403);
    if (!this.auth) return;
    const m = state[`org_memberships/${this.auth.membershipId}`];
    if (!m || m.orgId !== this.orgId || m.status !== "active")
      failCode("FORBIDDEN", "组织成员关系已失效或权限不足", 403);
    if (requireAdmin && m.role !== "admin")
      failCode("FORBIDDEN", "仅组织管理员可执行此操作", 403);
  }

  // 权限分级（§5 / §9.2）：server 层用 {write:false} 调 requireMembership 后再
  // authorize() 做第一道，服务层按 purpose/visibility 做第二道，使 editor 能
  // 写 public、private 收紧到组织管理员角色。
  //
  // 这是「写入」闸口（上传/登记/关联/解绑/归档）。复审要求写入与读取分立：
  // 写入按【组织成员角色】管控（permission 为 null 时仅 membership.role==="admin"
  // 可写私密），不消耗 readPermission；读取由 authorizeDownload / canReadFile
  // 按 readPermission 另行判定。若某 purpose 声明了专属 writePermission，则
  // 任何角色（含 admin）都必须先持有该权限点，admin 仅作为未声明时的回落。
  assertActorRole(privateRequired, permission = null) {
    const role = this.actor.role;
    if (privateRequired) {
      // 写入权限点优先（仅当 purpose 显式声明 writePermission）。本表当前
      // 各私密 purpose 的 writePermission 均为 null，故私密写入一律回落到
      // 组织管理员角色——与「读」所需的 identity.readPrivate / blacklist.read 彻底
      // 分开，避免「能读就能写 / 能写就能读」的越权。
      if (permission) {
        if ((this.actor.permissions || []).includes(permission)) return;
        failCode("FORBIDDEN", `缺少权限点 ${permission}，无法操作私密文件`, 403);
      }
      if (role === "admin") return;
      failCode("FORBIDDEN", "当前角色没有私密文件操作权限", 403);
    }
    if (!["admin", "editor"].includes(role))
      failCode("FORBIDDEN", "当前角色没有文件写权限", 403);
  }

  async findEntity(entityType, entityId) {
    if (!KNOWN_ENTITY_COLLECTIONS.includes(entityType)) return null;
    try {
      return (await this.store.list(entityType)).find((r) => r._id === entityId) || null;
    } catch {
      return null;
    }
  }

  // 已登记文件按自身 storage 取适配器（下载用），nas 一律 503。
  adapterForFile(file) {
    if (file.storage === "nas")
      failCode("STORAGE_UNAVAILABLE", "NAS 存储未实现，拒绝回退到公开路径", 503);
    if (file.storage === "cloud")
      return new CloudStorageAdapter({ app: this.config.app, mode: this.mode });
    return new LocalStorageAdapter({ root: this.config.root, mode: this.mode });
  }

  // cloud 的 read/tempUrl/head 需要 cloud:// fileID（server.mjs:523、:586），
  // 而 objectKey 是 cloudPath；上传成功后把 SDK 返回的 fileID 单独写入
  // cloudFileId（§11.2），下载时从这里取对象定位。local 直接用相对路径
  // objectKey。legacyUrls 只保存改造前已存在的旧 URL 兼容映射，绝不落库
  // 临时下载 URL，也绝不混入正常上传产生的 fileID（否则污染 §10 第 14 条
  // 覆盖率统计与盘点脚本判定）。
  //
  // 上线门槛（方案 §9-4 / §11.2 同款）：live 云分支在隔离环境探针确认线上
  // cloud:// fileID 的真实形态（env/bucket 前缀、是否带查询串等）前不得宣称
  // 可用，本地串行不构成证明（与 DB-02/03 云端门槛一致）；未确认前 cloud
  // 分支的 read/tempUrl 无法压测，也无从校验本定位映射是否成立。
  locatorFor(file) {
    if (file.storage === "cloud")
      return file.cloudFileId || file.objectKey;
    return file.objectKey;
  }

  // entityRef 可选 {entityType, entityId}：T04 的下载入口传入引用对象后，
  // 留痕可追溯到「从哪条业务记录下载」，否则保持 null。
  async logAccess(action, fileId, actor, entityRef = {}) {
    await this.store.change(
      "file_access_log",
      null,
      () => ({
        orgId: this.orgId,
        fileId,
        action,
        actorType: actor.actorType || "unknown",
        actorId: actor.actorId || "unknown",
        entityType: entityRef?.entityType ?? null,
        entityId: entityRef?.entityId ?? null,
        createdAt: Date.now(),
      }),
      {
        actor: actor.actorId || "unknown",
        actorId: actor.actorId || "unknown",
        action: action === "download" ? "文件下载" : "文件下载被拒",
        orgId: this.orgId,
      },
    );
  }

  // 上传两阶段（§3 末尾 / §7）：①事务创建 staged → ②adapter.upload →
  // ③成功事务改 ready（校验实际 size）、失败事务改 quarantined。② 之前崩溃的
  // 记录永远停在 staged，attach 因 status!=='ready' 被拒。
  async upload(input, audit, op = null) {
    const { bytes, purpose, originalName } = input || {};
    if (!Buffer.isBuffer(bytes) || !bytes.length)
      failCode("PARAM_ERROR", "上传内容为空");
    const policy = PURPOSES[purpose];
    if (!policy) failCode("PARAM_ERROR", "文件用途无效");
    const sniffed = sniffMime(bytes);
    if (!sniffed) failCode("PARAM_ERROR", "无法识别的文件类型");
    if (!policy.accept.includes(sniffed.mime))
      failCode("PARAM_ERROR", "文件类型与用途不匹配");
    if (bytes.length > policy.maxSize)
      failCode("PARAM_ERROR", "文件超过该用途的大小上限");
    const name =
      typeof originalName === "string" && originalName.trim()
        ? originalName.slice(0, 180)
        : `${randomUUID()}.${sniffed.ext}`;

    this.assertActorRole(policy.private, policy.writePermission);
    // visibility 由 purpose 派生，完全忽略客户端传入值。
    const visibility = policy.visibility;

    // 关键：先选择适配器。解析到 nas / live+local / 未配置的 cloud 会直接
    // 抛 503，此时尚未创建任何 file_assets 记录（文件表零新增）。
    const adapter = selectStorage({
      mode: this.mode,
      purpose,
      config: this.config,
    });
    await checkOp(this.store, op);

    const fileId = `file-${randomUUID()}`;
    const objectKey = objectKeyFor(
      purpose,
      visibility,
      this.orgId,
      sniffed.ext,
      adapter.kind,
    );
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const now = Date.now();
    const staged = {
      orgId: this.orgId,
      storage: adapter.kind,
      objectKey,
      bucket: visibility, // 密级副本，供拦截点快速判定（§11.5）
      originalName: name,
      mimeType: sniffed.mime,
      size: bytes.length,
      checksum,
      purpose,
      visibility,
      status: "staged",
      uploadedBy: { actorType: this.actor.actorType, actorId: this.actor.actorId },
      legacyUrls: [],
      retentionUntil: null,
      ...base(),
      updatedAt: now,
    };
    const opRefs = op ? [ref("operation_keys", op.id)] : [];

    // ① 事务创建 staged。
    await this.store.transact(
      [ref("file_assets", fileId), ...this.authRefs(), ...opRefs],
      (state) => {
        this.authCheck(state);
        return [{ collection: "file_assets", id: fileId, data: staged }];
      },
      audit,
    );

    // ② 字节写入。任何失败都转 quarantined，绝不产生 ready。
    // 注（Q03 未定）：失败不写 operation_keys 完成态，重放同一幂等键会
    // 重试并再留下一条 quarantined 孤儿；本期不清理任何物理文件或孤儿记录。
    let uploadResult;
    try {
      uploadResult = await adapter.upload(objectKey, bytes, sniffed.mime);
      if (!uploadResult || uploadResult.size !== bytes.length)
        throw new Error("上传后大小校验不一致");
    } catch (error) {
      await this.store.transact(
        [ref("file_assets", fileId), ...this.authRefs()],
        (state) => {
          const current = state[`file_assets/${fileId}`];
          if (!current || current.status !== "staged") return [];
          return [
            {
              collection: "file_assets",
              id: fileId,
              data: { status: "quarantined", revision: 2 },
            },
          ];
        },
        audit,
      );
      throw error;
    }

    // ③ 成功事务改 ready + operation_keys（同一事务）。
    // public 返回旧格式 url 供旧前端直接使用：cloud 为 SDK 返回的 cloud://
    // fileID（/api/image-url?id=… 的形态），local 为 /uploads/<uuid>.<ext>；
    // private 不返回 url。
    //
    // cloudFileId（§11.2）：仅 storage==='cloud' 且上传成功后写入，值是
    // SDK 返回的对象定位（cloud://…），供 read/tempUrl 使用；绝不落库临时
    // 下载 URL。legacyUrls 语义是「改造前旧 URL 兼容映射」，正常上传产生的
    // 记录保持 staged 时的空数组，绝不混入 fileID —— 否则会污染 §10 第 14
    // 条覆盖率统计与盘点脚本「是否已登记」判定，把新文件误判为遗留文件。
    const url =
      visibility === "public"
        ? adapter.kind === "cloud"
          ? uploadResult.fileID
          : `/${objectKey}`
        : undefined;
    const cloudFileId =
      adapter.kind === "cloud" ? uploadResult.fileID || null : null;
    const readyData = { status: "ready", revision: 2 };
    if (cloudFileId) readyData.cloudFileId = cloudFileId;
    let result;
    await this.store.transact(
      [ref("file_assets", fileId), ...this.authRefs(), ...opRefs],
      (state) => {
        const current = state[`file_assets/${fileId}`];
        if (!current || current.status !== "staged")
          failCode("FILE_NOT_READY", "文件状态已变更，请重试", 409);
        result = {
          fileId,
          storage: adapter.kind,
          objectKey,
          purpose,
          visibility,
          status: "ready",
          size: bytes.length,
          mimeType: sniffed.mime,
          originalName: name,
          revision: 2,
        };
        if (url) result.url = url; // private 不返回 url
        const opw = opWrite(state, op, { status: 201, body: result });
        this.authCheck(state);
        return [
          {
            collection: "file_assets",
            id: fileId,
            data: readyData,
          },
          ...opw,
        ];
      },
      audit,
    );
    return result;
  }

  // 登记旧 URL 引用（§6.2）：只补 file_assets 记录，不搬迁物理文件、不写字节、
  // 不联网。已登记（命中集合 objectKey ∪ legacyUrls ∪ cloudFileId，§11.6）
  // 则直接返回既有记录。
  async registerLegacy(input, audit) {
    const list = Array.isArray(input?.urls) ? input.urls : [input || {}];
    const results = [];
    for (const item of list) {
      const url = String(item.url || "").trim();
      if (!url) failCode("PARAM_ERROR", "缺少旧 URL");
      const inferred = inferLegacy(url);
      const purpose = item.purpose || inferred.purpose || "other";
      const policy = PURPOSES[purpose];
      if (!policy) failCode("PARAM_ERROR", "文件用途无效");
      const visibility =
        (policy.private ? "private" : null) ||
        item.visibility ||
        inferred.visibility;
      if (!["public", "private"].includes(visibility))
        failCode("PARAM_ERROR", "密级无法判定，需人工复核后显式指定 visibility");
      this.assertActorRole(visibility === "private", policy.writePermission);
      const orgId = item.orgId === undefined ? null : item.orgId;
      const objectKey = item.objectKey || inferred.objectKey || url;
      const storage = item.storage || inferred.storage || "local";
      const now = Date.now();

      const assets = await this.store.list("file_assets");
      // 命中集合（§11.6）= objectKey ∪ legacyUrls ∪ cloudFileId。
      // live 下旧 URL 常以 cloud:// fileID 形式出现，只比对 objectKey 会
      // 把已登记记录误判成「未登记」，默认 deny 下即 403 → 存量图片静默裂图。
      const locators = (a) =>
        [
          a.objectKey,
          a.cloudFileId,
          ...(Array.isArray(a.legacyUrls) ? a.legacyUrls : []),
        ].filter((v) => typeof v === "string" && v);
      const existing = assets.find(
        (a) => locators(a).includes(url) || locators(a).includes(objectKey),
      );
      if (existing) {
        // F02（复审）：重复登记不得让 private 密级丢失。旧实现命中即原样返回，
        // 同一 URL/objectKey 先登记 public、再登记 private 时，private 被静默
        // 丢弃，读侧再也看不到私密记录 → 私密拦截被绕过。此处只升不降。
        if (visibility === "private" && existing.visibility !== "private") {
          const upgraded = await this.store.change(
            "file_assets",
            existing._id,
            (old) => ({ ...old, visibility: "private", updatedAt: Date.now() }),
            audit,
          );
          results.push(upgraded || existing);
          continue;
        }
        results.push(existing);
        continue;
      }
      // 事务内复查需要真实组织上下文（§5）。authRefs()（本文件 :274）恒带
      // ref("organizations", this.orgId)，**只用 this.orgId**，与 item.orgId 无关；
      // this.orgId 为 null 时 live 的 CloudStore.transact（store.mjs:257
      // doc(r.id).get()）会触发 doc(null) 非法读取 —— 改造前正常的 live 上传
      // 就是这么被打断的（见 server.mjs registerLegacyUpload 处的规避注释，
      // 那边已注明若将来统一回服务层必须先有本分支）。
      // 故**仅当本服务实例没有组织上下文**时跳过 authRefs/authCheck，只登记
      // file_assets 一条。注意不要连 item.orgId 一起判：服务实例有真实组织
      // 而 item.orgId=null 时，authRefs() 拼出的是合法 ref，成员关系复查本该
      // 照常执行，跳过即等于白白放宽一次鉴权。
      const hasOrgContext = this.orgId != null;
      const fileId = `file-${randomUUID()}`;
      await this.store.transact(
        [ref("file_assets", fileId), ...(hasOrgContext ? this.authRefs() : [])],
        (state) => {
          if (hasOrgContext) this.authCheck(state);
          return [
            {
              collection: "file_assets",
              id: fileId,
              data: {
                orgId, // legacy 未归属 → v2 列表不可见（§6.5）
                storage,
                objectKey,
                bucket: visibility, // 密级副本，供拦截点快速判定（§11.5）
                originalName: item.originalName || String(objectKey).split("/").pop(),
                mimeType: item.mimeType || null,
                size: item.size ?? null,
                checksum: null, // 迁移期可空
                purpose,
                visibility,
                status: "ready", // 物理文件已存在，仅补登记
                uploadedBy: {
                  actorType: this.actor.actorType,
                  actorId: this.actor.actorId,
                },
                legacyUrls: [url],
                retentionUntil: null,
                ...base(),
                updatedAt: now,
              },
            },
          ];
        },
        audit,
      );
      results.push({ fileId, objectKey, visibility, purpose, status: "ready" });
    }
    return results.length === 1 ? results[0] : results;
  }

  // 读取可见性判定（复审「读写权限分立」+「分页前过滤」共用）：调用者能否
  // 查看该文件？公开文件一律可见；私密文件需持有该 purpose 的 readPermission，
  // 未声明 readPermission 的私密文件回落到组织管理员角色。返回布尔，供
  // list() 在分页前剔除无权查看的记录、以及链接列表过滤复用，避免私密元数据
  // 经列表/关联泄露（F03），也避免无权记录占用分页槽位。
  canReadFile(file, actor = this.actor) {
    if (!file || file.visibility !== "private") return true;
    const readPermission = PURPOSES[file.purpose]?.readPermission;
    if (readPermission)
      return (actor.permissions || []).includes(readPermission);
    return actor.role === "admin";
  }

  // 列表：orgId 过滤先于分页（§3、store.mjs:130-135）。
  async list(query = {}) {
    const { cursor, limit } = pageParams(query);
    if (query.purpose !== undefined && !PURPOSES[query.purpose])
      failCode("PARAM_ERROR", "文件用途无效");
    if (
      query.visibility !== undefined &&
      !["public", "private"].includes(query.visibility)
    )
      failCode("PARAM_ERROR", "visibility 无效");
    let rows = (await this.store.list("file_assets", this.orgId)).filter((r) =>
      this.own(r),
    );
    if (query.purpose) rows = rows.filter((r) => r.purpose === query.purpose);
    if (query.visibility)
      rows = rows.filter((r) => r.visibility === query.visibility);
    if (query.entityType !== undefined || query.entityId !== undefined) {
      const links = (await this.store.list("file_links", this.orgId)).filter(
        (l) =>
          l.state === "attached" &&
          (query.entityType === undefined || l.entityType === query.entityType) &&
          (query.entityId === undefined || l.entityId === query.entityId),
      );
      const ids = new Set(links.map((l) => l.fileId));
      rows = rows.filter((r) => ids.has(r._id));
    }
    // 复审「分页前过滤」：无权查看的私密文件（缺 readPermission 且非组织管理员）
    // 在分页切片之前剔除，既不泄露私密元数据（F03），也不占用分页槽位。
    rows = rows.filter((r) => this.canReadFile(r));
    rows.sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
    let start = 0;
    if (cursor) {
      start = rows.findIndex((r) => r._id === cursor) + 1;
      if (start === 0) failCode("PARAM_ERROR", "分页游标无效或已过期");
    }
    const slice = rows.slice(start, start + limit + 1);
    const data = slice.slice(0, limit);
    return {
      data,
      nextCursor: slice.length > limit ? data[data.length - 1]._id : undefined,
    };
  }

  // 关联：事务内校验 status=ready、双方 orgId 一致（不符 ORG_MISMATCH）、
  // private 不得挂公开展示 usage。linkId 为确定性固定 ID。
  async attach(input, audit, op = null) {
    const { fileId, entityType, entityId, usage, sortOrder = 0 } = input || {};
    if (!ENTITY_TYPES.includes(entityType))
      failCode("PARAM_ERROR", "关联实体类型无效");
    if (!USAGES.includes(usage)) failCode("PARAM_ERROR", "关联用途无效");
    if (typeof entityId !== "string" || !entityId.trim())
      failCode("PARAM_ERROR", "关联实体编号无效");
    if (!Number.isInteger(sortOrder))
      failCode("PARAM_ERROR", "sortOrder 需为整数");
    // 失败关闭（team-lead 裁定）：这两个实体类型对应的集合本期不存在
    // （DB-03/04 才建），静默跳过 entity 侧 orgId 复查会给将来埋越权口子，
    // 且本期没有可挂的实体，拒绝的代价为零。
    // TODO(DB-03/04): 集合落地后移除此分支，并把这两个类型加入
    // KNOWN_ENTITY_COLLECTIONS，启用事务内 entity.orgId 跨组织复查。
    if (PRIVATE_ENTITIES.includes(entityType))
      failCode(
        "ENTITY_NOT_SUPPORTED",
        "该实体类型对应的集合尚未建立（DB-03/04），本期不支持关联",
        400,
      );
    await checkOp(this.store, op);

    const file = (await this.store.list("file_assets", this.orgId)).find(
      (r) => r._id === fileId,
    );
    if (!file) failCode("FILE_NOT_FOUND", "文件不存在或不可见", 404);
    if (file.status !== "ready")
      failCode("FILE_NOT_READY", "文件尚未就绪", 409);
    this.assertActorRole(file.visibility === "private", PURPOSES[file.purpose]?.writePermission);
    assertAttachUsage(file, entityType, usage);

    const entity = await this.findEntity(entityType, entityId);
    if (entity && entity.orgId && entity.orgId !== this.orgId)
      failCode("ORG_MISMATCH", "关联实体不属于当前组织", 409);

    const linkId = fileLinkId(this.orgId, entityType, entityId, fileId, usage);
    const refs = [
      ref("file_assets", fileId),
      ref("file_links", linkId),
      ...this.authRefs(),
      ...(op ? [ref("operation_keys", op.id)] : []),
    ];
    if (entity && KNOWN_ENTITY_COLLECTIONS.includes(entityType))
      refs.push(ref(entityType, entityId));

    let result;
    await this.store.transact(
      refs,
      (state) => {
        const existing = state[`file_links/${linkId}`];
        result = {
          linkId,
          fileId,
          entityType,
          entityId,
          usage,
          state: "attached",
          revision: existing ? (existing.revision ?? 0) + 1 : 1,
        };
        const opw = opWrite(state, op, { status: 201, body: result });
        this.authCheck(state);
        const now = state[`file_assets/${fileId}`];
        if (!now || now.orgId !== this.orgId)
          failCode("FILE_NOT_FOUND", "文件不存在或不可见", 404);
        if (now.status !== "ready")
          failCode("FILE_NOT_READY", "文件尚未就绪", 409);
        assertAttachUsage(now, entityType, usage);
        if (KNOWN_ENTITY_COLLECTIONS.includes(entityType)) {
          const entityNow = state[`${entityType}/${entityId}`];
          if (entityNow && entityNow.orgId && entityNow.orgId !== this.orgId)
            failCode("ORG_MISMATCH", "关联实体不属于当前组织", 409);
        }
        return [
          {
            collection: "file_links",
            id: linkId,
            data: {
              orgId: this.orgId,
              fileId,
              entityType,
              entityId,
              usage,
              sortOrder,
              state: "attached",
              attachedBy: {
                actorType: this.actor.actorType,
                actorId: this.actor.actorId,
              },
              detachedBy: null,
              revision: result.revision,
              schemaVersion: 2,
              createdAt: existing?.createdAt ?? Date.now(),
            },
          },
          ...opw,
        ];
      },
      audit,
    );
    return result;
  }

  // 解绑（需求 8）：只改 file_links.state。绝不改 file_assets.status，
  // 绝不删物理文件，也不触碰 file_assets 集合。
  async detach(linkId, input, audit, op = null) {
    const expectedRevision = input?.expectedRevision;
    if (!Number.isInteger(expectedRevision))
      failCode("PARAM_ERROR", "缺少 expectedRevision");
    await checkOp(this.store, op);
    const link = (await this.store.list("file_links", this.orgId)).find(
      (r) => r._id === linkId,
    );
    if (!link) failCode("FILE_NOT_FOUND", "关联不存在或不可见", 404);
    if (link.state !== "attached")
      return { linkId, state: "detached", revision: link.revision };
    if ((link.revision ?? 0) !== expectedRevision)
      failCode("REVISION_CONFLICT", "版本不一致，请刷新后重试", 409);
    const file = (await this.store.list("file_assets", this.orgId)).find(
      (r) => r._id === link.fileId,
    );
    const requireAdmin = file?.visibility === "private";
    this.assertActorRole(requireAdmin, PURPOSES[file?.purpose]?.writePermission);

    let result;
    await this.store.transact(
      [
        ref("file_links", linkId),
        ...this.authRefs(),
        ...(op ? [ref("operation_keys", op.id)] : []),
      ],
      (state) => {
        const now = state[`file_links/${linkId}`];
        if (!now || now.orgId !== this.orgId)
          failCode("FILE_NOT_FOUND", "关联不存在或不可见", 404);
        if ((now.revision ?? 0) !== expectedRevision)
          failCode("REVISION_CONFLICT", "版本不一致，请刷新后重试", 409);
        result = {
          linkId,
          state: "detached",
          revision: (now.revision ?? 0) + 1,
        };
        const opw = opWrite(state, op, { status: 200, body: result });
        this.authCheck(state, { requireAdmin });
        return [
          {
            collection: "file_links",
            id: linkId,
            data: {
              state: "detached",
              detachedBy: {
                actorType: this.actor.actorType,
                actorId: this.actor.actorId,
              },
              revision: result.revision,
            },
          },
          ...opw,
        ];
      },
      audit,
    );
    return result;
  }

  // 逐次下载鉴权（§7）：orgId 不匹配 / 不存在 / 非 ready / private 权限不足
  // 一律 404 FILE_NOT_FOUND（无权限与不存在同态，防枚举），并写 denied 留痕。
  // 鉴权通过后才读取字节或签发 URL；private 一律代理下载，不签发持久凭证。
  // entityRef 可选 {entityType, entityId}，由 T04 下载入口传入以写入留痕。
  async authorizeDownload(fileId, actor = this.actor, entityRef = {}) {
    const file = (await this.store.list("file_assets", this.orgId)).find(
      (r) => r._id === fileId,
    );
    const denied = async () => {
      await this.logAccess("denied", fileId, actor, entityRef);
      failCode("FILE_NOT_FOUND", "文件不存在或不可见", 404);
    };
    if (!file || !this.own(file)) await denied();
    if (file.status !== "ready") await denied();
    if (file.visibility === "private") {
      const readPermission = PURPOSES[file.purpose]?.readPermission;
      // 读取权限独立于写入（复审）：purpose 声明了 readPermission（如
      // identity-document → identity.readPrivate）时，仅凭组织管理员角色不再放行，
      // 必须持有该读取权限点；未声明 readPermission 的私密文件回落到组织管理员。
      // 未授权一律 404 与不存在同态（防枚举）。
      const allowed = this.canReadFile(file, actor);
      if (!allowed) await denied();
    }

    const adapter = this.adapterForFile(file);
    if (adapter.kind !== file.storage)
      failCode("STORAGE_UNAVAILABLE", "文件存储后端与当前配置不一致", 503);
    const locator = this.locatorFor(file);
    let bytes = null;
    let tempUrl = null;
    if (file.visibility === "private") {
      bytes = await adapter.read(locator);
    } else {
      tempUrl = await adapter.tempUrl(locator, 300);
      if (!tempUrl) bytes = await adapter.read(locator);
    }
    await this.logAccess("download", fileId, actor, entityRef);
    return {
      file,
      contentType: file.mimeType || "application/octet-stream",
      originalName: file.originalName,
      bytes,
      tempUrl,
    };
  }

  // 显式 retire：只改 file_assets.status，绝不删除物理对象（§2.4 / 需求 8）。
  async retire(fileId, audit, op = null) {
    await checkOp(this.store, op);
    const file = (await this.store.list("file_assets", this.orgId)).find(
      (r) => r._id === fileId,
    );
    if (!file) failCode("FILE_NOT_FOUND", "文件不存在或不可见", 404);
    const requireAdmin = file.visibility === "private";
    this.assertActorRole(requireAdmin, PURPOSES[file.purpose]?.writePermission);

    let result;
    await this.store.transact(
      [
        ref("file_assets", fileId),
        ...this.authRefs(),
        ...(op ? [ref("operation_keys", op.id)] : []),
      ],
      (state) => {
        const now = state[`file_assets/${fileId}`];
        if (!now || now.orgId !== this.orgId)
          failCode("FILE_NOT_FOUND", "文件不存在或不可见", 404);
        result = {
          fileId,
          status: "retired",
          revision: (now.revision ?? 0) + 1,
        };
        const opw = opWrite(state, op, { status: 200, body: result });
        this.authCheck(state, { requireAdmin });
        return [
          {
            collection: "file_assets",
            id: fileId,
            data: { status: "retired", revision: result.revision },
          },
          ...opw,
        ];
      },
      audit,
    );
    return result;
  }
}
