import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { INDEXES, MAX_TRANSACTION_REFS, ROOM_BATCH_SIZE, ROOM_BATCH_TOTAL } from "./manifest.mjs";
import { invariant } from "./backend.mjs";
import { ServiceStore, createIdentityService, createServiceContext } from "./service-store.mjs";
import { VerificationService } from "../../lib/verification.mjs";
import { BlacklistService, blacklistDecisionHeadId } from "../../lib/blacklist.mjs";
import { OccupancyService, primarySlotId } from "../../lib/occupancies.mjs";
import { OrgPropertyService, OpReplay } from "../../lib/property-v2.mjs";
import { claimId } from "../../lib/claims.mjs";

const ref = (collection, id) => ({ collection, id });
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const outcomes = async (promises) => Promise.allSettled(promises);
const errorCode = (result) => result.status === "rejected"
  ? result.reason?.code || result.reason?.message || "ERROR" : null;

async function identityLoginProbe(backend, kind, { winner = 0 } = {}) {
  invariant(winner === 0 || winner === 1, "PARAM_ERROR", "winner 必须为 0 或 1");
  const callers = [0, 1].map((index) => createIdentityService(backend, {
    // Delay only the losing candidate's first transaction. Its pre-read then
    // misses the winner's mapping, exercising IdentityService's owner-ref retry.
    beforeTransact: async (_refs, call) => {
      if (index !== winner && call === 1) await delay(25);
    },
  }));
  const input = kind === "phone"
    ? { phone: "+8613800000000" }
    : { wechat: { appId: "db08-isolated-app", openid: "synthetic-wechat-subject" } };
  const identity = kind === "phone"
    ? callers[0].service.phoneIdentity(input.phone)
    : callers[0].service.wechatIdentity(input.wechat);
  const requests = callers.map(({ service }, index) => service.login(input, {
    actorId: backend.id(`identity-${kind}-${index}`), actorType: "user",
    action: `DB-08 ${kind} login`, orgId: backend.config.orgA,
  }));
  const settled = await outcomes(requests);
  invariant(settled.every((result) => result.status === "fulfilled"), "IDENTITY_LOGIN_FAILED",
    `两个正式登录请求都应解析成功：${settled.map(errorCode).join(",")}`);
  const userIds = settled.map((result) => result.value.userId);
  invariant(userIds[0] === userIds[1], "IDENTITY_FORK", "两个请求解析到了不同用户");
  const candidates = callers.map(({ store }) => store.transactionHistory[0]?.refs
    .find((item) => item.collection === "users")?.id);
  invariant(candidates.every(Boolean), "IDENTITY_OBSERVATION", "未记录两个原始候选用户 ID");
  invariant(userIds[0] === candidates[winner], "IDENTITY_WRONG_WINNER",
    `预期候选 ${winner} 获胜，实际解析 ${userIds[0]}；候选为 ${candidates.join(",")}`);
  const loserCalls = callers[1 - winner].store.transactionCalls;
  invariant(loserCalls >= 2, "IDENTITY_RETRY_NOT_OBSERVED", "落后请求未发生正式 owner-ref 重试");
  const mappings = (await callers[0].store.list("auth_identities"))
    .filter((row) => row._id === identity.id);
  const users = (await callers[0].store.list("users")).filter((row) => userIds.includes(row._id));
  invariant(mappings.length === 1 && mappings[0].userId === userIds[0] && users.length === 1,
    "IDENTITY_NOT_UNIQUE", "正式身份映射或用户数量不唯一");
  return {
    status: "pass", productionMethod: "IdentityService.login",
    fixedIdentityId: identity.id, stableUserId: userIds[0], winnerCandidate: winner,
    bothRequestsResolved: true, loserTransactionCalls: loserCalls,
    ownerRefRetryObserved: true, mappingCount: mappings.length,
  };
}

export const identityPhoneProbe = (backend, options) => identityLoginProbe(backend, "phone", options);
export const identityWechatProbe = (backend, options) => identityLoginProbe(backend, "wechat", options);

