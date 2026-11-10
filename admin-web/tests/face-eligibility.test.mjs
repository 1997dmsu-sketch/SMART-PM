import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ELIGIBILITY_REFS,
  activeAt,
  minEnd,
  occupancyClaimId,
  planEligibilityRefs,
  primarySlotId,
  snapshotEligibility,
  validateEligibility,
} from "../lib/face-service/eligibility.mjs";
import { primarySlotId as occupancyPrimarySlotId } from "../lib/occupancies.mjs";
import { guardId } from "../lib/claims.mjs";

const ORG = "org-h2c";
const NOW = 1_000_000;
const key = (collection, id) => `${collection}/${id}`;
const put = (target, collection, record) => {
  target[key(collection, record._id)] = record;
  return target;
};

/**
 * 完整只读资格 fixture：primary 时 occ-1 即周期主入住；member 时另有 occ-primary。
 * expected 是事务前预读基线，state 是事务内快照，两者独立可变。
 */
function fixture({ role = "primary", sponsorOccupancyId = null } = {}) {
  const primaryId = "occ-primary";
  const occupancy = {
    _id: "occ-1", orgId: ORG, personId: "person-1", roomId: "room-1", cycleId: "cycle-1",
    role, state: "active", startsAt: 900_000, endsAt: 2_000_000,
    revision: 3, sponsorOccupancyId,
  };
  const cycle = {
    _id: "cycle-1", orgId: ORG, roomId: "room-1", state: "active",
    primaryOccupancyId: role === "member" ? primaryId : occupancy._id,
    startsAt: 900_000, endsAt: 1_800_000, endedAt: null, epoch: 2, revision: 4,
  };
  const room = {
    _id: "room-1", orgId: ORG, status: "active", floorId: "floor-1",
    buildingId: "building-1", communityId: "community-1", revision: 5,
  };
  const catalog = {
    floor: {
      _id: "floor-1", orgId: ORG, kind: "floor", status: "active",
      parentId: "building-1", revision: 6,
    },
    building: {
      _id: "building-1", orgId: ORG, kind: "building", status: "active",
      parentId: "community-1", revision: 7,
    },
    community: { _id: "community-1", orgId: ORG, kind: "community", status: "active", revision: 8 },
  };
  const person = { _id: "person-1", orgId: ORG, status: "active", revision: 2, userId: null };
  const identityApplication = {
    _id: "id-1", orgId: ORG, personId: "person-1", state: "approved",
    identityDigest: "digest-1", keyVersion: 1, revision: 2,
  };
  const primary = {
    _id: primaryId, orgId: ORG, personId: "person-primary", roomId: "room-1",
    cycleId: "cycle-1", role: "primary", state: "active",
    startsAt: 900_000, endsAt: 1_800_000, revision: 1, sponsorOccupancyId: null,
  };
  const expected = {
    occupancy, cycle, room, catalog, person, identityApplication, lifecycleGuard: null,
  };
  if (role === "member") expected.primary = { _id: primaryId, revision: 1 };
  if (sponsorOccupancyId) expected.sponsor = { _id: sponsorOccupancyId, revision: 1 };
  const request = {
    mode: "grant", orgId: ORG, personId: "person-1", occupancyId: "occ-1",
    cycleId: "cycle-1", identityApplicationId: "id-1",
    validFrom: 1_000_000, validUntil: 1_500_000, expected,
  };
  const state = {};
  put(state, "occupancies", structuredClone(occupancy));
  put(state, "occupancy_cycles", structuredClone(cycle));
  put(state, "rooms", structuredClone(room));
  put(state, "persons", structuredClone(person));
  put(state, "identity_applications", structuredClone(identityApplication));
  put(state, "property_catalog", structuredClone(catalog.floor));
  put(state, "property_catalog", structuredClone(catalog.building));
  put(state, "property_catalog", structuredClone(catalog.community));
  put(state, "unique_claims", {
    _id: occupancyClaimId(ORG, "room-1", "cycle-1", "person-1"),
    orgId: ORG, state: "bound", ownerId: "occ-1", revision: 1,
  });
  put(state, "room_primary_slots", {
    _id: primarySlotId(ORG, "room-1"), orgId: ORG,
    currentCycleId: "cycle-1",
    currentOccupancyId: role === "member" ? primaryId : "occ-1",
    currentPersonId: role === "member" ? "person-primary" : "person-1",
    revision: 2,
  });
  if (role === "member") put(state, "occupancies", structuredClone(primary));
  return { request, state, expected, occupancy, cycle, room, catalog, person, identityApplication, primary };
}

