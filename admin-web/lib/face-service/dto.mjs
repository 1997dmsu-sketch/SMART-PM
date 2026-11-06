/**
 * HK-AI-04 DTO 与校验（Mock 骨架）。
 *
 * 说明：本文件只定义服务层输入/输出的稳定形状与校验，不访问数据库、
 * 不依赖厂商字段。正式集合字段以实现与 Codex 对齐后的 LOCK-01A 契约为准。
 */

export const CREDENTIAL_STATUS = Object.freeze({
  DRAFT: "draft",
  SUBMITTED: "submitted",
  REVIEWING: "reviewing",
  APPROVED: "approved",
  REJECTED: "rejected",
  SYNC_PENDING: "sync_pending",
  SYNCED: "synced",
  SYNC_FAILED: "sync_failed",
  REVOKED: "revoked",
});

export const JOB_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  UNKNOWN_RESULT: "unknown_result",
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertFaceCredentialInput(input) {
  const { personId, faceFileId, orgId } = input || {};
  if (!orgId) throw dtoError("orgId 必填");
  if (!personId || !UUID.test(personId)) throw dtoError("personId 必须是稳定 UUID");
  if (!faceFileId) throw dtoError("faceFileId 必填");
  return { orgId, personId, faceFileId };
}

export function assertJobInput(input) {
  const { orgId, credentialId, deviceId, action } = input || {};
  if (!orgId) throw dtoError("orgId 必填");
  if (!credentialId) throw dtoError("credentialId 必填");
  if (!deviceId) throw dtoError("deviceId 必填");
  if (!["create", "delete"].includes(action)) throw dtoError("action 仅支持 create/delete");
  return { orgId, credentialId, deviceId, action };
}

/** 审核响应/列表只暴露必要字段：不含图片字节、不含摘要。 */
export function publicCredential(record) {
  if (!record) return null;
  const { checksum, faceImage, bytes, ...rest } = record;
  return {
    credentialId: rest._id || rest.credentialId,
    orgId: rest.orgId,
    personId: rest.personId,
    status: rest.status,
    revision: rest.revision,
    updatedAt: rest.updatedAt,
  };
}

export function dtoError(message) {
  const error = new Error(message);
  error.code = "PARAM_ERROR";
  return error;
}
