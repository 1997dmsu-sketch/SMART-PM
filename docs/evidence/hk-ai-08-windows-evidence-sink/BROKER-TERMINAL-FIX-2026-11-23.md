# Broker 终止错误 P1 最小修复与纯内存回归记录

本文件记录修复和实际验证事实，交独立复审；不替代最终独立验收。固定起点为 `cf8f7b4b14d0f370e4f34feb64e60696e3c23bad`，新独立分支 `fix/hk-ai-08-windows-terminal-error`，独立工作树 `D:\chatgpt\smart\SMART-PM-windows-terminal-fix`。没有在原工作树切换分支或清理文件；固定提交已在本地，未取远端最新 tip 替代它。推送前只读核对该新远端分支不存在。

## 问题与修复

原 P1：同一个 stdout 数据块先含当前 write 请求的合法 PASS 行、再含非法/额外行时，旧 broker 已在循环中兑现 Promise；后续 abortPending 虽记录 terminalError/FAIL，桥仍收到旧 PASS DTO。这个错误在执行结果交付前已经被检测，不能归入尚未检测的未来异常或文档承认的同用户并发残余。

产品改动只在 `src/native-broker.mjs`，35 行新增、9 行删除，不改 bridge、native-host、C#、ACL、原用例或公共 API。新增单个纯内存回归文件和本报告；无原生重跑、无新 native 证据目录/编译目录。

1. 完整回复暂存为 completed，直到本数据块所有字节通过协议检查才兑现 Promise。仅有一个 pending 请求，因此同块额外完整行、未换行尾片或未完成 UTF-8 尾都拒绝；合法跨块回复保持流式拼接。首个已合法解析的回复数量先保留，后续错误置 unverified，不抹除已知数量。
2. `outcome/currentResult` 以已有 terminalError 为权威，持续返回 FAIL 和首个终止 code；不确定标记与已有状态作 OR，不用旧 PASS 覆盖当前状态。RPC 入口、Promise 交付、队列执行前/后、init、observe 和关闭结果都服从它。
3. 终止后 stdout 继续保留原始字节，但不再 normalize；后续/已排队的 validate、write 不再发送 stdin RPC。close 仍执行 confirmExit 和日志保全，不能通过短路跳过静止确认，也不会在终止后发送新的 close RPC。
4. init 出现终止错误时不返回 capability；普通主结果恢复分支不能覆盖 terminalError。普通关闭、后续回复和日志错误不能把已有首终止错误恢复为 PASS。

保证限于交付前已检测到的终止错误。已经交付之后才发生/才被检测到的未来错误，不能追溯修改过去不可变 DTO；后续观察和关闭结果仍保持失败。没有声称消除全部进程、运行时或关闭后的 TOCTOU。

## 纯内存隔离及实际命令

本机 Win32NT、Node `v24.16.0`；外层日志采集为已安装 PowerShell `7.6.9` Core。没有启动 powershell.exe/PS5.1 worker、C# 编译器或任何原生用例，未安装/升级运行时或依赖。

新测试使用 Node 内建 `vm.SourceTextModule` 和 `SyntheticModule`。只读取五个白名单生产源码（broker、bridge、checker、bytes、Windows entry shim），严格 UTF-8 roundtrip 并计算原始字节 SHA，不替换/转译生产源码。VM linker 仅允许这五源码及八个明确的内建假模块/纯函数接口，拒绝未知和动态 import。process 仅提供合成 platform，spawn、filesystem、timer 和 child pipe 全在独立 case 的内存中；没有给生产入口加注入参数、路径、回调或执行器。

真实 Node 驱动读取上述源码并向真实 stdout/stderr 输出结果；外层采集器另按授权创建本轮日志。因此 JSON 的 actualWorkerSpawns/actualNativeObjects/actualFilesystemWrites=0 专指被测模块副作用，**不**把整个任务的新日志/Git 文件写入说成零。零 native 副作用由白名单静态审阅与内存替身边界支持，不冒称操作系统级活动审计。node:net 只导出 isIP，未向 VM 暴露联网能力。

两阶段实际测试命令相同：

```text
node.exe --experimental-vm-modules .\tools\hikvision-windows-evidence-sink\test\broker-terminal.test.mjs
```

`--experimental-vm-modules` 仅启用已安装 Node 的内建 VM 模块接口。真实 stderr 的 ExperimentalWarning 原样保留，没有隐藏或改写为空；没有使用执行策略 Bypass、Unblock-File 或关闭防护。每例最多2048次微任务等待，fake timer 不触发真实计时器；finally 只结束内存假 child 并核对其日志，不删除任何磁盘对象。

