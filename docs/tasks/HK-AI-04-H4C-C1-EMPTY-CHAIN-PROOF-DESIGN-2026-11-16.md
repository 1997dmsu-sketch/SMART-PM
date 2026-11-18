# HK-AI-04 H4-c C1 空链证明设计 v8（writer epoch 唯一性修订稿）

> 状态：**设计提案，待 Codex 复审。** 本稿只修订设计文档；不实现 C1、不修改任何生产代码/测试/Store、不进入 C2/C3/G4、不注册 HTTP、不调用 Provider/设备/生产云。
>
> 输入设计卡：`7f422808f2193a2bec4cb5fe4e32539484c657fb`（父 `3d52ee8`，C1 代码基线 `5dff386`）。
>
> 已批准设计：`docs/hk-face-h4c-reconciliation-design @ b15aceb`；批准/任务卡：`ed7b66f`；C2 前置检查：`42f8970`。
>
> 本稿保留 v3–v6 修订，并在 §17 追加 v7 权威章节：一次性执行授权/持久运行授权分离、plan 39 字段持久 schema 与 statusTicket 重建、健康过期/显式 halted 分离与唯一恢复流程；v8 在 §18 追加 writer plan/epoch 唯一性权威章节。**v4/v5/v6 正文与 §17 冲突处以 §17 为准；v8 唯一性相关（plan ID/runId、epoch 作用域、重签/终态、consumed 校验）以 §18 为准。**
>
> v5 输入：`3ac5cf9483caebcaf8f5aeb1df8fd4aca9bfb13f`（父 `575d8b6`）。
>
> v6 输入：`3d52ee878362e4db65f15e947174e73db2947d90`（父 `ad8bb47`）；v6 权威修订见 §16，与 v5/v4 冲突处以 §16 为准。v6 关闭 marker 短 ID、plan 状态签名、recovery source CAS、不可变 K3 marker/可变 writer 授权四项。
>
> **v7 输入：`7f422808f2193a2bec4cb5fe4e32539484c657fb`（父 `3d52ee8`）；v7 权威修订见 §17，与 v6/v5/v4 冲突处以 §17 为准。** v7 关闭三项设计退修：writer 执行/运行授权自锁、statusTicket 持久字段重建、健康过期/halted 恢复矛盾。
>
> **v8 输入：`bc80f741981cade3e4e3d65df709c24f31556c06`（父 `7f42280`）；v8 权威修订见 §18，与 §17/v6/v5/v4 冲突处以 §18 为准。** v8 只关闭 writer plan 与 epoch 的唯一性（含 consumed 按 planKind 的校验修正）：冻结 canonical ID/确定性 runId、作用域、撤销/过期重签与终态规则、同 epoch/不同 epoch/终态重签预期，并按 planKind 补全 consumed 的 `runtimeTicket` 校验；**不重开** §17.1 writer 运行授权、§17.2 39 字段票据持久化、§17.3 健康过期恢复。
>
> 闸门：G3 已在 `5f1d7a4` 关闭、O10 PASS；G4 通过；07B 离线门禁通过；main/07B 合并、C1 实现、C2/C3、HTTP/UI、部署上线继续冻结，本卡不重复派发。
>
> 完整云报告 `/workspace/artifacts/DEL-AI-01-CONTENT-REVIEW-2026-11-18/REVIEW.md` 未提供可读正文；已查可访问位置均不可读，未声称逐项关闭。

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 空链证明 | K3 精确 + CoverageValid + fence clear + 两阶段 admission + anchor + 1..9 IDs + 完整 canonical 链 |
| halt 恢复 | `CLEAR(E0) → HALTED(E0) → CLEAR(E1)`；恢复用独立 signed recoveryPlan，**不要求 active clear fence**；proof+fence+audit 单事务原子完成 |
| bootstrap | v5：首次 bootstrap 检查 fence **不存在**；读集合 domain head/version + fence + marker + audit；**5 refs/4 writes**（domain2+marker+audit）；无 fence/marker 时才允许 |
| 最终审计 | 所有最终写字节（业务写 + 唯一 admin_audit）在 final ticket **之前**生成；ticket 覆盖完整 canonical write set；Store 不自动追加/改审计；禁止双审计 |
| 持续写入约束 | Store gate 覆盖 transact/change/persist/seed/init；runtime/migration/recovery/monitor/k3-bootstrap 分 kind；旧 writer 持续拒绝 |
| writer 授权 | **v7**：一次性执行授权（`active→consumed`，执行事务内消费）与持久运行授权（`consumed`+`runtimeTicket`+`proof.writerPlanId` 绑定）分离；runtime 不接受 `active` |
| plan 持久化 | **v7**：39 字段（30 core + 9 状态/运行）；`initialStatusTicket`；各 planKind 空值规则；票据验证 0 新增 refs；**v8** writer `runId="we-<e>"`/canonical `_id`（§18.2） |
| 健康/停写 | **v7**：`CLEAR_EXPIRED`（fence clear 但过期，仅 heartbeat 恢复）与 `HALTED`（显式 halted，仅 recovery/rotate）分离 |
| refs | **v7：C1 17；C2 R1 26；migration anchor 18、finalize 8（writes 5）；recovery 8（writes 5）；monitor 7；k3-bootstrap 5；plan issue 2；writer rotate 8（writes 4）；R2 8+N≤90** |
| epoch 唯一性 | **v8**：`planId(e)=evidence-chain-plan:v1:writer:we-<e>:writer`；每 epoch 至多一条 valid writer plan（`_id` create-only）；重签必须 `e'>e`；0 新增 refs/index（§18.4/§18.8） |
| 裁定 | **v8：Q1–Q44；N01–N142**（v5–v7 Q/N 保留历史；预算/Q 以 §18 为准；§18 覆盖 §17.1 R7 与 §17.2 consumed 分支） |

## 1. 输入、基线与问题

### 1.1 输入事实

- 唯一工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\c1-design-v4`，分支 `codex/h4c-empty-proof-v4`，HEAD = `3d52ee878362e4db65f15e947174e73db2947d90`，父 `ad8bb47`。
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
>
> **v7 更正**：`CoverageValid` 的 writer 部分改为 `WriterPlanValid` = `consumed` + `runtimeTicket` + `proof.writerPlanId` 绑定（§17.1）；`FenceValid` 只表示健康，健康过期与显式 halted 分离（§17.3）；§3.2 的 `FenceClear` 在运行时门禁以 `FenceValid`（含健康）判定；proof 24 字段含 `writerPlanId`。

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
| `init()` | 只补空数组默认值（不写记录） | 不写记录、不 persist 链 |
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
| job log + op log | 2 |
| **合计** | **24** |

C2 R1 finalWriteSet 含 job/evidence/head/anchor/log/op/唯一 admin_audit；0 grant/slot/claim/device/domain/fence；R2 ≤90。

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
4. recovery/rotate 状态机/独立授权/原子 proof+fence+plan+runtimeTicket+audit；
5. v8：C1 17/C2 26/migration 18/8/recovery 8/monitor 7/k3 5/plan 2/writer rotate 8；writes 5/5/4；≤90；writer canonical ID/create-only 0 新增 refs；
6. N01–N142 实现级测试（N01–N112 沿用 v6；N113–N132 见 §17.6；N133–N142 见 §18.11；无 HTTP/外部网络）；
7. 迁移/恢复/fence/monitor/writer-rotate/K3 bootstrap 工具另立卡。
8. v8：writer plan `runId="we-<e>"`/canonical `_id`、每 epoch 至多一条 valid plan、撤销/过期重签 `e'>e`、consumed 按 planKind 校验（§18.2–§18.7）；Store `_id` create-only 必须验证。

本卡停止；等 Codex 复审 §18（Q41–Q44、N133–N142）与 §17（Q36–Q40）；不进入 C1/C2/C3/G4。

## 15. v5 权威修订（v5 历史；v6 §16 覆盖冲突处）

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
- **读集合（refs 5）**：domain fixed head、domain version、`EVIDENCE_CHAIN_FENCE_ID`、`evidence-chain-k3-marker:v1:global`、`admin_audit/<auditId>`。
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

#### 15.2.1 plan 记录 schema（23 字段；v7 以 §17.2 的 39 字段为准）

集合 `evidence_chain_plans`；`_id = "evidence-chain-plan:v1:<planKind>:<runId>:<phase>"`（v8：writer 的 `runId` 冻结为 `we-<writerEpoch>`，ID 随之确定，见 §18.2）；字段：
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
  - plan `_id` 含 runId/phase，create-only；`status=active` 才可使用。**v8：writer 的 runId 由 epoch 确定，`_id` 即 epoch 索引；同 epoch 至多一条 valid plan（§18.4）。**
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
  结构/HMAC/时钟负向失败 → `EVIDENCE_CHAIN_HALTED/409`；健康正向过期（`now > validUntil`）→ `EVIDENCE_CHAIN_FENCE_EXPIRED/409`（v7 §17.3）；均在事务内构造写之前返回；Store gate 写阶段复查 state[fence]。
- monitor 操作（均 fence+唯一 audit，refs 5）：
  - `fence-heartbeat`：`FenceHeartbeatable`（v7 §17.3：status clear、`FenceStructValid`、`now ≥ heartbeatAt−CLOCK_SKEW_MS`，**允许 now > validUntil**）+ 完整 CoverageValid；更新 heartbeatAt=now、validUntil=now+window，audit；这是健康过期的**唯一**恢复路径。
  - `fence-halt`：status halted，reasonCode/monitorId/updatedAt；heartbeat/validUntil 保留；不依赖 proof 有效；audit。
  - `fence-clear`：**不允许 monitor**；仅 recovery-finalize 新 epoch proof 原子写 clear。
- 时钟：`now` 由受信服务提供且安全整数；若 `now < heartbeatAt - skew`（回拨/未来心跳）→ HALTED，且**不得用 heartbeat 修复**（只能 halt→recovery）；`now > validUntil` 为健康过期（`CLEAR_EXPIRED`，非 halted）；窗口超上限 → HALTED；不得用非法时钟继续。
- 事务内权威停写：runtime/Store gate 在 **读 fence 后、构造 finalWriteSet 前**判断 `FenceValid(now)`；过期/时钟异常立即 HALTED；gate 在写阶段用 state[fence] 复查；在途事务若已过 gate 且 fence 在提交前变 halted/expired，按 Store 事务冲突/下一事务停写；monitor 同时停流量。
- 状态：`CLEAR_HEALTHY(E)`、`CLEAR_EXPIRED(E)`（fence status 仍 clear，业务写 `FENCE_EXPIRED`，仅 heartbeat 恢复）、`HALTED(E)`（显式 halted，仅 recovery/rotate）、`RECOVERY`；heartbeat 可 CLEAR_EXPIRED→CLEAR_HEALTHY；`HALTED` **不可** heartbeat；monitor halt → HALTED；recovery → CLEAR_HEALTHY(E1)。

### 15.4 v5 预算/schema/refs（覆盖 v4 §7；v7 §17.5 覆盖本节）

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

## 16. v6 权威修订（覆盖 v5/v4 冲突处）

> v6 输入：`3d52ee878362e4db65f15e947174e73db2947d90`（父 `ad8bb47`）。v5/v4 正文保留历史；**凡与 §16 冲突（marker ID、plan 签名/状态、recovery source/CAS、monitor refs、writer 授权、schema/预算/Q/N）以 §16 为准。**
>
> 完整云报告 `/workspace/artifacts/DEL-AI-01-CONTENT-REVIEW-2026-11-18/REVIEW.md` 仍不可读；未提供正文，不声称逐项关闭。

### 16.1 marker canonical ID 与 refs 统一（禁短 ID）

