import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { failCode } from "../model.mjs";
import { LocalStore } from "../store.mjs";
import {
  assertSafeInt, deterministicLogId, deviceDigestDomainKey, deviceDigestDomainVersionKey,
  digestDomainMatchesDevice, grantSlotKey, leasePatch, ownerClaimMatchesDevice,
  validateAccessDeviceRecord, validateGrantSlotRecord, validateOwnerClaimRecord,
} from "./collections.mjs";
import { assertEnrollInput, assertOpaqueId } from "./dto.mjs";
import { snapshotEligibility, uniqueRefs, validateEligibility } from "./eligibility.mjs";
import { MockFaceAccessProvider, classifyProviderError } from "./mock-provider.mjs";
import { prepareGrantEligibility } from "./qualification.mjs";
import { assertTransition } from "./state.mjs";
import {
  DISPATCH_SNAPSHOTS, keyOf, readRef, ref, snapshotIdFor, snapshotIsBound, versionRef,
} from "./dispatch-snapshot.mjs";

const JOBS = "device_operation_jobs";
const LOGS = "device_operation_logs";
const SERVICE_ACTOR = "h3-mock-dispatch";
const DELAYS = [30_000, 120_000, 600_000];
const WINDOW = 10_000;
const LEASE = 60_000;
const FENCE_FIELDS = ["orgId", "_id", "revision", "leaseOwner", "leaseGeneration", "attempts", "leaseExpiresAt"];
const JOB_FIELDS = new Set([
  "_id", "orgId", "revision", "credentialId", "grantId", "deviceId", "action", "state",
  "executionMode", "provider", "evidenceScope", "snapshotId", "attempts", "leaseGeneration",
  "leaseOwner", "leaseExpiresAt", "dispatchAuthorizedAt", "nextAttemptAt", "result", "createdAt", "updatedAt",
]);
const REASONS = new Set([
  "GRANT_INACTIVE", "CREDENTIAL_CHANGED", "FILE_BINDING_CHANGED", "FORBIDDEN", "NOT_FOUND",
  "REVISION_CONFLICT", "IDENTITY_CONFLICT", "IDENTITY_NOT_APPROVED", "USER_DISABLED",
  "INVALID_STATE", "ROOM_ARCHIVED", "CATALOG_ARCHIVED", "SPONSOR_INACTIVE", "DUPLICATE_OCCUPANCY",
  "BLACKLIST_DENIED", "BLACKLIST_REVIEW_REQUIRED", "ADAPTER_UNAVAILABLE",
  "DEVICE_CLAIM_INVALID", "DEVICE_CLAIM_CONFLICT", "DOMAIN_INCOMPLETE",
  "DEVICE_DIGEST_CONFIG_CHANGED", "GRANT_SLOT_CONFLICT", "PRE_SEND_WINDOW_CLOSED", "NOT_CONFIGURED",
]);

const reject = (code, status = 409) => failCode(code, "派发操作被拒绝", status);
const denyUnless = (condition, code) => { if (!condition) reject(code); };

function assertJob(job, orgId) {
  if (!job || job.orgId !== orgId) reject("NOT_FOUND", 404);
  try {
    for (const key of Object.keys(job)) denyUnless(JOB_FIELDS.has(key), "INVALID_JOB");
    for (const field of ["_id", "orgId", "credentialId", "grantId", "deviceId"]) assertOpaqueId(job[field], field);
    for (const field of ["createdAt", "updatedAt", "attempts"]) assertSafeInt(job[field], field);
    assertSafeInt(job.revision, "revision", { min: 1 });
    // 后续迁移还需 revision+1；没有余量时在领取/回写前就失败关闭，避免
    // 在构造日志 ref 时溢出成内部 PARAM_ERROR。
    denyUnless(job.revision <= Number.MAX_SAFE_INTEGER - 2, "INVALID_JOB");
    denyUnless(job.attempts <= 4 && job.action === "enroll" && job.provider === "mock" &&
      job.executionMode === "test" && job.evidenceScope === "simulated", "INVALID_JOB");
    if (job.snapshotId === undefined) reject("DISPATCH_SNAPSHOT_REQUIRED");
    denyUnless(job.snapshotId === snapshotIdFor(job._id) &&
      Object.keys(job).length === JOB_FIELDS.size, "INVALID_JOB");
    assertSafeInt(job.leaseGeneration, "leaseGeneration");
    denyUnless(job.leaseGeneration === job.attempts, "INVALID_JOB");
    for (const field of ["leaseExpiresAt", "dispatchAuthorizedAt", "nextAttemptAt"]) {
      if (job[field] !== null) assertSafeInt(job[field], field);
    }
    if (job.state === "sending") {
      assertOpaqueId(job.leaseOwner, "leaseOwner");
      denyUnless(job.leaseExpiresAt !== null && job.attempts > 0 && job.nextAttemptAt === null &&
        (job.dispatchAuthorizedAt === null || job.dispatchAuthorizedAt < job.leaseExpiresAt) &&
        job.result === null, "INVALID_JOB");
    } else {
      denyUnless(job.leaseOwner === null && job.leaseExpiresAt === null &&
        job.dispatchAuthorizedAt === null, "INVALID_JOB");
    }
  } catch (error) {
    reject(error.code === "DISPATCH_SNAPSHOT_REQUIRED" ? error.code : "INVALID_JOB");
  }
  return job;
}

