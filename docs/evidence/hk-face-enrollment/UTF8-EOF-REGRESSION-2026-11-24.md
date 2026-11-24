# UTF-8 EOF 独立回归补证：实施记录

日期：2026-11-24，Asia/Shanghai。实施方接替原 Harness 执行者；本报告不是独立验收，不自行关闭 EOF 验收。停止点为 **Stop-EOF**。

## 来源、接替与范围

- 固定任务卡提交：`74f4dcb7f731f90bdf1a72650c4c616a82858da5`，路径 `docs/tasks/HK-FACE-ENROLLMENT-UTF8-EOF-REGRESSION-TASK-2026-11-24.md`。通过普通 fetch 取得该对象后用 git show 全文读取，没有 merge/cherry-pick，也没有将任务卡复制进实现分支。
- 独立实现起点：`6ecb337d4d7e84de6080af53e335b75ec7f46875`；其父为 `f3bef713f651daf90c71cba43674cf1d1dbdecf5`，再前为 `2d7f935868662d6fe6d4830de9d975af1ba4a260`。分支 `test/hk-face-enrollment-utf8-eof-2026-11-24`；工作树代号 `SMART-PM-face-utf8-eof-2026-11-24`，仅检出命令使用一次 core.autocrlf=false，未改 Git 配置。
- 原派单 `hrun-mwuddtai-5b6b18`、原会话 `session-333e8375-0d48-4472-9354-9a5a6b942712` 的 BLOCKED_ENVIRONMENT 及零修改/运行/提交/推送是负责人提供的接替信息。15:45起查同名本地/远端分支和工作树，均不存在；原会话仅查元数据，接口返回 Invalid conversation，未读取消息，不能据此独立核实其 running/queued 状态。依据负责人明确改派继续，没有等待原机或另行派单。
- 唯一修改的既有 Git 文件是 `admin-web/tests/face-enroll-powershell.test.mjs`，仅在既有参数化装配新增 EOF 测试块（两宿主各一项）。移除新增字节块后与起点文件原始字节完全相同，旧 helper、标题、断言和向量未改。唯一新增 Git 文件是本报告。
- 两项 P2 已关闭及历史246/246结论不重审、不改写。本次没有执行全量246项；只运行规定 PowerShell 单文件聚焦套件。旧验收文档的 EOF NOT_COVERED 原文保留。

## 实际环境与启动方式

环境查询时间为 `2026-11-24T15:46:53.6914892+08:00`；本机 Windows，注册信息原文 Windows 10 Home China / 23H2，构建 `22631.6199`。父 shell 为 PowerShell `7.6.9`，Node `v24.16.0`，实际可执行文件 `D:\node\node.exe`。

Windows PowerShell 为 `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`，实测 `5.1.22621.6133 Desktop`。PowerShell 7 实测 `7.6.9 Core`；其安装路径的个人目录部分在此脱敏为 `%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe`，完整实查绝对路径保存在本地 preflight.json，不将个人目录写入 Git。

两个版本均通过已安装程序实际启动查询，退出码均0；既有进程 PATH 已能找到 pwsh.exe，不作 PATH 调整。测试沿用旧 helper：PS5.1用 SystemRoot 下的绝对路径，PS7用 pwsh.exe；均以 -NoLogo -NoProfile -NonInteractive -File 启动包装器，windowsHide=true。未安装/升级运行时、依赖或修改执行策略。

## EOF 样本、正控与两宿主结果

输入为23字节 ASCII 前缀 `{"name":"SYNTHETIC_EOF_` 加原始 `E4 B8`，总25字节，完整hex为：

`7b226e616d65223a2253594e5448455449435f454f465fe4b8`

发送前断言长度及尾字节；Buffer 经既有 invoke→run→stdin.end 直接发送并关闭输入，不追加引号、JSON尾部、换行或终止符，不先变成字符串或使用 PowerShell 文本管道。

每宿主用 fakeEntry 复制真实启动器，将登记入口换成第一条可执行语句写合成哨兵的假 child。EOF负例与合法UTF-8正控分别使用全新独立 fixture、同一假入口源码，没有连接真实 adapter；所有哨兵和 fixture 原样保留。

