# CF-R2-11 / CF-R2-12 最小退修证据（2026-11-25）

- 输入固定 SHA：`72fe242556aea604473281dc52b45837155fa43a`（父 `5398d1e06769dc1be7e0c81e060084d412ae0665`）
- 独立退修 worktree：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\SMART-PM-H3\_rework-r2`，分支 `fix/checkin-face-codex-r2-2026-11-24`
- 执行者：Harness lead（run `hrun-mwvjtudn-f65d15` / session `session-039bc489-353a-4ec6-86f9-ec8f5b1bd17e`）；AGENTS.md：仓库无此文件（72fe242 全树与历史均无）
- 环境：Node v24.19.0 win32 x64；全部合成验证，未建立真实业务网络/监听/设备连接

## 改动文件（仅本任务范围）

| 文件 | 变更 |
|---|---|
| `scripts/checkin-face-static-check.mjs` | CF-R2-11：构造内同名 getter/method/重复字段覆盖识别 + 构造后 request.mode/validityMode/consent 赋值识别（点/下标两种形态）；门禁要求与业务行为不变 |
| `tests/support/d-network-guard.cjs` | CF-R2-12：v3。与 record.original 相连的计数 spy（先计数再委托）、originalInvoked 入快照且加载期基线不清零、逐槽实测安全快速失败参数表、不可安全委托槽显式 BLOCKED、正控窗口（窗口内内部拦截照常抛错但不计数）、restore 逆序+finally 恢复证据 |
| `tests/checkin-face-qa-gates.test.cjs` | 新增 CF-R2-11 三负例一正例 + CF-R2-12 正控/负控/顺序恢复/子进程继承 3 用例（28/28 全过） |
| `docs/checkin-face-experience-source-hashes.json` | 仅复算上述 3 文件条目哈希（115 条总数不变） |

## 聚焦命令与实测结果（原始输出见本目录）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node scripts/checkin-face-static-check.mjs` | 0 | 102 源文件 / 0 violations（正例） |
| `node scripts/verify-checkin-face-sources.mjs` | 0 | 115 entries hash-verified |
| `npm.cmd run check:checkin-face` | 0 | 静态 && 来源校验 |
| `node --require tests/support/d-network-guard.cjs --test tests/checkin-face-api.test.cjs tests/checkin-face-pages.test.cjs tests/checkin-face-cloud-workflow.test.cjs admin-web/tests/checkin-face-config.test.mjs admin-web/tests/checkin-face-worker.test.mjs` | 0 | **113/113 pass** |
| `node --require …d-network-guard.cjs --test tests/checkin-face-qa-gates.test.cjs` | 0 | **28/28 pass**（含 CF-R2-11/12 全部新用例） |
| `node --test tests/checkin-face-qa-gates.test.cjs`（原始/降级分列） | 1 | before() 快速失败（守卫未预载），降级证据如实保留 |

## CF-R2-11 逐例证据（输入→命令→结果，聚焦测试内 spawn 最小静态树副本）

| 例 | 输入（worker-runtime 副本变更） | 命令 | 实际结果 |
|---|---|---|---|
| 负例1 同名 getter | `consent: true,` 后追加 `get mode() { return "simulation"; },` | 副本内 `node scripts/checkin-face-static-check.mjs` | exit 1，命中「request 硬要求字段不得被同名 getter/method/重复字段覆盖或扩展（CF-R2-11）」 |
| 负例2 同名 method | 追加 `mode() { return "simulation"; },` | 同上 | exit 1，命中同上消息 |
| 负例3 构造后覆盖 | 文件尾追加 `request.mode = "simulation";` | 同上 | exit 1，命中「request 构造后不得再赋值覆盖 mode/validityMode/consent（CF-R2-11）」 |
| 正例 | 未变更副本 | 同上 | exit 0，「0 violations」 |

真实文件对照：worker-runtime 中合法的 `request.planTemplateNo = …`、`request.photoPath = …` 赋值不受影响（检测按键限定），真实树正例 exit 0。

## CF-R2-12 逐项证据

- **原目标相连 canary 正控**：88 个槽以与 `record.original` 相连的 spy 完成正控（spy 计数 +1 后委托真实原函数，原函数按逐槽实测的「安全快速失败参数」在自身校验处快速失败/无害返回；全部 `originalInvokedDelta === 1` 且 finally 恢复 `record.impl`）。
- **BLOCKED 槽（11 个，显式报告不跳过）**：`net.Server.prototype.listen`、`tls.Server.prototype.listen`、`http.Server.prototype.listen`、`https.Server.prototype.listen`、`dgram.Socket.prototype.bind`、`dns.lookupService`、`dns.promises.lookup`、`dns.Resolver.prototype.reverse`、`dns.promises.Resolver.prototype.reverse`、`dns.Resolver`、`dns.promises.Resolver`——无可安全快速失败的调用参数（真实委托需建立监听/网络连接，超出授权）。
- **负控**：守卫拦截路径（`net.connect`）→ `D_NETWORK_GUARD_BLOCKED`，`originalInvoked` 全局与逐槽均零增长（before=after=167，仅 blocked +1）。
- **基线不清零**：`assertLoadTimeClean()` 二次调用后计数不变（167→167），正控计数未被清零掩盖。
- **捕获/替换/恢复顺序与 finally**：子进程内 `restore()` 按捕获顺序（`captureOrder`）逆序恢复（`orderReverse=true`）、包装器被原始函数替换、守卫内部 RESTORE_IDENTITY/DESCRIPTOR 断言通过；canary 的 finally 恢复逐槽验证（`restoredAll=true`）。
- **子进程继承**：无显式 `--require` 的子进程经 NODE_OPTIONS 继承 v3 守卫，其内原目标相连 canary 正控有效（exercised≥1、blockedCount≥1）。
- 探针过程记录：`http.request()` 无参真实发起回环连接尝试（EACCES）被探针发现并排除出安全表（改用非法 URL 快速失败参数）；`dns.promises.lookup(undefined)` 走惰性路径（DEP0118+内部真实 DNS 机件）被排除出安全表。此两条为「为什么这些槽不委托」的直接依据。

## 未验证项 / 边界（如实）

- 合成不转发证据仅覆盖守卫已安装入口；真实网络路径（真实 socket/监听/外网 DNS）从未建立，未做真实转发实测——**真实网络未验证边界明确保留**。
- 11 个 BLOCKED 槽的真实委托行为未实测（需真实监听/网络，超出授权，按令停止不扩大）。
- 真实设备/云/微信开发者工具/体验版上传继续冻结。

## 哈希（改动文件，blob 归一规则同校验器）

- `scripts/checkin-face-static-check.mjs` → `1f902732f38d…`（清单内）
- `tests/support/d-network-guard.cjs` → `51562c7ea3cb…`（清单内）
- `tests/checkin-face-qa-gates.test.cjs` → `5fabce47310b…`（清单内）
