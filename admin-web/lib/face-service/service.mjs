/**
 * HK-AI-04 服务层（H2-a）。
 *
 * 已实现：submit、review、reviewQueue、queryJob、createGrant（原子授权事务）。
 * 未实现：H2-b 设备 claim 模型、H3 租约派发、H4 撤权闭环；不调用 Provider。
 */
import { createHash } from "node:crypto";

import { failCode } from "../model.mjs";
import {
  COLLECTIONS,
  deterministicLogId,
  deviceClaimKey,
  deviceDigestDomainKey,
  deviceDigestDomainVersionKey,
  digestDomainMatchesDevice,
  ownerClaimMatchesDevice,
  validateAccessDeviceRecord,
  validateOwnerClaimRecord,
  grantSlotKey,
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
import { snapshotEligibility, validateEligibility } from "./eligibility.mjs";
import { prepareGrantEligibility } from "./qualification.mjs";

const ref = (collection, id) => ({ collection, id });
// 预读业务错配必须延迟到事务内权限/operation/credential 检查之后，保持 §6.3
// 的错误优先级；PARAM_ERROR/容量上限仍按 helper 契约在事务前失败关闭。
const DEFERRED_PRE_READ_CODES = new Set([
  "NOT_FOUND", "REVISION_CONFLICT", "SPONSOR_INACTIVE", "IDENTITY_CONFLICT",
]);
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
    if (typeof this.actor.membershipId !== "string" || !this.actor.membershipId) {
      failCode("FORBIDDEN", "组织成员关系已失效或权限不足", 403);
    }
    const membership = await this.store.get(
      "org_memberships", this.actor.membershipId, this.orgId,
    );
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
    if (typeof id !== "string" || !id) return null;
    return this.store.get(collection, id, this.orgId);
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

  #replayValid(existing, op, requestDigest, expected) {
    const plainResult =
      existing?.result && typeof existing.result === "object" && !Array.isArray(existing.result);
    const valid =
      existing?.orgId === this.orgId &&
      existing?.realm === op.config.realm &&
      existing?.keyVersion === op.config.version &&
      Number.isSafeInteger(existing?.createdAt) && existing.createdAt >= 0 &&
      existing?.requestDigest === requestDigest &&
      plainResult &&
      JSON.stringify(stable(existing.result)) === JSON.stringify(stable(expected));
    if (!valid) failCode("CONFLICT", "幂等记录损坏或请求不一致", 409);
    return existing.result;
  }

  #opDomainWrites(state, op, now) {
    return applyOperationKeyDomain(state, {
      realm: op.config.realm, version: op.config.version, fingerprint: op.fingerprint, now,
    });
  }

  /**
   * 事务内 §6.3 第 1 步 a–c：权限、operation/K2、credential/file。
   * 只读检查；合法 replay 仅记录结果，不提前返回。
   */
  #grantScopePre(state, { op, parsed, credential, requestDigest, expected }) {
    const org = state[`organizations/${this.orgId}`];
    const membership = state[`org_memberships/${this.actor.membershipId}`];
    if (!org || org.status !== "active" || !membership || membership.orgId !== this.orgId ||
        membership.status !== "active" ||
        !(membership.permissions || []).includes("device.access.manage")) {
      failCode("FORBIDDEN", "当前成员无权创建门禁授权", 403);
    }
    // 计算但不提交 H2-a domain writes；K2 记录损坏/换钥仍按既有错误失败关闭。
    const domainWrites = this.#opDomainWrites(state, op, this.now());
    const existing = state[`${COLLECTIONS.OPERATION_KEYS}/${op.opKey}`];
    const replayResult = existing
      ? this.#replayValid(existing, op, requestDigest, expected)
      : null;

    const current = state[`${COLLECTIONS.FACE_CREDENTIALS}/${parsed.credentialId}`];
    if (!current || current.orgId !== this.orgId) failCode("NOT_FOUND", "凭证不存在或不可见", 404);
    if (current.reviewState !== REVIEW_STATE.APPROVED) {
      failCode("INVALID_STATE", "凭证尚未审核通过", 409);
    }
    if (current.revision !== parsed.expectedCredentialRevision) {
      failCode("REVISION_CONFLICT", "凭证已被修改，请刷新后重试", 409);
    }
    if (current.personId !== credential.personId) {
      failCode("REVISION_CONFLICT", "凭证人员已变化，请刷新后重试", 409);
    }
    this.files.assertBinding(state, {
      fileId: current.sourceFileId, revision: current.sourceFileRevision,
    });
    return { domainWrites, replayResult, credential: current };
  }

  /** 事务内 §6.3 第 1 步 d：C1 helper 的完整只读资格复核。 */
  #grantQualificationPre(state, request) {
    const verdict = validateEligibility(
      snapshotEligibility(state, request), request, this.now(),
    );
    if (!verdict.eligible) failCode(verdict.code, verdict.message, verdict.status);
    return verdict;
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
    const expected = { credentialId, reviewState: REVIEW_STATE.SUBMITTED };

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
          if (!this.#replayValid(existing, op, requestDigest, expected)) {
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
    const expected = {
      credentialId,
      reviewState: decision === "approved" ? REVIEW_STATE.APPROVED : REVIEW_STATE.REJECTED,
    };
    let result = null;

    await this.store.transact(
      [ref(COLLECTIONS.FACE_CREDENTIALS, credentialId), ref(COLLECTIONS.OPERATION_KEYS, opKey), ...this.#opDomainRefs(op)],
      (state) => {
        const domainWrites = this.#opDomainWrites(state, op, this.now());
        const existing = state[`${COLLECTIONS.OPERATION_KEYS}/${opKey}`];
        if (existing) {
          if (!this.#replayValid(existing, op, requestDigest, expected)) {
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

  // 3. 创建授权（H2-c：完整资格 → 真实黑名单 → H2-b → 核心写集）。
  async createGrant(input, { idempotencyKey } = {}) {
    await this.#require("device.access.manage");
    const parsed = assertCreateGrantInput(input);
    const op = await this.#opContext("face.grant", idempotencyKey);
    const { opKey } = op;
    const requestDigest = digestOf(parsed);

    // 只读预读用于生成 refs 与当次基线；是否放行由事务内 beforeEvaluate 决定。
    const credential = await this.#find(COLLECTIONS.FACE_CREDENTIALS, parsed.credentialId);
    if (!credential) failCode("NOT_FOUND", "凭证不存在或不可见", 404);
    // 设备预读不再提前判定 H2-b；资格/黑名单错误必须先于设备错误。
    const device = await this.#find("access_devices", parsed.deviceId);
    const claimId = typeof device?.claimId === "string" && device.claimId ? device.claimId : null;
    // provider/digestRealm/keyVersion 任一非法时不推导 K1 key，避免在资格/黑名单
    // 之前抛 schema 错误；设备记录自身的问题统一留给事务内 H2-b 复核。
    const domainKeys = device &&
        typeof device.provider === "string" && device.provider &&
        typeof device.digestRealm === "string" && device.digestRealm &&
        Number.isSafeInteger(device.keyVersion) && device.keyVersion >= 1
      ? {
        headId: deviceDigestDomainKey({ provider: device.provider, digestRealm: device.digestRealm }),
        versionId: deviceDigestDomainVersionKey({
          provider: device.provider, digestRealm: device.digestRealm, version: device.keyVersion,
        }),
      }
      : null;
    const slotId = grantSlotKey({
      orgId: this.orgId, personId: credential.personId,
      deviceId: parsed.deviceId, cycleId: parsed.cycleId,
    });
    const grantId = `grant-${digestOf(opKey).slice(0, 24)}`;
    const jobId = `job-${digestOf(opKey + ":enroll").slice(0, 24)}`;
    const logId = deterministicLogId(jobId, "queued");
    const expected = { grantId, jobId, evidenceScope: "simulated" };
    const baseRefs = [
      ref(COLLECTIONS.FACE_CREDENTIALS, parsed.credentialId),
      ref("file_assets", credential.sourceFileId),
      ref("organizations", this.orgId),
      ref("org_memberships", this.actor.membershipId),
      ref("access_devices", parsed.deviceId),
      ...(claimId ? [ref(COLLECTIONS.DEVICE_CLAIMS, claimId)] : []),
      ...(domainKeys ? [
        ref(COLLECTIONS.DEVICE_DIGEST_DOMAINS, domainKeys.headId),
        ref(COLLECTIONS.DEVICE_DIGEST_DOMAINS, domainKeys.versionId),
      ] : []),
      ref(COLLECTIONS.GRANT_SLOT_CLAIMS, slotId),
      ref(COLLECTIONS.DEVICE_ACCESS_GRANTS, grantId),
      ref(COLLECTIONS.DEVICE_OPERATION_JOBS, jobId),
      ref(COLLECTIONS.DEVICE_OPERATION_LOGS, logId),
      ref(COLLECTIONS.OPERATION_KEYS, opKey),
      ...this.#opDomainRefs(op),
    ];
    let result = null;

    await this.blacklist.withEligibility(
      {
        personId: credential.personId,
        occupancyId: parsed.occupancyId,
        identityApplicationId: parsed.identityApplicationId,
        restriction: "occupancy.activate",
      },
      baseRefs,
      (state, eligibility, pre) => {
        if (pre.replayResult !== null) {
          result = pre.replayResult;
          return { writes: [], result };
        }
        if (!eligibility?.eligible) {
          const code = eligibility?.code || "BLACKLIST_DENIED";
          failCode(code, "资格不满足，无法创建门禁授权", code === "BLACKLIST_DENIED" ? 403 : 409);
        }

        // §6.3 第 3 步：H2-b device/K1/owner claim/slot 只读复核。
        const dev = state[`access_devices/${parsed.deviceId}`];
        if (!dev || dev.orgId !== this.orgId) failCode("NOT_FOUND", "设备不存在或不可见", 404);
        try {
          validateAccessDeviceRecord(dev);
        } catch {
          failCode("DEVICE_CLAIM_INVALID", "设备缺少有效的 owner claim 绑定", 409);
        }
        if (!device) failCode("NOT_FOUND", "设备不存在或不可见", 404);
        const sameSnapshot =
          dev.revision === device.revision && dev.claimId === device.claimId &&
          dev.ownerOrgId === device.ownerOrgId && dev.provider === device.provider &&
          dev.digestRealm === device.digestRealm && dev.keyVersion === device.keyVersion &&
          dev.status === device.status && dev.capabilities?.face === device.capabilities?.face;
        if (!sameSnapshot) failCode("DEVICE_CLAIM_INVALID", "设备快照已变化，请刷新后重试", 409);
        if (dev.ownerOrgId !== this.orgId || dev.orgId !== this.orgId) {
          failCode("DEVICE_CLAIM_CONFLICT", "设备归属冲突", 409);
        }
        if (dev.status !== "active" || dev.capabilities?.face !== true) {
          failCode("INVALID_STATE", "设备不可用或未启用人脸能力", 409);
        }
        if (!claimId || !domainKeys) {
          failCode("DEVICE_CLAIM_INVALID", "设备缺少有效的 owner claim 绑定", 409);
        }

        const head = state[`${COLLECTIONS.DEVICE_DIGEST_DOMAINS}/${domainKeys.headId}`];
        const versionRecord = state[`${COLLECTIONS.DEVICE_DIGEST_DOMAINS}/${domainKeys.versionId}`];
        const domainMatch = digestDomainMatchesDevice(head, versionRecord, {
          provider: dev.provider, digestRealm: dev.digestRealm, keyVersion: dev.keyVersion,
        });
        if (!domainMatch.ok) failCode(domainMatch.code, "K1 domain 缺失、损坏或与设备配置不一致", 503);

        const claim = state[`${COLLECTIONS.DEVICE_CLAIMS}/${claimId}`];
        if (!claim) failCode("DEVICE_CLAIM_INVALID", "设备缺少 owner claim", 409);
        try {
          validateOwnerClaimRecord(claim);
        } catch {
          failCode("DEVICE_CLAIM_INVALID", "owner claim 记录损坏", 409);
        }
        if (claim.state !== "active") failCode("DEVICE_CLAIM_INVALID", "owner claim 非 active", 409);
        if (claim.ownerOrgId !== this.orgId) failCode("DEVICE_CLAIM_CONFLICT", "设备归属冲突", 409);
        if (!ownerClaimMatchesDevice(claim, dev, parsed.deviceId)) {
          failCode("DEVICE_CLAIM_INVALID", "设备与 owner claim 引用不一致", 409);
        }

        const slot = state[`${COLLECTIONS.GRANT_SLOT_CLAIMS}/${slotId}`];
        if (slot) failCode("GRANT_SLOT_CONFLICT", "授权槽位冲突", 409);

        const now = this.now();
        const personId = pre.credential.personId;
        const grantRecord = {
          orgId: this.orgId, revision: 1, credentialId: parsed.credentialId,
          personId, deviceId: parsed.deviceId,
          occupancyId: parsed.occupancyId, cycleId: parsed.cycleId,
          claimId, slotId,
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
            ...pre.domainWrites,
            { collection: COLLECTIONS.DEVICE_ACCESS_GRANTS, id: grantId, data: grantRecord },
            { collection: COLLECTIONS.DEVICE_OPERATION_JOBS, id: jobId, data: job },
            {
              collection: COLLECTIONS.GRANT_SLOT_CLAIMS, id: slotId,
              data: {
                orgId: this.orgId, personId, deviceId: parsed.deviceId,
                cycleId: parsed.cycleId, activeClaimId: grantId, state: "active",
                revision: 1, createdAt: now, updatedAt: now, activatedAt: now,
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
              data: {
                orgId: this.orgId, realm: op.config.realm, keyVersion: op.config.version,
                requestDigest, result, createdAt: now,
              },
            },
          ],
          result,
        };
      },
      this.#audit("创建门禁授权"),
      {
        // 真实 blacklist 预读若在事务前失败（例如并发撤权同时删除 person），
        // 必须等事务内权限/operation/credential/资格检查完成后再抛出。
        deferPrepareError: true,
        // C2 钩子：每次 attempt 重新预读资格基线；事务内先做权限/operation/
        // credential/file/资格，再交给真实 evaluateEligibility 判决。
        prepareAttempt: async () => {
          let planned = null;
          let deferredError = null;
          try {
            planned = await prepareGrantEligibility(this.store, {
              orgId: this.orgId,
              personId: credential.personId,
              occupancyId: parsed.occupancyId,
              cycleId: parsed.cycleId,
              identityApplicationId: parsed.identityApplicationId,
              validFrom: parsed.validFrom,
              validUntil: parsed.validUntil,
              baseRefs,
            });
          } catch (error) {
            if (!DEFERRED_PRE_READ_CODES.has(error?.code)) throw error;
            deferredError = error;
          }
          return {
            refs: planned?.refs ?? [],
            beforeEvaluate: (state) => {
              const scope = this.#grantScopePre(state, {
                op, parsed, credential, requestDigest, expected,
              });
              if (deferredError) throw deferredError;
              return {
                ...scope,
                qualification: this.#grantQualificationPre(state, planned.request),
              };
            },
          };
        },
      },
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
