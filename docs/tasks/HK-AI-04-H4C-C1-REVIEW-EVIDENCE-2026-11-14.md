# HK-AI-04 H4-c C1 P0 返工证据包

> 状态：**两项 P0 已按指定契约返工，等待 Codex 独立复审。**
> 本文只证明 C1 helper 与离线测试；不构成 C2/C3、HTTP 接线、真实 Provider、真实设备、Cloud/live 或生产发布批准。

- 分支：`feat/hk-face-h4c-reconciliation`
- 代码基线：`1155b7ba65991d324fb8b22bb8f7dd87f49428f9`
- 返工直接父提交：`3fce9b027b720943bb049bd5220e117e9d91217e`
- 返工提交：本提交（仅追加在 `3fce9b0` 之上；未 rebase/squash/force-push/合并 main）
- 返工日期：2026-11-14（+08:00）
- 范围：仅 `admin-web/lib/face-service/h4c-evidence.mjs`、`admin-web/tests/face-h4c-evidence.test.mjs` 与本证据文档

## 0. 结论摘要

| 检查项 | 结果 |
|---|---|
| P0-1 运行时隐式创建/回填 domain | 已关闭：append 只做只读校验；首次初始化改为显式 helper |
| P0-1 双缺/单缺错误码与零写 | 已覆盖：双缺、仅缺 head、仅缺 version 均 `DOMAIN_INCOMPLETE`/409，内容级 deepEqual + 零写 |
| P0-1 初始化 create-only / 全局空 | 已覆盖：三集合任一记录存在即拒绝；重复初始化拒绝；不覆盖 |
| P0-1 Store 无法原子证明全局空 | 失败关闭：显式前置探针 + 事务内外复核；无猜测、无扫描修复、无补写 |
| P0-2 稳定全局 head ID | 已关闭：`evidence-digest-domain:v1:global`，独立于 realm/org |
| P0-2 realm/version/fingerprint 比较 | 已覆盖：切 realm、改版本、同版本换钥均 `DOMAIN_MISMATCH`/409，零写，无新 head/version |
| P0-2 第二套并行域 | 已关闭：固定 head ID + version 记录受同一 head 约束；预置第二 realm 不能绕过 |
| 既有 23 项测试 | 全部保留并适配；现 30 项，30/30 通过 |
| C1 定向 | 30/30 通过；guard 下 30/30，network attempts 0、Provider calls 0 |
| Admin 全量 | 580/580 通过（41 个文件） |
| 根测试 | 51/51 通过（7 个文件） |
| `git diff --check` | exit 0 |
| 敏感扫描 | 0 命中（本次 3 个变更文件） |
| Provider/网络/设备/HTTP 注册 | C1 定向：0/0/0/0；`server.mjs` 零修改 |
| C2/C3 | 未开始、未实现 |

## 1. 原 P0 复现（基于 `3fce9b0`）

### 1.1 P0-1：append 在 domain 双缺失时隐式创建/回填

旧实现（`3fce9b0`）：

- `applyEvidenceDomain` 在 `h4c-evidence.mjs:244-258` 对 `head === null && versionRecord === null` 直接返回 head+version 两条 create 写。
- `appendEvidenceWrites` 在 `h4c-evidence.mjs:355-358` 先调用该 guard，再读取 per-job head/previous evidence。
- Store 的 `evidence_digest_domains` 是 create-only，但只在“同 ID 已存在”时拦截，不能证明“全局为空”。

复现步骤：

1. 在空 LocalStore 上用 realm-a 追加第一条 evidence；旧 append 会自动创建 domain 对。
2. 在 store 级删除 `evidence_digest_domains` 的两条记录，保留 `device_operation_evidence` 与 `device_operation_evidence_heads`。
3. 用同一 K3 config 追加第二条 evidence。
4. 旧实现：guard 认为“首次部署”，返回两条 domain create 写；后续 previous evidence 的 schema/org/job/sequence/observedAt/K3/HMAC 全部匹配，事务最终成功，domain 被回填。

旧测试 `domain guard creates head and version once` 直接断言了第 4 步的创建行为，因此该 P0 在旧 23 项测试下是“预期行为”，不是测试失败。

### 1.2 P0-2：realm 进入 head ID，切换 realm 形成并行命名空间

旧实现（`3fce9b0`）：

