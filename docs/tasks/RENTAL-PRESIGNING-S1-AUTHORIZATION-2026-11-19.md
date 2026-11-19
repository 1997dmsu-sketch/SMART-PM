# 预签约 S1 独立授权清单（持久单飞 / CAS · 待 Codex 复审）

- 日期：2026-11-19（Asia/Shanghai）
- 执行者：DSH 根代理 `lead`（`deepseek-flash`）；Windows PowerShell 5.1.19041.1 / Git `2.55.0.windows.3` / Node `v24.19.0`
- 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\rental-s1-authorization`
- 分支：`docs/rental-s1-authorization`
- 固定输入：`8a2f8d9172544decd5def108ca689988ec92bf8f`（本地 HEAD = 输入；远端同名 staged-task 分支 tip 实测同为该 SHA）
- 本清单父提交：`8a2f8d9172544decd5def108ca689988ec92bf8f`（本清单为追加提交，**父即固定输入**）
- 本清单唯一新增文件：`docs/tasks/RENTAL-PRESIGNING-S1-AUTHORIZATION-2026-11-19.md`
- 已批准契约：`docs/RENTAL-OPEN-ITEMS-CONTRACT-CARD.md`（第五版；427 行；blob `94d61ed1c3d44bdb02249aa96e10d57422d5225d`，本清单提交时未变）
- 上级任务卡：`docs/tasks/RENTAL-PRESIGNING-STAGED-IMPLEMENTATION-TASK-2026-11-18.md`（v5；653 行；本清单只引用，不改写）
- 代码基线：`3bf595140088bc71a3939fb67880807965e9c566`；自该基线至输入 `8a2f8d9` 运行时代码/测试/Store **零 diff**，变更仅两份 docs（契约卡 v5、任务卡 v5）
- 状态：**仅新增本清单；不实施、不运行测试、不安装依赖、不改代码/测试/Store/契约/任务卡；待 Codex 独立复审（不自批）**

> **本清单不构成实施授权。** 清单通过（PASS）只表示 S1 的“文件白名单 + 逐例预期 + 失败关闭口径”可被 Codex 复审；S1 开工仍须另有一份**单独书面批准**，写明批准范围与该时刻 tip SHA。批准前不得改任何代码/测试。

## 0. 输入、远端与基线核对（本轮实测）

| 项 | 实测值 | 核验方式 |
|---|---|---|
| 本清单父 / 固定输入 | `8a2f8d9172544decd5def108ca689988ec92bf8f` | `git rev-parse HEAD`、`git rev-parse HEAD^` |
| 输入父提交 | `4a30e6e7ba1b844897c8d70de1e0c9a13ba3282f` | `git log -1 --format=%P 8a2f8d9` |
| 远端 `refs/heads/docs/rental-staged-implementation-task` | `8a2f8d9172544decd5def108ca689988ec92bf8f` | `git ls-remote`（fetch 后复核） |
| 远端 `refs/heads/docs/rental-s1-authorization` | **不存在**（本任务创建新分支） | `git ls-remote`（两次，输出为空） |
| 分叉/前移 | 无：远端 tip = 固定输入 = 本地 HEAD | `ls-remote` + `rev-parse` |
| 工作树 | 干净（`git status --porcelain=v1` 空） | 提交前实测 |
| 待办分支本地引用 | `docs/rental-s1-authorization` 已在工作树检出，位于 `8a2f8d9`，无独立提交 | `git log --oneline -3` |
| 运行时代码零 diff | `3bf5951..8a2f8d9` 仅 `docs/RENTAL-OPEN-ITEMS-CONTRACT-CARD.md`、`docs/tasks/RENTAL-PRESIGNING-STAGED-IMPLEMENTATION-TASK-2026-11-18.md` | `git diff --name-only` |
| 契约 blob / 行数 | `94d61ed1…` / 427 | `git rev-parse HEAD:docs/…` + 行数 |
| `domain.js` | blob `5027c5a4e8b38e484e361b1ac3e72cf90985f662`，1085 行，**无 `paymentRequest` 字段** | `git rev-parse HEAD:…`、全文检索 |
| `store.js` / `admin-web/lib/store.mjs` | blob `6b38e8ee…` / `53ffc9df…`；allowed 集合**不含**新集合 | 同上 |
| 两份租赁测试 | `tests/leasing.test.cjs` 175 行 / 3 个 `test(`；`admin-web/tests/leasing.test.mjs` 781 行 / 22 个 `test(` | 行数 + `test(` 计数 |
| `tests/rental-network-guard.cjs` | **不存在**（S1 新增） | 文件系统 |
| fetch 环境告警（记录，不掩盖） | `git fetch --no-write-fetch-head origin --prune` 退出码 0，但 stderr 报 `refs/remotes/origin/HEAD.lock: Permission denied`（共享 `.git` 目录锁/ACL 问题） | stderr 原文 |

fetch 告警的处置：远端事实一律以 `git ls-remote`（网络权威）为准，未依赖可能未更新的 remote-tracking ref；未改动任何 Git 配置、未使用 TLS 绕过。该告警不影响本清单只读核对与后续普通 push 的 `ls-remote` 复核。

### 0.1 文档父与“实际实施起点”必须分清

| 概念 | SHA / 位置 | 说明 |
|---|---|---|
| 本清单父提交 | `8a2f8d9172544decd5def108ca689988ec92bf8f` | 固定输入；本清单在其上追加 |
| 本清单提交（记为 **X**） | 提交后由交付报告给出完整 SHA | 唯一新增文件；X 的父是 `8a2f8d9` |
| S1 **实际实施起点** | **X**（不是 `8a2f8d9`） | S1 实施分支必须从 X 新建；不得让 X 落在实施分支之外 |
| S1 实施分支（建议名） | `feat/rental-s1-persistent-single-flight` | 从 X 新建，普通 push，追加提交 |
| 清单 PASS 的含义 | 仅“清单可复审” | 不等于 S1 批准；S1 仍需单独书面批准（范围 + 批准时 tip SHA） |

若 S1 实施会话拿到的入口 tip 不等于 X（或 X 之后仅有本清单文字修订的提交），必须停手报 Codex，不得以 `8a2f8d9` 或其它 SHA 代替。

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

### 3.1 S1/S2 边界（防越界，须在 S1 证据中声明）

- S1 的 `ready` 只写 `prepay = { prepayId, createdAt }` 与 `clientParams`（适配器返回参数原样）；`prepayExpiresAt`、`signatureExpiresAt`、`signedAt` 等 TTL 字段**由 S2 置入**，S1 不写、不判定。
- S1 的 `ready` 命中（重复 `paymentParams`）：不 create、不写库、返回已存 `clientParams`，**不做 TTL/签名判断**；S2 才实现 TTL、本地重签、prepay 过期/损坏缓存 503。
- S1 不实现 `refreshPayment` 的 query 对账；`refreshPayment` 当前行为（`domain.js:863-879`）在 S1 不被改写（不改即零 diff）。
- S1 不删除 `prepay`/`clientParams` 缓存（缓存清理由 S4 的 `failed` 进入路径负责）。

## 4. 逐例唯一预期矩阵

写法约定：

- 写集 **W0** = 全库零写（`before=structuredClone(store.data)`、`after=structuredClone(store.data)`、`assert.deepEqual`，含 `admin_audit` 长度与内容）。
- 写集 **WP** = 仅允许 `rental_preleases/<orderId>` 的 `paymentRequest` 整字段被替换（外加 Store 自动写入的 `updatedAt`）；**其余所有集合/文档/字段 deepEqual（含 `admin_audit`）**。证据必须逐字段写明 `paymentRequest` 内的目标值。
- “非 HTTP” = 内部 seam / 静态断言，必须显式标注，不得冒充 HTTP 用例。
- create/query 为该用例内对注入适配器的**精确调用次数**（不是“至少/最多”）。
- 云函数层：领域错误 `e.status` → `index.js` 返回数值 `code = e.status || 503`（`index.js:75-80` 现状，不改）。成功 → 云 `code: 0`。

| # | 用例 | 触发 | 唯一 code/status | 写集 | audit | create | query |
|---|---|---|---|---:|---:|---:|
| S1-1 | 两并发首次请求（同一订单） | 两个 `paymentParams` 同时进入 | 胜者：成功（领域返回参数；云 `code:0`）；败者：**409 `PAYMENT_PARAMS_IN_PROGRESS`** | 胜者 WP（`status:"ready"`、`epoch:1`、新 `attemptId`、`externalRequestSentAt` 非空、`prepay`/`clientParams`）；败者 W0 | 1（仅胜者，action 精确 `租赁预约：核对支付资格`） | 1 | 0 |
| S1-2 | 有效 lease 内第二方（`preparing` 与 `reconciling` 两个 fixture） | lease 未过期 | **409 `PAYMENT_PARAMS_IN_PROGRESS`** | W0 | 0 | 0 | 0 |
| S1-3 | create 成功 + complete CAS 有效 | 正常单请求 | 成功（云 `code:0`） | WP（`ready` + `prepay`/`clientParams` + `queryEvidence:null`） | 1 | 1 | 0 |
| S1-4 | 旧 epoch complete（内部 seam） | fixture `ready`（epoch=2），用 epoch=1 调 complete | 非 HTTP：complete 返回失败/抛错；当前 epoch 与 `attemptId` 不变 | W0 | 0 | 0 | 0 |
| S1-5 | 订单过期 / hold 非本单 / hold 已释放 / 材料变化（4 个 fixture） | 每个 fixture 各一次 | **409**；订单/材料类沿用现有精确消息（`订单不在可支付时间内，请刷新状态`；`身份证材料或审核状态已变化，请重新审核并确认合同`） | W0 | 0 | 0 | 0 |
| S1-6a | claim 事务内本地校验失败 | 校验在 claim 事务内完成、未写 `preparing` | **409**（同 S1-5 对应消息） | W0；断言订单**无** `paymentRequest` 字段（无残留 `preparing`） | 0 | 0 | 0 |
| S1-6b | claim 写 `preparing` 后、写 sent 前本地失败（内部 stub） | 注入“本地失败”后回退 | 非 HTTP：回退成功；最终状态与请求前**逐字节一致**（原无 `paymentRequest` 者仍无该字段） | W0（净差为零；`previous` 不落库） | 0 | 0 | 0 |
| S1-7 | `externalRequestSentAt` 非空后禁止回退 | 内部回退 seam + 静态断言 | 非 HTTP：回退 helper 拒绝（抛错/返回 false） | W0 | 0 | 0 | 0 |
| S1-8 | create 超时 / 5xx / 抛错 | 适配器 `create` 抛错或超时 | **503**（客户端文案固定 `租赁服务暂不可用，请稍后重试`；**不是** `PAYMENT_QUERY_UNAVAILABLE`） | WP（`status:"reconciling"`、`externalRequestSentAt` 保留、`attemptId`/`epoch` 不变） | 0 | 1 | 0 |
| S1-9 | complete CAS 失败（并发接管/lease 失效） | create 返回时 lease 已被接管 | **503 `PAYMENT_QUERY_UNAVAILABLE`** | WP（接管者写入 `reconciling` + `epoch+1` + 新 `attemptId`；旧 attempt 的 complete **零写**） | 0 | 1 | 0 |
| S1-10 | `failed` 终态再次请求 | fixture `paymentRequest.status="failed"` | **409** + `订单不在可支付时间内，请刷新状态` | W0；全部事实字段（`externalRequestSentAt`/`attemptId`/`epoch`/`out_trade_no`/`queryEvidence`）原样 | 0 | 0 | 0 |
| S1-11 | 失败/超时后有效 hold 保留 | 同 S1-8 用例内断言 | **503**（同 S1-8） | WP（同 S1-8）；`hold.until`/`hold.orderId` 原样、`order.status` 不变 | 0 | 1 | 0 |
| S1-12 | lease 过期接管**已发**请求 | fixture `reconciling`/`preparing` 且 `externalRequestSentAt` 非空、lease 过期 | **503 `PAYMENT_QUERY_UNAVAILABLE`** | WP（`reconciling` + `epoch+1` + 新 `attemptId` + sent 保留；不返回参数） | 0 | 0 | 0 |
| S1-13 | lease 过期接管**未发**请求 | fixture `preparing` 且 sent 为空、lease 过期 | 成功（create 1 → `ready`；云 `code:0`） | WP（`preparing`→`ready`、`epoch+1`、新 `attemptId`、sent 非空） | 1 | 1 | 0 |
| S1-14 | complete 时绑定失效（改造既有 in-flight 用例） | create 进行中证件被替换 | **503 `PAYMENT_QUERY_UNAVAILABLE`** | WP（`reconciling`、sent 保留、`epoch` 不变）；不返回参数 | 0（该请求 0；`uploadIdentity` 自身审计不计入） | 1 | 0 |
| S1-15 | `ready` 命中（最小返回） | fixture `ready`（S1 自己写入）后再次 `paymentParams` | 成功（返回已存 `clientParams`；云 `code:0`） | W0 | 0 | 0 | 0 |
| S1-16 | 读路径/DTO 不泄漏、不写 | `mine()`、`orderDTO`、`validatePayableOrder` | 非 HTTP：正常返回 | W0 | 0 | 0 | 0 |
| S1-17 | 静态不变量 | 代码检索/静态断言 | 非 HTTP | W0 | 0 | 0 | 0 |

### 4.1 逐例补充断言（缺一即未闭合）

- **S1-1**：`paymentRequest` 只有一份；`admin_audit` 只增 1 条且 action 精确；败者不得写任何字段（不接受“败者写 `preparing` 再被覆盖”）。
- **S1-2**：两个 fixture 都必须 `deepEqual`；`preparing` 与 `reconciling` 的 valid-lease 拒绝必须是同一 code。
- **S1-3**：`prepay.prepayId` 必须等于 `clientParams.package` 中 `prepay_id=` 后的值；`ready` 下订单 `status` 仍为 `awaiting_payment`；`hold` 不变。
- **S1-4**：除“complete 失败”外，必须证明当前 `ready` 的 `prepay`/`clientParams` 未被旧 attempt 覆盖（逐字段 `deepEqual`）。
- **S1-5**：四个 fixture 各自一条；断言不释放 hold（`until`/`status` 原样），且 `hold` 不被写成 `released`。
- **S1-6a**：断言 `Object.hasOwn(order, "paymentRequest") === false`（若基线订单本无该字段），不接受 `status:"none"` 残留。
- **S1-6b**：回退必须在**同一事务**内完成（证据给出事务 refs 与 writes）；不得出现“先写 `preparing` 再跨事务删除”的窗口。
- **S1-8**：适配器原始错误文本不得出现在客户端文案中（断言 `!/synthetic|adapter/i.test(msg)`）；`order.status` 仍为 `awaiting_payment`。
- **S1-9**：胜者 `epoch` 必须比败者 `epoch` 大 1；败者不得写入 `paymentRequest` 的任何字段。
- **S1-10**：`deepEqual`，且 `hold` 不变；不得因 `failed` 调 `closeUnpaid`。
- **S1-12**：`create` 必须为 0（接管已发请求）；`lastQueryAt` 不由 S1 写（S4 才写）。
- **S1-13**：只有 sent 为空才允许 create；必须证明 `create` 只发生 1 次。
- **S1-14**：该用例的 `paymentParams` 从 409 改为 503（见 §8）；`admin_audit` 中不得出现 `核对支付资格`。
- **S1-15**：返回对象与写入时逐字段一致；不新增 audit、不重签、不 create。
- **S1-16**：DTO 键集合与基线完全相同（不含 `paymentRequest`/`prepay`/`clientParams`）；读路径 `deepEqual`。
- **S1-17**：静态证明无 `setTimeout`/`setInterval`/重试循环/第二次 `out_trade_no` 生成/进程内 `Map` 锁/新增固定错误码/新增 dispatch action；`index.js` 零 diff。

### 4.2 audit 与适配器计数的全局口径

- 只有 `ready`（S1-1 胜者、S1-3、S1-13）写成功审计，且恰好 1 条；其余全部 0。
- 每个用例的 create/query 计数必须写成“预期/实测”；实测多于预期即 FAIL（禁止重试循环、失败后回退 create、查询不成功转 create）。
- 审计内容断言使用 action 精确匹配；`_id`/`createdAt` 为随机/时间值，比较长度与内容（action/actor/target）而非整条随机字段。

## 5. 写集与“其余全库相等”的执行口径

- `WP` 的具体形态：先 `before = structuredClone(store.data)`；执行；`after = structuredClone(store.data)`；断言
  1. `after.rental_preleases` 中仅目标订单变化；
  2. 目标订单除 `paymentRequest` 与 `updatedAt` 外逐字段相等；
  3. 其余集合（`houses`/`rooms`/`property_catalog`/`users`/`rental_settings`/`rental_appointments`/`rental_room_holds`/`rental_identity_documents`/`admin_audit`）整体 `deepEqual`。
- `W0`：直接整体 `deepEqual`（含 `admin_audit`）。
- 云 Store 对每次写入附加 `updatedAt`（`store.js:79`），LocalStore 同（`admin-web/lib/store.mjs:178`）；因此 `updatedAt` 是 `WP` 唯一允许的额外字段，其余字段一律逐字段断言。
- `paymentRequest` 是**内部待对账状态**，不是支付事实：不得把 `WP` 声称成“全库零写”，也不得写 `rental_payment_transactions`（S3 才有该集合）。
- `admin_audit` 的写入由 Store 在事务内完成；S1 的 claim/sent/`reconciling` 必须传 `writeAudit:false`（两份 Store 当前均支持，无需改 Store）。

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
| `admin-web/tests/leasing.test.mjs:621-653`（create 进行中证件被替换） | 期望 **409** | 期望 **503 `PAYMENT_QUERY_UNAVAILABLE`**；断言 `paymentRequest.status="reconciling"`、`externalRequestSentAt` 保留、`epoch` 不变、无 `核对支付资格` 审计 |
| `admin-web/tests/leasing.test.mjs:743-760`（适配器故障） | 期望整体 `deepEqual`（零写） | 改为 **WP**（`paymentRequest="reconciling"` + sent 保留）+ audit 0 + hold/订单状态不变 + 原始错误不泄漏 |
| `admin-web/tests/leasing.test.mjs:762-781`（成功路径） | 断言 create 1、audit 1、`package` | 保持上述断言，另加 `ready`、`prepay.prepayId`、`clientParams` 与 `paymentRequest` 逐字段断言 |
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
- 每个用例的 create/query 预期/实测、audit 次数、W0/WP 结果。

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
| G3 | W0/WP 逐项成立；`admin_audit` 逐项计数 |
| G4 | 仅改 §2 白名单；契约卡/任务卡/`index.js`/`wechat-pay.js`/UI 零 diff |
| G5 | 只运行 §9.1 两条命令；无 glob/`npm test`/HTTP |
| G6 | 追加提交、普通 push、`ls-remote` 核对；无 amend/rebase/reset/squash/force/merge；无全局 Git 配置 |
| G7 | 不部署、不接真实支付、不开 HTTP/UI、不连设备/业务云、不安装依赖 |
| G8 | 证据含完整 SHA/父/文件范围/命令/exit/计数/适配器计数/零写断言/远端状态/未验证 |
| G10 | 逐用例只断言一个 code/status；无 409/503 二选一；无新增固定码 |
| G13 | guard 闭合：加载前安装、加载期违规 0、逐入口负控全过、必要依赖正控全过、ESM 命名绑定被拦截、子进程 1/1、非监听清单全过、环境失败口径已记录 |
| G14 | 无占位 PASS；`DEFERRED` 不计入通过；无 skip/todo/only |
| G15 | 每个运行场景有唯一 code/status、W0/WP、audit、create/query；不出现“—/0/1/409/503/待定”含糊值 |

## 10. 停止点

1. S1 实施提交并**普通 push**到 `feat/rental-s1-persistent-single-flight`（或等义新分支）后**立即停手**，交 Codex 独立复审；不得进入 S2。
2. 不合并、不部署、不开 HTTP/UI、不接真实支付/设备/业务云；不运行 §9.1 以外的命令。
3. 复审未 PASS 前不开始 S2；S2–S6 全部冻结（§1.2）。
4. 任何与契约/任务卡冲突的发现：先停手报 Codex，不得自行改写契约或本清单。

## 11. 未决项与需 Codex 确认的口径（不确认即不得实施）

| # | 事项 | 本清单的建议口径 | 影响 |
|---|---|---|---|
| 1 | complete 失败/绑定失效的返回码 | 固定 **503 `PAYMENT_QUERY_UNAVAILABLE`**（`externalRequestSentAt` 已写，失败关闭）；这会把既有用例 `admin-web/tests/leasing.test.mjs:621-653` 的 409 改为 503 | 直接决定 S1-9/S1-14 的唯一预期 |
| 2 | 适配器故障的客户端文案 | 复用 `index.js` 现有兜底文案 `租赁服务暂不可用，请稍后重试` + `status=503`，不泄漏适配器原文 | 决定 S1-8/S1-11 的断言字面量 |
| 3 | S1 是否写 prepay TTL 字段 | S1 只写 `prepay={prepayId,createdAt}`，TTL 由 S2 置入；S1 `ready` 命中不做 TTL 判断 | 决定 S2 边界与 S1-15 |
| 4 | 回退后的精确状态 | 必须恢复到请求前逐字节一致（原无 `paymentRequest` 者仍无该字段）；`previous` 不落库 | 决定 S1-6b 的 `deepEqual` 口径 |
| 5 | 云函数层运行期 409/503 断言 | 冻结 `index.js` 下无法在现有 harness 注入支付适配器；S1 以领域 `error.status` + `index.js:75-80` 静态映射为证据。若要求运行期云层断言，需另行授权 `index.js` 测试缝 | 决定证据是否“云层已验” |
| 6 | 内部 seam 的合法性 | 允许在 `domain.js` 增加**非 dispatch** 的内部方法（如 `claimPaymentRequest`/`completePaymentRequest`）供测试直接驱动；不改协议、不新增 action | 决定 S1-4/S1-6b/S1-7 可测性 |
| 7 | `ready` 下 `leaseUntil` 保留或清空 | 契约未定；S1 固定其一并在证据记录，不作为后续段依赖 | 避免实现任意选择被复审判 FAIL |
| 8 | guard 子进程继承 | 依赖环境；不支持则 BLOCKED（T10/T11），不得 skip | 决定 S1 能否 PASS |
| 9 | 旧数据 epoch/缺省口径 | 缺失 ≡ `none`、`epoch=0`、首次 claim=1；不做迁移 | 决定 §6 边界 |

## 12. 与输入、父提交、实施起点的最终声明

- 本清单以 `8a2f8d9172544decd5def108ca689988ec92bf8f` 为**父**追加提交；提交后完整 SHA 与父 SHA 以交付报告与 `ls-remote` 实测为准。
- **S1 实际实施起点是本清单提交（X），不是 `8a2f8d9`**；实施分支必须从 X 新建，保证本清单在实施历史中。
- 本清单只新增一个文件；未运行测试、未安装依赖、未改代码/测试/Store/契约/任务卡、未开 HTTP/UI、未接真实支付/云/设备、未合并/未部署。
- **本清单 PASS 不等于 S1 实施授权**；S1 需单独书面批准（范围 + 批准时 tip SHA），S2–S6 仍冻结，T1–T13 不重推。
