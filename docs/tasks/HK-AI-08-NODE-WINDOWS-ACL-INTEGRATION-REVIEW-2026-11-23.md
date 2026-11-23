# HK-AI-08 Node 写入与 Windows ACL 接线差距复审及合成验收卡（2026-11-23）

- 阶段：**P0-B，仅源码只读复核与设计准备，待独立复审**；本卡不授权实现、合成执行或 E1/E2。
- 来源：用户“执行所有 P0 事项先”，只覆盖上轮 P0-A/P0-B 技术准备；不扩展到冻结实施。
- 固定起点/本轮父：`3bb0b95df351ef357aedff6a21a275a19b92b6f2`；分支 `docs/hk-ai-08-node-windows-acl-integration-review`。
- 本文作者职责仅新增本复审正文，不改旧探针、核对器、Windows ACL 候选、已审文档/代码，不自行提交或推送；根代理独立复审后可在同分支附独立复审证据文档并追加提交、普通推送，不推 main。
- 本地 Windows ACL 预检已交由本地执行任务负责；**不重复派发、运行或代填其结果**。截至本次可读材料，尚无该任务实际结果回报。
- 本轮测试/guard/CLI/网络/设备调用均未执行，未读真实配置、凭据、ACL 或 Windows 用户资料。

## 1. 固定来源与事实等级

所有行号均对应下表固定 SHA，不用工作树行号代替历史对象。源码存在只证明代码行为可读，不证明 Windows 内核或设备实测结果。

| 来源代号 | 完整 SHA | 只读定位 |
|---|---|---|
| P（批准探针） | `558b9c864a4b820e397336200758b143556a4d87` | `tools/hikvision-probe/cli.mjs:44–103`、`src/probe.mjs:46–224`、`src/fs-safe.mjs:1–36`、`src/http.mjs:102–220`、`src/report.mjs:1–156` |
| W（Windows ACL 候选） | `3bb0b95df351ef357aedff6a21a275a19b92b6f2` | `tools/hikvision-windows-evidence-preflight/Test-EvidenceAcl.ps1:13–120,220–355`、`EvidenceAcl.psm1:55–105`、工具 `README.md:49–65` |
| O（离线核对器） | `31f20c9a372c447f142312f6e95e0400372f9ee8` | `docs/evidence/hk-ai-08-offline-config-checker/README.md:14–20`；格式匹配不证明执行绑定/审批真实性 |
| H（E1/E2 准备） | `ba93485e07fa5ec5ab83dc27ea2943200d38a1f6` | `docs/tasks/HK-AI-08-E1-E2-HARNESS-PREPARATION-2026-11-21.md:27–37,65,80–101,125–131` |

- P 固定源码：<https://github.com/1997dmsu-sketch/SMART-PM/tree/558b9c864a4b820e397336200758b143556a4d87/tools/hikvision-probe>。
- W 候选证据：<https://github.com/1997dmsu-sketch/SMART-PM/blob/3bb0b95df351ef357aedff6a21a275a19b92b6f2/docs/evidence/hk-ai-08-windows-evidence-preflight/README.md>。
- P0-A 并行依赖的准确路径为 `docs/tasks/HK-AI-08-E1-CONTROLLED-CONFIG-BINDING-DESIGN-2026-11-23.md`；这里只列纯文档ID，不造本分支不存在的相对链接。最终须同时固定 A/B 双方交付 SHA 与完整路径；本卡只对齐内部接口/状态契约，不预写尚未生成的提交号。

| 类别 | 本轮能写的结论 | 不能外推 |
|---|---|---|
| 源码事实 | 下述调用顺序、API、参数和分支可在固定对象读取 | 不等于已运行 Node、PowerShell、ACL 或设备 |
| 技术提案 | 第3–8节规定未来独立 adapter 的门禁/矩阵 | 不代表已有实现、已验证原子性或获得实施授权 |
| 未验证 | 本机 Windows 结果、实际 Node 写入路径、原始响应保护及运行期身份/ACL保持 | 不用 PowerShell 合成 PASS、路径相同或输入自报布尔补齐 |

