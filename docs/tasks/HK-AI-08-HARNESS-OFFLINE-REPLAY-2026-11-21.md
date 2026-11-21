# HK-AI-08 · Harness Windows 离线复现派单（2026-11-21）

## 1. 状态与可复制任务正文

派单状态：**NOT_DISPATCHED**；Windows 执行状态：**NOT_EXECUTED**。当前准备方没有可调用的 Harness 工具／CLI，本文不是派单成功或 Windows 通过的证据，不编造派单号。

> 交给一个全新的 Windows Harness 会话执行本卡，仅复现已批准的合成离线套件并提交单份报告。来源提交固定为 `31f20c9a372c447f142312f6e95e0400372f9ee8`；先阅读随包 README 与两份本轮准备卡，校验字节后才运行唯一命令。不要同时运行业务探测，以免共享进程／全局桩的计数被污染。这个会话独立要求不是网络隔离要求。
>
> 禁止安装／升级依赖或 Node、修改全局／系统／仓库 Git 与 TLS 配置、修改批准的四文件、真实配置／环境凭据读取、原 probe、真实 CLI 启动、HTTP／后台／其他套件、设备／支付／生产云、真实子进程负控。不要 `node cli.mjs`，不要传入真实主机、账号或密码。仅运行 Node 内建合成测试，以注入流在同进程测试 CLI；正控调用的 guard 桩不转发真实网络／监听／子进程方法。PowerShell 启动获准的 Node 测试主进程，不等于允许业务代码启动子进程。
>
> 用户已免除隔离网络前置；设备准备按现有网络的单目标范围另卡登记。实际连接／写入仍未授权，离线 PASS 不放行 E1/E2，也不放行合并、HTTP/UI、部署或上线。

## 2. 固定取件与批准字节

优先使用交接方提供的 ZIP；从同一次交接取得 ZIP 的 SHA-256，缺失即 BLOCKED。ZIP 仅含四批准文件、两本轮准备卡、`MANIFEST.json` 及参考日志。只解压到全新本地非共享、非同步目录，不覆盖旧目录。

`MANIFEST.json` schema 为 `{source_commit, prep_commit, files:[{path,sha256,bytes}]}`。`source_commit` 必须等于固定来源；`prep_commit` 为交接方最终真实准备提交完整 SHA，不自行推断。`files` 仅七项，不包含 manifest 自身；两新卡只阅读，任何路径均不得动态转成执行命令。

| 批准文件（来源提交） | 固定 SHA-256 |
| --- | --- |
| `tools/hikvision-offline-config-checker/src/check-config.mjs` | `a8dbde46942aca550e13fdddb27e93bd5c9d1902e8cbdfb09cb31befc0eecfb7` |
| `tools/hikvision-offline-config-checker/cli.mjs` | `e6c59224a3b8cacf8e30198363eefd255dc2925fbcc116e3be652c4d3b35e185` |
| `tools/hikvision-offline-config-checker/test/check-config.test.mjs` | `66175ee2db3159db1f349bd4bdbe02fe0a284ac7487fde93eb6da2f79d74d972` |
| `docs/evidence/hk-ai-08-offline-config-checker/README.md` | `fc659f7cf731643330d84dd9b50e9549264fa8161ffef095c344fb3080676e6d` |

另三项：本卡、`docs/tasks/HK-AI-08-E1-E2-HARNESS-PREPARATION-2026-11-21.md`、`reference/linux-node-v24.22.1-tests.log`。参考日志 SHA-256 固定为 `6af4b9fe07c361c04c8f42f95da63a468d25951f1795a164eb235124613f301e`，仅供比较，不执行。

也可由已有 Git 对象按完整固定 SHA 使用 `git archive` 提取批准文件字节，再取得同版准备卡／manifest／日志；禁止用 PowerShell `git show > 文件` 造成文本重编码，禁止改 autocrlf 或修正批准文件。仍须完成同一套 SHA-256／字节数校验；无法保证完整包与字节则停止取件。

