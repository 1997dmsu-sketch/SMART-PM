import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_STATE,
  IMAGE_STATE,
  GRANT_STATE,
  JOB_STATE,
  assertFaceAccessContext,
  assertFaceCredentialInput,
  assertRevokeInput,
  publicReviewItem,
  displayState,
  assertTransition,
  canTransition,
  projectAccess,
  matchFaceRoute,
  FACE_ROUTES,
  MockFaceAccessProvider,
  classifyProviderError,
  createFaceProvider,
} from "../lib/face-service/index.mjs";

const context = {
  orgId: "org-demo",
  deviceId: "device-1",
  grantId: "grant-1",
  validFrom: 1000,
  validUntil: 2000,
};

const base = {
  context,
  personId: "person-001",
  faceFileId: "face-file-1",
  opId: "op-001",
  requestDigest: "sha256:aaa",
};

const revokeBase = { context, personId: "person-001", opId: "op-r1", requestDigest: "sha256:r1" };

test("FaceAccessContext：orgId/deviceId/有效期必填且合法", () => {
  assert.deepEqual(assertFaceAccessContext(context), context);
  assert.throws(() => assertFaceAccessContext({ ...context, deviceId: "" }), /deviceId/);
  assert.throws(() => assertFaceAccessContext({ ...context, validUntil: undefined }), /时间戳/);
  assert.throws(
    () => assertFaceAccessContext({ ...context, validFrom: 3000, validUntil: 2000 }),
    /validFrom < validUntil/,
  );
  assert.throws(
    () => assertRevokeInput({ ...revokeBase, context: { ...context, grantId: undefined } }),
    /grantId/,
  );
});

test("展示 DTO：displayState/evidenceScope/cleanupPending 且无摘要", () => {
  const item = publicReviewItem(
    {
      _id: "c1", orgId: "org-demo", personId: "p1",
      reviewState: REVIEW_STATE.SUBMITTED, imageState: IMAGE_STATE.VERIFIED,
      cleanupPending: true, revision: 2, checksum: "a".repeat(64),
    },
    { scope: "private" },
  );
  assert.equal(item.displayState, "pending_review");
  assert.equal(item.evidenceScope, "private");
  assert.equal(item.cleanupPending, true);
  assert.equal("checksum" in item, false);

  const reviewScope = publicReviewItem({ _id: "c2", reviewState: REVIEW_STATE.DRAFT }, { scope: "review" });
  assert.equal(reviewScope.evidenceScope, "review");
  assert.equal(reviewScope.cleanupPending, false);
});

test("displayState 映射与图片三种状态", () => {
  assert.equal(displayState({ reviewState: REVIEW_STATE.DRAFT }), "draft");
  assert.equal(displayState({ reviewState: REVIEW_STATE.REJECTED }), "rejected");
  assert.equal(displayState({ reviewState: REVIEW_STATE.APPROVED, imageState: IMAGE_STATE.REJECTED }), "image_rejected");
  assert.equal(displayState({ reviewState: REVIEW_STATE.REVOKED }), "revoked");
  assert.deepEqual(Object.keys(IMAGE_STATE).sort(), ["PENDING", "REJECTED", "VERIFIED"]);
});

test("状态机：terminal_failed 是终态，不得回 queued", () => {
  assert.equal(canTransition("job", JOB_STATE.TERMINAL_FAILED, JOB_STATE.QUEUED), false);
  assert.equal(canTransition("job", JOB_STATE.RETRYABLE_FAILED, JOB_STATE.QUEUED), true);
  assert.equal(canTransition("review", REVIEW_STATE.APPROVED, "synced"), false);
  assert.throws(() => assertTransition("job", JOB_STATE.TERMINAL_FAILED, JOB_STATE.QUEUED), /非法状态迁移/);
});

test("businessAllowed 只来自 grant + 实时资格", () => {
  const grant = { credentialId: "c1", orgId: "org-demo", deviceId: "device-1", grantId: "grant-1", state: GRANT_STATE.EFFECTIVE };
  assert.equal(projectAccess({ grant, eligibility: { allowed: true } }).businessAllowed, true);
  assert.equal(projectAccess({ grant, eligibility: { allowed: false } }).businessAllowed, false);
  assert.equal(
    projectAccess({ grant: { ...grant, state: GRANT_STATE.SUSPENDED }, eligibility: { allowed: true } })
      .businessAllowed,
    false,
  );
});

