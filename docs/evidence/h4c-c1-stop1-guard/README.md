# HK-AI-04 H4-c C1 Stop-1 Guard 补证（独立证据）

> 状态：**证据已纳入独立证据分支；Stop-1 仍待 Codex 独立复现 8/8 控制项，未自批，不进入 S2。**
>
> 派单编号：本条消息未提供官方编号；本证据使用执行者标签 `HK-AI-04-H4C-C1-STOP1-GUARD-EVIDENCE-2026-11-20`，**不冒充官方编号**。
>
> 执行者：DSH agent `lead`（deepseek-flash）；调度：SMART-PM-H3。
>
> 输入/父：`403970a035be44bb04d0ce5c01154a103a5ec5c5` / `84a9a555aca72bb8c60646c1eef8f408f234004f`。
>
> 证据分支/工作树：`codex/h4c-c1-stop1-guard-evidence`；`<REPO_ROOT>/.tmp/c1-stop1-guard-evidence`。原实现工作树/分支保持不变。
>
> 最终证据提交 SHA：由交付回报给出；本文件不自指。

## 1. 目的与范围

- 唯一目的：补足 Stop-1 的 guard 证据可复现性——把原报告中的 7 份 guard/包装器/控制脚本从 Windows 临时目录按字节原样纳入独立证据目录，使 Codex 可在独立工作树中复现 8/8 控制项。
- **不修改** `403970a` 的实现；不改业务代码、既有测试、Store、路由、批准设计；不进入 S2/C2/C3/迁移/生产写。
- Codex 已独立复跑业务定向 43/43，五文件范围与父链合规；`CoverageValid` 要求 state 已接受；22/18 错误码数量不构成违规但不授权新增入口。本轮不重跑/不重写业务代码，只交付 guard 证据。
- 允许的本地安全自检仅限已批准 guard 控制项：guard 先安装且失败关闭，无真实监听/网络外发。

## 2. 七文件原始与交付 SHA-256 对照

原路径已脱敏为 `%TEMP%\c1-staged-guard\<file>`（原主机 `%TEMP%` = 用户临时目录；不记录用户名）。交付路径相对本目录。

| # | 文件 | 原路径（脱敏） | 字节 | 原 SHA-256 | 交付路径 | 交付 SHA-256 | 一致 |
|---:|---|---|---:|---|---|---|---|
| 1 | `guard.cjs` | `%TEMP%\c1-staged-guard\guard.cjs` | 4325 | `2d013d808e8b78214db835ada611c9700d966ba07624342e26fcd637a900a8f5` | `docs/evidence/h4c-c1-stop1-guard/guard.cjs` | 同左 | 是 |
| 2 | `run-controls.cjs` | `%TEMP%\c1-staged-guard\run-controls.cjs` | 6513 | `3fd2507aabd8eb8a7abdb284e3b59061843d9e70ad081e902d291bbe25e73643` | `docs/evidence/h4c-c1-stop1-guard/run-controls.cjs` | 同左 | 是 |
| 3 | `entry-negative.cjs` | `%TEMP%\c1-staged-guard\entry-negative.cjs` | 2765 | `36f8d53326ab4f270928e294ba9ec517d6efffa935ddf8145cbecfc70f2124a6` | `docs/evidence/h4c-c1-stop1-guard/entry-negative.cjs` | 同左 | 是 |
| 4 | `load-negative.cjs` | `%TEMP%\c1-staged-guard\load-negative.cjs` | 246 | `ca89b38c351abcb026c71c5cd3d8fdd784acc192cb804468b29d650c49f7570f` | `docs/evidence/h4c-c1-stop1-guard/load-negative.cjs` | 同左 | 是 |
| 5 | `child-net.cjs` | `%TEMP%\c1-staged-guard\child-net.cjs` | 535 | `3afa02dec336a12c34114ef4083f87f3b05806dec97b007587faa42aa5c158ef` | `docs/evidence/h4c-c1-stop1-guard/child-net.cjs` | 同左 | 是 |
| 6 | `esm-sentinel.mjs` | `%TEMP%\c1-staged-guard\esm-sentinel.mjs` | 286 | `b3fb4bef441b1b6aa4f53879af5c1dc712a8dbbb2764d7ddc77379726a671b0c` | `docs/evidence/h4c-c1-stop1-guard/esm-sentinel.mjs` | 同左 | 是 |
| 7 | `positive.cjs` | `%TEMP%\c1-staged-guard\positive.cjs` | 1754 | `c34225ccc8854a1720ee51985d777ad29e1c7d85860e293bebeb2f3f7268bad2` | `docs/evidence/h4c-c1-stop1-guard/positive.cjs` | 同左 | 是 |

