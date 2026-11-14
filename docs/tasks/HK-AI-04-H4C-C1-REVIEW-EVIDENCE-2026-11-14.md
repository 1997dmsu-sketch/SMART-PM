# HK-AI-04 H4-c C1 最终关闭及远端交付证据包

> 状态：**已确认 `90e4189` 未关闭 P0；本轮彻底删除 K3 生产初始化能力（含 `90e4189` 的显式 helper、空集合证明与 domain 写入），生产模块与公共 index 均无初始化入口；C1 runtime 仅保留严格只读验证并失败关闭；等待 Codex 独立复审。**
> 本文只证明 C1 helper 与离线测试；不构成 C2/C3、HTTP 接线、真实 Provider、真实设备、Cloud/live、K3 迁移/轮换或生产发布批准。

- 分支：`feat/hk-face-h4c-reconciliation`
- 代码基线：`1155b7ba65991d324fb8b22bb8f7dd87f49428f9`
- 原始 C1 提交（复审对象）：`3fce9b027b720943bb049bd5220e117e9d91217e`
- 第一轮 P0 返工（历史，保留）：`6dbc9e07616ccd2d33734f53f8c71ba18f6d6ac1`
- 第二轮返工（历史，保留）：`aa0db293c7744580e4e0aaa07159bc42b6ac73a6`
- 第三轮返工（被本轮复审判定未关闭 P0）：`90e4189717e21a5d458b09da34677ef29795c767`
- 本轮最终返工提交：**本提交**（直接父提交 `90e4189`；未 amend/rebase/squash/reset/force-push）
- 返工日期：2026-11-14（+08:00）
- 本轮变更文件：`admin-web/lib/face-service/h4c-evidence.mjs`、`admin-web/lib/face-service/index.mjs`、`admin-web/tests/face-h4c-evidence.test.mjs`、本证据文档
- 未改文件：`admin-web/lib/store.mjs`、`admin-web/server.mjs`、`admin-web/lib/face-service/routes.mjs`

提交链（只追加，不重写）：

```text
1155b7ba (origin/feat/hk-face-h4b-mock-cleanup)
  → 3fce9b0 (原始 C1)
  → 6dbc9e0 (第一轮返工)
  → aa0db29 (第二轮返工，origin/feat/hk-face-h4c-reconciliation)
  → 90e4189 (第三轮返工：显式初始化 helper；本轮判定 P0 未关闭)
  → 本提交 (最终关闭：删除全部生产初始化能力)
```

## 0. 结论摘要

| 检查项 | 结果 |
|---|---|
| `90e4189` 的 P0 | **未关闭**：Store 无法原子证明 evidence/evidence head/domain 三个全局集合为空；信任锚丢失后仍可用“空集合证明”重建 domain |
| 本轮处置 | 删除全部 K3 生产初始化能力，包括 `initializeEvidenceDomain`、precondition/proof、空集合检查、init refs/writes、`DOMAIN_INIT_CONFLICT`、任何 domain head/version 写入与 catch 后补写 |
| 生产入口 | 模块与公共 index 均无 initialize/bootstrap/create-domain API；生产目录 43 文件 token 扫描 0 命中 |
| C1 runtime | 严格只读：只读固定 head+version，完整匹配返回 `[]`，否则 `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH`（409）且在返回任何写之前抛错 |
| 固定全局 head | `evidence-digest-domain:v1:global`（字面常量），不含 realm/orgId；多组织共享同一 head |
| 第二 realm / 换版本 / 同版本换钥 | 一律 `DOMAIN_MISMATCH`/409、零写；预置第二 realm 记录不能改变结果或绕过 |
| 缺 head/version、schema/kind/内部绑定损坏 | 一律 `DOMAIN_INCOMPLETE`/409、零写 |
| 零写验证 | `structuredClone(store.data)` 基线 + 全库 `deepEqual` + 三集合分别断言 |
| previous evidence / timingSafeEqual | 保留 schema、org、job、sequence、observedAt、K3 realm/version/fingerprint、HMAC 完整复核；`timingSafeEqual` 前先做 64 位小写 hex 格式校验（同时保证等长 32 字节） |
| 测试 | C1 31/31；Admin 全量 581/581（41 文件）；根测试 51/51（7 文件） |
| `git diff --check` | exit 0 |
| 敏感值扫描 | 4 个变更文件，`total_findings: 0` |
| Provider / 业务网络 / HTTP 注册 / 真实设备 | 均为 0（定向 guard：`network_attempts=0`、`provider_calls=0`、`http_servers=0`） |
| `server.mjs` / `store.mjs` 本轮差异 | 0 |
| C2 / C3 | 继续关闭，未开始、未实现 |
| K3 迁移 / 轮换 / realm 变更 | 未实现；首次初始化移交未来受控部署迁移 |

