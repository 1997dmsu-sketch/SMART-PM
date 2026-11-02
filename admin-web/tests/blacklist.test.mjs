import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { LocalStore } from "../lib/store.mjs";
import { OrgService } from "../lib/org.mjs";
import { PersonService } from "../lib/persons.mjs";
import { IdentityService } from "../lib/identity.mjs";
import { VerificationService } from "../lib/verification.mjs";
import { BlacklistService, eligibilityGuardId } from "../lib/blacklist.mjs";

const KEY = Buffer.alloc(32, 3);
const adminAudit = { actor: "admin", actorId: "acc-admin", action: "黑名单测试" };
const managerAudit = { actor: "manager", actorId: "acc-manager", action: "维护黑名单" };
const reviewerAudit = { actor: "reviewer", actorId: "acc-reviewer", action: "复核黑名单" };
const readerAudit = { actor: "reader", actorId: "acc-reader", action: "读取黑名单" };
const gateway = {
  async verifyPhone(c) { return c.phone; },
  async fetchWechatSubject(code) { return { appId: "wx-demo-app", openid: `openid-${code}` }; },
};
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-blacklist-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  const orgs = new OrgService(store);
  await orgs.bootstrap({ id: "org-a", name: "组织A", adminAccountIds: ["acc-admin"] }, adminAudit);
  await orgs.bootstrap({ id: "org-b", name: "组织B", adminAccountIds: ["acc-b"] }, adminAudit);
  for (const [principalId, permissions] of [
    ["acc-manager", ["blacklist.manage", "blacklist.read"]],
    ["acc-reviewer", ["blacklist.review", "blacklist.read", "identity.review", "identity.readPrivate"]],
    ["acc-reader", ["blacklist.read"]],
  ]) {
    await orgs.grantMembership({
      orgId: "org-a", principalType: "adminAccount", principalId, role: "admin", permissions,
    }, adminAudit);
  }
  const memberships = await store.list("org_memberships");
  const mem = (principalId) => memberships.find((m) => m.orgId === "org-a" && m.principalId === principalId)._id;
  let clock = 1000;
  const validations = [];
  const makeService = (membershipId = null, orgId = "org-a", extra = {}) =>
    new BlacklistService(store, orgId, membershipId ? { membershipId } : null, {
      fileValidator: async (fileIds, context) => { validations.push({ fileIds, context }); return true; },
      now: () => clock,
      ...extra,
    });
  const manager = makeService(mem("acc-manager"));
  const reviewer = makeService(mem("acc-reviewer"));
  const reader = makeService(mem("acc-reader"));
  const unprivileged = makeService(mem("acc-admin"));
  const internal = makeService();
  const otherOrg = makeService(null, "org-b");
  const persons = new PersonService(store, "org-a", { membershipId: mem("acc-admin") });
  const personsB = new PersonService(store, "org-b");
  const identity = new IdentityService(store, { hmacKey: "test-identity-key-0123456789", gateway });
  const verificationAdmin = new VerificationService(store, "org-a", { membershipId: mem("acc-admin") }, {
    identity, encryptionKey: KEY, fileValidator: async () => true,
  });
  const verificationReviewer = new VerificationService(store, "org-a", { membershipId: mem("acc-reviewer") }, {
    identity, encryptionKey: KEY, fileValidator: async () => true,
  });
  let documentSequence = 0;
  const approveFor = async (personId) => {
    const { applicationId } = await verificationAdmin.createApplication(
      { personId, documentType: "id-card" }, adminAudit,
    );
    const draft = await verificationAdmin.getApplication(applicationId);
    await verificationAdmin.submit(applicationId, {
      expectedRevision: draft.revision,
      document: { name: "测试住户", documentNumber: `11010119900101${1000 + documentSequence++}` },
      fileIds: ["file-identity-test"],
    }, adminAudit);
    const submitted = await verificationReviewer.getApplication(applicationId);
    await verificationReviewer.review(applicationId, {
      decision: "approve", reason: "测试通过", expectedRevision: submitted.revision, documentVersion: 1,
    }, reviewerAudit);
    return applicationId;
  };
  const bindUser = async (personId, userId) => {
    await store.transact([{ collection: "persons", id: personId }], (state) => [{
      collection: "persons", id: personId,
      data: { userId, revision: state[`persons/${personId}`].revision + 1 },
    }], adminAudit);
  };
  return {
    store, orgs, persons, personsB, manager, reviewer, reader, unprivileged, internal, otherOrg,
    identity, verificationAdmin, verificationReviewer,
    makeService, approveFor, bindUser, validations,
    setClock: (value) => { clock = value; },
  };
}
const entryInput = (personId, extra = {}) => ({
  subjectType: "person",
  personId,
  reasonCode: "manual-review",
  reason: "历史纠纷，需人工复核",
  evidenceFileIds: [],
  restrictions: ["occupancy.activate"],
  startsAt: 1000,
  endsAt: null,
  ...extra,
});
// A test-only activation probe: it writes a unique claim, never an occupancy,
// user binding or device record. It exercises the exact DB-05 transaction hook.
async function probeActivate(service, { personId, occupancyId, identityApplicationId = null,
  claimId = `activation-probe-${randomUUID()}` }) {
  return service.withEligibility({ personId, occupancyId, identityApplicationId }, [
    { collection: "unique_claims", id: claimId },
  ], (state, eligibility) => ({
    writes: [{
      collection: "unique_claims",
      id: claimId,
      data: {
        orgId: "org-a", namespace: "db06-activation-probe", ownerId: occupancyId,
        state: "bound", schemaVersion: 2, revision: 1, createdAt: Date.now(),
      },
    }],
    result: { ...eligibility, claimId },
  }), adminAudit);
}

