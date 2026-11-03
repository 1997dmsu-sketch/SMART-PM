// DB-07 T05 HTTP 层测试（docs/database/DB-07-IMPLEMENTATION.md §10）。
//
// 纯新增，不改任何既有用例。覆盖：
//   §12    v2 信封 / Idempotency-Key 缺失·重放·冲突
//   §10 #7  editor 可上传 public；editor 上传 private → 403
//   §10 #6  下载鉴权：viewer 读 public→200；viewer 读 private→404；admin 可上传 private 但读需 identity.readPrivate
//   §10 #5  跨组织隔离：无成员资格的账号读文件/列表 → 404 同态
//   §10 #4  /api/vr-download 命中私密 file_assets → 404（与不存在同态）
//   §10 #4b /uploads/* 静态：public 旧图 200；同路径改密 private → 404
//   §10 #3   红线：image-url 命中 private → 403，与 fallback 开关无关
//   §10 #3b  deny 默认 → 未登记旧 cloud 图片 403；allow → 200
//   §10 #3c  作用域：admin-vr/*.zip 经 image-url → 403；admin-vr/*.html 经 vr-download → 200
//
// 说明：image-url / vr-download 的红线与 fallback 语义只在 live 模式生效
//（server.mjs:905 `mode !== "live" || !id.startsWith("cloud://") → fail`），故
// 这部分用独立 live 应用 + 假云 app 夹具，且全程零真实网络连接。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server.mjs";
import { OrgService } from "../lib/org.mjs";
import { Accounts } from "../lib/auth.mjs";

const PNG = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3, 4,
]);

// ───────── 演示（demo）模式夹具：覆盖 v2 文件路由 + 静态拦截 ─────────
let app, dir, url, admin, editor, viewer, outsider, privAdmin;
async function v2(path, { method = "GET", data, auth = admin, headers = {} } = {}) {
  const h = { Origin: url, ...headers };
  if (auth) {
    h.Cookie = auth.cookie;
    h["X-CSRF-Token"] = auth.csrf;
  }
  if (data !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(`${url}/api/v2/${path}`, {
    method,
    headers: h,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const postFile = (path, bytes, { auth = admin, purpose, name, idem = randomUUID() } = {}) =>
  fetch(`${url}/api/v2/${path}?purpose=${purpose || "content-image"}&name=${name || ""}`, {
    method: "POST",
    headers: {
      Origin: url,
      Cookie: auth.cookie,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": idem,
      "Content-Type": "application/octet-stream",
    },
    body: bytes,
  });
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-server-files-"));
  app = await createApp({ directory: dir });
  await new Promise((res) => app.server.listen(0, "127.0.0.1", res));
  url = `http://127.0.0.1:${app.server.address().port}`;
  const demo = await fetch(`${url}/api/demo-login`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: "{}",
  });
  admin = { cookie: demo.headers.get("set-cookie")?.split(";")[0], csrf: (await demo.json()).csrf };

  const mk = async (username, role) => {
    await app.accounts.save({
      username, name: username, role, password: "test-only-password-123", enabled: true,
    });
    const login = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { Origin: url, "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "test-only-password-123" }),
    });
    return { cookie: login.headers.get("set-cookie")?.split(";")[0], csrf: (await login.json()).csrf };
  };
  editor = await mk("files-editor", "editor");
  viewer = await mk("files-viewer", "viewer");
  outsider = await mk("files-outsider", "viewer"); // 不授予 org-demo 成员资格
  // 三次复审：证件「读取」权限点改为 identity.readPrivate（区别于 DB-04 的 identity.review），
  // 与不带权限点的 admin（admin）形成正负对照。
  privAdmin = await mk("files-privadmin", "admin");

  const orgs = new OrgService(app.store);
  const names = new Map([
    [editor, "files-editor"],
    [viewer, "files-viewer"],
    [privAdmin, "files-privadmin"],
  ]);
  for (const acc of [editor, viewer, privAdmin]) {
    const row = app.accounts.rows.find((a) => a.username === names.get(acc));
    await orgs.grantMembership(
      { orgId: "org-demo", principalType: "adminAccount", principalId: row._id, role: row.role },
      { actor: "system", actorId: "system", action: "测试授权" },
    );
  }
  // 成员资格默认 permissions=[]；给 privAdmin 授予 identity.readPrivate 权限点
  // （server.mjs:164 actor.permissions 取自 membership.permissions）。
  const privRow = app.accounts.rows.find((a) => a.username === "files-privadmin");
  const privMem = (await app.store.list("org_memberships")).find(
    (m) => m.orgId === "org-demo" && m.principalId === privRow._id,
  );
  await app.store.change(
    "org_memberships",
    privMem._id,
    (old) => ({ ...old, permissions: ["identity.readPrivate"] }),
    { actor: "system", actorId: "system", action: "测试授权" },
  );
});
after(async () => {
  await new Promise((r) => app.server.close(r));
  await rm(dir, { recursive: true, force: true });
});

