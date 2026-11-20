# HK-AI-04 H4-c C1 S4 前置核对与执行清单（2026-11-20）

> 状态：**前置核对/文档准备；S4 未开工；本文件不是 S4 授权，也不自批。结论为 NOT READY（D10 未获批准；M23 无执行入口；G1 门禁落点待 Codex 确认；`store.data` 旁路待定）。**
>
> 文件性质：**原任务卡 §8 的执行核对清单，不是重复设计审批卡。** 不重开 18 refs、3/2 业务写 + 唯一 audit = 4/3、D4b/D5、observedAt、S2 错误码、S3 五项裁定；不重跑 S1/S2/S3；不修改生产代码/测试/Store/guard/设计/原任务卡。
>
> 执行者：DSH 根代理 `lead`（`deepseek-flash`）。
>
> 原前置 run / session：`hrun-mworlgg2-4d0901` / `session-85d1620b-a49f-44c9-a1db-5f92c300741b`（2026-11-20T17:16:23+08:00；本文档初稿）。
>
> 本轮续派 run / session：`hrun-mwotfctk-a36243` / `session-85d1620b-a49f-44c9-a1db-5f92c300741b`（2026-11-20T18:07:38+08:00 起；同一会话/分支/worktree，仅补本文档）。
>
> 工作树 / 分支：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\c1-s4-preflight` / `codex/h4c-c1-s4-preflight`（复用；已有交付 `f5932df`；当前 HEAD）。
>
> 固定基线 / 父：`49ca13ec77a94bce09a566ce1e42870accbcade7` / `5a13fcc86efd38bae3b8448ec1ad3864cbb94a8e`。
>
> 坐标约定：`卡:Lx` = 任务卡 r5 @ `49ca13ec` 第 x 行；`设计:Lx` = 设计 v8 @ `49ca13ec` 第 x 行；`勘误:Lx` = 勘误 r4 @ `49ca13ec` 第 x 行；`授权:Lx` = 授权清单 r2 @ `ed6f862` 第 x 行（仅 S0/S1 清单，S4 不在其授权范围）；`代码:Lx` = `admin-web/lib/store.mjs` @ `49ca13ec` 第 x 行；`H4C:Lx` = `admin-web/lib/face-service/h4c-evidence.mjs` @ `49ca13ec` 第 x 行；`集合:Lx` = `admin-web/lib/h4c-collections.mjs` @ `49ca13ec` 第 x 行；`C1测试:Lx` / `验证测试:Lx` / `审计测试:Lx` / `服务:Lx` 同理。固定链接见 §10。

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 固定对象 | 基线 `49ca13ec`、父 `5a13fcc`、远端 `origin/codex/h4c-c1-s3-implementation` = `49ca13ec`；`git fetch` exit 0；父链线性、无 merge；无前移/分叉。 |
| 已有交付（复用） | `f5932dfc950e4b32b0fe5810be0b4b86dd5216c5`；父 `c982905b6c65af3d213fc6c28f15520adc94866e`；本 worktree/branch；本轮只补 M30a/b 计数、G1 own键/Symbol、D10-A/B 标识与当前 run 身份，不重建。 |
| 重复运行/分支/worktree | 创建前无 `codex/h4c-c1-s4-preflight` 本地/远端分支、无同名 worktree；原 run `hrun-mworlgg2-4d0901`（已完成，交付 `f5932df`）与本轮 `hrun-mwotfctk-a36243` 同 session/分支/worktree；无其他 S4 queued/running；`schedule_list` 无 S4 任务；`list_agents` 仅 root。 |
| S3 关闭输入 | Codex 已独立验收 Stop-3 关闭：**66/66 + guard 8/8**；正常十字段、隐藏/Symbol 拒绝 `ADMISSION_REQUIRED`/409、两入口及 key/descriptor 不变覆盖；网络/监听/Provider 计数 0；三文件范围合规。本清单只记录，不重跑、不重审、不重复修复。 |
| S4 原定范围 | `transactFinal`、explicit audit、gate 注入、`#persist` 私有、`transact`/`change` 拒 H4-c、8 集合 + `admin_audit`、create-only/exact、≤90、M01–M30；白名单与预算见 §3。 |
| 预算 | C1 **18 refs**；helper 业务写 **3/2**；finalWriteSet **4/3**（含唯一 audit）；M30a 总 **3**（2 业务+audit1）、M30b 总 **4**（3 业务+audit1），总 3/4 已含 audit，禁止再加 audit；90 是 Store 单事务上限，**不是** C1 新预算；C2 27 不在 S4 实现。 |
| 基线缺口（只读） | `transactFinal`/`h4cGate`/`#persist` 在 `store.mjs` 均为 **0 命中**；`store.mjs` 未 import `isH4cCollection`；`transact`/`change` 仍自动写 audit；`collections`/`seed`/`init` 只登记 3 个 H4-c 集合，缺 5 个；`exactWriteCollections` 仅 3 个、`createOnlyCollections` 仅 2 个；`persist` 为 public（L268）。 |
| 硬阻断 | **D10 仍 OPEN（D10-A/D10-B）**：`#persist` 私有会破坏 `verification.test.mjs:381`，本清单另发现 `store-deterministic-audit.test.mjs:219–225` 也直接改写 `store.persist`；两份文件都需 Codex 明确纳入 S4 白名单/处置。未批准前 S4 不得开工（`卡:L741`、`授权:L139`、`勘误:L377`）。 |
| 未决/阻断项 | **M23 `seed` 非空拒绝无执行入口**（Store 无 `seed()` 方法，模块 `seed()` 为无参工厂，`代码:L127`）；**G1 `createH4cGate.verify` 未执行 §3.3c 要求的“唯一 audit/own键/Symbol/18 refs”**（`H4C:L1697–1724` 只调 `AdmissionValid`，未调 `validateH4cAdmission`；仅为接线建议、未实现，待 Codex 裁定）；**`store.data` public 可被外部篡改后再由非 H4-c `transact` 持久化**（旁路，见 §4.6）。 |
| 测试可行性 | 现有 S2 用例用 `store.transact` 写 H4-c（`C1测试:L336`、`L1556`、`L1576`、`L1587`、`L1634`、`L1646`、`L1657`、`L1676`），S4 一旦拒 H4-c 将全部失败；S4 必须改 fixture 设置路径但保留 S2 断言。Cloud fake 未串行化（`C1测试:L434–491`），M30 Cloud 需补串行 fake。 |
| 本轮动作 | 仅修订本文档（M30a/b 计数口径、G1 own键/Symbol/18 refs 待裁说明、D10-A/B 标识、当前 run 身份）；未改代码/测试/Store/guard/设计/卡；未运行任何实施测试/guard；未安装；未进入 S4；未动合同/供应商/预签约 S2/合并/HTTP/UI/真实支付/设备云/部署。 |

## 1. 固定输入、父链与远端

### 1.1 固定对象与身份

| 对象 | 固定读取点 | 完整 SHA / blob / 行数 | 说明 |
|---|---|---|---|
| 基线提交 | `49ca13ec` | commit `49ca13ec77a94bce09a566ce1e42870accbcade7`；tree `ce5bc68c50d82f265a481c86c813973c5a8721bc`；父 `5a13fcc86efd38bae3b8448ec1ad3864cbb94a8e` | S3 P2 最终提交；本分支起点（当前 HEAD 见“已有交付”） |
| 已有交付 | `f5932df` | commit `f5932dfc950e4b32b0fe5810be0b4b86dd5216c5`；父 `c982905b6c65af3d213fc6c28f15520adc94866e`；tree `116259be2802e3b2a12c3fcdd92403f12dc17a62`；doc blob `eea69b83b59e015a9bbece937a538e3b7569733f`；515 行 | 初稿 `c982905` + D10 细化；本轮续核对象 |
| 分阶段任务卡 r5 | `49ca13ec` | blob `080c590fb61112c3b061b4b26c9dc017f1bf5c73`；995 行 | S4 见 `卡:L739–787` |
| 设计 v8 | `49ca13ec` | blob `c4feffa5831f5bf0e04e8e902865cb8e1f1b0183`；1607 行 | 冲突优先级 §18 > §17 > §16 > §15 > §4–§14 |
| 勘误 r4 | `49ca13ec` | blob `c5797a075f15eadc59c31b80ef258a6717d0af3b`；384 行 | E1/E2/E3 + D4/D5 + D10/P5 |
| 授权清单 r2 | `ed6f862` | blob `5922ba81173639e341f7ba9651d7a2e3db4c094a` | 仅 S0/S1；S4 不在其授权范围（`授权:L105`、`L112`） |
| S3 证据 | `49ca13ec` | blob `65b8eab2d36549a6d247db5b3f461abcca4664bf`；1314 行 | S3-P2.3 66/66 + guard 8/8（`S3证据:L1270–1288`） |
| S3 前置清单 | `49ca13ec` | blob `411216badbefedfd1930dd029b529a7de057a261`；358 行 | D10 阻断 S4（`S3前置:L289`） |
| 模块 | `49ca13ec` | blob `ffad1fccdaba9ed2ce9dad5fade56889a5a20253`；1728 行 | `H4C` |
| Store | `49ca13ec` | blob `f99e9996ebbeee17f2599060765f707d3840671a`；524 行 | `代码` |
| 集合常量 | `49ca13ec` | blob `57d46ca6f3f90ea420826e0b9041a098d36a7daa`；38 行 | `集合` |
| C1 测试 | `49ca13ec` | blob `56114e97b7d0848c2c9496e6e5c8aa0b236296b6`；3564 行 | `C1测试` |
| 审计测试 | `49ca13ec` | blob `494b3ef5ab922095c21b14c6d02edff55487c839`；347 行 | `审计测试` |
| 验证测试 | `49ca13ec` | blob `7828c3a23158361f27d8b0b6ea0cac2e34d4bc0d`；478 行 | `验证测试` |
| Guard 七脚本 | `6f96fed` | commit `6f96fed9bd478192c8bbffeb52f47c90df89939e`；父 `403970a035be44bb04d0ce5c01154a103a5ec5c5` | `docs/evidence/h4c-c1-stop1-guard/`；哈希见 §6.1 |

