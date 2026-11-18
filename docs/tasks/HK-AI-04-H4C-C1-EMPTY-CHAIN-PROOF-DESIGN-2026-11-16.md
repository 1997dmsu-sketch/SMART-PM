# HK-AI-04 H4-c C1 空链证明设计 v5（v4 追加修订稿）

> 状态：**设计提案，待 Codex 复审。** 本稿只修订设计文档；不实现 C1、不修改任何生产代码/测试/Store、不进入 C2/C3/G4、不注册 HTTP、不调用 Provider/设备/生产云。
>
> 输入设计卡：`575d8b63501bec5f9c7211a128baf86d53fbd63a`（父 `fb75cf0`，C1 代码基线 `5dff386`）。
>
> 已批准设计：`docs/hk-face-h4c-reconciliation-design @ b15aceb`；批准/任务卡：`ed7b66f`；C2 前置检查：`42f8970`。
>
> 本稿保留 v3/v4 修订，并在 §15 追加 v5 权威章节：K3 marker/维护窗口/旧 writer 撤权、plan 签名保存与防重放、monitor 健康期限/时钟/事务内停写、统一 bootstrap fence 与预算。**v4 正文与 §15 冲突处以 §15 为准。**
>
> v5 输入：`3ac5cf9483caebcaf8f5aeb1df8fd4aca9bfb13f`（父 `575d8b6`）。完整云报告 `/workspace/artifacts/DEL-AI-01-CONTENT-REVIEW-2026-11-18/REVIEW.md` 未提供可读正文；已查可访问位置均不可读，未声称逐项关闭。G3 已在 `5f1d7a4` 关闭、O10 PASS，本卡不重复派发；G4/C2/C3/合并/HTTP/UI/部署/上线继续冻结。

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 空链证明 | K3 精确 + CoverageValid + fence clear + 两阶段 admission + anchor + 1..9 IDs + 完整 canonical 链 |
| halt 恢复 | `CLEAR(E0) → HALTED(E0) → CLEAR(E1)`；恢复用独立 signed recoveryPlan，**不要求 active clear fence**；proof+fence+audit 单事务原子完成 |
| bootstrap | v5：首次 bootstrap 检查 fence **不存在**；读集合 domain head/version + fence + marker + audit；**5 refs/4 writes**（domain2+marker+audit）；无 fence/marker 时才允许 |
| 最终审计 | 所有最终写字节（业务写 + 唯一 admin_audit）在 final ticket **之前**生成；ticket 覆盖完整 canonical write set；Store 不自动追加/改审计；禁止双审计 |
| 持续写入约束 | Store gate 覆盖 transact/change/persist/seed/init；runtime/migration/recovery/monitor/k3-bootstrap 分 kind；旧 writer 持续拒绝 |
| refs | **v5：C1 16；C2 R1 25；migration anchor 17、finalize 7；recovery 7；monitor 5；k3-bootstrap 5；plan issue 2；R2 8+N≤90** |
| 裁定 | **v5：Q1–Q31；N01–N96**（v4 Q/N 保留历史；预算/Q 以 §15 为准） |

## 1. 输入、基线与问题

### 1.1 输入事实

- 唯一工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\c1-design-v4`，分支 `codex/h4c-empty-proof-v4`，HEAD = `3ac5cf9483caebcaf8f5aeb1df8fd4aca9bfb13f`，父 `575d8b6`。
- 输入分支 `feat/hk-face-h4c-reconciliation` 本地/origin 跟踪 ref 均为 `5dff386`；本卡不修改输入分支。
- C1 代码基线 `5dff386`；C2 仅 `42f8970` 前置文档；C3/G4 未开始；调度工作区 `SMART-PM-H3` 未修改。
- 本稿只改设计卡；不新增生产代码、测试、Store 注册或迁移脚本。完整云报告本机不可读，未声称读取。

### 1.2 当前实现缺口

| 缺口 | 位置 | 事实 |
|---|---|---|
| 调用方布尔值 | `h4c-evidence.mjs:352-381` | `hasExistingEvidence` 决定 head 空时是否建链 |
| refs 只含新 sequence | `:322-343` | 无 1..9 全量、anchor/audit/fence |
| 只检查新 ID | `:424-427` | seq2..9 孤儿不可见 |
| 首链依赖预读 | `b15aceb` §5.4 `:222-226` | 未原子覆盖 9 IDs |
| 已知缺口 | `42f8970:...C2-PREFLIGHT...:743`（Q04）、`:552`（T11）、`:691`（RC56） | head 删除而 seq2..9 残留时可能留下孤儿链 |
| Store 限制 | `store.mjs:94`、`:428` | 单事务 refs 90；只按声明 refs 点读 |

### 1.3 必须关闭的失败场景

```text
H = null；A = null；E_2..E_9 任一合法 canonical 存在；调用方 hasExistingEvidence=false
```
结果：`EVIDENCE_CHAIN_BROKEN/409`，anchor/E1/head/domain/fence 零写；不 adopt/重编号/删除 E2。

### 1.4 v2/v3 已关闭项

| 项 | 处置 |
|---|---|
| v2 admission 预检/终检与 writesDigest 循环 | v3 两阶段 precheck/final ticket |
| v2 domain 写入门/K3 bootstrap | v3 domain gate + k3-bootstrap |
| v2 Store.change/persist/seed/init | v3 全路径边界 |
| v2 迁移未来 proofId/epoch/inventory | v3 prePlan/finalPlan |
| v2 monitor→runtime 停写 | v3 fence halt/clear |

### 1.5 v4 三项剩余阻断与落点

| 阻断 | v4 处置 | 位置 |
|---|---|---|
| halt 后恢复的 proof/fence/epoch 依赖必须可线性完成，不得要求 active clear fence 才签发恢复票据 | 明确 `BOOTSTRAP→UNPROVEN→CLEAR(E0)→HALTED(E0)→CLEAR(E1)`；独立 recoveryPlan/recoveryTicket；恢复事务原子写新 proof + clear fence + audit，无 FenceClear 前置 | §4.12、§8.3、Q25/Q27、N71–N76 |
| bootstrap 若检查 fence 必须纳入 refs/预算；与首次无 fence 规则一致 | 首次 bootstrap 只允许 fence **不存在**；读集合 domain head/version + fence + audit，refs 4/writes 3；不依赖 proof | §4.5、§7.3、Q7/Q16/Q26、N79 |
| final ticket 与 Store 自动审计统一 | 所有最终写（业务 + 唯一 admin_audit）在 ticket 前物化；ticket 覆盖完整 canonical write set；Store explicit audit mode 不追加/变更；避免双审计 | §4.13、§4.6、Q26、N77/N78/N80 |

## 2. 术语与信任模型

### 2.1 记录类别

| 类别 | 定义 |
|---|---|
| canonical | C1 v1 exact schema、确定性 ID、seq1..9、previous 完整、K3 一致、HMAC 可重算 |
| abnormal | head 缺失/seq0、seq1 缺失但 seq2 存在、孤儿、anchor/head 不配对、链缺、fence halted |
| legacy | anchor/audit/admission/fence 方案前数据（3fce9b0/6dbc9e0/aa0db29/90e4189、旧 LocalStore、非规范 ID/旧 schema/旧 domain） |

### 2.2 信任模型

1. 不信任调用方布尔/预读；只信任事务内 refs、K3、proof、fence、HMAC。
2. K3 锚优先；`applyEvidenceDomain` 先于空链/fence/admission。
3. domain 只读；唯一写入口是独立 `k3-bootstrap`；runtime/migration/recovery 不可写 domain。
4. 审计是持续约束：Store gate + epoch/policy/writerSet/ticket + fence；旧 writer 持续拒绝。
5. 覆盖失效 fail closed：proof/fence/gate/monitor/K3/代码/集合任一失效即停，不降级到 anchor/9 IDs。
6. 停写是持久事实：monitor halt 写 fence；runtime/gate 事务内读取。
7. 恢复是独立授权：halt 后不需要 active fence；recoveryPlan 签名 + 原子 proof/fence/audit 事务完成。
8. 最终审计是 ticket 的一部分：Store 不自动追加/改审计；所有最终字节先物化后签名。
9. Store 完整性假设：不抵抗删除全部记录或绕过 Store 直改 DB；P0 停旧进程/撤凭证/DB 权限/monitor 兜底。

## 3. 方案总览

### 3.1 层

| 层 | 机制 | 约束 |
|---|---|---|
| L0 | K3 domain head/version | 只读锚；k3-bootstrap 独立 |
| L1 | audit proof | 全量盘点、legacy、K3/epoch/policy/writer/collection |
| L2 | job anchor | head/seq1 丢失可发现 |
| L3 | 1..9 IDs + 完整链 | 无孤儿/断链/分叉 |
| L4 | 两阶段 admission + Store gate | 旧 writer 持续拒绝 |
| L5 | fence + monitor | halt 权威停写；恢复独立 |
| L6 | final write set + ticket | 业务+唯一 audit 的最终字节先物化；无双审计 |

### 3.2 证明式

```text
CoverageValid =
  proof 存在（ID=f(K3 fp, domainHeadRevision, writeEpoch)）
  ∧ exact 22 字段 ∧ auditDigest HMAC ∧ K3 绑定
  ∧ status/legacyCount ∧ epoch/policy/writerSet/collections 与当前一致

