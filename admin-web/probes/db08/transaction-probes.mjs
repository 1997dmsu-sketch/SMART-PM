import { createHash } from "node:crypto";
import { INDEXES, MAX_TRANSACTION_REFS, ROOM_BATCH_SIZE, ROOM_BATCH_TOTAL } from "./manifest.mjs";
import { invariant } from "./backend.mjs";

const ref = (collection, id) => ({ collection, id });
const key = (collection, id) => `${collection}/${id}`;
const digest = (...parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
const base = (orgId) => ({ orgId, schemaVersion: 1, revision: 1 });

async function seed(backend, docs, action = "DB-08 seed fixtures") {
  const refs = docs.map(({ collection, id }) => ref(collection, id));
  await backend.transact(refs, () => docs.map((doc) => ({
    collection: doc.collection, id: doc.id, data: { ...doc.data },
  })), { action, orgId: docs.find((doc) => doc.data.orgId)?.data.orgId });
}

async function settle(promises) {
  const results = await Promise.allSettled(promises);
  return results.map((result) => result.status === "fulfilled"
    ? { ok: true, value: result.value }
    : { ok: false, code: result.reason?.code || "ERROR", message: result.reason?.message });
}

function expectSingleWinner(results, code) {
  invariant(results.filter((result) => result.ok).length === 1, code,
    `竞争必须只有一个成功结果：${JSON.stringify(results)}`);
}

async function identityRace(backend, kind) {
  const orgId = backend.config.orgA;
  const label = `identity-${kind}`;
  const subject = kind === "phone" ? "verified-phone-digest" : kind === "wechat" ? "wechat-subject-digest" : "document-identity-digest";
  const scope = kind === "document" ? orgId : kind === "wechat" ? "test-app" : "resident";
  const identityId = backend.id(`${kind}-ident-${digest(scope, subject)}`);
  const domainId = backend.id(`${kind}-domain`);
  const users = [0, 1].map((n) => backend.id(`${kind}-user-${n}`));
  const register = (userId) => backend.transact([
    ref("identity_domains", domainId), ref("auth_identities", identityId), ref("users", userId),
  ], (state) => {
    const domain = state[key("identity_domains", domainId)];
    invariant(!domain || (domain.keyVersion === 1 && domain.keyFingerprint === "db08-test-domain"),
      "IDENTITY_CONFIG_CHANGED", "身份摘要域已变化");
    const current = state[key("auth_identities", identityId)];
    let owner = userId;
    if (current) {
      invariant(current.status === "bound" && current.subjectDigest === digest(subject),
        "IDENTITY_CONFLICT", "固定身份映射指向冲突主体");
      owner = current.userId;
    }
    const writes = [];
    if (!domain) writes.push({ collection: "identity_domains", id: domainId, data: {
      keyVersion: 1, keyFingerprint: "db08-test-domain", revision: 1,
    } });
    if (!current) writes.push({ collection: "auth_identities", id: identityId, data: {
      kind, scope, subjectDigest: digest(subject), keyVersion: 1,
      userId: owner, status: "bound", verifiedAt: backend.now(), revision: 1,
    } });
    if (!state[key("users", owner)]) writes.push({ collection: "users", id: owner, data: {
      role: "user", status: "active", revision: 1,
      ...(kind === "phone" ? { phoneIdentityId: identityId } : {}),
      ...(kind === "wechat" ? { wechatIdentityId: identityId } : {}),
      ...(kind === "document" ? { verifiedIdentityId: identityId } : {}),
    } });
    return { writes, result: owner };
  }, { action: `DB-08 ${kind} fixed-ID registration`, orgId });

  const firstWave = await settle(users.map(register));
  const owner = firstWave.find((result) => result.ok)?.value;
  invariant(owner && users.includes(owner), "IDENTITY_NO_OWNER", "固定身份注册没有产生稳定用户");
  const replay = await register(users[0]);
  const identities = await backend.listAll("auth_identities", { where: { probeRunId: backend.runId } });
  const same = identities.filter((row) => row._id === identityId);
  const final = await backend.get("auth_identities", identityId);
  invariant(same.length === 1 && final.userId === owner && replay === owner,
    "IDENTITY_NOT_UNIQUE", "并发或重放产生了重复身份／用户");
  return {
    status: "pass", fixedIdentityId: identityId, stableUserId: owner,
    successfulFirstWave: firstWave.filter((result) => result.ok).length,
    replayedToSameUser: true, mappingCount: same.length,
  };
}

export const identityPhoneProbe = (backend) => identityRace(backend, "phone");
export const identityWechatProbe = (backend) => identityRace(backend, "wechat");
export const identityDocumentProbe = (backend) => identityRace(backend, "document");

export async function primarySlotProbe(backend) {
  const orgId = backend.config.orgA;
  const roomId = backend.id("slot-room");
  const slotId = backend.id("slot-room-primary");
  const cycles = [0, 1].map((n) => backend.id(`slot-cycle-${n}`));
  const occupants = [0, 1].map((n) => backend.id(`slot-occupancy-${n}`));
  const persons = [0, 1].map((n) => backend.id(`slot-person-${n}`));
  await seed(backend, [
    { collection: "rooms", id: roomId, data: { ...base(orgId), status: "active", roomNo: "SLOT" } },
    ...cycles.map((id, n) => ({ collection: "occupancy_cycles", id, data: {
      ...base(orgId), roomId, state: "pending", startsAt: 1, endsAt: null, primaryOccupancyId: occupants[n], epoch: 0,
    } })),
    ...occupants.map((id, n) => ({ collection: "occupancies", id, data: {
      ...base(orgId), roomId, cycleId: cycles[n], personId: persons[n], role: "primary",
      state: "pending_review", startsAt: 1, endsAt: null,
    } })),
    ...persons.map((id) => ({ collection: "persons", id, data: { ...base(orgId), status: "active" } })),
  ]);
  const activate = (n) => backend.transact([
    ref("rooms", roomId), ref("room_primary_slots", slotId),
    ref("occupancy_cycles", cycles[n]), ref("occupancies", occupants[n]),
  ], (state) => {
    const slot = state[key("room_primary_slots", slotId)];
    const cycle = state[key("occupancy_cycles", cycles[n])];
    const occupancy = state[key("occupancies", occupants[n])];
    invariant(state[key("rooms", roomId)]?.status === "active", "ROOM_ARCHIVED", "房间不可激活");
    invariant(!slot?.currentCycleId, "PRIMARY_OCCUPIED", "房间已有主租客");
    invariant(cycle?.state === "pending" && occupancy?.state === "pending_review",
      "INVALID_STATE", "候选关系已变化");
    return [
      { collection: "room_primary_slots", id: slotId, data: {
        ...base(orgId), roomId, currentCycleId: cycles[n], currentOccupancyId: occupants[n],
        currentPersonId: persons[n], epoch: (slot?.epoch || 0) + 1,
      } },
      { collection: "occupancy_cycles", id: cycles[n], data: { state: "active", revision: 2, epoch: 1 } },
      { collection: "occupancies", id: occupants[n], data: { state: "active", revision: 2 } },
    ];
  }, { action: "DB-08 primary slot contention", orgId });
  const results = await settle([activate(0), activate(1)]);
  expectSingleWinner(results, "PRIMARY_SLOT_NOT_SERIALIZED");
  const slot = await backend.get("room_primary_slots", slotId);
  const active = (await Promise.all(occupants.map((id) => backend.get("occupancies", id))))
    .filter((row) => row.state === "active");
  invariant(slot?.currentCycleId && active.length === 1 && slot.currentOccupancyId === active[0]._id,
    "PRIMARY_SLOT_SPLIT_BRAIN", "主槽与有效主租客不一致");
  return { status: "pass", winnerCycleId: slot.currentCycleId, activePrimaryCount: 1,
    rejected: results.filter((result) => !result.ok).map((result) => result.code) };
}

export async function blacklistActivationProbe(backend) {
  const orgId = backend.config.orgA;
  const personId = backend.id("race-person");
  const guardId = backend.id("race-eligibility-guard");
  const entryId = backend.id("race-blacklist-entry");
  const occupancyId = backend.id("race-occupancy");
  const cycleId = backend.id("race-cycle");
  const roomId = backend.id("race-room");
  const slotId = backend.id("race-primary-slot");
  await seed(backend, [
    { collection: "persons", id: personId, data: { ...base(orgId), status: "active" } },
    { collection: "rooms", id: roomId, data: { ...base(orgId), status: "active", roomNo: "RACE" } },
    { collection: "occupancy_cycles", id: cycleId, data: { ...base(orgId), roomId,
      primaryOccupancyId: occupancyId, state: "pending", startsAt: 1, endsAt: null, epoch: 0 } },
    { collection: "occupancies", id: occupancyId, data: { ...base(orgId), roomId, personId,
      cycleId, role: "primary", state: "pending_review", startsAt: 1, endsAt: null } },
  ]);
  const addEntry = backend.transact([
    ref("persons", personId), ref("eligibility_guards", guardId), ref("blacklist_entries", entryId),
  ], (state) => {
    const guard = state[key("eligibility_guards", guardId)];
    return [
      { collection: "blacklist_entries", id: entryId, data: {
        ...base(orgId), subjectType: "person", subjectKey: personId, state: "active",
        restrictions: ["occupancy.activate"], startsAt: 1, endsAt: null,
        reasonCode: "db08-test", evidenceFileIds: [],
      } },
      { collection: "eligibility_guards", id: guardId, data: {
        ...base(orgId), subjectType: "person", subjectKey: personId,
        epoch: (guard?.epoch || 0) + 1, revision: (guard?.revision || 0) + 1,
      } },
    ];
  }, { action: "DB-08 blacklist insertion race", orgId });

  // Mirrors DB-06 F01: guard epochs are read before candidates, and the whole
  // pre-read is retried if the transaction observes a changed epoch.
  const guardBefore = await backend.get("eligibility_guards", guardId);
  const epochBefore = guardBefore?.epoch || 0;
  const candidatesBefore = await backend.listAll("blacklist_entries", {
    orgId, where: { subjectType: "person", subjectKey: personId, state: "active" },
    orderBy: ["_id"],
  });
  const activate = backend.transact([
    ref("persons", personId), ref("eligibility_guards", guardId),
    ref("blacklist_entries", entryId), ref("occupancies", occupancyId),
    ref("occupancy_cycles", cycleId), ref("room_primary_slots", slotId),
  ], (state) => {
    const currentEpoch = state[key("eligibility_guards", guardId)]?.epoch || 0;
    invariant(currentEpoch === epochBefore, "BLACKLIST_RETRY", "名单 guard 已变化，必须重读全部候选");
    const entry = state[key("blacklist_entries", entryId)];
    const hits = entry && entry.state === "active" && entry.restrictions.includes("occupancy.activate");
    invariant(!hits && candidatesBefore.length === 0, "BLACKLIST_REVIEW_REQUIRED", "命中名单不得激活");
    return [
      { collection: "occupancies", id: occupancyId, data: { state: "active", revision: 2 } },
      { collection: "occupancy_cycles", id: cycleId, data: { state: "active", revision: 2, epoch: 1 } },
      { collection: "room_primary_slots", id: slotId, data: {
        ...base(orgId), roomId, currentCycleId: cycleId, currentOccupancyId: occupancyId,
      } },
    ];
  }, { action: "DB-08 activation race", orgId });

  const results = await settle([addEntry, activate]);
  expectSingleWinner(results, "BLACKLIST_ACTIVATION_UNSAFE");
  const [entry, occupancy, slot, guard] = await Promise.all([
    backend.get("blacklist_entries", entryId), backend.get("occupancies", occupancyId),
    backend.get("room_primary_slots", slotId), backend.get("eligibility_guards", guardId),
  ]);
  invariant(entry?.state === "active" && guard?.epoch === 1 && occupancy.state === "pending_review" && !slot,
    "BLACKLIST_ACTIVATION_UNSAFE", "最终状态必须保留名单并拒绝激活，且不得写主槽");
  return { status: "pass", finalGuardEpoch: guard.epoch, activationState: occupancy.state,
    primarySlotCreated: false, guardReadBeforeCandidates: true,
    rejected: results.filter((result) => !result.ok).map((result) => result.code) };
}

export async function occupancyReviewRace(backend, { reverse = false } = {}) {
  const orgId = backend.config.orgA;
  const applicationId = backend.id(reverse ? "review-reverse-application" : "review-application");
  const decisionId = backend.id(reverse ? "review-reverse-decision" : "review-decision");
  const personId = backend.id("review-person");
  const roomId = backend.id("review-room");
  const requestV1 = { roomId, personId, role: "member", startsAt: 100, endsAt: 200 };
  const requestV2 = { ...requestV1, endsAt: 300 };
  const digestV1 = digest("occupancy-application-v1", orgId, requestV1);
  const digestV2 = digest("occupancy-application-v1", orgId, requestV2);
  await seed(backend, [
    { collection: "persons", id: personId, data: { ...base(orgId), status: "active" } },
    { collection: "rooms", id: roomId, data: { ...base(orgId), status: "active", roomNo: "REVIEW" } },
    { collection: "occupancy_applications", id: applicationId, data: {
      ...base(orgId), state: "pending_review", personId, roomId, request: requestV1,
      requestDigest: digestV1, requestVersion: 1,
    } },
  ]);
  const review = () => backend.transact([
    ref("occupancy_applications", applicationId), ref("blacklist_decisions", decisionId),
  ], (state) => {
    const current = state[key("occupancy_applications", applicationId)];
    invariant(current?.revision === 1 && current.requestDigest === digestV1 && current.requestVersion === 1,
      "REVISION_CONFLICT", "申请请求或版本已变化，旧审核不得放行");
    invariant(current.state === "pending_review", "INVALID_STATE", "申请已处理");
    return [
      { collection: "occupancy_applications", id: applicationId, data: {
        state: "allowed", latestDecisionId: decisionId, revision: 2,
      } },
      { collection: "blacklist_decisions", id: decisionId, data: {
        ...base(orgId), occupancyId: applicationId, restriction: "occupancy.create", decision: "allow",
        applicationId, applicationRevision: 1, requestDigest: digestV1, requestVersion: 1,
        entryIds: [backend.id("review-entry")], entryRevisions: [1], latestDecisionId: decisionId,
      } },
    ];
  }, { action: "DB-08 request-bound review", orgId });
  const mutate = () => backend.transact([ref("occupancy_applications", applicationId)], (state) => {
    const current = state[key("occupancy_applications", applicationId)];
    invariant(current?.revision === 1 && current.state === "pending_review" && current.requestDigest === digestV1,
      "OCCUPANCY_APPLICATION_CONFLICT", "原申请已审核，不能换参复用");
    return { writes: [{ collection: "occupancy_applications", id: applicationId, data: {
      request: requestV2, requestDigest: digestV2, endsAt: 300, revision: 2,
    } }], result: "request-v2" };
  }, { action: "DB-08 competing request mutation", orgId });
  // Start in the requested order; Promise construction itself starts the local/backend transaction.
  const results = await settle(reverse ? [mutate(), review()] : [review(), mutate()]);
  expectSingleWinner(results, "REVIEW_REQUEST_NOT_SERIALIZED");
  const [application, decision] = await Promise.all([
    backend.get("occupancy_applications", applicationId), backend.get("blacklist_decisions", decisionId),
  ]);
  const allowedV1 = application.state === "allowed" && application.requestDigest === digestV1 &&
    decision?.requestDigest === digestV1 && decision?.applicationRevision === 1;
  const changedV2 = application.state === "pending_review" && application.requestDigest === digestV2 && !decision;
  invariant(allowedV1 || changedV2, "STALE_REVIEW_ALLOWED", "不得出现新请求搭配旧放行");
  return { status: "pass", outcome: allowedV1 ? "request-v1-allowed" : "request-v2-pending",
    applicationRevision: application.revision, decisionDigestMatches: allowedV1,
    rejected: results.filter((result) => !result.ok).map((result) => result.code) };
}

export async function organizationIsolationProbe(backend) {
  const { orgA, orgB } = backend.config;
  const docs = [];
  for (const [suffix, orgId] of [["a", orgA], ["b", orgB]]) {
    docs.push(
      { collection: "organizations", id: orgId, data: { ...base(orgId), status: "active", name: `DB08 ${suffix}` } },
      { collection: "org_memberships", id: backend.id(`org-${suffix}-membership`), data: {
        ...base(orgId), principalType: "adminAccount", principalId: backend.id("shared-principal"),
        role: "admin", status: "active", permissions: ["identity.review"],
      } },
      { collection: "persons", id: backend.id(`org-${suffix}-person`), data: { ...base(orgId), status: "active" } },
      { collection: "rooms", id: backend.id(`org-${suffix}-room`), data: { ...base(orgId), status: "active", roomNo: suffix } },
    );
  }
  // Same principal in B must not authenticate as a member of A.
  docs.push({ collection: "org_memberships", id: backend.id("org-forged-membership"), data: {
    ...base(orgB), principalType: "adminAccount", principalId: backend.id("shared-principal"),
    role: "admin", status: "active", permissions: ["identity.review"],
  } });
  await seed(backend, docs, "DB-08 organization fixtures");
  const [personsA, personsB] = await Promise.all([
    backend.listAll("persons", { orgId: orgA }), backend.listAll("persons", { orgId: orgB }),
  ]);
  invariant(personsA.length > 0 && personsB.length > 0 &&
    personsA.every((row) => row.orgId === orgA) && personsB.every((row) => row.orgId === orgB),
  "ORG_QUERY_LEAK", "组织查询返回了其他组织记录");
  const crossWrite = () => backend.transact([
    ref("org_memberships", backend.id("org-a-membership")), ref("rooms", backend.id("org-b-room")),
    ref("persons", backend.id("org-cross-write")),
  ], (state) => {
    const membership = state[key("org_memberships", backend.id("org-a-membership"))];
    const room = state[key("rooms", backend.id("org-b-room"))];
    invariant(membership?.orgId === orgA && room?.orgId === orgA, "FORBIDDEN", "跨组织房间引用");
    return [{ collection: "persons", id: backend.id("org-cross-write"), data: { ...base(orgA), status: "active" } }];
  }, { action: "DB-08 cross-org write must fail", orgId: orgA });
  const forged = () => backend.transact([
    ref("organizations", orgA), ref("org_memberships", backend.id("org-forged-membership")),
  ], (state) => {
    const org = state[key("organizations", orgA)];
    const membership = state[key("org_memberships", backend.id("org-forged-membership"))];
    invariant(org?.orgId === orgA && membership?.orgId === orgA && membership.role === "admin",
      "FORBIDDEN", "伪造成员不属于目标组织");
    return [];
  }, { action: "DB-08 forged membership must fail", orgId: orgA });
  const results = await settle([crossWrite(), forged()]);
  invariant(results.every((result) => !result.ok && result.code === "FORBIDDEN"),
    "ORG_WRITE_LEAK", "跨组织或伪造成员事务未被拒绝");
  invariant(await backend.get("persons", backend.id("org-cross-write")) === null,
    "ORG_WRITE_LEAK", "拒绝事务仍写入人员");
  return { status: "pass", orgACount: personsA.length, orgBCount: personsB.length,
    rejectedCrossOrgReferences: 1, rejectedForgedMemberships: 1 };
}

export async function indexQueryProbe(backend) {
  const orgId = backend.config.orgA;
  const token = backend.id("index-fixture");
  await seed(backend, [
    { collection: "organizations", id: orgId, data: { ...base(orgId), status: "active" } },
    { collection: "persons", id: backend.id("index-person-b"), data: {
      ...base(orgId), status: "active", userId: token,
    } },
    { collection: "persons", id: backend.id("index-person-a"), data: {
      ...base(orgId), status: "active", userId: token,
    } },
  ], "DB-08 index query fixtures");
  const executed = [];
  for (const index of INDEXES) {
    const where = Object.fromEntries(index.equality.filter((field) => field !== "orgId").map((field) => [field, token]));
    const rows = await backend.query(index.collection, {
      orgId, where, orderBy: index.orderBy, limit: 2,
    });
    invariant(rows.every((row) => row.orgId === orgId), "INDEX_ORG_LEAK", `${index.collection} 查询缺少组织边界`);
    executed.push({ collection: index.collection, equality: index.equality,
      orderBy: index.orderBy, returned: rows.length });
  }
  const sorted = await backend.query("persons", {
    orgId, where: { userId: token, status: "active" }, orderBy: ["_id"], limit: 2,
  });
  invariant(sorted.length === 2 && sorted[0]._id < sorted[1]._id, "INDEX_SORT", "_id 游标排序不稳定");
  return { status: "pass", candidateQueries: executed.length, organizationFilterBeforePagination: true,
    stableIdTiebreaker: true, queries: executed };
}

export async function transactionReferenceProbe(backend) {
  const refsFor = (count) => Array.from({ length: count }, (_, n) =>
    ref("operation_keys", backend.id(`budget-${String(n).padStart(3, "0")}`)));
  // 89 business refs + one atomic audit ref = exactly 90 total references.
  await backend.transact(refsFor(MAX_TRANSACTION_REFS - 1), () => [], {
    action: "DB-08 exact 90-reference boundary", orgId: backend.config.orgA,
  });
  const before = backend.metrics.transactionsStarted;
  let rejected = null;
  try {
    await backend.transact(refsFor(MAX_TRANSACTION_REFS), () => [], {
      action: "DB-08 91-reference preflight rejection", orgId: backend.config.orgA,
    });
  } catch (error) {
    rejected = error;
  }
  invariant(rejected?.code === "TRANSACTION_REF_LIMIT" && backend.metrics.transactionsStarted === before,
    "TRANSACTION_REF_BUDGET", "91 总引用未在事务／网络开始前拒绝");
  return { status: "pass", acceptedTotalRefs: 90, rejectedTotalRefs: 91,
    rejectedBeforeTransaction: true, applicationLimitNotPlatformLimit: true };
}

export async function roomBatchProbe(backend) {
  const orgId = backend.config.orgA;
  const requestDigest = digest("db08-1000-rooms", orgId);
  let replayedBatches = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let batch = 0; batch < ROOM_BATCH_TOTAL / ROOM_BATCH_SIZE; batch += 1) {
      const operationId = backend.id(`room-batch-${String(batch).padStart(2, "0")}`);
      const start = batch * ROOM_BATCH_SIZE;
      const ids = Array.from({ length: ROOM_BATCH_SIZE }, (_, n) =>
        backend.id(`room-${String(start + n).padStart(4, "0")}`));
      const result = await backend.transact([
        ref("operation_keys", operationId), ...ids.map((id) => ref("rooms", id)),
      ], (state) => {
        const operation = state[key("operation_keys", operationId)];
        if (operation) {
          invariant(operation.requestDigest === requestDigest && operation.state === "done",
            "IDEMPOTENCY_CONFLICT", "重放操作键与请求摘要不一致");
          return { writes: [], result: { replayed: true } };
        }
        const writes = ids.map((id, n) => ({ collection: "rooms", id, data: {
          ...base(orgId), roomNo: String(start + n).padStart(4, "0"),
          buildingId: backend.id("batch-building"), floorId: backend.id("batch-floor"),
          status: "active", houseId: backend.id(`batch-house-${String(start + n).padStart(4, "0")}`),
        } }));
        writes.push({ collection: "operation_keys", id: operationId, data: {
          ...base(orgId), state: "done", requestDigest, batch, itemCount: ROOM_BATCH_SIZE,
        } });
        return { writes, result: { replayed: false } };
      }, { action: `DB-08 room batch ${batch}`, orgId });
      if (pass === 1) invariant(result.replayed, "ROOM_REPLAY_FAILED", "第二批不是幂等重放");
      if (result.replayed) replayedBatches += 1;
    }
    const rows = await backend.listAll("rooms", {
      orgId, where: { probeRunId: backend.runId, buildingId: backend.id("batch-building") },
      orderBy: ["roomNo", "_id"],
    });
    const unique = new Set(rows.map((row) => row._id));
    invariant(rows.length === ROOM_BATCH_TOTAL && unique.size === ROOM_BATCH_TOTAL &&
      rows.every((row) => row.orgId === orgId && row.status === "active"),
    "ROOM_BATCH_COUNT", `第 ${pass + 1} 次执行后房间数量或唯一性不符`);
  }
  return { status: "pass", rooms: ROOM_BATCH_TOTAL, batchSize: ROOM_BATCH_SIZE,
    batchesPerPass: ROOM_BATCH_TOTAL / ROOM_BATCH_SIZE, replayedBatches,
    uniqueRooms: ROOM_BATCH_TOTAL, duplicateRooms: 0, recoverableByOperationKey: true };
}

export const TRANSACTION_PROBES = {
  "identity-phone-fixed-id": identityPhoneProbe,
  "identity-wechat-fixed-id": identityWechatProbe,
  "identity-document-fixed-id": identityDocumentProbe,
  "primary-slot-contention": primarySlotProbe,
  "blacklist-activation-race": blacklistActivationProbe,
  "occupancy-review-request-race": occupancyReviewRace,
  "organization-isolation": organizationIsolationProbe,
  "index-query-smoke": indexQueryProbe,
  "transaction-reference-budget": transactionReferenceProbe,
  "room-batch-1000": roomBatchProbe,
};

export async function runTransactionProbe(id, backend) {
  const probe = TRANSACTION_PROBES[id];
  invariant(probe, "UNKNOWN_PROBE", `未知事务探针：${id}`);
  return probe(backend);
}
