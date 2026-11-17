# HK-AI-06A 真实 Hikvision Provider 证据与契约设计

> 状态：**调查/设计交付，待 Codex 复审。** 本文不构成 Provider 发布批准、设备写批准、HTTP 接线批准或 H4-c/H4-d 实施批准。

## 0. 文档元数据与边界

| 项目 | 值 |
|---|---|
| 仓库 | `SMART-PM`（<https://github.com/1997dmsu-sketch/SMART-PM>） |
| 新分支 | `docs/hk-hikvision-provider-evidence` |
| 设计基线 | H4-c 冻结设计 `b15aceb`（终审 `ed7b66f`） |
| 服务层代码基线 | H4-b `1155b7ba65991d324fb8b22bb8f7dd87f49428f9` |
| 目标型号（项目登记） | `DS-K1T671BM` |
| 厂商枚举 | `hikvision`（全项目唯一写法） |
| 证据截止 | 2026-11-14（Asia/Shanghai） |
| 公开链接核验 | 2026-11-14；10 个公开官方 URL 全部 HTTP 200 |
| 设备实测 | **0 条**（本次未连接任何真实设备；仓库内也没有可引用的非敏感设备实测记录） |
| 真实调用 | **0 条** |
| Provider 发布门禁 | `providerReleaseApproved=false` |
| 设备操作门禁 | `allowDeviceOperations=false` |
| 路线决策 | `routeDecision=undecided` |

**本卡只做调查与设计，明确不做：**

- 不连接真实设备、海康平台或生产云；
- 不调用设备 API，不发送任何 GET/POST/PUT/PATCH/DELETE 到设备；
- 不写 Provider 生产代码，不修改 `server.mjs`，不注册 HTTP 路由；
- 不使用真实人脸、凭据、IP、序列号、账号；
- 不进入 H4-c 编码，不进入 H4-d；
- 不把文档示例、近似型号或 Mock 行为写成目标设备事实。

本次唯一的外部网络行为是**读取公开官方文档页面**用于核对链接与字段定义；没有访问任何设备地址、内网、云平台或生产数据。

---

## 1. 结论摘要

一句话：**目标型号的公开官方精确文档、目标固件、目标 capability 和真实调用目前都是 0 条；可以冻结的只有内部安全不变量和失败关闭契约，不能冻结真实端点的字段级写契约。**

| # | 问题 | 结论 | 状态 |
|---|---|---|---|
| 1 | 目标型号是否为 `DS-K1T671BM` | 项目登记为该型号；仓库历史文档也以该型号为目标 | 已证实（项目登记） |
| 2 | 公开官方资料是否精确覆盖裸型号 `DS-K1T671BM` | 未找到精确型号页/手册；公开产品页与手册覆盖 `DS-K1T671M(D)` 等变体；项目内官方指南只列 `DS-K1T671B` 与 `DS-K1T671BM-3XFTD` | 待设备验证 |
| 3 | 目标固件版本、构建日期、区域版本 | 仓库内没有非敏感记录；公开页面的固件版本属于其他变体，不能外推 | 待设备验证 |
| 4 | 27 个候选端点的文档存在性 | 27/27 有项目内官方指南摘要证据 | 已证实（文档存在） |
| 5 | 目标设备 capability | 0/27 | 待设备验证 |
| 6 | 真实设备调用 | 0/27 | 待设备验证 |
| 7 | 人员/人脸/门权限字段是否可直接写死 | 不能；字段语义、必填性、长度、门号与模板均需目标 capability/实测 | 待设备验证 |
| 8 | FDID 与 `faceLibType` | 文档示例可见光库为 `FDID=1`；深度模式另有库；`blackFD` 是厂商名单语义，不等同项目黑名单 | 待设备验证 |
| 9 | 图片格式/尺寸/大小/质量 | 文档示例 `image/jpeg`；项目内官方摘要与错误码提示人脸图片约 200 KB 上限；分辨率、宽高比、质量、EXIF/尾随载荷未证实 | 待设备验证 |
| 10 | 新增/更新/删除/查询是否同步 | 人员删除文档明确有 `DeleteProcess` 进度查询；其余写操作是否“响应即生效”未证实 | 待设备验证 |
| 11 | 离线、超时、未知结果 | 只能按“发送前/发送后”保守分类；发送后未知一律 `UNKNOWN_RESULT`，不得自动重放 | 内部设计（已可冻结） |
| 12 | 重复请求 | K2 幂等键可保证平台侧重放/冲突；厂商侧是否幂等未证实 | 部分已证实（平台侧）；厂商侧待验证 |
| 13 | 事件签名/nonce/eventId | 公开 `EventNotificationAlert` 页面未记录签名或 nonce，`UUID` 为可选；不能声称厂商支持事件签名 | 暂不支持/待确认 |
| 14 | 事件时间窗与防重放 | 厂商侧未证实；Mock 仅有 5 分钟和 `mock-sig` 合成规则 | 待设备验证 |
| 15 | 真实 Provider 是否可上线 | 不可；发布门禁、设备门禁、kill switch、路线与证据均未满足 | 暂不支持 |

### 1.1 三个证据层级

沿用 HK-AI-01 的三级证据，但本卡只把“目标设备 capability”和“真实调用”作为能否进入实现的硬门：

| 层级 | 含义 | 本卡状态 |
|---|---|---|
| L1 文档存在 | 官方资料/项目内官方摘要中存在端点、字段或错误码定义 | 27/27 候选端点有摘要；不等于目标设备支持 |
| L2 目标设备 capability | 目标完整型号 + 目标固件实际返回支持 | **0/27** |
| L3 真实调用 | 在隔离设备上完成脱敏只读/写验证 | **0/27** |

**禁止外推规则：**

1. 产品族页面不能证明裸型号；
2. 近似型号（`DS-K1T671B`、`DS-K1T671BM-3XFTD`）不能证明 `DS-K1T671BM`；
3. 文档示例不能证明目标固件行为；
4. Mock 成功不能证明设备生效；
5. 平台侧幂等不能证明厂商侧幂等；
6. 设备返回 200 不等于业务终态生效。

### 1.2 厂商能力与本项目内部设计的区分

本文所有“建议/应/必须/默认”均为**本项目内部设计**，不是海康能力声明。厂商事实只来自 `O`/`P` 两类证据；`C` 只证明现有代码/已批准契约的行为。

| 类别 | 例子 | 本文标注 |
|---|---|---|
| 厂商事实 | `EventNotificationAlert` 有 `eventType/dateTime` 字段 | 官方文档（O/P） |
| 厂商未证实 | 目标固件是否支持 `UserInfoDetail/Delete` | 待设备验证 |
| 本项目设计 | 发送后超时一律 `UNKNOWN_RESULT` | 内部设计 |
| 现有代码事实 | Mock 事件使用 `mock-sig`、5 分钟窗口 | 现有代码（C） |
| 现有代码缺口 | 没有真实事件验签、没有真实 Provider | 暂不支持 |

---

## 2. 证据方法与来源分级

### 2.1 五类证据标记

| 标记 | 定义 | 本卡使用方式 |
|---|---|---|
| `O` | **公开官方资料**：海康官网/开放平台公开页面，已用 HTTP GET 核验状态、最终 URL、Content-Type 和关键标记 | 只证明“公开页面存在且包含该定义”，不证明目标型号 |
| `P` | **项目内官方资料摘要**：项目负责人私密提供的官方 PDF/XLSX 的摘要、页码、哈希；仓库不存原件 | 可证明“该版官方指南中有此定义”，但仍不证明目标固件 |
| `C` | **现有代码/已批准契约**：仓库内代码、H1–H4/H4-c 批准文档 | 证明平台侧已有行为，不证明设备 |
| `D` | **设备实测**：隔离设备上的脱敏记录 | 本卡 **0 条** |
| `Q` | **待现场确认**：必须由铭牌、固件、capability、隔离实测或厂商书面答复关闭 | 不得用推测填充 |

### 2.2 公开官方来源

本次核验的 10 个公开官方 URL 全部 HTTP 200；明细见 §14.1 与 `HK-AI-06A-EVIDENCE-INDEX.json`。

| ID | 公开官方资料 | 能证明 | 不能证明 |
|---|---|---|---|
| `O01` | 海康官网首页 | 厂商主体与官网可达 | 任何型号能力 |
| `O02` | `DS-K1T671M` 产品页（Pro 系列人脸终端） | `DS-K1T671` 产品族存在，页面列出 `DS-K1T671M`/`DS-K1T671TM-3XF` | 页面不含 `DS-K1T671BM` 字符串；不能证明 BM |
| `O03` | `DS-K1T671(D)` 系列手册“适用型号” | 该手册适用 `DS-K1T671M(D)/MW(D)/MG(D)` | 不适用裸 BM |
| `O04` | 同手册“技术参数” | 该系列变体的规格存在 | 不能外推到 BM |
| `O05` | ISAPI `NET_DVR_SendWithRecvRemoteConfig(ACS_USERFACE)` 接口定义 | 官方 SDK 定义中出现 `FDSearch`/`FaceDataRecord`/`FDSetUp` 映射 | 未绑定 BM；未见删除端点 |
| `O06` | ISAPI `NET_DVR_STDXMLConfig` FDLib 图片接口定义 | `FDID`/`PID`、`FDSearch`、图片读写接口定义存在 | 未绑定 BM；不能证明门禁人员人脸流程 |
| `O07` | ISAPI `EventNotificationAlert v2.0` schema 页 | 通用事件信封字段：`dateTime`、`activePostCount`、`eventType`、`eventState`、`eventDescription` 等；`deviceID`/`channelID`/`UUID` 等可选（`ipAddress` 为 dep） | 页面示例子节点为 ANPR；未证明门禁事件子结构；未记录签名/nonce |
| `O08` | ISAPI `SubscribeEvent v2.0` schema 页 | `eventMode`、`EventList[].type`、`heartbeat`、`channels`、`identityKey` 等订阅字段 | 未记录签名/nonce；未绑定 BM |
| `O09` | ISAPI 接口定义 PDF | 官方 PDF 存在，含事件通知等章节（页码引用需按该 PDF 版本） | 不能替代目标固件实测 |
| `O10` | 人脸识别终端产品分类页 | 产品分类存在 | 不含 BM 精确型号 |

### 2.3 项目内官方资料摘要

