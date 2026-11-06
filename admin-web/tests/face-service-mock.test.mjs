import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EVIDENCE_SCOPE,
  GRANT_STATE,
  JOB_STATE,
  REVIEW_STATE,
  assertFaceAccessContext,
  assertEventInput,
  canTransition,
  projectAccess,
  publicAccessState,
  publicReviewItem,
  publicJobResult,
  matchFaceRoute,
  FACE_ROUTES,
  MockFaceAccessProvider,
  classifyProviderError,
  createFaceProvider,
} from "../lib/face-service/index.mjs";

const context = {
  actorId: "admin-1",
  actorType: "user",
  orgId: "org-demo",
  permissions: new Set(["device.face.submit"]),
  idempotencyKey: "idem-key-0000000001",
  executionMode: "test",
};

const contextOrgB = { ...context, orgId: "org-other" };
const contextUserB = { ...context, actorId: "user-2" };

const enrollInput = {
  personId: "person-001",
  deviceId: "device-1",
  grantId: "grant-1",
  sourceFileId: "file-1",
  validFrom: 1000,
  validUntil: 2000,
};

const eventInput = (over = {}) => ({
  domain: "mock.test",
  eventId: "evt-1",
  jobId: "job-1",
  deviceId: "device-1",
  version: 1,
  occurredAt: Date.now(),
  signature: "mock-sig:mock.test:evt-1:1",
  ...over,
});

test("FaceAccessContext：六字段逐项校验（permissions 必须 Set）", () => {
  assert.ok(assertFaceAccessContext(context));
  assert.throws(() => assertFaceAccessContext({ ...context, permissions: ["device.face.submit"] }), /Set/);
  assert.throws(() => assertFaceAccessContext({ ...context, actorType: "root" }), /actorType/);
  assert.throws(() => assertFaceAccessContext({ ...context, idempotencyKey: "short" }), /idempotencyKey/);
  assert.throws(() => assertFaceAccessContext({ ...context, executionMode: "prod" }), /executionMode/);
  assert.throws(() => assertFaceAccessContext({ ...context, orgId: "" }), /orgId/);
});

test("五个方法必须双参数：缺 context 直接拒绝", async () => {
  const p = new MockFaceAccessProvider();
  await assert.rejects(() => p.enrollFace(enrollInput), /context/i);
  await assert.rejects(() => p.queryOperation({ jobId: "job-1" }), /context/i);
  await assert.rejects(() => p.verifyEvent(eventInput()), /context/i);
  assert.equal((await p.enrollFace(enrollInput, context)).status, "succeeded");
});

test("enroll 业务字段：sourceFileId 必填、有效期合法", async () => {
  const p = new MockFaceAccessProvider();
  await assert.rejects(() => p.enrollFace({ ...enrollInput, sourceFileId: undefined }, context), /sourceFileId/);
  await assert.rejects(
    () => p.enrollFace({ ...enrollInput, validFrom: 3000, validUntil: 2000 }, context),
    /validFrom < validUntil/,
  );
});

test("Mock 必须同时显式 mode 与 provider", () => {
  for (const args of [undefined, {}, { mode: "demo" }, { provider: "mock" }, { mode: "live", provider: "mock" }, { mode: "demo", provider: "real" }]) {
    assert.throws(() => createFaceProvider(args), (e) => e.code === "NOT_CONFIGURED");
  }
  assert.ok(createFaceProvider({ mode: "test", provider: "mock" }) instanceof MockFaceAccessProvider);
});

test("deviceEffective：job 必须匹配 org/device/grant/credential", () => {
  const grant = { credentialId: "c1", orgId: "org-demo", deviceId: "device-1", grantId: "grant-1", state: GRANT_STATE.EFFECTIVE };
  const job = { jobId: "job-1", credentialId: "c1", orgId: "org-demo", deviceId: "device-1", grantId: "grant-1", action: "create", state: JOB_STATE.SUCCEEDED, updatedAt: 1 };
  const evidence = {
    kind: "device_ack", source: "device", trusted: true, evidenceScope: EVIDENCE_SCOPE.DEVICE_VERIFIED,
    orgId: "org-demo", deviceId: "device-1", grantId: "grant-1", jobId: "job-1", action: "create",
  };

  assert.equal(projectAccess({ grant, eligibility: { allowed: true }, jobs: [job], deviceEvidence: evidence }).deviceEffective, true);
  for (const wrong of [
    { ...job, deviceId: "device-2" },
    { ...job, grantId: "grant-2" },
    { ...job, orgId: "org-other" },
    { ...job, credentialId: "c2" },
  ]) {
    assert.equal(
      projectAccess({ grant, eligibility: { allowed: true }, jobs: [wrong], deviceEvidence: evidence }).deviceEffective,
      false,
    );
  }
});

