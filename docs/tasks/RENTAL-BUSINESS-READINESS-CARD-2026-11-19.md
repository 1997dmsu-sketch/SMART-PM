# 预签约业务依赖与上线前配置卡（独立任务 F）

- 日期：2026-11-19
- 任务：F（独立任务；与 A/B/C 不互改，不覆盖退修实施卡）
- 执行者：DSH 根代理 `lead`（`deepseek-flash`）
- 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\rental-business-readiness`
- 分支：`docs/rental-business-readiness`
- 输入 SHA：`5d56dead460220d3409fa80bcaea8b1fa3a5c9a3`
- 本卡父提交：`bcacadbe6ada35c9cac17722fd054deafe341f82`
- 代码基线：`5d56dead460220d3409fa80bcaea8b1fa3a5c9a3`（与输入相同；本卡只做只读调查，不改实现）
- 状态：**仅准备 / 只读调查；未实现、未验收、未接商户、未上线；待 Codex 独立复审（不自批）**

## 0. 范围与冻结

- 本卡只回答：预签约（预约看房 → 身份证 → 合同 → 押金 → 留房）需要哪些业务依赖、上线前必须配置什么、哪些只能等真实商户实测。
- 不重验 G1 / G2 / G3 / O10 / G4 / 07B 离线门禁；main / 07B 合并与实施继续冻结。
- 不申请微信支付账户、不索取私钥、不收款、不退款、不收集/复制/上传身份证、不安装依赖、不跑业务测试、不接设备/生产云、不部署、不开 HTTP/UI。
- 本卡出现的 72 小时、15 分钟、30 天、90 天等时长均为**代码默认/示例 TTL，不是生产批准值**。
- 无证据处一律写“未知”，不写“已恢复/已验收/可上线”。

## 1. 输入与基线核验

| 项 | 实测值 | 方式 |
|---|---|---|
| 远端 main | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` | `git fetch origin --prune` 后 `git rev-parse origin/main`；`git ls-remote origin refs/heads/main` 一致 |
| 输入 SHA | `5d56dead460220d3409fa80bcaea8b1fa3a5c9a3` | `git rev-parse` |
| 目标分支 | `refs/heads/docs/rental-business-readiness` = 输入 SHA | `git rev-parse refs/heads/docs/rental-business-readiness` |
| 分支 upstream | 无（`fatal: no upstream configured`） | `git rev-parse --abbrev-ref --symbolic-full-name '@{u}'` |
| main 是否为输入祖先 | 是（`--is-ancestor` 退出码 0） | `git merge-base --is-ancestor origin/main <输入SHA>` |
| main 与输入差距 | 输入领先 main 10 个提交，main 没有输入之外的提交 | `git rev-list --left-right --count origin/main...<输入SHA>` → `0 10` |
| 工作树状态 | 干净（`## docs/rental-business-readiness`） | `git status --short --branch` |

说明：远端当前没有 `refs/heads/docs/rental-business-readiness`；该分支为本地新分支，首次推送时才在 GitHub 创建。上述 10 个提交均为 2026-11-16 至 11-18 的租赁文档提交（`RENTAL-PRESIGNING`、`RENTAL-OPEN-ITEMS-CONTRACT-CARD` 等），不是实现代码改动。

## 2. 合同模板实查（用户称“有模板”，实查结论：没有可用租赁模板）

### 2.1 仓库内

- 代码 `templateText` 默认为空字符串（`cloudfunctions/leasing/domain.js:44-53`），`templateVersion` 默认 0；`RENTAL-PRESIGNING.md:44` 明确“现阶段未收到你们的实际模板，产品没有放入虚构的示例合同，默认不启用预签约及证件收集”。
- 本分支 `docs/`、`design/`、`miniprogram/`、`admin-web/` 中**没有**住宅租赁合同模板文件；模板只能由后台“押金规则与自有合同模板”页粘贴纯文本或导入 UTF-8 `.txt`（`admin-web/public/leasing-ui.js:37`）。

### 2.2 工作区内的候选文档（只读查看，未复制敏感内容）

