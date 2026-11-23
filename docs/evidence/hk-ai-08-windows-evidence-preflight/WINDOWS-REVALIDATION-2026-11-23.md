# HK-AI-08 固定修复提交 Windows 实际复验（2026-11-23）

本机执行取证结果：**纯策略 PASS（51/51）、纯内存投影 PASS（12/12），随后唯一一次主预检 PASS/OK、退出码 0；九项 checks 全为 true，五项 counts 均为 1，工具确认本次新合成对象清理成功。**

执行方不是最终独立验收方。本报告记录用户在代码与证据复审后授权的实际复验，不启动 E1/E2，不回填或覆盖原失败证据；交付后停手等待复审。

## 1. 固定来源、工作树及实际环境

- 仓库：`https://github.com/1997dmsu-sketch/SMART-PM.git`。
- 固定工具完整提交/新工作树起点：`e7b36d1c1f80371f8a060ab94aaff1c5a5578f8b`；唯一父提交为原报告提交 `6f20899cfbea3938e4656766f67ee066fce1c1a5`，原工具来源为 `3bb0b95df351ef357aedff6a21a275a19b92b6f2`。
- 新独立文档分支：`docs/hk-ai-08-windows-revalidation-2026-11-23`；新工作树：`SMART-PM-windows-revalidation-2026-11-23`。创建前查询远端未发现此文档分支；修复分支仍指向固定 e7b36d1 提交。未用远端最新 tip 替代固定对象。
- 原取件、原取证及修复工作树均保留，没有切换、清理或覆盖。新工作树执行前 HEAD 为固定提交，`git status --porcelain=v1 --untracked-files=all` 为空。固定提交树/本地范围未发现 AGENTS.md。
- 创建工作树仅在该命令使用 `-c core.autocrlf=false`；Git 所有者检查仅使用明确任务路径的单次 `-c safe.directory=...`。未修改全局/系统 Git、TLS、代理或安全策略。
- 实际平台：本机 `Win32NT`，`Microsoft Windows NT 10.0.22631.0`，不是 Linux 或模拟 Windows ACL。
- 实际哈希核对及三个工具进程均由 `powershell.exe` 启动：Desktop `5.1.22621.6133`，CLR `4.0.30319.42000`，64 位，非管理员令牌（`isElevated=false`）。外层 PowerShell Core 仅作进程/日志/Git 编排，没有代替工具运行时。
- 实际日期 2026-11-23，时区 UTC+08:00（Asia/Shanghai），未跨日。没有安装/升级运行时、Pester、依赖、WSL 或容器，也未恢复隔离网络要求。

## 2. 原始字节哈希：执行前后相同

在 Windows PowerShell 5.1 内使用自带 `.NET Framework System.Security.Cryptography.SHA256` 对 `File.OpenRead` 原始字节计算，未修改换行、重编码或工具。下列每项执行前、执行后均匹配固定提交已核对值；前后辅助核对退出码均为 0。

| 工具目录内文件 | 执行前 SHA-256 | 执行后 SHA-256 |
|---|---|---|
| `EvidenceAcl.psm1` | `ca1a81bee7cc7f668067a07b956a971740c6ebdfca8c73ca64e9f745ff101bf9` | `ca1a81bee7cc7f668067a07b956a971740c6ebdfca8c73ca64e9f745ff101bf9` |
| `Test-EvidenceAcl.Tests.ps1` | `de08193b058754807c16ca6372ca2db4840c55f1372a607dbff3cb5fcb44336c` | `de08193b058754807c16ca6372ca2db4840c55f1372a607dbff3cb5fcb44336c` |
| `Test-EvidenceAcl.ps1` | `e14793c80cd652c930d2fa8fa0ee670d7f077da216ccf6d7c6ff53c43d142a4b` | `e14793c80cd652c930d2fa8fa0ee670d7f077da216ccf6d7c6ff53c43d142a4b` |
| `Test-NativeAclProjection.Tests.ps1` | `61ebfe64f8b086f1692492ea17097637f999a1f1cc93b8b0af9fe6acbd2338c9` | `61ebfe64f8b086f1692492ea17097637f999a1f1cc93b8b0af9fe6acbd2338c9` |

