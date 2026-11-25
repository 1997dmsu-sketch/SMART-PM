# HK-AI-08 受控 E1 runner · CR-1

本交付只实现纯合成 core：受控数据的一次安全复制、固定离线 checker
复用、型号/pin/bounds 兼容门、不可变私有配置与可变状态分离、一次消费
和私有 activation ticket、内存证据模型及闭式结果映射。

实施卡固定于 `0dc4433a06eff3f15f164e465257a77c709e73b9`；实现起点
为 `4df33305d488df2797cea4c3d2b286db7d8daa2c`。当前阶段不包括
CR-2 固定 probe 组合、CR-3 实际 Node/Windows 文件 I/O 或真实 E1/E2。

## 入口与能力边界

`index.mjs` 只导出 `executeControlledE1(input)`。当前没有已实现的真实
审批有效性核验和 native evidence bridge，因此安全捕获后固定返回
`BLOCKED / APPROVAL_UNVERIFIED`，不执行 checker 后续门禁、不开文件、
不创建 session/transport、不接收额外 adapter 参数，不联网。
输入结构不安全或缺件时返回固定 `CONFIG_UNVERIFIED`；不回显输入或异常。

`controlled-runner.mjs` 的 `createSyntheticController` 是明确的纯内存模型。
它只接受闭式数据和固定控制枚举，不接收 source/clock/transport/writer/native
callbacks。其 `scope: cr1-synthetic-only` 快照只记录状态、数量、布尔、
随机 planRef 和枚举 trace，不导出捕获的目标、口令、pin 或私有执行配置。
本模型的“已核”控制值仅是测试假设，不是外部审批真实性证明。
`index.mjs` 不导入该模型，也不认可模型/token/历史 PASS 为真实能力。

## 输入模型

根字段为 `schemaVersion/checkerInput/credentials/tls/bounds/authorization/outputPolicy`：

- schemaVersion 为 `hk-ai-08-controlled-e1-v1`；checkerInput 沿固定离线
  checker 的闭式 schema，candidate.allowRead 仍须 false。
- credentials 为显式 username/password；tls 为 mode/fingerprints，mode
  仅 fingerprint-pinned，1–2 个 SHA-256 pin。这里的 pin 只是合成假设中
  的批准材料，不根据自报字段证明真实批准；外部替换不会改变封存副本。
- bounds 为 timeoutMs/maxBytes，须为安全整数，分别 `1..10000` 与
  `1..262144`；authorization 为显式 UTC 毫秒 windowStartMs/windowEndMs。
- outputPolicy.version 为 `hk-ai-08-windows-evidence-v1`；不是对 Windows
  本机能力存在性的声明。

pin 的归一化严格沿固定 P 的 `http.mjs:28–59`：在先证明为原始字符串后
去除非十六进制字符并转大写，每项仍须为 64 位，去重后为 1–2 枚；不把
host/port 白名单去重当成修复输入，也不把 pin 自报材料当作真实批准。

所有记录只读取自有可枚举数据描述符；拒 Proxy、accessor、隐藏/Symbol
键和异常原型。pin 数组也检查完整键/描述符后复制，避免 getter 副作用。
SEALED 保存的是只读 normalized binding，不含 `allowRead`，不是可执行
config。`matchesNormalizedBinding` 只对合成预期作布尔比对，不导出绑定值；
本阶段没有创建消费后的真实执行视图。

## 合成生命周期

controller.check 接收 `nowMs/fresh/revoked/approval`，approval 只接受明确
的 `VERIFIED_SYNTHETIC` 模拟枚举；arm 还需 `confirmed: true`。
`prepare({fault: NONE})` 使用固定微任务边界，期间可通过 setControl 的
闭式数据模拟撤销/到期；没有任意 callback 注入。未知状态、到期、回退
时钟、撤销都会终止旧模型，不允许用后来的 fresh:true 恢复。

consume 的同步临界段先写 CONSUMED，再 mint 唯一私有票，再激活同 plan
内存 session。失败、未知和重复消费者不返还消费权。CR-1 的 invokeCount
与 transportInvocationCount 恒为 0：没有实现或运行任何 probe loop。
complete 仅表示合成生命周期结束，不代表六端点通过或 E1 通过。

测试与证据按批准卡显式列举；本 README 不声明任何本轮测试计数，最终
实际结果由独立证据记录给出。普通数据逐场景完整 clone；属性型对抗输入
用完整键/描述符/引用身份及 getter 计数，不把快照自身失败当被测拒绝。

用户取消隔离网络前置保持有效。本阶段不读取真实配置/凭据，不运行本地
已派 ACL 任务，不安装环境/依赖、不启动 HTTP/UI/监听或设备动作。Windows
运行结果与实际 Node writer/native ACL 能力仍待其各自阶段验证。

## CR-2 合成探针接线（2026-11-23 追加）

本阶段按最终技术裁定 `716b1f0053d5ad34b45fc78d5cf79e5739f2aa36` 实施，
代码基线固定 `2712ea7866377d889a78e413fcb7de420b9ad1ab`。`private-plan.mjs`
成为单一私有运行时 owner：原 controller/session 实现机械重定位到该模块，
`controlled-runner.mjs` 与 `evidence-session.mjs` 只保留兼容 facade 再导出，
原工厂的方法、返回形状与 CR-1 行为不变；原三份测试保持原字节并继续全通过。