test("blacklist permissions are explicit; evidence validation and sensitive list audit work", async (t) => {
  const { store, persons, manager, reader, unprivileged, validations } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  await assert.rejects(unprivileged.createEntry(entryInput(person.personId), adminAudit),
    (e) => e.code === "FORBIDDEN" && e.status === 403);
  await assert.rejects(unprivileged.listEntries({}, adminAudit), (e) => e.code === "FORBIDDEN");
  const created = await manager.createEntry(entryInput(person.personId, {
    evidenceFileIds: ["evidence-test-1"],
  }), managerAudit);
  assert.equal(created.revision, 1);
  assert.deepEqual(validations[0], {
    fileIds: ["evidence-test-1"],
    context: { orgId: "org-a", purpose: "blacklist-evidence" },
  });
  const listed = await reader.listEntries({}, readerAudit);
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].personId, person.personId);
  assert.equal(listed.data[0].effectiveState, "active");
  assert.ok(!("subjectKey" in listed.data[0]));
  assert.deepEqual(listed.data[0].evidenceFileIds, ["evidence-test-1"]);
  assert.ok((await store.list("admin_audit")).some((a) => a.action === "读取内部黑名单"));
  const guard = (await store.list("eligibility_guards"))
    .find((g) => g._id === eligibilityGuardId("org-a", "person", person.personId));
  assert.equal(guard.epoch, 1);
});

test("user and identity subjects use org-owned references and never expose identity digests", async (t) => {
  const { store, persons, manager, reviewer, approveFor, bindUser } = await setup(t);
  const bound = await persons.createPerson({ name: "绑定住户" }, adminAudit);
  await bindUser(bound.personId, "user-bound-1");
  await manager.createEntry({ subjectType: "user", userId: "user-bound-1",
    reason: "账号复核", evidenceFileIds: [], restrictions: ["occupancy.activate"] }, managerAudit);
  const verified = await persons.createPerson({ name: "实名住户" }, adminAudit);
  const applicationId = await approveFor(verified.personId);
  await manager.createEntry({ subjectType: "identity", applicationId,
    reason: "身份复核", evidenceFileIds: [], restrictions: ["occupancy.activate"] }, managerAudit);
  await assert.rejects(manager.createEntry({ subjectType: "user", userId: "global-unbound-user",
    reason: "不可猜测全局用户", evidenceFileIds: [], restrictions: ["occupancy.activate"] }, managerAudit),
  (e) => e.code === "NOT_FOUND");
  const draftPerson = await persons.createPerson({ name: "未审住户" }, adminAudit);
  const draftApplication = await (async () => {
    const service = new VerificationService(manager.store, "org-a", null, {
      identity: new IdentityService(manager.store, { hmacKey: "test-identity-key-0123456789", gateway }),
      encryptionKey: KEY, fileValidator: async () => true,
    });
    return service.createApplication({ personId: draftPerson.personId, documentType: "id-card" }, adminAudit);
  })();
  await assert.rejects(manager.createEntry({ subjectType: "identity", applicationId: draftApplication.applicationId,
    reason: "未核验身份", evidenceFileIds: [], restrictions: ["occupancy.activate"] }, managerAudit),
  (e) => e.code === "IDENTITY_NOT_APPROVED");
  const list = await reviewer.listEntries({ limit: 100 }, reviewerAudit);
  assert.equal(list.data.length, 2);
  const identityDto = list.data.find((e) => e.subjectType === "identity");
  assert.equal(identityDto.applicationId, applicationId);
  const raw = (await store.list("blacklist_entries")).find((e) => e.subjectType === "identity");
  assert.ok(raw.subjectKey && !JSON.stringify(identityDto).includes(raw.subjectKey));
  assert.ok(!("subjectKey" in identityDto) && !("identityDigest" in identityDto));
});

