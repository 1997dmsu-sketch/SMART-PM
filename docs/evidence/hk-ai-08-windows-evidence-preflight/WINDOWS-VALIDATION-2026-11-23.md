# HK-AI-08 Windows 原生证据权限实际验证（2026-11-23）

结论：**纯策略测试 PASS（实际 51/51，退出码 0）；Windows 原生合成 ACL 预检 FAIL / CLEANUP_FAILED（退出码 3）。本次权限预检不通过，停止交回 Codex 统一定位修复，等待独立复审；不构成 E1 放行。**

本报告由本机执行和取证方记录，不是最终独立验收结论。没有重试主预检、修改工具、放宽权限或人工清理残留候选。

## 1. 固定来源与工作树

- 仓库：`https://github.com/1997dmsu-sketch/SMART-PM.git`。
- 工具分支：`feat/hk-ai-08-windows-evidence-acl-preflight`。
- 实际取得并运行的固定完整工具提交：`3bb0b95df351ef357aedff6a21a275a19b92b6f2`。
- 已核对其唯一直接父提交：`6533f012a1f64d7fe9f70bb8f637ef7c1b9dc598`。
- 本机初始任务工作目录为空，不存在可报告的既有仓库 HEAD、工作树或未跟踪文件；最初 Git 检查返回“非 Git 仓库”。没有切换或清理他人的工作树。
- 新建取件仓库 `SMART-PM-source`，通过普通 `git fetch origin 3bb0b95df351ef357aedff6a21a275a19b92b6f2` 取得固定对象；取件仓库主工作树保持未出生 HEAD，无既有提交/文件被覆盖。未使用 ZIP，也未使用云端 `/workspace/artifacts`。
- 新独立工作树：`SMART-PM-windows-validation-2026-11-23`；文档分支：`docs/hk-ai-08-windows-validation-2026-11-23`。工作树起点 HEAD 为上述固定工具提交，运行前 `git status --short` 为空。
- 创建工作树时仅用本条命令的 `-c core.autocrlf=false` 保留原始字节；未修改配置或脚本换行。工作树中的三脚本原始字节哈希与给定值一致。
- 运行前只读查询相关远端分支 `*windows*` / `*hk-ai-08*`；未发现本次 Windows 验证报告分支。固定提交的该证据目录只有原有 README，无同名报告。
- 已阅读工具 README、`EvidenceAcl.psm1`、`Test-EvidenceAcl.Tests.ps1`、`Test-EvidenceAcl.ps1` 和证据目录 README。固定提交树中未发现 `AGENTS.md`。

### 脚本执行前后 SHA-256

所有路径均相对 `tools/hikvision-windows-evidence-preflight/`；直接对工作树文件字节计算 SHA-256，没有重编码。

| 文件 | 执行前 SHA-256 | 执行后 SHA-256 |
|---|---|---|
| `EvidenceAcl.psm1` | `ca1a81bee7cc7f668067a07b956a971740c6ebdfca8c73ca64e9f745ff101bf9` | `ca1a81bee7cc7f668067a07b956a971740c6ebdfca8c73ca64e9f745ff101bf9` |
| `Test-EvidenceAcl.Tests.ps1` | `de08193b058754807c16ca6372ca2db4840c55f1372a607dbff3cb5fcb44336c` | `de08193b058754807c16ca6372ca2db4840c55f1372a607dbff3cb5fcb44336c` |
| `Test-EvidenceAcl.ps1` | `d1b2b1388dec121a2dc67a70c615f504fcfc706af1f00f7b48306b895d540f3b` | `d1b2b1388dec121a2dc67a70c615f504fcfc706af1f00f7b48306b895d540f3b` |

三份执行后哈希全部与给定值及执行前值一致。

## 2. 实际本机环境与权限限制