- 常量：`EVIDENCE_CHAIN_K3_MARKER_ID = "evidence-chain-k3-marker:v1:global"`。
- 所有层（bootstrap、runtime C1/C2、migration、recovery、monitor、Store gate）**只用完整常量查找/声明 refs**；禁止 `k3-marker:v1:global` 短 ID；静态扫描（除本禁止条款说明外）该短串 0 命中。
- K3 marker schema **18 字段**（v6 去掉可变 writer 字段，改为不可变 bootstrap 证明）：
  `_id, kind, scope, schemaVersion, fenceId, k3DomainHeadId, k3DomainVersionId, k3DomainHeadRevision, realm, keyVersion, keyFingerprint, bootstrapRunId, maintenanceId, maintenanceManifestDigest, windowStart, windowEnd, createdAt, markerDigest`。
  - `_id = EVIDENCE_CHAIN_K3_MARKER_ID`；`kind="k3-marker"`、`scope="global"`、`schemaVersion=1`；`fenceId=EVIDENCE_CHAIN_FENCE_ID`。
  - `markerDigest` K3 HMAC `KEYED_DIGEST/h4-evidence-k3-marker` v1；create-only；仅 k3-bootstrap 创建。
- K3 marker read/refs 统一：C1/C2/migration/recovery/monitor 使用完整 ID；K3 bootstrap refs **5**（domain2+fence+marker+audit）/writes **4**（domain2+marker+audit）；C1 17/C2 26 含 marker ref。
- 禁止从 realm/epoch/runId 重算 marker ID；marker ID 与 fence ID 都是全局字面常量。

### 16.2 plan 不可变签名负载与可变状态分离

**问题**：v5 plan 的 `planDigest/planTicket` 覆盖含 `status` 的整体；active→consumed/revoked 改 status 后旧 digest/ticket 无法验证，或被迫重签。
**v6 规则**：

> v7：本节由 §17.2 的 39 字段冻结取代；`writerSetDigest` 统一为 `targetWriterSetDigest`，新增 `issuedBy/sourceKind/statusFrom/statusActor/statusTargetProofId/initialStatusTicket/runtimeTicket`；`status` 仅表示一次性执行授权，运行授权见 §17.1。

1. **不可变 core**（planDigest/planTicket 覆盖，不含 status）：
   - 公共：`_id, kind, scope, schemaVersion, planKind, phase, runId, windowStart, windowEnd, issuedAt, keyFingerprint`；
   - migration/recovery 额外：`targetWriteEpoch, targetAdmissionPolicyVersion, targetWriterSetDigest, targetProofId, finalInventoryDigest, canonicalEvidenceCount, canonicalHeadCount, anchorCount, auditedCollections`；
   - recovery 额外：`sourceHaltedEpoch, sourceFenceDigest`；
   - writer 额外：`writerEpoch, k3MarkerId, writerSetDigest, revokedWriterSetDigest, revocationReceiptDigest, sourceHaltedEpoch, sourceFenceDigest`。
2. **可变状态**（不进入 core digest）：`status ∈ {"active","consumed","revoked"}`, `statusUpdatedAt`, `statusReason`, `statusTicket`（v7 扩展为 9 个状态/运行字段，§17.2）。
3. `planDigest` = SHA-256(canonical core)；`planTicket` = K3 HMAC `KEYED_DIGEST/h4-evidence-plan` v1(core)；**改 status 不重算/不重签 core**。
4. `statusTicket` = K3 HMAC `KEYED_DIGEST/h4-evidence-plan-status` v1，覆盖 `{planId, fromStatus, toStatus, targetProofId, statusUpdatedAt, statusReason, actor}`；gate 分别验证 core digest/ticket 与 statusTicket。**v7：上述签名输入全部持久化（`issuedBy/statusFrom/statusActor/statusTargetProofId/statusUpdatedAt/statusReason`），并由 `initialStatusTicket` 覆盖初始 active；见 §17.2。**
5. 状态机：`active → consumed`（finalize/recovery/writer-rotate 成功同事务，并铸造 `runtimeTicket`）或 `active → revoked`（plan-revoke）；terminal 不可逆；不得 active 复活。**v7：旧 writer plan（已 consumed）不写、不改，运行授权由当前 `proof.writerPlanId` 决定（§17.1）。**
6. 防重放：plan `_id` 唯一；已 consumed/revoked/expired 的 plan 再用于 anchor/finalize/recovery/writer-rotate → `PLAN_CONSUMED`/`PLAN_REVOKED`/`PLAN_EXPIRED`；statusTicket 绑定 planId/from/to/targetProofId，重复使用被拒。**v7：runtime 读取 consumed+`runtimeTicket`，不再要求 active（§17.1）。**
7. 若 Codex 选择“重新签名”而非状态分离，则每次状态变更必须生成新 plan epoch/新 planId/core ticket，旧 plan 置 revoked；v6 推荐状态分离。
8. 预算：`plan-issue` refs **2**（plan+audit）/writes 2；`plan-revoke` 2/2；status 更新发生在 finalize/recovery/writer-rotate，不新增 ref。

### 16.3 recovery plan source 绑定/CAS 与 monitor 完整 CoverageValid

- **recovery plan 持久化 core** 必含 `sourceHaltedEpoch`、`sourceFenceDigest`；planKind=recovery；plan 记录存于 `evidence_chain_plans`，不是仅内存对象。
- `recovery-finalize` 事务内：
  1. 读 fence（完整 ID）；必须 `status="halted"`、`epoch=sourceHaltedEpoch`、`fenceDigest=sourceFenceDigest`；
  2. 读 recovery plan（完整 schema）；core digest/ticket 通过；status active；statusTicket/initialStatusTicket 通过（全部签名输入取自持久记录，§17.2）；
  3. 读 writerPlan/marker/proof；target proof 不存在；source CAS 失败 → `PLAN_STALE`/`HALTED`，零写；
  4. 原子写 fence clear(E1)+new proof(E1, writerPlanId)+recovery plan consumed+writer plan(W1) consumed&runtimeTicket+audit。
- recovery refs **8**：domain2+fence1+marker1+writerPlan1+plan1+proof1+audit1 =8；writes fence+proof+plan+W1+runtimeTicket+audit=**5**（v7 §17.5）。
- monitor 若验完整 `CoverageValid`：
  - 必须读 marker（完整 ID）与 writer plan ref；monitor refs 从 v5 的 5 增至 **7**：domain2+proof1+fence1+marker1+writerPlan1+audit1。
  - heartbeat 要求完整 `CoverageValid` + **`FenceHeartbeatable`**（v7 §17.3：不要求 `FenceHealthy`，否则健康过期后无法恢复）；halt 可只写 fence+audit，不因 coverage 无效而拒绝（但 refs 仍按 7 声明）。
  - monitor halt/heartbeat writes fence+audit=2；预算 monitor 7。
- `CoverageValid` 增 `K3MarkerValid`、`WriterPlanValid`（v7：`status="consumed"` + `runtimeTicket` + `proof.writerPlanId` 绑定；不是 `active`，§17.1）；audit proof 24 字段含 `writerPlanId`。
- recovery plan status active→consumed 使用 §16.2 statusTicket；source CAS 与 fence 更新同事务。

### 16.4 不可变 K3 bootstrap 证明 vs 可变 writer 集授权（同 K3 可达流程）

- **不可变 K3 marker**：只证明 K3 bootstrap/维护窗口/maintenance manifest/fence ID；不含运行时 writer 集；writer 授权不写 marker。
- **可变 writer 授权**：`evidence_chain_plans` 的 `planKind="writer"` 记录（v7 39 字段，§17.2）：
  - core：`writerEpoch, targetWriterSetDigest, k3MarkerId, revokedWriterSetDigest, revocationReceiptDigest, sourceKind, sourceHaltedEpoch, sourceFenceDigest, windowStart/End...`；
  - status：`active → consumed`（执行事务内，同事务铸 `runtimeTicket`）或 `active → revoked`（plan-revoke）；
  - `_id = evidence-chain-plan:v1:writer:<runId>:writer`（v8 冻结 writer `runId="we-<writerEpoch>"`，见 §18.2）。
- **同 K3 writer 变化/重审/恢复流程**：
  1. **Halt**：monitor 写 fence halted(E0)（若尚未 halt）；或维护窗口内 gate closed。
  2. **新 writer plan**：issue `writerEpoch+1`（同 `k3MarkerId`/`keyFingerprint`，新 writer set/revocation 摘要，`sourceKind="halted-fence"`、source E0/ digest）；写 plan+audit。
  3. **重审**：按新 writer plan 完整 inventory；生成 final inventory digest/counts；写入 rotate 事务创建的 proof；不写 evidence/head。
  4. **writer-rotate finalize**：事务内 CAS source fence E0/halted；写 new proof(E1, writerPlanId=W1, k3MarkerDigest) + fence clear(E1) + W1 consumed&runtimeTicket + audit；旧 K3 marker 与旧 W0 均不变；refs **8**（domain2+fence+marker+W0+W1+proof+audit），writes **4**（proof+fence+W1+audit）；失败 Z_chain/零写。
  5. **runtime**：读 consumed+runtimeTicket 的 writer plan W1 + proof E1；`proof.writerPlanId=W1`、runtimeTicket、keyFingerprint/marker 全匹配；旧 W0 的 runtimeTicket 绑定旧 proof E0，故不可用。
  6. **K3 换钥**：不是本流程；必须新 marker/bootstrap/维护审计，旧 marker/writer plan 全部失效。
- audit proof **24 字段**：v5 23 字段 + `writerPlanId`；runtime `WriterPlanValid` 校验 consumed/runtimeTicket/core/statusTicket/keyFingerprint/k3MarkerId/proof 绑定（window 仅约束执行）；C1/C2 读 writer plan ref（C1 17/C2 26）。
- 该流程使同 K3 writer 变化、重审、monitor halt 后恢复可达，而不修改不可变 K3 marker。

### 16.5 v6 预算/状态/失败零写（覆盖 v5）

| 事务 | refs | writes |
|---|---:|---|
| C1 首条/非首条 | domain2+audit1+fence1+marker1+writerPlan1+anchor1+head1+E9 = **17** | 3/2 |
| C2 R1 | C1 17 + org/member/job/grant4 + op key/op domain3 + job log/op log2 = **26** | job/evidence/head/anchor/log/op/audit（唯一 admin_audit 已含 C1 audit1） |
| migration-anchor | domain2+fence1+marker1+writerPlan1+plan1+head1+E9+anchor1+audit1 = **18** | anchor+audit |
| migration-finalize | domain2+fence1+marker1+writerPlan1+plan1+proof1+audit1 = **8** | fence+proof+migrationPlan+W0+runtimeTicket+audit=**5** |
| recovery-finalize | domain2+fence1+marker1+writerPlan1+plan1+proof1+audit1 = **8** | fence+proof+recoveryPlan+W1+runtimeTicket+audit=**5** |
| monitor heartbeat/halt | domain2+proof1+fence1+marker1+writerPlan1+audit1 = **7** | fence+audit |
| k3-bootstrap | domain2+fence1+marker1+audit1 = **5** | domain2+marker+audit |
| plan/writer-plan issue | plan1+audit1 = **2** | plan+audit |
| writer-rotate | domain2+fence1+marker1+W0+W1+proof1+audit1 = **8** | proof+fence+W1+runtimeTicket+audit=**4**（旧 W0 不写） |
| C2 R2 | H4-b 8+N≤90 | 独立 |