test("evidence adapter fails closed and invalid intervals or restrictions write nothing", async (t) => {
  const { store, persons, manager, makeService } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  const noAdapter = makeService(null, "org-a", { fileValidator: null });
  await assert.rejects(noAdapter.createEntry(entryInput(person.personId, {
    evidenceFileIds: ["evidence-unavailable"],
  }), managerAudit), (e) => e.code === "ADAPTER_UNAVAILABLE" && e.status === 503);
  await assert.rejects(manager.createEntry(entryInput(person.personId, {
    restrictions: ["door.unlock"],
  }), managerAudit), (e) => e.code === "PARAM_ERROR");
  await assert.rejects(manager.createEntry(entryInput(person.personId, {
    startsAt: 2000, endsAt: 2000,
  }), managerAudit), (e) => e.code === "PARAM_ERROR");
  assert.equal((await store.list("blacklist_entries")).length, 0);
});

test("revoke checks revision, advances the guard and immediately restores eligibility", async (t) => {
  const { store, persons, manager, internal } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  const { entryId } = await manager.createEntry(entryInput(person.personId), managerAudit);
  await assert.rejects(manager.revokeEntry(entryId, { expectedRevision: 99, reason: "错误版本" }, managerAudit),
    (e) => e.code === "REVISION_CONFLICT");
  await assert.rejects(probeActivate(internal, { personId: person.personId, occupancyId: "occ-revoke" }),
    (e) => e.code === "BLACKLIST_REVIEW_REQUIRED" && !/历史纠纷|evidence/.test(e.message));
  const revoked = await manager.revokeEntry(entryId, { expectedRevision: 1, reason: "复核后解除" }, managerAudit);
  assert.equal(revoked.revision, 2);
  await assert.rejects(manager.revokeEntry(entryId, { expectedRevision: 2, reason: "重复解除" }, managerAudit),
    (e) => e.code === "INVALID_STATE");
  const guard = (await store.list("eligibility_guards"))
    .find((g) => g._id === eligibilityGuardId("org-a", "person", person.personId));
  assert.equal(guard.epoch, 2);
  const eligible = await probeActivate(internal, { personId: person.personId, occupancyId: "occ-revoke" });
  assert.equal(eligible.eligible, true);
});

test("blacklist list paginates before DTO mapping and isolates another organization", async (t) => {
  const { persons, personsB, manager, reader, otherOrg } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  const expected = [];
  for (let i = 0; i < 22; i++) {
    const { entryId } = await manager.createEntry(entryInput(person.personId, { reason: `测试记录${i}` }), managerAudit);
    expected.push(entryId);
  }
  const otherPerson = await personsB.createPerson({ name: "他组织住户" }, adminAudit);
  const other = await otherOrg.createEntry(entryInput(otherPerson.personId), adminAudit);
  const first = await reader.listEntries({}, readerAudit);
  const second = await reader.listEntries({ cursor: first.nextCursor }, readerAudit);
  assert.equal(first.data.length, 20);
  assert.ok(first.nextCursor);
  assert.equal(second.data.length, 2);
  const actual = [...first.data, ...second.data].map((e) => e.entryId);
  assert.equal(new Set(actual).size, 22);
  assert.deepEqual(new Set(actual), new Set(expected));
  assert.ok(!actual.includes(other.entryId));
  const otherList = await otherOrg.listEntries({}, adminAudit);
  assert.deepEqual(otherList.data.map((e) => e.entryId), [other.entryId]);
  await assert.rejects(otherOrg.revokeEntry(expected[0], { expectedRevision: 1, reason: "越组织" }, adminAudit),
    (e) => e.code === "NOT_FOUND");
});

