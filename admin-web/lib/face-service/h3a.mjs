/** H3-a: embedded dispatch snapshot and lease/fence helpers. No Provider calls. */
import { HttpError } from "../model.mjs";
import { LocalStore } from "../store.mjs";
import {
  assertBoundedId, assertSafeInt, deterministicLogId, leasePatch,
} from "./collections.mjs";

const SNAPSHOT_FIELDS = new Set([
  "schemaVersion", "createdAt", "creatorActorId", "membershipId",
  "identityApplicationId", "personId", "occupancyId", "cycleId", "fileId",
  "claimId", "slotId", "domainHeadId", "domainVersionId", "restriction", "versions",
]);
const VERSION_FIELDS = new Set(["collection", "id", "present", "revision", "epoch", "keyVersion"]);
const VERSION_COLLECTIONS = new Set([
  "organizations", "org_memberships", "persons", "users", "identity_applications",
  "occupancies", "occupancy_cycles", "rooms", "property_catalog", "unique_claims",
  "room_primary_slots", "lifecycle_guards", "device_access_grants", "face_credentials",
  "file_assets", "access_devices", "device_claims", "device_digest_domains", "grant_slot_claims",
]);
const JOB_FIELDS = new Set([
  "_id", "orgId", "revision", "credentialId", "grantId", "deviceId", "action", "state",
  "executionMode", "provider", "evidenceScope", "dispatchSnapshot", "attempts",
  "leaseGeneration", "leaseOwner", "leaseExpiresAt", "dispatchAuthorizedAt",
  "nextAttemptAt", "result", "createdAt", "updatedAt",
]);
const keyOf = ({ collection, id }) => `${collection}/${id}`;
const fail = (code, message, status = 409) => { throw new HttpError(status, message, code); };
const snapshotId = (value, field) => {
  assertBoundedId(value, field);
  if (value.includes("/")) fail("DISPATCH_SNAPSHOT_REQUIRED", `${field} 不得包含路径分隔符`);
  return value;
};

function exactFields(record, allowed) {
  return record && typeof record === "object" && !Array.isArray(record) &&
    Object.keys(record).length === allowed.size && Object.keys(record).every((key) => allowed.has(key));
}

export function dispatchVersion(reference, record) {
  const version = {
    collection: reference.collection,
    id: reference.id,
    present: Boolean(record),
    revision: record?.revision ?? null,
    epoch: record?.epoch ?? null,
    keyVersion: record?.keyVersion ?? null,
  };
  snapshotId(version.collection, "version.collection");
  snapshotId(version.id, "version.id");
  for (const [field, min] of [["revision", 1], ["epoch", 0], ["keyVersion", 1]]) {
    if (version[field] !== null) assertSafeInt(version[field], `version.${field}`, { min });
  }
  if (version.present && version.revision === null && version.epoch === null && version.keyVersion === null) {
    fail("DISPATCH_SNAPSHOT_REQUIRED", "可变记录缺少版本见证");
  }
  return version;
}

export function createDispatchSnapshot({
  now, actor, request, state, refs, credential, fileId, claimId, slotId,
  domainHeadId, domainVersionId, grantRecord, grantId, slotRecord,
}) {
  assertSafeInt(now, "snapshot.createdAt");
  const selected = new Map();
  for (const reference of refs) {
    if (!VERSION_COLLECTIONS.has(reference.collection)) continue;
    selected.set(keyOf(reference), dispatchVersion(reference, state[keyOf(reference)]));
  }
  selected.set(`device_access_grants/${grantId}`, dispatchVersion(
    { collection: "device_access_grants", id: grantId }, grantRecord,
  ));
  selected.set(`grant_slot_claims/${slotId}`, dispatchVersion(
    { collection: "grant_slot_claims", id: slotId }, slotRecord,
  ));
  const snapshot = {
    schemaVersion: 1,
    createdAt: now,
    creatorActorId: actor.actorId,
    membershipId: actor.membershipId,
    identityApplicationId: request.identityApplicationId,
    personId: credential.personId,
    occupancyId: request.occupancyId,
    cycleId: request.cycleId,
    fileId,
    claimId,
    slotId,
    domainHeadId,
    domainVersionId,
    restriction: "occupancy.activate",
    versions: [...selected.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b))),
  };
  validateDispatchSnapshot(snapshot);
  return snapshot;
}

