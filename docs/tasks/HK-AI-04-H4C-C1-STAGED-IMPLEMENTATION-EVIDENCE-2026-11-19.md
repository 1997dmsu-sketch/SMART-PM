# HK-AI-04 H4-c C1 分阶段实施证据（S0/S1）

> 状态：**S0 证据已记录；Stop-0 请求 Codex 独立复审，未自批、未判定通过；S1 未开始。** 本轮用户已授权 S0/S1 实施范围，但 S1 以 Stop-0 复审通过为前提（§0）。本文件由 S0 新建；后续各段只追加本段小节，不改写 S0 小节。
>
> 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\c1-s0-s1-implementation`
>
> 分支：`feat/h4c-c1-s0-s1`；实施起点 X = `ed6f862dac5307b0f027a83570fd8a0cb8da1a09`；父链 `8e15960 → 2b72144 → X`。
>
> 本轮未运行任何测试、未安装依赖、未访问 Store、未启动服务、未调用真实 Cloud/K3/设备/Provider/支付；S0 为只读核对 + 新建本证据文件。

## 0. 本轮实施授权记录（不新增授权机制）

| 项 | 记录 |
|---|---|
| 授权时刻 | 2026-11-20T09:44:57+08:00（DSH 会话采样；本节命令执行始于 2026-11-20T09:46+08:00） |
| 授权来源 | 用户本轮消息（新独立任务 B；调度 SMART-PM-H3） |
| 授权原文（摘录） | 「本轮授权C1清单ed6f862dac5307b0f027a83570fd8a0cb8da1a09明确定义S0/S1。」「用户本条即实施范围授权，卡内历史未授权措辞按本轮更新记录，但逐阶段独立复审停止点仍遵守。」「本轮已授权S1范围但需Stop-0复核后才继续，不因历史授权措辞重复要用户许可。」 |
| 范围 | S0 + S1；仅限 S0/S1 白名单文件；S1 以 Stop-0 通过为前提；S2–S6、C2/C3、迁移/生产写、HTTP/UI/部署不在范围 |
| 起点 | **X**（不是 `2b72144`、不是 `8e15960`）；S1 起点 = S0 的 Stop-0 通过 tip |
| 历史状态更新 | 授权清单 §2 表格中 S0/S1「未授予」、任务卡 §3.1 集合字面名「待批准」、任务卡 §3.3「勘误 E1 未批准前不得实现 18 refs」均为历史表述；按本轮用户明确授权，S0/S1 已获实施范围、18/27 已批准。**本证据只记录该更新，不改清单/任务卡/勘误/设计正文。** |
| 不自批 | Stop-0 交 Codex 独立复审；本文件不写「通过/已批准/可合并」；复审通过前不进入 S1 |

- 授权清单 r2 页首自述「本清单本身不授予任何实施权限」与 §2「S0/S1 仍需本轮单独授权」指清单文件本身；本轮的单独授权由用户本条消息给出，二者不矛盾。
- 授权清单 §2 规则「一次授权只覆盖一段」仍遵守：S0 停止点为 Stop-0；S1 停止点为 Stop-1；不跨段夹带。

## 1. S0 基线冻结（X）

### 1.1 起点与父链

| 项 | 实测值 |
|---|---|
| 工作树 | `C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\c1-s0-s1-implementation` |
| 分支 | `feat/h4c-c1-s0-s1` |
| HEAD（X） | `ed6f862dac5307b0f027a83570fd8a0cb8da1a09` |
| X 父 | `2b72144e459f4353f69e35b849c3838413fa9d45` |
| X tree | `13e4601660847a0f6203536dc9babe033abc28ed` |
| X 提交时间/主题 | `Thu Nov 19 15:39:36 2026 +0800`；`docs(face): revise H4-c C1 S0/S1 authorization checklist` |
| 工作区 | `git status --porcelain` 为空（开工时） |
| upstream | 无（`git rev-parse --abbrev-ref --symbolic-full-name '@{u}'` exit 128: no upstream） |
| 实施起点判定 | HEAD = X；X 在该工作树上；未从 `2b72144`/`8e15960` 另起代码分支 |

父链可达：`8e15960d3b2bc87a6dec7a5f267907f646713547`（设计 v8 + 勘误 r4 + 任务卡 r5）→ `2b72144e459f4353f69e35b849c3838413fa9d45`（v1 清单）→ `ed6f862dac5307b0f027a83570fd8a0cb8da1a09`（r2 清单 X）。

### 1.2 远端、fetch 与前移/分叉核对

| 项 | 实测值（`git -c http.sslBackend=openssl ls-remote origin ...`，exit 0） |
|---|---|
| 远端授权分支 | `refs/heads/docs/h4c-c1-s0-s1-authorization` = `ed6f862dac5307b0f027a83570fd8a0cb8da1a09`（= X） |
| 远端输入分支 | `refs/heads/docs/h4c-c1-staged-implementation-task` = `8e15960d3b2bc87a6dec7a5f267907f646713547` |
| 远端设计分支 | `refs/heads/docs/hk-face-c1-epoch-uniqueness` = `fcae2460ab0a239c54463530b0b5001f34b1f302` |
| 远端 v7 修订分支 | `refs/heads/docs/hk-face-c1-v7-review-fixes` = `bc80f741981cade3e4e3d65df709c24f31556c06` |
| 远端 main | `refs/heads/main` = `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` |
| 远端 `feat/h4c-c1-s0-s1` | **不存在**（ls-remote 查询无该 ref；S0 提交后以普通 push 精确创建） |
| 设计分支/main 祖先 | `git merge-base --is-ancestor origin/docs/hk-face-c1-epoch-uniqueness HEAD` exit 0；`origin/main` exit 0 |
| main 前移/分叉 | `git rev-list --left-right --count origin/main...HEAD` = `0 145`（落后 0、领先 145；无分叉） |
| fetch | `git -c http.sslBackend=openssl fetch origin` exit 0 |
| FETCH_HEAD | `cc4ec7baf5ca4bcc52c3466b99b6b41b6374ff08`（无关 07B 分支 tip；`git branch -r --contains` 仅 07B 分支；未作为 C1 输入） |

- 结论：远端目标分支 tip = X，输入分支 = `8e15960`，设计/main 均为祖先；**未发现前移、改写或平行提交**。`feat/h4c-c1-s0-s1` 为独立新分支，S0 提交将普通追加在 X 之上并精确 push 该分支。
- 若 push 前远端出现该分支或任何前移，停止报告，不 reset/rebase/merge/force。

### 1.3 代码基线与零代码差异

| 项 | 实测值 |
|---|---|
| 代码基线 | `5dff386fe5c9648b04d1623d3e1898c59332639e`；`git merge-base --is-ancestor 5dff386 HEAD` exit 0 |
| `5dff386..X` 提交数 | 17 个，全部为 docs 提交（`git log --oneline 5dff386..X`） |
| `git diff --stat 5dff386..X -- . ':(exclude)docs'` | **空**（exit 0） |
| `git diff --name-only 5dff386..X -- . ':(exclude)docs'` | **空**（exit 0） |
| `5dff386..X` 全量 stat | 仅 4 个 docs 文件，3602 insertions；无代码/测试/配置 diff |
| `2b72144..X` stat | 仅 `HK-AI-04-H4C-C1-S0-S1-AUTHORIZATION-2026-11-19.md`（338 insertions / 254 deletions） |

### 1.4 代码文件 blob（输入树 = X = 5dff386）

| 文件 | X blob | 5dff386 blob | 2b72144 blob |
|---|---|---|---|
| `admin-web/lib/face-service/h4c-evidence.mjs` | `5c94debdf87d5134bb050ed9470daa52ccee080f` | 同左 | 同左 |
| `admin-web/lib/face-service/index.mjs` | `53c1ef86aef1dd7ffe7db805f6d9ab02713a516a` | 同左 | 同左 |
| `admin-web/lib/store.mjs` | `f99e9996ebbeee17f2599060765f707d3840671a` | 同左 | 同左 |
| `admin-web/tests/face-h4c-evidence.test.mjs` | `14478acf80ea6b5127dbc187dff8125712de275f` | 同左 | 同左 |

- 四个 blob 与授权清单 §1.1 #17 记录一致；`5dff386`、`2b72144`、`X` 三点相同，证明 S0 前代码零漂移。
- `admin-web/lib/h4c-collections.mjs` 在 X **不存在**（`Test-Path` False）；由 S1 新建。

## 2. 设计、勘误、任务卡、授权清单身份

| 文件 | 行数 | blob（git hash-object） | sha256 | 状态页首（原文摘要） |
|---|---:|---|---|---|
| `docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md` | 1607 | `c4feffa5831f5bf0e04e8e902865cb8e1f1b0183` | `d769da93c4880409c946e316f2414ca6b1135a96361934abc188111ca6dcbec7` | 设计 v8；设计提案，待 Codex 复审 |
| `docs/tasks/HK-AI-04-H4C-C1-REFS-ERRATUM-2026-11-19.md` | 384 | `c5797a075f15eadc59c31b80ef258a6717d0af3b` | `274317a4fb67d763dcf770473174dc3e32ddefab202883b3b33721a48f76d107` | 勘误 r4；D4a/D4b/D5 已按本轮裁定回写，待复审 |
| `docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-TASK-2026-11-18.md` | 995 | `080c590fb61112c3b061b4b26c9dc017f1bf5c73` | `388409286d44ecdb277ff42f3cab4fd516955d90059ceffeb2e09c240117204f` | 任务卡 r5 |
| `docs/tasks/HK-AI-04-H4C-C1-S0-S1-AUTHORIZATION-2026-11-19.md` | 616 | `5922ba81173639e341f7ba9651d7a2e3db4c094a` | `4d05398073ccb6e25d73d4f34db3cbd0be47079203cc40c3e3d699bc77a5d7b3` | 授权清单 r2 |

- 设计文档 1607 行、blob、sha256 与授权清单 §1.1 #15 完全一致；`docs` 正文未在本轮修改。
- 上述「待复审/不授权」为文件历史状态；本轮实施授权见 §0，不据此重复要求设计批准。

## 3. 已批准/冻结设计项（按授权清单 §3.1，不重复设计审批）

| 项 | 内容 | 本轮记录状态 | 实现锚点 |
|---|---|---|---|
| E1/D2 | C1 **18** refs / C2 R1 **27**；writes 3/2；proof 只读 ref | **APPROVED（本轮用户授权）** | 任务卡 §3.3；勘误 E1 |
| E2/D3 | 8 个 H4-c 集合字面名 + `admin_audit` 通用边界 | **FROZEN（随同一设计包）** | 任务卡 §3.1/§3.3b；勘误 E2 |
| E3/D7 | `transactFinal`、`createH4cGate`、构造注入、`#persist` 私有、`h4c-collections.mjs` | **FROZEN（随同一设计包）** | 任务卡 §3.3c–§3.3e；勘误 E3 |
| P9 | 私有 Set + `isH4cCollection` + 冻结枚举快照；不得导出 Set | **APPROVED（本轮用户授权）** | 任务卡 §3.3b；勘误 E3/P9 |
| D4a | proof `status="verified"` / `legacyCount=0` / snapshot | **APPROVED/CLOSED（本轮用户授权）** | 任务卡 §3.3g/§3.3h V01–V05 |
| D4b | C1 audit `scopeKey=job._id` / genesis / append / revision=新 sequence / targetList | **APPROVED/CLOSED（本轮用户授权）** | 任务卡 §3.3g/§3.3h V06–V09 |
| D5 | runtime `operationAuthDigest` 显式 `null` + ticket 签名该键 + runtime 白名单 | **APPROVED/CLOSED（本轮用户授权）** | 任务卡 §3.3g/§3.3h V10–V13 |
| D6 | C1 API 形状 `evidenceAppendRefs` / `appendEvidenceWrites` | **FROZEN（随同一设计包）** | 任务卡 §3.3a |

