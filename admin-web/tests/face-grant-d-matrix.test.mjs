import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { LocalStore, CloudStore } from "../lib/store.mjs";
import { FileService } from "../lib/files.mjs";
import { BlacklistService, blacklistDecisionHeadId } from "../lib/blacklist.mjs";
import { FaceCredentialService } from "../lib/face-service/service.mjs";
import { MockFaceDispatcher } from "../lib/face-service/dispatcher.mjs";
import { MockFaceAccessProvider } from "../lib/face-service/mock-provider.mjs";
import { projectAccess } from "../lib/face-service/state.mjs";
import { occupancyClaimId, primarySlotId } from "../lib/face-service/eligibility.mjs";
import { eligibilityGuardId, guardId } from "../lib/claims.mjs";
import {
  applyOperationKeyDomain,
  deterministicLogId,
  grantSlotKey,
  operationKeyConfig,
  operationKeyFingerprint,
} from "../lib/face-service/collections.mjs";
import {
  makeAccessDeviceFixture,
  makeDigestDomainFixture,
  makeOwnerClaimFixture,
} from "./helpers/face-fixtures.mjs";

const ORG = "org-c4";
const ORG_OTHER = "org-c4-other";
const NOW = 1_700_000_000_000;
const QUAL_START = NOW - 10_000;
const QUAL_END = NOW + 10_000;
const VALID_FROM = NOW - 1_000;
const VALID_UNTIL = NOW + 1_000;
const MEMBERSHIP = "mem-c4-manage";
const PERSON = "person-c4";
const PRIMARY_PERSON = "person-c4-primary";
const USER1 = "user-c4-1";
const USER2 = "user-c4-2";
const IDENTITY = "id-c4";
const CREDENTIAL = "fc-c4";
const OCCUPANCY = "occ-c4";
const OCC_PRIMARY = "occ-c4-primary";
const OCC_SPONSOR = "occ-c4-sponsor";
const CYCLE = "cycle-c4";
const ROOM = "room-c4";
const FLOOR = "floor-c4";
const BUILDING = "building-c4";
const COMMUNITY = "community-c4";
const DEVICE = "device-c4";
const CLAIM = `claim-${DEVICE}`;
const FILE = "file-c4";
const audit = { actor: "system", actorId: "system", action: "H2-c C4 矩阵" };
const ref = (collection, id) => ({ collection, id });

const CORE = [
  "device_access_grants", "device_operation_jobs", "grant_slot_claims",
  "device_operation_logs", "operation_keys",
];
const SCOPED = [
  "device_access_grants", "device_operation_jobs", "grant_slot_claims",
  "device_operation_logs", "operation_keys", "file_assets", "organizations",
  "org_memberships", "persons", "identity_applications", "occupancies", "occupancy_cycles", "rooms",
  "property_catalog", "unique_claims", "room_primary_slots", "lifecycle_guards",
  "access_devices", "device_claims", "blacklist_entries", "blacklist_decisions",
  "eligibility_guards",
];
const GLOBAL = ["users", "device_digest_domains", "operation_key_domains", "admin_audit"];
const ALL_COLLECTIONS = [...SCOPED, ...GLOBAL];

const entryRecord = (id, overrides = {}) => ({
  collection: "blacklist_entries",
  id,
  data: {
    orgId: ORG, subjectType: "person", subjectKey: PERSON, state: "active",
    restrictions: ["occupancy.activate"], startsAt: 0, endsAt: null,
    reasonCode: "manual", revision: 1, ...overrides,
  },
});

const decisionRecord = (headId, { entryIds, entryRevisions, decision = "allow", expiresAt = null }) => ({
  collection: "blacklist_decisions",
  id: headId,
  data: {
    orgId: ORG, occupancyId: OCCUPANCY, restriction: "occupancy.activate",
    entryIds, entryRevisions, decision, latestDecisionId: "decision-c4",
    expiresAt, recordType: "current", revision: 1,
  },
});

function grantFixture(options = {}) {
  const role = options.role ?? "primary";
  const userId = options.userId ?? null;
  const sponsor = options.sponsor ?? null;
  const personId = PERSON;
  const occupancyId = OCCUPANCY;
  const cycleId = CYCLE;
  const roomId = ROOM;
  const member = role === "member";
  const sponsorId = sponsor === "primary" ? OCC_PRIMARY : sponsor === "other" ? OCC_SPONSOR : null;

  const writes = [
    { collection: "organizations", id: ORG, data: { name: "C4 组织", status: "active", revision: 1 } },
    {
      collection: "org_memberships", id: MEMBERSHIP,
      data: {
        orgId: ORG, status: "active", role: "admin", principalType: "adminAccount",
        principalId: MEMBERSHIP, permissions: ["device.access.manage"], revision: 1,
      },
    },
    {
      collection: "file_assets", id: FILE,
      data: {
        orgId: ORG, purpose: "face-biometric", status: "ready", visibility: "private",
        mimeType: "image/jpeg", size: 1024, objectKey: "private/c4.jpg", revision: 1,
      },
    },
    {
      collection: "persons", id: personId,
      data: { orgId: ORG, status: "active", userId, revision: 1, ...(options.person || {}) },
    },
    {
      collection: "users", id: USER1,
      data: { status: "active", revision: 1, ...(options.user1 || {}) },
    },
    {
      collection: "users", id: USER2,
      data: { status: "active", revision: 1, ...(options.user2 || {}) },
    },
    {
      collection: "identity_applications", id: IDENTITY,
      data: {
        orgId: ORG, personId, state: "approved", identityDigest: "digest-c4",
        keyVersion: 1, revision: 1, ...(options.identity || {}),
      },
    },
    {
      collection: "occupancies", id: occupancyId,
      data: {
        orgId: ORG, personId, roomId, cycleId, role, state: "active",
        startsAt: QUAL_START, endsAt: options.qualificationEnd ?? QUAL_END, sponsorOccupancyId: sponsorId,
        revision: 1, ...(options.occupancy || {}),
      },
    },
    {
      collection: "occupancy_cycles", id: cycleId,
      data: {
        orgId: ORG, roomId, state: "active",
        primaryOccupancyId: member ? OCC_PRIMARY : occupancyId,
        startsAt: QUAL_START, endsAt: options.qualificationEnd ?? QUAL_END, endedAt: null, epoch: 1, revision: 1,
        ...(options.cycle || {}),
      },
    },
    {
      collection: "rooms", id: roomId,
      data: {
        orgId: ORG, status: "active", floorId: FLOOR, buildingId: BUILDING,
        communityId: COMMUNITY, revision: 1, ...(options.room || {}),
      },
    },
    {
      collection: "property_catalog", id: FLOOR,
      data: {
        orgId: ORG, kind: "floor", status: "active", parentId: BUILDING,
        revision: 1, ...(options.floor || {}),
      },
    },
    {
      collection: "property_catalog", id: BUILDING,
      data: {
        orgId: ORG, kind: "building", status: "active", parentId: COMMUNITY,
        revision: 1, ...(options.building || {}),
      },
    },
    {
      collection: "property_catalog", id: COMMUNITY,
      data: {
        orgId: ORG, kind: "community", status: "active",
        revision: 1, ...(options.community || {}),
      },
    },
    {
      collection: "unique_claims", id: occupancyClaimId(ORG, roomId, cycleId, personId),
      data: { orgId: ORG, state: "bound", ownerId: occupancyId, revision: 1 },
    },
    {
      collection: "room_primary_slots", id: primarySlotId(ORG, roomId),
      data: {
        orgId: ORG, currentCycleId: cycleId,
        currentOccupancyId: member ? OCC_PRIMARY : occupancyId,
        currentPersonId: member ? PRIMARY_PERSON : personId,
        revision: 1, ...(options.slot || {}),
      },
    },
    {
      collection: "face_credentials", id: CREDENTIAL,
      data: {
        orgId: ORG, revision: 2, personId, sourceFileId: FILE,
        sourceFileRevision: 1, reviewState: "approved", imageState: "verified",
        evidenceScope: "simulated", createdAt: 1, updatedAt: 1,
      },
    },
    { ...makeAccessDeviceFixture({ id: DEVICE, orgId: ORG, overrides: options.device || {} }) },
    { ...makeOwnerClaimFixture({ deviceId: DEVICE, orgId: ORG, ...(options.claim ? { overrides: options.claim } : {}) }) },
    ...makeDigestDomainFixture(options.digest || {}),
  ];

  if (member && !options.primaryMissing) {
    writes.push({
      collection: "occupancies", id: OCC_PRIMARY,
      data: {
        orgId: ORG, personId: PRIMARY_PERSON, roomId, cycleId, role: "primary",
        state: options.primaryState ?? "active", startsAt: QUAL_START, endsAt: options.qualificationEnd ?? QUAL_END,
        sponsorOccupancyId: null, revision: 1,
      },
    });
  }
  if (sponsor === "other") {
    writes.push({
      collection: "occupancies", id: OCC_SPONSOR,
      data: {
        orgId: ORG, personId: "person-c4-sponsor", roomId, cycleId, role: "member",
        state: "active", startsAt: QUAL_START, endsAt: options.qualificationEnd ?? QUAL_END,
        sponsorOccupancyId: null, revision: 1,
      },
    });
  }

  const blacklisted = options.blacklist || {};
  for (const entry of blacklisted.entries || []) writes.push(entry);
  if (blacklisted.decision) {
    writes.push(decisionRecord(
      blacklistDecisionHeadId(ORG, OCCUPANCY, "occupancy.activate"),
      blacklisted.decision,
    ));
  }

  if (options.candidates) {
    const candidates = [];
    for (let index = 0; index < options.candidates; index += 1) {
      const id = `entry-c4-${String(index).padStart(3, "0")}`;
      candidates.push(entryRecord(id));
      writes.push(entryRecord(id));
    }
    candidates.sort((a, b) => a.id.localeCompare(b.id));
    writes.push(decisionRecord(
      blacklistDecisionHeadId(ORG, OCCUPANCY, "occupancy.activate"),
      {
        entryIds: candidates.map((item) => item.id),
        entryRevisions: candidates.map(() => 1),
        decision: "allow",
      },
    ));
  }
  return writes;
}

async function setup(t, options = {}) {
  process.env.DEVICE_CLAIM_HMAC_KEY_B64 = Buffer.alloc(32, 7).toString("base64");
  process.env.OPERATION_KEY_HMAC_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
  process.env.OPERATION_KEY_VERSION = "1";
  process.env.OPERATION_KEY_REALM = "test-realm";
  process.env.DEVICE_CLAIM_KEY_VERSION = "1";
  process.env.DEVICE_DIGEST_REALM = "test-realm";

  const dir = await mkdtemp(join(tmpdir(), "smartpm-h2c-c4-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir, { dispatchNow: options.dispatchNow }).init();
  const writes = grantFixture(options);

  // 预建有效 K2 domain：成功路径不得再写 operation_key_domains（S 断言）。
  const config = operationKeyConfig(process.env);
  writes.push(...applyOperationKeyDomain({}, {
    realm: config.realm,
    version: config.version,
    fingerprint: operationKeyFingerprint(config),
    now: NOW,
  }));

  const unique = [...new Map(writes.map((item) => [`${item.collection}/${item.id}`, item])).values()];
  await store.transact(unique.map((item) => ref(item.collection, item.id)), () => unique, audit);

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
    files, blacklist, provider, now: () => NOW, syntheticDispatch: options.syntheticDispatch,
  });

  const h = {
    store, blacklist, files, service, providerCalls,
    expectedGuards: 2 + (options.userId ? 1 : 0),
    counts: { prepare: 0, evaluate: 0, transact: 0, build: 0 },
    hooks: {},
    baseline: null,
    lastRefs: null,
    lastEligibility: null,
    keys: 0,
    now: options.now ?? NOW,
    input: (overrides = {}) => ({
      credentialId: CREDENTIAL,
      expectedCredentialRevision: 2,
      deviceId: DEVICE,
      occupancyId: OCCUPANCY,
      cycleId: CYCLE,
      identityApplicationId: IDENTITY,
      validFrom: options.validFrom ?? VALID_FROM,
      validUntil: options.validUntil ?? VALID_UNTIL,
      ...overrides,
    }),
    nextKey: () => {
      h.keys += 1;
      return `idem-c4-${String(h.keys).padStart(8, "0")}`;
    },
  };
  installInstrumentation(h);
  return h;
}

function installInstrumentation(h) {
  const counts = h.counts;
  const prepare = h.blacklist.prepareEligibility.bind(h.blacklist);
  h.blacklist.prepareEligibility = async (request) => {
    if (h.hooks.beforePrepare) await h.hooks.beforePrepare(counts.prepare + 1);
    counts.prepare += 1;
    const token = await prepare(request);
    if (h.hooks.afterPrepare) await h.hooks.afterPrepare(token, counts.prepare);
    return token;
  };
  const evaluate = h.blacklist.evaluateEligibility.bind(h.blacklist);
  h.blacklist.evaluateEligibility = (state, token, options) => {
    counts.evaluate += 1;
    const result = evaluate(state, token, options);
    h.lastEligibility = result;
    if (h.hooks.afterEvaluate) h.hooks.afterEvaluate(state, token, result);
    return result;
  };
  const withEligibility = h.blacklist.withEligibility.bind(h.blacklist);
  h.blacklist.withEligibility = async (...args) => {
    const [request, refs, build, auditArg, options] = args;
    const wrapped = (state, eligibility, pre) => {
      counts.build += 1;
      return build(state, eligibility, pre);
    };
    return withEligibility(request, refs, wrapped, auditArg, options);
  };
  const transact = h.store.transact.bind(h.store);
  h.store.transact = async (refs, build, auditArg) => {
    counts.transact += 1;
    h.lastRefs = refs.length;
    if (h.hooks.beforeTransact) await h.hooks.beforeTransact(counts.transact, refs);
    return transact(refs, build, auditArg);
  };
}

function resetCounts(h) {
  Object.assign(h.counts, { prepare: 0, evaluate: 0, transact: 0, build: 0 });
  h.lastRefs = null;
  h.lastEligibility = null;
}

async function snapshot(store) {
  const out = {};
  for (const name of SCOPED) out[name] = structuredClone(await store.list(name, ORG));
  for (const name of GLOBAL) out[name] = structuredClone(await store.list(name));
  return out;
}

function assertUnchanged(before, after, allowed = new Set()) {
  for (const name of ALL_COLLECTIONS) {
    if (allowed.has(name)) continue;
    assert.deepEqual(after[name], before[name], `${name} 不得变化`);
  }
}

function assertProviderZero(h) {
  assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });
}

function assertCoreCreated(before, after) {
  for (const name of CORE) {
    assert.equal(after[name].length, before[name].length + 1, `${name} 必须新增一条`);
  }
}

async function expectSuccess(h, input = h.input(), { baseline = "before", guardDelta = h.expectedGuards } = {}) {
  let before = baseline === "hook" ? null : await snapshot(h.store);
  const key = h.nextKey();
  const result = await h.service.createGrant(input, { idempotencyKey: key });
  if (baseline === "hook") before = h.baseline;
  assert.ok(before, "缺少成功基线");
  const after = await snapshot(h.store);
  assertCoreCreated(before, after);
  assertUnchanged(before, after, new Set([...CORE, "eligibility_guards", "admin_audit"]));
  assert.equal(after.admin_audit.length, before.admin_audit.length + 1, "成功只追加一条审计");
  assert.equal(
    after.eligibility_guards.length, before.eligibility_guards.length + guardDelta,
    "成功只追加 subject guard",
  );
  assertProviderZero(h);
  return { result, before, after, key };
}

async function expectFailure(h, input, { code, status, key, baseline = "before" } = {}) {
  let before = baseline === "hook" ? null : await snapshot(h.store);
  await assert.rejects(
    () => h.service.createGrant(input, { idempotencyKey: key ?? h.nextKey() }),
    (error) => error.code === code && error.status === status,
  );
  if (baseline === "hook") before = h.baseline;
  assert.ok(before, "缺少失败基线");
  const after = await snapshot(h.store);
  assertUnchanged(before, after);
  assertProviderZero(h);
  return { before, after };
}

function patchRecord(h, collection, id, patch) {
  const rows = h.store.data[collection] || [];
  const row = rows.find((item) => item._id === id);
  assert.ok(row, `缺少 ${collection}/${id}`);
  Object.assign(row, patch);
  return row;
}

