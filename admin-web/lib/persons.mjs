import { randomUUID } from "node:crypto";
import { failCode } from "./model.mjs";
import { maskName } from "./identity.mjs";
import { opWrite, page, pageParams } from "./property-v2.mjs";
// DB-03: persons (org-scoped resident profiles) are separate from login
// accounts (Q02, DATA-MODEL §2 persons, API-CONTRACT §5).
//
// - A person needs NO account and NO phone number; createPerson accepts no
//   phone/credential fields at all, so an agent's phone can never be used to
//   fabricate an account for a no-account resident.
// - claimAccount is CLOSED this round (review F02): a verified login identity
//   proves who the caller is, but NOT that the target profile is that person.
//   Until an approved DB-04 identity application can bind applicant +
//   personId + orgId + documentVersion inside the transaction, the method
//   fails with POLICY_UNDECIDED and writes nothing.
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
  async listPersons(query = {}) {
    // F01: one parameter contract for every v2 list — default limit 20,
    // integer 1–100 validation, cursor checks — after org-scoped query
    // pushdown, never a raw query.limit passed through to slice().
    const { cursor, limit } = pageParams(query);
    const rows = await this.store.list("persons", this.orgId);
    return page(rows, { cursor, limit });
  }
  // CLOSED (review F02). A phone/WeChat-verified account alone is not proof
  // of profile ownership; accepting it would let any verified user claim any
  // unbound profile. The future implementation must verify an approved
  // identity application (applicant + personId + orgId + documentVersion)
  // inside the claim transaction. Until then: always reject, zero writes.
  async claimAccount() {
    failCode(
      "POLICY_UNDECIDED",
      "人员账号认领须先接入实名审核（DB-04），当前未开放",
      503,
    );
  }
}
