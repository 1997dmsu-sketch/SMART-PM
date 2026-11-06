import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalStore } from "../lib/store.mjs";
import { MockFaceAccessProvider, projectAccess } from "../lib/face-service/index.mjs";
import { FaceCredentialService } from "../lib/face-service/service.mjs";
import { FileService } from "../lib/files.mjs";

let store, dir;
const orgId = "org-demo";
const ref = (collection, id) => ({ collection, id });
const audit = { actor: "system", actorId: "system", action: "测试" };

const input = {
  personId: "person-001", deviceId: "device-1", grantId: "grant-1",
  sourceFileId: "file-1", validFrom: 1000, validUntil: 2000, occupancyId: "occ-1",
};

let eligible = { eligible: true, entryIds: [], decisionId: null };
const blacklist = {
  withEligibility: async (request, refs, build) => {
    let result;
    await store.transact(refs, async (state) => {
      const built = await build(state, eligible);
      result = built.result;
      return built.writes;
    }, audit);
    return result;
  },
};

let providerCalls = [];
let inTransaction = false;
const provider = {
  async enrollFace(inputArg, context) {
    providerCalls.push({ action: "enroll", inTransaction });
    return new MockFaceAccessProvider().enrollFace(inputArg, context);
  },
  async revokeFace(inputArg, context) {
    providerCalls.push({ action: "revoke", inTransaction });
    return new MockFaceAccessProvider().revokeFace(inputArg, context);
  },
};

