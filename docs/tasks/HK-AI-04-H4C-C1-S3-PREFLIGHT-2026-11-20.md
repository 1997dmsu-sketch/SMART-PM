# HK-AI-04 H4-c C1 S3 前置核对与执行清单（2026-11-20）

> 状态：**前置核对/文档准备；不授权实施 S3；不改 `923dbf1` 实现；不新增重复审批卡；待 Codex 独立复审。**
>
> 文件性质：**执行清单，不是审批卡/授权书**。不重开设计，不要求重复批准 E1/E2/E3/P9/D4/D5/D6，不重开 S2 收口裁定；只核对 S3 原定范围、依赖、准确白名单、冻结字段/接口、预算、逐例验收、guard 复用与 Stop-3。
>
> 执行者：DSH agent `lead`（deepseek-flash）；调度工作区 `SMART-PM-H3`。
>
> run/session：`hrun-mwoisk62-1b676a` / `session-fde65175-f9f9-41e1-9735-e4c4006578e3`（2026-11-20T13:09:58+08:00 起）。
>
> 分支/工作树：`codex/h4c-c1-s3-preflight` / `宇宙智联/.tmp/c1-s3-preflight`。
>
> 起点/父：`923dbf10317798aa82a146c58173a15c0590aa6e` / `0b7eca2a676a337b656afcfa89f1a92490828ff1`。
>
> 固定 S2 验收：`923dbf1`（Codex Stop-2 已通过并关闭）；guard 补证：`6f96fed9bd478192c8bbffeb52f47c90df89939e`。
>
> 本文件提交：普通追加；最终完整 SHA 由交付回报给出（本文件不自指）。
>
> 坐标约定：`卡:L689` = 任务卡 @ `923dbf1` 第 689 行；`授权:L118` = 授权清单 @ `ed6f862`；`设计:L486` = 设计 @ `923dbf1`；`代码:L742` = `admin-web/lib/face-service/h4c-evidence.mjs` @ `923dbf1`。完整链接见 §10。

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 前置核对结果 | **READY（可交 Codex 复审）**：固定对象/父链/远端一致；S3 原卡契约可落地；白名单、冻结字段、预算、guard 复用与 Stop-3 明确。 |
| 已关闭输入 | S2 Stop-2 已由 Codex 独立验收并关闭（53/53 + guard 8/8；网络/监听/Provider 计数 0；Store/路由/生产接线零差异）；S2 错误码裁定已定；**本任务不重跑、不重开**。 |
| S3 状态 | **未开工**。本文件不是 S3 授权；S3 实施须另获“本轮单独 S3 授权”并明确起点/分支。 |
| 当前阻断 | 无 **BLOCKED**。有 1 个边界说明（S3 只能在 helper/测试层模拟 Store 自动追加/回滚；真实 Store explicit 模式归 S4）与若干条件性阻断（§6）。 |
| 本任务改动 | 仅新增本文件；未改代码/测试/设计/任务卡/Store/package；未运行测试/guard。 |

## 1. 固定输入、父链与远端（只读核对）

### 1.1 固定对象

| 对象 | 固定读取点 | 完整 SHA / blob | 说明 |
|---|---|---|---|
| S2 验收提交 | `923dbf1` | commit `923dbf10317798aa82a146c58173a15c0590aa6e`；tree `372fbadf1adfeeb800625ae0660938433b878d2a` | S2 链层实现；Stop-2 已关闭 |
| 分阶段任务卡 r5 | `923dbf1` | blob `080c590fb61112c3b061b4b26c9dc017f1bf5c73` | S3 见 §7（`卡:L689–737`） |
| 设计 v8 | `923dbf1` | blob `c4feffa5831f5bf0e04e8e902865cb8e1f1b0183` | 冲突优先级 §18 > §17 > §16 > §15 > §4–§14 |
| 勘误 r4 | `923dbf1` | blob `c5797a075f15eadc59c31b80ef258a6717d0af3b` | E1/E2/E3 + D4/D5 |
| 授权清单 r2 | `ed6f862` | commit `ed6f862dac5307b0f027a83570fd8a0cb8da1a09`；blob `5922ba81173639e341f7ba9651d7a2e3db4c094a` | 仅 S0/S1 授权；S3 不在其授权范围 |
| S2 证据 | `923dbf1` | blob `367524e01e9b8ebc39b9b143beeef0d0513fdadc` | S2.1–S2.11；27 项对照与 Stop-2 请求 |
| 本任务起点 | `923dbf1` | — | 仅新增 `docs/tasks/HK-AI-04-H4C-C1-S3-PREFLIGHT-2026-11-20.md` |

