# HK-AI-08 原 Node 写入路径 / Windows ACL 接入核验（2026-11-23）

执行取证结论：**固定原 `fs-safe.mjs` 两个函数在本次受保护新合成根中的 mkdir/chmod、创建写入、重写样本取得 PASS/OK、退出码 0；本次新对象受控清理完成。完整原 CLI 仍为 LIVE_CLI_NOT_INTEGRATED，不作 E1 放行。**

本轮还保留了新启动器首次失败记录及其未清理的新引用，没有以第二次成功覆盖首次失败。实际发生两次局部合成核验，不是两次 E1；原探针 CLI、网络传输器、真实配置、设备和 E1/E2 均未运行。

## 1. 来源、分支和交付范围

- 独立分支：`feat/hk-ai-08-windows-node-integration-verification`；起点 `c1b39917ee8e0cfb4bf693a93b3c66a96f3ddff5`，保留所有旧工作树、报告、日志与引用。
- 原探针固定提交：`558b9c864a4b820e397336200758b143556a4d87`，由普通 Git fetch 取得，不以分支 tip 替代；没有 merge/cherry-pick 或改写原探针。
- 实际调用原文件：`tools/hikvision-probe/src/fs-safe.mjs`，Git blob `61bef04d51de884ac9eeb45d61eb5780e52b0c95`，1198 字节，SHA-256 `d618507e8ad74479945a36bbc1dd080e4b93b03e241ac53642c7d59b5d98613d`。
- [reference/SOURCE.md](../../../tools/hikvision-windows-node-integration/reference/SOURCE.md) 记录原字节取件；副本不改编码/换行/函数。worker 核对字节后从同一字节的 data URL 导入，仅调用两个导出，没有替身 validator、没有导入 CLI/probe/http。
- ACL 依据沿用已验收的 `EvidenceAcl.psm1`（SHA-256 `ca1a81bee7cc7f668067a07b956a971740c6ebdfca8c73ca64e9f745ff101bf9`）和修复后辅助源码 `Test-EvidenceAcl.ps1`（`e14793c80cd652c930d2fa8fa0ee670d7f077da216ccf6d7c6ff53c43d142a4b`）。新启动器只从固定哈希源码 AST 定义四个辅助函数，不执行旧主预检。
- 新代码/说明：[工具 README](../../../tools/hikvision-windows-node-integration/README.md)、新 PowerShell 启动器、Node worker、固定原文件副本及来源说明；另新增 [DS-K1T671BM 真机只读预检方案](../../tasks/HK-AI-08-WINDOWS-NODE-E1-READONLY-PLAN-2026-11-23.md) 和本证据。既有跟踪文件不修改。

## 2. 静态接入审计：不能直接运行原 CLI 的原因

以下定位均指固定原探针提交，是源码事实，不是设备结果：

| 原路径/行 | 已核对事实 | 接入影响 |
|---|---|---|
| `src/fs-safe.mjs:14–22,26–34` | Windows 跳过 POSIX mode 断言；仅递归 mkdir/chmod、writeFile/chmod，无 owner/DACL/reparse 检查；writeFile 可覆盖 | 必须先由 Windows 保护根包装；样本通过不把覆盖语义升级为 live 安全策略 |
| `cli.mjs:65,75–86` | runProbe 在输出目录确定/权限处理之前完成；之后又读取 env 的 outDir | 网络前输出保护及配置绑定仍缺 |
| `cli.mjs:32,39–61`、`probe.mjs:67–74,158–162` | env 别名、异步读取 CA、未深冻结的 config/指纹数组及认证时重读凭据 | 需要一次加载、私有复制/冻结、同份快照消费；离线 PASS 不自证绑定 |
| `src/allowlist.mjs:11,37–38,79–93` | 端点数组浅冻结，元素及返回对象仍可变 | 未来桥须固定端点对象及请求构造，不只冻结数组 |
| `src/probe.mjs` G1 状态分支 | G1 非 200 为 HTTP_STATUS，可能继续 G2；200 后才核型号 | 未来桥须实现身份未确认即不进入第二逻辑端点 |
| `src/probe.mjs` 401 分支 | 每端点可 Digest 重发一次，六逻辑端点最多十二次传输 | 不误写为全轮仅六次或七次 HTTP 请求 |
| `src/http.mjs` | socket inactivity timeout 无可见绝对总 deadline；pin 验证的首 HTTP 字节前时序待证 | 不把参数/注释当时序与总时限已验证 |
| `src/probe.mjs` 报告及 `cli.mjs` stdout | 实际端口、固定盐主机摘要、设备错误/路径可能进入输出 | 需要额外闭式脱敏投影，不能整体提交原报告/stdout |

