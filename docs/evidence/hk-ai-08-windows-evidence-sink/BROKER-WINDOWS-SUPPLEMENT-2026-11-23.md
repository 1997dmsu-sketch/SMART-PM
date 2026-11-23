# 修复后 broker 的 Windows 离线补充复验：FAIL 停止保全

**本轮未通过，停止并交独立复审/问题定位。** 唯一43项套件真实退出码1；实际执行37、通过36、失败1（CONTROL-006）、未执行6，无BLOCKED、harnessFailures为空。没有重试、改源码/断言、改判PASS或手动清理。11个新worker原生写入/关闭状态正常不等于外层执行/套件通过。

## 固定来源及单轮授权

- 固定工具完整 SHA：`25d141d5d64e1d10800fd6db85e89584283b9205`；独立工作树初始HEAD相同，工作树初始干净。该提交父为 `cf8f7b4b14d0f370e4f34feb64e60696e3c23bad`。
- 独立文档分支：`docs/hk-ai-08-broker-windows-supplement-2026-11-23`；工作树 `D:\chatgpt\smart\SMART-PM-broker-windows-supplement-2026-11-23`。原工作树、既有未跟踪文件、报告/日志/引用均保留；未切换或清理他人工作树。远端新分支事前只读核对不存在。
- 本轮按用户“继续”仅补固定版本的43项Windows接入与实际PowerShell worker管道证据；不扩成全套重新验收。工具源码零修改，只新增本报告。未fetch新tip替代固定提交。
- 原140＋264、16分层原生、14/442内存、原51 ACL策略及旧主预检本轮全部 NOT_EXECUTED。既有结果仅作为对应历史版本/未改组件的继承材料，不能写成本提交重新运行通过。

## 实际环境与命令

真实平台Win32NT，OS `10.0.22631.0`，Node `v24.16.0`；外层采集为已有PowerShell `7.6.9` Core。版本/令牌预检实际启动已安装 `powershell.exe`，结果 `5.1.22621.6133`、Desktop、elevated=false、退出0。预检只查询平台、版本和管理员角色，不输出SID、账号或个人路径，不运行原生fixture。

采集器解析到的powershell.exe为 `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`（候选1），SHA-256 `3247bcfd60f6dd25f34cb74b5889ab10ef1b3ec72b4d4b3d95b5b25b534560b8`；Node候选2，实际取首个，SHA-256 `b3094d0b49f9ad602262a9921551737bb97637c05dd357a06ae98188d7290aa3`。完整候选定位保留在本地runtime-executables.local.json，报告按脱敏副本引用。broker仍以裸名spawn powershell.exe；候选解析/哈希及模块版本门禁不是逐worker的image路径观测或整个运行时的原子固定。

唯一套件实际命令（工作树根）：

```text
node.exe .\tools\hikvision-windows-evidence-sink\test\windows-entry.test.mjs
```

预检实际argv为 `powershell.exe -NoLogo -NoProfile -NonInteractive -Command` 加以下参数原文（另存于已哈希的capture-supplement.ps1）：

```powershell
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
try{$elevated=[Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);[ordered]@{platform=[Environment]::OSVersion.Platform.ToString();psVersion=$PSVersionTable.PSVersion.ToString();psEdition=$PSVersionTable.PSEdition;elevated=$elevated}|ConvertTo-Json -Compress}finally{$identity.Dispose()}
```

每个产品worker固定由broker以 `powershell.exe -NoLogo -NoProfile -NonInteractive -File <固定native-host.ps1> -EvidenceRef <本轮新随机引用> -CompilerRef <本轮新随机引用>` 启动。无pwsh替代、WSL、安装/升级、管理员提权、策略绕过或关闭防护。

| 阶段 | 实际开始～结束（Asia/Shanghai，+08:00） | 退出码 | 结果 |
| --- | --- | --- | --- |
| 版本/角色预检 | 2026-11-23T15:31:25.6828420+08:00～2026-11-23T15:31:25.9310614+08:00 | 0 | Windows PowerShell 5.1 Desktop，非管理员 |
| 43项Windows接入唯一一轮 | 2026-11-23T15:31:25.9698060+08:00～2026-11-23T15:31:35.3787063+08:00 | 1 | FAIL；37执行/36通过/1失败/6未执行 |