- E2 冻结字面名：`device_operation_evidence`、`device_operation_evidence_heads`、`evidence_digest_domains`、`evidence_chain_anchors`、`evidence_chain_audits`、`evidence_chain_fences`、`evidence_chain_k3_markers`、`evidence_chain_plans`；`admin_audit` 为通用 7 字段审计，不计入 8 集合（勘误 §2）。
- 上述为**设计层批准/冻结**，不等于 S0/S1 实施已通过；Stop-0/Stop-1 只核对实现是否符合这些锚点，**不重新设计复审**。
- 任务卡 §3.1 的「字面名待批准」、§3.3 的「E1 未批准前不得实现 18 refs」为历史表述；按本轮授权记录为已批准，S1 可按 18/27 与 8 字面名实施（仍未开始的 S1 以 Stop-0 通过为前提）。

## 4. 未决/未知项（保持未知，不据此关闭 C1）

| 项 | 状态 | 影响 | 本轮记录 |
|---|---|---|---|
| D1 云 `PARALLEL-DISPATCH.md` / `REVIEW.md` | **UNKNOWN（未取得正文）** | 九项裁定列未知；是否阻断 C1 由 Codex 明确 | §5.3 路径核对全部不存在；不声称已读/闭合 |
| D8 N01–N142 与「工具另立卡」归属 | **OPEN** | 阻断 S6 | 未解除 |
| D9 设计批准口径 + 实施分支名/起点 | **CLOSED（设计批准 + 起点 X）** | 无 | 分支 `feat/h4c-c1-s0-s1`，起点 X |
| D10 `#persist` 私有破坏 `verification.test.mjs:381` 直调 | **OPEN** | 阻断 S4 | 未解除 |
| D11 真实 Cloud 并发未验证 | **OPEN（C3）** | 不阻断 S0/S1；证据标注未验证 | 未验证 |
| Guard 负控/正控/子进程 | **NOT RUN** | Stop-1/Stop-6 必须提供实测 | S0 只记录计划；S1 必须运行 |
| 8 个 HTTP 文件 | **NOT RUN（禁止）** | 不属于 C1 验收 | 本阶段未运行 |
| 33+7 非监听全量 | **NOT RUN** | 仅 S6 单独授权后运行 | 本阶段未运行 |

