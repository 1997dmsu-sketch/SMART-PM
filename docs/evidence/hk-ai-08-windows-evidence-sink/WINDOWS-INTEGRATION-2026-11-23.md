# Windows 证据写入、ACL、文件身份及 TOCTOU 离线接入执行记录

本报告记录本机执行事实，交独立复审；不代替最终独立验收。最终 run03 的原 140 项、原 264 项、分层原生 16 项和 Windows 接入 43 项全部符合各自预期，四进程退出码均为 0。run01、run02 的真实失败没有撤销或改记，通过结论只限本版本、合成输入和假传输下的离线接入。allowRead 保持 false；不作完整 CLI、真机、清理能力或 E1 放行结论。

## 固定起点与变更

- 固定起点/工作树初始 HEAD：`174d666bc1744d9dcda1d0f321571038af6bf2a4`，其父 `f0d3a6d4a93e64cbe8e57fa31164b827edfad8d0`。
- 独立分支：`feat/hk-ai-08-windows-evidence-sink`；独立工作树为 `D:\chatgpt\smart\SMART-PM-windows-evidence-sink`。初始工作树干净；没有切换、清理其他工作树或处理旧残留。远端仓库 `https://github.com/1997dmsu-sketch/SMART-PM.git`。
- 仅修改原 bridge，新增 `tools/hikvision-windows-evidence-sink/` 和本报告。原 140/264 测试、checker、bytes loader、原 ACL 模块及所有历史报告/日志保持原样；以最终 diff 及下列原始字节哈希复核。
- 原八 API、离线十一 API 的行为保留；独立 Windows 十一 API 通过同实例私有 snapshot/projection/binding/permit 持有 native capability，不在桥外重建配置，不允许调用方指定路径、能力、任意执行器或任意输出回调。

## 实现与门禁

Windows 模式只接受既有闭式合成字节契约和品牌假传输，输出政策固定为 `synthetic-windows-handle-acl-v1`。permit 在首 await 前消费；根验证先于签发许可及假调用，异步原生返回后再次验证撤销、epoch、取消及合成窗口。prepare 返回绑定/签发 token 前已将 native 能力不可重定向地私有关联到同份快照。缺失能力、坏品牌、跨绑定、已用/撤销/超时/取消或上下文变化均拒绝，失败不恢复许可。原始 allowRead=true 输入仍拒绝。

broker 仅启动已有 Windows PowerShell 5.1 Desktop 的固定 host，以有界 stdin/stdout 闭式 JSON RPC 通信；没有 socket、真实传输或凭据/配置 argv/environment。C#5/.NET CodeDOM 从固定源码编译，保留源码、DLL、编译输出及元数据，不安装依赖。新根限内建当前用户 LocalApplicationData 的固定本地 NTFS；真实卷句柄要求 NTFS 和持久 ACL 能力，非管理员执行。SID 只用于本地 ACL 比较，不进入日志。

卷根和逐级祖先以相对父句柄持有，拒绝 reparse/卷变化，不共享 DELETE；根以原子 FILE_CREATE 创建、已存在即失败。根创建时即为当前用户 owner、受保护规范 DACL，仅当前用户和 SYSTEM 两个 FullControl ACE（mask=2032127，根 flags=3）。文件以固定两名称相对根句柄 FILE_CREATE，文件非目录、单链接、独占句柄，天然继承两 ACE（flags=16），不重设文件 ACL。读取 raw descriptor 检查每条 ACE，并与适配策略的 distinct SID 集合交叉核对，未知/额外 ACE 不过滤。

持有对象的原生卷序列和 128 位文件 ID、属性、链接数、ACL 在阶段边界复核。同一文件句柄执行有界 WriteFile、FlushFileBuffers、起点回读及逐字节比较；根目录通过句柄有界枚举，只接受本轮已知项。没有先穿越后补查、mtime/路径等价或 POSIX 降级。新对象不确定标志先于 create 尝试置位，失败保留实际完成计数。关闭只释放自有句柄/worker，不删除对象；首次 close 结果缓存，失败不重试、不回滚。

只有实际 await 完成、十三项 checks 全 true、六项 counts 符合完整写入约束、未关闭且无未确认对象、最终控制门禁通过，才允许输出 PASS。写入途中撤销/取消可能已经产生部分或完整文件，必须最终 FAIL 并保留实际量。磁盘 summary.json 标为 `recordType=pre-final-output-summary`、`notFinalAcceptance=true`，后续失败不能覆盖文件补写 PASS；synthetic-response.json 只存合成标记。

worker 流在解析前保留 raw bytes；正常 close 还要求确认退出码 0、UTF-8 完整结束、无未终结 JSON、无异常 stderr/超限/日志失败。启动前先持久化分配引用，防止丢失响应后无法引用对象；分配引用不证明对象已创建。

## 实际环境、命令与三次尝试

