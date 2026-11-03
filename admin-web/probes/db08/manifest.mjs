export const DB08_BASELINE = "b9ee06118b053a458d3458241e2341ea5a4dc7e1";
export const DRY_RUN_ID = "db08-dry-run";
export const MAX_TRANSACTION_REFS = 90;
export const ROOM_BATCH_SIZE = 25;
export const ROOM_BATCH_TOTAL = 1000;

export const SCENARIOS = [
  { id: "identity-phone-fixed-id", kind: "transaction", covers: "已验证手机号固定 ID 并发唯一" },
  { id: "identity-wechat-fixed-id", kind: "transaction", covers: "微信身份固定 ID 并发唯一" },
  { id: "identity-document-fixed-id", kind: "transaction", covers: "组织内证件身份固定 ID 并发唯一" },
  { id: "primary-slot-contention", kind: "transaction", covers: "同一房间主租客槽并发争用" },
  { id: "blacklist-activation-race", kind: "transaction", covers: "名单新增与入住激活竞争及 guard 重读" },
  { id: "occupancy-review-request-race", kind: "transaction", covers: "入住申请审核与请求修改版本竞争" },
  { id: "organization-isolation", kind: "transaction", covers: "组织过滤、伪造成员及跨组织引用" },
  { id: "index-query-smoke", kind: "query", covers: "清单索引的组织优先查询与游标排序" },
  { id: "security-access-rules", kind: "security", covers: "私密文件、实名资料、黑名单证据及跨组织规则" },
  { id: "transaction-reference-budget", kind: "transaction", covers: "90 引用边界及 91 引用预检拒绝" },
  { id: "room-batch-1000", kind: "transaction", covers: "1000 间房间 25 条分批、重放和容量" },
];

// Candidate indexes only. Nothing in this manifest creates or changes an index.
export const INDEXES = [
  { collection: "org_memberships", equality: ["orgId", "principalType", "principalId", "status"], orderBy: ["_id"], purpose: "服务端成员关系与组织列表" },
  { collection: "persons", equality: ["orgId", "userId"], orderBy: ["_id"], purpose: "组织内账号绑定" },
  { collection: "persons", equality: ["orgId", "status"], orderBy: ["_id"], purpose: "组织人员分页" },
  { collection: "property_catalog", equality: ["orgId", "kind", "parentId", "status"], orderBy: ["_id"], purpose: "物业层级与归档过滤" },
  { collection: "rooms", equality: ["orgId", "buildingId", "floorId", "status"], orderBy: ["roomNo", "_id"], purpose: "房间筛选和稳定分页" },
  { collection: "houses", equality: ["orgId", "lifecycle", "status"], orderBy: ["updatedAt", "_id"], purpose: "组织内出租展示" },
  { collection: "identity_applications", equality: ["orgId", "state"], orderBy: ["submittedAt", "_id"], purpose: "实名审核队列" },
  { collection: "identity_applications", equality: ["orgId", "personId"], orderBy: ["_id"], purpose: "人员实名历史" },
  { collection: "identity_reviews", equality: ["orgId", "applicationId"], orderBy: ["decidedAt", "_id"], purpose: "申请审核历史" },
  { collection: "blacklist_entries", equality: ["orgId", "subjectType", "subjectKey", "state"], orderBy: ["endsAt", "_id"], purpose: "名单主体与有效期候选" },
  { collection: "occupancy_cycles", equality: ["orgId", "roomId", "state"], orderBy: ["startsAt", "_id"], purpose: "房间入住周期" },
  { collection: "occupancies", equality: ["orgId", "roomId", "state"], orderBy: ["startsAt", "_id"], purpose: "房间关系及有效期" },
  { collection: "occupancies", equality: ["orgId", "personId", "state"], orderBy: ["startsAt", "_id"], purpose: "人员入住历史" },
  { collection: "occupancy_applications", equality: ["orgId", "state"], orderBy: ["createdAt", "_id"], purpose: "持久待审入住申请" },
  { collection: "occupancy_materializations", equality: ["orgId", "state"], orderBy: ["_id"], purpose: "周期历史补写任务" },
  { collection: "file_links", equality: ["orgId", "entityType", "entityId"], orderBy: ["sortOrder", "_id"], purpose: "DB-07 文件引用" },
  { collection: "file_assets", equality: ["orgId", "purpose", "visibility", "status"], orderBy: ["_id"], purpose: "DB-07 私密文件筛选" },
];

