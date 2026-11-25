# CF-R2-11 / CF-R2-12 第二轮退修证据（2026-11-25）

- 固定起点：`30f044f9f3e034a55b0e9d9ba4b9d80633ceed1b`（父 `a5eb5ae90b6f6b77e485e4df61d2f1b4366464e8`，再父 `72fe242556aea604473281dc52b45837155fa43a`）
- 独立 worktree：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\SMART-PM-H3\_rework-r2`，分支 `fix/checkin-face-codex-r2-2026-11-24`（续原树，未移动/清理任何其他工作树）
- 执行者：Harness lead（run `hrun-mwvkw573-20c3ee` / session `session-039bc489-353a-4ec6-86f9-ec8f5b1bd17e`）；同目标无 running/queued（四路会话空闲未动）；AGENTS.md 仓库不存在
- 环境：Node v24.19.0 win32 x64；全部合成验证；零真实 socket/listen/DNS/HTTP 请求

## 改动文件（仅本任务范围）

| 文件 | 变更 |
|---|---|
| `scripts/checkin-face-static-check.mjs` | CF11 第二轮：统一 lexer/识别器——运算符按完整 token 词法化（含 `>>>= <<= >>= >>> === !== => &&= ||= ??= += -= *= /= %= **= &= |= ^= == != <= >= ++ -- && || ?? ** << >>`），识别器覆盖全部逻辑/复合/位/移位赋值、前后缀 ++/--、点访问与静态字符串下标、解构赋值、Object.assign/defineProperty(request,…)；regexPosition 同步扩展；受限语法无法证明时失败关闭 |
| `tests/support/d-network-guard.cjs` | CF12 第二轮：v4。去除全局 canaryWindow 计数盲区——拦截一律计数；正控委托的内部拦截按「可归因增量」逐槽核算（selfTest/internalBlocked、originalCanary/attributableInternalBlocked）；新增 `capturedTargets()`（实际捕获目标身份）与 `invokeWrapper(name)`（过 wrapper 调用通道） |
| `tests/support/d-network-fakes.cjs` | 新增：安装守卫前注入的安全可计数 fake 注入器（纯内存计数，含构造器 prototype/别名与 ESM 约束所需形状；不装 EventSource——真实环境非函数、守卫不建槽） |
| `tests/support/r2-vm-scenario.cjs` | 新增：VM 场景夹具（捕获身份逐槽断言、正控 +1、过 wrapper 零增长、99 槽期望/覆盖/缺失集合相等断言、缺陷注入转发计数检测） |
| `tests/checkin-face-qa-gates.test.cjs` | 新增 CF11 第二轮 14 负例+1 正例；CF12 第二轮 VM 11 用例（真实环境 99 槽相等、VM 干净场景、7 入口族缺陷注入、继承正/负控） |
| `docs/checkin-face-experience-source-hashes.json` | 复算 3 文件哈希 + 登记 2 个新 support 文件（131→130 条：qa-gates 复算后去重独立测试文件登记）；未动其余条目 |

## 聚焦命令与实测结果（原始输出见本目录，全部实际数字）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node scripts/checkin-face-static-check.mjs` | 0 | 102 source files / 0 violations |
| `node scripts/verify-checkin-face-sources.mjs` | 0 | 130 entries hash-verified |
| `npm.cmd run check:checkin-face` | 0 | 静态 && 来源校验 |
| `node --require tests/support/d-network-guard.cjs --test tests/checkin-face-qa-gates.test.cjs` | 0 | **54/54 pass**（含全部第二轮用例） |
| `node --require …d-network-guard.cjs --test tests/checkin-face-api.test.cjs tests/checkin-face-pages.test.cjs tests/checkin-face-cloud-workflow.test.cjs admin-web/tests/checkin-face-config.test.mjs admin-web/tests/checkin-face-worker.test.mjs` | 0 | **113/113 pass** |
| VM 干净场景（fakes→guard→scenario） | 0 | 99 槽：捕获身份全等、正控 +1 全过、过 wrapper 零增长全覆盖、selfTest internalBlocked=0、ESM 绑定 48/48 |
| VM 缺陷注入（net 族样例） | 2 | `FORWARDING_DETECTED: net.connect countDelta=1`（转发计数拒绝，非加载/语法错误） |

## CF-R2-11 第二轮逐例证据（真实 request 作用域、`return request;` 之前注入）

