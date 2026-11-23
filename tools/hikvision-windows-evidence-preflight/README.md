# HK-AI-08 Windows 合成证据 ACL 预检

状态：**实现候选；必须在本地 Windows 实际验证后再判定结果。** 本工具准备 Windows 原生权限方案，不运行门禁探针，不替代 E1 准入或解除既有 POSIX 门禁。

## 目的与固定范围

现场已报告 Windows 本机没有可用 WSL/Linux；不再假定存在该入口，也不自动安装环境。本工具使用 Windows 自带的 Windows PowerShell 5.1 和 .NET Framework，在本地 NTFS 上验证一套候选证据保护策略：

- 只在当前用户 LocalApplicationData 下创建新的随机目录与固定合成文件，之后检查并清理；不接收设备地址、账号、证书或任意输出路径参数。
- 根目录的所有者为当前用户；受保护、规范且非空的 DACL 只允许当前用户和 SYSTEM 完全控制，规则向文件/目录继承。
- 合成文件必须自然继承两条允许规则；不通过重设文件 ACL 制造通过，不覆盖既有文件。
- 内存中的 Everyone 扩权负例必须被拒绝；不把宽权限应用到磁盘。
- 清理只针对本次已知文件和空目录，不递归删除；遇到重解析点、未知子项、身份/策略变化或清理失败即停止。

本工具没有设备请求、扫描、监听、外部进程启动、Node 调用或真实设备配置/凭据读取代码。外层命令启动 PowerShell 主进程不属于工具内启动子进程。用户已取消隔离网络前置；本工具不恢复该要求，也不更改任何网络配置。

固定基线：本轮分支从 `6533f012a1f64d7fe9f70bb8f637ef7c1b9dc598` 开始。既有核对器 `31f20c9a372c447f142312f6e95e0400372f9ee8` 与探针 `558b9c864a4b820e397336200758b143556a4d87` 均不改动、不导入或执行。

## 文件与职责

| 文件 | 职责 |
|---|---|
| `EvidenceAcl.psm1` | 纯内存 `Test-HkAclPolicy`；严格核对快照/整数/布尔/两条规则，不修改输入，不输出 SID 或异常原文 |
| `Test-EvidenceAcl.Tests.ps1` | 不依赖 Pester 的合成策略用例；只调用该生产函数，不访问真实 ACL 或设备 |
| `Test-EvidenceAcl.ps1` | Windows 本机原生 API 路径/ACL/读写/清理预检；输出固定 JSON |

纯策略输入是工具从原生 ACL 投影的闭式 NoteProperty 快照，不是对任意第三方 JSON 的权限真实性认证。当前用户 SID 来自本机 WindowsIdentity，不靠输入自报。支持本地/域用户 `S-1-5-21-…` 和 Azure AD 用户 `S-1-12-1-…`；不把 Everyone、SYSTEM、Administrators 或服务 SID 作为用户。Administrator 用户与 Administrators 组是不同身份，前者符合用户 SID 范围时可用。

## 本地执行

在本机打开 PowerShell，进入固定提交的仓库根目录或本工具取件包根目录。先按交付 manifest/Git 固定 SHA 核对三份脚本的原始字节；校验不符时停止，不通过重编码修改脚本。无需 Pester、Node、WSL、Docker、管理员提权或依赖安装。

使用 **`powershell.exe`（Windows PowerShell 5.1 Desktop）**，不是 `pwsh.exe`。主预检明确限制该运行时；纯策略测试可以单独在兼容 PowerShell 中执行，但不能据此证明原生 Windows ACL 行为。

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\tools\hikvision-windows-evidence-preflight\Test-EvidenceAcl.Tests.ps1
$policyExit = $LASTEXITCODE
if ($policyExit -ne 0) { throw 'BLOCKED: synthetic policy tests did not pass' }

powershell.exe -NoLogo -NoProfile -NonInteractive -File .\tools\hikvision-windows-evidence-preflight\Test-EvidenceAcl.ps1
$aclExit = $LASTEXITCODE
# 分别保存两条命令的 JSON 和退出码；不把任何设备秘密加到命令中。
```

上述命令本轮尚未在云端执行：这里没有 PowerShell/.NET 运行时。不要把文档命令或静态复审称为测试通过。

若组织执行策略、签名要求或安全软件阻止脚本运行，保留脱敏错误类别并停止；不要使用 `ExecutionPolicy Bypass`、`Unblock-File`、停用防护或修改全局策略来规避。不要上传含用户名/绝对用户路径的原始异常。

## 结果与交接

- 策略测试成功只证明该次实际执行的合成用例；它不检查磁盘 ACL。
- 原生预检的 `PASS` 只证明该次本机合成目录/文件满足当前策略，且受控清理完成；不是 Windows 权限对 POSIX `0700/0600` 的全场景等价认证，不是 E1 执行批准。
- 非 Windows、非 Windows PowerShell 5.1 Desktop、不支持的身份/文件系统/路径或所需能力缺失，按工具固定结果停止，不安装或降级到宽权限。
- 任一策略、读写、内存负控或清理失败，不能当作通过；保留 JSON 中非敏感引用和布尔/计数，交 Codex 复核，不自动重跑或递归清理。
- 输出不含设备地址/账号/口令/指纹、真实 SID、绝对路径或异常原文。文件数据只有固定合成哨兵；本轮没有真实设备证据。

本地回报至少包含：固定工具提交/文件 SHA-256、实际 Windows/PowerShell 版本、两条命令的原始退出码与 JSON、是否有阻断、清理是否完成。不要预填用例通过数，不把“静态已审”写成“Windows 已运行”。

## 仍未证明的部分

1. 当前云端不能执行 Windows ACL；只有本地实测输出才能关闭本次权限预检的运行时待验项。
2. 本工具不调用原探针的 Node `fs-safe.mjs`，不证明 Node 写入/`chmod` 后的实际所有者、继承或运行期间权限保持。该接线和运行时验证仍需独立方案与证据。
3. 路径逐级检查不原子消除检查至使用的 TOCTOU，不防御同一用户恶意并发或拥有特权的管理员。没有枚举 SMB 共享、同步软件或证明它们全部不存在。
4. 设备激活状态、实际地址/端口、账号、证书指纹、有权方授权真实性及核对至执行的同份配置绑定仍待现场核验；本工具不读这些值，不能将未核验改为已具备。
5. E1/E2、真实照片/人员、门禁权限、S4、预签约 S2–S6、H4-c C2/C3、07B 执行、集成/合并、HTTP/UI、支付、生产云和部署上线均未在此任务启动。

## API 依据

目录使用 .NET Framework 的带 `DirectorySecurity` 创建重载，在创建时附带 ACL；只允许新随机目标，已有目录不作为本次创建认领。[Microsoft Directory.CreateDirectory 文档](https://learn.microsoft.com/en-us/dotnet/api/system.io.directory.createdirectory?view=netframework-4.8.1)

根目录用受保护 DACL 停止继承，文件则检查真实继承结果，分别建模。[Microsoft SetAccessRuleProtection 文档](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.objectsecurity.setaccessruleprotection?view=netframework-4.8.1)

精确权限掩码来自 [Microsoft FileSystemRights 枚举](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.filesystemrights?view=netframework-4.8.1)。Entra 用户 SID 形式参考 [Microsoft UserRights 策略文档](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-userrights)；本工具的身份来源仍是本机 WindowsIdentity，不用字符串格式替代身份真实性核验。
