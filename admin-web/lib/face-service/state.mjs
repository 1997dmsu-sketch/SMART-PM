/**
 * 三轴状态机与访问投影（精确契约修订 72a093a）。
 *
 * - businessAllowed：只由 grant effective + 实时资格快照决定；
 * - deviceEffective：grant + 成功 job + **绑定到组织/设备/grant/job 的受信回执**；
 * - terminal_failed 是终态：只能人工对账后创建新 job，不能原地回 queued。
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
  // 终态：不得回到 queued；重试/对账由人工创建新 job。
  [JOB_STATE.TERMINAL_FAILED]: [],
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

function evidenceBound(evidence, { grant, job }) {
  if (!evidence || evidence.kind !== "device_ack" || evidence.trusted !== true) return false;
  if (!grant || !job) return false;
  return (
    evidence.orgId === grant.orgId &&
    evidence.deviceId === grant.deviceId &&
    evidence.grantId === (grant.grantId || grant._id) &&
    evidence.jobId === (job.jobId || job._id) &&
    evidence.jobState === JOB_STATE.SUCCEEDED
  );
}

/**
 * @param {object} input
 * @param {object} input.grant       device_access_grants 记录（含 orgId/deviceId）
 * @param {object} input.eligibility 实时资格快照 {allowed:boolean, reason?}
 * @param {object[]} [input.jobs]
 * @param {object} [input.deviceEvidence] 受信回执，必须与 org/device/grant/job 绑定
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
      evidenceBound(deviceEvidence, { grant, job: latestJob }),
  );
  return {
    credentialId: grant?.credentialId,
    grantState: grant?.state ?? null,
    businessAllowed,
    deviceEffective,
    latestJob: latestJob ? { jobId: latestJob.jobId, state: latestJob.state, action: latestJob.action } : null,
    alert:
      businessAllowed &&
      (latestJob?.state === JOB_STATE.AWAITING_RESULT || latestJob?.state === JOB_STATE.TERMINAL_FAILED),
  };
}