| ID | 路径 | 用途 |
|---|---|---|
| `P01` | `docs/tasks/HK-AI-01-EVIDENCE-MATRIX.md` | HK-AI-01 任务与证据分级 |
| `P02` | `docs/devices/HIKVISION-ISAPI-EVIDENCE-MATRIX.md` | 27 端点、66 字段、50 错误码的文档证据矩阵 |
| `P03` | `docs/devices/HIKVISION-ISAPI-PROVIDER-WHITELIST.json` | 机器可读白名单；全部 `candidateOnly=true`、`allowedNow=false` |
| `P04` | `docs/devices/HIKVISION-ISAPI-DOCS-2026-11-05.md` | 两份官方指南的元数据、页码、型号适用性 |
| `P05` | `docs/devices/HIKVISION-DS-K1T671BM-CAPABILITY.md` | BM 精确型号证据为 0 条；路线未定 |
| `P06` | `docs/devices/HIKVISION-DS-K1T671BM-RISKS.md` | 风险、费用、测试设备、Q1–Q12 |
| `P07` | `docs/database/LOCK-01A-CONTRACT.md` | Provider 接口、错误分类、幂等、事件校验契约 |
| `P08` | `docs/database/LOCK-01A-DATA-DESIGN.md` | 固定 ID、claim/slot、凭据/任务/日志集合 |
| `P09` | `docs/devices/LOCK-01A-REVIEW.md` | 三轮复审：证据分级、`hikvision` 枚举、固定 claim、demo/live 边界 |
| `P10` | H1 终审 `6bfe1ba` | H1 关闭，H2 原子授权放行 |
| `P11` | H2 各阶段终审（H2A `f9a2b6b`、H2B `2bc10e3`、H2C C3 `32c891f`、C4 `feaa1e0`、H2D `90cc848`） | H2 关闭 |
| `P12` | H3 设计终审 `b2cd7ab`、H3-a `5e590ee`、H3-b `2b92b30` | Mock 租约与派发关闭 |
| `P13` | H4 设计终审 `1542a6c`、H4-a `685ac3a`、H4-0A `ec8be46`/`ff3c492`、H4-0B `b2b5a11`、H4-b `1155b7b` | Mock 撤权闭环关闭 |
| `P14` | H4-c 设计 `b15aceb`、终审 `ed7b66f` | 人工对账设计通过；仅设计，未实现 |
| `P15` | `docs/tasks/HK-AI-04-H4B-EVIDENCE-2026-11-13.md` | H4-b R13–R60 运行证据 |
| `P16` | `docs/tasks/HK-AI-06-HIKVISION-PROVIDER-PREFLIGHT-TASK-2026-11-11.md` | 真实 Provider 前置框架的禁止项与待现场证据清单 |

### 2.4 代码证据

| ID | 代码 | 本卡引用的行为 |
|---|---|---|
| `C01` | `admin-web/lib/face-service/dto.mjs` | `FaceAccessContext`、`assertEventInput`、`publicAccessState` |
| `C02` | `admin-web/lib/face-service/mock-provider.mjs` | Mock 事件签名、5 分钟窗口、版本递增、重放/冲突 |
| `C03` | `admin-web/lib/face-service/service.mjs` | K2 `#opContext`/`#replayValid`、createGrant、revoke |
| `C04` | `admin-web/lib/face-service/state.mjs` | grant/job 状态迁移、`deviceEffective` 证据条件 |
| `C05` | `admin-web/lib/face-service/h4b.mjs` | revoke 专用 validator、租约、local finalize、82/90 边界 |
| `C06` | `admin-web/lib/face-service/collections.mjs` | 集合 validator、确定性日志 ID、安全整数 |
| `C07` | `admin-web/lib/face-service/routes.mjs` | 路由仅为提案，未注册 |
| `C08` | `admin-web/lib/org.mjs` | `device.operation.reconcile` 等权限点 |
| `C09` | `admin-web/lib/face-service/README.md` | Mock 阶段接口、四轴状态、Mock 事件边界 |
| `C10` | `admin-web/lib/store.mjs` | 事务、确定性 audit、refs 上限 |

> 代码基线说明：`C01`–`C10` 的行为以 `1155b7b` 及 H4-c 设计基线为准。工作区中用户正在进行的 H4-c 实现文件不属于本次交付，本文不引用、不修改、不提交。

---

## 3. 已批准门禁继承

### 3.1 H1–H4-c 冻结事实

| 门禁 | 批准/证据 | 冻结内容 | 对 HK-AI-06A 的约束 |
|---|---|---|---|
| H1 | 终审 `6bfe1ba` | 只做凭证提交/审核；`createGrant/revoke` 返回 `STAGE_CLOSED`；零设备调用 | 本卡不能绕过 H1 的权限与审核链 |
| H2 | H2A `f9a2b6b`、H2B `2bc10e3`、H2C C3 `32c891f`/C4 `feaa1e0`、H2D `90cc848` | createGrant 原子事务；K1/K2；固定 claim/slot；57/90 成功、58/91 事务前失败 | 真实 Provider 不能改变授权/claim/slot 语义 |
| H3 | 设计 `b2cd7ab`、H3-a `5e590ee`、H3-b `2b92b30` | 60 秒租约、10 秒 Mock 窗口、30/120/600 秒退避、attempts≤4、未知→`awaiting_result`、单进程 LocalStore+Mock | 真实 Provider 不得复用 Mock 的进程内假设；Cloud/live 仍 `NOT_CONFIGURED` |
| H4 | 设计 `1542a6c`、H4-a `685ac3a`、H4-0A/0B、H4-b `1155b7b` | 立即业务撤权、异步清理、local finalize、82/90 边界、墓碑/guard CAS | 真实删除必须另立契约，不能复制或放宽 H4-b 释放算法 |
| H4-c | 设计 `b15aceb`、终审 `ed7b66f` | `awaiting_result` 的人工对账；三种 decision；模拟证据；Provider 恒 0 | 本卡不实现 H4-c，不新增 HTTP，不进入 H4-d |

### 3.2 本卡不改变的门禁

1. `providerReleaseApproved=false`、`allowDeviceOperations=false` 保持。
2. 27 个候选端点保持 `candidateOnly=true`、`allowedNow=false`。
3. `live + hikvision` 继续 `503 NOT_CONFIGURED`；不得回退 Mock。
4. `server.mjs`、HTTP 路由、小程序开关、生产配置不改。
5. H4-c 的 `evidenceScope=simulated` 与 `Provider=0` 不被本卡改写。
6. H4-d 不进入；`confirmed_present` 的重新派发仍按 H4-c Q2 另立卡。

### 3.3 当前代码已经证明的平台侧能力

| 能力 | 代码/证据 | 边界 |
|---|---|---|
| K2 幂等键、requestDigest、严格重放、同键异摘要冲突 | `C03`、H2 证据 | 只保证平台侧；不保证厂商侧 |
| 设备 claim 全局唯一、跨组织转移审计 | `P08`、H2 证据 | 真实设备登记仍需现场证据 |
| grant/job 状态机、`awaiting_result` 不可自动续跑 | `C04`、`P12` | 只对 Mock 阶段 |
| H4-b 撤权清理、local finalize、82/90 | `C05`、`P15` | 只对 LocalStore+Mock |
| Mock 事件 5 分钟窗口、`mock-sig`、版本递增 | `C01`/`C02` | **仅合成 fixture，不是生产验签** |
| 真实事件验签/防重放 | 无 | **暂不支持** |
| 真实 Provider HTTP 调用 | 无 | **暂不支持** |

---

## 4. 目标型号、固件与 capability

### 4.1 目标型号

| 证据 | 内容 | 结论 |
|---|---|---|
| `P05`/`P06` | 项目目标为 `DS-K1T671BM`；精确型号规格、固件、对应指南未取得 | 项目登记成立；厂商精确证据 0 |
| `O02` | 页面标题 `DS-K1T671M`，页面内出现 `DS-K1T671M`、`DS-K1T671TM-3XF` 等族内型号；程序化检查未发现 `DS-K1T671BM` 字符串 | 公开页面不覆盖裸 BM |
| `O03` | 官方手册适用型号为 `DS-K1T671M(D)`、`DS-K1T671MW(D)`、`DS-K1T671MG(D)` | 不覆盖裸 BM |
| `O04` | 同手册技术参数，面向上述 M/MW/MG 变体 | 不覆盖裸 BM |
| `O10` | 人脸识别终端分类页存在；未出现 BM 精确型号 | 只证明产品线 |
| `P04` | 普通指南列 `DS-K1T671B`；测温指南列 `DS-K1T671BM-3XFTD`；均未精确列裸 BM | 近似型号，不是 BM |
| `P09` | LOCK-01A 复审明确禁止把近似型号写成 BM 已验证 | 证据分级规则成立 |

**结论：**

- `DS-K1T671BM` 的**公开官方精确型号页/手册匹配：0 条**。
- 公开官方只证明 `DS-K1T671` 产品族和 `DS-K1T671M(D)` 等变体存在。
- 项目内官方指南只覆盖 `DS-K1T671B` 与 `DS-K1T671BM-3XFTD`，不能替代裸 BM。
- 设备铭牌、完整后缀、区域版本必须现场确认（Q01）。

### 4.2 固件

| 项目 | 证据 | 状态 |
|---|---|---|
| 目标固件版本 | 仓库内无 `DS-K1T671BM` 固件版本/构建日期/区域版本的非敏感记录 | 待设备验证（Q02） |
| 公开页面固件 | `O02` 页面列出的是 `DS-K1T671M`/`DS-K1T671TM-3XF` 等变体的固件条目，不能归因于 BM | 不可用 |
| 固件与指南版本对应 | 未取得厂商书面答复；不能判断普通指南还是测温指南适用 | 待厂商确认（Q02/Q03） |
| 设备时间/NTP/时区 | 未取得设备时间状态；`Valid` 字段依赖设备时间 | 待设备验证（Q05） |

**规则：** 未取得 `GET /ISAPI/System/deviceInfo` 的脱敏结果和铭牌照片前，不得把任何固件号写入代码、fixture 或验收报告。

### 4.3 capability 门

真实 Provider 每次操作前必须先读对应 capability；缺字段、`false`、解析失败一律失败关闭，不能“按默认支持”继续。

| 能力门 | 端点 | 必须确认的字段 | 缺失/失败时 |
|---|---|---|---|
| 人员总能力 | `GET /ISAPI/AccessControl/capabilities` | `isSupportUserInfo`、`isSupportFDLib`、`isSupportUserInfoDetailDelete`、`EmployeeNoInfo.*` | 禁止人员/人脸/删除写 |
| 人员操作能力 | `GET /ISAPI/AccessControl/UserInfo/capabilities?format=json` | `supportFunction`、`maxRecordNum`、`UserInfoSearchCond.maxResults`、`EmployeeNoList.maxSize` | 禁止对应操作；不得写死 100/56 |
| 人脸能力 | `GET /ISAPI/Intelligent/FDLib/capabilities?format=json` | `supportFunction`、`FDRecordDataMaxNum` | 禁止人脸写；不得推断容量 |
| 人脸库 | `GET /ISAPI/Intelligent/FDLib?format=json` | `FDID`、`faceLibType` | 禁止写；不得写死 FDID=1 |
| 系统/事件 | `GET /ISAPI/System/capabilities` | `isSupportSubscribeEvent` | 不建立事件订阅 |
| 设备身份 | `GET /ISAPI/System/deviceInfo` | `model`、`firmwareVersion`、`firmwareReleasedDate`、`hardwareVersion` | 不建立设备身份基线 |

**重要：** `supportFunction` 必须逐操作判断（`get/setUp/post/put/delete` 分别检查），不能用“总能力 true”替代具体操作。

---

## 5. 能力矩阵

### 5.1 总览

| 指标 | 值 | 来源 |
|---|---:|---|
| 候选端点 | 27 | `P02`/`P03` |
| 文档存在 | 27/27 | `P02`/`P03` |
| 目标设备 capability 支持 | **0/27** | `P03` 全部 `targetCapability=unverified` |
| 真实调用验证 | **0/27** | `P03` 全部 `realCall=not-executed` |
| `allowedNow=true` | **0** | `P03` |
| 真实 Provider 发布 | **false** | `P03` 顶层 |
| 设备操作放行 | **false** | `P03` 顶层 |

