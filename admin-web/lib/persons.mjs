import { randomUUID } from "node:crypto";
import { failCode } from "./model.mjs";
import { claimId } from "./claims.mjs";
import { maskName } from "./identity.mjs";
import { opWrite, page } from "./property-v2.mjs";
// DB-03: persons (org-scoped resident profiles) are separate from login
// accounts (Q02, DATA-MODEL §2 persons, API-CONTRACT §5).
//
// - A person needs NO account and NO phone number; createPerson accepts no
//   phone/credential fields at all, so an agent's phone can never be used to
//   fabricate an account for a no-account resident.
// - Account claiming binds the CALLER's own verified account only. Binding
//   someone else's userId is impossible by construction: the target userId is
//   never an input. One user holds at most one 本人 profile per org
//   (unique_claims namespace person-account).
// - Real-name-grade "this profile IS me" proof requires an approved identity
//   application (DB-04). Until then claimAccount is service-layer only, is
//   NOT exposed over HTTP, and must stay disabled in live deployments.
const ref = (collection, id) => ({ collection, id });
const base = () => ({ schemaVersion: 2, revision: 1, createdAt: Date.now() });
const text = (v, label, max = 80) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    failCode("PARAM_ERROR", `${label}需为 1–${max} 字`);
  return v.trim();
};
export class PersonService {
  constructor(store, orgId, auth = null) {
    this.store = store;
    this.orgId = orgId;
    this.auth = auth;
  }
  authRefs() {
    return [
      ref("organizations", this.orgId),
      ...(this.auth ? [ref("org_memberships", this.auth.membershipId)] : []),
    ];
  }
  orgCheck(state) {
    const org = state[`organizations/${this.orgId}`];
    if (!org || org.status !== "active")
      failCode("FORBIDDEN", "组织当前不可用", 403);
  }
  authCheck(state) {
    this.orgCheck(state);
    if (!this.auth) return;
    const m = state[`org_memberships/${this.auth.membershipId}`];
    if (!m || m.orgId !== this.orgId || m.status !== "active" || m.role !== "admin")
      failCode("FORBIDDEN", "组织成员关系已失效或权限不足", 403);
  }
  // Org-admin created profile. Only a masked display name is stored; full
  // names / documents belong to the restricted identity flow (DB-04).
  async createPerson({ name }, audit, op = null) {
    const trimmed = text(name, "姓名");
    const id = randomUUID();
    const result = { status: 201, body: { personId: id, orgId: this.orgId, nameMasked: maskName(trimmed) } };
    await this.store.transact(
      [ref("persons", id), ...this.authRefs(), ...(op ? [ref("operation_keys", op.id)] : [])],
      (state) => {
        this.authCheck(state);
        return [
          {
            collection: "persons",
            id,
            data: {
              orgId: this.orgId,
              userId: null,
              nameMasked: maskName(trimmed),
              status: "active",
              createdBy: audit.actorId || audit.actor || "unknown",
              createdByType: audit.actorType || "adminAccount",
              ...base(),
            },
          },
          ...opWrite(state, op, result),
        ];
      },
      audit,
    );
    return result.body;
  }
  async listPersons({ cursor, limit }) {
    const rows = await this.store.list("persons", this.orgId);
    return page(rows, { cursor, limit });
  }
  // Bind the caller's own login account to a no-account person profile.
  // Requires an already verified login identity (bound phone or WeChat) and
  // performs all conflict checks inside one transaction.
  async claimAccount(personId, { callerUserId }, audit) {
    if (typeof callerUserId !== "string" || !callerUserId)
      failCode("PARAM_ERROR", "缺少登录账号上下文");
    const claim = claimId("person-account", this.orgId, callerUserId);
    const person = (await this.store.list("persons", this.orgId)).find(
      (p) => p._id === personId,
    );
    if (!person) failCode("NOT_FOUND", "人员档案不存在或不可见", 404);
    const user = (await this.store.list("users")).find(
      (u) => u._id === callerUserId,
    );
    const identityIds = [user?.phoneIdentityId, user?.wechatIdentityId].filter(Boolean);
    await this.store.transact(
      [
        ref("persons", personId),
        ref("users", callerUserId),
        ref("unique_claims", claim),
        ref("organizations", this.orgId),
        ...identityIds.map((id) => ref("auth_identities", id)),
      ],
      (state) => {
        this.orgCheck(state); // org must be active; no admin role required
        const currentPerson = state[`persons/${personId}`];
        if (!currentPerson || currentPerson.orgId !== this.orgId)
          failCode("NOT_FOUND", "人员档案不存在或不可见", 404);
        if (currentPerson.status !== "active")
          failCode("INVALID_STATE", "人员档案已归档", 409);
        if (currentPerson.userId)
          failCode(
            "IDENTITY_CONFLICT",
            "该人员档案已绑定账号，不能重复认领或换绑",
            409,
          );
        const currentUser = state[`users/${callerUserId}`];
        if (!currentUser) failCode("NOT_FOUND", "账号不存在", 404);
        if (currentUser.status && currentUser.status !== "active")
          failCode("USER_DISABLED", "账号已停用，请联系管理员", 403);
        const verified = identityIds.some((id) => {
          const identity = state[`auth_identities/${id}`];
          return identity && identity.status === "bound" && identity.userId === callerUserId;
        });
        if (!verified)
          failCode(
            "IDENTITY_NOT_VERIFIED",
            "认领人员档案须先完成本人手机号或微信验证",
            403,
          );
        const existingClaim = state[`unique_claims/${claim}`];
        if (existingClaim && existingClaim.state === "bound")
          failCode(
            "IDENTITY_CONFLICT",
            "该账号在本组织已绑定其他人员档案",
            409,
          );
        return [
          {
            collection: "persons",
            id: personId,
            data: {
              userId: callerUserId,
              claimedAt: Date.now(),
              revision: (currentPerson.revision ?? 0) + 1,
            },
          },
          {
            collection: "unique_claims",
            id: claim,
            data: {
              orgId: this.orgId,
              namespace: "person-account",
              ownerId: personId,
              state: "bound",
              ...base(),
            },
          },
        ];
      },
      { ...audit, actorType: "user" },
    );
    return { personId, userId: callerUserId, orgId: this.orgId };
  }
}
