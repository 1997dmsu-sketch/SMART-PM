# HK-AI-04 H4-c C1 两项 P0 返工证据包

> 状态：**C1 运行时只读校验与独立显式受控初始化 helper 已分离；固定全局 head 已固化；等待 Codex 独立复审。**
> 本文只证明 C1 helper 与离线测试；不构成 C2/C3、HTTP 接线、真实 Provider、真实设备、Cloud/live 或生产发布批准。

- 分支：`feat/hk-face-h4c-reconciliation`
- 代码基线：`1155b7ba65991d324fb8b22bb8f7dd87f49428f9`
- 原始 C1 提交（复审对象）：`3fce9b027b720943bb049bd5220e117e9d91217e`
- 第一轮 P0 返工（历史，保留）：`6dbc9e07616ccd2d33734f53f8c71ba18f6d6ac1`
- 第二轮返工（历史，保留）：`aa0db293c7744580e4e0aaa07159bc42b6ac73a6`
- 本轮最终返工提交：**本提交**（直接父提交 `aa0db29`；未 rebase/squash/amend/force-push）
- 返工日期：2026-11-14（+08:00）
- 本轮变更文件：`admin-web/lib/face-service/h4c-evidence.mjs`、`admin-web/lib/face-service/index.mjs`、`admin-web/tests/face-h4c-evidence.test.mjs`、本证据文档
- 未改文件：`admin-web/lib/store.mjs`、`admin-web/server.mjs`、`admin-web/lib/face-service/routes.mjs`

> 说明：任务给出的“现有提交 `3fce9b0`”是原始 C1 复审对象；当时分支 tip 已前进到 `aa0db29`（含 `6dbc9e0`、`aa0db29` 两次历史返工）。本轮遵守“保留历史、仅追加提交”，直接追加在 `aa0db29` 之上，不重写、不 force-push。

## 0. 结论摘要

| 检查项 | 结果 |
|---|---|
| 运行时缺 head / 缺 version / 双缺 | `DOMAIN_INCOMPLETE`/409，零写 |
| 运行时 realm / keyVersion / fingerprint 任一变化 | `DOMAIN_MISMATCH`/409，零写 |
| append 是否隐式初始化或补写 domain | 否：只调用只读 `applyEvidenceDomain`，只写 evidence + head |
| 显式初始化 helper | 独立 `initializeEvidenceDomain`，仅 2 条 create-only domain 写 |
| 初始化全局空证明 | 由受控迁移记录 `scope=global` + 三集合空列表 + checkedAt/checkedBy；helper 不扫描 Store |
| 初始化缺前置条件 | `DOMAIN_INCOMPLETE`/409，零写 |
| 初始化发现已存在记录 | `DOMAIN_INIT_CONFLICT`/409，零写、不覆盖 |
| 固定部署级 head ID | `evidence-digest-domain:v1:global`，不含 realm/org；单 head 约束 version |
| 第二 realm / 换版本 / 同版本换密钥 | 初始化与运行时均拒绝；不写第二 head/version |
| 多组织 | 共享同一固定 head；evidence/head 仍为组织域 |
| previous evidence 复核 / timingSafeEqual | 保留完整复核；digest 先做 64 位小写 hex 校验，再进入等长 32 字节 Buffer 的 `timingSafeEqual` |
| 测试 | C1 35/35；Admin 全量 585/585（41 文件）；根测试 51/51（7 文件） |
| `git diff --check` | exit 0 |
| 敏感扫描 | 4 个变更文件 0 命中 |
| Provider / 网络 / HTTP 注册 / 真实设备 | C1 定向 guard：网络 0、Provider 方法 0、HTTP server 0；`server.mjs` 零修改 |
| C2 / C3 | 继续关闭，未实现 |

## 1. 旧 P0 复现与本轮修正

### 1.1 P0-1：初始化与运行时是否分离

**原始 C1 `3fce9b0` 的复现事实：**

- `applyEvidenceDomain(state, config)` 在 head/version 双缺时直接返回两条 create 写（head + version）。
- `appendEvidenceWrites` 先调用 `applyEvidenceDomain`，并把返回的 domain 写拼进 append 写集。
- 因此空库第一次 append 会“顺手”创建 K3 domain；删除 domain 后 append 也会回填。这是隐式初始化/自动补写，不是受控初始化。

