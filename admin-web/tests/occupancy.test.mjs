import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalStore } from "../lib/store.mjs";
import { OrgService } from "../lib/org.mjs";
import { OrgPropertyService } from "../lib/property-v2.mjs";
import { PersonService } from "../lib/persons.mjs";
import { IdentityService } from "../lib/identity.mjs";
import { VerificationService } from "../lib/verification.mjs";
import { BlacklistService, blacklistDecisionHeadId } from "../lib/blacklist.mjs";
import { OccupancyService, primarySlotId } from "../lib/occupancies.mjs";

const KEY = Buffer.alloc(32, 11);
const audit = { actor: "admin", actorId: "acc-admin", actorIdType: "adminAccount", action: "入住测试" };
const reviewerAudit = { actor: "reviewer", actorId: "acc-reviewer", action: "审核测试" };
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-occupancy-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  const orgs = new OrgService(store);
  await orgs.bootstrap({ id: "org-a", name: "组织A", adminAccountIds: ["acc-admin"] }, audit);
  await orgs.bootstrap({ id: "org-b", name: "组织B", adminAccountIds: ["acc-b"] }, audit);
  await orgs.grantMembership({
    orgId: "org-a", principalType: "adminAccount", principalId: "acc-reviewer", role: "admin",
    permissions: ["identity.review", "blacklist.review", "blacklist.manage", "blacklist.read"],
  }, audit);
  const memberships = await store.list("org_memberships");
  const mem = (id) => memberships.find((m) => m.orgId === "org-a" && m.principalId === id)._id;
  const property = new OrgPropertyService(store, "org-a", { membershipId: mem("acc-admin") });
  const { buildingId } = await property.createProperty({
    mode: "new", communityName: "入住小区", buildingName: "1栋",
  }, audit);
  const floor = await property.createCatalog({
    kind: "floor", name: "1层", level: 1, parentId: buildingId,
  }, audit);
  const rooms = await property.createRooms({ floorId: floor._id, numbers: ["101", "102"] }, audit);
  const persons = new PersonService(store, "org-a", { membershipId: mem("acc-admin") });
  const identity = new IdentityService(store, { hmacKey: "test-occupancy-key-0123456789" });
  const verificationAdmin = new VerificationService(store, "org-a", { membershipId: mem("acc-admin") }, {
    identity, encryptionKey: KEY, fileValidator: async () => true,
  });
  const verificationReviewer = new VerificationService(store, "org-a", { membershipId: mem("acc-reviewer") }, {
    identity, encryptionKey: KEY, fileValidator: async () => true,
  });
  let clock = 1_000_000;
  let documents = 0;
  const now = () => clock;
  const internalBlacklist = new BlacklistService(store, "org-a", null, { now });
  const reviewerBlacklist = new BlacklistService(store, "org-a", { membershipId: mem("acc-reviewer") }, { now });
  const service = new OccupancyService(store, "org-a", { membershipId: mem("acc-admin") }, {
    blacklist: internalBlacklist, now,
  });
  const residentService = (userId) => new OccupancyService(store, "org-a", { userId }, {
    blacklist: internalBlacklist, now,
  });
  const approveFor = async (personId, existingId = null) => {
    const applicationId = existingId || (await verificationAdmin.createApplication({
      personId, documentType: "id-card",
    }, audit)).applicationId;
    const current = await verificationAdmin.getApplication(applicationId);
    await verificationAdmin.submit(applicationId, {
      expectedRevision: current.revision,
      document: { name: "测试住户", documentNumber: `11010119900101${2000 + documents++}` },
      fileIds: ["file-identity-test"],
    }, audit);
    const submitted = await verificationReviewer.getApplication(applicationId);
    await verificationReviewer.review(applicationId, {
      decision: "approve", reason: "测试通过", expectedRevision: submitted.revision, documentVersion: 1,
    }, reviewerAudit);
    return applicationId;
  };
  const bindUser = async (personId, userId, { createUser = true } = {}) => {
    await store.transact([
      { collection: "persons", id: personId }, { collection: "users", id: userId },
    ], (state) => [
      {
        collection: "persons", id: personId,
        data: { userId, revision: state[`persons/${personId}`].revision + 1 },
      },
      ...(createUser ? [{
        collection: "users", id: userId,
        data: {
          role: "user", status: "active",
          ...(state[`users/${userId}`]
            ? { revision: (state[`users/${userId}`].revision ?? 0) + 1 }
            : { revision: 1, createdAt: Date.now() }),
        },
      }] : []),
    ], audit);
  };
  const setUserStatus = async (userId, status) => {
    await store.transact([{ collection: "users", id: userId }], (state) => [{
      collection: "users", id: userId,
      data: { status, revision: (state[`users/${userId}`]?.revision ?? 0) + 1 },
    }], audit);
  };
  return {
    store, orgs, property, persons, service, residentService, reviewerBlacklist,
    verificationAdmin, verificationReviewer, approveFor, bindUser, setUserStatus,
    roomId: rooms.ids[0], otherRoomId: rooms.ids[1],
    setClock: (value) => { clock = value; },
  };
}
const cycleInput = (personId, extra = {}) => ({
  primaryPersonId: personId, startsAt: 1_000_000, endsAt: null, ...extra,
});
const memberInput = (roomId, cycleId, personId, extra = {}) => ({
  roomId, cycleId, personId, role: "member", startsAt: 1_000_000, endsAt: null, ...extra,
});
const activate = (service, created, identityApplicationId) => service.activate(created.occupancyId, {
  expectedRevision: created.revision, identityApplicationId,
}, audit);

test("pending relations do not authorize; approved identity is required for primary and member", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "主租客" }, audit);
  const member = await x.persons.createPerson({ name: "家庭成员" }, audit);
  const primaryApplication = await x.approveFor(primary.personId);
  const cycle = await x.service.createCycle(x.roomId, cycleInput(primary.personId), audit);
  assert.equal(cycle.storedState, "pending_review");
  assert.equal((await x.store.list("room_primary_slots")).length, 0);
  const memberPending = await x.service.createOccupancy(
    memberInput(x.roomId, cycle.cycleId, member.personId), audit,
  );
  assert.equal(memberPending.storedState, "invited");
  const draft = await x.verificationAdmin.createApplication({
    personId: member.personId, documentType: "id-card",
  }, audit);
  await assert.rejects(activate(x.service, memberPending, draft.applicationId),
    (e) => e.code === "IDENTITY_NOT_APPROVED");
  const memberApplication = await x.approveFor(member.personId, draft.applicationId);
  const activePrimary = await activate(x.service, cycle, primaryApplication);
  assert.equal(activePrimary.effectiveState, "active");
  const activeMember = await activate(x.service, memberPending, memberApplication);
  assert.equal(activeMember.effectiveState, "active");
  const listed = await x.service.listOccupancies(x.roomId);
  assert.equal(listed.data.length, 2);
  assert.ok(listed.data.every((o) => o.effectiveState === "active"));
  assert.ok(listed.data.every((o) => o.storedState && o.cycleId && "effectiveEndsAt" in o));
  await assert.rejects(x.service.createOccupancy(
    memberInput(x.roomId, cycle.cycleId, member.personId), audit,
  ), (e) => e.code === "DUPLICATE_OCCUPANCY");
  await assert.rejects(x.service.createOccupancy(
    memberInput(x.roomId, cycle.cycleId, member.personId, { role: "primary" }), audit,
  ), (e) => e.code === "PARAM_ERROR");
});

