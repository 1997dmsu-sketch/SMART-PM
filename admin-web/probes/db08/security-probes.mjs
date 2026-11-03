import { SECURITY_CHECKS } from "./manifest.mjs";
import { invariant } from "./backend.mjs";

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
    personAId: id("security-person-a"),
    personBId: id("security-person-b"),
    roomAId: id("security-room-a"),
    roomBId: id("security-room-b"),
    occupancyId: id("security-occupancy"),
    authIdentityId: id("security-auth-identity"),
    publicContentId: id("security-public-content"),
  };
}

/**
 * The adapter must exercise real client/storage rules and the server-mediated
 * positive path. A management SDK is explicitly not a valid implementation:
 * it bypasses client security rules and therefore cannot prove denial.
 *
 * Adapter contract:
 *   { privileged: false,
 *     prepare?(context), check(check, context), cleanup?(context) }
 * check() returns { decision: "allow"|"deny", audited?: boolean,
 *                   auditId?: string, publicUrlIssued: boolean }.
 */
export async function runSecurityProbes(adapter, config) {
  invariant(adapter && adapter.privileged === false && typeof adapter.check === "function",
    "SECURITY_ADAPTER_UNAVAILABLE",
    "安全规则验收必须配置非特权 client/storage/service 适配器；管理 SDK 不能代替");
  const context = {
    runId: config.runId,
    prefix: config.prefix,
    envId: config.envId,
    orgA: config.orgA,
    orgB: config.orgB,
    fixtures: fixtures(config),
    // Synthetic values only. No real phone, OPENID, identity document or evidence.
    syntheticOnly: true,
  };
  let prepared = false;
  const results = [];
  try {
    await adapter.prepare?.(context);
    prepared = true;
    for (const check of SECURITY_CHECKS) {
      const orgId = check.org === "B" ? config.orgB : config.orgA;
      let outcome;
      try {
        outcome = await adapter.check(check, { ...context, orgId });
      } catch (error) {
        throw new Error(`${check.id}: 安全适配器执行失败：${error.message}`, { cause: error });
      }
      invariant(outcome && ["allow", "deny"].includes(outcome.decision),
        "SECURITY_ADAPTER_INVALID", `${check.id}: 适配器必须返回明确 allow/deny`);
      invariant(outcome.decision === check.expected, "SECURITY_RULE_MISMATCH",
        `${check.id}: 期望 ${check.expected}，实际 ${outcome.decision}`);
      if (check.requiresAudit) {
        invariant(outcome.audited === true && typeof outcome.auditId === "string" &&
          outcome.auditId.startsWith(config.prefix), "SECURITY_AUDIT_MISSING",
        `${check.id}: 敏感服务读取必须写同批次审计`);
      }
      if (check.forbidPublicUrl)
        invariant(outcome.publicUrlIssued === false, "PRIVATE_FILE_PUBLIC_URL",
          `${check.id}: 私密文件不得签发公开 URL`);
      results.push({ id: check.id, expected: check.expected, actual: outcome.decision,
        audited: check.requiresAudit ? true : undefined,
        publicUrlIssued: check.forbidPublicUrl ? false : undefined,
        status: "pass" });
    }
  } finally {
    // Adapter-owned storage/client fixtures follow the same default cleanup policy.
    if ((prepared || !config.keepFixtures) && !config.keepFixtures)
      await adapter.cleanup?.(context);
  }
  return { status: "pass", checks: results.length, privilegedAdapter: false,
    managementSdkUsedForRules: false, results };
}