## 1. 复审结论：`90e4189` 为何未关闭 P0

### 1.1 `90e4189` 的实际形态

`90e4189` 在 `h4c-evidence.mjs` 中新增并导出了完整的生产初始化能力：

| 符号 | 作用 |
|---|---|
| `initializeEvidenceDomain(store, config, { now, precondition, audit })` | 在 Store 事务中创建固定 head + version |
| `evidenceDomainInitPrecondition({ scope, domains, evidence, evidenceHeads, checkedAt, checkedBy })` | 由调用者记录“三集合为空”的 proof |
| `evidenceDomainInitRefs(config)` | 初始化固定的两个 domain 点引用 |
| `evidenceDomainInitWrites(state, { config, now, precondition })` | 纯 create-only domain head/version 写构建器 |
| `assertInitPrecondition` / `INIT_PRECONDITIONS` | proof 令牌校验 |
| `EVIDENCE_DOMAIN_INIT_SCOPE` / `DOMAIN_INIT_CONFLICT` | 初始化作用域与冲突错误码 |

虽然 `index.mjs` 没有 re-export 这些符号，但它们仍是生产模块中可被任意服务端代码 `import` 并调用的写入口。这已经违反“生产不得初始化 K3 domain”的 P0 约束。

### 1.2 为什么“空集合证明”不能关闭 P0

1. **Store 无法原子证明全局为空。** `Store.transact` 只能按声明好的点引用读取；`evidence_digest_domains`、`device_operation_evidence`、`device_operation_evidence_heads` 三个集合的“全局为空”没有原子原语。helper 又刻意不扫描 Store，因此“空”这一事实只能由事务外的调用者观测并记录。
2. **proof 是调用者提供的元数据，不是 Store 派生的事实。** proof 只包含 `scope/domains/evidence/evidenceHeads/checkedAt/checkedBy`；helper 不读取、不回查、不扫描。只要调用者传入三个空数组（伪造或在窗口期之前观测），helper 就无法发现未声明的存量记录。`90e4189` 证据包 §3.2 自述的“已知边界”实际上就是 P0 本身。
3. **信任锚丢失后仍可重建。** 若固定 head/version 因误删、迁移或环境重建而丢失，持有空 proof 的调用者仍可重新创建同一 head/version，运行时随后会把它当作可信锚接受。也就是说，“信任锚一旦丢失即可重建”这一 P0 场景没有被关闭，只是把重建入口从 append 移到了显式 helper。
4. **C1 不需要“首次初始化”这一生产能力。** C1 的合同是运行时只读、缺失即失败关闭；首次初始化属于部署迁移动作，不能作为库代码暴露给运行时。

### 1.3 本轮决定

- **不保留任何初始化 helper、proof、空集合检查或 domain 写构建器。** 生产代码不再存在“写入 domain”的函数，也不存在初始化错误码或模式开关。
- **首次初始化移交未来受控部署迁移。** 该迁移必须在维护窗口、停写/全局锁、以 CloudStore 为权威确认三集合为空、create-only、回读、审计与回滚约束下执行；C1 不实现、也不调用。
- **C1 runtime 只读失败关闭。** 缺 head、缺 version、双缺、schema/kind/内部绑定损坏、配置变化全部失败关闭；成功也只返回空写集。
- **K3 迁移/轮换/realm 变更未实现。** 当前固定 head 绑定单一 realm/keyVersion/fingerprint；正式轮换与历史密钥回退留给未来独立任务。