### 1.2 父链（线性、无 merge）

| 提交 | 父 | 说明 |
|---|---|---|
| `f5932dfc950e4b32b0fe5810be0b4b86dd5216c5` | `c982905b6c65af3d213fc6c28f15520adc94866e` | 已有交付（D10 细化；当前 HEAD） |
| `c982905b6c65af3d213fc6c28f15520adc94866e` | `49ca13ec77a94bce09a566ce1e42870accbcade7` | 已有交付初稿 |
| `49ca13ec77a94bce09a566ce1e42870accbcade7` | `5a13fcc86efd38bae3b8448ec1ad3864cbb94a8e` | S3 P2 修复（本基线） |
| `5a13fcc86efd38bae3b8448ec1ad3864cbb94a8e` | `13298d4b90a2de6b8e32a6de4d14cec37eeaa2b1` | S3 授权 helper |
| `13298d4b90a2de6b8e32a6de4d14cec37eeaa2b1` | `6acceb0d354780560dfd95d9b1f0d7690e94f127` | S3 前置修订 |
| `6acceb0d354780560dfd95d9b1f0d7690e94f127` | `923dbf10317798aa82a146c58173a15c0590aa6e` | S3 前置清单 |
| `923dbf10317798aa82a146c58173a15c0590aa6e` | `0b7eca2a676a337b656afcfa89f1a92490828ff1` | S2 链层（Stop-2 已关闭） |

- `git log -3 49ca13ec` 输出父链完整 SHA；`git rev-list --merges 5a13fcc..49ca13ec` = 0（本清单以命令记录，未改历史）。
- S3 证据页写“未获 Codex 独立复审”；本清单按用户本轮外部结论记录 **Stop-3 已关闭**，不重开该页、不补写通过记录、不重跑。

### 1.3 远端、fetch、工作树与重复检查

| 项 | 实测 | 结果 |
|---|---|---|
| 原前置 `git fetch origin codex/h4c-c1-s3-implementation codex/h4c-c1-s3-preflight codex/h4c-c1-s3-preflight-review main` | exit **0**（`-c http.sslBackend=openssl`） | 固定 ref 已取回；未改全局 Git/TLS |
| 本轮续派 `git fetch origin codex/h4c-c1-s4-preflight codex/h4c-c1-s3-implementation` | exit **0**（`-c http.sslBackend=openssl`） | 已有交付与 S3 基线已取回；未改全局 Git/TLS |
| `git ls-remote origin refs/heads/codex/h4c-c1-s3-implementation` | `49ca13ec77a94bce09a566ce1e42870accbcade7` | 与固定基线一致 |
| `git ls-remote origin refs/heads/codex/h4c-c1-s4-preflight` | `f5932dfc950e4b32b0fe5810be0b4b86dd5216c5` | 已有交付；本轮续派前与 HEAD 一致，无前移/分叉 |
| `origin/main` | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` | 仅记录，不合并、不比较业务 |
| 工作树 | `HEAD=f5932df…`；`branch=codex/h4c-c1-s4-preflight`；父 `c982905…`；`git status --porcelain` 为空 | 复用；干净；无 upstream |
| 重复运行 | 原 run `hrun-mworlgg2-4d0901`（completed，交付 `f5932df`）与本轮 `hrun-mwotfctk-a36243`（running）同一 session/分支/worktree；另一 running `hrun-mwotfce0-24ce27` 为 rental，不命中 C1 S4；无其他 S4 queued/running | 无重复任务 |
| 定时任务 | `schedule_list` 仅“SMART-PM 工作进度汇报”与一个已结束探针任务 | 无 S4 任务 |
| 子代理/作业 | `list_agents` 仅 root；`job_list` 为空 | 无并行 worker |

### 1.4 文档身份

| 文件 | blob | 行数 | 与 S3 阶段关系 |
|---|---|---:|---|
| 任务卡 r5 | `080c590f…` | 995 | 与 S3 同一 blob，S4 未改卡 |
| 设计 v8 | `c4feffa5…` | 1607 | 与 S3 同一 blob |
| 勘误 r4 | `c5797a07…` | 384 | 与 S3 同一 blob |
| 授权清单 r2 | `5922ba81…` | 616 | 仅 S0/S1 清单，S4 未授权 |
| S3 证据 | `65b8eab2…` | 1314 | S3-P2 追加，未改 |
| S3 前置 | `411216ba…` | 358 | 只引用 D10/边界 |

## 2. 已关闭输入与不再重开

| 项 | 内容 | 状态 | 本清单处置 |
|---|---|---|---|
| S2 Stop-2 | `923dbf1`；53/53 + guard 8/8；Store/路由/生产接线零差异 | **ACCEPTED/CLOSED（外部结论）** | 只引用；不重跑、不重开链层 |
| S3 Stop-3 | `49ca13ec`；66/66 + guard 8/8；十字段、隐藏/Symbol 拒绝 `ADMISSION_REQUIRED`/409、两入口及 key/descriptor 不变覆盖；网络/监听/Provider 计数 0；三文件范围合规 | **ACCEPTED/CLOSED（外部结论；`S3证据:L1270–1288`）** | 只记录；不重跑、不重复修复、不重复测试/guard |
| E1/D2 | C1 **18** refs / C2 R1 **27**；writes 3/2；proof 只读 ref | APPROVED（`授权:L120`、`勘误:L59–63`） | 保留；S4 不新增 ref |
| E2/D3 | 8 个 H4-c 集合字面名 + `admin_audit` 通用边界 | FROZEN（`授权:L121`、`卡:L124–139`） | `集合:L9–27` 已实现；S4 只引用 |
| E3/D7 | `transactFinal`、`createH4cGate`、构造注入、`#persist` 私有、`h4c-collections.mjs` | FROZEN（`授权:L122`、`勘误:L235–282`） | S4 按此接线；不新增 API |
| P9 | 私有 Set + `isH4cCollection` + 冻结枚举快照；不得导出 Set | APPROVED（`授权:L123`、`集合:L29–37`） | S4 不重开；只 import 谓词/审计常量 |
| D4a | proof `status="verified"` / `legacyCount=0` / snapshot | APPROVED/CLOSED（`授权:L124`） | S4 不重开；M14a 只验证 gate 传播 |
| D4b | C1 audit `scopeKey=job._id` / genesis / append / revision=新 sequence / targetList | APPROVED/CLOSED（`授权:L125`） | S4 只验证 Store 不篡改已物化 audit |
| D5 | runtime `operationAuthDigest` 显式 `null` + ticket 签名 + runtime 白名单 | APPROVED/CLOSED（`授权:L126`） | S4 只验证 Store 不绕过 gate |
| D6 | `evidenceAppendRefs` / `appendEvidenceWrites` 形状 | FROZEN（`授权:L127`） | S4 不重写 helper；只在 Store 测试中调用 |

- **不重开**：18 refs、3/2 + 唯一 audit 4/3、canonical sorted digest、`operationAuthDigest` 显式 `null`、S2 链/错误码、S3 五项裁定、observedAt 相等允许/递减禁止。
- **不重派**：S1/S2/S3/映射/guard 已关闭；本清单不请求重新验收这些段。

## 3. S4 白名单、依赖、接口与预算

### 3.1 依赖与授权状态

| 依赖 | 当前状态 | 对 S4 的影响 |
|---|---|---|
| S3 Stop-3 | **CLOSED（外部）** | 可进入 S4 前置；但 S4 仍须单独授权 |
| E2/E3/P9 | **FROZEN/APPROVED** | 白名单/接口/私有 Set 不再设计复审 |
| D10 persist 私有影响 | **OPEN**（`卡:L972`、`授权:L139`、`勘误:L377`） | **硬阻断 S4**；本清单给出最小方案，仍需 Codex 批准 |
| D8 N 矩阵归属 | OPEN | 阻断 S6，不阻断 S4（`卡:L970`） |
| D9 设计批准口径/实施分支名 | 设计批准已关闭；S4 分支/起点未派单 | 本 preflight 分支不得复用为 S4 实施分支；S4 起点以单独授权完整 SHA 为准 |
| D11 真实 Cloud 并发 | OPEN（C3） | S4 只做 fake 语义；证据标注未验证 |
| S4 本轮单独授权 | **NOT GRANTED**（`授权:L112`、`L503–506`） | 未授权不得开工；本文件不是授权 |

### 3.2 准确文件白名单（S4 实施，不是本任务）

