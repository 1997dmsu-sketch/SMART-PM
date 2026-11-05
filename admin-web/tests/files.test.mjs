// DB-07 T05 服务层测试（docs/database/DB-07-IMPLEMENTATION.md §10 / §11）。
//
// 纯新增，不改任何既有用例。覆盖：
//   §11.1  objectKey 前缀按 storage 分叉
//   §10 #1  NAS 未配置恒不可用（三道闸门），任一方法均 503 且无网络连接
//   §10 #2  purpose=nas 上传 503，且文件表零新增（不回退到 local/cloud）
//   §10 #8  私密用途（identity-document）强制 private + private/ 前缀，客户端无效
//   §10 #8b 私密文件 attach 到展示 usage → PURPOSE_FORBIDDEN
//   §10 #9  适配器字节写入抛错 → status=quarantined，attach 被拒
//   §10 #10 detach 只改 link.state；retire 只改 file_assets.status；物理文件保留
//   §11.2  cloud 上传写入 cloudFileId；绝不复用 prefix 字段
//   §11.5  记录 bucket 字段恒等于 visibility（拦截点快速判定副本）
//   §11.3  identity_application / blacklist_entry → ENTITY_NOT_SUPPORTED(400)；
//          白名单外实体类型 → PARAM_ERROR
//   §11.6  registerLegacy 命中集合 = objectKey ∪ legacyUrls ∪ cloudFileId
//   §10 #5  跨组织隔离：B 组织实例读不到 A 组织的文件（FILE_NOT_FOUND 同态）
//   §10 #6 / §11.4  下载鉴权：public 任意成员可读；private 读取需 readPermission/组织管理员（写入仅限组织管理员角色，读写权限分立）
//   §10 #7  editor 可上传 public；editor 上传 private → FORBIDDEN
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { LocalStore } from "../lib/store.mjs";
import {
  FileService,
  fileServiceConfig,
  ENTITY_TYPES,
  USAGES,
  objectKeyFor,
  sniffMime,
} from "../lib/files.mjs";
import { LocalStorageAdapter, NasStorageAdapter } from "../lib/storage.mjs";

const PNG = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3, 4,
]);
const ZIP = Buffer.from([80, 75, 3, 4, 10, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6]);

// 假云 app：uploadFile 返回带 env.bucket 的 cloud:// fileID；downloadFile /
// getTempFileURL 仅回显，绝不真实联网。
const fakeCloudApp = {
  async uploadFile({ cloudPath }) {
    return { fileID: `cloud://env.bucket/${cloudPath}` };
  },
  async downloadFile({ fileID }) {
    return { fileContent: Buffer.from(`cloud:${fileID}`) };
  },
  async getTempFileURL({ fileList }) {
    return {
      fileList: fileList.map((f) => ({
        fileID: f.fileID,
        tempFileURL: `https://tmp.example/${encodeURIComponent(f.fileID)}`,
      })),
    };
  },
};

