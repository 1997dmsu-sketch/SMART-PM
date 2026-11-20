# HK-AI-04 H4-c C1 S2 前置核对与执行清单（2026-11-20）

> 状态：**前置核对/文档准备；不授权实施 S2；不改 `403970a` 实现；待 Codex 独立复审。**
>
> 文件性质：**执行清单，不是审批卡/授权书**。不重开设计，不要求重复批准 E1/E2/E3/P9/D4/D5/D6；只核对 S2 原定范围、依赖、准确白名单、逐例验收、guard 复用/预加载/控制与未决项。
>
> 执行者：DSH agent `lead`（deepseek-flash）；调度工作区 `SMART-PM-H3`。
>
> run/session：`hrun-mwog6c51-07fec0` / `session-fde65175-f9f9-41e1-9735-e4c4006578e3`（2026-11-20T11:56:42+08:00 起）。
>
> 分支/工作树：`codex/h4c-c1-s2-preflight` / `宇宙智联/.tmp/c1-s2-preflight`。
>
> 起点/父：`6f96fed9bd478192c8bbffeb52f47c90df89939e` / `403970a035be44bb04d0ce5c01154a103a5ec5c5`。
>
> 本文件提交：普通追加提交；最终完整 SHA 由交付回报给出（本文件不自指）。
>
> 坐标约定：`卡:L640` = 任务卡 @ `6f96fed` 第 640 行；`授权:L120` = 授权清单 @ `ed6f862`；`设计:L486` = 设计 @ `6f96fed`；`S1证据:L555` = 实施证据 @ `6f96fed`；`代码:L323` = `admin-web/lib/face-service/h4c-evidence.mjs` @ `403970a`。完整链接见 §10。

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 前置核对结果 | **READY（可交 Codex 复审）**：固定对象/父链/远端一致；S2 原卡契约可落地；白名单、预算、guard 复用方式明确。 |
| 已批准规则 | E1 18/27、E2、E3、P9、D4a/D4b/D5、D6 按授权 r2 §3.1 视为已批准/冻结；本文件不重开、不要求重复批准。 |
| Stop-1 | 按调度方陈述：Codex 已独立复现 guard 8/8、定向 43/43 后通过；本任务**不重复验收、不重跑测试**。仓库内 `S1证据:L645–657` 仍为“待复审/不进入 S2”的历史状态，本轮不改写。 |
| S2 状态 | **未开工**。本文件不是 S2 授权；S2 实施须另获“本轮单独 S2 授权”并明确起点。 |
| 当前阻断 | 无 **BLOCKED**。有 1 个非阻断待确认项（`observedAt` 相等语义/Q15 引用偏差）与若干条件性阻断（§6）。 |
| 本任务改动 | 仅新增本文件；未改代码/测试/设计/任务卡/勘误/Store/package。 |
| 复审请求 | 请 Codex 只审本清单与 S2 前置条件；不重审 G1/G2/G3/O10/G4/07B，不重审已批准设计。 |

## 1. 固定输入、父链与远端（只读核对）

### 1.1 固定对象与提交

| 对象 | 固定读取点（完整 SHA） | 完整 SHA / blob | 说明 |
|---|---|---|---|
| 设计 v8 | `6f96fed9bd478192c8bbffeb52f47c90df89939e` | blob `c4feffa5831f5bf0e04e8e902865cb8e1f1b0183`；sha256 `d769da93c4880409c946e316f2414ca6b1135a96361934abc188111ca6dcbec7` | 1607 行；冲突优先级 §18 > §17 > §16 > §15 > §4–§14 |
| 勘误 r4 | `6f96fed9bd478192c8bbffeb52f47c90df89939e` | blob `c5797a075f15eadc59c31b80ef258a6717d0af3b` | E1/E2/E3 + D4/D5 回写 |
| 分阶段任务卡 r5 | `6f96fed9bd478192c8bbffeb52f47c90df89939e` | blob `080c590fb61112c3b061b4b26c9dc017f1bf5c73` | `8e15960` 版 + F45 一行更正（`2b72144` 生效，授权 §9.2） |
| 授权清单 r2 | `ed6f862dac5307b0f027a83570fd8a0cb8da1a09` | commit `ed6f862dac5307b0f027a83570fd8a0cb8da1a09`；blob `5922ba81173639e341f7ba9651d7a2e3db4c094a` | 仅覆盖 S0/S1；S2–S6 不在其授权范围（`授权:L105`） |
| S1 实现 | `403970a035be44bb04d0ce5c01154a103a5ec5c5` | commit `403970a035be44bb04d0ce5c01154a103a5ec5c5`；tree `cc0a1082055155af97387b6fb8325e17b61ac6fc` | `h4c-evidence.mjs` blob `fe96c6b03b91eb01b438f679e01fad268b8f8dcb`；C1 测试 blob `a82bbd1e21c1b89cf4b95702382f6539122ccaed` |
| Stop-1 guard 补证 | `6f96fed9bd478192c8bbffeb52f47c90df89939e` | commit `6f96fed9bd478192c8bbffeb52f47c90df89939e`；tree `4a5ef2dd504244df306c9471252903ee1fb105d2` | `403970a` 的 docs-only 子提交；七脚本 + 两份脱敏输出 |
| 本任务起点 | `6f96fed9bd478192c8bbffeb52f47c90df89939e` | — | 仅新增 `docs/tasks/HK-AI-04-H4C-C1-S2-PREFLIGHT-2026-11-20.md` |