## 3. PowerShell 取件、核验与唯一执行命令

以下命令只作静态审查：准备方没有 PowerShell，**未声称已执行这些命令**。Harness 应在专用新会话逐段执行；任何 `throw` 均停止，不删除 guard、不换隔离模式、不另装运行时。输入路径仅为本地交接 ZIP 与非共享工作根目录，不输入凭据；不要将个人绝对路径粘贴进报告。

```powershell
$ErrorActionPreference = 'Stop'
$SourceSha = '31f20c9a372c447f142312f6e95e0400372f9ee8'
$ZipPath = (Resolve-Path -LiteralPath (Read-Host '交接ZIP本地路径')).Path
$BasePath = (Resolve-Path -LiteralPath (Read-Host '本地非共享非同步工作根目录')).Path
$ExpectedZipHash = (Read-Host '同次交接给出的ZIP SHA256').Trim().ToLowerInvariant()
if ($ExpectedZipHash -notmatch '^[0-9a-f]{64}$') { throw 'BLOCKED: ZIP哈希缺失或非法' }
if ((Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedZipHash) { throw 'BLOCKED: ZIP哈希不符' }
$RunRoot = Join-Path $BasePath ('hk-ai-08-' + [Guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $RunRoot) { throw 'BLOCKED: 目录已存在' }
$null = New-Item -ItemType Directory -Path $RunRoot
$PackageRoot = Join-Path $RunRoot 'package'
$EvidenceRoot = Join-Path $RunRoot 'evidence'
$null = New-Item -ItemType Directory -Path $PackageRoot
$null = New-Item -ItemType Directory -Path $EvidenceRoot
Expand-Archive -LiteralPath $ZipPath -DestinationPath $PackageRoot
$Fixed = @{
 'tools/hikvision-offline-config-checker/src/check-config.mjs' = 'a8dbde46942aca550e13fdddb27e93bd5c9d1902e8cbdfb09cb31befc0eecfb7'
 'tools/hikvision-offline-config-checker/cli.mjs' = 'e6c59224a3b8cacf8e30198363eefd255dc2925fbcc116e3be652c4d3b35e185'
 'tools/hikvision-offline-config-checker/test/check-config.test.mjs' = '66175ee2db3159db1f349bd4bdbe02fe0a284ac7487fde93eb6da2f79d74d972'
 'docs/evidence/hk-ai-08-offline-config-checker/README.md' = 'fc659f7cf731643330d84dd9b50e9549264fa8161ffef095c344fb3080676e6d'
 'reference/linux-node-v24.22.1-tests.log' = '6af4b9fe07c361c04c8f42f95da63a468d25951f1795a164eb235124613f301e'
}
$Allowed = @($Fixed.Keys) + @(
 'docs/tasks/HK-AI-08-HARNESS-OFFLINE-REPLAY-2026-11-21.md',
 'docs/tasks/HK-AI-08-E1-E2-HARNESS-PREPARATION-2026-11-21.md'
)
$ManifestPath = Join-Path $PackageRoot 'MANIFEST.json'
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Manifest.source_commit -cne $SourceSha -or $Manifest.prep_commit -cnotmatch '^[0-9a-f]{40}$') { throw 'BLOCKED: 来源元数据不符' }
$Entries = @($Manifest.files)
if ($Entries.Count -ne 7 -or @($Entries.path | Sort-Object -Unique).Count -ne 7) { throw 'BLOCKED: manifest条数/重复错误' }
foreach ($Entry in $Entries) {
 if ($Allowed -cnotcontains $Entry.path -or $Entry.sha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'BLOCKED: manifest路径/哈希非法' }
 $FilePath = Join-Path $PackageRoot $Entry.path
 $Item = Get-Item -LiteralPath $FilePath
 if ($Item.PSIsContainer -or ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'BLOCKED: 非普通文件' }
 $Hash = (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
 if ($Hash -cne $Entry.sha256 -or $Item.Length -ne $Entry.bytes) { throw 'BLOCKED: 字节不符，不得修复文件' }
 if ($Fixed.ContainsKey($Entry.path) -and $Hash -cne $Fixed[$Entry.path]) { throw 'BLOCKED: 与批准字节不符' }
}
$Inventory = Get-ChildItem -LiteralPath $PackageRoot -Recurse -Force
if (@($Inventory | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -ne 0) { throw 'BLOCKED: 包内含重解析点' }
if (@($Inventory | Where-Object { -not $_.PSIsContainer }).Count -ne 8) { throw 'BLOCKED: 包内文件数不符' }
```