### 1.2 父链（线性，无 merge）

| 提交 | 父 | 说明 |
|---|---|---|
| `923dbf10317798aa82a146c58173a15c0590aa6e` | `0b7eca2a676a337b656afcfa89f1a92490828ff1` | S2 链层实现（Stop-2 已关闭） |
| `0b7eca2a676a337b656afcfa89f1a92490828ff1` | `3c3e439ae98b29f525972d993141af454a657d8d` | S2 前置清单（已验收） |
| `3c3e439ae98b29f525972d993141af454a657d8d` | `d9ef8d2bfbc91b248fd57e5a629722d4f7a97720` | 前置清单全 SHA 精确化 |
| `d9ef8d2bfbc91b248fd57e5a629722d4f7a97720` | `6f96fed9bd478192c8bbffeb52f47c90df89939e` | 首轮 S2 前置清单 |
| `6f96fed9bd478192c8bbffeb52f47c90df89939e` | `403970a035be44bb04d0ce5c01154a103a5ec5c5` | Stop-1 guard 补证 |
| `403970a035be44bb04d0ce5c01154a103a5ec5c5` | `84a9a555aca72bb8c60646c1eef8f408f234004f` | S1 契约层 |
| `84a9a555aca72bb8c60646c1eef8f408f234004f` | `a1885092d389681a73bc99e15ba9946da283adbd` | S0 状态记录 |

- `git merge-base --is-ancestor 0b7eca2 923dbf1` exit 0；`6f96fed..923dbf1` 为线性追加，`--merges` = 0。
- 本任务从 `923dbf1` 新建分支，保留全部祖先；不 merge/cherry-pick 其他分支。

### 1.3 远端与工作树

| ref | 远端完整 SHA | 核对 |
|---|---|---|
| `refs/heads/feat/h4c-c1-s2` | `923dbf10317798aa82a146c58173a15c0590aa6e` | 与固定 S2 验收一致 |
| `refs/heads/codex/h4c-c1-s3-preflight` | 推送前不存在 | 本任务新建 |
| `refs/heads/codex/h4c-c1-s2-preflight` | `0b7eca2a676a337b656afcfa89f1a92490828ff1` | 上游前置清单 |

- `git -c http.sslBackend=openssl fetch origin`：**exit 0**；fetch 后 `feat/h4c-c1-s2` 仍为 `923dbf1`，无前移/分叉。
- 工作树：`HEAD=923dbf1…`；`branch=codex/h4c-c1-s3-preflight`；`HEAD` 父 = `0b7eca2…`；`git status --porcelain` 为空；无 upstream。
- **重复运行/排队检查**：`~/.dsh-baton/host-runs` 中仅本轮 `hrun-mwoisk62-1b676a` 命中 C1 S3 前置；无其他 running/queued 同目标 run；创建前无 `codex/h4c-c1-s3-preflight` 本地/远端分支、无同名 worktree、无相关定时任务。

### 1.4 文档身份

| 文件 | blob | 说明 |
|---|---|---|
| 任务卡 r5 | `080c590f…` | 与 S2 阶段同一 blob；S3 未改卡 |
| 设计 v8 | `c4feffa5…` | 与 S2 阶段同一 blob |
| 勘误 r4 | `c5797a07…` | 与 S2 阶段同一 blob |
| 授权清单 r2 | `5922ba81…` | 与 S2 阶段同一 blob |
| S2 证据 | `367524e0…` | 含 S2.1–S2.11 |

## 2. 已关闭输入与批准规则（不重开）