export async function identityDocumentProbe(backend, { winner = 0 } = {}) {
  invariant(winner === 0 || winner === 1, "PARAM_ERROR", "winner 必须为 0 或 1");
  const context = await createServiceContext(backend, `document-${winner}`);
  const persons = [];
  for (const name of ["证件候选甲", "证件候选乙"])
    persons.push((await context.persons.createPerson({ name }, context.audit)).personId);
  const applications = [];
  for (const personId of persons) {
    const created = await context.verificationAdmin.createApplication({ personId, documentType: "id-card" }, context.audit);
    await context.verificationAdmin.submit(created.applicationId, {
      expectedRevision: 1,
      document: { name: "同一合成证件", documentNumber: "DB08DUPLICATE001" },
      fileIds: [backend.id("document-synthetic-private-file")],
    }, context.audit);
    applications.push(created.applicationId);
  }
  const reviewers = applications.map((_id, index) => {
    const store = new ServiceStore(backend, {
      beforeTransact: async (_refs, call) => {
        if (index !== winner && call === 1) await delay(25);
      },
    });
    return new VerificationService(store, context.orgA, { membershipId: context.reviewerMembershipId }, {
      identity: context.identity,
    });
  });
  const settled = await outcomes(reviewers.map((reviewer, index) => reviewer.review(applications[index], {
    decision: "approve", reason: "证件固定声明竞争", expectedRevision: 2, documentVersion: 1,
  }, context.reviewerAudit)));
  invariant(settled.filter((result) => result.status === "fulfilled").length === 1,
    "DOCUMENT_REVIEW_NOT_UNIQUE", `证件审核必须仅一个成功：${settled.map(errorCode).join(",")}`);
  invariant(settled[1 - winner].status === "rejected" && errorCode(settled[1 - winner]) === "IDENTITY_CONFLICT",
    "DOCUMENT_REVIEW_WRONG_WINNER", "预定候选未按正式 unique_claim 协议获胜");
  invariant(settled[winner].status === "fulfilled" && settled[winner].value.applicationId === applications[winner],
    "DOCUMENT_REVIEW_WRONG_WINNER", "正式审核获胜申请不符");
  const submitted = (await context.store.list("identity_applications", context.orgA))
    .find((row) => row._id === applications[0]);
  const claim = claimId("verified-person", `${context.orgA}|id-card`, submitted.identityDigest);
  const claims = (await context.store.list("unique_claims", context.orgA))
    .filter((row) => row._id === claim && row.namespace === "verified-person" && row.state === "bound");
  invariant(claims.length === 1 && claims[0].ownerId === persons[winner],
    "DOCUMENT_CLAIM_MISMATCH", "verified-person 固定声明未指向获胜人员");
  return {
    status: "pass", productionMethod: "VerificationService.review",
    claimId: claim, stablePersonId: persons[winner], winnerCandidate: winner,
    approvedApplicationId: applications[winner], rejectedCode: errorCode(settled[1 - winner]),
    verifiedPersonClaimCount: claims.length,
  };
}

