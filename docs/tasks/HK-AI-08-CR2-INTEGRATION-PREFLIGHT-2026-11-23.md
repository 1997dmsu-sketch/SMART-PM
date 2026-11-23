# HK-AI-08 CR-2 固定探针合成接线前置核对（2026-11-23）

- 状态：**前置核对交付；交 Codex 技术裁定后停止。本报告不构成 CR-2 实施通过、CR-3 或任何后续阶段授权。**
- 执行方：Harness 根代理（负责来源核验、静态接口盘点与文档交付；接口变更裁定与最终验收归 Codex）。
- 本报告只做静态阅读、git 对象核对与 Git 取件/交付操作。**Git fetch、远端查询（ls-remote）与 push 属实际 Git 网络操作；worktree add、分支创建、FETCH_HEAD/refs 更新与 commit 属工作树或 Git 元数据写入，均非“只读”。**执行为零仅限本任务确实未运行的项目代码、Node 测试、guard、构建、项目 CLI、PowerShell 预检、业务网络与设备操作；未读取真实配置、凭据、证书、计划任务或秘密材料；未重复派发本地 Windows ACL 任务；未恢复隔离网络前置；未启动 CR-3/E1/E2 或任何冻结工作线。
- 固定组合与本报告的实际读取对象全部按完整 SHA 取件，不从可变 tip 取“最新版”。

## 1. 固定来源、父提交与取件结果

### 1.1 固定对象核验

| 代号 | 完整 SHA | 类型 | 标题 | 取件结果 |
|---|---|---|---|---|
| 基线/实现 | `2712ea7866377d889a78e413fcb7de420b9ad1ab` | commit | feat(hikvision): implement CR-1 synthetic controlled E1 core | 存在；直接父为 `4df33305d488df2797cea4c3d2b286db7d8daa2c`（P0-A） |
| 实施卡 | `0dc4433a06eff3f15f164e465257a77c709e73b9` | commit | docs(hikvision): define staged controlled E1 runner implementation task | 存在；不在基线祖先链上（并行文档线，按固定对象读取） |
| P0-A | `4df33305d488df2797cea4c3d2b286db7d8daa2c` | commit | docs(hikvision): design controlled E1 configuration binding | 存在；是基线直接父，基线树内同一 blob（`8b6206df11d9735b85edb7104cd21be4ce84b953`） |
| P0-B | `e6995bcb4dd9943df9745604bfcca7c4d7ea8890` | commit | docs(hikvision): review Node Windows ACL integration gaps | 存在；不在基线祖先链上（并行文档线，按固定对象读取） |
| 固定探针 | `558b9c864a4b820e397336200758b143556a4d87` | commit | docs(probe): 记录 59b6437 退回三项的修复与 58 项测试矩阵 | 存在；`tools/hikvision-probe/src/` 共 7 文件（六白名单 + `fs-safe.mjs`） |
| 固定离线核对器 | `31f20c9a372c447f142312f6e95e0400372f9ee8` | commit | fix(face): fail closed on previously terminated output streams | 存在；是基线祖先；其 `check-config.mjs` blob（`c813672010bc5d92a04e33eb587e3e9e3c59a290`）与基线树完全一致 |

### 1.2 fetch 与远端状态

- `git fetch origin` 最终退出 0。首次尝试被会话沙箱拒绝（`cannot open .../SMART-PM/.git/worktrees/SMART-PM-H3/FETCH_HEAD: Permission denied`，原因为当时策略限制对工作区外共享 gitdir 的写入；经诊断确认为预期限制而非文件 ACL 故障，未运行任何 ACL 修复）。会话策略随后切换为完全访问后 fetch 成功。**全程未修改全局/系统 Git、TLS、代理或安全配置，未关闭证书校验。**（本条沙箱边界、ACL 诊断与完全访问切换均为 Harness 交付方环境自述，非 Codex 独立核验事实，也不构成本会话权限或业务授权。）
- 基线分支核对：`origin/feat/hk-ai-08-e1-controlled-runner` tip = `2712ea7866377d889a78e413fcb7de420b9ad1ab`，**与固定 SHA 一致，远端未前移**；本地不存在同名本地分支（仅 remote-tracking ref），不移动、不改写。
- 远端其余分支有前移/新增（不影响核对对象）：例 `docs/hikvision-interface-test-readiness 81c6124→e9e3bbb`；新增 `docs/hk-ai-08-*` 与 `feat/hk-ai-08-*` 系列分支。本任务仍以固定 SHA 为核对对象，不自动改用新 tip。
- 交付目标分支 `docs/hk-ai-08-cr2-integration-preflight` 在远端尚不存在（fetch 后 `git ls-remote` 为空）。

### 1.3 工作树与文档分支