function dropRecord(h, collection, id) {
  const rows = h.store.data[collection] || [];
  const index = rows.findIndex((item) => item._id === id);
  assert.ok(index >= 0, `缺少 ${collection}/${id}`);
  rows.splice(index, 1);
}

function moveRecord(h, collection, id, orgId = ORG_OTHER) {
  return patchRecord(h, collection, id, { orgId });
}

function addCandidate(h, id = "entry-c4-new", overrides = {}) {
  const record = entryRecord(id, overrides);
  h.store.data.blacklist_entries ||= [];
  h.store.data.blacklist_entries.push({ _id: id, ...record.data });
}

function bumpPersonGuard(h) {
  h.store.data.eligibility_guards ||= [];
  const id = eligibilityGuardId(ORG, "person", PERSON);
  let guard = h.store.data.eligibility_guards.find((item) => item._id === id);
  if (!guard) {
    guard = { _id: id, orgId: ORG, epoch: 0, revision: 1, createdAt: NOW };
    h.store.data.eligibility_guards.push(guard);
  }
  guard.epoch += 1;
  guard.revision += 1;
}

function injectFirstTransact(h, mutate) {
  h.hooks.beforeTransact = async (attempt) => {
    if (attempt !== 1) return;
    mutate(h);
    h.baseline = await snapshot(h.store);
  };
}

// D01
test("C4 D01 F-P 全有效：单次成功，pending grant/queued job，S+P0", async (t) => {
  const h = await setup(t);
  const { result } = await expectSuccess(h);
  assert.equal(result.evidenceScope, "simulated");
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 1, transact: 1, build: 1 });
  const grant = (await h.store.list("device_access_grants", ORG))[0];
  const job = (await h.store.list("device_operation_jobs", ORG))[0];
  assert.equal(grant.state, "pending");
  assert.equal(job.state, "queued");
  assert.equal(job.grantId, grant._id);
});

// D02
test("C4 D02 F-M 全有效（Q02）：member 依赖有效 primary/slot，单次成功", async (t) => {
  const h = await setup(t, { role: "member" });
  await expectSuccess(h);
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 1, transact: 1, build: 1 });
  const grant = (await h.store.list("device_access_grants", ORG))[0];
  assert.equal(grant.occupancyId, OCCUPANCY);
  assert.equal(grant.cycleId, CYCLE);
});

// D03/D04
test("C4 D03/D04 person 缺失与跨组织：同态 NOT_FOUND，Z", async (t) => {
  const missing = await setup(t);
  dropRecord(missing, "persons", PERSON);
  await expectFailure(missing, missing.input(), { code: "NOT_FOUND", status: 404 });

  const foreign = await setup(t);
  moveRecord(foreign, "persons", PERSON);
  await expectFailure(foreign, foreign.input(), { code: "NOT_FOUND", status: 404 });
});

// D05
test("C4 D05 person.status 非 active：INVALID_STATE，Z", async (t) => {
  const h = await setup(t);
  patchRecord(h, "persons", PERSON, { status: "archived" });
  await expectFailure(h, h.input(), { code: "INVALID_STATE", status: 409 });
});

// D06
test("C4 D06 person.revision 在 T1 改变：一次 retry 后成功，prepare=2", async (t) => {
  const h = await setup(t);
  injectFirstTransact(h, (harness) => {
    patchRecord(harness, "persons", PERSON, {
      revision: harness.store.data.persons.find((item) => item._id === PERSON).revision + 1,
    });
  });
  await expectSuccess(h, h.input(), { baseline: "hook" });
  assert.deepEqual(h.counts, { prepare: 2, evaluate: 1, transact: 2, build: 1 });
});

// D07
test("C4 D07 person.userId T1 改绑：第二次使用新 user subject，不沿用旧绑定", async (t) => {
  const h = await setup(t, { userId: USER1 });
  const tokens = [];
  h.hooks.afterPrepare = (token) => tokens.push(token);
  injectFirstTransact(h, (harness) => patchRecord(harness, "persons", PERSON, { userId: USER2 }));
  await expectSuccess(h, h.input(), { baseline: "hook" });
  assert.equal(tokens.length, 2);
  assert.ok(tokens[1].subjects.some((s) => s.subjectType === "user" && s.subjectKey === USER2));
  assert.equal(tokens[1].subjects.some((s) => s.subjectType === "user" && s.subjectKey === USER1), false);
  assert.deepEqual(h.counts, { prepare: 2, evaluate: 1, transact: 2, build: 1 });
});

// D08/D09
test("C4 D08/D09 绑定 user 缺失/停用：USER_DISABLED；无账号 person 可成功", async (t) => {
  const missing = await setup(t, { userId: USER1 });
  dropRecord(missing, "users", USER1);
  await expectFailure(missing, missing.input(), { code: "USER_DISABLED", status: 403 });

  const disabled = await setup(t, { userId: USER1 });
  patchRecord(disabled, "users", USER1, { status: "disabled" });
  await expectFailure(disabled, disabled.input(), { code: "USER_DISABLED", status: 403 });

  const noAccount = await setup(t, { userId: null });
  await expectSuccess(noAccount);
});

// D10/D11
test("C4 D10/D11 identity application 缺失与跨组织：同态 NOT_FOUND，Z", async (t) => {
  const missing = await setup(t);
  dropRecord(missing, "identity_applications", IDENTITY);
  await expectFailure(missing, missing.input(), { code: "NOT_FOUND", status: 404 });

  const foreign = await setup(t);
  moveRecord(foreign, "identity_applications", IDENTITY);
  await expectFailure(foreign, foreign.input(), { code: "NOT_FOUND", status: 404 });
});

// D12/D13/D14
test("C4 D12/D13/D14 identity 非 approved/人员不符/缺 digest：冻结错误，Z", async (t) => {
  for (const state of ["draft", "submitted", "rejected"]) {
    const h = await setup(t);
    patchRecord(h, "identity_applications", IDENTITY, { state });
    await expectFailure(h, h.input(), { code: "IDENTITY_NOT_APPROVED", status: 403 });
  }
  const conflict = await setup(t);
  patchRecord(conflict, "identity_applications", IDENTITY, { personId: "person-c4-other" });
  await expectFailure(conflict, conflict.input(), { code: "IDENTITY_CONFLICT", status: 409 });

  const noDigest = await setup(t);
  patchRecord(noDigest, "identity_applications", IDENTITY, { identityDigest: "" });
  await expectFailure(noDigest, noDigest.input(), { code: "IDENTITY_NOT_APPROVED", status: 403 });
});

// D15
test("C4 D15 identityDigest T1 改变：retry 后使用新 digest subject", async (t) => {
  const h = await setup(t);
  const oldGuard = eligibilityGuardId(ORG, "identity", "digest-c4");
  const newGuard = eligibilityGuardId(ORG, "identity", "digest-c4-new");
  injectFirstTransact(h, (harness) => {
    patchRecord(harness, "identity_applications", IDENTITY, { identityDigest: "digest-c4-new" });
  });
  await expectSuccess(h, h.input(), { baseline: "hook" });
  const guards = await h.store.list("eligibility_guards", ORG);
  assert.ok(guards.some((g) => g._id === newGuard));
  assert.equal(guards.some((g) => g._id === oldGuard), false);
  assert.deepEqual(h.counts, { prepare: 2, evaluate: 1, transact: 2, build: 1 });
});

// D16
test("C4 D16 identity.keyVersion T1 改变：retry 后重取 keyVersion/guard", async (t) => {
  const h = await setup(t);
  injectFirstTransact(h, (harness) => {
    patchRecord(harness, "identity_applications", IDENTITY, { keyVersion: 2 });
  });
  await expectSuccess(h, h.input(), { baseline: "hook" });
  const guards = await h.store.list("eligibility_guards", ORG);
  assert.ok(guards.some((g) => g.subjectType === "identity" && g.keyVersion === 2));
  assert.deepEqual(h.counts, { prepare: 2, evaluate: 1, transact: 2, build: 1 });
});

// D17
test("C4 D17 identity revision-only T1 改变：内部 retry，第二次成功", async (t) => {
  const h = await setup(t);
  injectFirstTransact(h, (harness) => {
    patchRecord(harness, "identity_applications", IDENTITY, { revision: 2 });
  });
  await expectSuccess(h, h.input(), { baseline: "hook" });
  assert.deepEqual(h.counts, { prepare: 2, evaluate: 1, transact: 2, build: 1 });
});

// D18
test("C4 D18 连续三次资格快照失效（T1+T2）：409 BLACKLIST_RETRY，无第四次，Z", async (t) => {
  const h = await setup(t);
  h.hooks.beforePrepare = async (attempt) => {
    if (attempt === 1) return;
    const current = h.store.data.identity_applications
      .find((item) => item._id === IDENTITY).revision;
    patchRecord(h, "identity_applications", IDENTITY, { revision: current + 1 });
  };
  h.hooks.beforeTransact = async () => {
    const current = h.store.data.persons.find((item) => item._id === PERSON).revision;
    patchRecord(h, "persons", PERSON, { revision: current + 1 });
    h.baseline = await snapshot(h.store);
  };
  await expectFailure(h, h.input(), {
    code: "BLACKLIST_RETRY", status: 409, baseline: "hook",
  });
  assert.deepEqual(h.counts, { prepare: 3, evaluate: 0, transact: 3, build: 0 });
  assert.equal(
    h.store.data.identity_applications.find((item) => item._id === IDENTITY).revision, 3,
    "T2 注入确实进入下一次预读",
  );
});

async function runT0Failure(t, overrides, mutate, expected) {
  const h = await setup(t, overrides);
  if (mutate) mutate(h);
  await expectFailure(h, h.input(expected.input || {}), {
    code: expected.code, status: expected.status,
  });
  return h;
}

async function runT1Failure(t, overrides, mutate, expected) {
  const h = await setup(t, overrides);
  injectFirstTransact(h, mutate);
  await expectFailure(h, h.input(expected.input || {}), {
    code: expected.code, status: expected.status, baseline: "hook",
  });
  return h;
}

// D19/D20
test("C4 D19/D20 occupancy 缺失/跨组织：同态 NOT_FOUND，Z", async (t) => {
  await runT0Failure(t, {}, (h) => dropRecord(h, "occupancies", OCCUPANCY),
    { code: "NOT_FOUND", status: 404 });
  await runT0Failure(t, {}, (h) => moveRecord(h, "occupancies", OCCUPANCY),
    { code: "NOT_FOUND", status: 404 });
});

// D21
test("C4 D21 occupancy.personId 与 credential 不同：T0/T1 均 REVISION_CONFLICT", async (t) => {
  await runT0Failure(t, {}, (h) => patchRecord(h, "occupancies", OCCUPANCY, { personId: "person-other" }),
    { code: "REVISION_CONFLICT", status: 409 });
  await runT1Failure(t, {}, (h) => patchRecord(h, "occupancies", OCCUPANCY, { personId: "person-other" }),
    { code: "REVISION_CONFLICT", status: 409 });
});

// D22
test("C4 D22 occupancy.roomId 在 T1 改变：REVISION_CONFLICT，Z", async (t) => {
  const h = await runT1Failure(t, {}, (harness) => {
    patchRecord(harness, "occupancies", OCCUPANCY, { roomId: "room-other" });
  }, { code: "REVISION_CONFLICT", status: 409 });
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 0, transact: 1, build: 0 });
});

// D23
test("C4 D23 occupancy.cycleId 与输入/预读不同：T0/T1 均 REVISION_CONFLICT", async (t) => {
  await runT0Failure(t, {}, (h) => patchRecord(h, "occupancies", OCCUPANCY, { cycleId: "cycle-other" }),
    { code: "REVISION_CONFLICT", status: 409 });
  await runT1Failure(t, {}, (h) => patchRecord(h, "occupancies", OCCUPANCY, { cycleId: "cycle-other" }),
    { code: "REVISION_CONFLICT", status: 409 });
});

// D24
test("C4 D24 occupancy 角色非法/预读后变化：INVALID_STATE 与 REVISION_CONFLICT", async (t) => {
  await runT0Failure(t, {}, (h) => patchRecord(h, "occupancies", OCCUPANCY, { role: "guest" }),
    { code: "INVALID_STATE", status: 409 });
  await runT1Failure(t, {}, (h) => patchRecord(h, "occupancies", OCCUPANCY, { role: "member" }),
    { code: "REVISION_CONFLICT", status: 409 });
});

// D25
test("C4 D25 occupancy 非 active 状态：invited/pending_review/ended 均 INVALID_STATE", async (t) => {
  for (const state of ["invited", "pending_review", "ended"]) {
    await runT0Failure(t, { occupancy: { state } }, null,
      { code: "INVALID_STATE", status: 409 });
  }
});

// D26
test("C4 D26 occupancy.revision 在 T1 改变：REVISION_CONFLICT，Z", async (t) => {
  await runT1Failure(t, {}, (h) => patchRecord(h, "occupancies", OCCUPANCY, { revision: 2 }),
    { code: "REVISION_CONFLICT", status: 409 });
});

// D27
test("C4 D27 now<occupancy.startsAt：INVALID_STATE，Z", async (t) => {
  await runT0Failure(t, { occupancy: { startsAt: NOW + 1 }, cycle: { startsAt: QUAL_START } }, null,
    { code: "INVALID_STATE", status: 409 });
});

// D28
test("C4 D28 now=occupancy.endsAt：排他结束边界 INVALID_STATE，Z", async (t) => {
  await runT0Failure(t, { occupancy: { endsAt: NOW }, validUntil: NOW - 1 }, null,
    { code: "INVALID_STATE", status: 409 });
});

// D29
test("C4 D29 occupancy.endsAt=null 且 cycle 有效：成功，S", async (t) => {
  const h = await setup(t, { occupancy: { endsAt: null } });
  await expectSuccess(h);
});

// D30/D31
test("C4 D30/D31 cycle 缺失/跨组织：同态 NOT_FOUND，Z", async (t) => {
  await runT0Failure(t, {}, (h) => dropRecord(h, "occupancy_cycles", CYCLE),
    { code: "NOT_FOUND", status: 404 });
  await runT0Failure(t, {}, (h) => moveRecord(h, "occupancy_cycles", CYCLE),
    { code: "NOT_FOUND", status: 404 });
});

// D32
test("C4 D32 cycle.roomId 与 occupancy.roomId 不同：T0/T1 均 REVISION_CONFLICT", async (t) => {
  await runT0Failure(t, {}, (h) => patchRecord(h, "occupancy_cycles", CYCLE, { roomId: "room-other" }),
    { code: "REVISION_CONFLICT", status: 409 });
  await runT1Failure(t, {}, (h) => patchRecord(h, "occupancy_cycles", CYCLE, { roomId: "room-other" }),
    { code: "REVISION_CONFLICT", status: 409 });
});

// D33
test("C4 D33 cycle.state=pending/ended：INVALID_STATE，Z", async (t) => {
  for (const state of ["pending", "ended"]) {
    await runT0Failure(t, { cycle: { state } }, null,
      { code: "INVALID_STATE", status: 409 });
  }
});

// D34
test("C4 D34 cycle.epoch/revision 在 T1 改变：REVISION_CONFLICT，Z", async (t) => {
  await runT1Failure(t, {}, (h) => patchRecord(h, "occupancy_cycles", CYCLE, { epoch: 2 }),
    { code: "REVISION_CONFLICT", status: 409 });
  await runT1Failure(t, {}, (h) => patchRecord(h, "occupancy_cycles", CYCLE, { revision: 2 }),
    { code: "REVISION_CONFLICT", status: 409 });
});

// D35
test("C4 D35 now 在 cycle 开始前/结束时刻：INVALID_STATE，Z", async (t) => {
  await runT0Failure(t, { cycle: { startsAt: NOW + 1 } }, null,
    { code: "INVALID_STATE", status: 409 });
  await runT0Failure(t, { cycle: { endsAt: NOW }, validUntil: NOW - 1 }, null,
    { code: "INVALID_STATE", status: 409 });
  await runT0Failure(t, { cycle: { endedAt: NOW } }, null,
    { code: "INVALID_STATE", status: 409 });
});

