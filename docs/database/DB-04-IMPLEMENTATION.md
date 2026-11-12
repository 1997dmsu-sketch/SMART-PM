# DB-04 实施交接：人工实名审核

状态：已实现；首轮审查 `578ab17` 的 F01–F04 已返工，待复审。基线 `feat/db-03-user-identity` 提交 `c407027`（DB-03 首轮审查返工点），开发分支 `feat/db-04-identity-review`。未修改 DB-02/DB-03 分支与 main，未合并 main。
范围仅限 admin-web 服务端；未修改登录云函数、门锁逻辑，未调用实名/短信付费接口，未连接或操作真实云环境；测试仅使用伪造脱敏证件数据。
依据文档：[接口契约](API-CONTRACT.md) §4、[数据模型](DATA-MODEL.md) §2/§3.2/§5/§6、[迁移方案](MIGRATION-PLAN.md) §5 R06/R12。

## 1. 本次实现

- 新增集合：`identity_applications`、`identity_reviews`（追加式）、`identity_private`（按版本追加的受限密文快照）。
- `lib/verification.mjs`（`VerificationService`，组织内）：
  - `createApplication`：org admin 代理或本人（actorType=user）；draft + documentVersion=1；提交人 submittedBy ≠ 被核验人 personId。本人可为未绑定档案提交（归属由人工审核证明）；他人已绑定档案拒绝。
  - `submit`：draft→submitted。必须有私有 fileIds（否则 422 `PRIVATE_FILE_REQUIRED`）、文件校验适配器（DB-07 接口，未配置 503）、加密密钥（未配置 503）；外部校验与加密均在事务外。证件号标准化（大写）后 HMAC 摘要写入申请。
  - 实名摘要配置保护：每组织使用独立 realm `verification:{orgId}`，在提交、补件、审核事务内校验固定 `identity_domains` 文档中的 keyVersion 与密钥指纹；更换密钥或版本返回 503 `IDENTITY_CONFIG_CHANGED`，业务零写入。已有摘要但缺配置文档时拒绝自动初始化，须后续受控处理。
  - `supplement`：仅 needs_info；documentVersion+1；追加 `identity_private/{applicationId}-v{documentVersion}` 快照，保存当版密文和 fileIds，application.privateDataRef 指向当前版，旧版不再覆盖。
  - `review`：显式权限点 `identity.review`（org admin + 权限点，角色本身不够）；**审核人≠申请提交人**（自审/代理自批 403）；仅 submitted 可审（重复审批 409 `INVALID_STATE`）；documentVersion 不符 409 `STALE_DOCUMENT`；expectedRevision 不符 409。追加 `identity_reviews`（含 documentVersion，可按申请 ID+版本定位证据快照）。approve 写组织内 `verified-person` 唯一占位（org+证件类型+身份 HMAC）：同身份核验到第二人员 409 `IDENTITY_CONFLICT`，转人工。
  - `getApplication`/`listApplications`：脱敏视图（无摘要/密文）；队列需 `identity.review`；先对保留 `_id` 的组织过滤结果分页，再映射 DTO，游标可连续翻页。
  - `readPrivate`：`identity.readPrivate` 权限点 + **每次成功读取强制审计**；默认读取当前 privateDataRef，也可在服务层传 `{documentVersion}` 读取历史证据；响应含该版 fileIds。AES-256-GCM 解密仅在权限检查通过后进行。
  - `providerStart`：503 `PROVIDER_DISABLED`，无外部调用、不伪造成功。
- 私有资料加密：AES-256-GCM（随机 IV）。`server.mjs` 的 `identityKeyConfig` 只允许 demo 使用公开演示默认值；live 缺任一身份密钥即启动失败，`IDENTITY_ENCRYPTION_KEY` 必须严格为 64 位 hex（解码 32 字节），错误信息不携带密钥值。
- `lib/identity.mjs`：DB-03 登录域保护泛化为 `guardDomain(state, realm, {allowInit})`；原 `domainWrite` 保持登录 realm 行为不变，DB-04 复用同一指纹保护机制。
- `lib/org.mjs`：`grantMembership` 支持显式权限点白名单（identity.review/identity.readPrivate/blacklist.*）。
- `lib/persons.mjs` `claimAccount` 按 DB-03 F02 结论**重开**：必须提供 approved 且 **submittedBy=调用者本人（actorType=user）** 的申请（代理人提交的批准不能用于认领）；同时校验已验证登录身份、档案未绑定、org+userId 唯一占位；缺证明拒绝且零写入。
- `/api/v2/identity-applications` 路由：create/submit/supplement/review/provider-start（POST 均幂等）、GET 列表/详情/private。
- 后台版本 0.5.0-beta.1（lock 同步）。