真实平台 Win32NT，OS 版本 `10.0.22631.0`。Node `v24.16.0`；主原生驱动和 worker 为 `powershell.exe`、Windows PowerShell `5.1.22621.6133`、Desktop。外层管道采集器是已安装 PowerShell `7.6.9` Core，只负责启动/捕获，未替代 PS5.1 原生执行。Node 候选 2 个，实际取第一个；powershell.exe 候选 1 个。没有安装、升级、管理员提权或执行策略绕过。sandbox 对用户已授权的新随机目录写入审批不改变 Windows 用户令牌。

三次尝试均在固定起点独立工作树根目录顺序启动下列实际命令，依赖阶段非零即停止；使用独立 Process.ExitCode，在任何后续命令前保存，stdout/stderr 直接从 BaseStream 到 CreateNew 原件。时区为 Asia/Shanghai（+08:00），真实日期均为 2026-11-23。

```text
node .\tools\hikvision-offline-config-binding\test\bridge.test.mjs
node .\tools\hikvision-offline-entry\test\entry.test.mjs
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\tools\hikvision-windows-evidence-sink\Test-NativeEvidence.Tests.ps1
node .\tools\hikvision-windows-evidence-sink\test\windows-entry.test.mjs
```

表中 passed 是符合预期的用例数；负控观察到 FAIL 并正确拒绝可使测试 PASS，不能把该 native 负控对象改记为原生成功。

| run / 阶段 | 实际开始～结束（+08:00） | 退出码 | 实际结果 |
| --- | --- | --- | --- |
| 01 / binding-regression | 11/23/2026 14:25:09～11/23/2026 14:25:09 | 0 | PASS 140/140; failed=0 |
| 01 / offline-entry-regression | 11/23/2026 14:25:09～11/23/2026 14:25:09 | 0 | PASS 264/264; failed=0 |
| 01 / native-fixtures | 11/23/2026 14:25:09～11/23/2026 14:25:10 | 1 | FAIL planned=16, executed=2, passed=0, failed=2, blocked=0, NOT_EXECUTED=14 |
| 01 / windows-entry | NOT_EXECUTED | — | NOT_EXECUTED |
| 02 / binding-regression | 11/23/2026 14:29:02～11/23/2026 14:29:02 | 0 | PASS 140/140; failed=0 |
| 02 / offline-entry-regression | 11/23/2026 14:29:02～11/23/2026 14:29:03 | 0 | PASS 264/264; failed=0 |
| 02 / native-fixtures | 11/23/2026 14:29:03～11/23/2026 14:29:04 | 0 | PASS planned=16, executed=16, passed=16, failed=0, blocked=0, NOT_EXECUTED=0 |
| 02 / windows-entry | 11/23/2026 14:29:04～11/23/2026 14:29:16 | 1 | FAIL planned=43, executed=40, passed=39, failed=1, blocked=0, NOT_EXECUTED=3 |
| 03 / binding-regression | 11/23/2026 14:34:49～11/23/2026 14:34:49 | 0 | PASS 140/140; failed=0 |
| 03 / offline-entry-regression | 11/23/2026 14:34:49～11/23/2026 14:34:49 | 0 | PASS 264/264; failed=0 |
| 03 / native-fixtures | 11/23/2026 14:34:49～11/23/2026 14:34:50 | 0 | PASS planned=16, executed=16, passed=16, failed=0, blocked=0, NOT_EXECUTED=0 |
| 03 / windows-entry | 11/23/2026 14:34:50～11/23/2026 14:35:05 | 0 | PASS planned=43, executed=43, passed=43, failed=0, blocked=0, NOT_EXECUTED=0 |

run01：MEMORY-01、MEMORY-02 为 ASSERTION_FAILED；CAPABILITY-01 和后续十三 native/fault 用例 NOT_EXECUTED，Windows 接入 NOT_EXECUTED。纯内存诊断把两次失败定位在 MODULE_HASH / CommandNotFoundException / ObjectNotFound：本机 PS5.1 不提供 Get-FileHash。保留该驱动原字节快照后，仅将两处 hash 调用替换为 .NET SHA256 对 ReadAllBytes 的计算，不更改固定期望哈希/策略断言、依赖或策略环境。诊断进程退出 0 只是诊断完成；其 JSON 内两次状态仍为 FAIL。编译器引用已分配但未初始化、无原生 evidenceRef，不宣称建立了目录。

run02：原生分层 16/16 通过；Windows 接入实际执行 40、通过 39、失败 CONTROL-009，CONTROL-010～012 NOT_EXECUTED，harnessFailures=[]。对应 worker 原始 RPC 完成写入和关闭且退出 0，外层测试仍真实 FAIL。静态定位发现 broker 的闭式 counts 为 null 原型，测试 spread 得到普通对象后与未投影对象做 strict deepEqual，字段相同时也会失败；纯内存诊断复现该比较行为（nativeExecution=NOT_EXECUTED）。原测试未输出断言栈，因此不把诊断推导伪称为原日志中的详细 assertion diff。保留失败源码快照后，仅改一行使双方都 spread；原 exact 六键、安全整数、六值严格比较全部保留，不改原生/ACL/许可或忽略 validationCalls。两项测试封装修复均经只读交叉复核。