## 两阶段真实结果

同一份测试原始字节：28577 bytes，SHA-256 `195a01042ea30d09be98f871800f7355533fec4f456b1729666092832897fc07`。基线先在原 broker 字节上运行；其后只改 broker，再运行同一套测试，未放宽任何断言或预期。每阶段16行 JSON＝manifest＋14个case＋summary；每条 checks 有 expected/actual，真实失败决定退出码，不跳过失败。

| 阶段 | 测试状态 | case 实际结果 | 断言实际结果 | Node 独立退出码 |
| --- | --- | --- | --- | --- |
| baseline | FAIL | 5/14，失败 9 | 372/442，失败 70 | 1 |
| fixed | PASS | 14/14，失败 0 | 442/442，失败 0 | 0 |

基线 FAIL 没有改记为 PASS；它是旧漏洞被同一回归识别的真实红结果。最终 fixed 的14例/442断言全部符合预期，退出0；负控中的 write/init/execute 仍实际 FAIL，case PASS 仅表示正确拒绝。两阶段没有真实原生对象或 worker；内存 audit 的 fakeSpawnCalls=1 是每例的假函数调用，不是实际 powershell.exe。

| case ID | baseline | fixed | 基线失败断言数 | fixed 失败断言数 |
| --- | --- | --- | --- | --- |
| BR-P01-single-replies | PASS | PASS | 0 | 0 |
| BR-P02-fragmented-valid-reply | PASS | PASS | 0 | 0 |
| BR-F01-pass-plus-malformed-line | FAIL | PASS | 3 | 0 |
| BR-F02-pass-plus-extra-json | FAIL | PASS | 3 | 0 |
| BR-F03-pass-plus-unfinished-tail | FAIL | PASS | 6 | 0 |
| BR-F05-pass-plus-unfinished-utf8 | FAIL | PASS | 6 | 0 |
| BR-F04-unfinished-reply-at-eof | PASS | PASS | 0 | 0 |
| BR-F06-pass-then-stderr | FAIL | PASS | 3 | 0 |
| BR-F07-pipe-limit-cannot-wash-pass | PASS | PASS | 0 | 0 |
| BR-F08-queued-late-and-subsequent-operations-sticky | FAIL | PASS | 31 | 0 |
| BR-F09-init-pass-plus-invalid | FAIL | PASS | 4 | 0 |
| BR-F10-init-pass-then-stderr | FAIL | PASS | 4 | 0 |
| BR-B01-real-bridge-six-call-positive | PASS | PASS | 0 | 0 |
| BR-B02-real-bridge-six-call-terminal-fail | FAIL | PASS | 10 | 0 |

F01/F02 覆盖同块 PASS 后非法行/额外 JSON；F03/F05 为尾片/UTF-8 尾；F04 为无换行 EOF；F06 为同次调用 PASS 后同步 stderr；F07 为 pipe limit；F08 核对已排队、late PASS、后续 validate/write、close/observe 的首错粘滞及无新 RPC；F09/F10 覆盖 init 不得泄漏 capability。P01/P02 保留单行与跨块合法正控。B01/B02 加载真实 bridge/entry，用同份合成配置、单次 token 和品牌假六调用，核对调用轨迹、执行/关闭结果及 allowReadStayedFalse。

核心 F01：baseline 的 write.status/code 实际为 PASS/OK，预期 FAIL/NATIVE_PROTOCOL_INVALID；fixed 实际为 FAIL/NATIVE_PROTOCOL_INVALID。B02 的真实 bridge 链同样从旧 executeWindows PASS/OK 改为 FAIL/NATIVE_PROTOCOL_INVALID；六假调用及九次 validate 后的 write 轨迹保持一致。两个 bridge case 的 summary 与写入摘要 allowReadStayedFalse 四项断言均为 true；输入也固定 allowRead=false，产品 bridge 未改。

### 采集异常与时间限制

baseline 子进程执行后，采集器已按 BaseStream 保存真实 stdout/stderr、直接 Process.ExitCode=1、退出码原件及16文件前后哈希、脱敏副本。随后保存运行 metadata 时，`CreateNew` 与本轮先建的 preflight `baseline.metadata.json` 重名，拒绝写入；原件没有被覆盖。初版外层 shell 随后返回0，这个0是采集脚本错误后的外层退出值，**不是**Node 子进程退出码，不作为测试通过依据。

