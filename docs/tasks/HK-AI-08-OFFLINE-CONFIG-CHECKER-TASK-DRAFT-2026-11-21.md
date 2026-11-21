# HK-AI-08 独立离线配置核对器任务卡草案（2026-11-21）

- 状态：**草案，待独立复审；未授权实现，未执行测试/guard/工具。** 本卡只订技术契约，不新增业务政策、不批准 E1/E2。
- 日期：2026-11-21（Asia/Shanghai）。
- 文档分支：`docs/hikvision-interface-test-readiness`；本轮固定起点/直接父：`e6b8588072a929c5c4558ebf0824c77dcfb0abd0`。
- 本轮变更白名单：仅新增本文件；已通过的 HK-AI-08 准备卡与历史配置缺口文档保持不变。
- 去重范围：已查看当前工作树 `docs/` 的相关任务标题/文件名及本地可见分支引用名称，未见同类离线配置核对器任务卡；不据此宣称已穷尽其他聊天、未抓取远端或外部任务系统。
- 本卡通过只代表技术任务文本可采纳；**不是 Stop-B 实现授权，不是 E1 连接授权，也不证明 HK-AI-08 全部准入已满足**。

## 1. 固定依据、目标与不证明的事项

| 输入 | 固定提交与定位 | 使用范围 |
|---|---|---|
| 已通过准备卡 | `e6b8588072a929c5c4558ebf0824c77dcfb0abd0`：`docs/tasks/HK-AI-08-HIKVISION-INTERFACE-TEST-READINESS-2026-11-19.md` §2.5.1/§2.5.2 | 本卡只实现其中可独立离线证明的格式、数量与配置匹配子集；审批及后续配置绑定继续分开 |
| 已通过历史缺口 | 同提交：`docs/tasks/HK-AI-08-HISTORICAL-CONFIG-EVIDENCE-GAP-2026-11-19.md` §2.10/§7.1 | 核对器仍缺件；E1 前置与 E1 采集、E2 前置分开，不重开能力结论 |
| 既有探针只读引用 | `558b9c864a4b820e397336200758b143556a4d87`：`tools/hikvision-probe/cli.mjs:46–58,67–71`、`src/probe.mjs:46–58`、`src/allowlist.mjs:41–55` | 仅核对已有输入解析约定，不运行、修改、导入或接线该探针 |

固定依据链接：

- <https://github.com/1997dmsu-sketch/SMART-PM/blob/e6b8588072a929c5c4558ebf0824c77dcfb0abd0/docs/tasks/HK-AI-08-HIKVISION-INTERFACE-TEST-READINESS-2026-11-19.md>
- <https://github.com/1997dmsu-sketch/SMART-PM/blob/558b9c864a4b820e397336200758b143556a4d87/tools/hikvision-probe/src/allowlist.mjs>

目标是新增一个独立纯离线模块与 CLI，对显式提交的非凭据配置做关闭式校验，输出布尔值、解析数量及固定枚举。现有探针 dry-run 仅列方法/路径，不能代替本核对器。

必须区分以下证据：

1. **配置格式/匹配**：本核对器可证明“提交给它的候选配置”与“提交给它的批准目标数据”在本卡定义范围内匹配。
2. **审批真实性/有效性**：本核对器不能证明签字真伪、批准人权限、审批是否生效/撤销或审批单是否被替换。批准目标数据必须来自有权方的受控证据，另行核验并留存；输入自报 `approvalValid=true` 不构成证明。
3. **随后执行配置绑定**：独立离线核对器不能证明随后设备进程用了同一份配置。`sameConfigBound` 必须留作未来独立授权接线/受控流程的证据门槛；不得接受输入自报 `true`，不得用配置匹配、引用相同或一次离线快照替代。
4. **设备/网络事实**：不证明真实设备身份、固件、连通性、证书、权限、网络隔离或能力。不得解析 DNS、连接设备，亦不解决检查至使用间的 TOCTOU。

准备卡 §2.5.1 中 `approvalValid`、`sameConfigBound` 的通过条件继续有效，但**不由本模块自行产生已证实的 true**；未来 E1 准入必须另外取得上述受控证据。不得将本模块输出包装成“E1 准入通过”。

## 2. 未来实现范围与文件白名单（Stop-B 尚待授权）

未来实现起点须以有权方另行书面指定的完整 SHA 为准；本草案当前只固定 §1 输入，不预写尚未生成的自身提交 SHA。

