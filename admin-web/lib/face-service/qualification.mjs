/**
 * H2-c C3：createGrant 每次 attempt 的资格基线预读。
 *
 * 本模块只读 store，不开启事务、不写集合、不调用 Provider。它把真实业务记录
 * 组装成 C1 `planEligibilityRefs()` 所需的 request：
 *   - 缺失/跨组织记录按同态 NOT_FOUND 失败关闭；
 *   - credential/输入与 occupancy/cycle/room/catalog 的业务错配（D21/D23 等）
 *     在构造 helper 请求前映射为 REVISION_CONFLICT/409，不暴露成 helper 的 400；
 *   - helper 请求自身不自洽（例如 primary 未绑定 cycle.primaryOccupancyId、
 *     预读基线缺字段）仍由 C1 helper 以 PARAM_ERROR/400 失败关闭。
 *
 * 事务内 `beforeEvaluate()` 再用 `snapshotEligibility()` + `validateEligibility()`
 * 对同一基线做完整、只读的事务内复核。
 */
import { guardId } from "../claims.mjs";
import { failCode } from "../model.mjs";
import { planEligibilityRefs } from "./eligibility.mjs";

async function orgReader(store, orgId) {
  const cache = new Map();
  return async (collection, id) => {
    if (typeof id !== "string" || !id) return null;
    // 精确点查：只读 (orgId, _id) 一条记录，不做全组织分页扫描。
    const key = `${collection}/${id}`;
    if (!cache.has(key)) cache.set(key, await store.get(collection, id, orgId));
    return cache.get(key);
  };
}

const requireRecord = (record, code, message, status) => {
  if (!record) failCode(code, message, status);
  return record;
};

const stale = (message) => failCode("REVISION_CONFLICT", message, 409);

/**
 * 预读一次 attempt 的完整资格基线，并返回 C1 helper 规划出的 refs。
 * 抛出的业务错误由 createGrant 延迟到事务内权限/operation/credential 检查之后；
 * 容量/PARAM_ERROR 仍保持事务前失败关闭。
 */
export async function prepareGrantEligibility(store, {
  orgId, personId, occupancyId, cycleId, identityApplicationId,
  validFrom, validUntil, baseRefs = [],
}) {
  const read = await orgReader(store, orgId);

  const person = requireRecord(
    await read("persons", personId),
    "NOT_FOUND", "人员档案不存在或不可见", 404,
  );
  const identityApplication = requireRecord(
    await read("identity_applications", identityApplicationId),
    "NOT_FOUND", "实名申请不存在或不可见", 404,
  );
  if (identityApplication.personId !== personId) {
    failCode("IDENTITY_CONFLICT", "实名申请与人员档案不一致", 409);
  }

  const occupancy = requireRecord(
    await read("occupancies", occupancyId),
    "NOT_FOUND", "入住关系不存在或不可见", 404,
  );
  if (occupancy.personId !== personId) {
    stale("入住关系人员与凭证不一致，请刷新后重试");
  }
  if (occupancy.cycleId !== cycleId) {
    stale("入住关系周期与请求不一致，请刷新后重试");
  }

  const cycle = requireRecord(
    await read("occupancy_cycles", cycleId),
    "NOT_FOUND", "入住周期不存在或不可见", 404,
  );
  if (typeof occupancy.roomId !== "string" || !occupancy.roomId) {
    failCode("NOT_FOUND", "房间不存在或不可见", 404);
  }
  if (cycle.roomId !== occupancy.roomId) {
    stale("入住周期与房间关系已变化，请刷新后重试");
  }

  const room = requireRecord(
    await read("rooms", occupancy.roomId),
    "NOT_FOUND", "房间不存在或不可见", 404,
  );
  const catalog = {};
  for (const [kind, id, parentId] of [
    ["floor", room.floorId, room.buildingId],
    ["building", room.buildingId, room.communityId],
    ["community", room.communityId, null],
  ]) {
    const record = requireRecord(
      await read("property_catalog", id),
      "NOT_FOUND", "房间所属物业不存在或不可见", 404,
    );
    if (record.kind !== kind) {
      failCode("NOT_FOUND", "房间所属物业不存在或不可见", 404);
    }
    if (parentId !== null && record.parentId !== parentId) {
      stale("房间所属物业层级已变化，请刷新后重试");
    }
    catalog[kind] = record;
  }

  const expected = {
    occupancy, cycle, room, catalog, person, identityApplication, lifecycleGuard: null,
  };

  if (occupancy.role === "member") {
    const primary = await read("occupancies", cycle.primaryOccupancyId);
    if (!primary) {
      failCode("SPONSOR_INACTIVE", "主租客关系已失效，成员不能创建授权", 409);
    }
    expected.primary = { _id: primary._id, revision: primary.revision };
  }
  if (occupancy.sponsorOccupancyId !== null && occupancy.sponsorOccupancyId !== undefined) {
    const sponsor = await read("occupancies", occupancy.sponsorOccupancyId);
    if (!sponsor) {
      failCode("SPONSOR_INACTIVE", "邀请人的主租客关系已失效", 409);
    }
    expected.sponsor = { _id: sponsor._id, revision: sponsor.revision };
  }

  const guard = await read("lifecycle_guards", guardId(orgId));
  expected.lifecycleGuard = guard ?? null;

  const request = {
    mode: "grant",
    orgId,
    personId,
    occupancyId,
    cycleId,
    identityApplicationId,
    validFrom,
    validUntil,
    expected,
  };
  // baseRefs 一并交给 C1 helper 做 90 条上限核算；withEligibility 仍会并入
  // token 动态 refs 后再校验一次，任一处超限都在事务前失败关闭。
  if (baseRefs.length) request.baseRefs = baseRefs;
  return { request, refs: planEligibilityRefs(request) };
}