- C2 R1 26 距 90 余 64；8 集合（evidence/head/domains/anchor/audit/fence/k3-marker/plans）；无新集合；writer 授权在 plans。
- 状态：`BOOTSTRAP → UNPROVEN(marker) → CLEAR_HEALTHY(E)/CLEAR_EXPIRED(E) → HALTED(E) → CLEAR_HEALTHY(E1)`；writer-rotate 从 HALTED 到 CLEAR_HEALTHY(E1)；健康过期是 `CLEAR_EXPIRED`（**非** HALTED），`fence-heartbeat` 唯一恢复；显式 `HALTED` 只能 recovery/rotate；heartbeat 不得复活 HALTED（v7 §17.3）。
- 并发：
  * 两 marker/ID bootstrap create-only 一胜；
  * plan status core/statusTicket 并发一胜，旧 statusTicket 拒绝；
  * recovery source CAS 失败 PLAN_STALE；
  * 两 writer-rotate/W1 一胜，旧 W0 不可复用；
  * monitor full coverage refs7；缺 marker/writer plan → PROOF/HALTED；
  * K3 轮换使 marker/writer plan/proof 全失效。
- 失败零写增量：
  * F33 marker 短 ID/ref 不一致 → PROOF/HALTED，Z_all；
  * F34 plan 改 status 后仍验 core/旧 statusTicket → PLAN_INVALID，Z_all；
  * F35 recovery source fence/epoch/CAS 不符 → PLAN_STALE/HALTED，Z_all；
  * F36 monitor 完整 CoverageValid 缺 marker/writer ref → HALTED，Z_all；
  * F37 writer plan status/key/marker 不符 → PLAN_INVALID，Z_all；
  * F38 同 K3 writer 变化旧 plan/proof 重放 → PLAN_CONSUMED/STALE，Z_all；
  * F39 writer-rotate fence/proof/plan/audit 原子失败 → Z_chain；
  * F40 audit proof writerPlanId 缺失/不符 → PROOF_REQUIRED，Z_all。

### 16.6 v6 裁定与矩阵

**新增 Q32–Q35**：
| Q | 事项 | 建议 |
|---|---|---|
| Q32 | K3 marker 完整 ID/18 字段/refs（禁短 ID） | 批准 |
| Q33 | plan core/status 分离、statusTicket、active→consumed/revoked | 批准（v7：签名输入持久化 + initialStatusTicket，§17.2） |
| Q34 | recovery sourceHaltedEpoch/sourceFenceDigest + CAS；monitor 完整 CoverageValid refs7 | 批准 |
| Q35 | 不可变 K3 marker vs writer plan；同 K3 writer-rotate 8/5；C1 17/C2 26/预算 | 批准（v7：rotate writes 4，runtime 读 consumed+runtimeTicket，§17.1/§17.5） |

**新增 N97–N112**（N01–N96 保留；N26/N48/N66 等预算按 v6 替换；v7 追加 N113–N132 见 §17.6）：
| ID | 场景 | 期望 |
|---|---|---|
| N97 | marker 完整 ID/18 字段/HMAC；短 ID 扫描 | 通过；短 ID 0 |
| N98 | marker refs 在 C1/C2/migration/recovery/monitor 全一致 | 通过 |
| N99 | plan core/status 分离；statusTicket；不改 core | 通过 |
| N100 | plan active→consumed/revoked；旧 statusTicket 重放 | PLAN_*；零写 |
| N101 | recovery sourceHaltedEpoch/sourceFenceDigest CAS 失败 | PLAN_STALE/HALTED |
| N102 | recovery source 匹配成功；refs8/writes5（v7 §17.5） | 成功 |
| N103 | monitor 完整 CoverageValid refs7；缺 marker/writer plan | HALTED/PROOF |
| N104 | writer plan core/status/key/marker 校验 | 通过/拒绝 |
| N105 | 同 K3 writer 变化：halt→W1→重审→rotate | CLEAR(E1)，旧 W0 保持 consumed、无运行授权（v7 §17.1） |
| N106 | writer-rotate refs8/writes4；旧 W0 重放 | 一胜；PLAN_CONSUMED/STALE；旧 W0 不写（v7 §17.5） |
| N107 | audit proof writerPlanId 绑定；C1 17/C2 26 | 通过/拒绝 |
| N108 | C1 17/C2 26/migration18/8/recovery8/monitor7/k3 5/plan2/rotate8 | ≤90 |
| N109 | F33–F40 失败矩阵 | Z_all/Z_chain |
| N110 | 不可变 marker vs 可变 writer plan；K3 同 key 变化 | 流程可达 |
| N111 | K3 换钥后旧 marker/writer plan/proof | 全部失效 |
| N112 | 完整云报告不可读/未列项 | 明确缺失，不声称关闭 |

### 16.7 v6 未解决/未验证

- 完整云报告正文不可读；报告内未列明项待裁，不猜测关闭。
- Q32–Q35 待 Codex 裁定（v7 追加 Q36–Q40，见 §17.6）；v5/v4 中冲突的预算/scope 以 §16/§17 为准（§17 优先）。
- 未运行测试；N01–N112 为设计矩阵（v7 追加 N113–N132，见 §17.6）；无 C1/C2/C3 实现。
- 同 K3 writer 变化的真实 DB 撤权、维护窗口、monitor 运维证据未验证。
- G3 `5f1d7a4`/O10 PASS 不重派；G4 执行/C1 实现/C2/C3/main/07B 合并/HTTP/UI/部署上线冻结。

## 17. v7 权威修订（覆盖 v6/v5 冲突处）

> v7 输入：`7f422808f2193a2bec4cb5fe4e32539484c657fb`（父 `3d52ee8`）。v4/v5/v6 正文保留历史；**凡与 §17 相反（writer plan 状态、statusTicket 持久字段、health 过期/halted、refs/writes、Q/N、错误码、状态机）以 §17 为准。**
>
> 完整云报告 `/workspace/artifacts/DEL-AI-01-CONTENT-REVIEW-2026-11-18/REVIEW.md` 仍不可读；未提供正文，不声称逐项关闭。

### 17.0 三项退修与闭合位置

| # | 退修项 | 原表述/问题 | v7 规则 | 位置 |
|---|---|---|---|---|
| 1 | writer 授权自锁 | v6 §16.4 `:876` 把新 W1 置 `consumed`（防重放），§16.4 `:877/:879` runtime 却要求 `active`（运行授权）；同一 `status` 承担两种语义，rotate 成功后 runtime 永久 `PROOF_REQUIRED` | 一次性执行授权（`active→consumed`，执行事务内消费）与持久运行授权（`consumed`+`runtimeTicket`+`proof.writerPlanId` 绑定）分离；runtime 不接受 `active`；首次 UNPROVEN 的 writer plan 用 `sourceKind="bootstrap"` + source 两字段 `null` | §17.1、§17.2、§17.5 |
| 2 | statusTicket 不可重建 | v6 §16.2 `:843` 票据覆盖 `fromStatus/actor/targetProofId` 等，但 v5 `§15.2.1` 持久 schema 无 `statusUpdatedAt/statusReason/statusActor/statusFrom/statusTargetProofId/statusTicket`，writer plan 的 `targetProofId` 也不在 core | 冻结 **39 字段**（30 不可变 core + 9 状态/运行）；初始 active 票据 `initialStatusTicket`；各 planKind 空值规则；票据验证 **0 新增 refs** | §17.2 |
| 3 | 健康过期 vs halted | v5 §15.3 `:694-705` 把 `now≤validUntil` 放进 `FenceValid` 且过期→HALTED，同处又允许过期 heartbeat 刷新；v6 §16.3 `:860` heartbeat 又要求 `FenceValid`；§16.5 `:898` 说过期→HALTED 又说 heartbeat 可恢复 | 拆 `FenceRecordValid/FenceStructValid/FenceHealthy/FenceValid/FenceHeartbeatable`；`CLEAR_EXPIRED`（clear 但过期，业务写 `FENCE_EXPIRED`，唯一恢复=fence-heartbeat）与 `HALTED`（显式 halted，唯一恢复=recovery/rotate）分离；新增 `EVIDENCE_CHAIN_FENCE_EXPIRED` | §17.3、§17.4 |

### 17.1 一次性执行授权 vs 持久运行授权（解除 writer-rotate 自锁）

**问题复述**：v6 只有 `plan.status` 一个生命周期字段。`writer-rotate` 在同一事务把新 `W1` 置 `consumed`，以证明“该执行授权已被消费”（防重放）；runtime 的 `WriterPlanValid` 却要求 `status="active"`（证明“当前 writer 被授权”）。二者不可能同时成立 → rotate 成功后 runtime 永久 `PROOF_REQUIRED`，链不可继续。

**两类授权（唯一语义）**：

| 授权 | 载体 | 生命周期 | 验证方 | 失败 |
|---|---|---|---|---|
| 一次性执行授权 E | `status="active"` + `initialStatusTicket` | 执行事务开始前有效；事务内 `active→consumed`，恰好一次 | 执行事务 gate（migration-finalize / recovery-finalize / writer-rotate） | `PLAN_CONSUMED`/`PLAN_INVALID` |
| 持久运行授权 R | `runtimeTicket` + `proof.writerPlanId` + `status="consumed"` + `statusTicket(active→consumed)` | 与当前 `proof(E)` 同寿命；新 proof 取代旧 proof 即失效 | runtime C1/C2 `CoverageValid`、monitor | `PROOF_REQUIRED` |

**规则 R1–R7**：

- **R1** 每个创建 audit proof 的事务（migration-finalize / recovery-finalize / writer-rotate）必须**恰好消费一个** `planKind="writer"` 的 plan，并在同一事务为该 proof 铸造 `runtimeTicket`。
- **R2** `runtimeTicket` = K3 HMAC `KEYED_DIGEST/h4-evidence-writer-runtime` v1，覆盖 `{planId, proofId, writerEpoch, targetWriterSetDigest, k3MarkerId, keyFingerprint, activatedAt}`；`activatedAt = plan.statusUpdatedAt`；一经写入不可变。
- **R3** runtime 的 `WriterPlanValid(plan, proof, marker)` = `PlanRecordValid` ∧ `status="consumed"` ∧ `statusTargetProofId=proof._id` ∧ `proof.writerPlanId=plan._id` ∧ `runtimeTicket` 验签 ∧ `plan.writerEpoch=proof.writeEpoch` ∧ `plan.k3MarkerId=marker._id=proof.k3MarkerId` ∧ `plan.keyFingerprint=当前 K3`。**不要求 `status="active"`，不要求 `now∈plan.window`**（window 只约束执行，不约束运行）。
- **R4** `status="active"` 只表示“一次性执行授权未使用”；runtime 读到 active plan（未被当前 proof 引用）→ `PROOF_REQUIRED`，不得据此放行。
- **R5** 旧 writer plan 不写、不改：其 `runtimeTicket.proofId` 绑定旧 proof E0，E0 不再是当前 `CoverageValid` proof，故无运行授权；旧 plan 保持 `consumed` 终态，不复用、不复活。
- **R6** `consumed`/`revoked` 为终态；只允许一次 `active→consumed` 或 `active→revoked`，无第三状态、无回退。**v8：同 epoch 重签一律 `PLAN_DUPLICATE`，只能 `e'>e`（§18.5）。**
- **R7** 同一 `writerEpoch` 至多一个 valid writer plan（因而至多一个 active）：`runId="we-<e>"`、`_id="evidence-chain-plan:v1:writer:we-<e>:writer"`，由 `_id` create-only 保证；同一 epoch 至多一个 proof（`targetProofId=f(K3 fp,domainHeadRevision,e)` 确定性）。**v8 更正：v7 原句“`_id` 含 epoch”不成立（v7 `_id` 实际含任意 `runId`）；唯一性证明、作用域、重签/终态见 §18.2–§18.5。**

**writer plan 来源与首次 UNPROVEN**（`W0` = 首个 proof 的 writer plan；`W1` = 新 epoch 的 writer plan）：

