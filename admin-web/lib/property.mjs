import { floorPlan, roomPlan } from "../public/auto-fill.js";
import { createHash } from "node:crypto";
import { fail } from "./model.mjs";
const ref = (collection, id) => ({ collection, id });
const stable = (...parts) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
const text = (v, label, max = 80) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    fail(`${label}需为 1–${max} 字`);
  return v.trim();
};
const get = (state, collection, id) => {
  const v = state[`${collection}/${id}`];
  if (!v) fail("关联记录不存在，请刷新后重试", 409);
  return v;
};
const cat = (state, id, kind) => {
  const v = get(state, "property_catalog", id);
  if (v.kind !== kind) fail("物业层级不匹配");
  return v;
};
function location(state, floorId) {
  const floor = cat(state, floorId, "floor"),
    building = cat(state, floor.parentId, "building"),
    community = cat(state, building.parentId, "community");
  return { floor, building, community };
}
function roomFields(state, floorId, layoutId) {
  const { floor, building, community } = location(state, floorId);
  let layout = null;
  if (layoutId) {
    layout = cat(state, layoutId, "layout");
    if (layout.parentId !== building._id) fail("户型不属于所选楼栋");
  }
  return {
    communityId: community._id,
    community: community.name,
    buildingId: building._id,
    buildingName: building.name,
    floorId: floor._id,
    floorName: floor.name,
    layoutId: layout?._id || "",
    layoutName: layout?.name || "",
    layoutCode: layout?.code || "",
    rooms: layout?.rooms || "",
    isPublic: layout?.isPublic === true,
  };
}
export class PropertyService {
  constructor(store) {
    this.store = store;
  }
  async snapshot() {
    const [catalog, rooms] = await Promise.all([
      this.store.list("property_catalog"),
      this.store.list("rooms"),
    ]);
    return { catalog, rooms };
  }
  async createProperty(data, audit) {
    if (!data || !["new", "existing"].includes(data.mode))
      fail("请选择新建小区或已有小区");
    const buildingName = text(data.buildingName, "楼栋名称");
    const communityName =
      data.mode === "new" ? text(data.communityName, "小区名称") : null;
    const communityId =
      data.mode === "new"
        ? "cat-" + stable("community", "", communityName)
        : text(data.communityId, "小区编号");
    const buildingId = "cat-" + stable("building", communityId, buildingName);
    await this.store.transact(
      [
        ref("property_catalog", communityId),
        ref("property_catalog", buildingId),
      ],
      (state) => {
        if (data.mode === "new" && state[`property_catalog/${communityId}`])
          fail("该小区已存在，请选择已有小区", 409);
        if (data.mode === "existing") cat(state, communityId, "community");
        if (state[`property_catalog/${buildingId}`])
          fail("该小区内已有同名楼栋", 409);
        const writes = [];
        if (data.mode === "new")
          writes.push({
            collection: "property_catalog",
            id: communityId,
            data: { kind: "community", name: communityName, parentId: "" },
          });
        writes.push({
          collection: "property_catalog",
          id: buildingId,
          data: { kind: "building", name: buildingName, parentId: communityId },
        });
        return writes;
      },
      audit,
    );
    return { communityId, buildingId };
  }
  async createCatalog(data, audit) {
    if (!["community", "building", "floor", "layout"].includes(data.kind))
      fail("物业分类无效");
    const kind = data.kind,
      name = text(data.name, "名称", 80);
    let parentId =
      kind === "community" ? "" : text(data.parentId, "上级物业编号");
    const value = { kind, name, parentId };
    if (kind === "layout") {
      if (data.isPublic !== undefined && typeof data.isPublic !== "boolean")
        fail("是否为公共用房必须为布尔值");
      value.isPublic = data.isPublic === true;
      value.code = text(data.code, "户型编码", 20).toUpperCase();
      if (!/^[A-Z0-9_-]+$/.test(value.code))
        fail("户型编码只允许字母、数字、下划线和连字符");
      for (const f of ["bedrooms", "livingRooms"])
        if (!Number.isInteger(data[f]) || data[f] < 0 || data[f] > 20)
          fail("房间数和客厅数需为 0–20 的整数");
      value.bedrooms = data.bedrooms;
      value.livingRooms = data.livingRooms;
      value.rooms = `${data.bedrooms}室${data.livingRooms}厅`;
    }
    if (kind === "floor") {
      if (!Number.isInteger(data.level) || data.level < -10 || data.level > 200)
        fail("楼层序号需为 -10–200 的整数");
      value.level = data.level;
      value.slots = [];
    }
    const id =
      "cat-" + stable(kind, parentId, value.code ?? value.level ?? name);
    const refs = [ref("property_catalog", id)];
    if (parentId) refs.push(ref("property_catalog", parentId));
    await this.store.transact(
      refs,
      (state) => {
        if (state[`property_catalog/${id}`])
          fail("同一范围内的名称、楼层或户型编码已存在", 409);
        if (parentId)
          cat(state, parentId, kind === "building" ? "community" : "building");
        return [{ collection: "property_catalog", id, data: value }];
      },
      audit,
    );
    return { ...value, _id: id };
  }
  async context(floorId, layoutId) {
    const catalog = await this.store.list("property_catalog");
    const floor = catalog.find((c) => c._id === floorId && c.kind === "floor");
    if (!floor) fail("请选择有效楼层");
    const building = catalog.find(
      (c) => c._id === floor.parentId && c.kind === "building",
    );
    if (!building) fail("所属楼栋不存在");
    const refs = [
      ref("property_catalog", floorId),
      ref("property_catalog", building._id),
      ref("property_catalog", building.parentId),
    ];
    if (layoutId) refs.push(ref("property_catalog", layoutId));
    return refs;
  }
  async autoFloors(data, audit) {
    const buildingId = text(data.buildingId, "楼栋编号");
    const plan = floorPlan(data);
    const ids = plan.map((f) => "cat-" + stable("floor", buildingId, f.level));
    let count = 0;
    await this.store.transact(
      [
        ref("property_catalog", buildingId),
        ...ids.map((id) => ref("property_catalog", id)),
      ],
      (state) => {
        cat(state, buildingId, "building");
        count = 0;
        return plan.flatMap((f, i) => {
          if (state[`property_catalog/${ids[i]}`]) return [];
          count++;
          return [
            {
              collection: "property_catalog",
              id: ids[i],
              data: { kind: "floor", parentId: buildingId, ...f, slots: [] },
            },
          ];
        });
      },
      audit,
    );
    return { count, skipped: plan.length - count };
  }
  async autoRooms(data, audit) {
    const catalog = await this.store.list("property_catalog");
    const fullPlan = roomPlan(data, catalog);
    const offset = data.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset >= fullPlan.length)
      fail("批次位置无效");
    const plan = fullPlan.slice(offset, offset + 25);
    const building = catalog.find(
      (c) => c._id === data.buildingId && c.kind === "building",
    );
    if (!building) fail("楼栋不存在");
    const ids = plan.map((p) => "room-" + stable(p.floorId, p.number));
    const refs = [
      ref("property_catalog", building._id),
      ref("property_catalog", building.parentId),
      ...new Set(plan.map((p) => p.floorId)),
    ].map((r) => (typeof r === "string" ? ref("property_catalog", r) : r));
    if (data.layoutId) refs.push(ref("property_catalog", data.layoutId));
    refs.push(...ids.map((id) => ref("rooms", id)));
    let count = 0;
    await this.store.transact(
      refs,
      (state) => {
        count = 0;
        const floors = new Map();
        const writes = [];
        for (let i = 0; i < plan.length; i++) {
          const p = plan[i],
            floor = cat(state, p.floorId, "floor");
          if (floor.parentId !== data.buildingId)
            fail("楼栋已改变，请刷新重试", 409);
          const fields = roomFields(state, p.floorId, data.layoutId);
          let slots = floors.get(floor._id) || [...(floor.slots || [])];
          if (
            slots.some((s) => s.number === p.number) ||
            state[`rooms/${ids[i]}`]
          )
            continue;
          if (slots.length >= 1000) fail("单层最多 1000 间");
          slots.push({ number: p.number, id: ids[i] });
          floors.set(floor._id, slots);
          writes.push({
            collection: "rooms",
            id: ids[i],
            data: {
              ...fields,
              houseId: "PROP-" + stable(p.floorId, p.number),
              roomNo: p.number,
              name: `${fields.buildingName} ${fields.floorName} ${p.number}室`,
              address: `${fields.community} ${fields.buildingName} ${fields.floorName} ${p.number}室`,
              sortOrder: offset + i,
            },
          });
          count++;
        }
        for (const [id, slots] of floors)
          writes.push({ collection: "property_catalog", id, data: { slots } });
        return writes;
      },
      audit,
    );
    return {
      count,
      skipped: plan.length - count,
      total: fullPlan.length,
      nextOffset: offset + plan.length,
    };
  }
  async createRooms(data, audit) {
    if (
      !Array.isArray(data.numbers) ||
      !data.numbers.length ||
      data.numbers.length > 50
    )
      fail("每批创建 1–50 间房");
    const numbers = data.numbers.map((v) => text(v, "房号", 20));
    if (numbers.some((n) => !/^[a-zA-Z0-9_-]+$/.test(n)))
      fail("房号只允许字母、数字、下划线和连字符");
    if (new Set(numbers).size !== numbers.length) fail("同批房号重复");
    const refs = await this.context(data.floorId, data.layoutId);
    const ids = numbers.map((n) => "room-" + stable(data.floorId, n));
    refs.push(...ids.map((id) => ref("rooms", id)));
    await this.store.transact(
      refs,
      (state) => {
        const fields = roomFields(state, data.floorId, data.layoutId);
        const floor = cat(state, data.floorId, "floor"),
          slots = [...(floor.slots || [])];
        if (slots.length + numbers.length > 1000)
          fail("单层最多维护 1000 间房");
        const writes = numbers.map((number, i) => {
          const id = ids[i];
          if (slots.some((s) => s.number === number) || state[`rooms/${id}`])
            fail(`房号 ${number} 已存在，整批未保存`, 409);
          slots.push({ number, id });
          return {
            collection: "rooms",
            id,
            data: {
              ...fields,
              houseId: "PROP-" + stable(data.floorId, number),
              roomNo: number,
              name: `${fields.buildingName} ${fields.floorName} ${number}室`,
              address: `${fields.community} ${fields.buildingName} ${fields.floorName} ${number}室`,
              sortOrder: i,
            },
          };
        });
        writes.push({
          collection: "property_catalog",
          id: floor._id,
          data: { slots },
        });
        return writes;
      },
      audit,
    );
    return { count: ids.length, ids };
  }
  async assignRoom(id, data, audit) {
    const number = text(data.roomNo, "房号", 20);
    if (!/^[a-zA-Z0-9_-]+$/.test(number)) fail("房号格式无效");
    const before = (await this.store.list("rooms")).find((r) => r._id === id);
    if (!before) fail("房间不存在", 404);
    if (before.listingId)
      fail("已关联出租房源的房间不能移动，请通过批量户型功能修改户型");
    const refs = await this.context(data.floorId, data.layoutId);
    refs.push(ref("rooms", id));
    if (before.floorId) refs.push(ref("property_catalog", before.floorId));
    await this.store.transact(
      refs,
      (state) => {
        const room = get(state, "rooms", id);
        if (room.listingId || room.floorId !== before.floorId)
          fail("房间已变更，请刷新重试", 409);
        const fields = roomFields(state, data.floorId, data.layoutId);
        const floor = cat(state, data.floorId, "floor");
        let slots = (floor.slots || []).filter((s) => s.id !== id);
        if (slots.some((s) => s.number === number))
          fail("该楼层已存在此房号", 409);
        if (slots.length >= 1000) fail("单层最多维护 1000 间房");
        slots.push({ number, id });
        const writes = [
          {
            collection: "rooms",
            id,
            data: {
              ...fields,
              roomNo: number,
              name: `${fields.buildingName} ${fields.floorName} ${number}室`,
              address: `${fields.community} ${fields.buildingName} ${fields.floorName} ${number}室`,
            },
          },
          { collection: "property_catalog", id: floor._id, data: { slots } },
        ];
        if (room.floorId && room.floorId !== floor._id) {
          const old = cat(state, room.floorId, "floor");
          writes.push({
            collection: "property_catalog",
            id: old._id,
            data: { slots: (old.slots || []).filter((s) => s.id !== id) },
          });
        }
        return writes;
      },
      audit,
    );
    return { ok: true };
  }
  async batchLayout(data, audit) {
    if (
      !Array.isArray(data.ids) ||
      !data.ids.length ||
      data.ids.length > 30 ||
      new Set(data.ids).size !== data.ids.length
    )
      fail("请选择 1–30 间不同的房间");
    const rooms = await this.store.list("rooms");
    const selected = data.ids.map((id) => {
      const room = rooms.find((r) => r._id === id);
      if (!room) fail("所选房间不存在");
      return room;
    });
    const refs = [
      ref("property_catalog", text(data.layoutId, "户型")),
      ...selected.map((r) => ref("rooms", r._id)),
      ...selected
        .filter((r) => r.listingId)
        .map((r) => ref("houses", r.listingId)),
    ];
    await this.store.transact(
      refs,
      (state) => {
        const layout = cat(state, data.layoutId, "layout");
        const patch = {
          layoutId: layout._id,
          layoutName: layout.name,
          layoutCode: layout.code,
          rooms: layout.rooms,
          isPublic: layout.isPublic === true,
        };
        return selected.flatMap((previous) => {
          const room = get(state, "rooms", previous._id);
          if (room.buildingId !== layout.parentId)
            fail("所选房间须属于该户型所在楼栋，整批未保存");
          if (room.listingId !== previous.listingId)
            fail("房源关联已改变，请刷新后重试", 409);
          const writes = [{ collection: "rooms", id: room._id, data: patch }];
          if (room.listingId) {
            const listing = get(state, "houses", room.listingId);
            if (listing.propertyRoomId !== room._id)
              fail("房源关联不一致，请先核对", 409);
            writes.push({
              collection: "houses",
              id: room.listingId,
              data: patch,
            });
          }
          return writes;
        });
      },
      audit,
    );
    return { count: selected.length };
  }
  async saveListing(id, data, roomId, audit) {
    const creating = !id;
    const rooms = await this.store.list("rooms");
    const initial = rooms.find((r) => r._id === roomId);
    if (!initial) fail("关联房间不存在");
    if (!initial.layoutId) fail("请先为房间设置户型");
    id = id || "listing-" + stable(roomId);
    const refs = [ref("rooms", roomId), ref("houses", id)];
    await this.store.transact(
      refs,
      (state) => {
        const room = get(state, "rooms", roomId),
          old = state[`houses/${id}`];
        if (creating && old) fail("该房间已有出租房源，请编辑原记录", 409);
        if (!room.layoutId) fail("请先为房间设置户型");
        if (room.listingId && room.listingId !== id)
          fail("该房间已经关联另一条房源", 409);
        if (old?.propertyRoomId && old.propertyRoomId !== roomId)
          fail("已关联房源不可更换房间");
        const canonical = Object.fromEntries(
          [
            "communityId",
            "community",
            "buildingId",
            "buildingName",
            "floorId",
            "floorName",
            "roomNo",
            "layoutId",
            "layoutName",
            "layoutCode",
            "rooms",
          ].map((k) => [k, room[k] || ""]),
        );
        return [
          {
            collection: "houses",
            id,
            data: {
              ...data,
              ...canonical,
              isPublic: room.isPublic === true,
              propertyRoomId: roomId,
            },
          },
          { collection: "rooms", id: roomId, data: { listingId: id } },
        ];
      },
      audit,
    );
    return (await this.store.list("houses")).find((r) => r._id === id);
  }
}
