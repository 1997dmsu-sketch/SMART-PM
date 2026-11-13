/** H4-b: LocalStore-only Mock revoke dispatcher and local cleanup finalizer. */
import { createHash, randomUUID } from "node:crypto";

import { HttpError } from "../model.mjs";
import { LocalStore } from "../store.mjs";
import {
  assertBoundedId, assertSafeInt, deterministicLogId, ownerClaimMatchesDevice,
  validateAccessDeviceRecord, validateDeviceClaimReleaseGuard, validateGrantSlotRecord,
  validateOwnerClaimRecord,
} from "./collections.mjs";
import { assertRevokeInput } from "./dto.mjs";
import { MockFaceAccessProvider, classifyProviderError } from "./mock-provider.mjs";

const JOBS = "device_operation_jobs";
const GRANTS = "device_access_grants";
const LOGS = "device_operation_logs";
const CLAIMS = "device_claims";
const SLOTS = "grant_slot_claims";
const GUARDS = "device_claim_release_guards";
const DEVICES = "access_devices";
const AUDITS = "admin_audit";
const LEASE_MS = 60_000;
const WINDOW_MS = 10_000;
const DELAYS = [30_000, 120_000, 600_000];
const SERVICE_ACTOR = "h4-mock-revoker";
const ref = (collection, id) => ({ collection, id });
const keyOf = ({ collection, id }) => `${collection}/${id}`;
const unique = (refs) => [...new Map(refs.map((item) => [keyOf(item), item])).values()];
const fail = (code, message = "清理操作被拒绝", status = 409) => {
  throw new HttpError(status, message, code);
};
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const patchRecord = ({ _id, ...data }) => data;

const JOB_FIELDS = new Set([
  "_id", "orgId", "revision", "credentialId", "grantId", "deviceId", "action", "state",
  "executionMode", "provider", "evidenceScope", "attempts", "leaseGeneration", "leaseOwner",
  "leaseExpiresAt", "dispatchAuthorizedAt", "nextAttemptAt", "result", "cleanupPhase",
  "providerOutcome", "finalizeAttempts", "cleanupSnapshot", "createdAt", "updatedAt",
]);
const SNAPSHOT_FIELDS = new Set([
  "schemaVersion", "grantId", "grantRevision", "credentialId", "credentialRevision", "deviceId",
  "deviceRevision", "claimId", "claimRevision", "slotId", "slotRevision", "releaseGuardId",
  "releaseGuardRevision", "releaseGuardEpoch", "originalGrantState", "createdAt",
]);