**历史返工：**

- `6dbc9e0` 把 `applyEvidenceDomain` 改为只读，新增显式初始化；但其全局空证明通过 `store.list()` 扫描三集合，并在事务外/内重复 `verifyEmpty`。Store 无法原子证明全局空，扫描也不构成原子证明，因此不满足本轮“不猜测、不扫描”的约束。
- `aa0db29` 又把初始化能力整体删除，运行时只读；但本轮要求保留“独立显式受控初始化 helper”，因此需要第三种形态：**运行时只读 + 独立 helper + 记录式全局空前置条件**。

**本轮修正：**

| 项 | 修正 |
|---|---|
| `applyEvidenceDomain` | 严格只读：只读 fixed head/version、校验、比较；成功返回 `[]`，失败抛错；无 create/repair/backfill 分支 |
| `appendEvidenceWrites` | 只调用 `applyEvidenceDomain` 做只读校验；返回值只有 evidence + head 两条写，不再拼接任何 domain 写 |
| 初始化 | 新增独立 `initializeEvidenceDomain`；不被 append/reconcile 调用；只写 fixed head + frozen version 两条 create-only 记录 |
| 全局空 | 由 `evidenceDomainInitPrecondition` 记录受控迁移观测到的三集合空列表；helper 不读取/不扫描 Store；缺证明或证明非空一律失败关闭 |
| 已存在记录 | 事务状态中任一可见 domain/evidence/evidence-head 记录均 `DOMAIN_INIT_CONFLICT`；Store 对 domain 仍为 create-only |
| 修复/补写 | 无任何 catch 后静默修复、无自动迁移、无回填 |

### 1.2 P0-2：head ID 是否与 realm/org 解耦

**原始 C1 `3fce9b0` 的复现事实：**

- `evidenceDomainIds(realm, version)` 返回的 head ID 为 `evidence-digest-domain:<base64url(realm)>`。
- realm 变化会产生新的 head ID，从而允许第二套并存域；这正是 P0-2。

**本轮固定规则：**

- head ID 由用途常量 + 版本常量 + 固定 `global` 段派生：
  - purpose：`evidence-digest-domain`
  - version：`v1`
  - head ID：`evidence-digest-domain:v1:global`
- head ID 不含 realm、不含 orgId、不随 keyVersion/fingerprint 变化。
- head 记录固定 7 字段：`_id, kind, realm, keyVersion, keyFingerprint, revision, createdAt`；无 `orgId`。
- version ID 仍可含冻结的 `realm` 与 `keyVersion`：
  `evidence-digest-domain-version:<base64url(realm)>:<keyVersion>`；
  但它只能作为固定 head 的版本历史记录被读取，不能自行构成第二命名空间。
- 当前配置的 `realm/keyVersion/keyFingerprint` 必须与**同一个 fixed head** 完全一致；任一不同即 `DOMAIN_MISMATCH`，不写新 head/version。
- 正式轮换、realm 迁移、历史密钥回退均留给未来独立受控任务；C1 不实现。

### 1.3 自动化复现与回归

- 旧隐式初始化行为由本轮测试的“空库 append 不初始化”“缺两/仅 head/仅 version 零写”“append 只写 evidence+head”覆盖。
- 旧 realm 作用域 head 行为由“head ID 不含 realm/org”“realm 变化不写新 head/version”“预置第二 realm 不能绕过”覆盖。
- 本轮不修改历史提交，也不删除历史测试场景；原 23 项场景的保留/改名映射见 §6.1。

## 2. 运行时只读契约

### 2.1 `applyEvidenceDomain(state, config)` 判定顺序