| 未来可新增文件 | 用途 |
|---|---|
| `tools/hikvision-offline-config-checker/src/check-config.mjs` | 独立纯校验模块，命名导出 `checkOfflineConfig` |
| `tools/hikvision-offline-config-checker/cli.mjs` | 仅从受控标准输入读取一份 JSON，无文件/环境回退 |
| `tools/hikvision-offline-config-checker/test/check-config.test.mjs` | 全合成库/CLI 入口校验，CLI 入口在同进程以注入流测试，不创建子进程 |
| `docs/evidence/hk-ai-08-offline-config-checker/README.md` | 实现与运行证据索引、固定代码/测试/guard 哈希及未证明项 |

仅使用 Node 内建纯计算/字符串/流能力；无新依赖、无 `package.json`/lock 变更或安装。CLI 在无输入/输入非法时失败关闭，不主动等待网络/交互；输入上限 16 KiB，超限即固定错误，不输出截取片段。

以下一律不在本卡内：修改批准探针 `tools/hikvision-probe/`、Store、Provider、路由、server、小程序、生产配置、准备卡及已关闭模板映射；接线设备执行器或提供启动设备命令；读 `process.env` 真实值、自动读取 `.env`/秘密目录/凭据/CA/证书；扫描真实文件；发网络/DNS/云/设备请求；创建监听、子进程或 shell 命令。若实现发现必须改白名单外文件，停止并另案说明。

## 3. 输入契约：显式配置与来源证明分离

库只接受显式传入的 JSON 数据形状；CLI 只接受一次受控 stdin JSON，不从 argv、默认值、配置文件或环境补齐。本轮及未来离线测试均仅使用合成数据。实际现场配置的读取/传递不由本卡授权。

关闭式根字段：`schemaVersion`（固定 `hk-ai-08-offline-config-v1`）、`approvalRef`（非敏感受控记录引用）、`approvedTarget`、`candidate`。`approvalRef` 只作本地输入关联，不回显，不证明记录真实有效。

| 对象 | 精确允许键 | 数据含义 |
|---|---|---|
| `approvedTarget` | `deviceRef`、`host`、`port`、`model` | 一份受控批准目标数据；单个对象，不接受数组或多目标；`port` 为显式十进制字符串 |
| `candidate` | `deviceRef`、`host`、`allowedHosts`、`port`、`allowedPorts`、`expectedModel`、`allowRead` | 候选配置；主机/端口/允许列表/型号均显式字符串；`allowRead` 必须为布尔 `false`，只表明本次输入处于禁网准备状态 |

输入只允许普通 JSON 数据值。多余键、重复 JSON 键、缺键、`null`/错误类型、隐藏键/Symbol/访问器、函数或其他非 JSON 值拒绝；不得读取访问器以求校验值。不得将任意可执行对象当作配置。`approvalValid`、`sameConfigBound`、账号/口令/token/CA/证书等均为禁入额外键，即使值为 `false`/空值也拒绝，不回显字段名或值。

输入字符串不作隐式数字/布尔强转；引用/型号最长 128 字符，主机文本最长 253 字符；字符串上限属于离线工具输入边界，不定义设备能力或业务编号规则。输入超长、解析错误或格式不满足均输出固定错误。

### 3.1 主机与允许列表

- 支持格式合法的 IPv4、裸 IPv6、ASCII DNS 名称；只作文本语法检查，**禁止 DNS 查询或任何解析到真实地址的请求**。
- IPv4 为四段 0–255 十进制，不接受八进制/十六进制或非标准缩写；IPv6 可用合法压缩形式，允许大小写，不允许 zone ID、方括号、附带端口；DNS 按 ASCII 标签语法校验，不接受 Unicode、空标签、末尾点或标签首尾连字符。看似点分 IPv4 的全数字四段若非法，不能回退成 DNS 名称绕过。
- 主机规范化只采用批准工具既有的 **trim + 转小写**，不查 DNS、不扩展/压缩 IPv6、不删除末尾点、不做域名别名或地址等价推断。两种写法指向同一地址不代表本卡自动认为相等；不匹配即失败，不偷偷改写批准数据。
- `allowedHosts` 按批准工具的逗号分隔、逐项 trim/转小写、过滤空项规则解析；解析后必须恰好一项，**不去重**。空列表、多项（含重复项）均拒绝。不得以允许列表缺失时回退为 `host`。
- 批准主机、候选主机、唯一允许主机须格式合法且规范化后相等；拒绝 CIDR、通配、URL scheme、userinfo、路径、查询串、fragment 及端口拼接。检查这些格式不产生连接。
- `deviceRef` 显式非空并与批准值逐字相同；数据中只有一个目标对象，只证明输入数量为一，不证明现场只有一台设备。

### 3.2 端口与型号