// D36
test("C4 D36 room 缺失/跨组织：T0/T1 同态 NOT_FOUND，Z", async (t) => {
  await runT0Failure(t, {}, (h) => dropRecord(h, "rooms", ROOM),
    { code: "NOT_FOUND", status: 404 });
  await runT0Failure(t, {}, (h) => moveRecord(h, "rooms", ROOM),
    { code: "NOT_FOUND", status: 404 });
  await runT1Failure(t, {}, (h) => dropRecord(h, "rooms", ROOM),
    { code: "NOT_FOUND", status: 404 });
  await runT1Failure(t, {}, (h) => moveRecord(h, "rooms", ROOM),
    { code: "NOT_FOUND", status: 404 });
});

// D37
test("C4 D37 room 归档：T0/T1 均 ROOM_ARCHIVED，Z", async (t) => {
  await runT0Failure(t, {}, (h) => patchRecord(h, "rooms", ROOM, { status: "archived" }),
    { code: "ROOM_ARCHIVED", status: 409 });
  await runT1Failure(t, {}, (h) => patchRecord(h, "rooms", ROOM, { status: "archived" }),
    { code: "ROOM_ARCHIVED", status: 409 });
});

// D38
test("C4 D38 room 层级/revision 在 T1 改变：REVISION_CONFLICT，Z", async (t) => {
  await runT1Failure(t, {}, (h) => patchRecord(h, "rooms", ROOM, { floorId: "floor-other" }),
    { code: "REVISION_CONFLICT", status: 409 });
  await runT1Failure(t, {}, (h) => patchRecord(h, "rooms", ROOM, { revision: 2 }),
    { code: "REVISION_CONFLICT", status: 409 });
});

// D39
test("C4 D39 floor 缺失/跨组织/kind 错误：T0/T1 同态 NOT_FOUND，Z", async (t) => {
  for (const mutate of [
    (h) => dropRecord(h, "property_catalog", FLOOR),
    (h) => moveRecord(h, "property_catalog", FLOOR),
    (h) => patchRecord(h, "property_catalog", FLOOR, { kind: "building" }),
  ]) {
    await runT0Failure(t, {}, mutate, { code: "NOT_FOUND", status: 404 });
    await runT1Failure(t, {}, mutate, { code: "NOT_FOUND", status: 404 });
  }
});

// D40
test("C4 D40 floor 归档：T0/T1 均 ROOM_ARCHIVED，Z", async (t) => {
  await runT0Failure(t, {}, (h) => patchRecord(h, "property_catalog", FLOOR, { status: "archived" }),
    { code: "ROOM_ARCHIVED", status: 409 });
  await runT1Failure(t, {}, (h) => patchRecord(h, "property_catalog", FLOOR, { status: "archived" }),
    { code: "ROOM_ARCHIVED", status: 409 });
});

// D41
test("C4 D41 floor.parentId!=room.buildingId：T0/T1 均 REVISION_CONFLICT，Z", async (t) => {
  await runT0Failure(t, {}, (h) => patchRecord(h, "property_catalog", FLOOR, { parentId: "building-x" }),
    { code: "REVISION_CONFLICT", status: 409 });
  await runT1Failure(t, {}, (h) => patchRecord(h, "property_catalog", FLOOR, { parentId: "building-x" }),
    { code: "REVISION_CONFLICT", status: 409 });
});

// D42
test("C4 D42 building 缺失/跨组织/kind 错误：T0/T1 同态 NOT_FOUND，Z", async (t) => {
  for (const mutate of [
    (h) => dropRecord(h, "property_catalog", BUILDING),
    (h) => moveRecord(h, "property_catalog", BUILDING),
    (h) => patchRecord(h, "property_catalog", BUILDING, { kind: "community" }),
  ]) {
    await runT0Failure(t, {}, mutate, { code: "NOT_FOUND", status: 404 });
    await runT1Failure(t, {}, mutate, { code: "NOT_FOUND", status: 404 });
  }
});

// D43
test("C4 D43 building 归档：T0/T1 均 ROOM_ARCHIVED，Z", async (t) => {
  await runT0Failure(t, {}, (h) => patchRecord(h, "property_catalog", BUILDING, { status: "archived" }),
    { code: "ROOM_ARCHIVED", status: 409 });
  await runT1Failure(t, {}, (h) => patchRecord(h, "property_catalog", BUILDING, { status: "archived" }),
    { code: "ROOM_ARCHIVED", status: 409 });
});

// D44
test("C4 D44 building.parentId!=room.communityId：T0/T1 均 REVISION_CONFLICT，Z", async (t) => {
  await runT0Failure(t, {}, (h) => patchRecord(h, "property_catalog", BUILDING, { parentId: "community-x" }),
    { code: "REVISION_CONFLICT", status: 409 });
  await runT1Failure(t, {}, (h) => patchRecord(h, "property_catalog", BUILDING, { parentId: "community-x" }),
    { code: "REVISION_CONFLICT", status: 409 });
});

// D45
test("C4 D45 community 缺失/跨组织/kind 错误：T0/T1 同态 NOT_FOUND，Z", async (t) => {
  for (const mutate of [
    (h) => dropRecord(h, "property_catalog", COMMUNITY),
    (h) => moveRecord(h, "property_catalog", COMMUNITY),
    (h) => patchRecord(h, "property_catalog", COMMUNITY, { kind: "building" }),
  ]) {
    await runT0Failure(t, {}, mutate, { code: "NOT_FOUND", status: 404 });
    await runT1Failure(t, {}, mutate, { code: "NOT_FOUND", status: 404 });
  }
});

// D46
test("C4 D46 community 归档：T0/T1 均 ROOM_ARCHIVED，Z", async (t) => {
  await runT0Failure(t, {}, (h) => patchRecord(h, "property_catalog", COMMUNITY, { status: "archived" }),
    { code: "ROOM_ARCHIVED", status: 409 });
  await runT1Failure(t, {}, (h) => patchRecord(h, "property_catalog", COMMUNITY, { status: "archived" }),
    { code: "ROOM_ARCHIVED", status: 409 });
});

// D47
test("C4 D47 catalog revision 在 T1 改变：REVISION_CONFLICT，Z", async (t) => {
  await runT1Failure(t, {}, (h) => patchRecord(h, "property_catalog", FLOOR, { revision: 2 }),
    { code: "REVISION_CONFLICT", status: 409 });
});

// D48
test("C4 D48 validFrom<occupancy.startsAt：PARAM_ERROR，Z", async (t) => {
  const h = await setup(t);
  await expectFailure(h, h.input({ validFrom: QUAL_START - 1 }), {
    code: "PARAM_ERROR", status: 400,
  });
});

// D49
test("C4 D49 validUntil>occupancy.endsAt：PARAM_ERROR，Z", async (t) => {
  const h = await setup(t, { occupancy: { endsAt: NOW + 500 } });
  await expectFailure(h, h.input({ validUntil: NOW + 1_000 }), {
    code: "PARAM_ERROR", status: 400,
  });
});

// D50
test("C4 D50 validFrom<cycle.startsAt：PARAM_ERROR，Z", async (t) => {
  const h = await setup(t, { cycle: { startsAt: NOW - 500 } });
  await expectFailure(h, h.input({ validFrom: NOW - 600 }), {
    code: "PARAM_ERROR", status: 400,
  });
});

// D51
test("C4 D51 validUntil>min(cycle.endsAt,cycle.endedAt)：PARAM_ERROR，Z", async (t) => {
  const h = await setup(t, { cycle: { endsAt: NOW + 500 } });
  await expectFailure(h, h.input({ validUntil: NOW + 1_000 }), {
    code: "PARAM_ERROR", status: 400,
  });
});

// D52
test("C4 D52 授权区间严格短于且包含于入住/周期：成功，S", async (t) => {
  const h = await setup(t);
  await expectSuccess(h, h.input({ validFrom: NOW - 500, validUntil: NOW + 500 }));
});

// D53
test("C4 D53 now<validFrom：授权尚在将来 INVALID_STATE，Z", async (t) => {
  const h = await setup(t);
  await expectFailure(h, h.input({ validFrom: NOW + 100, validUntil: NOW + 1_000 }), {
    code: "INVALID_STATE", status: 409,
  });
});

// D54
test("C4 D54 now=validFrom：开始边界包含，成功，S", async (t) => {
  const h = await setup(t);
  await expectSuccess(h, h.input({ validFrom: NOW, validUntil: NOW + 1_000 }));
});

// D55
test("C4 D55 now=validUntil：结束边界排他 INVALID_STATE，Z", async (t) => {
  const h = await setup(t);
  await expectFailure(h, h.input({ validFrom: NOW - 1_000, validUntil: NOW }), {
    code: "INVALID_STATE", status: 409,
  });
});

// D56
test("C4 D56 真实 BlacklistService 无命中：eligible=true 成功，无自制桩", async (t) => {
  const h = await setup(t);
  await expectSuccess(h);
  assert.equal(h.lastEligibility.eligible, true);
  assert.deepEqual(h.lastEligibility.entryIds, []);
});

// D57
test("C4 D57 精确未过期 deny：BLACKLIST_DENIED，Z", async (t) => {
  const h = await setup(t, {
    blacklist: {
      entries: [entryRecord("entry-c4-deny")],
      decision: { entryIds: ["entry-c4-deny"], entryRevisions: [1], decision: "deny" },
    },
  });
  await expectFailure(h, h.input(), { code: "BLACKLIST_DENIED", status: 403 });
});

// D58
test("C4 D58 有命中但无决定/决定不全/已过期：BLACKLIST_REVIEW_REQUIRED，Z", async (t) => {
  const noDecision = await setup(t, {
    blacklist: { entries: [entryRecord("entry-c4-review")] },
  });
  await expectFailure(noDecision, noDecision.input(), {
    code: "BLACKLIST_REVIEW_REQUIRED", status: 409,
  });

  const partial = await setup(t, {
    blacklist: {
      entries: [entryRecord("entry-c4-a"), entryRecord("entry-c4-b")],
      decision: { entryIds: ["entry-c4-a"], entryRevisions: [1], decision: "allow" },
    },
  });
  await expectFailure(partial, partial.input(), {
    code: "BLACKLIST_REVIEW_REQUIRED", status: 409,
  });

  const expired = await setup(t, {
    blacklist: {
      entries: [entryRecord("entry-c4-expired")],
      decision: {
        entryIds: ["entry-c4-expired"], entryRevisions: [1],
        decision: "allow", expiresAt: NOW,
      },
    },
  });
  await expectFailure(expired, expired.input(), {
    code: "BLACKLIST_REVIEW_REQUIRED", status: 409,
  });
});

// D59
test("C4 D59 精确未过期 allow：成功且 decisionId 来自真实 evaluate", async (t) => {
  const h = await setup(t, {
    blacklist: {
      entries: [entryRecord("entry-c4-allow")],
      decision: { entryIds: ["entry-c4-allow"], entryRevisions: [1], decision: "allow" },
    },
  });
  await expectSuccess(h);
  assert.equal(h.lastEligibility.eligible, true);
  assert.equal(h.lastEligibility.decisionId, "decision-c4");
  assert.deepEqual(h.lastEligibility.entryIds, ["entry-c4-allow"]);
});

// D60
test("C4 D60 guard epoch T1 改变：首次 retry，第二次完整成功后成功", async (t) => {
  const h = await setup(t);
  h.hooks.beforeTransact = async (attempt) => {
    if (attempt !== 1) return;
    bumpPersonGuard(h);
    h.baseline = await snapshot(h.store);
  };
  await expectSuccess(h, h.input(), { baseline: "hook", guardDelta: 1 });
  assert.deepEqual(h.counts, { prepare: 2, evaluate: 2, transact: 2, build: 1 });
});

// D61
test("C4 D61 新增 candidate 在 T1 生效：guard 促发 retry，第二次 REVIEW_REQUIRED，Z", async (t) => {
  const h = await setup(t);
  h.hooks.beforeTransact = async (attempt) => {
    if (attempt !== 1) return;
    addCandidate(h);
    bumpPersonGuard(h);
    h.baseline = await snapshot(h.store);
  };
  await expectFailure(h, h.input(), {
    code: "BLACKLIST_REVIEW_REQUIRED", status: 409, baseline: "hook",
  });
  assert.deepEqual(h.counts, { prepare: 2, evaluate: 2, transact: 2, build: 0 });
});

// D62
test("C4 D62 guard/candidate 连续三次变化（T1+T2）：BLACKLIST_RETRY，无第四次，Z", async (t) => {
  const h = await setup(t);
  h.hooks.beforePrepare = async (attempt) => {
    if (attempt > 1) bumpPersonGuard(h);
  };
  h.hooks.beforeTransact = async () => {
    bumpPersonGuard(h);
    h.baseline = await snapshot(h.store);
  };
  await expectFailure(h, h.input(), {
    code: "BLACKLIST_RETRY", status: 409, baseline: "hook",
  });
  assert.deepEqual(h.counts, { prepare: 3, evaluate: 3, transact: 3, build: 0 });
  assert.equal(
    h.store.data.eligibility_guards
      .find((item) => item._id === eligibilityGuardId(ORG, "person", PERSON)).epoch,
    5,
    "T2+T1 每次共两次 guard 变化",
  );
});

// D63
test("C4 D63 权限/文件/设备同时 T1 变化：FORBIDDEN 优先，Z", async (t) => {
  const h = await setup(t);
  h.hooks.beforeTransact = async (attempt) => {
    if (attempt !== 1) return;
    patchRecord(h, "org_memberships", MEMBERSHIP, { permissions: [] });
    patchRecord(h, "file_assets", FILE, { revision: 9 });
    patchRecord(h, "access_devices", DEVICE, {
      revision: h.store.data.access_devices.find((item) => item._id === DEVICE).revision + 1,
    });
    h.baseline = await snapshot(h.store);
  };
  await expectFailure(h, h.input(), {
    code: "FORBIDDEN", status: 403, baseline: "hook",
  });
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 0, transact: 1, build: 0 });
});

// D64
test("C4 D64 file revision + K1 domain 在 T3 前（T1）变化：FILE_CHANGED 先于 H2-b，Z", async (t) => {
  const h = await setup(t);
  h.hooks.beforeTransact = async (attempt) => {
    if (attempt !== 1) return;
    patchRecord(h, "file_assets", FILE, { revision: 9 });
    patchRecord(h, "device_digest_domains", h.store.data.device_digest_domains[0]._id, {
      kind: "version",
    });
    h.baseline = await snapshot(h.store);
  };
  await expectFailure(h, h.input(), {
    code: "FILE_CHANGED", status: 409, baseline: "hook",
  });
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 0, transact: 1, build: 0 });
});

// D65
test("C4 D65 T3 释放 owner claim 并预建 slot：DEVICE_CLAIM_INVALID，slot 不被覆盖，Z", async (t) => {
  const h = await setup(t);
  const slotId = grantSlotKey({
    orgId: ORG, personId: PERSON, deviceId: DEVICE, cycleId: CYCLE,
  });
  h.hooks.afterEvaluate = (state) => {
    const claim = structuredClone(state[`device_claims/${CLAIM}`]);
    state[`device_claims/${CLAIM}`] = {
      ...claim, state: "released",
      boundDeviceId: undefined, activatedAt: undefined, activatedByAuditId: undefined,
      releasedAt: NOW, releasedByAuditId: "audit-release", releaseReason: "test",
    };
    state[`grant_slot_claims/${slotId}`] = {
      orgId: ORG, personId: PERSON, deviceId: DEVICE, cycleId: CYCLE,
      activeClaimId: "grant-other", state: "active", revision: 1,
      createdAt: NOW, updatedAt: NOW, activatedAt: NOW,
    };
  };
  await expectFailure(h, h.input(), {
    code: "DEVICE_CLAIM_INVALID", status: 409,
  });
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 1, transact: 1, build: 1 });
  assert.equal((await h.store.list("grant_slot_claims", ORG)).length, 0);
});

