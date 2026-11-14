import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalStore } from "../lib/store.mjs";
import { FileService } from "../lib/files.mjs";
import { FaceCredentialService } from "../lib/face-service/service.mjs";

const orgId = "org-h1-regression";
const now = 1_700_000_000_000;
const audit = { actor: "system", actorId: "system", action: "H2-d H1 回归" };
const ref = (collection, id) => ({ collection, id });

let dir;
let store;
const providerCalls = { enroll: 0, revoke: 0 };
const provider = {
  enrollFace() {
    providerCalls.enroll += 1;
    throw new Error("H1 路径不得调用 Provider");
  },
  revokeFace() {
    providerCalls.revoke += 1;
    throw new Error("H1 路径不得调用 Provider");
  },
};

function filesFor(membershipId) {
  return new FileService(store, orgId, {
    auth: { membershipId },
    actor: {
      actorType: "user",
      actorId: membershipId,
      role: "editor",
      permissions: ["device.face.submit"],
    },
  });
}

function service(membershipId, { files = filesFor(membershipId) } = {}) {
  return new FaceCredentialService({
    store,
    orgId,
    actor: { membershipId, actorType: "user", actorId: membershipId },
    files,
    blacklist: {},
    provider,
    now: () => now,
  });
}

async function coreSnapshot() {
  const names = [
    "face_credentials",
    "device_access_grants",
    "device_operation_jobs",
    "device_operation_logs",
    "grant_slot_claims",
    "operation_keys",
    "operation_key_domains",
  ];
  return Object.fromEntries(await Promise.all(names.map(async (name) => [
    name,
    structuredClone(await store.list(name, orgId)),
  ])));
}

async function seedFile(id) {
  await store.transact([ref("file_assets", id)], () => [{
    collection: "file_assets",
    id,
    data: {
      orgId,
      purpose: "face-biometric",
      status: "ready",
      visibility: "private",
      mimeType: "image/jpeg",
      size: 1024,
      objectKey: `private/${id}.jpg`,
      revision: 1,
    },
  }], audit);
}

