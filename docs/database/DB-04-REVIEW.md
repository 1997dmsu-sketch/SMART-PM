# DB-04 第一轮审查：需返工

审查提交 `dab513d`（feat/db-04-identity-review），基线 `c407027`。结论：存在4项需修复的问题，暂不建议合并。仅本地审查与临时数据验证，未操作真实身份资料、云数据库或门锁。

## F01 [P1] live模式仍使用公开演示密钥

位置：`admin-web/server.mjs:100–108`。

IDENTITY_HMAC_KEY缺失时无条件使用代码里的固定字符串，IDENTITY_ENCRYPTION_KEY缺失时无条件使用Buffer.alloc(32,7)，没有mode限制。即使mode=live也会如此。注释“禁生产”没有运行时保护。配置fileValidator后，可用公开已知密钥加密真实证件资料，破坏私有资料保密性；也不符合未配置密钥时拒绝的设计。当前默认fileValidator为空会阻止提交，但不能以此代替密钥检查。

修复：演示密钥仅允许明确demo模式；live缺少任一密钥、加密密钥非严格64位hex/解码非32字节时启动失败或关闭实名能力。不要把密钥值写进错误或日志。增加live缺配置/错误格式/合法配置测试。

## F02 [P1] 证件摘要路径绕过DB-03配置保护，可重复核验同一身份

位置：`admin-web/lib/verification.mjs:175–186`、review的verified-person占位逻辑。

submitDocument直接调用identity.digest，不执行IdentityService登录事务里的identity_domains检查。更换HMAC密钥或keyVersion后，同一证件生成新的占位ID，审核可以将其批准给另一人员。DB-03登录的保护不覆盖实名HTTP流程。

独立LocalStore复现：同组织、同证件类型和号码，分别用keyVersion=1与2提交到两个人员并批准；两项均approved，未返回IDENTITY_CONFLICT。没有使用真实供应商。

修复：建立适用于实名摘要的持久配置保护，在提交/补件/批准事务中校验摘要配置与申请版本，变化时拒绝且零写入；若本期不做轮换，明确失败关闭。覆盖同版本换密钥、换版本、旧申请待审时变更配置、并发不同配置及停用旧配置场景。已有记录缺少配置文档时需受控初始化，不应直接采用任意新配置。

## F03 [P2] 审核队列超过一页后无法翻页

位置：`admin-web/lib/verification.mjs:344–359`。

listApplications在page之前把_id改名为applicationId；通用page使用_id排序、匹配cursor和生成nextCursor。于是即使还有数据也返回nextCursor=undefined，显式传applicationId作cursor也会报无效游标。

独立复现：创建22项申请，默认查询返回20项、nextCursor为undefined，其余2项无法通过游标访问。

修复：先对保留_id的组织过滤结果分页，再转换脱敏DTO；或明确让page使用指定主键。补超过20项及带state过滤的HTTP/服务层多页测试，断言无漏项、重复和跨组织数据。

## F04 [P2] 补件覆盖旧资料，历史审核无法还原对应版本

位置：`admin-web/lib/verification.mjs:181–183,198–222`。

identity_private始终用applicationId作为同一文档ID，补件写入v2会覆盖v1密文，同时application.fileIds被新列表覆盖。identity_reviews虽保留documentVersion=1，却没有指向原资料或原文件列表的不可变快照。违反DATA-MODEL审核事务“补充资料产生新版本，不能修改已提交的版本内容”的要求。

独立复现：提交v1，needs_info后更换号码与文件补件，identity_private仅剩documentVersion=2；application仅保留替换后的文件ID。无法重现v1审核所依据的证据。

修复：按applicationId+documentVersion追加私有资料及文件引用快照，申请只更新当前版本指针，审核引用确切快照。保留受限权限和逐次读取审计；历史数据清理由明确保留策略处理。补v1/v2内容不同、旧审核仍能定位v1证据、越权不可读取旧版本的测试。

## 验证结果与范围

- 后台npm test：109项通过；根目录npm test：51项通过；9页静态检查通过（867 KiB）。现有测试未覆盖上述分页/密钥变化/历史资料内容场景。
- F02–F04使用独立临时LocalStore、虚构证件值和模拟文件校验器复现，已清理。F01为明确的live代码分支审查。
- 本轮不把第三方适配器关闭、无云端探针视为实现错误；仍需DB-07文件接入和DB-08云端验证后才可上线。
- claimAccount仍仅服务层；主租客代提交尚未实现。后续须从认证上下文建立主体权限，不应依赖任意调用方提供的audit字段判断本人或代理人。

## 交给开发AI

在原DB-04分支修复F01–F04并补回归测试，更新DB-04-IMPLEMENTATION.md，提供新提交哈希。不要合并main、发布产品版本或迁移生产资料。修复范围保持人工审核与安全关闭，暂不实现第三方核验或完整密钥轮换。
