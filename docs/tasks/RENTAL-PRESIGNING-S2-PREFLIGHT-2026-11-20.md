# 预签约 S2 缓存签名前置核对（preflight · 离线 · Codex 前置核对通过 · 裁定回写）

- 日期：2026-11-20（Asia/Shanghai）
- 执行者：DSH 根代理 `lead`（`deepseek-flash`）；Windows PowerShell 5.1.19041.1 / Git `2.55.0.windows.3` / Node `v24.19.0`
- 执行 run：`RENTAL-S2-RULING-WRITEBACK-2026-11-20T1221+0800`（DSH `session-d5a86fa3-87bb-4f39-8ec3-0965e6c0d7be`；本轮实测 `2026-11-20T12:21:50+08:00`；初版 run `RENTAL-S2-PREFLIGHT-2026-11-20T1210+0800`）
- 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\rental-s2-preflight`（独立工作树，唯一）
- 分支：`codex/rental-s2-preflight`
- 固定起点：`0b23213eff97fcc98f85e7544cf883c3b68027b5`（父：`95ac52e90d0bc9ead7a9ca53610f148cec42a487`）
- 本轮续作固定输入：`debcc7b50a5ef0a80378bce5924cb4f68192d3f3`（本文件 v1；父 `0b23213eff97fcc98f85e7544cf883c3b68027b5`）；初始输入：已批准 S1 清单 `e4e1008e5a8df67e872429fc2b50655f772862cf`、原分阶段任务卡 `8a2f8d9172544decd5def108ca689988ec92bf8f`、已批准契约 `5d56dead460220d3409fa80bcaea8b1fa3a5c9a3`、代码基线 `3bf595140088bc71a3939fb67880807965e9c566`
- 本文件唯一改动：`docs/tasks/RENTAL-PRESIGNING-S2-PREFLIGHT-2026-11-20.md`（修改）
- 状态：**Codex 前置核对已通过；本轮按其 2026-11-20 边界裁定回写；S2 实施条件未齐，不实施 S2–S6；待 Codex 实施前独立复审/批准（不自批）。**
- 关键写集口径：**S2-7/S2-8 固定 `W0`（503/W0/create=query=0）；`WP-close` 不再采用**（裁定 2）。
- 结论口径：S2 不调用真实 query（query 属 S4，裁定 1）；缓存过期/损坏/缺有效期证明统一 **503/W0/create=query=0**（裁定 2）；合法本地重签只改 `clientParams` 且必须 CAS（裁定 3）；根租赁测试保持零差异（裁定 4）；TTL/供应商语义继续待定、禁止占位值启动 S2、不重复供应商派单（裁定 5）。

> 本 preflight 只引用已批准契约、任务卡与 S1 清单的结论，**不重复批准、不重推 T1–T13、不改写裁定**。本文件自身不是契约、不是批准、不是 S2 任务卡。

## 0. 输入、远端、父链与工作树核对（本轮实测）

| 项 | 实测值 | 核验方式 | exit |
|---|---|---|---|
| 固定起点 | `0b23213eff97fcc98f85e7544cf883c3b68027b5` | `git rev-parse 0b23213^{commit}` | 0 |
| 固定起点父提交 | `95ac52e90d0bc9ead7a9ca53610f148cec42a487` | `git log -1 --format=%P 0b23213` | 0 |
| S1 清单可达 | `e4e1008` 是 `0b23213` 的祖先 | `git merge-base --is-ancestor e4e1008 0b23213` | 0 |
| 父链（自固定起点向根） | `0b23213 → 95ac52e → e4e1008 → 8959890 → a080cdd → 4595757 → 8a2f8d9 → 4a30e6e → … → 5d56dea → …` | `git log --oneline 0b23213` | 0 |
| 远端 `feat/rental-s1-persistent-single-flight` | `0b23213eff97fcc98f85e7544cf883c3b68027b5` | fetch 后 `git ls-remote --heads origin` | 0 |
| 远端 `docs/rental-s1-authorization` | `e4e1008e5a8df67e872429fc2b50655f772862cf` | 同上 | 0 |
| 远端 `docs/rental-staged-implementation-task` | `8a2f8d9172544decd5def108ca689988ec92bf8f` | 同上 | 0 |
| 远端 `docs/rental-query-retry-contract` | `5d56dead460220d3409fa80bcaea8b1fa3a5c9a3` | 同上 | 0 |
| 前移/分叉 | 无；四个固定远端 tip 与固定对象逐一相等 | 上述 `ls-remote` 对比 | 0 |
| 本轮续作固定输入 | `debcc7b50a5ef0a80378bce5924cb4f68192d3f3`（本文件 v1） | `git rev-parse HEAD` | 0 |
| 目标分支远端 tip | `debcc7b50a5ef0a80378bce5924cb4f68192d3f3` | `git ls-remote origin refs/heads/codex/rental-s2-preflight` | 0 |
| 目标分支前移/分叉 | 无；本地 HEAD = 远端 tip = `debcc7b` | 同上 + `git status` | 0 |
| 契约 blob / 行数 | `94d61ed1c3d44bdb02249aa96e10d57422d5225d` / 427 | `git rev-parse 0b23213:docs/RENTAL-OPEN-ITEMS-CONTRACT-CARD.md` + 行数 | 0 |
| 任务卡 blob / 行数 | `eb6748a86df5a54ea08fd0162b191a16370ee238` / 653 | 同上 | 0 |
| S1 清单 blob / 行数 | `bbdb1cad2a84a9956d65775bb6121952c54fcadf` / 476 | 同上 | 0 |
| S1 实施 diff `e4e1008..0b23213` | 仅 4 个文件：`domain.js`、两份租赁测试、`tests/rental-network-guard.cjs`（新增） | `git diff --name-status` | 0 |
| 生产/Store diff `3bf5951..0b23213` | 仅 `cloudfunctions/leasing/domain.js`；`wechat-pay.js`/`index.js`/两份 Store 零 diff | `git diff --name-status -- cloudfunctions admin-web/lib admin-web/public miniprogram` | 0 |
| 工作树 | 干净；分支 `codex/rental-s2-preflight`；无上游 | `git status --porcelain=v1 -b`；`git rev-parse @{u}`（预期失败） | 0 / 128 |
| 同目标运行/排队任务 | 无其他同目标；本任务自身分支/工作树唯一；DSH 定时任务/后台作业/子代理均无同目标 | `git branch -a`、`git worktree list`、全 refs 检索、`schedule_list`、`job_list`、`list_agents` | 0 |

- fetch 记录（不掩盖）：首次 `git fetch --prune origin` 在本会话工作区沙箱下 exit `255`（共享 `.git` 目录写权限被拒绝）；放开为完整文件权限后同一命令 exit `0`。远端事实最终以 `git ls-remote`（网络权威）为准，未使用 TLS 绕过、未改全局 Git 配置。
- 远端若前移/分叉：先报告、**不替换固定对象**；本轮实测未前移、未分叉。
- 本轮未使用任何云评审材料正文；本机未取得可读副本的材料不声称已读、不声称已闭合。

### 0.1 本轮边界裁定（2026-11-20，已生效，不再列待裁）

| # | 裁定 | 落点 |
|---|---|---|
| 1 | S2 不调用真实 query；query 属 S4 | §3.1、§3.2、§4.2、§10.2、§11.2 |
| 2 | 缓存过期/损坏/缺有效期证明：唯一预期 503 `PAYMENT_QUERY_UNAVAILABLE`、W0、create/query 均 0 | §4.2、§4.5、§5.2、§7.1、§8 F7、§10、§10.1 |
| 3 | 合法本地重签只修改客户端签名参数；必须 CAS 防止覆盖并发新状态；旧状态失去所有权不得覆盖 | §6.2、§6.4、§8 F3/F14、§10.1 S2-2/S2-5 |
| 4 | 根租赁测试未受影响，可保持零差异；不凑文件数 | §9.1、§9.2、§11.3 |
| 5 | 供应商有效期、签名缓存期限、适配器约定尚未确定；TTL/供应商语义继续待定；禁止占位值启动 S2；不重复供应商派单 | §4.3、§4.4、§13.2、§14 |

- 以上 5 项已生效；原 R0/R1/R4/R5/R8 与 M8/M12 由上述裁定闭合，不再列待裁。
- 其余未知保留：R2/R3/R6/R7/R9/R10/R11、M1–M7/M9–M11、P1–P8；不自行补充业务或供应商语义。

## 1. 本文件地位、范围与冻结边界

### 1.1 本文件只做前置核对

| 做 | 不做 |
|---|---|
| 核对 S2 的缓存有效期、prepay 标识、客户端签名重签边界 | 不实施 S2、S3、S4、S5、S6 |
| 列出 S2 必须保留的 S1 行为与受影响 S1 断言 | 不改代码/测试/Store/契约/任务卡/S1 清单 |
| 列出白名单、依赖、逐例预期、guard 与停止点 | 不运行 `node --test`/`npm test`/任何实施测试 |
| 标出需支付供应商/业务确认的 TTL 与参数语义、不可凭空设值的缺项 | 不编造 TTL 数值、不编造微信支付适配器语义 |
| 停手交 Codex 独立复审 | 不自批、不合并、不部署、不开 HTTP/UI、不接真实支付/设备/业务云/凭据 |

### 1.2 不重复验收、不重推裁定

- G1/G2/G3/O10/G4/07B 门禁**不重复验收**；本文件不引用、不代替任何既有门禁结论。
- T1–T13 由任务卡 §13 回写，本文件只引用结论，**不重推、不重列、不改写**。
- 本文件不重复批准 S1；S1 实现固定为 `0b23213`，其复审结论由 S2 授权文件引用，本轮不重复验收、不声称 S1 PASS。
- Codex 前置核对已通过（本轮输入）；本轮回写 5 项边界裁定（§0.1），但仍**不构成 S2 实施授权**。
- 本文件不重复 A 轮内容；不重派 C/D/G 等既有工作。

### 1.3 全程冻结

- S2–S6 冻结；契约、任务卡、S1 清单、`docs/RENTAL-PRESIGNING.md` 冻结；`index.js` 与 S2 白名单内 `wechat-pay.js` 局部重签能力之外的支付面冻结；小程序/后台 UI 冻结。
- 不合并、不部署上线、不开 HTTP/UI、不接真实支付/C2/C3、不连设备/业务云、不安装依赖、不读写凭据或真实身份证、不处置风险。
- 真实商户/供应商 TTL 与参数语义的跟进是**另线**：本任务不派发、不联系、不接真实支付。

## 2. 批准来源与固定起点代码事实

### 2.1 引用来源（只引用，不重复审批）

| 来源 | 固定对象 | 本文件引用部分 | 链接 |
|---|---|---|---|
| 已批准契约（第五版） | `5d56dea`；blob `94d61ed`；427 行 | §4.1、§4.1.1、§4.5、§7.1、§9.7 | [契约卡](https://github.com/1997dmsu-sketch/SMART-PM/blob/5d56dead460220d3409fa80bcaea8b1fa3a5c9a3/docs/RENTAL-OPEN-ITEMS-CONTRACT-CARD.md) |
| 已批准原分阶段任务卡（v5） | `8a2f8d9`；blob `eb6748a`；653 行 | §2、§3.4、§3.11、§4.2、§5、§6、§10、§13 | [任务卡](https://github.com/1997dmsu-sketch/SMART-PM/blob/8a2f8d9172544decd5def108ca689988ec92bf8f/docs/tasks/RENTAL-PRESIGNING-STAGED-IMPLEMENTATION-TASK-2026-11-18.md) |
| 已批准 S1 清单 | `e4e1008`；在 `0b23213` 的 blob `bbdb1ca`；476 行 | §1.2、§3.1、§4、§8、§10 | [S1 清单](https://github.com/1997dmsu-sketch/SMART-PM/blob/e4e1008e5a8df67e872429fc2b50655f772862cf/docs/tasks/RENTAL-PRESIGNING-S1-AUTHORIZATION-2026-11-19.md) |
| S1 实现固定输入 | `0b23213` | 代码/测试现状 | [S1 实现](https://github.com/1997dmsu-sketch/SMART-PM/commit/0b23213eff97fcc98f85e7544cf883c3b68027b5) |
| 代码基线（原卡行号基准） | `3bf5951` | 原卡 §2/§4.2 的行号来源 | [基线](https://github.com/1997dmsu-sketch/SMART-PM/commit/3bf595140088bc71a3939fb67880807965e9c566) |

行号说明：原任务卡 §4.2 的“当前事实”行号以 `3bf5951` 为基准；本文件一律以固定起点 `0b23213` 的实际行号为准，**仅校正引用位置，不改变任何语义或裁定**。

### 2.2 固定起点 `0b23213` 的代码事实（静态阅读）

| 事实 | 位置/值 |
|---|---|
| `paymentParams` 入口 | `cloudfunctions/leasing/domain.js:1087-1139` |
| `ready` 命中固定 503（S1 无 TTL，不能证明缓存有效） | `domain.js:1101-1103`；`queryUnavailable()` 在 `domain.js:53-54` |
| claim（本地校验 + CAS + lease + sent 单事务） | `domain.js:880-948` |
| complete（attemptId+epoch CAS；ready 写 prepay/clientParams + 1 审计；失败/未知 reconciling） | `domain.js:1007-1086` |
| `prepay` 写入形状 | `domain.js:1048`：`{ prepayId, createdAt }` |
| `clientParams` 写入 | `domain.js:1049`：适配器返回原样 `params` |
| 状态枚举/lease/错误 helper | `domain.js:42-56`；`PAYMENT_LEASE_MS = 60000`（`domain.js:43`） |
| 订单支付截止 | `createOrder`：`paymentDeadline = now + cfg.paymentMinutes * 60000`（`domain.js:767`）；默认 `paymentMinutes=15`（`domain.js:65`）；`hold.until = paymentDeadline`（`domain.js:789`） |
| 微信适配器 `create` | `cloudfunctions/leasing/wechat-pay.js:119-141`：一次完成下单与签名；`time_expire` 取 `order.paymentDeadline`（`:125`）；只校验 `prepay_id` 为字符串（`:130`）；`package = "prepay_id=" + prepay_id`，`signType: "RSA"`，`paySign = sign(appid\n timeStamp\n nonceStr\n pkg\n)`（`:131-140`） |
| 本地签名函数 | `wechat-pay.js:35-39`：闭包内 `sign`，当前不对外暴露 |
| `wechat-pay.js` 与基线 | `3bf5951..0b23213` 零 diff（S1 未改支付适配器） |
| S2 字段/TTL 现状 | 代码中无 `prepayExpiresAt`/`signatureExpiresAt`；仓库仅在契约/任务卡/S1 清单文字中出现。订单另有 `signedAt`（`domain.js:1299`，正式签约时间），与 `clientParams.signedAt` 同名词义不同，S2 不得混用 |
| S1 相关测试 | `S1-3`：`admin-web/tests/leasing.test.mjs:988-1028`；`S1-15`：`:1403-1421`；`S1-1`：`:1030-1074`；`S1-4`：`:1101-1132` |

## 3. S2 的范围、依赖与入口条件（引用原卡，不重复审批）

### 3.1 S2 是什么

- 任务卡 §2：S2 = **缓存签名（prepay 与 clientParams 分离）**；执行序 2；前置 S1；契约锚点 §4.1.1、§4.5、§7.1；主文件 `domain.js`、`wechat-pay.js`；测试侧只改 `admin-web/tests/leasing.test.mjs`，根租赁测试零差异（裁定 4）。
- 任务卡 §4.2：S2 必须实现 TTL 分离、缓存命中、本地重签、prepay 过期/损坏缓存的失败关闭、缓存不可用时的 409、并发重签、永不因缓存问题回退 create。
- 任务卡 §3.4：S1/S2 已实现但尚需真实 query 的路径固定 **503 `PAYMENT_QUERY_UNAVAILABLE`**，create 0、query 0；真实 query 结果留 S4。**本轮裁定 1 明确：S2 不调用真实 query；query 属 S4。**
- 任务卡 §3.11：S2 自有过渡路径仅两行——hold/order 失效 → 409（现有）W0；prepay 过期/损坏缓存 → 503 `PAYMENT_QUERY_UNAVAILABLE`，**本轮裁定 2 明确固定 W0（不写 `paymentRequest`、不写 status）**。

### 3.2 依赖与顺序

| 依赖 | 要求 |
|---|---|
| S1 | 必须已 PASS；S2 授权文件须引用 S1 复审结论（范围 + tip SHA）。本 preflight 不重验、不代填 |
| 线性历史 | S2 从 S1 PASS tip 或由 S2 单独批准指定的 tip 新建；**本 preflight 不预设**（见 R6） |
| 语义依赖 | 仅 S1 的持久单飞/CAS/审计写集口径；**S2 不调用 query，query 属 S4（裁定 1）** |
| 测试依赖 | S1 的 guard 与测试基础设施可复用；guard 文件不得改（见 §11） |
| 值依赖 | TTL 数值/来源、provider 语义、客户端返回形状必须先确认（见 §13） |
| 禁止依赖 | 不得以“S3/S4 未实现”为由标 `DEFERRED` 或占位；S2 已实现的拒绝必须在本段断言 |

### 3.3 S2 入口条件（缺一不得开工）

1. 有 S2 **单独书面批准**，写明批准范围与该时刻 tip SHA。
2. 有 S1 PASS 的可引用记录（本 preflight 不重复验收、不声称 PASS）。
3. TTL 数值/配置/来源已按 §13 确认并在 S2 入口记录；不得使用默认值/占位值（裁定 5）。
4. provider 语义（prepay 有效期、重签窗口、`time_expire` 关系等）已按 §13 确认；未确认前不得以占位值开工（裁定 5）。
5. 工作树干净；固定输入未前移/分叉；契约/任务卡/S1 清单未变。
6. 若发现实质契约矛盾：先停手报 Codex，**不自行改裁定**；必要时 BLOCKED。

## 4. S2 缓存有效期（TTL）核对

### 4.1 字段与判定语义（引用契约 §4.1、§4.1.1）

| 字段 | 语义 | 判定 |
|---|---|---|
| `prepay.prepayId` | 商户 prepay 标识；S1 从 create 的 `package` 提取 | 必须为非空字符串；与 `clientParams.package` 内标识一致 |
| `prepay.createdAt` | prepay 创建时间（S1 已写） | S2 保留，不因重签改变 |
| `prepay.prepayExpiresAt` | 商户 prepay 自身有效期；由商户 TTL/配置决定，**不得等于订单 `paymentDeadline`** | 必须存在且为数值；严格 `> now` 才算有效 |
| `clientParams.signedAt` | 本次客户端参数签名时间 | 重签时更新；与订单 `signedAt` 无关 |
| `clientParams.signatureExpiresAt` | 客户端签名参数自身有效期；与 prepay 有效期**分离**，**不得等于订单 `paymentDeadline`** | 必须存在且为数值；严格 `> now` 才算有效 |
| `leaseUntil` | S1 单飞租约；`ready` 固定 `null` | S2 不改变 `ready` 的 `leaseUntil:null` |

硬边界：

- `prepayExpiresAt > now` 与 `signatureExpiresAt > now` 均用服务端注入的 `now()` 判定；单位须与现有 `now()`/`createdAt` 的毫秒口径一致，或在 S2 入口显式记录统一换算；不得混用秒。
- 两者**各自独立**：prepay 有效但签名过期 → 本地重签；prepay 过期 → 缓存失效；不得用签名有效期替代 prepay 有效期，也不得把任一 TTL 直接设为订单截止。
- 订单/自有 hold 是继续支付的硬条件：`hold.orderId === order._id` 且 `hold.until > now`；不满足时缓存不可用、409、W0。
- 缺 `prepayExpiresAt`/`signatureExpiresAt` 或非数值 = **不能证明有效期**，固定 503/W0（裁定 2），不得按缓存命中或重签放行。

### 4.2 判定顺序（由原卡组合推出，S2 证据须记录）

1. 订单 owner/存在性（404）；
2. 订单可支付 + 自有 hold + 身份绑定（409，W0；S2-3/S2-4）；
3. `ready` 缓存结构完整性（prepay/clientParams/package/prepayId/TTL 字段）：不能证明完整 → 损坏缓存，503 + W0（裁定 2；不写 status）；
4. prepay 有效期：不满足 `> now` 或缺失/非数值 → 503 + W0（裁定 2；不写 status）；
5. 签名有效期：不满足 `> now` → 本地重签（S2-2）；
6. 两者均有效 → 返回缓存（S2-1，W0）。

说明：

- 步骤 2 必须先于缓存判定：订单/hold 失效不得因“缓存看起来有效”而返回参数；S2-3/S2-4 固定 409/W0。
- 步骤 3 必须先于步骤 4/5：结构损坏时不得尝试重签，也不得返回旧参数。
- 组合失效（如订单失效 + prepay 过期）未在原卡逐例列明；S2 不得自行二选一，按上述顺序记录并在证据中说明，不新增错误码。
- `ready` 的 `leaseUntil:null` 使其不进入 S1 的 takeover 候选；S2 不得把 `ready` 送入 claim/接管。
- **裁定 1**：S2 不调用真实 query；query 属 S4。S2-7/S2-8 的 create/query 均为 0，不得以“S4 未实现”为由补 query 或标 `DEFERRED`。
- **裁定 2**：缓存过期/损坏/缺有效期证明统一 503 `PAYMENT_QUERY_UNAVAILABLE` + W0 + create/query 0；不得写 `paymentRequest.status="reconciling"`、不得清缓存、不得返回参数。

### 4.3 TTL 数值：未冻结，不得凭空设值

| 事实 | 依据 |
|---|---|
| 契约只规定 TTL **必须可配置、不得等于订单截止**，未给具体数值 | 契约 §4.1、§4.1.1、§9.7 |
| 契约中的“如 5 分钟”是举例，不是已批准数值 | 契约 §4.1 `clientParams.signatureExpiresAt` 说明 |
| 任务卡要求“§9.7 取值在 S2 入口记录” | 任务卡 §4.2-1 |
| 代码无 TTL 常量/配置；`paymentMinutes=15` 是订单支付窗口，**不是** prepay/签名 TTL | `domain.js:65`、`:767` |
| 因此本 preflight **不设值**；S2 不得使用 2 小时、5 分钟、15 分钟或任何推断值 | 本文件约束 |
| 本轮裁定 5：供应商有效期、签名缓存期限、适配器约定尚未确定；TTL/供应商语义继续待定；禁止占位值启动 S2；不重复供应商派单 | §0.1、§4.4、§13.2 |

S2 入口必须记录（经批准）：

1. prepay TTL 数值、单位、起算点（创建时间/商户返回值/其它）；
2. 签名 TTL 数值、单位、起算点（`signedAt`）；
3. 配置载体（云函数环境变量/服务选项/常量）与默认值；
4. 测试如何注入/覆盖 TTL（不得靠真实等待）；
5. 两 TTL 与 `paymentDeadline`/`paymentMinutes` 的来源独立性证明（S2-6）。

上述取值在批准前一律不得填入代码/测试/配置；不得以“临时值/默认值/占位值”开工（裁定 5）。

### 4.4 需支付供应商确认的 TTL/参数语义（另线跟进，本任务不派）

| # | 待确认语义 | 当前事实/为什么不能凭空设值 |
|---|---|---|
| P1 | 微信商户 `prepay_id` 的实际有效期与起算点 | 契约只说“由商户 TTL/配置决定”；代码 `create` 只校验 `prepay_id` 为字符串（`wechat-pay.js:130`），未读取任何过期时间 |
| P2 | `time_expire`（当前取订单 `paymentDeadline`，`wechat-pay.js:125`）是否截断 prepay 可用性 | 未验证；若 `time_expire` 早于 prepay TTL，实际可用窗口可能由订单截止决定，不能仅按 prepay TTL 推断 |
| P3 | 同一 `prepay_id` 在有效期内可否多次本地重签、是否有次数/时间限制 | 契约要求“签名过期本地重签”，但 provider 行为未验证；不得假设无限次/任意时刻可签 |
| P4 | create 响应是否返回 prepay 过期时间或其它有效窗口字段 | 当前适配器只取 `prepay_id`；若 provider 返回，须在 S2 入口说明采用/不采用的理由；若没有，本地推导基准必须批准 |
| P5 | `package` 的规范格式与 `prepay_id` 字符集 | 当前按 `prepay_id=([^&\s]+)` 解析；是否可能带其它参数/编码未验证 |
| P6 | `paySign` 规范串、`appid`/`signType` 绑定 | 当前代码按 `${appid}\n${timeStamp}\n${nonceStr}\n${pkg}\n` 签、`signType:"RSA"`；重签必须与 provider 规范一致 |
| P7 | `timeStamp`/`nonceStr` 的新鲜度与客户端接受窗口 | 当前 `timeStamp` 为秒字符串、`nonceStr` 为 16 字节 hex；provider/客户端约束未验证 |
| P8 | 服务端时钟与 provider/客户端时钟偏差容忍 | TTL 判定用服务端 `now()`；偏差策略未定义 |

**以上 P1–P8 未确认前，S2 不得把任何推断写成事实，也不得用“默认值/占位值/稍后补确认”放行。**

裁定 5 补充：以上继续待定；本轮不补充供应商语义、不重复供应商派单；S2 不得以任何占位值启动。

### 4.5 写集定义（S2 专用）

- **W0**：全库零写，`before = structuredClone(store.data)`、`after = structuredClone(store.data)`、`assert.deepEqual`，含 `admin_audit`。
- **WP-resign**：仅目标订单 `paymentRequest.clientParams` 被替换（外加 Store 自动写入的 `updatedAt`）；`prepay`（含 `prepayId`/`createdAt`/`prepayExpiresAt`）、`status`、`attemptId`、`epoch`、`leaseUntil`、`externalRequestSentAt`、`lastQueryAt`、`failedAt`、`queryEvidence` 全部原样；`admin_audit` 整体 `deepEqual`；其余集合/文档 `deepEqual`。重签写入必须 CAS 绑定当前 `attemptId`+`epoch`/`status="ready"`；旧状态失去所有权不得覆盖（裁定 3）。
- **WP-close 不再采用**：本轮裁定 2 明确 S2-7/S2-8 固定 W0（不写 status、不写 `paymentRequest`）；任何写 `status="reconciling"` 的实现均超出本裁定，须停手报 Codex。
- 两个写集（W0/WP-resign）互斥；每例只能选一个；`audit` 列必须与写集一致（全部为 0）。

## 5. prepay 标识核对

### 5.1 写入侧（S1 已建立，S2 保留）

- S1 在 complete 成功时从 create 返回的 `package` 提取 `prepayId`，写 `prepay = { prepayId, createdAt }`（`domain.js:975-980`、`:1048`）。
- S1-3 已断言：`prepay.prepayId` 等于 `clientParams.package` 中 `prepay_id=` 后的值（`leasing.test.mjs:1006-1009`）。
- S2 不得改变写入来源：`prepayId` 只能来自商户 create 返回的 `package`，不得来自客户端输入；`paymentParams` 入参不得新增 prepayId 字段。

### 5.2 读取侧（S2 必须新增）

| 状态 | 条件 | S2 结果 |
|---|---|---|
| 一致 | `prepay.prepayId` 非空字符串；`clientParams.package` 解析出的标识与它相等；TTL 有效 | 缓存命中（S2-1）或重签（S2-2） |
| 不一致 | 解析出的标识 ≠ `prepay.prepayId` | 损坏缓存 → 503 `PAYMENT_QUERY_UNAVAILABLE` + W0（裁定 2） |
| 缺失/非法 | `prepay`/`clientParams`/`package`/`prepayId` 缺失，或 type 非字符串/空串 | 不能证明有效 → 503 + W0（裁定 2） |
| prepay 过期 | `prepayExpiresAt <= now` 或缺失/非数值，即使 package 一致 | 503 + W0（裁定 2） |
| 签名过期 | `signatureExpiresAt <= now`，且 prepay 有效、package 一致 | 本地重签（S2-2），`prepayId` 不变 |

补充：

- 解析 `package` 必须稳健：只接受 `prepay_id=<id>` 形式；若 provider 允许其它参数，解析规则须在 S2 入口记录（P5），不得用宽松/猜测解析。
- 重签的输入必须是缓存的 `prepay.prepayId`，输出 `package` 必须仍包含同一个 `prepay_id`；不得重新 create、不得生成新 prepay。
- 不得在 S2 修复/重写损坏的 `prepay`/`clientParams`；固定 W0（裁定 2）；不得写 `status`/`paymentRequest`，不得清理缓存。

## 6. 客户端签名重签核对

### 6.1 现状

- `wechat-pay.js:35-39` 的 `sign` 是 `createWechatPay` 闭包内的本地 RSA-SHA256 签名函数；当前只被请求鉴权（`:63`）与 create 的 `paySign`（`:139`）使用。
- `createWechatPay` 返回 `appid`/`mchid`/`verify`/`create`/`query`/`notification`（`:115-168`）；未暴露“用缓存 prepayId 本地签名”的入口。
- `create` 的 clientParams 只含 `timeStamp`/`nonceStr`/`package`/`signType`/`paySign`（`:134-140`），不含 `signedAt`/`signatureExpiresAt`。

### 6.2 S2 必须新增（任务卡 §4.2-2/3）

| 要求 | 边界 |
|---|---|
| 用缓存 `prepayId` 本地重签 | 复用同一 `appid`、同一 `package`（`prepay_id=<同一个 id>`）、同一 `signType:"RSA"`、同一规范串；只换 `timeStamp`/`nonceStr`/`paySign`/`signedAt`/`signatureExpiresAt` |
| 不新增网络调用 | 不得调用 `request`/`https`/`query`/`create`；只做本地密码学运算 |
| prepay 不变 | 不写 `prepay`、不生成新 `prepayId`、不改 `createdAt`/`prepayExpiresAt` |
| 审计/计数 | 0 audit、create 0、query 0 |
| CAS/所有权 | 重签写入必须 CAS 绑定当前 `attemptId`+`epoch`/`status="ready"`；旧状态失去所有权不得覆盖（裁定 3） |
| 返回 | 新签的 clientParams；`package` 中 prepay 标识不变 |
| 失败关闭 | 本地签名失败/适配器无重签能力未在原卡定义；不得新增错误码（见 R10） |

### 6.3 并发重签（S2-5）

- 两个并发重签允许都成功：本地签名、无外部 create。
- 仅一份 `prepay`；`clientParams` 后写者生效；最终库内只有一个 `clientParams`。
- 不得新增 prepay、不得新增审计、不得 create/query。
- 重签写入必须 CAS；任一方失去所有权（attemptId/epoch/status 已变）时不得覆盖新状态（裁定 3）。
- 测试必须证明是“并发重签”，不是一串缓存命中：两个请求都应在签名过期状态下进入重签路径（可用签名适配器 barrier/延迟注入）；若第二个因第一个已写入新签名而命中缓存，证据必须如实说明，并仍断言单一 prepay、0 audit、0 create。
- 两方返回的参数都应可验证有效（`package` 的 prepayId 一致、`paySign` 可验）；最终存储等于其中一方。

### 6.4 接口与一致性（需在 S2 入口记录，不新增 dispatch action）

- 重签入口的形态未在原卡固定：可以是 `payment` 适配器新增本地方法，也可以是 `wechat-pay.js` 导出的纯函数；无论哪种，必须满足 §6.2，且不得改变 `index.js`、dispatch action 集合、`paymentParams` 入参。
- `clientParams.signedAt` 与订单 `signedAt` 同名不同义；S2 不得读取/覆盖订单 `signedAt`。
- 重签写入必须绑定当前 `attemptId`+`epoch`/`status="ready"`（或等价事务 CAS），不得覆盖并发产生的新状态；该并发安全口径由契约 §4.2-7“旧 attempt 不得覆盖新 epoch”推出，并由本轮裁定 3 明确，S2 证据须证明。

## 7. 受影响的 S1 断言（必须更新/复核）

### 7.1 已批准 S1 清单点名的必改项

| 用例 | 当前断言（`0b23213`） | S2 后的要求 | 证据要求 |
|---|---|---|---|
| `S1-3`（`admin-web/tests/leasing.test.mjs:988-1028`） | `assert.deepEqual(params, { package: "prepay_id=test" })`（`:997`）；`assert.deepEqual(pr.clientParams, params)`（`:1005`）；顶层 key 列表（`:1010-1026`）；`prepay.prepayId`/`createdAt` 断言 | 增加 TTL 字段断言；明确首次返回仍来自本次 create（不是缓存）；更新被 TTL 字段影响的 deepEqual/key 断言；保留 WP* 1 审计 | S2 证据列 diff，不得静默改写 |
| `S1-15`（`:1403-1421`） | `ready` 命中固定 503 `PAYMENT_QUERY_UNAVAILABLE`、W0、create 1/query 0、`leaseUntil:null` | 拆成两类：**TTL 有效**的 ready → S2-1 缓存命中；**无 TTL/不能证明**的 ready → 仍 503/W0（裁定 2；不写 status）。不得把“未证明有效→503”整体删除 | S2 证据列 diff 与新用例编号 |

**硬要求**：S1 清单 §3.1 明确“S2 入口必须显式更新并重跑受影响的 S1 断言：S1-3、S1-15，并在 S2 证据中列出 diff”。本 preflight 只确认该义务，不代替更新。

### 7.2 需复核的其它 S1 断言（本 preflight 发现，交 Codex 确认）

| 用例 | 位置 | 风险 | 处理建议（不自行改裁定） |
|---|---|---|---|
| `S1-1` | `:1030-1074`，`deepEqual(pr.clientParams, { package: "prepay_id=winner" })`（`:1068`） | 若 S2 在 `clientParams` 增加 `signedAt`/`signatureExpiresAt`，该 deepEqual 必坏；S1 清单只点名 S1-3/S1-15，未列 S1-1 | 列为 R2：更新或证明 S2 不改变 `clientParams` 形状；不得静默改 |
| `S1-4` | `:1101-1132`，fixture `prepay:{prepayId:"keep",createdAt:...}`（`:1112`），断言 deepEqual（`:1126-1129`） | 仅当 S2 在 complete/stale-epoch 路径前置校验 prepay/TTL 时受影响；若只在 `paymentParams` 缓存读取路径校验，则不受影响 | 列为 R3：S2 证据说明该 fixture 是否更新及原因；不得无声改 |
| `S1-16` | `:1424-1444`，DTO key 集合不含 `paymentRequest`/`prepay`/`clientParams` | S2 不得让 TTL 字段泄漏到 `orderDTO` | 保持并重跑；新增缓存字段也不得进 DTO |
| `S1-17` | `:1446-1491`，dispatch action 精确列表、无定时器、create 不在 claim 内、无新错误码 | S2 新增重签入口不得变成新 action；不得新增定时器/错误码；`index.js` 零 diff | 保持并重跑；若需新 helper，只允许内部非 dispatch |
| `S1-9`/`S1-12`/`S1-14`/`S1-18`/`S1-19`/`S1-20` | `:1245-1282`、`:1332-1365`、`:834-873`、`:1494-1519`、`:1547-1583`、`:1585-1622` | S2 必须继续 503/WP/W0；不得因缓存改动把未证明路径改成返回缓存 | 全部重跑；不得静默弱化 |
| `S1-21` | `:1625-1680`，事务重试重读时钟 | S2 TTL 判定必须同样重读 `now()`；不得缓存过期判断 | 保持并重跑；TTL 断言用注入时钟推进 |

### 7.3 其它会多次调用 `paymentParams` 的既有用例

- `:740`（身份替换使订单失效）：订单状态已变 `identity_changed`，S2 的订单/hold 校验必须先返回 409/W0；不得因 ready/缓存逻辑返回参数。
- `:875`（缓存参数到账）：只调用一次 `paymentParams`；S2 写入 TTL 字段后仍应通过；不得改变 `applyPayment` 事实优先语义。
- `S1-1`/`S1-9`/`S1-21`：第二次调用发生在有效 lease/并发/事务重试场景，不属“ready 缓存命中”；S2 不得把这些路径改成缓存返回。
- `tests/leasing.test.cjs`（3 个 `test(`）：只测 `index.js` wrapper 与小程序静态行为；本轮裁定 4 明确其未受影响、**保持零差异**，不因凑文件数而改。

## 8. 必须保留的 S1 冻结行为（S2 逐项核对）

| # | 冻结行为 | S1 锚点 | S2 必须 |
|---|---|---|---|
| F1 | 持久单飞：同一订单同一时刻最多一个有效 `preparing`/`reconciling` lease | S1 清单 A1/A2；S1-1/S1-2 | 保留；有效 lease 第二方 409 `PAYMENT_PARAMS_IN_PROGRESS`，W0 |
| F2 | 原子 claim+sent：本地校验 + CAS + lease + `externalRequestSentAt` 同一事务一次 commit；commit 后才一次 create；无回退事务 | S1 清单 A3/§3.2；S1-6a/6b | 保留；不得把 TTL/重签写入拆到 create 前的外部事务 |
| F3 | complete CAS：`attemptId+epoch` 匹配；旧 epoch 返回 `false`/W0；成功 ready + 1 审计 + `leaseUntil:null`；失败/未知 reconciling、sent 保留、0 审计 | S1 清单 A5/A7；S1-3/S1-4/S1-9 | 保留；S2 重签写入同样 CAS，旧状态失去所有权不得覆盖（裁定 3） |
| F4 | `externalRequestSentAt` 一旦非空永久保留，不清空、不回退 `none`、不重发 | S1 清单 A4；契约 §4.1/§4.5 | 保留；S2-7/S2-8 不得清除 sent |
| F5 | 失败关闭：损坏/未知 `paymentRequest`、epoch 非安全整数/溢出、`preparing` 无 sent、lease 过期接管已发请求 → 503 `PAYMENT_QUERY_UNAVAILABLE` | S1 清单 A6/§3.4；S1-12/S1-13/S1-18/S1-19 | 保留；S2 新增的 503 只用于 prepay 过期/损坏缓存，不得改写既有 503 |
| F6 | 有效自有 hold：`hold.orderId === order._id` 且 `hold.until > now`；不满足不得 create/返回参数 | 契约 §4.2-5；S1-5 | 保留；S2-3/S2-4 409/W0，缓存不可用 |
| F7 | `ready` 不能证明有效时固定 503/W0/create=query=0；S2 只以 TTL 证明缩小该范围，不得无条件返缓存 | S1 清单 §3.1；S1-15 | 保留默认失败关闭；无 TTL/损坏/过期统一 503 + W0（裁定 2） |
| F8 | 审计：只有成功 `ready` 1 条；缓存命中/重签/503/409 0 条；`admin_audit` 与写集一致 | S1 清单 §4.2；任务卡 §3.3 | 保留；S2 所有用例 audit 0 |
| F9 | 无进程内锁、无定时器、无自动重试、无第二次 create、无新 `out_trade_no` | S1 清单 A8/§6；S1-17/S1-20 | 保留；重签是本地签名，不是 create |
| F10 | 错误唯一：仅 409 `PAYMENT_PARAMS_IN_PROGRESS`、503 `PAYMENT_QUERY_UNAVAILABLE`、既有订单/持有 409；不新增固定码 | 契约 §4.3；任务卡 I12/G10 | 保留；S2-6 是配置断言，不新增码 |
| F11 | 不新增 dispatch action、不改 `index.js`、不改 DTO 键集合 | S1 清单 A10；S1-16/S1-17 | 保留 |
| F12 | guard 闭合：加载前安装、逐入口负控、必要依赖正控、ESM、子进程 1/1、非监听清单 | S1 清单 §7 | 保留；S2 重跑并记录，不改 guard |
| F13 | S2 不调用真实 query；query 属 S4 | 本轮裁定 1；任务卡 §3.4/§4.2-4 | S2-7/S2-8 的 create/query 均 0；不得以 S4 未实现为由补 query 或标 `DEFERRED` |
| F14 | 合法本地重签只改 `clientParams`；CAS 防覆盖；旧所有权不得覆盖 | 本轮裁定 3；契约 §4.2-7 | S2-2/S2-5 证据含 CAS/所有权断言；`prepay`/`status`/sent 不变 |

## 9. 文件白名单、依赖与不碰清单

### 9.1 允许文件（上限，任务卡 §4.2）

| 文件 | `0b23213` blob / 行数 | S2 预期 | 说明 |
|---|---|---|---|
| `cloudfunctions/leasing/domain.js` | `e48c59b2…` / 1362 | **必改** | TTL 判定、缓存命中、本地重签编排、503 关闭 |
| `cloudfunctions/leasing/wechat-pay.js` | `351a336e…` / 170 | **必改** | 用缓存 `prepayId` 本地签名；TTL 元数据；不新增网络 |
| `admin-web/tests/leasing.test.mjs` | `3507fb78…` / 1680 | **必改** | S2-1…S2-8 + S1-3/S1-15 更新 |
| `tests/leasing.test.cjs` | `c5c0a9ae…` / 178 | **零差异（裁定 4）** | 未受影响，保持零 diff；不因凑文件数改动 |

- 白名单是**上限**：不是四个都必须改；裁定 4 明确根租赁测试未受影响，`tests/leasing.test.cjs` 保持零差异，不因凑文件数而改。
- 任何白名单外文件出现在 `git diff --name-only <S2 起点>..tip` 即 FAIL（G4 口径）。

### 9.2 明确不碰

```text
tests/rental-network-guard.cjs        # S1 新增；S2 不得改（不足则停手报批）
tests/leasing.test.cjs                # 裁定 4：未受影响，保持零差异
cloudfunctions/leasing/store.js       # 零 diff
admin-web/lib/store.mjs               # 零 diff
cloudfunctions/leasing/index.js       # 零 diff（协议/action 不变）
miniprogram/**                        # 零 diff
admin-web/public/**                   # 零 diff
docs/RENTAL-OPEN-ITEMS-CONTRACT-CARD.md
docs/tasks/RENTAL-PRESIGNING-STAGED-IMPLEMENTATION-TASK-2026-11-18.md
docs/tasks/RENTAL-PRESIGNING-S1-AUTHORIZATION-2026-11-19.md
docs/RENTAL-PRESIGNING.md
package.json / 锁文件 / 部署清单
```

### 9.3 依赖清单

- S1 PASS（引用，不重验）；S1 的 guard/测试基础设施。
- S2 单独书面批准（范围 + tip）。
- TTL 值/配置/来源（§13）；provider 语义（§4.4）。
- Node `v24.19.0`、Windows PowerShell 5.1、Git 2.55.0（仅测试环境事实，不是批准）。
- 不依赖 S3/S4/S5/S6 的行为；S2 不调用 query，query 属 S4（裁定 1）。

## 10. 逐例唯一预期（S2-1…S2-8）

写法约定：W0/WP-resign 见 §4.5（WP-close 不再采用）；“静态/非 HTTP”必须显式标注；每例只断言一个 code/status；create/query 为精确次数。

| # | 场景 | 唯一 code/status | 写集 | audit | create | query |
|---|---|---|---|---:|---:|---:|
| S2-1 | 正：prepay 与签名均有效 | 成功（领域返回；云 `code:0`） | W0 | 0 | 0 | 0 |
| S2-2 | 正：签名过期、prepay 有效 | 成功（本地重签；云 `code:0`） | WP-resign（CAS，裁定 3） | 0 | 0 | 0 |
| S2-3 | 负：hold 已释放/非本单 | 409（现有订单/持有不可支付） | W0 | 0 | 0 | 0 |
| S2-4 | 负：订单支付截止已过 | 409（同上） | W0 | 0 | 0 | 0 |
| S2-5 | 正：两并发重签 | 两者均成功；各自返回有效参数 | WP-resign（至少一次；CAS；最终单一 `clientParams`） | 0 | 0 | 0 |
| S2-6 | 负：TTL 误设为订单截止 | 静态/非 HTTP：断言 TTL 来源≠`paymentDeadline` | W0（配置断言） | 0 | 0 | 0 |
| S2-7 | 负：prepay 过期（S2 不 query） | 503 `PAYMENT_QUERY_UNAVAILABLE` | W0（裁定 2；不写 status/paymentRequest） | 0 | 0 | 0 |
| S2-8 | 负：损坏缓存（S2 不 query） | 503 `PAYMENT_QUERY_UNAVAILABLE` | W0（裁定 2；不写 status/paymentRequest） | 0 | 0 | 0 |

**裁定 1/2**：S2 不调用真实 query；S2-7/S2-8 固定 503/W0/create=query=0；不得以“尚需 query”为由补 query、写 `reconciling` 或标 `DEFERRED`。

### 10.1 逐例补充断言（缺一即未闭合）

- **S2-1**：返回对象与库内 `clientParams` 一致（若 R9 决定不向客户端暴露 TTL 元数据，则按 R9 记录差异，至少 `package`/prepay 标识一致）；**不重签**（`timeStamp`/`nonceStr`/`paySign`/`signedAt` 不变）；`prepay`/`ready`/`leaseUntil:null` 原样；W0 含 `admin_audit` 整体 `deepEqual`；create/query 0。
- **S2-2**：`prepay` 逐字段不变（含 `prepayId`/`createdAt`/`prepayExpiresAt`）；仅 `clientParams` 变化；新 `signedAt`/`signatureExpiresAt` 按批准的签名 TTL 计算；`package` 中 prepay 标识不变；`paySign` 可验证；重签写入 CAS 绑定当前 `attemptId`+`epoch`/`status="ready"`，旧状态失去所有权不得覆盖（裁定 3）；audit 0、create/query 0。
- **S2-3**：覆盖“已释放”和“非本单”两个 fixture；即使 TTL 仍有效也不得返回缓存/参数；订单/hold 原样；W0。
- **S2-4**：把时钟推进到 `paymentDeadline` 之后；为确保是订单校验而非 TTL 触发，TTL 应仍在有效期内（若 TTL 无法安排，证据须说明）；409/W0。
- **S2-5**：两个请求都在签名过期状态下进入重签（不是第二个命中缓存）；两者返回参数均含同一 prepay 标识且 `paySign` 可验；最终库内单一 `prepay`、单一 `clientParams`（等于其中一方）；双方写入均须 CAS，任一方失去所有权不得覆盖新状态（裁定 3）；audit 0、create/query 0。
- **S2-6**：断言 TTL **来源**独立（配置/常量不与 `paymentMinutes`/`paymentDeadline` 同源），不能只比较可能偶发相等的数值；具体数值断言需等 TTL 值批准（§13）；标注“静态/非 HTTP”。
- **S2-7**：推进时钟超过 `prepayExpiresAt` 且订单/hold 仍有效；503；不返回参数；固定 W0（不写 status、不写 paymentRequest）；sent/prepay/clientParams/attempt/epoch/leaseUntil/证据字段原样；有效 hold 保留；`admin_audit` 整体 `deepEqual`；create/query 0（裁定 2）。
- **S2-8**：`package` 内标识 ≠ `prepay.prepayId`；503；固定 W0（不写 status、不写 paymentRequest）；损坏的 `prepay`/`clientParams` 原样保留（不修复、不清理）；有效 hold 保留；`admin_audit` 整体 `deepEqual`；create/query 0（裁定 2）。
- 边界：`prepayExpiresAt === now` / `signatureExpiresAt === now` 均视为过期（契约要求严格 `>`）；S2 证据须含边界断言。

### 10.2 阶段边界（已裁定，不再待裁）

- 裁定 1：S2 不调用真实 query；query 属 S4。
- 契约 §4.1.1-4/§7.1 的“prepay 过期先 query / query ≥1”是 S4 之后的最终行为；S2-7/S2-8 的 query 0 是已定阶段边界，不再列为待裁/冲突。
- S2 证据不得把 query 0 写成“未实现/待补”，也不得标 `DEFERRED`；S4 才补真实 query 结果处置。

## 11. Guard 与证据要求

### 11.1 Guard（沿用 S1，不得改）

- 测试必须先安装 guard，再动态加载被测模块；`tests/rental-network-guard.cjs` 在 S2 **零 diff**（任务卡 §3.5：后续段不得修改，除非该段入口单独批准）。
- S2 证据必须重跑并记录：`process.version`、平台、guard 入口数、逐入口负控 N/N、必要依赖正控 M/M、ESM 命名绑定被拦截、真实子进程继承 1/1、非监听清单全过、加载期违规 0、环境失败口径。
- 必要依赖正控必须覆盖 `node:crypto` 的 RSA-SHA256 签名/验签（重签路径直接依赖）、AES-256-GCM、`fs/promises`、`buffer`/`url`/`path`/`os`、注入适配器 mock。
- guard 不足/入口缺失/负控未触发/泄漏真实网络/子进程失败：**BLOCKED**，不得 skip/降级/重试绕过。

### 11.2 测试命令与计数（只允许两条）

```powershell
# 工作目录：S2 实施工作树根（分支 tip = S2 实施提交）
node --test admin-web/tests/leasing.test.mjs
node --test tests/leasing.test.cjs
```

- 禁止 `npm test`、`node --test` glob、`server.test.mjs`、任何 HTTP/UI 启动、任何真实支付/云/设备命令。
- 每段 PASS 必须列：执行数、通过数、失败数、跳过数（必须 0）、`DEFERRED` 清单（仅 S4 才发生的真实 query 结果处置；S2 不 query）、guard 自检数字、逐例 create/query/audit/写集。
- S2 不得把已实现的 503 关闭（S2-7/S2-8）标 `DEFERRED`；不得用 `skip`/`todo`/`only` 冲抵。

### 11.3 证据必须包含

1. S2 完整 SHA、父 SHA、分支、`ls-remote` 实测远端 tip；
2. `git diff --stat`、`git diff --name-only`（逐项对照 §9.1；`tests/leasing.test.cjs` 按裁定 4 注明“未受影响、零差异”）；
3. 两条命令的 exit code 与执行/通过/失败/跳过计数；
4. 逐例唯一 code/status、W0/WP-resign、audit、create/query（S2-7/S2-8 固定 W0/create=query=0）；
5. **TTL 配置值与“签名/缓存分离”断言**（任务卡 §4.2 证据要求；TTL 未批准前不得填值）；TTL 来源≠`paymentDeadline` 的证明；
6. **S1-3、S1-15 的 diff**（S1 清单 §3.1 强制），以及 §7.2 各复核项的结论；
7. guard 自检数字；未验证/不可验证项；
8. 声明“未合并、未部署、未开 HTTP/UI、未接真实支付/设备/业务云、未装依赖”；
9. §0.1 五项裁定的逐项落点对照（含 S2 不 query、W0、重签 CAS、根测试零差异、TTL 待定）。

## 12. 停止点与禁止

### 12.1 本任务停止点

1. 本文件本轮修改提交并**普通 push** 到 `codex/rental-s2-preflight`；`git ls-remote` 核对完整 SHA 后**立即停手**，交 Codex 实施前独立复审。
2. 不进入 S2 实施；**不运行测试或 guard**；不改代码/测试/Store/契约/任务卡；不合并/不部署。
3. 本轮 Codex 前置核对已通过，但实施条件未齐；S2 开工须另行书面批准（范围 + tip SHA）并先确认 TTL/供应商语义（裁定 5）。

### 12.2 S2 实施停止点（获批准后）

1. S2 实施提交并普通 push 后立即停手，交 Codex 独立复审；**不进入 S3**。
2. S2 PASS 不自动批准 S3；每段仍须单独书面批准（范围 + tip SHA）。
3. 不合并、不部署、不开 HTTP/UI、不接真实支付/设备/业务云；不安装依赖；不读写凭据。
4. 只允许追加提交、普通 push、`ls-remote` 核对；禁止 `amend`/`rebase`/`reset`/`squash`/`force`/`merge`/`cherry-pick`；禁止全局 Git/TLS 配置修改。
5. 任何与契约/任务卡冲突：先停手报 Codex；不得自行改裁定。

## 13. 未验证、不可验证与不可凭空设值的缺项

### 13.1 未验证/不可验证（本轮）

- 本轮只做文档核对与静态检索；**未运行任何测试或 guard**（未执行 `node --test`/`npm test`），未改代码/测试/Store，未安装依赖，未开 HTTP/UI，未接真实支付/云/设备，未读写凭据/真实身份证。
- Codex 前置核对已通过（本轮输入），但 S2 实施条件未齐；本文件**不构成 S2 授权**。
- 本文件未取得 S1 复审结论正文；**不声称 S1 PASS**，不重复验收 G1/G2/G3/O10/G4/07B。
- 微信支付 provider 的 prepay 有效期、签名缓存期限、适配器约定、重签窗口、`time_expire` 关系、返回字段等均**未离线验证**；裁定 5 要求继续待定，不得写成事实。
- 真实云事务/CAS/索引/权限、真机、HTTP/UI 均不可验证。
- 指定的云评审材料正文未取得本机可读副本；不声称已读、不声称已闭合。

### 13.2 不可凭空设值的缺项（S2 开工前置）

| # | 缺项 | 为什么不能凭空设值 | 需要谁确认 |
|---|---|---|---|
| M1 | prepay TTL 数值/单位/起算点 | 契约只说“由商户 TTL/配置决定”，代码无值；`paymentMinutes` 是订单窗口，不是 prepay TTL | 支付供应商 + 业务/Codex 批准 |
| M2 | 签名 TTL 数值/单位/起算点 | 契约“如 5 分钟”只是举例；无已批准值 | 业务/安全 + Codex 批准 |
| M3 | TTL 配置载体与默认值 | 契约要求“部署参数中确定”；仓库无配置项 | 部署/Codex 批准 |
| M4 | provider 过期时间来源 | 当前 create 只取 `prepay_id`；是否有服务端过期字段未验证 | 支付供应商 |
| M5 | 重签可用窗口/次数限制 | provider 行为未验证；不得假设无限次 | 支付供应商 |
| M6 | `package` 规范格式/字符集 | 当前正则解析；是否可含其它参数未验证 | 支付供应商 |
| M7 | 客户端返回形状（是否暴露 TTL 元数据） | 契约只定义存储形状；小程序现有字段语义未定义 TTL 暴露 | Codex/接口负责人（R9） |
| M9 | 本地重签失败的行为 | 原卡未定义；不得新增错误码 | Codex（R10） |
| M10 | S2 实施起点 SHA | S1 PASS tip 与 preflight tip 的关系未在批准中写明 | S2 书面批准（R6） |
| M11 | S1 PASS 记录引用 | 本文件不重验、不代填 | S2 书面批准（R7） |

裁定 5：M1–M7 继续待定；禁止占位值启动 S2；不重复供应商派单。M8/M12 已由裁定 2 闭合，不再列待裁。

## 14. 待 Codex 复审确认项（不自行裁定）

| # | 事项 | 事实 | 需要 Codex |
|---|---|---|---|
| R2 | `S1-1` 的 `clientParams` deepEqual 未列入 S1 清单“必改两项” | S2 若在 `clientParams` 增加 TTL 字段，S1-1 也会坏 | 确认更新范围；不得静默改 |
| R3 | `S1-4` fixture 的旧 `prepay` 形状 | 仅当 S2 在 complete/stale-epoch 路径前置校验 TTL 时受影响 | 确认是否更新及理由 |
| R6 | S2 实施起点 | 本 preflight 分支从 `0b23213` 新建；S2 卡说 Sn 从 S(n-1) PASS tip 新建 | 在 S2 批准中写明起点 SHA（`0b23213` 或 preflight 复审 tip） |
| R7 | S1 PASS 引用 | 本文件不重验、不声称 PASS | S2 批准引用 S1 复审结论（范围 + tip） |
| R9 | 客户端是否可见 TTL 字段 | 契约定义存储形状，未定义 `paymentParams` 返回是否含 `signedAt`/`signatureExpiresAt` | 确认返回形状，避免改变小程序字段语义 |
| R10 | 本地重签失败的行为 | 原卡未列；无新码可用 | 确认失败关闭口径（现有 503）或 BLOCKED |
| R11 | TTL 测试的可注入性 | 若 TTL 为硬编码且不可注入，S2-6/S2-7 无法在不等待真实时间的情况下验证 | 确认 S2 入口提供测试注入/配置 |

已闭合、不再列待裁：R0/R1/R4/R5/R8 由本轮 §0.1 的裁定 1–5 解决；M8/M12 同样闭合。

**结论**：S2 不调用真实 query（裁定 1）；缓存过期/损坏/缺有效期证明固定 503/W0/create=query=0（裁定 2）；本地重签只改 clientParams 且必须 CAS、旧所有权不得覆盖（裁定 3）；根租赁测试保持零差异（裁定 4）；TTL/供应商语义继续待定、禁止占位值启动 S2、不重复供应商派单（裁定 5）。其余 R2/R3/R6/R7/R9/R10/R11 与 M1–M7/M9–M11、P1–P8 保留待确认；本轮不自行补充业务或供应商语义，不自行认定实质契约矛盾。

## 15. 本轮实测命令与退出码

### 15.1 初版（v1）提交前

| 命令（工作目录） | exit | 说明 |
|---|---:|---|
| `git fetch --prune origin`（`SMART-PM-H3`） | 255 → 0 | 首次因共享 `.git` 写权限被拒绝；完整文件权限下重试成功；远端以 `ls-remote` 为准 |
| `git ls-remote --heads origin` | 0 | 四个固定分支 tip 与固定 SHA 一致，无前移/分叉 |
| `git rev-parse 0b23213^{commit}` / `git log -1 --format=%P 0b23213` | 0 | 固定起点与父 |
| `git merge-base --is-ancestor e4e1008 0b23213` | 0 | S1 清单在固定起点祖先链上 |
| `git rev-parse 0b23213:<doc>` + 行数 | 0 | 契约/任务卡/S1 清单 blob 与行数 |
| `git diff --name-status e4e1008..0b23213` | 0 | 仅 S1 四个文件 |
| `git diff --name-status 3bf5951..0b23213 -- cloudfunctions admin-web/lib admin-web/public miniprogram` | 0 | 仅 `domain.js` |
| `git worktree add -b codex/rental-s2-preflight … 0b23213` | 0 | 新工作树从固定起点 |
| `git status --porcelain=v1 -b`（新工作树） | 0 | 干净；分支正确；无上游 |
| `git diff --check`（写 v1 后、提交前） | 0 | 无空白错误 |
| `git show --check`（v1 提交后） | 0 | 通过 |
| `git push origin codex/rental-s2-preflight`（v1 提交后） | 0 | 普通 push |
| `git ls-remote origin refs/heads/codex/rental-s2-preflight`（v1 推送后） | 0 | `debcc7b50a5ef0a80378bce5924cb4f68192d3f3` |

### 15.2 本轮续作（裁定回写）

| 命令（工作目录） | exit | 说明 |
|---|---:|---|
| `git fetch --prune origin`（续作工作树） | 0 | 远端无新提交；目标分支 tip = 固定输入 |
| `git rev-parse HEAD` / `git rev-parse HEAD^` | 0 | `debcc7b` / `0b23213` |
| `git ls-remote origin refs/heads/codex/rental-s2-preflight` | 0 | `debcc7b50a5ef0a80378bce5924cb4f68192d3f3`，未前移/未分叉 |
| `git status --porcelain=v1 -b` | 0 | 修改前干净 |
| `git diff --check` / `git diff --cached --check` | 0 / 0 | 无空白错误 |
| `git commit`（本轮追加） | 0 | 仅修改本文件；最终 SHA 见交付报告 |
| `git show --check`（本轮提交后） | 见交付报告 | 仅提交后执行 |
| `git push origin codex/rental-s2-preflight`（本轮提交后） | 见交付报告 | 普通 push |
| `git ls-remote origin refs/heads/codex/rental-s2-preflight`（本轮推送后） | 见交付报告 | 核对完整 SHA |

## 16. 交付声明

- 本文件是**唯一修改文件**；本轮未修改任何代码/测试/Store/契约/任务卡，未运行测试或 guard，未安装依赖，未开 HTTP/UI，未接真实支付/云/设备，未读写凭据，未合并/未部署。
- 本文件只引用已批准契约（`5d56dea`）、任务卡（`8a2f8d9`）、S1 清单（`e4e1008`）、S1 实现（`0b23213`）与本轮 5 项边界裁定（§0.1）；**不重复审批、不重推 T1–T13、不改写任何裁定**。
- Codex 前置核对已通过，但 S2 实施条件未齐；本文件**不构成 S2 实施授权**。S2 须另行书面批准（范围 + tip SHA），并在 TTL/供应商语义确认后开工（裁定 5）。
- 提交后停手，交 Codex 实施前独立复审；不自批下一阶段。