## 2. 源码调用链及差距表

P 当前路径为：`cli.main → runProbe(config, httpsGet) → https.request → 收集响应/解析 → 返回 results/report → ensurePrivateDir → writePrivateFile(raw/report) → console`。

| 环节 | 固定源码事实 | Windows 接线差距/本卡处理 |
|---|---|---|
| 配置与启动 | P `cli.mjs:45–62` 从环境构建配置，含默认端口/列表、账号、CA/指纹；`:65` 先调用 `runProbe` | 不能把外部 checker PASS 后再次读取环境当同份绑定；未来仅复用受控函数，不导入有主入口副作用的旧 CLI |
| dry-run | P `probe.mjs:53–55` 在主机/端口校验前返回，CLI `:67–71` 仅列方法/路径 | 不能证明目录/ACL/配置合法，更不能发放 writer 能力 |
| 请求与响应 | P `probe.mjs:81–121` 逐端点调用 transport、401 后允许一次认证重发；P `http.mjs:150–186,220` 创建请求、读取响应并结束请求 | 整轮 `runProbe` 一次不等于物理请求一次；六逻辑 GET 与实际 transport/请求事实分开，输出 gate 必须提前完成 |
| 型号与 G1 身份前置 | P `probe.mjs:125–138` 先拒非200，再对预期/返回型号trim比较；但非200的 `HTTP_STATUS` 进入 `:145–153` 后非fatal可继续G2 | 旧loop进入G2不证明G1已核型号；未来wrapper须独立G1 identity gate：最终200且同一私有body可核完整型号才放行G2–G6。沿A拒绝预期型号边界空白，不改既有checker/probe |
| fail-fast | P `probe.mjs:145–153` 仅对 `FATAL_CODES` 中错误 break，否则可继续 loop | 新 ACL/gate 错误码仅 throw 不足以停请求；未来 wrapper 必须有不可复位 stop latch，在所有实际 transport 前拒绝 |
| 输出目录时序 | P `cli.mjs:75–77` 在整轮 `runProbe` 返回后才准备目录 | 当前 CLI 不能满足“ACL 不就绪则零 transport”；新路径必须先完成文件 gate，再创建/调用 transport |
| Node 目录 | P `fs-safe.mjs:14–23` 递归 mkdir、chmod；仅 POSIX 回读 mode，Windows 跳过该断言（`:10–12,17–22`） | 既有目录可被接纳，Windows chmod 不证明 DACL；不能直接沿用为新 gate。需新建/独占对象、原生 owner/ACE/身份读回 |
| Node 文件 | P `fs-safe.mjs:26–35` `writeFile(file,data,{mode:0600})` 后 chmod；没有 exclusive flag，Windows 不断言 ACL | 默认写入可覆盖既有文件；未来创建必须 exclusive，拒既有/未知对象，验证真实 Node 写入后 ACL，而不是只验证 .NET 哨兵 |
| 原始响应/报告 | P `cli.mjs:79–86` 批量写 body 和 report；P `probe.mjs:119–121` 响应已在内存 | 仅整轮结束落盘无法在首次落盘失败后阻止其余已发 GET；未来受控 transport 返回响应前，先经私有 session 保存该次 body，失败拉闸 |
| 脱敏边界 | P `probe.mjs:178–224` 实际组装 report，含 `target.port/hostFingerprint`、错误信息；`report.mjs` 提供解析/辅助报告函数，不是该路径唯一输出边界；CLI `:88–100` 还输出原因/路径 | 原 report/console 不得原样外发。公共摘要须独立闭式白名单，排除 host/port/可反推摘要、headers、原 error、绝对路径；原始 body 只在私有受保护会话内 |
| W 原生创建 | W `Test-EvidenceAcl.ps1:256–275` 检查不存在、创建时附 `DirectorySecurity`，再读原生 ACL | 比旧 Node 路径多了创建期 ACL 意图和原生回读；仍需本地运行证据，路径检查不自动证明目录句柄未被替换 |
| W 文件/负控 | W 同文件 `:280–311` 用 .NET `FileStream(CreateNew,ReadWrite,ShareNone)` 写读哨兵及 ACL；`:312–325` 内存扩权负控 | 不是 Node 的 mkdir/chmod/open/write/reopen，也不是原始设备响应；PS PASS 不能替代 Node 接线证据 |
| W 策略与清理 | W `Get-HkNativeAclSnapshot:47–120` 检查完整 raw ACE；`EvidenceAcl.psm1:55–103` 校验 owner、DACL、精确两条规则；脚本 `:336–350` 只清理本次已知对象，成功时合成 GUID 目录已清理 | PASS JSON/`evidenceRef` 不是仍存活的输出目录或 writer 能力；不得按 ref 复用已删目录、用历史 JSON 铸造 session，亦不把不明目录当作可删除物 |