### 1.2 父链（线性，无 merge）

| 提交 | 父 | 说明 |
|---|---|---|
| `8e15960d3b2bc87a6dec7a5f267907f646713547` | `d095a1888a2efba7ac8bfea76dfe120a3a74bf08` | 设计 v8 + 勘误 r4 + 任务卡输入 |
| `2b72144e459f4353f69e35b849c3838413fa9d45` | `8e15960d3b2bc87a6dec7a5f267907f646713547` | 授权清单 v1；同时更正任务卡 F45 行 |
| `ed6f862dac5307b0f027a83570fd8a0cb8da1a09` | `2b72144e459f4353f69e35b849c3838413fa9d45` | 授权清单 r2 |
| `a1885092d389681a73bc99e15ba9946da283adbd` | `ed6f862dac5307b0f027a83570fd8a0cb8da1a09` | S0 证据 |
| `84a9a555aca72bb8c60646c1eef8f408f234004f` | `a1885092d389681a73bc99e15ba9946da283adbd` | S0 状态记录 |
| `403970a035be44bb04d0ce5c01154a103a5ec5c5` | `84a9a555aca72bb8c60646c1eef8f408f234004f` | S1 契约层实现 |
| `6f96fed9bd478192c8bbffeb52f47c90df89939e` | `403970a035be44bb04d0ce5c01154a103a5ec5c5` | Stop-1 guard 补证 |

- `git merge-base --is-ancestor` 三项均 exit 0：`8e15960 → 6f96fed`、`ed6f862 → 6f96fed`、`403970a → 6f96fed`。
- `git rev-list --count --merges 8e15960..6f96fed` = **0**；`--count` = **6**，全部线性追加。

### 1.3 远端与工作树

| ref | 远端完整 SHA | 核对 |
|---|---|---|
| `refs/heads/feat/h4c-c1-s0-s1` | `403970a035be44bb04d0ce5c01154a103a5ec5c5` | 与固定实现一致 |
| `refs/heads/codex/h4c-c1-stop1-guard-evidence` | `6f96fed9bd478192c8bbffeb52f47c90df89939e` | 与补证一致 |
| `refs/heads/docs/h4c-c1-s0-s1-authorization` | `ed6f862dac5307b0f027a83570fd8a0cb8da1a09` | 与授权清单一致 |
| `refs/heads/docs/h4c-c1-staged-implementation-task` | `8e15960d3b2bc87a6dec7a5f267907f646713547` | 与任务卡输入一致 |
| `refs/heads/codex/h4c-c1-s2-preflight` | 推送前不存在 | 本任务新建 |

- `git -c http.sslBackend=openssl fetch origin`：**exit 0**（见 §7 的首次 exit 255 说明）；fetch 后上述远端值未变，无前移/分叉。
- 工作树：`HEAD=6f96fed…`；`branch=codex/h4c-c1-s2-preflight`；`HEAD` 父 = `403970a…`；`git status --porcelain` 为空；无 upstream。
- 同目标重复运行检查：`~/.dsh-baton/host-runs` 中仅 `hrun-mwog6c51-07fec0` 命中本任务；未发现其他 running/queued 同目标 run；创建前无同名本地/远端分支、无同名 worktree、无相关定时任务。

### 1.4 文档身份（文件字节 = 固定 blob）

| 文件 | blob | 工作树 sha256 | 文件=blob |
|---|---|---|---|
| 设计 v8 | `c4feffa5…` | `d769da93c4880409c946e316f2414ca6b1135a96361934abc188111ca6dcbec7` | 是 |
| 勘误 r4 | `c5797a07…` | `274317a4fb67d763dcf770473174dc3e32ddefab202883b3b33721a48f76d107` | 是 |
| 任务卡 r5 | `080c590f…` | `388409286d44ecdb277ff42f3cab4fd516955d90059ceffeb2e09c240117204f` | 是 |
| 授权清单 r2 | `5922ba81…` | `4d05398073ccb6e25d73d4f34db3cbd0be47079203cc40c3e3d699bc77a5d7b3` | 是 |
| 实施证据（S1 部分） | `bf21bd7a…` | `cf24a24ca8016844e116facccdf451c35a3387b8dc6277c65026e0e3b6efd2e0` | 是 |

- 逐文件 `git hash-object` 与 `git rev-parse 6f96fed:<path>` 全部相等；未做文本归一化。

## 2. 已批准/冻结规则（只引用，不重开）