FenceClear =
  fence 存在 ∧ exact 10 字段 ∧ fenceDigest HMAC
  ∧ status="clear" ∧ fence.epoch=CoverageValid.writeEpoch

AdmissionValid(op) =
  precheck 字段一致 ∧ final ticket 的 refsDigest/writesDigest 与 Store 实际 refs/finalWriteSet 一致
  ∧ K3 HMAC 通过 ∧ operation/H4-c 子集形状正确

EmptyProof(job) =
  K3Exact ∧ CoverageValid ∧ FenceClear ∧ AdmissionValid("genesis")
  ∧ head=null ∧ anchor=null ∧ ∀i∈[1,9]: E_i=null

ChainProof(job) =
  K3Exact ∧ CoverageValid ∧ FenceClear ∧ AdmissionValid("append")
  ∧ anchor valid ∧ head valid（lastSequence∈[1,9]）
  ∧ ∀i∈[1,N]: E_i canonical、previous 正确
  ∧ ∀i∈[N+1,9]: E_i=null
```

迁移/恢复不受 `FenceClear` 约束：migration-anchor 是 pre-fence；recovery 仅要求 fence halted；二者用 plan/recovery 独立授权，最终 proof+fence 原子。

> **v5 更正**：CoverageValid 增 `K3MarkerValid`、proof exact 23；FenceClear exact 12 且含 monitor 健康/时钟；C1/C2/bootstrap/recovery/plan 预算见 §15.1、§15.4。

## 4. 数据契约

### 4.1 job anchor
`_id h4c-evidence-anchor-v1:<sha256([orgId,jobId])[:32]>`；字段 `_id, orgId, jobId, schemaVersion, firstEvidenceId, createdAt`（6）；仅首条 append create-only；不更新/修复。

### 4.2 audit proof（v4 22 字段；v5 以 §15.1.4 的 23 字段为准）
`_id evidence-chain-audit:v1:<keyFingerprint>:<domainHeadRevision>:<writeEpoch>`；22 字段：`_id, kind, scope, schemaVersion, realm, keyVersion, keyFingerprint, domainHeadId, domainHeadRevision, writeEpoch, admissionPolicyVersion, writerSetDigest, auditedCollections, status, canonicalEvidenceCount, canonicalHeadCount, anchorCount, legacyCount, inventoryDigest, checkedAt, checkedBy, auditDigest`。`writeEpoch` 每次重审/代码/集合/K3 变化提升；仅 migration finalize/recovery 写；runtime 只读。

### 4.3 fence（v4 10 字段；v5 以 §15.1.1 的 12 字段为准）
`_id evidence-chain-fence:v1:global`；10 字段：`_id, kind, scope, schemaVersion, status, epoch, reasonCode, monitorId, updatedAt, fenceDigest`。`status clear|halted`；`epoch` 必须等于当前 proof writeEpoch；`fenceDigest` K3 HMAC `KEYED_DIGEST/h4-evidence-chain-fence` v1。初始 clear 与首个 proof 在 migration finalize 同事务创建；halt 由 monitor 写；clear 仅 recovery finalize 写。缺失/损坏/epoch 不符 → HALTED。

### 4.4 Store 写路径

| API | H4-c 写 | 边界 |
|---|---|---|
| `transact` | 唯一允许写 H4-c | 必须 final ticket + explicit audit；gate 终检 |
| `change` | **一律拒绝** H4-c | 无 admission 路径 |
| `persist` | private | 只允许 transact 在 active admission 内调用；直调拒绝 |
| `seed()` | 只空数组 | 非空 H4-c 记录即拒绝 |
| `init()` | 只补 `||= []` | 不写记录、不 persist 链 |
| `list/get` | 只读 | 无 gate |
| 直连 DB/旧 Store | 绕过 gate | P0 撤凭据/权限；monitor 报警 |

### 4.5 K3 domain 写入门与 bootstrap（v4 refs 4/writes 3；v5 以 §15.1.3 的 5/4 为准）

- `evidence_digest_domains` 纳入 gate；runtime/migration/recovery 对 domain 写一律拒绝；C1 保持只读。
- 唯一例外 `kind="k3-bootstrap"`：
  ```text
  k3Bootstrap = { kind, operation:"k3-domain-bootstrap", bootstrapRunId,
                  realm, keyVersion, keyFingerprint, domainHeadId,
                  authorizedAt, ticket }
  ```
  `ticket` = K3 HMAC `KEYED_DIGEST/h4-k3-bootstrap` v1。
- **读集合（store refs）**：domain fixed head、domain version、`evidence_chain_fences/global`、`admin_audit/<auditId>`；refs **4**。
- **写集合**：domain head + version（H4-c 子集恰好 2 条）+ 唯一 explicit admin_audit；writes **3**。
- gate 校验：fence 必须**不存在**（存在/ halted → `K3_BOOTSTRAP_DENIED`）；domain head/version 必须都不存在（部分 → `DOMAIN_INCOMPLETE`/denied）；ID/realm/version/fingerprint 匹配；无 proof 要求；不得写 evidence/head/anchor/audit proof。
- 旧 `initializeEvidenceDomain`（90e4189）无 k3-bootstrap admission → 拒绝。bootstrap 成功后仍需全量 audit；K3 轮换不是 bootstrap（domain 已存在即禁止）。

### 4.6 两阶段 admission

**A. precheck（无 digest，fail-fast）**
```text
precheck = { kind, operation, writeEpoch, admissionPolicyVersion,
             writerSetDigest, proofId }
```
- runtime 在读取前校验 CoverageValid/FenceClear/config；migration/recovery 由 plan/recovery ticket 校验；失败 `ADMISSION`。
- 不含 refsDigest/writesDigest/ticket。

**B. final ticket（写阶段权威）**
```text
refsDigest  = SHA-256(canonical sorted refs [{collection,id}])
writesDigest= SHA-256(canonical sorted finalWriteSet [{collection,id,data}])
ticket      = HMAC-SHA256(K3, canonical({
  domain:"KEYED_DIGEST/h4-canonical-write-admission", version:1,
  kind, operation, writeEpoch, admissionPolicyVersion, writerSetDigest,
  proofId, refsDigest, writesDigest, operationAuthDigest }))
