import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { LocalStore } from "../lib/store.mjs";
import { BlacklistService } from "../lib/blacklist.mjs";
import { failCode } from "../lib/model.mjs";

const ORG = "org-h2c-hook";
const NOW = 10_000;
const audit = { actor: "system", actorId: "system", action: "H2-c C2 钩子测试" };
const ref = (collection, id) => ({ collection, id });
const retry = () => failCode("BLACKLIST_RETRY", "名单状态已变化，请重新检查", 409);

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-h2c-hook-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  await store.transact([
    ref("organizations", ORG),
    ref("persons", "person-1"),
    ref("persons", "person-2"),
    ref("identity_applications", "id-1"),
    ref("identity_applications", "id-2"),
  ], () => [
    { collection: "organizations", id: ORG, data: { name: "钩子组织", status: "active", revision: 1 } },
    {
      collection: "persons", id: "person-1",
      data: { orgId: ORG, name: "住户一", status: "active", userId: null, revision: 1 },
    },
    {
      collection: "persons", id: "person-2",
      data: { orgId: ORG, name: "住户二", status: "active", userId: null, revision: 1 },
    },
    {
      collection: "identity_applications", id: "id-1",
      data: {
        orgId: ORG, personId: "person-1", state: "approved",
        identityDigest: "digest-1", keyVersion: 1, revision: 1,
      },
    },
    {
      collection: "identity_applications", id: "id-2",
      data: {
        orgId: ORG, personId: "person-2", state: "approved",
        identityDigest: "digest-2", keyVersion: 1, revision: 1,
      },
    },
  ], audit);
  const service = new BlacklistService(store, ORG, null, { now: () => NOW });
  return { store, service };
}

async function addHit(store, personId, id = "entry-1") {
  await store.transact([ref("blacklist_entries", id)], () => [{
    collection: "blacklist_entries", id,
    data: {
      orgId: ORG, subjectType: "person", subjectKey: personId,
      state: "active", restrictions: ["occupancy.activate"],
      startsAt: 0, endsAt: null, revision: 1, reasonCode: "manual-review",
    },
  }], audit);
}

/** 计数 prepare / evaluate / transact / build 的实际调用次数。 */
function instrument(service, store) {
  const counts = { prepare: 0, evaluate: 0, transact: 0, build: 0 };
  const prepare = service.prepareEligibility.bind(service);
  const evaluate = service.evaluateEligibility.bind(service);
  const transact = store.transact.bind(store);
  service.prepareEligibility = async (request) => {
    counts.prepare += 1;
    return prepare(request);
  };
  service.evaluateEligibility = (state, token, options) => {
    counts.evaluate += 1;
    return evaluate(state, token, options);
  };
  store.transact = async (...args) => {
    counts.transact += 1;
    return transact(...args);
  };
  return counts;
}

let sequence = 0;
async function probe(service, {
  personId = "person-1", identityApplicationId = "id-1", prepareAttempt = undefined,
  deferBlocked = undefined, deferPrepareError = undefined, beforeBuild = null,
  counts = null, extraRefs = [],
} = {}) {
  const claimId = `hook-claim-${sequence++}`;
  const options = {};
  if (prepareAttempt !== undefined) options.prepareAttempt = prepareAttempt;
  if (deferBlocked !== undefined) options.deferBlocked = deferBlocked;
  if (deferPrepareError !== undefined) options.deferPrepareError = deferPrepareError;
  return service.withEligibility(
    { personId, occupancyId: `occupancy-${personId}`, identityApplicationId },
    [ref("unique_claims", claimId), ...extraRefs],
    (state, eligibility, context) => {
      if (counts) counts.build += 1;
      beforeBuild?.(state, eligibility, context);
      return {
        writes: [{
          collection: "unique_claims", id: claimId,
          data: {
            orgId: ORG, namespace: "h2c-hook-probe", ownerId: `occupancy-${personId}`,
            state: "bound", revision: 1,
          },
        }],
        result: { claimId, eligibility, context },
      };
    },
    audit,
    options,
  );
}

