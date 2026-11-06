/**
 * 三轴状态机与访问投影（契约修订版 f044a04）。
 *
 * 关键约束：
 * - 凭证审核、图片质量、设备授权是三套独立状态，禁止互相写入；
 * - businessAllowed 只由 grant 状态 + 实时资格快照决定；
 * - deviceEffective 只由 grant + 成功 job + 受信设备证据投影；
 *   Mock 永远不能产生真实设备生效结论。
 */
import { GRANT_STATE, IMAGE_STATE, JOB_STATE, REVIEW_STATE } from "./dto.mjs";

const REVIEW_TRANSITIONS = {
  [REVIEW_STATE.DRAFT]: [REVIEW_STATE.SUBMITTED],
  [REVIEW_STATE.SUBMITTED]: [REVIEW_STATE.APPROVED, REVIEW_STATE.REJECTED],
  [REVIEW_STATE.APPROVED]: [REVIEW_STATE.REVOKED],
  [REVIEW_STATE.REJECTED]: [REVIEW_STATE.DRAFT],
  [REVIEW_STATE.REVOKED]: [],
};

const GRANT_TRANSITIONS = {
  [GRANT_STATE.PENDING]: [GRANT_STATE.EFFECTIVE, GRANT_STATE.REVOKED],
  [GRANT_STATE.EFFECTIVE]: [GRANT_STATE.SUSPENDED, GRANT_STATE.REVOKED, GRANT_STATE.EXPIRED],
  [GRANT_STATE.SUSPENDED]: [GRANT_STATE.EFFECTIVE, GRANT_STATE.REVOKED, GRANT_STATE.EXPIRED],
  [GRANT_STATE.REVOKED]: [],
  [GRANT_STATE.EXPIRED]: [],
};

const JOB_TRANSITIONS = {
  [JOB_STATE.QUEUED]: [JOB_STATE.SENDING, JOB_STATE.CANCELLED],
  [JOB_STATE.SENDING]: [
    JOB_STATE.AWAITING_RESULT,
    JOB_STATE.SUCCEEDED,
    JOB_STATE.RETRYABLE_FAILED,
    JOB_STATE.TERMINAL_FAILED,
    JOB_STATE.CANCELLED,
  ],
  [JOB_STATE.AWAITING_RESULT]: [JOB_STATE.SUCCEEDED, JOB_STATE.RETRYABLE_FAILED, JOB_STATE.TERMINAL_FAILED],
  [JOB_STATE.RETRYABLE_FAILED]: [JOB_STATE.QUEUED, JOB_STATE.CANCELLED],
  [JOB_STATE.SUCCEEDED]: [],
  [JOB_STATE.TERMINAL_FAILED]: [JOB_STATE.QUEUED], // 仅人工对账后重排
  [JOB_STATE.CANCELLED]: [],
};

const TABLES = {
  review: REVIEW_TRANSITIONS,
  grant: GRANT_TRANSITIONS,
  job: JOB_TRANSITIONS,
  image: {
    [IMAGE_STATE.PENDING]: [IMAGE_STATE.VERIFIED, IMAGE_STATE.REJECTED],
    [IMAGE_STATE.VERIFIED]: [],
    [IMAGE_STATE.REJECTED]: [],
  },
};

export function canTransition(axis, from, to) {
  return (TABLES[axis]?.[from] || []).includes(to);
}

export function assertTransition(axis, from, to) {
  if (!canTransition(axis, from, to)) {
    const error = new Error(`非法状态迁移（${axis}）：${from} → ${to}`);
    error.code = "INVALID_TRANSITION";
    throw error;
  }
}

/**
 * @param {object} input
 * @param {object} input.grant       device_access_grants 记录
 * @param {object} input.eligibility 实时资格快照：实名、入住、名单、房间/组织状态
 * @param {object[]} [input.jobs]
 * @param {object} [input.deviceEvidence] 受信设备回执 {kind:"device_ack", trusted:true}
 */
export function projectAccess({ grant, eligibility, jobs = [], deviceEvidence = null }) {
  const grantEffective = grant?.state === GRANT_STATE.EFFECTIVE;
  const businessAllowed = Boolean(grantEffective && eligibility?.allowed === true);
  const latestJob = jobs
    .filter((job) => job.credentialId === grant?.credentialId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  const deviceEffective = Boolean(
    businessAllowed &&
      latestJob?.state === JOB_STATE.SUCCEEDED &&
      deviceEvidence?.kind === "device_ack" &&
      deviceEvidence?.trusted === true,
  );
  return {
    credentialId: grant?.credentialId,
    grantState: grant?.state ?? null,
    businessAllowed,
    deviceEffective,
    latestJob: latestJob ? { state: latestJob.state, action: latestJob.action } : null,
    alert:
      businessAllowed &&
      (latestJob?.state === JOB_STATE.AWAITING_RESULT || latestJob?.state === JOB_STATE.TERMINAL_FAILED),
  };
}
