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
const auth = { membershipId: "mem-1" };

const files = (overrides = {}) =>
  new FileService(store, orgId, { auth, actor: { ...actor, ...overrides.actor }, ...overrides });

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-face-ref-"));
  store = new LocalStore(dir);
  await store.init();
  await store.transact(
    [ref("organizations", orgId), ref("org_memberships", "mem-1"), ref("org_memberships", "mem-adapter"), ref("file_assets", "f-1"), ref("file_assets", "f-big"), ref("file_assets", "f-pub"), ref("file_assets", "f-other"), ref("file_assets", "f-adapter")],
    () => [
      { collection: "organizations", id: orgId, data: { name: "引用组织", status: "active", revision: 1 } },
      { collection: "org_memberships", id: "mem-1", data: { orgId, status: "active", role: "editor", principalType: "adminAccount", principalId: "acc-submit", permissions: ["device.face.submit"], revision: 1 } },
      { collection: "org_memberships", id: "mem-adapter", data: { orgId, status: "active", role: "editor", principalType: "adminAccount", principalId: "acc-submit", permissions: ["device.face.submit"], revision: 1 } },
      { collection: "file_assets", id: "f-1", data: { orgId, purpose: "face-biometric", status: "ready", visibility: "private", mimeType: "image/jpeg", size: 1024, objectKey: "private/secret.jpg", checksum: "a".repeat(64), revision: 2 } },
      { collection: "file_assets", id: "f-big", data: { orgId, purpose: "face-biometric", status: "ready", visibility: "private", mimeType: "image/jpeg", size: 300 * 1024, revision: 1 } },
      { collection: "file_assets", id: "f-pub", data: { orgId, purpose: "content-image", status: "ready", visibility: "public", mimeType: "image/png", size: 1, revision: 1 } },
      { collection: "file_assets", id: "f-other", data: { orgId: "org-other", purpose: "face-biometric", status: "ready", visibility: "private", mimeType: "image/jpeg", size: 1, revision: 1 } },
      { collection: "file_assets", id: "f-adapter", data: { orgId, purpose: "face-biometric", status: "ready", visibility: "private", mimeType: "image/jpeg", size: 1024, revision: 1 } },
    ],
    audit,
  );
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("prepareReference：返回 refs，固定 face-biometric，不泄露位置/摘要", async () => {
  const reference = await files().prepareReference("f-1");
  assert.equal(reference.purpose, "face-biometric");
  assert.deepEqual(reference.refs.map((r) => r.collection).sort(), ["file_assets", "org_memberships", "organizations"]);
  const text = JSON.stringify(reference);
  assert.equal(text.includes("private/secret.jpg"), false);
  assert.equal(text.includes("a".repeat(64)), false);
});

test("不可见统一 404：无权限、非人脸、超大、跨组织、公开文件", async () => {
  const noPerm = files({ actor: { permissions: [] } });
  for (const service of [noPerm]) {
    await assert.rejects(() => service.prepareReference("f-1"), (e) => e.status === 404);
  }
  for (const id of ["f-pub", "f-big", "f-other", "missing"]) {
    await assert.rejects(() => files().prepareReference(id), (e) => e.status === 404);
  }
});

test("assertReference：事务内复核 membership 权限，撤销后立即失败", async () => {
  const service = files();
  const reference = await service.prepareReference("f-adapter");

  // 撤销权限
  await store.transact([ref("org_memberships", "mem-1")], (state) => [
    { collection: "org_memberships", id: "mem-1", data: { ...state["org_memberships/mem-1"], permissions: [] } },
  ], audit);
  await assert.rejects(
    () => store.transact(reference.refs, (state) => {
      service.assertReference(state, reference);
      return [];
    }, audit),
    (e) => e.status === 404,
  );

  // 恢复权限后可通过
  await store.transact([ref("org_memberships", "mem-1")], (state) => [
    { collection: "org_memberships", id: "mem-1", data: { ...state["org_memberships/mem-1"], permissions: ["device.face.submit"] } },
  ], audit);
  await store.transact(reference.refs, (state) => {
    assert.deepEqual(service.assertReference(state, reference), { fileId: "f-adapter", revision: 1 });
    return [];
  }, audit);
});

test("assertReference：membership 停用 / 文件版本变化", async () => {
  const service = files();
  const reference = await service.prepareReference("f-1");

  await store.transact([ref("org_memberships", "mem-1")], (state) => [
    { collection: "org_memberships", id: "mem-1", data: { ...state["org_memberships/mem-1"], status: "disabled" } },
  ], audit);
  await assert.rejects(
    () => store.transact(reference.refs, (state) => { service.assertReference(state, reference); return []; }, audit),
    (e) => e.status === 404,
  );
  await store.transact([ref("org_memberships", "mem-1")], (state) => [
    { collection: "org_memberships", id: "mem-1", data: { ...state["org_memberships/mem-1"], status: "active" } },
  ], audit);

  await store.transact(reference.refs, (state) => [
    { collection: "file_assets", id: "f-1", data: { ...state["file_assets/f-1"], revision: 3 } },
  ], audit);
  await assert.rejects(
    () => store.transact(reference.refs, (state) => { service.assertReference(state, reference); return []; }, audit),
    (e) => e.code === "FILE_CHANGED",
  );
});

test("引用校验不触碰 storage adapter", async () => {
  let adapterCalls = 0;
  const service = new FileService(store, orgId, {
    auth: { membershipId: "mem-adapter" },
    actor,
    config: {
      nas: { enabled: true, root: "/nonexistent" },
      local: { path: "/nonexistent" },
    },
  });
  const originalAdapters = service.adapterForFile?.bind(service);
  if (originalAdapters) service.adapterForFile = () => { adapterCalls += 1; return originalAdapters(); };
  const reference = await service.prepareReference("f-adapter");
  await store.transact(reference.refs, (state) => { service.assertReference(state, reference); return []; }, audit);
  assert.equal(adapterCalls, 0);
});
