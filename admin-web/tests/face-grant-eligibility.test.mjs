import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { LocalStore } from "../lib/store.mjs";
import { FileService } from "../lib/files.mjs";
import { HttpError } from "../lib/model.mjs";
import { BlacklistService, blacklistDecisionHeadId } from "../lib/blacklist.mjs";
import { FaceCredentialService } from "../lib/face-service/service.mjs";
import { occupancyClaimId, primarySlotId } from "../lib/face-service/eligibility.mjs";
import { makeAccessDeviceFixture, makeDigestDomainFixture, makeOwnerClaimFixture } from "./helpers/face-fixtures.mjs";

const ORG = "org-h2c-c3";
const NOW = 1_700_000_000_000;
const MEMBERSHIP = "mem-c3-manage";
const PERSON = "person-c3";
const OCCUPANCY = "occ-c3";
const CYCLE = "cycle-c3";
const ROOM = "room-c3";
const IDENTITY = "id-c3";
const CREDENTIAL = "fc-c3";
const DEVICE = "device-c3";
const MEMBER = "person-c3-member";
const MEMBER_OCCUPANCY = "occ-c3-member";
const MEMBER_IDENTITY = "id-c3-member";
const MEMBER_CREDENTIAL = "fc-c3-member";
const VALID_FROM = NOW - 1_000;
const VALID_UNTIL = NOW + 1_000;
const audit = { actor: "system", actorId: "system", action: "H2-c C3 定向测试" };
const ref = (collection, id) => ({ collection, id });

const grantInput = () => ({
  credentialId: CREDENTIAL,
  expectedCredentialRevision: 2,
  deviceId: DEVICE,
  occupancyId: OCCUPANCY,
  cycleId: CYCLE,
  identityApplicationId: IDENTITY,
  validFrom: VALID_FROM,
  validUntil: VALID_UNTIL,
});

function grantFixture({ occupancy = {}, cycle = {}, device = {}, extraWrites = [] } = {}) {
  const deviceFixture = makeAccessDeviceFixture({ id: DEVICE, orgId: ORG, overrides: device });
  const claimFixture = makeOwnerClaimFixture({ deviceId: DEVICE, orgId: ORG });
  return {
    deviceFixture,
    claimFixture,
    writes: [
      { collection: "organizations", id: ORG, data: { name: "C3 组织", status: "active", revision: 1 } },
      {
        collection: "org_memberships", id: MEMBERSHIP,
        data: {
          orgId: ORG, status: "active", role: "admin", principalType: "adminAccount",
          principalId: MEMBERSHIP, permissions: ["device.access.manage"], revision: 1,
        },
      },
      {
        collection: "file_assets", id: "file-c3",
        data: {
          orgId: ORG, purpose: "face-biometric", status: "ready", visibility: "private",
          mimeType: "image/jpeg", size: 1024, objectKey: "private/c3.jpg", revision: 1,
        },
      },
      {
        collection: "persons", id: PERSON,
        data: { orgId: ORG, status: "active", userId: null, revision: 1 },
      },
      {
        collection: "identity_applications", id: IDENTITY,
        data: {
          orgId: ORG, personId: PERSON, state: "approved",
          identityDigest: "digest-c3", keyVersion: 1, revision: 1,
        },
      },
      {
        collection: "occupancies", id: OCCUPANCY,
        data: {
          orgId: ORG, personId: PERSON, roomId: ROOM, cycleId: CYCLE,
          role: "primary", state: "active", startsAt: NOW - 10_000, endsAt: NOW + 10_000,
          sponsorOccupancyId: null, revision: 1, ...occupancy,
        },
      },
      {
        collection: "occupancy_cycles", id: CYCLE,
        data: {
          orgId: ORG, roomId: ROOM, state: "active", primaryOccupancyId: OCCUPANCY,
          startsAt: NOW - 10_000, endsAt: NOW + 10_000, endedAt: null, epoch: 1, revision: 1,
          ...cycle,
        },
      },
      {
        collection: "rooms", id: ROOM,
        data: {
          orgId: ORG, status: "active", floorId: "floor-c3", buildingId: "building-c3",
          communityId: "community-c3", revision: 1,
        },
      },
      {
        collection: "property_catalog", id: "floor-c3",
        data: {
          orgId: ORG, kind: "floor", status: "active", parentId: "building-c3", revision: 1,
        },
      },
      {
        collection: "property_catalog", id: "building-c3",
        data: {
          orgId: ORG, kind: "building", status: "active", parentId: "community-c3", revision: 1,
        },
      },
      {
        collection: "property_catalog", id: "community-c3",
        data: { orgId: ORG, kind: "community", status: "active", revision: 1 },
      },
      {
        collection: "unique_claims", id: occupancyClaimId(ORG, ROOM, CYCLE, PERSON),
        data: { orgId: ORG, state: "bound", ownerId: OCCUPANCY, revision: 1 },
      },
      {
        collection: "room_primary_slots", id: primarySlotId(ORG, ROOM),
        data: {
          orgId: ORG, currentCycleId: CYCLE, currentOccupancyId: OCCUPANCY,
          currentPersonId: PERSON, revision: 1,
        },
      },
      {
        collection: "face_credentials", id: CREDENTIAL,
        data: {
          orgId: ORG, revision: 2, personId: PERSON, sourceFileId: "file-c3",
          sourceFileRevision: 1, reviewState: "approved", imageState: "verified",
          evidenceScope: "simulated", createdAt: 1, updatedAt: 1,
        },
      },
      { ...deviceFixture },
      { ...claimFixture },
      ...makeDigestDomainFixture(),
      ...extraWrites,
    ],
  };
}