| 项目 | Windows PowerShell 5.1 | PowerShell 7 |
| --- | --- | --- |
| EOF进程 / wrapper退出码 | 2 / 2 | 2 / 2 |
| childExitCode / timedOut | null / false | null / false |
| error | input-invalid-or-too-large | input-invalid-or-too-large |
| 包装器stdout / stderr | 单行JSON / 空 | 单行JSON / 空 |
| child stdout / stderr | 0 / 0字节 | 0 / 0字节 |
| exit-code.txt | not-started-or-unknown 加LF | not-started-or-unknown 加LF |
| EOF fixture哨兵请求前 / 后 | 不存在 / 不存在 | 不存在 / 不存在 |
| 拒绝摘要载荷 / U+FFFD | 均未输出 | 均未输出 |
| 独立合法正控child | 实际启动，退出4，哨兵由无变有 | 实际启动，退出4，哨兵由无变有 |

正控假 child 固定输出协议 failed 并返回4，以确认真正到达登记 child，不能误报为正式套件失败。两宿主原结果、marker前后状态、实际输入hex及正负 fixture 定位见 formal.hosts.json 和 formal-hosts/ 下各自 eof-observation.json。

## 唯一正式聚焦运行

在新实现工作树根执行，默认测试隔离：

```text
node --test admin-web/tests/face-enroll-powershell.test.mjs
开始：2026-11-24T15:51:24.219+08:00
结束：2026-11-24T15:51:54.781+08:00
EXIT_CODE=0
tests=19 pass=19 fail=0 cancelled=0 skipped=0 todo=0
stderr=0字节
```

这是该文件既有17项加本轮两项EOF，共19项的实际结果；两宿主新EOF均执行，没有skip。不是“248项通过”，也不是本轮重跑旧246项。

## 工件副本可证伪负控

仅在本地独立 negative-control-repository 内复制受测测试文件及启动器。测试文件副本与正式受测文件SHA-256一致；启动器副本仅将唯一 `UTF8Encoding($false, $true)` 改为 `UTF8Encoding($false, $false)`，不修改仓库原件。变更位置、单次命中及两版本指纹见 negative-control-mutation.json。

在该副本根执行，使用默认隔离，仅选择两个新增EOF：

```text
node --test --test-name-pattern="rejects an incomplete UTF-8 sequence at EOF before starting any child" admin-web/tests/face-enroll-powershell.test.mjs
开始：2026-11-24T15:51:54.856+08:00
结束：2026-11-24T15:51:58.210+08:00
EXIT_CODE=1
tests=2 pass=0 fail=2 cancelled=0 skipped=0 todo=0
stderr=0字节
```

两宿主均在原EOF断言“进程应为2”处实际失败（实际4）；负例 childExitCode=4、wrapper=4，哨兵请求前不存在、请求后存在。各自独立合法正控也启动成功。证明新增断言能检出严格拒绝被关闭，且不是因为 child 本来不可达而假通过。故意失败完整保留，不与正式19/19结果合并。

pattern未选择17项既有测试；Node此运行的skipped统计为0，不据此宣称那些未选择项执行或通过。负控文件和哨兵保留，未修改受测原文件。

## 本地证据与原始字节

独立证据目录代号为 `EOF-REGRESSION-20261124T154722-f7fe0144`。以下文件名均相对该目录，未新增白名单外的Git工件。正式及负控命令的stdout/stderr由进程管道原始字节复制，进程exit事件立即保存实际退出码，然后才解析统计。两宿主包装器输出另按既有helper返回文本保存；child日志从新fixture原文件复制，不冒称helper文本为额外原始Buffer采集。

