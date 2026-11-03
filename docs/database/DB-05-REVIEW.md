# DB-05 第一轮审查：需返工

PR：https://github.com/1997dmsu-sketch/SMART-PM/pull/6
提交：`68e376c`，分支feat/db-05-occupancies，依赖DB-06 `95dec9f`。本轮发现2项需修复问题，暂不建议合并或上线。

## F01 [P1] 激活和主租客操作未检查绑定账号有效性

位置：`admin-web/lib/occupancies.mjs` activate（382行起）、createOccupancy（295行起）、sponsorContext（205行起）。

激活事务读取persons但未读取其绑定users文档，也未检查账号status。住户邀请及代理能力只凭auth.userId匹配active人员和有效主租客周期，没有复核users状态。结果已停用账号仍可被激活并继续邀请/代理。DATA-MODEL激活契约要求验证可选绑定账号；可信认证上下文仅证明账号是谁，不代表账号在当前事务中仍有效。

独立临时库复现：建立status=disabled用户，绑定active人员并完成人工实名；createCycle后activate返回effectiveState=active；用该userId创建住户服务调用createOccupancy成功返回invited。未改写门锁或真实入住记录。

修复：有绑定userId时把users文档纳入激活事务，校验存在及有效状态，并复核person绑定未变；无账号人员继续允许。主租客邀请、代理资料创建/提交及敏感住户读取也需校验当前账号有效性。并发停用须能与事务读集冲突或通过一致的资格guard协议使操作重试/拒绝。不要依赖只在登录时检查。

补测试：disabled/缺失绑定账号激活拒绝且零写入；正常账号可用；无账号儿童老人可用；邀请与代理过程中停用账号拒绝；已有关系不因此自动调用门锁关闭（本轮仍不改设备权限）。

## F02 [P1] 已可配置的occupancy.create名单限制对完整入住流程无效

位置：createCycle、createOccupancy、transferPrimary及activate的`restriction: "occupancy.activate"`。

DB-06允许维护仅限制occupancy.create的有效名单，但DB-05创建阶段完全不检查该限制，激活阶段仅检查occupancy.activate。实施文档第59行说明创建复核流未开放，却没有拒绝已支持的create-only规则，因此不是“待激活记录无权限”就能消除的问题。

独立复现：为某人员创建有效restrictions=[occupancy.create]名单；createCycle成功pending_review；完成实名后activate仍返回active，全流程没有名单复核。管理员设置的禁止新建规则实际无任何效果。

修复选择：接入创建阶段的同事务名单检查并实现明确的拒绝/复核契约；若本期不支持独立创建限制，则在名单维护入口显式拒绝此配置，并对已有create-only数据采取失败关闭或明确迁移策略，不可继续静默忽略。检查主周期创建、成员邀请及换租新周期三条入口；不要自动复用activate的allow为创建放行。

补测试：create-only命中不能无审批走完创建与激活、双方限制同时命中、名单新增与创建竞争、无命中正常路径、旧规则记录兼容处理。

## 验证范围与结果

- 后台154项、根目录51项测试全部通过；9页静态检查通过，867 KiB。
- 独立复现用现有测试夹具、临时LocalStore、模拟证件文件校验器，数据已清理；没有调用真实云库/付费服务/设备。
- 已检查主槽争用、周期结束立即失效、换租不转移旧成员、分批历史补写、DB-06 guard协议、实名申请归属和物业归档联动。现有测试通过不构成云端并发证明。
- 当前住户操作仅服务层，未开放住户HTTP/小程序入口；F01须在接入前修复，不能称为已开放的远程漏洞。
- DB-07私有文件接入、DB-08云端事务/索引/安全规则探针仍为上线门槛。新入住关系尚未赋予门锁权限。

## 给开发AI

在原DB-05分支修复F01/F02并补回归，更新实施文档并提供新提交哈希。保持已通过的DB-04/06回归；不要合并main、迁移生产数据或改设备开门权限。

## 第二轮复审：c7790ef

结论：F01、F02 的核心拦截已生效，但创建阶段的复核对象仍没有持久业务记录，复审未通过，暂不建议合并。

- F01 已通过：绑定 `disabled` 或缺失账号的人员不能激活；有效主租客账号在停用后不能邀请成员或继续代理资料操作。独立复现返回 `USER_DISABLED`，未写入激活或邀请记录。
- F02 的名单检查已接入：`createCycle`、成员邀请及换租新周期通过 `withEligibility(... restriction="occupancy.create")`；命中时返回 `BLACKLIST_REVIEW_REQUIRED`，没有创建入住记录。
- 既有 `occupancy.activate` 决策 ID 保持兼容，创建和激活的复核头按 restriction 隔离。

### F03 [P1] 创建放行只绑定未落库的 opaque ID，未绑定被审核请求

命中 `occupancy.create` 时，服务生成随机 occupancyId 后不保存任何待审申请，只把该 ID 放在错误响应中。`reviewOccupancy` 仍允许为这个不存在的 ID 写 allow；复核记录没有房间、人员、周期、入住期限或请求摘要。客户端获得 allow 后，可用相同 ID 改变上述创建参数再重试。当前精确名单 entryIds 只能约束命中主体，不能证明审核员批准的是哪间房、哪段期限及哪种创建动作。

独立复现：create-only 名单首先返回 `BLACKLIST_REVIEW_REQUIRED`；对尚不存在的 `review-before-record` 写入 allow 成功；随后使用该 ID 创建周期返回 `pending_review`。第一轮追加检查中的“missing occupancy 可写 allow”仍成立，只是本轮把它变成正式流程。

修复建议：首次命中时原子保存受限的 `occupancy_applications`/pending proposal（组织、人员、房间、周期/角色、期限、请求摘要、revision、状态），复核事务必须读取该记录和当前完整名单；重试创建必须逐字段匹配批准版本并消费决定。也可使用不可伪造的服务端请求摘要，但仍需有可审计、可失效、可防重放的持久对象。不要让客户端自报一个裸 occupancyId 代表已审核申请。

复审实跑：后台 161 项、根目录 51 项、9 页静态检查全部通过。现有新增测试验证了裸 ID 流程本身，没有验证“审核后改变房间/人员/期限必须拒绝”。云端事务、索引和安全规则仍待 DB-08。
