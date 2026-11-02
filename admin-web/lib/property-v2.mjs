import { randomUUID, createHash } from "node:crypto";
import { failCode } from "./model.mjs";
import { claims, guardId } from "./claims.mjs";
const hash = (...parts) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
const ref = (collection, id) => ({ collection, id });
const base = () => ({ schemaVersion: 2, revision: 1, createdAt: Date.now() });
const text = (v, label, max = 80) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    failCode("PARAM_ERROR", `${label}需为 1–${max} 字`);
  return v.trim();
};
// Signals that an idempotent operation was already committed; the caller
// replays the stored result instead of writing again.
export class OpReplay extends Error {
  constructor(resultRef) {
    super("operation already completed");
    this.resultRef = resultRef;
  }
}
// Idempotency record written in the same transaction as the business writes
// (docs/database/DATA-MODEL.md §2 operation_keys). The in-transaction re-check
// keeps concurrent retries safe; the pre-read in the server is only a fast path.
function opWrite(state, op, result) {
  if (!op) return [];
  const existing = state[`operation_keys/${op.id}`];
  if (existing) {
    if (existing.bodyDigest !== op.bodyDigest)
      failCode(
        "IDEMPOTENCY_CONFLICT",
        "相同幂等键的请求内容不一致，请勿修改后重试",
        409,
      );
    throw new OpReplay(existing.resultRef);
  }
  return [
    {
      collection: "operation_keys",
      id: op.id,
      data: {
        actorId: op.actorId,
        orgId: op.orgId,
        route: op.route,
        keyDigest: op.keyDigest,
        bodyDigest: op.bodyDigest,
        state: "completed",
        resultRef: JSON.stringify(result),
        expiresAt: Date.now() + 24 * 3600 * 1000,
        ...base(),
      },
    },
  ];
}
// Lifecycle guard: every create and archive in the organization declares and
// rewrites the same fixed document, so an archive racing a create is a
// detectable write conflict instead of a stale pre-check (DATA-MODEL §3.2 归档).
function guardWrite(state, orgId, bump) {
  const id = guardId(orgId);
  const existing = state[`lifecycle_guards/${id}`];
  if (!existing && !bump)
    return [
      { collection: "lifecycle_guards", id, data: { orgId, epoch: 0, ...base() } },
    ];
  if (!existing)
    failCode("ARCHIVE_BLOCKED", "组织生命周期守卫未初始化", 409);
  return [
    {
      collection: "lifecycle_guards",
      id,
      data: bump
        ? { epoch: existing.epoch + 1, revision: (existing.revision ?? 0) + 1 }
        : { epoch: existing.epoch },
    },
  ];
}
const claim = (id, orgId, namespace, key, ownerId) => ({
  collection: "unique_claims",
  id,
  data: { orgId, namespace, key, ownerId, state: "bound", ...base() },
});
function claimFree(state, id, label) {
  const existing = state[`unique_claims/${id}`];
  if (existing && existing.state === "bound")
    failCode("DUPLICATE", `${label}已存在`, 409);
}
function claimRelease(state, id) {
  const existing = state[`unique_claims/${id}`];
  if (!existing || existing.state !== "bound") return [];
  return [
    {
      collection: "unique_claims",
      id,
      data: {
        state: "released",
        releasedAt: Date.now(),
        revision: (existing.revision ?? 0) + 1,
      },
    },
  ];
}
function page(rows, { cursor, limit }) {
  rows.sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
  let start = 0;
  if (cursor) {
    start = rows.findIndex((r) => r._id === cursor) + 1;
    if (start === 0) failCode("PARAM_ERROR", "分页游标无效或已过期");
  }
  const slice = rows.slice(start, start + limit + 1);
  const data = slice.slice(0, limit);
  return {
    data,
    nextCursor: slice.length > limit ? data[data.length - 1]._id : undefined,
  };
}
export function pageParams(query) {
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    failCode("PARAM_ERROR", "limit 需为 1–100 的整数");
  return {
    limit,
    cursor:
      query.cursor === undefined || query.cursor === ""
        ? undefined
        : String(query.cursor),
  };
}
const CATALOG_KINDS = ["community", "building", "floor", "layout"];
const PARENT_KIND = { building: "community", floor: "building", layout: "building" };
// Organization-scoped property service (docs/database/API-CONTRACT.md §2).
// Every record carries orgId, schemaVersion=2 and an integer revision;
// uniqueness is enforced by fixed-ID claims written in the same transaction.
// Legacy records without orgId are never visible here — they require the
// explicit manifest migration (DB-08), not a silent default to this org.
export class OrgPropertyService {
  constructor(store, orgId) {
    this.store = store;
    this.orgId = orgId;
  }
  own(record) {
    return record && record.orgId === this.orgId;
  }
  async catalogRecord(id, kind = null) {
    const record = (await this.store.list("property_catalog")).find(
      (r) => r._id === id,
    );
    if (!this.own(record) || (kind && record.kind !== kind))
      failCode("NOT_FOUND", "记录不存在或不可见", 404);
    return record;
  }
  async listCatalog(query = {}) {
    const { cursor, limit } = pageParams(query);
    if (query.kind !== undefined && !CATALOG_KINDS.includes(query.kind))
      failCode("PARAM_ERROR", "物业分类无效");
    if (query.status !== undefined && !["active", "archived"].includes(query.status))
      failCode("PARAM_ERROR", "状态无效");
    const rows = (await this.store.list("property_catalog")).filter(
      (r) =>
        this.own(r) &&
        (query.kind === undefined || r.kind === query.kind) &&
        (query.parentId === undefined || r.parentId === query.parentId) &&
        (query.status === undefined || (r.status || "active") === query.status),
    );
    return page(rows, { cursor, limit });
  }
  async listRooms(query = {}) {
    const { cursor, limit } = pageParams(query);
    if (query.status !== undefined && !["active", "archived"].includes(query.status))
      failCode("PARAM_ERROR", "状态无效");
    const rows = (await this.store.list("rooms"))
      .filter(
        (r) =>
          this.own(r) &&
          (query.buildingId === undefined || r.buildingId === query.buildingId) &&
          (query.floorId === undefined || r.floorId === query.floorId) &&
          (query.status === undefined || (r.status || "active") === query.status),
      )
      .map((r) => ({ roomId: r._id, ...r }));
    return page(rows, { cursor, limit });
  }
  catalogValue(data) {
    const kind = data.kind;
    if (!CATALOG_KINDS.includes(kind))
      failCode("PARAM_ERROR", "物业分类无效");
    const value = { kind, name: text(data.name, "名称") };
    if (kind === "layout") {
      if (data.isPublic !== undefined && typeof data.isPublic !== "boolean")
        failCode("PARAM_ERROR", "是否为公共用房必须为布尔值");
      value.isPublic = data.isPublic === true;
      value.code = text(data.code, "户型编码", 20).toUpperCase();
      if (!/^[A-Z0-9_-]+$/.test(value.code))
        failCode("PARAM_ERROR", "户型编码只允许字母、数字、下划线和连字符");
      for (const f of ["bedrooms", "livingRooms"])
        if (!Number.isInteger(data[f]) || data[f] < 0 || data[f] > 20)
          failCode("PARAM_ERROR", "房间数和客厅数需为 0–20 的整数");
      value.bedrooms = data.bedrooms;
      value.livingRooms = data.livingRooms;
      value.rooms = `${data.bedrooms}室${data.livingRooms}厅`;
    }
    if (kind === "floor") {
      if (!Number.isInteger(data.level) || data.level < -10 || data.level > 200)
        failCode("PARAM_ERROR", "楼层序号需为 -10–200 的整数");
      value.level = data.level;
      value.slots = [];
    }
    return value;
  }
  catalogClaim(value, parentId) {
    if (value.kind === "layout")
      return {
        id: claims.layoutCode(this.orgId, parentId, value.code),
        namespace: "layout-code",
        key: value.code,
        label: "该楼栋的户型编码",
      };
    if (value.kind === "floor")
      return {
        id: claims.floorLevel(this.orgId, parentId, value.level),
        namespace: "floor-level",
        key: String(value.level),
        label: "该楼栋的楼层",
      };
    return {
      id: claims.catalogName(this.orgId, parentId, value.kind, value.name),
      namespace: "catalog-name",
      key: value.name,
      label: "同一范围内的名称",
    };
  }
  async createCatalog(data, audit, op = null) {
    const value = this.catalogValue(data || {});
    const parentId =
      value.kind === "community" ? "" : text(data.parentId, "上级物业编号");
    const id = `cat-${randomUUID()}`;
    const claimInfo = this.catalogClaim(value, parentId);
    const refs = [
      ref("lifecycle_guards", guardId(this.orgId)),
      ref("unique_claims", claimInfo.id),
      ref("property_catalog", id),
    ];
    if (parentId) refs.push(ref("property_catalog", parentId));
    if (op) refs.push(ref("operation_keys", op.id));
    const result = {
      _id: id,
      orgId: this.orgId,
      ...value,
      parentId,
      status: "active",
      revision: 1,
    };
    await this.store.transact(
      refs,
      (state) => {
        const opw = opWrite(state, op, { status: 201, body: result });
        if (parentId) {
          const parent = state[`property_catalog/${parentId}`];
          if (!this.own(parent) || parent.kind !== PARENT_KIND[value.kind])
            failCode("NOT_FOUND", "上级物业不存在或不可见", 404);
          if ((parent.status || "active") !== "active")
            failCode("INVALID_STATE", "上级物业已归档，不能新增下级", 409);
        }
        claimFree(state, claimInfo.id, claimInfo.label);
        return [
          ...guardWrite(state, this.orgId, false),
          claim(claimInfo.id, this.orgId, claimInfo.namespace, claimInfo.key, id),
          {
            collection: "property_catalog",
            id,
            data: { orgId: this.orgId, ...value, parentId, status: "active", ...base() },
          },
          ...opw,
        ];
      },
      audit,
    );
    return result;
  }
  async createProperty(data, audit, op = null) {
    if (!data || !["new", "existing"].includes(data.mode))
      failCode("PARAM_ERROR", "请选择新建小区或已有小区");
    const buildingName = text(data.buildingName, "楼栋名称");
    const communityName =
      data.mode === "new" ? text(data.communityName, "小区名称") : null;
    const communityId =
      data.mode === "new" ? `cat-${randomUUID()}` : text(data.communityId, "小区编号");
    const buildingId = `cat-${randomUUID()}`;
    const communityClaim =
      data.mode === "new"
        ? {
            id: claims.catalogName(this.orgId, "", "community", communityName),
            namespace: "catalog-name",
            key: communityName,
          }
        : null;
    const buildingClaim = {
      id: claims.catalogName(this.orgId, communityId, "building", buildingName),
      namespace: "catalog-name",
      key: buildingName,
    };
    const refs = [
      ref("lifecycle_guards", guardId(this.orgId)),
      ref("property_catalog", communityId),
      ref("property_catalog", buildingId),
      ref("unique_claims", buildingClaim.id),
    ];
    if (communityClaim) refs.push(ref("unique_claims", communityClaim.id));
    if (op) refs.push(ref("operation_keys", op.id));
    const result = { communityId, buildingId };
    await this.store.transact(
      refs,
      (state) => {
        const opw = opWrite(state, op, { status: 201, body: result });
        if (data.mode === "existing") {
          const community = state[`property_catalog/${communityId}`];
          if (!this.own(community) || community.kind !== "community")
            failCode("NOT_FOUND", "小区不存在或不可见", 404);
          if ((community.status || "active") !== "active")
            failCode("INVALID_STATE", "小区已归档，不能新增楼栋", 409);
        }
        if (communityClaim) claimFree(state, communityClaim.id, "该小区");
        claimFree(state, buildingClaim.id, "该小区内同名楼栋");
        const writes = [...guardWrite(state, this.orgId, false)];
        if (communityClaim) {
          writes.push(
            claim(communityClaim.id, this.orgId, "catalog-name", communityName, communityId),
            {
              collection: "property_catalog",
              id: communityId,
              data: {
                orgId: this.orgId,
                kind: "community",
                name: communityName,
                parentId: "",
                status: "active",
                ...base(),
              },
            },
          );
        }
        writes.push(
          claim(buildingClaim.id, this.orgId, "catalog-name", buildingName, buildingId),
          {
            collection: "property_catalog",
            id: buildingId,
            data: {
              orgId: this.orgId,
              kind: "building",
              name: buildingName,
              parentId: communityId,
              status: "active",
              ...base(),
            },
          },
          ...opw,
        );
        return writes;
      },
      audit,
    );
    return result;
  }
  async createRooms(data, audit, op = null) {
    if (
      !Array.isArray(data?.numbers) ||
      !data.numbers.length ||
      data.numbers.length > 30
    )
      failCode("PARAM_ERROR", "每批创建 1–30 间房");
    const numbers = data.numbers.map((v) => text(v, "房号", 20));
    if (numbers.some((n) => !/^[a-zA-Z0-9_-]+$/.test(n)))
      failCode("PARAM_ERROR", "房号只允许字母、数字、下划线和连字符");
    if (new Set(numbers).size !== numbers.length)
      failCode("PARAM_ERROR", "同批房号重复");
    const floor = await this.catalogRecord(text(data.floorId, "楼层编号"), "floor");
    const building = await this.catalogRecord(floor.parentId, "building");
    const community = await this.catalogRecord(building.parentId, "community");
    for (const record of [floor, building, community])
      if ((record.status || "active") !== "active")
        failCode("INVALID_STATE", "所属物业已归档，不能新增房间", 409);
    let layout = null;
    if (data.layoutId) {
      layout = await this.catalogRecord(text(data.layoutId, "户型"), "layout");
      if (layout.parentId !== building._id)
        failCode("PARAM_ERROR", "户型不属于所选楼栋");
      if ((layout.status || "active") !== "active")
        failCode("INVALID_STATE", "户型已归档，不能用于新房间", 409);
    }
    // Room IDs are random; uniqueness of the room number is enforced by the
    // room-no claim, so archiving a room (which releases the claim) keeps the
    // archived record intact while allowing the number to be reused. houseId
    // derives from the random room ID to stay globally unique across reuses.
    const ids = numbers.map(() => `room-${randomUUID()}`);
    const claimIds = numbers.map((n) => claims.roomNo(this.orgId, floor._id, n));
    const refs = [
      ref("lifecycle_guards", guardId(this.orgId)),
      ref("property_catalog", floor._id),
      ...ids.map((id) => ref("rooms", id)),
      ...claimIds.map((id) => ref("unique_claims", id)),
    ];
    if (op) refs.push(ref("operation_keys", op.id));
    const result = { count: ids.length, ids };
    await this.store.transact(
      refs,
      (state) => {
        const opw = opWrite(state, op, { status: 201, body: result });
        const floorNow = state[`property_catalog/${floor._id}`];
        if (!this.own(floorNow) || (floorNow.status || "active") !== "active")
          failCode("INVALID_STATE", "楼层已变更，请刷新后重试", 409);
        let slots = [...(floorNow.slots || [])];
        if (slots.length + numbers.length > 1000)
          failCode("PARAM_ERROR", "单层最多维护 1000 间房");
        const writes = [];
        numbers.forEach((number, i) => {
          claimFree(state, claimIds[i], `房号 ${number}`);
          if (slots.some((s) => s.number === number) || state[`rooms/${ids[i]}`])
            failCode("DUPLICATE", `房号 ${number} 已存在，整批未保存`, 409);
          slots.push({ number, id: ids[i] });
          writes.push(
            claim(claimIds[i], this.orgId, "room-no", number, ids[i]),
            {
              collection: "rooms",
              id: ids[i],
              data: {
                orgId: this.orgId,
                houseId: `PROP-${hash("v2", this.orgId, ids[i])}`,
                communityId: community._id,
                community: community.name,
                buildingId: building._id,
                buildingName: building.name,
                floorId: floor._id,
                floorName: floor.name,
                roomNo: number,
                name: `${building.name} ${floor.name} ${number}室`,
                address: `${community.name} ${building.name} ${floor.name} ${number}室`,
                layoutId: layout?._id || "",
                layoutName: layout?.name || "",
                layoutCode: layout?.code || "",
                rooms: layout?.rooms || "",
                isPublic: layout?.isPublic === true,
                sortOrder: i,
                status: "active",
                ...base(),
              },
            },
          );
        });
        writes.push(
          {
            collection: "property_catalog",
            id: floor._id,
            data: { slots, revision: (floorNow.revision ?? 0) + 1 },
          },
          ...guardWrite(state, this.orgId, false),
          ...opw,
        );
        return writes;
      },
      audit,
    );
    return result;
  }
  async batchLayout(data, audit, op = null) {
    if (
      !Array.isArray(data?.ids) ||
      !data.ids.length ||
      data.ids.length > 30 ||
      new Set(data.ids).size !== data.ids.length
    )
      failCode("PARAM_ERROR", "请选择 1–30 间不同的房间");
    const layoutId = text(data.layoutId, "户型");
    const layout = await this.catalogRecord(layoutId, "layout");
    if ((layout.status || "active") !== "active")
      failCode("INVALID_STATE", "户型已归档，不能用于批量设置", 409);
    const expected = data.expectedRevisions;
    if (expected !== undefined) {
      if (typeof expected !== "object" || expected === null || Array.isArray(expected))
        failCode("PARAM_ERROR", "expectedRevisions 格式无效");
      for (const id of data.ids)
        if (!Number.isInteger(expected[id]))
          failCode("PARAM_ERROR", "缺少所选房间的 expectedRevision");
    }
    const all = await this.store.list("rooms");
    const selected = data.ids.map((id) => {
      const room = all.find((r) => r._id === id);
      if (!this.own(room)) failCode("NOT_FOUND", "所选房间不存在或不可见", 404);
      return room;
    });
    const refs = [
      ref("lifecycle_guards", guardId(this.orgId)),
      ref("property_catalog", layoutId),
      ...selected.map((r) => ref("rooms", r._id)),
      ...selected.filter((r) => r.listingId).map((r) => ref("houses", r.listingId)),
    ];
    if (op) refs.push(ref("operation_keys", op.id));
    const result = { count: selected.length };
    await this.store.transact(
      refs,
      (state) => {
        const opw = opWrite(state, op, { status: 200, body: result });
        const layoutNow = state[`property_catalog/${layoutId}`];
        if (!this.own(layoutNow) || (layoutNow.status || "active") !== "active")
          failCode("INVALID_STATE", "户型已变更，请刷新后重试", 409);
        const patch = {
          layoutId: layoutNow._id,
          layoutName: layoutNow.name,
          layoutCode: layoutNow.code,
          rooms: layoutNow.rooms,
          isPublic: layoutNow.isPublic === true,
        };
        const writes = [...guardWrite(state, this.orgId, false)];
        for (const previous of selected) {
          const room = state[`rooms/${previous._id}`];
          if (!this.own(room)) failCode("NOT_FOUND", "所选房间不存在或不可见", 404);
          if ((room.status || "active") !== "active")
            failCode("INVALID_STATE", "已归档房间不能设置户型", 409);
          if (room.buildingId !== layoutNow.parentId)
            failCode("PARAM_ERROR", "所选房间须属于该户型所在楼栋，整批未保存");
          if (room.listingId !== previous.listingId)
            failCode("REVISION_CONFLICT", "房源关联已改变，请刷新后重试", 409);
          if (expected && expected[room._id] !== room.revision)
            failCode("REVISION_CONFLICT", `房间 ${room.roomNo} 版本不一致，请刷新后重试`, 409);
          writes.push({
            collection: "rooms",
            id: room._id,
            data: { ...patch, revision: (room.revision ?? 0) + 1 },
          });
          if (room.listingId) {
            const listing = state[`houses/${room.listingId}`];
            if (!listing) failCode("REVISION_CONFLICT", "关联房源不存在，请先核对", 409);
            if (listing.propertyRoomId !== room._id)
              failCode("REVISION_CONFLICT", "房源关联不一致，请先核对", 409);
            writes.push({
              collection: "houses",
              id: room.listingId,
              data: { ...patch, revision: (listing.revision ?? 0) + 1 },
            });
          }
        }
        writes.push(...opw);
        return writes;
      },
      audit,
    );
    return result;
  }
  // Archive never deletes; it marks lifecycle and keeps history readable.
  // Active relations or unhandled listings block archiving with non-sensitive
  // counts only (Q06 建议); concurrency with creation is serialized by the
  // organization lifecycle guard.
  async archive(type, id, data, audit, op = null) {
    const archiveTypes = [...CATALOG_KINDS, "room", "house"];
    if (!archiveTypes.includes(type)) failCode("PARAM_ERROR", "归档类型无效");
    const reason = text(data?.reason, "归档原因", 200);
    if (!Number.isInteger(data?.expectedRevision))
      failCode("PARAM_ERROR", "缺少 expectedRevision");
    const [catalogRows, roomRows, houseRows, userRows] = await Promise.all([
      this.store.list("property_catalog"),
      this.store.list("rooms"),
      this.store.list("houses"),
      this.store.list("users"),
    ]);
    const active = (r) => (r.status || "active") === "active";
    const collection =
      type === "room" ? "rooms" : type === "house" ? "houses" : "property_catalog";
    let target, blockers = null;
    if (type === "room") {
      target = roomRows.find((r) => r._id === id);
      if (!this.own(target)) failCode("NOT_FOUND", "记录不存在或不可见", 404);
      const listing = target.listingId
        ? houseRows.find((h) => h._id === target.listingId)
        : null;
      const listings = listing && (listing.lifecycle || "active") === "active" ? 1 : 0;
      const boundUsers = userRows.filter(
        (u) => Array.isArray(u.houses) && u.houses.includes(target.houseId),
      ).length;
      if (listings || boundUsers)
        blockers = { 关联房源: listings, 绑定用户: boundUsers };
    } else if (type === "house") {
      target = houseRows.find((r) => r._id === id);
      if (!this.own(target)) failCode("NOT_FOUND", "记录不存在或不可见", 404);
    } else {
      target = catalogRows.find((r) => r._id === id && r.kind === type);
      if (!this.own(target)) failCode("NOT_FOUND", "记录不存在或不可见", 404);
      const children = catalogRows.filter(
        (r) => this.own(r) && r.parentId === id && active(r),
      );
      const roomsActive = roomRows.filter(
        (r) =>
          this.own(r) &&
          active(r) &&
          (type === "community"
            ? r.communityId === id
            : type === "building"
              ? r.buildingId === id
              : type === "floor"
                ? r.floorId === id
                : r.layoutId === id),
      );
      if (children.length || roomsActive.length)
        blockers = {
          ...(type === "community" ? { 楼栋: children.length } : {}),
          ...(type === "building"
            ? {
                楼层: children.filter((c) => c.kind === "floor").length,
                户型: children.filter((c) => c.kind === "layout").length,
              }
            : {}),
          房间: roomsActive.length,
        };
    }
    // Houses keep their business status (在租/已租/下架); lifecycle is separate.
    const stateOf = (r) =>
      (collection === "houses" ? r.lifecycle : r.status) || "active";
    if (stateOf(target) !== "active")
      failCode("INVALID_STATE", "记录已归档", 409);
    if ((target.revision ?? 0) !== data.expectedRevision)
      failCode("REVISION_CONFLICT", "记录版本不一致，请刷新后重试", 409);
    if (blockers)
      failCode(
        "ARCHIVE_BLOCKED",
        `存在未处理的关联，不能归档：${Object.entries(blockers)
          .map(([k, v]) => `${k}${v}项`)
          .join("，")}`,
        409,
      );
    const claimIds = [];
    if (type === "room")
      claimIds.push({ id: claims.roomNo(this.orgId, target.floorId, target.roomNo) });
    else if (type === "floor")
      claimIds.push({ id: claims.floorLevel(this.orgId, target.parentId, target.level) });
    else if (type === "layout")
      claimIds.push({ id: claims.layoutCode(this.orgId, target.parentId, target.code) });
    else if (type === "community" || type === "building")
      claimIds.push({
        id: claims.catalogName(this.orgId, target.parentId, type, target.name),
      });
    const refs = [
      ref("lifecycle_guards", guardId(this.orgId)),
      ref(collection, id),
      ...claimIds.map((c) => ref("unique_claims", c.id)),
    ];
    if (type === "room" && target.floorId)
      refs.push(ref("property_catalog", target.floorId));
    if (op) refs.push(ref("operation_keys", op.id));
    const result = { id, type, status: "archived" };
    const archivedBy = audit.actorId || audit.actor || "unknown";
    await this.store.transact(
      refs,
      (state) => {
        const opw = opWrite(state, op, { status: 200, body: result });
        const current = state[`${collection}/${id}`];
        if (!current || (current.revision ?? 0) !== data.expectedRevision)
          failCode("REVISION_CONFLICT", "记录版本不一致，请刷新后重试", 409);
        if (stateOf(current) !== "active")
          failCode("INVALID_STATE", "记录已归档", 409);
        const lifecycle =
          collection === "houses"
            ? { lifecycle: "archived" }
            : { status: "archived" };
        const writes = [
          {
            collection,
            id,
            data: {
              ...lifecycle,
              archivedAt: Date.now(),
              archivedBy,
              archiveReason: reason,
              revision: (current.revision ?? 0) + 1,
            },
          },
          ...guardWrite(state, this.orgId, true),
        ];
        if (type === "room" && target.floorId) {
          const floor = state[`property_catalog/${target.floorId}`];
          if (floor)
            writes.push({
              collection: "property_catalog",
              id: target.floorId,
              data: {
                slots: (floor.slots || []).filter((s) => s.id !== id),
                revision: (floor.revision ?? 0) + 1,
              },
            });
        }
        for (const c of claimIds) writes.push(...claimRelease(state, c.id));
        writes.push(...opw);
        return writes;
      },
      audit,
    );
    return result;
  }
}