| 顺序 | 条件 | 错误码 | 写 |
|---:|---|---|---:|
| 1 | state/config 形状非法（realm/keyVersion/fingerprint 非规范） | `DOMAIN_INCOMPLETE`/409 | 0 |
| 2 | fixed head 缺失（双缺或仅 version） | `DOMAIN_INCOMPLETE`/409 | 0 |
| 3 | head schema/ID/kind/字段损坏 | `DOMAIN_INCOMPLETE`/409 | 0 |
| 4 | head 的 realm/keyVersion/keyFingerprint 与当前 config 任一不同 | `DOMAIN_MISMATCH`/409 | 0 |
| 5 | head 匹配但 version 记录缺失 | `DOMAIN_INCOMPLETE`/409 | 0 |
| 6 | version schema/ID/kind/字段损坏 | `DOMAIN_INCOMPLETE`/409 | 0 |
| 7 | head 与 version 的 realm/keyVersion/keyFingerprint/kind 互相矛盾 | `DOMAIN_INCOMPLETE`/409 | 0 |
| 8 | 全部完整且完全匹配 | 返回 `[]` | 0 |

说明：

- 第 4 步发生在读取 version 记录之前：realm 切换、keyVersion 变化、同版本换密钥会被稳定识别为配置变化 `DOMAIN_MISMATCH`，不会误判成“存储损坏”，也不会触发创建/修复。
- head 匹配后 version 缺失属于存储损坏，`DOMAIN_INCOMPLETE`；这与“缺一/缺两”的失败关闭语义一致。
- 仅 version 存在、head 缺失：head 缺失先返回 `DOMAIN_INCOMPLETE`，不会因为是“新 realm”而创建 head。

### 2.2 append 写集

`appendEvidenceWrites` 的顺序：

1. 校验 job/config/now/decision/source/observedAt；
2. 调用 `applyEvidenceDomain(state, cfg)` 只读校验；失败立即抛错；
3. 事务内重读 per-job evidence head，做 CAS/首条/链尾判断；
4. 完整复核 previous evidence（schema、`_id`、org、job、sequence、observedAt、K3 realm/version/fingerprint、HMAC）；
5. 只返回新 evidence + 新 head 两条写。

因此 append 不可能产生 domain 写；未来 reconcile 复用同一 guard 时也不会隐式初始化。

### 2.3 失败零写

所有运行时失败路径在返回任何写之前抛错。测试对每个失败用例对 `store.data` 做内容级 `deepEqual`，并对 `evidence_digest_domains`、`device_operation_evidence`、`device_operation_evidence_heads` 分别断言未变化。

## 3. 独立显式受控初始化 helper

### 3.1 接口

```js
evidenceDomainInitPrecondition({ scope, domains, evidence, evidenceHeads, checkedAt, checkedBy })
evidenceDomainInitRefs(config)
evidenceDomainInitWrites(state, { config, now, precondition })
initializeEvidenceDomain(store, config, { now, precondition, audit })
```

- 这些符号只从 `h4c-evidence.mjs` 导出；公共运行时入口 `index.mjs` **不 re-export**，避免服务层误用。
- `initializeEvidenceDomain` 不被 `appendEvidenceWrites`、`applyEvidenceDomain` 或任何 reconcile helper 调用；由源码级测试断言。
- 只写固定 head/version 两条记录，不写 evidence/evidence head，不写第二 realm，不改 job/grant/device/log。

### 3.2 全局空前置条件

`evidenceDomainInitPrecondition` 的精确字段：

| 字段 | 约束 |
|---|---|
| `scope` | 固定 `"global"`，表示部署全局域，不是组织域 |
| `domains` | 受控迁移观测到的 `evidence_digest_domains` 记录 ID 列表；必须为空 |
| `evidence` | 受控迁移观测到的 `device_operation_evidence` 记录 ID 列表；必须为空 |
| `evidenceHeads` | 受控迁移观测到的 `device_operation_evidence_heads` 记录 ID 列表；必须为空 |
| `checkedAt` | 安全非负整数，记录检查时间 |
| `checkedBy` | 受控操作者/任务标识，`[A-Za-z0-9][A-Za-z0-9._:-]{0,127}` |

规则：

1. **不扫描**：`evidenceDomainInitPrecondition` 不接收 Store，也不调用 `store.list()`/`store.get()`；`initializeEvidenceDomain` 只在事务内读取固定两个 ref。
2. **不猜测**：缺前置条件、普通对象伪造 proof、字段缺失/未知、非空观测列表、非法时间/操作者，全部失败关闭。
3. **记录全局空**：只有三集合观测列表均为空时才返回 frozen proof（模块私有 `WeakSet` 令牌）；proof 记录 `scope=global`、`checkedAt`、`checkedBy`。
4. **业务失败关闭**：无 proof 或 proof 不可验证 → `DOMAIN_INCOMPLETE`/409；proof 观测到记录 → `DOMAIN_INIT_CONFLICT`/409。
5. **已知边界**：Store 无法原子证明全局空；helper 也不扫描。若受控迁移伪造空列表，helper 无法从两个固定 ref 发现未声明记录。这是部署流程/审计责任，不是 helper 的自动修复路径；因此本文不声称“可检测任意伪造的空证明”。

