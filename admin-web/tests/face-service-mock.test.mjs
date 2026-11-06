import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_STATE,
  IMAGE_STATE,
  GRANT_STATE,
  JOB_STATE,
  assertFaceCredentialInput,
  assertRevokeInput,
  publicReviewItem,
  assertTransition,
  canTransition,
  projectAccess,
  matchFaceRoute,
  FACE_ROUTES,
  MockFaceAccessProvider,
  classifyProviderError,
  createFaceProvider,
} from "../lib/face-service/index.mjs";

const base = {
  orgId: "org-demo",
  personId: "person-001", // 有界不透明 ID，不是 UUID
  faceFileId: "face-file-1",
  opId: "op-001",
  requestDigest: "sha256:aaa",
};

test("DTO：personId 接受有界不透明 ID，不再强制 UUID", () => {
  assert.equal(assertFaceCredentialInput(base).personId, "person-001");
  assert.throws(() => assertFaceCredentialInput({ ...base, personId: "" }), /不透明 ID/);
  assert.throws(() => assertFaceCredentialInput({ ...base, personId: "x".repeat(129) }), /不透明 ID/);
  assert.throws(() => assertFaceCredentialInput({ ...base, personId: "has space" }), /不透明 ID/);
  assert.equal(assertRevokeInput({ ...base }).personId, "person-001");
});

test("审核队列投影：最小字段，无图片/摘要", () => {
  const item = publicReviewItem({
    _id: "c1", orgId: "org-demo", personId: "p1",
    reviewState: REVIEW_STATE.SUBMITTED, imageState: IMAGE_STATE.VERIFIED,
    checksum: "a".repeat(64), faceImage: "x", revision: 2,
  });
  assert.deepEqual(Object.keys(item).sort(), [
    "credentialId", "imageState", "orgId", "personId", "reviewState", "revision", "submittedAt",
  ]);
  assert.equal("checksum" in item, false);
  assert.equal("faceImage" in item, false);
});

test("三轴状态机独立：图片/审核/授权互不串写", () => {
  assert.equal(canTransition("review", REVIEW_STATE.SUBMITTED, REVIEW_STATE.APPROVED), true);
  assert.equal(canTransition("review", REVIEW_STATE.APPROVED, "synced"), false);
  assert.equal(canTransition("image", IMAGE_STATE.PENDING, IMAGE_STATE.VERIFIED), true);
  assert.equal(canTransition("grant", GRANT_STATE.EFFECTIVE, GRANT_STATE.SUSPENDED), true);
  assert.throws(() => assertTransition("job", JOB_STATE.SUCCEEDED, JOB_STATE.QUEUED), /非法状态迁移/);
});

test("businessAllowed 只来自 grant + 实时资格，不看审核状态", () => {
  const grantEffective = { credentialId: "c1", state: GRANT_STATE.EFFECTIVE };
  assert.equal(
    projectAccess({ grant: { credentialId: "c1", state: GRANT_STATE.REVOKED }, eligibility: { allowed: true } })
      .businessAllowed,
    false,
  );
  assert.equal(
    projectAccess({ grant: grantEffective, eligibility: { allowed: false } }).businessAllowed,
    false,
  );
  assert.equal(
    projectAccess({ grant: grantEffective, eligibility: { allowed: true } }).businessAllowed,
    true,
  );
});

test("deviceEffective 需要受信设备证据；Mock 不产生生效", () => {
  const grant = { credentialId: "c1", state: GRANT_STATE.EFFECTIVE };
  const jobs = [{ credentialId: "c1", state: JOB_STATE.SUCCEEDED, action: "create", updatedAt: 1 }];

  assert.equal(
    projectAccess({
      grant,
      eligibility: { allowed: true },
      jobs,
      deviceEvidence: { kind: "mock_result", trusted: false },
    }).deviceEffective,
    false,
  );
  assert.equal(
    projectAccess({
      grant,
      eligibility: { allowed: true },
      jobs,
      deviceEvidence: { kind: "device_ack", trusted: true },
    }).deviceEffective,
    true,
  );
  assert.equal(
    projectAccess({
      grant,
      eligibility: { allowed: true },
      jobs: [{ ...jobs[0], state: JOB_STATE.AWAITING_RESULT }],
      deviceEvidence: { kind: "device_ack", trusted: true },
    }).deviceEffective,
    false,
  );
});

