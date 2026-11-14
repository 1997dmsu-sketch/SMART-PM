/**
 * HK-AI-04 服务层（H2-a）。
 *
 * 已实现：H2 createGrant、H3-a 合成派发快照、H4-a 立即业务撤权。
 * 未实现：H4-b 清理派发与本地 finalize；本服务不调用 Provider。
 */
import { createHash } from "node:crypto";

import { failCode } from "../model.mjs";
import { LocalStore } from "../store.mjs";
import {
  COLLECTIONS,
  assertBoundedId,
  assertSafeInt,
  deterministicLogId,
  deviceClaimKey,
  deviceDigestDomainKey,
  deviceDigestDomainVersionKey,
  deviceClaimReleaseGuardKey,
  digestDomainMatchesDevice,
  ownerClaimMatchesDevice,
  validateAccessDeviceRecord,
  validateOwnerClaimRecord,
  validateDeviceClaimReleaseGuard,
  validateGrantSlotRecord,
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
  publicReviewItem,
} from "./dto.mjs";
import { snapshotEligibility, validateEligibility } from "./eligibility.mjs";
import { prepareGrantEligibility } from "./qualification.mjs";
import { createDispatchSnapshot, validateDispatchJob } from "./h3a.mjs";

const ref = (collection, id) => ({ collection, id });
// 预读业务错配必须延迟到事务内权限/operation/credential 检查之后，保持 §6.3
// 的错误优先级；PARAM_ERROR/容量上限仍按 helper 契约在事务前失败关闭。
const DEFERRED_PRE_READ_CODES = new Set([
  "NOT_FOUND", "REVISION_CONFLICT", "SPONSOR_INACTIVE", "IDENTITY_CONFLICT",
]);
const classificationRevision = (record) => (Number.isInteger(record?.revision) ? record.revision + 1 : 1);
const stable = (value) => (Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])])) : value);
const digestOf = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const CLEANUP_FIELDS = new Set(["schemaVersion","grantId","grantRevision","credentialId","credentialRevision","deviceId","deviceRevision","claimId","claimRevision","slotId","slotRevision","releaseGuardId","releaseGuardRevision","releaseGuardEpoch","originalGrantState","createdAt"]);
function validateCleanupSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1 ||
      Object.keys(value).some((key) => !CLEANUP_FIELDS.has(key))) failCode("CLEANUP_SNAPSHOT_REQUIRED", "清理快照结构非法", 409);
  try {
    for (const field of ["grantId","credentialId","deviceId","claimId","slotId","releaseGuardId"]) assertBoundedId(value[field], field);
    for (const field of ["grantRevision","credentialRevision","deviceRevision","claimRevision","slotRevision","releaseGuardRevision","releaseGuardEpoch"]) assertSafeInt(value[field], field, { min: 1 });
    assertSafeInt(value.createdAt, "createdAt");
  } catch { failCode("CLEANUP_SNAPSHOT_REQUIRED", "清理快照字段非法", 409); }
  if (![GRANT_STATE.PENDING,GRANT_STATE.EFFECTIVE,GRANT_STATE.SUSPENDED,GRANT_STATE.EXPIRED].includes(value.originalGrantState) || Buffer.byteLength(JSON.stringify(value)) > 4096) failCode("CLEANUP_SNAPSHOT_REQUIRED", "清理快照非法或超限", 409);
  return value;
}

const QUERY_JOB_STATES = new Set(Object.values(JOB_STATE));

/**
 * HK-AI-07B 公开 failureReason 的唯一权威值集。
 * 冻结契约只定义 `string | null`（截断 120），且明确 H3/H4 job 恒为 null；
 * 没有完整、明确批准的公开枚举，内部 reasonCode、Provider 原始错误、
 * message/stack 均禁止提升为公开值，因此当前为空集，公开投影固定 null。
 * 未来若冻结公开枚举，只在此 Set 增加，测试直接复用，不维护并行列表。
 */