两进程均无启动异常/超时，直接子进程已结束，stderr均0，严格UTF-8解码成功。childQuiescent只确认直接预检PS/Node，不单独代表全部worker；本次11个worker的退出由其各自原始日志、退出码及metadata另行核对。stdout/stderr由BaseStream保存，在WaitForExit后立即取得Process.ExitCode，并在管道复制完成后独立保存；后续shell退出值未代替子进程结果。所有目标先检查不重名、CreateNew保全，未发生上轮baseline的元数据重名问题。

## 实际计数、失败与停止状态

| group | planned | executed | passed | failed | blocked | notExecuted |
| --- | --- | --- | --- | --- | --- | --- |
| PRECHECK | 6 | 6 | 6 | 0 | 0 | 0 |
| NATIVE | 2 | 2 | 2 | 0 | 0 | 0 |
| BRAND | 16 | 16 | 16 | 0 | 0 | 0 |
| CONTROL | 12 | 6 | 5 | 1 | 0 | 6 |
| WRITE | 5 | 5 | 5 | 0 | 0 | 0 |
| OUTPUT | 2 | 2 | 2 | 0 | 0 | 0 |

failedCaseIds=[CONTROL-006]；blockedCaseIds=[]；harnessFailures=[]。CONTROL-007～012原始状态为NOT_EXECUTED/DEPENDENCY_FAILED。捕获器记录gateError=WINDOWS_ENTRY_PROCESS_FAILED，整体退出1，未运行任何后续套件。

原始工具JSON如下（与raw/redacted内容一致，仅合成闭式状态/非敏感引用）：

```json
{"scope":"synthetic-windows-evidence-entry-tests","status":"FAIL","counts":{"planned":43,"executed":37,"passed":36,"failed":1,"blocked":0,"notExecuted":6},"failedCaseIds":["CONTROL-006"],"blockedCaseIds":[],"harnessFailures":[],"groupCounts":[{"id":"PRECHECK","planned":6,"executed":6,"passed":6,"failed":0,"blocked":0,"notExecuted":0},{"id":"NATIVE","planned":2,"executed":2,"passed":2,"failed":0,"blocked":0,"notExecuted":0},{"id":"BRAND","planned":16,"executed":16,"passed":16,"failed":0,"blocked":0,"notExecuted":0},{"id":"CONTROL","planned":12,"executed":6,"passed":5,"failed":1,"blocked":0,"notExecuted":6},{"id":"WRITE","planned":5,"executed":5,"passed":5,"failed":0,"blocked":0,"notExecuted":0},{"id":"OUTPUT","planned":2,"executed":2,"passed":2,"failed":0,"blocked":0,"notExecuted":0}],"caseResults":[{"id":"PRECHECK-001","status":"PASS","code":"OK"},{"id":"PRECHECK-002","status":"PASS","code":"OK"},{"id":"PRECHECK-003","status":"PASS","code":"OK"},{"id":"PRECHECK-004","status":"PASS","code":"OK"},{"id":"PRECHECK-005","status":"PASS","code":"OK"},{"id":"PRECHECK-006","status":"PASS","code":"OK"},{"id":"NATIVE-001","status":"PASS","code":"OK"},{"id":"BRAND-001","status":"PASS","code":"OK"},{"id":"BRAND-002","status":"PASS","code":"OK"},{"id":"BRAND-003","status":"PASS","code":"OK"},{"id":"BRAND-004","status":"PASS","code":"OK"},{"id":"BRAND-005","status":"PASS","code":"OK"},{"id":"BRAND-006","status":"PASS","code":"OK"},{"id":"BRAND-007","status":"PASS","code":"OK"},{"id":"BRAND-008","status":"PASS","code":"OK"},{"id":"BRAND-009","status":"PASS","code":"OK"},{"id":"BRAND-010","status":"PASS","code":"OK"},{"id":"BRAND-011","status":"PASS","code":"OK"},{"id":"BRAND-012","status":"PASS","code":"OK"},{"id":"BRAND-013","status":"PASS","code":"OK"},{"id":"BRAND-014","status":"PASS","code":"OK"},{"id":"BRAND-015","status":"PASS","code":"OK"},{"id":"BRAND-016","status":"PASS","code":"OK"},{"id":"WRITE-001","status":"PASS","code":"OK"},{"id":"WRITE-002","status":"PASS","code":"OK"},{"id":"OUTPUT-001","status":"PASS","code":"OK"},{"id":"OUTPUT-002","status":"PASS","code":"OK"},{"id":"NATIVE-002","status":"PASS","code":"OK"},{"id":"WRITE-003","status":"PASS","code":"OK"},{"id":"WRITE-004","status":"PASS","code":"OK"},{"id":"WRITE-005","status":"PASS","code":"OK"},{"id":"CONTROL-001","status":"PASS","code":"OK"},{"id":"CONTROL-002","status":"PASS","code":"OK"},{"id":"CONTROL-003","status":"PASS","code":"OK"},{"id":"CONTROL-004","status":"PASS","code":"OK"},{"id":"CONTROL-005","status":"PASS","code":"OK"},{"id":"CONTROL-006","status":"FAIL","code":"ASSERTION_FAILED"},{"id":"CONTROL-007","status":"NOT_EXECUTED","code":"DEPENDENCY_FAILED"},{"id":"CONTROL-008","status":"NOT_EXECUTED","code":"DEPENDENCY_FAILED"},{"id":"CONTROL-009","status":"NOT_EXECUTED","code":"DEPENDENCY_FAILED"},{"id":"CONTROL-010","status":"NOT_EXECUTED","code":"DEPENDENCY_FAILED"},{"id":"CONTROL-011","status":"NOT_EXECUTED","code":"DEPENDENCY_FAILED"},{"id":"CONTROL-012","status":"NOT_EXECUTED","code":"DEPENDENCY_FAILED"}],"evidenceRefs":["hk-win-sink-d01815cccd2e435780ad9a27e45dfdf2","hk-win-sink-247c3df892f64bcfb5a1489b648f9a41","hk-win-sink-7a021b94c24245c390dfa7ec170392ca","hk-win-sink-af544fc80b474bf4bd4a60b4beffd8fe","hk-win-sink-54304c0456e14b018ad50fb7b964da76","hk-win-sink-2aeabf343f95482cbae7d1f0605d51e2","hk-win-sink-01a58be0669e445c8acb1eeff7f23eb9","hk-win-sink-e0ba1db7a22b4cb79ca8d6a9668724c9","hk-win-sink-a4f790ff3bfc4f1b9912e9e49d4087c6","hk-win-sink-75d1ce40ba5144f58133835d7eac874b","hk-win-sink-5611937e4ae9497e81ac43da392b99b4"],"compilerRefs":["hk-win-compile-4991ffbd40724ce5bae33fa33c793af3","hk-win-compile-f76b47851b3a44e583ac94d953ca22aa","hk-win-compile-0b65c5f670e6425abb4ea67ff835dd45","hk-win-compile-a63c7f6654fc4eb784e4a02f26c2c2ec","hk-win-compile-eafc9c9aa13d4491a50b87febabc4e8c","hk-win-compile-f04c040e7bc3425ea08db81f591a1de5","hk-win-compile-14ba1a1a0e0748a6b84eaaa377689059","hk-win-compile-2905a5335b5744289d6584ece5647f39","hk-win-compile-cc8df0eefdaa4470a1593baddd2bc4f4","hk-win-compile-f2ce6d27db154b01a1c639bc6b28b91b","hk-win-compile-6944120fe19e42fc8a44fd66bd31eb3c"],"cleanup":"NOT_EXECUTED"}
```