| 动作 | 文件 | 约束 |
|---|---|---|
| 修改 | `admin-web/lib/store.mjs` | 唯一 Store 接线点；不得改 HTTP/路由 |
| 修改 | `admin-web/lib/h4c-collections.mjs` | 预期不改；不得导出 Set/新增集合/第二套字面量 |
| 修改 | `admin-web/lib/face-service/h4c-evidence.mjs` | 仅 gate 接线/复用 S3 validator；不改链层语义、不新增初始化入口 |
| 修改 | `admin-web/lib/face-service/index.mjs` | 只增/调整 re-export；无 bootstrap/create-domain/init 入口 |
| 修改 | `admin-web/tests/face-h4c-evidence.test.mjs` | 加/改 S4 断言与 fixture；不得改 S2 断言或弱化零写 |
| 条件修改 | `admin-web/tests/store-deterministic-audit.test.mjs` | 卡面条件为“仅当 additive gate 改动使其需要补断言；不得弱化既有断言”（`卡:L750`）；**D10 的 persist fixture 改动不在该条件字面范围内，需 Codex 扩白名单** |
| 条件修改 | `admin-web/tests/verification.test.mjs` | **仅当 D10 选择“改 fixture”**；只替换 `store.persist` 直调，不改 identity 断言（`卡:L751`） |
| 追加 | `docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-EVIDENCE-2026-11-19.md` | 只追加 S4 小节；不改历史 |
| 禁止 | `admin-web/server.mjs`、`admin-web/lib/face-service/routes.mjs`、设计/勘误/任务卡/授权/package/lock/其他测试 | 零 diff；不得“顺手修” |

- 白名单是**闭集**；新增任何文件/依赖/脚本需重新授权（`卡:L743–752`、`授权:L254`）。
- **本任务**允许文件只有本文档：`docs/tasks/HK-AI-04-H4C-C1-S4-PREFLIGHT-2026-11-20.md`。

### 3.3 冻结接口/字段

| 项 | 冻结内容 | 依据 |
|---|---|---|
| `LocalStore` 构造 | `new LocalStore(directory, { h4cGate = null } = {})`；`#h4cGate` 私有，构造后不可替换；非 null 缺 `verify` → `TypeError` | `卡:L286–301`、`勘误:L237–243` |
| `CloudStore` 构造 | `new CloudStore(app, { h4cGate = null } = {})`；同上 | `卡:L294–301` |
| `transactFinal` | `async transactFinal(refs, build, admission, { now, auditMode = "explicit" } = {})`；唯一 H4-c explicit 入口 | `卡:L289`、`L297`、`L302` |
| `transact` | `async transact(refs, build, audit)`；legacy，仅非 H4-c；H4-c refs → `ADMISSION_REQUIRED`，不 build/不写 | `卡:L314`、`勘误:L260` |
| `change` | `async change(name, id, build, audit)`；H4-c name → `ADMISSION_REQUIRED`，不 build/不写 | `卡:L315`、`勘误:L262` |
| `#persist` | 私有；仅 `init`/`transact`/`transactFinal` 内部调用；不暴露 `persist` 别名 | `卡:L316`、`勘误:L264` |
| `seed()` | 8 个 H4-c 集合只允许空数组；任一非空 → `ADMISSION_REQUIRED`；非 H4-c 默认值不变 | `卡:L317`、`设计:L171` |
| `init()` | 缺失 H4-c 数组仅内存补 `[]`；已有非数组 → `EVIDENCE_INVALID`（不修复）；已有非空原样保留；不写记录 | `卡:L318`、`设计:L172` |
| `list/get` | 只读；无 gate；不得作为写入/授权依据 | `卡:L151`、`L173` |
| `admin_audit` | 精确 7 字段：`_id, orgId, actorId, actorType, action, target, createdAt`；`_id` 前缀/32 hex；target 为排序业务目标；createdAt 同一 `now` | `卡:L325`、`H4C:L664`、`H4C:L862–916` |
| C1 refs | **18** = domain2 + proof1 + audit1 + fence1 + marker1 + writerPlan1 + anchor1 + head1 + E1..9；唯一、稳定 | `卡:L185`、`勘误:L59–63`、`H4C:L337–402` |
| C1 writes | helper 业务写 **3/2**；finalWriteSet **4/3**（+唯一 audit）；ticket 0 新增 refs | `卡:L197`、`L735`、`H4C:L1490–1520` |
| gate | `createH4cGate({ config, health = {} })`；返回冻结对象仅 `verify`；成功 `undefined`，失败抛 `HttpError`；不读环境/时钟 | `卡:L268–281`、`H4C:L1687–1728` |
| Store import 边界 | `store.mjs` 只 import `isH4cCollection` 与 `H4C_AUDIT_COLLECTION`，不 import Set/face-service；`h4c-evidence.mjs` 只 import 字面名/谓词 | `勘误:L204`、`集合:L1–38` |
| 错误码/status | admission/ticket/audit/legacy H4-c → `EVIDENCE_CHAIN_ADMISSION_REQUIRED`/409；proof 本体 → `PROOF_REQUIRED`/409；fence → `HALTED`/`FENCE_EXPIRED`/409；shape → `EVIDENCE_INVALID`/409；create-only → `CONFLICT`/409；>90 → 400 容量 | `卡:L401–425`、`H4C:L637–660` |

### 3.4 refs/writes 预算（不把 90 当 C1 预算）

| 项 | 值 | 说明 | 依据 |
|---|---:|---|---|
| C1 refs | **18** | domain2 + proof1 + audit1 + fence1 + marker1 + plan1 + anchor1 + head1 + E1..9 | `卡:L185`、`勘误:L59–63` |
| helper 业务写 | **3/2** | 首条 anchor+E1+head；非首条 E+head | `卡:L197`、`H4C:L412–605` |
| finalWriteSet | **4/3** | 业务写 + 恰好 1 条 `admin_audit` | `卡:L709–713`、`H4C:L1490–1520` |
| ticket 新增 refs | **0** | ticket 字节不落库 | `卡:L723` |
| 单事务上限 | **90** | Store 容量上限；不是 C1 预算，不得据此扩大 C1 refs | `卡:L307`、`L760`、`设计:L1294` |
| C2 R1 | 27 | 仅预算引用；S4 不实现/不测试 C2 形状 | `勘误:L62`、`卡:L186` |
| 域/proof/fence/marker/plan 写 | **0** | C1 runtime 只读；写这些 → `ADMISSION_REQUIRED`（M13） | `卡:L328`、`L348` |

- S4 不得因“90 上限”新增 refs；M16 的 91 refs 负向只验证上限，不改变 C1 18。
- 18/27 已批准；S4 不新增第 19 个 ref、不新增集合/索引/epoch 计数记录。

### 3.5 允许测试范围（S4 实施时；本清单只准备命令）

- **C1 定向**：`admin-web/tests/face-h4c-evidence.test.mjs`，cwd `admin-web`，guard 内运行。
- **条件回归**：若改 `store-deterministic-audit.test.mjs`，运行该文件；若 D10 选择改 `verification.test.mjs`，运行该文件。三者均在 33 个非 HTTP 清单内，但 S4 只做定向运行，不做 33+7 全量。
- **不跑**：33+7 全量、8 个 HTTP 文件、`npm test`、glob、任何服务/监听；S6 才跑全量。
- **新增被加载文件**必须先进非监听集；否则 Stop-4 失败（`授权:L416`、`L486`）。

## 4. Store 实际路径、审计、终检、回滚与旁路（只读核对）

### 4.1 Store 实际入口盘点（`49ca13ec`）

| API/路径 | LocalStore | CloudStore | 基线行为（代码） | S4 必须 |
|---|---|---|---|---|
| 构造 | `constructor(directory)` `代码:L232` | `constructor(app)` `代码:L380` | 无 gate 参数；`this.directory`/`this.queue` public；Cloud `this.app`/`this.db` public（`代码:L381–382`） | 加第二参 `{ h4cGate = null }`；`#h4cGate` 私有；保持旧调用兼容 |
| `init` | `代码:L236–267` | 无 | 读文件/seed；仅补 `property_catalog`、file 集合与 3 个 H4-c 数组（`代码:L247–265`）；非数组不报错 | 补 8 个 H4-c 数组；已有非数组 → `EVIDENCE_INVALID`；不写记录 |
| `persist` | `代码:L268–272` | 无 | **public**；tmp+rename；`init`/`transact`/`change` 直调 L245/L338/L371 | 改 `#persist`；移除 public 入口（D10） |
| `list` | `代码:L273–278` | `代码:L384–403` | Local 任意集合；Cloud 校验 `collections` 数组（L385） | 8 个 H4-c 名字必须进 `collections`；只读无 gate |
| `get` | `代码:L281–286` | `代码:L409–424` | Local 任意；Cloud 校验 `collections`（L410） | 同上 |
| `transact` | `代码:L287–343` | `代码:L425–491` | 保留旧签名；**自动 unshift audit**（Local L330–337、Cloud L471–489）；H4-c 不拒绝；Local 仅在 deterministic audit 分支检查 90（`代码:L90–100`），Cloud 始终检查（L428–429） | H4-c refs 在 build 前拒绝；build 返回 H4-c 未声明写 → `ADMISSION_REQUIRED`；非 H4-c 行为不变 |
| `transactFinal` | **不存在（0 命中）** | **不存在（0 命中）** | — | 新增唯一 explicit 入口；不自动 audit；校验 finalWriteSet/gate；原子提交 |
| `change` | `代码:L344–377` | `代码:L492–523` | 任意集合；自动 audit（Local L365–370、Cloud L515–520）；Cloud 对新建先 `build(null)`（L494） | H4-c name 在 build 前拒绝；非 H4-c 不变 |
| `seed` | 模块函数 `代码:L127–230` | 同左 | 无参工厂；H4-c 仅 evidence/head/domains（L225–227） | 补 5 个 H4-c 空数组；非空拒绝路径见 M23 未决 |
| `store.data` | public 属性 `代码:L239/L247–265` | 无（Cloud 用 db） | 外部可改内存；后续 `transact`/`change` 的 `structuredClone(this.data)`（L290/L346）会把改动一起持久化 | 旁路，见 §4.6；需 Codex 定信任边界 |
| `store.directory` | public `代码:L233` | 无 | 可直写 `demo-data.json` | 旁路；测试 fixture 可用，生产信任边界待定 |
| `CloudStore.db` | — | public `代码:L382` | 可直连 DB，绕过 gate | 设计 P0 直连 DB 旁路（`设计:L174`），不属 S4 新关闭 |
| `prepareDeterministicAudit` | `代码:L90–100` | 同左 | `uniqueRefs` 静默去重；仅 deterministic audit 检查 90 | `transactFinal` 不得复用它；重复 refs 必须拒绝 |
| `uniqueRefs` | `代码:L83–89` | 同左 | Map 去重，不校验 shape | `transactFinal` 先查 shape/重复，再读 state |
| `exactWriteCollections` | `代码:L104–108` | 同左 | 仅 evidence/head/domains | 补 anchor/admin_audit 等；C1 写必须 exact，不注入 `updatedAt` |
| `createOnlyCollections` | `代码:L111–114` | 同左 | 仅 evidence/domains | 补 anchor/audit proof/marker/plan；head/fence 可更新；plan status 特殊 |