## 5. 非监听清单、测试盘点与静态核对

### 5.1 测试数量

| 项 | 实测 |
|---|---|
| `admin-web/tests/*.test.mjs` | **41** 个 |
| 其中 HTTP（会 `listen`） | **8** 个（显式清单见 §5.2） |
| 其中非 HTTP | **33** 个（显式清单见 §5.3） |
| 仓库根 `tests/*.test.cjs` | **7** 个（显式清单见 §5.4） |
| 48 个显式文件存在性 | 全部存在 |

### 5.2 8 个 HTTP 文件与 `.listen(` 命中（明确禁跑）

| 文件 | `.listen(` 命中 |
|---|---:|
| `admin-web/tests/blacklist-http.test.mjs` | 1 |
| `admin-web/tests/occupancy-http.test.mjs` | 1 |
| `admin-web/tests/server.test.mjs` | 1 |
| `admin-web/tests/server-face.test.mjs` | 1 |
| `admin-web/tests/server-face-bounds.test.mjs` | 1 |
| `admin-web/tests/server-files.test.mjs` | 2 |
| `admin-web/tests/server-v2.test.mjs` | 1 |
| `admin-web/tests/verification-http.test.mjs` | 1 |
| **合计** | **9 次 / 8 文件** |

- 与授权清单 §1.1 #19、§7.2 一致（9 次/8 文件；`server-files` 2 处）。
- 这 8 个文件**不属于 C1 验收**；S0/S1/S2–S6 均不得运行；不得以本地服务器替代测试。