function increment(number, delta = 1) {
  const next = number + delta;
  assertSafeInt(next, "counter");
  return next;
}

function checkFence(job, fence, now, expired = false) {
  if (!job || job.state !== "sending" || FENCE_FIELDS.some((field) => job[field] !== fence[field]) ||
      (expired ? now < job.leaseExpiresAt : now >= job.leaseExpiresAt)) {
    reject("LEASE_FENCE_REJECTED");
  }
}

function transition(job, state, at, patch, actor = { actorId: SERVICE_ACTOR, actorType: "system" }) {
  assertTransition("job", job.state, state);
  const revision = increment(job.revision);
  const data = { ...patch, state, revision, updatedAt: at };
  const id = deterministicLogId(job._id, state, revision);
  const log = {
    orgId: job.orgId, jobId: job._id, action: "enroll", fromState: job.state, state,
    actorId: actor.actorId, actorType: actor.actorType, at, revision,
    attempt: data.attempts ?? job.attempts, leaseGeneration: data.leaseGeneration ?? job.leaseGeneration,
    evidenceScope: "simulated", errorKind: data.result?.errorKind ?? null,
    reasonCode: data.result?.reasonCode ?? null, alertCode: patch.alertCode ?? null,
  };
  delete data.alertCode;
  return { job: { ...job, ...data }, writes: [
    { ...ref(JOBS, job._id), data }, { ...ref(LOGS, id), data: log },
  ] };
}

function finish(job, now, state, errorKind = null, reasonCode = null, alertCode = null) {
  return transition(job, state, now, {
    leaseOwner: null, leaseExpiresAt: null, dispatchAuthorizedAt: null,
    nextAttemptAt: state === "retryable_failed" ? increment(now, DELAYS[job.attempts - 1]) : null,
    result: { attempt: job.attempts, outcome: state, errorKind, reasonCode, finishedAt: now },
    alertCode,
  });
}

function resultWrites(job, now, kind) {
  switch (kind) {
    case "SUCCESS": return finish(job, now, "succeeded");
    case "RETRYABLE":
      return job.attempts < 4
        ? finish(job, now, "retryable_failed", kind, "PROVIDER_PRE_SEND")
        : finish(job, now, "terminal_failed", kind, "RETRY_EXHAUSTED", "RETRY_EXHAUSTED");
    case "TERMINAL": return finish(job, now, "terminal_failed", kind, "DEVICE_REJECTED");
    case "NOT_CONFIGURED":
      return finish(job, now, "terminal_failed", kind, kind, "CONFIGURATION_BLOCKED");
    default: return finish(job, now, "awaiting_result", "UNKNOWN_RESULT", "RESULT_UNKNOWN", "RESULT_UNKNOWN");
  }
}

function checkVersions(snapshot, state, collections, errorCode) {
  for (const item of snapshot.versions) {
    if (!collections.includes(item.collection)) continue;
    const current = versionRef(item, readRef(state, item));
    denyUnless(current.present === item.present && current.revision === item.revision &&
      current.epoch === item.epoch && current.keyVersion === item.keyVersion, errorCode);
  }
}