async function mkStore() {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-files-"));
  const store = await new LocalStore(dir).init();
  return { dir, store, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function makeService(store, dir, { mode = "demo", orgId = "org-test", role = "admin", perms = [], env = {} } = {}) {
  const config = fileServiceConfig(
    { ...process.env, FILE_LEGACY_IMAGE_FALLBACK: "deny", ...env },
    { mode, app: fakeCloudApp, root: dir },
  );
  return new FileService(store, orgId, {
    // 服务层只验证 FileService 自身逻辑；成员关系由组织服务负责，在 HTTP 层
    // 用真实成员资格覆盖。auth=null 时 authCheck 跳过成员复查（files.mjs:285）。
    auth: null,
    actor: { actorType: "adminAccount", actorId: "acc-1", role, permissions: perms },
    config,
  });
}

const hasCode = (code) => (err) => err && err.code === code;

test("§11.1 objectKey 前缀按 storage 分叉", () => {
  assert.match(objectKeyFor("content-image", "public", "o", "png", "local"), /^uploads\//);
  assert.match(objectKeyFor("vr-attachment", "public", "o", "zip", "local"), /^vr-files\//);
  assert.match(objectKeyFor("content-image", "public", "o", "png", "cloud"), /^admin\//);
  assert.match(objectKeyFor("vr-attachment", "public", "o", "html", "cloud"), /^admin-vr\//);
  // private 恒 private/<orgId>/<purpose>/…，与 storage 无关
  assert.match(objectKeyFor("identity-document", "private", "org-x", "png", "local"), /^private\/org-x\/identity-document\//);
  assert.match(objectKeyFor("identity-document", "private", "org-x", "png", "cloud"), /^private\/org-x\/identity-document\//);
});

test("sniffMime 仅识别白名单类型", () => {
  assert.deepEqual(sniffMime(PNG), { mime: "image/png", ext: "png" });
  assert.equal(sniffMime(Buffer.from("not a file")), null);
});

test("§10 #1 NAS 三道闸门：恒不可用，任一方法均 503 且无网络连接", async () => {
  for (const cfg of [{}, { NAS_ENABLED: "true" }]) {
    const adapter = new NasStorageAdapter(cfg);
    assert.equal(adapter.available, false, JSON.stringify(cfg));
    for (const m of ["upload", "head", "read", "tempUrl", "retire"]) {
      await assert.rejects(adapter[m]("x", PNG), hasCode("STORAGE_UNAVAILABLE"));
    }
  }
  // 绝不回退到公开路径：调用失败而非返回任何 URL / 改用 local/cloud。
  await assert.rejects(
    new NasStorageAdapter({}).read("x"),
    (e) => e.code === "STORAGE_UNAVAILABLE" && /拒绝回退/.test(e.message),
  );
});

test("§10 #2 purpose=nas 上传 503 且文件表零新增", async (t) => {
  const { dir, store, cleanup } = await mkStore();
  t.after(cleanup);
  const svc = makeService(store, dir, { env: { FILE_STORAGE_DEFAULT: "nas" } });
  await assert.rejects(
    svc.upload({ bytes: PNG, purpose: "content-image" }),
    hasCode("STORAGE_UNAVAILABLE"),
  );
  assert.equal((await store.list("file_assets")).length, 0);
});

test("§10 #8 identity-document 强制 private + private/ 前缀，客户端无法改写", async (t) => {
  const { dir, store, cleanup } = await mkStore();
  t.after(cleanup);
  // 复审「读写权限分立」：私密文件「写入」仅限组织管理员角色（writePermission
  // 为 null → 回落 role==="admin"），无需 identity.review；该权限点只管「读取」。
  const svc = makeService(store, dir, { role: "admin" });
  const res = await svc.upload({ bytes: PNG, purpose: "identity-document", originalName: "id.png" });
  assert.equal(res.visibility, "private");
  assert.equal(res.status, "ready");
  assert.match(res.objectKey, /^private\/org-test\/identity-document\//);
  const record = (await store.list("file_assets")).find((r) => r._id === res.fileId);
  assert.equal(record.visibility, "private");
  assert.equal(record.bucket, "private"); // §11.5 密级副本
  assert.equal(record.purpose, "identity-document");
});

test("§10 #8b 私密文件 attach 到展示 usage → PURPOSE_FORBIDDEN", async (t) => {
  const { dir, store, cleanup } = await mkStore();
  t.after(cleanup);
  // 写入按组织管理员角色（无需 identity.review）。
  const svc = makeService(store, dir, { role: "admin" });
  const priv = await svc.upload({ bytes: PNG, purpose: "identity-document" });
  for (const usage of ["cover", "gallery", "vr"]) {
    await assert.rejects(
      svc.attach({ fileId: priv.fileId, entityType: "content", entityId: "c1", usage }),
      hasCode("PURPOSE_FORBIDDEN"),
    );
  }
  // 正向对照：public 文件可正常 attach 到展示 usage。
  const pub = await svc.upload({ bytes: PNG, purpose: "content-image" });
  const link = await svc.attach({ fileId: pub.fileId, entityType: "content", entityId: "c1", usage: "cover" });
  assert.equal(link.state, "attached");
});

test("§10 #9 适配器写入抛错 → quarantined，随后 attach 被拒", async (t) => {
  const { dir, store, cleanup } = await mkStore();
  t.after(cleanup);
  const svc = makeService(store, dir);
  const orig = LocalStorageAdapter.prototype.upload;
  LocalStorageAdapter.prototype.upload = async () => {
    throw new Error("disk full");
  };
  try {
    await assert.rejects(
      svc.upload({ bytes: PNG, purpose: "content-image" }),
      /disk full/,
    );
  } finally {
    LocalStorageAdapter.prototype.upload = orig;
  }
  const record = (await store.list("file_assets")).find((r) => r.purpose === "content-image");
  assert.ok(record, "应已创建 staged 记录");
  assert.equal(record.status, "quarantined");
  assert.equal(record.objectKey.startsWith("uploads/"), true);
  const fileId = record._id;
  await assert.rejects(
    svc.attach({ fileId, entityType: "content", entityId: "c1", usage: "cover" }),
    hasCode("FILE_NOT_READY"),
  );
});

test("§10 #10 detach 只改 link.state；物理文件仍存在", async (t) => {
  const { dir, store, cleanup } = await mkStore();
  t.after(cleanup);
  const svc = makeService(store, dir);
  const up = await svc.upload({ bytes: PNG, purpose: "content-image" });
  const link = await svc.attach({ fileId: up.fileId, entityType: "content", entityId: "c1", usage: "cover" });
  const detached = await svc.detach(link.linkId, { expectedRevision: link.revision });
  assert.equal(detached.state, "detached");
  const linkRow = (await store.list("file_links")).find((l) => l._id === link.linkId);
  assert.equal(linkRow.state, "detached"); // 只改 link
  const asset = (await store.list("file_assets")).find((r) => r._id === up.fileId);
  assert.equal(asset.status, "ready"); // file_assets.status 不变
  // 物理文件仍存在（绝不删除）
  const onDisk = await stat(join(dir, up.objectKey)).then(() => true, () => false);
  assert.equal(onDisk, true);
});

test("§10 #10 retire 只改 file_assets.status，不删物理文件", async (t) => {
  const { dir, store, cleanup } = await mkStore();
  t.after(cleanup);
  const svc = makeService(store, dir);
  const up = await svc.upload({ bytes: PNG, purpose: "content-image" });
  const retired = await svc.retire(up.fileId);
  assert.equal(retired.status, "retired");
  const asset = (await store.list("file_assets")).find((r) => r._id === up.fileId);
  assert.equal(asset.status, "retired");
  const onDisk = await stat(join(dir, up.objectKey)).then(() => true, () => false);
  assert.equal(onDisk, true);
});

test("§11.2 cloud 上传写入 cloudFileId，绝不复用 prefix 字段", async (t) => {
  const { dir, store, cleanup } = await mkStore();
  t.after(cleanup);
  const svc = makeService(store, dir, { mode: "live" });
  const res = await svc.upload({ bytes: PNG, purpose: "content-image" });
  assert.equal(res.storage, "cloud");
  assert.equal(res.status, "ready");
  assert.match(res.objectKey, /^admin\//);
  const record = (await store.list("file_assets")).find((r) => r._id === res.fileId);
  assert.match(record.cloudFileId, /^cloud:\/\/env\.bucket\//); // 独立字段
  assert.equal("prefix" in record, false); // §11.5：删除 prefix，绝不混入
});

test("§11.3 实体类型判定：白名单内未建集合 → ENTITY_NOT_SUPPORTED；白名单外 → PARAM_ERROR", async (t) => {
  const { dir, store, cleanup } = await mkStore();
  t.after(cleanup);
  const svc = makeService(store, dir);
  const pub = await svc.upload({ bytes: PNG, purpose: "content-image" });
  for (const entityType of ["identity_application", "blacklist_entry"]) {
    await assert.rejects(
      svc.attach({ fileId: pub.fileId, entityType, entityId: "x", usage: "other" }),
      (e) => e.code === "ENTITY_NOT_SUPPORTED" && e.status === 400,
    );
  }
  // 白名单外实体类型属无效入参 → PARAM_ERROR
  await assert.rejects(
    svc.attach({ fileId: pub.fileId, entityType: "not_a_type", entityId: "x", usage: "other" }),
    hasCode("PARAM_ERROR"),
  );
  // 白名单内已存在的集合可正常 attach
  const ok = await svc.attach({ fileId: pub.fileId, entityType: "content", entityId: "c1", usage: "other" });
  assert.equal(ok.state, "attached");
  // 一致性自检：ENTITY_TYPES / USAGES 导出与断言同源
  assert.ok(ENTITY_TYPES.includes("content") && USAGES.includes("other"));
});

test("§11.6 registerLegacy 命中集合 = objectKey ∪ legacyUrls ∪ cloudFileId", async (t) => {
  const { dir, store, cleanup } = await mkStore();
  t.after(cleanup);
  // registerLegacy 在 legacy 路径以 orgId=null 运行（绕开 authRefs），构造同款。
  const svc = makeService(store, dir, { orgId: null });
  const seedId = `file-${randomUUID()}`;
  await store.transact(
    [{ collection: "file_assets", id: seedId }],
    () => [
      {
        collection: "file_assets",
        id: seedId,
        data: {
          orgId: null,
          storage: "local",
          objectKey: "uploads/seed.png",
          cloudFileId: "cloud://env.bucket/admin/seed.png",
          legacyUrls: ["https://old/seed.png"],
          visibility: "public",
          purpose: "content-image",
          status: "ready",
          bucket: "public",
          schemaVersion: 2,
          revision: 1,
          createdAt: Date.now(),
        },
      },
    ],
    { actor: "t", actorId: "t", action: "seed" },
  );
  // 三种定位符任一命中即返回既有记录（不重复创建）。注意 registerLegacy 先
  // 推导 visibility（无法推导则直接 PARAM_ERROR）再查重，故此处用可推导可见
  // 性的真实形态 URL：/uploads/（local 公开）、cloud://env.bucket/admin/（cloud
  // 公开）、https://（external 公开）。
  for (const url of ["/uploads/seed.png", "cloud://env.bucket/admin/seed.png", "https://old/seed.png"]) {
    const hit = await svc.registerLegacy({ urls: [{ url }] });
    assert.equal(hit._id || hit.fileId, seedId, `应命中既有记录: ${url}`);
  }
  // 未登记 URL（带前导斜杠的本地公开上传形态）→ 新建一条
  const created = await svc.registerLegacy({ urls: [{ url: "/uploads/brand-new.png" }] });
  assert.notEqual(created.fileId, seedId);
  assert.equal((await store.list("file_assets")).length, 2);
});

test("§10 #5 跨组织隔离：B 组织实例读不到 A 组织的文件", async (t) => {
  const { dir, store, cleanup } = await mkStore();
  t.after(cleanup);
  const a = makeService(store, dir, { orgId: "org-A" });
  const b = makeService(store, dir, { orgId: "org-B" });
  const up = await a.upload({ bytes: PNG, purpose: "content-image" });
  // B 的列表过滤掉 A 的文件
  assert.equal((await b.list()).data.length, 0);
  // B 下载 A 的文件 → FILE_NOT_FOUND 同态（owner 检查按数据行 orgId）
  await assert.rejects(
    b.authorizeDownload(up.fileId, b.actor),
    hasCode("FILE_NOT_FOUND"),
  );
  // A 自己可下载
  const ok = await a.authorizeDownload(up.fileId, a.actor);
  assert.equal(ok.file._id, up.fileId);
});

test("§10 #6 下载鉴权：public 任意成员可读，private 仅 identity.readPrivate/组织管理员", async (t) => {
  const { dir, store, cleanup } = await mkStore();
  t.after(cleanup);
  // 三次复审：identity-document 的「读取」权限点改为 identity.readPrivate，与
  // DB-04 的 identity.review（证件审查）区分；仅凭 identity.review 不足以读取。
  const admin = makeService(store, dir, { role: "admin", perms: [] });
  const pub = await admin.upload({ bytes: PNG, purpose: "content-image" });
  // 管理员可上传证件：写入按组织管理员角色，无需任何读取权限点（场景4：上传权限不变）。
  const priv = await admin.upload({ bytes: PNG, purpose: "identity-document" });
  assert.equal(priv.visibility, "private");

  const viewer = { actorType: "adminAccount", actorId: "v", role: "viewer", permissions: [] };
  // viewer 读 public → 200
  const okPub = await admin.authorizeDownload(pub.fileId, viewer);
  assert.equal(okPub.file._id, pub.fileId);
  // viewer 读 private → FILE_NOT_FOUND（与不存在同态）
  await assert.rejects(admin.authorizeDownload(priv.fileId, viewer), hasCode("FILE_NOT_FOUND"));

  // 场景1：仅持 identity.review（无 identity.readPrivate）→ 仍不可读证件
  const reviewOnly = { actorType: "adminAccount", actorId: "v1", role: "viewer", permissions: ["identity.review"] };
  await assert.rejects(admin.authorizeDownload(priv.fileId, reviewOnly), hasCode("FILE_NOT_FOUND"));

  // 场景2：持 identity.readPrivate → 可读，且写入访问审计
  const readPriv = { actorType: "adminAccount", actorId: "v2", role: "viewer", permissions: ["identity.readPrivate"] };
  const okPriv = await admin.authorizeDownload(priv.fileId, readPriv);
  assert.equal(okPriv.file._id, priv.fileId);
  const audit = (await store.list("file_access_log")).filter(
    (l) => l.action === "download" && l.fileId === priv.fileId,
  );
  assert.ok(audit.length >= 1, "应记录下载访问审计");
  assert.equal(audit[audit.length - 1].actorId, "v2");

  // 场景3：撤销 identity.readPrivate 后立即拒绝
  const revoked = { actorType: "adminAccount", actorId: "v2", role: "viewer", permissions: [] };
  await assert.rejects(admin.authorizeDownload(priv.fileId, revoked), hasCode("FILE_NOT_FOUND"));

  // 复审要点：无 readPermission 的组织管理员「可上传、但不可下载」
  await assert.rejects(admin.authorizeDownload(priv.fileId, admin.actor), hasCode("FILE_NOT_FOUND"));
  // 同时持 identity.readPrivate 的组织管理员可放行
  const adminWithPerm = makeService(store, dir, { role: "admin", perms: ["identity.readPrivate"] });
  const okAdmin = await adminWithPerm.authorizeDownload(priv.fileId, adminWithPerm.actor);
  assert.equal(okAdmin.file._id, priv.fileId);
});

test("§10 #7 editor 可上传 public；editor 上传 private → FORBIDDEN", async (t) => {
  const { dir, store, cleanup } = await mkStore();
  t.after(cleanup);
  const editor = makeService(store, dir, { role: "editor" });
  const pub = await editor.upload({ bytes: PNG, purpose: "content-image" });
  assert.equal(pub.visibility, "public");
  await assert.rejects(
    editor.upload({ bytes: PNG, purpose: "identity-document" }),
    hasCode("FORBIDDEN"),
  );
});

test("PURPOSES 策略：大小 / mime 校验拒绝超限与非白名单类型", async (t) => {
  const { dir, store, cleanup } = await mkStore();
  t.after(cleanup);
  const svc = makeService(store, dir);
  // 超过 listing-image 5MB 上限
  const big = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024, 0)]);
  await assert.rejects(svc.upload({ bytes: big, purpose: "content-image" }), hasCode("PARAM_ERROR"));
  // ZIP 不是图片用途可接受的 mime
  await assert.rejects(svc.upload({ bytes: ZIP, purpose: "content-image" }), hasCode("PARAM_ERROR"));
  // 未知用途
  await assert.rejects(svc.upload({ bytes: PNG, purpose: "nope" }), hasCode("PARAM_ERROR"));
});