| 规则 | 内容 | 状态 | 锚点 |
|---|---|---|---|
| E1/D2 | C1 **18** refs / C2 R1 **27**；writes 3/2；`proof` 只读 ref | APPROVED（本聊天） | `卡:L185`、`卡:L201`；`授权:L120` |
| E2/D3 | 8 个 H4-c 集合字面名 + `admin_audit` 通用边界 | FROZEN（随设计包） | `卡:L227–245`；`授权:L121` |
| E3/D7 | `transactFinal`、`createH4cGate`、构造注入、`#persist` 私有、`h4c-collections.mjs` | FROZEN（随设计包） | `卡:L283–299`；`授权:L122` |
| P9 | 私有 Set + `isH4cCollection` + 冻结枚举快照；不得导出 Set | APPROVED（本聊天） | `卡:L223–262`；`授权:L123` |
| D4a | proof `status="verified"` / `legacyCount=0` / snapshot | APPROVED/CLOSED | `授权:L124` |
| D4b | C1 audit `scopeKey=job._id` / genesis / append / revision=新 sequence / targetList | APPROVED/CLOSED | `授权:L125` |
| D5 | runtime `operationAuthDigest` 显式 `null` + ticket 签名该键 + runtime 白名单 | APPROVED/CLOSED | `授权:L126` |
| D6 | C1 API 形状 `evidenceAppendRefs` / `appendEvidenceWrites` | FROZEN（随设计包） | `卡:L203–221`；`授权:L127` |

- 上述为设计层批准/冻结；不等于 S2 实施已通过，也不替代 S2 单独授权。
- 任务卡 §0/§1.1 的“E2/E3/P9 待复审”与 `S1证据:L645–657` 的“Stop-1 待复审”均为历史状态；按授权 r2 §3.1 与本轮调度陈述，不重开、不重复设计审批。**若 Codex 需要仓库内 Stop-1 通过记录，另行授权补记；本任务不补写通过记录。**
- Stop-2 只核对“实现是否符合已批准锚点”，不重新设计复审 E1/E2/E3/P9/D4/D5/D6（`授权:L230`、`授权:L656`）。

## 3. S2 原定范围、依赖、预算与边界

### 3.1 依赖

| 依赖 | 当前状态 | 说明 |
|---|---|---|
| S1 Stop-1 | 已通过（外部结论） | Codex 独立复现 guard 8/8、定向 43/43；本任务不重跑 |
| E1 18/27 | 已批准 | S2 不得回退到 17 refs；`卡:L201` |
| E2 集合名 | 已冻结 | S2 可直接编码；无第二套字面量 |
| D6 API 形状 | 已冻结 | `evidenceAppendRefs` / `appendEvidenceWrites` 按 `卡:L207–215` |
| S2 单独授权 | **未授予** | 本文件不是授权；无授权不得开工（`授权:L105`） |
| S2 起点 | 待授权明确 | `6f96fed` 是 `403970a` 的 docs-only 子提交，可作候选；最终以 S2 授权写明的完整 SHA 为准 |
| Guard | 可用（固定 commit） | 七脚本 @ `6f96fed`；S2 执行前须校验 sha256 |
| 远端 | 无前移/分叉 | 有变化即停手报告，不替换固定对象 |

### 3.2 范围（原卡 §6）

- **refs**：重写 `evidenceAppendRefs`，返回 exact **18** refs（去重、稳定顺序），包含 domain2 + proof1 + audit1 + fence1 + marker1 + writerPlan1 + anchor1 + head1 + E1..9；**不访问 Store**（`卡:L664`、`卡:L208`）。
- **writes**：重写 `appendEvidenceWrites`，只返回 **3**（首条：anchor+E+head）或 **2**（非首条：E+head）条业务写；**0 domain 写**；唯一 `admin_audit` 不在 helper（`卡:L665`、`卡:L683`）。
- **链规则**：`EmptyProof`（head=null/anchor=null/E1..9=null）；`ChainProof`（anchor valid、head valid、1..N canonical、`previous` 正确、N+1..9 null）；N=9 再 append → `EVIDENCE_INVALID`（`卡:L658`）。
- **删除调用方布尔**：`hasExistingEvidence` 删除，测试/production 静态扫描 0 命中（`卡:L659`）。
- **CAS 保留**：现有 `expectedHead` 语义保留；首条不再依赖调用方布尔（`卡:L660`）。
- **事务内重读 head**；首条要求 anchor/head/E1..9 全空；非首条要求 anchor/head/1..N 完整、N+1..9 空；`previous` 全字段复核（schema/ID/org/job/seq/observedAt/K3/HMAC）（`卡:L665`）。
- **不写 domain**；不 adopt/重编号/删除孤儿；任一失败在返回写之前抛错（`卡:L666`）。
- **错误码**：孤儿/断链/anchor 不配 → `EVIDENCE_CHAIN_BROKEN`；CAS → `EVIDENCE_HEAD_CONFLICT`；seq 预占 → `CONFLICT`；N=9 → `EVIDENCE_INVALID`（`卡:L668`、`卡:L403–425`）。
- **S2 不做的校验**：proof/fence/marker/plan 的完整 `CoverageValid` 在 S5 接入；S2 只保证 refs 声明与链/anchor（`卡:L669`）。

### 3.3 预算与纯 helper / Store 边界（全部来自原卡，不臆造）

