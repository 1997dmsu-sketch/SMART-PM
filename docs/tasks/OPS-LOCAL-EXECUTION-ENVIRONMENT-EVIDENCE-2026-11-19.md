# OPS 本地执行环境证据（2026-11-19）

> 类型：只读环境取证 + 白名单文档提交
> 结论级别：**环境证据，不代表业务验收**
> 仓库：SMART-PM（主仓）；本文位于链接工作树 `.tmp/ops-local-evidence`
> 分支：`docs/ops-local-environment-evidence`
> 起点提交：`282a20fca9f64ab80ead50372c9c3e90bf4aeba7`
> 匿名主机：`ANON-WIN10-OPS-01`（原始主机名/账户名/IP/MAC 不写入）
> 原 runId：`hrun-mwn8fka2-f2c3f8`（调度方提供；本机未独立校验）
> 本 runId：环境未暴露（未知）
> 采集：2026-11-19T15:32:10+08:00–15:34:05+08:00（原）；2026-11-20T06:55:11+08:00–2026-11-20T07:05:10+08:00（补证）

## 0. 边界与免责

- 仅只读采集：未连接任何监听端口（仅对 GitHub 443 做出站连通尝试），未启停服务，未改配置，未轮换凭据，未安装/测试/合并/部署。
- 未读取任何凭据值；未输出完整敏感命令行或配置；只记录命中标志、参数名、计数与脱敏定位。
- `282a20f` 仅为文档工作树起点，**不作为 C/D 分析对象的替代**；本文不分析该提交内容。
- A 已通过，本轮不重派。
- 环境可用（工具/仓库/权限）≠ 业务验收；本文不构成恢复、部署或上线依据。

## 1. 采集时间线（+08:00）

| 时间 | 动作 | 结果 |
|---|---|---|
| 2026-11-19 15:32:10 | 原 run 只读取证开始 | 工作树 SMART-PM-H3，HEAD `9fd088da…` |
| 2026-11-19 15:34:05 | 原 run 取证结束 | GitHub `ls-remote` exit 0；远端分支=本地 HEAD |
| 2026-11-20 06:55:11 | 本工作树核验开始 | ops-local-evidence，HEAD `282a20f`，clean |
| 2026-11-20 06:55–06:57 | `git ls-remote`（远端分支） | 挂起 >120s，终止；exit 未取得 |
| 2026-11-20 06:57:55 | GitHub HTTPS 出站测试 | exit 28（15s 超时） |
| 2026-11-20 06:58:23 | TCP LISTEN 快照 | 81 项 |
| 2026-11-20 06:59:02 | 工具版本采集 | 见 §5 |
| 2026-11-20 06:59:21 | 计划任务普查 | 217 个任务 |
| 2026-11-20 06:59:23 | 凭据管理器普查 | 12 个目标 |
| 2026-11-20 07:00:08 | 凭据类型/脚本任务定位 | 11 Generic / 1 Domain；1 个脚本任务 |
| 2026-11-20 07:00:41 | VBS 关键词扫描；DNS 复测 | 6 处标识符；DNS=`198.18.0.91` |
| 2026-11-20 07:01:13 | 直连 IP / 本地代理测试 | 均 exit 28 |
| 2026-11-20 07:02:31 | 复测；`pwsh`/`rg` 存在性 | exit 28；二者 exit 1 |
| 2026-11-20T07:05:10+08:00 | 本文快照与写入 | 见提交回执 |

### 1.1 原 run 环境摘要（11-19）

- 工作树：`SMART-PM-H3`（SMART-PM 的 linked worktree），HEAD `9fd088da57a1400e4e5fcaaf367b787b2e371dac`，分支 `docs/hk-face-h4-revoke-reconcile-design`，与 origin 同步 0/0，仅 1 个未跟踪 `HK-AI-07D.patch`。
- 工具：Git 2.55.0 / Node v24.19.0 / npm 11.17.0 / Python 3.14.7 / PowerShell 5.1；pwsh 7 与 rg 未安装。
- 连通：GitHub `ls-remote` 两次 exit 0（15:33:03、15:33:04）。

