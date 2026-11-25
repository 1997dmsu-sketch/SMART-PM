# CF-R2-11 第六轮退修证据（2026-11-25）—— 序列前项条件/箭头导致扫描提前终止

- 固定输入：`65fa29978fd2150e95789ee8e8681f3f19468d16`（父 `4480da05f77e0a2a6483d89dbf86fadd4ff8bbb8`，再父 `98aebbf6103eac2baa75844c558edfe9f3ec98b0`；实测精确）
- 独立 worktree：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\SMART-PM-H3\_rework-r2`，分支 `fix/checkin-face-codex-r2-2026-11-24`（续原树，未移动/清理任何其他工作树或用户文件）
- 执行者：Harness lead（run `hrun-mwvmurah-e5eec3` / session `session-039bc489-353a-4ec6-86f9-ec8f5b1bd17e`）；同目标无 queued/running；AGENTS.md 仓库不存在
- 本轮仅 CF-R2-11 一处 P2：序列前项合法包含 `:`/`=>` 等 token，扫描不得因此提前终止

## 改动文件（仅本任务范围）

| 文件 | 变更 |
|---|---|
| `scripts/checkin-face-static-check.mjs` | isHardMemberViaSequence 的后向扫描改为**按匹配分隔符**确定完整序列基对象分组：前项允许 `:`、`=>`、`?` 等一切合法表达式 token（三元条件/箭头函数不改变末值为 request），仅语句边界（`;`/`{`/`}`）或词法开头终止扫描；分组括号与调用括号区分、只读上下文不误伤、完整左值收集全部保留；不再以局部 token 枚举提前放行 |
| `tests/checkin-face-qa-gates.test.cjs` | 新增第六轮 6 负例 + 1 纯内存行为证明（2 例）+ 3 正例（含序列只读正例）；既有 43 项 CF11 回归全部保留 |
| `docs/checkin-face-experience-source-hashes.json` | 仅复算上述 2 文件条目哈希（178 条总数不变） |

## 聚焦命令与实测结果（原始输出见本目录）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node scripts/checkin-face-static-check.mjs` | 0 | 102 source files / 0 violations（正常构造不误伤） |
| `node scripts/verify-checkin-face-sources.mjs` | 0 | **178 entries** hash-verified |
| `npm.cmd run check:checkin-face` | 0 | 静态 && 来源校验 |
| `node --require …d-network-guard.cjs --test --test-name-pattern=CF-R2-11 tests/checkin-face-qa-gates.test.cjs` | 0 | **51/51 pass** |
| `node --require …d-network-guard.cjs --test tests/checkin-face-qa-gates.test.cjs` | 0 | **86/86 pass**（全部保留用例） |

## CF-R2-11 第六轮逐例证据（真实 request 作用域、`return request;` 前注入；每例先 `node --check` 语法合法）

| 例 | 注入 | node --check | 门禁退出码 | 命中断言 |
|---|---|---|---|---|
| 负例1 序列前项三元（复审例1） | `(true ? 0 : 1, request).mode = "simulation";` | 0 | 1 | `request 构造后不得再赋值/更新覆盖…（CF-R2-11）` |
| 负例2 序列前项箭头（复审例2） | `(() => 0, request).mode = "simulation";` | 0 | 1 | 同上 |
| 负例3 三元+下标 | `((true ? 0 : 1, request))["mode"] = "simulation";` | 0 | 1 | 同上 |
| 负例4 箭头+数组多目标 | `[(() => 0, request).mode, request.photoPath] = ["simulation", "x"];` | 0 | 1 | 同上 |
| 负例5 三元+嵌套解构 | `[ { a: (true ? 0 : 1, request).mode } ] = [ { a: "simulation" } ];` | 0 | 1 | 同上 |
| 负例6 箭头+逻辑赋值 | `((() => 0, request)).mode ||= "simulation";` | 0 | 1 | 同上 |
| 纯内存行为证明 | 复审 2 例逐例以 `const request = { mode: "device", … }; <注入>;` 运行 | — | — | 每例实测 `request.mode === "simulation"`（箭头仅创建未调用，无业务/网络） |
| 正例1 三元头+合法字段 | `(true ? 0 : 1, request).photoPath = "C:\tmp\p.jpg";` | 0 | 0 | 0 violations |
| 正例2 箭头头+合法字段 | `(() => 0, request)["planTemplateNo"] = "T-1";` | 0 | 0 | 0 violations |
| 正例3 序列只读 | `const okPath = (() => 0, request).photoPath || "";` | 0 | 0 | 0 violations（只读不误伤） |

既有 43 项 CF11 回归（简单/嵌套序列、括号基对象、完整左值/解构、逻辑/复合/位/移位赋值、前后缀更新、静态下标、Object.assign、getter/method/普通=）与正常构造/合法字段正例全部保留（86/86 内含）。

## 未验证项 / 边界（如实）

- 未运行原生网络 canary、完整 78/86 之外套件、旧 113/246 或无关全量；未安装依赖；未执行任何业务/网络/设备操作。
- 动态计算属性等运行时键形式仍按冻结契约失败关闭方向处理（构造内 computed 失败关闭），未扩大规则授权；本环境未实现通用 JS 解释器，如实记录。
- 上传/部署/发布/设备/HTTP-UI/真实支付/生产云继续冻结；CR-2/门禁诊断未打断。

## 关键哈希（清单内，blob 归一同校验器）

- `scripts/checkin-face-static-check.mjs` → `ddfa9d85ba62…`
- `tests/checkin-face-qa-gates.test.cjs` → `687df84c4f87…`