| 相对工件名 | 字节数 | SHA-256 |
| --- | ---: | --- |
| preflight.json | 1947 | `0f660f20d3ae36263abe3053298c1318622cc9e5e78831d91513b8444297f3f7` |
| task-source.json | 316 | `c1617646a94058e67f14bd81c78a9fc3532697c669d77bf9d42756c805b4e40f` |
| baseline-source.json | 1120 | `d75065adb4a1c9e8fc6a8206ace536f56313d418a2db537485d9d0c7900278f3` |
| source-before.json | 987 | `258098aba20e77fb4a009027e08c8d8c75c3106def64be846ba615422996f617` |
| source-after-formal.json | 987 | `258098aba20e77fb4a009027e08c8d8c75c3106def64be846ba615422996f617` |
| source-after.json | 987 | `258098aba20e77fb4a009027e08c8d8c75c3106def64be846ba615422996f617` |
| formal.stdout.txt | 1948 | `bb9b1b2103fd95b01c4c8ab9b9bb3864fa03e4fd1e31b507631550a5dcb5c8e8` |
| formal.stderr.txt | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| formal.exit-code.txt | 12 | `1ca4a13146b2891c0e462123ac0cb848f92e6221f18b870a1b78c232d1956c35` |
| formal.run.json | 560 | `80e56bd7b68965e7f7a2898f299dc04f1a8a2f39c48d6c75b2bdd368e184bac2` |
| formal.hosts.json | 928 | `6ef7da3f1f476c3d18d3d96e8243a0e973b9107440b84c589da2c0f8b97e6f66` |
| negative-control.stdout.txt | 1802 | `ac6d775bab3dc50882d7d3f9f3442d259f2db072e371a379e765e05952e63f75` |
| negative-control.stderr.txt | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| negative-control.exit-code.txt | 12 | `0aac2256ca135e9e2ce682d26e680d8ec767e0c2897215d636113386fbc768af` |
| negative-control.run.json | 689 | `636f683695b7284a6aa8e3a90fa7d5e9797ce4da54b1d305180177a40c0ec6d6` |
| negative-control.hosts.json | 940 | `8f18118509a10b824ef0b5fa39d2b4ad651e63c94f474795ae8ac6c7d206ae43` |
| negative-control-mutation.json | 550 | `09ede68744a27efbf69561d1ecfb7ecfb98f41c1764a2059e8a897e0d82d6d52` |
| scope-verification.json | 456 | `dd523127bf553ce34275bf7fc6d41aa05b850693d68c89a309b2ddb8da3432da` |
| execution-summary.json | 3674 | `22a80cbc75c322262578d9475f7811a2233f70368490f36b47e5c1fc29c5aa91` |

受测六份源码前后三份清单逐字节相同。启动器、CLI及三业务模块与基线原字节相同；新增后测试文件22112字节，SHA-256为 `50cdb8bfe5f77549ec8fe906f1a32abc864d47dcdd948ab57ac5d23a7e8b6ebd`。tested-sources/保存受测原字节；formal-hosts/、negative-control-hosts/保存两宿主的新fixture副本、假child、哨兵和日志，均非真实照片或人员资料。全部明细及后续提交核对文件由本地 delivery-index.json 列出相对名、字节数和SHA-256。

## 取件、提交与未完成项

本机Windows独立Codex可实际读取 `D:\chatgpt\smart\EOF-REGRESSION-20261124T154722-f7fe0144`；完成提交、远端核对后在同级生成同名.zip供受控转交，最终回报其真实路径、大小及SHA-256。Git blob与受测字节的提交后核对、显式推送及ls-remote结果保存在本地 post-commit-verification.json，不向Git新增第三个路径。原始文件含个人运行时安装路径，保留为本地受控原件；上文只对Git报告中的个人目录作明确脱敏，没有把重命名副本冒充脱敏件。

这些本地路径不是云端附件。本轮没有云端上传或附件ID；若独立复审在云端执行，材料尚未向云端交付，需负责人实际上传上述ZIP。不得仅凭本地路径宣称云端已取件。

未完成项为：独立Codex复审及后续是否关闭该EOF样本覆盖限制的决定；没有宣告EOF验收关闭，也不宣称覆盖所有UTF-8组合。原NOT_COVERED快照、原失败、全部旧报告/日志/对象/引用保留。

不读真实凭据/照片/私钥、不连接设备、不重复登记、不清理旧残留、不运行E1/E2，不改生产启动器、CLI、业务模块、依赖、其他测试、默认simulation/长期/1号门/全天规则或allowRead。未修改网络/TLS/安全策略或全局/系统Git设置；不合并、部署、上线或作E1/E2放行。完成普通显式推送和远端SHA核对后停在 **Stop-EOF**。
