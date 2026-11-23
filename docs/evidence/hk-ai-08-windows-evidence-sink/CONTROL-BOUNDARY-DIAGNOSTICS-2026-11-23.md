# 单目标 ICMP 连通结果与控制边界纯内存诊断开发

本报告区分两种实际工作：用户新授权的单目标ICMP检查，以及随后进行的合成内存诊断开发。ICMP本次成功；21例内存验证符合预期。**这不证明设备Web/TCP端口、激活、型号、账号认证或API可用，也不回填旧CONTROL-006的具体失因，不作43项原生复验、完整CLI、E1/E2或生产放行。**

## 授权、来源和独立分支

用户在旧FAIL报告复审后明确要求“尝试访问门禁机，再继续开发”，随后提供设备本机有线网络设置照片。此新授权允许对照片给定的唯一目标进行有限连通尝试；未授权扫描、登录、读取真实凭据、修改设备、门禁权限/人员/照片写入或E1/E2套件。

照片给出了IPv4，但没有Web服务端口。本次父进程按明确IPv4解析目标，再经stdin交给ICMP子进程复核；目标未写入被测生产源码、ICMP检查脚本、ICMP原件JSON或Git，也未生成地址摘要或哈希。目标引用 `user-device-network-image-1` 仅关联本对话用户提供的照片，不自证设备型号、资产归属、同份完整配置或审批有效性。DHCP开启意味着地址可变化，此处结论限本次时刻。

继续开发从已复审失败报告提交 `f0f23dbb479b2a94c81a3cbb5519ce9f100e5042` 建立独立工作树 `D:\chatgpt\smart\SMART-PM-control-boundary-diagnostics`、分支 `test/hk-ai-08-control-boundary-diagnostics`；初始HEAD即该SHA，初始工作树干净。该基线父为已审P1修复 `25d141d5d64e1d10800fd6db85e89584283b9205`。保留所有其他工作树及既有未跟踪文件，不用新tip替代固定来源。

## 1. 真实连通检查：一次ICMP

实际执行为已安装Windows PowerShell5.1 Desktop，`powershell.exe -NoLogo -NoProfile -NonInteractive -File single-target-icmp.ps1`；目标不在该子进程argv中，经stdin输入。脚本以IPAddress对象调用一次 `.NET Ping.Send(address,3000,emptyByteArray)`，不使用主机名/DNS，不重试、扫网、扫描端口、跟随跳转或读取配置/凭据。Ping对象结束后Dispose，不修改设备和网络设置。

| 项目 | 实际结果 |
| --- | --- |
| 采集开始～结束（Asia/Shanghai） | 2026-11-23T15:59:22.1189634+08:00～2026-11-23T15:59:22.6548049+08:00 |
| ICMP子进程runtime | Win32NT / Desktop / 5.1.22621.6133 |
| .NET Send调用数/超时参数 | 1 / 3000ms |
| ICMP结果 | Success；replySourceMatchesTarget=True |
| RTT / 独立进程退出码 / stderr | 225ms / 0 / 0 bytes |
| 应用访问 | TCP连接0、HTTP请求0、账号密码0、设备状态修改0；E1/E2未执行 |

只有IPStatus.Success且回应来源与输入地址相等才记REACHABLE；其他结果不能直接证明设备离线。Send调用数不是经网络抓包确认的发包数量；本轮未做OS级网络活动审计。ICMP回应可以证明此地址在该时刻响应，不能识别回应者型号、验证激活、确认Web服务或替代TLS/认证证据。