| 项 | 值 | 说明 | 来源 |
|---|---|---|---|
| refs | **18** | domain2 + proof1 + audit1 + fence1 + marker1 + writerPlan1 + anchor1 + head1 + E1..9 | `卡:L185`、`卡:L654` |
| helper writes | **3**（首条）/ **2**（非首条） | anchor+E+head / E+head；仅业务写 | `卡:L665`、`卡:L683` |
| domain writes | **0** | S2 只读 domain；不创建/不改写 | `卡:L666` |
| 唯一 audit | **不在 helper** | 由 S3 的 finalWriteSet/调用方加入；事务总写 4/3 是 S3 口径 | `卡:L197`、`卡:L683` |
| Store 访问 | **0** | refs 计算不读 Store；写集只从传入 `state` 读取 | `卡:L664`、`卡:L208` |
| Store 接线 | **不在 S2** | `transactFinal`/gate/`#persist` 属 S4；S2 不改 `store.mjs` | `卡:L739–787` |
| 完整 CoverageValid | **不在 S2** | proof/marker/fence/plan 的完整校验归 S5 | `卡:L669` |

- `proof1` 是 `evidence_chain_audits` 的只读 ref；`audit1` 是通用 `admin_audit`，二者不可混同（`卡:L22–23`、`卡:L185`）。
- C1 的 18 refs 与 C2 R1 的 27 refs 均按审批值；S2 只实现 C1 helper，不实现 C2。
- 票据验证 0 新增 refs；`runtimeTicket` 是 plan 字段，不是新记录（`卡:L200`）。

### 3.4 准确文件白名单（S2 实施，不是本任务）

| 动作 | 文件 | 约束 |
|---|---|---|
| 修改 | `admin-web/lib/face-service/h4c-evidence.mjs` | 重写两个 helper + 必要纯函数；不得改 Store 调用方 |
| 修改 | `admin-web/lib/face-service/index.mjs` | 只增/调整 re-export；不得新增 bootstrap/create-domain/初始化入口 |
| 修改 | `admin-web/tests/face-h4c-evidence.test.mjs` | 只加/改写 S2 断言；不得跑 HTTP/loopback |
| 允许 | `admin-web/lib/h4c-collections.mjs` | 允许但预期不改；若改仍属闭集、不得导出 Set |
| 追加 | `docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-EVIDENCE-2026-11-19.md` | 只追加 S2 小节；不改历史小节 |
| 禁止 | `admin-web/lib/store.mjs`、`admin-web/server.mjs`、`admin-web/lib/face-service/routes.mjs` | 零 diff |
| 禁止 | 设计正文、勘误、任务卡、授权清单、package/lock、其他测试 | 零 diff；不得“顺手修” |

- 白名单是**闭集**；新增任何文件/依赖/脚本需重新授权（`卡:L644–650`、`授权:L254`）。
- **本任务**的允许文件只有 `docs/tasks/HK-AI-04-H4C-C1-S2-PREFLIGHT-2026-11-20.md`；不是 S2 实施。

### 3.5 当前代码基线（`403970a`，只读）

- `evidenceAppendRefs(job, head, domainHead, config)` 仍为旧签名，返回 **4–5** refs（domain2 + head + 下一条 evidence + 可选 previous），不是 18（`代码:L323–344`）。
- `appendEvidenceWrites` 仍接受 `hasExistingEvidence`（3 处：`代码:L354`、`L382`、`L395`）；无 anchor 写集、无 proof/audit/fence/marker/plan refs。
- C1 测试 **43** 项（`^test(` 计数）；`face-h4c-evidence.test.mjs` 中 `.listen(`=0、`fetch(`=0。
- 两个 helper 仅被 C1 测试调用；`store.mjs`/`server.mjs`/`routes.mjs` 无调用点。
- 因此 S2 是**helper + 测试的定向重写**，不是新增 Store 路径；S2 测试改动须在证据中列出保留/改写/新增项，不得只报最终绿灯（`卡:L552–557`）。

## 4. 逐例验收清单（Stop-2）

> 依据：原卡 §6 测试范围、§3.4 错误码、§3.5 零写、§3.6 并发、§11.1 F 矩阵、§12 Stop-2、授权 §7–§8。S2 实施时逐条给出 PASS/FAIL/未测，不得只写“已通过”。

