// HK-AI-03 阶段 2 复审（fdbe4bf）两项阻断的补测：
//   1. 未知 purpose：请求体只发送 1KB（Content-Length 1MB）时服务器已返回 400，
//      证明在读 body 前拒绝，而不是收完再拒。
//   2. 并发/队列：通过 HTTP 上传证明超限请求快速 503 + 统一 RATE_LIMITED 信封，
//      底层任务结束后新上传恢复成功。
//
// 并发上限必须在导入 server.mjs 之前设置，因此本文件用动态 import 且独占进程。
process.env.FACE_DECODE_CONCURRENCY = "1";
process.env.FACE_DECODE_QUEUE = "1"; // 0 会被 `|| 8` 回退为默认值，故用 1

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { OrgService } from "../lib/org.mjs";

const { createApp } = await import("../server.mjs");

let app, dir, url, submitter;
let bigBytes;

const login = async (username) => {
  const r = await fetch(`${url}/api/login`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "test-only-password-123" }),
  });
  return { cookie: r.headers.get("set-cookie")?.split(";")[0], csrf: (await r.json()).csrf };
};

const postFace = (auth, bytes) =>
  fetch(`${url}/api/v2/files?purpose=face-biometric&name=face.jpg`, {
    method: "POST",
    headers: {
      Origin: url,
      Cookie: auth.cookie,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": randomUUID(),
      "Content-Type": "application/octet-stream",
    },
    body: bytes,
  });

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-face-bounds-"));
  app = await createApp({ directory: dir });
  await new Promise((res) => app.server.listen(0, "127.0.0.1", res));
  url = `http://127.0.0.1:${app.server.address().port}`;

  await app.accounts.save({
    username: "bounds-submit",
    name: "bounds-submit",
    role: "editor",
    password: "test-only-password-123",
    enabled: true,
  });
  submitter = await login("bounds-submit");
  const row = app.accounts.rows.find((a) => a.username === "bounds-submit");
  const orgs = new OrgService(app.store);
  await orgs.grantMembership(
    {
      orgId: "org-demo",
      principalType: "adminAccount",
      principalId: row._id,
      role: "editor",
      permissions: ["device.face.submit"],
    },
    { actor: "system", actorId: "system", action: "测试授权" },
  );

  // 16MP 纯色 JPEG：体积受限但解码耗时足够制造并发窗口
  bigBytes = await sharp({
    create: { width: 4096, height: 4096, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .jpeg({ quality: 1 })
    .toBuffer();
  assert.ok(bigBytes.length <= 200 * 1024, `fixture 必须 ≤200KB，实际 ${bigBytes.length}`);
});

after(async () => {
  await new Promise((r) => app.server.close(r));
  await rm(dir, { recursive: true, force: true });
});

test("未知 purpose：请求体未完成时已返回 400（读体前拒绝）", async () => {
  const result = await new Promise((resolve, reject) => {
    const target = new URL(url);
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: "/api/v2/files?purpose=not-a-purpose&name=x.jpg",
        method: "POST",
        headers: {
          Origin: url,
          Cookie: submitter.cookie,
          "X-CSRF-Token": submitter.csrf,
          "Idempotency-Key": randomUUID(),
          "Content-Type": "application/octet-stream",
          "Content-Length": String(1024 * 1024), // 声明 1MB，但只发 1KB
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => finish({ status: res.statusCode, body, sent: 1024 }));
      },
    );
    req.on("error", () => finish({ status: 0, body: "", sent: 1024 }));
    req.write(Buffer.alloc(1024, 1)); // 故意不 end()
    setTimeout(() => {
      req.destroy();
      reject(new Error("2s 内未返回响应：无法证明读体前拒绝"));
    }, 2000).unref();
  });

  assert.equal(result.status, 400, "应在请求体完成前返回 400");
  assert.equal(result.sent, 1024);
  const parsed = JSON.parse(result.body);
  assert.equal(parsed.error.code, "PARAM_ERROR");
});

test("HTTP 并发：超限快速 503 RATE_LIMITED，任务结束后新上传恢复", async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, () => postFace(submitter, bigBytes)),
  );
  const statuses = results.map((r) => r.status);
  const rejected = [];
  for (const r of results) {
    if (r.status === 503) rejected.push(await r.json());
    else assert.equal(r.status, 201);
  }
  assert.ok(rejected.length >= 1, `应至少有一个 503，实际 ${statuses.join(",")}`);
  for (const body of rejected) {
    assert.equal(body.error.code, "RATE_LIMITED");
  }

  // 底层任务结束后恢复
  await new Promise((r) => setTimeout(r, 500));
  const recovered = await postFace(submitter, bigBytes);
  assert.equal(recovered.status, 201);
});