用户随后询问端口在哪里查看，已说明当前有线网络页只显示地址，建议返回查看是否有网络服务/端口/HTTP(S)项；菜单存在性须以该固件实际画面为准。[该系列官方手册](https://enpinfo.hikvision.com/hkwsen/unzip/20231116155642_78929_doc/index.html)将Set Port Parameters列于Operation via Web Browser → Configuration → Network Settings，不能把同系列手册当成本机固件读数。未假定HTTP/HTTPS或SDK默认端口，也未为找端口安装发现软件或扫描。Web/HTTPS端口仍待用户提供，本轮没有后续服务连接。

## 2. 开发范围：确定性控制边界

仅修改 `tools/hikvision-windows-evidence-sink/test/broker-terminal.test.mjs`，保留原14例和所有旧断言，追加7例及其合成辅助逻辑；仅将三处清单/预期总数从14改21。生产bridge、broker、entry、原43项Windows测试、C#及ACL字节全部不变；没有增加生产API、路径、回调或执行器注入，allowRead仍为false。

原CONTROL-006只轮询calls===6，不能证明仍处于写前；原raw只保存ASSERTION_FAILED，没有具体断言栈、注入时点或外层execute DTO。因此本补丁先增加可确定调度下的行为证据，**不修改原43测试、不把零文件断言放宽为0..2、不宣称已修复或确诊旧失败**。

| 新case | 精确屏障/控制 | 固定期望 |
| --- | --- | --- |
| BR-C01～04 | calls=6、生命周期第9次validate请求（id10），暂扣回复；分别撤销、取消、过期、上下文变化，再释放 | 对应FAIL/code、write请求0、模型文件0、许可不恢复 |
| BR-C05～06 | write请求id11已经收到，先构造2文件成功模型但暂扣回复；撤销/取消后释放 | 对应FAIL/code；已知两文件、bytes、flush等六计数保留；无新写入 |
| BR-C07 | 正常执行已经settled，仍观察calls=6、一次write及2模型文件；再取消 | 原冻结PASS不追溯改写；后续执行被拒；证明calls6不是阶段证明 |

前两类在实际fake stdin请求边界暂扣回复，明确记录未settled、busy/op、注入和释放顺序、请求ID/完整RPC序列及expected/actual；不依赖setImmediate轮询是否碰巧抢到窗口。原14例继续覆盖P1协议异常、late/queue/init首错粘滞和合法单行/分块正控。

## 3. 实际纯内存验证

测试原样读取五个白名单生产mjs，经严格UTF8 roundtrip/hash后送SourceTextModule，未替换或转译产品源码。VM仅链接固定五源与八个明确的SyntheticModule/纯函数接口；未知/动态import拒绝。进程、文件系统写、timer及child pipe均为内存替身，node:net仅提供isIP。源码读取与外层日志是授权的真实IO；stdout里的actualNativeObjects/actualWorkerSpawns/actualFilesystemWrites=0指被测模块副作用，不是整个任务零文件写入，更不覆盖前述真实ICMP。

唯一实际测试命令：

```text
node.exe --experimental-vm-modules .\tools\hikvision-windows-evidence-sink\test\broker-terminal.test.mjs
```

Node为已安装v24.16.0，真实平台Win32NT，外层采集PowerShell Core；没有启动真实native worker或编译器。VM实验性接口的真实stderr警告保留，没有隐藏或改写为空。

运行起止（Asia/Shanghai）：`2026-11-23T16:06:06.6271853+08:00`～`2026-11-23T16:06:06.8986504+08:00`；进程退出码=0，timedOut=False，childQuiescent=True，launchErrorType=null。

| 分层 | 实际case | 实际断言 | 失败 |
| --- | --- | --- | --- |
| 原14例 | 14/14 | 442/442 | 0 |
| 新增7例 | 7/7 | 342/342 | 0 |
| 合计 | 21/21 | 784/784 | 0；failedIds=[] |

每条断言以真实expected/actual深比较决定PASS/FAIL，异常单独记失败、最终失败退出非零，未跳过失败或预填测试结果。负控实际execute为FAIL，case通过表示控制被正确拒绝；不能把模型native PASS洗成整体execute PASS。

| 新case ID | 实际结果 | 断言数 | 失败断言 |
| --- | --- | --- | --- |
| BR-C01-final-validate-permit-revoked | PASS | 50 | 0 |
| BR-C02-final-validate-session-cancelled | PASS | 50 | 0 |
| BR-C03-final-validate-permit-expired | PASS | 50 | 0 |
| BR-C04-final-validate-context-changed | PASS | 50 | 0 |
| BR-C05-write-reply-permit-revoked | PASS | 51 | 0 |
| BR-C06-write-reply-session-cancelled | PASS | 51 | 0 |
| BR-C07-completed-calls-six-is-not-a-boundary | PASS | 40 | 0 |

模型计数中的128bytes、2文件、2flush属于fake native回复，不是新的Windows磁盘操作或设备请求。模型关闭计数与真实native计数语义不可互换。suite未触发真实timer，不覆盖真实timeout/无法静止关闭分支，不把诊断通过扩大为全部异常路径已验收。

## 4. 源码原始字节与前后哈希

本轮16来源执行前后bytes/SHA逐项相同；其中15份未改生产/旧测试来源可与基线f0f23db原始Git blob对应。最后一项测试为本轮有意追加7例的开发字节，不冒称与旧195a0104…测试字节相同。原14例主体和断言在Git diff中保持不变；新测试为40706bytes，SHA `835e5dec53a51baf47dcc4a400f623c96668c480f54561ace894b34336db433f`。

| 仓库相对路径 | bytes | 执行前＝后SHA-256 |
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
| `tools/hikvision-windows-evidence-sink/test/broker-terminal.test.mjs` | 40706 | `835e5dec53a51baf47dcc4a400f623c96668c480f54561ace894b34336db433f` |

源字节/hash检查不原子固定解释器、同用户内存、运行时或未来路径，不解决全部TOCTOU。各case的合成scope、固定假输入和原生能力模型不能自证真实审批/配置/设备。

## 5. 原始stdout/stderr、退出码与工件定位

以下定位相对独立开发工作树，均为仓库外本轮新建日志。ICMP intent在启动前CreateNew持久化，目标仅stdin；纯内存运行也有唯一launch-intent。ExitCode在WaitForExit后直接取得变量，等待管道复制完成后独立保存，后续shell不能覆盖。原始BaseStream数据保持不变，个人home/SID脱敏副本另CreateNew保存；本轮raw/redacted恰同字节，均有独立hash。

| 工件定位 | bytes | SHA-256 |
| --- | --- | --- |
| `../HK-AI-08-device-reachability-2026-11-23-run01/single-target-icmp.ps1` | 2090 | `49f3f60a5f071edf6881e5ee0693b228dea79df5c2a097646bb5755ad82b4730` |
| `../HK-AI-08-device-reachability-2026-11-23-run01/attempt.intent.json` | 412 | `ce8d6f8bfffece78e7389376a12af2d439a17e3e3ac4da548d71115436d1fc9e` |
| `../HK-AI-08-device-reachability-2026-11-23-run01/icmp.stdout.raw` | 530 | `88eced3e56840274d3497ebae60ed330a17c6a0fdfa06072f4afb1a4dc00ceea` |
| `../HK-AI-08-device-reachability-2026-11-23-run01/icmp.stdout.redacted.txt` | 530 | `88eced3e56840274d3497ebae60ed330a17c6a0fdfa06072f4afb1a4dc00ceea` |
| `../HK-AI-08-device-reachability-2026-11-23-run01/icmp.stderr.raw` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-device-reachability-2026-11-23-run01/icmp.stderr.redacted.txt` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `../HK-AI-08-device-reachability-2026-11-23-run01/icmp.exitcode.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `../HK-AI-08-device-reachability-2026-11-23-run01/icmp.execution.metadata.json` | 628 | `fc5050917dd4a8aa26d76c06356d915162120b693b7a94c74551ea9a915c737d` |
| `../HK-AI-08-device-reachability-2026-11-23-run01/artifacts.manifest.json` | 890 | `954164d00ee440c0a5fe8a9427a71f42dd6cc395944a5263133c640045453d9b` |
| `../HK-AI-08-control-boundary-diagnostics-2026-11-23-run01/capture-diagnostics.ps1` | 6227 | `e62a81cb2374d4f780c568b0744921e82e62c3f0c1de9ded42eaaabc07132c65` |
| `../HK-AI-08-control-boundary-diagnostics-2026-11-23-run01/diagnostics.launch-intent.json` | 266 | `9fdfadbae077dba4a4249cac08bd09abeaaa1b821896ac02c9541b19d1255cb3` |
| `../HK-AI-08-control-boundary-diagnostics-2026-11-23-run01/diagnostics.stdout.raw` | 131686 | `2bd3a94254fea7a3efe7941b8d7af02cad349016cd4977e6224f5b86177d80b6` |
| `../HK-AI-08-control-boundary-diagnostics-2026-11-23-run01/diagnostics.stdout.redacted.txt` | 131686 | `2bd3a94254fea7a3efe7941b8d7af02cad349016cd4977e6224f5b86177d80b6` |
| `../HK-AI-08-control-boundary-diagnostics-2026-11-23-run01/diagnostics.stderr.raw` | 173 | `1098a7df2765604cd745900fb7a2889185fd595696f58b4239b3f0af6f3bdbca` |
| `../HK-AI-08-control-boundary-diagnostics-2026-11-23-run01/diagnostics.stderr.redacted.txt` | 173 | `1098a7df2765604cd745900fb7a2889185fd595696f58b4239b3f0af6f3bdbca` |
| `../HK-AI-08-control-boundary-diagnostics-2026-11-23-run01/diagnostics.exitcode.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `../HK-AI-08-control-boundary-diagnostics-2026-11-23-run01/diagnostics.execution.metadata.json` | 851 | `fb73907b8f01531ccb167d23945a699c83e1858ed016cdaf2b56d2410ce87bd1` |
| `../HK-AI-08-control-boundary-diagnostics-2026-11-23-run01/sources.before.json` | 2984 | `b60b62c17404ffec4cb46c86d8a064073fa9bf082f3c0eff38a0cb4afc1e6421` |
| `../HK-AI-08-control-boundary-diagnostics-2026-11-23-run01/sources.after.json` | 2984 | `b60b62c17404ffec4cb46c86d8a064073fa9bf082f3c0eff38a0cb4afc1e6421` |
| `../HK-AI-08-control-boundary-diagnostics-2026-11-23-run01/artifacts.manifest.json` | 1555 | `9a48464ab90d16269994e4a3c4ed3f290896fc1ea15a16359f0d0265ff6cd251` |
| `../HK-AI-08-control-boundary-diagnostics-2026-11-23-run01/combined-artifacts.inventory.json` | 4410 | `4c39a20c8e7f0b200b2d926dab095cebe05e7bcac6c49ac07e9d05a8ce94f890` |

原manifest不覆写；combined inventory追加串联两个新日志目录已知文件，不包含自身或之后产生的本报告/生成器/交付回执，不是自哈希或整个目录未来内容穷举。ICMP stderr=0，诊断stderr=173bytes（真实VM ExperimentalWarning）；两个进程实际退出均0，两组都没有执行策略绕过或管理员提权。没有读取任何旧原生日志或LocalAppData残留根来补证。

## 6. 历史保全、未执行项与停止边界

基线[43项失败报告](BROKER-WINDOWS-SUPPLEMENT-2026-11-23.md)仍为24851bytes、SHA `666daacea169fca6377934c8fbf2a845d18f105c2ecf38d0d2bd4a7d2bd3de9d`：43计划/37执行/36通过/CONTROL-006失败/后6未执行，退出1，原结论保持FAIL。旧11根/11compiler/84RPC引用、此前57根及更早ACL/Node/绑定/离线入口的全部报告日志与引用均保留，不覆盖或手动处理。

[原P1修复内存报告](BROKER-TERMINAL-FIX-2026-11-23.md)的旧14例来源字节、基线9失败/修复后通过、采集metadata碰撞和时间限制不重写；本轮新21例与旧14例明确分开。旧原生43、16分层native、140/264、51策略及原主预检本轮均未重跑；只有21纯内存suite与单独的1次ICMP实际执行。此任务总设备应用请求HTTP仍0，TCP服务连接0，未读取人员、照片、配置、激活、账号或真实凭据。

不改allowRead=false、生产接口、ACL或身份门禁；不增加真实设备执行器，不运行原CLI/runProbe、E1/E2，不写设备或生产云，不合并/部署/上线。不扫描网络、不假定端口、不跟重定向、不处理旧残留，不使用默认口令、SADP、管理员提权、全局Git/TLS/代理/执行策略修改、Bypass或关闭防护。用户取消隔离网络前置的决定不变。

本次目标是取得一次有限连通事实，并补开发中确定性控制行为证据。旧CONTROL-006具体失因仍待保全信息支持的独立定位，不能据本轮内存结果改记旧PASS或宣称完整Windows取消路径/清理/真实网络链路通过。Web端口、TLS身份、认证、原始响应、真实配置/审批/时钟及完整live桥仍未验证；真实接口访问待明确端口及相应范围，生产/E1/E2未放行。

本分支只提交一个测试文件修改及本新报告；追加普通提交、显式 `HEAD:refs/heads/test/hk-ai-08-control-boundary-diagnostics` 推送并ls-remote核对完整SHA，不推main、不amend/rebase/reset/squash/force/merge/cherry-pick。真实交付SHA在提交后回执保存，不预填自身提交hash；推送失败保留本地、不改配置或强推。交付后停手交独立复审，不自行扩大为真机功能或生产验收。