> `O05`/`O06` 只证明官方 SDK 定义中存在部分 FDLib 端点；它们不是目标设备 capability 证据，也不能把 `P03` 的 `unverified` 升级。

### 5.2 设备与人员

| ID | 方法/路径 | 读写 | 文档 | 目标 capability | 实测 | 现有代码 | 结论 |
|---|---|---|---|---|---|---|---|
| `SYS-DEVICE-INFO` | `GET /ISAPI/System/deviceInfo` | 只读 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `SYS-CAPABILITIES` | `GET /ISAPI/System/capabilities` | 只读 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `AC-CAPABILITIES` | `GET /ISAPI/AccessControl/capabilities` | 只读 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `USER-CAPABILITIES` | `GET /ISAPI/AccessControl/UserInfo/capabilities?format=json` | 只读 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `USER-COUNT` | `GET /ISAPI/AccessControl/UserInfo/Count?format=json` | 只读 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `USER-SEARCH` | `POST /ISAPI/AccessControl/UserInfo/Search?format=json` | 写请求/读结果 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `USER-RECORD` | `POST /ISAPI/AccessControl/UserInfo/Record?format=json` | 写 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `USER-SETUP` | `PUT /ISAPI/AccessControl/UserInfo/SetUp?format=json` | 写（upsert） | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `USER-MODIFY` | `PUT /ISAPI/AccessControl/UserInfo/Modify?format=json` | 写 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `USER-DETAIL-DELETE` | `PUT /ISAPI/AccessControl/UserInfoDetail/Delete?format=json` | 写 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `USER-DETAIL-DELETE-PROCESS` | `GET /ISAPI/AccessControl/UserInfoDetail/DeleteProcess` | 只读 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |

**人员链路注意：** 文档流程要求先人员、后人脸；`USER-DETAIL-DELETE` 成功响应只表示开始执行，`DeleteProcess` 用于轮询进度。目标固件是否仍采用该语义，必须实测。

### 5.3 人脸与库

| ID | 方法/路径 | 读写 | 文档 | 目标 capability | 实测 | 现有代码 | 结论 |
|---|---|---|---|---|---|---|---|
| `FD-CAPABILITIES` | `GET /ISAPI/Intelligent/FDLib/capabilities?format=json` | 只读 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `FD-LIST` | `GET /ISAPI/Intelligent/FDLib?format=json` | 只读 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `FD-CREATE` | `POST /ISAPI/Intelligent/FDLib?format=json` | 写 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证；首期禁止自动建库 |
| `FD-COUNT-ALL` | `GET /ISAPI/Intelligent/FDLib/Count?format=json` | 只读 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `FD-COUNT-BY-LIB` | `GET /ISAPI/Intelligent/FDLib/Count?format=json&FDID=<FDID>&faceLibType=<faceLibType>` | 只读 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `FD-SEARCH` | `POST /ISAPI/Intelligent/FDLib/FDSearch?format=json` | 写请求/读结果 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `FD-RECORD` | `POST /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json` | 写 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `FD-MODIFY` | `PUT /ISAPI/Intelligent/FDLib/FDModify?format=json` | 写 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `FD-SETUP` | `PUT /ISAPI/Intelligent/FDLib/FDSetUp?format=json` | 写（upsert） | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `FD-DELETE` | `PUT /ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=<FDID>&faceLibType=<FDType>` | 写 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证；禁止空列表/全库删除 |

**危险端点：**

- `FD-CREATE`：首期不得自动建库；必须由现场确认库不存在、且厂商/项目批准后人工执行。
- `FD-DELETE`：必须限定 `FDID`、`faceLibType`、`FPID` 列表；拒绝空数组；禁止删除全部人脸库。
- `USER-DETAIL-DELETE`：必须限定目标人员；禁止无边界的全量删除。

### 5.4 事件

| ID | 方法/路径 | 读写 | 文档 | 目标 capability | 实测 | 现有代码 | 结论 |
|---|---|---|---|---|---|---|---|
| `EVENT-ALERT-STREAM` | `GET /ISAPI/Event/notification/alertStream` | 长连接只读 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `EVENT-SUBSCRIBE-CAP` | `GET /ISAPI/Event/notification/subscribeEventCap` | 只读 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `EVENT-SUBSCRIBE` | `POST /ISAPI/Event/notification/subscribeEvent` | 写订阅 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `EVENT-HTTPHOSTS-CAP` | `GET /ISAPI/Event/notification/httpHosts/capabilities` | 只读 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证 |
| `EVENT-HTTPHOSTS-GET` | `GET /ISAPI/Event/notification/httpHosts?security=<security>&iv=<iv>` | 只读 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证；认证参数不得入日志 |
| `EVENT-HTTPHOSTS-PUT` | `PUT /ISAPI/Event/notification/httpHosts?security=<security>&iv=<iv>` | 写配置 | `P` 存在 | 未验证 | 0 | 未调用 | 待设备验证；首期禁止自动配置 |

**事件结论：** 文档只证明“有长连接/订阅/推送配置入口”，不证明目标固件支持、不证明推送认证方式、不证明事件签名或防重放。真实事件入口在证据关闭前必须保持 `NOT_CONFIGURED`。

---

## 6. 人员、人脸、门权限、FDID、图片

### 6.1 人员字段

| 字段 | 文档约束（`P`） | 风险 | 目标状态 | 设计处理 |
|---|---|---|---|---|
| `UserInfo.employeeNo` | 通用新增 schema 1–32；默认字母数字；特殊字符随产品变化 | 若直接使用 `personId` 可能超长/含非法字符 | 待设备验证 | 建立稳定 `personId → employeeNo` 受控映射；最终格式由 `EmployeeNoInfo` 决定；不使用手机号 |
| `UserInfo.name` | 0–128，可选 | 姓名属于个人信息 | 待设备验证 | 只传业务必要显示名；不进入普通日志 |
| `UserInfo.userType` | `normal/visitor/blackList/maintenance/patient/custom1..5/administrator` | 住户流程误用 `administrator`；`blackList` 与项目黑名单语义不同 | 待设备验证 | 住户只使用经批准的类型；不把项目黑名单自动映射为厂商 `blackList` |
| `UserInfo.Valid` | 人员有效期对象；`enable`、`beginTime`、`endTime`、`timeType` | 设备时间/NTP 不准会导致提前失效或长期有效 | 待设备验证 | 绑定 grant 的 `validFrom/validUntil`；明确 `timeType`；禁止默认长期有效 |
| `UserInfo.doorRight` | 逗号分隔门权限；空表示无门权限；只传它而不传 `RightPlan` 表示长期拥有对应门权限 | 可能形成长期权限，绕过租期 | 待设备验证 | 不单独下发 `doorRight`；必须与 `RightPlan` 和有效期一起使用；门号来自审批映射 |
| `UserInfo.RightPlan[]` | 不能脱离 `doorRight` 单独下发；`doorNo` 为整数；`planTemplateNo` 有特殊模板 65535/65534/65533 | 房间号≠门号；特殊模板可能扩大权限 | 待设备验证 | 只使用经审批的 `doorNo`/`planTemplateNo`；特殊模板需单独批准 |
| `UserInfoSearchCond.maxResults` | 通用示例 1–100；实际上限由 capability 决定 | 写死 100 可能超限或截断 | 待设备验证 | 读取 capability；分页直到完整；不假定 100 |
| `UserInfoSearchCond.EmployeeNoList.maxSize` | 通用示例 56 | 批量查询可能截断 | 待设备验证 | 读取 capability；不写死 56 |

### 6.2 人脸字段

| 字段 | 文档约束（`P`） | 风险 | 目标状态 | 设计处理 |
|---|---|---|---|---|
| `FDID` | 人脸库 ID；可见光示例为 `1`；深度模式另有库 | 写死 1 可能写错库或失败 | 待设备验证 | 先 `FD-LIST` + capability，选择审批过的库；不写死 |
| `faceLibType` | `blackFD/staticFD/infraredFD` | `blackFD` 是厂商名单库语义，不等同项目黑名单 | 待设备验证 | 由目标库决定；不得把项目黑名单自动映射为 `blackFD` |
| `FPID` | 通用 schema 标 optional，但门禁业务必填；与非视频 `employeeNo` 一致 | 缺少稳定映射会导致人脸与人员脱钩 | 待设备验证 | 建立 `employeeNo ↔ FPID` 持久映射；不得因 optional 省略 |
| `faceURL` | 与 `modelData` 二选一；请求字段在根对象 | 设备访问公网 URL 的能力/安全未知 | 待设备验证 | 首期不使用公网 URL；禁止日志记录原值 |
| `modelData` | 与 `faceURL` 二选一；目标模型数据 | 生物特征数据，敏感 | 待设备验证 | 按私密生物特征处理；不入日志/普通响应/公开 fixture |
| `img` | multipart 图片二进制；示例 `Content-Type: image/jpeg` | 格式/大小/分辨率/质量/是否必须 multipart 未证实 | 待设备验证 | 只接受经校验的 JPEG 字节；大小上限见 §6.4 |
| `name` | 通用新增 schema 标必填 | 可能强制采集姓名 | 待设备验证 | 只用必要显示名；若可省略则省略；不编造 |
| `bornTime` | 通用新增 schema 标必填 | 可能强制采集生日 | 待设备验证 | 不额外采集生日；先请厂商确认能否省略；禁止编造占位值 |

### 6.3 FDID 与 `faceLibType` 的选择

1. 先 `GET /ISAPI/Intelligent/FDLib?format=json` 读取实际库列表。
2. 再 `GET /ISAPI/Intelligent/FDLib/capabilities?format=json` 读取 `supportFunction`、`FDRecordDataMaxNum`。
3. 只选择项目审批过的库；库 ID/类型写入配置/映射，不写死在代码。
4. 可见光库文档示例为 `FDID=1`；深度模式可能涉及其他库；**不得**把示例当目标值。
5. `blackFD` 只表示厂商名单库类型，不是项目黑名单；项目黑名单仍由 `BlacklistService` 独立判断。
6. 若无法确认库类型或目标人员应写入哪个库，失败关闭，不创建新库、不猜测。

### 6.4 图片格式/尺寸/大小/质量

| 项目 | 证据 | 结论 | 状态 |
|---|---|---|---|
| MIME | `P03` 的 `FaceDataRecord.img` 示例 `Content-Type: image/jpeg` | 文档示例为 JPEG；其他 MIME 未证实 | 待设备验证 |
| 最大字节 | `P04` 称人脸图片当前限制 200 KB；`P02` 错误码 `0x30006010` 也描述人脸下发图片约 200 KB 上限 | 项目内官方摘要支持“约 200 KB”；目标固件未实测 | 待设备验证 |
| 分辨率/宽高比 | `P02` 错误码 `0x40006011` 只说明“分辨率或宽高比异常” | 具体阈值未证实 | 待设备验证 |
| 人脸角度/质量 | `P02` 错误码 `0x40006010`/`0x40006017`/`0x6000604C` 等描述质量/角度/无人脸 | 只能说明存在校验，不能给出阈值 | 待设备验证 |
| 尾随载荷/EXIF/多脸 | 未找到公开官方逐项约束 | 未知 | 待设备验证 |
| multipart 字段名/表单方式 | `P03` 标 `multipart:img`，条件性 | 目标固件是否要求该方式未证实 | 待设备验证 |