新增固定工厂 `createSyntheticProbeController(input)`（由
`controlled-runner.mjs` 再导出），固定只提供
`check / prepare / arm / setControl / invokeScenario / invalidate / snapshot`，
无手工 consume/complete、无 session/config/原始 report getter、无 writer、
不接受任何 transport/adapter/callback 注入。

- `prepare({fault})` 只接受闭式枚举 `NONE / PREFLIGHT_WRITE / PREFLIGHT_READ /
  PREFLIGHT_CLEANUP / WRITE / READ / CLEANUP / REPORT_SEAL`；前三个在预检拒绝，
  WRITE/READ 用于响应保存/回读故障，CLEANUP 用于 close 故障，REPORT_SEAL 用于
  原始报告私有封存前固定失败（仅本 profile）。prepare 是唯一允许预载固定
  模块树的入口（字面 `import("./probe-binding.mjs")`）。
- `invokeScenario(scenario)` 只接受闭式 v1 场景
  `{schemaVersion:'hk-ai-08-cr2-scenario-v1', steps, events, requestFault}`，
  消费前一次安全复制并完整校验；结构非法以 `CONFIG_UNVERIFIED` 终止。
  唯一消费、mint、ACTIVE 与 invoke 认领在无 await 的同步段内完成，之后才
  真正调用固定 vendor `runProbe`（transport 为 owner 私有不转发合成桩，
  now 为 owner 内部合成时钟闭包）。
- 返回冻结合成 envelope：
  `{schemaVersion:'hk-ai-08-cr2-simulation-result-v1',
  scope:'cr2-synthetic-fixed-probe-only', result, simulation, trace}`。
  `result` 是原 `makePublicResult` 的闭式 DTO（由 owner 自有事实构造），
  `simulation` 只含 invokeClaimed/invokeCount/identityConfirmed/recordCount/
  bytesWritten，`trace` 只含固定枚举类型与 null/六端点 ID、attempt 0/1/2。

六份 vendor（`vendor/probe-558b9c8/`）为固定提交
`558b9c864a4b820e397336200758b143556a4d87` 的原字节快照，来源/blob/字节/
SHA-256 见 `VENDOR-SOURCES.json`；只复制 `http.mjs` 以满足 `assertContentType`
依赖，不授权调用 `httpsGet`。G1 最终 200 且同一私有 body 经固定
`parseDeviceInfo` 完整型号核验成功后才允许 G2–G6；写/读/报告封存/close
故障、撤销/到期/资源失效与 stop latch 均先终止且不继续下游；确认提交
不等于结果已知（CONFIRMED_SUBMITTED/TIMEOUT/RESPONSE_ERROR 仍
UNKNOWN＋黏性），NOT_SUBMITTED 不清零已发生调用。全部结果均为合成假设，
不是真实审批、ACL 或设备证据；真实入口 `index.mjs` 原字节不变，仍固定拒绝。

最终验证命令只显式列原三份测试加 `test/probe-integration.test.mjs`
（`--test --test-isolation=none --test-reporter=spec`）；真实 Node/native/
Windows ACL/文件 I/O 与真实设备部分继续 BLOCKED，不进入 CR-3/E1/E2。

## CR-2 复审修复轮（2026-11-25 追加）

按 Stop-CR2 独立复审的 3 项 P2 修复（固定起点 72d654a，本段只追加）：

- **R1**：`finalizeProbe` 的 REPORT_SEAL 分支不再无条件
  `stop(EVIDENCE_WRITE_FAILED)`——封存故障只在没有更早终态/黏性未知时才能作为
  首因触发；已有首因保留其 code，黏性未知保持 `UNKNOWN`＋
  `requestOutcomeUnknown=true`，不被降级为 FAILED，也不执行会覆盖已 latch
  事实的封存 fault。
- **R2**：原 report 现在被真实接收并私有封存：owner 私有 WeakMap 按同 session
  绑定 `{sealed, report}`，`receiveReport` 先校验并封存、成功后才发
  `REPORT_SEALED`，随后 `model.seal`→`SESSION_SEALED`→`model.close`→
  `SESSION_CLOSED`；已 latch/未知终态只把迟到 report 留作私有终态诊断
  （sealed:false），不伪造任何封存/关闭事件。`snapshot` 新增
  `reportSealed` 布尔（由私有封存事实派生），不新增 raw getter、不改变公开
  DTO/envelope 协议、不重读另一份配置恢复执行视图。
- **R3**：新增 `test/guard-isolation.test.mjs`（冻结 testkit 未修改）——在 guard
  安装前于全部实际捕获位置注入纯内存可计数 fake，用未改 guard 逐槽验证捕获
  身份、经 wrapper 的正控 +1、捕获原目标零增长、覆盖集合与四文件实测 232 槽
  精确相等、累计基线不清零与 finally 精确恢复；安全 fake 不启动任何真实
  进程/网络/监听/DNS/凭据/业务文件，子进程槽仅在进程内验证、不声明跨进程
  继承。三套负控（工件副本单点变异）分别回退 R1 缺陷、禁用真实封存、给 guard
  副本注入“先转原目标再抛拦截错误”缺陷，均退出 1 且精确命中对应回归。

本修复轮实测（Windows 10 19042 / Node v24.19.0，其他版本口径不变）：
批准四文件命令 356/356 通过（新增 17 节点）；五文件定向套件（含
guard-isolation）360/360 通过；guard 槽集合与四文件实测 232（92+8+132）精确
相等。真实 Node/native/ACL/文件 I/O 与设备部分继续 BLOCKED。
