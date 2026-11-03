# DB-08 第一轮审查：探针框架需返工

审查分支：`feat/db-08-cloud-probes`  
审查 head：`23af559`  
基线：DB-05 已复核点 `b9ee061`

结论：本提交的隔离保护、默认 dry-run、清理前缀和文档边界较清楚，但当前探针不能作为真实云验收证据。以下三项问题修复后再复审；暂不执行真实隔离云探针，不合并 main，不连接生产环境。

## F01 [P1] 探针复制业务算法，没有验证待上线服务实现

位置：`admin-web/probes/db08/transaction-probes.mjs` 全部事务场景，尤其 `identityRace`、`primarySlotProbe`、`blacklistActivationProbe`、`occupancyReviewRace`。

探针直接在 `ProbeBackend` 上重新实现一套简化事务，没有调用 DB-03～DB-06 的正式服务或共享事务函数。因此正式服务即使发生回归，探针仍可能通过。最明显的偏差是 `identity-document-fixed-id`：探针沿用登录身份模型，写 `auth_identities/users`；正式证件审核流程在 `verification.mjs` 中使用组织范围的 `unique_claims/persons`，两者不是同一约束。入住审核探针也自建 `blacklist_decisions` 写法，没有执行 `OccupancyService` 的真实申请摘要、命中集合和激活路径。

修复：把事务核心提取为正式服务与探针共用的纯事务构建器，或让隔离探针通过正式服务入口执行合成请求。每个场景应明确对应生产方法和集合，并验证最终业务状态。证件唯一性应覆盖 `verification.review` 的 `unique_claims` 竞争；手机号/微信应覆盖 `IdentityService` 的真实重试解析；名单与入住应覆盖正式 guard、申请和激活代码。禁止在探针中维护第二套近似算法。

## F02 [P1] 固定身份竞争依赖第一个调用获胜，反向顺序会使探针自身失败

位置：`admin-web/probes/db08/transaction-probes.mjs:37-75`。

每次 `register(userId)` 只声明当前候选用户引用。若另一个候选先绑定身份，事务把 `owner` 改成已绑定用户后，又因该 owner 不在 state 中而尝试写入未声明引用。后续重放还固定使用 `users[0]`，没有按实际 winner 或另一候选安全解析。

独立复现通过延迟第一次事务，让 `users[1]` 先提交；`identityPhoneProbe` 随即以 `UNDECLARED_WRITE` 失败。现有本地后端串行队列总按调用顺序执行，所以 16 项专项测试没有覆盖该顺序。

修复：使用正式身份服务的“预读映射 owner 引用＋事务内重验＋外层有限重试”流程；至少补 winner 为候选 0/1、事务回调重试、两个调用最终都解析到同一 userId 的测试。证件身份场景应按 F01 改用正式证件唯一声明，不复用此登录探针。

## F03 [P1] 安全报告可以由自报适配器伪造为 isolated-cloud 通过

位置：`admin-web/probes/db08/run.mjs:46-48,63-66`，`security-probes.mjs:36-86`。

`evidenceScope` 只按后端 `constructor.name === "CloudProbeBackend"` 判定；安全适配器只需自报 `privileged:false`，并返回期望的 allow/deny、任意同前缀 auditId 和 `publicUrlIssued:false`。执行器没有核验适配器实际使用的客户端身份、真实响应、审计记录存在性或存储 URL。结果却把整个报告标成 `isolated-cloud`。

独立复现使用零云调用的同名本地后端和按清单返回预期字符串的假适配器，报告仍为 `status=pass`、`evidenceScope=isolated-cloud`、19 项通过，`cloudCalls=0`。当前测试中的 `fakeSecurityAdapter` 正好验证了自报协议能通过，未验证证据真实性。

修复：按场景记录证据范围，禁止以类名推断；真实云后端应使用不可伪造的显式 capability/实例校验。安全适配器必须返回可复核的原始响应摘要、身份/令牌类型、目标资源、时间和错误码。两项敏感正向读取的 auditId 必须由独立管理通道回查本批次审计记录，并核对 actor、org、resource、action；公开 URL/对象访问也须由执行器做独立反向请求。没有真实适配器时安全场景只能是 `not-run`，不能形成云验收通过结论。

## 已通过的基础检查

- 管理端测试：180/180 通过。
- 根目录测试：51/51 通过。
- 小程序静态检查：9 页通过，包体约 869 KiB。
- dry-run：11 个场景、17 条索引候选、19 项安全检查，`cloudCalls=0`、`cloudWrites=0`、`credentialsRead=false`。
- `git show --check` 通过。

这些结果证明本地代码可运行、默认 dry-run 未触云，并不证明真实云事务、索引、安全规则、原子审计或清理已经验收。17 条索引仍是候选清单，真实隔离环境尚未执行，安全适配器尚未实现。