## 2. 关键设计决定（请重点评审）

1. **认领归属链**：本人（user）为未绑定档案提交申请 → 审核员批准（归属由人工审核证明）→ 该账号凭 approved 申请认领。管理员代理提交的申请 submittedBy 为后台账号，任何用户账号都不能用它认领档案（防代理冒领）。
2. **资料版本不可变**：提交后版本冻结；补件只追加快照；审核记录 documentVersion，旧审核可定位当版密文与文件列表；并发补件使待审请求 STALE_DOCUMENT。
3. **摘要配置失败关闭**：实名与登录分别持久化域指纹；本期不实现轮换，配置变化、旧配置重试或历史数据缺域文档均拒绝，不允许同证件换摘要后核验给第二人。
4. **权限点独立于角色**：org admin 无 identity.review 也不能审/看队列；私有读取另需 identity.readPrivate 且逐次审计，历史版本不降低权限。
5. **approved ≠ 入住许可**：审核通过只写 verified-person 占位，不写 occupancies/设备/门锁（DB-05 范围）。
6. **Q03 未决**：证件类型暂配置白名单（id-card/passport/other），资料保留期限与清理任务未定；测试全部使用伪造号码。

## 3. 未解决问题（移交评审/后续任务）

- 主租客代理提交（需 DB-05 有效关系证据）未实现；withdrawn 撤回动作未实现。
- 文件实体（DB-07）未实现，fileValidator 为接口注入；HTTP 演示通过 createApp 注入测试适配器。
- 完整密钥轮换未实现：加密 keyVersion 多版本解密仍预留；实名摘要配置变化只安全拒绝，受控轮换/历史缺域文档初始化须另行设计执行。
- 历史私有快照的保留期限、清理任务与访问审计保留策略待 Q03；清理前必须核对审核追溯要求。
- 云端事务/索引/安全规则未实测（DB-08）。
- claimAccount 仍仅服务层（无 HTTP/云函数入口）；getMyProfile 用户上下文派生要求同 DB-03 记录。
- HTTP private 路由读取当前版本；指定 documentVersion 目前为服务层能力，审核界面/HTTP 历史版本入口尚未提供。

## 4. 已执行检查

- `admin-web`：`npm test` **120 项全部通过**（首轮 109 项 + 本轮 11 项）。新增覆盖：live 缺配置/错误 hex/合法配置与 demo 隔离；同版本换密钥、换 keyVersion、待审时变更、补件变更、并发不同配置、旧配置重试、历史摘要缺域文档；服务层与 HTTP 多页/state 过滤/组织隔离；v1/v2 不同密文与 fileIds、旧审核定位旧证据、历史版本越权 403。
- 根目录：`npm test` **51 项通过**；`npm run check` 通过（9 页，869 KiB；静态检查，非微信开发者工具编译或视觉测试）。
- 未运行：`test:sdk`、`test:browser`、云端探针（DB-08）。

## 5. 验收矩阵映射

| 需求 | 覆盖测试 |
|---|---|
| R06 人工实名 | 版本与审批并发（STALE_DOCUMENT/REVISION_CONFLICT）、自审拒绝、重复审批、私有资料越权 403+审计、provider 禁用无网络 |
| R12 无账号人员 | 本人提交→批准→认领全链路、代理提交不可认领、同账号唯一绑定冲突 |
| 已核验唯一 | 同组织同证件第二人员 approve 409 IDENTITY_CONFLICT；摘要配置变化不能绕过唯一占位 |
| 审核证据不可变 | v1/v2 快照同时可解密，fileIds 不覆盖，旧 review.documentVersion 定位旧证据 |
| 审核队列可用性 | 24 条服务层数据两页无漏无重、22 条 draft 过滤翻页、HTTP 22 条两页、跨组织不可见 |

## 6. 首轮审查返工与兼容性

| 审查项 | 修复 |
|---|---|
| F01 live 演示密钥 | demo-only 默认值；live 启动强制两项密钥配置与严格加密密钥格式 |
| F02 摘要绕过配置保护 | 每组织实名 realm 持久化指纹；提交/补件/审核事务校验，异常零写入 |
| F03 队列无法翻页 | 保留 `_id` 完成游标分页后再转换脱敏 DTO |
| F04 补件覆盖证据 | applicationId+documentVersion 追加快照；当前指针与历史受限读取 |

兼容性：既有 HTTP 请求/响应信封、权限点、审核 version/revision 协议不变；private 读取新增 fileIds 字段。首轮之前的单快照仍可通过 privateDataRef/申请 ID 读取当前资料，但当时已被覆盖的旧版本无法凭本修复找回；本修复不执行数据迁移。live 部署必须显式配置两项身份密钥，否则按设计启动失败。