### 4.2 实际调用方（生产 vs 测试）

| 范围 | 调用点 | H4-c 写入 | S4 影响 |
|---|---|---|---|
| 生产 `server.mjs` | `new LocalStore(directory)` L156；`store.transact` L225；`store.change` L1199/L1283；`new CloudStore(app)` L1379 | 0 | 构造第二参可省略；`transact`/`change` 仍非 H4-c；不受拒 H4-c 影响 |
| 生产服务模块 | `lib/blacklist.mjs` L93/L216/L271/L369/L638；`lib/files.mjs` L451/L547/L568/L607/L709/L927/L1005/L1114/L1162；`lib/identity.mjs` L191；`lib/occupancies.mjs` L700/L975；`lib/property.mjs` L76/L137/L171/L215/L277/L326/L387/L430；`lib/face-service/h3a.mjs` L287；`h3b.mjs` L243/L290/L412/L460 | 0 | 均使用非 H4-c 集合；S4 拒 H4-c 不影响 |
| 脚本 `scripts/check-sdk.mjs` | `new CloudStore(app)` L12；`change` L40/L62；`transact` L74 | 0 | 非 H4-c；不受影响 |
| C1 测试 | `C1测试:L336` `insert` 用 `store.transact` 写 domain；L1544–1605/L1607–1685 用 `store.transact` 写 evidence/domain/head；L1556/L1576/L1587/L1634/L1646/L1657/L1676 | 是（fixture 设置） | **S4 拒绝 H4-c 后会失败**；必须改 fixture 设置路径，保留 S2 断言 |
| C1 测试 helper | `runAppend` L374–413 直接 `applyWrites(store.data, writes)`（L411） | 直接内存，不是 Store | S4 不得把它当 Store 写路径；M01/M02 必须走 `transactFinal` |

- 生产 H4-c 写入点静态扫描 = **0**（8 个集合名在 `admin-web` 非 tests/非 h4c/store 文件中 0 命中）。因此 S4 的拒写不会破坏生产调用方；但会破坏 C1 测试现有 fixture。
- `store.data` 在大量测试中直接读写（如 `C1测试:L411`、`验证测试:L379`、`审计测试:L216`）；S4 若封装 `store.data` 会大范围破坏测试，且不在已批准 E3 范围。**不自行扩大**。

### 4.3 唯一 audit vs 自动 audit（冲突点）

- **基线自动 audit**：`transact` 在业务写后总是 `next.admin_audit.unshift(...)`（Local `代码:L330–337`；Cloud `代码:L471–489`），`change` 也总是写一条（Local L365–370；Cloud L515–520）。`transact` 的 deterministic audit 由 `prepareDeterministicAudit`/`auditRecord` 生成（L90–126），不是 explicit finalWriteSet。
- **S4 要求**：`transactFinal` 只写 `build(state)` 返回的 finalWriteSet，不得调用 `auditRecord`/`randomUUID`/`Date.now`，不得再 unshift 第二条 audit；`admin_audit` 必须恰好 1 条且已在 refs（`卡:L321–330`、`设计:L322`、`勘误:L270–277`）。
- **基线缺口**：`admin_audit` 不在 `exactWriteCollections`（`代码:L104–108`），若用通用写路径应用 audit，会走 `{ ...old, ...data, updatedAt: Date.now() }`（Local L326/Cloud L465），破坏 7 字段 exact 且可能合旧行。S4 必须为 explicit audit 单独 exact/create-only 应用，且不注入 `updatedAt`。
- **M08–M13** 是这条边界的逐例验收：0/2 条 audit、audit 不在 refs、字段/target/createdAt 错、未声明写、runtime 写 domain/proof/fence/marker/plan，全部 `ADMISSION_REQUIRED`/409 零写。

### 4.4 Gate 放置点与 finalWriteSet/ticket 终检

**基线事实**：`createH4cGate.verify`（`H4C:L1697–1724`）依次调用：
1. `AdmissionValid`（L1699）——校验 10 字段 admission、refs 唯一/≤90、writes 已声明/唯一/data._id、refsDigest/writesDigest/ticket；
2. proof 本体（L1703–1711）；
3. `CoverageValid`（L1715）；
4. `FenceValid`/`FenceExpired`（L1718–1722）。

**G1（必须由 Codex 确认落点；未实现，仅接线建议）**：`AdmissionValid` **不**检查“恰好 1 条 audit/7 字段/audit target/C1 3+2 业务集合”，也不执行 S3 P2 的 `assertExactAdmissionOwnKeys`（own键/Symbol 精确 10 字段）和 `assertCanonicalC1Refs`（18 refs 重建）。这些检查在 S3 的 `validateH4cAdmission`（`H4C:L1628–1660`）里通过 `inspectC1FinalWriteSet`（L1414–1480）、`assertCanonicalC1Refs`（L1527–1546）和 `assertExactAdmissionOwnKeys`（L1554–1570）完成，但 `createH4cGate.verify` 没有调用它。任务卡 §3.3c 要求 gate 检查“writes 声明/唯一 audit”（`卡:L281`），因此 S4 若只调现有 `gate.verify`，M08–M13 不能诚实通过。

- **建议的最小落点（不新增设计/API；未实现，待 Codex 裁定）**：在 `createH4cGate.verify` 内、`AdmissionValid` 之后调用已有的 `validateH4cAdmission({ admission, refs, writes, config: cfg })`（同模块已定义），用它完成 C1 **18-shape、own键/Symbol 精确 10 字段、唯一 audit/7 字段、3+2 业务集合、audit 字段**校验；`AdmissionValid` 可保留或由前者覆盖。该改动在 S4 白名单 `h4c-evidence.mjs` 内，复用 S3 已测 helper，不改链层/票据公式。
- **替代落点**：Store 侧自行校验；但 E3 冻结“`store.mjs` 只 import `isH4cCollection` 与 `H4C_AUDIT_COLLECTION`”（`勘误:L204`），Store 不能 import face-service validator，需复制 audit 字段/公式，违反单一来源，故不推荐。
- **需 Codex 裁定**：这是“S4 gate 接线”还是“重开 S3 gate”；若不允许改 `createH4cGate`，S4 必须在 Store 侧实现等价校验并说明 import 边界，否则 Stop-4 不通过。

**终检时机/顺序（S4 必须实现）**：
1. 校验 `auditMode==="explicit"`、gate 非空、admission 形状、`now` 安全整数、refs 形状/重复/≤90；失败均不 build。
2. 按 refs 读 state；`await build(state)`；要求返回数组。
3. **快照 finalWriteSet**（`structuredClone` 或等价深拷贝）；校验每项 `{collection,id,data}`、`data._id===id`、字段 exact、H4-c 子集、恰好 1 条 `admin_audit`、audit 7 字段/target/createdAt、所有写已声明、无未声明写；失败零写。
4. 用**同一快照**调 `#h4cGate.verify({state, refs, writes, admission, now})`；成功后才允许写入。
5. 只把该快照应用到 `next`/`tx`；不得再调用 `auditRecord`/`Date.now`/随机 ID；不得在 gate 成功后追加/修改写。
6. LocalStore 成功才 `#persist(next)` 并 `this.data=next`；CloudStore 成功才提交；失败整批回滚。

**post-validation 写集变化（S4-R2）**：若 `build` 返回带 getter/Proxy 的对象，gate 读到的 `writesDigest` 与应用时读到的字节可能不同。S4 必须对 build 结果做深拷贝快照，并只应用快照；或拒绝非 plain data。原卡 M01–M30 未单列该场景，本清单列为补充验收（不新增预算/不扩大范围），请 Codex 确认是否纳入 Stop-4。

### 4.5 原子回滚、事务重试、并发

