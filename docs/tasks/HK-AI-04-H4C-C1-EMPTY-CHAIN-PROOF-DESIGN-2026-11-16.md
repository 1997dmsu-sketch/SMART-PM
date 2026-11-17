# HK-AI-04 H4-c C1 空链证明设计返工卡（P1 复审返工稿）

> 状态：**设计提案，待 Codex 批准。** 本稿只改设计卡；不实现 C1、不修改 f2bb6de/5dff386 代码或测试、不进入 C2/C3、不注册 HTTP、不调用 Provider/设备/生产云。
>
> 输入设计卡：`f2bb6deda6fa4a5e967b405b358956480ac4516a`（父 `5dff386`）；C1 代码基线：`5dff386fe5c9648b04d1623d3e1898c59332639e`。
>
> 已批准设计：`docs/hk-face-h4c-reconciliation-design @ b15aceb`；批准/任务卡：`ed7b66f`；C2 前置检查：`42f8970`。
>
> 本稿针对 P1 复审补充：全量盘点后的持续写入权威约束、覆盖失效 fail-closed、并发/迁移切换、失败全库零写矩阵、refs 预算和残留 seq2 拒绝重建。只交 Codex 复审；批准后再另发 C1 实现卡。

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 当前缺口 | C1 `appendEvidenceWrites` 信任调用方 `hasExistingEvidence`，事务内只检查新 sequence 的 evidence ID；head/seq1 丢失而合法 seq2..9 残留时可能建立新首链 |
| 推荐方案 | **job 链锚 + 全局链审计证明 + 持续写入准入（write epoch/policy/ticket） + 1..9 确定性 evidence IDs 全量点查 + 完整 canonical 链校验** |
| 核心不变量 | 先验证 global K3 锚完整；再验证 `CoverageValid` 审计覆盖；再验证 per-job anchor/head/1..9；写入必须通过 canonical admission；任一不满足即失败关闭、全库零写 |
| 持续禁止旧写入者 | 全量盘点后，旧 C1/legacy/任何未持当前 `writeEpoch + admissionPolicyVersion + writerSetDigest` 的事务写入 H4-c 集合一律被 Store 写入门拒绝；不是一次性审计 |
| 覆盖失效 | proof 缺失/HMAC/绑定/epoch/policy/writer/collection 覆盖任一失效，或 gate/monitor 异常，全部 `EVIDENCE_CHAIN_PROOF_REQUIRED`，不降级到 anchor/9 IDs |
| 调用方布尔值 | **删除 `hasExistingEvidence`**；不再接受任何调用方“空链”断言 |
| legacy | 规范 legacy 由受控迁移补 anchor；旧 realm 作用域 domain、非规范 ID、无法补齐的记录一律阻断，不自动修复 |
| refs 预算 | C1 14；C2 R1 23；C2 R2 H4-b `8+N≤90`；admission 为事务选项，**0 新增 refs**；均低于 90 上限 |
| 裁定 | 新增两个集合、审计证明 HMAC/K3 绑定、write admission/epoch/policy、legacy 迁移、迁移切换、完整链校验、错误码/refs 均需 Codex 逐项批准 |

## 1. 输入、基线与问题

### 1.1 输入事实

- 专属工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\parallel-c1`，分支 `codex/h4c-empty-chain-design-followup`，HEAD = `f2bb6deda6fa4a5e967b405b358956480ac4516a`（父 `5dff386`）。
- 本地分支 `feat/hk-face-h4c-reconciliation` 仍为 `90e4189`；`origin/feat/hk-face-h4c-reconciliation` 跟踪 ref 为 `5dff386`。本卡不修改输入分支。
- C1 代码基线仍为 `5dff386`：evidence/head/K3 domain validator、只读 domain guard、HMAC、append helper；无 reconcile 服务入口，无 HTTP 注册。
- C2 仅 `42f8970` 前置文档，未开始；C3 未开始。
- 本稿只改本设计卡；不新增生产代码、测试、Store 注册或迁移脚本。

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

### 1.4 本稿对 P1 复审要求的落点

| P1 要求 | 本稿落点 |
|---|---|
| 全量盘点后持续禁止非规范/旧写入者 | §4.5 持续写入准入、§8.2/8.3 迁移切换与旧写入者隔离、Q11–Q16 |
| 覆盖失效时 fail closed | §4.6 CoverageValid/失效触发器、§5.4 优先级、§9.2 零写矩阵 |
| 并发、迁移切换 | §8.1–8.4 |
| 失败全库零写矩阵 | §9.2（运行时 Z_all；迁移 Z_chain 例外显式） |
| refs 预算 | §7；admission 0 新增 refs |
| 残留 seq2 拒绝重建 | §5.5、§6、N02/N03/N42 |
| 不实现 C1/C2/C3 | §13.3、§14 |

## 2. 术语与信任模型

### 2.1 三类记录

| 类别 | 定义 |
|---|---|
| **canonical** | C1 v1 精确 schema；evidence `_id` 为 `(orgId,jobId,sequence)` 确定性 ID；sequence 1..9；previous 链完整；K3 realm/version/fingerprint 与当前 config/domain 一致；HMAC 可重算 |
| **abnormal** | head 缺失/多余/seq0、seq1 缺失但 seq2 存在、seqN 孤儿、anchor/head 不配对、anchor 缺字段、链内某条缺失、ID/字段/HMAC/K3 不一致 |
| **legacy** | 在 anchor/audit/write-admission 方案启用前写入的 evidence/head（含 C1 历史提交 3fce9b0/6dbc9e0/aa0db29/90e4189 的数据、旧 LocalStore 数据文件、非确定性 ID/旧 schema/旧 domain 形态） |

### 2.2 信任模型

1. **不信任调用方布尔值/预读。** 事务内只信任已声明 refs 的 Store state、K3 domain guard 和 HMAC 验证。
2. **global K3 锚优先。** `applyEvidenceDomain` 必须是第一道校验；任何 `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH` 都先于空链证明返回，不允许用 legacy/audit/anchor 绕过 K3。
3. **anchor/audit 不写 K3 domain。** 新记录不能成为 K3 初始化或修复入口；domain 仍只读。
4. **审计证明是受控迁移事实，不是运行时能力。** 生产 C1/C2 代码只读/校验 `evidence_chain_audits`；只有独立迁移工具能创建它，静态扫描和复审保证生产树无写入口。
5. **审计不是一次性许可。** 审计后必须持续限制写入：H4-c 集合写入门要求当前 epoch/policy/writerSet/ticket；旧写入者没有这些凭据，不能写。
6. **覆盖失效即关闭。** proof 失效、gate 缺失、monitor 发现非规范记录、K3/代码/集合范围变化，全部 fail closed；不得以 anchor/9 IDs 继续工作。
7. **Store 完整性假设。** 本设计防止应用层部分写、head/seq1 丢失、并发分叉和 legacy 漏检；不声称能抵抗恶意删除全部 evidence/head/anchor/audit 或绕过 Store 直接改数据库。该残余风险写入“已知边界”；部署必须撤销旧写者 DB 凭证/权限并用 monitor 报警。

## 3. 方案总览

### 3.1 证明层

| 层 | 记录/机制 | 证明什么 | 谁写/谁执行 |
|---|---|---|---|
| L0 | global K3 domain head + version（现有） | K3 配置/换钥锚完整 | 既有受控部署（C1 只读） |
| L1 | `evidence_chain_audits`（新增，全局） | 部署时已对全部 evidence/head 做权威盘点；legacy 已处理或证明为空；绑定 K3、写入 epoch/policy/writer 集 | 仅受控迁移 |
| L2 | `device_operation_evidence_chain_anchors`（新增，每 job） | 该 job 曾经存在一条 evidence 链；head/seq1 丢失也可发现 | 首条 append 与 evidence+head 同事务 |
| L3 | 1..9 确定性 evidence IDs 全量点查 + 完整 canonical 链校验 | 当前 job 没有孤儿/断链/分叉；首链确实为空 | 运行时事务 |
| L4 | **canonical write admission**（新增，Store 写入门） | 只有持当前 epoch/policy/writerSet/ticket 的 canonical writer 能写 H4-c 集合；旧写入者持续被拒绝 | Store gate + C1/C2 |
| L5 | **coverage monitor**（新增，运维周期扫描） | 审计后没有非规范/未知记录；anchor/head/E1 一致；发现即关闭 | 独立监控任务 |

推荐证明式：

```text
CoverageValid =
  proof 存在（ID 由 K3 fingerprint + domainHeadRevision + writeEpoch 计算）
  ∧ exact 22 字段 ∧ HMAC 通过
  ∧ realm/keyVersion/keyFingerprint/domainHeadId/domainHeadRevision 与当前 K3/domain 一致
  ∧ status ∈ {empty, backfilled} ∧ legacyCount = 0
  ∧ writeEpoch / admissionPolicyVersion / writerSetDigest / auditedCollections 与当前部署一致

