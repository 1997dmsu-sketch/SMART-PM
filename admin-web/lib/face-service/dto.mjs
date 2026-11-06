/**
 * HK-AI-04 DTO（精确契约 cc569a8）。
 *
 * 冻结 FaceAccessContext（六个字段，逐字段校验）：
 *   actorId / actorType(user|system|agent) / orgId / permissions:Set<string>
 *   / idempotencyKey(16–128 [A-Za-z0-9._:-]) / executionMode(demo|test|live)
 *
 * Provider 方法一律双参数：method(input, context)。
 * 业务字段归 input；opId/requestDigest 由服务端派生，不接受客户端自由输入。
 */

export const ACTOR_TYPES = Object.freeze(["user", "system", "agent"]);
export const EXECUTION_MODES = Object.freeze(["demo", "test", "live"]);

export const EVIDENCE_SCOPE = Object.freeze({
  SIMULATED: "simulated",
  DEVICE_VERIFIED: "device_verified",
});

export const REVIEW_STATE = Object.freeze({
  DRAFT: "draft",
  SUBMITTED: "submitted",
  APPROVED: "approved",
  REJECTED: "rejected",
  REVOKED: "revoked",
});

export const IMAGE_STATE = Object.freeze({
  PENDING: "pending",
  VERIFIED: "verified",
  REJECTED: "rejected",
});

export const GRANT_STATE = Object.freeze({
  PENDING: "pending",
  EFFECTIVE: "effective",
  SUSPENDED: "suspended",
  REVOKED: "revoked",
  EXPIRED: "expired",
});

export const JOB_STATE = Object.freeze({
  QUEUED: "queued",
  SENDING: "sending",
  AWAITING_RESULT: "awaiting_result",
  SUCCEEDED: "succeeded",
  RETRYABLE_FAILED: "retryable_failed",
  TERMINAL_FAILED: "terminal_failed",
  CANCELLED: "cancelled",
});

export const PROVIDER_ERROR_KIND = Object.freeze({
  RETRYABLE: "RETRYABLE",
  TERMINAL: "TERMINAL",
  UNKNOWN_RESULT: "UNKNOWN_RESULT",
  NOT_CONFIGURED: "NOT_CONFIGURED",
});

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;

export function assertOpaqueId(value, field) {
  if (typeof value !== "string" || !OPAQUE_ID.test(value)) {
    throw dtoError(`${field} 必须是 1–128 位有界不透明 ID`);
  }
  return value;
}

export function assertFaceAccessContext(context) {
  const { actorId, actorType, orgId, permissions, idempotencyKey, executionMode } = context || {};
  assertOpaqueId(actorId, "context.actorId");
  if (!ACTOR_TYPES.includes(actorType)) {
    throw dtoError("context.actorType 必须是 user/system/agent");
  }
  assertOpaqueId(orgId, "context.orgId");
  if (!(permissions instanceof Set)) {
    throw dtoError("context.permissions 必须是 Set<string>");
  }
  for (const permission of permissions) {
    if (typeof permission !== "string" || !permission) {
      throw dtoError("context.permissions 只能包含非空字符串");
    }
  }
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw dtoError("context.idempotencyKey 必须是 16–128 位 [A-Za-z0-9._:-]");
  }
  if (!EXECUTION_MODES.includes(executionMode)) {
    throw dtoError("context.executionMode 必须是 demo/test/live");
  }
  return { actorId, actorType, orgId, permissions, idempotencyKey, executionMode };
}

export function assertEnrollInput(input) {
  const { personId, deviceId, grantId, sourceFileId, validFrom, validUntil } = input || {};
  assertOpaqueId(personId, "personId");
  assertOpaqueId(deviceId, "deviceId");
  assertOpaqueId(grantId, "grantId");
  assertOpaqueId(sourceFileId, "sourceFileId");
  if (!Number.isFinite(validFrom) || !Number.isFinite(validUntil)) {
    throw dtoError("validFrom/validUntil 必须是毫秒时间戳");
  }
  if (validFrom >= validUntil) throw dtoError("有效期必须 validFrom < validUntil");
  return { personId, deviceId, grantId, sourceFileId, validFrom, validUntil };
}

