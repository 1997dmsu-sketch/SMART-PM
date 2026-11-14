# HK-AI-04 H4-c C1 最终返工证据包

> 状态：**C1 运行时 K3 domain 初始化能力已彻底删除；只读校验、固定 head 与失败关闭契约已固定；等待 Codex 独立复审。**
> 本文只证明 C1 helper 与离线测试；不构成 C2/C3、HTTP 接线、真实 Provider、真实设备、Cloud/live 或生产发布批准。

- 分支：`feat/hk-face-h4c-reconciliation`
- 代码基线：`1155b7ba65991d324fb8b22bb8f7dd87f49428f9`
- C1 提交：`3fce9b027b720943bb049bd5220e117e9d91217e`
- 第一轮 P0 返工：`6dbc9e07616ccd2d33734f53f8c71ba18f6d6ac1`
- 本轮最终返工提交：本提交（直接父提交 `6dbc9e07616ccd2d33734f53f8c71ba18f6d6ac1`；未 rebase/squash/amend/force-push）
- 返工日期：2026-11-14（+08:00）
- 范围：仅 `admin-web/lib/face-service/h4c-evidence.mjs`、`admin-web/lib/face-service/index.mjs`、`admin-web/tests/face-h4c-evidence.test.mjs` 与本证据文档

## 0. 结论摘要

| 检查项 | 结果 |
|---|---|
| C1 运行时 K3 domain 初始化能力 | 已删除：生产实现 4 个导出及内部 precondition 全部移除 |
| 公共 index 初始化导出 | 已删除：index 改为显式非初始化导出白名单，无任何初始化 API |
| append / 未来 reconcile 调用初始化 | 不可能：模块内已无初始化函数；append 只调用 `applyEvidenceDomain` 只读校验 |
| 只读通过条件 | head 与 version 均存在、schema/kind/ID 完整且与当前 config 完全匹配才通过（`[]`） |
| 双缺 / 仅缺 head / 仅缺 version | 各自 `DOMAIN_INCOMPLETE`/409；所有集合内容级零写 |
| schema / kind / realm / version / fingerprint 损坏 | 失败关闭：结构性损坏 `DOMAIN_INCOMPLETE`/409；head 的有效但不同 realm/version/fingerprint 为 `DOMAIN_MISMATCH`/409 |
| 固定部署级 head ID | `evidence-digest-domain:v1:global`；不含 realm/orgId；realm、keyVersion、keyFingerprint 绑定在该 head 上 |
| realm/keyVersion/同版本换密钥 | 任一变化均 `DOMAIN_MISMATCH`/409；不创建第二 realm domain |
| 第二 realm 预置记录 | 不改变固定 head 验证；固定 head 始终只有一个 |
| 跨组织 | 多组织共享同一固定 head，不按 org 分叉 |
| previous evidence 复核 / timingSafeEqual | 保留完整复核与 `constantTimeHexEqual`；新增 malformed digest 用例，未回归 |
| 测试 | C1 30/30；Admin 全量 580/580（41 文件）；根测试 51/51（7 文件） |
| `git diff --check` | exit 0 |
| 敏感扫描 | 0 命中（4 个变更文件） |
| Provider / 网络 / HTTP 注册 / 真实设备 | C1 定向 guard：网络 0、Provider 0；`server.mjs` 零修改；无真实设备连接/写入 |
| C2 / C3 | 继续关闭，未实现 |
| 首次初始化迁移工具 | 本轮不实现；已在第 3 节移交未来独立部署迁移任务 |

## 1. 唯一目标：删除所有可调用的 K3 domain 初始化能力

### 1.1 已删除的生产符号

`h4c-evidence.mjs` 中以下实现与导出全部删除：

| 符号 | 原性质 | 现状 |
|---|---|---|
| `initializeEvidenceDomain` | 显式 Store 事务初始化 | 已删除，未导出 |
| `evidenceDomainInitPrecondition` | 全局空探针 | 已删除，未导出 |
| `evidenceDomainInitRefs` | 初始化写引用 | 已删除，未导出 |
| `evidenceDomainInitWrites` | 初始化写构建器 | 已删除，未导出 |
| `assertInitPrecondition` / `INIT_PRECONDITION` | 内部前置条件校验 | 已删除 |
| `DOMAIN_INIT_CONFLICT` 错误码 | 初始化冲突 | 已从生产代码移除 |

### 1.2 公共 index 显式白名单