| 项 | 内容 | 状态 | 依据 |
|---|---|---|---|
| S2 Stop-2 | `923dbf1`；53/53 + guard 8/8；网络/监听/Provider 计数 0；Store/路由/生产接线零差异 | **ACCEPTED/CLOSED**（Codex 独立验收） | 外部结论；本任务不重跑 |
| S2 错误码裁定 | 有效链目标 `E(N+1)` 预占 → `CONFLICT`；首条残留/断链/更后位置孤儿 → `EVIDENCE_CHAIN_BROKEN` | **CLOSED**；不重开、不重测 | 本轮明确裁定；S3 只依赖 |
| E1/D2 | C1 **18** refs / C2 R1 **27**；writes 3/2；proof 只读 ref | APPROVED | `授权:L120`、`卡:L185` |
| E2/D3 | 8 个 H4-c 集合字面名 + `admin_audit` 通用边界 | FROZEN | `授权:L121`、`卡:L227–245` |
| E3/D7 | `transactFinal`、`createH4cGate`、构造注入、`#persist` 私有、`h4c-collections.mjs` | FROZEN | `授权:L122`、`卡:L283–299` |
| P9 | 私有 Set + `isH4cCollection` + 冻结枚举快照；不得导出 Set | APPROVED | `授权:L123`、`卡:L223–262` |
| D4a | proof `status="verified"` / `legacyCount=0` / snapshot | APPROVED/CLOSED | `授权:L124` |
| D4b | C1 audit `scopeKey=job._id` / genesis / append / revision=新 sequence / targetList | APPROVED/CLOSED | `授权:L125`、`卡:L371–399` |
| D5 | runtime `operationAuthDigest` 显式 `null` + ticket 签名该键 + runtime 白名单 | APPROVED/CLOSED | `授权:L126`、`卡:L371–399` |
| D6 | C1 API 形状 `evidenceAppendRefs` / `appendEvidenceWrites` | FROZEN | `授权:L127`、`卡:L203–221` |

- 上述为设计层批准/冻结；不等于 S3 实施已通过，也不替代 S3 单独授权。
- S2 已收口：**不重复修订、不重复测试、不重开错误码/链层裁定**；S3 不修改 `evidenceAppendRefs`/`appendEvidenceWrites` 的链语义。

## 3. S3 原定范围、依赖、预算与边界

### 3.1 依赖

| 依赖 | 当前状态 | 说明 |
|---|---|---|
| S2 Stop-2 | 已通过并关闭 | Codex 独立验收；本任务不重跑 |
| D4b/D5 | 已关闭 | C1 audit 精确公式；runtime `operationAuthDigest=null` + 签名 + 白名单 |
| §3.3a API | 已审 | `evidenceAppendRefs` / `appendEvidenceWrites` 形状不变 |
| E1 18/27 | 已批准 | S3 不得新增 ref；18/3\|2 不变 |
| S3 单独授权 | **未授予** | 本文件不是授权；无授权不得开工 |
| S3 起点/分支 | 待 S3 授权明确 | 本 preflight 分支仅用于文档，**不得**复用为 S3 实施分支；起点建议 `923dbf1`，最终以授权完整 SHA 为准 |
| Guard | 可用（固定 commit） | 七脚本 @ `6f96fed`；S3 执行前校验 sha256 |
| 远端 | 无前移/分叉 | 有变化即停手报告，不替换固定对象 |

### 3.2 范围（原卡 §7）

- **两阶段**：precheck（6 字段，无 digest，fail-fast）→ final ticket（finalWriteSet 确定后 mint）（`卡:L719`）。
- **precheck**：`kind, operation, writeEpoch, admissionPolicyVersion, writerSetDigest, proofId` 六字段精确；缺/多/类型错 → `EVIDENCE_CHAIN_ADMISSION_REQUIRED`。
- **finalWriteSet**：C1 业务写（anchor+E+head 或 E+head）+ **唯一** `admin_audit`（7 字段）；audit 必须在签票前物化；Store explicit 模式不得再追加第二个 audit（`卡:L709–713`、`卡:L323–330`）。
- **ticket**：`HMAC-SHA256(K3, "KEYED_DIGEST/h4-canonical-write-admission" v1, canonical(precheck ∪ {refsDigest, writesDigest, operationAuthDigest}))`；ticket 不包含自身、不提前签、不在终检后追加写（`卡:L707–708`、`卡:L722`）。
- **refsDigest/writesDigest**：`SHA-256(canonical sorted refs [{collection,id}])` / `SHA-256(canonical sorted finalWriteSet [{collection,id,data}])`；writesDigest 覆盖含 audit 的最终字节（`卡:L705–706`、`卡:L329`）。
- **唯一 audit**：C1 test-only 显式 audit；`scopeKey=job._id`；首条 action `"h4c.evidence.genesis"`/非首 `"h4c.evidence.append"`；`revision=本次新 evidence.sequence`；`targetList` 排序、不含 audit、重复业务目标拒绝；exact 7 字段；`createdAt` 同一可信 `now`；`target=targetList.join(", ")`；C2/control 生产公式另卡（`卡:L712`、`卡:L326`）。
- **operationAuthDigest**：runtime 显式 JSON `null`；final ticket 必须包含并签名该键，不可省略；缺失/undefined/空串/任意摘要 → ADMISSION；`proof/precheck/epoch/refsDigest/writesDigest` 保持（`卡:L714`、`卡:L377`）。
- **runtime 白名单**：C1 工厂仅接受 `kind="runtime"` 且 `operation∈{"genesis","append"}`；control kind/operation 默认拒绝，null 不绕控制授权（`卡:L715`、`卡:L280`）。
- **旧路径**：只有业务写、没有 ticket → ADMISSION；ticket 正确但 chain 失败 → 链错误优先，零写（`卡:L732`）。
- **0 新增 refs**；ticket 字节不落库（除非作为 plan 字段的既有设计）（`卡:L723`）。

