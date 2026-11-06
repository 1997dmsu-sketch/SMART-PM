/**
 * HK-AI-04 服务层（集合接线；不注册 HTTP）。
 *
 * 复用：OrgService 等价成员/权限读取、FileService 的私密文件生命周期、
 * BlacklistService.withEligibility 的资格事务、store.transact、operation_keys。
 *
 * 事务边界：Provider 调用一律在 transact 之外；Mock 结果 evidenceScope 恒为 simulated，
 * 不产生 device_verified，也不把 grant 标为真实设备生效。
 */
import { createHash } from "node:crypto";

import { failCode } from "../model.mjs";
import {
  COLLECTIONS,
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

  async #audit(action) {
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

  /** 提交：权限 → 源文件可见性 → 资格事务（含幂等与 revision 写入）。 */
  async submit(input, { idempotencyKey } = {}) {
    await this.#require("device.face.submit");
    const parsed = assertEnrollInput(input);
    if (!input.occupancyId) failCode("PARAM_ERROR", "occupancyId 必填", 400);
    const file = (await this.store.list("file_assets", this.orgId)).find(
      (f) => f._id === parsed.sourceFileId,
    );
    if (!file || file.orgId !== this.orgId || file.purpose !== "face-biometric" || file.status !== "ready") {
      failCode("FILE_NOT_FOUND", "源文件不存在或不可见", 404);
    }

    const opKey = await this.#opKey("face.submit", idempotencyKey);
    const requestDigest = digestOf({ ...parsed, occupancyId: input.occupancyId });
    const credentialId = `fc-${digestOf(opKey).slice(0, 24)}`;
    const audit = await this.#audit("提交人脸凭证");

    return this.blacklist.withEligibility(
      {
        personId: parsed.personId,
        occupancyId: input.occupancyId,
        restriction: "occupancy.activate",
      },
      [ref(COLLECTIONS.FACE_CREDENTIALS, credentialId), ref(COLLECTIONS.OPERATION_KEYS, opKey)],
      async (state, eligibility) => {
        if (!eligibility?.eligible) {
          failCode(eligibility?.code || "BLACKLIST_DENIED", "资格不满足，无法提交人脸凭证", 403);
        }
        const existing = state[`${COLLECTIONS.OPERATION_KEYS}/${opKey}`];
        if (existing) {
          if (existing.digest !== requestDigest) failCode("CONFLICT", "同键不同请求摘要", 409);
          return { writes: [], result: existing.result };
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
        return {
          writes: [
            { collection: COLLECTIONS.FACE_CREDENTIALS, id: credentialId, data: record },
            {
              collection: COLLECTIONS.OPERATION_KEYS,
              id: opKey,
              data: { orgId: this.orgId, digest: requestDigest, result, createdAt: now },
            },
          ],
          result,
        };
      },
      audit,
    );
  }

  /** 审核队列：审核权限即可看最小投影，不含图片/摘要。 */
  async reviewQueue() {
    await this.#require("device.face.review");
    const rows = await this.store.list(COLLECTIONS.FACE_CREDENTIALS, this.orgId);
    return rows
      .filter((row) => row.reviewState === REVIEW_STATE.SUBMITTED)
      .map((row) => publicReviewItem(row));
  }

  async review(credentialId, { decision, expectedRevision } = {}, { idempotencyKey } = {}) {
    await this.#require("device.face.review");
    if (!["approved", "rejected"].includes(decision)) failCode("PARAM_ERROR", "审核结论无效", 400);

    const credential = (await this.store.list(COLLECTIONS.FACE_CREDENTIALS, this.orgId)).find(
      (row) => row._id === credentialId,
    );
    if (!credential) failCode("NOT_FOUND", "凭证不存在或不可见", 404);

    const opKey = await this.#opKey("face.review", idempotencyKey);
    const requestDigest = digestOf({ credentialId, decision, expectedRevision: expectedRevision ?? null });
    const audit = await this.#audit("审核人脸凭证");
    const grantId = `grant-${digestOf(opKey).slice(0, 24)}`;
    const jobId = `job-${digestOf(`${opKey}:job`).slice(0, 24)}`;

    const result = await this.blacklist.withEligibility(
      {
        personId: credential.personId,
        occupancyId: credential.occupancyId,
        restriction: "occupancy.activate",
      },
      [
        ref(COLLECTIONS.FACE_CREDENTIALS, credentialId),
        ref(COLLECTIONS.DEVICE_ACCESS_GRANTS, grantId),
        ref(COLLECTIONS.DEVICE_OPERATION_JOBS, jobId),
        ref(COLLECTIONS.OPERATION_KEYS, opKey),
      ],
      async (state, eligibility) => {
        if (!eligibility?.eligible) {
          failCode(eligibility?.code || "BLACKLIST_DENIED", "资格不满足，无法审核", 403);
        }
        const existing = state[`${COLLECTIONS.OPERATION_KEYS}/${opKey}`];
        if (existing) {
          if (existing.digest !== requestDigest) failCode("CONFLICT", "同键不同请求摘要", 409);
          return { writes: [], result: existing.result };
        }
        const current = state[`${COLLECTIONS.FACE_CREDENTIALS}/${credentialId}`];
        if (!current || current.orgId !== this.orgId) failCode("NOT_FOUND", "凭证不存在或不可见", 404);
        if (current.reviewState !== REVIEW_STATE.SUBMITTED) {
          failCode("INVALID_STATE", "仅 submitted 状态可审核", 409);
        }
        if (Number.isInteger(expectedRevision) && current.revision !== expectedRevision) {
          failCode("REVISION_CONFLICT", "凭证已被修改，请刷新后重试", 409);
        }

        const now = this.now();
        const nextReview = decision === "approved" ? REVIEW_STATE.APPROVED : REVIEW_STATE.REJECTED;
        const writes = [
          {
            collection: COLLECTIONS.FACE_CREDENTIALS,
            id: credentialId,
            data: { reviewState: nextReview, revision: nextRevision(current), updatedAt: now },
          },
        ];
        const res = { credentialId, reviewState: nextReview, grantId: null, jobId: null };

        if (decision === "approved") {
          const grant = {
            orgId: this.orgId,
            revision: 1,
            credentialId,
            personId: current.personId,
            deviceId: current.deviceId,
            state: GRANT_STATE.EFFECTIVE,
            evidenceScope: "simulated",
            validFrom: current.validFrom,
            validUntil: current.validUntil,
            createdAt: now,
          };
          const job = {
            orgId: this.orgId,
            revision: 1,
            credentialId,
            grantId,
            deviceId: current.deviceId,
            action: "enroll",
            state: JOB_STATE.QUEUED,
            evidenceScope: "simulated",
            attempts: 0,
            createdAt: now,
          };
          validateRecord(COLLECTIONS.DEVICE_ACCESS_GRANTS, grant);
          validateRecord(COLLECTIONS.DEVICE_OPERATION_JOBS, job);
          writes.push({ collection: COLLECTIONS.DEVICE_ACCESS_GRANTS, id: grantId, data: grant });
          writes.push({ collection: COLLECTIONS.DEVICE_OPERATION_JOBS, id: jobId, data: job });
          res.grantId = grantId;
          res.jobId = jobId;
        }
        writes.push({
          collection: COLLECTIONS.OPERATION_KEYS,
          id: opKey,
          data: { orgId: this.orgId, digest: requestDigest, result: res, createdAt: now },
        });
        return { writes, result: res };
      },
      audit,
    );

    // Provider 调用在事务之外；失败只回写 job 状态，不回滚已提交的业务结果。
    if (result.jobId) await this.#runEnrollJob(result.jobId, result.grantId);
    return result;
  }

  async #runEnrollJob(jobId, grantId) {
    const job = (await this.store.list(COLLECTIONS.DEVICE_OPERATION_JOBS, this.orgId)).find(
      (row) => row._id === jobId,
    );
    if (!job) return;
    const credential = (await this.store.list(COLLECTIONS.FACE_CREDENTIALS, this.orgId)).find(
      (row) => row._id === job.credentialId,
    );
    const context = {
      actorId: this.actor.actorId,
      actorType: this.actor.actorType || "user",
      orgId: this.orgId,
      permissions: new Set(),
      idempotencyKey: `job-${jobId}`.slice(0, 64).padEnd(16, "0"),
      executionMode: "test",
    };
    try {
      await this.provider.enrollFace(
        {
          personId: credential.personId,
          deviceId: job.deviceId,
          grantId,
          sourceFileId: credential.sourceFileId,
          validFrom: credential.validFrom,
          validUntil: credential.validUntil,
        },
        context,
      );
      await this.#closeJob(jobId, JOB_STATE.SUCCEEDED, "simulated");
    } catch (error) {
      const kind = classifyProviderError(error);
      const state = kind === "UNKNOWN_RESULT" ? JOB_STATE.AWAITING_RESULT : JOB_STATE.TERMINAL_FAILED;
      await this.#closeJob(jobId, state, "simulated", String(error?.code || kind).slice(0, 120));
    }
  }

  async #closeJob(jobId, state, evidenceScope, failureReason = null) {
    await this.store.transact(
      [ref(COLLECTIONS.DEVICE_OPERATION_JOBS, jobId)],
      (current) => {
        const job = current[`${COLLECTIONS.DEVICE_OPERATION_JOBS}/${jobId}`];
        if (!job) return [];
        return [
          {
            collection: COLLECTIONS.DEVICE_OPERATION_JOBS,
            id: jobId,
            data: {
              state,
              evidenceScope,
              attempts: (job.attempts || 0) + 1,
              lastSuccessAt: state === JOB_STATE.SUCCEEDED ? this.now() : job.lastSuccessAt ?? null,
              failureReason,
              revision: nextRevision(job),
              updatedAt: this.now(),
            },
          },
        ];
      },
      await this.#audit("执行人脸任务"),
    );
  }

  async revoke(grantId, { idempotencyKey } = {}) {
    await this.#require("device.access.manage");
    const grant = (await this.store.list(COLLECTIONS.DEVICE_ACCESS_GRANTS, this.orgId)).find(
      (row) => row._id === grantId,
    );
    if (!grant) failCode("NOT_FOUND", "授权不存在或不可见", 404);
    const opKey = await this.#opKey("face.revoke", idempotencyKey);
    const requestDigest = digestOf({ grantId });
    const jobId = `job-${digestOf(`${opKey}:revoke`).slice(0, 24)}`;

    const result = await this.store.transact(
      [
        ref(COLLECTIONS.DEVICE_ACCESS_GRANTS, grantId),
        ref(COLLECTIONS.DEVICE_OPERATION_JOBS, jobId),
        ref(COLLECTIONS.OPERATION_KEYS, opKey),
      ],
      (state) => {
        const existing = state[`${COLLECTIONS.OPERATION_KEYS}/${opKey}`];
        if (existing) {
          if (existing.digest !== requestDigest) failCode("CONFLICT", "同键不同请求摘要", 409);
          return [];
        }
        const current = state[`${COLLECTIONS.DEVICE_ACCESS_GRANTS}/${grantId}`];
        if (!current || current.orgId !== this.orgId) failCode("NOT_FOUND", "授权不存在或不可见", 404);
        const now = this.now();
        const res = { grantId, jobId };
        return [
          {
            collection: COLLECTIONS.DEVICE_ACCESS_GRANTS,
            id: grantId,
            data: { state: GRANT_STATE.REVOKED, revision: nextRevision(current), updatedAt: now },
          },
          {
            collection: COLLECTIONS.DEVICE_OPERATION_JOBS,
            id: jobId,
            data: {
              orgId: this.orgId, revision: 1, credentialId: current.credentialId, grantId,
              deviceId: current.deviceId, action: "revoke", state: JOB_STATE.QUEUED,
              evidenceScope: "simulated", attempts: 0, createdAt: now,
            },
          },
          {
            collection: COLLECTIONS.OPERATION_KEYS,
            id: opKey,
            data: { orgId: this.orgId, digest: requestDigest, result: res, createdAt: now },
          },
        ];
      },
      await this.#audit("撤销人脸授权"),
    );

    const job = (await this.store.list(COLLECTIONS.DEVICE_OPERATION_JOBS, this.orgId)).find(
      (row) => row._id === jobId,
    );
    if (job) await this.#runRevokeJob(jobId);
    return { grantId, jobId };
  }

  async #runRevokeJob(jobId) {
    const job = (await this.store.list(COLLECTIONS.DEVICE_OPERATION_JOBS, this.orgId)).find(
      (row) => row._id === jobId,
    );
    if (!job) return;
    try {
      await this.provider.revokeFace(
        { grantId: job.grantId, credentialId: job.credentialId },
        {
          actorId: this.actor.actorId,
          actorType: this.actor.actorType || "user",
          orgId: this.orgId,
          permissions: new Set(),
          idempotencyKey: `job-${jobId}`.slice(0, 64).padEnd(16, "0"),
          executionMode: "test",
        },
      );
      await this.#closeJob(jobId, JOB_STATE.SUCCEEDED, "simulated");
    } catch (error) {
      const kind = classifyProviderError(error);
      const state = kind === "UNKNOWN_RESULT" ? JOB_STATE.AWAITING_RESULT : JOB_STATE.TERMINAL_FAILED;
      await this.#closeJob(jobId, state, "simulated", String(error?.code || kind).slice(0, 120));
    }
  }

  async queryJob(jobId) {
    await this.#require("device.audit.read");
    const job = (await this.store.list(COLLECTIONS.DEVICE_OPERATION_JOBS, this.orgId)).find(
      (row) => row._id === jobId,
    );
    if (!job) failCode("NOT_FOUND", "任务不存在或不可见", 404);
    return publicJobResult(job);
  }
}