// Direct client access to core records is deny-by-default, including reviewers.
// Positive sensitive reads are server-mediated and must produce an audit event.
export const SECURITY_CHECKS = [
  { id: "anonymous-identity-private", actor: "anonymous", channel: "client", action: "read", collection: "identity_private", expected: "deny" },
  { id: "resident-identity-private-direct", actor: "residentA", channel: "client", action: "read", collection: "identity_private", expected: "deny" },
  { id: "reviewer-identity-private-direct", actor: "reviewerA", channel: "client", action: "read", collection: "identity_private", expected: "deny" },
  { id: "anonymous-blacklist-evidence", actor: "anonymous", channel: "client", action: "read", collection: "blacklist_entries", expected: "deny" },
  { id: "resident-blacklist-evidence", actor: "residentA", channel: "client", action: "read", collection: "blacklist_entries", expected: "deny" },
  { id: "reviewer-blacklist-direct", actor: "reviewerA", channel: "client", action: "read", collection: "blacklist_entries", expected: "deny" },
  { id: "anonymous-private-file", actor: "anonymous", channel: "client", action: "read", collection: "file_assets", expected: "deny" },
  { id: "resident-cross-org-file", actor: "residentA", channel: "client", action: "read", collection: "file_assets", org: "B", expected: "deny" },
  { id: "resident-cross-org-person", actor: "residentA", channel: "client", action: "read", collection: "persons", org: "B", expected: "deny" },
  { id: "resident-cross-org-room", actor: "residentA", channel: "client", action: "read", collection: "rooms", org: "B", expected: "deny" },
  { id: "resident-direct-occupancy-write", actor: "residentA", channel: "client", action: "write", collection: "occupancies", expected: "deny" },
  { id: "resident-direct-identity-write", actor: "residentA", channel: "client", action: "write", collection: "auth_identities", expected: "deny" },
  { id: "anonymous-private-download", actor: "anonymous", channel: "storage", action: "download", purpose: "identity-document", expected: "deny", forbidPublicUrl: true },
  { id: "resident-private-download", actor: "residentA", channel: "storage", action: "download", purpose: "identity-document", expected: "deny", forbidPublicUrl: true },
  { id: "reviewer-private-identity-service", actor: "reviewerA", channel: "service", action: "readPrivateIdentity", expected: "allow", requiresAudit: true, forbidPublicUrl: true },
  { id: "reviewer-blacklist-evidence-service", actor: "reviewerA", channel: "service", action: "readBlacklistEvidence", expected: "allow", requiresAudit: true, forbidPublicUrl: true },
  { id: "cross-org-private-identity-service", actor: "reviewerB", channel: "service", action: "readPrivateIdentity", org: "A", expected: "deny" },
  { id: "anonymous-public-content-control", actor: "anonymous", channel: "client", action: "read", collection: "content", visibility: "public", expected: "allow" },
  { id: "anonymous-public-image-control", actor: "anonymous", channel: "storage", action: "download", purpose: "listing-image", visibility: "public", expected: "allow" },
];

export function validRunId(value) {
  return typeof value === "string" && /^db08-[a-z0-9][a-z0-9-]{2,44}$/.test(value) &&
    !value.endsWith("-") && !value.includes("--");
}

export function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (index + 1 >= args.length || args[index + 1].startsWith("--"))
    throw Error(`${name} 缺少参数`);
  return args[index + 1];
}

