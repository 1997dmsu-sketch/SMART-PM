# 预签约分阶段实施任务卡（离线 · 待 Codex 独立复审）

- 日期：2026-11-18 起草；2026-11-19 提交（Asia/Shanghai）
- 执行者：DSH 根代理 `lead`（`deepseek-flash`）；Windows PowerShell 5.1 / Git `2.55.0.windows.3` / Node `v24.19.0`
- 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\rental-staged-task`
- 分支：`docs/rental-staged-implementation-task`
- 输入 / 本卡父提交：`5d56dead460220d3409fa80bcaea8b1fa3a5c9a3`（父 `bcacadbe6ada35c9cac17722fd054deafe341f82`）
- 已批准契约：`docs/RENTAL-OPEN-ITEMS-CONTRACT-CARD.md`（第五版；427 行；blob `94d61ed1c3d44bdb02249aa96e10d57422d5225d`）；辅助口径：`docs/RENTAL-PRESIGNING.md`、`docs/RENTAL-IDENTITY-PAYMENT-REVIEW-FIX-2026-11-16.md`
- 代码基线：`3bf595140088bc71a3939fb67880807965e9c566`；自该基线至本卡父提交，运行时代码/测试/Store 零 diff（仅契约卡文档新增）
- 状态：**仅新增本卡；不实施、不运行测试、不改契约/生产代码/测试/Store；待 Codex 独立复审（不自批）**
- 云指令来源：`/workspace/artifacts/C1-epoch-RENTAL-retry-review/DISPATCH.md` 本机不存在（已核对 `/workspace`、`C:\workspace`、`D:\workspace` 及工作区）；**不声称已读该指令**。本卡只按本轮消息与已批准契约展开；未明确处列入 §8。

## 0. 状态与输入核对（本轮实测）

| 项 | 值 | 核验方式 |
|---|---|---|
| 本卡父提交 | `5d56dead460220d3409fa80bcaea8b1fa3a5c9a3` | `git rev-parse HEAD` |
| 父提交的父 | `bcacadbe6ada35c9cac17722fd054deafe341f82` | `git log -1 --format=%P` |
| 工作树 | 干净 | `git status --porcelain=v1` 空 |
| 分支 | `docs/rental-staged-implementation-task`（无 upstream） | `git rev-parse --abbrev-ref HEAD` / `@{u}` 报错 |
| 远端同名分支（推送前） | 不存在 | `git ls-remote --heads origin` 无该 ref |
| 契约 blob / 行数 | `94d61ed1…` / 427 | `git rev-parse HEAD:docs/…` + 字节/LF 计数 |
| 代码基线 diff | 仅契约卡 | `git diff --name-only 3bf5951..HEAD` |
| 本卡新增 | 仅本文件 | 提交后 `git show --stat` 核对 |
| 冻结项 | 合并、实施、C2/C3、HTTP/UI、部署上线、真实支付、设备、业务云 | 本轮均未触碰 |

本卡只新增 `docs/tasks/RENTAL-PRESIGNING-STAGED-IMPLEMENTATION-TASK-2026-11-18.md` 一个文件；以普通追加提交推送 `origin/docs/rental-staged-implementation-task`，推送后以 `git ls-remote` 核对远端 tip。

## 1. 本卡地位与硬性不变量

本卡是**已批准契约的实施分解**，不是新契约、不是实施/合并/部署授权。任何表述与契约冲突时，以契约为准并立即 `BLOCKED`，不得自行改写契约或本卡；本卡提交本身不执行任何阶段。

| 编号 | 不变量（所有阶段共同门禁） | 契约锚点 |
|---|---|---|
| I1 | 外部请求一旦可能发出（`externalRequestSentAt` 非空），**禁止重发 create**；权威 query 确认无有效支付后只能 `failed` 终态，不自动/定时重试；唯一可再次 create 的是确认外部从未发出的 `none` | §4.3.1、§4.3.2、§4.4 |
| I2 | `externalRequestSentAt` 一旦非空**永久保留**（含 `failed`），不得清空、不得回退 `none`；`attemptId`/`epoch`/`out_trade_no`/`queryEvidence` 一并保留 | §4.1、§4.3.1-5、§4.5 |
| I3 | 支付请求失败/未知/`failed`/query 不可用都**不自动终止有效订单、不释放有效自有 hold**；只有明确订单生命周期动作（取消、预约拒绝、未付款关闭、订单失效，以及有明确已批准依据的退款）可释放 | §4.2-6、§4.3、§4.5 |
| I4 | 隐私重新同意**不要求重新上传仍有效的身份证**：`consentIdentity` 直接绑定现有证件；证件已更换/过期/被替换时才重新上传/审核 | §6.2、§6.3 |
| I5 | 有效已付订单（`paid_held` 或有效 hold）**不得仅因隐私变化强制重新下单/缴款**；保留支付事实与 hold，`privacyReviewStatus=consent_required`，同意后继续原订单签约 | §6.4-1、§6.4-2 |
| I6 | **支付事实优先**：已有验签 `SUCCESS` 事实/`transactionId` 时，query 的 `CLOSED`/`REVOKED`/`PAYERROR`/`ORDER_NOT_EXIST` 不得覆盖/删除事实，也不得写成 `failed` 掩盖到账 | §4.3、§5.1 |
| I7 | 跨订单流水唯一：`_id=transaction_id`；同单同流水须完整事实字段一致才幂等，否则 409；重复/冲突**零新增（含 audit）** | §5.1、§5.2 |
| I8 | 押金/留房/模板文本等非隐私变更不递增 `privacyVersion`、不触发重传/重新同意；隐私变化不是退款依据，退款须独立已批准依据 | §6.1、§6.4-2 |

## 2. 六段总览、依赖与执行顺序

六段按依赖排序编号；覆盖本轮要求的全部六个领域。执行顺序为 S1→S2→S3→S4→S5→S6，逐段停手复审。

| 阶段 | 领域 | 执行序 | 依赖（前置须已 PASS） | 契约锚点 | 主文件 |
|---|---|---|---:|---|---|
| S1 | 持久单飞 / CAS | 1 | 本卡提交 | §4.1、§4.2、§4.4、§4.5、§7.1 | `domain.js`、两份测试 |
| S2 | 缓存签名（prepay 与 clientParams 分离） | 2 | S1 | §4.1.1、§4.5、§7.1 | `domain.js`、`wechat-pay.js`、两份测试 |
| S3 | 流水事实唯一幂等 | 3 | S1（语义；线性前置 S2） | §5、§7.2、§7.4 | `domain.js`、两份 Store、两份测试 |
| S4 | 查询对账与 `failed` 终态 | 4 | S1、S2、S3 | §4.3、§4.3.1、§4.3.2、§4.4、§7.1 | `domain.js`、`wechat-pay.js`、两份测试 |
| S5 | 独立隐私同意 | 5 | S1、S3、S4 | §6.1、§6.2、§6.5、§7.3 | `domain.js`、两份 Store、小程序页、后台 UI、两份测试 |
| S6 | 旧数据兼容 | 6 | S4、S5（S3 口径） | §6.3、§6.4、§7.3 | `domain.js`、小程序页、后台 UI、两份测试 |

**为何缓存先于查询**：query 的 `NOTPAY` 需要“有可复用 `ready` 参数则返回缓存”，query 的 `SUCCESS` 需要 S3 的跨订单事实在同一事务落账；因此 S2、S3 必须先于 S4。**任何一段不得跳序**。

### 2.1 分支与提交模型

- S1 从本卡提交新建实施分支；Sn 从 S(n-1) 的 Codex PASS tip 新建；分支名由实现会话在入口记录（建议 `feat/rental-s<N>-<topic>`）。
- 每段只允许**追加提交**；禁止 `amend`/`rebase`/`reset`/`squash`/`force`/`cherry-pick`/合并。普通 push 后以 `ls-remote` 核对。
- 实施分支不得修改契约卡、本卡、`docs/RENTAL-PRESIGNING.md`；契约 §8 的部署清单/索引/权限更新随部署门禁执行，部署冻结期间不改该文档，避免把未执行的部署写成事实。不得写入任何全局 Git 配置；网络命令逐命令带 `safe.directory` 与 TLS 后端。
- 每段完成后**停手**等 Codex 独立复审；未获 PASS 不进入下一段；不自批。

## 3. 公共口径：适配器计数、全库零写、审计例外

### 3.1 适配器计数

回归必须对注入的支付适配器做**精确计数**：`create` 与 `query` 各自计数，逐用例记录“预期/实测”，任何多于预期的调用即 FAIL。禁止重试循环、禁止失败后回退 create、禁止查询不成功转 create。真实微信适配器只由离线 mock 替代；本卡不接真实商户。

### 3.2 全库零写

- **全库零写**：`before = structuredClone(store.data)`，执行并捕获错误，`after = structuredClone(store.data)`，`assert.deepEqual(after, before)`；同时断言 `admin_audit` 长度不变。
- **允许写集**：无法全库零写的内部状态路径，先声明唯一允许写入的文档与字段，断言这些文档按预期变化，且其余集合与其余文档 `deepEqual`；不得用“记录数不变”代替内容断言。
- 读取路径（`mine`/`adminList`/`settings`/DTO 派生）**不得写库**。

### 3.3 审计零写例外（全卡统一）

| 类别 | 允许写入 | audit | 说明 |
|---|---|---|---|
| 预校验失败、CAS 409、旧 epoch、身份/同意/流水校验失败 | 全库零 | 0 | `deepEqual` |
| 单飞 claim（`none→preparing`，写 attempt/epoch/lease） | 仅 `paymentRequest` | 0 | 内部待办状态，不是支付事实 |
| `externalRequestSentAt` 写入 / complete 失败转 `reconciling` | 仅 `paymentRequest` | 0 | 外部可能已发出，保留待对账 |
| `ready`（create 成功且 complete CAS 有效） | `paymentRequest`（prepay/clientParams） | **1 条成功审计** | 仅此路径记成功 |
| 权威 query 确认无有效支付 → `failed` + `queryEvidence` | 仅 `paymentRequest` | 0 | 终态不释放 hold |
| query 超时/未知 → 保留 `reconciling` | 仅 `lastQueryAt` 等 | 0 | 不得写成功审计 |
| 首笔真实支付事实 | `rental_payment_transactions` + 订单 + hold（如 eligible） | 1 | 外部事实例外 |
| 重复通知/流水冲突/跨订单冲突 | 全库零 | 0 | 现 `applyPayment` 重复路径仍会写 audit，S3 必须改为零写 |
| 旧单/失效单到账 | 事实 + 订单 `refund_required` | 1 | 事实必须保留，不夺取新占位 |
| 退款事实 | 独立已批准依据 + 退款事实 | 待 §9.2 | 未批准前不实现、不声称通过 |
| 订单生命周期释放 hold（取消/拒绝/未付款关闭/失效） | 订单/hold | 1 | 现有动作，非支付失败自动释放 |
| 缓存命中 / 本地重签 | 仅必要时 `clientParams` | 0 | 不重复成功审计、不重复 create |
| 同意记录创建 / 重复同意 | 同意集合（重复为 0） | 1 / 0 | 用户动作；重复幂等零写 |

`paymentRequest` 的 claim/lease/`reconciling`/`failed` 写入是**内部状态/待对账**，不得伪称“全库零写”，也不得计为支付事实。

### 3.4 S4 之前的过渡规则（仅用于分段验收，不可上线）

S4 交付前，任何需要商户 query 才能决定的路径（例如 prepay 过期、`reconciling` 接手、损坏缓存）一律 **fail-closed**：`create` 0 次、不返回参数、固定 503 `PAYMENT_QUERY_UNAVAILABLE`、0 审计、有效自有 hold 保留；不得当作“未创建”而 create，也不得回退 `none`。S4 必须以完整 query 表替换这些临时代码与断言，并在证据中列出被替换点。部署仍冻结，过渡状态不构成可上线实现。

## 4. 阶段卡

### 4.1 S1 持久单飞与 CAS

**入口**：本卡提交为父；契约 blob 未变；工作树干净；无额外文件。

**允许文件（唯一）**：

```text
cloudfunctions/leasing/domain.js
cloudfunctions/leasing/store.js      # 仅当 transact 选项/写入形状确需；默认不改
admin-web/lib/store.mjs              # 仅同上；默认不改
admin-web/tests/leasing.test.mjs
tests/leasing.test.cjs
```

禁止改动 `cloudfunctions/leasing/index.js`、`wechat-pay.js`、小程序、后台 UI、契约卡、本卡。

**输入**：契约 §4.1（状态模型）、§4.2（CAS/并发）、§4.4（转移表）、§4.5（事务/回滚/审计）；验收矩阵 §7.1。当前事实：`domain.js:846-861` 无持久化、`domain.js:815-843` 只读校验、`store.js:63-95` 与 `admin-web/lib/store.mjs:156-196` 的事务/审计语义。

**必须实现**：

1. 订单内嵌 `paymentRequest`，字段与契约 §4.1 完全一致（`status`/`attemptId`/`epoch`/`leaseUntil`/`startedAt`/`externalRequestSentAt`/`lastQueryAt`/`failedAt`/`previous`/`queryEvidence`/`prepay`/`clientParams`）；S1 可写 `queryEvidence=null`、`failed` 仅支持读取与拒绝。
2. claim 使用事务 CAS（订单 + hold + 两份证件 + settings 引用），仅 `none` 或 lease 已过期的 `preparing`/`reconciling` 可接管；接管写 `epoch+1`、新 `attemptId`；接管已发请求一律 `reconciling`，**不 create**。
3. `externalRequestSentAt` 只能在全部本地校验通过、即将调用商户 create 前写入，且须持久化成功后才发起 HTTP；写入前的本地失败才可回落 `none` 并清除中间态。
4. complete 必须带 `attemptId+epoch` CAS：有效则 `ready` + 保存 prepay/clientParams + 一条成功审计；CAS/lease/epoch 失败或调用结果未知时进入 `reconciling`，保留待对账事实，不返回参数、不写 audit、不回滚 `none`/`failed`。
5. 适配器抛错/超时：`reconciling`、`externalRequestSentAt` 保留、不返回参数、0 audit、订单与 hold 不变。
6. 旧 attempt/epoch 的 complete/reconcile 写入必须失败，不得覆盖新 epoch。
7. `failed` 终态：再次 `paymentParams` 返回 409（沿用现有订单不可支付错误，不新增错误码）、0 create、0 audit、不释放 hold；`externalRequestSentAt`/`attemptId`/`epoch`/`out_trade_no`/`queryEvidence` 保留。
8. 继续支付硬条件：`hold.orderId === order._id` 且 `hold.until > now`；否则不得 create/返回参数。
9. 请求失败/未知/`failed` 不改变订单生命周期、不释放 hold；不得使用进程内锁。

**正/负并发回归**（create/query 为适配器计数；“零写”指 §3.2）：

| # | 场景（正=允许，负=拒绝） | create | query | 期望 | audit |
|---|---|---:|---:|---|---:|
| S1-1 | 正：两并发首次请求 | 1 | 0 | 仅一个 `ready`；另一个 409 `PAYMENT_PARAMS_IN_PROGRESS`；单一 `paymentRequest`；单一成功审计 | 1 |
| S1-2 | 负：有效 lease 内第二方 | 0 | 0 | 409；全库零写 | 0 |
| S1-3 | 正：create 成功 + complete CAS 有效 | 1 | 0 | `ready` + prepay/clientParams 持久化 | 1 |
| S1-4 | 负：旧 epoch complete | 0 | 0 | 被拒绝；当前 epoch 不变；全库零写 | 0 |
| S1-5 | 负：订单过期/hold 非本单/已释放/材料变化 | 0 | 0 | 409/503；全库零写；不释放 hold | 0 |
| S1-6 | 正：本地 create 前校验失败（`externalRequestSentAt` 未写） | 0 | 0 | 最终 `none`；无残留 `preparing`；0 audit | 0 |
| S1-7 | 负：已写 `externalRequestSentAt` 后尝试回退 `none` | 0 | 0 | 拒绝回退；保持待对账；0 audit | 0 |
| S1-8 | 正：create 超时/5xx | 1 | 0 | `reconciling`；参数不返回；订单/hold 不变 | 0 |
| S1-9 | 负：complete 与接管并发（CAS 失败） | 1 | 0 | `reconciling`；旧 attempt 不覆盖新 epoch | 0 |
| S1-10 | 负：`failed` 终态再次请求 | 0 | 0 | 409；`deepEqual`；保留全部事实字段 | 0 |
| S1-11 | 正：失败/超时后有效 hold 保留 | 1 | 0 | `hold.until`/`hold.orderId` 原样 | 0 |

**审计/零写**：claim/sent/`reconciling` 仅允许 `paymentRequest` 内部写、0 audit；`ready` 恰好 1 条；其余失败/409 全库零写（含 audit）。不得把内部状态写称为“全库零写”。

**证据**：`admin-web` 与根目录逐文件运行（仅 `admin-web/tests/leasing.test.mjs`、`tests/leasing.test.cjs`），临时 no-io guard（阻断 `net.Server.listen`/`tls connect`/`fetch`/`http(s).request`，不提交）下 exit code 与计数；逐用例适配器计数、`deepEqual`/允许写集；`git diff --stat`、完整 SHA/父。**停止点 S1**：提交并普通 push；停手等 Codex；不进入 S2；不合并/不部署。

### 4.2 S2 缓存签名（prepay 与 clientParams 分离）

**入口**：S1 PASS；其余同 §4.1 入口。

**允许文件（唯一）**：

```text
cloudfunctions/leasing/domain.js
cloudfunctions/leasing/wechat-pay.js   # 仅新增“用缓存 prepayId 本地签名”能力，不新增网络调用
admin-web/tests/leasing.test.mjs
tests/leasing.test.cjs
```

**输入**：契约 §4.1.1、§4.5；验收矩阵 §7.1 缓存行。当前事实：`wechat-pay.js:119-141` 的 `create` 一次完成下单与签名、无本地重签入口；`domain.js:846-861` 无缓存。

**必须实现**：

1. `prepay.prepayExpiresAt` 与 `clientParams.signatureExpiresAt` **各自有效期**，来自可配置 TTL（§9.7 取值在 S2 入口记录），**不得**直接等于订单 `paymentDeadline`。
2. 两者均有效且订单/自有 hold 有效：返回缓存 `clientParams`；create 0 次、query 0 次、**0 新增 audit**。
3. `prepay` 有效但签名过期：用缓存 `prepayId` **本地重签**，create 0 次、query 0 次、0 audit；`package` 中 prepay 标识不变。
4. `prepay` 过期：缓存失效，不返回旧参数、不 create；需要 query 的路径按 §3.4 过渡（503），S4 替换。
5. 订单失效或自有 hold 失效：缓存不可用，409，不 create、不返回参数、0 audit。
6. `clientParams.package` 内 prepay 标识必须等于 `prepay.prepayId`；不一致按损坏缓存处理：不返回、不 create、0 audit，按 §3.4 过渡。
7. 并发重签允许两者都成功（本地签名、无外部 create）；仅一份 `prepay`，`clientParams` 后写者生效；不得因此新增 prepay 或审计。
8. 永不因签名/缓存问题回退为 create；不得复用旧 `out_trade_no` 发起第二次 create。

**正/负回归**：

| # | 场景 | create | query | 期望 | audit |
|---|---|---:|---:|---|---:|
| S2-1 | 正：prepay 与签名均有效 | 0 | 0 | 返回同一组参数；全库零写 | 0 |
| S2-2 | 正：签名过期、prepay 有效 | 0 | 0 | 本地重签；`prepayId` 不变；仅 `clientParams` 变化 | 0 |
| S2-3 | 负：prepay 过期 | 0 | 0 | 不返回；缓存失效；过渡 503；不 create | 0 |
| S2-4 | 负：`package` 与 `prepayId` 不一致 | 0 | 0 | 不返回；过渡 503；不 create | 0 |
| S2-5 | 负：hold 已释放/非本单 | 0 | 0 | 409；不返回参数；全库零写 | 0 |
| S2-6 | 负：订单支付截止已过 | 0 | 0 | 409；不返回参数；全库零写 | 0 |
| S2-7 | 正：两并发重签 | 0 | 0 | 两者均得有效参数；单一 prepay；无新增审计 | 0 |
| S2-8 | 负：TTL 误设为订单截止 | 0 | 0 | 断言 `prepayExpiresAt`/`signatureExpiresAt` 不等于 `paymentDeadline` 来源 | 0 |

**审计/零写**：缓存命中与本地重签 0 audit；失败/409 全库零写；仅 S1 的 create 成功路径有成功审计。

**证据**：同 S1 口径，另记录 TTL 配置值与“签名/缓存分离”断言。**停止点 S2**：提交并普通 push；停手等 Codex；不进入 S3。

### 4.3 S3 流水事实唯一幂等

**入口**：S2 PASS（S3 语义上只依赖 S1 的审计/状态口径；按 §2 的线性分支仍以 S2 的 PASS tip 为父）；其余同 §4.1 入口。

**允许文件（唯一）**：

```text
cloudfunctions/leasing/domain.js
cloudfunctions/leasing/store.js        # allowed collections 增加 rental_payment_transactions
admin-web/lib/store.mjs                # collections/seed/默认数据增加同一集合
admin-web/tests/leasing.test.mjs
tests/leasing.test.cjs
```

**输入**：契约 §5.1、§5.2、§7.2、§7.4；当前事实：`domain.js:907-973`（`domain.js:920` 仅校验字符串、`domain.js:939` 仅按 `cur.transactionId` 判重、`domain.js:970` 每次都写 audit）、`store.js:24-35`/`admin-web/lib/store.mjs:5-17` 无该集合。

**必须实现**：

1. 新集合 `rental_payment_transactions`，`_id = transaction_id`；字段至少 `transactionId/orderId/appointmentId/amount/currency/appid/mchid/payerOpenid/paidAt/tradeState/source/refundState/createdAt`；不保存密钥/完整回调密文。
2. 两份 Store 的 allowed/collections 增加该集合；事务 refs 必须包含事实文档（`rental_payment_transactions/<transaction_id>`）与订单/hold/预约/两份证件/settings/`admin_audit`。
3. 事务前严格校验 `transaction_id`：非空且 `^[A-Za-z0-9_-]{1,64}$`；不合法 409、**事务前零写（含 audit）**。
4. 同 `transaction_id` 跨订单只允许一个事实文档；创建冲突即跨订单重复。
5. 幂等比较至少覆盖 `orderId`、`appointmentId`、`amount.total`、`currency`、`appid`、`mchid`、`payerOpenid`、规范化的 `success_time/paidAt`、`trade_state`；全部一致才幂等成功。
6. 重复通知/完整事实一致：**零新增（含 audit）**；实现须在 no-op 路径传 `writeAudit:false`（或写前拒绝），不得沿用当前“空写入仍记 audit”。
7. 任一字段不一致、同单异流水、跨订单同流水：409、零写（含 audit）、不覆盖事实、不移动 hold。
8. 首笔合法到账：事实 + 订单 + 符合条件的 hold + 1 条必要审计（现有 `核验微信支付`）。
9. 旧单/失效单到账：写事实 + 旧单 `refund_required`，不夺取/延长新 hold；支付事实必须保留，用于退款对账。
10. 事实优先：即使 `paymentRequest.status=failed`，验签 `SUCCESS` 仍写事实；不得丢弃。
11. 退款事实（`refundState` 推进/独立退款记录）须等 §9.2 独立依据与审批；未批准前不实现自动退款，不声称退款路径通过。

**正/负回归**：

| # | 场景 | create | query | 期望 | audit |
|---|---|---:|---:|---|---:|
| S3-1 | 负：空/非法 `transaction_id` | 0 | 0 | 409；全库零写 | 0 |
| S3-2 | 正：同单同流水、完整事实一致 | 0 | 0 | 幂等成功；`deepEqual`（含 audit） | 0 |
| S3-3 | 负：同单同流水、任一事实字段不同 | 0 | 0 | 409；`deepEqual`；不覆盖事实/不动 hold | 0 |
| S3-4 | 负：跨订单同流水 | 0 | 0 | 409；`deepEqual` | 0 |
| S3-5 | 负：同单异流水 | 0 | 0 | 409；`deepEqual` | 0 |
| S3-6 | 正：首笔合法到账 | 0 | 0 | 事实 + 订单 + hold（eligible） | 1 |
| S3-7 | 正：旧单/新占位到账 | 0 | 0 | 事实 + 旧单 `refund_required`；新 hold 不变 | 1 |
| S3-8 | 正：过期后到账 | 0 | 0 | 事实 + `refund_required`；不自动退款 | 1 |
| S3-9 | 正：两条同流水通知并发 | 0 | 0 | 一条事实；另一方幂等零写零 audit | 1 / 0 |
| S3-10 | 负：同单异流水并发 | 0 | 0 | 仅一条事实；另一方 409；单 audit | 1 |

**审计/零写**：重复/冲突/非法一律零写（含 audit）；真实事实首笔 1 条；不得把事实写入隐藏为“无写”。

**证据**：事实集合逐字段断言、跨订单唯一性、审计计数、适配器 0/0。**停止点 S3**：提交并普通 push；停手等 Codex；不进入 S4。

### 4.4 S4 查询对账与 `failed` 终态

**入口**：S1、S2、S3 均 PASS；其余同 §4.1 入口。

**允许文件（唯一）**：

```text
cloudfunctions/leasing/domain.js
cloudfunctions/leasing/wechat-pay.js   # 仅当 query 验签绑定/响应摘要需透出；不新增 endpoint/网络行为
admin-web/tests/leasing.test.mjs
tests/leasing.test.cjs
```

**输入**：契约 §4.3 全状态表、§4.3.1 统一规则、§4.3.2、§4.4、§4.5、§7.1；当前事实：`domain.js:863-879` 只处理 `SUCCESS` 与 `CLOSED/REVOKED/PAYERROR`，`domain.js:880-905` 的 `closeUnpaid` 会释放 hold，且无 `queryEvidence`/无 `ORDER_NOT_EXIST`/无对账入口。

**必须实现**：

1. 接管/未知后**先 query**；lease 过期接手写 `epoch+1`、新 `attemptId`、`reconciling`，**create 0 次**。
2. query 响应须通过平台验签，并校验 `appid`/`mchid`/`out_trade_no` 与本地绑定一致；否则按“未确认”处理（503），不得当作 `failed`/未创建。
3. 按 §4.3 全表实现唯一处理：
   - `SUCCESS`：校验 appid/mchid/金额/币种/payer/out_trade_no/transaction_id/时间；写真实事实（S3）；订单有效且 eligible → `paid_held`+hold；订单失效/旧单 → `refund_required`；不新 hold。
   - `REFUND`/`REFUND_SUCCESS`：待 §9.2，不覆盖支付事实、不释放 hold、不自动退款；标记人工，**不声称通过**。
   - `NOTPAY`：有可复用 `ready` 参数则返回缓存（create 0）；否则保持 `reconciling`，固定 409 `PAYMENT_PARAMS_IN_PROGRESS`，不重发。
   - `USERPAYING`：保持 `reconciling`，固定 409，不重发。
   - `CLOSED`/`REVOKED`/`PAYERROR`/`ORDER_NOT_EXIST`：权威确认无有效支付（`ORDER_NOT_EXIST` 无订单体时以验签响应 + 原请求绑定为准）→ `failed` 终态 + `queryEvidence`（与 `failed` 同一事务 CAS、绑定当前 `attemptId`+`epoch`）；CAS 失败保持 `reconciling`；不 create、不自动重试、**不释放有效自有 hold**、0 audit。
   - query 超时/网络错误/未知状态码/其他未知：保持 `reconciling`、固定 503 `PAYMENT_QUERY_UNAVAILABLE`、记录 `lastQueryAt`、不 create、hold 保留。
4. **不得**在 `CLOSED` 等路径调用 `closeUnpaid`（其释放 hold 属订单生命周期动作，与终态保留 hold 冲突）；`failed` 也不释放 hold。
5. 唯一错误码：处理中/对账中 409 `PAYMENT_PARAMS_IN_PROGRESS`；查询不可用 503 `PAYMENT_QUERY_UNAVAILABLE`；`failed` 再次支付请求沿用现有订单不可支付 409（不新增固定码）。
6. `failed` 人工 query：仍 `failed`，仅补记 `queryEvidence`/`lastQueryAt`（带 `attemptId`+`epoch`）；不 create、不自动重试。
7. `failed` 后验签 `SUCCESS` 通知/查询：写真实支付事实；旧单/失效单 `refund_required`；不丢弃、不因 `failed` 拒绝事实。
8. 支付事实优先：已有验签 `SUCCESS` 事实/`transactionId` 时，`CLOSED`/`REVOKED`/`PAYERROR`/`ORDER_NOT_EXIST` 不得覆盖/删除事实或写成 `failed` 掩盖；按既有事实/退款对账处理。
9. 不定义第二次 create、不生成新商户订单号、不复用旧 `out_trade_no` 重发；不对 `failed` 做自动/定时重试。
10. 以完整 query 表替换 §3.4 过渡路径，并删除 S1/S2 的临时 503 断言（保留“真实 query 不可用”的 503）。

**正/负回归**：

| # | 场景 | create | query | 期望 | audit |
|---|---|---:|---:|---|---:|
| S4-1 | 正：lease 过期接手 | 0 | ≥1 | `epoch+1`；先 query；不 create | 0 |
| S4-2 | 正：query `SUCCESS`（有效单） | 0 | 1 | 事实 + `paid_held` + hold | 1 |
| S4-3 | 正：query `SUCCESS`（旧单/失效单） | 0 | 1 | 事实 + `refund_required`；不夺新 hold | 1 |
| S4-4 | 正：query `NOTPAY` 有缓存 | 0 | 1 | 返回缓存；0 create | 0 |
| S4-5 | 负：query `NOTPAY` 无缓存 | 0 | 1 | `reconciling`；409；hold 保留 | 0 |
| S4-6 | 负：query `USERPAYING` | 0 | 1 | `reconciling`；409；hold 保留 | 0 |
| S4-7 | 负：query `CLOSED/REVOKED/PAYERROR/ORDER_NOT_EXIST` | 0 | 1 | `failed` 终态 + `queryEvidence`；hold 保留；不重试 | 0 |
| S4-8 | 负：query 终态但已有 `SUCCESS` 事实 | 0 | 1 | 事实保留；不得 `failed` 掩盖；按事实/退款对账 | 0 |
| S4-9 | 负：query 超时/网络/未知 | 0 | 1 | 503；`reconciling`；`lastQueryAt`；hold 保留 | 0 |
| S4-10 | 负：query 验签失败/绑定不符 | 0 | 1 | 503；不得 `failed`/不得当未创建 | 0 |
| S4-11 | 负：`failed` 后再次 `paymentParams` | 0 | 0 | 409；`deepEqual`；事实字段保留 | 0 |
| S4-12 | 正：`failed` 后 `SUCCESS` 通知 | 0 | 0 | 事实 + `refund_required`；不丢弃 | 1 |
| S4-13 | 负：`failed` 后人工 query | 0 | 1 | 仍 `failed`；仅补 `queryEvidence`/`lastQueryAt` | 0 |
| S4-14 | 负：有效 lease 内第二方/两并发接手 | 0 | 0/1 | 一方 409；仅一方 `epoch+1`；create 0 | 0 |
| S4-15 | 负：任何自动重试/第二次 create 路径 | — | — | 静态断言无定时器/自动重试/新 `out_trade_no` 分支 | 0 |

**审计/零写**：终态 `failed`、query 未知、`NOTPAY`/`USERPAYING` 均 0 audit；仅真实事实（S3）1 条。`failed`/`reconciling` 的内部写按 §3.3 允许，不称全库零写。

**证据**：逐行对照 §4.3 表、query 计数、`queryEvidence` 字段与 CAS 绑定、hold 保留、错误码唯一性、被替换的过渡点清单。**停止点 S4**：提交并普通 push；停手等 Codex；不进入 S5。

### 4.5 S5 独立隐私同意

**入口**：S4 PASS（S1–S4 全部 PASS）；其余同 §4.1 入口。

**允许文件（唯一）**：

```text
cloudfunctions/leasing/domain.js
cloudfunctions/leasing/store.js        # allowed collections 增加 rental_identity_consents
admin-web/lib/store.mjs                # collections/seed/默认数据增加同一集合
miniprogram/pages/leasing/index.js
miniprogram/pages/leasing/index.wxml   # 相对契约 §8 的范围新增：仅“重新同意”入口与当前 privacyText 展示
admin-web/public/leasing-ui.js
admin-web/tests/leasing.test.mjs
tests/leasing.test.cjs
```

`index.wxml` 属相对契约 §8 的显式范围新增，S5 入口须由 Codex 明确批准；若拒绝，则先停手报批，不得以“UI 必需”自行扩围。

**输入**：契约 §6.1、§6.2、§6.5、§7.3；当前事实：`domain.js:439-445` 用 `templateVersion` 比较、`domain.js:523` 写 `consentVersion: cfg.templateVersion`、`domain.js:618-665`/`666-780`/`781-807`/`989-1035` 均无独立同意检查、小程序 `index.js:259` 发送 `settings.templateVersion`、`index.wxml:15` 已有隐私文本与上传同意勾选。

**必须实现**：

1. `settings.privacyVersion` 单一整数：新 settings 初始 `1`；旧 settings 缺字段按 `0` 读取但不自动同意（完整兼容行为见 S6）。
2. `saveSettings`：仅 `privacyText` 内容变化时 `privacyVersion+1`；`templateVersion` 维持现有“每次保存递增”语义；押金/留房/模板文本/标题等变更不递增、不触发重传/重新同意。
3. 新集合 `rental_identity_consents`：`_id = appointmentId + ":" + privacyVersion`；字段 `ownerId`、`appointmentId`、`privacyVersion`、`privacyTextHash`、`identityFrontId`、`identityBackId`、`frontDigest`、`backDigest`、`consentedAt`；两份 Store allowed/collections 增加。
4. `consentIdentity` 新 action（dispatch）：校验预约 owner、证件有效、当前 `privacyVersion`；直接为现有正反面创建同意记录；**不要求重新上传仍有效证件**；不改变原材料审核状态；证件已更换/过期则要求重新上传/审核；同版本重复同意幂等零写。
5. `uploadIdentity`：上传新材料时在同一事务写“材料 + 当前版本同意记录”，绑定新 front/back；输入 `privacyVersion` 必须等于当前值；不得再以 `templateVersion` 充当隐私同意。
6. `quote`/`createOrder`/`paymentParams`/`applyPayment`/`finishOrder`/`reviewAppointment` 同时满足：原材料审核绑定（documents/IDs/side/owner/expiry）**且** 当前 `privacyVersion` 的同意记录绑定相同 front/back。
7. `applyPayment` 的同意检查只影响 eligible/hold 判定**不阻止事实落账**：事实必须写（S3/I6）；缺同意时按失效/旧单处理 `refund_required`，不得丢弃或掩盖到账。
8. 小程序读取 `settings.privacyVersion` 并上传该值；提供“重新同意”入口展示当前 privacyText；旧客户端不得静默放行。
9. 后台展示同意/待复核状态（`admin-web/public/leasing-ui.js`），不返回证件图片/密文。
10. 隐私变化不是退款依据；不得由 `privacyReviewStatus` 自动写 `refund_required`。

**正/负回归**：

| # | 场景 | create | query | 期望 | audit |
|---|---|---:|---:|---|---:|
| S5-1 | 正：仅押金/留房/模板文本变化 | 0 | 0 | `privacyVersion` 不变；不重传/不重同意 | 0 |
| S5-2 | 正：`privacyText` 变化 | 0 | 0 | `privacyVersion+1`；旧同意失效；quote/pay/finish 需新同意 | 0 |
| S5-3 | 正：新上传材料 | 0 | 0 | 同事务写材料 + 当前版本同意 | 1 |
| S5-4 | 正：`consentIdentity` 绑定现有有效证件 | 0 | 0 | 不重传；审核状态不变；同意记录 | 1 |
| S5-5 | 负：旧版本同意后 quote/createOrder/paymentParams/finish | 0 | 0 | 409；全库零写 | 0 |
| S5-6 | 负：同意绑定旧证件（材料已更换） | 0 | 0 | 409；不写同意 | 0 |
| S5-7 | 负：证件过期/缺失下同意 | 0 | 0 | 409；不写同意 | 0 |
| S5-8 | 负：客户端 `privacyVersion` 不符 | 0 | 0 | 409；全库零写 | 0 |
| S5-9 | 正：两并发同版本同意 | 0 | 0 | 单条同意记录；重复方幂等零写 | 1 / 0 |
| S5-10 | 正：缺同意订单发生真实到账 | 0 | 0 | 事实保留；`refund_required`；不吞事实 | 1 |
| S5-11 | 负：非 owner 同意 | 0 | 0 | 404；全库零写 | 0 |

**审计/零写**：同意创建 1 条；重复/拒绝 0；缓存/读取不写库；真实事实按 S3。

**证据**：`privacyVersion` 变化矩阵、同意记录字段与绑定、六个入口的拒绝/放行、`index.wxml` 范围批准记录、适配器 0/0。**停止点 S5**：提交并普通 push；停手等 Codex；不进入 S6。

### 4.6 S6 旧数据兼容

**入口**：S5 PASS（S1–S5 全部 PASS）；其余同 §4.1 入口。

**允许文件（唯一）**：

```text
cloudfunctions/leasing/domain.js
miniprogram/pages/leasing/index.js
miniprogram/pages/leasing/index.wxml
admin-web/public/leasing-ui.js
admin-web/tests/leasing.test.mjs
tests/leasing.test.cjs
```

**输入**：契约 §6.3、§6.4、§7.3、§9.4；当前事实：旧 settings 无 `privacyVersion`、旧证件无同意记录、旧已付订单无同意字段，且 `defaults`（`domain.js:44-53`）无隐私版本。

**必须实现**：

1. 旧 settings 缺 `privacyVersion`：按 `0` 读取，**不自动视为已同意**；quote/新订单/继续支付/finish 在显式同意前拒绝。
2. 旧证件无同意记录/无 `privacyVersion`：派生 `legacy_unverified`，**不自动同意**；不得回填/改写旧证件记录。
3. 重新同意路径：用户阅读当前 privacyText → 勾选 → 若现有证件仍有效则 `consentIdentity` 直接绑定（不重传）→ 若缺失/过期/被更换则重新上传/审核 → 之后才能 quote/新订单/继续支付。
4. 旧客户端以 `templateVersion` 冒充隐私同意：服务端拒绝（409），要求刷新客户端；不得静默放行。
5. 旧已付订单无同意记录：保留支付事实与 hold；`privacyReviewStatus=consent_required`；`finishOrder` 拒绝；重新同意绑定现有有效证件后清除标记、继续原订单签约；**不重新下单、不重新缴款**。
6. 已付订单隐私变化：同 5；支付事实/退款状态与隐私待复核分离；不得因隐私自动退款。
7. 未付款订单隐私变化：按材料变更失效、释放该订单 hold、清除预支付缓存；重新同意后重新 quote/新订单；旧参数到账按真实事实处理（S3）。
8. 非隐私变更：`privacyVersion` 不变、不重传/不重新同意（回归保留）。
9. 不得扫描迁移/回填/重写旧记录；迁移展示与旧客户端强制升级窗口按 §9.4 审批；未批准前只做读取派生。
10. `privacyReviewStatus` 的持久化时机须避免读路径写库与失败路径写库（不得在 `finishOrder` 失败时落标记）；允许 DTO 派生或在既有成功写事务中持久化；S6 入口须确认该口径。

**正/负回归**：

| # | 场景 | create | query | 期望 | audit |
|---|---|---:|---:|---|---:|
| S6-1 | 负：旧 settings（无 `privacyVersion`）+ 有效证件、无同意 | 0 | 0 | quote/create/pay/finish 409；全库零写 | 0 |
| S6-2 | 正：旧证件 + `consentIdentity` | 0 | 0 | 同意记录；不重传；审核状态不变 | 1 |
| S6-3 | 正：旧已付订单无同意 | 0 | 0 | 事实/hold 保留；`consent_required`；finish 409；不退款/不重下单 | 0 |
| S6-4 | 正：旧已付 + 重新同意后 finish | 0 | 0 | 同意后可按其他条件完成；无新缴款 | 1 |
| S6-5 | 正：旧已付 + privacyVersion 递增 | 0 | 0 | 同 S6-3；不强制重新缴款 | 0 |
| S6-6 | 负：旧客户端 `privacyVersion=templateVersion` | 0 | 0 | 409；全库零写 | 0 |
| S6-7 | 正：非隐私变更 | 0 | 0 | `privacyVersion` 不变；不重同意 | 0 |
| S6-8 | 正：旧未付款订单隐私变化 | 0 | 0 | 失效/释放 hold/清缓存；重同意后新单 | 1 |
| S6-9 | 正：旧缓存参数到账 | 0 | 0 | 事实 + `refund_required`；新 hold 不变 | 1 |
| S6-10 | 负：迁移式回填/改写旧记录 | — | — | 静态断言无迁移写路径；旧记录原样 | 0 |

**审计/零写**：拒绝/读取 0；同意 1；旧付款事实按 S3；不得在 GET/失败路径写库。

**证据**：旧数据 fixture 的前后 `deepEqual`（除允许同意记录）、旧已付订单不重缴、旧客户端拒绝、无迁移写。**停止点 S6**：提交并普通 push；停手等 Codex；本卡全部阶段结束，仍不合并/不部署。

## 5. 全局验收门（每段逐条核对，任一未过即 BLOCKED）

| 门 | 要求 |
|---|---|
| G1 | I1–I8 全部成立；特别是“确认失败禁止重发、`externalRequestSentAt` 保留、有效 hold 保留、重新同意不重传、有效已付不重缴” |
| G2 | 适配器 `create`/`query` 计数与用例表逐项一致；无隐藏 create、无重试循环 |
| G3 | §3.3 的零写/审计例外逐项成立；no-op 路径 `deepEqual`（含 audit） |
| G4 | 仅改本段允许文件；契约卡/本卡零改动；`git diff --name-only` 与允许集完全一致 |
| G5 | 测试只运行 `admin-web/tests/leasing.test.mjs` 与 `tests/leasing.test.cjs`；无 glob/`npm test`/HTTP/`server.test.mjs`；记录 exit 与计数 |
| G6 | 追加提交、普通 push、`ls-remote` 核对；无 amend/rebase/reset/squash/force/cherry-pick/merge；无全局 Git 配置写入 |
| G7 | 不部署、不接真实支付、不开 HTTP/UI、不连设备/业务云、不安装依赖 |
| G8 | 证据含完整 SHA/父/文件范围/命令/exit/计数/适配器计数/零写断言/远端状态/未验证 |
| G9 | Codex 独立复审 PASS 才进入下一段；执行者不自批 |

## 6. 每段交付格式（缺项视为未完成）

1. 本段完整 SHA、父 SHA、分支、远端 tip（`ls-remote` 实测）。
2. `git diff --stat` 与 `git diff --name-only`，逐项对照允许文件。
3. 逐文件测试命令、工作目录、exit code、通过/失败计数；no-io guard 说明（不提交）。
4. 每个回归用例的适配器 create/query 计数、审计计数、`deepEqual`/允许写集结果。
5. 契约锚点逐项对照（§ 与行号，按契约 blob `94d61ed…`）。
6. 未验证/不可验证项与待裁项。
7. 声明“未合并、未部署、未开 HTTP/UI、未接真实支付/设备/业务云”。

## 7. 禁止项与冻结

- 本卡提交轮：**不实施、不运行测试、不改契约/生产代码/测试/Store、不安装依赖、不接真实支付/云/设备、不开 HTTP/UI**。
- 实施轮（获批准后）：不合并、不部署上线、不接 C2/C3、不改 HTTP/UI 接线、不跑真实商户、不使用真实证件、不写全局 Git 配置、不改既有契约。
- 全程禁止 `amend`/`rebase`/`reset`/`squash`/`force`/`cherry-pick`/合并；只允许普通追加提交与普通 push。
- 不定义第二次 create/新商户订单号；不放行“确认后重发”；人工重置/退款另案。

## 8. 待裁（阻塞相应阶段，不阻塞本卡文）

| # | 事项 | 阻塞阶段 | 说明 |
|---|---|---|---|
| 1 | 人工重置/退款流程 | S4（`failed` 人工处置）、S3（退款事实） | 契约 §9.1；本卡不放行重发 |
| 2 | 退款独立依据清单与审批 | S3/S4 | 契约 §9.2；未批准前不实现退款事实/不声称通过 |
| 3 | 隐私变化是否还需后台重审原材料 | S5/S6 | 契约 §9.3；本卡默认“审核可保留、同意独立” |
| 4 | 旧 settings/旧证件 `privacyVersion=0` 的迁移展示与升级窗口 | S6 | 契约 §9.4 |
| 5 | 两个新集合的部署/索引/权限与真实云验证 | S3/S5 | 契约 §9.5；离线只能验证 Store 层 |
| 6 | 商户 query 全部状态的真实语义 | S4 | 契约 §9.6；未验证不得声称线上通过 |
| 7 | prepay/签名 TTL 具体值 | S2/S4 | 契约 §9.7；S2 入口记录取值 |
| 8 | 已付订单退款操作规范 | S3/S4 | 契约 §9.8 |
| 9 | 确认后重发（新商户订单号） | 不授权 | 契约 §9.9；本卡明确不放行 |
| 10 | `privacyReviewStatus` 持久化时机（派生 vs 既有写事务） | S6 | 禁止读路径/失败路径写库；S6 入口确认 |

## 9. 未验证与不可验证（本卡）

- 本轮只新增卡文：未运行任何测试、未改代码/测试/Store、未安装依赖、未开 HTTP/UI、未接真实支付/云/设备。
- 契约行为逐条来自静态阅读；`domain.js`/`wechat-pay.js`/Store 行号均以基线 `3bf5951`（与父提交 `5d56dea` 运行时代码零 diff）为准。
- 离线只能验证 `LocalStore` 事务语义；真实云事务冲突/CAS/权限/索引/20000 条上限、真实商户 query 状态、真机与 HTTP 均不可验证。
- `/workspace/artifacts/C1-epoch-RENTAL-retry-review/DISPATCH.md` 不存在；不声称已读或已逐项关闭其内容。
- §8 未决项未裁定前，相应阶段不得实现或不得声称通过。

## 10. 当前停止点

本卡提交并普通 push 后即停手，交 Codex 独立复审；**不进入 S1、不自批、不合并、不部署、不开 HTTP/UI、不接真实支付/云/设备**。Codex PASS 本卡后才可按 §2 的依赖顺序启动 S1，且每段结束再次停手复审。