test("two primary activations serialize on the fixed room slot", async (t) => {
  const x = await setup(t);
  const first = await x.persons.createPerson({ name: "候选甲" }, audit);
  const second = await x.persons.createPerson({ name: "候选乙" }, audit);
  const [firstApplication, secondApplication] = await Promise.all([
    x.approveFor(first.personId), x.approveFor(second.personId),
  ]);
  const firstCycle = await x.service.createCycle(x.roomId, cycleInput(first.personId), audit);
  const secondCycle = await x.service.createCycle(x.roomId, cycleInput(second.personId), audit);
  const outcomes = await Promise.allSettled([
    activate(x.service, firstCycle, firstApplication),
    activate(x.service, secondCycle, secondApplication),
  ]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  const rejected = outcomes.find((o) => o.status === "rejected");
  assert.equal(rejected.reason.code, "PRIMARY_OCCUPIED");
  const slots = await x.store.list("room_primary_slots");
  assert.equal(slots.length, 1);
  const cycles = (await x.store.list("occupancy_cycles")).filter((c) =>
    [firstCycle.cycleId, secondCycle.cycleId].includes(c._id));
  assert.equal(cycles.filter((c) => c.state === "active").length, 1);
  assert.equal(cycles.filter((c) => c.state === "pending").length, 1);
});

test("future review cannot bypass activation time and [start,end) boundary permits replacement", async (t) => {
  const x = await setup(t);
  const first = await x.persons.createPerson({ name: "未来住户" }, audit);
  const second = await x.persons.createPerson({ name: "下任住户" }, audit);
  const [firstApplication, secondApplication] = await Promise.all([
    x.approveFor(first.personId), x.approveFor(second.personId),
  ]);
  const future = await x.service.createCycle(x.roomId, cycleInput(first.personId, {
    startsAt: 2_000_000, endsAt: 3_000_000,
  }), audit);
  await assert.rejects(activate(x.service, future, firstApplication), (e) => e.code === "INVALID_STATE");
  x.setClock(2_000_000);
  await activate(x.service, future, firstApplication);
  x.setClock(3_000_000);
  let listed = await x.service.listOccupancies(x.roomId);
  assert.equal(listed.data[0].storedState, "active");
  assert.equal(listed.data[0].effectiveState, "ended");
  assert.equal(listed.data[0].effectiveEndsAt, 3_000_000);
  const replacement = await x.service.createCycle(x.roomId, cycleInput(second.personId, {
    startsAt: 3_000_000, endsAt: null,
  }), audit);
  await activate(x.service, replacement, secondApplication);
  listed = await x.service.listOccupancies(x.roomId);
  assert.equal(listed.data.filter((o) => o.effectiveState === "active").length, 1);
  assert.equal(listed.data.find((o) => o.effectiveState === "active").personId, second.personId);
});

test("primary can invite only within the effective sponsored room and cycle", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "主租账号" }, audit);
  const otherPrimary = await x.persons.createPerson({ name: "他房主租" }, audit);
  const member = await x.persons.createPerson({ name: "被邀请人" }, audit);
  await x.bindUser(primary.personId, "user-primary");
  const [primaryApplication, otherApplication, memberApplication] = await Promise.all([
    x.approveFor(primary.personId), x.approveFor(otherPrimary.personId), x.approveFor(member.personId),
  ]);
  const cycle = await x.service.createCycle(x.roomId, cycleInput(primary.personId), audit);
  await activate(x.service, cycle, primaryApplication);
  const otherCycle = await x.service.createCycle(x.otherRoomId, cycleInput(otherPrimary.personId), audit);
  await activate(x.service, otherCycle, otherApplication);
  const resident = x.residentService("user-primary");
  const invited = await resident.createOccupancy(
    memberInput(x.roomId, cycle.cycleId, member.personId), { ...audit, actorType: "user" },
  );
  assert.equal(invited.sponsorOccupancyId, undefined); // DTO does not expose internal sponsor details
  await assert.rejects(resident.createOccupancy(
    memberInput(x.otherRoomId, otherCycle.cycleId, member.personId), audit,
  ), (e) => e.code === "SPONSOR_INACTIVE");
  await x.service.end(cycle.occupancyId, {
    expectedRevision: 2, reason: "整户退租", endsAt: 1_000_000,
  }, audit);
  await assert.rejects(activate(x.service, invited, memberApplication),
    (e) => ["INVALID_STATE", "SPONSOR_INACTIVE"].includes(e.code));
  await assert.rejects(resident.createOccupancy(
    memberInput(x.roomId, cycle.cycleId, member.personId), audit,
  ), (e) => e.code === "SPONSOR_INACTIVE");
  const listed = await x.service.listOccupancies(x.roomId);
  assert.ok(listed.data.every((o) => o.effectiveState === "ended"));
});

test("ending a primary immediately ends every member before replayable materialization", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "周期主租" }, audit);
  const member = await x.persons.createPerson({ name: "周期成员" }, audit);
  const [primaryApplication, memberApplication] = await Promise.all([
    x.approveFor(primary.personId), x.approveFor(member.personId),
  ]);
  const cycle = await x.service.createCycle(x.roomId, cycleInput(primary.personId), audit);
  await activate(x.service, cycle, primaryApplication);
  const invited = await x.service.createOccupancy(
    memberInput(x.roomId, cycle.cycleId, member.personId), audit,
  );
  await activate(x.service, invited, memberApplication);
  const ended = await x.service.end(cycle.occupancyId, {
    expectedRevision: 2, reason: "整户退租", endsAt: 1_000_000,
  }, audit);
  assert.ok(ended.materializationJobId);
  let rows = (await x.service.listOccupancies(x.roomId)).data;
  const storedMember = rows.find((o) => o.occupancyId === invited.occupancyId);
  assert.equal(storedMember.storedState, "active"); // history backfill has not run
  assert.equal(storedMember.effectiveState, "ended"); // authorization is already invalid
  assert.ok(rows.every((o) => o.effectiveState === "ended"));
  assert.equal((await x.store.list("room_primary_slots"))[0].currentCycleId, null);
  const first = await x.service.materialize(ended.materializationJobId, { limit: 1 });
  assert.equal(first.state, "done");
  const replay = await x.service.materialize(ended.materializationJobId, { limit: 1 });
  assert.equal(replay.processed, 0);
  rows = (await x.service.listOccupancies(x.roomId)).data;
  assert.ok(rows.every((o) => o.storedState === "ended"));
  assert.equal((await x.service.getMaterialization(ended.materializationJobId)).state, "done");
});