run03：在修复后的真实最终源码上重新顺序执行，四阶段 PASS，共 140＋264＋16＋43＝463 项符合预期。failedCaseIds、blockedCaseIds 均为空，接入 harnessFailures=[]，无超时、无启动异常，所有子进程已确认结束。此后不再重跑产品或用例。

### 最终分层明细

原回归：CB-01～CB-06 分别 46/6/5/50/23/10；LOADER/BINDING/FLOW/AUTH/PERMIT/OUTPUT 分别 66/48/37/23/53/37。Windows 接入 PRECHECK/NATIVE/BRAND/CONTROL/WRITE/OUTPUT 分别 6/2/16/12/5/2，全部执行且通过。

PS5.1 分层为 memory-policy-reference 2、compiler-capability 1、actual-native 10、fault-injection 3。原 51 场景策略套件及旧主预检未运行；两项内存 reference 不等同重新运行原 51 项。下表是最终实际 native/fault 结果，六计数顺序为 directoriesCreated/filesCreated/bytesWritten/bytesVerified/flushes/validationCalls。

| case | 分类 / fixture | 预期＝观察 code | 六计数 | newObjectStateUnverified | retained / closed |
| --- | --- | --- | --- | --- | --- |
| NATIVE-01 | actual-native / positive | OK | 1/2/198/198/2/5 | False | True / True |
| NATIVE-02 | actual-native / collision | NAME_COLLISION | 1/2/198/198/2/4 | True | True / True |
| NATIVE-03 | actual-native / delete-access | DELETE_ACCESS_DENIED | 1/0/0/0/0/0 | True | True / True |
| NATIVE-04 | actual-native / wrong-id | FILE_ID_MISMATCH | 1/2/0/0/0/0 | True | True / True |
| NATIVE-05 | actual-native / root-acl-narrow | ROOT_ACL_INVALID | 1/0/0/0/0/1 | True | True / True |
| NATIVE-06 | actual-native / file-acl-narrow | FILE_ACL_INVALID | 1/1/0/0/0/1 | True | True / True |
| NATIVE-07 | actual-native / unknown-entry | UNKNOWN_ENTRY | 1/1/0/0/0/1 | True | True / True |
| NATIVE-08 | actual-native / reparse | REPARSE_POINT | 3/0/0/0/0/0 | True | True / True |
| NATIVE-09 | actual-native / hardlink | FILE_LINK_COUNT_INVALID | 1/2/0/0/0/0 | True | True / True |
| NATIVE-10 | actual-native / root-collision | NAME_COLLISION | 1/2/198/198/2/5 | True | True / True |
| FAULT-01 | fault-injection / partial-write | INJECTED_PARTIAL_WRITE | 1/1/7/0/0/2 | True | True / True |
| FAULT-02 | fault-injection / flush-failure | INJECTED_FLUSH_FAILURE | 1/1/61/0/0/2 | True | True / True |
| FAULT-03 | fault-injection / read-mismatch | INJECTED_READ_MISMATCH | 1/1/61/0/1/2 | True | True / True |

collision/root-collision 的 FAIL/NAME_COLLISION 状态保留，不清除不确定标记；测试 PASS 只表示预期拒绝/原内容未变断言成立。hardlink 的 filesCreated=2 是两个目录项、一个文件身份。wrong-id 为两个实际 ID 的拒绝比较，不是恶意替换实验；delete-access 为请求 DELETE 权限的打开被拒绝，没有实际删除/重命名。ACL 负控仅对本次新 fixture 收紧（移除 SYSTEM），不扩权；宽 ACL 只在纯内存 reference 中拒绝。reparse 为本次新建 target/junction，均保留。三 FAULT 为受控注入，不声称实盘存储故障。

十三项 checks 固定为 platformSupported、identitySupported、locationSupported、ancestorHandlesHeld、rootCreatedExclusive、rootAclValid、nativeIdentityValid、rootEntriesValid、filesCreatedExclusive、fileAclsValid、contentVerified、flushVerified、deleteSharingDenied。最终 PS positive 全 true，六计数 1/2/198/198/2/5，retained=true、closed=true、unverified=false。

Windows 主 positive 的原始 worker RPC id=11 write 全十三 true，六计数 1/2/917/917/2/13，PASS/OK、closed=false、unverified=false；id=12 close 六计数仅 validationCalls 变为14，其余相同，PASS/OK、closed=true。ref 为 hk-win-sink-ba27b67879174f46ac3145889ea1b918，compiler 为 hk-win-compile-5d12f45ae3ff4cc38dac1bc3ef4220b7。负控没有完成的检查保持 false，其完整向量保存在原始 native JSON；绝不把所有负控十三项写成 true。