test("伪造 trusted 回执不生效：缺 source/action/evidenceScope 均拒绝", () => {
  const grant = { credentialId: "c1", orgId: "org-demo", deviceId: "device-1", grantId: "grant-1", state: GRANT_STATE.EFFECTIVE };
  const job = { jobId: "job-1", credentialId: "c1", orgId: "org-demo", deviceId: "device-1", grantId: "grant-1", action: "create", state: JOB_STATE.SUCCEEDED, updatedAt: 1 };
  const evidence = {
    kind: "device_ack", source: "device", trusted: true, evidenceScope: EVIDENCE_SCOPE.DEVICE_VERIFIED,
    orgId: "org-demo", deviceId: "device-1", grantId: "grant-1", jobId: "job-1", action: "create",
  };
  for (const wrong of [
    { ...evidence, trusted: false },
    { ...evidence, source: "caller", kind: "mock_result" },
    { ...evidence, action: "delete" },
    { ...evidence, evidenceScope: "simulated" },
    { ...evidence, evidenceScope: "review" },
    { ...evidence, kind: "wrong_kind" },
    { ...evidence, source: "caller" },
    { ...evidence, kind: "wrong_kind", source: "device" },
  ]) {
    assert.equal(
      projectAccess({ grant, eligibility: { allowed: true }, jobs: [job], deviceEvidence: wrong }).deviceEffective,
      false,
    );
  }
});

test("evidenceScope 仅 simulated/device_verified；Q01 展示 DTO 字段齐全", () => {
  assert.deepEqual(Object.values(EVIDENCE_SCOPE).sort(), ["device_verified", "simulated"]);
  assert.equal(publicReviewItem({ reviewState: REVIEW_STATE.SUBMITTED }).evidenceScope, "simulated");
  assert.equal(
    publicReviewItem({ reviewState: REVIEW_STATE.SUBMITTED, evidenceScope: EVIDENCE_SCOPE.DEVICE_VERIFIED })
      .evidenceScope,
    "device_verified",
  );

  const dto = publicAccessState({
    grant: { state: GRANT_STATE.EFFECTIVE },
    job: { state: JOB_STATE.SUCCEEDED, evidenceScope: EVIDENCE_SCOPE.DEVICE_VERIFIED },
    cleanupPending: true,
  });
  assert.deepEqual(Object.keys(dto).sort(), ["cleanupPending", "displayState", "evidenceScope", "grantState", "jobState"]);
  assert.equal(dto.displayState, "revoking"); // cleanupPending 优先
  assert.equal(dto.cleanupPending, true);
});

test("queryOperation：按 jobId，输出不含 opId/摘要", async () => {
  const p = new MockFaceAccessProvider();
  const created = await p.enrollFace(enrollInput, context);
  const out = await p.queryOperation({ jobId: created.jobId }, context);
  assert.equal(out.jobId, created.jobId);
  assert.equal(out.state, "succeeded");
  assert.equal(out.attempts, 1);
  assert.equal("opId" in out, false);
  assert.equal(typeof out.lastSuccessAt, "number");
  assert.equal("digest" in out, false);

  const unknown = await p.queryOperation({ jobId: "job-missing" }, context);
  assert.equal(unknown.state, "unknown");
});

test("幂等：同键同摘要重放；不同摘要 CONFLICT", async () => {
  const p = new MockFaceAccessProvider();
  const a = await p.enrollFace(enrollInput, context);
  const b = await p.enrollFace(enrollInput, context);
  assert.deepEqual(a, b);
  assert.equal(p.calls.length, 1);

  await assert.rejects(
    () => p.enrollFace({ ...enrollInput, sourceFileId: "file-2" }, context),
    (e) => e.code === "CONFLICT",
  );
});

