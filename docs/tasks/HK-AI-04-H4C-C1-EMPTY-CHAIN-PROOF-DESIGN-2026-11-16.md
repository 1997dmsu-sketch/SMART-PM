# HK-AI-04 H4-c C1 空链证明设计返工卡

> 状态：**设计提案，待 Codex 批准。** 本轮只设计，不实现 C1、不修改 5dff386 代码或测试、不进入 C2/C3、不注册 HTTP、不调用 Provider/设备/生产云。
>
> 输入：`feat/hk-face-h4c-reconciliation @ 5dff386fe5c9648b04d1623d3e1898c59332639e`
>
> 已批准设计：`docs/hk-face-h4c-reconciliation-design @ b15aceb`；批准/任务卡：`ed7b66f`；当前 C1：`5dff386`；C2 前置检查：`42f8970`。
>
> 本卡只交 Codex 复审；批准后再另发 C1 实现卡。

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 当前缺口 | C1 `appendEvidenceWrites` 信任调用方 `hasExistingEvidence`，事务内只检查新 sequence 的 evidence ID；head/seq1 丢失而合法 seq2..9 残留时可能建立新首链 |
| 推荐方案 | **job 链锚 + 全局链审计证明 + 1..9 确定性 evidence IDs 全量点查 + 完整 canonical 链校验** |
| 核心不变量 | 先验证 global K3 锚完整；再验证 deployment 审计证明；再验证 per-job anchor/head/1..9；任一不满足即失败关闭、零写 |
| 调用方布尔值 | **删除 `hasExistingEvidence`**；不再接受任何调用方“空链”断言 |
| legacy | 规范 legacy 由受控迁移补 anchor；旧 realm 作用域 domain、非规范 ID、无法补齐的记录一律阻断，不自动修复 |
| refs 预算 | C1 14；C2 R1 23；C2 R2 H4-b `8+N≤90`；均低于 90 上限 |
| 裁定 | 新增两个集合、审计证明 HMAC/K3 绑定、legacy 迁移策略、完整链校验、错误码/refs 均需 Codex 逐项批准 |

## 1. 输入、基线与问题

### 1.1 输入事实

- 独立工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\closeout-d`，detached HEAD = `5dff386fe5c9648b04d1623d3e1898c59332639e`。
- 本地分支 `feat/hk-face-h4c-reconciliation` 指向 `90e4189`；`origin/feat/hk-face-h4c-reconciliation` 跟踪 ref 为 `5dff386`。本卡不修改该分支。
- C1 现状：evidence/head/K3 domain validator、只读 domain guard、HMAC、append helper；无 reconcile 服务入口，无 HTTP 注册。
- C2 仅 `42f8970` 前置文档，未开始；C3 未开始。

### 1.2 当前实现缺口（只读核对）

| 缺口 | 位置 | 事实 |
|---|---|---|
| 调用方布尔值 | `admin-web/lib/face-service/h4c-evidence.mjs:352-381` | `appendEvidenceWrites` 接收 `hasExistingEvidence`；`expectedHead == null` 时只看 `hasExistingEvidence !== false` |
| refs 只含新 sequence | 同文件 `:322-343` | `evidenceAppendRefs` 只声明新 sequence 的 evidence ID + head + K3 pair；没有 1..9 全量 ID、没有 anchor/audit |
| 只检查新 ID | 同文件 `:424-427` | 事务内只读 `evidenceId(org,job,newSequence)`；seq2..9 孤儿不在 state，无法发现 |
| 首链判断依赖预读 | 设计 `b15aceb` §5.4 `:222-226` | “预读 null + 事务内再次为空”只覆盖调用方正确预读的路径，未原子覆盖全部 9 个 ID |
| 已知缺口 | `42f8970:docs/tasks/HK-AI-04-H4C-C2-PREFLIGHT-2026-11-14.md:743`（Q04）、`:552`（T11）、`:691`（RC56） | C2 前置已明确：head 被删除但 seq2..9 仍存在时，C1 可能留下孤儿链 |
| Store 限制 | `admin-web/lib/store.mjs:94`、`:428` | 单事务 refs 上限 90；Store 只按声明 refs 点读，不能事务内全集合扫描 |

### 1.3 必须关闭的失败场景

设 `H = head(org,job)`，`A = anchor(org,job)`，`E_i = evidence(org,job,i)`：

```text
H = null
A = null
E_2 ... E_9 中存在合法 canonical evidence（例如 E_2）
调用方传入 hasExistingEvidence = false
```

当前 C1 会写 `E_1 + H` 并建立新链。目标设计必须返回 `EVIDENCE_CHAIN_BROKEN/409`，且 **anchor/evidence/head 全部零写**，即使调用方布尔值为 false。该场景是“job head/seq1 丢失、合法 seq2 残留”，不是重新开始一条链。

## 2. 术语与信任模型

### 2.1 三类记录

| 类别 | 定义 |
|---|---|
| **canonical** | C1 v1 精确 schema；evidence `_id` 为 `(orgId,jobId,sequence)` 确定性 ID；sequence 1..9；previous 链完整；K3 realm/version/fingerprint 与当前 config/domain 一致；HMAC 可重算 |
| **abnormal** | head 缺失/多余/seq0、seq1 缺失但 seq2 存在、seqN 孤儿、anchor/head 不配对、anchor 缺字段、链内某条缺失、ID/字段/HMAC/K3 不一致 |
| **legacy** | 在 anchor/audit 方案启用前写入的 evidence/head（含 C1 历史提交 3fce9b0/6dbc9e0/aa0db29/90e4189 的数据、旧 LocalStore 数据文件、非确定性 ID/旧 schema/旧 domain 形态） |

### 2.2 信任模型

1. **不信任调用方布尔值/预读。** 事务内只信任已声明 refs 的 Store state、K3 domain guard 和 HMAC 验证。
2. **global K3 锚优先。** `applyEvidenceDomain` 必须是第一道校验；任何 `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH` 都先于空链证明返回，不允许用 legacy/audit/anchor 绕过 K3。
3. **anchor/audit 不写 K3 domain。** 新记录不能成为 K3 初始化或修复入口；domain 仍只读。
4. **审计证明是受控迁移事实，不是运行时能力。** 生产 C1/C2 代码只读/校验 `evidence_chain_audits`；只有独立迁移工具能创建它，静态扫描和复审保证生产树无写入口。
5. **Store 完整性假设。** 本设计防止应用层部分写、head/seq1 丢失、并发分叉和 legacy 漏检；不声称能抵抗恶意删除全部 evidence/head/anchor/audit 的存储破坏。该残余风险写入“已知边界”。

## 3. 方案总览

### 3.1 三层证明

| 层 | 记录/机制 | 证明什么 | 谁写 |
|---|---|---|---|
| L0 | global K3 domain head + version（现有） | K3 配置/换钥锚完整 | 既有受控部署（C1 只读） |
| L1 | `evidence_chain_audits`（新增，全局） | 部署时已对全部 evidence/head 做权威盘点；legacy 已处理或证明为空；证明绑定 K3 domain | 仅受控迁移 |
| L2 | `device_operation_evidence_chain_anchors`（新增，每 job） | 该 job 曾经存在一条 evidence 链；head/seq1 丢失也可发现 | 首条 append 与 evidence+head 同事务 |
| L3 | 1..9 确定性 evidence IDs 全量点查 + 完整 canonical 链校验 | 当前 job 没有孤儿/断链/分叉；首链确实为空 | 运行时事务 |

推荐证明式：

```text
K3Exact = applyEvidenceDomain(state, cfg) 返回 []（只读，且 head/version 完整匹配）