- 实际平台：`Win32NT`，`Microsoft Windows NT 10.0.22631.0`；不是云端 Linux。
- 本机只读硬件注册表：制造商 `LENOVO`，产品型号 `21KG`，与本次 Windows 笔记本执行入口一致。未读取计算机名、序列号或设备凭据。
- 本机 OS 注册表原值：`ProductName=Windows 10 Home China`、`DisplayVersion=23H2`、`CurrentBuild=22631`、`UBR=6199`。此处保留观测原值，不据旧产品名称另行推断营销版本。
- 实际启动的 `powershell.exe`：`PSEdition=Desktop`、`PSVersion=5.1.22621.6133`、`CLRVersion=4.0.30319.42000`，64 位。两条工具命令均使用该 Windows PowerShell 入口。
- 编排 shell 是 PowerShell Core `7.6.9`，仅用于 Git、日志捕获及报告操作；没有用 `pwsh.exe` 执行任何阶段的工具脚本。
- 两条工具进程从普通用户上下文启动；捕获器核对管理员令牌为 `false`。沙箱外执行授权不是 Windows 管理员提权。未安装或升级运行时、依赖、Pester、WSL、容器。
- 准备期 CIM 查询系统/硬件元数据返回 `PermissionDenied / HRESULT 0x80041003`，因此改用上述可读的本机信息确认平台；未提权重试 CIM。该准备期限制不被当作工具测试结果。
- 组织策略/签名/安全软件没有阻止本次两个脚本实际启动；stderr 均为零字节。没有使用 `ExecutionPolicy Bypass`、`Unblock-File`、修改执行策略或关闭防护。
- 沙箱最初拒绝写入新仓库的 `.git/config` 和 `.git/FETCH_HEAD`，并阻断 GitHub 网络。相关 Git 写入/网络操作经授权在普通用户上下文执行；新仓库的沙箱所有者与普通用户不同，触发过 Git 所有者检查。后续仅对本次明确路径使用单条命令的 `-c safe.directory=...`，没有修改全局/系统 Git、TLS、代理或安全策略。该 Git 准备问题没有被用作 ACL 通过依据。
- 首次报告提交被 Git 以 `Author identity unknown` 拒绝，未产生提交或推送；后续提交命令采用明确的非个人本地代理身份 `Codex <codex@localhost>`，仅以命令参数指定，不配置或冒用用户姓名/邮箱。

## 3. 实际执行与即时捕获

执行日期为 **2026-11-23，UTC+08:00（Asia/Shanghai）**，未跨日。执行目录为上述固定提交的独立工作树根目录。

| 阶段 | 实际开始 | 实际结束 | 进程退出码 |
|---|---|---|---:|
| 纯策略测试 | `2026-11-23T09:39:44.898+08:00` | `2026-11-23T09:39:46.007+08:00` | 0 |
| Windows 原生预检 | `2026-11-23T09:39:46.065+08:00` | `2026-11-23T09:39:46.475+08:00` | 3 |

第一条实际命令：

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\tools\hikvision-windows-evidence-preflight\Test-EvidenceAcl.Tests.ps1
```

第二条实际命令：

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\tools\hikvision-windows-evidence-preflight\Test-EvidenceAcl.ps1
```

捕获器使用 `System.Diagnostics.Process` 的独立 stdout/stderr `BaseStream`，直接复制至分别以 `CreateNew` 打开的原始文件，不经 PowerShell 重定向重编码。每个进程 `WaitForExit()` 后立即读取并保存其 `ExitCode`，随后保存该阶段退出信息；没有依赖会被后续命令覆盖的 `$LASTEXITCODE`。捕获器自身退出 0 不代表主预检退出 0。

仅在第一阶段退出 0、stdout JSON 为预期 PASS/51/51/0、失败 ID 为空且 stderr 为空后才启动第二阶段。第二阶段仅执行一次；实际 FAIL 后不重跑、不新增诊断取证对残留的访问。两个阶段均已执行，没有将未执行阶段伪装成结果。

### 纯策略测试原始 JSON

以下为 stdout 的原始单行 JSON；原始工件以 CRLF 结尾（125 字节），代码块不表达行尾字节：

```json
{"scope":"synthetic-acl-policy-tests-only","status":"PASS","counts":{"total":51,"passed":51,"failed":0},"failedCaseIds":[]}
```

实际总数 51、通过 51、失败 0，`failedCaseIds=[]`。源码独立清点为 `ACL-01` 至 `ACL-51` 连续唯一的 51 个场景，其中 8 个预期接受、43 个预期拒绝；8 个接受场景为 ACL-01–04、ACL-41–43、ACL-50。运行器逐场景比对预期，正确拒绝预期拒绝场景同样算通过。stdout 只输出汇总，没有另存逐场景输出；8/43 是源码分类，51/51 是本次真实运行汇总。