| 场景 | 状态 | fence | `sourceKind` | `sourceHaltedEpoch` | `sourceFenceDigest` | `writerEpoch` | `targetProofId` | 执行事务 |
|---|---|---|---|---|---|---:|---|---|
| 首次 | UNPROVEN | 不存在 | `"bootstrap"` | `null` | `null` | 1 | E0 | migration-finalize |
| halt 后恢复 | HALTED(E0) | halted E0 | `"halted-fence"` | E0 | `fenceDigest(E0)` | n+1 | E1 | recovery-finalize |
| 同 K3 writer 变化 | HALTED(E0) | halted E0 | `"halted-fence"` | E0 | `fenceDigest(E0)` | n+1 | E1 | writer-rotate |

- **首次 UNPROVEN 的 source 来源**：UNPROVEN 无 fence（bootstrap 要求 fence 不存在），不存在“被 halt 的 fence”；`sourceHaltedEpoch/sourceFenceDigest` 显式写 `null`（JSON null，不得省略、不得写 `0`/空串），由 `sourceKind="bootstrap"` 唯一解释。`sourceKind="bootstrap"` 且 source 非 null、或 `sourceKind="halted-fence"` 且 source 为 null/与当前 halted fence 不符 → `PLAN_INVALID`。
- `"bootstrap"` writer plan 只在 UNPROVEN 且 fence 不存在时可执行；`"halted-fence"` 只在 fence `status="halted"`、`epoch=sourceHaltedEpoch`、`fenceDigest=sourceFenceDigest` 时可执行；`CLEAR_EXPIRED` 不是合法来源（必须先 `fence-halt`）。
- `sourceKind` 为 v7 新增 core 字段；`sourceHaltedEpoch/sourceFenceDigest` 保留 v6 名称。

**执行事务的写入（统一）**：

| 事务 | 消费的 plan | writes |
|---|---|---|
| migration-finalize | migration plan + W0 | `fence+proof+migrationPlan(consumed)+W0(consumed+runtimeTicket)+audit` = **5** |
| recovery-finalize | recovery plan + W1 | `fence+proof+recoveryPlan(consumed)+W1(consumed+runtimeTicket)+audit` = **5** |
| writer-rotate | W1（自身即执行授权） | `fence+proof+W1(consumed+runtimeTicket)+audit` = **4** |

- 交叉绑定：执行 plan 与 writer plan 的 `targetProofId/targetWriteEpoch/targetWriterSetDigest/k3MarkerId` 必须一致，否则 `PLAN_INVALID`/`PLAN_STALE`。
- `writer-rotate` 不写旧 W0：W0 已在其自身 finalize 中 `consumed`，终态不可再改；旧授权失效由 `proof.writerPlanId` 指向新 W1、旧 proof 非当前共同保证。

**状态机（writer plan 维度）**：

```text
(none) --plan-issue--> active --执行事务(proof 创建同事务)--> consumed(+runtimeTicket)   [终态]
active --plan-revoke--> revoked                                                          [终态]
runtime 权威 = 当前 CoverageValid proof.writerPlanId 指向的 consumed plan
```

### 17.2 plan 持久 schema 冻结（39 字段）与 statusTicket 可重建

**问题复述**：v6 `statusTicket` 覆盖 `{planId, fromStatus, toStatus, targetProofId, statusUpdatedAt, statusReason, actor}`，但持久记录没有 `statusUpdatedAt/statusReason/statusActor/statusFrom/statusTargetProofId/statusTicket`，且 writer plan core 不含 `targetProofId` → 票据无法从记录重建，只能信任内存对象，违反“plan 记录是签名的持久化”。

**冻结：`evidence_chain_plans` 每条记录恰好 39 字段**（30 不可变 core + 9 状态/运行；无额外字段、无缺省）：

| # | 字段 | 类型 | 归属 | 说明/空值 |
|---:|---|---|---|---|
| 1 | `_id` | string | core | `evidence-chain-plan:v1:<planKind>:<runId>:<phase>`；writer 必须等于 `evidence-chain-plan:v1:writer:we-<writerEpoch>:writer`（§18.2） |
| 2 | `kind` | string | core | 固定 `"plan"` |
| 3 | `scope` | string | core | 固定 `"global"` |
| 4 | `schemaVersion` | int | core | 固定 `1` |
| 5 | `planKind` | enum | core | `migration / recovery / writer` |
| 6 | `phase` | enum | core | `pre-anchor / final / recovery / writer` |
| 7 | `runId` | string | core | writer：`"we-" + decimal(writerEpoch)`（无前导零）；migration/recovery：非空（§18.2） |
| 8 | `issuedBy` | string | core | 签发 actor；初始票据的 `actor` |
| 9 | `issuedAt` | int | core | 安全整数；`windowStart ≤ issuedAt < windowEnd` |
| 10 | `windowStart` | int | core | 安全整数 |
| 11 | `windowEnd` | int | core | 安全整数 |
| 12 | `keyFingerprint` | string | core | 当前 K3 |
| 13 | `k3MarkerId` | string | core | 完整常量 ID，非空 |
| 14 | `sourceKind` | enum | core | `none / bootstrap / halted-fence` |
| 15 | `sourceHaltedEpoch` | int/null | core | 见空值表 |
| 16 | `sourceFenceDigest` | string/null | core | 见空值表 |
| 17 | `targetWriteEpoch` | int | core | 非空 |
| 18 | `targetAdmissionPolicyVersion` | string | core | 非空 |
| 19 | `targetWriterSetDigest` | string | core | 非空 |
| 20 | `targetProofId` | string | core | 非空；E0/E1 确定性 ID |
| 21 | `writerEpoch` | int/null | core | writer 非空安全正整数 e；且 `targetWriteEpoch=e`（§18.2） |
| 22 | `revokedWriterSetDigest` | string/null | core | writer 非空 |
| 23 | `revocationReceiptDigest` | string/null | core | writer 非空 |
| 24 | `finalInventoryDigest` | string/null | core | 见空值表 |
| 25 | `canonicalEvidenceCount` | int/null | core | 见空值表 |
| 26 | `canonicalHeadCount` | int/null | core | 见空值表 |
| 27 | `anchorCount` | int/null | core | 见空值表 |
| 28 | `auditedCollections` | array/null | core | 排序去重；见空值表 |
| 29 | `planDigest` | string | core | SHA-256(canonical 1–28) |
| 30 | `planTicket` | string | core | HMAC(plan/v1, canonical 1–29) |
| 31 | `status` | enum | status | `active / consumed / revoked` |
| 32 | `statusFrom` | enum | status | `none / active` |
| 33 | `statusTargetProofId` | string/null | status | 见规则 |
| 34 | `statusUpdatedAt` | int | status | 安全整数 |
| 35 | `statusReason` | enum | status | 见枚举 |
| 36 | `statusActor` | string | status | 执行/签发 actor |
| 37 | `statusTicket` | string | status | 当前状态票据 |
| 38 | `initialStatusTicket` | string | status | 初始 active 票据，不可变 |
| 39 | `runtimeTicket` | string/null | status | writer consumed 后非空 |

**digest/票据定义（唯一公式）**：

```text
core28 = 字段 1–28
planDigest   = SHA-256(canonical(core28))
planTicket   = HMAC-SHA256(K3, KEYED_DIGEST/h4-evidence-plan v1, canonical(core28 ∪ {planDigest}))

initialStatusTicket = HMAC-SHA256(K3, KEYED_DIGEST/h4-evidence-plan-status v1, canonical({
  planId:_id, fromStatus:"none", toStatus:"active", targetProofId:null,
  statusUpdatedAt:issuedAt, statusReason:"plan-issue", actor:issuedBy }))

statusTicket = HMAC-SHA256(K3, KEYED_DIGEST/h4-evidence-plan-status v1, canonical({
  planId:_id, fromStatus:statusFrom, toStatus:status,
  targetProofId:statusTargetProofId, statusUpdatedAt, statusReason, actor:statusActor }))

runtimeTicket = HMAC-SHA256(K3, KEYED_DIGEST/h4-evidence-writer-runtime v1, canonical({
  planId:_id, proofId:proof._id, writerEpoch, targetWriterSetDigest,
  k3MarkerId, keyFingerprint, activatedAt:statusUpdatedAt }))
```

**初始 active 票据（必填，禁止无票 active）**：`plan-issue` 必须在同一事务写入 `initialStatusTicket`，并令 `status="active"`、`statusFrom="none"`、`statusTargetProofId=null`、`statusUpdatedAt=issuedAt`、`statusReason="plan-issue"`、`statusActor=issuedBy`、`statusTicket=initialStatusTicket`（逐字节相等）。缺 `initialStatusTicket`、或 active 记录 `statusTicket≠initialStatusTicket`、或 `statusFrom≠"none"` → `PLAN_INVALID`。

**状态转移与票据**：

| 转移 | 触发 | `statusFrom` | `statusTargetProofId` | `statusReason` | `statusTicket` |
|---|---|---|---|---|---|
| `none→active` | plan-issue | `none` | `null` | `plan-issue` | `initialStatusTicket` |
| `active→consumed` | migration-finalize / recovery-finalize / writer-rotate | `active` | 该事务创建 proof 的 `_id` | `consumed:migration-finalize` 等 | 按公式计算 |
| `active→revoked` | plan-revoke | `active` | `null` | `revoked:plan-revoke` | 按公式计算 |

`statusReason` 枚举冻结：`plan-issue`、`consumed:migration-finalize`、`consumed:recovery-finalize`、`consumed:writer-rotate`、`revoked:plan-revoke`。

**各 planKind 空值规则（冻结；`null` 必须显式写入）**：

| 字段 | migration pre-anchor | migration final | recovery | writer bootstrap（UNPROVEN） | writer rotate（HALTED） |
|---|---|---|---|---|---|
| `phase` | `pre-anchor` | `final` | `recovery` | `writer` | `writer` |
| `runId` | 非空 | 非空 | 非空 | `we-<writerEpoch>`（如 `we-1`） | `we-<writerEpoch>`（如 epoch=4 时 `we-4`） |
| `sourceKind` | `none` | `none` | `halted-fence` | `bootstrap` | `halted-fence` |
| `sourceHaltedEpoch` | `null` | `null` | E0 | `null` | E0 |
| `sourceFenceDigest` | `null` | `null` | `fenceDigest(E0)` | `null` | `fenceDigest(E0)` |
| `writerEpoch` | `null` | `null` | `null` | 1（首次；重签取 e+1） | n+1（重签取 e+1） |
| `revokedWriterSetDigest` | `null` | `null` | `null` | 非空 | 非空 |
| `revocationReceiptDigest` | `null` | `null` | `null` | 非空 | 非空 |
| `finalInventoryDigest` | `null` | 非空 | 非空 | `null` | `null` |
| `canonicalEvidenceCount`/`canonicalHeadCount`/`anchorCount` | `0` | ≥0 | ≥0 | `0` | `0` |
| `auditedCollections` | `null` | 非空排序数组 | 非空排序数组 | `null` | `null` |
| `runtimeTicket`（issue 时） | `null` | `null` | `null` | `null` | `null` |
| `runtimeTicket`（consumed 后） | n/a | `null` | `null` | 非空 | 非空 |

- writer plan 的 `finalInventoryDigest` 为 `null`：重审 inventory 在执行事务内生成并写入 **proof.inventoryDigest**，由 `runtimeTicket.proofId` 绑定；writer plan 不在签发时预置审计结果。
- recovery/rotate 未改变 writer 集时，W1 的 `revokedWriterSetDigest/revocationReceiptDigest` 复用当前有效摘要，但必须非空；不得写 `null`。
- `targetWriteEpoch`/`targetProofId` 全部 planKind 非空（pre-anchor/final/bootstrap writer=E0，recovery/rotate=E1）；v8：writer 的 `targetWriteEpoch=writerEpoch`，重签取更大 e（§18.2/§18.5）。
- 空值规则由 `PlanRecordValid` 逐字段校验；违反 → `PLAN_INVALID`，零写。

