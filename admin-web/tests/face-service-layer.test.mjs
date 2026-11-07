import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalStore } from "../lib/store.mjs";
import { FileService } from "../lib/files.mjs";
import { MockFaceAccessProvider } from "../lib/face-service/index.mjs";
import { FaceCredentialService } from "../lib/face-service/service.mjs";

let store, dir;
const orgId = "org-demo";
const audit = { actor: "system", actorId: "system", action: "测试" };
const ref = (collection, id) => ({ collection, id });

const submitInput = { personId: "person-001", sourceFileId: "file-1" };
const grantInput = {
  credentialId: "",
  expectedCredentialRevision: 2,
  deviceId: "device-1",
  occupancyId: "occ-1",
  cycleId: "cycle-1",
  identityApplicationId: "id-1",
  validFrom: 1000,
  validUntil: 2000,
};

const service = (membershipId, { files, provider } = {}) =>
  new FaceCredentialService({
    store,
    orgId,
    actor: { membershipId, actorType: "user", actorId: membershipId },
    files: files || new FileService(store, orgId, {
      auth: { membershipId },
      actor: { actorType: "user", actorId: membershipId, role: "editor", permissions: ["device.face.submit"] },
    }),
    blacklist: {},
    provider: provider || new MockFaceAccessProvider(),
    now: () => 1_700_000_000_000,
  });

const counts = async () => {
  const of = async (name) => (await store.list(name, orgId)).length;
  return {
    credentials: await of("face_credentials"),
    grants: await of("device_access_grants"),
    jobs: await of("device_operation_jobs"),
    slots: await of("grant_slot_claims"),
    claims: await of("device_claims"),
    logs: await of("device_operation_logs"),
    keys: await of("operation_keys"),
  };
};

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-face-h1-"));
  store = new LocalStore(dir);
  await store.init();
  const memberships = [
    ["mem-submit", ["device.face.submit"]],
    ["mem-review", ["device.face.review"]],
    ["mem-manage", ["device.access.manage"]],
    ["mem-audit", ["device.audit.read"]],
  ];
  await store.transact(
    [ref("organizations", orgId), ref("file_assets", "file-1"), ...memberships.map(([id]) => ref("org_memberships", id))],
    () => [
      { collection: "organizations", id: orgId, data: { name: "人脸组织", status: "active", revision: 1 } },
      { collection: "file_assets", id: "file-1", data: { orgId, purpose: "face-biometric", status: "ready", visibility: "private", mimeType: "image/jpeg", size: 1024, objectKey: "private/f.jpg", revision: 1 } },
      ...memberships.map(([id, permissions]) => ({
        collection: "org_memberships", id,
        data: { orgId, status: "active", role: "admin", principalType: "adminAccount", principalId: id, permissions, revision: 1 },
      })),
    ],
    audit,
  );
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("submit 使用最小入参，credential 不含设备/授权字段", async () => {
  const out = await service("mem-submit").submit(submitInput, { idempotencyKey: "idem-submit-00000001" });
  assert.equal(out.reviewState, "submitted");
  const record = (await store.list("face_credentials", orgId))[0];
  for (const key of ["deviceId", "grantId", "occupancyId", "validFrom", "validUntil"]) {
    assert.equal(key in record, false, `${key} 不应写入 credential`);
  }
  assert.equal(record.sourceFileId, "file-1");
  assert.equal(record.sourceFileRevision, 1);
  assert.equal(record.personId, "person-001");
  assert.equal(record.revision, 1);
});

test("review 通过后 revision 为 2，且不创建 grant/job", async () => {
  const credential = (await store.list("face_credentials", orgId))[0];
  const before = await counts();
  const out = await service("mem-review").review(credential._id, { decision: "approved", expectedRevision: 1 }, { idempotencyKey: "idem-review-000001" });
  assert.equal(out.reviewState, "approved");
  const after = await counts();
  assert.equal(after.grants, before.grants);
  assert.equal(after.jobs, before.jobs);
  assert.equal((await store.list("face_credentials", orgId))[0].revision, 2);
});