| ID | 验收项 | 通过标准 | 依据 |
|---|---|---|---|
| S2-01 | refs 精确 18 | 数量=18；集合精确；无重复；同一输入稳定顺序；逐个断言 18 个 ref；**proof1 存在** | `卡:L664`、`卡:L673`、`卡:L185` |
| S2-02 | 17 refs / 缺 proof ref 负向 | 必须被拒绝（`ADMISSION_REQUIRED` 或 `PROOF_REQUIRED`），不得静默通过 | `卡:L679`、F41 `卡:L903` |
| S2-03 | 首条成功写集 | 只写 anchor+E1+head（3 条）；**0 domain 写** | `卡:L667`、`卡:L674` |
| S2-04 | 非首条成功写集 | 只写 E+head（2 条）；**0 domain 写** | `卡:L667`、`卡:L674` |
| S2-05 | head=null + E2..9 任一 | `EVIDENCE_CHAIN_BROKEN` | F03 `卡:L873`、`卡:L675` |
| S2-06 | head=null 但 E1 存在 | `EVIDENCE_CHAIN_BROKEN` | `卡:L675` |
| S2-07 | anchor 存在但 head=null | `EVIDENCE_CHAIN_BROKEN` | `卡:L675` |
| S2-08 | head seq2 但 E1 缺失 | `EVIDENCE_CHAIN_BROKEN` | `卡:L675` |
| S2-09 | anchor 字段/ID/`firstEvidenceId` 错 | `EVIDENCE_CHAIN_BROKEN` | `卡:L655`、`卡:L675` |
| S2-10 | 完整链 1..N 正例；N+1..9 非空 | 正例成功；N+1..9 任一非空 → `EVIDENCE_CHAIN_BROKEN` | `卡:L676` |
| S2-11 | N=9 再 append | `EVIDENCE_INVALID` | `卡:L676`、`卡:L415` |
| S2-12 | `still_unknown` 第 8 条后 | E9 仍为 null（`STILL_UNKNOWN_MAX_SEQUENCE=8`） | `卡:L676`、`代码:L34` |
| S2-13 | `previous` 全字段复核 | schema/ID/org/job/seq/observedAt/K3/HMAC 任一损坏 → `EVIDENCE_CHAIN_BROKEN` | `卡:L665`、`卡:L677` |
| S2-14 | observedAt 递减/越界 | `EVIDENCE_STALE`；**相等是否允许见 §6 OPEN-S2-1，不得自行裁定** | `卡:L677` |
| S2-15 | expectedHead 过期 / head 被删 | 过期 → `EVIDENCE_HEAD_CONFLICT`；head 删除但仍带 expectedHead → `EVIDENCE_CHAIN_BROKEN` | `卡:L678` |
| S2-16 | 每个负向零写（helper 层） | 对输入 `state` 做 `structuredClone`，调用前后 deepEqual；抛错前不返回任何 write；错误码一致；断言无半批写。Store/LocalStore 文件级零写归 S4 M 矩阵 | `卡:L429–436`（第 2/6 项）、`卡:L680` |
| S2-17 | 无布尔残留 | production/测试静态扫描 `hasExistingEvidence` 0 命中 | `卡:L659`、`卡:L541`、`卡:L680` |
| S2-18 | 并发（helper 层） | 两首条/两 append 用相同或递进 state 模拟：败者按 `BROKEN`/`HEAD_CONFLICT` 拒绝、无半批写；anchor+E/head 整批不半写。真实 create-only/CAS 一胜与事务回滚归 S4（LocalStore/CloudStore M 矩阵） | `卡:L442–444`、`卡:L681`、`卡:L920–921`、`卡:L774–783` |
| S2-19 | refs/writes 实测 | helper refs=18；writes=3/2；0 domain；helper 无 audit；不得把事务总写 4/3 算作 S2 预算 | `卡:L683`、`卡:L197` |
| S2-20 | 错误码不混用 | `BROKEN`/`HEAD_CONFLICT`/`CONFLICT`/`INVALID`/`STALE` 按 §3.4；失败必须在返回任何写之前抛出 | `卡:L403–425` |
| S2-21 | 静态扫描/白名单 | 仅白名单文件；`store.mjs`/`server.mjs`/`routes.mjs` 零 diff；设计/勘误/任务卡零 diff | `卡:L547–550` |
| S2-22 | guard | 同一 guard；测试模块加载前预加载；8/8 控制通过；计数器全 0；仅 C1 定向文件；33+7 与 8 HTTP 不跑；新增被加载文件已进非监听集 | `授权:L482–489`、`授权:L416`；`S1证据:L580–589` |
| S2-23 | 证据与 Stop-2 | 追加 S2 小节：命令/exit/计数、refs/writes、零写矩阵、未验证单列、Stop-2 请求；不自批 | `卡:L552–557`、`卡:L937` |
| S2-24 | API 形状 | `evidenceAppendRefs({ job, expectedHead, proofId, writeEpoch, auditId, config } = {})`；`appendEvidenceWrites(state, { job, expectedHead, proofId, writeEpoch, auditId, config, now, decision, sourceType, sourceCode, observedAt, actorId } = {})`；返回仅业务写 | `卡:L207–215` |
| S2-25 | 不信任调用方自述 | proof/fence/marker/plan 按 §3.3a 从 `state` 读取；S2 只保证 refs 声明与链/anchor，完整 CoverageValid 归 S5；不得作为布尔/自述传入 | `卡:L221`、`卡:L669` |
| S2-26 | 原子性 | 首条 anchor+E+head 原子；append E+head 原子；任一失败在返回写之前抛错、零写 | `卡:L666–667` |
| S2-27 | 不收养/不改号 | 不 adopt/重编号/删除孤儿；不写 domain；不创建 proof/fence/marker/plan | `卡:L666`、`卡:L669` |

**边界说明**：S2 不接 Store，故 S2-16/S2-18 的零写与并发是 **helper/测试层**（不改输入 `state`、不返回半批写、按传入 state 判冲突）。LocalStore/CloudStore 的事务级零写、create-only 一胜与回滚归 S4 的 M01–M30（`卡:L774–783`）；S2 不得为跑并发而改 `store.mjs` 或新增 Store 路径。

## 5. Guard 复用、预加载与控制

### 5.1 七脚本固定引用（@ `6f96fed`）