const trackedStore = () =>
  new Proxy(store, {
    get(target, prop) {
      if (prop === "transact") {
        return async (...args) => {
          inTransaction = true;
          try { return await target.transact(...args); } finally { inTransaction = false; }
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

const service = (membershipId) =>
  new FaceCredentialService({
    store: trackedStore(), orgId,
    actor: { membershipId, actorType: "user", actorId: membershipId },
    files: new FileService(store, orgId, {
      auth: { membershipId },
      actor: { actorType: "user", actorId: membershipId, role: "editor", permissions: ["device.face.submit"] },
    }),
    blacklist, provider, now: () => 1_700_000_000_000,
  });

const approvedCredential = async () =>
  (await store.list("face_credentials", orgId)).find((c) => c.reviewState === "approved");

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-face-svc-"));
  store = new LocalStore(dir);
  await store.init();
  const memberships = [
    ["mem-submit", ["device.face.submit"]],
    ["mem-review", ["device.face.review"]],
    ["mem-manage", ["device.access.manage"]],
    ["mem-audit", ["device.audit.read"]],
    ["mem-admin", ["device.face.submit", "device.face.review", "device.access.manage", "device.audit.read"]],
  ];
  await store.transact([ref("organizations", orgId), ref("file_assets", "file-1"), ...memberships.map(([id]) => ref("org_memberships", id))], () => [
    { collection: "organizations", id: orgId, data: { name: "人脸组织", status: "active", revision: 1 } },
    { collection: "file_assets", id: "file-1", data: { orgId, purpose: "face-biometric", status: "ready", visibility: "private", mimeType: "image/jpeg", size: 1024, objectKey: "private/f.jpg", revision: 1 } },
    ...memberships.map(([id, permissions]) => ({
      collection: "org_memberships", id,
      data: { orgId, status: "active", role: "admin", principalType: "adminAccount", principalId: id, permissions, revision: 1 },
    })),
  ], audit);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("submitter 可提交，但不能审核/授权；提交不建 grant/job", async () => {
  const s = service("mem-submit");
  const out = await s.submit(input, { idempotencyKey: "idem-key-submit-01" });
  assert.equal(out.reviewState, "submitted");
  assert.equal((await store.list("face_credentials", orgId)).length, 1);
  assert.equal((await store.list("device_access_grants", orgId)).length, 0);
  assert.equal((await store.list("device_operation_jobs", orgId)).length, 0);
  await assert.rejects(() => s.review(out.credentialId, { decision: "approved" }, { idempotencyKey: "k2" }), (e) => e.status === 403);
  await assert.rejects(() => s.createGrant({ credentialId: out.credentialId, occupancyId: "occ-1", cycleId: "cycle-1", identityApplicationId: "id-1" }, { idempotencyKey: "k3" }), (e) => e.status === 403);
});

test("reviewer 可审核但不建 grant；未 approved 授权被拒", async () => {
  const [credential] = await store.list("face_credentials", orgId);
  const reviewer = service("mem-review");
  const reviewed = await reviewer.review(credential._id, { decision: "approved", expectedRevision: 1 }, { idempotencyKey: "idem-key-review-01" });
  assert.equal(reviewed.reviewState, "approved");
  assert.equal((await store.list("device_access_grants", orgId)).length, 0);
  assert.equal((await store.list("device_operation_jobs", orgId)).length, 0);
});

test("access manager 创建 grant/job/claims；模拟证据不产生 deviceEffective", async () => {
  const credential = await approvedCredential();
  const manager = service("mem-manage");
  const out = await manager.createGrant(
    { credentialId: credential._id, occupancyId: "occ-1", cycleId: "cycle-1", identityApplicationId: "id-1" },
    { idempotencyKey: "idem-key-grant-01" },
  );
  assert.equal(out.evidenceScope, "simulated");
  const grant = (await store.list("device_access_grants", orgId))[0];
  const job = (await store.list("device_operation_jobs", orgId)).find((j) => j._id === out.jobId);
  assert.equal(grant.state, "effective");
  assert.equal(job.evidenceScope, "simulated");
  assert.equal(job.provider, "mock");
  assert.equal(job.executionMode, "test");
  assert.equal((await store.list("grant_slot_claims", orgId)).length, 1);

  const projected = projectAccess({
    grant, eligibility: { allowed: true }, jobs: [job],
    deviceEvidence: { kind: "mock_result", trusted: true, evidenceScope: "simulated" },
  });
  assert.equal(projected.deviceEffective, false);
});

test("Provider 调用发生在事务外", () => {
  assert.ok(providerCalls.length >= 1);
  assert.ok(providerCalls.every((call) => call.inTransaction === false));
});

test("资格待审/拒绝：grant/job 零写入", async () => {
  const pending = await service("mem-submit").submit(
    { ...input, personId: "person-002", deviceId: "device-2" },
    { idempotencyKey: "idem-key-submit-02" },
  );
  await service("mem-review").review(pending.credentialId, { decision: "approved" }, { idempotencyKey: "idem-key-review-02" });

  const manager = service("mem-manage");
  const snapshot = async () => ({
    grants: (await store.list("device_access_grants", orgId)).length,
    jobs: (await store.list("device_operation_jobs", orgId)).length,
    keys: (await store.list("operation_keys", orgId)).length,
    claims: (await store.list("device_claims", orgId)).length,
  });
  const before = await snapshot();

  eligible = { eligible: false, code: "BLACKLIST_REVIEW_REQUIRED", entryIds: ["e1"], decisionId: null };
  await assert.rejects(
    () => manager.createGrant({ credentialId: pending.credentialId, occupancyId: "occ-1", cycleId: "cycle-1", identityApplicationId: "id-1" }, { idempotencyKey: "idem-key-grant-02" }),
    (e) => e.status === 409,
  );

  eligible = { eligible: false, code: "BLACKLIST_DENIED", entryIds: ["e1"], decisionId: null };
  await assert.rejects(
    () => manager.createGrant({ credentialId: pending.credentialId, occupancyId: "occ-1", cycleId: "cycle-1", identityApplicationId: "id-1" }, { idempotencyKey: "idem-key-grant-03" }),
    (e) => e.status === 403,
  );

  assert.deepEqual(await snapshot(), before);
  eligible = { eligible: true, entryIds: [], decisionId: null };
});

test("撤权不查资格；grant 立即 revoked；清理失败不回滚", async () => {
  const grant = (await store.list("device_access_grants", orgId))[0];
  const manager = service("mem-manage");
  const saved = eligible;
  eligible = { eligible: false, code: "BLACKLIST_DENIED", entryIds: [], decisionId: null };
  provider.revokeFace = async (inputArg, context) => {
    providerCalls.push({ action: "revoke", inTransaction });
    return new MockFaceAccessProvider({ scenario: "revoke_fail" }).revokeFace(inputArg, context);
  };
  const out = await manager.revoke(grant._id, { idempotencyKey: "idem-key-revoke-01" });
  eligible = saved;

  const after = (await store.list("device_access_grants", orgId))[0];
  const revokeJob = (await store.list("device_operation_jobs", orgId)).find((j) => j._id === out.jobId);
  assert.equal(after.state, "revoked");
  assert.equal(after.cleanupPending, true);
  assert.equal(revokeJob.state, "terminal_failed");
});

test("幂等：同键同输入重放；不同输入 CONFLICT", async () => {
  const manager = service("mem-manage");
  const credential = await approvedCredential();
  const replay = await manager.createGrant(
    { credentialId: credential._id, occupancyId: "occ-1", cycleId: "cycle-1", identityApplicationId: "id-1" },
    { idempotencyKey: "idem-key-grant-01" },
  );
  assert.ok(replay.grantId);

  await assert.rejects(
    () => manager.createGrant(
      { credentialId: credential._id, occupancyId: "occ-2", cycleId: "cycle-1", identityApplicationId: "id-1" },
      { idempotencyKey: "idem-key-grant-01" },
    ),
    (e) => e.code === "CONFLICT",
  );
});

test("跨组织任务查询同态 404", async () => {
  await store.transact([ref("device_operation_jobs", "job-other-org")], () => [{
    collection: "device_operation_jobs", id: "job-other-org",
    data: { orgId: "org-other", revision: 1, action: "enroll", state: "succeeded", evidenceScope: "simulated" },
  }], audit);
  await assert.rejects(
    () => service("mem-audit").queryJob("job-other-org"),
    (e) => e.status === 404 || e.code === "NOT_FOUND",
  );
});

test("prepare 后撤销权限：submit 失败且凭证/operation key 零写入", async () => {
  const membershipId = "mem-race";
  await store.transact([ref("org_memberships", membershipId)], () => [{
    collection: "org_memberships", id: membershipId,
    data: { orgId, status: "active", role: "admin", principalType: "adminAccount", principalId: membershipId, permissions: ["device.face.submit"], revision: 1 },
  }], audit);

  const base = new FileService(store, orgId, {
    auth: { membershipId },
    actor: { actorType: "user", actorId: membershipId, role: "editor", permissions: ["device.face.submit"] },
  });
  const racing = {
    prepareReference: async (fileId) => {
      const token = await base.prepareReference(fileId);
      const row = (await store.list("org_memberships", orgId)).find((m) => m._id === membershipId);
      await store.transact([ref("org_memberships", membershipId)], () => [{
        collection: "org_memberships", id: membershipId, data: { ...row, permissions: [] },
      }], audit);
      return token;
    },
    assertReference: base.assertReference.bind(base),
  };
  const svc = new FaceCredentialService({
    store, orgId,
    actor: { membershipId, actorType: "user", actorId: membershipId },
    files: racing, blacklist, provider, now: () => 1_700_000_000_000,
  });

  const before = {
    credentials: (await store.list("face_credentials", orgId)).length,
    keys: (await store.list("operation_keys", orgId)).length,
  };
  await assert.rejects(
    () => svc.submit({ ...input, personId: "person-race" }, { idempotencyKey: "idem-key-race-01" }),
    (e) => e.status === 404,
  );
  assert.equal((await store.list("face_credentials", orgId)).length, before.credentials);
  assert.equal((await store.list("operation_keys", orgId)).length, before.keys);
});

test("prepare 后文件 revision 变化：submit 失败且零写入", async () => {
  const base = new FileService(store, orgId, {
    auth: { membershipId: "mem-submit" },
    actor: { actorType: "user", actorId: "mem-submit", role: "editor", permissions: ["device.face.submit"] },
  });
  const racing = {
    prepareReference: async (fileId) => {
      const token = await base.prepareReference(fileId);
      const file = (await store.list("file_assets", orgId)).find((f) => f._id === fileId);
      await store.transact([ref("file_assets", fileId)], () => [{
        collection: "file_assets", id: fileId, data: { ...file, revision: file.revision + 1 },
      }], audit);
      return token;
    },
    assertReference: base.assertReference.bind(base),
  };
  const svc = new FaceCredentialService({
    store, orgId,
    actor: { membershipId: "mem-submit", actorType: "user", actorId: "mem-submit" },
    files: racing, blacklist, provider, now: () => 1_700_000_000_000,
  });

  const before = {
    credentials: (await store.list("face_credentials", orgId)).length,
    keys: (await store.list("operation_keys", orgId)).length,
  };
  await assert.rejects(
    () => svc.submit({ ...input, personId: "person-race-2" }, { idempotencyKey: "idem-key-race-02" }),
    (e) => e.code === "FILE_CHANGED",
  );
  assert.equal((await store.list("face_credentials", orgId)).length, before.credentials);
  assert.equal((await store.list("operation_keys", orgId)).length, before.keys);
});