test("eligibility blocks new activation without writing the probe or leaking list details", async (t) => {
  const { store, persons, manager, internal } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  await manager.createEntry(entryInput(person.personId), managerAudit);
  const claimId = "activation-probe-blocked";
  await assert.rejects(probeActivate(internal, {
    personId: person.personId, occupancyId: "occ-blocked", claimId,
  }), (e) => e.code === "BLACKLIST_REVIEW_REQUIRED" && e.status === 409 && !/历史纠纷/.test(e.message));
  assert.equal((await store.list("unique_claims")).some((c) => c._id === claimId), false);
  assert.equal((await store.list("blacklist_decisions")).length, 0);
});

test("a blacklist entry committed after eligibility pre-read forces retry and blocks activation", async (t) => {
  const { store, persons, manager, internal } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  let prepared;
  const ready = new Promise((resolve) => { prepared = resolve; });
  let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  const original = internal.prepareEligibility.bind(internal);
  internal.prepareEligibility = async (request) => {
    const token = await original(request);
    prepared();
    await gate;
    return token;
  };
  const claimId = "activation-probe-race-create";
  const activation = probeActivate(internal, { personId: person.personId, occupancyId: "occ-race-create", claimId });
  await ready;
  await manager.createEntry(entryInput(person.personId), managerAudit);
  resume();
  await assert.rejects(activation, (e) => e.code === "BLACKLIST_REVIEW_REQUIRED");
  assert.equal((await store.list("unique_claims")).some((c) => c._id === claimId), false);
  assert.equal((await store.list("blacklist_entries")).length, 1);
});

test("an allow decision is one-occupancy and exact-version; a new entry invalidates it", async (t) => {
  const { store, persons, manager, reviewer, internal } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  const first = await manager.createEntry(entryInput(person.personId), managerAudit);
  const reviewed = await reviewer.reviewOccupancy("occ-allow", {
    decision: "allow", reason: "证据已核对", entryIds: [first.entryId], entryRevisions: [1],
  }, reviewerAudit);
  const allowed = await probeActivate(internal, { personId: person.personId, occupancyId: "occ-allow" });
  assert.equal(allowed.decisionId, reviewed.decisionId);
  const second = await manager.createEntry(entryInput(person.personId, { reason: "新增独立线索" }), managerAudit);
  await assert.rejects(probeActivate(internal, { personId: person.personId, occupancyId: "occ-allow" }),
    (e) => e.code === "BLACKLIST_REVIEW_REQUIRED");
  // Reviewing only the old hit set is not enough after another entry appears.
  await reviewer.reviewOccupancy("occ-allow", {
    decision: "allow", reason: "仅旧名单", entryIds: [first.entryId], entryRevisions: [1],
  }, reviewerAudit);
  await assert.rejects(probeActivate(internal, { personId: person.personId, occupancyId: "occ-allow" }),
    (e) => e.code === "BLACKLIST_REVIEW_REQUIRED");
  await reviewer.reviewOccupancy("occ-allow", {
    decision: "allow", reason: "全部当前命中已核对",
    entryIds: [second.entryId, first.entryId], entryRevisions: [1, 1],
  }, reviewerAudit);
  const reallowed = await probeActivate(internal, { personId: person.personId, occupancyId: "occ-allow" });
  assert.equal(reallowed.eligible, true);
  const history = (await store.list("blacklist_decisions")).filter((d) => d.recordType === "decision");
  assert.equal(history.length, 3);
  assert.equal(new Set(history.map((d) => d._id)).size, 3);
});

