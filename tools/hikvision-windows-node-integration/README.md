# HK-AI-08 原 Node 写入函数与 Windows ACL 的离线接入核验

本工具只核验固定原 `fs-safe.mjs` 的两个写入函数，在上层预先创建并验证的 Windows ACL 新合成目录中的实际表现。**PASS 不表示原 CLI 已完成 Windows live 接线；输出 `integrationState` 固定为 `LIVE_CLI_NOT_INTEGRATED`。**

它不连接设备、不运行 E1/E2、不读取真实配置/凭据、不接受输出目录或旧 evidenceRef，不提供任何残留清理入口。不得用它替代设备授权、真实配置绑定或完整 CLI 门禁。

## 来源与执行入口

- 原探针：`558b9c864a4b820e397336200758b143556a4d87`；仅取 `src/fs-safe.mjs` 的原始字节，见 [SOURCE.md](reference/SOURCE.md)。原生产探针不修改、不合并，也不执行原 CLI 或原测试套件。
- Windows 生产 ACL 策略模块 SHA-256：`ca1a81bee7cc7f668067a07b956a971740c6ebdfca8c73ca64e9f745ff101bf9`。
- 已验收原生辅助源码 SHA-256：`e14793c80cd652c930d2fa8fa0ee670d7f077da216ccf6d7c6ff53c43d142a4b`。只解析并定义其四个具名辅助函数，不执行该主脚本顶层逻辑。
- `writer.mjs` SHA-256：`27b3d06237939a122e1fbfbc10db3bc03f15c5dfe7611b959740950aa8914f0e`，由启动器固定校验。

只有经授权的本地合成核验才使用以下入口；需要已安装的 Windows PowerShell 5.1 Desktop、Node 和本地 NTFS，不安装依赖、不申请管理员权限或绕过执行策略：

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\tools\hikvision-windows-node-integration\Test-NodeEvidenceAcl.ps1
```

`writer.mjs` 是启动器内部 worker，单独调用不构成任何 ACL 证据。启动器不读取设备环境变量，所有文件内容都是代码中的固定合成哨兵。

## 核验步骤与实际边界

1. 固定字节哈希、Windows PowerShell 5.1、非管理员身份、本地固定 NTFS 与逐级非重解析路径检查通过后，才在当前用户 LocalApplicationData 下创建随机 `hk-node-acl-<32hex>` 新目录；创建时附带当前用户及 SYSTEM 的受保护精确两条规则。
2. 在空的新根中调用原 `ensurePrivateDir`（mkdir/chmod），随后真实回读根 ACL。
3. 调用原 `writePrivateFile` 创建两个固定新文件 `sentinel.raw`、`report.json`，验证自然继承 ACL、所有者与固定内容。
4. 仅对同次已知两个文件用原函数重写为固定 revision 2，再读回内容与 ACL。此步骤专门观察原 writeFile/chmod 行为；**不将原函数允许覆盖已有文件的行为认定为 live 安全写入策略**。
5. 原策略对内存中的额外 Everyone ACE 负控必须拒绝；不将宽规则应用到磁盘。
6. 仅全程成功时，反复检查新根、已知文件、ACL、创建时间、内容和精确子项集合，逐个删除这两个新文件，再非递归删除空的新根。任一早期失败不尝试补救清理，保留新的非敏感引用。

每个 Node 子进程有 15 秒绝对等待上限，超时尝试终止并再等最多 5 秒；超时或不能确认退出即停止，不进入后续写入/清理。原始探针的请求超时并未因此被修改。

Windows PowerShell 的 `Get-Command node.exe` 可能返回多个应用候选；启动器在创建根之前按普通 PATH 顺序固定首候选并检查文件存在，记录候选数量。不得把多个路径拼成一个 FileName，也不在启动/安全失败后改走其他候选。

Node worker 在阶段内检查根/文件 `dev/ino`、regular 类型、单链接和非符号链接；PowerShell 在跨阶段及清理时检查 ACL、路径和创建时间。**创建时间不是不可伪造的原生文件 ID，逐次路径检查也不是原子锁。**本工具不证明恶意同用户/管理员并发替换已被排除，不把兼容性样本提升为完整执行期间安全保证。

## 输出判读

固定 scope：`synthetic-original-node-windows-acl-integration-only`。仅 `PASS/OK`、进程退出 0、全部 checks 为 true、`cleanupVerified=true`、`newObjectStateUnverified=false` 才能记本次新合成样本成功。

正常完整路径的计数应为：目录创建/删除各 1、文件创建/重写/删除各 2、完成的 Node 子进程 3、ensureCalls=1、writeCalls=4、negativeControls=1，`nodeInvocationAttempts=3`。必须读取实际 JSON，不预填。

计数记录已完成并核验的步骤；失败时可能存在未计入已完成项的局部写入或部分创建，`newObjectStateUnverified=true` 时不能由零计数推断没有对象。非 Windows/能力不具备为 BLOCKED；异常为 FAIL。不要改宽 ACL、跳过断言、递归清理、再次认领旧根或手工制造 PASS。

输出只有固定状态、布尔、计数、Node 版本、脱敏阶段结果和随机 evidenceRef，不含用户 SID、账号、个人绝对路径或异常原文。既有旧残留引用 `hk-acl-f03a3e07eb4f4c13a5ee8d1326ec84a4` 不作为工具输入，不访问、不清理。

## 相关交付

- [真机只读预检与绑定方案](../../docs/tasks/HK-AI-08-WINDOWS-NODE-E1-READONLY-PLAN-2026-11-23.md)
- [既有 Windows 合成权限验收](../../docs/evidence/hk-ai-08-windows-evidence-preflight/WINDOWS-ACCEPTANCE-2026-11-23.md)

原 CLI 的网络前权限门禁、完整同份配置桥接、不可变端点对象、对端绑定、G1 任意失败即停止及绝对网络 deadline 仍需按方案独立处理和复审。本工具不提供真实设备执行命令，也不作 E1 放行。