| 机制 | 基线事实 | S4 要求/验收 |
|---|---|---|
| LocalStore 原子性 | `transact`/`change` 先 `structuredClone(this.data)`（L290/L346），在 `next` 上 build/写，`#persist` 成功后才 `this.data=next`（L338–339/L371–372） | `transactFinal` 同构；失败不得改 `this.data`、不得改文件；M03–M17/M30 每个负向快照 `store.data` + `demo-data.json` sha256 |
| LocalStore 队列 | `this.queue = this.queue.then(...)`，`this.queue = task.catch(()=>{})`（L234/L289/L341/L345/L375） | `transactFinal` 必须入同一队列；失败不破坏后续事务；并发同 head 一胜 |
| CloudStore 原子性 | `this.db.runTransaction(async tx => ...)`（L430/L504）；fake 以 staged Map 提交（`C1测试:L442–467`） | `transactFinal` 必须在同一 transaction 内读 state/build/写；失败不提交；fake 断言 staged 未提交 |
| 事务重试 | CloudBase `runTransaction` 可重跑 callback；审计测试 fake 有 `replay`（`审计测试:L31–45`、`L230–241`） | `build` 必须纯/可重跑；同一 admission/now 下重跑写集必须稳定；重跑不得产生双 audit/双业务写；建议 S4-R1（`replay=2`，build 计数 2，最终 1 业务行 + 1 audit） |
| 并发（Local） | 单进程队列串行；不是多进程/多实例 | M30 两 `transactFinal` 同 head：append 败者 `EVIDENCE_HEAD_CONFLICT`/409，genesis 败者 `EVIDENCE_CHAIN_BROKEN`/409；败者零写；胜者恰好 1 anchor/E/head/audit |
| 并发（Cloud） | 测试用 fake，不是真实 CloudBase；`C1测试` fake 未串行化，两个并发 `runTransaction` 会各自 clone 同一 `records`，后提交覆盖先提交 | S4 测试 fake 必须串行化（队列）或实现冲突检测，否则 M30 Cloud 不能一胜；真实 Cloud 并发/重试语义 **C3 未验证**，不得声称 |

- **LocalStore 模拟 vs 真实 Cloud**：S4 可证明 LocalStore 真实文件回滚/队列语义；CloudStore 只证明“调用 `runTransaction` 的代码路径 + fake 事务 staged/回滚语义”，不能证明真实 CloudBase 并发、隔离级别、callback 重试次数。证据必须分列。

### 4.6 全路径门禁与旁路清单

| 路径 | 现状 | S4 门禁 | 旁路/待定 |
|---|---|---|---|
| `list/get` | `代码:L273–286` / `L384–424` | 只读无 gate；Cloud 需 8 个 H4-c 名字进 `collections`（当前缺 5 个） | `store.data` 直读绕过；`get` 返回 clone，不能作授权依据 |
| `transact` | 自动 audit；H4-c 可写 | refs 含 H4-c 在 build 前 `ADMISSION`；build 返回 H4-c 未声明写 → `ADMISSION`；非 H4-c 不变 | 当前 `Undeclared transaction write` 是裸 `Error`（L315/L456），S4 必须映射为 `ADMISSION`；`store.data` 可夹带 |
| `change` | 自动 audit；任意集合 | H4-c name 在 build 前 `ADMISSION`；非 H4-c 不变 | 同上 |
| `transactFinal` | 不存在 | 唯一 explicit 入口；gate 终检；只写 finalWriteSet | 必须防止 `build` 返回的引用在 gate 后被改（深拷贝快照） |
| `#persist` | public `persist` | 改私有；外部 `store.persist===undefined`；无别名 | D10：两份测试直调/改写；`store.directory` 仍可直写文件 |
| `seed` | 模块无参工厂；3 个 H4-c 空数组 | 8 个 H4-c 空数组；非空拒绝 | M23 无执行入口（见 §5） |
| `init` | 只补 3 个 H4-c；非数组不报错 | 补 8 个；非数组 `EVIDENCE_INVALID`；非空保留；不写记录 | 现有数据文件若已损坏，S4 不修复（按设计） |
| `store.data` | public 内存对象 | 不在 E3 冻结范围 | **真实旁路**：外部 `store.data[H4C.x].push(...)` 后调用任意非 H4-c `transact`，`structuredClone(this.data)` 会把该记录持久化。S4 无法在“不改 `store.data`/不新增 API”下完全关闭；需 Codex 明确是否视为受信内部/测试 seam，或批准完整性检查/封装（均为额外范围）。 |
| `store.directory` | public | 测试 fixture 可用 | 可直写 `demo-data.json`，与直连 DB 同类；P0/信任边界，不是 D10 单独能消除 |
| `CloudStore.db/app` | public `代码:L381–382` | 不用于 C1 写 | `store.db` 可直连 DB 绕过 gate；设计 P0 撤凭据/权限（`设计:L174`），S4 不改 |
| `prepareDeterministicAudit`/`uniqueRefs` | 去重/自动 audit | `transactFinal` 不得复用；重复 refs 必须 `EVIDENCE_INVALID` | 若复用会静默去重，M 矩阵 refs 形状无法诚实通过 |

**结论**：`#persist` 私有化只关闭“public persist 方法直调”这一条；`store.data`/`store.directory`/`CloudStore.db` 是不同层级的旁路，不能声称已由 D10 关闭。S4 的 Stop-4 若要写“无旁路”，必须先由 Codex 给出信任边界裁定；本清单不自行扩大 S4 去封装 `store.data`。

### 4.7 D10：原文、证据、受影响接口与最小方案

**原文/证据**：
- 任务卡 D10：`#persist` 私有会破坏 `verification.test.mjs:381` 直调；建议 S4 改该测试为 `init()` 前写 `demo-data.json`（仅 fixture），或批准其他等价方案（`卡:L972`）。
- 勘误 P5/D10：同一建议；需批准将该测试纳入 S4 允许文件（`勘误:L296`、`L363`、`L377`）。
- 授权清单：public `persist` 在 `store.mjs:268`；`verification.test.mjs:381` 直接 `store.persist(store.data)`；D10 **OPEN**，阻断 S4（`授权:L62`、`L139`、`L576`）。
- 任务卡白名单：`verification.test.mjs` 仅当 D10 选择“改 fixture”；只替换 `store.persist` 直调，不改 identity 断言（`卡:L751`）；`store-deterministic-audit.test.mjs` 仅当 additive gate 改动需要补断言，不得弱化（`卡:L750`）。

**基线受影响接口（实际调用方）**：

| 调用方 | 行 | 用法 | `#persist` 后结果 |
|---|---:|---|---|
| `verification.test.mjs` | L379–381 | 改 `store.data.identity_domains`，再 `await store.persist(store.data)` | `store.persist` undefined → TypeError；测试失败 |
| `store-deterministic-audit.test.mjs` | L219–225 | `const persist=store.persist.bind(store); store.persist=async()=>{throw Error("audit persistence failed")}; ...; store.persist=persist` | `store.persist.bind` 先 TypeError；且无法再注入持久化失败 |
| `store.mjs` 内部 | L245/L338/L371 | `init`/`transact`/`change` 调 `this.persist` | 必须改为 `this.#persist`；行为不变 |

- **D10 原文只列了 `verification.test.mjs:381`，未列 `store-deterministic-audit.test.mjs:219–225`。** 后者是第二个实际调用方；不纳入 D10，S4 无法在“public persist 必须消失”的前提下让该测试继续通过。这是本清单新增的精确缺口。

**最小方案（保留原断言、消除 public persist 逃逸口）**：

1. **D10-A** — `verification.test.mjs:381`：
   - 删除 `store.persist(store.data)` 直调；在测试内加一个 fixture helper（仅 LocalStore 测试用）：
     ```js
     import { writeFile, rename } from "node:fs/promises";
     import { join } from "node:path";
     async function persistDemoData(store) {
       const file = join(store.directory, "demo-data.json");
       await writeFile(file + ".tmp", JSON.stringify(store.data), { mode: 0o600 });
       await rename(file + ".tmp", file);
     }
     ```
   - 把 L381 改为 `await persistDemoData(store);`。保留 L379 的 `store.data.identity_domains` 过滤、L382–389 的全部 `assert.rejects`/状态断言；不改 identity service 断言。该 helper 是测试 fixture，不是生产 API；与 `#persist` 相同的 tmp+rename 字节落盘，保留“legacy 数据已持久化”的场景。
   - 若更严格地要求“重启后读回”，可在写完后 `new LocalStore(store.directory).init()` 断言文件内容；但当前测试继续用同一实例，无需新增重启，避免扩大改动。

2. **D10-B** — `store-deterministic-audit.test.mjs:219–225`：
   - 删除对 `store.persist` 的赋值；改为在测试内临时把 `store.directory` 定义成抛 `audit persistence failed` 的 getter，让真实的 `#persist` 在读取 `this.directory`（`代码:L269`）时抛出同一错误；`finally` 恢复原 data property。保留原错误消息与全部断言：
     ```js
     const directory = store.directory;
     Object.defineProperty(store, "directory", {
       configurable: true,
       get() { throw Error("audit persistence failed"); },
     });
     try {
       await assert.rejects(
         () => store.transact([ref("rooms", write.id), auditRef()],
           () => [write], audit()),
         /audit persistence failed/,
       );
     } finally {
       Object.defineProperty(store, "directory", {
         value: directory, writable: true, enumerable: true, configurable: true,
       });
     }
     ```
   - 该方式不改 `store.mjs`、不保留 public `persist`、不删除/放宽任何断言、不 patch 全局内建模块、无跨测试副作用；`#persist` 在 `writeFile` 之前抛错，`this.data` 不被赋值，`store.get("rooms",...)`/`store.get("admin_audit",...)` 仍断言 null（L226–227）。`store.directory` 仍是 public 属性（§4.6 的独立旁路），本方案只是测试内临时遮蔽，不是生产 API。
   - 若 Codex 不接受测试内遮蔽 `store.directory`，可退而用“删除/改坏目录使真实 `writeFile` 抛 ENOENT/EACCES”的 fixture；但那会把错误消息断言改为 OS 错误，属于改断言，不推荐。

