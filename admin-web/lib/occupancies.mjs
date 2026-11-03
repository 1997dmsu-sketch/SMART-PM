import { createHash, randomUUID } from "node:crypto";
import { failCode } from "./model.mjs";
import { claimId, guardId } from "./claims.mjs";
import { opWrite, page, pageParams } from "./property-v2.mjs";

// DB-05: org-scoped occupancy cycles and relations (DATA-MODEL §2/§3.2,
// API-CONTRACT §5). Pending records never grant access. Every activation goes
// through DB-06 withEligibility; primary activation/end serializes on the fixed
// room slot and every member mutation writes the same cycle epoch.
const ref = (collection, id) => ({ collection, id });
const base = () => ({ schemaVersion: 2, revision: 1, createdAt: Date.now() });
const hash = (...parts) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
const text = (value, label, max = 160) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    failCode("PARAM_ERROR", `${label}需为 1–${max} 字`);
  return value.trim();
};
const requiredRevision = (value, label = "expectedRevision") => {
  if (!Number.isInteger(value) || value < 1)
    failCode("PARAM_ERROR", `缺少有效的 ${label}`);
  return value;
};
const range = (startsAt, endsAt) => {
  if (!Number.isInteger(startsAt) || startsAt < 0 ||
      (endsAt !== null && (!Number.isInteger(endsAt) || endsAt <= startsAt)))
    failCode("PARAM_ERROR", "入住有效期无效");
  return { startsAt, endsAt };
};
const activeAt = (record, now) =>
  record.startsAt <= now && (record.endsAt === null || now < record.endsAt);
const minEnd = (...values) => {
  const present = values.filter((v) => v !== null && v !== undefined);
  return present.length ? Math.min(...present) : null;
};
const bump = (record) => ({
  epoch: (record?.epoch ?? 0) + 1,
  ...(record ? { revision: (record.revision ?? 0) + 1 } : base()),
});
const uniqueRefs = (refs) => [
  ...new Map(refs.map((r) => [`${r.collection}/${r.id}`, r])).values(),
];
export const primarySlotId = (orgId, roomId) =>
  `room-primary-slot-${hash(orgId, roomId)}`;
export const occupancyClaimId = (orgId, roomId, cycleId, personId) =>
  claimId("occupancy-person", `${orgId}|${roomId}|${cycleId}`, personId);

function lifecycleWrite(state, orgId) {
  const id = guardId(orgId);
  const current = state[`lifecycle_guards/${id}`];
  return {
    collection: "lifecycle_guards",
    id,
    data: current
      ? { epoch: current.epoch + 1, revision: (current.revision ?? 0) + 1 }
      : { orgId, epoch: 1, ...base() },
  };
}

