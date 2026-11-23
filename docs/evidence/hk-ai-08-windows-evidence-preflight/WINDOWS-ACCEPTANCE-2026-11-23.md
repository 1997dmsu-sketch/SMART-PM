# HK-AI-08 Windows 合成权限预检最终验收记录（2026-11-23）

**验收结论：通过，仅限本次 Windows 合成权限预检及其新合成对象。未发现阻塞验收的问题；不作 E1 放行判断。**

本文件固化已经完成的最终独立只读复审结论。两名未参与该次执行和报告的独立子代理分别核对运行结果/时序与证据完整性/保全，结论一致。复审及本次文档交付均没有重新执行任何工具脚本，也没有访问真实 ACL 或残留对象。本文件不表示另一次实测或设备验收。

## 1. 固定验收对象

- 取证提交：`69325d3d1859bd570347cf36f3535db673abefca`。
- 固定工具提交（取证提交唯一父提交）：`e7b36d1c1f80371f8a060ab94aaff1c5a5578f8b`。
- 取证提交仅新增 [WINDOWS-REVALIDATION-2026-11-23.md](WINDOWS-REVALIDATION-2026-11-23.md)，没有更改工具或旧报告。
- 原运行记录：2026-11-23、UTC+08:00（Asia/Shanghai），本机 Windows `Win32NT / 10.0.22631.0`；Windows PowerShell `Desktop 5.1.22621.6133`、CLR `4.0.30319.42000`、64 位、非管理员令牌。
- 本验收记录日期：2026-11-23；独立文档分支：`docs/hk-ai-08-windows-acceptance-2026-11-23`，直接从固定取证提交建立，不使用远端最新 tip 替代。

## 2. 三阶段结果与受控清理

以下为对既有原始日志的复核，不是本次重新运行所得：

| 阶段 | 实际结果 | 独立进程退出码 |
|---|---|---:|
| 纯策略 | PASS；total=51、passed=51、failed=0，`failedCaseIds=[]` | 0 |
| 纯内存投影回归 | PASS；total=12、passed=12、failed=0，`failedCaseIds=[]` | 0 |
| Windows 原生合成权限主预检 | `PASS/OK`；九项预期 checks 均为布尔 true，五项预期 counts 均为整数 1，字段无增缺 | 0 |

主预检原始 scope 为 `synthetic-windows-evidence-permissions-only`。`directoriesCreated=directoriesDeleted=1`、`filesCreated=filesDeleted=1`、`negativeControls=1`，与 `cleanupVerified=true`、`broadenedAclRejected=true` 一致。依固定工具输出及计数，可确认本次新合成对象的受控清理步骤完成；没有另行访问对象来作现场复查。

新 evidenceRef：`hk-acl-ede6254418504fb5be49561f3cdb0865`。其格式合法，与旧引用不同，且在原始 JSON、取证报告及交付记录中一致。

三阶段 stderr 均为零字节；独立 `*.exit.json` 与 `execution.json` 一致。毫秒级时间顺序为前哈希核对→纯策略→纯内存投影→主预检→后哈希核对，严格先后、无重叠；主预检记录为 `10:06:34.839–10:06:35.309 +08:00`。

准备期 `run01` 的两次辅助核对因 `Get-FileHash / CommandNotFoundException / ObjectNotFound` 退出 1，stdout 为空；策略、投影及主预检均为 `NOT_EXECUTED`，主调用 0 次。正式 `run02` 记录主调用 1 次。现有记录支持**针对固定修复提交的本次复验，主预检合计执行一次**；辅助准备失败没有被计为工具通过或隐藏成第二次主调用。

## 3. 脚本与原始日志完整性

四份脚本从固定 Git blob 的原始字节独立重算 SHA-256，均与取证工作树、运行前后原始哈希输出及取证报告一致：

