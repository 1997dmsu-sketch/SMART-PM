import { createHash, randomUUID } from "node:crypto";
import { HttpError, failCode } from "./model.mjs";
import { opWrite, page, pageParams } from "./property-v2.mjs";
import { eligibilityGuardId } from "./claims.mjs";
export { eligibilityGuardId } from "./claims.mjs";

// DB-06: organization-scoped internal blacklist (DATA-MODEL §2/§3.2,
// API-CONTRACT §6). This service never changes occupancies or door locks.
// DB-05 must activate through withEligibility so list changes and activation
// write the same fixed subject guards. No public name/phone lookup is exposed.
const ref = (collection, id) => ({ collection, id });
const uniqueRefs = (refs) => [
  ...new Map(refs.map((r) => [`${r.collection}/${r.id}`, r])).values(),
];
const base = () => ({ schemaVersion: 2, revision: 1, createdAt: Date.now() });
const hash = (...parts) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
const text = (value, label, max = 200) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    failCode("PARAM_ERROR", `${label}需为 1–${max} 字`);
  return value.trim();
};
const identifier = (value, label) => text(value, label, 160);
const uniqueStrings = (value, label, { allowEmpty = true, max = 30 } = {}) => {
  if (!Array.isArray(value) || value.length > max || (!allowEmpty && value.length === 0) ||
      value.some((v) => typeof v !== "string" || !v.trim() || v.trim().length > 160))
    failCode("PARAM_ERROR", `${label}格式无效`);
  const result = value.map((v) => v.trim());
  if (new Set(result).size !== result.length)
    failCode("PARAM_ERROR", `${label}不能重复`);
  return result;
};
export const BLACKLIST_RESTRICTIONS = ["occupancy.create", "occupancy.activate"];
export const blacklistDecisionHeadId = (orgId, occupancyId, restriction = "occupancy.activate") =>
  `blacklist-decision-head-${restriction === "occupancy.activate"
    ? hash(orgId, occupancyId) // preserve DB-06 activate head IDs and history
    : hash(orgId, occupancyId, restriction)}`;
const subjectKeyOf = (subject) => `${subject.subjectType}|${subject.subjectKey}`;
const sameSubject = (entry, subject) =>
  entry.subjectType === subject.subjectType &&
  entry.subjectKey === subject.subjectKey &&
  (subject.subjectType !== "identity" || entry.keyVersion === subject.keyVersion);
export const blacklistActiveAt = (entry, now) =>
  entry.state === "active" && entry.startsAt <= now &&
  (entry.endsAt === null || now < entry.endsAt);
const effectiveState = (entry, now) => {
  if (entry.state === "revoked") return "revoked";
  if (now < entry.startsAt) return "scheduled";
  if (entry.endsAt !== null && now >= entry.endsAt) return "expired";
  return "active";
};
const retry = () => failCode("BLACKLIST_RETRY", "名单状态已变化，请重新检查", 409);
const sortedDecisionPairs = (entryIds, entryRevisions) =>
  entryIds.map((id, index) => ({ id, revision: entryRevisions[index] }))
    .sort((a, b) => a.id.localeCompare(b.id));

