/**
 * H2-c 共享只读资格 helper（设计 §4 R05–R18，终审 Q01–Q03）。
 *
 * 只做三件事：
 *   1. planEligibilityRefs(request)：按预读结果生成事务 refs 并受 90 条上限约束；
 *   2. snapshotEligibility(state, request)：从事务 state 取最小只读快照；
 *   3. validateEligibility(snapshot, request, now)：纯校验，返回结构化结论。
 *
 * 不写任何集合，不开启事务，不读实名私密材料、文件字节或名单证据正文。
 * grant 模式只接受当前有效（effectiveState=active）的 active occupancy/cycle。
 * activate() 保留原有控制流；本文件只共享其时间/ID/层级原语，故不改变激活语义。
 */
import { createHash } from "node:crypto";
import { claimId, guardId } from "../claims.mjs";
import { HttpError, failCode } from "../model.mjs";

export const MAX_ELIGIBILITY_REFS = 90;
export const ELIGIBILITY_MODE = Object.freeze({ GRANT: "grant" });

const RETRY = Object.freeze({
  eligible: false,
  retry: true,
  code: "BLACKLIST_RETRY",
  message: "名单状态已变化，请重新检查",
  status: 409,
});
const reject = (code, message, status) => ({ eligible: false, code, message, status });
const ref = (collection, id) => ({ collection, id });
const hash = (...parts) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
const read = (state, collection, id) =>
  (state && typeof state === "object" && id ? state[`${collection}/${id}`] ?? null : null);
const positiveRevision = (value) => Number.isSafeInteger(value) && value >= 1;
const nonNegativeEpoch = (value) => Number.isSafeInteger(value) && value >= 0;

// 以下 ID 与时间原语由 OccupancyService 与 face-service 共用，避免两套简化逻辑。
export const primarySlotId = (orgId, roomId) =>
  `room-primary-slot-${hash(orgId, roomId)}`;
export const occupancyClaimId = (orgId, roomId, cycleId, personId) =>
  claimId("occupancy-person", `${orgId}|${roomId}|${cycleId}`, personId);
export const activeAt = (record, now) =>
  record.startsAt <= now && (record.endsAt === null || now < record.endsAt);
export const minEnd = (...values) => {
  const present = values.filter((value) => value !== null && value !== undefined);
  return present.length ? Math.min(...present) : null;
};
export const uniqueRefs = (refs) => [
  ...new Map(refs.map((r) => [`${r.collection}/${r.id}`, r])).values(),
];

/**
 * 预读请求（调用方必须先完成自洽预读；任何漏字段都按 PARAM_ERROR 失败关闭）：
 *   mode: "grant"
 *   orgId / personId / occupancyId / cycleId / identityApplicationId
 *   validFrom / validUntil
 *   expected: {
 *     occupancy, cycle, room, person, identityApplication,   // ID 与请求一致
 *     catalog: { floor, building, community },               // kind/父子/revision 必须有效
 *     lifecycleGuard: 记录对象 | null,                        // 显式基线，不可缺键
 *     primary?,                                              // member 必填
 *     sponsor?,                                              // sponsorOccupancyId 非空时必填
 *   }
 *   baseRefs?: []  // 调用方的权限/设备/operation/名单 refs，一起受上限约束
 */
