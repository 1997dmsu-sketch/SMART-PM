/** H3-b: LocalStore-only synthetic Mock dispatch. No HTTP, cloud or real device I/O. */
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { HttpError } from "../model.mjs";
import { LocalStore } from "../store.mjs";
import {
  assertBoundedId, deterministicLogId, digestDomainMatchesDevice, grantSlotKey,
  ownerClaimMatchesDevice, validateAccessDeviceRecord, validateGrantSlotRecord,
  validateOwnerClaimRecord,
} from "./collections.mjs";
import { assertEnrollInput } from "./dto.mjs";
import {
  assertLeaseFence, claimDispatchJob, dispatchVersion, isDispatchCandidate,
  validateDispatchJob,
} from "./h3a.mjs";
import { MockFaceAccessProvider, classifyProviderError } from "./mock-provider.mjs";
import { prepareGrantEligibility } from "./qualification.mjs";
import { snapshotEligibility, validateEligibility } from "./eligibility.mjs";

const JOBS = "device_operation_jobs";
const GRANTS = "device_access_grants";
const LOGS = "device_operation_logs";
const LEASE_MS = 60_000;
const WINDOW_MS = 10_000;
const DELAYS = [30_000, 120_000, 600_000];
const SERVICE_ACTOR = "h3-mock-dispatch";
const ref = (collection, id) => ({ collection, id });
const keyOf = ({ collection, id }) => `${collection}/${id}`;
const unique = (refs) => [...new Map(refs.map((item) => [keyOf(item), item])).values()];
const fail = (code, message = "派发操作被拒绝", status = 409) => {
  throw new HttpError(status, message, code);
};
const safeNow = (clock) => {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) fail("ADAPTER_UNAVAILABLE", "派发时钟不可用", 503);
  return value;
};
const safeAdd = (a, b) => {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a > Number.MAX_SAFE_INTEGER - b) {
    fail("ADAPTER_UNAVAILABLE", "派发时间溢出", 503);
  }
  return a + b;
};

function patch(record) {
  const { _id, ...data } = record;
  return data;
}

function resultRecord(job, state, now, errorKind = null, reasonCode = null) {
  return { attempt: job.attempts, outcome: state, errorKind, reasonCode, finishedAt: now };
}

function transition(job, state, now, { errorKind = null, reasonCode = null, alertCode = null,
  nextAttemptAt = null, actorId = SERVICE_ACTOR, actorType = "system" } = {}) {
  const revision = job.revision + 1;
  if (!Number.isSafeInteger(revision)) fail("INVALID_JOB", "任务 revision 溢出");
  const next = {
    ...job, state, revision, updatedAt: now,
    leaseOwner: null, leaseExpiresAt: null, dispatchAuthorizedAt: null,
    nextAttemptAt,
    result: resultRecord(job, state, now, errorKind, reasonCode),
  };
  const logId = deterministicLogId(job._id, state, revision);
  const log = {
    orgId: job.orgId, jobId: job._id, action: "enroll", fromState: job.state, state,
    actorType, actorId, at: now, revision, attempt: job.attempts,
    leaseGeneration: job.leaseGeneration, evidenceScope: "simulated",
    errorKind, reasonCode, alertCode,
  };
  return { job: next, logId, writes: [
    { collection: JOBS, id: job._id, data: patch(next) },
    { collection: LOGS, id: logId, data: log },
  ] };
}

function snapshotVersions(job) {
  return new Map(job.dispatchSnapshot.versions.map((item) => [keyOf(item), item]));
}

function compareWitnesses(job, state, collections = null, code = "REVISION_CONFLICT") {
  for (const witness of job.dispatchSnapshot.versions) {
    if (collections && !collections.has(witness.collection)) continue;
    const current = dispatchVersion(ref(witness.collection, witness.id), state[keyOf(witness)]);
    if (!isDeepStrictEqual(current, witness)) fail(code);
  }
}

function jobRefs(job) {
  return job.dispatchSnapshot.versions.map(({ collection, id }) => ref(collection, id));
}

function logRef(job, state, revision = job.revision + 1) {
  return ref(LOGS, deterministicLogId(job._id, state, revision));
}