/** 同一房间/周期的完整 member 资格：primary 仍由 OCCUPANCY 承担。 */
function memberWrites() {
  return [
    {
      collection: "persons", id: MEMBER,
      data: { orgId: ORG, status: "active", userId: null, revision: 1 },
    },
    {
      collection: "identity_applications", id: MEMBER_IDENTITY,
      data: {
        orgId: ORG, personId: MEMBER, state: "approved",
        identityDigest: "digest-c3-member", keyVersion: 1, revision: 1,
      },
    },
    {
      collection: "occupancies", id: MEMBER_OCCUPANCY,
      data: {
        orgId: ORG, personId: MEMBER, roomId: ROOM, cycleId: CYCLE, role: "member",
        state: "active", startsAt: NOW - 10_000, endsAt: NOW + 10_000,
        sponsorOccupancyId: OCCUPANCY, revision: 1,
      },
    },
    {
      collection: "unique_claims", id: occupancyClaimId(ORG, ROOM, CYCLE, MEMBER),
      data: { orgId: ORG, state: "bound", ownerId: MEMBER_OCCUPANCY, revision: 1 },
    },
    {
      collection: "face_credentials", id: MEMBER_CREDENTIAL,
      data: {
        orgId: ORG, revision: 2, personId: MEMBER, sourceFileId: "file-c3",
        sourceFileRevision: 1, reviewState: "approved", imageState: "verified",
        evidenceScope: "simulated", createdAt: 1, updatedAt: 1,
      },
    },
  ];
}

const memberGrantInput = () => ({
  ...grantInput(),
  credentialId: MEMBER_CREDENTIAL,
  occupancyId: MEMBER_OCCUPANCY,
  identityApplicationId: MEMBER_IDENTITY,
});