function assertGrantRequest(request) {
  if (!request || typeof request !== "object")
    failCode("PARAM_ERROR", "资格请求格式无效");
  if ((request.mode ?? ELIGIBILITY_MODE.GRANT) !== ELIGIBILITY_MODE.GRANT)
    failCode("PARAM_ERROR", "不支持的资格模式");
  for (const field of ["orgId", "personId", "occupancyId", "cycleId", "identityApplicationId"]) {
    if (typeof request[field] !== "string" || !request[field].trim())
      failCode("PARAM_ERROR", `资格请求缺少 ${field}`);
  }
  const expected = request.expected;
  if (!expected || typeof expected !== "object" || !expected.occupancy ||
      !expected.cycle || !expected.room || !expected.person ||
      !expected.identityApplication || typeof expected.catalog !== "object")
    failCode("PARAM_ERROR", "资格预读快照不完整");
  const { occupancy, cycle, room, person, identityApplication } = expected;
  // 预读记录必须与请求 ID 自洽：调用方不得把另一条记录当作基线。
  if (person._id !== request.personId ||
      identityApplication._id !== request.identityApplicationId ||
      occupancy._id !== request.occupancyId ||
      occupancy.personId !== request.personId ||
      cycle._id !== request.cycleId ||
      cycle._id !== occupancy.cycleId ||
      room._id !== occupancy.roomId)
    failCode("PARAM_ERROR", "资格预读快照与请求不一致");
  if (!positiveRevision(person.revision) || !positiveRevision(occupancy.revision) ||
      !positiveRevision(cycle.revision) || !nonNegativeEpoch(cycle.epoch) ||
      !positiveRevision(identityApplication.revision) || !positiveRevision(room.revision))
    failCode("PARAM_ERROR", "资格预读快照缺少有效 revision");
  // room 与三级目录的 ID、kind、父子关系、revision 全量强制，不得因漏传跳过。
  if (typeof room.floorId !== "string" || !room.floorId ||
      typeof room.buildingId !== "string" || !room.buildingId ||
      typeof room.communityId !== "string" || !room.communityId)
    failCode("PARAM_ERROR", "资格预读快照缺少物业层级");
  if (!expected.catalog || !expected.catalog.floor ||
      !expected.catalog.building || !expected.catalog.community)
    failCode("PARAM_ERROR", "资格预读快照缺少物业目录");
  for (const [kind, id, parentId] of [
    ["floor", room.floorId, room.buildingId],
    ["building", room.buildingId, room.communityId],
    ["community", room.communityId, null],
  ]) {
    const record = expected.catalog[kind];
    if (!record || record._id !== id || record.kind !== kind ||
        (parentId !== null && record.parentId !== parentId) ||
        !positiveRevision(record.revision))
      failCode("PARAM_ERROR", `资格预读快照的 ${kind} 目录无效`);
  }
  if (occupancy.role === "primary" && cycle.primaryOccupancyId !== occupancy._id)
    failCode("PARAM_ERROR", "primary 入住未绑定周期的 primaryOccupancyId");
  if (occupancy.role === "member") {
    const primary = expected.primary;
    if (!primary || primary._id !== cycle.primaryOccupancyId ||
        !positiveRevision(primary.revision))
      failCode("PARAM_ERROR", "member 资格预读快照缺少有效 primary");
  }
  if (occupancy.sponsorOccupancyId !== null && occupancy.sponsorOccupancyId !== undefined) {
    const sponsor = expected.sponsor;
    if (!sponsor || sponsor._id !== occupancy.sponsorOccupancyId ||
        !positiveRevision(sponsor.revision))
      failCode("PARAM_ERROR", "资格预读快照缺少有效 sponsor");
  }
  // lifecycle guard 必须显式给出记录或明确的 null，漏传即视为契约错误。
  if (!Object.hasOwn(expected, "lifecycleGuard"))
    failCode("PARAM_ERROR", "资格预读快照缺少 lifecycle guard 基线");
  const guard = expected.lifecycleGuard;
  if (guard !== null && (!guard || typeof guard !== "object" ||
      !nonNegativeEpoch(guard.epoch) || !positiveRevision(guard.revision)))
    failCode("PARAM_ERROR", "lifecycle guard 基线无效");
  if (guard !== null && (guard._id !== guardId(request.orgId) || guard.orgId !== request.orgId))
    failCode("PARAM_ERROR", "lifecycle guard 基线不属于当前组织");
  return expected;
}

/** 只读实体读取计划；返回去重后的 refs，超过 90 条失败关闭（不拆事务、不省略 refs）。 */
export function planEligibilityRefs(request) {
  const expected = assertGrantRequest(request);
  const { occupancy, cycle, room, person } = expected;
  const catalog = expected.catalog || {};
  const baseRefs = request.baseRefs ?? [];
  if (!Array.isArray(baseRefs) || baseRefs.some((item) =>
    !item || typeof item.collection !== "string" || !item.collection ||
    typeof item.id !== "string" || !item.id))
    failCode("PARAM_ERROR", "资格附加 refs 格式无效");
  const refs = [
    ref("persons", request.personId),
    ...(person.userId ? [ref("users", person.userId)] : []),
    ref("identity_applications", request.identityApplicationId),
    ref("occupancies", request.occupancyId),
    ref("occupancy_cycles", occupancy.cycleId),
    ref("rooms", room._id),
    ...["floor", "building", "community"]
      .filter((kind) => catalog[kind]?._id)
      .map((kind) => ref("property_catalog", catalog[kind]._id)),
    ref("unique_claims", occupancyClaimId(request.orgId, occupancy.roomId, occupancy.cycleId, request.personId)),
    ref("room_primary_slots", primarySlotId(request.orgId, occupancy.roomId)),
    ...(occupancy.role === "member" && cycle.primaryOccupancyId
      ? [ref("occupancies", cycle.primaryOccupancyId)] : []),
    ...(occupancy.sponsorOccupancyId
      ? [ref("occupancies", occupancy.sponsorOccupancyId)] : []),
    ref("lifecycle_guards", guardId(request.orgId)),
    ...baseRefs,
  ];
  const unique = uniqueRefs(refs);
  if (unique.length > MAX_ELIGIBILITY_REFS)
    // 与 CloudStore 的去重后 90 条上限保持同一对外表现：HTTP 400，无业务 code。
    throw new HttpError(400, "一次操作涉及记录过多，请缩小选择范围");
  return unique;
}