| 候选 | 版本（字节 / SHA-256） | 来源 | 摘要 | 占位符 | 缺项 / 结论 |
|---|---|---|---|---|---|
| `场地使用协议书-碳嘻【2026】085号（完善稿）.docx` | 48,568 B / `4ECA7958DFE1D3A976513F3480D325527753BA51EAA1E8091159BD8D3BB499E7` | `C:\Users\Administrator\Documents\ChatGPT\宇宙智联\` 根目录；同源文本见 `task_085\final_text.txt`（10,652 B / `D22BCB53DC457306347C349B376CFA2B7BDE1A095C4DE01145F54EC7290D88EE`） | 商业**场地（停车场）临时用地**使用协议；甲方为深圳公司、乙方为深圳公司；含面积、期限、每平方米单价、月费、2 个月保证金、付款账户、违约/终止/安全责任条款 | 面积（㎡）、单价、月费、大写金额、起止日期、签章日期、承诺人姓名/身份证号/电话 | 不是住宅租赁；无租客姓名、房号、月租、押金总额、留房时长、超时规则、身份证收集条款；含真实主体名称、统一社会信用代码、联系电话、银行账号（**本卡未复制**）。**不能直接作为预签约合同模板** |
| `产品服务模板_免费设备+年费.docx` | 61,168 B / `EEB5E35DE1FB40BB11CA5D9A8CEBDCF15D0C0B65C80239B01EAAD4CEF6E79383` | 同上根目录 | 产品服务方案模板（免费投放设备 + 年费），189 段 / 22 表 | 公司名称、设备、年费、账期等 | 与住宅租赁无关。**不可用** |
| 仓库模板槽位 | 空 | `domain.js` 默认值；`RENTAL-PRESIGNING.md:44` | 只有变量渲染机制，没有正文 | 见 2.3 | **缺实际模板正文、条款、法务审查** |

### 2.3 模板机制（代码事实）

- 支持变量：`{{tenantName}}`（预约联系人）、`{{roomLabel}}`（小区/楼栋/房号）、`{{monthlyRent}}`（元，2 位小数）、`{{deposit}}`（元，2 位小数）、`{{holdHours}}`、`{{expiryPolicy}}`、`{{appointmentId}}`（`domain.js:633-644`、`RENTAL-PRESIGNING.md:34-43`）。
- 启用前强制包含 5 个变量：`tenantName`、`roomLabel`、`deposit`、`holdHours`、`expiryPolicy`（`domain.js:210-219`）；未知变量会阻止启用（`domain.js:65-70`、`domain.js:220-228`）。
- 模板正文上限 40,000 字（`domain.js:200-202`）；每次保存都递增 `templateVersion`（`domain.js:236-240`），已确认订单保留快照，不能替换正文。
- 没有正文时：可预约看房，但 `quote` 返回 503（`domain.js:626`），不能生成可付款合同。

### 2.4 结论

- **实际住宅租赁合同模板：未知/未取得。** 用户所称“有模板”在本机工作区只能找到上述两份文档，均不是预签约住宅租赁模板；不能据此声称模板已具备。
- 需要业务方/法务提供正式模板正文，并明确甲方主体、租期、租金支付周期、押金退还条件、违约与交房条款；本卡不代拟条款、不裁定条款。

## 3. 押金：公式、单位、舍入、配置范围

### 3.1 公式与单位（代码事实）

- 公式：`押金(分) = Math.round(月租(分) × 押金月数) + 固定附加金额(分)`，见 `domain.js:42-43`。
- 月租来源：服务端按房源 `price`（元）× 100 取整为分（`domain.js:630`），不采信前端金额。
- 内部单位：**整数分**；`money()` 只接受 0–100,000,000 的整数分（即 0.00–1,000,000.00 元），见 `domain.js:34-38`。
- 展示单位：元、2 位小数（`(rent/100).toFixed(2)`、`(deposit/100).toFixed(2)`，`domain.js:636-637`）。
- 后台录入：固定附加金额以“元”输入、`Math.round(Number × 100)` 转分（`admin-web/public/leasing-ui.js:170`）。

### 3.2 舍入

- 使用 `Math.round` 对“月租分 × 月数”取整后再加分；`Math.round` 对正数是四舍五入（.5 向上）。
- 例：月租 ¥3,000.00（300,000 分）× 2 个月 = 600,000 分 = ¥6,000.00；再加固定附加金额。
- 该舍入只影响不足 1 分的尾差；是否允许“月租 × 0.5 个月”等小数月数由业务裁定（代码允许 0.1 步长）。

### 3.3 配置范围（后台保存校验，`domain.js:178-246`）

| 配置项 | 代码默认 | 允许范围 | 校验/单位 | 备注 |
|---|---|---|---|---|
| 押金月数 `depositMonths` | 2 | 0–12，最多 1 位小数 | `Number.isInteger(x*10)`；`domain.js:181-188` | 用户已知“默认两押”；最终值待业务确认 |
| 固定附加金额 `fixedDepositCents` | 0 分 | 0–100,000,000 分（¥0–¥1,000,000.00） | `money()`；`domain.js:189` | UI 以元输入、0.01 步长 |
| 留房小时数 `holdHours` | 72 | 1–720 小时 | 整数；`domain.js:190-196` | 72h = 暂定 3 天，非生产批准值 |
| 付款窗口 `paymentMinutes` | 15 分钟 | 固定 15，**后台不可配** | 只在 `defaults` 中；`saveSettings` 不读该字段 | 确认合同后 15 分钟付款窗口 |
| 留房到期处理 `expiryPolicy` | `non_refundable` | `non_refundable` / `manual_review` | `domain.js:197-199` | “超时不退”只是待裁，见 §5 |
| 合同模板 `templateText` | 空 | ≤ 40,000 字 | `domain.js:200-202` | 启用前必须有正文 |
| 证件收集说明 `privacyText` | 空 | ≤ 2,000 字 | `domain.js:203-205` | 启用前必须填写 |
| 启用开关 `enabled` | `false` | `true/false` | 启用前校验模板与说明 | `domain.js:206-208` |

补充：`deposit <= 0` 时 `quote` 返回 503“押金金额尚未配置”（`domain.js:632`），即 0 月 + 0 固定金额不能下单。

## 4. 时间规则：起算、截止、超时（未决表）

| 规则 | 代码现状 | 证据 | 是否生产批准 |
|---|---|---|---|
| 看房预约时间窗 | 未来 1 分钟至 90 天内 | `domain.js:312-319` | 未知（示例值） |
| 合同确认后付款窗口 | 订单创建时刻 + 15 分钟 | `domain.js:750` | 未知（固定 15 分钟，未配） |
| 未付款占位 | 创建订单即写 `hold.until = paymentDeadline`，状态 `payment_pending` | `domain.js:770-774` | 未知 |
| 留房起算 | 微信支付成功时间 `paidAt`（服务端验签后） | `domain.js:923`、`domain.js:948` | 未知 |
| 留房截止 | `paidAt + holdHours × 3600000`，默认 72h | `domain.js:948` | 未知（暂定 3 天） |
| 留房到期展示 | `paid_held` 且 `holdUntil <= now` → `expired_forfeited` / `expired_review` | `domain.js:403-407` | 未知 |
| 付款截止展示 | `awaiting_payment` 且 `paymentDeadline <= now` → `payment_expired` | `domain.js:408-410` | 未知 |
| 到期是否阻挡新订单 | 仅比较 `hold.until > now`；无定时任务主动释放 | `domain.js:280`、`domain.js:358` | 未知 |
| 身份证材料期限 | 上传时刻 + 30 天 | `domain.js:525` | 未知（示例值） |
| 到期清理 | 每日 03:00 云触发器 + 后台“清理到期证件” | `config.json` 触发器；`domain.js:1036-1063` | 未知（未在云端验证） |
| 取消/撤回预约 | **无取消接口**；只有后台审核动作 | `domain.js:1064-1083`（dispatch 无 cancel） | **待裁** |
| 取消超时时限 | **未定义** | 无代码/文档依据 | **待裁** |
| 预约拒绝是否释放占位 | 代码不释放（`reviewAppointment` 只改预约，不动 hold） | `domain.js:570-616` | **待裁/未知** |
| 未付款关闭释放占位 | 仅在支付查询返回 `CLOSED/REVOKED/PAYERROR` 时 `closeUnpaid` 释放 | `domain.js:876-877`、`domain.js:880-906` | 未知 |

**未决重点**：用户口述“留房暂定 3 天，超时不退只是待裁”。代码默认 `holdHours=72`、`expiryPolicy=non_refundable`，但这两项都不是业务已批准值；不能把默认值当成最终规则。

## 5. 押金规则待裁表（不擅定）

| 编号 | 待裁事项 | 代码现状 | 未知/冲突 | 需谁裁定 |
|---|---|---|---|---|
| D1 | 押金月数最终值 | 默认 2，可配 0–12（0.1 步） | “两押”是口述默认，非书面批准 | 业务/财务 |
| D2 | 固定附加金额最终值 | 默认 0 分 | 是否收取、收多少未知 | 业务/财务 |
| D3 | 留房时长最终值 | 默认 72h，可配 1–720h | “暂定 3 天” | 业务/法务 |
| D4 | 超时未签约是否不退 | 默认 `non_refundable` | 用户称“只是待裁” | 业务/法务 |
| D5 | 超时后物业审核流程 | 可选 `manual_review` | 审核人、时限、退款边界未知 | 物业/财务 |
| D6 | 押金退还条件 | 代码只区分“不退/审核”，无退还流程 | 退还触发、时限、扣减未知 | 业务/法务 |
| D7 | 月租小数月数是否允许 | 代码允许 0.1 月步长 | 是否允许“半个月押金”未知 | 业务/财务 |
| D8 | 金额尾差舍入规则 | `Math.round` 到分 | 与合同大写/开票口径是否一致未知 | 财务 |

## 6. 支付商户：前置材料、配置、门禁（不申请、不索取、不收款）

### 6.1 前置材料（由业务方自行在微信支付商户平台办理；本卡不代办）

- 微信支付**直连商户号**（`mchid`），并与实际小程序 AppID 绑定、开通 JSAPI 支付权限。
- 商户 API 证书（证书序列号 + RSA 私钥 PEM）。
- 微信支付平台证书序列号 / 平台公钥（用于验签）。
- 32 字节 APIv3 密钥（用于回调通知解密）。
- 已备案的 HTTPS 回调地址（云函数 HTTP 访问地址）。
- 对公结算账户与商户主体资料（营业执照、法人信息等，按微信支付要求）。
- 服务器时间同步（签名/回调有 5 分钟时间窗）。

### 6.2 代码门禁（`wechat-pay.js:15-34`、`domain.js:666-668`）

8 个变量全部存在且格式合法才创建支付适配器，否则 `payment=null`：

| 变量 | 校验 |
|---|---|
| `WX_PAY_APPID` | `^wx[0-9a-f]{16}$`，且与商户绑定 |
| `WX_PAY_MCHID` | `^\d{6,20}$` |
| `WX_PAY_SERIAL` | 商户证书序列号 |
| `WX_PAY_PRIVATE_KEY` | 商户 RSA 私钥 PEM |
| `WX_PAY_PLATFORM_SERIAL` | 平台证书序列号/公钥 ID |
| `WX_PAY_PLATFORM_PUBLIC_KEY` | 平台验签公钥 PEM |
| `WX_PAY_API_V3_KEY` | 32 字节 |
| `WX_PAY_NOTIFY_URL` | 必须 `https://` |

