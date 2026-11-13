import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  assertLeaseFence, buildClaimPlan, claimDispatchJob, createDispatchSnapshot,
  isDispatchCandidate, validateDispatchJob, validateDispatchSnapshot,
} from "../lib/face-service/h3a.mjs";
import { LocalStore } from "../lib/store.mjs";
import { FaceCredentialService } from "../lib/face-service/service.mjs";

const NOW = 1_700_000_000_000;
const ref = (collection, id) => ({ collection, id });
const record = (revision = 1) => ({ revision });

function snapshot(overrides = {}) {
  const state = {
    "organizations/org": record(),
    "org_memberships/member": record(),
    "persons/person": { revision: 1, faceImage: "SENSITIVE-FACE-MARKER", phone: "SENSITIVE-PHONE" },
    "identity_applications/identity": record(),
    "occupancies/occupancy": record(),
    "occupancy_cycles/cycle": { revision: 1, epoch: 1 },
    "face_credentials/credential": record(2),
    "file_assets/file": record(),
    "access_devices/device": record(),
    "device_claims/claim": record(),
    "device_digest_domains/head": record(),
    "device_digest_domains/version": { keyVersion: 1 },
  };
  const refs = Object.keys(state).map((key) => {
    const [collection, ...parts] = key.split("/");
    return ref(collection, parts.join("/"));
  });
  return createDispatchSnapshot({
    now: NOW,
    actor: { actorId: "actor", membershipId: "member" },
    request: { identityApplicationId: "identity", occupancyId: "occupancy", cycleId: "cycle" },
    state, refs, credential: { personId: "person" }, fileId: "file", claimId: "claim",
    slotId: "slot", domainHeadId: "head", domainVersionId: "version",
    grantId: "grant", grantRecord: { revision: 1 }, slotRecord: { revision: 1 },
    ...overrides,
  });
}

function job(overrides = {}) {
  return {
    _id: "job", orgId: "org", revision: 1, credentialId: "credential", grantId: "grant",
    deviceId: "device", action: "enroll", state: "queued", executionMode: "test",
    provider: "mock", evidenceScope: "simulated", dispatchSnapshot: snapshot(), attempts: 0,
    leaseGeneration: 0, leaseOwner: null, leaseExpiresAt: null, dispatchAuthorizedAt: null,
    nextAttemptAt: null, result: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

test("H3-a embedded snapshot is strict, bounded and version witnessed", () => {
  const value = snapshot();
  assert.equal(validateDispatchSnapshot(value), value);
  assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 16 * 1024);
  assert.doesNotMatch(JSON.stringify(value), /SENSITIVE-FACE-MARKER|SENSITIVE-PHONE|faceImage|phone/);
  assert.throws(() => validateDispatchSnapshot({ ...value, objectKey: "secret" }),
    (error) => error.code === "DISPATCH_SNAPSHOT_REQUIRED");
  assert.throws(() => validateDispatchSnapshot({ ...value, versions: [
    ...value.versions, { collection: "persons", id: "unversioned", present: true,
      revision: null, epoch: null, keyVersion: null },
  ] }), (error) => error.code === "DISPATCH_SNAPSHOT_REQUIRED");
  const versions = [...value.versions];
  let below = value;
  let over = null;
  for (let index = 0; index < 200; index += 1) {
    versions.push({ collection: "persons", id: `padding-${index}-${"x".repeat(100)}`,
      present: true, revision: 1, epoch: null, keyVersion: null });
    const candidate = { ...value, versions: [...versions] };
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > 16 * 1024) {
      over = candidate;
      break;
    }
    below = candidate;
  }
  assert.ok(over, "必须构造出跨越 16 KiB 的快照");
  assert.ok(Buffer.byteLength(JSON.stringify(below), "utf8") <= 16 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(over), "utf8") > 16 * 1024);
  assert.equal(validateDispatchSnapshot(below), below);
  assert.throws(() => validateDispatchSnapshot(over),
    (error) => error.code === "PARAM_ERROR" && error.status === 400);
});

