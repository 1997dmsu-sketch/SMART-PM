# DB-03 第一轮审查：需返工

提交 `a06c50a`，分支 `feat/db-03-user-identity`，基线 `8b2d183`。仅代码审查及临时本地验证，未修改开发代码、未合并或上线。

## F01 [P2] 人员列表未处理分页默认值及参数校验

位置：`admin-web/lib/persons.mjs:81–83`，调用方 `admin-web/server.mjs` 的GET /api/v2/persons。

listPersons直接把query.limit交给page，没有复用pageParams。未传limit时start+limit是NaN，slice最终返回空数组；默认接口即使已有人员也显示空列表。HTTP传入limit为字符串，也没有1–100整数校验，分页超量/非法输入行为不符合契约。

独立临时库复现：创建一个人员后listPersons({})返回data=[]，listPersons({limit:20})返回该人员。

修复：在服务入口统一pageParams(query={})再分页，保留数据库组织过滤。补HTTP默认参数、非法/0/负数/大于100、字符串数值、超过一页的cursor翻页测试。

## F02 [P1，服务层启用前阻断] 人员认领并未证明档案属于调用者

位置：`admin-web/lib/persons.mjs:124–147`。

claimAccount仅验证调用者存在bound手机号/微信身份，然后把传入personId绑定给callerUserId；没有approved实名申请、被核验人员、资料版本或其他归属证明。调用者是本人账号不等于目标人员档案是本人。

独立复现：管理员创建未绑定的某住户档案；另创建已验证登录账号；不提供任何实名证明调用claimAccount，返回成功并改写person.userId。测试没有构造本人归属证明却期待成功，不能称为“本人认领验证”。

当前没有HTTP入口，故不是已经开放的远程认领漏洞；交接文档也承认等待DB-04，但方法本身可执行且没有生产关闭检查，容易被后续适配器直接接入。

修复：本期直接返回POLICY_UNDECIDED/IDENTITY_NOT_APPROVED且不写任何数据；或引入默认关闭、可在服务端验证的实名证明策略，只有绑定申请人、personId、orgId、资料版本且approved才允许。不要以调用方注释约定代替代码拒绝。补“有手机号身份但无本人证明仍拒绝且零写入”测试。

## F03 [P1，身份唯一性] keyVersion变化会把同一身份注册为第二个用户

位置：`admin-web/lib/identity.mjs:44–55`、loginOnce的身份查询及schemaVersion=2旧用户跳过逻辑。

keyVersion和密钥参与固定身份ID计算；新版本只查询新摘要，不查旧版本映射，而users预扫描又忽略全部schemaVersion=2用户。于是服务重启更换keyVersion或密钥后，所有旧映射不命中，新登录被当作新注册。

独立复现：同一store、同一HMAC密钥、同一已验证手机号+微信，分别用keyVersion=1和2执行loginWithPhone，两次均成功、userId不同。无需真实供应商或网络请求。

修复：若本期不实现多版本迁移，则持久化登录域的摘要配置版本/密钥指纹，初始化或登录时发现不匹配立即拒绝，阻止悄悄创建新用户；不能只在文档写“轮换待补”。后续轮换采用受控旧新摘要查找、固定用户ID及事务迁移协议。补同域版本变更、同版本换密钥、滚动部署两个版本、旧用户停用后变更密钥仍不能绕过等测试。指纹不得泄露密钥原值。

## 已验证范围与其他上线条件

- 后台npm test：96项通过；根目录npm test：51项通过；9页静态检查通过。
- 三项新增场景用独立临时LocalStore及模拟验证适配器复现，数据已清理，未调用付费服务。
- IdentityService尚未接入phoneLogin/login云函数；不能称现有小程序已具有手机号唯一性或新登录能力。云端并发与旧入口封闭仍是后续切换门槛。
- 全局身份服务仍全量扫描users/auth_identities，规模增大受store上限约束；后续采用固定ID点查和明确旧数据迁移映射。
- 私有getMyProfile(userId)未来必须由认证上下文派生userId，不能直接信任客户端指定。
- 不在本轮实施实际换号、实名供应商或门锁权限变更。

## 给开发AI

继续原分支修复F01–F03，增加上面列出的回归用例；目前可以将未实现的认领/轮换路径明确关闭，无需越界实现DB-04。提供新提交hash、测试结果及尚未接入部分，再交叉审查。不要合并main、迁移生产数据库或把手机号验证当成人员实名验证。
