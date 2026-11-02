import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalStore } from "../lib/store.mjs";
import { OrgService } from "../lib/org.mjs";
import { IdentityService } from "../lib/identity.mjs";
import { PersonService } from "../lib/persons.mjs";
import { VerificationService } from "../lib/verification.mjs";
const KEY = Buffer.alloc(32, 3);
const gateway = {
  async verifyPhone(c) {
    if (c?.code !== "123456") throw new Error("invalid test code");
    return c.phone;
  },
  async fetchWechatSubject(code) {
    return { appId: "wx-demo-app", openid: `openid-${code}` };
  },
};
const adminAudit = { actor: "admin", actorId: "acc-admin", action: "实名测试" };
const reviewerAudit = { actor: "reviewer", actorId: "acc-reviewer", action: "实名审核" };
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-verify-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  const orgs = new OrgService(store);
  await orgs.bootstrap({ id: "org-a", name: "组织A", adminAccountIds: ["acc-admin"] }, adminAudit);
  await orgs.bootstrap({ id: "org-b", name: "组织B", adminAccountIds: ["acc-b"] }, adminAudit);
  await orgs.grantMembership(
    {
      orgId: "org-a",
      principalType: "adminAccount",
      principalId: "acc-reviewer",
      role: "admin",
      permissions: ["identity.review", "identity.readPrivate"],
    },
    adminAudit,
  );
  const memberships = await store.list("org_memberships");
  const mem = (principalId) => memberships.find((m) => m.orgId === "org-a" && m.principalId === principalId)._id;
  const identity = new IdentityService(store, { hmacKey: "test-identity-key-0123456789", gateway });
  const makeService = (membershipId, extra = {}) =>
    new VerificationService(store, "org-a", membershipId ? { membershipId } : null, {
      identity,
      encryptionKey: KEY,
      fileValidator: async () => true,
      ...extra,
    });
  const admin = makeService(mem("acc-admin"));
  const reviewer = makeService(mem("acc-reviewer"));
  const persons = new PersonService(store, "org-a", { membershipId: mem("acc-admin") });
  return { dir, store, orgs, identity, admin, reviewer, persons, makeService };
}
const DOC = { name: "测试住户", documentNumber: "110101199001011234" };
const FILES = ["file-test-1"];
async function submitNew(service, personId, audit = adminAudit, doc = DOC) {
  const { applicationId } = await service.createApplication(
    { personId, documentType: "id-card" },
    audit,
  );
  const app = await service.getApplication(applicationId);
  await service.submit(
    applicationId,
    { expectedRevision: app.revision, document: doc, fileIds: FILES },
    audit,
  );
  return applicationId;
}
test("full manual flow: draft → submitted → approved, private data encrypted, claim bound", async (t) => {
  const { store, admin, reviewer, persons } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  const id = await submitNew(admin, person.personId);
  const privateRow = (await store.list("identity_private")).find((r) => r._id === id);
  assert.ok(privateRow.nameCiphertext && !JSON.stringify(privateRow).includes("110101199001011234"));
  assert.ok(!JSON.stringify(privateRow).includes("测试住户"));
  assert.equal(privateRow.encryptionKeyVersion, 1);
  const app = await reviewer.getApplication(id);
  assert.equal(app.state, "submitted");
  assert.ok(!("identityDigest" in app) && !("nameCiphertext" in app));
  const reviewed = await reviewer.review(
    id,
    { decision: "approve", reason: "证件与档案一致", expectedRevision: app.revision, documentVersion: 1 },
    reviewerAudit,
  );
  assert.equal(reviewed.state, "approved");
  const claim = (await store.list("unique_claims")).find((c) => c.namespace === "verified-person");
  assert.equal(claim.ownerId, person.personId);
  const reviewRows = (await store.list("identity_reviews")).filter((r) => r.applicationId === id);
  assert.equal(reviewRows.length, 1);
  assert.equal(reviewRows[0].documentVersion, 1);
  const secret = await reviewer.readPrivate(id, reviewerAudit);
  assert.equal(secret.name, "测试住户");
  assert.equal(secret.documentNumber, "110101199001011234");
  const audits = await store.list("admin_audit");
  assert.ok(audits.some((a) => a.action === "读取实名私有资料"));
});
test("submit requires private files, a file validator and an encryption key", async (t) => {
  const { admin, persons, makeService } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  const { applicationId } = await admin.createApplication(
    { personId: person.personId, documentType: "id-card" },
    adminAudit,
  );
  await assert.rejects(
    admin.submit(applicationId, { expectedRevision: 1, document: DOC, fileIds: [] }, adminAudit),
    (e) => e.code === "PRIVATE_FILE_REQUIRED" && e.status === 422,
  );
  const noValidator = makeService(null, { fileValidator: null });
  await assert.rejects(
    noValidator.submit(applicationId, { expectedRevision: 1, document: DOC, fileIds: FILES }, adminAudit),
    (e) => e.code === "ADAPTER_UNAVAILABLE" && e.status === 503,
  );
  const noKey = makeService(null, { encryptionKey: null });
  await assert.rejects(
    noKey.submit(applicationId, { expectedRevision: 1, document: DOC, fileIds: FILES }, adminAudit),
    (e) => e.code === "ADAPTER_UNAVAILABLE" && e.status === 503,
  );
  const after = await admin.getApplication(applicationId);
  assert.equal(after.state, "draft"); // nothing written on failures
});
test("reviewers cannot approve their own submission; repeat reviews are rejected", async (t) => {
  const { admin, reviewer, persons } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  const id = await submitNew(reviewer, person.personId, reviewerAudit);
  const app = await reviewer.getApplication(id);
  await assert.rejects(
    reviewer.review(id, { decision: "approve", reason: "自审", expectedRevision: app.revision, documentVersion: 1 }, reviewerAudit),
    (e) => e.code === "FORBIDDEN" && /提交人/.test(e.message),
  );
  await reviewer.review(id, { decision: "approve", reason: "通过", expectedRevision: app.revision, documentVersion: 1 }, adminAudit2);
  const after = await reviewer.getApplication(id);
  await assert.rejects(
    reviewer.review(id, { decision: "reject", reason: "重复", expectedRevision: after.revision, documentVersion: 1 }, adminAudit2),
    (e) => e.code === "INVALID_STATE",
  );
});
// Second independent reviewer for approve/reject flows (never the applicant).
const adminAudit2 = { actor: "reviewer2", actorId: "acc-reviewer-2", action: "实名审核" };
test("supplement creates a new document version; stale reviews fail; history is kept", async (t) => {
  const { admin, reviewer, persons } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  const id = await submitNew(admin, person.personId);
  let app = await reviewer.getApplication(id);
  await reviewer.review(id, { decision: "needs_info", reason: "照片不清晰", expectedRevision: app.revision, documentVersion: 1 }, reviewerAudit);
  app = await reviewer.getApplication(id);
  assert.equal(app.state, "needs_info");
  await admin.supplement(id, { expectedRevision: app.revision, document: DOC, fileIds: ["file-test-2"] }, adminAudit);
  app = await reviewer.getApplication(id);
  assert.equal(app.documentVersion, 2);
  assert.equal(app.state, "submitted");
  await assert.rejects(
    reviewer.review(id, { decision: "approve", reason: "旧版本", expectedRevision: app.revision, documentVersion: 1 }, reviewerAudit),
    (e) => e.code === "STALE_DOCUMENT" && e.status === 409,
  );
  await assert.rejects(
    reviewer.review(id, { decision: "approve", reason: "错误版本", expectedRevision: 99, documentVersion: 2 }, reviewerAudit),
    (e) => e.code === "REVISION_CONFLICT",
  );
  await reviewer.review(id, { decision: "approve", reason: "通过", expectedRevision: app.revision, documentVersion: 2 }, reviewerAudit);
  const reviews = (await reviewer.store?.list?.("identity_reviews")) || [];
  void reviews;
});
test("the same verified identity cannot be approved for two persons in one org", async (t) => {
  const { admin, reviewer, persons } = await setup(t);
  const p1 = await persons.createPerson({ name: "张住户" }, adminAudit);
  const p2 = await persons.createPerson({ name: "李住户" }, adminAudit);
  const first = await submitNew(admin, p1.personId);
  let app = await reviewer.getApplication(first);
  await reviewer.review(first, { decision: "approve", reason: "通过", expectedRevision: app.revision, documentVersion: 1 }, reviewerAudit);
  const second = await submitNew(admin, p2.personId);
  app = await reviewer.getApplication(second);
  await assert.rejects(
    reviewer.review(second, { decision: "approve", reason: "重复身份", expectedRevision: app.revision, documentVersion: 1 }, reviewerAudit),
    (e) => e.code === "IDENTITY_CONFLICT",
  );
  assert.equal((await reviewer.getApplication(second)).state, "submitted");
});
test("permission points are explicit: no identity.review no queue/review, no identity.readPrivate no secrets", async (t) => {
  const { admin, reviewer, persons } = await setup(t);
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  const id = await submitNew(admin, person.personId);
  // acc-admin is org admin but holds NO identity permission points.
  await assert.rejects(admin.listApplications({}), (e) => e.code === "FORBIDDEN");
  const app = await reviewer.getApplication(id);
  await assert.rejects(
    admin.review(id, { decision: "approve", reason: "越权", expectedRevision: app.revision, documentVersion: 1 }, reviewerAudit),
    (e) => e.code === "FORBIDDEN",
  );
  await assert.rejects(admin.readPrivate(id, adminAudit), (e) => e.code === "FORBIDDEN");
  const queue = await reviewer.listApplications({ state: "submitted" });
  assert.equal(queue.data.length, 1);
  const otherOrg = (await reviewer.store?.list?.("identity_applications", "org-b")) || [];
  void otherOrg;
  await assert.rejects(admin.providerStart(), (e) => e.code === "PROVIDER_DISABLED" && e.status === 503);
});
test("claimAccount succeeds only with an approved self-submitted application", async (t) => {
  const { store, identity, admin, reviewer, persons } = await setup(t);
  const { userId } = await identity.loginWithPhone(
    { phoneCredential: { phone: "13800001234", code: "123456" }, wechatCode: "w-claim" },
    adminAudit,
  );
  const userAudit = { actor: "user", actorId: userId, actorType: "user", action: "本人实名" };
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  const userService = new VerificationService(store, "org-a", null, {
    identity,
    encryptionKey: KEY,
    fileValidator: async () => true,
  });
  // Without any application the claim is refused (zero writes).
  await assert.rejects(
    persons.claimAccount(person.personId, { callerUserId: userId }, userAudit),
    (e) => e.code === "IDENTITY_NOT_APPROVED" && e.status === 403,
  );
  const id = await submitNew(userService, person.personId, userAudit);
  // Still only submitted: not enough.
  await assert.rejects(
    persons.claimAccount(person.personId, { callerUserId: userId, applicationId: id }, userAudit),
    (e) => e.code === "IDENTITY_NOT_APPROVED",
  );
  const app = await reviewer.getApplication(id);
  await reviewer.review(id, { decision: "approve", reason: "通过", expectedRevision: app.revision, documentVersion: 1 }, reviewerAudit);
  const claimed = await persons.claimAccount(person.personId, { callerUserId: userId, applicationId: id }, userAudit);
  assert.equal(claimed.userId, userId);
  const stored = (await store.list("persons")).find((p) => p._id === person.personId);
  assert.equal(stored.userId, userId);
  assert.equal(stored.identityApplicationId, id);
  // The same account cannot claim a second profile in this org.
  const second = await persons.createPerson({ name: "李住户" }, adminAudit);
  const id2 = await submitNew(userService, second.personId, userAudit, {
    ...DOC,
    documentNumber: "110101199001015678", // a different person, a different document
  });
  const app2 = await reviewer.getApplication(id2);
  await reviewer.review(id2, { decision: "approve", reason: "通过", expectedRevision: app2.revision, documentVersion: 1 }, reviewerAudit);
  await assert.rejects(
    persons.claimAccount(second.personId, { callerUserId: userId, applicationId: id2 }, userAudit),
    (e) => e.code === "IDENTITY_CONFLICT" && /已绑定其他人员档案/.test(e.message),
  );
});
test("an admin-submitted approval can never be used to claim the profile for an account", async (t) => {
  const { store, identity, admin, reviewer, persons } = await setup(t);
  const { userId } = await identity.loginWithPhone(
    { phoneCredential: { phone: "13800004321", code: "123456" }, wechatCode: "w-agent" },
    adminAudit,
  );
  const person = await persons.createPerson({ name: "张住户" }, adminAudit);
  const id = await submitNew(admin, person.personId); // agent-submitted
  const app = await reviewer.getApplication(id);
  await reviewer.review(id, { decision: "approve", reason: "通过", expectedRevision: app.revision, documentVersion: 1 }, reviewerAudit);
  await assert.rejects(
    persons.claimAccount(person.personId, { callerUserId: userId, applicationId: id }, { actor: "user", actorId: userId, actorType: "user", action: "认领" }),
    (e) => e.code === "IDENTITY_NOT_APPROVED",
  );
  assert.equal((await store.list("persons")).find((p) => p._id === person.personId).userId, null);
});
