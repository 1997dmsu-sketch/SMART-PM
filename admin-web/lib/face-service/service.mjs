/**
 * HK-AI-04 服务层（H1 阶段）。
 *
 * 已实现：submit（最小 credential）、review（审核状态机）、reviewQueue、queryJob。
 * 阶段关闭：createGrant / revoke 返回 STAGE_CLOSED，不写 grant/job/claim/slot/log。
 * 未实现：H2 原子授权、H3 租约与派发、H4 撤权闭环；不调用任何 Provider。
 */
import { createHash } from "node:crypto";

import { failCode } from "../model.mjs";
import {
  COLLECTIONS,
  applyDigestDomain,
  deterministicLogId,
  deviceClaimConfig,
  deviceClaimKey,
  deviceDigestDomainKey,
  deviceDigestDomainVersionKey,
  grantSlotKey,
  isReclaimable,
  nextRevision,
  applyOperationKeyDomain,
  operationKey,
  operationKeyConfig,
  operationKeyDomainIds,
  operationKeyFingerprint,
  assertIdempotencyKey,
  validateRecord,
} from "./collections.mjs";
import {
  GRANT_STATE,
  IMAGE_STATE,
  JOB_STATE,
  REVIEW_STATE,
  assertCreateGrantInput,
  assertSubmitInput,
  publicJobResult,
  publicReviewItem,
} from "./dto.mjs";