export function validateDispatchSnapshot(snapshot, job = null) {
  if (!exactFields(snapshot, SNAPSHOT_FIELDS) || snapshot.schemaVersion !== 1 ||
      snapshot.restriction !== "occupancy.activate" || !Array.isArray(snapshot.versions)) {
    fail("DISPATCH_SNAPSHOT_REQUIRED", "派发快照结构非法");
  }
  assertSafeInt(snapshot.createdAt, "snapshot.createdAt");
  for (const field of [
    "creatorActorId", "membershipId", "identityApplicationId", "personId", "occupancyId",
    "cycleId", "fileId", "claimId", "slotId", "domainHeadId", "domainVersionId",
  ]) snapshotId(snapshot[field], `snapshot.${field}`);
  const seen = new Set();
  for (const item of snapshot.versions) {
    if (!exactFields(item, VERSION_FIELDS) || !VERSION_COLLECTIONS.has(item.collection) ||
        typeof item.present !== "boolean" || seen.has(keyOf(item))) {
      fail("DISPATCH_SNAPSHOT_REQUIRED", "派发快照版本见证非法");
    }
    seen.add(keyOf(item));
    const canonical = dispatchVersion(
      { collection: item.collection, id: item.id }, item.present ? item : null,
    );
    if (["present", "revision", "epoch", "keyVersion"].some((field) => canonical[field] !== item[field])) {
      fail("DISPATCH_SNAPSHOT_REQUIRED", "派发快照版本见证不规范");
    }
  }
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 16 * 1024) {
    fail("PARAM_ERROR", "派发快照超过 16 KiB", 400);
  }
  if (job) requireSnapshotBindings(snapshot, job);
  return snapshot;
}

function requireSnapshotBindings(snapshot, job) {
  const required = [
    ["organizations", job.orgId],
    ["org_memberships", snapshot.membershipId],
    ["persons", snapshot.personId],
    ["identity_applications", snapshot.identityApplicationId],
    ["occupancies", snapshot.occupancyId],
    ["occupancy_cycles", snapshot.cycleId],
    ["device_access_grants", job.grantId],
    ["face_credentials", job.credentialId],
    ["file_assets", snapshot.fileId],
    ["access_devices", job.deviceId],
    ["device_claims", snapshot.claimId],
    ["grant_slot_claims", snapshot.slotId],
    ["device_digest_domains", snapshot.domainHeadId],
    ["device_digest_domains", snapshot.domainVersionId],
  ];
  const versions = new Map(snapshot.versions.map((item) => [keyOf(item), item]));
  for (const [collection, id] of required) {
    const witness = versions.get(`${collection}/${id}`);
    if (!witness?.present) fail("DISPATCH_SNAPSHOT_REQUIRED", `派发快照缺少 ${collection} 版本见证`);
  }
}

function validateResult(result, attempts, state) {
  const fields = new Set(["attempt", "outcome", "errorKind", "reasonCode", "finishedAt"]);
  if (!exactFields(result, fields) || result.attempt !== attempts || result.outcome !== state) {
    fail("INVALID_JOB", "任务结果结构非法");
  }
  assertSafeInt(result.finishedAt, "result.finishedAt");
  if (result.errorKind !== null) assertBoundedId(result.errorKind, "result.errorKind");
  if (result.reasonCode !== null) assertBoundedId(result.reasonCode, "result.reasonCode");
}

