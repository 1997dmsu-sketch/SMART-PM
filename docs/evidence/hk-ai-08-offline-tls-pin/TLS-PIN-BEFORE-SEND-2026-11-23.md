# TLS pin-before-send 合成离线实现与取证（2026-11-23）

本轮实际结果：原绑定桥 **140/140**、原入口 **264/264**、broker 纯内存 **21/21（784 checks）**、新增 TLS 套 **34/34（5982 次实际断言）**，四个子进程退出码均 0。错误 pin、缺失／空证书和认证 attempt=2 负控在私有假接收端为零 HTTP 字节。此结论仅为独立合成发送门禁；真实 TLS、服务端接收时序、完整 NT-05、旧入口接线、完整 CLI 和 E1/E2 均未因此完成。执行方完成取证后停手，交独立复审。

## 1. 固定起点、分支与保全

- 仓库：`https://github.com/1997dmsu-sketch/SMART-PM.git`。
- 工作树起点与直接提交父提交：`35da2f3202f1bf61567eed8a68dab2fd67b1d256`，原交付分支 `test/hk-ai-08-control-boundary-diagnostics`；开始时干净。
- 本次新工作树名：`SMART-PM-tls-pin-before-send-offline`；独立实现分支：`feat/hk-ai-08-tls-pin-before-send-offline`。没有换用远端新 tip、切换或清理他人工作树。
- 只新增本工具模块、独立测试、README 与本报告四个文件。原 bridge/entry/checker/native broker/原网络模块/既有测试和报告不修改；不提交下载的保密协议 PDF、原日志或设备材料。
- 原 Windows 补测 `f0f23dbb479b2a94c81a3cbb5519ce9f100e5042` 的 43 planned / 37 executed / 36 passed / 1 failed（CONTROL-006）/ 6 NOT_EXECUTED 保持。没有重跑该原生补测，不用本轮内存 PASS 改记旧 FAIL。21/784 控制边界仍不等于旧失因已确诊或修复。
- 新旧对象、日志、报告、已存在的 evidenceRef 与残留均保留。本模块没有文件或清理入口；本轮不访问或认领旧残留，不生成设备 evidenceRef。
- 本报告于追加提交前冻结；交付 commit/远端完整 SHA 与提交后检查由仓库外 `delivery.receipt.json` 关联，不为写入自身 SHA 而改写提交。

## 2. 原始语义来源与实现

固定旧来源（本地 Git blob 原始字节读取，未转码、改换行、复制或执行原网络模块）：

| 项目 | 实际值 |
|---|---|
| commit | `558b9c864a4b820e397336200758b143556a4d87` |
| path | `tools/hikvision-probe/src/http.mjs` |
| Git blob | `e96481d2954df4efe6ac43dbe8fd915a3e9c5587` |
| bytes | 7858 |
| SHA-256 | `e64b04bd10370682f9b4b1ff577b8c481801d1c9976335ce276cdcaa4f6c2573` |

静态复用 raw SHA-256、固定长度摘要 `timingSafeEqual` 与 pin-only 过期只告警的语义。旧原文件创建 https.request 后立即 end、secureConnect 再验 pin 的时序缺口没有被改写为已验证，也没有执行旧 CLI。新模块以另一条仅假对象可达的代码路径实现：

1. 输入闭式 schema/dataClass/mode，allowRead 必须原值 false，1–2 枚不同的规范大写 64 位 pin。拒绝缺省／CA 回退、Proxy、getter、隐藏／符号／未知键和非普通 dense 数组；安全复制冻结。
2. 请求与假 peer 都是私有 WeakMap 域中的空 null 原型冻结句柄。在首 await 前同步单次消费两者，拒绝伪造、跨域、重放与并发复用；这些只是合成能力句柄，不是真实审批令牌。
3. 等待假握手 release；读取该 peer 私有 raw；真实计算 SHA-256 并对最多两槽作 timingSafeEqual；无 raw／空 raw、错 pin 或 TLS 脚本错误即终止并关闭。release 的 PASS 仅说明门闩释放成功，不表示 TLS 脚本通过。
4. pin 通过后再经历一个微任务，复查永久终止／取消状态，之后才序列化固定 GET 与投递 HTTP。取消在 pin 后、投递前发生时仍零字节。
5. 唯一私有假接收函数对实际收到的 Buffer.length 计数，并从收到的字节识别合成 Authorization；不是按 PASS 状态或 attempt 硬填计数。客户端与接收端共享单调序号：HANDSHAKE → CERTIFICATE_READ → PIN_VERIFIED → HTTP_WRITE → HTTP_RECEIVED → CLOSE。
6. 固定 Host 只有 `example.invalid`；六 GET 的原路径／查询串保持，attempt=2 仅增加固定 `SYNTHETIC_DIGEST_AUTH` 标记。没有外部 host/path/headers/credentials、任意回调或真实传输入口；每条 attempt 都要新 peer 重新验 pin。只检验单条合成发送，不实现整个会话的六端点顺序、G1 停止、12 次预算或 401/Digest 解析，也未串接到原受控入口。
7. 匹配的合成 expired=true 只告警、不阻断；错误 pin 仍拒绝。raw 仅测试字节（含公开 SHA 向量），不是已解析 DER/X.509；expired 也是假标记。没有声称链、hostname、有效期或撤销验证完成。
8. 运行时只 import node:crypto / node:util。闭式结果与观察只含固定码、计数、pin 槽号、过期标记和 trace；不输出输入材料、raw、pin/其摘要、HTTP payload、真实凭据或任意异常原文。

