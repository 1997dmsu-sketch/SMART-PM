# HK-AI-04 H2-c C4 场景矩阵证据与终审申请

日期：2026-11-11

状态：**C4 编码与场景矩阵完成，申请 H2-c 终审；未宣称 H2-c 关闭。**

## 1. 分支与基线

| 项目 | 内容 |
|---|---|
| 分支 | `feat/hk-face-service-h2c-c4-d-matrix` |
| C3 复核基线 | `32c891fcde97ce2174ae28b3b652efc11cc0ef9e`（C3 终审通过） |
| C4 生产定点修复 | `34580abfdd9b7a38fba6931327f5cfc8a7bd7094`（D75 适配器契约失败关闭，单独提交） |
| C4 测试提交 | 本文所在提交（`test(face): H2-c C4 落实 D01–D75 场景矩阵`） |
| 测试文件 | `admin-web/tests/face-grant-d-matrix.test.mjs` |
| 运行环境 | Node.js `v24.19.0`，本地 `LocalStore`，不连接生产云 |

C4 只增加场景测试与 D75 定点失败关闭修复；未修改 `server.mjs`、HTTP 注册、业务 Provider、设备连接/写入，未进入 H2-d/H3/H4，未合并 `main`。

## 2. Fixture 与证据口径

- **真实服务**：`BlacklistService.prepareEligibility/evaluateEligibility/withEligibility` 均为生产实现；没有用 `eligible=true` 的资格桩替代真实名单判决。
- **完整资格 fixture**：组织、成员权限、已审核 credential、私密 ready file、active person（可选绑定账号）、approved identity、active occupancy/cycle、三级 property catalog、bound `unique_claims`、匹配 `room_primary_slots`、lifecycle guard 基线，以及 H2-a/H2-b 的 device/owner claim/K1/K2 domain。
- **F-P**：primary fixture；**F-M**：member fixture，含有效 primary、匹配 room slot 与非空 sponsor（Q02）。
- **计数**：每个场景记录 `prepare`、`transact`、`evaluate`、`build` 的实际调用次数；重试行同时断言完整重跑，而非只重跑最后一个函数。
- **Z（内容级零变化）**：失败路径先固化 T0/T1/T2/T3 注入后的快照，再对 `grant/job/slot/log/operation key`、credential/file、organization/membership、person/user/identity、occupancy/cycle/room/catalog、unique claim/room slot/lifecycle guard、device/device claim/K1/K2 domain、blacklist entries/decisions/eligibility guards、admin audit 做 `assert.deepEqual`；不只比较条数。
- **S（成功写集）**：只允许核心写集 C（pending grant、queued job、queued log、active slot、operation key）、既有 subject guard writes 和一条 admin audit；fixture 预建 K2 domain，成功路径不得改写资格/H2-b 只读记录。
- **R（合法 replay）**：核心写集不变，`prepare/evaluate` 仍实际执行；eligibility guards 与 admin audit 可按现状变化，其余集合执行 Z。
- **P0**：每行断言 Provider `enroll/revoke` 调用为 0；不读取私密文件字节，不访问设备、HTTP 或生产云。
- **注入时点**：T0 调用前；T1 本次预读后、事务复核前（`beforeTransact`）；T2 第一次 retry 后、下一次预读前（`beforePrepare`）；T3 真实 evaluate 后、H2-b 复核前（仅修改事务 `state`，验证顺序与失败关闭）。

## 3. 执行结果

| 范围 | 命令 | 结果 |
|---|---|---|
| C4 定向 | `node --test --test-isolation=none tests/face-grant-d-matrix.test.mjs`（`admin-web`） | **72/72 通过** |
| C1/C2/C3/C4/H2-b 定向组合 | `node --test --test-isolation=none tests/cloud-store-point-read.test.mjs tests/face-grant-eligibility.test.mjs tests/face-service-layer.test.mjs tests/face-eligibility.test.mjs tests/blacklist-prepare-attempt.test.mjs tests/face-grant-d-matrix.test.mjs`（`admin-web`） | **151/151 通过** |
| Admin 全量 | `node --test --test-isolation=none tests/*.test.mjs`（`admin-web`） | **441/441 通过** |
| 仓库根测试 | `node --test --test-isolation=none tests/*.test.cjs`（仓库根） | **51/51 通过** |
| 空白检查 | `git diff --check` | 通过 |

## 4. D01–D75 逐项覆盖索引