export async function primarySlotProbe(backend) {
  const context = await createServiceContext(backend, "primary-slot");
  const roomId = await context.makeRoom("SLOT");
  const persons = [];
  const approved = [];
  for (const name of ["主租客甲", "主租客乙"]) {
    const personId = (await context.persons.createPerson({ name }, context.audit)).personId;
    persons.push(personId);
    approved.push(await context.approve(personId));
  }
  const created = [];
  for (let index = 0; index < 2; index += 1) {
    created.push(await context.service.createCycle(roomId, {
      primaryPersonId: persons[index], startsAt: context.now(), endsAt: null,
      occupancyId: backend.id(`primary-candidate-${index}`),
    }, context.audit));
  }
  const settled = await outcomes(created.map((cycle, index) => context.service.activate(cycle.occupancyId, {
    expectedRevision: cycle.revision, identityApplicationId: approved[index],
  }, context.audit)));
  invariant(settled.filter((result) => result.status === "fulfilled").length === 1,
    "PRIMARY_SLOT_NOT_SERIALIZED", "正式主租客激活必须只有一个成功");
  const slotId = primarySlotId(context.orgA, roomId);
  const slot = (await context.store.list("room_primary_slots", context.orgA)).find((row) => row._id === slotId);
  const active = (await context.store.list("occupancies", context.orgA))
    .filter((row) => row.state === "active" && created.some((cycle) => cycle.occupancyId === row._id));
  invariant(slot && active.length === 1 && slot.currentOccupancyId === active[0]._id,
    "PRIMARY_SLOT_SPLIT_BRAIN", "正式主槽与有效主关系不一致");
  return {
    status: "pass", productionMethod: "OccupancyService.createCycle + OccupancyService.activate",
    winnerOccupancyId: active[0]._id, activePrimaryCount: active.length,
    rejected: settled.filter((result) => result.status === "rejected").map(errorCode),
  };
}

