# 预签约三项开放问题 · 技术裁定回写（第四版）

- 日期：2026-11-18
- 执行者：DSH 根代理 `lead`（`deepseek-flash`），Windows PowerShell 5.1 / Node v24.19.0
- 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\rental-v4-review-fixes`
- 分支：`docs/rental-contract-v4-review-fixes`
- 输入分支：`codex/rental-contract-decisions`
- 输入 SHA：`95e438939e8d8812dbb9838ac2c4a6e7ac50db24`
- 本卡父提交：`95e438939e8d8812dbb9838ac2c4a6e7ac50db24`
- 代码基线：`3bf595140088bc71a3939fb67880807965e9c566`
- 状态：**仅卡文修订，不实现、不改生产代码/测试/Store；待 Codex 批准**
- 来源说明：完整云报告 `/workspace/artifacts/DEL-AI-01-CONTENT-REVIEW-2026-11-18/REVIEW.md` 在本机不可读；已检查 `/workspace`、`C:\workspace`、`D:\workspace` 及工作区目录，未找到可读副本。**不声称已读完整报告或已逐项关闭其内容**；本卡按本轮消息已明确的裁定修订，未明确处列入 §9。
- 范围冻结：G3 已在 `5f1d7a4` 关闭、O10 PASS，不重复派发；G4 执行、C1 实现、C2/C3、main/07B 合并、HTTP/UI、部署上线继续冻结。

## 1. 最终裁定摘要

| 项 | 最终裁定 |
|---|---|
| 同订单并发 paymentParams | **持久单飞**：订单内嵌 `paymentRequest`；事务 CAS + lease/epoch；并发第二方 409 `PAYMENT_PARAMS_IN_PROGRESS`；成功缓存复用 |
| 外部请求可能已发出后 complete 失败 | **保留待对账事实**；不得回滚为 `none` 或可重发 `failed`；旧 attempt 不得覆盖新 epoch |
| 未知支付结果 | **先 query 对账，禁止直接重发**；`NOTPAY`/`USERPAYING` 无缓存时保持待对账、不 create；人工重置/退款另案 |
| 支付请求失败 vs 订单终止 | 请求失败/未知**不自动终止有效订单、不释放有效自有 hold**；仅明确订单生命周期动作（取消/预约拒绝/未付款关闭/订单失效，以及存在明确已批准依据的退款）可释放；继续支付必须有有效自有 hold |
| 通知重放 | `transaction_id` 非空严格校验；跨订单唯一事实；**完整支付事实字段比对**；重复通知零新增（含 audit） |
| 缓存 prepay 与签名参数 | **分离**：`prepay` 标识与 `clientParams` 各自有效期；不得仅等于订单截止；签名过期本地重签，prepay 过期才失效 |
| 隐私 | 单一整数 `privacyVersion`；旧数据不自动同意；重新同意不强制重传；已付订单不强制重新下单/缴款；退款独立依据 |
| 非隐私变更 | 押金/留房/模板文本只影响 `templateVersion`/合同快照，不递增 privacyVersion，不重传/不重新同意 |

## 2. 当前代码事实（基线 3bf5951）

- `paymentParams` 无持久状态/缓存：`cloudfunctions/leasing/domain.js:846-861`。
- `validatePayableOrder` 只读校验：`domain.js:815-843`。
- 空/重复流水：`typeof p.transaction_id !== "string"` 在 `domain.js:920`；幂等判断 `if (cur.transactionId)` 在 `domain.js:939`。
- `applyPayment` 到账事实/新占位：`domain.js:907-969`。
- `saveSettings` 每次保存递增 `templateVersion`：`domain.js:178-246`，递增在 `domain.js:239`。
- 上传绑定 `consentVersion: cfg.templateVersion`：`domain.js:523`。
- `quote` 只检查 `identityStatus === approved`：`domain.js:618-665`；`createOrder` 只检查审核/证件有效：`domain.js:666-780`。
- `paymentIdentityMatches` 不比较隐私版本：`domain.js:781-807`。
- `finishOrder` 已在 `domain.js:989-1013` 复核预约/材料/审核。
- 小程序上传发送 `privacyVersion: settings.templateVersion`：`miniprogram/pages/leasing/index.js:259`。

本轮未运行测试（按要求；无运行时代码变动）。上述为静态代码事实。

## 3. 选定方案（单一方案）

| 对象 | 唯一方案 |
|---|---|
| 支付请求状态 | **订单内嵌 `paymentRequest` 字段**；不使用专用 payment-request 集合 |
| 跨订单流水事实 | **新增 `rental_payment_transactions` 集合**，`_id=transaction_id`；用于跨订单唯一性 |
| 隐私版本 | **单一整数 `privacyVersion`**；不采用哈希版本作为并列方案 |
| 同意记录 | **新增 `rental_identity_consents` 集合**；独立记录绑定原材料文档 |
| 实现载体 | 现有 Cloud/Local Store 事务；新增集合须加入 Store allowed set 并完成部署清单，不在本卡实施 |

## 4. 支付请求持久单飞

### 4.1 状态模型

订单字段 `paymentRequest`：

```
{
  status: "preparing" | "ready" | "reconciling" | "failed",
  attemptId, epoch, leaseUntil, startedAt, externalRequestSentAt,
  lastQueryAt, previous,
  prepay: {
    prepayId, createdAt, prepayExpiresAt
  } | null,
  clientParams: {
    timeStamp, nonceStr, package, signType, paySign,
    signedAt, signatureExpiresAt
  } | null
}
```

- `attemptId`：每次接管唯一。
- `epoch`：每次接管单调 +1；complete/reconcile 必须匹配 attemptId + epoch；**旧 attempt 不得覆盖新 epoch**。
- `leaseUntil`：preparing/reconciling 的租约；默认 60s，超时可被接管，但接管后必须先 query。
- `externalRequestSentAt`：调用商户 create 前写入；一旦非空，即视为“外部请求可能已发出”，不得回滚为 `none`。
- `prepay.prepayExpiresAt`：商户 prepay 自身有效期（由商户 TTL/配置决定），**不得直接设为订单支付截止**；实际支付还须订单/自有 hold 有效。
- `clientParams.signatureExpiresAt`：客户端签名参数自身有效期（如 5 分钟，按配置），**不得直接设为订单支付截止**；与 prepay 有效期分离。
- `previous`：仅在本地失败且确认外部请求从未发出时用于回退；外部请求发出后不得删除待对账事实。

所有状态变更使用订单/事务 CAS；不得使用进程内锁。

### 4.1.1 缓存命中规则

1. `prepay` 与 `clientParams` 分别校验：
   - `prepayExpiresAt > now` 且订单/自有 hold 有效；
   - `signatureExpiresAt > now`。
2. 两者均有效：返回缓存 `clientParams`，create 0 次，不重签。
3. `prepay` 有效但签名过期：**本地重签**（使用缓存 `prepayId` 重新生成 `clientParams`），create 0 次；更新签名时间。
4. `prepay` 过期：缓存失效；不得返回旧参数；订单/外部状态允许时才可进入新的持久单飞流程/对账。
5. 订单失效或自有 hold 失效：缓存不可用；不得 create；不得返回旧参数。
6. `clientParams.package` 内的 prepay 标识与 `prepay.prepayId` 必须一致；不一致按损坏缓存处理，不返回。

### 4.2 CAS 与并发

1. 同订单必须满足 `preparing` 只有一个有效 lease。
2. 第二并发调用：
   - 看到有效 `preparing`/`reconciling` lease：**409 `PAYMENT_PARAMS_IN_PROGRESS`**；不调用 create、不写 audit。
   - 看到有效 `ready`：返回缓存参数；create 0 次。
3. 接管 CAS：
   - 仅 `none`、`failed`、或 lease 已过期的 `preparing`/`reconciling` 可接管；
   - 接管写 `epoch+1`、新 `attemptId`、`status=reconciling`（若此前有外部请求）或 `preparing`（确认无外部请求）；
   - CAS 失败返回 409，不重试写入。
4. `ready` 过期或订单过期：拒绝；不得返回旧参数。
5. **自有 hold 是继续支付的硬条件**：`hold.orderId === order._id` 且 `hold.until > now`，否则不得 create/返回参数。
6. **支付请求失败/未知不自动终止有效订单、不释放有效自有 hold**；只有明确订单生命周期动作（取消、预约拒绝、未付款关闭、订单失效，以及存在明确已批准依据的退款，依据清单/审批见 §9.2）才释放 hold。置 `failed` 或保持 `reconciling` 都不是订单生命周期动作，不得借此释放 hold。请求失败后可继续用同一有效 hold 重试/对账。
7. 旧 attempt/epoch 的 complete/reconcile 写入必须失败；新 epoch 持有者不得被旧结果覆盖。

### 4.3 商户 query 全状态表

接管/未知后必须先 query；查询结果按以下表处理。**任何状态都不得盲目 create。**

| 商户 query 状态 | 处理 |
|---|---|
| `SUCCESS` | 校验 appid/mchid/金额/币种/payer/out_trade_no/transaction_id/时间；写真实支付事实；订单有效则按 eligible 留房/paid_held，订单失效/旧单则 `refund_required`；不得新 hold |
| `REFUND`/`REFUND_SUCCESS` | 写退款事实（明确已批准独立依据，§9.2）；仅按该已批准依据释放 hold；不得新 hold；保留原支付事实 |
| `NOTPAY` | 若有可复用 `ready` 参数则返回缓存；否则保持 `reconciling`，固定 **409 `PAYMENT_PARAMS_IN_PROGRESS`**，**不重发 create**；有效自有 hold 保留；人工重置/退款另案 |
| `USERPAYING` | 保持 `reconciling`；固定 **409 `PAYMENT_PARAMS_IN_PROGRESS`**；不重发；有效自有 hold 保留 |
| `CLOSED`/`REVOKED`/`PAYERROR` | 置 `failed`；订单仍有效才允许显式重试；不新增 hold；**已持有的有效自有 hold 保留，置 `failed` 不释放 hold** |
| `ORDER_NOT_EXIST` | 置 `failed`；订单仍有效才允许显式重试；不新增 hold；**已持有的有效自有 hold 保留，置 `failed` 不释放 hold** |
| query 超时/网络错误/未知状态码 | 保持 `reconciling`；固定 **503 `PAYMENT_QUERY_UNAVAILABLE`**；不重发；有效自有 hold 保留 |
| 其他未知 | 保持 `reconciling`；固定 **503 `PAYMENT_QUERY_UNAVAILABLE`**；不得当作未创建/已失败；有效自有 hold 保留 |

`NOTPAY`/`USERPAYING` 且无本地缓存参数时，保持 `reconciling`、不 create；人工重置和退款另案，不在本卡放行重发。

**HTTP 状态与错误码（每状态唯一预期，不得二选一）**：

| 类别 | 唯一状态码 | 适用状态 |
|---|---|---|
| 已知处理中/对账中 | **409 `PAYMENT_PARAMS_IN_PROGRESS`** | 有效 `preparing`/`reconciling` 单飞（含第二并发）；query 返回 `NOTPAY`/`USERPAYING` 且无可用缓存 |
| 查询不可用/结果未知 | **503 `PAYMENT_QUERY_UNAVAILABLE`** | query 超时、网络错误、未知状态码、其他未知状态 |

同一状态只返回上表中的一个固定状态码，不得为同一状态给出候选状态二选一；409 复用 §4.2 同一错误码，不新增第二套并发错误码。

### 4.4 未知/失败/超时转移表

| 当前 | 事件 | 下一状态 | 动作 |
|---|---|---|---|
| `none` | 首次请求且确认外部未发出 | `preparing(epoch+1)` | CAS 抢占；允许 create |
| `preparing` | create 成功且 complete 绑定仍有效 | `ready` | 保存 prepay/clientParams；一条成功审计 |
| `preparing` | create 调用后超时/5xx/中断/响应丢失 | `reconciling(epoch 保持)` | `externalRequestSentAt` 非空；保留待对账事实；不 create；不写 audit |
| `preparing` | create 成功但 complete CAS/lease/epoch/绑定失败 | `reconciling` | 外部可能已发出；保留 attempt 作为待对账事实；**禁止回滚 none/failed/可重发**；不返回参数；不写 audit |
| `preparing` | 旧 attempt/epoch 的完成回调 | 当前 epoch 不变 | 409/丢弃旧结果；**旧 attempt 不得覆盖新 epoch** |
| `preparing`/`reconciling` | lease 过期/进程崩溃 | `reconciling(epoch+1)` | 接管后先 query；禁止 create |
| `reconciling` | query `SUCCESS` | `ready` 后转支付事实 | 写事实；按订单状态留房/退款；不 create |
| `reconciling` | query `NOTPAY`/`USERPAYING` 且无缓存 | `reconciling` | 不 create；返回 409 `PAYMENT_PARAMS_IN_PROGRESS`；保留有效自有 hold；人工重置/退款另案 |
| `reconciling` | query `CLOSED/REVOKED/PAYERROR/ORDER_NOT_EXIST` | `failed` | 清除 prepay；不释放有效自有 hold；订单/自有 hold 有效才可显式重试 |
| `reconciling` | query 超时/未知 | `reconciling` | 不 create；返回 503 `PAYMENT_QUERY_UNAVAILABLE`；保留 lastQueryAt 与有效自有 hold |
| `failed` | 显式重试 | `preparing(epoch+1)` | 仅 query 确认外部无有效支付且订单/自有 hold 有效；每尝试最多一次 create |

**硬性不变量**：

1. `externalRequestSentAt` 非空后，不得回到 `none` 或可重发的 `failed`；只能 `reconciling`/`ready`/支付事实。
2. `failed` 只能在商户 query 明确无有效支付/无 prepay 后进入。
3. 任何 complete/reconcile 写入都带 attemptId+epoch 条件；旧 epoch 不得覆盖新 epoch。
4. 继续支付必须有有效自有 hold；请求失败/未知本身不自动终止有效订单、不释放有效自有 hold。只有明确订单生命周期动作（含已有明确已批准依据的退款）才释放 hold。

### 4.5 事务 refs、回滚、审计、外部事实

- 单飞 claim/complete/reconcile 事务 refs：`rental_preleases`、`rental_room_holds`、`rental_appointments`、两份 `rental_identity_documents`、`rental_settings`。
- 接管/完成必须校验 attemptId+epoch；旧 attempt 不得覆盖新状态。
- **外部请求已发出**（`externalRequestSentAt` 非空，含超时/响应丢失/complete 失败）：只能进入 `reconciling`，保留待对账事实；不得删除/回滚为 `none`/`failed`/可重发，不得把本地失败当商户未创建。
- 只有确认 create 从未发出时，才允许清除/恢复 `paymentRequest`；任何“外部可能已发出”的失败不得回滚。
- 成功：保存 `prepay` + `clientParams` + 一条成功审计。
- 支付请求失败/未知**不自动终止有效订单、不释放有效自有 hold**；hold 仅由明确订单生命周期动作（取消、拒绝、未付款关闭、订单失效，以及存在明确已批准依据的退款）释放；继续支付必须有有效自有 hold。
- 内部 `paymentRequest` 的 claim/lease/reconciling 写入是待对账状态，不是支付事实；验收矩阵单列，不伪装成“全库零写”。
- 真实支付事实是例外：即使订单失效也必须写入 `rental_payment_transactions`，用于退款对账。
- 外部 exactly-once 不承诺；本地单飞只保证同订单同一时刻最多一个 create。

## 5. 跨订单交易流水唯一性与通知

### 5.1 唯一事实记录

- 新集合 `rental_payment_transactions`，`_id = transaction_id`（或规范化的确定性 ID），包含：
  `transactionId/orderId/appointmentId/amount/currency/appid/mchid/payerOpenid/paidAt/tradeState/source/refundState/createdAt`。
- `applyPayment` 事务 refs 必须包含该事实文档：
  `rental_payment_transactions/<transaction_id>`、`rental_preleases/<orderId>`、`rental_room_holds/<roomId>`、`rental_appointments`、两份 identity docs、`rental_settings`、`admin_audit`。
- 同一 transaction_id 跨订单只允许一个事实文档；事务创建冲突即跨订单重复。
- 事实文档保存最小必要字段，不保存支付密钥/完整回调密文。

### 5.2 重复/冲突矩阵

| 场景 | 判断 | 写入 |
|---|---|---|
| 空/空白/非法 transaction_id | 事务前校验 | 零写（含 audit） |
| 同订单、同 transaction_id，完整事实一致 | 找到同订单同事实 | **零新增（含 audit）**；幂等成功 |
| 同订单、同 transaction_id，任一事实字段不一致 | 完整事实比对失败 | 409；零写（含 audit） |
| 同 transaction_id、不同订单 | 事实冲突 | 409；零写（含 audit） |
| 同订单、不同 transaction_id | 已有支付事实 | 409；零写（含 audit） |
| 首笔合法到账 | 无事实 | 写事实/订单/hold（如 eligible）/必要 audit |
| 旧单/新占位到账 | 旧单事实 + 新 hold | 写旧单 refund_required/人工待办；不写新 hold |
| 真实到账但订单已失效 | 事实异常 | 必须保留事实；refund_required/人工 |

**完整事实比对**：同一 `transaction_id` 的幂等比较至少覆盖
`orderId`、`appointmentId`、`amount.total`、`currency`、`appid`、`mchid`、`payerOpenid`、规范化后的 `success_time/paidAt`、`trade_state`。
全部一致才是幂等；任一不一致返回 409 且不覆盖事实、不写 audit、不移动 hold。

`transaction_id` 必须非空并符合 `^[A-Za-z0-9_-]{1,64}$`；不合法在事务前返回 409。

## 6. 隐私版本、同意与已付订单

### 6.1 privacyVersion（单一整数）

- 新 settings 初始 `privacyVersion=1`；旧 settings 缺字段按 `0` 读取但不自动同意。
- 仅 `privacyText` 内容变化时 `+1`；`templateVersion` 继续随任何设置保存递增用于合同快照。
- 押金、留房、合同模板文本、标题等非隐私变更：`privacyVersion` 不变；不重传、不重新同意。
- 新上传/同意记录写当前 `privacyVersion`。

### 6.2 独立同意记录 `rental_identity_consents`

- `_id = appointmentId + ":" + privacyVersion`；字段：
  `ownerId`、`appointmentId`、`privacyVersion`、`privacyTextHash`（证据）、`identityFrontId`、`identityBackId`、`frontDigest`、`backDigest`、`consentedAt`。
- **原材料绑定**：绑定现有证件 ID 与 ciphertext 摘要；不返回/不复制图片。
- `consentIdentity` 新 action：
  - 校验预约 owner、证件有效、当前 privacyVersion；
  - 直接为现有正反面创建同意记录；
  - **不要求重新上传仍有效的身份证**；
  - 不改变原材料审核状态；若证件已更换，必须重新上传/审核后再同意。
- 上传新材料时可在同一事务写新材料 + 当前版本同意记录；审核仍需绑定。
- `quote`/`createOrder`/`paymentParams`/`applyPayment`/`finishOrder`/`reviewAppointment` 必须同时满足：
  - 原材料审核绑定（documents/IDs/side/owner/expiry）；
  - 当前 privacyVersion 的同意记录绑定相同 front/back。

### 6.3 旧数据/旧客户端

- 旧证件无同意记录/无 privacyVersion：`legacy_unverified`，**不自动视为已同意**。
- 重新同意路径：
  1. 用户阅读当前 privacyText；
  2. 勾选同意；
  3. 若现有身份证仍有效 → 直接创建同意记录（不重传）；
  4. 若证件缺失/过期/被更换 → 重新上传/审核；
  5. quote/新订单/继续支付前校验同意 + 材料审核。
- 旧 settings 缺 privacyVersion：按 0 读取，旧数据不自动放行；显式同意后才可用。
- 旧客户端不得以 `templateVersion` 冒充隐私同意；服务端拒绝缺失/旧 privacyVersion，要求刷新客户端。
- 旧已付订单无同意记录：保留支付事实，进入 `privacyReviewStatus=consent_required`；重新同意绑定现有有效证件后恢复后续签约流程，不重新下单/缴款。

### 6.4 已付订单、隐私变化与退款

1. 有效已付订单（`paid_held` 或有效 hold）不得仅因隐私变化强制重新下单/缴款：
   - 订单状态、支付事实、hold 保留；
   - 独立字段 `privacyReviewStatus="consent_required"`；
   - `finishOrder` 在同意完成前拒绝；
   - 用户重新同意（绑定现有有效证件）后清除该标记，可继续原订单签约。
2. 支付事实/退款状态与隐私待复核分离：
   - 隐私变化不是退款依据；
   - 退款必须有独立依据（商户退款决定、重复/超额到账、超时到账等）并单独记录；
   - 不得因 privacyReviewStatus 自动写 refund_required；
   - 若真发生退款，写独立退款事实，仅按明确已批准依据（§9.2）释放 hold，保留原支付/退款事实。
3. 未付款订单（`awaiting_payment`）隐私变化：
   - 按材料变更失效并释放 hold、清除预支付缓存；
   - 用户重新同意后重新 quote/新订单；旧参数到账按真实事实处理。
4. 已付款但证件失效/过期：
   - 保留支付事实与 hold（如仍有效）；不得自动退款；
   - 需人工复核/重新上传；重新同意不能替代失效证件。
5. 隐私说明变化使旧同意失效；原材料审核在证件未变时可保留，不强制重传；若业务要求重新审核，须另行裁定（§9）。

### 6.5 客户端

小程序改为读取 `settings.privacyVersion`；提供“重新同意”入口并展示当前 privacyText；旧客户端不静默放行。

## 7. 验收矩阵

### 7.1 并发/接管/query

| 场景 | create | query | 期望 |
|---|---:|---:|---|
| 两并发，第一 preparing | 1 | 0 | 第一 ready；第二 409 `PAYMENT_PARAMS_IN_PROGRESS`；无第二份创建 |
| ready 后再调用（prepay+签名有效） | 0 | 0 | 返回缓存；不重复审计/不重签 |
| ready 但签名过期、prepay 有效 | 0 | 0 | 本地重签 clientParams；不 create |
| ready 但 prepay 过期 | 0 | 0/≥1 | 缓存失效；不得返回旧参数；按订单/外部状态处理 |
| 第二方在 ready 前重试 | 0 | 0 | 409 `PAYMENT_PARAMS_IN_PROGRESS`；不创建 |
| create 成功但 complete 失败（外部可能已发出） | 1 | 0 | 保留 reconciling/待对账；不回滚 none/failed；不返回参数 |
| 旧 epoch 完成回调 | 0 | 0 | 被拒绝/丢弃；不覆盖新 epoch |
| lease 过期后接管 | 0→按 query | ≥1 | 先 reconciling/query；不直接 create |
| create 超时/5xx | 1 | 0 | 进 reconciling；不返回参数；不写 audit |
| query NOTPAY/USERPAYING（无缓存） | 0 | ≥1 | 保持 reconciling；409 `PAYMENT_PARAMS_IN_PROGRESS`；不重发；有效自有 hold 保留；人工重置另案 |
| query CLOSED/REVOKED/PAYERROR/ORDER_NOT_EXIST | 0 | ≥1 | failed；不释放有效自有 hold；订单/自有 hold 有效才显式重试 |
| query 超时/网络错误/未知状态 | 0 | ≥1 | 保持 reconciling；503 `PAYMENT_QUERY_UNAVAILABLE`；不重发；有效自有 hold 保留 |
| query SUCCESS | 0 | 1 | 支付事实；按状态留房/refund；不新 hold |
| 继续支付但自有 hold 已释放/非本单 | 0 | 0 | 409；不得 create/返回旧参数 |
| 崩溃/lease 过期 | 0（先 query） | ≥1 | 禁止恢复即 create |

### 7.2 流水/重复通知

| 场景 | 写入 | 期望 |
|---|---|---|
| 空/非法 transaction_id | 零（含 audit） | 409 |
| 同订单同流水且完整事实一致 | 零（含 audit） | 幂等 |
| 同订单同流水但订单/金额/币种/商户/付款人等不一致 | 零（含 audit） | 409；不覆盖事实/不动 hold |
| 跨订单同流水 | 零（含 audit） | 409 |
| 同订单异流水 | 零（含 audit） | 409 |
| 首笔合法到账 | 事实 + 必要 audit | 保留真实事实 |
| 旧单/新占位到账 | 旧单事实/refund + 新 hold 不变 | 不夺取新占位 |

### 7.3 隐私/同意/已付

| 场景 | 期望 |
|---|---|
| 仅押金/留房/模板文本变化 | privacyVersion 不变；不重传/不重新同意 |
| privacyText 变化 | privacyVersion +1；旧同意失效；quote/pay/finish 需要新同意 |
| 旧证件/旧数据 | 不自动同意；可显式同意并绑定现有有效证件，不强制重传 |
| 已付有效订单隐私变化 | 保留支付/占位；privacyReviewStatus=consent_required；不重新下单/缴款；同意后可继续签约 |
| 已付订单退款 | 仅明确已批准独立依据（§9.2）；写退款事实；按该依据释放 hold；保留原支付事实 |
| 未付款隐私变化 | 失效/释放 hold/清预支付；重新同意后新订单 |
| 证件失效/更换 | 重新上传/审核；同意绑定新材料 |

### 7.4 零写/审计

| 场景 | 期望 |
|---|---|
| 预校验/CAS 409/身份/隐私/同意/流水失败 | 全库零写（含 audit） |
| 同流水重复/异流水/跨订单流水/完整事实不一致 | 零新增（含 audit） |
| 单飞 claim/lease/reconciling | 允许内部状态写入；不写业务支付事实/audit；不伪称全库零写 |
| 外部请求已发出但 complete 失败 | 保留 reconciling/待对账；不回滚、不 create、不写成功 audit |
| 成功 preparams | prepay/clientParams 缓存 + 一条成功审计 |
| 缓存命中（签名有效） | 不 create；成功审计按幂等策略不重复 |
| 缓存命中但签名过期 | 本地重签；不 create；不重复生成 prepay |
| 继续支付但自有 hold 失效 | 零写（含 audit）；409 |
| 真实支付事实 | 必须落 `rental_payment_transactions` + 订单事实；外部事实例外 |
| 退款 | 明确已批准独立依据 + 退款事实；不得由隐私自动触发 |
| finish 失败 | 零写（含 audit） |

## 8. 实施文件范围（待批准后才做）

- `cloudfunctions/leasing/domain.js`：paymentRequest CAS/lease/epoch/query；prepay/clientParams 分离；external complete failure→reconciling；transaction_id 严格校验；`rental_payment_transactions` 事实；privacyVersion/consent；各状态绑定；409 `PAYMENT_PARAMS_IN_PROGRESS` / 503 `PAYMENT_QUERY_UNAVAILABLE` 固定错误码。
- `cloudfunctions/leasing/wechat-pay.js`：缓存 prepayId 的本地重签（clientParams），不重新 create；真实商户调用仍走现有适配器。
- `cloudfunctions/leasing/store.js`：allowed collections 增加 `rental_payment_transactions`、`rental_identity_consents`；仅必要事务字段/选项。
- `admin-web/lib/store.mjs`：对应集合/事务能力。
- `miniprogram/pages/leasing/index.js`：privacyVersion/重新同意入口。
- `admin-web/public/leasing-ui.js`：隐私待复核/同意状态展示。
- `admin-web/tests/leasing.test.mjs`、`tests/leasing.test.cjs`：并发/query/流水唯一/跨订单/同意/已付订单/退款/零写测试。
- `docs/RENTAL-PRESIGNING.md`：部署清单（两个新集合、索引、权限、迁移）与验收。
- 禁止：部署、真实支付、HTTP/UI、设备、生产云、合并、G4/C2/C3。

## 9. 待裁/未解决（不阻塞卡文，阻塞实现）

1. **人工重置/退款流程另案**：无缓存 `NOTPAY`/`USERPAYING` 已裁定保持 `reconciling`、不 create；人工重置和退款不在本卡定义，另案处理。
2. **退款独立依据清单**：哪些非隐私原因可退款、谁审批、如何在商户平台对账；隐私变化明确不自动退款。
3. **隐私变化是否还需后台重新审核原材料**：本卡选择“原材料审核可保留、同意独立”，若业务要求重新审核需另行裁定。
4. **旧 settings/旧证件基线 `privacyVersion=0`** 的具体迁移展示与旧客户端强制升级窗口。
5. **两个新集合的部署/索引/权限**：`rental_payment_transactions`、`rental_identity_consents`；需真实云验证。
6. **商户 query 状态**：`NOTPAY`/`USERPAYING` 是否可能返回 prepay 信息、真实微信行为需上线前验证。
7. **prepay/签名有效期具体值**：provider prepay TTL 与签名的可配置 TTL 需在部署参数中确定；不得统一等于订单截止。
8. **已付订单退款操作规范**：独立依据、审批、对账与 hold 释放由物业/财务另行确认。

## 10. 上线前待验证清单

1. 真实云：`rental_payment_transactions`、`rental_identity_consents` 两集合的创建、权限（客户端读写 false）、索引、事务 CAS/唯一 `_id` 冲突、20,000 条限制与回滚。
2. 真实云崩溃/lease 过期：重启后先 `reconciling`/query；create 已发出但 complete 失败必须保留待对账，不得回滚 none/重发；旧 epoch 不得覆盖新 epoch。
3. 真实商户：create/query 的全部状态（含 `NOTPAY`、`USERPAYING`、`CLOSED`、`REVOKED`、`PAYERROR`、`ORDER_NOT_EXIST`、超时/未知）与时间窗口；确认微信查询语义。
4. 跨订单同 `transaction_id` 唯一事实：同一流水跨订单 409；同订单同流水完整事实（订单/金额/币种/商户/付款人等）一致才幂等，不一致 409 零写；真实通知重放/并发。
5. 无缓存 `NOTPAY`/`USERPAYING`：保持 `reconciling`、固定 409 `PAYMENT_PARAMS_IN_PROGRESS`、不 create、有效自有 hold 保留；人工重置/退款另案。
6. prepay 与 clientParams 独立有效期：prepay 过期不可用；签名过期本地重签；不得把二者简单设为订单截止；缓存命中/重签/失效路径。
7. 支付请求失败/未知不自动终止有效订单、不释放有效自有 hold；只有明确订单生命周期动作（含已批准退款）才释放；继续支付必须持有本订单有效 hold；409 `PAYMENT_PARAMS_IN_PROGRESS` / 503 `PAYMENT_QUERY_UNAVAILABLE` 固定错误码按 §4.3 验证。
8. 未知结果 query 后的重试/人工处置；不得直接重发；旧单与新占位隔离。
9. 隐私变化已付订单：保留支付事实与 hold、不强制重新下单/缴款、不自动退款；独立退款依据与退款事实/占位释放。
10. 非隐私变更（押金/留房/模板文本）不递增 privacyVersion、不触发重传/重新同意。
11. 旧客户端强制升级/字段拒绝；小程序 `settings.privacyVersion` 与重新同意 UI；管理员待复核/退款展示。
12. 全库零写矩阵在真实云事务下的可重复性；单飞内部状态、真实支付事实、退款事实三类分别记录。
13. 适配器 create/query 次数、审计/IP 可观测性与告警；不声称外部 exactly-once。
14. 后台 HTTP/UI、真机、部署与上线另走冻结门禁；本卡不执行。

## 11. 验收/证据与边界

- 本轮只改文档（唯一文件 `docs/RENTAL-OPEN-ITEMS-CONTRACT-CARD.md`）：未运行测试、未安装依赖、未改生产/测试/Store、未启动 HTTP/UI、未接真实支付/云/设备。
- 完整云报告不可读：已检查 `/workspace`、`C:\workspace`、`D:\workspace` 及工作区，未找到可读副本；不声称已读或已关闭完整报告。
- 输入固定 SHA：`95e438939e8d8812dbb9838ac2c4a6e7ac50db24`；fetch 后 `refs/remotes/origin/codex/rental-contract-decisions` 与输入 `HEAD` 一致（0/0，无前移/分叉），`git ls-remote` 实测远端 tip 同为 `95e438939e8d8812dbb9838ac2c4a6e7ac50db24`。输出分支 `docs/rental-contract-v4-review-fixes` 提交后普通 push，最终 ls-remote/GitHub 固定 SHA 文件链接以推送后实测为准。
- G3/O10 不重复；G4 执行、C1 实现、C2/C3、main/07B、HTTP/UI、部署上线冻结。

## 12. 停止点

- 本卡提交后交 Codex 批准；不进入实现。
- 已明确裁定按本卡执行；§9 未决项需产品/Codex 裁定后才实现。