**验证 refs（冻结）**：

- `planDigest/planTicket/initialStatusTicket/statusTicket/runtimeTicket` 的**全部签名输入**均持久化于 plan 记录（`issuedBy/statusActor/statusFrom/statusTargetProofId/statusUpdatedAt/statusReason`）或取自进程内 K3 config（key/domain）。
- 因此票据验证 **新增 0 个 store ref**：plan-issue/plan-revoke 仍 `plan+audit=2/2`；finalize/recovery/rotate 已声明 plan ref，票据验证复用；C1/C2 已声明 writerPlan ref。
- 禁止从内存 plan 对象、调用方入参或 admin_audit 反推签名字段。

**PlanRecordValid（统一）**：

```text
exact 39 字段（无额外/无缺省/类型正确）
∧ planDigest/planTicket 重算通过
∧ EmptyValueValid(planKind, phase) 按上表
∧ initialStatusTicket 重算通过
∧ WriterCanonicalId（planKind="writer"；§18.2）：
   phase="writer" ∧ writerEpoch=e 为安全正整数 ∧ runId="we-"+decimal(e)
   ∧ _id="evidence-chain-plan:v1:writer:we-"+decimal(e)+":writer"
   ∧ targetWriteEpoch=e
∧ status 分支：
   active ∧ planKind 任意 → statusFrom="none" ∧ statusTargetProofId=null
                            ∧ statusTicket=initialStatusTicket ∧ runtimeTicket=null
   consumed ∧ planKind="writer" → statusFrom="active" ∧ statusTargetProofId=targetProofId≠null
                                 ∧ statusTicket 重算通过
                                 ∧ runtimeTicket≠null ∧ runtimeTicket 重算通过（§17.1 R2）
   consumed ∧ planKind∈{"migration","recovery"} → statusFrom="active" ∧ statusTargetProofId=targetProofId≠null
                                 ∧ statusTicket 重算通过 ∧ runtimeTicket=null（显式）
   revoked → statusFrom="active" ∧ statusTargetProofId=null ∧ statusTicket 重算通过 ∧ runtimeTicket=null
```

- `targetProofId=f(当前 K3 fp, domainHeadRevision, writerEpoch)` 由执行事务校验（§18.2），不在 `PlanRecordValid` 内重算（plan-issue refs 2 不含 domain）。

### 17.3 健康过期 vs 显式 halted：谓词与唯一恢复流程

**问题复述**：v5 `FenceValid` 把 `now≤validUntil` 与结构/HMAC 校验绑在一个谓词里，过期即 `HALTED`；但同节 heartbeat 又必须能在过期后刷新，v6 更把 heartbeat 前置写成 `FenceValid` → 过期后既不能写业务、也不能 heartbeat，而 recovery 又要求 halted（过期 fence 仍是 clear），形成死锁；同时 §16.5 把“health 过期”直接记为 `CLEAR_EXPIRED→HALTED`，与 heartbeat 恢复相反。

**两类失败严格分离**：

| 类别 | fence.status | 判定 | 业务写 | 唯一恢复 |
|---|---|---|---|---|
| 健康过期 `CLEAR_EXPIRED(E)` | `clear` | `FenceStructValid ∧ now>validUntil ∧ now≥heartbeatAt−skew` | `EVIDENCE_CHAIN_FENCE_EXPIRED/409`，零写 | `fence-heartbeat` |
| 显式停写 `HALTED(E)` | `halted` | `status="halted"` | `EVIDENCE_CHAIN_HALTED/409`，零写 | recovery-finalize / writer-rotate（新 epoch） |
| 时钟异常 | `clear` | `now<heartbeatAt−CLOCK_SKEW_MS` | `EVIDENCE_CHAIN_HALTED/409`，零写 | 先 `fence-halt`，再 recovery；**不得 heartbeat** |

**谓词（唯一签名）**（`proof` 指当前 CoverageValid proof，后文为简洁省略该参数）：

```text
FenceRecordValid(f) =
  exact 12 字段 ∧ fenceDigest HMAC ∧ status∈{clear,halted}
  ∧ epoch/heartbeatAt/validUntil 安全整数 ∧ validUntil>heartbeatAt
  ∧ validUntil-heartbeatAt≤MONITOR_HEALTH_WINDOW_MS ∧ monitorId 有效

FenceStructValid(f, proof) = FenceRecordValid(f) ∧ epoch=proof.writeEpoch

FenceHealthy(f, now) =
  FenceStructValid(f, proof) ∧ status="clear"
  ∧ now≥heartbeatAt−CLOCK_SKEW_MS ∧ now≤validUntil

FenceExpired(f, now) =
  FenceStructValid(f, proof) ∧ status="clear"
  ∧ now>validUntil ∧ now≥heartbeatAt−CLOCK_SKEW_MS

FenceValid(f, now) = FenceHealthy(f, now)          // 业务写/runtime gate 唯一使用

FenceHeartbeatable(f, now) =
  FenceStructValid(f, proof) ∧ status="clear"
  ∧ now≥heartbeatAt−CLOCK_SKEW_MS                 // 允许 now>validUntil
```

- `FenceValid` **只**给 runtime genesis/append 与 Store gate 写阶段使用；`FenceHeartbeatable` **只**给 monitor `fence-heartbeat` 使用；任何事务不得混用。
- heartbeat 额外要求完整 `CoverageValid`（proof+marker+writerPlan），防止在 coverage 失效时续期；`fence-halt` 无 health 前置（只用 `FenceRecordValid`，不依赖 proof）。

**唯一恢复流程**：

```text
CLEAR_HEALTHY(E) --now>validUntil（无写，读时派生）--> CLEAR_EXPIRED(E)
CLEAR_EXPIRED(E) --fence-heartbeat（FenceHeartbeatable+CoverageValid；writes fence+audit）--> CLEAR_HEALTHY(E)
CLEAR_EXPIRED(E) --fence-halt（writes fence+audit）--> HALTED(E)
CLEAR_EXPIRED(E) --业务写--> EVIDENCE_CHAIN_FENCE_EXPIRED；零写；状态不变
CLEAR_HEALTHY(E) --fence-halt--> HALTED(E)
HALTED(E) --fence-heartbeat--> 拒绝 EVIDENCE_CHAIN_HALTED（heartbeat 不得复活 halted）
HALTED(E) --plan-issue(W)+recovery-finalize/writer-rotate--> CLEAR_HEALTHY(E1)
时钟异常 --fence-halt--> HALTED(E) --recovery/rotate--> CLEAR_HEALTHY(E1)
```

- 过期是**读时派生状态**，不写 fence；多次读结果一致、幂等；“过期”与“halted”不会互相覆盖。
- `fence-heartbeat` 只更新 `heartbeatAt=now`、`validUntil=now+window`、`updatedAt=now`；`status` 保持 `clear`、`epoch` 不变；写 fence+audit（refs 7）。
- `fence-halt` 可从 `CLEAR_HEALTHY` 或 `CLEAR_EXPIRED` 进入；写 fence+audit，`reasonCode` 记录 `health-expired` 或 `monitor-halt`。
- recovery/rotate 的 source 必须是 `status="halted"`；`CLEAR_EXPIRED` 不是合法 source（先 halt）。

**错误码增量**：

| 情形 | code | HTTP |
|---|---|---:|
| fence clear 且 `now>validUntil` | `EVIDENCE_CHAIN_FENCE_EXPIRED` | 409 |
| fence halted / 缺失 / epoch 不符 / 时钟回拨 | `EVIDENCE_CHAIN_HALTED` | 409 |
| heartbeat on halted | `EVIDENCE_CHAIN_HALTED` | 409 |

`EVIDENCE_CHAIN_FENCE_EXPIRED` 为 v7 新增；C2 统一投影 409；不得与 `HALTED` 混用。

### 17.4 统一状态机、谓词矩阵与用例

**全局状态（fence/proof 维度）**：

| 状态 | 判定 | proof | fence | 允许事务 |
|---|---|---|---|---|
| `BOOTSTRAP` | 无 domain/marker/fence/proof | 无 | 无 | k3-bootstrap |
| `UNPROVEN` | domain+marker；无 proof/fence；可无 writer plan | 无 | 无 | plan-issue(writer bootstrap)、migration-anchor、migration-finalize |
| `CLEAR_HEALTHY(E)` | proof E；fence clear 且 `FenceHealthy` | E | clear | runtime genesis/append、monitor heartbeat/halt |
| `CLEAR_EXPIRED(E)` | proof E；fence clear 且 `FenceExpired` | E | clear | 仅 monitor heartbeat/halt；业务写 `FENCE_EXPIRED` |
| `HALTED(E)` | fence `status="halted"` | E | halted | plan-issue(recovery/writer)、recovery-finalize、writer-rotate、monitor halt |

**转移表（含 refs/writes）**：

| # | 从 | 事件 | 到 | 授权 | refs | writes |
|---:|---|---|---|---|---:|---:|
| T1 | BOOTSTRAP | k3-bootstrap | UNPROVEN | maintenance manifest+ticket | 5 | 4 |
| T2 | UNPROVEN | plan-issue(writer,`bootstrap`) | UNPROVEN | plan-issue | 2 | 2 |
| T3 | UNPROVEN | migration-finalize | CLEAR_HEALTHY(E0) | migration plan+W0 | 8 | 5 |
| T4 | CLEAR_HEALTHY(E) | genesis/append | CLEAR_HEALTHY(E) | C1/C2 admission | 17/26 | 3/2 |
| T5 | CLEAR_HEALTHY(E) | `now>validUntil` | CLEAR_EXPIRED(E) | 读时派生 | 0 | 0 |
| T6 | CLEAR_EXPIRED(E) | fence-heartbeat | CLEAR_HEALTHY(E) | FenceHeartbeatable+CoverageValid | 7 | 2 |
| T7 | CLEAR_HEALTHY(E)/CLEAR_EXPIRED(E) | fence-halt | HALTED(E) | monitor（`FenceRecordValid`） | 7 | 2 |
| T8 | HALTED(E) | plan-issue(recovery/writer) | HALTED(E) | plan-issue | 2 | 2 |
| T9 | HALTED(E) | recovery-finalize | CLEAR_HEALTHY(E1) | recovery plan+W1 | 8 | 5 |
| T10 | HALTED(E) | writer-rotate | CLEAR_HEALTHY(E1) | W1 | 8 | 4 |

不可能转移（显式拒绝）：`HALTED→CLEAR_EXPIRED`、`CLEAR_EXPIRED→recovery/rotate`、`HALTED→heartbeat`、`UNPROVEN→runtime`、`CLEAR→migration-finalize`。

> v8：T2/T8 的 plan-issue 仍 **2/2**；writer plan 的 canonical ID/runId 与每 epoch 唯一性见 §18.2/§18.4（refs/writes 不变）。

**谓词使用矩阵**：

| 事务 | 必过谓词 | 不得使用 |
|---|---|---|
| C1 genesis/append、C2 R1 | K3DomainExact+K3MarkerValid+CoverageValid(含 WriterPlanValid)+FenceValid+AdmissionValid | FenceHeartbeatable |
| migration-anchor | plan(active)+K3+pre-fence（fence 不存在或非 halted） | FenceValid |
| migration-finalize | migration plan(active)+W0(active,`bootstrap`)+fence 不存在+target 一致 | WriterPlanValid |
| recovery-finalize | recovery plan(active)+W1(active,`halted-fence`)+fence halted source CAS+K3 | FenceValid |
| writer-rotate | W1(active,`halted-fence`)+fence halted source CAS+K3 | FenceValid |
| monitor heartbeat | FenceHeartbeatable+CoverageValid | FenceValid |
| monitor halt | FenceRecordValid（无 health/proof 前置） | FenceValid |