3. **白名单处置**：`verification.test.mjs` 已由 D10 条件覆盖；`store-deterministic-audit.test.mjs` **不在 D10 原文**，卡面条件（additive gate）也不覆盖 persist fixture，故必须由 Codex **明确批准**将该文件纳入 S4 白名单的“D10 fixture-only 改动”，并确认“不得弱化既有断言”仍成立。未批准前 S4 **BLOCKED**。

4. **禁止的替代**：保留 public `persist` 作为测试逃逸口；删除 `store.persist` 相关测试；把拒绝断言放宽为“任意错误”；让 `persist` 只对测试目录开放。这些均不满足“消除 public persist 逃逸口 + 保留原断言”。

## 5. S4 逐例验收矩阵（M01–M30，唯一 code/status）

> 依据：`卡:L332–370`（M 表）、`卡:L401–425`（错误码）、`卡:L427–436`（零写）、`卡:L438–454`（并发）、`卡:L772–784`（S4 测试范围）、`勘误:L270–279`。每条负向均按 Z_all：`structuredClone(store.data)` 前后 deepEqual + LocalStore `demo-data.json` sha256 不变 + Cloud fake 全记录快照不变。成功路径 audit 次数均为 **1**；失败均为 **0**。

| ID | 场景 | 路径 | 期望 code / status | 允许写集 / audit | 零写 | 备注/依赖 |
|---|---|---|---|---|---:|---|
| M01 | 合法 C1 首条 | `transactFinal` Local+Cloud | 成功（无 error；不伪造 HTTP status） | anchor+E1+head+audit = **4** / audit **1** | — | refs 必须 **18**；Local 文件落盘；Cloud 提交 |
| M02 | 合法 C1 append | `transactFinal` Local+Cloud | 成功 | E+head+audit = **3** / audit **1** | — | refs **18**；同 head CAS；无 anchor 写 |
| M03 | 无 gate | `transactFinal` | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` / **409** | 0 / 0 | Z_all | 不 build；`#h4cGate==null` |
| M04 | admission 缺失/字段错/隐藏/Symbol | `transactFinal` | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` / **409** | 0 / 0 | Z_all | 不 build；`Reflect.ownKeys` 精确 10 字段（S3 P2 口径） |
| M05 | `auditMode≠explicit` | `transactFinal` | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` / **409** | 0 / 0 | Z_all | 不 build；默认仅 `explicit` |
| M06 | `now` 缺失/非安全整数 | `transactFinal` | `EVIDENCE_INVALID` / **409** | 0 / 0 | Z_all | 不 build；gate 不取 `Date.now()` |
| M07 | ticket/HMAC/digest 不符 | `transactFinal` | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` / **409** | 0 / 0 | Z_all | build 可执行；gate/Store 终检失败 |
| M08 | 0 条 audit | `transactFinal` | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` / **409** | 0 / 0 | Z_all | 唯一 audit 检查；G1 |
| M09 | 2 条 audit | `transactFinal` | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` / **409** | 0 / 0 | Z_all | 无双审计；G1 |
| M10 | audit 不在 refs / ID 不符 | `transactFinal` | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` / **409** | 0 / 0 | Z_all | refs 声明校验 |
| M11 | audit 字段/target/createdAt 错 | `transactFinal` | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` / **409** | 0 / 0 | Z_all | 7 字段 exact；target=排序业务目标；createdAt=now |
| M12 | 未声明写 | `transactFinal` | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` / **409** | 0 / 0 | Z_all | 所有 write 必须在 refs |
| M13 | runtime 写 domain/proof/fence/marker/plan | `transactFinal` | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` / **409** | 0 / 0 | Z_all | C1 业务集合仅 anchor/E/head；G1 |
| M14a | proof/marker/plan 无效 | `transactFinal` | `EVIDENCE_CHAIN_PROOF_REQUIRED` / **409** | 0 / 0 | Z_all | gate `CoverageValid` 失败；S5 全矩阵不在此 |
| M14b | fence halted | `transactFinal` | `EVIDENCE_CHAIN_HALTED` / **409** | 0 / 0 | Z_all | `FenceValid` 失败且非 expired |
| M14c | fence expired | `transactFinal` | `EVIDENCE_CHAIN_FENCE_EXPIRED` / **409** | 0 / 0 | Z_all | status 仍 clear；与 HALTED 分离 |
| M15 | create-only 冲突 | `transactFinal` | `CONFLICT` / **409** | 0 / 0 | Z_all | 当前基线仅 409 无 code（`代码:L319`/`L458`）；S4 为 H4-c create-only 补 `CONFLICT`；非 H4-c 不变 |
| M16 | refs >90 | `transactFinal` | **400** 容量错误（现状 code=null；`代码:L94–95`/`L428–429`） | 0 / 0 | Z_all | 91 unique；**90 是上限，不是 C1 预算**；18 不变 |
| M17 | build 抛错 | `transactFinal` | 原错误（同 error/message；不包装） | 0 / 0 | Z_all | 不吞错、不改 code/status；Local 文件不变 |
| M18a | `transact` refs 含 H4-c | `transact` | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` / **409** | 0 / 0 | Z_all | **build 不被调用**（计数器/哨兵） |
| M18b | `transact` refs 非 H4-c，build 返回 H4-c 写 | `transact` | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` / **409** | 0 / 0 | Z_all | 当前裸 `Error("Undeclared transaction write")`（L315/L456）必须映射 `ADMISSION` |
| M19 | `transact` 非 H4-c | `transact` | 成功/旧确定性审计行为不变 | 业务写 + 自动 audit **1** | — | 不得因 S4 改动改变非 H4-c 审计语义 |
| M20 | `change` H4-c name | `change` | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` / **409** | 0 / 0 | Z_all | **build 不被调用**；Local/Cloud 均先检查 name |
| M21 | `change` 非 H4-c | `change` | 成功/行为不变 | 记录 + 自动 audit **1** | — | 不改变旧 `change` 语义 |
| M22 | 外部调 `#persist` | Local/Cloud | `store.persist === undefined`；调用 → **TypeError** | 0 / 0 | 无写 | `Object.hasOwn(store,"persist")===false`；静态扫描 production `persist(` = 0；D10 两份测试需先处置 |
| M23 | `seed` H4-c 非空 | `seed` | **UNKNOWN/BLOCKED**（设计写 `ADMISSION_REQUIRED`，但无执行入口） | 0 / 0 | Z_all | Store 无 `seed()` 方法；模块 `seed()` 无参（`代码:L127`）。见 §7-R2：建议 Codex 将 M23 判为不适用或另定 |
| M24 | `seed` H4-c 空数组 | 模块 `seed()` / `init` 新目录 | 成功；无记录 | 0 / 0 | 无记录写 | 断言 8 个 H4-c 均为 `[]`；新目录 seed 可持久化，但无 H4-c 记录 |
| M25 | `init` 缺 H4-c 数组 | `init` | 成功；仅内存补 `[]` | 0 / 0 | 无记录写；文件 sha256 不变 | 文件存在时不 persist；M25 断言 8 个数组 |
| M26 | `init` 已有非空 H4-c | `init` | 成功；原样保留；不写 | 0 / 0 | 无写 | 不得改记录/不得补记录 |
| M27 | `init` H4-c 非数组/损坏 | `init` | `EVIDENCE_INVALID` / **409** | 0 / 0 | Z_all；不修复 | 当前基线不报错（L247–265 仅用逻辑或默认赋值），S4 必须显式检查 |
| M28 | gate 修改入参/读环境/读时钟 | gate（纯） | 测试断言失败（无 Store code） | 0 / 0 | — | 现有 S1 gate 测试 `C1测试:L2698–2747`；S4 复用同一 gate，不新增环境/时钟 |
| M29 | 集合门禁 | `h4c-collections`/import 面 | 测试断言通过（无 code） | 0 / 0 | — | 无 `H4C_COLLECTION_SET`/Set 导出；`H4C`/数组冻结；`isH4cCollection` 边界；`store.mjs` 只 import 两符号 |
| M30a | 并发：两 append 同 head | `transactFinal` Local+Cloud | 一胜；败者 `EVIDENCE_HEAD_CONFLICT` / **409** | 胜者 业务写 **2** + audit **1** = 总 **3**；败者 0 / 0 | Z_all（败者） | Local 队列；Cloud fake 必须串行化；真实 Cloud 未验证 |
| M30b | 并发：两 genesis | `transactFinal` Local+Cloud | 一胜；败者 `EVIDENCE_CHAIN_BROKEN` / **409** | 胜者 业务写 **3** + audit **1** = 总 **4**；败者 0 / 0 | Z_all（败者） | anchor create-only；败者在 build/链检查即失败；不产生第二 anchor/E/head/audit |

