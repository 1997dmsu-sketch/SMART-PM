import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalStore } from "../lib/store.mjs";
import { FileService, PURPOSES } from "../lib/files.mjs";

const orgId = "org-bind";
const audit = { actor: "system", actorId: "system", action: "绑定测试" };
const ref = (collection, id) => ({ collection, id });
const noPerms = { actorType: "user", actorId: "acc-manager", role: "admin", permissions: [] };

let store, dir;
const service = () => new FileService(store, orgId, { auth: null, actor: noPerms });

const base = { orgId, purpose: "face-biometric", status: "ready", visibility: "private", mimeType: "image/jpeg", size: 1024, revision: 1 };

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-face-binding-"));
  store = new LocalStore(dir);
  await store.init();
  await store.transact(
    ["ok", "cross", "public", "pending", "purpose", "mime", "big"].map((id) => ref("file_assets", id)),
    () => [
      { collection: "file_assets", id: "ok", data: { ...base, objectKey: "private/secret.jpg", checksum: "a".repeat(64) } },
      { collection: "file_assets", id: "cross", data: { ...base, orgId: "org-other" } },
      { collection: "file_assets", id: "public", data: { ...base, visibility: "public" } },
      { collection: "file_assets", id: "pending", data: { ...base, status: "staged" } },
      { collection: "file_assets", id: "purpose", data: { ...base, purpose: "content-image" } },
      { collection: "file_assets", id: "mime", data: { ...base, mimeType: "image/webp" } },
      { collection: "file_assets", id: "big", data: { ...base, size: PURPOSES["face-biometric"].maxSize + 1 } },
    ],
    audit,
  );
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const inTx = (id, binding) =>
  store.transact([ref("file_assets", id)], (state) => {
    service().assertBinding(state, binding);
    return [];
  }, audit);

test("合法绑定通过，且不要求 device.face.submit", async () => {
  await store.transact([ref("file_assets", "ok")], (state) => {
    assert.deepEqual(service().assertBinding(state, { fileId: "ok", revision: 1 }), { fileId: "ok", revision: 1 });
    return [];
  }, audit);
});

test("不可见文件统一 404：跨组织/公开/非 ready/错误 purpose/错误 MIME/超限", async () => {
  for (const id of ["cross", "public", "pending", "purpose", "mime", "big", "missing"]) {
    await assert.rejects(() => inTx(id, { fileId: id, revision: 1 }), (e) => e.status === 404, id);
  }
});

test("revision 变化或非整数 → FILE_CHANGED", async () => {
  await assert.rejects(() => inTx("ok", { fileId: "ok", revision: 2 }), (e) => e.code === "FILE_CHANGED");
  await assert.rejects(() => inTx("ok", { fileId: "ok", revision: "1" }), (e) => e.code === "FILE_CHANGED");
});

test("返回值不含位置/摘要/字节，且不访问 storage adapter", async () => {
  const svc = service();
  let adapterCalls = 0;
  svc.adapterForFile = () => { adapterCalls += 1; throw new Error("adapter 不应被调用"); };
  await store.transact([ref("file_assets", "ok")], (state) => {
    const out = svc.assertBinding(state, { fileId: "ok", revision: 1 });
    assert.deepEqual(Object.keys(out).sort(), ["fileId", "revision"]);
    assert.equal(JSON.stringify(out).includes("private/secret.jpg"), false);
    assert.equal(JSON.stringify(out).includes("a".repeat(64)), false);
    return [];
  }, audit);
  assert.equal(adapterCalls, 0);
});
