# CF-R2-11 第三轮退修证据（2026-11-25）—— 最后两种左值绕过

- 固定起点：`10963ddb0d62bb168ecf81a6cf03b909107a5f3c`（父 `9599ab43d2e9ebd680e031982ecb8cad11e18b2f`，再父 `30f044f9f3e034a55b0e9d9ba4b9d80633ceed1b`；实测精确）
- 独立 worktree：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\SMART-PM-H3\_rework-r2`，分支 `fix/checkin-face-codex-r2-2026-11-24`（续原树）
- 执行者：Harness lead（run `hrun-mwvlmw0x-7a5179` / session `session-039bc489-353a-4ec6-86f9-ec8f5b1bd17e`）；同目标无 running/queued；AGENTS.md 仓库不存在
- CF12 已由独立 Codex 确认通过（99 槽捕获身份/正控/拦截、逐槽转发缺陷检测），本轮**不重开、不改 guard/fakes/scenario 或其证据**

## 改动文件（仅本任务范围）

| 文件 | 变更 |
|---|---|
| `scripts/checkin-face-static-check.mjs` | CF11 第三轮：由「固定相邻 token」改为「完整赋值左值/解构目标」识别——从每个赋值/更新运算符反向（前缀更新正向）收集完整左值（括号多层、数组/对象多目标、嵌套解构整体），其中出现 request.mode/validityMode/consent（点访问或静态字符串下标）即拒绝；语句/声明边界终止；受限语法失败关闭；Object.assign/defineProperty 检测保留 |
| `tests/checkin-face-qa-gates.test.cjs` | 新增 CF11 第三轮 6 负例+1 正例（每负例先 `node --check` 证明语法合法再断言门禁 exit 1 命中专属消息）；既有 22 个负控与正例保留 |
| `docs/checkin-face-experience-source-hashes.json` | 仅复算上述 2 文件条目哈希（145 条总数不变） |

## 聚焦命令与实测结果（原始输出见本目录）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node scripts/checkin-face-static-check.mjs` | 0 | 102 source files / 0 violations（真实树正例） |
| `node scripts/verify-checkin-face-sources.mjs` | 0 | **145 entries** hash-verified |
| `npm.cmd run check:checkin-face` | 0 | 静态 && 来源校验 |
| `node --require …d-network-guard.cjs --test --test-name-pattern=CF-R2-11 tests/checkin-face-qa-gates.test.cjs` | 0 | **26/26 pass**（含第三轮 7 用例） |
| `node --require …d-network-guard.cjs --test tests/checkin-face-qa-gates.test.cjs` | 0 | **61/61 pass**（全部保留用例） |

> 计数说明：本目录与校验器均为实际值 **145 条**；上一轮证据 README 中「130」为该轮当时的清单总数，属历史记录差异，不据此修改旧证据。

## CF-R2-11 第三轮逐例证据（真实 request 作用域、`return request;` 之前注入；每例先 `node --check` 语法合法）

| 例 | 注入 | node --check | 门禁退出码 | 命中断言 |
|---|---|---|---|---|
| 负例1 括号目标 | `(request.mode) = "simulation";` | 0 | 1 | `request 构造后不得再赋值/更新覆盖…（CF-R2-11）` |
| 负例2 多层括号 | `((request.mode)) = "simulation";` | 0 | 1 | 同上 |
| 负例3 数组多目标（复审指定例） | `[request.mode, request.photoPath] = ["simulation", "x"];` | 0 | 1 | 同上 |
| 负例4 数组多目标（硬字段居后） | `[request.photoPath, request.mode] = ["x", "simulation"];` | 0 | 1 | 同上 |
| 负例5 数组+下标目标 | `[request["mode"]] = ["simulation"];` | 0 | 1 | 同上 |
| 负例6 嵌套对象解构 | `({ a: { b: request.mode } } = { a: { b: "simulation" } });` | 0 | 1 | 同上 |
| 正例 | `[request.planTemplateNo, request.photoPath] = ["T-1", "C:\tmp\p.jpg"];` | 0 | 0 | 0 violations（仅合法字段解构不误伤） |

既有 22 个负控（逻辑/复合/位/移位赋值、前后缀更新、静态下标、单目标解构、Object.assign、getter/method/普通=）与正常构造/合法字段赋值正例全部保留并继续通过（61/61 内含）。

## 未验证项 / 边界（如实）

- 未运行原生网络 canary、旧 246、旧 113 全套或无关全量；未安装依赖。
- 上传/部署/发布/设备/HTTP-UI/真实支付/生产云继续冻结；CR-2/门禁诊断未打断。
- 受限语法（如动态计算属性 `request[dynamicKey]` 赋值）不在硬字段静态识别范围内：点访问/静态字符串下标之外的形式保持既有门禁语义，动态 key 无法静态证明安全的场景由既有「构造内 computed 失败关闭」与人工复审覆盖；本轮不扩大业务行为。

## 关键哈希（清单内，blob 归一同校验器）

- `scripts/checkin-face-static-check.mjs` → `2651e312573c…`
- `tests/checkin-face-qa-gates.test.cjs` → `a4e520b6b0ee…`