### 17.5 refs/writes 静态核算（v7 权威，覆盖 §7/§15.4/§16.5）

| 事务 | refs 组成 | refs | writes 组成 | writes |
|---|---|---:|---|---:|
| C1 首条/非首条 | domain2+audit1+fence1+marker1+writerPlan1+anchor1+head1+E1..9 | **17** | anchor+E+head / E+head | 3/2 |
| C2 R1 | C1 17+org/member/job/grant4+op key/op domain3+job log/op log2 | **26** | job/evidence/head/anchor/log/op/audit（唯一 admin_audit 已含 C1 audit1；domain 只读） | — |
| migration-anchor | domain2+fence1+marker1+writerPlan1+plan1+head1+E9+anchor1+audit1 | **18** | anchor+audit | 2 |
| migration-finalize | domain2+fence1+marker1+W0+plan1+proof1+audit1 | **8** | fence+proof+migrationPlan+W0+runtimeTicket+audit | **5** |
| recovery-finalize | domain2+fence1+marker1+W1+recoveryPlan1+proof1+audit1 | **8** | fence+proof+recoveryPlan+W1+runtimeTicket+audit | **5** |
| writer-rotate | domain2+fence1+marker1+W0+W1+proof1+audit1 | **8** | fence+proof+W1+runtimeTicket+audit | **4** |
| monitor heartbeat/halt | domain2+proof1+fence1+marker1+writerPlan1+audit1 | **7** | fence+audit | 2 |
| k3-bootstrap | domain2+fence1+marker1+audit1 | **5** | domain2+marker+audit | 4 |
| plan-issue/plan-revoke | plan1+audit1 | **2** | plan+audit | 2 |
| C2 R2 | H4-b 8+N | **≤90** | 独立 | — |

- 单事务上限 90；最大 C2 R1 **26**，余量 **64**。
- 票据验证（planDigest/planTicket/initialStatusTicket/statusTicket/runtimeTicket）**0 新增 refs**；票据字节已含在该事务的 plan 写中。
- `runtimeTicket` 不是新集合/新记录：它是 plan 记录内字段（§17.2 #39），不新增 ref。
- 所有 refs 去重；8 集合不变（evidence/head/domains/anchor/audit/fence/k3-marker/plans）。
- C2 R1 不新增 domain/fence/第二个 audit；唯一 admin_audit 已计入 C1 17 的 audit1。

**写入增量相对 v6**：migration-finalize 4→**5**（+W0 consumed/runtimeTicket）；recovery-finalize 4→**5**（+W1）；writer-rotate 5→**4**（不再写旧 W0）。refs 全部不变。

- **v8（§18.8）唯一性成本**：writer plan canonical `_id` 的属性检查是纯本地计算，plan-issue/plan-revoke 仍 **2/2**，finalize/recovery/rotate/C1/C2 预算不变；不新增集合/索引/epoch 计数记录。若未来改用 epoch 索引记录/CAS 计数器（本卡不采用），plan-issue 变 3/3、执行事务 +1 ref，须整体重算后才可实现。

### 17.6 v7 裁定与矩阵

**新增 Q36–Q40**：

| Q | 事项 | 建议 |
|---|---|---|
| Q36 | 一次性执行授权（active→consumed）与持久运行授权（consumed+runtimeTicket+proof 绑定）分离；runtime 不接受 active；旧 W0 不写 | 批准 |
| Q37 | plan 39 字段冻结；initialStatusTicket；各 planKind 空值规则；票据验证 0 新增 refs | 批准 |
| Q38 | CLEAR_EXPIRED 与 HALTED 分离；FenceRecordValid/FenceStructValid/FenceHealthy/FenceValid/FenceHeartbeatable；新增 FENCE_EXPIRED；唯一恢复流程 | 批准 |
| Q39 | 每个 proof 消费一个 writer plan；migration-finalize/recovery-finalize 8/5、writer-rotate 8/4；C1 17/C2 26 不变 | 批准 |
| Q40 | N113–N132 矩阵与 v7 预算 | 批准 |

> v8 追加 Q41–Q44/N133–N142 见 §18.11；§18 覆盖 §17.1 R7 的唯一性表述与 §17.2 的 consumed 分支（不改变 R1–R6、39 字段与 §17.3）。

**新增 N113–N132**：

| ID | 场景 | 期望 |
|---|---|---|
| N113 | writer-rotate 成功后 W1=`consumed`+runtimeTicket；runtime append | 成功（旧 active 规则不再适用） |
| N114 | runtime 遇到仅 `active`、未被当前 proof 引用的 writer plan | PROOF_REQUIRED；零写 |
| N115 | W1 `consumed` 但 runtimeTicket 缺失/HMAC/字段不符 | PROOF_REQUIRED；零写 |
| N116 | runtimeTicket proofId/planId/writerEpoch/setDigest/marker 不符 | PROOF_REQUIRED；零写 |
| N117 | 旧 W0 保持 consumed、旧 proof E0 非当前 | 无运行授权；E0 append 失败 |
| N118 | plan 39 字段 exact；planDigest/planTicket 重算 | 通过；缺/多字段拒绝 |
| N119 | statusTicket 的 fromStatus/actor/targetProofId 从持久记录重建 | 通过；缺失字段 PLAN_INVALID |
| N120 | active 记录 `statusTicket≠initialStatusTicket`/`statusFrom≠none` | PLAN_INVALID；零写 |
| N121 | consumed 票据重放/二次 consume | PLAN_CONSUMED；零写 |
| N122 | revoke 票据 targetProofId 非 null | PLAN_INVALID；零写 |
| N123 | 各 planKind 空值规则逐字段（migration pre/final、recovery、writer bootstrap/rotate） | 通过/拒绝按表 |
| N124 | 首次 UNPROVEN writer plan：`sourceKind=bootstrap`+source null 接受；source 非 null/halted-fence 缺失 | 通过 / PLAN_INVALID |
| N125 | CLEAR_HEALTHY 过期后业务 append | FENCE_EXPIRED；零写；status 仍 clear |
| N126 | CLEAR_EXPIRED + fence-heartbeat（FenceHeartbeatable+CoverageValid） | CLEAR_HEALTHY；writes fence+audit；随后 append 成功 |
| N127 | HALTED + fence-heartbeat | HALTED；零写；不得复活 |
| N128 | CLEAR_EXPIRED + fence-halt → recovery/rotate | HALTED→CLEAR_HEALTHY(E1)；原子写 |
| N129 | 时钟回拨（now<heartbeatAt−skew）+ heartbeat | HALTED；零写；只能 halt→recovery |
| N130 | 谓词混用：业务写用 FenceHeartbeatable / heartbeat 用 FenceValid | 拒绝（实现级断言） |
| N131 | refs/writes：C1 17（3/2）、C2 26、migration-anchor 18（2）、migration-finalize 8（5）、recovery 8（5）、rotate 8（4）、monitor 7（2）、k3 5（4）、plan 2（2） | ≤90；无未声明写 |
| N132 | statusTicket/runtimeTicket 验证新增 refs | 0；预算不变 |

### 17.7 v7 未解决/未验证

- 完整云报告正文不可读；报告内未列明项待裁，不猜测关闭。
- Q36–Q40 待 Codex 裁定；v6 及更早中与 §17 相反的预算/scope/状态以 §17 为准。
- 未运行测试；N01–N132 为设计矩阵；无 C1/C2/C3 实现。
- 同 K3 writer 变化的真实 DB 撤权、维护窗口、monitor 运维证据未验证。
- 受信时钟、`MONITOR_HEALTH_WINDOW_MS`/`CLOCK_SKEW_MS` 取值与部署环境实际偏差未验证；N129 仅为设计用例。
- 闸门状态：G3 `5f1d7a4` 关闭/O10 PASS；G4 通过；07B 离线门禁通过；main/07B 合并、C1 实现、C2/C3、HTTP/UI、部署上线冻结。
- **v8（§18）**：只修 writer plan/epoch 唯一性与 consumed 按 planKind 校验；§17.1 R1–R6、§17.2 39 字段/签名公式、§17.3 health 谓词未重开（§18.10）；新增 Q41–Q44/N133–N142，预算不变。
- 本稿只改设计文档；未安装/运行测试、未实现、未云事务、未触商户/设备/支付/身份证。

### 17.8 全文同步对照（移除相反表述）

| # | 原位置 | v6/更早表述 | v7 处理 |
|---:|---|---|---|
| S1 | §15.3 `:694-705` | `FenceValid` 含过期且 heartbeat 可刷新 | 谓词拆分；heartbeat 用 `FenceHeartbeatable`；§17.3 |
| S2 | §15.3 `:710` | `CLEAR_EXPIRED` 仅作“runtime 视为停写”备注，未给恢复谓词 | 明确 `CLEAR_EXPIRED` 状态与 heartbeat 唯一恢复；§17.3 |
| S3 | §16.2 `:843` | statusTicket 覆盖字段但未持久化 | 39 字段冻结+initialStatusTicket；§17.2 |
| S4 | §16.2 `:845` | statusTicket 绑定 planId/from/to/targetProofId | 全部签名输入持久化；§17.2 |
| S5 | §16.3 `:857` | recovery writes=4 | 5（+writerPlan consumed/runtimeTicket）；§17.5 |
| S6 | §16.3 `:860` | heartbeat 要求 `FenceValid` | 改为 `FenceHeartbeatable`；§17.3 |
| S7 | §16.4 `:862` | `WriterPlanValid` 要求 active | 改为 consumed+runtimeTicket+proof 绑定；§17.1 |
| S8 | §16.4 `:876/:877/:879` | rotate 置 W1 consumed、runtime 读 active | runtime 读 consumed+runtimeTicket；旧 W0 不写；§17.1 |
| S9 | §16.5 `:889-890` | finalize/recovery writes=4 | 5；§17.5 |
| S10 | §16.5 `:898` | health 过期→HALTED 且 heartbeat 可恢复 | `CLEAR_EXPIRED≠HALTED`；唯一恢复；§17.3 |
| S11 | §16.6 `:918-924` | Q32–Q35 建议 | 由 Q36–Q40 补强；§17.6 |
| S12 | §14 `:587-588` | v6 预算/N01–N112 | v7 预算/N01–N132；§17.5/§17.6 |

---

## 18. v8 权威修订（writer plan ↔ epoch 唯一性；覆盖 §17/§16/§15 冲突处）

> v8 输入：`bc80f741981cade3e4e3d65df709c24f31556c06`（父 `7f42280`）。真实派单：独立任务 A；唯一修改文件为本卡；工作树 `C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\c1-epoch-uniqueness`，分支 `docs/hk-face-c1-epoch-uniqueness`；只追加提交，不 amend/rebase/reset/squash/force/merge。
>
> 输入核对：`docs/hk-face-c1-v7-review-fixes` 本地 ref 与 origin tip 均为 `bc80f74…`，无前移/分叉/平行提交；输出分支创建前不存在。**凡与 §18 相反（writer plan ID/runId、epoch 唯一性、重签/终态、consumed 校验）以 §18 为准。** v8 不改变 §17.1 R1–R6、§17.2 39 字段/签名公式、§17.3 健康谓词。

### 18.0 退修项与闭合位置

