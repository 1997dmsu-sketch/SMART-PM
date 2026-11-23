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