核验同时检查工作根目录及其上级没有共享／同步／重解析重定向；不能确认就另选获准本地目录。包的 manifest／参考日志哈希与批准四文件哈希应写入报告，不仅写“校验通过”。

```powershell
# 只检查Node注入钩子是否存在，不读取或打印其值，不清空环境变量。
if ((Test-Path -LiteralPath Env:NODE_OPTIONS) -or (Test-Path -LiteralPath Env:NODE_PATH)) { throw 'BLOCKED: 存在Node注入钩子，停止交负责人' }
$Node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$OldPreference = $ErrorActionPreference
try {
 $ErrorActionPreference = 'Continue'
 & $Node --version 1> (Join-Path $EvidenceRoot 'node-version.stdout.txt') 2> (Join-Path $EvidenceRoot 'node-version.stderr.txt')
 $VersionExit = $LASTEXITCODE
 & $Node --help 1> (Join-Path $EvidenceRoot 'node-help.stdout.txt') 2> (Join-Path $EvidenceRoot 'node-help.stderr.txt')
 $HelpExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $OldPreference }
if ($VersionExit -ne 0 -or $HelpExit -ne 0) { throw 'BLOCKED: 已安装Node不可用' }
$HelpText = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'node-help.stdout.txt') -Raw
if ($HelpText -notmatch '--test-isolation' -or $HelpText -notmatch '--test-reporter') { throw 'BLOCKED: 不支持固定测试参数，不安装/不改隔离' }
[Environment]::OSVersion.VersionString | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'os.txt') -Encoding UTF8
$PSVersionTable.PSVersion.ToString() | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'powershell-version.txt') -Encoding UTF8
$Stdout = Join-Path $EvidenceRoot 'tests.stdout.txt'
$Stderr = Join-Path $EvidenceRoot 'tests.stderr.txt'
Push-Location -LiteralPath $PackageRoot
try {
 $ErrorActionPreference = 'Continue'
 & $Node --test --test-isolation=none --test-reporter=spec tools/hikvision-offline-config-checker/test/check-config.test.mjs 1> $Stdout 2> $Stderr
 $TestExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $OldPreference; Pop-Location }
$TestExit | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'tests.exit.txt') -Encoding UTF8
Get-FileHash -LiteralPath $Stdout,$Stderr,$ManifestPath -Algorithm SHA256 |
 Select-Object Hash | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'artifact-hashes.json') -Encoding UTF8
```

`$LASTEXITCODE` 均在对应命令后立即保存。不同 PowerShell 对原生命令重定向的编码可能不同；上述文件是 PowerShell 捕获文本，不冒称保留 Node 原始输出字节。保留其实际字节哈希与 PowerShell 版本，原日志不覆盖；若含用户路径，另做脱敏副本并分别登记哈希。执行后重新核验七文件哈希，批准文件必须仍逐字节不变。

## 4. 判定与报告模板

Linux 比较值为 **Linux x86_64 / Node v24.22.1；285 测试节点、14 顶层 OC01–OC14；131 实际槽位 = 97 网络／进程 + 34 运行期文件读取；0 fail/cancelled/skipped/todo**。这是既有参考，不是 Windows 实测值，不预填入实测栏。

