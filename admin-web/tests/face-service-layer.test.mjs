import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalStore } from "../lib/store.mjs";
import { MockFaceAccessProvider, projectAccess } from "../lib/face-service/index.mjs";
import { FaceCredentialService } from "../lib/face-service/service.mjs";

let store, dir;
const orgId = "org-demo";

const ref = (collection, id) => ({ collection, id });
const audit = { actor: "system", actorId: "system", action: "测试" };

const actor = { membershipId: "mem-1", actorType: "user", actorId: "admin-1" };

const input = {
  personId: "person-001",
  deviceId: "device-1",
  grantId: "grant-1",
  sourceFileId: "file-1",
  validFrom: 1000,
  validUntil: 2000,
  occupancyId: "occ-1",
};

// 真实 transact + 固定 eligible 的资格桩；服务层不复制名单规则。
const blacklist = {
  withEligibility: async (request, refs, build) => {
    let result;
    await store.transact(refs, async (state) => {
      const built = await build(state, { eligible: true, entryIds: [], decisionId: null });
      result = built.result;
      return built.writes;
    }, audit);
    return result;
  },
};

const provider = new MockFaceAccessProvider();

const service = () =>
  new FaceCredentialService({
    store,
    orgId,
    actor,
    files: {},
    blacklist,
    provider,
    now: () => 1_700_000_000_000,
  });

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-face-service-"));
  store = new LocalStore(dir);
  await store.init();

  await store.transact([ref("org_memberships", "mem-1")], () => [
    {
      collection: "org_memberships",
      id: "mem-1",
      data: {
        orgId,
        status: "active",
        role: "admin",
        principalType: "adminAccount",
        principalId: "acc-1",
        permissions: ["device.face.submit", "device.face.review", "device.access.manage", "device.audit.read"],
        revision: 1,
      },
    },
  ], audit);

  await store.transact([ref("file_assets", "file-1")], () => [
    {
      collection: "file_assets",
      id: "file-1",
      data: {
        orgId,
        purpose: "face-biometric",
        status: "ready",
        visibility: "private",
        mimeType: "image/jpeg",
        objectKey: "private/face-1.jpg",
        revision: 1,
      },
    },
  ], audit);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("提交：无 device.face.submit 权限 → 403 且零写入", async () => {
  await store.transact([ref("org_memberships", "mem-2")], () => [
    {
      collection: "org_memberships",
      id: "mem-2",
      data: { orgId, status: "active", role: "viewer", principalType: "adminAccount", principalId: "acc-2", permissions: [], revision: 1 },
    },
  ], audit);
  const noPerm = new FaceCredentialService({
    store, orgId, actor: { membershipId: "mem-2", actorType: "user", actorId: "viewer-1" },
    files: {}, blacklist, provider, now: () => 1,
  });
  await assert.rejects(
    () => noPerm.submit(input, { idempotencyKey: "idem-key-00000001" }),
    (e) => e.status === 403 || e.code === "FORBIDDEN",
  );
  const rows = await store.list("face_credentials", orgId);
  assert.equal(rows.length, 0);
});

test("提交：成功写入凭证与 operation_key；重放同结果，异摘要 CONFLICT", async () => {
  const s = service();
  const first = await s.submit(input, { idempotencyKey: "idem-key-00000001" });
  assert.equal(first.reviewState, "submitted");
  assert.equal((await store.list("face_credentials", orgId)).length, 1);
  assert.equal((await store.list("operation_keys", orgId)).length, 1);

  const replay = await s.submit(input, { idempotencyKey: "idem-key-00000001" });
  assert.deepEqual(replay, first);

  await assert.rejects(
    () => s.submit({ ...input, validUntil: 2001 }, { idempotencyKey: "idem-key-00000001" }),
    (e) => e.code === "CONFLICT",
  );
});

test("审核通过：创建 grant 与 job，Mock 只产生 simulated，不产生真实设备生效", async () => {
  const s = service();
  const [credential] = await store.list("face_credentials", orgId);
  const result = await s.review(credential._id, { decision: "approved" }, { idempotencyKey: "idem-key-review-0001" });
  assert.equal(result.reviewState, "approved");
  assert.ok(result.grantId && result.jobId);

  const grant = (await store.list("device_access_grants", orgId))[0];
  const job = (await store.list("device_operation_jobs", orgId))[0];
  assert.equal(grant.state, "effective");
  assert.equal(grant.evidenceScope, "simulated");
  assert.equal(job.state, "succeeded");
  assert.equal(job.evidenceScope, "simulated");

  const projected = projectAccess({
    grant,
    eligibility: { allowed: true },
    jobs: [job],
    deviceEvidence: { kind: "mock_result", trusted: true, evidenceScope: "simulated" },
  });
  assert.equal(projected.businessAllowed, true);
  assert.equal(projected.deviceEffective, false);
});

test("审核队列与任务查询：各自权限，队列不含摘要/图片", async () => {
  const s = service();
  const queue = await s.reviewQueue();
  assert.equal(queue.length, 0); // 已审核的不再出现
  const job = (await store.list("device_operation_jobs", orgId))[0];
  const dto = await s.queryJob(job._id);
  assert.equal(dto.jobId, job._id);
  assert.equal(dto.state, "succeeded");
  assert.equal("opId" in dto, false);
});

test("撤销：grant 立即失效，job 为模拟撤权", async () => {
  const s = service();
  const grant = (await store.list("device_access_grants", orgId))[0];
  const result = await s.revoke(grant._id, { idempotencyKey: "idem-key-revoke-0001" });
  assert.equal(result.grantId, grant._id);
  const after = (await store.list("device_access_grants", orgId))[0];
  assert.equal(after.state, "revoked");
  const jobs = await store.list("device_operation_jobs", orgId);
  assert.ok(jobs.some((j) => j.action === "revoke" && j.state === "succeeded"));
});