### Windows 原生预检原始 JSON

以下为 stdout 的原始单行 JSON；原始工件以 CRLF 结尾（502 字节）：

```json
{"scope":"synthetic-windows-evidence-permissions-only","status":"FAIL","code":"CLEANUP_FAILED","checks":{"platformSupported":true,"identitySupported":true,"locationSupported":true,"ancestorsClear":true,"directoryAclValid":false,"sentinelContentValid":false,"fileAclValid":false,"broadenedAclRejected":false,"cleanupVerified":false},"counts":{"directoriesCreated":1,"filesCreated":0,"filesDeleted":0,"directoriesDeleted":0,"negativeControls":0},"evidenceRef":"hk-acl-f03a3e07eb4f4c13a5ee8d1326ec84a4"}
```

### 九项 checks 与五项 counts（仅记录实际输出）

| check | 实际值 | 判读 |
|---|---|---|
| `platformSupported` | true | 工具的平台门禁满足 |
| `identitySupported` | true | 工具的当前身份形式门禁满足；未输出身份值 |
| `locationSupported` | true | 工具的本地固定 NTFS 位置门禁满足 |
| `ancestorsClear` | true | 创建前基路径祖先检查满足；不能代表创建后的所有复查 |
| `directoryAclValid` | false | 未取得目录 ACL 验证成功；不能区分原生读取异常与策略拒绝 |
| `sentinelContentValid` | false | 未到达哨兵成功检查，文件创建数为 0 |
| `fileAclValid` | false | 未验证文件 ACL，不是已完成的文件拒绝访问实测 |
| `broadenedAclRejected` | false | 负控次数为 0，该项没有实际执行 |
| `cleanupVerified` | false | 清理未确认成功，必须保留引用交复核 |

| count | 实际值 |
|---|---:|
| `directoriesCreated` | 1 |
| `filesCreated` | 0 |
| `filesDeleted` | 0 |
| `directoriesDeleted` | 0 |
| `negativeControls` | 0 |

清理状态为 **未确认成功**，最终 `FAIL/CLEANUP_FAILED`，退出码 3；不能改记为 PASS/OK。非敏感引用为 `hk-acl-f03a3e07eb4f4c13a5ee8d1326ec84a4`。工具候选定位为当前用户 `<LocalApplicationData>/hk-acl-f03a3e07eb4f4c13a5ee8d1326ec84a4`，不在报告中写个人绝对路径。

工具报告创建 1 个目录、删除 0 个目录；未另外检查该候选当前是否仍存在或是否为空，不声称已清理或确定其当前内容。未手动枚举、修改、递归删除或认领任何残留对象。

## 4. 本地 stdout/stderr 工件与脱敏副本

本节路径相对独立工作树根目录。日志保留在工作树之外的本轮新建目录：`../HK-AI-08-local-evidence-2026-11-23-run01/`。这些是本机保留工件，**不随单文件文档提交上传**；远端报告中的上述两个 JSON 可供文本复核，完整字节仍以本地工件及下表哈希为准。

原件仅本地保留。脱敏处理覆盖当前用户名、个人 profile 路径和 SID 文本；本次工具原始 stdout 本身不含上述敏感值，两个 stdout 的原件与脱敏副本逐字节一致。两个 stderr 原件及副本均为零字节，没有异常原文。未将准备期 Git 所有者错误中的身份值复制进报告。

下表每个文件名均在上述本地日志目录中：

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `policy.stdout.raw.bin` | 125 | `9c62a3688956906740f6c2730efb469891bec302802c51f08ba691deae244b13` |
| `policy.stdout.redacted.txt` | 125 | `9c62a3688956906740f6c2730efb469891bec302802c51f08ba691deae244b13` |
| `policy.stderr.raw.bin` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `policy.stderr.redacted.txt` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `native.stdout.raw.bin` | 502 | `c9296f05e76b708dc89182b59226cf807a36f6f6a22f85382950df5596144372` |
| `native.stdout.redacted.txt` | 502 | `c9296f05e76b708dc89182b59226cf807a36f6f6a22f85382950df5596144372` |
| `native.stderr.raw.bin` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `native.stderr.redacted.txt` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `policy.exit.json` | 256 | `310f543bba024ffafa2de2e8a763434affd5d554e59b3534678d66b388e1f2ca` |
| `native.exit.json` | 250 | `bb0f8b5157b2a874f620de5707d58a33209eef277052404027ab4d808eb26dfa` |
| `execution.json` | 1937 | `3eb0f28d204ea7dce9331293b2ab69d1fb9fc9d870b15ed73c1e2715175c35b4` |