### 3.3 create-only 与拒绝覆盖

- `evidenceDomainInitRefs` 只声明 fixed head ID 与当前配置的 version ID。
- `evidenceDomainInitWrites` 先检查：
  - fixed head 已存在 → `DOMAIN_INIT_CONFLICT`；
  - fixed version 已存在 → `DOMAIN_INIT_CONFLICT`；
  - 事务状态中任一非空 `evidence_digest_domains/*`、`device_operation_evidence/*`、`device_operation_evidence_heads/*` → `DOMAIN_INIT_CONFLICT`。
- Store 的 `createOnlyCollections` 包含 `evidence_digest_domains` 与 `device_operation_evidence`；并发/重复写入 fixed ID 仍由 Store 返回 409。
- helper 不 merge 旧记录、不覆盖字段、不补 `updatedAt`、不删除任何记录。

### 3.4 初始化成功后的 head/version

| 记录 | 精确字段 | 值 |
|---|---|---|
| head | `_id, kind, realm, keyVersion, keyFingerprint, revision, createdAt` | `kind="head"`，`revision=1`，`createdAt=now`，无 orgId |
| version | `_id, kind, realm, keyVersion, keyFingerprint, enabledAt` | `kind="version"`，`enabledAt=now` |

成功只产生 2 条写；evidence/evidence head 集合保持空。之后同配置的运行时只读校验通过，第二次初始化因 fixed head 已存在而 `DOMAIN_INIT_CONFLICT`。

## 4. 初始化与运行时区别

| 维度 | 运行时 `applyEvidenceDomain` | 显式初始化 `initializeEvidenceDomain` |
|---|---|---|
| 调用者 | append / 未来 reconcile | 仅受控部署迁移 |
| 是否读 Store | 只读事务内声明的 fixed head/version 两个 ref | 只读同两个 ref |
| 是否写 Store | 永不写（返回 `[]`） | 写 fixed head+version 两条 create-only |
| 缺 head/version | `DOMAIN_INCOMPLETE` | fixed 记录已存在则 `DOMAIN_INIT_CONFLICT`；不存在则要求空前置条件 |
| 配置不匹配 | `DOMAIN_MISMATCH` | 已存在 fixed record 时 `DOMAIN_INIT_CONFLICT`；不创建第二 realm |
| 全局空证明 | 不需要 | 必须有 `scope=global` 的三集合空列表 proof |
| 扫描集合 | 否 | 否 |
| 自动修复/回填 | 否 | 否 |
| 删除/覆盖 | 否 | 否 |

## 5. 固定全局 head 与 ID 规则

- `EVIDENCE_DOMAIN_HEAD_ID` 由 `evidence-digest-domain` + `v1` + `global` 派生，字面值为 `evidence-digest-domain:v1:global`。
- 不含 realm、不含 orgId；`realm-a`、`realm-b`、任意组织看到的 head ID 完全相同。
- head 的 `realm/keyVersion/keyFingerprint` 是当前部署的绑定字段；`revision` 从 1 起；`createdAt` 为初始化时刻。
- version ID 可含 `base64url(realm)` 与 `keyVersion`，但：
  - 只能与同一个 fixed head 配对；
  - 运行时先比对固定 head，再读取当前配置的 version；
  - 不允许出现第二个 head；
  - realm 变化、版本变化、同版本换密钥都不会写新 head/version。
- 预置第二 realm 的 version 记录不会绕过 fixed head；运行时仍 `DOMAIN_MISMATCH`，初始化若如实记录该记录则 `DOMAIN_INIT_CONFLICT`。
- 正式轮换/realm 迁移/历史密钥回退留给未来任务；C1 不实现，也不做自动迁移。