test("§12 v2 信封 + Idempotency-Key：缺失→400，重放→同 fileId，冲突→409", async () => {
  const missing = await postFile("files", PNG, { idem: "" }).then((r) => r.status);
  assert.equal(missing, 400);
  const key = randomUUID();
  const first = await postFile("files", PNG, { idem: key });
  assert.equal(first.status, 201);
  const firstId = (await first.json()).data.fileId;
  const replay = await postFile("files", PNG, { idem: key });
  assert.equal(replay.status, 201);
  assert.equal((await replay.json()).data.fileId, firstId); // 重放返回同一结果
  // 同一幂等键 + 不同请求体（name 不同 → bodyDigest 不同）→ 冲突 409
  const conflict = await postFile("files", PNG, { idem: key, purpose: "content-image", name: "diff.png" });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "IDEMPOTENCY_CONFLICT");
});

test("§10 #7 editor 可上传 public；editor 上传 private → 403", async () => {
  const pub = await postFile("files", PNG, { auth: editor });
  assert.equal(pub.status, 201);
  const priv = await postFile("files", PNG, { auth: editor, purpose: "identity-document" });
  assert.equal(priv.status, 403);
  assert.equal((await priv.json()).error.code, "FORBIDDEN");
});

test("§10 #6 下载鉴权：viewer 读 public→200；viewer 读 private→404；admin 可上传 private 但读需 identity.readPrivate", async () => {
  // 公共图（admin 上传）
  const pub = await postFile("files", PNG, { auth: admin });
  const pubId = (await pub.json()).data.fileId;
  // 私密图（identity-document）：三次复审后读取权限点改为 identity.readPrivate，
  // 写入仍按组织管理员角色（无需任何读取权限点），故由无权限点的 admin 上传即可。
  const priv = await postFile("files", PNG, { auth: admin, purpose: "identity-document" });
  assert.equal(priv.status, 201);
  const privId = (await priv.json()).data.fileId;

  const dl = (id, auth) =>
    fetch(`${url}/api/v2/files/${id}/download`, {
      headers: { Origin: url, Cookie: auth.cookie },
    });
  // viewer 读 public → 200
  const vPub = await dl(pubId, viewer);
  assert.equal(vPub.status, 200);
  assert.equal(await vPub.text(), PNG.toString());
  // viewer 读 private → 404（与不存在同态）
  const vPriv = await dl(privId, viewer);
  assert.equal(vPriv.status, 404);
  // 持有 identity.readPrivate 的 privAdmin 读 private → 200
  const aPriv = await dl(privId, privAdmin);
  assert.equal(aPriv.status, 200);
  assert.equal(await aPriv.text(), PNG.toString());
  // 复审要点：上传该私密文件的 admin（无 identity.readPrivate）读取 → 404——
  // 读写权限分立，凭 role==="admin" 不再无条件放行读取。
  const barePriv = await dl(privId, admin);
  assert.equal(barePriv.status, 404);
  // 无权限点的 editor 不能上传证件（写入仅限组织管理员角色）
  const editorUp = await postFile("files", PNG, { auth: editor, purpose: "identity-document" });
  assert.equal(editorUp.status, 403);
});

test("§10 #5 跨组织隔离：无成员资格账号读文件/列表 → 404 同态", async () => {
  const pub = await postFile("files", PNG, { auth: admin });
  const pubId = (await pub.json()).data.fileId;
  // 无成员资格的 outsider：列表 → 404；下载 → 404
  assert.equal((await v2("files", { auth: outsider })).status, 404);
  const dl = await fetch(`${url}/api/v2/files/${pubId}/download`, {
    headers: { Origin: url, Cookie: outsider.cookie },
  });
  assert.equal(dl.status, 404);
});

