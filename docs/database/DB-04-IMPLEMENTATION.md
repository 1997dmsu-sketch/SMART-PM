# DB-04 实施交接：人工实名审核

状态：已实现，待交叉审查。基线 `feat/db-03-user-identity` 提交 `c407027`（DB-03 首轮审查返工点），开发分支 `feat/db-04-identity-review`。未修改 DB-02/DB-03 分支与 main。
范围仅限 admin-web 服务端；未修改登录云函数、门锁逻辑，未调用实名/短信付费接口，未连接或操作真实云环境；测试仅使用伪造脱敏证件数据。
依据文档：[接口契约](API-CONTRACT.md) §4、[数据模型](DATA-MODEL.md) §2/§3.2/§5/§6、[迁移方案](MIGRATION-PLAN.md) §5 R06/R12。

## 1. 本次实现

- 新增集合：`identity_applications`、`identity_reviews`（追加式）、`identity_private`（受限密文）。
- `lib/verification.mjs`（`VerificationService`，组织内）：
  - `createApplication`：org admin 代理或本人（actorType=user）；draft + documentVersion=1；提交人 submittedBy ≠ 被核验人 personId。本人可为未绑定档案提交（归属由人工审核证明）；他人已绑定档案拒绝。
  - `submit`：draft→submitted。必须有私有 fileIds（否则 422 `PRIVATE_FILE_REQUIRED`）、文件校验适配器（DB-07 接口，未配置 503）、加密密钥（未配置 503）；外部校验与加密均在事务外。证件号标准化（大写）后 HMAC 摘要写入申请。
  - `supplement`：仅 needs_info；documentVersion+1、密文重写、旧审核历史保留。
  - `review`：显式权限点 `identity.review`（org admin + 权限点，角色本身不够）；**审核人≠申请提交人**（自审/代理自批 403）；仅 submitted 可审（重复审批 409 `INVALID_STATE`）；documentVersion 不符 409 `STALE_DOCUMENT`；expectedRevision 不符 409。追加 `identity_reviews`（含 documentVersion）。approve 写组织内 `verified-person` 唯一占位（org+证件类型+身份 HMAC）：同身份核验到第二人员 409 `IDENTITY_CONFLICT`，转人工。
  - `getApplication`/`listApplications`：脱敏视图（无摘要/密文）；队列需 `identity.review`；org 过滤+统一分页。
  - `readPrivate`：`identity.readPrivate` 权限点 + **每次读取强制审计**；AES-256-GCM 解密仅在权限与审计通过后进行。
  - `providerStart`：503 `PROVIDER_DISABLED`，无外部调用、不伪造成功。
- 私有资料加密：AES-256-GCM（随机 IV），密钥注入（`IDENTITY_ENCRYPTION_KEY` 环境变量或 createApp 配置；demo 固定密钥明确标注禁生产），密钥不入库不入代码。
- `lib/org.mjs`：`grantMembership` 支持显式权限点白名单（identity.review/identity.readPrivate/blacklist.*）。
- `lib/persons.mjs` `claimAccount` 按 DB-03 F02 结论**重开**：必须提供 approved 且 **submittedBy=调用者本人（actorType=user）** 的申请（代理人提交的批准不能用于认领）；同时校验已验证登录身份、档案未绑定、org+userId 唯一占位；缺证明拒绝且零写入。
- `/api/v2/identity-applications` 路由：create/submit/supplement/review/provider-start（POST 均幂等）、GET 列表/详情/private。
- 后台版本 0.5.0-beta.1（lock 同步）。

## 2. 关键设计决定（请重点评审）

1. **认领归属链**：本人（user）为未绑定档案提交申请 → 审核员批准（归属由人工审核证明）→ 该账号凭 approved 申请认领。管理员代理提交的申请 submittedBy 为后台账号，任何用户账号都不能用它认领档案（防代理冒领）。
2. **资料版本不可变**：提交后版本冻结；补件只增版本；审核绑定决定时版本；并发补件使待审请求 STALE_DOCUMENT。
3. **权限点独立于角色**：org admin 无 identity.review 也不能审/看队列；私有读取另需 identity.readPrivate 且逐次审计。
4. **approved ≠ 入住许可**：审核通过只写 verified-person 占位，不写 occupancies/设备/门锁（DB-05 范围）。
5. **Q03 未决**：证件类型暂配置白名单（id-card/passport/other），资料保留期限与清理任务未定；测试全部使用伪造号码。

## 3. 未解决问题（移交评审/后续任务）

- 主租客代理提交（需 DB-05 有效关系证据）未实现；withdrawn 撤回动作未实现。
- 文件实体（DB-07）未实现，fileValidator 为接口注入；HTTP 演示通过 createApp 注入测试适配器。
- 密钥轮换（加密 keyVersion 多版本解密）、身份摘要轮换与 DB-03 一样仅预留版本字段。
- 云端事务/索引/安全规则未实测（DB-08）；私有资料访问审计保留策略待 Q03。
- claimAccount 仍仅服务层（无 HTTP/云函数入口）；getMyProfile 用户上下文派生要求同 DB-03 记录。

## 4. 已执行检查

- `admin-web`：`npm test` **109 项全部通过**（99 项 DB-03 及既有回归 + 10 项新增：verification.test.mjs 8 项 + verification-http.test.mjs 2 项）。覆盖：全流程加密与审计、缺文件/适配器/密钥拒绝、自审 403、重复审批 409、补件版本与 STALE_DOCUMENT、REVISION_CONFLICT、同身份第二人员冲突、权限点独立、本人认领成功与唯一绑定、代理提交不能认领、HTTP 权限/伪造 org/provider 关闭。
- 根目录：`npm test` 51 项通过；`npm run check` 通过。
- 未运行：`test:sdk`、`test:browser`、云端探针（DB-08）。

## 5. 验收矩阵映射

| 需求 | 覆盖测试 |
|---|---|
| R06 人工实名 | 版本与审批并发（STALE_DOCUMENT/REVISION_CONFLICT）、自审拒绝、重复审批、私有资料越权 403+审计、provider 禁用无网络 |
| R12 无账号人员 | 本人提交→批准→认领全链路、代理提交不可认领、同账号唯一绑定冲突 |
| 已核验唯一 | 同组织同证件第二人员 approve 409 IDENTITY_CONFLICT |