| 工具目录内文件 | SHA-256 |
|---|---|
| `EvidenceAcl.psm1` | `ca1a81bee7cc7f668067a07b956a971740c6ebdfca8c73ca64e9f745ff101bf9` |
| `Test-EvidenceAcl.Tests.ps1` | `de08193b058754807c16ca6372ca2db4840c55f1372a607dbff3cb5fcb44336c` |
| `Test-EvidenceAcl.ps1` | `e14793c80cd652c930d2fa8fa0ee670d7f077da216ccf6d7c6ff53c43d142a4b` |
| `Test-NativeAclProjection.Tests.ps1` | `61ebfe64f8b086f1692492ea17097637f999a1f1cc93b8b0af9fe6acbd2338c9` |

生产修复保持为四处 `AceFlags -band` 两侧整数转换及注释；ACL 的身份、掩码、继承、保护、规范性、原始/高层交叉核对，以及路径和清理门禁没有放宽。

原始日志保留在本机，路径相对本验收工作树根目录：`../HK-AI-08-windows-revalidation-2026-11-23-run02/`。三阶段 stdout 原件及各自脱敏副本逐字节一致：

| 原始 stdout 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `policy.stdout.raw.bin` | 125 | `9c62a3688956906740f6c2730efb469891bec302802c51f08ba691deae244b13` |
| `projection.stdout.raw.bin` | 133 | `6d75a00fd805496d9ba1f5527e89d64e51cd0576ed3451e6c51eef9133742f26` |
| `native.stdout.raw.bin` | 485 | `4aba2103291939275424b1521ce2826d08b7ea9fe97efd520767c02b27d95c75` |

`artifact-manifest.json` 生成时列出的 31 项工件均逐项重读并重算字节数/哈希，全部匹配取证报告；清单自身为 4755 字节，SHA-256 `3e37f7177c0f48197358d8b11c3fa24f8f0e6d55b576cd5001cf041bb8b9441b`。后来生成的 `delivery.json`、`report-review.json` 不在该生成时清单内，不构成已列工件缺失；本次两项独立审查未采信旧复审结论替代原始证据核对。

取证报告固定 blob 为 14018 字节，SHA-256 `3a9d3fd8cdea4b4d2a32dbf53f6a4c489a3df412bef8310e816f8d0495fa106d`，与工作树及交付记录一致。

## 4. 保全与验收边界

`preservation-before.json` 与 `preservation-after.json` 的 48 项原件逐项核对一致：12 个旧取证文件、20 个修复证据文件、14 个准备失败记录及 2 份旧报告。两份清单本身逐字节相同；原工作树、修复工作树中的旧报告与固定 Git blob 及新工作树副本一致。

[WINDOWS-VALIDATION-2026-11-23.md](WINDOWS-VALIDATION-2026-11-23.md)、[CLEANUP-FIX-2026-11-23.md](CLEANUP-FIX-2026-11-23.md)、本次取证报告及全部既有日志均保留，不覆盖或改写。旧结果仍为 `FAIL/CLEANUP_FAILED`；旧残留引用仍为 `hk-acl-f03a3e07eb4f4c13a5ee8d1326ec84a4`。没有访问、清理或认领旧候选，也不声称其当前内容、存在状态或已清理。

本次通过仅覆盖新引用对应的 Windows 合成目录/文件 ACL、自然继承、固定哨兵读写、内存负控与工具受控清理。它不证明原始失败的唯一根因、跨用户拒绝读取、Windows/POSIX 0700/0600 全场景等价、原探针 Node 写入路径、同份配置绑定或 TOCTOU 已解决，也不证明设备激活、地址/账号/证书或接口能力。

本次文档交付只新增本记录；不重跑、不手动清理、不放宽 ACL、不修改安全策略，不连接设备、不读取真实配置或凭据，不运行门禁探针或 E1/E2，不合并、部署或上线。仅按用户授权提交及普通推送独立文档分支，并核对远端完整 SHA。**本验收结论不作 E1 放行。**