- 无商户时：`paymentReady=false`；小程序只能查看合同，`createOrder` 返回 503“微信支付商户尚未配置”（`domain.js:668`）；不生成模拟可付款凭据（`RENTAL-PRESIGNING.md:72`）。
- 固定域名 `api.mch.weixin.qq.com`；RSA-SHA256 签名；响应验签、序列号匹配、5 分钟时间窗；回调 AES-256-GCM 解密；失败关闭（`wechat-pay.js:59-114`、`wechat-pay.js:147-167`）。
- 平台证书轮换：代码**没有自动拉取**，由运维更新受控配置（`RENTAL-PRESIGNING.md:87`）。

### 6.3 门禁

- 后台 `/api/leasing*` 只允许 `admin` 角色（`admin-web/server.mjs:298-300`）。
- 云函数 HTTP 只接受可验签的支付通知；非 POST 或无支付适配器返回 500/失败关闭（`cloudfunctions/leasing/index.js:16-40`）。
- 不允许用“前端支付成功”或人工标记代替服务端核验（`RENTAL-PRESIGNING.md:89`）。

## 7. 退款、对账、部分退款、释放占位（只列待裁，不实现）

| 事项 | 代码现状 | 证据 | 状态 |
|---|---|---|---|
| 退款触发 | 仅在“已到账但订单不合格”时写 `refund_required`（超时付款、占位被替换、材料变更等） | `domain.js:943-955` | 已标记，未退款 |
| 退款方式 | 无自动退款 API；须在微信商户平台人工退款 | `RENTAL-PRESIGNING.md:26`、`:91` | 未知 |
| 退款依据 | 未定义清单；隐私变化明确不是退款依据 | `RENTAL-OPEN-ITEMS-CONTRACT-CARD.md` §9.2/§9.8 | **待裁** |
| 退款审批 | 未定义审批人/流程 | 同上 | **待裁** |
| 对账 | 未实现自动对账；异常到账需人工在商户平台核对 | `RENTAL-PRESIGNING.md:26` | **待裁/未知** |
| 部分退款 | 代码不支持；是否允许未知 | 无实现/无文档 | **待裁** |
| 退款后释放占位 | `applyPayment` 对不合格到账不写 hold；没有“退款后释放”路径 | `domain.js:956-968` | **待裁/未知** |
| 人工“改成已支付/已退款” | 明确没有入口 | `RENTAL-PRESIGNING.md:26` | 不提供 |

