# 预签约三项开放问题 · 契约澄清与修复卡

- 日期：2026-11-18
- 执行者：DSH 根代理 `lead`（`deepseek-flash`），Windows PowerShell 5.1 / Node v24.19.0
- 唯一工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\rental-open-items`
- 分支：`codex/rental-open-items`
- 基线 SHA：`3bf595140088bc71a3939fb67880807965e9c566`
- 工作树：clean；本卡提交前无生产代码改动
- 状态：**仅契约澄清/修复卡，不进入实现，交 Codex 批准**

## 1. 本轮结论

三项开放问题需要产品/契约裁定；本轮只给出建议裁定、兼容策略、验收矩阵和修复范围，不改生产代码。基线离线回归已通过：租赁 22/22、根 55/55、admin 非 HTTP 56/56。

| 项 | 当前基线行为（实测） | 结论 |
|---|---|---|
| 并发 paymentParams | 两个并发请求 adapter 调用 **2 次**，两个均 fulfilled；订单无 prepay 缓存字段 | 需持久幂等/单飞机制；外部 exactly-once 不可承诺 |
| 空 transaction_id / 重复通知 | 空流水首次 `paid_held`，同 payload 重放变 `refund_required`；两次均写审计 | 需严格非空校验 + 幂等/冲突区分 + 新占位保护 |
| 隐私说明/审核绑定 | 押金变更使 `templateVersion` 2，旧 `privacyVersion=1` 上传 409，但旧审核 quote 仍 ok；隐私文本变更后 quote/createOrder 仍 ok | 需独立 privacyVersion/hash；旧同意/审核失效；无关押金变更不得强制重传 |

## 2. 静态代码现状

- `paymentParams` 无持久预支付状态/缓存：`cloudfunctions/leasing/domain.js:846-861`；仅校验后直接调用适配器。
- `validatePayableOrder` 只读校验：`domain.js:815-843`。
- 空/重复流水：`typeof p.transaction_id !== "string"` 在 `domain.js:920`；幂等判断 `if (cur.transactionId)` 在 `domain.js:939`。
- `applyPayment` 到账事实/新占位：`domain.js:907-969`。
- `saveSettings` 每次保存递增 `templateVersion`：`domain.js:178-246`，递增在 `domain.js:239`。
- 上传绑定 `consentVersion: cfg.templateVersion`：`domain.js:523`。
- `quote` 只检查 `identityStatus === approved`：`domain.js:618-665`；`createOrder` 只检查审核/证件有效：`domain.js:666-780`。
- `paymentIdentityMatches` 不比较隐私版本：`domain.js:781-807`；`finishOrder` 只在 `domain.js:989-1013` 复核预约/材料/审核。
- 小程序上传发送 `privacyVersion: settings.templateVersion`：`miniprogram/pages/leasing/index.js:259`。

## 3. 契约裁定建议

以下为待 Codex/产品批准的**建议**；涉及外部商户/失败未知/旧数据的选择必须先裁定，不能由实现自行假定。

### 3.1 同订单并发 paymentParams

建议契约：

1. 每个订单保存**持久**支付请求状态（orders 内嵌字段或专用集合，需裁定）；不得使用进程内锁。
2. 状态机：
   - `none → preparing(token, leaseUntil, startedAt)`
   - `preparing → ready(params, expiresAt)`（适配器成功且绑定仍有效）
   - `preparing → failed/unknown(reason, at)`（适配器失败或结果未知）
   - `failed/unknown → preparing`（重试；每次重试仍可能调用外部一次）
3. 并发：
   - 同订单同时最多一个 `preparing`；第二个调用建议返回 `409 PAYMENT_PARAMS_IN_PROGRESS`，不调用适配器。
   - 已 `ready` 且在订单付款截止前：直接返回缓存的参数，adapter 0 次；不再新生成。
   - 缓存到期/订单过期：拒绝；不得返回旧参数。
4. 失败/未知：
   - 适配器超时、5xx 或结果未知时**不得声称外部 exactly-once**；不得把“本地失败”误报为“商户未创建”。
   - 建议保留 `unknown` 记录（含时间/原因/租约）以便重试与对账；是否允许该持久写入，需产品裁定。
   - 若验收要求“失败全库零写（含 audit）”严格包含适配器失败，则实现必须做补偿回滚并接受外部未知/可能重复；这会削弱对账，需裁定。
5. 材料变更：
   - 材料重传/审核退回使订单失效并清除预支付缓存；已发到客户端的旧参数到账仍按 `refund_required`，不得夺取新占位。
6. 适配器计数：首个成功请求 1 次；并发失败方 0 次；缓存命中 0 次；每次重试最多 1 次；不承诺跨进程/跨外部 exactly-once。

**必须裁定的点**：
- 并发第二方返回 409 还是等待并返回缓存（建议 409，缓存命中则 200）。
- 适配器失败/未知是否保留持久 `unknown` 标记；若要求字面全库零写，是否接受补偿回滚。
- 崩溃/租约过期后的重试与人工对账流程。

### 3.2 transaction_id 与通知重放

建议契约：

1. `transaction_id` 必须为非空字符串，建议格式 `^[A-Za-z0-9_-]{1,64}$`；空白/空串/非法字符在事务前返回 409。
2. 同一订单、同一 `transaction_id` 重复通知：幂等成功；订单/占位/到账事实不变；审计建议最多一条幂等记录（或零新增，需裁定）。
3. 同一订单、不同 `transaction_id`：409 冲突；不得改订单/新占位。
4. 空/非法流水：409；失败全库（含 `admin_audit`）零写。
5. 旧订单/新占位：到账记 `refund_required`，不写新 hold；重复通知不得延长/夺取占位。
6. 真实商户通知仍需验签/解密；本轮仅定义服务层契约，不接真实支付。

### 3.3 隐私说明版本与审核绑定

建议契约：

1. 独立 `privacyVersion`（整数，仅 `privacyText` 变化时 +1）或隐私文本哈希；`templateVersion` 继续用于合同快照，不因押金/留房/模板文本变化而改变 `privacyVersion`。
2. 新上传的证件文档记录 `privacyVersion`；`consentVersion` 保留兼容但不再作为隐私版本判断依据。
3. 旧数据兼容：
   - 旧 settings 无 `privacyVersion`：按基线 `privacyVersion=1` 读取，不批量迁移。
   - 旧证件无 `privacyVersion`：在 `privacyVersion=1` 时视为有效；首次隐私说明变化（版本 ≥2）后统一失效，要求重新上传/同意。
   - 这是建议迁移裁定；需 Codex 批准。
4. 无关押金变更：只递增 `templateVersion`，不递增 `privacyVersion`；旧审核继续有效，不强制重传。
5. 隐私说明变化：
   - `uploadIdentity` 必须使用新 `privacyVersion`；旧审核/旧同意不再满足 `quote`、`createOrder`、`paymentParams`、`applyPayment`、`finishOrder`、`reviewAppointment` 的身份绑定。
   - 未付款订单：建议按材料变更同等失效并释放 hold；已付款/已签约订单不能自动退款/改写，需人工退款/复核规则，**需产品裁定**。
6. 客户端：小程序 `privacyVersion` 改读 `settings.privacyVersion`；旧客户端发送 `templateVersion` 的兼容策略需裁定（建议要求刷新客户端，不静默放行）。
7. 兼容边界：旧证件在首次隐私变化前可用；之后必须重传，不得因押金变更误伤。

**必须裁定的点**：
- 旧数据基线 `privacyVersion=1` 的 grandfather 规则。
- 隐私变化时已付款/已签约订单的处理（仅阻断签约/人工退款/其他）。
- 旧客户端字段兼容窗口。

## 4. 验收矩阵（修复后必须满足/或按裁定）

### 4.1 并发预支付

| 场景 | adapter calls | 期望状态/DB |
|---|---:|---|
| 两并发，第一在 preparing | 1 | 第一成功 ready；第二 409 或缓存（按裁定）；无第二份调用 |
| ready 后再次调用 | 0 | 返回同一缓存参数 |
| 适配器失败/未知 | 1/次 | 返回错误；unknown/回滚按裁定；不得返回参数 |
| 材料/审核在 preparing 中变化 | 1 | 不返回参数；订单失效；旧缓存到账 refund_required |
| 成功生成 | 1 | 订单/缓存/审计一致；不声称外部 exactly-once |

### 4.2 通知/流水

| 场景 | 期望 |
|---|---|
| 空/空白/非法 transaction_id | 409；全库（含 audit）零写 |
| 同流水重复 | 幂等；订单/hold/支付事实不变；审计按裁定 |
| 不同流水 | 409；hold 不变 |
| 旧订单/新占位到账 | refund_required；新 hold 不变；不重复延长 |
| 正常到账 | 一次 paid_held/异常事实；成功审计保留 |

### 4.3 隐私/审核

| 场景 | 期望 |
|---|---|
| 仅押金/留房变更 | privacyVersion 不变；旧审核不重传 |
| privacyText 变化 | privacyVersion +1；旧证件/审核在 quote/create/pay/finish/review 均拒绝 |
| 旧数据无 privacyVersion | 基线 v1 可用；首次隐私变化后失效（待批准） |
| 新上传 | 绑定当前 privacyVersion；审核通过后才可 quote |
| 失效订单 | 未付款订单失效/释放 hold 按裁定；已付款按人工规则 |
| 无关模板文本变更 | templateVersion 变化，不要求重传 |

### 4.4 失败零写/审计

| 场景 | 期望 |
|---|---|
| 预校验/身份/隐私/txn 校验失败 | 全库零写（含 admin_audit） |
| 适配器失败/未知 | 按裁定：持久 unknown 或补偿回滚；不得谎报 |
| 成功 | 业务事实 + 成功审计；不重复 |
| 并发失败方 | 零写；不写失败审计 |

## 5. 修复范围与停止点

**建议实现范围（待批准后才做）**：
- `domain.js`：paymentParams 持久状态/缓存、transaction_id 严格校验、privacyVersion 与各状态校验。
- `store.js` / admin store：如采用订单内嵌状态，仅用现有事务；若需删除/保留字段或新集合，先提交设计裁定。
- `miniprogram/pages/leasing/index.js`：读取 `settings.privacyVersion`。
- 回归：`admin-web/tests/leasing.test.mjs` 增加并发/缓存/失败/隐私/流水测试；现有 22/55/56 基线保持。
- 不部署、不接真实支付、不启动 HTTP/UI、不操作设备/生产云。

**停止点**：本卡提交后交 Codex 批准；以下依赖未批准前不实现：
1. 并发第二方 409/缓存选择；
2. 适配器未知状态持久化 vs 字面全库零写；
3. 隐私变化的已付款订单处理；
4. 旧数据 grandfather/旧客户端兼容。

## 6. 本轮实测证据（只读，不改代码）

guard 路径：`C:\Users\Administrator\AppData\Local\Temp\dsh-NBuV68\smartpm-no-io.mjs`；自检通过，阻断 listen/socket/http/https/fetch。

| 命令 | exit | 结果 |
|---|---:|---|
| guard 自检 | 0 | `NO_IO_GUARD_SELFTEST_OK` |
| `node --import <guard> --test --test-isolation=none admin-web/tests/leasing.test.mjs` | 0 | 22/22 pass |
| `node --import <guard> --test --test-isolation=none tests/*.test.cjs` | 0 | 55/55 pass |
| `node --import <guard> --test --test-isolation=none`（6 个 admin 非 server 文件） | 0 | 56/56 pass |
| 三项合成契约 probe | 0 | 见下 |

Probe 实测（基线 3bf5951，LocalStore + mock payment）：

- `concurrent.paymentParams adapterCalls=2 fulfilled=2 rejected=0`，订单 `prepayField=null`。
- `empty.transaction first=paid_held replay=refund_required`；两次均写“核验微信支付”审计。
- `privacy.deposit-only templateVersion=2 uploadWithV1=409 quote=ok`。
- `privacy.text-change templateVersion=3 quote=ok:3 order=ok:awaiting_payment`。

排除：`admin-web/tests/server.test.mjs`（唯一含 `listen`/`fetch` 的测试文件，21 项）未运行；未运行 `release:live`；未启动任何 HTTP 监听。

## 7. 未验证

- 真实云 `runTransaction` 冲突/重试、权限、索引、跨进程崩溃与租约恢复。
- 真实微信商户 prepay/query/notify、真实证书/验签/解密、未知结果对账。
- HTTP 后台路由、微信开发者工具/真机 UI、部署与计时器。
- 远端分支核验：`git ls-remote` 因本机 HTTPS 凭据缺失失败（`SEC_E_NO_CREDENTIALS`）；本卡提交后普通推送/`ls-remote` 结果需以实际命令为准；若远端已存在且前移，按用户要求停止报告。
