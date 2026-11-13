import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { LocalStore } from "../lib/store.mjs";
import { H4MockRevoker, MockFaceAccessProvider, validateRevokeJob } from "../lib/face-service/index.mjs";
import { deviceClaimReleaseGuardKey, deterministicLogId } from "../lib/face-service/collections.mjs";

const ORG = "org-h4";
const ref = (collection, id) => ({ collection, id });
const audit = { actor: "test", actorId: "test", action: "seed", orgId: ORG };

async function harness({ scenario = "success", blocker = false, timeout = null, runtimeConfig = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-h4b-"));
  const store = await new LocalStore(dir).init();
  const jobId = "job-revoke-h4";
  const grantId = "grant-h4";
  const credentialId = "credential-h4";
  const deviceId = "device-h4";
  const claimId = "claim-h4";
  const slotId = "slot-h4";
  const guardId = deviceClaimReleaseGuardKey({ orgId: ORG, claimId });
  const now = { value: 1_700_000_000_000 };
  const records = [
    { collection: GRANTS, id: grantId, data: { orgId: ORG, personId: "person-h4", occupancyId: "occ-h4",
      cycleId: "cycle-h4", credentialId, deviceId, claimId, slotId, state: "revoked",
      cleanupPending: true, cleanupJobId: jobId, evidenceScope: "simulated", revision: 2,
      validFrom: 1, validUntil: 2_000_000_000_000, createdAt: 1, updatedAt: 1 } },
    { collection: "face_credentials", id: credentialId, data: { orgId: ORG, personId: "person-h4",
      reviewState: "approved", imageState: "verified", sourceFileId: "file-h4", sourceFileRevision: 1,
      evidenceScope: "simulated", revision: 2, createdAt: 1, updatedAt: 1 } },
    { collection: "access_devices", id: deviceId, data: { orgId: ORG, ownerOrgId: ORG, claimId,
      provider: "hikvision", digestRealm: "test-realm", keyVersion: 1, revision: 1,
      status: "active", capabilities: { face: true }, createdAt: 1, updatedAt: 1 } },
    { collection: "device_claims", id: claimId, data: { ownerOrgId: ORG, boundDeviceId: deviceId,
      provider: "hikvision", digestRealm: "test-realm", digestDomain: "KEYED_DIGEST/device",
      keyVersion: 1, state: "active", revision: 1, createdAt: 1, updatedAt: 1,
      activatedAt: 1, activatedByAuditId: "audit-activate" } },
    { collection: "grant_slot_claims", id: slotId, data: { orgId: ORG, personId: "person-h4",
      deviceId, cycleId: "cycle-h4", activeClaimId: grantId, state: "active", revision: 1,
      createdAt: 1, updatedAt: 1, activatedAt: 1 } },
    { collection: "device_claim_release_guards", id: guardId, data: { orgId: ORG, claimId,
      epoch: 1, revision: 1, createdAt: 1, updatedAt: 1 } },
    { collection: JOBS, id: jobId, data: { orgId: ORG, revision: 1, credentialId, grantId, deviceId,
      action: "revoke", state: "queued", executionMode: "test", provider: "mock",
      evidenceScope: "simulated", attempts: 0, leaseGeneration: 0, leaseOwner: null,
      leaseExpiresAt: null, dispatchAuthorizedAt: null, nextAttemptAt: null, result: null,
      cleanupPhase: "dispatch", providerOutcome: null, finalizeAttempts: 0,
      cleanupSnapshot: { schemaVersion: 1, grantId, grantRevision: 1, credentialId,
        credentialRevision: 2, deviceId, deviceRevision: 1, claimId, claimRevision: 1,
        slotId, slotRevision: 1, releaseGuardId: guardId, releaseGuardRevision: 1,
        releaseGuardEpoch: 1, originalGrantState: "effective", createdAt: 1 },
      createdAt: 1, updatedAt: 1 } },
  ];
  if (blocker) records.push({ collection: GRANTS, id: "grant-other", data: {
    orgId: ORG, personId: "person-other", occupancyId: "occ-other", cycleId: "cycle-other",
    credentialId: "credential-other", deviceId, claimId, slotId: "slot-other", state: "effective",
    cleanupPending: false, evidenceScope: "simulated", revision: 1, validFrom: 1,
    validUntil: 2_000_000_000_000, createdAt: 1, updatedAt: 1,
  } });
  await store.transact(records.map((r) => ref(r.collection, r.id)), () => records, audit);
  const provider = new MockFaceAccessProvider({ scenario });
  const dispatcher = new H4MockRevoker({ store, orgId: ORG, provider,
    owner: "worker-h4", now: () => now.value, timeout, runtimeConfig });
  return { dir, store, provider, dispatcher, jobId, grantId, claimId, slotId, guardId, now };
}

const GRANTS = "device_access_grants";
const JOBS = "device_operation_jobs";

async function addBlockers(h, count, prefix = "bulk") {
  const writes = Array.from({ length: count }, (_, index) => ({
    collection: GRANTS, id: `grant-${prefix}-${index}`, data: {
      orgId: ORG, personId: `person-${prefix}-${index}`, occupancyId: `occ-${prefix}-${index}`,
      cycleId: `cycle-${prefix}-${index}`, credentialId: `cred-${prefix}-${index}`,
      deviceId: "device-h4", claimId: h.claimId, slotId: `slot-${prefix}-${index}`,
      state: "effective", cleanupPending: false, evidenceScope: "simulated", revision: 1,
      validFrom: 1, validUntil: 2_000_000_000_000, createdAt: 1, updatedAt: 1,
    },
  }));
  await h.store.transact(writes.map((w) => ref(w.collection, w.id)), () => writes, audit);
}

test("H4-b success: Provider once, slot/claim tombstones and cleanup closes", async () => {
  const h = await harness();
  try {
    const job = await h.dispatcher.dispatch(h.jobId);
    assert.equal(job.state, "succeeded");
    assert.equal(h.provider.calls.filter((c) => c.action === "revoke").length, 1);
    assert.equal((await h.store.get(GRANTS, h.grantId, ORG)).cleanupPending, false);
    const slot = await h.store.get("grant_slot_claims", h.slotId, ORG);
    assert.equal(slot.state, "released");
    assert.equal(slot.releasedByJobId, h.jobId);
    const claim = await h.store.get("device_claims", h.claimId);
    assert.equal(claim.state, "released");
    assert.equal(claim.boundDeviceId, undefined);
    assert.equal((await h.store.get("device_claim_release_guards", h.guardId, ORG)).epoch, 2);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b shared device keeps owner claim active", async () => {
  const h = await harness({ blocker: true });
  try {
    assert.equal((await h.dispatcher.dispatch(h.jobId)).state, "succeeded");
    assert.equal((await h.store.get("device_claims", h.claimId)).state, "active");
    assert.equal((await h.store.get("device_claim_release_guards", h.guardId, ORG)).epoch, 1);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b pre-send retry observes 30 second boundary and never releases resources", async () => {
  const h = await harness({ scenario: "device_offline" });
  try {
    const failed = await h.dispatcher.dispatch(h.jobId);
    assert.equal(failed.state, "retryable_failed");
    assert.equal(failed.nextAttemptAt, h.now.value + 30_000);
    await assert.rejects(() => h.dispatcher.requeue(h.jobId), (e) => e.code === "RETRY_NOT_DUE");
    h.now.value += 30_000;
    assert.equal((await h.dispatcher.requeue(h.jobId)).state, "queued");
    assert.equal((await h.store.get("grant_slot_claims", h.slotId, ORG)).state, "active");
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b post-send unknown is awaiting_result and is never finalized", async () => {
  const h = await harness({ scenario: "post_send_unknown" });
  try {
    const job = await h.dispatcher.dispatch(h.jobId);
    assert.equal(job.state, "awaiting_result");
    assert.equal((await h.store.get(GRANTS, h.grantId, ORG)).cleanupPending, true);
    assert.equal((await h.store.get("grant_slot_claims", h.slotId, ORG)).state, "active");
    assert.equal(h.provider.calls.length, 1);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b deterministic timeout ignores late Provider result", async () => {
  let resolveProvider;
  const h = await harness({ timeout: () => Promise.resolve(undefined) });
  h.provider.revokeFace = () => new Promise((resolve) => { resolveProvider = resolve; });
  try {
    const job = await h.dispatcher.dispatch(h.jobId);
    assert.equal(job.state, "awaiting_result");
    const before = structuredClone(h.store.data);
    resolveProvider({ status: "succeeded", jobId: "late-job" });
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(h.store.data, before);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b expire moves an unconfirmed sending lease to awaiting_result", async () => {
  const h = await harness();
  try {
    await h.dispatcher.claim(h.jobId);
    h.now.value += 60_000;
    const expired = await h.dispatcher.expire(h.jobId);
    assert.equal(expired.state, "awaiting_result");
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4 validator rejects enroll jobs without weakening H3 schema", async () => {
  const h = await harness();
  try {
    const job = await h.store.get(JOBS, h.jobId, ORG);
    assert.throws(() => validateRevokeJob({ ...job, action: "enroll" }), /任务|清理/);
    assert.throws(() => validateRevokeJob({ ...job, cleanupPhase: "finalize", providerOutcome: null }), /清理/);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b dispatch retry uses exact 30/120/600 boundaries and attempt 4 exhausts", async () => {
  const h = await harness({ scenario: "device_offline" });
  try {
    const delays = [30_000, 120_000, 600_000];
    for (const delay of delays) {
      const failed = await h.dispatcher.dispatch(h.jobId);
      assert.equal(failed.state, "retryable_failed");
      assert.equal(failed.nextAttemptAt, h.now.value + delay);
      h.now.value += delay - 1;
      await assert.rejects(() => h.dispatcher.requeue(h.jobId), (e) => e.code === "RETRY_NOT_DUE");
      h.now.value += 1;
      assert.equal((await h.dispatcher.requeue(h.jobId)).state, "queued");
    }
    const terminal = await h.dispatcher.dispatch(h.jobId);
    assert.equal(terminal.state, "terminal_failed");
    assert.equal(terminal.result.reasonCode, "PROVIDER_PRE_SEND");
    assert.equal(h.provider.calls.length, 4);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b Provider success followed by Store failure enters local-finalize and never resends", async () => {
  const h = await harness();
  const originalList = h.store.list.bind(h.store);
  const originalRevoke = h.provider.revokeFace.bind(h.provider);
  let breakGrantList = false;
  h.provider.revokeFace = async (...args) => {
    const result = await originalRevoke(...args);
    breakGrantList = true;
    return result;
  };
  h.store.list = async (name, ...args) => {
    if (breakGrantList && name === GRANTS) throw Object.assign(new Error("read failed"), { code: "ADAPTER_UNAVAILABLE" });
    return originalList(name, ...args);
  };
  try {
    let job = await h.dispatcher.dispatch(h.jobId);
    assert.equal(job.state, "retryable_failed");
    assert.equal(job.cleanupPhase, "finalize");
    assert.equal(job.providerOutcome, "confirmed_removed");
    assert.equal(h.provider.calls.length, 1);
    for (const delay of [30_000, 120_000, 600_000]) {
      h.now.value += delay;
      job = await h.dispatcher.finalize(h.jobId);
    }
    assert.equal(job.state, "terminal_failed");
    assert.equal(job.result.reasonCode, "LOCAL_FINALIZE_EXHAUSTED");
    assert.equal(h.provider.calls.length, 1);
    assert.equal((await h.store.get(GRANTS, h.grantId, ORG)).cleanupPending, true);
    assert.equal((await h.store.get("grant_slot_claims", h.slotId, ORG)).state, "active");
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b finalize-pending can recover locally without another Provider call", async () => {
  const h = await harness();
  const originalList = h.store.list.bind(h.store);
  const originalRevoke = h.provider.revokeFace.bind(h.provider);
  let failOnce = false;
  h.provider.revokeFace = async (...args) => { const out = await originalRevoke(...args); failOnce = true; return out; };
  h.store.list = async (name, ...args) => {
    if (failOnce && name === GRANTS) { failOnce = false; throw new Error("once"); }
    return originalList(name, ...args);
  };
  try {
    const pending = await h.dispatcher.dispatch(h.jobId);
    assert.equal(pending.cleanupPhase, "finalize");
    h.now.value += 30_000;
    const done = await h.dispatcher.finalize(h.jobId);
    assert.equal(done.state, "succeeded");
    assert.equal(h.provider.calls.length, 1);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b terminal post-send rejection preserves cleanup resources", async () => {
  const h = await harness({ scenario: "revoke_fail" });
  try {
    const job = await h.dispatcher.dispatch(h.jobId);
    assert.equal(job.state, "terminal_failed");
    assert.equal((await h.store.get(GRANTS, h.grantId, ORG)).cleanupPending, true);
    assert.equal((await h.store.get("grant_slot_claims", h.slotId, ORG)).state, "active");
    assert.equal((await h.store.get("device_claims", h.claimId)).state, "active");
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b disabled device is still eligible for cleanup", async () => {
  const h = await harness();
  try {
    h.store.data.access_devices[0].status = "disabled";
    assert.equal((await h.dispatcher.dispatch(h.jobId)).state, "succeeded");
    assert.equal(h.provider.calls.length, 1);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b candidate-scan phantom is stopped by release-guard CAS", async () => {
  const h = await harness();
  const originalList = h.store.list.bind(h.store);
  const originalRevoke = h.provider.revokeFace.bind(h.provider);
  let inject = false;
  h.provider.revokeFace = async (...args) => { const out = await originalRevoke(...args); inject = true; return out; };
  h.store.list = async (name, ...args) => {
    const rows = await originalList(name, ...args);
    if (inject && name === GRANTS) {
      inject = false;
      const guard = h.store.data.device_claim_release_guards.find((row) => row._id === h.guardId);
      guard.epoch += 1; guard.revision += 1;
      h.store.data.device_access_grants.push({ _id: "grant-phantom", orgId: ORG,
        personId: "person-p", occupancyId: "occ-p", cycleId: "cycle-p", credentialId: "cred-p",
        deviceId: "device-h4", claimId: h.claimId, slotId: "slot-p", state: "effective",
        cleanupPending: false, evidenceScope: "simulated", revision: 1, validFrom: 1,
        validUntil: 2_000_000_000_000, createdAt: 1, updatedAt: 1 });
    }
    return rows;
  };
  try {
    const pending = await h.dispatcher.dispatch(h.jobId);
    assert.equal(pending.cleanupPhase, "finalize");
    assert.equal(pending.providerOutcome, "confirmed_removed");
    assert.equal((await h.store.get("device_claims", h.claimId)).state, "active");
    assert.equal(h.provider.calls.length, 1);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b finalizer accepts 82 candidates/90 refs and rejects 83 before send", async () => {
  const h82 = await harness();
  try {
    await addBlockers(h82, 82, "n82");
    assert.equal((await h82.dispatcher.dispatch(h82.jobId)).state, "succeeded");
    assert.equal(h82.provider.calls.length, 1);
    assert.equal((await h82.store.get("device_claims", h82.claimId)).state, "active");
  } finally { await rm(h82.dir, { recursive: true, force: true }); }

  const h83 = await harness();
  try {
    await addBlockers(h83, 83, "n83");
    const blocked = await h83.dispatcher.dispatch(h83.jobId);
    assert.equal(blocked.state, "retryable_failed");
    assert.equal(h83.provider.calls.length, 0);
    assert.equal((await h83.store.get("grant_slot_claims", h83.slotId, ORG)).state, "active");
  } finally { await rm(h83.dir, { recursive: true, force: true }); }
});

test("H4-b 83 candidates appearing after Provider success become local-finalize pending", async () => {
  const h = await harness();
  const originalRevoke = h.provider.revokeFace.bind(h.provider);
  h.provider.revokeFace = async (...args) => {
    const out = await originalRevoke(...args);
    await addBlockers(h, 83, "late83");
    return out;
  };
  try {
    const pending = await h.dispatcher.dispatch(h.jobId);
    assert.equal(pending.cleanupPhase, "finalize");
    assert.equal(pending.providerOutcome, "confirmed_removed");
    assert.equal(h.provider.calls.length, 1);
    assert.equal((await h.store.get("grant_slot_claims", h.slotId, ORG)).state, "active");
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b send window rejects 9999ms and accepts exact 10000ms", async () => {
  let h9999;
  h9999 = await harness({ runtimeConfig: () => {
    h9999.now.value += 50_001;
    return { executionMode: "test", provider: "mock" };
  } });
  try {
    const stopped = await h9999.dispatcher.dispatch(h9999.jobId);
    assert.equal(stopped.state, "terminal_failed");
    assert.equal(stopped.result.reasonCode, "PRE_SEND_WINDOW_CLOSED");
    assert.equal(h9999.provider.calls.length, 0);
  } finally { await rm(h9999.dir, { recursive: true, force: true }); }

  let h10000;
  h10000 = await harness({ runtimeConfig: () => {
    h10000.now.value += 50_000;
    return { executionMode: "test", provider: "mock" };
  } });
  try {
    assert.equal((await h10000.dispatcher.dispatch(h10000.jobId)).state, "succeeded");
    assert.equal(h10000.provider.calls.length, 1);
  } finally { await rm(h10000.dir, { recursive: true, force: true }); }
});

test("H4-b runtime and binding changes fail before Provider", async () => {
  const config = await harness({ runtimeConfig: () => ({ executionMode: "live", provider: "mock" }) });
  try {
    const job = await config.dispatcher.dispatch(config.jobId);
    assert.equal(job.state, "terminal_failed");
    assert.equal(job.result.reasonCode, "NOT_CONFIGURED");
    assert.equal(config.provider.calls.length, 0);
  } finally { await rm(config.dir, { recursive: true, force: true }); }

  const binding = await harness();
  try {
    binding.store.data.access_devices[0].claimId = "claim-changed";
    const job = await binding.dispatcher.dispatch(binding.jobId);
    assert.equal(job.state, "terminal_failed");
    assert.equal(binding.provider.calls.length, 0);
    assert.equal((await binding.store.get("grant_slot_claims", binding.slotId, ORG)).state, "active");
  } finally { await rm(binding.dir, { recursive: true, force: true }); }
});

test("H4-b deterministic T1 log/audit preoccupation rolls back lease", async () => {
  for (const kind of ["log", "audit"]) {
    const h = await harness();
    try {
      const id = kind === "log"
        ? deterministicLogId(h.jobId, "sending", 2)
        : `audit-h4-v1:${createHash("sha256").update(JSON.stringify([ORG, h.jobId, "claim", 2])).digest("hex")}`;
      const collection = kind === "log" ? "device_operation_logs" : "admin_audit";
      await h.store.transact([ref(collection, id)], () => [{ collection, id,
        data: { orgId: ORG, actorId: "occupied", actorType: "system", action: "occupied" } }], audit);
      const before = structuredClone(h.store.data);
      await assert.rejects(() => h.dispatcher.dispatch(h.jobId), (error) => error.status === 409);
      assert.deepEqual(h.store.data, before);
      assert.equal(h.provider.calls.length, 0);
    } finally { await rm(h.dir, { recursive: true, force: true }); }
  }
});

test("H4-b two workers compete and only one invokes Provider", async () => {
  const h = await harness();
  try {
    const second = new H4MockRevoker({ store: h.store, orgId: ORG, provider: h.provider,
      owner: "worker-h4-2", now: () => h.now.value });
    const settled = await Promise.allSettled([
      h.dispatcher.dispatch(h.jobId), second.dispatch(h.jobId),
    ]);
    assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(h.provider.calls.length, 1);
    assert.equal((await h.store.get(JOBS, h.jobId, ORG)).state, "succeeded");
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b Provider payload/context are minimal and synthetic", async () => {
  const h = await harness();
  const original = h.provider.revokeFace.bind(h.provider);
  let captured;
  h.provider.revokeFace = async (input, context) => {
    captured = { input, context };
    return original(input, context);
  };
  try {
    await h.dispatcher.dispatch(h.jobId);
    assert.deepEqual(Object.keys(captured.input).sort(), ["credentialId", "grantId"]);
    assert.deepEqual([...captured.context.permissions], ["device.access.manage"]);
    assert.equal(captured.context.executionMode, "test");
    assert.match(captured.context.idempotencyKey, /^h4-v1:[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(captured.input), /serial|MAC|IP|image|objectKey|person/i);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("H4-b manual retry requires current revision and device.operation.retry", async () => {
  const h = await harness({ scenario: "device_offline" });
  try {
    const failed = await h.dispatcher.dispatch(h.jobId);
    h.now.value += 30_000;
    const writes = [
      { collection: "organizations", id: ORG, data: { orgId: ORG, status: "active", revision: 1 } },
      { collection: "org_memberships", id: "member-retry", data: { orgId: ORG, status: "active",
        principalId: "actor-retry", permissions: [], revision: 1 } },
    ];
    await h.store.transact(writes.map((w) => ref(w.collection, w.id)), () => writes, audit);
    const actor = { actorId: "actor-retry", membershipId: "member-retry" };
    await assert.rejects(() => h.dispatcher.requeue(h.jobId, failed.revision, actor), (e) => e.code === "FORBIDDEN");
    h.store.data.org_memberships[0].permissions = ["device.operation.retry"];
    await assert.rejects(() => h.dispatcher.requeue(h.jobId, failed.revision + 1, actor), (e) => e.code === "INVALID_JOB");
    assert.equal((await h.dispatcher.requeue(h.jobId, failed.revision, actor)).state, "queued");
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});
