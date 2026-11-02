// DB-07 T02 存储适配层（docs/database/DB-07-IMPLEMENTATION.md §4）。
//
// 统一接口：kind / available / upload / head / read / tempUrl / retire。
// 鉴权全部留在服务层（files.mjs），适配器只负责传输，因此「鉴权先于读取」
// 可以被独立断言（DB-02 R2-02 的教训）。
//
// 设计红线：
// - 值只从环境变量读取（storageConfigFromEnv），不入库、不进日志；
//   运行时注入的 app / root / mode 只存在于内存 config 对象里。
// - NAS 只定义接口与配置位：无协议实现、无新依赖、不连接任何设备，
//   任一方法一律 STORAGE_UNAVAILABLE(503)，且绝不回退到公开路径。
// - 零新增 npm 依赖：云存储复用已有的 @cloudbase/node-sdk app 实例。
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { failCode } from "./model.mjs";

// 闸门 2：DB-07 只预留接口，适配器实现需后续任务单独评审。即使
// NAS_ENABLED=true，该常量仍使 NAS 恒不可用。
export const NAS_ADAPTER_IMPLEMENTED = false;

// 从环境变量抽取 DB-07 配置位。FILE_STORAGE_<PURPOSE> 是动态键，因此按前缀
// 透传全部 FILE_STORAGE_*；NAS_PASSWORD 只在此内存对象里传递，绝不进日志、
// 绝不写入任何业务表或审计。
export function storageConfigFromEnv(env = process.env) {
  const config = {};
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("FILE_STORAGE_") ||
      key.startsWith("NAS_") ||
      key === "FILE_RETENTION_DAYS" ||
      key === "FILE_LEGACY_IMAGE_FALLBACK"
    )
      config[key] = env[key];
  }
  return config;
}

// 三道闸门的前两道（第三道在适配器方法调用时检查 available）。
// 返回值恒 available=false：DB-07 范围内 NAS 绝不可能可用。
export function nasAvailability(config = {}) {
  if (config.NAS_ENABLED !== "true")
    return { available: false, reason: "NAS_ENABLED 未开启" };
  if (!NAS_ADAPTER_IMPLEMENTED)
    return { available: false, reason: "NAS 适配器尚未实现（DB-07 仅预留接口）" };
  return { available: false, reason: "NAS 传输协议尚未实现" };
}

const defaultLocalRoot = () =>
  fileURLToPath(new URL("../.data/demo", import.meta.url));

// 本地 objectKey 是服务层生成的可信前缀路径，但适配器位于系统边界，仍显式
// 拒绝绝对路径、盘符、反斜杠、父目录逃逸与空字节，防止写到 root 之外。
function localPath(root, objectKey) {
  if (
    typeof objectKey !== "string" ||
    !objectKey ||
    objectKey.includes("\0") ||
    objectKey.includes("\\") ||
    /^[a-zA-Z]:/.test(objectKey)
  )
    failCode("PARAM_ERROR", "非法的对象定位符");
  const full = resolve(root, objectKey);
  const rel = relative(resolve(root), full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel))
    failCode("PARAM_ERROR", "对象定位符逃逸出存储根目录");
  return full;
}

// 统一接口基类。所有默认方法 fail-closed（503），子类必须覆盖全部方法，
// 任何漏实现都会显式不可用，绝不静默回退。
export class StorageAdapter {
  constructor(kind) {
    this.kind = kind;
    this.available = false;
  }
  _guard() {
    if (!this.available)
      failCode(
        "STORAGE_UNAVAILABLE",
        `${this.kind} 存储当前不可用，拒绝回退到公开路径`,
        503,
      );
  }
  _unavailable() {
    failCode(
      "STORAGE_UNAVAILABLE",
      `${this.kind} 存储当前不可用，拒绝回退到公开路径`,
      503,
    );
  }
  async upload(objectKey, bytes, mimeType) {
    this._guard();
    this._unavailable();
  }
  async head(objectKey) {
    this._guard();
    this._unavailable();
  }
  async read(objectKey) {
    this._guard();
    this._unavailable();
  }
  async tempUrl(objectKey, maxAge) {
    this._guard();
    this._unavailable();
  }
  async retire(objectKey) {
    this._guard();
    this._unavailable();
  }
}

// demo 默认适配器：写 <root>/<objectKey>（mode 0o600）；tempUrl 恒 null
// （强制代理下载，杜绝签发可脱离鉴权的公开 URL）；retire 不删物理文件。
export class LocalStorageAdapter extends StorageAdapter {
  constructor({ root, mode = "demo" } = {}) {
    super("local");
    this.root = root || defaultLocalRoot();
    this.mode = mode;
    this.available = true; // 恒 true；live 模式由 selectStorage 拒绝启用
  }
  async upload(objectKey, bytes, mimeType) {
    this._guard();
    const file = localPath(this.root, objectKey);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes, { mode: 0o600 });
    return { storage: "local", objectKey, size: bytes.length };
  }
  async head(objectKey) {
    this._guard();
    const file = localPath(this.root, objectKey);
    try {
      const info = await stat(file);
      return { exists: true, size: info.size };
    } catch (e) {
      if (e.code === "ENOENT") return { exists: false, size: 0 };
      throw e;
    }
  }
  async read(objectKey) {
    this._guard();
    return readFile(localPath(this.root, objectKey));
  }
  async tempUrl(objectKey, maxAge) {
    this._guard();
    return null;
  }
  async retire(objectKey) {
    this._guard();
    localPath(this.root, objectKey); // 只校验定位符，绝不删除物理文件
    return;
  }
}

