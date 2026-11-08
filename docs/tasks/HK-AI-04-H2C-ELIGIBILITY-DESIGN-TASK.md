# HK-AI-04 H2-c 资格快照契约设计任务卡

**负责人：Kimi（文本与契约梳理）**
**优先级：P0**
**建议分支：** `docs/hk-h2c-eligibility-design`
**基线：** `docs/lock-01-fast-track @ e9e8544`
**交付物：** `docs/tasks/HK-AI-04-H2C-ELIGIBILITY-DESIGN.md`

## 1. 当前基线

- H1 已关闭；
- H2-a 已关闭：K2、operation domain、三路径幂等与严格重放；
- H2-b 已由 `2bc10e3` 关闭：设备 owner claim 只读复核、slot 禁复用、设备/K1/claim 竞态；
- H2-c 尚未批准编码；
- H2-d/H3/H4、HTTP、Provider 调用与设备写操作继续关闭。

本任务只冻结 H2-c 的资格模型与测试矩阵。不得修改生产代码或现有测试。

## 2. 必须阅读的实现依据

以现有代码为唯一事实来源，至少逐段引用：

- `admin-web/lib/face-service/service.mjs` 的 `createGrant()`；
- `admin-web/lib/blacklist.mjs` 的 `prepareEligibility()`、`evaluateEligibility()`、`withEligibility()`；
- `admin-web/lib/occupancies.mjs` 的 `activate()`、入住有效性、room/cycle/person/identity 校验 helper；
- `admin-web/lib/identity.mjs`；
- `admin-web/lib/property.mjs` 或实际 property catalog 校验入口；
- `admin-web/tests/occupancy.test.mjs`；
- `admin-web/tests/face-service-layer.test.mjs`；
- LOCK-01A 契约、数据设计及现有 H2-a/H2-b 终审记录。

不得凭字段名猜测契约；每项结论需标出文件、函数与行号范围。

## 3. 必须冻结的资格快照

设计文档需列出每个实体的：预读来源、事务 ref、事务内复核字段、允许状态、失败错误码和是否进入 `requestDigest`。

至少覆盖：

1. `face_credentials`：组织、person、approved、revision、source file binding；
2. `persons`：组织、状态、绑定账号语义及 revision；
3. `identity_applications`：组织、同 person、approved、identity digest/key version 与 revision；
4. `occupancies`：组织、同 person/room/cycle、角色、有效状态、起止时间、revision；
5. `occupancy_cycles`：组织、同 room、active 状态、起止时间、epoch/revision；
6. `rooms`：组织、未归档、与 floor/building/community 的绑定及 revision；
7. `property_catalog` 中 floor/building/community：组织、kind、层级关系、未归档及 revision；
8. 当前主入住/房间 slot 或 sponsor 关系：仅在现有入住模型确实要求时纳入，并写明依据；
9. H2-b 已冻结的 access device、K1 domain、owner claim、grant slot；不得改写其 schema 或复核语义；
10. 组织与当前成员权限、K2 domain、operation key、grant/job/log 的既有事务边界。

同时冻结：

- `validFrom/validUntil` 与 occupancy/cycle 有效区间的包含关系；
- 当前时间位于资格有效区间的规则；
- null 结束时间的解释；
- 人员、入住、周期、房间或目录记录缺失、跨组织、归档、失效时的同态错误策略；
- 资格数据发生竞态时返回 `REVISION_CONFLICT`、`INVALID_STATE`、404 或其他错误的明确映射。

## 4. `BlacklistService.withEligibility()` 固定边界

文档必须准确记录现有控制流：

1. `prepareEligibility()` 在事务前生成 token 和动态 refs；
2. `withEligibility()` 把业务 refs 与 token refs 合并进同一事务；
3. `evaluateEligibility()` 在事务内复核 person、identity、guard epoch、候选名单和决定；
4. `BLACKLIST_RETRY` 最多重跑完整预读与事务三次；
5. operation key 重放当前仍位于 build 内，**不得宣称重放跳过资格准备或评价**；
6. H2-c 不修改 blacklist 算法、guard、复核记录或重试次数。