function assertLogAbsent(state, reference) {
  if (state[keyOf(reference)]) fail("CONFLICT", "确定性日志已存在");
}

function retryPlan(job, now, reasonCode, errorKind = "RETRYABLE") {
  if (job.attempts >= 4) {
    return transition(job, "terminal_failed", now, {
      errorKind, reasonCode, alertCode: "RETRY_EXHAUSTED",
    });
  }
  return transition(job, "retryable_failed", now, {
    errorKind, reasonCode, nextAttemptAt: safeAdd(now, DELAYS[job.attempts - 1]),
  });
}

function terminalPlan(job, now, reasonCode, alertCode = null, errorKind = "PRE_SEND_BLOCKED") {
  return transition(job, "terminal_failed", now, { errorKind, reasonCode, alertCode });
}

function unknownPlan(job, now, reasonCode = "RESULT_UNKNOWN") {
  return transition(job, "awaiting_result", now, {
    errorKind: "UNKNOWN_RESULT", reasonCode, alertCode: "RESULT_UNKNOWN",
  });
}

function validateDevice(job, state) {
  const snapshot = job.dispatchSnapshot;
  const device = state[`access_devices/${job.deviceId}`];
  const claim = state[`device_claims/${snapshot.claimId}`];
  const slot = state[`grant_slot_claims/${snapshot.slotId}`];
  try { validateAccessDeviceRecord(device); } catch { fail("DEVICE_CLAIM_INVALID"); }
  if (device.orgId !== job.orgId || device.ownerOrgId !== job.orgId) fail("DEVICE_CLAIM_CONFLICT");
  if (device.status !== "active" || device.capabilities?.face !== true || device.claimId !== snapshot.claimId) {
    fail("DEVICE_CLAIM_INVALID");
  }
  const domain = digestDomainMatchesDevice(
    state[`device_digest_domains/${snapshot.domainHeadId}`],
    state[`device_digest_domains/${snapshot.domainVersionId}`], device,
  );
  if (!domain.ok) fail(domain.code);
  try { validateOwnerClaimRecord(claim); } catch { fail("DEVICE_CLAIM_INVALID"); }
  if (claim.ownerOrgId !== job.orgId) fail("DEVICE_CLAIM_CONFLICT");
  if (claim.state !== "active" || !ownerClaimMatchesDevice(claim, device, job.deviceId)) {
    fail("DEVICE_CLAIM_INVALID");
  }
  try { validateGrantSlotRecord(slot); } catch { fail("GRANT_SLOT_CONFLICT"); }
  if (slot.state !== "active" || slot.orgId !== job.orgId || slot.activeClaimId !== job.grantId ||
      slot.personId !== snapshot.personId || slot.deviceId !== job.deviceId ||
      slot.cycleId !== snapshot.cycleId || snapshot.slotId !== grantSlotKey(slot)) {
    fail("GRANT_SLOT_CONFLICT");
  }
  compareWitnesses(job, state, new Set([
    "access_devices", "device_claims", "device_digest_domains", "grant_slot_claims",
  ]), "REVISION_CONFLICT");
}