| # | 退修项 | 原表述/问题 | v8 规则 | 位置 |
|---:|---|---|---|---|
| 1 | 同 epoch 至多 1 active 不可证 | §17.1 R7 称“`_id` 含 epoch”，但 §17.2 字段 1 的 `_id` 含**任意** `runId`，字段 7 仅要求“非空”；同 epoch 可用不同 runId 再写一条 active | 冻结 writer plan 与 epoch 一一对应：`runId="we-<e>"`、`planId(e)="evidence-chain-plan:v1:writer:we-<e>:writer"`；每 epoch 至多一条 valid plan，由 `_id` create-only 证明 | §18.2、§18.4 |
| 2 | plan+audit refs 不能证明唯一 | plan-issue refs=2（目标 plan+audit），不枚举同 epoch 其它 plan；refs 无“至多一条”语义 | 唯一性不依赖 refs/扫描：`planId(e)` 是 e 的纯函数 + Store `_id` create-only；不新增索引 | §18.1、§18.4、§18.8 |
| 3 | 作用域/重签/终态未定义 | 未说明唯一性跨哪些 K3 世代、撤销/过期后能否重签、consumed/revoked 后同 epoch 能否再签 | 作用域=同一 K3 世代 H4-c 全局；重签必须 `e'>e`；consumed/revoked/expired 同 epoch 重签一律 `PLAN_DUPLICATE`；旧记录不改写 | §18.3、§18.5 |
| 4 | consumed 校验未按 planKind | §17.2 `:1148-1151` 统一要求 `runtimeTicket` 重算，同处又只允许 migration/recovery 为 null；writer 的 runtimeTicket 校验未显式分派 | `consumed ∧ writer` 必须 `runtimeTicket≠null` 且验签；`consumed ∧ migration/recovery` 必须显式 `null`；active/revoked 一律 `null` | §18.7、§17.2 PlanRecordValid |
| 5 | 并发/不同 epoch/终态重签无唯一预期 | 未给“同 epoch 不同 runId 并发”“不同 epoch 共存”“终态重签”的确定性结果 | 见 §18.6 预期矩阵；执行由 source 绑定 + target proof create-only 串行化，恰好一个执行胜 | §18.6 |

### 18.1 问题与反例（为什么 refs 不能证明唯一）

- v7 声称“同一 `writerEpoch` 至多一个 active plan（`_id` 含 epoch）”，但：
  1. `_id` 公式为 `...:<planKind>:<runId>:<phase>`，`runId` 任意非空；
  2. `writerEpoch` 是独立字段，未进入 `_id`；
  3. `evidence_chain_plans` 只按声明的 refs 点读，plan-issue refs=2（目标 plan+audit），不读取/枚举同 epoch 其它 plan；
  4. 因此签发方可用 `runId=A` 与 `runId=B` 在同一 epoch 各写一条 active plan；两条 `_id` 不同、core/ticket 各自有效，v7 规则无法拒绝；`plan+audit` refs 也无法表达“同 epoch 唯一”。
- 反例（设计级，不执行）：`e=7`，`_id1=...:writer:A:writer`、`_id2=...:writer:B:writer`；两条均 `writerEpoch=7`、`status=active`、`sourceKind=bootstrap`；二者都能通过 v7 `PlanRecordValid`。两个执行事务的 `targetProofId` 相同（确定性）→ proof create-only 只能一胜；但“至多一个 active”已被违反，且失败方重试语义不确定。
- 结论：必须把 epoch 编入可验证身份（或把 runId 冻结为 epoch 的确定性函数），使“同 epoch 第二条”在 `_id`/`PlanRecordValid` 层即不可表达；不能依赖 refs 数量或调用方自述。

### 18.2 冻结：canonical plan ID 与确定性 runId（planId↔epoch 绑定）

- writer plan 的 epoch 字段：`writerEpoch=e`（安全正整数）。
- 确定性 runId：`runId = "we-" + decimal(e)`（无前导零、无符号/空白；如 `we-7`）。
- canonical plan ID：`planId(e) = "evidence-chain-plan:v1:writer:we-" + decimal(e) + ":writer"`（与通用公式 `<planKind>:<runId>:<phase>` 一致，`planKind="writer"`、`phase="writer"`）。
- 绑定关系：`planId(e)/writerEpoch/targetWriteEpoch` 由 e 唯一确定；`targetProofId` 在给定当前 K3 `keyFingerprint` 与 `domainHeadRevision` 下同样由 e 唯一确定（§4.2/§15.2.1）：

```text
planId(e)        = evidence-chain-plan:v1:writer:we-<e>:writer
writerEpoch      = e
targetWriteEpoch = e
targetProofId(e) = f(K3 keyFingerprint, domainHeadRevision, e)   // 执行事务校验
```

- 冻结校验 `WriterCanonicalId`（并入 `PlanRecordValid`）：

```text
planKind="writer"
→ phase="writer"
 ∧ writerEpoch=e 为安全正整数
 ∧ runId="we-"+decimal(e)
 ∧ _id="evidence-chain-plan:v1:writer:"+runId+":writer"
 ∧ targetWriteEpoch=e
```

  任一不符 → `PLAN_INVALID`，零写；不得执行、不得用于 runtime 绑定。
- `targetProofId` 校验点：plan-issue refs=2（plan+audit）**不读 K3 domain**，故不在签发事务重算 `f`；执行事务（migration-finalize/recovery-finalize/writer-rotate 已声明 domain2）必须校验 `targetProofId=f(当前 K3 fp, 当前 domainHeadRevision, writerEpoch)`；不等 → `PLAN_INVALID`/`PLAN_STALE`，零写（与 §15.2.2 绑定语义一致；不新增 ref）。
- `planDigest/planTicket` 覆盖 core（含 `runId/writerEpoch/targetWriteEpoch/targetProofId`），ID/epoch 绑定受签名保护；改任一字段即 digest/ticket 失效。
- 不新增字段：仍 39 字段（§17.2）；`runId` 语义由“任意非空”收紧为“writer 确定性、migration/recovery 非空”。

### 18.3 作用域

| 维度 | 冻结 |
|---|---|
| 适用 planKind | 仅 `writer`；migration/recovery 不做 epoch 一一对应（可多份草案），执行安全由 target proof create-only + plan consumed 保证 |
| 链范围 | H4-c 全局单链（唯一 global fence/proof），不是 per-job/per-org |
| K3 世代 | 同一 `k3MarkerId` + `keyFingerprint` 世代内；K3 变化后 `writerEpoch` 必须严格增大（沿用 §4.2 `writeEpoch` 单调），旧 plan 因 `keyFingerprint`/domain 不符 `PLAN_INVALID`，不得复用 |
| 记录范围 | 唯一性表述为“每个 epoch 至多一条 **valid** writer plan”；非规范历史记录（runId≠`we-<e>`、ID 不符）不是 valid plan，不可执行，不计入唯一性；不得删除/改写历史记录 |
| 时间范围 | `windowStart ≤ issuedAt < windowEnd`；window 只约束执行，不约束已 consumed 的 runtime（§17.1 R3） |

- 作用域外 plan（不同 `k3MarkerId`/`keyFingerprint`、不同 planKind）不参与该 epoch 唯一性；同一 `planId` 仍受 create-only 保护。

### 18.4 唯一性证明（create-only 即索引，不需要新索引）

**命题 U1**：对任意 `writerEpoch=e`，至多存在一条满足 `PlanRecordValid` 的 writer plan 记录。

**证明**：
1. 若记录有效，§18.2 强制 `runId="we-"+e` 且 `_id=planId(e)`；`planId(e)` 只依赖 e，与 actor/调用方/时间无关。
2. `evidence_chain_plans` 对 `_id` 为 exact/create-only（§15.2.1）；Store 在 `_id` 已存在时拒绝写入，不 upsert、不覆盖。
3. 第二条同 epoch 写入只能使用同一 `_id`，被 create-only 拒绝；使用其它 `_id` 的记录违反 §18.2，`PlanRecordValid` 失败。
4. 故至多一条有效记录 ⇒ 至多一个 `status="active"`。∎

**推论**：
- 两个 canonical plan-issue 并发：恰好一个 create 成功；失败方 `PLAN_DUPLICATE/409`，零写（无 plan、无 audit）。并发时两事务都可能先读到“不存在”；胜负由 Store `_id` create-only 裁决（不是先读判定），败者映射 `PLAN_DUPLICATE`。
- 同 epoch 不同 runId：非 canonical 方在 `PlanRecordValid`/plan-issue 即 `PLAN_INVALID`，零写；canonical 方成功。二者不可能同时成为有效 plan。
- 证明不使用 refs 枚举、不扫描集合、不需要新索引；`plan+audit` refs 只承担读写与审计，不承担唯一性证明。
- **实现前提**：Store 必须对 `evidence_chain_plans` 提供 `_id` create-only（不存在才写）；plan-issue 不得用 upsert/change/persist 覆盖。C1 实现卡必须验证；本卡不声称运行时已闭合。

### 18.5 撤销、过期与重签；终态规则

| 概念 | 定义 | 同 epoch 重签 |
|---|---|---|
| active | 一次性执行授权未使用（§17.1） | 禁止（记录已存在）→ `PLAN_DUPLICATE` |
| consumed | 执行事务已消费；终态 | 禁止；只能 `e'>e` |
| revoked | `plan-revoke` 后终态 | 禁止；只能 `e'>e` |
| expired | 不是 status；`now ≥ windowEnd` 时读时派生 | 禁止；先 revoke（active→revoked），再 `e'>e` |

- **重签（re-sign）= 新 epoch**：对被重签 plan 的 epoch e，重签必须选择 `e' > e` 且 `planId(e')` 不存在的 epoch（建议 `e+1`；门禁不要求连续，见 §18.6）；重新签发完整 39 字段记录 + `initialStatusTicket`；旧记录保持原状态（过期 active 先 revoke 后为 revoked；consumed/revoked 不变），**不修改、不删除、不复活**；不得用同一 `_id` 覆盖。门禁不扫描“全局最大 epoch”；若 `e'<e` 且 `planId(e')` 从未使用，则它是独立新签发而非重签，仍受 create-only 与执行 source/target 约束。
- **终态不可逆**：`consumed`/`revoked` 无出边；不得 `→active`、不得互换；status 只允许一次 `active→consumed` 或 `active→revoked`（§17.1 R6 不变）。
- **撤销**：`plan-revoke` 只允许 `active→revoked`（`statusReason="revoked:plan-revoke"`）；已 consumed/revoked → `PLAN_CONSUMED`/`PLAN_REVOKED`；refs 2/writes 2 不变。
- **过期**：不改写 status；执行时 `PLAN_EXPIRED/409`；已 consumed 的 plan 不因 window 过期失去运行授权（§17.1 R3）。
- **来源绑定不变**：bootstrap 重签仍要求 fence 不存在；halted-fence 重签仍要求 source fence halted `E0` 且 digest 匹配；`CLEAR_EXPIRED` 仍不是合法 source（先 halt）。
- **目标 epoch**：只需 `targetWriteEpoch > sourceEpoch`（bootstrap ≥1）；允许跳号（如 E1 过期撤销后重签 E2）。安全不变量是“每 epoch 至多一条 valid plan + 每 epoch 至多一个 proof”，不是“epoch 连续”；跳号不削弱重审（执行事务仍生成完整 final inventory 并写入 `proof(e')`）。
- **consumed 后更换 writer 集**：沿用既有 halt→W(e+1)→rotate/recovery 流程；不得在 CLEAR 下直接签发新 writer plan。
- **为何不覆盖/不复活**：同 epoch 覆盖需 upsert/删除或 epoch 索引+枚举，破坏 create-only 与终态不可逆；本卡选择重签跳号（`e+1`），以 0 新增索引换取可证明唯一性。

### 18.6 唯一预期矩阵（同 epoch 不同 runId / 不同 epoch / 终态重签）