function checkDevice(snapshot, state, job) {
  const device = readRef(state, ref("access_devices", job.deviceId));
  const claim = readRef(state, ref("device_claims", snapshot.claimId));
  const slot = readRef(state, ref("grant_slot_claims", snapshot.slotId));
  try { validateAccessDeviceRecord(device); } catch { reject("DEVICE_CLAIM_INVALID"); }
  denyUnless(device.orgId === job.orgId && device.ownerOrgId === job.orgId, "DEVICE_CLAIM_CONFLICT");
  denyUnless(device.claimId === snapshot.claimId, "DEVICE_CLAIM_INVALID");
  denyUnless(device.status === "active" && device.capabilities.face, "INVALID_STATE");
  const domain = digestDomainMatchesDevice(
    readRef(state, ref("device_digest_domains", snapshot.domainHeadId)),
    readRef(state, ref("device_digest_domains", snapshot.domainVersionId)), device,
  );
  denyUnless(domain.ok && snapshot.domainHeadId === deviceDigestDomainKey(device) &&
    snapshot.domainVersionId === deviceDigestDomainVersionKey({ ...device, version: device.keyVersion }),
  domain.ok ? "DEVICE_DIGEST_CONFIG_CHANGED" : domain.code);
  try { validateOwnerClaimRecord(claim); } catch { reject("DEVICE_CLAIM_INVALID"); }
  denyUnless(claim.ownerOrgId === job.orgId, "DEVICE_CLAIM_CONFLICT");
  denyUnless(claim.state === "active" && ownerClaimMatchesDevice(claim, device, job.deviceId), "DEVICE_CLAIM_INVALID");
  try { validateGrantSlotRecord(slot); } catch { reject("GRANT_SLOT_CONFLICT"); }
  denyUnless(slot.orgId === job.orgId && slot.state === "active" && slot.activeClaimId === job.grantId &&
    slot.deviceId === job.deviceId && slot.personId === snapshot.personId && slot.cycleId === snapshot.cycleId &&
    snapshot.slotId === grantSlotKey({ ...slot, deviceId: job.deviceId }), "GRANT_SLOT_CONFLICT");
  checkVersions(snapshot, state, ["access_devices", "device_claims"], "DEVICE_CLAIM_INVALID");
  checkVersions(snapshot, state, ["device_digest_domains"], "DEVICE_DIGEST_CONFIG_CHANGED");
  checkVersions(snapshot, state, ["grant_slot_claims"], "GRANT_SLOT_CONFLICT");
}

export class MockFaceDispatcher {
  #owner = randomUUID();
  #provider;
  #store;
  #runtimeConfig;

  constructor({
    store, orgId, files, blacklist, provider, executionMode = "test", runtimeConfig = null,
  }) {
    // 合成派发只信任单一 LocalStore：其串行队列在整库快照上完成读到写的隔离，
    // 缺席读也受同一克隆保护；时钟由 faceDispatchTime() 提供单调安全整数。
    // 其他适配器即使声明同名方法也没有可验证的缺失读保护，直接拒绝启用。
    denyUnless(store instanceof LocalStore &&
      typeof store.transactFaceDispatch === "function" &&
      typeof store.faceDispatchTime === "function", "ADAPTER_UNAVAILABLE");
    denyUnless(provider instanceof MockFaceAccessProvider && executionMode === "test", "NOT_CONFIGURED");
    denyUnless(files?.store === store && files.orgId === orgId && blacklist?.store === store && blacklist.orgId === orgId, "ADAPTER_UNAVAILABLE");
    denyUnless(runtimeConfig === null || typeof runtimeConfig === "function", "ADAPTER_UNAVAILABLE");
    assertOpaqueId(orgId, "orgId");
    this.#store = store;
    this.#provider = provider;
    this.#runtimeConfig = runtimeConfig;
    this.executionMode = executionMode;
    this.orgId = orgId;
    this.files = files;
    this.blacklist = blacklist;
  }

  #configured() {
    const current = this.#runtimeConfig
      ? this.#runtimeConfig()
      : { executionMode: this.executionMode, provider: this.#provider };
    return Boolean(current) && current.executionMode === "test" &&
      current.provider instanceof MockFaceAccessProvider;
  }

