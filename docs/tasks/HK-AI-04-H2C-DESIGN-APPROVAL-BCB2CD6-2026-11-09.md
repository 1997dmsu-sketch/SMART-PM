# HK-AI-04 H2-c 资格快照设计复审（`bcb2cd6`）

结论：**设计通过；按本文裁定放行 H2-c 编码。**

本批准只覆盖完整资格快照、真实 `BlacklistService.withEligibility()` 接线、单事务重试和对应测试。H2-d/H3/H4、HTTP、Provider 调用及设备写操作继续关闭。

## 复审范围

- 设计分支：`docs/hk-h2c-eligibility-design`
- 设计提交：`bcb2cd61af0fcbc9e906ed5aa0140d00025842fc`
- 设计文档：`HK-AI-04-H2C-ELIGIBILITY-DESIGN.md`
- 代码事实基线：H2-b `2bc10e3`

提交只新增一份 350 行 Markdown。相对链接有效，未修改生产代码或测试，未连接设备、Provider 或生产云。

## 核对结论

1. 当前 `createGrant()` 确实缺少入住、周期、房间、目录及有效 primary/slot 的事务复核。
2. 真实 `withEligibility()` 当前按 prepare → transact → evaluate → build 执行，遇 `BLACKLIST_RETRY` 最多完整重跑三次；合法 operation replay 仍经过 prepare/evaluate，并可能写 eligibility guard 与审计。
3. 最大 refs 推导 `33+N` 成立：候选记录 `N<=57` 时不超过 CloudStore 的 90 条上限，`N=58` 时在事务前失败关闭。
4. D01–D75 已覆盖实体资格、时间边界、真实黑名单、重试、并发、容量与内容级副作用。
5. H2-a/H2-b 的 K1/K2、owner claim、slot 禁复用和严格重放边界保持不变。

## Q01–Q06 裁定

### Q01：active occupancy

**批准推荐方案。** 只有 stored `occupancy.state=active`，且 cycle 为 active、`effectiveState=active`、当前时间位于 occupancy/cycle 有效区间时才允许创建 face grant。`scheduled/invited/pending_review/ended` 均拒绝。

### Q02：member 的 primary、room slot 与 sponsor

**批准推荐方案。** member 必须依赖仍有效的 primary 和匹配的 `room_primary_slots`。`sponsorOccupancyId` 非空时，sponsor 必须仍 active 且等于 `cycle.primaryOccupancyId`；null 时不得伪造 sponsor ref。

### Q03：授权区间

**批准推荐方案。** 允许授权区间严格短于入住期，但必须完全包含于 occupancy/cycle 的共同有效区间，并满足 `validFrom <= now < validUntil`。H2-c 不新增 scheduled grant。

### Q04：资格 helper

**批准抽取共享只读 helper，但不得改变 OccupancyService.activate() 语义。** 抽取公共的实体读取计划、refs、层级/时间/关系校验原语；grant 资格使用独立模式。禁止在 FaceCredentialService 中复制一套简化的入住规则，也禁止让 helper 写业务记录。

### Q05：重试耗尽错误

**保持现状。** 三次 `BLACKLIST_RETRY` 耗尽后继续返回 `409 BLACKLIST_RETRY`。H2-c 不新增 HTTP 映射或新错误码。

### Q06：`prepareAttempt` 最小接口

**有条件批准。** 接口必须满足：

- 作为 `withEligibility()` options 的可选字段，默认缺省时现有 DB-05/DB-06 调用行为逐字节兼容；
- `prepareAttempt(token)` 明确为 async，并在每次 attempt 的 `prepareEligibility()` 之后重新 await；
- 返回当次资格 refs、不可变预读快照及事务内 `beforeEvaluate(state, token)`；
- `beforeEvaluate` 在同一 transaction 内、`evaluateEligibility` 之前运行，不得开启第二个事务；
- 资格快照竞态统一抛 `BLACKLIST_RETRY`，进入同一三次完整重试循环；不得吞错或降级为旧快照；
- 不得由 hook 计算或伪造 eligibility，不得修改 candidates、guards、decisions、重试次数或 `deferBlocked` 语义；
- build 第三参数只能是最小只读资格上下文，不含私密实名材料或名单证据；
- refs 超过 90 条继续失败关闭，不拆事务、不省略 refs。

## 编码门禁

- 实现必须分阶段提交，先 helper，再兼容接口，再接线，最后补矩阵；
- 使用真实 `BlacklistService`，不得以 `eligible=true` 测试桩作为 H2-c 验收证据；
- 失败路径核心业务、资格及 H2-b 只读记录内容级零变化，Provider 调用为 0；
- 合法 replay 只要求核心写集不变，eligibility guards 与 admin audit 可按现状变化；
- 不注册 HTTP，不调用 Provider，不连接设备，不进入 H2-d/H3/H4。

编码任务见 `HK-AI-04-H2C-ELIGIBILITY-CODING.md`。
