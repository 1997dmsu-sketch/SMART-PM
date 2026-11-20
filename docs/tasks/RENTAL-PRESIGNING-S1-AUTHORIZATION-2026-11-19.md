# 预签约 S1 独立授权清单（持久单飞 / CAS · 待 Codex 复审）

- 日期：2026-11-20（Asia/Shanghai）
- 执行者：DSH 根代理 `lead`（`deepseek-flash`）；Windows PowerShell 5.1.19041.1 / Git `2.55.0.windows.3` / Node `v24.19.0`
- 执行 run：`RENTAL-S1-AUTH-V3-2026-11-20T0654+0800`（本轮实测时间 `2026-11-20T06:54:44+08:00`）
- 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\rental-s1-authorization`（唯一工作树）
- 分支：`docs/rental-s1-authorization`
- 固定输入（v3）：`a080cdd8126dbe9decd70f411ca2943336f88bc8`（v2 清单提交；本地 HEAD = 输入）
- 本清单父提交：`a080cdd8126dbe9decd70f411ca2943336f88bc8`（v3 为追加提交，**父即本轮固定输入**）
- 父链：`v3` → `a080cdd`（v2 清单）→ `4595757`（v1 清单）→ `8a2f8d9`（T1–T13 裁定回写）→ `4a30e6e`
- 本清单唯一修改文件：`docs/tasks/RENTAL-PRESIGNING-S1-AUTHORIZATION-2026-11-19.md`
- 已批准契约：`docs/RENTAL-OPEN-ITEMS-CONTRACT-CARD.md`（第五版；427 行；blob `94d61ed1c3d44bdb02249aa96e10d57422d5225d`，本清单提交时未变）
- 上级任务卡：`docs/tasks/RENTAL-PRESIGNING-STAGED-IMPLEMENTATION-TASK-2026-11-18.md`（v5；653 行；本清单只引用，不改写）
- 代码基线：`3bf595140088bc71a3939fb67880807965e9c566`；自该基线至 `8a2f8d9` 运行时代码/测试/Store **零 diff**，变更仅两份 docs（契约卡 v5、任务卡 v5）
- 版本：v3（2026-11-20 九裁定落位：503 失败关闭、create 后置单次、ready 不返缓存、单事务 claim+sent、领域证据、helper/旧 complete、leaseUntil=null、子进程 guard、旧数据/损坏/溢出）
- 状态：**仅修订本清单（v3）；不实施、不运行测试、不安装依赖、不改代码/测试/Store/契约/任务卡；待 Codex 独立复审（不自批）**

> **本清单不构成实施授权。** 清单通过（PASS）只表示 S1 的“文件白名单 + 逐例预期 + 失败关闭口径”可被 Codex 复审；S1 开工仍须另有一份**单独书面批准**，写明批准范围与该时刻 tip SHA。批准前不得改任何代码/测试。

## 0. 输入、远端与基线核对（本轮实测）

| 项 | 实测值 | 核验方式 |
|---|---|---|
| 本轮固定输入（v2 清单） | `a080cdd8126dbe9decd70f411ca2943336f88bc8` | `git rev-parse HEAD` |
| 输入父提交（v2 清单的父） | `45957578aca352bc06ec541dd7fbb4433371ac94` | `git rev-parse HEAD^` |
| 父链 | `a080cdd` → `4595757` → `8a2f8d9` → `4a30e6e` | `git log --oneline` |
| 远端 `refs/heads/docs/rental-s1-authorization` | 推送前实测见交付报告；本地 HEAD = 固定输入 | `git ls-remote`（网络权威） |
| 远端 `refs/heads/docs/rental-staged-implementation-task` | 以交付报告的 `ls-remote` 实测为准（预期仍 `8a2f8d9`） | `git ls-remote` |
| 分叉/前移 | 远端若前移即报告、**不替换**；本清单只做父=`a080cdd` 的追加提交 | `ls-remote` + `rev-parse` |
| 工作树 | 干净（`git status --porcelain=v1` 空） | 修订前实测 |
| 运行时代码零 diff | `3bf5951..8a2f8d9` 仅 `docs/RENTAL-OPEN-ITEMS-CONTRACT-CARD.md`、`docs/tasks/RENTAL-PRESIGNING-STAGED-IMPLEMENTATION-TASK-2026-11-18.md` | `git diff --name-only` |
| 契约 blob / 行数 | `94d61ed1…` / 427 | `git rev-parse HEAD:docs/…` + 行数 |
| `domain.js` | blob `5027c5a4e8b38e484e361b1ac3e72cf90985f662`，1085 行，**无 `paymentRequest` 字段** | `git rev-parse HEAD:…`、全文检索 |
| `store.js` / `admin-web/lib/store.mjs` | blob `6b38e8ee…` / `53ffc9df…`；allowed 集合**不含**新集合 | 同上 |
| 两份租赁测试 | `tests/leasing.test.cjs` 175 行 / 3 个 `test(`；`admin-web/tests/leasing.test.mjs` 781 行 / 22 个 `test(` | 行数 + `test(` 计数 |
| `tests/rental-network-guard.cjs` | **不存在**（S1 新增） | 文件系统 |
| 本轮裁定来源 | 派单明确给出的九条裁定（§11.1 逐条落位）；云材料正文仍未取得 | 派单文本；文件路径核对见 §11.2 |
| 不纳入分析对象 | C/D 文档工作树起点 `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` **不作为**本轮分析对象或输入替代 | 本清单显式排除 |
| fetch 环境告警（记录，不掩盖） | `git fetch --no-write-fetch-head origin --prune` 退出码 0，但 stderr 报 `refs/remotes/origin/HEAD.lock: Permission denied`（共享 `.git` 目录锁/ACL 问题） | stderr 原文 |

fetch 告警的处置：远端事实一律以 `git ls-remote`（网络权威）为准，未依赖可能未更新的 remote-tracking ref；未改动任何 Git 配置、未使用 TLS 绕过。

### 0.1 文档父与“实际实施起点”必须分清

| 概念 | SHA / 位置 | 说明 |
|---|---|---|
| 本清单父提交 | `a080cdd8126dbe9decd70f411ca2943336f88bc8` | v2 清单提交；v3 在其上追加 |
| 本清单提交（记为 **X**） | 提交后由交付报告给出完整 SHA | 仅修本清单；X 的父是 `a080cdd` |
| S1 **实际实施起点** | **X**（不是 `a080cdd`、`4595757` 或 `8a2f8d9`） | S1 实施分支必须从 X 新建；X 必须在实施分支历史中 |
| S1 实施分支（建议名） | `feat/rental-s1-persistent-single-flight` | 从 X 新建，普通 push，追加提交 |
| 清单 PASS 的含义 | 仅“清单可复审” | 不等于 S1 批准；S1 仍需单独书面批准（范围 + 批准时 tip SHA） |

若 S1 实施会话拿到的入口 tip 不等于 X（或 X 之后仅有本清单文字修订的提交），必须停手报 Codex，不得以任何更早 SHA 代替。

## 1. 授权范围与冻结边界

### 1.1 本清单只授权 S1 的这些内容

| 编号 | S1 授权内容 | 契约/卡锚点 |
|---|---|---|
| A1 | 订单内嵌 `paymentRequest` 持久状态，字段形状按契约 §4.1 | 卡 §4.1-1 |
| A2 | 事务 CAS 单飞 claim：仅 `none` 或 lease 已过期的 `preparing`/`reconciling` 可接管；接管写 `epoch+1`、新 `attemptId` | 卡 §4.1-2 |
| A3 | `externalRequestSentAt` 与 claim 在**同一事务**写入并 commit，commit 成功后才调用一次 create；sent 一旦写入**永久保留** | 卡 §4.1-3；裁定 2/4 |
| A4 | `externalRequestSentAt` 非空后不得清空、不得回退 `none`、不得重发 create | 契约 §4.1、§4.5；I2 |
| A5 | complete 带 `attemptId+epoch` CAS；**旧 attempt/epoch 的 complete 写入必须失败且零写**，不得覆盖新 epoch；ownership 丢失返回 `false` | 契约 §4.4；裁定 1/6 |
| A6 | S1 尚不能取真实 query 结果的失败关闭：固定 **503 `PAYMENT_QUERY_UNAVAILABLE`**，`create` 0、`query` 0、不返回参数、audit 0、有效 hold 保留 | 卡 §3.4；裁定 1/3 |
| A7 | create 成功且 complete CAS 有效 → `ready` + 保存 `prepay`/`clientParams` + **恰好 1 条成功审计** + `leaseUntil:null` | 卡 §4.1-4；裁定 3/7 |
| A8 | 请求失败/未知/`failed` 不改变订单生命周期、不释放有效自有 hold；不使用进程内锁、不自动重试 | 契约 §4.2-6；卡 §4.1-9 |
| A9 | 测试基础设施：新增 `tests/rental-network-guard.cjs`，两份租赁测试改为“guard 先装、被测模块动态载入” | 卡 §3.5–3.9；裁定 8 |
| A10 | 允许非 dispatch 内部 helper（claim/complete 等）供业务复用与测试驱动；不新增 action 路由、不改 `index.js` | 裁定 6 |

### 1.2 本清单不授权（S2–S6 冻结，T1–T13 不重推）

| 冻结项 | 边界 |
|---|---|
| S2 缓存签名（prepay/TTL 分离、本地重签、prepay 过期 503） | **冻结**；S1 不实现 TTL 判定、不实现本地重签、不定义 prepay 过期/损坏缓存路径；S1 **不得**因 S2 未实现而把 ready 命中当有效缓存返回 |
| S3 流水事实唯一 / `rental_payment_transactions` | **冻结**；S1 不新增集合、不写支付事实 |
| S4 查询对账 / `failed` 终态进入 / `queryEvidence` 写入 | **冻结**；S1 只**读取** `failed` fixture 并拒绝，不产生 `failed`，不调用 query |
| S5 独立隐私同意 / `privacyVersion` / `rental_identity_consents` / 小程序与后台 UI | **冻结**；S1 不改隐私语义、不改 UI |
| S6 旧数据兼容迁移/回填/展示 | **冻结**；S1 只做读取侧边界（§6），不做任何迁移写 |
| T1–T13 裁定 | **不重推、不重列、不改写**；v5 任务卡 §13 已回写，本清单只引用结论 |
| `index.js` / `wechat-pay.js` / 小程序 / 后台 UI / 契约卡 / v5 任务卡 | **禁改**；`git diff --name-only` 出现即 FAIL |
| 合并 / 部署 / HTTP/UI / 真实支付 / 设备 / 业务云 / 安装依赖 | **全程禁止** |

A 轮已通过，不重派；本清单不重复 A 的内容。

## 2. 文件白名单（S1 实施提交的允许集：4 个必需 + 2 个条件）

S1 实施提交（可多个追加提交，但累计 diff）只允许命中下表文件；判定分两类，**不得把“白名单”等同于“全部必须改动”**：

- **必需改动（4 个）**：`cloudfunctions/leasing/domain.js`、`admin-web/tests/leasing.test.mjs`、`tests/leasing.test.cjs`、新增 `tests/rental-network-guard.cjs`。累计 diff 缺任一即未完成（BLOCKED）。
- **条件允许（2 个）**：`cloudfunctions/leasing/store.js`、`admin-web/lib/store.mjs`。**未改动不构成缺件**，不得因这两份 Store 零 diff 判为缺件/未完成；只有现有 `transact` 语义确实不足时才允许改，且必须先在 S1 入口取得书面理由与批准（范围 + tip SHA）。
- 除下表文件外，任何文件出现在 `git diff --name-only <X>..tip` 即 BLOCKED（白名单是**上限**，不是必须集）。

```text
# 必需（4；缺一即未完成）
cloudfunctions/leasing/domain.js
admin-web/tests/leasing.test.mjs
tests/leasing.test.cjs
tests/rental-network-guard.cjs         # 新增；仅测试 guard

# 条件允许（2；默认零改动，未改不算缺件；改则须书面理由 + 批准）
cloudfunctions/leasing/store.js
admin-web/lib/store.mjs
```

| 文件 | 类别 | 允许改动 | 默认预期 |
|---|---|---|---|
| `cloudfunctions/leasing/domain.js` | **必需** | `paymentRequest` 状态机、单事务 claim+sent、complete CAS、失败关闭、内部 helper | 必改 |
| `cloudfunctions/leasing/store.js` | **条件** | 仅当 `transact` 选项/写入形状确需 | **零改动；未改不算缺件** |
| `admin-web/lib/store.mjs` | **条件** | 仅同上 | **零改动；未改不算缺件** |
| `admin-web/tests/leasing.test.mjs` | **必需** | guard 先装 + S1 用例 + 既有用例改造 | 必改 |
| `tests/leasing.test.cjs` | **必需** | guard 先装（现有 3 个断言不变） | 必改 |
| `tests/rental-network-guard.cjs` | **必需（新增）** | 新增 guard（加载期/运行期网络拦截） | 新增 |

两份 Store 的判定口径（S1 证据必须**按名**列出 `git diff --name-only` 结果并注明状态）：

- **未改**：合法，记为“条件允许/未改”，**不得判缺件**、不得阻塞 PASS。
- **已改**：必须同时给出“现有 transact/CAS 语义不足”的具体失败证据 + 书面理由 + 批准记录（范围 + tip SHA），否则视为超范围（G4 FAIL）；**不得**以“顺手统一”改动这两份 Store。

## 3. S1 必须实现的行为（逐条落位）

| 项 | 要求 | 对应用例 |
|---|---|---|
| 1 | 订单内嵌 `paymentRequest`；字段名/含义按契约 §4.1；S1 写 `queryEvidence=null`、`lastQueryAt=null`、`failedAt=null`；`failed` 仅读取与拒绝 | S1-3、S1-10、S1-16 |
| 2 | claim 用事务 CAS（订单 + hold + 两份证件 + settings refs）；仅 `none` 或 lease 过期的 `preparing`/`reconciling` 可接管；接管写 `epoch+1` + 新 `attemptId`；ready 不可接管 | S1-1、S1-2、S1-12、S1-15、S1-19 |
| 3 | **本地校验 + claim CAS + sent 同一事务一次 commit**；commit 前任何失败 = abort = 零写；commit 成功后才调用**一次** `provider.create`（不在 callback 内、不重试） | S1-6a、S1-6b、S1-8 |
| 4 | complete 带 `attemptId+epoch` CAS；有效 → `ready` + `prepay`/`clientParams` + 1 条成功审计 + `leaseUntil:null`；失败/未知 → `reconciling` 保留 sent，不返回参数、0 audit；ownership 丢失 → `false` + 零写 | S1-3、S1-4、S1-9、S1-14 |
| 5 | 适配器抛错/超时：`reconciling`、`externalRequestSentAt` 保留、不返回参数、0 audit、订单与 hold 不变 | S1-8、S1-11 |
| 6 | 旧 attempt/epoch 的 complete 写入必须失败（固定 `false`）、零写，不得覆盖新 epoch | S1-4、S1-9、S1-17 |
| 7 | `failed` 终态再次 `paymentParams` → 409（沿用现有订单不可支付错误，不新增码）、0 create、0 audit、不释放 hold；全部事实字段保留 | S1-10 |
| 8 | 继续支付硬条件：`hold.orderId === order._id` 且 `hold.until > now`；否则不得 create/返回参数 | S1-5 |
| 9 | 请求失败/未知/`failed` 不改变订单生命周期、不释放 hold；不得使用进程内锁 | S1-8、S1-11、S1-17 |
| 10 | 测试基础设施按 §7；guard 子进程负控必须真实执行 | S1-17、§7 |
| 11 | 只有 `paymentRequest` **整个字段缺失**才是旧 `none`/epoch 0；损坏/未知不得按 none 重发；epoch 接管安全 +1，溢出拒绝 | S1-18、S1-19 |

### 3.1 缓存返回的 S1/S2 边界（裁定 3/7）

`ready` 的写入与“命中返回”职责分离；S1 只保证**本次成功 create 的参数原样返回**，不把库里的 `ready` 当作有效缓存。

| 场景 | S1（本清单授权） | S2（冻结，本轮不实现） |
|---|---|---|
| create 成功 + complete CAS 有效 | 写 `prepay = { prepayId, createdAt }` + `clientParams`（适配器返回原样）+ `leaseUntil:null`；1 条成功审计；**返回本次 create 得到的参数** | 增加 `prepayExpiresAt`、`signatureExpiresAt`、`signedAt` 等 TTL 字段 |
| 重复请求命中 `ready` | **固定 503 `PAYMENT_QUERY_UNAVAILABLE`**、W0、create 0、query 0：S1 无 TTL，**不能证明缓存有效**，因此**禁止无条件返回缓存** | 判断 prepay/签名有效期；有效才返回缓存；签名过期本地重签 |
| `prepay` 过期 | **不处理**（S1 不得写“过期判定/503”分支） | 缓存失效、不返回旧参数、固定 503 `PAYMENT_QUERY_UNAVAILABLE` |
| 损坏缓存（`package` 内 prepay 标识 ≠ `prepay.prepayId`） | **不处理**（`paymentRequest` 结构损坏另见 S1-18） | 固定 503 `PAYMENT_QUERY_UNAVAILABLE` |
| `ready` 被接管/重发 | **禁止**：`leaseUntil:null` 使 ready 不在 takeover 候选；无重发路径 | 同 |
| 返回对象来源 | 仅本次 `provider.create` 的返回值（首次返回） | 缓存/重签后的 `clientParams`；断言 `prepayId` 不变 |

硬边界：

- S1 的“首次返回”与“ready 命中”必须区分：前者返回本次 create 参数；后者一律 503（裁定 3）。
- S1 不得以“S2 还没做 TTL”为理由对 `ready` 无条件返回缓存；该行为明确禁止。
- S2 入口必须显式更新并重跑受影响的 S1 断言：S1-3、S1-15——在 S2 证据中列出 diff，不得静默改写。
- S1 不实现 `refreshPayment` 的 query 对账；`refreshPayment` 当前行为（`domain.js:863-879`）在 S1 不被改写（不改即零 diff）。
- S1 不删除 `prepay`/`clientParams` 缓存（缓存清理由 S4 的 `failed` 进入路径负责）。

### 3.2 事务与调用顺序（裁定 2/4/6/7/9）

S1 只有下列三个动作；没有独立“回退事务”，也没有第二次 create。

| 动作 | 触发 | refs | 条件（同一事务内校验） | 允许写 | audit |
|---|---|---|---|---|---|
| **T1 claim+sent（单事务一次 commit）** | 首次 `none`，或 lease 过期的 `preparing`/`reconciling` 接管 | `rental_preleases/<id>`、`rental_room_holds/<roomId>`、两份 `rental_identity_documents`、`rental_settings/global` | 状态合法（`none`/过期 `preparing`/过期 `reconciling`）；订单 `awaiting_payment` 且未过截止；hold 属本单且未过期；证件/绑定有效；`epoch` 为安全整数且 `+1` 不溢出 | 仅 `paymentRequest`：`status:"preparing"`（接管已发一律 `reconciling`）、新 `attemptId`、`epoch+1`（首次 0→1）、`leaseUntil`、`startedAt`、`externalRequestSentAt = now`、`queryEvidence:null`、`lastQueryAt:null`、`failedAt:null`；**不写 `previous`** | 0 |
| **create（commit 后）** | T1 commit 成功 | 无（不写库） | 仅一次；**不得**在事务 build/callback 内调用；不得重试、不得并发第二次 | 无 | 0 |
| **T3 complete（CAS）** | create 返回（成功/失败/超时都在此收敛） | `rental_preleases/<id>` | `attemptId`+`epoch` 与当前值一致；成功路径还需绑定仍有效 | 成功：`status:"ready"` + `prepay`/`clientParams` + `leaseUntil:null`；失败/未知：`status:"reconciling"`（保留 sent/attempt/epoch）；ownership 丢失：无写、helper 返回 `false` | 成功 1；失败 0 |

T1/T3 的硬性规则：

1. **单事务**：本地校验、CAS、claim、sent 必须一次 commit；commit 前任何失败（校验失败、构建失败、CAS 失败）⇒ **abort，零写**（无 `preparing`、无 sent、无 audit）。
2. **删除的回退承诺**：v3 **取消**“claim 已持久化后再同事务恢复原字节”的机制——不存在该中间态，因此不需要、也不得实现 `previous` 快照回退。
3. **create 后置单次**：`provider.create` 只在 T1 commit 之后调用一次；不得放进事务 `build`/callback，不得在最外层重试。
4. **complete CAS**：成功 → `ready` + 1 条审计；CAS 失败/lease 失效/绑定失效 → `reconciling` + 0 审计；ownership 已丢失（epoch 被接管）→ helper 返回 `false`、零写、不覆盖新状态。
5. **sent 不可擦除**：任何状态（`preparing`/`reconciling`/`failed` 读取态）都不得删除、清空、置 `null`/`undefined` `externalRequestSentAt`；全代码只有 T1 一处写 sent。
6. **ready 不可接管**：`ready` 的 `leaseUntil` 固定为 `null`，不满足任何 takeover 条件；不得对 `ready` 生成新 attempt/create。
7. **epoch 安全**：`epoch` 必须是安全整数；`epoch+1` 溢出（超过 `Number.MAX_SAFE_INTEGER`）⇒ 拒绝接管、零写（S1-19）。

## 4. 逐例唯一预期矩阵

写法约定：

- 写集 **W0** = 全库零写（`before=structuredClone(store.data)`、`after=structuredClone(store.data)`、`assert.deepEqual`，**含 `admin_audit` 长度与内容**）。
- 写集 **WP** = 仅 `rental_preleases/<orderId>` 的 `paymentRequest` 整字段被替换（外加 Store 自动写入的 `updatedAt`）；**`admin_audit` 必须整体 `deepEqual`（audit 0）**；其余集合/文档/字段 `deepEqual`。
- 写集 **WP\*** = WP + `admin_audit` **追加恰好 1 条**成功审计（action 精确 `租赁预约：核对支付资格`）；既有审计条目逐条仍在（多重集不变），其余集合/文档/字段 `deepEqual`。**只有 `ready` 成功路径允许 WP\***。
- 三种写集互斥，每个用例只能选一种；`audit` 列必须与写集列一致：**WP\* ⇔ 1，WP ⇔ 0，W0 ⇔ 0**；不一致即 FAIL。
- **唯一限定用例 S1-14**：窗口内先发生 `uploadIdentity`（写订单 `status`/hold/自身审计），故其写集断言限定为“`paymentRequest` 字段变化 + 不新增 `核对支付资格` 审计”；`uploadIdentity` 的写入不计入 WP 的其他字段/集合同等断言。
- “非 HTTP” = 内部 helper / 静态断言，必须显式标注，不得冒充 HTTP 用例。
- create/query 为该用例内对注入适配器的**精确调用次数**（不是“至少/最多”）。
- 云函数层：领域错误 `e.status` → `index.js` 返回数值 `code = e.status || 503`（`index.js:75-80` 现状，不改）。成功 → 云 `code: 0`。

| # | 用例 | 触发 | 唯一 code/status | 写集 | audit | create | query |
|---|---|---|---|---:|---:|---:|
| S1-1 | 两并发首次请求（同一订单） | 两个 `paymentParams` 同时进入 | 胜者：成功（领域返回参数；云 `code:0`）；败者：**409 `PAYMENT_PARAMS_IN_PROGRESS`** | 胜者 **WP\***（`status:"ready"`、`epoch:1`、新 `attemptId`、`externalRequestSentAt` 非空、`prepay`/`clientParams`、`leaseUntil:null`）；败者 W0 | 1（仅胜者，action 精确 `租赁预约：核对支付资格`） | 1 | 0 |
| S1-2 | 有效 lease 内第二方（`preparing` 与 `reconciling` 两个 fixture） | lease 未过期 | **409 `PAYMENT_PARAMS_IN_PROGRESS`** | W0 | 0 | 0 | 0 |
| S1-3 | create 成功 + complete CAS 有效 | 正常单请求 | 成功（云 `code:0`）；返回**本次 create** 的参数 | **WP\***（`ready` + `prepay`/`clientParams` + `queryEvidence:null` + `leaseUntil:null`） | 1 | 1 | 0 |
| S1-4 | 旧 epoch complete（内部 helper） | fixture `ready`（epoch=2），用 epoch=1 调 complete | 非 HTTP：helper 返回 **`false`**（固定），当前 epoch/attempt/ready 不变 | W0 | 0 | 0 | 0 |
| S1-5 | 订单过期 / hold 非本单 / hold 已释放 / 材料变化（4 个 fixture） | 每个 fixture 各一次 | **409**；订单/材料类沿用现有精确消息（`订单不在可支付时间内，请刷新状态`；`身份证材料或审核状态已变化，请重新审核并确认合同`） | W0 | 0 | 0 | 0 |
| S1-6a | T1 内本地校验失败 | 校验与 claim 同事务，失败即 abort | **409**（同 S1-5 对应消息） | W0；断言订单**无** `paymentRequest` 字段、无 sent | 0 | 0 | 0 |
| S1-6b | T1 提交前构建失败（abort） | 注入构建/校验失败（commit 前） | 非 HTTP：abort，无部分写入 | W0（无 claim、无 sent、无 audit；**不存在**“已持久化 claim 再恢复”的中间态） | 0 | 0 | 0 |
| S1-7 | sent 写入后禁止擦除/重发 | 静态断言 + 状态机断言 | 非 HTTP：无删除/清空/置 null sent 的分支；无第二次 create | W0 | 0 | 0 | 0 |
| S1-8 | create 超时 / 5xx / 抛错 | 适配器 `create` 抛错或超时 | **503**（通用文案 `租赁服务暂不可用，请稍后重试`；不泄漏适配器原文；**不是** `PAYMENT_QUERY_UNAVAILABLE`） | **WP**（`status:"reconciling"`、sent 保留、`attemptId`/`epoch` 不变） | 0 | 1 | 0 |
| S1-9 | complete CAS 失败（并发接管/lease 失效） | create 返回时 lease 已被接管 | **503 `PAYMENT_QUERY_UNAVAILABLE`** | **WP**（接管者写入 `reconciling` + `epoch+1` + 新 `attemptId`）；**旧 owner 零写**、不覆盖新状态 | 0 | 1 | 0 |
| S1-10 | `failed` 终态再次请求 | fixture `paymentRequest.status="failed"` | **409** + `订单不在可支付时间内，请刷新状态` | W0；全部事实字段（sent/attemptId/epoch/out_trade_no/queryEvidence）原样 | 0 | 0 | 0 |
| S1-11 | 失败/超时后有效 hold 保留 | 同 S1-8 用例内断言 | **503**（同 S1-8） | **WP**（同 S1-8）；`hold.until`/`hold.orderId` 原样、`order.status` 不变 | 0 | 1 | 0 |
| S1-12 | lease 过期接管**已发**请求 | fixture `preparing`/`reconciling` 且 sent 非空、lease 过期 | **503 `PAYMENT_QUERY_UNAVAILABLE`** | **WP**（`reconciling` + `epoch+1` + 新 `attemptId` + sent 保留；不返回参数） | 0 | 0 | 0 |
| S1-13 | 接管不一致态（`preparing` 且 sent 为空） | 该态非 S1 事务可产生（claim+sent 原子），只可能是损坏 fixture | **503 `PAYMENT_QUERY_UNAVAILABLE`** | W0；不 create、不返回参数、不按 none 重发 | 0 | 0 | 0 |
| S1-14 | complete 时绑定失效（改造既有 in-flight 用例） | create 进行中证件被替换 | **503 `PAYMENT_QUERY_UNAVAILABLE`** | **WP（限定，见 §4 约定）**（`reconciling`、sent 保留、`epoch` 不变；不返回参数；不新增 `核对支付资格` 审计） | 0（该请求 0；`uploadIdentity` 自身审计不计入） | 1 | 0 |
| S1-15 | `ready` 命中（不得返缓存） | fixture `ready`（S1 自己写入）后再次 `paymentParams` | **503 `PAYMENT_QUERY_UNAVAILABLE`** | W0；不返回参数、不 create、不 query；`ready` 不可接管 | 0 | 0 | 0 |
| S1-16 | 读路径/DTO 不泄漏、不写 | `mine()`、`orderDTO`、`validatePayableOrder` | 非 HTTP：正常返回 | W0 | 0 | 0 | 0 |
| S1-17 | 静态不变量 | 代码检索/静态断言 | 非 HTTP | W0 | 0 | 0 | 0 |
| S1-18 | `paymentRequest` 存在但损坏/未知 | 字段为 `null`/非对象/状态不在枚举 | **503 `PAYMENT_QUERY_UNAVAILABLE`** | W0；**不得**按 `none` 处理、不得重发 create、不返回参数 | 0 | 0 | 0 |
| S1-19 | epoch 非安全整数 / `+1` 溢出 | fixture 或接管时溢出 | **503 `PAYMENT_QUERY_UNAVAILABLE`**（拒绝接管） | W0；不 create、不返回参数、不写 `paymentRequest` | 0 | 0 | 0 |

### 4.1 逐例补充断言（缺一即未闭合）

- **S1-1**：`paymentRequest` 只有一份；`admin_audit` 只增 1 条且 action 精确（属于胜者 WP\*）；败者不得写任何字段；胜者返回参数 = 本次 create 结果。
- **S1-2**：两个 fixture 都必须 `deepEqual`；`preparing` 与 `reconciling` 的 valid-lease 拒绝必须是同一 code。
- **S1-3**：`prepay.prepayId` 必须等于 `clientParams.package` 中 `prepay_id=` 后的值；`ready.leaseUntil === null`；返回对象与适配器 create 返回值逐字段一致（证明不是从库读缓存）。
- **S1-4**：helper 固定返回 `false`（不是抛错二选一）；当前 `ready` 的 `prepay`/`clientParams`/`epoch`/`attemptId` 逐字段不变。
- **S1-5**：四个 fixture 各自一条；断言不释放 hold（`until`/`status` 原样），且 `hold` 不被写成 `released`。
- **S1-6a**：断言 `Object.hasOwn(order, "paymentRequest") === false`（基线订单本无该字段），不接受 `status:"none"` 残留。
- **S1-6b**：abort 后 `deepEqual`；证据给出“commit 前失败发生在事务 build 内”的调用点；不得出现“已写 claim 再删”的跨事务补偿。
- **S1-7**：静态证明只有 T1 一处写 sent、无删除/清空/置 null、无第二个 create 调用点。
- **S1-8**：客户端文案不得含适配器原文（断言 `!/synthetic|adapter/i.test(msg)`）；`order.status` 仍 `awaiting_payment`；`admin_audit` `deepEqual`。
- **S1-9**：胜者 `epoch` 比败者大 1；**旧 owner 该次 complete 零写**；新状态不被覆盖。
- **S1-10**：`deepEqual`，且 `hold` 不变；不得因 `failed` 调 `closeUnpaid`。
- **S1-12**：`create` 必须为 0（接管已发请求）；`lastQueryAt` 不由 S1 写（S4 才写）。
- **S1-13**：断言该 fixture 不由 S1 事务产生；零写、不 create、不按 none 重发。
- **S1-14**：`paymentParams` 从既有 409 改为 503（见 §8）；`admin_audit` 中不得出现 `核对支付资格`。
- **S1-15**：固定 503（同码）；W0；create/query 0；不得返回库里的 `clientParams`；`ready` 的 `leaseUntil:null` 不可接管。
- **S1-16**：DTO 键集合与基线完全相同（不含 `paymentRequest`/`prepay`/`clientParams`）；读路径 `deepEqual`。
- **S1-17**：静态证明无 `setTimeout`/`setInterval`/重试循环/第二次 `out_trade_no` 生成/进程内锁/新增固定错误码/新增 dispatch action/删除 sent 分支；`index.js` 零 diff；`provider.create` 只出现一次且不在事务 callback 内。
- **S1-18**：字段为 `null`/非对象/未知 status 时走 503，不按 `none`；不写库、不 create。
- **S1-19**：`epoch` 非安全整数或 `+1` 溢出时 503；不写 `paymentRequest`、不 create。

### 4.2 audit 与适配器计数的全局口径

- 成功审计只出现在 `ready`：S1-1 胜者、S1-3，各恰好 1 条，且该条**属于 WP\* 的允许写集**。
- 其余用例 audit 一律 0，`admin_audit` 必须 `deepEqual`（WP 或 W0）。
- 每个用例的 create/query 计数必须写成“预期/实测”；实测多于预期即 FAIL（禁止重试、失败后回退 create、查询不成功转 create）。
- 审计内容断言使用 action 精确匹配；`_id`/`createdAt` 为随机/时间值，比较新增条目字段与既有条目的多重集。
- 写集/audit 一致性由 §4 表逐行核验：20 行中 WP\* 共 2 行（S1-1 胜者、S1-3）audit=1；其余 18 行 audit=0；任一行不符即 FAIL。

## 5. 写集与“其余全库相等”的执行口径

- `W0`：直接整体 `deepEqual`（含 `admin_audit`）。
- `WP`：先 `before = structuredClone(store.data)`；执行；`after = structuredClone(store.data)`；断言
  1. `after.rental_preleases` 中仅目标订单变化；
  2. 目标订单除 `paymentRequest` 与 `updatedAt` 外逐字段相等；
  3. `admin_audit` 整体 `deepEqual`；
  4. 其余集合（`houses`/`rooms`/`property_catalog`/`users`/`rental_settings`/`rental_appointments`/`rental_room_holds`/`rental_identity_documents`）整体 `deepEqual`。
- `WP\*`：在 `WP` 的 1/2/4 基础上，`admin_audit` 允许“**追加恰好 1 条**”：长度 `before+1`、新增条目 action/actor/target 正确、`before` 既有条目逐条仍在（多重集相等）；不得修改或删除既有条目。
- **单事务 aborts（T1 失败）**：`after` 与 `before` 逐字节相等；若 `before` 的订单无 `paymentRequest` 键，`after` 亦必须无该键；不存在“先写后恢复”的补偿写。
- 云 Store 对每次写入附加 `updatedAt`（`store.js:79`），LocalStore 同（`admin-web/lib/store.mjs:178`）；因此 `updatedAt` 是 `WP`/`WP\*` 唯一允许的额外字段。
- `paymentRequest` 是**内部待对账状态**，不是支付事实：不得把 `WP`/`WP\*` 声称成“全库零写”，也不得写 `rental_payment_transactions`。
- `admin_audit` 的写入由 Store 在事务内完成；T1 与 T3 失败路径必须 `writeAudit:false`；只有 T3 成功写唯一一条。

## 6. 旧数据兼容边界（S1 只做读取侧，不做迁移）

1. **缺失语义（裁定 9）**：**仅当 `paymentRequest` 整个字段缺失**时，才视为旧 `none`/`epoch = 0`；字段存在但为 `null`、非对象、或 `status` 不在枚举内 = **损坏**，不得按 `none`、不得重发 create（S1-18）。
2. **epoch 起点与安全**：缺失 = 0；首次 claim 写 1；接管 `+1`；必须是安全整数，`+1` 溢出即拒绝（S1-19），不得写 `Infinity`/`NaN`/字符串。
3. **不迁移/不回填/不扫描**：S1 不得 `list(orders)` 全表遍历或批量写 `paymentRequest`；claim 只针对单个订单事务。S6 迁移展示/回填仍冻结。
4. **不新增集合/索引/权限/部署面**：S1 不新建集合、不改两份 Store 的 allowed/collections（默认零改动）、不改部署清单；`docs/RENTAL-PRESIGNING.md` 不在 S1 允许文件内。
5. **旧状态不变**：订单 `status` 为 `payment_closed`/`identity_changed`/`paid_held`/`refund_required` 等非 `awaiting_payment` 时，S1 不写 `paymentRequest`，维持现有 409/返回行为（S1-5、S1-10）。
6. **旧客户端不变**：`paymentParams(id)` 入参、dispatch action 集合、`orderDTO` 键集合均不变；S1 不新增必填字段、不改 `index.js` 协议。
7. **`failed` 只读**：基线不存在 `failed`；S1 只在 fixture 中读取并拒绝，**不产生 `failed`**；进入 `failed` 属 S4。
8. **`ready` 不属旧数据**：`ready` 只能由 S1 自己写入，且 `leaseUntil:null`、不可接管、不可重发；S1 不承诺兼容“旧 `ready` 缺 prepay/clientParams”的组合（S2 损坏缓存路径处理）。
9. **不复活**：S1 不得把 `failed`/其他终态订单接管为 `preparing`/create；sent 非空的记录永久保留。
10. **无 `previous` 回退**：v3 不写 `previous`、不实现“持久化 claim 后同事务原字节恢复”；claim 与 sent 原子提交，commit 前失败即零写。

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

### 7.4 ESM 命名绑定与子进程继承（裁定 8）

- guard 安装后必须 `syncBuiltinESMExports()`，并用负控证明 `import { request } from "node:http"` 等 ESM 命名绑定同样被拦截；只拦 CJS 属性不算通过。
- **必须完成至少一次真实子进程继承负控**（`NODE_OPTIONS=--import/--require <guard>`），子进程内 `net.connect`/`fetch` 被拦截并回传违规；不得静态替代、不得 skip。
- 环境不支持子进程时 = **BLOCKED**，不得降级为“无子进程证据”通过。

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
| `admin-web/tests/leasing.test.mjs:621-653`（create 进行中证件被替换） | 期望 **409** | 期望 **503 `PAYMENT_QUERY_UNAVAILABLE`**；断言 `paymentRequest.status="reconciling"`、sent 保留、`epoch` 不变、无 `核对支付资格` 审计（WP 限定，audit 0） |
| `admin-web/tests/leasing.test.mjs:743-760`（适配器故障） | 期望整体 `deepEqual`（零写） | 改为 **WP（audit 0）**（`paymentRequest="reconciling"` + sent 保留；`admin_audit` 仍 `deepEqual`）+ hold/订单状态不变 + 原始错误不泄漏 |
| `admin-web/tests/leasing.test.mjs:762-781`（成功路径） | 断言 create 1、audit 1、`package` | 保持上述断言，另加 `ready`、`prepay.prepayId`、`clientParams`、`leaseUntil:null` 与返回值来源（本次 create）断言；audit 1 归入 **WP\*** |
| `admin-web/tests/leasing.test.mjs:529-580`、`:582-619`（预校验失败） | 期望 409 + `deepEqual` | **不变**（失败发生在 commit 前；S1-5/6a 复用其口径） |
| `tests/leasing.test.cjs:1-35` | 顶层 `readFileSync(index.js)` 后 `vm.runInNewContext` | guard 先装 + 动态载入；现有 3 个 `test(` 的断言不变 |

新增用例（S1-1…S1-19 中除上述改造外的部分）写在 `admin-web/tests/leasing.test.mjs`；`tests/rental-network-guard.cjs` 只放 guard 与自检，不放业务断言。

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
- `DEFERRED` 清单：S1 只允许“真实 query 结果（`NOTPAY`/`CLOSED`/`REVOKED`/`PAYERROR`/`ORDER_NOT_EXIST`/`SUCCESS`/超时未知）留 S4”一项；**S1 已实现的 503 失败关闭（S1-9/12/13/14/15/18/19）不得标 DEFERRED**；
- guard 自检：入口数、负控 N/N、正控 M/M、ESM 命名绑定、子进程 1/1、非监听清单、环境失败口径；
- 每个用例的 create/query 预期/实测、audit 次数、写集（W0/WP/WP\*）结果；
- **写集与 audit 一致性**：逐行核对 §4 表，WP\* 行 audit=1 且该条计入允许写集；WP/W0 行 audit=0。

### 9.3 交付报告必须包含

1. run ID、完整 SHA、父 SHA、分支、`ls-remote` 实测远端 tip；
2. `git diff --stat`、`git diff --name-only`（逐项对照 §2：4 个必需 + 2 个条件；两份 Store 按名注明“未改（条件允许）”或“已改（附理由/批准）”）；
3. 逐文件命令、工作目录、exit code、执行/通过/失败/跳过计数；
4. 每个用例的唯一 code/status、写集、audit、适配器计数；
5. 契约锚点逐项对照（§4.1/§4.2/§4.4/§4.5/§7.1，以契约 blob `94d61ed…` 为准）；
6. 未验证/不可验证项与待裁项；
7. 声明“未合并、未部署、未开 HTTP/UI、未接真实支付/设备/业务云、未安装依赖”。

### 9.4 验收门（S1 子集）

| 门 | 要求 |
|---|---|
| G1 | I1–I8 相关不变量成立：确认失败禁止重发、sent 保留、有效 hold 保留 |
| G2 | create/query 计数与 §4 表逐项一致；无隐藏 create/重试循环；create 只在 commit 后一次 |
| G3 | W0/WP/WP\* 逐项成立；`admin_audit` 与写集一致（WP\* 才允许 +1） |
| G4 | 仅改 §2 白名单（上限）：4 个必需文件齐备；两份 Store **未改视为“条件允许/未改”不判缺件**；若改须附失败证据 + 书面理由 + 批准；契约卡/任务卡/`index.js`/`wechat-pay.js`/UI 零 diff |
| G5 | 只运行 §9.1 两条命令；无 glob/`npm test`/HTTP |
| G6 | 追加提交、普通 push、`ls-remote` 核对；无 amend/rebase/reset/squash/force/merge；无全局 Git 配置 |
| G7 | 不部署、不接真实支付、不开 HTTP/UI、不连设备/业务云、不安装依赖 |
| G8 | 证据含 run/完整 SHA/父/文件范围/命令/exit/计数/适配器计数/零写断言/远端状态/未验证 |
| G10 | 逐用例只断言一个 code/status；无 409/503 二选一；无新增固定码 |
| G13 | guard 闭合：加载前安装、加载期违规 0、逐入口负控全过、必要依赖正控全过、ESM 命名绑定被拦截、真实子进程 1/1、非监听清单全过、环境失败口径已记录 |
| G14 | 无占位 PASS；`DEFERRED` 不计入通过；无 skip/todo/only |
| G15 | 每个运行场景有唯一 code/status、W0/WP/WP\*、audit、create/query；不出现含糊值 |

## 10. 停止点

1. S1 实施提交并**普通 push**到 `feat/rental-s1-persistent-single-flight`（或等义新分支）后**立即停手**，交 Codex 独立复审；不得进入 S2。
2. 不合并、不部署、不开 HTTP/UI、不接真实支付/设备/业务云；不运行 §9.1 以外的命令。
3. 复审未 PASS 前不开始 S2；S2–S6 全部冻结（§1.2）。
4. 任何与契约/任务卡冲突的发现：先停手报 Codex，不得自行改写契约或本清单。

## 11. 九项裁定落位（本轮派单）与材料不足

### 11.1 九裁定 → 文档位置 → 用例

| # | 裁定要点（本轮派单） | 落位 | 验证方式 |
|---|---|---|---|
| 1 | 外部可能已发 complete/绑定失效 → **503 `PAYMENT_QUERY_UNAVAILABLE`**；旧 owner **零写**、不覆盖新状态 | §3.2 T3、§4 S1-9/S1-14、§4.1 | 逐例断言旧 owner W0 + 新状态不变 |
| 2 | create 超时/抛错 → **503 通用不可用文案、不泄漏**；sent/reconciling 保留、audit 0 | §3.2 create、§4 S1-8/S1-11、§8 | 断言文案不含适配器原文、sent 保留、audit 0 |
| 3 | **首次返回本次新 create 参数**；`ready` 不能证有效 → **503 同码 / W0 / create 0 / query 0**；禁止因 S2 未 TTL 无条件返缓存 | §3.1、§4 S1-3/S1-15、§8 成功路径 | 断言返回值来源为本次 create；ready 命中 503+W0 |
| 4 | 本地校验 + claim CAS + sent **单事务 commit**；`provider.create` 仅 commit 后**一次**、不在 callback；S1-6b commit 前失败 abort=W0；**删除**“claim 持久化后同事务原字节恢复”承诺 | §3.2 全表与规则 1–3、§4 S1-6a/6b、§5 | 证据给出 T1 事务 refs/writes；abort `deepEqual`；静态证明 create 不在 build 内 |
| 5 | **领域运行证据 + 现 wrapper 静态映射**；云 E2E 未验；**不改 index** | §4 约定、§9.3/G8、本表 | 交付报告写明“云 E2E 未验”；`index.js` 零 diff |
| 6 | 业务复用**非 dispatch helper 允许**；不增 action 路由；**旧 complete 丢 ownership 固定 `false`/W0** | §1.1 A10、§3.2 T3、§4 S1-4/S1-17 | helper 返回 `false`、W0；无新 action |
| 7 | **`ready` 的 `leaseUntil = null`**，不能接管/重发 | §3.1、§3.2 规则 6、§4 S1-1/S1-3/S1-15、§6-8 | 断言 `leaseUntil === null`；无 ready 接管路径 |
| 8 | **真实子进程 guard 负控必须**；不支持 → BLOCKED 不 skip | §7.4/§7.5、§9.4 G13 | 子进程 1/1；失败即 BLOCKED |
| 9 | **仅整字段缺失**算旧 none/epoch 0；损坏不得 none 重发；接管安全 +1、溢出拒绝 | §6-1/6-2、§4 S1-18/S1-19 | 损坏 503+W0；溢出 503+W0 |

九条均已落位；本轮**不依赖**云材料正文即可执行。

### 11.2 材料不足（正文未取得，不声称已读）

指定材料：`/workspace/artifacts/RENTAL-S1-AUTH-REVIEW-2026-11-19` 下的 `PARALLEL-DISPATCH.md`、`REVIEW.md`。本机**未取得可读正文**，已核对（实测）：

| 检查位置 | 结果 |
|---|---|
| `/workspace`（含目标子路径） | 不存在 |
| `C:\workspace\…`、`D:\workspace\…`、`E:\workspace\…`、`F:\workspace\…` 同路径 | 均不存在 |
| `C:\artifacts\…`、`D:\artifacts\…`；`E:\artifacts`、`F:\artifacts`、`G:\artifacts` | 均不存在 |
| `C:\`、`D:\` 根目录 `*RENTAL-S1-AUTH-REVIEW*` 检索 | 无匹配 |
| `%TEMP%`、`.dsh`、`AppData\Roaming`、`ProgramData` 过滤 `*RENTAL*` | 仅旧契约卡副本，非本轮材料 |
| 项目树 `PARALLEL-DISPATCH.md` | 无 |
| 仓库全 refs 路径检索 | 无 |

结论：**不声称已读**该两份文件；九裁定以本轮派单文本为准（§11.1），不臆造、不补写；材料缺失不构成批准。若后续正文与派单冲突，先停手报 Codex，以正文为准。

## 12. 与输入、父提交、实施起点的最终声明

- 本清单 v3 以 `a080cdd8126dbe9decd70f411ca2943336f88bc8` 为**父**追加提交；提交后完整 SHA 与父 SHA 以交付报告与 `ls-remote` 实测为准。父链：`v3` → `a080cdd` → `4595757` → `8a2f8d9` → `4a30e6e`。
- **S1 实际实施起点是本清单提交（X）**，不是 `a080cdd`、`4595757` 或 `8a2f8d9`；实施分支必须从 X 新建。
- 本轮不将 C/D 文档工作树起点 `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` 作为分析对象或输入替代。
- 本清单只修改一个文件；未运行测试、未安装依赖、未改代码/测试/Store/契约/任务卡、未开 HTTP/UI、未接真实支付/云/设备、未合并/未部署。
- **本清单 PASS 不等于 S1 实施授权**；S1 需单独书面批准（范围 + 批准时 tip SHA），S2–S6 仍冻结，T1–T13 不重推。

## 13. v2 修订记录（问题 → 位置 → 验收要求）

| # | 问题（v1 复审） | 修订位置 | 验收要求 |
|---|---|---|---|
| 1 | 成功审计与 WP 写集自相矛盾 | §4 约定（WP\*）、§4 表、§4.2、§5、§9.2、G3/G15 | WP\* 定义与逐行一致 |
| 2 | 回退事务未定义 | §3.2（v2 的 T1/T2/T3/T1'）、§4.1、§5、§6-10 | 已由 v3 裁定 4 取代 |
| 3 | 缓存返回未区分 S1/S2 | §3.1、§4.1 S1-15 | 已由 v3 裁定 3 收紧 |
| 4 | 九项口径未逐项对照 | §11 | 已由 v3 九裁定落位 |
| 5 | 父链/实施起点需随输入更新 | 头部、§0、§0.1、§12 | 已更新至 v3 |

## 14. v3 修订记录（九裁定落位）

| # | 裁定 | 文档改动 | 影响的用例 |
|---|---|---|---|
| 1 | complete/绑定失效 503 + 旧 owner 零写 | §3.2 T3、S1-9/S1-14 写集与断言 | S1-9、S1-14 |
| 2 | create 超时 503 通用文案、不泄漏 | S1-8/S1-11；§8 适配器行 | S1-8、S1-11 |
| 3 | 首次返回本次参数；ready 不返缓存 → 503/W0 | §3.1 重写；S1-3、S1-15 | S1-3、S1-15 |
| 4 | 单事务 claim+sent、create 后置单次、删除回退承诺 | §3.2 全表重写；S1-6a/6b；§5；§6-10 | S1-6a、S1-6b、S1-8 |
| 5 | 领域证据 + wrapper 静态映射；云 E2E 未验 | §4 约定、§9.3/G8、§11.1 | 证据边界 |
| 6 | helper 允许；旧 complete `false`/W0 | §1.1 A10；S1-4 | S1-4、S1-17 |
| 7 | ready `leaseUntil:null` 不可接管 | §3.1、§3.2 规则 6、S1-3/S1-15 | S1-3、S1-15 |
| 8 | 真实子进程 guard 必须 | §7.4/§7.5、G13 | guard 证据 |
| 9 | 仅整字段缺失=none；损坏/溢出拒绝 | §6-1/6-2；新增 S1-18/S1-19 | S1-18、S1-19 |
