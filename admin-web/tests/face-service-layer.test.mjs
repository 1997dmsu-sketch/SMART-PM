import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalStore } from "../lib/store.mjs";
import { FileService } from "../lib/files.mjs";
import { MockFaceAccessProvider } from "../lib/face-service/index.mjs";
import { FaceCredentialService } from "../lib/face-service/service.mjs";
import { deviceClaimKey, deviceClaimConfig } from "../lib/face-service/collections.mjs";

let store, dir;
const orgId = "org-demo";
const audit = { actor: "system", actorId: "system", action: "测试" };
const ref = (collection, id) => ({ collection, id });
let eligible = { eligible: true, entryIds: [], decisionId: null };
let shared = null;

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

const providerCalls = { enroll: 0, revoke: 0 };
const provider = {
  enrollFace: () => { providerCalls.enroll += 1; throw new Error("Provider 不应被调用"); },
  revokeFace: () => { providerCalls.revoke += 1; throw new Error("Provider 不应被调用"); },
};

const service = (membershipId) =>
  new FaceCredentialService({
    store, orgId,
    actor: { membershipId, actorType: "user", actorId: membershipId },
    files: new FileService(store, orgId, {
      auth: { membershipId },
      actor: { actorType: "user", actorId: membershipId, role: "editor", permissions: ["device.face.submit"] },
    }),
    blacklist, provider, now: () => 1_700_000_000_000,
  });

const counts = async () => {
  const of = async (name) => (await store.list(name, orgId)).length;
  return {
    grants: await of("device_access_grants"),
    jobs: await of("device_operation_jobs"),
    slots: await of("grant_slot_claims"),
    claims: await of("device_claims"),
    logs: await of("device_operation_logs"),
    keys: await of("operation_keys"),
  };
};

async function approvedCredential(suffix) {
  const out = await service("mem-submit").submit(
    { personId: `person-${suffix}`, sourceFileId: "file-1" },
    { idempotencyKey: `idem-sub-${suffix}-00000001` },
  );
  await service("mem-review").review(
    out.credentialId,
    { decision: "approved", expectedRevision: 1 },
    { idempotencyKey: `idem-rev-${suffix}-00000001` },
  );
  return out.credentialId;
}

const grantInput = (credentialId) => ({
  credentialId,
  expectedCredentialRevision: 2,
  deviceId: "device-1",
  occupancyId: "occ-1",
  cycleId: "cycle-1",
  identityApplicationId: "id-1",
  validFrom: 1000,
  validUntil: 2000,
});