const CREATE_GRANT_FIELDS = new Set([
  "credentialId", "expectedCredentialRevision", "deviceId", "occupancyId",
  "cycleId", "identityApplicationId", "validFrom", "validUntil",
]);

/** 提交只绑定人员与人脸来源；不得携带设备/授权字段。 */
export function assertSubmitInput(input) {
  const allowed = new Set(["personId", "sourceFileId"]);
  for (const key of Object.keys(input || {})) {
    if (!allowed.has(key)) throw dtoError(`submit 不允许字段 ${key}`);
  }
  assertOpaqueId(input?.personId, "personId");
  assertOpaqueId(input?.sourceFileId, "sourceFileId");
  return { personId: input.personId, sourceFileId: input.sourceFileId };
}

/** 授权输入冻结：设备、周期与有效期由 createGrant 显式提供。 */
export function assertCreateGrantInput(input) {
  for (const key of Object.keys(input || {})) {
    if (!CREATE_GRANT_FIELDS.has(key)) throw dtoError(`createGrant 不允许字段 ${key}`);
  }
  const {
    credentialId, expectedCredentialRevision, deviceId, occupancyId,
    cycleId, identityApplicationId, validFrom, validUntil,
  } = input || {};
  for (const [field, value] of Object.entries({ credentialId, deviceId, occupancyId, cycleId, identityApplicationId })) {
    assertOpaqueId(value, field);
  }
  if (!Number.isInteger(expectedCredentialRevision) || expectedCredentialRevision < 1) {
    throw dtoError("expectedCredentialRevision 必须是 ≥1 的整数");
  }
  if (!Number.isFinite(validFrom) || !Number.isFinite(validUntil) || validFrom >= validUntil) {
    throw dtoError("validFrom/validUntil 必须是合法时间区间");
  }
  return {
    credentialId, expectedCredentialRevision, deviceId, occupancyId,
    cycleId, identityApplicationId, validFrom, validUntil,
  };
}

export function assertUpdateInput(input) {
  const allowed = new Set(["credentialId", "sourceFileId", "validUntil"]);
  for (const key of Object.keys(input || {})) {
    if (!allowed.has(key)) throw dtoError(`update 不允许字段 ${key}`);
  }
  const { credentialId, sourceFileId, validUntil } = input || {};
  assertOpaqueId(credentialId, "credentialId");
  if (sourceFileId === undefined && validUntil === undefined) {
    throw dtoError("update 必须提供新凭证版本或收紧 validUntil");
  }
  if (sourceFileId !== undefined) assertOpaqueId(sourceFileId, "sourceFileId");
  if (validUntil !== undefined && !Number.isFinite(validUntil)) {
    throw dtoError("validUntil 必须是毫秒时间戳");
  }
  return {
    credentialId,
    ...(sourceFileId !== undefined ? { sourceFileId } : {}),
    ...(validUntil !== undefined ? { validUntil } : {}),
  };
}

export function assertRevokeInput(input) {
  const { grantId, credentialId } = input || {};
  assertOpaqueId(grantId, "grantId");
  assertOpaqueId(credentialId, "credentialId");
  return { grantId, credentialId };
}

export function assertQueryInput(input) {
  const { jobId } = input || {};
  assertOpaqueId(jobId, "jobId");
  return { jobId };
}