## 返工交付要求

1. F01：所有业务探针绑定正式服务/共享事务核心，并列出生产入口映射。
2. F02：补反向 winner、事务重试和双请求稳定解析测试。
3. F03：场景级证据范围、独立证据回查和不可自报的云执行证明。
4. 返工阶段只运行本地/dry-run；代码复审通过后，才另行准备专用隔离环境与真实安全适配器。生产环境 `cloud1-d6gs08jbb8aa7a138` 不得用于 DB-08 探针。

## 第二轮复审：94b1f29

结论：F01、F03 的框架问题已关闭；F02 只在单元测试中覆盖双向顺序，正式执行入口仍只跑默认顺序；另发现索引探针查询与候选索引定义不一致。当前仍需返工，暂不执行真实隔离云探针。

### F01 已通过：事务探针已绑定正式服务

新增 `ServiceStore` 仅负责逻辑／物理 ID 映射和隔离前缀，身份、实名、名单、入住、组织与房间批量探针分别调用 `IdentityService`、`VerificationService`、`BlacklistService`、`OccupancyService`、`OrgService`、`OrgPropertyService`。故障注入测试替换 `IdentityService.login` 后探针会传播失败，证明不再由影子算法独立给出通过。证件场景也已改为正式 `VerificationService.review` 与 `verified-person` `unique_claims` 竞争。

### F02 [P1] 仍未关闭：完整执行器没有运行反向 winner／反向审核顺序

位置：`admin-web/probes/db08/transaction-probes.mjs:18-65,210-255,408-411`，`run.mjs:67-83`。

身份函数支持 `{winner:0|1}`，入住审核函数支持 `{reverse:true|false}`，专项测试直接调用函数验证两种顺序；但场景清单每类只有一个 ID，`runTransactionProbe(id, backend)` 调用探针时不传参数，所以真实 `run.mjs --execute-isolated` 中手机号、微信、证件都只执行默认 `winner=0`，入住审核只执行默认 `reverse=false`。报告仍会把单次默认顺序记为该场景通过，与文档“winner=0/1”“两种提交顺序均通过”的验收口径不符。

修复：让正式场景内部顺序执行两个独立、不同前缀/夹具标签的子场景，或把正反顺序拆成独立场景 ID；总结果必须记录两个子结果，任一未执行或失败都不能通过。补从 `run()` 入口断言报告实际包含 winner 0、winner 1 和 review/mutation 两种顺序的测试，不能只直接测试导出函数。

### F03 框架通过，真实适配器仍是后续执行门槛

云后端改用模块私有 WeakSet 能力识别，同名本地类不能冒充；安全执行结果需要独立验证器、管理通道审计回查和对象匿名反向请求，缺少验证器时为 `not-run/incomplete`。零云调用本地模拟不能得到 `cloudEvidenceAccepted=true`。本轮认为首审的“自报即可云通过”已修复。

`CloudSecurityEvidenceVerifier` 的真实 `verify/reverseRequest` 仍明确未实现，当前只有本地模拟。这不是本轮新增实现错误，但意味着现状无法完成真实安全验收；实现后必须单独审查适配器与验证器的独立身份、原始响应来源和审计回查。

### F04 [P1] 索引探针验证了带 probeRunId 的查询，不是文档列出的生产索引

位置：`admin-web/probes/db08/transaction-probes.mjs:299-320`，`manifest.mjs` 的 `INDEXES`，`DB-08-INDEXES.md`。

17 条候选索引定义为 `orgId + 业务等值字段 + orderBy`；实际探针给每条查询额外加入 `probeRunId`：`where: { probeRunId: backend.runId, ...where }`。云数据库的复合索引需求取决于完整查询字段，因此该探针验证的是包含 `probeRunId` 的探针专用查询，而候选清单没有该字段。即使查询通过，也不能证明正式服务使用的候选索引可用；反之也可能因为缺少探针专用索引而误报失败。

修复：测试组织 ID 本身已按 runId 隔离，可在 index smoke 中去掉 `probeRunId` 条件，使执行查询与候选定义逐字段一致；报告记录实际 where/orderBy 并与 manifest 做结构断言。为每个候选建立能命中的合成记录，至少验证返回、组织隔离和排序，而不是让大多数查询以空结果通过。

### 第二轮实跑

- 管理端：184/184 通过。
- 根目录：51/51 通过。
- 9 页小程序静态检查通过，包体约 869 KiB。
- dry-run 仍为 11 个场景、17 条索引、19 项安全检查，零云调用、零云写入、未读凭据。
- `git diff --check` 通过。

以上均为本地验证。真实云事务、索引、安全规则、云端审计、对象反查和清理仍未执行。