文件均为 `admin-web/tests/face-grant-d-matrix.test.mjs`；结果为本次实跑。

| D 行 | 测试名称 | 结果 |
|---|---|---|
| D01 | C4 D01 F-P 全有效：单次成功，pending grant/queued job，S+P0 | PASS |
| D02 | C4 D02 F-M 全有效（Q02）：member 依赖有效 primary/slot，单次成功 | PASS |
| D03/D04 | C4 D03/D04 person 缺失与跨组织：同态 NOT_FOUND，Z | PASS |
| D05 | C4 D05 person.status 非 active：INVALID_STATE，Z | PASS |
| D06 | C4 D06 person.revision 在 T1 改变：一次 retry 后成功，prepare=2 | PASS |
| D07 | C4 D07 person.userId T1 改绑：第二次使用新 user subject，不沿用旧绑定 | PASS |
| D08/D09 | C4 D08/D09 绑定 user 缺失/停用：USER_DISABLED；无账号 person 可成功 | PASS |
| D10/D11 | C4 D10/D11 identity application 缺失与跨组织：同态 NOT_FOUND，Z | PASS |
| D12/D13/D14 | C4 D12/D13/D14 identity 非 approved/人员不符/缺 digest：冻结错误，Z | PASS |
| D15 | C4 D15 identityDigest T1 改变：retry 后使用新 digest subject | PASS |
| D16 | C4 D16 identity.keyVersion T1 改变：retry 后重取 keyVersion/guard | PASS |
| D17 | C4 D17 identity revision-only T1 改变：内部 retry，第二次成功 | PASS |
| D18 | C4 D18 连续三次资格快照失效（T1+T2）：409 BLACKLIST_RETRY，无第四次，Z | PASS |
| D19/D20 | C4 D19/D20 occupancy 缺失/跨组织：同态 NOT_FOUND，Z | PASS |
| D21 | C4 D21 occupancy.personId 与 credential 不同：T0/T1 均 REVISION_CONFLICT | PASS |
| D22 | C4 D22 occupancy.roomId 在 T1 改变：REVISION_CONFLICT，Z | PASS |
| D23 | C4 D23 occupancy.cycleId 与输入/预读不同：T0/T1 均 REVISION_CONFLICT | PASS |
| D24 | C4 D24 occupancy 角色非法/预读后变化：INVALID_STATE 与 REVISION_CONFLICT | PASS |
| D25 | C4 D25 occupancy 非 active 状态：invited/pending_review/ended 均 INVALID_STATE | PASS |
| D26 | C4 D26 occupancy.revision 在 T1 改变：REVISION_CONFLICT，Z | PASS |
| D27 | C4 D27 now<occupancy.startsAt：INVALID_STATE，Z | PASS |
| D28 | C4 D28 now=occupancy.endsAt：排他结束边界 INVALID_STATE，Z | PASS |
| D29 | C4 D29 occupancy.endsAt=null 且 cycle 有效：成功，S | PASS |
| D30/D31 | C4 D30/D31 cycle 缺失/跨组织：同态 NOT_FOUND，Z | PASS |
| D32 | C4 D32 cycle.roomId 与 occupancy.roomId 不同：T0/T1 均 REVISION_CONFLICT | PASS |
| D33 | C4 D33 cycle.state=pending/ended：INVALID_STATE，Z | PASS |
| D34 | C4 D34 cycle.epoch/revision 在 T1 改变：REVISION_CONFLICT，Z | PASS |
| D35 | C4 D35 now 在 cycle 开始前/结束时刻：INVALID_STATE，Z | PASS |
| D36 | C4 D36 room 缺失/跨组织：T0/T1 同态 NOT_FOUND，Z | PASS |
| D37 | C4 D37 room 归档：T0/T1 均 ROOM_ARCHIVED，Z | PASS |
| D38 | C4 D38 room 层级/revision 在 T1 改变：REVISION_CONFLICT，Z | PASS |
| D39 | C4 D39 floor 缺失/跨组织/kind 错误：T0/T1 同态 NOT_FOUND，Z | PASS |
| D40 | C4 D40 floor 归档：T0/T1 均 ROOM_ARCHIVED，Z | PASS |
| D41 | C4 D41 floor.parentId!=room.buildingId：T0/T1 均 REVISION_CONFLICT，Z | PASS |
| D42 | C4 D42 building 缺失/跨组织/kind 错误：T0/T1 同态 NOT_FOUND，Z | PASS |
| D43 | C4 D43 building 归档：T0/T1 均 ROOM_ARCHIVED，Z | PASS |
| D44 | C4 D44 building.parentId!=room.communityId：T0/T1 均 REVISION_CONFLICT，Z | PASS |
| D45 | C4 D45 community 缺失/跨组织/kind 错误：T0/T1 同态 NOT_FOUND，Z | PASS |
| D46 | C4 D46 community 归档：T0/T1 均 ROOM_ARCHIVED，Z | PASS |
| D47 | C4 D47 catalog revision 在 T1 改变：REVISION_CONFLICT，Z | PASS |
| D48 | C4 D48 validFrom<occupancy.startsAt：PARAM_ERROR，Z | PASS |
| D49 | C4 D49 validUntil>occupancy.endsAt：PARAM_ERROR，Z | PASS |
| D50 | C4 D50 validFrom<cycle.startsAt：PARAM_ERROR，Z | PASS |
| D51 | C4 D51 validUntil>min(cycle.endsAt,cycle.endedAt)：PARAM_ERROR，Z | PASS |
| D52 | C4 D52 授权区间严格短于且包含于入住/周期：成功，S | PASS |
| D53 | C4 D53 now<validFrom：授权尚在将来 INVALID_STATE，Z | PASS |
| D54 | C4 D54 now=validFrom：开始边界包含，成功，S | PASS |
| D55 | C4 D55 now=validUntil：结束边界排他 INVALID_STATE，Z | PASS |
| D56 | C4 D56 真实 BlacklistService 无命中：eligible=true 成功，无自制桩 | PASS |
| D57 | C4 D57 精确未过期 deny：BLACKLIST_DENIED，Z | PASS |
| D58 | C4 D58 有命中但无决定/决定不全/已过期：BLACKLIST_REVIEW_REQUIRED，Z | PASS |
| D59 | C4 D59 精确未过期 allow：成功且 decisionId 来自真实 evaluate | PASS |
| D60 | C4 D60 guard epoch T1 改变：首次 retry，第二次完整成功后成功 | PASS |
| D61 | C4 D61 新增 candidate 在 T1 生效：guard 促发 retry，第二次 REVIEW_REQUIRED，Z | PASS |
| D62 | C4 D62 guard/candidate 连续三次变化（T1+T2）：BLACKLIST_RETRY，无第四次，Z | PASS |
| D63 | C4 D63 权限/文件/设备同时 T1 变化：FORBIDDEN 优先，Z | PASS |
| D64 | C4 D64 file revision + K1 domain 在 T3 前（T1）变化：FILE_CHANGED 先于 H2-b，Z | PASS |
| D65 | C4 D65 T3 释放 owner claim 并预建 slot：DEVICE_CLAIM_INVALID，slot 不被覆盖，Z | PASS |
| D66 | C4 D66 同资格不同 op key 并发同 slot：正反顺序各一成功一 GRANT_SLOT_CONFLICT | PASS |
| D67 | C4 D67 同 op key 同摘要合法重放：返回原 result，核心 writes=[]，R | PASS |
| D68 | C4 D68 同 op key 不同摘要：CONFLICT，不得重放或覆盖，Z | PASS |
| D69 | C4 D69 首次成功后 occupancy 失效再同键重放：资格错误，不跳过资格，Z | PASS |
| D70 | C4 D70 member 的 primary 缺失/非 active：SPONSOR_INACTIVE，Z | PASS |
| D71 | C4 D71 member 的 room slot cycle/occupancy/person 不匹配：SPONSOR_INACTIVE，Z | PASS |
| D72 | C4 D72 非空 sponsor 非 active 或不等于 cycle.primaryOccupancyId：SPONSOR_INACTIVE，Z | PASS |
| D73/D74 | C4 D73 最大布局容量：去重后 58 candidates/90 refs 单事务成功（57/89 亦记录） | PASS |
| D73/D74 | C4 D74 最大布局容量：去重后 59 candidates/91 refs -> 400，58/90 可进入 | PASS |
| D73/D74 | C4 D73/D74 隔离 CloudStore 合约：90 refs 可进入，91 refs 事务前 400 | PASS |
| D75 | C4 D75a createGrant 正常入口：适配器丢弃 prepareAttempt -> ADAPTER_UNAVAILABLE，Z | PASS |
| D75 | C4 D75b createGrant 正常入口：适配器复用上一 attempt 上下文 -> ADAPTER_UNAVAILABLE，Z | PASS |
| D75 | C4 D75c hook 伪造 eligible 不能绕过真实 evaluate（补充） | PASS |
| D75 | C4 D75d createGrant 同 attempt 事务 callback 重跑：仅提交一次，S | PASS |