真实基线执行日期为2026-11-23，但精确进程起止时间尚未持久化即遇重名，现明确为 NOT_RECORDED；不把 preflight 时间或文件时间冒充进程时间。`baseline.recovery.metadata.json` 如实追加记录此限制及 child exit=1，`baseline.recovery.manifest.json` 保全已有原件。没有为补元数据重跑基线。初版采集器和同字节 first-version 快照保留；v2 唯一改动是把阶段运行 metadata 目标改为 `.execution.metadata.json`，避免与 preflight 重名，未改测试命令或结果。

fixed 由 v2 实际采集，起止：`2026-11-23T15:07:17.7664888+08:00`～`2026-11-23T15:07:17.9152317+08:00`；exit=0，timedOut=False，childQuiescent=True，launchErrorType=null。两阶段 stdout/stderr 脱敏解码均为严格 UTF-8；fixed 元数据完整。

## 源码前后哈希与固定来源

baseline 与 fixed 各保存一对16文件 sources.before/after，均逐项相同；两阶段之间仅 broker 变化，新测试本身完全同字节。原 broker 的本轮原字节快照 `baseline.native-broker.mjs` 为17962 bytes，SHA `8ed8c9568605cdc12c90202d9f1f134988446af1d5cb0bdf6b579195f6e2123d`，与固定提交相符。最终 broker 为19341 bytes，SHA `bebab0c33873f07200d3057451230ae90316aac70dd6f937ae9995822409080b`。

下表最终 fixed 的执行前＝执行后＝交付工作树字节；除了 broker，其余原15文件中的14份与 cf8f7b4 原样相同。新增测试单列在第16项。没有重编码、改换行去凑匹配。

| 仓库相对路径 | bytes | fixed 前＝后 SHA-256 |
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

## 原始日志及脱敏副本定位

下列定位相对独立修复工作树根，指向仓库外本轮新建日志目录。raw、退出码、源码快照及所有既有报告/对象不删除、不覆盖；只提交产品补丁、新测试和本报告。退出码在子进程结束后直接保存，后续命令不代替它。

stdout/stderr 的 `.redacted.txt` 与对应 raw 均分别计算 bytes/hash；本轮替换个人 home/SID 后内容未变，因此 bytes/hash 相同。stderr173 bytes 是 Node VM ExperimentalWarning（含各次真实 Node PID），不是 stderr 为空。任何未来含个人信息原件仍只保留本地，不提交或聊天粘贴。