function exact(record, fields) {
  return record && typeof record === "object" && !Array.isArray(record) &&
    Object.keys(record).length === fields.size && Object.keys(record).every((key) => fields.has(key));
}
function safeNow(clock) {
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0) fail("ADAPTER_UNAVAILABLE", "清理时钟不可用", 503);
  return now;
}
function addTime(now, delay) {
  if (!Number.isSafeInteger(now) || now > Number.MAX_SAFE_INTEGER - delay) {
    fail("ADAPTER_UNAVAILABLE", "清理时间溢出", 503);
  }
  return now + delay;
}
function validateSnapshot(snapshot, job) {
  if (!exact(snapshot, SNAPSHOT_FIELDS) || snapshot.schemaVersion !== 1 ||
      Buffer.byteLength(JSON.stringify(snapshot)) > 4096) fail("CLEANUP_SNAPSHOT_REQUIRED");
  for (const field of ["grantId", "credentialId", "deviceId", "claimId", "slotId", "releaseGuardId"])
    assertBoundedId(snapshot[field], `cleanupSnapshot.${field}`);
  for (const field of ["grantRevision", "credentialRevision", "deviceRevision", "claimRevision",
    "slotRevision", "releaseGuardRevision", "releaseGuardEpoch"])
    assertSafeInt(snapshot[field], `cleanupSnapshot.${field}`, { min: 1 });
  assertSafeInt(snapshot.createdAt, "cleanupSnapshot.createdAt");
  if (!["pending", "effective", "suspended", "expired"].includes(snapshot.originalGrantState) ||
      snapshot.grantId !== job.grantId || snapshot.credentialId !== job.credentialId ||
      snapshot.deviceId !== job.deviceId) fail("CLEANUP_SNAPSHOT_REQUIRED");
  return snapshot;
}
function validateResult(result, job) {
  const fields = new Set(["attempt", "outcome", "errorKind", "reasonCode", "finishedAt"]);
  if (!exact(result, fields) || result.attempt !== job.attempts || result.outcome !== job.state)
    fail("INVALID_JOB");
  assertSafeInt(result.finishedAt, "result.finishedAt");
  if (result.errorKind !== null) assertBoundedId(result.errorKind, "result.errorKind");
  if (result.reasonCode !== null) assertBoundedId(result.reasonCode, "result.reasonCode");
}
export function validateRevokeJob(job) {
  if (!exact(job, JOB_FIELDS)) fail("INVALID_JOB", "撤权任务字段非法");
  for (const field of ["_id", "orgId", "credentialId", "grantId", "deviceId"])
    assertBoundedId(job[field], `job.${field}`);
  for (const [field, min] of [["revision", 1], ["attempts", 0], ["leaseGeneration", 0],
    ["finalizeAttempts", 0], ["createdAt", 0], ["updatedAt", 0]])
    assertSafeInt(job[field], `job.${field}`, { min });
  if (job.action !== "revoke" || job.executionMode !== "test" || job.provider !== "mock" ||
      job.evidenceScope !== "simulated" || job.attempts > 4 || job.finalizeAttempts > 4 ||
      job.leaseGeneration !== job.attempts) fail("INVALID_JOB");
  validateSnapshot(job.cleanupSnapshot, job);
  if (!["dispatch", "finalize"].includes(job.cleanupPhase) ||
      ![null, "confirmed_removed"].includes(job.providerOutcome)) fail("INVALID_JOB");
  if (job.cleanupPhase === "dispatch" && (job.providerOutcome !== null || job.finalizeAttempts !== 0))
    fail("INVALID_JOB");
  if (job.cleanupPhase === "finalize" && job.providerOutcome !== "confirmed_removed") fail("INVALID_JOB");
  const noLease = job.leaseOwner === null && job.leaseExpiresAt === null && job.dispatchAuthorizedAt === null;
  if (job.state === "queued") {
    if (!noLease || job.cleanupPhase !== "dispatch" || job.nextAttemptAt !== null || job.result !== null)
      fail("INVALID_JOB");
  } else if (job.state === "sending") {
    assertBoundedId(job.leaseOwner, "job.leaseOwner");
    assertSafeInt(job.leaseExpiresAt, "job.leaseExpiresAt", { min: 1 });
    if (job.cleanupPhase !== "dispatch" || job.attempts < 1 || job.nextAttemptAt !== null || job.result !== null ||
        (job.dispatchAuthorizedAt !== null && (!Number.isSafeInteger(job.dispatchAuthorizedAt) ||
          job.dispatchAuthorizedAt >= job.leaseExpiresAt))) fail("INVALID_JOB");
  } else if (job.state === "retryable_failed") {
    if (!noLease || !Number.isSafeInteger(job.nextAttemptAt) || !job.result) fail("INVALID_JOB");
    if (job.cleanupPhase === "dispatch" && (job.attempts < 1 || job.attempts >= 4)) fail("INVALID_JOB");
    if (job.cleanupPhase === "finalize" && (job.finalizeAttempts < 1 || job.finalizeAttempts >= 4)) fail("INVALID_JOB");
    validateResult(job.result, job);
  } else if (["succeeded", "terminal_failed", "awaiting_result"].includes(job.state)) {
    if (!noLease || job.nextAttemptAt !== null || !job.result) fail("INVALID_JOB");
    validateResult(job.result, job);
  } else fail("INVALID_JOB");
  return job;
}

