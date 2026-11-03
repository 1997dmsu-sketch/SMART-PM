import { createHash } from "node:crypto";
import { SECURITY_CHECKS } from "./manifest.mjs";
import { invariant, isCloudProbeBackend } from "./backend.mjs";

const CLOUD_VERIFIERS = new WeakSet();
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class CloudSecurityEvidenceVerifier {
  constructor(backend) {
    invariant(isCloudProbeBackend(backend), "CLOUD_CAPABILITY_REQUIRED",
      "云安全验证器必须绑定经过能力校验的 CloudProbeBackend");
    this.backend = backend;
    CLOUD_VERIFIERS.add(this);
  }
  async verify() {
    invariant(false, "SECURITY_VERIFIER_NOT_IMPLEMENTED",
      "真实云安全验证器须由隔离环境实现独立响应回查");
    return null;
  }
  async reverseRequest() {
    invariant(false, "SECURITY_VERIFIER_NOT_IMPLEMENTED",
      "真实云安全验证器须由隔离环境实现匿名对象反向请求");
    return null;
  }
}

export function isCloudSecurityEvidenceVerifier(value) {
  return value instanceof CloudSecurityEvidenceVerifier && CLOUD_VERIFIERS.has(value);
}

function fixtures(config) {
  const id = (label) => `${config.prefix}${label}`;
  return {
    identityPrivateId: id("security-identity-private"),
    identityApplicationId: id("security-identity-application"),
    blacklistEntryId: id("security-blacklist-entry"),
    blacklistEvidenceFileId: id("security-blacklist-evidence"),
    privateFileId: id("security-private-file"),
    privateObjectKey: id("security-private-object"),
    publicFileId: id("security-public-file"),
    publicObjectKey: id("security-public-object"),
    personAId: id("security-person-a"), personBId: id("security-person-b"),
    roomAId: id("security-room-a"), roomBId: id("security-room-b"),
    occupancyId: id("security-occupancy"), authIdentityId: id("security-auth-identity"),
    publicContentId: id("security-public-content"),
  };
}

function decisionFrom(evidence) {
  if (evidence.errorCode) return "deny";
  return evidence.httpStatus >= 200 && evidence.httpStatus < 300 ? "allow" : "deny";
}

function validateEvidence(check, evidence, context) {
  invariant(evidence && typeof evidence === "object", "SECURITY_EVIDENCE_MISSING", `${check.id}: 缺少原始证据`);
  for (const [field, expected] of Object.entries({
    envId: context.envId, actorType: check.actor, transport: check.channel,
  })) invariant(evidence[field] === expected, "SECURITY_EVIDENCE_MISMATCH",
  `${check.id}: ${field} 与实际身份／通道／环境不符`);
  invariant(typeof evidence.tokenType === "string" && evidence.tokenType.length > 0 &&
    (check.actor === "anonymous" ? evidence.tokenType === "none" : evidence.tokenType !== "none") &&
    evidence.tokenType !== "management-sdk", "SECURITY_TOKEN_INVALID",
  `${check.id}: 令牌类型无效或误用管理 SDK`);
  invariant(typeof evidence.requestId === "string" && evidence.requestId.length >= 3 &&
    evidence.requestId.length <= 200, "SECURITY_REQUEST_ID", `${check.id}: 缺少请求 ID`);
  invariant(Number.isInteger(evidence.observedAt) && evidence.observedAt >= context.startedAt - 1000 &&
    evidence.observedAt <= Date.now() + 1000, "SECURITY_TIME_INVALID", `${check.id}: 证据时间无效`);
  invariant(Number.isInteger(evidence.httpStatus) && evidence.httpStatus >= 0 && evidence.httpStatus <= 599 &&
    (evidence.errorCode === null || typeof evidence.errorCode === "string"),
  "SECURITY_RESPONSE_INVALID", `${check.id}: HTTP 状态或错误码无效`);
  invariant(evidence.rawResponse && typeof evidence.rawResponse === "object" &&
    evidence.responseDigest === hash(evidence.rawResponse), "SECURITY_RESPONSE_DIGEST",
  `${check.id}: 原始响应摘要不可复核`);
  const target = evidence.target;
  invariant(target && target.orgId === context.orgId && target.action === check.action &&
    typeof target.resourceId === "string" && target.resourceId.startsWith(context.prefix),
  "SECURITY_TARGET_MISMATCH", `${check.id}: 目标组织、动作或资源前缀不符`);
  if (check.collection) invariant(target.collection === check.collection, "SECURITY_TARGET_MISMATCH",
    `${check.id}: 目标集合不符`);
  if (check.purpose) invariant(target.purpose === check.purpose, "SECURITY_TARGET_MISMATCH",
    `${check.id}: 文件用途不符`);
  return decisionFrom(evidence);
}

async function independentlyVerify(verifier, check, evidence, observedDecision, context) {
  invariant(verifier && typeof verifier.verify === "function", "SECURITY_VERIFIER_UNAVAILABLE",
    "缺少独立安全证据验证器");
  const independent = await verifier.verify(check, evidence, context);
  invariant(independent && independent.requestId === evidence.requestId &&
    independent.responseDigest === evidence.responseDigest &&
    independent.targetDigest === hash(evidence.target) &&
    independent.actorType === evidence.actorType &&
    Number.isInteger(independent.verifiedAt) &&
    typeof independent.evidenceRef === "string" && independent.evidenceRef.length >= 3 &&
    typeof independent.verificationMethod === "string" && independent.verificationMethod.length >= 3,
  "SECURITY_INDEPENDENT_EVIDENCE", `${check.id}: 独立回查证据无法对应原请求`);
  invariant(independent.observedDecision === observedDecision && independent.observedDecision === check.expected,
    "SECURITY_RULE_MISMATCH", `${check.id}: 独立回查决定与原始响应或预期不符`);
  return independent;
}