### 3.3 冻结字段/接口

| 项 | 冻结内容 | 依据 |
|---|---|---|
| precheck | 六字段精确：`kind, operation, writeEpoch, admissionPolicyVersion, writerSetDigest, proofId` | `卡:L704` |
| admission 最终形 | 十字段：precheck + `refsDigest, writesDigest, operationAuthDigest, ticket`（exact；无额外键） | `代码:L704–707`、`代码:L1307–1324` |
| refsDigest | SHA-256；canonical sorted `[{collection,id}]`；去重/排序 | `卡:L705`、`代码:L798` |
| writesDigest | SHA-256；canonical sorted `[{collection,id,data}]`；覆盖 finalWriteSet 含 audit | `卡:L706`、`代码:L808` |
| ticket | HMAC-SHA256 K3；domain `KEYED_DIGEST/h4-canonical-write-admission` v1；canonical precheck ∪ digests ∪ operationAuthDigest；不含 ticket 自身 | `卡:L707–708`、`代码:L742` |
| finalWriteSet | 业务写 3/2 + 恰好 1 条 `admin_audit`；每项 `{collection,id,data}`；`data._id===id`；exact 字段 | `卡:L709`、`卡:L323–330` |
| audit 7 字段 | `_id, orgId, actorId, actorType, action, target, createdAt`；ID `audit-h4c-v1:` + 32 hex | `卡:L325–326`、`代码:L664`、`代码:L862–899` |
| operationAuthDigest | 显式 JSON `null`；ticket 签名覆盖该键；缺失/undefined/空串/任意摘要 → ADMISSION | `卡:L714`、`卡:L377` |
| runtime 白名单 | `kind="runtime"` 且 `operation∈{"genesis","append"}`；control 拒绝 | `卡:L715`、`卡:L280` |
| 复用 S1 helper | `evidenceC1AuditId`/`evidenceC1AuditRecord`/`validateEvidenceC1AuditRecord`/`h4cAdmissionTicketDigest`/`h4cRefsDigest`/`h4cWritesDigest`/`AdmissionValid` 已存在；S3 复用，不重复造 | `代码:L742`、`L798`、`L808`、`L862`、`L881`、`L902`、`L1307` |

### 3.4 refs/writes 预算

| 项 | 值 | 说明 | 依据 |
|---|---|---|---|
| refs | **18** | 与 S2 相同；S3 不新增 ref | `卡:L735`、`卡:L723` |
| helper 业务写 | **3**（首条）/ **2**（非首条） | anchor+E+head / E+head；helper 不写 audit | `卡:L720`、`卡:L735` |
| finalWriteSet | **4**（首条）/ **3**（非首条） | 业务写 + 唯一 audit；这是 helper 形状，不是 Store 落库 | `卡:L735`、`卡:L709` |
| ticket 新增 refs | **0** | ticket 字节不落库 | `卡:L723` |
| domain/proof/fence/marker/plan 写 | **0** | S3 只读；不创建/修改 | `卡:L328` |

### 3.5 准确文件白名单（S3 实施，不是本任务）

