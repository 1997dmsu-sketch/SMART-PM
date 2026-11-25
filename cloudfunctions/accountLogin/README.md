# 管理员开通的租客账号密码登录

该入口是当前微信身份的另一种登录方式，不能凭用户名和密码切换到其他微信用户。
业务权限仍来自服务端 `OPENID → users.houses`；本功能不创建 bearer/session token，
不复用管理后台的 `accounts.json`，也不因停用密码入口撤销微信或手机号登录权限。

获取开户码功能已按最新需求**取消**：`accountLogin` 不再接受 `action:'prepare'`
（一律返回 `AUTH_FAILED`），旧开户码与旧消费通路不得继续开户。租客首次使用先在
「我的」页面用微信手机号登录完成注册（`phoneLogin` 经服务端核验手机号后创建/复用
住户），再由管理员在后台选择该住户开通账号密码。

## 流程与接口

1. 租客调用 `phoneLogin({code})`，服务端向微信核验手机号凭证成功后自动创建或复用
   canonical 用户，同一事务写入手机号、验证时间及私有手机号证明。
   不能仅凭 `users.phone` 或 `phoneBoundAt` 判断可信注册；注册本身不授予房屋或门禁权限。
2. 管理员在已有后台会话内从“已验证手机号住户”列表选择住户，提交用户名和初始密码。
   服务端按所选 `userId` 重新读取并核验手机号证明及微信身份，不接受页面自报的手机号或 openid，
   也不接受旧 requestCode。账号首次创建、身份索引及审计同事务提交；不能用重复开户
   隐式重置已有密码。
3. 租客调用 `{action:'login',username,password}`。成功顶层返回 `{code:0,userInfo}`；
   用户不存在、密码错误、微信不匹配、手机号证明缺失、停用或限速统一为 `AUTH_FAILED`，数据库／
   身份状态无法确认则为 `SERVICE_UNAVAILABLE`。不回显输入、密码、哈希、盐或内部错误。

用户名 trim 后转小写，必须符合 `^[a-z0-9][a-z0-9._-]{3,31}$`。密码保留原文，
不 trim、不做 Unicode 归一化，长度8–128个 JavaScript 字符单位且 UTF-8 不超过256字节。

## 凭据与管理员操作

原密码仅用于请求处理和哈希计算，不保存到任何集合、日志、审计或 DTO。持久保存的
凭据是 `scrypt-v1`（N=16384、r=8、p=1、keylen=64、maxmem=64MiB），每次开户／
重置使用独立32字节随机盐。认证比较使用 `timingSafeEqual`，未知或不可用账号仍执行
相同参数的虚拟哈希计算。JavaScript 字符串内存不能承诺可靠擦除。

纯服务 `lib/service.js` 导出 `TenantAccountService({db,now})`：

- `listAccounts(actor)`：只返回公开账号 DTO，按 `_id` 升序100条/页读取至短页，
  上限10000。不会静默丢掉第101条以后的账号；超过上限或遇损坏记录失败关闭，
  分别为 `ACCOUNT_LIST_LIMIT` / `ACCOUNT_DATA_UNVERIFIED`。多页读取不承诺同一时点快照。
- `listVerifiedUsers(actor)`：只返回手机号、验证时间、完整微信身份和私有手机号证明
  一致的住户，投影仅 `userId/phone/name/houses`，不含 openid；
  上限5000，超限失败关闭。
- `createAccount(actor,{userId,username,password})`：只为已验证手机号住户开通，
  未验证为 `USER_NOT_VERIFIED`；身份索引与用户不一致为 `IDENTITY_UNVERIFIED`；
  账号及微信绑定 create-only。
- `resetPassword(actor,{accountId,newPassword,expectedRevision})`：CAS 推进 revision 与
  credentialVersion；重置不自动启用已停用账号，也不更改微信绑定。
- `setStatus(actor,{accountId,status,expectedRevision})`：status 仅 active/disabled，
  CAS 推进 revision；UI 必须称为“密码入口停用”，不能称为全局封号。

actor 的 id/role 必须来自后台已验证会话，不能透传请求体；允许可选安全 name 元数据。
全部管理员写入及 audit 在真实事务内提交，没有事务能力时失败关闭。公开 DTO 仅含
`id/username/userId/status/revision/credentialVersion/createdAt/updatedAt`。
管理员授权、会话吊销、Origin 和 CSRF 继续由既有后台前置处理。