技术合同卡（`RENTAL-OPEN-ITEMS-CONTRACT-CARD.md` §9）已把“退款独立依据、审批、对账、hold 释放”列为另案；本卡只在业务侧列出待裁项，不替其裁定。

## 8. 身份证：字段、权限、期限、删除要求（不收集/不复制/不上传）

### 8.1 字段（云端文档 `rental_identity_documents`，`domain.js:515-526`）

| 字段 | 内容 |
|---|---|
| `ownerId` / `appointmentId` / `side` | 用户、预约、正面/反面 |
| `mime` | `image/png` 或 `image/jpeg` |
| `ciphertext` / `iv` / `tag` | AES-256-GCM 密文、随机 IV、认证标签（明文不落库） |
| `consentVersion` | 同意时的证件说明版本（= `templateVersion`） |
| `createdAt` / `expiresAt` | 上传时间、到期时间（+30 天） |
| `purgedAt` | 清理时间（清理后密文/IV/tag 置空） |

预约侧另有：联系人姓名、登录手机号（来自登录态，不采信客户端传入）、房号、看房时间、审核状态（`domain.js:307-383`）。

### 8.2 权限

- 上传：仅预约本人（`ownerId` 校验）；须先同意当前版本证件收集说明（`domain.js:439-445`）。
- 查阅：仅 `admin`（`identityFile` 先 `this.admin()`，`domain.js:539-543`）；每次查阅写审计“查阅证件 <id>”，审计不含图片/明文（`domain.js:562-567`）。
- 普通运营、只读账号不可查阅（`RENTAL-PRESIGNING.md:11`）。
- 小程序不把图片放入 storage 或 `Page.data`，上传后清临时文件（`RENTAL-PRESIGNING.md:50`）。