```
- **在 finalWriteSet（业务写 + 唯一 admin_audit）确定后**统一 mint；C1 helper 不提前签；C2 builder 追加 job/log/op/audit 后 mint。
- Store gate 重算 digest，校验 finalWriteSet 与 ticket 完全一致；ticket 不含自身，无循环。
- `operationAuthDigest` 绑定 migrationPlan/recoveryPlan/monitorAuth/k3BootstrapTicket（按 kind）。 `proofId` 在 k3-bootstrap 为 null；monitor 使用当前 proof 或 null；runtime/migration/recovery 必须为当前/目标 proof。
- 失败 `ADMISSION_REQUIRED`；与 proof 失效 `PROOF_REQUIRED` 区分。

**四类/五种 kind**：
| kind | 授权 | 要求 | 可写 |
|---|---|---|---|
| runtime | precheck+final ticket | CoverageValid+FenceClear | genesis/append |
| migration | pre/finalPlan+final ticket | 无既有 proof；pre-fence 可缺失；halted 拒绝 | anchor/finalize |
| recovery | recoveryPlan+final ticket | fence **halted**、epoch/digest 匹配；**不要求 active fence** | proof+fence+audit |
| monitor | monitorAuth+final ticket | 只 fence+audit；halt 不依赖 proof 有效 | fence halt |
| k3-bootstrap | k3BootstrapTicket+final ticket | 无 proof/fence；fence 必须不存在 | domain head+version+audit |

### 4.7 proof 前 migration plan
prePlan：`migrationRunId, targetWriteEpoch, targetAdmissionPolicyVersion, targetWriterSetDigest, targetProofId, preInventoryDigest, auditedCollections, scannedAt, checkedBy, planDigest, planTicket`。finalPlan：同 target + `prePlanDigest, finalInventoryDigest, counts, checkedAt, planDigest, planTicket`。`targetProofId` 由 K3 fp+domainRevision+targetEpoch 确定；planTicket K3 HMAC `KEYED_DIGEST/h4-evidence-migration-plan` v1。migration-anchor 是 **pre-fence**：fence 可不存在（ref 读 null）；若存在且 halted 拒绝；不要求 FenceClear；不写 fence/domain/audit proof。migration-finalize 才原子写 clear fence+proof+audit。

### 4.8 CoverageValid 与 fence/monitor
`CoverageValid`/`FenceClear` 同 §3.2；失效：proof/fence 缺失/HMAC/绑定/epoch/policy/writer/collection/gate/monitor 异常 → `PROOF_REQUIRED`/`HALTED`；所有 append（含已有链）阻断，不降级、不自动修复。
monitor：周期扫描 evidence/head/anchor/fence；发现异常写 fence `status=halted`（monitorAuth+final ticket，只 fence+audit）；runtime/gate 读取；halt 是**全局 H4-c 停写**（runtime/migration/recovery/K3 bootstrap/domain/evidence/head/anchor/audit/fence），读允许；**monitor 不负责 clear**；clear 仅 §4.12 recovery。缺失 fence（proof 后）→ HALTED；在途事务可完成，后续停。

### 4.9 digest 规范化
canonical JSON：plain object；key UTF-16 升序（`stableStringify`）；数组有序；字符串 NFC/UTF-8；仅 null/bool/safe int/string/array/plain object；拒绝 undefined/function/symbol/BigInt/NaN/Infinity/-0；hex 小写 64。
| digest | 算法/domain | 输入 |
|---|---|---|
| auditDigest | HMAC K3 `h4-evidence-chain-audit` v1 | proof 除自身 |
| fenceDigest | HMAC K3 `h4-evidence-chain-fence` v1 | fence 除自身 |
| monitorAuth | HMAC K3 `h4-evidence-monitor` v1 | `{monitorId, observedEpoch, reasonCode, halt, fenceId}` |
| ticket | HMAC K3 `h4-canonical-write-admission` v1 | precheck + refs/writes + operationAuthDigest |
| planTicket | HMAC K3 `h4-evidence-migration-plan` v1 | plan 除自身 |
| recoveryTicket | HMAC K3 `h4-evidence-chain-recovery` v1 | recovery plan 除自身 |
| k3BootstrapTicket | HMAC K3 `h4-k3-bootstrap` v1 | bootstrap 字段 |
| refsDigest/writesDigest | SHA-256 | sorted refs / finalWriteSet |
| inventoryDigest | SHA-256 | final inventory `[collection,id,recordDigest]` |
| writerSetDigest | SHA-256 | sorted writer manifests |

### 4.10 inventory / 2 万行
final inventory = anchor backfill 后、fence+proof 创建前完整快照；proof `inventoryDigest/counts/checkedAt` 取该时点。`Store.list` 20,000 行上限会 503；迁移必须用 Cloud export/游标；任一集合 >20k 且无 export → `MIGRATION_CAPACITY_EXCEEDED/409`，不写 proof；anchors 可部分（Z_chain）；禁止截断/采样。

### 4.11 错误码
| 情形 | code | HTTP |
|---|---|---:|
| K3 config | NOT_CONFIGURED | 503 |
| K3 domain | DOMAIN_INCOMPLETE/MISMATCH | 409 |
| domain 无 bootstrap/部分/fence 存在 | K3_BOOTSTRAP_DENIED | 409 |
| proof 缺失/HMAC/绑定/覆盖 | EVIDENCE_CHAIN_PROOF_REQUIRED | 409 |
| precheck/final ticket/旧 writer/change/persist | EVIDENCE_CHAIN_ADMISSION_REQUIRED | 409 |
| fence halted/缺失/epoch/clear 授权 | EVIDENCE_CHAIN_HALTED | 409 |
| 链结构 | EVIDENCE_CHAIN_BROKEN | 409 |
| CAS | EVIDENCE_HEAD_CONFLICT | 409 |
| ID 预占 | CONFLICT | 409 |
| inventory >20k | MIGRATION_CAPACITY_EXCEEDED | 409 |
| 字段/sequence/来源 | EVIDENCE_INVALID | 409 |
| 时间 | EVIDENCE_STALE | 409 |

C2 统一 409（K3 config 503）；不混用 PROOF/ADMISSION/HALTED。

### 4.12 halt 状态机与独立恢复授权（v4；v5 §15 增补 marker/plan/health）

**状态**：
| 状态 | 条件 | 可写 |
|---|---|---|
| BOOTSTRAP | 无 domain/fence/proof | 仅 k3-bootstrap |
| UNPROVEN | domain 完整；无 proof/fence | 仅 migration |
| CLEAR(E) | proof E + fence clear E | runtime genesis/append；monitor halt；不允许 migration finalize |
| HALTED(E) | fence halted E | recovery finalize；monitor halt（更新 reason） |

**转移**：
```text
BOOTSTRAP --k3-bootstrap--> UNPROVEN
UNPROVEN --migration-finalize(new proof E0 + clear fence E0)--> CLEAR(E0)
CLEAR(E0) --monitor halt--> HALTED(E0)
HALTED(E0) --recovery-finalize(recoveryPlan, new proof E1 + clear fence E1)--> CLEAR(E1)
HALTED(E0) --failed recovery--> HALTED(E0)
CLEAR(E1) --monitor halt--> HALTED(E1)
```
**恢复独立授权**：
```text
recoveryPlan = { kind:"recovery-plan", scope:"global", schemaVersion:1,
  recoveryRunId, haltedFenceId, haltedEpoch, haltedFenceDigest,
  targetWriteEpoch, targetAdmissionPolicyVersion, targetWriterSetDigest,
  targetProofId, finalInventoryDigest, canonicalEvidenceCount,
  canonicalHeadCount, anchorCount, auditedCollections, checkedAt, checkedBy,
  planDigest, recoveryTicket }