AdmissionValid(op) =
  Store gate 收到当前 writeEpoch + admissionPolicyVersion + writerSetDigest + proofId
  ∧ K3 HMAC ticket 通过 ∧ operation/write-set 形状正确

EmptyProof(job) =
  K3Exact ∧ CoverageValid ∧ AdmissionValid("genesis")
  ∧ head(job) = null ∧ anchor(job) = null
  ∧ ∀ i ∈ [1,9]: evidence(job,i) = null

ChainProof(job) =
  K3Exact ∧ CoverageValid ∧ AdmissionValid("append")
  ∧ anchor(job) valid ∧ head(job) valid（lastSequence ∈ [1,9]）
  ∧ ∀ i ∈ [1,lastSequence]: evidence(job,i) canonical 且链式 previous 正确
  ∧ ∀ i ∈ [lastSequence+1,9]: evidence(job,i) = null
```

只有 `EmptyProof` 才允许首条；只有 `ChainProof` 才允许非首条。任一条件失败即抛错，写集为空；Store gate 还会在写阶段做最终 admission/shape 校验。

### 3.2 为什么不是“只检查 9 个 ID”

- 只检查 9 个 ID 可以关闭 canonical/abnormal 的 seq2..9 孤儿，但无法发现 **head+seq1+全部 evidence 都被删除** 的曾经存在链；job 链锚解决这一点。
- 只检查 9 个 ID + anchor 仍无法发现 **非确定性 ID/旧 schema 的 legacy 记录**；全局审计证明解决这一点。
- 只做一次性审计仍无法阻止 **审计后旧写入者** 继续写非规范记录；持续 write admission + monitor 解决这一点。
- 只信任全局审计证明而不检查 anchor/9 IDs，会让运行时漏掉审计之后的新损坏；各层缺一不可。

### 3.3 备选方案比较

| 方案 | canonical | abnormal seq2..9 | head/seq1 全丢 | legacy 非规范 | 审计后旧写入者 | 新集合 | 结论 |
|---|---|---|---|---|---|---|---|
| A 仅 9 IDs | 通过 | 通过 | 不可发现 | 不可发现 | 不可阻止 | 无 | 不足 |
| B 9 IDs + job anchor | 通过 | 通过 | 通过 | 不可发现 | 不可阻止 | 1 | 接近 |
| C 9 IDs + anchor + 全局审计 | 通过 | 通过 | 通过 | 由迁移证明/阻断 | 仅审计时点 | 2 | 不足 |
| D C + 持续 write admission + monitor | 通过 | 通过 | 通过 | 迁移证明/阻断 | 持续拒绝/报警 | 2 | **推荐** |
| E 每次全集合扫描 | 通过 | 通过 | 通过 | 可发现 | 可发现 | 0 | Store 事务不支持；竞态/成本不可接受 |

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
| `_id` | `evidence-chain-audit:v1:<keyFingerprint>:<domainHeadRevision>:<writeEpoch>` |
| 字段 | `_id, kind, scope, schemaVersion, realm, keyVersion, keyFingerprint, domainHeadId, domainHeadRevision, writeEpoch, admissionPolicyVersion, writerSetDigest, auditedCollections, status, canonicalEvidenceCount, canonicalHeadCount, anchorCount, legacyCount, inventoryDigest, checkedAt, checkedBy, auditDigest`（22 字段，精确） |
| `kind` / `scope` | 固定 `"audit"` / `"global"` |
| `schemaVersion` | 固定 `1` |
| K3 绑定 | `realm/keyVersion/keyFingerprint/domainHeadId/domainHeadRevision` 必须与当前 K3 config 和 domain head 完全一致 |
| `writeEpoch` | 正整数安全整数；本次审计的部署代次；纳入 `_id`；每次重新审计、代码 policy/writer 集变更或 K3 换钥都必须提升 `writeEpoch`（旧 proof 保留但不被读取） |
| `admissionPolicyVersion` | 正整数；Store gate/C1/C2 的 admission 策略版本；proof 与当前代码/Store 不一致即失效 |
| `writerSetDigest` | 64 位小写 hex；允许的 canonical writer 清单（C1/C2/Store gate 规格）的 SHA-256；旧 writer 集合不匹配即失效 |
| `auditedCollections` | 精确数组，且必须等于 `["device_operation_evidence","device_operation_evidence_heads","device_operation_evidence_chain_anchors"]`；缺/多集合即失效 |
| `status` | `"empty"`（审计时三集合全空）或 `"backfilled"`（全部有链 job 已补 anchor 且校验通过） |
| counts | `canonicalEvidenceCount/canonicalHeadCount/anchorCount/legacyCount` 为非负安全整数；`legacyCount` 必须为 `0` |
| `inventoryDigest` | 64 位小写 hex；对审计时排序后的 `(collection/id)` 清单做 `SHA-256(stableStringify(...))`；用于审计报告复算，运行时只校验格式/绑定 |
| `auditDigest` | 64 位小写 hex；K3 HMAC-SHA256，绑定 domain `KEYED_DIGEST/h4-evidence-chain-audit`、algorithmVersion `1` 及除 `auditDigest` 外全部字段 |
| `checkedAt/checkedBy` | safe int / opaque；仅审计迁移写入 |
| 写入 | **仅受控迁移、create-only**；生产 C1/C2 不写、不更新、不删除 |
| 语义 | 该部署在 `checkedAt` 已做权威盘点，并且**该 proof 的 writeEpoch/policy/writerSet/collections 覆盖当前运行时代**；没有未处理的 legacy |

**注意**：counts 是审计时点的历史快照，不是运行时实时计数；运行时只校验 proof 的 HMAC/K3/覆盖字段，不把 counts 与当前集合比较。审计后新增的 canonical 链由 anchor + 9 IDs + admission 继续证明。

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
| 写入门 | 对 H4-c 三集合/audit 的写入必须通过 §4.5 admission；旧代码无 admission 被拒绝 |

### 4.4 校验与错误码

| 情形 | 错误码 | HTTP | 写 |
|---|---|---:|---:|
| K3 config 缺失/非法 | `NOT_CONFIGURED` | 503 | 0 |
| K3 domain 双缺/单缺/损坏/内部矛盾 | `DOMAIN_INCOMPLETE` | 409 | 0 |
| K3 realm/version/fingerprint 变化 | `DOMAIN_MISMATCH` | 409 | 0 |
| 审计证明缺失、ID/HMAC/绑定/status/覆盖字段非法 | `EVIDENCE_CHAIN_PROOF_REQUIRED`（**新增建议码**） | 409 | 0 |
| 旧 writer 无 admission、epoch/policy/ticket 不匹配 | `EVIDENCE_CHAIN_PROOF_REQUIRED` | 409 | 0 |
| anchor/head/evidence 缺失、孤儿、断链、anchor 不配对 | `EVIDENCE_CHAIN_BROKEN` | 409 | 0 |
| head CAS 失败 | `EVIDENCE_HEAD_CONFLICT` | 409 | 0 |
| 新 evidence ID 预占/写冲突 | `CONFLICT` | 409 | 0 |
| sequence/字段/来源非法 | `EVIDENCE_INVALID` | 409 | 0 |
| 时间越界 | `EVIDENCE_STALE` | 409 | 0 |

`EVIDENCE_CHAIN_PROOF_REQUIRED` 与 `NOT_CONFIGURED` 的区别：前者是“部署已运行但审计覆盖/admission 不可用”，后者是“K3 配置不可用”。两者都 fail-closed，不自动补写。

### 4.5 持续写入准入（审计后的权威约束）

**问题**：审计只证明 `checkedAt` 的库存；如果旧 C1 `5dff386` 代码、legacy 脚本或其他非规范 writer 在审计后继续写 `device_operation_evidence`，9 IDs/anchor 看不到未知 ID，审计 proof 仍是“有效”的。因此必须有**持续的写入门**，而不是一次性审计。

**权威约束组成**：

1. **Store 写入门**：对 `device_operation_evidence`、`device_operation_evidence_heads`、`device_operation_evidence_chain_anchors`、`evidence_chain_audits` 的任何写操作，必须携带 `chainAdmission`；无 admission、未知 op、错误形状直接拒绝。
2. **admission 字段**：
   ```text
   kind: "runtime" | "migration"
   operation: "genesis" | "append" | "migration-anchor" | "migration-audit"
   writeEpoch: 当前正整数
   admissionPolicyVersion: 当前正整数
   writerSetDigest: 当前允许 writer 集
   proofId: 当前 evidence_chain_audits._id
   ticket: K3 HMAC over canonical manifest
   ```
3. **ticket**：`HMAC-SHA256(K3, stable({domain:"KEYED_DIGEST/h4-canonical-write-admission", version:1, kind, operation, writeEpoch, admissionPolicyVersion, proofId, writerSetDigest, refsDigest, writesDigest}))`；Store 通过注入的 K3 verifier 校验。ticket 绑定 epoch/policy/writer/proof/refs/writes，篡改任一即失败。ticket 必须在最终 writes 列表确定后统一生成；C2 在 C1 helper 写集上追加 job/log/op/audit 后不得改写 C1 已签 ticket，应由 C2 transaction builder 统一 mint。
4. **写形状**：
   - H4-c 写集合范围内，`runtime/genesis`：**恰好** anchor + evidence + head；`append`：**恰好** evidence + head；不得写 `evidence_digest_domains` 或 `evidence_chain_audits`；同一事务可包含 C2 的 job/log/op key/op domain/admin_audit 等非 H4-c 写，gate 只校验 H4-c 子集。
   - `migration/migration-anchor`：H4-c 子集仅 anchor；`migration-audit`：仅 audit；不得写 evidence/head/domain；只在迁移冻结模式可用。
   - Store gate 还校验 evidence/head/anchor/audit 的 canonical ID 前缀/exact schema（通过注册的 validator）；链语义由 C1 helper 校验。
5. **旧写入者**：旧 C1 `5dff386`、legacy 脚本、任何未携带当前 `writeEpoch + admissionPolicyVersion + writerSetDigest + proofId + ticket` 的写入者，全部收到 `EVIDENCE_CHAIN_PROOF_REQUIRED/409`，**零写**；即使它写的是 canonical ID/合法 schema 也一样。
6. **部署约束**（必须与代码门同时满足）：
   - 审计前停止所有旧 C1/legacy 进程/脚本，撤销旧 DB 凭证/权限；审计/迁移窗口内只有 migration admission 可用。
   - 审计后启动的新 runtime 必须使用同一 `writeEpoch`/policy/writerSet/proofId；旧 writer 重启无 admission，被 gate 拒绝；旧 Store 代码/直连数据库的残余访问由 DB 权限、网络隔离和 monitor 报警兜底。
   - 任何 gate 拒绝、未知集合写、非规范 ID、monitor 异常都是安全事件；不得自动修复或降级。
7. **配置来源**（待裁定）：`H4_EVIDENCE_WRITE_EPOCH`、`H4_EVIDENCE_ADMISSION_POLICY_VERSION`、`H4_EVIDENCE_WRITER_SET_DIGEST` 由部署配置提供；迁移写入 proof 时冻结，runtime/Store 必须完全一致。缺失/不一致 → `PROOF_REQUIRED`。

**为什么不是“只加一个 epoch 字段”**：记录字段会给旧 schema/旧记录带来迁移问题；admission 是事务级选项，不改变 evidence/head/anchor 记录字段，也不增加 refs（proof ref 已存在）。旧 writer 没有 admission 代码路径，因此被 gate 拒绝。

### 4.6 CoverageValid 与失效 fail-closed

`CoverageValid` 是运行时每次 append 必须验证的完整覆盖：

```text
CoverageValid =
  proof = read(evidence_chain_audits, _id(K3 fingerprint, domainHeadRevision, writeEpoch))
  ∧ exact 22 字段 ∧ auditDigest HMAC 通过
  ∧ kind="audit" ∧ scope="global" ∧ schemaVersion=1
  ∧ realm/keyVersion/keyFingerprint/domainHeadId/domainHeadRevision 与当前 K3/domain 一致
  ∧ status ∈ {"empty","backfilled"} ∧ legacyCount=0
  ∧ writeEpoch = 当前 runtime/Store epoch
  ∧ admissionPolicyVersion = 当前代码/Store policy version
  ∧ writerSetDigest = 当前允许 writer set
  ∧ auditedCollections = 精确三集合数组