guard 在业务模块动态加载前安装网络／进程桩，加载计数在正控前保存并断言零；正控不转发、不清零累计计数，随后取业务基线；运行期文件读取桩在模块加载后安装，**不覆盖模块加载期 fs 读取**。环境变量禁读是源码核对边界，不能写成运行时全环境拦截或操作系统沙箱。

Windows 必须据实际输出报告：入口清单与计数、加载期零调用、业务增量全零、逐入口正控、函数身份／属性描述符／ESM 绑定精确恢复。Node 版本的 `resolveTlsa` 等入口差异可能改变数量；逐项列差异并交复审，不能硬凑 131、删 guard、删用例或仅凭退出 0 宣称通过。旧 Node 的入口兼容仅有合成元数据用例，不宣称真实旧版本 CLI 已跑通。

```text
任务：HK-AI-08 Windows离线复现；实际Harness派单号：<未派发则NOT_DISPATCHED>
状态：<NOT_EXECUTED / BLOCKED / FAIL / EXECUTED_NEEDS_REVIEW>
source_commit：31f20c9a372c447f142312f6e95e0400372f9ee8
prep_commit：<manifest实值>；ZIP/manifest SHA256：<逐项填写>
输入：仅交接包/合成fixture，无凭据、真实配置或设备目标
OS/架构/PowerShell/Node：<实际值，不贴账号/绝对用户路径>
版本命令退出码/帮助参数支持：<实际值>
七文件执行前后bytes/SHA256：<逐项表；批准四文件另对固定值>
唯一测试命令/退出码：<逐字命令、实际退出码>
顶层ID/总节点/pass/fail/cancelled/skipped/todo：<实际值>
guard实际槽位/分类清单/正控/加载计数/业务增量/精确恢复：<实际证据>
覆盖边界：加载期fs未覆盖；env为源码证据；无真实CLI/子进程负控
与Linux比较差异及解释：<逐项；无证据则待判定>
stdout/stderr原捕获及脱敏副本SHA256：<各自值与相对工件名>
禁止动作核对/异常/未验证项：<不得把未验证写成通过>
本地报告提交/远端分支/ls-remote完整SHA：<实际交付后填写>
```

取件／哈希／Node 支持问题：**BLOCKED，停止执行**。测试失败、非零业务副作用、恢复失败：**FAIL，保留现场交复审**，不自行修改批准内容。测试／入口数与 Linux 不同：保留实际值及原因，不能用差异值直接替换预期；无充分解释保持待复审。日志疑含敏感信息：停止公开交付，原件本地受控保存，报告只给脱敏情况。任何离线结果都不代表 E1/E2、真机或业务验收。

## 5. 单报告交付与停止点

仅在已有可用 Git 会话中，从 manifest 的真实 `prep_commit` 创建全新文档分支 `docs/hk-ai-08-windows-offline-replay-report`／独立工作树；对象不可取或该分支已存在则停止报告缺口，不 reset／合并／重写。只新增 `docs/evidence/hk-ai-08-offline-config-checker/WINDOWS-REPLAY-2026-11-21.md`（执行跨日时写明实际日期），不纳入含本地路径的原日志或修改四批准文件。

报告应引用外部受控工件及脱敏哈希；`git diff --name-status` 仅单报告，`git diff --check`、`git show --check` 通过后追加提交。普通推送使用显式 refspec：`git push origin HEAD:refs/heads/docs/hk-ai-08-windows-offline-replay-report`；随后 `git ls-remote origin refs/heads/docs/hk-ai-08-windows-offline-replay-report` 与完整本地 SHA 比较。不推 main，不 force，不 amend/rebase/reset/squash/merge/cherry-pick，不改 Git/TLS。

推送失败仅如实报告本地 SHA／单报告补丁哈希及远端未核验；不试探代理／设备、不关闭 TLS、不擅改认证或配置。完成即停手交 Codex 独立复核，不自批 Windows 通过、不顺带执行 E1/E2。