// D66
test("C4 D66 同资格不同 op key 并发同 slot：正反顺序各一成功一 GRANT_SLOT_CONFLICT", async (t) => {
  for (const order of ["ab", "ba"]) {
    const h = await setup(t);
    const before = await snapshot(h.store);
    const a = () => h.service.createGrant(h.input(), {
      idempotencyKey: `idem-c4-race-${order}-a-0001`,
    });
    const b = () => h.service.createGrant(h.input(), {
      idempotencyKey: `idem-c4-race-${order}-b-0001`,
    });
    const results = await Promise.allSettled(order === "ab" ? [a(), b()] : [b(), a()]);
    const ok = results.filter((item) => item.status === "fulfilled");
    const failed = results.filter((item) => item.status === "rejected");
    assert.equal(ok.length, 1, `${order}: 仅一个成功`);
    assert.equal(failed.length, 1, `${order}: 仅一个失败`);
    assert.equal(failed[0].reason.code, "GRANT_SLOT_CONFLICT", `${order}: 失败码`);
    const after = await snapshot(h.store);
    assertCoreCreated(before, after);
    assertUnchanged(before, after, new Set([...CORE, "eligibility_guards", "admin_audit"]));
    assert.equal(after.admin_audit.length, before.admin_audit.length + 1);
    assert.equal(after.eligibility_guards.length, before.eligibility_guards.length + 2);
    assertProviderZero(h);
  }
});

// D67
test("C4 D67 同 op key 同摘要合法重放：返回原 result，核心 writes=[]，R", async (t) => {
  const h = await setup(t);
  const first = await expectSuccess(h);
  resetCounts(h);
  const before = await snapshot(h.store);
  const replay = await h.service.createGrant(h.input(), { idempotencyKey: first.key });
  const after = await snapshot(h.store);
  assert.deepEqual(replay, first.result);
  for (const name of CORE) assert.deepEqual(after[name], before[name], `${name} 重放不变`);
  assertUnchanged(before, after, new Set(["eligibility_guards", "admin_audit"]));
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 1, transact: 1, build: 1 });
  assertProviderZero(h);
});

// D68
test("C4 D68 同 op key 不同摘要：CONFLICT，不得重放或覆盖，Z", async (t) => {
  const h = await setup(t);
  const first = await expectSuccess(h);
  resetCounts(h);
  await expectFailure(h, h.input({ cycleId: "cycle-other" }), {
    code: "CONFLICT", status: 409, key: first.key,
  });
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 0, transact: 1, build: 0 });
});

// D69
test("C4 D69 首次成功后 occupancy 失效再同键重放：资格错误，不跳过资格，Z", async (t) => {
  const h = await setup(t);
  const first = await expectSuccess(h);
  resetCounts(h);
  patchRecord(h, "occupancies", OCCUPANCY, { state: "ended" });
  await expectFailure(h, h.input(), {
    code: "INVALID_STATE", status: 409, key: first.key,
  });
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 0, transact: 1, build: 0 });
});

// D70
test("C4 D70 member 的 primary 缺失/非 active：SPONSOR_INACTIVE，Z", async (t) => {
  await runT0Failure(t, { role: "member", primaryMissing: true }, null,
    { code: "SPONSOR_INACTIVE", status: 409 });
  await runT0Failure(t, { role: "member", primaryState: "ended" }, null,
    { code: "SPONSOR_INACTIVE", status: 409 });
  const h = await setup(t, { role: "member" });
  injectFirstTransact(h, (harness) => {
    patchRecord(harness, "occupancies", OCC_PRIMARY, { state: "ended" });
  });
  await expectFailure(h, h.input(), {
    code: "SPONSOR_INACTIVE", status: 409, baseline: "hook",
  });
});

// D71
test("C4 D71 member 的 room slot cycle/occupancy/person 不匹配：SPONSOR_INACTIVE，Z", async (t) => {
  await runT0Failure(t, { role: "member" }, (h) => {
    patchRecord(h, "room_primary_slots", primarySlotId(ORG, ROOM), { currentCycleId: "cycle-other" });
  }, { code: "SPONSOR_INACTIVE", status: 409 });
  await runT0Failure(t, { role: "member" }, (h) => {
    patchRecord(h, "room_primary_slots", primarySlotId(ORG, ROOM), { currentOccupancyId: "occ-other" });
  }, { code: "SPONSOR_INACTIVE", status: 409 });
  await runT0Failure(t, { role: "member" }, (h) => {
    patchRecord(h, "room_primary_slots", primarySlotId(ORG, ROOM), { currentPersonId: "person-other" });
  }, { code: "SPONSOR_INACTIVE", status: 409 });
  await runT1Failure(t, { role: "member" }, (h) => {
    patchRecord(h, "room_primary_slots", primarySlotId(ORG, ROOM), { currentPersonId: "person-other" });
  }, { code: "SPONSOR_INACTIVE", status: 409 });
});

// D72
test("C4 D72 非空 sponsor 非 active 或不等于 cycle.primaryOccupancyId：SPONSOR_INACTIVE，Z", async (t) => {
  await runT0Failure(t, { role: "member", sponsor: "other" }, (h) => {
    patchRecord(h, "occupancies", OCC_SPONSOR, { state: "ended" });
  }, { code: "SPONSOR_INACTIVE", status: 409 });
  await runT0Failure(t, { role: "member", sponsor: "other" }, null,
    { code: "SPONSOR_INACTIVE", status: 409 });
  await runT1Failure(t, { role: "member", sponsor: "other" }, (h) => {
    patchRecord(h, "occupancies", OCC_SPONSOR, { state: "ended" });
  }, { code: "SPONSOR_INACTIVE", status: 409 });
});

// D73
// 设计 §4.1 的 33+N 把 primary 与 sponsor 计为两条 occupancies；Q02 要求
// sponsorOccupancyId === cycle.primaryOccupancyId，同一 collection/id 必然去重，
// 因此最大合法布局实测为 32+N：57/89、58/90、59/91。下列测试明确记录该差异。
test("C4 D73 最大布局容量：去重后 58 candidates/90 refs 单事务成功（57/89 亦记录）", async (t) => {
  const base = { role: "member", userId: USER1, sponsor: "primary" };
  const at57 = await setup(t, { ...base, candidates: 57 });
  await expectSuccess(at57, at57.input(), { guardDelta: 3 });
  assert.equal(at57.lastRefs, 89, "57 candidates 实际 89 refs（设计写 90）");

  const at58 = await setup(t, { ...base, candidates: 58 });
  await expectSuccess(at58, at58.input(), { guardDelta: 3 });
  assert.equal(at58.lastRefs, 90, "58 candidates 实际 90 refs");
});

// D74
test("C4 D74 最大布局容量：去重后 59 candidates/91 refs -> 400，58/90 可进入", async (t) => {
  const base = { role: "member", userId: USER1, sponsor: "primary" };
  const at58 = await setup(t, { ...base, candidates: 58 });
  await expectSuccess(at58, at58.input(), { guardDelta: 3 });
  assert.equal(at58.lastRefs, 90, "设计称 58/91，实测 58/90");

  const at59 = await setup(t, { ...base, candidates: 59 });
  await expectFailure(at59, at59.input(), { code: null, status: 400 });
  assert.equal(at59.counts.transact, 0, "91 refs 事务前失败关闭");
  assert.equal(at59.counts.prepare, 1);
});

// D75
test("C4 D75a createGrant 正常入口：适配器丢弃 prepareAttempt -> ADAPTER_UNAVAILABLE，Z", async (t) => {
  const h = await setup(t);
  const original = h.blacklist.withEligibility.bind(h.blacklist);
  // 模拟适配器只实现四参 withEligibility，丢弃 C2 prepareAttempt options。
  h.blacklist.withEligibility = async (request, refs, build, auditArg) =>
    original(request, refs, build, auditArg);
  await expectFailure(h, h.input(), {
    code: "ADAPTER_UNAVAILABLE", status: 503,
  });
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 1, transact: 1, build: 1 });
});

test("C4 D75b createGrant 正常入口：适配器复用上一 attempt 上下文 -> ADAPTER_UNAVAILABLE，Z", async (t) => {
  const h = await setup(t);
  const tokens = [];
  h.hooks.afterPrepare = (token) => tokens.push(token);
  const original = h.blacklist.withEligibility.bind(h.blacklist);
  let cached = null;
  h.blacklist.withEligibility = async (request, refs, build, auditArg, options) => {
    const prepare = options?.prepareAttempt;
    if (!prepare) return original(request, refs, build, auditArg, options);
    return original(request, refs, build, auditArg, {
      ...options,
      prepareAttempt: async (token) => {
        if (!cached) cached = await prepare(token);
        return cached;
      },
    });
  };
  injectFirstTransact(h, (harness) => {
    patchRecord(harness, "persons", PERSON, {
      revision: harness.store.data.persons.find((item) => item._id === PERSON).revision + 1,
    });
  });
  await expectFailure(h, h.input(), {
    code: "ADAPTER_UNAVAILABLE", status: 503, baseline: "hook",
  });
  assert.equal(tokens.length, 2, "每次 attempt 都重新 prepareEligibility");
  assert.notEqual(tokens[0], tokens[1], "每次 attempt 必须返回独立 token 对象");
  assert.deepEqual(h.counts, { prepare: 2, evaluate: 0, transact: 2, build: 0 });
});

test("C4 D75d createGrant 同 attempt 事务 callback 重跑：仅提交一次，S", async (t) => {
  const h = await setup(t);
  const originalTransact = h.store.transact.bind(h.store);
  let callbackRuns = 0;
  h.store.transact = async (refs, build, auditArg) => {
    if (!refs.some((item) => item.collection === "device_access_grants")) {
      return originalTransact(refs, build, auditArg);
    }
    return originalTransact(refs, async (state) => {
      // 第一次 callback 模拟 SDK 回滚：只计算并丢弃 writes。
      callbackRuns += 1;
      const rolledBack = await build(structuredClone(state));
      assert.ok(Array.isArray(rolledBack));
      // 同一 token 的最终 callback 只提交一次。
      callbackRuns += 1;
      return build(state);
    }, auditArg);
  };
  await expectSuccess(h);
  assert.equal(callbackRuns, 2, "同一 attempt callback 重跑两次");
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 2, transact: 1, build: 2 });
});

test("C4 D75c hook 伪造 eligible 不能绕过真实 evaluate（补充）", async (t) => {
  const h = await setup(t, {
    blacklist: { entries: [entryRecord("entry-c4-d75")] },
  });
  const request = {
    personId: PERSON, occupancyId: OCCUPANCY,
    identityApplicationId: IDENTITY, restriction: "occupancy.activate",
  };
  const before = await snapshot(h.store);
  await assert.rejects(
    () => h.blacklist.withEligibility(request, [], () => {
      throw Error("build 不得运行");
    }, audit, { prepareAttempt: async () => null }),
    (error) => error.code === "ADAPTER_UNAVAILABLE" && error.status === 503,
  );
  assert.equal(h.counts.transact, 0);
  assertUnchanged(before, await snapshot(h.store));

  resetCounts(h);
  let built = 0;
  await assert.rejects(
    () => h.blacklist.withEligibility(request, [], () => {
      built += 1;
      return { writes: [], result: null };
    }, audit, {
      prepareAttempt: async () => ({
        refs: [],
        beforeEvaluate: () => ({ eligible: true, code: null }),
      }),
    }),
    (error) => error.code === "BLACKLIST_REVIEW_REQUIRED" && error.status === 409,
  );
  assert.equal(built, 0, "hook 不得伪造 eligible 绕过真实 evaluate");
  assert.equal(h.counts.evaluate, 1);
  assertUnchanged(before, await snapshot(h.store));
});

// D73/D74 隔离 CloudStore 合约：不连接真实云，只验证 90/91 去重上限。
test("C4 D73/D74 隔离 CloudStore 合约：90 refs 可进入，91 refs 事务前 400", async () => {
  const refs = (count) => Array.from(
    { length: count },
    (_, index) => ref("unique_claims", `cap-${String(index).padStart(3, "0")}`),
  );
  const harness = () => {
    const stats = { transactions: 0, gets: 0 };
    const db = {
      async runTransaction(work) {
        stats.transactions += 1;
        const tx = {
          collection() {
            return {
              doc() {
                return {
                  async get() { stats.gets += 1; return { data: null }; },
                  async set() { return {}; },
                };
              },
            };
          },
        };
        return work(tx);
      },
    };
    return { store: new CloudStore({ database: () => db }), stats };
  };

  const at90 = harness();
  let built90 = 0;
  await at90.store.transact(refs(90), () => { built90 += 1; return []; }, audit);
  assert.equal(built90, 1, "90 条去重 refs 必须进入同一事务");
  assert.deepEqual(at90.stats, { transactions: 1, gets: 90 });

  const at91 = harness();
  let built91 = 0;
  await assert.rejects(
    () => at91.store.transact(refs(91), () => { built91 += 1; return []; }, audit),
    (error) => error.status === 400 && error.code === null,
  );
  assert.equal(built91, 0, "91 条必须在 build 前失败");
  assert.deepEqual(at91.stats, { transactions: 0, gets: 0 });
});

test("H2-d 同 operation key 并发：两请求返回同一结果且核心写集只提交一次", async (t) => {
  const h = await setup(t);
  const before = await snapshot(h.store);
  const key = "idem-h2d-same-operation-0001";
  const results = await Promise.allSettled([
    h.service.createGrant(h.input(), { idempotencyKey: key }),
    h.service.createGrant(h.input(), { idempotencyKey: key }),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 2);
  assert.deepEqual(results[0].value, results[1].value);
  const after = await snapshot(h.store);
  assertCoreCreated(before, after);
  assertUnchanged(before, after, new Set([...CORE, "eligibility_guards", "admin_audit"]));
  assert.equal(after.admin_audit.length, before.admin_audit.length + 2, "两次事务各追加一条审计");
  assert.equal(after.eligibility_guards.length, before.eligibility_guards.length + 2,
    "重放只覆盖同一组 subject guards");
  assertProviderZero(h);
});

// H2-d 复审补充：以下用例使用 setup() 的真实 LocalStore + BlacklistService +
// FaceCredentialService，不使用 eligible=true 资格桩；失败基线为注入后的完整快照。
test("H2-d 真实链 K2 损坏重放结果：真实 BlacklistService 预读后 CONFLICT 且内容不变", async (t) => {
  const h = await setup(t);
  const first = await expectSuccess(h);
  const keyRecord = h.store.data.operation_keys.find((row) => row.orgId === ORG);
  assert.ok(keyRecord, "成功授权必须写入 operation key");
  patchRecord(h, "operation_keys", keyRecord._id, {
    result: { ...keyRecord.result, grantId: "grant-h2d-wrong" },
  });
  resetCounts(h);
  await expectFailure(h, h.input(), { code: "CONFLICT", status: 409, key: first.key });
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 0, transact: 1, build: 0 },
    "K2 失败按冻结优先级发生在资格评价之前，但必须经过真实 BlacklistService 预读");
  assert.equal(h.lastEligibility, null);
  assertProviderZero(h);
});

test("H2-d 真实链 K2 配置换钥：真实 BlacklistService 预读后 DOMAIN_MISMATCH 且内容不变", async (t) => {
  const h = await setup(t);
  const first = await expectSuccess(h);
  const savedKey = process.env.OPERATION_KEY_HMAC_KEY_B64;
  resetCounts(h);
  try {
    process.env.OPERATION_KEY_HMAC_KEY_B64 = Buffer.alloc(32, 11).toString("base64");
    await expectFailure(h, h.input(), {
      code: "DOMAIN_MISMATCH", status: undefined, key: first.key,
    });
  } finally {
    process.env.OPERATION_KEY_HMAC_KEY_B64 = savedKey;
  }
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 0, transact: 1, build: 0 },
    "换钥失败按冻结优先级发生在资格评价之前，但必须经过真实 BlacklistService 预读");
  assert.equal(h.lastEligibility, null);
  assertProviderZero(h);
});

test("H2-d 真实链 K1 domain 损坏：真实资格评价后 DOMAIN_INCOMPLETE 且内容不变", async (t) => {
  const h = await setup(t);
  const version = h.store.data.device_digest_domains.find((row) => row.kind === "version");
  assert.ok(version, "fixture 必须具备 K1 version 记录");
  dropRecord(h, "device_digest_domains", version._id);
  resetCounts(h);
  await expectFailure(h, h.input(), { code: "DOMAIN_INCOMPLETE", status: 503 });
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 1, transact: 1, build: 1 },
    "K1 复核必须在真实资格/名单评价之后执行");
  assert.equal(h.lastEligibility.eligible, true);
  assertProviderZero(h);
});

