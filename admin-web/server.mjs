import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, resolve, extname } from "node:path";
import { PropertyService } from "./lib/property.mjs";
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
} from "./lib/model.mjs";
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
export async function createApp({
  mode = "demo",
  directory = join(root, ".data", mode),
  store,
  accounts,
  origin,
  secure = false,
} = {}) {
  if (!["demo", "live"].includes(mode))
    throw Error("ADMIN_MODE must be demo or live");
  if (mode === "live" && !origin)
    throw Error("Live mode requires ADMIN_ORIGIN");
  if (mode === "live" && !store)
    throw Error("Live mode requires a configured cloud store");
  store = store || (await new LocalStore(directory).init());
  accounts = accounts || (await new Accounts(directory).init());
  if (
    mode === "live" &&
    !accounts.rows.some((a) => a.role === "admin" && a.enabled)
  )
    throw Error("Create an administrator with npm run create-admin first");
  const sessions = new Map(),
    attempts = new Map();
  const sessionAge = 8 * 60 * 60 * 1000;
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
            version: "0.2.0-beta.2",
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
        if (path === "/api/dashboard" && method === "GET") {
          const [houses, content, users, rooms] = await Promise.all(
            resources.map((n) => store.list(n)),
          );
          const activity =
            account.role === "admin"
              ? [...(await store.list("admin_audit")), ...accounts.events]
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
          ].sort((a, b) => b.createdAt - a.createdAt);
          return send(filterRows(rows, Object.fromEntries(url.searchParams)));
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
          if (mode === "live") {
            const result = await store.app.uploadFile({
              cloudPath: `admin/${filename}`,
              fileContent: bytes,
            });
            if (!result.fileID) fail("云存储上传失败，请检查权限", 502);
            return send({ url: result.fileID });
          }
          await mkdir(join(directory, "uploads"), { recursive: true });
          await writeFile(join(directory, "uploads", filename), bytes, {
            mode: 0o600,
          });
          return send({ url: `/uploads/${filename}` });
        }
        if (path === "/api/image-url" && method === "GET") {
          const id = url.searchParams.get("id");
          if (mode !== "live" || !id?.startsWith("cloud://"))
            fail("图片地址无效");
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
          const rooms = await store.list("rooms");
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
          const rows = (await store.list(resource)).map((r) =>
            publicRecord(resource, r),
          );
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
  });
  app.server.listen(port, host, () =>
    console.log(
      `宇宙物业管理后台：${origin} (${mode === "demo" ? "本地演示，不连接云端" : "真实云环境"})`,
    ),
  );
}
