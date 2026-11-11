# HK-AI-04 H2-c C3：`createGrant()` 完整资格接线任务卡

**负责人：** DeepSeek Harness（单一主实现代理）

**优先级：** P0

**建议分支：** `feat/hk-face-service-h2c-eligibility`

**代码基线：** `cfacfff`（C1/C2 终审通过）

**批准依据：**

- `HK-AI-04-H2C-ELIGIBILITY-DESIGN.md`
- `HK-AI-04-H2C-DESIGN-APPROVAL-BCB2CD6-2026-11-09.md`
- `HK-AI-04-H2C-C1-C2-APPROVAL-CFACFFF-2026-11-10.md`

## 1. 唯一目标

把已批准的 C1 只读资格 helper 与 C2 `withEligibility.prepareAttempt` 接入 `FaceCredentialService.createGrant()`。只有人员、实名、入住、周期、房间、物业目录、primary/slot/sponsor、lifecycle guard、真实黑名单以及 H2-b 设备/claim/slot 全部满足冻结规则时，才允许在同一事务中产生 H2-b 已批准的核心写集。

本卡不实现新的资格算法，不扩大 C1/C2，不进入 C4/H2-d/H3/H4。

## 2. 事务前准备

每次 `withEligibility()` attempt 均须通过 `prepareAttempt(token)` 重新准备，不得复用上一次 attempt 的快照：

1. 读取当前 credential，确定 `personId/sourceFileId/sourceFileRevision/revision`；
2. 读取 person、可选绑定 user、identity application；
3. 读取 occupancy、cycle、room、floor/building/community；
4. 按 role 读取 current primary，按非空 `sponsorOccupancyId` 读取 sponsor；
5. 读取 occupancy-person unique claim、room primary slot、固定 lifecycle guard；
6. 构造 C1 `grant` 模式请求与强制 `expected` 基线；
7. 调用 `planEligibilityRefs()` 生成当次 refs；
8. 返回 `beforeEvaluate(state, token)`，在事务内调用 `snapshotEligibility()` 与 `validateEligibility()`，只返回最小只读资格上下文。

预读不是授权依据。任何允许状态、组织、关系、revision、epoch 和时间均须在事务快照中重新校验。

## 3. C3 必须处理的 400／409 边界

C1 helper 对内部不自洽请求或漏基线返回 `PARAM_ERROR/400`。C3 不得把真实业务记录错配直接暴露为该 400：

- occupancy.personId 与 credential.personId 不一致；
- occupancy.cycleId 与输入 cycleId 不一致；
- identity application 与 credential person 不一致；
- 预读后 credential.personId、occupancy/cycle/room/catalog 关键关系变化；
- primary、sponsor、guard 的预读身份与当前记录不一致。

C3 必须在构造 helper 请求前识别调用时已经存在的业务错配，并按冻结矩阵返回 `REVISION_CONFLICT/409`、`IDENTITY_CONFLICT/409`、`NOT_FOUND/404` 或相应同态错误。只有 DTO 本身非法、授权区间非法或内部 helper 契约调用错误才使用 `PARAM_ERROR/400`。

## 4. 单事务固定顺序

所有步骤必须处于同一次 `store.transact()`，顺序不得调整：

1. **权限与组织：** organization active；membership active、同 org 且含 `device.access.manage`；
2. **operation 状态：** 复核 K2 domain 和 operation key；损坏或同键异摘要为 `CONFLICT/409`；合法 replay 仅记录旧 result，不能提前跳过资格和黑名单；
3. **credential/file：** approved、expected revision、personId 与 source binding 均未变化；`assertBinding()` 只读复核；
4. **完整资格：** 执行 C1 `beforeEvaluate`；失败关闭，不写核心记录；
5. **真实黑名单：** 继续使用正式 `BlacklistService.evaluateEligibility()` 与 `restriction="occupancy.activate"`；不得使用 `eligible=true` 桩；
6. **合法 replay：** 黑名单通过后返回旧 result，核心 writes 为 `[]`；允许既有 eligibility guard 与 admin audit 按当前实现变化；
7. **H2-b 复核：** access device、K1 head/version、owner claim、grant slot；保持设备/claim/domain 只读；
8. **核心写集：** 仅新操作写 pending grant、queued job、queued log、新 active slot、operation key，以及 H2-a 必需的 operation-domain writes；
9. wrapper 仅追加既有 subject guard writes；Store 仅写既有审计。

任何校验失败不得产生部分核心写集，Provider 调用必须为 0。

## 5. 固定资格规则

- person 必须 active；有绑定账号时账号必须存在且 active；无账号 person 不伪造账号；
- identity application 必须同 org、同 person、approved，且 digest、keyVersion、revision 快照有效；
- occupancy 与 cycle 必须 stored `active`，当前时间位于二者 `[start,end)` 共同有效区间；
- primary 必须满足 `cycle.primaryOccupancyId === occupancy._id` 并匹配 room primary slot；
- member 必须依赖同 room/cycle 的有效 primary 与匹配 slot；
- 非空 sponsor 必须仍 active，且等于 `cycle.primaryOccupancyId`；
- room 与 floor/building/community 均须同 org、未归档、父子层级与 revision 匹配；
- occupancy-person unique claim 必须 bound 到目标 occupancy；
- lifecycle guard 的固定 ID、org、epoch、revision 必须与当次预读一致；
- `validFrom <= now < validUntil`，授权区间完全包含于 occupancy/cycle 共同有效期；
- 黑名单三次 `BLACKLIST_RETRY` 耗尽后保持 `409 BLACKLIST_RETRY`。