**结论只到差距**：当前没有代码把 W 的原生验证连接到 P 的实际 Node 写入；本地 ACL 任务即使返回 PASS，也只证明其本次合成目录，不证明原 Node 输出路径、设备证据或运行期文件身份安全。

历史 ACL 报告仅可作先决证据。未来 `prepareEvidenceGate` 必须新建并持续持有**本轮实际 Node 写入使用的**受控资源；不能把已清理的 GUID 目录、相同名称/路径或非敏感 `evidenceRef` 当作存活资源，不接受重放 PASS。Node 合成预检哨兵完成后可清理，但保留给证据 writer 的新私有资源必须仍可验证、仍归本 session 持有，否则不 READY。

## 3. 与 P0-A 对齐的私有接口提案

以下是未来同一受控进程内的内部契约，不是现有 API，不是可对外调用的设备命令。

| 接口/对象 | 必须满足 | 明确拒绝 |
|---|---|---|
| `prepareEvidenceGate(privatePlan)` | A 完成私有捕获/核对后调用；B 识别同进程私有计划身份，准备输出 gate | 任意普通对象、JSON 回载、字符串 `planRef/path/sessionRef` 或自报 `PASS/ready=true` |
| 返回 `evidenceSession` | 只在受控 runner 私有注册表认可，含私有 writer 能力，不序列化/外发 | 将 PowerShell JSON PASS 当 session、跨进程回载、复制/伪造或已关闭 session |
| `assertBeforeTransport(privatePlan)` | 与创建 session 的同一 plan、当前批准目标/SID/工具版本及有效生命周期一致；检查 stop latch；G2–G6还须同轮私有G1 identity gate已通过 | 只对比路径文本/随机诊断 ref、读取后重新拼对象、重读环境恢复默认配置，或以旧loop进度代替G1身份结果 |
| `writeResponse` / `sealReport` | 私有受控 writer，仅接受本轮既定 endpoint/attempt 对应唯一新文件，调用时再次检查对象身份与权限 | 调用方给任意路径/文件名、覆盖、跨 session 数据、未绑定响应、关闭后追加 |
| `close/cleanup` | 仅对本次已证明归属且身份仍一致的文件/空目录按批准保管策略执行 | 递归删除、未知子项、仅凭前缀删除、清理不明对象或宣称失败即已回退 |

能力私有绑定包括：A 的不可公开回载 plan 身份、批准目标、当前 Windows 用户 SID、工具/adapter 固定版本、实际受控新目录/文件句柄及原生对象身份、创建/关闭状态和本轮端点进度。SID 必须来自受控原生身份 API，不接受输入自报；以上实际值不进入公共日志。

A 的 immutable core 只封存配置与输出策略/执行身份约束；B 后续返回的真实 `evidenceSession` 及一次性关联放在同 core 绑定的私有 `runState/registry`，**不回填 frozen core**，不通过改变 core 引用装入新配置。E1 runner 仅采用 `fingerprint-pinned`、一或两枚已批准 pin；禁止 CA/system-store/mixed 模式及 fallback，此约束不改写第2节对旧源码的事实描述。

`planRef/evidenceRef` 仅为随机非敏感诊断索引，不是恢复入口或授权票据；不得输出地址/账号/指纹/路径/SID、认证头、secret 或它们可反推的 hash。工具源码 SHA/合成 fixture 哈希与目标秘密分开处理。