## 5. 计数与重试证据

| 场景 | prepare | transact | evaluate | build | 结果 |
|---|---:|---:|---:|---:|---|
| D01 全有效 | 1 | 1 | 1 | 1 | 成功 |
| D06 person revision T1 一次变化 | 2 | 2 | 1 | 1 | 第二次成功 |
| D07 userId T1 改绑 | 2 | 2 | 1 | 1 | 第二次使用新 user subject |
| D15 identityDigest T1 变化 | 2 | 2 | 1 | 1 | 第二次使用新 digest |
| D16 keyVersion T1 变化 | 2 | 2 | 1 | 1 | 第二次重取 keyVersion |
| D17 identity revision-only T1 变化 | 2 | 2 | 1 | 1 | 第二次成功 |
| D18 连续三次资格失效 | 3 | 3 | 0 | 0 | 409 BLACKLIST_RETRY，无第四次 |
| D60 guard epoch T1 一次变化 | 2 | 2 | 2 | 1 | 第二次成功 |
| D61 新 candidate T1 生效 | 2 | 2 | 2 | 0 | 409 BLACKLIST_REVIEW_REQUIRED |
| D62 guard/candidate 连续三次变化 | 3 | 3 | 3 | 0 | 409 BLACKLIST_RETRY，无第四次 |