## 原始字节来源及前后哈希

每个实际启动阶段均保存覆盖十五文件的 sources.before.json / sources.after.json；共十一对（run01三对，run02四对，run03四对），各对逐文件路径/字节数/SHA-256 一致。下表为最终 run03 的执行前＝执行后＝交付源码原始字节值，不做换行/编码修正。仅两份新增测试驱动在不同尝试间有下述最小修复；其余十三文件（含六个产品核心）在三次尝试间均未变。报告生成不修改该十五文件。

| 路径（仓库相对） | bytes | run03 前＝后 SHA-256 |
| --- | --- | --- |
| `tools/hikvision-offline-config-binding/src/bridge.mjs` | 49226 | `435db8033899ae7891c4ce459d5056f256a00ed9f72df551c112aaa68d95bfe1` |
| `tools/hikvision-offline-config-binding/test/bridge.test.mjs` | 37470 | `1506f319e0792b831bc264a1d8d315cbd3eafb78f560ad795ac957c1260da17a` |
| `tools/hikvision-offline-config-checker/src/check-config.mjs` | 10463 | `a8dbde46942aca550e13fdddb27e93bd5c9d1902e8cbdfb09cb31befc0eecfb7` |
| `tools/hikvision-offline-entry/src/entry.mjs` | 242 | `77b438bf8beaa1ab9c9bdf8885265a72d98d50c39e51feaf0091b7a659cfae76` |
| `tools/hikvision-offline-entry/src/bytes.mjs` | 4894 | `8eb41d8784f66f5d4416d5459ab80fd1cf72f75486afcec1d8e568259ef82e36` |
| `tools/hikvision-offline-entry/test/entry.test.mjs` | 52308 | `bd61740592bdf91efb5b6468c1452ab3e74dd4160084e7cce9c7b2444016746b` |
| `tools/hikvision-windows-evidence-preflight/EvidenceAcl.psm1` | 4661 | `ca1a81bee7cc7f668067a07b956a971740c6ebdfca8c73ca64e9f745ff101bf9` |
| `tools/hikvision-windows-evidence-sink/README.md` | 12723 | `0d5f303e6819839317a2caa4636eabf58fd254619414249cde84f56606439230` |
| `tools/hikvision-windows-evidence-sink/NativeEvidence.psm1` | 4597 | `33ba23cfdc4d3c9ebffd975a038b30c115464f53ec98bf18beefd04eb6e09eea` |
| `tools/hikvision-windows-evidence-sink/native/NativeEvidence.cs` | 40941 | `3ef059f821f042c5d50bc6facc691aab1b2e86be9291807324f841c36da1b32f` |
| `tools/hikvision-windows-evidence-sink/native-host.ps1` | 7551 | `adcfa23c2ec618d740d8be2a3b2797070c05b9cbe05d1a4f1887d28e9f1636f3` |
| `tools/hikvision-windows-evidence-sink/src/native-broker.mjs` | 17962 | `8ed8c9568605cdc12c90202d9f1f134988446af1d5cb0bdf6b579195f6e2123d` |
| `tools/hikvision-windows-evidence-sink/src/entry.mjs` | 264 | `c26360a02d0728c4a85ce89cd2380da6ad79b70feb93d7b4ff8383c9463c519e` |
| `tools/hikvision-windows-evidence-sink/test/windows-entry.test.mjs` | 29707 | `51b21fe0ff93d3d954e59bb43f9763f16eae8f7c2751ad9989a6f3c429ac2505` |
| `tools/hikvision-windows-evidence-sink/Test-NativeEvidence.Tests.ps1` | 16041 | `fba97168138a749d723963532c47c4c6825fc267e521efca57ea1be53627ccc0` |

修复前驱动原字节另存本地（未替换原始日志）：

