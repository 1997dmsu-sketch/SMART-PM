# HK-AI-08 CLEANUP_FAILED 最小修复候选（2026-11-23）

状态：**提交独立代码复审的修复候选；本轮主预检 NOT_EXECUTED，不能据此改写原 FAIL 或认定清理成功。**

## 基线与原证据保全

- 独立分支：`fix/hk-ai-08-windows-acl-cleanup`；独立工作树：`SMART-PM-windows-acl-cleanup-fix`。
- 直接起点：原报告提交 `6f20899cfbea3938e4656766f67ee066fce1c1a5`，其中工具仍为 `3bb0b95df351ef357aedff6a21a275a19b92b6f2` 版本；无合并、变基、挑拣或历史重写。
- 原报告 [WINDOWS-VALIDATION-2026-11-23.md](WINDOWS-VALIDATION-2026-11-23.md) 未修改，原工作树及本分支副本的字节 SHA-256 均为 `40e95cb34bd10ffb66ce073e7f92a5e3b8168b0017220b2e2ccd2ad9ef076291`。
- 原日志目录 `../HK-AI-08-local-evidence-2026-11-23-run01/` 的 12 个文件（含原交付回执）逐项核对字节数与 SHA-256，均未变化；本轮日志另存新目录。
- 原运行结果仍为 `FAIL/CLEANUP_FAILED`、退出码 3、目录创建 1/删除 0、文件创建 0。保留引用 `hk-acl-f03a3e07eb4f4c13a5ee8d1326ec84a4`；未访问该残留候选，未确认其当前存在状态/内容，未修改 ACL 或清理。

## 定位依据与最小改动

原脚本 `Get-HkNativeAclSnapshot` 的四个 `AceFlags -band` 表达式，分别检查 `ContainerInherit`、`ObjectInherit`、`NoPropagateInherit`、`InheritOnly`。`AceFlags` 底层为 `System.Byte`；本机 Windows PowerShell Desktop `5.1.22621.6133`、StrictMode 2 下，原形式可在纯内存中复现 `System.InvalidCastException`。

最小复现（不读取用户身份或磁盘 ACL）：

```powershell
$flags = [System.Security.AccessControl.AceFlags]3
$flags -band [System.Security.AccessControl.AceFlags]::ContainerInherit
# System.InvalidCastException
([int] $flags -band [int] [System.Security.AccessControl.AceFlags]::ContainerInherit)
# 2
```

该函数由首次目录验证与清理共同调用，缺陷与原运行“创建目录后未取得目录验证成功、清理也未通过”的路径高度吻合。**原工具没有保留初始异常，最终错误被 CLEANUP_FAILED 覆盖；此处证明的是可复现的兼容缺陷，不能认定已恢复原异常或排除其他根因。**

生产修复仅为四个表达式的两个操作数显式转为 `int`，另加一行原因注释。不更改 ACE 数量/类型、权限掩码、所有者、DACL 保护/规范性、继承规则、原始/高层 ACL 交叉核对、路径检查、结果 JSON 或清理门禁；不增加重试、递归删除、宽权限或残留修复入口。策略模块和原 51 场景测试保持原字节。

| 文件 | 修复工作树 SHA-256 |
|---|---|
| `tools/hikvision-windows-evidence-preflight/Test-EvidenceAcl.ps1` | `e14793c80cd652c930d2fa8fa0ee670d7f077da216ccf6d7c6ff53c43d142a4b` |
| `tools/hikvision-windows-evidence-preflight/EvidenceAcl.psm1`（未改） | `ca1a81bee7cc7f668067a07b956a971740c6ebdfca8c73ca64e9f745ff101bf9` |
| `tools/hikvision-windows-evidence-preflight/Test-EvidenceAcl.Tests.ps1`（未改） | `de08193b058754807c16ca6372ca2db4840c55f1372a607dbff3cb5fcb44336c` |
| `tools/hikvision-windows-evidence-preflight/Test-NativeAclProjection.Tests.ps1`（新增） | `61ebfe64f8b086f1692492ea17097637f999a1f1cc93b8b0af9fe6acbd2338c9` |

## 本轮实际验证：仅纯内存

全部使用本机 `powershell.exe` Desktop 5.1，无 Pester、依赖或运行时安装。时间为 2026-11-23，UTC+08:00。stdout/stderr 原始字节分别捕获；进程结束后立即读取退出码，未用后续命令的状态替代工具退出码。

| 验证 | 开始至结束 | 实际结果 | 退出码 |
|---|---|---|---:|
| 上述枚举最小复现及整数转换核对 | 09:50:48.812–09:50:49.152 | 原式抛 InvalidCastException；修复式得到 2，符合预期 | 0 |
| 原纯策略测试 | 09:50:49.182–09:50:50.038 | PASS，51/51，失败 0 | 0 |
| 新增纯内存投影回归 | 09:52:40.305–09:52:40.866 | PASS，12/12，失败 0 | 0 |
| 修复后的 Windows 主预检 | — | **NOT_EXECUTED，依用户要求暂不重跑** | 不适用 |