- `approvedTarget.port`、`candidate.port` 均须显式非空、全为十进制数字，数值为整数且在 1–65535。`allowedPorts` 显式配置并恰好一项合法十进制端口；不依赖 443/8443 默认值，不过滤掉非法项后冒充单项，不用去重把多项伪装为单项。
- 比较批准端口、候选端口、唯一允许端口的整数值，三者必须相同；拒绝符号、小数、指数、空值、尾随文本及范围外值。该规则是独立前置检查，不修改批准探针的默认/解析行为。
- 批准型号及 `expectedModel` 显式非空，逐字一致；不 trim 型号后冒充逐字相等，不接受近似型号或类型强转。
- 准备阶段 `candidate.allowRead` 必须为布尔 `false`，字符串 `"false"`、缺失、`true` 均拒绝。该输入不代表实际进程环境或探针开关已被检查。

## 4. 返回契约与敏感输出边界

返回固定结构：`schemaVersion`、`scope`、`status`、`code`、`checks`。其中 `scope` 固定为 `offline-format-and-match-only`；`status` 只能 `PASS`/`FAIL`；`code` 只能为本节固定枚举。**PASS 只表示输入的本地格式/匹配子集通过**，不能写成审批有效、配置已绑定、设备可用或 E1 可执行。

`checks` 精确允许以下布尔/非负整数键，禁止额外字段：

- 布尔：`schemaValid`、`deviceRefMatches`、`hostExplicit`、`hostSyntaxValid`、`hostMatchesApproval`、`allowedHostMatchesTarget`、`portExplicit`、`portValid`、`allowedPortsExplicit`、`allowedPortsValid`、`portMatchesApproval`、`allowedPortMatchesTarget`、`modelExplicit`、`modelMatchesApproval`、`allowReadDisabled`。
- 数量：`submittedTargetCount`、`allowedHostCount`、`allowedPortCount`。数量只反映解析输入；不表示真实设备/审批数量。
- 不适用/未检查项固定为 `false`/`0`；不得填入默认“通过”。`approvalValid`、`sameConfigBound` 不在输出白名单，外部证据未证明的事项不能由输入影响返回为真。

| 校验顺序 | `code` | 说明 |
|---|---|---|
| 1 | `INVALID_INPUT` | JSON、重复键、结构/键/类型/大小非法；不回显解析器原始错误 |
| 2 | `INVALID_TARGET` | 目标/设备引用或主机文本/列表数量非法 |
| 3 | `TARGET_MISMATCH` | 合法设备引用/主机之间不匹配 |
| 4 | `INVALID_PORT` | 已提供的端口/允许端口字符串为空，或语法、数量、范围非法；缺键/类型错误已由阶段 1 拒绝 |
| 5 | `PORT_MISMATCH` | 合法端口之间不匹配 |
| 6 | `MODEL_MISMATCH` | 型号为空或不逐字相同 |
| 7 | `READ_NOT_DISABLED` | 输入未明确为禁网准备状态 |
| 8 | `OK` | 仅本卡本地格式/匹配子集通过 |
| 异常 | `INTERNAL_ERROR` | 非预期内部异常，失败关闭，不输出异常原文或 stack |

CLI 对成功/失败都仅向 stdout 输出一条上述 JSON；stderr 不打印输入、字段名、异常原文、stack 或系统路径。退出码：0 仅对应 `PASS/OK`，2 为已知输入失败，3 为内部异常。不输出输入回显、地址/端口实值、型号/引用原文、secret、散列/可反推摘要；不输出“建议连接”或任何设备命令。库也只返回同一固定结构，不修改输入、不记录日志。

## 5. 拟验收矩阵（全合成，当前未执行）

每个 ID 必须有明确期望的 `status/code`、输出键白名单及前后输入不变断言；拒绝场景逐一执行，不能仅列一个维度算全部通过。输入前后快照覆盖全部输入数据；隐藏键/描述符场景另外保留完整键与描述符快照，不以 JSON 丢键冒充零变化。库与 CLI 接收/错误分支分别覆盖。