### 3.1 状态与可用范围

- A 状态对齐：`CAPTURED → CHECKED → SEALED → EVIDENCE_READY → ARMED → CONSUMED → COMPLETED/FAILED/UNKNOWN/INVALIDATED`。
- B session：`NEW → PREPARING → READY → ACTIVE → SEALED → CLOSED`；任一故障进入终态 `FAILED` 并置不可复位 stop latch。`READY` 不允许 dispatch；只有 A 已同步置 `CONSUMED` 并铸造唯一 live transport 能力后，B 才从 READY 转 ACTIVE，且该转换先于唯一整轮 invoke。
- A 只有拿到 B 的私有 `READY` session 才能到 `EVIDENCE_READY`；`ARMED` 前再核批准有效性/撤销/时间窗、实际身份与 B gate，未知即停。
- A 在同一 event-loop turn、**无 await** 的同步临界段中最终检查私有 plan/runState、控制证据新鲜度、B session 与未消费状态，并先置 `CONSUMED`；之后才铸造唯一 live transport 能力，再唯一 invoke 整轮 `runProbe`。消费/mint/invoke 任一失败不复位、不重跑；六个逻辑 GET、每端点批准的 401 challenge 重发及实际请求分别登记。该进程内原子检查不承诺 OS ACL 或全局撤销原子性。
- B 在每个真实 transport 入口和写入边界核 session 同一性、对象身份及 stop latch，不仅在首个 GET 前核一次。G1 identity 状态只由本轮私有wrapper在最终200且同一响应body完整型号核验成功后更新；它属于私有runState，不接受外部布尔，也不回填core。G2–G6实际请求前必须检查该门。
- 本卡不证明审批真假或 `sameConfigBound`；其证据由 A 的受控流程和有权方提供，不由 B 输入布尔代替。
- **冻结配置与活控制分开**：不重读目标、秘密、已批准指纹等配置源或默认值，不读取 CA 作为回退；当前 ACL/资源身份、当前 SID、时钟/有效期、授权撤销状态属于仍需只读核验的活控制，不是重拼配置通道。活控制不能更换目标/端口或注入新配置；未知或过期的 resourceState/session 不得 dispatch。
- 活核验不承诺全局原子撤销、祖先路径 TOCTOU 或管理员隔离；不新增 HTTP 审批服务，不能通过外联扩大本卡范围。

## 4. 文件 gate 与真实 Node 写入顺序提案

未来验收必须证明以下 happens-before，不得用文件最终存在倒推出执行顺序：

1. 验证私有 plan、权限/工具版本、受控执行人身份和输出资源来源；尚不创建实际 transport。
2. 在经验证的受控父资源下仅创建本轮新私有目录；创建时具备所需 DACL，拒已有目标、重解析点/未知对象；不对旧目录“收紧后认领”。
3. 在私有会话中取得原生目录身份/句柄及 owner/完整 DACL；验证精确允许主体、权限、继承语义，没有未知 ACE；目录与文件按对象类型分别校验，不把根目录策略套到任意子目录。
4. 在该受控空间执行**真正 Node** 的新子目录 `mkdir`、`chmod`、exclusive create/open、write、flush/close、reopen/read 与原生 ACL 回读合成预检；文件自然继承是否符合策略必须实测，不能先改文件 ACL 做出“通过”。
5. 校验 Node 创建的实际对象、内容、owner/SID、ACE 与身份一致，并受控清理预检哨兵；清理失败、身份未知或无法保留可信资源则 gate 不 READY。
6. B 将经证明的新资源 session 留在同 core 对应的私有 runState/注册表并维持 READY；A 按 §3.1 在同一 event-loop turn、无 await 同步检查并先置 CONSUMED，**再 mint 唯一 live transport 能力**，B 才转 ACTIVE，最后唯一 invoke 整轮 runProbe。禁止先创建 transport 再消费；core 不回填 session，mint/invoke 失败也不能恢复未消费状态。
7. 每次实际 transport 前复核 gate；G2–G6还要求本轮 G1 identity 已验证。收到响应后先在该 session 中以 exclusive 新文件保存 body、回读身份/ACL/内容；认证响应和正式响应按受控 endpoint/attempt 序号区分，不覆盖，不写认证 headers。
   - G1 合法首次401保留既有唯一认证重发路径，此时identity仍未验证，不放行G2；第二次401按既有失败停止，并由wrapper保持latch。
   - G1 最终非200（如403/404/500）、200但完整型号缺失/不可解析/不匹配，wrapper即置latch，禁止G2–G6实际请求；可复用固定 `parseDeviceInfo` 对**同一私有body**与完整型号按旧trim语义核验，不重读配置、不用近似型号。已有G1请求/响应事实保留，后续实际请求增量0，不记整轮总0。
   - 仅G1最终200且身份核验通过才允许将identity状态更新并继续；G2–G6非200仍按既有端点结果逻辑处理，不把该G1专用门扩成所有非200一律致命。旧probe是否继续loop不能替代wrapper gate。