const ref = (collection, id) => ({ collection, id });
const classificationRevision = (record) => (Number.isInteger(record?.revision) ? record.revision + 1 : 1);
const stable = (value) => (Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])])) : value);
const digestOf = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

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

  async #find(collection, id) {
    return (await this.store.list(collection, this.orgId)).find((row) => row._id === id) || null;
  }

  async #opContext(route, idempotencyKey) {
    try { assertIdempotencyKey(idempotencyKey); } catch (error) { failCode("PARAM_ERROR", error.message, 400); }
    const config = operationKeyConfig(process.env);
    const opKey = operationKey({
      orgId: this.orgId, method: route, actorType: this.actor.actorType || "user",
      actorId: this.actor.actorId, idempotencyKey, config,
    });
    const { headId, versionIdPrefix } = operationKeyDomainIds(config.realm);
    return { opKey, config, headId, versionId: `${versionIdPrefix}${config.version}`, fingerprint: operationKeyFingerprint(config) };
  }

  #opDomainRefs(op) {
    return [ref(COLLECTIONS.OPERATION_KEY_DOMAINS, op.headId), ref(COLLECTIONS.OPERATION_KEY_DOMAINS, op.versionId)];
  }

  #opDomainWrites(state, op, now) {
    return applyOperationKeyDomain(state, {
      realm: op.config.realm, version: op.config.version, fingerprint: op.fingerprint, now,
    });
  }

  // 1. 提交：只建 credential（人员 + 人脸来源 + 审核/图片状态）。
  async submit(input, { idempotencyKey } = {}) {
    await this.#require("device.face.submit");
    const parsed = assertSubmitInput(input);
    const reference = await this.files.prepareReference(parsed.sourceFileId);

    const op = await this.#opContext("face.submit", idempotencyKey);
    const { opKey } = op;
    const requestDigest = digestOf(parsed);
    const credentialId = `fc-${digestOf(opKey).slice(0, 24)}`;

    await this.store.transact(
      [
        ref(COLLECTIONS.FACE_CREDENTIALS, credentialId),
        ref(COLLECTIONS.OPERATION_KEYS, opKey),
        ...this.#opDomainRefs(op),
        ...reference.refs,
      ],
      (state) => {
        this.files.assertReference(state, reference);
        const domainWrites = this.#opDomainWrites(state, op, this.now());
        const existing = state[`${COLLECTIONS.OPERATION_KEYS}/${opKey}`];
        if (existing) {
          if (existing.realm !== op.config.realm || existing.keyVersion !== op.config.version ||
            existing.requestDigest !== requestDigest) {
          failCode("CONFLICT", "同键不同请求摘要或域不一致", 409);
        }
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
          ...domainWrites,
          { collection: COLLECTIONS.FACE_CREDENTIALS, id: credentialId, data: record },
          {
            collection: COLLECTIONS.OPERATION_KEYS,
            id: opKey,
            data: { orgId: this.orgId, realm: op.config.realm, keyVersion: op.config.version, requestDigest, result, createdAt: now },
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

    const op = await this.#opContext("face.review", idempotencyKey);
    const { opKey } = op;
    const requestDigest = digestOf({ credentialId, decision, expectedRevision: expectedRevision ?? null });
    let result = null;

    await this.store.transact(
      [ref(COLLECTIONS.FACE_CREDENTIALS, credentialId), ref(COLLECTIONS.OPERATION_KEYS, opKey), ...this.#opDomainRefs(op)],
      (state) => {
        const domainWrites = this.#opDomainWrites(state, op, this.now());
        const existing = state[`${COLLECTIONS.OPERATION_KEYS}/${opKey}`];
        if (existing) {
          if (existing.realm !== op.config.realm || existing.keyVersion !== op.config.version ||
            existing.requestDigest !== requestDigest) {
          failCode("CONFLICT", "同键不同请求摘要或域不一致", 409);
        }
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
          ...domainWrites,
          {
            collection: COLLECTIONS.FACE_CREDENTIALS,
            id: credentialId,
            data: { reviewState: nextReview, revision: nextRevision(current), updatedAt: this.now() },
          },
          {
            collection: COLLECTIONS.OPERATION_KEYS,
            id: opKey,
            data: { orgId: this.orgId, realm: op.config.realm, keyVersion: op.config.version, requestDigest, result, createdAt: this.now() },
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

  // 3. 创建授权（H2：权限 → op key → 资格 → domain/claim/slot/grant/job/log/op key）。
  async createGrant(input, { idempotencyKey } = {}) {
    await this.#require("device.access.manage");
    const parsed = assertCreateGrantInput(input);
    const op = await this.#opContext("face.grant", idempotencyKey);
    const { opKey } = op;
    const requestDigest = digestOf(parsed);

    const credential = await this.#find(COLLECTIONS.FACE_CREDENTIALS, parsed.credentialId);
    if (!credential) failCode("NOT_FOUND", "凭证不存在或不可见", 404);
    const device = await this.#find("access_devices", parsed.deviceId);
    if (!device || device.orgId !== this.orgId) failCode("NOT_FOUND", "设备不存在或不可见", 404);
    if (device.status !== "active") failCode("INVALID_STATE", "设备已停用", 409);

    const k1 = deviceClaimConfig(process.env);
    const provider = device.provider || "hikvision";
    const claimId = deviceClaimKey({ provider, digestRealm: k1.realm, serial: device.serialNumber, key: k1.key, version: k1.version });
    const slotId = grantSlotKey({ orgId: this.orgId, personId: credential.personId, deviceId: parsed.deviceId, cycleId: parsed.cycleId });
    const headId = deviceDigestDomainKey({ provider, digestRealm: k1.realm });
    const versionId = deviceDigestDomainVersionKey({ provider, digestRealm: k1.realm, version: k1.version });
    const grantId = `grant-${digestOf(opKey).slice(0, 24)}`;
    const jobId = `job-${digestOf(opKey + ":enroll").slice(0, 24)}`;
    const logId = deterministicLogId(jobId, "queued");
    let result = null;

    await this.blacklist.withEligibility(
      {
        personId: credential.personId,
        occupancyId: parsed.occupancyId,
        identityApplicationId: parsed.identityApplicationId,
        restriction: "occupancy.activate",
      },
      [
        ref(COLLECTIONS.FACE_CREDENTIALS, parsed.credentialId),
        ref("file_assets", credential.sourceFileId),
        ref("organizations", this.orgId),
        ref("org_memberships", this.actor.membershipId),
        ref("access_devices", parsed.deviceId),
        ref(COLLECTIONS.DEVICE_DIGEST_DOMAINS, headId),
        ref(COLLECTIONS.DEVICE_DIGEST_DOMAINS, versionId),
        ref(COLLECTIONS.DEVICE_CLAIMS, claimId),
        ref(COLLECTIONS.GRANT_SLOT_CLAIMS, slotId),
        ref(COLLECTIONS.DEVICE_ACCESS_GRANTS, grantId),
        ref(COLLECTIONS.DEVICE_OPERATION_JOBS, jobId),
        ref(COLLECTIONS.DEVICE_OPERATION_LOGS, logId),
        ref(COLLECTIONS.OPERATION_KEYS, opKey),
        ...this.#opDomainRefs(op),
      ],
      (state, eligibility) => {
        // 1) 事务内复核成员与权限（先于重放，撤销后不得重放）。
        const org = state[`organizations/${this.orgId}`];
        const membership = state[`org_memberships/${this.actor.membershipId}`];
        if (!org || org.status !== "active" || !membership || membership.status !== "active" ||
            !(membership.permissions || []).includes("device.access.manage")) {
          failCode("FORBIDDEN", "当前成员无权创建门禁授权", 403);
        }
        // 2) operation key：同键同摘要直接返回旧结果。
        const domainWrites = this.#opDomainWrites(state, op, this.now());
        const existing = state[`${COLLECTIONS.OPERATION_KEYS}/${opKey}`];
        if (existing) {
          if (existing.realm !== op.config.realm || existing.keyVersion !== op.config.version ||
            existing.requestDigest !== requestDigest) {
          failCode("CONFLICT", "同键不同请求摘要或域不一致", 409);
        }
          result = existing.result;
          return { writes: [], result };
        }
        // 3) withEligibility 已提供同一事务内的资格结论。
        if (!eligibility?.eligible) {
          const code = eligibility?.code || "BLACKLIST_DENIED";
          failCode(code, "资格不满足，无法创建门禁授权", code === "BLACKLIST_DENIED" ? 403 : 409);
        }
        const current = state[`${COLLECTIONS.FACE_CREDENTIALS}/${parsed.credentialId}`];
        if (!current || current.orgId !== this.orgId) failCode("NOT_FOUND", "凭证不存在或不可见", 404);
        if (current.reviewState !== REVIEW_STATE.APPROVED) failCode("INVALID_STATE", "凭证尚未审核通过", 409);
        if (current.revision !== parsed.expectedCredentialRevision) {
          failCode("REVISION_CONFLICT", "凭证已被修改，请刷新后重试", 409);
        }
        this.files.assertBinding(state, { fileId: current.sourceFileId, revision: current.sourceFileRevision });

        const currentDevice = state[`access_devices/${parsed.deviceId}`];
        if (!currentDevice || currentDevice.orgId !== this.orgId) failCode("NOT_FOUND", "设备不存在或不可见", 404);
        if (currentDevice.status !== "active") failCode("INVALID_STATE", "设备已停用", 409);

        const deviceDomainWrites = applyDigestDomain(state, {
          provider,
          digestRealm: k1.realm,
          version: k1.version,
          now: this.now(),
        });

        const claim = state[`${COLLECTIONS.DEVICE_CLAIMS}/${claimId}`];
        if (!isReclaimable(claim, grantId)) failCode("DEVICE_CLAIMED", "设备已被其他授权占用", 409);
        const slot = state[`${COLLECTIONS.GRANT_SLOT_CLAIMS}/${slotId}`];
        if (!isReclaimable(slot, grantId)) failCode("GRANT_SLOT_CONFLICT", "授权槽位冲突", 409);

        const now = this.now();
        const grantRecord = {
          orgId: this.orgId, revision: 1, credentialId: parsed.credentialId,
          personId: current.personId, deviceId: parsed.deviceId,
          occupancyId: parsed.occupancyId, cycleId: parsed.cycleId,
          state: GRANT_STATE.PENDING, evidenceScope: "simulated",
          validFrom: parsed.validFrom, validUntil: parsed.validUntil,
          createdAt: now, updatedAt: now,
        };
        const job = {
          orgId: this.orgId, revision: 1, credentialId: parsed.credentialId,
          grantId, deviceId: parsed.deviceId, action: "enroll",
          state: JOB_STATE.QUEUED, executionMode: "test", provider: "mock",
          evidenceScope: "simulated", attempts: 0,
          leaseOwner: null, leaseExpiresAt: null, createdAt: now,
        };
        validateRecord(COLLECTIONS.DEVICE_ACCESS_GRANTS, grantRecord);
        validateRecord(COLLECTIONS.DEVICE_OPERATION_JOBS, job);
        result = { grantId, jobId, evidenceScope: "simulated" };

        return {
          writes: [
            ...domainWrites,
            ...deviceDomainWrites,
            { collection: COLLECTIONS.DEVICE_ACCESS_GRANTS, id: grantId, data: grantRecord },
            { collection: COLLECTIONS.DEVICE_OPERATION_JOBS, id: jobId, data: job },
            {
              collection: COLLECTIONS.DEVICE_CLAIMS, id: claimId,
              data: {
                orgId: this.orgId, deviceId: parsed.deviceId, grantId,
                state: "active", revision: classificationRevision(claim),
                createdAt: claim?.createdAt ?? now, updatedAt: now,
              },
            },
            {
              collection: COLLECTIONS.GRANT_SLOT_CLAIMS, id: slotId,
              data: {
                orgId: this.orgId, grantId, personId: current.personId,
                deviceId: parsed.deviceId, cycleId: parsed.cycleId,
                state: "active", revision: classificationRevision(slot),
                createdAt: slot?.createdAt ?? now, updatedAt: now,
              },
            },
            {
              collection: COLLECTIONS.DEVICE_OPERATION_LOGS, id: logId,
              data: {
                orgId: this.orgId, jobId, state: "queued", action: "enroll",
                actorId: this.actor.actorId, at: now, revision: 1,
              },
            },
            {
              collection: COLLECTIONS.OPERATION_KEYS, id: opKey,
              data: { orgId: this.orgId, realm: op.config.realm, keyVersion: op.config.version, requestDigest, result, createdAt: now },
            },
          ],
          result,
        };
      },
      this.#audit("创建门禁授权"),
    );

    return result;
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