### 准备期辅助命令失败，完整保留

本轮最初的 `run01` 在 10:04:33 +08:00 仅尝试外层哈希辅助核对，其中 `Get-FileHash` 在该 Windows PowerShell 5.1 进程内不可用，出现 `CommandNotFoundException / ObjectNotFound`；前后两次辅助核对各退出 1、stdout 为空、stderr 各 446 字节。**run01 的策略、投影和主预检均 NOT_EXECUTED，主调用次数为 0。**

这不是脚本哈希不符或工具测试失败，也没有组织执行策略/签名/防护拦截的错误证据。未安装命令或修改运行环境，仅将外层哈希辅助改用同一运行时自带的 .NET SHA-256。保留 run01 全部 14 个文件后，在新的 `run02` 完成核对与实际执行；没有改工具或绕过失败断言。两个记录目录不代表两次主预检，**本轮主预检总调用次数为 1**。

## 3. 实际顺序、命令、退出码与原始 JSON

以下全部从新工作树根目录执行；三个阶段各启动一个独立 Windows PowerShell 5.1 进程。只有前一纯测试退出 0、JSON PASS、实际计数完整、失败 ID 为空且 stderr 为空，才继续下一阶段。

| 阶段 | 实际开始（+08:00） | 实际结束（+08:00） | 退出码 |
|---|---|---|---:|
| .NET 字节哈希/运行时前核对 | 10:06:33.336 | 10:06:33.647 | 0 |
| 纯策略测试 | 10:06:33.685 | 10:06:34.380 | 0 |
| 纯内存投影回归 | 10:06:34.393 | 10:06:34.834 | 0 |
| 主预检（唯一一次） | 10:06:34.839 | 10:06:35.309 | 0 |
| .NET 字节哈希/运行时后核对 | 10:06:35.327 | 10:06:35.542 | 0 |