**内部保守策略（不是厂商保证）：**

- 只接受通过文件头校验的 JPEG；拒绝扩展名伪装；
- 读取真实字节数，超过 `200 * 1024` 直接拒绝（该上限来自项目内官方摘要，待目标固件确认）；
- 不信任客户端提交的 MIME/尺寸；
- 图片字节只在内存/私密文件服务中使用，不入日志、不入普通 DTO、不入 Git；
- 若厂商确认更严格限制，按更严格值收紧；若厂商确认可放宽，仍需独立复审后才调整。

### 6.5 门权限

| 项目 | 文档约束（`P`） | 设计结论 | 状态 |
|---|---|---|---|
| `doorRight` | 逗号分隔；空=无权限；单独使用=长期权限 | 不单独使用；必须与有效期/计划一起 | 待设备验证 |
| `RightPlan` | 不能脱离 `doorRight`；按门配置模板 | 需要经审批的门/模板映射 | 待设备验证 |
| `doorNo` | 门编号（锁 ID），整数 | 不能用房间号代替 | 待设备验证 |
| `planTemplateNo` | 同门多模板按“或”；65535/65534/65533 为特殊模板 | 特殊模板不得默认使用 | 待设备验证 |
| 生效验证 | 文档不证明“接口成功=门权限生效” | 必须做人员/权限回查和现场开门验证 | 待设备验证 |

**结论：** 门权限是本项目最容易“接口成功但业务过度授权”的区域。没有目标设备的 `doorNo`、模板、有效期联合实测前，真实 Provider 不得写门权限。

---

## 7. 字段映射

> 本表是**映射设计提案**，不是目标设备已确认的字段表。`P` 表示文档/项目摘要存在；`Q` 表示目标固件待验证。

| 内部语义 | 厂商候选字段/端点 | 证据 | 目标状态 | 约束/备注 |
|---|---|---|---|---|
| `personId` | `UserInfo.employeeNo` | `P` | 待设备验证 | 稳定映射；长度/字符集由 `EmployeeNoInfo` 决定；不用手机号 |
| `credentialId` | `FPID` | `P` | 待设备验证 | 门禁业务必填；与 `employeeNo` 持久映射 |
| `sourceFileId` | `FaceDataRecord.img` / `faceURL` / `modelData` | `P` | 待设备验证 | 首期只用私有文件字节；不用公网 URL |
| `deviceId` | 无直接等价；设备身份由受控代理/`deviceRef` 持有 | `C`/`P` | 待设备验证 | 不把序列号/IP 下发客户端或写日志 |
| `grantId` | 无厂商字段 | `C` | 已证实（平台内部） | 仅平台关联，不传给设备 |
| `validFrom`/`validUntil` | `UserInfo.Valid.beginTime/endTime` | `P` | 待设备验证 | 与 grant 周期绑定；明确 `timeType` |
| `timeType` | `UserInfo.Valid.timeType`（`local`/`UTC`） | `P` | 待设备验证 | 设备时区/NTP 未确认前不写死 |
| `doorRight`/`RightPlan` | `UserInfo.doorRight`、`RightPlan[].doorNo/planTemplateNo` | `P` | 待设备验证 | 不长期授权；特殊模板需批准 |
| `FDID` | `FaceDataRecord.FDID`、`FDSearch.FDID`、`FDSetUp.FDID` | `P` | 待设备验证 | 先读库列表/capability；不写死 |
| `faceLibType` | `FaceDataRecord.faceLibType`、`FDSearch.faceLibType` | `P` | 待设备验证 | `blackFD` 不等同项目黑名单 |
| `jobId` | 无厂商 job ID | `C` | 已证实（平台内部） | 平台任务 ID；厂商请求 ID 若存在另存 |
| `providerRequestId` | 未找到统一字段 | `Q` | 待设备验证 | 不得用响应中的设备序列号/内部 ID 代替 |
| `idempotencyKey` | 不发送给设备 | `C` | 已证实（平台内部） | 由 K2 派生 op key；不存原始键 |
| 事件标识 | `EventNotificationAlert.UUID`（可选） | `O` | 待设备验证 | 无强制 `eventId`；UUID 可选 |
| 事件类型 | `eventType` | `O` | 已证实（通用信封） | 门禁事件子结构未证实 |
| 事件时间 | `dateTime`（ISO8601 带偏移） | `O` | 已证实（通用信封） | 设备时钟可信度待验证 |
| 事件计数/顺序 | `activePostCount` | `O` | 已证实（通用信封） | 是否可作序列号未证实 |
| 错误码 | `statusCode`/`subStatusCode`/`errorCode` | `P` | 待设备验证 | 不能仅凭码值判定可重试 |
| 设备时间 | `DeviceInfo.firmwareReleasedDate` 等 | `P` | 待设备验证 | 只存必要版本信息；序列号/MAC 不入报告 |

---

## 8. 操作语义：新增、更新、删除、查询、异步

### 8.1 内部方法到厂商候选步骤

| 内部方法 | 候选厂商步骤 | 顺序 | 成功判据 | 异步/未知 | 状态 |
|---|---|---|---|---|---|
| `enrollFace` | `UserInfo/Record`（或 `SetUp`）→ `FaceDataRecord`（或 `FDSetUp`）→ `UserInfo/Search`/`FDSearch`/`Count` 回查 | 先人员后人脸 | 人员存在 + 人脸记录存在 + 绑定一致；仅 HTTP 200 不够 | 任一步发送后超时/断连 → `UNKNOWN_RESULT`；不自动重放 | 待设备验证 |
| `updateFace` | `UserInfo/Modify` → `FDModify`/`FDSetUp` → 回查 | 先人员后人脸 | 修改后回查一致 | 同上 | 待设备验证 |
| `revokeFace` | `FDSearch/Delete` → `UserInfoDetail/Delete` → `DeleteProcess` 轮询 → 回查 | 先人脸后人员；不假设人员删除级联人脸 | 人脸不存在 + 人员不存在（或明确已删除） | 删除进度异步；超时/未知 → `awaiting_result` | 待设备验证 |
| `queryOperation` | `UserInfo/Search`、`FDSearch`、`Count`、`DeleteProcess` | 只读 | 返回目标记录/进度；不修改业务 | 查询本身也可能失败；不得把“查不到”当“已删除” | 待设备验证 |
| `verifyEvent` | `EVENT-ALERT-STREAM` / `EVENT-SUBSCRIBE` / `httpHosts` | 长连接/推送 | 通过鉴权、时间窗、去重、绑定匹配 | 事件异步、可重复、可乱序 | 暂不支持 |

### 8.2 新增/更新语义

1. **先人员后人脸**：文档流程明确；目标固件是否强制未验证。
2. **新增 vs 设置**：`Record` 在人员已存在时文档说明报错；`SetUp` 为不存在则新增、存在则修改；`Modify` 在不存在时报错。真实 Provider 必须选定一种并固定，不得按错误猜切换。
3. **回查是成功的一部分**：写接口 200 只表示“接受/可能执行”；必须用 `Search`/`Count`/`FDSearch` 回查目标记录。回查失败/超时 → `UNKNOWN_RESULT`，不得标记成功。
4. **证件/姓名最小化**：`name` 可选则省略；`bornTime` 不额外采集；不得为通过校验编造生日。
5. **人脸图片**：先做本地字节校验，再以 multipart/受支持方式发送；具体方式待实测。

### 8.3 删除/撤权语义

1. **业务撤权先于设备清理**（H4 冻结）：grant 先 `revoked`、`cleanupPending=true`，设备清理异步。
2. **不假设人员删除级联人脸**：文档未证明；必须先删人脸、再删人员，最后双向回查。
3. **删除进度**：`UserInfoDetail/Delete` 成功只表示开始；`DeleteProcess` 轮询直到完成/失败/超时。
4. **删除不存在**：不能直接当成功；除非厂商明确幂等或设备实测证明，否则按 `TERMINAL`/人工对账处理。
5. **禁止全库删除**：`FD-DELETE` 必须限定 `FDID`、`faceLibType`、`FPID` 列表；空列表拒绝。
6. **设备离线**：业务撤权仍立即生效；设备清理进入重试/未知；不得因为设备离线而恢复业务授权。

### 8.4 查询语义

- 查询是只读的，但**查询结果可能最终一致**；文档未承诺强一致。
- `Count` 只能作为容量/对账信号，不能替代逐人员/逐人脸查询。
- `DeleteProcess` 是删除进度，不是通用任务查询。
- H1–H4 没有真实 `queryOperation` 实现；H4-c 的人工对账不使用自动查询。真实 Provider 若未来增加查询，必须另立契约，不能把查询变成自动重发。

### 8.5 异步语义

| 操作 | 文档是否明确异步 | 目标设备是否异步 | 本卡处理 |
|---|---|---|---|
| 人员新增/修改 | 未明确；通常按 HTTP 响应 | 待验证 | 响应后回查；超时→未知 |
| 人员删除 | **是**：`DeleteProcess` 轮询 | 待验证 | 有界轮询；超时→未知；不自动重发 |
| 人脸新增/修改/删除 | 未明确；删除文档称成功即已删除 | 待验证 | 仍以回查为准；不假设立即生效 |
| 事件 | **是**：长连接/推送 | 待验证 | 事件只作证据；不自动推进业务 |
| 平台任务 | 现有 H3/H4 异步 job | 已实现（Mock） | 真实 Provider 不改变 job 状态机 |

### 8.6 重复请求

| 情形 | 平台侧行为 | 厂商侧风险 | 设计结论 |
|---|---|---|---|
| 同 `Idempotency-Key` + 同 `requestDigest` | 返回原结果，不重发 | 无第二次请求 | 已由 K2 保证 |
| 同键 + 不同摘要 | `CONFLICT`，零写 | 无请求 | 已由 K2 保证 |
| 不同键 + 相同业务操作 | 新 job，允许新请求 | 设备可能重复新增/重复删除 | 厂商是否幂等未证实；不得假设 |
| 同键重放但 operation key 损坏 | `CONFLICT` | 无请求 | 失败关闭 |
| 超保留期后同键再提交 | 视为新操作 + 审计 | 可能重复 | 不静默重放；需人工确认 |
| 设备返回“已存在/不存在” | 由错误映射决定 | 可能重复/误判 | 不直接当成功；按 §10 映射 |

---

## 9. 离线、超时、未知结果与重复请求

### 9.1 核心原则

1. **发送前失败**：只有在能证明“请求未到达设备”时，才允许 `RETRYABLE`。
2. **发送后失败**：连接中断、读超时、响应解析失败、5xx、未知状态，一律 `UNKNOWN_RESULT`。
3. **未知不自动重试**：进入 `awaiting_result`，由人工对账（H4-c）或未来受控查询收敛。
4. **不把查询当写**：查询失败/查不到不能证明删除/新增成功。
5. **超时不是失败**：超时只证明“未在时限内得到结果”，不证明设备未执行。

### 9.2 场景分类

