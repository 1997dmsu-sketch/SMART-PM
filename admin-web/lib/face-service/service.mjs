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
  GRANT_STATE,
  IMAGE_STATE,
  JOB_STATE,
  REVIEW_STATE,
  assertEnrollInput,
  publicJobResult,
  publicReviewItem,
} from "./dto.mjs";
import { classifyProviderError } from "./mock-provider.mjs";

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

  // 1. 提交：只建 credential。
  async submit(input, { idempotencyKey } = {}) {
    await this.#require("device.face.submit");
    const parsed = assertEnrollInput(input);
    if (!input.occupancyId) failCode("PARAM_ERROR", "occupancyId 必填", 400);

    // 引用校验：token 携带 file/organization/membership refs，事务内再复核。
    const reference = await this.files.prepareReference(parsed.sourceFileId);

    const opKey = await this.#opKey("face.submit", idempotencyKey);
    const requestDigest = digestOf({ ...parsed, occupancyId: input.occupancyId });
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
          deviceId: parsed.deviceId,
          grantId: parsed.grantId,
          occupancyId: input.occupancyId,
          sourceFileId: parsed.sourceFileId,
          sourceFileRevision: reference.revision,
          validFrom: parsed.validFrom,
          validUntil: parsed.validUntil,
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

  // 3. 创建授权：资格事务 + device/slot claim + grant/job。
  async createGrant({ credentialId, occupancyId, cycleId, identityApplicationId }, { idempotencyKey } = {}) {
    await this.#require("device.access.manage");
    if (!credentialId || !occupancyId || !cycleId || !identityApplicationId) {
      failCode("PARAM_ERROR", "credentialId/occupancyId/cycleId/identityApplicationId 必填", 400);
    }
    const credential = await this.#find(COLLECTIONS.FACE_CREDENTIALS, credentialId);
    if (!credential) failCode("NOT_FOUND", "凭证不存在或不可见", 404);
    if (credential.reviewState !== REVIEW_STATE.APPROVED) {
      failCode("INVALID_STATE", "凭证尚未审核通过", 409);
    }

    const opKey = await this.#opKey("face.grant", idempotencyKey);
    const requestDigest = digestOf({ credentialId, occupancyId, cycleId, identityApplicationId });
    const grantId = `grant-${digestOf(opKey).slice(0, 24)}`;
    const jobId = `job-${digestOf(`${opKey}:enroll`).slice(0, 24)}`;
    const slotId = grantSlotKey({ orgId: this.orgId, personId: credential.personId, deviceId: credential.deviceId, cycleId });
    let result = null;

    await this.blacklist.withEligibility(
      {
        personId: credential.personId,
        occupancyId,
        identityApplicationId,
        restriction: "occupancy.activate",
      },
      [
        ref(COLLECTIONS.FACE_CREDENTIALS, credentialId),
        ref(COLLECTIONS.DEVICE_ACCESS_GRANTS, grantId),
        ref(COLLECTIONS.DEVICE_OPERATION_JOBS, jobId),
        ref(COLLECTIONS.GRANT_SLOT_CLAIMS, slotId),
        ref(COLLECTIONS.OPERATION_KEYS, opKey),
      ],
      (state, eligibility) => {
        if (!eligibility?.eligible) {
          const code = eligibility?.code || "BLACKLIST_DENIED";
          failCode(code, "资格不满足，无法创建门禁授权", code === "BLACKLIST_DENIED" ? 403 : 409);
        }
        const existing = state[`${COLLECTIONS.OPERATION_KEYS}/${opKey}`];
        if (existing) {
          if (existing.digest !== requestDigest) failCode("CONFLICT", "同键不同请求摘要", 409);
          result = existing.result;
          return { writes: [], result };
        }
        const current = state[`${COLLECTIONS.FACE_CREDENTIALS}/${credentialId}`];
        if (!current || current.orgId !== this.orgId) failCode("NOT_FOUND", "凭证不存在或不可见", 404);
        if (current.reviewState !== REVIEW_STATE.APPROVED) {
          failCode("INVALID_STATE", "凭证尚未审核通过", 409);
        }
        const slot = state[`${COLLECTIONS.GRANT_SLOT_CLAIMS}/${slotId}`];
        if (slot && slot.grantId !== grantId) failCode("GRANT_SLOT_CONFLICT", "授权槽位冲突", 409);

        const now = this.now();
        const grant = {
          orgId: this.orgId,
          revision: 1,
          credentialId,
          personId: current.personId,
          deviceId: current.deviceId,
          occupancyId,
          cycleId,
          state: GRANT_STATE.EFFECTIVE,
          evidenceScope: "simulated",
          validFrom: current.validFrom,
          validUntil: current.validUntil,
          createdAt: now,
          updatedAt: now,
        };
        const job = {
          orgId: this.orgId,
          revision: 1,
          credentialId,
          grantId,
          deviceId: current.deviceId,
          action: "enroll",
          state: JOB_STATE.QUEUED,
          executionMode: "test",
          provider: "mock",
          evidenceScope: "simulated",
          attempts: 0,
          createdAt: now,
        };
        validateRecord(COLLECTIONS.DEVICE_ACCESS_GRANTS, grant);
        validateRecord(COLLECTIONS.DEVICE_OPERATION_JOBS, job);
        result = { grantId, jobId, evidenceScope: "simulated" };
        return {
          writes: [
            { collection: COLLECTIONS.DEVICE_ACCESS_GRANTS, id: grantId, data: grant },
            { collection: COLLECTIONS.DEVICE_OPERATION_JOBS, id: jobId, data: job },
            {
              collection: COLLECTIONS.GRANT_SLOT_CLAIMS,
              id: slotId,
              data: { orgId: this.orgId, deviceId: current.deviceId, grantId, cycleId, revision: 1, createdAt: now },
            },
            {
              collection: COLLECTIONS.OPERATION_KEYS,
              id: opKey,
              data: { orgId: this.orgId, digest: requestDigest, result, createdAt: now },
            },
          ],
          result,
        };
      },
      this.#audit("创建门禁授权"),
    );

    if (result?.jobId) await this.#runJob(result.jobId, "enroll");
    return result;
  }

  // 4. 撤销：不查资格；grant 立即失效；异步清理失败不回滚。
  async revoke(grantId, { idempotencyKey } = {}) {
    await this.#require("device.access.manage");
    const grant = await this.#find(COLLECTIONS.DEVICE_ACCESS_GRANTS, grantId);
    if (!grant) failCode("NOT_FOUND", "授权不存在或不可见", 404);

    const opKey = await this.#opKey("face.revoke", idempotencyKey);
    const requestDigest = digestOf({ grantId });
    const jobId = `job-${digestOf(`${opKey}:revoke`).slice(0, 24)}`;
    let result = null;

    await this.store.transact(
      [
        ref(COLLECTIONS.DEVICE_ACCESS_GRANTS, grantId),
        ref(COLLECTIONS.DEVICE_OPERATION_JOBS, jobId),
        ref(COLLECTIONS.OPERATION_KEYS, opKey),
      ],
      (state) => {
        const existing = state[`${COLLECTIONS.OPERATION_KEYS}/${opKey}`];
        if (existing) {
          if (existing.digest !== requestDigest) failCode("CONFLICT", "同键不同请求摘要", 409);
          result = existing.result;
          return [];
        }
        const current = state[`${COLLECTIONS.DEVICE_ACCESS_GRANTS}/${grantId}`];
        if (!current || current.orgId !== this.orgId) failCode("NOT_FOUND", "授权不存在或不可见", 404);
        const now = this.now();
        const job = {
          orgId: this.orgId,
          revision: 1,
          credentialId: current.credentialId,
          grantId,
          deviceId: current.deviceId,
          action: "revoke",
          state: JOB_STATE.QUEUED,
          executionMode: "test",
          provider: "mock",
          evidenceScope: "simulated",
          attempts: 0,
          createdAt: now,
        };
        validateRecord(COLLECTIONS.DEVICE_OPERATION_JOBS, job);
        result = { grantId, jobId };
        return [
          {
            collection: COLLECTIONS.DEVICE_ACCESS_GRANTS,
            id: grantId,
            data: {
              state: GRANT_STATE.REVOKED,
              cleanupPending: true,
              revision: nextRevision(current),
              updatedAt: now,
            },
          },
          { collection: COLLECTIONS.DEVICE_OPERATION_JOBS, id: jobId, data: job },
          {
            collection: COLLECTIONS.OPERATION_KEYS,
            id: opKey,
            data: { orgId: this.orgId, digest: requestDigest, result, createdAt: now },
          },
        ];
      },
      this.#audit("撤销门禁授权"),
    );

    if (result?.jobId) await this.#runJob(result.jobId, "revoke");
    return result;
  }

  // 5. 查询任务：org 内最小 DTO。
  async queryJob(jobId) {
    await this.#require("device.audit.read");
    const job = await this.#find(COLLECTIONS.DEVICE_OPERATION_JOBS, jobId);
    if (!job) failCode("NOT_FOUND", "任务不存在或不可见", 404);
    return publicJobResult(job);
  }

  async #runJob(jobId, action) {
    const job = await this.#find(COLLECTIONS.DEVICE_OPERATION_JOBS, jobId);
    if (!job) return;
    const credential = await this.#find(COLLECTIONS.FACE_CREDENTIALS, job.credentialId);
    if (!credential) return;
    const context = {
      actorId: this.actor.actorId,
      actorType: this.actor.actorType || "user",
      orgId: this.orgId,
      permissions: new Set(),
      idempotencyKey: `job-${jobId}`.slice(0, 64).padEnd(16, "0"),
      executionMode: "test",
    };
    try {
      if (action === "enroll") {
        await this.provider.enrollFace(
          {
            personId: credential.personId,
            deviceId: job.deviceId,
            grantId: job.grantId,
            sourceFileId: credential.sourceFileId,
            validFrom: credential.validFrom,
            validUntil: credential.validUntil,
          },
          context,
        );
      } else {
        await this.provider.revokeFace(
          { grantId: job.grantId, credentialId: job.credentialId },
          context,
        );
      }
      await this.#closeJob(jobId, JOB_STATE.SUCCEEDED, null);
    } catch (error) {
      const kind = classifyProviderError(error);
      const state = kind === "UNKNOWN_RESULT" ? JOB_STATE.AWAITING_RESULT : JOB_STATE.TERMINAL_FAILED;
      await this.#closeJob(jobId, state, String(error?.code || kind).slice(0, 120));
      if (action === "revoke") {
        // 清理失败不回滚：grant 保持 revoked，仅标记 cleanupPending。
        await this.store.transact(
          [ref(COLLECTIONS.DEVICE_ACCESS_GRANTS, job.grantId)],
          (current) => {
            const grant = current[`${COLLECTIONS.DEVICE_ACCESS_GRANTS}/${job.grantId}`];
            if (!grant) return [];
            return [{
              collection: COLLECTIONS.DEVICE_ACCESS_GRANTS,
              id: job.grantId,
              data: { cleanupPending: true, revision: nextRevision(grant), updatedAt: this.now() },
            }];
          },
          this.#audit("记录撤权清理待处理"),
        );
      }
    }
  }

  async #closeJob(jobId, state, failureReason) {
    await this.store.transact(
      [ref(COLLECTIONS.DEVICE_OPERATION_JOBS, jobId)],
      (current) => {
        const job = current[`${COLLECTIONS.DEVICE_OPERATION_JOBS}/${jobId}`];
        if (!job) return [];
        return [{
          collection: COLLECTIONS.DEVICE_OPERATION_JOBS,
          id: jobId,
          data: {
            state,
            evidenceScope: "simulated",
            attempts: (job.attempts || 0) + 1,
            lastSuccessAt: state === JOB_STATE.SUCCEEDED ? this.now() : job.lastSuccessAt ?? null,
            failureReason,
            revision: nextRevision(job),
            updatedAt: this.now(),
          },
        }];
      },
      this.#audit("执行人脸任务"),
    );
  }
}