- 复制方式：`Copy-Item` 按字节复制；复制前后逐文件 SHA-256 比对全部一致（上表）。
- 本目录 `.gitattributes` 写入 `* -text`，禁止 Git 对证据目录做 EOL/文本归一化；提交后应再以 `git show <final>:<path>` 的 SHA-256 复核（最终 SHA 由交付回报给出）。
- `SHA256SUMS` 为交付文件的自校验清单；不含 README/自身。

## 3. 运行环境、命令、预加载与子进程

| 项 | 值 |
|---|---|
| Node | `v24.19.0` |
| PowerShell | `5.1.19041.1` |
| OS | `Microsoft Windows NT 10.0.19042.0`（Windows 10 20H2） |
| 工作目录 | `<EVIDENCE_WORKTREE>/admin-web` |
| 预加载 | `NODE_OPTIONS=--require "<EVIDENCE_WORKTREE>/docs/evidence/h4c-c1-stop1-guard/guard.cjs"` |
| 必需环境变量 | `H4C_ADMIN_WEB=<EVIDENCE_WORKTREE>/admin-web` |
| 包装器入口 | `<EVIDENCE_WORKTREE>/docs/evidence/h4c-c1-stop1-guard/run-controls.cjs` |
| 子进程继承 | `run-controls.cjs` 用 `spawnSync(process.execPath, …)` 把同一 `NODE_OPTIONS` 传给 `child-net.cjs`；子进程 `GUARD_ACTIVE=true`、`fetch` 被拦截、`network_attempts=1`、`listen_calls=0` |

复现命令（PowerShell 5.1；`<EVIDENCE_WORKTREE>` 为实际工作树绝对路径）：

```powershell
$guard = '<EVIDENCE_WORKTREE>/docs/evidence/h4c-c1-stop1-guard/guard.cjs'
$env:NODE_OPTIONS = '--require "' + $guard + '"'
$env:H4C_ADMIN_WEB = '<EVIDENCE_WORKTREE>/admin-web'
$env:H4C_GUARD_REPORT = '<TEMP>/wrapper.report.json'
Set-Location '<EVIDENCE_WORKTREE>/admin-web'
node '<EVIDENCE_WORKTREE>/docs/evidence/h4c-c1-stop1-guard/run-controls.cjs'
```

- 包装器第一步断言 `NODE_OPTIONS` 含 guard 且 `globalThis.__H4C_GUARD__.active` 为真；否则 `BLOCKED`，不降级运行。
- 实际测试由包装器执行：`node --test --test-isolation=none tests/face-h4c-evidence.test.mjs`（cwd `admin-web`），同一 preload。
- 未安装依赖；未运行 33 个非 HTTP 全量/根 7/8 个 HTTP/glob；未启动服务。

## 4. 8/8 控制映射（原始实测与本轮复现均通过）

| # | 控制名 | 执行文件 | 检查内容 | 期望/实测 |
|---:|---|---|---|---|
| 1 | `negative:no-guard` | `run-controls.cjs` 子进程 | 不设 `NODE_OPTIONS` 时无 sentinel | 子进程 exit 3 / `NO_GUARD`；PASS |
| 2 | `positive:preload-sentinel` | `run-controls.cjs` + `guard.cjs` | 预加载后 `GUARD_ACTIVE` 为真 | exit 0 / `GUARD_ACTIVE`；PASS |
| 3 | `negative:esm-named-import` | `esm-sentinel.mjs` + `guard.cjs` | `import { request } from "node:http"` 被 `syncBuiltinESMExports` 拦截 | exit 0；`http.request=1`；PASS |
| 4 | `negative:per-entry` | `entry-negative.cjs` + `guard.cjs` | 逐入口调用被拦截、计数增加 | 63/63 入口；`blocked_calls=63`；PASS |
| 5 | `negative:load-before-runtime` | `load-negative.cjs` + `guard.cjs` | 模块顶层 `http.request` 记为加载期违规 | 子进程 exit 1；`load_violations=1`；PASS |
| 6 | `negative:subprocess-inheritance` | `child-net.cjs` + `guard.cjs` | 真实子进程继承 guard，`fetch` 被拦截并回传计数 | `blocked=true`；`active=true`；`network_attempts=1`；`listen_calls=0`；PASS |
| 7 | `positive:crypto-fs-k3-localstore` | `positive.cjs` + `guard.cjs` | 固定 HMAC/SHA-256 向量、临时文件读写、固定 K3 config、`LocalStore.init()` | exit 0；guard 计数 0；PASS |
| 8 | `test:c1-targeted` | `run-controls.cjs` → `face-h4c-evidence.test.mjs` | 已批准 C1 定向测试 | **43/43 pass，0 fail**；计数器全 0；PASS |