### 5.3 33 个非 HTTP 文件 `.listen(` 命中 = **0**

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

- 实测 `\.listen\(` 命中：**0**（33 个文件）；`.test.mjs` 总数 41 = 8 + 33。
- `identity-config.test.mjs` 可 import `server.mjs`，但运行时仍要求 `listen_calls=0`；任何 `.listen` 命中即失败。

### 5.4 7 个根文件 `.listen(` 命中 = **0**

```text
tests/cloud-bootstrap.test.cjs
tests/frontend.test.cjs
tests/layout.test.cjs
tests/phone-login.test.cjs
tests/public-houses.test.cjs
tests/wechat-modules.test.cjs
tests/wxml.test.cjs
```

- 实测 `\.listen\(` 命中：**0**（7 个文件）；仍按显式清单执行，不用根 glob。
- 历史基线 `5dff386`：33 非 HTTP 521 项、根 7 文件 51 项、全量 581 项（含 60 项 loopback）。**本轮未重跑**；仅作历史对照，不作为本次结果。

### 5.5 C1 定向测试静态核对

| 项 | 实测 |
|---|---|
| `admin-web/tests/face-h4c-evidence.test.mjs` 行数 | **1342** |
| 顶层 `test(` 数 | **31** |
| `.listen(` 命中 | **0** |
| `fetch(` 命中 | **0** |
| 现有 `h4c-evidence.mjs` `export` 行 | **26** |
| `index.mjs` 显式 re-export 名单 | **26 个同名导出**（5 个 `export *` + 显式名单；未新增 bootstrap/create-domain/empty-check 入口） |