## 2. 删除清单与静态证明

### 2.1 模块删除清单

`h4c-evidence.mjs` 中以下能力全部删除：

| 删除项 | 说明 |
|---|---|
| `initializeEvidenceDomain` | 生产 Store 事务初始化入口 |
| `evidenceDomainInitPrecondition` | 空集合 proof 生成器 |
| `evidenceDomainInitRefs` | 初始化点引用 |
| `evidenceDomainInitWrites` | domain head/version 写构建器 |
| `assertInitPrecondition` / `INIT_PRECONDITIONS` | proof 令牌与内部校验 |
| `EVIDENCE_DOMAIN_INIT_SCOPE` | 初始化作用域常量 |
| `DOMAIN_INIT_CONFLICT` | 初始化冲突错误码 |
| 三集合空列表检查 | 随 proof 一并删除 |
| 任何 `write(EVIDENCE_DOMAINS_COLLECTION, ...)` | 模块内 0 处 |
| 任何 `store.transact(...)` | 模块内 0 处；模块不再持有 Store 句柄 |
| `catch (DOMAIN_INCOMPLETE) { ...写入... }` / catch 后补写 | 0 处；guard 抛错后 append 不会返回写 |

删除后模块仍保留：

- 精确 schema validator（evidence 20 字段、head 9 字段、domain head 7/version 6 字段）；
- 独立 K3 配置、fingerprint、canonical HMAC；
- 确定性 evidence/head ID 与固定全局 domain head ID；
- `applyEvidenceDomain` 严格只读校验；
- `evidenceAppendRefs`、`appendEvidenceWrites`（只写 evidence + head）；
- `validateEvidenceDomainRecord` 作为运行时 domain verify。

### 2.2 公共 index

`index.mjs` 使用显式白名单导出 26 个运行时符号：

- 常量：集合名、digest domain/algorithm/version、schema version、scope、sequence 上限、固定 head ID、fingerprint domain；
- 函数/助手：`applyEvidenceDomain`、`appendEvidenceWrites`、`evidenceAppendRefs`、`evidenceDigest`、`evidenceDomainIds`、`evidenceHeadId`、`evidenceId`、`evidenceKeyConfig`、`evidenceKeyFingerprint`、`stableStringify`、`stableValue`、`validateEvidenceDomainRecord`、`validateEvidenceHead`、`validateEvidenceRecord`。

初始化、bootstrap、create-domain、domain record builder 均不在导出列表中；模块本身也不再导出这些名称。

### 2.3 自动化静态证明

测试 `production module, public index and production tree expose no K3 initialization capability` 做四层断言：

1. **公共 index 命名空间**：`initializeEvidenceDomain`、`evidenceDomainInitPrecondition`、`evidenceDomainInitRefs`、`evidenceDomainInitWrites`、`bootstrapEvidenceDomain`、`createEvidenceDomain`、`ensureEvidenceDomain` 均 `hasOwn === false` 且值为 `undefined`；index 导出名不得匹配 `/init|bootstrap|create.*domain/i`。
2. **模块导出面**：模块导出名同样不得匹配该正则，证明“连模块内部也没有可导入的初始化 API”。
3. **源码 token**：模块与 index 源码中 `initialize`、`bootstrapEvidence`、`evidenceDomainInit`、`INIT_PRECONDITION`、`DOMAIN_INIT_CONFLICT`、`allowInitialize`、`allowInitEvidence`、`mode: "initialize"`、`mode === "initialize"`、`createEvidenceDomain`、`ensureEvidenceDomain`、`emptyProof`、`emptyBootstrap` 均 0 命中。
4. **生产目录全量扫描**：递归扫描 `admin-web` 下 43 个生产 JS 文件（排除 `tests`、`node_modules`），断言 `initializeEvidenceDomain`、`bootstrapEvidenceDomain`、`bootstrapEvidence`、`evidenceDomainInit`、`INIT_PRECONDITION`、`DOMAIN_INIT_CONFLICT`、`allowInitialize`、`allowInitEvidence`、`mode: "initialize"`、`mode === "initialize"`、`createEvidenceDomain`、`ensureEvidenceDomain` 全部 0 命中；并断言 `applyEvidenceDomain` 函数体无 `write(`/`transact(`、`appendEvidenceWrites` 无 domain 写、模块无 `transact(` 与 `export async function`。

