import { makeAccessDeviceFixture, makeDigestDomainFixture, makeOwnerClaimFixture } from "./helpers/face-fixtures.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalStore } from "../lib/store.mjs";
import { FileService } from "../lib/files.mjs";
import { MockFaceAccessProvider } from "../lib/face-service/index.mjs";
import { FaceCredentialService } from "../lib/face-service/service.mjs";
import { deviceClaimKey, deviceClaimConfig, operationKey, operationKeyConfig } from "../lib/face-service/collections.mjs";

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
    [ref("organizations", orgId), ref("file_assets", "file-1"), ref("access_devices", "device-1"), ref("access_devices", "device-2"), ref("access_devices", "device-3"), ref("access_devices", "device-inactive"), ref("access_devices", "device-other"), ref("access_devices", "device-4"), ref("access_devices", "device-5"), ref("access_devices", "device-replay"), ...memberships.map(([id]) => ref("org_memberships", id))],
    () => [
      { collection: "organizations", id: orgId, data: { name: "人脸组织", status: "active", revision: 1 } },
      { collection: "file_assets", id: "file-1", data: { orgId, purpose: "face-biometric", status: "ready", visibility: "private", mimeType: "image/jpeg", size: 1024, objectKey: "private/f.jpg", revision: 1 } },
      { collection: "access_devices", id: "device-1", data: { orgId, status: "active", provider: "hikvision", serialNumber: "SN-1", revision: 1 } },
      { collection: "access_devices", id: "device-2", data: { orgId, status: "active", provider: "hikvision", serialNumber: "SN-2", revision: 1 } },
      { collection: "access_devices", id: "device-3", data: { orgId, status: "active", provider: "hikvision", serialNumber: "SN-3", revision: 1 } },
      { collection: "access_devices", id: "device-inactive", data: { orgId, status: "disabled", provider: "hikvision", serialNumber: "SN-X", revision: 1 } },
      { collection: "access_devices", id: "device-other", data: { orgId: "org-other", status: "active", provider: "hikvision", serialNumber: "SN-O", revision: 1 } },
      { collection: "access_devices", id: "device-4", data: { orgId, status: "active", provider: "hikvision", serialNumber: "SN-4", revision: 1 } },
      { collection: "access_devices", id: "device-5", data: { orgId, status: "active", provider: "hikvision", serialNumber: "SN-5", revision: 1 } },
      { collection: "access_devices", id: "device-replay", data: { orgId, status: "active", provider: "hikvision", serialNumber: "SN-R", revision: 1 } },
      ...memberships.map(([id, permissions]) => ({
        collection: "org_memberships", id,
        data: { orgId, status: "active", role: "admin", principalType: "adminAccount", principalId: id, permissions, revision: 1 },
      })),
    ],
    audit,
  );

  const ids = ["device-1", "device-2", "device-3", "device-4", "device-5", "device-replay", "device-inactive", "device-other"];
  const deviceWrites = ids.map((id) => makeAccessDeviceFixture({
    id,
    orgId: id === "device-other" ? "org-other" : orgId,
    status: id === "device-inactive" ? "disabled" : "active",
  }));
  const claimWrites = ids.map((id) => makeOwnerClaimFixture({
    deviceId: id,
    orgId: id === "device-other" ? "org-other" : orgId,
  }));
  await store.transact(
    [...ids.flatMap((id) => [ref("access_devices", id), ref("device_claims", `claim-${id}`)]),
      ...makeDigestDomainFixture().map((w) => ref(w.collection, w.id))],
    () => [...deviceWrites, ...claimWrites, ...makeDigestDomainFixture()],
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
  const claim = (await store.list("device_claims")).find((c) => c._id === "claim-device-1");
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

test("owner claim 归属冲突：DEVICE_CLAIM_CONFLICT 且零写入", async () => {
  const credentialId = await approvedCredential("d");
  const claimId = "claim-device-3";
  const original = structuredClone((await store.list("device_claims")).find((c) => c._id === claimId));
  await store.transact([ref("device_claims", claimId)], () => [{
    collection: "device_claims", id: claimId,
    data: { ...original, ownerOrgId: "org-other" },
  }], audit);
  const before = await counts();
  await assert.rejects(
    () => service("mem-manage").createGrant(
      { ...grantInput(credentialId), deviceId: "device-3" },
      { idempotencyKey: "idem-grant-d-0000001" },
    ),
    (e) => e.code === "DEVICE_CLAIM_CONFLICT",
  );
  assert.deepEqual(await counts(), before);
  await store.transact([ref("device_claims", claimId)], () => [{
    collection: "device_claims", id: claimId, data: { ...original },
  }], audit);
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

test("重放结果损坏（null/{}/[]/错 ID/异常时间）→ CONFLICT、Provider 零调用、业务无变化", async () => {
  process.env.OPERATION_KEY_HMAC_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
  process.env.OPERATION_KEY_VERSION = "1";
  process.env.OPERATION_KEY_REALM = "test-realm";

  const credentialId = await approvedCredential("e");
  const actor = service("mem-manage");
  const input = { ...grantInput(credentialId), deviceId: "device-replay" };
  const idempotencyKey = "idem-corrupt-result-0001";
  const created = await actor.createGrant(input, { idempotencyKey });

  const config = operationKeyConfig(process.env);
  const expectedOpKey = operationKey({
    orgId, method: "face.grant", actorType: "user", actorId: "mem-manage",
    idempotencyKey, config,
  });
  const row = (await store.list("operation_keys", orgId)).find((r) => r._id === expectedOpKey);
  assert.ok(row, "expected op key 必须存在");
  const original = structuredClone(row);

  const snapshot = async () => structuredClone({
    grants: await store.list("device_access_grants", orgId),
    jobs: await store.list("device_operation_jobs", orgId),
    slots: await store.list("grant_slot_claims", orgId),
    claims: await store.list("device_claims", orgId),
    logs: await store.list("device_operation_logs", orgId),
  });
  const baseline = await snapshot();
  const callsBefore = { ...providerCalls };

  const corruptions = [
    { result: null },
    { result: {} },
    { result: [] },
    { result: { ...original.result, grantId: "grant-wrong" } },
    { result: { ...original.result, jobId: "job-wrong" } },
    { result: { ...original.result, evidenceScope: "device_verified" } },
    { createdAt: null },
    { createdAt: -1 },
    { createdAt: Number.MAX_SAFE_INTEGER + 2 },
  ];
  for (const corruption of corruptions) {
    // 每轮先恢复原始记录，再单独应用一项损坏
    await store.transact([ref("operation_keys", expectedOpKey)], () => [{
      collection: "operation_keys", id: expectedOpKey, data: { ...original },
    }], audit);
    await store.transact([ref("operation_keys", expectedOpKey)], () => [{
      collection: "operation_keys", id: expectedOpKey, data: { ...corruption },
    }], audit);

    await assert.rejects(
      () => actor.createGrant(input, { idempotencyKey }),
      (e) => e.code === "CONFLICT" && e.status === 409,
    );
    assert.deepEqual(await snapshot(), baseline);
    assert.deepEqual(providerCalls, callsBefore);
  }
});

test("domain 损坏 → DOMAIN_INCOMPLETE 且业务零变化", async () => {
  const credentialId = await approvedCredential("f");
  const [head] = (await store.list("operation_key_domains")).filter((d) => d.kind === "head");
  await store.transact([ref("operation_key_domains", head._id)], (state) => [{
    collection: "operation_key_domains", id: head._id,
    data: { ...state["operation_key_domains/" + head._id], kind: "version" },
  }], audit);
  const before = await counts();
  await assert.rejects(
    () => service("mem-manage").createGrant({ ...grantInput(credentialId), deviceId: "device-5" }, { idempotencyKey: "idem-grant-f-0000001" }),
    (e) => e.code === "DOMAIN_INCOMPLETE",
  );
  assert.deepEqual(await counts(), before);
});

test("换钥后授权失败关闭且业务集合零变化", async () => {
  const headRec = (await store.list("operation_key_domains")).find((d) => d._id.startsWith("op-domain:") && !d._id.startsWith("op-domain-version"));
  if (headRec && headRec.kind !== "head") {
    await store.transact([ref("operation_key_domains", headRec._id)], (state) => [{
      collection: "operation_key_domains", id: headRec._id,
      data: { ...state["operation_key_domains/" + headRec._id], kind: "head" },
    }], audit);
  }
  const credentialId = await approvedCredential("g");
  const savedKey = process.env.OPERATION_KEY_HMAC_KEY_B64;
  process.env.OPERATION_KEY_HMAC_KEY_B64 = Buffer.alloc(32, 11).toString("base64");
  const before = await counts();
  await assert.rejects(
    () => service("mem-manage").createGrant({ ...grantInput(credentialId), deviceId: "device-4" }, { idempotencyKey: "idem-grant-g-0000001" }),
    (e) => e.code === "DOMAIN_MISMATCH",
  );
  process.env.OPERATION_KEY_HMAC_KEY_B64 = savedKey;
  assert.deepEqual(await counts(), before);
});

test("同设备不同住户不同 slot 均成功，owner claim 内容不变", async () => {
  const p1 = await approvedCredential("h");
  const p2 = await approvedCredential("i");
  const claimsBefore = structuredClone(await store.list("device_claims"));
  const first = await service("mem-manage").createGrant(
    { ...grantInput(p1), deviceId: "device-3", cycleId: "cycle-h1" },
    { idempotencyKey: "idem-grant-h-0000001" },
  );
  const second = await service("mem-manage").createGrant(
    { ...grantInput(p2), deviceId: "device-3", cycleId: "cycle-h2" },
    { idempotencyKey: "idem-grant-i-0000001" },
  );
  assert.ok(first.grantId && second.grantId);
  assert.deepEqual(await store.list("device_claims"), claimsBefore);
});

test("同 person/device/cycle 第二次请求 → GRANT_SLOT_CONFLICT 零写入", async () => {
  const credentialId = await approvedCredential("j");
  const input = { ...grantInput(credentialId), deviceId: "device-2", cycleId: "cycle-j1" };
  await service("mem-manage").createGrant(input, { idempotencyKey: "idem-grant-j-0000001" });
  const before = await counts();
  await assert.rejects(
    () => service("mem-manage").createGrant(input, { idempotencyKey: "idem-grant-j-0000002" }),
    (e) => e.code === "GRANT_SLOT_CONFLICT",
  );
  assert.deepEqual(await counts(), before);
});

test("released slot 也不得复用", async () => {
  const credentialId = await approvedCredential("k");
  const input = { ...grantInput(credentialId), deviceId: "device-2", cycleId: "cycle-k1" };
  const created = await service("mem-manage").createGrant(input, { idempotencyKey: "idem-grant-k-0000001" });
  const grant = (await store.list("device_access_grants", orgId)).find((g) => g._id === created.grantId);
  const slot = (await store.list("grant_slot_claims", orgId)).find((r) => r.activeClaimId === created.grantId);
  await store.transact([ref("grant_slot_claims", slot._id)], () => [{
    collection: "grant_slot_claims", id: slot._id,
    data: { ...slot, activeClaimId: undefined, state: "released", releasedAt: 5, releasedByJobId: created.jobId },
  }], audit);
  const before = await counts();
  await assert.rejects(
    () => service("mem-manage").createGrant(input, { idempotencyKey: "idem-grant-k-0000002" }),
    (e) => e.code === "GRANT_SLOT_CONFLICT",
  );
  assert.deepEqual(await counts(), before);
});

test("owner claim released / 绑定不一致 → DEVICE_CLAIM_INVALID", async () => {
  const credentialId = await approvedCredential("l");
  const claimId = "claim-device-4";
  const original = structuredClone((await store.list("device_claims")).find((c) => c._id === claimId));
  const released = {
    ...original, state: "released",
    boundDeviceId: undefined, activatedAt: undefined, activatedByAuditId: undefined,
    releasedAt: 5, releasedByAuditId: "audit-2", releaseReason: "retired",
  };
  await store.transact([ref("device_claims", claimId)], () => [{ collection: "device_claims", id: claimId, data: released }], audit);
  const before = await counts();
  await assert.rejects(
    () => service("mem-manage").createGrant(
      { ...grantInput(credentialId), deviceId: "device-4", cycleId: "cycle-l1" },
      { idempotencyKey: "idem-grant-l-0000001" },
    ),
    (e) => e.code === "DEVICE_CLAIM_INVALID",
  );
  assert.deepEqual(await counts(), before);
  await store.transact([ref("device_claims", claimId)], () => [{ collection: "device_claims", id: claimId, data: original }], audit);
});

test("成功写入不含序列号/MAC/IP/原始幂等键", async () => {
  const dump = JSON.stringify({
    grants: await store.list("device_access_grants", orgId),
    jobs: await store.list("device_operation_jobs", orgId),
    slots: await store.list("grant_slot_claims", orgId),
    logs: await store.list("device_operation_logs", orgId),
    keys: await store.list("operation_keys", orgId),
  });
  for (const token of ["serialNumber", "SN-", "MAC", "\"ip\"", "idem-grant", "idem-sub", "idem-rev"]) {
    assert.equal(dump.includes(token), false, token);
  }
  assert.deepEqual(providerCalls, { enroll: 0, revoke: 0 });
});