async function verifyAudit(backend, check, evidence, context) {
  if (!check.requiresAudit) return null;
  invariant(typeof evidence.auditId === "string" && evidence.auditId.startsWith(context.prefix),
    "SECURITY_AUDIT_MISSING", `${check.id}: 缺少本批次 auditId`);
  const audit = await backend.get("admin_audit", evidence.auditId);
  const expected = evidence.audit;
  invariant(audit && audit.probeRunId === context.runId && audit.orgId === context.orgId &&
    expected && audit.actorId === expected.actorId && audit.actorType === expected.actorType &&
    audit.action === expected.action && audit.entityType === expected.entityType &&
    audit.entityId === expected.entityId, "SECURITY_AUDIT_MISMATCH",
  `${check.id}: 独立管理通道未找到匹配的 actor/org/resource/action 审计`);
  return { auditId: evidence.auditId, independentlyRead: true };
}

async function reverseObjectRequest(verifier, check, evidence, context) {
  if (check.channel !== "storage" && !check.forbidPublicUrl) return null;
  invariant(typeof evidence.objectUrl === "string" && evidence.objectUrl.length >= 8,
    "SECURITY_OBJECT_URL_MISSING", `${check.id}: 缺少供独立反查的对象定位`);
  if (check.forbidPublicUrl)
    invariant(evidence.publicUrl === null, "PRIVATE_FILE_PUBLIC_URL", `${check.id}: 私密对象返回了公开 URL`);
  const reversed = await verifier.reverseRequest({
    method: "GET", url: evidence.objectUrl, actorType: "anonymous", tokenType: "none",
  }, context);
  invariant(reversed && typeof reversed.requestId === "string" &&
    reversed.rawResponse && typeof reversed.rawResponse === "object" &&
    reversed.responseDigest === hash(reversed.rawResponse),
  "SECURITY_REVERSE_EVIDENCE", `${check.id}: 匿名反向请求缺少可复核响应`);
  const actual = decisionFrom(reversed);
  const expected = check.channel === "service" ? "deny" : check.expected;
  invariant(actual === expected, "SECURITY_REVERSE_MISMATCH",
    `${check.id}: 匿名对象反查期望 ${expected}，实际 ${actual}`);
  return { requestId: reversed.requestId, responseDigest: reversed.responseDigest,
    expected, actual, independentlyRequested: true };
}

/**
 * adapter performs a request and returns raw evidence. verifier is a separate
 * component that independently retrieves matching evidence and performs object
 * reverse requests. Neither component's self-declared decision is trusted.
 */
export async function runSecurityProbes(adapter, config, { backend = null, verifier = null } = {}) {
  if (!adapter || !verifier || !backend) {
    return {
      status: "not-run", evidenceScope: "not-run", checks: 0,
      plannedChecks: SECURITY_CHECKS.length,
      reason: "需要独立的执行适配器、证据验证器和管理回查后端；自报结果不构成验收",
    };
  }
  invariant(adapter.privileged === false && typeof adapter.check === "function",
    "SECURITY_ADAPTER_UNAVAILABLE", "执行适配器必须声明非特权客户端／存储身份");
  const context = {
    runId: config.runId, prefix: config.prefix, envId: config.envId,
    orgA: config.orgA, orgB: config.orgB, fixtures: fixtures(config), syntheticOnly: true,
    startedAt: Date.now(),
  };
  const evidenceScope = isCloudProbeBackend(backend) && isCloudSecurityEvidenceVerifier(verifier)
    ? "isolated-cloud-independently-verified" : "local-independent-simulation";
  const results = [];
  try {
    await adapter.prepare?.(context);
    for (const check of SECURITY_CHECKS) {
      const orgId = check.org === "B" ? config.orgB : config.orgA;
      const checkContext = { ...context, orgId };
      const evidence = await adapter.check(check, checkContext);
      const observedDecision = validateEvidence(check, evidence, checkContext);
      const independent = await independentlyVerify(verifier, check, evidence, observedDecision, checkContext);
      const audit = await verifyAudit(backend, check, evidence, checkContext);
      const reverse = await reverseObjectRequest(verifier, check, evidence, checkContext);
      results.push({
        id: check.id, expected: check.expected, actual: independent.observedDecision,
        requestId: evidence.requestId, responseDigest: evidence.responseDigest,
        independentEvidenceRef: independent.evidenceRef,
        verificationMethod: independent.verificationMethod,
        audit, reverse, evidenceScope, status: "pass",
      });
    }
  } finally {
    if (!config.keepFixtures) await adapter.cleanup?.(context);
  }
  return {
    status: "pass", evidenceScope, checks: results.length,
    plannedChecks: SECURITY_CHECKS.length,
    independentlyVerifiedChecks: results.length,
    managementAuditReads: results.filter((row) => row.audit).length,
    independentReverseRequests: results.filter((row) => row.reverse).length,
    results,
  };
}