test("member end affects only that member and never releases the primary slot", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "保留主租" }, audit);
  const member = await x.persons.createPerson({ name: "单独退租" }, audit);
  const [primaryApplication, memberApplication] = await Promise.all([
    x.approveFor(primary.personId), x.approveFor(member.personId),
  ]);
  const cycle = await x.service.createCycle(x.roomId, cycleInput(primary.personId), audit);
  await activate(x.service, cycle, primaryApplication);
  const invited = await x.service.createOccupancy(
    memberInput(x.roomId, cycle.cycleId, member.personId), audit,
  );
  const activeMember = await activate(x.service, invited, memberApplication);
  const ended = await x.service.end(invited.occupancyId, {
    expectedRevision: activeMember.revision, reason: "成员退租", endsAt: 1_000_000,
  }, audit);
  assert.equal(ended.materializationJobId, undefined);
  const rows = (await x.service.listOccupancies(x.roomId)).data;
  assert.equal(rows.find((o) => o.role === "primary").effectiveState, "active");
  assert.equal(rows.find((o) => o.role === "member").effectiveState, "ended");
  assert.equal((await x.store.list("room_primary_slots"))[0].currentCycleId, cycle.cycleId);
});

test("backdated whole-cycle end cannot predate an active member", async (t) => {
  const x = await setup(t);
  x.setClock(1_500_000);
  const primary = await x.persons.createPerson({ name: "补录主租" }, audit);
  const member = await x.persons.createPerson({ name: "补录成员" }, audit);
  const [primaryApplication, memberApplication] = await Promise.all([
    x.approveFor(primary.personId), x.approveFor(member.personId),
  ]);
  const cycle = await x.service.createCycle(x.roomId, cycleInput(primary.personId), audit);
  await activate(x.service, cycle, primaryApplication);
  const invited = await x.service.createOccupancy(memberInput(
    x.roomId, cycle.cycleId, member.personId, { startsAt: 1_500_000 },
  ), audit);
  await activate(x.service, invited, memberApplication);
  await assert.rejects(x.service.end(cycle.occupancyId, {
    expectedRevision: 2, reason: "错误补录", endsAt: 1_200_000,
  }, audit), (e) => e.code === "PARAM_ERROR");
  assert.equal((await x.store.list("occupancy_cycles"))
    .find((c) => c._id === cycle.cycleId).state, "active");
  assert.equal((await x.store.list("room_primary_slots"))[0].currentCycleId, cycle.cycleId);
  assert.equal((await x.store.list("occupancy_materializations")).length, 0);
});

test("primary transfer ends the old cycle, creates a new pending cycle and carries no members", async (t) => {
  const x = await setup(t);
  const oldPrimary = await x.persons.createPerson({ name: "旧主租" }, audit);
  const oldMember = await x.persons.createPerson({ name: "旧成员" }, audit);
  const newPrimary = await x.persons.createPerson({ name: "新主租" }, audit);
  const [oldApplication, memberApplication, newApplication] = await Promise.all([
    x.approveFor(oldPrimary.personId), x.approveFor(oldMember.personId), x.approveFor(newPrimary.personId),
  ]);
  const oldCycle = await x.service.createCycle(x.roomId, cycleInput(oldPrimary.personId), audit);
  const activeOld = await activate(x.service, oldCycle, oldApplication);
  const invited = await x.service.createOccupancy(
    memberInput(x.roomId, oldCycle.cycleId, oldMember.personId), audit,
  );
  await activate(x.service, invited, memberApplication);
  const oldCycleRow = (await x.store.list("occupancy_cycles")).find((c) => c._id === oldCycle.cycleId);
  const newPerson = (await x.store.list("persons")).find((p) => p._id === newPrimary.personId);
  const transferred = await x.service.transferPrimary(x.roomId, {
    occupancyId: oldCycle.occupancyId, cycleId: oldCycle.cycleId,
    expectedRevision: activeOld.revision, expectedCycleRevision: oldCycleRow.revision,
    newPrimaryPersonId: newPrimary.personId, newPersonExpectedRevision: newPerson.revision,
    reason: "换租", oldEndsAt: 1_000_000, startsAt: 1_000_000, endsAt: null,
  }, audit);
  assert.equal(transferred.storedState, "pending_review");
  assert.notEqual(transferred.cycleId, oldCycle.cycleId);
  assert.ok(transferred.materializationJobId);
  let rows = (await x.service.listOccupancies(x.roomId)).data;
  assert.equal(rows.filter((o) => o.cycleId === transferred.cycleId).length, 1);
  assert.ok(rows.filter((o) => o.cycleId === oldCycle.cycleId)
    .every((o) => o.effectiveState === "ended"));
  await activate(x.service, transferred, newApplication);
  await x.service.materialize(transferred.materializationJobId);
  rows = (await x.service.listOccupancies(x.roomId)).data;
  assert.equal(rows.find((o) => o.cycleId === transferred.cycleId).effectiveState, "active");
  assert.ok(rows.filter((o) => o.cycleId === oldCycle.cycleId)
    .every((o) => o.storedState === "ended" && o.effectiveState === "ended"));
});

test("blacklist hit blocks activation without writes and exact review allows this occupancy", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "复核住户" }, audit);
  const applicationId = await x.approveFor(primary.personId);
  const cycle = await x.service.createCycle(x.roomId, cycleInput(primary.personId), audit);
  const entry = await x.reviewerBlacklist.createEntry({
    subjectType: "person", personId: primary.personId, reason: "需复核",
    evidenceFileIds: [], restrictions: ["occupancy.activate"], startsAt: 1_000_000, endsAt: null,
  }, reviewerAudit);
  await assert.rejects(activate(x.service, cycle, applicationId),
    (e) => e.code === "BLACKLIST_REVIEW_REQUIRED");
  assert.equal((await x.store.list("occupancies")).find((o) => o._id === cycle.occupancyId).state,
    "pending_review");
  assert.equal((await x.store.list("room_primary_slots")).length, 0);
  await x.reviewerBlacklist.reviewOccupancy(cycle.occupancyId, {
    decision: "allow", reason: "本次允许", entryIds: [entry.entryId], entryRevisions: [1],
  }, reviewerAudit);
  assert.equal((await activate(x.service, cycle, applicationId)).effectiveState, "active");
});

test("activation and archival share the lifecycle guard; effective relations block archival", async (t) => {
  const x = await setup(t);
  const now = Date.now();
  x.setClock(now);
  const primary = await x.persons.createPerson({ name: "归档住户" }, audit);
  const applicationId = await x.approveFor(primary.personId);
  const cycle = await x.service.createCycle(x.roomId, cycleInput(primary.personId, {
    startsAt: now - 1000,
  }), audit);
  const room = (await x.store.list("rooms", "org-a")).find((r) => r._id === x.roomId);
  const plan = await x.property.scanArchive("room", x.roomId, { expectedRevision: room.revision });
  await activate(x.service, cycle, applicationId);
  await assert.rejects(x.property.commitArchive(plan, "竞态归档", audit),
    (e) => e.code === "GUARD_CHANGED");
  await assert.rejects(x.property.archive("room", x.roomId, {
    expectedRevision: room.revision, reason: "有入住归档",
  }, audit), (e) => e.code === "ARCHIVE_BLOCKED" && /有效入住/.test(e.message));
  await x.service.end(cycle.occupancyId, {
    expectedRevision: 2, reason: "退租后归档", endsAt: now,
  }, audit);
  const archived = await x.property.archive("room", x.roomId, {
    expectedRevision: room.revision, reason: "退租后归档",
  }, audit);
  assert.equal(archived.status, "archived");
});