EmptyProof(job) =
  K3Exact
  ∧ AuditProofValid
  ∧ head(job) = null
  ∧ anchor(job) = null
  ∧ ∀ i ∈ [1,9]: evidence(job,i) = null

ChainProof(job) =
  K3Exact
  ∧ AuditProofValid
  ∧ anchor(job) valid
  ∧ head(job) valid（lastSequence ∈ [1,9]）
  ∧ ∀ i ∈ [1,lastSequence]: evidence(job,i) 存在且 canonical、链式 previous 正确
  ∧ ∀ i ∈ [lastSequence+1,9]: evidence(job,i) = null
```

只有 `EmptyProof` 才允许首条；只有 `ChainProof` 才允许非首条。任一条件失败即抛错，写集为空。

### 3.2 为什么不是“只检查 9 个 ID”

- 只检查 9 个 ID 可以关闭 canonical/abnormal 的 seq2..9 孤儿，但无法发现 **head+seq1+全部 evidence 都被删除** 的曾经存在链；job 链锚解决这一点。
- 只检查 9 个 ID + anchor 仍无法发现 **非确定性 ID/旧 schema 的 legacy 记录**；全局审计证明解决这一点。
- 只信任全局审计证明而不检查 anchor/9 IDs，会让运行时漏掉审计之后的新损坏；三层缺一不可。

### 3.3 备选方案比较

| 方案 | canonical | abnormal seq2..9 | head/seq1 全丢 | legacy 非规范 | 新集合 | 结论 |
|---|---|---|---|---|---|---|
| A 仅 9 IDs | 通过 | 通过 | 不可发现 | 不可发现 | 无 | 不足 |
| B 9 IDs + job anchor | 通过 | 通过 | 通过 | 不可发现 | 1 | 接近 |
| C 9 IDs + anchor + 全局审计 | 通过 | 通过 | 通过 | 由迁移证明/阻断 | 2 | **推荐** |
| D 每次全集合扫描 | 通过 | 通过 | 通过 | 可发现 | 0 | Store 事务不支持；竞态/成本不可接受 |

## 4. 数据契约（新增两个集合）

### 4.1 job 链锚 `device_operation_evidence_chain_anchors`

| 项目 | 冻结建议 |
|---|---|
| 集合 | `device_operation_evidence_chain_anchors`（组织域，带 `orgId`；每 job 一条） |
| `_id` | `h4c-evidence-anchor-v1:<sha256(stable([orgId,jobId])).slice(0,32)>` |
| 字段 | `_id, orgId, jobId, schemaVersion, firstEvidenceId, createdAt`（6 字段，精确） |
| `schemaVersion` | 固定 `1` |
| `firstEvidenceId` | 固定 `evidenceId(orgId,jobId,1)`；必须在 anchor 创建时写入 |
| `createdAt` | 服务端安全整数；与首条 evidence 的 `createdAt` 同值 |
| 写入 | **仅首条 append 同事务 create-only 写入**；不更新、不删除、不修复 |
| 校验 | 精确字段；`_id` 公式；`orgId/jobId` opaque；`firstEvidenceId` 公式；`createdAt` safe int |
| 语义 | anchor 存在 = 该 job 曾经有一条合法链；head/seq1 丢失时 anchor 仍应存在，运行时不得建立新链 |

### 4.2 全局链审计证明 `evidence_chain_audits`

| 项目 | 冻结建议 |
|---|---|
| 集合 | `evidence_chain_audits`（全局部署域，无 `orgId`） |
| `_id` | `evidence-chain-audit:v1:<keyFingerprint>:<domainHeadRevision>` |
| 字段 | `_id, kind, scope, schemaVersion, realm, keyVersion, keyFingerprint, domainHeadId, domainHeadRevision, status, canonicalEvidenceCount, canonicalHeadCount, anchorCount, legacyCount, inventoryDigest, checkedAt, checkedBy, auditDigest`（18 字段，精确） |
| `kind` / `scope` | 固定 `"audit"` / `"global"` |
| `schemaVersion` | 固定 `1` |
| K3 绑定 | `realm/keyVersion/keyFingerprint/domainHeadId/domainHeadRevision` 必须与当前 K3 config 和 domain head 完全一致 |
| `status` | `"empty"`（审计时三集合全空）或 `"backfilled"`（全部有链 job 已补 anchor 且校验通过） |
| counts | `canonicalEvidenceCount/canonicalHeadCount/anchorCount/legacyCount` 为非负安全整数；`legacyCount` 必须为 `0` |
| `inventoryDigest` | 64 位小写 hex；对审计时排序后的 `(collection/id)` 清单做 `SHA-256(stableStringify(...))`，用于审计报告复算；运行时只校验格式/绑定，不重扫 |
| `auditDigest` | 64 位小写 hex；K3 HMAC-SHA256，绑定 domain `KEYED_DIGEST/h4-evidence-chain-audit`、algorithmVersion `1` 及除 `auditDigest` 外全部字段 |
| `checkedAt/checkedBy` | safe int / opaque；仅审计迁移写入 |
| 写入 | **仅受控迁移、create-only**；生产 C1/C2 不写、不更新、不删除 |
| 语义 | 该部署在 `checkedAt` 已做权威盘点：所有既有链已 anchor 化且 canonical；没有未处理的 legacy；运行时可以此作为 legacy 空性证明 |

**注意**：counts 是审计时点的历史快照，不是运行时实时计数；运行时只校验 proof 的 HMAC/K3 绑定，不把 counts 与当前集合比较。审计后新增的链由 anchor + 9 IDs 继续证明。

### 4.3 Store 登记与写约束（实现时）

| 项目 | 要求 |
|---|---|
| `collections` | 追加 `device_operation_evidence_chain_anchors`、`evidence_chain_audits`（现有 `admin-web/lib/store.mjs:43-49` 风格） |
| `seed()` / `init()` | 两集合初始化为 `[]`；旧 LocalStore 数据文件用现有 `||= []` 模式补齐（`store.mjs:225-226`、`:262-263`） |
| exact | 两集合加入 `exactWriteCollections`；禁止 Store 注入 `updatedAt`（对齐现有 `store.mjs:104-114`） |
| create-only | 两集合加入 `createOnlyCollections`；anchor/audit 不允许 update/merge（对齐 `store.mjs:111-115`） |
| 写入者 | anchor 仅 `appendEvidenceWrites` 首链事务；audit 仅迁移工具；运行时函数只读 |
| 静态证明 | 生产树扫描 `evidence_chain_audits` 的 `write(`/`transact(` 0 命中（迁移工具不在生产树）；C1 模块只读 audit |
| 90 refs | 两集合均按确定 ID 点读/点写，不引入 list/scan；C1 14、C2 23（见 §7） |

### 4.4 校验与错误码

| 情形 | 错误码 | HTTP | 写 |
|---|---|---:|---:|
| K3 config 缺失/非法 | `NOT_CONFIGURED` | 503 | 0 |
| K3 domain 双缺/单缺/损坏/内部矛盾 | `DOMAIN_INCOMPLETE` | 409 | 0 |
| K3 realm/version/fingerprint 变化 | `DOMAIN_MISMATCH` | 409 | 0 |
| 审计证明缺失、ID/HMAC/绑定/status 非法 | `EVIDENCE_CHAIN_PROOF_REQUIRED`（**新增建议码**） | 409 | 0 |
| anchor/head/evidence 缺失、孤儿、断链、anchor 不配对 | `EVIDENCE_CHAIN_BROKEN` | 409 | 0 |
| head CAS 失败 | `EVIDENCE_HEAD_CONFLICT` | 409 | 0 |
| 新 evidence ID 预占/写冲突 | `CONFLICT` | 409 | 0 |
| sequence/字段/来源非法 | `EVIDENCE_INVALID` | 409 | 0 |
| 时间越界 | `EVIDENCE_STALE` | 409 | 0 |

`EVIDENCE_CHAIN_PROOF_REQUIRED` 与 `NOT_CONFIGURED` 的区别：前者是“部署已运行但缺少受控空链审计”，后者是“K3 配置不可用”。两者都 fail-closed，不自动补写。

## 5. 运行时算法（设计）

### 5.1 首条链：`EmptyProof`

输入：`job`、`expectedHead = null`、`config`、`now`、`decision/source/observedAt/actorId`。**没有 `hasExistingEvidence` 参数。**

1. 校验 config/job/now/decision/source/observedAt/actorId（现有 `:356-368` 规则）。
2. `applyEvidenceDomain(state, cfg)` 只读精确匹配；失败即 `DOMAIN_*`，零写。
3. 读取并验证 `evidence_chain_audits` 的当前 proof（ID 由 config + domain head revision 计算）：
   - exact 18 字段、`kind/scope/schemaVersion`、K3 绑定、`domainHeadRevision`、`status`、`legacyCount=0`、`auditDigest` HMAC；
   - 缺失/损坏/过期/换钥 → `EVIDENCE_CHAIN_PROOF_REQUIRED`，零写。
4. 读 head；必须为 null；否则走非首条路径。
5. 读 anchor；必须为 null；存在 → `EVIDENCE_CHAIN_BROKEN`，零写。
6. 读 `evidenceId(org,job,1..9)`；**9 个必须全为 null**；任一存在（包括合法 seq2..9）→ `EVIDENCE_CHAIN_BROKEN`，零写。
7. 构造并校验：
   - anchor：`_id` 公式、`orgId/jobId`、`schemaVersion=1`、`firstEvidenceId=E_1`、`createdAt=now`；
   - evidence seq1：现有 `validateEvidenceRecord` + HMAC；
   - head：`revision=1, lastSequence=1, lastEvidenceId=E_1, lastObservedAt=observedAt, createdAt/updatedAt=now`；
8. 返回 3 条写：`anchor + evidence + head`；无 domain 写。

### 5.2 非首条：`ChainProof`

1. 步骤 1–3 同上（K3 + audit proof 优先）。
2. 读 head；必须存在，且 `expectedHead` 的 `revision/lastEvidenceId/lastSequence` 完全匹配；否则 `EVIDENCE_HEAD_CONFLICT`/`EVIDENCE_CHAIN_BROKEN`。
3. 读 anchor；必须存在，且 `orgId/jobId` 匹配、`firstEvidenceId=E_1`、`createdAt=E_1.createdAt`；否则 `EVIDENCE_CHAIN_BROKEN`。
4. 校验完整 canonical 链（建议）：
   - 对 `i=1..head.lastSequence`：`E_i` 存在；`validateEvidenceRecord`；`_id`/`orgId`/`jobId`/`sequence`/`previousEvidenceId` 正确；K3 realm/version/fingerprint 与当前 config/domain 一致；HMAC 通过；
   - `E_head.lastSequence._id === head.lastEvidenceId`；`E_head.lastSequence.observedAt === head.lastObservedAt`；
   - 对 `i=head.lastSequence+1..9`：必须为 null（新 sequence 必须为空；若存在 → `EVIDENCE_CHAIN_BROKEN`/`CONFLICT`）。
5. `sequence = head.lastSequence+1`；`sequence > 9` → `EVIDENCE_INVALID`；构造 evidence（previous=head.lastEvidenceId）+ next head（revision+1、lastSequence、lastEvidenceId、lastObservedAt、updatedAt=now）。
6. 返回 2 条写：`evidence + head`；anchor 不写（只读校验）；无 domain 写。

### 5.3 删除 `hasExistingEvidence`

- `appendEvidenceWrites` 不再接收任何“是否有既有 evidence”的布尔值或调用方证明对象。
- 首链判断只来自 `EmptyProof` 的 5 个事务内事实：K3、audit proof、head null、anchor null、9 个 ID null。
- `evidenceAppendRefs` 改为返回 §7 的完整 refs；不再用 `head?.lastSequence ?? 0` 选择“新 ID”作为唯一空性依据。
- 生产树静态扫描禁止 `hasExistingEvidence`、`emptyProof`、`callerProof` 等 token 出现在 C1/C2 生产代码；测试只使用合成 audit proof fixture。
- 不允许以“调用方已扫描”或“调用方保证为空”替代事务内证明。

### 5.4 global K3 锚的优先级

运行时顺序固定为：

```text
config 合法性
  → K3 applyEvidenceDomain（只读）
  → chain audit proof
  → anchor/head/9 IDs/chain
  → 构造写
```

任何前置失败都不得进入后续层；不得因为“legacy 没有 domain”而跳过 K3，不得因为“audit proof 有 counts”而跳过 K3，不得写 domain 来修复。

## 6. canonical / 异常 / legacy 证明矩阵

| 类别 | 具体形态 | 运行时判定依据 | 结果 | 写 |
|---|---|---|---|---:|
| canonical empty | K3 完整；audit proof 有效；head/anchor/E1..E9 全空 | `EmptyProof` | 允许首条 | X（anchor+evidence+head） |
| canonical chain | anchor/head 有效；E1..EN 完整 canonical；E>N 空 | `ChainProof` | 允许追加 | X（evidence+head） |
| abnormal：head/seq1 丢失、E2 残留 | head null、anchor null、E2 canonical、调用方无布尔值 | 9 IDs 全量点查发现 E2 | `EVIDENCE_CHAIN_BROKEN/409` | Z |
| abnormal：E2..E9 任意残留 | head null、anchor null、任意 E_i (i≥2) 存在 | 9 IDs 全量点查 | `EVIDENCE_CHAIN_BROKEN` | Z |
| abnormal：anchor 存在但 head/seq1 丢失 | anchor != null、head null | anchor 存在即不得重建 | `EVIDENCE_CHAIN_BROKEN` | Z |
| abnormal：head 存在但 anchor 缺失 | head/E1..EN 存在、anchor null | anchor 缺失视为 legacy/损坏，不得追加 | `EVIDENCE_CHAIN_BROKEN` | Z |
| abnormal：anchor/head 不配对 | anchor.firstEvidenceId 或 org/job 不匹配 | anchor + head 双校验 | `EVIDENCE_CHAIN_BROKEN` | Z |
| abnormal：链内祖先缺失 | head.lastSequence=N，E1..E_{k} 缺一条 | 完整 1..N 校验 | `EVIDENCE_CHAIN_BROKEN` | Z |
| abnormal：head 后孤儿 | head.lastSequence=N，E_{N+1} 存在 | 9 IDs 中 >N 非空 | `EVIDENCE_CHAIN_BROKEN`/`CONFLICT` | Z |
| abnormal：head seq0 | head.lastSequence=0（无 anchor/证据） | 新不变量要求首链 head 从 seq1 开始 | `EVIDENCE_CHAIN_BROKEN` | Z |
| legacy L1：3fce9b0 旧 realm 作用域 domain | `evidence-digest-domain:<realm>`、fixed global head 缺失 | `applyEvidenceDomain` 先失败 | `DOMAIN_INCOMPLETE/409` | Z |
| legacy L2：固定 global domain 但无 anchor | head/E1..EN canonical、anchor null | anchor 缺失；待迁移补 anchor | `EVIDENCE_CHAIN_BROKEN` | Z |
| legacy L3：非确定性 ID/旧 schema | 9 个确定性 ID 可能全空、但 collection 内有其他 ID | 9 IDs 看不到；由 audit proof 的“全量盘点”排除 | 无 proof → `EVIDENCE_CHAIN_PROOF_REQUIRED`；有 proof 则说明迁移已处理 | Z |
| legacy L4：LocalStore 旧文件缺数组 | 集合缺失/空 | 初始化后 audit proof 必须存在 | 无 proof → `EVIDENCE_CHAIN_PROOF_REQUIRED` | Z |
| legacy L5：审计迁移发现不可补齐记录 | 非 canonical、head 缺、anchor 冲突 | 迁移 abort，不写 proof | 运行时永久 `EVIDENCE_CHAIN_PROOF_REQUIRED` | Z |
| K3 失效 | domain 单边/损坏/换钥/realm 变化 | K3 优先 | `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH` | Z |
| audit 失效 | proof 缺失/HMAC 错/绑定错/status 非法/legacyCount≠0 | audit 第二层 | `EVIDENCE_CHAIN_PROOF_REQUIRED` | Z |

**legacy 权威性说明**：9 个确定性 ID 只能证明 canonical 命名空间；非确定性 ID/旧 schema 无法用点读发现。因此 `evidence_chain_audits` 必须是“部署级全量盘点”的受控事实；运行时验证其 HMAC/K3 绑定，而不是重新扫描。若审计迁移漏扫，属于迁移错误，不属运行时可自愈范围。

## 7. 事务 refs / writes 预算

### 7.1 C1 helper

| 事务 | refs（去重后） | 数量 | writes | 说明 |
|---|---|---:|---|---|
| 首条 append | K3 head、K3 version、audit proof、anchor、head、evidence 1..9 | **14** | anchor + evidence + head = **3** | domain 0；previous 无；新 sequence 在 1..9 内 |
| 非首条 append | 同上（9 IDs 含 previous/新 sequence） | **14** | evidence + head = **2** | anchor 只读；domain 0 |

### 7.2 C2 R1（三种 decision 共用）

| ref | 数量 |
|---|---:|
| `organizations/org` | 1 |
| `org_memberships/actor` | 1 |
| `device_operation_jobs/job` | 1 |
| `device_access_grants/grant` | 1 |
| `device_operation_evidence_heads/head` | 1 |
| `device_operation_evidence_chain_anchors/anchor` | 1 |
| `evidence_chain_audits/global` | 1 |
| `device_operation_evidence/1..9` | 9 |
| `evidence_digest_domains/head+version` | 2 |
| `operation_keys/op` | 1 |
| `operation_key_domains/head+version` | 2 |
| `device_operation_logs/log` | 1 |
| `admin_audit/audit` | 1 |
| **合计** | **23** |

C2 R1 writes：job pre-finalize、evidence、head、首链 anchor（仅首链）、log、op key、op domain 0–2、audit；**0** grant/slot/claim/device；**0** domain。C2 R2 继续使用 H4-b `8+N`，N≤82 → ≤90，和 R1 分离事务。

### 7.3 迁移事务

| 事务 | refs | writes |
|---|---:|---|
| 单 job anchor 补齐 | K3 head/version + head + evidence 1..9 + anchor = **13** | anchor = 1 |
| 写 audit proof | K3 head/version + audit = **3** | audit = 1 |

### 7.4 上限核对

- Store 上限 90（`store.mjs:94`、`:428`）。
- C1 14；C2 R1 23；迁移 13/3；C2 R2 ≤90（H4-b 独立事务）。
- C2 R1 23 距 90 余 67，足够后续 log/audit/版本扩展；不得再新增未列出的 ref。
- 所有 refs 去重；9 个 evidence ID 已包含 previous/新 sequence，不重复声明。

## 8. 并发与线性化

| 竞争 | 线性化点 | 结果 |
|---|---|---|
| 两个首条 append（不同键） | anchor create-only + evidence/head create | 一胜；另一 `EVIDENCE_CHAIN_BROKEN`/`CONFLICT`；只有 1 个 anchor/head/E1；不分叉 |
| 两个非首条 append | head revision/lastEvidenceId CAS + expectedHead | 一胜；另一 `EVIDENCE_HEAD_CONFLICT`；无分叉 |
| 首条 append 与已有链 append | anchor/head/expectedHead | 已有链者按 `ChainProof`；首链者发现 head/anchor 非空 → `EVIDENCE_CHAIN_BROKEN` |
| 两个 migration/audit | audit create-only | 一胜；另一 409；必须单写者/写冻结 |
| audit 迁移与运行时 | 部署写冻结 + proof create-only | proof 未提交前运行时 `PROOF_REQUIRED`；提交后只读 |
| CloudStore 事务冲突 | Cloud transaction + create-only | 一胜；失败方 409/事务回滚；无部分写 |
| LocalStore 并发 | 队列串行化 | 第二个事务看到已提交 anchor/head/evidence 后失败 |
| K3 换钥与 audit | proof ID 含 keyFingerprint/domainHeadRevision | 旧 proof 失效；新审计前全部 `PROOF_REQUIRED` |

**首链失败方错误码建议**：`EVIDENCE_CHAIN_BROKEN/409`（链已存在/空性不成立），而不是 `CONFLICT`；如果 Store create-only 在写阶段报 409，C1/C2 应映射为 `EVIDENCE_CHAIN_BROKEN`，不得重试为“首链”。非首条新 evidence 预占仍按设计 `CONFLICT/409`；head CAS 仍 `EVIDENCE_HEAD_CONFLICT/409`。该映射列入裁定项 Q7。

## 9. 失败零写

1. 所有证明读取/校验在构造写之前；`EmptyProof`/`ChainProof` 任一失败立即抛错，返回空写集。
2. Store `transact` 的 build 抛错 → 不持久化；LocalStore 用 `next` 工作副本，CloudStore 回滚；anchor/evidence/head/audit/domain 均无部分写。
3. 首链写阶段的 anchor create-only 冲突、evidence 预占、head CAS 失败均在事务内抛错；不得先写 anchor 再写 evidence/head 的分步提交。
4. audit 迁移：anchor 补齐可分批提交（create-only）；audit proof 只在全部成功且写冻结下创建。proof 未创建时运行时仍 `PROOF_REQUIRED`，不会因为“部分 anchor 已存在”而放行。
5. 每个负向用例必须以**全库快照**（含新增两集合）比较内容级零变化；不得只比较 evidence/head。
6. 迁移失败不得修复/删除已有 evidence/head/anchor；只输出失败清单和阻断结果。

## 10. 与已批准设计/当前实现的差异

| 项 | `b15aceb`/`5dff386` 现状 | 本卡设计 | 原因/需批准 |
|---|---|---|---|
| 空链证明 | 事务外预读 + `hasExistingEvidence`（`h4c-evidence.mjs:352-381`） | 事务内 K3 + audit + anchor + 9 IDs | 关闭 Q04；不信任调用方 |
| refs | C1 4/5；C2 设计 14–15（`b15aceb` §8.1 `:416`） | C1 14；C2 23 | 9 IDs + anchor + audit |
| 集合 | 3 个（`b15aceb` §5.5 `:239-260`） | 5 个（加 anchor/audit） | legacy/head 丢失证明 |
| 首链写 | evidence + head（`5dff386:467-470`） | anchor + evidence + head | 防 head/seq1 丢失后重建 |
| 链校验 | 只校验 previous（`5dff386:397-417`） | 完整 1..lastSequence + >last 为空 | 防祖先缺失/孤儿；列入 Q4 |
| legacy/迁移 | 设计 §10 `:475` 禁止自动迁移；C1 无迁移 | 受控全量 audit + anchor 补齐；不自动运行 | 需要部署迁移例外；列入 Q3 |
| 错误码 | 无 audit 证明码 | 加 `EVIDENCE_CHAIN_PROOF_REQUIRED/409` | 区分部署未审计与 K3 不可用 |
| API | `hasExistingEvidence` 入参 | **删除**；只读 Store proof | 消除调用方布尔值 |
| K3 domain | 固定 global head + 只读 guard | 不变；audit 只绑定、不写 domain | 保持 global K3 锚完整 |

## 11. 待 Codex 裁定事项

| 编号 | 事项 | 建议 | 影响 |
|---|---|---|---|
| Q1 | 新增 `device_operation_evidence_chain_anchors` 与 `evidence_chain_audits` 两集合、Store `collections/seed/init/exact/create-only` | 批准 | C1 实现/迁移 |
| Q2 | audit proof 是否 HMAC + K3 绑定、仅迁移可写 | 批准 HMAC + 静态扫描 | 证明权威性/换钥 |
| Q3 | legacy 处理：L2 补 anchor；L1/L3 abort；是否允许部署迁移例外 | 批准“只补 anchor、不改 evidence/head、不初始化 K3” | 关闭 legacy |
| Q4 | 是否采用完整 1..lastSequence 链校验（而非仅 previous） | 建议采用；9 IDs 已付成本 | 祖先缺失/孤儿 |
| Q5 | C2 R1 23 refs、C1 14、迁移 13/3 是否接受 | 批准；<90 | 90 上限 |
| Q6 | `EVIDENCE_CHAIN_PROOF_REQUIRED/409` 是否接受；还是复用 `EVIDENCE_CHAIN_BROKEN` | 建议新增 | 错误投影 |
| Q7 | 首链并发失败映射 `EVIDENCE_CHAIN_BROKEN`（建议）还是 `CONFLICT`；是否允许重试为普通 append | 建议 BROKEN，不自动重试首链 | 并发语义 |
| Q8 | audit ID 含 `keyFingerprint + domainHeadRevision`；K3 换钥后必须重新审计 | 批准 | 换钥/迁移 |
| Q9 | 是否所有 append（含已有链）都要求 audit proof；还是仅首链 | 建议全部要求 | 部署门禁 |
| Q10 | 是否要求 Store 层对 evidence ID 前缀做额外写形状校验（作为纵深防御） | 建议列为可选后续，不阻塞本卡 | 非规范写入 |

## 12. 防御性负向用例矩阵（设计，不执行）

> 以下为设计验收矩阵；实现时全部使用 LocalStore/fake CloudStore/合成 fixture，不启动 HTTP、不调用 Provider/设备/生产云。`Z` = 全库内容级零变化（含 anchor/audit）；`X` = 允许写集。

| ID | 前置/注入 | 期望 | 写 |
|---|---|---|---:|
| N01 | K3 完整；audit proof 有效；head/anchor/E1..E9 全空 | 首条成功；anchor+E1+head；domain 0 | X |
| N02 | **head=null、anchor=null、E2 合法 canonical、无调用方布尔值** | `EVIDENCE_CHAIN_BROKEN/409`；不建 E1/head/anchor | Z |
| N03 | head=null、anchor=null、E2..E9 任一/全部存在 | `EVIDENCE_CHAIN_BROKEN`；9 IDs 全量拒绝 | Z |
| N04 | head=null、E1 存在 | `EVIDENCE_CHAIN_BROKEN` | Z |
| N05 | head=null、anchor 存在、E1..E9 空 | `EVIDENCE_CHAIN_BROKEN`；不得重建 | Z |
| N06 | head=null、anchor=null、E1..E9 空、audit proof 缺失 | `EVIDENCE_CHAIN_PROOF_REQUIRED` | Z |
| N07 | audit proof HMAC 错/字段多/少/status 非法/legacyCount>0 | `EVIDENCE_CHAIN_PROOF_REQUIRED` | Z |
| N08 | K3 domain 双缺/单缺/损坏，audit proof 有效 | `DOMAIN_INCOMPLETE`；K3 优先 | Z |
| N09 | K3 realm/version/fingerprint 变化 | `DOMAIN_MISMATCH`；不写 | Z |
| N10 | 已有 canonical 链 E1..EN + anchor；追加 EN+1 | 成功；只写 EN+1+head；anchor 不变 | X |
| N11 | head.lastSequence=2、E1 缺失、E2 存在 | 完整链校验 `EVIDENCE_CHAIN_BROKEN` | Z |
| N12 | head.lastSequence=1、E3 孤儿 | >last 非空 `EVIDENCE_CHAIN_BROKEN`/`CONFLICT` | Z |
| N13 | head/E1..EN 存在、anchor 缺失（legacy L2） | `EVIDENCE_CHAIN_BROKEN`；待迁移 | Z |
| N14 | anchor 存在、firstEvidenceId 错/org/job 错 | `EVIDENCE_CHAIN_BROKEN` | Z |
| N15 | anchor 字段多/少/ID 错/createdAt 非法 | anchor validator 失败 → `EVIDENCE_CHAIN_BROKEN` | Z |
| N16 | audit proof 的 domainHeadRevision/keyFingerprint/realm 不匹配 | `EVIDENCE_CHAIN_PROOF_REQUIRED` | Z |
| N17 | 两个首条 append 并发（不同键） | 一胜；另一 `EVIDENCE_CHAIN_BROKEN`/`CONFLICT`；仅 1 组 anchor/E1/head | X/Z |
| N18 | 两个非首条 append 并发 | 一胜；另一 `EVIDENCE_HEAD_CONFLICT`；无分叉 | X/Z |
| N19 | 首链事务中 anchor create-only 冲突 | 事务回滚；无 E1/head/部分 anchor | Z |
| N20 | 首链事务中 E1 预占/head 写冲突 | 事务回滚；无部分写 | Z |
| N21 | audit 迁移遇到非规范 ID/旧 schema/缺 head | 不写 proof；运行时 `PROOF_REQUIRED` | Z |
| N22 | legacy L1：3fce9b0 realm 作用域 domain | `DOMAIN_INCOMPLETE`；不自动建 fixed head | Z |
| N23 | LocalStore 旧数据缺 anchor/audit 数组 | 初始化数组；无 proof → `PROOF_REQUIRED`；不隐式建链 | Z |
| N24 | audit 迁移成功但某 job anchor 未补齐 | 该 job `EVIDENCE_CHAIN_BROKEN`；不放行 | Z |
| N25 | K3 换钥后旧 audit proof | 新 ID 无 proof → `PROOF_REQUIRED`；重新审计前阻断 | Z |
| N26 | C2 R1 23 refs + R2 8+N≤90 | 无超限；无未声明写；R2 独立事务 | X |
| N27 | 生产树静态扫描 | 无 `hasExistingEvidence`、无运行时 audit 写、无 K3 init | Z |
| N28 | anchor/audit 记录注入敏感字段/未知字段 | exact validator 拒绝；零写 | Z |
| N29 | head.lastSequence=9 再 append | `EVIDENCE_INVALID`；零写 | Z |
| N30 | 全空且 audit proof 有效，但 audit proof 绑定旧 domain revision | `PROOF_REQUIRED`；不首链 | Z |
| N31 | 已有链 anchor/audit 有效，但 expectedHead 过期 | `EVIDENCE_HEAD_CONFLICT`；零写 | Z |
| N32 | Store 写阶段 Cloud 事务冲突 | 一胜；失败方回滚；无部分 anchor/evidence/head | Z/X |

## 13. 迁移与交付边界

### 13.1 受控迁移（未来任务，不在本卡实现）

1. 维护窗口/写冻结；运行时停止；确认 K3 domain 已完整（只读）。
2. 用 CloudStore 权威 `list` 分页扫描 `device_operation_evidence`、`device_operation_evidence_heads`、`device_operation_evidence_chain_anchors`。
3. 按 `(orgId,jobId)` 校验 canonical 链；对无 anchor 的 canonical job，逐 job create-only 补 anchor；不改 evidence/head。
4. legacy L1（3fce9b0 realm 作用域 domain）、非规范 ID、缺 head/断链、不可补齐记录：不写 proof，输出阻断清单；需另立 K3 迁移/清理卡。
5. 全部成功且 `legacyCount=0` 后，在同一写冻结窗口创建 `evidence_chain_audits`（HMAC/K3 绑定、create-only）。
6. proof 创建失败或部分 anchor 已提交：运行时仍 `PROOF_REQUIRED`；重跑幂等（已存在 anchor 跳过/校验）。
7. 迁移不初始化 K3、不写 domain、不修改 evidence/head、不自动修复业务数据。

### 13.2 本卡交付范围

- 只交本设计卡；不新增生产代码、测试、Store 注册、迁移脚本。
- 不修改 `5dff386` 代码/测试/证据包；不合并 `main`；不 push；不注册 HTTP；不调用 Provider/设备/生产云。
- C2/C3 继续关闭；本卡不构成 C2 前置批准，也不替代 G1/C2 门禁。

## 14. 验收与停止点

Codex 批准本卡后，才可另发 C1 实现卡；实现卡至少包含：

1. 两集合 schema/Store 注册/静态扫描；
2. K3 + audit proof + anchor + 9 IDs + 完整链的运行时代码；
3. C1 14 refs、C2 23 refs 和 90 上限测试；
4. 本卡 N01–N32 的实现级测试（LocalStore + fake CloudStore，无 HTTP/无外部网络）；
5. legacy 迁移脚本另立卡，不在 C1/C2 实现中运行。

本卡到此停止；等 Codex 复审并批准设计。

---

**提交对象：Codex。请复审并裁定 §11；批准后再进入 C1 实现，不启动 C2/C3。**