test("§10 #4 /api/vr-download 命中私密 file_assets → 404（与不存在同态）", async () => {
  // 直接注入一条 private 的 vr-files 资产（.html 后缀以通过 vrFile() 格式校验
  // /^\/vr-files\/[a-f0-9-]+\.(zip|html)$/，否则会先被 vrFile 拦成 400），挂到
  // content.vrFile.url。命中私密资产 → 404，与「不存在」同态防枚举。
  const uuid = randomUUID();
  const objKey = `vr-files/${uuid}.html`;
  await app.store.transact(
    [{ collection: "file_assets", id: "f-vr-priv" }],
    () => [{ collection: "file_assets", id: "f-vr-priv", data: {
      orgId: "org-demo", storage: "local", objectKey: objKey,
      visibility: "private", bucket: "private", status: "ready",
      schemaVersion: 2, revision: 1, createdAt: Date.now(),
    } }],
    { actor: "t", actorId: "t", action: "seed" },
  );
  await app.store.transact(
    [{ collection: "content", id: "content-vr-priv" }],
    () => [{ collection: "content", id: "content-vr-priv", data: { title: "私密VR", vrFile: { url: `/${objKey}`, name: "x.html", size: 1024 } } }],
    { actor: "t", actorId: "t", action: "seed" },
  );
  const dl = await fetch(`${url}/api/vr-download?id=content-vr-priv`, {
    headers: { Origin: url, Cookie: admin.cookie },
  });
  assert.equal(dl.status, 404);
});

test("§10 #4b /uploads/* 静态：public 旧图 200；同路径改密 private → 404", async () => {
  // 正向：旧上传产生 /uploads/<uuid>.png
  const up = await fetch(`${url}/api/uploads`, {
    method: "POST",
    headers: { Origin: url, Cookie: admin.cookie, "X-CSRF-Token": admin.csrf, "Content-Type": "application/octet-stream" },
    body: PNG,
  });
  assert.equal(up.status, 200);
  const upBody = await up.json();
  const upUrl = upBody.url; // /uploads/<uuid>.png
  const path = upUrl; // 已是 /uploads/...
  const ok = await fetch(`${url}${path}`, { headers: { Origin: url } });
  assert.equal(ok.status, 200);
  // 把该记录改密为 private（命中集合 objectKey=uploads/<uuid>.png）
  const asset = (await app.store.list("file_assets")).find((r) => r.legacyUrls?.includes(upUrl));
  await app.store.transact(
    [{ collection: "file_assets", id: asset._id }],
    () => [{ collection: "file_assets", id: asset._id, data: { visibility: "private", bucket: "private" } }],
    { actor: "t", actorId: "t", action: "改密" },
  );
  const denied = await fetch(`${url}${path}`, { headers: { Origin: url } });
  assert.equal(denied.status, 404);
  // 另一条 public 旧图仍 200（正负对照）
  const up2 = await fetch(`${url}/api/uploads`, {
    method: "POST",
    headers: { Origin: url, Cookie: admin.cookie, "X-CSRF-Token": admin.csrf, "Content-Type": "application/octet-stream" },
    body: PNG,
  });
  const ok2 = await fetch(`${url}${(await up2.json()).url}`, { headers: { Origin: url } });
  assert.equal(ok2.status, 200);
});

// ───────── live 模式夹具：image-url 红线 / fallback / 作用域 ─────────
function makeFakeCloudStore() {
  const assets = [];
  const contents = [];
  const fakeApp = {
    uploadFile: async ({ cloudPath }) => ({ fileID: `cloud://env.bucket/${cloudPath}` }),
    downloadFile: async ({ fileID }) => ({ fileContent: Buffer.from(`cloud:${fileID}`) }),
    getTempFileURL: async ({ fileList }) => ({
      fileList: fileList.map((f) => ({ fileID: f.fileID, tempFileURL: `https://tmp.example/${encodeURIComponent(f.fileID)}` })),
    }),
  };
  return {
    app: fakeApp,
    _assets: assets,
    _contents: contents,
    async list(name) {
      if (name === "file_assets") return assets;
      if (name === "content") return contents;
      return [];
    },
    async transact(refs, fn) {
      const state = {};
      for (const r of refs) {
        const arr = r.collection === "file_assets" ? assets : r.collection === "content" ? contents : [];
        state[`${r.collection}/${r.id}`] = arr.find((x) => x._id === r.id);
      }
      const writes = fn(state);
      for (const w of writes) {
        const arr = w.collection === "file_assets" ? assets : w.collection === "content" ? contents : null;
        if (!arr) continue;
        const i = arr.findIndex((x) => x._id === w.id);
        if (i >= 0) arr[i] = { ...arr[i], ...w.data };
        else arr.push({ _id: w.id, ...w.data });
      }
    },
    async change() {},
  };
}

