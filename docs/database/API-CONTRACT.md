# DB-01：接口契约（待实施）

与 [数据模型](DATA-MODEL.md) 配套。本文件定义目标行为，不表示接口已经存在。业务规则由同一服务层执行，网页HTTP和小程序云函数不能各自实现不同权限。

## 1. 公共约定

- 新网页接口前缀 `/api/v2`，保留当前 `/api/*`，不得在文档版本中修改现有响应格式。
- 成功：`{data,requestId,nextCursor?}`；失败：`{error:{code,message},requestId}`，不泄露其他组织数据存在性。
- HTTP 400参数错误、401未登录、403权限不足、404组织内不可见/不存在、409状态/唯一性/版本冲突、422资料不完整、503适配器不可用。
- 列表cursor分页，limit默认20最大100；服务端组织过滤先于分页/计数。禁止先全量加载再客户端筛选组织。
- 写请求带 `Idempotency-Key`；修改已有记录需 `expectedRevision`。同key同输入返回原结果；同key不同输入409。幂等key绑定actor+org+路由，记录保留期在实现时设配置并记录；超过有效期的客户端重试须先查询状态。
- 网页保留HttpOnly会话、Origin和CSRF检查；小程序身份从云函数OPENID取得。body中的userId、orgId、role均不能作为权限依据。
- 管理员选择组织只是请求上下文，服务端必须查有效成员关系和权限。后台账号与住户身份不自动等同。
- 状态变更、审核、名单解除都是显式动作，不通过任意字段PUT实现。

## 2. 组织及物业（DB-02）

| 接口 | 权限 | 输入/返回及约束 |
|---|---|---|
| GET /api/v2/me/organizations | 已登录 | 仅可访问组织及角色，不返回全组织目录 |
| GET /api/v2/property/catalog | 组织成员；写权限另校验 | kind,parentId,cursor,limit；服务端org限定 |
| POST /api/v2/property/create | org admin | 保留new/existing模式；buildingName、communityId或communityName；返回已有概念的两类ID |
| POST /api/v2/property/catalog | org admin | kind及白名单字段；同组织父级、有效状态、唯一占位 |
| POST /api/v2/property/{type}/{id}/archive | org admin | expectedRevision,reason；有有效关系/未处理展示返回ARCHIVE_BLOCKED及非敏感统计 |
| GET /api/v2/rooms | 组织权限 | buildingId,floorId,status,cursor；返回roomId、houseId明确区分 |
| POST /api/v2/property/layout | org admin | ids最多30、layoutId、expectedRevisions；保留公共标记与关联房源同事务同步 |

旧自动生成接口输入规则保留；新内部实现须统一唯一占位，不能同时留两套不同的创建规则。

## 3. 用户与身份（DB-03）

小程序新适配动作建议命名 `identityGateway`，以下为逻辑动作而非已部署云函数：

| 动作 | 输入 | 行为 |
|---|---|---|
| loginWithPhone | 微信临时phoneCode；幂等requestId | 服务端获取appId/OPENID与验证后的手机号，事务解析用户，返回userId及登录态，不返回完整users记录 |
| getMyProfile | 无目标userId | 返回本人脱敏资料和组织内关系概览 |
| requestPhoneChange | 新手机号验证凭据、近期账户身份确认凭据 | 旧身份已认证且新手机号已验证；旧手机号释放与新绑定同事务，策略Q04未定前关闭 |

错误码：PHONE_ALREADY_BOUND、IDENTITY_CONFLICT、USER_DISABLED、REVISION_CONFLICT。对未认证请求使用概括提示避免手机号枚举。未授权手机号不能拿字符串直接登录。仅有OPENID的旧用户可以保持低权限账号，不因此获得有效住户关系。

网页短信登录本轮只预留凭据验证适配器，不新增短信供应商或付费请求。

## 4. 人工实名（DB-04）

| 接口 | 权限 | 输入/输出 |
|---|---|---|
| POST /api/v2/identity-applications | 本人或合法代理人 | personId及关系/邀请引用，建draft，返回applicationId/documentVersion；提交人不等于被核验人 |
| POST /api/v2/identity-applications/{id}/submit | 本人或获准代理人（管理员/本房有效主租客） | expectedRevision、资料版本、私有fileIds；服务端验证文件归属/用途，转submitted |
| POST /api/v2/identity-applications/{id}/supplement | 本人或获准代理人（管理员/本房有效主租客） | 仅needs_info，新资料版本；旧审核历史不覆盖 |
| GET /api/v2/identity-applications/{id} | 本人脱敏；审核员限定组织 | 普通查询不含完整证件；敏感读取另授予权限并留日志 |
| GET /api/v2/identity-applications | identity.review | 组织内待审队列分页 |
| POST /api/v2/identity-applications/{id}/review | identity.review且非本人 | decision:approve/needs_info/reject,reason,expectedRevision,documentVersion；事务追加review |
| POST /api/v2/identity-applications/{id}/provider-start | 显式核验权限 | 本期返回503 PROVIDER_DISABLED；无外部调用 |