`admin-web/lib/face-service/index.mjs` 不再使用 `export * from "./h4c-evidence.mjs"`。现在只显式导出 26 个非初始化符号：集合常量、K3 配置/摘要/ID/validator、`applyEvidenceDomain`、`evidenceAppendRefs` 与 `appendEvidenceWrites`。

初始化相关的 4 个名称不在导出列表中；测试 `production evidence module and public index expose no K3 initialization capability` 与 `face-service index exports only the non-init C1 evidence surface` 同时做动态命名空间断言（`undefined` 且 `Object.hasOwn === false`）和源码 token 扫描。

### 1.3 源码级证明

生产文件（`h4c-evidence.mjs`、`index.mjs`）中：

- `initializeEvidenceDomain`：0 命中
- `evidenceDomainInit`：0 命中
- `INIT_PRECONDITION`：0 命中
- `DOMAIN_INIT_CONFLICT`：0 命中
- `allowInitialize`：0 命中
- `mode=initialize` / `mode === "initialize"`：0 命中

因此不存在“允许初始化开关”“mode=initialize 隐藏分支”或“catch 后自动补写”的代码路径。`appendEvidenceWrites` 只调用 `applyEvidenceDomain(state, cfg)` 做只读校验；`applyEvidenceDomain` 成功只返回空写集合 `[]`，失败在返回任何写之前抛出。

### 1.4 行为级证明

- `append on an empty store never initializes the domain implicitly`：空库 append 直接 `DOMAIN_INCOMPLETE`，三个集合保持空。
- `first evidence appends only evidence+head after a fixed fixture seed`：成功 append 只产生 evidence + head 两条写，断言两条写都不属于 `evidence_digest_domains`。
- `runtime rejects both-missing, head-only, version-only and evidence-only states with zero writes`：双缺/单缺/仅有 evidence 均 `DOMAIN_INCOMPLETE`，`store.data` 内容级 deepEqual 不变。
- `both-missing after existing evidence or evidence head fails closed with every collection unchanged`：已有 evidence 或已有 evidence head 时移除 domain，append 仍 `DOMAIN_INCOMPLETE`，三类集合内容级不变。

## 2. 严格只读校验与固定 head

### 2.1 `applyEvidenceDomain` 判定顺序

| 顺序 | 条件 | 错误码 | 写入 |
|---:|---|---|---|
| 1 | state/config 形状非法 | `DOMAIN_INCOMPLETE`/409 | 无 |
| 2 | 固定 head 缺失（双缺或仅缺 head） | `DOMAIN_INCOMPLETE`/409 | 无 |
| 3 | head schema/ID/kind 损坏 | `DOMAIN_INCOMPLETE`/409 | 无 |
| 4 | head 的 realm/keyVersion/keyFingerprint 与当前 config 任一不同 | `DOMAIN_MISMATCH`/409 | 无 |
| 5 | head 匹配但 version 记录缺失 | `DOMAIN_INCOMPLETE`/409 | 无 |
| 6 | version 记录 schema/ID/kind 损坏 | `DOMAIN_INCOMPLETE`/409 | 无 |
| 7 | head 与 version 的 realm/keyVersion/keyFingerprint/kind 不一致 | `DOMAIN_INCOMPLETE`/409 | 无 |
| 8 | 全部完整匹配 | 返回 `[]` | 无 |

第 4 步刻意发生在读取 version 记录之前：切 realm、改 keyVersion、同版本换密钥时，即使新配置的 version 记录缺失或被预置，也稳定返回 `DOMAIN_MISMATCH`，不会把配置变化误判为“存储损坏”，更不会触发创建。

### 2.2 固定部署级 head

| 记录 | ID | 绑定字段 | 约束 |
|---|---|---|---|
| domain head | `evidence-digest-domain:v1:global`（固定常量 `EVIDENCE_DOMAIN_HEAD_ID`） | `realm`、`keyVersion`、`keyFingerprint`、`revision`、`createdAt` | ID 不含 realm/orgId；全局唯一；只读比对 |
| domain version | `evidence-digest-domain-version:<base64url(realm)>:<version>` | 同上三字段 + `enabledAt` | 必须与同一固定 head 完全一致；不构成第二命名空间 |
| per-job evidence head | `h4c-evidence-head-v1:<sha256(org,job)>` | 既有规则 | 按组织点查 |
| evidence | `h4c-evidence-v1:<sha256(org,job,sequence)>` | 既有规则 | 按组织点查 |