test("cycle end races member activation without reviving access; batched backfill remains replayable", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "并发主租" }, audit);
  const primaryApplication = await x.approveFor(primary.personId);
  const cycle = await x.service.createCycle(x.roomId, cycleInput(primary.personId), audit);
  await activate(x.service, cycle, primaryApplication);
  for (const name of ["并发成员甲", "并发成员乙"]) {
    const person = await x.persons.createPerson({ name }, audit);
    const applicationId = await x.approveFor(person.personId);
    const invited = await x.service.createOccupancy(
      memberInput(x.roomId, cycle.cycleId, person.personId), audit,
    );
    await activate(x.service, invited, applicationId);
  }
  const pendingPerson = await x.persons.createPerson({ name: "并发待激活" }, audit);
  const pendingApplication = await x.approveFor(pendingPerson.personId);
  const pending = await x.service.createOccupancy(
    memberInput(x.roomId, cycle.cycleId, pendingPerson.personId), audit,
  );
  const [endOutcome, activationOutcome] = await Promise.allSettled([
    x.service.end(cycle.occupancyId, {
      expectedRevision: 2, reason: "并发整户退租", endsAt: 1_000_000,
    }, audit),
    activate(x.service, pending, pendingApplication),
  ]);
  let ended;
  if (endOutcome.status === "fulfilled") ended = endOutcome.value;
  else {
    // If member activation won the pre-scan race, the cycle epoch rejects the
    // stale backdating decision; retrying against the fresh cycle must end it.
    assert.equal(endOutcome.reason.code, "REVISION_CONFLICT");
    ended = await x.service.end(cycle.occupancyId, {
      expectedRevision: 2, reason: "并发整户退租重试", endsAt: 1_000_000,
    }, audit);
  }
  if (activationOutcome.status === "rejected")
    assert.ok(["INVALID_STATE", "SPONSOR_INACTIVE"].includes(activationOutcome.reason.code));
  const rows = (await x.service.listOccupancies(x.roomId)).data;
  assert.ok(rows.every((o) => o.effectiveState === "ended"));
  const jobId = ended.materializationJobId;
  const first = await x.service.materialize(jobId, { limit: 1 });
  assert.equal(first.state, "pending");
  let job = first;
  for (let i = 0; i < 4 && job.state !== "done"; i++)
    job = await x.service.materialize(jobId, { limit: 1 });
  assert.equal(job.state, "done");
  assert.ok((await x.store.list("occupancies"))
    .filter((o) => o.cycleId === cycle.cycleId)
    .every((o) => o.state === "ended" || o.state === "invited"));
  assert.equal((await x.service.materialize(jobId, { limit: 1 })).processed, 0);
});

test("cross-org references fail closed and resident reads expose only necessary self/room data", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "可见主租" }, audit);
  const member = await x.persons.createPerson({ name: "可见成员" }, audit);
  await x.bindUser(primary.personId, "user-read-primary");
  await x.bindUser(member.personId, "user-read-member");
  const [primaryApplication, memberApplication] = await Promise.all([
    x.approveFor(primary.personId), x.approveFor(member.personId),
  ]);
  const cycle = await x.service.createCycle(x.roomId, cycleInput(primary.personId), audit);
  await activate(x.service, cycle, primaryApplication);
  const invited = await x.service.createOccupancy(
    memberInput(x.roomId, cycle.cycleId, member.personId), audit,
  );
  await activate(x.service, invited, memberApplication);
  const primaryRows = await x.residentService("user-read-primary").listOccupancies(x.roomId);
  assert.equal(primaryRows.data.length, 2);
  assert.ok(primaryRows.data.every((o) => !("identityApplicationId" in o)));
  const memberRows = await x.residentService("user-read-member").listOccupancies(x.roomId);
  assert.equal(memberRows.data.length, 1);
  assert.equal(memberRows.data[0].personId, member.personId);
  await x.service.end(cycle.occupancyId, {
    expectedRevision: 2, reason: "历史可见性退租", endsAt: 1_000_000,
  }, audit);
  const formerPrimary = await x.residentService("user-read-primary").listOccupancies(x.roomId);
  assert.equal(formerPrimary.data.length, 1); // loses room-wide view, keeps self history
  assert.equal(formerPrimary.data[0].personId, primary.personId);
  const formerMember = await x.residentService("user-read-member").listOccupancies(x.roomId);
  assert.equal(formerMember.data.length, 1);
  assert.equal(formerMember.data[0].effectiveState, "ended");
  const otherOrg = new OccupancyService(x.store, "org-b");
  await assert.rejects(otherOrg.createCycle(x.roomId, cycleInput(primary.personId), audit),
    (e) => e.status === 404);
  await assert.rejects(otherOrg.listOccupancies(x.roomId), (e) => e.status === 404);
});