// live 默认适配器：复用 server.mjs:494-499 / :523 / :586-588 的 SDK 调用
// 形态。objectKey 对 upload 是 cloudPath；read/tempUrl/head 接收的是
// cloud:// fileID（由服务层从 file_assets.legacyUrls 中取出，见 files.mjs）。
export class CloudStorageAdapter extends StorageAdapter {
  constructor({ app = null, mode = "live" } = {}) {
    super("cloud");
    this.app = app;
    this.mode = mode;
    this.available = mode === "live" && !!app;
  }
  async upload(objectKey, bytes, mimeType) {
    this._guard();
    const result = await this.app.uploadFile({
      cloudPath: objectKey,
      fileContent: bytes,
    });
    if (!result?.fileID)
      failCode("STORAGE_UNAVAILABLE", "云存储上传失败", 503);
    return {
      storage: "cloud",
      objectKey,
      size: bytes.length,
      fileID: result.fileID,
    };
  }
  async head(objectKey) {
    this._guard();
    // 云 SDK 无独立 head 原语：用 downloadFile 探测存在性与大小。
    try {
      const result = await this.app.downloadFile({ fileID: objectKey });
      const bytes = result?.fileContent;
      if (!bytes) return { exists: false, size: 0 };
      return { exists: true, size: bytes.length };
    } catch {
      return { exists: false, size: 0 };
    }
  }
  async read(objectKey) {
    this._guard();
    const result = await this.app.downloadFile({ fileID: objectKey });
    if (!result?.fileContent)
      failCode("STORAGE_UNAVAILABLE", "云存储读取失败", 503);
    return Buffer.from(result.fileContent);
  }
  async tempUrl(objectKey, maxAge = 600) {
    this._guard();
    const result = await this.app.getTempFileURL({
      fileList: [{ fileID: objectKey, maxAge }],
    });
    return result?.fileList?.[0]?.tempFileURL || null;
  }
  async retire(objectKey) {
    this._guard();
    return; // DB-07 不实现物理删除，物理对象保留
  }
}

// 只持有配置对象，无任何协议实现、无新依赖、不连接任何设备。
export class NasStorageAdapter extends StorageAdapter {
  constructor(config = {}) {
    super("nas");
    this.config = Object.fromEntries(
      [
        "NAS_ENABLED",
        "NAS_HOST",
        "NAS_SHARE",
        "NAS_BASE_PATH",
        "NAS_USERNAME",
        "NAS_PASSWORD",
      ]
        .filter((key) => config[key] !== undefined)
        .map((key) => [key, config[key]]),
    );
    const { available, reason } = nasAvailability(config);
    this.available = available; // 恒 false（三道闸门 1、2）
    this.reason = reason;
  }
  _unavailable() {
    // 闸门 3：任一方法被调用且 available===false → 503，且绝不回退到公开
    // 路径（不返回任何 URL / 不改用 local / cloud）。
    if (!this.available)
      failCode(
        "STORAGE_UNAVAILABLE",
        `NAS 不可用：${this.reason}；拒绝回退到公开路径`,
        503,
      );
    failCode("STORAGE_UNAVAILABLE", "NAS 传输协议尚未实现", 503);
  }
  async upload(objectKey, bytes, mimeType) {
    this._unavailable();
  }
  async head(objectKey) {
    this._unavailable();
  }
  async read(objectKey) {
    this._unavailable();
  }
  async tempUrl(objectKey, maxAge) {
    this._unavailable();
  }
  async retire(objectKey) {
    this._unavailable();
  }
}

// 选择逻辑：FILE_STORAGE_<PURPOSE> → FILE_STORAGE_DEFAULT →
// (demo→local / live→cloud)。解析结果为 nas 直接 503，绝不做 local/cloud 兜底。
// live 模式只返回 cloud（或 nas→503），不得启用本地适配器，避免绕过
// server.mjs:657-663「live 业务图片不得以 / 开头」的约束。
//
// config 是「环境变量位 + 运行时注入」的合并对象：
//   { FILE_STORAGE_*, NAS_*, app(cloudbase 实例), root(本地根目录) }
export function selectStorage({ mode, purpose, config = {} }) {
  if (!["demo", "live"].includes(mode))
    failCode("PARAM_ERROR", "ADMIN_MODE 必须为 demo 或 live");
  const key = `FILE_STORAGE_${String(purpose || "")
    .toUpperCase()
    .replace(/-/g, "_")}`;
  const override = config[key] || config.FILE_STORAGE_DEFAULT || "";
  const target = String(
    override || (mode === "live" ? "cloud" : "local"),
  ).toLowerCase();

  if (target === "nas")
    failCode(
      "STORAGE_UNAVAILABLE",
      "NAS 存储未实现/未启用（DB-07 仅预留接口），拒绝回退到公开路径",
      503,
    );
  if (target === "local") {
    if (mode === "live")
      failCode(
        "STORAGE_UNAVAILABLE",
        "live 模式不得启用本地存储适配器，拒绝回退到公开路径",
        503,
      );
    return new LocalStorageAdapter({ root: config.root, mode });
  }
  if (target === "cloud")
    return new CloudStorageAdapter({ app: config.app, mode });
  failCode("PARAM_ERROR", `未知的存储后端配置：${target}`);
}