head 记录不含 `orgId`；测试直接断言 `Object.hasOwn(head, "orgId") === false`，且 `head._id === "evidence-digest-domain:v1:global"`。

### 2.3 失败关闭覆盖

| 损坏/变化 | 测试断言 |
|---|---|
| 双缺、仅缺 head、仅缺 version | `DOMAIN_INCOMPLETE`，所有集合内容级不变 |
| head/version 缺字段、未知字段、kind 交换/未知 | `DOMAIN_INCOMPLETE` |
| head revision 损坏、fingerprint 非法 | `DOMAIN_INCOMPLETE` |
| version kind/keyVersion/fingerprint/realm/ID 损坏 | `DOMAIN_INCOMPLETE` |
| head 有效但 realm 不同 | `DOMAIN_MISMATCH` |
| head 有效但 keyVersion 不同 | `DOMAIN_MISMATCH` |
| head 有效但 keyFingerprint 不同（同版本换密钥） | `DOMAIN_MISMATCH` |
| 配置切 realm/version/rekey（version 记录缺失） | `DOMAIN_MISMATCH` |
| 预置第二 realm 的 version 记录 | 仍 `DOMAIN_MISMATCH`；固定 head 仍为 realm-a；仅一个 head |
| 跨组织两个 job | 共享同一固定 head；head 数不随 org 增加 |
| previous evidence schema/ID/org/job/sequence/observedAt/K3/HMAC | `EVIDENCE_CHAIN_BROKEN`，零写 |
| previous evidence digest 长度/大小写/单字符篡改 | `EVIDENCE_CHAIN_BROKEN`；`constantTimeHexEqual` 先做 64 位小写 hex 校验，再 `timingSafeEqual` |

## 3. 首次初始化移交未来独立部署迁移任务

本轮**不实现**首次初始化、迁移工具、密钥 provisioning/轮换或任何 domain 写入路径。C1 只读取固定 head+version 对；缺失、损坏或不匹配一律失败关闭。

未来独立部署迁移任务必须满足（作为移交约束，不是本轮的实现声明）：

1. **维护窗口**：在明确的部署维护窗口内执行，禁止与在线 append/reconcile 并发。
2. **停写或全局锁**：先停止 H4-c 写入，或取得全局迁移锁；锁的持有时效与释放路径需审计。
3. **CloudStore 权威空集合检查**：以 CloudStore 为权威，确认 `evidence_digest_domains`、`device_operation_evidence`、`device_operation_evidence_heads` 三集合为空；LocalStore/缓存/前端观测不能替代。
4. **create-only**：只允许创建固定 head ID 与冻结 version ID；依赖 Store create-only 语义，任何已存在记录立即冲突退出。
5. **回读**：写入后逐字段回读 head/version，校验 `realm`、`keyVersion`、`keyFingerprint`、`kind`、`revision`、`enabledAt` 与预期一致。
6. **审计**：记录操作者、时间、部署环境、迁移前计数、写入 ID、回读结果与最终计数；不得记录密钥明文。
7. **回滚**：预先定义失败回滚/中止策略；若 create-only 部分成功或回读不一致，必须停止并提供人工可审计的处置，不得由运行时自动补写。

迁移任务完成前，C1 运行时对任何缺失 domain 的部署只能失败关闭，不得以“首次 append 自动初始化”兼容。

## 4. 变更文件与边界

| 文件 | 变更 | 说明 |
|---|---|---|
| `admin-web/lib/face-service/h4c-evidence.mjs` | M | 删除全部初始化实现；保留并强化只读 guard、固定 head、append 复核 |
| `admin-web/lib/face-service/index.mjs` | M | 用显式非初始化导出白名单替换 `export *` |
| `admin-web/tests/face-h4c-evidence.test.mjs` | M | 30 项测试；3 项初始化专用测试按新契约替换；fixture 改为测试内固定记录 |
| `docs/tasks/HK-AI-04-H4C-C1-REVIEW-EVIDENCE-2026-11-14.md` | M | 本证据文档 |

边界：

- `admin-web/lib/store.mjs`：未改。
- `admin-web/server.mjs`：未改；`git diff --quiet 6dbc9e0 -- admin-web/server.mjs` exit 0。
- C2/C3：未开始、未实现；无 HTTP 路由/DTO/权限/真实 Provider/真实设备/Cloud live 变更。
- 未新增迁移脚本、密钥 provisioning、数据集写工具或部署配置。