test("H2-d 真实链 K1 配置不一致：真实资格评价后 DEVICE_DIGEST_CONFIG_CHANGED 且内容不变", async (t) => {
  const h = await setup(t);
  for (const row of h.store.data.device_digest_domains) {
    patchRecord(h, "device_digest_domains", row._id, {
      provider: "other-provider", digestRealm: "other-realm",
    });
  }
  resetCounts(h);
  await expectFailure(h, h.input(), {
    code: "DEVICE_DIGEST_CONFIG_CHANGED", status: 503,
  });
  assert.deepEqual(h.counts, { prepare: 1, evaluate: 1, transact: 1, build: 1 },
    "K1 复核必须在真实资格/名单评价之后执行");
  assert.equal(h.lastEligibility.eligible, true);
  assertProviderZero(h);
});

async function dispatchFixture(t, scenario = "success", options = {}) {
  let now = NOW;
  const h = await setup(t, {
    dispatchNow: () => now, syntheticDispatch: true, validUntil: NOW + 900_000, qualificationEnd: NOW + 900_001,
    ...options,
  });
  const provider = new MockFaceAccessProvider({ scenario });
  const worker = () => new MockFaceDispatcher({
    store: h.store, orgId: ORG, files: h.files, blacklist: h.blacklist, provider,
    ...(options.runtimeConfig ? { runtimeConfig: options.runtimeConfig } : {}),
  });
  if (options.prepare) await options.prepare(h);
  const result = await h.service.createGrant(h.input(), { idempotencyKey: h.nextKey() });
  return { ...h, ...result, provider, worker, setTime: (value) => { now = value; } };
}

test("H3 D46 concurrent dispatch: one call outside every transaction, simulated success stays pending", async (t) => {
  const h = await dispatchFixture(t);
  const before = structuredClone(h.store.data);
  const transact = h.store.transactFaceDispatch.bind(h.store);
  const enroll = h.provider.enrollFace.bind(h.provider);
  let transactionDepth = 0;
  let calls = 0;
  h.store.transactFaceDispatch = (refs, build) => transact(refs, (state, now) => {
    transactionDepth++;
    try {
      const first = build(state, now);
      assert.deepEqual(build(state, now), first);
      return first;
    } finally {
      transactionDepth--;
    }
  });
  h.provider.enrollFace = (input, context) => {
    assert.equal(transactionDepth, 0);
    assert.deepEqual(Object.keys(input).sort(), ["deviceId", "grantId", "personId", "sourceFileId", "validFrom", "validUntil"]);
    assert.equal(context.executionMode, "test");
    assert.match(context.idempotencyKey, /^h3-v1:[a-f0-9]{64}$/);
    calls++;
    return enroll(input, context);
  };
  const outcomes = await Promise.allSettled([h.worker().dispatch(h.jobId), h.worker().dispatch(h.jobId)]);
  const success = outcomes.find((outcome) => outcome.status === "fulfilled")?.value;
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1, JSON.stringify(outcomes));
  assert.equal(rejected.reason.code, "INVALID_JOB", "同一 revision 的第二个领取必须被拒");
  assert.equal(success.state, "succeeded", JSON.stringify(success.result));
  assert.equal(calls, 1);
  assert.equal(h.provider.calls.length, 1);
  const grant = await h.store.get("device_access_grants", h.grantId, ORG);
  assert.equal(grant.state, "pending");
  assert.equal(projectAccess({ grant, jobs: [success], eligibility: { allowed: true } }).deviceEffective, false);
  assert.deepEqual(h.store.data.device_operation_logs.map((log) => log.state), ["queued", "sending", "succeeded"]);
  assert.deepEqual(h.store.data.device_operation_logs.map((log) => log.revision), [1, 2, 4]);
  for (const [collection, records] of Object.entries(before)) {
    if (!["device_operation_jobs", "device_operation_logs"].includes(collection)) {
      assert.deepEqual(h.store.data[collection], records, collection);
    }
  }
});

test("H3 D41/D42 explicitly pre-send Mock failures get three retries and exhaust from sending", async (t) => {
  const h = await dispatchFixture(t, "pre_send_fail");
  const worker = h.worker();
  let now = NOW;
  for (const [index, delay] of [30_000, 120_000, 600_000].entries()) {
    const failed = await worker.dispatch(h.jobId);
    assert.equal(failed.state, "retryable_failed");
    assert.equal(failed.attempts, index + 1);
    assert.equal(failed.nextAttemptAt, now + delay);
    const before = structuredClone(h.store.data);
    h.setTime(now + delay - 1);
    await assert.rejects(worker.requeue(h.jobId, failed.revision), { code: "RETRY_NOT_DUE" });
    assert.deepEqual(h.store.data, before);
    now += delay;
    h.setTime(now);
    const queued = await worker.requeue(h.jobId, failed.revision);
    assert.equal(queued.state, "queued");
    assert.equal(queued.attempts, failed.attempts);
  }
  const final = await worker.dispatch(h.jobId);
  assert.equal(final.state, "terminal_failed");
  assert.equal(final.attempts, 4);
  assert.equal(final.result.reasonCode, "RETRY_EXHAUSTED");
  assert.equal(h.provider.calls.length, 4);
  assert.equal(h.store.data.device_operation_logs.at(-1).alertCode, "RETRY_EXHAUSTED");
  const terminal = structuredClone(h.store.data);
  await assert.rejects(worker.requeue(h.jobId, final.revision), { code: "INVALID_JOB" });
  assert.deepEqual(h.store.data, terminal, "预算耗尽后重试必须零写");
  assert.equal(h.provider.calls.length, 4);
});

test("H3 D53 unknown result never requeues", async (t) => {
  const h = await dispatchFixture(t, "post_send_unknown");
  const worker = h.worker();
  const unknown = await worker.dispatch(h.jobId);
  assert.equal(unknown.state, "awaiting_result");
  assert.equal(unknown.result.errorKind, "UNKNOWN_RESULT");
  assert.equal(unknown.result.reasonCode, "RESULT_UNKNOWN");
  assert.equal(h.store.data.device_operation_logs.at(-1).alertCode, "RESULT_UNKNOWN");
  const before = structuredClone(h.store.data);
  await assert.rejects(worker.requeue(h.jobId, unknown.revision), { code: "INVALID_JOB" });
  await assert.rejects(worker.dispatch(h.jobId), { code: "INVALID_JOB" });
  assert.deepEqual(h.store.data, before);
  assert.equal(h.provider.calls.length, 1);
});

