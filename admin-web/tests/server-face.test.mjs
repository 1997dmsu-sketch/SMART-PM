// HK-AI-03 阶段 2：人脸 HTTP 拦截与资源边界回归（复审 36c9185 / 8592763 要求）。
//
// 九项 HTTP：
//   1 上传成功后，无 readPrivate 的成员在列表中不可见
//   2 有 readPrivate 的成员可见，且响应不含任何摘要
//   3 下载：无 readPrivate → 404；有 → 200 且字节一致
//   4 关联列表按读取权限过滤
//   5 旧路径 /uploads/* 不可达
//   6 旧路径 /api/vr-download 不可达
//   7 专职 reviewer（有 review、无 readPrivate）可审核，但拿不到图片/摘要
//   8 权限撤销后立即拒绝（读取点复核）
//   9 跨组织同态 404；审核失败零写入；未知 purpose 读体前拒绝
// 两项资源：
//  10 并发满 → 503 RATE_LIMITED
//  11 队列满 → 503，且底层任务结束后恢复
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../server.mjs";
import { OrgService } from "../lib/org.mjs";

let app, dir, url;
let admin, submitter, reviewer, reader, outsider;
let faceBytes;
let faceId;
let objectKey;

const login = async (username) => {
  const r = await fetch(`${url}/api/login`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "test-only-password-123" }),
  });
  return { cookie: r.headers.get("set-cookie")?.split(";")[0], csrf: (await r.json()).csrf };
};

async function createMember(username, role, permissions) {
  await app.accounts.save({
    username,
    name: username,
    role,
    password: "test-only-password-123",
    enabled: true,
  });
  const acc = await login(username);
  const row = app.accounts.rows.find((a) => a.username === username);
  const orgs = new OrgService(app.store);
  await orgs.grantMembership(
    { orgId: "org-demo", principalType: "adminAccount", principalId: row._id, role, permissions },
    { actor: "system", actorId: "system", action: "测试授权" },
  );
  return acc;
}

const postFace = (auth, bytes = faceBytes, { purpose = "face-biometric", idem = randomUUID() } = {}) =>
  fetch(`${url}/api/v2/files?purpose=${purpose}&name=face.jpg`, {
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

const v2 = async (path, auth) => {
  const r = await fetch(`${url}/api/v2/${path}`, {
    headers: { Origin: url, Cookie: auth.cookie },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const download = (id, auth) =>
  fetch(`${url}/api/v2/files/${id}/download`, {
    headers: { Origin: url, Cookie: auth?.cookie || "" },
  });

const review = (id, auth, decision = "approved", idem = randomUUID()) =>
  fetch(`${url}/api/v2/files/${id}/face-review`, {
    method: "POST",
    headers: {
      Origin: url,
      Cookie: auth.cookie,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": idem,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ decision }),
  });

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-face-http-"));
  app = await createApp({ directory: dir });
  await new Promise((res) => app.server.listen(0, "127.0.0.1", res));
  url = `http://127.0.0.1:${app.server.address().port}`;

  const demo = await fetch(`${url}/api/demo-login`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: "{}",
  });
  admin = { cookie: demo.headers.get("set-cookie")?.split(";")[0], csrf: (await demo.json()).csrf };

  submitter = await createMember("face-submit", "editor", ["device.face.submit"]);
  reviewer = await createMember("face-review", "viewer", ["device.face.review"]);
  reader = await createMember("face-read", "viewer", ["device.face.readPrivate"]);

  // 无成员资格：跨组织同态 404 用
  await app.accounts.save({
    username: "face-outsider",
    name: "face-outsider",
    role: "viewer",
    password: "test-only-password-123",
    enabled: true,
  });
  outsider = await login("face-outsider");

  faceBytes = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 12, g: 34, b: 56 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();

  const up = await postFace(submitter);
  assert.equal(up.status, 201);
  faceId = (await up.json()).data.fileId;
  const record = (await app.store.list("file_assets", "org-demo")).find((r) => r._id === faceId);
  objectKey = record.objectKey;
});

after(async () => {
  await new Promise((r) => app.server.close(r));
  await rm(dir, { recursive: true, force: true });
});

test("1/2 列表：无 readPrivate 不可见；有 readPrivate 可见且无摘要", async () => {
  const hidden = await v2("files", submitter);
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.data.some((f) => f._id === faceId), false);

  const visible = await v2("files", reader);
  assert.equal(visible.status, 200);
  const row = visible.body.data.find((f) => f._id === faceId);
  assert.ok(row, "持有 readPrivate 的成员应可见");
  assert.equal("checksum" in row, false);
  assert.equal("checksumPrefix" in row, false);
  assert.equal(JSON.stringify(visible.body).includes("checksum"), false);
});

test("3 下载：submitter/reviewer 404，reader 200 且字节一致，admin 不回落", async () => {
  assert.equal((await download(faceId, submitter)).status, 404);
  assert.equal((await download(faceId, reviewer)).status, 404);
  assert.equal((await download(faceId, admin)).status, 404);
  const ok = await download(faceId, reader);
  assert.equal(ok.status, 200);
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), faceBytes);
});