export class BlacklistService {
  constructor(store, orgId, auth = null, { fileValidator = null, now = Date.now } = {}) {
    this.store = store;
    this.orgId = orgId;
    this.auth = auth;
    this.fileValidator = fileValidator;
    this.now = now;
  }
  authRefs() {
    return [
      ref("organizations", this.orgId),
      ...(this.auth ? [ref("org_memberships", this.auth.membershipId)] : []),
    ];
  }
  adminCheck(state, permission) {
    const org = state[`organizations/${this.orgId}`];
    if (!org || org.status !== "active")
      failCode("FORBIDDEN", "组织当前不可用", 403);
    if (!this.auth) return; // trusted internal caller / isolated service tests
    const membership = state[`org_memberships/${this.auth.membershipId}`];
    if (!membership || membership.orgId !== this.orgId || membership.status !== "active" ||
        membership.role !== "admin" || !(membership.permissions || []).includes(permission))
      failCode("FORBIDDEN", "缺少该黑名单操作的显式权限点", 403);
  }
  async readCheck(permission) {
    const org = (await this.store.list("organizations")).find((o) => o._id === this.orgId);
    if (!org || org.status !== "active")
      failCode("FORBIDDEN", "组织当前不可用", 403);
    if (!this.auth) return;
    const membership = (await this.store.list("org_memberships"))
      .find((m) => m._id === this.auth.membershipId);
    if (!membership || membership.orgId !== this.orgId || membership.status !== "active" ||
        membership.role !== "admin" || !(membership.permissions || []).includes(permission))
      failCode("FORBIDDEN", "缺少该黑名单操作的显式权限点", 403);
  }
  async auditRead(audit) {
    await this.store.transact(this.authRefs(), (state) => {
      this.adminCheck(state, "blacklist.read");
      return [];
    }, { ...audit, action: "读取内部黑名单" });
  }
  async resolveSubject({ subjectType, personId, userId, applicationId }) {
    if (!["person", "user", "identity"].includes(subjectType))
      failCode("PARAM_ERROR", "名单主体类型无效");
    if (subjectType === "person") {
      const id = identifier(personId, "personId");
      const person = (await this.store.list("persons", this.orgId)).find((p) => p._id === id);
      if (!person) failCode("NOT_FOUND", "人员档案不存在或不可见", 404);
      return {
        subject: { subjectType, subjectKey: id },
        refs: [ref("persons", id)],
        verify: (state) => {
          const current = state[`persons/${id}`];
          if (!current || current.orgId !== this.orgId) retry();
        },
      };
    }
    if (subjectType === "user") {
      const id = identifier(userId, "userId");
      // Never enumerate the global users table: an org must prove the binding
      // through its own person record before creating a user-subject entry.
      const binding = (await this.store.list("persons", this.orgId)).find((p) => p.userId === id);
      if (!binding) failCode("NOT_FOUND", "组织内绑定人员不存在或不可见", 404);
      return {
        subject: { subjectType, subjectKey: id },
        refs: [ref("persons", binding._id)],
        verify: (state) => {
          const current = state[`persons/${binding._id}`];
          if (!current || current.orgId !== this.orgId || current.userId !== id) retry();
        },
      };
    }
    const id = identifier(applicationId, "applicationId");
    const application = (await this.store.list("identity_applications", this.orgId))
      .find((a) => a._id === id);
    if (!application) failCode("NOT_FOUND", "实名申请不存在或不可见", 404);
    if (application.state !== "approved" || !application.identityDigest)
      failCode("IDENTITY_NOT_APPROVED", "仅可引用本组织已核验身份", 403);
    return {
      subject: {
        subjectType,
        subjectKey: application.identityDigest,
        keyVersion: application.keyVersion,
      },
      applicationId: id,
      refs: [ref("identity_applications", id)],
      verify: (state) => {
        const current = state[`identity_applications/${id}`];
        if (!current || current.orgId !== this.orgId || current.state !== "approved" ||
            current.identityDigest !== application.identityDigest ||
            current.keyVersion !== application.keyVersion) retry();
      },
    };
  }
  guardWrite(state, subject) {
    const id = eligibilityGuardId(this.orgId, subject.subjectType, subject.subjectKey);
    const current = state[`eligibility_guards/${id}`];
    if (current && current.orgId !== this.orgId)
      failCode("FORBIDDEN", "资格 guard 组织边界无效", 403);
    return {
      collection: "eligibility_guards",
      id,
      data: {
        orgId: this.orgId,
        subjectType: subject.subjectType,
        subjectKey: subject.subjectKey,
        ...(subject.subjectType === "identity" ? { keyVersion: subject.keyVersion } : {}),
        epoch: (current?.epoch ?? 0) + 1,
        ...(current ? { revision: (current.revision ?? 0) + 1 } : base()),
      },
    };
  }
  dto(entry) {
    const now = this.now();
    return {
      entryId: entry._id,
      subjectType: entry.subjectType,
      ...(entry.subjectType === "person" ? { personId: entry.subjectKey } : {}),
      ...(entry.subjectType === "user" ? { userId: entry.subjectKey } : {}),
      ...(entry.subjectType === "identity" ? {
        applicationId: entry.applicationId,
        keyVersion: entry.keyVersion,
      } : {}),
      reasonCode: entry.reasonCode,
      reason: entry.reason,
      evidenceFileIds: [...(entry.evidenceFileIds || [])],
      restrictions: [...entry.restrictions],
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      state: entry.state,
      effectiveState: effectiveState(entry, now),
      createdBy: entry.createdBy,
      revokedBy: entry.revokedBy ?? null,
      revokedAt: entry.revokedAt ?? null,
      revokeReason: entry.revokeReason ?? null,
      revision: entry.revision,
    };
  }
  async createEntry(data, audit, op = null) {
    await this.readCheck("blacklist.manage");
    const resolved = await this.resolveSubject(data);
    const reason = text(data.reason, "名单理由");
    const reasonCode = data.reasonCode === undefined ? "manual" : text(data.reasonCode, "reasonCode", 40);
    const evidenceFileIds = uniqueStrings(data.evidenceFileIds ?? [], "evidenceFileIds");
    const restrictions = uniqueStrings(data.restrictions, "restrictions", { allowEmpty: false, max: 2 });
    if (restrictions.some((r) => !BLACKLIST_RESTRICTIONS.includes(r)))
      failCode("PARAM_ERROR", "名单限制范围无效");
    if (evidenceFileIds.length && !this.fileValidator)
      failCode("ADAPTER_UNAVAILABLE", "证据文件校验适配器未配置（DB-07 接口预留）", 503);
    if (evidenceFileIds.length)
      await this.fileValidator(evidenceFileIds, { orgId: this.orgId, purpose: "blacklist-evidence" });
    const startsAt = data.startsAt ?? this.now();
    const endsAt = data.endsAt ?? null;
    if (!Number.isInteger(startsAt) || startsAt < 0 ||
        (endsAt !== null && (!Number.isInteger(endsAt) || endsAt <= startsAt)))
      failCode("PARAM_ERROR", "名单有效期无效");
    const id = randomUUID();
    const guardId = eligibilityGuardId(this.orgId, resolved.subject.subjectType, resolved.subject.subjectKey);
    const body = { entryId: id, state: "active", revision: 1 };
    await this.store.transact([
      ref("blacklist_entries", id),
      ref("eligibility_guards", guardId),
      ...resolved.refs,
      ...this.authRefs(),
      ...(op ? [ref("operation_keys", op.id)] : []),
    ], (state) => {
      this.adminCheck(state, "blacklist.manage");
      resolved.verify(state);
      return [
        {
          collection: "blacklist_entries",
          id,
          data: {
            orgId: this.orgId,
            ...resolved.subject,
            ...(resolved.applicationId ? { applicationId: resolved.applicationId } : {}),
            reasonCode,
            reason,
            evidenceFileIds,
            restrictions,
            startsAt,
            endsAt,
            state: "active",
            createdBy: audit.actorId || audit.actor || "unknown",
            createdByType: audit.actorType || "adminAccount",
            ...base(),
          },
        },
        this.guardWrite(state, resolved.subject),
        ...opWrite(state, op, { status: 201, body }),
      ];
    }, audit);
    return body;
  }
  async listEntries(query = {}, audit) {
    await this.readCheck("blacklist.read");
    const { cursor, limit } = pageParams(query);
    const now = this.now();
    const rows = (await this.store.list("blacklist_entries", this.orgId))
      .filter((entry) => !query.subjectType || entry.subjectType === query.subjectType)
      .filter((entry) => !query.state || effectiveState(entry, now) === query.state);
    const result = page(rows, { cursor, limit });
    await this.auditRead(audit);
    return { ...result, data: result.data.map((entry) => this.dto(entry)) };
  }
  async revokeEntry(id, { expectedRevision, reason }, audit, op = null) {
    await this.readCheck("blacklist.manage");
    identifier(id, "entryId");
    if (!Number.isInteger(expectedRevision)) failCode("PARAM_ERROR", "缺少 expectedRevision");
    const revokeReason = text(reason, "解除理由");
    const existing = (await this.store.list("blacklist_entries", this.orgId)).find((e) => e._id === id);
    if (!existing) failCode("NOT_FOUND", "名单记录不存在或不可见", 404);
    const guardId = eligibilityGuardId(this.orgId, existing.subjectType, existing.subjectKey);
    const body = { entryId: id, state: "revoked", revision: expectedRevision + 1 };
    await this.store.transact([
      ref("blacklist_entries", id),
      ref("eligibility_guards", guardId),
      ...this.authRefs(),
      ...(op ? [ref("operation_keys", op.id)] : []),
    ], (state) => {
      this.adminCheck(state, "blacklist.manage");
      const current = state[`blacklist_entries/${id}`];
      if (!current || current.orgId !== this.orgId)
        failCode("NOT_FOUND", "名单记录不存在或不可见", 404);
      if (current.state !== "active") failCode("INVALID_STATE", "名单已解除", 409);
      if (current.revision !== expectedRevision)
        failCode("REVISION_CONFLICT", "名单版本不一致，请刷新后重试", 409);
      const subject = {
        subjectType: current.subjectType,
        subjectKey: current.subjectKey,
        ...(current.subjectType === "identity" ? { keyVersion: current.keyVersion } : {}),
      };
      return [
        {
          collection: "blacklist_entries",
          id,
          data: {
            state: "revoked",
            revokeReason,
            revokedBy: audit.actorId || audit.actor || "unknown",
            revokedAt: this.now(),
            revision: current.revision + 1,
          },
        },
        this.guardWrite(state, subject),
        ...opWrite(state, op, { status: 200, body }),
      ];
    }, audit);
    return body;
  }
  // Activation review retains the DB-06 contract. Creation review is allowed
  // only for a persisted DB-05 application and snapshots its immutable request
  // digest/version plus the complete current hit set into append-only history.
  async reviewOccupancy(occupancyId, data, audit, op = null) {
    identifier(occupancyId, "occupancyId");
    const restriction = data.restriction ?? "occupancy.activate";
    if (!BLACKLIST_RESTRICTIONS.includes(restriction)) failCode("PARAM_ERROR", "复核范围无效");
    if (!["allow", "deny"].includes(data.decision)) failCode("PARAM_ERROR", "复核决定无效");
    const reason = text(data.reason, "复核理由");
    const entryIds = uniqueStrings(data.entryIds, "entryIds", { allowEmpty: false });
    if (!Array.isArray(data.entryRevisions) || data.entryRevisions.length !== entryIds.length ||
        data.entryRevisions.some((r) => !Number.isInteger(r) || r < 1))
      failCode("PARAM_ERROR", "entryRevisions 与 entryIds 不匹配");
    const pairs = sortedDecisionPairs(entryIds, data.entryRevisions);
    const sortedIds = pairs.map((p) => p.id);
    const sortedRevisions = pairs.map((p) => p.revision);
    await this.readCheck("blacklist.review");
    let createApplication = null;
    let createToken = null;
    if (restriction === "occupancy.create") {
      createApplication = (await this.store.list("occupancy_applications", this.orgId))
        .find((application) => application._id === occupancyId);
      if (!createApplication) failCode("NOT_FOUND", "待审入住申请不存在或不可见", 404);
      if (createApplication.state === "consumed")
        failCode("INVALID_STATE", "待审入住申请已消费，不能重复复核", 409);
      if (typeof createApplication.requestDigest !== "string" ||
          !Number.isInteger(createApplication.requestVersion) || createApplication.requestVersion < 1)
        failCode("INVALID_STATE", "待审入住申请请求版本无效", 409);
      createToken = await this.prepareEligibility({
        personId: createApplication.personId,
        occupancyId,
        restriction,
        requestDigest: createApplication.requestDigest,
        requestVersion: createApplication.requestVersion,
      });
    }
    const entries = (await this.store.list("blacklist_entries", this.orgId))
      .filter((e) => sortedIds.includes(e._id));
    if (entries.length !== sortedIds.length)
      failCode("NOT_FOUND", "部分名单记录不存在或不可见", 404);
    const reviewSubjects = [...new Map(entries.map((entry) => {
      const subject = {
        subjectType: entry.subjectType,
        subjectKey: entry.subjectKey,
        ...(entry.subjectType === "identity" ? { keyVersion: entry.keyVersion } : {}),
      };
      return [subjectKeyOf(subject), subject];
    })).values()];
    const headId = blacklistDecisionHeadId(this.orgId, occupancyId, restriction);
    const decisionId = randomUUID();
    const body = {
      decisionId,
      occupancyId,
      restriction,
      decision: data.decision,
      entryIds: sortedIds,
      entryRevisions: sortedRevisions,
      ...(createApplication ? {
        applicationId: occupancyId,
        requestVersion: createApplication.requestVersion,
      } : {}),
    };
    await this.store.transact([
      ref("blacklist_decisions", headId),
      ref("blacklist_decisions", decisionId),
      ...sortedIds.map((id) => ref("blacklist_entries", id)),
      ...reviewSubjects.map((subject) => ref("eligibility_guards",
        eligibilityGuardId(this.orgId, subject.subjectType, subject.subjectKey))),
      ...(createToken ? [ref("occupancy_applications", occupancyId), ...createToken.refs] : []),
      ...this.authRefs(),
      ...(op ? [ref("operation_keys", op.id)] : []),
    ], (state) => {
      this.adminCheck(state, "blacklist.review");
      const now = this.now();
      let currentCreateApplication = null;
      if (createToken) {
        currentCreateApplication = state[`occupancy_applications/${occupancyId}`];
        if (!currentCreateApplication || currentCreateApplication.orgId !== this.orgId ||
            currentCreateApplication.revision !== createApplication.revision ||
            currentCreateApplication.requestDigest !== createApplication.requestDigest ||
            currentCreateApplication.requestVersion !== createApplication.requestVersion)
          failCode("REVISION_CONFLICT", "待审入住申请版本已变化，请重新复核", 409);
        if (currentCreateApplication.state === "consumed")
          failCode("INVALID_STATE", "待审入住申请已消费，不能重复复核", 409);
        // The client supplies a review checklist, not the scope of the check.
        // Re-derive every current hit from person + bound-user subjects so a
        // second entry cannot be omitted to manufacture a partial allow.
        const eligibility = this.evaluateEligibility(state, createToken, { deferBlocked: true });
        if (JSON.stringify(eligibility.entryIds) !== JSON.stringify(sortedIds))
          failCode("REVISION_CONFLICT", "当前完整命中名单已变化，请重新复核", 409);
      }
      let expiresAt = null;
      for (const pair of pairs) {
        const current = state[`blacklist_entries/${pair.id}`];
        if (!current || current.orgId !== this.orgId)
          failCode("NOT_FOUND", "部分名单记录不存在或不可见", 404);
        if (current.revision !== pair.revision)
          failCode("REVISION_CONFLICT", "名单版本已变化，请重新复核", 409);
        if (!blacklistActiveAt(current, now) || !current.restrictions.includes(restriction))
          failCode("INVALID_STATE", "仅可复核当前命中该操作限制的名单", 409);
        if (current.endsAt !== null && (expiresAt === null || current.endsAt < expiresAt))
          expiresAt = current.endsAt;
      }
      const head = state[`blacklist_decisions/${headId}`];
      const common = {
        orgId: this.orgId,
        occupancyId,
        restriction,
        entryIds: sortedIds,
        entryRevisions: sortedRevisions,
        decision: data.decision,
        reason,
        reviewerId: audit.actorId || audit.actor || "unknown",
        decidedAt: now,
        expiresAt,
        ...(currentCreateApplication ? {
          applicationId: occupancyId,
          applicationRevision: currentCreateApplication.revision,
          requestDigest: currentCreateApplication.requestDigest,
          requestVersion: currentCreateApplication.requestVersion,
        } : {}),
      };
      return [
        {
          collection: "blacklist_decisions",
          id: decisionId,
          data: { ...common, recordType: "decision", ...base() },
        },
        {
          collection: "blacklist_decisions",
          id: headId,
          data: {
            ...common,
            recordType: "current",
            latestDecisionId: decisionId,
            ...(head ? { revision: (head.revision ?? 0) + 1 } : base()),
          },
        },
        ...(currentCreateApplication ? [{
          collection: "occupancy_applications",
          id: occupancyId,
          data: {
            state: data.decision === "allow" ? "allowed" : "denied",
            latestDecisionId: decisionId,
            reviewedAt: now,
            revision: currentCreateApplication.revision + 1,
          },
        }] : []),
        // Review and activation also serialize through the subject guards;
        // a newer deny cannot race with an activation using an older allow.
        ...reviewSubjects.map((subject) => this.guardWrite(state, subject)),
        ...opWrite(state, op, { status: 200, body }),
      ];
    }, audit);
    return body;
  }
  async prepareEligibility({ personId, identityApplicationId = null, occupancyId,
    restriction = "occupancy.activate", requestDigest = null, requestVersion = null }) {
    identifier(personId, "personId");
    identifier(occupancyId, "occupancyId");
    if (!BLACKLIST_RESTRICTIONS.includes(restriction)) failCode("PARAM_ERROR", "资格检查范围无效");
    if (restriction === "occupancy.create" &&
        (typeof requestDigest !== "string" || !Number.isInteger(requestVersion) || requestVersion < 1))
      failCode("PARAM_ERROR", "创建资格检查缺少请求摘要或版本");
    const person = (await this.store.list("persons", this.orgId)).find((p) => p._id === personId);
    if (!person) failCode("NOT_FOUND", "人员档案不存在或不可见", 404);
    const subjects = [{ subjectType: "person", subjectKey: personId }];
    const refs = [ref("persons", personId)];
    if (person.userId) {
      subjects.push({ subjectType: "user", subjectKey: person.userId });
      // The exact binding snapshot owns the user ref. DB-05 activation checks
      // its current status in the same transaction; a concurrent disable or
      // rebind therefore conflicts instead of using an earlier login decision.
      refs.push(ref("users", person.userId));
    }
    let application = null;
    if (identityApplicationId) {
      identifier(identityApplicationId, "identityApplicationId");
      application = (await this.store.list("identity_applications", this.orgId))
        .find((a) => a._id === identityApplicationId);
      if (!application) failCode("NOT_FOUND", "实名申请不存在或不可见", 404);
      if (application.personId !== personId)
        failCode("IDENTITY_CONFLICT", "实名申请与人员档案不一致", 409);
      if (application.state !== "approved" || !application.identityDigest)
        failCode("IDENTITY_NOT_APPROVED", "人员实名尚未审核通过", 403);
      subjects.push({
        subjectType: "identity",
        subjectKey: application.identityDigest,
        keyVersion: application.keyVersion,
      });
      refs.push(ref("identity_applications", identityApplicationId));
    }
    subjects.sort((a, b) => subjectKeyOf(a).localeCompare(subjectKeyOf(b)));
    const guardIds = subjects.map((s) => eligibilityGuardId(this.orgId, s.subjectType, s.subjectKey));
    // F01: read guard epochs BEFORE the entry snapshot, sequentially. If an
    // entry commits while the entry list is being read, its guard write makes
    // the earlier epoch stale and evaluateEligibility forces a full rescan.
    // The reverse order could combine old candidates with a newer epoch.
    const guards = await this.store.list("eligibility_guards", this.orgId);
    const guardEpochs = Object.fromEntries(guardIds.map((id) => {
      const guard = guards.find((g) => g._id === id);
      return [id, guard?.epoch ?? 0];
    }));
    const now = this.now();
    const candidates = (await this.store.list("blacklist_entries", this.orgId))
      // Revoked and already expired records can never hit again; scheduled
      // records stay in the ref set so a time boundary is still evaluated in
      // the activation transaction without a scheduler or extra guard write.
      .filter((entry) => entry.state === "active" &&
        (entry.endsAt === null || entry.endsAt > now) &&
        entry.restrictions.includes(restriction) &&
        subjects.some((subject) => sameSubject(entry, subject)))
      .sort((a, b) => a._id.localeCompare(b._id));
    const headId = blacklistDecisionHeadId(this.orgId, occupancyId, restriction);
    return {
      personId,
      identityApplicationId,
      occupancyId,
      restriction,
      subjects,
      personRevision: person.revision,
      boundUserId: person.userId ?? null,
      identityDigest: application?.identityDigest ?? null,
      identityKeyVersion: application?.keyVersion ?? null,
      candidateIds: candidates.map((e) => e._id),
      guardIds,
      guardEpochs,
      headId,
      requestDigest,
      requestVersion,
      refs: [
        ...refs,
        ...candidates.map((e) => ref("blacklist_entries", e._id)),
        ...guardIds.map((id) => ref("eligibility_guards", id)),
        ref("blacklist_decisions", headId),
      ],
    };
  }
  evaluateEligibility(state, token, { deferBlocked = false, now = this.now() } = {}) {
    const person = state[`persons/${token.personId}`];
    if (!person || person.orgId !== this.orgId || person.revision !== token.personRevision ||
        (person.userId ?? null) !== token.boundUserId) retry();
    if (token.identityApplicationId) {
      const application = state[`identity_applications/${token.identityApplicationId}`];
      if (!application || application.orgId !== this.orgId || application.state !== "approved" ||
          application.personId !== token.personId || application.identityDigest !== token.identityDigest ||
          application.keyVersion !== token.identityKeyVersion) retry();
    }
    for (const id of token.guardIds)
      if ((state[`eligibility_guards/${id}`]?.epoch ?? 0) !== token.guardEpochs[id]) retry();
    if (!Number.isSafeInteger(now) || now < 0)
      failCode("ADAPTER_UNAVAILABLE", "资格时钟不可用", 503);
    const hits = [];
    for (const id of token.candidateIds) {
      const entry = state[`blacklist_entries/${id}`];
      if (!entry || entry.orgId !== this.orgId) retry();
      if (blacklistActiveAt(entry, now)) hits.push(entry);
    }
    hits.sort((a, b) => a._id.localeCompare(b._id));
    if (!hits.length) return { eligible: true, entryIds: [], decisionId: null };
    const head = state[`blacklist_decisions/${token.headId}`];
    const entryIds = hits.map((e) => e._id);
    const entryRevisions = hits.map((e) => e.revision);
    const requestMatches = token.restriction !== "occupancy.create" ||
      (head?.requestDigest === token.requestDigest && head?.requestVersion === token.requestVersion);
    const exact = head && requestMatches &&
      (head.restriction ?? "occupancy.activate") === token.restriction &&
      JSON.stringify(head.entryIds) === JSON.stringify(entryIds) &&
      JSON.stringify(head.entryRevisions) === JSON.stringify(entryRevisions);
    const unexpired = head && (head.expiresAt === null || now < head.expiresAt);
    if (exact && unexpired && head.decision === "allow")
      return { eligible: true, entryIds, decisionId: head.latestDecisionId };
    const code = exact && unexpired && head.decision === "deny"
      ? "BLACKLIST_DENIED"
      : "BLACKLIST_REVIEW_REQUIRED";
    if (deferBlocked) return { eligible: false, code, entryIds, decisionId: null };
    if (code === "BLACKLIST_DENIED") failCode(code, "本次申请已复核拒绝", 403);
    failCode(code, "命中内部复核规则，须管理员复核", 409);
  }
  // DB-05 integration boundary. build(state, eligibility) returns
  // {writes,result}; this wrapper appends the same subject guard writes and
  // retries the WHOLE pre-read + transaction when a list change is detected.
  //
  // H2-c Q06: the optional prepareAttempt(token) hook runs after every
  // prepareEligibility() so callers (createGrant) can plan qualification refs
  // from a fresh pre-read each attempt. Its beforeEvaluate(state, token) runs
  // inside the same transaction, before evaluateEligibility(), and may fail
  // with BLACKLIST_RETRY to join the existing three-attempt loop. Other
  // qualification errors (e.g. REVISION_CONFLICT/IDENTITY_NOT_APPROVED) are
  // formal failures and propagate without retry. The hook never computes or
  // forges eligibility and never changes candidates, guards, decisions, retry
  // count or deferBlocked semantics.
  //
  // H2-c C3 review: createGrant sets deferPrepareError so a real
  // prepareEligibility() failure (e.g. NOT_FOUND after a concurrent revoke)
  // cannot surface before the transaction's permission/operation/credential
  // checks. In that mode prepareAttempt(null) still plans the qualification
  // refs, beforeEvaluate runs first inside the same authorization transaction,
  // and the original prepare error is rethrown only after those checks pass.
  // Without the explicit option the default remains "fail before the
  // transaction", so C1/C2 and existing callers are unchanged.
  async withEligibility(request, refs, build, audit,
    { deferBlocked = false, prepareAttempt = null, deferPrepareError = false } = {}) {
    if (prepareAttempt !== null && typeof prepareAttempt !== "function")
      failCode("ADAPTER_UNAVAILABLE", "资格准备钩子不可用", 503);
    for (let attempt = 0; attempt < 3; attempt++) {
      let token = null;
      let prepareError = null;
      try {
        token = await this.prepareEligibility(request);
      } catch (error) {
        // Existing callers keep the immediate failure. Only an explicit
        // deferPrepareError + hook transaction defers it behind §6.3 prechecks.
        if (!deferPrepareError || !prepareAttempt) throw error;
        prepareError = error;
      }
      const prepared = prepareAttempt ? await prepareAttempt(token) : null;
      if (prepareAttempt && (!prepared || !Array.isArray(prepared.refs) ||
          typeof prepared.beforeEvaluate !== "function"))
        failCode("ADAPTER_UNAVAILABLE", "资格准备钩子未返回有效契约", 503);
      const hookRefs = prepared?.refs ?? [];
      if (hookRefs.some((item) => !item || typeof item !== "object" ||
          Array.isArray(item) || typeof item.collection !== "string" ||
          !item.collection.trim() || typeof item.id !== "string" || !item.id.trim()))
        failCode("ADAPTER_UNAVAILABLE", "资格准备钩子返回的 refs 无效", 503);
      const attemptRefs = uniqueRefs([...refs, ...hookRefs, ...(token?.refs ?? [])]);
      if (attemptRefs.length > 90)
        // 与 CloudStore 同一上限：超限失败关闭，不拆事务、不省略 refs。
        throw new HttpError(400, "一次操作涉及记录过多，请缩小选择范围");
      let result;
      try {
        await this.store.transact(attemptRefs, async (state) => {
          // 资格快照竞态在 beforeEvaluate 内以 BLACKLIST_RETRY 抛出，进入同一重试。
          const context = prepared ? await prepared.beforeEvaluate(state, token) : null;
          // Permission/operation/credential/qualification passed; now the
          // deferred blacklist pre-read error may surface. No writes are
          // returned, so this is still the one authorization transaction.
          if (prepareError) throw prepareError;
          const eligibility = this.evaluateEligibility(state, token, { deferBlocked });
          const built = await build(state, eligibility, context);
          if (!built || !Array.isArray(built.writes))
            throw Error("Eligibility transaction build must return {writes,result}");
          result = built.result;
          return [
            ...built.writes,
            ...token.subjects.map((subject) => this.guardWrite(state, subject)),
          ];
        }, audit);
        return result;
      } catch (error) {
        if (error.code !== "BLACKLIST_RETRY" || attempt === 2) throw error;
      }
    }
    throw new Error("unreachable");
  }
}
