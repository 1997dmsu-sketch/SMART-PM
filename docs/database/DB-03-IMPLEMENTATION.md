# DB-03 实施交接：唯一用户与手机号身份

状态：首轮审查（`dbe293c`，F01–F03）不通过项已返工完成，修复映射见 §6。基线 `feat/db-02-org-scope-archive` 提交 `8b2d183`（DB-02 第三轮审查通过点），开发分支 `feat/db-03-user-identity`。未修改 DB-02 分支与 main。
范围仅限 admin-web 服务端；未修改登录云函数、实名、门锁逻辑，未调用付费短信或实名接口，未连接或操作真实云环境。DB-07 文件仅保留接口引用，未实现。
依据文档：[数据模型](DATA-MODEL.md) §2/§3、[接口契约](API-CONTRACT.md) §3/§5、[迁移方案](MIGRATION-PLAN.md) §5 R03/R12。

## 1. 本次实现

- 新增集合（LocalStore/CloudStore 白名单）：`auth_identities`（全局身份映射）、`persons`（组织内人员档案）、`identity_domains`（登录域摘要配置，F03 新增）。
- `lib/identity.mjs`（`IdentityService`，全局服务）：
  - 手机号标准化（去空格/连字符、`00`→`+`、大陆 11 位补 `+86`，校验 `^\+[1-9]\d{6,14}$`）；`maskPhone`/`maskName` 脱敏。
  - 身份摘要：服务端 HMAC-SHA256（密钥构造注入 + `keyVersion`，默认 1），scope 为 loginRealm（phone）或 appId（wechat）；**只存摘要，不存明文手机号/OPENID**。
  - `auth_identities` 固定 ID（`ident-<digest前32位>`）即唯一占位（DATA-MODEL §3.1 "读取固定 auth_identities ID"），记录 kind/appId/subjectDigest/keyVersion/userId/verifiedAt/status(bound)。
  - `loginWithPhone({phoneCredential, wechatCode})`：事务外经 gateway 适配器验证手机号（及可选微信主体）→ 事务内解析双映射：均无→建用户+双映射；单映射→同事务补另一映射；双映射指向不同用户→409 `IDENTITY_CONFLICT`；用户停用→403 `USER_DISABLED`；账号已有其他手机号→409（换号未开放）；旧无映射用户（按旧 phone/_openid 字段匹配，事务内复核）→409 须先迁移，**不忽略旧用户直接新建**。
  - `loginWithWechat`：仅微信映射；无映射创建低权限账号（role=user，无组织成员、无设备绑定）。
  - `getMyProfile(userId)`：仅脱敏字段 + 身份类别/验证时间 + 本人 persons 概览；不返回完整 users 记录、不返回 OPENID/设备绑定。
  - `requestPhoneChange`：Q04 未定，503 `POLICY_UNDECIDED`，不释放任何占位。
  - 用户文档记录 `phoneIdentityId`/`wechatIdentityId` 映射槽，在同事务内校验与写入，防止并发补绑穿透；预读后映射变更导致 refs 缺失时内部 `IDENTITY_RETRY` 重解析（≤3 次）。
- `lib/persons.mjs`（`PersonService`，组织内）：
  - `createPerson({name})`：org admin；**无手机号/凭据字段**，只存 `nameMasked`；userId=null 合法（R12）；HTTP 带幂等键。
  - `listPersons`：org 过滤先于游标分页。
  - `claimAccount`：**本期关闭**（审查 F02）。已验证登录身份不等于档案归属证明；在 DB-04 approved 实名申请能同事务绑定申请人+personId+orgId+资料版本之前，一律 503 `POLICY_UNDECIDED` 且零写入。
- `/api/v2/persons` 路由：GET（组织成员读）/ POST（org admin 写，幂等）；伪造 orgId 404 同态；分页统一 `pageParams`（默认 20、1–100 整数校验、游标校验）。
- 后台版本 0.4.0-beta.1（package.json 与 lock 同步）。旧 `users._id` 全保留；不写旧 users.houses/role；住户账号不产生任何 admin 权限。

## 2. 关键设计决定（请重点评审）

