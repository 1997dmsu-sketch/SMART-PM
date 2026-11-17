/**
 * HK-AI-07D G2 严格人工 retry 服务（E07，独立模块）。
 *
 * 设计依据：docs/tasks/HK-AI-07D-RETRY-REQUEUE-DESIGN-2026-11-15.md §0/§3/§4/附录 A。
 * 本模块只做服务层：不注册 HTTP、不调用 Provider、不改任何现有生产文件。
 * 冻结契约：
 *  - 成功固定 queued，attempts 不增，Provider 恒 0；
 *  - 合法重放先复核权限/K2/audit，命中即零写返回（含不新增 audit）；
 *  - 回执绑定 expectedJobRevision + 1；
 *  - 存储元数据（_id/updatedAt）与语义字段分离校验；
 *  - 零写分支不触碰 Store、不新增 log/audit/op key/domain。
 */
import { createHash } from "node:crypto";

import { failCode } from "../model.mjs";
import {
  COLLECTIONS,
  deterministicLogId,
  applyOperationKeyDomain,
  operationKey,
  operationKeyConfig,
  operationKeyDomainIds,
  operationKeyFingerprint,
  assertIdempotencyKey,
} from "./collections.mjs";
import { LocalStore } from "../store.mjs";
import { validateDispatchJob } from "./h3a.mjs";
import { validateRevokeJob } from "./h4b.mjs";

const REQ_METHOD = "face.operation.retry";
const AUDIT_ACTION = "HK-AI-07D retry";
const RETRY_PERMISSION = "device.operation.retry";
const JOBS = COLLECTIONS.DEVICE_OPERATION_JOBS;
const LOGS = COLLECTIONS.DEVICE_OPERATION_LOGS;
const OP_KEYS = COLLECTIONS.OPERATION_KEYS;
const DOMAINS = COLLECTIONS.OPERATION_KEY_DOMAINS;
const RECEIPT_FIELDS = ["jobId", "state", "revision", "attempts", "nextAttemptAt"];
const LOG_FIELDS = new Set([
  "orgId", "jobId", "action", "fromState", "state", "actorType", "actorId", "at",
  "revision", "attempt", "leaseGeneration", "evidenceScope", "errorKind", "reasonCode", "alertCode",
]);

const ref = (collection, id) => ({ collection, id });
const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]))
      : value;
const digestOf = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

// 语义字段精确校验：忽略 Store 注入的 _id/updatedAt，但不忽略任何语义字段的增缺。
function exactSemanticFields(record, fields, label) {
  if (!record || typeof record !== "object" || Array.isArray(record))
    failCode("CONFLICT", `${label}损坏`, 409);
  const semantic = Object.keys(record).filter((k) => k !== "_id" && k !== "updatedAt");
  const allowed = fields instanceof Set ? fields : new Set(fields);
  if (semantic.length !== allowed.size || semantic.some((k) => !allowed.has(k)))
    failCode("CONFLICT", `${label}损坏`, 409);
}

// 冻结错误：全部使用既有码，消息为固定短语，不含存在性/org/设备/内部字段。
function invalidJob() { failCode("INVALID_JOB", "任务当前不可重试", 409); }
function invalidState() { failCode("INVALID_STATE", "任务当前不可重试", 409); }
function conflict() { failCode("CONFLICT", "请求与既有记录不一致", 409); }

// §4.9.3 audit.target 精确配对校验：target 是成功写集引用的有序 join(", ")，
// 写集顺序固定为 [...domainWrites(head,version 或空), job, log, opKey]。
// 合法形态仅两种：3 条（domain 已存在、零 domain 写）或 5 条（新建 head+version）。
// 不接受伪造前后缀、缺项、多余项、乱序或重复——includes() 子串判断无法满足此约束。
function assertAuditTarget(target, { jobRef, logRef, opKeyRef, headRef, versionRef }) {
  if (typeof target !== "string") conflict();
  const refs = target.split(", ");
  const core = [jobRef, logRef, opKeyRef];
  const withDomain = [headRef, versionRef, ...core];
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (!same(refs, core) && !same(refs, withDomain)) conflict();
}

