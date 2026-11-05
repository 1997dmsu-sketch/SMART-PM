import { createHash } from "node:crypto";
import { failCode } from "./model.mjs";
import { guardId } from "./claims.mjs";
const hash = (...parts) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
const ref = (collection, id) => ({ collection, id });
export const membershipId = (orgId, principalType, principalId) =>
  `mem-${hash(orgId, principalType, principalId)}`;
const base = () => ({ schemaVersion: 2, revision: 1, createdAt: Date.now() });
// Organization scope service (docs/database/DATA-MODEL.md §1, API-CONTRACT.md §2).
// Organizations are created only by explicit bootstrap with a fixed ID — never
// from request input. Memberships are explicit mappings; login or admin-account
// roles alone never grant organization access.
export class OrgService {
  constructor(store) {
    this.store = store;
  }
  async organization(orgId) {
    return (await this.store.list("organizations")).find(
      (o) => o._id === orgId,
    );
  }
  async bootstrap({ id, name, adminAccountIds = [] }, audit) {
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{2,60}$/.test(id))
      failCode("PARAM_ERROR", "组织编号需为 3–61 位小写字母、数字或连字符");
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80)
      failCode("PARAM_ERROR", "组织名称需为 1–80 字");
    for (const accountId of adminAccountIds)
      if (typeof accountId !== "string" || !accountId)
        failCode("PARAM_ERROR", "管理员账号编号无效");
    const refs = [
      ref("organizations", id),
      ref("lifecycle_guards", guardId(id)),
      ...adminAccountIds.map((a) =>
        ref("org_memberships", membershipId(id, "adminAccount", a)),
      ),
    ];
    await this.store.transact(
      refs,
      (state) => {
        const writes = [];
        if (!state[`organizations/${id}`])
          writes.push({
            collection: "organizations",
            id,
            data: {
              name: name.trim(),
              status: "active",
              policyVersion: 1,
              ...base(),
            },
          });
        if (!state[`lifecycle_guards/${guardId(id)}`])
          writes.push({
            collection: "lifecycle_guards",
            id: guardId(id),
            data: { orgId: id, epoch: 0, ...base() },
          });
        for (const accountId of adminAccountIds) {
          const mid = membershipId(id, "adminAccount", accountId);
          if (!state[`org_memberships/${mid}`])
            writes.push({
              collection: "org_memberships",
              id: mid,
              data: {
                orgId: id,
                principalType: "adminAccount",
                principalId: accountId,
                role: "admin",
                status: "active",
                permissions: [],
                ...base(),
              },
            });
        }
        return writes;
      },
      audit,
    );
    return { orgId: id };
  }
  async grantMembership({ orgId, principalType, principalId, role, permissions = [] }, audit) {
    if (!["adminAccount", "user"].includes(principalType))
      failCode("PARAM_ERROR", "成员类型无效");
    if (!["admin", "editor", "viewer", "resident"].includes(role))
      failCode("PARAM_ERROR", "组织角色无效");
    // Explicit permission points (DATA-MODEL §5): sensitive capabilities such
    // as identity review or private-document reads are never implied by role.
    const GRANTABLE = [
      "identity.review",
      "identity.readPrivate",
      "blacklist.manage",
      "blacklist.read",
      "blacklist.review",
      // HK-AI-03：人脸生物特征文件三权分立——提交、审核、私密读取互不隐含。
      // 角色（admin）不再单方面蕴含任一权限；必须显式授予。
      "device.face.submit",
      "device.face.review",
      "device.face.readPrivate",
    ];
    if (
      !Array.isArray(permissions) ||
      permissions.some((p) => !GRANTABLE.includes(p))
    )
      failCode("PARAM_ERROR", "权限点无效");
    if (typeof principalId !== "string" || !principalId)
      failCode("PARAM_ERROR", "成员编号无效");
    const org = await this.organization(orgId);
    if (!org) failCode("ORG_NOT_FOUND", "组织不存在或不可见", 404);
    const id = membershipId(orgId, principalType, principalId);
    await this.store.transact(
      [ref("org_memberships", id)],
      (state) => {
        const existing = state[`org_memberships/${id}`];
        if (existing)
          failCode("DUPLICATE", "该成员已存在组织映射，请显式修改", 409);
        return [
          {
            collection: "org_memberships",
            id,
            data: {
              orgId,
              principalType,
              principalId,
              role,
              status: "active",
              permissions: [...permissions],
              ...base(),
            },
          },
        ];
      },
      audit,
    );
    return { membershipId: id, orgId, principalType, principalId, role };
  }
  async organizationsFor(principalType, principalId) {
    const [memberships, orgs] = await Promise.all([
      this.store.list("org_memberships"),
      this.store.list("organizations"),
    ]);
    const byId = new Map(orgs.map((o) => [o._id, o]));
    return memberships
      .filter(
        (m) =>
          m.principalType === principalType &&
          m.principalId === principalId &&
          m.status === "active" &&
          byId.get(m.orgId)?.status === "active",
      )
      .map((m) => ({ orgId: m.orgId, name: byId.get(m.orgId).name, role: m.role }))
      .sort((a, b) => a.orgId.localeCompare(b.orgId));
  }
  // Resolves the organization context server-side. A missing organization and a
  // missing membership return the same 404 so other organizations' existence
  // is not leaked; an insufficient role on a visible organization returns 403.
  async requireMembership(principalType, principalId, orgId, { write = false } = {}) {
    if (typeof orgId !== "string" || !orgId)
      failCode("PARAM_ERROR", "缺少组织上下文");
    const memberships = await this.store.list("org_memberships");
    const membership = memberships.find(
      (m) =>
        m._id === membershipId(orgId, principalType, principalId) &&
        m.status === "active",
    );
    if (!membership) failCode("NOT_FOUND", "组织不存在或不可见", 404);
    const org = await this.organization(orgId);
    if (!org) failCode("NOT_FOUND", "组织不存在或不可见", 404);
    if (org.status !== "active")
      failCode("FORBIDDEN", "组织当前不可用", 403);
    if (write && membership.role !== "admin")
      failCode("FORBIDDEN", "当前组织角色没有此操作权限", 403);
    return { org, membership };
  }
}