async function makeLiveApp(t) {
  const ldir = await mkdtemp(join(tmpdir(), "smartpm-live-"));
  const store = makeFakeCloudStore();
  const accounts = await new Accounts(ldir).init();
  await accounts.save({ username: "liveadmin", name: "LA", role: "admin", password: "live-admin-pass-12", enabled: true });
  // createApp(live) 要求 origin；该值仅用于 POST/PUT 的 Origin 同源校验，
  // 故请求侧统一用同一字符串即可（与真实监听端口无关）。
  const origin = "http://127.0.0.1:0";
  const lapp = await createApp({ mode: "live", directory: ldir, store, accounts, origin });
  await new Promise((res) => lapp.server.listen(0, "127.0.0.1", res));
  const lurl = `http://127.0.0.1:${lapp.server.address().port}`;
  const login = await fetch(`${lurl}/api/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "liveadmin", password: "live-admin-pass-12" }),
  });
  assert.equal(login.status, 200, "live 登录应成功");
  const auth = { cookie: login.headers.get("set-cookie")?.split(";")[0] };
  t.after(async () => {
    await new Promise((r) => lapp.server.close(r));
    await rm(ldir, { recursive: true, force: true });
  });
  return { lapp, lurl, auth, store };
}

const imageUrl = (lurl, id, auth) =>
  fetch(`${lurl}/api/image-url?id=${encodeURIComponent(id)}`, {
    headers: { Cookie: auth.cookie },
  });

test("§10 #3 红线：image-url 命中 private file_assets → 403，与 fallback 无关", async (t) => {
  const { lurl, auth, store } = await makeLiveApp(t);
  const asset = {
    _id: "f-priv", orgId: null, storage: "cloud", objectKey: "admin/x.png",
    cloudFileId: "cloud://env.bucket/admin/x.png", visibility: "private", status: "ready",
    bucket: "private", schemaVersion: 2, revision: 1, createdAt: Date.now(),
  };
  store._assets.push(asset);
  // 默认 deny
  let r = await imageUrl(lurl, "cloud://env.bucket/admin/x.png", auth);
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /私密图片禁止签发临时 URL|FILE_FORBIDDEN/);
  // allow 下红线仍生效
  const prev = process.env.FILE_LEGACY_IMAGE_FALLBACK;
  process.env.FILE_LEGACY_IMAGE_FALLBACK = "allow";
  try {
    r = await imageUrl(lurl, "cloud://env.bucket/admin/x.png", auth);
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /私密图片禁止签发临时 URL|FILE_FORBIDDEN/);
  } finally {
    if (prev === undefined) delete process.env.FILE_LEGACY_IMAGE_FALLBACK;
    else process.env.FILE_LEGACY_IMAGE_FALLBACK = prev;
  }
});

test("§10 #3b deny 默认→未登记旧 cloud 图片 403；allow→200", async (t) => {
  const { lurl, auth, store } = await makeLiveApp(t);
  // 未登记：admin/<uuid>.png（图片类型）
  const id = "cloud://env.bucket/admin/old.png";
  let r = await imageUrl(lurl, id, auth);
  assert.equal(r.status, 403); // 默认 deny
  const prev = process.env.FILE_LEGACY_IMAGE_FALLBACK;
  process.env.FILE_LEGACY_IMAGE_FALLBACK = "allow";
  try {
    r = await imageUrl(lurl, id, auth);
    assert.equal(r.status, 200);
    assert.ok((await r.json()).url);
  } finally {
    if (prev === undefined) delete process.env.FILE_LEGACY_IMAGE_FALLBACK;
    else process.env.FILE_LEGACY_IMAGE_FALLBACK = prev;
  }
  void store;
});

test("§10 #3c 作用域：admin-vr/*.zip 经 image-url → 403；admin-vr/*.html 经 vr-download → 200", async (t) => {
  const { lurl, auth } = await makeLiveApp(t);
  // admin-vr/*.zip 非图片类型 → 403（无论是否登记）
  const zip = await imageUrl(lurl, "cloud://env.bucket/admin-vr/tour.zip", auth);
  assert.equal(zip.status, 403);
  assert.match((await zip.json()).error, /图片接口仅服务图片类型|FILE_FORBIDDEN/);
  // 正向：admin-vr/*.html 经 vr-download → 200
  const live = await makeLiveApp(t);
  const htmlId = randomUUID();
  const htmlUrl = `cloud://env.bucket/admin-vr/${htmlId}.html`;
  live.store._contents.push({
    _id: "content-vr-html", title: "VR", vrFile: { url: htmlUrl, name: "tour.html", size: 2048 },
  });
  const dl = await fetch(`${live.lurl}/api/vr-download?id=content-vr-html`, {
    headers: { Origin: live.lurl, Cookie: live.auth.cookie },
  });
  assert.equal(dl.status, 200);
  assert.equal(await dl.text(), `cloud:${htmlUrl}`);
});