| 原始快照 | bytes | SHA-256 |
| --- | --- | --- |
| `../HK-AI-08-windows-sink-2026-11-23-run01/failed-source.Test-NativeEvidence.Tests.ps1` | 15871 | `c2515e5242095271de1a304db20dae45f98585c4336fbb36067ec66a4684ec7d` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/failed-source.windows-entry.test.mjs` | 29700 | `eda3161d6ec918ac1df6871a2b84ca79526f6b8b2d8b1a7ec39a21842f6e5a12` |

run01 的 PS 驱动为上述 c2515e...，run02/run03 为最终 fba971...；run01/run02 的 JS 驱动为上述 eda316...，run03 为最终 51b21f...。完整十五文件清单/每对哈希在下列 manifest 原件中，不把不同尝试混为同一源码。

最终 PS compiler 原始记录 sourceSHA256=3ef059f821f042c5d50bc6facc691aab1b2e86be9291807324f841c36da1b32f；assemblySHA256=7a54c2427cd09e29848f7198218563bb968e4cfdccaf867e3b60ad7a20d5b703。其余每 worker 的 DLL 因独立编译而哈希不同，各 compile.metadata.json 和 retained DLL 均已逐一保全/哈希，不要求 DLL 哈希相同。source bytes 核对是来源检查，不承诺整个运行时免于同用户并发修改。

## stdout/stderr、退出码及工件定位

以下路径都以独立工作树根为相对基准，位于本机仓库外，未提交 raw 日志、DLL 或临时文件。原件 CreateNew 保留；脱敏副本把个人 home/SID 替换，严格 UTF-8 解码均成功。下表 raw stdout/stderr 均与对应 `.redacted.txt` 的 bytes/SHA-256 相同（仅合成闭式 JSON/空 stderr），这里的“相同”是逐件计算结果，不是省略脱敏步骤。原件不是最终独立验收结论。

| stdout/stderr 原件（同目录脱敏副本同 bytes/hash） | bytes | SHA-256 |
| --- | --- | --- |
| `../HK-AI-08-windows-sink-2026-11-23-run01/binding-regression.stdout.raw` | 452 | `81f282e630d54649819749875b4b637033e3f102ddfe5950156ad357247cedcc` |
| `../HK-AI-08-windows-sink-2026-11-23-run01/binding-regression.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-windows-sink-2026-11-23-run01/offline-entry-regression.stdout.raw` | 448 | `31f1e9f9067fe110490dfdf47cff69d15f1b78f9c184cf3c3dcbf994a44b9d1e` |
| `../HK-AI-08-windows-sink-2026-11-23-run01/offline-entry-regression.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-windows-sink-2026-11-23-run01/native-fixtures.stdout.raw` | 2466 | `6bbc626a8d464e8b2bbc0db028678333b7b97bd603749f9b505ef8270710a372` |
| `../HK-AI-08-windows-sink-2026-11-23-run01/native-fixtures.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/binding-regression.stdout.raw` | 452 | `81f282e630d54649819749875b4b637033e3f102ddfe5950156ad357247cedcc` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/binding-regression.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/offline-entry-regression.stdout.raw` | 448 | `31f1e9f9067fe110490dfdf47cff69d15f1b78f9c184cf3c3dcbf994a44b9d1e` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/offline-entry-regression.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/native-fixtures.stdout.raw` | 13968 | `38e242a4535f4c5352f8723f802fd3d7496040feddfaa0dc8b5b916890930add` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/native-fixtures.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/windows-entry.stdout.raw` | 4379 | `3a24800a68938382a0543ff701976ff52deceb14ac0059fb9f1f1f3e72f7e729` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/windows-entry.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-windows-sink-2026-11-23-run03/binding-regression.stdout.raw` | 452 | `81f282e630d54649819749875b4b637033e3f102ddfe5950156ad357247cedcc` |
| `../HK-AI-08-windows-sink-2026-11-23-run03/binding-regression.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-windows-sink-2026-11-23-run03/offline-entry-regression.stdout.raw` | 448 | `31f1e9f9067fe110490dfdf47cff69d15f1b78f9c184cf3c3dcbf994a44b9d1e` |
| `../HK-AI-08-windows-sink-2026-11-23-run03/offline-entry-regression.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-windows-sink-2026-11-23-run03/native-fixtures.stdout.raw` | 13968 | `619e3c0e76e70383166b40f409f801c6d071722f0824f1c106e564cac9f75e7e` |
| `../HK-AI-08-windows-sink-2026-11-23-run03/native-fixtures.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-windows-sink-2026-11-23-run03/windows-entry.stdout.raw` | 4576 | `b85789066bbeabe5610b69b31845b36a55bbed61e13ae8ba899b027aae8bb6a9` |
| `../HK-AI-08-windows-sink-2026-11-23-run03/windows-entry.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

退出码原件为每个 raw 同前缀 `.exitcode.txt`，精确 2 bytes（0 或 1 加 LF），在每 run 原始 artifacts.manifest.json 中有独立哈希；表一的退出码来自各 stage metadata，非后续 shell 的 LASTEXITCODE。未执行阶段没有伪造空 stdout 或退出码。每个实际阶段 metadata 保留独立起止时间、命令、超时/静止和 UTF-8 状态。

下列原始 manifest 及追加总清单通过各文件的 bytes/hash 链定位所有日志、退出码、源码 before/after、两次诊断、失败源码快照、33 个分配引用 journal、33 个实际 compiler 目录的已知文件，以及 31 个 worker 的 raw stdout/stderr、脱敏副本和独立退出码。所有这些 worker 已确认退出0，管道未截断、streamsComplete=true、stderr=0。直接 PS fixture 两个 compiler 的进程流在 run02/run03 native-fixtures raw 中，不伪造 host-pipes 文件。run01 compiler 仅分配、未建立 compiler 目录。