async function setup(t, options = {}) {
  process.env.DEVICE_CLAIM_HMAC_KEY_B64 = Buffer.alloc(32, 7).toString("base64");
  process.env.OPERATION_KEY_HMAC_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
  process.env.OPERATION_KEY_VERSION = "1";
  process.env.OPERATION_KEY_REALM = "test-realm";
  process.env.DEVICE_CLAIM_KEY_VERSION = "1";
  process.env.DEVICE_DIGEST_REALM = "test-realm";

  const dir = await mkdtemp(join(tmpdir(), "smartpm-h2c-c3-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  const fixture = grantFixture(options);
  const unique = [...new Map(fixture.writes.map((w) => [`${w.collection}/${w.id}`, w])).values()];
  await store.transact(
    unique.map((w) => ref(w.collection, w.id)),
    () => unique,
    audit,
  );

  const blacklist = new BlacklistService(store, ORG, null, { now: () => NOW });
  const files = new FileService(store, ORG, {
    auth: { membershipId: MEMBERSHIP },
    actor: {
      actorType: "user", actorId: MEMBERSHIP, role: "admin",
      permissions: ["device.access.manage", "device.face.submit"],
    },
  });
  const providerCalls = { enroll: 0, revoke: 0 };
  const provider = {
    enrollFace: () => { providerCalls.enroll += 1; throw Error("Provider 不得调用"); },
    revokeFace: () => { providerCalls.revoke += 1; throw Error("Provider 不得调用"); },
  };
  const service = new FaceCredentialService({
    store, orgId: ORG,
    actor: { membershipId: MEMBERSHIP, actorType: "user", actorId: MEMBERSHIP },
    files, blacklist, provider, now: () => NOW,
  });
  return { store, blacklist, service, providerCalls, fixture };
}

const GLOBAL = new Set(["device_digest_domains", "operation_key_domains", "admin_audit"]);
const SNAPSHOT_COLLECTIONS = [
  "device_access_grants", "device_operation_jobs", "grant_slot_claims", "device_operation_logs",
  "operation_keys", "file_assets", "org_memberships", "persons", "identity_applications",
  "occupancies", "occupancy_cycles", "rooms", "property_catalog", "unique_claims",
  "room_primary_slots", "lifecycle_guards", "access_devices", "device_claims", "device_digest_domains",
  "blacklist_entries", "blacklist_decisions", "eligibility_guards", "operation_key_domains",
  "admin_audit",
];
const CORE = [
  "device_access_grants", "device_operation_jobs", "grant_slot_claims",
  "device_operation_logs", "operation_keys",
];

async function snapshot(store) {
  const out = {};
  for (const name of SNAPSHOT_COLLECTIONS) {
    out[name] = structuredClone(await store.list(name, GLOBAL.has(name) ? null : ORG));
  }
  return out;
}

function assertUnchanged(before, after, allowed = new Set()) {
  for (const name of SNAPSHOT_COLLECTIONS) {
    if (allowed.has(name)) continue;
    assert.deepEqual(after[name], before[name], `${name} 不得变化`);
  }
}

function instrument(blacklist, store, onTransact = null) {
  const counts = { prepare: 0, evaluate: 0, transact: 0 };
  const prepare = blacklist.prepareEligibility.bind(blacklist);
  blacklist.prepareEligibility = async (request) => {
    counts.prepare += 1;
    return prepare(request);
  };
  const evaluate = blacklist.evaluateEligibility.bind(blacklist);
  blacklist.evaluateEligibility = (state, token, options) => {
    counts.evaluate += 1;
    return evaluate(state, token, options);
  };
  const transact = store.transact.bind(store);
  store.transact = async (...args) => {
    counts.transact += 1;
    if (onTransact) await onTransact(counts.transact);
    return transact(...args);
  };
  return counts;
}

const bumpPersonRevision = (store) => {
  store.data.persons.find((row) => row._id === PERSON).revision += 1;
};

test("C3 接线：真实黑名单与完整资格通过后只写核心写集，Provider 零调用", async (t) => {
  const { store, blacklist, service, providerCalls } = await setup(t);
  const before = await snapshot(store);
  const counts = instrument(blacklist, store);
  const result = await service.createGrant(grantInput(), { idempotencyKey: "idem-c3-success-0001" });

  assert.equal(result.evidenceScope, "simulated");
  assert.deepEqual(counts, { prepare: 1, evaluate: 1, transact: 1 });
  assert.deepEqual(providerCalls, { enroll: 0, revoke: 0 });

  const after = await snapshot(store);
  assert.equal(after.device_access_grants.length, 1);
  assert.equal(after.device_access_grants[0].state, "pending");
  assert.equal(after.device_operation_jobs[0].state, "queued");
  assert.equal(after.device_operation_jobs[0].grantId, after.device_access_grants[0]._id);
  assert.equal(after.grant_slot_claims[0].state, "active");
  assert.equal(after.device_operation_logs[0].jobId, after.device_operation_jobs[0]._id);
  assert.equal(after.operation_keys.length, 1);
  assert.equal(after.eligibility_guards.length, 2, "person+identity subject guard");
  assertUnchanged(before, after, new Set([
    ...CORE, "eligibility_guards", "admin_audit", "operation_key_domains",
  ]));
});

test("C3 一次资格竞态重试：prepare/transaction 完整重跑，第二次成功", async (t) => {
  const { store, blacklist, service, providerCalls } = await setup(t);
  const before = await snapshot(store);
  const counts = instrument(blacklist, store, async (attempt) => {
    if (attempt === 1) bumpPersonRevision(store);
  });
  const result = await service.createGrant(grantInput(), { idempotencyKey: "idem-c3-retry-0001" });

  assert.equal(result.evidenceScope, "simulated");
  assert.deepEqual(counts, { prepare: 2, evaluate: 1, transact: 2 });
  assert.deepEqual(providerCalls, { enroll: 0, revoke: 0 });
  const after = await snapshot(store);
  assert.equal(after.device_access_grants.length, 1);
  assert.equal(after.grant_slot_claims.length, 1);
  assert.equal(after.persons[0].revision, 2, "第二次 attempt 必须使用新 revision");
  assertUnchanged(before, after, new Set([
    ...CORE, "persons", "eligibility_guards", "admin_audit", "operation_key_domains",
  ]));
});

test("C3 三次重试耗尽保持 409 BLACKLIST_RETRY，核心写集零变化", async (t) => {
  const { store, blacklist, service, providerCalls } = await setup(t);
  const before = await snapshot(store);
  const counts = instrument(blacklist, store, async () => bumpPersonRevision(store));
  await assert.rejects(
    () => service.createGrant(grantInput(), { idempotencyKey: "idem-c3-exhaust-0001" }),
    (error) => error.code === "BLACKLIST_RETRY" && error.status === 409,
  );
  assert.deepEqual(counts, { prepare: 3, evaluate: 0, transact: 3 });
  assert.deepEqual(providerCalls, { enroll: 0, revoke: 0 });

  const after = await snapshot(store);
  for (const name of [...CORE, "eligibility_guards", "admin_audit", "blacklist_decisions"]) {
    assert.deepEqual(after[name], before[name], `${name} 零新增`);
  }
  assert.equal(after.persons[0].revision, 4, "三次注入后不再有第四次预读");
});

test("C3 D21 occupancy.personId 与 credential 不符映射 REVISION_CONFLICT/409", async (t) => {
  const { store, blacklist, service } = await setup(t);
  await store.transact([ref("occupancies", OCCUPANCY)], () => [{
    collection: "occupancies", id: OCCUPANCY,
    data: { ...(store.data.occupancies.find((row) => row._id === OCCUPANCY)), personId: "person-other" },
  }], audit);
  const before = await snapshot(store);
  const counts = instrument(blacklist, store);
  await assert.rejects(
    () => service.createGrant(grantInput(), { idempotencyKey: "idem-c3-d21-0000001" }),
    (error) => error.code === "REVISION_CONFLICT" && error.status === 409,
  );
  assert.deepEqual(counts, { prepare: 1, evaluate: 0, transact: 1 });
  const after = await snapshot(store);
  assertUnchanged(before, after);
});

test("C3 D23 occupancy.cycleId 与输入不符映射 REVISION_CONFLICT/409", async (t) => {
  const { store, blacklist, service } = await setup(t);
  await store.transact([ref("occupancies", OCCUPANCY)], () => [{
    collection: "occupancies", id: OCCUPANCY,
    data: { ...(store.data.occupancies.find((row) => row._id === OCCUPANCY)), cycleId: "cycle-other" },
  }], audit);
  const before = await snapshot(store);
  const counts = instrument(blacklist, store);
  await assert.rejects(
    () => service.createGrant(grantInput(), { idempotencyKey: "idem-c3-d23-0000001" }),
    (error) => error.code === "REVISION_CONFLICT" && error.status === 409,
  );
  assert.equal(counts.transact, 1);
  assert.equal(counts.evaluate, 0);
  assertUnchanged(before, await snapshot(store));
});

test("C3 资格点查读取故障返回 503，不伪装成缺失 404，且零核心写入", async (t) => {
  const { store, blacklist, service } = await setup(t);
  const before = await snapshot(store);
  const counts = instrument(blacklist, store);
  const originalGet = store.get.bind(store);
  store.get = async (name, id, orgId) => {
    if (name === "occupancies") throw new HttpError(503, "云数据库查询失败");
    return originalGet(name, id, orgId);
  };
  await assert.rejects(
    () => service.createGrant(grantInput(), { idempotencyKey: "idem-c3-readfail-0001" }),
    (error) => error.status === 503 && error.code === null,
  );
  assert.deepEqual(counts, { prepare: 1, evaluate: 0, transact: 0 });
  assertUnchanged(before, await snapshot(store));
});

test("C3 非法 provider 不提前抛错：资格与黑名单仍先于 H2-b", async (t) => {
  const invalidDevice = { device: { provider: 42 } };

  const h2b = await setup(t, invalidDevice);
  await assert.rejects(
    () => h2b.service.createGrant(grantInput(), { idempotencyKey: "idem-c3-badprovider-a" }),
    (error) => error.code === "DEVICE_CLAIM_INVALID" && error.status === 409,
  );

  const qualification = await setup(t, invalidDevice);
  await qualification.store.transact([ref("occupancies", OCCUPANCY)], () => [{
    collection: "occupancies", id: OCCUPANCY,
    data: {
      ...(qualification.store.data.occupancies.find((row) => row._id === OCCUPANCY)),
      state: "ended",
    },
  }], audit);
  await assert.rejects(
    () => qualification.service.createGrant(grantInput(), { idempotencyKey: "idem-c3-badprovider-b" }),
    (error) => error.code === "INVALID_STATE" && error.status === 409,
  );

  const blacklisted = await setup(t, invalidDevice);
  const headId = blacklistDecisionHeadId(ORG, OCCUPANCY, "occupancy.activate");
  await blacklisted.store.transact([
    ref("blacklist_entries", "entry-c3"), ref("blacklist_decisions", headId),
  ], () => [
    {
      collection: "blacklist_entries", id: "entry-c3",
      data: {
        orgId: ORG, subjectType: "person", subjectKey: PERSON, state: "active",
        restrictions: ["occupancy.activate"], startsAt: 0, endsAt: null,
        reasonCode: "manual", revision: 1,
      },
    },
    {
      collection: "blacklist_decisions", id: headId,
      data: {
        orgId: ORG, occupancyId: OCCUPANCY, restriction: "occupancy.activate",
        entryIds: ["entry-c3"], entryRevisions: [1], decision: "deny",
        latestDecisionId: "decision-c3", expiresAt: null, recordType: "current", revision: 1,
      },
    },
  ], audit);
  await assert.rejects(
    () => blacklisted.service.createGrant(grantInput(), { idempotencyKey: "idem-c3-badprovider-c" }),
    (error) => error.code === "BLACKLIST_DENIED" && error.status === 403,
  );
});

test("C3 helper 请求自身不自洽仍是 PARAM_ERROR/400，且事务不启动", async (t) => {
  const { store, blacklist, service } = await setup(t, {
    cycle: { primaryOccupancyId: "occ-other" },
  });
  const before = await snapshot(store);
  const counts = instrument(blacklist, store);
  await assert.rejects(
    () => service.createGrant(grantInput(), { idempotencyKey: "idem-c3-param-00001" }),
    (error) => error.code === "PARAM_ERROR" && error.status === 400,
  );
  assert.deepEqual(counts, { prepare: 1, evaluate: 0, transact: 0 });
  assertUnchanged(before, await snapshot(store));
});

test("C3 真实黑名单拒绝在资格通过后失败，核心写集与 guard 零变化", async (t) => {
  const { store, blacklist, service } = await setup(t);
  const headId = blacklistDecisionHeadId(ORG, OCCUPANCY, "occupancy.activate");
  await store.transact([
    ref("blacklist_entries", "entry-c3"),
    ref("blacklist_decisions", headId),
  ], () => [
    {
      collection: "blacklist_entries", id: "entry-c3",
      data: {
        orgId: ORG, subjectType: "person", subjectKey: PERSON, state: "active",
        restrictions: ["occupancy.activate"], startsAt: 0, endsAt: null,
        reasonCode: "manual", revision: 1,
      },
    },
    {
      collection: "blacklist_decisions", id: headId,
      data: {
        orgId: ORG, occupancyId: OCCUPANCY, restriction: "occupancy.activate",
        entryIds: ["entry-c3"], entryRevisions: [1], decision: "deny",
        latestDecisionId: "decision-c3", expiresAt: null, recordType: "current", revision: 1,
      },
    },
  ], audit);
  const before = await snapshot(store);
  const counts = instrument(blacklist, store);
  await assert.rejects(
    () => service.createGrant(grantInput(), { idempotencyKey: "idem-c3-denied-0001" }),
    (error) => error.code === "BLACKLIST_DENIED" && error.status === 403,
  );
  assert.deepEqual(counts, { prepare: 1, evaluate: 1, transact: 1 });
  assertUnchanged(before, await snapshot(store));
});

test("C3 错误优先级：资格先于 H2-b、黑名单先于 H2-b、权限最优先", async (t) => {
  const qualification = await setup(t);
  await qualification.store.transact([ref("occupancies", OCCUPANCY)], () => [{
    collection: "occupancies", id: OCCUPANCY,
    data: { ...(qualification.store.data.occupancies.find((row) => row._id === OCCUPANCY)), state: "ended" },
  }], audit);
  await qualification.store.transact([ref("access_devices", DEVICE)], () => [{
    collection: "access_devices", id: DEVICE,
    data: { ...(qualification.store.data.access_devices.find((row) => row._id === DEVICE)), status: "disabled" },
  }], audit);
  await assert.rejects(
    () => qualification.service.createGrant(grantInput(), { idempotencyKey: "idem-c3-order-a-001" }),
    (error) => error.code === "INVALID_STATE" && error.status === 409,
  );

  const blacklisted = await setup(t);
  const headId = blacklistDecisionHeadId(ORG, OCCUPANCY, "occupancy.activate");
  await blacklisted.store.transact([
    ref("blacklist_entries", "entry-c3"), ref("blacklist_decisions", headId),
    ref("access_devices", DEVICE),
  ], () => [
    {
      collection: "blacklist_entries", id: "entry-c3",
      data: {
        orgId: ORG, subjectType: "person", subjectKey: PERSON, state: "active",
        restrictions: ["occupancy.activate"], startsAt: 0, endsAt: null,
        reasonCode: "manual", revision: 1,
      },
    },
    {
      collection: "blacklist_decisions", id: headId,
      data: {
        orgId: ORG, occupancyId: OCCUPANCY, restriction: "occupancy.activate",
        entryIds: ["entry-c3"], entryRevisions: [1], decision: "deny",
        latestDecisionId: "decision-c3", expiresAt: null, recordType: "current", revision: 1,
      },
    },
    {
      collection: "access_devices", id: DEVICE,
      data: { ...(blacklisted.store.data.access_devices.find((row) => row._id === DEVICE)), status: "disabled" },
    },
  ], audit);
  await assert.rejects(
    () => blacklisted.service.createGrant(grantInput(), { idempotencyKey: "idem-c3-order-b-001" }),
    (error) => error.code === "BLACKLIST_DENIED" && error.status === 403,
  );

  const forbidden = await setup(t);
  await forbidden.store.transact([ref("org_memberships", MEMBERSHIP)], () => [{
    collection: "org_memberships", id: MEMBERSHIP,
    data: {
      ...(forbidden.store.data.org_memberships.find((row) => row._id === MEMBERSHIP)),
      permissions: [],
    },
  }], audit);
  const before = await snapshot(forbidden.store);
  const counts = instrument(forbidden.blacklist, forbidden.store);
  await assert.rejects(
    () => forbidden.service.createGrant(grantInput(), { idempotencyKey: "idem-c3-order-c-001" }),
    (error) => error.code === "FORBIDDEN" && error.status === 403,
  );
  assert.equal(counts.transact, 0);
  assertUnchanged(before, await snapshot(forbidden.store));
});

test("C3 合法重放：核心写集深比较不变且仍重跑资格/名单；失效后重放不得跳过资格", async (t) => {
  const { store, blacklist, service } = await setup(t);
  const input = grantInput();
  const key = "idem-c3-replay-0001";
  const created = await service.createGrant(input, { idempotencyKey: key });
  const coreBefore = structuredClone(Object.fromEntries(
    await Promise.all(CORE.map(async (name) => [name, await store.list(name, ORG)])),
  ));
  const counts = instrument(blacklist, store);
  const replay = await service.createGrant(input, { idempotencyKey: key });
  assert.deepEqual(replay, created);
  assert.deepEqual(counts, { prepare: 1, evaluate: 1, transact: 1 });
  for (const name of CORE) {
    assert.deepEqual(await store.list(name, ORG), coreBefore[name], `${name} 重放零新增`);
  }

  await store.transact([ref("occupancies", OCCUPANCY)], () => [{
    collection: "occupancies", id: OCCUPANCY,
    data: { ...(store.data.occupancies.find((row) => row._id === OCCUPANCY)), state: "ended" },
  }], audit);
  const afterExpiry = await snapshot(store);
  await assert.rejects(
    () => service.createGrant(input, { idempotencyKey: key }),
    (error) => error.code === "INVALID_STATE" && error.status === 409,
  );
  for (const name of CORE) {
    assert.deepEqual(await store.list(name, ORG), afterExpiry[name], `${name} 失效重放零新增`);
  }
});

test("C3 完整 member 成功：真实 C1 helper 复核 primary/slot/sponsor，Provider 零调用", async (t) => {
  const { store, blacklist, service, providerCalls } = await setup(t, { extraWrites: memberWrites() });
  const before = await snapshot(store);
  const counts = instrument(blacklist, store);
  const result = await service.createGrant(memberGrantInput(), {
    idempotencyKey: "idem-c3-member-0001",
  });

  assert.equal(result.evidenceScope, "simulated");
  assert.deepEqual(counts, { prepare: 1, evaluate: 1, transact: 1 });
  assert.deepEqual(providerCalls, { enroll: 0, revoke: 0 });

  const after = await snapshot(store);
  assert.equal(after.device_access_grants.length, 1);
  assert.equal(after.device_access_grants[0].personId, MEMBER);
  assert.equal(after.device_access_grants[0].occupancyId, MEMBER_OCCUPANCY);
  assert.equal(after.grant_slot_claims[0].personId, MEMBER);
  assert.equal(after.grant_slot_claims[0].state, "active");
  assert.equal(after.eligibility_guards.length, 2, "member person+identity subject guard");
  assertUnchanged(before, after, new Set([
    ...CORE, "eligibility_guards", "admin_audit", "operation_key_domains",
  ]));
});

test("C3 真实黑名单 review-required 在资格通过后失败，核心写集零变化", async (t) => {
  const { store, blacklist, service } = await setup(t);
  await store.transact([ref("blacklist_entries", "entry-review-c3")], () => [{
    collection: "blacklist_entries", id: "entry-review-c3",
    data: {
      orgId: ORG, subjectType: "person", subjectKey: PERSON, state: "active",
      restrictions: ["occupancy.activate"], startsAt: 0, endsAt: null,
      reasonCode: "manual", revision: 1,
    },
  }], audit);
  const before = await snapshot(store);
  const counts = instrument(blacklist, store);
  await assert.rejects(
    () => service.createGrant(grantInput(), { idempotencyKey: "idem-c3-review-0001" }),
    (error) => error.code === "BLACKLIST_REVIEW_REQUIRED" && error.status === 409,
  );
  assert.deepEqual(counts, { prepare: 1, evaluate: 1, transact: 1 });
  assertUnchanged(before, await snapshot(store));
});

test("C3 createGrant 提供 prepareAttempt：beforeEvaluate → evaluate → build 顺序固定", async (t) => {
  const { blacklist, service } = await setup(t);
  const events = [];

  const originalWithEligibility = blacklist.withEligibility.bind(blacklist);
  blacklist.withEligibility = async (request, refs, build, audit, options = {}) => {
    const prepare = options.prepareAttempt;
    const wrapped = {
      ...options,
      prepareAttempt: async (token) => {
        const prepared = await prepare(token);
        return {
          ...prepared,
          beforeEvaluate: async (state, attemptToken) => {
            events.push("beforeEvaluate");
            return prepared.beforeEvaluate(state, attemptToken);
          },
        };
      },
    };
    return originalWithEligibility(
      request, refs,
      async (state, eligibility, pre) => {
        events.push("build");
        return build(state, eligibility, pre);
      },
      audit, wrapped,
    );
  };
  const originalEvaluate = blacklist.evaluateEligibility.bind(blacklist);
  blacklist.evaluateEligibility = (state, token, options) => {
    events.push("evaluate");
    return originalEvaluate(state, token, options);
  };

  const result = await service.createGrant(grantInput(), {
    idempotencyKey: "idem-c3-order-0001",
  });
  assert.equal(result.evidenceScope, "simulated");
  assert.deepEqual(events, ["beforeEvaluate", "evaluate", "build"]);
});

test("C3 identity/cycle/room/catalog 快照变化失败关闭且核心写集零变化", async (t) => {
  const cases = [
    ["identity revision", (store) => {
      store.data.identity_applications.find((row) => row._id === IDENTITY).revision += 1;
    }],
    ["cycle revision", (store) => {
      store.data.occupancy_cycles.find((row) => row._id === CYCLE).revision += 1;
    }],
    ["room revision", (store) => {
      store.data.rooms.find((row) => row._id === ROOM).revision += 1;
    }],
    ["catalog revision", (store) => {
      store.data.property_catalog.find((row) => row._id === "floor-c3").revision += 1;
    }],
  ];

  for (const [name, mutate] of cases) {
    const { store, blacklist, service } = await setup(t);
    const before = await snapshot(store);
    instrument(blacklist, store, async () => mutate(store));
    await assert.rejects(
      () => service.createGrant(grantInput(), {
        idempotencyKey: `idem-c3-snap-${name.replace(/\s/g, "-")}-01`,
      }),
      (error) => error.status === 409 &&
        ["REVISION_CONFLICT", "BLACKLIST_RETRY"].includes(error.code),
      name,
    );
    const after = await snapshot(store);
    for (const collection of CORE) {
      assert.deepEqual(after[collection], before[collection], `${name}: ${collection} 零写入`);
    }
  }
});

test("C3 真实黑名单 guard 竞态一次重试后成功，核心写集只产生一次", async (t) => {
  const { store, blacklist, service } = await setup(t);
  const token = await blacklist.prepareEligibility({
    personId: PERSON, identityApplicationId: IDENTITY, occupancyId: OCCUPANCY,
    restriction: "occupancy.activate",
  });
  const before = await snapshot(store);
  const counts = instrument(blacklist, store, async (attempt) => {
    if (attempt !== 1) return;
    store.data.eligibility_guards ||= [];
    store.data.eligibility_guards.push({
      _id: token.guardIds[0], orgId: ORG, subjectType: "person", subjectKey: PERSON,
      epoch: 1, revision: 1, createdAt: 1, updatedAt: 1,
    });
  });
  const result = await service.createGrant(grantInput(), {
    idempotencyKey: "idem-c3-blretry-0001",
  });

  assert.equal(result.evidenceScope, "simulated");
  assert.deepEqual(counts, { prepare: 2, evaluate: 2, transact: 2 });
  const after = await snapshot(store);
  assert.equal(after.device_access_grants.length, 1);
  assert.equal(after.grant_slot_claims.length, 1);
  assertUnchanged(before, after, new Set([
    ...CORE, "eligibility_guards", "admin_audit", "operation_key_domains",
  ]));
});

test("C3 合并 refs 恰好 90 进入事务，91 时事务调用为 0", async (t) => {
  const { store, blacklist, service } = await setup(t);

  const addEntries = async (count, prefix) => {
    const writes = [];
    for (let index = 0; index < count; index += 1) {
      const id = `${prefix}-${index}`;
      writes.push({
        collection: "blacklist_entries", id,
        data: {
          orgId: ORG, subjectType: "person", subjectKey: PERSON, state: "active",
          restrictions: ["occupancy.activate"], startsAt: NOW + 100_000, endsAt: null,
          reasonCode: "manual", revision: 1,
        },
      });
    }
    await store.transact(writes.map((write) => ref(write.collection, write.id)), () => writes, audit);
  };

  const originalTransact = store.transact.bind(store);
  let probeRefs = null;
  store.transact = async (refs) => {
    probeRefs = refs;
    throw Error("refs probe stop");
  };
  await assert.rejects(
    () => service.createGrant(grantInput(), { idempotencyKey: "idem-c3-cap-probe-01" }),
  );
  store.transact = originalTransact;
  assert.ok(probeRefs && probeRefs.length < 90, "空名单基线必须低于 90");

  const needed = 90 - probeRefs.length;
  await addEntries(needed, "entry-cap-c3");

  const lengths = [];
  store.transact = async (refs, ...rest) => {
    lengths.push(refs.length);
    return originalTransact(refs, ...rest);
  };
  const result = await service.createGrant(grantInput(), { idempotencyKey: "idem-c3-cap-90-01" });
  store.transact = originalTransact;
  assert.equal(result.evidenceScope, "simulated");
  assert.deepEqual(lengths, [90], "90 条合并 refs 必须在单事务内执行");
  assert.equal((await store.list("device_access_grants", ORG)).length, 1);

  await addEntries(1, "entry-cap-over");

  let calls = 0;
  store.transact = async (...args) => {
    calls += 1;
    return originalTransact(...args);
  };
  await assert.rejects(
    () => service.createGrant(grantInput(), { idempotencyKey: "idem-c3-cap-91-01" }),
    (error) => error.status === 400,
  );
  store.transact = originalTransact;
  assert.equal(calls, 0, "91 条必须在事务开启前失败关闭");
  assert.equal((await store.list("device_access_grants", ORG)).length, 1);
});