`face-service index exports only the non-init C1 evidence surface` 另行断言 14 个运行时函数与固定 head 常量存在，4 个初始化名称不存在。

### 2.4 测试 fixture 改为测试内直接构造 domain

- `makeDomainRecords()` 在测试文件内直接构造完整 head/version 纯数据；
- `seedDomain()` 通过普通 create-only Store 事务写入这两条记录；
- 测试文件不存在对生产初始化 helper 的 import 或调用（初始化名称只作为“禁止 token”出现在静态断言字符串中）；
- 所有调用 `initializeEvidenceDomain` / `evidenceDomainInitWrites` / `evidenceDomainInitPrecondition` 的测试已删除或改写为上述 fixture 路径。

## 3. 严格只读契约

### 3.1 `applyEvidenceDomain(state, config)` 判定顺序

| 顺序 | 条件 | 错误码 | 写 |
|---:|---|---|---:|
| 1 | state/config 形状非法（realm/keyVersion/fingerprint 非规范） | `DOMAIN_INCOMPLETE`/409 | 0 |
| 2 | 固定 head 缺失（双缺或仅 version） | `DOMAIN_INCOMPLETE`/409 | 0 |
| 3 | head schema/ID/kind/字段损坏 | `DOMAIN_INCOMPLETE`/409 | 0 |
| 4 | head 的 realm/keyVersion/keyFingerprint 与当前 config 任一不同 | `DOMAIN_MISMATCH`/409 | 0 |
| 5 | head 匹配但 version 记录缺失 | `DOMAIN_INCOMPLETE`/409 | 0 |
| 6 | version schema/ID/kind/字段损坏 | `DOMAIN_INCOMPLETE`/409 | 0 |
| 7 | head 与 version 的 realm/keyVersion/keyFingerprint/kind 互相矛盾 | `DOMAIN_INCOMPLETE`/409 | 0 |
| 8 | 全部完整且完全匹配 | 返回 `[]` | 0 |

说明：

- 第 4 步发生在读取 version 记录之前：realm 切换、keyVersion 变化、同版本换钥稳定识别为配置变化 `DOMAIN_MISMATCH`，不会误判成“存储损坏”，也不会触发创建/修复。
- head 匹配后 version 缺失属于存储损坏，`DOMAIN_INCOMPLETE`；与“缺一/缺两”的失败关闭语义一致。
- 仅 version 存在、head 缺失：先返回 `DOMAIN_INCOMPLETE`，不会因为是“新 realm”而创建 head。
- 不存在初始化分支、隐藏开关、`mode` 参数或 catch 后补写。

### 3.2 append 写集

`appendEvidenceWrites` 的顺序：

1. 校验 job/config/now/decision/source/observedAt；
2. 调用 `applyEvidenceDomain(state, cfg)` 只读校验；失败立即抛错，成功也忽略其空返回；
3. 事务内重读 per-job evidence head，做 CAS/首条/链尾判断；
4. 完整复核 previous evidence（schema、`_id`、org、job、sequence、observedAt、K3 realm/version/fingerprint、HMAC）；
5. 只返回新 evidence + 新 head 两条写。

因此 append 不可能产生 domain 写；未来 reconcile 复用同一 guard 时也不会隐式初始化。

### 3.3 失败零写

所有运行时失败路径在返回任何写之前抛错。测试对每个失败用例：