| # | 文件（`docs/evidence/h4c-c1-stop1-guard/`） | 交付 SHA-256 |
|---:|---|---|
| 1 | `guard.cjs` | `2d013d808e8b78214db835ada611c9700d966ba07624342e26fcd637a900a8f5` |
| 2 | `run-controls.cjs` | `3fd2507aabd8eb8a7abdb284e3b59061843d9e70ad081e902d291bbe25e73643` |
| 3 | `entry-negative.cjs` | `36f8d53326ab4f270928e294ba9ec517d6efffa935ddf8145cbecfc70f2124a6` |
| 4 | `load-negative.cjs` | `ca89b38c351abcb026c71c5cd3d8fdd784acc192cb804468b29d650c49f7570f` |
| 5 | `child-net.cjs` | `3afa02dec336a12c34114ef4083f87f3b05806dec97b007587faa42aa5c158ef` |
| 6 | `esm-sentinel.mjs` | `b3fb4bef441b1b6aa4f53879af5c1dc712a8dbbb2764d7ddc77379726a671b0c` |
| 7 | `positive.cjs` | `c34225ccc8854a1720ee51985d777ad29e1c7d85860e293bebeb2f3f7268bad2` |

- 同目录 `SHA256SUMS`、`.gitattributes`（`* -text`）与两份脱敏输出均 @ `6f96fed`；引用固定 commit，不复制进 S2 分支（`S1证据:L591–601`、`guard README:L26–38`）。
- S1 实测：7 文件按字节纳入，交付 SHA-256 与原路径一致；本轮不重跑，只作为 S2 复用来源（`S1证据:L555–561`）。

### 5.2 复用与预加载（S2 执行时）

1. 从 `6f96fed` 提取证据目录到**工作树之外**的临时目录（`git archive` + `tar`），按 `SHA256SUMS` 逐文件校验；哈希不符 → BLOCKED。
2. 预加载：`NODE_OPTIONS=--require "<temp>\docs\evidence\h4c-c1-stop1-guard\guard.cjs"`；`H4C_ADMIN_WEB=<S2_WORKTREE>\admin-web`；`H4C_GUARD_REPORT=<temp>\wrapper.report.json`。
3. 由 `run-controls.cjs` 启动：先断言 `NODE_OPTIONS` 含 guard 且 `globalThis.__H4C_GUARD__.active` 为真；再以同一 preload 执行 `node --test --test-isolation=none tests/face-h4c-evidence.test.mjs`（cwd=`admin-web`）。
4. 八项控制必须全过：无 guard 负控、预加载 sentinel、ESM 命名导入、逐入口运行期负控、加载前负控、真实子进程继承、正控（crypto/fs/K3/LocalStore）、C1 定向测试（`S1证据:L580–589`、`guard README:L68–82`）。
5. 失败关闭：无 guard、加载期违规、入口缺失、负控未触发、真实网络泄漏、正控失败、子进程继承失败，任一 → **BLOCKED**；不得降级为无 guard 重跑（`授权:L475–478`）。

### 5.3 S2 的 guard 范围

- 只跑 `admin-web/tests/face-h4c-evidence.test.mjs`；33 个非 HTTP + 7 个根文件**不跑**；8 个 HTTP 文件**明确不跑**（`授权:L482–487`）。
- 新增任何被加载文件，必须先追加到非监听集；否则 Stop-2 失败（`授权:L416`）。
- 证据记录：`process.version`、平台、入口数、负控/正控通过数、子进程结果、各计数器最终值；`listen_calls=0`、`network_attempts=0`、`dns_calls=0`、`dgram_calls=0`、`provider_calls=0`、`load_violations=0`（`授权:L478`、`S1证据:L561`）。

## 6. 未决项、条件性阻断与报告规则

| ID | 事项 | 状态/处置 |
|---|---|---|
| OPEN-S2-1 | `observedAt` 相等（`==`）是否允许。原卡括号写“按已冻结 Q15”，但 `设计:L486` 的 Q15 是 **halt 状态机/恢复授权**，不是 observedAt；本次只读检索未检得 observedAt 相等裁定 | **非阻断待确认**。S2 不得自行选择断言；授权时请 Codex 明确。若视为契约缺口 → 该项升级为 BLOCKED，先裁定再写测试。原卡已允许“若未冻结列待裁”（`卡:L677`）。 |
| STATE-1 | 仓库内 `S1证据:L645–657` 仍写 Stop-1 待复审；调度方陈述 Codex 已独立复现 8/8 + 43/43 后通过 | **记录差异，不重开**。本任务按外部结论引用，不重跑、不补写通过记录；需要入库时另行授权。 |
| D1 | 云 `PARALLEL-DISPATCH.md`/`REVIEW.md` 本机不可读 | 不阻断 S2；保持 UNKNOWN，不声称已闭合（`卡:L962`） |
| D8 | N01–N142 与“工具另立卡”的测试归属 | 阻断 S6，不阻断 S2（`卡:L970`） |
| D10 | `#persist` 私有会破坏 `verification.test.mjs:381` | 阻断 S4，不阻断 S2（`卡:L972`） |
| D11 | 真实 Cloud 并发未验证 | C3；S2 证据须标注“未验证”（`卡:L973`） |
| D9 | S2 实施分支名/起点未派单 | 本 preflight 分支**不得**复用为 S2 实施分支；S2 起点以单独授权写明的完整 SHA 为准 |