// ───────── 复审 F01–F03 专项回归（PR #5 review） ─────────

test("F01 回归（三次复审·identity.readPrivate）：admin 可上传证件、但仅 readPrivate 可读", async () => {
  // 场景4：写入按组织管理员角色，无读取权限的 admin 仍可上传私密文件。
  const up = await postFile("files", PNG, { auth: admin, purpose: "identity-document" });
  assert.equal(up.status, 201);
  const id = (await up.json()).data.fileId;
  const get = (a) =>
    fetch(`${url}/api/v2/files/${id}/download`, { headers: { Origin: url, Cookie: a.cookie } });
  // 场景1：无 identity.readPrivate 的 admin 下载 → 404（与不存在同态）
  assert.equal((await get(admin)).status, 404);
  // 持有 identity.readPrivate 的 privAdmin 下载 → 200
  assert.equal((await get(privAdmin)).status, 200);
});

test("F02 回归：同路径重复登记 public+private，匿名下载 404（不被 public 副本遮蔽）", async () => {
  // 1) 旧上传登记一条 public：objectKey = uploads/<uuid>.png
  const up = await fetch(`${url}/api/uploads`, {
    method: "POST",
    headers: { Origin: url, Cookie: admin.cookie, "X-CSRF-Token": admin.csrf, "Content-Type": "application/octet-stream" },
    body: PNG,
  });
  assert.equal(up.status, 200);
  const upUrl = (await up.json()).url; // /uploads/<uuid>.png
  // 对照：仅 public 时匿名可读 200
  assert.equal((await fetch(`${url}${upUrl}`, { headers: { Origin: url } })).status, 200);
  // 2) 同一 objectKey / legacyUrl 再登记一条 private（重复登记）
  const pubAsset = (await app.store.list("file_assets")).find((r) => r.legacyUrls?.includes(upUrl));
  await app.store.transact(
    [{ collection: "file_assets", id: "f-dup-priv" }],
    () => [{ collection: "file_assets", id: "f-dup-priv", data: {
      orgId: "org-demo", storage: "local", objectKey: pubAsset.objectKey,
      legacyUrls: [upUrl], visibility: "private", bucket: "private",
      status: "ready", schemaVersion: 2, revision: 1, createdAt: Date.now(),
    } }],
    { actor: "t", actorId: "t", action: "seed" },
  );
  // 3) 修复前 matchFileAsset 用 find() 取首条命中（public 先登记）→ 匿名 200；
  //    修复后「最严取胜」命中 private → 404。
  assert.equal((await fetch(`${url}${upUrl}`, { headers: { Origin: url } })).status, 404);
});