- 测试进程计数器：`listen_calls=0`、`network_attempts=0`、`dns_calls=0`、`dgram_calls=0`、`provider_calls=0`、`load_violations=0`、`real_leaks=0`。
- 整体包装器 exit 0；控制项内部预期退出：no-guard 3、sentinel 0、ESM 0、per-entry 0、load-negative 1、subprocess 0、positive 0、test 0。

## 5. 原始实测输出 vs 本轮复现结果

| 项 | 原始实测（原实现工作树） | 本轮复现（证据工作树） |
|---|---|---|
| 原始文件 | `%TEMP%\c1-staged-guard\s1-rerun.txt` | `%TEMP%\h4c-stop1-repro-raw.txt` |
| 原始 SHA-256 | `cdbabf5f0cc450714408bd032868eb7a614dffbbbd3ed8c57188c45cacb821c4` | `08347ed3c07cd846b56800a1ce7c33323d81719792c0e193a10dd10dbcf6dbee` |
| 脱敏后文件 | `original-output-sanitized.txt` | `reproduction-output-sanitized.txt` |
| 脱敏后 SHA-256 | `c9675115ee1f371346bf1d34177d669fd99742c75436c1598eb93a3549ad708a` | `6e2e4c5bbc9d1de03ea7e8d78ae13f227e77d3afacf8d87ceeaf75fda5a18b9b` |
| 结果 | 8/8 PASS；43/43 pass；exit 0 | 8/8 PASS；43/43 pass；exit 0 |
| 说明 | S1 修复后、证据打包前，在原实现工作树执行；未独立验收 | 在 `403970a` 独立证据工作树，使用本目录复制的 7 文件执行；本轮独立复跑 |

- 原始输出不是本轮证据工作树产生的，也不是“原始证据已取回”的重构；它是此前执行者在原工作树的实测记录，本轮仅做脱敏转录。
- 两份输出的行结构、控制名、计数、退出码一致；差异仅为时间/耗时与路径占位。
- 原始路径与用户名已替换为 `%TEMP%`、`<USER_HOME>`、`<REPO_ROOT>`、`<EVIDENCE_WORKTREE>`；未上传含本机用户名的原始文本。

## 6. 路径/平台依赖与可移植性

- 7 个文件内部无硬编码绝对路径：`run-controls.cjs` 用 `__dirname` 定位同目录 guard/controls；`H4C_ADMIN_WEB` 由调用方提供；`positive.cjs` 从 `H4C_ADMIN_WEB` 动态导入 `admin-web`。
- 原始测量环境为 Windows 10 + PowerShell 5.1 + Node 24.19.0；`NODE_OPTIONS` 使用正斜杠路径，Windows 可直接使用；POSIX 下需改为 `export NODE_OPTIONS=...` 并保证 7 文件同目录。
- **未创建便携包装器**；原 `run-controls.cjs` 作为一套文件可整体迁移。若后续另存便携包装器，必须单独哈希并明确标注，不能冒充原脚本。
- 跨平台（Linux/macOS）、其他 Node 版本、其他 PowerShell 版本未验证。

## 7. 安全与脱敏检查

- 7 个脚本不含 API key/token/密码/真实人员数据；`positive.cjs` 使用 `Buffer.alloc(32, 2)` 固定测试 key 与公开固定 HMAC/SHA-256 向量，仅用于正控。
- 两份输出已脱敏；本目录与 README 未包含本机用户目录绝对路径或完整敏感命令行；命令示例使用 `<EVIDENCE_WORKTREE>`/`<TEMP>` 占位。
- 未上传原始含本机路径的文本；仅上传脱敏转录。
- 未发生真实监听/网络/DNS/Provider 外发；guard 在转发前抛出 `H4C_GUARD_BLOCKED`；测试计数器全 0。

## 8. 未验证 / 未做

- 未验证跨平台、其他 Node/PowerShell 版本；未做 OS 级独立网络抓包（仅 guard 计数与拦截）。
- 未运行 33 个非 HTTP 全量、根 7、8 个 HTTP 文件或任何 glob；未做全量回归。
- 未验证真实 Cloud 并发（D11/C3）；未取得云 `PARALLEL-DISPATCH.md`/`REVIEW.md`；九项裁定列未知。
- D8（S6 归属）、D10（S4 fixture）仍 OPEN。
- 未接 Store/生产 gate；未做迁移/生产写；未启动 HTTP/UI；未部署；未访问真实 K3/设备/Provider/支付/业务网络。
- 未获 Stop-1 独立复审；本证据不自批、不进入 S2。

## 9. Stop-1 交接

- 请 Codex 在独立证据工作树用上述命令复现 8/8 与 43/43，并核对七文件 SHA-256、`.gitattributes -text`、`git show <final>:<path>` 的字节一致性。
- Stop-1 仍暂缓；在收到独立复现结论前不推进 S2、不改 `403970a`、不合并。