- `evidenceDomainIds` 在 `h4c-evidence.mjs:92-97` 生成：
  - head：`evidence-digest-domain:<base64url(realm)>`
  - version：`evidence-digest-domain-version:<base64url(realm)>:<version>`
- 因此 `H4_EVIDENCE_REALM` 从 realm-a 切到 realm-b 后，稳定 head 不存在，guard 走“首次创建”；旧 evidence 的 K3 字段只会在 previous 复核阶段失败，guard 本身不报 `DOMAIN_MISMATCH`。
- 如果切换 realm 时该 job 尚无 evidence（或首条 append），旧实现会成功创建第二套 head/version，形成并行域。

复现步骤：

1. realm-a 初始化并写入 evidence。
2. 把 `H4_EVIDENCE_REALM` 改为 realm-b、保持同一密钥/版本。
3. 旧实现：读取 realm-b 的 head/version（均不存在）→ 创建第二套 domain；没有全局锚点阻止。
4. 同一 job 的旧 evidence 可能在 previous 复核时报 `EVIDENCE_CHAIN_BROKEN`，但 guard 已把 realm 当作命名空间，未做到“同一稳定 head 比较”。

旧复审中的 F1/F1b 即对应这两项；本次按用户指定的更强契约关闭，不再保留“首次 append 自动创建”的兼容路径。

## 2. 修复行为

### 2.1 显式初始化与只读运行时分离

`h4c-evidence.mjs` 现在有三个明确层次：

| API | 性质 | 允许写入 | 调用方 |
|---|---|---|---|
| `applyEvidenceDomain(state, config)` | 只读运行时校验 | 否，成功返回 `[]` | append / 未来 reconcile |
| `evidenceDomainInitPrecondition(store)` | 只读全局空探针 | 否 | 显式初始化调用方 |
| `evidenceDomainInitWrites(state, opts)` | 纯 create-only 写构建 | 是（返回两条 write） | `initializeEvidenceDomain` / 测试 |
| `initializeEvidenceDomain(store, config, opts)` | 显式首次初始化 | 是，经 Store 事务 | 受控部署/测试；append 不调用 |

`appendEvidenceWrites` 只调用 `applyEvidenceDomain`，没有任何初始化分支；未来 reconcile 复用 append helper 时同样不会隐式触发初始化。

### 2.2 运行时错误语义

`applyEvidenceDomain` 的判定顺序：

1. `head === null`（双缺或仅缺 head）→ `DOMAIN_INCOMPLETE`/409。
2. head schema/ID/kind 损坏 → `DOMAIN_INCOMPLETE`/409。
3. head 的 realm/keyVersion/keyFingerprint 与当前 config 任一不同 → `DOMAIN_MISMATCH`/409。
   - 该比较发生在读取 version 记录之前，因此切 realm、改版本即使在 version 记录缺失/被预置时也稳定返回 mismatch。
4. head 与 config 匹配但 version 记录缺失 → `DOMAIN_INCOMPLETE`/409（同版本缺记录=损坏，不是配置变更）。
5. version 记录 schema/ID/kind 损坏 → `DOMAIN_INCOMPLETE`/409。
6. head 与 version 内部 realm/version/fingerprint 不一致 → `DOMAIN_INCOMPLETE`/409（不采纳任一侧）。
7. 完全匹配 → `[]`，零写。

所有失败都在返回 writes 之前抛出；LocalStore 不持久化、CloudStore 由事务回滚。

### 2.3 初始化边界

`initializeEvidenceDomain` 的写路径：

1. `evidenceDomainInitPrecondition(store)` 显式列出三个集合：`evidence_digest_domains`、`device_operation_evidence`、`device_operation_evidence_heads`。
2. 返回冻结的前置条件对象，包含 `empty`、三个集合的记录数、store 绑定、只读 `verifyEmpty()` 复核函数；对象带模块私有 Symbol，普通伪造对象无法通过。
3. `initializeEvidenceDomain` 要求该前置条件属于同一 store 且 `empty === true`；缺失/伪造/不可读取 → `DOMAIN_INCOMPLETE`/409，不猜测；已观察到记录 → `DOMAIN_INIT_CONFLICT`/409。
4. 调用 `verifyEmpty()`，并在 Store 事务 build 内再次 `verifyEmpty()`；随后 `evidenceDomainInitWrites` 再检查事务 state 中任何 domain/evidence/head 引用非空即拒绝。
5. 只有 head 与 version 两个固定 ID 的 create 写；Store 的 `evidence_digest_domains` 是 create-only，固定 head ID 使并发/重复初始化只有一个赢家，不覆盖。