// 合法回执校验（§4.4 严格重放 + §4.9.1 五字段）：绑定 expectedJobRevision+1。
// now 用于 nextAttemptAt 上限校验；revision 上限与成功路径 CAS 溢出门禁一致。
function assertReceipt(result, { jobId, expectedJobRevision }, now) {
  // 回执是嵌套在 op key.result 内的快照，存储元数据不属于它的五字段；
  // exactSemanticFields 的全局 _id/updatedAt 过滤只适用于外层记录，必须在嵌套回执前拦截。
  // 按键是否存在判断：显式写入的 `_id: undefined` / `updatedAt: undefined` 也必须拒绝。
  if (result && typeof result === "object" && !Array.isArray(result) &&
      (Object.hasOwn(result, "_id") || Object.hasOwn(result, "updatedAt"))) conflict();
  exactSemanticFields(result, RECEIPT_FIELDS, "幂等回执");
  if (result.jobId !== jobId) conflict();
  if (result.state !== "queued") conflict();
  if (!Number.isSafeInteger(result.revision) ||
      result.revision > Number.MAX_SAFE_INTEGER - 2) conflict();
  if (result.revision !== expectedJobRevision + 1) conflict();
  if (!Number.isSafeInteger(result.attempts) || result.attempts < 1 || result.attempts > 3) conflict();
  if (result.nextAttemptAt !== null &&
      (!Number.isSafeInteger(result.nextAttemptAt) ||
       result.nextAttemptAt < 0 || result.nextAttemptAt > now)) conflict();
  return { jobId: result.jobId, state: "queued", revision: result.revision,
    attempts: result.attempts, nextAttemptAt: result.nextAttemptAt };
}

// 校验合法重放：先复核 org/realm/version/createdAt/requestDigest，再验回执五字段。
function validReplay(existing, op, requestDigest, identity, now) {
  // §4.4/§4.9.4：op key 记录精确六字段；多字段/少字段一律失败关闭，不因重放而放宽。
  exactSemanticFields(existing,
    ["orgId", "realm", "keyVersion", "requestDigest", "result", "createdAt"],
    "operation key 记录");
  const plain = existing?.result && typeof existing.result === "object" && !Array.isArray(existing.result);
  const bound =
    existing?.orgId === op.orgId &&
    existing?.realm === op.config.realm &&
    existing?.keyVersion === op.config.version &&
    Number.isSafeInteger(existing?.createdAt) && existing.createdAt >= 0 &&
    existing?.requestDigest === requestDigest && plain;
  if (!bound) conflict();
  return assertReceipt(existing.result, identity, now);
}

// 唯一合法前置的状态/分类/预算门禁（§4.1 + §4.2）。状态门禁先于形状校验。
function stateGate(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) invalidJob();
  const s = job.state;
  if (["queued", "sending", "succeeded", "terminal_failed", "cancelled"].includes(s)) invalidState();
  if (s === "awaiting_result") invalidJob();
  if (s !== "retryable_failed") invalidJob();
}

// 形状相关门禁（§4.1 第 2/3/4/6 条）——在 validator 之后按冻结顺序执行。
function shapeGate(job, { now, expectedJobRevision }) {
  const enroll = job.action === "enroll";
  const revoke = job.action === "revoke";
  if (!enroll && !revoke) invalidJob();
  if (revoke && job.cleanupPhase !== "dispatch") invalidState();
  const result = job.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) invalidJob();
  exactSemanticFields(result, ["attempt", "outcome", "errorKind", "reasonCode", "finishedAt"], "任务结果");
  if (result.outcome !== "retryable_failed" || result.errorKind !== "RETRYABLE") invalidJob();
  if (!Number.isSafeInteger(result.attempt) || result.attempt !== job.attempts) invalidJob();
  if (!Number.isSafeInteger(result.finishedAt) || result.finishedAt < 0) invalidJob();
  if (!Number.isSafeInteger(job.attempts) || job.attempts < 1 || job.attempts >= 4) invalidJob();
  if (!Number.isSafeInteger(job.nextAttemptAt) || job.nextAttemptAt < 0) invalidJob();
  if (job.leaseOwner !== null || job.leaseExpiresAt !== null || job.dispatchAuthorizedAt !== null) invalidJob();
  if (job.revision !== expectedJobRevision) failCode("REVISION_CONFLICT", "任务已被修改，请刷新后重试", 409);
  if (!Number.isSafeInteger(now) || now < 0) failCode("ADAPTER_UNAVAILABLE", "可信时钟不可用", 503);
  if (now < result.finishedAt) failCode("ADAPTER_UNAVAILABLE", "可信时钟不可用", 503);
  if (now < job.nextAttemptAt) failCode("RETRY_NOT_DUE", "未到重试时间", 409);
  const newRevision = expectedJobRevision + 1;
  if (!Number.isSafeInteger(newRevision) || newRevision > Number.MAX_SAFE_INTEGER - 2) invalidJob();
}