test("effective primary sponsors no-account profiles and masked member verification without admin powers", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "代理主租客" }, audit);
  const userId = "user-proxy-primary";
  await x.bindUser(primary.personId, userId);
  const primaryApplication = await x.approveFor(primary.personId);
  const cycle = await x.service.createCycle(x.roomId, cycleInput(primary.personId), audit);
  await activate(x.service, cycle, primaryApplication);
  const userAudit = {
    actor: "resident", actorId: userId, actorType: "user", action: "主租客代理测试",
  };
  const resident = x.residentService(userId);
  const residentPersons = new PersonService(x.store, "org-a", { userId }, {
    sponsorAccess: resident,
  });
  const residentVerification = new VerificationService(
    x.store, "org-a", { userId }, {
      identity: new IdentityService(x.store, { hmacKey: "test-occupancy-key-0123456789" }),
      encryptionKey: KEY,
      fileValidator: async () => true,
      sponsorAccess: resident,
    },
  );

  const otherPrimary = await x.persons.createPerson({ name: "其他房主租客" }, audit);
  const otherApplication = await x.approveFor(otherPrimary.personId);
  const otherCycle = await x.service.createCycle(
    x.otherRoomId, cycleInput(otherPrimary.personId), audit,
  );
  await activate(x.service, otherCycle, otherApplication);
  const personsBeforeCrossRoom = (await x.store.list("persons", "org-a")).length;
  await assert.rejects(residentPersons.createPerson({
    name: "跨房代建", occupancyId: otherCycle.occupancyId,
  }, userAudit), (e) => e.code === "SPONSOR_INACTIVE");
  assert.equal((await x.store.list("persons", "org-a")).length, personsBeforeCrossRoom);

  const member = await residentPersons.createPerson({
    name: "无账号家庭成员", occupancyId: cycle.occupancyId,
  }, userAudit);
  const memberRow = (await x.store.list("persons", "org-a"))
    .find((p) => p._id === member.personId);
  assert.equal(memberRow.userId, null);
  assert.equal(memberRow.createdBy, userId);
  const invited = await resident.createOccupancy(
    memberInput(x.roomId, cycle.cycleId, member.personId), userAudit,
  );
  const draft = await residentVerification.createApplication({
    personId: member.personId, documentType: "id-card", occupancyId: invited.occupancyId,
  }, userAudit);
  assert.equal(draft.revision, 1);
  const masked = await residentVerification.getApplication(draft.applicationId, userAudit);
  assert.equal(masked.personId, member.personId);
  assert.equal(masked.submittedBy, userId);
  assert.ok(!("identityDigest" in masked) && !("nameCiphertext" in masked));

  const outsider = await x.persons.createPerson({ name: "非本周期人员" }, audit);
  const applicationsBeforeMismatch = (await x.store.list("identity_applications", "org-a")).length;
  await assert.rejects(residentVerification.createApplication({
    personId: outsider.personId, documentType: "id-card", occupancyId: invited.occupancyId,
  }, userAudit), (e) => e.code === "FORBIDDEN");
  assert.equal((await x.store.list("identity_applications", "org-a")).length,
    applicationsBeforeMismatch);

  const submitted = await residentVerification.submit(draft.applicationId, {
    expectedRevision: masked.revision,
    document: { name: "无账号家庭成员", documentNumber: "110101199001019876" },
    fileIds: ["file-proxy-member"],
  }, userAudit);
  assert.equal(submitted.revision, 2);
  const reviewView = await x.verificationReviewer.getApplication(draft.applicationId);
  await x.verificationReviewer.review(draft.applicationId, {
    decision: "approve", reason: "成员材料审核通过",
    expectedRevision: reviewView.revision, documentVersion: reviewView.documentVersion,
  }, reviewerAudit);
  await assert.rejects(residentVerification.review(draft.applicationId, {
    decision: "approve", reason: "主租客越权审核",
    expectedRevision: reviewView.revision, documentVersion: reviewView.documentVersion,
  }, userAudit), (e) => e.code === "FORBIDDEN");
  await assert.rejects(residentVerification.readPrivate(draft.applicationId, userAudit),
    (e) => e.code === "FORBIDDEN");
  assert.equal((await activate(x.service, invited, draft.applicationId)).effectiveState, "active");

  // Keep a genuine draft so post-checkout submission proves both rollback and
  // immediate loss of sponsor capability, rather than merely a state conflict.
  const pendingPerson = await residentPersons.createPerson({
    name: "退租前待审成员", occupancyId: cycle.occupancyId,
  }, userAudit);
  const pendingInvite = await resident.createOccupancy(
    memberInput(x.roomId, cycle.cycleId, pendingPerson.personId), userAudit,
  );
  const pendingDraft = await residentVerification.createApplication({
    personId: pendingPerson.personId, documentType: "id-card",
    occupancyId: pendingInvite.occupancyId,
  }, userAudit);
  await x.service.end(cycle.occupancyId, {
    expectedRevision: 2, reason: "代理权限退租测试", endsAt: 1_000_000,
  }, audit);
  const personsBeforeFailure = (await x.store.list("persons", "org-a")).length;
  const privateBeforeFailure = (await x.store.list("identity_private", "org-a")).length;
  await assert.rejects(residentPersons.createPerson({
    name: "退租后禁止代建", occupancyId: cycle.occupancyId,
  }, userAudit), (e) => e.code === "SPONSOR_INACTIVE");
  await assert.rejects(residentVerification.submit(pendingDraft.applicationId, {
    expectedRevision: 1,
    document: { name: "退租前待审成员", documentNumber: "110101199001019877" },
    fileIds: ["file-after-checkout"],
  }, userAudit), (e) => e.code === "SPONSOR_INACTIVE");
  assert.equal((await x.store.list("persons", "org-a")).length, personsBeforeFailure);
  assert.equal((await x.store.list("identity_private", "org-a")).length, privateBeforeFailure);
  const stillDraft = await x.verificationAdmin.getApplication(pendingDraft.applicationId);
  assert.equal(stillDraft.state, "draft");
  assert.equal(stillDraft.revision, 1);
  await assert.rejects(residentVerification.getApplication(draft.applicationId, userAudit),
    (e) => e.code === "SPONSOR_INACTIVE");
});

test("F01 activation rejects disabled or missing bound accounts and still supports no-account persons", async (t) => {
  const x = await setup(t);
  const disabled = await x.persons.createPerson({ name: "停用账号住户" }, audit);
  await x.bindUser(disabled.personId, "user-activation-disabled");
  await x.setUserStatus("user-activation-disabled", "disabled");
  const disabledApplication = await x.approveFor(disabled.personId);
  const disabledCycle = await x.service.createCycle(x.roomId, cycleInput(disabled.personId), audit);
  await assert.rejects(activate(x.service, disabledCycle, disabledApplication),
    (e) => e.code === "USER_DISABLED");

  const missing = await x.persons.createPerson({ name: "缺失账号住户" }, audit);
  await x.bindUser(missing.personId, "user-activation-missing", { createUser: false });
  const missingApplication = await x.approveFor(missing.personId);
  const missingCycle = await x.service.createCycle(x.roomId, cycleInput(missing.personId), audit);
  await assert.rejects(activate(x.service, missingCycle, missingApplication),
    (e) => e.code === "USER_DISABLED");
  const pendingRows = (await x.store.list("occupancies", "org-a"))
    .filter((o) => [disabledCycle.occupancyId, missingCycle.occupancyId].includes(o._id));
  assert.ok(pendingRows.every((o) => o.state === "pending_review" && o.activatedAt === undefined));
  assert.equal((await x.store.list("room_primary_slots", "org-a")).length, 0);

  const normal = await x.persons.createPerson({ name: "正常账号住户" }, audit);
  await x.bindUser(normal.personId, "user-activation-active");
  const normalApplication = await x.approveFor(normal.personId);
  const normalCycle = await x.service.createCycle(x.roomId, cycleInput(normal.personId), audit);
  assert.equal((await activate(x.service, normalCycle, normalApplication)).effectiveState, "active");

  const child = await x.persons.createPerson({ name: "无账号儿童" }, audit);
  const childApplication = await x.approveFor(child.personId);
  const childCycle = await x.service.createCycle(x.otherRoomId, cycleInput(child.personId), audit);
  assert.equal((await activate(x.service, childCycle, childApplication)).effectiveState, "active");
  assert.equal((await x.store.list("persons", "org-a"))
    .find((p) => p._id === child.personId).userId, null);
});