原始 artifacts.manifest.json 不覆盖；总清单追加覆盖诊断/失败快照等后加工件。清单不包含自身及随后生成的报告/交付回执，不存在自哈希主张。编译器生成的 .cs/.dll/.cmdline/.out/.err/.tmp（实际存在者）、compile.metadata、host 管道及全新 journal 均保留；其中源码临时副本可有编译器 BOM，其哈希独立记录，不能与读取来源字节混同。

| 定位（工作树相对） | bytes | SHA-256 |
| --- | --- | --- |
| `../HK-AI-08-windows-sink-2026-11-23-run01/run.metadata.json` | 2795 | `6a6d7713819b5d08db011fd49d2a9a9f323f805c95175c5456a60186d0e951ef` |
| `../HK-AI-08-windows-sink-2026-11-23-run01/artifacts.manifest.json` | 4383 | `d559cc27ca1957b31de559b614b05cedd58c255de32c2e1255accb16cb6553f2` |
| `../HK-AI-08-windows-sink-2026-11-23-run01/new-reference-ledgers.json` | 2 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/run.metadata.json` | 3366 | `5d051e7739a83c9c04ef41cbf857ee4258a490c5c508448260152415cb7c65d5` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/artifacts.manifest.json` | 5650 | `4b9d3f9f43b2456d13bdee11ad59ce09ad02b760d20954702e5157b8e83f50e1` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/new-reference-ledgers.json` | 4132 | `d76e324cd38785fbc1c5bdb19248ca89d0fc3845a1af966e1498578642e88b39` |
| `../HK-AI-08-windows-sink-2026-11-23-run03/run.metadata.json` | 3366 | `f15a23db4019fb738f48182ec23d7dc36ac9fd0b55c320d6df2a36d893975d66` |
| `../HK-AI-08-windows-sink-2026-11-23-run03/artifacts.manifest.json` | 5650 | `63d19979ad00b6efaac21936ffdf944075eb6b41436ce91d8c9193aad3a7702b` |
| `../HK-AI-08-windows-sink-2026-11-23-run03/new-reference-ledgers.json` | 4957 | `c78c8fb33ad28c5fa5dd385d2bced2f12177eb31c93a29197589bd74705b66c6` |
| `../HK-AI-08-windows-sink-2026-11-23-run03/retained-artifacts.inventory.json` | 210751 | `1f3573983f156e6df0a28d855307511ad966ecd68cd57e7b24f75ae5ea656514` |
| `../HK-AI-08-windows-sink-2026-11-23-run01/memory-diagnostic.stdout.raw` | 416 | `bdbc77352a7c5f9007e08a9c5108b6f6ea40cbc30bcf90b1082e11daa9f61c08` |
| `../HK-AI-08-windows-sink-2026-11-23-run01/memory-diagnostic.stdout.redacted.txt` | 416 | `bdbc77352a7c5f9007e08a9c5108b6f6ea40cbc30bcf90b1082e11daa9f61c08` |
| `../HK-AI-08-windows-sink-2026-11-23-run01/memory-diagnostic.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-windows-sink-2026-11-23-run01/memory-diagnostic.stderr.redacted.txt` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-windows-sink-2026-11-23-run01/memory-diagnostic.exitcode.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/prototype-diagnostic.stdout.raw` | 177 | `08ba49e710a25cd7a823e85d466b289ea4454dc9079f622b061b190066a073bf` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/prototype-diagnostic.stdout.redacted.txt` | 177 | `08ba49e710a25cd7a823e85d466b289ea4454dc9079f622b061b190066a073bf` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/prototype-diagnostic.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/prototype-diagnostic.stderr.redacted.txt` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-windows-sink-2026-11-23-run02/prototype-diagnostic.exitcode.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |

总清单只读取本任务已知 compiler/log 文件和 journal，不访问、枚举或复核任何 LocalAppData native evidence 根，不递归扫描旧工作区/秘密目录。编译/管道日志不在受保护 native 根中，不能据其权限宣称真实原始设备数据已受保护。

## 新旧引用保全与停止状态

旧引用原样保留，未打开其残留根、未重跑原报告/旧测试或清理：

- hk-acl-f03a3e07eb4f4c13a5ee8d1326ec84a4
- hk-acl-ede6254418504fb5be49561f3cdb0865
- hk-node-acl-549bdd3a8849407aa3dd9253ff28c6dd
- hk-node-acl-8023cbfe08e44160a493abacd7c88246
- hk-cb-143b0d8768dc4ef4acd470f2daaf5d94
- hk-entry-f67a184f60d3402f8a532606ec1863f2

本次三组引用如下，分组顺序与实际 stdout 一致；每引用的工件关系见总清单，native fixture 的 compilerRef=null 表示同一 PS 进程共用其顶层 compiler，不表示丢失来源。run02 27 个、run03 30 个 native evidenceRef，共57个；每个根下的新增目录项/负控/部分文件均保留，不据根引用数计算文件总量。