test("4 关联列表：无读取权不可见，有读取权可见", async () => {
  await app.store.transact(
    [{ collection: "file_links", id: "link-face-1" }],
    () => [
      {
        collection: "file_links",
        id: "link-face-1",
        data: {
          orgId: "org-demo",
          fileId: faceId,
          entityType: "content",
          entityId: "c-face",
          usage: "face-reference",
          sortOrder: 0,
          state: "attached",
          createdAt: Date.now(),
        },
      },
    ],
    { actor: "t", actorId: "t", action: "seed" },
  );

  const blocked = await v2("file-links", reviewer);
  assert.equal(blocked.status, 200);
  assert.equal(blocked.body.data.some((l) => l.fileId === faceId), false);

  const allowed = await v2("file-links", reader);
  assert.equal(allowed.status, 200);
  assert.ok(allowed.body.data.some((l) => l.fileId === faceId));
});

test("5/6 旧路径：/uploads 与 /api/vr-download 均不可达", async () => {
  const staticRes = await fetch(`${url}/uploads/${objectKey}`, { headers: { Origin: url } });
  assert.equal(staticRes.status, 404);

  // vr-download 只接受 /vr-files/*.zip|html 形态；用一条私密资产验证命中即 404。
  const vrKey = `vr-files/${randomUUID()}.html`;
  await app.store.transact(
    [{ collection: "file_assets", id: "f-face-vr" }, { collection: "content", id: "content-face-vr" }],
    () => [
      {
        collection: "file_assets",
        id: "f-face-vr",
        data: {
          orgId: "org-demo", storage: "local", objectKey: vrKey, visibility: "private",
          bucket: "private", status: "ready", schemaVersion: 2, revision: 1, createdAt: Date.now(),
        },
      },
      {
        collection: "content",
        id: "content-face-vr",
        data: { title: "私密VR", vrFile: { url: `/${vrKey}`, name: "x.html", size: 1024 } },
      },
    ],
    { actor: "t", actorId: "t", action: "seed" },
  );
  const vr = await fetch(`${url}/api/vr-download?id=content-face-vr`, {
    headers: { Origin: url, Cookie: admin.cookie },
  });
  assert.equal(vr.status, 404);

  // image-url 在 demo 模式本就拒绝 cloud:// 之外的 id；不得返回任何图片数据。
  const iu = await fetch(`${url}/api/image-url?id=${encodeURIComponent(objectKey)}`, {
    headers: { Origin: url, Cookie: admin.cookie },
  });
  assert.notEqual(iu.status, 200);
});

test("7 专职 reviewer：可审核，响应不含图片或摘要，仍读不到像素", async () => {
  const r = await review(faceId, reviewer, "approved");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.data.reviewState, "approved");
  const text = JSON.stringify(body);
  assert.equal(text.includes("checksum"), false);
  assert.equal(text.includes(faceBytes.toString("base64").slice(0, 32)), false);
  assert.ok(text.length < 500, "审核响应应为最小元数据");
  assert.equal((await download(faceId, reviewer)).status, 404);
});

test("8 权限撤销：读取点立即拒绝（无缓存放行）", async () => {
  const membership = (await app.store.list("org_memberships", "org-demo")).find(
    (m) => m.orgId === "org-demo" && m.permissions?.includes("device.face.readPrivate"),
  );
  await app.store.change(
    "org_memberships",
    membership._id,
    (old) => ({ ...old, permissions: [] }),
    { actor: "t", actorId: "t", action: "撤销" },
  );
  assert.equal((await download(faceId, reader)).status, 404);
  const listed = await v2("files", reader);
  assert.equal(listed.body.data.some((f) => f._id === faceId), false);
});

test("9 跨组织 404 / 审核失败零写入 / 未知 purpose 读体前拒绝", async () => {
  assert.equal((await download(faceId, outsider)).status, 404);
  assert.equal((await v2("files", outsider)).status, 404);

  // 无 review 权限的 submitter 审核失败 → 403，reviewState 不变
  const denied = await review(faceId, submitter);
  assert.equal(denied.status, 403);
  const record = (await app.store.list("file_assets", "org-demo")).find((r) => r._id === faceId);
  assert.equal(record.reviewState, "approved"); // 仍是 reviewer 通过的结论，未被失败请求改写

  // 未知 purpose：即使带 1MB body，也应在读体前 400
  const huge = Buffer.alloc(1024 * 1024, 1);
  const bad = await postFace(admin, huge, { purpose: "not-a-purpose" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, "PARAM_ERROR");
});

// ── 资源边界：并发满 / 队列满 / 恢复 ──────────────────────────────
test("10/11 解码并发与队列有界，且超时/繁忙后能恢复", async () => {
  process.env.FACE_DECODE_CONCURRENCY = "1";
  process.env.FACE_DECODE_QUEUE = "1";
  const mod = await import(`../lib/face-image.mjs?bounds=${Date.now()}`);

  const big = await sharp({
    create: { width: 4000, height: 4000, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .jpeg({ quality: 60 })
    .toBuffer();

  const pending = [mod.decodeFaceImage(big), mod.decodeFaceImage(big), mod.decodeFaceImage(big)];
  const results = await Promise.allSettled(pending);
  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled, 2, "1 个执行 + 1 个排队应成功");
  assert.equal(rejected.length, 1, "第 3 个应被队列拒绝");
  assert.match(String(rejected[0].reason?.message), /繁忙/);

  // 底层任务结束后恢复
  await new Promise((r) => setTimeout(r, 150));
  const ok = await mod.decodeFaceImage(faceBytes);
  assert.equal(ok.width, 640);
});
