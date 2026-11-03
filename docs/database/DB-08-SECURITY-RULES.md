# DB-08 安全规则验收清单

状态：**第一轮审查返工已改为原始证据、独立回查和管理审计核验；真实独立验证器尚未实现，未应用规则、未连接真实客户端／存储／审核服务、未读取任何真实私密资料。** DB-07 文件模块只按接口引用，未在本轮实现。

## 1. 默认边界

- 核心身份、人员、房间、入住、名单和文件集合对客户端默认拒绝直写；审核员也不因角色获得客户端直读私密集合的旁路。
- 管理 SDK 能绕过客户端数据库安全规则，只能执行受控服务端逻辑，不能用于证明 anonymous／resident／reviewer 的客户端 deny。
- 实名资料和名单证据的正向读取仅走显式权限点、组织约束的服务入口，并写同批次审计。响应不得包含公开 URL。
- 私密文件不进入公开图片／VR 路由，不签发永久或公开地址。公开内容和公开房源图片只作为明确 public 的对照组。

## 2. 19 项检查

| # | 检查 ID | 通道／操作 | 预期 | 额外断言 |
|---:|---|---|---|---|
| 1 | `anonymous-identity-private` | client 读取 `identity_private` | deny | 不返回实名密文或元数据 |
| 2 | `resident-identity-private-direct` | residentA client 读取 `identity_private` | deny | 本人住户也无客户端直读旁路 |
| 3 | `reviewer-identity-private-direct` | reviewerA client 读取 `identity_private` | deny | 审核员须走服务入口 |
| 4 | `anonymous-blacklist-evidence` | anonymous client 读取 `blacklist_entries` | deny | 不泄漏理由或证据引用 |
| 5 | `resident-blacklist-evidence` | residentA client 读取 `blacklist_entries` | deny | 住户无名单证据权限 |
| 6 | `reviewer-blacklist-direct` | reviewerA client 读取 `blacklist_entries` | deny | 审核员须走服务入口 |
| 7 | `anonymous-private-file` | anonymous client 读取 `file_assets` | deny | 私有文件定位不可见 |
| 8 | `resident-cross-org-file` | residentA client 读取 orgB `file_assets` | deny | 跨组织文件拒绝 |
| 9 | `resident-cross-org-person` | residentA client 读取 orgB `persons` | deny | 跨组织人员拒绝 |
| 10 | `resident-cross-org-room` | residentA client 读取 orgB `rooms` | deny | 跨组织房间拒绝 |
| 11 | `resident-direct-occupancy-write` | residentA client 写 `occupancies` | deny | 入住授权只能由服务端事务改变 |
| 12 | `resident-direct-identity-write` | residentA client 写 `auth_identities` | deny | 身份映射只能由服务端验证后写入 |
| 13 | `anonymous-private-download` | anonymous storage 下载 identity-document | deny | 不得签发公开 URL；另做匿名对象反查 |
| 14 | `resident-private-download` | residentA storage 下载 identity-document | deny | 不得签发公开 URL；另做匿名对象反查 |
| 15 | `reviewer-private-identity-service` | reviewerA service `readPrivateIdentity` | allow | 独立回查＋管理审计读取＋匿名对象反查 deny |
| 16 | `reviewer-blacklist-evidence-service` | reviewerA service `readBlacklistEvidence` | allow | 独立回查＋管理审计读取＋匿名对象反查 deny |
| 17 | `cross-org-private-identity-service` | reviewerB service 读取 orgA 实名资料 | deny | 服务端组织边界不可绕过 |
| 18 | `anonymous-public-content-control` | anonymous client 读取 public `content` | allow | 仅公开内容对照组 |
| 19 | `anonymous-public-image-control` | anonymous storage 下载 public listing-image | allow | 公开对照；独立匿名反查也必须 allow |

## 3. 三方证据协议

真实安全场景需要以下三类能力，缺一不可：