## 6. 测试覆盖与保留

### 6.1 原 23 项场景保留

- 当前测试 **35 项**；原始 `3fce9b0` 的 23 项场景全部保留或由更强契约替换，没有删除场景。
- 其中 14 项名称未变；9 项因行为契约变化而改名/拆分/加强：

| 原始 23 项中的名称 | 当前对应 |
|---|---|
| `evidence/head/domain IDs are deterministic and scoped` | `evidence/head/domain IDs are deterministic and the head is realm/org independent` |
| `domain validator is exact for head and version records` | `domain validator is exact for the stable head and frozen version records` |
| `domain guard creates head and version once and never mutates input` | `explicit controlled initialization creates the single global pair; same config passes` + 3 项初始化失败/拒绝测试 |
| `domain guard rejects one-sided and corrupt domains without backfill` | `runtime domain guard rejects one-sided and corrupt domains without backfill` |
| `domain guard fails closed on version changes and same-version rekey` | `runtime domain guard fails closed on realm switch, version change and same-version rekey` |
| `append fails closed on K3 rekey, version change and one-sided domain` | `append fails closed on K3 rekey, realm/version change and one-sided domain` |
| `first evidence creates the K3 domain, immutable evidence and head` | `first evidence appends only evidence+head after explicit initialization` + 初始化正例 |
| `damaged previous evidence is chain-broken across schema, identity, time, K3 and HMAC` | `damaged previous evidence is chain-broken across schema, identity, org/job, time, K3 and HMAC` |
| `face-service index exports the C1 evidence surface` | `face-service index exports only the non-init C1 evidence surface` + `production module separates the explicit controlled init helper from the read-only runtime` |

### 6.2 本轮新增/强化的初始化测试

1. `explicit controlled initialization creates the single global pair; same config passes`
   - 空库 + 合法 proof 成功；只 2 条 domain 写；head/version 精确字段；无 orgId；同配置运行时通过；重复初始化冲突；随后 append 正常。
   - 以 `store.list` 抛错 stub 证明初始化不扫描；`listCalls === 0`。
2. `initialization fails closed without a recorded global-empty precondition and never scans`
   - 缺 proof/null/plain object/非法 now 均 `DOMAIN_INCOMPLETE`；
   - 非空 domains/evidence/evidenceHeads 均 `DOMAIN_INIT_CONFLICT`；
   - 非法 scope/checkedAt/checkedBy/未知字段/symbol 字段均失败关闭；
   - 全程 `store.list` 未被调用，store 内容不变。
3. `init write builder rejects any visible domain/evidence/evidence-head record`
   - fixed head、fixed version、其他 domain、evidence、evidence head 任一可见记录均 `DOMAIN_INIT_CONFLICT`；
   - 输入 state 不被修改；缺 proof 为 `DOMAIN_INCOMPLETE`。
4. `initialization is create-only against existing or corrupt fixed domain records`
   - 已存在 head/version/损坏 head 均冲突；成功初始化后再次初始化冲突；内容级零写。
5. `constant-time digest comparison validates canonical hex before timingSafeEqual`
   - 源码级断言先做 64 位小写 hex 校验，再调用 `timingSafeEqual`；两侧 Buffer 等长 32 字节。

### 6.3 指定覆盖映射

