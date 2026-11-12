import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalStore } from "../lib/store.mjs";
import { OrgService } from "../lib/org.mjs";
import {
  IdentityService,
  normalizePhone,
  maskPhone,
  maskName,
} from "../lib/identity.mjs";
import { PersonService } from "../lib/persons.mjs";
const audit = { actor: "test", actorId: "acc-admin", action: "身份测试" };
// Test-only gateway: the phone is returned ONLY after a valid verification
// code, and the WeChat subject is derived server-side from the code — any
// openid/phone smuggled in the request payload is ignored by construction.
const gateway = {
  async verifyPhone(credential) {
    if (credential?.code !== "123456") throw new Error("invalid test code");
    return credential.phone;
  },
  async fetchWechatSubject(code) {
    return { appId: "wx-demo-app", openid: `openid-${code}` };
  },
};
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-identity-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  const identity = new IdentityService(store, {
    hmacKey: "test-identity-key-0123456789",
    gateway,
  });
  return { dir, store, identity };
}
const loginPhone = (identity, phone, wechatCode = "w1") =>
  identity.loginWithPhone(
    { phoneCredential: { phone, code: "123456" }, wechatCode },
    audit,
  );
test("phone normalization, masking and keyed digests", async (t) => {
  const { identity } = await setup(t);
  assert.equal(normalizePhone("138 0000-1111"), "+8613800001111");
  assert.equal(normalizePhone("008613800001111"), "+8613800001111");
  assert.equal(normalizePhone("+14155552671"), "+14155552671");
  assert.throws(() => normalizePhone("abc"), (e) => e.code === "PARAM_ERROR");
  assert.throws(() => normalizePhone("123"), (e) => e.code === "PARAM_ERROR");
  assert.equal(maskPhone("+8613800001111"), "+86****1111");
  assert.equal(maskName("张无账"), "张**");
  const a = identity.phoneIdentity("+8613800001111");
  const otherKey = new IdentityService(await new LocalStore(await mkdtemp(join(tmpdir(), "smartpm-key-"))).init(), {
    hmacKey: "another-secret-key-987654321",
    gateway,
  });
  const b = otherKey.phoneIdentity("+8613800001111");
  assert.notEqual(a.subjectDigest, b.subjectDigest); // keyed HMAC, not raw hash
  assert.ok(!a.id.includes("13800001111"));
});
test("loginWithPhone creates one user with two mappings; repeat login keeps the same ID", async (t) => {
  const { store, identity } = await setup(t);
  const first = await loginPhone(identity, "13800001111", "w1");
  assert.ok(first.isNewUser);
  const again = await loginPhone(identity, "13800001111", "w1");
  assert.equal(again.userId, first.userId);
  assert.equal(again.isNewUser, false);
  const users = (await store.list("users")).filter((u) => u.schemaVersion === 2);
  assert.equal(users.length, 1);
  assert.equal(users[0].role, "user"); // never an admin
  assert.equal(users[0].phoneMasked, "+86****1111");
  const idents = await store.list("auth_identities");
  assert.equal(idents.length, 2);
  assert.deepEqual(new Set(idents.map((i) => i.kind)), new Set(["phone", "wechat"]));
  // No raw phone or OPENID anywhere in stored records.
  const serialized = JSON.stringify({ users, idents });
  assert.ok(!serialized.includes("13800001111"));
  assert.ok(!serialized.includes("openid-w1"));
});
test("concurrent identical registrations produce exactly one user", async (t) => {
  const { store, identity } = await setup(t);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => loginPhone(identity, "13800002222", "w2")),
  );
  const userIds = new Set(results.map((r) => r.userId));
  assert.equal(userIds.size, 1);
  assert.equal(results.filter((r) => r.isNewUser).length, 1);
  assert.equal(
    (await store.list("users")).filter((u) => u.schemaVersion === 2).length,
    1,
  );
  assert.equal((await store.list("auth_identities")).length, 2);
});
test("concurrent same-phone different-WeChat logins never fork a second account", async (t) => {
  const { store, identity } = await setup(t);
  const [a, b] = await Promise.allSettled([
    loginPhone(identity, "13800003333", "wa"),
    loginPhone(identity, "13800003333", "wb"),
  ]);
  const users = (await store.list("users")).filter((u) => u.schemaVersion === 2);
  assert.equal(users.length, 1);
  const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
  assert.ok(fulfilled.length >= 1);
  for (const r of fulfilled) assert.equal(r.value.userId, users[0]._id);
  const rejected = [a, b].find((r) => r.status === "rejected");
  if (rejected) assert.equal(rejected.reason.code, "IDENTITY_CONFLICT");
});
test("mappings pointing at different users conflict; nothing is overwritten", async (t) => {
  const { store, identity } = await setup(t);
  const phoneUser = await loginPhone(identity, "13800004444", "w4");
  const wechatUser = await identity.loginWithWechat({ wechatCode: "w5" }, audit);
  assert.notEqual(phoneUser.userId, wechatUser.userId);
  await assert.rejects(loginPhone(identity, "13800004444", "w5"), (e) => {
    assert.equal(e.code, "IDENTITY_CONFLICT");
    assert.equal(e.status, 409);
    return true;
  });
  const idents = await store.list("auth_identities");
  assert.equal(idents.filter((i) => i.userId === phoneUser.userId).length, 2);
  assert.equal(idents.filter((i) => i.userId === wechatUser.userId).length, 1);
});
test("a second phone for the same account is rejected while Q04 is undecided", async (t) => {
  const { identity } = await setup(t);
  await loginPhone(identity, "13800005555", "w6");
  await assert.rejects(
    loginPhone(identity, "13800005556", "w6"),
    (e) => e.code === "IDENTITY_CONFLICT" && /换号/.test(e.message),
  );
});
test("disabled users cannot log in", async (t) => {
  const { store, identity } = await setup(t);
  const { userId } = await loginPhone(identity, "13800006666", "w7");
  await store.transact(
    [{ collection: "users", id: userId }],
    () => [{ collection: "users", id: userId, data: { status: "disabled" } }],
    audit,
  );
  await assert.rejects(loginPhone(identity, "13800006666", "w7"), (e) => {
    assert.equal(e.code, "USER_DISABLED");
    assert.equal(e.status, 403);
    return true;
  });
});
test("legacy users without mappings block registration instead of being duplicated", async (t) => {
  const { store, identity } = await setup(t);
  await store.transact(
    [{ collection: "users", id: "legacy-user-1" }],
    () => [
      {
        collection: "users",
        id: "legacy-user-1",
        data: { name: "旧住户", phone: "13800007777", role: "user" },
      },
    ],
    audit,
  );
  await assert.rejects(loginPhone(identity, "13800007777", "w8"), (e) => {
    assert.equal(e.code, "IDENTITY_CONFLICT");
    assert.match(e.message, /迁移/);
    return true;
  });
  const users = await store.list("users");
  assert.equal(users.filter((u) => u.schemaVersion === 2).length, 0); // no second account
  assert.ok(users.some((u) => u._id === "legacy-user-1")); // legacy ID preserved
  assert.equal((await store.list("auth_identities")).length, 0);
});
test("wechat-only login is low privilege; profile is masked and self-scoped", async (t) => {
  const { store, identity } = await setup(t);
  const { userId } = await identity.loginWithWechat({ wechatCode: "w9" }, audit);
  const profile = await identity.getMyProfile(userId);
  assert.equal(profile.phoneMasked, null);
  assert.equal(profile.identities.length, 1);
  assert.equal(profile.identities[0].kind, "wechat");
  assert.ok(!JSON.stringify(profile).includes("openid-w9"));
  assert.ok(!("houses" in profile)); // no device bindings leak
  const user = (await store.list("users")).find((u) => u._id === userId);
  assert.equal(user.role, "user");
  assert.equal((await store.list("org_memberships")).length, 0);
  await assert.rejects(identity.getMyProfile("nobody"), (e) => e.status === 404);
});
test("phone change is closed while Q04 is undecided; gateways fail closed", async (t) => {
  const { store, identity } = await setup(t);
  await assert.rejects(identity.requestPhoneChange(), (e) => {
    assert.equal(e.code, "POLICY_UNDECIDED");
    assert.equal(e.status, 503);
    return true;
  });
  const noGateway = new IdentityService(store, {
    hmacKey: "test-identity-key-0123456789",
  });
  await assert.rejects(
    noGateway.loginWithPhone({ phoneCredential: { phone: "13800008888" } }, audit),
    (e) => e.code === "PROVIDER_DISABLED" && e.status === 503,
  );
  await assert.rejects(
    noGateway.loginWithWechat({ wechatCode: "w10" }, audit),
    (e) => e.code === "PROVIDER_DISABLED" && e.status === 503,
  );
});
async function personSetup(t) {
  const x = await setup(t);
  const orgs = new OrgService(x.store);
  await orgs.bootstrap({ id: "org-a", name: "组织A", adminAccountIds: ["acc-admin"] }, audit);
  await orgs.bootstrap({ id: "org-b", name: "组织B", adminAccountIds: ["acc-b"] }, audit);
  const membershipId = (await x.store.list("org_memberships")).find(
    (m) => m.orgId === "org-a" && m.principalId === "acc-admin",
  )._id;
  const persons = new PersonService(x.store, "org-a", { membershipId });
  return { ...x, orgs, persons };
}
test("persons need no account or phone; lists are org-scoped", async (t) => {
  const { store, persons } = await personSetup(t);
  const created = await persons.createPerson({ name: "张无账" }, audit);
  assert.equal(created.nameMasked, "张**");
  const person = (await store.list("persons")).find((p) => p._id === created.personId);
  assert.equal(person.userId, null);
  assert.equal(person.orgId, "org-a");
  assert.ok(!("phone" in person)); // an agent's phone can never be attached
  assert.ok(!JSON.stringify(person).includes("张无账")); // masked storage only
  const otherOrg = new PersonService(store, "org-b");
  assert.equal((await otherOrg.listPersons({ limit: 20 })).data.length, 0);
  assert.equal((await persons.listPersons({ limit: 20 })).data.length, 1);
});
test("F02: claimAccount is closed without identity proof — even a verified phone login is rejected with zero writes", async (t) => {
  const { store, identity, persons } = await personSetup(t);
  // Exactly the F02 reproduction: an admin-created unbound profile plus a
  // verified login account, but NO approved identity application. A verified
  // caller is not proof that the target profile belongs to that caller.
  const { userId } = await loginPhone(identity, "13800009999", "w11");
  const person = await persons.createPerson({ name: "李住户" }, audit);
  const claimsBefore = (await store.list("unique_claims")).length;
  await assert.rejects(
    persons.claimAccount(person.personId, { callerUserId: userId }, audit),
    (e) => {
      assert.equal(e.code, "POLICY_UNDECIDED");
      assert.equal(e.status, 503);
      return true;
    },
  );
  const stored = (await store.list("persons")).find((p) => p._id === person.personId);
  assert.equal(stored.userId, null); // untouched
  assert.equal((await store.list("unique_claims")).length, claimsBefore); // zero writes
  const profile = await identity.getMyProfile(userId);
  assert.equal(profile.persons.length, 0);
});
test("F01: listPersons applies default limit and validates pagination input", async (t) => {
  const { persons } = await personSetup(t);
  await persons.createPerson({ name: "张无账" }, audit);
  // F01 reproduction: no limit used to return an empty page (NaN slice).
  assert.equal((await persons.listPersons({})).data.length, 1);
  assert.equal((await persons.listPersons()).data.length, 1);
  for (const bad of [{ limit: 0 }, { limit: -1 }, { limit: 101 }, { limit: "abc" }, { limit: 1.5 }])
    await assert.rejects(persons.listPersons(bad), (e) => e.code === "PARAM_ERROR");
  assert.equal((await persons.listPersons({ limit: "20" })).data.length, 1);
  for (let i = 0; i < 21; i++) await persons.createPerson({ name: `住户${i}` }, audit);
  const first = await persons.listPersons({ limit: 20 });
  assert.equal(first.data.length, 20);
  assert.ok(first.nextCursor);
  const second = await persons.listPersons({ limit: 20, cursor: first.nextCursor });
  assert.equal(second.data.length, 2);
  assert.equal(second.nextCursor, undefined);
  const ids = new Set([...first.data, ...second.data].map((p) => p._id));
  assert.equal(ids.size, 22);
  await assert.rejects(
    persons.listPersons({ limit: 20, cursor: "no-such-cursor" }),
    (e) => e.code === "PARAM_ERROR",
  );
});
test("F03: changing keyVersion or the key itself is refused instead of re-registering users", async (t) => {
  const { store, identity } = await setup(t);
  const first = await loginPhone(identity, "13800001111", "w1");
  const v2 = new IdentityService(store, {
    hmacKey: "test-identity-key-0123456789",
    keyVersion: 2,
    gateway,
  });
  // Same realm, bumped keyVersion: must fail loudly, not create user #2.
  await assert.rejects(loginPhone(v2, "13800001111", "w1"), (e) => {
    assert.equal(e.code, "IDENTITY_CONFIG_CHANGED");
    assert.equal(e.status, 503);
    return true;
  });
  // Same keyVersion, different key: also refused.
  const otherKey = new IdentityService(store, {
    hmacKey: "another-secret-key-987654321",
    gateway,
  });
  await assert.rejects(loginPhone(otherKey, "13800001111", "w1"), (e) => e.code === "IDENTITY_CONFIG_CHANGED");
  // A completely new phone cannot bypass the guard either (no registration
  // path may exist under a mismatched configuration).
  await assert.rejects(loginPhone(v2, "13900000000", "wnew"), (e) => e.code === "IDENTITY_CONFIG_CHANGED");
  assert.equal((await store.list("users")).filter((u) => u.schemaVersion === 2).length, 1);
  assert.equal((await store.list("auth_identities")).length, 2);
  // Rolling deploy: the old-version instance keeps working unchanged.
  const again = await loginPhone(identity, "13800001111", "w1");
  assert.equal(again.userId, first.userId);
  assert.equal(again.isNewUser, false);
  const domain = (await store.list("identity_domains")).find(
    (d) => d._id === "identity-domain-resident",
  );
  assert.equal(domain.keyVersion, 1);
  assert.ok(domain.keyFingerprint && !JSON.stringify(domain).includes("test-identity-key"));
});
test("F03: a disabled account plus a changed key still cannot bypass into a new user", async (t) => {
  const { store, identity } = await setup(t);
  const { userId } = await loginPhone(identity, "13800006666", "w7");
  await store.transact(
    [{ collection: "users", id: userId }],
    () => [{ collection: "users", id: userId, data: { status: "disabled" } }],
    audit,
  );
  const rotated = new IdentityService(store, {
    hmacKey: "rotated-secret-key-abcdef12345",
    keyVersion: 2,
    gateway,
  });
  await assert.rejects(loginPhone(rotated, "13800006666", "w7"), (e) => e.code === "IDENTITY_CONFIG_CHANGED");
  assert.equal((await store.list("users")).filter((u) => u.schemaVersion === 2).length, 1);
  assert.equal((await store.list("auth_identities")).length, 2);
});