/** 从事务 state 取最小只读快照；缺失/损坏的键一律为 null，绝不抛错。 */
export function snapshotEligibility(state, request) {
  const expected = request?.expected || {};
  const occupancyId = request?.occupancyId ?? null;
  const occupancy = read(state, "occupancies", occupancyId);
  const cycleId = expected.occupancy?.cycleId ?? null;
  const roomId = expected.room?._id ?? null;
  const personId = request?.personId ?? null;
  const userId = expected.person?.userId ?? null;
  const primaryId = expected.cycle?.primaryOccupancyId ?? null;
  // sponsor 只按预读 ID 读取，绝不相信事务内被改写的新 ID。
  const sponsorId = expected.occupancy?.sponsorOccupancyId ?? null;
  const catalog = expected.catalog || {};
  const orgId = request?.orgId ?? null;
  return {
    occupancy,
    cycle: read(state, "occupancy_cycles", cycleId),
    room: read(state, "rooms", roomId),
    catalog: {
      floor: read(state, "property_catalog", catalog.floor?._id),
      building: read(state, "property_catalog", catalog.building?._id),
      community: read(state, "property_catalog", catalog.community?._id),
    },
    person: read(state, "persons", personId),
    user: read(state, "users", userId),
    identityApplication: read(state, "identity_applications", request?.identityApplicationId),
    claim: read(state, "unique_claims",
      roomId && cycleId && personId
        ? occupancyClaimId(orgId, expected.occupancy?.roomId ?? roomId, cycleId, personId)
        : null),
    slot: read(state, "room_primary_slots",
      orgId && roomId ? primarySlotId(orgId, roomId) : null),
    primary: read(state, "occupancies", primaryId),
    sponsor: read(state, "occupancies", sponsorId),
    lifecycleGuard: read(state, "lifecycle_guards", orgId ? guardId(orgId) : null),
  };
}

function checkCatalog(snapshot, expected, request) {
  const room = snapshot.room;
  const levels = [
    ["floor", room.floorId, room.buildingId],
    ["building", room.buildingId, room.communityId],
    ["community", room.communityId, null],
  ];
  for (const [kind, id, parentId] of levels) {
    const record = snapshot.catalog?.[kind];
    const baseline = expected.catalog?.[kind];
    if (!id) return reject("NOT_FOUND", "房间所属物业不存在或不可见", 404);
    if (!record || record.orgId !== request.orgId || record.kind !== kind)
      return reject("NOT_FOUND", "房间所属物业不存在或不可见", 404);
    if ((record.status || "active") !== "active")
      return reject("ROOM_ARCHIVED", "房间所属物业已归档", 409);
    if (parentId !== null && record.parentId !== parentId)
      return reject("REVISION_CONFLICT", "房间所属物业层级已变化，请刷新后重试", 409);
    if (!baseline || record.revision !== baseline.revision)
      return reject("REVISION_CONFLICT", "房间所属物业层级已变化，请刷新后重试", 409);
  }
  return null;
}

/**
 * 纯校验：不写集合、不产生非预期副作用；请求本身非法时仍以 PARAM_ERROR 失败关闭。
 * 返回 {eligible:true,...} 或 {eligible:false, code, message, status[, retry]}。
 * 内部快照竞态使用 BLACKLIST_RETRY 语义，由调用方进入同一三次完整重试。
 */