1. 先 `structuredClone(store.data)` 作为基线；
2. 断言抛出的错误码；
3. 对全库 `assert.deepEqual(store.data, before)`；
4. 再分别断言 `evidence_digest_domains`、`device_operation_evidence`、`device_operation_evidence_heads` 内容级不变。

纯函数 guard 用例则对输入 state 做 `structuredClone` 后 `deepEqual`，证明 guard 不修改 state。

### 3.4 固定全局 head 与多组织

- `EVIDENCE_DOMAIN_HEAD_ID = "evidence-digest-domain:v1:global"`；测试直接断言字面值。
- ID 不含 realm、不含 orgId；`realm-a`、`realm-b`、任意组织看到的 head ID 完全相同。
- head 记录固定 7 字段：`_id, kind, realm, keyVersion, keyFingerprint, revision, createdAt`；无 `orgId`。
- version ID 仍含冻结的 `base64url(realm)` 与 `keyVersion`：
  `evidence-digest-domain-version:<base64url(realm)>:<keyVersion>`；它只能与同一固定 head 配对，不能构成第二命名空间。
- 多组织追加时共享同一固定 head；per-job evidence head 仍按 org/job 分域。
- 预置第二 realm 的 version 记录不会绕过固定 head：realm-a 配置仍通过只读校验并可正常 append；realm-b 配置仍 `DOMAIN_MISMATCH`，且 head 数始终为 1。

## 4. 测试覆盖（31 项）

### 4.1 指定覆盖映射

| 要求 | 测试 |
|---|---|
| 固定 head ID 字面冻结 | `evidence/head/domain IDs are deterministic and the head is realm/org independent`、`test fixture seeds the fixed global pair and runtime verification is read-only` |
| 多组织命中同一 head | `one stable global head is shared by multiple organizations and cannot fork` |
| 第二 realm 记录不能改变结果或绕过 | `realm switch/version change/rekey are DOMAIN_MISMATCH and never add a head/version`（预置 realm-b version 后 realm-a 仍通过并可 append） |
| head/version 完整匹配通过且零写 | `test fixture seeds the fixed global pair and runtime verification is read-only`（连续两次返回 `[]`，全库 deepEqual） |
| 双缺 / head-only / version-only / 仅有 evidence 或 evidence head | `runtime rejects both-missing, head-only, version-only and evidence-only states with zero writes` |
| schema/kind/内部绑定损坏 | `runtime domain guard rejects one-sided and corrupt domains without backfill`（含缺字段、未知字段、kind 交换、fingerprint/revision/ID/realm 损坏） |
| 已有 evidence 后双缺 | `both-missing after existing evidence or evidence head fails closed with every collection unchanged` |
| 已有 evidence head 后双缺 | 同上 |
| realm 变化 / keyVersion 变化 / 同版本换钥 | `runtime domain guard fails closed on realm switch, version change and same-version rekey`、`append fails closed on K3 rekey, realm/version change and one-sided domain`、`realm switch/version change/rekey are DOMAIN_MISMATCH and never add a head/version` |
| 空库 append 不初始化 | `append on an empty store never initializes the domain implicitly` |
| append 只写 evidence + head | `first evidence appends only evidence+head after a fixed fixture seed` |
| previous evidence 完整复核 | `damaged previous evidence is chain-broken across schema, identity, org/job, time, K3 and HMAC` |
| timingSafeEqual 前格式/长度 | `constant-time digest comparison validates canonical hex before timingSafeEqual` + damaged 用例中的 63 位与全大写 digest |
| head CAS 与并发分叉 | `second evidence validates its parent and CAS-increments the head`、`stale head CAS and missing/orphan head fail closed with zero writes`、`concurrent appends on the same head have one winner and no fork` |
| 公共 index 无初始化 API | `face-service index exports only the non-init C1 evidence surface`、`production module, public index and production tree expose no K3 initialization capability` |
| 生产目录无初始化旁路 | `production module, public index and production tree expose no K3 initialization capability` |
| fixture 直接构造 domain | `test fixture seeds the fixed global pair and runtime verification is read-only` |
| Store 白名单/seed/init | `LocalStore registers the three collections and upgrades old local data` |
| Store create-only/exact | `LocalStore keeps evidence/domain create-only and exact, head updates exact`、`CloudStore keeps exact fields and create-only semantics` |
| K1/K2/K3 独立 | `K3 config is independent, canonical and fingerprint-bound`（K1、K2 环境均不能替代 K3） |
| 持久化无秘密/禁止字段 | `persisted evidence, logs and audits contain no secrets or forbidden payloads` |

