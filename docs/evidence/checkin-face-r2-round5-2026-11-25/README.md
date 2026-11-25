# CF-R2-11 第五轮退修证据（2026-11-25）—— 逗号/序列表达式基对象

- 固定输入：`98aebbf6103eac2baa75844c558edfe9f3ec98b0`（父 `c737a04021d9fc22c170edce4fe2cfe8a5e0a57c`，再父 `709a107fdf29e4b49c9acb99a024dd9e5855743c`；实测精确）
- 独立 worktree：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\SMART-PM-H3\_rework-r2`，分支 `fix/checkin-face-codex-r2-2026-11-24`（续原树，未移动/清理任何其他工作树或无关文件）
- 执行者：Harness lead（run `hrun-mwvmlkrq-7f9c92` / session `session-039bc489-353a-4ec6-86f9-ec8f5b1bd17e`）；同目标无 queued/running；AGENTS.md 仓库不存在
- 冻结契约口径：构造后硬字段覆盖不得被门禁放行；受限语法无法证明安全时失败关闭，不再以「登记边界后 exit 0」处理

## 改动文件（仅本任务范围）

| 文件 | 变更 |
|---|---|
| `scripts/checkin-face-static-check.mjs` | isHardMemberViaSequence 新增：序列表达式基对象归一化——`request` 前紧邻 `,`、向左找到同层分组 `(`（非调用括号：其前不是被调用者）、其后为 `)` 串 + 点/静态字符串下标的硬字段成员即拒绝；多层括号/嵌套序列自动覆盖；只读上下文不受影响（该识别仅用于赋值左值收集范围）；containsHardMember 同时调用括号基与序列基两个识别器 |
| `tests/checkin-face-qa-gates.test.cjs` | 新增第五轮 7 负例 + 1 纯内存行为证明（3 例）+ 3 合法正例；既有 34 项 CF11 回归全部保留 |
| `docs/checkin-face-experience-source-hashes.json` | 仅复算上述 2 文件条目哈希（167 条总数不变） |

## 聚焦命令与实测结果（原始输出见本目录）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node scripts/checkin-face-static-check.mjs` | 0 | 102 source files / 0 violations（正常构造不误伤） |
| `node scripts/verify-checkin-face-sources.mjs` | 0 | **167 entries** hash-verified |
| `npm.cmd run check:checkin-face` | 0 | 静态 && 来源校验 |
| `node --require …d-network-guard.cjs --test --test-name-pattern=CF-R2-11 tests/checkin-face-qa-gates.test.cjs` | 0 | **43/43 pass** |
| `node --require …d-network-guard.cjs --test tests/checkin-face-qa-gates.test.cjs` | 0 | **78/78 pass**（全部保留用例） |

## CF-R2-11 第五轮逐例证据（真实 request 作用域、`return request;` 前注入；每例先 `node --check` 语法合法）

| 例 | 注入 | node --check | 门禁退出码 | 命中断言 |
|---|---|---|---|---|
| 负例1 序列+点（复审例1） | `(0, request).mode = "simulation";` | 0 | 1 | `request 构造后不得再赋值/更新覆盖…（CF-R2-11）` |
| 负例2 序列+下标（复审例2） | `((0, request))["mode"] = "simulation";` | 0 | 1 | 同上 |
| 负例3 序列+数组多目标（复审例3） | `[(0, request).mode, request.photoPath] = ["simulation", "x"];` | 0 | 1 | 同上 |
| 负例4 嵌套序列 | `((a, (b, request))).mode = "simulation";` | 0 | 1 | 同上 |
| 负例5 序列+逻辑赋值 | `((0, request)).mode ||= "simulation";` | 0 | 1 | 同上 |
| 负例6 序列+更新 | `((0, request))["mode"]++;` | 0 | 1 | 同上 |
| 负例7 序列+嵌套解构 | `[ { a: (0, request).mode } ] = [ { a: "simulation" } ];` | 0 | 1 | 同上 |
| 纯内存行为证明 | 复审 3 例逐例以 `const request = { mode: "device", … }; <注入>;` 运行 | — | — | 每例实测 `request.mode === "simulation"`（无业务/网络） |
| 正例1 | `(0, request).photoPath = "C:\tmp\p.jpg";` | 0 | 0 | 0 violations（合法字段可证明安全） |
| 正例2 | `((0, request))["planTemplateNo"] = "T-1";` | 0 | 0 | 0 violations |
| 正例3 | `[(0, request).photoPath, request.planTemplateNo] = ["…", "T-1"];` | 0 | 0 | 0 violations（仅合法字段解构不误伤） |

调用括号不误判：`foo(0, request).mode = …` 形式（`(` 前为被调用者）不识别为序列基对象——语义上写入 `foo(...).mode` 而非 request.mode，且只读上下文永不进入该识别（识别仅作用于赋值左值收集范围）。既有 34 项 CF11 回归（括号基对象、完整左值/解构、逻辑/复合/位/移位赋值、前后缀更新、静态下标、Object.assign、getter/method/普通=）与正常构造/合法字段正例全部保留（78/78 内含）。

## 未验证项 / 边界（如实，不再以边界放行）

- 未运行原生网络 canary、完整 69/78 之外套件、旧 113/246 或无关全量；未安装依赖；未执行任何业务/网络/设备操作。
- 动态计算属性（`request[dynamicKey] = …`）等运行时键形式：静态无法证明键值，按冻结契约失败关闭方向保留既有语义（构造内 computed 失败关闭），未扩大规则授权；本环境未实现通用 JS 解释器，如实记录。
- 上传/部署/发布/设备/HTTP-UI/真实支付/生产云继续冻结；CR-2/门禁诊断未打断。

## 关键哈希（清单内，blob 归一同校验器）

- `scripts/checkin-face-static-check.mjs` → `605c3a0de1b8…`
- `tests/checkin-face-qa-gates.test.cjs` → `39901dd7aa9b…`
