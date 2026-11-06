import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalStore } from "../lib/store.mjs";
import { FileService } from "../lib/files.mjs";

const orgId = "org-ref";
const audit = { actor: "system", actorId: "system", action: "测试引用" };
const ref = (collection, id) => ({ collection, id });

let store, dir;
const actor = { actorType: "user", actorId: "acc-submit", role: "editor", permissions: ["device.face.submit"] };

const files = () => new FileService(store, orgId, { actor });

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-face-ref-"));
  store = new LocalStore(dir);
  await store.init();
  await store.transact([ref("file_assets", "f-1"), ref("file_assets", "f-pub")], () => [
    {
      collection: "file_assets", id: "f-1",
      data: {
        orgId, purpose: "face-biometric", status: "ready", visibility: "private",
        mimeType: "image/jpeg", size: 1024, objectKey: "private/secret.jpg",
        checksum: "a".repeat(64), revision: 2,
      },
    },
    {
      collection: "file_assets", id: "f-pub",
      data: { orgId, purpose: "content-image", status: "ready", visibility: "public", mimeType: "image/png", size: 1, revision: 1 },
    },
  ], audit);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("prepareReference：具备 submit 即可引用人脸文件，不泄露位置/摘要/字节", async () => {
  const reference = await files().prepareReference("f-1");
  assert.deepEqual(reference, {
    fileId: "f-1", orgId, purpose: "face-biometric", revision: 2, mimeType: "image/jpeg", size: 1024,
  });
  const text = JSON.stringify(reference);
  assert.equal(text.includes("private/secret.jpg"), false);
  assert.equal(text.includes("a".repeat(64)), false);
});

test("prepareReference：无 submit 权限 → 403；非人脸/公开文件 → 404", async () => {
  const reader = new FileService(store, orgId, {
    actor: { ...actor, permissions: ["device.face.readPrivate"] },
  });
  await assert.rejects(() => reader.prepareReference("f-1"), (e) => e.status === 403);
  await assert.rejects(() => files().prepareReference("f-pub"), (e) => e.status === 404);
  await assert.rejects(() => files().prepareReference("missing"), (e) => e.status === 404);
});

test("assertReference：版本变化 → 409；有效引用通过", async () => {
  const service = files();
  const reference = await service.prepareReference("f-1");
  await store.transact([ref("file_assets", "f-1")], (state) => {
    assert.deepEqual(service.assertReference(state, reference), { fileId: "f-1", revision: 2 });
    return [];
  }, audit);

  await store.transact([ref("file_assets", "f-1")], () => [
    { collection: "file_assets", id: "f-1", data: { revision: 3 } },
  ], audit);
  await assert.rejects(
    () => store.transact([ref("file_assets", "f-1")], (state) => {
      service.assertReference(state, reference);
      return [];
    }, audit),
    (e) => e.code === "FILE_CHANGED" || e.status === 409,
  );
});

test("assertReference：文件被移除或改为公开 → 失败关闭", async () => {
  const service = files();
  const reference = await service.prepareReference("f-1");
  await store.transact([ref("file_assets", "f-1")], () => [
    { collection: "file_assets", id: "f-1", data: { visibility: "public" } },
  ], audit);
  await assert.rejects(
    () => store.transact([ref("file_assets", "f-1")], (state) => {
      service.assertReference(state, reference);
      return [];
    }, audit),
    (e) => e.status === 404,
  );
});