| 动作 | 文件 | 约束 |
|---|---|---|
| 修改 | `admin-web/lib/h4c-collections.mjs` | 允许但预期不改；不得导出 Set/新增集合 |
| 修改 | `admin-web/lib/face-service/h4c-evidence.mjs` | 增加 precheck/finalWriteSet/ticket helper；不改链层语义 |
| 修改 | `admin-web/lib/face-service/index.mjs` | 只增/调整 re-export；不得新增 bootstrap/create-domain/初始化入口 |
| 修改 | `admin-web/tests/face-h4c-evidence.test.mjs` | 只加/改写 S3 断言；不得跑 HTTP/loopback |
| 追加 | `docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-EVIDENCE-2026-11-19.md` | 只追加 S3 小节；不改历史 |
| 禁止 | `admin-web/lib/store.mjs`、`admin-web/server.mjs`、`admin-web/lib/face-service/routes.mjs` | 零 diff；Store explicit 模式归 S4 |
| 禁止 | 设计/勘误/任务卡/授权清单/package/lock/其他测试 | 零 diff；不得“顺手修” |

- 白名单是**闭集**；新增任何文件/依赖/脚本需重新授权（`卡:L693–699`、`授权:L254`）。
- **本任务**的允许文件只有 `docs/tasks/HK-AI-04-H4C-C1-S3-PREFLIGHT-2026-11-20.md`。

### 3.6 当前基线（`923dbf1`，只读）

- S2 已交付：`evidenceAppendRefs` 18 refs（`代码:L366`）、`appendEvidenceWrites` 3/2 业务写（`代码:L412`）、chain/CAS/observedAt 非递减。
- S1 已有可复用授权 helper：`h4cAdmissionTicketDigest`（`代码:L742`）、`h4cRefsDigest`（`代码:L798`）、`h4cWritesDigest`（`代码:L808`）、`evidenceC1AuditId`（`代码:L862`）、`evidenceC1AuditRecord`（`代码:L881`）、`validateEvidenceC1AuditRecord`（`代码:L902`）、`AdmissionValid`（`代码:L1307`）、`createH4cGate`（`代码:L1357`）。
- **尚未存在** precheck/finalWriteSet/final-ticket 组装 helper；S3 需新增，但必须复用上述公式/校验，不另造第二套。
- 当前 C1 测试 53 项（S2 基线）；S3 新增 V06–V13 与授权层用例后总数以实施证据为准，不预设。

### 3.7 明确不在 S3

- **Store 接线**：`transactFinal`、explicit 模式、gate 注入、M01–M30、LocalStore/CloudStore 回滚 → **S4**（`卡:L739–787`）。
- **完整 CoverageValid**：proof/fence/marker/writer plan 的完整校验 → **S5**（`卡:L669`）。
- **S2 链层**：18 refs/anchor/1..9/错误码已收口；S3 不重开、不改写（§2）。
- **S6 全量**：33 非 HTTP + 7 根文件、F/N 全矩阵 → S6；S3 不跑。
- C2/C3、HTTP/UI、真实 Cloud/K3/设备/Provider/支付、迁移/部署 → 全部冻结。

## 4. 逐例验收清单（Stop-3）

> 依据：原卡 §7 测试范围、§3.3e/§3.3g/§3.3h、§3.4 错误码、§3.5 零写、§3.6 并发、§12 Stop-3、授权 §7–§8。S3 实施时逐条给出 PASS/FAIL/未测。

