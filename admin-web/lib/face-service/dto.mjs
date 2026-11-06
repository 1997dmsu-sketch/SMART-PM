/**
 * HK-AI-04 DTO 与状态枚举（契约修订版 f044a04）。
 *
 * 三条轴严格分离：
 *   1. 凭证审核 reviewState：draft/submitted/approved/rejected/revoked
 *   2. 图片质量 imageState：pending/verified/rejected（独立于审核）
 *   3. 授权 grant：pending/effective/suspended/revoked/expired
 *   4. 任务 job：queued/sending/awaiting_result/succeeded/retryable_failed/
 *      terminal_failed/cancelled
 * 授权是否有效由 grant + 实时资格快照决定，不由凭证状态决定。
 */

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

/** Provider 失败对外分类（冻结）：不得新增公共错误码。 */
export const PROVIDER_ERROR_KIND = Object.freeze({
  RETRYABLE: "RETRYABLE",
  TERMINAL: "TERMINAL",
  UNKNOWN_RESULT: "UNKNOWN_RESULT",
  NOT_CONFIGURED: "NOT_CONFIGURED",
});

// personId 为项目既有“有界不透明 ID”，不强制 UUID。
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function assertOpaqueId(value, field) {
  if (typeof value !== "string" || !OPAQUE_ID.test(value)) {
    throw dtoError(`${field} 必须是 1–128 位有界不透明 ID`);
  }
  return value;
}

export function assertFaceCredentialInput(input) {
  const { orgId, personId, faceFileId, opId, requestDigest } = input || {};
  if (!orgId) throw dtoError("orgId 必填");
  assertOpaqueId(personId, "personId");
  assertOpaqueId(faceFileId, "faceFileId");
  assertOpaqueId(opId, "opId");
  if (!requestDigest) throw dtoError("requestDigest 必填");
  return { orgId, personId, faceFileId, opId, requestDigest };
}

export function assertRevokeInput(input) {
  const { orgId, personId, opId, requestDigest } = input || {};
  if (!orgId) throw dtoError("orgId 必填");
  assertOpaqueId(personId, "personId");
  assertOpaqueId(opId, "opId");
  if (!requestDigest) throw dtoError("requestDigest 必填");
  return { orgId, personId, opId, requestDigest };
}

/** 审核队列最小投影：审核员（device.face.review）可见，不含图片、摘要与私密字段。 */
export function publicReviewItem(record) {
  if (!record) return null;
  return {
    credentialId: record._id || record.credentialId,
    orgId: record.orgId,
    personId: record.personId,
    reviewState: record.reviewState,
    imageState: record.imageState,
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
    action: job.action,
    state: job.state,
    attempts: job.attempts,
    updatedAt: job.updatedAt,
  };
}

export function dtoError(message) {
  const error = new Error(message);
  error.code = "PARAM_ERROR";
  return error;
}