## 2. 主机（匿名）

| 项 | 值 | 来源/时间 |
|---|---|---|
| 匿名标识 | `ANON-WIN10-OPS-01` | 本文定义 |
| OS | Windows 10 教育版 10.0.19042，64 位 | 11-19 15:32:31 exit 0 |
| CPU / RAM | Intel i7-7700K，8 逻辑核 / 15.9 GB | 11-19 15:33:36 exit 0 |
| 时区 | China Standard Time（UTC+08:00） | 11-19 15:33:28 exit 0 |
| 系统盘 | C: NTFS，约 330.4 GB，剩余约 129.6 GB | 11-19 15:32:33 exit 0 |
| 账户类别 | 管理员组成员；11-19 15:33 令牌完整性=Low Mandatory Level | 11-19 15:33:07 exit 0 |
| 会话策略 | 15:32 `workspace-write`；18:06 起系统通知改为 `danger-full-access` | 会话通知 |

未写入：主机名、账户名、IP、MAC、域信息、机器 GUID。

## 3. 仓库与工作树映射

- 主仓根（脱敏）：`%USERPROFILE%\Documents\ChatGPT\宇宙智联\SMART-PM`
- 当前工作树（脱敏）：`%USERPROFILE%\Documents\ChatGPT\宇宙智联\.tmp\ops-local-evidence`
- 当前 worktree gitdir：`…/SMART-PM/.git/worktrees/ops-local-evidence`
- 工作树总数：**49**，全部链接到同一 `SMART-PM` 仓库。

**当前工作树 HEAD 事实（写入本文之前）**