1. `DB08_SECURITY_ADAPTER`：`privileged=false` 的执行适配器，以清单指定的匿名、住户或审核员身份实际发起 client／storage／service 请求。
2. `DB08_SECURITY_VERIFIER`：独立证据验证器，根据原请求标识和响应摘要回查同一实际请求，并执行对象匿名反向请求。真实实现须绑定经能力校验的 `CloudProbeBackend`；当前仓库中的 `CloudSecurityEvidenceVerifier` 基类尚未实现真实回查，会失败关闭。
3. 管理回查后端：只用于读取两项敏感正向读取的审计记录和形成场景云调用证据，不用于替代非特权客户端的安全拒绝证明。

缺少任一组件时，安全场景返回 `status=not-run`；总报告为 `incomplete`，不得写成安全通过。

## 4. 原始响应与独立回查

执行适配器不再返回 `decision`、`audited` 或 `publicUrlIssued` 等自报通过字段。每项检查必须提供：

- 实际 `envId`、`actorType`、`tokenType`、`transport` 和 `requestId`；匿名令牌类型必须为 `none`，非匿名不能为 `none`，任何检查都不得以 `management-sdk` 冒充客户端身份。
- `observedAt`、整数 `httpStatus`、原始 `errorCode`、原始 `rawResponse` 及其 SHA-256 `responseDigest`。
- `target.orgId/action/resourceId`，以及与清单相符的 `collection`／`purpose`；资源必须带本 runId 前缀。
- `requiresAudit` 时提供本批次 `auditId` 和审计预期字段；storage 或禁止公开 URL 的检查提供 `objectUrl`，私密对象的 `publicUrl` 必须为 `null`。

探针根据实际 HTTP 状态和错误码得出观察决定，再要求独立验证器返回与原始证据一致的 `requestId`、`responseDigest`、`targetDigest`、`actorType` 和 `observedDecision`，并保存 `evidenceRef`、`verificationMethod`、`verifiedAt`。任一字段不符、摘要不可复核或决定与预期不符均失败。

两项 service allow 还必须由管理回查后端实际读取 `admin_audit/<auditId>`，核对 `probeRunId`、组织、actor、action 和目标资源。仅返回一个审计 ID 不算通过。

两项私密 storage 下载、两项敏感 service 读取以及一项公开 storage 对照共执行五次独立匿名对象反向请求；私密对象必须为 deny，公开图片对照必须为 allow。

## 5. 证据范围与失败关闭

- 本地模拟结果只能是 `evidenceScope=local-independent-simulation`，即使 19 项场景断言通过也不是云验收。
- 真实独立证据才可标为 `isolated-cloud-independently-verified`；场景云调用为零时以 `CLOUD_EVIDENCE_MISSING` 失败。
- 同名本地类、伪造类名或自报 `evidenceScope` 不能取得云能力。只有全部已选场景通过且各自具有 `isolated-cloud*` 证据，总报告才允许 `cloudEvidenceAccepted=true`。
- 适配器只能使用 `context.fixtures` 中的合成 ID／objectKey 和 A/B 测试组织；默认在场景结束时清理其 client/storage fixtures。`--keep-fixtures` 仅用于经批准的隔离调查，后续必须同时执行数据库和适配器清理。

具体字段协议和结果判定见 `DB-08-CLOUD-PROBES.md`。

## 6. 尚未验收

- 真实数据库安全规则、存储规则、匿名／住户／审核员身份令牌均未测试。
- 真实独立证据验证器及其请求日志／响应检索来源尚未实现，当前只有本地模拟回归。
- 服务端实名／名单证据读取入口及其原子审计未在本轮连接；清单中的 allow 是后续验收目标，不是当前可用能力声明。
- 公开对照组的 allow 不得扩大成任意 collection、任意 orgId 或任意文件的公开访问。
- 本清单不是安全规则源码，不会自动部署。任何规则变更须另走审查和隔离验证流程；返工复审通过前不得执行真实云探针。