### 5.6 S1 允许加载的非监听文件集（授权清单 §7.5，S1 前冻结）

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

- S1 只允许 `admin-web/tests/face-h4c-evidence.test.mjs` 定向测试；不跑 33、不跑根 7、不跑 8 HTTP。
- 新增任何被加载文件必须追加到非监听集；否则 Stop 失败。

## 6. 云材料与九项裁定列（无正文）

### 6.1 路径核对（全部不存在）

| 材料 | 期望位置 | 实测 |
|---|---|---|
| `PARALLEL-DISPATCH.md` | `/workspace/artifacts/RENTAL-S1-AUTH-REVIEW-2026-11-19/PARALLEL-DISPATCH.md` | 不存在 |
| `REVIEW.md` | `/workspace/artifacts/RENTAL-S1-AUTH-REVIEW-2026-11-19/REVIEW.md` | 不存在 |
| 同目录 | `C:\workspace\artifacts\RENTAL-S1-AUTH-REVIEW-2026-11-19\` | 不存在 |
| 盘符 D–L | `<盘>:\workspace\artifacts\RENTAL-S1-AUTH-REVIEW-2026-11-19` | 均不存在 |
| WSL | `/workspace/...`、`\\wsl$\...`、`\\wsl.localhost\...` | `wsl.exe` 不可用；无正文 |
| 仓库/工作树 | 本仓库、`.tmp` 各工作树、`docs` | 未发现同名文件/目录 |

- **未声称已读、未声称闭合**；不以路径可访问/环境可用代替业务验收。
- `.tmp/rental-s1-authorization` 是 rental 仓库工作树，顶层无 `PARALLEL-DISPATCH.md`/`REVIEW.md`；其余 `.tmp` 同名文件/`RENTAL-S1-AUTH-REVIEW-2026-11-19` 目录均无命中。

### 6.2 九项裁定列

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

- 不猜、不编、不据此关闭任何 C1 门禁；若 Codex 认为与 S0/S1 有关，需提供正文并逐列核对。

## 7. A0 逐条验收（S0）

| ID | 验收项 | 结果 | 证据 |
|---|---|---|---|
| A0-01 | 父链 `8e15960 → 2b72144 → X`；X 父 = `2b72144` | 满足 | §1.1 |
| A0-02 | HEAD = X；干净；无 upstream | 满足 | §1.1 |
| A0-03 | 远端目标 = X；输入 = `8e15960`；设计/main 为祖先；无前移/分叉 | 满足 | §1.2 |
| A0-04 | 设计 1607 行；blob `c4fe…`；sha256 `d769…` | 满足 | §2 |
| A0-05 | `5dff386..X -- . ':(exclude)docs'` 为空 | 满足 | §1.3 |
| A0-06 | 4 个代码文件 hash 与输入树一致 | 满足 | §1.4 |
| A0-07 | admin-web 41（8 HTTP + 33 非 HTTP）；根 7；33+7 `.listen(` = 0 | 满足 | §5 |
| A0-08 | 18/27、私有 Set、D4a/D4b/D5、E2/E3、D6 记录为已批准/冻结 | 满足 | §3 |
| A0-09 | 证据不再要求 Codex 复审已批准设计项；只核对实现锚点 | 满足 | §3、§8 |
| A0-10 | 云材料固定路径核对；九项裁定列记为未知；不声称已读/闭合 | 满足 | §6 |
| A0-11 | 零代码：仅新建本证据文档 | 满足（提交前复核 diff 仅本文件） | §1.3、§9 |
| A0-12 | 命令、exit code、原始输出、时间写入证据 | 满足 | §9 |
| A0-13 | 8 HTTP 未跑、测试未跑、真实云并发未验证、云材料未知单列 | 满足 | §4、§7 |
| A0-14 | 提交 Stop-0 复审请求；不自行判定通过 | **请求复审（未判定）** | §8 |
| A0-15 | 不进入 S1；证据明确「S1 未开始；待 Stop-0 复审」 | 满足 | 页首、§8 |

## 8. Stop-0 复审请求与停止点

- **Stop-0 请求 Codex 独立复审**，请核对：
  1. X 基线、父链、远端与前移/分叉（§1）；
  2. 设计/勘误/任务卡/授权清单的 SHA/tree/blob 身份（§2）；
  3. 已批准/冻结设计项记录正确，且未被重新要求设计审批（§3）；
  4. 云材料缺失与九项裁定未知已记录（§6）；
  5. D8/D10/D11 状态、8 HTTP 未跑、测试未跑、guard 未跑（§4）；
  6. 零代码 diff（仅本证据文件）（§1.3、§9）。
- **不重新设计复审** E1/E2/E3/P9/D4/D5/D6；只核对实现是否符合已批准锚点。
- **未自批**：本文件不写「Stop-0 通过」「已批准」「可合并」；Codex 复审通过前不开始 S1。
- **S1 未开始**：本轮 S1 范围已获授权，但以 Stop-0 通过为前提；通过后 S1 从 **S0 的 Stop-0 通过 tip** 起，只改 S1 白名单 4 个代码/测试文件 + 追加本文件 S1 小节；不改 Store，不扩 C2/C3/迁移生产写。

## 9. 命令、exit code 与原始输出（S0 只读核对）

> 执行环境：Windows / PowerShell 7；工作目录 `C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\c1-s0-s1-implementation`；运行时间 2026-11-20T09:46–09:52+08:00。未运行 `node --test` 或任何 `.test.*`。

### 9.1 起点/父链/远端

```text
$ git status --porcelain
EXIT 0
（空）

$ git rev-parse HEAD
EXIT 0
ed6f862dac5307b0f027a83570fd8a0cb8da1a09

$ git rev-parse --abbrev-ref HEAD
EXIT 0
feat/h4c-c1-s0-s1

$ git rev-parse 'ed6f862dac5307b0f027a83570fd8a0cb8da1a09^{tree}'
EXIT 0
13e4601660847a0f6203536dc9babe033abc28ed

$ git log -1 --format='%H%n%P%n%T%n%ad%n%s' ed6f862dac5307b0f027a83570fd8a0cb8da1a09
EXIT 0
ed6f862dac5307b0f027a83570fd8a0cb8da1a09
2b72144e459f4353f69e35b849c3838413fa9d45
13e4601660847a0f6203536dc9babe033abc28ed
Thu Nov 19 15:39:36 2026 +0800
docs(face): revise H4-c C1 S0/S1 authorization checklist

$ git rev-parse --abbrev-ref --symbolic-full-name '@{u}'
EXIT 128
fatal: no upstream configured for branch 'feat/h4c-c1-s0-s1'

$ git -c http.sslBackend=openssl fetch origin
EXIT 0

$ git -c http.sslBackend=openssl ls-remote origin refs/heads/docs/h4c-c1-s0-s1-authorization refs/heads/docs/h4c-c1-staged-implementation-task refs/heads/main refs/heads/feat/h4c-c1-s0-s1 refs/heads/docs/hk-face-c1-epoch-uniqueness refs/heads/docs/hk-face-c1-v7-review-fixes
EXIT 0
ed6f862dac5307b0f027a83570fd8a0cb8da1a09  refs/heads/docs/h4c-c1-s0-s1-authorization
8e15960d3b2bc87a6dec7a5f267907f646713547  refs/heads/docs/h4c-c1-staged-implementation-task
fcae2460ab0a239c54463530b0b5001f34b1f302  refs/heads/docs/hk-face-c1-epoch-uniqueness
bc80f741981cade3e4e3d65df709c24f31556c06  refs/heads/docs/hk-face-c1-v7-review-fixes
282a20fca9f64ab80ead50372c9c3e90bf4aeba7  refs/heads/main

$ git merge-base --is-ancestor origin/main HEAD; echo $LASTEXITCODE
EXIT 0

$ git merge-base --is-ancestor origin/docs/hk-face-c1-epoch-uniqueness HEAD; echo $LASTEXITCODE
EXIT 0

$ git rev-list --left-right --count origin/main...HEAD
EXIT 0
0       145
```

### 9.2 零代码差异/doc 身份

```text
$ git diff --stat 5dff386fe5c9648b04d1623d3e1898c59332639e..HEAD -- . ':(exclude)docs'
EXIT 0
（空）

$ git diff --name-only 5dff386fe5c9648b04d1623d3e1898c59332639e..HEAD -- . ':(exclude)docs'
EXIT 0
（空）

$ git diff --stat 5dff386fe5c9648b04d1623d3e1898c59332639e..HEAD
EXIT 0
 ...4-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md | 1607 ++++++++++++++++++++
 .../HK-AI-04-H4C-C1-REFS-ERRATUM-2026-11-19.md     |  384 +++++
 ...-AI-04-H4C-C1-S0-S1-AUTHORIZATION-2026-11-19.md |  616 ++++++++
 ...H4C-C1-STAGED-IMPLEMENTATION-TASK-2026-11-18.md  |  995 +++++++++++++
 4 files changed, 3602 insertions(+)

$ git hash-object docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md
EXIT 0
c4feffa5831f5bf0e04e8e902865cb8e1f1b0183

$ (Get-FileHash -Algorithm SHA256 docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md).Hash.ToLower()
EXIT 0
d769da93c4880409c946e316f2414ca6b1135a96361934abc188111ca6dcbec7

$ (Get-Content docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md).Count
EXIT 0
1607

$ git rev-parse 'ed6f862...:admin-web/lib/face-service/h4c-evidence.mjs'
EXIT 0
5c94debdf87d5134bb050ed9470daa52ccee080f

$ git rev-parse 'ed6f862...:admin-web/lib/face-service/index.mjs'
EXIT 0
53c1ef86aef1dd7ffe7db805f6d9ab02713a516a

$ git rev-parse 'ed6f862...:admin-web/lib/store.mjs'
EXIT 0
f99e9996ebbeee17f2599060765f707d3840671a

$ git rev-parse 'ed6f862...:admin-web/tests/face-h4c-evidence.test.mjs'
EXIT 0
14478acf80ea6b5127dbc187dff8125712de275f
```

- 说明：以上 `ed6f862...` 为完整 40 位 SHA 的缩写展示；实际命令使用完整 `ed6f862dac5307b0f027a83570fd8a0cb8da1a09`。

### 9.3 测试盘点/静态扫描

```text
$ (Get-ChildItem admin-web/tests -Filter *.test.mjs).Count
EXIT 0
41

HTTP 8 个文件（显式清单）全部存在；`.listen(` 命中（`[regex]::Matches(...,'\.listen\(')`）：
blacklist-http.test.mjs=1, occupancy-http.test.mjs=1, server.test.mjs=1,
server-face.test.mjs=1, server-face-bounds.test.mjs=1, server-files.test.mjs=2,
server-v2.test.mjs=1, verification-http.test.mjs=1；合计 9 次 / 8 文件。

非 HTTP 33 个文件 `.listen(` 命中合计：0
根 `tests/*.test.cjs` 7 个文件 `.listen(` 命中合计：0

$ (Get-Content admin-web/tests/face-h4c-evidence.test.mjs).Count
EXIT 0
1342

顶层 `^\s*test\(` 命中：31
`\.listen\(` 命中：0
`fetch(` 命中：0

$ Test-Path admin-web/lib/h4c-collections.mjs
EXIT 0
False

$ (Select-String -Path admin-web/lib/face-service/h4c-evidence.mjs -Pattern '^export ').Count
EXIT 0
26

index.mjs 显式 re-export 名单 = 26 个同名导出（5 个 `export *` + 显式 26 名单）
```

### 9.4 云材料路径核对

```text
C:\workspace\artifacts\RENTAL-S1-AUTH-REVIEW-2026-11-19\PARALLEL-DISPATCH.md => False
C:\workspace\artifacts\RENTAL-S1-AUTH-REVIEW-2026-11-19\REVIEW.md => False
/workspace/artifacts/RENTAL-S1-AUTH-REVIEW-2026-11-19/PARALLEL-DISPATCH.md => False
/workspace/artifacts/RENTAL-S1-AUTH-REVIEW-2026-11-19/REVIEW.md => False
D:–L:\workspace\artifacts\RENTAL-S1-AUTH-REVIEW-2026-11-19 => 均 False
wsl.exe => 不可用
.tmp 各工作树/仓库内按文件名搜索 => 无命中
```

### 9.5 提交前自检（S0 提交时补记）

- `git diff --check` exit 0；`git show --check` exit 0。
- `git status --porcelain` 仅含本证据文件（新增，`?? docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-EVIDENCE-2026-11-19.md`）。
- 提交为 docs-only 普通追加；不改写历史；不 amend/rebase/reset/squash/force/merge/cherry-pick。
- 最终提交 SHA/父 SHA/push 后 `ls-remote` 完整 40 位 SHA 由交付回报给出；本文件不自我引用最终 SHA。

## 10. 明确未做/未验证（S0）

- 未实现任何 C1 代码；未新建 `h4c-collections.mjs`；未改 `h4c-evidence.mjs`/`index.mjs`/`store.mjs`/测试。
- **未运行任何测试**；未执行 guard 负控/正控/子进程；未安装依赖；未启动服务。
- 未访问真实 Cloud/K3/设备/Provider/支付/业务网络；未启动 HTTP/UI；未部署。
- 未取得云 `PARALLEL-DISPATCH.md`/`REVIEW.md` 正文；九项裁定列未知；不声称已读/闭合。
- 未验证 D4a/D4b/D5 的代码/测试实现；只记录已批准契约与验收矩阵；**不声称运行已通过**。
- 未把环境可用（路径存在、命令可执行、工作树可写）当作业务验收。
- S1 未开始；S2–S6/C2/C3/迁移生产写不在本轮范围；本文件不自批、不宣称 C1/G1 通过、不授权合并。
