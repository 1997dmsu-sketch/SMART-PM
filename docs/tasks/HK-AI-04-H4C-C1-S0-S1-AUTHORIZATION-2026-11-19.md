# HK-AI-04 H4-c C1 首阶段（S0/S1）独立授权清单

> 状态：**独立授权清单；待 Codex 独立复审；本清单本身不授予任何实施权限。** 本文件只新增清单，并顺手更正任务卡 F45 一行旧注释；不实现 C1、不运行测试、不安装依赖、不进入 HTTP/UI、不访问业务云/设备/支付、不部署上线。
>
> 清单编号：`HK-AI-04-H4C-C1-S0S1-AUTH-2026-11-19`。
>
> 固定输入：`8e15960d3b2bc87a6dec7a5f267907f646713547`（父 `d095a1888a2efba7ac8bfea76dfe120a3a74bf08`；tree `dcdd1c1e9a1ea43f499137789749b4fafb69d03f`）。
>
> 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\c1-first-stage-authorization`；输出分支：`docs/h4c-c1-s0-s1-authorization`；开工时 HEAD = 固定输入，工作区干净，无 upstream。
>
> 输入文档：任务卡 r5 `docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-TASK-2026-11-18.md`（995 行）+ 勘误 r4 `docs/tasks/HK-AI-04-H4C-C1-REFS-ERRATUM-2026-11-19.md`（384 行）；设计 v8 `docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md`（1607 行；blob `c4feffa5831f5bf0e04e8e902865cb8e1f1b0183`；sha256 `d769da93c4880409c946e316f2414ca6b1135a96361934abc188111ca6dcbec7`）。
>
> 本清单的提交父/最终 SHA 由交付回报给出；不在文内自指。**准备本清单不构成对 S0/S1/S2–S6 的任何授权。**

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 清单目的 | 把 C1 首阶段（S0、S1）拆成可逐条验收、可逐段单独授权的独立清单；明确实施起点、范围、依赖、准确文件白名单、非监听测试清单、加载前 guard 与停止点 |
| 授权状态 | **S0 未获授权；S1 未获授权；S2–S6 不在本清单授权范围。** 每一段都必须有单独授权票；本清单、任务卡、勘误、D4/D5 关闭、Codex 对文档的复审通过，均不替代授权票 |
| S0 | 零代码基线冻结 + 门禁/勘误/待裁项记录；只允许新建证据文档；refs/writes 0/0；Stop-0 通过后才可申请 S1 |
| S1 | 纯契约层：常量、8 集合字面名与私有集合门禁、exact schema、canonical ID、摘要、谓词、错误码；只允许 4 个代码/测试文件 + 证据文档追加；refs/writes 0/0 |
| 建议实施起点 | `feat/hk-face-h4c-c1-staged` 从**本授权清单所在提交**起（完整 SHA 见交付回报），不推荐从固定输入 `8e15960` 直接起代码分支；分支名/起点仍待 D9 书面确认 |
| 测试边界 | S1 只跑 1 个非 HTTP 定向文件（`admin-web/tests/face-h4c-evidence.test.mjs`）并带加载前 guard；33 个非 HTTP + 7 个根文件只在 S6 单独授权后跑；8 个会 `listen` 的 HTTP 文件永不进入 C1 验收 |
| 门禁 | D4a/D4b/D5 已按本轮裁定关闭；E1/E2/E3/P9、D1、D6、D8、D9、D10 仍未批准/未决，继续阻断对应阶段；不得把“已关闭”写成“已实施” |
| F45 | 仅更正一行旧注释，使其符合已批准 D4/D5；不改 D5 取值、阶段、错误码或零写范围，不重开任何契约 |
| 当前状态 | 只新增本清单 + 更正 F45 一行；无代码、无测试执行、无安装、无云/设备/支付/业务网络、无部署 |

## 1. 输入、基线与分叉核对

### 1.1 已执行核对（只读）

| # | 事实 | 结果 |
|---:|---|---|
| 1 | 固定输入 SHA | `8e15960d3b2bc87a6dec7a5f267907f646713547` |
| 2 | 固定输入直接父 | `d095a1888a2efba7ac8bfea76dfe120a3a74bf08` |
| 3 | 固定输入 tree | `dcdd1c1e9a1ea43f499137789749b4fafb69d03f` |
| 4 | 工作树/分支/HEAD | `.tmp/c1-first-stage-authorization`；`docs/h4c-c1-s0-s1-authorization`；HEAD 等于固定输入 |
| 5 | 工作区 | `git status --porcelain` 为空；无 upstream |
| 6 | 远端输入分支 | `origin/docs/h4c-c1-staged-implementation-task` = `8e15960d3b2bc87a6dec7a5f267907f646713547`，等于固定输入，无前移 |
| 7 | 远端输出分支 | `refs/heads/docs/h4c-c1-s0-s1-authorization` **不存在**；本次为精确新分支创建 |
| 8 | 远端设计分支 | `origin/docs/hk-face-c1-epoch-uniqueness` = `fcae2460ab0a239c54463530b0b5001f34b1f302`；是固定输入的祖先 |
| 9 | 远端 main | `origin/main` = `282a20fca9f64ab80ead50372c9c3e90bf4aeba7`；是固定输入的祖先 |
| 10 | fetch | `git -c http.sslBackend=openssl fetch origin` exit 0；逐命令指定 TLS backend，未写全局/系统配置 |
| 11 | 设计文档 | 1607 行；blob `c4feffa5831f5bf0e04e8e902865cb8e1f1b0183`；sha256 `d769da93c4880409c946e316f2414ca6b1135a96361934abc188111ca6dcbec7` |
| 12 | 代码基线差异 | `git diff --stat 5dff386..8e15960 -- . ':(exclude)docs'` 为空 |
| 13 | 代码基线提交 | `5dff386fe5c9648b04d1623d3e1898c59332639e`；是固定输入的祖先 |
| 14 | 代码文件 hash（输入树） | `h4c-evidence.mjs` `5c94debdf87d5134bb050ed9470daa52ccee080f`；`index.mjs` `53c1ef86aef1dd7ffe7db805f6d9ab02713a516a`；`store.mjs` `f99e9996ebbeee17f2599060765f707d3840671a`；C1 测试 `14478acf80ea6b5127dbc187dff8125712de275f` |
| 15 | 现有 C1 导出 | `h4c-evidence.mjs` 26 个 `export`（12 常量 + 14 函数）；`index.mjs` 显式 re-export 同名 26 个 |
| 16 | 新集合模块 | `admin-web/lib/h4c-collections.mjs` **当前不存在**，由 S1 新建 |
| 17 | 测试盘点 | `admin-web/tests` 41 个 `.test.mjs`（8 个 HTTP + 33 个非 HTTP）；仓库根 `tests` 7 个 `.test.cjs`；显式 48 个文件全部存在 |
| 18 | 非监听静态核对 | 33 个非 HTTP + 7 个根文件 `.listen(` 命中 **0**；8 个 HTTP 文件 `.listen(` 命中 **9 次/8 文件** |
| 19 | D10 证据 | `admin-web/lib/store.mjs:268` 当前有 public `persist(data)`；`admin-web/tests/verification.test.mjs:381` 直接 `store.persist(store.data)` |
| 20 | F45 旧注释 | 任务卡 L907 仍写“D5 未裁定 / 无正向验收”，与 L967 的 D5 CLOSED 冲突；本清单顺手只改这一行 |

- 上述 1–20 均为只读核对；未运行测试、未安装依赖、未实现代码。
- 设计文档只按任务卡/勘误引用其冻结条款；本清单不声称逐行复核设计全文。

### 1.2 远端 tip 与分叉报告

```text
fetch:  git -c http.sslBackend=openssl fetch origin   -> exit 0
input:  8e15960d3b2bc87a6dec7a5f267907f646713547  refs/heads/docs/h4c-c1-staged-implementation-task
target: (absent)                                   refs/heads/docs/h4c-c1-s0-s1-authorization
design: fcae2460ab0a239c54463530b0b5001f34b1f302  refs/heads/docs/hk-face-c1-epoch-uniqueness
main:   282a20fca9f64ab80ead50372c9c3e90bf4aeba7  refs/heads/main
```

- 输入分支 = 固定输入，未前移；设计分支与 main 均为输入祖先；输出分支远端不存在。**当前没有需要覆盖的分叉。**
- 若在提交或 push 前出现以下任一情况：输入分支远端前移、输出分支被他人创建、设计分支/main 关系变化、工作区变脏——**停止并报告**，不 reset/rebase/merge/force，不覆盖他人提交。
- 本清单提交后、push 前必须再次执行同组 `ls-remote` 并把原始输出写入交付回报。

## 2. 授权模型（本清单不授权实施）

### 2.1 授权层级

1. **清单**：本文件只定义“如果授权，允许做什么、验收什么、何时停”。它不是授权票。
2. **段授权票**：每一段（S0、S1、S2……）都必须有独立的书面授权票，明确段号、范围、允许文件、允许命令、refs/writes、失效条件、授权人/时间。
3. **Stop 通过**：每段结束由 Codex 独立复审；Stop 通过只表示该段可申请下一段，不表示下一段已获授权，也不表示 C1/G1 已通过。
4. **合并/部署**：不在任何段授权范围内；不得由本清单推导。

### 2.2 段授权票模板（缺一不可）

```text
授权段：S0 | S1 | S2 | ...
授权依据：<Codex/调度方文号或可核验消息>
授权范围：仅本清单 §<节>；不包含下一段
允许文件：<逐条绝对/仓库相对路径>
允许命令：<逐条；含是否允许网络/测试>
refs/writes：<本段预算>
前置条件：<Stop/门禁/起点 SHA>
失效条件：<远端前移、门禁回退、文件越界等>
授权人/时间：
```

- 没有授权票 → 不得开工；口头“可以开始”、文档合并、测试已绿、上一段 Stop 通过，均不构成授权。
- 授权票一旦越界（多改文件、多跑测试、跨段提交），该段作废并报告，不得用后续提交掩盖。

### 2.3 硬边界（所有段适用）

- 禁止：`amend`、`rebase`、`reset`、`squash`、`force`、`merge`、`cherry-pick`；禁止改写历史或覆盖远端。
- 禁止：修改全局/系统 Git 配置或 TLS 验证设置；如需 TLS backend，只允许逐命令 `-c http.sslBackend=openssl`。
- 禁止：触碰本段白名单之外的文件；禁止 C2/C3、HTTP/UI、`server.mjs`/`routes.mjs`、部署/上线、数据库迁移。
- 禁止：安装依赖、运行真实 Cloud/K3/设备/Provider/支付/业务网络、启动 loopback 监听。
- 禁止：把未批准门禁写成已批准；把 D4/D5 关闭写成已实施；把历史测试计数写成本轮结果。
- 禁止：自批、自宣 C1/G1 通过、自行合并。

### 2.4 段授权台账

| 段 | 范围摘要 | 前置 | 本清单是否授权 | 当前状态 |
|---|---|---|---|---|
| S0 | 基线冻结 + 门禁/待裁记录；零代码 | 单独 S0 授权票 | **否** | 未授权；Stop-0 受 D1/D9/E1/E2/E3/P9/D6 等未决项阻断 |
| S1 | 纯契约层（常量/schema/ID/摘要/谓词/集合门禁） | Stop-0 通过 + E2/E3/P9 可编码结论 + S1 授权票 | **否** | 未授权；受 Stop-0 与 E2/E3/P9/D9 阻断 |
| S2 | 链层 18 refs / anchor / 1..9 | Stop-1 + E1 正式确认 + S2 授权票 | **否** | 未授权；本清单只登记，不展开 |
| S3 | 授权层 precheck/final ticket/唯一 audit | Stop-2 + D4b/D5 已关闭 + S3 授权票 | **否** | 未授权；本清单只登记 |
| S4 | Store 全路径门禁 | Stop-3 + E2/E3/P9 批准 + D10 处置 + S4 授权票 | **否** | 未授权；本清单只登记 |
| S5 | 运行时覆盖 | Stop-4 + D3 清零 + D4a 已关闭 + S5 授权票 | **否** | 未授权；本清单只登记 |
| S6 | 全量验收/33+7/静态/并发 | Stop-5 + D8 处置 + S6 授权票 | **否** | 未授权；本清单只登记 |

## 3. 门禁寄存器（未批准即阻断）

| 门禁 | 内容 | 本清单时状态 | 阻断 | 关闭条件 |
|---|---|---|---|---|
| E1 | C1 **18** refs / C2 R1 **27**；writes 3/2 不变；proof 只读 ref | 本轮口径保留（可采纳），**未正式批准** | S2 的 18 refs 实现；Stop-0 需记录 | Codex 书面确认；S2 前必须完成 |
| E2 | 8 个 H4-c 集合字面名 + `admin_audit` 通用边界 | **待复审** | S1、S4 | Codex 批准；S1 前必须完成 |
| E3 | `transactFinal`、`createH4cGate`、构造注入、`#persist` 私有、`h4c-collections.mjs` | **待复审** | S1（集合模块/gate 纯逻辑）、S4 | Codex 批准；S1/S4 前必须完成 |
| P9 | 私有 Set + `isH4cCollection` + 冻结枚举快照；不得导出 Set | **待复审** | S1、S4 | Codex 批准；S1/S4 前必须完成 |
| D1 | 云 `DISPATCH.md` / `REVIEW.md` 本机不可读 | **OPEN** | Stop-0 → S1 | 可读副本，或 Codex 明确豁免且不声称逐项闭合 |
| D2 | 同 E1（proof 漏算） | **待正式确认** | S2 | 同 E1 |
| D3 | 同 E2（集合名/audit 边界） | **待复审** | S1、S4 | 同 E2 |
| D4a | proof `status="verified"` / `legacyCount=0` / snapshot | **CLOSED（本轮裁定）** | 不阻断 S1/S5 的契约验收 | 任务卡 §3.3g/§3.3h V01–V05；仍不授权实施 |
| D4b | C1 audit `scopeKey=job._id` / genesis / append / revision=新 sequence / targetList | **CLOSED（C1）** | 不阻断 S1/S3 的契约验收 | 任务卡 §3.3g/§3.3h V06–V09；C2/control 另卡 |
| D5 | runtime `operationAuthDigest` 显式 `null` + ticket 签名该键 + runtime 白名单 | **CLOSED（本轮裁定）** | 不阻断 S3/S5 的契约验收 | 任务卡 §3.3g/§3.3h V10–V13；仍不授权实施 |
| D6 | C1 API 形状（`evidenceAppendRefs`/`appendEvidenceWrites`） | 卡内冻结，**待复审** | S2 | Stop-0/卡审批明确 |
| D7 | 同 E3（Store 接口/DI/门禁） | **待复审** | S1、S4 | 同 E3 |
| D8 | N01–N142 与“工具另立卡”的测试归属 | **OPEN** | S6（并影响 Stop-0 记录） | Codex 确认 §11.2 划界或给出合成记录边界 |
| D9 | 设计页首“待复审”与“已批准”口径；实施分支名/起点未派单 | **OPEN** | S0 起点、S1 开工 | 书面批准文/批准 SHA + 分支名/起点 |
| D10 | `#persist` 私有会破坏 `verification.test.mjs:381` 直调 | **OPEN** | S4 | 批准“init 前写 demo-data.json”或等价方案 |
| D11 | 真实 Cloud 并发未验证 | **OPEN（C3）** | 不阻断 S0/S1 | C3；证据中标注未验证 |

- **规则**：表中状态不是 `CLOSED` / 书面通过的，一律按阻断处理；不得用“待复审但先做”绕过。
- D4a/D4b/D5 的 `CLOSED` 只关闭其契约歧义，不关闭“实施需单独授权”。

## 4. 建议实施起点

### 4.1 推荐

- 实施分支建议：`feat/hk-face-h4c-c1-staged`。
- 起点建议：**本授权清单所在提交**（父 = 固定输入 `8e15960`；本清单提交的完整 SHA 由交付回报给出）。
- 理由：该起点同时包含设计 v8、勘误 r4、任务卡 r5 与本授权清单，S0 可在同一祖先链上核对全部文档；避免从 `8e15960` 起代码分支后，授权清单落在祖先链之外。
- 该建议不创建分支、不授权实施；分支名与起点仍须 D9 书面确认。

### 4.2 不接受的做法

- 不接受“从 `8e15960` 直接起代码分支，再用 merge/cherry-pick 把授权清单带进来”——本任务禁止 merge/cherry-pick。
- 不接受“从任意旧 docs 分支起，口头说包含授权清单”。
- 不接受“先写代码，后补授权票/后补起点”。
- 不接受把本清单的提交 SHA 猜测/缩写后写入实施记录；必须使用交付回报中的完整 40 位 SHA。

### 4.3 工作树/分支关系

| 用途 | 工作树 | 分支 | 起点 |
|---|---|---|---|
| 本授权清单 | `.tmp/c1-first-stage-authorization` | `docs/h4c-c1-s0-s1-authorization` | `8e15960` |
| S0（若授权） | 实施工作树 | `feat/hk-face-h4c-c1-staged`（待 D9 确认） | 分支基点 = 本清单提交；S0 提交追加在其上 |
| S1（若授权） | 实施工作树 | `feat/hk-face-h4c-c1-staged`（待 D9 确认） | S0 提交（分支基点仍为本清单提交） |

## 5. S0：基线冻结与门禁记录（零代码）

### 5.1 目的、依赖、范围

- 目的：在实施前冻结输入/远端/设计/代码/测试基线，登记 E1/E2/E3/P9、D1–D10 的处置，形成 Stop-0 复审材料。
- 依赖：单独 S0 授权票；无上游代码依赖。S0 可只读收集基线，但 **Stop-0 不得在未决门禁未处置时通过**。
- 范围：只读 Git/文件核对 + 新建证据文档；零代码、零测试执行、零 Store 访问。

### 5.2 准确文件白名单

| 动作 | 文件 | 说明 |
|---|---|---|
| 新建 | `docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-EVIDENCE-2026-11-19.md` | 唯一允许的新文件；S0 建，之后各段只追加本段小节 |
| 禁止 | 任何代码/测试/设计/任务卡/勘误/配置/package 文件 | 包括本授权清单；S0 不得改本清单 |
| 禁止 | `admin-web/**`、`tests/**`、`server.mjs`、`routes.mjs` | 零代码 diff |

- S0 不得修改任务卡、勘误、设计正文；不得把 F45 之外的历史注释“顺手”改掉。F45 更正已在本授权清单提交中完成。

### 5.3 精确输入与只读命令

S0 开始时必须重新执行并记录原始输出（不得只引用本清单数值）：

```text
git status --porcelain
git rev-parse HEAD
git rev-parse '8e15960d3b2bc87a6dec7a5f267907f646713547^{tree}'
git log -1 --format='%H%n%P%n%T%n%ad%n%s' 8e15960d3b2bc87a6dec7a5f267907f646713547
git remote -v
git -c http.sslBackend=openssl fetch origin
git -c http.sslBackend=openssl ls-remote origin \
  refs/heads/docs/h4c-c1-staged-implementation-task \
  refs/heads/docs/h4c-c1-s0-s1-authorization \
  refs/heads/docs/hk-face-c1-epoch-uniqueness \
  refs/heads/main
git hash-object docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md
Get-FileHash -Algorithm SHA256 docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md
git diff --stat 5dff386fe5c9648b04d1623d3e1898c59332639e..HEAD -- . ':(exclude)docs'
git rev-parse 8e15960:admin-web/lib/face-service/h4c-evidence.mjs
git rev-parse 8e15960:admin-web/lib/face-service/index.mjs
git rev-parse 8e15960:admin-web/lib/store.mjs
git rev-parse 8e15960:admin-web/tests/face-h4c-evidence.test.mjs
```

- 允许的测试：无。S0 不运行 `node --test`、不运行任何 `.test.*`、不启动任何网络动作（`fetch`/`ls-remote` 只读核对除外）。
- `git fetch`/`ls-remote` 是只读网络核对；不得 push、不得改远端。

### 5.4 逐条验收（A0）

| ID | 验收项 | 通过标准 | 证据 |
|---|---|---|---|
| A0-01 | 固定输入 | HEAD = `8e15960d3b2bc87a6dec7a5f267907f646713547`；父 = `d095a18…`；tree = `dcdd1c1…` | 原始命令输出 |
| A0-02 | 分支/工作区 | 分支正确；`git status --porcelain` 为空；无 upstream | 原始输出 |
| A0-03 | 远端 tip | 输入分支 = 固定输入；输出分支状态明确；设计/main 为祖先；无前移/分叉 | `ls-remote` 原始输出 |
| A0-04 | 设计文档 | 1607 行；blob `c4fe…`；sha256 `d769…` | hash 输出 |
| A0-05 | 代码零差异 | `5dff386..HEAD -- . ':(exclude)docs'` 为空 | diff 输出 |
| A0-06 | 代码基线 hash | 4 个文件 hash 与输入树一致 | `git rev-parse` 输出 |
| A0-07 | 测试盘点 | admin-web 41（8 HTTP + 33 非 HTTP）；根 7；`.listen(` 在 33+7 为 0 | 文件计数/静态扫描 |
| A0-08 | 门禁登记 | E1/E2/E3/P9、D1–D10 状态逐项记录；未批准项保持 BLOCKED | 门禁表 |
| A0-09 | D4/D5 关闭回写 | D4a/D4b/D5 引用任务卡 §3.3g/§3.3h；F45 更正已记录 | 卡行号/引用 |
| A0-10 | 零代码 | 仅新建证据文档；`git diff --stat` 只含该文件 | diff |
| A0-11 | 命令可复现 | 所有命令、exit code、原始输出、时间写入证据 | 证据小节 |
| A0-12 | 未验证单列 | 8 HTTP 未跑、测试未跑、真实云并发未验证 | 证据小节 |
| A0-13 | Stop-0 请求 | 按模板提交 Codex；不自行判定通过 | 复审请求 |
| A0-14 | 不进入 S1 | S0 提交信息/证据明确“S1 未开始；待 Stop-0 + 单独授权” | 提交/证据 |

### 5.5 refs/writes、停止点、授权状态

- refs/writes：**0/0**；不访问 Store。
- 负向：远端输入前移、输出分支被占用、设计 blob 不匹配、非 docs 差异非空、工作区不干净——任一命中即停止报告；不 reset/merge/force。
- **Stop-0**：Codex 确认基线、E1/E2/E3/P9 的复审结论或明确延后条件、D4a/D4b/D5 关闭回写、D1–D10 处置；未通过不得申请/进入 S1。
- 授权状态：**未授权**；即使获得 S0 授权票，Stop-0 仍未通过前，S1 不得开工。

## 6. S1：契约层（纯函数）

### 6.1 目的、依赖、范围

- 目的：只落地纯常量/纯函数/validator/摘要/谓词；为 S2/S3/S4/S5 提供可复审契约，不改调用方、不写记录。
- 依赖：**Stop-0 书面通过**；E1 18/27 已记录保留；**E2/E3/P9 已批准或给出可编码结论**；D4a 已关闭；D9 起点/分支已确认；**单独 S1 授权票**。
- 范围（允许）：常量、8 集合字面名、私有 Set + `isH4cCollection` + 冻结快照、exact schema、canonical ID、digest domain、谓词、错误码、`createH4cGate` 纯逻辑。
- 范围（禁止）：18 refs 实现/链层、final ticket/audit 签发、Store 接线、运行时覆盖、全量回归、HTTP/UI、Cloud/K3/设备/支付/部署。

### 6.2 准确文件白名单

| 动作 | 文件 | 约束 |
|---|---|---|
| 新建 | `admin-web/lib/h4c-collections.mjs` | 纯常量；无 import、无副作用；只导出 `H4C`、`H4C_COLLECTION_NAMES`、`H4C_AUDIT_COLLECTION`、`isH4cCollection`；**不得导出 Set** |
| 修改 | `admin-web/lib/face-service/h4c-evidence.mjs` | 只加契约层；保留现有 26 导出及行为；不得改 Store 调用方 |
| 修改 | `admin-web/lib/face-service/index.mjs` | 只增不删；不得新增 bootstrap/create-domain/empty-check/初始化入口 |
| 修改 | `admin-web/tests/face-h4c-evidence.test.mjs` | 只加 S1 断言；不得跑 HTTP/loopback |
| 追加 | `docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-EVIDENCE-2026-11-19.md` | 只追加 S1 小节；不改历史小节 |
| 禁止 | `admin-web/lib/store.mjs`、`admin-web/server.mjs`、`admin-web/routes.mjs` | 零 diff |
| 禁止 | 设计正文、勘误、任务卡、package/lock、其他测试 | 零 diff；不得“顺手修” |

- S1 的白名单是**闭集**；新增任何文件/依赖/脚本都需重新授权。
- 若 E3/P9 只批准部分内容，S1 只能实现被批准的子集；未批准部分不得先写后审。

### 6.3 精确实现输入（按任务卡 §5）

1. **常量**：8 集合字面名（E2）；`EVIDENCE_CHAIN_FENCE_ID="evidence-chain-fence:v1:global"`；`EVIDENCE_CHAIN_K3_MARKER_ID="evidence-chain-k3-marker:v1:global"`；anchor 前缀；`MONITOR_HEALTH_WINDOW_MS=300000`；`CLOCK_SKEW_MS=30000`；`EVIDENCE_MAX_SEQUENCE=9`；`STILL_UNKNOWN_MAX_SEQUENCE=8`。
2. **ID 公式**：anchor、evidence、head、domain、fence、marker、proof、plan（含 §18.2 writer canonical）；`admin_audit` C1 test-only audit 使用 §3.3g 精确公式（`scopeKey=job._id`、genesis/append、`revision=新 sequence`、`targetList` 排序去重不含 audit）。
3. **schema 字段数组**：6 / 20 / 9 / 7 / 6 / 7 / 12 / 18 / 24 / 39；`proof.status="verified"`；`legacyCount` 安全非负整数且仅接受 0。
4. **digest domain**（11 个）：audit / fence / monitor / ticket / plan / plan-status / recovery / k3-bootstrap / writer-runtime / k3-marker / maintenance-manifest；HMAC-SHA256 v1；canonical JSON 规则。
5. **谓词**：`FenceRecordValid` / `FenceStructValid` / `FenceHealthy` / `FenceExpired` / `FenceValid` / `FenceHeartbeatable`；`K3DomainExact` / `K3MarkerValid` / `CoverageValid` / `WriterPlanValid` / `PlanRecordValid` / `AdmissionValid`。
6. **错误码表**：任务卡 §3.4（`NOT_CONFIGURED`/`DOMAIN_*`/`PROOF_REQUIRED`/`HALTED`/`FENCE_EXPIRED`/`ADMISSION_REQUIRED`/`BROKEN`/`EVIDENCE_INVALID`/`CONFLICT`/`PLAN_*` 等）。

### 6.4 逐条验收（A1）

| ID | 验收项 | 通过标准 | 证据 |
|---|---|---|---|
| A1-01 | 集合字面名 | 8 个字面量精确；`admin_audit` 单列；无第二套集合字面量 | 断言/静态扫描 |
| A1-02 | 私有 Set | `H4C_COLLECTION_SET` 不导出；模块作用域私有；捕获 `Set.prototype.has`；替换原型后判定不变 | 命名空间断言/负向测试 |
| A1-03 | 冻结快照 | `Object.isFrozen(H4C)` 与 `H4C_COLLECTION_NAMES` 为真；`push`/下标/属性赋值抛错 | 断言 |
| A1-04 | 成员判定边界 | `isH4cCollection` 对 8 字面量 true；对 `admin_audit`/`__proto__`/`constructor`/空串/null/对象/Symbol false；不返回集合/遍历器 | 断言 |
| A1-05 | 无 Set 导出 | 命名空间无 `H4C_COLLECTION_SET`；无 `add/remove/clear/setH4cCollections` API；`Object.freeze(new Set()).add` 仍生效（证明不能导出 Set） | 断言 |
| A1-06 | 现有导出保留 | `h4c-evidence.mjs` 26 导出不删/不改行为；`index.mjs` 只增不删；无 bootstrap/create-domain/empty-check/初始化入口 | diff/导出清单 |
| A1-07 | schema 精确 | 6/20/9/7/6/7/12/18/24/39；多字段/缺字段/类型错/非 plain object 全部拒绝 | 正反测试 |
| A1-08 | proof D4a | `status` 仅 `"verified"`；`legacyCount` 安全非负整数且仅 0；V01–V05 正负/快照用例 | 测试/矩阵 |
| A1-09 | canonical ID | anchor/evidence/head/domain/fence/marker/proof/plan 公式；`e=1/7/10` → `we-1/we-7/we-10`；拒绝 `we-07`/`we-0`/`WE-7`/空串/非正整数 | 断言 |
| A1-10 | C1 audit D4b | `scopeKey=job._id`；genesis/append；`revision=新 sequence`；`targetList` 排序/不含 audit/无重复；7 字段/`createdAt`/`target`；V06–V09 | 测试/矩阵 |
| A1-11 | plan 39 字段 | §17.2 1–39 唯一清单；planKind 空值表；consumed writer 必须 `runtimeTicket≠null`；migration/recovery 必须 `null`；active/revoked 一律 `null`；revoke `targetProofId≠null` | 正反测试 |
| A1-12 | 摘要 | 11 个 domain；HMAC-SHA256 v1；canonical JSON；可从持久字段重建；测试 K3 key；0 新增 refs | 向量/断言 |
| A1-13 | 谓词 | 健康/过期/halted 分离；`FenceValid` 只给业务写；`FenceHeartbeatable` 只给 heartbeat；`WriterPlanValid` 只接受 consumed+`runtimeTicket`+`proof.writerPlanId`；active 不放行 | 真值表 |
| A1-14 | 错误码 | 与 §3.4 一致；`FENCE_EXPIRED` ≠ `HALTED`；`PROOF_REQUIRED` ≠ `ADMISSION_REQUIRED` | 断言 |
| A1-15 | 纯函数 | 不修改输入（structuredClone + deepEqual）；无 Store 访问；gate 不读 `process.env`/不调用 `Date.now()`；无 I/O | 断言/静态 |
| A1-16 | gate 纯逻辑 | 若 E3 批准：冻结、只暴露 `verify`、config 来自 `evidenceKeyConfig()`、health 默认 300000/30000、非法配置错误；不接 Store | 断言 |
| A1-17 | 零 Store 改动 | `store.mjs`/`server.mjs`/`routes.mjs` 零 diff；无 H4-c 记录写；无 C2/C3 | diff/静态 |
| A1-18 | 测试边界 | 只跑 `admin-web/tests/face-h4c-evidence.test.mjs`；guard 加载前生效；`listen_calls=0`/`network_attempts=0`/`provider_calls=0`；不跑 8 HTTP、不跑 33+7 全量 | 命令/guard 输出 |
| A1-19 | diff 白名单 | 仅 §6.2 的 4 个代码/测试文件 + 证据文档；设计/勘误/任务卡零 diff | `git diff --stat` |
| A1-20 | 证据与 Stop-1 | 证据追加 S1（命令/exit/计数/V01–V09/refs/writes/未验证）；提交 Stop-1 复审请求；不进入 S2 | 证据/复审请求 |

### 6.5 S1 测试范围与命令

- **只允许** C1 定向测试，工作目录 `admin-web`：

```text
NODE_OPTIONS="--require <guard.cjs 绝对路径>" \
node --test --test-isolation=none tests/face-h4c-evidence.test.mjs
```

- **不允许**在 S1 运行 33 个非 HTTP 全量、7 个根文件、任何 HTTP 文件或全量 glob。
- 33+7 只在 S6 单独授权后运行；8 个 HTTP 文件永不进入 C1。
- 依赖不安装：若出现缺依赖，该测试记 BLOCKED，不得安装/stub/跳过冒充通过。

### 6.6 refs/writes、停止点、授权状态

- refs/writes：**0/0**；纯函数不写记录。
- **Stop-1**：Codex 审 schema/ID/集合名/谓词/签名公式与 E1/E2/§18.2/§18.7 一致；确认 D4a/D4b 回写与 V01–V09 正负用例；确认 0 Store 改动、0 写、无生产调用点；未通过不得申请/进入 S2。
- 授权状态：**未授权**；未获 S1 授权票前不得新建 `h4c-collections.mjs`、不得改 3 个代码/测试文件。

## 7. 显式非监听测试清单与加载前 guard

### 7.1 路径口径

- 任务卡 §3.7 的 33 项写作 `tests/...`，上下文是 `admin-web` 的 41 个 `.test.mjs`；本清单补全为 `admin-web/tests/...`，避免从仓库根误跑。
- 7 个根文件是仓库根 `tests/*.test.cjs`，与 `admin-web/tests` 不同目录。
- 该补全只是路径消歧，不改任务卡的测试集合/数量/契约。

### 7.2 8 个明确禁跑的 HTTP 文件（会 `listen`）

```text
admin-web/tests/blacklist-http.test.mjs
admin-web/tests/occupancy-http.test.mjs
admin-web/tests/server.test.mjs
admin-web/tests/server-face.test.mjs
admin-web/tests/server-face-bounds.test.mjs
admin-web/tests/server-files.test.mjs
admin-web/tests/server-v2.test.mjs
admin-web/tests/verification-http.test.mjs
```

- 静态核对：8 个文件共 9 处 `.listen(` 命中；`server-files.test.mjs` 2 处，其余各 1 处。
- 这 8 个文件**不属于 C1 验收**；S0/S1/S2–S6 均不得以任何命令运行它们。

### 7.3 33 个非 HTTP 文件（显式清单，禁用 glob）

```text
admin-web/tests/auto-fill.test.mjs
admin-web/tests/blacklist.test.mjs
admin-web/tests/blacklist-prepare-attempt.test.mjs
admin-web/tests/cloud-store-point-read.test.mjs
admin-web/tests/device-permissions.test.mjs
admin-web/tests/face-binding.test.mjs
admin-web/tests/face-biometric.test.mjs
admin-web/tests/face-collections.test.mjs
admin-web/tests/face-eligibility.test.mjs
admin-web/tests/face-grant-d-matrix.test.mjs
admin-web/tests/face-grant-eligibility.test.mjs
admin-web/tests/face-h3a.test.mjs
admin-web/tests/face-h4b.test.mjs
admin-web/tests/face-h4c-evidence.test.mjs
admin-web/tests/face-input-contract.test.mjs
admin-web/tests/face-owner-claim-helpers.test.mjs
admin-web/tests/face-purpose.test.mjs
admin-web/tests/face-reference.test.mjs
admin-web/tests/face-service-h1-regression.test.mjs
admin-web/tests/face-service-layer.test.mjs
admin-web/tests/face-service-mock.test.mjs
admin-web/tests/files.test.mjs
admin-web/tests/identity.test.mjs
admin-web/tests/identity-config.test.mjs
admin-web/tests/layout-batches.test.mjs
admin-web/tests/occupancy.test.mjs
admin-web/tests/org-v2.test.mjs
admin-web/tests/property.test.mjs
admin-web/tests/static-path.test.mjs
admin-web/tests/store-deterministic-audit.test.mjs
admin-web/tests/trailing-payload.test.mjs
admin-web/tests/verification.test.mjs
admin-web/tests/vr.test.mjs
```

- 静态核对：33 个文件 `.listen(` 命中 **0**。
- 其中 `identity-config.test.mjs` 可能 import `server.mjs`，但运行时仍要求 `listen_calls=0`；任何 `.listen` 命中即失败。

### 7.4 7 个根文件（显式，无 listen）

```text
tests/cloud-bootstrap.test.cjs
tests/frontend.test.cjs
tests/layout.test.cjs
tests/phone-login.test.cjs
tests/public-houses.test.cjs
tests/wechat-modules.test.cjs
tests/wxml.test.cjs
```

- 静态核对：7 个文件 `.listen(` 命中 **0**；仍按显式清单执行，不用根 glob 代替。
- 历史基线（`5dff386`）：33 个非 HTTP 文件 521 项、根 7 文件 51 项、全量 581 项（含 60 项 loopback）。这些只是历史对照，不是本轮结果；本清单不重跑。

### 7.5 加载前 guard 规格（S1/S6 共用）

1. **位置**：guard 放在工作树之外，例如 `%TEMP%\c1-staged-guard\<random>\guard.cjs`；不提交；证据记录绝对路径 + sha256。
2. **加载时机**：`NODE_OPTIONS="--require <绝对路径>\guard.cjs"`（或等价 `--import`）在任何测试模块加载前预加载；不得在测试文件内部才加载。
3. **patch + 计数**：`http.Server.prototype.listen`、`https.Server.prototype.listen`、`net.Server.prototype.listen`、`dgram.Socket.prototype.bind`、`net.connect`/`net.createConnection`、`tls.connect`、`http.request`/`http.get`/`https.request`/`https.get`、`globalThis.fetch`、`dns.lookup`/`dns.resolve*`；patch 后调用 `module.syncBuiltinESMExports()`，并用 ESM 哨兵证明命名导入拿到被替换实现。
4. **失败关闭**：包装器先断言 `NODE_OPTIONS` 含 guard 且哨兵为真；guard 输出 `GUARD_ACTIVE` 与 counters；任一缺失，或 `listen_calls!=0`、`network_attempts!=0`、`provider_calls!=0` → 该次 BLOCKED/FAIL。
5. **不得摘除 guard 重跑**；不得用“已经跑过”替代 guard 证据；不得用 stub/skip 冒充通过。
6. **S1**：只对 `face-h4c-evidence.test.mjs` 使用 guard；**S6**：才允许对 33+7 显式清单使用 guard；8 个 HTTP 文件永不跑。
7. 依赖不安装：`sharp` 缺失时 `face-service-h1-regression.test.mjs` 记 BLOCKED，不安装、不 stub。

### 7.6 分段测试授权

| 段 | 允许运行的测试 | 禁止 |
|---|---|---|
| S0 | 无 | 任何 `.test.*` |
| S1 | 仅 `admin-web/tests/face-h4c-evidence.test.mjs`（带 guard） | 33+7 全量、任何 HTTP 文件、glob |
| S2–S5 | 仅该段授权票列出的 C1 定向文件（默认同上） | 33+7 全量、任何 HTTP 文件 |
| S6 | 33 个非 HTTP + 7 个根文件（显式，带 guard） | 8 个 HTTP 文件、任何全量 glob |

## 8. 逐段停止点与单独授权

| Stop | 段 | 通过条件 | 失败处置 | 本清单授权 |
|---|---|---|---|---|
| Stop-0 | S0 | 基线/远端/设计/代码零差异一致；E1/E2/E3/P9 结论或延后条件；D4a/D4b/D5 关闭回写；D1–D10 处置 | 停止报告；不改历史、不猜合同 | 否 |
| Stop-1 | S1 | schema/ID/集合名/谓词/签名与 E1/E2/§18.2/§18.7 一致；D4a/D4b 与 V01–V09；0 Store 改动、0 写 | 同段追加修复，不跨段 | 否 |
| Stop-2 | S2 | 18 refs（含 proof1）；anchor/1..9/完整链；无布尔；缺 proof 拒绝；零写 | 同段追加修复 | 否 |
| Stop-3 | S3 | D4b/D5 与 V06–V13；finalWriteSet 字节绑定；唯一 audit；explicit；0 新增 refs | 同段追加修复 | 否 |
| Stop-4 | S4 | 8 集合 + admin_audit 全路径；explicit；≤90；无双审计；gate 注入；私有 Set/谓词/冻结；D10；非 H4-c 零回归 | 同段追加修复 | 否 |
| Stop-5 | S5 | D4a 与 V01–V05；K3/marker/proof/plan/fence/健康/错误顺序；只读；旧 W0 无授权；proof ref 实际使用 | 同段追加修复 | 否 |
| Stop-6 | S6 | 33+7 全绿；F/N 逐项；10 轮并发；静态 0；预算 18/27；白名单；guard 0；8 HTTP 未跑单列 | 退回对应阶段；S6 不修生产代码 | 否 |

- **单独授权**：Stop-N 通过后，只能“申请”S(N+1) 授权票；没有授权票不得开工。
- **不得自批**：任何提交信息/证据不得写“已通过/已批准/可合并”；只写“请求复审”。
- **一次授权一段**：S0 授权票不覆盖 S1；S1 授权票不覆盖 S2；修复提交仍属同一段，不跨段夹带。

## 9. F45 旧→新更正（仅注释）

### 9.1 旧行（任务卡 L907）

```text
| **F45** | **runtime ticket 缺/错 operationAuthDigest（D5 未裁定）** | **S3** | **ADMISSION_REQUIRED；无正向验收** | **Z_all** |
```

### 9.2 新行

```text
| **F45** | **runtime ticket 缺/错 operationAuthDigest 或未签名该键（D5 已裁定：显式 `null` + 签名该键 + runtime 白名单）** | **S3** | **ADMISSION_REQUIRED；V10 正向、V11–V12 负向** | **Z_all** |
```

### 9.3 依据

| 依据 | 内容 |
|---|---|
| 任务卡 §3.3g D5 行（L377） | runtime `operationAuthDigest` 显式 JSON `null`；ticket 必须包含并签名该键；缺失/undefined/空串/任意摘要 → `ADMISSION_REQUIRED/409`，零写；C1 仅 runtime 白名单 |
| 任务卡 §3.3h（L396–L399） | V10 正向；V11–V12 负向；V13 回归 |
| 任务卡 D5 行（L967） | **CLOSED（本轮裁定）**；control 默认拒绝，null 不绕授权 |
| 勘误 §3.7（L332–L341） | 同一 D5 裁定正文与正负例 |

### 9.4 边界

- 只改 F45 的“旧注释”：去掉“D5 未裁定/无正向验收”，补上已批准 D5 的取值与 V10–V12 验收引用。
- **不改** D5 的取值、阶段 `S3`、错误码 `ADMISSION_REQUIRED`、零写范围 `Z_all`；不改任何其他 F45/D5 行。
- **不重开**任何契约；本更正不构成 D5 实施授权，也不表示 V10–V13 已运行。
- 若 Codex 认为 F45 不应改，撤销该一行即可，不影响本清单其余部分。

## 10. 未决项与交 Codex 复审

### 10.1 未决项

| # | 未决项 | 阻断 | 需要的裁决/材料 |
|---:|---|---|---|
| 1 | D1：云 `DISPATCH.md`/`REVIEW.md` 本机不可读 | Stop-0 → S1 | 可读副本，或明确豁免且不声称逐项闭合 |
| 2 | E1/D2：18/27 仅“保留”，未正式批准 | S2 | Codex 书面确认 18/27、writes 3/2、proof 只读 |
| 3 | E2/D3：8 集合字面名 + `admin_audit` 边界 | S1/S4 | 书面批准 §2 的 8 名字与边界 |
| 4 | E3/D7：`transactFinal`/`createH4cGate`/DI/`#persist` 私有 | S1/S4 | 书面批准接口与权限 |
| 5 | P9：私有 Set + `isH4cCollection` + 冻结快照 | S1/S4 | 书面批准“不导出 Set” |
| 6 | D6：C1 API 形状 | S2 | 卡内冻结的确认/修订 |
| 7 | D8：N01–N142 与“工具另立卡”归属 | S6 | 确认 §11.2 划界或合成记录边界 |
| 8 | D9：设计批准口径 + 实施分支名/起点 | S0/S1 | 批准文/SHA + 分支名/起点 |
| 9 | D10：`verification.test.mjs:381` 直调 `store.persist` | S4 | 批准 init 前写 fixture 或等价方案 |
| 10 | D11：真实 Cloud 并发未验证 | C3 | 不在 C1 关闭；证据标注未验证 |
| 11 | S0 授权票是否现在签发 | S0 | 单独授权票 |
| 12 | S1 授权票是否以 Stop-0 通过为条件 | S1 | 单独授权票（不得预付） |
| 13 | 33 项路径补全 `admin-web/tests/` 是否认可 | 文档口径 | 确认仅为消歧，不改契约 |
| 14 | F45 一行更正是否认可 | 文档 | 确认仅注释、不重开 D5 |

### 10.2 请求 Codex 复审的重点

1. S0/S1 的范围、依赖、准确文件白名单是否与任务卡 r5 一致，是否有漏项/越界。
2. 非监听 33+7 清单与 guard 规格是否足以阻止 loopback/network；8 HTTP 是否被完全排除。
3. 逐条验收 A0/A1 是否可执行、可取证；Stop-0/Stop-1 是否足以阻断未批准门禁。
4. 建议实施起点（本清单提交）是否可接受；D9 的分支名/起点是否需要调整。
5. F45 旧→新是否只改注释、是否准确反映已批准 D4/D5。
6. 未决项是否还有遗漏；是否有门禁被本清单“默认放行”。

- 复审通过只表示本清单可作为后续授权依据；**不表示 S0/S1 已获授权，不表示 C1/G1 通过**。

## 11. 本清单自身交付与 Git 约束

### 11.1 变更范围

| 文件 | 动作 | 说明 |
|---|---|---|
| `docs/tasks/HK-AI-04-H4C-C1-S0-S1-AUTHORIZATION-2026-11-19.md` | 新增 | 本清单 |
| `docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-TASK-2026-11-18.md` | 修改 1 行 | 仅 F45 旧注释 |

- 不触碰其他文件；设计正文/勘误/代码/测试/配置零 diff。

### 11.2 提交与 push 约束

- 一个单用途提交；父 = 固定输入 `8e15960`；提交信息建议：`docs(face): add H4-c C1 S0/S1 authorization checklist`。
- 提交前：`git diff --check`、`git show --check` 均须 exit 0；`git diff --cached --stat`/`git show --stat` 只含上述 2 文件。
- push 前：`git -c http.sslBackend=openssl ls-remote origin refs/heads/docs/h4c-c1-s0-s1-authorization` 必须为空；若已存在，停止报告，不覆盖。
- push：普通 `git push origin docs/h4c-c1-s0-s1-authorization`；不使用 `--force`、不追加其他推送配置、不改全局 Git/TLS。
- push 后：`git ls-remote` 必须返回**完整 40 位 SHA** 且等于本地最终提交；不得用缩写/猜测。
- 禁止：amend/rebase/reset/squash/force/merge/cherry-pick；禁止改写本提交历史。

### 11.3 固定 SHA 文件 URL（交付回报填写）

```text
https://github.com/1997dmsu-sketch/SMART-PM/blob/<最终完整SHA>/docs/tasks/HK-AI-04-H4C-C1-S0-S1-AUTHORIZATION-2026-11-19.md
https://github.com/1997dmsu-sketch/SMART-PM/blob/<最终完整SHA>/docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-TASK-2026-11-18.md
```

- 交付回报必须给出真实 SHA、父 SHA、文件 diff、push 前后 `ls-remote` 输出；不得用占位符充当交付。

## 12. 明确未做/未验证

- 未实现任何 C1 代码；未新建 `h4c-collections.mjs`；未改 `h4c-evidence.mjs`/`index.mjs`/`store.mjs`/测试。
- 未运行任何测试；33 文件 521 项、根 51 项、全量 581 项均为 `5dff386` 历史证据，不是本轮结果。
- 未安装依赖；未访问真实 Cloud/K3/设备/Provider/支付/业务网络；未启动 HTTP/UI；未部署。
- 未验证集合门禁实现（仅文档方案）；不得声称已证明不可变。
- 未验证 D4a/D4b/D5 的代码/测试；只引用已批准契约与验收矩阵；不得声称运行已通过。
- 未取得云 `DISPATCH.md`/`REVIEW.md`；未读，不声称与云端派单/审查逐项一致。
- S0/S1 未获授权；S2–S6 不在本清单授权范围；本清单不自批、不宣称 C1/G1 通过、不授权合并/实施。
- 本清单提交后停手，交 Codex 独立复审；复审前不开始 S0/S1。