test("H3-a snapshot is bound to every required job reference and keeps planned witnesses", () => {
  const value = snapshot();
  const current = job({ dispatchSnapshot: value });
  assert.equal(validateDispatchJob(current), current);
  for (const [collection, id] of [
    ["organizations", "org"], ["org_memberships", "member"], ["persons", "person"],
    ["identity_applications", "identity"], ["occupancies", "occupancy"],
    ["occupancy_cycles", "cycle"], ["device_access_grants", "grant"],
    ["face_credentials", "credential"], ["file_assets", "file"],
    ["access_devices", "device"], ["device_claims", "claim"],
    ["grant_slot_claims", "slot"], ["device_digest_domains", "head"],
    ["device_digest_domains", "version"],
  ]) {
    const broken = structuredClone(current);
    broken.dispatchSnapshot.versions = broken.dispatchSnapshot.versions
      .filter((item) => !(item.collection === collection && item.id === id));
    assert.throws(() => validateDispatchJob(broken),
      (error) => error.code === "DISPATCH_SNAPSHOT_REQUIRED", `${collection}/${id} 必需`);
  }
  const wrongPerson = structuredClone(current);
  wrongPerson.dispatchSnapshot.personId = "person-other";
  assert.throws(() => validateDispatchJob(wrongPerson),
    (error) => error.code === "DISPATCH_SNAPSHOT_REQUIRED");
  const keys = value.versions.map((item) => `${item.collection}/${item.id}`);
  assert.equal(new Set(keys).size, keys.length, "planned refs 必须唯一");
});

test("H3-a old jobs are excluded and direct validation fails closed", () => {
  const legacy = { ...job() };
  delete legacy.dispatchSnapshot;
  assert.equal(isDispatchCandidate(legacy, NOW), false);
  assert.throws(() => validateDispatchJob(legacy),
    (error) => error.code === "DISPATCH_SNAPSHOT_REQUIRED");
});

test("H3-a rejects polluted queued state and generation/attempt mismatch", () => {
  for (const polluted of [
    job({ leaseOwner: "worker" }), job({ leaseExpiresAt: NOW + 1 }),
    job({ dispatchAuthorizedAt: NOW }), job({ nextAttemptAt: NOW }),
    job({ result: { attempt: 0, outcome: "queued", errorKind: null, reasonCode: null, finishedAt: NOW } }),
    job({ leaseGeneration: 1 }), job({ attempts: 1 }),
  ]) {
    assert.equal(isDispatchCandidate(polluted, NOW), false);
    assert.throws(() => validateDispatchJob(polluted), (error) => error.code === "INVALID_JOB");
  }
});

test("H3-a synthetic snapshot mode fails closed outside LocalStore", () => {
  assert.throws(() => new FaceCredentialService({
    store: {}, orgId: "org", actor: {}, files: {}, blacklist: {}, provider: {},
    syntheticDispatch: true,
  }), (error) => error.code === "NOT_CONFIGURED" && error.status === 503);
});

test("H3-a claim plan is deterministic and fence rejects stale workers and expiry equality", () => {
  const current = job();
  const first = buildClaimPlan(current, { owner: "worker-a", now: NOW });
  const replay = buildClaimPlan(current, { owner: "worker-a", now: NOW });
  assert.deepEqual(first, replay, "transaction callback rerun must build the same plan");
  assert.equal(first.job.state, "sending");
  assert.equal(first.job.attempts, 1);
  assert.equal(first.job.leaseGeneration, 1);
  assert.equal(first.writes.length, 2);
  assert.equal(first.logId, replay.logId);
  assert.equal(assertLeaseFence(first.job, first.fence, NOW + 59_999), first.job);
  for (const fence of [
    { ...first.fence, owner: "worker-b" },
    { ...first.fence, generation: 2 },
    { ...first.fence, attempts: 2 },
    { ...first.fence, revision: 9 },
  ]) assert.throws(() => assertLeaseFence(first.job, fence, NOW + 1),
    (error) => error.code === "LEASE_FENCE_REJECTED");
  assert.throws(() => assertLeaseFence(first.job, first.fence, NOW + 60_000),
    (error) => error.code === "LEASE_FENCE_REJECTED");
  assert.equal(assertLeaseFence(first.job, first.fence, NOW + 60_000, { expired: true }), first.job);
  assert.throws(() => buildClaimPlan(first.job, { owner: "worker-a", now: NOW + 1 }),
    (error) => error.code === "INVALID_JOB", "same owner cannot renew/re-enter");
  assert.throws(() => buildClaimPlan(current, {
    owner: "worker-a", now: Number.MAX_SAFE_INTEGER - 10, leaseMs: 60_000,
  }), (error) => error.code === "INVALID_JOB");
});