**条件性阻断（出现即停手/报告）：**

| ID | 条件 | 处置 |
|---|---|---|
| CB1 | 未获本轮单独 S2 授权 | 不开工；本文件不是授权 |
| CB2 | 固定对象/远端前移或分叉 | 停手报告；不 reset/merge/rebase/force，不替换固定对象 |
| CB3 | Stop-1 通过结论不可用/被撤回 | 停手；不重复验收、不自行判定 |
| CB4 | E1/E2/D6 被改判或重开 | 停手待裁；不自行改 17/18 或集合名 |
| CB5 | OPEN-S2-1 被 Codex 认定为契约缺口 | 该项 BLOCKED；先裁定再写断言 |
| CB6 | 实施中发现新的实质契约矛盾 | **BLOCKED**：提交最小反例与影响，交 Codex 裁定；不改设计/裁定 |
| CB7 | guard 不可用、哈希不符或 8/8 控制失败 | **BLOCKED**；不得无 guard 重跑 |
| CB8 | 新增被加载文件未进非监听集 | Stop-2 失败；先补授权范围 |
| CB9 | 改动 `store.mjs`/`server.mjs`/`routes.mjs`/设计/卡 | 超出 S2 白名单；停止并回退该段 |
| CB10 | 需要安装依赖、访问真实 Cloud/K3/设备/支付/生产网络 | 超出本阶段；停止 |

## 7. 可执行命令

### 7.1 本任务已执行（只读/准备，实际 exit）

| # | 命令（摘要） | exit | 结果 |
|---:|---|---:|---|
| 1 | `git fetch origin`（首次） | 255 | 会话工作区外写权限拒绝（`SMART-PM/.git/worktrees/SMART-PM-H3/FETCH_HEAD`）；未改远端 |
| 2 | `git -c http.sslBackend=openssl fetch origin`（文件策略调整后） | 0 | fetch 成功 |
| 3 | `git worktree add -b codex/h4c-c1-s2-preflight <path> 6f96fed` | 0 | 工作树创建成功 |
| 4 | `git rev-parse` 三个固定 SHA / `git cat-file -t` | 0 | 3 个均为 commit |
| 5 | `git show -s --format=%H/%P` 七个链上提交 | 0 | 父链见 §1.2 |
| 6 | `git merge-base --is-ancestor` ×3 | 0/0/0 | 均可达 |
| 7 | `git ls-remote origin` 固定 ref（含目标分支） | 0 | 完整 SHA 与 §1.3 一致 |
| 8 | `git hash-object` vs `git rev-parse 6f96fed:<path>` ×5 | 0 | 全部相等 |
| 9 | `git diff --check`（工作树） | 0 | 无空白错误 |
| 10 | `git show --check HEAD` | 0 | 无空白错误 |
| 11 | `git status --porcelain` | 0 | 空（写文档前） |

### 7.2 S2 实施时执行（本任务**未运行**，仅列命令）

```powershell
# 0) S2 起点以单独授权写明的完整 SHA 为准；不要用本 preflight 分支开工
git -C <REPO> worktree add -b <S2_BRANCH> <S2_WORKTREE> <S2_START_SHA>

# 1) 从固定 commit 提取 guard 到工作树之外，并校验 SHA256SUMS
$temp = Join-Path $env:TEMP ("h4c-s2-guard-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temp | Out-Null
git -C <REPO> archive -o "$temp\guard.tar" 6f96fed docs/evidence/h4c-c1-stop1-guard
tar -xf "$temp\guard.tar" -C $temp
$dir = Join-Path $temp "docs\evidence\h4c-c1-stop1-guard"
Get-Content "$dir\SHA256SUMS" | ForEach-Object {
  $hash, $name = $_ -split '\s+', 2
  if ((Get-FileHash (Join-Path $dir $name) -Algorithm SHA256).Hash.ToLower() -ne $hash) { throw "HASH MISMATCH: $name" }
}

# 2) 预加载 guard，由包装器跑 C1 定向测试（会同时执行 8/8 控制）
$env:NODE_OPTIONS = '--require "' + (Join-Path $dir 'guard.cjs') + '"'
$env:H4C_ADMIN_WEB = '<S2_WORKTREE>\admin-web'
$env:H4C_GUARD_REPORT = Join-Path $temp 'wrapper.report.json'
Set-Location '<S2_WORKTREE>\admin-web'
node (Join-Path $dir 'run-controls.cjs')

# 3) 等价直接入口（与第 2 步二选一；必须保持同一 preload，不要摘除 guard）
node --test --test-isolation=none tests/face-h4c-evidence.test.mjs

# 4) 提交前后自检（S2 实施时）
git -C <S2_WORKTREE> diff --check
git -C <S2_WORKTREE> show --check HEAD
git -C <S2_WORKTREE> diff --stat <S2_START_SHA>..HEAD
git -C <REPO> ls-remote origin refs/heads/<S2_BRANCH>
```

- 禁止：`npm test`/glob、33+7、8 个 HTTP 文件、任何无 guard 的运行、任何 HTTP/UI/服务启动。
- `run-controls.cjs` 内部执行 `node --test --test-isolation=none tests/face-h4c-evidence.test.mjs`；不要重复跑成“两套证据”。

## 8. 停止点与交接

