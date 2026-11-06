/**
 * HK-AI-04 DTO 与状态枚举（精确契约修订 72a093a）。
 *
 * 四轴状态互不串写；Provider 方法使用冻结的 FaceAccessContext：
 *   { orgId, deviceId, grantId?, validFrom, validUntil }
 */

export const REVIEW_STATE = Object.freeze({
  DRAFT: "draft",
  SUBMITTED: "submitted",
  APPROVED: "approved",
  REJECTED: "rejected",
  REVOKED: "revoked",
});

// 仅此三种；不新增 uploaded / quality_failed。
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

export function assertOpaqueId(value, field) {
  if (typeof value !== "string" || !OPAQUE_ID.test(value)) {
    throw dtoError(`${field} 必须是 1–128 位有界不透明 ID`);
  }
  return value;
}

/** 冻结的访问上下文。validFrom/validUntil 为毫秒时间戳，左闭右开。 */
export function assertFaceAccessContext(context) {
  const { orgId, deviceId, grantId, validFrom, validUntil } = context || {};
  assertOpaqueId(orgId, "context.orgId");
  assertOpaqueId(deviceId, "context.deviceId");
  if (grantId !== undefined) assertOpaqueId(grantId, "context.grantId");
  if (!Number.isFinite(validFrom) || !Number.isFinite(validUntil)) {
    throw dtoError("context.validFrom/validUntil 必须是毫秒时间戳");
  }
  if (validFrom >= validUntil) throw dtoError("context 有效期必须 validFrom < validUntil");
  return { orgId, deviceId, grantId, validFrom, validUntil };
}

export function assertFaceCredentialInput(input) {
  const { context, personId, faceFileId, opId, requestDigest } = input || {};
  const ctx = assertFaceAccessContext(context);
  assertOpaqueId(personId, "personId");
  assertOpaqueId(faceFileId, "faceFileId");
  assertOpaqueId(opId, "opId");
  if (!requestDigest) throw dtoError("requestDigest 必填");
  return { context: ctx, personId, faceFileId, opId, requestDigest };
}

export function assertRevokeInput(input) {
  const { context, personId, opId, requestDigest } = input || {};
  const ctx = assertFaceAccessContext(context);
  if (!ctx.grantId) throw dtoError("撤权必须提供 context.grantId");
  assertOpaqueId(personId, "personId");
  assertOpaqueId(opId, "opId");
  if (!requestDigest) throw dtoError("requestDigest 必填");
  return { context: ctx, personId, opId, requestDigest };
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

/**
 * 展示 DTO：审核队列用 scope="review"（最小姐），
 * 私密详情用 scope="private"（需 device.face.readPrivate）。
 * 两者都不含图片字节与摘要。
 */
export function publicReviewItem(record, { scope = "review" } = {}) {
  if (!record) return null;
  if (!["review", "private"].includes(scope)) throw dtoError("scope 仅支持 review/private");
  return {
    credentialId: record._id || record.credentialId,
    orgId: record.orgId,
    personId: record.personId,
    reviewState: record.reviewState,
    imageState: record.imageState,
    displayState: displayState(record),
    evidenceScope: scope,
    cleanupPending: record.cleanupPending === true,
    submittedAt: record.submittedAt,
    revision: record.revision,
  };
}

export function publicJob(job) {
  if (!job) return null;
  return {
    jobId: job._id || job.jobId,
    credentialId: job.credentialId,
    deviceId: job.deviceId,
    grantId: job.grantId,
    action: job.action,
    state: job.state,
    displayState: job.state,
    attempts: job.attempts,
    updatedAt: job.updatedAt,
  };
}

export function dtoError(message) {
  const error = new Error(message);
  error.code = "PARAM_ERROR";
  return error;
}