test("冻结方法：enroll/update/revoke 均可用", async () => {
  const p = new MockFaceAccessProvider();
  assert.equal((await p.enrollFace(base)).status, "succeeded");
  assert.equal((await p.updateFace({ ...base, opId: "op-002" })).status, "succeeded");
  assert.equal((await p.revokeFace({ ...base, opId: "op-003" })).status, "succeeded");
  assert.equal((await p.queryOperation({ opId: "op-001" })).state, "succeeded");
});

test("幂等：同键同摘要重放，不重复执行", async () => {
  const p = new MockFaceAccessProvider();
  const first = await p.enrollFace(base);
  const replay = await p.enrollFace(base);
  assert.deepEqual(first, replay);
  assert.equal(p.calls.length, 1);
  assert.equal(p.people.size, 1);
});

test("幂等：同键不同摘要冲突；不同键独立执行", async () => {
  const p = new MockFaceAccessProvider();
  await p.enrollFace(base);
  await assert.rejects(
    () => p.enrollFace({ ...base, requestDigest: "sha256:bbb" }),
    (e) => e.code === "IDEMPOTENCY_CONFLICT",
  );
  await p.enrollFace({ ...base, opId: "op-other" });
  assert.equal(p.calls.length, 2);
});

test("post_send 未知：UNKNOWN_RESULT，op 停在 awaiting_result", async () => {
  const p = new MockFaceAccessProvider({ scenario: "post_send_unknown" });
  await assert.rejects(
    () => p.enrollFace(base),
    (e) => classifyProviderError(e) === "UNKNOWN_RESULT",
  );
  assert.equal((await p.queryOperation({ opId: base.opId })).state, "awaiting_result");
});

test("失败分类：offline 可重试，terminal 终态", async () => {
  const offline = new MockFaceAccessProvider({ scenario: "device_offline" });
  await assert.rejects(() => offline.enrollFace(base), (e) => classifyProviderError(e) === "RETRYABLE");

  const terminal = new MockFaceAccessProvider({ scenario: "terminal_fail" });
  await assert.rejects(() => terminal.enrollFace(base), (e) => classifyProviderError(e) === "TERMINAL");
});

test("verifyEvent：同 eventId 重放稳定；缺签名终态失败", async () => {
  const p = new MockFaceAccessProvider();
  const a = await p.verifyEvent({ eventId: "e1", payload: {} });
  const b = await p.verifyEvent({ eventId: "e1", payload: {} });
  assert.deepEqual(a, b);
  await assert.rejects(
    () => p.verifyEvent({ eventId: "e2", payload: {}, signature: "" }),
    (e) => classifyProviderError(e) === "TERMINAL",
  );
});

test("createFaceProvider：live 返回 NOT_CONFIGURED，不使用 MOCK_FORBIDDEN", () => {
  assert.throws(() => createFaceProvider({ mode: "live" }), (e) => e.code === "NOT_CONFIGURED");
  assert.throws(
    () => createFaceProvider({ mode: "demo", provider: "real" }),
    (e) => e.code === "NOT_CONFIGURED",
  );
  assert.ok(createFaceProvider({ mode: "demo" }) instanceof MockFaceAccessProvider);
});

test("路由权限：无 device.face.manage，审核队列用 review，图片用 readPrivate", () => {
  assert.equal(FACE_ROUTES.some((r) => r.permission === "device.face.manage"), false);

  const queue = matchFaceRoute("GET", "/api/v2/face-credentials/review-queue");
  assert.equal(queue.route.permission, "device.face.review");

  const image = matchFaceRoute("GET", "/api/v2/face-credentials/c1/image");
  assert.equal(image.route.permission, "device.face.readPrivate");
  assert.equal(image.params.credentialId, "c1");

  const retry = matchFaceRoute("POST", "/api/v2/device-jobs/j1/retry");
  assert.equal(retry.route.permission, "device.operation.retry");
});