## 5. 测试覆盖（30 项）

### 5.1 数量与保留情况

- 测试总数：**30**。
- 原有测试保留 27 项：其中 25 项测试名与 `6dbc9e0` 完全一致；2 项仅改名并加强语义（`first evidence ... explicit initialization` → `... a fixed fixture seed`；`face-service index exports the C1 evidence surface` → `... only the non-init ...`）。
- 原有 3 项初始化专用测试（初始化正例、初始化拒绝已有记录、初始化前置条件）已按新契约替换为：
  1. `test fixture seeds the fixed global pair and runtime verification is read-only`
  2. `production evidence module and public index expose no K3 initialization capability`
  3. `both-missing after existing evidence or evidence head fails closed with every collection unchanged`

### 5.2 指定覆盖映射

| 要求 | 测试 |
|---|---|
| 公共 index 无任何 K3 初始化 API | `production evidence module and public index expose no K3 initialization capability`、`face-service index exports only the non-init C1 evidence surface` |
| 双缺/head-only/version-only 各自 `DOMAIN_INCOMPLETE` 且所有集合内容级不变 | `runtime rejects both-missing, head-only, version-only and evidence-only states with zero writes`、`runtime domain guard rejects one-sided and corrupt domains without backfill` |
| 已有 evidence 或已有 evidence head 时双缺 | `both-missing after existing evidence or evidence head fails closed with every collection unchanged` |
| realm、keyVersion、同版本换密钥均 `DOMAIN_MISMATCH` | `runtime domain guard fails closed on realm switch, version change and same-version rekey`、`append fails closed on K3 rekey, realm/version change and one-sided domain`、`realm switch/version change/rekey are DOMAIN_MISMATCH and never add a head/version` |
| 第二 realm 记录不改变固定 head 验证 | `realm switch/version change/rekey are DOMAIN_MISMATCH and never add a head/version`（预置 realm-b version 后，realm-a 仍通过只读校验并可正常 append） |
| 跨组织同一固定 head | `one stable global head is shared by multiple organizations and cannot fork` |
| previous evidence 完整复核与 `timingSafeEqual` 不回归 | `damaged previous evidence is chain-broken across schema, identity, org/job, time, K3 and HMAC` |
| append/reconcile 不初始化 | `append on an empty store never initializes the domain implicitly`、`first evidence appends only evidence+head after a fixed fixture seed` |
| fixture 固定且 Store create-only | `test fixture seeds the fixed global pair and runtime verification is read-only`、`LocalStore keeps evidence/domain create-only and exact, head updates exact`、`CloudStore keeps exact fields and create-only semantics` |

### 5.3 既有安全边界复核

仍保留：

- K1/K2/K3 独立：只读 `H4_EVIDENCE_*`；K1/K2-only 环境 `NOT_CONFIGURED`。
- evidence 20 字段/head 9 字段/domain head 7/version 6 字段精确白名单；未知字段、非 plain object、非安全整数、非法枚举/长度均拒绝。
- previous evidence 正式 validator + `_id`/org/job/sequence/observedAt/K3 realm/version/fingerprint/HMAC 全量复核。
- `constantTimeHexEqual` 在 `timingSafeEqual` 前先做 64 位小写 hex 校验；非法格式直接 false，通过后两侧必为等长 32 字节 Buffer。
- evidence/head 带 orgId 且按 org 点查；domain 记录无 orgId，为部署全局域。
- Store `seed()`/`init()` 对三集合的补齐、`collections` 白名单、exact 写字段、create-only 409 均未放宽。

## 6. 命令、exit code 与计数

环境：Windows 10.0.19042、Node v24.19.0、git 2.55.0.windows.3、PowerShell 7.6.9；独立 worktree `h4c-c1-final`（detached at `6dbc9e0`）。

### 6.1 C1 定向

| 工作目录 | 命令 | Exit | 计数 |
|---|---|---:|---:|
| `admin-web` | `node --test --test-isolation=none tests/face-h4c-evidence.test.mjs` | 0 | tests 30 / pass 30 / fail 0 |
| `admin-web` | 同上 + `--import file:///.../.tmp/h4c-guard/guards.mjs` | 0 | tests 30 / pass 30 / fail 0；`network_attempts=0`；`provider_calls=0` |

### 6.2 Admin 全量

