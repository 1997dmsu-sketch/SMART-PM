# HK-AI-08 E1 受控配置绑定设计（2026-11-23）

- 状态：**P0-A 设计候选，待独立复审；未实现、未测试、未执行 E1/E2。**
- 本文作者只负责新增本文；根 Codex 可另加独立复审证据并按授权正常交付。起点 `3bb0b95df351ef357aedff6a21a275a19b92b6f2`，分支 `docs/hk-ai-08-e1-config-binding-design`。
- 用户授权本轮 P0 文档设计与静态复核；不等于实施、真实配置读取、设备连接或证据目录实际创建授权。
- 目标：把“离线核对过的数据”与“随后唯一一次受控 E1 使用的数据”绑定在同一进程私有生命周期内，不以引用或 PASS 布尔代替真实性。

## 1. 固定来源、事实与未验证边界

下列链接固定完整 SHA；行号只定位该树，不指向会前移的分支。源码事实与未来方案分开。

| 输入 | 完整 SHA | 只读定位 |
|---|---|---|
| 离线核对器 | `31f20c9a372c447f142312f6e95e0400372f9ee8` | [check-config.mjs:44–89、115–166](https://github.com/1997dmsu-sketch/SMART-PM/blob/31f20c9a372c447f142312f6e95e0400372f9ee8/tools/hikvision-offline-config-checker/src/check-config.mjs#L44-L166) |
| 批准探针 | `558b9c864a4b820e397336200758b143556a4d87` | [probe.mjs:46–153](https://github.com/1997dmsu-sketch/SMART-PM/blob/558b9c864a4b820e397336200758b143556a4d87/tools/hikvision-probe/src/probe.mjs#L46-L153)、[CLI:32–86](https://github.com/1997dmsu-sketch/SMART-PM/blob/558b9c864a4b820e397336200758b143556a4d87/tools/hikvision-probe/cli.mjs#L32-L86) |
| E1/E2 准备 | `ba93485e07fa5ec5ab83dc27ea2943200d38a1f6` | [准备包:27–37、53–101](https://github.com/1997dmsu-sketch/SMART-PM/blob/ba93485e07fa5ec5ab83dc27ea2943200d38a1f6/docs/tasks/HK-AI-08-E1-E2-HARNESS-PREPARATION-2026-11-21.md#L27-L101) |
| Windows ACL 候选 | `3bb0b95df351ef357aedff6a21a275a19b92b6f2` | [README:49–65](https://github.com/1997dmsu-sketch/SMART-PM/blob/3bb0b95df351ef357aedff6a21a275a19b92b6f2/tools/hikvision-windows-evidence-preflight/README.md#L49-L65) |

| 代码/文档事实 | 本文冻结的未来提案 | 本轮未验证 |
|---|---|---|
| checker 只返回格式/匹配结果；`approvalRef` 非空不等于授权真实，`allowRead` 必须 false（checker:72–73、158–165） | 外部审批证据核验与 checker 分层；核对通过也不能自行执行 | 真实审批、目标、账号、证书材料未读取，不能填 READY |
| checker 原串比型号；probe 对预期/设备型号 trim（checker:158–160；probe:62、134–138） | runner 额外要求预期型号无边界空白；不修改 checker，不声称旧 probe 原串比较 | runner 兼容性门尚未实现；设备返回解析能力未验证 |
| 旧 CLI 读取 env/CA、补默认值，先 runProbe 后创建输出目录（CLI:32–65、75–86） | 新受控入口不调用旧 CLI；先保护实际写路径再创建可联网 transport | 旧 CLI 不能充当本方案的配置绑定或 Windows 证据保护实现 |
| 旧 probe 仅对既有 FATAL_CODES 中止；新码及 G1 非 200 的 HTTP_STATUS 可能被捕获后继续（probe:24–38、125–153） | 新门禁必须具有不可复位 stop latch 和独立 G1 identity gate；拒绝后任何后续 wrapper 调用均不进入实际 transport | wrapper 与旧编排组合尚未验证 |
| 旧报告含端口、hostFingerprint、原错误；旧 CLI 打印报告路径/错误（probe:178–224；CLI:88–110） | 新公开结果仅闭式白名单；旧报告/原始响应只归私有证据会话 | 旧报告不能直接序列化为新公开结果 |
| ACL PASS 只属合成目录；未证明实际 Node 写入/运行期保护（ACL README:51–64） | 必须等待 P0-B 实际 Node evidence gate 及 Windows 运行证据 | PowerShell 结果、Node 写入保护、E1 准入均不得互相冒充 |

准备包:33–37 已取消隔离网络前置；本文不恢复 VLAN、独立网络或等价证明要求，不改变单目标、六 GET 与禁止扫描边界。

## 2. 受控入口与一次捕获

未来入口暂名 `executeControlledE1`，只用于单次 E1；不是 HTTP、服务 Provider、小程序或可公开重放接口。
执行前须有另案实施授权和 E1 单独书面授权；本文没有真实执行命令、设备值或秘密注入示例。

1. 操作人从既有有权方提供的受控来源交付一次完整配置包和审批原始材料；不从聊天、仓库扫描、历史计划任务或设备发现自动找回。
2. 在同一进程启动时固定工具版本及模块引用，核对批准取件内容；不接受运行期插件替换、热加载或从 public planRef 重新取包。
3. 捕获受控来源一次，复制普通数据到私有记录；凭据与批准指纹也在此时解析/复制一次，不把文件路径或秘密引用留作执行时再读取的入口；E1 包禁止 CA 字段/路径，不读取 CA 文件。
4. 独立核验外部审批来源、有权性、E1 范围、时间窗、撤销状态与受控 target snapshot；机制依实际材料另案落实，不凭输入自报真值。
5. 从同份私有捕获记录产生 checker raw input 副本，明确 `allowRead=false`；只含 checker 闭式 schema，不把凭据/指纹塞进 checker。
6. 调用固定 checker 库得到结果；raw input、副本和结果留在私有会话，不能仅保存 PASS 再丢弃原数据来源。
7. checker PASS 后按 §3 固定规则派生 runner config；通过额外兼容性门、固定 TLS 配置及 P0-B 接口约束后封存 privatePlan。

`approvalRef`、人工录入的 `approvalValid=true`、操作者自生成签名/哈希或 `sameConfigBound=true` 均不证明外部审批真实。
当前没有已实现的审批令牌、签名服务或新审批组织；不能用本文创造它们存在的事实。缺有权方原始材料/有效性核验方法即 `APPROVAL_UNVERIFIED`。
源包读取失败、捕获期间发现变更/不一致、审批 target 与配置不一致即终止；不能重新读一次后悄悄替换成“新正确值”。重新准备必须新授权范围内新建会话。

## 3. privatePlan：稳定字段与规范化

只在闭包/私有注册表保存 privatePlan 原对象；外部不能构造、反序列化、克隆或通过 ID 恢复被认可的能力。
普通记录/数组递归冻结；可变字节材料须私有独占复制、不导出引用，不能声称 `Object.freeze` 自动使 Buffer 内容不可改。
禁止将 plan、配置、副本或原异常传给任意 logger、`toJSON`、自定义 getter/iterator；输入闭式校验沿 checker 的安全普通数据边界。

| 字段组 | 私有稳定内容/规则 | 允许外发 |
|---|---|---|
| `planVersion` / `toolSet` | 设计版本、固定 checker/probe/gate 实施版本与加载引用；任何变化需重新准备 | 已批准工具 SHA 可公开；不输出配置摘要 |
| `authorization` | 已核验审批证据、E1 scope、批准 target 原始快照、起止时间及当前状态读取方式 | 非敏感审批引用/状态，不输出原始材料 |
| `checkerBinding` | 同一次 raw input 复制品、checker 结果与本次捕获身份关联 | checker 固定布尔/计数；不是执行授权 |
| `target` | 单 `deviceRef`、规范化 host、数值端口、单元素 host/port allowlist、完整 expectedModel | 不输出实际地址/端口、可反推摘要 |
| `tlsAndAccount` | 一次捕获的账号口令、1 或 2 枚已线下批准的固定指纹、固定 `fingerprint-pinned` 模式、最小权限材料引用 | 不输出账号、口令、证书、指纹或其摘要 |
| `bounds` | 明确 timeoutMs/maxBytes、六端点复制品、Digest 挑战上限；禁止执行期 fallback | 逻辑端点数量与固定版本可公开 |
| `outputBinding` | P0-B 策略版本、批准执行身份与输出保护约束；不含尚未创建的 session/目录/handle | 公开策略版本；不输出私有资源定位 |
| `identity` | 随机 planRef 及同进程私有对象身份；不可重新绑定 | 随机引用，不具备授权或加载能力 |

状态/消费位、stop latch、端点进度、计数及 gate 后返回的真实 evidenceSession 属于另一个私有 `runState`/注册表，通过对象身份绑定 sealed core；它们不是可改写配置的通道。
session 创建后只准在私有注册表写入一次 `(sameCore, evidenceSession)` 关联，不回填冻结 core；reportPair 的报告/证据也必须绑定该 sameCore 与会话，不接受另一个引用替换。
privatePlan 的配置字段始终不变；生成给 probe 的执行视图只把动作门设为 true，其余值来自同一封存对象，不能用通用 merge/override 接口覆盖。
执行视图只在消费后由私有闭包从冻结 core 派生一次，调用方不能传入 `executionConfig`；checker snapshot 的 `allowRead=false` 永远不改写。

规范化冻结如下；规范化仅发生一次，后续 transport 不再重新解释原始字符串。
- host 只按 checker 的 trim/lower 语义；非 ASCII 主体、非法 IP/DNS、数量/目标不匹配先由固定 checker 拒绝；不解析 DNS 或把两个地址“等价化”。
- port 将已通过 checker 的十进制字符串转成 1–65535 整数；allowlist 各恰一个值，不能用旧 parseAllowedPorts 的缺省 443/8443、去重/过滤挽救坏输入。
- 型号仍须批准原串与 candidate 原串相等，且 `expectedModel.trim() === expectedModel`；两边同带空白虽可 checker PASS，也在 runner 以 `RUNNER_MODEL_INCOMPATIBLE` 拒绝，零 transport。
- 接收设备型号解析/trim 继续按批准 probe:132–142；不把该行为写成原始响应字节逐字比较。需要更严比较须另案变更，不能偷偷放宽。
- timeoutMs/maxBytes 必须显式为 SafeInteger，分别限于 `1..10000` 毫秒和 `1..262144` 字节，可按批准 scope 更严格但不得放宽，执行值与批准 plan 原值一致；缺失、非整数或超限均按 E07 拒绝，零 transport，不取 fallback。
- 上界来自 [http.mjs:25–26](https://github.com/1997dmsu-sketch/SMART-PM/blob/558b9c864a4b820e397336200758b143556a4d87/tools/hikvision-probe/src/http.mjs#L25-L26)；源码默认值只是批准边界依据，不能作为缺字段的自动补值。本 E1 仅 `fingerprint-pinned`，必须有 1 或 2 枚已线下批准的有效 pin，空 pin、CA/system/mixed 模式或 CA 字段/路径均按 E07 拒绝，零 transport。
- 不再读 env、CA 文件、默认证书或 defaults；不允许空值切换信任策略，旧 probe 支持 CA/system 的通用能力不能扩为本 E1 的准入范围。
- 指纹解析及纯 pin TLS 行为依据 [http.mjs:28–59、129–148、189–209](https://github.com/1997dmsu-sketch/SMART-PM/blob/558b9c864a4b820e397336200758b143556a4d87/tools/hikvision-probe/src/http.mjs#L28-L209) 固定；该模式不同时校验系统信任链/主机名/有效期，证书过期按原探针仅告警，不虚称更强校验。
- `allowRead=false` 保留在 checker 副本中；私有执行状态仅在 §4 的 ARMED→CONSUMED 允许一次 live 动作，不修改原副本或其它 plan 字段。

## 4. 状态机、有效期与单次消费

| 状态 | 进入条件 | 允许动作/后继 |
|---|---|---|
| `CAPTURED` | 一次捕获完整，尚未声称审批/匹配通过 | 核验外部证据及 checker；失败终止 |
| `CHECKED` | 审批核验与 checker PASS | 执行兼容性门、私有规范化/封存；不得联网 |
| `SEALED` | 稳定字段封存、固定代码已核对 | 只调用 `prepareEvidenceGate(privatePlan)`；不创建 live transport |
| `EVIDENCE_READY` | B 返回本进程认可、绑定同 plan 的 evidenceSession，实际写路径预检完成 | 当前授权/时间/撤销/session 再核；未证明就停 |
| `ARMED` | 上述条件在消费边界仍有效，执行人作本次明确动作确认 | 只准对同一私有 plan 进行一次消费 |
| `CONSUMED` | 同步检查未消费并置 consumed；在第一个实际请求前完成 | 调用固定 runProbe 一次；不能回到 ARMED |
| `COMPLETED` | 本次结果与证据都按约定完成 | 封存、交独立复审；不自动进入 E2 |
| `FAILED` / `UNKNOWN` | 已知失败/请求或写入结果不确定 | stop latch 永久置位，不再消费/补发；精确报告已发生事实 |
| `INVALIDATED` | 收到受控变更、撤销、到期、缺证、gate 失效 | 不可恢复原 plan；只可另案新会话 |

未获执行人明确确认时不能自动 ARMED；确认对象必须是当前私有会话/批准范围，不能把无目标裸 `true` 当授权。
时间使用带时区批准起止和受控时钟，`now < windowStart` 或 `now >= windowEnd` 均拒绝；无可靠时间、时钟回退/跳变无法判断即停，不发请求。
在 evidence gate 的异步准备后必须重新核验当前授权；不能沿用准备前的“曾经有效”。没有可确认当前有效/撤销状态的受控流程即 BLOCKED。
收到受控重配置请求、撤销通知或权威版本变更（目标/端口/白名单/model/pins/账号/代码/输出策略），立即将现有 plan 标为失效；不在既有 plan 内“修一下继续”。
封存后外部 env/文件变动若未通过受控状态通道通知，本进程不重读、不承诺即时发现，私有 snapshot 保持原值；不能把无法观察的变化写成“已检测并失效”。当前权威状态新鲜性无法确立即停止。
运行中收到撤销/急停或权限失效信号，立即 latch、取消可取消的在途操作、拒绝后续 transport；已发请求不能撤销为 0，也不声称远端处理已取消。
没有持续外部撤销信息时不声称全局原子获知撤销；已知过期/已撤销/状态未知时明确拒绝，不存在“虽可能已撤销仍允许开始”的降级分支。
禁止“重读”的对象是目标配置、秘密、pins 等封存输入；CA 路径根本不接受/读取；时钟、撤销/kill switch 与 evidenceSession 当前权限/资源身份是明确允许核验的活控制状态。
活控制状态只能继续允许或停止原 plan，不能携带新目标、端口、秘密或覆盖参数；没有可靠新鲜状态证据即停止，不新建 HTTP 审批服务。
同进程并发消费者在无 await 的检查/置位临界段只有一个取得一次消费权；失败、超时、崩溃或未知都不退还，不以重启后 planRef 找回重试。
最终检查与 CONSUMED 置位必须在同一 event-loop turn、无 await 的临界段完成；之后才 mint 唯一 live transport 能力，B 的 READY→ACTIVE 也只能在消费后发生。

## 5. P0-B evidence gate 与执行次序

共同接口仅是未来契约：`prepareEvidenceGate(privatePlan)` 返回私有 `evidenceSession`，不是 path/ref/PASS 布尔，也不由本文实现。
B 的独立文档 ID 为 `docs/tasks/HK-AI-08-NODE-WINDOWS-ACL-INTEGRATION-REVIEW-2026-11-23.md`；未来实施卡必须同时固定 A/B 两份实际交付完整 SHA，不能拿可变分支 tip 代替组合审查。
B 必须绑定同一个私有 plan、批准 target、当前执行身份、工具版本、新目录/文件能力及生命周期；被克隆/跨进程/绑定另一 plan 的 session 不认可。
必须先建立保护、用实际 Node writer 在实际受控写路径预检并核验 ACL/文件身份、完成合成写入/读回/失败处置，再返回 EVIDENCE_READY。
独立 PowerShell 合成 PASS 或另一目录上的 Node 测试不能替代该 gate；Windows 本机结果缺失、句柄/身份保证无法成立或 B 尚未实现时，保持 BLOCKED。
Windows ACL 工具成功后会清理本次合成 GUID 目录（ACL README:9、13、52）；其 JSON/evidenceRef 不是仍存活的真实输出目录、handle 或 session 能力。
prepareEvidenceGate 必须创建本轮新的私有受控资源；不得由旧 PASS/public ref 铸造 evidenceSession，旧报告最多作为前置证据。

顺序冻结：捕获→外部核验→checker→兼容门/封存→B 建保护与实际写路径预检→消费边界重核→单次消费→创建唯一 live transport 能力→调用 runProbe 一次。
所有 preflight 写失败都在网络能力创建之前处理，实际 transport 次数为 0；不能先 GET 再检查能否安全存原始响应。
gate 未验证前，不分配 DNS/socket/HTTPS agent 等 live 网络资源；纯模块取件/静态加载不等于允许设备访问。
每次请求入口再核同 plan/session、未 latch、当前授权/时间及六端点进度；gate 失效必须拒绝后续实际调用。
响应体只交同 evidenceSession 私有 writer；写入/回读失败立即 latch。已经 GET 后写失败报告 `FAILED` 或 `UNKNOWN`，不伪称“零网络”，不自动重发或盲删目录。
若 B 不能安全提供实际 writer 能力，设计到此停住；不能退回旧 CLI 或直接 `fs.writeFile` 逃过门禁。

## 6. 固定 probe/transport 适配与外发边界

受控入口直接组合已固定的 `runProbe` 与被门禁包裹的 transport，不启动旧 CLI、不启动子进程、不把 plan 传给任意 adapter。
同一个私有 plan 导出一次执行 config；仅执行动作门转为 true，其余字段只取封存值，绝不重新读 env/pins/defaults 或从公开 ID 重建，不加载 CA。
运行期 wrapper 校验传入 base 与封存值一致；不得接受 probe 调用方偷换 host/port/pins/timeout/maxBytes、外部 agent 或额外配置；旧 probe base 的 `ca: undefined` 不具备信任配置含义，任何非 undefined CA 值一律拒绝。
固定六逻辑端点按 [allowlist.mjs:11–18、75–99](https://github.com/1997dmsu-sketch/SMART-PM/blob/558b9c864a4b820e397336200758b143556a4d87/tools/hikvision-probe/src/allowlist.mjs#L11-L99) 的 GET、路径/查询串/顺序；没有 discovery、扫描、重定向、人员/照片写入或其它端点。
401 仅按 probe:102–115 每端点一次 Digest 挑战重发；同一逻辑端点重发不能换 plan/目标。六逻辑 GET 不等于六次物理请求，实际最多十二次请求尝试，提前停止可更少。
除该认证交互外不重试端点/整轮；仅 G2–G6 的其它非 200 按既有 probe:21、125–129 记录失败并继续既有逻辑序列，不新增恢复请求或放宽判据。
G1 有独立 identity gate：wrapper 解析同一私有响应 body，复用固定 probe 的 `parseDeviceInfo`，只有最终 200 且完整型号可解析、trim 后等于已通过 runner 兼容门的 expectedModel 才设置私有 `identityConfirmed`。
G1 合法首次 401 保留唯一 Digest 挑战重发；最终非 200、空/错型号、解析异常或无法核验均先 latch，禁止 G2–G6 的实际 transport。不能把“旧 loop 已走到 G2”当型号已验，也不接受调用方自报 identityConfirmed。
上述失败已发生的 G1 请求按实际计数保留，不能称总请求 0；型号未证即使原 probe 吞异常继续调用 wrapper，也不再产生后续实际请求。
新 gate/授权/写入/配置绑定错误先置不可复位 stop latch，再抛固定内部错误；旧 probe 即使吞掉新码并继续循环，也只能产生被 wrapper 拒绝的尝试，不能产生后续实际请求。
记录 `wrapperAttemptCount`、`transportInvocationCount`、已确认响应数和 `requestOutcomeUnknown`；实际调用计数不等于设备已收到/完成，连接或响应不确定时不得精确断言服务器处理次数。
旧 `runProbe` 的 report/results 完整留在私有 evidenceSession；不直接 JSON.stringify/打印/上传，原响应/认证头不进入公开摘要。

公开结果只准：固定 schema/scope、随机 planRef/evidenceRef、闭式 status/code、固定端点 ID 的状态类、上述计数及必要布尔。
禁止外发实际 host/port、目标哈希/hostFingerprint、证书/指纹/CA、账号口令、请求头、原始响应、原错误 message/stack、文件路径或能反查它们的派生 digest。
随机引用不授权、不解析成路径、不作为持久恢复入口；同进程丢失私有能力即不可恢复执行。内存释放尽力进行，不能保证 JS 字符串被可靠擦除。
对外错误由固定映射生成；未知异常也只给固定码。证据写失败不能通过向 stderr 打原异常“补日志”。

外发对象冻结为以下闭式形状；这是未来契约示意，不是本轮产生的执行结果：
```text
schemaVersion: controlled-e1-binding-v1
scope: single-authorized-e1-read-only
planRef: 随机引用或 null
evidenceRef: 随机引用或 null
status: BLOCKED | COMPLETED | FAILED | UNKNOWN
code: OK | §7 固定分类
checks: { checkerPassed, runnerCompatible, evidenceGateVerified, singleUseConsumed }
counts: { logicalEndpointsAttempted, wrapperAttemptCount, transportInvocationCount, confirmedResponses }
requestOutcomeUnknown: boolean
endpoints: [{ id: 六个固定 ID 之一, state: NOT_ATTEMPTED | OK | FAILED | UNKNOWN }]
```
所有 checks 仅描述本轮实际已证事实；不能出现 `approvalValid`/`sameConfigBound` 由输入自证的字段，或以缺省 true 填未验证项。
`logicalEndpointsAttempted` 只统计真正进入实际 transport 的不同白名单 ID，范围 0–6；wrapper 被 latch 拒绝的循环不增加它。
`confirmedResponses` 只统计实际收到并确认完整响应的数量；未知传输不补成功，不从本地计数推算设备业务处理次数。
状态 BLOCKED/FAILED/UNKNOWN 都不能对外声称 E1 通过；COMPLETED 只表示本轮结束并有证据，不替代独立 E1 能力复审或 E2 授权。

## 7. 错误矩阵（未来 runner 的固定分类，非现有 API 新增码）

所有失败均保留本次状态/计数，公开错误不含输入值；下表“0”只在确实未进入实际 transport 时声明。

| ID | 场景 | 固定分类 | 实际 transport/后续动作 |
|---|---|---|---|
| E01 | 缺受控源、重复捕获、包结构非法 | `CONFIG_UNVERIFIED` | 0；终止 |
| E02 | 外部审批真实性/当前状态无法核验 | `APPROVAL_UNVERIFIED` | 开始前 0；运行中按实际计数停止 |
| E03 | 未到窗/到期、撤销/急停 | `AUTHORIZATION_INVALID` | latch；不补发 |
| E04 | checker 非 PASS | `CONFIG_REJECTED` | 0；保留私有 checker 结果 |
| E05 | 型号边界空白导致 runner 不兼容 | `RUNNER_MODEL_INCOMPATIBLE` | 0；不改 checker |
| E06 | 目标/TLS/工具/字段被换、public ref 伪造 | `PLAN_INVALID` | 0 或既有计数；latch |
| E07 | 必需凭据/bounds 缺件、bounds 非 SafeInteger/越界/不符批准原值、空 pin、非 1–2 枚批准 pin、CA/system/mixed 模式或 CA 字段/路径 | `CONFIG_UNVERIFIED` | 0；不补默认值，不读取 CA |
| E08 | B 未实现、Windows 结果缺失、实际 writer 未证 | `EVIDENCE_GATE_UNVERIFIED` | 0；不创建 live transport |
| E09 | preflight 写入/回读/清理失败 | `EVIDENCE_GATE_FAILED` | 0；不复用失败目录 |
| E10 | 错 plan/session、session 失效 | `EVIDENCE_GATE_INVALID` | latch；按实际计数 |
| E11 | 第二消费者/重放/重启后 ref 恢复 | `PLAN_CONSUMED` | 不新增实际调用 |
| E12 | 端点/顺序/方法/查询串或认证次数越界 | `REQUEST_OUT_OF_SCOPE` | 拒绝该次实际调用并 latch |
| E13 | TLS/网络等批准 probe fatal，或 G1 最终非 200/型号缺失、错误、不可核验 | `PROBE_FAILED` | G1 已调用数保留；latch 后 G2–G6 实际调用为 0，不重跑 |
| E14 | 请求已开始后超时/响应结果未知 | `REQUEST_OUTCOME_UNKNOWN` | UNKNOWN；不假设远端未收到 |
| E15 | GET 后私有证据写入失败 | `EVIDENCE_WRITE_FAILED` | 非 0 既有调用；停止、封存待复核 |
| E16 | 原错误/报告不能安全映射或内部异常 | `INTERNAL_ERROR` | latch；不外发异常正文 |
| E17 | 固定逻辑序列结束仍含 G2–G6 非 200 端点 | `PROBE_FAILED` | 仅这些端点可按批准行为记失败并继续；不补发/重跑 |

## 8. 合成验证矩阵（未来实施验收，不是本轮测试结果）

每个失败场景独立保存全量输入快照并 deepEqual；假 transport/假 writer 带实际计数与正控，不用静态 grep 代替运行时断言。
所有数据/CA/凭据/地址仅合成；不调用旧 CLI，不运行真实 stdin/设备/网络。公开输出逐字段白名单和敏感哨兵负例必须可证伪。

| ID | 合成场景 | 必须证明 |
|---|---|---|
| T01 | 完整合成包正常核对/封存 | 一次 source 捕获、raw 副本相同来源、checker false，未执行 |
| T02 | 审批 ref/Boolean/自生 digest 单独存在 | 不构成真实性，0 transport |
| T03a | 封存后外部 env/原配置文件/输入对象被改，未收到受控变更通知且权威状态仍可确认 | 不读取第二次；私有 snapshot 精确不变，不声称检测外部变更，也不能切换目标 |
| T03b | 收到受控重配置/权威版本变化或当前状态新鲜性未知 | 现有 plan 明确 INVALIDATED/BLOCKED，不创建新的实际 transport、不原地换配置 |
| T04 | public planRef/克隆对象/另一进程对象 | 不能换取私有执行能力 |
| T05 | host trim/lower、显式端口与单元素白名单 | 严格按 checker 派生；无 defaults/去重兜底 |
| T06 | 双方型号同带边界空白而 checker PASS | runner 兼容门拒绝，0 transport |
| T07 | 缺凭据；timeout/maxBytes 缺失、小数、非安全整数、低于 1、超过各上界或不符批准原值；空/未批准 pin、CA 字段/路径、system/CA/mixed 模式 | 每个独立场景均 0 transport、0 CA 文件读取，不补默认值/不扩 bounds；合法 1/2 批准 pin 与合法 bounds 边界分别有正例 |
| T08 | B 未实现/独立 PS PASS/另一目录 PASS | 不能进入 EVIDENCE_READY |
| T09 | B 绑定不同 plan/SID/tool/目录生命周期 | 拒绝能力替换，不读取公开路径重建 |
| T10 | preflight writer 写/读/清理失败 | 0 DNS/socket/agent/transport；不给 READY |
| T11 | gate 异步准备期间授权到期或撤销 | 准备后重核失败，0 transport |
| T12 | 时间相等边界、时钟异常/状态未知 | now==end 拒；未知拒，无“可能撤销仍执行” |
| T13 | 两个消费者交错/失败后再用/重启恢复 | 一次消费；失败/未知不退还 |
| T14 | 六端点正常、G1 首 401 后合法 200/正确型号、再次 401 | 六逻辑端点、实际计数分开；合法挑战不误阻断，不扩目标/超预算 |
| T15 | 改方法/路径/查询/目标/TLS/base/顺序；G1 最终 403/404/500、200 缺/错型号及解析异常 | 越界调用被拒；G1 各失败保留已 GET 事实，私有 identityConfirmed 未建立，G2–G6 实际 transport 均为 0 |
| T16 | 新 gate 错码被旧 probe 捕获后继续 loop | latch 后 wrapper 可被尝试，实际 transport 永不再调用 |
| T17 | 运行中撤销/过期/session 失效 | 拒绝后续调用，保留在途未知，计数不清零 |
| T18 | 首次实际请求后 writer 失败 | EVIDENCE_WRITE_FAILED、实际调用非 0，不自动重发/盲删 |
| T19 | 旧 report 含 port/hostFingerprint/路径/原异常 | 公开映射全剔除；未知异常不泄漏正文 |
| T20 | 假 transport/writer 正控与禁用 latch 反向控制 | 正控真实增量；移除关键拒绝/脱敏后精确失败 |

T01–T20 共 20 个父 ID，T03 固定拆为 a/b 两个子场景，实际 21 个矩阵行，不预填 pass 数。Node/Windows 真实 writer/ACL/身份生命周期验收另属 B 与本地受控运行，不由纯合成测试宣称关闭。

## 9. 未来文件边界、停止点与当前结论

实施候选只允许新增独立 `tools/hikvision-e1-controlled-runner/` 下入口、私有 plan/runner、白名单结果映射及合成测试，并新增对应证据文档。
具体文件清单/起点/批准工具组合须另立实施卡；本文不授权新增文件、依赖、安装、子进程、真实配置读取或设备操作。
既有 checker、probe CLI/http/fs-safe、Windows ACL 工具均冻结；若无法通过新增 wrapper 满足绑定或 B capability 接线，先交明确差异卡，不能顺手改旧工具。
Stop-A：本文及 B 独立设计复审完成才可另案准备实施卡；本文通过仅是文本通过。
Stop-B：未来仅合成实施/验收完成，仍不得 E1；外部授权真实性、批准 target、最小权限账号/证书、实际 Node gate/Windows 本机证据缺一即 BLOCKED。
Stop-C：资料、工具及 gate 都可定位后仍需 E1 单独书面执行授权；真实执行后独立复审，不自动扩至 E2。

本文只解决受控 CLI 内“核对后重读配置、换包或由公开引用重建”的绑定设计，不保证整个 OS、私有文件或运行期撤销具有全局原子性。
不防御同用户恶意代码/特权管理员、祖先路径置换或未知外部撤销；这些限制不能成为已知失效仍开始执行的理由，所需能力不能成立时必须停。
本轮仅做固定树静态阅读与设计；未运行测试/guard/checker/probe/ACL/网络，未读取真实 env/CA/凭据，未创建证据目录、请求设备或回填运行时 PASS。
用户取消隔离网络的要求保持有效；S4、租赁 S2–S6、H4-c C2/C3、07B 执行、合并、HTTP/UI、真实支付/退款、设备/生产云及部署上线均未获本文授权。