| 要求 | 测试 |
|---|---|
| 全新初始化成功 | `explicit controlled initialization creates the single global pair; same config passes` |
| 重复初始化拒绝 | 同上；`initialization is create-only against existing or corrupt fixed domain records` |
| 损坏 domain 拒绝 | `initialization is create-only against existing or corrupt fixed domain records`；`runtime domain guard rejects one-sided and corrupt domains without backfill` |
| 缺两（空） | `append on an empty store never initializes the domain implicitly`；`runtime rejects both-missing...` 的 `empty` |
| 缺两（有 evidence） | `both-missing after existing evidence or evidence head fails closed with every collection unchanged` |
| 缺两（有 evidence head） | 同上 |
| 仅 head | `runtime rejects both-missing, head-only, version-only and evidence-only states with zero writes` |
| 仅 version | 同上 |
| 所有失败路径 domain/evidence/head deepEqual + 零写 | 上述测试均以 `structuredClone(store.data)` 为基线，`assert.deepEqual` 全库，再分别断言三集合 |
| append 不隐式初始化 | `append on an empty store never initializes the domain implicitly`；`first evidence appends only evidence+head after explicit initialization` |
| realm-a 初始化 + 同配置通过 | `explicit controlled initialization creates the single global pair; same config passes` |
| realm-b / 换版本 / 同版本换密钥拒绝 | `runtime domain guard fails closed on realm switch, version change and same-version rekey`；`realm switch/version change/rekey are DOMAIN_MISMATCH and never add a head/version` |
| 预置第二 realm 不能绕过 | `realm switch/version change/rekey are DOMAIN_MISMATCH and never add a head/version` |
| 多组织命中同一 head | `one stable global head is shared by multiple organizations and cannot fork` |
| realm 变化不写新 head/version | 同上 realm 测试；每次失败后内容级 `deepEqual` |
| previous evidence 完整复核 | `damaged previous evidence is chain-broken across schema, identity, org/job, time, K3 and HMAC` |
| timingSafeEqual 前格式/等长 | `constant-time digest comparison validates canonical hex before timingSafeEqual` + 上述 damaged 测试的长度/大小写用例 |
| Store 白名单/seed/init | `LocalStore registers the three collections and upgrades old local data` |
| 精确字段/未知字段 | evidence/head/domain validator 测试；初始化 head/version 字段断言 |
| Store create-only/exact | `LocalStore keeps evidence/domain create-only and exact, head updates exact`；`CloudStore keeps exact fields and create-only semantics` |
| K1/K2/K3 独立 | `K3 config is independent, canonical and fingerprint-bound`（K1、K2 环境均不能替代 K3） |

## 7. 命令、exit code 与计数

环境：Windows 10.0.19042、Node v24.19.0、PowerShell 7.x；当前分支 worktree `SMART-PM`。

### 7.1 C1 定向

| 工作目录 | 命令 | Exit | 计数 |
|---|---|---:|---:|
| `admin-web` | `node --test --test-isolation=none tests/face-h4c-evidence.test.mjs` | 0 | tests 35 / pass 35 / fail 0 |
| `admin-web` | 同上 + `--import file:///.../.tmp/h4c-c1-rework/guards.mjs` | 0 | tests 35 / pass 35 / fail 0；`network=0 provider=0 httpServer=0` |

### 7.2 Admin 全量

| 工作目录 | 命令 | Exit | 计数 |
|---|---|---:|---:|
| `admin-web` | `node --test --test-isolation=none "tests/*.test.mjs"` | 0 | 41 files；tests 585 / pass 585 / fail 0 |

### 7.3 根测试

| 工作目录 | 命令 | Exit | 计数 |
|---|---|---:|---:|
| 仓库根 | `node --test --test-isolation=none "tests/*.test.cjs"` | 0 | 7 files；tests 51 / pass 51 / fail 0 |

### 7.4 静态与敏感检查

| 命令 | Exit | 结果 |
|---|---:|---|
| `node --check admin-web/lib/face-service/h4c-evidence.mjs` | 0 | 语法通过 |
| `node --check admin-web/lib/face-service/index.mjs` | 0 | 语法通过 |
| `node --check admin-web/tests/face-h4c-evidence.test.mjs` | 0 | 语法通过 |
| `git diff --check` | 0 | 无空白错误 |
| `git diff --quiet 3fce9b0 -- admin-web/server.mjs` | 0 | `server.mjs` 未变 |
| `git diff --quiet aa0db29 -- admin-web/server.mjs` | 0 | 本轮 `server.mjs` 未变 |
| 敏感扫描（4 个变更文件） | 0 | `total_findings: 0` |

敏感扫描类别：私钥块、AWS access key、GitHub token、Google API key、Slack token、Bearer token、通用 secret 字面量、32 字节 Base64 字面量、IPv4、MAC、中国大陆手机号、18 位身份证号。只输出计数，不输出匹配文本。该扫描是模式级检查，不是“绝对无秘密”的证明。

## 8. Provider / 网络 / 设备 / HTTP 状态

