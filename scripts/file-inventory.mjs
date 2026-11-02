#!/usr/bin/env node
// DB-07 T00/T01 存量文件盘点脚本。
//
// 默认（不带参数）即 --dry-run：只读，绝不写 DB、绝不联网、绝不删除任何文件。
// 仅显式 --apply 才写库，且只登记 visibility=public 的公开条目；private 与
// 无法判定密级的条目一律留作人工复核，绝不自动登记、绝不回退到公开路径。
//
// 用途：上线前评估 FILE_LEGACY_IMAGE_FALLBACK=deny 的影响面（多少未登记图片、
// 在哪些业务记录），必要时 --apply 批量登记公开文件，避免既有 cloud 图片白屏。
// 依赖：仅 Node 内置模块 + admin-web/lib/store.mjs 的纯函数 seed()/LocalStore；
// 零新增 npm 依赖，全程不发起任何网络请求。
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { seed } from "../admin-web/lib/store.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function die(message) {
  console.error(`[file-inventory] ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  let apply = false;
  let dryRun = false;
  let dataPath = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--data") {
      dataPath = argv[++i];
      if (!dataPath) die("--data 需要指定目录或 demo-data.json 路径");
    } else die(`未知参数：${arg}`);
  }
  if (apply && dryRun) die("--apply 与 --dry-run 不能同时使用");
  return { apply, dataPath };
}

// dry-run 完全不走 init()：只做一次只读 readFile；数据文件不存在时退化为
// seed() 的内存快照（纯函数，不落盘），因此 dry-run 阶段磁盘写入恒为零。
async function loadData(dataPath) {
  const mode = process.env.ADMIN_MODE || "demo";
  const dir =
    dataPath || process.env.ADMIN_DATA_DIR || join(repoRoot, "admin-web", ".data", mode);
  const file = dir.endsWith(".json") ? dir : join(dir, "demo-data.json");
  try {
    const data = JSON.parse(await readFile(file, "utf8"));
    return { data, source: file, file, persisted: true };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return {
      data: seed(),
      source: "内置演示种子（只读内存快照，未落盘）",
      file,
      persisted: false,
    };
  }
}

function collectRefs(data) {
  const refs = [];
  const push = (collection, recordId, field, url) => {
    if (url) refs.push({ collection, recordId, field, url: String(url) });
  };
  for (const house of data.houses || []) {
    push("houses", house._id, "cover", house.cover);
    for (const url of Array.isArray(house.images) ? house.images : [])
      push("houses", house._id, "images", url);
  }
  for (const content of data.content || []) {
    push("content", content._id, "image", content.image);
    push("content", content._id, "vrUrl", content.vrUrl);
    // vrFile.url 是附件的实际定位符；vrUrl 只是 HTTPS 在线链接。
    push("content", content._id, "vrFile.url", content.vrFile?.url);
  }
  return refs;
}

// 按前缀推导 visibility / 建议动作。规则与 DB-07 方案 §5「ObjectKey 前缀约定」
// 一致：private/ 私密，admin-vr/ 与 vr-files/ 为 public（评审已定），
// admin/ 与 uploads/ 为 public，其余无法判定 → 人工复核。
function classify(url) {
  if (typeof url !== "string" || !url.trim())
    return {
      visibility: "unknown",
      action: "人工复核",
      reason: "空值或非字符串",
      storage: null,
      objectKey: null,
      prefix: null,
      purpose: null,
    };
  const u = url.trim();
  if (/^https:\/\//.test(u))
    return {
      visibility: "public",
      action: "跳过",
      reason: "HTTPS 外链，非本系统存储对象",
      storage: "external",
      objectKey: u,
      prefix: "external",
      purpose: null,
      skip: true,
    };
  if (/^\/assets\/room-[123]\.jpg$/.test(u))
    return {
      visibility: "public",
      action: "跳过",
      reason: "内置静态资源，不经过公共文件拦截入口，无需登记",
      storage: "local",
      objectKey: u.replace(/^\//, ""),
      prefix: "assets",
      purpose: null,
      skip: true,
    };
  let storage = "local";
  let path = u;
  if (/^cloud:\/\//.test(u)) {
    storage = "cloud";
    const match = u.match(/^cloud:\/\/[^/]+\/(.+)$/);
    path = match ? match[1] : u; // cloudPath（去掉 cloud://<env>/）
  } else if (/^\/(uploads|vr-files)\//.test(u)) {
    path = u.replace(/^\//, ""); // local 相对路径
  }
  return fromPath(path, storage);
}

function fromPath(path, storage) {
  if (path.startsWith("private/"))
    return {
      visibility: "private",
      action: "人工复核",
      reason: "private/ 私密前缀，自动登记可能放大泄露面",
      storage,
      objectKey: path,
      prefix: "private",
      purpose: "other",
    };
  if (path.startsWith("admin-vr/") || path.startsWith("vr-files/"))
    return {
      visibility: "public",
      action: "登记",
      reason: "VR 附件（评审已定 vr-attachment=public）",
      storage,
      objectKey: path,
      prefix: path.split("/")[0],
      purpose: "vr-attachment",
    };
  if (path.startsWith("admin/") || path.startsWith("uploads/"))
    return {
      visibility: "public",
      action: "登记",
      reason: "公开图片前缀",
      storage,
      objectKey: path,
      prefix: path.split("/")[0],
      purpose: "content-image",
    };
  return {
    visibility: "unknown",
    action: "人工复核",
    reason: "无法按既有前缀判定密级",
    storage,
    objectKey: path,
    prefix: path.split("/")[0],
    purpose: null,
  };
}

// ① 是否已登记：按 legacyUrls 或 objectKey 命中 file_assets。
function isRegistered(url, cls, assets) {
  return assets.some((asset) => {
    if (Array.isArray(asset.legacyUrls) && asset.legacyUrls.includes(url)) return true;
    if (cls.objectKey && (asset.objectKey === cls.objectKey || asset.objectKey === url))
      return true;
    return false;
  });
}

// 只按 cloudPath / 相对路径的「末段文件名」解析扩展名，绝不解析
// cloud://env.bucket/... 全串（env/bucket 里的点会污染扩展名判定）。
// 这里先取 "/" 末段，所以即便传入完整 cloud:// fileID，也等价于只取
// cloudPath 末段，与 T04「/api/image-url 作用域拦截按末段解析」口径一致。
function extFromPath(objectKey) {
  const last = String(objectKey || "").split("/").pop();
  const dot = last.lastIndexOf(".");
  return dot < 0 ? "" : last.slice(dot + 1).toLowerCase();
}

function guessMime(objectKey) {
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      zip: "application/zip",
      html: "text/html",
      htm: "text/html",
    }[extFromPath(objectKey)] || null
  );
}

const isImage = (entry) =>
  ["png", "jpg", "jpeg", "webp"].includes(extFromPath(entry.objectKey));

// --apply 直接把登记结果原子写回 demo-data.json（tmp + rename，与
// store.persist 同款）。不走 store.change：那样既无法用 file-<uuid> 固定 ID
//（change 对显式 id 且记录不存在会抛 404），也不该在离线盘点里隐式触发
// seed/init 的额外落盘。只覆盖 file_assets，其余集合原样保留；不删除任何
// 物理文件，也不联网。
async function applyRegistration(pending, file, data) {
  const rows = Array.isArray(data.file_assets) ? [...data.file_assets] : [];
  const now = Date.now();
  for (const entry of pending) {
    rows.push({
      _id: `file-${randomUUID()}`,
      orgId: null, // legacy 未归属，DB-08 迁移前 v2 列表不可见
      storage: entry.storage,
      objectKey: entry.objectKey,
      bucket: entry.visibility,
      prefix: entry.prefix,
      originalName: String(entry.objectKey).split("/").pop(),
      mimeType: guessMime(entry.objectKey),
      size: null,
      checksum: null, // 迁移期可空
      purpose: entry.purpose,
      visibility: entry.visibility,
      status: "ready", // 物理文件已存在，仅补登记，不搬迁、不写字节
      uploadedBy: { actorType: "system", actorId: "file-inventory" },
      legacyUrls: [entry.url],
      retentionUntil: null, // Q03 未定，不驱动任何删除
      schemaVersion: 2,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
  const tmp = file + ".tmp";
  await writeFile(tmp, JSON.stringify({ ...data, file_assets: rows }), {
    mode: 0o600,
  });
  await rename(tmp, file);
}

async function main() {
  const { apply, dataPath } = parseArgs(process.argv.slice(2));
  const { data, source, file, persisted } = await loadData(dataPath);
  const assets = Array.isArray(data.file_assets) ? data.file_assets : [];

  const entries = collectRefs(data).map((ref) => {
    const cls = classify(ref.url);
    const registered = isRegistered(ref.url, cls, assets);
    const action = registered ? "已登记" : cls.action;
    return { ...ref, ...cls, registered, action };
  });

  const registered = entries.filter((e) => e.registered);
  const skipped = entries.filter((e) => !e.registered && e.skip);
  const manual = entries.filter(
    (e) => !e.registered && !e.skip && e.action === "人工复核",
  );
  // 只登记 visibility=public 的公开条目：private / unknown 一律不进本集合。
  const pending = entries.filter(
    (e) =>
      !e.registered &&
      !e.skip &&
      e.action === "登记" &&
      e.visibility === "public",
  );
  const pendingImages = pending.filter(isImage);
  const pendingAttachments = pending.filter((e) => !isImage(e));

  const houseRefs = entries.filter((e) => e.collection === "houses").length;
  const contentRefs = entries.filter((e) => e.collection === "content").length;

  console.log(`DB-07 存量文件盘点  [${apply ? "--apply 写库" : "--dry-run 只读"}]`);
  console.log(`数据源: ${source}`);
  console.log(
    `业务引用合计: ${entries.length} 条（houses ${houseRefs} / content ${contentRefs}）`,
  );
  console.log(
    `已登记: ${registered.length} 条 | 跳过（外链/内置静态）: ${skipped.length} 条 | 人工复核: ${manual.length} 条`,
  );
  console.log(
    `未登记图片数（visibility=public，建议登记）: ${pendingImages.length} 条` +
      ` | 未登记公开 VR 附件: ${pendingAttachments.length} 条`,
  );

  if (pending.length) {
    console.log("\n未登记公开文件明细（含所属业务记录 ID）：");
    for (const e of pending)
      console.log(
        `  [${e.collection}/${e.recordId}] ${e.field}  ${e.url}  → visibility=${e.visibility}  action=${e.action}  (${e.reason})`,
      );
  }
  if (manual.length) {
    console.log("\n人工复核明细（不自动登记）：");
    for (const e of manual)
      console.log(
        `  [${e.collection}/${e.recordId}] ${e.field}  ${e.url}  → visibility=${e.visibility}  (${e.reason})`,
      );
  }

  if (!apply) {
    console.log(
      "\ndry-run 结束：未写 DB、未联网、未删除任何文件。需要登记时显式执行 --apply。",
    );
    return;
  }
  if (!persisted)
    die("数据文件不存在，--apply 拒绝在只读演示快照上写库");

  await applyRegistration(pending, file, data);
  console.log(
    `\n--apply 完成：登记 ${pending.length} 条 visibility=public 的公开文件到 file_assets` +
      `（图片 ${pendingImages.length} / VR 附件 ${pendingAttachments.length}）；` +
      `private 与人工复核条目未登记；未删除任何物理文件。`,
  );
}

main().catch((error) => {
  console.error("[file-inventory] 执行失败:", error);
  process.exitCode = 1;
});