export function resolveConfig(args = [], env = {}) {
  const knownOptions = [
    "--dry-run", "--execute-isolated", "--cleanup-only", "--run-id",
    "--keep-fixtures", "--only",
  ];
  const unknown = args.filter((arg) => arg.startsWith("--") && !knownOptions.includes(arg));
  if (unknown.length) throw Error(`未知参数：${unknown.join(", ")}`);
  const execute = args.includes("--execute-isolated");
  const cleanupOnly = args.includes("--cleanup-only");
  if (execute && args.includes("--dry-run")) throw Error("dry-run 与 execute-isolated 不能同时使用");
  if (cleanupOnly && !execute) throw Error("cleanup-only 只能与 execute-isolated 一起使用");
  if (cleanupOnly && args.includes("--keep-fixtures")) throw Error("cleanup-only 与 keep-fixtures 不能同时使用");
  const runId = optionValue(args, "--run-id") || (execute ? null : DRY_RUN_ID);
  if (!runId) throw Error("隔离执行必须显式提供 --run-id db08-<隔离批次>");
  if (!validRunId(runId)) throw Error("run-id 必须为 db08- 开头的 5–49 位小写字母、数字或单连字符");
  const only = optionValue(args, "--only")?.split(",").map((v) => v.trim()).filter(Boolean) || [];
  if (only.some((id) => !SCENARIOS.some((scenario) => scenario.id === id)))
    throw Error("--only 包含未知探针场景");
  if (cleanupOnly && only.length) throw Error("cleanup-only 不接受 --only");
  const config = {
    mode: execute ? "execute-isolated" : "dry-run",
    runId,
    prefix: `${runId}-`,
    orgA: `${runId}-a`,
    orgB: `${runId}-b`,
    keepFixtures: args.includes("--keep-fixtures"),
    cleanupOnly,
    only,
    envId: null,
    securityAdapter: null,
  };
  if (!execute) return config;
  const envId = env.DB08_PROBE_ENV;
  if (!envId || /prod|production|live|release|main/i.test(envId) ||
      !/test|probe|isolat/i.test(envId))
    throw Error("DB08_PROBE_ENV 必须是名称明确包含 test/probe/isolated 的专用隔离环境");
  const expectedConfirmation = `db08:${envId}:${config.orgA}`;
  if (env.DB08_PROBE_CONFIRM !== expectedConfirmation)
    throw Error(`DB08_PROBE_CONFIRM 必须精确等于 ${expectedConfirmation}`);
  return {
    ...config,
    envId,
    securityAdapter: env.DB08_SECURITY_ADAPTER || null,
  };
}

export function dryRunReport(config) {
  return {
    schemaVersion: 1,
    baseline: DB08_BASELINE,
    mode: "dry-run",
    cloudCalls: 0,
    cloudWrites: 0,
    credentialsRead: false,
    runId: config.runId,
    prefix: config.prefix,
    organizations: [config.orgA, config.orgB],
    selectedScenarios: SCENARIOS.filter((scenario) =>
      !config.only.length || config.only.includes(scenario.id)),
    indexes: INDEXES,
    securityChecks: SECURITY_CHECKS,
    limits: {
      transactionRefs: MAX_TRANSACTION_REFS,
      rejectRefs: MAX_TRANSACTION_REFS + 1,
      roomTotal: ROOM_BATCH_TOTAL,
      roomBatchSize: ROOM_BATCH_SIZE,
      expectedRoomBatches: ROOM_BATCH_TOTAL / ROOM_BATCH_SIZE,
    },
    cleanup: "所有数据库文档 ID 与审计 ID 均使用同一 prefix；真实执行默认清理，--keep-fixtures 才保留",
    notice: "仅为执行计划；未加载云 SDK、未读取云凭据、未连接云环境、未创建索引或修改安全规则",
  };
}