test("deny fails closed, a newer explicit allow replaces the head but preserves history", async (t) => {
  const { store, persons, manager, reviewer, internal } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  const entry = await manager.createEntry(entryInput(person.personId), managerAudit);
  await assert.rejects(reviewer.reviewOccupancy("occ-deny", {
    decision: "deny", reason: "错误版本", entryIds: [entry.entryId], entryRevisions: [99],
  }, reviewerAudit), (e) => e.code === "REVISION_CONFLICT");
  await assert.rejects(manager.reviewOccupancy("occ-deny", {
    decision: "deny", reason: "无复核权限", entryIds: [entry.entryId], entryRevisions: [1],
  }, managerAudit), (e) => e.code === "FORBIDDEN");
  await reviewer.reviewOccupancy("occ-deny", {
    decision: "deny", reason: "复核拒绝", entryIds: [entry.entryId], entryRevisions: [1],
  }, reviewerAudit);
  await assert.rejects(probeActivate(internal, { personId: person.personId, occupancyId: "occ-deny" }),
    (e) => e.code === "BLACKLIST_DENIED" && e.status === 403);
  await reviewer.reviewOccupancy("occ-deny", {
    decision: "allow", reason: "补充证据后放行", entryIds: [entry.entryId], entryRevisions: [1],
  }, reviewerAudit);
  const result = await probeActivate(internal, { personId: person.personId, occupancyId: "occ-deny" });
  assert.equal(result.eligible, true);
  const rows = (await store.list("blacklist_decisions")).filter((d) => d.occupancyId === "occ-deny");
  assert.equal(rows.filter((d) => d.recordType === "decision").length, 2);
  assert.equal(rows.filter((d) => d.recordType === "current").length, 1);
});

test("a deny committed after pre-read cannot race with an older allow", async (t) => {
  const { store, persons, manager, reviewer, internal } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  const entry = await manager.createEntry(entryInput(person.personId), managerAudit);
  await reviewer.reviewOccupancy("occ-review-race", {
    decision: "allow", reason: "初次放行", entryIds: [entry.entryId], entryRevisions: [1],
  }, reviewerAudit);
  let prepared;
  const ready = new Promise((resolve) => { prepared = resolve; });
  let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  const original = internal.prepareEligibility.bind(internal);
  internal.prepareEligibility = async (request) => {
    const token = await original(request);
    prepared();
    await gate;
    return token;
  };
  const claimId = "activation-probe-review-race";
  const activation = probeActivate(internal, { personId: person.personId, occupancyId: "occ-review-race", claimId });
  await ready;
  await reviewer.reviewOccupancy("occ-review-race", {
    decision: "deny", reason: "复核改判", entryIds: [entry.entryId], entryRevisions: [1],
  }, reviewerAudit);
  resume();
  await assert.rejects(activation, (e) => e.code === "BLACKLIST_DENIED");
  assert.equal((await store.list("unique_claims")).some((c) => c._id === claimId), false);
});

test("start and end boundaries are evaluated in real time without scheduler writes", async (t) => {
  const { persons, manager, reviewer, internal, setClock } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  const entry = await manager.createEntry(entryInput(person.personId, {
    startsAt: 2000, endsAt: 3000,
  }), managerAudit);
  assert.equal((await manager.listEntries({ state: "scheduled" }, managerAudit)).data.length, 1);
  setClock(1500);
  assert.equal((await probeActivate(internal, { personId: person.personId, occupancyId: "occ-time" })).eligible, true);
  setClock(2000);
  await assert.rejects(probeActivate(internal, { personId: person.personId, occupancyId: "occ-time" }),
    (e) => e.code === "BLACKLIST_REVIEW_REQUIRED");
  await reviewer.reviewOccupancy("occ-time", {
    decision: "allow", reason: "有效期内放行", entryIds: [entry.entryId], entryRevisions: [1],
  }, reviewerAudit);
  setClock(2999);
  assert.equal((await probeActivate(internal, { personId: person.personId, occupancyId: "occ-time" })).eligible, true);
  setClock(3000); // [startsAt, endsAt): expired exactly at endsAt.
  assert.equal((await probeActivate(internal, { personId: person.personId, occupancyId: "occ-time" })).eligible, true);
  const prepared = await internal.prepareEligibility({ personId: person.personId, occupancyId: "occ-time" });
  assert.equal(prepared.candidateIds.length, 0); // terminal history leaves the transaction ref set
  assert.equal((await manager.listEntries({ state: "expired" }, managerAudit)).data.length, 1);
});