test("deviceEffective：回执必须绑定 org/device/grant/job 且受信", () => {
  const grant = { credentialId: "c1", orgId: "org-demo", deviceId: "device-1", grantId: "grant-1", state: GRANT_STATE.EFFECTIVE };
  const jobs = [{ jobId: "job-1", credentialId: "c1", state: JOB_STATE.SUCCEEDED, updatedAt: 1 }];
  const evidence = {
    kind: "device_ack", trusted: true, orgId: "org-demo", deviceId: "device-1",
    grantId: "grant-1", jobId: "job-1", jobState: JOB_STATE.SUCCEEDED,
  };

  assert.equal(projectAccess({ grant, eligibility: { allowed: true }, jobs, deviceEvidence: evidence }).deviceEffective, true);
  for (const wrong of [
    { ...evidence, orgId: "org-other" },
    { ...evidence, deviceId: "device-2" },
    { ...evidence, grantId: "grant-9" },
    { ...evidence, jobId: "job-9" },
    { ...evidence, trusted: false },
    { ...evidence, kind: "mock_result" },
  ]) {
    assert.equal(
      projectAccess({ grant, eligibility: { allowed: true }, jobs, deviceEvidence: wrong }).deviceEffective,
      false,
    );
  }
});

test("冻结方法：enroll/update/revoke；queryOperation 按 jobId", async () => {
  const p = new MockFaceAccessProvider();
  assert.equal((await p.enrollFace(base)).status, "succeeded");
  assert.equal((await p.updateFace({ ...base, opId: "op-002" })).status, "succeeded");
  assert.equal((await p.revokeFace({ ...revokeBase, opId: "op-003", requestDigest: "r3" })).status, "succeeded");
  assert.equal((await p.queryOperation({ jobId: "op-001" })).state, "succeeded");
  assert.equal((await p.queryOperation({ jobId: "missing-job" })).state, "unknown");
});

test("幂等：同键同摘要重放；不同摘要 CONFLICT", async () => {
  const p = new MockFaceAccessProvider();
  assert.deepEqual(await p.enrollFace(base), await p.enrollFace(base));
  assert.equal(p.calls.length, 1);

  await p.enrollFace({ ...base, opId: "op-x" });
  await assert.rejects(
    () => p.enrollFace({ ...base, opId: "op-x", requestDigest: "sha256:other" }),
    (e) => e.code === "CONFLICT",
  );
});

test("post_send 未知：UNKNOWN_RESULT，job 停在 awaiting_result", async () => {
  const p = new MockFaceAccessProvider({ scenario: "post_send_unknown" });
  await assert.rejects(() => p.enrollFace(base), (e) => classifyProviderError(e) === "UNKNOWN_RESULT");
  assert.equal((await p.queryOperation({ jobId: "op-001" })).state, "awaiting_result");
});

test("失败分类：offline RETRYABLE、terminal TERMINAL", async () => {
  const offline = new MockFaceAccessProvider({ scenario: "device_offline" });
  await assert.rejects(() => offline.enrollFace(base), (e) => classifyProviderError(e) === "RETRYABLE");
  const terminal = new MockFaceAccessProvider({ scenario: "terminal_fail" });
  await assert.rejects(() => terminal.enrollFace(base), (e) => classifyProviderError(e) === "TERMINAL");
});

test("verifyEvent：缺签名拒绝；同 eventId 重放稳定", async () => {
  const p = new MockFaceAccessProvider();
  await assert.rejects(
    () => p.verifyEvent({ context, eventId: "e1", payload: {} }),
    (e) => e.code === "SIGNATURE_REQUIRED",
  );
  const a = await p.verifyEvent({ context, eventId: "e1", payload: {}, signature: "sig" });
  const b = await p.verifyEvent({ context, eventId: "e1", payload: {}, signature: "sig" });
  assert.deepEqual(a, b);
});

test("createFaceProvider：缺省不启用 Mock，demo/test 才允许", () => {
  assert.throws(() => createFaceProvider(), (e) => e.code === "NOT_CONFIGURED");
  assert.throws(() => createFaceProvider({ mode: "live" }), (e) => e.code === "NOT_CONFIGURED");
  assert.throws(() => createFaceProvider({ mode: "demo", provider: "real" }), (e) => e.code === "NOT_CONFIGURED");
  assert.ok(createFaceProvider({ mode: "demo" }) instanceof MockFaceAccessProvider);
});

test("路由：撤权走 device-access-grants，任务统一 device-operation-jobs", () => {
  assert.equal(FACE_ROUTES.some((r) => r.permission === "device.face.manage"), false);
  const revoke = matchFaceRoute("POST", "/api/v2/device-access-grants/grant-1/revoke");
  assert.equal(revoke.route.permission, "device.access.manage");
  assert.equal(revoke.params.grantId, "grant-1");
  assert.equal(matchFaceRoute("POST", "/api/v2/face-credentials/grant-1/revoke"), null);

  const jobs = matchFaceRoute("GET", "/api/v2/device-operation-jobs");
  assert.equal(jobs.route.permission, "device.audit.read");
  assert.equal(matchFaceRoute("GET", "/api/v2/device-jobs"), null);

  const queue = matchFaceRoute("GET", "/api/v2/face-credentials/review-queue");
  assert.equal(queue.route.permission, "device.face.review");
});
