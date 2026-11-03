# DB-08 安全规则验收清单

状态：**仅验收清单与适配器协议；未应用规则、未连接真实客户端／存储／审核服务、未读取任何真实私密资料。** DB-07 文件模块只按接口引用，未在本轮实现。

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
| 13 | `anonymous-private-download` | anonymous storage 下载 identity-document | deny | 不得签发公开 URL |
| 14 | `resident-private-download` | residentA storage 下载 identity-document | deny | 不得签发公开 URL |
| 15 | `reviewer-private-identity-service` | reviewerA service `readPrivateIdentity` | allow | 必须有同批次审计；不得签发公开 URL |
| 16 | `reviewer-blacklist-evidence-service` | reviewerA service `readBlacklistEvidence` | allow | 必须有同批次审计；不得签发公开 URL |
| 17 | `cross-org-private-identity-service` | reviewerB service 读取 orgA 实名资料 | deny | 服务端组织边界不可绕过 |
| 18 | `anonymous-public-content-control` | anonymous client 读取 public `content` | allow | 仅公开内容对照组 |
| 19 | `anonymous-public-image-control` | anonymous storage 下载 public listing-image | allow | 仅公开图片对照组 |

## 3. 执行要求与失败关闭

真实安全场景必须由 `DB08_SECURITY_ADAPTER` 指定的非特权适配器执行。适配器的 `privileged` 必须为 `false`，每次 `check` 必须返回明确 `allow` 或 `deny`；抛错、超时、结果缺失均为失败，不得推定通过。

两项 service allow 必须返回 `audited=true` 和本 runId 前缀下的 `auditId`。所有 `forbidPublicUrl` 检查必须明确返回 `publicUrlIssued=false`。任一规则与预期不符、审计缺失或私密文件出现公开 URL，整个安全场景失败。

适配器只能使用 `context.fixtures` 中的合成 ID／objectKey 和 A/B 测试组织；默认在场景结束时清理其 client/storage fixtures。`--keep-fixtures` 仅用于经批准的隔离调查，后续必须同时执行数据库和适配器清理。

## 4. 尚未验收

- 真实数据库安全规则、存储规则、匿名／住户／审核员身份令牌均未测试。
- 服务端实名／名单证据读取入口及其原子审计未在本轮连接；清单中的 allow 是后续验收目标，不是当前可用能力声明。
- 公开对照组的 allow 不得扩大成任意 collection、任意 orgId 或任意文件的公开访问。
- 本清单不是安全规则源码，不会自动部署。任何规则变更须另走审查和隔离验证流程。