```

**失效触发器**（任一命中）：

| 触发器 | 结果 |
|---|---|
| proof 缺失、被删除、HMAC/字段/ID 非法 | `EVIDENCE_CHAIN_PROOF_REQUIRED`，全库零写 |
| K3 换钥/realm/version/fingerprint 变化，domain head revision 变化 | proof ID 不再命中；`PROOF_REQUIRED`（或先 `DOMAIN_MISMATCH`） |
| `writeEpoch`/`admissionPolicyVersion`/`writerSetDigest` 与当前配置/代码不一致 | `PROOF_REQUIRED` |
| `auditedCollections` 缺/多集合，或新增 schema/集合 | `PROOF_REQUIRED`；需重新审计 |
| Store gate 缺失/禁用/版本不一致 | 启动自检失败，服务不就绪；绝不降级 |
| coverage monitor 发现未知 ID/非规范 schema/anchor-head-E1 不一致 | 服务进入关闭态；`PROOF_REQUIRED`；人工事件/重新审计 |
| 审计 proof 仅由 migration 写，runtime 试图写 | Store gate 拒绝；`PROOF_REQUIRED` |

**行为**：覆盖失效时，**所有 append（含已有链）一律阻断**，即使 anchor/head/9 IDs 看起来完整；不降级到 9 IDs/anchor，不自动补 proof，不自动修复。重新审计必须产生新 `writeEpoch`/新 proof（旧 proof 不可更新，create-only），runtime/Store 切换到新 epoch 后才恢复。

**启动自检**：C1/C2 服务装配时必须验证 Store gate 存在、policy/epoch/writerSet 与 proof 一致、monitor 健康；任一失败 → 服务不就绪（`NOT_CONFIGURED/503` 或 `PROOF_REQUIRED/409`，Q13 裁定），不得接流量。

## 5. 运行时算法（设计）

### 5.1 首条链：`EmptyProof`

输入：`job`、`expectedHead = null`、`config`、`now`、`decision/source/observedAt/actorId`、`chainAdmission`。**没有 `hasExistingEvidence` 参数。**

1. 校验 config/job/now/decision/source/observedAt/actorId（现有 `:356-368` 规则）。
2. `applyEvidenceDomain(state, cfg)` 只读精确匹配；失败即 `DOMAIN_*`，零写。
3. 读取并验证 `evidence_chain_audits` 的当前 proof：
   - `CoverageValid`（exact 22 字段、K3 绑定、epoch/policy/writerSet/collections、status、`legacyCount=0`、HMAC）；
   - 缺失/损坏/覆盖失效/换钥 → `EVIDENCE_CHAIN_PROOF_REQUIRED`，零写。
4. 校验 `chainAdmission`：kind=`runtime`、operation=`genesis`、epoch/policy/writerSet/proofId 与 proof/当前配置一致、ticket HMAC 通过；失败 → `PROOF_REQUIRED`，零写。
5. 读 head；必须为 null；否则走非首条路径。
6. 读 anchor；必须为 null；存在 → `EVIDENCE_CHAIN_BROKEN`，零写。
7. 读 `evidenceId(org,job,1..9)`；**9 个必须全为 null**；任一存在（包括合法 seq2..9）→ `EVIDENCE_CHAIN_BROKEN`，零写。
8. 构造并校验 anchor/evidence seq1/head（字段同 §4.1/现有 validator）；返回 3 条写：`anchor + evidence + head`；无 domain 写。
9. Store gate 在写阶段再次校验 admission/ticket/形状；失败 → 事务回滚，零写。

### 5.2 非首条：`ChainProof`

1. 步骤 1–4 同上（K3 + CoverageValid + admission 优先）。
2. 读 head；必须存在，且 `expectedHead` 的 `revision/lastEvidenceId/lastSequence` 完全匹配；否则 `EVIDENCE_HEAD_CONFLICT`/`EVIDENCE_CHAIN_BROKEN`。
3. 读 anchor；必须存在，且 `orgId/jobId` 匹配、`firstEvidenceId=E_1`、`createdAt=E_1.createdAt`；否则 `EVIDENCE_CHAIN_BROKEN`。
4. 校验完整 canonical 链：
   - 对 `i=1..head.lastSequence`：`E_i` 存在；`validateEvidenceRecord`；`_id`/`orgId`/`jobId`/`sequence`/`previousEvidenceId` 正确；K3 realm/version/fingerprint 与当前 config/domain 一致；HMAC 通过；
   - `E_head.lastSequence._id === head.lastEvidenceId`；`E_head.lastSequence.observedAt === head.lastObservedAt`；
   - 对 `i=head.lastSequence+1..9`：必须为 null（新 sequence 必须为空；若存在 → `EVIDENCE_CHAIN_BROKEN`/`CONFLICT`）。
5. `sequence = head.lastSequence+1`；`sequence > 9` → `EVIDENCE_INVALID`；构造 evidence + next head；返回 2 条写：`evidence + head`；anchor 不写；无 domain 写。
6. Store gate 写阶段校验 admission operation=`append`/ticket/形状；失败 → 回滚。

### 5.3 删除 `hasExistingEvidence`

- `appendEvidenceWrites` 不再接收任何“是否有既有 evidence”的布尔值或调用方证明对象。
- 首链判断只来自 `EmptyProof` 的事务内事实：K3、CoverageValid、admission、head null、anchor null、9 个 ID null。
- `evidenceAppendRefs` 改为返回 §7 的完整 refs；不再用 `head?.lastSequence ?? 0` 选择“新 ID”作为唯一空性依据。
- 生产树静态扫描禁止 `hasExistingEvidence`、`emptyProof`、`callerProof` 等 token 出现在 C1/C2 生产代码；测试只使用合成 audit proof/admission fixture。
- 不允许以“调用方已扫描”或“调用方保证为空”替代事务内证明。

### 5.4 global K3 / coverage / admission 的优先级

运行时顺序固定为：

```text
config 合法性
  → K3 applyEvidenceDomain（只读）
  → CoverageValid（audit proof + epoch/policy/writer/collections）
  → admission 预检（ticket/op/shape）
  → anchor/head/9 IDs/完整链
  → 构造写
  → Store gate 最终 admission/形状校验