需明确 `createGrant` 应使用真实 `BlacklistService`，测试不得再用自制 `eligible=true` 桩证明生产资格语义。

## 5. 原子事务与零写入

给出完整 refs 表和按顺序的伪代码：

1. 事务内重新验证组织与 `device.access.manage`；
2. operation domain 与损坏重放检查沿用 H2-a；
3. 完整人员/实名/入住/周期/房间/目录资格快照复核；
4. `evaluateEligibility()` 的真实黑名单判决；
5. H2-b device/domain/claim/slot 复核；
6. 全部通过后才写 pending grant、queued job、首条 log、slot 与 operation key；
7. 任一失败，所有业务集合内容级零变化，Provider 调用为 0。

设计需判断动态 refs 能否在现有 `withEligibility()` 单次事务中完整表达。若不能，只记录阻断与最小接口变更提案，不得直接新增第二次事务或缩小复核范围。

## 6. 测试矩阵

编号至少 D01–D40，并逐项写明 fixture、注入时点、预期错误和零副作用集合。至少包含：

- 完整有效资格成功；
- person 缺失、跨组织、停用、revision/绑定账号变化；
- identity application 缺失、跨组织、非 approved、person/digest/keyVersion/revision 变化；
- occupancy 缺失、跨组织、person/room/cycle/role/state/revision/时间变化；
- cycle 缺失、跨组织、room/state/epoch/revision/时间变化；
- room 与 floor/building/community 缺失、跨组织、归档、层级关系变化；
- `validFrom/validUntil` 超出 occupancy 或 cycle；
- 当前时间位于边界前、边界内、结束时刻；
- 黑名单无命中、deny、review required、精确 allow；
- blacklist guard/candidate 在预读与事务间变化并触发完整重试；
- 三次连续 `BLACKLIST_RETRY` 后失败关闭；
- 成员权限、file revision 与 H2-b device/claim/domain/slot 同时竞态；
- 同一资格的并发授权；
- 同键重放及异摘要冲突，且如实体现现有重放仍经过资格准备/评价；
- 每个失败场景深比较 grant/job/slot/log/operation key 及相关只读记录，Provider 0。

测试计划必须使用真实 `BlacklistService` 和完整实名/入住/周期/房间 fixture。

## 7. 必须列出的待 Codex 决策

只列无法从现有代码确定的事项，并给出推荐方案与影响。至少检查：

- face grant 是否只允许 `occupancy.state=active`；
- member 是否必须依赖仍有效的 primary/sponsor 与 room primary slot；
- 授权有效期是否允许短于入住期，以及是否必须从当前时间开始；
- qualification refs 是否需要复用/抽取 occupancies 的正式 helper，避免复制规则；
- `BLACKLIST_RETRY` 三次耗尽后的对外错误码。

不得在文档中自行冻结无法从现有契约推出的新业务规则。

## 8. 验收与边界

- 只新增或修改 Markdown；
- `git diff --check` 通过，相对链接有效；
- 不含姓名、手机号、地址、设备序列号、MAC、IP、凭据、完整指纹、人脸或原始响应；
- 不修改 `service.mjs`、`blacklist.mjs`、`occupancies.mjs`、测试或 Store；
- 不注册 HTTP，不调用 Mock/真实 Provider，不连接设备；
- 提交号交 Codex 复审；**复审通过前不得发 H2-c 编码卡。**

## 9. 回报模板

```text
任务：HK-AI-04 H2-c 资格快照契约设计
分支/提交：
基线：e9e8544
交付文件：
引用的代码入口与行号：
资格实体/refs 数量：
错误映射数量：
测试矩阵数量：
待 Codex 决策：
敏感信息扫描：
生产代码/测试/设备/Provider 改动：均无
```
