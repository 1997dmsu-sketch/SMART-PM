# CF-R2-11 第四轮退修证据（2026-11-25）—— 括号基对象绕过

- 固定输入：`709a107fdf29e4b49c9acb99a024dd9e5855743c`（父 `ef43cca19017d5b70845f3186b8a040835f45f49`，再父 `10963ddb0d62bb168ecf81a6cf03b909107a5f3c`；实测精确）
- 独立 worktree：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\SMART-PM-H3\_rework-r2`，分支 `fix/checkin-face-codex-r2-2026-11-24`（续原树，未动其他工作树/未跟踪文件）
- 执行者：Harness lead（run `hrun-mwvmaee7-7cb623` / session `session-039bc489-353a-4ec6-86f9-ec8f5b1bd17e`）；同目标无 queued/running；AGENTS.md 仓库不存在
- 本轮仅 CF-R2-11 括号基对象一项 P2；CF12 guard/fakes/scenario 及测试/证据完全未动

## 改动文件（仅本任务范围）

| 文件 | 变更 |
|---|---|
| `scripts/checkin-face-static-check.mjs` | isHardMember 增加括号基对象归一化：`(...((request))...).key` 与 `[...]` 形式（基对象前紧邻 `(` 串 ≥1、后为 `)` 串 + 成员操作符）递归识别为 request 硬字段成员；经典直连与静态字符串下标保留；上轮完整左值收集不变 |
| `tests/checkin-face-qa-gates.test.cjs` | 新增第四轮 6 负例 + 1 纯内存行为证明（3 例）+ 3 合法正例；既有 26 项 CF11 回归全部保留 |
| `docs/checkin-face-experience-source-hashes.json` | 仅复算上述 2 文件条目哈希（156 条总数不变） |

## 聚焦命令与实测结果（原始输出见本目录）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node scripts/checkin-face-static-check.mjs` | 0 | 102 source files / 0 violations（正常构造不误伤） |
| `node scripts/verify-checkin-face-sources.mjs` | 0 | **156 entries** hash-verified |
| `npm.cmd run check:checkin-face` | 0 | 静态 && 来源校验 |
| `node --require …d-network-guard.cjs --test --test-name-pattern=CF-R2-11 tests/checkin-face-qa-gates.test.cjs` | 0 | **34/34 pass** |
| `node --require …d-network-guard.cjs --test tests/checkin-face-qa-gates.test.cjs` | 0 | **69/69 pass**（全部保留用例） |

## CF-R2-11 第四轮逐例证据（真实 request 作用域、`return request;` 前注入；每例先 `node --check` 语法合法）

| 例 | 注入 | node --check | 门禁退出码 | 命中断言 |
|---|---|---|---|---|
| 负例1 括号基+点（复审例1） | `(request).mode = "simulation";` | 0 | 1 | `request 构造后不得再赋值/更新覆盖…（CF-R2-11）` |
| 负例2 多层括号基+下标（复审例2） | `((request))["mode"] = "simulation";` | 0 | 1 | 同上 |
| 负例3 数组多目标+括号基（复审例3） | `[(request).mode, request.photoPath] = ["simulation", "x"];` | 0 | 1 | 同上 |
| 负例4 多层括号基+逻辑赋值 | `((request)).mode &&= "simulation";` | 0 | 1 | 同上 |
| 负例5 多层括号基+更新 | `(((request)))["mode"]++;` | 0 | 1 | 同上 |
| 负例6 嵌套对象解构+括号基 | `[ { a: (request).mode } ] = [ { a: "simulation" } ];` | 0 | 1 | 同上 |
| 纯内存行为证明 | 上述复审 3 例逐例以 `const request = { mode: "device", … }; <注入>;` 运行 | — | — | 每例实测 `request.mode === "simulation"`（证明确为语义覆盖，无业务/网络） |
| 正例1 | `(request).photoPath = "C:\tmp\p.jpg";` | 0 | 0 | 0 violations |
| 正例2 | `((request))["planTemplateNo"] = "T-1";` | 0 | 0 | 0 violations |
| 正例3 | `[(request).photoPath, (request).planTemplateNo] = ["…", "T-1"];` | 0 | 0 | 0 violations（仅合法字段不误伤） |

既有 26 项 CF11 回归（逻辑/复合/位/移位赋值、前后缀更新、静态下标、单目标/多目标/嵌套解构、括号目标、Object.assign、getter/method/普通=）与正常构造/合法字段正例全部保留（69/69 内含）。

## 未验证项 / 边界（如实）

- 逗号表达式基对象（如 `(x, request).mode = …`）属本环境受限语法的静态分析边界：不在本轮要求的三例形态内，现有门禁按既有语义处理，未扩大规则授权；如实记录。
- 未运行原生网络 canary、完整 61/69 之外套件、旧 113/246 或无关全量；未安装依赖；未执行任何业务/网络/设备操作。
- 上传/部署/发布/设备/HTTP-UI/真实支付/生产云继续冻结；CR-2/门禁诊断未打断。

## 关键哈希（清单内，blob 归一同校验器）

- `scripts/checkin-face-static-check.mjs` → `352904c6ba20…`
- `tests/checkin-face-qa-gates.test.cjs` → `ad678265b0c5…`