| # | 场景 | 唯一预期 | 结果/零写 |
|---:|---|---|---|
| 1 | 同 epoch e，两个 canonical（runId 均 `we-e`）并发签发 | 恰好一条记录、一个 active | 一胜；败者 `PLAN_DUPLICATE/409`；plan+audit 零写 |
| 2 | 同 epoch e，runId `A`/`B`（非 canonical） | 0 条非 canonical 记录；若 canonical 同时存在，仅它有效 | 非 canonical `PLAN_INVALID`；零写 |
| 3 | 同 epoch e，串行重签（前一条 active/consumed/revoked/expired） | 不再新增记录 | `PLAN_DUPLICATE`；零写 |
| 4 | 不同 epoch e1<e2（bootstrap） | 两条可共存；fence 不存在只允许一次执行 | 恰好一个 proof；另一 `PLAN_STALE` |
| 5 | 不同 epoch e1<e2（halted-fence，同源 E0） | 两条可共存；source CAS+fence 只允许一次执行 | 恰好一个 proof/fence 更新；另一 `PLAN_STALE` |
| 6 | consumed 后同 epoch 重签 | 禁止；只能 `e'>e` | `PLAN_DUPLICATE` |
| 7 | revoked 后同 epoch 重签 | 禁止；只能 `e'>e` | `PLAN_DUPLICATE` |
| 8 | expired（active，`now≥windowEnd`）后同 epoch 重签 | 禁止；先 revoke，再 `e'>e` | `PLAN_EXPIRED`/`PLAN_DUPLICATE`；零写 |
| 9 | 重签目标 epoch 已有记录（`planId(e')` 存在，含 `e'≤e`） | 拒绝 | `PLAN_DUPLICATE` |
| 10 | K3 世代变化后复用旧 epoch | 拒绝 | `PLAN_INVALID`；须 `e'>旧 e` |

- 执行串行化：`targetWriteEpoch > sourceEpoch`（bootstrap ≥1）+ `targetProofId` create-only + source fence CAS；竞争集合中**恰好一个**执行事务成功，其余 `PLAN_STALE`/`PLAN_CONSUMED`，无双 proof/fence。
- 不同 epoch 的 active plan 可共存；唯一性只约束“每 epoch 至多一条 valid plan”，不约束“全局同时至多一条 active”。全局至多一个**当前** proof 由 fence/proof 单例与 `CoverageValid` 保证。

### 18.7 consumed 校验按 planKind（修正 §17.2 `:1148-1151`）

| planKind | status | `runtimeTicket` | 验签 | 失败 |
|---|---|---|---|---|
| writer | consumed | 必须非 null | 必须重算通过（`planId/proofId/writerEpoch/targetWriterSetDigest/k3MarkerId/keyFingerprint/activatedAt`，§17.1 R2） | `PLAN_INVALID` |
| migration | consumed | 必须显式 JSON `null` | 不适用 | `PLAN_INVALID` |
| recovery | consumed | 必须显式 JSON `null` | 不适用 | `PLAN_INVALID` |
| 任意 | active | 必须 `null` | 不适用 | `PLAN_INVALID` |
| 任意 | revoked | 必须 `null` | 不适用 | `PLAN_INVALID` |

- 替换 §17.2 的单一 consumed 式：

```text
status="consumed" ∧ planKind="writer"
  → statusFrom="active" ∧ statusTargetProofId=targetProofId≠null
    ∧ statusTicket 重算通过
    ∧ runtimeTicket≠null ∧ runtimeTicket 重算通过（proofId 取 statusTargetProofId）
status="consumed" ∧ planKind∈{"migration","recovery"}
  → statusFrom="active" ∧ statusTargetProofId=targetProofId≠null
    ∧ statusTicket 重算通过
    ∧ runtimeTicket=null（显式写入）
```

- writer 的 `runtimeTicket.proofId` 必须等于 `statusTargetProofId`，且等于执行事务创建的 proof `_id`；不等 → 读取时 `PLAN_INVALID`，runtime 绑定失败 `PROOF_REQUIRED`。
- 本补全不改变 39 字段、签名公式与 `runtimeTicket` 定义（§17.1 R2）；只把 v7 的歧义分支按 planKind 拆开。

### 18.8 refs/writes 核算（结论：0 新增）

| 事务 | v7 refs/writes | v8 refs/writes | 说明 |
|---|---:|---:|---|
| plan-issue（canonical writer） | 2/2 | **2/2** | `planId(e)` 即索引键；create-only 由 `_id` 语义提供 |
| plan-issue（重复同 epoch） | — | 2 读 / 0 写 | 读 plan 发现已存在 → `PLAN_DUPLICATE`，不写 audit |
| plan-revoke | 2/2 | **2/2** | 不变 |
| migration-finalize | 8/5 | **8/5** | plan ref 已含 |
| recovery-finalize | 8/5 | **8/5** | 同上 |
| writer-rotate | 8/4 | **8/4** | 同上 |
| C1 / C2 R1 | 17 / 26 | **17 / 26** | 不变 |

- 不新增集合/索引/epoch 计数记录；不新增 store ref；`WriterCanonicalId` 是纯本地计算。
- 若未来新增“epoch 索引记录/CAS 计数器”（本卡不采用），必须重算：plan-issue 3/3（+索引 ref+写）、执行事务 +1 ref（读索引）、C2 R1 27（余量 63）；未重算前不得实现该变体。
- 唯一性只依赖 `_id` create-only；若 Store 实际为 upsert，则 §18.4 不成立，属实现阻断。

### 18.9 错误码增量

| 情形 | code | HTTP |
|---|---|---:|
| plan-issue 同 epoch canonical `_id` 已存在（任意状态） | `PLAN_DUPLICATE` | 409 |
| writer runId/planId/phase/targetWriteEpoch 非 canonical；执行时 targetProofId≠f(...) | `PLAN_INVALID` | 409 |
| consumed 的 writer 缺/坏 `runtimeTicket` | `PLAN_INVALID` | 409 |
| consumed 的 migration/recovery 带非 null `runtimeTicket` | `PLAN_INVALID` | 409 |

- C2 统一投影 409；`PLAN_DUPLICATE`（重复签发/记录已存在）与 `PLAN_CONSUMED`（执行时已被消费）区分。

### 18.10 与已关闭项的一致性（不重开）

| 已关闭项 | v7 位置 | v8 是否改变 | 说明 |
|---|---|---|---|
| 一次性执行授权/持久运行授权分离 | §17.1 R1–R6 | 否 | runtime 仍要求 consumed+`runtimeTicket`+`proof.writerPlanId`；active 仍不放行 |
| 39 字段 schema/`initialStatusTicket`/票据 0 refs | §17.2 | 否（只收紧字段 1/7/21 语义与 consumed 分支） | 字段数/签名公式不变 |
| `FENCE_EXPIRED` 与 `HALTED` 分离/唯一恢复 | §17.3 | 否 | 谓词/状态机未改 |
| refs/writes 预算 | §17.5 | 否 | 17/26/18/8/8/8/7/5/2 不变 |

- 只修正 §17.1 R7 的不可证表述与 §17.2 的 planKind 分支；不改变任何已关闭语义。

### 18.11 v8 裁定与矩阵

**新增 Q41–Q44**：

| Q | 事项 | 建议 |
|---|---|---|
| Q41 | writer plan canonical ID/runId（`we-<e>`）、planId↔epoch 绑定、作用域 | 批准 |
| Q42 | 每 epoch 至多一条 valid plan；`_id` create-only 证明；无新索引 | 批准 |
| Q43 | 撤销/过期/终态重签只能 `e'>e`；同 epoch `PLAN_DUPLICATE`；不同 epoch 执行恰好一胜 | 批准 |
| Q44 | consumed 按 planKind：writer 必验 `runtimeTicket`，migration/recovery 必 `null`；refs 2/2 不变 | 批准 |

**新增 N133–N142**：

| ID | 场景 | 期望 |
|---|---|---|
| N133 | 同 epoch canonical 并发签发 | 一胜；败者 `PLAN_DUPLICATE`；零写 |
| N134 | 同 epoch 不同 runId（A/B）签发 | `PLAN_INVALID`；无非 canonical 记录 |
| N135 | 同 epoch 串行重签（active/consumed/revoked/expired） | `PLAN_DUPLICATE`；旧记录不变 |
| N136 | 不同 epoch（bootstrap）共存并竞争执行 | 恰好一个 proof/fence；另一 `PLAN_STALE` |
| N137 | 不同 epoch（halted-fence 同源 E0）共存并竞争执行 | 恰好一个 proof/fence；另一 `PLAN_STALE` |
| N138 | phase/runId/_id/targetWriteEpoch 非 canonical；执行时 targetProofId≠f(...) | `PLAN_INVALID`/`PLAN_STALE`；零写 |
| N139 | consumed writer 缺/坏 runtimeTicket；migration/recovery runtimeTicket≠null | `PLAN_INVALID`；零写 |
| N140 | plan-issue 2/2；重复 create 0 写；无新索引 | 预算不变 |
| N141 | 历史非规范 runId 记录与 canonical 同 epoch | 历史不可执行/不计入 valid；canonical 可签发 |
| N142 | 重签 `e'>e` | 旧记录保持终态；新 proof/fence 用 `e'`；旧 plan 无运行授权 |

### 18.12 v8 未解决/未验证

- 未实现、未运行测试；U1 依赖 Store `_id` create-only 的实际语义（C1 实现卡必须验证）；本卡不声称运行时闭合。
- `PlanRecordValid` 的 writer consumed 重算以 `statusTargetProofId` 作为 `proofId`；若执行事务写入 proof `_id` 与之不一致，则拒绝（N139）；该一致性需实现级断言。
- plan-issue 不重算 `targetProofId`（refs 2 不含 domain）；执行事务校验 `f(当前 fp, domainHeadRevision, e)`，该等式依赖读取时点的 `domainHeadRevision`，需实现级断言（N138）。
- 历史 v7 plan（runId 非 `we-<e>`）不被视为 valid；是否迁移/清理不在本卡（不新增迁移动作）。
- canonical `_id` 上若存在不可验证的旧记录（损坏/旧 schema），create-only 会阻挡同 epoch 重签（fail-closed）；本卡不允许删除/覆盖，只能改用更大 epoch 或走维护流程。
- K3 轮换后的 epoch 命名空间/marker 创建规则仍按既有冻结项；本卡只要求 K3 变化后 epoch 严格增大且旧 plan 失效。
- 完整云报告仍不可读；不声称逐项关闭。
- 闸门：G3/O10、G4、07B 离线门禁结论有效；main/07B 合并、C1 实现/C2/C3、HTTP/UI、部署上线冻结。

### 18.13 全文同步对照（v8）

| # | 原位置 | 原表述 | v8 处理 |
|---:|---|---|---|
| S13 | §17.1 R7 `:998` | “`_id` 含 epoch”可证唯一 | canonical ID + create-only；§18.4 |
| S14 | §17.2 字段 1/7 `:1039`/`:1045` | `_id` 含任意 runId；runId 非空 | writer `runId="we-<e>"`；canonical 校验；§18.2 |
| S15 | §17.2 `:1148-1151` | consumed 统一要求 runtimeTicket 重算 | 按 planKind 拆分；§18.7 |
| S16 | §17.2 空值表/目标段 | writer epoch 固定 1/n+1 | 重签 `e'>e`，允许跳号；source 规则不变；§18.5 |
| S17 | §15.2.1 `:674`/§16.4 `:882` | 通用 `_id` 含 runId | 历史表述；writer 以 §18.2 为准 |
| S18 | §0/§14/末行 | v7 Q1–Q40/N01–N132 | v8 Q1–Q44/N01–N142；§18 |

---

**提交对象：Codex。请复审 v8 §18（Q41–Q44、N133–N142、writer plan canonical ID/epoch 唯一性、作用域、撤销/过期重签与终态、consumed 按 planKind 校验、refs/writes 0 新增）及 §17（Q36–Q40）；本稿不声称完整云报告已读或逐项关闭。不自批。完成即停手，等待独立复审。**