| 例 | 注入 | 退出码 | 命中断言 |
|---|---|---|---|
| &&= | `request.mode &&= "simulation";`（device→simulation） | 1 | `request 构造后不得再赋值/更新覆盖…（CF-R2-11）` |
| \|\|= | `request.mode \|\|= "simulation";` | 1 | 同上 |
| ??= | `request.mode ??= "simulation";` | 1 | 同上 |
| += | `request.mode += "-x";` | 1 | 同上 |
| %= | `request.mode %= "x";` | 1 | 同上 |
| **= | `request.mode **= "x";` | 1 | 同上 |
| \|= | `request.mode \|= 1;` | 1 | 同上 |
| <<= | `request.mode <<= 1;` | 1 | 同上 |
| 后缀++ | `request.mode++;` | 1 | 同上 |
| 前缀++ | `++request.mode;` | 1 | 同上 |
| 下标= | `request["mode"] = "simulation";` | 1 | 同上 |
| 下标+= | `request["mode"] += "-x";` | 1 | 同上 |
| 解构 | `[request.mode] = ["simulation"];` | 1 | 同上 |
| Object.assign | `Object.assign(request, { mode: "simulation" });` | 1 | 同上 |
| 正例1 | 未变更副本 | 0 | 0 violations |
| 正例2 | 注入 `request.planTemplateNo = "T-1"; request.photoPath = …` | 0 | 0 violations（合法字段不误伤） |

第一轮已通过的 getter/method/普通= 三负例与字面量正例全部保留并继续通过（qa-gates 54/54 内含）。

## CF-R2-12 第二轮逐项证据

- **VM 干净场景（安装守卫前注入 fake，再加载未改守卫）**：99 槽逐槽——`capturedTargets()[name].target === fakes.target(name)`（捕获=安装目标，0 失配）；正控直接调用安装目标计数 +1（0 失败）；`invokeWrapper` 每槽抛 `D_NETWORK_GUARD_BLOCKED` 且外部目标计数零增长（0 未覆盖、0 转发）；期望清单/覆盖集合/捕获集合三方相等（无缺失无多余）；selfTest `internalBlocked=0`、`blockedDelta=patchedCount`；ESM 绑定 48 槽全指向 wrapper。
- **缺陷注入负控（7 入口族：net/tls/http/https/dgram/dns/globalThis）**：守卫临时副本让 wrapper 先 `record.original.apply(this, args)` 再抛拦截错误——每族均以 **exit 2 + `FORWARDING_DETECTED: <label> countDelta=1`** 拒绝；失败原因仅为转发计数，非模块加载/语法错误；未改守卫正例通过。
- **子进程继承**：NODE_OPTIONS 继承（fakes→guard）正控 exit 0；继承+缺陷守卫负控 exit 2 + `FORWARDING_DETECTED: net.connect countDelta=1`。
- **canaryWindow 盲区去除**：拦截一律计数；正控委托期间的内部拦截按可归因增量核算并暴露（真实模块环境 selfTest internalBlocked=3 精确归因于 net.connect/net.createConnection/tls.connect 正控的内部命中；fake 环境下为 0）；计数与加载期基线不清零。
- 原 11 个 BLOCKED 槽（4×listen、dgram bind、dns.lookupService、dns.promises.lookup、2×Resolver.reverse、2×Resolver 构造器）全部纳入 VM 逐槽控制：捕获身份/正控/过 wrapper 零增长全部通过——合成证据闭合；真实网络委托仍禁止且不冒充。

## 未验证项 / 边界（如实，不追认历史）

- 真实网络转发、真实 socket/listen/DNS/HTTP 从未执行；合成不转发证据 ≠ 真实网络实测，边界保留。
- 真实设备/云/微信开发者工具/体验版上传继续冻结。
- 上一轮 README 中的「115 条」为当时历史计数，本轮实际为 130 条（见上表），不混用历史数。

## 关键哈希（改动文件，清单内）

- `scripts/checkin-face-static-check.mjs` → `a8c3ff11accd…`
- `tests/support/d-network-guard.cjs` → `702a1bfa928a…`
- `tests/checkin-face-qa-gates.test.cjs` → `b87955fc36c7…`
- `tests/support/d-network-fakes.cjs` → 清单登记
- `tests/support/r2-vm-scenario.cjs` → 清单登记