const check = (f, now = NOW) =>
  validateEligibility(snapshotEligibility(f.state, f.request), f.request, now);

test("C1 primary grant accepts an active occupancy and returns only minimal read-only context", () => {
  const f = fixture();
  const before = structuredClone(f.state);
  const refs = planEligibilityRefs(f.request);
  const snapshot = snapshotEligibility(f.state, f.request);
  const verdict = validateEligibility(snapshot, f.request, NOW);

  assert.equal(verdict.eligible, true);
  assert.equal(verdict.occupancyId, "occ-1");
  assert.equal(verdict.role, "primary");
  assert.equal(verdict.effectiveEnd, 1_800_000);
  assert.deepEqual(Object.keys(verdict).filter((k) => /name|phone|document|address/.test(k)), []);
  assert.equal("writes" in snapshot, false);
  assert.equal("writes" in verdict, false);
  assert.deepEqual(f.state, before, "资格校验必须只读");

  const keys = new Set(refs.map((r) => key(r.collection, r.id)));
  for (const expected of [
    "persons/person-1", "identity_applications/id-1", "occupancies/occ-1",
    "occupancy_cycles/cycle-1", "rooms/room-1", "property_catalog/floor-1",
    "property_catalog/building-1", "property_catalog/community-1",
    "unique_claims/" + occupancyClaimId(ORG, "room-1", "cycle-1", "person-1"),
    "room_primary_slots/" + primarySlotId(ORG, "room-1"),
  ]) assert.ok(keys.has(expected), `missing ref ${expected}`);
  assert.equal(keys.has("occupancies/occ-primary"), false);
});

test("C1 member requires an active matching primary and room slot", () => {
  const f = fixture({ role: "member" });
  assert.equal(check(f).eligible, true);
  const keys = new Set(planEligibilityRefs(f.request).map((r) => key(r.collection, r.id)));
  assert.ok(keys.has("occupancies/occ-primary"), "member 必须读取当前 primary");

  const wrongSlot = fixture({ role: "member" });
  wrongSlot.state[key("room_primary_slots", primarySlotId(ORG, "room-1"))].currentPersonId = "person-other";
  const slotVerdict = check(wrongSlot);
  assert.equal(slotVerdict.eligible, false);
  assert.equal(slotVerdict.code, "SPONSOR_INACTIVE");

  const endedPrimary = fixture({ role: "member" });
  endedPrimary.state[key("occupancies", "occ-primary")].state = "ended";
  assert.equal(check(endedPrimary).code, "SPONSOR_INACTIVE");

  const futurePrimary = fixture({ role: "member" });
  futurePrimary.state[key("occupancies", "occ-primary")].startsAt = NOW + 1;
  assert.equal(check(futurePrimary).code, "SPONSOR_INACTIVE");

  const changedPrimary = fixture({ role: "member" });
  changedPrimary.expected.primary = { _id: "occ-primary", revision: 2 };
  assert.equal(check(changedPrimary).code, "REVISION_CONFLICT");
});

test("C1 non-null sponsor must stay active and equal the cycle primary", () => {
  const valid = fixture({ role: "member", sponsorOccupancyId: "occ-primary" });
  assert.equal(check(valid).eligible, true);

  const changedSponsor = fixture({ role: "member", sponsorOccupancyId: "occ-primary" });
  changedSponsor.expected.sponsor = { _id: "occ-primary", revision: 2 };
  assert.equal(check(changedSponsor).code, "REVISION_CONFLICT");

  const other = fixture({ role: "member", sponsorOccupancyId: "occ-sponsor" });
  put(other.state, "occupancies", {
    _id: "occ-sponsor", orgId: ORG, personId: "person-sponsor", roomId: "room-1",
    cycleId: "cycle-1", role: "member", state: "active",
    startsAt: 900_000, endsAt: 2_000_000, revision: 1, sponsorOccupancyId: null,
  });
  const verdict = check(other);
  assert.equal(verdict.code, "SPONSOR_INACTIVE");
  assert.match(verdict.message, /邀请人/);
});