- 新建独立文档 worktree：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\hk-ai-08-cr2-preflight`，分支 `docs/hk-ai-08-cr2-integration-preflight`，起点即 `2712ea7`，创建后工作树干净。
- 未切换或修改任何其他工作树：主工作树 `SMART-PM-H3` 保持 `docs/hk-face-h4-revoke-reconcile-design` @ `9fd088d`，其既有未跟踪文件（`.git-lsremote-after.txt`、`HK-AI-07D.patch`）原样保留。
- 未 merge/cherry-pick，未移动既有分支，未改写历史。

### 1.4 固定文档原字节核验

| 文档 | blob | 字节 | SHA-256 | 与既有复审记录 |
|---|---|---|---|---|
| 实施卡 `docs/tasks/HK-AI-08-E1-CONTROLLED-RUNNER-IMPLEMENTATION-TASK-2026-11-23.md` @0dc4433 | `ba7e4255e25c1cc5c6e608ab83c62709b95dfbd7` | 19352 | `60054aa850a6bf291ae8db89476f560fc135408edc1ddf0477bf2982eea04cfb` | 一致（卡内复审记录） |
| P0-A @4df3330 | `8b6206df11d9735b85edb7104cd21be4ce84b953` | 29147 | `1bcbdadb5decc672c7af270254bb108df501335645d9d1884493142a91b4bef1` | 一致（A/B 复审记录） |
| P0-B @e6995bc | `13af3ec9010ac2a02ef0665655e7e1cc7ace3069` | 30038 | `0ff88b55c9f947b63e8ebfa61bf483d56e830ea5b7c3ceba8254ca9f8ba8a9f0` | 一致（A/B 复审记录） |

### 1.5 固定探针六文件取件比对（实施卡 §2.1）

| 文件（@558b9c8 `tools/hikvision-probe/src/`） | git blob | 字节 | SHA-256 | 与实施卡 §2.1 |
|---|---|---|---|---|
| `allowlist.mjs` | `2e2551c45bad21daf86a4767d29c18b0a5823b95` | 3879 | `1c965b2b64c0990f92907f4725f7b6fa9ee9ff2c616f8af829218acbf8a73683` | 一致 |
| `digest.mjs` | `3c222fca08a9f1e2b5d07b1c87b276bb826dd239` | 4639 | `ce1d4d197a8bf567bdefb7420f550d6ba4d0a5a4593254b9c203b9af5b180b3e` | 一致 |
| `http.mjs` | `e96481d2954df4efe6ac43dbe8fd915a3e9c5587` | 7858 | `e64b04bd10370682f9b4b1ff577b8c481801d1c9976335ce276cdcaa4f6c2573` | 一致 |
| `probe.mjs` | `a99c80ac6c4a95989f0ed5fbadc1da405146dc7d` | 7837 | `7a261b0291bb97db3c3aae6f112c971c5f72903e8f77ffc5ef02477bbe787f46` | 一致 |
| `redact.mjs` | `fbf97301cfd9307a0b26ad2b832bbe9ebb490225` | 2166 | `f221f26e3c27bf618192be8f65315f16d1521895121e977683455d10be53da11` | 一致 |
| `report.mjs` | `19d410ac59db11759542522b1ecdd7bec0bd81d7` | 5263 | `b22445deff002dc7c33f0db159bf8e1136a31f4ffabf9c575fbdc921b162c467` | 一致 |

- 字节与哈希全部按 git 原始 blob（二进制读取）计算，未用 PowerShell 文本重定向（本核对期间曾用文本抽取临时副本，尺寸差异（如 allowlist 3879→3982）正是卡内警告的重编码效应；最终判定值以上表原始 blob 为准）。
- `fs-safe.mjs`（blob `61bef04d51de884ac9eeb45d61eb5780e52b0c95`，1198 字节）在固定目录内但**不在六文件白名单**，六文件均不导入它，CR-2 不得复制。
- **导入闭包核验**：六文件仅存在彼此相对导入与 `node:https`/`node:crypto`（另依赖 Node 全局 `Buffer`，非导入）。`probe.mjs→{allowlist,digest,http,report,redact}`；`http.mjs→{node:https,node:crypto,./redact.mjs}`；`digest.mjs→node:crypto`；`redact.mjs→node:crypto`；`allowlist.mjs`、`report.mjs` 无相对导入。闭包成立，与实施卡 §2.1“六文件依赖闭合”一致。
- 复制 `http.mjs` 仅为满足 `runProbe` 经 `assertContentType` 的真实依赖；**不授权调用 `httpsGet`**（见 §3.7）。

## 2. CR-1 实际导出接口清单与数据流

以下行号对应基线 `2712ea7` 树内文件（同 blob 见表 §1.5 与 SOURCE-INVENTORY.json）。

**盘点口径**：CR-1 六个新增模块共 **20** 个显式导出；固定外部 checker（`tools/hikvision-offline-config-checker/src/check-config.mjs`）另 **2** 个（`checkOfflineConfig`、`checkOfflineConfigJson`），组合盘点为 **22** 个；checker 的 2 个不记为 CR-1 新接口。

### 2.1 `tools/hikvision-e1-controlled-runner/index.mjs`（生产入口，775 字节）

| 导出 | 签名 | 职责 | 行号 |
|---|---|---|---|
| `executeControlledE1` | `(input) => frozen DTO` | 唯一生产边界：安全捕获后因无真实审批/native bridge 固定返回 `BLOCKED/APPROVAL_UNVERIFIED`；不安全结构返回 `CONFIG_UNVERIFIED`。不导入合成 controller，不接收 adapter/回调 | L9 |

### 2.2 `tools/hikvision-e1-controlled-runner/private-plan.mjs`（15180 字节）

| 导出 | 签名 | 职责 | 行号 |
|---|---|---|---|
| `capturePlan` | `(input) => frozen {ok, code, plan}` | 一次闭式捕获：只读自有可枚举数据描述符，拒 Proxy/getter/隐藏键；普通数据递归冻结复制，`allowRead` 必须布尔；私有 `cores/states` WeakMap 登记 | L133 |
| `isPlanToken` | `(plan) => boolean` | 对象身份判定（cores 命中） | L151 |
| `checkCapturedPlan` | `(plan) => frozen {ok, code, state}` | 调用固定 `checkOfflineConfig`（checker PASS→CHECKED）；runner 兼容门（型号无边界空白、pin 归一化沿 P:http.mjs 语义、1–2 枚 64hex、bounds SafeInteger `1..10000/1..262144`、时间窗、outputPolicy 版本）；SEALED 时一次性替换私有 frozen core 并**内置 binding**（含 host/port/username/password/fingerprints/timeoutMs/maxBytes/tlsMode，不含 allowRead） | L156（binding 构造 L183–193） |
| `advancePlan` | `(plan, next, event) => frozen result` | 状态边 `SEALED→EVIDENCE_READY→ARMED→CONSUMED→COMPLETED`；latch 后拒绝 | L199 |
| `consumeCapturedPlan` | `(plan) => ticket` | 无 await 同步临界段：先置 `consumed=true` 与 `CONSUMED`，再 mint 唯一私有 ticket（`mintCount+1`）；仅 ARMED 可用 | L207 |
| `claimEvidenceSession` | `(plan) => boolean` | 每 plan 全局一次性、仅 SEALED 状态认领 | L223 |
| `claimActivationTicket` | `(ticket, plan) => boolean` | ticket 一次性认领，要求同 plan、已 CONSUMED、未 latch | L231 |
| `stopPlan` | `(plan, code, stateName) => frozen result` | 置不可复位 stop latch + 终态 | L242 |
| `getSyntheticWindow` | `(plan) => frozen {windowStartMs, windowEndMs}` | 返回封存时间窗（内部活控制读取用） | L247 |
| `matchesCapturedInput` | `(plan, input) => boolean` | 与封存捕获的深比较，**不返回捕获内容** | L253 |
| `matchesNormalizedBinding` | `(plan, expected) => boolean` | 与封存 binding 的布尔比较，**不返回 binding 值**；调用方必须自带 expected | L276 |
| `inspectPlan` | `(plan) => frozen snapshot` | 仅闭式状态快照：`scope:'cr1-synthetic-only'`、状态/计数/布尔/planRef/trace；`invokeCount` 与 `transportInvocationCount` **恒为 0**；不含 target/口令/pin/binding | L289 |
| `fixedErrorCode` | `(error) => string` | 只读自有数据 `code` 槽映射固定码 | L306 |
| `snapshotSyntheticControl` | `(value, confirmed=false) => frozen control` | 闭式控制快照 `{nowMs,fresh,revoked,approval[,confirmed]}`；非法即 `APPROVAL_UNVERIFIED` | L312 |

### 2.3 `tools/hikvision-e1-controlled-runner/controlled-runner.mjs`（7550 字节）

| 导出 | 签名 | 职责 | 行号 |
|---|---|---|---|
| `createSyntheticController` | `(input) => frozen controller` | 纯内存模型。返回 `{check, setControl, prepare, arm, consume, complete, fail, invalidate, snapshot, matchesCapturedInput, matchesNormalizedBinding}`；不接受 source/clock/transport/writer/native 回调 | L19（方法：check L71、setControl L80、prepare L88、arm L117、consume L128、complete L145、fail L155、invalidate L172、snapshot L173） |

- `prepare(options)`：SEALED→`model.prepare(plan,options)`（内部闭包持有 session）→ 固定微任务边界 → 重核状态与控制 → `assertReady` → EVIDENCE_READY。**返回值不含 session**。
- `consume(value)`：`consumeCapturedPlan` + `model.activate` 同步完成（CONSUMED→mint→ACTIVE）；**之后没有任何 invoke 阶段**。
- `complete()`：仅当 CONSUMED 且未 latch：`model.seal`→`model.close`→COMPLETED。
- `control()`：每次状态推进核 `approval==='VERIFIED_SYNTHETIC'`、fresh、时间窗、时钟不回退、未撤销；arm 需 `confirmed:true`。这是 CR-1 中唯一“授权/时间”核验实现点，但只挂在状态机推进上，**没有挂在任何实际请求边界上**（CR-1 无请求）。

### 2.4 `tools/hikvision-e1-controlled-runner/evidence-session.mjs`（8160 字节）

| 导出 | 签名 | 职责 | 行号 |
|---|---|---|---|
| `createSyntheticEvidenceModel` | `() => frozen model` | 内存证据模型。返回 `{prepare, assertReady, activate, writeResponse, seal, close, fail, inspect, trace}`。session 经 WeakMap 绑定 plan（`state.plan===plan` + `isPlanToken`），跨 plan/跨 model 拒绝；故障即 latch 并 `stopPlan` | L66（prepare L98、assertReady L124、activate L131、writeResponse L139、seal L166、close L174、fail L187、inspect L198、trace L208） |

- `writeResponse(session, plan, response)`：仅 ACTIVE + plan CONSUMED + 未 latch；`{endpointId, attempt, body}` 闭式（六端点 ID、attempt 1–2、`endpoint:attempt` 键唯一不覆盖）；body 私有复制（string 或 Uint8Array，≤262144 字节）；返回 `{bytes, recordCount}`，**不返回 body/引用**。这是“原始 body 私有保存”的现有唯一实现点（内存）。
- `prepare` 在 plan SEALED 且 `claimEvidenceSession` 成功时创建 READY session；`fault` 只接受固定枚举（PREFLIGHT_WRITE/READ/CLEANUP、WRITE、READ、CLEANUP）以模拟故障分支。

### 2.5 `tools/hikvision-e1-controlled-runner/public-result.mjs`（11518 字节）

| 导出 | 签名 | 职责 | 行号 |
|---|---|---|---|
| `makePublicResult` | `(input={}) => frozen DTO` | 闭式公共 DTO（A §6 形状）：只接受白名单根键；counts 边界（logicalEndpoints≤6、transport≤12、confirmed≤transport、transport≤wrapper）；COMPLETED 必须 6 端点 OK、全 checks true、refs 齐全；非法输入走 `failureWithFacts` 保留已验证计数事实，未知不补成功；永不序列化被拒上下文、getter 或异常正文 | L182 |
| `errorToCode` | `(error) => string` | 只读自有数据 `code` 槽安全映射 | L223 |

### 2.6 `tools/hikvision-e1-controlled-runner/windows-acl-bridge.mjs`（318 字节）

| 导出 | 签名 | 职责 | 行号 |
|---|---|---|---|
| `prepareEvidenceGate` | `() => frozen {scope:'native-capability-unavailable', ready:false, code:'EVIDENCE_GATE_UNVERIFIED'}` | 固定失败关闭；历史 PASS/输入/ref 不能铸能力 | L3 |

### 2.7 现有数据流（CR-1 实际行为）

- 生产入口：`executeControlledE1(input)` → `capturePlan` → `inspectPlan` → `stopPlan(APPROVAL_UNVERIFIED, INVALIDATED)` → `makePublicResult({status:'BLOCKED', code:'APPROVAL_UNVERIFIED', planRef})`。**无 checker 门禁后置步骤、无 session、无 transport。**
- 合成模型：`createSyntheticController(input)` → `check`（capture→checker→兼容门→SEALED+binding）→ `prepare`（session READY）→ EVIDENCE_READY → `arm`（ARMED）→ `consume`（CONSUMED + mint ticket + session ACTIVE）→ `complete`（seal/close→COMPLETED）或 `fail`/`invalidate`（latch）。**全程 `invokeCount=transportInvocationCount=0`，没有 runProbe 编排。**

## 3. 静态核对结论（逐项）

### 3.1 不可变 binding 是否存在可受控使用的接口 — **缺口（G1）**

- binding 仅存于 `cores` WeakMap 私有闭包（private-plan.mjs L183–193），SEALED 后不再改写，符合“不可变”。
- 对外只有布尔比对 `matchesNormalizedBinding`（L276–287），**不返回任何值**；`inspectPlan` 不含 binding。
- CR-2 构造 `runProbe` 的 `config`（host/port/username/password/fingerprints/timeoutMs/maxBytes、执行视图的动作门 `allowRead:true`）必须取得这些值；现有接口既不能取出值，也不能由 CR-2 自行重读输入（违反实施卡 §4.1/§5“不得重读配置恢复”，且 CR-2 层根本拿不到原始输入）。README（tools/…/README.md L46–48）明确：“本阶段没有创建消费后的真实执行视图”。

### 3.2 session 与同一 plan 的身份绑定 — **机制存在，但对外不可达（G2）**

- 存在：`model.prepare` 用 `isPlanToken`+`claimEvidenceSession`（每 plan 一次性）、WeakMap `state.plan===plan`、每操作 `get(session,plan)` 复核；跨 plan/model/阶段拒绝（evidence-session.mjs L70–103、L124–137）。
- 缺口：`controller.prepare` 把 session 保留在闭包内、**不返回**（controlled-runner.mjs L96），controller 表面没有把 `model.writeResponse`/`seal` 暴露给任何 probe 编排阶段的方法；CR-2 wrapper 无法在“每次 transport 返回后”调用同一 session 的私有写入。

### 3.3 消费、mint、ACTIVE、唯一 probe invoke 的次序 — **前三步成立，invoke 不存在（G3）**

- 成立：`consumeCapturedPlan` 无 await 临界段先写 `CONSUMED` 再 mint 唯一 ticket（private-plan.mjs L207–219）；`model.activate` 认领同 plan ticket 后转 ACTIVE（evidence-session.mjs L131–137）；失败/未知/第二消费者不退还（测试覆盖 T13/NA12）。
- 缺口：**不存在任何 runProbe 编排阶段或 invoke 计数接口**。`inspectPlan` 的 `invokeCount`/`transportInvocationCount` 硬编码为 0（L298），没有任何递增路径；没有“唯一 invoke”的守卫实现点；“ACTIVE < 唯一 runProbe invoke”这一步在 CR-1 里无处落地。CR-2 若在 CR-1 外自建编排，将失去与私有 plan/session 的证据完整性绑定。

### 3.4 每次请求及写入边界的授权、时间、session、stop latch — **写入边界有、请求边界无（G4）**

- 有：`writeResponse` 每次核 session 同 plan、plan 状态 CONSUMED、未 latch（evidence-session.mjs L139–163）；`assertReady`/`requireLivePlan` 复核。
- 无：**不存在任何 transport 级/请求级边界**。授权/时间/撤销核验只存在于 controller 的 `control()`，且只在 `check/setControl/prepare/arm/consume` 状态推进时执行（controlled-runner.mjs L53–69）；没有可供 CR-2 在“每次实际 transport 提交前”调用的受控检查导出；`requestOutcomeUnknown` 计数无任何产生点（仅 DTO 层可表达）。设计 A §5“每次请求入口再核同 plan/session、未 latch、当前授权/时间及六端点进度”在 CR-1 中无对应代码。

### 3.5 原始 body 的私有保存与公共 DTO 的分离 — **部件各自存在，真实 runProbe 接线缺失（关联 G2/G6）**

- 编号以 §4 表格为唯一定义：**G5 仅指 G1 identityConfirmed 私有状态与门禁**；本节两项事实分别对应 G2（同一私有 session 的写入能力对外不可达）与 G6（evidenceRef 无产生源）。
- 有：`writeResponse` 私有复制且不返还引用；`makePublicResult` 闭式白名单、永不外发原 error/stack/body（T19/NA13 已验）。
- 无：runProbe 的响应 body/headers/原 report 如何进入同一私有 session 的路径不存在（CR-1 根本没有 runProbe）；最终 report 归私有 session 的 `seal` 语义只对内存记录生效；DTO 的 `evidenceRef` 字段目前没有任何产生源（model 无 ref 概念，即 §4 G6）。

### 3.6 固定探针六文件 — **全部核验通过**（见 §1.5）

### 3.7 只复用真实 runProbe + 不转发合成桩；复制 http.mjs 依赖 ≠ 调用 httpsGet

- `runProbe({config, transport, now})` 是唯一应复用的编排（vendor `probe.mjs` L46）；transport 由 wrapper 注入**不转发合成桩**（不调用 `httpsGet`/`https.request`）。
- vendor `http.mjs` 的 `assertContentType` 由 `runProbe` 内部调用（probe.mjs L130），因此复制 `http.mjs` 是依赖要求；但 `httpsGet`（http.mjs L102）是真实网络入口，CR-2 任何路径不得调用——由 CR-2 guard 加载期/正控证明 `https.request` 等槽零转发（guard 已覆盖 `https.request/get/createServer`，见 §3.9）。
- 不仿写 probe loop：CR-2 不得复制/简化 `runProbe` 的控制流（FATAL_CODES、401 挑战、G1 型号比对）另造一套“等价的”编排。

### 3.8 A T14–T20、B NA09–NA15 映射与 CR-2/CR-3 边界

| 源 ID | 子判据要点 | CR-2 可验证部分（合成桩，不转发） | CR-3/真实环境缺口 |
|---|---|---|---|
| A T14 | 六端点正常、G1 首 401 后合法 200/正确型号、再次 401 | 用真实 `runProbe` + 合成 transport 按白名单顺序/路径响应（含一次 challenge 重发）；逻辑/物理计数分开 | 真实设备/TLS/Digest 语义 |
| A T15 | 改方法/路径/查询/目标/TLS/base/顺序；G1 终态 403/404/500、200 缺/错型号/解析异常 | vendor `assertAllowedRequest` 拒绝越界；wrapper 在 G1 失败后 latch，G2–G6 实际调用 0，`identityConfirmed` 不建立 | 真实网络/设备响应 |
| A T16 | 新 gate 错码被旧 probe 捕获后继续 loop | 真实 `runProbe` + 合成 transport 在中间端点抛新码，证明 latch 后 wrapper 拒绝所有后续 transport | — |
| A T17 | 运行中撤销/过期/session 失效 | CR-1 已有模型级拒绝（T17 子判据 PASS）；CR-2 需在两次合成请求间插入失效并证明后续拒绝 | 真实撤销通道/在途请求事实 |
| A T18 | 首次实际请求后 writer 失败 | 合成 writer 故障（fault=WRITE/READ）注入在首个响应后；`EVIDENCE_WRITE_FAILED`、计数非 0、不重发 | 真实文件 writer/落盘 |
| A T19 | 旧 report 含 port/hostFingerprint/路径/原异常不外泄 | 把真实 `runProbe` 的合成 report/error 喂 `makePublicResult`/`errorToCode`，闭式输出逐字段断言 | 真实 body/report 落盘 |
| A T20 | 假 transport/writer 正控与禁用 latch 反向控制 | CR-2 套件沿用 guard 正控/负控（N1–N5 模式）对新增树重做 | — |
| B NA09 | READY 后、首次 GET 前及两请求间 ACL 变化 | 合成“资源状态失效”事件在请求间插入，wrapper 拒绝后续合成调用 | 真实 ACL/句柄观察 |
| B NA10 | 响应保存失败只抛新码，旧 runProbe 仍尝试下一端点 | 真实控制流 + 合成 transport，latch 阻断后续真实调用 | — |
| B NA11 | 六 GET 顺序、G1 唯一挑战、G1 负例、G2–G6 非 200、提交未知 | 全部可用合成 transport 编排验证；endpoint/attempt 文件唯一 | 真实设备行为/提交事实 |
| B NA12 | ref/PASS JSON/历史 evidenceRef 伪造、跨 plan、close 后复用 | CR-1 已有子判据 PASS；CR-2 增加 session 跨编排复用拒绝 | 真实存活资源 |
| B NA13 | 敏感哨兵不外泄 | 合成哨兵植入 runProbe report → 闭式 DTO 剔除 | 真实 raw 落盘保护 |
| B NA14 | 清理失败、未知子项、身份丢失 | 内存模型子判据已有；真实清理策略 | 真实文件系统 |
| B NA15 | 加载期/业务窗口网络/监听/DNS/子进程正负控 | CR-2 必须对**新导入树**重做（见 §3.9），本项 CR-2 可完成 | Windows 运行时部分 |
| B NA16 | 真正 Node 文件路径对照 .NET 替身 | — | 全部属 CR-3 |

### 3.9 现有 guard 与新增导入树（事实记录）

- CR-1 guard 位于 `test/testkit.mjs`：加载业务模块前安装；显式包裹 http/https 的 `request/get/createServer`、net/TLS/dgram 连接与监听族、DNS（lookup/resolve*/reverse + Resolver）、`child_process` spawn/exec/fork 族、`globalThis.fetch/WebSocket/EventSource`，业务加载后再安装 fs/fs.promises 全函数槽；正控不转发、累计基线、精确恢复（L21–255）。
- CR-1 验收记录的 232 槽（92 网络 + 8 进程 + 132 运行期 fs）是**该固定导入树的实测数**。CR-2 新增导入树 = 六 vendor 文件 + `probe-binding.mjs` + `test/probe-integration.test.mjs`。
- 事实核查：六 vendor 文件仅新增 `node:https`（已包裹条目内）、`node:crypto`（`createHash/randomBytes/timingSafeEqual`，非网络/进程/fs，不属 guard 范畴）、全局 `Buffer`；加载期无 I/O。**因此无需为六 vendor 文件新增 guard 槽名**；但“不需要新槽名”不能由静态推断替代运行证据——CR-2 必须按实施卡 §5.2 用新树重跑加载期零违规、逐槽正控/累计基线/精确恢复证据，**不得把 232 或旧 49/63/131 数字当作新覆盖清单**；`node:crypto` 不在 guard 范围属预期，不是新覆盖证明。
- 实施卡 §5.2 与验收记录 §2.1 的 NODE_PATH 例外仅对 CR-1 固定 10 文件模块树和唯一命令成立；CR-2 新树/新命令如仍遇该环境项，须针对新树另行独立技术复核，不得直接沿用。

## 4. 接口缺口清单（缺少什么 / 现有证据 / 受影响文件 / 待 Codex 裁定）

| 编号 | 缺少什么 | 现有证据（基线树） | 受影响文件 | 需要 Codex 裁定什么 |
|---|---|---|---|---|
| G1 | 从封存 core 派生执行视图的受控接口（binding + 动作门 `allowRead:true`），且不把值外泄 | binding 仅在私有闭包（private-plan.mjs L183–193）；`matchesNormalizedBinding` 只布尔比对（L276–287）；README L46–48 自证“没有执行视图” | `tools/hikvision-e1-controlled-runner/private-plan.mjs`、未来的 `probe-binding.mjs` | 是否允许在 CR-1 增加“仅对已消费 plan、一次性、内部使用的冻结执行视图派生”（例如不返回给调用方、只交给受控 wrapper 闭包），还是必须以其它受控方式（不得重读输入/不得由 CR-2 重建值）达成 |
| G2 | CR-2 可使用的同 plan session 与私有写入能力（`writeResponse`/`seal` 出口） | session 闭包持有不返回（controlled-runner.mjs L96）；`writeResponse` 只在 `createSyntheticEvidenceModel` 内部（evidence-session.mjs L139）；controller 无 invoke/写入编排方法 | `controlled-runner.mjs`、`evidence-session.mjs`、未来的 `probe-binding.mjs` | 是否允许 controller 增加受控编排方法（如消费后返回受控句柄/提供 runProbe 编排入口），使合成 transport 的每次响应先经同一 session 私有保存；session 对象本身是否可离开闭包 |
| G3 | 唯一 runProbe invoke 阶段及其一次性/latch 守卫与计数 | 无 invoke 方法；`invokeCount/transportInvocationCount` 恒 0（private-plan.mjs L298）；`complete()` 直接封存（controlled-runner.mjs L145） | 同上 | invoke 编排应放在 CR-1 controller 内（证据绑定最强）还是允许 CR-2 层自建——后者如何证明“同一私有计划派生”与唯一性 |
| G4 | 每次实际 transport 提交前的授权/时间/session/latch 检查点与 `requestOutcomeUnknown` 事实登记 | `control()` 只在状态推进时执行（controlled-runner.mjs L53–69）；`fail({unknown:true})` 仅在 controller 层（L155–168）；无 transport 层 | `controlled-runner.mjs`、`private-plan.mjs` | 是否增加“per-attempt 检查”内部导出，或允许 CR-2 wrapper 在注入 transport 前调用某一受控谓词；未知提交事实由哪层登记 |
| G5 | G1 identityConfirmed 私有状态与更新接口（仅 wrapper 内部可写） | 无此状态；DTO 也无该字段（不属公共 schema）；`inspectPlan` 无 identity 项 | `private-plan.mjs`、`probe-binding.mjs` | identity 门状态放在 runState 哪一侧、谁能写、如何保证“最终 200 且同一私有 body 核验成功”后才置位 |
| G6 | `evidenceRef` 的产生源 | `makePublicResult` 要求 COMPLETED 时 evidenceRef 非空（public-result.mjs L203–208），但 CR-1 无任何 ref 生成器 | `evidence-session.mjs`、`public-result.mjs` | evidenceRef 由 session 创建时生成并绑定 plan，还是由结果层生成；不得成为恢复入口 |
| G7 | 请求窗口编排事件（probe-invoke、wrapper、downstream 等）及其与已有生命周期的组合证据 | 已有 plan trace 枚举含 COMPLETED/FAILED/UNKNOWN/INVALIDATED 等终态事件（private-plan.mjs EVENTS，L17–21）；已有 session 事件含 MEMORY_WRITE/MEMORY_READ/SEALED/CLOSED/FAILED（evidence-session.mjs L81、L110–120、L136、L157、L162、L171、L184、L193）；缺口仅为 probe-invoke/wrapper/downstream 等请求窗口编排事件及其与上述已有生命周期事件的组合证据 | `private-plan.mjs`（EVENTS 集合）、`evidence-session.mjs` | 是否扩展固定事件枚举（只能追加，不改语义）以满足 A/B §7.1 的证据要求 |

- 不允许的绕过方式（记录为禁止项，不作为方案）：重读另一份配置恢复执行值、公开 ref/JSON 恢复、导出秘密或 binding 值到公共面、任意 adapter 注入、仿写 probe loop、把 `matchesNormalizedBinding` 的布尔当作“已取得执行视图”。
- 不列为缺口的项（事实记录）：`CLEANUP_UNVERIFIED`/`CAPABILITY_UNAVAILABLE` 是 B 的内部拟状态（B §5），不进公共 DTO，CR-1 CODES 不含它们是正确行为；`getSyntheticWindow` 返回时间窗值但只用于 controller 内部活控制核验，不构成配置外泄入口。

## 5. CR-2 白名单内可完成项（不需要改 CR-1 的部分）

1. 六 vendor 文件原字节复制到 `tools/hikvision-e1-controlled-runner/vendor/probe-558b9c8/`，并生成 `VENDOR-SOURCES.json`（来源路径/commit/blob/字节/SHA-256）——纯文件白名单操作，本报告 §1.5 数据可直接使用。
2. `makePublicResult`/`errorToCode` 对**真实 runProbe 合成输出**的脱敏验证（T19/NA13 组合层）——两个 DTO 函数是纯函数，可独立于编排先验证。
3. 以不转发合成 transport 直连真实 `runProbe` 的六端点/401/G1 门静态行为试验属于 CR-2 测试装配范围（但接入私有 session、latch、per-attempt 检查需要 §4 裁定落地后才有完整意义）。
4. CR-2 新导入树的 guard 证据（加载期/正控/恢复）重做，槽名清单重新列名（§3.9）。

## 6. 下一步与停止点

- **下一步（不在本任务内）**：将 §4 的 G1–G7 交 Codex 技术裁定；裁定落地并获准后，才在获准范围内最小化改 CR-1 并实施 CR-2 白名单文件。本报告不预写任何 CR-1 改动方案文本的定稿，也不授权实施。
- **停止点**：本报告与 SOURCE-INVENTORY.json 追加提交、普通显式 refspec push、`git ls-remote` 核对完整远端 SHA 后停止，交 Codex。
- 冻结线不变：S4、预签约 S2–S6、H4-c C2/C3、07B 执行、集成/合并、HTTP/UI、真实支付/退款、设备/生产云、部署上线；本地 Windows ACL 任务只接收既有回报，不重派；CR-3、E1/E2 继续冻结。

## 7. 本轮实际执行与运行边界

- Git 网络操作（实际发生）：`git fetch origin`、远端查询（`git ls-remote`）、`git push`。
- Git 元数据与工作树写入（实际发生）：`worktree add` 与分支创建、FETCH_HEAD/remote-tracking refs 更新、`commit`。
- 只读静态操作：`rev-parse`/`cat-file`/`ls-tree`/`show` 对象读取、固定对象原字节 SHA-256 与字节数计算、文档与源码阅读。
- **执行为零（本任务确实未运行）**：项目代码、Node 测试、guard、构建、项目 CLI（旧 probe/checker CLI）、PowerShell 预检、业务网络、HTTP/UI、设备探针。
- 本机环境与权限自述（工作区沙箱边界、ACL 诊断、完全访问切换）为 Harness 交付方自述，不构成 Codex 独立核验事实，也不构成本会话权限或业务授权。
- 未读取任何真实配置、凭据、证书、SID、计划任务或秘密材料；本报告与 JSON 只含源码路径、提交/blob/字节/哈希与静态导出名。
- 主工作树与既有分支零改动；新增文件仅限本文档与 `docs/evidence/hk-ai-08-cr2-preflight/SOURCE-INVENTORY.json`。

## 8. 修订记录（Codex 裁定回写，2026-11-23）

依据 Codex 技术裁定提交 `716b1f0053d5ad34b45fc78d5cf79e5739f2aa36`（`docs/tasks/HK-AI-08-CR2-INTERFACE-DECISIONS-2026-11-23.md`、`docs/evidence/hk-ai-08-cr2-preflight/CODEX-REVIEW-2026-11-23.md`）对本文追加勘误；仅修改本文档，`SOURCE-INVENTORY.json` 相对固定基线 `1d726020756460ffb368dd2f92b895306c3243b4` 保持零差异。本文形成时第 3 行的“交 Codex 技术裁定后停止”为交付时点状态，本次回写即该裁定的落实，原句不改写。

- **CR2-PF-01（P2）**：§4 G7 行改写——保留 plan 已有 COMPLETED/FAILED/UNKNOWN/INVALIDATED 终态事件与 session 已有 MEMORY_WRITE/MEMORY_READ/SEALED/CLOSED/FAILED 事件事实；缺口收窄为 probe-invoke/wrapper/downstream 等请求窗口编排事件及其与已有生命周期的组合证据。全文无其它“事件止于 ACTIVE”的相反表述。
- **CR2-PF-02（P2）**：§3.5 不再标注 G5，改为关联 G2/G6；G1–G7 编号以 §4 表格为唯一定义，G5 仅指 G1 identityConfirmed 私有状态与门禁。G1–G7 技术结论未变，未新增任何接口方案。
- **CR2-PF-03（P3）**：§0 与 §7 明确 Git 网络操作（fetch/远端查询/push）与 Git 元数据/工作树写入（worktree add、refs、commit）实际发生，不再统称只读或零网络；“执行为零”仅限定于本任务确实未运行的项目代码、Node 测试、guard、构建、项目 CLI、PowerShell 预检、业务网络与设备操作；本机环境与权限自述已明确为交付方自述，不写成 Codex 独立核验事实。
- **导出口径**：§2 明确 CR-1 六个新增模块 20 个显式导出、固定外部 checker 2 个、组合盘点 22 个。