**关于“Store 无法原子证明全局空”**：LocalStore 的 `transact` 队列使事务内复核串行化；CloudStore 的 `list` 不在事务快照内，只能 best-effort 复核。代码不声称跨进程原子证明，而是：

- 显式记录初始化前置条件（冻结对象 + 三个计数 + 复核函数）并在事务内外复核；
- 固定 head ID + create-only 写作为原子冲突闸门；
- 运行时 append 必须先通过只读 domain 校验，因此在 helper 契约内“有 evidence 必有已初始化 domain”，evidence 不能先于 domain 出现；
- 任何无法证明为空、读取失败、预置记录、并发冲突都失败关闭，绝不扫描修复或补写。

### 2.4 稳定 ID 规则（P0-2）

| 记录 | ID | 约束 |
|---|---|---|
| 全局 domain head | `evidence-digest-domain:v1:global`（固定版本化常量，`EVIDENCE_DOMAIN_HEAD_ID`） | 独立于 realm/org；全局唯一 |
| domain version | `evidence-digest-domain-version:<base64url(realm)>:<version>` | 使用冻结 realm/version；必须与同一 stable head 的 realm/keyVersion/keyFingerprint 完全一致 |
| per-job evidence head | `h4c-evidence-head-v1:<sha256(org,job)>` | 既有规则不变 |
| evidence | `h4c-evidence-v1:<sha256(org,job,sequence)>` | 既有规则不变 |

- head 记录存 `_id/kind/realm/keyVersion/keyFingerprint/revision/createdAt`，不存 orgId。
- 当前 config 的 realm/keyVersion/keyFingerprint 只与这一个稳定 head 比较；任一项变化 = `DOMAIN_MISMATCH`/409。
- 不允许第二套并行域：head ID 不含 realm/version，version 记录必须服从同一 head。
- 密钥轮换、keyVersion 迁移、realm 变更的受控迁移**不在本任务**，后续另立任务；当前只失败关闭。

## 3. 初始化 vs 运行时对照

| 场景 | 运行时 `applyEvidenceDomain` | 初始化 `initializeEvidenceDomain` |
|---|---|---|
| 三集合全空 | `DOMAIN_INCOMPLETE` | 允许，create-only 创建 head+version 对 |
| 任一 domain 记录存在 | 按匹配/损坏判定；双缺/单缺 incomplete | 拒绝 `DOMAIN_INIT_CONFLICT` |
| 任一 evidence 存在 | 不直接读取；domain 缺失时先 incomplete | 拒绝 `DOMAIN_INIT_CONFLICT` |
| 任一 evidence head 存在 | 不直接读取；domain 缺失时先 incomplete | 拒绝 `DOMAIN_INIT_CONFLICT` |
| 只有 head 缺 | `DOMAIN_INCOMPLETE` | 不适用（初始化要求全局空） |
| 只有 version 缺 | `DOMAIN_INCOMPLETE` | 不适用（初始化要求全局空） |
| realm/version/fingerprint 变化 | `DOMAIN_MISMATCH` | 不允许（初始化只在全空时） |
| 并发/重复初始化 | 不涉及 | 一个赢家；其余冲突，不覆盖 |
| 损坏记录 | 失败关闭，不修复 | 拒绝，不修复 |

## 4. 变更文件与“其他文件”说明

| 文件 | 变更 | 说明 |
|---|---|---|
| `admin-web/lib/face-service/h4c-evidence.mjs` | M | 只读 runtime、显式 init helper、稳定 head ID、version 受 head 约束 |
| `admin-web/tests/face-h4c-evidence.test.mjs` | M | 既有 23 项适配 + 新增 7 项，共 30 项 |
| `docs/tasks/HK-AI-04-H4C-C1-REVIEW-EVIDENCE-2026-11-14.md` | A | 本证据文档 |
| `admin-web/lib/store.mjs` | 未改 | 既有 `collections` 白名单、`seed()`、`LocalStore.init()`、`exactWriteCollections`、`createOnlyCollections` 已满足三集合 create-only/exact 要求；本次不扩大 Store 语义。 |
| `admin-web/lib/face-service/index.mjs` | 未改 | 既有 `export * from "./h4c-evidence.mjs"` 自动导出新增 helper，无需改动。 |
| `admin-web/server.mjs` | 未改 | 无 HTTP 路由/注册变更。 |
| 其他源码/部署/配置 | 未改 | 无迁移脚本、无密钥 provisioning、无云资源变更。 |