`*.exit.json` 记录实际命令、开始/结束时间及即时捕获退出码；`execution.json` 另记录非管理员令牌、顺序门禁及脚本执行前后哈希。没有读取或提交设备地址、配置、凭据、账号、证书或照片。

## 5. 最小问题定位与仍未知的事实

以下行号均指固定工具提交的 `tools/hikvision-windows-evidence-preflight/Test-EvidenceAcl.ps1`，属于**静态复审与实际 JSON 的交叉定位**，不是额外运行结果：

- 第 266–268 行：目录创建调用返回后才记录 `directoriesCreated=1`。
- 第 269–274 行：创建后的根路径复查、原生目录 ACL 快照/交叉核对或策略判断未完成成功路径；第 275 行才将 `directoryAclValid` 设为 true。因此首个失败只能缩小到该区间，不能从默认 false 认定具体 ACL 已被策略明确拒绝。
- 第 331–334 行捕获阶段错误；第 337–343 行在清理不成功时将最终错误码覆盖为 `CLEANUP_FAILED`。当前 JSON 没有保存初始错误类别，stderr 又为空，不能恢复底层异常或唯一根因。
- 第 154–182 行的清理流程会在祖先/ACL/策略检查失败或异常时返回未成功并停止删除；本次没有越过该门禁自行处理。

尚未证明具体所有者、ACE 或权限掩码的哪一项有问题；也未证明清理失败的唯一原因。不读取残留 ACL 来扩展本任务、不更改三脚本、不跳过断言、不人工制造 PASS；证据及引用交 Codex 统一修复并由独立方复审。

## 6. 验证层次、禁止动作与交接边界

| 层次 | 本次实际完成范围 |
|---|---|
| 静态复审 | 阅读固定五文件、核对父链/哈希、源码清点 51 场景、审阅输出与受控清理路径；不能代替 Windows 实测 |
| 纯策略测试 | Windows PowerShell 实际运行 51 场景，PASS、51/51、退出码 0；只证明本次内存策略用例 |
| 真实 Windows ACL 检查 | Windows PowerShell 实际执行一次，创建目录后未验证成功，清理未确认；FAIL/CLEANUP_FAILED、退出码 3；本次预检失败 |

本次禁止动作核对：

- 设备连接、设备请求/GET、扫描、真实配置或凭据读取、门禁探针、E1/E2 均未执行；设备 GET 为 0。目标型号 `DS-K1T671BM` 仅来自任务输入，没有核验其通电/联网回报、激活或接口能力。
- 未要求恢复隔离网络前置，没有更改网络配置。
- 未进行真实照片上传、人员创建、权限下发、支付、生产云、HTTP/UI、集成/合并、部署或上线；仅按任务取件和交付需要访问 Git 远端。
- 未枚举环境变量、计划任务、凭据管理器或秘密目录；当前用户 SID 仅由固定主工具在内部用于 ACL 比较，没有输出身份值。捕获器仅读取当前用户名/profile 字符串用于日志脱敏，没有枚举环境或目录。
- 文件操作仅为新取件/独立工作树准备、本轮新日志/报告，以及固定工具自身对新随机合成对象的操作；未覆盖既有文件、重设宽权限、递归删除未知目录或修改原脚本。
- 未执行 amend、rebase、reset、squash、force、merge 或 cherry-pick；不推送 main。交付仅追加本文到独立文档分支；不将日志或其他变更纳入提交。实际提交与普通推送后的远端 SHA 校验结果由交付消息据 Git 输出报告，不在本文预填自身提交号或推送成功。

即使未来预检通过，也不能据此认定 Windows 与 POSIX `0700/0600` 全场景等价、原探针 Node 写入路径已验证、同份设备配置绑定或 TOCTOU 已解决、设备已激活、账号/地址/证书已核验，或 E1/E2 已获准/通过。本次已经失败，执行方停手等待独立复审，不自行宣布 E1 放行。
