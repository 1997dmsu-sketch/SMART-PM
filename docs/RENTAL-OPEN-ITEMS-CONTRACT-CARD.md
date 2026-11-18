# 预签约三项开放问题 · 技术裁定回写

- 日期：2026-11-18
- 执行者：DSH 根代理 `lead`（`deepseek-flash`），Windows PowerShell 5.1 / Node v24.19.0
- 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\rental-contract-decisions`
- 分支：`codex/rental-contract-decisions`
- 输入 SHA：`585e925af439b63df6a17b4a8bc3ca3ac93a0a79`
- 代码基线：`3bf595140088bc71a3939fb67880807965e9c566`
- 状态：**仅文档裁定回写；不实现、不改生产代码/测试/Store，待 Codex 批准后实施**
- 裁定来源：按本轮消息明确裁定；完整云报告不可读，本卡不声称已读附件
- 范围冻结：G3 已在 `5f1d7a4` 验收关闭、O10 PASS，不重复派发；G4/C2/C3、合并、HTTP/UI、部署/上线继续冻结

## 1. 已裁定摘要

| 开放项 | 最终裁定 |
|---|---|
| 同订单并发 `paymentParams` | **持久单飞**：事务内抢占；并发第二方 **409**；成功参数持久缓存并复用；不得以进程锁替代 |
| 未知支付结果 | **先查询对账，禁止直接重发**；覆盖超时、崩溃、租约过期、重试、旧单/新占位；外部 exactly-once 不作承诺 |
| 通知重放 | **重复通知零新增（含审计）**；同流水幂等、异流水冲突、非法/空流水拒绝；不丢弃已核验的真实到账事实 |
| 隐私说明版本 | **独立 privacyVersion**；旧数据不得自动视为已同意；隐私变化不丢真实到账事实；已付订单进入退款/人工处置；需重新同意 |
| 非隐私变更 | 押金/留房/合同模板文本等仅影响合同快照/`templateVersion`，**不**递增 privacyVersion，不强制重传 |

## 2. 当前代码事实（基线 3bf5951）

- `paymentParams` 无持久预支付状态/缓存：`cloudfunctions/leasing/domain.js:846-861`。
- `validatePayableOrder` 只读校验：`domain.js:815-843`。
- 空/重复流水：`typeof p.transaction_id !== "string"` 在 `domain.js:920`；幂等判断 `if (cur.transactionId)` 在 `domain.js:939`。
- `applyPayment` 到账事实/新占位：`domain.js:907-969`。
- `saveSettings` 每次保存递增 `templateVersion`：`domain.js:178-246`，递增在 `domain.js:239`。
- 上传绑定 `consentVersion: cfg.templateVersion`：`domain.js:523`。
- `quote` 只检查 `identityStatus === approved`：`domain.js:618-665`；`createOrder` 只检查审核/证件有效：`domain.js:666-780`。
- `paymentIdentityMatches` 不比较隐私版本：`domain.js:781-807`。
- `finishOrder` 已在 `domain.js:989-1013` 复核预约/材料/审核。
- 小程序上传发送 `privacyVersion: settings.templateVersion`：`miniprogram/pages/leasing/index.js:259`。

上述为静态代码事实；本轮未运行测试（按要求，无运行时代码变动）。

## 3. 裁定细则

### 3.1 同订单并发 paymentParams：持久单飞与缓存

#### 3.1.1 持久状态

每个订单保存一个持久支付请求状态（订单内嵌字段或专用记录，二者择一；不得仅用进程锁）。建议状态机：

| 状态 | 含义 | 关键字段 |
|---|---|---|
| `none` | 无请求 | 无 |
| `preparing` | 已抢占，准备调用商户 | `attemptId`、`leaseUntil`、`startedAt`、`previous` |
| `ready` | 商户参数已生成且绑定有效 | `params`、`expiresAt`、`attemptId` |
| `reconciling` | 商户结果未知，必须查询 | `attemptId`、`reason`、`lastCheckedAt`、`leaseUntil` |
| `failed` | 已查询确认无有效支付/预支付，可显式重试 | `reason`、`checkedAt` |

状态变更必须在 Store 事务内完成；`preparing` 抢占通过同订单记录的写冲突实现单飞。

#### 3.1.2 并发与缓存

1. 同订单同时只允许一个 `preparing`。
2. 第二并发调用：**409 PAYMENT_PARAMS_IN_PROGRESS**，不调用适配器、不写审计。
3. 已 `ready` 且在订单 `paymentDeadline` 前：直接返回缓存参数；adapter create **0 次**，不再生成。
4. `ready` 过期或订单过期：拒绝，不得返回旧参数。
5. 成功参数只对同一订单有效；材料/审核/隐私变化使订单失效时必须清除缓存。

#### 3.1.3 未知结果、超时、崩溃、重试

1. 适配器调用超时/5xx/连接中断等**结果未知**时，状态进入 `reconciling`；不得直接再次调用 create。
2. 下次 `paymentParams` 必须先向商户**查询对账**（同一 `out_trade_no`）：
   - 查询到 `SUCCESS`：按真实到账事实处理；若订单已失效，记 `refund_required`/人工退款待办；不得生成新 hold。
   - 查询确认无有效支付/预支付（且订单仍有效）：才允许进入 `failed` 后显式重试；每次重试仍可能调用外部一次。
   - 查询失败/仍未知：保持 `reconciling`，返回 503/409；不得直接重发。
3. 进程崩溃/租约过期：状态保持 `preparing`/`reconciling`；恢复后先查询对账，禁止在查询前重新 create。
4. 旧单/新占位：旧单到账记 `refund_required` 或人工退款待办，不夺取、不延长新 hold；重复通知不改变新占位。
5. 不承诺外部 exactly-once；本地单飞只保证同一订单同一时刻最多一个 create 调用，不保证商户侧唯一/不重复。

#### 3.1.4 事务、回滚、审计

- Claim refs：`rental_preleases`（订单）、`rental_room_holds`、`rental_appointments`、两份 `rental_identity_documents`、`rental_settings`（隐私版本）。
- 成功 complete refs 同上，写订单缓存 + 一条成功审计；失败回滚/清理 refs 同上，不写审计。
- 并发冲突由订单/占位写冲突决定；失败方不得写订单、hold 或 audit。
- 材料/审核/隐私在 `preparing` 中变化：complete 事务复核失败，不返回参数；订单失效，缓存清除；旧参数到账仍按真实事实处理。
- 适配器调用失败/未知：不得写成“已支付/已退款”；`reconciling` 是内部状态，不是支付事实。
- **全库零写边界**：预校验/并发 409/身份/隐私/流水校验失败零写（含 audit）；适配器未知需要持久 `reconciling` 的，作为单飞内部状态例外，必须在验收中单列，不计为业务支付事实；真实到账必须落事实。

#### 3.1.5 适配器计数

| 场景 | create 次数 | query 次数 |
|---|---:|---:|
| 两并发，第二在 preparing | 1 | 0 |
| ready 缓存复用 | 0 | 0 |
| 未知结果后首次对账 | 0（若仍未知）或 1（确认无有效支付后重试） | ≥1 |
| 成功首次生成 | 1 | 0 |
| 材料/隐私在 preparing 中变化 | 1 | 0（complete 拒绝） |

## 3.2 transaction_id 与重复通知

1. `transaction_id` 必须是非空字符串；建议格式 `^[A-Za-z0-9_-]{1,64}$`。空、空白、非法字符在进入事务前返回 409。
2. 同一订单、同一 `transaction_id` 重复通知：
   - 幂等成功；
   - 订单、hold、支付事实不变；
   - **零新增写入，包括 `admin_audit`**（已记录事实不重复记）。
3. 同一订单、不同 `transaction_id`：409 冲突；不得改订单/新占位；零写入。
4. 空/非法流水：409；全库（含 `admin_audit`）零写。
5. 旧订单/新占位：首次真实到账记 `refund_required` 或人工待办，**不能丢弃真实到账事实**；不写新 hold；重复通知零新增。
6. 首笔合法到账：按既有 `applyPayment` 语义写支付事实/必要审计；这是“真实外部事实例外”，即使订单状态失效也必须保留到账事实用于退款对账。
7. 真实商户通知仍需验签/解密；本轮只定服务层契约，不接真实支付。

## 3.3 隐私说明版本与材料审核绑定

### 3.3.1 独立版本

1. 新增独立 `privacyVersion`（整数）或隐私文本哈希；**仅 `privacyText` 变化时递增/变化**。
2. `templateVersion` 继续用于合同快照；押金、留房、模板文本等非隐私变化只影响 `templateVersion`，不得递增 `privacyVersion`。
3. 新上传证件记录 `privacyVersion`；`consentVersion` 仅作旧字段兼容，不再作为隐私版本判断依据。

### 3.3.2 旧数据：不得自动视为已同意

旧数据不采用 grandfather 自动放行：

1. 旧 settings 无 `privacyVersion`：读取为兼容基线，但不把旧证件视为已同意当前隐私说明。
2. 旧 identity 文档无 `privacyVersion`：标记为 `legacy_unverified`，在 `quote`、`createOrder`、`paymentParams`、`applyPayment`、`finishOrder`、`reviewAppointment` 中一律不满足隐私绑定；必须先重新阅读并同意当前说明、重新上传/审核。
3. 重新同意路径：用户看到当前 `privacyText` → 勾选同意 → 上传（绑定当前 `privacyVersion`）→ 后台审核 → 新 quote/新订单；旧审核不能复用。
4. 旧客户端发送 `templateVersion` 不视为隐私同意；服务端不静默放行，要求刷新/升级客户端。

### 3.3.3 隐私变化与真实到账

1. 隐私说明变化后，旧同意/审核立即失效；未付款订单建议按材料变更失效并释放 hold，清除预支付缓存。
2. **不得丢弃真实到账事实**：
   - 若隐私变化前/后已有真实支付到账，订单必须保留支付记录；
   - 已付款订单进入 `refund_required`/`privacy_review_required` 或既有异常到账处置，不能自动退款、不能自动改成已签约、不能夺取新占位；
   - 由物业在微信商户平台核对退款/人工处置，并对账。
3. 用户完成重新同意/新材料审核后，可创建新订单；旧已付订单仍走退款/人工处置，不自动恢复。
4. 非隐私变更（押金、留房、合同模板文本）：不递增 `privacyVersion`，不要求重新上传证件/同意；旧审核继续有效（合同金额/规则按订单快照）。

### 3.3.4 隐私绑定在各状态

`quote`、`createOrder`、`paymentParams`、`applyPayment`、`finishOrder`、`reviewAppointment` 均须校验当前 `privacyVersion` 与证件绑定；不一致返回 409，不写业务事实（真实到账除外）。小程序改为读取 `settings.privacyVersion`。

## 4. 验收矩阵

### 4.1 并发预支付

| 场景 | adapter create | 期望 |
|---|---:|---|
| 两并发，第一 preparing | 1 | 第一成功 ready；第二 409；无第二份创建 |
| ready 后再次调用 | 0 | 返回缓存参数；不重复审计 |
| 未知结果后直接重发 | 0 | 拒绝；必须先 query |
| 未知结果 query 确认无支付后重试 | 1 | 允许显式重试；记录 attempt |
| 崩溃/租约过期 | 0（恢复后先 query） | 不得直接 create |
| 材料/隐私在 preparing 中变化 | 1 | 不返回参数；订单失效；旧参数到账按事实 |

### 4.2 通知/流水

| 场景 | 写入 | 期望 |
|---|---|---|
| 空/空白/非法流水 | 零（含 audit） | 409 |
| 同流水重复 | 零（含 audit） | 幂等成功；订单/hold/事实不变 |
| 异流水 | 零（含 audit） | 409；hold 不变 |
| 首笔合法到账 | 支付事实 + 必要 audit | 保留真实事实 |
| 旧单/新占位到账 | 旧单真实事实 + refund/人工待办 | 新 hold 不变；重复零新增 |

### 4.3 隐私/审核

| 场景 | 期望 |
|---|---|
| 仅押金/留房/模板文本变更 | privacyVersion 不变；不重传、不重新同意 |
| privacyText 变化 | privacyVersion +1；旧同意/审核失效；quote/pay/finish/review 拒绝 |
| 旧证件无 privacyVersion | 不自动视为同意；必须重新同意/上传/审核 |
| 隐私变化时已到账 | 保留真实到账；refund_required/人工；不自动退款/不签约/不夺新 hold |
| 重新同意后 | 新上传/审核 → 新 quote/新订单；旧已付订单仍人工退款 |
| 小程序 | 使用 settings.privacyVersion；旧客户端不静默放行 |

### 4.4 零写/审计

| 场景 | 期望 |
|---|---|
| 预校验/身份/隐私/流水/并发 409 | 全库零写（含 audit） |
| 同流水重复 | 零新增（含 audit） |
| 适配器未知 | 允许内部 reconciling 状态（非支付事实）；不得直接重发 |
| 真实到账 | 必须落支付事实；这是外部事实例外 |
| 成功预支付 | 缓存 + 一条成功审计 |
| finish 失败 | 零写（含 audit） |

## 5. 实施文件范围

- `cloudfunctions/leasing/domain.js`：持久 payment request 状态/单飞/缓存/对账；`transaction_id` 严格校验/幂等；独立 privacyVersion 与各状态校验；`quote`/`createOrder`/`paymentParams`/`applyPayment`/`finishOrder`/`reviewAppointment` 绑定。
- `cloudfunctions/leasing/store.js`、`admin-web/lib/store.mjs`：仅在现有事务能力内补必需字段/状态；不在本卡实施。
- `miniprogram/pages/leasing/index.js`：读取 `settings.privacyVersion`；UI 重新同意/重传提示。
- `admin-web/public/leasing-ui.js`：隐私版本/旧数据重新同意提示（仅必要展示）。
- `admin-web/tests/leasing.test.mjs`、`tests/leasing.test.cjs`：新增并发/缓存/未知/重复/隐私/旧数据测试；不在本卡实施。
- `docs/RENTAL-PRESIGNING.md`：部署/验收说明更新；不在本卡实施。
- 禁止：部署、真实支付、HTTP/UI、设备、生产云、合并、G4/C2/C3。

## 6. 上线前待验证

1. 真实云 `runTransaction` 冲突/重试/权限/索引；崩溃后 lease/reconciling 恢复。
2. 真实微信商户 create/query/notify：超时、5xx、未知、重复、关闭、退款对账；确认锁语义。
3. 重复通知零新增（含 audit）与真实到账事实落库的数据库级验证。
4. 隐私版本迁移：旧 settings/旧证件/旧客户端；重新同意全链路。
5. 隐私变化时已付订单退款待办、旧/新 hold 隔离。
6. 微信开发者工具/真机 UI、管理员操作、合同/支付展示。
7. 小程序静态/真机验收、后台 HTTP 路由（本轮不运行监听测试）。
8. 全库零写断言在真实云事务下的可重复性；外部事实例外单独记录。

## 7. 本轮验证边界

- 本轮**未运行测试**（按用户要求，无运行时代码变动）；基线 3bf5951 的 22/55/56 结果和三项 probe 结果属于上一轮证据，仅供现状参考，不作为本轮新增验收。
- 未启动 HTTP 监听、未运行 `server.test.mjs`、未运行 `release:live`、未接真实支付/云/设备。
- 完整云报告不可读；本卡依据本轮明确裁定，不声称已读附件。
- 远端：本卡提交后需普通 push 到 `codex/rental-contract-decisions` 并 `ls-remote`；若远端已有且前移/分叉即停，不 force。

## 8. 停止点

- 本卡提交后交 Codex 批准；不进入实现，不改生产代码/测试/Store。
- 已裁定项不再重复派发；G3/O10 不重复；G4/C2/C3 继续冻结。