## 5. 测试覆盖（30 项）

### 5.1 P0-1 覆盖

| 要求 | 测试 |
|---|---|
| 空库 realm-a 初始化成功、同配置 runtime 通过 | `explicit initialization creates the single global pair; same config then passes` |
| 重复初始化拒绝、不覆盖 | 同上（第二段 `DOMAIN_INIT_CONFLICT`） |
| 运行时双缺（空库、有 evidence、有 evidence head） | `runtime rejects both-missing, head-only, version-only and evidence-only states with zero writes`、`append on an empty store never initializes the domain implicitly` |
| 单缺两种（仅缺 head / 仅缺 version） | 同上 + `runtime domain guard rejects one-sided and corrupt domains without backfill` |
| 损坏记录不修复 | 同上 + `damaged head variants are chain-broken without repair` |
| 初始化对任一已有记录拒绝 | `initialization rejects any pre-existing domain/evidence/evidence-head record` |
| 前置条件不可伪造 / 无法证明即失败 | `initialization requires a verifiable global-empty precondition and re-checks it` |
| append 不隐式初始化 | `append on an empty store never initializes the domain implicitly`、`first evidence appends only evidence+head after explicit initialization` |
| Store 白名单/seed/init/create-only/exact | `LocalStore registers the three collections and upgrades old local data`、`LocalStore keeps evidence/domain create-only and exact, head updates exact`、`CloudStore keeps exact fields and create-only semantics` |

### 5.2 P0-2 覆盖

| 要求 | 测试 |
|---|---|
| head ID 独立于 realm/org | `evidence/head/domain IDs are deterministic and the head is realm/org independent` |
| 切 realm-b | `runtime domain guard fails closed on realm switch, version change and same-version rekey`、`realm switch/version change/rekey are DOMAIN_MISMATCH and never add a head/version` |
| 改版本 | 同上 + `append fails closed on K3 rekey, realm/version change and one-sided domain` |
| 同版本换密钥 | 同上 |
| 预置第二 realm 不能绕过 | `realm switch/version change/rekey are DOMAIN_MISMATCH and never add a head/version` |
| 多组织同一稳定 head | `one stable global head is shared by multiple organizations and cannot fork` |
| realm 切换无新 head/version | `realm switch/version change/rekey are DOMAIN_MISMATCH and never add a head/version` |
| version 受 stable head 约束 | `runtime domain guard rejects one-sided and corrupt domains without backfill`、`domain validator is exact for the stable head and frozen version records` |

### 5.3 既有安全边界复核

仍保留并加强：

- K1/K2/K3 独立：只读 `H4_EVIDENCE_*`；K1/K2-only 环境 `NOT_CONFIGURED`。
- evidence 20 字段/head 9 字段/domain head 7/version 6 字段精确白名单；未知字段、非 plain object、非安全整数、非法枚举/长度均拒绝。
- previous evidence 正式 validator + `_id`/org/job/sequence/observedAt/K3 realm/version/fingerprint/HMAC 全量复核；新增 org/job 损坏用例。
- `constantTimeHexEqual` 在 `timingSafeEqual` 前先做 64 位小写 hex 校验，格式非法直接 false；通过校验后两侧必为等长 32 字节 Buffer。
- evidence/head 带 orgId 且按 org 点查；domain 记录无 orgId，为部署全局域。
- Store `seed()`/`init()` 对三集合的补齐、`collections` 白名单、exact 写字段、create-only 409 均未放宽。

## 6. 命令、exit code 与计数

环境：Windows 10.0.19042、Node v24.19.0、git 2.55.0.windows.3、PowerShell 7.6.9；工作目录 `SMART-PM`。

### 6.1 C1 定向

| 工作目录 | 命令 | Exit | 计数 |
|---|---|---:|---:|
| `admin-web` | `node --test --test-isolation=none tests/face-h4c-evidence.test.mjs` | 0 | tests 30 / pass 30 / fail 0 |
| `admin-web` | 同上 + `--import file:///.../.tmp/h4c-guard/guards.mjs` | 0 | tests 30 / pass 30 / fail 0；network_attempts=0；provider_calls=0 |