## 6. refs 上限

- `base refs + C1 prepared refs + blacklist token refs` 必须按 `collection/id` 去重后计数；
- 去重后最多 90 条；91 条在事务开启前失败关闭；
- 最大布局仍按 `33 + N` 核算，候选名单 `N <= 57`；
- 不得拆事务、分页候选、丢弃 refs、复用旧 attempt 快照或降级为弱校验；
- C3 至少保留一项集成级 90/91 断言；完整容量矩阵归 C4。

## 7. 错误映射与优先级

错误优先级固定为：

```text
权限/operation
→ credential/file/完整资格
→ 真实黑名单
→ H2-b device/K1/claim/slot
→ 核心写集
```

必须沿用下列既有错误，不新增同义码：

| 范围 | 错误 |
| --- | --- |
| 不可见或跨组织 | `NOT_FOUND/404` |
| 权限或成员失效 | `FORBIDDEN/403` |
| DTO／授权区间／helper 内部契约非法 | `PARAM_ERROR/400` |
| 预读后 revision、epoch、关键关系变化 | `REVISION_CONFLICT/409` |
| person/occupancy/cycle 当前状态或时间无效 | `INVALID_STATE/409` |
| 绑定账号缺失或停用 | `USER_DISABLED/403` |
| 实名未批准／person 冲突 | `IDENTITY_NOT_APPROVED/403`、`IDENTITY_CONFLICT/409` |
| room/catalog 归档 | `ROOM_ARCHIVED/409` |
| occupancy claim 无效 | `DUPLICATE_OCCUPANCY/409` |
| primary/slot/sponsor 无效 | `SPONSOR_INACTIVE/409` 或冻结的 `INVALID_STATE/409` |
| 名单 | `BLACKLIST_DENIED/403`、`BLACKLIST_REVIEW_REQUIRED/409`、`BLACKLIST_RETRY/409` |
| 文件 | `FILE_NOT_FOUND/404`、`FILE_CHANGED/409` |
| H2-a/H2-b | `CONFLICT`、`DEVICE_CLAIM_INVALID`、`DEVICE_CLAIM_CONFLICT`、`DOMAIN_INCOMPLETE`、`DEVICE_DIGEST_CONFIG_CHANGED`、`GRANT_SLOT_CONFLICT` |
| 必要适配器未配置 | `ADAPTER_UNAVAILABLE/503` |

## 8. C3 验收测试

C3 提交至少新增或改写以下接线测试；C4 再执行 D01–D75 全矩阵：

1. 完整 primary 成功，核心写集字段与 H2-b 完全一致，Provider 0；
2. 完整 member 成功，primary/slot/sponsor 由真实 C1 helper 复核；
3. `createGrant()` 确实提供 `prepareAttempt`，执行顺序为 beforeEvaluate → evaluate → build；
4. person/identity/occupancy/cycle/room/catalog 任一关键快照变化失败关闭；
5. occupancy.personId 与 credential、occupancy.cycleId 与输入错配返回冻结的 409/同态错误，不泄露为 helper 400；
6. 黑名单 deny、review-required、一次 retry 后成功、三次耗尽；
7. 合法 replay 仍重新 prepare/evaluate，核心 grant/job/slot/log/op 内容深比较不变；
8. 同键异摘要或损坏 replay 记录返回 `CONFLICT`；
9. H2-b device/K1/claim/slot 失败仍保持既有错误和内容级零变化；
10. 合并 refs 恰好 90 可进入事务，91 时事务调用为 0；
11. 每次 attempt 使用新 refs，不沿用第一次 snapshot；
12. 所有失败以故障注入后的 state 为基线，深比较核心业务集合无额外变化；
13. Admin 全量与根测试全绿。

测试必须使用真实 `BlacklistService` 与完整 fixture。不得以自制 eligibility 桩作为成功或失败证据。

## 9. 禁止范围

- 不修改 C1/C2 已批准语义、blacklist 判决算法、guard、decision、重试次数或 `deferBlocked`；
- 不修改 H2-a/H2-b 的 ID、schema、K1/K2、owner claim、slot 禁复用和严格重放；
- 不实现 C4 D01–D75 全矩阵以外的业务扩展；
- 不实现 H2-d/H3/H4；
- 不修改 `server.mjs`，不注册 HTTP；
- 不调用 Mock 或真实 Provider，不连接设备，不执行设备写；
- 不读取实名私密材料、文件字节或名单证据正文；
- 不保存姓名、手机号、地址、证件号、序列号、MAC、IP、凭据或完整指纹；
- 不合并 main，不修改生产云，不执行数据库迁移。

## 10. 提交与回报

本卡只允许一个生产实现提交，必要测试可单独追加提交。提交前必须确保工作区干净并回报：

```text
任务：HK-AI-04 H2-c C3 createGrant 接线
分支/提交：
基线：cfacfff
修改文件：
事务顺序证据：
错误映射证据：
refs 90/91：
新增测试：
Admin/根测试：
Provider/HTTP/设备：0 / 未注册 / 未连接
未完成：C4、H2-d、H3、H4
```

完成后交 Codex 复审。C3 通过前不得进入 C4，也不得宣称 H2-c 已关闭。