两条实际测试命令（均从修复工作树根目录执行）：

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\tools\hikvision-windows-evidence-preflight\Test-EvidenceAcl.Tests.ps1
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\tools\hikvision-windows-evidence-preflight\Test-NativeAclProjection.Tests.ps1
```

原始 stdout JSON（均以 CRLF 结尾，字节以本地工件为准）：

```json
{"scope":"memory-only-byte-enum-regression","status":"PASS","PSEdition":"Desktop","PSVersion":"5.1.22621.6133","enumUnderlyingType":"System.Byte","originalFailed":true,"originalExceptionType":"System.InvalidCastException","fixedResult":2,"expectedResult":2}
{"scope":"synthetic-acl-policy-tests-only","status":"PASS","counts":{"total":51,"passed":51,"failed":0},"failedCaseIds":[]}
{"scope":"memory-only-native-acl-projection-tests","status":"PASS","counts":{"total":12,"passed":12,"failed":0},"failedCaseIds":[]}
```

新增回归从主源码 AST 提取 `$binary` 赋值至最终 return 的真实投影段；不 dot-source 或执行主脚本，不执行路径/磁盘 ACL 读取前缀或清理函数。提取段拒绝命令及不在白名单的方法调用，只接收内存 `DirectorySecurity` / `FileSecurity`、固定合成身份与属性。两项有效目录/文件用例验证生产投影及现有策略接受；十项拒绝用例覆盖多 ACE/Everyone、deny、传播标志、文件非继承、掩码、所有者、保护位、空/单 ACE。还核对内存描述符执行前后不变。没有读取当前用户 SID、输出身份值或触碰真实磁盘 ACL。

## 新日志定位与哈希

路径相对修复工作树根目录：`../HK-AI-08-cleanup-fix-evidence-2026-11-23-run01/`，仅本机保留，不加入提交。stdout 原件与脱敏副本逐字节一致；三个阶段的 stderr 原件及脱敏副本均为 0 字节。未输出原始异常消息、实际用户名、SID 或个人路径。

| 文件（同一行的两个文件各自具有所列字节数/哈希） | 字节数 | SHA-256 |
|---|---:|---|
| `byte-enum.stdout.raw.bin`、`byte-enum.stdout.redacted.txt` | 259 | `c7f8b33d572cd16fabe7144af8035d17f6dde4a0c388b56893281b853244e454` |
| `policy.stdout.raw.bin`、`policy.stdout.redacted.txt` | 125 | `9c62a3688956906740f6c2730efb469891bec302802c51f08ba691deae244b13` |
| `projection.stdout.raw.bin`、`projection.stdout.redacted.txt` | 133 | `6d75a00fd805496d9ba1f5527e89d64e51cd0576ed3451e6c51eef9133742f26` |
| 上述三个前缀各自的 `.stderr.raw.bin`、`.stderr.redacted.txt`（共六个空文件） | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `byte-enum.exit.json`（含完整纯内存复现命令） | 1231 | `c093e6f7d3ed217fb56789d812735b44cb7f1acdca3ff41cace468ba3d6dfa5a` |
| `policy.exit.json` | 341 | `cb79ce1c51a40f6e07cd324382a1adb5f6ec3b356ba47aa455de432c3b36d442` |
| `projection.exit.json` | 265 | `a65977e7442b0efff85c5576f13bcc29af724fdad0adba66679d654ffb9ce259` |
| `original-log-manifest.json` | 1792 | `855855bc21f0e2dca2da8b345af792225680e643737ad51175546b26daab5962` |
| `preservation-check.json` | 385 | `7dc54dac9fc27a131c0ff0193233d165b996f3ad4cd325895cd8eba15a7a7a2a` |

## 独立复审与停止点

此次候选仅改生产主脚本的四处类型转换，并新增内存回归与本记录；不修改原报告、原日志、策略模块或原 51 场景测试。候选提交交独立代码复审，提交/普通推送与远端完整 SHA 核对按实际 Git 输出另行交付，不预填成功。

独立代码/纯内存复审不等于最终独立验收，更不等于真实 Windows ACL、文件自然继承或清理路径已验证通过。本轮设备请求/GET 为 0；没有门禁探针、E1/E2、真实配置/凭据、照片/人员/权限操作、HTTP/UI、部署或上线；不恢复隔离网络要求、不申请管理员权限、不改全局/系统 Git、TLS、代理或安全策略。完成候选交付后停手，等待独立复审及后续明确安排；不自行重跑主预检、清理残留或宣布 E1 放行。