### 6.2 Admin 全量

| 工作目录 | 命令 | Exit | 计数 |
|---|---|---:|---:|
| `admin-web` | `node --test --test-isolation=none tests/*.test.mjs` | 0 | 41 files；tests 580 / pass 580 / fail 0 |

### 6.3 根测试

| 工作目录 | 命令 | Exit | 计数 |
|---|---|---:|---:|
| `SMART-PM` | `node --test --test-isolation=none tests/*.test.cjs` | 0 | 7 files；tests 51 / pass 51 / fail 0 |

### 6.4 静态与敏感检查

| 命令 | Exit | 结果 |
|---|---:|---|
| `git diff --check` | 0 | 无空白错误 |
| `git diff --quiet 3fce9b0 -- admin-web/server.mjs` | 0 | `server.mjs` 未变 |
| `node .tmp/h4c-guard/sensitive-scan.mjs`（3 个变更文件） | 0 | `total_findings: 0` |

敏感扫描类别：私钥块、AWS access key、GitHub token、Google API key、Slack token、Bearer token、通用 secret 字面量、32 字节 Base64 字面量、IPv4、MAC、中国大陆手机号；只输出计数，不输出匹配文本。该扫描是模式级检查，不是“绝对无秘密”的证明。

## 7. Provider / 网络 / 设备 / HTTP 状态

| 项 | C1 定向 | 说明 |
|---|---:|---|
| 真实 Provider 调用 | 0 | 仓库只有 Mock；C1 测试未实例化/调用 Mock Provider |
| Mock Provider 方法调用 | 0 | guard 包裹 `health/enrollFace/updateFace/revokeFace/queryOperation/verifyEvent`，计数 0 |
| 测试网络尝试 | 0 | guard 包裹 `fetch`、`http/https.request/get`、`net.connect/createConnection`、`tls.connect`、`dns.lookup/resolve`，计数 0 |
| 真实设备连接/写入 | 0 | 无 serial/device SDK 导入；测试只写 LocalStore/fake CloudStore |
| HTTP server/client 注册 | 0 | 未新增路由；`server.mjs` 零修改；C1 文件无 `.listen(`/HTTP 导入 |
| Cloud/live 调用 | 0 | `CloudStore` 测试使用 fake `database()` harness，无真实 CloudBase |
| 生产云/密钥 | 0 | 未配置或调用真实 K3，未 provisioning/轮换 |

Admin 全量是既有离线回归，其中包含既有 loopback 测试（`listen(0, <loopback>)` + `fetch`）；这些不是本次新增路由，也不是外部网络。本次未对全量注入 guard，因此不把既有 loopback 计为 0。真实 Provider/设备/Cloud/live 始终为 0。

## 8. 未实现项（明确不在本包）

- **C2**：HTTP/DTO/权限/组织/成员/actorType；job/grant/cleanupSnapshot 绑定；R1/R2 两段式；log/op key/op domain/audit；60 秒/8 次/24 小时；错误映射；finalize-retry；并发/重放/ack loss；reconcile decision。
- **C3**：真实 CloudBase 事务/索引/集合部署；真实 K3 密钥 provisioning/轮换；生产告警/监控；真实 Provider/设备；`server.mjs` 路由注册。
- **轮换/迁移**：realm 变更、keyVersion 迁移、历史 domain 受控迁移另立任务；本任务只失败关闭，不自动补写/回填/修复。
- 未修改 Store 白名单/seed/init 之外的行为；未新增 Store 方法；未改 index export 机制；未改 `server.mjs`；未做 HTTP 注册。

## 9. 复审交接

请 Codex 重点复核：

1. `applyEvidenceDomain` 的判定顺序是否在“双缺/单缺/损坏/配置变化”上完全符合本包第 2.2 节。
2. 初始化前置条件是否足以满足“不得猜测/不得扫描修复/失败关闭”的边界；尤其是 CloudStore 非事务快照下 `verifyEmpty` 的 best-effort 表述是否可接受。
3. 固定 head ID 与 version 记录约束是否彻底排除第二套并行域；预置第二 realm 的绕过测试是否充分。
4. 30 项测试是否覆盖全部指定场景；是否仍保留原 23 项的安全边界。

本文不声称 C1 已生产就绪；复审前不开始 C2/C3。
