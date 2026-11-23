# HK-AI-08 受控 E1 接线分阶段实施卡（2026-11-23）

## 0. 状态、任务与授权边界

- **当前只交付实施卡，待独立文档复审；没有启动任何实现或验收执行。** 用户“下一项”承接统一离线包后的实施卡准备，不解释为真实 E1、Windows Node 接线或其他冻结线开工。
- 文档分支：`docs/hk-ai-08-e1-controlled-runner-task`；本卡起点及直接父为 `4df33305d488df2797cea4c3d2b286db7d8daa2c`。本轮只新增本卡，根代理可另附独立复审记录；不改两项 P0 正文。
- 未来实施分支暂定 `feat/hk-ai-08-e1-controlled-runner`，起点固定为上述 A 提交；本卡的最终完整交付 SHA 由根代理提交后另报，执行者必须同时记录实际获准卡版本和获准阶段，不从可变 tip 取“最新版”。
- 本卡是 A/B 组合的执行边界与验收索引，不重写已审设计。CR-1/CR-2 只拟定纯合成范围；CR-3 真实 Node/Windows 文件 I/O 与后续 E1 各需单独明确范围、起点和授权。文档通过本身不启动任何阶段。
- CR 编号属于本任务，与既有 C1 S1–S4 无关；本地 Windows ACL 任务沿用已有派单，只接收回报，不重复运行或派单。

## 1. 固定组合版本与证据等级