before(async () => {
  process.env.DEVICE_CLAIM_HMAC_KEY_B64 = Buffer.alloc(32, 7).toString("base64");
  process.env.OPERATION_KEY_HMAC_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
  process.env.OPERATION_KEY_VERSION = "1";
  process.env.OPERATION_KEY_REALM = "test-realm";
  process.env.DEVICE_CLAIM_KEY_VERSION = "1";
  process.env.DEVICE_DIGEST_REALM = "test-realm";

  dir = await mkdtemp(join(tmpdir(), "smartpm-face-h2-"));
  store = new LocalStore(dir);
  await store.init();
  const memberships = [
    ["mem-submit", ["device.face.submit"]],
    ["mem-review", ["device.face.review"]],
    ["mem-manage", ["device.access.manage"]],
  ];
  await store.transact(
    [ref("organizations", orgId), ref("file_assets", "file-1"), ref("access_devices", "device-1"), ref("access_devices", "device-2"), ref("access_devices", "device-3"), ref("access_devices", "device-inactive"), ref("access_devices", "device-other"), ...memberships.map(([id]) => ref("org_memberships", id))],
    () => [
      { collection: "organizations", id: orgId, data: { name: "人脸组织", status: "active", revision: 1 } },
      { collection: "file_assets", id: "file-1", data: { orgId, purpose: "face-biometric", status: "ready", visibility: "private", mimeType: "image/jpeg", size: 1024, objectKey: "private/f.jpg", revision: 1 } },
      { collection: "access_devices", id: "device-1", data: { orgId, status: "active", provider: "hikvision", serialNumber: "SN-1", revision: 1 } },
      { collection: "access_devices", id: "device-2", data: { orgId, status: "active", provider: "hikvision", serialNumber: "SN-2", revision: 1 } },
      { collection: "access_devices", id: "device-3", data: { orgId, status: "active", provider: "hikvision", serialNumber: "SN-3", revision: 1 } },
      { collection: "access_devices", id: "device-inactive", data: { orgId, status: "disabled", provider: "hikvision", serialNumber: "SN-X", revision: 1 } },
      { collection: "access_devices", id: "device-other", data: { orgId: "org-other", status: "active", provider: "hikvision", serialNumber: "SN-O", revision: 1 } },
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

test("createGrant：同事务写 domain/claim/slot/pending grant/queued job/log/op key，Provider 零调用", async () => {
  const credentialId = await approvedCredential("a");
  const input = grantInput(credentialId);
  const key = "idem-grant-a-0001";
  const out = await service("mem-manage").createGrant(input, { idempotencyKey: key });
  shared = { input, key, result: out };
  assert.equal(out.evidenceScope, "simulated");

  const grant = (await store.list("device_access_grants", orgId))[0];
  const job = (await store.list("device_operation_jobs", orgId))[0];
  const claim = (await store.list("device_claims", orgId))[0];
  const slot = (await store.list("grant_slot_claims", orgId))[0];
  const logs = await store.list("device_operation_logs", orgId);
  assert.equal(grant.state, "pending");
  assert.equal(job.state, "queued");
  assert.equal(job.leaseOwner, null);
  assert.equal(claim.state, "active");
  assert.equal(slot.state, "active");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].jobId, job._id);
  assert.equal((await store.list("device_digest_domains")).length, 2);
  assert.deepEqual(providerCalls, { enroll: 0, revoke: 0 });
});

test("幂等重放：同键同摘要返回旧结果、零新增、零 Provider；异摘要 CONFLICT", async () => {
  const manager = service("mem-manage");
  const before = await counts();
  const replay = await manager.createGrant(shared.input, { idempotencyKey: shared.key });
  assert.deepEqual(replay, shared.result);
  assert.deepEqual(await counts(), before);
  await assert.rejects(
    () => manager.createGrant({ ...shared.input, cycleId: "cycle-2" }, { idempotencyKey: shared.key }),
    (e) => e.code === "CONFLICT",
  );
  assert.deepEqual(providerCalls, { enroll: 0, revoke: 0 });
});

test("资格阻断与未知/停用/跨组织设备：零写入", async () => {
  const credentialId = await approvedCredential("c");
  const manager = service("mem-manage");
  const before = await counts();
  const input = { ...grantInput(credentialId), deviceId: "device-2" };

  eligible = { eligible: false, code: "BLACKLIST_REVIEW_REQUIRED", entryIds: ["e1"], decisionId: null };
  await assert.rejects(
    () => manager.createGrant(input, { idempotencyKey: "idem-grant-c-0001" }),
    (e) => e.status === 409,
  );
  eligible = { eligible: true, entryIds: [], decisionId: null };

  await assert.rejects(
    () => manager.createGrant({ ...input, deviceId: "missing" }, { idempotencyKey: "idem-grant-c-0002" }),
    (e) => e.status === 404,
  );
  await assert.rejects(
    () => manager.createGrant({ ...input, deviceId: "device-inactive" }, { idempotencyKey: "idem-grant-c-0003" }),
    (e) => e.status === 409,
  );
  await assert.rejects(
    () => manager.createGrant({ ...input, deviceId: "device-other" }, { idempotencyKey: "idem-grant-c-0004" }),
    (e) => e.status === 404,
  );
  await assert.rejects(
    () => manager.createGrant({ ...input, expectedCredentialRevision: 99 }, { idempotencyKey: "idem-grant-c-0005" }),
    (e) => e.code === "REVISION_CONFLICT",
  );
  assert.deepEqual(await counts(), before);
});

test("claim 冲突：其他 grant 占用设备 → DEVICE_CLAIMED 零写入", async () => {
  const credentialId = await approvedCredential("d");
  const manager = service("mem-manage");
  const k1 = deviceClaimConfig(process.env);
  const claimId = deviceClaimKey({ provider: "hikvision", digestRealm: k1.realm, serial: "SN-3", key: k1.key, version: k1.version });
  await store.transact([ref("device_claims", claimId)], () => [{
    collection: "device_claims", id: claimId,
    data: { orgId, deviceId: "device-3", grantId: "grant-other", state: "active", revision: 1 },
  }], audit);
  const before = await counts();
  await assert.rejects(
    () => manager.createGrant({ ...grantInput(credentialId), deviceId: "device-3" }, { idempotencyKey: "idem-grant-d-0001" }),
    (e) => e.code === "DEVICE_CLAIMED",
  );
  assert.deepEqual(await counts(), before);
});

test("撤权仍为 STAGE_CLOSED，零写入零 Provider", async () => {
  const before = await counts();
  await assert.rejects(
    () => service("mem-manage").revoke("grant-1", { idempotencyKey: "idem-revoke-h2-0001" }),
    (e) => e.code === "STAGE_CLOSED",
  );
  assert.deepEqual(await counts(), before);
  assert.deepEqual(providerCalls, { enroll: 0, revoke: 0 });
});

test("operation_keys 元数据与三条路径共用同一 domain", async () => {
  const keys = await store.list("operation_keys", orgId);
  assert.ok(keys.length >= 3);
  for (const record of keys) {
    assert.equal(record.realm, "test-realm");
    assert.equal(record.keyVersion, 1);
    assert.match(record.requestDigest, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(record).includes("idem-"), false);
  }
  assert.equal((await store.list("operation_key_domains")).length, 2);
});

test("K2 配置缺失：503 NOT_CONFIGURED 且零写入", async () => {
  const saved = process.env.OPERATION_KEY_HMAC_KEY_B64;
  delete process.env.OPERATION_KEY_HMAC_KEY_B64;
  const before = await counts();
  await assert.rejects(
    () => service("mem-submit").submit(
      { personId: "person-k2", sourceFileId: "file-1" },
      { idempotencyKey: "idem-k2-missing-0001" },
    ),
    (e) => e.code === "NOT_CONFIGURED" && e.status === 503,
  );
  process.env.OPERATION_KEY_HMAC_KEY_B64 = saved;
  assert.deepEqual(await counts(), before);
});
