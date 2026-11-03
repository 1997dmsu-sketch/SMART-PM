// DB-07 T05 HTTP 层测试（docs/database/DB-07-IMPLEMENTATION.md §10）。
//
// 纯新增，不改任何既有用例。覆盖：
//   §12    v2 信封 / Idempotency-Key 缺失·重放·冲突
//   §10 #7  editor 可上传 public；editor 上传 private → 403
//   §10 #6  下载鉴权：viewer 读 public→200；viewer 读 private→404；admin 读 private→200
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
let app, dir, url, admin, editor, viewer, outsider;
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

  const orgs = new OrgService(app.store);
  for (const acc of [editor, viewer]) {
    const row = app.accounts.rows.find((a) => a.username === (acc === editor ? "files-editor" : "files-viewer"));
    await orgs.grantMembership(
      { orgId: "org-demo", principalType: "adminAccount", principalId: row._id, role: row.role },
      { actor: "system", actorId: "system", action: "测试授权" },
    );
  }
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

test("§10 #6 下载鉴权：viewer 读 public→200；viewer 读 private→404；admin 读 private→200", async () => {
  // 公共图（admin 上传）
  const pub = await postFile("files", PNG, { auth: admin });
  const pubId = (await pub.json()).data.fileId;
  // 私密图（identity-document，admin 上传）
  const priv = await postFile("files", PNG, { auth: admin, purpose: "identity-document" });
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
  // admin 读 private → 200
  const aPriv = await dl(privId, admin);
  assert.equal(aPriv.status, 200);
  assert.equal(await aPriv.text(), PNG.toString());
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