| 代号 | 完整提交 | 固定文件 / 作用 |
|---|---|---|
| A | `4df33305d488df2797cea4c3d2b286db7d8daa2c` | [配置绑定设计](https://github.com/1997dmsu-sketch/SMART-PM/blob/4df33305d488df2797cea4c3d2b286db7d8daa2c/docs/tasks/HK-AI-08-E1-CONTROLLED-CONFIG-BINDING-DESIGN-2026-11-23.md)；[独立静态通过记录](https://github.com/1997dmsu-sketch/SMART-PM/blob/4df33305d488df2797cea4c3d2b286db7d8daa2c/docs/evidence/hk-ai-08-p0-design-2026-11-23/CONFIG-BINDING-REVIEW.md) |
| B | `e6995bcb4dd9943df9745604bfcca7c4d7ea8890` | [Node/Windows ACL 差距及拟验收卡](https://github.com/1997dmsu-sketch/SMART-PM/blob/e6995bcb4dd9943df9745604bfcca7c4d7ea8890/docs/tasks/HK-AI-08-NODE-WINDOWS-ACL-INTEGRATION-REVIEW-2026-11-23.md)；[独立静态通过记录](https://github.com/1997dmsu-sketch/SMART-PM/blob/e6995bcb4dd9943df9745604bfcca7c4d7ea8890/docs/evidence/hk-ai-08-p0-design-2026-11-23/NODE-ACL-REVIEW.md) |
| O | `31f20c9a372c447f142312f6e95e0400372f9ee8` | `tools/hikvision-offline-config-checker/src/check-config.mjs`；只复用固定库，不调用 CLI |
| P | `558b9c864a4b820e397336200758b143556a4d87` | `tools/hikvision-probe/src/` 的六个固定依赖，按 §2 只取原字节快照 |
| W | `3bb0b95df351ef357aedff6a21a275a19b92b6f2` | Windows ACL 候选及原清单；静态已审，51 个声明场景不是 51 个通过 |
| H | `ba93485e07fa5ec5ab83dc27ea2943200d38a1f6` | `docs/tasks/HK-AI-08-E1-E2-HARNESS-PREPARATION-2026-11-21.md`；用户取消隔离网络前置的覆盖记录 |
| R | `6533f012a1f64d7fe9f70bb8f637ef7c1b9dc598` | 既有 Linux/Node v24.22.1 便携复跑 285/285，只属原核对器，不借作本任务测试 |
| I | `184d6e12c39c3012205661e378e197abdd20ed8f` | `docs/requirements/DELIVERY-STATUS-2026-11-23.md`；状态索引，不作为执行授权 |

A/B 为分别追加在 W 后的文档线，不假设一条分支包含另一条。A 树已含 O/W，但**不含 P 的探针目录**；B/P/H/R/I 作为固定只读来源访问，不 merge/cherry-pick，不从 `main` 或旧工作树隐式导入。
本卡实际读取固定 Git 对象并核对 SHA，不运行其中任何模块、测试、guard、CLI、PowerShell 或设备调用。

## 2. 原探针取件与未来文件白名单

### 2.1 CR-2 固定探针依赖快照

未来获准 CR-2 后，仅将 P 的以下六个 `tools/hikvision-probe/src/` 文件原字节复制到新目录 `tools/hikvision-e1-controlled-runner/vendor/probe-558b9c8/`。相对导入关系保留；不得重写、修补、缩减或仿造 `runProbe` 的 loop。

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `allowlist.mjs` | 3879 | `1c965b2b64c0990f92907f4725f7b6fa9ee9ff2c616f8af829218acbf8a73683` |
| `digest.mjs` | 4639 | `ce1d4d197a8bf567bdefb7420f550d6ba4d0a5a4593254b9c203b9af5b180b3e` |
| `http.mjs` | 7858 | `e64b04bd10370682f9b4b1ff577b8c481801d1c9976335ce276cdcaa4f6c2573` |
| `probe.mjs` | 7837 | `7a261b0291bb97db3c3aae6f112c971c5f72903e8f77ffc5ef02477bbe787f46` |
| `redact.mjs` | 2166 | `f221f26e3c27bf618192be8f65315f16d1521895121e977683455d10be53da11` |
| `report.mjs` | 5263 | `b22445deff002dc7c33f0db159bf8e1136a31f4ffabf9c575fbdc921b162c467` |

六文件依赖闭合，仅有彼此相对导入与 `node:https`/`node:crypto`；复制 `http.mjs` 是满足 `assertContentType` 的真实依赖，不授权调用 `httpsGet`。不取旧 `cli.mjs`、`fs-safe.mjs`、原测试、证书或 TLS fixture。
取件使用可保留原字节的 Git archive/二进制对象读取，不使用 PowerShell 文本重定向重编码。取件前后逐项比对上述大小/哈希；只读取所列固定对象，不扫旧目录、不猜配置。缺对象、字节不符或需要改原模块即停止，不能借合并引入整支。

### 2.2 未来新增文件范围

除末行证据外，下表路径都位于 `tools/hikvision-e1-controlled-runner/`；共 21 个具体文件。阶段仅指未来允许触及的候选范围，不是本轮已创建。

| 阶段 | 具体路径 | 职责/限制 |
|---|---|---|
| CR-1 | `index.mjs`、`private-plan.mjs`、`controlled-runner.mjs`、`public-result.mjs` | 无自动启动入口；私有捕获/状态机/消费/闭式映射；不读 stdin/env/真实配置，不导出任意 adapter 注入口 |
| CR-1 | `evidence-session.mjs`、`windows-acl-bridge.mjs` | B 私有 session 边界；真实 bridge 未获准/未实现时固定失败关闭，不提供伪 native PASS |
| CR-1 | `README.md`、`test/testkit.mjs`、`test/controlled-plan.test.mjs`、`test/evidence-session.test.mjs`、`test/public-result.test.mjs` | 说明、合成装配、输入/状态/输出断言及加载前 guard；测试装配不作为生产默认入口 |
| CR-2 | `probe-binding.mjs`、`test/probe-integration.test.mjs`、`vendor/probe-558b9c8/VENDOR-SOURCES.json` | 组合固定 `runProbe`/parser，记录来源清单；传输只能用不转发合成桩 |
| CR-2 | `vendor/probe-558b9c8/allowlist.mjs`、`digest.mjs`、`http.mjs`、`probe.mjs`、`redact.mjs`、`report.mjs` | 全部六文件均在同一 vendor 子目录，原字节冻结，VENDOR-SOURCES 明确完整源路径/commit/字节/哈希 |
| CR-1/CR-2 | `docs/evidence/hk-ai-08-node-windows-acl-integration/README.md`（仓库根相对路径） | 逐阶段来源、矩阵映射、运行记录/负控、独立结论、BLOCKED 与下一阶段门禁 |

既有 checker、Windows 候选、探针原路径、其他生产代码、HTTP、Provider、server、路由、小程序、manifest/lock、已关闭文档/测试均为零差异要求。未来若白名单不足，交明确差异，不顺手扩文件或改原工具。

## 3. 阶段与停止点

| 阶段 | 拟工作与可证明范围 | Stop 与禁止外推 |
|---|---|---|
| CR-0 本卡（当前） | 固定来源、白名单、组合策略、矩阵/命令边界与独立文档复审 | Stop-CR0：只交文档；不创建上述代码、不执行任何矩阵 |
| CR-1（尚未授权） | 纯合成 core、私有 plan/session、错误与 DTO；bridge 缺能力固定拒绝，transport/writer/native/approval 均只在测试装配中模拟 | Stop-CR1：独立复审代码与合成证据；不能宣称审批真实、Node 文件 I/O、Windows ACL 或 E1 已证，不自动 CR-2 |
| CR-2（尚未授权） | 按 §2 六文件快照加载真实 `runProbe`，与 wrapper/合成 writer/不转发 transport 组合；验 G1、Digest、latch 与计数 | Stop-CR2：独立组合复审；纯合成结果不填 Windows 运行时 PASS，不自动 CR-3 或 E1 |
| CR-3（不在本卡实施白名单） | 另案选择/批准原生能力、文件范围与完整组合 SHA，再授权 Windows 上真正 Node 创建/写读/重开和原生 ACL/身份验证 | Stop-CR3：必须先有具体方案与本机证据；当前无可用获准 bridge，缺能力就 BLOCKED，不用 shell/PS 子进程或 .NET 替身顶替 Node |
| E1/E2（继续冻结） | 另案真实材料、当前授权、同份绑定与实际 writer/session 均可证明后申请明确动作范围 | 不因 CR 阶段通过放行，不以本卡或离线包当作设备执行批准；E1 后不自动 E2 |

未来生产入口缺真实审批核验、bridge/本机运行证据或其他必要能力时，必须返回 A §7 的 `EVIDENCE_GATE_UNVERIFIED` 或对应准入错误，实际 transport 为 0。测试中的 fake approval/native/writer 只证明模拟路径，不能被公开 `ready=true`、path、ref、JSON、任意 callback 或复用已清理目录转成真实能力。
CR-1/CR-2 禁止真实文件数据 I/O；只允许固定代码/测试加载所需的已列模块与 fixture 读取。它们不能关闭 B 的真正 Node/原生 ACL 验收，亦不运行本地已派 Windows 预检。

## 4. 不得弱化的实现契约

以下是 A/B 的执行检查表；具体值、错误与字段仍以固定 A/B 原文为 oracle，不凭实现返回值重定义预期。

1. 一次受控捕获后保留私有独占副本；checker raw 副本的 `allowRead=false` 不改。归一化只一次；host/port 按固定 checker、model 无边界空白、1–2 枚批准 pin、pin-only、显式 bounds `1..10000` / `1..262144` 且为 SafeInteger。不读 CA/env/defaults，不从公共引用重新加载。
2. 不可变 core 与可变私有 runState/registry 分开；session 只与同 core 关联一次，不回填冻结配置。执行 config 仅在消费后由同 core 派生一次，不接受调用方替换。
3. 固定顺序：`READY < 同步最终检查/CONSUMED < mint 唯一 live transport 能力 < session ACTIVE < 唯一 runProbe invoke`。最终检查/置位无 await；失败、未知、第二消费者和重启都不返还一次消费权。合成阶段“live 能力”只在测试装配中模拟，不创建真实网络资源。
4. gate 异步准备后重新核验授权/时间/撤销/session；请求和写入边界继续核同 plan/session、资源身份和 stop latch。活控制仅允许继续/停止，不能带新目标、秘密或配置；无法证明新鲜状态即停，不谎称全局原子撤销或检测到不可观察变化。
5. 固定六逻辑端点/顺序/精确路径/GET；每端点仅批准的首次 Digest 401 重发一次，最多 12 次 transport 尝试，不加端点、扫描、重定向、恢复请求或整轮重试。实际组合中遵循旧 probe 的 challenge 状态，不仿造另一套认证 loop。
6. G1 最终 200 且由同一私有 body 的固定 parser 完整型号核验成功后，才允许 G2–G6。G1 最终非 200、空/错/不可解析型号先 latch；合法首 401 仍可走唯一挑战。G2–G6 非 200 沿旧语义记录失败/继续，不把 G1 门扩大为所有非 200 一律 fatal。
7. 新 gate/写入错误须先 latch 再抛；原 `runProbe` 即使吞新码继续 loop，wrapper 也不得触达后续下游 transport。首请求后写失败保留已发生事实，不伪总 0、不重发、不盲删。
8. 同一私有 writer 在把每次 body 交给 probe 前完成对应证据步骤；最终原 report/raw body 只归私有 session。CR-1/2 为内存模拟，不能说已在保护目录落盘；真实 exclusive 文件和回读属 CR-3。
9. 公共 DTO 完整照 A §6（A:145–159），错误分类照 A §7 的 E01–E17；B 内部 capability/cleanup 状态不变成新 HTTP 码。公开结果不带 host/port、目标或秘密摘要、SID/路径、headers、原 error/stack/body；未知不能补成成功。
10. 分列 wrapper 尝试、不同逻辑端点、下游 transport、确认响应与未知提交。在 CR-1/2，这些均是**合成 transport 计数**，不是设备 GET。未来 transport invocation 也不等于远端收到/处理；不确定事实按 UNKNOWN 保留。

## 5. 矩阵映射与判定口径

| 分组 | 不得丢失的固定源 ID | CR-1/CR-2 可证明内容 | 尚不能完整 PASS 的范围 |
|---|---|---|---|
| 捕获/绑定/规范化 | A T01–T07，含 T03a/b | 闭式输入、一次捕获、不可变副本、真假审批区分、pin/bounds/型号边界 | 外部审批与真实配置来源真实性仍无证 |
| gate/消费/生命周期 | A T08–T13；B NA01–NA09、NA12、NA14、NA16 | 内存 session 状态/顺序、伪能力拒绝、未知/缺 bridge 的零 transport | NA01 真正 Node 正例、NA03–09 的真实对象/ACL/文件行为、NA14 真实清理、NA16 Windows/native 证据仍 BLOCKED |
| 真实 probe 编排/latch | A T14–T18；B NA09–NA11 | 固定真实旧 loop＋合成下游；G1/401/写后失败与后续零调用 | 请求是模拟，不证明网络/TLS/设备或实际文件；NA09/10/11 的真实资源边界待后阶段 |
| DTO/guard/可证伪 | A T19–T20；B NA13、NA15 | 成败路径闭式输出、不转发 guard、计数正控、精确恢复及反向控制 | 不据此证明整个 OS 沙箱、环境不可读或全系统秘密安全 |

A 是 20 个父 ID、T03a/b 拆成 21 行；B 是 16 个 ID，存在内容重叠。不得相加为“36/37 条实测通过”。每行子场景逐项保留源预期，证据用源 ID＋子场景列明固定文件/测试定位、实测结果及限制。
每个 ID 分开登记 `PASS / FAIL / BLOCKED / NOT_EXECUTED`；只覆盖模拟子判据时列“模拟子判据 PASS，完整 ID BLOCKED”，不计完整 PASS。CR-1/2 的阶段验收只评价获准的合成范围，不要求伪造 Windows 成功；但必须证明真实入口缺能力失败关闭。
不使用 `skip`/`todo`/空测试或未来占位用例替代判据，不把 deferred 写入 PASS。未授权/无环境的真实场景只登记缺口，不创建恒绿测试假装执行。实际顶层/子用例数、源 ID 状态、Windows 实际数分别报告。

### 5.1 每个独立场景的必要证据

- 对可安全克隆的普通数据，每个独立场景各自保存 `before = structuredClone(input)`、调用后 `after = structuredClone(input)` 并 deepEqual；隐藏键另外比对完整键/描述符，不用 JSON 丢键。accessor/getter、函数、Symbol 值等不安全或不可克隆输入，改用 `Reflect.ownKeys`、完整属性描述符及引用身份的前后快照，不为取快照读取属性值/触发 getter；逐项断言 getter 执行 0、被测入口确实被调用并返回预期拒绝，不能把快照自身抛错算作通过。输入不变与私有合法状态推进分别断言。
- trace 明确 checker、gate READY、消费、mint、ACTIVE、probe invoke、wrapper、下游调用、响应、writer/latch/seal/close 的顺序；spy 包装实际被调用的函数，逐类不转发正控证明 +1，再保留累计基线，不清零掩盖加载期。
- 成功及失败各窗口都断言 guard 零违规；失败错误的 code/status（仅来源确实定义者）与精确写/调用集一起断言，不写宽泛 `rejects()`。
- 至少保存四类反向控制：禁 latch 后 G1/写后故障用例精确失败；以假 probe loop 替代原固定源码时完整性检查失败；放宽 public DTO/元数据字段时敏感哨兵用例失败；计数器失效/guard 转发时自检失败。临时变更立即逐字节还原，不提交注入。
- guard 转发负控的底层先换成不会联网/写盘/启动进程的合成哨兵，再证明错误转发被抓到；不得临时撤 guard 或转发真实系统函数来制造反证。

### 5.2 无网络 guard 与未来获准的运行范围

- guard 必须在业务模块及 vendor 动态导入前安装，覆盖 fetch、HTTP/HTTPS request/get/server/listen、net Server.listen/Socket.connect、TLS、UDP、同步/回调/promise DNS、子进程的实际可调用入口；逐槽列名，不能拿旧 49/63/131 数量当固定清单或新覆盖证明。
- 包裹默认对象后同步内建 ESM 命名绑定；正控实际调用不转发桩，每入口增量可证；finally 精确恢复函数身份、属性描述符与命名绑定，禁止嵌套污染。加载期与业务期分窗，成功路径也核违规记录。
- 真正 fs 写/改/删除/子进程/网络在 CR-1/2 均禁止；固定模块/夹具读取与加载器读分开标明。仅靠读取最终文件、静态 grep 或 Node/.NET 模拟计数不证明真实 I/O。
- 后续获准 CR-1/2 时只可显式列举白名单测试，沿既有 Node v24.22.1 同进程 `--test-isolation=none` 模式，guard 自检先行，原始退出码在摘要解析前持久化；不运行 `npm test`、原后台/HTTP/旧阶段套件或设备 probe CLI。本轮没有运行任何命令模板。
- 只检查 NODE_OPTIONS/NODE_PATH 是否存在，不打印值、不清空变量；任一存在先 BLOCKED，不能把 R 对原四文件的特定豁免移植到新增模块。若当前环境需要例外，针对固定新模块树和唯一命令先做独立技术复核并记录，不改全局配置。

## 6. 外部依赖与 CR-3 边界

1. 本地 W 任务尚无回报：只消费同版哈希、Windows/PowerShell 版本、原始 JSON/退出码与清理结果；不要求本地重跑，不把其 51 声明数填成通过。即使 PASS，原 GUID 目录已清理，不用 public evidenceRef 恢复能力。
2. 当前没有获准并验证的 Node/原生 ACL 桥。`windows-acl-bridge.mjs` 在本卡只负责声明能力缺失并失败关闭；CR-3 须先选择具体接口、创建期保护与句柄/对象身份机制，再明确额外文件/组件/系统能力与授权。不借 shell/PowerShell 子进程拼路径，不下载/编译/安装 native addon，不改安全策略或调用假 bridge 成真。
3. CR-3 的真实 Node `mkdir/chmod/exclusive open/write/flush/close/reopen/read` 与原生 owner、完整 DACL/ACE、继承/对象身份必须对应同一存活私有 session；不能用 .NET 哨兵、路径文本相同或 fake native 快照替代。先完成真实 gate，再创建任何真实网络能力，故障与清理按 B §4–8。
4. 真实 E1 还需有权方审批真实性/当前有效性、受控目标、账号权限、证书/完整型号、同份配置与输出资源绑定等证据；本卡不读取这些值、不补造签名服务/审批角色，不把材料“机制存在”写成“本次齐备”。
5. 不承诺抵御同用户恶意代码、管理员特权、全局撤销原子性、完整 TOCTOU 或 POSIX 全场景等价；能力未知则停。用户取消隔离网络前置持续有效，不新增 VLAN、无公网、默认路由/DHCP/DNS 或同网设备限制。

## 7. 交付与独立验收要求

未来每阶段在获准范围内追加提交，先报完整 HEAD/直接父/源卡和组合版本、文件白名单及禁止路径零差异，再报逐条 ID 状态、实际计数、命令/退出码、负控与精确还原；独立复审不能由实施者自行调用 CLI 得 PASS 后当作放行。
只追加提交与普通显式 refspec push、`ls-remote` 完整 SHA 核验，工作树干净后停在本阶段；不 amend/rebase/reset/squash/force/merge/cherry-pick，不改全局/系统 Git/TLS，不推 main。不把作者自检、文档通过或工具存在写成独立运行验收。

本轮只交本卡及可能的独立文档复审记录；实际测试/guard/Node/PowerShell/Windows I/O/设备请求全部为 0。S4、预签约 S2–S6、H4-c C2/C3、07B 执行、集成/合并、HTTP/UI、真实支付/退款、设备/生产云及部署上线继续冻结。