### 8.3 期限与删除要求

- 默认 30 天后不可查阅，按服务端时间判断（`domain.js:525`、`domain.js:541-543`）。
- 每日 03:00 `rental-retention` 触发器清理到期密文/IV/tag，保留最小清理审计；来源须为 `wx_trigger`（`config.json`、`index.js:43-50`）。
- 部署时必须核验触发器真实来源及运行成功，不能只凭配置文件宣称已删除（`RENTAL-PRESIGNING.md:52`）。
- 不支持在尚有材料时直接换密钥；须先制定恢复/轮换方案（`RENTAL-PRESIGNING.md:54`）。
- 本卡**没有**收集、复制或上传任何身份证图片/号码。

## 9. 离线配置 / 生产必填 / 商户实测（分列）

| # | 配置项 | 离线可准备（代码默认/本地） | 生产必填 | 商户实测 |
|---|---|---|---|---|
| 1 | 押金月数 | 默认 2；范围 0–12 | 业务确认值 | 按实际金额下单支付 |
| 2 | 固定附加金额 | 默认 0 分 | 业务确认值 | 同上 |
| 3 | 留房小时数 | 默认 72h（暂定 3 天） | 业务确认值 | 留房到期实测 |
| 4 | 付款窗口 | 固定 15 分钟 | 不可配 | 超时支付实测 |
| 5 | 到期处理 | 默认 `non_refundable` | 业务/法务确认 | 到期不退/审核实测 |
| 6 | 合同模板 | 空，需粘贴 | 实际模板 + 法务审查 | 合同展示/勾选实测 |
| 7 | 证件收集说明 | 空 | 物业填写主体/用途/查阅人/期限/删除渠道 | 授权/上传/查阅实测 |
| 8 | 身份证密钥 `RENTAL_IDENTITY_KEY_B64` | 未配置 | 32 字节 Base64，仅云函数/后台 | 上传/查阅/清理实测 |
| 9 | 微信支付 8 变量 | 未配置 | 商户开户后注入 | 全链路实测 |
| 10 | 回调 HTTPS 地址 | 无 | 已开通的云函数 HTTP 地址 | 通知验签/重试实测 |
| 11 | 5 个新集合 | 本地 store 已有 | 云端建空集合，客户端读写 false | 事务/并发实测 |
| 12 | 复合索引 | 无 | ownerId+_id 升序 | 查询实测 |
| 13 | `rental-retention` 触发器 | `config.json` 已声明 | 云端验证来源与执行成功 | 清理演练实测 |
| 14 | 房源/房号/户型关联 | 需准备 | `houses.propertyRoomId → rooms._id`、`rooms.layoutId → property_catalog` | 选房/下单实测 |
| 15 | 后台 admin 账号 | 本地可建 | 生产账号角色为 admin | 权限实测 |