| 场景 | 发生阶段 | 内部分类 | 是否自动重试 | job 状态 | 备注 |
|---|---|---|---|---|---|
| DNS 解析失败 | 发送前 | `RETRYABLE` | 可，按退避预算 | `retryable_failed` | 需确认无请求发出 |
| TCP 连接被拒 | 发送前 | `RETRYABLE` | 可 | `retryable_failed` | 设备离线/端口错误 |
| TLS 握手失败 | 发送前 | `RETRYABLE` | 可，但需告警 | `retryable_failed` | 不得降级 HTTP/跳过证书 |
| 请求写入前超时 | 发送前 | `RETRYABLE` | 可 | `retryable_failed` | 需确认未写出 |
| 请求已写出、等响应超时 | 发送后 | `UNKNOWN_RESULT` | **禁止** | `awaiting_result` | 可能已执行 |
| 连接在响应前断开 | 发送后 | `UNKNOWN_RESULT` | **禁止** | `awaiting_result` | 同上 |
| HTTP 401/403 | 响应 | `TERMINAL`/`DENIED` | 否 | `terminal_failed` | 认证/权限问题；告警 |
| HTTP 404/405 | 响应 | `TERMINAL` | 否 | `terminal_failed` | 路径/方法错误 |
| HTTP 400/413/415/422 | 响应 | `TERMINAL` | 否 | `terminal_failed` | 载荷/格式/大小错误 |
| HTTP 409 | 响应 | `TERMINAL`（保守） | 否 | `terminal_failed` | 设备状态冲突；不自动 |
| HTTP 429 | 响应 | `RETRYABLE` 仅当确认未执行且有 `Retry-After` | 有条件 | `retryable_failed` | 未证实语义；默认保守 |
| HTTP 5xx | 响应 | `UNKNOWN_RESULT` | **禁止** | `awaiting_result` | 可能已执行 |
| 200 + `statusCode=1` | 响应 | `accepted`（不等于生效） | 否 | 继续回查 | 回查失败→未知 |
| 200 + `statusCode!=1` | 响应 | 按厂商码映射；默认 `TERMINAL`/`UNMAPPED` | 否 | `terminal_failed` | 不自动重试 |
| 响应 JSON/XML 解析失败 | 响应 | `UNKNOWN_RESULT` | **禁止** | `awaiting_result` | 可能已执行 |
| 设备离线（连接失败） | 发送前 | `RETRYABLE` | 可 | `retryable_failed` | 不改变业务撤权 |
| 设备离线（发送后断线） | 发送后 | `UNKNOWN_RESULT` | **禁止** | `awaiting_result` | 需人工对账 |
| 迟到结果/事件 | 发送后 | 证据，不自动推进 | 否 | 保持 | 由对账/独立契约处理 |
| 重复回调 | 任意 | 确定性 ID 去重 | 否 | 不重复写 | 已由 H3/H4 证明 |

### 9.3 超时参数

- H3 Mock 使用 **10 秒调用窗口**、**60 秒租约**；这是 Mock 阶段的冻结值，不是厂商超时。
- 真实 HTTP 的连接/读取超时、重试次数、退避上限**尚未冻结**（Q19）。
- 真实 Provider 不得直接复用 H3 的进程内超时/租约假设；必须另立异步契约。
- 在真实契约批准前，`live + hikvision` 保持 `NOT_CONFIGURED`。

### 9.4 重复请求与“未知”的交互

1. 同键重放在平台层直接返回原结果，不再发请求；因此不会因“未知”产生第二次设备写。
2. 不同键的新请求不保证厂商幂等；设备可能重复新增/重复删除。
3. 对“未知”的任务，不得用新键自动重发；必须人工对账或未来受控查询。
4. 人工对账的 `confirmed_removed`/`confirmed_present` 仅处理本地资源，不调用 Provider（H4-c 冻结）。

---

## 10. 错误映射

### 10.1 内部错误枚举（LOCK-01A 冻结）

| 内部枚举 | 含义 | 默认 HTTP | 是否可重试 |
|---|---|---:|---|
| `NOT_CONFIGURED` | Provider/代理/密钥/设备门禁未配置 | 503 | 否 |
| `CONFLICT` | 幂等冲突、记录损坏、状态冲突 | 409 | 否 |
| `RETRYABLE` | 已确认未执行的瞬态失败，或厂商明示可重试 | 503/429 | 有条件 |
| `TERMINAL` | 明确终态失败 | 4xx/5xx | 否 |
| `UNKNOWN_RESULT` | 可能已执行，结果不明 | 202 | **否** |
| `DENIED` | 权限/认证拒绝 | 403 | 否 |

**默认安全原则：** 无法证明请求未执行时，一律 `UNKNOWN_RESULT`，不得自动重试。

### 10.2 HTTP/传输层映射（内部设计）

| 条件 | 分类 | 依据 | 备注 |
|---|---|---|---|
| DNS/TCP/TLS 在建连阶段失败 | `RETRYABLE` | 请求未发出 | 需确认无字节写出 |
| 请求写出前取消 | `RETRYABLE` | 明确未执行 | 记录 transport 阶段 |
| 请求写出后超时/断连 | `UNKNOWN_RESULT` | 可能已执行 | 不自动 |
| 401/403 | `DENIED`/`TERMINAL` | 认证/权限失败 | 不重试；告警配置 |
| 404/405 | `TERMINAL` | 路由/方法错误 | 不重试 |
| 400/413/415/422 | `TERMINAL` | 载荷/格式/大小 | 不重试 |
| 409 | `TERMINAL` | 设备状态冲突 | 保守；人工处理 |
| 429 | `RETRYABLE`（条件） | 限流；通常未执行 | 需 `Retry-After` + 未执行证据 |
| 5xx | `UNKNOWN_RESULT` | 可能已执行 | 不自动 |
| 200 + `statusCode=1` | `accepted` | 设备接受 | 不等于生效；需回查 |
| 200 + `statusCode!=1` | 按厂商码 | 设备明确错误 | 默认不重试 |
| 解析失败 | `UNKNOWN_RESULT` | 可能已执行 | 不自动 |

> 上述是**内部映射设计**，不是海康官方语义。厂商是否把 429 视为未执行、5xx 是否可能已执行，均需实测/书面答复。

### 10.3 厂商错误码子集（项目内官方摘要，`P`）

来源：`P02`/`P03` 的错误码 XLSX 摘要（SHA-256 见 `P04`）。所有码的原始 `retryability=undetermined`、`internalMapping=UNMAPPED`；下表“默认分类”是本项目建议，不是厂商结论。

| 厂商码 | `subStatusCode` | 官方含义（摘要） | 默认分类 | 是否可重试 | 备注 |
|---|---|---|---|---|---|
| `0x40000001` | `notSupport` | 设备不支持 | `TERMINAL` | 否 | 能力门未通过 |
| `0x40000002` | `lowPrivilege` | 权限不足 | `DENIED` | 否 | 账号/权限 |
| `0x40000003` | `badAuthorization` | 认证不通过 | `DENIED` | 否 | 不重试；检查凭据/时钟 |
| `0x40000004` | `methodNotAllowed` | HTTP 方法不允许 | `TERMINAL` | 否 | 路径/方法错误 |
| `0x40000006` | `invalidOperation` | 非法操作（通道/硬件不支持） | `TERMINAL` | 否 | 能力/参数问题 |
| `0x40000007` | `notActivated` | 设备未激活 | `TERMINAL` | 否 | 现场配置 |
| `0x4000000A` | `invalidContent` | 非法报文内容 | `TERMINAL` | 否 | 不重试 |
| `0x4000000B` | `maxSessionUserLink` | 达到最大用户连接 | `UNMAPPED` | 否 | 可能需要人工/限流；不自动 |
| `0x30006010` | `fileSizeExceedError` | 文件太大；人脸图片约 200 KB 限制 | `TERMINAL` | 否 | 图片超限；见 §6.4 |
| `0x400010C1` | `addFaceRecordFailed` | 人脸记录添加失败 | `UNMAPPED` | 否 | 需上下文；可能重复/质量/容量 |
| `0x400010C2` | `deleteFaceRecordFailed` | 人脸记录删除失败 | `UNMAPPED` | 否 | 不能当成功 |
| `0x400010C3` | `modifyFaceRecordFailed` | 人脸记录修改失败 | `UNMAPPED` | 否 | 需上下文 |
| `0x400010C4` | `queryFaceRecordFailed` | 人脸记录查询失败 | `UNMAPPED` | 否 | 查询失败≠不存在 |
| `0x40006010` | `faceLowQulity` | 人脸质量较差 | `TERMINAL` | 否 | 重新采集，不自动重试 |
| `0x40006011` | `faceResolutionOrRatioError` | 分辨率/宽高比异常 | `TERMINAL` | 否 | 需目标阈值 |
| `0x40006012` | `faceDataNotExist` | 用户人脸数据不存在 | `TERMINAL` | 否 | 删除场景不可直接当成功 |
| `0x60006015` | `deleteNoExistFace` | 删除的人脸不存在 | `UNMAPPED` | 否 | 是否幂等成功未证实 |
| `0x60007000` | `deviceUserFull` | 人员已满 | `TERMINAL` | 否 | 容量 |
| `0x60007001` | `deviceFaceFull` | 人脸已满 | `TERMINAL` | 否 | 容量 |
| `0x60007002` | `deviceUserAlreadyExist` | 人员已存在 | `CONFLICT`/`TERMINAL` | 否 | 不自动切换为修改 |
| `0x60007003` | `deviceUserNotExist` | 人员不存在 | `TERMINAL` | 否 | 删除/修改场景 |
| `0x60007004` | `deviceUserAlreadyExistFace` | 人员已存在一张人脸 | `CONFLICT`/`TERMINAL` | 否 | 不自动覆盖 |
| `0x60000031` | `faceLibraryIDError` | 人脸库 ID 无效 | `TERMINAL` | 否 | FDID 配置错误 |
| `0x6000002D` | （摘要：超过人脸库最大个数） | 超过人脸库最大个数 | `TERMINAL` | 否 | 容量/配置 |
| `0x6000002E` | `faceImagesNumError` | 超过人脸图片最大张数 | `TERMINAL` | 否 | 容量 |
| `0x6000604C` | `pictureFaceDetectZero` | 图片中不存在人脸 | `TERMINAL` | 否 | 重新采集 |
| `0x6000604D` | `faceTypeError` | 下发人脸错误 | `TERMINAL` | 否 | 格式/类型 |
| `0x60007012` | `invalidFaceRegion` | 人脸区域不合法 | `TERMINAL` | 否 | 图片/区域 |

**规则：**

1. 不得把任何厂商码直接映射为 `RETRYABLE`，除非官方明确“未执行”或目标设备实测证明。
2. “已存在/不存在”类码不得自动转成成功；是否幂等必须逐端点验证。
3. `0x60006015` 等删除不存在码，只有在目标设备明确幂等且经过写测试后才可视为成功。
4. 错误码必须与端点、方法、请求是否执行、设备上下文一起记录；不能只看码值。

### 10.4 错误到 job 状态

| 内部分类 | job 目标 | 是否重试 | 告警 |
|---|---|---|---|
| `RETRYABLE` | `retryable_failed` | 按退避预算 | 记录 transport 阶段 |
| `TERMINAL` | `terminal_failed` | 否 | 记录脱敏原因码 |
| `UNKNOWN_RESULT` | `awaiting_result` | 否 | `RESULT_UNKNOWN`/`CLEANUP_UNKNOWN` |
| `CONFLICT` | 保持/`terminal_failed`（按上下文） | 否 | 幂等/状态冲突 |
| `DENIED` | `terminal_failed` | 否 | 权限/认证告警 |
| `NOT_CONFIGURED` | `terminal_failed` | 否 | `CONFIGURATION_BLOCKED` |