  async #transact(refs, build) {
    let committed;
    await this.#store.transactFaceDispatch(uniqueRefs(refs), (state, now) => {
      const plan = build(state, now);
      committed = plan.value;
      return plan.writes;
    });
    return committed;
  }

  #logRefs(job, states) {
    return states.map((state) => ref(LOGS, deterministicLogId(job._id, state, increment(job.revision))));
  }

  async #readJob(id) {
    assertOpaqueId(id, "jobId");
    return assertJob(await this.#store.get(JOBS, id, this.orgId), this.orgId);
  }

  async #claim(job) {
    const jobRef = ref(JOBS, job._id);
    const snapshotRef = ref(DISPATCH_SNAPSHOTS, job.snapshotId);
    return this.#transact([jobRef, snapshotRef, ...this.#logRefs(job, ["sending"])], (state, now) => {
      const current = assertJob(readRef(state, jobRef), this.orgId);
      denyUnless(current.state === "queued" && current.revision === job.revision && current.attempts < 4, "INVALID_JOB");
      denyUnless((current.attempts === 0 && current.nextAttemptAt === null && current.result === null) ||
        (current.attempts > 0 && current.nextAttemptAt !== null &&
          current.result?.errorKind === "RETRYABLE" && current.result.attempt === current.attempts), "INVALID_JOB");
      denyUnless(current.nextAttemptAt === null || now >= current.nextAttemptAt, "RETRY_NOT_DUE");
      const snapshot = readRef(state, snapshotRef);
      denyUnless(snapshotIsBound(snapshot, current), "DISPATCH_SNAPSHOT_REQUIRED");
      const patch = leasePatch({ owner: this.#owner, expiresAt: increment(now, LEASE),
        attempts: current.attempts, revision: current.revision, now });
      const sending = transition(current, "sending", now, {
        ...patch, leaseGeneration: increment(current.leaseGeneration), nextAttemptAt: null, result: null,
      });
      return { writes: sending.writes, value: { job: sending.job, snapshot } };
    });
  }

  #grant(state, job, snapshot, now) {
    const grant = readRef(state, ref("device_access_grants", job.grantId));
    denyUnless(grant?.orgId === job.orgId && grant.state === "pending" &&
      grant.evidenceScope === "simulated" && Number.isSafeInteger(grant.validFrom) &&
      grant.validFrom >= 0 && Number.isSafeInteger(grant.validUntil) &&
      grant.validFrom <= now && now < grant.validUntil, "GRANT_INACTIVE");
    denyUnless(grant.personId === snapshot.personId && grant.occupancyId === snapshot.occupancyId &&
      grant.cycleId === snapshot.cycleId && grant.deviceId === job.deviceId &&
      grant.credentialId === job.credentialId && grant.claimId === snapshot.claimId &&
      grant.slotId === snapshot.slotId, "GRANT_INACTIVE");
    checkVersions(snapshot, state, ["device_access_grants"], "GRANT_INACTIVE");
    const credential = readRef(state, ref("face_credentials", job.credentialId));
    denyUnless(credential?.orgId === job.orgId && credential.reviewState === "approved" &&
      credential.personId === snapshot.personId && credential.sourceFileId === snapshot.fileId, "CREDENTIAL_CHANGED");
    checkVersions(snapshot, state, ["face_credentials"], "CREDENTIAL_CHANGED");
    try {
      this.files.assertBinding(state, { fileId: snapshot.fileId, revision: credential.sourceFileRevision });
      checkVersions(snapshot, state, ["file_assets"], "FILE_BINDING_CHANGED");
    } catch {
      reject("FILE_BINDING_CHANGED");
    }
    const org = readRef(state, ref("organizations", job.orgId));
    const member = readRef(state, ref("org_memberships", snapshot.membershipId));
    denyUnless(org?.status === "active" && member?.orgId === job.orgId && member.status === "active" &&
      (member.principalId ?? member.actorId ?? member._id) === snapshot.creatorActorId &&
      Array.isArray(member.permissions) && member.permissions.includes("device.access.manage"), "FORBIDDEN");
    checkVersions(snapshot, state, ["organizations", "org_memberships"], "FORBIDDEN");
    return grant;
  }

  async #authorize(job, snapshot) {
    const fixed = new Set(snapshot.versions.map(keyOf));
    const store = { get: (collection, id, orgId) =>
      fixed.has(keyOf(ref(collection, id))) ? this.#store.get(collection, id, orgId) : null };
    const jobRef = ref(JOBS, job._id);
    const snapshotRef = ref(DISPATCH_SNAPSHOTS, job.snapshotId);
    for (let attempt = 0; attempt < 3; attempt++) {
      let planned, token, qualificationError, blacklistError;
      const grant = await this.#store.get("device_access_grants", job.grantId, job.orgId);
      const request = {
        orgId: job.orgId, personId: snapshot.personId, occupancyId: snapshot.occupancyId,
        identityApplicationId: snapshot.identityApplicationId, cycleId: snapshot.cycleId,
        validFrom: grant?.validFrom, validUntil: grant?.validUntil, restriction: snapshot.restriction,
      };
      try { planned = await prepareGrantEligibility(store, request); }
      catch (error) { qualificationError = error; }
      try { token = await this.blacklist.prepareEligibility(request); }
      catch (error) { blacklistError = error; }
      const refs = [jobRef, snapshotRef, ...snapshot.versions.map(({ collection, id }) => ref(collection, id)),
        ...this.#logRefs(job, ["terminal_failed"]), ...(token?.refs ?? [])];
      if (uniqueRefs(refs).length > 90) {
        const failed = await this.#finish(job, (current, now) =>
          finish(current, now, "terminal_failed", "PRE_SEND_BLOCKED", "ADAPTER_UNAVAILABLE"), ["terminal_failed"]);
        return { job: failed };
      }
      try {
        return await this.#transact(refs, (state, now) => {
          const current = readRef(state, jobRef);
          checkFence(current, job, now);
          denyUnless(current.dispatchAuthorizedAt === null, "LEASE_FENCE_REJECTED");
          try {
            denyUnless(isDeepStrictEqual(snapshot, readRef(state, snapshotRef)), "ADAPTER_UNAVAILABLE");
            const liveGrant = this.#grant(state, current, snapshot, now);
            if (qualificationError) throw qualificationError;
            denyUnless(planned.refs.every((reference) => fixed.has(keyOf(reference))), "REVISION_CONFLICT");
            const liveRequest = {
              ...planned.request, validFrom: liveGrant.validFrom, validUntil: liveGrant.validUntil,
            };
            const verdict = validateEligibility(snapshotEligibility(state, liveRequest), liveRequest, now);
            if (!verdict.eligible && verdict.code !== "BLACKLIST_RETRY") reject(verdict.code);
            checkVersions(snapshot, state, [
              "persons", "users", "identity_applications", "occupancies", "occupancy_cycles",
              "rooms", "property_catalog", "unique_claims", "room_primary_slots", "lifecycle_guards",
            ], "REVISION_CONFLICT");
            denyUnless(verdict.eligible, verdict.code);
            if (blacklistError) throw blacklistError;
            const eligibility = this.blacklist.evaluateEligibility(state, token, { deferBlocked: true, now });
            denyUnless(eligibility.eligible, eligibility.code);
            checkDevice(snapshot, state, current);
            denyUnless(current.leaseExpiresAt - now >= WINDOW, "PRE_SEND_WINDOW_CLOSED");
            const input = assertEnrollInput({
              personId: snapshot.personId, deviceId: current.deviceId, grantId: current.grantId,
              sourceFileId: snapshot.fileId, validFrom: liveGrant.validFrom, validUntil: liveGrant.validUntil,
            });
            const data = { dispatchAuthorizedAt: now, updatedAt: now, revision: increment(current.revision) };
            return { writes: [{ ...jobRef, data }], value: { job: { ...current, ...data }, input } };
          } catch (error) {
            // 租约/fence 失败必须在构造任何写计划前退出（零写、零日志、零 audit），
            // 不能被下面的“确定性 pre-send 拒绝”路径吞成 terminal_failed。
            if (error.code === "LEASE_FENCE_REJECTED") throw error;
            if (error.code === "BLACKLIST_RETRY" && attempt < 2) throw error;
            const code = REASONS.has(error.code) ? error.code : "ADAPTER_UNAVAILABLE";
            const result = finish(current, now, "terminal_failed", "PRE_SEND_BLOCKED", code);
            return { writes: result.writes, value: { job: result.job } };
          }
        });
      } catch (error) {
        if (error.code !== "BLACKLIST_RETRY") throw error;
      }
    }
    reject("ADAPTER_UNAVAILABLE", 503);
  }

  async #finish(job, makeResult, states, expired = false) {
    const reference = ref(JOBS, job._id);
    return this.#transact([reference, ...this.#logRefs(job, states)], (state, now) => {
      const current = readRef(state, reference);
      checkFence(current, job, now, expired);
      const result = makeResult(current, now);
      return { writes: result.writes, value: result.job };
    });
  }

  async dispatch(jobId) {
    const { job, snapshot } = await this.#claim(await this.#readJob(jobId));
    // 环境配置在领取后、任何资格/Provider 工作前重新采样；切换为 live 或非 Mock
    // 时只写一条明确终态，Provider 0 次。
    if (!this.#configured()) {
      return this.#finish(job, (record, now) =>
        finish(record, now, "terminal_failed", "NOT_CONFIGURED", "NOT_CONFIGURED", "CONFIGURATION_BLOCKED"),
      ["terminal_failed"]);
    }
    const authorized = await this.#authorize(job, snapshot);
    if (!authorized.input) return authorized.job;
    const current = authorized.job;
    if (current.leaseExpiresAt - this.#store.faceDispatchTime() < WINDOW) {
      return this.#finish(current, (record, now) =>
        finish(record, now, "terminal_failed", "PRE_SEND_BLOCKED", "PRE_SEND_WINDOW_CLOSED"), ["terminal_failed"]);
    }
    const key = createHash("sha256").update(JSON.stringify([current.orgId, current._id, "enroll", current.attempts])).digest("hex");
    const context = {
      actorId: SERVICE_ACTOR, actorType: "system", permissions: new Set(["device.access.manage"]),
      orgId: current.orgId, executionMode: "test", idempotencyKey: `h3-v1:${key}`,
    };
    let timer;
    let kind = "UNKNOWN_RESULT";
    try {
      const response = await Promise.race([
        this.#provider.enrollFace(authorized.input, context),
        new Promise((resolve) => { timer = setTimeout(resolve, WINDOW); }),
      ]);
      if (response?.status === "succeeded" && typeof response.jobId === "string") kind = "SUCCESS";
    } catch (error) {
      if (error?.code === "NOT_CONFIGURED" || error?.code === "UNKNOWN_RESULT" ||
          (error?.phase === "pre_send" && ["DEVICE_OFFLINE", "PROVIDER_ERROR"].includes(error.code)) ||
          (error?.phase === "post_send" && error.code === "DEVICE_REJECTED")) {
        kind = classifyProviderError(error);
      }
    } finally {
      clearTimeout(timer);
    }
    return this.#finish(current, (record, now) => resultWrites(record, now, kind),
      ["succeeded", "retryable_failed", "terminal_failed", "awaiting_result"]);
  }

  #expire(job) {
    return this.#finish(job, (current, now) =>
      finish(current, now, "awaiting_result", "UNKNOWN_RESULT", "LEASE_EXPIRED_UNKNOWN", "RESULT_UNKNOWN"),
    ["awaiting_result"], true);
  }

  async expire(jobId) {
    return this.#expire(await this.#readJob(jobId));
  }

  async scanExpired(limit = 50) {
    assertSafeInt(limit, "limit", { min: 1 });
    denyUnless(limit <= 100, "INVALID_JOB");
    const now = this.#store.faceDispatchTime();
    const jobs = await this.#store.list(JOBS, this.orgId);
    const candidates = jobs.filter((job) => job.state === "sending" &&
      Number.isSafeInteger(job.leaseExpiresAt) && job.leaseExpiresAt <= now);
    const results = [];
    for (const job of candidates.slice(0, limit)) {
      try {
        const result = await this.#expire(assertJob(job, this.orgId));
        results.push({ jobId: result._id, state: result.state });
      } catch (error) {
        if (!["LEASE_FENCE_REJECTED", "INVALID_JOB", "DISPATCH_SNAPSHOT_REQUIRED"].includes(error.code)) throw error;
        results.push({ jobId: job._id, code: error.code });
      }
    }
    return results;
  }

  async requeue(jobId, expectedRevision, actor = null) {
    const job = await this.#readJob(jobId);
    const reference = ref(JOBS, jobId);
    const memberRef = actor && ref("org_memberships", assertOpaqueId(actor.membershipId, "membershipId"));
    const orgRef = ref("organizations", this.orgId);
    return this.#transact([reference, ...this.#logRefs(job, ["queued"]),
      ...(memberRef ? [memberRef, orgRef] : [])], (state, now) => {
      const current = assertJob(readRef(state, reference), this.orgId);
      if (memberRef) {
        assertOpaqueId(actor.actorId, "actorId");
        const member = readRef(state, memberRef);
        denyUnless(readRef(state, orgRef)?.status === "active" && member?.orgId === this.orgId &&
          member.status === "active" && (member.principalId ?? member.actorId ?? member._id) === actor.actorId &&
          Array.isArray(member.permissions) && member.permissions.includes("device.operation.retry"), "FORBIDDEN");
      }
      denyUnless(current.state === "retryable_failed" && current.revision === expectedRevision &&
        current.revision === job.revision && current.attempts > 0 && current.attempts < 4 &&
        current.result?.errorKind === "RETRYABLE" && current.result.attempt === current.attempts, "INVALID_JOB");
      denyUnless(current.nextAttemptAt !== null && now >= current.nextAttemptAt, "RETRY_NOT_DUE");
      const result = transition(current, "queued", now, {}, actor ? {
        actorId: actor.actorId, actorType: "user",
      } : undefined);
      return { writes: result.writes, value: result.job };
    });
  }
}