test("C2 hook refs are planned each attempt and beforeEvaluate precedes build", async (t) => {
  const { store, service } = await setup(t);
  await store.transact([ref("rooms", "room-x")], () => [{
    collection: "rooms", id: "room-x", data: { orgId: ORG, name: "房间X", revision: 1 },
  }], audit);
  const counts = instrument(service, store);
  const order = [];
  let context = null;
  const result = await probe(service, {
    counts,
    prepareAttempt: async (token) => {
      assert.equal(token.personId, "person-1");
      return {
        refs: [ref("rooms", "room-x")],
        beforeEvaluate: (state) => {
          order.push("before");
          assert.equal(state["rooms/room-x"]?.name, "房间X");
          return { snapshot: "read-only" };
        },
      };
    },
    beforeBuild: (state, eligibility, seen) => {
      order.push("build");
      context = seen;
      assert.equal(eligibility.eligible, true);
    },
  });
  assert.deepEqual(order, ["before", "build"]);
  assert.deepEqual(context, { snapshot: "read-only" });
  assert.equal(result.claimId.startsWith("hook-claim-"), true);
  assert.deepEqual(counts, { prepare: 1, evaluate: 1, transact: 1, build: 1 });
});

test("C2 beforeEvaluate really runs before the blacklist decision", async (t) => {
  const { store, service } = await setup(t);
  await addHit(store, "person-1");
  const counts = instrument(service, store);
  const order = [];
  await assert.rejects(probe(service, {
    counts,
    prepareAttempt: async () => ({
      refs: [],
      beforeEvaluate: () => { order.push("before"); return null; },
    }),
    beforeBuild: () => { order.push("build"); },
  }), (error) => error.code === "BLACKLIST_REVIEW_REQUIRED");
  assert.deepEqual(order, ["before"], "命中复核必须在钩子之后才拒绝");
  assert.equal(counts.evaluate, 1);
  assert.equal(counts.build, 0);
});

test("C2 one hook retry re-runs prepare, transaction, evaluate and build", async (t) => {
  const { store, service } = await setup(t);
  const counts = instrument(service, store);
  let attempts = 0;
  const result = await probe(service, {
    counts,
    prepareAttempt: async () => {
      attempts += 1;
      const current = attempts;
      return {
        refs: [],
        beforeEvaluate: () => { if (current === 1) throw retry(); return null; },
      };
    },
  });
  assert.equal(result.eligibility.eligible, true);
  assert.equal(attempts, 2);
  assert.deepEqual(counts, { prepare: 2, evaluate: 1, transact: 2, build: 1 });
  assert.equal((await store.list("unique_claims", ORG)).length, 1);
});

test("C2 three exhausted hook attempts keep 409 BLACKLIST_RETRY and write nothing", async (t) => {
  const { store, service } = await setup(t);
  const counts = instrument(service, store);
  await assert.rejects(probe(service, {
    counts,
    prepareAttempt: async () => ({
      refs: [],
      beforeEvaluate: () => { throw retry(); },
    }),
  }), (error) => error.code === "BLACKLIST_RETRY" && error.status === 409);
  assert.deepEqual(counts, { prepare: 3, evaluate: 0, transact: 3, build: 0 });
  assert.equal((await store.list("unique_claims", ORG)).length, 0);
  assert.equal((await store.list("admin_audit")).length, 1, "只有 fixture 审计");
});

test("C2 deferBlocked still returns a reviewable result through the hook", async (t) => {
  const { store, service } = await setup(t);
  await addHit(store, "person-1");
  const counts = instrument(service, store);
  let seen = null;
  const result = await probe(service, {
    counts,
    deferBlocked: true,
    prepareAttempt: async () => ({
      refs: [],
      beforeEvaluate: () => ({ snapshot: "review" }),
    }),
    beforeBuild: (state, eligibility, context) => { seen = { eligibility, context }; },
  });
  assert.equal(result.eligibility.eligible, false);
  assert.equal(result.eligibility.code, "BLACKLIST_REVIEW_REQUIRED");
  assert.deepEqual(seen.context, { snapshot: "review" });
  assert.deepEqual(counts, { prepare: 1, evaluate: 1, transact: 1, build: 1 });
  assert.equal((await store.list("blacklist_decisions", ORG)).length, 0, "钩子不得写决定");
});