### 10.5 错误响应脱敏

- 不返回原始设备响应、异常 message/stack、认证头、cookie、realm、nonce、序列号、IP/MAC、账号、人脸字节。
- 只返回统一错误信封：`code`、`message`（固定安全文案）、可选 `reasonCode`/`alertCode`、`retryAfterMs`（仅 `RETRYABLE`）。
- 日志只记录白名单字段：`orgId`、内部 `deviceId/deviceRef`、`jobId`、action、状态迁移、attempt、租约 owner、延迟分桶、规范化错误类、配置版本。

---

## 11. 事件：签名、时间窗、nonce/eventId、防重放与验签

### 11.1 公开官方证据能证明什么

| 项目 | 公开官方证据 | 结论 | 状态 |
|---|---|---|---|
| 事件传输 | `O07`/`O08` 是 ISAPI 事件 schema；`P04` 称支持 HTTP/HTTPS 长连接和 `httpHosts` 推送 | 存在长连接/订阅/推送入口 | 已证实（文档存在） |
| 通用信封字段 | `O07`：`dateTime`、`activePostCount`、`eventType`、`eventState`、`eventDescription` 为必填；`deviceID`、`channelID`、`UUID`、`macAddress` 等为可选，`ipAddress` 为 dep | 通用信封字段存在 | 已证实（通用 schema） |
| 门禁事件子结构 | `O07` 展示的是通用信封，示例子节点为 ANPR；未给出 `AccessControllerEvent` 等门禁子结构 | 门禁事件字段需实测 | 待设备验证 |
| 订阅字段 | `O08`：`eventMode`（`all/list`）、`EventList[].type`、`heartbeat`、`channels`、`identityKey` | 订阅 schema 存在 | 已证实（通用 schema） |
| `eventId` | `O07` 没有强制 `eventId` 字段；只有可选 `UUID` | 不能假设设备提供稳定事件 ID | 待设备验证 |
| 签名 | `O07`/`O08` 未记录事件级签名、HMAC 或证书签名 | 不能声称厂商支持事件签名 | **暂不支持/待确认** |
| nonce | `O07`/`O08` 未记录 nonce | 不能声称厂商支持 nonce | **暂不支持/待确认** |
| 防重放 | 公开 schema 未记录时间窗/去重/重放保护 | 需现场验证 | 待设备验证 |
| 心跳 | `O08` 有 `heartbeat`；`P03` 记录 `eventType` 可为 `heartBeat` | 心跳与业务事件需分开 | 已证实（文档存在） |
| 重传 | `O07` 有可选 `isDataRetransmission`（通用信封） | 可能存在重传；语义未证实 | 待设备验证 |

**关键结论：**

- 公开官方资料**没有**给出厂商级事件签名/nonce/时间窗/防重放字段。
- 不能把 `mock-sig`、Mock 5 分钟窗口、`eventId/version` 写成生产验签。
- 真实事件入口在证据关闭前必须 `NOT_CONFIGURED`。
- 事件只能作为“设备侧发生了某事”的证据，不能单独证明授权有效；业务开门仍需实时 grant/入住/人员校验。

### 11.2 现有 Mock 事件契约（`C`）

| 项目 | 现有实现 | 边界 |
|---|---|---|
| 域 | `domain` 固定 `mock.test` | 仅测试 |
| 事件 ID | `eventId` 有界字符串 | 合成 |
| 签名 | `mock-sig:<domain>:<eventId>:<version>` | **不是生产鉴权** |
| 时间窗 | `abs(now - occurredAt) <= 300000 ms` | 合成 |
| 版本 | 严格递增，按 `orgId` / `deviceId` / `jobId` 维度 | 合成 |
| 重放 | 同组织同 `eventId` 同摘要返回原结果；不同摘要 `CONFLICT` | 合成 |
| 绑定 | 必须匹配同组织、同设备上的 job；否则 `rejected` | 合成 |
| live | `executionMode=live` → `NOT_CONFIGURED` | 真实入口关闭 |

### 11.3 真实事件验签/防重放设计提案（内部设计，未实现）

> 以下是**平台侧设计提案**，不是厂商能力。任何一条在实现前都必须有目标设备事件样本、时间/NTP 证据和独立复审。

#### 11.3.1 入口与传输

1. 设备事件只能进入受控内网代理/边缘服务；不得由小程序、浏览器或公网直接接收。
2. 代理终止 TLS，校验设备证书/CA 或网络白名单（具体方式 Q25）。
3. 代理使用独立的最小权限凭据与设备通信；不得复用用户凭据。
4. 代理将事件规范化为内部信封；原始 XML/JSON、IP/MAC、序列号、账号、人脸图片不得进入业务库/日志。

#### 11.3.2 验证流水线

| 顺序 | 检查 | 失败处理 |
|---:|---|---|
| 1 | TLS/设备身份/网络来源 | 拒绝，审计 |
| 2 | HTTP 认证/权限（Digest 或代理凭据） | 401/拒绝，审计 |
| 3 | Content-Type/大小/编码/schema 精确校验 | 拒绝，审计 |
| 4 | 时间窗：`abs(now - dateTime) <= maxSkewMs` | `EVENT_STALE`/拒绝 |
| 5 | 事件身份/去重 | 重复→幂等返回；冲突→拒绝/告警 |
| 6 | nonce/签名（若代理提供） | 失败→拒绝 |
| 7 | 组织/设备/job 绑定 | 未知→`rejected`，不自动建业务 |
| 8 | 业务资格/grant 实时校验 | 不作为事件验签的替代 |
| 9 | 状态迁移（若批准） | 仅在独立契约批准后 |

#### 11.3.3 事件身份

- 首选：厂商 `UUID`（若目标固件稳定提供且唯一）。
- 回退：组合键 `(deviceRef, eventType, dateTime, channelID, activePostCount)`；但这只是**待验证提案**，字段可能缺失/重复。
- 不得用“自增计数”单独作为全局唯一 ID。
- 去重存储只保存不可逆摘要/内部 ID，不保存原始事件载荷；TTL 建议 ≥ 最大重放窗口（Q25）。
- 同 ID 不同摘要 → 冲突告警，不覆盖。

#### 11.3.4 时间窗

- 建议默认 `maxSkewMs = 5 分钟`（与 Mock 相同仅作起点，不是厂商值）；可配置。
- 设备时间/NTP 不可信时，不能仅靠设备 `dateTime`；必须记录代理接收时间并做双时间戳判断。
- 未来时间超过 `maxSkewMs` 拒绝；过旧超过窗口拒绝；窗口外事件进入审计而不是业务。
- 具体窗口、设备时钟偏差、时区处理待现场验证（Q25/Q26）。

#### 11.3.5 nonce/签名

- 公开官方 schema 没有 nonce/签名；**不得伪造厂商签名**。
- 若需要端到端完整性，可在受控代理上增加**内部** HMAC（独立密钥 K4，不复用 K1/K2/K3），对规范化信封 + 时间戳 + nonce 签名；这只能证明“代理收到并转发的完整性”，不能证明“设备原生签名”。
- 内部签名必须：时间戳、nonce、请求体摘要、密钥版本、常量时间比较、重放缓存；密钥缺失/版本不符失败关闭。
- 是否引入 K4、代理签名和 nonce，属于待裁定项（Q25），本卡不实现。

#### 11.3.6 事件与业务状态

- 事件默认只写审计/证据，不自动改变 grant/job 终态。
- 任何“事件→job succeeded/device_verified”的映射都必须另立契约，且需要可信设备证据；不能仅凭一条事件。
- 心跳事件不匹配业务 job，不产生业务写。
- 重复/乱序/迟到事件：幂等/审计；不覆盖已提交终态。

### 11.4 事件状态总表

| 能力 | 厂商证据 | 本卡结论 |
|---|---|---|
| 事件长连接/订阅 | `O07`/`O08`/`P` | 文档存在；目标待验证 |
| `eventType/dateTime/eventState` | `O07` | 通用信封已证实；门禁子结构待验证 |
| 稳定 `eventId` | `O07` 仅可选 `UUID` | 待设备验证 |
| 事件签名 | 无 | **暂不支持** |
| nonce | 无 | **暂不支持** |
| 时间窗/防重放 | 无厂商字段 | 待设备验证 |
| 验签实现 | 无 | **暂不支持** |
| 事件→业务状态 | 无 | **暂不支持**（需另立契约） |

### 11.5 事件字段映射

| 内部字段 | 厂商候选 | 证据 | 状态 | 备注 |
|---|---|---|---|---|
| `eventKey` | `UUID` / 组合键 | `O`/`Q` | 待设备验证 | 无强制 `eventId` |
| `eventType` | `eventType` | `O` | 已证实（通用） | 门禁类型待验证 |
| `eventState` | `eventState` | `O` | 已证实（通用） | `active/inactive` |
| `occurredAt` | `dateTime` | `O` | 已证实（通用） | ISO8601 带偏移 |
| `sequence` | `activePostCount` | `O` | 待设备验证 | 是否严格递增未证实 |
| `deviceRef` | `deviceID`/`macAddress`/`ipAddress` | `O` | 待设备验证 | 敏感，不落普通日志 |
| `channel` | `channelID`/`dynChannelID` | `O` | 待设备验证 | 门禁通道语义待验证 |
| `personRef` | 门禁事件子结构（未证实） | `Q` | 待设备验证 | 不能假设字段名 |
| `cardNo`/`employeeNo` | 门禁事件子结构（未证实） | `Q` | 待设备验证 | 不能假设字段名 |
| `signature` | 无 | `O` | **暂不支持** | 不伪造 |
| `nonce` | 无 | `O` | **暂不支持** | 不伪造 |

---

## 12. 设计建议、不可冻结项与离线测试

### 12.1 现在可以冻结的内部不变量

这些是平台侧设计，可在后续 Provider 实现中复用；不需要目标设备证据：

1. **Provider 工厂默认关闭**：`live + hikvision` 在配置/门禁不完整时 `NOT_CONFIGURED`；不得回退 Mock。
2. **能力门先行**：缺 capability/字段/库信息 → 不调用写接口。
3. **最小字段**：只传业务必要字段；不传姓名/生日/房间号等非必要个人信息。
4. **不存原始载荷**：原始设备响应、认证头、cookie、realm、nonce、IP/MAC、序列号、账号、人脸字节不进业务库/日志/Git。
5. **发送前/发送后分离**：只有确认未发送才 `RETRYABLE`；发送后未知一律 `UNKNOWN_RESULT`。
6. **未知不自动重试**：`awaiting_result` 不被定时器/轮询/回调自动推动。
7. **事件失败关闭**：无签名/无时间窗/无去重证据时，真实事件入口保持 `NOT_CONFIGURED`。
8. **图片保守上限**：只接受 JPEG；>200 KB 拒绝；该值待目标固件确认。
9. **门权限不长期化**：不单独下发 `doorRight`；必须绑定有效期/计划。
10. **删除不假设级联**：先人脸后人员，双向回查。
11. **错误不暴露原文**：统一错误信封 + 脱敏日志。
12. **测试离线**：真实 Provider 的测试必须使用 fake transport/fake secret，禁止 DNS/TCP/TLS/HTTP。