| 工作目录 | 命令 | Exit | 计数 |
|---|---|---:|---:|
| `admin-web` | `node --test --test-isolation=none tests/*.test.mjs` | 0 | 41 files；tests 580 / pass 580 / fail 0 |

### 6.3 根测试

| 工作目录 | 命令 | Exit | 计数 |
|---|---|---:|---:|
| `h4c-c1-final` | `node --test --test-isolation=none tests/*.test.cjs` | 0 | 7 files；tests 51 / pass 51 / fail 0 |

### 6.4 静态与敏感检查

| 命令 | Exit | 结果 |
|---|---:|---|
| `git diff --check` | 0 | 无空白错误 |
| `git diff --quiet 6dbc9e0 -- admin-web/server.mjs` | 0 | `server.mjs` 未变 |
| 敏感扫描（4 个变更文件） | 0 | `total_findings: 0` |

敏感扫描类别：私钥块、AWS access key、GitHub token、Google API key、Slack token、Bearer token、通用 secret 字面量、32 字节 Base64 字面量、IPv4、MAC、中国大陆手机号；只输出计数，不输出匹配文本。该扫描是模式级检查，不是“绝对无秘密”的证明。

## 7. Provider / 网络 / 设备 / HTTP 状态

| 项 | C1 定向 | 说明 |
|---|---:|---|
| 真实 Provider 调用 | 0 | 仓库只有 Mock；C1 测试未实例化/调用 Mock Provider |
| Mock Provider 方法调用 | 0 | guard 包裹 `health/enrollFace/updateFace/revokeFace/queryOperation/verifyEvent`，计数 0 |
| 测试网络尝试 | 0 | guard 包裹 `fetch`、`http/https.request/get`、`net.connect/createConnection`、`tls.connect`、`dns.lookup/resolve`，计数 0 |
| 真实设备连接/写入 | 0 | 无 serial/device SDK 导入；测试只写 LocalStore/fake CloudStore |
| HTTP server/client 注册 | 0 | 未新增路由；`server.mjs` 零修改；变更文件无 `.listen(`/HTTP/网络导入 |
| Cloud/live 调用 | 0 | `CloudStore` 测试使用 fake `database()` harness，无真实 CloudBase |
| 生产云/密钥 | 0 | 未配置或调用真实 K3，未 provisioning/轮换 |

Admin 全量包含既有 loopback 测试（`listen(0, <loopback>)` + `fetch`），不是本次新增路由，也不是外部网络；本次未对全量注入 guard，因此不把既有 loopback 计为 0。真实 Provider/设备/Cloud/live 始终为 0。

Git 远端操作单列：本轮最终 `git push` 与 `git ls-remote` 比对见交付回报；它们不属于上述 Provider/网络/设备/HTTP 运行面计数。

## 8. 未实现项（明确不在本包）

- **首次初始化/迁移**：不实现初始化 API、迁移脚本、维护窗口编排、全局锁、CloudStore 权威空集合检查、回读/审计/回滚工具；只在本包第 3 节移交约束。
- **C2**：HTTP/DTO/权限/组织/成员/actorType；job/grant/cleanupSnapshot 绑定；R1/R2 两段式；log/op key/op domain/audit；60 秒/8 次/24 小时；错误映射；finalize-retry；并发/重放/ack loss；reconcile decision。
- **C3**：真实 CloudBase 事务/索引/集合部署；真实 K3 密钥 provisioning/轮换；生产告警/监控；真实 Provider/设备；`server.mjs` 路由注册。
- 未修改 Store；未改 `server.mjs`；未做 HTTP 注册。

## 9. 复审交接

请 Codex 重点复核：

1. 生产模块与公共 index 是否已无可调用的 K3 domain 初始化能力；是否存在等价隐藏开关或 catch 自动补写。
2. `applyEvidenceDomain` 在“双缺/单缺/损坏/配置变化”上的判定顺序、错误码与零写是否完全符合第 2 节。
3. 固定 head `evidence-digest-domain:v1:global` 是否彻底阻止第二 realm domain；预置第二 realm version、跨组织、同版本换密钥测试是否充分。
4. 30 项测试是否覆盖全部指定场景；被替换的 3 项初始化测试是否已由等价更强契约覆盖；既有安全边界是否保留。
5. 第 3 节对首次初始化迁移的约束是否足以作为未来独立任务的交接基线。

本文不声称 C1 已生产就绪；复审前不开始 C2/C3。完成后停手，交 Codex 独立复审。