管理后台 live 模式通过 `TenantAuthCloudDatabase` 将共享服务的微信 SDK 写入封装
转换为 `@cloudbase/database@2.0.0` 接受的裸文档；移除写入体的 `_id`，保留文档路径。
事务提交、回滚和冲突重试仍由管理 SDK 负责。此适配不改变微信云函数的 SDK 协议。
当前仅核对已安装 SDK 源码并通过严格假 SDK 契约测试，未验证实际云环境。

密码计算在事务外进行，最终登录事务重新读取当前账号 revision、credentialVersion、
状态、微信索引、用户绑定和当前手机号证明，因此重置或“停用后重新启用”的 ABA
不能放行旧验证结果。历史账号缺少证明时先完成当前微信的手机号授权，不删除账号或房屋绑定。

## 身份与兼容

`login/phoneLogin/adminLogin/accountLogin` 各自部署目录包含同字节的
`lib/identity-core.js`，不能运行时跨兄弟云函数目录 require。发布校验应核对四份
字节哈希一致，并将四个云函数作为同一兼容发布批次。
`phoneLogin/accountLogin` 的 `lib/phone-proof.js` 两份也必须逐字节一致。

身份索引以可信 APPID+OPENID 派生确定性 ID，新用户也使用确定性 ID；历史唯一用户
保留原 userId、角色和房产。`users.wechatAppId` 是服务端绑定标记，不接受客户端修改。
历史同 OPENID 多条记录、已绑定其他 APPID、索引与用户不一致时失败关闭；不自动挑第一条、
合并房产或修复历史记录。事务外有限查询只发现旧记录，事务内按固定 ID 重新读取绑定。
所有受支持用户创建入口共享索引，但不承诺检测管理员绕过接口直接注入的任意重复记录。

手机号登录仅接受微信手机号授权的临时 `code`，不会接受客户端自报的手机号或身份。
该微信凭证不是已取消的开户码。私有 `tenant_auth_phone_bindings` 的记录 ID 由
APPID 和手机号确定性派生，同一事务绑定 canonical user，防止不同微信并发占用同一手机号。
同一微信重复授权复用住户；同一手机号跨微信、历史重复、已有不同手机号等冲突返回409，
不自动换号、转移账号或合并房产。旧住户可重新授权同一手机号补证明，已有合法绑定保留。
查询或验证失败不写入用户及证明。注册和密码登录不导入 `owners`，不新增房屋或门禁权限。

## 持久限速

认证前由真实事务预留当前微信身份的预算：登录每15分钟最多10次。成功也消耗该窗口
额度，不在并发成功时清零；跨进程／服务实例仍使用同一记录。时钟无效、回退、计数
损坏或预算提交失败均失败关闭。限速记录是预留事实，即使后续认证失败也保留，
不能要求失败登录“全库零写”而删除该记录。

## 部署前必须核验的数据库权限与索引

本文件没有部署或改变任何真实权限。下列集合必须设置为**客户端拒绝读写、
仅受信云函数/后台服务端 SDK 访问**：

`tenant_auth_identities`、`tenant_auth_phone_bindings`、`tenant_auth_accounts`、
`tenant_auth_rate_limits`、`tenant_auth_audit`。另外，涉及权限的 `users` 字段只能由
受信服务端写入，不能由租客客户端修改。历史 `tenant_auth_enrollments` 数据保留
（不擅删），但新流程不再生成或消费开户码。

每个 tenant_auth_* 集合在控制台“自定义权限”中的目标模板为：

```json
{ "read": false, "write": false }
```

这是逐集合的客户端权限意图，须核对目标 CloudBase 环境当前支持的规则语法，
不是已部署配置导出，也不是可直接写进云函数 config.json 的批量导入文件。
users 至少拒绝客户端修改 `_openid/wechatAppId/phone/phoneBoundAt/role/houses/housesManaged`；现有
资料编辑若需保留，应经已有受控服务端白名单，不开放整文档写入。

部署前还需在目标环境核对/创建索引：`users.phone`（手机号跨微信冲突检查依赖，
查询失败时登录失败关闭）、`rooms.houseId`（houseAdmin 绑定校验依赖）。
索引由平台控制台维护，仓库无自动建索引脚本。

上线前应验证：客户端直接读取哈希/限速记录或篡改索引／角色／房产均被拒；
受信服务端事务可用；平台请求体诊断不会保存密码。未核验规则前不能声称凭据已受保护。

## 验证边界

仓库测试使用 SDK 形状的内存 DB、实际 scrypt、默认 Node 测试隔离及预载网络 guard，
覆盖并发创建、回滚、限速、过期重放、跨微信、reset/disable ABA 和部署副本一致性。
这些不是实际 CloudBase 事务、微信认证、生产数据库规则或真机验证。
没有执行 SDK.init、部署、真实账号开通／重置、支付、设备或发布操作。