| 项 | C1 定向 | 说明 |
|---|---:|---|
| 真实 Provider 调用 | 0 | 仓库只有 Mock；C1 测试未实例化/调用 Mock Provider |
| Mock Provider 方法调用 | 0 | guard 包裹 `health/enrollFace/updateFace/revokeFace/queryOperation/verifyEvent`，计数 0 |
| 测试业务网络尝试 | 0 | guard 包裹 `fetch`、`http/https.request/get`、`net.connect/createConnection`、`tls.connect`、`dns.lookup/resolve`，计数 0 |
| HTTP server/client 注册 | 0 | guard 包裹 `http/https/net.createServer`，计数 0；未新增路由；`server.mjs` 零修改 |
| 真实设备连接/写入 | 0 | 变更代码无 serial/device SDK/蓝牙/USB/网络设备通道；测试只写 LocalStore/fake CloudStore |
| Cloud/live 调用 | 0 | `CloudStore` 测试使用 fake `database()` harness，无真实 CloudBase |
| K3 provisioning/轮换 | 0 | 未配置或调用真实 K3；未生成/保存密钥 |

Admin 全量包含既有 loopback 测试（`listen(0, <loopback>)` + `fetch`），不是本次新增路由，也不是外部网络；本次未对全量注入 guard，因此不把既有 loopback 计为 0。真实 Provider/设备/Cloud/live 始终为 0。

Git 远端操作单列：本轮 `git ls-remote` 在当前离线环境因缺少 HTTPS 凭证失败（`schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`），未执行 push；这不属于上述运行时网络证据。详见 §10 交付回报。

## 9. 未实现项（明确不在本包）

- **C2**：HTTP/DTO/权限/组织/成员/actorType；job/grant/cleanupSnapshot 绑定；R1/R2 两段式；log/op key/op domain/audit；60 秒/8 次/24 小时；错误映射；finalize-retry；并发/重放/ack loss；reconcile decision。
- **C3**：真实 CloudBase 事务/索引/集合部署；真实 K3 密钥 provisioning/轮换；生产告警/监控；真实 Provider/设备；`server.mjs` 路由注册。
- **初始化/迁移工具**：本轮只有 helper 与离线测试；未提供维护窗口编排、全局锁、CloudStore 权威空集合检查 CLI、回读/审计/回滚工具、密钥 provisioning。
- **正式轮换/realm 迁移**：未实现，留给未来独立任务。
- 未修改 `store.mjs`；未修改 `server.mjs`；未新增路由；未合并 `main`；未 force-push/rebase/squash/amend。

## 10. 交付与复审交接

- 分支：`feat/hk-face-h4c-reconciliation`
- 本提交父 SHA：`aa0db293c7744580e4e0aaa07159bc42b6ac73a6`
- 本提交 SHA：**由交付回报给出**（本文件随该提交一起提交，无法在提交前写入自身 SHA）
- 变更文件：3 个代码/测试文件 + 本证据文档；未包含任何未跟踪的 HK-AI-06A/07A 文档或 `.tmp` 临时文件。
- 工作区：提交后仅保留任务开始前已存在的未跟踪文件（HK-AI-06A/07A 文档、电动车充电桩方案等），不纳入本提交。
- 远端核验：`git ls-remote --heads origin feat/hk-face-h4c-reconciliation` 因 HTTPS 凭证不可用失败；未 push。若复审环境可达，请以远端分支 SHA 与本文父 SHA/本提交 SHA 对比。

请 Codex 重点复核：

1. `applyEvidenceDomain`/`appendEvidenceWrites` 是否已完全只读，是否还存在任何隐式初始化、回填、catch 静默修复或 domain 写。
2. `initializeEvidenceDomain` 是否独立、create-only、缺 proof/非空 proof/已存在记录是否全部失败关闭且零写；是否确实不扫描 Store。
3. 固定 head `evidence-digest-domain:v1:global` 是否彻底阻止第二 realm；预置第二 realm version、换版本、同版本换密钥、多组织是否覆盖充分。
4. 原 23 项测试场景是否全部保留；新增 5 项初始化/静态测试是否足以证明本轮契约。
5. §3.2 对“Store 无法原子证明全局空”的边界说明是否可作为未来受控迁移任务的交接基线。

本文不声称 C1 已生产就绪；复审前不开始 C2/C3。完成后停手，交 Codex 独立复审。