8. 任一写入/回读失败，先置 stop latch 再传播固定失败。即使原 `runProbe` 因新码继续 loop，后续 wrapper 也必须在接触真实 transport 前拒绝；不依赖旧 FATAL_CODES 自动理解新错误。
9. 收尾只生成闭式公共摘要；原报告/console 不自动外发。私有 raw body 的保管/销毁按已批准计划，写后失败保留已发生请求事实，不重发获取“完整证据”。
10. seal 后不再 append，close 后能力失效。清理只能处理可证明归属、身份仍匹配的已知对象，非空/未知子项不递归删除，失败如实登记并停止后续操作。

步骤4的 `mkdir/chmod/open/write/reopen` 要有真实 Node 调用与 Windows 原生 ACL 读回证据；步骤2可需要原生创建能力，但不能把 .NET 整条替身流程当步骤4。原 `fs-safe` 的 Windows chmod 不构成 DACL 通过依据。

### 4.1 具体失败关闭范围，不假称解决所有 TOCTOU

- 本设计只针对独立受控 runner、本地固定 NTFS、新私有对象、受支持当前用户身份与明确生命周期；不允许 UNC/网络共享路径、重解析对象、任意既有输出目录或文件。
- 路径逐级检查、`lstat`/名称一致不等于句柄/原生对象身份原子绑定；多次“检查后打开”也不自动消除竞态。必须有经本机证明的句柄/对象身份接口或等价受控资源机制，不能只声明它存在。
- **当前尚无获授权并验证的 Node/原生 ACL 接口及上述运行证据。** 缺此能力返回内部 `CAPABILITY_UNAVAILABLE`、gate 不 READY、真实 transport 为0，E1 不放行。
- 若未来实现只有路径前后检查或只能读 PowerShell 历史 PASS，就维持上述具体失败关闭结果；不能为“能跑起来”删去身份条件。
- 不声称抵御同用户恶意并发、管理员特权、共享/同步软件或完整跨进程攻击；如威胁模型需要这些保证，本卡不足，另立方案。若检测到身份/ACL/资源变化，立即失败，不能把其未被检测到解释成不存在。

## 5. 失败与事实保留矩阵

下表是新 adapter 内部拟状态，非新增业务/HTTP 错误码。不得把“本轮未运行”写成这些分支已实测。