## 10. 证据来源

| 文件 | 路径 | 基线 blob（5d56dea） | 大小 |
|---|---|---|---|
| 域逻辑 | `cloudfunctions/leasing/domain.js` | `5027c5a4e8b38e484e361b1ac3e72cf90985f662` | 35,878 B |
| 微信支付适配 | `cloudfunctions/leasing/wechat-pay.js` | `351a336ec1c4f6a767f3e6bf67906782796d1cfa` | 5,532 B |
| 云函数入口 | `cloudfunctions/leasing/index.js` | `cbf92dd44177dc688ca077936d84039d1e624951` | 2,671 B |
| 触发器配置 | `cloudfunctions/leasing/config.json` | `564450b4343f0c108ffca78979f26a9ee1d0b47a` | 205 B |
| 集合白名单 | `cloudfunctions/leasing/store.js` | `6b38e8ee949530c7bfe21cc670b9628c658c6650` | 3,305 B |
| 后台页面 | `admin-web/public/leasing-ui.js` | `0d1c9a1b310fb64d3a95508b9d14aa5f1c592b6e` | 10,840 B |
| 后台路由 | `admin-web/server.mjs` | `def2d929e98bbb959ec6a0f5de74e08a567aad81` | 24,826 B |
| 预签约说明 | `docs/RENTAL-PRESIGNING.md` | `4cc3150072ce7c7eec93d1d6436d42ea1b76607a` | 11,874 B |
| 开放项技术卡 | `docs/RENTAL-OPEN-ITEMS-CONTRACT-CARD.md` | `94d61ed1c3d44bdb02249aa96e10d57422d5225d` | 41,381 B |
| 材料变更修复 | `docs/RENTAL-IDENTITY-PAYMENT-REVIEW-FIX-2026-11-16.md` | `f6276f0963e076b3c8a001018dca3d643325a83c` | 3,994 B |
| 小程序页 | `miniprogram/pages/leasing/index.js` | `2a436a69adaa8cf0e7606b6203e4a81b69a2a3f7` | 11,094 B |
| 小程序模板 | `miniprogram/pages/leasing/index.wxml` | `925ed66da42cc99d40f4d2e7ec01a3a5cf41efc6` | 5,907 B |

## 11. 未验证 / 未知 / 停止点

- **未验证**：任何云端部署、集合权限、索引、触发器来源、密钥注入、真机、HTTP/UI、真实支付、退款、对账。
- **未知**：实际合同模板、业务批准的押金/留房/超时/退款规则、取消超时、部分退款、商户主体与开户状态、身份证保存期是否按 30 天。
- **停止点**：本卡在“业务裁定前”停止；不进入实现、不接商户、不收款、不部署、不宣称可上线。

## 12. 交给 Codex 的复审点

1. 本卡是否准确对应 `5d56dea` 的代码事实（行号、默认值、范围）。
2. 是否存在把代码默认值误写成业务批准值的地方（尤其 72h、2 个月、不退规则）。
3. 合同模板实查结论是否成立（仓库无、工作区候选不可用）。
4. 待裁表是否越权（是否替业务/法务做了决定）。
5. 身份证字段/权限/期限/删除描述是否与代码一致且未复制敏感内容。
6. 三列表（离线/生产/商户实测）是否有遗漏或错误合并。
