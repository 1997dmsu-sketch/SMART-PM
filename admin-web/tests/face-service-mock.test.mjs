import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CREDENTIAL_STATUS,
  JOB_STATUS,
  assertFaceCredentialInput,
  assertJobInput,
  publicCredential,
  assertTransition,
  canTransition,
  projectCredential,
  matchFaceRoute,
  FACE_ROUTES,
  MockFaceAccessProvider,
  classifyProviderError,
  createFaceProvider,
} from "../lib/face-service/index.mjs";

const UUID = "11111111-2222-4333-8444-555555555555";

test("DTO：personId 必须为稳定 UUID，任务 action 受限", () => {
  assert.deepEqual(assertFaceCredentialInput({ orgId: "o", personId: UUID, faceFileId: "f" }), {
    orgId: "o", personId: UUID, faceFileId: "f",
  });
  assert.throws(() => assertFaceCredentialInput({ orgId: "o", personId: "p1", faceFileId: "f" }), /UUID/);
  assert.throws(() => assertFaceCredentialInput({ orgId: "o", personId: UUID }), /faceFileId/);
  assert.throws(() => assertJobInput({ orgId: "o", credentialId: "c", deviceId: "d", action: "sync" }), /create\/delete/);
});

test("publicCredential 不返回人脸字节或摘要", () => {
  const out = publicCredential({
    _id: "c1", orgId: "o", personId: UUID, status: "approved", revision: 3,
    checksum: "a".repeat(64), faceImage: Buffer.from("img"), bytes: Buffer.from("img"),
  });
  assert.equal("checksum" in out, false);
  assert.equal("faceImage" in out, false);
  assert.equal("bytes" in out, false);
  assert.equal(out.credentialId, "c1");
});

test("状态机：合法迁移通过，非法迁移抛错", () => {
  assert.equal(canTransition(CREDENTIAL_STATUS.DRAFT, CREDENTIAL_STATUS.SUBMITTED), true);
  assert.equal(canTransition(CREDENTIAL_STATUS.DRAFT, CREDENTIAL_STATUS.APPROVED), false);
  assert.throws(
    () => assertTransition(CREDENTIAL_STATUS.REJECTED, CREDENTIAL_STATUS.APPROVED),
    /非法状态迁移/,
  );
});

test("投影：Mock 成功不算设备生效；撤销/失败告警正确", () => {
  const record = { _id: "c1", status: CREDENTIAL_STATUS.SYNCED };
  const jobs = [{ credentialId: "c1", status: JOB_STATUS.SUCCEEDED, action: "create", createdAt: 1 }];
  const mock = projectCredential(record, { jobs, providerKind: "mock" });
  assert.equal(mock.businessAllowed, true);
  assert.equal(mock.deviceEffective, false);

  const real = projectCredential(record, { jobs, providerKind: "real" });
  assert.equal(real.deviceEffective, true);

  const revoked = projectCredential({ _id: "c2", status: CREDENTIAL_STATUS.REVOKED });
  assert.equal(revoked.businessAllowed, false);

  const failed = projectCredential({ _id: "c3", status: CREDENTIAL_STATUS.SYNC_FAILED });
  assert.equal(failed.alert, true);
});

test("Mock success：upsert/delete 正常返回", async () => {
  const p = new MockFaceAccessProvider({ scenario: "success" });
  assert.equal((await p.upsertCredential({ credentialId: "c1", personId: UUID, faceFileId: "f1" })).status, "succeeded");
  assert.equal((await p.queryCredential({ personId: UUID })).status, "present");
  assert.equal((await p.deleteCredential({ credentialId: "c1", personId: UUID })).status, "succeeded");
  assert.equal((await p.queryCredential({ personId: UUID })).status, "absent");
});

test("Mock offline：pre_send 可重试；post_send 未知结果不可重试", async () => {
  const offline = new MockFaceAccessProvider({ scenario: "device_offline" });
  await assert.rejects(
    () => offline.upsertCredential({ credentialId: "c", personId: UUID, faceFileId: "f" }),
    (e) => classifyProviderError(e).retryable === true,
  );

  const unknown = new MockFaceAccessProvider({ scenario: "post_send_unknown" });
  await assert.rejects(
    () => unknown.upsertCredential({ credentialId: "c", personId: UUID, faceFileId: "f" }),
    (e) => {
      const c = classifyProviderError(e);
      return c.retryable === false && c.unknownResult === true;
    },
  );
});

test("Mock terminal_fail 与 revoke_fail：失败分类与错误码", async () => {
  const terminal = new MockFaceAccessProvider({ scenario: "terminal_fail" });
  await assert.rejects(
    () => terminal.upsertCredential({ credentialId: "c", personId: UUID, faceFileId: "f" }),
    (e) => e.code === "DEVICE_REJECTED" && classifyProviderError(e).retryable === false,
  );

  const revoke = new MockFaceAccessProvider({ scenario: "revoke_fail" });
  assert.equal((await revoke.upsertCredential({ credentialId: "c", personId: UUID, faceFileId: "f" })).status, "succeeded");
  await assert.rejects(() => revoke.deleteCredential({ credentialId: "c", personId: UUID }), /DEVICE_REJECTED/);
});

test("Mock duplicate_callback：重放不产生第二次物理操作", async () => {
  const p = new MockFaceAccessProvider({ scenario: "duplicate_callback" });
  const a = await p.upsertCredential({ credentialId: "c", personId: UUID, faceFileId: "f" });
  const b = await p.upsertCredential({ credentialId: "c", personId: UUID, faceFileId: "f" });
  assert.deepEqual(a, b);
  assert.equal(p.calls.filter((x) => x.action === "upsert").length, 2); // 调用两次，但结果复用
});

test("createFaceProvider：live 禁止 Mock，未知 provider 拒绝", () => {
  assert.throws(() => createFaceProvider({ mode: "live" }), /禁止 Mock/);
  assert.throws(() => createFaceProvider({ mode: "demo", provider: "real" }), /未知 provider/);
  assert.equal(createFaceProvider({ mode: "demo" }).providerKind, "mock");
});

test("路由表：路径参数解析与方法不匹配", () => {
  const hit = matchFaceRoute("POST", "/api/v2/face-credentials/abc-123/review");
  assert.equal(hit.route.id, "face-credential-review");
  assert.equal(hit.params.credentialId, "abc-123");

  assert.equal(matchFaceRoute("DELETE", "/api/v2/face-credentials/abc/review"), null);
  assert.ok(FACE_ROUTES.some((r) => r.id === "face-credential-list"));
});