### 4.2 数量说明

- 测试总数 **31**（较 `aa0db29` 的 30 项增加 1 项源码级 `constantTimeHexEqual` 断言）。
- `90e4189` 新增的 4 项初始化正例/反例测试已全部删除，相关场景改由测试内 domain fixture + 只读失败关闭测试覆盖。
- 原 23 项 C1 场景全部保留或由更强契约替换；未删除既有安全边界测试。

## 5. 命令、exit code 与计数

环境：Windows 10.0.19042、Node v24.19.0、git 2.55.0.windows.3、PowerShell 7.x；独立 worktree `.tmp/hk-h4c-c1-final-90e4189`（detached at `90e4189`），未使用主工作区提交。

### 5.1 C1 定向

| 工作目录 | 命令 | Exit | 计数 |
|---|---|---:|---:|
| `admin-web` | `node --test --test-isolation=none tests/face-h4c-evidence.test.mjs` | 0 | tests 31 / pass 31 / fail 0 |
| `admin-web` | 同上 + `--import ../../h4c-final-90e4189/guards.mjs` | 0 | tests 31 / pass 31 / fail 0；`network_attempts=0 provider_calls=0 http_servers=0` |

### 5.2 Admin 全量

| 工作目录 | 命令 | Exit | 计数 |
|---|---|---:|---:|
| `admin-web` | `node --test --test-isolation=none "tests/*.test.mjs"` | 0 | 41 files；tests 581 / pass 581 / fail 0 |

### 5.3 根测试

| 工作目录 | 命令 | Exit | 计数 |
|---|---|---:|---:|
| 仓库根 | `node --test --test-isolation=none "tests/*.test.cjs"` | 0 | 7 files；tests 51 / pass 51 / fail 0 |

### 5.4 静态与敏感检查

| 命令 | Exit | 结果 |
|---|---:|---|
| `node --check admin-web/lib/face-service/h4c-evidence.mjs` | 0 | 语法通过 |
| `node --check admin-web/lib/face-service/index.mjs` | 0 | 语法通过 |
| `node --check admin-web/tests/face-h4c-evidence.test.mjs` | 0 | 语法通过 |
| `git diff --check`（提交前工作树） | 0 | 无空白错误 |
| `git diff --check 90e4189..HEAD`（提交后） | 0 | 无空白错误 |
| `git diff --quiet 90e4189 -- admin-web/server.mjs admin-web/lib/store.mjs` | 0 | `server.mjs`、`store.mjs` 均未变 |
| 生产目录初始化 token 扫描（43 文件） | 0 | 0 命中 |
| 敏感扫描（4 个变更文件） | 0 | `total_findings: 0` |

敏感扫描类别：私钥块、AWS access key、GitHub token、Google API key、Slack token、Bearer token、通用 secret 字面量、32 字节 Base64 字面量、IPv4、MAC、中国大陆手机号、18 位身份证号。只输出计数，不输出匹配文本。该扫描是模式级检查，不是“绝对无秘密”的证明。

## 6. Provider / 网络 / 设备 / HTTP 副作用

