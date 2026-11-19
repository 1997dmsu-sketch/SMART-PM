# 预签约 S1 独立授权清单（持久单飞 / CAS · 待 Codex 复审）

- 日期：2026-11-19（Asia/Shanghai）
- 执行者：DSH 根代理 `lead`（`deepseek-flash`）；Windows PowerShell 5.1.19041.1 / Git `2.55.0.windows.3` / Node `v24.19.0`
- 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\rental-s1-authorization`
- 分支：`docs/rental-s1-authorization`
- 固定输入（v2）：`45957578aca352bc06ec541dd7fbb4433371ac94`（v1 清单提交；本地 HEAD = 输入；远端同名分支 tip 实测同为该 SHA）
- 本清单父提交：`45957578aca352bc06ec541dd7fbb4433371ac94`（v2 为追加提交，**父即本轮固定输入**）
- 父链：`4595757`（v1 清单）→ `8a2f8d9`（T1–T13 裁定回写）→ `4a30e6e` → …
- 本清单唯一修改文件：`docs/tasks/RENTAL-PRESIGNING-S1-AUTHORIZATION-2026-11-19.md`
- 已批准契约：`docs/RENTAL-OPEN-ITEMS-CONTRACT-CARD.md`（第五版；427 行；blob `94d61ed1c3d44bdb02249aa96e10d57422d5225d`，本清单提交时未变）
- 上级任务卡：`docs/tasks/RENTAL-PRESIGNING-STAGED-IMPLEMENTATION-TASK-2026-11-18.md`（v5；653 行；本清单只引用，不改写）
- 代码基线：`3bf595140088bc71a3939fb67880807965e9c566`；自该基线至 `8a2f8d9` 运行时代码/测试/Store **零 diff**，变更仅两份 docs（契约卡 v5、任务卡 v5）
- 版本：v2（2026-11-19 退修：成功审计并入允许写集、回退事务定义、缓存返回 S1/S2 边界、九项技术口径逐项证据状态）
- 状态：**仅修订本清单（v2）；不实施、不运行测试、不安装依赖、不改代码/测试/Store/契约/任务卡；待 Codex 独立复审（不自批）**

> **本清单不构成实施授权。** 清单通过（PASS）只表示 S1 的“文件白名单 + 逐例预期 + 失败关闭口径”可被 Codex 复审；S1 开工仍须另有一份**单独书面批准**，写明批准范围与该时刻 tip SHA。批准前不得改任何代码/测试。

## 0. 输入、远端与基线核对（本轮实测）

| 项 | 实测值 | 核验方式 |
|---|---|---|
| 本轮固定输入（v1 清单） | `45957578aca352bc06ec541dd7fbb4433371ac94` | `git rev-parse HEAD` |
| 输入父提交（v1 清单的父） | `8a2f8d9172544decd5def108ca689988ec92bf8f` | `git rev-parse HEAD^` |
| 父链 | `4595757` → `8a2f8d9` → `4a30e6e` | `git log --oneline` |
| 远端 `refs/heads/docs/rental-s1-authorization` | `45957578aca352bc06ec541dd7fbb4433371ac94`（= v1 清单；本 v2 推送前） | `git ls-remote` |
| 远端 `refs/heads/docs/rental-staged-implementation-task` | `8a2f8d9172544decd5def108ca689988ec92bf8f`（未动） | `git ls-remote` |
| 分叉/前移 | 无：远端 s1 分支 tip = 本地 HEAD = 本轮固定输入 | `ls-remote` + `rev-parse` |
| 工作树 | 干净（`git status --porcelain=v1` 空） | 修订前实测 |
| 运行时代码零 diff | `3bf5951..8a2f8d9` 仅 `docs/RENTAL-OPEN-ITEMS-CONTRACT-CARD.md`、`docs/tasks/RENTAL-PRESIGNING-STAGED-IMPLEMENTATION-TASK-2026-11-18.md` | `git diff --name-only` |
| 契约 blob / 行数 | `94d61ed1…` / 427 | `git rev-parse HEAD:docs/…` + 行数 |
| `domain.js` | blob `5027c5a4e8b38e484e361b1ac3e72cf90985f662`，1085 行，**无 `paymentRequest` 字段** | `git rev-parse HEAD:…`、全文检索 |
| `store.js` / `admin-web/lib/store.mjs` | blob `6b38e8ee…` / `53ffc9df…`；allowed 集合**不含**新集合 | 同上 |
| 两份租赁测试 | `tests/leasing.test.cjs` 175 行 / 3 个 `test(`；`admin-web/tests/leasing.test.mjs` 781 行 / 22 个 `test(` | 行数 + `test(` 计数 |
| `tests/rental-network-guard.cjs` | **不存在**（S1 新增） | 文件系统 |
| 本轮材料 | `PARALLEL-DISPATCH.md` / `REVIEW.md` 正文**未取得**（详见 §11.2） | 路径逐一 `Test-Path` + 递归/全 refs 检索 |
| fetch 环境告警（记录，不掩盖） | `git fetch --no-write-fetch-head origin --prune` 退出码 0，但 stderr 报 `refs/remotes/origin/HEAD.lock: Permission denied`（共享 `.git` 目录锁/ACL 问题） | stderr 原文 |

fetch 告警的处置：远端事实一律以 `git ls-remote`（网络权威）为准，未依赖可能未更新的 remote-tracking ref；未改动任何 Git 配置、未使用 TLS 绕过。该告警不影响本清单只读核对与后续普通 push 的 `ls-remote` 复核。

### 0.1 文档父与“实际实施起点”必须分清

| 概念 | SHA / 位置 | 说明 |
|---|---|---|
| 本清单父提交 | `45957578aca352bc06ec541dd7fbb4433371ac94` | v1 清单提交；v2 在其上追加 |
| 本清单提交（记为 **X**） | 提交后由交付报告给出完整 SHA | 仅修本清单；X 的父是 `4595757` |
| S1 **实际实施起点** | **X**（不是 `4595757`，更不是 `8a2f8d9`） | S1 实施分支必须从 X 新建；X 必须在实施分支历史中 |
| S1 实施分支（建议名） | `feat/rental-s1-persistent-single-flight` | 从 X 新建，普通 push，追加提交 |
| 清单 PASS 的含义 | 仅“清单可复审” | 不等于 S1 批准；S1 仍需单独书面批准（范围 + 批准时 tip SHA） |

若 S1 实施会话拿到的入口 tip 不等于 X（或 X 之后仅有本清单文字修订的提交），必须停手报 Codex，不得以 `4595757`、`8a2f8d9` 或其它 SHA 代替。

## 1. 授权范围与冻结边界

### 1.1 本清单只授权 S1 的这些内容

| 编号 | S1 授权内容 | 契约/卡锚点 |
|---|---|---|
| A1 | 订单内嵌 `paymentRequest` 持久状态，字段形状按契约 §4.1 | 卡 §4.1-1 |
| A2 | 事务 CAS 单飞 claim：仅 `none` 或 lease 已过期的 `preparing`/`reconciling` 可接管；接管写 `epoch+1`、新 `attemptId` | 卡 §4.1-2 |
| A3 | `externalRequestSentAt` 只在本地校验全过、即将调用商户 create 前写入，并**持久化成功后才发 HTTP** | 卡 §4.1-3 |
| A4 | `externalRequestSentAt` 非空后**永久保留**（含 `reconciling`/`failed`），不得清空、不得回退 `none` | 契约 §4.1、§4.5；I2 |
| A5 | complete 带 `attemptId+epoch` CAS；**旧 attempt/epoch 的 complete/reconcile 写入必须失败**，不得覆盖新 epoch | 契约 §4.4；卡 §4.1-6 |
| A6 | S1 尚不能取真实 query 结果（S4 才实现）的失败关闭：固定 **503 `PAYMENT_QUERY_UNAVAILABLE`**，`create` 0、`query` 0、不返回参数、audit 0、有效 hold 保留 | 卡 §3.4；T7 前置 |
| A7 | create 成功且 complete CAS 有效 → `ready` + 保存 `prepay`/`clientParams` + **恰好 1 条成功审计** | 卡 §4.1-4；T1 前置 |
| A8 | 请求失败/未知/`failed` 不改变订单生命周期、不释放有效自有 hold；不使用进程内锁 | 契约 §4.2-6；卡 §4.1-9 |
| A9 | 测试基础设施：新增 `tests/rental-network-guard.cjs`，两份租赁测试改为“guard 先装、被测模块动态载入” | 卡 §3.5–3.9；卡 §4.1-10 |

### 1.2 本清单不授权（S2–S6 冻结，T1–T13 不重推）

| 冻结项 | 边界 |
|---|---|
| S2 缓存签名（prepay/TTL 分离、本地重签、prepay 过期 503） | **冻结**；S1 不实现 TTL 判定、不实现本地重签、不定义 prepay 过期/损坏缓存路径 |
| S3 流水事实唯一 / `rental_payment_transactions` | **冻结**；S1 不新增集合、不写支付事实 |
| S4 查询对账 / `failed` 终态进入 / `queryEvidence` 写入 | **冻结**；S1 只**读取** `failed` fixture 并拒绝，不产生 `failed`，不调用 query |
| S5 独立隐私同意 / `privacyVersion` / `rental_identity_consents` / 小程序与后台 UI | **冻结**；S1 不改隐私语义、不改 UI |
| S6 旧数据兼容迁移/回填/展示 | **冻结**；S1 只做“缺失字段按 `none` 读”的读取侧边界（§6），不做任何迁移写 |
| T1–T13 裁定 | **不重推、不重列、不改写**；v5 任务卡 §13 已回写，本清单只引用结论（如 T7 的“先 CAS 后 query”作为 S1 不变量，T6 的云 `code` 映射口径） |
| `index.js` / `wechat-pay.js` / 小程序 / 后台 UI / 契约卡 / v5 任务卡 | **禁改**；`git diff --name-only` 出现即 FAIL |
| 合并 / 部署 / HTTP/UI / 真实支付 / 设备 / 业务云 / 安装依赖 | **全程禁止** |

## 2. 唯一文件白名单（S1 实施提交的允许集）

S1 实施提交（可多个追加提交，但累计 diff）只允许命中以下文件；`git diff --name-only <X>..tip` 必须与下表完全一致（缺一或多一即 BLOCKED）：

```text
cloudfunctions/leasing/domain.js
cloudfunctions/leasing/store.js        # 默认零改动；改则须先书面说明理由并获批
admin-web/lib/store.mjs                # 默认零改动；同上
admin-web/tests/leasing.test.mjs
tests/leasing.test.cjs
tests/rental-network-guard.cjs         # 新增；仅测试 guard
```

| 文件 | 允许改动 | 默认预期 |
|---|---|---|
| `cloudfunctions/leasing/domain.js` | `paymentRequest` 状态机、claim/complete CAS、sent 标记、失败关闭、内部 seam | 必改 |
| `cloudfunctions/leasing/store.js` | 仅当 `transact` 选项/写入形状确需 | **零改动**（现有 `writeAudit:false` 已够用） |
| `admin-web/lib/store.mjs` | 仅同上 | **零改动**（现有 `writeAudit:false` + 队列串行已够用） |
| `admin-web/tests/leasing.test.mjs` | guard 先装 + S1 用例 + 既有用例改造 | 必改 |
| `tests/leasing.test.cjs` | guard 先装（现有 3 个断言不变） | 必改 |
| `tests/rental-network-guard.cjs` | 新增 guard（加载期/运行期网络拦截） | 新增 |

`store.js` / `admin-web/lib/store.mjs` 若被改动，S1 证据必须给出“为什么现有 transact/CAS 语义不足”的具体失败证据，否则视为超范围（G4 FAIL）。**不得**以“顺手统一”改动这两份 Store。

## 3. S1 必须实现的行为（逐条落位）

| 项 | 要求 | 对应用例 |
|---|---|---|
| 1 | 订单内嵌 `paymentRequest`；字段名/含义按契约 §4.1；S1 写 `queryEvidence=null`、`lastQueryAt=null`、`failedAt=null`；`failed` 仅读取与拒绝 | S1-3、S1-10、S1-16 |
| 2 | claim 用事务 CAS（订单 + hold + 两份证件 + settings refs）；仅 `none` 或 lease 过期的 `preparing`/`reconciling` 可接管；接管写 `epoch+1` + 新 `attemptId`；已发请求一律 `reconciling` 且不 create，尚需 query → 503 | S1-1、S1-2、S1-12、S1-13 |
| 3 | `externalRequestSentAt` 只能在本地校验全过、即将 create 前写入；**持久化成功后才发起 HTTP**；写入前的本地失败才可回退 | S1-6a、S1-6b、S1-8 |
| 4 | complete 带 `attemptId+epoch` CAS；有效 → `ready` + `prepay`/`clientParams` + 1 条成功审计；CAS/lease/epoch 失败或结果未知 → `reconciling`，保留待对账事实，不返回参数、不写 audit、不回滚 `none`/`failed` | S1-3、S1-4、S1-9、S1-14 |
| 5 | 适配器抛错/超时：`reconciling`、`externalRequestSentAt` 保留、不返回参数、0 audit、订单与 hold 不变 | S1-8、S1-11 |
| 6 | 旧 attempt/epoch 的 complete/reconcile 写入必须失败，不得覆盖新 epoch | S1-4、S1-9、S1-17 |
| 7 | `failed` 终态再次 `paymentParams` → 409（沿用现有订单不可支付错误，不新增码）、0 create、0 audit、不释放 hold；全部事实字段保留 | S1-10 |
| 8 | 继续支付硬条件：`hold.orderId === order._id` 且 `hold.until > now`；否则不得 create/返回参数 | S1-5 |
| 9 | 请求失败/未知/`failed` 不改变订单生命周期、不释放 hold；不得使用进程内锁 | S1-8、S1-11、S1-17 |
| 10 | 测试基础设施按 §3.5–3.9 | §7 |

### 3.1 缓存返回的 S1/S2 边界（防越界，须在 S1 证据中声明）

`ready` 的写入与“命中返回”是两段不同职责；S1 只负责把**本次成功 create 的结果**落库并原样返回，S2 才定义缓存生命周期。逐场景边界如下：

| 场景 | S1（本清单授权） | S2（冻结，本轮不实现） |
|---|---|---|
| create 成功 + complete CAS 有效 | 写 `prepay = { prepayId, createdAt }` 与 `clientParams`（适配器返回参数原样）；1 条成功审计 | 增加 `prepayExpiresAt`、`signatureExpiresAt`、`signedAt` 等 TTL 字段；TTL 取值在 S2 入口记录 |
| 重复请求命中 `ready` | 返回**已存** `clientParams`；create 0、query 0、audit 0、W0；**不判断 TTL/签名** | 判断 prepay 有效期；签名过期则用缓存 `prepayId` 本地重签；均有效返回缓存 |
| `prepay` 过期 | **不处理**（S1 不得写“过期判定/503”分支；避免与 S2 抢语义） | 缓存失效、不返回旧参数、固定 503 `PAYMENT_QUERY_UNAVAILABLE` |
| 损坏缓存（`package` 内 prepay 标识 ≠ `prepay.prepayId`） | **不处理** | 固定 503 `PAYMENT_QUERY_UNAVAILABLE` |
| 返回对象来源 | 仅 S1 自己在同一/前序 S1 attempt 写入的 `clientParams` 原样 | 缓存/重签后的 `clientParams`；断言 `prepayId` 不变 |

硬边界：

- S1 的 `ready` 命中只覆盖“S1 自己写入后的重复请求”窗口，**不构成 S2 缓存契约**；S1 不得以“缓存命中”为名实现 TTL、重签、过期清理。
- S2 入口必须显式更新并重跑受影响的 S1 断言：S1-3（`ready` 写入字段）、S1-15（命中返回）——在 S2 证据中列出 diff，不得静默改写。
- S1 不实现 `refreshPayment` 的 query 对账；`refreshPayment` 当前行为（`domain.js:863-879`）在 S1 不被改写（不改即零 diff）。
- S1 不删除 `prepay`/`clientParams` 缓存（缓存清理由 S4 的 `failed` 进入路径负责）。
- `prepayExpiresAt`/`signatureExpiresAt` 的**字段表示**（缺省 vs `null`）见 §11 第 3 项，属待核对口径；S1 证据必须记录实际选择，且不得让该选择影响 S1-3/S1-15 之外的断言。

### 3.2 事务定义：claim / sent / complete / 回退（唯一口径）

S1 的 `paymentRequest` 写入只能经由下列四个事务；没有第五种写法。所有事务的写集受 §4 约束（除成功审计外不写 audit）。

| 事务 | 触发 | refs | CAS 条件 | 允许写 | audit |
|---|---|---|---|---|---|
| **T1 claim** | `none` 首次请求，或 `preparing`/`reconciling` 的 lease 已过期 | `rental_preleases/<id>`、`rental_room_holds/<roomId>`、两份 `rental_identity_documents`、`rental_settings/global` | 当前 `paymentRequest` 状态 ∈ {`none`(缺失视为 none)、lease 过期的 `preparing`/`reconciling`}；接管时 `epoch = 读到的 epoch`（写 `+1`）；订单 `status`/hold/证件校验在同一事务内完成 | 仅 `paymentRequest`：`status`、`attemptId`（新 UUID）、`epoch+1`（首次 0→1）、`leaseUntil`、`startedAt`、`previous`（写前快照，见 T1'）、`externalRequestSentAt`（保留原值；首次为 `null`）、`queryEvidence:null`、`lastQueryAt:null`、`failedAt:null` | 0 |
| **T2 sent** | T1 成功且本地校验全过、即将调用 create | `rental_preleases/<id>` | `attemptId`+`epoch` 与 T1 写入值一致；`externalRequestSentAt` 为空 | 仅 `paymentRequest.externalRequestSentAt = now` | 0 |
| **T3 complete** | 适配器 create 返回（成功或失败都在此收敛） | `rental_preleases/<id>` | `attemptId`+`epoch` 与当前值一致且 lease 未过期；绑定校验在同一事务内完成 | 成功：`status:"ready"` + `prepay`/`clientParams`；失败：`status:"reconciling"`（保留 sent/attempt/epoch） | 成功 1；失败 0 |
| **T1' rollback** | 仅 T1 之后、T2 之前发生本地失败（外部请求必然未发出） | `rental_preleases/<id>` | `attemptId`+`epoch` 与 T1 写入值一致；**且 `externalRequestSentAt` 为空** | 把订单文档的 `paymentRequest` 恢复为 T1 的 `previous`：`previous = ABSENT` 时写**不含 `paymentRequest` 键**的订单文档（字段删除）；否则写 `previous` 原对象 | 0 |

T1' 的硬性规则（回应“回退事务定义 / 之前无字段还原 / CAS 与 sent 不可擦除”）：

1. **唯一窗口**：T1' 只允许在 `externalRequestSentAt` 为空时执行；T2 一旦提交成功，任何回退路径（回退、complete 失败、`failed`、清理）都不得删除、清空、置 `null` 或回写 `externalRequestSentAt`。
2. **之前无字段的还原**：T1 必须在 `previous` 中记录“字段是否存在”。若 T1 前订单**无** `paymentRequest` 字段，`previous` 记为 `ABSENT`；T1' 写回时不得写 `{status:"none"}`，而是写回一个**不含该键**的订单文档，使 `paymentRequest` 字段不存在（与 T1 前逐字节一致）。
3. **CAS**：T1' 必须带 `attemptId`+`epoch` 条件；CAS 失败（已被接管）⇒ **零写**并抛错，不得重试、不得覆盖新 epoch、不得把旧 `previous` 写回。
4. **sent 不可擦除**：静态断言 + 行为断言双重证明——代码中不存在 `delete order.paymentRequest` 式的 sent 清除分支，不存在 `externalRequestSentAt = null/undefined` 的写入；T1' 的 CAS 条件含 `sent 为空`，sent 非空时该事务直接失败。
5. **顺序**：T1 → （本地校验失败则 T1' 并结束）→ T2 → HTTP create → T3；T2 未持久化成功前不得调用适配器（证据：适配器内读取 store，断言 sent 非空且 `attemptId`/`epoch` 与当前一致）。
6. **audit**：T1/T2/T1' 一律 `writeAudit:false`；只有 T3 成功写 1 条成功审计（并入 §4 的 WP* 允许写集）。

## 4. 逐例唯一预期矩阵

写法约定：

- 写集 **W0** = 全库零写（`before=structuredClone(store.data)`、`after=structuredClone(store.data)`、`assert.deepEqual`，**含 `admin_audit` 长度与内容**）。
- 写集 **WP** = 仅 `rental_preleases/<orderId>` 的 `paymentRequest` 整字段被替换（外加 Store 自动写入的 `updatedAt`）；**`admin_audit` 必须整体 `deepEqual`（audit 0）**；其余集合/文档/字段 `deepEqual`。
- 写集 **WP\*** = WP + `admin_audit` **追加恰好 1 条**成功审计（action 精确 `租赁预约：核对支付资格`）；既有审计条目逐条仍在（多重集不变），其余集合/文档/字段 `deepEqual`。**只有 `ready` 成功路径允许 WP\***。
- 三种写集互斥，每个用例只能选一种；`audit` 列必须与写集列一致：**WP\* ⇔ 1，WP ⇔ 0，W0 ⇔ 0**；不一致即 FAIL（v2 修正 v1 的“WP 含 audit 深度相等”与“audit 1”矛盾）。
- **唯一限定用例 S1-14**：其窗口内先发生 `uploadIdentity`（写订单 `status`/hold/自身审计），因此该用例的写集断言限定为“`paymentRequest` 字段变化 + 不新增 `核对支付资格` 审计”；`uploadIdentity` 的写入由该用例既有断言覆盖，不计入 WP 的其他字段/集合同等断言。
- “非 HTTP” = 内部 seam / 静态断言，必须显式标注，不得冒充 HTTP 用例。
- create/query 为该用例内对注入适配器的**精确调用次数**（不是“至少/最多”）。
- 云函数层：领域错误 `e.status` → `index.js` 返回数值 `code = e.status || 503`（`index.js:75-80` 现状，不改）。成功 → 云 `code: 0`。

| # | 用例 | 触发 | 唯一 code/status | 写集 | audit | create | query |
|---|---|---|---|---:|---:|---:|
| S1-1 | 两并发首次请求（同一订单） | 两个 `paymentParams` 同时进入 | 胜者：成功（领域返回参数；云 `code:0`）；败者：**409 `PAYMENT_PARAMS_IN_PROGRESS`** | 胜者 **WP\***（`status:"ready"`、`epoch:1`、新 `attemptId`、`externalRequestSentAt` 非空、`prepay`/`clientParams`）；败者 W0 | 1（仅胜者，action 精确 `租赁预约：核对支付资格`） | 1 | 0 |
| S1-2 | 有效 lease 内第二方（`preparing` 与 `reconciling` 两个 fixture） | lease 未过期 | **409 `PAYMENT_PARAMS_IN_PROGRESS`** | W0 | 0 | 0 | 0 |
| S1-3 | create 成功 + complete CAS 有效 | 正常单请求 | 成功（云 `code:0`） | **WP\***（`ready` + `prepay`/`clientParams` + `queryEvidence:null`） | 1 | 1 | 0 |
| S1-4 | 旧 epoch complete（内部 seam） | fixture `ready`（epoch=2），用 epoch=1 调 complete | 非 HTTP：complete 返回失败/抛错；当前 epoch 与 `attemptId` 不变 | W0 | 0 | 0 | 0 |
| S1-5 | 订单过期 / hold 非本单 / hold 已释放 / 材料变化（4 个 fixture） | 每个 fixture 各一次 | **409**；订单/材料类沿用现有精确消息（`订单不在可支付时间内，请刷新状态`；`身份证材料或审核状态已变化，请重新审核并确认合同`） | W0 | 0 | 0 | 0 |
| S1-6a | claim 事务内本地校验失败 | T1 内校验失败，未写 `preparing` | **409**（同 S1-5 对应消息） | W0；断言订单**无** `paymentRequest` 字段（无残留 `preparing`） | 0 | 0 | 0 |
| S1-6b | T1 后、T2 前本地失败 → T1' 回退 | 注入“本地失败”（需 T1 成功、T2 未执行） | 非 HTTP：T1' 成功；最终与请求前**逐字节一致**（原无 `paymentRequest` 者仍无该字段） | W0（净差为零；`previous` 不落库、`paymentRequest` 键不存在） | 0 | 0 | 0 |
| S1-7 | `externalRequestSentAt` 非空后禁止回退 | T1' seam + 静态断言 | 非 HTTP：T1' 拒绝（CAS 条件不满足/抛错），sent 保持原值 | W0 | 0 | 0 | 0 |
| S1-8 | create 超时 / 5xx / 抛错 | 适配器 `create` 抛错或超时 | **503**（客户端文案固定 `租赁服务暂不可用，请稍后重试`；**不是** `PAYMENT_QUERY_UNAVAILABLE`） | **WP**（`status:"reconciling"`、`externalRequestSentAt` 保留、`attemptId`/`epoch` 不变；audit `deepEqual`） | 0 | 1 | 0 |
| S1-9 | complete CAS 失败（并发接管/lease 失效） | create 返回时 lease 已被接管 | **503 `PAYMENT_QUERY_UNAVAILABLE`** | **WP**（接管者写入 `reconciling` + `epoch+1` + 新 `attemptId`；旧 attempt 的 complete **零写**） | 0 | 1 | 0 |
| S1-10 | `failed` 终态再次请求 | fixture `paymentRequest.status="failed"` | **409** + `订单不在可支付时间内，请刷新状态` | W0；全部事实字段（`externalRequestSentAt`/`attemptId`/`epoch`/`out_trade_no`/`queryEvidence`）原样 | 0 | 0 | 0 |
| S1-11 | 失败/超时后有效 hold 保留 | 同 S1-8 用例内断言 | **503**（同 S1-8） | **WP**（同 S1-8）；`hold.until`/`hold.orderId` 原样、`order.status` 不变 | 0 | 1 | 0 |
| S1-12 | lease 过期接管**已发**请求 | fixture `reconciling`/`preparing` 且 `externalRequestSentAt` 非空、lease 过期 | **503 `PAYMENT_QUERY_UNAVAILABLE`** | **WP**（`reconciling` + `epoch+1` + 新 `attemptId` + sent 保留；不返回参数） | 0 | 0 | 0 |
| S1-13 | lease 过期接管**未发**请求 | fixture `preparing` 且 sent 为空、lease 过期 | 成功（create 1 → `ready`；云 `code:0`） | **WP\***（`preparing`→`ready`、`epoch+1`、新 `attemptId`、sent 非空） | 1 | 1 | 0 |
| S1-14 | complete 时绑定失效（改造既有 in-flight 用例） | create 进行中证件被替换 | **503 `PAYMENT_QUERY_UNAVAILABLE`** | **WP（限定，见 §4 约定）**（`reconciling`、sent 保留、`epoch` 不变；不返回参数；`admin_audit` 不新增 `核对支付资格`） | 0（该请求 0；`uploadIdentity` 自身审计不计入本用例的 audit 列） | 1 | 0 |
| S1-15 | `ready` 命中（最小返回，S1 边界） | fixture `ready`（S1 自己写入）后再次 `paymentParams` | 成功（返回已存 `clientParams`；云 `code:0`） | W0 | 0 | 0 | 0 |
| S1-16 | 读路径/DTO 不泄漏、不写 | `mine()`、`orderDTO`、`validatePayableOrder` | 非 HTTP：正常返回 | W0 | 0 | 0 | 0 |
| S1-17 | 静态不变量 | 代码检索/静态断言 | 非 HTTP | W0 | 0 | 0 | 0 |

### 4.1 逐例补充断言（缺一即未闭合）

- **S1-1**：`paymentRequest` 只有一份；`admin_audit` 只增 1 条且 action 精确（该条属于胜者 WP\* 允许写集）；败者不得写任何字段（不接受“败者写 `preparing` 再被覆盖”）。
- **S1-2**：两个 fixture 都必须 `deepEqual`；`preparing` 与 `reconciling` 的 valid-lease 拒绝必须是同一 code。
- **S1-3**：`prepay.prepayId` 必须等于 `clientParams.package` 中 `prepay_id=` 后的值；`ready` 下订单 `status` 仍为 `awaiting_payment`；`hold` 不变；审计 1 条且并入 WP\*。
- **S1-4**：除“complete 失败”外，必须证明当前 `ready` 的 `prepay`/`clientParams` 未被旧 attempt 覆盖（逐字段 `deepEqual`）。
- **S1-5**：四个 fixture 各自一条；断言不释放 hold（`until`/`status` 原样），且 `hold` 不被写成 `released`。
- **S1-6a**：断言 `Object.hasOwn(order, "paymentRequest") === false`（若基线订单本无该字段），不接受 `status:"none"` 残留。
- **S1-6b**：按 §3.2 T1' 执行——同一事务、`attemptId+epoch` CAS、sent 为空条件、`previous=ABSENT` 时删除字段；断言事务 refs 与 writes；不得出现“先写 `preparing` 再跨事务删除”的窗口；断言回退后 `previous` 不残留。
- **S1-7**：静态证明不存在 `delete`/清空/置 `null` `externalRequestSentAt` 的分支；行为上 sent 非空时调用 T1' 必须零写失败，sent 保持不变。
- **S1-8**：适配器原始错误文本不得出现在客户端文案中（断言 `!/synthetic|adapter/i.test(msg)`）；`order.status` 仍为 `awaiting_payment`；`admin_audit` `deepEqual`（WP，audit 0）。
- **S1-9**：胜者 `epoch` 必须比败者 `epoch` 大 1；败者不得写入 `paymentRequest` 的任何字段。
- **S1-10**：`deepEqual`，且 `hold` 不变；不得因 `failed` 调 `closeUnpaid`。
- **S1-12**：`create` 必须为 0（接管已发请求）；`lastQueryAt` 不由 S1 写（S4 才写）。
- **S1-13**：只有 sent 为空才允许 create；必须证明 `create` 只发生 1 次。
- **S1-14**：该用例的 `paymentParams` 从 409 改为 503（见 §8）；`admin_audit` 中不得出现 `核对支付资格`。
- **S1-15**：返回对象与写入时逐字段一致；W0；不新增 audit、不重签、不 create；**只覆盖 S1 自己写入的 `ready`**，TTL/过期语义不在此列（S2 边界见 §3.1）。
- **S1-16**：DTO 键集合与基线完全相同（不含 `paymentRequest`/`prepay`/`clientParams`）；读路径 `deepEqual`。
- **S1-17**：静态证明无 `setTimeout`/`setInterval`/重试循环/第二次 `out_trade_no` 生成/进程内 `Map` 锁/新增固定错误码/新增 dispatch action/`paymentRequest` 字段删除分支（除 T1' 的 `previous=ABSENT` 还原）；`index.js` 零 diff。

### 4.2 audit 与适配器计数的全局口径

- 成功审计只出现在 `ready`：S1-1 胜者、S1-3、S1-13，各恰好 1 条，且该条**属于 WP\* 的允许写集**，不得在写集之外另行计 audit。
- 其余用例 audit 一律 0，`admin_audit` 必须 `deepEqual`（WP 或 W0）。
- 每个用例的 create/query 计数必须写成“预期/实测”；实测多于预期即 FAIL（禁止重试循环、失败后回退 create、查询不成功转 create）。
- 审计内容断言使用 action 精确匹配；`_id`/`createdAt` 为随机/时间值，比较新增条目字段与既有条目的多重集，而非整条随机字段。
- 写集/audit 一致性由 §4 表逐行核验：WP\* 行 audit=1；WP/W0 行 audit=0；任一行两项不符即该行 FAIL。

## 5. 写集与“其余全库相等”的执行口径

- `W0`：直接整体 `deepEqual`（含 `admin_audit`）。
- `WP`：先 `before = structuredClone(store.data)`；执行；`after = structuredClone(store.data)`；断言
  1. `after.rental_preleases` 中仅目标订单变化；
  2. 目标订单除 `paymentRequest` 与 `updatedAt` 外逐字段相等；
  3. `admin_audit` 整体 `deepEqual`；
  4. 其余集合（`houses`/`rooms`/`property_catalog`/`users`/`rental_settings`/`rental_appointments`/`rental_room_holds`/`rental_identity_documents`）整体 `deepEqual`。
- `WP\*`：在 `WP` 的 1/2/4 基础上，`admin_audit` 允许“**追加恰好 1 条**”：断言长度为 `before+1`、新增条目 action/actor/target 正确、`before` 中既有条目逐条仍在（多重集相等）；不得修改或删除既有条目。
- 回退（T1'）断言：`after` 与 `before` 逐字节相等；若 `before` 的订单无 `paymentRequest` 键，`after` 亦必须无该键（不得写成 `{status:"none"}`），且不得残留 `previous`。
- 云 Store 对每次写入附加 `updatedAt`（`store.js:79`），LocalStore 同（`admin-web/lib/store.mjs:178`）；因此 `updatedAt` 是 `WP`/`WP\*` 唯一允许的额外字段，其余字段一律逐字段断言。
- `paymentRequest` 是**内部待对账状态**，不是支付事实：不得把 `WP`/`WP\*` 声称成“全库零写”，也不得写 `rental_payment_transactions`（S3 才有该集合）。
- `admin_audit` 的写入由 Store 在事务内完成；S1 的 T1/T2/T1' 必须传 `writeAudit:false`，T3 成功才写入那唯一一条（两份 Store 当前均支持，无需改 Store）。

## 6. 旧数据兼容边界（S1 只做读取侧，不做迁移）

1. **字段缺省语义**：`paymentRequest` 缺失 ≡ `{ status: "none" }`；只在内存中派生，不写回。基线订单全部无该字段（`domain.js` 全文无 `paymentRequest`）。
2. **epoch 起点**：缺失/`none` 视为 `epoch = 0`；首次 claim 写 `epoch = 1`；此后每次接管 `+1`。旧数据无 `epoch` 不视为异常，不补写。
3. **不迁移/不回填/不扫描**：S1 不得 `list(orders)` 全表遍历或批量写 `paymentRequest`；claim 只针对单个订单事务。S6 的迁移展示/回填仍冻结。
4. **不新增集合/索引/权限/部署面**：S1 不新建集合、不改两份 Store 的 allowed/collections（默认零改动）、不改部署清单；`docs/RENTAL-PRESIGNING.md` 不在 S1 允许文件内。
5. **旧状态不变**：订单 `status` 为 `payment_closed`/`identity_changed`/`paid_held`/`refund_required` 等非 `awaiting_payment` 时，S1 不写 `paymentRequest`，维持现有 409/返回行为（S1-5、S1-10）。
6. **旧客户端不变**：`paymentParams(id)` 入参、dispatch action 集合、`orderDTO` 键集合均不变；S1 不新增必填字段、不改 `index.js` 协议。
7. **`failed` 只读**：基线不存在 `failed`（S1 前无该状态）；S1 只在 fixture 中读取并拒绝，**不产生 `failed`**；进入 `failed` 属 S4。
8. **`ready` 不属旧数据**：`ready` 只能由 S1 自己写入；S1 不承诺兼容“旧 `ready` 缺 prepay/clientParams”的组合（该组合只可能由 S2 缓存损坏路径产生，S2 处理）。
9. **不复活**：S1 不得把 `failed`/其他终态订单接管为 `preparing`/create（S1-10、S1-17）；`externalRequestSentAt` 非空的记录永久保留。
10. **`previous` 只服务 T1'**：`previous` 由 T1 写入，供同一尝试的 T1' 回退使用；T3 成功/失败与后续接管收敛后的最终 `paymentRequest` 不得保留上一尝试的 `previous` 旧值；回退后订单文档必须逐字节还原（§5）。

## 7. 加载前 guard 与显式非监听清单

S1 的测试基础设施改造本身就是交付物；只写功能、不装 guard 视为未完成（G13 FAIL）。

### 7.1 安装时序（硬要求）

- 测试文件顶层只允许：Node 内建模块静态导入与 guard 自身（`tests/rental-network-guard.cjs`）；**被测模块必须在 guard 安装后动态 `import()`/`require()`**，并在 `assertNoLoadTimeViolation()` 通过后才运行用例。
- 被测模块：`cloudfunctions/leasing/domain.js`、`index.js`、`store.js`、`wechat-pay.js`、`admin-web/lib/store.mjs`。
- 现状违背点（S1 必须改）：`admin-web/tests/leasing.test.mjs:13-14` 顶层静态 `import domain`/`import payModule`；`tests/leasing.test.cjs:7-10` 顶层 `readFileSync(index.js)`。
- guard 自身不得监听端口、不得真实连网；guard 自检也不得例外。

### 7.2 必须逐入口负控的入口

```text
net.createServer
net.Server.prototype.listen
http.Server.prototype.listen
https.Server.prototype.listen
net.connect
net.createConnection
net.Socket.prototype.connect
tls.connect
http.request
http.get
https.request
https.get
globalThis.fetch
dns.lookup
dns.resolve*              # 逐一展开
dns.promises              # 逐一展开解析入口
dgram.createSocket
dgram.Socket.prototype.send
dgram.Socket.prototype.bind
dgram.Socket.prototype.connect
```

每个入口的负控必须证明：调用被拦截、违规计数 +1、返回安全 sentinel、**不转发真实原始函数**、不产生真实 socket/请求。只断言“抛错”不算通过。加载期违规永久保留，运行期重置不得清除；加载期有任何违规即失败。

### 7.3 必要依赖正控

- `node:crypto`：RSA-SHA256 签名/验签、AES-256-GCM 加解密；
- `node:fs/promises`：临时目录读写与清理；
- `node:buffer`/`node:url`/`node:path`/`node:os`；
- 注入的支付适配器 mock（非网络）create/query。

正控必须产生真实结果（验签 true、解密原文一致、临时文件可读写、mock 返回预期值），不得只断言“未抛错”。任一正控失败 = guard 过度拦截 = BLOCKED。

### 7.4 ESM 命名绑定与子进程继承

- guard 安装后必须 `syncBuiltinESMExports()`，并用负控证明 `import { request } from "node:http"` 等 ESM 命名绑定同样被拦截；只拦 CJS 属性不算通过。
- 必须完成至少一次**真实子进程**继承负控（`NODE_OPTIONS=--import/--require <guard>`），子进程内 `net.connect`/`fetch` 被拦截并回传违规；不得静态替代。
- 环境不支持子进程时按 §7.5 处理（BLOCKED），不得跳过或伪造。

### 7.5 环境失败口径

guard 安装失败、入口缺失/非函数、加载期违规、负控未触发、泄漏真实网络、正控失败、子进程继承失败：一律 **BLOCKED**，终止本次运行；不得降级为“无 guard 运行”、不得重试绕过、不得改写环境规避。入口在特定 Node 版本不存在时，默认 BLOCKED；只有 Codex 书面批准“该版本无此入口”才可登记为显式豁免并给出替代覆盖。

证据必须记录：`process.version`、平台、guard 入口数、负控通过数、正控通过数、子进程负控结果。

### 7.6 显式非监听文件清单（加载期与运行期 `listen` 调用 0）

```text
cloudfunctions/leasing/domain.js
cloudfunctions/leasing/index.js
cloudfunctions/leasing/store.js
cloudfunctions/leasing/wechat-pay.js
admin-web/lib/store.mjs
admin-web/tests/leasing.test.mjs
tests/leasing.test.cjs
tests/rental-network-guard.cjs
```

明确排除、不得运行：`admin-web/tests/server.test.mjs`（HTTP 套件）、任何 `npm test`/glob/`tests/*.test.mjs` 全量；不得启动本地服务器替代测试或作为验收证据。

## 8. 既有用例改造清单（S1 必改，不新增文件）

| 位置（blob `71062d30…`） | 现状 | S1 后 |
|---|---|---|
| `admin-web/tests/leasing.test.mjs:13-14` | 顶层静态 import `domain`/`wechat-pay` | guard 先装 + 动态 import |
| `admin-web/tests/leasing.test.mjs:621-653`（create 进行中证件被替换） | 期望 **409** | 期望 **503 `PAYMENT_QUERY_UNAVAILABLE`**；断言 `paymentRequest.status="reconciling"`、`externalRequestSentAt` 保留、`epoch` 不变、无 `核对支付资格` 审计（写集 WP，audit 0） |
| `admin-web/tests/leasing.test.mjs:743-760`（适配器故障） | 期望整体 `deepEqual`（零写） | 改为 **WP（audit 0）**（`paymentRequest="reconciling"` + sent 保留；`admin_audit` 仍 `deepEqual`）+ hold/订单状态不变 + 原始错误不泄漏 |
| `admin-web/tests/leasing.test.mjs:762-781`（成功路径） | 断言 create 1、audit 1、`package` | 保持上述断言，另加 `ready`、`prepay.prepayId`、`clientParams` 与 `paymentRequest` 逐字段断言；audit 1 归入 **WP\*** |
| `admin-web/tests/leasing.test.mjs:529-580`、`:582-619`（预校验失败） | 期望 409 + `deepEqual` | **不变**（失败发生在 sent 之前；S1-5/6a 复用其口径） |
| `tests/leasing.test.cjs:1-35` | 顶层 `readFileSync(index.js)` 后 `vm.runInNewContext` | guard 先装 + 动态载入；现有 3 个 `test(` 的断言不变 |

新增用例（S1 表 §4 中 S1-1…S1-17 除上述改造外的部分）写在 `admin-web/tests/leasing.test.mjs`；`tests/rental-network-guard.cjs` 只放 guard 与自检，不放业务断言。

## 9. 验收与证据

### 9.1 运行命令（只允许这两条）

```powershell
# 工作目录：仓库根（分支 tip = S1 实施提交）
node --test admin-web/tests/leasing.test.mjs
node --test tests/leasing.test.cjs
```

禁止：`npm test`、`node --test` glob、`server.test.mjs`、任何 HTTP/UI 启动、任何真实支付/云/设备命令。

### 9.2 每段 PASS 必须列出的数字

- 执行数、通过数、失败数、跳过数（**必须为 0**）；
- `DEFERRED` 清单：S1 只允许“真实 query 结果（`NOTPAY`/`CLOSED`/`REVOKED`/`PAYERROR`/`ORDER_NOT_EXIST`/`SUCCESS`/超时未知）留 S4”一项；**已实现的 503 拒绝不得标 DEFERRED**；
- guard 自检：入口数、负控 N/N、正控 M/M、ESM 命名绑定、子进程 1/1、非监听清单、环境失败口径；
- 每个用例的 create/query 预期/实测、audit 次数、写集（W0/WP/WP\*）结果；
- **写集与 audit 一致性**：逐行核对 §4 表，WP\* 行 audit=1 且该条计入允许写集；WP/W0 行 audit=0；不得出现“WP + 另计 audit 1”的双重口径。

### 9.3 交付报告必须包含

1. 完整 SHA、父 SHA、分支、`ls-remote` 实测远端 tip；
2. `git diff --stat`、`git diff --name-only`（逐项对照 §2 白名单）；
3. 逐文件命令、工作目录、exit code、执行/通过/失败/跳过计数；
4. 每个用例的唯一 code/status、写集、audit、适配器计数；
5. 契约锚点逐项对照（§4.1/§4.2/§4.4/§4.5/§7.1，以契约 blob `94d61ed…` 为准）；
6. 未验证/不可验证项与待裁项；
7. 声明“未合并、未部署、未开 HTTP/UI、未接真实支付/设备/业务云、未安装依赖”。

### 9.4 验收门（S1 子集）

| 门 | 要求 |
|---|---|
| G1 | I1–I8 相关不变量成立：确认失败禁止重发、`externalRequestSentAt` 保留、有效 hold 保留 |
| G2 | create/query 计数与 §4 表逐项一致；无隐藏 create/重试循环 |
| G3 | W0/WP/WP\* 逐项成立；`admin_audit` 与写集一致（WP\* 才允许 +1） |
| G4 | 仅改 §2 白名单；契约卡/任务卡/`index.js`/`wechat-pay.js`/UI 零 diff |
| G5 | 只运行 §9.1 两条命令；无 glob/`npm test`/HTTP |
| G6 | 追加提交、普通 push、`ls-remote` 核对；无 amend/rebase/reset/squash/force/merge；无全局 Git 配置 |
| G7 | 不部署、不接真实支付、不开 HTTP/UI、不连设备/业务云、不安装依赖 |
| G8 | 证据含完整 SHA/父/文件范围/命令/exit/计数/适配器计数/零写断言/远端状态/未验证 |
| G10 | 逐用例只断言一个 code/status；无 409/503 二选一；无新增固定码 |
| G13 | guard 闭合：加载前安装、加载期违规 0、逐入口负控全过、必要依赖正控全过、ESM 命名绑定被拦截、子进程 1/1、非监听清单全过、环境失败口径已记录 |
| G14 | 无占位 PASS；`DEFERRED` 不计入通过；无 skip/todo/only |
| G15 | 每个运行场景有唯一 code/status、W0/WP/WP\*、audit、create/query；不出现“—/0/1/409/503/待定”含糊值 |

## 10. 停止点

1. S1 实施提交并**普通 push**到 `feat/rental-s1-persistent-single-flight`（或等义新分支）后**立即停手**，交 Codex 独立复审；不得进入 S2。
2. 不合并、不部署、不开 HTTP/UI、不接真实支付/设备/业务云；不运行 §9.1 以外的命令。
3. 复审未 PASS 前不开始 S2；S2–S6 全部冻结（§1.2）。
4. 任何与契约/任务卡冲突的发现：先停手报 Codex，不得自行改写契约或本清单。

## 11. 九项技术口径证据状态与材料不足（不臆造裁定）

### 11.1 九项口径逐项对照

判定标准：只有能从**现有契约卡 §4/§5/§6/§7/§9 与任务卡 v5 §13（T1–T13）**直接推出的，才写“已证”；其余标“待核对”，不写成已裁定，也不把环境可用当作业务验收。

| # | 口径 | 现有契约可证明的结论（锚点） | 仅缺失材料/复审可定的部分 | 状态 |
|---|---|---|---|---|
| 1 | complete 失败/绑定失效的返回码 | 契约 §4.4：create 成功但 complete CAS/lease/epoch/绑定失败 → `reconciling`，禁止回滚、不返回参数、不写 audit；§4.3.1-1：未确认外部结果且 query 不可用 → 固定 503；卡 §3.4 同 | 是否把“绑定失效”一律归入 complete 失败并按 503 断言（会改动既有用例 621–653 的 409） | **已证方向，断言变更待复审** |
| 2 | 适配器故障的客户端文案 | 卡 §3.11：create 超时/5xx → 503（现有支付适配器失败，非 `PAYMENT_QUERY_UNAVAILABLE`）；§4.3.1-1 要求不重发、不写 audit | 503 的具体字面量；本清单建议复用 `index.js:78` 兜底文案，属实现选择 | **部分待核对** |
| 3 | S1 是否写 prepay TTL 字段 | 契约 §4.1 定义 `prepayExpiresAt`/`signatureExpiresAt`；卡 S2-1 规定 TTL“在 S2 入口记录”；§9.7 未定 | TTL 数值；S1 中字段表示（缺省 vs `null`）；两者均不得由 S1 自定 | **部分待核对** |
| 4 | 回退后的精确状态与事务 | 契约 §4.5：只有确认 create 从未发出才允许“清除/恢复 `paymentRequest` 到 `none`”；§4.1 `previous` 仅用于该回退；§4.2-7 旧 attempt/epoch 写入必须失败（含回退） | “原无字段 → 删除字段”的具体表示；`previous` 的快照形态（ABSENT 哨兵） | **已证方向，表示待核对** |
| 5 | 云函数层运行期 409/503 断言 | 卡 §3.10 要求云层数值 code；`index.js:75-80` 映射为 `code = e.status || 503`，而 `index.js` 禁改 | 在冻结 `index.js` 下能否注入支付适配器取得运行期云层证据；本清单只能给静态映射 + 领域 status | **不可证（环境/授权限制）** |
| 6 | 内部 seam 的合法性 | 卡 §4.1 允许改 `domain.js`；契约不要求新增 action；`index.js` 禁改 | 新增非 dispatch 内部方法是否需单独批准（本清单按“允许”记录） | **待核对** |
| 7 | `ready` 下 `leaseUntil` 保留或清空 | 契约 §4.1 把 `leaseUntil` 描述为 `preparing`/`reconciling` 的租约，`ready` 未规定 | `ready` 时保留旧 lease 还是清空 | **待核对（低风险）** |
| 8 | guard 子进程继承 | 卡 §3.7 要求真实子进程负控；§3.8 规定环境不支持即 BLOCKED（T10/T11） | 无（结论已由卡固定） | **已证** |
| 9 | 旧数据缺省/epoch 起点 | 契约 §4.1/§4.2 规定 `epoch` 每次接管单调 +1、`none` 为初始状态；I2 要求旧事实永久保留 | “缺失字段 ≡ none、缺失 epoch ≡ 0”的显式写法；与 S6 迁移展示的边界 | **部分待核对（低风险）** |

结论：九项中 **#8 已证**；**#1、#4 方向可证但断言/表示待复审**；**#2、#3、#6、#7、#9 部分待核对**；**#5 在冻结 `index.js` 下不可运行期证明**。以上“待核对”仅表示**缺失材料或复审未决**，不得写成已批准；S1 实施时若需依赖其中任一项，必须先取得 Codex 书面口径，否则停手。

### 11.2 材料不足（正文未取得）

本轮指定材料：`/workspace/artifacts/RENTAL-S1-AUTH-REVIEW-2026-11-19` 下的 `PARALLEL-DISPATCH.md`、`REVIEW.md`。本机**未取得可读正文**，已核对以下位置（均为实测）：

| 检查位置 | 结果 |
|---|---|
| `/workspace/artifacts/RENTAL-S1-AUTH-REVIEW-2026-11-19` | 不存在（`/workspace` 本身不存在） |
| `C:\workspace\…`、`D:\workspace\…`、`E:\workspace\…`、`F:\workspace\…` 同路径 | 均不存在 |
| `C:\artifacts\…`、`D:\artifacts\…`；`E:\artifacts`、`F:\artifacts`、`G:\artifacts` | 均不存在 |
| `C:\`、`D:\` 根目录 `*RENTAL-S1-AUTH-REVIEW*` 目录检索 | 无匹配 |
| `%TEMP%`、`C:\Users\Administrator\.dsh`、`AppData\Roaming`、`C:\ProgramData` 过滤 `*RENTAL*` | 仅 `%TEMP%\rental-95e4389.md`（内容为旧契约卡“第三版”副本，非本轮材料） |
| 项目目录递归 `PARALLEL-DISPATCH.md` | 无 |
| 仓库全部 refs 路径检索 `RENTAL-S1-AUTH-REVIEW|PARALLEL-DISPATCH` | 无 |

因此：**不声称已读、不声称逐项闭合、不声称获得批准**；§11.1 的“待核对”项在正文取得前不得作为 PASS 依据。本轮可完成且已完成的修订，仅限于能由现有契约直接证明的部分（成功审计并入写集、回退事务与 sent 不可擦除、缓存 S1/S2 边界、逐例一致性）。

## 12. 与输入、父提交、实施起点的最终声明

- 本清单 v2 以 `45957578aca352bc06ec541dd7fbb4433371ac94` 为**父**追加提交；提交后完整 SHA 与父 SHA 以交付报告与 `ls-remote` 实测为准。父链：`v2` → `4595757` → `8a2f8d9` → `4a30e6e`。
- **S1 实际实施起点是本清单提交（X），不是 `4595757`，更不是 `8a2f8d9`**；实施分支必须从 X 新建，保证 v2 在实施历史中。
- 本清单只修改一个文件；未运行测试、未安装依赖、未改代码/测试/Store/契约/任务卡、未开 HTTP/UI、未接真实支付/云/设备、未合并/未部署。
- **本清单 PASS 不等于 S1 实施授权**；S1 需单独书面批准（范围 + 批准时 tip SHA），S2–S6 仍冻结，T1–T13 不重推。

## 13. v2 修订记录（问题 → 位置 → 验收要求）

| # | 问题（v1 复审） | 修订位置 | 验收要求 |
|---|---|---|---|
| 1 | 成功审计与 WP 写集自相矛盾：WP 声明“含 `admin_audit` 深度相等”，但 ready 用例 audit=1 | §4 约定（新增 WP\*）、§4 表 S1-1/S1-3/S1-13、§4.1、§4.2、§5、§9.2、G3/G15 | WP\* 明确定义为“WP + 追加恰好 1 条成功审计”；WP/W0 一律 audit 0 且 `admin_audit` deepEqual；逐行一致 |
| 2 | 回退事务未定义；“之前无字段”如何还原、CAS 与 sent 擦除边界不清 | §3.2（T1/T2/T3/T1'）、§4.1 S1-6b/S1-7/S1-17、§5 回退断言、§6 第 10 项 | T1' 唯一窗口（sent 为空）、`previous=ABSENT` 时删除字段、`attemptId+epoch` CAS、CAS 失败零写、sent 非空不可删除/清空/置 null |
| 3 | 缓存返回未区分 S1/S2 边界 | §3.1（场景表 + S2 必改断言清单）、§4.1 S1-15 | S1 只返回自己写入的 `clientParams`、不判 TTL；prepay 过期/损坏缓存明确留给 S2，S2 须列受影响断言 diff |
| 4 | 九项技术口径未逐项对照，且缺正文时易被误当已裁定 | §11.1（九项证据状态表）、§11.2（材料不足与检查位置）、§0 材料行 | 每项标“已证/部分待核对/不可证”；缺正文不猜闭合，不当作批准；可由契约证明的修订已完成 |
| 5 | 父链/实施起点需随输入更新 | 头部、§0、§0.1、§12 | v2 父=`4595757`；X=v2 提交；实施起点=X |
