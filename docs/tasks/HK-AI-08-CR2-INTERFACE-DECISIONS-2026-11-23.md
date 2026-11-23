# HK-AI-08 CR-2 接口技术裁定与实施范围补充（2026-11-23）

## 0. 结论、来源与边界

- 本轮由 Codex 处理接口归属、生命周期及安全边界的技术裁定；实现、测试、取证和普通交付继续交 Harness。**本文不启动实现、不派发新 Harness 会话，不执行代码/测试/设备操作。** 技术文本通过不自动变为 CR-2 开工或 CR-3/E1/E2 执行授权。
- 前置报告 `1d726020756460ffb368dd2f92b895306c3243b4` **有条件通过**：17 项来源核对正确，七个接续点成立；§1 三处文本勘误须由 Harness 追加回写。它们不是 CR-1 验收退回，也不使已获准的 CR-1 262/262 失效。
- 本文直接起点为该前置报告；文档分支 `docs/hk-ai-08-cr2-interface-decisions`。本轮只新增本文和独立复审记录，不修改前置报告、SOURCE-INVENTORY、实现或既有验收文件。
- 未来实施使用新的独立分支 `feat/hk-ai-08-e1-cr2-synthetic`，直接代码基线固定为 **`2712ea7866377d889a78e413fcb7de420b9ad1ab`**；不要移动仍停在该验收对象的 CR-1 分支。前置报告/本文/原卡按固定 Git 对象读取，不合并文档分支。
- 本文补充原卡的 CR-2 文件/接口职责；同一事项按本文具体裁定执行。未明确变更的 A/B 契约、六 vendor 原字节及停止条件不变。