1. **gateway 适配器边界**：`verifyPhone(credential)` 与 `fetchWechatSubject(code)` 是唯一外部凭据入口；手机号/OPENID 只能来自适配器返回值，请求体中的 phone/openid 字段不被信任。未配置适配器返回 503 `PROVIDER_DISABLED`，无短信供应商、无付费调用。网页短信登录即此预留凭据适配器。未来 `identityGateway` 云函数只需实现该适配器并委托 `IdentityService`。
2. **并发注册收敛**：固定 ID 映射文档 + 单事务内重算全部决策；并发同手机号/同 OPENID 注册只产生一个有效用户。并发同手机号+不同微信：一个成功，另一个 409 `IDENTITY_CONFLICT`（一账号一手机槽一微信槽），不静默分叉账号。本地串行队列结果不构成云端并发证明（DB-08 探针门槛）。
3. **旧用户冲突**：旧 users 行（schemaVersion 非 2）若 phone/_openid 匹配且不是已映射本人，则 409 要求人工迁移；旧 ID 永不改写、不自动合并。
4. **claimAccount 已关闭（返工后）**：手机号/微信验证只证明调用者是谁，不证明目标档案属于调用者。本期不实现归属证明，方法直接拒绝且零写入；未来须校验 approved 实名申请（申请人+personId+orgId+documentVersion）后才允许绑定。
5. **摘要配置指纹（F03）**：登录域固定文档 `identity-domain-{loginRealm}` 持久化 keyVersion 与 keyFingerprint（对配置元数据的 HMAC，不泄露密钥）；登录事务内发现版本或密钥不匹配即 503 `IDENTITY_CONFIG_CHANGED`，任何注册/登录路径都不能在配置不匹配时写库。滚动部署下旧版本实例不受影响。受控轮换（旧新摘要双查、固定用户 ID、事务迁移）仍是后续任务。
6. **审计**：登录/认领事务沿用 store 审计；审计载荷不含明文手机号、证件或 OPENID。

## 3. 未解决问题（移交评审/后续任务）

- `identityGateway` 云函数未部署（契约定义为逻辑动作）；loginWithPhone/loginWithWechat/getMyProfile/claimAccount 仅服务层，HTTP 仅 persons 管理端。
- claimAccount 已按审查关闭（见 §2.4），待 DB-04 实名申请关联后重开；手机号换绑 Q04 未定保持关闭。
- 旧 phoneLogin/login 云函数旁路未改（§8 切换门槛）；双写/投影策略属迁移阶段，本轮无。
- 云端并发、固定 ID 创建竞争、索引、安全规则未实测，属 DB-08 探针。
- `auth_identities` 的 valueCiphertext 加密原值存储未实现（当前只存摘要，无可逆原值）；受控密钥轮换（旧新摘要双查+事务迁移）未实现，配置变更目前只会安全拒绝（F03）。
- 释放/解绑身份（status=released）无入口；停用账号不释放占位（Q04 建议已遵循）。
- getMyProfile(userId) 未来接入时必须由认证上下文派生 userId，不能信任客户端指定（审查提醒已记录）。

## 4. 已执行检查

- `admin-web`：`npm test` **99 项全部通过**（82 项 DB-02 及既有回归 + 17 项新增：identity.test.mjs 15 项 + server-v2 HTTP 2 项）。覆盖：并发同手机号/同 OPENID 只建一户、双身份冲突、换号占位冲突、disabled、旧用户迁移冲突、脱敏存储无明文、gateway 关闭、keyVersion/密钥变更拒绝（含滚动部署与停用账号场景）、claimAccount 零写入关闭、persons 无账号创建、分页默认值/非法参数/游标翻页（服务层+HTTP）、HTTP 组织隔离与幂等。
- 根目录：`npm test` 51 项通过；`npm run check` 通过（9 页静态结构）。
- 未运行：`test:sdk`、`test:browser`、云端探针（DB-08）。

## 6. 修订记录（响应 dbe293c 审查）

| 审查项 | 修复方式 | 覆盖测试 |
|---|---|---|
| F01 人员列表分页默认值/校验 | `listPersons` 统一 `pageParams(query)`：默认 limit 20、1–100 整数、字符串数值、游标校验；org 过滤下推保留 | identity「F01: listPersons applies default limit…」+ server-v2「F01: persons HTTP pagination defaults…」（默认/0/负数/超100/非数字/字符串数值/跨页游标/无效游标） |
| F02 认领无归属证明 | `claimAccount` 改为关闭存根：503 `POLICY_UNDECIDED`，无任何数据写入；移除"已验证即可认领"逻辑 | identity「F02: claimAccount is closed without identity proof…」（按审查复现构造，拒绝且 person.userId 不变、零占位、profile 无关联） |
| F03 keyVersion/密钥变化重复注册 | 新增 `identity_domains` 固定文档持久化 keyVersion+keyFingerprint（HMAC，不泄露密钥）；登录事务内不匹配即 503 `IDENTITY_CONFIG_CHANGED` | identity 两项 F03 测试（同域版本变更、同版本换密钥、新手机号也不能绕过、滚动部署旧版本可用、停用账号+换密钥仍拒绝、域文档不含密钥原文） |

## 5. 验收矩阵映射

| 需求 | 覆盖测试 |
|---|---|
| R03 身份唯一 | concurrent identical registrations（4 路并发一户）、concurrent same-phone different-WeChat、双映射冲突、换号占位冲突、legacy 冲突不新建、USER_DISABLED |
| R12 无账号人员 | persons 无手机号创建（masked）；claimAccount 在实名审核接入前关闭且零写入（F02 回归） |
| 兼容性 | 旧 users._id 保留、role=user 不提权、旧 houses/role 字段不写、DB-02 82 项回归全过 |