test("幂等作用域：不同组织/不同 actor 撞键也不重放", async () => {
  const p = new MockFaceAccessProvider();
  const a = await p.enrollFace(enrollInput, context);
  const b = await p.enrollFace(enrollInput, contextOrgB);
  const c = await p.enrollFace(enrollInput, contextUserB);
  assert.notEqual(a.jobId, b.jobId);
  assert.notEqual(a.jobId, c.jobId);
  assert.equal(p.calls.length, 3);
  // 同组织+同 actor+同键才重放
  assert.deepEqual(await p.enrollFace(enrollInput, context), a);
});

test("job 保存组织/设备绑定，动作名为 enroll/update/revoke", async () => {
  const p = new MockFaceAccessProvider();
  const created = await p.enrollFace(enrollInput, context);
  const job = p.jobs.get(created.jobId);
  assert.equal(job.action, "enroll");
  assert.equal(job.orgId, "org-demo");
  assert.equal(job.deviceId, "device-1");
  const upd = await p.updateFace({ credentialId: "c1", sourceFileId: "file-2" }, context);
  assert.equal(p.jobs.get(upd.jobId).action, "update");
  const rev = await p.revokeFace({ grantId: "grant-1", credentialId: "c1" }, context);
  assert.equal(p.jobs.get(rev.jobId).action, "revoke");
});

test("post_send 未知：UNKNOWN_RESULT，job 停 awaiting_result", async () => {
  const p = new MockFaceAccessProvider({ scenario: "post_send_unknown" });
  await assert.rejects(() => p.enrollFace(enrollInput, context), (e) => classifyProviderError(e) === "UNKNOWN_RESULT");
  const job = await p.queryOperation({ jobId: "job-1" }, context);
  assert.equal(job.state, "awaiting_result");
});

test("terminal 失败：TERMINAL，job 终态且不可取消", async () => {
  const p = new MockFaceAccessProvider({ scenario: "terminal_fail" });
  await assert.rejects(() => p.enrollFace(enrollInput, context), (e) => classifyProviderError(e) === "TERMINAL");
  assert.equal((await p.queryOperation({ jobId: "job-1" }, context)).state, "terminal_failed");
  assert.equal(canTransition("job", JOB_STATE.TERMINAL_FAILED, JOB_STATE.QUEUED), false);
});

test("sending 不可直接取消：只能进入 awaiting_result/结果态", () => {
  assert.equal(canTransition("job", JOB_STATE.SENDING, JOB_STATE.CANCELLED), false);
  assert.equal(canTransition("job", JOB_STATE.SENDING, JOB_STATE.AWAITING_RESULT), true);
  assert.equal(canTransition("job", JOB_STATE.QUEUED, JOB_STATE.CANCELLED), true);
});

test("事件：固定域/版本/时间窗/签名校验，缺一拒绝", () => {
  assert.throws(() => assertEventInput(eventInput({ domain: "prod" })), /mock\.test/);
  assert.throws(() => assertEventInput(eventInput({ version: 0 })), /version/);
  assert.throws(() => assertEventInput(eventInput({ occurredAt: Date.now() - 10 * 60 * 1000 })), /时间窗/);
  assert.throws(() => assertEventInput(eventInput({ signature: "bad" })), /签名/);
  assert.ok(assertEventInput(eventInput()));
});

test("事件：同 ID 同摘要重放，同 ID 异摘要 CONFLICT，不回显 payload", async () => {
  const p = new MockFaceAccessProvider();
  await p.enrollFace(enrollInput, context); // 生成 job-1，供事件匹配
  const a = await p.verifyEvent(eventInput({ payload: "secret" }), context);
  const b = await p.verifyEvent(eventInput({ payload: "secret" }), context);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a).includes("secret"), false);
  assert.deepEqual(Object.keys(a).sort(), ["action", "matchedJobId"]);

  await assert.rejects(
    () => p.verifyEvent(eventInput({ version: 2, signature: "mock-sig:mock.test:evt-1:2", occurredAt: Date.now() }), context),
    (e) => e.code === "CONFLICT",
  );
});