### run01：hk-win-run-2b8e3d7743a0443b963874f2ecb90ac4

native-fixtures evidenceRefs：
```text
(none)
```
compilerRefs：
```text
hk-win-compile-337430ba6ffe43348ea04470ea8d435c
```
windows-entry: NOT_EXECUTED

### run02：hk-win-run-258b9e693d50479cab4e108ff2a8b5f7

native-fixtures evidenceRefs：
```text
hk-win-sink-cee3124f0cb14f1e8e655d21dd1c1cf2
hk-win-sink-f05ea191ff56403c800cce323f291407
hk-win-sink-8406042487874c1eaffe647ea2a9a345
hk-win-sink-94b1d3fdc95649d1b3772d62e6a13841
hk-win-sink-67dd6733760246629476e753467b27a5
hk-win-sink-3d2f4d8e83844443beaafb4f32207f79
hk-win-sink-f432392a4026462eb59afde1b84f2404
hk-win-sink-9c6641619f1b4d1f9883c420616fc36e
hk-win-sink-ecd5e43b89564850b3b5a135d5d87526
hk-win-sink-975ae3558d54487a9571f45c6856a545
hk-win-sink-763f8b1f1d944023970e281674bfb42d
hk-win-sink-d74776d435344385a211bb585631306d
hk-win-sink-24ec0c7f8b85404e8e4755fd28031855
```
compilerRefs：
```text
hk-win-compile-8ce3adadfe524c4f983a2d7834517b6b
```

windows-entry evidenceRefs：
```text
hk-win-sink-03ea821a196a43a1abb90265e2bc51a2
hk-win-sink-310fa54cea584213acf320153f022025
hk-win-sink-98e7d96552824845bbbef7e0730147fc
hk-win-sink-30e0727420a544608eb2a632aa9ab539
hk-win-sink-120fdbb9256f422eadc8f5259bb908ab
hk-win-sink-90e1a434a6a6436194590bc68b1e0596
hk-win-sink-0b61b7a3b07747178ec105d04ecd699a
hk-win-sink-db1e5a6b47c14b91bf59320953efb03e
hk-win-sink-badf84d59aae41afae9cff3264fa255d
hk-win-sink-6697c91024c34460afe9558a1c6bcf75
hk-win-sink-713a48d095514551a9d4788047f9fcd7
hk-win-sink-527598e01edd4fbb9ac2ca1be394583f
hk-win-sink-0c74c8a199dc43bb9583aa034552577a
hk-win-sink-eb9d7590743f4956b85c19c063f7f4d3
```
compilerRefs：
```text
hk-win-compile-3706834ed351473eba3fb229e8745d07
hk-win-compile-59d168b7281048f1bc4ae10841c71693
hk-win-compile-713add5366f3408088e880257486b030
hk-win-compile-dcfa977b71b243d58a86d8e9453bcb5f
hk-win-compile-c02882116b7547babac97599d068c90f
hk-win-compile-3f07948fee4a4296a44f30daf160bd60
hk-win-compile-c61feba78f704d26bdf646865aa20aa0
hk-win-compile-f09313ecd7554ba1acc992a5427d4fa0
hk-win-compile-666d25d8a551436e969f1d7dbe3bc4db
hk-win-compile-4645d894aece43fa91f6a0563e814f2f
hk-win-compile-041f481cb45c40d7b5a9d3aa779176f4
hk-win-compile-3ac0fdb94d90454ebe4a4eb058d0671d
hk-win-compile-18433da31b3e4f00bbb8c364493b3673
hk-win-compile-7092b67665034aecb134e398e27ca3b1
```

### run03：hk-win-run-edde9b9807cb4a4cb28874cd5c67c63d

native-fixtures evidenceRefs：
```text
hk-win-sink-899060283e4f4a5ba98890d3731b3818
hk-win-sink-504743276a4744d9aa010fb6e3f3c5e2
hk-win-sink-a93790de74ba4933b236a5a6aeaa934f
hk-win-sink-4373bcc1a7f146f785759ab6f9bb9496
hk-win-sink-f19f7ea880f342a185e90aa40dc7eb99
hk-win-sink-0b8b41440cdd4ca3a4c27cacebadd031
hk-win-sink-e27ee253531f4398b88e4ece921b2da2
hk-win-sink-6579e93bb60846f09d2eb9f0a24a82cf
hk-win-sink-8559766757714cb1854edc076a917011
hk-win-sink-e6b0749486994aa394e453639fe53fb9
hk-win-sink-5952200b56fe438abee8a72985f04dd3
hk-win-sink-f025d34868ee4e65a35ce4e863f4adbb
hk-win-sink-34994c2082ad4256bf8e818d35e4cb0c
```
compilerRefs：
```text
hk-win-compile-a2e40a2e04c844a9a2bc935537aaa5d0
```