```

任何前置失败都不得进入后续层；不得因为“legacy 没有 domain”而跳过 K3，不得因为“audit proof 有 counts”而跳过 K3，不得写 domain 来修复，不得用 anchor/9 IDs 绕过失效的 coverage/admission。

### 5.5 残留 seq2 的硬规则（拒绝重建）

当 `H = null`、`A = null`，而 `E_2..E_9` 中任一存在：

1. `EmptyProof` 的 `∀ i ∈ [1,9]: evidence(job,i)=null` 为假，返回 `EVIDENCE_CHAIN_BROKEN/409`。
2. **不得**写 `E_1`、head、anchor；不得把 `E_2` 改名/重编号/adopt 成新链；不得删除/修复 `E_2`。
3. 即使调用方（旧 C1/legacy）传 `hasExistingEvidence=false`，也不影响判定；新 API 已删除该参数，旧 writer 也被 admission gate 拒绝。
4. 若 `head` 存在且 `lastSequence=2`、`E_1` 缺失、`E_2` 存在：完整链校验失败，`EVIDENCE_CHAIN_BROKEN`；不得追加 `E_3`。
5. 迁移/审计发现该形态时不得补 anchor、不得写 proof；标记为不可补齐 legacy，运行时保持关闭；人工事件/另行受控恢复，C1/C2 不自动修复。

## 6. canonical / 异常 / legacy 证明矩阵

| 类别 | 具体形态 | 运行时判定依据 | 结果 | 写 |
|---|---|---|---|---:|
| canonical empty | K3 完整；CoverageValid；admission 正确；head/anchor/E1..E9 全空 | `EmptyProof` | 允许首条 | X（anchor+evidence+head） |
| canonical chain | anchor/head 有效；E1..EN 完整 canonical；E>N 空 | `ChainProof` | 允许追加 | X（evidence+head） |
| abnormal：head/seq1 丢失、E2 残留 | head null、anchor null、E2 canonical、无调用方布尔值 | 9 IDs 全量点查发现 E2 | `EVIDENCE_CHAIN_BROKEN/409` | Z |
| abnormal：E2..E9 任意残留 | head null、anchor null、任意 E_i (i≥2) 存在 | 9 IDs 全量点查 | `EVIDENCE_CHAIN_BROKEN` | Z |
| abnormal：anchor 存在但 head/seq1 丢失 | anchor != null、head null | anchor 存在即不得重建 | `EVIDENCE_CHAIN_BROKEN` | Z |
| abnormal：head 存在但 anchor 缺失 | head/E1..EN 存在、anchor null | anchor 缺失视为 legacy/损坏，不得追加 | `EVIDENCE_CHAIN_BROKEN` | Z |
| abnormal：anchor/head 不配对 | anchor.firstEvidenceId 或 org/job 不匹配 | anchor + head 双校验 | `EVIDENCE_CHAIN_BROKEN` | Z |
| abnormal：链内祖先缺失 | head.lastSequence=N，E1..E_{k} 缺一条 | 完整 1..N 校验 | `EVIDENCE_CHAIN_BROKEN` | Z |
| abnormal：head 后孤儿 | head.lastSequence=N，E_{N+1} 存在 | 9 IDs 中 >N 非空 | `EVIDENCE_CHAIN_BROKEN`/`CONFLICT` | Z |
| abnormal：head seq0 | head.lastSequence=0（无 anchor/证据） | 新不变量要求首链 head 从 seq1 开始 | `EVIDENCE_CHAIN_BROKEN` | Z |
| abnormal：审计后旧 writer 写 canonical/非规范 | 旧 C1/legacy 无 admission 或 epoch/policy 不符 | Store gate 在写前拒绝 | `EVIDENCE_CHAIN_PROOF_REQUIRED/409` | Z |
| abnormal：覆盖失效 | proof 缺失/HMAC/绑定/epoch/policy/writer/collections 失效 | `CoverageValid` | `PROOF_REQUIRED`；已有链也阻断 | Z |
| abnormal：gate/monitor 异常 | gate 缺失/禁用；monitor 发现未知 ID | 启动自检/monitor | 服务不就绪/`PROOF_REQUIRED` | Z |
| legacy L1：3fce9b0 旧 realm 作用域 domain | `evidence-digest-domain:<realm>`、fixed global head 缺失 | `applyEvidenceDomain` 先失败 | `DOMAIN_INCOMPLETE/409` | Z |
| legacy L2：固定 global domain 但无 anchor | head/E1..EN canonical、anchor null | anchor 缺失；待迁移补 anchor | `EVIDENCE_CHAIN_BROKEN` | Z |
| legacy L3：非确定性 ID/旧 schema | 9 个确定性 ID 可能全空、但 collection 内有其他 ID | 9 IDs 看不到；由 audit proof 的“全量盘点”排除；审计后由 admission/monitor 持续限制 | 无 proof → `PROOF_REQUIRED`；有 proof 且 gate 生效才允许 canonical | Z |
| legacy L4：LocalStore 旧文件缺数组 | 集合缺失/空 | 初始化后 audit proof 必须存在 | 无 proof → `PROOF_REQUIRED` | Z |
| legacy L5：审计迁移发现不可补齐记录 | 非 canonical、head 缺、anchor 冲突、E1 缺失 | 迁移 abort，不写 proof | 运行时永久 `PROOF_REQUIRED` | Z |
| K3 失效 | domain 单边/损坏/换钥/realm 变化 | K3 优先 | `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH` | Z |
| audit 失效 | proof 缺失/HMAC 错/绑定错/status 非法/legacyCount≠0 | `CoverageValid` | `PROOF_REQUIRED` | Z |

**legacy 权威性说明**：9 个确定性 ID 只能证明 canonical 命名空间；非确定性 ID/旧 schema 无法用点读发现。因此 `evidence_chain_audits` 必须是“部署级全量盘点”的受控事实；运行时验证其 HMAC/K3/覆盖字段，而不是重新扫描。若审计迁移漏扫，属于迁移错误；审计后的旧 writer 由 admission gate/DB 权限/monitor 持续限制。

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

### 7.4 上限核对与 admission 开销

- Store 上限 90（`store.mjs:94`、`:428`）。
- C1 14；C2 R1 23；迁移 13/3；C2 R2 ≤90（H4-b 独立事务）。
- **write admission 0 新增 refs**：它是事务选项/ticket，不读新记录；当前 audit proof 已计入 1 条 ref。Store gate 的配置来自部署 config，不占 refs。
- 若 Codex 决定把 admission policy 持久化为可读记录，才需要额外 ref；本卡建议不这样做（Q11）。
- C2 R1 23 距 90 余 67；不得再新增未列出的 ref。
- 所有 refs 去重；9 个 evidence ID 已包含 previous/新 sequence，不重复声明。

## 8. 并发与线性化

### 8.1 链写入竞争

| 竞争 | 线性化点 | 结果 |
|---|---|---|
| 两个首条 append（不同键） | anchor create-only + evidence/head create + admission | 一胜；另一 `EVIDENCE_CHAIN_BROKEN`/`CONFLICT`；只有 1 组 anchor/head/E1；不分叉 |
| 两个非首条 append | head revision/lastEvidenceId CAS + expectedHead | 一胜；另一 `EVIDENCE_HEAD_CONFLICT`；无分叉 |
| 首条 append 与已有链 append | anchor/head/expectedHead | 已有链者按 `ChainProof`；首链者发现 head/anchor 非空 → `EVIDENCE_CHAIN_BROKEN` |
| 旧 writer 与 canonical writer | Store gate admission | 旧 writer 无当前 ticket → `PROOF_REQUIRED`；不产生任何写 |
| coverage 失效与 append | `CoverageValid` | append 在构造写前失败；已有链也阻断；Z_all |
| CloudStore 事务冲突 | Cloud transaction + create-only | 一胜；失败方 409/事务回滚；无部分写 |
| LocalStore 并发 | 队列串行化 | 第二个事务看到已提交 anchor/head/evidence 后失败 |
| K3 换钥与 audit | proof ID 含 keyFingerprint/domainHeadRevision | 旧 proof 失效；新审计前全部 `PROOF_REQUIRED` |

### 8.2 迁移切换时序（write freeze / gate / audit / switchover）

| 阶段 | 动作 | 允许写 | 失败/阻断 |
|---|---|---|---|
| P0 停止旧写者 | 停旧 C1/legacy 进程/脚本；撤销旧 DB 凭证/权限；流量冻结 | 无 | 任何旧写者尝试 → 拒绝/告警；不进入 P1 |
| P1 部署 gate（closed） | 部署新 Store gate 与 migration admission；runtime admission 尚不可用 | 仅 migration（且仅 anchor/audit） | gate 缺失/版本不符 → 服务不就绪 |
| P2 全量盘点 | 分页扫描三集合；校验 canonical；输出 inventory/legacy 清单 | 无 | 发现不可补齐 → 不写 proof；保持在 P1 |
| P3 anchor 补齐 | 对 canonical 无 anchor job，逐 job create-only 补 anchor | anchor only | 部分 anchor 可留存；无 proof；runtime 仍关闭 |
| P4 写 audit proof | 全部成功且 `legacyCount=0` 后，写 22 字段 proof（writeEpoch=E、policy=P、writerSetDigest=W） | audit only | proof 失败 → 无 proof；anchor 可部分留存；runtime 关闭 |
| P5 启动新 runtime | 以 E/P/W 启动；启动自检 CoverageValid + gate；接流量 | runtime genesis/append | 自检失败 → 不接流量；旧 proof/旧 writer 仍关闭 |
| P6 监控 | coverage monitor 周期扫描；异常即关闭 | 正常 canonical | monitor 失败/异常 → `PROOF_REQUIRED`，人工事件 |

**关键顺序**：gate 必须在 audit proof 之前部署并生效；proof 之前旧 writer 已停止/凭证撤销；proof 之后旧 writer 即使重启也无当前 admission，被 gate 拒绝。禁止“先 proof 后 gate”。

### 8.3 旧写入者隔离与回滚

- 旧 C1 `5dff386` 的 `store.transact` 调用没有 `chainAdmission`；新 Store gate 对 H4-c 集合写入直接 `PROOF_REQUIRED`，不落盘。
- 旧进程若仍使用旧 Store 代码/直连 DB，Store gate 无法拦截；P0 的进程停止 + DB 凭证/权限撤销 + 网络隔离 + monitor 报警是必要约束。任何残余旧写者都是安全事件。
- 迁移/审计 workers 使用 migration admission；只能写 anchor/audit；不得写 evidence/head/domain；迁移窗口结束后撤销 migration 凭据。
- 回滚：**不得**恢复旧 writer；如新 runtime 失败，保持 gate closed/服务不就绪，修复后以新 epoch 重新审计；旧 proof 保留但不再被 runtime 读取（ID 含 epoch）。不得删除 proof/anchor/evidence。
- 两个迁移 worker：anchor create-only 幂等；proof create-only 一胜；失败方验证并退出；不得生成两个 epoch 的 proof 同时被 runtime 使用。

### 8.4 proof / gate / runtime 竞争

| 竞争 | 结果 |
|---|---|
| runtime 在 proof 提交前启动 | 读不到当前 proof → `PROOF_REQUIRED`；零写 |
| proof 提交后、runtime 启动前旧 writer 重启 | 无 admission/ticket → gate 拒绝；零写 |
| 两个 migration 同时写 proof | create-only 一胜；另一 409；anchor 幂等；只使用一个 epoch |
| gate 版本/policy 与 proof 不一致 | 启动自检失败；不接流量 |
| monitor 在 append 期间发现异常 | 已完成事务不受影响；后续 append `PROOF_REQUIRED`；人工事件 |
| K3 换钥/domain revision 变化 | 旧 proof ID 不命中；新审计前全部关闭 |

## 9. 失败零写

### 9.1 规则

1. 所有证明/覆盖/admission 校验在构造写之前；`EmptyProof`/`ChainProof`/`CoverageValid`/`AdmissionValid` 任一失败立即抛错，返回空写集。
2. Store `transact` 的 build 抛错 → 不持久化；LocalStore 用 `next` 工作副本，CloudStore 回滚；anchor/evidence/head/audit/domain 均无部分写。
3. Store gate 在写阶段再次校验 admission/ticket/形状；失败 → 事务回滚；不得先写 anchor 再写 evidence/head 的分步提交。
4. audit 迁移：anchor 补齐可分批提交（create-only）；audit proof 只在全部成功且写冻结下创建。proof 未创建时运行时仍 `PROOF_REQUIRED`，不会因为“部分 anchor 已存在”而放行。
5. 每个运行时负向用例必须以**全库快照**（含新增两集合、C2 的 job/grant/log/op/audit）比较内容级零变化；不得只比较 evidence/head。
6. 迁移失败不得修复/删除已有 evidence/head/anchor；只输出失败清单和阻断结果。

### 9.2 全库零写矩阵

定义：

- `Z_all`：全库内容级零变化，含 `evidence_digest_domains`、`device_operation_evidence`、`device_operation_evidence_heads`、`device_operation_evidence_chain_anchors`、`evidence_chain_audits`，以及 C2 的 job/grant/log/op key/op domain/audit；Provider 0。
- `Z_chain`：chain 关键集合（domain/evidence/head/audit proof）零写；仅迁移 anchor 可能已部分 create-only 提交（幂等），runtime 仍关闭。

| ID | 失败 | 检测层 | 期望 | 零写范围 |
|---|---|---|---|---|
| F01 | K3 config/domain 缺失/单边/损坏/换钥 | K3 | `DOMAIN_*` | `Z_all` |
| F02 | audit proof 缺失/HMAC/绑定/status/legacyCount/覆盖字段 | CoverageValid | `PROOF_REQUIRED` | `Z_all` |
| F03 | head=null、anchor=null、E2..E9 任一存在 | EmptyProof 9 IDs | `CHAIN_BROKEN` | `Z_all` |
| F04 | anchor/head 不配对、E1 缺失、链内祖先缺失、head 后孤儿 | ChainProof | `CHAIN_BROKEN`/`CONFLICT` | `Z_all` |
| F05 | head CAS 失败/并发非首条 loser | Store CAS | `HEAD_CONFLICT` | `Z_all` |
| F06 | 并发首条 loser | anchor create-only | `CHAIN_BROKEN` | `Z_all` |
| F07 | 旧 writer 无 admission/epoch/policy/ticket 错 | Store gate | `PROOF_REQUIRED` | `Z_all` |
| F08 | gate 缺失/禁用/版本不符（启动） | 启动自检 | 服务不就绪 | `Z_all` |
| F09 | 写形状违规（genesis 缺 anchor / append 写 anchor / 写 `evidence_digest_domains` / runtime 写 `evidence_chain_audits`） | Store gate | `PROOF_REQUIRED`/`CHAIN_BROKEN` | `Z_all` |
| F10 | Cloud 事务冲突/写阶段失败 | Cloud transaction | 409/回滚 | `Z_all` |
| F11 | coverage monitor 发现未知 ID/非规范记录 | monitor | 关闭态/`PROOF_REQUIRED` | `Z_all`（后续写） |
| F12 | K3 换钥/domain revision 变化 | CoverageValid | `DOMAIN_MISMATCH`/`PROOF_REQUIRED` | `Z_all` |
| F13 | 迁移扫描发现不可补齐记录 | migration | 不写 proof | `Z_chain`（anchor 未写/部分） |
| F14 | 迁移 proof 写失败 | migration | 无 proof | `Z_chain`（anchor 可部分） |
| F15 | 迁移期间旧 writer 尝试 | gate/freeze | 拒绝/告警 | `Z_all`（该 writer 事务） |

**迁移例外说明**：anchor 是 create-only 幂等阻断记录，不是业务链写；迁移失败时允许部分 anchor 已提交，但不得有 evidence/head/domain/audit proof 写入，且 runtime 必须保持关闭。若 Codex 要求迁移也全库零写，则必须改为 staging/事务化方案（Q14），本卡不假设可行。

## 10. 与已批准设计/当前实现的差异

| 项 | `b15aceb`/`5dff386` 现状 | 本卡设计 | 原因/需批准 |
|---|---|---|---|
| 空链证明 | 事务外预读 + `hasExistingEvidence`（`h4c-evidence.mjs:352-381`） | 事务内 K3 + CoverageValid + admission + anchor + 9 IDs | 关闭 Q04；不信任调用方 |
| refs | C1 4/5；C2 设计 14–15（`b15aceb` §8.1 `:416`） | C1 14；C2 23；admission 0 refs | 9 IDs + anchor + audit |
| 集合 | 3 个（`b15aceb` §5.5 `:239-260`） | 5 个（加 anchor/audit） | legacy/head 丢失证明 |
| 首链写 | evidence + head（`5dff386:467-470`） | anchor + evidence + head | 防 head/seq1 丢失后重建 |
| 链校验 | 只校验 previous（`5dff386:397-417`） | 完整 1..lastSequence + >last 为空 | 防祖先缺失/孤儿；Q4 |
| 审计后写入 | 无持续约束；旧 C1 仍可写 | Store admission/epoch/policy/ticket + monitor | 持续禁止旧/非规范 writer；Q11–Q16 |
| 覆盖失效 | 无 | CoverageValid/失效触发器/启动自检 | 失效 fail closed；Q13 |
| legacy/迁移 | 设计 §10 `:475` 禁止自动迁移；C1 无迁移 | 受控全量 audit + anchor 补齐 + gate-first switchover；不自动运行 | 部署迁移例外；Q3/Q14 |
| 错误码 | 无 audit/admission 证明码 | 加 `EVIDENCE_CHAIN_PROOF_REQUIRED/409` | 区分部署未审计与 K3 不可用 |
| API | `hasExistingEvidence` 入参 | **删除**；只读 Store proof + admission | 消除调用方布尔值 |
| K3 domain | 固定 global head + 只读 guard | 不变；audit 只绑定、不写 domain | 保持 global K3 锚完整 |

## 11. 待 Codex 裁定事项

| 编号 | 事项 | 建议 | 影响 |
|---|---|---|---|
| Q1 | 新增 `device_operation_evidence_chain_anchors` 与 `evidence_chain_audits` 两集合、Store `collections/seed/init/exact/create-only` | 批准 | C1 实现/迁移 |
| Q2 | audit proof 是否 HMAC + K3 绑定、仅迁移可写 | 批准 HMAC + 静态扫描 | 证明权威性/换钥 |
| Q3 | legacy 处理：L2 补 anchor；L1/L3 abort；是否允许部署迁移例外 | 批准“只补 anchor、不改 evidence/head、不初始化 K3” | 关闭 legacy |
| Q4 | 是否采用完整 1..lastSequence 链校验（而非仅 previous） | 建议采用；9 IDs 已付成本 | 祖先缺失/孤儿 |
| Q5 | C2 R1 23 refs、C1 14、迁移 13/3 是否接受 | 批准；<90 | 90 上限 |
| Q6 | `EVIDENCE_CHAIN_PROOF_REQUIRED/409` 是否接受；还是复用 `CHAIN_BROKEN` | 建议新增 | 错误投影 |
| Q7 | 首链并发失败映射 `CHAIN_BROKEN`（建议）还是 `CONFLICT`；是否允许重试为普通 append | 建议 BROKEN，不自动重试首链 | 并发语义 |
| Q8 | audit ID 含 `keyFingerprint + domainHeadRevision + writeEpoch`；K3 换钥/重新审计必须新 epoch | 批准 | 换钥/迁移 |
| Q9 | 是否所有 append（含已有链）都要求 coverage/admission；还是仅首链 | 建议全部要求 | 部署门禁 |
| Q10 | Store 层 canonical evidence ID 前缀/写形状校验是否纳入 admission gate | 建议纳入 gate，不再作为可选 | 非规范写入 |
| Q11 | **Store admission gate 机制**：K3-HMAC ticket + epoch/policy/writerSet + 写形状（建议）还是 opaque capability/仅 shape | 建议 K3-HMAC ticket；gate 缺失即关闭 | 持续禁止旧 writer |
| Q12 | audit proof 新字段 `writeEpoch/admissionPolicyVersion/writerSetDigest/auditedCollections`、ID 含 epoch；代码/K3/集合变化必须重新审计 | 批准 | 覆盖权威性 |
| Q13 | CoverageValid 失效触发器、启动自检、monitor 关闭态 | 建议逻辑失效 + monitor + 启动自检；不引入时效字段 | 覆盖失效 fail closed |
| Q14 | 迁移切换 gate-first 时序、旧 writer 凭证撤销、回滚禁止旧 writer、迁移 partial anchor 例外 | 批准；迁移失败仅允许 anchor 部分 | 切换安全 |
| Q15 | admission 拒绝错误码：`PROOF_REQUIRED`（建议）还是 `CHAIN_BROKEN`；旧 writer 是否记录审计事件 | 建议 PROOF_REQUIRED + 告警 | 观测/投影 |
| Q16 | `writeEpoch/admissionPolicyVersion/writerSetDigest` 的部署配置来源和轮换/重新审计流程 | 批准配置 + 新 epoch proof | 部署运维 |

## 12. 防御性负向用例矩阵（设计，不执行）

> 以下为设计验收矩阵；实现时全部使用 LocalStore/fake CloudStore/合成 fixture，不启动 HTTP、不调用 Provider/设备/生产云。`Z` = 全库内容级零变化（含 anchor/audit）；`X` = 允许写集。

| ID | 前置/注入 | 期望 | 写 |
|---|---|---|---:|
| N01 | K3 完整；CoverageValid；admission 正确；head/anchor/E1..E9 全空 | 首条成功；anchor+E1+head；domain 0 | X |
| N02 | **head=null、anchor=null、E2 合法 canonical、无调用方布尔值** | `EVIDENCE_CHAIN_BROKEN/409`；不建 E1/head/anchor | Z |
| N03 | head=null、anchor=null、E2..E9 任一/全部存在 | `EVIDENCE_CHAIN_BROKEN`；9 IDs 全量拒绝 | Z |
| N04 | head=null、E1 存在 | `EVIDENCE_CHAIN_BROKEN` | Z |
| N05 | head=null、anchor 存在、E1..E9 空 | `EVIDENCE_CHAIN_BROKEN`；不得重建 | Z |
| N06 | head=null、anchor=null、E1..E9 空、audit proof 缺失 | `EVIDENCE_CHAIN_PROOF_REQUIRED` | Z |
| N07 | audit proof HMAC 错/字段多/少/status 非法/legacyCount>0 | `EVIDENCE_CHAIN_PROOF_REQUIRED` | Z |
| N08 | K3 domain 双缺/单缺/损坏，audit proof 有效 | `DOMAIN_INCOMPLETE`；K3 优先 | Z |
| N09 | K3 realm/version/fingerprint 变化 | `DOMAIN_MISMATCH`；不写 | Z |
| N10 | 已有 canonical 链 E1..EN + anchor；追加 EN+1；admission append | 成功；只写 EN+1+head；anchor 不变 | X |
| N11 | head.lastSequence=2、E1 缺失、E2 存在 | 完整链校验 `EVIDENCE_CHAIN_BROKEN` | Z |
| N12 | head.lastSequence=1、E3 孤儿 | >last 非空 `EVIDENCE_CHAIN_BROKEN`/`CONFLICT` | Z |
| N13 | head/E1..EN 存在、anchor 缺失（legacy L2） | `EVIDENCE_CHAIN_BROKEN`；待迁移 | Z |
| N14 | anchor 存在、firstEvidenceId 错/org/job 错 | `EVIDENCE_CHAIN_BROKEN` | Z |
| N15 | anchor 字段多/少/ID 错/createdAt 非法 | anchor validator 失败 → `CHAIN_BROKEN` | Z |
| N16 | audit proof 的 domainHeadRevision/keyFingerprint/realm 不匹配 | `PROOF_REQUIRED` | Z |
| N17 | 两个首条 append 并发（不同键） | 一胜；另一 `CHAIN_BROKEN`/`CONFLICT`；仅 1 组 anchor/E1/head | X/Z |
| N18 | 两个非首条 append 并发 | 一胜；另一 `HEAD_CONFLICT`；无分叉 | X/Z |
| N19 | 首链事务中 anchor create-only 冲突 | 事务回滚；无 E1/head/部分 anchor | Z |
| N20 | 首链事务中 E1 预占/head 写冲突 | 事务回滚；无部分写 | Z |
| N21 | audit 迁移遇到非规范 ID/旧 schema/缺 head | 不写 proof；运行时 `PROOF_REQUIRED` | Z |
| N22 | legacy L1：3fce9b0 realm 作用域 domain | `DOMAIN_INCOMPLETE`；不自动建 fixed head | Z |
| N23 | LocalStore 旧数据缺 anchor/audit 数组 | 初始化数组；无 proof → `PROOF_REQUIRED`；不隐式建链 | Z |
| N24 | audit 迁移成功但某 job anchor 未补齐 | 该 job `CHAIN_BROKEN`；不放行 | Z |
| N25 | K3 换钥后旧 audit proof | 新 ID 无 proof → `PROOF_REQUIRED`；重新审计前阻断 | Z |
| N26 | C2 R1 23 refs + R2 8+N≤90 | 无超限；无未声明写；R2 独立事务 | X |
| N27 | 生产树静态扫描 | 无 `hasExistingEvidence`、无运行时 audit 写、无 K3 init、无无 admission 的 H4-c 写 | Z |
| N28 | anchor/audit 记录注入敏感字段/未知字段 | exact validator 拒绝；零写 | Z |
| N29 | head.lastSequence=9 再 append | `EVIDENCE_INVALID`；零写 | Z |
| N30 | 全空且 audit proof 有效，但 audit proof 绑定旧 domain revision | `PROOF_REQUIRED`；不首链 | Z |
| N31 | 已有链 anchor/audit 有效，但 expectedHead 过期 | `HEAD_CONFLICT`；零写 | Z |
| N32 | Store 写阶段 Cloud 事务冲突 | 一胜；失败方回滚；无部分 anchor/evidence/head | Z/X |
| N33 | 旧 C1 5dff386 writer 无 chainAdmission 写 E1/head | gate 拒绝；`PROOF_REQUIRED`；零写 | Z |
| N34 | 旧 writer 带错误 epoch/policy/proofId/ticket | gate 拒绝；零写 | Z |
| N35 | admission 的 writerSetDigest/auditedCollections 与 proof 不一致 | `PROOF_REQUIRED`；零写 | Z |
| N36 | proof 被删除/HMAC 篡改；已有 canonical 链追加 | 所有 append `PROOF_REQUIRED`；零写 | Z |
| N37 | K3 换钥/domain revision 变化后 runtime 仍用旧 epoch | proof ID 不命中；`PROOF_REQUIRED`；零写 | Z |
| N38 | Store gate 未部署/禁用/版本不符 | 启动自检失败；服务不就绪；零写 | Z |
| N39 | 迁移冻结期旧 writer 尝试写 | gate/freeze 拒绝；无 chain 写 | Z |
| N40 | 两个 migration 同时写 proof/补 anchor | proof create-only 一胜；anchor 幂等；一个 epoch | X/Z |
| N41 | 迁移补 anchor 后 proof 写失败 | 无 proof；runtime `PROOF_REQUIRED`；无 evidence/head/domain/audit 写 | Z_chain |
| N42 | 残留 E2 + 旧 writer 无 admission | `CHAIN_BROKEN`/`PROOF_REQUIRED`；不建新链 | Z |
| N43 | genesis 缺 anchor / append 写 anchor / 写 domain / runtime 写 audit | gate shape 拒绝；零写 | Z |
| N44 | 新 epoch 重新审计后旧 runtime/旧 epoch 写入 | gate 拒绝旧 epoch；新 epoch 正常 | Z/X |
| N45 | monitor 发现未知 ID/非规范记录 | 服务关闭态；后续 append `PROOF_REQUIRED` | Z |
| N46 | K3 domain 无效但 proof/9 IDs 看似有效 | `DOMAIN_*` 优先；零写 | Z |
| N47 | proof status/legacyCount/auditedCollections 非法 | `PROOF_REQUIRED`；零写 | Z |
| N48 | C2 R1 + admission 0 refs + R2 ≤90 | refs 不超限；无未声明写；无额外 refs | X |

## 13. 迁移与交付边界

### 13.1 受控迁移（未来任务，不在本卡实现）

1. **先停旧写者**：维护窗口/写冻结；停止旧 C1/legacy 进程/脚本，撤销旧 DB 凭证/权限；确认无 in-flight。
2. **先部署 gate（closed）**：新 Store gate + migration admission；runtime admission 尚不可用；gate 版本/epoch/policy 确定。
3. 用 CloudStore 权威 `list` 分页扫描 `device_operation_evidence`、`device_operation_evidence_heads`、`device_operation_evidence_chain_anchors`。
4. 按 `(orgId,jobId)` 校验 canonical 链；对无 anchor 的 canonical job，逐 job create-only 补 anchor；不改 evidence/head。
5. legacy L1（3fce9b0 realm 作用域 domain）、非规范 ID、缺 head/断链、E1 缺失、不可补齐记录：不写 proof，输出阻断清单；需另立 K3 迁移/清理卡。
6. 全部成功且 `legacyCount=0` 后，在同一写冻结窗口创建 22 字段 `evidence_chain_audits` proof（writeEpoch=E、policy=P、writerSetDigest=W、auditedCollections=三集合；HMAC/K3 绑定、create-only）。
7. proof 创建失败或部分 anchor 已提交：运行时仍 `PROOF_REQUIRED`；重跑幂等（已存在 anchor 跳过/校验）。
8. proof 成功后启动新 runtime（同 E/P/W），启动自检 CoverageValid + gate；接流量；monitor 开启。
9. 迁移不初始化 K3、不写 domain、不修改 evidence/head、不自动修复业务数据；不保留旧 writer 回滚路径。

### 13.2 本卡交付范围

- 只交本设计卡；不新增生产代码、测试、Store 注册、迁移脚本。
- 不修改 `f2bb6de`/`5dff386` 代码/测试/证据包；不合并 `main`；不 push；不注册 HTTP；不调用 Provider/设备/生产云。
- C2/C3 继续关闭；本卡不构成 C2 前置批准，也不替代 G1/C2 门禁。

## 14. 验收与停止点

Codex 批准本卡后，才可另发 C1 实现卡；实现卡至少包含：

1. 两集合 schema/Store 注册/静态扫描；
2. K3 + CoverageValid + admission gate + anchor + 9 IDs + 完整链的运行时代码；
3. C1 14 refs、C2 23 refs、admission 0 refs 和 90 上限测试；
4. 本卡 N01–N48 的实现级测试（LocalStore + fake CloudStore，无 HTTP/无外部网络）；
5. 迁移/切换/gate-first 脚本另立卡，不在 C1/C2 实现中运行。

本卡到此停止；等 Codex 复审并批准设计。

---

**提交对象：Codex。请复审并裁定 §11；批准后再进入 C1 实现，不启动 C2/C3。**
