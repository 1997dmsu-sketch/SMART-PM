/**
 * 四轴状态机与访问投影（精确契约 cc569a8）。
 *
 * - businessAllowed：grant effective + 实时资格；
 * - deviceEffective：job 必须同时匹配 orgId/deviceId/grantId/credentialId，
 *   且 evidence 绑定同一 job、action 一致、source 受信、evidenceScope=device_verified；
 * - sending 不得直接取消：结果不明只能进入 awaiting_result。
 */
import { EVIDENCE_SCOPE, GRANT_STATE, IMAGE_STATE, JOB_STATE, REVIEW_STATE } from "./dto.mjs";

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
  ],
  [JOB_STATE.AWAITING_RESULT]: [JOB_STATE.SUCCEEDED, JOB_STATE.RETRYABLE_FAILED, JOB_STATE.TERMINAL_FAILED],
  [JOB_STATE.RETRYABLE_FAILED]: [JOB_STATE.QUEUED, JOB_STATE.CANCELLED],
  [JOB_STATE.SUCCEEDED]: [],
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

function evidenceVerified({ grant, job, evidence }) {
  if (!evidence || evidence.trusted !== true) return false;
  if (evidence.source !== "device" && evidence.kind !== "device_ack") return false;
  if (evidence.evidenceScope !== EVIDENCE_SCOPE.DEVICE_VERIFIED) return false;
  if (!job || job.state !== JOB_STATE.SUCCEEDED) return false;
  return (
    evidence.orgId === job.orgId &&
    evidence.deviceId === job.deviceId &&
    evidence.grantId === job.grantId &&
    evidence.jobId === (job.jobId || job._id) &&
    evidence.action === job.action &&
    grant.orgId === job.orgId &&
    grant.deviceId === job.deviceId &&
    (grant.grantId || grant._id) === job.grantId
  );
}

export function projectAccess({ grant, eligibility, jobs = [], deviceEvidence = null }) {
  const grantEffective = grant?.state === GRANT_STATE.EFFECTIVE;
  const businessAllowed = Boolean(grantEffective && eligibility?.allowed === true);

  const candidates = jobs.filter(
    (job) =>
      job.credentialId === grant?.credentialId &&
      job.orgId === grant?.orgId &&
      job.deviceId === grant?.deviceId &&
      job.grantId === (grant?.grantId || grant?._id),
  );
  const latestJob = candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];

  const deviceEffective = Boolean(
    businessAllowed && latestJob && evidenceVerified({
      grant,
      job: latestJob,
      evidence: deviceEvidence,
    }),
  );

  return {
    credentialId: grant?.credentialId,
    grantState: grant?.state ?? null,
    businessAllowed,
    deviceEffective,
    latestJob: latestJob
      ? { jobId: latestJob.jobId || latestJob._id, state: latestJob.state, action: latestJob.action }
      : null,
    alert:
      businessAllowed &&
      (latestJob?.state === JOB_STATE.AWAITING_RESULT || latestJob?.state === JOB_STATE.TERMINAL_FAILED),
  };
}