### 最小问题定位，保留不确定性

CONTROL-006是第二轮控制用例中的SESSION_CANCELLED例。`windows-entry.test.mjs` 的injectWhile在setImmediate/setTimeout轮询中只观察 `transport.calls===6`；该计数达到6后不再变化，不能证明写入尚未开始。该组随后要求calls=6、filesCreated=0；injectWhile还要求注入确实发生。来源定位：test:252–262、419–435，bridge:787–815、897。

按用例顺序及最后新引用推定对应的worker为 `hk-win-compile-6944120fe19e42fc8a44fd66bd31eb3c` / `hk-win-sink-5611937e4ae9497e81ac43da392b99b4`。其原始stdout共12条RPC：id10验证时files=0、validationCalls=9；id11实际写入2文件、917bytes、2次flush、回读917bytes，十三项checks全true；id12关闭后files仍2、validationCalls=14、closed/retained=true、unverified=false。raw8320bytes完整，stderr0，退出0。

静态上，轮询可能在write已发送/开始后才观察到calls6并取消；产品代码需await写入返回后复查sessionCode，此时可能得到“最终失败、已产生2文件”，与该组固定零文件期望冲突。也可能执行已先结束，使injected断言失败。这是足以解释失败的**静态时序竞争候选**。原工具只保存ASSERTION_FAILED，没有注入时点、execute返回DTO或断言栈，因此本轮不能确定具体哪条断言失败，不能断言“仅测试问题”、排除产品问题或声称取消门禁已满足。