| ID | 验收项 | 通过标准 | 依据 |
|---|---|---|---|
| S3-01 | precheck 六字段精确 | 缺/多/类型错/未知 operation → `ADMISSION`；precheck 不含 digest，fail-fast | `卡:L704`、`卡:L719`、`卡:L727` |
| S3-02 | refsDigest 字节绑定 | canonical sorted `[{collection,id}]`；篡改/重排/改 ref → `ADMISSION` | `卡:L705`、`卡:L728`、`代码:L798` |
| S3-03 | writesDigest 字节绑定 | canonical sorted `[{collection,id,data}]`；覆盖 finalWriteSet 含 audit；篡改 → `ADMISSION` | `卡:L706`、`卡:L728–729`、`代码:L808` |
| S3-04 | finalWriteSet 唯一 audit | 业务写 3/2 + 恰好 1 条 audit（4/3）；0/2 条、缺 audit、audit 不在 refs、targetList 不一致 → `ADMISSION` | `卡:L709`、`卡:L729`、`卡:L323–330` |
| S3-05 | C1 audit V06/V07 正例 | `scopeKey=job._id`；genesis/append action；revision=新 sequence；targetList 排序/不含 audit/无重复；7 字段；`createdAt`=同一 now；`target`=join | `卡:L392–393`、`卡:L326` |
| S3-06 | C1 audit V08/V09 负例 | scopeKey/action/revision（jobRevision/domainHeadRevision/旧 sequence）/targetList 未排序/含 audit/重复；字段多/缺、createdAt≠now、target≠join → `ADMISSION` | `卡:L394–395` |
| S3-07 | ticket 公式/字节绑定 | HMAC-SHA256 K3；domain v1；canonical precheck ∪ {refsDigest,writesDigest,operationAuthDigest}；不含 ticket 自身；不提前签；终检后不追加 | `卡:L707–708`、`卡:L722`、`代码:L742` |
| S3-08 | operationAuthDigest V10–V13 | 显式 JSON null 且被签名；缺失/undefined/空串/任意摘要 → ADMISSION；proof/precheck/epoch/refsDigest/writesDigest 不符 → ADMISSION；control kind/operation 即使 null 也拒绝 | `卡:L396–399`、`卡:L714–715`、`代码:L1315–1324` |
| S3-09 | runtime 白名单 | 仅 `kind="runtime"` + `operation∈{"genesis","append"}`；control 默认拒绝；null 不绕控制授权 | `卡:L715`、`卡:L280` |
| S3-10 | 旧路径/链错误优先 | 只有业务写、无 ticket → ADMISSION；ticket 正确但 chain 失败 → 链错误优先、零写 | `卡:L732`、`卡:L721` |
| S3-11 | 零写/不可变 | 每个负向输入 state `structuredClone` 前后 deepEqual；失败在返回写前抛错；无半批写；ticket 不落库 | `卡:L427–436`、`卡:L723` |
| S3-12 | 并发（helper 层） | 同 ticket/同 head 一胜；败者 ADMISSION/HEAD_CONFLICT，无半写；真实 Store 并发归 S4 | `卡:L733`、`卡:L442–444` |
| S3-13 | refs/writes 实测 | refs=18；helper 3/2；finalWriteSet 4/3；0 new refs；0 domain/proof/fence/marker/plan 写 | `卡:L735`、`卡:L723` |
| S3-14 | 静态/白名单 | 仅白名单文件；`store.mjs`/`server.mjs`/`routes.mjs` 零 diff；设计/卡零 diff；无新增初始化入口 | `卡:L552–557`、`卡:L693–699` |
| S3-15 | 测试范围 | precheck/ticket/digest/audit V06–V13；fixed test K3 HMAC 向量；不跑 33+7、8 HTTP、npm/glob | `卡:L727–733`、`授权:L482–489` |
| S3-16 | guard | 同一 guard；7 脚本 SHA256SUMS 校验；8/8 控制；计数器全 0；仅 C1 定向文件 | `授权:L482–489`、`S2证据:L958–978` |
| S3-17 | 证据/Stop-3 | 追加 S3 小节：命令/exit/计数、refs/writes、零写、V06–V13、未验证、Stop-3 请求；不自批 | `卡:L552–557`、`卡:L737` |
| S3-18 | 边界 | Store 自动追加/回滚只在 helper/测试层模拟；真实 explicit 模式归 S4；完整 CoverageValid 归 S5 | `卡:L739–787`、`卡:L669` |

## 4.1 边界说明（S3 vs S4/S5）

- S3 只做授权层纯逻辑：precheck → finalWriteSet（业务写+唯一 audit）→ final ticket/验签。**不修改 Store**，不实现 `transactFinal`/explicit 模式/gate 注入/M01–M30。
- S3 的“Store 试图自动追加 audit → ADMISSION/回滚”只能在 helper/测试层用合成 finalWriteSet 模拟；真实 Store 行为（explicit 模式、回滚、LocalStore/CloudStore）归 S4。不得为跑该用例改 `store.mjs` 或扩白名单。
- S3 的“同 ticket/同 head 一胜”为 helper 层；真实 Store 并发一胜归 S4。
- proof/fence/marker/plan 的完整 `CoverageValid` 归 S5；S3 只用现有 `AdmissionValid`/ticket/audit helper，不把 S5 校验提前夹带。

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

- 同目录 `SHA256SUMS`、`.gitattributes`（`* -text`）与两份脱敏输出均 @ `6f96fed`；引用固定 commit，不复制进 S3 分支。
- 七脚本与 S2 完全相同；S2 已实测 8/8 + 63/63 入口；S3 复用同一套，不另造 guard。

### 5.2 复用/预加载（S3 执行时）