test("F01 disabling a primary account closes invites proxy writes and resident reads without new business writes", async (t) => {
  const x = await setup(t);
  const userId = "user-disabled-primary";
  const primary = await x.persons.createPerson({ name: "待停用主租客" }, audit);
  const member = await x.persons.createPerson({ name: "代理资料成员" }, audit);
  const otherMember = await x.persons.createPerson({ name: "停用后邀请成员" }, audit);
  await x.bindUser(primary.personId, userId);
  const primaryApplication = await x.approveFor(primary.personId);
  const cycle = await x.service.createCycle(x.roomId, cycleInput(primary.personId), audit);
  await activate(x.service, cycle, primaryApplication);
  const resident = x.residentService(userId);
  const userAudit = { actor: "resident", actorId: userId, actorType: "user", action: "停用账号测试" };
  const invited = await resident.createOccupancy(
    memberInput(x.roomId, cycle.cycleId, member.personId), userAudit,
  );
  const residentPersons = new PersonService(x.store, "org-a", { userId }, {
    sponsorAccess: resident,
  });
  const residentVerification = new VerificationService(x.store, "org-a", { userId }, {
    identity: new IdentityService(x.store, { hmacKey: "test-occupancy-key-0123456789" }),
    encryptionKey: KEY, fileValidator: async () => true, sponsorAccess: resident,
  });
  const draft = await residentVerification.createApplication({
    personId: member.personId, documentType: "id-card", occupancyId: invited.occupancyId,
  }, userAudit);
  await x.setUserStatus(userId, "disabled");
  const before = {
    persons: (await x.store.list("persons", "org-a")).length,
    occupancies: (await x.store.list("occupancies", "org-a")).length,
    applications: (await x.store.list("identity_applications", "org-a")).length,
    privateRows: (await x.store.list("identity_private", "org-a")).length,
  };
  await assert.rejects(resident.createOccupancy(
    memberInput(x.roomId, cycle.cycleId, otherMember.personId), userAudit,
  ), (e) => e.code === "USER_DISABLED");
  await assert.rejects(residentPersons.createPerson({
    name: "停用后代建", occupancyId: cycle.occupancyId,
  }, userAudit), (e) => e.code === "USER_DISABLED");
  await assert.rejects(residentVerification.createApplication({
    personId: member.personId, documentType: "id-card", occupancyId: invited.occupancyId,
  }, userAudit), (e) => e.code === "USER_DISABLED");
  await assert.rejects(residentVerification.submit(draft.applicationId, {
    expectedRevision: 1,
    document: { name: "代理资料成员", documentNumber: "110101199001019878" },
    fileIds: ["file-disabled-account"],
  }, userAudit), (e) => e.code === "USER_DISABLED");
  await assert.rejects(residentVerification.getApplication(draft.applicationId, userAudit),
    (e) => e.code === "USER_DISABLED");
  await assert.rejects(resident.listOccupancies(x.roomId), (e) => e.code === "USER_DISABLED");
  assert.deepEqual({
    persons: (await x.store.list("persons", "org-a")).length,
    occupancies: (await x.store.list("occupancies", "org-a")).length,
    applications: (await x.store.list("identity_applications", "org-a")).length,
    privateRows: (await x.store.list("identity_private", "org-a")).length,
  }, before);
  assert.equal((await x.store.list("identity_applications", "org-a"))
    .find((a) => a._id === draft.applicationId).state, "draft");
  assert.equal((await x.service.listOccupancies(x.roomId)).data
    .find((o) => o.occupancyId === cycle.occupancyId).effectiveState, "active");
});

test("F02 create-only blacklist requires a scoped review before a primary cycle exists", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "创建复核主租客" }, audit);
  const applicationId = await x.approveFor(primary.personId);
  const entry = await x.reviewerBlacklist.createEntry({
    subjectType: "person", personId: primary.personId, reason: "创建阶段复核",
    evidenceFileIds: [], restrictions: ["occupancy.create"], startsAt: 1_000_000, endsAt: null,
  }, reviewerAudit);
  const blocked = await x.service.createCycle(x.roomId, cycleInput(primary.personId), audit)
    .catch((e) => e);
  assert.equal(blocked.code, "BLACKLIST_REVIEW_REQUIRED");
  assert.equal(blocked.restriction, "occupancy.create");
  assert.ok(blocked.occupancyId);
  assert.equal((await x.store.list("occupancy_cycles", "org-a")).length, 0);
  assert.equal((await x.store.list("occupancies", "org-a")).length, 0);
  await x.reviewerBlacklist.reviewOccupancy(blocked.occupancyId, {
    restriction: "occupancy.create", decision: "allow", reason: "允许本次创建",
    entryIds: [entry.entryId], entryRevisions: [1],
  }, reviewerAudit);
  const created = await x.service.createCycle(x.roomId, cycleInput(primary.personId, {
    occupancyId: blocked.occupancyId,
  }), audit);
  assert.equal(created.occupancyId, blocked.occupancyId);
  assert.equal((await activate(x.service, created, applicationId)).effectiveState, "active");
});

test("F02 create and activate allows are independent when both restrictions hit", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "双重名单主租客" }, audit);
  const applicationId = await x.approveFor(primary.personId);
  const entry = await x.reviewerBlacklist.createEntry({
    subjectType: "person", personId: primary.personId, reason: "创建与激活均复核",
    evidenceFileIds: [], restrictions: ["occupancy.create", "occupancy.activate"],
    startsAt: 1_000_000, endsAt: null,
  }, reviewerAudit);
  const blocked = await x.service.createCycle(x.roomId, cycleInput(primary.personId), audit)
    .catch((e) => e);
  assert.equal(blocked.code, "BLACKLIST_REVIEW_REQUIRED");
  await x.reviewerBlacklist.reviewOccupancy(blocked.occupancyId, {
    restriction: "occupancy.create", decision: "allow", reason: "仅放行创建",
    entryIds: [entry.entryId], entryRevisions: [1],
  }, reviewerAudit);
  const created = await x.service.createCycle(x.roomId, cycleInput(primary.personId, {
    occupancyId: blocked.occupancyId,
  }), audit);
  await assert.rejects(activate(x.service, created, applicationId),
    (e) => e.code === "BLACKLIST_REVIEW_REQUIRED");
  assert.equal((await x.store.list("room_primary_slots", "org-a")).length, 0);
  await x.reviewerBlacklist.reviewOccupancy(created.occupancyId, {
    decision: "allow", reason: "单独放行激活",
    entryIds: [entry.entryId], entryRevisions: [1],
  }, reviewerAudit);
  assert.equal((await activate(x.service, created, applicationId)).effectiveState, "active");
  const heads = (await x.store.list("blacklist_decisions", "org-a"))
    .filter((d) => d.recordType === "current" && d.occupancyId === created.occupancyId);
  assert.equal(heads.length, 2);
  assert.deepEqual(new Set(heads.map((d) => d.restriction)),
    new Set(["occupancy.create", "occupancy.activate"]));
});