test("F03 回归（复审·分页前过滤）：未授权私密文件从列表剔除，不泄露元数据", async () => {
  const priv = await postFile("files", PNG, { auth: privAdmin, purpose: "identity-document", name: "secret-id.png" });
  assert.equal(priv.status, 201);
  const privId = (await priv.json()).data.fileId;
  // 复审：列表在分页前过滤无权查看的私密文件——普通 viewer 根本看不到该条目，
  // 而非旧实现那样「脱敏后仍在列表中」，避免私密元数据经分页泄露或占用槽位。
  const vList = await v2("files", { auth: viewer });
  assert.equal(vList.status, 200);
  const privRow = vList.data.data.find((r) => r._id === privId);
  assert.equal(privRow, undefined, "未授权者列表不应包含该私密文件");
  // 持有权限点的 privAdmin：可见完整元数据
  const aList = await v2("files", { auth: privAdmin });
  assert.equal(aList.status, 200);
  const aRow = aList.data.data.find((r) => r._id === privId);
  assert.ok(aRow.objectKey, "授权者应看到完整元数据");
  assert.match(aRow.objectKey, /^private\//);
});


test("F04 回归（三次复审）：仅 identity.review 时下载/列表/关联均不可见；readPrivate 可读且审计；撤销即拒", async () => {
  // 预备：用无读取权限的 admin 上传证件，并注入一条指向它的私密关联（API 无法
  // 为 private 文件建关联，因私有关联实体本期未建，此处直注 file_links 验证过滤）。
  const up = await postFile("files", PNG, { auth: admin, purpose: "identity-document", name: "secret.png" });
  assert.equal(up.status, 201);
  const id = (await up.json()).data.fileId;
  const linkId = `link-${id}`;
  await app.store.transact(
    [{ collection: "file_links", id: linkId }],
    () => [{ collection: "file_links", id: linkId, data: {
      orgId: "org-demo", fileId: id, entityType: "content", entityId: "c1",
      usage: "other", state: "attached",
      attachedBy: { actorType: "adminAccount", actorId: "t" },
      revision: 1, schemaVersion: 2, createdAt: Date.now(),
    } }],
    { actor: "t", actorId: "t", action: "seed" },
  );

  // 建一个专属测试账号，便于在用例内动态切换其成员权限点。
  const mkAcc = async (username, role, perms) => {
    await app.accounts.save({ username, name: username, role, password: "test-only-password-123", enabled: true });
    const login = await fetch(`${url}/api/login`, {
      method: "POST", headers: { Origin: url, "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "test-only-password-123" }),
    });
    const sess = { cookie: login.headers.get("set-cookie")?.split(";")[0], csrf: (await login.json()).csrf };
    const row = app.accounts.rows.find((a) => a.username === username);
    const orgs = new OrgService(app.store);
    await orgs.grantMembership(
      { orgId: "org-demo", principalType: "adminAccount", principalId: row._id, role },
      { actor: "system", actorId: "system", action: "测试授权" },
    );
    const mem = (await app.store.list("org_memberships")).find(
      (m) => m.orgId === "org-demo" && m.principalId === row._id,
    );
    if (perms) await app.store.change("org_memberships", mem._id, (old) => ({ ...old, permissions: perms }), { actor: "system", actorId: "system", action: "测试授权" });
    return { sess, memId: mem._id };
  };
  const setPerms = (memId, perms) =>
    app.store.change("org_memberships", memId, (old) => ({ ...old, permissions: perms }), { actor: "system", actorId: "system", action: "测试授权" });

  const { sess: tester, memId } = await mkAcc("files-tester", "admin", ["identity.review"]);
  const dl = (a) => fetch(`${url}/api/v2/files/${id}/download`, { headers: { Origin: url, Cookie: a.cookie } });
  const list = (a) => v2("files", { auth: a });
  const links = (a) => v2("file-links", { auth: a });

  // 场景1：仅持 identity.review（无 identity.readPrivate）→ 下载/列表/关联均不可见
  assert.equal((await dl(tester)).status, 404);
  let l = await list(tester);
  assert.equal(l.status, 200);
  assert.equal(l.data.data.find((r) => r._id === id), undefined, "列表不应出现该私密文件");
  let ls = await links(tester);
  assert.equal(ls.status, 200);
  assert.equal(ls.data.data.find((r) => r._id === linkId), undefined, "关联列表不应出现该私密关联");

  // 场景2：授予 identity.readPrivate → 可读且写入访问审计
  await setPerms(memId, ["identity.readPrivate"]);
  assert.equal((await dl(tester)).status, 200);
  l = await list(tester);
  const row = l.data.data.find((r) => r._id === id);
  assert.ok(row, "授权后列表应出现该私密文件");
  assert.ok(row.objectKey, "授权者应看到完整元数据");
  ls = await links(tester);
  assert.ok(ls.data.data.find((r) => r._id === linkId), "授权后关联列表应出现该私密关联");
  const audit = (await app.store.list("file_access_log")).filter(
    (x) => x.action === "download" && x.fileId === id,
  );
  assert.ok(audit.length >= 1, "应记录下载访问审计");

  // 场景3：撤销 identity.readPrivate 后立即拒绝（下次请求即生效，无缓存窗口）
  await setPerms(memId, []);
  assert.equal((await dl(tester)).status, 404);
});