export function validateDispatchJob(job, { requireSnapshot = true } = {}) {
  if (!job || typeof job !== "object" || Array.isArray(job)) fail("INVALID_JOB", "任务非法");
  if (requireSnapshot && job.dispatchSnapshot === undefined) {
    fail("DISPATCH_SNAPSHOT_REQUIRED", "旧任务缺少派发快照");
  }
  if (job.dispatchSnapshot !== undefined) validateDispatchSnapshot(job.dispatchSnapshot, job);
  if (!exactFields(job, JOB_FIELDS)) fail("INVALID_JOB", "任务字段不完整或包含未知字段");
  for (const field of ["_id", "orgId", "credentialId", "grantId", "deviceId"]) {
    assertBoundedId(job[field], `job.${field}`);
  }
  assertSafeInt(job.revision, "job.revision", { min: 1 });
  assertSafeInt(job.attempts, "job.attempts");
  assertSafeInt(job.leaseGeneration, "job.leaseGeneration");
  assertSafeInt(job.createdAt, "job.createdAt");
  assertSafeInt(job.updatedAt, "job.updatedAt");
  if (job.revision > Number.MAX_SAFE_INTEGER - 2 || job.attempts > 4) fail("INVALID_JOB", "任务计数越界");
  if (job.action !== "enroll" || job.executionMode !== "test" || job.provider !== "mock" ||
      job.evidenceScope !== "simulated") fail("INVALID_JOB", "任务不属于 H3 合成派发");
  if (job.leaseGeneration !== job.attempts) fail("INVALID_JOB", "leaseGeneration 与 attempts 不一致");
  const noLease = job.leaseOwner === null && job.leaseExpiresAt === null && job.dispatchAuthorizedAt === null;
  if (job.state === "queued") {
    if (!noLease || (job.attempts === 0
      ? job.leaseGeneration !== 0 || job.nextAttemptAt !== null || job.result !== null
      : job.attempts >= 4 || !Number.isSafeInteger(job.nextAttemptAt) || !job.result)) {
      fail("INVALID_JOB", "queued 状态字段非法");
    }
    if (job.attempts > 0) validateResult(job.result, job.attempts, "retryable_failed");
  } else if (job.state === "sending") {
    assertBoundedId(job.leaseOwner, "job.leaseOwner");
    assertSafeInt(job.leaseExpiresAt, "job.leaseExpiresAt", { min: 1 });
    if (job.attempts < 1 || job.nextAttemptAt !== null || job.result !== null ||
        (job.dispatchAuthorizedAt !== null &&
          (!Number.isSafeInteger(job.dispatchAuthorizedAt) || job.dispatchAuthorizedAt >= job.leaseExpiresAt))) {
      fail("INVALID_JOB", "sending 状态字段非法");
    }
  } else if (job.state === "retryable_failed") {
    if (!noLease || job.attempts < 1 || job.attempts >= 4 || !Number.isSafeInteger(job.nextAttemptAt)) {
      fail("INVALID_JOB", "retryable_failed 状态字段非法");
    }
    validateResult(job.result, job.attempts, job.state);
  } else if (["succeeded", "terminal_failed", "awaiting_result"].includes(job.state)) {
    if (!noLease || job.attempts < 1 || job.nextAttemptAt !== null) fail("INVALID_JOB", "终态字段非法");
    validateResult(job.result, job.attempts, job.state);
  } else if (job.state === "cancelled") {
    if (!noLease || job.nextAttemptAt !== null) fail("INVALID_JOB", "cancelled 状态字段非法");
    if (job.result !== null) validateResult(job.result, job.attempts, job.state);
  } else {
    fail("INVALID_JOB", "任务状态非法");
  }
  return job;
}

export function isDispatchCandidate(job, now) {
  try {
    assertSafeInt(now, "now");
    validateDispatchJob(job);
    return job.state === "queued" && job.leaseOwner === null && job.leaseExpiresAt === null &&
      (job.nextAttemptAt === null || now >= job.nextAttemptAt) && job.attempts < 4;
  } catch { return false; }
}