async function storedJob(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-h3a-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  const value = job(overrides);
  await store.transact([{ collection: "device_operation_jobs", id: value._id }], () => [{
    collection: "device_operation_jobs", id: value._id, data: Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "_id"),
    ),
  }], { actor: "fixture", action: "H3-a fixture", orgId: "org" });
  return { store, value };
}

test("H3-a T1 uses existing transact: two workers compete, one audit and one log commit", async (t) => {
  const { store } = await storedJob(t);
  const auditBefore = (await store.list("admin_audit")).length;
  const results = await Promise.allSettled([
    claimDispatchJob({ store, orgId: "org", jobId: "job", owner: "worker-a", now: () => NOW }),
    claimDispatchJob({ store, orgId: "org", jobId: "job", owner: "worker-b", now: () => NOW }),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected" && item.reason.code === "INVALID_JOB").length, 1);
  assert.equal((await store.list("device_operation_logs", "org")).length, 1);
  assert.equal((await store.list("admin_audit")).length, auditBefore + 1);
  const current = await store.get("device_operation_jobs", "job", "org");
  assert.equal(current.state, "sending");
  assert.equal(current.attempts, 1);
});

test("H3-a deterministic log collision rolls back job and admin audit", async (t) => {
  const { store, value } = await storedJob(t);
  const plan = buildClaimPlan(value, { owner: "worker-a", now: NOW });
  await store.transact([{ collection: "device_operation_logs", id: plan.logId }], () => [{
    collection: "device_operation_logs", id: plan.logId,
    data: { orgId: "org", jobId: "job", state: "sentinel", revision: 99 },
  }], { actor: "fixture", action: "collision", orgId: "org" });
  const beforeJob = await store.get("device_operation_jobs", "job", "org");
  const audits = structuredClone(await store.list("admin_audit"));
  await assert.rejects(
    claimDispatchJob({ store, orgId: "org", jobId: "job", owner: "worker-a", now: () => NOW }),
    (error) => error.code === "CONFLICT",
  );
  assert.deepEqual(await store.get("device_operation_jobs", "job", "org"), beforeJob);
  assert.deepEqual(await store.list("admin_audit"), audits);
  assert.equal((await store.list("device_operation_logs", "org"))[0].state, "sentinel");
});

test("H3-a claim is LocalStore-only and missing/cross-org jobs are homonymous 404", async (t) => {
  await assert.rejects(
    claimDispatchJob({ store: { get() { throw Error("must not read"); } }, orgId: "org",
      jobId: "job", owner: "worker", now: () => NOW }),
    (error) => error.code === "NOT_CONFIGURED" && error.status === 503,
  );
  const missing = await storedJob(t);
  await assert.rejects(
    claimDispatchJob({ store: missing.store, orgId: "org", jobId: "missing",
      owner: "worker", now: () => NOW }),
    (error) => error.code === "NOT_FOUND" && error.status === 404,
  );
  const cross = await storedJob(t, { orgId: "org-other" });
  await assert.rejects(
    claimDispatchJob({ store: cross.store, orgId: "org", jobId: "job",
      owner: "worker", now: () => NOW }),
    (error) => error.code === "NOT_FOUND" && error.status === 404,
  );
});