| 触发窗口/事实 | gate/状态处理 | 请求计数与后续动作 |
|---|---|---|
| 审批/绑定/当前 SID/工具版本不符或未知 | 不准备 READY；固定准入失败 | 实际 transport=0；不创建请求、不重读环境补齐 |
| 新目录不存在性、原生接口、owner/ACE/继承或预检清理不满足 | `CAPABILITY_UNAVAILABLE`/`EVIDENCE_NOT_READY`；关闭已有能力 | 实际 transport=0；既有/未知对象不修改不删除 |
| READY 后、首请求前目录/句柄/ACL/SID变化 | `FAILED` + stop latch | 实际 transport=0；禁止用同路径重建后续跑 |
| 已进入 transport，但无法确认 GET 是否实际提交 | `UNKNOWN`，保留 transport attempt 与提交状态未知 | 不伪写0 GET/已到达设备；停止后续真实请求 |
| G1最终非200或200缺/错/不可解析完整型号 | G1 identity不通过，置latch；不能从旧loop已到G2反推通过 | 保留G1已发生请求/响应；G2–G6实际请求增量0，不伪总0；合法首次401仅留既有一次认证重发 |
| 已提交 GET 后网络/TLS/解析失败 | 保留已提交事实、响应/失败类别 | 不伪回滚，不重发；按既有可适用停止条件停 |
| 已收到响应但 exclusive create/write/flush/reopen/ACL回读失败 | `FAILED`/证据不完整 + stop latch | 保留实际已发生的请求数/响应事实，后续真实 transport 增量0；不自动重试或盲删 |
| 旧 runProbe 接受新错误后继续内部 loop | wrapper 的终态 latch 必须继续拒绝 | 可记逻辑调用被拒计数，不当作真实请求；不靠新错误码碰巧命中 FATAL_CODES |
| final report 写入或脱敏白名单失败 | 不输出原 report/stack/路径；证据未完成 | 已有 GET 事实不清零，不另跑一轮补证 |
| 清理遇重解析/未知对象/新子项/身份变化/删除失败 | `CLEANUP_UNVERIFIED`，失效 session | 只停手登记不安全完成，不递归清理、不宣称干净或已恢复 |
| 任一跨 plan、跨用户、关闭后或消费后复用 | 固定拒绝，不恢复旧能力 | 不创建实际 transport，不覆盖既有文件 |

计数至少区分：逻辑端点进度、wrapper 调用、实际 transport attempt、已知 GET 提交、未知提交、已确认响应和写入/回读结果。计数依据实际事件，不能把调用 transport 等同于设备已处理请求；未知不补0或成功。

## 6. 未来纯合成接线任务范围（未授权）

| 拟新增位置 | 用途与限制 |
|---|---|
| `tools/hikvision-e1-controlled-runner/evidence-session.mjs` | P0-A 私有 plan 对应的 evidence session、stop latch、exclusive writer；没有可回载公共路径授权接口 |
| `tools/hikvision-e1-controlled-runner/windows-acl-bridge.mjs` | 原生能力适配边界；缺实际能力就失败关闭，不借 shell/PowerShell 子进程拼接真实路径 |
| `tools/hikvision-e1-controlled-runner/test/evidence-session.test.mjs` | 全合成状态/顺序/零调用及真实 Node 文件路径验证，Windows 专属分组须有本机证据 |
| `docs/evidence/hk-ai-08-node-windows-acl-integration/README.md` | 固定源码、合成矩阵/原始结果、Windows/Node/原生桥版本与仍未证明项 |

这些只是拟文件白名单，不构成实现批准。P0-A runner 的文件接口须在两张卡共同复审时对齐；不能用本卡顺带修改 A、批准探针或本地已派 ACL 任务。

- 无依赖安装，不改 manifest/lock，不编译/下载/安装原生组件，不访问真实设备配置或密钥/证书文件。
- 若需新增原生组件、系统权限、桥接服务或修改批准工具才能取得句柄/ACL能力，停止并另案授权；不得在本卡暗增文件或通过部署绕过。
- 未来合成测试的文件根只来自该测试本轮新建资源，不接收任意用户目录；不把 Node 测试指向本地在跑的 ACL 预检目录。
- 不运行原 CLI、真实 `httpsGet`、后台全量测试、已有已关闭阶段套件；不启动监听、不真实 DNS/网络/子进程，不重复本地 ACL 执行任务。
- 受控 transport 只用不转发合成桩。任何“真实 Node/Windows 文件 I/O”验证也须另行明确授权范围，不因文档通过自动执行。

## 7. 拟合成验收矩阵（当前未执行）

每个输入/故障场景保存全量 before/after `structuredClone` 数据快照并对照；描述符/Symbol 另保存完整键/描述符。私有 session 的合法状态推进不与输入零变化混淆；私有能力不能以 JSON 序列化克隆作“同一性”证据。