test("C2 invalid hook contracts fail closed before the transaction", async (t) => {
  const { store, service } = await setup(t);
  const counts = instrument(service, store);
  for (const prepareAttempt of [
    async () => null,
    async () => ({}),
    async () => ({ refs: "nope", beforeEvaluate: () => null }),
    async () => ({ refs: [], beforeEvaluate: "nope" }),
    "not-a-function",
  ]) {
    await assert.rejects(probe(service, { prepareAttempt, counts }),
      (error) => error.code === "ADAPTER_UNAVAILABLE" && error.status === 503);
  }
  for (const refs of [
    [null], [{}], [{ collection: "", id: "x" }], [{ collection: "x", id: "" }],
    ["x"], [42], [{ collection: "x" }], [{ id: "x" }],
  ]) {
    await assert.rejects(probe(service, {
      counts,
      prepareAttempt: async () => ({ refs, beforeEvaluate: () => null }),
    }), (error) => error.code === "ADAPTER_UNAVAILABLE" && error.status === 503);
  }
  assert.equal(counts.transact, 0);
  assert.equal((await store.list("unique_claims", ORG)).length, 0);
});

test("C2 non-retry hook errors propagate once without rewriting state", async (t) => {
  const { store, service } = await setup(t);
  const counts = instrument(service, store);
  await assert.rejects(probe(service, {
    counts,
    prepareAttempt: async () => ({
      refs: [],
      beforeEvaluate: () => { failCode("CONFLICT", "钩子拒绝", 409); },
    }),
  }), (error) => error.code === "CONFLICT" && error.status === 409);
  assert.deepEqual(counts, { prepare: 1, evaluate: 0, transact: 1, build: 0 });
  assert.equal((await store.list("unique_claims", ORG)).length, 0);
  assert.equal((await store.list("eligibility_guards", ORG)).length, 0);
});

test("C2 a retry re-plans refs instead of reusing the stale attempt snapshot", async (t) => {
  const { store, service } = await setup(t);
  await store.transact([ref("rooms", "room-a"), ref("rooms", "room-b")], () => [
    { collection: "rooms", id: "room-a", data: { orgId: ORG, name: "A", revision: 1 } },
    { collection: "rooms", id: "room-b", data: { orgId: ORG, name: "B", revision: 1 } },
  ], audit);
  const counts = instrument(service, store);
  const seen = [];
  let attempt = 0;
  const result = await probe(service, {
    counts,
    prepareAttempt: async () => {
      attempt += 1;
      const current = attempt;
      const roomId = current === 1 ? "room-a" : "room-b";
      return {
        refs: [ref("rooms", roomId)],
        beforeEvaluate: (state) => {
          seen.push({ attempt: current, a: Boolean(state["rooms/room-a"]), b: Boolean(state["rooms/room-b"]) });
          if (current === 1) throw retry();
          return null;
        },
      };
    },
  });
  assert.deepEqual(seen, [
    { attempt: 1, a: true, b: false },
    { attempt: 2, a: false, b: true },
  ]);
  assert.equal(result.eligibility.eligible, true);
  assert.deepEqual(counts, { prepare: 2, evaluate: 1, transact: 2, build: 1 });
});