test("C1 time windows are half-open and the grant window is contained", () => {
  const at = (now, mutate = () => {}) => {
    const f = fixture();
    mutate(f);
    const before = structuredClone(f.state);
    const verdict = check(f, now);
    assert.deepEqual(f.state, before, "时间校验不得写入");
    return verdict;
  };

  assert.equal(at(900_000, (f) => { f.request.validFrom = 900_000; }).eligible, true, "startsAt 包含");
  assert.equal(at(1_500_000).code, "INVALID_STATE", "validUntil 排他");
  assert.equal(at(2_000_000).code, "INVALID_STATE", "occupancy.endsAt 排他");
  assert.equal(at(1_800_000).code, "INVALID_STATE", "cycle.endsAt 排他");
  assert.equal(at(999_999).code, "INVALID_STATE", "now < validFrom");
  assert.equal(at(1_000_000, (f) => {
    f.state[key("occupancy_cycles", "cycle-1")].endedAt = 1_000_000;
    f.expected.cycle.endedAt = 1_000_000;
  }).code, "INVALID_STATE", "cycle.endedAt 排他");

  const openEnded = fixture();
  openEnded.state[key("occupancies", "occ-1")].endsAt = null;
  openEnded.state[key("occupancy_cycles", "cycle-1")].endsAt = null;
  openEnded.expected.occupancy.endsAt = null;
  openEnded.expected.cycle.endsAt = null;
  assert.equal(check(openEnded).eligible, true, "null 结束时间不自动失效");

  assert.equal(at(1_000_000, (f) => { f.request.validFrom = 899_999; }).code, "PARAM_ERROR");
  assert.equal(at(1_000_000, (f) => { f.request.validUntil = 1_800_001; }).code, "PARAM_ERROR");
  assert.equal(at(1_000_000, (f) => { f.request.validUntil = 1_000_000; }).code, "PARAM_ERROR");
});

test("C1 catalog hierarchy is checked at every level and never skipped", () => {
  const withState = (mutate) => {
    const f = fixture();
    mutate(f);
    const before = structuredClone(f.state);
    const verdict = check(f);
    assert.deepEqual(f.state, before, "校验保持只读");
    return verdict;
  };

  assert.equal(withState((f) => { f.state[key("rooms", "room-1")].status = "archived"; }).code,
    "ROOM_ARCHIVED");
  assert.equal(withState((f) => { f.state[key("property_catalog", "floor-1")].status = "archived"; }).code,
    "ROOM_ARCHIVED");
  assert.equal(withState((f) => { f.state[key("property_catalog", "community-1")].kind = "building"; }).code,
    "NOT_FOUND");
  assert.equal(withState((f) => { delete f.state[key("property_catalog", "community-1")]; }).code,
    "NOT_FOUND");
  assert.equal(withState((f) => { f.state[key("property_catalog", "floor-1")].parentId = "building-x"; }).code,
    "REVISION_CONFLICT");
  assert.equal(withState((f) => { f.state[key("property_catalog", "building-1")].parentId = "community-x"; }).code,
    "REVISION_CONFLICT");
  assert.equal(withState((f) => { f.state[key("property_catalog", "floor-1")].revision = 99; }).code,
    "REVISION_CONFLICT");
  assert.equal(withState((f) => { f.state[key("rooms", "room-1")].floorId = "floor-x"; }).code,
    "REVISION_CONFLICT");
  assert.equal(withState((f) => { f.state[key("rooms", "room-1")].communityId = null; }).code,
    "REVISION_CONFLICT");
});

test("C1 corrupt or missing snapshots fail closed without throwing", () => {
  const f = fixture();
  assert.equal(validateEligibility(snapshotEligibility({}, f.request), f.request, NOW).code, "NOT_FOUND");
  assert.equal(validateEligibility(snapshotEligibility(null, f.request), f.request, NOW).code, "NOT_FOUND");

  const corrupt = structuredClone(f.state);
  corrupt[key("occupancies", "occ-1")] = "not-an-object";
  assert.equal(validateEligibility(snapshotEligibility(corrupt, f.request), f.request, NOW).code,
    "NOT_FOUND");

  const badCycle = structuredClone(f.state);
  badCycle[key("occupancy_cycles", "cycle-1")] = 42;
  assert.equal(validateEligibility(snapshotEligibility(badCycle, f.request), f.request, NOW).code,
    "NOT_FOUND");

  const badRoom = structuredClone(f.state);
  badRoom[key("rooms", "room-1")] = [];
  assert.equal(validateEligibility(snapshotEligibility(badRoom, f.request), f.request, NOW).code,
    "NOT_FOUND");

  assert.throws(() => planEligibilityRefs({ ...f.request, expected: null }),
    (error) => error.code === "PARAM_ERROR");
  assert.throws(() => planEligibilityRefs({
    ...f.request, expected: { ...f.expected, occupancy: { ...f.expected.occupancy, _id: "occ-x" } },
  }), (error) => error.code === "PARAM_ERROR");
  assert.throws(() => planEligibilityRefs({
    ...f.request, expected: { ...f.expected, cycle: { ...f.expected.cycle, revision: undefined } },
  }), (error) => error.code === "PARAM_ERROR");
});