/** 最小合成事件：固定测试域、目标 job/device、递增版本、时间窗、Mock 签名。 */
export function assertEventInput(input, { now = Date.now(), windowMs = 5 * 60 * 1000 } = {}) {
  const { domain, eventId, jobId, deviceId, version, occurredAt, signature } = input || {};
  if (domain !== "mock.test") throw dtoError("事件必须来自固定测试域 mock.test");
  assertOpaqueId(eventId, "eventId");
  assertOpaqueId(jobId, "jobId");
  assertOpaqueId(deviceId, "deviceId");
  if (!Number.isInteger(version) || version < 1) throw dtoError("version 必须是递增正整数");
  if (!Number.isFinite(occurredAt) || Math.abs(now - occurredAt) > windowMs) {
    throw dtoError("occurredAt 超出允许时间窗");
  }
  if (typeof signature !== "string" || signature !== `mock-sig:${domain}:${eventId}:${version}`) {
    throw dtoError("Mock 事件签名无效");
  }
  return { domain, eventId, jobId, deviceId, version, occurredAt, signature };
}

export function displayState(record) {
  if (!record) return null;
  if (record.reviewState === REVIEW_STATE.REVOKED) return "revoked";
  if (record.reviewState === REVIEW_STATE.REJECTED) return "rejected";
  if (record.imageState === IMAGE_STATE.REJECTED) return "image_rejected";
  if (record.reviewState === REVIEW_STATE.APPROVED) return "approved";
  if (record.reviewState === REVIEW_STATE.SUBMITTED) return "pending_review";
  return "draft";
}

/** Q01 展示 DTO：grant/job 投影；evidenceScope 只允许 simulated/device_verified。 */
export function publicAccessState({ grant, job, cleanupPending = false } = {}) {
  const grantState = grant?.state ?? null;
  const jobState = job?.state ?? null;
  const evidenceScope =
    job?.evidenceScope === EVIDENCE_SCOPE.DEVICE_VERIFIED
      ? EVIDENCE_SCOPE.DEVICE_VERIFIED
      : EVIDENCE_SCOPE.SIMULATED;

  // cleanupPending 或撤权未终态时 revoking 优先；只有 device_verified 才显示 active。
  let state = "draft";
  if (cleanupPending === true) state = "revoking";
  else if (grantState === GRANT_STATE.REVOKED || grantState === GRANT_STATE.EXPIRED) state = "revoked";
  else if (jobState === JOB_STATE.TERMINAL_FAILED) state = "failed";
  else if (jobState === JOB_STATE.AWAITING_RESULT) state = "awaiting_result";
  else if (grantState === GRANT_STATE.EFFECTIVE && jobState === JOB_STATE.SUCCEEDED) {
    state = evidenceScope === EVIDENCE_SCOPE.DEVICE_VERIFIED ? "active" : "simulated";
  } else if (grantState === GRANT_STATE.EFFECTIVE) state = "pending_sync";

  return {
    grantState,
    jobState,
    displayState: state,
    evidenceScope,
    cleanupPending: cleanupPending === true,
  };
}

export function publicReviewItem(record) {
  if (!record) return null;
  return {
    credentialId: record._id || record.credentialId,
    orgId: record.orgId,
    personId: record.personId,
    reviewState: record.reviewState,
    imageState: record.imageState,
    displayState: displayState(record),
    evidenceScope: record.evidenceScope === EVIDENCE_SCOPE.DEVICE_VERIFIED
      ? EVIDENCE_SCOPE.DEVICE_VERIFIED
      : EVIDENCE_SCOPE.SIMULATED,
    cleanupPending: record.cleanupPending === true,
    submittedAt: record.submittedAt,
    revision: record.revision,
  };
}

/** 任务查询输出：不含 opId、摘要。 */
export function publicJobResult(job) {
  if (!job) return null;
  return {
    jobId: job.jobId || job._id,
    state: job.state,
    attempts: job.attempts ?? 0,
    lastSuccessAt: job.lastSuccessAt ?? null,
    failureReason: job.failureReason ? String(job.failureReason).slice(0, 120) : null,
  };
}

export function dtoError(message) {
  const error = new Error(message);
  error.code = "PARAM_ERROR";
  return error;
}
