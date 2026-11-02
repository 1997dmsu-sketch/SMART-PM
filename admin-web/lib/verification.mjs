import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { failCode } from "./model.mjs";
import { claimId } from "./claims.mjs";
import { opWrite, page, pageParams } from "./property-v2.mjs";
// DB-04: manual real-name verification (docs/database/API-CONTRACT.md §4,
// DATA-MODEL §2 identity_applications / identity_reviews / identity_private,
// §3.2 审核事务, §5 权限边界, §6 provider).
//
// - manual is the only enabled method; the provider action is a closed stub
//   (PROVIDER_DISABLED, no network, no fabricated success).
// - The applicant (submittedBy) is NOT the verified subject (personId):
//   agents submit on behalf of a person, but nobody may review their own
//   application, and approved is not a residence permit (DB-05 activates).
// - Full names / document numbers live ONLY in identity_private as
//   AES-256-GCM ciphertext; the encryption key is injected, never stored in
//   the database or code. Ordinary reads never return it; the sensitive read
//   requires the identity.readPrivate permission point and writes an audit
//   record every time.
// - documentVersion is immutable once submitted: supplements create a new
//   version, reviews always reference the exact version they decided on,
//   and a concurrent supplement makes a pending review fail STALE_DOCUMENT.
// - Approving binds a per-org verified-person unique claim
//   (org + documentType + identity HMAC digest) so the same verified identity
//   cannot be approved for a second person in the same org (§3.1).
const ref = (collection, id) => ({ collection, id });
const base = () => ({ schemaVersion: 2, revision: 1, createdAt: Date.now() });
const text = (v, label, max = 80) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    failCode("PARAM_ERROR", `${label}需为 1–${max} 字`);
  return v.trim();
};
const DOCUMENT_TYPES = ["id-card", "passport", "other"]; // Q03: scope configurable
const DECISIONS = { approve: "approved", needs_info: "needs_info", reject: "rejected" };
function encrypt(key, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}
function decrypt(key, payload) {
  const [iv, tag, data] = payload.split(":").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
export class VerificationService {
  constructor(store, orgId, auth = null, { identity, encryptionKey = null, encryptionKeyVersion = 1, fileValidator = null } = {}) {
    this.store = store;
    this.orgId = orgId;
    this.auth = auth;
    this.identity = identity;
    this.encryptionKey = encryptionKey;
    this.encryptionKeyVersion = encryptionKeyVersion;
    this.fileValidator = fileValidator;
  }
  authRefs() {
    return [
      ref("organizations", this.orgId),
      ...(this.auth ? [ref("org_memberships", this.auth.membershipId)] : []),
    ];
  }
  adminCheck(state, permission = null) {
    const org = state[`organizations/${this.orgId}`];
    if (!org || org.status !== "active")
      failCode("FORBIDDEN", "组织当前不可用", 403);
    if (!this.auth) return; // trusted internal caller (tests / future jobs)
    const m = state[`org_memberships/${this.auth.membershipId}`];
    if (!m || m.orgId !== this.orgId || m.status !== "active" || m.role !== "admin")
      failCode("FORBIDDEN", "组织成员关系已失效或权限不足", 403);
    if (permission && !(m.permissions || []).includes(permission))
      failCode("FORBIDDEN", "缺少该敏感操作的显式权限点", 403);
  }
  // Read-side permission checks (list/get are outside transactions).
  async readCheck(permission = null) {
    if (!this.auth) return;
    const org = (await this.store.list("organizations")).find(
      (o) => o._id === this.orgId,
    );
    if (!org || org.status !== "active")
      failCode("FORBIDDEN", "组织当前不可用", 403);
    const m = (await this.store.list("org_memberships")).find(
      (r) => r._id === this.auth.membershipId,
    );
    if (!m || m.orgId !== this.orgId || m.status !== "active" || m.role !== "admin")
      failCode("FORBIDDEN", "组织成员关系已失效或权限不足", 403);
    if (permission && !(m.permissions || []).includes(permission))
      failCode("FORBIDDEN", "缺少该敏感操作的显式权限点", 403);
  }
  // Self-service rule for user actors: a profile already bound to another
  // account is off-limits. An UNBOUND profile may receive a user-submitted
  // application — ownership is then proven by the manual review itself,
  // which is exactly what claimAccount later requires (approved + applicant
  // == caller).
  subjectCheck(person, audit) {
    if (
      (audit.actorType || "adminAccount") === "user" &&
      person.userId &&
      person.userId !== audit.actorId
    )
      failCode("FORBIDDEN", "只能为本人档案提交实名资料", 403);
  }
  requireRevision(data) {
    if (!Number.isInteger(data?.expectedRevision))
      failCode("PARAM_ERROR", "缺少 expectedRevision");
  }
  async application(id) {
    const app = (await this.store.list("identity_applications", this.orgId)).find(
      (a) => a._id === id,
    );
    if (!app) failCode("NOT_FOUND", "实名申请不存在或不可见", 404);
    return app;
  }
  async createApplication({ personId, documentType }, audit, op = null) {
    if (!DOCUMENT_TYPES.includes(documentType))
      failCode("PARAM_ERROR", "证件类型无效");
    const person = (await this.store.list("persons", this.orgId)).find(
      (p) => p._id === personId,
    );
    if (!person || person.status !== "active")
      failCode("NOT_FOUND", "人员档案不存在或不可见", 404);
    this.subjectCheck(person, audit);
    const id = randomUUID();
    const result = { status: 201, body: { applicationId: id, documentVersion: 1, state: "draft" } };
    await this.store.transact(
      [ref("identity_applications", id), ref("persons", personId), ...this.authRefs(), ...(op ? [ref("operation_keys", op.id)] : [])],
      (state) => {
        this.adminCheck(state);
        return [
          {
            collection: "identity_applications",
            id,
            data: {
              orgId: this.orgId,
              personId,
              submittedBy: audit.actorId || audit.actor || "unknown",
              submittedByType: audit.actorType || "adminAccount",
              method: "manual",
              state: "draft",
              documentVersion: 1,
              documentType,
              fileIds: [],
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
  async submit(id, data, audit, op = null) {
    return this.submitDocument(id, data, audit, op, false);
  }
  async supplement(id, data, audit, op = null) {
    return this.submitDocument(id, data, audit, op, true);
  }
  async submitDocument(id, { expectedRevision, document, fileIds }, audit, op, supplement) {
    this.requireRevision({ expectedRevision });
    const name = text(document?.name, "姓名", 80);
    const number = text(document?.documentNumber, "证件号码", 40);
    if (!/^[A-Za-z0-9()()-]{6,40}$/.test(number))
      failCode("PARAM_ERROR", "证件号码格式无效");
    if (!Array.isArray(fileIds) || fileIds.length === 0 || fileIds.some((f) => typeof f !== "string" || !f))
      failCode("PRIVATE_FILE_REQUIRED", "须先上传私有证件文件后再提交", 422);
    if (!this.fileValidator)
      failCode("ADAPTER_UNAVAILABLE", "文件校验适配器未配置（DB-07 接口预留）", 503);
    // External validation and encryption stay OUTSIDE the retriable
    // transaction callback (DATA-MODEL §3.2).
    await this.fileValidator(fileIds, { orgId: this.orgId, purpose: "identity-document" });
    if (!this.encryptionKey || !this.identity)
      failCode("ADAPTER_UNAVAILABLE", "资料加密密钥未配置", 503);
    const app = await this.application(id);
    const normalizedNumber = number.toUpperCase();
    const identityDigest = this.identity.digest(
      "identity-document",
      this.orgId,
      `${app.documentType}|${normalizedNumber}`,
    );
    await this.store.transact(
      [
        ref("identity_applications", id),
        ref("identity_private", id),
        ref("persons", app.personId),
        ...this.authRefs(),
        ...(op ? [ref("operation_keys", op.id)] : []),
      ],
      (state) => {
        this.adminCheck(state);
        const current = state[`identity_applications/${id}`];
        if (!current) failCode("NOT_FOUND", "实名申请不存在或不可见", 404);
        this.subjectCheck(state[`persons/${current.personId}`] || {}, audit);
        const allowed = supplement ? "needs_info" : "draft";
        if (current.state !== allowed)
          failCode("INVALID_STATE", `当前状态不允许${supplement ? "补件" : "提交"}`, 409);
        if ((current.revision ?? 0) !== expectedRevision)
          failCode("REVISION_CONFLICT", "申请版本不一致，请刷新后重试", 409);
        const documentVersion = supplement ? current.documentVersion + 1 : current.documentVersion;
        return [
          {
            collection: "identity_private",
            id,
            data: {
              applicationId: id,
              orgId: this.orgId,
              documentVersion,
              nameCiphertext: encrypt(this.encryptionKey, name),
              documentNumberCiphertext: encrypt(this.encryptionKey, normalizedNumber),
              encryptionKeyVersion: this.encryptionKeyVersion,
              ...base(),
            },
          },
          {
            collection: "identity_applications",
            id,
            data: {
              state: "submitted",
              documentVersion,
              identityDigest,
              keyVersion: this.identity.keyVersion,
              privateDataRef: id,
              fileIds: [...fileIds],
              submittedAt: Date.now(),
              revision: (current.revision ?? 0) + 1,
            },
          },
          ...opWrite(state, op, { status: 200, body: { applicationId: id, state: "submitted", documentVersion } }),
        ];
      },
      audit,
    );
    return { applicationId: id, state: "submitted", documentVersion: supplement ? app.documentVersion + 1 : app.documentVersion };
  }
  async review(id, { decision, reason, reasonCode = null, expectedRevision, documentVersion }, audit, op = null) {
    if (!DECISIONS[decision]) failCode("PARAM_ERROR", "审核决定无效");
    const trimmedReason = text(reason, "审核理由", 200);
    this.requireRevision({ expectedRevision });
    if (!Number.isInteger(documentVersion))
      failCode("PARAM_ERROR", "缺少 documentVersion");
    const app = await this.application(id);
    const state = DECISIONS[decision];
    const reviewId = randomUUID();
    const claim =
      decision === "approve" && app.identityDigest
        ? claimId("verified-person", `${this.orgId}|${app.documentType}`, app.identityDigest)
        : null;
    await this.store.transact(
      [
        ref("identity_applications", id),
        ref("identity_reviews", reviewId),
        ...(claim ? [ref("unique_claims", claim)] : []),
        ...this.authRefs(),
        ...(op ? [ref("operation_keys", op.id)] : []),
      ],
      (txState) => {
        this.adminCheck(txState, "identity.review");
        const current = txState[`identity_applications/${id}`];
        if (!current) failCode("NOT_FOUND", "实名申请不存在或不可见", 404);
        // The reviewer must never be the applicant (self-approval), and an
        // agent must not approve their own submission either.
        if ((audit.actorId || audit.actor) === current.submittedBy)
          failCode("FORBIDDEN", "审核人不能是申请提交人", 403);
        if (current.state !== "submitted")
          failCode("INVALID_STATE", "该申请不在待审状态，不能重复审批", 409);
        if (current.documentVersion !== documentVersion)
          failCode("STALE_DOCUMENT", "资料版本已变化，请按最新版本重新审核", 409);
        if ((current.revision ?? 0) !== expectedRevision)
          failCode("REVISION_CONFLICT", "申请版本不一致，请刷新后重试", 409);
        if (claim) {
          const existing = txState[`unique_claims/${claim}`];
          if (existing && existing.state === "bound" && existing.ownerId !== current.personId)
            failCode(
              "IDENTITY_CONFLICT",
              "该证件身份在本组织已核验到其他人员，须人工处理冲突",
              409,
            );
        }
        const writes = [
          {
            collection: "identity_applications",
            id,
            data: {
              state,
              reviewedAt: Date.now(),
              revision: (current.revision ?? 0) + 1,
            },
          },
          {
            collection: "identity_reviews",
            id: reviewId,
            data: {
              orgId: this.orgId,
              applicationId: id,
              documentVersion: current.documentVersion,
              decision,
              reasonCode,
              reason: trimmedReason,
              actorId: audit.actorId || audit.actor || "unknown",
              actorType: audit.actorType || "adminAccount",
              decidedAt: Date.now(),
              ...base(),
            },
          },
        ];
        if (claim)
          writes.push({
            collection: "unique_claims",
            id: claim,
            data: {
              orgId: this.orgId,
              namespace: "verified-person",
              ownerId: current.personId,
              state: "bound",
              ...base(),
            },
          });
        writes.push(...opWrite(txState, op, { status: 200, body: { applicationId: id, state } }));
        return writes;
      },
      audit,
    );
    return { applicationId: id, state };
  }
  // Masked view for ordinary reads: never includes digests or private data.
  async getApplication(id) {
    await this.readCheck();
    const app = await this.application(id);
    return {
      applicationId: app._id,
      orgId: app.orgId,
      personId: app.personId,
      state: app.state,
      documentVersion: app.documentVersion,
      documentType: app.documentType,
      method: app.method,
      submittedBy: app.submittedBy,
      submittedByType: app.submittedByType,
      fileIds: app.fileIds,
      submittedAt: app.submittedAt ?? null,
      reviewedAt: app.reviewedAt ?? null,
      revision: app.revision,
    };
  }
  async listApplications(query = {}) {
    await this.readCheck("identity.review");
    const { cursor, limit } = pageParams(query);
    const rows = (await this.store.list("identity_applications", this.orgId))
      .filter((a) => !query.state || a.state === query.state)
      .map((a) => ({
        applicationId: a._id,
        personId: a.personId,
        state: a.state,
        documentVersion: a.documentVersion,
        documentType: a.documentType,
        submittedBy: a.submittedBy,
        submittedAt: a.submittedAt ?? null,
        revision: a.revision,
      }));
    return page(rows, { cursor, limit });
  }
  // Sensitive read: explicit permission point + mandatory audit record.
  async readPrivate(id, audit) {
    await this.application(id);
    let result = null;
    await this.store.transact(
      [ref("identity_private", id), ...this.authRefs()],
      (state) => {
        this.adminCheck(state, "identity.readPrivate");
        const record = state[`identity_private/${id}`];
        if (!record) failCode("NOT_FOUND", "私有资料不存在", 404);
        result = {
          applicationId: id,
          documentVersion: record.documentVersion,
          name: decrypt(this.encryptionKey, record.nameCiphertext),
          documentNumber: decrypt(this.encryptionKey, record.documentNumberCiphertext),
        };
        return []; // no business writes; the audit entry is the access log
      },
      { ...audit, action: "读取实名私有资料" },
    );
    return result;
  }
  // Third-party verification is reserved but disabled: no external call, no
  // fabricated success (DATA-MODEL §6).
  async providerStart() {
    failCode("PROVIDER_DISABLED", "第三方实名核验未启用", 503);
  }
}