function validateGrantAndSubject(dispatcher, job, state, now) {
  const snapshot = job.dispatchSnapshot;
  const grant = state[`${GRANTS}/${job.grantId}`];
  if (!grant || grant.orgId !== job.orgId || grant.state !== "pending" ||
      grant.personId !== snapshot.personId || grant.occupancyId !== snapshot.occupancyId ||
      grant.cycleId !== snapshot.cycleId || grant.deviceId !== job.deviceId ||
      grant.credentialId !== job.credentialId || grant.claimId !== snapshot.claimId ||
      grant.slotId !== snapshot.slotId || !Number.isSafeInteger(grant.validFrom) ||
      !Number.isSafeInteger(grant.validUntil) || grant.validFrom > now || now >= grant.validUntil) {
    fail("GRANT_INACTIVE");
  }
  const credential = state[`face_credentials/${job.credentialId}`];
  if (!credential || credential.orgId !== job.orgId || credential.reviewState !== "approved" ||
      credential.personId !== snapshot.personId || credential.sourceFileId !== snapshot.fileId) {
    fail("CREDENTIAL_CHANGED");
  }
  try { dispatcher.files.assertBinding(state, {
    fileId: snapshot.fileId, revision: credential.sourceFileRevision,
  }); } catch { fail("FILE_BINDING_CHANGED"); }
  const org = state[`organizations/${job.orgId}`];
  const member = state[`org_memberships/${snapshot.membershipId}`];
  if (org?.status !== "active" || member?.orgId !== job.orgId || member.status !== "active" ||
      (member.principalId ?? member.actorId ?? member._id) !== snapshot.creatorActorId ||
      !Array.isArray(member.permissions) || !member.permissions.includes("device.access.manage")) {
    fail("FORBIDDEN", "权限已变化", 403);
  }
  compareWitnesses(job, state, new Set([
    GRANTS, "face_credentials", "file_assets", "organizations", "org_memberships",
  ]), "REVISION_CONFLICT");
  return { grant, credential };
}

const TRANSIENT = new Set(["BLACKLIST_RETRY", "ADAPTER_UNAVAILABLE"]);
const KNOWN = new Set([
  "GRANT_INACTIVE", "CREDENTIAL_CHANGED", "FILE_BINDING_CHANGED", "FORBIDDEN",
  "REVISION_CONFLICT", "IDENTITY_CONFLICT", "IDENTITY_NOT_APPROVED", "USER_DISABLED",
  "INVALID_STATE", "ROOM_ARCHIVED", "CATALOG_ARCHIVED", "SPONSOR_INACTIVE",
  "DUPLICATE_OCCUPANCY", "BLACKLIST_DENIED", "BLACKLIST_REVIEW_REQUIRED",
  "ADAPTER_UNAVAILABLE", "BLACKLIST_RETRY", "DEVICE_CLAIM_INVALID",
  "DEVICE_CLAIM_CONFLICT", "DOMAIN_INCOMPLETE", "DEVICE_DIGEST_CONFIG_CHANGED",
  "GRANT_SLOT_CONFLICT", "NOT_CONFIGURED", "PRE_SEND_WINDOW_CLOSED",
  "NOT_FOUND",
]);

export class H3MockDispatcher {
  #store;
  #provider;
  #clock;
  #owner;
  #runtimeConfig;

  constructor({ store, orgId, files, blacklist, provider, now = Date.now,
    owner = randomUUID(), runtimeConfig = null }) {
    if (!(store instanceof LocalStore) || !(provider instanceof MockFaceAccessProvider) ||
        files?.store !== store || blacklist?.store !== store || files.orgId !== orgId ||
        blacklist.orgId !== orgId || typeof now !== "function" ||
        (runtimeConfig !== null && typeof runtimeConfig !== "function")) {
      fail("NOT_CONFIGURED", "H3-b 仅支持单进程 LocalStore/Mock", 503);
    }
    this.#store = store;
    assertBoundedId(orgId, "orgId");
    assertBoundedId(owner, "owner");
    this.#provider = provider;
    this.#clock = now;
    this.#owner = owner;
    this.#runtimeConfig = runtimeConfig;
    this.orgId = orgId;
    this.files = files;
    this.blacklist = blacklist;
  }

  #configured() {
    if (!this.#runtimeConfig) return true;
    const value = this.#runtimeConfig();
    return value?.executionMode === "test" && value.provider === "mock";
  }

