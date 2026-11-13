import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { LocalStore, CloudStore } from "../lib/store.mjs";
import { FileService } from "../lib/files.mjs";
import { BlacklistService, blacklistDecisionHeadId } from "../lib/blacklist.mjs";
import { FaceCredentialService } from "../lib/face-service/service.mjs";
import { H3MockDispatcher } from "../lib/face-service/h3b.mjs";
import { MockFaceAccessProvider } from "../lib/face-service/mock-provider.mjs";
import { claimDispatchJob } from "../lib/face-service/h3a.mjs";
import { projectAccess } from "../lib/face-service/state.mjs";
import { occupancyClaimId, primarySlotId } from "../lib/face-service/eligibility.mjs";
import { eligibilityGuardId } from "../lib/claims.mjs";
import {
  applyOperationKeyDomain,
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
        startsAt: QUAL_START, endsAt: QUAL_END, sponsorOccupancyId: sponsorId,
        revision: 1, ...(options.occupancy || {}),
      },
    },
    {
      collection: "occupancy_cycles", id: cycleId,
      data: {
        orgId: ORG, roomId, state: "active",
        primaryOccupancyId: member ? OCC_PRIMARY : occupancyId,
        startsAt: QUAL_START, endsAt: QUAL_END, endedAt: null, epoch: 1, revision: 1,
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
        state: options.primaryState ?? "active", startsAt: QUAL_START, endsAt: QUAL_END,
        sponsorOccupancyId: null, revision: 1,
      },
    });
  }
  if (sponsor === "other") {
    writes.push({
      collection: "occupancies", id: OCC_SPONSOR,
      data: {
        orgId: ORG, personId: "person-c4-sponsor", roomId, cycleId, role: "member",
        state: "active", startsAt: QUAL_START, endsAt: QUAL_END,
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
  const store = await new LocalStore(dir).init();
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
    files, blacklist, provider, now: () => NOW,
    syntheticDispatch: options.syntheticDispatch === true,
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
  const h = await setup(t, { syntheticDispatch: true });
  const first = await expectSuccess(h);
  resetCounts(h);
  const before = await snapshot(h.store);
  const replay = await h.service.createGrant(h.input(), { idempotencyKey: first.key });
  const after = await snapshot(h.store);
  assert.deepEqual(replay, first.result);
  for (const name of CORE) assert.deepEqual(after[name], before[name], `${name} 重放不变`);
  assert.deepEqual(after.device_operation_jobs[0].dispatchSnapshot,
    before.device_operation_jobs[0].dispatchSnapshot, "内嵌快照逐字节不变");
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
  const base = { role: "member", userId: USER1, sponsor: "primary", syntheticDispatch: true };
  const at57 = await setup(t, { ...base, candidates: 57 });
  await expectSuccess(at57, at57.input(), { guardDelta: 3 });
  assert.equal(at57.lastRefs, 89, "57 candidates 实际 89 refs（设计写 90）");

  const at58 = await setup(t, { ...base, candidates: 58 });
  await expectSuccess(at58, at58.input(), { guardDelta: 3 });
  assert.equal(at58.lastRefs, 90, "58 candidates 实际 90 refs");
  const [job] = await at58.store.list("device_operation_jobs", ORG);
  assert.equal(job.dispatchSnapshot.schemaVersion, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(job.dispatchSnapshot)) <= 16 * 1024);
  const witnesses = job.dispatchSnapshot.versions.map(({ collection, id }) => `${collection}/${id}`);
  assert.equal(new Set(witnesses).size, witnesses.length, "planned refs 必须去重");
  for (const prefix of [
    "property_catalog/", "room_primary_slots/", "lifecycle_guards/",
  ]) assert.ok(witnesses.some((key) => key.startsWith(prefix)), `保留 ${prefix} planned ref`);
});

// D74
test("C4 D74 最大布局容量：去重后 59 candidates/91 refs -> 400，58/90 可进入", async (t) => {
  const base = { role: "member", userId: USER1, sponsor: "primary", syntheticDispatch: true };
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
  const h = await setup(t, { syntheticDispatch: true });
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
  assert.equal(after.device_operation_jobs.length, 1);
  assert.equal(after.device_operation_jobs[0].dispatchSnapshot.schemaVersion, 1);
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

async function setupH3(t, scenario = "success") {
  const h = await setup(t, { syntheticDispatch: true });
  const created = await expectSuccess(h);
  resetCounts(h);
  let clock = NOW;
  const provider = new MockFaceAccessProvider({ scenario });
  const dispatcher = new H3MockDispatcher({
    store: h.store, orgId: ORG, files: h.files, blacklist: h.blacklist, provider,
    now: () => clock, owner: "worker-h3b-test",
  });
  return { h, created, provider, dispatcher, setClock: (value) => { clock = value; } };
}

async function businessRows(h, created) {
  const grant = await h.store.get("device_access_grants", created.result.grantId, ORG);
  const jobs = await h.store.list("device_operation_jobs", ORG);
  return { grant, jobs };
}

test("H3-b D01/D21a：T2 后事务外 Mock 至多一次，T3 原子 succeeded/effective", async (t) => {
  const x = await setupH3(t);
  const original = x.provider.enrollFace.bind(x.provider);
  let input;
  let context;
  x.provider.enrollFace = async (nextInput, nextContext) => {
    input = structuredClone(nextInput);
    context = { ...nextContext, permissions: [...nextContext.permissions] };
    return original(nextInput, nextContext);
  };
  const beforeAudit = (await x.h.store.list("admin_audit")).length;
  const result = await x.dispatcher.dispatch(x.created.result.jobId);
  const { grant, jobs } = await businessRows(x.h, x.created);
  assert.equal(result.state, "succeeded");
  assert.equal(grant.state, "effective");
  assert.equal(x.provider.calls.length, 1);
  assert.deepEqual(Object.keys(input).sort(),
    ["deviceId", "grantId", "personId", "sourceFileId", "validFrom", "validUntil"].sort());
  assert.deepEqual(Object.keys(context).sort(),
    ["actorId", "actorType", "executionMode", "idempotencyKey", "orgId", "permissions"].sort());
  assert.deepEqual(context.permissions, ["device.access.manage"]);
  assert.equal(context.executionMode, "test");
  const projection = projectAccess({ grant, eligibility: { allowed: true }, jobs });
  assert.equal(projection.businessAllowed, true);
  assert.equal(projection.deviceEffective, false);
  assert.equal((await x.h.store.list("admin_audit")).length, beforeAudit + 3);
});

test("H3-b D21b：调用期间资格失效仍 succeeded/effective，实时投影关闭", async (t) => {
  const x = await setupH3(t);
  const original = x.provider.enrollFace.bind(x.provider);
  x.provider.enrollFace = async (...args) => {
    patchRecord(x.h, "occupancies", OCCUPANCY, { state: "ended" });
    return original(...args);
  };
  const result = await x.dispatcher.dispatch(x.created.result.jobId);
  const { grant, jobs } = await businessRows(x.h, x.created);
  assert.equal(result.state, "succeeded");
  assert.equal(grant.state, "effective");
  assert.equal(x.provider.calls.length, 1);
  const projection = projectAccess({ grant, eligibility: { allowed: false }, jobs });
  assert.equal(projection.businessAllowed, false);
  assert.equal(projection.deviceEffective, false);
});

test("H3-b D21c：调用期间 grant revoked/expired/suspended/改绑均不复活", async (t) => {
  for (const mutation of [
    { state: "revoked" }, { state: "expired" }, { state: "suspended" }, { claimId: "claim-rebound" },
  ]) {
    const x = await setupH3(t);
    const original = x.provider.enrollFace.bind(x.provider);
    x.provider.enrollFace = async (...args) => {
      patchRecord(x.h, "device_access_grants", x.created.result.grantId, mutation);
      return original(...args);
    };
    const result = await x.dispatcher.dispatch(x.created.result.jobId);
    const grant = await x.h.store.get("device_access_grants", x.created.result.grantId, ORG);
    assert.equal(result.state, "terminal_failed");
    assert.equal(result.result.reasonCode, "GRANT_INACTIVE_AFTER_SEND");
    assert.notEqual(grant.state, "effective");
    assert.equal(x.provider.calls.length, 1);
  }
});

test("H3-b D44/D45：pre_send 瞬态统一预算、退避到期 CAS 重排后再发", async (t) => {
  const x = await setupH3(t, "pre_send_fail");
  const first = await x.dispatcher.dispatch(x.created.result.jobId);
  assert.equal(first.state, "retryable_failed");
  assert.equal(first.nextAttemptAt, NOW + 30_000);
  assert.equal(x.provider.calls.length, 1);
  x.setClock(NOW + 29_999);
  await assert.rejects(() => x.dispatcher.requeue(first._id, first.revision),
    (error) => error.code === "RETRY_NOT_DUE");
  x.setClock(NOW + 30_000);
  const queued = await x.dispatcher.requeue(first._id, first.revision);
  assert.equal(queued.state, "queued");
  x.provider.scenario = "success";
  patchRecord(x.h, "occupancies", OCCUPANCY, { endsAt: NOW + 100_000 });
  patchRecord(x.h, "occupancy_cycles", CYCLE, { endsAt: NOW + 100_000 });
  patchRecord(x.h, "device_access_grants", x.created.result.grantId, { validUntil: NOW + 90_000 });
  const second = await x.dispatcher.dispatch(first._id);
  assert.equal(second.state, "succeeded");
  assert.equal(second.attempts, 2);
  assert.equal(x.provider.calls.length, 2);
});

test("H3-b D32/D40：post_send unknown 与异常结果进入 awaiting_result，禁止重排", async (t) => {
  for (const mode of ["post_send_unknown", "malformed"]) {
    const x = await setupH3(t, mode === "malformed" ? "success" : mode);
    if (mode === "malformed") x.provider.enrollFace = async () => ({ status: "succeeded" });
    const result = await x.dispatcher.dispatch(x.created.result.jobId);
    assert.equal(result.state, "awaiting_result");
    await assert.rejects(() => x.dispatcher.requeue(result._id, result.revision),
      (error) => error.code === "INVALID_JOB");
  }
});

test("H3-b D22/D23：明确终态与 Provider NOT_CONFIGURED 均终止且不重发", async (t) => {
  for (const mode of ["terminal_fail", "not-configured"]) {
    const x = await setupH3(t, mode === "not-configured" ? "success" : mode);
    if (mode === "not-configured") x.provider.enrollFace = async () => {
      const error = new Error("未配置"); error.code = "NOT_CONFIGURED"; throw error;
    };
    const result = await x.dispatcher.dispatch(x.created.result.jobId);
    assert.equal(result.state, "terminal_failed");
    assert.equal(result.result.reasonCode, mode === "not-configured" ? "NOT_CONFIGURED" : "DEVICE_REJECTED");
    await assert.rejects(() => x.dispatcher.dispatch(result._id), (error) => error.code === "INVALID_JOB");
  }
});

test("H3-b D38/D50：过期租约保守 awaiting_result；扫描排除旧 job", async (t) => {
  const x = await setupH3(t);
  const claimed = await claimDispatchJob({
    store: x.h.store, orgId: ORG, jobId: x.created.result.jobId,
    owner: "worker-expire", now: () => NOW,
  });
  x.setClock(claimed.fence.expiresAt);
  const results = await x.dispatcher.scanExpired();
  assert.equal(results.length, 1);
  assert.equal(results[0].state, "awaiting_result");
  const legacy = { ...(await x.h.store.get("device_operation_jobs", x.created.result.jobId, ORG)) };
  delete legacy.dispatchSnapshot;
  legacy._id = "job-legacy-h2";
  legacy.state = "sending";
  legacy.leaseOwner = "old";
  legacy.leaseExpiresAt = NOW;
  x.h.store.data.device_operation_jobs.push(legacy);
  assert.deepEqual(await x.dispatcher.scanExpired(), []);
  await assert.rejects(() => x.dispatcher.dispatch("job-legacy-h2"),
    (error) => error.code === "DISPATCH_SNAPSHOT_REQUIRED");
});

test("H3-b D19/D51：双扫描或结果/过期竞争只允许一个终态提交", async (t) => {
  const x = await setupH3(t);
  const claimed = await claimDispatchJob({
    store: x.h.store, orgId: ORG, jobId: x.created.result.jobId,
    owner: "worker-expire-race", now: () => NOW,
  });
  x.setClock(claimed.fence.expiresAt);
  const settled = await Promise.allSettled([
    x.dispatcher.scanExpired(), x.dispatcher.scanExpired(),
  ]);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 2);
  assert.equal(settled.flatMap((item) => item.status === "fulfilled" ? item.value : []).length, 1);
  const job = await x.h.store.get("device_operation_jobs", x.created.result.jobId, ORG);
  assert.equal(job.state, "awaiting_result");
  const logs = (await x.h.store.list("device_operation_logs", ORG))
    .filter((item) => item.jobId === job._id && item.state === "awaiting_result");
  assert.equal(logs.length, 1);
});

test("H3-b D44：BLACKLIST_RETRY 保码且 Provider=0", async (t) => {
  const x = await setupH3(t);
  x.h.blacklist.evaluateEligibility = () => {
    const error = new Error("竞态");
    error.code = "BLACKLIST_RETRY";
    throw error;
  };
  const result = await x.dispatcher.dispatch(x.created.result.jobId);
  assert.equal(result.state, "retryable_failed");
  assert.equal(result.result.reasonCode, "BLACKLIST_RETRY");
  assert.equal(x.provider.calls.length, 0);
  assert.equal(x.h.counts.prepare, 3);
});

test("H3-b D28-D40/D47/D56/D60：T1 后固定源变化按序失败，Provider=0", async (t) => {
  const cases = [
    ["persons", PERSON, { status: "archived" }, "INVALID_STATE"],
    ["identity_applications", IDENTITY, { state: "revoked" }, "IDENTITY_NOT_APPROVED"],
    ["occupancies", OCCUPANCY, { revision: 2 }, "REVISION_CONFLICT"],
    ["occupancy_cycles", CYCLE, { epoch: 2 }, "REVISION_CONFLICT"],
    ["file_assets", FILE, { revision: 2 }, "FILE_BINDING_CHANGED"],
    ["access_devices", DEVICE, { claimId: "claim-other" }, "DEVICE_CLAIM_INVALID"],
    ["device_claims", CLAIM, { state: "released", boundDeviceId: undefined,
      releasedAt: NOW, releasedByAuditId: "audit-release", releaseReason: "test" }, "DEVICE_CLAIM_INVALID"],
    ["grant_slot_claims", null, { activeClaimId: "grant-other" }, "GRANT_SLOT_CONFLICT"],
    ["org_memberships", MEMBERSHIP, { permissions: [] }, "FORBIDDEN"],
    ["rooms", ROOM, { status: "archived" }, "ROOM_ARCHIVED"],
  ];
  for (const [collection, staticId, mutation, code] of cases) {
    const x = await setupH3(t);
    const id = staticId ?? x.created.after.grant_slot_claims.at(-1)._id;
    patchRecord(x.h, collection, id, mutation);
    const result = await x.dispatcher.dispatch(x.created.result.jobId);
    assert.equal(result.state, "terminal_failed", `${collection} 状态`);
    assert.equal(result.result.reasonCode, code, `${collection} 错误码`);
    assert.equal(x.provider.calls.length, 0, `${collection} Provider=0`);
  }
});

test("H3-b D24/D62/D65：运行配置关闭与发送窗口不足均 Provider=0", async (t) => {
  const h = await setup(t, { syntheticDispatch: true });
  const created = await expectSuccess(h);
  const provider = new MockFaceAccessProvider();
  const closed = new H3MockDispatcher({
    store: h.store, orgId: ORG, files: h.files, blacklist: h.blacklist, provider,
    now: () => NOW, owner: "worker-runtime-off",
    runtimeConfig: () => ({ executionMode: "live", provider: "mock" }),
  });
  const result = await closed.dispatch(created.result.jobId);
  assert.equal(result.state, "terminal_failed");
  assert.equal(result.result.reasonCode, "NOT_CONFIGURED");
  assert.equal(provider.calls.length, 0);

  const y = await setupH3(t);
  patchRecord(y.h, "occupancies", OCCUPANCY, { endsAt: NOW + 100_000 });
  patchRecord(y.h, "occupancy_cycles", CYCLE, { endsAt: NOW + 100_000 });
  patchRecord(y.h, "device_access_grants", y.created.result.grantId, { validUntil: NOW + 90_000 });
  let ticks = 0;
  const shortWindow = new H3MockDispatcher({
    store: y.h.store, orgId: ORG, files: y.h.files, blacklist: y.h.blacklist,
    provider: y.provider, owner: "worker-short-window",
    now: () => (ticks++ < 2 ? NOW : NOW + 50_001),
  });
  const short = await shortWindow.dispatch(y.created.result.jobId);
  assert.equal(short.state, "terminal_failed");
  assert.equal(short.result.reasonCode, "PRE_SEND_WINDOW_CLOSED");
  assert.equal(y.provider.calls.length, 0);
});

test("H3-b D27：并发 dispatcher 对同一 queued job 仅一个取得许可并调用", async (t) => {
  const x = await setupH3(t);
  const other = new H3MockDispatcher({
    store: x.h.store, orgId: ORG, files: x.h.files, blacklist: x.h.blacklist,
    provider: x.provider, now: () => NOW, owner: "worker-h3b-other",
  });
  const settled = await Promise.allSettled([
    x.dispatcher.dispatch(x.created.result.jobId), other.dispatch(x.created.result.jobId),
  ]);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(settled.filter((item) => item.status === "rejected").length, 1);
  assert.equal(x.provider.calls.length, 1);
});

test("H3-b D44：attempt=4 的名单瞬态与 Mock pre_send 均耗尽终态", async (t) => {
  for (const mode of ["blacklist", "provider"]) {
    const x = await setupH3(t, mode === "provider" ? "pre_send_fail" : "success");
    patchRecord(x.h, "device_operation_jobs", x.created.result.jobId, {
      attempts: 3, leaseGeneration: 3, revision: 7, nextAttemptAt: NOW,
      result: { attempt: 3, outcome: "retryable_failed", errorKind: "RETRYABLE",
        reasonCode: "PRIOR", finishedAt: NOW },
    });
    if (mode === "blacklist") x.h.blacklist.evaluateEligibility = () => {
      const error = new Error("竞态"); error.code = "BLACKLIST_RETRY"; throw error;
    };
    const result = await x.dispatcher.dispatch(x.created.result.jobId);
    assert.equal(result.state, "terminal_failed");
    assert.equal(result.result.reasonCode, mode === "blacklist" ? "BLACKLIST_RETRY" : "PROVIDER_PRE_SEND");
    assert.equal(result.attempts, 4);
    assert.equal(x.provider.calls.length, mode === "provider" ? 1 : 0);
    await assert.rejects(() => x.dispatcher.requeue(result._id, result.revision),
      (error) => error.code === "INVALID_JOB");
  }
});

test("H3-b D54：人工重排要求 device.operation.retry，自动重排共享 CAS", async (t) => {
  const x = await setupH3(t, "pre_send_fail");
  const failed = await x.dispatcher.dispatch(x.created.result.jobId);
  x.setClock(failed.nextAttemptAt);
  await assert.rejects(() => x.dispatcher.requeue(failed._id, failed.revision, {
    membershipId: MEMBERSHIP, actorId: MEMBERSHIP,
  }), (error) => error.code === "FORBIDDEN");
  patchRecord(x.h, "org_memberships", MEMBERSHIP,
    { permissions: ["device.access.manage", "device.operation.retry"] });
  const settled = await Promise.allSettled([
    x.dispatcher.requeue(failed._id, failed.revision, { membershipId: MEMBERSHIP, actorId: MEMBERSHIP }),
    x.dispatcher.requeue(failed._id, failed.revision),
  ]);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(settled.filter((item) => item.status === "rejected").length, 1);
});

test("H3-b D63/D66：仅 LocalStore+Mock，日志冲突与 fence 拒绝内容级零变化", async (t) => {
  const h = await setup(t, { syntheticDispatch: true });
  const provider = new MockFaceAccessProvider();
  assert.throws(() => new H3MockDispatcher({
    store: {}, orgId: ORG, files: h.files, blacklist: h.blacklist, provider,
  }), (error) => error.code === "NOT_CONFIGURED");
  const created = await expectSuccess(h);
  const claimed = await claimDispatchJob({
    store: h.store, orgId: ORG, jobId: created.result.jobId, owner: "worker-fence", now: () => NOW,
  });
  const before = await snapshot(h.store);
  h.store.data.device_operation_logs.push({
    _id: `log:${Buffer.from(created.result.jobId).toString("base64url")}:${Buffer.from("awaiting_result").toString("base64url")}:${claimed.job.revision + 1}`,
    orgId: ORG,
  });
  const dispatcher = new H3MockDispatcher({
    store: h.store, orgId: ORG, files: h.files, blacklist: h.blacklist, provider,
    now: () => claimed.fence.expiresAt, owner: "worker-fence",
  });
  await assert.rejects(() => dispatcher.expire(created.result.jobId));
  const after = await snapshot(h.store);
  for (const name of CORE) {
    if (name !== "device_operation_logs") assert.deepEqual(after[name], before[name]);
  }
  assert.equal(after.admin_audit.length, before.admin_audit.length);
});

test("H3-b 敏感扫描：job/log/audit/snapshot 不含设备原值和私密字段", async (t) => {
  const x = await setupH3(t);
  await x.dispatcher.dispatch(x.created.result.jobId);
  const records = {
    jobs: await x.h.store.list("device_operation_jobs", ORG),
    logs: await x.h.store.list("device_operation_logs", ORG),
    audit: await x.h.store.list("admin_audit"),
  };
  const text = JSON.stringify(records);
  for (const forbidden of ["SN-", "serialNumber", "objectKey", "identityDigest", "checksum", "MAC", "ipAddress"]) {
    assert.equal(text.includes(forbidden), false, `不得出现 ${forbidden}`);
  }
});
