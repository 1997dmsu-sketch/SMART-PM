/**
 * HK-AI-04 服务层（集合接线，无 HTTP）。
 *
 * 流程严格分离：
 *   submit   → 仅创建/更新 credential（不建 grant/job，不调 Provider）
 *   review   → 仅改 credential 审核状态（不建 grant/job）
 *   grant    → withEligibility 通过后创建 grant + job + claims
 *   revoke   → grant 立即 revoked，再建异步清理 job；不查资格
 *   queryJob → 组织内最小 DTO，跨组织 404
 *
 * Provider 只在 transact 之外调用；Mock 证据恒为 simulated，永不 device_verified。
 */
import { createHash } from "node:crypto";

import { failCode } from "../model.mjs";
import { PURPOSES } from "../files.mjs";
import {
  COLLECTIONS,
  deviceClaimKey,
  grantSlotKey,
  nextRevision,
  operationKey,
  validateRecord,
} from "./collections.mjs";
import {
  IMAGE_STATE,
  REVIEW_STATE,
  assertCreateGrantInput,
  assertSubmitInput,
  publicJobResult,
  publicReviewItem,
} from "./dto.mjs";

const ref = (collection, id) => ({ collection, id });
const digestOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class FaceCredentialService {
  constructor({ store, orgId, actor, files, blacklist, provider, now = () => Date.now() }) {
    this.store = store;
    this.orgId = orgId;
    this.actor = actor;
    this.files = files;
    this.blacklist = blacklist;
    this.provider = provider;
    this.now = now;
  }

  async #membership() {
    const rows = await this.store.list("org_memberships", this.orgId);
    const membership = rows.find((m) => m._id === this.actor.membershipId);
    if (!membership || membership.orgId !== this.orgId || membership.status !== "active") {
      failCode("FORBIDDEN", "组织成员关系已失效或权限不足", 403);
    }
    return membership;
  }

  async #require(permission) {
    const membership = await this.#membership();
    if (!(membership.permissions || []).includes(permission)) {
      failCode("FORBIDDEN", `缺少权限点 ${permission}`, 403);
    }
    return membership;
  }

  #audit(action) {
    return { actor: this.actor.actorId, actorId: this.actor.actorId, action, orgId: this.orgId };
  }

  async #opKey(route, idempotencyKey) {
    if (typeof idempotencyKey !== "string" || !idempotencyKey) {
      failCode("PARAM_ERROR", "缺少 Idempotency-Key", 400);
    }
    return operationKey({
      orgId: this.orgId,
      method: route,
      actorType: this.actor.actorType || "user",
      actorId: this.actor.actorId,
      idempotencyKey,
    });
  }

  async #find(collection, id) {
    return (await this.store.list(collection, this.orgId)).find((row) => row._id === id) || null;
  }

  // 1. 提交：只建 credential（人员 + 人脸来源 + 审核/图片状态）。
  async submit(input, { idempotencyKey } = {}) {
    await this.#require("device.face.submit");
    const parsed = assertSubmitInput(input);
    const reference = await this.files.prepareReference(parsed.sourceFileId);

    const opKey = await this.#opKey("face.submit", idempotencyKey);
    const requestDigest = digestOf(parsed);
    const credentialId = `fc-${digestOf(opKey).slice(0, 24)}`;

    await this.store.transact(
      [
        ref(COLLECTIONS.FACE_CREDENTIALS, credentialId),
        ref(COLLECTIONS.OPERATION_KEYS, opKey),
        ...reference.refs,
      ],
      (state) => {
        this.files.assertReference(state, reference);
        const existing = state[`${COLLECTIONS.OPERATION_KEYS}/${opKey}`];
        if (existing) {
          if (existing.digest !== requestDigest) failCode("CONFLICT", "同键不同请求摘要", 409);
          return [];
        }
        const now = this.now();
        const record = {
          orgId: this.orgId,
          revision: 1,
          personId: parsed.personId,
          sourceFileId: parsed.sourceFileId,
          sourceFileRevision: reference.revision,
          reviewState: REVIEW_STATE.SUBMITTED,
          imageState: IMAGE_STATE.VERIFIED,
          evidenceScope: "simulated",
          createdAt: now,
          updatedAt: now,
        };
        validateRecord(COLLECTIONS.FACE_CREDENTIALS, record);
        const result = { credentialId, reviewState: record.reviewState };
        return [
          { collection: COLLECTIONS.FACE_CREDENTIALS, id: credentialId, data: record },
          {
            collection: COLLECTIONS.OPERATION_KEYS,
            id: opKey,
            data: { orgId: this.orgId, digest: requestDigest, result, createdAt: now },
          },
        ];
      },
      this.#audit("提交人脸凭证"),
    );
    return { credentialId, reviewState: REVIEW_STATE.SUBMITTED };
  }

  // 2. 审核：只改 credential。
  async review(credentialId, { decision, expectedRevision } = {}, { idempotencyKey } = {}) {
    await this.#require("device.face.review");
    if (!["approved", "rejected"].includes(decision)) failCode("PARAM_ERROR", "审核结论无效", 400);

    const credential = await this.#find(COLLECTIONS.FACE_CREDENTIALS, credentialId);
    if (!credential) failCode("NOT_FOUND", "凭证不存在或不可见", 404);

    const opKey = await this.#opKey("face.review", idempotencyKey);
    const requestDigest = digestOf({ credentialId, decision, expectedRevision: expectedRevision ?? null });
    let result = null;

    await this.store.transact(
      [ref(COLLECTIONS.FACE_CREDENTIALS, credentialId), ref(COLLECTIONS.OPERATION_KEYS, opKey)],
      (state) => {
        const existing = state[`${COLLECTIONS.OPERATION_KEYS}/${opKey}`];
        if (existing) {
          if (existing.digest !== requestDigest) failCode("CONFLICT", "同键不同请求摘要", 409);
          result = existing.result;
          return [];
        }
        const current = state[`${COLLECTIONS.FACE_CREDENTIALS}/${credentialId}`];
        if (!current || current.orgId !== this.orgId) failCode("NOT_FOUND", "凭证不存在或不可见", 404);
        if (current.reviewState !== REVIEW_STATE.SUBMITTED) {
          failCode("INVALID_STATE", "仅 submitted 状态可审核", 409);
        }
        if (Number.isInteger(expectedRevision) && current.revision !== expectedRevision) {
          failCode("REVISION_CONFLICT", "凭证已被修改，请刷新后重试", 409);
        }
        const nextReview = decision === "approved" ? REVIEW_STATE.APPROVED : REVIEW_STATE.REJECTED;
        result = { credentialId, reviewState: nextReview };
        return [
          {
            collection: COLLECTIONS.FACE_CREDENTIALS,
            id: credentialId,
            data: { reviewState: nextReview, revision: nextRevision(current), updatedAt: this.now() },
          },
          {
            collection: COLLECTIONS.OPERATION_KEYS,
            id: opKey,
            data: { orgId: this.orgId, digest: requestDigest, result, createdAt: this.now() },
          },
        ];
      },
      this.#audit("审核人脸凭证"),
    );
    return result;
  }

  async reviewQueue() {
    await this.#require("device.face.review");
    const rows = await this.store.list(COLLECTIONS.FACE_CREDENTIALS, this.orgId);
    return rows.filter((row) => row.reviewState === REVIEW_STATE.SUBMITTED).map(publicReviewItem);
  }

  // 3. 创建授权：H1 仅冻结输入，阶段关闭（H2 原子事务未开放）。
  async createGrant(input, { idempotencyKey } = {}) {
    await this.#require("device.access.manage");
    assertCreateGrantInput(input);
    failCode("STAGE_CLOSED", "授权创建尚未开放（H2）", 501);
  }

  // 4. 撤销：H1 阶段关闭（H4 撤权闭环未开放）。
  async revoke(grantId, { idempotencyKey } = {}) {
    await this.#require("device.access.manage");
    if (typeof grantId !== "string" || !grantId.trim()) failCode("PARAM_ERROR", "grantId 必填", 400);
    failCode("STAGE_CLOSED", "撤权尚未开放（H4）", 501);
  }

  // 5. 查询任务：org 内最小 DTO。
  async queryJob(jobId) {
    await this.#require("device.audit.read");
    const job = await this.#find(COLLECTIONS.DEVICE_OPERATION_JOBS, jobId);
    if (!job) failCode("NOT_FOUND", "任务不存在或不可见", 404);
    return publicJobResult(job);
  }


}