export function buildClaimPlan(job, { owner, now, leaseMs = 60_000 }) {
  validateDispatchJob(job);
  assertSafeInt(now, "now");
  assertSafeInt(leaseMs, "leaseMs", { min: 1 });
  if (now > Number.MAX_SAFE_INTEGER - leaseMs) fail("INVALID_JOB", "租约时间溢出");
  if (!isDispatchCandidate(job, now)) fail("INVALID_JOB", "任务不可领取");
  const patch = leasePatch({
    owner, now, expiresAt: now + leaseMs, attempts: job.attempts, revision: job.revision,
  });
  const leaseGeneration = job.leaseGeneration + 1;
  assertSafeInt(leaseGeneration, "leaseGeneration", { min: 1 });
  const next = {
    ...job, ...patch, leaseGeneration, state: "sending", nextAttemptAt: null, result: null,
  };
  const logId = deterministicLogId(job._id, "sending", next.revision);
  const log = {
    orgId: job.orgId, jobId: job._id, action: "enroll", fromState: job.state, state: "sending",
    actorType: "system", actorId: owner, at: now, revision: next.revision,
    attempt: next.attempts, leaseGeneration, evidenceScope: "simulated",
    errorKind: null, reasonCode: null, alertCode: null,
  };
  return {
    fence: {
      orgId: next.orgId, jobId: next._id, owner, generation: leaseGeneration,
      attempts: next.attempts, revision: next.revision, expiresAt: next.leaseExpiresAt,
    },
    job: next,
    logId,
    writes: [
      { collection: "device_operation_jobs", id: job._id, data: patchJob(next) },
      { collection: "device_operation_logs", id: logId, data: log },
    ],
  };
}

function patchJob(job) {
  const { _id, ...data } = job;
  return data;
}

export function assertLeaseFence(job, fence, now, { expired = false } = {}) {
  validateDispatchJob(job);
  assertSafeInt(now, "now");
  const valid = job.state === "sending" && job.orgId === fence?.orgId && job._id === fence?.jobId &&
    job.leaseOwner === fence?.owner && job.leaseGeneration === fence?.generation &&
    job.attempts === fence?.attempts && job.revision === fence?.revision &&
    job.leaseExpiresAt === fence?.expiresAt && (expired ? now >= job.leaseExpiresAt : now < job.leaseExpiresAt);
  if (!valid) fail("LEASE_FENCE_REJECTED", "租约 fence 已失效");
  return job;
}

/** T1-only orchestration. Uses the existing Store contract and never calls a Provider. */
export async function claimDispatchJob({ store, orgId, jobId, owner, now = Date.now }) {
  assertBoundedId(orgId, "orgId");
  assertBoundedId(jobId, "jobId");
  assertBoundedId(owner, "owner");
  if (typeof now !== "function") fail("INVALID_JOB", "now 必须是函数");
  if (!(store instanceof LocalStore)) fail("NOT_CONFIGURED", "H3-a 仅支持 LocalStore", 503);
  const found = await store.get("device_operation_jobs", jobId, orgId);
  if (!found) fail("NOT_FOUND", "任务不存在", 404);
  const before = validateDispatchJob(found);
  const provisional = buildClaimPlan(before, { owner, now: checkedNow(now) });
  const jobRef = { collection: "device_operation_jobs", id: jobId };
  const logRef = { collection: "device_operation_logs", id: provisional.logId };
  let committed = null;
  await store.transact([jobRef, logRef], (state) => {
    const current = validateDispatchJob(state[keyOf(jobRef)]);
    if (current.orgId !== orgId || current.revision !== before.revision) {
      fail("INVALID_JOB", "任务已被其他 worker 领取");
    }
    if (state[keyOf(logRef)]) fail("CONFLICT", "确定性日志已存在");
    const plan = buildClaimPlan(current, { owner, now: checkedNow(now) });
    if (plan.logId !== provisional.logId) fail("CONFLICT", "日志版本已变化");
    committed = { job: plan.job, fence: plan.fence, logId: plan.logId };
    return plan.writes;
  }, { actor: owner, actorId: owner, action: "领取合成门禁任务", orgId });
  return committed;
}

function checkedNow(now) {
  const value = now();
  assertSafeInt(value, "now");
  return value;
}
