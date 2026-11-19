# HK-AI-04 H4-c C1 首阶段（S0/S1）独立授权清单（r2）

> 状态：**r2 修订清单；待 Codex 独立复审；本清单本身不授予任何实施权限。** 本轮只修订本清单；不改任务卡、勘误、设计正文、代码、测试、Store；S0/S1 仍需本轮单独授权。
>
> 清单编号：`HK-AI-04-H4C-C1-S0S1-AUTH-2026-11-19-r2`。
>
> 本次修订输入（父）：`2b72144e459f4353f69e35b849c3838413fa9d45`（v1 清单提交；其父为 `8e15960d3b2bc87a6dec7a5f267907f646713547`）。
>
> 原清单输入：`8e15960d3b2bc87a6dec7a5f267907f646713547`（设计 v8 + 勘误 r4 + 任务卡 r5）。
>
> 本次修订提交（X）：交付回报给出完整 SHA；X 的父 = `2b72144`。
>
> **实际实施起点 = X**；不是 `2b72144`，也不是 `8e15960`。
>
> 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\c1-first-stage-authorization`；分支：`docs/h4c-c1-s0-s1-authorization`；开工时 HEAD = `2b72144`，工作区干净。
>
> 设计批准现状：**本聊天已批准 18/27、私有 Set、D4a/D4b/D5 等**；E2 字面名与 E3 接口/DI 按同一设计包冻结。本清单**不再重复要求设计批准**，也不重开任何契约。
>
> 云材料：`/workspace/artifacts/RENTAL-S1-AUTH-REVIEW-2026-11-19/PARALLEL-DISPATCH.md` 与 `REVIEW.md` 本机不可读；九项裁定列未知；**不声称已读，不猜闭合**。
>
> 本清单的提交父/最终 SHA 由交付回报给出；不在文内自指。**准备/修订本清单不构成对 S0/S1/S2–S6 的任何授权。**

## 0. r2 修订摘要

| 项 | 本版修正 |
|---|---|
| 历史状态 | v1 把 E1/P9 等已批准设计项写成“待批/待复审”，属历史状态错误；r2 按本聊天已批准状态回写，不再要求重复设计批准 |
| 执行起点 | v1 写“本清单提交”但未固定到具体提交；r2 明确 **实际实施起点 = X**（父 = `2b72144`），不是 `2b72144`、不是 `8e15960` |
| Guard | r2 补齐显式非监听文件、guard 覆盖、预加载负控/正控、真实子进程继承、环境失败口径与阶段停止点 |
| 授权机制 | 删除 v1 自拟的“授权模板/编号/新流程”；只保留“S0/S1 本轮单独授权”这一既有要求 |
| 云材料 | 固定缺失路径与核对范围；九项裁定列全部记为未知，不以环境可用代替业务闭合 |
| 变更范围 | 仅本清单文件；任务卡 F45 的更正已在 `2b72144` 完成，本轮不再改卡 |

## 1. 输入、父链、远端与历史状态

### 1.1 本轮实测事实（只读）

| # | 事实 | 结果 |
|---:|---|---|
| 1 | 原清单输入 | `8e15960d3b2bc87a6dec7a5f267907f646713547` |
| 2 | 原清单父 | `d095a1888a2efba7ac8bfea76dfe120a3a74bf08` |
| 3 | 原清单 tree | `dcdd1c1e9a1ea43f499137789749b4fafb69d03f` |
| 4 | v1 清单提交 | `2b72144e459f4353f69e35b849c3838413fa9d45` |
| 5 | v1 清单父 | `8e15960d3b2bc87a6dec7a5f267907f646713547` |
| 6 | v1 清单 tree | `c19def5e071aa4b0dfed7b9d54264b86fc33f6b0` |
| 7 | v1 新清单 blob | `0c30ec76aa1995c5748775fbd78ee028ec9659f5` |
| 8 | 本次修订输入/父 | `2b72144e459f4353f69e35b849c3838413fa9d45`；开工时 HEAD 等于该 SHA |
| 9 | 本次修订提交 X | 交付回报给出完整 SHA；X 的父 = `2b72144` |
| 10 | 工作区 | `git status --porcelain` 为空（开工时）；分支无 upstream |
| 11 | 远端目标分支（push 前） | `refs/heads/docs/h4c-c1-s0-s1-authorization` = `2b72144e459f4353f69e35b849c3838413fa9d45` |
| 12 | 远端输入分支 | `origin/docs/h4c-c1-staged-implementation-task` = `8e15960d3b2bc87a6dec7a5f267907f646713547` |
| 13 | 远端设计分支 | `origin/docs/hk-face-c1-epoch-uniqueness` = `fcae2460ab0a239c54463530b0b5001f34b1f302`；是 `8e15960` 的祖先 |
| 14 | 远端 main | `origin/main` = `282a20fca9f64ab80ead50372c9c3e90bf4aeba7`；是 `8e15960` 的祖先 |
| 15 | 设计文档 | 1607 行；blob `c4feffa5831f5bf0e04e8e902865cb8e1f1b0183`；sha256 `d769da93c4880409c946e316f2414ca6b1135a96361934abc188111ca6dcbec7` |
| 16 | 代码基线 | `5dff386fe5c9648b04d1623d3e1898c59332639e`；`5dff386..2b72144 -- . ':(exclude)docs'` 为空 |
| 17 | 代码文件 hash（输入树） | `h4c-evidence.mjs` `5c94debdf87d5134bb050ed9470daa52ccee080f`；`index.mjs` `53c1ef86aef1dd7ffe7db805f6d9ab02713a516a`；`store.mjs` `f99e9996ebbeee17f2599060765f707d3840671a`；C1 测试 `14478acf80ea6b5127dbc187dff8125712de275f` |
| 18 | 测试盘点 | `admin-web/tests` 41 个 `.test.mjs`（8 个 HTTP + 33 个非 HTTP）；仓库根 `tests` 7 个 `.test.cjs`；48 个显式文件全部存在 |
| 19 | 非监听静态核对 | 33 个非 HTTP + 7 个根文件 `.listen(` 命中 **0**；8 个 HTTP 文件 `.listen(` 命中 **9 次/8 文件** |
| 20 | C1 定向测试 | `admin-web/tests/face-h4c-evidence.test.mjs` 1342 行、31 个 `test(`、`.listen(`/`fetch(` 命中 0 |
| 21 | 现有 C1 导出 | `h4c-evidence.mjs` 26 个 `export`；`index.mjs` 显式 re-export 同名 26 个 |
| 22 | 新集合模块 | `admin-web/lib/h4c-collections.mjs` **当前不存在**，由 S1 新建 |
| 23 | D10 证据 | `admin-web/lib/store.mjs:268` 当前有 public `persist(data)`；`admin-web/tests/verification.test.mjs:381` 直接 `store.persist(store.data)` |
| 24 | F45 | 已在 `2b72144` 更正；本轮不再改任务卡；旧/新与依据见 §9 |
| 25 | 云材料 | 目标路径本机无正文；九项裁定列未知；核对范围见 §10.1 |

- 上述均为只读核对；未运行测试、未安装依赖、未实现代码、未启动服务。

### 1.2 父链与分叉报告

```text
8e15960d3b2bc87a6dec7a5f267907f646713547  （设计 v8 + 勘误 r4 + 任务卡 r5）
        │
        └── 2b72144e459f4353f69e35b849c3838413fa9d45  （v1 清单）
                    │
                    └── X  （r2 清单；完整 SHA 由交付回报给出）
```

- 远端目标分支 push 前 = `2b72144`，与本次修订输入一致；本次为**普通追加提交**，不是新分支、不是 force。
- 输入分支 `8e15960` 未前移；设计分支 `fcae246`、main `282a20f` 均为输入祖先；无分叉。
- push 前再次 `ls-remote`；若目标分支已前移/被他人改写/出现平行提交：**停止报告**，不 reset/rebase/merge/force，不覆盖。
- `X` 的完整 SHA 必须由交付回报给出；实施会话不得用缩写/猜测/旧 SHA 代替。

### 1.3 历史状态更正（v1 → r2）

| 项 | v1 写法（`2b72144`） | r2 正确状态 | 依据 |
|---|---|---|---|
| E1 18/27 | “保留/可采纳，未正式批准” | **已批准（本聊天设计批准）**；C1 18 / C2 R1 27、writes 3/2 不变 | 本轮用户明确“本聊天已批准 18/27”；内容锚点任务卡 §3.3、勘误 E1 |
| 私有 Set/P9 | “待复审” | **已批准（本聊天设计批准）**；私有 Set + `isH4cCollection` + 冻结快照，不导出 Set | 本轮用户明确“私有 Set”；内容锚点任务卡 §3.3b、勘误 E3/P9 |
| D4a/D4b/D5 | “CLOSED” | **已批准/关闭（本聊天）**；proof status/legacy、C1 audit、runtime null/白名单按 §3.3g/§3.3h | 本轮用户明确“D4/D5”；任务卡 §3.3g/§3.3h |
| E2 8 字面名 | “待复审” | **随同一设计包冻结**；不再要求重复设计批准 | 本轮用户“等”；任务卡 §3.3b、勘误 E2 |
| E3 接口/DI | “待复审” | **随同一设计包冻结**；不再要求重复设计批准 | 本轮用户“等”；任务卡 §3.3c–§3.3e、勘误 E3 |
| D6 C1 API 形状 | “待复审” | **随设计包冻结**；实现按 §3.3a 签名 | 任务卡 §3.3a |
| v1 自拟授权机制 | v1 模板/编号/字段 | **删除**；只保留“本轮单独授权”，不引入新机制 | 本轮用户明确“不擅自引入新授权机制” |
| 执行起点 | “本清单提交”（未固定） | **X**；父链 `8e15960 → 2b72144 → X` | 本轮用户要求“准确执行起点”；§1.2/§4 |
| Guard | 基础覆盖与失败关闭 | 增加显式非监听文件、逐入口负控、正控、ESM、真实子进程、环境失败、阶段停止点 | 本轮用户要求；§7/§8 |
| 云材料 | 泛写“不可读” | 固定 `RENTAL-S1-AUTH-REVIEW-2026-11-19` 路径；九项裁定列未知 | 本轮用户要求；§10 |

- 以上更正只改“历史状态/起点/guard”表述；**不重开**任何已批准契约，不改变 D4/D5 取值、错误码、零写范围、18/27 预算。

## 2. 授权模型（不引入新机制）

1. **本清单不是授权。** 它只定义“如果本轮单独授权，允许做什么、验收什么、何时停”。
2. **设计批准已完成。** 18/27、私有 Set、D4a/D4b/D5 等已在本聊天批准；E2/E3 随同一设计包冻结。本清单不再要求重复设计批准，也不把这些项重新列为“待批门禁”。
3. **S0/S1 仍需本轮单独授权。** “单独授权”指本轮用户/Codex 对某一段的明确授权语句，须写明该段范围与该时刻起点 SHA；证据文档记录授权原文、时间、范围、起点。**不新增授权模板、授权编号或任何新流程。**
4. **一次授权只覆盖一段。** S0 的单独授权不覆盖 S1；S1 的单独授权不覆盖 S2；S2–S6 不在本清单授权范围。
5. **不得自批。** 清单复审通过、设计已批准、测试已绿、上一段 Stop 通过，均不替代下一段的单独授权。

| 段 | 设计批准 | 本轮单独授权 | 当前状态 |
|---|---|---|---|
| S0 | 已具备 | **未授予** | 未开工；需本轮单独授权 |
| S1 | 已具备 | **未授予** | 未开工；需 Stop-0 + 本轮单独授权 |
| S2–S6 | 已具备（按各段） | **未授予** | 不在本清单授权范围 |

## 3. 门禁寄存器（批准/未决分开）

### 3.1 已批准设计项（不再要求重复设计批准）

| 项 | 内容 | 状态 | 实现锚点 |
|---|---|---|---|
| E1/D2 | C1 **18** refs / C2 R1 **27**；writes 3/2；proof 只读 ref | **APPROVED（本聊天）** | 任务卡 §3.3；勘误 E1 |
| E2/D3 | 8 个 H4-c 集合字面名 + `admin_audit` 通用边界 | **FROZEN（随设计包）** | 任务卡 §3.3b；勘误 E2 |
| E3/D7 | `transactFinal`、`createH4cGate`、构造注入、`#persist` 私有、`h4c-collections.mjs` | **FROZEN（随设计包）** | 任务卡 §3.3c–§3.3e；勘误 E3 |
| P9 | 私有 Set + `isH4cCollection` + 冻结枚举快照；不得导出 Set | **APPROVED（本聊天）** | 任务卡 §3.3b；勘误 E3/P9 |
| D4a | proof `status="verified"` / `legacyCount=0` / snapshot | **APPROVED/CLOSED（本聊天）** | 任务卡 §3.3g/§3.3h V01–V05 |
| D4b | C1 audit `scopeKey=job._id` / genesis / append / revision=新 sequence / targetList | **APPROVED/CLOSED（本聊天）** | 任务卡 §3.3g/§3.3h V06–V09 |
| D5 | runtime `operationAuthDigest` 显式 `null` + ticket 签名该键 + runtime 白名单 | **APPROVED/CLOSED（本聊天）** | 任务卡 §3.3g/§3.3h V10–V13 |
| D6 | C1 API 形状 `evidenceAppendRefs` / `appendEvidenceWrites` | **FROZEN（随设计包）** | 任务卡 §3.3a |

- 以上为**设计层批准/冻结**；不等于 S0/S1 实施授权，也不等于代码/测试已运行。
- 不再要求 Codex 对这些项做“重复设计复审”；Stop-0/Stop-1 只核对“实现是否符合已批准锚点”。

### 3.2 仍未决/未知项（保持阻断或标注未知）

| 项 | 内容 | 状态 | 影响 |
|---|---|---|---|
| D1 | 云 `PARALLEL-DISPATCH.md` / `REVIEW.md` 本机不可读 | **UNKNOWN（未取得正文）** | 不作为已闭合；九项裁定列未知；是否阻断 C1 由 Codex 明确，见 §10 |
| D8 | N01–N142 与“工具另立卡”的测试归属 | **OPEN** | 阻断 S6；需 Codex 确认 §11.2 划界 |
| D9 | 设计批准口径 + 实施分支名/起点 | **设计批准已关闭；起点已明确为 X** | 分支名建议 `feat/hk-face-h4c-c1-staged`；调度方可用等义名，但起点必须是 X |
| D10 | `#persist` 私有会破坏 `verification.test.mjs:381` 直调 | **OPEN** | 阻断 S4；不阻断 S0/S1 |
| D11 | 真实 Cloud 并发未验证 | **OPEN（C3）** | 不阻断 S0/S1；证据必须标注未验证 |
| 本轮 S0 授权 | 本轮单独授权 | **NOT GRANTED** | S0 不得开工 |
| 本轮 S1 授权 | 本轮单独授权 | **NOT GRANTED** | S1 不得开工 |
| Guard 控制 | 负控/正控/子进程尚未执行 | **NOT RUN** | Stop-1/Stop-6 必须提供实测；本轮只写清单，不运行 |

- **规则**：未决项不得用“设计已批准”“环境可用”“上一轮已看过”替代；缺证据一律写未知。

## 4. 准确执行起点

### 4.1 父链与起点

| 概念 | SHA/位置 | 说明 |
|---|---|---|
| 原设计/勘误/卡输入 | `8e15960d3b2bc87a6dec7a5f267907f646713547` | 设计 v8 + 勘误 r4 + 任务卡 r5 |
| v1 清单提交 | `2b72144e459f4353f69e35b849c3838413fa9d45` | 父 = `8e15960`；含 F45 更正 |
| r2 清单提交 **X** | 交付回报给出完整 SHA | 父 = `2b72144`；本文件所在提交 |
| S0 实际起点 | **X** | S0 分支从 X 新建；S0 证据提交追加在 X 之上 |
| S1 实际起点 | **S0 的 Stop-0 通过 tip** | 不是 `2b72144`、不是 `8e15960` |

### 4.2 规则

- 实施分支建议 `feat/hk-face-h4c-c1-staged`；分支名可由调度方改为等义名，但**起点必须是 X**。
- 不得从 `2b72144` 或 `8e15960` 直接起代码分支后再 merge/cherry-pick 本清单；本任务禁止 merge/cherry-pick。
- 不得先写代码后补起点；不得用缩写/猜测 SHA；实施入口必须核对完整 SHA。
- 若实施会话拿到的 tip 不等于 X（或 X 之后仅有经 Codex 批准的 docs-only 修订），**停手报告**，不得自行选起点。
- S0 的提交必须保留 X 为祖先；S1 必须保留 S0 tip 为祖先；每段普通追加提交，不改写历史。

## 5. S0：基线冻结与历史状态核对（零代码）

### 5.1 目的、依赖、范围

- 目的：在 S0 实际起点 X 上冻结输入/远端/设计/代码/测试基线，记录已批准设计项、未知项和云材料缺失，形成 Stop-0 材料。
- 依赖：本轮**单独 S0 授权**；不需要重复设计批准。
- 范围：只读 Git/文件核对 + 新建证据文档；零代码、零测试执行、零 Store 访问、零服务启动。

### 5.2 准确文件白名单

| 动作 | 文件 | 说明 |
|---|---|---|
| 新建 | `docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-EVIDENCE-2026-11-19.md` | 唯一允许的新文件；S0 建，之后各段只追加本段小节 |
| 禁止 | 任何代码/测试/设计/任务卡/勘误/配置/package 文件 | 包括本清单；S0 不得改本清单 |
| 禁止 | `admin-web/**`、`tests/**`、`server.mjs`、`routes.mjs` | 零代码 diff |

### 5.3 精确输入与只读命令

S0 开始时必须重新执行并记录原始输出（不得只引用本清单数值）。以下命令中的 `X` 是**符号占位**，S0 必须替换为交付回报的完整 40 位 SHA；不得以字面 `X` 执行：

```text
git status --porcelain
git rev-parse HEAD
git rev-parse 'X^{tree}'
git log -1 --format='%H%n%P%n%T%n%ad%n%s' X
git remote -v
git -c http.sslBackend=openssl fetch origin
git -c http.sslBackend=openssl ls-remote origin refs/heads/docs/h4c-c1-s0-s1-authorization refs/heads/docs/h4c-c1-staged-implementation-task refs/heads/main
git hash-object docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md
Get-FileHash -Algorithm SHA256 docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md
git diff --stat 5dff386fe5c9648b04d1623d3e1898c59332639e..HEAD -- . ':(exclude)docs'
git rev-parse X:admin-web/lib/face-service/h4c-evidence.mjs
git rev-parse X:admin-web/lib/face-service/index.mjs
git rev-parse X:admin-web/lib/store.mjs
git rev-parse X:admin-web/tests/face-h4c-evidence.test.mjs
```

- 允许的测试：无。S0 不运行 `node --test`、不运行任何 `.test.*`、不启动任何网络动作（`fetch`/`ls-remote` 只读核对除外）。
- `git fetch`/`ls-remote` 是只读网络核对；不得 push、不得改远端、不得改配置。

### 5.4 逐条验收（A0）

| ID | 验收项 | 通过标准 | 证据 |
|---|---|---|---|
| A0-01 | 父链 | `8e15960 → 2b72144 → X` 可达；X 父 = `2b72144` | `git log`/`rev-parse` |
| A0-02 | 起点 | HEAD = X；干净；无 upstream | 原始输出 |
| A0-03 | 远端 | 目标分支 = X；输入分支 = `8e15960`；设计/main 为祖先；无前移/分叉 | `ls-remote` |
| A0-04 | 设计文档 | 1607 行；blob `c4fe…`；sha256 `d769…` | hash 输出 |
| A0-05 | 代码零差异 | `5dff386..X -- . ':(exclude)docs'` 为空 | diff 输出 |
| A0-06 | 代码基线 hash | 4 个文件 hash 与输入树一致 | `git rev-parse` |
| A0-07 | 测试盘点 | admin-web 41（8 HTTP + 33 非 HTTP）；根 7；33+7 `.listen(` 为 0 | 计数/静态扫描 |
| A0-08 | 设计批准记录 | 18/27、私有 Set、D4a/D4b/D5、E2/E3、D6 均按 §3.1 记录为已批准/冻结 | 证据引用 |
| A0-09 | 不重复设计审批 | 证据中不得再要求 Codex 复审已批准设计项；只核对实现锚点 | 文本检查 |
| A0-10 | 云材料未知 | 固定路径核对；九项裁定列记为未知；不声称已读/闭合 | §10.1 |
| A0-11 | 零代码 | 仅新建证据文档；`git diff --stat` 只含该文件 | diff |
| A0-12 | 命令可复现 | 命令、exit code、原始输出、时间写入证据 | 证据小节 |
| A0-13 | 未知/未验证单列 | 8 HTTP 未跑、测试未跑、真实云并发未验证、云材料未知 | 证据小节 |
| A0-14 | Stop-0 请求 | 提交 Stop-0 复审请求；不自行判定通过 | 复审请求 |
| A0-15 | 不进入 S1 | 证据明确“S1 未开始；待 Stop-0 + 本轮单独授权” | 提交/证据 |

### 5.5 refs/writes、停止点、授权状态

- refs/writes：**0/0**；不访问 Store。
- **Stop-0**：Codex 确认 X 基线、父链、远端、设计/代码一致性；确认已批准设计项记录正确且未被重新要求审批；确认云材料缺失/九项裁定未知已记录；确认 D8/D10/D11 状态。**Stop-0 不重新设计复审 E1/E2/E3/P9/D4/D5。**
- 授权状态：**未授权**；未获本轮单独 S0 授权前不得开工；Stop-0 未通过前不得申请 S1。

## 6. S1：契约层（纯函数）

### 6.1 目的、依赖、范围

- 目的：只落地纯常量/纯函数/validator/摘要/谓词；为 S2/S3/S4/S5 提供可复审契约，不改调用方、不写记录。
- 依赖：**Stop-0 通过**；**本轮单独 S1 授权**；设计批准已具备（不再重复设计审批）；起点 = S0 的 Stop-0 通过 tip。
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

- S1 白名单是**闭集**；新增任何文件/依赖/脚本都需重新授权。
- `h4c-collections.mjs` 新建后必须被 `store.mjs`/`h4c-evidence.mjs` 从同一模块取字面名/谓词（S4 接线时）；S1 不得在 Store 内另建第二套字面量。

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
| A1-05 | 无 Set 导出 | 命名空间无 `H4C_COLLECTION_SET`；无 `add/remove/clear/setH4cCollections` API；`Object.freeze(new Set()).add` 仍生效 | 断言 |
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
| A1-16 | gate 纯逻辑 | 冻结、只暴露 `verify`、config 来自 `evidenceKeyConfig()`、health 默认 300000/30000、非法配置错误；不接 Store | 断言 |
| A1-17 | 零 Store 改动 | `store.mjs`/`server.mjs`/`routes.mjs` 零 diff；无 H4-c 记录写；无 C2/C3 | diff/静态 |
| A1-18 | 显式非监听文件 | S1 加载的模块均在 §7.5 清单内；33+7 不跑；8 HTTP 不跑；`.listen(` 0 | 文件清单/静态扫描 |
| A1-19 | guard 覆盖 | 逐入口 patch；加载期/运行期计数；`syncBuiltinESMExports`；ESM 命名绑定被拦截 | guard 输出 |
| A1-20 | 预加载负控/正控 | 无 guard → BLOCKED；有 guard + 合成违规 → 计数/拦截/FAIL；正控真实通过；不泄漏真实网络 | 控制脚本输出 |
| A1-21 | 子进程继承 | 至少 1 个真实子进程继承 guard；子进程违规被拦截并回传计数；父包装器聚合 | 子进程输出 |
| A1-22 | 证据与 Stop-1 | 证据追加 S1（命令/exit/计数/V01–V09/guard/refs/writes/未知）；提交 Stop-1 复审；不进入 S2 | 证据/复审请求 |

### 6.5 S1 测试范围与命令

- **只允许** C1 定向测试，工作目录 `admin-web`；PowerShell 形式：

```powershell
$env:NODE_OPTIONS="--require <guard.cjs 绝对路径>"
node --test --test-isolation=none tests/face-h4c-evidence.test.mjs
```

- 包装器必须在运行前断言 `NODE_OPTIONS` 含 guard 且哨兵为真；不得只靠测试文件内部检查。
- **不允许**在 S1 运行 33 个非 HTTP 全量、7 个根文件、任何 HTTP 文件或全量 glob。
- 33+7 只在 S6 单独授权后运行；8 个 HTTP 文件永不进入 C1。
- 依赖不安装：若出现缺依赖，该测试记 BLOCKED，不得安装/stub/跳过冒充通过。

### 6.6 refs/writes、停止点、授权状态

- refs/writes：**0/0**；纯函数不写记录。
- **Stop-1**：Codex 审实现是否符合已批准锚点（schema/ID/集合名/谓词/签名、D4a/D4b 与 V01–V09）；确认 0 Store 改动、0 写、无生产调用点；确认 guard 负控/正控/子进程证据齐全。**Stop-1 不重复设计批准。**
- 授权状态：**未授权**；未获本轮单独 S1 授权前不得新建 `h4c-collections.mjs`、不得改 3 个代码/测试文件。

## 7. 显式非监听文件、guard 覆盖与预加载控制

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
- `identity-config.test.mjs` 可能 import `server.mjs`，但运行时仍要求 `listen_calls=0`；任何 `.listen` 命中即失败。

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

### 7.5 显式非监听文件集（加载期与运行期 `listen` 0）

**S1 允许加载的模块/测试（含 `index.mjs` 的传递依赖）**：

```text
admin-web/lib/h4c-collections.mjs
admin-web/lib/face-service/h4c-evidence.mjs
admin-web/lib/face-service/index.mjs
admin-web/lib/face-service/dto.mjs
admin-web/lib/face-service/state.mjs
admin-web/lib/face-service/routes.mjs
admin-web/lib/face-service/mock-provider.mjs
admin-web/lib/face-service/h4b.mjs
admin-web/lib/model.mjs
admin-web/lib/vr.mjs
admin-web/lib/store.mjs
admin-web/tests/face-h4c-evidence.test.mjs
<guard.cjs>
```

**S6 允许加载的测试文件**：§7.3 的 33 个 + §7.4 的 7 个；`identity-config.test.mjs` 可 import `admin-web/server.mjs`，但 `server.mjs` 只允许被加载，**不得 `listen`**；任何 `listen` 命中即失败。

- 明确排除、不得运行：§7.2 的 8 个 HTTP 文件；任何 `npm test`/glob/`tests/*.test.mjs` 全量；不得启动本地服务器替代测试或作为验收证据。
- 新增任何被加载文件，必须在本清单/该段授权范围中追加到非监听集；否则 Stop 失败。

### 7.6 Guard 覆盖（逐入口）

Guard 必须 patch 并计数以下入口（存在即覆盖；不存在记 BLOCKED 或经 Codex 书面豁免，不得静默跳过）：

```text
net.createServer
net.Server.prototype.listen
http.Server.prototype.listen
https.Server.prototype.listen
net.connect
net.createConnection
net.Socket.prototype.connect
tls.connect
http.request
http.get
https.request
https.get
http2.connect（若该 Node 版本存在）
globalThis.fetch
dns.lookup
dns.resolve*
dns.promises.*
dgram.createSocket
dgram.Socket.prototype.send
dgram.Socket.prototype.bind
dgram.Socket.prototype.connect
```

- 计数至少包括：`listen_calls`、`network_attempts`、`dns_calls`、`dgram_calls`、`provider_calls`；每个入口单独计数，便于定位。
- 每个入口被调用时必须：拦截、计数 +1、返回安全 sentinel 或抛受控错误、**不转发真实原函数**、不产生真实 socket/请求。
- 只断言“抛错”不算通过；必须证明计数变化且原函数未被调用。
- 加载期违规永久保留；运行期重置不得清除加载期计数；加载期任一违规即失败。
- patch 后调用 `module.syncBuiltinESMExports()`；必须证明 `import { request } from "node:http"` 等 ESM 命名绑定同样被拦截，只拦 CJS 属性不算通过。

### 7.7 预加载负控（必须全部通过）

1. **无 guard 负控**：用同一包装器启动一个不设 `NODE_OPTIONS` 的子进程；包装器必须检测不到 `GUARD_ACTIVE`/哨兵，直接 **BLOCKED**，不得继续跑测试。
2. **加载前负控**：一个在模块顶层调用 `http.request`/`net.connect` 的合成模块；guard 必须在测试模块加载前记录加载期违规并失败。
3. **逐入口运行期负控**：对 §7.6 的每个入口各调用一次；每次必须计数 +1、被拦截、无真实 socket/请求。N 个入口 N/N 通过，缺一即 BLOCKED。
4. **泄漏负控**：若 guard 未拦截、真实网络连接建立或真实 DNS 查询发生，本次运行 FAIL，不得以“测试未触发”解释。
5. 负控脚本放在工作树之外；不提交；记录绝对路径 + sha256；不得把负控写成生产测试。

### 7.8 正控（防过度拦截）

- 必须验证 C1 测试真实依赖不被误拦：`node:crypto` 的 HMAC/摘要、`node:fs/promises` 的临时目录读写、`node:buffer`/`node:url`/`node:path`/`node:os`、固定 test K3 config、`LocalStore` 临时文件写入。
- 正控必须产生真实结果（HMAC 与预期一致、临时文件可读写、LocalStore 可初始化），不得只断言“未抛错”。
- 任一正控失败 = guard 过度拦截 = **BLOCKED**；不得放宽 guard 后重跑。

### 7.9 真实子进程继承

- 至少 1 个**真实子进程**通过 `NODE_OPTIONS=--require/--import <guard>` 继承 guard；子进程内调用一个受保护入口（如 `fetch` 或 `net.connect`），必须被拦截并把计数回传父进程。
- 父包装器必须聚合子进程计数，并断言子进程 `GUARD_ACTIVE` 为真、`listen_calls=0`、`network_attempts` 符合预期。
- 测试文件若自行 spawn 子进程，必须保留 `NODE_OPTIONS`；不得在 `env` 中删除 guard；包装器检查至少一个真实子进程证据。
- 子进程继承失败 = **BLOCKED**；不得用静态 import 替代，不得跳过。

### 7.10 环境失败口径

- guard 安装失败、入口缺失/非函数、加载期违规、负控未触发、真实网络泄漏、正控失败、子进程继承失败：一律 **BLOCKED**，终止本次运行。
- 不得降级为“无 guard 运行”、不得重试绕过、不得改写环境规避、不得把环境可用当业务验收。
- 入口在特定 Node 版本不存在时，默认 BLOCKED；只有 Codex 书面批准“该版本无此入口”才可登记为显式豁免，并给出替代覆盖。
- 证据必须记录：`process.version`、平台、guard 入口数、负控通过数、正控通过数、子进程负控结果、各计数器最终值。

### 7.11 阶段测试授权与停止点

| 段 | 允许运行的测试 | Guard 要求 | 停止点 |
|---|---|---|---|
| S0 | 无 | 不运行 guard | Stop-0 只记录 guard 计划 |
| S1 | 仅 `admin-web/tests/face-h4c-evidence.test.mjs` | 预加载负控/正控/逐入口/子进程全过；33+7 不跑；8 HTTP 不跑 | Stop-1 必须附 guard 证据 |
| S2–S5 | 仅该段本轮授权列出的 C1 定向文件 | 同一 guard；新增加载文件必须进非监听集 | 各 Stop 附 guard 计数 |
| S6 | 33 个非 HTTP + 7 个根文件（显式） | 全量 guard；8 HTTP 不跑；`listen_calls=0` | Stop-6 附全套 guard 证据 |

- 任一 guard 失败 = 该段 BLOCKED；不得以“测试通过”替代 guard 证据，不得摘除 guard 重跑。

## 8. 逐段停止点与单独授权

| Stop | 段 | 通过条件 | 失败处置 | 本清单授权 |
|---|---|---|---|---|
| Stop-0 | S0 | X 基线/父链/远端/设计/代码零差异一致；已批准设计项记录正确、未被重复要求审批；云材料未知已记录；D8/D10/D11 状态 | 停止报告；不改历史、不猜合同 | 否 |
| Stop-1 | S1 | 实现符合已批准锚点；D4a/D4b 与 V01–V09；0 Store 改动、0 写；guard 负控/正控/子进程全过 | 同段追加修复，不跨段 | 否 |
| Stop-2 | S2 | 18 refs（含 proof1）；anchor/1..9/完整链；无布尔；缺 proof 拒绝；零写 | 同段追加修复 | 否 |
| Stop-3 | S3 | D4b/D5 与 V06–V13；finalWriteSet 字节绑定；唯一 audit；explicit；0 新增 refs | 同段追加修复 | 否 |
| Stop-4 | S4 | 8 集合 + admin_audit 全路径；explicit；≤90；无双审计；gate 注入；私有 Set/谓词/冻结；D10；非 H4-c 零回归 | 同段追加修复 | 否 |
| Stop-5 | S5 | D4a 与 V01–V05；K3/marker/proof/plan/fence/健康/错误顺序；只读；旧 W0 无授权；proof ref 实际使用 | 同段追加修复 | 否 |
| Stop-6 | S6 | 33+7 全绿；F/N 逐项；10 轮并发；静态 0；预算 18/27；白名单；guard 全过；8 HTTP 未跑单列 | 退回对应阶段；S6 不修生产代码 | 否 |

- **单独授权**：Stop-N 通过后，只能“申请”S(N+1) 的本轮单独授权；没有该授权不得开工。
- **不得自批**：任何提交信息/证据不得写“已通过/已批准/可合并”；只写“请求复审”。
- **一次授权一段**：S0 的单独授权不覆盖 S1；S1 不覆盖 S2；修复提交仍属同一段，不跨段夹带。
- **不引入新机制**：不得新增授权模板/编号/流程；授权以本轮明确语句为准，证据记录原文。

## 9. F45 旧→新更正（历史记录，本轮不改卡）

### 9.1 旧行（v1 更正前，任务卡 L907）

```text
| **F45** | **runtime ticket 缺/错 operationAuthDigest（D5 未裁定）** | **S3** | **ADMISSION_REQUIRED；无正向验收** | **Z_all** |
```

### 9.2 新行（已在 `2b72144` 生效）

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
- 本轮 r2 **不再修改任务卡**；该更正已包含在 `2b72144`。

## 10. 云材料缺失、九项裁定与未决项

### 10.1 云材料核对（无正文）

| 材料 | 期望位置 | 本机核对 | 结果 |
|---|---|---|---|
| `PARALLEL-DISPATCH.md` | `/workspace/artifacts/RENTAL-S1-AUTH-REVIEW-2026-11-19/PARALLEL-DISPATCH.md` | `/workspace/...`、`C:\workspace\...`、`D:\`–`L:\workspace\...`、`\\wsl$\...`、`\\wsl.localhost\...`、仓库 `.tmp`/`docs`、相关 rental 工作树 | **无正文/不存在** |
| `REVIEW.md` | `/workspace/artifacts/RENTAL-S1-AUTH-REVIEW-2026-11-19/REVIEW.md` | 同上 | **无正文/不存在** |

- 本机无 WSL（`wsl.exe` 不可用）；`C:\workspace` 不存在；10 个盘符下均无 `workspace\artifacts\RENTAL-S1-AUTH-REVIEW-2026-11-19`。
- **不声称已读**；不以“路径可访问/环境可用”代替业务验收。

### 10.2 九项裁定列（全部未知）

| # | 列名 | 取值/适用范围 | 状态 |
|---:|---|---|---|
| 1 | 未知 | 未知 | 待 `REVIEW.md` 正文 |
| 2 | 未知 | 未知 | 待正文 |
| 3 | 未知 | 未知 | 待正文 |
| 4 | 未知 | 未知 | 待正文 |
| 5 | 未知 | 未知 | 待正文 |
| 6 | 未知 | 未知 | 待正文 |
| 7 | 未知 | 未知 | 待正文 |
| 8 | 未知 | 未知 | 待正文 |
| 9 | 未知 | 未知 | 待正文 |

- 九项裁定的列名、取值、适用范围均未知；**不猜、不编、不据此关闭任何 C1 门禁**。
- 若 Codex 认为该九项与 C1 S0/S1 有关，需提供正文并逐列核对；在取得前，本清单不把该材料当作已闭合，也不把它当作已批准的 C1 设计依据。

### 10.3 未决项

| # | 未决项 | 状态 | 影响 |
|---:|---|---|---|
| 1 | 云 `PARALLEL-DISPATCH.md`/`REVIEW.md` 正文 | 未知/缺失 | 见 §10.1；不声称闭合 |
| 2 | 九项裁定列 | 未知 | 见 §10.2；待核对 |
| 3 | S0 本轮单独授权 | 未授予 | S0 不得开工 |
| 4 | S1 本轮单独授权 | 未授予 | S1 不得开工 |
| 5 | D8 N 矩阵归属 | OPEN | 阻断 S6 |
| 6 | D10 persist fixture | OPEN | 阻断 S4 |
| 7 | D11 真实 Cloud 并发 | OPEN（C3） | 不阻断 S0/S1；标注未验证 |
| 8 | 设计批准来源 | 本聊天用户指令；无独立批准文号 | 已记录，不再重复设计审批；Codex 可核对 |

## 11. 本清单自身交付与 Git 约束

### 11.1 变更范围

| 文件 | 动作 | 说明 |
|---|---|---|
| `docs/tasks/HK-AI-04-H4C-C1-S0-S1-AUTHORIZATION-2026-11-19.md` | 修改 | r2 修订；仅本文件 |
| 任务卡/勘误/设计/代码/测试 | 不改 | 本轮零 diff |

- 不触碰其他文件；设计正文/勘误/任务卡/代码/测试/配置零 diff。

### 11.2 提交与 push 约束

- 一个 docs-only 追加提交；父 = `2b72144`；提交信息建议：`docs(face): revise H4-c C1 S0/S1 authorization checklist`。
- 提交前：`git diff --check`、`git show --check` 均须 exit 0；`git diff --stat`/`git show --stat` 只含本文件。
- push 前：`git -c http.sslBackend=openssl ls-remote origin refs/heads/docs/h4c-c1-s0-s1-authorization` 必须等于 `2b72144`；若已前移/被改写，停止报告，不覆盖。
- push：普通 `git push origin docs/h4c-c1-s0-s1-authorization`；不使用 `--force`、不追加其他推送配置、不改全局 Git/TLS。
- push 后：`git ls-remote` 必须返回**完整 40 位 SHA** 且等于本地最终提交；不得用缩写/猜测。
- 禁止：amend/rebase/reset/squash/force/merge/cherry-pick；禁止改写本提交历史。

### 11.3 固定 SHA 文件 URL（交付回报填写）

```text
https://github.com/1997dmsu-sketch/SMART-PM/blob/<X 完整SHA>/docs/tasks/HK-AI-04-H4C-C1-S0-S1-AUTHORIZATION-2026-11-19.md
https://github.com/1997dmsu-sketch/SMART-PM/blob/<X 完整SHA>/docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-TASK-2026-11-18.md
```

## 12. 明确未做/未验证

- 未实现任何 C1 代码；未新建 `h4c-collections.mjs`；未改 `h4c-evidence.mjs`/`index.mjs`/`store.mjs`/测试。
- **未运行任何测试**；未执行 guard 负控/正控/子进程；未安装依赖；未启动服务。
- 未访问真实 Cloud/K3/设备/Provider/支付/业务网络；未启动 HTTP/UI；未部署。
- 未取得云 `PARALLEL-DISPATCH.md`/`REVIEW.md` 正文；九项裁定列未知；不声称已读/闭合。
- 未验证 D4a/D4b/D5 的代码/测试；只引用已批准契约与验收矩阵；不得声称运行已通过。
- 未把环境可用（路径存在、命令可执行、工作树可写）当作业务验收。
- S0/S1 未获本轮单独授权；S2–S6 不在本清单授权范围；本清单不自批、不宣称 C1/G1 通过、不授权合并/实施。
- 本清单提交后停手，交 Codex 独立复审；复审前不开始 S0/S1。