export function validateEligibility(snapshot, request, now) {
  if (!Number.isFinite(now)) failCode("PARAM_ERROR", "资格校验缺少有效时间");
  const expected = assertGrantRequest(request);
  const orgId = request.orgId;
  const personId = request.personId;

  // R05 人员档案：缺失/跨组织同态 NOT_FOUND；归档 INVALID_STATE；快照变化走重试。
  const person = snapshot?.person;
  if (!person || person.orgId !== orgId)
    return reject("NOT_FOUND", "人员档案不存在或不可见", 404);
  if (person.status !== "active")
    return reject("INVALID_STATE", "人员档案已归档", 409);
  if (person.revision !== expected.person.revision ||
      (person.userId ?? null) !== (expected.person.userId ?? null))
    return RETRY;

  // R06 绑定账号：无账号不伪造，缺失/停用一律 USER_DISABLED。
  if (person.userId) {
    const user = snapshot.user;
    if (!user || (user.status && user.status !== "active"))
      return reject("USER_DISABLED", "绑定账号不存在或已停用", 403);
  }

  // R07 实名申请：同 org、同 person、approved、digest 非空；快照变化走重试。
  const application = snapshot.identityApplication;
  if (!application || application.orgId !== orgId)
    return reject("NOT_FOUND", "实名申请不存在或不可见", 404);
  if (application.personId !== personId)
    return reject("IDENTITY_CONFLICT", "实名申请与人员档案不一致", 409);
  if (application.state !== "approved" || !application.identityDigest)
    return reject("IDENTITY_NOT_APPROVED", "人员实名尚未审核通过", 403);
  if (application.revision !== expected.identityApplication.revision ||
      application.identityDigest !== expected.identityApplication.identityDigest ||
      application.keyVersion !== expected.identityApplication.keyVersion)
    return RETRY;

  // R08 入住关系：只接受 active；关键关系/revision 在预读后变化即冲突。
  const occupancy = snapshot.occupancy;
  if (!occupancy || occupancy.orgId !== orgId)
    return reject("NOT_FOUND", "入住关系不存在或不可见", 404);
  // 非法角色是记录自身状态问题；合法角色被改写才是预读后的关系变化。
  if (!["primary", "member"].includes(occupancy.role))
    return reject("INVALID_STATE", "入住关系角色无效", 409);
  if (occupancy.personId !== personId || occupancy.cycleId !== request.cycleId ||
      occupancy.cycleId !== expected.occupancy.cycleId ||
      occupancy.roomId !== expected.occupancy.roomId ||
      occupancy.role !== expected.occupancy.role ||
      (occupancy.sponsorOccupancyId ?? null) !== (expected.occupancy.sponsorOccupancyId ?? null) ||
      occupancy.startsAt !== expected.occupancy.startsAt ||
      occupancy.endsAt !== expected.occupancy.endsAt ||
      occupancy.revision !== expected.occupancy.revision)
    return reject("REVISION_CONFLICT", "入住关系关键字段已变化，请刷新后重试", 409);
  if (occupancy.state !== "active")
    return reject("INVALID_STATE", "入住关系不是有效状态", 409);

  // R09 入住周期：room 关系、active、primary 与 epoch/revision/起止在事务内复核。
  const cycle = snapshot.cycle;
  if (!cycle || cycle.orgId !== orgId)
    return reject("NOT_FOUND", "入住周期不存在或不可见", 404);
  if (cycle.roomId !== occupancy.roomId ||
      cycle.primaryOccupancyId !== expected.cycle.primaryOccupancyId ||
      cycle.startsAt !== expected.cycle.startsAt ||
      cycle.endsAt !== expected.cycle.endsAt ||
      (cycle.endedAt ?? null) !== (expected.cycle.endedAt ?? null) ||
      cycle.epoch !== expected.cycle.epoch ||
      cycle.revision !== expected.cycle.revision)
    return reject("REVISION_CONFLICT", "入住周期已变化，请刷新后重试", 409);
  if (cycle.state !== "active")
    return reject("INVALID_STATE", "入住周期不在有效状态", 409);
  if (occupancy.role === "primary" && cycle.primaryOccupancyId !== occupancy._id)
    return reject("REVISION_CONFLICT", "入住周期主入住关系已变化，请刷新后重试", 409);

  // R10 房间：org、未归档、层级绑定与 revision。
  const room = snapshot.room;
  if (!room || room.orgId !== orgId)
    return reject("NOT_FOUND", "房间不存在或不可见", 404);
  if ((room.status || "active") !== "active")
    return reject("ROOM_ARCHIVED", "房间已归档", 409);
  if (room.floorId !== expected.room.floorId ||
      room.buildingId !== expected.room.buildingId ||
      room.communityId !== expected.room.communityId ||
      room.revision !== expected.room.revision)
    return reject("REVISION_CONFLICT", "房间物业层级已变化，请刷新后重试", 409);

  // R11–R13 物业目录：三级均必填，kind/父子层级/revision 全部复核。
  const catalogFailure = checkCatalog(snapshot, expected, request);
  if (catalogFailure) return catalogFailure;

  // R14 唯一占位：必须 bound 到目标 occupancy，孤立记录不授权。
  const claim = snapshot.claim;
  if (!claim || claim.orgId !== orgId || claim.state !== "bound" ||
      claim.ownerId !== occupancy._id)
    return reject("DUPLICATE_OCCUPANCY", "入住关系唯一占位无效，请核对数据", 409);

  // R15–R17 primary / room slot / sponsor。
  const slot = snapshot.slot;
  if (occupancy.role === "primary") {
    if (!slot || slot.currentCycleId !== cycle._id ||
        slot.currentOccupancyId !== occupancy._id ||
        slot.currentPersonId !== occupancy.personId)
      return reject("INVALID_STATE", "主租客房间名额与入住关系不一致", 409);
  } else {
    const primary = snapshot.primary;
    if (!primary || primary.orgId !== orgId || primary.role !== "primary" ||
        primary.state !== "active" || !activeAt(primary, now))
      return reject("SPONSOR_INACTIVE", "主租客关系已失效，成员不能创建授权", 409);
    if (primary.revision !== expected.primary.revision)
      return reject("REVISION_CONFLICT", "主租客关系已变化，请刷新后重试", 409);
    if (primary.roomId !== occupancy.roomId || primary.cycleId !== cycle._id ||
        !slot || slot.currentCycleId !== cycle._id ||
        slot.currentOccupancyId !== primary._id ||
        slot.currentPersonId !== primary.personId)
      return reject("SPONSOR_INACTIVE", "主租客关系已失效，成员不能创建授权", 409);
  }
  // sponsor 由预读 ID 驱动：清空/改写 ID 已在 R08 返回冲突，这里复核目标记录。
  if (expected.occupancy.sponsorOccupancyId !== null &&
      expected.occupancy.sponsorOccupancyId !== undefined) {
    const sponsor = snapshot.sponsor;
    if (!sponsor || sponsor.orgId !== orgId || sponsor.state !== "active" ||
        sponsor._id !== cycle.primaryOccupancyId)
      return reject("SPONSOR_INACTIVE", "邀请人的主租客关系已失效", 409);
    if (sponsor.revision !== expected.sponsor.revision)
      return reject("REVISION_CONFLICT", "邀请人关系已变化，请刷新后重试", 409);
  }

  // R18 lifecycle guard 只读串行化：显式基线为 null 时，事务内出现记录也是冲突。
  const guard = snapshot.lifecycleGuard;
  if (expected.lifecycleGuard === null) {
    if (guard)
      return reject("REVISION_CONFLICT", "入住生命周期已变化，请刷新后重试", 409);
  } else if (!guard || guard._id !== guardId(orgId) || guard.orgId !== orgId ||
      guard.epoch !== expected.lifecycleGuard.epoch ||
      guard.revision !== expected.lifecycleGuard.revision) {
    return reject("REVISION_CONFLICT", "入住生命周期已变化，请刷新后重试", 409);
  }

  // Q01/Q03 时间：occupancy/cycle 均 activeAt；授权区间须包含于共同有效区间。
  const effectiveEnd = minEnd(occupancy.endsAt, cycle.endsAt, cycle.endedAt);
  if (!activeAt(occupancy, now) || !activeAt(cycle, now) ||
      (cycle.endedAt !== null && cycle.endedAt !== undefined && now >= cycle.endedAt))
    return reject("INVALID_STATE", "当前时间不在入住关系及周期有效期内", 409);
  const { validFrom, validUntil } = request;
  if (!Number.isFinite(validFrom) || !Number.isFinite(validUntil) || validFrom >= validUntil)
    return reject("PARAM_ERROR", "授权有效期无效", 400);
  if (validFrom < occupancy.startsAt || validFrom < cycle.startsAt ||
      (effectiveEnd !== null && validUntil > effectiveEnd))
    return reject("PARAM_ERROR", "授权区间超出入住关系有效期", 400);
  if (now < validFrom || now >= validUntil)
    return reject("INVALID_STATE", "授权尚未生效或已过期", 409);

  return {
    eligible: true,
    code: null,
    message: null,
    orgId,
    personId,
    occupancyId: occupancy._id,
    occupancyRevision: occupancy.revision,
    cycleId: cycle._id,
    cycleRevision: cycle.revision,
    cycleEpoch: cycle.epoch,
    roomId: occupancy.roomId,
    role: occupancy.role,
    startsAt: occupancy.startsAt,
    endsAt: occupancy.endsAt,
    effectiveEnd,
    validFrom,
    validUntil,
  };
}