test("H3 D19/D58 lost claim commit acknowledgement expires without a send", async (t) => {
  const h = await dispatchFixture(t);
  const worker = h.worker();
  const transact = h.store.transactFaceDispatch.bind(h.store);
  h.store.transactFaceDispatch = async (...args) => {
    await transact(...args);
    throw Error("synthetic commit acknowledgement loss");
  };
  await assert.rejects(worker.dispatch(h.jobId), /acknowledgement loss/);
  h.store.transactFaceDispatch = transact;
  const afterLostClaim = structuredClone(h.store.data);
  await assert.rejects(worker.dispatch(h.jobId), { code: "INVALID_JOB" }, "同 owner 重入不得恢复许可");
  assert.deepEqual(h.store.data, afterLostClaim, "重入不得零写之外的任何变化");
  assert.equal(h.provider.calls.length, 0);
  h.setTime(NOW + 59_999);
  const before = structuredClone(h.store.data);
  await assert.rejects(worker.expire(h.jobId), { code: "LEASE_FENCE_REJECTED" });
  assert.deepEqual(h.store.data, before);
  h.setTime(NOW + 60_000);
  const outcomes = await Promise.allSettled([worker.expire(h.jobId), h.worker().expire(h.jobId)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const job = await h.store.get("device_operation_jobs", h.jobId, ORG);
  assert.equal(job.state, "awaiting_result");
  assert.equal(job.result.reasonCode, "LEASE_EXPIRED_UNKNOWN");
  assert.equal(h.store.data.device_operation_logs.filter((log) => log.jobId === h.jobId &&
    log.state === "awaiting_result").length, 1, "并发扫描只提交一条结果日志");
  assert.equal(h.provider.calls.length, 0);
  assert.deepEqual(h.store.data.admin_audit, before.admin_audit);
});

test("H3 changed source file blocks Mock and leaves only deterministic job logs", async (t) => {
  const h = await dispatchFixture(t);
  const before = structuredClone(h.store.data);
  const transact = h.store.transactFaceDispatch.bind(h.store);
  let calls = 0;
  h.store.transactFaceDispatch = async (...args) => {
    const result = await transact(...args);
    if (++calls === 1) patchRecord(h, "file_assets", FILE, { revision: 2 });
    return result;
  };
  const job = await h.worker().dispatch(h.jobId);
  assert.equal(job.state, "terminal_failed");
  assert.equal(job.result.reasonCode, "FILE_BINDING_CHANGED");
  assert.equal(h.provider.calls.length, 0);
  assert.deepEqual(h.store.data.device_operation_logs.map((log) => log.state), ["queued", "sending", "terminal_failed"]);
  const grant = h.store.data.device_access_grants.find((row) => row._id === h.grantId);
  assert.equal(grant.state, "pending");
  assert.deepEqual(h.store.data.admin_audit, before.admin_audit);
});

test("H3 D50 legacy H2 job without a snapshot fails closed", async (t) => {
  const h = await dispatchFixture(t, "success", { syntheticDispatch: false });
  const before = structuredClone(h.store.data);
  await assert.rejects(h.worker().dispatch(h.jobId), { code: "DISPATCH_SNAPSHOT_REQUIRED" });
  assert.deepEqual(h.store.data, before);
  assert.equal(h.provider.calls.length, 0);
});

test("H3 D64 authentic blacklist changes between prepare and T2 refresh the token and block enrollment", async (t) => {
  const h = await dispatchFixture(t);
  const before = structuredClone(h.store.data);
  const transact = h.store.transactFaceDispatch.bind(h.store);
  let transactions = 0;
  h.store.transactFaceDispatch = (refs, build) => {
    if (++transactions === 2) {
      addCandidate(h);
      bumpPersonGuard(h);
    }
    return transact(refs, build);
  };
  const job = await h.worker().dispatch(h.jobId);
  assert.equal(job.state, "terminal_failed");
  assert.equal(job.result.reasonCode, "BLACKLIST_REVIEW_REQUIRED");
  assert.equal(h.provider.calls.length, 0);
  assert.equal(transactions, 3, "首轮 BLACKLIST_RETRY 后必须重建 token 并重验");
  assert.equal(h.store.data.device_operation_logs.filter((log) => log.jobId === h.jobId &&
    log.state === "terminal_failed").length, 1);
  const grant = h.store.data.device_access_grants.find((row) => row._id === h.grantId);
  assert.equal(grant.state, "pending");
  assert.deepEqual(h.store.data.admin_audit, before.admin_audit);
});

test("H3 D55 lost authorization acknowledgement never consumes the permit", async (t) => {
  const h = await dispatchFixture(t);
  const worker = h.worker();
  const transact = h.store.transactFaceDispatch.bind(h.store);
  let transactions = 0;
  h.store.transactFaceDispatch = async (...args) => {
    const result = await transact(...args);
    if (++transactions === 2) throw Error("authorization acknowledgement loss");
    return result;
  };
  await assert.rejects(worker.dispatch(h.jobId), /authorization acknowledgement loss/);
  assert.equal(h.provider.calls.length, 0);
  const sending = await h.store.get("device_operation_jobs", h.jobId, ORG);
  assert.equal(sending.dispatchAuthorizedAt, NOW);
  h.setTime(NOW + 60_000);
  assert.deepEqual(await worker.scanExpired(), [{ jobId: h.jobId, state: "awaiting_result" }]);
  assert.deepEqual(await worker.scanExpired(), []);
});

test("H3 terminal and unrecognized Mock errors never schedule a retry", async (t) => {
  const terminal = await dispatchFixture(t, "terminal_fail");
  assert.equal((await terminal.worker().dispatch(terminal.jobId)).state, "terminal_failed");
  assert.equal(terminal.provider.calls.length, 1);

  const unknown = await dispatchFixture(t);
  const syntheticMarker = "synthetic-error-private-marker";
  unknown.provider.enrollFace = async () => { throw Error(syntheticMarker); };
  assert.equal((await unknown.worker().dispatch(unknown.jobId)).state, "awaiting_result");
  const output = [
    ...unknown.store.data.device_operation_jobs, ...unknown.store.data.device_operation_logs,
    ...unknown.store.data.face_dispatch_snapshots,
  ];
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes(syntheticMarker));
  for (const field of ["identityDigest", "objectKey", "sourceFileRevision", "idempotencyKey", "stack"]) {
    assert.ok(!serialized.includes('"' + field + '":'), field);
  }
});

test("H3 D54 manual retry requires current membership permission and shares the automatic CAS", async (t) => {
  const h = await dispatchFixture(t, "pre_send_fail");
  const worker = h.worker();
  const failed = await worker.dispatch(h.jobId);
  h.setTime(failed.nextAttemptAt);
  const actor = { membershipId: MEMBERSHIP, actorId: MEMBERSHIP };
  const before = structuredClone(h.store.data);
  await assert.rejects(worker.requeue(h.jobId, failed.revision, actor), { code: "FORBIDDEN" });
  assert.deepEqual(h.store.data, before);
  patchRecord(h, "org_memberships", MEMBERSHIP, {
    permissions: ["device.access.manage", "device.operation.retry"],
  });
  const outcomes = await Promise.allSettled([
    worker.requeue(h.jobId, failed.revision, actor), h.worker().requeue(h.jobId, failed.revision),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(h.provider.calls.length, 1);
  assert.equal(h.store.data.device_operation_logs.filter((log) => log.state === "queued").length, 2);
});

// ---------------------------------------------------------------------------
// H3 复审：D01–D66 逐项可复验证据。
// 所有派发用例只使用隔离合成 LocalStore + 进程内 MockFaceAccessProvider。
// 断言约定：Z = 整库内容级不变（含 admin_audit），J = 仅 job + 一条确定性日志，
// A = 仅 job 的 dispatchAuthorizedAt + revision。
// ---------------------------------------------------------------------------
const H3_WRITE_COLLECTIONS = ["device_operation_jobs", "device_operation_logs"];

const h3Logs = (h) => h.store.data.device_operation_logs.filter((log) => log.jobId === h.jobId);

function assertH3OnlyJobLogs(h, baseline) {
  for (const name of Object.keys(baseline)) {
    if (H3_WRITE_COLLECTIONS.includes(name)) continue;
    assert.deepEqual(h.store.data[name], baseline[name], `${name} 不得被派发改写`);
  }
  assert.deepEqual(h.store.data.admin_audit, baseline.admin_audit, "派发不得追加 admin_audit");
}

// 在 T1 提交后注入外部写/损坏，并固定注入后的完整快照作为零写对照。
function h3AfterT1(h, mutate) {
  const transact = h.store.transactFaceDispatch.bind(h.store);
  let calls = 0;
  h.store.transactFaceDispatch = async (refs, build) => {
    const value = await transact(refs, build);
    if (++calls === 1) {
      mutate(h);
      h.h3Baseline = structuredClone(h.store.data);
    }
    return value;
  };
}

// T1 提交后立即中断（用于只观察领取写集，不进入 T2）。
function h3StopAfterT1(h) {
  const transact = h.store.transactFaceDispatch.bind(h.store);
  let calls = 0;
  h.store.transactFaceDispatch = async (refs, build) => {
    const value = await transact(refs, build);
    if (++calls === 1) {
      const error = new Error("stop-after-T1");
      error.code = "TEST_STOP";
      throw error;
    }
    return value;
  };
}

function h3ExpectTerminal(h, code) {
  assert.equal(h.provider.calls.length, 0, "pre-send 拒绝不得调用 Provider");
  const job = h.store.data.device_operation_jobs.find((row) => row._id === h.jobId);
  assert.ok(job, "job 必须存在");
  assert.equal(job.state, "terminal_failed");
  assert.equal(job.result.outcome, "terminal_failed");
  assert.equal(job.result.errorKind, "PRE_SEND_BLOCKED");
  assert.equal(job.result.reasonCode, code);
  assert.equal(job.result.attempt, 1);
  assert.equal(job.leaseOwner, null);
  assert.equal(job.leaseExpiresAt, null);
  assert.equal(job.dispatchAuthorizedAt, null);
  assert.deepEqual(h3Logs(h).map((log) => log.state), ["queued", "sending", "terminal_failed"]);
  assert.equal(h3Logs(h).at(-1).reasonCode, code);
  const grant = h.store.data.device_access_grants.find((row) => row._id === h.grantId);
  const grantBefore = h.h3Baseline.device_access_grants.find((row) => row._id === h.grantId);
  assert.deepEqual(grant, grantBefore, "grant 不得被 dispatcher 改写");
  assertH3OnlyJobLogs(h, h.h3Baseline);
  return job;
}

test("H3 D01 queued→sending：单条确定性领取日志，attempt=1/generation=1，J 且零 audit", async (t) => {
  const h = await dispatchFixture(t);
  const before = structuredClone(h.store.data);
  h3StopAfterT1(h);
  await assert.rejects(h.worker().dispatch(h.jobId), { code: "TEST_STOP" });
  const job = h.store.data.device_operation_jobs.find((row) => row._id === h.jobId);
  assert.equal(job.state, "sending");
  assert.equal(job.attempts, 1);
  assert.equal(job.leaseGeneration, 1);
  assert.equal(job.revision, 2);
  assert.equal(typeof job.leaseOwner, "string");
  assert.ok(job.leaseOwner.length > 0);
  assert.equal(job.leaseExpiresAt, NOW + 60_000);
  assert.equal(job.nextAttemptAt, null);
  assert.equal(job.result, null);
  assert.equal(job.dispatchAuthorizedAt, null);
  assert.deepEqual(h3Logs(h).map((log) => log.state), ["queued", "sending"]);
  assert.deepEqual(h3Logs(h).map((log) => log.revision), [1, 2]);
  assert.equal(h3Logs(h)[1].leaseGeneration, 1);
  assert.equal(h3Logs(h)[1].attempt, 1);
  assert.equal(h3Logs(h)[1].evidenceScope, "simulated");
  assert.equal(h.provider.calls.length, 0);
  assertH3OnlyJobLogs(h, before);
});

test("H3 D02 两个 owner 同 revision 并发 T1：仅一个领取提交，另一个 INVALID_JOB，J", async (t) => {
  const h = await dispatchFixture(t);
  const before = structuredClone(h.store.data);
  h3StopAfterT1(h);
  const outcomes = await Promise.allSettled([
    h.worker().dispatch(h.jobId), h.worker().dispatch(h.jobId),
  ]);
  const codes = outcomes.map((outcome) => outcome.status === "rejected" ? outcome.reason.code : "OK").sort();
  assert.deepEqual(codes, ["INVALID_JOB", "TEST_STOP"]);
  const job = h.store.data.device_operation_jobs.find((row) => row._id === h.jobId);
  assert.equal(job.state, "sending");
  assert.equal(job.revision, 2);
  assert.deepEqual(h3Logs(h).map((log) => log.state), ["queued", "sending"]);
  assert.equal(h.provider.calls.length, 0);
  assertH3OnlyJobLogs(h, before);
});

test("H3 D03 事务 callback 回滚并重跑：sending log 只提交一条，J", async (t) => {
  const h = await dispatchFixture(t);
  const before = structuredClone(h.store.data);
  const transact = h.store.transactFaceDispatch.bind(h.store);
  let planBuilds = 0;
  h.store.transactFaceDispatch = (refs, build) => transact(refs, (state, now) => {
    planBuilds += 1;
    const discarded = build(structuredClone(state), now);
    planBuilds += 1;
    const final = build(state, now);
    assert.deepEqual(final, discarded, "重跑必须得到同一写计划");
    return final;
  });
  h3StopAfterT1(h);
  await assert.rejects(h.worker().dispatch(h.jobId), { code: "TEST_STOP" });
  assert.equal(planBuilds, 2);
  assert.deepEqual(h3Logs(h).map((log) => log.state), ["queued", "sending"]);
  assert.equal(h3Logs(h).length, 2);
  assert.equal(h.store.data.device_operation_jobs.filter((row) => row._id === h.jobId).length, 1);
  assertH3OnlyJobLogs(h, before);
});

test("H3 D04 succeeded 再次领取：INVALID_JOB，Z", async (t) => {
  const h = await dispatchFixture(t);
  const done = await h.worker().dispatch(h.jobId);
  assert.equal(done.state, "succeeded");
  const before = structuredClone(h.store.data);
  await assert.rejects(h.worker().dispatch(h.jobId), { code: "INVALID_JOB" });
  assert.deepEqual(h.store.data, before);
  assert.equal(h.provider.calls.length, 1);
});

test("H3 D05 领取参数损坏：缺 grantId → INVALID_JOB，Z", async (t) => {
  const h = await dispatchFixture(t);
  const job = h.store.data.device_operation_jobs.find((row) => row._id === h.jobId);
  delete job.grantId;
  const before = structuredClone(h.store.data);
  await assert.rejects(h.worker().dispatch(h.jobId), { code: "INVALID_JOB" });
  assert.deepEqual(h.store.data, before);
  assert.equal(h.provider.calls.length, 0);
});

test("H3 D06 跨组织领取：统一 NOT_FOUND，Z", async (t) => {
  const h = await dispatchFixture(t);
  patchRecord(h, "device_operation_jobs", h.jobId, { orgId: ORG_OTHER });
  const before = structuredClone(h.store.data);
  await assert.rejects(h.worker().dispatch(h.jobId), { code: "NOT_FOUND", status: 404 });
  assert.deepEqual(h.store.data, before);
  assert.equal(h.provider.calls.length, 0);
});

test("H3 D07 错 action 领取：INVALID_JOB，Z", async (t) => {
  const h = await dispatchFixture(t);
  patchRecord(h, "device_operation_jobs", h.jobId, { action: "update" });
  const before = structuredClone(h.store.data);
  await assert.rejects(h.worker().dispatch(h.jobId), { code: "INVALID_JOB" });
  assert.deepEqual(h.store.data, before);
  assert.equal(h.provider.calls.length, 0);
});

test("H3 D08 空白 leaseOwner：INVALID_JOB，Z", async (t) => {
  const h = await dispatchFixture(t);
  patchRecord(h, "device_operation_jobs", h.jobId, { leaseOwner: "" });
  const before = structuredClone(h.store.data);
  await assert.rejects(h.worker().dispatch(h.jobId), { code: "INVALID_JOB" });
  assert.deepEqual(h.store.data, before);
  assert.equal(h.provider.calls.length, 0);
});

test("H3 D09 不安全时间字段：INVALID_JOB；小数时钟失败关闭，均零写", async (t) => {
  const unsafe = await dispatchFixture(t);
  patchRecord(unsafe, "device_operation_jobs", unsafe.jobId, { createdAt: 1.5 });
  const beforeUnsafe = structuredClone(unsafe.store.data);
  await assert.rejects(unsafe.worker().dispatch(unsafe.jobId), { code: "INVALID_JOB" });
  assert.deepEqual(unsafe.store.data, beforeUnsafe);

  const expiring = await dispatchFixture(t);
  patchRecord(expiring, "device_operation_jobs", expiring.jobId, { leaseExpiresAt: 1.5 });
  const beforeExpiring = structuredClone(expiring.store.data);
  await assert.rejects(expiring.worker().dispatch(expiring.jobId), { code: "INVALID_JOB" });
  assert.deepEqual(expiring.store.data, beforeExpiring);

  const clock = await dispatchFixture(t);
  clock.setTime(1.5);
  const beforeClock = structuredClone(clock.store.data);
  await assert.rejects(
    clock.worker().dispatch(clock.jobId),
    (error) => error.status === 503 && error.code === null,
  );
  assert.deepEqual(clock.store.data, beforeClock);
  assert.equal(clock.provider.calls.length, 0);

  const rollback = await dispatchFixture(t);
  assert.equal((await rollback.worker().dispatch(rollback.jobId)).state, "succeeded");
  rollback.setTime(NOW - 1);
  const beforeRollback = structuredClone(rollback.store.data);
  await assert.rejects(
    rollback.worker().scanExpired(),
    (error) => error.status === 503 && error.code === null,
  );
  assert.deepEqual(rollback.store.data, beforeRollback);
});

test("H3 D10 revision 非安全整数或将溢出：INVALID_JOB，Z", async (t) => {
  const fractional = await dispatchFixture(t);
  patchRecord(fractional, "device_operation_jobs", fractional.jobId, { revision: 1.5 });
  const beforeFractional = structuredClone(fractional.store.data);
  await assert.rejects(fractional.worker().dispatch(fractional.jobId), { code: "INVALID_JOB" });
  assert.deepEqual(fractional.store.data, beforeFractional);

  const overflow = await dispatchFixture(t);
  patchRecord(overflow, "device_operation_jobs", overflow.jobId, { revision: Number.MAX_SAFE_INTEGER });
  const beforeOverflow = structuredClone(overflow.store.data);
  await assert.rejects(overflow.worker().dispatch(overflow.jobId), { code: "INVALID_JOB" });
  assert.deepEqual(overflow.store.data, beforeOverflow);
  assert.equal(overflow.provider.calls.length, 0);
});

test("H3 D11 attempts 负数/非安全整数/超预算：INVALID_JOB，Z", async (t) => {
  for (const [patch, label] of [
    [{ attempts: -1 }, "负数"],
    [{ attempts: 1.5 }, "小数"],
    [{ attempts: 5, leaseGeneration: 5 }, "超过 4"],
  ]) {
    const h = await dispatchFixture(t);
    patchRecord(h, "device_operation_jobs", h.jobId, patch);
    const before = structuredClone(h.store.data);
    await assert.rejects(h.worker().dispatch(h.jobId), { code: "INVALID_JOB" }, label);
    assert.deepEqual(h.store.data, before, label);
    assert.equal(h.provider.calls.length, 0, label);
  }
});

async function h3FenceCase(t, mutate) {
  const h = await dispatchFixture(t);
  h3AfterT1(h, mutate);
  await assert.rejects(h.worker().dispatch(h.jobId), { code: "LEASE_FENCE_REJECTED" });
  assert.deepEqual(h.store.data, h.h3Baseline, "fence 拒绝必须零写（含日志与 audit）");
  assert.equal(h.provider.calls.length, 0);
  const job = h.store.data.device_operation_jobs.find((row) => row._id === h.jobId);
  assert.equal(job.state, "sending");
  return h;
}

test("H3 D12 旧 worker 在新 generation 回写：LEASE_FENCE_REJECTED，Z", async (t) => {
  await h3FenceCase(t, (h) => patchRecord(h, "device_operation_jobs", h.jobId, {
    leaseOwner: "new-owner",
    leaseGeneration: 2,
    attempts: 2,
    revision: 3,
    leaseExpiresAt: NOW + 120_000,
  }));
});

test("H3 D13 回写时 now 等于 expiresAt：LEASE_FENCE_REJECTED，Z", async (t) => {
  const h = await dispatchFixture(t);
  h3AfterT1(h, (harness) => harness.setTime(NOW + 60_000));
  await assert.rejects(h.worker().dispatch(h.jobId), { code: "LEASE_FENCE_REJECTED" });
  assert.deepEqual(h.store.data, h.h3Baseline);
  assert.equal(h.provider.calls.length, 0);

  // T3 回写边界：调用已发生，但结果提交时租约等号即过期。
  const late = await dispatchFixture(t);
  const auditBefore = structuredClone(late.store.data.admin_audit);
  const enroll = late.provider.enrollFace.bind(late.provider);
  late.provider.enrollFace = async (input, context) => {
    late.setTime(NOW + 60_000);
    return enroll(input, context);
  };
  await assert.rejects(late.worker().dispatch(late.jobId), { code: "LEASE_FENCE_REJECTED" });
  const job = h3JobRow(late);
  assert.equal(job.state, "sending");
  assert.equal(job.revision, 3);
  assert.deepEqual(h3Logs(late).map((log) => log.state), ["queued", "sending"]);
  assert.equal(late.provider.calls.length, 1);
  const grant = late.store.data.device_access_grants.find((row) => row._id === late.grantId);
  assert.equal(grant.state, "pending");
  assert.deepEqual(late.store.data.admin_audit, auditBefore, "T3 fence 拒绝不得写 audit");
});

test("H3 D14 错 generation 回写：LEASE_FENCE_REJECTED，Z", async (t) => {
  await h3FenceCase(t, (h) => patchRecord(h, "device_operation_jobs", h.jobId, { leaseGeneration: 2 }));
});

test("H3 D15 错 owner 回写：LEASE_FENCE_REJECTED，Z", async (t) => {
  await h3FenceCase(t, (h) => patchRecord(h, "device_operation_jobs", h.jobId, { leaseOwner: "other-owner" }));
});

test("H3 D16 同 owner 重入 T2：LEASE_FENCE_REJECTED，零许可零写", async (t) => {
  const h = await dispatchFixture(t);
  h3AfterT1(h, () => {});
  const transact = h.store.transactFaceDispatch.bind(h.store);
  let calls = 0;
  h.store.transactFaceDispatch = (refs, build) => transact(refs, (state, now) => {
    const first = build(state, now);
    if (++calls === 2) {
      // 模拟适配器已应用首次 T2 写计划后 rerun callback。
      for (const write of first) {
        const key = `${write.collection}/${write.id}`;
        state[key] = { ...(state[key] || {}), ...write.data, _id: write.id };
      }
      return build(state, now);
    }
    return first;
  });
  await assert.rejects(h.worker().dispatch(h.jobId), { code: "LEASE_FENCE_REJECTED" });
  assert.deepEqual(h.store.data, h.h3Baseline);
  assert.equal(h.provider.calls.length, 0);
  const job = h.store.data.device_operation_jobs.find((row) => row._id === h.jobId);
  assert.equal(job.state, "sending");
  assert.equal(job.dispatchAuthorizedAt, null);
  assert.equal(job.revision, 2);
});

test("H3 D61 错 revision 或 attempt 回写：LEASE_FENCE_REJECTED，Z", async (t) => {
  await h3FenceCase(t, (h) => patchRecord(h, "device_operation_jobs", h.jobId, { revision: 3 }));
  await h3FenceCase(t, (h) => patchRecord(h, "device_operation_jobs", h.jobId, {
    attempts: 2, leaseGeneration: 2,
  }));
});

function h3JobRow(h) {
  return h.store.data.device_operation_jobs.find((row) => row._id === h.jobId);
}

// 在 Provider 入口挂起，用于构造“已确认 T2/已调用但 T3 未提交”的窗口。
function h3GateProvider(h) {
  let release;
  let markEntered;
  const gate = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { markEntered = resolve; });
  const enroll = h.provider.enrollFace.bind(h.provider);
  h.provider.enrollFace = async (input, context) => {
    markEntered();
    await gate;
    return enroll(input, context);
  };
  return { entered, release };
}

test("H3 D17 明确 pre-send RETRYABLE：retryable_failed + 30s 退避，A+J", async (t) => {
  const h = await dispatchFixture(t, "pre_send_fail");
  const before = structuredClone(h.store.data);
  const job = await h.worker().dispatch(h.jobId);
  assert.equal(job.state, "retryable_failed");
  assert.equal(job.attempts, 1);
  assert.equal(job.nextAttemptAt, NOW + 30_000);
  assert.equal(job.result.outcome, "retryable_failed");
  assert.equal(job.result.errorKind, "RETRYABLE");
  assert.equal(job.result.reasonCode, "PROVIDER_PRE_SEND");
  assert.equal(h.provider.calls.length, 1);
  assert.deepEqual(h3Logs(h).map((log) => log.state), ["queued", "sending", "retryable_failed"]);
  assert.equal(h3Logs(h).at(-1).errorKind, "RETRYABLE");
  const grant = h.store.data.device_access_grants.find((row) => row._id === h.grantId);
  assert.equal(grant.state, "pending");
  assertH3OnlyJobLogs(h, before);
});

test("H3 D18 post_send_unknown：awaiting_result + RESULT_UNKNOWN 告警，A+J", async (t) => {
  const h = await dispatchFixture(t, "post_send_unknown");
  const before = structuredClone(h.store.data);
  const job = await h.worker().dispatch(h.jobId);
  assert.equal(job.state, "awaiting_result");
  assert.equal(job.result.outcome, "awaiting_result");
  assert.equal(job.result.errorKind, "UNKNOWN_RESULT");
  assert.equal(job.result.reasonCode, "RESULT_UNKNOWN");
  assert.equal(h3Logs(h).at(-1).alertCode, "RESULT_UNKNOWN");
  assert.equal(h3Logs(h).at(-1).reasonCode, "RESULT_UNKNOWN");
  assert.equal(h.provider.calls.length, 1);
  assertH3OnlyJobLogs(h, before);
});

test("H3 D20 已授权且调用一次后崩溃：T3 缺失，过期扫描只转 awaiting_result", async (t) => {
  const h = await dispatchFixture(t);
  const worker = h.worker();
  const { entered, release } = h3GateProvider(h);
  const pending = worker.dispatch(h.jobId);
  await entered;
  assert.equal(h3JobRow(h).dispatchAuthorizedAt, NOW);
  h.setTime(NOW + 60_000);
  const scanned = await worker.scanExpired();
  assert.deepEqual(scanned, [{ jobId: h.jobId, state: "awaiting_result" }]);
  const baseline = structuredClone(h.store.data);
  release();
  await assert.rejects(pending, { code: "LEASE_FENCE_REJECTED" });
  assert.deepEqual(h.store.data, baseline, "晚到 T3 必须零写");
  assert.equal(h.provider.calls.length, 1);
  assert.equal(h3JobRow(h).result.reasonCode, "LEASE_EXPIRED_UNKNOWN");
});

test("H3 D21 Mock success：succeeded 但 grant pending 且 deviceEffective=false，A+J", async (t) => {
  const h = await dispatchFixture(t);
  const before = structuredClone(h.store.data);
  const transact = h.store.transactFaceDispatch.bind(h.store);
  let calls = 0;
  let afterT1;
  let afterT2;
  h.store.transactFaceDispatch = async (...args) => {
    const value = await transact(...args);
    if (++calls === 1) afterT1 = structuredClone(h.store.data);
    if (calls === 2) afterT2 = structuredClone(h.store.data);
    return value;
  };
  const job = await h.worker().dispatch(h.jobId);
  assert.equal(job.state, "succeeded");
  assert.deepEqual(job.result, {
    attempt: 1, outcome: "succeeded", errorKind: null, reasonCode: null, finishedAt: NOW,
  });
  // T1 = J；T2 = A（仅 job 授权时间与 revision）；T3 = J（结果与一条确定性日志）。
  assert.ok(afterT1 && afterT2);
  const t1Job = afterT1.device_operation_jobs.find((row) => row._id === h.jobId);
  const t2Job = afterT2.device_operation_jobs.find((row) => row._id === h.jobId);
  assert.deepEqual({ ...t1Job, dispatchAuthorizedAt: NOW, revision: 3, updatedAt: NOW }, t2Job);
  assert.deepEqual(afterT2.device_operation_logs, afterT1.device_operation_logs, "T2 不得追加日志");
  for (const [name, rows] of Object.entries(afterT1)) {
    if (name === "device_operation_jobs") continue;
    assert.deepEqual(afterT2[name], rows, `T2 只能写 job：${name}`);
  }
  assert.deepEqual(job.result.outcome, "succeeded");
  const grant = h.store.data.device_access_grants.find((row) => row._id === h.grantId);
  assert.equal(grant.state, "pending");
  assert.equal(projectAccess({ grant, jobs: [job], eligibility: { allowed: true } }).deviceEffective, false);
  assert.equal(h.store.data.device_operation_logs.filter((log) => log.state === "device_verified").length, 0);
  assert.equal(h.provider.calls.length, 1);
  assert.deepEqual(h3Logs(h).map((log) => log.state), ["queued", "sending", "succeeded"]);
  assertH3OnlyJobLogs(h, before);
});

test("H3 D22 Mock terminal_fail：terminal_failed，不排重试", async (t) => {
  const h = await dispatchFixture(t, "terminal_fail");
  const before = structuredClone(h.store.data);
  const job = await h.worker().dispatch(h.jobId);
  assert.equal(job.state, "terminal_failed");
  assert.equal(job.nextAttemptAt, null);
  assert.equal(job.result.errorKind, "TERMINAL");
  assert.equal(job.result.reasonCode, "DEVICE_REJECTED");
  assert.equal(h3Logs(h).at(-1).alertCode, null);
  assert.equal(h.provider.calls.length, 1);
  assertH3OnlyJobLogs(h, before);
});

test("H3 D23 Mock 契约返回 NOT_CONFIGURED：terminal_failed + CONFIGURATION_BLOCKED，A+J", async (t) => {
  const h = await dispatchFixture(t);
  const before = structuredClone(h.store.data);
  const enroll = h.provider.enrollFace.bind(h.provider);
  h.provider.enrollFace = async (...args) => {
    enroll(...args);
    const error = new Error("synthetic not configured");
    error.code = "NOT_CONFIGURED";
    throw error;
  };
  const job = await h.worker().dispatch(h.jobId);
  assert.equal(job.state, "terminal_failed");
  assert.equal(job.result.errorKind, "NOT_CONFIGURED");
  assert.equal(job.result.reasonCode, "NOT_CONFIGURED");
  assert.equal(h3Logs(h).at(-1).alertCode, "CONFIGURATION_BLOCKED");
  assert.equal(h.provider.calls.length, 1);
  assert.equal(job.nextAttemptAt, null);
  assertH3OnlyJobLogs(h, before);
});

test("H3 D24 领取后运行配置切为 live：terminal_failed/NOT_CONFIGURED，Provider 0，J", async (t) => {
  let runtime = { executionMode: "test", provider: null };
  const h = await dispatchFixture(t, "success", { runtimeConfig: () => runtime });
  runtime = { executionMode: "test", provider: h.provider };
  h3AfterT1(h, () => { runtime = { executionMode: "live", provider: h.provider }; });
  const job = await h.worker().dispatch(h.jobId);
  assert.equal(job.state, "terminal_failed");
  assert.equal(job.result.errorKind, "NOT_CONFIGURED");
  assert.equal(job.result.reasonCode, "NOT_CONFIGURED");
  assert.equal(h3Logs(h).at(-1).alertCode, "CONFIGURATION_BLOCKED");
  assert.equal(h.provider.calls.length, 0);
  assertH3OnlyJobLogs(h, h.h3Baseline);
});

test("H3 D25 T3 callback 重跑：只提交一条结果日志；重投零写", async (t) => {
  const h = await dispatchFixture(t);
  const transact = h.store.transactFaceDispatch.bind(h.store);
  let plans = 0;
  h.store.transactFaceDispatch = (refs, build) => transact(refs, (state, now) => {
    plans += 1;
    const first = build(structuredClone(state), now);
    plans += 1;
    const second = build(state, now);
    assert.deepEqual(first, second);
    return second;
  });
  const job = await h.worker().dispatch(h.jobId);
  assert.equal(job.state, "succeeded");
  assert.equal(plans, 6);
  assert.deepEqual(h3Logs(h).map((log) => log.state), ["queued", "sending", "succeeded"]);
  const before = structuredClone(h.store.data);
  await assert.rejects(h.worker().dispatch(h.jobId), { code: "INVALID_JOB" });
  assert.deepEqual(h.store.data, before);
});

test("H3 D26 相同 createGrant 请求重放：原 grantId/jobId，无 snapshot 副本/核心写", async (t) => {
  const h = await setup(t, {
    syntheticDispatch: true, validUntil: NOW + 900_000, qualificationEnd: NOW + 900_001,
  });
  const key = "idem-h3-d26-replay-0001";
  const first = await h.service.createGrant(h.input(), { idempotencyKey: key });
  const snapshots = h.store.data.face_dispatch_snapshots.slice();
  assert.equal(snapshots.length, 1);
  const before = structuredClone(h.store.data);
  const second = await h.service.createGrant(h.input(), { idempotencyKey: key });
  assert.deepEqual(second, first);
  assert.deepEqual(h.store.data.face_dispatch_snapshots, snapshots);
  for (const name of CORE) {
    assert.deepEqual(h.store.data[name], before[name], `${name} 不得因重放变化`);
  }
  assert.equal(h.store.data.admin_audit.length, before.admin_audit.length + 1);
  assert.equal(h.providerCalls.enroll, 0);
});

// T1 后外部写导致的逐类资格/授权状态变化。基线 = 注入后完整快照。
async function h3PreSendMutation(t, options, mutate, code) {
  const h = await dispatchFixture(t, "success", options);
  h3AfterT1(h, mutate);
  await h.worker().dispatch(h.jobId);
  return h3ExpectTerminal(h, code);
}

function h3AddBlacklistDeny(h, id = "entry-h3-deny") {
  h.store.data.blacklist_entries ||= [];
  h.store.data.blacklist_entries.push({ _id: id, ...entryRecord(id).data });
  const headId = blacklistDecisionHeadId(ORG, OCCUPANCY, "occupancy.activate");
  h.store.data.blacklist_decisions ||= [];
  const index = h.store.data.blacklist_decisions.findIndex((row) => row._id === headId);
  const data = {
    orgId: ORG, occupancyId: OCCUPANCY, restriction: "occupancy.activate",
    entryIds: [id], entryRevisions: [1], decision: "deny",
    latestDecisionId: "decision-h3-deny", expiresAt: null, recordType: "current", revision: 1,
  };
  if (index < 0) h.store.data.blacklist_decisions.push({ _id: headId, ...data });
  else Object.assign(h.store.data.blacklist_decisions[index], data);
}

test("H3 D28 T1 后人员归档：terminal_failed/INVALID_STATE，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "persons", PERSON, { status: "archived" }), "INVALID_STATE");
});

test("H3 D29 T1 后固定实名申请撤销（另有 approved）：IDENTITY_NOT_APPROVED，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => {
    patchRecord(h, "identity_applications", IDENTITY, { state: "revoked" });
    h.store.data.identity_applications.push({
      _id: "id-c4-other", orgId: ORG, personId: PERSON, state: "approved",
      identityDigest: "digest-other", keyVersion: 1, revision: 1,
    });
  }, "IDENTITY_NOT_APPROVED");
});