- M14/M18/M30 原表各含多分支；本清单拆为 a/b/c，保持原编号，确保“逐场景唯一 code/status”。M23 无执行入口，不伪造 PASS。
- **M30 计数口径（本轮更正）**：M30a append 业务写 2 + audit 1 = 总 3；M30b genesis 业务写 3 + audit 1 = 总 4。总 3/总 4 已含 audit，**禁止在总 3/总 4 之后再写“+ audit 1”，也禁止写成总 4/总 5**；批准预算仍为 helper 3/2、finalWriteSet 4/3，不变。
- M01/M02 的 store 测试 fixture 可从 `s3GenesisContext`/`s3AppendContext`（`C1测试:L2795–2847`）取 18 refs/4/3 writes/admission，并补 `s1Marker/s1Plan/s1Fence`（`C1测试:L1831/L1896/L2012`）使 `gate.verify` 的 `CoverageValid` 通过；这是 S4 实施细节，本清单不写代码。
- **完整 CoverageValid 仍 S5**：S4 的成功路径会经 `gate.verify` 执行 `CoverageValid`（`H4C:L1715`），但 S4 只负责 Store 接线/M 矩阵；S5 才负责 V01–V05、proof/marker/plan/fence 全量运行时矩阵。S4 不得把 M14a 当作 S5 覆盖，也不得新增 S5 用例。

### 5.1 补充验收（不新增预算/不扩大范围）

| ID | 场景 | 期望 | 说明 |
|---|---|---|---|
| S4-R1 | 事务重试（Cloud fake `replay=2`） | 同一 admission/now 下 build 可重跑；最终 1 业务行 + 1 audit；无双重提交 | 复用 `审计测试:L31–45/L230–241` 的 replay 模式；真实 Cloud 重试未验证 |
| S4-R2 | gate 后写集变化（getter/Proxy） | Store 只写深拷贝快照；gate 验证的字节与实际写入一致；否则拒绝/零写 | 对应“终检后不得追加/修改写”（`卡:L329`）；原 M 表未单列，交 Codex 确认是否纳入 Stop-4 |
| S4-R3 | `store.data` 旁路 | 若信任边界未定，S4 不得声称“无旁路”；Codex 裁定接受/封装/完整性检查 | 见 §4.6；不自行扩大 S4 |

### 5.2 本轮细化要求 → M 映射

| 要求 | 对应 M / 补充项 | 验收落点 |
|---|---|---|
| C1 实际 **18 refs**、helper 3/2、finalWriteSet 4/3；90 仅上限 | M01/M02/M13/M16 | 18 不因 90 扩大；M16 的 91 只证明上限 |
| 唯一 audit（恰好 1 条、7 字段、target/createdAt、无自动追加） | M08/M09/M10/M11/M18b/M21 | 失败 `ADMISSION`/零写；M21 旧路径自动 audit 1 条且非 H4-c |
| create-only / exact（anchor/E/head/audit；head/fence 更新；plan status） | M01/M02/M15/M24/M25/M26/M27 | 冲突 `CONFLICT`；exact 不注入 `updatedAt`；init 不修复 |
| 失败原子回滚 / 全库零变化 | M03–M17、M30a/b | Local `store.data` + 文件 sha256；Cloud fake 全记录快照 |
| 事务重试（Cloud callback 重跑） | S4-R1（补充；配合 M30a） | build 可重跑、单提交、单 audit；真实 Cloud 未验证 |
| refs 形状/重复/≤90 | M16（+ refs shape 负向并入 M16 准备） | 重复 → `EVIDENCE_INVALID`；91 → 400；不静默去重 |
| legacy `transact`/`change` 防旁路 | M18a/M18b/M19/M20/M21 | H4-c refs/name → `ADMISSION` 且 build 不调用；非 H4-c 不变 |
| `#persist` 私有 / public persist 消失 | M22、D10（R1） | `store.persist===undefined`；两份测试最小 fixture；无 public 逃逸 |
| seed/init 全路径 | M23/M24/M25/M26/M27 | M23 无入口 → UNKNOWN/BLOCKED；M25–M27 文件零写/不修复 |
| gate 放置 / 集合门禁 | M28/M29、G1（R3） | gate 纯/冻结/不读环境；M08–M13 依赖 G1 落点 |
| 并发（Local 真实队列 / Cloud fake） | M30a/M30b、S4-R1 | 一胜；败者零写；Cloud fake 必须串行；真实 Cloud C3 |

## 6. Guard 复用、预加载与控制（固定 `6f96fed`）

### 6.1 七脚本与哈希（实测 0 mismatch）

| # | 文件（`docs/evidence/h4c-c1-stop1-guard/`） | SHA-256 |
|---:|---|---|
| 1 | `guard.cjs` | `2d013d808e8b78214db835ada611c9700d966ba07624342e26fcd637a900a8f5` |
| 2 | `run-controls.cjs` | `3fd2507aabd8eb8a7abdb284e3b59061843d9e70ad081e902d291bbe25e73643` |
| 3 | `entry-negative.cjs` | `36f8d53326ab4f270928e294ba9ec517d6efffa935ddf8145cbecfc70f2124a6` |
| 4 | `load-negative.cjs` | `ca89b38c351abcb026c71c5cd3d8fdd784acc192cb804468b29d650c49f7570f` |
| 5 | `child-net.cjs` | `3afa02dec336a12c34114ef4083f87f3b05806dec97b007587faa42aa5c158ef` |
| 6 | `esm-sentinel.mjs` | `b3fb4bef441b1b6aa4f53879af5c1dc712a8dbbb2764d7ddc77379726a671b0c` |
| 7 | `positive.cjs` | `c34225ccc8854a1720ee51985d777ad29e1c7d85860e293bebeb2f3f7268bad2` |

- 同目录 `SHA256SUMS`（9 行）@ `6f96fed`；本轮只读校验 7 脚本 + 2 份输出，0 mismatch；未复制进 S4 分支（`S3证据:L1272–1282`）。
- 复用 S1/S2/S3 同一 guard；不另造、不修改、不无 guard 重跑。

### 6.2 预加载/控制/命令（S4 执行时；本轮只准备）

```powershell
$wt = "C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\c1-s4-preflight"
$tmp = Join-Path $env:TEMP ("c1-s4-guard-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
git -C $wt archive 6f96fed9bd478192c8bbffeb52f47c90df89939e docs/evidence/h4c-c1-stop1-guard | tar -x -C $tmp
$gd = Join-Path $tmp "docs\evidence\h4c-c1-stop1-guard"
# 逐文件核对 SHA256SUMS；任一 mismatch -> BLOCKED，不继续
$guard = Join-Path $gd "guard.cjs"
$env:NODE_OPTIONS = '--require "' + $guard + '"'
$env:H4C_ADMIN_WEB = Join-Path $wt "admin-web"
$env:H4C_GUARD_REPORT = Join-Path $tmp "wrapper.report.json"
Set-Location $env:H4C_ADMIN_WEB
node (Join-Path $gd "run-controls.cjs")   # 预期 exit 0；8/8 控制；C1 定向 66 + S4 新增
```

- 8/8 控制（历史 S3-P2 实测，S4 必须复现）：`negative:no-guard` exit 3；`positive:preload-sentinel` exit 0；`negative:esm-named-import` `http.request=1`；`negative:per-entry` 63/63；`negative:load-before-runtime` exit 1/`load_violations=1`；`negative:subprocess-inheritance` `blocked=true`/`active=true`/`network_attempts=1`/`listen_calls=0`；`positive:crypto-fs-k3-localstore` exit 0；`test:c1-targeted` exit 0（`S3证据:L1284–1286`）。
- 实际 C1 测试进程计数器必须 `listen_calls=0`、`network_attempts=0`、`dns_calls=0`、`dgram_calls=0`、`provider_calls=0`、`load_violations=0`、`blocked_calls=0`、`real_leaks=0`；控制项非零为负控预期，分列。
- **本轮未运行上述命令**；仅准备。S4 执行时必须先校验 `NODE_OPTIONS` 含 guard、sentinel 为真；失败即 BLOCKED，不摘 guard 重跑。

### 6.3 非监听/禁跑清单

- 允许：`admin-web/tests/face-h4c-evidence.test.mjs`；条件 `store-deterministic-audit.test.mjs` / `verification.test.mjs`（若改）。
- 不跑：33 个非 HTTP 全量、7 个根文件、8 个 HTTP 文件（`tests/blacklist-http`、`occupancy-http`、`server`、`server-face`、`server-face-bounds`、`server-files`、`server-v2`、`verification-http`）、`npm test`、glob、任何 `listen`/服务。
- 新增被加载文件必须先进非监听集（`授权:L416`）；否则 Stop-4 失败。

## 7. 阻断、未决与最小裁定项（交 Codex，不转用户选择）