export class OccupancyService {
  constructor(store, orgId, auth = null, { blacklist = null, now = Date.now } = {}) {
    this.store = store;
    this.orgId = orgId;
    this.auth = auth;
    this.blacklist = blacklist;
    this.now = now;
  }
  authRefs() {
    return [
      ref("organizations", this.orgId),
      ...(this.auth?.membershipId ? [ref("org_memberships", this.auth.membershipId)] : []),
    ];
  }
  orgCheck(state) {
    const org = state[`organizations/${this.orgId}`];
    if (!org || org.status !== "active")
      failCode("FORBIDDEN", "组织当前不可用", 403);
  }
  adminCheck(state) {
    this.orgCheck(state);
    if (!this.auth) return; // trusted internal caller / isolated service tests
    if (!this.auth.membershipId) failCode("FORBIDDEN", "仅组织管理员可执行此操作", 403);
    const membership = state[`org_memberships/${this.auth.membershipId}`];
    if (!membership || membership.orgId !== this.orgId ||
        membership.status !== "active" || membership.role !== "admin")
      failCode("FORBIDDEN", "组织成员关系已失效或权限不足", 403);
  }
  async readCheck({ resident = false } = {}) {
    const org = (await this.store.list("organizations")).find((o) => o._id === this.orgId);
    if (!org || org.status !== "active") failCode("FORBIDDEN", "组织当前不可用", 403);
    if (!this.auth) return;
    if (resident && this.auth.userId) return;
    if (!this.auth.membershipId) failCode("FORBIDDEN", "仅组织管理员可执行此操作", 403);
    const membership = (await this.store.list("org_memberships"))
      .find((m) => m._id === this.auth.membershipId);
    if (!membership || membership.orgId !== this.orgId ||
        membership.status !== "active" || membership.role !== "admin")
      failCode("FORBIDDEN", "组织成员关系已失效或权限不足", 403);
  }
  own(record) {
    return record && record.orgId === this.orgId;
  }
  async room(roomId) {
    const room = (await this.store.list("rooms", this.orgId)).find((r) => r._id === roomId);
    if (!room) failCode("NOT_FOUND", "房间不存在或不可见", 404);
    return room;
  }
  roomRefs(room) {
    return uniqueRefs([
      ref("rooms", room._id),
      ...(room.floorId ? [ref("property_catalog", room.floorId)] : []),
      ...(room.buildingId ? [ref("property_catalog", room.buildingId)] : []),
      ...(room.communityId ? [ref("property_catalog", room.communityId)] : []),
    ]);
  }
  checkRoom(state, expected) {
    const room = state[`rooms/${expected._id}`];
    if (!this.own(room)) failCode("NOT_FOUND", "房间不存在或不可见", 404);
    if ((room.status || "active") !== "active")
      failCode("ROOM_ARCHIVED", "房间已归档，不能建立或激活入住关系", 409);
    if (room.floorId !== expected.floorId || room.buildingId !== expected.buildingId ||
        room.communityId !== expected.communityId)
      failCode("REVISION_CONFLICT", "房间物业层级已变化，请刷新后重试", 409);
    for (const [id, kind] of [
      [room.floorId, "floor"], [room.buildingId, "building"], [room.communityId, "community"],
    ]) {
      if (!id) continue;
      const ancestor = state[`property_catalog/${id}`];
      if (!this.own(ancestor) || ancestor.kind !== kind)
        failCode("NOT_FOUND", "房间所属物业不存在或不可见", 404);
      if ((ancestor.status || "active") !== "active")
        failCode("ROOM_ARCHIVED", "房间所属物业已归档", 409);
    }
    return room;
  }
  async person(personId) {
    const person = (await this.store.list("persons", this.orgId)).find((p) => p._id === personId);
    if (!person) failCode("NOT_FOUND", "人员档案不存在或不可见", 404);
    return person;
  }
  checkPerson(state, personId, expectedRevision = null) {
    const person = state[`persons/${personId}`];
    if (!this.own(person)) failCode("NOT_FOUND", "人员档案不存在或不可见", 404);
    if (person.status !== "active") failCode("INVALID_STATE", "人员档案已归档", 409);
    if (expectedRevision !== null && person.revision !== expectedRevision)
      failCode("REVISION_CONFLICT", "人员档案版本已变化，请刷新后重试", 409);
    return person;
  }
  async cycle(cycleId) {
    const cycle = (await this.store.list("occupancy_cycles", this.orgId))
      .find((c) => c._id === cycleId);
    if (!cycle) failCode("NOT_FOUND", "入住周期不存在或不可见", 404);
    return cycle;
  }
  async occupancy(id) {
    const occupancy = (await this.store.list("occupancies", this.orgId)).find((o) => o._id === id);
    if (!occupancy) failCode("NOT_FOUND", "入住关系不存在或不可见", 404);
    return occupancy;
  }
  claimWrite(cycleId, roomId, personId, occupancyId) {
    return {
      collection: "unique_claims",
      id: occupancyClaimId(this.orgId, roomId, cycleId, personId),
      data: {
        orgId: this.orgId,
        namespace: "occupancy-person",
        ownerId: occupancyId,
        state: "bound",
        ...base(),
      },
    };
  }
  checkClaim(state, cycleId, roomId, personId, occupancyId, { create = false } = {}) {
    const id = occupancyClaimId(this.orgId, roomId, cycleId, personId);
    const claim = state[`unique_claims/${id}`];
    if (create) {
      if (claim) failCode("DUPLICATE_OCCUPANCY", "同一人员在同一入住周期已存在关系", 409);
    } else if (!claim || claim.orgId !== this.orgId || claim.state !== "bound" ||
               claim.ownerId !== occupancyId) {
      failCode("DUPLICATE_OCCUPANCY", "入住关系唯一占位无效，请核对数据", 409);
    }
  }
  resultFor(occupancy, cycle, extra = {}) {
    return {
      occupancyId: occupancy._id,
      cycleId: occupancy.cycleId,
      roomId: occupancy.roomId,
      personId: occupancy.personId,
      role: occupancy.role,
      storedState: occupancy.state,
      effectiveState: occupancy.state,
      startsAt: occupancy.startsAt,
      endsAt: occupancy.endsAt,
      effectiveEndsAt: minEnd(occupancy.endsAt, cycle.endsAt, cycle.endedAt),
      revision: occupancy.revision,
      cycleRevision: cycle.revision,
      cycleState: cycle.state,
      ...extra,
    };
  }
  // DB-04/DB-05 sponsor boundary for resident-created no-account profiles and
  // proxy identity submissions. Callers add these refs to their own transaction
  // and invoke check(state), so permission is revalidated atomically with the
  // business write. No userId is accepted from an HTTP body.
  async sponsorContext({ primaryOccupancyId = null, memberOccupancyId = null, personId = null }, audit) {
    if ((audit.actorType || "adminAccount") !== "user" ||
        !this.auth?.userId || audit.actorId !== this.auth.userId)
      failCode("FORBIDDEN", "住户身份上下文无效", 403);
    if (!primaryOccupancyId === !memberOccupancyId)
      failCode("PARAM_ERROR", "须提供一个主租客或成员关系引用");
    const actorPerson = (await this.store.list("persons", this.orgId))
      .find((p) => p.userId === this.auth.userId && p.status === "active");
    if (!actorPerson) failCode("FORBIDDEN", "登录账号未绑定本组织人员档案", 403);
    const member = memberOccupancyId ? await this.occupancy(memberOccupancyId) : null;
    const primaryId = primaryOccupancyId || (await this.cycle(member.cycleId)).primaryOccupancyId;
    const primary = await this.occupancy(primaryId);
    const cycle = await this.cycle(primary.cycleId);
    const slotId = primarySlotId(this.orgId, primary.roomId);
    const slot = (await this.store.list("room_primary_slots", this.orgId))
      .find((s) => s._id === slotId);
    const verify = ({ actor, primaryNow, cycleNow, slotNow, memberNow }) => {
      const now = this.now();
      if (!this.own(actor) || actor.status !== "active" || actor.userId !== this.auth.userId ||
          !this.own(primaryNow) || primaryNow.state !== "active" || primaryNow.role !== "primary" ||
          primaryNow.personId !== actor._id || !activeAt(primaryNow, now) ||
          !this.own(cycleNow) || cycleNow.state !== "active" ||
          cycleNow.primaryOccupancyId !== primaryNow._id || cycleNow.roomId !== primaryNow.roomId ||
          !activeAt(cycleNow, now) || !this.own(slotNow) ||
          slotNow.currentCycleId !== cycleNow._id || slotNow.currentOccupancyId !== primaryNow._id ||
          slotNow.currentPersonId !== actor._id)
        failCode("SPONSOR_INACTIVE", "当前主租客关系无效，不能管理成员资料", 403);
      if (memberOccupancyId && (!this.own(memberNow) || memberNow.cycleId !== cycleNow._id ||
          memberNow.role !== "member" || memberNow.personId !== personId ||
          !["invited", "pending_review", "active"].includes(memberNow.state)))
        failCode("FORBIDDEN", "只能管理本有效周期的成员资料", 403);
    };
    verify({ actor: actorPerson, primaryNow: primary, cycleNow: cycle, slotNow: slot, memberNow: member });
    return {
      refs: uniqueRefs([
        ref("persons", actorPerson._id), ref("occupancies", primary._id),
        ref("occupancy_cycles", cycle._id), ref("room_primary_slots", slotId),
        ...(member ? [ref("occupancies", member._id)] : []),
      ]),
      check: (state) => verify({
        actor: state[`persons/${actorPerson._id}`],
        primaryNow: state[`occupancies/${primary._id}`],
        cycleNow: state[`occupancy_cycles/${cycle._id}`],
        slotNow: state[`room_primary_slots/${slotId}`],
        memberNow: member ? state[`occupancies/${member._id}`] : null,
      }),
    };
  }
  async createCycle(roomId, data, audit, op = null) {
    const primaryPersonId = text(data?.primaryPersonId, "primaryPersonId");
    const period = range(data?.startsAt, data?.endsAt ?? null);
    const room = await this.room(roomId);
    await this.person(primaryPersonId);
    const cycleId = randomUUID();
    const occupancyId = randomUUID();
    const refs = [
      ...this.roomRefs(room), ref("persons", primaryPersonId),
      ref("occupancy_cycles", cycleId), ref("occupancies", occupancyId),
      ref("unique_claims", occupancyClaimId(this.orgId, roomId, cycleId, primaryPersonId)),
      ref("lifecycle_guards", guardId(this.orgId)), ...this.authRefs(),
      ...(op ? [ref("operation_keys", op.id)] : []),
    ];
    let result;
    await this.store.transact(refs, (state) => {
      this.adminCheck(state);
      this.checkRoom(state, room);
      this.checkPerson(state, primaryPersonId);
      this.checkClaim(state, cycleId, roomId, primaryPersonId, occupancyId, { create: true });
      const cycle = {
        _id: cycleId, orgId: this.orgId, roomId, primaryOccupancyId: occupancyId,
        epoch: 0, state: "pending", ...period, ...base(),
      };
      const occupancy = {
        _id: occupancyId, orgId: this.orgId, roomId, personId: primaryPersonId,
        cycleId, role: "primary", state: "pending_review", ...period,
        addedBy: audit.actorId || audit.actor || "unknown",
        addedByType: audit.actorType || "adminAccount", sponsorOccupancyId: null,
        identityApplicationId: null, ...base(),
      };
      result = this.resultFor(occupancy, cycle);
      return [
        { collection: "occupancy_cycles", id: cycleId, data: cycle },
        { collection: "occupancies", id: occupancyId, data: occupancy },
        this.claimWrite(cycleId, roomId, primaryPersonId, occupancyId),
        lifecycleWrite(state, this.orgId),
        ...opWrite(state, op, { status: 201, body: result }),
      ];
    }, audit);
    return result;
  }
  async createOccupancy(data, audit, op = null) {
    const roomId = text(data?.roomId, "roomId");
    const personId = text(data?.personId, "personId");
    const cycleId = text(data?.cycleId, "cycleId");
    if (data?.role !== "member")
      failCode("PARAM_ERROR", "普通关系接口仅允许 role=member；主租客须创建新周期", 400);
    const period = range(data?.startsAt, data?.endsAt ?? null);
    const [room, cycle] = await Promise.all([this.room(roomId), this.cycle(cycleId)]);
    await this.person(personId);
    let actorPerson = null;
    let sponsor = null;
    if (this.auth?.userId) {
      actorPerson = (await this.store.list("persons", this.orgId))
        .find((p) => p.userId === this.auth.userId && p.status === "active");
      if (!actorPerson) failCode("FORBIDDEN", "登录账号未绑定本组织人员档案", 403);
      sponsor = (await this.store.list("occupancies", this.orgId)).find((o) =>
        o.cycleId === cycleId && o.roomId === roomId && o.personId === actorPerson._id &&
        o.role === "primary" && o.state === "active");
      if (!sponsor) failCode("SPONSOR_INACTIVE", "当前主租客关系无效，不能邀请成员", 403);
    }
    const occupancyId = randomUUID();
    const slotId = primarySlotId(this.orgId, roomId);
    const refs = uniqueRefs([
      ...this.roomRefs(room), ref("persons", personId), ref("occupancy_cycles", cycleId),
      ref("occupancies", occupancyId), ref("room_primary_slots", slotId),
      ref("unique_claims", occupancyClaimId(this.orgId, roomId, cycleId, personId)),
      ref("lifecycle_guards", guardId(this.orgId)), ...this.authRefs(),
      ...(actorPerson ? [ref("persons", actorPerson._id)] : []),
      ...(sponsor ? [ref("occupancies", sponsor._id)] : []),
      ...(op ? [ref("operation_keys", op.id)] : []),
    ]);
    let result;
    await this.store.transact(refs, (state) => {
      const now = this.now();
      if (this.auth?.userId) {
        this.orgCheck(state);
        const currentActor = this.checkPerson(state, actorPerson._id);
        if (currentActor.userId !== this.auth.userId)
          failCode("FORBIDDEN", "登录账号的人员绑定已变化", 403);
      } else this.adminCheck(state);
      this.checkRoom(state, room);
      this.checkPerson(state, personId);
      const currentCycle = state[`occupancy_cycles/${cycleId}`];
      if (!this.own(currentCycle) || currentCycle.roomId !== roomId)
        failCode("NOT_FOUND", "入住周期不存在或不可见", 404);
      if (!["pending", "active"].includes(currentCycle.state) ||
          (currentCycle.endsAt !== null && now >= currentCycle.endsAt))
        failCode("INVALID_STATE", "入住周期已结束，不能新增成员", 409);
      if (period.startsAt < currentCycle.startsAt ||
          (period.endsAt !== null && currentCycle.endsAt !== null && period.endsAt > currentCycle.endsAt))
        failCode("PARAM_ERROR", "成员入住期限须位于周期有效期内");
      if (sponsor) {
        if (currentCycle.state !== "active" || !activeAt(currentCycle, now))
          failCode("SPONSOR_INACTIVE", "当前主租客周期无效，不能邀请成员", 403);
        const currentSponsor = state[`occupancies/${sponsor._id}`];
        const slot = state[`room_primary_slots/${slotId}`];
        if (!this.own(currentSponsor) || currentSponsor.state !== "active" ||
            currentSponsor.personId !== actorPerson._id || currentSponsor.role !== "primary" ||
            !activeAt(currentSponsor, now) || slot?.currentCycleId !== cycleId ||
            slot.currentOccupancyId !== sponsor._id)
          failCode("SPONSOR_INACTIVE", "当前主租客关系已失效，不能邀请成员", 403);
      }
      this.checkClaim(state, cycleId, roomId, personId, occupancyId, { create: true });
      const nextCycle = {
        ...currentCycle, epoch: currentCycle.epoch + 1, revision: currentCycle.revision + 1,
      };
      const occupancy = {
        _id: occupancyId, orgId: this.orgId, roomId, personId, cycleId,
        role: "member", state: "invited", ...period,
        addedBy: audit.actorId || audit.actor || "unknown",
        addedByType: this.auth?.userId ? "user" : (audit.actorType || "adminAccount"),
        sponsorOccupancyId: sponsor?._id ?? null, identityApplicationId: null, ...base(),
      };
      result = this.resultFor(occupancy, nextCycle);
      return [
        { collection: "occupancies", id: occupancyId, data: occupancy },
        {
          collection: "occupancy_cycles", id: cycleId,
          data: { epoch: nextCycle.epoch, revision: nextCycle.revision },
        },
        this.claimWrite(cycleId, roomId, personId, occupancyId),
        lifecycleWrite(state, this.orgId),
        ...opWrite(state, op, { status: 201, body: result }),
      ];
    }, audit);
    return result;
  }
  async activate(id, data, audit, op = null) {
    const expectedRevision = requiredRevision(data?.expectedRevision);
    const identityApplicationId = text(data?.identityApplicationId, "identityApplicationId");
    if (!this.blacklist || this.blacklist.orgId !== this.orgId)
      failCode("ADAPTER_UNAVAILABLE", "黑名单资格服务未配置", 503);
    const previous = await this.occupancy(id);
    const cycle = await this.cycle(previous.cycleId);
    const room = await this.room(previous.roomId);
    const slotId = primarySlotId(this.orgId, previous.roomId);
    const slot = (await this.store.list("room_primary_slots", this.orgId))
      .find((s) => s._id === slotId);
    const refs = uniqueRefs([
      ref("occupancies", id), ref("occupancy_cycles", cycle._id), ...this.roomRefs(room),
      ref("persons", previous.personId), ref("room_primary_slots", slotId),
      ref("unique_claims", occupancyClaimId(this.orgId, previous.roomId, previous.cycleId, previous.personId)),
      ref("lifecycle_guards", guardId(this.orgId)), ...this.authRefs(),
      ...(previous.sponsorOccupancyId ? [ref("occupancies", previous.sponsorOccupancyId)] : []),
      ...(previous.role === "member" ? [ref("occupancies", cycle.primaryOccupancyId)] : []),
      ...(slot?.currentCycleId && slot.currentCycleId !== cycle._id
        ? [ref("occupancy_cycles", slot.currentCycleId)] : []),
      ...(op ? [ref("operation_keys", op.id)] : []),
    ]);
    return this.blacklist.withEligibility({
      personId: previous.personId, occupancyId: id, identityApplicationId,
      restriction: "occupancy.activate",
    }, refs, (state) => {
      this.adminCheck(state);
      const current = state[`occupancies/${id}`];
      if (!this.own(current)) failCode("NOT_FOUND", "入住关系不存在或不可见", 404);
      if (current.revision !== expectedRevision)
        failCode("REVISION_CONFLICT", "入住关系版本不一致，请刷新后重试", 409);
      if (current.roomId !== previous.roomId || current.cycleId !== previous.cycleId ||
          current.personId !== previous.personId || current.role !== previous.role)
        failCode("REVISION_CONFLICT", "入住关系关键字段已变化，请刷新后重试", 409);
      if (!(current.role === "primary" ? current.state === "pending_review" : current.state === "invited"))
        failCode("INVALID_STATE", "当前入住关系不允许激活", 409);
      this.checkRoom(state, room);
      this.checkPerson(state, current.personId);
      this.checkClaim(state, current.cycleId, current.roomId, current.personId, id);
      const currentCycle = state[`occupancy_cycles/${current.cycleId}`];
      if (!this.own(currentCycle) || currentCycle.roomId !== current.roomId ||
          currentCycle.primaryOccupancyId !== cycle.primaryOccupancyId)
        failCode("REVISION_CONFLICT", "入住周期已变化，请刷新后重试", 409);
      const application = state[`identity_applications/${identityApplicationId}`];
      if (!this.own(application) || application.personId !== current.personId ||
          application.state !== "approved" || !application.identityDigest)
        failCode("IDENTITY_NOT_APPROVED", "人员实名尚未审核通过", 403);
      const now = this.now();
      if (!activeAt(current, now) || !activeAt(currentCycle, now))
        failCode("INVALID_STATE", "当前时间不在入住关系及周期有效期内", 409);
      const currentSlot = state[`room_primary_slots/${slotId}`];
      const writes = [];
      let nextCycle;
      if (current.role === "primary") {
        if (currentCycle.state !== "pending" || currentCycle.primaryOccupancyId !== id)
          failCode("INVALID_STATE", "主租客周期不在待激活状态", 409);
        if (currentSlot?.currentCycleId) {
          let occupied = true;
          if (currentSlot.currentCycleId === slot?.currentCycleId &&
              currentSlot.currentCycleId !== current.cycleId) {
            const oldCycle = state[`occupancy_cycles/${currentSlot.currentCycleId}`];
            const oldEnd = minEnd(oldCycle?.endsAt, oldCycle?.endedAt, currentSlot.endsAt);
            occupied = oldCycle?.state === "active" && oldCycle.startsAt <= now &&
              (oldEnd === null || now < oldEnd);
          }
          if (occupied) failCode("PRIMARY_OCCUPIED", "该房间当前已有有效主租客", 409);
        }
        nextCycle = {
          ...currentCycle, state: "active", epoch: currentCycle.epoch + 1,
          revision: currentCycle.revision + 1,
        };
        writes.push({
          collection: "occupancy_cycles", id: currentCycle._id,
          data: { state: "active", epoch: nextCycle.epoch, revision: nextCycle.revision },
        });
        writes.push({
          collection: "room_primary_slots", id: slotId,
          data: {
            orgId: this.orgId, roomId: current.roomId, currentCycleId: current.cycleId,
            currentOccupancyId: id, currentPersonId: current.personId,
            endsAt: minEnd(current.endsAt, currentCycle.endsAt),
            ...bump(currentSlot), ...(currentSlot ? {} : { orgId: this.orgId, roomId: current.roomId }),
          },
        });
      } else {
        if (currentCycle.state !== "active" || !activeAt(currentCycle, now))
          failCode("INVALID_STATE", "成员所属入住周期尚未生效或已结束", 409);
        const primary = state[`occupancies/${currentCycle.primaryOccupancyId}`];
        if (!this.own(primary) || primary.state !== "active" || primary.role !== "primary" ||
            !activeAt(primary, now) || currentSlot?.currentCycleId !== current.cycleId ||
            currentSlot.currentOccupancyId !== primary._id ||
            currentSlot.currentPersonId !== primary.personId)
          failCode("SPONSOR_INACTIVE", "主租客关系已失效，成员不能激活", 409);
        if (current.sponsorOccupancyId) {
          const sponsor = state[`occupancies/${current.sponsorOccupancyId}`];
          if (!this.own(sponsor) || sponsor.state !== "active" ||
              sponsor._id !== currentCycle.primaryOccupancyId)
            failCode("SPONSOR_INACTIVE", "邀请人的主租客关系已失效", 409);
        }
        nextCycle = {
          ...currentCycle, epoch: currentCycle.epoch + 1, revision: currentCycle.revision + 1,
        };
        writes.push({
          collection: "occupancy_cycles", id: currentCycle._id,
          data: { epoch: nextCycle.epoch, revision: nextCycle.revision },
        });
      }
      const next = {
        ...current, state: "active", activatedAt: now, identityApplicationId,
        revision: current.revision + 1,
      };
      writes.push({
        collection: "occupancies", id,
        data: {
          state: "active", activatedAt: now, identityApplicationId, revision: next.revision,
        },
      }, lifecycleWrite(state, this.orgId));
      const result = this.resultFor(next, nextCycle);
      writes.push(...opWrite(state, op, { status: 200, body: result }));
      return { writes, result };
    }, audit);
  }
  endTime(value, occupancy, cycle) {
    if (!Number.isInteger(value) || value > this.now() ||
        value < occupancy.startsAt || value < cycle.startsAt)
      failCode("PARAM_ERROR", "结束时间须不晚于当前时间，且不早于入住开始时间");
    return value;
  }
  async end(id, data, audit, op = null) {
    const expectedRevision = requiredRevision(data?.expectedRevision);
    const reason = text(data?.reason, "结束原因", 200);
    const previous = await this.occupancy(id);
    const cycle = await this.cycle(previous.cycleId);
    // Backdated whole-cycle end must not predate any already-active member.
    // The cycle epoch check below reruns this decision against the exact same
    // membership snapshot without reading every member into the transaction.
    const activeStarts = previous.role === "primary"
      ? (await this.store.list("occupancies", this.orgId))
        .filter((o) => o.cycleId === cycle._id && o.state === "active")
        .map((o) => o.startsAt)
      : [];
    const earliestEnd = Math.max(previous.startsAt, cycle.startsAt, ...activeStarts);
    const slotId = primarySlotId(this.orgId, previous.roomId);
    const jobId = previous.role === "primary" ? randomUUID() : null;
    const refs = uniqueRefs([
      ref("occupancies", id), ref("occupancy_cycles", cycle._id),
      ref("room_primary_slots", slotId), ref("lifecycle_guards", guardId(this.orgId)),
      ...this.authRefs(),
      ...(jobId ? [ref("occupancy_materializations", jobId)] : []),
      ...(op ? [ref("operation_keys", op.id)] : []),
    ]);
    let result;
    await this.store.transact(refs, (state) => {
      this.adminCheck(state);
      const current = state[`occupancies/${id}`];
      if (!this.own(current)) failCode("NOT_FOUND", "入住关系不存在或不可见", 404);
      if (current.revision !== expectedRevision)
        failCode("REVISION_CONFLICT", "入住关系版本不一致，请刷新后重试", 409);
      if (current.state !== "active") failCode("INVALID_STATE", "仅有效关系可执行结束", 409);
      const currentCycle = state[`occupancy_cycles/${current.cycleId}`];
      if (!this.own(currentCycle) || currentCycle.state !== "active")
        failCode("INVALID_STATE", "入住周期已结束", 409);
      const endedAt = this.endTime(data?.endsAt, current, currentCycle);
      const primary = current.role === "primary";
      if (primary && currentCycle.epoch !== cycle.epoch)
        failCode("REVISION_CONFLICT", "入住周期成员已变化，请重新核对退租时间", 409);
      if (primary && endedAt < earliestEnd)
        failCode("PARAM_ERROR", "整户退租时间不能早于任一已激活成员的入住开始时间");
      if (primary && currentCycle.primaryOccupancyId !== id)
        failCode("INVALID_STATE", "主租客关系与周期不一致", 409);
      const slot = state[`room_primary_slots/${slotId}`];
      if (primary && (slot?.currentCycleId !== current.cycleId || slot.currentOccupancyId !== id))
        failCode("REVISION_CONFLICT", "主租客槽已变化，请刷新后重试", 409);
      const nextCycle = {
        ...currentCycle,
        ...(primary ? { state: "ended", endedAt, endedBy: audit.actorId || audit.actor || "unknown", endReason: reason } : {}),
        epoch: currentCycle.epoch + 1, revision: currentCycle.revision + 1,
      };
      const next = {
        ...current, state: "ended", endsAt: endedAt, terminationReason: reason,
        endedBy: audit.actorId || audit.actor || "unknown", revision: current.revision + 1,
      };
      const writes = [
        { collection: "occupancies", id, data: {
          state: "ended", endsAt: endedAt, terminationReason: reason,
          endedBy: next.endedBy, revision: next.revision,
        } },
        { collection: "occupancy_cycles", id: currentCycle._id, data: {
          ...(primary ? { state: "ended", endedAt, endedBy: next.endedBy, endReason: reason } : {}),
          epoch: nextCycle.epoch, revision: nextCycle.revision,
        } },
        lifecycleWrite(state, this.orgId),
      ];
      if (primary) {
        writes.push({
          collection: "room_primary_slots", id: slotId,
          data: {
            currentCycleId: null, currentOccupancyId: null, currentPersonId: null,
            endsAt: endedAt, ...bump(slot),
          },
        }, {
          collection: "occupancy_materializations", id: jobId,
          data: {
            orgId: this.orgId, cycleId: current.cycleId, state: "pending",
            nextCursor: null, attempts: 0, ...base(),
          },
        });
      }
      result = this.resultFor(next, nextCycle, {
        effectiveState: "ended", effectiveEndsAt: endedAt,
        ...(jobId ? { materializationJobId: jobId } : {}),
      });
      writes.push(...opWrite(state, op, { status: 200, body: result }));
      return writes;
    }, audit);
    return result;
  }
  async transferPrimary(roomId, data, audit, op = null) {
    const oldOccupancyId = text(data?.occupancyId, "occupancyId");
    const oldCycleId = text(data?.cycleId, "cycleId");
    const expectedRevision = requiredRevision(data?.expectedRevision);
    const expectedCycleRevision = requiredRevision(data?.expectedCycleRevision, "expectedCycleRevision");
    const newPersonId = text(data?.newPrimaryPersonId, "newPrimaryPersonId");
    const newPersonRevision = requiredRevision(data?.newPersonExpectedRevision, "newPersonExpectedRevision");
    const reason = text(data?.reason, "换租原因", 200);
    const period = range(data?.startsAt, data?.endsAt ?? null);
    const [oldOccupancy, oldCycle, room] = await Promise.all([
      this.occupancy(oldOccupancyId), this.cycle(oldCycleId), this.room(roomId),
    ]);
    await this.person(newPersonId);
    const activeStarts = (await this.store.list("occupancies", this.orgId))
      .filter((o) => o.cycleId === oldCycleId && o.state === "active")
      .map((o) => o.startsAt);
    const earliestOldEnd = Math.max(oldOccupancy.startsAt, oldCycle.startsAt, ...activeStarts);
    const newCycleId = randomUUID();
    const newOccupancyId = randomUUID();
    const jobId = randomUUID();
    const slotId = primarySlotId(this.orgId, roomId);
    const refs = uniqueRefs([
      ...this.roomRefs(room), ref("occupancies", oldOccupancyId),
      ref("occupancy_cycles", oldCycleId), ref("persons", newPersonId),
      ref("occupancies", newOccupancyId), ref("occupancy_cycles", newCycleId),
      ref("room_primary_slots", slotId), ref("occupancy_materializations", jobId),
      ref("unique_claims", occupancyClaimId(this.orgId, roomId, newCycleId, newPersonId)),
      ref("lifecycle_guards", guardId(this.orgId)), ...this.authRefs(),
      ...(op ? [ref("operation_keys", op.id)] : []),
    ]);
    let result;
    await this.store.transact(refs, (state) => {
      this.adminCheck(state);
      this.checkRoom(state, room);
      this.checkPerson(state, newPersonId, newPersonRevision);
      this.checkClaim(state, newCycleId, roomId, newPersonId, newOccupancyId, { create: true });
      const current = state[`occupancies/${oldOccupancyId}`];
      const currentCycle = state[`occupancy_cycles/${oldCycleId}`];
      if (!this.own(current) || !this.own(currentCycle) || current.roomId !== roomId ||
          current.cycleId !== oldCycleId || currentCycle.roomId !== roomId ||
          current.role !== "primary" || currentCycle.primaryOccupancyId !== oldOccupancyId)
        failCode("NOT_FOUND", "旧主租客周期或关系不存在或不可见", 404);
      if (current.revision !== expectedRevision || currentCycle.revision !== expectedCycleRevision)
        failCode("REVISION_CONFLICT", "旧周期或关系版本不一致，请刷新后重试", 409);
      if (current.state !== "active" || currentCycle.state !== "active")
        failCode("INVALID_STATE", "旧主租客周期已结束", 409);
      const oldEndsAt = this.endTime(data?.oldEndsAt, current, currentCycle);
      if (oldEndsAt < earliestOldEnd)
        failCode("PARAM_ERROR", "换租结束时间不能早于任一已激活成员的入住开始时间");
      const slot = state[`room_primary_slots/${slotId}`];
      if (slot?.currentCycleId !== oldCycleId || slot.currentOccupancyId !== oldOccupancyId)
        failCode("REVISION_CONFLICT", "主租客槽已变化，请刷新后重试", 409);
      const actor = audit.actorId || audit.actor || "unknown";
      const endedCycle = {
        ...currentCycle, state: "ended", endedAt: oldEndsAt, endedBy: actor,
        endReason: reason, epoch: currentCycle.epoch + 1, revision: currentCycle.revision + 1,
      };
      const newCycle = {
        _id: newCycleId, orgId: this.orgId, roomId, primaryOccupancyId: newOccupancyId,
        epoch: 0, state: "pending", ...period, ...base(),
      };
      const newOccupancy = {
        _id: newOccupancyId, orgId: this.orgId, roomId, personId: newPersonId,
        cycleId: newCycleId, role: "primary", state: "pending_review", ...period,
        addedBy: actor, addedByType: audit.actorType || "adminAccount",
        sponsorOccupancyId: null, identityApplicationId: null, ...base(),
      };
      const writes = [
        { collection: "occupancies", id: oldOccupancyId, data: {
          state: "ended", endsAt: oldEndsAt, terminationReason: reason,
          endedBy: actor, revision: current.revision + 1,
        } },
        { collection: "occupancy_cycles", id: oldCycleId, data: {
          state: "ended", endedAt: oldEndsAt, endedBy: actor, endReason: reason,
          epoch: endedCycle.epoch, revision: endedCycle.revision,
        } },
        { collection: "room_primary_slots", id: slotId, data: {
          currentCycleId: null, currentOccupancyId: null, currentPersonId: null,
          endsAt: oldEndsAt, ...bump(slot),
        } },
        { collection: "occupancy_materializations", id: jobId, data: {
          orgId: this.orgId, cycleId: oldCycleId, state: "pending",
          nextCursor: null, attempts: 0, ...base(),
        } },
        { collection: "occupancy_cycles", id: newCycleId, data: newCycle },
        { collection: "occupancies", id: newOccupancyId, data: newOccupancy },
        this.claimWrite(newCycleId, roomId, newPersonId, newOccupancyId),
        lifecycleWrite(state, this.orgId),
      ];
      result = this.resultFor(newOccupancy, newCycle, {
        oldCycleId, oldOccupancyId, materializationJobId: jobId,
      });
      writes.push(...opWrite(state, op, { status: 201, body: result }));
      return writes;
    }, audit);
    return result;
  }
  effective(occupancy, cycle, slot, room, now = this.now()) {
    const effectiveEndsAt = minEnd(occupancy.endsAt, cycle?.endsAt, cycle?.endedAt);
    let effectiveState = occupancy.state;
    if (occupancy.state === "active") {
      const slotMatches = slot?.currentCycleId === occupancy.cycleId &&
        (occupancy.role !== "primary" || slot.currentOccupancyId === occupancy._id);
      if (!cycle || cycle.state === "ended" || !slotMatches ||
          (effectiveEndsAt !== null && now >= effectiveEndsAt) || (room && room.status === "archived"))
        effectiveState = "ended";
      else if (cycle.state !== "active") effectiveState = "pending_review";
      else if (now < occupancy.startsAt || now < cycle.startsAt) effectiveState = "scheduled";
    } else if (["invited", "pending_review"].includes(occupancy.state) &&
               (cycle?.state === "ended" || (effectiveEndsAt !== null && now >= effectiveEndsAt))) {
      effectiveState = "ended";
    }
    return { effectiveState, effectiveEndsAt };
  }
  async listOccupancies(roomId, query = {}) {
    await this.readCheck({ resident: true });
    const { cursor, limit } = pageParams(query);
    const [occupancies, cycles, slots, rooms, persons] = await Promise.all([
      this.store.list("occupancies", this.orgId), this.store.list("occupancy_cycles", this.orgId),
      this.store.list("room_primary_slots", this.orgId), this.store.list("rooms", this.orgId),
      this.store.list("persons", this.orgId),
    ]);
    const room = rooms.find((r) => r._id === roomId);
    if (!room) failCode("NOT_FOUND", "房间不存在或不可见", 404);
    const cycleMap = new Map(cycles.map((c) => [c._id, c]));
    const slot = slots.find((s) => s._id === primarySlotId(this.orgId, roomId));
    const personMap = new Map(persons.map((p) => [p._id, p]));
    let rows = occupancies.filter((o) => o.roomId === roomId);
    let resident = false;
    if (this.auth?.userId) {
      resident = true;
      const actorPerson = persons.find((p) => p.userId === this.auth.userId && p.status === "active");
      const own = rows.filter((o) => o.personId === actorPerson?._id);
      const currentPrimary = own.find((o) => o.role === "primary" &&
        this.effective(o, cycleMap.get(o.cycleId), slot, room).effectiveState === "active");
      if (currentPrimary) {
        rows = rows.filter((o) => o.cycleId === currentPrimary.cycleId &&
          this.effective(o, cycleMap.get(o.cycleId), slot, room).effectiveState === "active");
      } else {
        // A former/current ordinary resident may read only their own history.
        // A former primary loses the room-wide member view as soon as the
        // primary relation is no longer effective.
        if (!own.length) failCode("FORBIDDEN", "没有该房间的居住关系", 403);
        rows = own;
      }
    }
    const result = page(rows, { cursor, limit });
    return {
      ...result,
      data: result.data.map((o) => {
        const cycle = cycleMap.get(o.cycleId);
        const state = this.effective(o, cycle, slot, room);
        return {
          occupancyId: o._id, cycleId: o.cycleId, roomId: o.roomId, personId: o.personId,
          nameMasked: personMap.get(o.personId)?.nameMasked ?? null,
          role: o.role, storedState: o.state, ...state,
          startsAt: o.startsAt, endsAt: o.endsAt, revision: o.revision,
          cycleRevision: cycle?.revision ?? null, cycleState: cycle?.state ?? null,
          ...(!resident ? { identityApplicationId: o.identityApplicationId ?? null } : {}),
        };
      }),
    };
  }
  async materialize(jobId, { limit = 25 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25)
      failCode("PARAM_ERROR", "补写批次须为 1–25");
    for (let attempt = 0; attempt < 3; attempt++) {
      const job = (await this.store.list("occupancy_materializations", this.orgId))
        .find((j) => j._id === jobId);
      if (!job) failCode("NOT_FOUND", "补写任务不存在或不可见", 404);
      if (job.state === "done") return { materializationJobId: jobId, state: "done", processed: 0 };
      const cycle = await this.cycle(job.cycleId);
      const candidates = (await this.store.list("occupancies", this.orgId))
        .filter((o) => o.cycleId === cycle._id && o.state === "active")
        .sort((a, b) => a._id.localeCompare(b._id));
      const batch = candidates.slice(0, limit);
      const refs = uniqueRefs([
        ref("occupancy_materializations", jobId), ref("occupancy_cycles", cycle._id),
        ...batch.map((o) => ref("occupancies", o._id)), ...this.authRefs(),
      ]);
      let result;
      try {
        await this.store.transact(refs, (state) => {
          this.adminCheck(state);
          const currentJob = state[`occupancy_materializations/${jobId}`];
          const currentCycle = state[`occupancy_cycles/${cycle._id}`];
          if (!this.own(currentJob) || !this.own(currentCycle) || currentCycle.state !== "ended")
            failCode("INVALID_STATE", "补写任务与已结束周期不一致", 409);
          if (currentJob.revision !== job.revision)
            failCode("MATERIALIZATION_RETRY", "补写任务已被其他执行器更新", 409);
          if (currentJob.state === "done") {
            result = { materializationJobId: jobId, state: "done", processed: 0 };
            return [];
          }
          const writes = [];
          for (const previous of batch) {
            const current = state[`occupancies/${previous._id}`];
            if (!this.own(current) || current.cycleId !== cycle._id || current.state !== "active") continue;
            const endedAt = minEnd(current.endsAt, currentCycle.endedAt, currentCycle.endsAt);
            writes.push({
              collection: "occupancies", id: current._id,
              data: {
                state: "ended", endsAt: endedAt,
                terminationReason: currentCycle.endReason || "主租客周期结束",
                materializedAt: this.now(), revision: current.revision + 1,
              },
            });
          }
          const done = candidates.length <= batch.length;
          result = { materializationJobId: jobId, state: done ? "done" : "pending", processed: writes.length };
          writes.push({
            collection: "occupancy_materializations", id: jobId,
            data: {
              state: result.state, nextCursor: batch.at(-1)?._id ?? currentJob.nextCursor,
              attempts: (currentJob.attempts ?? 0) + 1,
              ...(done ? { completedAt: this.now() } : {}),
              revision: currentJob.revision + 1,
            },
          });
          return writes;
        }, { actor: "system", actorId: "occupancy-materializer", action: "补写入住周期成员历史", orgId: this.orgId });
        return result;
      } catch (error) {
        if (error.code !== "MATERIALIZATION_RETRY" || attempt === 2) throw error;
      }
    }
    throw new Error("unreachable");
  }
  async getMaterialization(jobId) {
    await this.readCheck();
    const job = (await this.store.list("occupancy_materializations", this.orgId))
      .find((j) => j._id === jobId);
    if (!job) failCode("NOT_FOUND", "补写任务不存在或不可见", 404);
    return {
      materializationJobId: job._id, cycleId: job.cycleId, state: job.state,
      nextCursor: job.nextCursor ?? null, attempts: job.attempts,
      completedAt: job.completedAt ?? null, revision: job.revision,
    };
  }
}