| 工件定位 | bytes | SHA-256 |
| --- | --- | --- |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/baseline.metadata.json` | 484 | `efe426ff6c835f9d5621d1ecea0c1493845437fa29454992d198a8987762efb1` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/baseline.recovery.metadata.json` | 1090 | `5b6ee0b42a1a081650bdb31ec5ae4a8d7d2a51dded76207d17dcc7b1a00bef93` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/baseline.recovery.manifest.json` | 1881 | `32fb975a3de9ce27b1e709adbb662b51d21a5d9b90f57de2b523c063a6369374` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/baseline.stdout.raw` | 53451 | `6a7f1a5624f59cfb0a9976c0eb47211d948a1a9f387b27153eb72ba423304014` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/baseline.stdout.redacted.txt` | 53451 | `6a7f1a5624f59cfb0a9976c0eb47211d948a1a9f387b27153eb72ba423304014` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/baseline.stderr.raw` | 173 | `f59fc4f739f9c87baefdd0f046ff1869cb1554e3b6681e1a81595d06d4a10fc5` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/baseline.stderr.redacted.txt` | 173 | `f59fc4f739f9c87baefdd0f046ff1869cb1554e3b6681e1a81595d06d4a10fc5` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/baseline.exitcode.txt` | 2 | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/baseline.sources.before.json` | 2984 | `9c0998ebda905334460ed48172f955b12eef05388bc611c29fe1598134e0a8da` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/baseline.sources.after.json` | 2984 | `9c0998ebda905334460ed48172f955b12eef05388bc611c29fe1598134e0a8da` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/baseline.native-broker.mjs` | 17962 | `8ed8c9568605cdc12c90202d9f1f134988446af1d5cb0bdf6b579195f6e2123d` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/capture-memory-regression.ps1` | 5507 | `5f82e30d09166b283ec20e02f348dbcf36a1ed84e26cde3d3ecf970b7119d96b` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/capture-memory-regression.first-version.ps1` | 5507 | `5f82e30d09166b283ec20e02f348dbcf36a1ed84e26cde3d3ecf970b7119d96b` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/capture-memory-regression.v2.ps1` | 5517 | `10b1265952d037ddcf54d7253a67adc9bf452ff4de3247dea97e7aaf87bc3ae5` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/fixed.execution.metadata.json` | 753 | `395c13b3163b041c8f4dfeb55730d66bc467cd10e19a717b09dbf87babdf4d85` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/fixed.stdout.raw` | 53123 | `45c4af52544ba03a2580f58d596de03c761f882c8dbb01e7bf5bee24814fdcbe` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/fixed.stdout.redacted.txt` | 53123 | `45c4af52544ba03a2580f58d596de03c761f882c8dbb01e7bf5bee24814fdcbe` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/fixed.stderr.raw` | 173 | `e2c870753456a35c687be12b6444a46fa09912d94038e396d58312d14d50f92c` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/fixed.stderr.redacted.txt` | 173 | `e2c870753456a35c687be12b6444a46fa09912d94038e396d58312d14d50f92c` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/fixed.exitcode.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/fixed.sources.before.json` | 2984 | `7c570788dc6c515818f45351f5f5a3b38094d01b2a267fbacee6ada2bcedd04b` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/fixed.sources.after.json` | 2984 | `7c570788dc6c515818f45351f5f5a3b38094d01b2a267fbacee6ada2bcedd04b` |
| `../HK-AI-08-windows-terminal-fix-2026-11-23-run01/fixed.artifacts.manifest.json` | 3418 | `9e0657a3c8f6929df79f063b17c62127555facbffb999ee87655b79b03f30de5` |

两个已冻结 manifest 记录其生成时已有工件，不包含自身或随后新增的本报告/报告生成器/交付回执；不是对整个目录任何未来文件的穷举或自哈希。旧 manifest 不补写、不覆盖。两次源码快照和原件均可按表直接复核。

## 历史保全、未执行项与交付边界

历史报告 [WINDOWS-INTEGRATION-2026-11-23.md](WINDOWS-INTEGRATION-2026-11-23.md) 保持33000 bytes、SHA-256 `20b4be93716d2ca8a5ebef4f0b898fd647fe74c3c90c14712b14e4ad8eda08ea`。其中原 run01/run02 的失败、run03 的140＋264＋16＋43通过事实、57个 evidenceRef、34个已分配 compilerRef、33个实际 compiler/31组 worker 日志，以及更早引用链都原样保留。本轮不重写该报告，也不把它扩为已通过异常协议门禁的验收结论。

更早的 hk-acl-f03a3e07eb4f4c13a5ee8d1326ec84a4、hk-acl-ede6254418504fb5be49561f3cdb0865、hk-node-acl-549bdd3a8849407aa3dd9253ff28c6dd、hk-node-acl-8023cbfe08e44160a493abacd7c88246、hk-cb-143b0d8768dc4ef4acd470f2daaf5d94、hk-entry-f67a184f60d3402f8a532606ec1863f2 及上份报告所列57根引用继续保留；本轮没有以这些引用为输入访问其原生残留根。内存假引用没有创建实际 evidenceRef 对象，不作为新的原生取证引用交付。

- 原140＋264回归、16分层原生、43Windows接入、原51 ACL策略及旧主预检：本轮均 NOT_EXECUTED。只执行两次新的纯内存 suite，不以旧结果替代本补丁的 Windows 原生重跑证据，也不自行安排重跑。
- 清理/删除/残留处理：NOT_EXECUTED；native/ACL/身份代码及其门禁字节不变。不放宽 ACL、不处理未知项，只保全本轮日志。没有原生对象存续的事后扫描证明。
- 真实配置/凭据、设备请求、原 CLI/runProbe、E1/E2：NOT_EXECUTED。没有安装、管理员提权、环境枚举、Git/TLS/代理/安全全局配置修改、WSL、照片/人员/下发/生产云/部署/上线。
- 本修复没有改变同份私有快照、allowRead=false、单次许可、品牌假传输、原生清理边界及先前文档的未验证项；不宣称完整 CLI 接入、完整原生复验或 E1 放行。
- 完成后检查 diff 仅三预期文件、git diff --check / git show --check，追加普通提交，显式 `HEAD:refs/heads/fix/hk-ai-08-windows-terminal-error` 推送并用 ls-remote 核对完整 SHA。不 amend/rebase/reset/squash/force/merge/cherry-pick，不推 main；推送若失败保留本地，不改配置或强推。

真实提交/远端 SHA 在提交后独立交付回执记录，不预填本文件自身提交哈希。推送核对后停手，交独立复审；本文件只报告限定 P1 修复与14项纯内存验证，不作最终独立验收或 E1 放行。