| ID | 事项 | 原文/代码定位 | 状态 | 建议/最小裁定 |
|---|---|---|---|---|
| **R1/D10** | `#persist` 私有破坏两份测试；D10 只列其中一份 | `卡:L972`、`勘误:L296/L363`、`授权:L62/L139`；`代码:L268`；`验证测试:L381`；`审计测试:L219–225` | **BLOCKED（两方案未实现，待 Codex）** | 批准 §4.7 的 **D10-A/D10-B 两方案**：D10-A `verification` 用测试内 `persistDemoData` 直写 tmp+rename；D10-B `审计测试` 临时把 `store.directory` 定义为抛 `audit persistence failed` 的 getter（`#persist` 读取 `this.directory` 时抛错），`finally` 恢复；两者保留原断言、不保留 public persist、不 patch 全局内建模块。**同时批准将 `store-deterministic-audit.test.mjs` 纳入 S4 白名单的 D10 fixture-only 改动**；否则 S4 不得开工。 |
| **R2/M23** | `seed` 非空拒绝无执行入口 | `卡:L317`、`设计:L171`；`代码:L127`（无参模块函数）；Store 无 `seed()` 方法 | **UNKNOWN/BLOCKED** | 建议 Codex 判 M23 不适用（`seed()` 是零参默认工厂，8 个 H4-c 静态空数组，M24 覆盖），或明确要求新增 Store `seed()`（属 API 扩大，不建议）；不要猜。 |
| **R3/G1** | `createH4cGate.verify` 未执行 §3.3c 的“唯一 audit/own键/Symbol/18 refs” | `卡:L281`、`L342–348`；`H4C:L1697–1724`（只调 `AdmissionValid`）；`H4C:L1628–1660`（`validateH4cAdmission` 已做）、`L1554–1570`（own键）、`L1527–1546`（18 refs） | **CONDITIONAL（未实现，仅建议）** | 建议 S4 在 gate.verify 内复用 `validateH4cAdmission`（含 `assertExactAdmissionOwnKeys` 的 own键/Symbol、唯一 audit、`assertCanonicalC1Refs` 的 18 refs；不改 S3 helper 语义），使 M08–M13 可诚实通过；请 Codex 确认这是“接线”而非重开 S3。若不允许，S4 需在 Store 侧实现等价校验并解释 E3 import 边界。 |
| **R4/旁路** | `store.data` public 可被篡改后由非 H4-c `transact` 持久化 | `代码:L239/L247–265`；`代码:L290/L338`；测试 `C1测试:L411`、`验证测试:L379` | **UNKNOWN** | `#persist` 私有只关闭 public persist 方法；请 Codex 明确 `store.data` 是受信内部/测试 seam，还是要求 S4 增加完整性检查/封装。S4 不自行扩大去封装（会破坏大量测试且不在 E3 范围）。 |
| **R5/Cloud 并发** | Cloud fake 未串行；真实 Cloud 未验证 | `C1测试:L434–491`；`代码:L430`；`设计:L414`；`授权:L140` | 未验证（C3） | S4 测试 fake 必须串行化/冲突检测后 M30 才能一胜；证据分列“LocalStore 真实队列”与“Cloud fake 语义”；真实 Cloud 并发/重试不声称。 |
| **R6/测试 fixture** | 现有 S2 用例用 `store.transact` 写 H4-c | `C1测试:L336/L1556/L1576/L1587/L1634/L1646/L1657/L1676` | 需 S4 处理 | 改为直接构造 `store.data`（`勘误:L293` 允许测试 setup）或 `transactFinal`；**保留 S2 断言**，不得弱化；此改动属 C1 测试白名单。 |
| **R7/M15** | 基线 create-only 只 409 无 `CONFLICT` code | `代码:L319`/`L458`；`卡:L350` | 需 S4 补 | H4-c create-only 路径补 `code="CONFLICT"`；非 H4-c 路径保持原样；不改变旧测试只断言 409 的语义。 |

- 以上为**技术裁定项**，交 Codex；不把“是否接受 public persist”“M23 是否删除”“store.data 是否受信”转成用户选择。
- D1/D8/D9/D11 仍按原状态：D1 云材料 UNKNOWN；D8 阻断 S6；D9 S4 起点/分支未派单；D11 C3 未验证。

## 8. 停止点与交接

- **本任务停止点**：仅修订本文档；提交并普通 push `codex/h4c-c1-s4-preflight`；交 Codex 独立裁定；**不实施 S4、不运行 C1/33+7/8 HTTP/guard、不安装、不接生产/云/设备/支付/HTTP/UI**。
- **S4 开工条件（全部满足才可申请）**：S3 Stop-3 关闭（已满足，仅记录）；R1/D10-A/D10-B 两方案获批 + 白名单扩项；R2/M23 裁定；R3/G1 落点裁定；R4 旁路信任边界裁定；S4 本轮单独授权与起点 SHA 明确；测试 fixture 改法在 C1 测试白名单内。
- **Stop-4 复审输入（未来，不在本轮）**：Store diff、gate 放置点、构造注入、explicit 模式、M01–M30（含 a/b/c 子项）、私有 Set/谓词/冻结、D10 处置、非 H4-c 零回归、Local/Cloud 证据分列、未验证单列。
- 本文件**不自批**、不宣称 S4 通过、不宣称 C1/G1 通过、不授权合并/部署/生产接线。

## 9. 明确未验证/未做

- 未实现任何 S4 代码；未修改 `store.mjs`/`h4c-evidence.mjs`/`h4c-collections.mjs`/`index.mjs`/测试/设计/卡/guard。
- 未运行任何实施测试、guard、`node --test`、`npm`、33+7、8 HTTP、服务/监听；未安装依赖。
- 未运行 M01–M30、D10 两份测试的最小方案、S4-R1/R2；上述均为“已准备/待执行”，不是结果。
- 未验证 LocalStore 事务回滚/并发、Cloud fake 串行/回滚、真实 Cloud/K3/设备/Provider/支付/HTTP/UI；未部署、未处置风险。
- 未读云 `PARALLEL-DISPATCH.md`/`REVIEW.md` 正文；不声称与云端派单逐项一致。
- S3 的 66/66 + guard 8/8 为 Codex 已验收/历史证据，本轮未重跑、未独立复现；本清单只记录关闭输入。
- 未验证 `store.data` 旁路、M23 解释、G1 落点、D10 白名单扩项；这些是交 Codex 的裁定项。

## 10. 固定 SHA 文件链接

| 文件 | 固定链接 |
|---|---|
| 任务卡 r5 @ `49ca13ec` | https://github.com/1997dmsu-sketch/SMART-PM/blob/49ca13ec77a94bce09a566ce1e42870accbcade7/docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-TASK-2026-11-18.md |
| 设计 v8 @ `49ca13ec` | https://github.com/1997dmsu-sketch/SMART-PM/blob/49ca13ec77a94bce09a566ce1e42870accbcade7/docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md |
| 勘误 r4 @ `49ca13ec` | https://github.com/1997dmsu-sketch/SMART-PM/blob/49ca13ec77a94bce09a566ce1e42870accbcade7/docs/tasks/HK-AI-04-H4C-C1-REFS-ERRATUM-2026-11-19.md |
| S3 证据 @ `49ca13ec` | https://github.com/1997dmsu-sketch/SMART-PM/blob/49ca13ec77a94bce09a566ce1e42870accbcade7/docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-EVIDENCE-2026-11-19.md |
| S3 前置 @ `49ca13ec` | https://github.com/1997dmsu-sketch/SMART-PM/blob/49ca13ec77a94bce09a566ce1e42870accbcade7/docs/tasks/HK-AI-04-H4C-C1-S3-PREFLIGHT-2026-11-20.md |
| Store @ `49ca13ec` | https://github.com/1997dmsu-sketch/SMART-PM/blob/49ca13ec77a94bce09a566ce1e42870accbcade7/admin-web/lib/store.mjs |
| `h4c-evidence` @ `49ca13ec` | https://github.com/1997dmsu-sketch/SMART-PM/blob/49ca13ec77a94bce09a566ce1e42870accbcade7/admin-web/lib/face-service/h4c-evidence.mjs |
| C1 测试 @ `49ca13ec` | https://github.com/1997dmsu-sketch/SMART-PM/blob/49ca13ec77a94bce09a566ce1e42870accbcade7/admin-web/tests/face-h4c-evidence.test.mjs |
| `verification.test` @ `49ca13ec` | https://github.com/1997dmsu-sketch/SMART-PM/blob/49ca13ec77a94bce09a566ce1e42870accbcade7/admin-web/tests/verification.test.mjs |
| `store-deterministic-audit.test` @ `49ca13ec` | https://github.com/1997dmsu-sketch/SMART-PM/blob/49ca13ec77a94bce09a566ce1e42870accbcade7/admin-web/tests/store-deterministic-audit.test.mjs |
| Guard 七脚本 @ `6f96fed` | https://github.com/1997dmsu-sketch/SMART-PM/tree/6f96fed9bd478192c8bbffeb52f47c90df89939e/docs/evidence/h4c-c1-stop1-guard |
| 本文档 | 最终提交 SHA 由交付回报给出；格式 `/blob/<final-sha>/docs/tasks/HK-AI-04-H4C-C1-S4-PREFLIGHT-2026-11-20.md` |

## 11. 交付回报字段（提交后由最终回复填写）

```text
任务：HK-AI-04-H4C-C1-S4-PREFLIGHT-2026-11-20（仅文档；不实施 S4）
执行者：DSH 根代理 lead（deepseek-flash）
原前置 run/session：hrun-mworlgg2-4d0901 / session-85d1620b-a49f-44c9-a1db-5f92c300741b
本轮续派 run/session：hrun-mwotfctk-a36243 / session-85d1620b-a49f-44c9-a1db-5f92c300741b
工作树/分支：宇宙智联/.tmp/c1-s4-preflight / codex/h4c-c1-s4-preflight（复用；已有交付 f5932df）
固定输入/父：49ca13ec77a94bce09a566ce1e42870accbcade7 / 5a13fcc86efd38bae3b8448ec1ad3864cbb94a8e
已有交付/父：f5932dfc950e4b32b0fe5810be0b4b86dd5216c5 / c982905b6c65af3d213fc6c28f15520adc94866e
最终提交：<fill-after-commit>
文件清单：docs/tasks/HK-AI-04-H4C-C1-S4-PREFLIGHT-2026-11-20.md（仅此一个）
命令/exit：fetch 0；ls-remote 0；diff/show --check 0；未运行测试/guard
未验证：S4 实现、M01–M30、D10-A/B 两方案、S4-R1/R2、Local/Cloud 事务、真实 Cloud/K3/设备/支付/HTTP/UI
停止点：本文档推送后停手，交 Codex 独立裁定；不实施 S4、不进入 S5、不自批
```