windows-entry evidenceRefs：
```text
hk-win-sink-ba27b67879174f46ac3145889ea1b918
hk-win-sink-e2f912bcabdd4c039b23ef0adc354618
hk-win-sink-7128764b2fd44339a62b54bf5edd48a6
hk-win-sink-1f9592ba7afd4610a538810f645ca124
hk-win-sink-8ab225305cb04659814910c720a11d3e
hk-win-sink-d836bc8280fe46cea07a629235fa0816
hk-win-sink-0e466768d03f417a8922f9ab8baadede
hk-win-sink-3088c904d21c4ed1a5f73d5b729a135b
hk-win-sink-830e11b7f1094f0986e90e9c7b3097c9
hk-win-sink-eee94dcd743a40efa46037f0f913ecb2
hk-win-sink-3b041cdc11b246cb845ed24717bef993
hk-win-sink-327d8df0d96a480d903eb5d6be20173e
hk-win-sink-5c2feff2c3ae46d6b995593cd6117a70
hk-win-sink-8f67882b50ac4562860d457b85dbd40c
hk-win-sink-e1aa9b7f10774c238de0d9f7beabad58
hk-win-sink-eb62dbf23c244ff4a31a0fe9b7f946d7
hk-win-sink-818360134f7947469bb67ddaf71a5567
```
compilerRefs：
```text
hk-win-compile-5d12f45ae3ff4cc38dac1bc3ef4220b7
hk-win-compile-79a12579731141348bdb0578011ff0b9
hk-win-compile-8d99d34cd39f4c6bad392ed997d3cdda
hk-win-compile-d827b34d4aee4aceaba60e62b55d7250
hk-win-compile-6052c023e2d946038ba0096059d6edb7
hk-win-compile-8c4df78fe89a4539a23a1ef389558955
hk-win-compile-0df942cf280a497eb8b39d210669cda4
hk-win-compile-d1f9a8b1bda0450aa25eac6f95e10c14
hk-win-compile-f13e764f3ed74cd79c5a01b50e1a7a59
hk-win-compile-ccdf1feabb4a4a82ab956742ad423d31
hk-win-compile-93a536b09131418a9d0a18686188979b
hk-win-compile-765b5ab577c54288996bbc78562daee9
hk-win-compile-0f69946c394c40acb88ad68c825c102c
hk-win-compile-cbd0f5820e784b11bfff57ec95213a46
hk-win-compile-d6829e2644dc476881c776ffd8e6cd50
hk-win-compile-2d92be01a63247babf67b675f6fc5886
hk-win-compile-ef62c477ba664224b83447c49ccc9504
```

cleanup=NOT_EXECUTED。retained=true 是程序不删除的声明，并由实现无删除路径及本次日志佐证；closed=true 仅证明自有句柄/worker 已关闭，**没有**事后扫描证明全部残留仍存在/未被外部修改。负控的 unverified=true 如实保留，交复核；不递归删除、不修 ACL、不触碰未知项。所有新旧对象、报告、raw 日志和引用继续保留。

## 范围限制与禁止动作核对

- 已做：静态实现/交叉审阅、合成内存回归、PS5.1 实际 Windows 文件系统操作、假传输接入、真实管道及哈希保全；不把静态推导/故障注入当作实际恶意并发或设备故障实测。
- 未做：真实配置/凭据、原 CLI/runProbe 接入、真实响应/认证、真实审批/凭据租约/时钟、TLS pin-before-send、DNS/peer/网络 deadline、设备能力/激活/账号/证书/地址验证、E1/E2；设备请求为0。没有人员、照片、下发、生产云、支付、HTTP/UI、部署或上线。
- 不承诺 Windows 与 POSIX 0700/0600 全场景等价，不声称已消除恶意同用户/SYSTEM/管理员并发或关闭后的 TOCTOU；private JS 品牌不是同进程攻击隔离沙箱。未验证清理功能，本轮有意停止保全；未来真实数据不得复用 compiler 日志目录作为保密证据根。
- 开发阶段曾只读核对 Microsoft 官方 API 文档；这是资料读取，不是设备访问。执行器和测试没有网络代码或真实传输；交付仅用普通 Git，不增加隔离网络前置。
- 未修改全局/系统 Git、TLS、代理、安全/执行策略；不安装 WSL/依赖/Pester，不 Bypass、不 Unblock-File、不关闭防护、不申请管理员。未枚举环境变量、凭据管理器、任务计划或秘密目录。
- 未 amend/rebase/reset/squash/force/merge/cherry-pick，不推 main。使用独立分支追加提交、普通显式 refspec 推送和 ls-remote 完整 SHA 核验；真实交付 SHA 在提交后回执中记录，不在本文件预填自身提交哈希。若推送失败保留本地，不改配置或强推。

提交推送并核对远端后停手，等待独立复审。本报告仅供本次合成离线接入的限定审查，不授权真机测试或 E1。