| ID | 合成场景 | 固定未来判据 |
|---|---|---|
| NA01 | 正常 plan、原生能力、当前用户、受控新目录、真实 Node 新建/写读 | event trace：gate READY < 同步最终检查/CONSUMED < mint唯一live transport < session ACTIVE < 唯一runProbe invoke ≤ 每次实际请求；consume临界段无await，Node方法计数明确，输入零变化 |
| NA02 | native接口缺失、Windows非支持环境或本机证据缺失 | gate不READY、实际transport=0；不能以PS历史PASS替代 |
| NA03 | 既有目录/文件、重复文件名、同前缀未知对象 | 无覆盖/收紧认领，exclusive创建拒绝，已有内容/ACL零变化；前置故障transport=0 |
| NA04 | 根/祖先/leaf重解析点或原生对象身份变化 | 请求前拒绝；请求后置latch，后续实际请求0；不跟随/递归删除 |
| NA05 | owner/SID不同、输入伪造SID、用户身份运行期变化 | 原生身份/私有plan绑定不符即拒绝，不回显SID，不恢复旧能力 |
| NA06 | 空/缺DACL、非规范ACE、未知/额外/object/callback ACE、Everyone扩权 | 全量原生ACE检查拒绝；负控仅内存策略，不向磁盘施加宽权限 |
| NA07 | Node mkdir/chmod 后或 exclusive file 自然继承与预期不同 | 原生回读失败，不能用mode/一条布尔或事后重设ACL制造PASS；请求前transport=0 |
| NA08 | write/flush/close/reopen、内容回读或ACL/对象身份回读失败 | 私有writer故障终态，记录具体阶段；若已有GET则保留事实，不假写零调用 |
| NA09 | READY后、首次GET前及两次实际请求间ACL变化 | 同plan/session核对及latch拒绝后续真实请求；不得复位继续 |
| NA10 | 响应保存失败只抛新码，旧runProbe仍尝试下一逻辑端点 | 用真实控制流/合成transport证明latch阻断所有后续真实调用；不假定FATAL_CODES包含新码 |
| NA11 | 六GET顺序与G1合法首次401一次认证重发；G1最终403/404/500、200缺/错/不可解析model；另有G1合法后G2–G6非200、请求已提交但响应未知子例 | G1仅最终200且同一body完整model核验成功放行；负例保留已发G1事实，G2–G6实际增量0，不伪总0；G2–G6非200按旧语义。逻辑/物理次数分列，endpoint/attempt文件唯一，不重跑整轮 |
| NA12 | planRef/path/PASS布尔/PowerShell JSON或历史evidenceRef伪造能力、按ref复用已删GUID目录、跨plan或close后复用 | 同进程私有registry/对象身份拒绝，实际transport=0；不能靠历史PASS或字符串相等通过 |
| NA13 | seal/report白名单与错误分支植入合成敏感哨兵 | 公共输出无目标/端口/可反推hash/headers/原error/stack/path；raw仅受保护私有写入 |
| NA14 | 清理失败、未知子项、身份已丢失或文件已换 | 固定清理未确认，已知对象按证据处理；不递归、不盲删、不自称已恢复 |
| NA15 | 加载期及成功/失败业务窗口网络/监听/DNS/子进程正负控 | 加载前安装不转发guard，每槽正控实际触发+1后保留累计基线；业务实际外联/监听/子进程增量0，身份/描述符/ESM恢复准确 |
| NA16 | 真正Node文件路径对照 .NET替身、仅fake native快照、仅路径文本一致 | 缺Windows原生身份/ACL与实际Node行为记录即BLOCKED；纯合成桩通过不计Windows运行时PASS |

NA01–NA16 为矩阵 ID，不是执行测试数；实际顶层/子用例、PASS/FAIL/BLOCKED/skip 分列，不用静态数量冒充实测。

### 7.1 事件/计数证据要求