export const PUBLIC_JOB_FAILURE_REASONS = new Set();

/**
 * HK-AI-07B：queryJob 的唯一权威 revision 读模型。
 * 精确六字段；记录任一字段非法即 INVALID_JOB/409 失败关闭，不部分返回、不默认、不转换。
 */
function queryJobDto(job, jobId) {
  let recordId;
  try {
    recordId = assertBoundedId(job._id, "_id");
    if (job.jobId !== undefined) assertBoundedId(job.jobId, "jobId");
  } catch {
    failCode("INVALID_JOB", "任务记录 ID 非法", 409);
  }
  if (recordId !== jobId || (job.jobId !== undefined && job.jobId !== recordId)) {
    failCode("INVALID_JOB", "任务记录 ID 与查询目标不一致", 409);
  }
  if (!QUERY_JOB_STATES.has(job.state)) failCode("INVALID_JOB", "任务状态非法", 409);
  if (!Number.isSafeInteger(job.revision) || job.revision < 1) {
    failCode("INVALID_JOB", "任务 revision 非法", 409);
  }
  // attempts/lastSuccessAt 保留冻结契约的缺省（?? 0 / ?? null）；存在值必须严格合法。
  const attempts = job.attempts ?? 0;
  if (!Number.isSafeInteger(attempts) || attempts < 0) {
    failCode("INVALID_JOB", "任务 attempts 非法", 409);
  }
  const lastSuccessAt = job.lastSuccessAt ?? null;
  if (lastSuccessAt !== null && (!Number.isSafeInteger(lastSuccessAt) || lastSuccessAt < 0)) {
    failCode("INVALID_JOB", "任务 lastSuccessAt 非法", 409);
  }
  const failureReason = job.failureReason ?? null;
  if (failureReason !== null && !PUBLIC_JOB_FAILURE_REASONS.has(failureReason)) {
    failCode("INVALID_JOB", "任务 failureReason 非法", 409);
  }
  return {
    jobId: recordId,
    state: job.state,
    revision: job.revision,
    attempts,
    lastSuccessAt,
    failureReason,
  };
}