本轮不通过读取残留文件、增加诊断执行、修改断言或重跑来补证；保留真实FAIL交后续独立定位/最小修复。原生底层PASS/正常关闭不改变外层FAIL。

## 源码原始字节前后及固定commit绑定

16来源文件在执行前逐一读取固定25d Git blob原始字节重算SHA，与工作树比对；执行后同16文件bytes/hash完全一致。下面是执行前＝后值；这些来源快照并不证明整个解释器/编译器、同用户并发或关闭后对象不可被外部修改。

| 仓库相对路径 | bytes | 前＝后SHA-256 |
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
| `tools/hikvision-windows-evidence-sink/src/native-broker.mjs` | 19341 | `bebab0c33873f07200d3057451230ae90316aac70dd6f937ae9995822409080b` |
| `tools/hikvision-windows-evidence-sink/src/entry.mjs` | 264 | `c26360a02d0728c4a85ce89cd2380da6ad79b70feb93d7b4ff8383c9463c519e` |
| `tools/hikvision-windows-evidence-sink/test/windows-entry.test.mjs` | 29707 | `51b21fe0ff93d3d954e59bb43f9763f16eae8f7c2751ad9989a6f3c429ac2505` |
| `tools/hikvision-windows-evidence-sink/Test-NativeEvidence.Tests.ps1` | 16041 | `fba97168138a749d723963532c47c4c6825fc267e521efca57ea1be53627ccc0` |
| `tools/hikvision-windows-evidence-sink/test/broker-terminal.test.mjs` | 28577 | `195a01042ea30d09be98f871800f7355533fec4f456b1729666092832897fc07` |

## 新引用、十三checks、六counts及关闭保全

本轮新集合引用为 `hk-win-supplement-67bb7b1e03324c25a1e611d72211273b`。实际11组evidenceRef/compilerRef；11个新launch journal与stdout两组引用逐项对应，无多出/漏项。journal在启动前持久化，只证明引用已分配，不单独证明目录创建。没有以旧引用认领/复用任何目录。

| evidenceRef | compilerRef | 最终root/file/write/verified/flush/validate计数 | close/retained/unverified |
| --- | --- | --- | --- |
| hk-win-sink-d01815cccd2e435780ad9a27e45dfdf2 | hk-win-compile-4991ffbd40724ce5bae33fa33c793af3 | 1/2/917/917/2/14 | True/True/False |
| hk-win-sink-247c3df892f64bcfb5a1489b648f9a41 | hk-win-compile-f76b47851b3a44e583ac94d953ca22aa | 1/2/917/917/2/14 | True/True/False |
| hk-win-sink-7a021b94c24245c390dfa7ec170392ca | hk-win-compile-0b65c5f670e6425abb4ea67ff835dd45 | 1/2/1032/1032/2/9 | True/True/False |
| hk-win-sink-af544fc80b474bf4bd4a60b4beffd8fe | hk-win-compile-a63c7f6654fc4eb784e4a02f26c2c2ec | 1/2/1009/1009/2/9 | True/True/False |
| hk-win-sink-54304c0456e14b018ad50fb7b964da76 | hk-win-compile-eafc9c9aa13d4491a50b87febabc4e8c | 1/2/1027/1027/2/9 | True/True/False |
| hk-win-sink-2aeabf343f95482cbae7d1f0605d51e2 | hk-win-compile-f04c040e7bc3425ea08db81f591a1de5 | 1/0/0/0/0/3 | True/True/False |
| hk-win-sink-01a58be0669e445c8acb1eeff7f23eb9 | hk-win-compile-14ba1a1a0e0748a6b84eaaa377689059 | 1/0/0/0/0/3 | True/True/False |
| hk-win-sink-e0ba1db7a22b4cb79ca8d6a9668724c9 | hk-win-compile-2905a5335b5744289d6584ece5647f39 | 1/0/0/0/0/3 | True/True/False |
| hk-win-sink-a4f790ff3bfc4f1b9912e9e49d4087c6 | hk-win-compile-cc8df0eefdaa4470a1593baddd2bc4f4 | 1/0/0/0/0/3 | True/True/False |
| hk-win-sink-75d1ce40ba5144f58133835d7eac874b | hk-win-compile-f2ce6d27db154b01a1c639bc6b28b91b | 1/0/0/0/0/10 | True/True/False |
| hk-win-sink-5611937e4ae9497e81ac43da392b99b4 | hk-win-compile-6944120fe19e42fc8a44fd66bd31eb3c | 1/2/917/917/2/14 | True/True/False |