test("C1 refs are deduplicated and the 90-ref boundary fails closed", () => {
  const f = fixture();
  const base = planEligibilityRefs(f.request);
  assert.equal(new Set(base.map((r) => key(r.collection, r.id))).size, base.length);

  const duplicated = planEligibilityRefs({
    ...f.request,
    baseRefs: [
      { collection: "persons", id: "person-1" },
      { collection: "rooms", id: "room-1" },
    ],
  });
  assert.equal(duplicated.length, base.length);

  const filler = (count) => Array.from({ length: count }, (_, i) => ({
    collection: "access_devices", id: `device-${i}`,
  }));
  const atLimit = planEligibilityRefs({ ...f.request, baseRefs: filler(MAX_ELIGIBILITY_REFS - base.length) });
  assert.equal(atLimit.length, MAX_ELIGIBILITY_REFS);

  assert.throws(
    () => planEligibilityRefs({
      ...f.request, baseRefs: filler(MAX_ELIGIBILITY_REFS - base.length + 1),
    }),
    (error) => error.status === 400 && error.code === null,
  );
});

test("C1 person, account and identity snapshot races use BLACKLIST_RETRY", () => {
  const personRevision = fixture();
  personRevision.state[key("persons", "person-1")].revision = 3;
  const retry = check(personRevision);
  assert.equal(retry.code, "BLACKLIST_RETRY");
  assert.equal(retry.retry, true);
  assert.equal(retry.status, 409);

  const rebind = fixture();
  rebind.state[key("persons", "person-1")].userId = "user-2";
  assert.equal(check(rebind).code, "BLACKLIST_RETRY");

  const disabled = fixture();
  disabled.state[key("persons", "person-1")].userId = "user-1";
  disabled.expected.person.userId = "user-1";
  put(disabled.state, "users", { _id: "user-1", status: "disabled", revision: 1 });
  assert.equal(check(disabled).code, "USER_DISABLED");

  const missingUser = fixture();
  missingUser.state[key("persons", "person-1")].userId = "user-1";
  missingUser.expected.person.userId = "user-1";
  assert.equal(check(missingUser).code, "USER_DISABLED");

  const noAccount = fixture();
  noAccount.state[key("persons", "person-1")].userId = "user-1";
  noAccount.expected.person.userId = "user-1";
  put(noAccount.state, "users", { _id: "user-1", revision: 1 });
  assert.equal(check(noAccount).eligible, true, "无 status 的既有账号按 active 处理");

  const draft = fixture();
  draft.state[key("identity_applications", "id-1")].state = "submitted";
  assert.equal(check(draft).code, "IDENTITY_NOT_APPROVED");

  const noDigest = fixture();
  noDigest.state[key("identity_applications", "id-1")].identityDigest = "";
  assert.equal(check(noDigest).code, "IDENTITY_NOT_APPROVED");

  const conflict = fixture();
  conflict.state[key("identity_applications", "id-1")].personId = "person-other";
  assert.equal(check(conflict).code, "IDENTITY_CONFLICT");

  const digestChanged = fixture();
  digestChanged.state[key("identity_applications", "id-1")].identityDigest = "digest-2";
  assert.equal(check(digestChanged).code, "BLACKLIST_RETRY");

  const identityMissing = fixture();
  delete identityMissing.state[key("identity_applications", "id-1")];
  assert.equal(check(identityMissing).code, "NOT_FOUND");
});