export class FaceCredentialService {
  constructor({ store, orgId, actor, files, blacklist, provider, now = () => Date.now(), syntheticDispatch = false }) {
    this.store = store;
    this.orgId = orgId;
    this.actor = actor;
    this.files = files;
    this.blacklist = blacklist;
    this.provider = provider;
    this.now = now;
    if (syntheticDispatch === true && !(store instanceof LocalStore)) {
      failCode("NOT_CONFIGURED", "H3 合成快照仅支持 LocalStore 测试模式", 503);
    }
    this.syntheticDispatch = syntheticDispatch === true;
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
    let releaseGuardId = null;
    if (claimId) {
      try {
        releaseGuardId = deviceClaimReleaseGuardKey({ orgId: this.orgId, claimId });
      } catch {
        // 设备 schema 错误必须留在事务内、资格与黑名单之后按 H2-b 失败关闭。
      }
    }
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
      ...(releaseGuardId ? [ref(COLLECTIONS.DEVICE_CLAIM_RELEASE_GUARDS, releaseGuardId)] : []),
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
        // C4 D75：适配器丢弃 prepareAttempt 时 build 不能以 TypeError 泄露，
        // 必须按契约返回 ADAPTER_UNAVAILABLE/503；正常上下文形状也在此收紧。
        if (!pre || typeof pre !== "object" || !pre.credential ||
            !Array.isArray(pre.domainWrites) ||
            !Array.isArray(pre.guardHistoricIds) ||
            typeof pre.guardWasPresent !== "boolean" ||
            !Object.hasOwn(pre, "replayResult") ||
            (pre.replayResult !== null && typeof pre.replayResult !== "object")) {
          failCode("ADAPTER_UNAVAILABLE", "资格准备上下文缺失或无效", 503);
        }
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
        if (!claimId || !domainKeys || !releaseGuardId) {
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

        const guardKey = `${COLLECTIONS.DEVICE_CLAIM_RELEASE_GUARDS}/${releaseGuardId}`;
        const releaseGuard = state[guardKey];
        let guardRecord;
        if (releaseGuard) {
          const normalizedGuard = Object.hasOwn(releaseGuard, "_id")
            ? releaseGuard
            : { ...releaseGuard, _id: releaseGuardId };
          try {
            validateDeviceClaimReleaseGuard(normalizedGuard);
          } catch {
            failCode("CLAIM_RELEASE_GUARD_REQUIRED", "设备 claim release guard 损坏", 409);
          }
          if (normalizedGuard.orgId !== this.orgId || normalizedGuard.claimId !== claimId ||
              normalizedGuard.epoch === Number.MAX_SAFE_INTEGER ||
              normalizedGuard.revision === Number.MAX_SAFE_INTEGER) {
            failCode("CLAIM_RELEASE_GUARD_REQUIRED", "设备 claim release guard 不可用", 409);
          }
          guardRecord = {
            ...normalizedGuard,
            epoch: normalizedGuard.epoch + 1,
            revision: normalizedGuard.revision + 1,
            updatedAt: this.now(),
          };
        } else {
          if (pre.guardWasPresent) {
            failCode("CLAIM_RELEASE_GUARD_REQUIRED", "设备 claim release guard 已消失", 409);
          }
          const historic = pre.guardHistoricIds.map((id) =>
            state[`${COLLECTIONS.DEVICE_ACCESS_GRANTS}/${id}`]);
          if (historic.some((record) => !record || record.orgId !== this.orgId || record.claimId !== claimId)) {
            failCode("CLAIM_RELEASE_GUARD_REQUIRED", "历史授权缺少 claim release guard", 409);
          }
          if (historic.length) {
            failCode("CLAIM_RELEASE_GUARD_REQUIRED", "历史授权缺少 claim release guard", 409);
          }
          const guardNow = this.now();
          guardRecord = {
            _id: releaseGuardId, orgId: this.orgId, claimId,
            epoch: 1, revision: 1, createdAt: guardNow, updatedAt: guardNow,
          };
        }
        validateDeviceClaimReleaseGuard(guardRecord);

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
        const slotRecord = {
          orgId: this.orgId, personId, deviceId: parsed.deviceId,
          cycleId: parsed.cycleId, activeClaimId: grantId, state: "active",
          revision: 1, createdAt: now, updatedAt: now, activatedAt: now,
        };
        if (this.syntheticDispatch) {
          Object.assign(job, {
            dispatchSnapshot: createDispatchSnapshot({
              now, actor: this.actor, request: pre.dispatchRequest, state,
              refs: pre.dispatchRefs, credential: pre.credential,
              fileId: pre.credential.sourceFileId, claimId, slotId,
              domainHeadId: domainKeys.headId, domainVersionId: domainKeys.versionId,
              grantRecord, grantId, slotRecord,
            }),
            leaseGeneration: 0, dispatchAuthorizedAt: null, nextAttemptAt: null,
            result: null, updatedAt: now,
          });
          validateDispatchJob({ ...job, _id: jobId });
        }
        validateRecord(COLLECTIONS.DEVICE_ACCESS_GRANTS, grantRecord);
        validateRecord(COLLECTIONS.DEVICE_OPERATION_JOBS, job);
        result = { grantId, jobId, evidenceScope: "simulated" };

        return {
          writes: [
            ...pre.domainWrites,
            {
              collection: COLLECTIONS.DEVICE_CLAIM_RELEASE_GUARDS,
              id: releaseGuardId,
              data: guardRecord,
            },
            { collection: COLLECTIONS.DEVICE_ACCESS_GRANTS, id: grantId, data: grantRecord },
            { collection: COLLECTIONS.DEVICE_OPERATION_JOBS, id: jobId, data: job },
            {
              collection: COLLECTIONS.GRANT_SLOT_CLAIMS, id: slotId,
              data: slotRecord,
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
        // D75：以 token 对象身份绑定 prepareAttempt 与 beforeEvaluate；同一 attempt
        // 的事务 callback 可被 SDK 重跑，跨 attempt 复用旧 hook 会收到新 token 并失败关闭。
        prepareAttempt: async (token) => {
          const boundToken = token;
          let planned = null;
          let deferredError = null;
          try {
            let guardHistoricIds = [];
            let guardWasPresent = false;
            if (releaseGuardId) {
              const guard = await this.store.get(
                COLLECTIONS.DEVICE_CLAIM_RELEASE_GUARDS, releaseGuardId, this.orgId,
              );
              guardWasPresent = Boolean(guard);
              if (!guardWasPresent) {
                guardHistoricIds = (await this.store.list(
                  COLLECTIONS.DEVICE_ACCESS_GRANTS, this.orgId,
                )).filter((item) => item.claimId === claimId).map((item) => item._id).sort();
              }
            }
            const attemptBaseRefs = [
              ...baseRefs,
              ...guardHistoricIds.map((id) => ref(COLLECTIONS.DEVICE_ACCESS_GRANTS, id)),
            ];
            planned = await prepareGrantEligibility(this.store, {
              orgId: this.orgId,
              personId: credential.personId,
              occupancyId: parsed.occupancyId,
              cycleId: parsed.cycleId,
              identityApplicationId: parsed.identityApplicationId,
              validFrom: parsed.validFrom,
              validUntil: parsed.validUntil,
              baseRefs: attemptBaseRefs,
            });
            planned.guardHistoricIds = guardHistoricIds;
            planned.guardWasPresent = guardWasPresent;
          } catch (error) {
            if (!DEFERRED_PRE_READ_CODES.has(error?.code)) throw error;
            deferredError = error;
          }
          return {
            refs: planned?.refs ?? [],
            beforeEvaluate: (state, currentToken) => {
              const scope = this.#grantScopePre(state, {
                op, parsed, credential, requestDigest, expected,
              });
              if (currentToken !== boundToken) {
                failCode("ADAPTER_UNAVAILABLE", "资格准备上下文与当前 token 不一致", 503);
              }
              if (deferredError) throw deferredError;
              return {
                ...scope,
                guardHistoricIds: planned.guardHistoricIds,
                guardWasPresent: planned.guardWasPresent,
                qualification: this.#grantQualificationPre(state, planned.request),
                dispatchRequest: planned.request,
                dispatchRefs: planned.refs,
              };
            },
          };
        },
      },
    );

    return result;
  }