| 项 | C1 定向 | 说明 |
|---|---:|---|
| 真实 Provider 调用 | 0 | 仓库只有 Mock；C1 测试未实例化/调用 Mock Provider |
| Mock Provider 方法调用 | 0 | guard 包裹 `health/enrollFace/updateFace/revokeFace/queryOperation/verifyEvent`，计数 0 |
| 测试业务网络尝试 | 0 | guard 包裹 `fetch`、`http/https.request/get`、`net.connect/createConnection`、`tls.connect`、`dns.lookup/resolve`，计数 0 |
| HTTP server 注册 | 0 | guard 包裹 `http/https/net.createServer`，计数 0；未新增路由；`server.mjs` 零修改 |
| 真实设备连接/写入 | 0 | 变更代码无 serial/device SDK/蓝牙/USB/网络设备通道；测试只写 LocalStore/fake CloudStore |
| Cloud/live 调用 | 0 | `CloudStore` 测试使用 fake `database()` harness，无真实 CloudBase |
| K3 provisioning/轮换 | 0 | 未配置或调用真实 K3；未生成/保存密钥 |

Admin 全量包含既有 loopback 测试（`listen(0, <loopback>)` + `fetch`），不是本次新增路由，也不是外部网络；本次未对全量注入 guard，因此不把既有 loopback 计为 0。真实 Provider/设备/Cloud/live 始终为 0。

Git 远端操作（普通 push 与 `git ls-remote` 比对）单列在交付回报中，不属于上述运行面计数。

## 7. 未实现项（明确不在本包）

- **首次初始化/迁移**：不实现初始化 API、迁移脚本、维护窗口编排、全局锁、CloudStore 权威空集合检查、回读/审计/回滚工具；只在 §1.3 移交约束。
- **K3 迁移/轮换/realm 变更**：未实现；固定 head 仍绑定单一 realm/keyVersion/fingerprint。
- **C2**：HTTP/DTO/权限/组织/成员/actorType；job/grant/cleanupSnapshot 绑定；R1/R2 两段式；log/op key/op domain/audit；60 秒/8 次/24 小时；错误映射；finalize-retry；并发/重放/ack loss；reconcile decision。
- **C3**：真实 CloudBase 事务/索引/集合部署；真实 K3 密钥 provisioning/轮换；生产告警/监控；真实 Provider/设备；`server.mjs` 路由注册。
- 未修改 `store.mjs`；未修改 `server.mjs`；未新增路由；未合并 `main`；未 force-push/rebase/squash/amend/reset。

## 8. 交付与复审交接

- 分支：`feat/hk-face-h4c-reconciliation`
- 本提交父 SHA：`90e4189717e21a5d458b09da34677ef29795c767`
- 本提交 SHA：**由交付回报给出**（本文件随该提交一起提交，无法在提交前写入自身 SHA）
- 完整链：`1155b7ba → 3fce9b0 → 6dbc9e0 → aa0db29 → 90e4189 → 本提交`
- 变更文件：3 个代码/测试文件 + 本证据文档；不含 REL-AI-02 两份文档、HK-AI-06A/07A 文档或 `.tmp` 临时文件。
- 工作区：提交后仅保留任务开始前已存在的未跟踪文件，不纳入本提交。
- 远端核验：普通 push 目标 `feat/hk-face-h4c-reconciliation`；以远端分支 SHA 与本提交 SHA 对比，结果见交付回报。

请 Codex 重点复核：

1. 生产模块、公共 index 与整个生产目录是否已无任何可调用/可导入的 K3 初始化能力、bootstrap、空集合检查、domain 写构建器或 `mode: "initialize"` 旁路。
2. `applyEvidenceDomain` 在双缺/单缺/损坏/配置变化上的判定顺序、错误码与零写是否符合 §3。
3. 固定 head `evidence-digest-domain:v1:global` 是否彻底阻止第二 realm；预置第二 realm version、跨组织、同版本换密钥测试是否充分。
4. 31 项测试是否覆盖全部指定场景；fixture 是否完全脱离生产初始化 helper。
5. §1.2 对“Store 无法原子证明全局为空、信任锚丢失可重建”的结论，以及 §1.3 的迁移移交边界，是否足以支撑 C1 关闭。

本文不声称 C1 已生产就绪；复审前不开始 C2/C3。完成后停手，交 Codex 独立复审。