| 来源 | 完整固定提交 | 定位 |
|---|---|---|
| CR-1 | `2712ea7866377d889a78e413fcb7de420b9ad1ab` | `tools/hikvision-e1-controlled-runner/` 与其 CR-1 验收记录 |
| 前置报告 | `1d726020756460ffb368dd2f92b895306c3243b4` | [报告](https://github.com/1997dmsu-sketch/SMART-PM/blob/1d726020756460ffb368dd2f92b895306c3243b4/docs/tasks/HK-AI-08-CR2-INTEGRATION-PREFLIGHT-2026-11-23.md)、[17 项清单](https://github.com/1997dmsu-sketch/SMART-PM/blob/1d726020756460ffb368dd2f92b895306c3243b4/docs/evidence/hk-ai-08-cr2-preflight/SOURCE-INVENTORY.json) |
| 原实施卡 | `0dc4433a06eff3f15f164e465257a77c709e73b9` | [分阶段卡](https://github.com/1997dmsu-sketch/SMART-PM/blob/0dc4433a06eff3f15f164e465257a77c709e73b9/docs/tasks/HK-AI-08-E1-CONTROLLED-RUNNER-IMPLEMENTATION-TASK-2026-11-23.md) |
| A | `4df33305d488df2797cea4c3d2b286db7d8daa2c` | [配置绑定设计](https://github.com/1997dmsu-sketch/SMART-PM/blob/4df33305d488df2797cea4c3d2b286db7d8daa2c/docs/tasks/HK-AI-08-E1-CONTROLLED-CONFIG-BINDING-DESIGN-2026-11-23.md) |
| B | `e6995bcb4dd9943df9745604bfcca7c4d7ea8890` | [私有 writer/ACL 契约](https://github.com/1997dmsu-sketch/SMART-PM/blob/e6995bcb4dd9943df9745604bfcca7c4d7ea8890/docs/tasks/HK-AI-08-NODE-WINDOWS-ACL-INTEGRATION-REVIEW-2026-11-23.md) |
| P / O | `558b9c864a4b820e397336200758b143556a4d87` / `31f20c9a372c447f142312f6e95e0400372f9ee8` | 固定六探针依赖 / 固定 checker；哈希沿原卡及前置清单，不重新解释版本 |

## 1. 前置报告的明确勘误

G1–G7 的编号以报告 **§4 的表格**为唯一含义；本节覆盖其不一致措辞，Harness 应在原文档线上追加小提交，SOURCE-INVENTORY 的 17 项事实不改。

| ID / 级别 | 原报告行 | 要求回写 |
|---|---|---|
| CR2-PF-01 / P2 | 198，G7 | 已有计划 trace 包含 COMPLETED/FAILED/UNKNOWN/INVALIDATED，会话已有 MEMORY_WRITE/MEMORY_READ/SEALED/CLOSED/FAILED。不得写成止于 ACTIVE；缺口收窄为 probe-invoke/wrapper/downstream 等请求窗口事件及其与已有生命周期的组合证据 |
| CR2-PF-02 / P2 | 148、196 | §3.5 raw body/DTO 接线不再称 G5，改为关联 G2/G6；G5 只指 G1 identityConfirmed 私有状态与门禁 |
| CR2-PF-03 / P3 | 5、218 | 明确 Git 网络取件/查询/推送、工作树及 Git 元数据写入已经发生；“零”只限项目代码/测试/业务网络/设备等。worktree add/fetch 不能统称只读操作 |

另统一盘点口径：CR-1 六个新增模块有 **20** 个显式导出；固定外部 checker 另 **2** 个，组合盘点才是 22，不将其全算作 CR-1 新接口。
Windows 沙箱、ACL 和完全访问切换是交付方环境自述；本轮独立核验只确认 Git 固定对象、源码与记录一致，不追认其为本会话权限设置或后续业务授权。

## 2. 架构裁定：单一私有运行时所有者

**采用单一 owner，不增加 getBinding/getConfig/getSession、withBinding(callback) 或公开 writer lease。** 只允许把原实现重定位至一个模块私有作用域，不复制第二套 plan、控制状态或 session registry。

```text
index.mjs（原字节） ────────────────→ private-plan.mjs
controlled-runner.mjs（兼容 facade） → private-plan.mjs（唯一 runtime owner）
evidence-session.mjs（兼容 facade） ─→ private-plan.mjs
private-plan --仅 CR-2 合成 prepare 的字面动态 import--> probe-binding.mjs
probe-binding ─────────────────────→ 六份固定 vendor（只取函数/常量引用）
```

- owner 保有原 cores/states/tickets、内存会话实现及 registry、控制状态、invoke 认领、端点进度、identity、未知事实和 trace。session 关联放在私有 runState，不回填冻结 core。
- owner 中一次性重定位原 controller/session 的实现，原作用域状态也随之归同一 owner；同名私有常量只保留一份等义定义。private-plan 新增导出只限三个工厂 createSyntheticController/createSyntheticEvidenceModel/createSyntheticProbeController，供 facade 使用，不新增公开执行器、配置 getter 或 session port。
- `createSyntheticController()` 与 `createSyntheticEvidenceModel()` 的原导出、方法、返回形状及原 CR-1 行为保留；对应旧模块可成为纯 facade。原 53 顶层/262 节点的测试字节不改，不能为重定位删断言。
- 新增明确工厂 **`createSyntheticProbeController(input)`**，由 controlled-runner facade 导出；其内部 profile 只能由固定工厂选择，不来自 input 的字段/布尔/模式参数。原 CR-1 工厂不新增执行能力。
- 新工厂固定只提供 `check / prepare / arm / setControl / invokeScenario / invalidate / snapshot`。不提供手工 consume/complete、session/config/原 report getter 或可调用 writer；消费、invoke 和收尾由 owner 一次完成，避免旧 complete 提前封存。
- 新工厂 `prepare(options = {})` 只接受闭式 `{fault?}`，省略时为模拟操作 `NONE`；允许值固定为 NONE/PREFLIGHT_WRITE/PREFLIGHT_READ/PREFLIGHT_CLEANUP/WRITE/READ/CLEANUP/**REPORT_SEAL**。前三个 PREFLIGHT 值在预检拒绝，WRITE/READ 用于响应保存/回读，CLEANUP 用于 close，REPORT_SEAL 用于原报告私有封存前固定失败。REPORT_SEAL 仅新 profile 可用，旧工厂枚举、默认和拒绝行为不改；不新增 callback 或公开 writer 来触发故障。
- 新工厂 input 沿 CR-1 的闭式数据 schema，仍只是假设合成批准材料；checker 副本 `allowRead=false` 不变。`index.mjs` 与 `windows-acl-bridge.mjs` 原字节不变，生产入口仍固定拒绝未验证审批。
- probe-binding 不反向导入 owner/facade，不保有授权或私有配置；可提供固定 P 的 runProbe/parser/常量引用和纯数据辅助，不能新增通用 `invoke(config, callerTransport)` 产品入口。
- **禁止任意 adapter 注入**指工厂、输入、scenario 或公开入口不得提供/替换函数；不禁止 owner 为固定 P API 私下构造 transport/now 闭包。P 固有 transport 参数只能来自该固定 owner，不能由调用者、模块路径或普通对象注册。
- index→owner 的静态导入链不得触及 probe-binding/vendor。只有新合成工厂的 prepare 允许预载固定模块；纯导入不构造 agent/socket、不调用 httpsGet。模块/函数引用准备后留在私有 runState，不热替换。
- 传给 P 的 now 也只能是 owner 内部固定闭包，用合成控制值生成报告时间；转换无法成立即固定失败，不读系统时间或接受用户函数。该合成报告时间不作为真实时钟或审批有效性证据。

## 3. G1–G7 逐项裁定

| 裁定 | 固定执行要求 |
|---|---|
| D1 / G1 执行视图 | ARMED 最终检查后同步置 CONSUMED；从同一 frozen binding 派生一次私有冻结视图，仅动作门为 true，目标/pins/bounds/凭据仍为原捕获值。该视图仅传入 owner 调用的固定 runProbe，不导出、不交任意 callback，不重读 input/env/文件恢复 |
| D2 / G2 同一 session | 将原会话实现一次性移入 owner，facade 保持旧接口；原全局一次 claim 和 ticket 机制保留。新编排直接使用其闭包内原 session 的固定内存操作，写入、校验、原报告封存和 close 不经公开引用寻址 |
| D3 / G3 唯一 invoke | 预载固定模块和 gate 的所有 await 均在 ARMED/最终消费前结束，并再核控制状态；invokeScenario 只可从 ARMED 开始。在任何 await 前同步最终核验→CONSUMED→mint→ACTIVE→认领 invoke；真正调用 P.runProbe 的表达式前才增加 invokeCount。失败/未知/再次调用不返还任何认领位 |
| D4 / G4 请求边界 | 每次 wrapper 先记尝试，再核当前 control/时窗/新鲜性/撤销、同 plan/session、stop latch、方法/路径/进度及 base 值。只在触达内部合成下游函数时增 transport 计数；writer 边界再核。未知标记只置位、不清零；已知事实不回滚 |
| D5 / G5 identity | 初始 false，只允许固定 wrapper 对同一私有 G1 body 用固定 parseDeviceInfo 核完整型号后置 true。G1 首次合法 401 不置位；最终 200 且型号正确才放行 G2–G6。非 200、缺/错/不可解析型号先 latch，保留已有 G1 事实 |
| D6 / G6 evidenceRef | 原 session 创建时生成一次随机 UUID ref，并与同 plan/session 绑定；旧 inspect 返回形状不改。只在新安全摘要暴露该随机引用，结果层不得另造未绑定 ref；它不解析路径、不恢复能力，也不表示有真实文件 |
| D7 / G7 事件 | 旧 lifecycle/trace 不删除、不改义；新 profile 使用 §4.2 的独立闭式统一 trace，区分 PLAN 与 SESSION 的 seal，记录请求窗口组合事件，不反写旧 trace 或接受任意文本 |

invokeScenario 在消费前一次安全复制并完整校验 scenario，结构不合法以 `CONFIG_UNVERIFIED` 拒绝并终止旧模型，invoke/downstream 为 0；不原地修输入后继续。准备模块失败同样不产生执行权。开始执行后，即使 P 吞新码继续 loop，latch 也必须先于任何后续下游调用。
原 CR-1 工厂未 invoke 时的 0 计数/complete 行为保持；新 profile 不允许通过手工推进状态伪造已调用。既有 advancePlan 等低层接口不能成为绕过新 profile 唯一消费/invoke 的公开执行入口。

## 4. 闭式合成场景与可观察结果

### 4.1 scenario v1（不接收函数或真实配置）

冻结根形状为 `{schemaVersion, steps, events, requestFault}`，schemaVersion 为 `hk-ai-08-cr2-scenario-v1`。完整键/描述符/Proxy 防护、普通数据与不可克隆属性负例的快照口径沿原卡；不接受任意 getter/toJSON/iterator/模块路径或 adapter。

| 字段 | 固定形状/边界 |
|---|---|
| steps | 1–12 个步骤；每项 `{endpointId, attempt, outcome}`，endpointId 仅六个固定 ID，attempt 仅 1/2；不去重、补步骤、重排或修复 |
| RESPONSE outcome | `{kind:'RESPONSE', status, contentType, challenge, body}`；status 为 100–599 整数，contentType 字符串≤128，challenge 为 null 或≤4096 的合成 Digest 字符串，body 为 string/Uint8Array 的私有独占复制，每项≤该 plan 的 maxBytes。只构造所需 content-type/www-authenticate 响应头，不接受任意 header 对象 |
| FAULT outcome | `{kind:'FAULT', code, submission}`；code 仅 NETWORK/TIMEOUT/RESPONSE_ERROR/TOO_LARGE/FINGERPRINT_MISMATCH/REDIRECT，submission 仅 NOT_SUBMITTED/CONFIRMED_SUBMITTED/UNKNOWN；分别模拟确认未提交、确认已提交但未取得可确认的完整结果、提交状态本身不确定。后两者的请求结果均按未知处理。这些是明确的合成假设，不从错误码推导真实 TLS/设备事实 |
| events | 0–12 项，严格按 afterResponse 升序且每序号至多一项；`{afterResponse,kind:'CONTROL',control}` 或 `{afterResponse,kind:'RESOURCE_INVALIDATED'}`。afterResponse 为 1..steps.length；CONTROL 复用闭式 nowMs/fresh/revoked/approval，不携带新目标/配置 |
| requestFault | null 或 `{atWrapper,kind}`，atWrapper 为 1–12；kind 仅 METHOD_POST/HOST_SWAP/PORT_SWAP/PATH_SWAP/QUERY_SWAP/PIN_SWAP/TLS_CA/TIMEOUT_SWAP/MAXBYTES_SWAP/ORDER_SWAP。内部按固定合成替身扰动该次请求后交实际 wrapper 门禁，不接收调用者自选替换值 |

非法/不可读步骤、数组隐藏键/Symbol、无效长度/类型在消费前拒绝；合法脚本中的响应状态/故障和时窗变化由运行时处理，不能在预检时把故障“修成成功”。events 是固定边界的数据动作，不是任意 callback；不会改真实环境/ACL。全包总量受至多 12 个受限 body 约束。
requestFault 只能扰动当次 P 实际产出的请求私有副本，不能改变封存预期、端点 cursor 或验证器；ORDER_SWAP 改成另一个合法端点的路径，预期次序不动。不能用直接调用静态验证器或手工拼一套 probe loop 代替该真实 wrapper 路径。

### 4.2 合成入口结果

invokeScenario 只返回冻结的明确合成 envelope：

```text
schemaVersion: hk-ai-08-cr2-simulation-result-v1
scope: cr2-synthetic-fixed-probe-only
result: A 原闭式 DTO（仅合成投影，字段和 mapper 不改）
simulation: { invokeClaimed, invokeCount, identityConfirmed, recordCount, bytesWritten }
trace: [{ type: 固定枚举, endpointId: null或六ID之一, attempt: 0或1或2 }]
```

snapshot 也必须标明该合成 scope，只给状态/布尔/数量/随机 ref/固定 trace，不输出 config/session/raw。模拟投影内的 checks=true/COMPLETED 不是外部审批或真实 ACL 证明；**不能成为 executeControlledE1 的返回值**。
simulation 的 invokeClaimed/identityConfirmed 为布尔，invokeCount 仅 0/1，recordCount 为 0–12 安全整数、bytesWritten 为 0–12×262144 安全整数（这两项只计响应 body，不计报告）。新 trace 的 type 只允许：CAPTURED、CHECKER、CHECKED、PLAN_SEALED、GATE_PREPARING、SESSION_NEW、SESSION_PREPARING、SESSION_READY、EVIDENCE_READY、ARMED、CONSUMED、SYNTHETIC_MINT、SESSION_ACTIVE、INVOKE_CLAIM、PROBE_INVOKE、WRAPPER、BOUNDARY_REJECT、SYNTHETIC_DOWNSTREAM、SUBMISSION_NOT_SENT、SUBMISSION_CONFIRMED、SUBMISSION_UNKNOWN、RESPONSE、MEMORY_WRITE、MEMORY_READ、BODY_VERIFIED、IDENTITY_CONFIRMED、CONTROL_UPDATED、RESOURCE_INVALIDATED、LATCH、REPORT_SEALED、SESSION_SEALED、SESSION_CLOSED、COMPLETED、FAILED、UNKNOWN、INVALIDATED。生命周期事件用 endpointId=null/attempt=0，请求事件只用实际对应 ID/1或2；数组顺序为事件顺序，不包含任意 message 或时间戳。
旧 report/results 仅留该私有内存生命周期；每个 body 经同 session 的复制/实际字节比对后才交还 P，成功路径的原 report 先私有封存。close 按本 profile 的 volatile 合成策略清除私有 body/report，保留安全计数/已完成步骤和随机 ref；不可按 ref 下载或恢复已清内存。
失败/未知已 latch 后，不把 session 恢复 ACTIVE/SEALED 去强行追加报告；已有 body 与迟到的 P 结果可留 owner 的终态私有诊断，不能伪造 REPORT_SEALED/CLOSED。失败清理只尽力释放已知私有引用，不承诺 JS 字符串可靠擦除，也不冒称清理已完成。
合法投影由 owner 从自己的事实构造全新白名单 context 再调用原 makePublicResult，**不把 raw report 直接作为合法 context**。直接喂 raw report 只能是拒绝/脱敏负例，其安全失败不算成功路径接线通过。

## 5. 请求次序、停止与事实判据

1. 私有 allowlist 复制固定六端点，逐请求校验精确 GET/path/query/顺序，不允许从 scenario 换目标或修改 profile。P 请求没有 method 字段时仅代表固定 P 的 GET；额外 method、query/path 变更按门禁拒绝。
2. host/port/pins/timeout/maxBytes/非 undefined CA 等 base 与封存值不一致按 `PLAN_INVALID`；方法/路径/查询/次序越界按 `REQUEST_OUT_OF_SCOPE`。旧 base 的 `ca:undefined` 不具信任模式意义，不允许 CA/system fallback。
3. 每端点最多首次 401 的唯一 Digest 重发，总下游≤12；P 的全局 challenge 语义保留，不改为只有 G1 能 401。Authorization 由固定 P 内部产生，原值不进入日志、场景或公开摘要。
4. wrapper 获准进入合成下游时才递增 transportInvocationCount、第一次触达某 ID 才计 logicalEndpointsAttempted；收到完整合成响应计 confirmedResponses。wrapper 被 latch 拒绝只增加 wrapperAttemptCount，其他端点仍 NOT_ATTEMPTED，不能照抄旧 results 的循环进度冒充实际调用。
5. 每个响应先经同 session 内存写入/字节回读验证，再进行适用的 G1 identity/固定 content-type 判定并返给 P；401 与 G2–G6 非 200 沿 P 既有顺序/语义，不因缺 content-type 被错误扩成全局 fatal。错误状态/无效 G1 同样保留已知响应事实。
6. events 在对应完整响应的私有保存/身份处理后、下一次 wrapper 前应用；expired/revoked/fresh=false 或 RESOURCE_INVALIDATED 会拒绝后续下游。非确定/终态后不复位，不能以新 control 恢复旧计划。
7. 私有 `firstTerminalCode` 保存首个终止原因；非终止的 G2–G6 HTTP 失败只记端点，不抢占后来的 fatal。结束仍有失败且无更早终止原因则 E17 `PROBE_FAILED`，不补发。
8. 未知提交为首因时用 `REQUEST_OUTCOME_UNKNOWN`；若先有另一终止原因，保留该原因但 status 必须 UNKNOWN、requestOutcomeUnknown=true。晚到响应或旧 loop 不清该位，不假设设备未收到。此处记录的均为合成事实，不写成实际 GET。
   FAULT 的三种 submission 分别登记为固定 trace，并全部保留已发生的下游调用数，不自动认作完整响应。UNKNOWN 置未知；CONFIRMED_SUBMITTED 仅证明提交、该 FAULT 未给出可确认完整结果，也必须 UNKNOWN+黏性 true（含 TIMEOUT/RESPONSE_ERROR），不能按“提交已知”推成“结果已知失败”。NOT_SUBMITTED 在没有先前未知事实时按已知 fatal 归 PROBE_FAILED，也不能把已调用下游的计数清零。上述未知按 E14，已有首因仍遵守本条前段，不覆盖为后来的普通 fatal。
   私有 inFlight 位须在进入合成下游后、等待其结果前设置，并在处理该次响应/故障前固定执行一次 `await Promise.resolve()` 微任务边界，使外部 setControl/invalidate 在途负例确定可达；不能只依赖 P 的 await transport（wrapper 可能已同步保存完响应）。该 yield 位于唯一消费/认领之后，不破坏 D3 的同步段。在该窗口使结果不确定时置黏性未知；响应间事件与在途变化分开测试，不能因为脚本稍后返回 body 就抹掉当时已登记的不确定性。
9. body/write/read/报告封存/close 的运行期故障按 `EVIDENCE_WRITE_FAILED` 终止；准备故障用 `EVIDENCE_GATE_FAILED`，失效会话用 `EVIDENCE_GATE_INVALID`。内部 cleanup 状态可以私有保留，但必须在设置终态前映射固定公共码，不让二次异常覆盖首因或清零计数。
10. 全六端点成功、所有合成 checks 已证、唯一 invoke、所有响应/私有封存和 close 完成、无终态错误/未知，才允许内层 COMPLETED/OK；否则保持失败/未知及事实。完成也不放行 CR-3/E1。

## 6. 精确文件与兼容范围

### 6.1 实施分支可修改的五个既有文件

| 路径（均为仓库相对） | 仅允许的变更 |
|---|---|
| `tools/hikvision-e1-controlled-runner/private-plan.mjs` | 单一 owner 重定位、固定 profile、上述私有 invoke/wrapper/事实/身份与 trace |
| `tools/hikvision-e1-controlled-runner/controlled-runner.mjs` | 兼容 facade，保留原 createSyntheticController，再导出新 createSyntheticProbeController；不返回秘密 |
| `tools/hikvision-e1-controlled-runner/evidence-session.mjs` | 原 createSyntheticEvidenceModel 的兼容 facade；既有纯内存行为保持 |
| `tools/hikvision-e1-controlled-runner/README.md` | 只追加 CR-2 范围/API/限制，不改 CR-1 历史正文 |
| `docs/evidence/hk-ai-08-node-windows-acl-integration/README.md` | 原 151 行 CR-1 证据原字节保留，只追加 CR-2 当前证据与来源，旧哈希/计数不改写 |

### 6.2 可新增的九个文件

以下九个文件均位于 `tools/hikvision-e1-controlled-runner/`：`probe-binding.mjs`、`test/probe-integration.test.mjs`、`vendor/probe-558b9c8/VENDOR-SOURCES.json`，及同一 vendor 子目录的 `allowlist.mjs/digest.mjs/http.mjs/probe.mjs/redact.mjs/report.mjs` 六份原字节。
VENDOR-SOURCES 的来源/blob/大小/SHA-256须与原卡和固定对象逐项一致；不得取 CLI、fs-safe、证书或原测试。以上共九文件，不是任意 vendor 目录白名单。

### 6.3 必须零差异

**index、windows-acl-bridge、public-result、testkit、原三份 CR-1 测试**均冻结原字节；旧 checker、W、探针原路径、A/B/原卡/旧验收提交、依赖清单/锁文件、业务代码/HTTP/UI/Provider/小程序/main 均不改。
不得为让新测试通过而修改旧 53 顶层 oracle。实际若需要第六个既有文件、新文件、新 API 或变更此契约，带具体事实/差异交 Codex，不由 Harness 自行扩大。

## 7. 实施顺序与验收

实施获准后按同一新分支线性追加两类提交：先完成 owner 重定位且原三文件套件不改全通过，再接九新增文件和新编排/场景测试。两步是实现顺序，不新增中间业务批准门；失败在允许范围内修复，不自批最终验收。保留每次真实结果和源码版本。

- 首选既有 Node v24.22.1；已有 v22.22.2 可作为另一个**候选实测运行时**，先记录版本/参数支持再用相同显式命令，不预称兼容已证。其他版本先报告，不自动安装/升级/换隔离模式。跨 OS/版本结果单列，不把旧 Linux 262/262 搬作本机通过。
- 最终命令只显式列原三 test 加 `test/probe-integration.test.mjs`，`--test --test-isolation=none --test-reporter=spec`；不跑 npm/后台/HTTP/旧 probe 套件。原三文件结果应完整全通过，实际新节点/父ID/负控各报，不预填总数。
- guard 加载前安装并预载固定新模块树，之后才安装运行期 fs guard；复用原 testkit 不改字节，逐槽正控、不转发 target canary、累计基线、成败零违规与精确恢复重做。列实际槽名/数，不套 232，加载期 fs 不在该零读声明内。
- 仅检查 NODE_OPTIONS/NODE_PATH 存在性、不读值或清空；任一存在先停止项目执行。若需例外，提交新完整树/哈希/唯一命令/OS/Node 给 Codex 独立技术核验，不能沿用 CR-1 例外或本机 CLI 自批。
- 所有普通输入每独立场景完整 before/after；属性/不可克隆负例沿原卡 descriptors/ownKeys/引用与 getter/trap=0 口径，错误码、状态、写/调用集同时断言。成功路径也核 guard。

| 必测组合 | 固定未来判据（非本轮结果） |
|---|---|
| 六端点成功 | 唯一 invoke；六逻辑/六下游/六响应、同 session 六 body verified、合成 COMPLETED；真实网络和文件调用 0 |
| 首次 401 与上限 | G1 401→200 下游7；各端点合法一次401最多12；二次401拒绝且不多发 |
| G1 最终非200/缺错型号 | 保留已发生 G1 请求/响应，G2–G6 下游0；旧 P 即使继续调用 wrapper 也只增加被拒尝试 |
| G2–G6 非200 | 沿原 P 继续既有逻辑序列，最终 PROBE_FAILED；不把所有非200变fatal、不重试整轮 |
| 字段/路径/方法/次序篡改 | 实际 wrapper 拒绝该次下游，固定码/终态/0新增调用；不能只测静态 helper |
| 撤销/到期/资源失效 | 首请求前和响应间分别拒绝；无未知清零、无计划恢复 |
| 写/读/报告/close失败 | 已知响应与计数保留，后续下游0，无重跑或安全成功假象 |
| 提交与结果未知分离 | 三种 submission 逐场景覆盖；CONFIRMED_SUBMITTED 的 TIMEOUT/RESPONSE_ERROR 仍 UNKNOWN+黏性true；NOT_SUBMITTED 不清零下游计数，不清先前未知，不声称远端未执行 |
| 并发invoke/手工消费绕过 | 同计划只有一个认领和实际P调用；失败/未知不返还，新工厂无手工complete接口 |
| 正向DTO与敏感负例 | 有效私有事实投影成功；raw报告仅作拒绝负例，closed输出不泄目标/hash/header/body/原error |
| 可证伪 | artifact副本单patch禁G1/latch、禁writer后停止、放宽request gate/DTO或失效counter时精确失败；负控不得转发系统函数，原文件不改/或逐字节恢复并实证 |

A T14–T20、B NA09–NA15 按源子场景逐项映射，不省略；真实 Node/native/ACL/文件 I/O/现场授权部分继续 BLOCKED，不用 skip/todo/deferred 冒充 PASS。不承诺同用户恶意代码、特权管理员、全局原子撤销或完整 TOCTOU 防护。

## 8. Harness 接续及停止点

先在原前置文档分支追加 §1 三项勘误（只改报告，不改 inventory），普通推送并核完整 SHA；该非强推理回写不与实现混成一个提交。复杂技术取舍已由本文冻结，不再让执行者自行选择 getter、writer port 或另一套 plan。
本轮没有新派单编号，本文只是 Codex 技术交付。后续若用户把 CR-2 执行指令投递到 Harness，必须引用本文最终完整 SHA、原卡及代码基线，只做 §6/§7 范围，完成停 **Stop-CR2** 交 Codex 独立代码/证据复审，不自批或进入 CR-3。
各线继续只追加提交、普通显式 refspec push、ls-remote 核验，不 amend/rebase/reset/squash/force/merge/cherry-pick，不改全局 Git/TLS/代理/安全设置，不推 main。会话权限按实际平台规则处理，不能用报告中的完全访问自述替代当前权限。
本地 Windows ACL 工作只等既有回报、不重派；用户取消隔离网络前置保持有效。S4、预签约 S2–S6、H4-c C2/C3、07B执行、集成/合并、HTTP/UI、真实支付/设备/生产云及部署上线不因本文放行。本轮实际代码实现、测试/guard/项目CLI/PowerShell预检、业务网络和设备调用均为0；Git取件/查询及文档交付另计。