| 项 | 值 |
|---|---|
| HEAD | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` |
| 父提交 | `36adf0f2e521fc425aed5879c9dbde3b16babbe9` |
| 分支 | `docs/ops-local-environment-evidence` |
| upstream | 无（检查时） |
| status | clean |
| 未跟踪 | 无 |

**工作树全量映射（49 条）**

| # | 路径（脱敏） | HEAD | 引用 |
|---|---|---|---|
| 1 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/SMART-PM | 5dff386 | feat/hk-face-h4c-reconciliation |
| 2 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/07b-candidate-task | 5e96ee6 | docs/hk-face-07b-integration-candidate-task |
| 3 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/07b-gate-execution | 1be517e | feat/hk-face-07b-offline-gate |
| 4 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/07b-task-card-review | cc4ec7b | codex/07b-integration-task-revision |
| 5 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/baton-07b-preflight | 59a737a | (detached) |
| 6 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/baton-h4c-c1-review | 5dff386 | (detached) |
| 7 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/baton-rental-offline | 8df281b | (detached) |
| 8 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/c1-design-v3 | 575d8b6 | codex/h4c-empty-proof-v3 |
| 9 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/c1-design-v4 | 7f42280 | codex/h4c-empty-proof-v4 |
| 10 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/c1-epoch-uniqueness | fcae246 | docs/hk-face-c1-epoch-uniqueness |
| 11 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/c1-first-stage-authorization | ed6f862 | docs/h4c-c1-s0-s1-authorization |
| 12 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/c1-staged-task | 8e15960 | docs/h4c-c1-staged-implementation-task |
| 13 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/c1-v7-review-fixes | bc80f74 | docs/hk-face-c1-v7-review-fixes |
| 14 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/closeout-a | b5e7b97 | codex/07d-g1-p2 |
| 15 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/closeout-a-current | 2054404 | codex/07d-g1-p2-current |
| 16 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/closeout-b | 922c4ab | (detached) |
| 17 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/closeout-c | 8ff350d | (detached) |
| 18 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/closeout-d | f2bb6de | docs/hk-face-h4c-c1-empty-chain-proof-design |
| 19 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/cross-branch-map | 3608d97 | docs/smart-pm-cross-branch-integration-map |
| 20 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/g2-revision-review | c075229 | codex/07d-g2-review-hardening |
| 21 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/g4-compat-execution | 49c5f79 | feat/hk-face-g4-compatibility-review |
| 22 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/g4-task-card-review | ff02f3a | codex/g4-review-task-revision |
| 23 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/git-config-evidence | a26e9cb | docs/git-config-deviation-evidence |
| 24 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/hikvision-readiness | ef6e294 | docs/hikvision-interface-test-readiness |
| 25 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/hk-06b-device-lab-preflight | ba95666 | docs/hk-hikvision-device-lab-preflight |
| 26 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/hk-07b-evidence-final | 59a737a | (detached) |
| 27 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/hk-07b-failure-reason-final | cf7c75e | feat/hk-face-queryjob-revision |
| 28 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/hk-07d-retry-requeue | 24c626f | docs/hk-face-retry-requeue-design |
| 29 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/hk-admin-audit | 7cad58d | docs/hk-face-admin-wiring-audit |
| 30 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/hk-h4c-c1-final-90e4189 | 5dff386 | (detached) |
| 31 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/hk-h4c-c1-review-3fce9b0 | 3fce9b0 | (detached) |
| 32 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/hk-h4c-c2-preflight | 42f8970 | docs/hk-face-h4c-c2-preflight |
| 33 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/hk-http-wiring-07a | 2f597e3 | docs/hk-face-http-wiring-design |
| 34 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/hk-queryjob-revision | f584471 | (detached) |
| 35 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/hk-revoke-contract-hardening | 7686a51 | docs/hk-face-revoke-contract-hardening |
| 36 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/ops-local-evidence | 282a20f | docs/ops-local-environment-evidence |
| 37 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/parallel-c1 | fb75cf0 | codex/h4c-empty-chain-design-followup |
| 38 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/parallel-e07 | 521a0f0 | codex/07d-e07-descriptor-cleanup |
| 39 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/parallel-rental | 3bf5951 | codex/rental-post-payment-review |
| 40 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/release-readiness | 2d54f3c | docs/release-readiness-followup |
| 41 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/rental-business-readiness | 4a069bb | docs/rental-business-readiness |
| 42 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/rental-contract-decisions | 95e4389 | codex/rental-contract-decisions |
| 43 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/rental-open-items | 585e925 | codex/rental-open-items |
| 44 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/rental-query-retry | 5d56dea | docs/rental-query-retry-contract |
| 45 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/rental-s1-authorization | 8959890 | docs/rental-s1-authorization |
| 46 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/rental-staged-task | 8a2f8d9 | docs/rental-staged-implementation-task |
| 47 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/.tmp/rental-v4-review-fixes | bcacadb | docs/rental-contract-v4-review-fixes |
| 48 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/h4c-c1-final | aa0db29 | (detached) |
| 49 | %USERPROFILE%/Documents/ChatGPT/宇宙智联/SMART-PM-H3 | 9fd088d | docs/hk-face-h4-revoke-reconcile-design |

## 4. 提交 `20e7fb8` 的 worktree 归属

| 项 | 值 |
|---|---|
| 完整 SHA | `20e7fb8c6877773b1321fc95d87fe66e46dbfea7` |
| 父提交 | `356808ccf6973b560e9ea8cd83527a3af6d64f86` |
| 提交时间 | 2026-11-03 12:34:20 +0800 |
| 说明 | test(db07): 三次复审——测试对齐 identity.readPrivate，新增 F04 验证… |
| 包含该提交的本地分支 | 34 个 |
| 包含该提交的远端跟踪分支 | 55 个 |
| HEAD 等于该提交的 worktree | **0 / 49** |
| 归属结论 | **查不到：无法归属到任何当前 worktree（未知）** |

说明：该提交是多个分支共享历史的节点，不能唯一对应某个工作树；本文不推断其任务归属。

## 5. 工具链版本 / exit / 来源

| 工具 | 版本 | 路径（脱敏） | 时间 / exit |
|---|---|---|---|
| Git | 2.55.0.windows.3 | `C:\Program Files\Git\cmd\git.exe` | 11-20 06:59:02 / 0 |
| Node | v24.19.0 | `D:\node.exe` | 11-20 06:59:02 / 0 |
| npm.cmd | 11.17.0 | `D:\npm.cmd` | 11-20 06:59:02 / 0 |
| Python | 3.14.7 | `C:\Python314\python.exe` | 11-20 06:59:03 / 0 |
| PowerShell | 5.1.19041.1 Desktop | `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` | 11-20 06:59:03 / 0 |
| Codex CLI | 0.155.1 | `%USERPROFILE%\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe` | 11-20 06:59:03 / 0 |
| pwsh 7 | **未安装** | — | 11-20 07:02:31 / where exit 1 |
| rg | **未安装** | — | 11-20 07:02:31 / where exit 1 |

注：11-19 执行 `codex --version` 曾报 `os error 5`（临时目录清理告警）；11-20 未复现。

## 6. TCP 监听表（实测 81 项，非 14）

调度前提为“14 项监听”。实测 **TCP LISTEN 81 项**（快照 2026-11-20T07:05:10+08:00，`Get-NetTCPConnection -State Listen` exit 0）：

- 绑定范围：loopback 48；any 29；specific 4（两个地址段：`192.168.1.0/24`、`198.18.0.0/24`（虚拟/代理段））。
- 去重口径：唯一端口 68；外部绑定行 33；外部唯一（进程, 端口）22。
- **未发现任何自然口径等于 14；本表按 81 项全量列出，不裁剪、不补数。**
- 说明：同一端口可能存在 IPv4/IPv6 两行；动态 RPC 端口随系统状态变化。

| # | 协议 | 绑定（脱敏） | 端口 | 范围 | 进程 |
|---|---|---|---|---|---|
| 1 | TCP | :: | 135 | any | svchost |
| 2 | TCP | 0.0.0.0 | 135 | any | svchost |
| 3 | TCP | 192.168.1.0/24 | 139 | LAN | System |
| 4 | TCP | 198.18.0.0/24 | 139 | virtual | System |
| 5 | TCP | :: | 445 | any | System |
| 6 | TCP | ::1 | 1024 | loopback | jhi_service |
| 7 | TCP | :: | 1025 | any | svchost |
| 8 | TCP | 0.0.0.0 | 1025 | any | svchost |
| 9 | TCP | :: | 1219 | any | services |
| 10 | TCP | 0.0.0.0 | 1219 | any | services |
| 11 | TCP | 127.0.0.1 | 1286 | loopback | LogiPluginService |
| 12 | TCP | 127.0.0.1 | 1288 | loopback | LogiPluginService |
| 13 | TCP | 127.0.0.1 | 1290 | loopback | LogiPluginService |
| 14 | TCP | 127.0.0.1 | 1306 | loopback | LogiPluginService |
| 15 | TCP | 127.0.0.1 | 1387 | loopback | AdskIdentityManager |
| 16 | TCP | 127.0.0.1 | 1388 | loopback | AdskIdentityManager |
| 17 | TCP | 127.0.0.1 | 1395 | loopback | AdSSO |
| 18 | TCP | 127.0.0.1 | 1396 | loopback | AdSSO |
| 19 | TCP | 127.0.0.1 | 3090 | loopback | DeepSeek Harness |
| 20 | TCP | 127.0.0.1 | 3213 | loopback | OriginWebHelperService |
| 21 | TCP | :: | 3389 | any | svchost |
| 22 | TCP | 0.0.0.0 | 3389 | any | svchost |
| 23 | TCP | 127.0.0.1 | 4691 | loopback | WXWork |
| 24 | TCP | 127.0.0.1 | 4709 | loopback | wpscloudsvr |
| 25 | TCP | :: | 4873 | any | wpscloudsvr |
| 26 | TCP | 0.0.0.0 | 5040 | any | svchost |
| 27 | TCP | 127.0.0.1 | 5147 | loopback | qianwen |
| 28 | TCP | :: | 5357 | any | System |
| 29 | TCP | 0.0.0.0 | 5521 | any | SPDBSecInput |
| 30 | TCP | 0.0.0.0 | 5526 | any | SPDBSignServ |
| 31 | TCP | 192.168.1.0/24 | 5825 | LAN | WXWork |
| 32 | TCP | ::1 | 6591 | loopback | netCertServerSPDB |
| 33 | TCP | 127.0.0.1 | 6591 | loopback | netCertServerSPDB |
| 34 | TCP | 127.0.0.1 | 6646 | loopback | chrome |
| 35 | TCP | :: | 7680 | any | svchost |
| 36 | TCP | 127.0.0.1 | 7688 | loopback | mihomo |
| 37 | TCP | 127.0.0.1 | 8029 | loopback | AdskLicensingService |
| 38 | TCP | 127.0.0.1 | 9688 | loopback | mihomo |
| 39 | TCP | 127.0.0.1 | 9882 | loopback | WXWork |
| 40 | TCP | 127.0.0.1 | 9883 | loopback | WXWork |
| 41 | TCP | :: | 10104 | any | spoolsv |
| 42 | TCP | 0.0.0.0 | 10104 | any | spoolsv |
| 43 | TCP | 127.0.0.1 | 10351 | loopback | steam |
| 44 | TCP | 127.0.0.1 | 10352 | loopback | steam |
| 45 | TCP | 127.0.0.1 | 12796 | loopback | WorkBuddy |
| 46 | TCP | 127.0.0.1 | 12798 | loopback | WorkBuddy |
| 47 | TCP | 127.0.0.1 | 12874 | loopback | node |
| 48 | TCP | 127.0.0.1 | 12938 | loopback | WorkBuddy |
| 49 | TCP | 127.0.0.1 | 12953 | loopback | sandbox-cli |
| 50 | TCP | 127.0.0.1 | 13512 | loopback | DeepSeek Harness |
| 51 | TCP | 192.168.1.0/24 | 13512 | LAN | DeepSeek Harness |
| 52 | TCP | 127.0.0.1 | 13618 | loopback | DeepSeek Harness |
| 53 | TCP | 127.0.0.1 | 13701 | loopback | DeepSeek Harness |
| 54 | TCP | 127.0.0.1 | 14013 | loopback | Weixin |
| 55 | TCP | 127.0.0.1 | 14016 | loopback | Weixin |
| 56 | TCP | 127.0.0.1 | 14019 | loopback | Weixin |
| 57 | TCP | 127.0.0.1 | 14022 | loopback | Weixin |
| 58 | TCP | 127.0.0.1 | 14023 | loopback | Weixin |
| 59 | TCP | 127.0.0.1 | 18488 | loopback | WorkBuddy |
| 60 | TCP | 127.0.0.1 | 19010 | loopback | logioptionsplus_agent |
| 61 | TCP | 127.0.0.1 | 20241 | loopback | cloudflared |
| 62 | TCP | 127.0.0.1 | 21440 | loopback | FlashHelperService |
| 63 | TCP | 127.0.0.1 | 21441 | loopback | FlashHelperService |
| 64 | TCP | 0.0.0.0 | 27036 | any | steam |
| 65 | TCP | 127.0.0.1 | 33211 | loopback | clash-verge-service |
| 66 | TCP | 127.0.0.1 | 39099 | loopback | editor_sdk |
| 67 | TCP | ::1 | 42050 | loopback | OneDrive.Sync.Service |
| 68 | TCP | :: | 49664 | any | lsass |
| 69 | TCP | 0.0.0.0 | 49664 | any | lsass |
| 70 | TCP | :: | 49665 | any | wininit |
| 71 | TCP | 0.0.0.0 | 49665 | any | wininit |
| 72 | TCP | :: | 49666 | any | svchost |
| 73 | TCP | 0.0.0.0 | 49666 | any | svchost |
| 74 | TCP | :: | 49667 | any | svchost |
| 75 | TCP | 0.0.0.0 | 49667 | any | svchost |
| 76 | TCP | :: | 49668 | any | svchost |
| 77 | TCP | 0.0.0.0 | 49668 | any | svchost |
| 78 | TCP | 127.0.0.1 | 50010 | loopback | WXWork |
| 79 | TCP | 127.0.0.1 | 50018 | loopback | WXWork |
| 80 | TCP | 127.0.0.1 | 53820 | loopback | DeepSeek Harness |
| 81 | TCP | 0.0.0.0 | 59869 | any | logioptionsplus_agent |

**UDP 已知缺口**：`netstat -ano -p UDP` 返回 109 行；`Get-NetUDPEndpoint` 返回 0（查询异常/受限），故 UDP 未逐条列表，仅计数。该缺口不并入上表。

## 7. 认证：实证 / 推断 / 未知

| 类别 | 事实 | 证据 |
|---|---|---|
| 实证 | 控制台交互会话 1 个 | `quser` exit 0，仅 console |
| 实证 | RDP 服务运行、手动启动 | `TermService` Running / Manual |
| 实证 | RDP 安全层要求 NLA；3389 端口；未禁用 | `fDenyTSConnections=0`、`UserAuthentication=1`、`PortNumber=3389` |
| 实证 | 3389 在 IPv4/IPv6 any 监听；UDP 3389 存在 | 监听快照；netstat UDP |
| 实证 | SMB 服务运行；445 any、139 specific 监听 | `LanmanServer` Running；监听快照 |
| 实证 | WinRM 停止 | `WinRM` Stopped / Manual |
| 实证 | 未发现 sshd 服务 | `Get-Service sshd` 无返回 |
| 推断 | RDP 远程认证通道“已配置启用”；若网络可达且凭据有效，可能允许远程交互登录 | 上述实证组合；**未做活动验证** |
| 推断 | SMB 认证通道可能可用 | 445/139 监听；**未做活动验证** |
| 未知 | 外部可达性、防火墙入站规则、账户/密码有效性、域信任、最近远程登录历史、非 console 会话 | 未连接、未登录、未查 |

**未活动验证**：本文未从外部发起 RDP/SMB/WinRM/SSH 连接，也未做任何登录尝试；因此“可达性”一律为未知。

## 8. 凭据检查（三分）

> 原则：只记录标志、参数名、计数与脱敏定位；不记录任何值、用户名或完整命令行。未检查的项目明确写“未查”。

### 8.1 计划任务 LogonType（保存密码）

| 项 | 值 |
|---|---|
| 任务总数 | 217 |
| `Export-ScheduledTask` 成功 | 217 / 217 |
| `LogonType=Password`（保存密码） | **0** |
| `ServiceAccount` | 136 |
| `Group` | 71 |
| `Interactive` | 10 |
| 非 Microsoft 任务 | 27（ServiceAccount 10 / Interactive 10 / Group 7） |

结论：**未发现以“保存密码”方式注册的计划任务**。限制：该结论仅基于 Principal.LogonType；任务计划程序在 LSA 中的加密存储未读取，无法证明“绝无保存密码”。

### 8.2 凭据管理器

| 项 | 值 |
|---|---|
| `cmdkey /list` exit | 0 |
| 目标总数 | **12** |
| 类型 Generic | 11 |
| 类型 Domain | 1 |
| 名称含 `git` 的目标（类别标志，不写名称） | **3** |
| 凭据文件计数（roaming / local） | 3 / 7 |
| `%USERPROFILE%\.git-credentials` | 不存在 |
| `credential.helper` | 已设置（值不写） |
| 敏感命名环境变量 | 0 |

结论：**非 0**。本机存在持久凭据目标，其中 3 条与 git 相关（类别标志，未读取名称/用户名/值）；有效性未验证。

### 8.3 Action / Arguments / 引用脚本文本

| 项 | 值 |
|---|---|
| 任务 Action 总数 | 217 |
| 敏感参数名命中 | **0**（1 个假阳性：可执行文件名 `dstokenclean.exe` 含 `token`，其 Arguments 长度为 0） |
| `-EncodedCommand` | 0 |
| Arguments 中脚本引用 | 0 |
| 直接执行脚本的任务 | 1 个：`\Microsoft\Windows\NetTrace\GatherNetworkInfo` → `%windir%\system32\gatherNetworkInfo.vbs`（88,781 B） |
| 该脚本关键词命中 | 6 处 `credential` 标识符/字段名；**0 处字面量赋值**；脚本未执行 |

结论：**第三项 0 字面量命中**。限制：仅按敏感词/参数名做文本扫描，未做全量语义审阅；未检查二进制、注册表、内存、浏览器密码库。

### 8.4 三分结论

- “前两项为 0 不排除第三项”的规则成立。本次实际为：第一项 **0**、第二项 **12**、第三项 **0**；因此**不能得出“无凭据”**。
- 3 条 git 相关凭据目标为待核风险：未读取值、未验证有效性、未轮换。
- **未查**：LSA 密文、cmdkey 目标值/用户名、二进制与内存、浏览器密码库、注册表凭据、其他配置文件、凭据实际可用性。

## 9. 未验证 / 未知

1. **远端仓库状态未知**：2026-11-20 07:01–07:02 GitHub 不可达（`curl` exit 28；DNS 解析为 `198.18.0.91`；直连 IP 与本地代理均超时）；`ls-remote` 挂起 >120s 后终止。远端分支是否存在、是否前移均未知；未做强制推送。
2. push 结果以本次交付执行记录为准；若网络不可达则未完成。
3. 业务验收：设备、支付、生产云、HTTPUI、构建、测试、部署全部未执行。
4. UDP 明细未列（见 §6）。
5. `svchost` 监听未映射到具体服务（未查）。
6. 可达性、防火墙入站规则未验证。
7. 凭据值、用户名、有效性未读取/未验证。
8. `20e7fb8` 的 worktree 归属未知（0 命中）。
9. 原 runId 由调度方提供，本机未独立校验。

## 10. 结论

本机执行环境可用且已按只读方式取证：仓库/工作树、HEAD 与父链、工具链、TCP 监听面、认证配置、凭据三分检查均有命令与 exit 支撑。**环境可用不等于业务验收**；本文不构成恢复、部署、上线或“已闭合”的依据，九项云裁定不可读、不猜测。未自批，待 Codex 复审。

## 附录 A：关键命令与 exit

| 时间 | 命令 | exit | 结果 |
|---|---|---|---|
| 11-20 06:55:11 | `git -C <wt> rev-parse HEAD` | 0 | `282a20f…` |
| 11-20 06:55:11 | `git -C <wt> status -sb` | 0 | clean |
| 11-20 06:55:11 | `git -C <wt> worktree list` | 0 | 49 条 |
| 11-20 06:55 | `git ls-remote origin refs/heads/docs/ops-local-environment-evidence` | 未取得（>120s 终止） | 无输出 |
| 11-20 06:57:55 | `curl https://github.com` | 28 | 超时 |
| 11-20 06:58:23 | `Get-NetTCPConnection -State Listen` | 0 | 81 |
| 11-20 06:58:23 | `Get-NetUDPEndpoint` | 0 | 0（异常） |
| 11-20 06:58:23 | `netstat -ano -p UDP` | 0 | 109 行 |
| 11-20 06:59:02 | `git --version` / `node --version` / `npm.cmd --version` | 0 | 见 §5 |
| 11-20 06:59:03 | `python --version` / `codex --version` | 0 | 见 §5 |
| 11-20 06:59:21 | `Get-ScheduledTask` | 0 | 217 |
| 11-20 06:59:21 | `Export-ScheduledTask` ×217 | 0 | 217/217 |
| 11-20 06:59:23 | `cmdkey /list` | 0 | 12 targets |
| 11-20 07:00:41 | `Resolve-DnsName github.com -Server 223.5.5.5` | 0 | `198.18.0.91` |
| 11-20 07:01:13 | `curl --resolve …` / `curl -x 127.0.0.1:7688` | 28 | 均超时 |
| 11-20 07:02:31 | `where pwsh` / `where rg` | 1 | 未安装 |

## 附录 B：脱敏规则

- `C:\Users\<account>` → `%USERPROFILE%`；主机名、账户名、域、MAC 不写入。
- LAN 地址 → `/24` 网段；虚拟/代理段保留 `198.18.0.0/24` 标注。
- 凭据管理器目标名称、用户名、值、任务保存密码均不写入。
- 计划任务 Action 只写可执行文件名/脚本路径与命中标志，不写完整命令行。
- 只记录“命中/未命中/未知”，不把推断写成实证。