| ID | 合成场景 | 未来期望 |
|---|---|---|
| OC01 | 合法单 IPv4、单允许主机/端口、精确型号、禁网状态 | `PASS/OK`；只证明离线子集 |
| OC02 | 合法裸 IPv6；批准/候选同写法、大小写与首尾空白按既有 trim/lower 规范化 | `PASS/OK`；不展开/压缩文本、不解析网络 |
| OC03 | 合法 ASCII DNS、大小写/首尾空白；不存在任何 DNS 调用 | `PASS/OK`；不以解析成功作为条件 |
| OC04 | 两种格式合法但不同写法的 IPv6、不同 DNS/IPv4 或 deviceRef | `FAIL/TARGET_MISMATCH`；不得依等价猜测通过 |
| OC05 | CIDR、通配、URL/userinfo/path/query/fragment、IPv6 zone/方括号、非法 IPv4/DNS | 每项 `FAIL/INVALID_TARGET` |
| OC06 | host 空、缺 allowedHosts、全空列表、多项/重复项；另有空项过滤后唯一合法项正例 | 非法项拒绝；正例严格沿 trim/lower/过滤空项规则，非去重 |
| OC07 | 端口缺失/空、非字符串、小数/指数/符号/越界/文本、缺 allowedPorts/多项/非法项；边界 1/65535 正例 | 缺键/非字符串为 `FAIL/INVALID_INPUT`；空字符串及其余端口语法/数量/范围负例为 `FAIL/INVALID_PORT`；不使用默认端口；合法边界通过 |
| OC08 | 三个合法端口值不同；型号为空/不同大小写/多空白/近似型号 | 分别 `FAIL/PORT_MISMATCH` 或 `MODEL_MISMATCH` |
| OC09 | `allowRead=true`/字符串 false/缺失；结构类型与声明不同 | 类型/缺失按 `INVALID_INPUT`；合法布尔 true 为 `READ_NOT_DISABLED` |
| OC10 | 多目标数组、额外敏感键、`approvalValid`/`sameConfigBound` 自报真假、重复 JSON 键、隐藏键/Symbol/访问器 | `FAIL/INVALID_INPUT`，不触发 getter、不回显键和值 |
| OC11 | 错误 JSON、超限、空 stdin、内部异常；输入中使用显眼合成敏感哨兵 | 固定 JSON/code/退出码，无输入/stack/路径/哨兵/散列泄漏 |
| OC12 | 库每条路径的全量输入前后对照；CLI 使用注入流同进程覆盖 | 输入不变、输出结构严格，不创建子进程，不读真实 stdin/环境/文件 |
| OC13 | 格式匹配 PASS，但审批真实性与后续配置绑定未证明 | 仍不产生 `approvalValid`/`sameConfigBound`，不得据此解除 E1 BLOCKED |
| OC14 | 模块加载、成功和失败路径的网络/DNS/监听/子进程入口及真实配置读取负控 | 未来受控桩全部拦截，正控证明计数有效；业务路径零调用。桩不转发、身份/描述符/ESM 绑定精确恢复；不向真实端点发负控请求 |

未来证据必须固定 Node/OS、源文件和检查器版本、合成 fixture 及 guard 哈希、命令/退出码、实际顶层与子用例数。不得用矩阵 ID 数冒充测试条数。运行前须有实现阶段授权及独立审定的测试范围；不为本卡安装依赖、不运行后台全量套件，不引入真实 `listen` 或真实子进程测试。

OC14 的具体 guard 入口清单/实现及其有效性证据属于未来实现验收内容，须覆盖 `fetch`、HTTP/HTTPS、net/TLS、UDP、DNS callback/promise/Resolver、子进程等可绕过入口，且包含 ESM 命名绑定；本草案不声称已有 guard 或零调用实测。未知/缺失入口按 BLOCKED，不沿用其他工作线计数冒充本卡通过。

## 6. 阶段停止点与交付纪律

| 阶段 | 可做 | 结束条件与停止点 |
|---|---|---|
| **Stop-A 契约（当前）** | 固定依据、拟实现白名单、输入/输出/矩阵及证据边界落盘；静态文档检查 | 草案追加提交后停止，交独立复审；未授权实现，不执行代码/测试/guard |
| **Stop-B 实现（未授权）** | 仅在有权方另行书面指定范围和完整起点 SHA 后，按 §2 白名单新增独立模块/CLI/合成测试与证据 | 每项静态/合成验证如实记录；缺守卫、输出泄漏或边界不满足即停止；实现交付不自批、不调用批准探针、不进入 E1 |
| **Stop-C 独立只读复审（未申请）** | 独立方核对指定实现 SHA、范围、原始证据及未证明项；本阶段只读 | 给出通过/有条件通过/不通过；仅确认离线核对器交付，不批准接线或设备测试。若需独立复跑，另明确其纯离线范围，不能以本行默认授权 |

本轮不得实现或运行任何模块/CLI/探针/测试/guard，不读取真实配置/凭据，不扫描端口或配置目录。只追加文档提交；禁止 amend/rebase/reset/squash/force/merge/cherry-pick，不改全局/系统 Git 或 TLS，普通推送须由交付方按显式 refspec 另行完成，不推 main。

**仍待补的 E1 门槛**：核对器实现与独立证据、真实审批有效性的有权方证据、同份配置绑定的未来受控流程/接线证据、设备/网络/权限/时间窗等准备卡其余前置。任一缺件，E1 继续 **BLOCKED**；本卡不解决配置 TOCTOU，不授权相应接线。

E2、S4、预签约 S2–S6、H4-c C2、07B 执行、合并、HTTP/UI、真实支付/退款、设备/生产云、部署/发布继续冻结。无论本草案或未来离线核对器是否通过，均不自动改变上述边界。