三条实际工具命令：

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\tools\hikvision-windows-evidence-preflight\Test-EvidenceAcl.Tests.ps1
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\tools\hikvision-windows-evidence-preflight\Test-NativeAclProjection.Tests.ps1
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\tools\hikvision-windows-evidence-preflight\Test-EvidenceAcl.ps1
```

通过 `System.Diagnostics.Process` 分别将 stdout/stderr 的 `BaseStream` 复制到 `CreateNew` 原始文件，不经 PowerShell 文本重定向改编码。每次 `WaitForExit()` 后立即读取独立 `ExitCode` 并保存；没有让后续命令覆盖 `$LASTEXITCODE`。完整辅助核对命令也保存在对应 `*.exit.json` 中。捕获器自身退出 0 不作为工具结果。

三份原始 stdout 单行 JSON 如下，原件均以 CRLF 结尾，代码块不表示行尾字节：

```json
{"scope":"synthetic-acl-policy-tests-only","status":"PASS","counts":{"total":51,"passed":51,"failed":0},"failedCaseIds":[]}
```

```json
{"scope":"memory-only-native-acl-projection-tests","status":"PASS","counts":{"total":12,"passed":12,"failed":0},"failedCaseIds":[]}
```

```json
{"scope":"synthetic-windows-evidence-permissions-only","status":"PASS","code":"OK","checks":{"platformSupported":true,"identitySupported":true,"locationSupported":true,"ancestorsClear":true,"directoryAclValid":true,"sentinelContentValid":true,"fileAclValid":true,"broadenedAclRejected":true,"cleanupVerified":true},"counts":{"directoriesCreated":1,"filesCreated":1,"filesDeleted":1,"directoriesDeleted":1,"negativeControls":1},"evidenceRef":"hk-acl-ede6254418504fb5be49561f3cdb0865"}
```

纯策略实际 51 个、通过 51、失败 0，失败 ID 为空。源码仍是 ACL-01 至 ACL-51，8 个预期接受、43 个预期拒绝；正确拒绝预期拒绝场景也算通过。纯内存投影实际 12 个、通过 12、失败 0，失败 ID 为空；其 2 个接受、10 个拒绝是源码分类。本轮没有将声明数预填为实测数。

### 九个 checks、五个 counts 与清理状态

| check | 实际值 |
|---|---|
| `platformSupported` | true |
| `identitySupported` | true |
| `locationSupported` | true |
| `ancestorsClear` | true |
| `directoryAclValid` | true |
| `sentinelContentValid` | true |
| `fileAclValid` | true |
| `broadenedAclRejected` | true |
| `cleanupVerified` | true |

| count | 实际值 |
|---|---:|
| `directoriesCreated` | 1 |
| `filesCreated` | 1 |
| `filesDeleted` | 1 |
| `directoriesDeleted` | 1 |
| `negativeControls` | 1 |

新非敏感引用：`hk-acl-ede6254418504fb5be49561f3cdb0865`。本次新目录/新哨兵文件由工具自身完成受控清理（`cleanupVerified=true`）；内存宽 ACL 负控被拒绝。没有人工重设 ACL、补删或重试主预检。

旧引用仍为 `hk-acl-f03a3e07eb4f4c13a5ee8d1326ec84a4`，与新引用不同。未访问旧候选、检查其当前存在/内容、清理或认领其对象。本次新成功不改写原 `FAIL/CLEANUP_FAILED`，不证明旧目录已清理，也不据此确定原始异常的唯一原因。

## 4. 日志、脱敏副本与字节证据

所有定位相对新工作树根目录；日志仅本机保留，不纳入单文件报告提交。

- 正式执行目录：`../HK-AI-08-windows-revalidation-2026-11-23-run02/`（下表默认目录）。
- 准备失败目录：`../HK-AI-08-windows-revalidation-2026-11-23-run01/`（标注 run01 的行）。
- run02 五阶段 stdout 原件与脱敏副本逐字节一致，stderr 原件及副本均为空。没有输出真实 SID、用户名或个人绝对路径。
- run01 stderr 原始字节保留；最初 UTF-8 容错解码副本含替代字符，也原样保留。依据该 Windows 5.1 的默认代码页 936，新增正确解码后 UTF-8 脱敏副本到 run02，没有改动原件。报告只引用非敏感错误类别，不粘贴异常原文。

同一行多个文件各自具有所列字节数与 SHA-256；`*.stdout`/`*.stderr` 命名均指下面明确列出的阶段。

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `policy.stdout.raw.bin`、`policy.stdout.redacted.txt` | 125 | `9c62a3688956906740f6c2730efb469891bec302802c51f08ba691deae244b13` |
| `projection.stdout.raw.bin`、`projection.stdout.redacted.txt` | 133 | `6d75a00fd805496d9ba1f5527e89d64e51cd0576ed3451e6c51eef9133742f26` |
| `native.stdout.raw.bin`、`native.stdout.redacted.txt` | 485 | `4aba2103291939275424b1521ce2826d08b7ea9fe97efd520767c02b27d95c75` |
| `precheck.stdout.raw.bin`、`precheck.stdout.redacted.txt`、`postcheck.stdout.raw.bin`、`postcheck.stdout.redacted.txt` | 980 | `c2bc73c400480e5c35b184391b10c9cbc6deb0af3f4c01e8e994cd4d9709b95f` |
| run02 precheck/policy/projection/native/postcheck 各自 `.stderr.raw.bin`、`.stderr.redacted.txt`（共 10 文件） | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `policy.exit.json` | 346 | `2bac0c543a0e7d53ad523b9cfd6747c9143cf915e3780df46fe1d458a2ad3925` |
| `projection.exit.json` | 358 | `4c3f510a2bdc5ed867b8d0289f8b5155c4ac9177662bdbaa8f25a909cd1ca60f` |
| `native.exit.json` | 340 | `ac6c4c59707c93ac8f6d1bd44a92a64b307a75c24bc4c1043c49198a5bf417a7` |
| `precheck.exit.json` | 2434 | `a105fa3865afd919e7ed30dcaee2b7fb6e7a5089d48557d4fcd206218d215e01` |
| `postcheck.exit.json` | 2435 | `96725c87be2611481eacf9b78bf19c6cb4f2a644504624a12f290c058fc6f20b` |
| `execution.json` | 6898 | `527e2f1f5f82343b97f3ac7feb68937a972e09d8e2cdcb23fa96759e28019dbc` |
| `preservation-before.json`、`preservation-after.json` | 10236 | `e83728a55d7fe39b7b905d4e312027eb2cf2c6c403bbbf110eae92fc5d409fca` |
| `preservation.json` | 202 | `9084c8db414c32a84117814b87dd29a61d00da91dfb95632ba09bfdf3514994b` |
| `artifact-manifest.json`（列出生成时 31 个正式工件，不含自身） | 4755 | `3e37f7177c0f48197358d8b11c3fa24f8f0e6d55b576cd5001cf041bb8b9441b` |
| run01 的 precheck/postcheck 各自 `.stdout.raw.bin`、`.stdout.redacted.txt`（共 4 文件） | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| run01 `precheck.stderr.raw.bin`、`postcheck.stderr.raw.bin` | 446 | `c6110bf1bfa652eb8df82ac5bff57d2875b1ba443d5d807cd68758497029e9e3` |
| run01 `precheck.stderr.redacted.txt`、`postcheck.stderr.redacted.txt`（初始解码副本） | 615 | `1590d50912120df06d60e55eb6e1327d2a6dd9ff65ecd533ac794fc5ea69700f` |
| run02 `preparation-precheck.stderr.cp936.redacted.txt`、`preparation-postcheck.stderr.cp936.redacted.txt`（正确解码副本） | 511 | `e5e30a5828c83690a259711157333016134b268710ab33096b37aa2f7417ef76` |
| run01 `execution.json` | 6105 | `86c5c797fb15d24961b80df1ed0ea2d1ba14ab9e888e77425f7a7285e9f135ab` |

`preservation-before/after.json` 明确列出并逐项核对 48 项：12 个原取证文件、20 个修复取证文件、14 个本轮准备失败记录、2 份既有报告；前后字节相同，所有原件的字节数及哈希未变。`execution.json` 分别记录 run01 主调用 0、run02 主调用 1；阶段退出码、开始结束时间及完整参数均保留。

既有 [WINDOWS-VALIDATION-2026-11-23.md](WINDOWS-VALIDATION-2026-11-23.md)（15287 字节，SHA-256 `40e95cb34bd10ffb66ce073e7f92a5e3b8168b0017220b2e2ccd2ad9ef076291`）和 [CLEANUP-FIX-2026-11-23.md](CLEANUP-FIX-2026-11-23.md)（8141 字节，SHA-256 `e078870c09d0d42e45e18fef7d8910b3fdd29bdc16b3b589ee366111626b5aca`）原样保留。

## 5. 层次、限制与交付停止点

静态复审证明的是固定差异及门禁未放宽；纯策略 51 场景和内存投影 12 场景分别证明各自实际执行范围；本次 Windows 原生检查才实际覆盖新合成目录/文件的 ACL、自然继承、哨兵读写、内存负控及受控清理。三者不互相冒充。

本轮新合成预检成功仍不证明 Windows 与 POSIX 0700/0600 全场景等价、跨用户拒绝读取、原探针 Node 写入路径、同份配置绑定或 TOCTOU 已解决，也不证明设备激活、地址/账号/证书或接口能力。原始失败的初始异常仍没有保存，不能将本次通过改写为唯一根因的证明。

没有读取真实设备配置/凭据，没有枚举环境变量、计划任务、凭据管理器或秘密目录；日志脱敏仅使用当前用户名/profile 字符串，哈希辅助只核对非管理员令牌，均未输出身份值。设备连接/GET、扫描、门禁探针、E1/E2、真实照片/人员/权限、支付、生产云、HTTP/UI、合并、部署和上线均未执行；只为 Git 取件/交付访问仓库远端。

没有 ExecutionPolicy Bypass、Unblock-File、关闭防护、管理员提权、手动清理、宽 ACL、脚本修改、跳过断言或人工 PASS；没有 amend、rebase、reset、squash、force、merge 或 cherry-pick，不推 main。工具仅操作本次新随机对象，没有接收旧引用或任意清理目标。

本轮仅新增本文到独立文档分支，日志留在本机；提交前核对差异只有本文并执行 diff/show 空白检查。追加提交、普通 push 的显式 refspec 和远端完整 SHA 核对结果据实际 Git 输出另行交付，不在报告预填自身提交号或推送成功。完成后停止，等待独立复审，不自行宣布 E1 放行。