### 12.2 现在不能冻结的厂商侧内容

| 内容 | 为什么不能冻结 | 关闭条件 |
|---|---|---|
| 实际端点/方法/请求体 | 目标固件 capability 未验证 | 六 GET + 写测试 |
| `employeeNo` 长度/字符集 | `EmployeeNoInfo` 未读取 | capability 实测 |
| `FDID`/`faceLibType` | 库列表/深度模式未确认 | `FD-LIST` + 厂商答复 |
| 图片格式/尺寸/质量 | 只有 200 KB/JPEG 示例 | 目标设备图片测试 |
| 门号/模板 | `doorNo`/`planTemplateNo` 未映射 | 门权限现场测试 |
| 删除是否级联 | 文档未证明 | 删除前后回查 |
| 错误码可重试性 | 全部 `undetermined` | 逐端点实测/厂商书面答复 |
| 事件签名/nonce/time window | 公开 schema 未记录 | 事件样本 + 认证测试 |
| 异步/轮询时限 | 只有人员删除进度文档 | 目标固件实测 |
| 许可/配额/并发 | 未取得 | 商务/厂商 |
| 平台 OpenAPI 路线 | 未选路线 | 路线评审 |

### 12.3 后续实现门禁

| 门 | 内容 | 未通过时 |
|---|---|---|
| G1 | 完整铭牌型号、固件、区域版本 | 不写 Provider |
| G2 | 六个只读 GET（HK-AI-02 白名单） | 不做写测试 |
| G3 | 隔离设备写测试（人员/人脸/门权限/删除） | 不实现真实写 |
| G4 | 事件样本、认证、时间/NTP、防重放测试 | 不接事件 |
| G5 | 安全复审（密钥、代理、日志、隐私） | 不上线 |
| G6 | Provider 发布批准 + 设备操作门禁 + kill switch | `live` 保持关闭 |

### 12.4 离线测试矩阵（设计，不实现）

> 未来实现时使用纯本地 fake transport/fake secret；禁止任何网络/设备访问。

| ID | 场景 | 预期 |
|---|---|---|
| T01 | live Provider 未配置 | `NOT_CONFIGURED`，网络 0 |
| T02 | 发布门禁关闭 | 拒绝，零写 |
| T03 | 设备门禁关闭 | 拒绝，零写 |
| T04 | kill switch 开启 | 拒绝新下发；查询/审计仍可读 |
| T05 | 缺 capability/字段 false | 不调用写接口 |
| T06 | FDID 未知/库列表失败 | 不写人脸 |
| T07 | 图片 >200 KB/非 JPEG | `TERMINAL`，零网络 |
| T08 | 发送前连接失败 | `RETRYABLE`，按退避 |
| T09 | 发送后超时 | `UNKNOWN_RESULT`，不重发 |
| T10 | 5xx | `UNKNOWN_RESULT`，不重发 |
| T11 | 401/403 | `DENIED`/`TERMINAL`，不重试 |
| T12 | 200 + 厂商错误码 | 映射表命中/`UNMAPPED`，不自动 |
| T13 | 同键同摘要 | 重放，不第二次调用 |
| T14 | 同键异摘要 | `CONFLICT`，零写 |
| T15 | 不同键重复业务 | 新 job；不假设厂商幂等 |
| T16 | 删除不存在 | 不直接成功；按映射/人工 |
| T17 | 事件无签名/nonce | 拒绝/`NOT_CONFIGURED` |
| T18 | 事件超时间窗 | 拒绝，审计 |
| T19 | 事件重复/同 ID 异摘要 | 幂等/冲突，不覆盖 |
| T20 | 事件未知设备/未知 job | `rejected`，不建业务 |
| T21 | 事件心跳 | 不产生业务写 |
| T22 | 原始响应/凭据/序列号/IP 进入日志 | 扫描零命中 |
| T23 | Provider 输入/上下文白名单 | 无敏感字段 |
| T24 | Mock 回归 | demo/test 行为不变 |

---

## 13. 待确认清单

> 所有项默认 `open`。关闭必须有可复核证据；不得用推测、厂商销售口述或近似型号替代。

| ID | 待确认项 | 为什么阻塞 | 需要的证据 | 归属 | 关联 |
|---|---|---|---|---|---|
| Q01 | 完整铭牌型号与全部后缀（是否实际为 BM/BM-3XFTD/其他） | 决定指南/型号适用性 | 脱敏铭牌照片 + 设备管理页 | 项目负责人/厂商 | H01 |
| Q02 | 目标固件、构建日期、硬件版本、区域版本 | 决定 capability 基线 | `deviceInfo` 脱敏响应 + 厂商书面答复 | 项目负责人/厂商 | H02 |
| Q03 | 裸 BM 是否适用普通指南，还是必须其他指南 | 决定文档依据 | 厂商书面型号/固件/指南对应关系 | 海康支持 | H03 |
| Q04 | 路线：设备 ISAPI / 平台 OpenAPI / 其他 | 决定端点/认证/许可 | 路线评审 + 官方部署说明 | 架构/厂商 | LOCK-01A Q6 |
| Q05 | HTTPS 端口、TLS 证书、证书信任、是否允许自签 | 决定传输安全 | 受控配置记录 + 认证测试 | 现场网络/安全 | H09 |
| Q06 | Digest 算法/qop、401 语义、时钟偏差 | 决定认证失败分类 | 认证抓包/脱敏记录 + 官方说明 | 现场/厂商 | H09 |
| Q07 | 设备时间/NTP/时区 | 决定 `Valid` 是否正确 | 设备时间页 + NTP 配置 | 现场 | H09 |
| Q08 | `AccessControl/capabilities` 实际节点 | 决定人员/人脸/删除是否可用 | 脱敏只读响应 | 探针执行人 | H04 |
| Q09 | `UserInfo/capabilities` 的 `supportFunction`/`maxRecordNum`/分页/批量上限 | 决定人员操作与容量 | 脱敏只读响应 | 探针执行人 | H05 |
| Q10 | `employeeNo` 长度/字符集/压缩 | 决定 personId 映射 | `EmployeeNoInfo` 响应 + 实测 | 探针/厂商 | H05 |
| Q11 | `FDLib/capabilities` 的 `supportFunction`/`FDRecordDataMaxNum` | 决定人脸操作与容量 | 脱敏只读响应 | 探针执行人 | H06 |
| Q12 | `FDID`/`faceLibType` 选择、是否需建库、深度模式双库 | 决定人脸库路线 | `FD-LIST` + 能力 + 厂商说明 | 海康支持/现场 | H07 |
| Q13 | 图片 MIME、最大字节、分辨率、宽高比、角度、质量、EXIF/尾随载荷、multipart 字段 | 决定录入实现 | 目标型号/固件书面约束 + 隔离实测 | 海康支持 | H08 |
| Q14 | `name`/`bornTime` 是否必填、能否省略 | 决定隐私最小化 | 目标 capability + 最小化测试 | 海康支持 | H12 |
| Q15 | `doorRight`/`RightPlan`/`doorNo`/`planTemplateNo`/特殊模板 | 决定门权限映射 | 经审批映射 + 门权限实测 | 项目/厂商 | H11 |
| Q16 | 新增/设置/修改的实际语义与重复行为 | 决定用哪个端点 | 目标实测 | 探针执行人 | Q15 |
| Q17 | 删除人员是否级联删除人脸 | 决定删除顺序与残留 | 删除前后人员/人脸回查 | 海康支持/现场 | H10 |
| Q18 | `UserInfoDetail/Delete` 请求/进度 schema、完成判定、时限 | 决定异步删除 | 官方接口 + 删除进度响应 | 海康支持 | H10 |
| Q19 | 人脸删除不存在时的语义、是否幂等 | 决定删除重试/对账 | 目标实测 | 探针执行人 | Q16 |
| Q20 | 查询一致性/分页上限/超时 | 决定回查可靠性 | 目标实测 | 探针执行人 | H05/H06 |
| Q21 | 目标固件错误码与 HTTP 状态映射、是否可重试 | 决定错误映射 | 逐端点错误注入 + 厂商答复 | 海康支持 | H08 |
| Q22 | 并发连接/会话/调用配额/限频 | 决定容量与退避 | 厂商书面 + 实测 | 商务/厂商 | H14 |
| Q23 | 设备离线时写操作行为（拒绝/排队/丢失） | 决定离线语义 | 隔离断网测试 | 现场 | H15 |
| Q24 | 设备侧是否幂等（同请求重复下发） | 决定是否可安全重试 | 隔离重复请求测试 | 探针执行人 | Q16 |
| Q25 | 事件来源/传输/认证方式（长连接/推送/代理） | 决定事件入口 | 官方说明 + 抓包/脱敏样本 | 海康支持/安全 | H13 |
| Q26 | 事件身份：`UUID`/`eventId`/`activePostCount` 的稳定性与唯一性 | 决定去重键 | 多次事件样本 | 探针执行人 | H13 |
| Q27 | 事件签名/nonce/时间窗/防重放能力 | 决定验签设计 | 官方说明 + 异常样本 | 海康支持/安全 | H13 |
| Q28 | 事件时间语义、设备时钟可信度、时区 | 决定时间窗 | NTP/时间页 + 事件样本 | 现场 | H13 |
| Q29 | 事件重传/重复/乱序/丢失行为 | 决定幂等与告警 | 断网/重连/重复测试 | 现场 | H13 |
| Q30 | 门禁事件子结构（人员/卡号/门号/结果） | 决定事件字段映射 | 目标固件事件样本 | 探针执行人 | H13 |
| Q31 | 许可/费用/合作伙伴权限/IP 白名单 | 决定立项与接入 | 书面许可/配额 | 商务/厂商 | H14 |
| Q32 | 隔离测试设备、独立 VLAN、边缘主机、人工开门预案 | 决定能否做写测试 | 隔离拓扑 + 访问控制 | 现场网络 | H15 |
| Q33 | 测试人员同意、私密人脸保存期限、删除/无残留签字 | 决定合规 | 书面同意 + 清理记录 | 隐私/运营 | H16 |
| Q34 | 平台 OpenAPI 路线（若选 B）的认证/回调/配额 | 决定平台契约 | 官方 OpenAPI 指南 | 平台/厂商 | LOCK-01A Q6 |
| Q35 | Provider 发布批准、设备操作放行、kill switch 运维 | 决定能否上线 | 独立复审 + 运维配置 | 架构/运维 | HK-AI-06 |

### 13.1 与 HK-AI-01 H01–H16 的映射

| HK-AI-01 | 本卡 Q | 状态 |
|---|---|---|
| H01 铭牌型号 | Q01 | open |
| H02 固件/硬件 | Q02 | open |
| H03 指南适用性 | Q03 | open |
| H04 AccessControl capability | Q08 | open |
| H05 UserInfo capability | Q09/Q10 | open |
| H06 FDLib capability | Q11 | open |
| H07 FDID/faceLibType | Q12 | open |
| H08 图片约束 | Q13/Q21 | open |
| H09 HTTPS/Digest/NTP | Q05/Q06/Q07 | open |
| H10 删除/进度/级联 | Q17/Q18 | open |
| H11 门/模板 | Q15 | open |
| H12 name/bornTime | Q14 | open |
| H13 事件 | Q25–Q30 | open |
| H14 许可/配额 | Q22/Q31 | open |
| H15 隔离环境 | Q23/Q32 | open |
| H16 隐私/清理 | Q33 | open |

