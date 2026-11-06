/**
 * 人脸凭证 / 设备任务状态机与只读投影（Mock 骨架）。
 *
 * 约束（任务卡）：
 * - 发送后断连、解析失败、未知错误 → UNKNOWN_RESULT，禁止自动重发新增/删除；
 * - 撤权失败保持业务授权失效并持续告警；
 * - Mock 成功不得标记真实设备已生效（effective 仅在真实 provider 回执后为 true）。
 */
import { CREDENTIAL_STATUS, JOB_STATUS } from "./dto.mjs";

const TRANSITIONS = Object.freeze({
  [CREDENTIAL_STATUS.DRAFT]: [CREDENTIAL_STATUS.SUBMITTED],
  [CREDENTIAL_STATUS.SUBMITTED]: [CREDENTIAL_STATUS.REVIEWING, CREDENTIAL_STATUS.REJECTED],
  [CREDENTIAL_STATUS.REVIEWING]: [CREDENTIAL_STATUS.APPROVED, CREDENTIAL_STATUS.REJECTED],
  [CREDENTIAL_STATUS.APPROVED]: [CREDENTIAL_STATUS.SYNC_PENDING, CREDENTIAL_STATUS.REVOKED],
  [CREDENTIAL_STATUS.SYNC_PENDING]: [CREDENTIAL_STATUS.SYNCED, CREDENTIAL_STATUS.SYNC_FAILED],
  [CREDENTIAL_STATUS.SYNC_FAILED]: [CREDENTIAL_STATUS.SYNC_PENDING],
  [CREDENTIAL_STATUS.SYNCED]: [CREDENTIAL_STATUS.REVOKED],
  [CREDENTIAL_STATUS.REJECTED]: [],
  [CREDENTIAL_STATUS.REVOKED]: [],
});

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const error = new Error(`非法状态迁移：${from} → ${to}`);
    error.code = "INVALID_TRANSITION";
    throw error;
  }
}

/**
 * 投影：业务侧“是否应有权通行”与“设备是否已生效”分开。
 * - businessAllowed：业务授权是否有效（退租/撤销立即变 false）；
 * - deviceEffective：真实设备回执后才可能为 true；Mock 恒为 false。
 */
export function projectCredential(record, { jobs = [], providerKind = "mock" } = {}) {
  const latest = jobs
    .filter((job) => job.credentialId === (record._id || record.credentialId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  const businessAllowed =
    record.status === CREDENTIAL_STATUS.APPROVED ||
    record.status === CREDENTIAL_STATUS.SYNC_PENDING ||
    record.status === CREDENTIAL_STATUS.SYNCED;
  const deviceEffective =
    providerKind === "real" &&
    record.status === CREDENTIAL_STATUS.SYNCED &&
    latest?.status === JOB_STATUS.SUCCEEDED;
  return {
    credentialId: record._id || record.credentialId,
    status: record.status,
    businessAllowed,
    deviceEffective,
    latestJob: latest ? { status: latest.status, action: latest.action, at: latest.updatedAt } : null,
    alert: record.status === CREDENTIAL_STATUS.SYNC_FAILED,
  };
}