test("H3 D30 T1 后入住关系 revision 变化：REVISION_CONFLICT，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "occupancies", OCCUPANCY, { revision: 2 }),
    "REVISION_CONFLICT");
});

test("H3 D31 T1 后周期 epoch 变化：REVISION_CONFLICT，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "occupancy_cycles", CYCLE, { epoch: 2 }),
    "REVISION_CONFLICT");
});

test("H3 D32 T1 后目录 revision 变化：REVISION_CONFLICT，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "property_catalog", FLOOR, { revision: 2 }),
    "REVISION_CONFLICT");
});

test("H3 D33 T1 后真名单明确 deny：BLACKLIST_DENIED，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => h3AddBlacklistDeny(h), "BLACKLIST_DENIED");
});

test("H3 D34 T1 后文件 revision 变化：FILE_BINDING_CHANGED，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "file_assets", FILE, { revision: 2 }),
    "FILE_BINDING_CHANGED");
});

test("H3 D35 T1 后设备绑定变化：DEVICE_CLAIM_INVALID，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "access_devices", DEVICE, { claimId: "claim-other" }),
    "DEVICE_CLAIM_INVALID");
});

test("H3 D36 T1 后 owner claim 释放：DEVICE_CLAIM_INVALID，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => {
    const claim = h.store.data.device_claims.find((row) => row._id === CLAIM);
    delete claim.boundDeviceId;
    delete claim.activatedAt;
    delete claim.activatedByAuditId;
    Object.assign(claim, {
      state: "released", releasedAt: 2, releasedByAuditId: "audit-h3-d36", releaseReason: "retired",
    });
  }, "DEVICE_CLAIM_INVALID");
});

test("H3 D37 T1 后 grant slot activeClaimId 变化：GRANT_SLOT_CONFLICT，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "grant_slot_claims",
    grantSlotKey({ orgId: ORG, personId: PERSON, deviceId: DEVICE, cycleId: CYCLE }),
    { activeClaimId: "grant-other" }), "GRANT_SLOT_CONFLICT");
});

test("H3 D38 T1 后 grant revoked：GRANT_INACTIVE，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "device_access_grants", h.grantId, { state: "revoked" }),
    "GRANT_INACTIVE");
});

test("H3 D39 T1 后 grant 有效期终点到达：GRANT_INACTIVE，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "device_access_grants", h.grantId, { validUntil: NOW }),
    "GRANT_INACTIVE");
});

test("H3 D40 T1 后 grant suspended：GRANT_INACTIVE，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "device_access_grants", h.grantId, { state: "suspended" }),
    "GRANT_INACTIVE");
});

test("H3 D47 T1 后撤销发起成员 device.access.manage：FORBIDDEN，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "org_memberships", MEMBERSHIP, {
    permissions: ["device.face.submit"],
  }), "FORBIDDEN");
});

test("H3 D48 T1 后 lifecycle guard 从缺席变为存在：REVISION_CONFLICT，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => {
    h.store.data.lifecycle_guards ||= [];
    h.store.data.lifecycle_guards.push({
      _id: guardId(ORG), orgId: ORG, epoch: 1, revision: 1, createdAt: NOW,
    });
  }, "REVISION_CONFLICT");
});

test("H3 D49 T1 后 member 对应主租房间 slot 解绑：SPONSOR_INACTIVE，J", async (t) => {
  await h3PreSendMutation(t, { role: "member" }, (h) => patchRecord(h, "room_primary_slots",
    primarySlotId(ORG, ROOM), { currentOccupancyId: "occ-other" }), "SPONSOR_INACTIVE");
});

test("H3 D56 T1 后 K1 版本与设备不一致：DEVICE_DIGEST_CONFIG_CHANGED，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "access_devices", DEVICE, { keyVersion: 2 }),
    "DEVICE_DIGEST_CONFIG_CHANGED");
});

test("H3 D60 T1 后房间归档：ROOM_ARCHIVED，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "rooms", ROOM, { status: "archived" }), "ROOM_ARCHIVED");
});