test("C1 occupancy, cycle and claim relations fail closed with the frozen codes", () => {
  const withOccupancy = (mutate) => {
    const f = fixture();
    mutate(f);
    return check(f);
  };
  assert.equal(withOccupancy((f) => { f.state[key("occupancies", "occ-1")].personId = "person-x"; }).code,
    "REVISION_CONFLICT");
  assert.equal(withOccupancy((f) => { f.state[key("occupancies", "occ-1")].cycleId = "cycle-x"; }).code,
    "REVISION_CONFLICT");
  assert.equal(withOccupancy((f) => { f.state[key("occupancies", "occ-1")].role = "member"; }).code,
    "REVISION_CONFLICT");
  assert.equal(withOccupancy((f) => { f.state[key("occupancies", "occ-1")].revision = 4; }).code,
    "REVISION_CONFLICT");
  assert.equal(withOccupancy((f) => { f.state[key("occupancies", "occ-1")].state = "invited"; }).code,
    "INVALID_STATE");
  assert.equal(withOccupancy((f) => { f.state[key("occupancies", "occ-1")].role = "guest"; }).code,
    "INVALID_STATE");
  assert.equal(withOccupancy((f) => { delete f.state[key("occupancies", "occ-1")]; }).code, "NOT_FOUND");

  assert.equal(withOccupancy((f) => { f.state[key("occupancy_cycles", "cycle-1")].state = "ended"; }).code,
    "INVALID_STATE");
  assert.equal(withOccupancy((f) => { f.state[key("occupancy_cycles", "cycle-1")].roomId = "room-x"; }).code,
    "REVISION_CONFLICT");
  assert.equal(withOccupancy((f) => { f.state[key("occupancy_cycles", "cycle-1")].epoch = 3; }).code,
    "REVISION_CONFLICT");
  assert.equal(withOccupancy((f) => { delete f.state[key("occupancy_cycles", "cycle-1")]; }).code,
    "NOT_FOUND");

  assert.equal(withOccupancy((f) => { f.state[key("unique_claims",
    occupancyClaimId(ORG, "room-1", "cycle-1", "person-1"))].ownerId = "occ-x"; }).code,
  "DUPLICATE_OCCUPANCY");
  assert.equal(withOccupancy((f) => { delete f.state[key("unique_claims",
    occupancyClaimId(ORG, "room-1", "cycle-1", "person-1"))]; }).code, "DUPLICATE_OCCUPANCY");

  assert.equal(withOccupancy((f) => {
    f.state[key("room_primary_slots", primarySlotId(ORG, "room-1"))].currentOccupancyId = "occ-x";
  }).code, "INVALID_STATE");
});

test("C1 clearing or rewriting sponsor after pre-read cannot bypass sponsor checks", () => {
  const cleared = fixture({ role: "member", sponsorOccupancyId: "occ-primary" });
  cleared.state[key("occupancies", "occ-1")].sponsorOccupancyId = null;
  const before = structuredClone(cleared.state);
  assert.equal(check(cleared).code, "REVISION_CONFLICT");
  assert.deepEqual(cleared.state, before, "sponsor 复核必须只读");

  const rewritten = fixture({ role: "member", sponsorOccupancyId: "occ-primary" });
  rewritten.state[key("occupancies", "occ-1")].sponsorOccupancyId = "occ-other";
  const rewrittenBefore = structuredClone(rewritten.state);
  assert.equal(check(rewritten).code, "REVISION_CONFLICT");
  assert.deepEqual(rewritten.state, rewrittenBefore);

  const sponsorRevision = fixture({ role: "member", sponsorOccupancyId: "occ-primary" });
  sponsorRevision.state[key("occupancies", "occ-primary")].revision = 2;
  const revisionBefore = structuredClone(sponsorRevision.state);
  assert.equal(check(sponsorRevision).code, "REVISION_CONFLICT");
  assert.deepEqual(sponsorRevision.state, revisionBefore);
});