```
- `recoveryTicket` K3 HMAC `KEYED_DIGEST/h4-evidence-chain-recovery` v1。
- gate `kind="recovery"`, operation `recovery-finalize`：**不要求 FenceClear**；要求 fence status halted、epoch=haltedEpoch、fenceDigest=haltedFenceDigest；targetProofId 不存在；final inventory 完整；recoveryPlan/ticket 有效。
- **单事务原子写**：new audit proof(E1) + fence clear(E1) + 唯一 admin_audit；H4-c 子集恰好 fence+proof；不得写 domain/evidence/head/anchor。
- 事务 refs **5**：K3 domain head/version 2 + current fence 1 + target proof 1 + admin audit 1；writes 3（fence+proof+audit）。
- 成功：旧 proof 保留，fence clear E1；失败：无 fence/proof/audit 写，fence 仍 HALTED(E0)，零写。
- **无需 active clear fence**：recoveryPlan 在 halt 状态签发；gate 只依赖 halted fence 和 recovery ticket，不依赖 FenceClear。
- 线性化：recovery transaction 是 proof+fence+audit 的唯一点；不存在“先 clear 后 proof”或“先 proof 后 clear”。
- 并发：
  * 两 recovery 同 HALTED(E0)：target proof create-only 一胜；另一 ADMISSION/HALTED；无双 proof/fence。
  * monitor halt 与 recovery：monitor halt 必须携带 observedEpoch；recovery 提交 E1 后，旧 E0 halt 重放被拒（`HALTED`/`ADMISSION`），monitor 可重新 halt E1。
  * runtime 在 HALTED：HALTED；CLEAR(E1) 后正常。
  * migration 在 HALTED：只允许 recovery；普通 migration 拒绝。
  * K3 换钥/domain 变化：recovery 先 `DOMAIN_MISMATCH`，零写。
- 失败全库零写见 §9.2 R01–R10。

### 4.13 finalWriteSet 与 Store 审计边界（v4；v5 §15 增补 plan/marker/control audit）

所有 H4-c gate 事务在 final ticket 前生成完整 `finalWriteSet`：

1. **业务写**：C1 helper 的 anchor/evidence/head（以及 C2 job/log/op/domain 等）；H4-c 子集形状由 gate 校验。
2. **唯一 admin_audit**：由 C2/控制事务在 ticket 前显式构造，字段全部固定：
   - `_id` = `audit-h4c-v1:` + `sha256(stable([orgId, scopeKey, action, targetList, revision])).slice(0,32)`；C2 的 scopeKey=jobId，control 的 scopeKey=`operation:<op>`；targetList 为排序 `collection/id`（不含 audit 自身）；
   - `target`：按 collection/id 排序的业务写目标（不含 audit 自身），不随 Store 时间变化；
   - `createdAt`：调用方传入的 `now` 安全整数，显式写入；
   - `actorId/actorType/action/orgId`：C2/control 输入；`target=targetList.join(", ")`；`createdAt=now`；admin_audit 精确 **7 字段**：`_id, orgId, actorId, actorType, action, target, createdAt`。
3. **finalWriteSet** = 业务写 + 上述唯一 audit；`admin_audit/<auditId>` 必须已在 refs 中声明。
4. 计算 refsDigest/writesDigest（含 audit 字节），mint ticket；gate 重算校验。
5. Store 使用 **`auditMode:"explicit"` / `transactFinal`**：只写 finalWriteSet，**不得**再调用默认 `auditRecord`、不得生成第二个 admin_audit、不得改 `_id/createdAt/target`、不得在终检后追加写。
6. 若 Store 试图注入/修改 audit 或追加写，digest 不匹配 → `ADMISSION_REQUIRED`，整事务回滚；无双审计。
7. C1 helper 本身只返回业务写（v5 16 refs 不含 audit）；生产 C2 final set 加唯一 audit。C1 单测用显式 test audit；不得依赖 Store 随机 audit。
8. migration/recovery/monitor/k3-bootstrap 同样使用 explicit audit；预算见 §7.3。

## 5. 运行时算法

### 5.1 首条 `EmptyProof`
1. config/job/now/source/observedAt/actorId。
2. K3 domain exact；`DOMAIN_*`。
3. `CoverageValid`、`FenceClear`。
4. runtime precheck（kind/runtime/genesis/epoch/policy/writer/proofId）→ ADMISSION。
5. head=null、anchor=null、E1..E9=null；否则 BROKEN。
6. 构造 anchor/E1/head；C2 生成 finalWriteSet（含唯一 audit）；final ticket；Store gate 校验 shape/digest/fence；写 H4-c+audit；无 domain。
7. 失败回滚零写。

### 5.2 非首条 `ChainProof`
1–4 同（append）。
5. head/anchor/完整链 1..N、>N null；否则 BROKEN/CONFLICT。
6. sequence=N+1；>9 → EVIDENCE_INVALID；构造 E+head；finalWriteSet/audit/ticket；gate；写 E+head+audit。
7. 失败回滚。

### 5.3 删除 `hasExistingEvidence`
API 无布尔/调用方证明；首链只由 K3/Coverage/Fence/precheck/head/anchor/9 IDs 决定；`evidenceAppendRefs` 返回 16 refs（v5：含 K3 marker）；生产树禁止 `hasExistingEvidence`/`emptyProof`/`callerProof`；测试用合成 proof/admission/fence/audit。

### 5.4 顺序
`config→K3→Coverage→Fence→precheck→anchor/head/9 IDs/链→finalWriteSet（含 audit）→ticket→gate→写`；任一失败不进入后续，不降级。

### 5.5 残留 seq2
H=null/A=null/E2..E9 任一：9 IDs 失败 → BROKEN；不写 E1/head/anchor/fence/domain；不改名/adopt/删除；旧 writer 无 admission 被拒；head seq2 且 E1 缺 → 完整链失败；迁移发现不补 anchor/proof；保持关闭。

## 6. 矩阵
| 类别 | 判定 | 结果 |
|---|---|---|
| canonical empty | K3+Coverage+Fence+precheck+head/anchor/9 空 | 首条成功 |
| canonical chain | anchor/head/1..N valid，>N null | 追加成功 |
| head/seq1 丢失 E2 残留 | 9 IDs | BROKEN |
| E2..E9 任意 | 9 IDs | BROKEN |
| anchor/head 不配 | anchor | BROKEN |
| 祖先缺失/后孤儿 | 完整链/>N | BROKEN/CONFLICT |
| head seq0 | 不变量 | BROKEN |
| 旧 writer | gate 无 ticket | ADMISSION |
| coverage 失效 | proof | PROOF |
| fence halted/缺失/epoch | fence | HALTED |
| gate/monitor 异常 | 自检/monitor | 不就绪/HALTED |
| domain 无 bootstrap | gate | K3_BOOTSTRAP_DENIED |
| legacy L1 3fce9b0 domain | K3 | DOMAIN_INCOMPLETE |
| legacy L2 无 anchor | anchor | BROKEN；待迁移 |
| legacy L3 非规范/旧 schema | audit+gate+fence | 无 proof→PROOF；有 proof+gate/fence 才 canonical |
| legacy L4 LocalStore 缺数组 | 无 proof | PROOF |
| legacy L5 不可补齐 | 迁移 abort | 永久 PROOF |
| K3 失效 | K3 | DOMAIN |
| audit 失效 | Coverage | PROOF |
| fence 失效 | Fence | HALTED |
| halt 恢复 | recoveryPlan | CLEAR(E+1)/HALTED |

## 7. refs / writes 预算（v4 历史；v5 §15.4 覆盖）

### 7.1 C1 helper
| 事务 | refs | writes |
|---|---:|---|
| 首条 | K3 2、audit、fence、anchor、head、E1..9 = **15** | anchor+E+head=3 |
| 非首条 | 同上 | E+head=2 |

### 7.2 C2 R1
| ref | 数量 |
|---|---:|
| org/membership/job/grant | 4 |
| head/anchor/audit/fence | 4 |
| E1..9 | 9 |
| K3 domain 2 | 2 |
| op key/op domain 3 | 3 |
| log/admin audit 2 | 2 |
| **合计** | **24** |

C2 R1 finalWriteSet 含 job/evidence/head/anchor/log/op/domain/唯一 admin_audit；0 grant/slot/claim/device/domain/fence；R2 ≤90。

### 7.3 迁移/控制
| 事务 | refs | writes |
|---|---:|---|
| migration-anchor | K3 2+fence1+head1+E9+anchor1+audit1 = **15** | anchor+audit=2 |
| migration-finalize | K3 2+fence1+proof1+audit1 = **5** | fence+proof+audit=3 |
| recovery-finalize | K3 2+fence1+proof1+audit1 = **5** | fence+proof+audit=3 |
| monitor halt | K3 2+proof1+fence1+audit1 = **5** | fence+audit=2 |
| k3-bootstrap | domain2+fence1+audit1 = **4** | head+version+audit=3 |

### 7.4 上限
C1 15；C2 24；migration 15/5；recovery 5；monitor 5；k3 4；R2 ≤90；C2 R1 距 90 余 66；admission/plan/ticket 0 新增 refs；所有 refs 去重。

## 8. 并发、迁移切换、停写/恢复

### 8.1 链竞争
两首条 anchor create-only 一胜；两非首条 head CAS；旧 writer ADMISSION；fence halt 后 append HALTED；Cloud 冲突回滚；K3 换钥 proof/fence 失效。

### 8.2 迁移切换
P0 停旧 writer/撤凭证/冻结；P1 gate closed+migration；P2 prePlan；P3 anchor（pre-fence）；P3.5 final inventory；P4 finalize clear fence+proof+audit；P5 runtime；P6 monitor。gate 先于 proof；fence+proof+audit 原子；不得先 proof 后 gate/fence。

### 8.3 halt 恢复
CLEAR(E0)→HALTED(E0) by monitor；HALTED(E0)→CLEAR(E1) by recovery；无 active fence 前置；两 recovery 一胜；monitor halt 需 observedEpoch，旧 E0 halt 在 E1 后拒绝；runtime 在 HALTED 停；recovery 失败保持 HALTED；K3 变化 recovery DOMAIN 先失败。

### 8.4 旧 writer/回滚
旧 C1 无 admission；旧 Store/直连 DB 由 P0/DB 权限/monitor；回滚不恢复旧 writer；新 epoch 重审；旧 proof/fence 不删；两 migration 幂等/一 proof。

## 9. 失败零写

### 9.1 规则
proof/fence/admission/chain/audit 生成在写前；build 抛错不持久化；gate 终检 finalWriteSet/digest/fence；migration finalize/recovery 的 proof+fence+audit 同事务；负向全库快照（6 集合+C2）；迁移失败不修复。

### 9.2 矩阵
`Z_all`=domain/evidence/head/anchor/audit/fence+C2 各集合零；`Z_chain`=chain 关键零，仅 anchor 可部分。

| ID | 失败 | 结果 | 范围 |
|---|---|---|---|
| F01 K3 config/domain | DOMAIN | Z_all |
| F02 proof 缺失/HMAC/绑定/status/legacy/覆盖 | PROOF | Z_all |
| F03 head=null+E2..9 | BROKEN | Z_all |
| F04 anchor/head/链/孤儿 | BROKEN/CONFLICT | Z_all |
| F05 CAS/并发 loser | HEAD_CONFLICT | Z_all |
| F06 首条 loser | BROKEN | Z_all |
| F07 旧 writer/epoch/policy/ticket | ADMISSION | Z_all |
| F08 fence halted/缺失/epoch | HALTED | Z_all |
| F09 gate 缺失/版本 | 不就绪 | Z_all |
| F10 形状违规/domain/audit proof | ADMISSION/BROKEN | Z_all |
| F11 Cloud 冲突 | 回滚 | Z_all |
| F12 monitor 发现未知 | HALTED | Z_all（后续） |
| F13 K3 变化 | DOMAIN/PROOF/HALTED | Z_all |
| F14 迁移扫描不可补齐 | 不写 proof | Z_chain |
| F15 finalize 失败 | 无 fence/proof/audit | Z_chain |
| F16 inventory >20k | CAPACITY | Z_chain |
| F17 plan 缺失/不符 | ADMISSION | Z_chain/Z_all |
| F18 domain 无 bootstrap | K3_BOOTSTRAP_DENIED | Z_all |
| F19 recovery 失败 | 保持 HALTED；无 proof/fence/audit | Z_all |
| F20 recovery 无 active fence 要求 | 允许；失败零写 | Z_all |
| F21 audit 注入/双审计 | ADMISSION；回滚 | Z_all |

`Z_chain` 迁移例外：anchor 可部分 create-only，runtime 关闭；若要求全零需 staging（Q27）。

## 10. v3→v4 差异
| 项 | v3 | v4 |
|---|---|---|
| halt 恢复 | monitor clear 需新 proof，缺独立授权 | recoveryPlan/recoveryTicket 独立；proof+fence+audit 原子；无 active fence 前置 |
| bootstrap | fence 检查但 refs 2/writes 2 | fence+audit 纳入 refs 4/writes 3；无 fence 才允许 |
| final ticket/audit | writes 未含 Store 自动 audit | finalWriteSet 先物化（业务+唯一 audit）；ticket 覆盖；Store explicit；无双审计 |
| refs | v3：C1 15/C2 24/migration 14/4/monitor 4/k3 2 | v4：C1 15/C2 24/migration 15/5/recovery 5/monitor 5/k3 4 |
| 错误码 | 无 recovery 区分 | HALTED/ADMISSION/PROOF；Q25/Q26 |
| 矩阵 | N01–N70 | N01–N96（v5 §15.6 增 N81–N96） |

## 11. 待 Codex 裁定 Q1–Q27（v4 历史；v5 §15.6 增 Q28–Q31）
| Q | 事项 | 建议 |
|---|---|---|
| Q1 | anchor/audit/fence 三集合、Store 注册/exact/create-only | 批准 |
| Q2 | audit proof HMAC/K3、migration/recovery 写 | 批准 |
| Q3 | legacy L2 anchor、L1/L3 abort | 批准 |
| Q4 | 完整链校验 | 采用 |
| Q5 | C1 15/C2 24/migration 15/5/recovery 5/monitor 5/k3 4 | 批准 |
| Q6 | 两阶段 precheck/final ticket/writesDigest | 批准 |
| Q7 | domain gate + k3-bootstrap（fence refs 4/writes 3） | 批准 |
| Q8 | Store.change/persist/seed/init | 批准 |
| Q9 | prePlan/finalPlan | 批准 |
| Q10 | fence/global halt scope | 批准 |
| Q11 | digest canonical/NFC/recordDigest | 批准 |
| Q12 | 20k export/CAPACITY | 批准 |
| Q13 | final inventory 时点 | 批准 |
| Q14 | 错误码分层/C2 映射 | 批准 |
| Q15 | halt 状态机/恢复独立授权 | 批准 |
| Q16 | bootstrap fence 读集合/无 fence 规则 | 批准 |
| Q17 | C2 R1 24 | 批准 |
| Q18 | precheck 非权威/final ticket 权威 | 批准 |
| Q19 | migration/recovery plan 持久化/验签 | 裁定 |
| Q20 | monitor 不可用健康策略 | 裁定 |
| Q21 | fence 初始 clear 与 proof 同事务 | 批准 |
| Q22 | C2 错误投影 | 裁定 |
| Q23 | persist 私有/静态扫描 | 批准 |
| Q24 | inventoryDigest recordDigest | 批准 |
| Q25 | recovery 失败零写/无 active fence 前置 | 批准 |
| Q26 | finalWriteSet + 唯一 audit + Store explicit 边界 | 批准 |
| Q27 | 控制事务 audit 预算（migration/recovery/monitor/k3） | 批准 |

## 12. 防御性矩阵 N01–N80（v4 历史；预算 N26/N48/N66 按 v5；N81–N96 见 §15.6）
> 设计矩阵，不执行；Z/X 同前；无 HTTP/外部网络。
| ID | 场景 | 期望 |
|---|---|---|
| N01 | K3+Coverage+Fence+precheck+head/anchor/9 IDs 空 | 首条成功 | X |
| N02 | head/anchor null + E2 canonical + no boolean | BROKEN；不建链 | Z |
| N03 | E2..E9 残留 | BROKEN | Z |
| N04 | E1 存在 | BROKEN | Z |
| N05 | anchor 存在/head 空 | BROKEN | Z |
| N06 | proof 缺失 | PROOF_REQUIRED | Z |
| N07 | proof HMAC/字段/status/legacyCount 非法 | PROOF_REQUIRED | Z |
| N08 | K3 domain 缺失/损坏 | DOMAIN_INCOMPLETE | Z |
| N09 | K3 realm/version/fingerprint 变化 | DOMAIN_MISMATCH | Z |
| N10 | canonical chain 追加 | 成功；只写 E+head+audit | X |
| N11 | head seq2/E1 缺 | BROKEN | Z |
| N12 | head seq1/E3 孤儿 | BROKEN/CONFLICT | Z |
| N13 | head/evidence 存在/anchor 缺 | BROKEN | Z |
| N14 | anchor 字段/ID 错 | BROKEN | Z |
| N15 | anchor firstEvidence/created 错 | BROKEN | Z |
| N16 | proof domain/key/revision 不符 | PROOF_REQUIRED | Z |
| N17 | 两首条并发 | 一胜；另一 BROKEN | X/Z |
| N18 | 两非首条并发 | 一胜；HEAD_CONFLICT | X/Z |
| N19 | 首链 anchor 冲突 | 回滚 | Z |
| N20 | E1/head 写冲突 | 回滚 | Z |
| N21 | 迁移非规范/缺 head | 不写 proof；PROOF | Z_chain |
| N22 | legacy L1 3fce9b0 domain | DOMAIN_INCOMPLETE | Z |
| N23 | LocalStore 缺数组 | 无 proof → PROOF | Z |
| N24 | 迁移 anchor 未补齐 | BROKEN | Z |
| N25 | K3 换钥旧 proof | PROOF_REQUIRED | Z |
| N26 | C1 15/C2 24/R2≤90 | 不超限 | X |
| N27 | 生产树静态扫描 | 无 boolean/无未授权 audit/domain/change 写 | Z |
| N28 | anchor/audit/fence 未知字段 | validator 拒绝 | Z |
| N29 | head seq9 再 append | EVIDENCE_INVALID | Z |
| N30 | 旧 domain revision proof | PROOF_REQUIRED | Z |
| N31 | expectedHead 过期 | HEAD_CONFLICT | Z |
| N32 | Cloud 写冲突 | 回滚 | Z/X |
| N33 | 旧 C1 无 admission | ADMISSION | Z |
| N34 | epoch/policy/proof/ticket 错 | ADMISSION | Z |
| N35 | writerSet/collections 不符 | PROOF_REQUIRED | Z |
| N36 | proof 删除/HMAC 篡改 | PROOF_REQUIRED；已有链也停 | Z |
| N37 | K3 换钥旧 epoch | PROOF/HALTED | Z |
| N38 | gate 缺失/禁用 | 不就绪 | Z |
| N39 | 迁移冻结旧 writer | ADMISSION | Z |
| N40 | 两 migration finalize | 一胜；anchor 幂等 | X/Z |
| N41 | anchor 后 proof 失败 | 无 proof；PROOF | Z_chain |
| N42 | E2 残留 + 旧 writer | BROKEN/ADMISSION | Z |
| N43 | 形状违规/domain/audit proof 写 | ADMISSION/BROKEN | Z |
| N44 | 新 epoch 后旧 epoch | ADMISSION | Z/X |
| N45 | monitor 未知 ID | HALTED | Z |
| N46 | K3 无效但 proof 看似有效 | DOMAIN 优先 | Z |
| N47 | proof 字段/collections 非法 | PROOF_REQUIRED | Z |
| N48 | C2 24 + admission 0 refs | 不超限 | X |
| N49 | precheck 无 digest→final ticket 后 mint | 无循环 |
| N50 | writesDigest 篡改/追加写 | ADMISSION |
| N51 | runtime/migration/recovery 写 domain | K3_BOOTSTRAP_DENIED |
| N52 | k3-bootstrap 读 fence 缺失；精确 head/version+audit；部分/已存在/fence | 成功或拒绝 |
| N53 | change H4-c | ADMISSION |
| N54 | seed/init 非空/persist 直调 | 拒绝 |
| N55 | prePlan 缺失/签名错 | anchor 拒绝 |
| N56 | targetProofId/epoch/policy 不符 | ADMISSION |
| N57 | finalPlan/inventory/counts 不符 | finalize 拒绝 |
| N58 | >20k 无 export | CAPACITY |
| N59 | final inventory 时点 anchor 后 proof 前 | 一致 |
| N60 | monitor halt | 全局 H4-c HALTED |
| N61 | fence 缺失/损坏/epoch | HALTED |
| N62 | monitor 不 clear | 只能 recovery |
| N63 | halt 全局 6 集合 | 全停/读可 |
| N64 | digest canonical/NFC/recordDigest | 规范 |
| N65 | 错误码映射 | 分层正确 |
| N66 | C1 15/C2 24/migration 15/5/recovery 5/monitor 5/k3 4 | ≤90 |
| N67 | C2 追加 job/log 后 final ticket | 覆盖 |
| N68 | k3-bootstrap 无 audit proof | 成功；之后需 audit |
| N69 | halted 仅 fence+audit 可写 | 其他拒 |
| N70 | finalize fence+proof+audit 原子失败 | 不写 |
| N71 | HALTED(E0)+recoveryPlan 有效 | CLEAR(E1)+proof+audit 原子 |
| N72 | recoveryPlan 缺失/签名错/fence 非 halted/epoch 不符 | HALTED；零写 |
| N73 | 两 recovery 同 epoch 并发 | 一胜；无双重 proof/fence |
| N74 | monitor halt E0 与 recovery E1 并发 | 旧 halt 拒绝；可 re-halt E1 |
| N75 | recovery 成功后 runtime | 正常 E1 |
| N76 | recovery 失败/审计失败 | 保持 HALTED；无 proof/fence/audit |
| N77 | finalWriteSet 含唯一 audit；ticket 覆盖 | 成功；无双审计 |
| N78 | Store 尝试追加/修改 audit | ADMISSION；回滚 |
| N79 | k3-bootstrap fence 读集合/refs 4/writes 3 | 无 fence 成功；fence 存在拒绝 |
| N80 | 控制事务 audit 预算/无双审计 | 通过；≤90 |

## 13. 迁移/恢复/交付边界
### 13.1 migration
P0 停旧 writer/撤凭证/冻结；P1 gate+migration；P2 prePlan；P3 anchor（pre-fence）；P3.5 final inventory；P4 finalize clear fence+proof+audit；P5 runtime；P6 monitor。>20k 无 export 停；不初始化 K3（除 k3-bootstrap 卡）；不改 evidence/head；不修复 legacy；不恢复旧 writer。
### 13.2 recovery
HALTED(E0) → recoveryPlan/recoveryTicket → atomic proof(E1)+clear fence(E1)+audit → CLEAR(E1)；失败保持 HALTED；monitor 不 clear；不允许无 proof clear；并发按 §8.3。
### 13.3 交付
只交设计卡；不新增代码/测试/Store/迁移脚本；不改输入分支；不合并/push 共享主线；不注册 HTTP/UI；不调用 Provider/设备/生产云；C2/C3/G4 冻结；G3 `5f1d7a4`/O10 PASS 不重复派发。

## 14. 验收/停止
Codex 批准后另发 C1 实现卡；至少含：
1. 三集合 schema/Store gate 全路径/change/persist/seed/init；
2. K3+Coverage+Fence+two-phase admission+anchor+9 IDs+完整链；
3. finalWriteSet+唯一 audit+explicit mode+no double audit；
4. recovery 状态机/独立授权/原子 proof+fence+audit；
5. v5：C1 16/C2 25/migration 17/7/recovery 7/monitor 5/k3 5/plan 2 ≤90；
6. N01–N96 实现级测试（N01–N80 沿用 v4；N81–N96 见 §15.6；无 HTTP/外部网络）；
7. 迁移/恢复/fence/monitor/K3 bootstrap 工具另立卡。

本卡停止；等 Codex 复审 §15.6（Q28–Q31）及 §11；不进入 C1/C2/C3/G4。

## 15. v5 权威修订（覆盖 v4 冲突处）

> v5 输入：`3ac5cf9483caebcaf8f5aeb1df8fd4aca9bfb13f`（父 `575d8b6`）。v4 正文保留作历史；**凡 v4 与 §15 冲突（schema、refs、预算、Q/N、状态机、monitor/fence、plan、bootstrap）以 §15 为准。**
>
> 完整云报告 `/workspace/artifacts/DEL-AI-01-CONTENT-REVIEW-2026-11-18/REVIEW.md` 未提供可读正文。已检查 `/workspace/...`、`C:\workspace\...`、`\\wsl$\workspace\...` 及本仓库 `REVIEW.md` 搜索，均不可读/不存在；**不声称已逐项关闭该报告**。本稿只依据本轮消息裁定，未列明项列待裁。

### 15.1 K3 marker、维护窗口、旧 writer 撤权与 fencing

#### 15.1.1 fence 身份统一（唯一公式/查找 ID）

- 常量：`EVIDENCE_CHAIN_FENCE_ID = "evidence-chain-fence:v1:global"`。
- 所有层（bootstrap、migration、recovery、monitor、runtime、Store gate）**只用该字面 ID 查找**；不得从 epoch/realm/runId 重新计算 fence ID。
- fence schema（12 字段，v5 增加健康字段）：
  `_id, kind, scope, schemaVersion, status, epoch, reasonCode, monitorId, heartbeatAt, validUntil, updatedAt, fenceDigest`
  - `_id = EVIDENCE_CHAIN_FENCE_ID`；`kind="fence"`、`scope="global"`、`schemaVersion=1`。
  - `status ∈ {"clear","halted"}`；`epoch` 必须等于当前 CoverageValid proof 的 `writeEpoch`。
  - `heartbeatAt/validUntil` 为安全整数；`validUntil > heartbeatAt`；`validUntil - heartbeatAt ≤ MONITOR_HEALTH_WINDOW_MS`。
  - `fenceDigest` = K3 HMAC-SHA256，domain `KEYED_DIGEST/h4-evidence-chain-fence` v1，覆盖除自身外全部字段。
- 初始 clear fence 与首个 proof 在 migration-finalize 同事务创建；bootstrap 阶段 fence 必须不存在；halt 仅 monitor 写；clear 仅 recovery-finalize 写。

#### 15.1.2 K3 marker schema（21 字段）

`_id = "evidence-chain-k3-marker:v1:global"`；字段：
`_id, kind, scope, schemaVersion, fenceId, k3DomainHeadId, k3DomainVersionId, k3DomainHeadRevision, realm, keyVersion, keyFingerprint, bootstrapRunId, maintenanceId, maintenanceManifestDigest, windowStart, windowEnd, writerSetDigest, revokedWriterSetDigest, revocationReceiptDigest, createdAt, markerDigest`。

- `kind="k3-marker"`、`scope="global"`、`schemaVersion=1`；`fenceId` 固定等于 `EVIDENCE_CHAIN_FENCE_ID`。
- `k3DomainHeadId/VersionId/HeadRevision` 必须与当前 K3 domain 完全一致；`realm/keyVersion/keyFingerprint` 与 K3 config 一致。
- `maintenanceId/maintenanceManifestDigest/windowStart/windowEnd` 来自签名 maintenance manifest；`windowStart ≤ createdAt ≤ windowEnd`。
- `writerSetDigest` = 允许的新 writer 清单摘要；`revokedWriterSetDigest` = 已撤销旧 writer 清单摘要；`revocationReceiptDigest` = 撤权回执摘要。
- `markerDigest` = K3 HMAC-SHA256，domain `KEYED_DIGEST/h4-evidence-k3-marker` v1，覆盖除自身外全部字段。
- create-only；仅 `k3-bootstrap` 事务创建；不更新/删除。

**maintenance manifest（离线签名对象，保存于维护报告）**：
`maintenanceId, windowStart, windowEnd, oldWriterSetDigest, newWriterSetDigest, revokedWriterSetDigest, revocationReceiptDigest, bootstrapRunId, authorizedAt, expiresAt, maintenanceTicket`。
`maintenanceTicket` = K3 HMAC-SHA256，domain `KEYED_DIGEST/h4-maintenance-manifest` v1；manifest 正文/签名与撤权回执作为维护证据保存；marker 绑定 `maintenanceManifestDigest`。

#### 15.1.3 K3 bootstrap 读集合/refs/writes（统一）

- 触发条件：`BOOTSTRAP` 状态（无 domain/marker/fence/proof），且 `now ∈ [windowStart,windowEnd]`，maintenance manifest/ticket 有效，旧 writer 撤权回执摘要匹配。
- **读集合（refs 5）**：domain fixed head、domain version、`EVIDENCE_CHAIN_FENCE_ID`、`k3-marker:v1:global`、`admin_audit/<auditId>`。
- **写集合（writes 4）**：domain head、domain version、K3 marker、唯一 explicit admin_audit；H4-c 子集恰好 head+version+marker，不得写 evidence/head/anchor/audit proof/fence。
- gate 校验：fence 必须不存在（存在任意状态 → `K3_BOOTSTRAP_DENIED`）；marker 必须不存在；domain head/version 必须都不存在（部分 → `DOMAIN_INCOMPLETE`/denied）；maintenance window 当前；旧 writer 撤权摘要有效；无 proof 要求。
- 旧 `initializeEvidenceDomain`（90e4189）无 k3-bootstrap admission → 拒绝；K3 轮换不是 bootstrap，domain 已存在时禁止。
- `k3BootstrapTicket` + maintenance manifest ticket + final ticket 覆盖 finalWriteSet（domain2+marker+audit）；Store gate 逐字节校验。

#### 15.1.4 K3 marker 运行时验证与 audit proof 绑定

- C1/C2 runtime 读 marker ref；`K3MarkerValid` 校验 exact 21 字段、markerDigest HMAC、fenceId 常量、K3 domain ID/revision/realm/version/fingerprint、window 字段完整、writer/revocation digests 格式。
- audit proof 增至 **23 字段**：v4 22 字段 + `k3MarkerDigest`；`k3MarkerDigest` 必须等于 marker.markerDigest。runtime `CoverageValid` 同时校验 proof 的 `k3MarkerDigest` 与 marker 当前摘要；缺失/不匹配 → `PROOF_REQUIRED`。
- marker 缺失/损坏/epoch/K3 不匹配 → `PROOF_REQUIRED`/`HALTED`；不得 fallback 到仅 audit proof。
- marker 是 K3 启动/维护/撤权的可验证凭证；audit proof 不能脱离 marker 单独成立。

#### 15.1.5 可验证维护流程（bootstrap → fence → audit → runtime）

| 阶段 | 动作 | 可验证证据 |
|---|---|---|
| M0 | 冻结流量；停止旧 C1/legacy 进程/脚本；撤销旧 DB 凭证/权限 | 维护窗口 manifest（含 oldWriterSetDigest、revocationReceiptDigest）；撤权回执 |
| M1 | 部署 gate（closed）+ migration/k3-bootstrap admission | gate 版本、policy/epoch；旧 writer 无 admission |
| M2 | 若 K3 domain 不存在：k3-bootstrap 写 domain+marker+audit | marker 绑定 manifest/window/fenceId/K3 domain；refs 5/writes 4 |
| M3 | 生成 prePlan/finalPlan/plan 记录；anchor 补齐；final inventory | plan 记录签名/状态；inventory digest/counts |
| M4 | migration-finalize 原子写 clear fence（含健康字段）+ audit proof（含 k3MarkerDigest）+ plan consumed + audit | fence/proof/plan/audit 同事务；refs 7/writes 4 |
| M5 | 启动 runtime，校验 K3MarkerValid/CoverageValid/FenceValid/gate | 失败不就绪；旧 writer 仍被 gate 拒绝 |
| M6 | monitor heartbeat/halt；异常 halt | fence 健康字段/心跳；事务内停写 |

- 旧 writer 停写/撤权是 **运维+DB 权限+gate** 的组合：manifest 的 revokedWriterSetDigest/revocationReceiptDigest 由部署方签名，marker 绑定；应用不能验证真实 DB 凭证撤销，残余直连 DB 由权限/inventory/monitor 兜底，明确为已知边界。
- 维护窗口过期（`now > windowEnd`）→ `MAINTENANCE_WINDOW_EXPIRED/409`，所有 bootstrap/plan/finalize 零写；需重新签发 manifest/plan，不得延长旧 marker。
- fencing 顺序：bootstrap 前 fence 缺失；finalize 创建 clear fence；monitor 可 halt；recovery 才 clear；fence ID 全层固定。

### 15.2 plan 签名保存、验证/绑定/轮换/防重放

#### 15.2.1 plan 记录 schema（23 字段）

集合 `evidence_chain_plans`；`_id = "evidence-chain-plan:v1:<planKind>:<runId>:<phase>"`；字段：
`_id, kind, scope, schemaVersion, planKind, phase, runId, windowStart, windowEnd, targetWriteEpoch, targetAdmissionPolicyVersion, targetWriterSetDigest, targetProofId, finalInventoryDigest, canonicalEvidenceCount, canonicalHeadCount, anchorCount, auditedCollections, issuedAt, status, keyFingerprint, planDigest, planTicket`。

- `kind="plan"`、`scope="global"`、`schemaVersion=1`；`planKind ∈ {"migration","recovery"}`；`phase ∈ {"pre-anchor","final","recovery"}`。
- `windowStart ≤ issuedAt < windowEnd`；plan 仅在该窗口有效；`status ∈ {"active","consumed","revoked"}`。
- `targetWriteEpoch`/`targetAdmissionPolicyVersion`/`targetWriterSetDigest`/`targetProofId` 冻结目标；`targetProofId` 由 K3 fp+domainHeadRevision+targetEpoch 确定性计算。
- `finalInventoryDigest/counts/auditedCollections` 为 final inventory 摘要；pre-anchor plan 以 `null/0` 占位，final/recovery plan 必须非空（Q29）。
- `keyFingerprint` 绑定签发 K3 key；`planDigest` = SHA-256 canonical plan（除 planDigest/planTicket）；`planTicket` = K3 HMAC-SHA256，domain `KEYED_DIGEST/h4-evidence-plan` v1。
- 集合 exact/create-only；status 仅 consumed/revoked 精确更新；plan 记录是签名的持久化，不依赖调用方内存对象。

#### 15.2.2 签发/验证/绑定

- `plan-issue` admission：kind=plan，operation=plan-issue；refs `plan`+`admin_audit` = **2**；writes plan+audit=2；maintenance/recovery window 有效；无同 ID plan。
- migration-anchor/finalize/recovery 读 plan ref；gate 校验 exact schema、planDigest/ticket、status=active、`now ∈ window`、keyFingerprint=当前 K3、target 字段与 marker/fence/proof/inventory 一致。
- **绑定**：plan 的 targetProofId/epoch/policy/writerSet/collections 必须与 marker/audit proof 一致；migration-finalize 把 plan 与 fence/proof 同事务；recovery-finalize 把 recovery plan 与新 proof/fence 同事务。
- **轮换**：plan 绑定 `keyFingerprint`；K3 换钥后旧 plan 不再有效，必须为新 key 重新签发；不提供历史 key 回退；旧 plan 标记 revoked/expired，不得复用。
- **防重放**：
  - plan `_id` 含 runId/phase，create-only；`status=active` 才可使用。
  - finalize/recovery 在同一事务把 plan 置 `consumed`；已 consumed 的 plan 再用于 anchor/finalize/recovery → `PLAN_CONSUMED/409`。
  - window 外 → `PLAN_EXPIRED/409`；revoked → `PLAN_REVOKED/409`。
  - targetProofId 已存在 → `PLAN_CONSUMED`/`CONFLICT`；不得生成第二 proof。
  - 两 migration/recovery 同 plan 并发：plan status/proof create-only 一胜；失败方零写。
- `plan-revoke` admission：refs 2/writes 2；只允许 active→revoked；revoked plan 不可恢复。
- plan 记录/签名持久化解决“plan 只存在离线对象”的不可验证问题；Codex 可读取 plan 记录/摘要。

### 15.3 monitor 健康期限、时钟与事务内权威停写

- fence 12 字段（§15.1.1）；健康常量（建议，Q30）：`MONITOR_HEALTH_WINDOW_MS = 300_000`、`CLOCK_SKEW_MS = 30_000`。
- 初始/恢复 clear fence 由 migration-finalize / recovery-finalize 设置 `heartbeatAt = proof.checkedAt`、`validUntil = heartbeatAt + MONITOR_HEALTH_WINDOW_MS`；否则 FenceValid 失败 → HALTED。
- `FenceValid(now)`：
  ```text
  status="clear" ∧ epoch=proof.writeEpoch ∧ fenceDigest HMAC
  ∧ heartbeatAt/validUntil 安全整数 ∧ validUntil>heartbeatAt
  ∧ validUntil-heartbeatAt ≤ MONITOR_HEALTH_WINDOW_MS
  ∧ now ≥ heartbeatAt - CLOCK_SKEW_MS
  ∧ now ≤ validUntil
  ∧ monitorId 有效
  ```
  任一失败/过期 → `EVIDENCE_CHAIN_HALTED/409`，在事务内构造写之前返回；Store gate 写阶段复查 state[fence]。
- monitor 操作（均 fence+唯一 audit，refs 5）：
  - `fence-heartbeat`：status clear；proof/fence epoch 有效；更新 heartbeatAt=now、validUntil=now+window，audit；**允许在健康已过期时刷新**（否则无法从超时恢复），但不得越过 proof/coverage。
  - `fence-halt`：status halted，reasonCode/monitorId/updatedAt；heartbeat/validUntil 保留；不依赖 proof 有效；audit。
  - `fence-clear`：**不允许 monitor**；仅 recovery-finalize 新 epoch proof 原子写 clear。
- 时钟：`now` 由受信服务提供且安全整数；若 `now < heartbeatAt - skew`（回拨/未来心跳）或 `now > validUntil`（过期）或窗口超上限 → HALTED；不得用非法时钟继续。
- 事务内权威停写：runtime/Store gate 在 **读 fence 后、构造 finalWriteSet 前**判断 `FenceValid(now)`；过期/时钟异常立即 HALTED；gate 在写阶段用 state[fence] 复查；在途事务若已过 gate 且 fence 在提交前变 halted/expired，按 Store 事务冲突/下一事务停写；monitor 同时停流量。
- 状态：`CLEAR_HEALTHY(E)`、`CLEAR_EXPIRED(E)`（fence status 仍 clear 但 runtime 视为停写）、`HALTED(E)`、`RECOVERY`；heartbeat 可 CLEAR_EXPIRED→CLEAR_HEALTHY；monitor halt → HALTED；recovery → CLEAR_HEALTHY(E1)。

### 15.4 v5 预算/schema/refs（覆盖 v4 §7）

| 事务 | refs | writes |
|---|---:|---|
| C1 首条/非首条 | domain2 + audit1 + fence1 + marker1 + anchor1 + head1 + E1..9 = **16** | 3 / 2 |
| C2 R1 | C1 16 + org/member/job/grant4 + op key/opdomain3 + log/admin audit2 = **25** | job/evidence/head/anchor/log/op/domain/audit |
| migration-anchor | domain2+fence1+marker1+plan1+head1+E9+anchor1+audit1 = **17** | anchor+audit |
| migration-finalize | domain2+fence1+marker1+plan1+proof1+audit1 = **7** | fence+proof+plan+audit |
| recovery-finalize | domain2+fence1+marker1+plan1+proof1+audit1 = **7** | fence+proof+plan+audit |
| monitor heartbeat/halt | domain2+proof1+fence1+audit1 = **5** | fence+audit |
| k3-bootstrap | domain2+fence1+marker1+audit1 = **5** | domain2+marker+audit |
| plan-issue/revoke | plan1+audit1 = **2** | plan+audit |
| C2 R2 | H4-b 8+N≤90 | 独立事务 |

- C2 R1 25 距 90 余 65；所有 refs 去重；admission/plan ticket 0 新增 refs。
- 8 个 H4-c 集合：evidence/head/domains/anchor/audit/fence/k3-markers/plans；Store gate 全部覆盖。

### 15.5 状态机、并发、失败零写（v5 增量）

**状态**：
`BOOTSTRAP（无 domain/marker/fence/proof） → UNPROVEN（domain+marker，无 proof/fence） → PLAN_ACTIVE → CLEAR_HEALTHY(E)/CLEAR_EXPIRED(E) → HALTED(E) → RECOVERY → CLEAR_HEALTHY(E1)`。

- K3 marker 缺失/无效：UNPROVEN 前不可 runtime；audit 前不可 runtime。
- plan active 仅 migration；finalize 后 consumed；recovery plan 仅 HALTED。
- monitor halt 只能 CLEAR→HALTED；heartbeat 只能 clear→healthy（含过期恢复）；recovery 才能 HALTED→clear。
- K3 换钥：marker/proof/fence/plan 全部失效；重新维护/审计，不复用旧对象。

**并发**：
| 竞争 | 结果 |
|---|---|
| 两 k3-bootstrap | domain/marker create-only 一胜 |
| 两 plan-issue 同 ID | create-only 一胜；另一 409 |
| 两 migration/anchor 同 plan | plan active；anchor 幂等；finalize 一胜 |
| plan 重放（consumed/expired/revoked） | PLAN_CONSUMED/PLAN_EXPIRED/PLAN_REVOKED；零写 |
| 两 recovery 同 HALTED(E) | plan/proof create-only 一胜；无双 fence/proof |
| monitor heartbeat vs halt | fence exact/epoch；halt 后 heartbeat 拒绝；clear 后旧 halt 需 observedEpoch |
| health 过期 vs append | 事务内 FenceValid 失败 HALTED；gate 复查 |
| clock 回拨/未来 | HALTED；不得继续 |
| K3 换钥 vs marker/plan | DOMAIN/PROOF/HALTED；零写 |

**失败零写增量**：
| ID | 失败 | 结果 | 范围 |
|---|---|---|---|
| F22 | K3 marker 缺失/字段/HMAC/绑定错 | PROOF_REQUIRED/HALTED | Z_all |
| F23 | maintenance window 过期 | MAINTENANCE_WINDOW_EXPIRED | Z_all |
| F24 | 旧 writer 撤权摘要缺失/不匹配 | MAINTENANCE_MANIFEST_INVALID | Z_all |
| F25 | plan 缺失/签名/字段/window 错 | PLAN_INVALID | Z_all/Z_chain |
| F26 | plan consumed/expired/revoked 重放 | PLAN_CONSUMED/PLAN_EXPIRED/PLAN_REVOKED | Z_all |
| F27 | plan keyFingerprint/K3 轮换不符 | PLAN_INVALID | Z_all |
| F28 | monitor health 过期 | HALTED | Z_all |
| F29 | clock 回拨/未来/非法 | HALTED | Z_all |
| F30 | heartbeat 写入失败/并发 | HALTED/回滚 | Z_all |
| F31 | audit finalWriteSet 注入/双审计 | ADMISSION | Z_all |
| F32 | fence ID/schema/查找 ID 不一致 | HALTED/PROOF | Z_all |

### 15.6 v5 裁定与矩阵

**新增 Q28–Q31**：
| Q | 事项 | 建议 |
|---|---|---|
| Q28 | K3 marker/maintenance manifest/fence ID/schema/refs/writes（5/4） | 批准 |
| Q29 | plan 记录持久化、签名/绑定/轮换/防重放/plan-issue 2 refs | 批准 |
| Q30 | monitor 健康窗口 300s、时钟偏差 30s、heartbeat/halt/clear 权限 | 批准 |
| Q31 | v5 预算 C1 16/C2 25/migration 17/7/recovery 7/monitor 5/k3 5/plan 2 | 批准 |

v5 对 v4 Q5/Q7/Q10/Q17/Q26/Q27 的预算/scope 更新：
- Q5：C1 16/C2 25/migration 17/7/recovery 7/monitor 5/k3 5/plan issue 2；
- Q7：k3-bootstrap 5 refs/4 writes（domain2+fence+marker+audit）；
- Q17：C2 R1 25；
- Q26/Q27：finalWriteSet/audit 覆盖 marker/plan/fence 控制事务；
- Q10：全局 halt 范围含 8 集合；health 过期同样停写。

**新增 N81–N96**（N01–N80 保留 v4 逐项矩阵；其预算行 N26/N48/N66 按 v5 替换）：
| ID | 场景 | 期望 |
|---|---|---|
| N81 | K3 marker 21 字段/HMAC/fenceId/K3 绑定；C1 16 refs | 通过/拒绝 |
| N82 | maintenance window 过期 bootstrap/plan/finalize | MAINTENANCE_WINDOW_EXPIRED；零写 |
| N83 | 旧 writer 撤权摘要缺失/不匹配 | MAINTENANCE_MANIFEST_INVALID；拒绝 |
| N84 | plan-issue 2 refs/writes、签名/digest/目标字段 | 通过 |
| N85 | plan consumed/expired/revoked 重放 | PLAN_*；零写 |
| N86 | K3 换钥/plan keyFingerprint/旧 marker | PLAN_INVALID/PROOF；零写 |
| N87 | monitor heartbeat 刷新健康/审计 | 成功；fence+audit |
| N88 | monitor health 过期后 runtime append | HALTED；零写 |
| N89 | clock 回拨/未来/非安全整数 | HALTED；零写 |
| N90 | fence ID 固定公式/查找 ID/schema | 通过；无第二个 fence ID |
| N91 | k3-bootstrap 5 refs/4 writes（domain2+marker+audit） | 成功；fence 缺失才允许 |
| N92 | audit proof k3MarkerDigest 缺失/不匹配 | PROOF_REQUIRED |
| N93 | C1 16/C2 25 refs | ≤90；无未声明写 |
| N94 | migration 17/7/recovery 7/plan 2 refs | ≤90 |
| N95 | F22–F32 失败矩阵 | Z_all/Z_chain 按表 |
| N96 | 完整云报告不可读/未列项 | 明确缺失，不声称关闭 |

### 15.7 v5 未解决/未验证

- 完整云报告正文不可读（路径如 §15 开头）；报告内逐项结论、未在本消息列明的裁定仍是**缺失项/待裁**，不猜测关闭。
- Q28–Q31 待 Codex 裁定；v4 Q1–Q27 中与 §15 冲突的预算/scope 以 §15 为准。
- 未运行测试；N01–N96 设计矩阵未执行；无 C1/C2/C3 实现。
- 旧 writer 真实撤权、DB 权限、monitor 运维可用性无法由本地设计验证；需部署/DB 证据。
- G3 `5f1d7a4` 关闭/O10 PASS 不重派；G4 执行/C1 实现/C2/C3/main/07B 合并/HTTP/UI/部署上线冻结。

---

**提交对象：Codex。请复审 v5 §15（Q28–Q31、N81–N96、预算/状态机/失败矩阵）；本稿不声称完整云报告已读或逐项关闭。不自批。**