11个新worker原始管道共84条连续编号、完整UTF-8 JSON，exit均0、signal=null、stderr0、无截断、streamsComplete=true，最后均原生PASS/OK、closed/retained=true、unverified=false。原生最终计数合计11目录、12文件目录项、写入/回读各5819bytes、flush12、validation91；只是worker保存的实际完成计数，不是事后扫描磁盘。

十三项checks固定为platformSupported、identitySupported、locationSupported、ancestorHandlesHeld、rootCreatedExclusive、rootAclValid、nativeIdentityValid、rootEntriesValid、filesCreatedExclusive、fileAclsValid、contentVerified、flushVerified、deleteSharingDenied。6组实际写入的最终十三check均true；5组只建根的文件/内容/flush相关check保持false，不能为凑通过改成true。六counts固定为directoriesCreated、filesCreated、bytesWritten、bytesVerified、flushes、validationCalls；完整逐RPC向量保留在各raw及总清单。

11个独立编译的sourceSHA256均为 `3ef059f821f042c5d50bc6facc691aab1b2e86be9291807324f841c36da1b32f`，retained DLL与各自assemblySHA256一致；CodeDOM .cs可带编译器BOM，单独哈希，不改来源字节凑匹配。.dll/.cs/.out/.err/.cmdline/.tmp（实际存在者）、compile.metadata、host.raw/exit及脱敏副本全部保留在本轮known compiler目录；它们不是受保护native证据根，不能据其权限声明真实设备原始资料安全。

cleanup=NOT_EXECUTED。closed只确认自有句柄/worker结束；retained是无删除实现及日志支持的声明，没有事后扫描证明所有磁盘对象继续存在或未被外部修改。所有新旧对象继续保留，不清理、不修ACL、不处理未知项。

## stdout/stderr、脱敏副本及工件哈希定位

下表定位相对独立文档工作树根，位于仓库外。原件及副本均CreateNew保留，不提交raw日志、DLL或个人路径。stage stdout/stderr的脱敏副本与原件本次同bytes/hash；runtime-executables副本另独立记录。所有本轮known compiler原始stdout/stderr也先保留原件，再新增脱敏副本；总清单记录每件bytes/hash，未改原raw。

| 工件定位 | bytes | SHA-256 |
| --- | --- | --- |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/capture-supplement.ps1` | 12811 | `62033e849fe7c7862054637cee763a385b2f18760d12fd9d0a71c32b2d60b17f` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/runtime-preflight.stdout.raw` | 92 | `80e384504926f2e5f8476cfc23090359b4612c7b12ced725e2527dd16b44924a` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/runtime-preflight.stdout.redacted.txt` | 92 | `80e384504926f2e5f8476cfc23090359b4612c7b12ced725e2527dd16b44924a` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/runtime-preflight.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/runtime-preflight.stderr.redacted.txt` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/runtime-preflight.exitcode.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/runtime-preflight.execution.metadata.json` | 456 | `189cfec6fc983b87cf0e1631191b43fd71b1a23f56e7c59976927c8582b4f9cd` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/windows-entry.stdout.raw` | 4157 | `ac2d6648f28902dd6285669009314d3d53b472f11ba2be72b4477f245a6fb8ff` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/windows-entry.stdout.redacted.txt` | 4157 | `ac2d6648f28902dd6285669009314d3d53b472f11ba2be72b4477f245a6fb8ff` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/windows-entry.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/windows-entry.stderr.redacted.txt` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/windows-entry.exitcode.txt` | 2 | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/windows-entry.execution.metadata.json` | 437 | `239149f2b9e3354e2f236d018aeddcd02d10549cc24405bc252efed00dcdfd6b` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/run.execution.metadata.json` | 1863 | `a5ef92d5461620e7480e449f1dedf04412572d2890f9598f78cb48ec67f13637` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/sources.before.json` | 2984 | `7c570788dc6c515818f45351f5f5a3b38094d01b2a267fbacee6ada2bcedd04b` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/sources.after.json` | 2984 | `7c570788dc6c515818f45351f5f5a3b38094d01b2a267fbacee6ada2bcedd04b` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/fixed-commit-sources.json` | 3480 | `fe97211c3e53c27de661adb6f9f3320036d17a851dc0bd07a9e3d23079e220f4` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/new-reference-journals.json` | 5426 | `95b48252e47e5d216f2cf5f88a8b43f1a7e551c77cc2eff8fa90d994b487a29f` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/runtime-executables.local.json` | 395 | `61097c7f576fd84365635a1f4ca2fa3e7dea7f894677e24da13d88c2dd94ef41` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/runtime-executables.redacted.json` | 395 | `61097c7f576fd84365635a1f4ca2fa3e7dea7f894677e24da13d88c2dd94ef41` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/artifacts.manifest.json` | 3321 | `2abfb140d6aa17211e2b8fab0d1baadd33505c81274f665cf1f4f3ebbd4e4798` |
| `../HK-AI-08-broker-windows-supplement-2026-11-23-run01/new-artifacts.inventory.json` | 87676 | `def4cc9b17735a056502cf806c00813086cb76fc8bec664faa3efb454cf8b6ce` |