1. 从 `6f96fed` 提取证据目录到工作树之外临时目录（`git archive` + `tar`），按 `SHA256SUMS` 校验；哈希不符 → BLOCKED。
2. `NODE_OPTIONS=--require "<temp>\docs\evidence\h4c-c1-stop1-guard\guard.cjs"`；`H4C_ADMIN_WEB=<S3_WORKTREE>\admin-web`；`H4C_GUARD_REPORT=<temp>\wrapper.report.json`。
3. 由 `run-controls.cjs` 启动：先断言 guard sentinel；再在同一 preload 执行 `node --test --test-isolation=none tests/face-h4c-evidence.test.mjs`（cwd `admin-web`）。
4. 8/8 控制必须全过；计数器 `listen_calls=0`、`network_attempts=0`、`dns_calls=0`、`dgram_calls=0`、`provider_calls=0`、`load_violations=0`、`real_leaks=0`。
5. 失败关闭：无 guard、加载期违规、入口缺失、负控未触发、真实网络泄漏、正控失败、子进程继承失败 → **BLOCKED**；不得无 guard 重跑。

### 5.3 S3 允许的非监听命令

- 仅 `admin-web/tests/face-h4c-evidence.test.mjs`，cwd `admin-web`，在上述 guard 内运行。
- 33 个非 HTTP + 7 个根文件**不跑**；8 个 HTTP 文件**明确不跑**；`npm test`/glob/任何服务不跑。
- 允许加载既有 `admin-web/lib/store.mjs`（测试依赖/非监听集），但**不得修改**；Store 语义验收归 S4。
- 新增任何被加载文件，必须先追加到非监听集；否则 Stop-3 失败。

## 6. 未决项、条件性阻断与报告规则

| ID | 事项 | 状态/处置 |
|---|---|---|
| D1 | 云 `PARALLEL-DISPATCH.md`/`REVIEW.md` 本机不可读 | 不阻断 S3；保持 UNKNOWN，不声称已闭合 |
| D8 | N01–N142 与“工具另立卡”的测试归属 | 阻断 S6，不阻断 S3 |
| D10 | `#persist` 私有会破坏 `verification.test.mjs:381` | 阻断 S4，不阻断 S3 |
| D11 | 真实 Cloud 并发未验证 | C3；S3 证据标注“未验证” |
| D9 | S3 实施分支名/起点未派单 | 本 preflight 分支仅文档；S3 实施分支/起点以单独授权完整 SHA 为准 |
| S3-B1 | Store 自动追加/回滚测试与 S3 白名单的边界 | **边界说明，非 BLOCKED**：S3 只在 helper/测试层模拟；真实 Store explicit 模式/M01–M30 归 S4。若 Codex 要求 S3 证明 Store 行为，需扩白名单，先停手待裁 |
| S3-B2 | `admissionPolicyVersion`/`writerSetDigest` 测试 fixture 取值未在卡中冻结 | S3 只用固定 test fixture；不得把 fixture 值当生产策略/批准值 |

**条件性阻断（出现即停手/报告）：**

| ID | 条件 | 处置 |
|---|---|---|
| CB1 | 未获本轮单独 S3 授权 | 不开工；本文件不是授权 |
| CB2 | 固定对象/远端前移或分叉 | 停手报告；不 reset/merge/rebase/force，不替换固定对象 |
| CB3 | S2 Stop-2 结论被撤回/不可用 | 停手；不重跑、不自行重开 S2 |
| CB4 | E1/D4b/D5/D6 被改判或重开 | 停手待裁；不自行改 18/27、audit 公式或 operationAuthDigest |
| CB5 | S3 需要修改 `store.mjs`/扩白名单才能满足测试句 | 停手待裁；不夹带 S4 |
| CB6 | 实施中发现新的实质契约矛盾 | **BLOCKED**：提交最小反例与影响，交 Codex 裁定；不改设计/裁定 |
| CB7 | guard 不可用、哈希不符或 8/8 控制失败 | **BLOCKED**；不得无 guard 重跑 |
| CB8 | 新增被加载文件未进非监听集 | Stop-3 失败；先补授权范围 |
| CB9 | 改动 S4/S5/HTTP/UI/路由/设计/卡 | 超出 S3 白名单；停止并回退 |
| CB10 | 需要安装依赖、访问真实 Cloud/K3/设备/支付/生产网络 | 超出本阶段；停止 |

## 7. 停止点与交接