test("H3 D43 600s 退避边界：到期前人工与自动均拒，到期后并发仅一方排队", async (t) => {
  const h = await dispatchFixture(t, "pre_send_fail");
  const worker = h.worker();
  let now = NOW;
  let third;
  for (const [index, delay] of [30_000, 120_000, 600_000].entries()) {
    third = await worker.dispatch(h.jobId);
    assert.equal(third.state, "retryable_failed");
    assert.equal(third.nextAttemptAt, now + delay);
    if (index < 2) {
      now += delay;
      h.setTime(now);
      assert.equal((await worker.requeue(h.jobId, third.revision)).state, "queued");
    }
  }
  assert.equal(third.attempts, 3);
  assert.equal(third.nextAttemptAt, NOW + 750_000);
  patchRecord(h, "org_memberships", MEMBERSHIP, {
    permissions: ["device.access.manage", "device.operation.retry"],
  });
  const actor = { membershipId: MEMBERSHIP, actorId: MEMBERSHIP };
  h.setTime(third.nextAttemptAt - 1);
  const beforeBoundary = structuredClone(h.store.data);
  await assert.rejects(worker.requeue(h.jobId, third.revision), { code: "RETRY_NOT_DUE" });
  await assert.rejects(worker.requeue(h.jobId, third.revision, actor), { code: "RETRY_NOT_DUE" });
  assert.deepEqual(h.store.data, beforeBoundary, "未到期的人工/自动重排必须零写");
  h.setTime(third.nextAttemptAt);
  const outcomes = await Promise.allSettled([
    worker.requeue(h.jobId, third.revision), worker.requeue(h.jobId, third.revision, actor),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1,
    "人工与自动必须争用同一 CAS");
  assert.equal(h.provider.calls.length, 3);
  const queued = h.store.data.device_operation_jobs.find((row) => row._id === h.jobId);
  assert.equal(queued.state, "queued");
  const exhausted = await worker.dispatch(h.jobId);
  assert.equal(exhausted.state, "terminal_failed");
  assert.equal(exhausted.attempts, 4);
  assert.equal(exhausted.result.reasonCode, "RETRY_EXHAUSTED");
  assert.equal(h.store.data.device_operation_logs.at(-1).alertCode, "RETRY_EXHAUSTED");
  assert.equal(h.provider.calls.length, 4);
  const terminal = structuredClone(h.store.data);
  await assert.rejects(worker.requeue(h.jobId, exhausted.revision, actor), { code: "INVALID_JOB" });
  assert.deepEqual(h.store.data, terminal, "RETRY_EXHAUSTED 后人工重试必须零写");
});

test("H3 D45 源记录/返回对象注入敏感字段：Provider 入参、结果、日志、快照均不泄露", async (t) => {
  const MARKER = "synthetic-sensitive-marker-8f2c";
  const h = await dispatchFixture(t, "success", {
    prepare: async (harness) => {
      patchRecord(harness, "face_credentials", CREDENTIAL, {
        objectKey: `private/${MARKER}`, checksum: MARKER, identityDigest: MARKER,
        rawResponse: { secret: MARKER },
      });
      patchRecord(harness, "persons", PERSON, { identityDigest: MARKER, privateNote: MARKER });
      patchRecord(harness, "file_assets", FILE, { objectKey: `private/${MARKER}`, checksum: MARKER });
      patchRecord(harness, "occupancies", OCCUPANCY, { privateNote: MARKER });
    },
  });
  const captured = [];
  const enroll = h.provider.enrollFace.bind(h.provider);
  h.provider.enrollFace = async (input, context) => {
    captured.push({ input, context: { ...context, permissions: [...context.permissions] } });
    const result = await enroll(input, context);
    return { ...result, rawResponse: { secret: MARKER }, checksum: MARKER, stack: MARKER };
  };
  const job = await h.worker().dispatch(h.jobId);
  assert.equal(job.state, "succeeded");
  assert.equal(captured.length, 1);
  assert.deepEqual(Object.keys(captured[0].input).sort(),
    ["deviceId", "grantId", "personId", "sourceFileId", "validFrom", "validUntil"]);
  assert.deepEqual(Object.keys(captured[0].context).sort(),
    ["actorId", "actorType", "executionMode", "idempotencyKey", "orgId", "permissions"]);
  assert.deepEqual(captured[0].context.permissions, ["device.access.manage"]);
  const snapshot = h.store.data.face_dispatch_snapshots[0];
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "_id", "claimId", "createdAt", "creatorActorId", "cycleId", "domainHeadId", "domainVersionId",
    "fileId", "identityApplicationId", "jobId", "membershipId", "occupancyId", "orgId", "personId",
    "restriction", "schemaVersion", "slotId", "versions",
  ]);
  for (const item of snapshot.versions) {
    assert.deepEqual(Object.keys(item).sort(),
      ["collection", "epoch", "id", "keyVersion", "present", "revision"]);
  }
  const serialized = JSON.stringify([
    snapshot, job, h3Logs(h), job.result,
  ]);
  assert.ok(!serialized.includes(MARKER), "敏感标记不得进入快照/job/结果/日志");
  for (const field of ["objectKey", "checksum", "rawResponse", "stack", "identityDigest", "privateNote"]) {
    assert.ok(!serialized.includes(`"${field}"`), field);
  }
  assert.ok(!serialized.includes("idem-c4-"), "原始用户幂等键不得持久化");
  assert.ok(!/private\/[^\s"]+\.jpg/.test(serialized), "私密文件位置不得进入派发记录");
});

test("H3 D51 有效期内结果先提交：过期扫描比较失败零写，T3 继续 succeeded", async (t) => {
  const h = await dispatchFixture(t);
  const worker = h.worker();
  const { entered, release } = h3GateProvider(h);
  const pending = worker.dispatch(h.jobId);
  await entered;
  h.setTime(NOW + 59_999);
  const beforeScan = structuredClone(h.store.data);
  await assert.rejects(worker.expire(h.jobId), { code: "LEASE_FENCE_REJECTED" });
  assert.deepEqual(h.store.data, beforeScan, "有效期内扫描必须零写");
  release();
  const job = await pending;
  assert.equal(job.state, "succeeded");
  assert.equal(h.provider.calls.length, 1);
  assert.deepEqual(h3Logs(h).map((log) => log.state), ["queued", "sending", "succeeded"]);
});

test("H3 D52 目标日志 ID 已存在：事务回滚，原日志内容保留", async (t) => {
  const sending = await dispatchFixture(t);
  const conflictId = deterministicLogId(sending.jobId, "sending", 2);
  sending.store.data.device_operation_logs.push({
    _id: conflictId, orgId: ORG, jobId: sending.jobId, action: "enroll",
    fromState: "queued", state: "sending", actorType: "system", actorId: "external",
    at: NOW, revision: 2, attempt: 1, leaseGeneration: 1,
    evidenceScope: "simulated", errorKind: null, reasonCode: null, alertCode: "ORIGINAL",
  });
  const beforeSending = structuredClone(sending.store.data);
  await assert.rejects(sending.worker().dispatch(sending.jobId), { code: "CONFLICT", status: 409 });
  assert.deepEqual(sending.store.data, beforeSending, "领取日志冲突必须整事务回滚");
  const kept = sending.store.data.device_operation_logs.find((log) => log._id === conflictId);
  assert.equal(kept.alertCode, "ORIGINAL");
  assert.equal(sending.store.data.device_operation_jobs.find((row) => row._id === sending.jobId).state, "queued");
  assert.equal(sending.provider.calls.length, 0);

  const result = await dispatchFixture(t);
  const resultLogId = deterministicLogId(result.jobId, "succeeded", 4);
  result.store.data.device_operation_logs.push({
    _id: resultLogId, orgId: ORG, jobId: result.jobId, action: "enroll",
    fromState: "sending", state: "succeeded", actorType: "system", actorId: "external",
    at: NOW, revision: 4, attempt: 1, leaseGeneration: 1,
    evidenceScope: "simulated", errorKind: null, reasonCode: null, alertCode: "ORIGINAL",
  });
  const beforeResult = structuredClone(result.store.data);
  await assert.rejects(result.worker().dispatch(result.jobId), { code: "CONFLICT", status: 409 });
  const job = result.store.data.device_operation_jobs.find((row) => row._id === result.jobId);
  assert.equal(job.state, "sending", "T3 冲突不得提交 job 写");
  assert.equal(job.dispatchAuthorizedAt, NOW);
  assert.equal(result.store.data.device_operation_logs.find((log) => log._id === resultLogId).alertCode, "ORIGINAL");
  assert.deepEqual(result.store.data.admin_audit, beforeResult.admin_audit);
  assert.equal(result.provider.calls.length, 1);
});

test("H3 D57 异常形状/超时统一 UNKNOWN_RESULT；晚到回调零写", async (t) => {
  const weird = await dispatchFixture(t);
  const enroll = weird.provider.enrollFace.bind(weird.provider);
  weird.provider.enrollFace = async (input, context) => {
    const result = await enroll(input, context);
    return { ...result, jobId: 42, rawResponse: { secret: "marker" } };
  };
  const unknown = await weird.worker().dispatch(weird.jobId);
  assert.equal(unknown.state, "awaiting_result");
  assert.equal(unknown.result.errorKind, "UNKNOWN_RESULT");
  assert.equal(weird.provider.calls.length, 1);
  const before = structuredClone(weird.store.data);
  await assert.rejects(weird.worker().dispatch(weird.jobId), { code: "INVALID_JOB" });
  assert.deepEqual(weird.store.data, before);

  const timeout = await dispatchFixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let markEntered;
  const entered = new Promise((resolve) => { markEntered = resolve; });
  const hang = timeout.provider.enrollFace.bind(timeout.provider);
  timeout.provider.enrollFace = async (input, context) => {
    await hang(input, context);
    markEntered();
    return new Promise(() => {});
  };
  const pending = timeout.worker().dispatch(timeout.jobId);
  await entered;
  t.mock.timers.tick(10_000);
  const timedOut = await pending;
  assert.equal(timedOut.state, "awaiting_result");
  assert.equal(timedOut.result.reasonCode, "RESULT_UNKNOWN");
  assert.equal(timeout.provider.calls.length, 1);
  assert.deepEqual(h3Logs(timeout).map((log) => log.state), ["queued", "sending", "awaiting_result"]);
});

test("H3 D59 同 operation key 并发创建：结果一致且仅一条 snapshot，H", async (t) => {
  const h = await setup(t, {
    syntheticDispatch: true, validUntil: NOW + 900_000, qualificationEnd: NOW + 900_001,
  });
  const key = "idem-h3-d59-concurrent-01";
  const counts = Object.fromEntries(Object.entries(h.store.data).map(([name, rows]) => [name, rows.length]));
  const results = await Promise.all([
    h.service.createGrant(h.input(), { idempotencyKey: key }),
    h.service.createGrant(h.input(), { idempotencyKey: key }),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(h.store.data.face_dispatch_snapshots.length, (counts.face_dispatch_snapshots ?? 0) + 1);
  for (const name of CORE) {
    assert.equal(h.store.data[name].length, (counts[name] ?? 0) + 1, `${name} 只能创建一条`);
  }
  assert.equal(h.providerCalls.enroll, 0);
});

test("H3 D62 T2 时剩余窗口不足：terminal_failed/PRE_SEND_WINDOW_CLOSED，Provider 0，J", async (t) => {
  const h = await dispatchFixture(t);
  h3AfterT1(h, (harness) => harness.setTime(NOW + 55_000));
  await h.worker().dispatch(h.jobId);
  const job = h3ExpectTerminal(h, "PRE_SEND_WINDOW_CLOSED");
  assert.equal(job.result.alertCode, undefined);
});

test("H3 D65 T2 已确认但保守剩余不足：不调用 Mock，terminal_failed/PRE_SEND_WINDOW_CLOSED", async (t) => {
  const h = await dispatchFixture(t);
  const before = structuredClone(h.store.data);
  const transact = h.store.transactFaceDispatch.bind(h.store);
  let calls = 0;
  h.store.transactFaceDispatch = async (...args) => {
    const value = await transact(...args);
    if (++calls === 2) h.setTime(NOW + 55_000);
    return value;
  };
  const job = await h.worker().dispatch(h.jobId);
  assert.equal(job.state, "terminal_failed");
  assert.equal(job.result.errorKind, "PRE_SEND_BLOCKED");
  assert.equal(job.result.reasonCode, "PRE_SEND_WINDOW_CLOSED");
  assert.equal(job.leaseOwner, null);
  assert.equal(job.leaseExpiresAt, null);
  assert.equal(job.dispatchAuthorizedAt, null);
  assert.equal(job.nextAttemptAt, null);
  assert.equal(job.leaseGeneration, 1);
  assert.equal(h.provider.calls.length, 0);
  assert.deepEqual(h3Logs(h).map((log) => log.state), ["queued", "sending", "terminal_failed"]);
  assertH3OnlyJobLogs(h, before);
});

test("H3 D27 同一 dispatcher 并发两次 dispatch：至多一次领取与一次 Mock 调用", async (t) => {
  const h = await dispatchFixture(t);
  const worker = h.worker();
  const outcomes = await Promise.allSettled([worker.dispatch(h.jobId), worker.dispatch(h.jobId)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.equal(rejected.reason.code, "INVALID_JOB");
  assert.equal(h.provider.calls.length, 1);
  assert.deepEqual(h3Logs(h).map((log) => log.state), ["queued", "sending", "succeeded"]);
  assert.equal(h3JobRow(h).state, "succeeded");
});

test("H3 D50/D52 快照不可覆盖、重放内容级一致、内容篡改失败关闭", async (t) => {
  const h = await dispatchFixture(t);
  const snapshot = h.store.data.face_dispatch_snapshots[0];
  const before = structuredClone(h.store.data);
  await assert.rejects(
    () => h.store.transact([ref("face_dispatch_snapshots", snapshot._id)], () => [{
      collection: "face_dispatch_snapshots", id: snapshot._id,
      data: { ...snapshot, personId: "person-tampered" },
    }], audit),
    (error) => error.status === 409,
  );
  await assert.rejects(
    () => h.store.change("face_dispatch_snapshots", snapshot._id, () => ({ personId: "person-tampered" }), audit),
    (error) => error.status === 409,
  );
  assert.deepEqual(h.store.data, before, "快照覆盖必须被拒绝且零写");

  const personVersion = h.store.data.face_dispatch_snapshots[0].versions
    .find((item) => item.collection === "persons" && item.id === PERSON);
  personVersion.revision = 999;
  const tampered = structuredClone(h.store.data);
  const job = await h.worker().dispatch(h.jobId);
  assert.equal(job.state, "terminal_failed");
  assert.equal(job.result.reasonCode, "REVISION_CONFLICT");
  assert.equal(h.provider.calls.length, 0);
  assertH3OnlyJobLogs(h, tampered);
});

test("H3 D66 适配器能力不足：dispatcher 拒绝启用，零写", async (t) => {
  const h = await dispatchFixture(t);
  const before = structuredClone(h.store.data);
  const provider = new MockFaceAccessProvider();
  const fake = { transactFaceDispatch() {}, faceDispatchTime() { return NOW; } };
  assert.throws(() => new MockFaceDispatcher({
    store: fake, orgId: ORG, files: h.files, blacklist: h.blacklist, provider,
  }), (error) => error.code === "ADAPTER_UNAVAILABLE");
  const noClock = Object.create(h.store);
  noClock.faceDispatchTime = undefined;
  assert.throws(() => new MockFaceDispatcher({
    store: noClock, orgId: ORG, files: h.files, blacklist: h.blacklist, provider,
  }), (error) => error.code === "ADAPTER_UNAVAILABLE");
  assert.deepEqual(h.store.data, before, "启用探针不得产生任何写");
  assert.equal(provider.calls.length, 0);
});

test("H3 D44 attempts=4 明确 pre-send RETRYABLE：RETRY_EXHAUSTED，之后重试零写", async (t) => {
  const h = await dispatchFixture(t, "pre_send_fail");
  const worker = h.worker();
  let now = NOW;
  for (const delay of [30_000, 120_000, 600_000]) {
    const failed = await worker.dispatch(h.jobId);
    assert.equal(failed.state, "retryable_failed");
    now += delay;
    h.setTime(now);
    assert.equal((await worker.requeue(h.jobId, failed.revision)).state, "queued");
  }
  const exhausted = await worker.dispatch(h.jobId);
  assert.equal(exhausted.state, "terminal_failed");
  assert.equal(exhausted.attempts, 4);
  assert.equal(exhausted.result.errorKind, "RETRYABLE");
  assert.equal(exhausted.result.reasonCode, "RETRY_EXHAUSTED");
  assert.equal(h3Logs(h).at(-1).alertCode, "RETRY_EXHAUSTED");
  assert.equal(h.provider.calls.length, 4);
  const before = structuredClone(h.store.data);
  await assert.rejects(worker.requeue(h.jobId, exhausted.revision), { code: "INVALID_JOB" });
  assert.deepEqual(h.store.data, before, "RETRY_EXHAUSTED 后重试必须零写");
  assert.equal(h.provider.calls.length, 4);
});

test("H3 D63 fence 拒绝与空写集都不产生 admin_audit 副作用", async (t) => {
  const empty = await dispatchFixture(t);
  const before = structuredClone(empty.store.data);
  const returned = await empty.store.transactFaceDispatch(
    [ref("device_operation_jobs", empty.jobId)], () => [],
  );
  assert.equal(returned, undefined);
  assert.deepEqual(empty.store.data, before, "空写集派发事务不得追加 audit 或任何记录");

  const fence = await h3FenceCase(t, (h) => patchRecord(h, "device_operation_jobs", h.jobId, {
    leaseOwner: "other-owner",
  }));
  assert.deepEqual(fence.store.data.admin_audit, fence.h3Baseline.admin_audit);
});

test("H3 补充 Q03 credential 状态/revision 变化：CREDENTIAL_CHANGED，J", async (t) => {
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "face_credentials", CREDENTIAL, {
    revision: 3,
  }), "CREDENTIAL_CHANGED");
  await h3PreSendMutation(t, {}, (h) => patchRecord(h, "face_credentials", CREDENTIAL, {
    reviewState: "revoked",
  }), "CREDENTIAL_CHANGED");
});

test("H3 补充 T2 已确认后派发时钟不可用：失败关闭，Provider 0，零 audit", async (t) => {
  const h = await dispatchFixture(t);
  const beforeAudit = structuredClone(h.store.data.admin_audit);
  const transact = h.store.transactFaceDispatch.bind(h.store);
  let calls = 0;
  h.store.transactFaceDispatch = async (...args) => {
    const value = await transact(...args);
    if (++calls === 2) h.setTime(1.5);
    return value;
  };
  await assert.rejects(
    h.worker().dispatch(h.jobId),
    (error) => error.status === 503 && error.code === null,
  );
  const job = h3JobRow(h);
  assert.equal(job.state, "sending");
  assert.equal(job.revision, 3);
  assert.equal(job.dispatchAuthorizedAt, NOW);
  assert.deepEqual(h3Logs(h).map((log) => log.state), ["queued", "sending"]);
  assert.equal(h.provider.calls.length, 0);
  assert.deepEqual(h.store.data.admin_audit, beforeAudit);
});