## 6. 90/91 容量边界与设计公式差异

D73/D74 使用合法最大布局（member + 绑定账号 + 有效 primary/sponsor），实测去重后固定 refs 为 **32**：

- 57 candidates → 89 refs；
- 58 candidates → 90 refs，进入单事务并完成真实名单评价；
- 59 candidates → 91 refs，事务前 HTTP 400，事务调用 0。

设计 §4.1 写的是 `33+N`（57/90、58/91），其中把 member 的 primary 与 sponsor 计为两条 `occupancies`；但终审 Q02 要求非空 `sponsorOccupancyId === cycle.primaryOccupancyId`，同一 `collection/id` 必然去重，因此合法最大布局实际为 `32+N`。这是设计容量公式与 Q02 的口径差异，不是产品缺陷；90 条硬上限、失败关闭和“不拆事务、不省略 refs”均已按契约验证。C4 另用隔离 `CloudStore` 合约直接验证 90/91：90 条进入一次 `runTransaction`，91 条在 `runTransaction` 前 400，不连接真实云。

## 7. C4 定点生产修复（单独提交，申请一并复审）

`34580ab` 只改 `createGrant` 的 `prepareAttempt` 契约防御与对应 H2-b 测试 mock：

1. 适配器丢弃 `prepareAttempt` 选项时，`build` 不再因 `pre` 为 `null` 抛出无业务 code 的 `TypeError`，而是 `ADAPTER_UNAVAILABLE/503`；
2. `prepareAttempt(token)` 捕获当次 token，`beforeEvaluate(state, currentToken)` 校验对象身份；跨 attempt 复用旧快照失败关闭，同一 attempt 的 SDK transaction callback 重跑仍合法；
3. 未改变 C1/C2/C3 已批准的资格规则、真实名单评价、错误优先级、重试次数、K1/K2、owner claim、slot 或核心写集。

该修复由 D75 暴露，按 C3 终审“测试暴露生产缺陷只允许定点修复并单独提交复审”的要求独立提交。

## 8. 明确未做与边界

- 未修改 `server.mjs`、HTTP 路由或权限注册；
- 未调用 Mock/真实 Provider（测试内 Provider 只做零调用断言）；
- 未连接或写入任何设备，未连接生产云；
- 未实现 H2-d/H3/H4，未合并 `main`；
- D73/D74 的 90/91 仅为隔离 Store 合约证据，不等同于 DB-08 真实云探针；
- 本文件不宣称 H2-c 已关闭，等待终审。

## 9. 终审申请

请复审：

1. `feat/hk-face-service-h2c-c4-d-matrix` 的 C4 测试提交与 `34580ab` 定点修复；
2. D01–D75 覆盖是否有遗漏、Z/S/R 断言是否满足设计 §8.1；
3. D73/D74 的 `32+N` 实测与设计 `33+N` 差异是否接受为 Q02 去重结果；
4. 通过后由评审在 docs 分支记录 C4/H2-c 终审结论。