---

## 14. 验证记录

### 14.1 公开官方链接核验

核验日期：2026-11-14；方法：Python `urllib` GET，跟随重定向，记录 HTTP 状态、最终 URL、Content-Type、读取字节数，并对 HTML 检查关键标记。10 个公开官方 URL 全部 HTTP 200；连同 7 个 GitHub 引用 URL，共 17 个绝对 URL 全部 200。

| ID | HTTP | Content-Type | 读取字节 | 关键标记 | 目标型号字符串 |
|---|---:|---|---:|---|---|
| `O01` | 200 | `text/html; charset=UTF-8` | 409864 | 是 | 否 |
| `O02` | 200 | `text/html;charset=utf-8` | 959820 | 是 | 否 |
| `O03` | 200 | `text/html; charset=utf-8` | 28105 | 是 | 否 |
| `O04` | 200 | `text/html; charset=utf-8` | 48691 | 是 | 否 |
| `O05` | 200 | `text/html` | 4403 | 是 | 否 |
| `O06` | 200 | `text/html` | 5957 | 是 | 否 |
| `O07` | 200 | `text/html` | 29402 | 是 | 否 |
| `O08` | 200 | `text/html` | 3335 | 是 | 否 |
| `O09` | 200 | `application/pdf` | 3000000（截断读取） | `%PDF-` | 否 |
| `O10` | 200 | `text/html;charset=utf-8` | 1112601 | 是 | 否 |

**判定：**

- `O02`/`O03`/`O04`/`O10` 均**不含** `DS-K1T671BM` 字符串（程序化检查）；
- `O02` 含 `DS-K1T671` 族内型号；
- `O03`/`O04` 是 `DS-K1T671M(D)/MW(D)/MG(D)` 手册；
- 公开官方资料不能把 BM 从“待设备验证”升级。

### 14.2 仓库检查

| 检查 | 命令/方法 | 结果 |
|---|---|---|
| `git diff --check` | `git diff --cached --check`（仅本卡两文件） | **通过**，退出码 0 |
| 链接 | 17 个绝对 URL（10 公开官方 + 7 GitHub 引用） | **17/17 HTTP 200**；无相对链接 |
| 敏感值扫描 | 正则扫描 IP/密码/密钥/令牌/私钥/手机号/证件号/序列号；排除 40/64 位 Git/SHA 十六进制 | **0 命中** |
| 仅新增文档 | `git diff --cached --name-status` | **仅 2 个 `docs/tasks/HK-AI-06A-*`** |
| 用户改动保留 | 不 add/stage/commit 用户已有文件 | 见 §14.4 |
| 真实设备/云调用 | 本次无 | 0 |
| HTTP 路由注册 | 未修改 `server.mjs` | 0 |
| Provider 生产代码 | 未新增/修改 | 0 |

### 14.3 本次未执行

- 未运行完整测试套件（文档分支；且工作区存在用户未提交的 H4-c 实现改动，不应由本卡触发/覆盖）。
- 未做真实设备只读/写测试。
- 未做事件样本采集。
- 未做厂商书面询价/许可。

### 14.4 用户已有改动的保留

工作区存在用户正在进行的 H4-c 实现文件（例如 `admin-web/lib/face-service/h4c-evidence.mjs`、`admin-web/lib/face-service/index.mjs`、`admin-web/lib/store.mjs`、`admin-web/tests/face-h4c-evidence.test.mjs`）及其他未跟踪文档。本卡：

- 不修改、不格式化、不 stage、不 commit 这些文件；
- 提交时只指定本卡新增的文档路径；
- 不清理用户未跟踪文件；
- 不切换/重写用户的分支历史。

---

## 附录 A：来源索引

### A.1 公开官方来源

| ID | 标题 | URL |
|---|---|---|
| `O01` | 海康官网首页 | <https://www.hikvision.com/cn/> |
| `O02` | `DS-K1T671M` 产品页 | <https://www.hikvision.com/en/products/Access-Control-Products/terminals/face-recognition-terminal/ds-k1t671m/> |
| `O03` | `DS-K1T671(D)` 系列手册“适用型号” | <https://pinfo.hikvision.com/unzip/20200529162252_11893_doc/GUID-94610A63-6105-4972-9CBC-16F6AE031DCD.html> |
| `O04` | `DS-K1T671(D)` 系列手册“技术参数” | <https://pinfo.hikvision.com/unzip/20200529162252_11893_doc/GUID-B4D2C8AC-60A2-4066-9270-C9990CBD20B5.html> |
| `O05` | ISAPI `ACS_USERFACE` 接口定义 | <https://open.hikvision.com/hardware/v2/%e6%8e%a5%e5%8f%a3%e5%ae%9a%e4%b9%89/NET_DVR_SendWithRecvRemoteConfig%28ACS_USERFACE%29.html> |
| `O06` | ISAPI FDLib 图片接口定义 | <https://open.hikvision.com/hardware/definitions/NET_DVR_STDXMLConfig_XFA_FDLib_pic.html> |
| `O07` | ISAPI `EventNotificationAlert` v2.0 | <https://open.hikvision.com/hardware/v2/XML%E6%96%87%E4%BB%B6/XML_EventNotificationAlert.html> |
| `O08` | ISAPI `SubscribeEvent` v2.0 | <https://open.hikvision.com/hardware/v2/XML%E6%96%87%E4%BB%B6/XML_SubscribeEvent.html> |
| `O09` | ISAPI 接口定义 PDF | <https://open.hikvision.com/hardware/v2/%E6%8E%A5%E5%8F%A3%E5%AE%9A%E4%B9%89/pdf.pdf> |
| `O10` | 人脸识别终端分类页 | <https://www.hikvision.com/en/products/Access-Control-Products/terminals/face-recognition-terminal/> |

### A.2 项目内证据/契约

| ID | 路径/提交 | 用途 |
|---|---|---|
| `P01` | `docs/tasks/HK-AI-01-EVIDENCE-MATRIX.md` | HK-AI-01 分级 |
| `P02` | `docs/devices/HIKVISION-ISAPI-EVIDENCE-MATRIX.md` | 27 端点/66 字段/50 错误码 |
| `P03` | `docs/devices/HIKVISION-ISAPI-PROVIDER-WHITELIST.json` | 机器可读白名单 |
| `P04` | `docs/devices/HIKVISION-ISAPI-DOCS-2026-11-05.md` | 官方指南元数据/页码 |
| `P05` | `docs/devices/HIKVISION-DS-K1T671BM-CAPABILITY.md` | BM 能力核对 0 条 |
| `P06` | `docs/devices/HIKVISION-DS-K1T671BM-RISKS.md` | 风险/Q1–Q12 |
| `P07` | `docs/database/LOCK-01A-CONTRACT.md` | Provider 接口契约 |
| `P08` | `docs/database/LOCK-01A-DATA-DESIGN.md` | 数据/claim/slot |
| `P09` | `docs/devices/LOCK-01A-REVIEW.md` | LOCK-01A 复审 |
| `P10` | H1 终审 `6bfe1ba` | H1 关闭 |
| `P11` | H2 终审（`f9a2b6b`/`2bc10e3`/`32c891f`/`feaa1e0`/`90cc848`） | H2 关闭 |
| `P12` | H3 设计/实现（`b2cd7ab`/`5e590ee`/`2b92b30`） | H3 关闭 |
| `P13` | H4 设计/实现（`1542a6c`/`685ac3a`/`ec8be46`/`b2b5a11`/`1155b7b`） | H4-b 关闭 |
| `P14` | H4-c 设计 `b15aceb`、终审 `ed7b66f` | H4-c 设计通过 |
| `P15` | `docs/tasks/HK-AI-04-H4B-EVIDENCE-2026-11-13.md` | H4-b 运行证据 |
| `P16` | `docs/tasks/HK-AI-06-HIKVISION-PROVIDER-PREFLIGHT-TASK-2026-11-11.md` | 前置框架禁止项 |

### A.3 关键 GitHub 引用

- H4-c 设计：<https://github.com/1997dmsu-sketch/SMART-PM/blob/b15aceb/docs/tasks/HK-AI-04-H4C-RECONCILIATION-DESIGN.md>
- H4-c 终审：<https://github.com/1997dmsu-sketch/SMART-PM/blob/ed7b66f/docs/tasks/HK-AI-04-H4C-DESIGN-APPROVAL-B15ACEB-2026-11-14.md>
- LOCK-01A 契约：<https://github.com/1997dmsu-sketch/SMART-PM/blob/ed7b66f/docs/database/LOCK-01A-CONTRACT.md>
- LOCK-01A 数据设计：<https://github.com/1997dmsu-sketch/SMART-PM/blob/ed7b66f/docs/database/LOCK-01A-DATA-DESIGN.md>
- HK-AI-01 证据矩阵：<https://github.com/1997dmsu-sketch/SMART-PM/blob/ed7b66f/docs/devices/HIKVISION-ISAPI-EVIDENCE-MATRIX.md>
- HK-AI-01 白名单 JSON：<https://github.com/1997dmsu-sketch/SMART-PM/blob/ed7b66f/docs/devices/HIKVISION-ISAPI-PROVIDER-WHITELIST.json>

---

## 附录 B：状态与枚举

### B.1 凭证审核

`draft` → `submitted` → `approved` / `rejected` → `revoked`。

### B.2 授权

`pending` → `effective` → `suspended` / `revoked` / `expired`。

### B.3 任务

`queued` → `sending` → `awaiting_result` / `succeeded` / `retryable_failed` / `terminal_failed`；`retryable_failed` → `queued` / `cancelled`；终态 `succeeded`/`terminal_failed`/`cancelled`。

### B.4 证据范围

`simulated` / `device_verified`。Mock 永远 `simulated`；`device_verified` 需要可信设备证据，不能由普通事件/调用者伪造。

### B.5 错误枚举

`NOT_CONFIGURED` / `CONFLICT` / `RETRYABLE` / `TERMINAL` / `UNKNOWN_RESULT` / `DENIED`。

---

## 附录 C：交付物与复审入口

| 交付 | 路径 | 说明 |
|---|---|---|
| 本设计 | `docs/tasks/HK-AI-06A-HIKVISION-PROVIDER-EVIDENCE-2026-11-14.md` | 证据、字段/错误映射、能力矩阵、待确认清单 |
| 证据索引 | `docs/tasks/HK-AI-06A-EVIDENCE-INDEX.json` | 公开链接、项目内证据、代码引用、核验状态 |
| 复审请求 | 本分支提交 + 交付回报 | 交 Codex 复审；不合并、不部署、不接设备 |

**复审重点建议：**

1. 是否把近似型号/文档示例误写成 BM 能力；
2. 是否把内部设计写成厂商事实；
3. 字段/错误映射是否有证据出处；
4. 事件签名/nonce/time window 是否保持“未证实”；
5. 待确认清单是否覆盖 H01–H16 与 LOCK-01A Q1–Q12；
6. 是否只提交本卡文档、保留用户改动；
7. 链接、`git diff --check`、敏感扫描是否通过。