test("C2 merged base+prepared+token refs enter at 90 and fail closed at 91", async (t) => {
  const uniqueCount = (refs) => new Set(refs.map((item) => `${item.collection}/${item.id}`)).size;
  const filler = (count) => Array.from({ length: count }, (_, index) => ref("access_devices", `device-${index}`));

  const at90 = await setup(t);
  const token = await at90.service.prepareEligibility({
    personId: "person-1", occupancyId: "occupancy-person-1", identityApplicationId: "id-1",
  });
  const hookRefs = [ref("rooms", "room-a")];
  const placeholderClaim = ref("unique_claims", "placeholder");
  const needed = 90 - uniqueCount([placeholderClaim, ...hookRefs, ...token.refs]);
  const counts90 = instrument(at90.service, at90.store);
  const result = await probe(at90.service, {
    counts: counts90,
    extraRefs: filler(needed),
    prepareAttempt: async () => ({ refs: hookRefs, beforeEvaluate: () => null }),
  });
  assert.equal(result.eligibility.eligible, true);
  assert.deepEqual(counts90, { prepare: 1, evaluate: 1, transact: 1, build: 1 });
  assert.equal((await at90.store.list("unique_claims", ORG)).length, 1);

  const at91 = await setup(t);
  const counts91 = instrument(at91.service, at91.store);
  await assert.rejects(probe(at91.service, {
    counts: counts91,
    extraRefs: filler(needed + 1),
    prepareAttempt: async () => ({ refs: hookRefs, beforeEvaluate: () => null }),
  }), (error) => error.status === 400 && error.code === null);
  assert.deepEqual(counts91, { prepare: 1, evaluate: 0, transact: 0, build: 0 });
  assert.equal((await at91.store.list("unique_claims", ORG)).length, 0);

  const deduped = await setup(t);
  const countsDeduped = instrument(deduped.service, deduped.store);
  const duplicateHookRefs = [ref("persons", "person-1"), ref("rooms", "room-a")];
  const dedupedNeeded = 90 - uniqueCount([placeholderClaim, ...duplicateHookRefs, ...token.refs]);
  const dedupedResult = await probe(deduped.service, {
    counts: countsDeduped,
    extraRefs: filler(dedupedNeeded),
    prepareAttempt: async () => ({ refs: duplicateHookRefs, beforeEvaluate: () => null }),
  });
  assert.equal(dedupedResult.eligibility.eligible, true, "重复 ref 只计一次，不得把 90 推成 91");
  assert.equal(countsDeduped.transact, 1);
});

test("C2 a no-op hook keeps guard and decision side effects identical to no hook", async (t) => {
  const { store, service } = await setup(t);
  await probe(service, { personId: "person-1" });
  await probe(service, {
    personId: "person-2", identityApplicationId: "id-2",
    prepareAttempt: async () => ({ refs: [], beforeEvaluate: () => null }),
  });
  const guards = await store.list("eligibility_guards", ORG);
  assert.equal(guards.length, 4, "每次调用写入 person+identity 两个 subject guard");
  assert.ok(guards.every((guard) => guard.epoch === 1 && guard.revision === 1));
  assert.equal((await store.list("blacklist_decisions", ORG)).length, 0);
  assert.equal((await store.list("unique_claims", ORG)).length, 2);
  assert.equal((await store.list("admin_audit")).length, 3);
});

test("C2 prepare errors stay pre-transaction unless deferPrepareError is requested", async (t) => {
  const { store, service } = await setup(t);
  store.data.persons = store.data.persons.filter((row) => row._id !== "person-1");
  const counts = instrument(service, store);

  await assert.rejects(
    probe(service, { counts }),
    (error) => error.code === "NOT_FOUND" && error.status === 404,
  );
  await assert.rejects(
    probe(service, {
      counts,
      prepareAttempt: async () => ({ refs: [], beforeEvaluate: () => null }),
    }),
    (error) => error.code === "NOT_FOUND" && error.status === 404,
  );
  assert.deepEqual(counts, { prepare: 2, evaluate: 0, transact: 0, build: 0 });
});

test("C2 deferPrepareError runs beforeEvaluate once, then rethrows the prepare error", async (t) => {
  const { store, service } = await setup(t);
  store.data.persons = store.data.persons.filter((row) => row._id !== "person-1");
  const counts = instrument(service, store);
  const order = [];
  await assert.rejects(
    probe(service, {
      counts,
      deferPrepareError: true,
      prepareAttempt: async (token) => {
        assert.equal(token, null, "prepare 失败时 hook 显式收到 null token");
        return {
          refs: [],
          beforeEvaluate: () => { order.push("before"); return null; },
        };
      },
      beforeBuild: () => { order.push("build"); },
    }),
    (error) => error.code === "NOT_FOUND" && error.status === 404,
  );
  assert.deepEqual(order, ["before"]);
  assert.deepEqual(counts, { prepare: 1, evaluate: 0, transact: 1, build: 0 });
});