test("C1 pre-read baselines are mandatory and validated at planning time", () => {
  const planParam = (f) => assert.throws(
    () => planEligibilityRefs(f.request),
    (error) => error.code === "PARAM_ERROR",
  );

  const noPrimary = fixture({ role: "member" });
  delete noPrimary.expected.primary;
  planParam(noPrimary);

  const noSponsor = fixture({ role: "member", sponsorOccupancyId: "occ-primary" });
  delete noSponsor.expected.sponsor;
  planParam(noSponsor);

  const noGuard = fixture();
  delete noGuard.expected.lifecycleGuard;
  planParam(noGuard);

  for (const mutate of [
    (f) => { f.expected.person._id = "person-x"; },
    (f) => { f.expected.identityApplication._id = "id-x"; },
    (f) => { f.expected.occupancy.personId = "person-x"; },
    (f) => { f.expected.cycle._id = "cycle-x"; },
    (f) => { f.expected.room.revision = "5"; },
    (f) => { f.expected.catalog.floor.revision = -1; },
    (f) => { f.expected.person.revision = 2 ** 53; },
    (f) => { f.expected.catalog.building.kind = "floor"; },
    (f) => { f.expected.catalog.floor.parentId = "building-x"; },
    (f) => { f.expected.room.communityId = null; },
    (f) => { f.expected.lifecycleGuard = { epoch: 1 }; },
    (f) => { f.expected.lifecycleGuard = { epoch: "1", revision: 1 }; },
  ]) {
    const f = fixture();
    mutate(f);
    planParam(f);
  }
});

test("C1 lifecycle guard baseline distinguishes null from an existing record", () => {
  const appeared = fixture();
  put(appeared.state, "lifecycle_guards", {
    _id: guardId(ORG), orgId: ORG, epoch: 1, revision: 1,
  });
  assert.equal(check(appeared).code, "REVISION_CONFLICT", "基线 null 但事务内出现记录");

  const changed = fixture();
  changed.request.expected.lifecycleGuard = { _id: guardId(ORG), orgId: ORG, epoch: 1, revision: 1 };
  put(changed.state, "lifecycle_guards", {
    _id: guardId(ORG), orgId: ORG, epoch: 2, revision: 2,
  });
  assert.equal(check(changed).code, "REVISION_CONFLICT");

  const vanished = fixture();
  vanished.request.expected.lifecycleGuard = { _id: guardId(ORG), orgId: ORG, epoch: 1, revision: 1 };
  assert.equal(check(vanished).code, "REVISION_CONFLICT");

  const stable = fixture();
  stable.request.expected.lifecycleGuard = { _id: guardId(ORG), orgId: ORG, epoch: 3, revision: 3 };
  put(stable.state, "lifecycle_guards", {
    _id: guardId(ORG), orgId: ORG, epoch: 3, revision: 3,
  });
  assert.equal(check(stable).eligible, true);
});

test("C1 shared slot and claim ids are the same primitives used by OccupancyService", () => {
  assert.equal(primarySlotId(ORG, "room-1"), occupancyPrimarySlotId(ORG, "room-1"));
  assert.equal(activeAt({ startsAt: 10, endsAt: 20 }, 10), true);
  assert.equal(activeAt({ startsAt: 10, endsAt: 20 }, 20), false);
  assert.equal(activeAt({ startsAt: 10, endsAt: null }, 1e9), true);
  assert.equal(minEnd(10, null, undefined, 5), 5);
  assert.equal(minEnd(null, undefined), null);
});

test("primary 未绑定 cycle.primaryOccupancyId：计划阶段 PARAM_ERROR", () => {
  const { request, snapshot } = fixture();
  const bad = structuredClone(request);
  bad.expected.cycle.primaryOccupancyId = "occ-other";
  assert.throws(
    () => validateEligibility(snapshot, bad, NOW),
    (e) => e.code === "PARAM_ERROR",
  );
});

test("lifecycle guard：错误 ID、跨组织 PARAM_ERROR；合法 guard 通过", () => {
  const { request, snapshot } = fixture();
  const base = { orgId: ORG, epoch: 0, revision: 1 };

  const wrongId = structuredClone(request);
  wrongId.expected.lifecycleGuard = { ...base, _id: "guard-other" };
  assert.throws(
    () => validateEligibility(snapshot, wrongId, NOW),
    (e) => e.code === "PARAM_ERROR",
  );

  const crossOrg = structuredClone(request);
  crossOrg.expected.lifecycleGuard = { ...base, _id: guardId(ORG), orgId: "org-other" };
  assert.throws(
    () => validateEligibility(snapshot, crossOrg, NOW),
    (e) => e.code === "PARAM_ERROR",
  );

  const legal = structuredClone(request);
  legal.expected.lifecycleGuard = { ...base, _id: guardId(ORG) };
  assert.doesNotThrow(() => validateEligibility(snapshot, legal, NOW));
});