- **本任务停止点**：提交并普通推送本文件 → 交 Codex 独立复审 → 停手。**不实施 S2、不改 `403970a`、不进入 S3。**
- **Stop-2 通过条件**（原卡）：18 refs（含 proof1）；anchor/1..9/完整链；无布尔；缺 proof 负向拒绝；零写（`卡:L937`）。授权清单同款（`授权:L497`）。
- **Stop-2 复审输入**：S2 diff + refs/链测试 + 零写 + guard 计数 + 证据小节 + 未验证单列。
- **下一段**：Stop-2 通过后，只能“申请”S3 的本轮单独授权；没有该授权不得开工（`授权:L503`）。本文件不自批、不宣称 C1/G1 通过。
- **不重复验收**：G1/G2/G3/O10/G4/07B 门禁不在本任务范围；Stop-1 已由 Codex 独立复现，不重跑。

## 9. 本任务未验证/未做

- 未实现任何 S2 代码；未修改 `h4c-evidence.mjs`/`index.mjs`/测试/Store/设计/卡。
- 未运行任何测试、guard 控制、`node --test`、`npm`；未安装依赖。
- 未访问真实 Cloud/K3/设备/Provider/支付/生产网络；未启动 HTTP/UI；未部署；未处置风险。
- 未读云 `PARALLEL-DISPATCH.md`/`REVIEW.md` 正文；不声称与云端派单逐项一致。
- 未验证真实 Cloud 并发（D11/C3）；未验证 S2 的 18 refs 实现（尚未写）。
- Stop-1 的 8/8、43/43 是外部结论/历史证据，本任务未重跑、未独立复现。
- `fetch` 首次因文件权限失败（exit 255），文件策略调整后重跑成功；该环境事实已如实记录，不影响固定 SHA 核对。
- 未对 `6f96fed` 之后的远端做“未来变化”保证；复审前应以 `ls-remote` 再核对一次。

## 10. 固定 SHA 文件链接

| 文件 | 固定链接 |
|---|---|
| 设计 v8 | https://github.com/1997dmsu-sketch/SMART-PM/blob/6f96fed9bd478192c8bbffeb52f47c90df89939e/docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md |
| 勘误 r4 | https://github.com/1997dmsu-sketch/SMART-PM/blob/6f96fed9bd478192c8bbffeb52f47c90df89939e/docs/tasks/HK-AI-04-H4C-C1-REFS-ERRATUM-2026-11-19.md |
| 任务卡 r5 | https://github.com/1997dmsu-sketch/SMART-PM/blob/6f96fed9bd478192c8bbffeb52f47c90df89939e/docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-TASK-2026-11-18.md |
| 授权清单 r2 | https://github.com/1997dmsu-sketch/SMART-PM/blob/ed6f862dac5307b0f027a83570fd8a0cb8da1a09/docs/tasks/HK-AI-04-H4C-C1-S0-S1-AUTHORIZATION-2026-11-19.md |
| S1 实现 `h4c-evidence.mjs` | https://github.com/1997dmsu-sketch/SMART-PM/blob/403970a035be44bb04d0ce5c01154a103a5ec5c5/admin-web/lib/face-service/h4c-evidence.mjs |
| S1 测试 | https://github.com/1997dmsu-sketch/SMART-PM/blob/403970a035be44bb04d0ce5c01154a103a5ec5c5/admin-web/tests/face-h4c-evidence.test.mjs |
| S1/Stop-1 证据 | https://github.com/1997dmsu-sketch/SMART-PM/blob/6f96fed9bd478192c8bbffeb52f47c90df89939e/docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-EVIDENCE-2026-11-19.md |
| Guard 七脚本目录 | https://github.com/1997dmsu-sketch/SMART-PM/tree/6f96fed9bd478192c8bbffeb52f47c90df89939e/docs/evidence/h4c-c1-stop1-guard |
| 本文件 | 最终提交 SHA 由交付回报给出；链接格式 `/blob/<final-sha>/docs/tasks/HK-AI-04-H4C-C1-S2-PREFLIGHT-2026-11-20.md` |

## 11. 交付回报字段（提交后由最终回复填写）

```text
任务：HK-AI-04-H4C-C1-S2-PREFLIGHT-2026-11-20（仅文档准备）
执行者：DSH agent lead（deepseek-flash）
run/session：hrun-mwog6c51-07fec0 / session-fde65175-f9f9-41e1-9735-e4c4006578e3
工作树/分支：宇宙智联/.tmp/c1-s2-preflight / codex/h4c-c1-s2-preflight
固定输入/父：403970a035be44bb04d0ce5c01154a103a5ec5c5 / 6f96fed9bd478192c8bbffeb52f47c90df89939e
最终提交：<fill-after-commit>
文件清单：docs/tasks/HK-AI-04-H4C-C1-S2-PREFLIGHT-2026-11-20.md（仅此一个）
命令/exit：见 §7.1（fetch 首次 255、重跑 0；worktree add 0；diff/show --check 0）
未验证：S2 代码、guard 重跑、测试、真实 Cloud/设备/支付/HTTP/UI
停止点：本文件推送后停手，交 Codex 独立复审；不实施 S2、不进入 S3、不自批
```