- **本任务停止点**：仅新增本文件；提交并普通推送 → 交 Codex 独立复审 → 停手。**不实施 S3、不运行测试/guard、不改 `923dbf1`。**
- **Stop-3 通过条件**（原卡）：D4b/D5 回写（V06–V13）、ticket 公式/字节绑定、唯一 audit/explicit 边界、runtime 白名单、no double audit、0 新增 refs（`卡:L737`；`授权:L498`）。
- **Stop-3 复审输入**：S3 diff + precheck/finalWriteSet/ticket tests + V06–V13 + 零写 + guard 计数 + 证据小节 + 未验证单列。
- **下一段**：Stop-3 通过后，只能“申请”S4 的本轮单独授权；没有该授权不得开工（`授权:L503`）。本文件不自批、不宣称 C1/G1 通过。

## 8. 本任务未验证/未做

- 未实现任何 S3 代码；未修改 `h4c-evidence.mjs`/`index.mjs`/测试/Store/设计/卡。
- 未运行任何测试、guard、`node --test`、`npm`；未安装依赖。
- 未访问真实 Cloud/K3/设备/Provider/支付/生产网络；未启动 HTTP/UI；未部署；未处置风险。
- 未读云 `PARALLEL-DISPATCH.md`/`REVIEW.md` 正文；不声称与云端派单逐项一致。
- 未验证 S3 的 precheck/finalWriteSet/ticket 实现（尚未写）；未验证 S4/S5/S6。
- S2 的 53/53、guard 8/8 为 Codex 已验收/历史证据，本任务未重跑、未独立复现。

## 9. 固定 SHA 文件链接

| 文件 | 固定链接 |
|---|---|
| 任务卡 r5 | https://github.com/1997dmsu-sketch/SMART-PM/blob/923dbf10317798aa82a146c58173a15c0590aa6e/docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-TASK-2026-11-18.md |
| 设计 v8 | https://github.com/1997dmsu-sketch/SMART-PM/blob/923dbf10317798aa82a146c58173a15c0590aa6e/docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md |
| 勘误 r4 | https://github.com/1997dmsu-sketch/SMART-PM/blob/923dbf10317798aa82a146c58173a15c0590aa6e/docs/tasks/HK-AI-04-H4C-C1-REFS-ERRATUM-2026-11-19.md |
| 授权清单 r2 | https://github.com/1997dmsu-sketch/SMART-PM/blob/ed6f862dac5307b0f027a83570fd8a0cb8da1a09/docs/tasks/HK-AI-04-H4C-C1-S0-S1-AUTHORIZATION-2026-11-19.md |
| S2 证据 | https://github.com/1997dmsu-sketch/SMART-PM/blob/923dbf10317798aa82a146c58173a15c0590aa6e/docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-EVIDENCE-2026-11-19.md |
| S2 代码 | https://github.com/1997dmsu-sketch/SMART-PM/blob/923dbf10317798aa82a146c58173a15c0590aa6e/admin-web/lib/face-service/h4c-evidence.mjs |
| Guard 七脚本 | https://github.com/1997dmsu-sketch/SMART-PM/tree/6f96fed9bd478192c8bbffeb52f47c90df89939e/docs/evidence/h4c-c1-stop1-guard |
| 本文件 | 最终提交 SHA 由交付回报给出；链接格式 `/blob/<final-sha>/docs/tasks/HK-AI-04-H4C-C1-S3-PREFLIGHT-2026-11-20.md` |

## 10. 交付回报字段（提交后由最终回复填写）

```text
任务：HK-AI-04-H4C-C1-S3-PREFLIGHT-2026-11-20（仅文档准备）
执行者：DSH agent lead（deepseek-flash）
run/session：hrun-mwoisk62-1b676a / session-fde65175-f9f9-41e1-9735-e4c4006578e3
工作树/分支：宇宙智联/.tmp/c1-s3-preflight / codex/h4c-c1-s3-preflight
固定输入/父：923dbf10317798aa82a146c58173a15c0590aa6e / 0b7eca2a676a337b656afcfa89f1a92490828ff1
最终提交：<fill-after-commit>
文件清单：docs/tasks/HK-AI-04-H4C-C1-S3-PREFLIGHT-2026-11-20.md（仅此一个）
命令/exit：见交付回报（fetch 0、worktree add 0、ls-remote 0、diff/show --check 0）
未验证：S3 代码、测试/guard、S4/S5/S6、真实 Cloud/设备/支付/HTTP/UI
停止点：本文件推送后停手，交 Codex 独立复审；不实施 S3、不进入 S4、不自批
```
