# HK-AI-04 H2 原子授权复审：`7b7ee6d`（2026-11-07）

结论：**不通过。H2 未关闭，H3/H4、HTTP、Provider 与设备写调用继续关闭。**

独立验证通过：服务层 5/5、后台 285/285、根测试 51/51。测试全绿不能覆盖以下生产语义偏差。

## P0-1：生产重放并未跳过资格，测试桩与真实服务不一致

`createGrant()` 在检查 operation key 前已经：

- 读取 credential 和 device；
- 解析 K1 配置；
- 计算 domain/claim/slot refs；
- 调用 `BlacklistService.withEligibility()`。

真实 `withEligibility()` 会先运行 `prepareEligibility()`，事务内先运行 `evaluateEligibility()`，最后还会追加 eligibility guard writes，之后才进入 createGrant 的 build 回调。因此：

- credential/device/person/identity/名单/K1 任一变化都可能让合法重放失败；
- 重放没有真正跳过资格；
- 重放不是“零新增/零业务副作用”；
- 当前测试自制的 blacklist 桩直接把 `eligible` 交给 build，掩盖了真实顺序。

修复：增加授权前置重放检查。先复核当前组织/成员权限，再读取 op key；同键同摘要直接返回，同键异摘要冲突。新操作才准备资格，并在最终资格事务中再次检查权限和 op key，防止前置检查与提交之间竞态。

## P0-2：只做黑名单资格，不等于完整入住资格

`withEligibility()` 明确不验证 occupancy 本身。当前 H2 没有在事务中读取或校验：

- person 属于组织且有效；
- identity application approved 且属于该 person；
- occupancy active 且 person/room/cycle 一致；
- occupancy cycle active、未结束；
- room/building/community 未归档；
- 授权期限不超出 occupancy/cycle；
- device `ownerOrgId` 与组织一致、`capabilities.face` 可用。

任意字符串 occupancyId/cycleId 在黑名单无命中时可生成授权。按既有 `HK-AI-04-SERVICE-REVIEW-D2A994A` 恢复完整资格快照与零写入测试。

## P0-3：device claim 被错误实现为“每个 grant 独占设备”

冻结数据设计规定：全局 `device_claims` 保存设备唯一 `ownerOrgId`，grant 创建只验证既有设备所有权，**不为每个 grant 抢占或释放设备 claim**。当前实现把 `grantId` 写进 device claim，并把其他 grant 视为 `DEVICE_CLAIMED`，结果是一台门禁机最多只能授权一个住户。

修复：

- access device 必须引用既有 `claimId`；
- claim 保存 provider/digestRealm/keyVersion/ownerOrgId/revision，不保存 grantId；
- createGrant 校验 claim 与 device、ownerOrgId 一致；
- 多个不同人员可在同一设备建立各自 grant slot；
- grant 撤销只释放 slot，不释放设备 owner claim。

## P0-4：事务前设备快照用于计算 refs，事务内未验证身份字段

claim/domain refs 使用事务前的 `device.provider`、`serialNumber` 计算；事务内只检查 orgId/status，没有比较 revision、provider、序列号或 claimId。并发修改设备身份后，事务可能向旧 claim/domain 写授权。

按 P0-3 改为读取 access device 上既有 claimId，并在事务内复核 device revision、ownerOrgId、claimId、provider、digest realm/key version。设备记录变化必须重试或失败关闭。

## P0-5：operation key 仍是原始字符串拼接

`operationKey()` 当前直接拼接 org/method/actor/idempotencyKey；没有冻结契约要求的 K2 摘要，也没有校验幂等键 16–128 字符和 `[A-Za-z0-9._:-]`。H2 已开始持久化 operation key，必须在本阶段关闭该问题。

K2 必须与 K1 分离；记录保存 requestDigest 和 keyVersion，不把原始幂等键写进固定 ID。

## P1：授权、任务和审计字段不完整

至少补齐并校验：

- grant：`claimId`、`slotId`、`identityApplicationId`、`approverId`、`executionMode`；
- job：`opId`、`requestDigest`；
- eligibility 决策/快照引用，足以解释本次授权依据；
- slot：当前 active grant/claim 引用及墓碑复用时清理旧 released 字段。

不得记录原始设备序列号、名单详情或人脸摘要。

## P1：测试覆盖回退且未使用真实 BlacklistService

当前服务层测试从 H1 的 8 项降为 5 项，并删除了 submit/review、权限竞态、stale review、跨组织 queryJob 等已通过回归。必须恢复，不得用 H2 测试替换 H1 回归。

H2 必须使用真实 `BlacklistService` 至少覆盖：

1. 命中 deny/review、资格 guard 并发变化；
2. 权限撤销后重放拒绝，权限有效时即使资格后来变化仍可重放；
3. occupancy/person/identity/cycle/room/device 各类无效零写入；
4. domain/owner claim 不完整或不一致零写入；
5. slot 冲突、墓碑复用、不同人员同设备可分别授权；
6. 两个并发 createGrant 只有一个成功；
7. 文件 revision、credential revision、device revision 并发变化失败关闭；
8. operation key 同摘要重放、异摘要冲突、跨 actor/org 不串键；
9. 所有失败路径 Provider 调用为 0。

## 下一提交边界

仅返工 H2 生产代码与服务层测试。不得进入租约/sending/派发，不得实现 revoke 闭环，不得注册 HTTP，不得修改 `server.mjs`，不得连接真实或 Mock Provider。