失败示例：STALE_DOCUMENT、INVALID_STATE、PRIVATE_FILE_REQUIRED。approved仅表示相应版本人工核对完成，不自动激活房间关系。

## 5. 租住关系（DB-05）

| 接口 | 权限 | 语义 |
|---|---|---|
| GET /api/v2/rooms/{roomId}/occupancies | org admin；当前主租客仅可见本房必要成员信息 | 分页返回有效与历史（普通住户限自身），隐藏证件与黑名单原因 |
| POST /api/v2/rooms/{roomId}/occupancy-cycles | org admin | primaryPersonId,startsAt,endsAt；创建pending周期及主租客候选关系；激活时再争用主租客槽，创建不授权 |
| POST /api/v2/occupancies | org admin或本房有效主租客 | roomId,personId,cycleId,role,startsAt,endsAt；主租客仅能member；创建待激活关系，不自动授权 |
| POST /api/v2/occupancies/{id}/activate | org admin（建议Q05） | expectedRevision、identityApplicationId；事务重新检查组织、房间、实名、sponsor、唯一槽、黑名单及期限 |
| POST /api/v2/occupancies/{id}/end | org admin；自助退租后续另设计 | expectedRevision,reason,endsAt；主租客结束须同事务结束整个周期，普通成员结束仅影响自身 |
| POST /api/v2/rooms/{roomId}/primary-transfer | org admin | 旧周期/关系ID、新候选personId及版本；结束全体旧关系并建新周期，不接受直接改原关系personId |

错误码：PRIMARY_OCCUPIED、DUPLICATE_OCCUPANCY、IDENTITY_NOT_APPROVED、SPONSOR_INACTIVE、BLACKLIST_REVIEW_REQUIRED、ROOM_ARCHIVED、POLICY_UNDECIDED。名单命中只给用户“需管理员复核”，不给名单证据详情。

主租客手机号不是其他成员的登录身份。无账号人员使用personId，无需虚构手机号。新增人员接口：`POST /api/v2/persons`，管理员或有效主租客可创建必要人员档案（主租客需房间/邀请上下文），不因此获得任意人员查询权限；`POST /api/v2/persons/{id}/claim-account`须本人身份验证与组织内唯一绑定事务，不允许代理人直接绑定自己账号。

租住响应包括storedState、effectiveState、cycleId、effectiveEndsAt。整户退租提交后立即返回全周期结束，历史补写任务状态另返回materializationJobId；前端/设备不得用storedState判断权限。

## 6. 内部黑名单（DB-06）

| 接口 | 权限 | 语义 |
|---|---|---|
| POST /api/v2/blacklist | blacklist.manage | subjectType/userId/personId或受限身份引用,reason,evidenceFileIds,restrictions,startsAt,endsAt；服务端计算身份摘要及guard |
| GET /api/v2/blacklist | blacklist.read | 组织内分页，脱敏；普通主租客不开放 |
| POST /api/v2/blacklist/{id}/revoke | blacklist.manage | expectedRevision,reason；写guard epoch与审计 |
| POST /api/v2/occupancies/{id}/blacklist-review | blacklist.review | 决定allow/deny、理由和名单版本；只对此次申请有效，名单变化后旧放行不可复用 |

服务端内部 `checkEligibility` 是激活事务一部分，不暴露可以批量查询姓名/手机号的公共名单查询接口。不因调用名单接口触发门锁写操作。

## 7. 文件（DB-07）

- `POST /api/v2/files`：有用途权限的上传；purpose决定大小、格式与visibility；返回fileId，不允许客户端选NAS密码或任意物理路径。
- `POST /api/v2/file-links`：entityType/entityId/fileId/usage；校验同组织、业务编辑权与文件就绪。
- `GET /api/v2/files/{id}/download`：每次校验引用对象与purpose权限；私有文件代理下载或短期签名URL，读取审计。
- `POST /api/v2/file-links/{id}/detach`：只移除关联；文件回收按保留策略另执行。
- NAS未配置返回STORAGE_UNAVAILABLE，不把私密资料改存公开路径作为回退。

## 8. 旧入口兼容与切换要求

| 旧入口 | 切换要求 |
|---|---|
| phoneLogin / login | 共用身份解析服务，保留旧返回封装以兼容客户端；新关系不能被owners回填覆盖 |
| 网页 users/{id}/binding 与 houseAdmin bind/unbind | 切换组织后禁用直接数组写入或转同一关系服务；不能按旧bind请求推断主租客或审核通过 |
| getDevices/unlock及其他设备相关函数 | 完整盘点所有权限入口；保持旧设备行为直到专门权限切换验收，不能隐式启用真实开门 |
| getHouses/contentList | 加可信组织范围和归档过滤；按白名单返回，不向客户返回私有实名文件 |
| 旧图片/VR URL | 保留兼容映射；新私有资料绝不复用旧公开上传路由 |

所有旁路封闭是上线门槛，不是可忽略的后续优化。