原 `fs-safe.mjs` 没有 rename 或 cleanup 导出，本次不虚构这两条已接入路径。未运行原测试套件，其递归清理不适合本轮保全要求。

## 3. 实际本地执行、首次失败及最小修复

本机 Windows 原生入口，Windows PowerShell Desktop `5.1.22621.6133`（本轮只读运行时发现记录）；启动器严格要求 5.1、非管理员令牌及本地固定 NTFS。实际 Node 为 `v24.16.0`。没有安装依赖、运行时、WSL 或容器，没有执行策略绕过或管理员提权。

两次执行命令相同，启动器版本不同，均从本分支工作树根目录运行：

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\tools\hikvision-windows-node-integration\Test-NodeEvidenceAcl.ps1
```

| 执行 | 日期/时区 | 开始至结束 | 实际退出码 | 结果 |
|---|---|---|---:|---|
| run01 | 2026-11-23 +08:00 | 10:48:57.221–10:48:57.840 | 3 | FAIL / NODE_ENSURE_FAILED |
| run02 | 2026-11-23 +08:00 | 10:53:59.799–10:54:00.706 | 0 | PASS / OK，仅局部合成写入样本 |

run01 在新根创建并验证后进入 Node ensure 阶段，外层记录 `MethodInvocationException`；没有成功阶段摘要，`newObjectStateUnverified=true`，不从零文件计数推断不存在局部对象。保留引用 `hk-node-acl-549bdd3a8849407aa3dd9253ff28c6dd`，未访问、清理或复用。

无写入的 `node --version` 对照发现 WinPS 5.1 的 Get-Command 返回两个应用候选：原 Source 数组串化启动复现 MethodInvocationException / Win32Exception / NativeErrorCode 2；普通 PATH 首候选启动成功、版本 v24.16.0、退出 0、stderr 空。run01 原始内层异常没有被直接保存，诊断记录是独立的无写入对照，不能伪装为 run01 原异常原文。

新启动器的最小修复只在创建根之前按普通 PATH 顺序固定首 ApplicationInfo，验证文件存在并记录候选数量，不在启动/安全失败后回退其他候选，不改变 ACL/清理判定。首次执行源的完整原字节另存快照。修复经执行前独立静态复核后，run02 使用全新随机根；成功后不再执行额外核验。

### 原始 launcher stdout JSON

以下分别为 run01、run02 单行原始 JSON，原件 CRLF 结尾；代码块不表达行尾字节。stderr 均为零字节。三份 Node 子进程的 exitCode 与反序列化结果保存在 launcher JSON 的 stages 中；**没有另存三份子进程原始 pipe 字节，不将这些摘要冒称独立原始日志。**

```json
{"scope":"synthetic-original-node-windows-acl-integration-only","status":"FAIL","code":"NODE_ENSURE_FAILED","integrationState":"LIVE_CLI_NOT_INTEGRATED","checks":{"platformSupported":true,"sourcesPinned":true,"identitySupported":true,"locationSupported":true,"directoryCreatedProtected":true,"originalEnsurePreservedAcl":false,"nodeCreatedFilesInheritedAcl":false,"nodeRewritePreservedAcl":false,"contentsVerified":false,"broadenedAclRejected":false,"cleanupVerified":false},"counts":{"directoriesCreated":1,"filesCreated":0,"filesRewritten":0,"filesDeleted":0,"directoriesDeleted":0,"nodeProcesses":0,"ensureCalls":0,"writeCalls":0,"negativeControls":0},"evidenceRef":"hk-node-acl-549bdd3a8849407aa3dd9253ff28c6dd","nodeVersion":"","stages":[],"nodeInvocationAttempts":1,"newObjectStateUnverified":true,"errorType":"System.Management.Automation.MethodInvocationException","deviceRequests":0,"e1":"NOT_EXECUTED","e2":"NOT_EXECUTED"}
```

```json
{"scope":"synthetic-original-node-windows-acl-integration-only","status":"PASS","code":"OK","integrationState":"LIVE_CLI_NOT_INTEGRATED","checks":{"platformSupported":true,"sourcesPinned":true,"identitySupported":true,"locationSupported":true,"directoryCreatedProtected":true,"originalEnsurePreservedAcl":true,"nodeCreatedFilesInheritedAcl":true,"nodeRewritePreservedAcl":true,"contentsVerified":true,"broadenedAclRejected":true,"cleanupVerified":true},"counts":{"directoriesCreated":1,"filesCreated":2,"filesRewritten":2,"filesDeleted":2,"directoriesDeleted":1,"nodeProcesses":3,"ensureCalls":1,"writeCalls":4,"negativeControls":1},"evidenceRef":"hk-node-acl-8023cbfe08e44160a493abacd7c88246","nodeVersion":"v24.16.0","nodeCandidateCount":2,"stages":[{"stage":"ensure","exitCode":0,"result":{"scope":"synthetic-original-node-writer-only","status":"PASS","stage":"ensure","nodeVersion":"v24.16.0","counts":{"ensureCalls":1,"writeCalls":0,"filesObserved":0},"code":"OK"}},{"stage":"write","exitCode":0,"result":{"scope":"synthetic-original-node-writer-only","status":"PASS","stage":"write","nodeVersion":"v24.16.0","counts":{"ensureCalls":0,"writeCalls":2,"filesObserved":2},"code":"OK"}},{"stage":"rewrite","exitCode":0,"result":{"scope":"synthetic-original-node-writer-only","status":"PASS","stage":"rewrite","nodeVersion":"v24.16.0","counts":{"ensureCalls":0,"writeCalls":2,"filesObserved":2},"code":"OK"}}],"nodeInvocationAttempts":3,"newObjectStateUnverified":false,"errorType":"","deviceRequests":0,"e1":"NOT_EXECUTED","e2":"NOT_EXECUTED"}
```

run02 十一项 checks 均为 true：平台、固定源码、身份、位置、新目录保护、原 ensure 保持 ACL、Node 新文件自然继承、Node 重写保持 ACL、内容、内存宽 ACL 负控拒绝、清理确认。实际三个 Node 阶段均退出 0，ensureCalls=1，writeCalls=4；两个文件创建、重写、删除各 2，目录创建/删除各 1，negativeControls=1。只对本次新根完成受控清理，`newObjectStateUnverified=false`。

## 4. 源码及日志工件

实际测试期间，本轮工具五个文件前后字节不变。run02 最终启动器为 14918 字节，SHA-256 `5631912942137159a6061721b43b996ab8a600e9623698c4fc35c6d3a101630f`；worker 为 7655 字节，SHA-256 `27b3d06237939a122e1fbfbc10db3bc03f15c5dfe7611b959740950aa8914f0e`。来源副本哈希见 §1；完整五文件清单在 sources-before/after 中。真机方案 SHA-256 为 `c7c3da748eedfd20f97331dbef58828aa73d0335f64d4861156eb6663ac513df`。

日志相对本工作树根目录：`../HK-AI-08-windows-node-integration-2026-11-23-run01/` 和 `../HK-AI-08-windows-node-integration-2026-11-23-run02/`，仅本机保留，不提交 Git。外层分别捕获原始 stdout/stderr BaseStream，WaitForExit 后立即保存独立 ExitCode，不用后续 LASTEXITCODE 替代。原始与脱敏 stdout 字节相同，没有个人路径、账号、SID、真实配置或设备数据。

同一行多个文件各自具有所列字节数/哈希：

| 目录/文件 | 字节数 | SHA-256 |
|---|---:|---|
| run01 `integration.stdout.raw.bin`、`integration.stdout.redacted.txt` | 934 | `4aa99fc43445be009d8af5a8ea00cde32aec29cea52dbb7fe44512ca3a728f8b` |
| run02 `integration.stdout.raw.bin`、`integration.stdout.redacted.txt` | 1546 | `9882f0b6fa1617f9768643e537a2165b57a4f0ff5d0f54109cd686a786e5e48f` |
| 两目录各自 `integration.stderr.raw.bin`、`integration.stderr.redacted.txt` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| run01 `integration.exit.json` | 415 | `636c7247e7f30367730f49e9d07b64055eab33cf8604d51f338016c77c985234` |
| run02 `integration.exit.json` | 453 | `b0732ff2716adbeb1b84b988c60b727ef5ed0c09334f6dc474354b845dd7dd19` |
| run01 `launcher.executed.ps1.txt`（失败时启动器原字节快照） | 14431 | `a9abfcc5bdb687828501e4a1bb98c7e1b56885774f3272b98427cfbb4225fdca` |
| run01 `runtime-diagnostic.summary.json`（无写入对照摘要，非原始管道字节） | 443 | `36a455bbaccd85e2897ea2a509b4e3f2ce1495eea465bf702c4863799978cf02` |
| run01 `sources-before.json`、`sources-after.json` | 954 | `73aae1c74f99eb406d5b3e19e073415f85acfa7566c73d3478f9eb1492b3a917` |
| run02 `sources-before.json`、`sources-after.json` | 954 | `92aefd4b77c6828a32073cb7b828396d09dbb212a563b3d4f4ac68cc4a61dcd4` |
| run01 `preservation-before.json`、`preservation-after.json` | 17987 | `752b3ed0e43fd76369dfd93b0cb272d4adb597c67e1bac827aa066036822e925` |
| run02 `preservation-before.json`、`preservation-after.json` | 20645 | `c8647212c15ea0ccb1a11845c86b2e05b6d739372cf3fa2eb409ddceb00d40e2` |
| run01 `preservation.json` | 306 | `3a7129c434ffb6530f468b55baa008a70e79b00db2370eeee576bc59179f0f9e` |
| run02 `preservation.json` | 416 | `fe6ff3b775cf3aeb7ea8e9aeea8cc9e07e49597e15cb3372c3520143b84bbbfc` |

run01 的 84 项既有原件前后不变；run02 的 96 项将上述 84 项及本轮首次失败的 12 个记录/快照/诊断原件一并保全，前后清单逐字节相同。四份既有报告和全部旧证据未更改，不以新样本结果改写旧 FAIL。

## 5. 未证明项、方案和停止点

新局部核验只证明所记录的固定原函数、Node/Windows 版本及这一次受控新根样本。PS helper 在哈希检查后仍会再次读取路径以解析/导入；PowerShell 跨阶段和清理只比较 ACL/路径/创建时间，创建时间不是不可伪造的原生文件 ID；Node dev/ino/nlink 检查仅覆盖各阶段内。未原子消除同用户/管理员并发替换、祖先替换或内存修改，不证明 Windows/POSIX 等价或完整 CLI 的机密数据写入已安全接通。

[只读预检方案](../../tasks/HK-AI-08-WINDOWS-NODE-E1-READONLY-PLAN-2026-11-23.md) 明确一次私有规范化配置快照、核对与执行同份绑定、独立一次性授权、配置/文件/网络/审批四层 TOCTOU、六条精确 GET（每端点 Digest 最多一次重发，总传输上限十二）、G1 先证身份、pin-only 准确语义、绝对 deadline、闭式脱敏及停止条件。其完整 live 桥和 22 项未来测试均为 NOT_IMPLEMENTED/NOT_EXECUTED，不借本轮局部 PASS 填真 `sameConfigBound` 或 E1 ready。

Node Windows mode 的限制可对照 [Node v24.16.0 官方文件系统文档](https://nodejs.org/download/release/v24.16.0/docs/api/fs.html#fschmodpath-mode-callback)；API 通用存在性不代替目标能力，官方协议资料引用见方案。没有把 DS-K1T671BM 近似型号/系列资料当本机固件能力，激活、账号、证书、实际地址/端口仍未核验。不重新要求隔离网络。

保留三个不同引用：既有失败 `hk-acl-f03a3e07eb4f4c13a5ee8d1326ec84a4`、本轮首次启动器失败 `hk-node-acl-549bdd3a8849407aa3dd9253ff28c6dd`、本轮成功样本 `hk-node-acl-8023cbfe08e44160a493abacd7c88246`。前两者不访问、不清理、不认领，当前状态未知；后一引用的本次新对象只按工具成功路径完成清理。

本轮设备连接/GET/写入均为 0；未运行原探针 CLI、E1/E2、网络/DNS/监听测试、真实配置/凭据/照片/人员/权限操作或部署。只访问 Git 远端及公开官方资料；不改 Git/TLS/代理/系统安全策略，不重写历史，不推 main。追加提交、普通推送后核对远端 SHA，随即停止并交独立复审，不自行续阶段或宣布 E1 放行。