function auditSpec(job, phase, targetRevision, actorId = SERVICE_ACTOR, actorType = "system") {
  const auditId = `audit-h4-v1:${digest([job.orgId, job._id, phase, targetRevision])}`;
  return {
    reference: ref(AUDITS, auditId), auditId,
    audit: { auditId, orgId: job.orgId, actorId, actorType, action: `H4 ${phase}` },
  };
}
function resultFor(job, state, now, errorKind = null, reasonCode = null) {
  return { attempt: job.attempts, outcome: state, errorKind, reasonCode, finishedAt: now };
}
function logFor(job, state, revision, now, { errorKind = null, reasonCode = null, alertCode = null } = {}) {
  const id = deterministicLogId(job._id, state, revision);
  return { id, data: { orgId: job.orgId, jobId: job._id, action: "revoke", fromState: job.state,
    state, actorType: "system", actorId: SERVICE_ACTOR, at: now, revision, attempt: job.attempts,
    leaseGeneration: job.leaseGeneration, evidenceScope: "simulated", errorKind, reasonCode, alertCode } };
}
function transition(job, state, now, options = {}) {
  const revision = job.revision + 1;
  assertSafeInt(revision, "revision", { min: 1 });
  const next = { ...job, state, revision, updatedAt: now, leaseOwner: null, leaseExpiresAt: null,
    dispatchAuthorizedAt: null, nextAttemptAt: options.nextAttemptAt ?? null,
    result: resultFor(job, state, now, options.errorKind ?? null, options.reasonCode ?? null),
    ...(options.jobPatch || {}) };
  const log = logFor(job, state, revision, now, options);
  return { job: next, log, writes: [
    { collection: JOBS, id: job._id, data: patchRecord(next) },
    { collection: LOGS, id: log.id, data: log.data },
  ] };
}
function dispatchRetry(job, now, reasonCode) {
  if (job.attempts >= 4) return transition(job, "terminal_failed", now,
    { errorKind: "RETRYABLE", reasonCode, alertCode: "RETRY_EXHAUSTED" });
  return transition(job, "retryable_failed", now,
    { errorKind: "RETRYABLE", reasonCode, nextAttemptAt: addTime(now, DELAYS[job.attempts - 1]) });
}
function terminal(job, now, reasonCode, errorKind = "TERMINAL", alertCode = null) {
  return transition(job, "terminal_failed", now, { errorKind, reasonCode, alertCode });
}
function unknown(job, now, reasonCode) {
  return transition(job, "awaiting_result", now,
    { errorKind: "UNKNOWN_RESULT", reasonCode, alertCode: "RESULT_UNKNOWN" });
}
function fenceOf(job) {
  return { orgId: job.orgId, jobId: job._id, owner: job.leaseOwner, generation: job.leaseGeneration,
    attempts: job.attempts, revision: job.revision, expiresAt: job.leaseExpiresAt };
}
function assertFence(job, fence, now, expired = false) {
  validateRevokeJob(job);
  if (job.state !== "sending" || job.orgId !== fence.orgId || job._id !== fence.jobId ||
      job.leaseOwner !== fence.owner || job.leaseGeneration !== fence.generation ||
      job.attempts !== fence.attempts || job.revision !== fence.revision ||
      job.leaseExpiresAt !== fence.expiresAt || (expired ? now < job.leaseExpiresAt : now >= job.leaseExpiresAt))
    fail("LEASE_FENCE_REJECTED");
}
function relevantGrant(grant, targetId, deviceId, claimId) {
  if (!grant || grant._id === targetId || grant.deviceId !== deviceId || grant.claimId !== claimId) return false;
  return ["pending", "effective", "suspended", "expired"].includes(grant.state) ||
    (grant.state === "revoked" && grant.cleanupPending === true);
}