test("F02 member invitation and primary transfer enforce create review without ending the old cycle on failure", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "创建检查旧主租" }, audit);
  const member = await x.persons.createPerson({ name: "创建检查成员" }, audit);
  const nextPrimary = await x.persons.createPerson({ name: "创建检查新主租" }, audit);
  const [primaryApplication, memberApplication, nextApplication] = await Promise.all([
    x.approveFor(primary.personId), x.approveFor(member.personId), x.approveFor(nextPrimary.personId),
  ]);
  const cycle = await x.service.createCycle(x.roomId, cycleInput(primary.personId), audit);
  const activePrimary = await activate(x.service, cycle, primaryApplication);
  const memberEntry = await x.reviewerBlacklist.createEntry({
    subjectType: "person", personId: member.personId, reason: "成员创建复核",
    evidenceFileIds: [], restrictions: ["occupancy.create"], startsAt: 1_000_000, endsAt: null,
  }, reviewerAudit);
  const memberBlocked = await x.service.createOccupancy(
    memberInput(x.roomId, cycle.cycleId, member.personId), audit,
  ).catch((e) => e);
  assert.equal(memberBlocked.code, "BLACKLIST_REVIEW_REQUIRED");
  assert.equal(memberBlocked.restriction, "occupancy.create");
  await x.reviewerBlacklist.reviewOccupancy(memberBlocked.occupancyId, {
    restriction: "occupancy.create", decision: "allow", reason: "允许成员邀请",
    entryIds: [memberEntry.entryId], entryRevisions: [1],
  }, reviewerAudit);
  await assert.rejects(x.service.createOccupancy(memberInput(
    x.roomId, cycle.cycleId, member.personId,
    { occupancyId: memberBlocked.occupancyId, endsAt: 2_000_000 },
  ), audit), (e) => e.code === "OCCUPANCY_APPLICATION_CONFLICT");
  assert.equal((await x.store.list("occupancies", "org-a")).length, 1);
  const invited = await x.service.createOccupancy(memberInput(
    x.roomId, cycle.cycleId, member.personId, { occupancyId: memberBlocked.occupancyId },
  ), audit);
  await activate(x.service, invited, memberApplication);

  const nextEntry = await x.reviewerBlacklist.createEntry({
    subjectType: "person", personId: nextPrimary.personId, reason: "换租创建复核",
    evidenceFileIds: [], restrictions: ["occupancy.create"], startsAt: 1_000_000, endsAt: null,
  }, reviewerAudit);
  const currentCycle = (await x.store.list("occupancy_cycles", "org-a"))
    .find((c) => c._id === cycle.cycleId);
  const nextPerson = (await x.store.list("persons", "org-a"))
    .find((p) => p._id === nextPrimary.personId);
  const transferInput = {
    occupancyId: cycle.occupancyId, cycleId: cycle.cycleId,
    expectedRevision: activePrimary.revision, expectedCycleRevision: currentCycle.revision,
    newPrimaryPersonId: nextPrimary.personId, newPersonExpectedRevision: nextPerson.revision,
    reason: "创建限制换租", oldEndsAt: 1_000_000, startsAt: 1_000_000, endsAt: null,
  };
  const transferBlocked = await x.service.transferPrimary(x.roomId, transferInput, audit)
    .catch((e) => e);
  assert.equal(transferBlocked.code, "BLACKLIST_REVIEW_REQUIRED");
  assert.equal(transferBlocked.restriction, "occupancy.create");
  assert.equal((await x.store.list("occupancies", "org-a"))
    .find((o) => o._id === cycle.occupancyId).state, "active");
  assert.equal((await x.store.list("occupancy_cycles", "org-a")).length, 1);
  assert.equal((await x.store.list("occupancy_materializations", "org-a")).length, 0);
  await x.reviewerBlacklist.reviewOccupancy(transferBlocked.occupancyId, {
    restriction: "occupancy.create", decision: "allow", reason: "允许换租新周期",
    entryIds: [nextEntry.entryId], entryRevisions: [1],
  }, reviewerAudit);
  await assert.rejects(x.service.transferPrimary(x.roomId, {
    ...transferInput, newOccupancyId: transferBlocked.occupancyId, startsAt: 1_000_001,
  }, audit), (e) => e.code === "OCCUPANCY_APPLICATION_CONFLICT");
  assert.equal((await x.store.list("occupancies", "org-a"))
    .find((o) => o._id === cycle.occupancyId).state, "active");
  assert.equal((await x.store.list("occupancy_cycles", "org-a")).length, 1);
  const transferred = await x.service.transferPrimary(x.roomId, {
    ...transferInput, newOccupancyId: transferBlocked.occupancyId,
  }, audit);
  assert.equal(transferred.occupancyId, transferBlocked.occupancyId);
  assert.equal(transferred.storedState, "pending_review");
  assert.equal((await activate(x.service, transferred, nextApplication)).effectiveState, "active");
});

test("F02 a create rule committed after eligibility pre-read invalidates the creation snapshot", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "创建竞态住户" }, audit);
  const internal = x.service.blacklist;
  const original = internal.prepareEligibility.bind(internal);
  let readyResolve;
  let resume;
  let once = true;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const gate = new Promise((resolve) => { resume = resolve; });
  internal.prepareEligibility = async (request) => {
    const token = await original(request);
    if (request.restriction === "occupancy.create" && once) {
      once = false;
      readyResolve();
      await gate;
    }
    return token;
  };
  const outcome = x.service.createCycle(x.roomId, cycleInput(primary.personId), audit)
    .catch((e) => e);
  await ready;
  await x.reviewerBlacklist.createEntry({
    subjectType: "person", personId: primary.personId, reason: "预读后新增创建限制",
    evidenceFileIds: [], restrictions: ["occupancy.create"], startsAt: 1_000_000, endsAt: null,
  }, reviewerAudit);
  resume();
  const blocked = await outcome;
  internal.prepareEligibility = original;
  assert.equal(blocked.code, "BLACKLIST_REVIEW_REQUIRED");
  assert.equal(blocked.restriction, "occupancy.create");
  assert.ok(blocked.occupancyId);
  assert.equal((await x.store.list("occupancy_cycles", "org-a")).length, 0);
  assert.equal((await x.store.list("occupancies", "org-a")).length, 0);
});