  #audit(action, actorId = SERVICE_ACTOR, actorType = "system") {
    return { actor: actorId, actorId, actorType, action, orgId: this.orgId };
  }

  async #finishFence(fence, makePlan, states, extraRefs = [], auditAction = "迁移合成门禁任务") {
    const jobRef = ref(JOBS, fence.jobId);
    const refs = [jobRef, ...extraRefs, ...states.map((state) =>
      logRef({ _id: fence.jobId, revision: fence.revision }, state))];
    let committed;
    await this.#store.transact(unique(refs), (state) => {
      const now = safeNow(this.#clock);
      const current = validateDispatchJob(state[keyOf(jobRef)]);
      assertLeaseFence(current, fence, now);
      const plan = makePlan(current, now, state);
      assertLogAbsent(state, ref(LOGS, plan.logId));
      committed = plan.job;
      return plan.writes;
    }, this.#audit(auditAction));
    return committed;
  }

  async #authorize(claimed) {
    let fence = claimed.fence;
    const snapshot = claimed.job.dispatchSnapshot;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let planned = null;
      let token = null;
      let prepareError = null;
      const request = {
        orgId: this.orgId, personId: snapshot.personId, occupancyId: snapshot.occupancyId,
        cycleId: snapshot.cycleId, identityApplicationId: snapshot.identityApplicationId,
        restriction: snapshot.restriction,
      };
      try {
        const grant = await this.#store.get(GRANTS, claimed.job.grantId, this.orgId);
        planned = await prepareGrantEligibility(this.#store, {
          ...request, validFrom: grant?.validFrom, validUntil: grant?.validUntil,
          baseRefs: [],
        });
        token = await this.blacklist.prepareEligibility(request);
      } catch (error) { prepareError = error; }
      const jobRef = ref(JOBS, fence.jobId);
      const snapshotRefs = jobRefs(claimed.job);
      const terminalRef = logRef({ _id: fence.jobId, revision: fence.revision }, "terminal_failed");
      const retryRef = logRef({ _id: fence.jobId, revision: fence.revision }, "retryable_failed");
      const refs = unique([jobRef, ...snapshotRefs, ...(planned?.refs ?? []), ...(token?.refs ?? []),
        terminalRef, retryRef]);
      if (refs.length > 90) {
        const failed = await this.#finishFence(fence,
          (job, now) => retryPlan(job, now, "ADAPTER_UNAVAILABLE"), ["retryable_failed"]);
        return { job: failed };
      }
      try {
        let result;
        await this.#store.transact(refs, (state) => {
          const now = safeNow(this.#clock);
          const current = validateDispatchJob(state[keyOf(jobRef)]);
          assertLeaseFence(current, fence, now);
          if (current.dispatchAuthorizedAt !== null) fail("LEASE_FENCE_REJECTED");
          try {
            if (!this.#configured()) fail("NOT_CONFIGURED");
            if (prepareError) throw prepareError;
            const { grant } = validateGrantAndSubject(this, current, state, now);
            const allowedRefs = new Set(snapshotRefs.map(keyOf));
            if (!planned.refs.every((item) => allowedRefs.has(keyOf(item)))) fail("REVISION_CONFLICT");
            const liveRequest = { ...planned.request, validFrom: grant.validFrom, validUntil: grant.validUntil };
            const verdict = validateEligibility(snapshotEligibility(state, liveRequest), liveRequest, now);
            if (!verdict.eligible) fail(verdict.code);
            compareWitnesses(current, state, new Set([
              "persons", "users", "identity_applications", "occupancies", "occupancy_cycles",
              "rooms", "property_catalog", "unique_claims", "room_primary_slots", "lifecycle_guards",
            ]));
            const blacklist = this.blacklist.evaluateEligibility(state, token, { deferBlocked: true, now });
            if (!blacklist.eligible) fail(blacklist.code);
            validateDevice(current, state);
            if (current.leaseExpiresAt - now < WINDOW_MS) fail("PRE_SEND_WINDOW_CLOSED");
            const revision = current.revision + 1;
            if (!Number.isSafeInteger(revision)) fail("INVALID_JOB");
            const next = { ...current, revision, updatedAt: now, dispatchAuthorizedAt: now };
            result = { job: next, fence: { ...fence, revision }, input: assertEnrollInput({
              personId: snapshot.personId, deviceId: current.deviceId, grantId: current.grantId,
              sourceFileId: snapshot.fileId, validFrom: grant.validFrom, validUntil: grant.validUntil,
            }) };
            return [{ collection: JOBS, id: current._id, data: patch(next) }];
          } catch (error) {
            if (error.code === "BLACKLIST_RETRY" && attempt < 2) throw error;
            const code = KNOWN.has(error.code) ? error.code : "ADAPTER_UNAVAILABLE";
            const plan = TRANSIENT.has(code)
              ? retryPlan(current, now, code)
              : terminalPlan(current, now, code, code === "NOT_CONFIGURED" ? "CONFIGURATION_BLOCKED" : null);
            assertLogAbsent(state, ref(LOGS, plan.logId));
            result = { job: plan.job };
            return plan.writes;
          }
        }, this.#audit("发送前复核合成门禁任务"));
        return result;
      } catch (error) {
        if (error.code !== "BLACKLIST_RETRY") throw error;
      }
    }
    fail("BLACKLIST_RETRY");
  }

  async #complete(fence, kind) {
    const grantRef = ref(GRANTS, fence.grantId);
    return this.#finishFence(fence, (current, now, state) => {
      if (kind === "SUCCESS") {
        const grant = state[keyOf(grantRef)];
        const witness = snapshotVersions(current).get(keyOf(grantRef));
        const unchanged = grant && witness && dispatchVersion(grantRef, grant).revision === witness.revision &&
          grant.orgId === current.orgId && grant.state === "pending" && grant.deviceId === current.deviceId &&
          grant.credentialId === current.credentialId && grant.personId === current.dispatchSnapshot.personId &&
          grant.occupancyId === current.dispatchSnapshot.occupancyId &&
          grant.cycleId === current.dispatchSnapshot.cycleId &&
          grant.claimId === current.dispatchSnapshot.claimId && grant.slotId === current.dispatchSnapshot.slotId &&
          grant.evidenceScope === "simulated" && grant.validFrom <= now && now < grant.validUntil;
        if (!unchanged) return terminalPlan(current, now, "GRANT_INACTIVE_AFTER_SEND", "SIMULATED_RESULT_DISCARDED");
        const plan = transition(current, "succeeded", now);
        const nextGrant = { ...grant, state: "effective", revision: grant.revision + 1, updatedAt: now };
        if (!Number.isSafeInteger(nextGrant.revision)) fail("INVALID_JOB");
        plan.writes.splice(1, 0, { collection: GRANTS, id: grant._id, data: patch(nextGrant) });
        return plan;
      }
      if (kind === "RETRYABLE") return retryPlan(current, now, "PROVIDER_PRE_SEND");
      if (kind === "TERMINAL") return terminalPlan(current, now, "DEVICE_REJECTED", null, "TERMINAL");
      if (kind === "NOT_CONFIGURED") return terminalPlan(current, now, "NOT_CONFIGURED", "CONFIGURATION_BLOCKED", "NOT_CONFIGURED");
      return unknownPlan(current, now);
    }, ["succeeded", "retryable_failed", "terminal_failed", "awaiting_result"], [grantRef],
    "记录合成门禁派发结果");
  }

  async dispatch(jobId) {
    const claimed = await claimDispatchJob({
      store: this.#store, orgId: this.orgId, jobId, owner: this.#owner, now: this.#clock,
    });
    const authorized = await this.#authorize(claimed);
    if (!authorized.input) return authorized.job;
    const currentNow = safeNow(this.#clock);
    if (authorized.job.leaseExpiresAt - currentNow < WINDOW_MS) {
      return this.#finishFence(authorized.fence,
        (job, now) => terminalPlan(job, now, "PRE_SEND_WINDOW_CLOSED"), ["terminal_failed"]);
    }
    const digest = createHash("sha256").update(JSON.stringify([
      authorized.job.orgId, authorized.job._id, "enroll", authorized.job.attempts,
    ])).digest("hex");
    const context = {
      actorId: SERVICE_ACTOR, actorType: "system", permissions: new Set(["device.access.manage"]),
      orgId: this.orgId, executionMode: "test", idempotencyKey: `h3-v1:${digest}`,
    };
    let timer;
    let kind = "UNKNOWN_RESULT";
    try {
      const response = await Promise.race([
        this.#provider.enrollFace(authorized.input, context),
        new Promise((resolve) => { timer = setTimeout(resolve, WINDOW_MS); }),
      ]);
      if (response?.status === "succeeded" && typeof response.jobId === "string") kind = "SUCCESS";
    } catch (error) {
      kind = classifyProviderError(error);
    } finally { clearTimeout(timer); }
    return this.#complete({ ...authorized.fence, grantId: authorized.job.grantId }, kind);
  }

  async expire(jobId) {
    const found = await this.#store.get(JOBS, jobId, this.orgId);
    if (!found) fail("NOT_FOUND", "任务不存在", 404);
    const job = validateDispatchJob(found);
    const fence = {
      orgId: job.orgId, jobId: job._id, owner: job.leaseOwner, generation: job.leaseGeneration,
      attempts: job.attempts, revision: job.revision, expiresAt: job.leaseExpiresAt,
    };
    const reference = ref(JOBS, jobId);
    const target = logRef(job, "awaiting_result");
    let committed;
    await this.#store.transact([reference, target], (state) => {
      const now = safeNow(this.#clock);
      const current = validateDispatchJob(state[keyOf(reference)]);
      assertLeaseFence(current, fence, now, { expired: true });
      const plan = unknownPlan(current, now, "LEASE_EXPIRED_UNKNOWN");
      assertLogAbsent(state, target);
      committed = plan.job;
      return plan.writes;
    }, this.#audit("标记合成门禁租约过期"));
    return committed;
  }

  async scanExpired(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("PARAM_ERROR", "limit 非法", 400);
    const now = safeNow(this.#clock);
    const jobs = await this.#store.list(JOBS, this.orgId);
    const candidates = jobs.filter((job) => {
      try {
        validateDispatchJob(job);
        return job.state === "sending" && job.leaseExpiresAt <= now;
      } catch { return false; }
    }).slice(0, limit);
    const results = [];
    for (const job of candidates) {
      try { results.push(await this.expire(job._id)); }
      catch (error) {
        if (error.code !== "LEASE_FENCE_REJECTED") throw error;
      }
    }
    return results;
  }

  async requeue(jobId, expectedRevision, actor = null) {
    const found = await this.#store.get(JOBS, jobId, this.orgId);
    if (!found) fail("NOT_FOUND", "任务不存在", 404);
    const job = validateDispatchJob(found);
    const jobRef = ref(JOBS, jobId);
    const target = logRef(job, "queued");
    const memberRef = actor ? ref("org_memberships", actor.membershipId) : null;
    const orgRef = ref("organizations", this.orgId);
    let committed;
    await this.#store.transact(unique([jobRef, target, ...(memberRef ? [memberRef, orgRef] : [])]), (state) => {
      const now = safeNow(this.#clock);
      const current = validateDispatchJob(state[keyOf(jobRef)]);
      if (actor) {
        const member = state[keyOf(memberRef)];
        if (state[keyOf(orgRef)]?.status !== "active" || member?.orgId !== this.orgId ||
            member.status !== "active" || (member.principalId ?? member.actorId ?? member._id) !== actor.actorId ||
            !member.permissions?.includes("device.operation.retry")) fail("FORBIDDEN", "无重试权限", 403);
      }
      if (current.state !== "retryable_failed" || current.revision !== expectedRevision ||
          current.revision !== job.revision || current.attempts >= 4 ||
          !Number.isSafeInteger(current.nextAttemptAt)) fail("INVALID_JOB");
      if (now < current.nextAttemptAt) fail("RETRY_NOT_DUE");
      const revision = current.revision + 1;
      const next = { ...current, state: "queued", revision, updatedAt: now };
      const log = {
        orgId: current.orgId, jobId, action: "enroll", fromState: current.state, state: "queued",
        actorType: actor ? "user" : "system", actorId: actor?.actorId ?? SERVICE_ACTOR,
        at: now, revision, attempt: current.attempts, leaseGeneration: current.leaseGeneration,
        evidenceScope: "simulated", errorKind: null, reasonCode: null, alertCode: null,
      };
      assertLogAbsent(state, target);
      committed = next;
      return [{ collection: JOBS, id: jobId, data: patch(next) },
        { collection: LOGS, id: target.id, data: log }];
    }, this.#audit("重排合成门禁任务", actor?.actorId, actor ? "user" : "system"));
    return committed;
  }
}