before(async () => {
  process.env.OPERATION_KEY_HMAC_KEY_B64 = Buffer.alloc(32, 29).toString("base64");
  process.env.OPERATION_KEY_VERSION = "1";
  process.env.OPERATION_KEY_REALM = "h1-regression";

  dir = await mkdtemp(join(tmpdir(), "smartpm-face-h1-regression-"));
  store = new LocalStore(dir);
  await store.init();
  const memberships = [
    ["mem-submit", ["device.face.submit"]],
    ["mem-review", ["device.face.review"]],
    ["mem-audit", ["device.audit.read"]],
    ["mem-race", ["device.face.submit"]],
  ];
  await store.transact(
    [ref("organizations", orgId), ...memberships.map(([id]) => ref("org_memberships", id))],
    () => [
      {
        collection: "organizations",
        id: orgId,
        data: { name: "H1 回归组织", status: "active", revision: 1 },
      },
      ...memberships.map(([id, permissions]) => ({
        collection: "org_memberships",
        id,
        data: {
          orgId,
          status: "active",
          role: "admin",
          principalType: "adminAccount",
          principalId: id,
          permissions,
          revision: 1,
        },
      })),
    ],
    audit,
  );
  await Promise.all(["file-submit", "file-stale", "file-queue", "file-revision", "file-visibility"].map(seedFile));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("H1-01 submit 只接受最小输入并保存私密文件 revision 绑定", async () => {
  const result = await service("mem-submit").submit(
    { personId: "person-submit", sourceFileId: "file-submit" },
    { idempotencyKey: "h1-submit-00000001" },
  );
  const credential = await store.get("face_credentials", result.credentialId, orgId);
  assert.equal(result.reviewState, "submitted");
  assert.equal(credential.sourceFileId, "file-submit");
  assert.equal(credential.sourceFileRevision, 1);
  assert.equal(credential.personId, "person-submit");
  assert.equal(credential.revision, 1);
  for (const field of ["deviceId", "grantId", "occupancyId", "cycleId", "validFrom", "validUntil"]) {
    assert.equal(Object.hasOwn(credential, field), false, field);
  }
});

test("H1-02 review 强制权限与 expected revision，且只迁移审核状态", async () => {
  const credential = (await store.list("face_credentials", orgId))
    .find((row) => row.personId === "person-submit");
  await assert.rejects(
    () => service("mem-submit").review(
      credential._id,
      { decision: "approved", expectedRevision: 1 },
      { idempotencyKey: "h1-review-deny-0001" },
    ),
    (error) => error.code === "FORBIDDEN" && error.status === 403,
  );
  const beforeGrants = await store.list("device_access_grants", orgId);
  const beforeJobs = await store.list("device_operation_jobs", orgId);
  const result = await service("mem-review").review(
    credential._id,
    { decision: "approved", expectedRevision: 1 },
    { idempotencyKey: "h1-review-pass-0001" },
  );
  const updated = await store.get("face_credentials", credential._id, orgId);
  assert.deepEqual(result, { credentialId: credential._id, reviewState: "approved" });
  assert.equal(updated.reviewState, "approved");
  assert.equal(updated.revision, 2);
  assert.deepEqual(await store.list("device_access_grants", orgId), beforeGrants);
  assert.deepEqual(await store.list("device_operation_jobs", orgId), beforeJobs);
});

test("H1-03 stale expectedRevision 返回 409 且不改写 credential", async () => {
  const submitted = await service("mem-submit").submit(
    { personId: "person-stale", sourceFileId: "file-stale" },
    { idempotencyKey: "h1-stale-submit-001" },
  );
  const before = structuredClone(await store.get("face_credentials", submitted.credentialId, orgId));
  await assert.rejects(
    () => service("mem-review").review(
      submitted.credentialId,
      { decision: "approved", expectedRevision: 99 },
      { idempotencyKey: "h1-stale-review-001" },
    ),
    (error) => error.code === "REVISION_CONFLICT" && error.status === 409,
  );
  assert.deepEqual(await store.get("face_credentials", submitted.credentialId, orgId), before);
});

test("H1-04 reviewQueue 只返回 submitted 的最小投影", async () => {
  const submitted = await service("mem-submit").submit(
    { personId: "person-queue", sourceFileId: "file-queue" },
    { idempotencyKey: "h1-queue-submit-001" },
  );
  const queue = await service("mem-review").reviewQueue();
  const item = queue.find((row) => row.credentialId === submitted.credentialId);
  assert.ok(item);
  assert.equal(item.reviewState, "submitted");
  assert.deepEqual(Object.keys(item).sort(), [
    "cleanupPending", "credentialId", "displayState", "evidenceScope", "imageState",
    "orgId", "personId", "reviewState", "revision", "submittedAt",
  ].sort());
  for (const field of ["sourceFileId", "sourceFileRevision", "objectKey", "checksum", "checksumPrefix", "bytes"]) {
    assert.equal(Object.hasOwn(item, field), false, field);
  }
});

test("H1-05 queryJob 返回组织内最小 DTO，跨组织保持同态 404", async () => {
  await store.transact(
    [ref("device_operation_jobs", "job-h1-visible"), ref("device_operation_jobs", "job-h1-other")],
    () => [
      {
        collection: "device_operation_jobs",
        id: "job-h1-visible",
        data: {
          orgId, action: "enroll", state: "queued", attempts: 0,
          evidenceScope: "simulated", revision: 1,
        },
      },
      {
        collection: "device_operation_jobs",
        id: "job-h1-other",
        data: {
          orgId: "org-other", action: "enroll", state: "queued", attempts: 0,
          evidenceScope: "simulated", revision: 1,
        },
      },
    ],
    audit,
  );
  const result = await service("mem-audit").queryJob("job-h1-visible");
  assert.deepEqual(result, {
    jobId: "job-h1-visible",
    state: "queued",
    revision: 1,
    attempts: 0,
    lastSuccessAt: null,
    failureReason: null,
  });
  await assert.rejects(
    () => service("mem-audit").queryJob("job-h1-other"),
    (error) => error.code === "NOT_FOUND" && error.status === 404,
  );
});

test("H1-06 prepare 后撤销成员权限，下一次事务立即失败关闭", async () => {
  const base = filesFor("mem-race");
  const racingFiles = {
    prepareReference: async (fileId) => {
      const token = await base.prepareReference(fileId);
      await store.transact([ref("org_memberships", "mem-race")], (state) => [{
        collection: "org_memberships",
        id: "mem-race",
        data: {
          ...state["org_memberships/mem-race"],
          permissions: [],
          revision: 2,
        },
      }], audit);
      return token;
    },
    assertReference: base.assertReference.bind(base),
  };
  const before = await coreSnapshot();
  await assert.rejects(
    () => service("mem-race", { files: racingFiles }).submit(
      { personId: "person-race", sourceFileId: "file-revision" },
      { idempotencyKey: "h1-race-submit-0001" },
    ),
    (error) => error.code === "FILE_NOT_FOUND" && error.status === 404,
  );
  assert.deepEqual(await coreSnapshot(), before);
});

test("H1-07 文件 revision 或私密可见性在 prepare 后变化时失败关闭", async () => {
  await store.transact([ref("org_memberships", "mem-race")], (state) => [{
    collection: "org_memberships",
    id: "mem-race",
    data: {
      ...state["org_memberships/mem-race"],
      permissions: ["device.face.submit"],
      revision: 3,
    },
  }], audit);

  for (const scenario of [
    { fileId: "file-revision", patch: { revision: 2 }, code: "FILE_CHANGED" },
    { fileId: "file-visibility", patch: { visibility: "public" }, code: "FILE_NOT_FOUND" },
  ]) {
    const base = filesFor("mem-race");
    const racingFiles = {
      prepareReference: async (fileId) => {
        const token = await base.prepareReference(fileId);
        await store.transact([ref("file_assets", fileId)], (state) => [{
          collection: "file_assets",
          id: fileId,
          data: { ...state[`file_assets/${fileId}`], ...scenario.patch },
        }], audit);
        return token;
      },
      assertReference: base.assertReference.bind(base),
    };
    const before = await coreSnapshot();
    await assert.rejects(
      () => service("mem-race", { files: racingFiles }).submit(
        { personId: `person-${scenario.fileId}`, sourceFileId: scenario.fileId },
        { idempotencyKey: `h1-${scenario.fileId}-000001` },
      ),
      (error) => error.code === scenario.code,
    );
    assert.deepEqual(await coreSnapshot(), before);
  }
});

test("H1-08 submit/review/reviewQueue/queryJob 全程 Provider 调用为零", () => {
  assert.deepEqual(providerCalls, { enroll: 0, revoke: 0 });
});