  // 4. H4-a：立即业务撤权；只建清理任务，不调用 Provider。
  async revoke(grantId, { idempotencyKey } = {}) {
    await this.#require("device.access.manage");
    try { assertBoundedId(grantId, "grantId"); } catch { failCode("PARAM_ERROR", "grantId 非法", 400); }
    const op = await this.#opContext("face.revoke", idempotencyKey);
    const requestDigest = digestOf({ grantId });
    const jobId = `job-revoke-v1:${digestOf([this.orgId, grantId])}`;
    const logId = deterministicLogId(jobId, "queued");
    const auditId = `audit-h4-v1:${digestOf([this.orgId, jobId, "queue", 1])}`;
    const expected = { grantId, jobId, grantState: "revoked", cleanupPending: true, evidenceScope: "simulated" };
    const grant = await this.#find(COLLECTIONS.DEVICE_ACCESS_GRANTS, grantId);
    if (!grant) failCode("NOT_FOUND", "授权不存在或不可见", 404);
    let guardId;
    try {
      guardId = deviceClaimReleaseGuardKey({ orgId: this.orgId, claimId: grant.claimId });
      for (const value of [grant.credentialId, grant.deviceId, grant.claimId, grant.slotId]) assertBoundedId(value, "bindingId");
    } catch { failCode("CLEANUP_SNAPSHOT_REQUIRED", "授权缺少清理绑定", 409); }
    const refs = [
      ref("organizations", this.orgId), ref("org_memberships", this.actor.membershipId),
      ...this.#opDomainRefs(op), ref(COLLECTIONS.OPERATION_KEYS, op.opKey),
      ref(COLLECTIONS.DEVICE_ACCESS_GRANTS, grantId), ref(COLLECTIONS.DEVICE_OPERATION_JOBS, jobId),
      ref(COLLECTIONS.DEVICE_OPERATION_LOGS, logId), ref(COLLECTIONS.FACE_CREDENTIALS, grant.credentialId),
      ref("access_devices", grant.deviceId), ref(COLLECTIONS.DEVICE_CLAIMS, grant.claimId),
      ref(COLLECTIONS.GRANT_SLOT_CLAIMS, grant.slotId), ref(COLLECTIONS.DEVICE_CLAIM_RELEASE_GUARDS, guardId),
      ref("admin_audit", auditId),
    ];
    let result;
    await this.store.transact(refs, (state) => {
      const org = state[`organizations/${this.orgId}`];
      const member = state[`org_memberships/${this.actor.membershipId}`];
      if (!org || org.status !== "active" || !member || member.orgId !== this.orgId || member.status !== "active" || !(member.permissions || []).includes("device.access.manage")) failCode("FORBIDDEN", "当前成员无权撤销门禁授权", 403);
      const domainWrites = this.#opDomainWrites(state, op, this.now());
      const existing = state[`${COLLECTIONS.OPERATION_KEYS}/${op.opKey}`];
      if (existing) { result = this.#replayValid(existing, op, requestDigest, expected); return []; }
      const current = state[`${COLLECTIONS.DEVICE_ACCESS_GRANTS}/${grantId}`];
      if (!current || current.orgId !== this.orgId) failCode("NOT_FOUND", "授权不存在或不可见", 404);
      if (![GRANT_STATE.PENDING,GRANT_STATE.EFFECTIVE,GRANT_STATE.SUSPENDED,GRANT_STATE.EXPIRED].includes(current.state)) failCode("INVALID_STATE", "授权状态不允许撤销", 409);
      if (current.revision !== grant.revision || ["credentialId","deviceId","claimId","slotId"].some((field) => current[field] !== grant[field])) failCode("REVISION_CONFLICT", "授权已变化", 409);
      try { assertSafeInt(current.revision, "grant.revision", { min: 1 }); } catch { failCode("INVALID_STATE", "授权版本非法", 409); }
      if (current.revision === Number.MAX_SAFE_INTEGER) failCode("INVALID_STATE", "授权版本溢出", 409);
      const credential = state[`${COLLECTIONS.FACE_CREDENTIALS}/${current.credentialId}`];
      const device = state[`access_devices/${current.deviceId}`];
      const claim = state[`${COLLECTIONS.DEVICE_CLAIMS}/${current.claimId}`];
      const slot = state[`${COLLECTIONS.GRANT_SLOT_CLAIMS}/${current.slotId}`];
      const guard = state[`${COLLECTIONS.DEVICE_CLAIM_RELEASE_GUARDS}/${guardId}`];
      if (!credential || credential.orgId !== this.orgId || !device || !claim || !slot || !guard) failCode("CLEANUP_SNAPSHOT_REQUIRED", "清理绑定缺失", 409);
      try {
        validateAccessDeviceRecord(device); validateOwnerClaimRecord(claim); validateGrantSlotRecord(slot);
        validateDeviceClaimReleaseGuard(Object.hasOwn(guard,"_id") ? guard : { ...guard, _id: guardId });
        for (const record of [credential,device,claim,slot,guard]) assertSafeInt(record.revision, "revision", { min: 1 });
      } catch { failCode("CLEANUP_SNAPSHOT_REQUIRED", "清理绑定损坏", 409); }
      if (credential.personId !== current.personId ||
          device.orgId !== this.orgId || device.claimId !== current.claimId ||
          claim.ownerOrgId !== this.orgId || claim.state !== "active" ||
          !ownerClaimMatchesDevice(claim, device, current.deviceId) ||
          slot.orgId !== this.orgId || slot.personId !== current.personId ||
          slot.deviceId !== current.deviceId || slot.cycleId !== current.cycleId ||
          slot.activeClaimId !== grantId || slot.state !== "active" ||
          guard.orgId !== this.orgId || guard.claimId !== current.claimId) {
        failCode("CLEANUP_SNAPSHOT_REQUIRED", "清理绑定不一致", 409);
      }
      if (state[`${COLLECTIONS.DEVICE_OPERATION_JOBS}/${jobId}`] || state[`${COLLECTIONS.DEVICE_OPERATION_LOGS}/${logId}`]) failCode("CONFLICT", "清理任务或日志已存在", 409);
      const now = this.now();
      try { assertSafeInt(now, "now"); } catch { failCode("INVALID_STATE", "当前时间非法", 409); }
      const cleanupSnapshot = validateCleanupSnapshot({ schemaVersion:1, grantId, grantRevision:current.revision, credentialId:current.credentialId, credentialRevision:credential.revision, deviceId:current.deviceId, deviceRevision:device.revision, claimId:current.claimId, claimRevision:claim.revision, slotId:current.slotId, slotRevision:slot.revision, releaseGuardId:guardId, releaseGuardRevision:guard.revision, releaseGuardEpoch:guard.epoch, originalGrantState:current.state, createdAt:now });
      const nextGrant = { ...current, state:GRANT_STATE.REVOKED, cleanupPending:true, cleanupJobId:jobId, revokedAt:now, revokedByActorId:this.actor.actorId, revision:current.revision+1, updatedAt:now };
      const job = { orgId:this.orgId, revision:1, credentialId:current.credentialId, grantId, deviceId:current.deviceId, action:"revoke", state:JOB_STATE.QUEUED, executionMode:"test", provider:"mock", evidenceScope:"simulated", attempts:0, leaseGeneration:0, leaseOwner:null, leaseExpiresAt:null, dispatchAuthorizedAt:null, nextAttemptAt:null, result:null, cleanupPhase:"dispatch", providerOutcome:null, finalizeAttempts:0, cleanupSnapshot, createdAt:now, updatedAt:now };
      validateRecord(COLLECTIONS.DEVICE_ACCESS_GRANTS,nextGrant); validateRecord(COLLECTIONS.DEVICE_OPERATION_JOBS,job);
      result = expected;
      return [...domainWrites,
        {collection:COLLECTIONS.DEVICE_ACCESS_GRANTS,id:grantId,data:nextGrant},
        {collection:COLLECTIONS.DEVICE_OPERATION_JOBS,id:jobId,data:job},
        {collection:COLLECTIONS.DEVICE_OPERATION_LOGS,id:logId,data:{orgId:this.orgId,jobId,state:"queued",action:"revoke",actorId:this.actor.actorId,at:now,revision:1}},
        {collection:COLLECTIONS.OPERATION_KEYS,id:op.opKey,data:{orgId:this.orgId,realm:op.config.realm,keyVersion:op.config.version,requestDigest,result,createdAt:now}},
      ];
    }, { auditId, orgId:this.orgId, actorId:this.actor.actorId, actorType:this.actor.actorType || "user", action:"撤销门禁授权" });
    return result;
  }

  // 5. 查询任务：org 内最小 DTO；revision 为唯一权威读模型（HK-AI-07B）。
  async queryJob(jobId) {
    await this.#require("device.audit.read");
    const job = await this.#find(COLLECTIONS.DEVICE_OPERATION_JOBS, jobId);
    if (!job) failCode("NOT_FOUND", "任务不存在或不可见", 404);
    return queryJobDto(job, jobId);
  }


}