test("事件必须匹配同组织/同设备 job；低版本冲突", async () => {
  const p = new MockFaceAccessProvider();
  const created = await p.enrollFace(enrollInput, context);

  // 设备不符 → rejected
  const wrongDevice = await p.verifyEvent(
    eventInput({ eventId: "evt-wrong", jobId: created.jobId, deviceId: "device-2", signature: "mock-sig:mock.test:evt-wrong:1" }),
    context,
  );
  assert.deepEqual(wrongDevice, { rejected: true, reasonCode: "SCOPE_MISMATCH" });
  assert.equal("matchedJobId" in wrongDevice, false);

  // 正确设备 → matched
  const matched = await p.verifyEvent(eventInput({ jobId: created.jobId, occurredAt: Date.now() }), context);
  assert.equal(matched.action, "enroll");

  // 先受理版本2，再来版本1 → CONFLICT
  const v2 = eventInput({ eventId: "evt-2", jobId: created.jobId, version: 2, signature: "mock-sig:mock.test:evt-2:2" });
  await p.verifyEvent(v2, context);
  await assert.rejects(
    () => p.verifyEvent({ ...v2, version: 1, signature: "mock-sig:mock.test:evt-2:1" }, context),
    (e) => e.code === "CONFLICT",
  );
});

test("事件版本按 org+device+job 严格递增：不同 eventId 的 2→1 乱序被拒", async () => {
  const p = new MockFaceAccessProvider();
  const created = await p.enrollFace(enrollInput, context);

  const v2 = eventInput({ eventId: "e2", jobId: created.jobId, version: 2, signature: "mock-sig:mock.test:e2:2" });
  assert.equal((await p.verifyEvent(v2, context)).action, "enroll");

  const v1 = eventInput({ eventId: "e1", jobId: created.jobId, version: 1, signature: "mock-sig:mock.test:e1:1" });
  await assert.rejects(() => p.verifyEvent(v1, context), (e) => e.code === "CONFLICT");
});

test("未知 job 的事件只返回 rejected + reasonCode，不含 matchedJobId", async () => {
  const p = new MockFaceAccessProvider();
  const out = await p.verifyEvent(eventInput({ jobId: "job-missing" }), context);
  assert.deepEqual(out, { rejected: true, reasonCode: "JOB_NOT_FOUND" });
  assert.equal("matchedJobId" in out, false);
});

test("展示状态：simulated 不得显示 active；cleanupPending 优先 revoking", () => {
  const activeSim = publicAccessState({
    grant: { state: GRANT_STATE.EFFECTIVE },
    job: { state: JOB_STATE.SUCCEEDED, evidenceScope: EVIDENCE_SCOPE.SIMULATED },
  });
  assert.equal(activeSim.displayState, "simulated");
  assert.notEqual(activeSim.displayState, "active");

  const cleanup = publicAccessState({
    grant: { state: GRANT_STATE.EFFECTIVE },
    job: { state: JOB_STATE.SUCCEEDED, evidenceScope: EVIDENCE_SCOPE.DEVICE_VERIFIED },
    cleanupPending: true,
  });
  assert.equal(cleanup.displayState, "revoking");
});

test("updateFace：拒绝未知字段与空变更", async () => {
  const p = new MockFaceAccessProvider();
  await assert.rejects(
    () => p.updateFace({ credentialId: "c1", unexpected: "x" }, context),
    /不允许字段/,
  );
  await assert.rejects(() => p.updateFace({ credentialId: "c1" }, context), /必须提供/);
  assert.equal((await p.updateFace({ credentialId: "c1", validUntil: 3000 }, context)).status, "succeeded");
});

test("live：Provider 调用与事件一律 NOT_CONFIGURED", async () => {
  const live = { ...context, executionMode: "live" };
  const p = new MockFaceAccessProvider();
  await assert.rejects(() => p.enrollFace(enrollInput, live), (e) => e.code === "NOT_CONFIGURED");
  await assert.rejects(() => p.verifyEvent(eventInput(), live), (e) => e.code === "NOT_CONFIGURED");
});

test("路由：权限与路径保持冻结命名", () => {
  assert.equal(FACE_ROUTES.some((r) => r.permission === "device.face.manage"), false);
  assert.equal(matchFaceRoute("POST", "/api/v2/device-access-grants/grant-1/revoke").params.grantId, "grant-1");
  assert.equal(matchFaceRoute("GET", "/api/v2/device-operation-jobs").route.permission, "device.audit.read");
  assert.equal(matchFaceRoute("GET", "/api/v2/device-jobs"), null);
});