原artifacts.manifest在单轮结束冻结，总清单追加覆盖本任务新脱敏副本/编译日志等；不覆盖旧manifest。清单不包含自身或之后新增的本报告/报告生成器/交付回执，不是未来目录内容穷举或自哈希。总清单只读本轮11个known compiler/log文件；未访问任何LocalAppData native evidence根。原始日志里没有保存外层CONTROL-006执行DTO/断言栈这一限制不回填。

## 继承与未执行边界

[原Windows集成报告](WINDOWS-INTEGRATION-2026-11-23.md) 的run01/run02失败、run03的140＋264＋16＋43事实以及57旧根引用原样保留。[P1修复与14/442内存报告](BROKER-TERMINAL-FIX-2026-11-23.md) 的基线9失败/修复后通过、采集异常和时间限制也不修改。两份报告分别保持SHA `20b4be93716d2ca8a5ebef4f0b898fd647fe74c3c90c14712b14e4ad8eda08ea`、`7233a875f10531b4c6a8a9caedb607a182b4df89516151e1a46b350a1772371a`。

更早hk-acl-f03a3e07eb4f4c13a5ee8d1326ec84a4、hk-acl-ede6254418504fb5be49561f3cdb0865、hk-node-acl-549bdd3a8849407aa3dd9253ff28c6dd、hk-node-acl-8023cbfe08e44160a493abacd7c88246、hk-cb-143b0d8768dc4ef4acd470f2daaf5d94、hk-entry-f67a184f60d3402f8a532606ec1863f2及其完整引用链均保留；未访问、扫描、清理或重新认领其残留根。没有把继承的旧PASS写成本轮25d完整Windows接入重新验收。

allowRead保持false：固定源码的合成输入/执行视图/品牌假传输仍要求false，已执行正控的相关断言通过；不推断未保存DTO中的逐例状态。六逻辑调用仅假传输、设备请求为0。真实配置/凭据、原CLI/runProbe、设备/照片/人员/下发/生产云、E1/E2、合并/部署/上线本轮均未执行。没有安装依赖、提权、执行策略Bypass/Unblock、防护关闭或全局Git/TLS/代理/安全修改；用户取消隔离网络前置的决定保持不变。

## 生产环境调试时点

当前没有可承诺的日期，也未获准进入生产调试。本轮FAIL尚需独立定位和后续最小修复/复验。即使本补测以后通过，也只补broker实际Windows管道证据；生产只读调试还须完成并独审真实受控配置来源/同份快照与文件身份绑定、可信审批/凭据租约撤销/真实时钟、原始响应/认证适配、TLS pin-before-send、DNS/peer/单目标和真实deadline/停止机制、真实响应证据保管及脱敏，再明确现场设备/账号/证书/窗口与六GET白名单的E1授权和独立验收。设备能力/固件未知可在经授权E1采集，不能冒称已验证。

后续E2仍须E1复审、五项能力先证和独立范围授权，且仅限单合成人员、单合成照片、非生产对象及批准的写前不存在基线、精确归属和写/查/删契约，不下发门禁权限。真实生产人员/照片/权限写入、清理、部署或上线均不因E1/E2或本报告自动获准；不新增隔离网络要求。

本次交付只新增本FAIL报告，检查diff / git diff --check / git show --check后追加提交，普通显式 `HEAD:refs/heads/docs/hk-ai-08-broker-windows-supplement-2026-11-23` 推送并ls-remote核对完整SHA。不amend/rebase/reset/squash/force/merge/cherry-pick、不推main；推送失败则保留本地、不改配置/强推。真实交付SHA在提交后回执记录，不预填本文件自身哈希。

提交推送核对后停止，交独立复审。**结论仍为FAIL，不作完整CLI、Windows全套验收或E1/生产放行。**
