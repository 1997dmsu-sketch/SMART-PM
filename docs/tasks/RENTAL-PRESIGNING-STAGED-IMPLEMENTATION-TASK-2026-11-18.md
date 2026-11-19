# 预签约分阶段实施任务卡（修订 v4 · 离线 · 待 Codex 独立复审）

- 日期：2026-11-19（v4 修订，Asia/Shanghai）；初版 2026-11-18 起草、2026-11-19 提交
- 执行者：DSH 根代理 `lead`（`deepseek-flash`）；Windows PowerShell 5.1 / Git `2.55.0.windows.3` / Node `v24.19.0`
- 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\rental-staged-task`
- 分支：`docs/rental-staged-implementation-task`
- 本版输入基线：`fe300bdfa44a9d9996cc7c5b935fccce47f09332`；初版输入：`5d56dead460220d3409fa80bcaea8b1fa3a5c9a3`
- 已批准契约：`docs/RENTAL-OPEN-ITEMS-CONTRACT-CARD.md`（第五版；427 行；blob `94d61ed1c3d44bdb02249aa96e10d57422d5225d`）；辅助口径：`docs/RENTAL-PRESIGNING.md`、`docs/RENTAL-IDENTITY-PAYMENT-REVIEW-FIX-2026-11-16.md`
- 代码基线：`3bf595140088bc71a3939fb67880807965e9c566`；自该基线至本版输入基线，运行时代码/测试/Store 零 diff（仅 `docs/tasks` 卡文）
- 状态：**仅卡文修订（v4）；不实施、不运行测试、不改契约/生产代码/测试/Store；待 Codex 独立复审（不自批）**
- 云评审材料：`/workspace/artifacts/FIVE-FOLLOWUPS-REVIEW-2026-11-19/DISPATCH.md` 与 `REVIEW.md` 未取得本机可读副本（具体核对路径见 §9）；**不声称已读、已逐项闭合或已获批准**。本版只做不依赖该正文的文档修订；缺失材料单列 §13。
- 初版 `C1-epoch-RENTAL-retry-review`、v2 `STAGED-CARDS-REVIEW-2026-11-19`、v3 `SEVEN-TASKS-REVIEW-2026-11-19` 的云材料均不在本机；不声称读过。
- 派单背景（不改变）：18/27 预算可采纳；C 文档方案/G 准备文档通过收口；Git 偏差 OPEN、不恢复；E/F 待外部材料、不重派；G3/O10/G4/07B 门禁验收有效，其余冻结有效。本卡不改上述状态或授权范围。

## 0. 状态与输入核对（本轮实测）

| 项 | 值 | 核验方式 |
|---|---|---|
| 本版输入基线 | `fe300bdfa44a9d9996cc7c5b935fccce47f09332` | 修订开始时 `git rev-parse HEAD` |
| 输入基线的父 | `f300dc694632ba0e53fcc43d3780be0d84925aef` | `git log -1 --format=%P fe300bd` |
| 初版输入 | `5d56dead460220d3409fa80bcaea8b1fa3a5c9a3` | 初版父提交，链上仍可达 |
| 工作树 | 干净 | `git status --porcelain=v1` 空 |
| 分支 / 上游 | `docs/rental-staged-implementation-task` → `origin/docs/rental-staged-implementation-task` | `git status -sb` |
| 远端 tip（fetch 后） | `fe300bd…`，与本地 HEAD 一致；无前移/分叉 | `git fetch` + `ls-remote` + `rev-parse origin/…` |
| 契约 blob / 行数 | `94d61ed1…` / 427（未变） | `git rev-parse HEAD:docs/…` + 字节/LF 计数 |
| 运行时代码 | `3bf5951..本版输入基线` 零 diff | `git diff --name-only 3bf5951..HEAD` |
| 本版改动 | 仅本卡文 | 提交后 `git show --stat` 核对 |
| 云评审材料 | 未取得本地副本 | 见 §9/§13 路径核对 |
| 派单背景 | 18/27；C/G 收口；Git OPEN 不恢复；E/F 待外部不重派；G3/O10/G4/07B 有效；其余冻结 | 本轮不触碰 |
| 冻结项 | 合并、实施、C2/C3、HTTP/UI、部署上线、真实支付、设备、业务云 | 本轮均未触碰 |

本版只修改本卡文一个文件；以普通追加提交推送到同一分支，推送后以 `git ls-remote` 核对远端 tip。初版新增文件为 `c49a0e1`，v2 为 `eabe780`，v3 为 `fe300bd`；本版为 `fe300bd` 之后的追加提交，不改写既有提交。

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
| I9 | **缺同意不是退款依据**：真实到账必须落账；订单/hold 独立有效时仅置 `privacyReviewStatus=consent_required` 并保留现有有效 hold（不新 hold），不得转 `refund_required`；退款/释放 hold 须独立已批准依据（§9.2）或独立订单失效事实 | §6.4-1、§6.4-2、§5.1 |
| I10 | **旧客户端判定可验证**：只比较请求显式提交的整数 `privacyVersion` 与当前 `settings.privacyVersion`；禁止以 `templateVersion`、UA、客户端版本号、发布渠道或缺失字段猜版本；旧客户端必须显式刷新/重新同意，服务端不静默放行 | §6.3、§6.5 |
| I11 | **逐段独立批准**：本卡 PASS 不自动批准任何阶段，Sn PASS 不自动批准 S(n+1)；§8 业务待裁未裁定前该段保持 BLOCKED，§13 材料不足不构成放行；不得以默认值/占位实现/稍后补裁放行 | §8、§13、§10 |
| I12 | **错误唯一**：每场景只按契约 §4.3 表断言一个 code/status；不得 409/503 二选一，不得为过渡实现新增固定错误码 | §4.3、§7.1 |

## 2. 六段总览、依赖与执行顺序

六段按依赖排序编号；覆盖本轮要求的全部六个领域。执行顺序为 S1→S2→S3→S4→S5→S6，逐段停手复审。

| 阶段 | 领域 | 执行序 | 依赖（前置须已 PASS） | 契约锚点 | 主文件 |
|---|---|---|---:|---|---|
| S1 | 持久单飞 / CAS | 1 | v3 卡文提交 | §4.1、§4.2、§4.4、§4.5、§7.1 | `domain.js`、两份测试 |
| S2 | 缓存签名（prepay 与 clientParams 分离） | 2 | S1 | §4.1.1、§4.5、§7.1 | `domain.js`、`wechat-pay.js`、两份测试 |
| S3 | 流水事实唯一幂等 | 3 | S1（语义；线性前置 S2） | §5、§7.2、§7.4 | `domain.js`、两份 Store、两份测试 |
| S4 | 查询对账与 `failed` 终态 | 4 | S1、S2、S3 | §4.3、§4.3.1、§4.3.2、§4.4、§7.1 | `domain.js`、`wechat-pay.js`、两份测试 |
| S5 | 独立隐私同意 | 5 | S1、S3、S4 | §6.1、§6.2、§6.5、§7.3 | `domain.js`、两份 Store、小程序页、后台 UI、两份测试 |
| S6 | 旧数据兼容 | 6 | S4、S5（S3 口径） | §6.3、§6.4、§7.3 | `domain.js`、小程序页、后台 UI、两份测试 |

**为何缓存先于查询**：query 的 `NOTPAY` 需要“有可复用 `ready` 参数则返回缓存”，query 的 `SUCCESS` 需要 S3 的跨订单事实在同一事务落账；因此 S2、S3 必须先于 S4。**任何一段不得跳序**。

依赖列为**语义依赖**；执行序同时是无合并分支的线性父链。线性父链只用于提交历史，**不是测试依赖**：任何段不得因后续段未实现而无法独立验收，见 §3.10。

### 2.1 分支与提交模型

- S1 从本卡提交新建实施分支；Sn 从 S(n-1) 的 Codex PASS tip 新建；分支名由实现会话在入口记录（建议 `feat/rental-s<N>-<topic>`）。
- 每段只允许**追加提交**；禁止 `amend`/`rebase`/`reset`/`squash`/`force`/`cherry-pick`/合并。普通 push 后以 `ls-remote` 核对。
- 实施分支不得修改契约卡、本卡、`docs/RENTAL-PRESIGNING.md`；契约 §8 的部署清单/索引/权限更新随部署门禁执行，部署冻结期间不改该文档，避免把未执行的部署写成事实。不得写入任何全局 Git 配置；网络命令逐命令带 `safe.directory` 与 TLS 后端。
- **逐段独立批准**：本卡复审 PASS 不自动批准 S1；Sn 的 PASS 不自动批准 S(n+1)。每段开始前须有该段单独的书面批准（批准范围 + 批准时 tip SHA）；未获该段批准不得改代码/测试。
- 每段完成后**停手**等 Codex 独立复审；未获该段 PASS 不进入下一段；不自批。§8 任一与某段相关的业务待裁未裁定前，该段保持 BLOCKED，不得以“默认口径/占位实现/稍后补裁”自动放行；§13 材料不足不构成放行。

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
| 首笔真实支付事实（合格） | `rental_payment_transactions` + 订单 + hold（eligible） | 1 | 外部事实例外 |
| 真实到账、订单/hold 独立有效但仅缺同意（S5 起） | 事实 + 订单 `privacyReviewStatus=consent_required`；保留现有有效 hold（不新 hold） | 1 | 缺同意不是退款依据（I9） |
| 重复通知/流水冲突/跨订单冲突 | 全库零 | 0 | 现 `applyPayment` 重复路径仍会写 audit，S3 必须改为零写 |
| 真实到账且订单独立失效/旧单/新占位 | 事实 + 订单 `refund_required` | 1 | 独立失效依据；非隐私；新 hold 不变 |
| 退款事实 | 独立已批准依据 + 退款事实 | 待 §9.2 | 未批准前不实现、不声称通过 |
| 订单生命周期释放 hold（取消/拒绝/未付款关闭/失效） | 订单/hold | 1 | 现有动作，非支付失败自动释放 |
| 缓存命中 / 本地重签 | 仅必要时 `clientParams` | 0 | 不重复成功审计、不重复 create |
| 同意记录创建 / 重复同意 | 同意集合（重复为 0） | 首个 1；重复 0 | 用户动作；重复幂等零写 |

`paymentRequest` 的 claim/lease/`reconciling`/`failed` 写入是**内部状态/待对账**，不得伪称“全库零写”，也不得计为支付事实。

### 3.4 S4 之前的失败关闭（实现细节，非验收证据）

S4 交付前，需要 query 才能决定的路径（prepay 过期、`reconciling` 接手、损坏缓存）只允许 fail-closed：`create` 0 次、不返回参数、0 审计、保留现有有效 hold；不得 create，也不得回退 `none`。这些路径的 query 结果与 HTTP code/status 在 S4 之前 **DEFERRED(S4)**，不计入 S1/S2/S3 的 PASS；S1/S2/S3 不得以临时 503、占位断言或“稍后由 S4 覆盖”证明契约行为。S4 按 §4.3 唯一 code/status 补齐，并删除/替换所有占位断言。

### 3.5 测试 guard：加载前安装与逐入口负控

- 每次阶段测试运行必须先安装 guard，再加载/导入任何被测业务模块（`cloudfunctions/leasing/domain.js`、`index.js`、`store.js`、`wechat-pay.js`、`admin-web/lib/store.mjs`）。测试文件顶层只允许静态 import/require Node 内建与 guard 自身；被测模块必须在 guard 安装后动态 import/require，并在 `assertNoLoadTimeViolation()` 通过后运行用例。
- guard 自身不得监听端口、不得真实连网；guard 的自检也不得例外。
- 必须覆盖以下入口，逐入口负控（缺一即证据不完整，BLOCKED）：
  `net.createServer`、`net.Server.prototype.listen`、`http.Server.prototype.listen`、`https.Server.prototype.listen`、`net.connect`、`net.createConnection`、`net.Socket.prototype.connect`、`tls.connect`、`http.request`、`http.get`、`https.request`、`https.get`、`globalThis.fetch`、`dns.lookup`、`dns.resolve*`（逐一展开）、`dns.promises` 的解析入口（逐一展开）、`dgram.createSocket`、`dgram.Socket.prototype.send/bind/connect`。
- 每个入口的负控必须证明：调用被拦截、违规计数 +1、返回安全 sentinel、**不转发真实原始函数**、不产生真实 socket/请求；不得只断言“抛错”而不证明未触网。
- 加载期违规永久保留，运行期重置不得清除；加载期有任何违规即失败，不得继续执行用例。
- guard 不得提供环境变量/开关/配置绕过；不得在违规后回退真实函数；不得重复安装造成嵌套污染。
- guard 实现放在测试专用文件 `tests/rental-network-guard.cjs`（S1 新增，列入 S1 允许文件；只在 S1 新增，后续段不得修改，除非该段入口单独批准）。若 Codex 拒绝新增该文件，则必须在两个测试文件内各自内联同等 guard，并仍满足本节全部要求；不得以“无共享文件”为由降低控制。

### 3.6 必要依赖正控

- 必须证明 guard 未误伤必要依赖：`node:crypto` 的 RSA-SHA256 签名/验签、AES-256-GCM 加解密、`node:fs/promises` 临时目录读写与清理、`node:buffer`/`node:url`、`node:path`/`node:os`（临时目录定位），以及注入的支付适配器 mock（非网络）调用。
- 正控必须产生真实结果（如验签 true、解密原文一致、临时文件可读写、mock create/query 返回预期值），不得只断言“未抛错”。
- 任一必要依赖正控失败 = guard 过度拦截，阶段 BLOCKED。

### 3.7 ESM 命名绑定与子进程继承

- ESM：guard 安装后必须 `syncBuiltinESMExports()`，并用负控证明 `import { request } from "node:http"` 等 ESM 命名绑定与 CJS 默认导出路径同样被拦截；只拦截 CJS 属性不算通过。
- 子进程：任何测试/辅助脚本使用 `spawn`/`fork`/`exec` 时，必须通过 `NODE_OPTIONS=--import <guard>`（ESM）或 `--require <guard>`（CJS）让子进程继承 guard；子进程内发起 `net.connect`/`fetch` 的负控必须被拦截并回传违规。
- 即使本阶段不使用子进程，也须在 guard 自检中完成至少一次真实子进程继承负控；并以静态断言证明测试代码无未受控 `child_process` 调用。环境不支持子进程时按 §3.8 处理（BLOCKED），不得跳过或伪造。

### 3.8 环境失败口径

- guard 安装失败（入口不可配置、`syncBuiltinESMExports` 失败、重复安装）、入口缺失/非函数、加载期违规、负控未触发违规或泄漏真实网络、正控失败、子进程继承失败：一律 BLOCKED 并终止本次运行，不得降级为“无 guard 运行”、不得重试绕过、不得改写环境规避。
- 入口在特定 Node 版本不存在时，默认 BLOCKED；只有 Codex 书面批准“该版本无此入口”才可登记为显式豁免，且必须给出替代覆盖；豁免不得扩大。
- 每次运行证据记录 `process.version`、平台、guard 入口数、负控通过数、正控通过数、子进程负控结果；环境差异不得以 skip 代替失败。

### 3.9 显式非监听文件清单

必须证明以下文件在加载期与运行期均不监听（`listen` 调用 0、无真实 TCP/UDP 句柄）：

```text
cloudfunctions/leasing/domain.js
cloudfunctions/leasing/index.js
cloudfunctions/leasing/store.js
cloudfunctions/leasing/wechat-pay.js
admin-web/lib/store.mjs
admin-web/tests/leasing.test.mjs
tests/leasing.test.cjs
tests/rental-network-guard.cjs   # 仅测试 guard；同样不得监听
```

明确排除、不得运行：`admin-web/tests/server.test.mjs`（HTTP 套件）、任何 `npm test`/glob/`tests/*.test.mjs` 全量；不得以启动本地服务器替代测试或作为验收证据。

### 3.10 测试预期闭合与禁止占位 PASS

- 每个运行场景（`DEFERRED(Sn)` 除外）必须同时给出并断言：唯一 HTTP code/status、允许写集或全库零写（含 audit）、audit 次数、适配器 create/query 次数。运行场景出现“—”“0/1”“409/503”“待定/TBD”即未闭合，不得 PASS；纯静态断言必须显式标注“静态/非 HTTP”；`DEFERRED` 必须显式标注且不计入 PASS。
- 成功路径：领域服务断言正常返回（不抛错）；云函数层断言 `code:0`。错误路径：领域服务断言 `error.status` 与唯一 code；云函数层断言同一 `code`。错误码只用 §4.3 固定值（409 `PAYMENT_PARAMS_IN_PROGRESS`、503 `PAYMENT_QUERY_UNAVAILABLE`、`failed` 后 409 现有不可支付）及其余既有 401/403/404/409；不得只断言“抛错”或只断言 message。
- 全库零写：`before = structuredClone(store.data)`、`after = structuredClone(store.data)`、`deepEqual`，含 `admin_audit`；允许写集必须逐文档逐字段列明，其余集合/文档 `deepEqual`。
- 阶段自包含：每段测试只断言本段已实现行为；依赖后续段的行为必须标 `DEFERRED(Sn)`，不计入 PASS，也不得用临时/占位实现使其通过。语义依赖见 §2 表；线性分支父只用于无合并历史，不构成测试依赖。
- S4 的 eligible 口径是 S5 之前的基线（订单/hold/证件）；S5 引入同意绑定后，必须显式更新受影响的 S4 回归并重跑，不得静默改变 S4 已验收断言；更新须在该段证据中列出。
- 禁止 `skip`/`todo`/`only`/条件跳过计入通过；未执行的场景 = FAIL/BLOCKED。每段 PASS 必须列出：执行数、通过数、失败数、跳过数（必须为 0）、`DEFERRED` 清单、guard 自检结果。

### 3.11 阶段过渡路径错误断言（本段自有，逐项唯一）

本表只列各段自有、可在本段闭环的过渡/错误路径；未列路径不得作为本段 PASS。写集“无”= 全库零写（含 audit）；其他写集只允许列出字段，其余文档 `deepEqual`。

| 阶段 | 过渡/错误路径 | 唯一 code/status | 写集 | audit | create | query |
|---|---|---|---|---:|---:|---:|
| S1 | 有效 lease 内第二方 claim | 409 `PAYMENT_PARAMS_IN_PROGRESS` | 无 | 0 | 0 | 0 |
| S1 | 订单过期/hold 非本单/已释放/材料变化 | 409（现有订单/材料不可支付；不新增码） | 无 | 0 | 0 | 0 |
| S1 | create 超时/5xx | 503（现有支付适配器失败；非查询 503） | `paymentRequest=reconciling` + `externalRequestSentAt` | 0 | 1 | 0 |
| S2 | hold/order 失效 | 409（现有） | 无 | 0 | 0 | 0 |
| S3 | 空/非法 txid、同单异流水、跨订单流水、事实不一致 | 409 | 无 | 0 | 0 | 0 |
| S4 | 有效 lease/NOTPAY 无缓存/USERPAYING | 409 `PAYMENT_PARAMS_IN_PROGRESS` | `paymentRequest=reconciling` + `lastQueryAt` | 0 | 0 | 1 |
| S4 | query 超时/网络/验签失败/未知/绑定不符 | 503 `PAYMENT_QUERY_UNAVAILABLE` | `paymentRequest=reconciling` + `lastQueryAt` | 0 | 0 | 1 |
| S4 | CLOSED/REVOKED/PAYERROR/ORDER_NOT_EXIST | 409（failed 后现有不可支付） | `paymentRequest=failed` + `queryEvidence` | 0 | 0 | 1 |
| S5 | `privacyVersion` 缺失/非整数/旧值/冒充 | 409（现有；不新增码） | 无 | 0 | 0 | 0 |
| S5 | 显式整数 `privacyVersion` = 当前值 | 成功（领域返回；云函数 `code:0`） | 无新增（材料/同意已有） | 0 | 0 | 0 |
| S6 | 旧 settings 无同意/旧客户端不符 | 409（现有） | 无 | 0 | 0 | 0 |
| S6 | 升级后显式当前整数 | 成功（领域返回；云函数 `code:0`） | 无新增 | 0 | 0 | 0 |

- `prepay` 过期/损坏缓存不在 S2 表内；S4 由 S4-5/S4-7/S4-9 的 query 结果覆盖，触发条件不另设占位码。
- 本表与各段回归表冲突时，以本表为准并先停手报 Codex；不得用 `DEFERRED` 行充数。

## 4. 阶段卡

### 4.1 S1 持久单飞与 CAS

**入口**：本卡 v4 最终提交为父（SHA 以交付报告为准）；契约 blob 未变；工作树干净；无额外文件。

**允许文件（唯一）**：

```text
cloudfunctions/leasing/domain.js
cloudfunctions/leasing/store.js      # 仅当 transact 选项/写入形状确需；默认不改
admin-web/lib/store.mjs              # 仅同上；默认不改
admin-web/tests/leasing.test.mjs
tests/leasing.test.cjs
tests/rental-network-guard.cjs       # 新增测试 guard（仅测试；按 §3.5–3.9）
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
10. 测试基础设施：按 §3.5–3.9 新增 `tests/rental-network-guard.cjs` 并改造两个租赁测试为“guard 先装、被测模块动态导入”；逐入口负控、必要依赖正控、ESM/子进程继承、环境失败口径、非监听清单全部纳入 S1 与后续每段证据。

**正/负并发回归**（create/query 为适配器计数；“零写”指 §3.2）：

| # | 场景（正=允许，负=拒绝） | create | query | 期望 | audit |
|---|---|---:|---:|---|---:|
| S1-1 | 正：两并发首次请求 | 1 | 0 | 仅一个 `ready`；另一个 409 `PAYMENT_PARAMS_IN_PROGRESS`；单一 `paymentRequest`；单一成功审计 | 1 |
| S1-2 | 负：有效 lease 内第二方 | 0 | 0 | 409；全库零写 | 0 |
| S1-3 | 正：create 成功 + complete CAS 有效 | 1 | 0 | `ready` + prepay/clientParams 持久化 | 1 |
| S1-4 | 负：旧 epoch complete | 0 | 0 | 被拒绝；当前 epoch 不变；全库零写 | 0 |
| S1-5 | 负：订单过期/hold 非本单/已释放/材料变化 | 0 | 0 | 409（沿用现有订单/材料不可支付 409，唯一码）；全库零写；不释放 hold | 0 |
| S1-6 | 正：本地 create 前校验失败（`externalRequestSentAt` 未写） | 0 | 0 | 最终 `none`；无残留 `preparing`；0 audit | 0 |
| S1-7 | 负：已写 `externalRequestSentAt` 后尝试回退 `none` | 0 | 0 | 拒绝回退；保持待对账；0 audit | 0 |
| S1-8 | 正：create 超时/5xx | 1 | 0 | `reconciling`；参数不返回；订单/hold 不变 | 0 |
| S1-9 | 负：complete 与接管并发（CAS 失败） | 1 | 0 | `reconciling`；旧 attempt 不覆盖新 epoch | 0 |
| S1-10 | 负：`failed` 终态再次请求 | 0 | 0 | 409；`deepEqual`；保留全部事实字段 | 0 |
| S1-11 | 正：失败/超时后有效 hold 保留 | 1 | 0 | `hold.until`/`hold.orderId` 原样 | 0 |

**审计/零写**：claim/sent/`reconciling` 仅允许 `paymentRequest` 内部写、0 audit；`ready` 恰好 1 条；其余失败/409 全库零写（含 audit）。不得把内部状态写称为“全库零写”。`failed` 与 `externalRequestSentAt` 的进入转移由 S4 验收；S1 仅以 fixture 预置状态验证拒绝/保留，不计入 S4 行为。

**证据**：`admin-web` 与根目录逐文件运行（仅 `admin-web/tests/leasing.test.mjs`、`tests/leasing.test.cjs`），并按 §3.5–3.9 附 guard 结果（加载前安装、加载期违规 0、逐入口负控、必要依赖正控、ESM 命名绑定、子进程继承 1/1、非监听清单、环境失败口径）；逐用例适配器计数、`deepEqual`/允许写集；`git diff --stat`、完整 SHA/父。**停止点 S1**：提交并普通 push；停手等 Codex；不进入 S2；不合并/不部署。

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
4. `prepay` 过期：缓存失效，不返回旧参数、不 create；该路径**不属于 S2 验收**，由 S4 以 query 表覆盖；S2 不得以临时 503 或占位断言计入 PASS。
5. 订单失效或自有 hold 失效：缓存不可用，409，不 create、不返回参数、0 audit。
6. `clientParams.package` 内 prepay 标识必须等于 `prepay.prepayId`；不一致按损坏缓存处理：不返回、不 create、0 audit；该路径**不属于 S2 验收**，由 S4 覆盖。
7. 并发重签允许两者都成功（本地签名、无外部 create）；仅一份 `prepay`，`clientParams` 后写者生效；不得因此新增 prepay 或审计。
8. 永不因签名/缓存问题回退为 create；不得复用旧 `out_trade_no` 发起第二次 create。

**正/负回归**：

| # | 场景 | create | query | 期望 | audit |
|---|---|---:|---:|---|---:|
| S2-1 | 正：prepay 与签名均有效 | 0 | 0 | 返回同一组参数；全库零写 | 0 |
| S2-2 | 正：签名过期、prepay 有效 | 0 | 0 | 本地重签；`prepayId` 不变；仅 `clientParams` 变化 | 0 |
| S2-3 | 负：hold 已释放/非本单 | 0 | 0 | 409；不返回参数；全库零写 | 0 |
| S2-4 | 负：订单支付截止已过 | 0 | 0 | 409；不返回参数；全库零写 | 0 |
| S2-5 | 正：两并发重签 | 0 | 0 | 两者均得有效参数；单一 prepay；无新增审计 | 0 |
| S2-6 | 负：TTL 误设为订单截止 | 0 | 0 | 断言 `prepayExpiresAt`/`signatureExpiresAt` 不等于 `paymentDeadline` 来源 | 0 |

**审计/零写**：缓存命中与本地重签 0 audit；失败/409 全库零写；仅 S1 的 create 成功路径有成功审计。

**证据**：同 S1 口径，另记录 TTL 配置值与“签名/缓存分离”断言。**停止点 S2**：提交并普通 push；停手等 Codex；不进入 S3。

### 4.3 S3 流水事实唯一幂等

**入口**：S2 PASS（线性分支父；S3 测试不依赖 S2 行为，语义依赖仅 S1 的审计/状态口径）；其余同 §4.1 入口。

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
| S3-9 | 正：两条同流水通知并发 | 0 | 0 | 一条事实；另一方幂等零写零 audit | 首个 1；幂等方 0 |
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

1. 接管/未知后**先 query**：lease 过期接手必须先 CAS 写 `epoch+1`/新 `attemptId`/`reconciling`，仅 CAS 胜者 query（败者 409、query 0），create 0 次；任何情况下先查后决，不 create。
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
   **逐场景唯一 code/status（只允许一个，不得二选一）**：有效 lease/`NOTPAY` 无缓存/`USERPAYING` → 409 `PAYMENT_PARAMS_IN_PROGRESS`；query 超时/网络/验签失败/未知/绑定不符 → 503 `PAYMENT_QUERY_UNAVAILABLE`；`failed` 后再次请求 → 409（现有订单不可支付）；`SUCCESS`/`REFUND` 为数据处理结果，不新增错误码。
6. `failed` 人工 query：仍 `failed`，仅补记 `queryEvidence`/`lastQueryAt`（带 `attemptId`+`epoch`）；不 create、不自动重试。
7. `failed` 后验签 `SUCCESS` 通知/查询：写真实支付事实；旧单/失效单 `refund_required`；不丢弃、不因 `failed` 拒绝事实。
8. 支付事实优先：已有验签 `SUCCESS` 事实/`transactionId` 时，`CLOSED`/`REVOKED`/`PAYERROR`/`ORDER_NOT_EXIST` 不得覆盖/删除事实或写成 `failed` 掩盖；按既有事实/退款对账处理。
9. 不定义第二次 create、不生成新商户订单号、不复用旧 `out_trade_no` 重发；不对 `failed` 做自动/定时重试。
10. 关闭 S1/S2 标记为 `DEFERRED(S4)` 的场景：以 §4.3 唯一 code/status 断言替换其 fail-closed 占位，并在 S4 证据中列出闭环清单；不得把 `DEFERRED` 场景重新标记为通过而不执行。
11. `prepay` 过期/损坏缓存触发 query 后，分别由 S4-5（`NOTPAY` 无缓存 409）、S4-7（`CLOSED` 等 409）、S4-9（未知 503）覆盖；不新增“触发专用”错误码。

**正/负回归**：

| # | 场景 | create | query | 期望 | audit |
|---|---|---:|---:|---|---:|
| S4-1 | 正：lease 过期接手 | 0 | 1 | `epoch+1`；CAS 后 query；不 create | 0 |
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
| S4-14a | 负：有效 lease 内第二方 | 0 | 0 | 409 `PAYMENT_PARAMS_IN_PROGRESS`；create 0；全库零写 | 0 |
| S4-14b | 正：lease 过期两并发接手 | 0 | 1 | 仅一方 `epoch+1`；胜者 query 1、败者 0；另一方 409；create 0 | 0 |
| S4-15 | 负：任何自动重试/第二次 create 路径 | — | — | 静态断言无定时器/自动重试/新 `out_trade_no` 分支 | 0 |
| S4-16 | 负：错误码唯一性 | — | — | 逐用例只断言 §4.3 唯一 code/status；无 409/503 二选一；过渡码断言已删除 | 0 |

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
7. `applyPayment` 的同意检查只影响 eligible/hold 判定**不阻止事实落账**：事实必须写（S3/I6）；**缺同意本身不得触发 `refund_required`**：订单/hold 独立有效时置 `privacyReviewStatus=consent_required` 并保留现有有效 hold（不新 hold）；只有独立失效事实（订单过期/旧单/占位被替换/证件独立失效）才走 `refund_required`，且退款/释放 hold 仍须 §9.2 已批准依据。
8. 小程序读取 `settings.privacyVersion` 并上传该值；提供“重新同意”入口展示当前 privacyText；旧客户端不得静默放行。服务端判定仅比较显式整数 `privacyVersion` 与当前值（I10），不得推断客户端版本。**正例**：显式整数 `privacyVersion === settings.privacyVersion` 是唯一合法输入；通过时保留原有有效材料绑定与同意记录，不要求重传/重新同意，并据其继续资格判定（quote/createOrder/paymentParams/finishOrder）。
9. 后台展示同意/待复核状态（`admin-web/public/leasing-ui.js`），不返回证件图片/密文。
10. 隐私变化不是退款依据；不得由 `privacyReviewStatus` 自动写 `refund_required`。
11. S5 引入同意绑定后，显式更新并重跑受影响的 S4 回归（eligible/`paid_held`/`refund_required` 判定），在证据中列出变更；不得静默改变 S4 已验收断言。

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
| S5-0 | 正：显式整数 `privacyVersion` = 当前值（资格校验） | 0 | 0 | 通过；有效材料绑定/同意/资格保留；不重传、不新增同意、无 409 | 0 |
| S5-8 | 负：客户端 `privacyVersion` 不符 | 0 | 0 | 409；全库零写 | 0 |
| S5-9 | 正：两并发同版本同意 | 0 | 0 | 单条同意记录；重复方幂等零写 | 首个 1；幂等方 0 |
| S5-10a | 正：缺同意、订单/hold 独立有效时真实到账 | 0 | 0 | 事实保留；保留现有有效 hold（不新 hold）；`privacyReviewStatus=consent_required`；不转 `refund_required`；**不退款** | 1 |
| S5-10b | 正：缺同意且订单独立失效/旧单到账 | 0 | 0 | 事实保留；`refund_required`（独立失效依据，非隐私）；新 hold 不变 | 1 |
| S5-11 | 负：非 owner 同意 | 0 | 0 | 404；全库零写 | 0 |
| S5-12 | 负：缺同意被一律退款 | — | — | 静态/行为断言：缺同意不单独写 `refund_required`；退款仅独立依据 | 0 |
| S5-13 | 负：以 templateVersion/版本号推断客户端 | — | — | 只读显式 privacyVersion；发送 templateVersion 与任意 clientVersion 字段均按隐私值判定 | 0 |

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
4. **旧客户端判定可验证、策略明确**：服务端不读取/不推断客户端版本（禁止 UA、客户端版本号、发布渠道、`templateVersion` 比较或缺失字段猜测）；只校验请求显式提交的 `privacyVersion`：必须是整数且等于当前 `settings.privacyVersion`。缺失、`null`、字符串、旧值、以 `templateVersion` 冒充 → 同一 409（沿用现有刷新/重新同意 409 语义，不新增固定 code），全库零写；客户端必须刷新并显式重新同意。兼容策略：**不提供静默兼容分支**；升级窗口/提示文案见 §8。
5. 旧已付订单无同意记录：保留支付事实与 hold；`privacyReviewStatus=consent_required`；`finishOrder` 拒绝；重新同意绑定现有有效证件后清除标记、继续原订单签约；**不重新下单、不重新缴款**；缺同意不写 `refund_required`，退款须独立依据。
6. 已付订单隐私变化：同 5；支付事实/退款状态与隐私待复核分离；不得因隐私自动退款，也不得把缺同意转成 `refund_required`。
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
| S6-6a | 负：旧客户端缺失/非整数/旧值 `privacyVersion` | 0 | 0 | 409（现有隐私刷新语义，唯一 409）；全库零写 | 0 |
| S6-6b | 负：以 `templateVersion` 冒充隐私版本 | 0 | 0 | 409；服务端未读取 templateVersion 作同意判断；全库零写 | 0 |
| S6-6c | 负：任意 clientVersion/UA/渠道字段 | 0 | 0 | 判定与这些字段无关；只按 privacyVersion | 0 |
| S6-7 | 正：非隐私变更 | 0 | 0 | `privacyVersion` 不变；不重同意 | 0 |
| S6-8 | 正：旧未付款订单隐私变化 | 0 | 0 | 失效/释放 hold/清缓存；重同意后新单 | 1 |
| S6-9 | 正：旧缓存参数到账 | 0 | 0 | 事实 + `refund_required`；新 hold 不变 | 1 |
| S6-10 | 负：迁移式回填/改写旧记录 | — | — | 静态断言无迁移写路径；旧记录原样 | 0 |
| S6-11 | 负：旧已付缺同意被转退款 | — | — | 静态断言：`consent_required` 路径不写 `refund_required`；退款仅独立依据 | 0 |
| S6-12 | 正：旧数据升级后显式整数 `privacyVersion` = 当前值 | 0 | 0 | 通过；不判为旧客户端；有效材料绑定/同意/资格保留 | 0 |

**审计/零写**：拒绝/读取 0；同意 1；旧付款事实按 S3；不得在 GET/失败路径写库。

**证据**：旧数据 fixture 的前后 `deepEqual`（除允许同意记录）、旧已付订单不重缴、旧客户端拒绝、无迁移写。**停止点 S6**：提交并普通 push；停手等 Codex；本卡全部阶段结束，仍不合并/不部署。

## 5. 全局验收门（每段逐条核对，任一未过即 BLOCKED）

| 门 | 要求 |
|---|---|
| G1 | I1–I8 全部成立（I9–I12 另见 G9–G12）；特别是“确认失败禁止重发、`externalRequestSentAt` 保留、有效 hold 保留、重新同意不重传、有效已付不重缴” |
| G2 | 适配器 `create`/`query` 计数与用例表逐项一致；无隐藏 create、无重试循环 |
| G3 | §3.3 的零写/审计例外逐项成立；no-op 路径 `deepEqual`（含 audit） |
| G4 | 仅改本段允许文件；契约卡/本卡零改动；`git diff --name-only` 与允许集完全一致 |
| G5 | 测试只运行 `admin-web/tests/leasing.test.mjs` 与 `tests/leasing.test.cjs`；无 glob/`npm test`/HTTP/`server.test.mjs`；记录 exit 与计数 |
| G6 | 追加提交、普通 push、`ls-remote` 核对；无 amend/rebase/reset/squash/force/cherry-pick/merge；无全局 Git 配置写入 |
| G7 | 不部署、不接真实支付、不开 HTTP/UI、不连设备/业务云、不安装依赖 |
| G8 | 证据含完整 SHA/父/文件范围/命令/exit/计数/适配器计数/零写断言/远端状态/未验证 |
| G9 | **逐段独立批准**：本卡 PASS 不自动批准任何阶段；每段须单独书面批准（范围 + tip SHA）；§8 相关业务待裁未裁定前该段 BLOCKED，§13 材料不足不构成放行；执行者不自批 |
| G10 | 错误唯一：逐用例只断言 §4.3 一个 code/status；无 409/503 二选一；无过渡错误码；无新增固定码 |
| G11 | 缺同意不退款：真实到账落账；订单/hold 独立有效时 `consent_required` 且保留现有有效 hold（不新 hold）；`refund_required` 只由独立依据触发 |
| G12 | 旧客户端判定可验证：仅显式整数 `privacyVersion` 比较；无版本/UA/渠道/`templateVersion` 推断；兼容策略无静默分支 |
| G13 | Guard 闭合：加载前安装、加载期违规 0、逐入口负控全过、必要依赖正控全过、ESM 命名绑定被拦截、子进程继承 1/1、非监听清单全过、环境失败口径已记录 |
| G14 | 无占位 PASS：每段自包含；`DEFERRED` 不计入通过；无 skip/todo/only/条件跳过；PASS 含执行/通过/失败/跳过（0）与 deferred 清单 |
| G15 | 预期闭合：每个运行场景（静态/`DEFERRED` 除外）有唯一 code/status、零写/允许写集（含 audit）、audit 次数、适配器 create/query 次数；不得用“—/0/1/409/503/待定”等含糊值；计数 0 必须对应明确断言 |
| G16 | §13 材料不足已登记；T1–T13 技术项按已裁定执行、不重推；业务门禁仍见 §8；不得把未取得正文写成已闭合 |

## 6. 每段交付格式（缺项视为未完成）

1. 本段完整 SHA、父 SHA、分支、远端 tip（`ls-remote` 实测）。
2. `git diff --stat` 与 `git diff --name-only`，逐项对照允许文件。
3. 逐文件测试命令、工作目录、exit code、执行/通过/失败/跳过（必须 0）计数；按 §3.5–3.9 的 guard 结果（加载期违规 0、逐入口负控 N/N、必要依赖正控 M/M、ESM 命名绑定、子进程继承 1/1、非监听清单、环境失败口径）。
4. 每个回归用例的唯一 code/status、适配器 create/query 计数、审计计数、`deepEqual`/允许写集结果。
5. 契约锚点逐项对照（§ 与行号，按契约 blob `94d61ed…`）。
6. 未验证/不可验证项与待裁项。
7. 声明“未合并、未部署、未开 HTTP/UI、未接真实支付/设备/业务云”。
8. `DEFERRED(Sn)` 清单（明确不计入本段 PASS）与 S4 闭环清单。

## 7. 禁止项与冻结

- 本版提交轮：**不实施、不运行测试、不改契约/生产代码/测试/Store、不安装依赖、不接真实支付/云/设备、不开 HTTP/UI**。
- 实施轮（获批准后）：不合并、不部署上线、不接 C2/C3、不改 HTTP/UI 接线、不跑真实商户、不使用真实证件、不写全局 Git 配置、不改既有契约。
- 全程禁止 `amend`/`rebase`/`reset`/`squash`/`force`/`cherry-pick`/合并；只允许普通追加提交与普通 push。
- 不定义第二次 create/新商户订单号；不放行“确认后重发”；人工重置/退款另案。

## 8. 待裁（仅业务门禁；未裁定即阻塞相应阶段，不得默认放行）

| # | 业务事项 | 阻塞阶段 | 说明 |
|---|---|---|---|
| 1 | 人工重置/退款流程 | S4（`failed` 人工处置）、S3（退款事实） | 契约 §9.1；本卡不放行重发 |
| 2 | 退款独立依据清单与审批 | S3/S4 | 契约 §9.2；未批准前不实现退款事实/不声称通过 |
| 3 | 隐私变化是否还需后台重审原材料 | S5/S6 | 契约 §9.3；未裁定前不得以“审核可保留”默认放行 |
| 4 | 旧 settings/旧证件 `privacyVersion=0` 的迁移展示与升级窗口 | S6 | 契约 §9.4 |
| 5 | 已付订单退款操作规范 | S3/S4 | 契约 §9.8 |
| 6 | 确认后重发（新商户订单号） | 不授权 | 契约 §9.9；本卡明确不放行 |
| 7 | 旧客户端兼容窗口/提示文案/强制升级策略 | S6 | 兼容策略须明确且可验证；未裁定前不得声称兼容或上线 |
| 8 | 已付但待同意期间 hold 到期后的展期/处理 | S6 | 契约未明确；未裁定前不得自动退还/自动延期/自动改写订单 |
| 9 | 缺同意到账后是否补建 `paid_held`/新 hold 与同意后的状态恢复 | S5/S6 | 本卡只保留事实与现有有效 hold、不新 hold、不自动退款；补建/展期另裁 |

技术项 T1–T13 已由派单裁定（正文未取得，见 §13），不再列为业务待裁；部署/索引/权限、真实商户 query 语义、TTL、`privacyReviewStatus` 持久化等按裁定执行，不重开、不重复列技术待裁。

## 9. 未验证与不可验证（本卡）

- 本轮只做卡文修订（v4）：未运行任何测试、未改代码/测试/Store、未安装依赖、未开 HTTP/UI、未接真实支付/云/设备。
- 契约行为逐条来自静态阅读；`domain.js`/`wechat-pay.js`/Store 行号均以基线 `3bf5951`（与输入基线 `fe300bd` 运行时代码零 diff）为准。
- 离线只能验证 `LocalStore` 事务语义；真实云事务冲突/CAS/权限/索引/20000 条上限、真实商户 query 状态、真机与 HTTP 均不可验证。
- 云评审材料未取得本机可读副本：`/workspace/artifacts/FIVE-FOLLOWUPS-REVIEW-2026-11-19/DISPATCH.md`、`REVIEW.md`；已核对 `/workspace/…`（及 `C:\workspace\…`、`D:\workspace\…`）、`D:`–`L:` 的 `\workspace\artifacts\FIVE-FOLLOWUPS-REVIEW-2026-11-19`、项目目录递归、`C:\artifacts`/`D:\artifacts`/`E:\artifacts`/`F:\artifacts`、`%TEMP%\codex-artifact-session-*`、`C:\Users\Administrator\.dsh`/`AppData\Roaming`/`ProgramData`，以及本仓库全 refs 路径检索；均无。**不声称已读、已逐项闭合或已获批准**。
- v1 `C1-epoch-RENTAL-retry-review`、v2 `STAGED-CARDS-REVIEW-2026-11-19`、v3 `SEVEN-TASKS-REVIEW-2026-11-19` 云材料同样缺失；不声称读过。
- §8 业务待裁未裁定前，相应阶段不得实现、不得默认放行；§13 材料不足不构成放行，也不得写成已闭合。

## 10. 当前停止点

本版卡文提交并普通 push 后即停手，交 Codex 独立复审；**不进入 S1、不自批、不合并、不部署、不开 HTTP/UI、不接真实支付/云/设备**。**本卡（含 v4）PASS 不等于任何阶段批准**；S1–S6 每段须另行独立书面批准（范围 + tip SHA），§8 业务待裁未裁定前相应阶段保持 BLOCKED；§13 材料不足不构成放行，且每段结束再次停手复审。

## 11. v2 修订记录（问题 → 位置 → 审批要求）

| # | 问题 | 修订位置 | 审批要求 |
|---|---|---|---|
| 1 | 缺同意被一律退款待处理，未保留真实到账/有效占位，未区分 `consent_required` 与独立退款依据 | I9、§3.3、S5 第 7 项、S5-10a/10b/12、S6 第 5/6 项、S6-11 | Codex 确认：缺同意仅 `consent_required`、保留事实与现有有效 hold；`refund_required` 仅由独立失效/已批准退款依据触发；补建 `paid_held`/展期另裁（§8 业务门禁：缺同意补建/展期） |
| 2 | 旧客户端判断依赖 `templateVersion`/可能猜客户端版本，兼容策略不明确 | I10、S5 第 8 项、S5-13、S6 第 4 项、S6-6a/6b/6c、§8 业务门禁：旧客户端兼容窗口 | Codex 批准：仅显式整数 `privacyVersion` 比较；禁止 UA/版本号/渠道/`templateVersion` 推断；旧客户端显式刷新/重同意，无静默分支 |
| 3 | 错误断言出现 409/503 二选一与过渡 503，未按契约唯一 code/status 收敛 | I12、§3.4、S1-5、S2-3/S2-4、S4 第 5 项、S4-14a/14b/16、G10 | Codex 确认：S1–S3 不断言 query 路径 HTTP 码；S4 按 §4.3 表唯一 code/status；无过渡码、无新增固定码 |
| 4 | 阶段门禁可被整卡批准或上一段 PASS 自动放行，待裁可能默认通过 | I11、§2.1、§5 G9、§8 业务门禁项、§10 | Codex 书面确认逐段独立批准（范围 + tip SHA）；相关待裁未裁定前该段 BLOCKED，不得默认放行 |
| 5 | 需保留已批准单飞/query/no-resend/独立同意契约 | I1–I8 未改；本记录与 §9 声明 | Codex 确认 v2 未放宽 I1–I8，无新增重发/自动重试/强制重传/强制重缴路径 |

## 12. v3 修订记录（问题 → 位置 → 验收要求）

| # | 问题 | 修改位置 | 验收要求 |
|---|---|---|---|
| 1 | guard 与测试预期未闭合：未明确加载前禁止监听/业务网络、逐入口负控、必要依赖正控、ESM/子进程继承、环境失败口径、非监听文件清单 | §3.5–3.9、S1 允许文件/第 10 项/证据、§6 第 3 项、G13 | Codex 确认 guard 在业务模块加载前安装；逐入口负控全过、必要依赖正控全过、ESM 命名绑定被拦截、子进程继承 1/1、非监听清单全过、环境失败一律 BLOCKED；guard 仅测试文件，不在生产代码内 |
| 2 | 存在未实现阶段依赖与占位 PASS：S1/S2 用“S4 收敛”占位、`DEFERRED` 可能被计入通过 | §3.4、§3.10、S2 原第 4/6 项与原 S2-3/S2-4（v3 时编号）、S4 第 10 项、S5 第 11 项、G14 | 每段只断言本段已实现行为；`DEFERRED(Sn)` 不计入 PASS；无 skip/todo/only；PASS 必须列出执行/通过/失败/跳过（0）与 deferred 清单；S5 显式更新并重跑受影响的 S4 回归 |
| 3 | 逐场景唯一 code/status、全库零写/审计例外、适配器次数未完全闭合 | §3.10、S1–S6 回归表、G15 | 每个运行场景必须同时给出唯一 code/status、零写/允许写集（含 audit）、audit 次数、create/query 次数；运行场景不得出现“—/0/1/409/503/待定” |
| 4 | 完整报告中的具体未明测试预期未集中列出 | §13、G16 | Codex 逐项确认或书面裁定 §13；确认前不得作为 PASS 依据；仅测试断言口径，不改业务裁定 |
| 5 | 需保留主要已落实契约（单飞/query/no-resend/独立同意/缺同意不退款） | I1–I12 未改；§9 声明 | Codex 确认 v3 未放宽 I1–I12，无重发/自动重试/强制重传/强制重缴/缺同意自动退款路径 |

## 13. 材料不足与已裁定技术项边界

- 派单称 T1–T13 技术项已裁定；**完整裁定正文未取得**。本卡不重新推断 T 项、不重复列技术待裁、不声称已逐项闭合。
- 未取得材料：`/workspace/artifacts/FIVE-FOLLOWUPS-REVIEW-2026-11-19/DISPATCH.md`、`REVIEW.md`；已核对 `/workspace/…`（及 `C:\workspace\…`、`D:\workspace\…`）、`D:`–`L:` 的 `\workspace\artifacts\FIVE-FOLLOWUPS-REVIEW-2026-11-19`、项目目录递归、`C:\artifacts`/`D:\artifacts`/`E:\artifacts`/`F:\artifacts`、`%TEMP%\codex-artifact-session-*`、`.dsh`/`AppData\Roaming`/`ProgramData` 及本仓库全 refs；均无。**具体挂载位置未知，不猜测已闭合**。
- 本版只完成不依赖该正文的修订：S5-0/S6-12 显式当前整数正例、§3.11 各段过渡错误断言、§8 仅保留业务门禁、S2 不保留未来阶段占位行。
- v3 已列的技术值（缓存/重签/同意 audit、query 次数、guard 命名等）按“已裁定”保留原值；本版不重推、不改写；正文缺失时不得据此声称已核对。
- 若后续取得正文，Codex 可按裁定补记；执行者不得重推 T 项结论，也不得把“未取得正文”写成“已关闭”。
- 业务门禁仍见 §8；技术实现/测试按已裁定执行，正文到手前不得声称已验证。

## 14. v4 修订记录（问题 → 修改位置 → 验收要求）

| # | 问题 | 修改位置 | 验收要求 |
|---|---|---|---|
| 1 | 缺“显式整数 `privacyVersion` = 当前值”的合法正例，未证明保留材料绑定/同意/资格 | S5 第 8 项、S5-0、S6-12、§3.11 | Codex 确认：合法当前整数通过；有效材料绑定/同意/资格保留；不重传、不新增同意、无 409；旧数据升级后同样通过 |
| 2 | 各阶段过渡路径缺唯一 code/status/写集/audit/adapter 计数，且 S2 可能依赖 S4 占位 | §3.11、S2 第 4/6 项（标为非 S2 验收）、原 S2-3/S2-4 query 行移除、S4 第 11 项、G15 | 每个自有过渡路径按 §3.11 唯一断言；S2 不保留 query 依赖行；S4 覆盖 prepay 过期/损坏缓存的 query 结果；无占位 PASS |
| 3 | T1–T13 已裁定但正文缺失，不应重推/重列技术待裁 | §8、§13、§9、G16 | 仅保留 §8 业务门禁；§13 单列材料不足；不重推 T 项、不声称闭合；取得正文后由 Codex 补记 |
| 4 | guard 已在 v3 关闭，不应重开 | §3.5–3.9 未改 | Codex 确认 v4 未改 guard 规则、未新增 guard 待裁 |
| 5 | 需保留主要已落实契约 | I1–I12 未改；§9 声明 | Codex 确认 v4 未放宽单飞/query/no-resend/独立同意/缺同意不退款/逐段独立批准 |
