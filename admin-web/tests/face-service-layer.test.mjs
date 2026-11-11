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
import { occupancyClaimId, primarySlotId } from "../lib/face-service/eligibility.mjs";
import { deviceClaimKey, deviceClaimConfig, deviceDigestDomainKey, deviceDigestDomainVersionKey, operationKey, operationKeyConfig } from "../lib/face-service/collections.mjs";

let store, dir;
const orgId = "org-demo";
const audit = { actor: "system", actorId: "system", action: "测试" };
const ref = (collection, id) => ({ collection, id });
let eligible = { eligible: true, entryIds: [], decisionId: null };
let shared = null;

const GRANT_FROM = 1_699_999_999_000;
const GRANT_UNTIL = 1_700_000_001_000;
const QUAL_START = 1_600_000_000_000;
const QUAL_END = 1_800_000_000_000;
// credentialId -> 该凭证的完整资格 fixture；H2-b 用例仍只验证设备/ID/slot 契约。
const qualifications = new Map();

const blacklist = {
  withEligibility: async (request, refs, build, _audit, options = {}) => {
    // D75：mock 也必须把同一个 token 对象传入 prepareAttempt 与 beforeEvaluate。
    const token = { personId: request.personId };
    const prepared = options.prepareAttempt
      ? await options.prepareAttempt(token)
      : null;
    const merged = [...refs, ...(prepared?.refs ?? [])];
    let result;
    await store.transact(merged, async (state) => {
      const pre = prepared ? await prepared.beforeEvaluate(state, token) : null;
      const built = await build(state, eligible, pre);
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

async function seedQualification(suffix, cycleId) {
  const personId = `person-${suffix}`;
  const identityApplicationId = `id-${suffix}`;
  const occupancyId = `occ-${suffix}`;
  const roomId = `room-${suffix}`;
  const floorId = `floor-${suffix}`;
  const buildingId = `building-${suffix}`;
  const communityId = `community-${suffix}`;
  const writes = [
    {
      collection: "persons", id: personId,
      data: { orgId, status: "active", userId: null, revision: 1 },
    },
    {
      collection: "identity_applications", id: identityApplicationId,
      data: {
        orgId, personId, state: "approved",
        identityDigest: `digest-${suffix}`, keyVersion: 1, revision: 1,
      },
    },
    {
      collection: "occupancies", id: occupancyId,
      data: {
        orgId, personId, roomId, cycleId, role: "primary", state: "active",
        startsAt: QUAL_START, endsAt: QUAL_END, sponsorOccupancyId: null, revision: 1,
      },
    },
    {
      collection: "occupancy_cycles", id: cycleId,
      data: {
        orgId, roomId, state: "active", primaryOccupancyId: occupancyId,
        startsAt: QUAL_START, endsAt: QUAL_END, endedAt: null, epoch: 1, revision: 1,
      },
    },
    {
      collection: "rooms", id: roomId,
      data: {
        orgId, status: "active", floorId, buildingId, communityId, revision: 1,
      },
    },
    {
      collection: "property_catalog", id: floorId,
      data: {
        orgId, kind: "floor", status: "active", parentId: buildingId, revision: 1,
      },
    },
    {
      collection: "property_catalog", id: buildingId,
      data: {
        orgId, kind: "building", status: "active", parentId: communityId, revision: 1,
      },
    },
    {
      collection: "property_catalog", id: communityId,
      data: { orgId, kind: "community", status: "active", revision: 1 },
    },
    {
      collection: "unique_claims", id: occupancyClaimId(orgId, roomId, cycleId, personId),
      data: { orgId, state: "bound", ownerId: occupancyId, revision: 1 },
    },
    {
      collection: "room_primary_slots", id: primarySlotId(orgId, roomId),
      data: {
        orgId, currentCycleId: cycleId, currentOccupancyId: occupancyId,
        currentPersonId: personId, revision: 1,
      },
    },
  ];
  await store.transact(writes.map((w) => ref(w.collection, w.id)), () => writes, audit);
  return { personId, identityApplicationId, occupancyId, cycleId };
}

async function approvedCredential(suffix, { cycleId = "cycle-1" } = {}) {
  const out = await service("mem-submit").submit(
    { personId: `person-${suffix}`, sourceFileId: "file-1" },
    { idempotencyKey: `idem-sub-${suffix}-00000001` },
  );
  await service("mem-review").review(
    out.credentialId,
    { decision: "approved", expectedRevision: 1 },
    { idempotencyKey: `idem-rev-${suffix}-00000001` },
  );
  qualifications.set(out.credentialId, await seedQualification(suffix, cycleId));
  return out.credentialId;
}

const grantInput = (credentialId) => {
  const qualification = qualifications.get(credentialId);
  if (!qualification) throw Error(`缺少资格 fixture: ${credentialId}`);
  return {
    credentialId,
    expectedCredentialRevision: 2,
    deviceId: "device-1",
    occupancyId: qualification.occupancyId,
    cycleId: qualification.cycleId,
    identityApplicationId: qualification.identityApplicationId,
    validFrom: GRANT_FROM,
    validUntil: GRANT_UNTIL,
  };
};

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
  const p1 = await approvedCredential("h", { cycleId: "cycle-h1" });
  const p2 = await approvedCredential("i", { cycleId: "cycle-h2" });
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
  const credentialId = await approvedCredential("j", { cycleId: "cycle-j1" });
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
  const credentialId = await approvedCredential("k", { cycleId: "cycle-k1" });
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
  const credentialId = await approvedCredential("l", { cycleId: "cycle-l1" });
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

const coreSnapshot = async () => structuredClone({
  grants: await store.list("device_access_grants", orgId),
  jobs: await store.list("device_operation_jobs", orgId),
  slots: await store.list("grant_slot_claims", orgId),
  logs: await store.list("device_operation_logs", orgId),
  keys: await store.list("operation_keys", orgId),
});

const businessSnapshot = async () => structuredClone({
  grants: await store.list("device_access_grants", orgId),
  jobs: await store.list("device_operation_jobs", orgId),
  slots: await store.list("grant_slot_claims", orgId),
  claims: await store.list("device_claims"),
  logs: await store.list("device_operation_logs", orgId),
  keys: await store.list("operation_keys", orgId),
  domains: await store.list("device_digest_domains"),
});

const withPreMutation = async (mutate, fn) => {
  const original = blacklist.withEligibility;
  blacklist.withEligibility = async (...args) => {
    await mutate();
    return original(...args);
  };
  try {
    return await fn();
  } finally {
    blacklist.withEligibility = original;
  }
};

test("personId 预读后变化 → REVISION_CONFLICT 且零写入", async () => {
  const credentialId = await approvedCredential("m", { cycleId: "cycle-m1" });
  const manager = service("mem-manage");
  const original = structuredClone((await store.list("face_credentials", orgId)).find((c) => c._id === credentialId));
  const before = await businessSnapshot();
  await withPreMutation(async () => {
    await store.transact([ref("face_credentials", credentialId)], () => [{
      collection: "face_credentials", id: credentialId,
      data: { ...original, personId: "person-other" },
    }], audit);
  }, async () => {
    await assert.rejects(
      () => manager.createGrant({ ...grantInput(credentialId), deviceId: "device-3", cycleId: "cycle-m1" }, { idempotencyKey: "idem-grant-m-0000001" }),
      (e) => e.code === "REVISION_CONFLICT",
    );
  });
  await store.transact([ref("face_credentials", credentialId)], () => [{ collection: "face_credentials", id: credentialId, data: original }], audit);
  assert.deepEqual(await businessSnapshot(), before);
});

test("device revision/claimId 事务前变化 → DEVICE_CLAIM_INVALID 且零写入", async () => {
  const credentialId = await approvedCredential("n1", { cycleId: "cycle-n1" });
  const manager = service("mem-manage");
  const original = structuredClone((await store.list("access_devices")).find((d) => d._id === "device-3"));
  for (const patch of [{ revision: 2 }, { claimId: "claim-missing" }]) {
    const before = await businessSnapshot();
    await withPreMutation(async () => {
      await store.transact([ref("access_devices", "device-3")], () => [{
        collection: "access_devices", id: "device-3", data: { ...original, ...patch },
      }], audit);
    }, async () => {
      await assert.rejects(
        () => manager.createGrant({ ...grantInput(credentialId), deviceId: "device-3", cycleId: "cycle-n1" }, { idempotencyKey: "idem-grant-n-0000001" }),
        (e) => e.code === "DEVICE_CLAIM_INVALID",
      );
    });
    await store.transact([ref("access_devices", "device-3")], () => [{ collection: "access_devices", id: "device-3", data: original }], audit);
    assert.deepEqual(await businessSnapshot(), before);
  }
});

test("K1 domain 损坏 → DOMAIN_INCOMPLETE；配置不一致 → DEVICE_DIGEST_CONFIG_CHANGED", async () => {
  const credentialId = await approvedCredential("n2", { cycleId: "cycle-n2" });
  const manager = service("mem-manage");
  const headId = deviceDigestDomainKey({ provider: "hikvision", digestRealm: "test-realm" });
  const versionId = deviceDigestDomainVersionKey({ provider: "hikvision", digestRealm: "test-realm", version: 1 });
  const head = structuredClone((await store.list("device_digest_domains")).find((d) => d._id === headId));
  const version = structuredClone((await store.list("device_digest_domains")).find((d) => d._id === versionId));

  const cases = [
    { head: { ...head, kind: "version" }, version, code: "DOMAIN_INCOMPLETE" },
    { head: { ...head, provider: "other" }, version: { ...version, provider: "other" }, code: "DEVICE_DIGEST_CONFIG_CHANGED" },
  ];
  for (const scenario of cases) {
    const before = await coreSnapshot();
    await store.transact([ref("device_digest_domains", headId), ref("device_digest_domains", versionId)], () => [
      { collection: "device_digest_domains", id: headId, data: scenario.head },
      { collection: "device_digest_domains", id: versionId, data: scenario.version },
    ], audit);
    await assert.rejects(
      () => manager.createGrant({ ...grantInput(credentialId), deviceId: "device-4", cycleId: "cycle-n2" }, { idempotencyKey: "idem-grant-o-0000001" }),
      (e) => e.code === scenario.code,
    );
    await store.transact([ref("device_digest_domains", headId), ref("device_digest_domains", versionId)], () => [
      { collection: "device_digest_domains", id: headId, data: head },
      { collection: "device_digest_domains", id: versionId, data: version },
    ], audit);
    assert.deepEqual(await coreSnapshot(), before);
  }
});

test("claim 缺失、结构损坏、绑定不一致 → DEVICE_CLAIM_INVALID 且零写入", async () => {
  const credentialId = await approvedCredential("n3", { cycleId: "cycle-n3" });
  const manager = service("mem-manage");
  const deviceId = "device-5";
  const device = structuredClone((await store.list("access_devices")).find((d) => d._id === deviceId));
  const claimId = device.claimId;
  const claim = structuredClone((await store.list("device_claims")).find((c) => c._id === claimId));
  const cases = [
    { device: { ...device, claimId: "claim-missing" }, claim, code: "DEVICE_CLAIM_INVALID" },
    { device, claim: { ...claim, provider: "" }, code: "DEVICE_CLAIM_INVALID" },
    { device, claim: { ...claim, boundDeviceId: "device-x" }, code: "DEVICE_CLAIM_INVALID" },
  ];
  for (const scenario of cases) {
    const before = await coreSnapshot();
    await store.transact([ref("access_devices", deviceId), ref("device_claims", claimId)], () => [
      { collection: "access_devices", id: deviceId, data: scenario.device },
      { collection: "device_claims", id: claimId, data: scenario.claim },
    ], audit);
    await assert.rejects(
      () => manager.createGrant({ ...grantInput(credentialId), deviceId, cycleId: "cycle-n3" }, { idempotencyKey: "idem-grant-p-0000001" }),
      (e) => e.code === "DEVICE_CLAIM_INVALID",
    );
    await store.transact([ref("access_devices", deviceId), ref("device_claims", claimId)], () => [
      { collection: "access_devices", id: deviceId, data: device },
      { collection: "device_claims", id: claimId, data: claim },
    ], audit);
    assert.deepEqual(await coreSnapshot(), before);
  }
});

test("并发竞争同一 slot：仅一个成功，另一个 GRANT_SLOT_CONFLICT", async () => {
  const credentialId = await approvedCredential("n4", { cycleId: "cycle-race" });
  const input = { ...grantInput(credentialId), deviceId: "device-3", cycleId: "cycle-race" };
  const manager = service("mem-manage");
  const before = await businessSnapshot();
  const results = await Promise.allSettled([
    manager.createGrant(input, { idempotencyKey: "idem-race-a-0000001" }),
    manager.createGrant(input, { idempotencyKey: "idem-race-b-0000001" }),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r) => r.status === "rejected");
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason.code, "GRANT_SLOT_CONFLICT");
  const after = await businessSnapshot();
  assert.equal(after.grants.length, before.grants.length + 1);
  assert.equal(after.slots.length, before.slots.length + 1);
  assert.equal(after.claims.length, before.claims.length);
  assert.deepEqual(after.domains, before.domains);
});

test("K1 domain：head/version 缺失、内部矛盾、realm/version 不匹配", async () => {
  const credentialId = await approvedCredential("q1", { cycleId: "cycle-q1" });
  const manager = service("mem-manage");
  const headId = deviceDigestDomainKey({ provider: "hikvision", digestRealm: "test-realm" });
  const versionId = deviceDigestDomainVersionKey({ provider: "hikvision", digestRealm: "test-realm", version: 1 });
  const head = structuredClone((await store.list("device_digest_domains")).find((d) => d._id === headId));
  const version = structuredClone((await store.list("device_digest_domains")).find((d) => d._id === versionId));
  const device = structuredClone((await store.list("access_devices")).find((d) => d._id === "device-4"));
  const claim = structuredClone((await store.list("device_claims")).find((c) => c._id === device.claimId));

  const run = async (devicePatch, headRecord, versionRecord, code) => {
    const before = await coreSnapshot();
    await store.transact([ref("access_devices", "device-4"), ref("device_digest_domains", headId), ref("device_digest_domains", versionId)], () => [
      { collection: "access_devices", id: "device-4", data: { ...device, ...devicePatch } },
      { collection: "device_digest_domains", id: headId, data: headRecord },
      { collection: "device_digest_domains", id: versionId, data: versionRecord },
    ], audit);
    await assert.rejects(
      () => manager.createGrant({ ...grantInput(credentialId), deviceId: "device-4", cycleId: "cycle-q1" }, { idempotencyKey: "idem-q1-00000011" }),
      (e) => e.code === code,
    );
    await store.transact([ref("access_devices", "device-4"), ref("device_digest_domains", headId), ref("device_digest_domains", versionId)], () => [
      { collection: "access_devices", id: "device-4", data: device },
      { collection: "device_digest_domains", id: headId, data: head },
      { collection: "device_digest_domains", id: versionId, data: version },
    ], audit);
    assert.deepEqual(await coreSnapshot(), before);
  };

  // head/version 均缺失：realm 改到不存在的域
  await run({ digestRealm: "realm-missing" }, head, version, "DOMAIN_INCOMPLETE");
  // version 缺失：设备 keyVersion=2，仅 v1 存在
  await run({ keyVersion: 2 }, head, version, "DOMAIN_INCOMPLETE");
  // 内部矛盾：head v1 与 version 记录 keyVersion 不一致
  await run({}, head, { ...version, keyVersion: 2 }, "DOMAIN_INCOMPLETE");
  // realm 与配置不一致（记录内部自洽）
  await run({}, { ...head, digestRealm: "other" }, { ...version, digestRealm: "other" }, "DEVICE_DIGEST_CONFIG_CHANGED");
  // version 与配置不一致
  await run({}, { ...head, keyVersion: 2 }, { ...version, keyVersion: 2 }, "DEVICE_DIGEST_CONFIG_CHANGED");
});

test("device 其余冻结字段预读后变化 → 失败关闭", async () => {
  const credentialId = await approvedCredential("q2", { cycleId: "cycle-q2" });
  const manager = service("mem-manage");
  const device = structuredClone((await store.list("access_devices")).find((d) => d._id === "device-5"));
  const cases = [
    { patch: { ownerOrgId: "org-other" }, code: "DEVICE_CLAIM_INVALID" },
    { patch: { provider: "other" }, code: "DEVICE_CLAIM_INVALID" },
    { patch: { digestRealm: "other" }, code: "DEVICE_CLAIM_INVALID" },
    { patch: { keyVersion: 2 }, code: "DEVICE_CLAIM_INVALID" },
    { patch: { status: "disabled" }, code: "DEVICE_CLAIM_INVALID" },
    { patch: { capabilities: { face: false } }, code: "DEVICE_CLAIM_INVALID" },
    { patch: { orgId: "org-other" }, code: "NOT_FOUND" },
  ];
  for (const scenario of cases) {
    const before = await coreSnapshot();
    await withPreMutation(async () => {
      await store.transact([ref("access_devices", "device-5")], () => [{
        collection: "access_devices", id: "device-5", data: { ...device, ...scenario.patch },
      }], audit);
    }, async () => {
      await assert.rejects(
        () => manager.createGrant({ ...grantInput(credentialId), deviceId: "device-5", cycleId: "cycle-q2" }, { idempotencyKey: "idem-q2-00000011" }),
        (e) => e.code === scenario.code,
      );
    });
    await store.transact([ref("access_devices", "device-5")], () => [{ collection: "access_devices", id: "device-5", data: device }], audit);
    assert.deepEqual(await coreSnapshot(), before);
  }
});

test("active/released slot 冲突：完整业务快照深比较", async () => {
  const credentialId = await approvedCredential("q3", { cycleId: "cycle-q3" });
  const manager = service("mem-manage");
  const input = { ...grantInput(credentialId), deviceId: "device-3", cycleId: "cycle-q3" };
  const created = await manager.createGrant(input, { idempotencyKey: "idem-q3-00000011" });
  const activeBefore = await businessSnapshot();
  await assert.rejects(
    () => manager.createGrant(input, { idempotencyKey: "idem-q3-00000021" }),
    (e) => e.code === "GRANT_SLOT_CONFLICT",
  );
  assert.deepEqual(await businessSnapshot(), activeBefore);

  const slot = (await store.list("grant_slot_claims", orgId)).find((r) => r.activeClaimId === created.grantId);
  const released = {
    ...slot, activeClaimId: undefined, activatedAt: undefined,
    state: "released", releasedAt: 5, releasedByJobId: created.jobId,
  };
  await store.transact([ref("grant_slot_claims", slot._id)], () => [{ collection: "grant_slot_claims", id: slot._id, data: released }], audit);
  const releasedBefore = await businessSnapshot();
  await assert.rejects(
    () => manager.createGrant(input, { idempotencyKey: "idem-q3-00000031" }),
    (e) => e.code === "GRANT_SLOT_CONFLICT",
  );
  assert.deepEqual(await businessSnapshot(), releasedBefore);
});

test("并发成功路径：job/log/op key、claimId 与 device/claim 内容一致", async () => {
  const credentialId = await approvedCredential("q4", { cycleId: "cycle-q4" });
  const input = { ...grantInput(credentialId), deviceId: "device-3", cycleId: "cycle-q4" };
  const manager = service("mem-manage");
  const claimsBefore = structuredClone(await store.list("device_claims"));
  const deviceBefore = structuredClone((await store.list("access_devices")).find((d) => d._id === "device-3"));
  const results = await Promise.allSettled([
    manager.createGrant(input, { idempotencyKey: "idem-q4-a-00000011" }),
    manager.createGrant(input, { idempotencyKey: "idem-q4-b-00000011" }),
  ]);
  const ok = results.find((r) => r.status === "fulfilled");
  assert.ok(ok);
  const grantId = ok.value.grantId;
  const grant = (await store.list("device_access_grants", orgId)).find((g) => g._id === grantId);
  const slot = (await store.list("grant_slot_claims", orgId)).find((r) => r.activeClaimId === grantId);
  const jobs = (await store.list("device_operation_jobs", orgId)).filter((j) => j.grantId === grantId);
  const logs = (await store.list("device_operation_logs", orgId));
  const keys = await store.list("operation_keys", orgId);

  assert.equal(grant.claimId, deviceBefore.claimId);
  assert.equal(slot.orgId, orgId);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].state, "queued");
  assert.ok(logs.some((l) => l.jobId === jobs[0]._id && l.state === "queued"));
  assert.ok(keys.some((k) => k.result && k.result.grantId === grantId));
  assert.deepEqual(await store.list("device_claims"), claimsBefore);
  const deviceAfter = (await store.list("access_devices")).find((d) => d._id === "device-3");
  assert.deepEqual(deviceAfter, deviceBefore);
});
