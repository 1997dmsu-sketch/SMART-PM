import { VR_LIMIT, vrUpload, vrFile } from "./lib/vr.mjs";
import http from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, resolve, extname } from "node:path";
import { PropertyService } from "./lib/property.mjs";
import { OrgService } from "./lib/org.mjs";
import { OrgPropertyService, OpReplay, pageParams } from "./lib/property-v2.mjs";
import { PersonService } from "./lib/persons.mjs";
import { VerificationService } from "./lib/verification.mjs";
import { BlacklistService } from "./lib/blacklist.mjs";
import { OccupancyService } from "./lib/occupancies.mjs";
import { IdentityService } from "./lib/identity.mjs";
import { operationKeyId } from "./lib/claims.mjs";
import { LocalStore, CloudStore } from "./lib/store.mjs";
import { resolvePublicFile } from "./lib/static-path.mjs";
import { Accounts, publicAccount } from "./lib/auth.mjs";
import {
  authorize,
  validate,
  publicRecord,
  filterRows,
  resources,
  HttpError,
  fail,
  failCode,
} from "./lib/model.mjs";
import {
  FileService,
  fileServiceConfig,
  makeFileOp,
  PURPOSES,
} from "./lib/files.mjs";
const root = fileURLToPath(new URL(".", import.meta.url));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
async function body(req, limit = 65536, raw = false) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) fail("上传内容过大", 413);
    chunks.push(c);
  }
  const b = Buffer.concat(chunks);
  if (raw) return b;
  try {
    return JSON.parse(b.toString() || "{}");
  } catch {
    fail("JSON 格式错误");
  }
}
// DB-04 review F01: public demonstration keys are confined to demo mode.
// Live startup fails closed before opening a store or creating an HTTP server.
// Error messages deliberately identify only the setting, never its value.
export function identityKeyConfig(mode, env = process.env) {
  const live = mode === "live";
  let hmacKey = env.IDENTITY_HMAC_KEY;
  if (!hmacKey) {
    if (live) throw Error("Live mode requires IDENTITY_HMAC_KEY");
    hmacKey = "demo-identity-hmac-key-not-for-production";
  }
  if (typeof hmacKey !== "string" || hmacKey.length < 16)
    throw Error("IDENTITY_HMAC_KEY must contain at least 16 characters");
  const configuredEncryptionKey = env.IDENTITY_ENCRYPTION_KEY;
  if (!configuredEncryptionKey) {
    if (live) throw Error("Live mode requires IDENTITY_ENCRYPTION_KEY");
    return { hmacKey, encryptionKey: Buffer.alloc(32, 7) };
  }
  if (
    typeof configuredEncryptionKey !== "string" ||
    !/^[0-9a-fA-F]{64}$/.test(configuredEncryptionKey)
  )
    throw Error("IDENTITY_ENCRYPTION_KEY must be exactly 64 hexadecimal characters");
  const encryptionKey = Buffer.from(configuredEncryptionKey, "hex");
  if (encryptionKey.length !== 32)
    throw Error("IDENTITY_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return { hmacKey, encryptionKey };
}
// DB-07 §11.6：命中集合 = objectKey ∪ legacyUrls ∪ cloudFileId。四处拦截点
// 与下载都经此判定；漏掉 cloudFileId 会让 live 下按 cloud:// fileID 查询的
// 已登记图片被误判「未登记」，在默认 deny 下触发 403 静默裂图。
function assetLocators(asset) {
  return [
    asset.objectKey,
    asset.cloudFileId,
    ...(Array.isArray(asset.legacyUrls) ? asset.legacyUrls : []),
  ].filter((v) => typeof v === "string" && v);
}
function matchFileAsset(assets, candidates) {
  const wanted = candidates.filter((v) => typeof v === "string" && v);
  // F02（复审）：同一路径可能被重复登记为 public 与 private。旧实现用 find()
  // 只取首条命中，public 副本排在前面时会完全遮蔽 private 记录，使四处拦截点
  // 与 /uploads/* 静态拦截的私密判定被整体绕过（匿名下载返回 200）。改为
  // 「最严取胜」：收集全部命中，任一命中为 private 即返回该 private 记录。
  const hits = assets.filter((a) => {
    const locators = assetLocators(a);
    return wanted.some((w) => locators.includes(w));
  });
  if (!hits.length) return null;
  return hits.find((a) => a.visibility === "private") || hits[0];
}

// 只取 cloudPath / 相对路径「末段文件名」解析扩展名，绝不解析
// cloud://env.bucket/... 全串（env/bucket 里的点会污染扩展名判定，§10 3c）。
function cloudPathOf(id) {
  const m = String(id || "").match(/^cloud:\/\/[^/]+\/(.+)$/);
  return m ? m[1] : String(id || "");
}
function extOfPath(objectKey) {
  const last = String(objectKey || "").split("/").pop();
  const dot = last.lastIndexOf(".");
  return dot < 0 ? "" : last.slice(dot + 1).toLowerCase();
}
const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];
// §11.1 前缀按 storage 分叉（local: uploads/、vr-files/；cloud:
// admin/、admin-vr/；private 恒 private/）——但四处拦截点一律走「命中集合」
// (assetLocators/matchFileAsset) 而非前缀白名单，因此天然覆盖两种 storage
// 的公开前缀，不会像硬编码 admin/ 那样漏判 demo 的 /uploads/* 旧路径。
// 旧上传 purpose（§5 拦截点 4）：只产出 public；query 可覆盖为其它合法
// public purpose，private purpose 一律回退到入口缺省（私密资料必须走
// /api/v2/files），避免 purpose 与 visibility 矛盾。
function legacyPurpose(raw, fallback) {
  return typeof raw === "string" && PURPOSES[raw] && !PURPOSES[raw].private
    ? raw
    : fallback;
}
// 旧上传与 v2 上传共用硬上限；具体 purpose 的大小由 FileService.upload 校验。
const MAX_UPLOAD = Math.max(...Object.values(PURPOSES).map((p) => p.maxSize));
export async function createApp({
  mode = "demo",
  directory = join(root, ".data", mode),
  store,
  accounts,
  origin,
  secure = false,
  org,
  fileValidator = null,
  identityGateway = null,
} = {}) {
  if (!["demo", "live"].includes(mode))
    throw Error("ADMIN_MODE must be demo or live");
  if (mode === "live" && !origin)
    throw Error("Live mode requires ADMIN_ORIGIN");
  if (mode === "live" && !store)
    throw Error("Live mode requires a configured cloud store");
  const { hmacKey: identityHmacKey, encryptionKey } = identityKeyConfig(mode);
  store = store || (await new LocalStore(directory).init());
  accounts = accounts || (await new Accounts(directory).init());
  if (
    mode === "live" &&
    !accounts.rows.some((a) => a.role === "admin" && a.enabled)
  )
    throw Error("Create an administrator with npm run create-admin first");
  // DB-02 organization scope: the organization is bootstrapped with a fixed,
  // explicitly configured ID — never created from request input. In live mode
  // without org configuration the /api/v2 surface stays disabled (503).
  const orgService = new OrgService(store);
  const orgConfig =
    org || (mode === "demo"
      ? { id: "org-demo", name: "演示组织", admins: ["demo-admin"] }
      : null);
  if (orgConfig)
    await orgService.bootstrap(
      {
        id: orgConfig.id,
        name: orgConfig.name,
        adminAccountIds: orgConfig.admins || [],
      },
      { actor: "system", actorId: "system", action: "初始化组织" },
    );
  const sessions = new Map(),
    attempts = new Map();
  // fileValidator is the DB-07 interface hook — unconfigured means private
  // submissions fail closed (503).
  const identityService = new IdentityService(store, {
    hmacKey: identityHmacKey,
    gateway: identityGateway,
  });
  const sessionAge = 8 * 60 * 60 * 1000;
  // DB-07 T04：文件服务配置位（值只从环境变量读，不入库、不进日志）。
  // demo 用 LocalStore（无 app），local 适配器不需要 app；live 用 CloudStore
  // 的 app 实例复用已登录 SDK。root 指向数据目录，与旧上传写盘位置一致。
  const fileConfig = fileServiceConfig(process.env, {
    mode,
    app: store.app || null,
    root: directory,
  });
  const buildFileService = (orgId, membership, account) =>
    new FileService(store, orgId, {
      auth: { membershipId: membership?._id },
      actor: {
        actorType: "adminAccount",
        actorId: account._id,
        // 复审：私密文件授权以「组织成员角色」为准（membership.role），而非
        // 平台账号角色。未配置成员关系时回落到账号角色，保证旧链路不崩。
        role: membership?.role || account.role,
        permissions: membership?.permissions || [],
      },
      config: fileConfig,
    });
  // DB-07 §5 拦截点 4 / §6.3：旧上传写完字节后额外登记一条 public
  // file_assets（orgId=null，legacy 未归属），返回体仅追加 fileId。
  //
  // 不要「顺手统一」成 FileService.registerLegacy()（team-lead 裁定采纳规避）：
  // legacy service 的 authRefs()（files.mjs:274-279）恒带
  // ref("organizations", this.orgId)，orgId=null 时该 ref.id 为 null；live 的
  // CloudStore.transact（store.mjs:257 doc(r.id).get()）会触发 doc(null)
  // 非法读取，把改造前正常的 live 上传弄崩。故此处直接以 file_assets 为唯一
  // ref 写入，字段与 registerLegacy 记录对齐（bucket / legacyUrls /
  // visibility / status=ready，§11.5/11.6）。若将来要统一回服务层，必须先给
  // registerLegacy 加「跳过 authRefs」的 legacy 分支，否则会复现该故障。
  const registerLegacyUpload = async (account, fileUrl, detail, action) => {
    const objectKey = cloudPathOf(fileUrl).replace(/^\/+/, "");
    const fileId = `file-${randomUUID()}`;
    const now = Date.now();
    await store.transact(
      [{ collection: "file_assets", id: fileId }],
      () => [
        {
          collection: "file_assets",
          id: fileId,
          data: {
            orgId: null, // legacy 未归属，DB-08 迁移前 v2 列表不可见（§6.5）
            storage: mode === "live" ? "cloud" : "local",
            objectKey,
            bucket: "public", // 密级副本（§11.5）
            originalName: objectKey.split("/").pop(),
            mimeType: detail.mimeType || null,
            size: detail.size ?? null,
            checksum: null, // 迁移期可空
            purpose: detail.purpose,
            visibility: "public", // 旧上传只产出 public（§5）
            status: "ready", // 物理文件已写入，仅补登记
            uploadedBy: { actorType: "adminAccount", actorId: account._id },
            legacyUrls: [fileUrl], // 命中集合（§11.6）：旧 URL 兼容映射
            retentionUntil: null,
            schemaVersion: 2,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          },
        },
      ],
      { actor: account.username, actorId: account._id, action },
    );
    return fileId;
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const send = (data, status = 200) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;
      const method = req.method;
      if (!["GET", "HEAD", "POST", "PUT"].includes(method))
        fail("不支持此请求方法", 405);
      if (path.startsWith("/api/")) {
        const expectedOrigin =
          origin || `http://127.0.0.1:${server.address().port}`;
        if (
          ["POST", "PUT"].includes(method) &&
          req.headers.origin !== expectedOrigin
        )
          fail("请求来源不匹配", 403);
        if (path === "/api/config" && method === "GET")
          return send({
            mode,
            environment: mode === "live" ? process.env.CLOUDBASE_ENV_ID : null,
            version: "0.3.0-beta.1",
          });
        const token = (req.headers.cookie || "")
          .split(";")
          .map((v) => v.trim())
          .find((v) => v.startsWith("smartpm_session="))
          ?.slice(16);
        let session = token && sessions.get(token);
        if (session && session.expires < Date.now()) {
          sessions.delete(token);
          session = null;
        }
        let account = session?.account;
        if (account && account._id !== "demo-admin") {
          const current = accounts.rows.find(
            (a) =>
              a._id === account._id &&
              a.enabled &&
              a.revision === account.revision,
          );
          if (!current) {
            sessions.delete(token);
            session = null;
            account = null;
          } else account = current;
        }
        function establish(a) {
          for (const [key, value] of sessions)
            if (value.expires < Date.now()) sessions.delete(key);
          if (sessions.size >= 1000) fail("会话数已满，请稍后重试", 503);
          const key = randomBytes(32).toString("hex"),
            csrf = randomBytes(24).toString("hex");
          if (token) sessions.delete(token);
          sessions.set(key, {
            account: a,
            csrf,
            expires: Date.now() + sessionAge,
          });
          res.setHeader(
            "Set-Cookie",
            `smartpm_session=${key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionAge / 1000}${secure ? "; Secure" : ""}`,
          );
          return send({ account: publicAccount(a), csrf, mode });
        }
        if (path === "/api/demo-login" && method === "POST") {
          if (mode !== "demo") fail("正式环境无演示入口", 404);
          return establish({
            _id: "demo-admin",
            name: "演示管理员",
            username: "demo",
            role: "admin",
            enabled: true,
          });
        }
        if (path === "/api/login" && method === "POST") {
          const ip = req.socket.remoteAddress;
          const now = Date.now();
          for (const [key, v] of attempts)
            if (v.until < now) attempts.delete(key);
          const throttle = attempts.get(ip) || {
            count: 0,
            until: now + 15 * 60000,
          };
          if (throttle.count >= 8) fail("尝试次数过多，请 15 分钟后重试", 429);
          throttle.count++;
          attempts.set(ip, throttle);
          const data = await body(req);
          const a = await accounts.login(data.username, data.password);
          if (!a) fail("账号或密码错误", 401);
          attempts.delete(ip);
          return establish(a);
        }
        if (!session || !account) fail("请先登录管理后台", 401);
        if (
          ["POST", "PUT"].includes(method) &&
          req.headers["x-csrf-token"] !== session.csrf
        )
          fail("会话校验失败，请重新登录", 403);
        if (path === "/api/me" && method === "GET")
          return send({
            account: publicAccount(account),
            csrf: session.csrf,
            mode,
          });
        if (path === "/api/logout" && method === "POST") {
          sessions.delete(token);
          res.setHeader(
            "Set-Cookie",
            `smartpm_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`,
          );
          return send({ ok: true });
        }
        const audit = (action) => ({
          actor: account.username,
          actorId: account._id,
          action,
        });
        if (path.startsWith("/api/property/")) {
          authorize(account.role, "rooms", method !== "GET");
          const service = new PropertyService(store);
          if (path === "/api/property/snapshot" && method === "GET")
            return send(await service.snapshot());
          if (method === "POST") {
            const data = await body(req);
            if (path === "/api/property/auto-floors")
              return send(
                await service.autoFloors(data, audit("自动填充楼层")),
                201,
              );
            if (path === "/api/property/auto-rooms")
              return send(
                await service.autoRooms(data, audit("自动填充房间")),
                201,
              );
            if (path === "/api/property/create")
              return send(
                await service.createProperty(data, audit("添加物业")),
                201,
              );
            if (path === "/api/property/catalog")
              return send(
                await service.createCatalog(data, audit("新增物业目录")),
                201,
              );
            if (path === "/api/property/rooms")
              return send(
                await service.createRooms(data, audit("批量新增房间")),
                201,
              );
            if (path === "/api/property/layout")
              return send(
                await service.batchLayout(data, audit("批量设置户型")),
              );
            if (path === "/api/property/assign")
              return send(
                await service.assignRoom(data.id, data, audit("归档房间")),
              );
          }
          fail("接口不存在", 404);
        }
        // DB-02 organization-scoped API (docs/database/API-CONTRACT.md §2).
        // Envelope {data,requestId,nextCursor?} / {error:{code,message},requestId};
        // the organization context always comes from server-side membership,
        // never from request body fields.
        if (path.startsWith("/api/v2/")) {
          const requestId = randomUUID();
          const ok = (data, status = 200, nextCursor) =>
            send(nextCursor ? { data, requestId, nextCursor } : { data, requestId }, status);
          const v2Code = (e) =>
            e.code ||
            { 400: "PARAM_ERROR", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT" }[e.status] ||
            "ADAPTER_UNAVAILABLE";
          try {
            if (!orgConfig)
              failCode("ADAPTER_UNAVAILABLE", "组织服务未配置", 503);
            const memberships = await orgService.organizationsFor(
              "adminAccount",
              account._id,
            );
            if (path === "/api/v2/me/organizations" && method === "GET")
              return ok(memberships);
            const wanted = req.headers["x-org-id"] || url.searchParams.get("orgId");
            let orgId = typeof wanted === "string" && wanted ? wanted : null;
            if (!orgId) {
              if (memberships.length === 1) orgId = memberships[0].orgId;
              else if (memberships.length === 0)
                failCode("NOT_FOUND", "组织不存在或不可见", 404);
              else failCode("PARAM_ERROR", "请通过 X-Org-Id 指定组织");
            }
            // DB-07 §9.2 / §10-7：文件写接口一律用 {write:false} 过组织成员
            // 校验，再由 authorize() 做第一道分级、FileService.assertActorRole
            // 做第二道——否则 org.mjs:152「仅 admin 可写」会把 editor 挡在成员
            // 校验层，测不到 §5 的真实分级（public 允许 editor / private 收紧
            // 到 admin）。property 路由保持既有「POST 即 write:true」不变。
            const isFileRoute =
              path.startsWith("/api/v2/files") ||
              path.startsWith("/api/v2/file-links");
            const write = method === "POST" && !isFileRoute;
            const { membership } = await orgService.requireMembership(
              "adminAccount",
              account._id,
              orgId,
              { write },
            );
            const service = new OrgPropertyService(store, orgId, {
              membershipId: membership._id,
            });
            const persons = new PersonService(store, orgId, {
              membershipId: membership._id,
            });
            const verification = new VerificationService(
              store,
              orgId,
              { membershipId: membership._id },
              { identity: identityService, encryptionKey, fileValidator },
            );
            const blacklist = new BlacklistService(
              store,
              orgId,
              { membershipId: membership._id },
              { fileValidator },
            );
            const occupancies = new OccupancyService(
              store,
              orgId,
              { membershipId: membership._id },
              { blacklist },
            );
            const auditV2 = (action) => ({
              actor: account.username,
              actorId: account._id,
              action,
              orgId,
            });
            const query = Object.fromEntries(url.searchParams);
            // ── DB-07 T04：v2 文件资源路由（§3 / §5 / §7）──────────────
            // 整块独立处理：上传是 raw body，必须绕开下方通用 POST 块的
            // JSON.parse；下载返回字节流/302，不走 ok() 的 JSON 信封。
            if (isFileRoute) {
              const files = buildFileService(orgId, membership, account);
              // 与 DB-02 一致的 Idempotency-Key → operation_keys 幂等（§12）。
              const fileOp = (payload) => {
                const key = req.headers["idempotency-key"];
                if (typeof key !== "string" || !key.trim() || key.length > 120)
                  failCode("PARAM_ERROR", "缺少有效的 Idempotency-Key");
                return makeFileOp({
                  actorId: account._id,
                  orgId,
                  route: path,
                  key: key.trim(),
                  body: payload,
                });
              };

              // POST /api/v2/files：上传（private 响应不含 url）。
              if (path === "/api/v2/files" && method === "POST") {
                authorize(account.role, "uploads", true); // 第一道：editor 可写
                const purpose = url.searchParams.get("purpose") || "content-image";
                // 复审：未知 purpose 必须在读取请求体前拒绝，避免按兜底上限收包。
                if (!PURPOSES[purpose])
                  failCode("PARAM_ERROR", "文件用途无效");
                const name = url.searchParams.get("name") || "";
                // 复审：必须在读取请求体**之前**按 purpose 限制大小，不能先收 50MB 再拒绝。
                const purposeLimit = PURPOSES[purpose].maxSize ?? MAX_UPLOAD;
                const bytes = await body(req, Math.min(purposeLimit, MAX_UPLOAD), true);
                const op = fileOp({
                  purpose,
                  name,
                  checksum: createHash("sha256").update(bytes).digest("hex"),
                });
                const result = await files.upload(
                  { bytes, purpose, originalName: name },
                  auditV2("上传文件"),
                  op,
                );
                return ok(result, 201);
              }
              // GET /api/v2/files：列表（orgId 过滤先于分页）。
              if (path === "/api/v2/files" && method === "GET") {
                const { data, nextCursor } = await files.list(query);
                return ok(data, 200, nextCursor);
              }
              // POST /api/v2/file-links：关联。
              if (path === "/api/v2/file-links" && method === "POST") {
                authorize(account.role, "uploads", true);
                const data = await body(req);
                return ok(
                  await files.attach(data, auditV2("关联文件"), fileOp(data)),
                  201,
                );
              }
              // GET /api/v2/file-links：只返回 attached。FileService 未导出
              // link 列表方法，本期在 server 层只读实现（不碰 files.mjs，
              // 保持 C3 单文件提交）；team-lead 裁定采纳此取舍。
              // TODO(DB-08): FileService 增加 link 列表方法后收敛回服务层，
              // 保持「file_links 唯一读取入口」的形状。
              if (path === "/api/v2/file-links" && method === "GET") {
                const { cursor, limit } = pageParams(query);
                // 复审「分页前过滤」：关联所指文件若私密且调用者无权读取，则在
                // 分页前剔除，不泄露私密关联；与 list() 同策略，共用 canReadFile。
                const fileById = new Map(
                  (await store.list("file_assets", orgId)).map((f) => [f._id, f]),
                );
                const linkVisible = (l) => {
                  const f = fileById.get(l.fileId);
                  return !!f && files.canReadFile(f);
                };
                let rows = (await store.list("file_links", orgId)).filter(
                  (l) =>
                    l.orgId === orgId &&
                    l.state === "attached" &&
                    (query.entityType === undefined ||
                      l.entityType === query.entityType) &&
                    (query.entityId === undefined ||
                      l.entityId === query.entityId) &&
                    linkVisible(l),
                );
                rows.sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
                let start = 0;
                if (cursor) {
                  start = rows.findIndex((r) => r._id === cursor) + 1;
                  if (start === 0)
                    failCode("PARAM_ERROR", "分页游标无效或已过期");
                }
                const slice = rows.slice(start, start + limit + 1);
                const data = slice.slice(0, limit);
                return ok(
                  data,
                  200,
                  slice.length > limit ? data[data.length - 1]._id : undefined,
                );
              }
              // POST /api/v2/file-links/{id}/detach：只改 link.state（需求 8）。
              const detachMatch = path.match(
                /^\/api\/v2\/file-links\/([^/]+)\/detach$/,
              );
              if (detachMatch && method === "POST") {
                authorize(account.role, "uploads", true);
                const data = await body(req);
                return ok(
                  await files.detach(
                    decodeURIComponent(detachMatch[1]),
                    data,
                    auditV2("解绑文件"),
                    fileOp(data),
                  ),
                );
              }
              // GET /api/v2/files/{id}/download：逐次鉴权 + 字节流 / 302。
              const downloadMatch = path.match(
                /^\/api\/v2\/files\/([^/]+)\/download$/,
              );
              if (downloadMatch && method === "GET") {
                const entityRef = {
                  entityType: query.entityType,
                  entityId: query.entityId,
                };
                const result = await files.authorizeDownload(
                  decodeURIComponent(downloadMatch[1]),
                  undefined,
                  entityRef,
                );
                if (result.tempUrl) {
                  res.writeHead(302, {
                    Location: result.tempUrl,
                    "Cache-Control": "no-store",
                  });
                  return res.end();
                }
                res.setHeader("Content-Type", result.contentType);
                res.setHeader(
                  "Content-Disposition",
                  `attachment; filename*=UTF-8''${encodeURIComponent(result.originalName || "download")}`,
                );
                res.setHeader(
                  "Content-Security-Policy",
                  "sandbox; default-src 'none'",
                );
                return res.end(result.bytes);
              }
              // POST /api/v2/files/{id}/retire：只改 status（需求 8）。
              const retireMatch = path.match(
                /^\/api\/v2\/files\/([^/]+)\/retire$/,
              );
              if (retireMatch && method === "POST") {
                authorize(account.role, "uploads", true);
                const data = await body(req);
                return ok(
                  await files.retire(
                    decodeURIComponent(retireMatch[1]),
                    auditV2("归档文件"),
                    fileOp(data),
                  ),
                );
              }
              // POST /api/v2/files/{id}/face-review：人脸审核。
              // 权限由服务层按当前成员记录校验 device.face.review（不再要求 admin），
              // 角色 authorize 不参与，避免专职审核员被 editor/viewer 角色挡住。
              const faceReviewMatch = path.match(
                /^\/api\/v2\/files\/([^/]+)\/face-review$/,
              );
              if (faceReviewMatch && method === "POST") {
                const data = await body(req);
                return ok(
                  await files.reviewFace(
                    {
                      fileId: decodeURIComponent(faceReviewMatch[1]),
                      decision: data.decision,
                    },
                    auditV2("人脸审核"),
                    fileOp(data),
                  ),
                );
              }
              fail("接口不存在", 404);
            }
            if (path === "/api/v2/property/catalog" && method === "GET") {
              const { data, nextCursor } = await service.listCatalog(query);
              return ok(data, 200, nextCursor);
            }
            if (path === "/api/v2/rooms" && method === "GET") {
              const { data, nextCursor } = await service.listRooms(query);
              return ok(data, 200, nextCursor);
            }
            const occupancyList = path.match(/^\/api\/v2\/rooms\/([^/]+)\/occupancies$/);
            if (occupancyList && method === "GET") {
              const { data, nextCursor } = await occupancies.listOccupancies(
                decodeURIComponent(occupancyList[1]), query,
              );
              return ok(data, 200, nextCursor);
            }
            const materialization = path.match(/^\/api\/v2\/occupancy-materializations\/([^/]+)$/);
            if (materialization && method === "GET")
              return ok(await occupancies.getMaterialization(decodeURIComponent(materialization[1])));
            if (path === "/api/v2/persons" && method === "GET") {
              const { data, nextCursor } = await persons.listPersons(query);
              return ok(
                data.map((p) => ({
                  personId: p._id,
                  orgId: p.orgId,
                  userId: p.userId,
                  nameMasked: p.nameMasked,
                  status: p.status,
                  revision: p.revision,
                })),
                200,
                nextCursor,
              );
            }
            if (path === "/api/v2/identity-applications" && method === "GET") {
              const { data, nextCursor } = await verification.listApplications(query);
              return ok(data, 200, nextCursor);
            }
            if (path === "/api/v2/blacklist" && method === "GET") {
              const { data, nextCursor } = await blacklist.listEntries(
                query,
                auditV2("读取内部黑名单"),
              );
              return ok(data, 200, nextCursor);
            }
            const privateMatch = path.match(
              /^\/api\/v2\/identity-applications\/([^/]+)\/private$/,
            );
            if (privateMatch && method === "GET")
              return ok(
                await verification.readPrivate(
                  decodeURIComponent(privateMatch[1]),
                  auditV2("读取实名私有资料"),
                ),
              );
            const applicationMatch = path.match(
              /^\/api\/v2\/identity-applications\/([^/]+)$/,
            );
            if (applicationMatch && method === "GET")
              return ok(
                await verification.getApplication(
                  decodeURIComponent(applicationMatch[1]),
                ),
              );
            if (method === "POST") {
              const data = await body(req);
              const key = req.headers["idempotency-key"];
              if (typeof key !== "string" || !key.trim() || key.length > 120)
                failCode("PARAM_ERROR", "缺少有效的 Idempotency-Key");
              const bodyDigest = createHash("sha256")
                .update(JSON.stringify(data ?? null))
                .digest("hex");
              const op = {
                id: operationKeyId(account._id, orgId, path, key.trim()),
                actorId: account._id,
                orgId,
                route: path,
                keyDigest: createHash("sha256").update(key.trim()).digest("hex"),
                bodyDigest,
              };
              const existing = (await store.list("operation_keys")).find(
                (r) => r._id === op.id,
              );
              if (existing) {
                if (existing.expiresAt && existing.expiresAt < Date.now())
                  failCode(
                    "IDEMPOTENCY_EXPIRED",
                    "幂等键已过期，请先查询操作状态并使用新键",
                    409,
                  );
                if (existing.bodyDigest !== bodyDigest)
                  failCode(
                    "IDEMPOTENCY_CONFLICT",
                    "相同幂等键的请求内容不一致，请勿修改后重试",
                    409,
                  );
                const stored = JSON.parse(existing.resultRef);
                return ok(stored.body, stored.status);
              }
              if (path === "/api/v2/property/create")
                return ok(
                  await service.createProperty(data, auditV2("添加物业"), op),
                  201,
                );
              if (path === "/api/v2/property/catalog")
                return ok(
                  await service.createCatalog(data, auditV2("新增物业目录"), op),
                  201,
                );
              if (path === "/api/v2/property/layout")
                return ok(
                  await service.batchLayout(data, auditV2("批量设置户型"), op),
                );
              if (path === "/api/v2/persons")
                return ok(
                  await persons.createPerson(data, auditV2("新增人员档案"), op),
                  201,
                );
              const cycleCreate = path.match(/^\/api\/v2\/rooms\/([^/]+)\/occupancy-cycles$/);
              if (cycleCreate)
                return ok(await occupancies.createCycle(
                  decodeURIComponent(cycleCreate[1]), data, auditV2("创建主租客入住周期"), op,
                ), 201);
              if (path === "/api/v2/occupancies")
                return ok(await occupancies.createOccupancy(
                  data, auditV2("邀请入住成员"), op,
                ), 201);
              const primaryTransfer = path.match(/^\/api\/v2\/rooms\/([^/]+)\/primary-transfer$/);
              if (primaryTransfer)
                return ok(await occupancies.transferPrimary(
                  decodeURIComponent(primaryTransfer[1]), data, auditV2("更换主租客"), op,
                ), 201);
              const occupancyAction = path.match(/^\/api\/v2\/occupancies\/([^/]+)\/(activate|end)$/);
              if (occupancyAction) {
                const id = decodeURIComponent(occupancyAction[1]);
                const action = occupancyAction[2];
                return ok(await occupancies[action](
                  id, data, auditV2(action === "activate" ? "激活入住关系" : "结束入住关系"), op,
                ));
              }
              if (path === "/api/v2/identity-applications")
                return ok(
                  await verification.createApplication(data, auditV2("新建实名申请"), op),
                  201,
                );
              if (path === "/api/v2/blacklist")
                return ok(
                  await blacklist.createEntry(data, auditV2("新增内部黑名单"), op),
                  201,
                );
              const blacklistRevoke = path.match(
                /^\/api\/v2\/blacklist\/([^/]+)\/revoke$/,
              );
              if (blacklistRevoke)
                return ok(await blacklist.revokeEntry(
                  decodeURIComponent(blacklistRevoke[1]),
                  data,
                  auditV2("解除内部黑名单"),
                  op,
                ));
              const blacklistReview = path.match(
                /^\/api\/v2\/occupancies\/([^/]+)\/blacklist-review$/,
              );
              if (blacklistReview)
                return ok(await blacklist.reviewOccupancy(
                  decodeURIComponent(blacklistReview[1]),
                  data,
                  auditV2("复核入住名单"),
                  op,
                ));
              const actionMatch = path.match(
                /^\/api\/v2\/identity-applications\/([^/]+)\/(submit|supplement|review|provider-start)$/,
              );
              if (actionMatch) {
                const id = decodeURIComponent(actionMatch[1]);
                const action = actionMatch[2];
                if (action === "provider-start")
                  return ok(await verification.providerStart());
                return ok(
                  await verification[action](
                    id,
                    data,
                    auditV2({ submit: "提交实名资料", supplement: "补充实名资料", review: "审核实名申请" }[action]),
                    op,
                  ),
                );
              }
              const archiveMatch = path.match(
                /^\/api\/v2\/property\/(community|building|floor|layout|room|house)\/([^/]+)\/archive$/,
              );
              if (archiveMatch) {
                const label = {
                  community: "小区",
                  building: "楼栋",
                  floor: "楼层",
                  layout: "户型",
                  room: "房间",
                  house: "房源",
                }[archiveMatch[1]];
                return ok(
                  await service.archive(
                    archiveMatch[1],
                    decodeURIComponent(archiveMatch[2]),
                    data,
                    auditV2(`归档${label}`),
                    op,
                  ),
                );
              }
              fail("接口不存在", 404);
            }
            fail("接口不存在", 404);
          } catch (error) {
            if (error instanceof OpReplay) {
              const stored = JSON.parse(error.resultRef);
              return ok(stored.body, stored.status);
            }
            return send(
              {
                error: {
                  code: v2Code(error),
                  message: error.status
                    ? error.message
                    : "服务暂不可用，请检查服务端配置与日志",
                  ...(error.restriction === "occupancy.create" && error.occupancyId
                    ? { restriction: error.restriction, occupancyId: error.occupancyId }
                    : {}),
                },
                requestId,
              },
              error.status || 503,
            );
          }
        }
        if (path === "/api/dashboard" && method === "GET") {
          const [houses, content, users, rooms] = (
            await Promise.all(resources.map((n) => store.list(n)))
          ).map((rows) => rows.filter((r) => !r.orgId)); // F01: legacy views exclude v2 records
          const activity =
            account.role === "admin"
              ? [...(await store.list("admin_audit")), ...accounts.events]
                  .filter((r) => !r.orgId)
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .slice(0, 5)
              : [];
          return send({
            counts: {
              houses: houses.length,
              published: houses.filter((h) => h.status === "在租").length,
              content: content.length,
              drafts: content.filter((c) => !c.enabled).length,
              users: users.length,
              unbound: users.filter((u) => !u.houses?.length).length,
              rooms: rooms.length,
            },
            recent: houses
              .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
              .slice(0, 5),
            activity,
          });
        }
        if (path === "/api/password" && method === "POST") {
          if (account._id === "demo-admin")
            fail("演示入口没有密码，请使用后台账号登录");
          const data = await body(req);
          const key = "password:" + account._id;
          const throttle = attempts.get(key) || {
            count: 0,
            until: Date.now() + 15 * 60000,
          };
          if (throttle.until < Date.now()) {
            throttle.count = 0;
            throttle.until = Date.now() + 15 * 60000;
          }
          if (throttle.count >= 8) fail("尝试次数过多，请稍后重试", 429);
          throttle.count++;
          attempts.set(key, throttle);
          if (!(await accounts.login(account.username, data.oldPassword)))
            fail("当前密码错误", 400);
          await accounts.save(
            { ...publicAccount(account), password: data.newPassword },
            account._id,
            account.username,
          );
          attempts.delete(key);
          sessions.delete(token);
          return send({ ok: true });
        }
        if (path === "/api/accounts") {
          authorize(account.role, "accounts", method !== "GET");
          if (method === "GET")
            return send({ rows: accounts.rows.map(publicAccount) });
          const data = await body(req);
          if (data.id === account._id)
            fail("当前账号不能在此修改自身权限或密码");
          const saved = await accounts.save(data, data.id, account.username);
          return send(saved);
        }
        if (path === "/api/audit" && method === "GET") {
          authorize(account.role, "audit");
          const rows = [
            ...(await store.list("admin_audit")),
            ...accounts.events,
          ]
            .filter((r) => !r.orgId) // F01: v2 actions are org-scoped, not legacy-visible
            .sort((a, b) => b.createdAt - a.createdAt);
          return send(filterRows(rows, Object.fromEntries(url.searchParams)));
        }
        if (path === "/api/vr-upload" && method === "POST") {
          authorize(account.role, "uploads", true);
          const name = url.searchParams.get("name") || "";
          const bytes = await body(req, VR_LIMIT, true);
          const ext = vrUpload(bytes, name);
          const filename = `${randomUUID()}.${ext}`;
          let fileUrl;
          if (mode === "live") {
            const result = await store.app.uploadFile({
              cloudPath: `admin-vr/${filename}`,
              fileContent: bytes,
            });
            if (!result.fileID) fail("云存储上传失败", 502);
            fileUrl = result.fileID;
          } else {
            await mkdir(join(directory, "vr-files"), { recursive: true });
            await writeFile(join(directory, "vr-files", filename), bytes, {
              mode: 0o600,
            });
            fileUrl = `/vr-files/${filename}`;
          }
          // DB-07 §5 拦截点 4：双写 file_assets（public），返回体仅追加 fileId。
          // vr-attachment 是 public（§5 定性），故 §10-4 的 legacy 200 不回退。
          const fileId = await registerLegacyUpload(
            account,
            fileUrl,
            {
              purpose: legacyPurpose(
                url.searchParams.get("purpose"),
                "vr-attachment",
              ),
              mimeType: ext === "zip" ? "application/zip" : "text/html",
              size: bytes.length,
            },
            "上传 VR 附件",
          );
          return send({ url: fileUrl, name, size: bytes.length, fileId });
        }
        if (path === "/api/vr-download" && method === "GET") {
          authorize(account.role, "content");
          const record = (await store.list("content")).find(
            (r) => r._id === url.searchParams.get("id"),
          );
          // R2-02/F01: legacy endpoints must not serve org-scoped records;
          // check ownership BEFORE any cloud download or local file read.
          // New lists hiding the ID is not a substitute for download authz.
          if (record?.orgId) fail("VR 文件不存在", 404);
          const file = vrFile(record?.vrFile);
          if (!file) fail("VR 文件不存在", 404);
          // DB-07 §5 拦截点 2（最小加法，保持 legacy-only）：仅当 vrFile.url
          // 命中 file_assets 且 private → 404，与「不存在」同态防枚举。
          // 命中集合（§11.6）= objectKey ∪ legacyUrls ∪ cloudFileId；候选同时
          // 覆盖带/不带前导斜杠与 cloud:// 全串/末段两种存法。vr-attachment
          // 登记为 public，故 R2-02（server-v2.test.mjs:342-424）legacy 200
          // 语义不回退。不新增 purpose/引用对象判定。
          const vrHit = matchFileAsset(await store.list("file_assets"), [
            file.url,
            file.url.replace(/^\//, ""),
            cloudPathOf(file.url),
          ]);
          if (vrHit && vrHit.visibility === "private")
            fail("VR 文件不存在", 404);
          let bytes;
          if (mode === "live") {
            if (!file.url.startsWith("cloud://")) fail("文件不属于云存储");
            const result = await store.app.downloadFile({ fileID: file.url });
            bytes = result.fileContent;
          } else {
            if (!file.url.startsWith("/vr-files/")) fail("文件不属于本地存储");
            bytes = await readFile(
              join(directory, "vr-files", file.url.split("/").pop()),
            );
          }
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="vr-project.${file.url.endsWith(".zip") ? "zip" : "html"}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          );
          res.setHeader(
            "Content-Security-Policy",
            "sandbox; default-src 'none'",
          );
          return res.end(bytes);
        }
        if (path === "/api/uploads" && method === "POST") {
          authorize(account.role, "uploads", true);
          const bytes = await body(req, 5 * 1024 * 1024, true);
          let ext;
          if (
            bytes.length > 8 &&
            bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          )
            ext = "png";
          else if (
            bytes.length > 3 &&
            bytes[0] === 255 &&
            bytes[1] === 216 &&
            bytes[2] === 255
          )
            ext = "jpg";
          else if (
            bytes.length > 12 &&
            bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WEBP"
          )
            ext = "webp";
          else fail("仅支持 PNG、JPEG 或 WebP 图片");
          const filename = `${randomUUID()}.${ext}`;
          let fileUrl;
          if (mode === "live") {
            const result = await store.app.uploadFile({
              cloudPath: `admin/${filename}`,
              fileContent: bytes,
            });
            if (!result.fileID) fail("云存储上传失败，请检查权限", 502);
            fileUrl = result.fileID;
          } else {
            await mkdir(join(directory, "uploads"), { recursive: true });
            await writeFile(join(directory, "uploads", filename), bytes, {
              mode: 0o600,
            });
            fileUrl = `/uploads/${filename}`;
          }
          // DB-07 §5 拦截点 4：双写 file_assets（public），返回体仅追加 fileId。
          const fileId = await registerLegacyUpload(
            account,
            fileUrl,
            {
              purpose: legacyPurpose(
                url.searchParams.get("purpose"),
                "content-image",
              ),
              mimeType: { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[ext],
              size: bytes.length,
            },
            "上传图片",
          );
          return send({ url: fileUrl, fileId });
        }
        if (path === "/api/image-url" && method === "GET") {
          const id = url.searchParams.get("id");
          // ① 补齐 authorize（三种角色均通过，零兼容影响）。
          authorize(account.role, "content");
          if (mode !== "live" || !id?.startsWith("cloud://"))
            fail("图片地址无效");
          // 扩展名只取 cloudPath 末段，不解析 cloud://env.bucket/… 全串。
          const cloudPath = cloudPathOf(id);
          const ext = extOfPath(cloudPath);
          // 命中集合（§11.6）= objectKey ∪ legacyUrls ∪ cloudFileId：
          // live 下按 cloud:// fileID 查询也能命中已登记记录。
          const hit = matchFileAsset(await store.list("file_assets"), [
            id,
            cloudPath,
          ]);
          // ② 命中且 private → 403，与 fallback 开关无关（红线，§10-3）。
          if (hit && hit.visibility === "private")
            failCode("FILE_FORBIDDEN", "私密图片禁止签发临时 URL", 403);
          if (!hit) {
            // ③ 未命中但路径含 private/ → 403（private/ 两侧恒生效，§11.1）。
            if (/private\//.test(cloudPath))
              failCode("FILE_FORBIDDEN", "私密路径禁止签发临时 URL", 403);
            // ④ 未命中且非图片类型 → 403（「图片接口只服务图片」作用域
            // 约束，非密级判定；挡 admin-vr/*.zip|html，§10-3c）。
            if (!IMAGE_EXTS.includes(ext))
              failCode("FILE_FORBIDDEN", "图片接口仅服务图片类型", 403);
            // ⑤ 未命中且为旧图片 admin/<uuid>.(png|jpg|webp) → 按
            // FILE_LEGACY_IMAGE_FALLBACK（默认 deny → 403，§10-3b/14）。
            const fallback =
              process.env.FILE_LEGACY_IMAGE_FALLBACK ||
              fileConfig.FILE_LEGACY_IMAGE_FALLBACK ||
              "deny";
            if (fallback !== "allow")
              failCode("FILE_FORBIDDEN", "未登记的旧图片默认拒绝签发", 403);
          }
          const result = await store.app.getTempFileURL({
            fileList: [{ fileID: id, maxAge: 600 }],
          });
          return send({ url: result.fileList[0]?.tempFileURL || "" });
        }
        const parts = path.split("/").filter(Boolean),
          resource = parts[1],
          id = parts[2];
        if (!resources.includes(resource) || parts.length > 4)
          fail("接口不存在", 404);
        authorize(account.role, resource, method !== "GET");
        if (
          parts[3] === "binding" &&
          resource === "users" &&
          method === "POST"
        ) {
          const data = await body(req);
          if (!["bind", "unbind"].includes(data.action)) fail("绑定操作无效");
          const rooms = (await store.list("rooms")).filter((r) => !r.orgId);
          if (
            typeof data.houseId !== "string" ||
            !data.houseId ||
            data.houseId.length > 80
          )
            fail("房产编号无效");
          if (
            data.action === "bind" &&
            !rooms.some((r) => r.houseId === data.houseId)
          )
            fail("请先在房产管理中创建有效房产");
          const result = await store.change(
            "users",
            id,
            (old) => {
              if (!old) fail("用户不存在", 404);
              const houses = Array.isArray(old.houses) ? old.houses : [];
              return {
                houses:
                  data.action === "bind"
                    ? [...new Set([...houses, data.houseId])]
                    : houses.filter((h) => h !== data.houseId),
                housesManaged: true,
              };
            },
            audit(data.action === "bind" ? "绑定房产" : "解绑房产"),
          );
          return send(publicRecord("users", result));
        }
        if (parts[3]) fail("接口不存在", 404);
        if (method === "GET" && !id) {
          const rows = (await store.list(resource))
            .filter((r) => !r.orgId) // F01: v2 records are invisible to legacy lists
            .map((r) => publicRecord(resource, r));
          return send(
            filterRows(
              rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
              Object.fromEntries(url.searchParams),
            ),
          );
        }
        if ((method === "POST" && !id) || (method === "PUT" && id)) {
          if (resource === "users" && !id) fail("用户由小程序授权登录创建");
          const input = await body(req);
          const data = validate(resource, input);
          // F01: legacy writes must not touch organization-scoped records.
          if (id) {
            const targeted = (await store.list(resource)).find(
              (r) => r._id === id,
            );
            if (targeted?.orgId) fail("记录不存在", 404);
          }
          if (
            mode === "live" &&
            [data.cover, data.image, ...(data.images || [])].some((v) =>
              v?.startsWith("/"),
            )
          )
            fail("真实环境图片需上传至云存储或使用 HTTPS 地址");
          if (resource === "houses") {
            const old = id
              ? (await store.list("houses")).find((r) => r._id === id)
              : null;
            if (id && !old) fail("记录不存在", 404);
            // F04: an archived listing stays off-market; legacy edits cannot
            // re-publish it (customer queries filter on status).
            if (old?.lifecycle === "archived" && data.status !== "下架")
              fail("已归档房源不能重新上架", 409);
            const roomId = old?.propertyRoomId || input.propertyRoomId;
            if (
              old?.propertyRoomId &&
              input.propertyRoomId &&
              old.propertyRoomId !== input.propertyRoomId
            )
              fail("已关联房源不可更换房间");
            if (roomId)
              return send(
                await new PropertyService(store).saveListing(
                  id,
                  data,
                  roomId,
                  audit(id ? "编辑关联房源" : "新增关联房源"),
                ),
                id ? 200 : 201,
              );
          }
          if (resource === "rooms") {
            const rows = await store.list("rooms");
            if (id && rows.find((r) => r._id === id)?.floorId)
              fail("已归档房间请从整栋物业页面维护");
            if (rows.some((r) => r.houseId === data.houseId && r._id !== id))
              fail("房产编号已存在", 409);
            if (id && rows.find((r) => r._id === id)?.houseId !== data.houseId)
              fail("已有房产编号不可修改");
          }
          const result = await store.change(
            resource,
            id,
            (old) => {
              if (id && !old) fail("记录不存在", 404);
              return data;
            },
            audit(id ? "编辑记录" : "新增记录"),
          );
          return send(publicRecord(resource, result), id ? 200 : 201);
        }
        fail("接口不存在", 404);
      }
      if (method !== "GET" && method !== "HEAD") fail("不支持此请求方法", 405);
      let file;
      if (path.startsWith("/uploads/")) {
        if (
          mode !== "demo" ||
          !/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(path)
        )
          fail("文件不存在", 404);
        // DB-07 §5 拦截点 3：保留 demo-only + 严格正则 + 静态分支不查会话，
        // 只新增「命中 file_assets 且 private → 404」。命中集合（§11.6）=
        // objectKey ∪ legacyUrls ∪ cloudFileId；候选覆盖 /uploads/x 与
        // uploads/x 两种存法。命中场景是「已登记为私密的旧路径文件」，
        // 不是 private 前缀文件落错目录（private objectKey 恒在 private/，
        // 本就不落 /uploads/，§11.1）。正负对照见 §10-4b：同目录未改密的
        // public 旧图片仍 200。
        const staticHit = matchFileAsset(await store.list("file_assets"), [
          path,
          path.slice(1),
        ]);
        if (staticHit && staticHit.visibility === "private")
          fail("文件不存在", 404);
        file = join(directory, path);
      } else {
        file = resolvePublicFile(root, path);
      }
      let bytes;
      try {
        bytes = await readFile(file);
      } catch (e) {
        if (e.code === "ENOENT" || e.code === "EISDIR") fail("文件不存在", 404);
        throw e;
      }
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
      });
      res.end(method === "HEAD" ? undefined : bytes);
    } catch (error) {
      if (!res.headersSent) {
        if (!error.status)
          console.error("Admin request failed:", error.code || error.name);
        send(
          {
            error: error.status
              ? error.message
              : "服务暂不可用，请检查服务端配置与日志",
          },
          error.status || 503,
        );
      } else res.end();
    }
  });
  return { server, store, accounts };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const mode = process.env.ADMIN_MODE || "demo";
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || "127.0.0.1";
  let store;
  const origin = process.env.ADMIN_ORIGIN || `http://127.0.0.1:${port}`;
  if (mode === "demo" && !["127.0.0.1", "localhost", "::1"].includes(host))
    throw Error("Demo mode is local-only");
  if (mode === "live") {
    if (
      !process.env.ADMIN_ORIGIN ||
      !process.env.CLOUDBASE_ENV_ID ||
      !process.env.TENCENTCLOUD_SECRETID ||
      !process.env.TENCENTCLOUD_SECRETKEY
    )
      throw Error("Missing live configuration; see docs/ADMIN-WEB.md");
    if (
      !origin.startsWith("https://") &&
      !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)
    )
      throw Error("Live public origin requires HTTPS");
    const { default: cloudbase } = await import("@cloudbase/node-sdk");
    const app = cloudbase.init({
      env: process.env.CLOUDBASE_ENV_ID,
      secretId: process.env.TENCENTCLOUD_SECRETID,
      secretKey: process.env.TENCENTCLOUD_SECRETKEY,
    });
    store = new CloudStore(app);
  }
  const app = await createApp({
    mode,
    directory: process.env.ADMIN_DATA_DIR || join(root, ".data", mode),
    store,
    origin,
    secure: origin.startsWith("https://"),
    // DB-02: fixed organization identity comes from configuration only.
    org: process.env.ADMIN_ORG_ID
      ? {
          id: process.env.ADMIN_ORG_ID,
          name: process.env.ADMIN_ORG_NAME || process.env.ADMIN_ORG_ID,
          admins: (process.env.ADMIN_ORG_ADMINS || "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        }
      : undefined,
  });
  app.server.listen(port, host, () =>
    console.log(
      `宇宙物业管理后台：${origin} (${mode === "demo" ? "本地演示，不连接云端" : "真实云环境"})`,
    ),
  );
}