// validator 结构错误归一化（§4.5.1）：仅下列结构码收敛为 INVALID_JOB；其余同步异常收敛为
// ADAPTER_UNAVAILABLE/503。不修改、不放宽任何 validator。
const VALIDATOR_STRUCTURE_CODES = new Set([
  "INVALID_JOB", "DISPATCH_SNAPSHOT_REQUIRED", "CLEANUP_SNAPSHOT_REQUIRED", "PARAM_ERROR",
  "DEVICE_CLAIM_INVALID", "DEVICE_CLAIM_CONFLICT", "GRANT_SLOT_CONFLICT",
]);
function normalizeValidatorError(error) {
  if (error && VALIDATOR_STRUCTURE_CODES.has(error.code)) invalidJob();
  failCode("ADAPTER_UNAVAILABLE", "服务暂时不可用", 503);
}

// 权限/主体门禁纯函数（§4.5 第 2–4 步）：事务外预读与事务内权威复核共用同一逻辑。
// orgId 默认取 org._id（LocalStore 记录均带 _id），保证两处调用签名一致。
function assertMembership({ org, member, actor, orgId = org?._id }) {
  if (!org) failCode("NOT_FOUND", "组织不可用", 404);
  if (org.status !== "active") failCode("FORBIDDEN", "当前组织不可用", 403);
  if (!member || member.orgId !== orgId) failCode("NOT_FOUND", "成员关系不可用", 404);
  if (member.status !== "active" || member.principalId !== actor.actorId)
    failCode("FORBIDDEN", "当前成员关系无效", 403);
  if (actor.actorType !== "user") failCode("FORBIDDEN", "当前主体无权人工重试", 403);
  if (!(member.permissions || []).includes(RETRY_PERMISSION))
    failCode("FORBIDDEN", "当前成员关系无权人工重试", 403);
}

/**
 * 严格人工重试服务。
 * 构造：{ store, orgId, actor:{actorId, membershipId, actorType?}, now?, env? }
 */
export class StrictRetryService {
  constructor({ store, orgId, actor, now = () => Date.now(), env = process.env }) {
    if (!store || typeof store.transact !== "function") throw new TypeError("store 必须提供 transact");
    if (!(store instanceof LocalStore)) failCode("NOT_CONFIGURED", "仅支持 LocalStore 合成范围", 503);
    if (typeof orgId !== "string" || !orgId) throw new TypeError("orgId 必填");
    if (!actor || typeof actor.actorId !== "string" || !actor.actorId ||
        typeof actor.membershipId !== "string" || !actor.membershipId) {
      throw new TypeError("actor 必须包含 actorId 与 membershipId");
    }
    this.store = store;
    this.orgId = orgId;
    this.actor = actor;
    this.now = now;
    this.env = env;
  }