test("createGrant 阶段关闭：STAGE_CLOSED 且零 grant/job/slot/claim/log/op key", async () => {
  const credential = (await store.list("face_credentials", orgId))[0];
  const before = await counts();
  const calls = { enroll: 0, revoke: 0 };
  const spy = {
    enrollFace: () => { calls.enroll += 1; throw new Error("provider 不应被调用"); },
    revokeFace: () => { calls.revoke += 1; throw new Error("provider 不应被调用"); },
  };
  await assert.rejects(
    () => service("mem-manage", { provider: spy }).createGrant({ ...grantInput, credentialId: credential._id }, { idempotencyKey: "idem-grant-00000001" }),
    (e) => e.code === "STAGE_CLOSED" && e.status === 501,
  );
  assert.deepEqual(await counts(), before);
  assert.deepEqual(calls, { enroll: 0, revoke: 0 });
});

test("revoke 阶段关闭：STAGE_CLOSED 且零写入", async () => {
  const before = await counts();
  const calls = { enroll: 0, revoke: 0 };
  const spy = {
    enrollFace: () => { calls.enroll += 1; throw new Error("provider 不应被调用"); },
    revokeFace: () => { calls.revoke += 1; throw new Error("provider 不应被调用"); },
  };
  await assert.rejects(
    () => service("mem-manage", { provider: spy }).revoke("grant-001", { idempotencyKey: "idem-revoke-0000001" }),
    (e) => e.code === "STAGE_CLOSED" && e.status === 501,
  );
  assert.deepEqual(await counts(), before);
  assert.deepEqual(calls, { enroll: 0, revoke: 0 });
});

test("权限分离：submitter 不能 review/createGrant；reviewer 不能 createGrant", async () => {
  const credential = (await store.list("face_credentials", orgId))[0];
  await assert.rejects(
    () => service("mem-submit").review(credential._id, { decision: "approved" }, { idempotencyKey: "idem-x-0000000001" }),
    (e) => e.status === 403,
  );
  await assert.rejects(
    () => service("mem-submit").createGrant({ ...grantInput, credentialId: credential._id }, { idempotencyKey: "idem-x-0000000002" }),
    (e) => e.status === 403,
  );
  await assert.rejects(
    () => service("mem-review").createGrant({ ...grantInput, credentialId: credential._id }, { idempotencyKey: "idem-x-0000000003" }),
    (e) => e.status === 403,
  );
});

test("竞态：prepare 后撤销权限 / 修改文件 revision 均零写入", async () => {
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
  const svc = service(membershipId, { files: racing });
  const before = await counts();
  await assert.rejects(
    () => svc.submit({ personId: "person-race", sourceFileId: "file-1" }, { idempotencyKey: "idem-race-00000001" }),
    (e) => e.status === 404,
  );
  assert.deepEqual(await counts(), before);

  await store.transact([ref("org_memberships", membershipId)], (state) => [{
    collection: "org_memberships", id: membershipId,
    data: { ...state[`org_memberships/${membershipId}`], permissions: ["device.face.submit"] },
  }], audit);

  const base2 = new FileService(store, orgId, {
    auth: { membershipId },
    actor: { actorType: "user", actorId: membershipId, role: "editor", permissions: ["device.face.submit"] },
  });
  const racing2 = {
    prepareReference: async (fileId) => {
      const token = await base2.prepareReference(fileId);
      const file = (await store.list("file_assets", orgId)).find((f) => f._id === fileId);
      await store.transact([ref("file_assets", fileId)], () => [{
        collection: "file_assets", id: fileId, data: { ...file, revision: file.revision + 1 },
      }], audit);
      return token;
    },
    assertReference: base2.assertReference.bind(base2),
  };
  const svc2 = service(membershipId, { files: racing2 });
  const before2 = await counts();
  await assert.rejects(
    () => svc2.submit({ personId: "person-race-2", sourceFileId: "file-1" }, { idempotencyKey: "idem-race-00000002" }),
    (e) => e.code === "FILE_CHANGED",
  );
  assert.deepEqual(await counts(), before2);
});

test("跨组织任务查询同态 404", async () => {
  await store.transact([ref("device_operation_jobs", "job-other-org")], () => [{
    collection: "device_operation_jobs",
    id: "job-other-org",
    data: { orgId: "org-other", revision: 1, action: "enroll", state: "queued", evidenceScope: "simulated" },
  }], audit);
  await assert.rejects(
    () => service("mem-audit").queryJob("job-other-org"),
    (e) => e.status === 404 || e.code === "NOT_FOUND",
  );
});