- 记录私有内部事件顺序的非敏感枚举及数量：prepare/ACL-read/Node-create/write/reopen/READY/CONSUMED/live-transport-mint/ACTIVE/runProbe-invoke/transport-attempt/response/write-failed/latch/close；不输出资源实值，明确不可先mint再consume。
- 计数包装的是**真实 Node** mkdir/chmod/open/write/read/close 等入口；正控证明计数有效。纯模拟返回不能作为真实文件 I/O 数；模块加载器读取与测试夹具读取分别说明，不能清零掩盖加载期外联。
- guard 必须在业务模块加载前安装；正控桩绝不转发。真实合成文件 I/O 只允许该轮私有根下白名单对象，网络/子进程仍被拦；捕获违规后不能撤 guard 继续跑。
- 输入 before/after 为每条独立场景的全量内容快照；属性型负例另比键/描述符，不以固定集合或 JSON 丢键代替。
- 源码/fixture/guard 哈希只固定非敏感合成内容；所有真实目标、SID、路径、账号、指纹或派生摘要不进入公共证据。

## 8. Windows 实际证据与独立复审边界

未来原生接线验收至少需：

1. 本地已派 ACL 任务回报的固定 SHA/原始 JSON/退出码/Windows与PowerShell版本及清理结果；只消费，不重派或在本卡代跑。
2. 另行授权的 Node 接线运行 OS/Node/原生桥版本、固定源码、原始合成结果与实际执行数；真正 Node 写/读/重开事件及原生 owner/完整ACE/对象身份回读对应。
3. 创建期保护、前置失败零transport、运行期ACL/身份变化、请求后写失败、清理失败的时间线；只存非敏感枚举、布尔、数量和受控证据引用。
4. 对原始响应保护的独立结论：合成body真实经过同一私有writer，而不是另写一份 .NET 哨兵；公共report/console从闭式白名单产生，原body受控保存/销毁。
5. 说明无法支持或未实际覆盖的原生句柄/竞态情况，不将管理员/同用户攻击、跨进程传递、完整TOCTOU或POSIX全场景等价写成已证明。

当前上述 Node/原生桥与运行期证据均未取得；本卡只有源码差距与待验证契约。本地 PowerShell 合成结果尚未回报，不能预写51/51、ACL通过或清理成功；收到失败按真实结果另行复审，不覆盖历史。

## 9. 阶段、停止点与冻结

| 阶段 | 范围 | 停止点 |
|---|---|---|
| P0-B（当前已授权） | 源码只读差距复核、与A接口对齐、拟合成验收卡 | 本文作者仅正文落盘、freeze交根代理独立复审，不实施/测试或自行提交推送；根代理可附独立review证据后追加提交、普通推送 |
| 文档独立裁定 | A/B两卡固定版本、事实/提案/未知、接口与错误语义 | 文档通过不等于有实现授权、Windows原生接口已存在或E1就绪 |
| 未来独立adapter实现（未授权） | 批准白名单/完整起点SHA、仅合成范围与所需原生能力边界 | 缺原生桥/身份/调用证据即失败关闭；依赖/新组件需求另案，不改旧probe |
| 未来Windows Node合成验证（未授权） | 仅新建合成目录与fake transport，原生ACL回读与受控清理 | 独立证据与结论，不重复当前本地ACL派单；失败/未知按BLOCKED，不连接设备 |
| E1/E2（继续冻结） | 另案完整授权、有效审批、配置绑定及所有剩余准入 | 不能凭任何离线PASS启动，不运行批准探针或读真实配置/凭据 |

用户已明确“不需要隔离网络”，沿 H 的覆盖记录采用现有网络单目标受控准备；本卡不恢复隔离VLAN、无公网/默认路由/DHCP/DNS或同网无第二设备等变相前置，也不新增网络审批角色。

保留单deviceRef/host/port、六GET白名单、目标归属、证书/型号/权限核验、合成数据和停止条件；E2仍只单合成人员+合成照片，不能因拒合成就改真人。

S4、预签约S2–S6、H4-c C2/C3、07B执行、集成/合并、HTTP/UI、真实支付/退款、设备/生产云、部署发布继续冻结。不得amend/rebase/reset/squash/force/merge/cherry-pick，不改全局/系统Git或TLS，不推main；本卡只准备，不代表已派新执行任务或已解除任何门禁。