## 3. 运行环境与实际命令

本机平台为 `Win32NT`，`Microsoft Windows NT 10.0.22631.0`。命令宿主 PowerShell 7.6.9；外层原始字节采集由已安装 Windows PowerShell 5.1.22621.6133 Desktop 执行；测试 Node v24.16.0。没有安装／升级运行时或依赖、WSL／容器、Pester、管理员 UAC 提权或执行策略绕过。

在本独立工作树根实际执行：

```powershell
node tools/hikvision-offline-config-binding/test/bridge.test.mjs
node tools/hikvision-offline-entry/test/entry.test.mjs
node --experimental-vm-modules tools/hikvision-windows-evidence-sink/test/broker-terminal.test.mjs
node --experimental-vm-modules tools/hikvision-offline-tls-pin/test/pin-before-send.test.mjs
```

采集器以重定向 BaseStream 并发保存 stdout/stderr 原始字节；进程退出后先保存其 ExitCode，再进行其他操作。意图先写、输出与错误分别 CreateNew、退出码单独保存。每套有 120 秒采集端上限，本轮四进程均未超时且确认退出。外层采集命令：

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File ..\HK-AI-08-tls-pin-before-send-2026-11-23-run01\Collect-TlsEvidence.ps1 -Phase regressions
powershell.exe -NoLogo -NoProfile -NonInteractive -File ..\HK-AI-08-tls-pin-before-send-2026-11-23-run01\Collect-TlsEvidence.ps1 -Phase tls
```

下表为日志原始 UTC；对应客户端 Asia/Shanghai 为同日 +08:00，不回填虚假时间：

| 日志 stem | startedUtc | endedUtc | exit | stdout bytes | stderr bytes |
|---|---|---|---:|---:|---:|
| `regressions.binding` | 2026-11-23T10:22:59.6696731+00:00 | 2026-11-23T10:22:59.8629913+00:00 | 0 | 452 | 0 |
| `regressions.broker-memory` | 2026-11-23T10:23:00.3805479+00:00 | 2026-11-23T10:23:00.6170257+00:00 | 0 | 131681 | 173 |
| `regressions.entry` | 2026-11-23T10:22:59.8884292+00:00 | 2026-11-23T10:23:00.3605084+00:00 | 0 | 448 | 0 |
| `tls.tls-pin` | 2026-11-23T10:27:32.4105990+00:00 | 2026-11-23T10:27:32.5180458+00:00 | 0 | 5104 | 173 |

两套 VM 测试 stderr 各 173 字节，均为实际 ExperimentalWarning，完整保留。采集器控制台另输出 VoidTaskResult（异步复制任务完成值），不属于子进程 stdout/stderr；未把它混入工具原始日志。未发生本轮测试失败、未重跑以替换失败结果；静态审查阶段修正了 TP-22/TP-32 对非法 observation:null 的键集合预期，发生在首次执行之前。

## 4. 原始结果与新增用例

绑定桥原始 JSON：

```json
{"scope":"synthetic-config-binding-cb01-cb06-tests","status":"PASS","counts":{"groups":6,"total":140,"passed":140,"failed":0},"failedCaseIds":[],"groupCounts":[{"id":"CB-01","total":46,"passed":46,"failed":0},{"id":"CB-02","total":6,"passed":6,"failed":0},{"id":"CB-03","total":5,"passed":5,"failed":0},{"id":"CB-04","total":50,"passed":50,"failed":0},{"id":"CB-05","total":23,"passed":23,"failed":0},{"id":"CB-06","total":10,"passed":10,"failed":0}]}
```

入口原始 JSON：

```json
{"scope":"synthetic-offline-entry-tests","status":"PASS","counts":{"groups":6,"total":264,"passed":264,"failed":0},"failedCaseIds":[],"groupCounts":[{"id":"LOADER","total":66,"passed":66,"failed":0},{"id":"BINDING","total":48,"passed":48,"failed":0},{"id":"FLOW","total":37,"passed":37,"failed":0},{"id":"AUTH","total":23,"passed":23,"failed":0},{"id":"PERMIT","total":53,"passed":53,"failed":0},{"id":"OUTPUT","total":37,"passed":37,"failed":0}]}
```

broker 原始 summary JSON（manifest 与 21 case 原件在日志中）：

```json
{"scope":"synthetic-memory-broker-terminal-regression","kind":"summary","status":"PASS","expected":{"cases":21,"passed":21,"failed":0,"uniqueIds":21},"actual":{"cases":21,"passed":21,"failed":0,"uniqueIds":21},"failedIds":[],"actualNativeObjects":0,"actualWorkerSpawns":0,"actualFilesystemWrites":0}
```

新 TLS 原始 summary JSON（36 行 NDJSON = manifest + 34 case + summary）：

```json
{"type":"summary","status":"PASS","cases":34,"passed":34,"failed":0,"assertions":5982}
```

逐 case 断言真实合计 5982；TP-01～TP-34 唯一连续，全部 PASS，失败 ID 为空。stdout 保存逐例状态与断言数；零字节／trace 关系由未改源码断言与这些真实运行状态共同证明，未将其冒充线上服务端抓包。

| IDs | 实际覆盖 |
|---|---|
| TP-01～04 | 独立公开 SHA 向量；VM 导入／全局范围；握手前 HTTP=0；current/next/单 pin |
| TP-05～08 | 错 pin、null、空 raw、TLS 脚本失败；私有接收端 0 writes/bytes，关闭 |
| TP-09～11 | attempt=2 的错 pin／null／空 raw；Authorization 也未收到 |
| TP-12～13 | 合成 expired 匹配仅告警，过期加错 pin 仍拒绝 |
| TP-14～18 | 先取消、等待中取消、pin 后微任务取消、成功快照不回写、预先 release |
| TP-19～23 | 同步消费、并发、重连／认证不能沿用旧 PASS、伪造／跨工厂／跨 VM |
| TP-24 | 六 GET × 两 attempt；测试自有 wire 表逐字比较实际序列化 Buffer，独立期望长度与假接收计数一致 |
| TP-25～32 | allowRead=true/缺省/模式拒绝；pin grammar；输入修改隔离；覆盖字段、getter/Proxy/数组、伪造句柄零调用者陷阱 |
| TP-33～34 | 结果／观察闭式零材料泄露；递归冻结，先前快照不受后续状态影响 |

测试 VM 只链接 node:crypto/node:util，业务上下文不提供 process/require/fetch/计时器/网络 API；测试自身只有源码文件读取和有界超时计时。Buffer 薄包装仅在测试内私有捕获实际合成 wire，不输出 payload。该做法不是 OS 沙箱或 OS 级网络审计。没有监听／真实 socket／本地 TLS 服务端；完整真实 NT-05 和真实 TLS deadline 等仍 NOT_EXECUTED。

## 5. 来源前后原始字节哈希

旧回归前后 19 项一致；新套前后 22 项一致，包含同一 19 项及新模块／测试／README。旧三个 suite 在新增 TLS 套之前运行，既有来源全程不改；不将独立 TLS 套说成已经与原入口串联。

以下值来自实际 source-before/source-after，不通过编码或换行调整凑匹配：

| 相对源码路径 | bytes | 执行前 SHA-256（执行后相同） | 前后 |
|---|---:|---|---|
| `tools/hikvision-offline-config-binding/README.md` | 9204 | `e65de1e94f0c7ff6f90cb65cad12939317ed10bef8ac6bc41964355e1fba0262` | 一致 |
| `tools/hikvision-offline-config-binding/src/bridge.mjs` | 49226 | `435db8033899ae7891c4ce459d5056f256a00ed9f72df551c112aaa68d95bfe1` | 一致 |
| `tools/hikvision-offline-config-binding/test/bridge.test.mjs` | 37470 | `1506f319e0792b831bc264a1d8d315cbd3eafb78f560ad795ac957c1260da17a` | 一致 |
| `tools/hikvision-offline-config-checker/cli.mjs` | 6011 | `e6c59224a3b8cacf8e30198363eefd255dc2925fbcc116e3be652c4d3b35e185` | 一致 |
| `tools/hikvision-offline-config-checker/src/check-config.mjs` | 10463 | `a8dbde46942aca550e13fdddb27e93bd5c9d1902e8cbdfb09cb31befc0eecfb7` | 一致 |
| `tools/hikvision-offline-config-checker/test/check-config.test.mjs` | 40472 | `66175ee2db3159db1f349bd4bdbe02fe0a284ac7487fde93eb6da2f79d74d972` | 一致 |
| `tools/hikvision-offline-entry/README.md` | 9892 | `a9870853d3239387ac8bf72e2861d088918e2b3181dfb25b2db7cb0fefa51730` | 一致 |
| `tools/hikvision-offline-entry/src/bytes.mjs` | 4894 | `8eb41d8784f66f5d4416d5459ab80fd1cf72f75486afcec1d8e568259ef82e36` | 一致 |
| `tools/hikvision-offline-entry/src/entry.mjs` | 242 | `77b438bf8beaa1ab9c9bdf8885265a72d98d50c39e51feaf0091b7a659cfae76` | 一致 |
| `tools/hikvision-offline-entry/test/entry.test.mjs` | 52308 | `bd61740592bdf91efb5b6468c1452ab3e74dd4160084e7cce9c7b2444016746b` | 一致 |
| `tools/hikvision-windows-evidence-sink/NativeEvidence.psm1` | 4597 | `33ba23cfdc4d3c9ebffd975a038b30c115464f53ec98bf18beefd04eb6e09eea` | 一致 |
| `tools/hikvision-windows-evidence-sink/README.md` | 12723 | `0d5f303e6819839317a2caa4636eabf58fd254619414249cde84f56606439230` | 一致 |
| `tools/hikvision-windows-evidence-sink/Test-NativeEvidence.Tests.ps1` | 16041 | `fba97168138a749d723963532c47c4c6825fc267e521efca57ea1be53627ccc0` | 一致 |
| `tools/hikvision-windows-evidence-sink/native-host.ps1` | 7551 | `adcfa23c2ec618d740d8be2a3b2797070c05b9cbe05d1a4f1887d28e9f1636f3` | 一致 |
| `tools/hikvision-windows-evidence-sink/native/NativeEvidence.cs` | 40941 | `3ef059f821f042c5d50bc6facc691aab1b2e86be9291807324f841c36da1b32f` | 一致 |
| `tools/hikvision-windows-evidence-sink/src/entry.mjs` | 264 | `c26360a02d0728c4a85ce89cd2380da6ad79b70feb93d7b4ff8383c9463c519e` | 一致 |
| `tools/hikvision-windows-evidence-sink/src/native-broker.mjs` | 19341 | `bebab0c33873f07200d3057451230ae90316aac70dd6f937ae9995822409080b` | 一致 |
| `tools/hikvision-windows-evidence-sink/test/broker-terminal.test.mjs` | 40706 | `835e5dec53a51baf47dcc4a400f623c96668c480f54561ace894b34336db433f` | 一致 |
| `tools/hikvision-windows-evidence-sink/test/windows-entry.test.mjs` | 29707 | `51b21fe0ff93d3d954e59bb43f9763f16eae8f7c2751ad9989a6f3c429ac2505` | 一致 |
| `tools/hikvision-offline-tls-pin/src/pin-before-send.mjs` | 12638 | `eea8dc99abaebe26b00f55460b0d81f16a438be043b73d851db70350676415a6` | 一致 |
| `tools/hikvision-offline-tls-pin/test/pin-before-send.test.mjs` | 36622 | `0f79bdb8d0ff14d6ab3f4a7c76b89a76fcc75d838c99cf6f1dd2f2712c8e7e0f` | 一致 |
| `tools/hikvision-offline-tls-pin/README.md` | 8453 | `b40ae1c142079d2d34eeb55428279e8b881bc7b2c3593f8c01f8331c7e34a9c2` | 一致 |

## 6. 日志、脱敏副本与定位

证据不在云端 /workspace/artifacts。共享工作目录内新建的 `HK-AI-08-tls-pin-before-send-2026-11-23-run01/` 与本工作树同级；从仓库根的定位为 `../HK-AI-08-tls-pin-before-send-2026-11-23-run01/`。根目录创建时指定受保护的当前执行用户／SYSTEM 两条规则，读回确认，不改旧目录 ACL；这不是原 ACL 主预检或完整 TOCTOU 验收。

stdout/stderr 原件与 redacted.txt 分开保留；脱敏只替换已知工作树根及个人 profile 前缀，不更改状态／计数。新套 raw/redacted 同字节；broker 源文件审计中的绝对任务工作树路径在脱敏副本改为占位符。报告只列相对工件、大小与 SHA，原件不提交 Git。

`evidence-index.json` 是冻结时的 39 项文件索引；自身不自含，交付阶段新增回执／报告本地副本另行关联，不覆盖此索引。采集器 SHA 与所有文件如下：

| 相对工件名 | bytes | SHA-256 |
|---|---:|---|
| `Collect-TlsEvidence.ps1` | 5956 | `d68b71ac6db852611791e265b9fe194c2f8df562dd6a48a60e8765e50e34b2df` |
| `execution-context.json` | 529 | `3243c5086dded9a793d0f62cc7ef5b6d96811e7ff62a66fd8f09cb88366a3fdd` |
| `original-http-provenance.json` | 445 | `1d76707876f722b06948de568a0a99c2f4e688e75938d08e0c3501b6d1d16fa6` |
| `regressions.artifacts.json` | 4190 | `86e5f546aabfe291892742bfa16cea750bd35e68781970e0dc02bfc3568e22e4` |
| `regressions.binding.exitcode.txt` | 3 | `13bf7b3039c63bf5a50491fa3cfd8eb4e699d1ba1436315aef9cbe5711530354` |
| `regressions.binding.intent.json` | 373 | `09e09604acb087f5736bead5c9c1fcdb22d799ee48339017f33a844d1a186212` |
| `regressions.binding.metadata.json` | 507 | `2d20937218f236b49f445723b990291862f382c1f23ddd6a745e4ad28dac52e7` |
| `regressions.binding.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `regressions.binding.stderr.redacted.txt` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `regressions.binding.stdout.raw` | 452 | `81f282e630d54649819749875b4b637033e3f102ddfe5950156ad357247cedcc` |
| `regressions.binding.stdout.redacted.txt` | 452 | `81f282e630d54649819749875b4b637033e3f102ddfe5950156ad357247cedcc` |
| `regressions.broker-memory.exitcode.txt` | 3 | `13bf7b3039c63bf5a50491fa3cfd8eb4e699d1ba1436315aef9cbe5711530354` |
| `regressions.broker-memory.intent.json` | 428 | `1c03ae94d0b527a3c7ae44044d822b641a296fd39f54da0e1d3eaa23887dd472` |
| `regressions.broker-memory.metadata.json` | 567 | `66bdb5619e2b69e698cf40092011f8dada987beabaad1678d46de6995b3af515` |
| `regressions.broker-memory.stderr.raw` | 173 | `3c76f7664d76b5064e8aba73dfa31856ac7cd6b9581ebd29c545f93e868ca45f` |
| `regressions.broker-memory.stderr.redacted.txt` | 173 | `3c76f7664d76b5064e8aba73dfa31856ac7cd6b9581ebd29c545f93e868ca45f` |
| `regressions.broker-memory.stdout.raw` | 131681 | `22abf73f9960fff02acf96c7a08853f529bca463d8d67820413c548a7109992c` |
| `regressions.broker-memory.stdout.redacted.txt` | 131681 | `22abf73f9960fff02acf96c7a08853f529bca463d8d67820413c548a7109992c` |
| `regressions.capture-summary.json` | 1116 | `eed3ac1c19aaf9fef78da2ca9b5de602d73e109bde193e7343154f69679fbf25` |
| `regressions.entry.exitcode.txt` | 3 | `13bf7b3039c63bf5a50491fa3cfd8eb4e699d1ba1436315aef9cbe5711530354` |
| `regressions.entry.intent.json` | 363 | `3c96ee4fdd14cb41f5c367bafe6b9f8a8b64bb1ff5b0bee0df0d91f64a5e0b30` |
| `regressions.entry.metadata.json` | 497 | `e6069c9d3fbb40e8a57ff75404d898afde09e119cce0b11e05b2b672d000d2a2` |
| `regressions.entry.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `regressions.entry.stderr.redacted.txt` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `regressions.entry.stdout.raw` | 448 | `31f1e9f9067fe110490dfdf47cff69d15f1b78f9c184cf3c3dcbf994a44b9d1e` |
| `regressions.entry.stdout.redacted.txt` | 448 | `31f1e9f9067fe110490dfdf47cff69d15f1b78f9c184cf3c3dcbf994a44b9d1e` |
| `regressions.source-after.json` | 3875 | `1f5717c0b0e48f46a5004657728bd291768ac2869f527c5e63403cd850b52448` |
| `regressions.source-before.json` | 3875 | `1f5717c0b0e48f46a5004657728bd291768ac2869f527c5e63403cd850b52448` |
| `tls.artifacts.json` | 1558 | `a6cbd7dd46de87f35cfd2c949ad3f5ac6a0f4f90b7bb9bdb331ae81cc16f2e54` |
| `tls.capture-summary.json` | 467 | `373c0472ba1ef0fa1a70bf94484c0de695b6c426eed4b156adbf71436957c42d` |
| `tls.source-after.json` | 4481 | `a68f9b8e0bde2d1c35dda828efc701d5bbe228bfb5451ace684e0f5973c114d7` |
| `tls.source-before.json` | 4481 | `a68f9b8e0bde2d1c35dda828efc701d5bbe228bfb5451ace684e0f5973c114d7` |
| `tls.tls-pin.exitcode.txt` | 3 | `13bf7b3039c63bf5a50491fa3cfd8eb4e699d1ba1436315aef9cbe5711530354` |
| `tls.tls-pin.intent.json` | 422 | `a55d04632d210e0fe7b4aa522a368be5f798fcebac7969107c7c27272d707858` |
| `tls.tls-pin.metadata.json` | 559 | `19514176aeca1c73743e5488d724f5b39846a06c3ff0139e07aacda1e7e24bf3` |
| `tls.tls-pin.stderr.raw` | 173 | `f96c03e7641358207f925aaaff6119b48379b7d2fe16fc03abf73923130a74f6` |
| `tls.tls-pin.stderr.redacted.txt` | 173 | `f96c03e7641358207f925aaaff6119b48379b7d2fe16fc03abf73923130a74f6` |
| `tls.tls-pin.stdout.raw` | 5104 | `848668437de342c19d7a7dc6a7b72cb3ede0b66c9d77ae88f24d8ca9b2743512` |
| `tls.tls-pin.stdout.redacted.txt` | 5104 | `848668437de342c19d7a7dc6a7b72cb3ede0b66c9d77ae88f24d8ca9b2743512` |
| `evidence-index.json` | 6687 | `2af8bc29cc898f293eba630255222040f1422a18a17aa15d4507a784c97dcbc9` |

## 7. 未验证项、禁止动作与交接

- 本轮只有合成配置、固定假握手／假证书字节／假 HTTP 与合成 Authorization。allowRead 保持 false；无真实配置、凭据、账号、证书、设备响应或下载保密协议原文进入工具和 Git。
- 真实配置／授权／时钟、DNS/peer、证书可信来源、原始认证／响应解析、绝对网络 deadline、真实停止机制、Windows live 输出与完整 CLI 均未由本轮补齐。单条假请求能力句柄不替代旧桥的同域快照与审批门禁。
- 设备 GET／其他设备请求、E1/E2、原探针 CLI、Windows 原生/ACL 主预检、原生回归、扫描、照片／人员／权限下发、远程开门、生产云、支付、部署／上线：NOT_EXECUTED。合成 suite 的“HTTP 字节”只是假内存接收；本轮授权的 Git 查询／推送另行计，不冒称全机无网络。
- 不安装、不修改系统／全局 Git、TLS、代理或安全／执行策略，不 Bypass/Unblock/关闭防护，不强推、不推 main，不 amend/rebase/reset/squash/force/merge/cherry-pick，不清理任何已有对象。
- 提交前检查仅四新增路径及 git diff --check；追加提交后检查 git show --check。普通 push 使用显式 `HEAD:refs/heads/feat/hk-ai-08-tls-pin-before-send-offline`，再用 ls-remote 对照完整 SHA；真实结果保留在 delivery.receipt.json。推送失败则保留本地提交，不改配置或强推。
- 本轮结果等待独立复审，不作最终独立验收、不作 E1 放行；交付后停止。