  // 事务前派生 K2 上下文（§4.5 第 1/5 步）。
  #opContext(idempotencyKey) {
    try { assertIdempotencyKey(idempotencyKey); }
    catch (error) { failCode("PARAM_ERROR", error.message, 400); }
    const actorType = this.actor.actorType;
    if (actorType !== "user") failCode("FORBIDDEN", "当前主体无权人工重试", 403);
    const config = operationKeyConfig(this.env);
    const opKey = operationKey({
      orgId: this.orgId, method: REQ_METHOD, actorType, actorId: this.actor.actorId,
      idempotencyKey, config,
    });
    const { headId, versionIdPrefix } = operationKeyDomainIds(config.realm);
    return {
      orgId: this.orgId, opKey, config, actorType,
      headId, versionId: `${versionIdPrefix}${config.version}`,
      fingerprint: operationKeyFingerprint(config),
    };
  }

  #domainWrites(state, op, now) {
    try {
      return applyOperationKeyDomain(state, {
        realm: op.config.realm, version: op.config.version, fingerprint: op.fingerprint, now,
      });
    } catch (error) {
      // collections.mjs 的 domain 错误只带 code 不带 status（§4.10 映射为 409）。
      // 在 E07 边界补齐 status，不改被复用的 collections.mjs。
      if (error && (error.code === "DOMAIN_INCOMPLETE" || error.code === "DOMAIN_MISMATCH"))
        error.status = 409;
      throw error;
    }
  }

  // 事务内权限权威复核（§4.5 第 2–4 步），合法重放同样执行。
  #authorize(state) {
    assertMembership({
      org: state[`organizations/${this.orgId}`],
      member: state[`org_memberships/${this.actor.membershipId}`],
      actor: this.actor,
      orgId: this.orgId,
    });
  }

  /**
   * retry(jobId, { expectedJobRevision }, { idempotencyKey })
   * 成功返回五字段回执；合法重放零写返回同一回执。
   */
  async retry(jobId, body = {}, headers = {}) {
    // §4.5 第 1 步：DTO 精确白名单（§4.3）。body 只允许 expectedJobRevision，
    // headers 只允许 idempotencyKey；任一额外字段一律 PARAM_ERROR/400 零写，
    // 不静默忽略（否则 force/now 等被透传时调用方会误以为覆盖生效）。
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((k) => k !== "expectedJobRevision"))
      failCode("PARAM_ERROR", "请求参数包含非法字段", 400);
    if (!headers || typeof headers !== "object" || Array.isArray(headers) ||
        Object.keys(headers).some((k) => k !== "idempotencyKey"))
      failCode("PARAM_ERROR", "请求参数包含非法字段", 400);
    const { expectedJobRevision } = body;
    const { idempotencyKey } = headers;
    // §4.3 jobId 冻结正则（assertBoundedId 仅检查有界字符串，不足以保证不透明 ID 形状）。
    if (typeof jobId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(jobId))
      failCode("PARAM_ERROR", "jobId 非法", 400);
    if (!Number.isSafeInteger(expectedJobRevision) || expectedJobRevision < 1)
      failCode("PARAM_ERROR", "expectedJobRevision 非法", 400);
    // §4.5 第 1 步 Idempotency-Key 格式校验前置：确保 DTO 错误优先于权限/K2（第 2–5 步）。
    try { assertIdempotencyKey(idempotencyKey); }
    catch (error) { failCode("PARAM_ERROR", error.message, 400); }

    // §4.5 第 2–4 步事务外权限预读：只决定错误优先级，不作为放行依据；
    // 权威复核仍在下方 transact 内的 #authorize（§4.5 L382）。
    assertMembership({
      org: await this.store.get("organizations", this.orgId),
      member: await this.store.get("org_memberships", this.actor.membershipId),
      actor: this.actor,
      orgId: this.orgId,
    });

    const op = this.#opContext(idempotencyKey);
    const requestDigest = digestOf({ jobId, expectedJobRevision });
    // §4.7.6/§5 R08/§4.10：newRevision 算术溢出统一 INVALID_JOB/409，事务前零写。
    // logId 必须先于 refs 构造，故溢出检查前置；否则 deterministicLogId 内部的
    // assertSafeInt 会抢先抛 PARAM_ERROR/400，造成错误码泄漏。
    const newRevision = expectedJobRevision + 1;
    if (!Number.isSafeInteger(newRevision) || newRevision > Number.MAX_SAFE_INTEGER - 2)
      invalidJob();
    const logId = deterministicLogId(jobId, "queued", newRevision);
    const auditId = `audit-07d-v1:${digestOf(["HK-AI-07D/retry-audit", "v1", this.orgId, jobId, op.opKey]).slice(0, 32)}`;
    const identity = { jobId, expectedJobRevision };

    const refs = [
      ref("organizations", this.orgId),
      ref("org_memberships", this.actor.membershipId),
      ref(JOBS, jobId),
      ref(LOGS, logId),
      ref(OP_KEYS, op.opKey),
      ref(DOMAINS, op.headId),
      ref(DOMAINS, op.versionId),
      ref("admin_audit", auditId),
    ];

    let result;
    await this.store.transact(refs, (state) => {
      // §4.5 第 2–4 步：权限（合法重放同样复核）。
      this.#authorize(state);

      // §4.5 第 11 步前置：可信时钟合法性（成功与重放路径共用）。
      const now = this.now();
      if (!Number.isSafeInteger(now) || now < 0)
        failCode("ADAPTER_UNAVAILABLE", "可信时钟不可用", 503);

      // §4.5 第 6 步：domain。
      const domainWrites = this.#domainWrites(state, op, now);

      // §4.5 第 7 步：op key 重放/冲突 + audit 成对性。必须在状态门禁前命中。
      const existing = state[`${OP_KEYS}/${op.opKey}`];
      const existingAudit = state[`admin_audit/${auditId}`];
      if (existing) {
        // audit 缺失 = 预占/损坏：零写 CONFLICT。不可返回空写让 Store 补一条 audit。
        if (!existingAudit) conflict();
        // §4.4/§4.9.3：audit 精确字段白名单；org/createdAt 同属成对性校验。
        // 与 op key 六字段校验对称，字段越界（多字段/少字段）一律失败关闭。
        exactSemanticFields(existingAudit,
          ["orgId", "actorId", "actorType", "action", "target", "createdAt"],
          "审计记录");
        if (existingAudit.orgId !== this.orgId ||
            !Number.isSafeInteger(existingAudit.createdAt) || existingAudit.createdAt < 0 ||
            existingAudit.actorId !== this.actor.actorId ||
            existingAudit.actorType !== op.actorType ||
            existingAudit.action !== AUDIT_ACTION) conflict();
        assertAuditTarget(existingAudit.target, {
          jobRef: `${JOBS}/${jobId}`,
          logRef: `${LOGS}/${logId}`,
          opKeyRef: `${OP_KEYS}/${op.opKey}`,
          headRef: `${DOMAINS}/${op.headId}`,
          versionRef: `${DOMAINS}/${op.versionId}`,
        });
        result = validReplay(existing, op, requestDigest, identity, now);
        return []; // 合法重放：零写（含不新增 audit）
      }
      if (existingAudit) conflict(); // audit 存在但 op key 缺失 = 损坏：零写

      // §4.5 第 8 步：job 存在且属于本组织。
      const job = state[`${JOBS}/${jobId}`];
      if (!job || job.orgId !== this.orgId) failCode("NOT_FOUND", "任务不可用", 404);

      // §4.5 第 9 步：状态门禁（先于形状校验）。
      stateGate(job);

      // §4.5 第 10 步：形状校验——调用对应 validator，不放宽。
      const enroll = job.action === "enroll";
      try {
        if (enroll) validateDispatchJob(job);
        else if (job.action === "revoke") validateRevokeJob(job);
        else invalidJob();
      } catch (error) {
        normalizeValidatorError(error);
      }

      // §4.5 第 11–13 步：阶段/分类/预算 + revision CAS + 时间门禁。
      shapeGate(job, { now, expectedJobRevision });

      // §4.6/§4.8 log create-only：确定性 log ID 被预占 → 整事务回滚（零写 CONFLICT）。
      // 位于重放提前 return 与状态/形状门禁之后：合法重放不受影响，
      // 旧重排入口留下的 queued job 仍按 §4.11 先命中 INVALID_STATE。
      if (state[`${LOGS}/${logId}`]) conflict();

      // §4.6 写集（按形状分支）。
      const newRevision = expectedJobRevision + 1;
      const jobPatch = enroll
        ? { state: "queued", revision: newRevision, updatedAt: now }
        : { state: "queued", revision: newRevision, updatedAt: now, nextAttemptAt: null, result: null };
      const nextAttemptAt = enroll ? job.nextAttemptAt : null;
      const receipt = { jobId, state: "queued", revision: newRevision,
        attempts: job.attempts, nextAttemptAt };
      exactSemanticFields(receipt, RECEIPT_FIELDS, "回执");

      const log = {
        orgId: this.orgId, jobId, action: job.action, fromState: "retryable_failed",
        state: "queued", actorType: op.actorType, actorId: this.actor.actorId, at: now,
        revision: newRevision, attempt: job.attempts, leaseGeneration: job.leaseGeneration,
        evidenceScope: "simulated", errorKind: null, reasonCode: null, alertCode: null,
      };
      exactSemanticFields(log, LOG_FIELDS, "operation log");

      result = receipt;
      return [
        ...domainWrites,
        { collection: JOBS, id: jobId, data: jobPatch },
        { collection: LOGS, id: logId, data: log },
        { collection: OP_KEYS, id: op.opKey, data: {
          orgId: this.orgId, realm: op.config.realm, keyVersion: op.config.version,
          requestDigest, result: receipt, createdAt: now,
        } },
      ];
    }, { auditId, orgId: this.orgId, actorId: this.actor.actorId,
      actorType: op.actorType, action: AUDIT_ACTION });

    return result;
  }
}

export default StrictRetryService;