test("bound-user and approved-identity entries are both included in activation checks", async (t) => {
  const { persons, manager, internal, approveFor, bindUser } = await setup(t);
  const userPerson = await persons.createPerson({ name: "账号住户" }, adminAudit);
  await bindUser(userPerson.personId, "user-hit-1");
  await manager.createEntry({ subjectType: "user", userId: "user-hit-1",
    reason: "账号命中", evidenceFileIds: [], restrictions: ["occupancy.activate"] }, managerAudit);
  await assert.rejects(probeActivate(internal, { personId: userPerson.personId, occupancyId: "occ-user-hit" }),
    (e) => e.code === "BLACKLIST_REVIEW_REQUIRED");
  const identityPerson = await persons.createPerson({ name: "身份住户" }, adminAudit);
  const applicationId = await approveFor(identityPerson.personId);
  await manager.createEntry({ subjectType: "identity", applicationId,
    reason: "身份命中", evidenceFileIds: [], restrictions: ["occupancy.activate"] }, managerAudit);
  await assert.rejects(probeActivate(internal, {
    personId: identityPerson.personId, occupancyId: "occ-identity-hit", identityApplicationId: applicationId,
  }), (e) => e.code === "BLACKLIST_REVIEW_REQUIRED");
  // DB-05 must pass the approved application; without it the identity subject
  // cannot be derived and is not silently invented from a phone or name.
  assert.equal((await probeActivate(internal, {
    personId: identityPerson.personId, occupancyId: "occ-identity-without-ref",
  })).eligible, true);
});

test("account claim writes shared guards so a concurrent legacy user entry cannot be missed", async (t) => {
  const { store, persons, internal, identity, verificationReviewer } = await setup(t);
  const { userId } = await identity.loginWithPhone({
    phoneCredential: { phone: "13800009999", code: "123456" }, wechatCode: "claim-race",
  }, adminAudit);
  const userAudit = { actor: "user", actorId: userId, actorType: "user", action: "本人认领" };
  const person = await persons.createPerson({ name: "待认领住户" }, adminAudit);
  const userVerification = new VerificationService(store, "org-a", null, {
    identity, encryptionKey: KEY, fileValidator: async () => true,
  });
  const { applicationId } = await userVerification.createApplication(
    { personId: person.personId, documentType: "id-card" }, userAudit,
  );
  const draft = await userVerification.getApplication(applicationId);
  await userVerification.submit(applicationId, {
    expectedRevision: draft.revision,
    document: { name: "待认领住户", documentNumber: "110101199001018888" },
    fileIds: ["file-claim-test"],
  }, userAudit);
  const submitted = await verificationReviewer.getApplication(applicationId);
  await verificationReviewer.review(applicationId, {
    decision: "approve", reason: "本人核验通过", expectedRevision: submitted.revision, documentVersion: 1,
  }, reviewerAudit);
  // Simulate a controlled legacy import: the user was not yet bound to this
  // person when eligibility pre-read began, but already had an org list entry.
  const legacyEntryId = "legacy-user-blacklist-entry";
  const userGuardId = eligibilityGuardId("org-a", "user", userId);
  await store.transact([
    { collection: "blacklist_entries", id: legacyEntryId },
    { collection: "eligibility_guards", id: userGuardId },
  ], () => [
    {
      collection: "blacklist_entries", id: legacyEntryId,
      data: {
        orgId: "org-a", subjectType: "user", subjectKey: userId,
        reasonCode: "legacy", reason: "历史导入名单", evidenceFileIds: [],
        restrictions: ["occupancy.activate"], startsAt: 1000, endsAt: null,
        state: "active", createdBy: "migration-test",
        schemaVersion: 2, revision: 1, createdAt: Date.now(),
      },
    },
    {
      collection: "eligibility_guards", id: userGuardId,
      data: {
        orgId: "org-a", subjectType: "user", subjectKey: userId, epoch: 1,
        schemaVersion: 2, revision: 1, createdAt: Date.now(),
      },
    },
  ], adminAudit);
  let prepared;
  const ready = new Promise((resolve) => { prepared = resolve; });
  let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  const original = internal.prepareEligibility.bind(internal);
  internal.prepareEligibility = async (request) => {
    const token = await original(request);
    prepared();
    await gate;
    return token;
  };
  const claimId = "activation-probe-claim-race";
  const activation = probeActivate(internal, {
    personId: person.personId, occupancyId: "occ-claim-race", claimId,
  });
  await ready;
  await persons.claimAccount(person.personId, { callerUserId: userId, applicationId }, userAudit);
  resume();
  await assert.rejects(activation, (e) => e.code === "BLACKLIST_REVIEW_REQUIRED");
  assert.equal((await store.list("unique_claims")).some((c) => c._id === claimId), false);
  const guards = await store.list("eligibility_guards", "org-a");
  assert.equal(guards.find((g) => g._id === eligibilityGuardId("org-a", "person", person.personId)).epoch, 1);
  assert.equal(guards.find((g) => g._id === userGuardId).epoch, 2);
});