export class H4MockRevoker {
  #store; #provider; #clock; #owner; #runtimeConfig; #timeout;
  constructor({ store, orgId, provider, now = Date.now, owner = randomUUID(), runtimeConfig = null, timeout = null }) {
    if (!(store instanceof LocalStore) || !(provider instanceof MockFaceAccessProvider) ||
        typeof now !== "function" || (runtimeConfig !== null && typeof runtimeConfig !== "function") ||
        (timeout !== null && typeof timeout !== "function")) fail("NOT_CONFIGURED", "H4-b 仅支持 LocalStore/Mock", 503);
    assertBoundedId(orgId, "orgId"); assertBoundedId(owner, "owner");
    this.#store = store; this.#provider = provider; this.#clock = now; this.#owner = owner;
    this.#runtimeConfig = runtimeConfig; this.#timeout = timeout; this.orgId = orgId;
  }
  #configured() {
    if (!this.#runtimeConfig) return true;
    const value = this.#runtimeConfig();
    return value?.executionMode === "test" && value.provider === "mock";
  }
  async #tx(refs, job, phase, targetRevision, build, actor = null) {
    const spec = auditSpec(job, phase, targetRevision, actor?.actorId ?? SERVICE_ACTOR,
      actor ? "user" : "system");
    let output;
    await this.#store.transact(unique([...refs, spec.reference]), async (state) => {
      output = await build(state, spec.auditId);
      return output.writes;
    }, spec.audit);
    return output.value;
  }
  async #claim(jobId) {
    assertBoundedId(jobId, "jobId");
    const found = await this.#store.get(JOBS, jobId, this.orgId);
    if (!found) fail("NOT_FOUND", "任务不存在", 404);
    const before = validateRevokeJob(found);
    if (before.cleanupPhase !== "dispatch" || before.state !== "queued" || before.attempts >= 4 ||
        (before.nextAttemptAt !== null && safeNow(this.#clock) < before.nextAttemptAt)) fail("INVALID_JOB");
    const revision = before.revision + 1;
    const logId = deterministicLogId(jobId, "sending", revision);
    return this.#tx([ref(JOBS, jobId), ref(LOGS, logId)], before, "claim", revision, (state) => {
      const now = safeNow(this.#clock);
      const current = validateRevokeJob(state[`${JOBS}/${jobId}`]);
      if (current.revision !== before.revision || current.state !== "queued") fail("INVALID_JOB");
      if (state[`${LOGS}/${logId}`]) fail("CONFLICT");
      const next = { ...current, state: "sending", revision, updatedAt: now, attempts: current.attempts + 1,
        leaseGeneration: current.leaseGeneration + 1, leaseOwner: this.#owner,
        leaseExpiresAt: addTime(now, LEASE_MS), dispatchAuthorizedAt: null, nextAttemptAt: null, result: null };
      const log = logFor(current, "sending", revision, now);
      log.data.attempt = next.attempts;
      log.data.leaseGeneration = next.leaseGeneration;
      return { value: { job: next, fence: fenceOf(next) }, writes: [
        { collection: JOBS, id: jobId, data: patchRecord(next) },
        { collection: LOGS, id: logId, data: log.data },
      ] };
    });
  }
  #bindingRefs(job) {
    const s = job.cleanupSnapshot;
    return [ref(GRANTS, job.grantId), ref("face_credentials", job.credentialId), ref(DEVICES, job.deviceId),
      ref(CLAIMS, s.claimId), ref(SLOTS, s.slotId), ref(GUARDS, s.releaseGuardId)];
  }
  #validateBindings(job, state) {
    const s = job.cleanupSnapshot;
    const grant = state[`${GRANTS}/${job.grantId}`];
    const credential = state[`face_credentials/${job.credentialId}`];
    const device = state[`${DEVICES}/${job.deviceId}`];
    const claim = state[`${CLAIMS}/${s.claimId}`];
    const slot = state[`${SLOTS}/${s.slotId}`];
    const guard = state[`${GUARDS}/${s.releaseGuardId}`];
    if (!grant || grant.orgId !== job.orgId || grant.state !== "revoked" || grant.cleanupPending !== true ||
        grant.cleanupJobId !== job._id || grant.revision !== s.grantRevision + 1 ||
        grant.credentialId !== job.credentialId || grant.deviceId !== job.deviceId ||
        grant.claimId !== s.claimId || grant.slotId !== s.slotId) fail("CLEANUP_SNAPSHOT_REQUIRED");
    if (!credential || credential.orgId !== job.orgId || credential.revision !== s.credentialRevision) fail("CREDENTIAL_CHANGED");
    try { validateAccessDeviceRecord(device); validateOwnerClaimRecord(claim); validateGrantSlotRecord(slot);
      validateDeviceClaimReleaseGuard(Object.hasOwn(guard || {}, "_id") ? guard : { ...guard, _id: s.releaseGuardId });
    } catch { fail("CLEANUP_SNAPSHOT_REQUIRED"); }
    if (device.revision !== s.deviceRevision || device.claimId !== s.claimId || device.orgId !== job.orgId ||
        claim.revision !== s.claimRevision || claim.state !== "active" || !ownerClaimMatchesDevice(claim, device, job.deviceId) ||
        slot.revision !== s.slotRevision || slot.state !== "active" || slot.activeClaimId !== job.grantId ||
        slot.deviceId !== job.deviceId || guard.revision !== s.releaseGuardRevision || guard.epoch !== s.releaseGuardEpoch ||
        guard.orgId !== job.orgId || guard.claimId !== s.claimId) fail("DEVICE_CLAIM_INVALID");
    return { grant, credential, device, claim, slot, guard };
  }
  async #authorize(claimed) {
    const job = claimed.job;
    const retryLog = deterministicLogId(job._id, "retryable_failed", job.revision + 1);
    const terminalLog = deterministicLogId(job._id, "terminal_failed", job.revision + 1);
    let candidates = [];
    let capacityBlocked = false;
    try {
      const grants = await this.#store.list(GRANTS, this.orgId);
      candidates = grants.filter((item) => relevantGrant(item, job.grantId, job.deviceId, job.cleanupSnapshot.claimId));
      capacityBlocked = 8 + candidates.length > 90;
    } catch { capacityBlocked = true; }
    return this.#tx([ref(JOBS, job._id), ...this.#bindingRefs(job), ref(LOGS, retryLog), ref(LOGS, terminalLog)],
      job, "authorize", job.revision + 1, (state) => {
        const now = safeNow(this.#clock);
        const current = validateRevokeJob(state[`${JOBS}/${job._id}`]);
        assertFence(current, claimed.fence, now);
        try {
          if (!this.#configured()) fail("NOT_CONFIGURED");
          if (capacityBlocked) fail("ADAPTER_UNAVAILABLE", "清理候选超限", 503);
          this.#validateBindings(current, state);
          if (current.leaseExpiresAt - now < WINDOW_MS) fail("PRE_SEND_WINDOW_CLOSED");
          const revision = current.revision + 1;
          const next = { ...current, revision, updatedAt: now, dispatchAuthorizedAt: now };
          return { value: { job: next, fence: { ...claimed.fence, revision },
            input: assertRevokeInput({ grantId: current.grantId, credentialId: current.credentialId }) },
          writes: [{ collection: JOBS, id: current._id, data: patchRecord(next) }] };
        } catch (error) {
          const transient = error.code === "ADAPTER_UNAVAILABLE";
          const plan = transient ? dispatchRetry(current, now, error.code) :
            terminal(current, now, error.code || "ADAPTER_UNAVAILABLE", error.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "PRE_SEND_BLOCKED",
              error.code === "NOT_CONFIGURED" ? "CONFIGURATION_BLOCKED" : null);
          if (state[`${LOGS}/${plan.log.id}`]) fail("CONFLICT");
          return { value: { job: plan.job }, writes: plan.writes };
        }
      });
  }
  async #finishFence(fence, kind) {
    const stateName = kind === "RETRYABLE" ? (fence.attempts >= 4 ? "terminal_failed" : "retryable_failed") :
      kind === "UNKNOWN_RESULT" ? "awaiting_result" : "terminal_failed";
    const logId = deterministicLogId(fence.jobId, stateName, fence.revision + 1);
    const found = await this.#store.get(JOBS, fence.jobId, this.orgId);
    return this.#tx([ref(JOBS, fence.jobId), ref(LOGS, logId)], found, `result-${stateName}`, fence.revision + 1, (state) => {
      const now = safeNow(this.#clock);
      const current = validateRevokeJob(state[`${JOBS}/${fence.jobId}`]);
      assertFence(current, fence, now);
      const plan = kind === "RETRYABLE" ? dispatchRetry(current, now, "PROVIDER_PRE_SEND") :
        kind === "UNKNOWN_RESULT" ? unknown(current, now, "RESULT_UNKNOWN") :
          terminal(current, now, kind === "WINDOW" ? "PRE_SEND_WINDOW_CLOSED" :
            kind === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "DEVICE_REJECTED",
            kind === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "TERMINAL",
            kind === "NOT_CONFIGURED" ? "CONFIGURATION_BLOCKED" : null);
      if (state[`${LOGS}/${plan.log.id}`]) fail("CONFLICT");
      return { value: plan.job, writes: plan.writes };
    });
  }
  async #markFinalizePending(fence, reasonCode = "LOCAL_FINALIZE_PENDING") {
    const found = await this.#store.get(JOBS, fence.jobId, this.orgId);
    const logId = deterministicLogId(fence.jobId, "retryable_failed", fence.revision + 1);
    return this.#tx([ref(JOBS, fence.jobId), ref(LOGS, logId)], found, "finalize-pending", fence.revision + 1, (state) => {
      const now = safeNow(this.#clock);
      const current = validateRevokeJob(state[`${JOBS}/${fence.jobId}`]);
      assertFence(current, fence, now);
      const plan = transition(current, "retryable_failed", now, { errorKind: "LOCAL_FINALIZE", reasonCode,
        nextAttemptAt: addTime(now, DELAYS[0]), jobPatch: { cleanupPhase: "finalize",
          providerOutcome: "confirmed_removed", finalizeAttempts: 1 } });
      if (state[`${LOGS}/${plan.log.id}`]) fail("CONFLICT");
      return { value: plan.job, writes: plan.writes };
    });
  }
  async #finalize(job, fence = null) {
    let all; let guardWitness;
    try {
      // Guard must be read before the candidate scan. A createGrant committed before
      // this read is visible to the following list; one committed afterwards changes
      // the guard and is rejected by the transaction CAS below.
      guardWitness = await this.#store.get(GUARDS, job.cleanupSnapshot.releaseGuardId, this.orgId);
      validateDeviceClaimReleaseGuard(guardWitness);
      all = await this.#store.list(GRANTS, this.orgId);
    }
    catch (error) {
      if (fence) return this.#markFinalizePending(fence, "ADAPTER_UNAVAILABLE");
      return this.#localFinalizeFailure(job, "ADAPTER_UNAVAILABLE");
    }
    const candidates = all.filter((item) => relevantGrant(item, job.grantId, job.deviceId, job.cleanupSnapshot.claimId));
    const targetRevision = job.revision + 1;
    const logId = deterministicLogId(job._id, "succeeded", targetRevision);
    const base = [ref(JOBS, job._id), ref(GRANTS, job.grantId), ref(SLOTS, job.cleanupSnapshot.slotId),
      ref(CLAIMS, job.cleanupSnapshot.claimId), ref(DEVICES, job.deviceId), ref(GUARDS, job.cleanupSnapshot.releaseGuardId),
      ref(LOGS, logId), ...candidates.map((item) => ref(GRANTS, item._id))];
    if (unique([...base, auditSpec(job, "finalize", targetRevision).reference]).length > 90) {
      if (fence) return this.#markFinalizePending(fence, "ADAPTER_UNAVAILABLE");
      return this.#localFinalizeFailure(job, "ADAPTER_UNAVAILABLE");
    }
    try {
      return await this.#tx(base, job, "finalize", targetRevision, (state, auditId) => {
        const now = safeNow(this.#clock);
        const current = validateRevokeJob(state[`${JOBS}/${job._id}`]);
        if (fence) assertFence(current, fence, now);
        else if (current.state !== "retryable_failed" || current.cleanupPhase !== "finalize" ||
            current.revision !== job.revision || now < current.nextAttemptAt) fail("INVALID_JOB");
        const grant = state[`${GRANTS}/${job.grantId}`];
        const slot = state[`${SLOTS}/${job.cleanupSnapshot.slotId}`];
        const claim = state[`${CLAIMS}/${job.cleanupSnapshot.claimId}`];
        const device = state[`${DEVICES}/${job.deviceId}`];
        const guard = state[`${GUARDS}/${job.cleanupSnapshot.releaseGuardId}`];
        if (!grant || grant.state !== "revoked" || grant.cleanupPending !== true || grant.cleanupJobId !== job._id)
          fail("CLEANUP_SNAPSHOT_REQUIRED");
        try { validateGrantSlotRecord(slot); validateOwnerClaimRecord(claim); validateAccessDeviceRecord(device);
          validateDeviceClaimReleaseGuard(Object.hasOwn(guard || {}, "_id") ? guard : { ...guard, _id: job.cleanupSnapshot.releaseGuardId });
        } catch { fail("DEVICE_CLAIM_INVALID"); }
        if (!guardWitness || guard.revision !== guardWitness.revision || guard.epoch !== guardWitness.epoch)
          fail("REVISION_CONFLICT");
        if (slot.state !== "active" || slot.activeClaimId !== job.grantId || claim.state !== "active" ||
            !ownerClaimMatchesDevice(claim, device, job.deviceId) || device.claimId !== claim._id)
          fail("DEVICE_CLAIM_INVALID");
        const blockers = candidates.map((item) => state[`${GRANTS}/${item._id}`]).filter((item) =>
          relevantGrant(item, job.grantId, job.deviceId, job.cleanupSnapshot.claimId));
        const releasedSlot = { ...slot, state: "released", revision: slot.revision + 1, updatedAt: now,
          releasedAt: now, releasedByJobId: job._id, activeClaimId: undefined, activatedAt: undefined };
        const nextGrant = { ...grant, cleanupPending: false, revision: grant.revision + 1, updatedAt: now };
        const plan = transition(current, "succeeded", now, { jobPatch: { cleanupPhase: "finalize",
          providerOutcome: "confirmed_removed" } });
        const writes = [...plan.writes,
          { collection: GRANTS, id: grant._id, data: patchRecord(nextGrant) },
          { collection: SLOTS, id: slot._id, data: patchRecord(releasedSlot) }];
        if (!blockers.length) {
          const releasedClaim = { ...claim, state: "released", revision: claim.revision + 1, updatedAt: now,
            releasedAt: now, releasedByAuditId: auditId, releaseReason: "no-active-grants",
            boundDeviceId: undefined, activatedAt: undefined, activatedByAuditId: undefined };
          const nextGuard = { ...guard, epoch: guard.epoch + 1, revision: guard.revision + 1, updatedAt: now };
          validateOwnerClaimRecord(releasedClaim); validateDeviceClaimReleaseGuard(nextGuard);
          writes.push({ collection: CLAIMS, id: claim._id, data: patchRecord(releasedClaim) },
            { collection: GUARDS, id: guard._id, data: patchRecord(nextGuard) });
        }
        validateGrantSlotRecord(releasedSlot);
        if (state[`${LOGS}/${plan.log.id}`]) fail("CONFLICT");
        return { value: plan.job, writes };
      });
    } catch (error) {
      if (!fence || error.code === "LEASE_FENCE_REJECTED") throw error;
      return this.#markFinalizePending(fence, error.code || "ADAPTER_UNAVAILABLE");
    }
  }
  async #localFinalizeFailure(job, reasonCode) {
    const targetState = job.finalizeAttempts + 1 >= 4 ? "terminal_failed" : "retryable_failed";
    const logId = deterministicLogId(job._id, targetState, job.revision + 1);
    return this.#tx([ref(JOBS, job._id), ref(LOGS, logId)], job, "finalize-retry", job.revision + 1, (state) => {
      const now = safeNow(this.#clock);
      const current = validateRevokeJob(state[`${JOBS}/${job._id}`]);
      if (current.revision !== job.revision || current.cleanupPhase !== "finalize" ||
          current.state !== "retryable_failed") fail("INVALID_JOB");
      const attempts = current.finalizeAttempts + 1;
      const plan = attempts >= 4 ? terminal(current, now, "LOCAL_FINALIZE_EXHAUSTED", "LOCAL_FINALIZE") :
        transition(current, "retryable_failed", now, { errorKind: "LOCAL_FINALIZE", reasonCode,
          nextAttemptAt: addTime(now, DELAYS[attempts - 1]), jobPatch: { finalizeAttempts: attempts } });
      if (state[`${LOGS}/${plan.log.id}`]) fail("CONFLICT");
      return { value: plan.job, writes: plan.writes };
    });
  }
  async dispatch(jobId) {
    const claimed = await this.#claim(jobId);
    const authorized = await this.#authorize(claimed);
    if (!authorized.input) return authorized.job;
    const now = safeNow(this.#clock);
    if (authorized.job.leaseExpiresAt - now < WINDOW_MS)
      return this.#finishFence(authorized.fence, "WINDOW");
    const context = { actorId: SERVICE_ACTOR, actorType: "system", permissions: new Set(["device.access.manage"]),
      orgId: this.orgId, executionMode: "test", idempotencyKey: `h4-v1:${digest([
        this.orgId, authorized.job._id, "revoke", authorized.job.attempts])}` };
    let timer; let kind = "UNKNOWN_RESULT";
    try {
      const timeout = this.#timeout ? this.#timeout(WINDOW_MS) : new Promise((resolve) => { timer = setTimeout(resolve, WINDOW_MS); });
      const response = await Promise.race([this.#provider.revokeFace(authorized.input, context), timeout]);
      if (response?.status === "succeeded" && typeof response.jobId === "string") kind = "SUCCESS";
    } catch (error) { kind = classifyProviderError(error); }
    finally { clearTimeout(timer); }
    if (kind === "SUCCESS") return this.#finalize(authorized.job, authorized.fence);
    return this.#finishFence(authorized.fence, kind);
  }
  async claim(jobId) { return this.#claim(jobId); }
  async finalize(jobId) {
    const job = validateRevokeJob(await this.#store.get(JOBS, jobId, this.orgId));
    if (job.cleanupPhase !== "finalize" || job.state !== "retryable_failed") fail("INVALID_JOB");
    if (safeNow(this.#clock) < job.nextAttemptAt) fail("RETRY_NOT_DUE");
    try { return await this.#finalize(job); }
    catch (error) { return this.#localFinalizeFailure(job, error.code || "ADAPTER_UNAVAILABLE"); }
  }
  async requeue(jobId, expectedRevision = null, actor = null) {
    const found = await this.#store.get(JOBS, jobId, this.orgId);
    if (!found) fail("NOT_FOUND", "任务不存在", 404);
    const job = validateRevokeJob(found);
    if (job.cleanupPhase !== "dispatch" || job.state !== "retryable_failed" || job.attempts >= 4)
      fail("INVALID_JOB");
    if (actor !== null) {
      if (!actor || typeof actor !== "object" || Array.isArray(actor)) fail("PARAM_ERROR", "actor 非法", 400);
      assertBoundedId(actor.actorId, "actor.actorId"); assertBoundedId(actor.membershipId, "actor.membershipId");
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail("PARAM_ERROR", "expectedRevision 非法", 400);
    }
    const revision = job.revision + 1;
    const logId = deterministicLogId(jobId, "queued", revision);
    const memberRef = actor ? ref("org_memberships", actor.membershipId) : null;
    const orgRef = actor ? ref("organizations", this.orgId) : null;
    return this.#tx([ref(JOBS, jobId), ref(LOGS, logId), ...(actor ? [memberRef, orgRef] : [])],
      job, "requeue", revision, (state) => {
      const now = safeNow(this.#clock);
      const current = validateRevokeJob(state[`${JOBS}/${jobId}`]);
      if (actor) {
        const member = state[keyOf(memberRef)];
        if (state[keyOf(orgRef)]?.status !== "active" || member?.orgId !== this.orgId ||
            member.status !== "active" || (member.principalId ?? member.actorId ?? member._id) !== actor.actorId ||
            !member.permissions?.includes("device.operation.retry")) fail("FORBIDDEN", "无重试权限", 403);
      }
      if (current.revision !== job.revision || current.state !== "retryable_failed" ||
          (actor && current.revision !== expectedRevision) || current.cleanupPhase !== "dispatch") fail("INVALID_JOB");
      if (now < current.nextAttemptAt) fail("RETRY_NOT_DUE");
      const next = { ...current, state: "queued", revision, updatedAt: now,
        nextAttemptAt: null, result: null };
      const log = logFor(current, "queued", revision, now);
      if (state[`${LOGS}/${logId}`]) fail("CONFLICT");
      return { value: next, writes: [
        { collection: JOBS, id: jobId, data: patchRecord(next) },
        { collection: LOGS, id: logId, data: log.data },
      ] };
    }, actor);
  }
  async expire(jobId) {
    const found = await this.#store.get(JOBS, jobId, this.orgId);
    if (!found) fail("NOT_FOUND", "任务不存在", 404);
    const job = validateRevokeJob(found);
    const fence = fenceOf(job);
    const logId = deterministicLogId(jobId, "awaiting_result", job.revision + 1);
    return this.#tx([ref(JOBS, jobId), ref(LOGS, logId)], job, "expire", job.revision + 1, (state) => {
      const now = safeNow(this.#clock); const current = validateRevokeJob(state[`${JOBS}/${jobId}`]);
      assertFence(current, fence, now, true);
      const plan = unknown(current, now, "LEASE_EXPIRED_UNKNOWN");
      if (state[`${LOGS}/${plan.log.id}`]) fail("CONFLICT");
      return { value: plan.job, writes: plan.writes };
    });
  }
  async scanExpired(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("PARAM_ERROR", "limit 非法", 400);
    const now = safeNow(this.#clock);
    const jobs = await this.#store.list(JOBS, this.orgId);
    const candidates = jobs.filter((job) => {
      try { validateRevokeJob(job); return job.state === "sending" && job.leaseExpiresAt <= now; }
      catch { return false; }
    }).slice(0, limit);
    const output = [];
    for (const job of candidates) {
      try { output.push(await this.expire(job._id)); }
      catch (error) { if (error.code !== "LEASE_FENCE_REJECTED") throw error; }
    }
    return output;
  }
}