export async function blacklistActivationProbe(backend) {
  const context = await createServiceContext(backend, "blacklist-activation");
  const roomId = await context.makeRoom("RACE");
  const personId = (await context.persons.createPerson({ name: "名单竞争住户" }, context.audit)).personId;
  const identityApplicationId = await context.approve(personId);
  const created = await context.service.createCycle(roomId, {
    primaryPersonId: personId, startsAt: context.now(), endsAt: null,
    occupancyId: backend.id("blacklist-race-occupancy"),
  }, context.audit);

  let release;
  let signal;
  const seen = new Promise((resolve) => { signal = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  let intercepted = false;
  const activationStore = new ServiceStore(backend, {
    afterList: async (collection, _orgId, rows) => {
      if (collection === "blacklist_entries" && !intercepted) {
        intercepted = true;
        signal();
        // Return the already-read stale candidate array only after the formal
        // createEntry commits. The changed guard must force withEligibility retry.
        await gate;
      }
      return rows;
    },
  });
  const blacklist = new BlacklistService(activationStore, context.orgA, null, { now: context.now });
  const activationService = new OccupancyService(activationStore, context.orgA, {
    membershipId: context.adminMembershipId,
  }, { blacklist, now: context.now });
  const activation = activationService.activate(created.occupancyId, {
    expectedRevision: created.revision, identityApplicationId,
  }, context.audit);
  await seen;
  const entry = await context.reviewerBlacklist.createEntry({
    subjectType: "person", personId, reason: "DB-08 合成名单竞争", reasonCode: "db08-test",
    evidenceFileIds: [], restrictions: ["occupancy.activate"], startsAt: context.now(), endsAt: null,
  }, context.reviewerAudit);
  release();
  const result = await outcomes([activation]);
  invariant(result[0].status === "rejected" && errorCode(result[0]) === "BLACKLIST_REVIEW_REQUIRED",
    "BLACKLIST_ACTIVATION_UNSAFE", `正式激活未被名单阻断：${errorCode(result[0])}`);
  const entryRows = (await context.store.list("blacklist_entries", context.orgA))
    .filter((row) => row._id === entry.entryId);
  const occupancy = (await context.store.list("occupancies", context.orgA))
    .find((row) => row._id === created.occupancyId);
  const slotId = primarySlotId(context.orgA, roomId);
  const slots = (await context.store.list("room_primary_slots", context.orgA)).filter((row) => row._id === slotId);
  const candidateReads = activationStore.listCalls.filter((call) => call.collection === "blacklist_entries").length;
  invariant(entryRows.length === 1 && occupancy.state === "pending_review" && slots.length === 0 && candidateReads >= 2,
    "BLACKLIST_ACTIVATION_UNSAFE", "名单、入住、主槽或正式重读状态不符");
  return {
    status: "pass",
    productionMethod: "BlacklistService.createEntry + BlacklistService.withEligibility + OccupancyService.activate",
    entryId: entry.entryId, activationState: occupancy.state, primarySlotCreated: false,
    candidateReads, eligibilityRetryObserved: candidateReads >= 2,
  };
}

export async function occupancyReviewRace(backend, { reverse = false } = {}) {
  const context = await createServiceContext(backend, reverse ? "review-reverse" : "review-first");
  const roomId = await context.makeRoom("REVIEW");
  const personId = (await context.persons.createPerson({ name: "待审入住人" }, context.audit)).personId;
  const entry = await context.reviewerBlacklist.createEntry({
    subjectType: "person", personId, reason: "DB-08 创建复核", reasonCode: "db08-test",
    evidenceFileIds: [], restrictions: ["occupancy.create"], startsAt: context.now(), endsAt: null,
  }, context.reviewerAudit);
  const occupancyId = backend.id(reverse ? "review-reverse-occupancy" : "review-occupancy");
  const original = {
    primaryPersonId: personId, startsAt: context.now(), endsAt: context.now() + 100_000,
    occupancyId,
  };
  const first = await outcomes([context.service.createCycle(roomId, original, context.audit)]);
  invariant(first[0].status === "rejected" && errorCode(first[0]) === "BLACKLIST_REVIEW_REQUIRED",
    "REVIEW_FIXTURE_FAILED", "正式创建未产生持久待审申请");
  const review = () => context.reviewerBlacklist.reviewOccupancy(occupancyId, {
    restriction: "occupancy.create", decision: "allow", reason: "仅放行原请求",
    entryIds: [entry.entryId], entryRevisions: [1],
  }, context.reviewerAudit);
  const changed = () => context.service.createCycle(roomId, {
    ...original, endsAt: original.endsAt + 100_000,
  }, context.audit);
  const settled = await outcomes(reverse ? [changed(), review()] : [review(), changed()]);
  const changedResult = reverse ? settled[0] : settled[1];
  const reviewResult = reverse ? settled[1] : settled[0];
  invariant(reviewResult.status === "fulfilled", "REVIEW_FAILED", "正式原请求审核未成功");
  invariant(changedResult.status === "rejected" && errorCode(changedResult) === "OCCUPANCY_APPLICATION_CONFLICT",
    "STALE_REVIEW_ALLOWED", `换参请求必须拒绝：${errorCode(changedResult)}`);
  const created = await context.service.createCycle(roomId, original, context.audit);
  const application = (await context.store.list("occupancy_applications", context.orgA))
    .find((row) => row._id === occupancyId);
  const headId = blacklistDecisionHeadId(context.orgA, occupancyId, "occupancy.create");
  const decision = (await context.store.list("blacklist_decisions", context.orgA))
    .find((row) => row._id === headId);
  invariant(application.state === "consumed" && application.consumedDecisionId === reviewResult.value.decisionId &&
    decision.requestDigest === application.requestDigest && decision.requestVersion === application.requestVersion &&
    created.occupancyId === occupancyId, "REVIEW_BINDING_MISMATCH", "放行决定未绑定原请求版本");
  return {
    status: "pass",
    productionMethod: "BlacklistService.reviewOccupancy + OccupancyService.createCycle",
    outcome: "original-request-allowed-changed-request-rejected",
    requestDigestMatches: true, requestVersion: application.requestVersion,
    changedRequestCode: errorCode(changedResult), applicationState: application.state,
  };
}

export async function organizationIsolationProbe(backend) {
  const context = await createServiceContext(backend, "organization-isolation");
  const roomA = await context.makeRoom("ORG-A");
  const personA = (await context.persons.createPerson({ name: "组织甲人员" }, context.audit)).personId;
  const personB = (await context.otherPersons.createPerson({ name: "组织乙人员" },
    { ...context.audit, orgId: context.orgB })).personId;
  const propertyB = new OrgPropertyService(context.store, context.orgB, null);
  const { buildingId } = await propertyB.createProperty({
    mode: "new", communityName: "DB08 组织乙小区", buildingName: "乙栋",
  }, { ...context.audit, orgId: context.orgB });
  const floor = await propertyB.createCatalog({ kind: "floor", name: "1层", level: 1, parentId: buildingId },
    { ...context.audit, orgId: context.orgB });
  const roomB = (await propertyB.createRooms({ floorId: floor._id, numbers: ["ORG-B"] },
    { ...context.audit, orgId: context.orgB })).ids[0];
  const checks = await outcomes([
    context.orgs.requireMembership("adminAccount", context.otherAdminId, context.orgA),
    context.service.createCycle(roomB, {
      primaryPersonId: personA, startsAt: context.now(), endsAt: null,
      occupancyId: backend.id("cross-org-room"),
    }, context.audit),
    context.service.createCycle(roomA, {
      primaryPersonId: personB, startsAt: context.now(), endsAt: null,
      occupancyId: backend.id("cross-org-person"),
    }, context.audit),
  ]);
  invariant(checks.every((result) => result.status === "rejected" && errorCode(result) === "NOT_FOUND"),
    "ORG_ACCESS_LEAK", `跨组织或伪造成员未被正式服务拒绝：${checks.map(errorCode).join(",")}`);
  const [personsA, personsB, occupancies] = await Promise.all([
    context.store.list("persons", context.orgA), context.store.list("persons", context.orgB),
    context.store.list("occupancies", context.orgA),
  ]);
  invariant(personsA.some((row) => row._id === personA) && personsB.some((row) => row._id === personB) &&
    personsA.every((row) => row.orgId === context.orgA) && personsB.every((row) => row.orgId === context.orgB) &&
    occupancies.length === 0, "ORG_FINAL_STATE", "组织过滤或失败零写入不符");
  return {
    status: "pass",
    productionMethod: "OrgService.requireMembership + OccupancyService.createCycle",
    orgACount: personsA.length, orgBCount: personsB.length,
    rejectedForgedMemberships: 1, rejectedCrossOrgReferences: 2, occupancyWrites: 0,
  };
}

export async function indexQueryProbe(backend) {
  const context = await createServiceContext(backend, "index-query");
  await context.persons.createPerson({ name: "索引甲" }, context.audit);
  await context.persons.createPerson({ name: "索引乙" }, context.audit);
  const token = backend.id("index-no-match");
  const executed = [];
  for (const index of INDEXES) {
    const where = Object.fromEntries(index.equality.filter((field) => field !== "orgId")
      .map((field) => [field, token]));
    const rows = await backend.query(index.collection, {
      orgId: context.orgA, where: { probeRunId: backend.runId, ...where },
      orderBy: index.orderBy, limit: 2,
    });
    invariant(rows.every((row) => row.orgId === context.orgA), "INDEX_ORG_LEAK", `${index.collection} 查询缺少组织边界`);
    executed.push({ collection: index.collection, equality: index.equality,
      orderBy: index.orderBy, returned: rows.length });
  }
  const sorted = await backend.query("persons", {
    orgId: context.orgA, where: { probeRunId: backend.runId, status: "active" },
    orderBy: ["_id"], limit: 2,
  });
  invariant(sorted.length === 2 && sorted[0]._id < sorted[1]._id, "INDEX_SORT", "_id 游标排序不稳定");
  return { status: "pass", productionMethod: "OrgService/PersonService fixtures + ProbeBackend.query",
    candidateQueries: executed.length, organizationFilterBeforePagination: true,
    stableIdTiebreaker: true, queries: executed };
}

export async function transactionReferenceProbe(backend) {
  const refsFor = (count) => Array.from({ length: count }, (_, n) =>
    ref("operation_keys", backend.id(`budget-${String(n).padStart(3, "0")}`)));
  await backend.transact(refsFor(MAX_TRANSACTION_REFS - 1), () => [], {
    action: "DB-08 exact 90-reference boundary", orgId: backend.config.orgA,
  });
  const before = backend.metrics.transactionsStarted;
  const rejected = await outcomes([backend.transact(refsFor(MAX_TRANSACTION_REFS), () => [], {
    action: "DB-08 91-reference preflight rejection", orgId: backend.config.orgA,
  })]);
  invariant(rejected[0].status === "rejected" && errorCode(rejected[0]) === "TRANSACTION_REF_LIMIT" &&
    backend.metrics.transactionsStarted === before, "TRANSACTION_REF_BUDGET",
  "91 总引用未在事务／网络开始前拒绝");
  return { status: "pass", productionMethod: "ProbeBackend shared transaction boundary",
    acceptedTotalRefs: 90, rejectedTotalRefs: 91,
    rejectedBeforeTransaction: true, applicationLimitNotPlatformLimit: true };
}

export async function roomBatchProbe(backend) {
  const context = await createServiceContext(backend, "room-batch");
  const originalIds = [];
  let replayedBatches = 0;
  let maxTransactionRefs = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let batch = 0; batch < ROOM_BATCH_TOTAL / ROOM_BATCH_SIZE; batch += 1) {
      const start = batch * ROOM_BATCH_SIZE;
      const data = {
        floorId: context.roomFloorId,
        numbers: Array.from({ length: ROOM_BATCH_SIZE }, (_, n) => `R${String(start + n).padStart(4, "0")}`),
      };
      const op = {
        id: backend.id(`room-batch-${String(batch).padStart(2, "0")}`),
        actorId: context.adminId, orgId: context.orgA, route: "db08.room-batch",
        keyDigest: digest(`room-batch-${batch}`), bodyDigest: digest(data),
      };
      const before = context.store.transactionHistory.length;
      let result;
      try {
        result = await context.property.createRooms(data, context.audit, op);
        invariant(pass === 0, "ROOM_REPLAY_FAILED", "首次执行后再次写入未触发正式 OpReplay");
        originalIds.push(...result.ids);
      } catch (error) {
        invariant(error instanceof OpReplay && pass === 1, "ROOM_BATCH_FAILED", `正式房间批次失败：${error.message}`);
        result = JSON.parse(error.resultRef).body;
        replayedBatches += 1;
      }
      const transaction = context.store.transactionHistory.slice(before).at(-1);
      maxTransactionRefs = Math.max(maxTransactionRefs, (transaction?.refs.length || 0) + 1);
      if (pass === 1) {
        const expected = originalIds.slice(start, start + ROOM_BATCH_SIZE);
        invariant(JSON.stringify(result.ids) === JSON.stringify(expected), "ROOM_REPLAY_IDS",
          "正式 OpReplay 未返回原房间 ID 集合");
      }
    }
    const rooms = await context.store.list("rooms", context.orgA);
    invariant(rooms.length === ROOM_BATCH_TOTAL && new Set(rooms.map((row) => row._id)).size === ROOM_BATCH_TOTAL,
      "ROOM_BATCH_COUNT", `第 ${pass + 1} 次执行后正式房间数量不唯一`);
  }
  const floor = (await context.store.list("property_catalog", context.orgA))
    .find((row) => row._id === context.roomFloorId);
  invariant(floor.slots.length === ROOM_BATCH_TOTAL && maxTransactionRefs <= MAX_TRANSACTION_REFS,
    "ROOM_BATCH_REFS", "正式楼层槽或事务引用预算不符");
  return { status: "pass", productionMethod: "OrgPropertyService.createRooms + OpReplay",
    rooms: ROOM_BATCH_TOTAL, batchSize: ROOM_BATCH_SIZE,
    batchesPerPass: ROOM_BATCH_TOTAL / ROOM_BATCH_SIZE, replayedBatches,
    uniqueRooms: ROOM_BATCH_TOTAL, duplicateRooms: 0, maxTransactionRefs,
    floorSlots: floor.slots.length, recoverableByOperationKey: true };
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