test("F03 persists the reviewed request and rejects changed person room period or replay", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "持久申请主租客" }, audit);
  const other = await x.persons.createPerson({ name: "替换人员" }, audit);
  const entry = await x.reviewerBlacklist.createEntry({
    subjectType: "person", personId: primary.personId, reason: "绑定请求复核",
    evidenceFileIds: [], restrictions: ["occupancy.create"], startsAt: 1_000_000, endsAt: null,
  }, reviewerAudit);
  await assert.rejects(x.reviewerBlacklist.reviewOccupancy("review-before-record", {
    restriction: "occupancy.create", decision: "allow", reason: "裸 ID 不得复核",
    entryIds: [entry.entryId], entryRevisions: [1],
  }, reviewerAudit), (e) => e.code === "NOT_FOUND");

  const body = cycleInput(primary.personId);
  const blocked = await x.service.createCycle(x.roomId, body, audit).catch((e) => e);
  assert.equal(blocked.code, "BLACKLIST_REVIEW_REQUIRED");
  const pending = (await x.store.list("occupancy_applications", "org-a"))
    .find((a) => a._id === blocked.occupancyId);
  assert.equal(pending.state, "pending_review");
  assert.equal(pending.revision, 1);
  assert.equal(pending.requestVersion, 1);
  assert.equal(pending.personId, primary.personId);
  assert.equal(pending.roomId, x.roomId);
  assert.equal(pending.cycleId, null);
  assert.equal(pending.role, "primary");
  assert.deepEqual(pending.request, {
    action: "occupancy-cycle.create", roomId: x.roomId, personId: primary.personId,
    role: "primary", startsAt: 1_000_000, endsAt: null,
  });
  assert.equal((await x.store.list("occupancies", "org-a")).length, 0);

  const reviewed = await x.reviewerBlacklist.reviewOccupancy(blocked.occupancyId, {
    restriction: "occupancy.create", decision: "allow", reason: "仅放行原请求",
    entryIds: [entry.entryId], entryRevisions: [1],
  }, reviewerAudit);
  assert.equal(reviewed.requestVersion, 1);
  const head = (await x.store.list("blacklist_decisions", "org-a"))
    .find((d) => d.recordType === "current" && d.occupancyId === blocked.occupancyId);
  assert.equal(head.requestDigest, pending.requestDigest);
  assert.equal(head.requestVersion, 1);
  assert.equal(head.applicationRevision, 1);

  await assert.rejects(x.service.createCycle(x.otherRoomId, {
    ...body, occupancyId: blocked.occupancyId,
  }, audit), (e) => e.code === "OCCUPANCY_APPLICATION_CONFLICT");
  await assert.rejects(x.service.createCycle(x.roomId, {
    ...body, primaryPersonId: other.personId, occupancyId: blocked.occupancyId,
  }, audit), (e) => e.code === "OCCUPANCY_APPLICATION_CONFLICT");
  await assert.rejects(x.service.createCycle(x.roomId, {
    ...body, endsAt: 2_000_000, occupancyId: blocked.occupancyId,
  }, audit), (e) => e.code === "OCCUPANCY_APPLICATION_CONFLICT");
  assert.equal((await x.store.list("occupancy_cycles", "org-a")).length, 0);

  const created = await x.service.createCycle(x.roomId, {
    ...body, occupancyId: blocked.occupancyId,
  }, audit);
  assert.equal(created.occupancyId, blocked.occupancyId);
  const consumed = (await x.store.list("occupancy_applications", "org-a"))
    .find((a) => a._id === blocked.occupancyId);
  assert.equal(consumed.state, "consumed");
  assert.equal(consumed.consumedDecisionId, reviewed.decisionId);
  assert.equal(consumed.revision, 3);
  await assert.rejects(x.reviewerBlacklist.reviewOccupancy(blocked.occupancyId, {
    restriction: "occupancy.create", decision: "allow", reason: "不得重复复核已消费申请",
    entryIds: [entry.entryId], entryRevisions: [1],
  }, reviewerAudit), (e) => e.code === "INVALID_STATE");
});

test("F03 create review requires the complete current person and bound-user hit set", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "完整名单主租客" }, audit);
  await x.bindUser(primary.personId, "user-full-create-review");
  const personEntry = await x.reviewerBlacklist.createEntry({
    subjectType: "person", personId: primary.personId, reason: "人员限制",
    evidenceFileIds: [], restrictions: ["occupancy.create"], startsAt: 1_000_000, endsAt: null,
  }, reviewerAudit);
  const userEntry = await x.reviewerBlacklist.createEntry({
    subjectType: "user", userId: "user-full-create-review", reason: "账号限制",
    evidenceFileIds: [], restrictions: ["occupancy.create"], startsAt: 1_000_000, endsAt: null,
  }, reviewerAudit);
  const body = cycleInput(primary.personId);
  const blocked = await x.service.createCycle(x.roomId, body, audit).catch((e) => e);
  assert.equal(blocked.code, "BLACKLIST_REVIEW_REQUIRED");
  await assert.rejects(x.reviewerBlacklist.reviewOccupancy(blocked.occupancyId, {
    restriction: "occupancy.create", decision: "allow", reason: "漏掉账号名单",
    entryIds: [personEntry.entryId], entryRevisions: [1],
  }, reviewerAudit), (e) => e.code === "REVISION_CONFLICT");
  assert.equal((await x.store.list("blacklist_decisions", "org-a")).length, 0);
  assert.equal((await x.store.list("occupancy_applications", "org-a"))
    .find((a) => a._id === blocked.occupancyId).state, "pending_review");

  await x.reviewerBlacklist.reviewOccupancy(blocked.occupancyId, {
    restriction: "occupancy.create", decision: "allow", reason: "完整名单放行",
    entryIds: [personEntry.entryId, userEntry.entryId], entryRevisions: [1, 1],
  }, reviewerAudit);
  const created = await x.service.createCycle(x.roomId, {
    ...body, occupancyId: blocked.occupancyId,
  }, audit);
  assert.equal(created.occupancyId, blocked.occupancyId);
});

test("F03 legacy unbound allows fail closed and an approved application is consumed once", async (t) => {
  const x = await setup(t);
  const primary = await x.persons.createPerson({ name: "旧放行兼容主租客" }, audit);
  const entry = await x.reviewerBlacklist.createEntry({
    subjectType: "person", personId: primary.personId, reason: "旧决定兼容",
    evidenceFileIds: [], restrictions: ["occupancy.create"], startsAt: 1_000_000, endsAt: null,
  }, reviewerAudit);
  const occupancyId = "legacy-create-allow";
  await x.store.transact([{
    collection: "blacklist_decisions",
    id: blacklistDecisionHeadId("org-a", occupancyId, "occupancy.create"),
  }], () => [{
    collection: "blacklist_decisions",
    id: blacklistDecisionHeadId("org-a", occupancyId, "occupancy.create"),
    data: {
      orgId: "org-a", occupancyId, restriction: "occupancy.create", recordType: "current",
      latestDecisionId: "legacy-decision", entryIds: [entry.entryId], entryRevisions: [1],
      decision: "allow", expiresAt: null, revision: 1,
    },
  }], reviewerAudit);
  const body = cycleInput(primary.personId, { occupancyId });
  const blocked = await x.service.createCycle(x.roomId, body, audit).catch((e) => e);
  assert.equal(blocked.code, "BLACKLIST_REVIEW_REQUIRED");
  assert.equal((await x.store.list("occupancy_applications", "org-a"))
    .find((a) => a._id === occupancyId).state, "pending_review");
  assert.equal((await x.store.list("occupancies", "org-a")).length, 0);

  await x.reviewerBlacklist.reviewOccupancy(occupancyId, {
    restriction: "occupancy.create", decision: "allow", reason: "重新绑定请求后放行",
    entryIds: [entry.entryId], entryRevisions: [1],
  }, reviewerAudit);
  const outcomes = await Promise.allSettled([
    x.service.createCycle(x.roomId, body, audit),
    x.service.createCycle(x.roomId, body, audit),
  ]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  assert.equal(outcomes.find((o) => o.status === "rejected").reason.code, "DUPLICATE_OCCUPANCY");
  assert.equal((await x.store.list("occupancies", "org-a")).length, 1);
  assert.equal((await x.store.list("occupancy_cycles", "org-a")).length, 1);
  assert.equal((await x.store.list("occupancy_applications", "org-a"))
    .find((a) => a._id === occupancyId).state, "consumed");
});
