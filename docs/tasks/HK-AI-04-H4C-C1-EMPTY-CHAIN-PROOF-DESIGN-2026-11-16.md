# HK-AI-04 H4-c C1 空链证明设计 v3（阻断关闭稿）

> 状态：**设计提案，待 Codex 复审。** 本稿只修订设计文档；不实现 C1、不修改任何生产代码/测试、不进入 C2/C3、不注册 HTTP、不调用 Provider/设备/生产云。
>
> 输入设计卡：`fb75cf0071faaf932bb48d74438b00774cb2558b`（父 `f2bb6de`，C1 代码基线 `5dff386`）。
>
> 已批准设计：`docs/hk-face-h4c-reconciliation-design @ b15aceb`；批准/任务卡：`ed7b66f`；C2 前置检查：`42f8970`。
>
> 本稿关闭 v2 五项阻断：admission 两阶段时序、`evidence_digest_domains` 写入门与 K3 bootstrap、Store 全写路径/change/persist/seed 边界、proof 前迁移 plan 授权、monitor→runtime 停写 fence；并统一 digest 规范化、2 万行盘点上限、清单时点、全局停写范围、错误码映射。

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 空链证明 | K3 精确 + CoverageValid + fence clear + 两阶段 admission + per-job anchor + 1..9 IDs + 完整 canonical 链 |
| 持续写入约束 | Store 写入门覆盖 transact/change/persist/seed/init 全部入口；旧 writer 无当前两阶段 admission 持续被拒绝 |
| K3 domain | `evidence_digest_domains` 纳入写入门；只有独立 `k3-bootstrap` admission 能创建固定 head+version；runtime/migration 不可写 |
| proof 前迁移 | 预证明迁移由签名 migration plan 授权未来 `proofId/epoch/policy/writerSet`；final plan 冻结 final inventory；不依赖尚不存在的 proof |
| monitor 停写 | 新增 `evidence_chain_fences`；monitor 写 halt fence 后，runtime/gate 对所有 H4-c 写入返回 `EVIDENCE_CHAIN_HALTED`；clear 必须基于新 epoch proof |
| 空性权威 | canonical/abnormal/legacy 由 audit proof + anchor + 9 IDs + admission + fence 共同覆盖；不信任调用方布尔值 |
| refs | C1 15；C2 R1 24；迁移 anchor 14、finalize 4；R2 8+N≤90；admission/plan 0 新增 refs |
| 裁定 | Q1–Q24；N01–N70 |

## 1. 输入、基线与问题

### 1.1 输入事实

- 唯一工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\c1-design-v3`，分支 `codex/h4c-empty-proof-v3`，HEAD = `fb75cf0071faaf932bb48d74438b00774cb2558b`，父 `f2bb6de`。
- 输入分支 `feat/hk-face-h4c-reconciliation` 本地 ref 与 `origin/feat/...` 跟踪 ref 均为 `5dff386`（本卡未修改该分支；观测值以本次核对为准）。
- C1 代码基线 `5dff386`：evidence/head/K3 domain validator、只读 domain guard、HMAC、append helper；无 reconcile 服务入口、无 HTTP 注册。
- C2 仅 `42f8970` 前置文档，未开始；C3 未开始；调度工作区 `SMART-PM-H3` 未被本卡修改。
- 本稿只改设计卡；不新增生产代码、测试、Store 注册、迁移脚本。

### 1.2 当前实现缺口（只读核对）

| 缺口 | 位置 | 事实 |
|---|---|---|
| 调用方布尔值 | `admin-web/lib/face-service/h4c-evidence.mjs:352-381` | `appendEvidenceWrites` 接收 `hasExistingEvidence`；head 为空时只看该布尔值 |
| refs 只含新 sequence | 同文件 `:322-343` | 只声明新 sequence 的 evidence ID + head + K3 pair；无 1..9 全量、anchor/audit/fence |
| 只检查新 ID | 同文件 `:424-427` | seq2..9 孤儿不在 state，无法发现 |
| 首链依赖预读 | `b15aceb` §5.4 `:222-226` | 未原子覆盖全部 9 IDs |
| 已知缺口 | `42f8970:...C2-PREFLIGHT...:743`（Q04）、`:552`（T11）、`:691`（RC56） | head 删除而 seq2..9 残留时可能留下孤儿链 |
| Store 限制 | `store.mjs:94`、`:428` | 单事务 refs 上限 90；Store 只按声明 refs 点读，不能事务内全集合扫描 |

### 1.3 必须关闭的失败场景

```text
H = null
A = null
E_2 ... E_9 中存在合法 canonical evidence（例如 E_2）
调用方传入 hasExistingEvidence = false
```

目标结果：`EVIDENCE_CHAIN_BROKEN/409`，anchor/evidence/head/domain/fence 全部零写；即使调用方布尔值为 false。不得把 E2 改名/重编号/adopt 成新链。

### 1.4 v2 五项阻断与 v3 关闭位置

| v2 阻断 | v3 处置 | 位置 |
|---|---|---|
| admission 预检与终检时序；writesDigest 循环 | 两阶段：`admissionPrecheck`（无 digest）→ 构造最终 writes → `admissionTicket`（含 refsDigest/writesDigest）→ Store gate 终检 | §4.6、§4.9、§5、N49/N50 |
| `evidence_digest_domains` 未在写入门；K3 bootstrap 准入缺失 | domain 写入门 + 独立 `k3-bootstrap` admission（只允许 fixed head+version） | §4.5、N51/N52/N68 |
| gate 未覆盖 `Store.change`/所有写路径；persist/seed 边界 | change 对 H4-c 一律拒绝；transact 才有 admission；persist 私有；seed/init 仅空数组 | §4.4、N53/N54 |
| proof 前迁移准入的未来 proofId/epoch/inventory 权威性 | 预证明 migration plan（pre-anchor/final）签名授权；finalize 不依赖已有 proof | §4.7、N55–N59 |
| monitor→runtime 权威停写 | `evidence_chain_fences` halt/clear record；runtime/gate 事务内检查；clear 需新 epoch proof | §4.8、N60–N63 |

## 2. 术语与信任模型

### 2.1 三类记录

| 类别 | 定义 |
|---|---|
| **canonical** | C1 v1 精确 schema；evidence 确定性 ID；sequence 1..9；previous 链完整；K3 与当前 config/domain 一致；HMAC 可重算 |
| **abnormal** | head 缺失/多余/seq0、seq1 缺失但 seq2 存在、seqN 孤儿、anchor/head 不配对、链内缺失、ID/字段/HMAC/K3 不一致、fence halted |
| **legacy** | anchor/audit/admission/fence 方案启用前的 evidence/head（含 3fce9b0/6dbc9e0/aa0db29/90e4189 C1 数据、旧 LocalStore 数据、非确定性 ID/旧 schema/旧 domain） |

### 2.2 信任模型

1. **不信任调用方布尔值/预读。** 只信任事务内 refs state、K3 guard、审计证明、fence 和 HMAC。
2. **global K3 锚优先。** `applyEvidenceDomain` 第一道；任何 `DOMAIN_*` 先于空链/fence/admission 返回。
3. **K3 domain 与链写分离。** domain 只读；唯一写入口是独立 `k3-bootstrap` admission，且只能创建 fixed head+version；runtime/migration 均不能写 domain。
4. **审计是持续约束，不是一次性许可。** 全量盘点后由 Store 写入门 + epoch/policy/writerSet/ticket + fence 持续限制；旧 writer 无 admission 持续被拒绝。
5. **覆盖失效即关闭。** proof/fence/gate/monitor/K3/代码/集合任一失效，全部 fail closed；不降级到 anchor/9 IDs。
6. **停写是持久事实。** monitor 的 halt 写入 `evidence_chain_fences`，runtime/gate 事务内读取；不是进程内 health flag/缓存。
7. **Store 完整性假设。** 本设计防止应用层部分写、head/seq1 丢失、并发分叉、legacy 漏检；不声称能抵抗恶意删除全部记录或绕过 Store 直接改数据库。部署必须撤销旧 DB 凭证/权限并用 monitor 报警。

## 3. 方案总览

### 3.1 证明层

| 层 | 记录/机制 | 证明/约束 |
|---|---|---|
| L0 | global K3 domain head + version | K3 配置/换钥锚完整 |
| L1 | `evidence_chain_audits` | 全量盘点、legacy 处理、K3/epoch/policy/writer/collection 覆盖 |
| L2 | `device_operation_evidence_chain_anchors` | 每 job 曾经有链，head/seq1 丢失可发现 |
| L3 | 1..9 IDs + 完整 canonical 链 | 当前 job 无孤儿/断链/分叉 |
| L4 | 两阶段 canonical admission + Store gate | 只有当前 canonical writer 能写；旧 writer 持续拒绝 |
| L5 | `evidence_chain_fences` + monitor | monitor halt 对 runtime/gate 是权威停写事实 |
| L6 | 独立 `k3-bootstrap` admission | 只在受控 bootstrap 创建固定 domain pair |

### 3.2 证明式

```text
CoverageValid =
  audit proof 存在（ID = f(K3 fingerprint, domainHeadRevision, writeEpoch)）
  ∧ exact 22 字段 ∧ auditDigest HMAC 通过
  ∧ kind/scope/schemaVersion 合法
  ∧ realm/keyVersion/keyFingerprint/domainHeadId/domainHeadRevision 与当前一致
  ∧ status ∈ {empty,backfilled} ∧ legacyCount=0
  ∧ writeEpoch/admissionPolicyVersion/writerSetDigest/auditedCollections 与当前部署一致

FenceClear =
  fence 存在（固定 ID）∧ exact 字段 ∧ fenceDigest HMAC 通过
  ∧ status="clear" ∧ fence.epoch = CoverageValid.writeEpoch

AdmissionValid(op) =
  precheck 字段与 CoverageValid/FenceClear/当前配置一致
  ∧ final ticket 的 refsDigest/writesDigest 与 Store 实际 refs/writes 一致
  ∧ K3 HMAC 通过 ∧ operation/write-set 形状正确

EmptyProof(job) =
  K3Exact ∧ CoverageValid ∧ FenceClear ∧ AdmissionValid("genesis")
  ∧ head=null ∧ anchor=null ∧ ∀ i∈[1,9]: evidence(i)=null

ChainProof(job) =
  K3Exact ∧ CoverageValid ∧ FenceClear ∧ AdmissionValid("append")
  ∧ anchor valid ∧ head valid（lastSequence∈[1,9]）
  ∧ ∀ i∈[1,lastSequence]: evidence(i) canonical、previous 链正确
  ∧ ∀ i∈[lastSequence+1,9]: evidence(i)=null
```

只有 `EmptyProof` 允许首条，`ChainProof` 允许非首条；任一失败即零写。Store gate 在写阶段用 final ticket 做最终校验，precheck 只是 fail-fast。

### 3.3 备选方案

| 方案 | canonical | seq2..9 | head/seq1 全丢 | legacy | 审计后旧 writer | 结论 |
|---|---|---|---|---|---|---|
| 9 IDs only | 通过 | 通过 | 不可发现 | 不可发现 | 不可阻止 | 不足 |
| 9 IDs + anchor | 通过 | 通过 | 通过 | 不可发现 | 不可阻止 | 不足 |
| + audit proof | 通过 | 通过 | 通过 | 迁移证明 | 仅审计时点 | 不足 |
| + two-phase admission + fence | 通过 | 通过 | 通过 | 迁移证明 | 持续拒绝 | **推荐** |

## 4. 数据契约

### 4.1 job 链锚 `device_operation_evidence_chain_anchors`

| 项目 | 建议 |
|---|---|
| `_id` | `h4c-evidence-anchor-v1:<sha256(stable([orgId,jobId])).slice(0,32)>` |
| 字段 | `_id, orgId, jobId, schemaVersion, firstEvidenceId, createdAt`（6 字段） |
| 写入 | 仅首条 append 同事务 create-only；不更新/删除/修复 |
| 语义 | anchor 存在 = 曾有一条链；head/seq1 丢失时不得重建 |

### 4.2 全局链审计证明 `evidence_chain_audits`

| 项目 | 建议 |
|---|---|
| `_id` | `evidence-chain-audit:v1:<keyFingerprint>:<domainHeadRevision>:<writeEpoch>` |
| 字段 | `_id, kind, scope, schemaVersion, realm, keyVersion, keyFingerprint, domainHeadId, domainHeadRevision, writeEpoch, admissionPolicyVersion, writerSetDigest, auditedCollections, status, canonicalEvidenceCount, canonicalHeadCount, anchorCount, legacyCount, inventoryDigest, checkedAt, checkedBy, auditDigest`（22 字段） |
| `kind`/`scope` | `audit` / `global` |
| `status` | `empty` 或 `backfilled`；`legacyCount` 必须 0 |
| `inventoryDigest` | 64 hex；对 **final inventory**（anchor backfill 后、proof 创建前）的 canonical 清单做 SHA-256，见 §4.10 |
| `auditDigest` | K3 HMAC-SHA256，domain `KEYED_DIGEST/h4-evidence-chain-audit` v1，覆盖除自身外全部字段 |
| 写入 | 仅 migration finalize（与 fence clear 同事务）create-only；runtime 只读 |

`writeEpoch` 每次重新审计/代码 policy/writer 集/集合范围/K3 变化都必须提升；proof ID 含 `writeEpoch`，旧 proof 保留但不读取。

### 4.3 停写 fence `evidence_chain_fences`

| 项目 | 建议 |
|---|---|
| `_id` | `evidence-chain-fence:v1:global` |
| 字段 | `_id, kind, scope, schemaVersion, status, epoch, reasonCode, monitorId, updatedAt, fenceDigest`（10 字段） |
| `kind/scope` | `fence` / `global` |
| `status` | `clear` 或 `halted` |
| `epoch` | 当前 `writeEpoch`；必须与 CoverageValid proof 一致 |
| `reasonCode` | 固定枚举：`COVERAGE_INVALID`、`MONITOR_ERROR`、`OPERATOR_HALT`、`INITIAL_CLEAR` |
| `fenceDigest` | K3 HMAC-SHA256，domain `KEYED_DIGEST/h4-evidence-chain-fence` v1，覆盖除自身外全部字段 |
| 写入 | 初始 `clear` 与 audit proof 在 migration finalize 同事务 create；halt/clear 仅 monitor admission 精确更新；runtime 只读 |

**缺失/损坏/epoch 不符/`halted` 即 `EVIDENCE_CHAIN_HALTED`，所有 H4-c 写关闭。**

### 4.4 Store 写路径与边界（全部路径）

| Store API | H4-c 写行为 | gate/边界 |
|---|---|---|
| `transact` | 唯一允许写 H4-c 的 API | 必须携带两阶段 admission；final ticket 通过后写 |
| `change` | **一律拒绝** H4-c 集合 | 无 admission 路径；旧代码企图 change 被 `ADMISSION_REQUIRED` 拒绝 |
| `persist` | LocalStore 私有持久化 | 只允许 `transact` 在 active admission 内调用；非公开/直接调用拒绝 |
| `seed()` | 仅空数组初始化 | H4-c 数组必须为 `[]`；出现记录即拒绝 |
| `init()` | 仅对旧数据补 `||= []`，不写记录 | 不 persist 记录；非空 H4-c 旧数据只读，不得借此写链 |
| `list`/`get` | 只读 | 无 gate |
| 直接 Cloud DB/旧 Store | 绕过 Store gate | 部署 P0 撤销旧凭证/权限；monitor 报警；不属于应用可保证范围 |

`Store.change` 不提供 H4-c 写入能力；任何需要写 H4-c 的场景（runtime、migration、monitor fence、K3 bootstrap）都必须走 `transact` + 对应 admission。

### 4.5 K3 domain 写入门与独立 bootstrap

- `evidence_digest_domains` 纳入 write gate；**runtime/migration 对 domain 的任何写一律拒绝**，保持 C1 只读。
- 唯一例外是 `kind="k3-bootstrap"` 的独立 admission：
  ```text
  k3Bootstrap = { kind:"k3-bootstrap", operation:"k3-domain-bootstrap",
                  bootstrapRunId, realm, keyVersion, keyFingerprint, domainHeadId,
                  authorizedAt, ticket }
  ```
  `ticket` = K3 HMAC `KEYED_DIGEST/h4-k3-bootstrap` v1，覆盖上述字段；由受控 bootstrap 任务持有，不依赖 chain audit proof / writeEpoch。
- gate 校验：
  1. 只允许**恰好 2 条写**：fixed domain head + version；create-only；无 evidence/head/anchor/audit/fence 写。
  2. head/version 必须都不存在；任一存在/部分存在 → `DOMAIN_INCOMPLETE`/`K3_BOOTSTRAP_DENIED`。
  3. realm/keyVersion/fingerprint/domainHeadId 必须与当前 K3 config 一致；ID 公式正确。
  4. fence 必须不存在（bootstrap 只能发生在 fence/proof 之前）；存在/ halted → `K3_BOOTSTRAP_DENIED`。
  5. 无 proof 要求；bootstrap 成功后仍必须走全量 audit 才可 append。
- 旧 `initializeEvidenceDomain`（90e4189）没有 k3-bootstrap admission → 被 gate 拒绝；C1 runtime 仍只读。
- K3 轮换不是 bootstrap；domain 已存在时禁止 bootstrap，另立受控迁移（Q16）。

### 4.6 两阶段 canonical admission（消除 writesDigest 循环）

**阶段 A：admissionPrecheck（无 digest，fail-fast）**

```text
precheck = { kind, operation, writeEpoch, admissionPolicyVersion,
             writerSetDigest, proofId }
```
- runtime 在读取 anchor/head/9 IDs 之前校验：与 CoverageValid、FenceClear、当前配置一致；migration 的 precheck 由 prePlan/finalPlan 校验（pre-fence 允许 fence 缺失）。失败 → `EVIDENCE_CHAIN_ADMISSION_REQUIRED/409`，零写。
- **不含 `refsDigest/writesDigest/ticket`**；不要求尚未构造的 writes。

**阶段 B：admissionTicket（final，写阶段权威）**

```text
refsDigest  = SHA-256(canonical sorted refs [{collection,id}])
writesDigest= SHA-256(canonical sorted writes [{collection,id,data}])
ticket      = HMAC-SHA256(K3, canonical({
                domain:"KEYED_DIGEST/h4-canonical-write-admission", version:1,
                kind, operation, writeEpoch, admissionPolicyVersion,
                writerSetDigest, proofId, refsDigest, writesDigest }))
```
- **在最终 writes 列表（含 C2 的 job/log/op/audit 等非 H4-c 写）确定后**由 C2 transaction builder 统一 mint；C1 helper 返回 H4-c writes，不提前签 ticket。
- Store gate 从实际 refs/writes 重算两个 digest 并验证 ticket；ticket 不含自身、不写入任何记录，因此无循环。
- Gate 同时校验 H4-c 子集形状（§4.8）；ticket 覆盖 full writes，C2 追加写不能绕过。
- 失败 → `ADMISSION_REQUIRED`；与 proof 失效（`PROOF_REQUIRED`）区分。

**四类 admission**：

| kind | 授权 | 要求 | 可写 |
|---|---|---|---|
| runtime | precheck + final ticket | CoverageValid + FenceClear | genesis / append |
| migration | prePlan/finalPlan + final ticket（targetProofId） | 不要求已有 proof；pre-fence 阶段 fence 可缺失；halted fence 拒绝 | anchor / finalize（fence+proof） |
| monitor | fenceDigest HMAC + 当前 proof/epoch（clear 需新 proof） | 只写 fence；halt 不依赖 proof 有效 | fence halt/clear |
| k3-bootstrap | k3BootstrapTicket | 无 proof/fence；fence 存在/ halted 拒绝 | domain head+version |

### 4.7 proof 前迁移 plan 与未来字段权威

迁移在 proof 之前没有 `proofId`，因此不能用“当前 proof”作准入。定义离线签名 **migration plan**（不新增集合/refs）：

```text
prePlan = { kind:"migration-plan", scope:"global", schemaVersion:1,
            migrationRunId, phase:"pre-anchor",
            targetWriteEpoch, targetAdmissionPolicyVersion,
            targetWriterSetDigest, targetProofId,
            preInventoryDigest, auditedCollections, scannedAt, checkedBy,
            planDigest, planTicket }

finalPlan = { ...same target fields..., phase:"final",
              prePlanDigest, finalInventoryDigest,
              canonicalEvidenceCount, canonicalHeadCount, anchorCount,
              checkedAt, planDigest, planTicket }
```

- `targetProofId` 由 K3 fingerprint + domainHeadRevision + targetWriteEpoch **确定性计算**；gate 可重算，不要求 proof 已存在。
- `prePlan` 在 anchor 前签名，授权 `migration-anchor`；`finalPlan` 在 anchor 后、final inventory 后签名，引用 `prePlanDigest`，授权 `migration-finalize`（fence+proof 同事务）。
- `planTicket` = K3 HMAC `KEYED_DIGEST/h4-evidence-migration-plan` v1；gate 校验 plan/runId/phase/target 字段/`prePlanDigest`/final inventory/counts。
- **不依赖未来 proofId 记录**：未来字段由签名 plan 授权；proof 创建时字段必须与 `finalPlan` 完全一致，否则拒绝。
- plan 不作为运行时记录；migration 工具持有，Store gate 使用注入的 verifier 校验；是否持久化 plan 列入 Q19。
- `migration-anchor` 是 **pre-fence** 操作：fence 可以不存在（ref 读 null）；若 fence 存在且 `halted` 则拒绝；不要求 `FenceClear`；不得写 fence/domain/audit。`migration-finalize` 才创建 clear fence + proof。

### 4.8 CoverageValid 与 fence/monitor

```text
CoverageValid =
  audit proof 存在（ID=f(K3 fingerprint,domainHeadRevision,writeEpoch)）
  ∧ exact 22 字段 ∧ auditDigest HMAC
  ∧ K3 绑定 ∧ status/legacyCount
  ∧ writeEpoch/admissionPolicyVersion/writerSetDigest/auditedCollections 与当前一致

FenceClear =
  fence 存在 ∧ exact 10 字段 ∧ fenceDigest HMAC
  ∧ status="clear" ∧ fence.epoch=CoverageValid.writeEpoch
```

失效触发器：proof/fence 缺失/篡改/HMAC 错；K3 换钥/domain revision 变；epoch/policy/writerSet/collections 不符；gate 缺失/禁用；monitor halt/异常；K3 bootstrap 后未 audit；任一 → `PROOF_REQUIRED`/`HALTED`（按层映射），所有 append（含已有链）阻断，不降级、不自动修复。

**monitor→runtime 停写**：

1. monitor 周期扫描 evidence/head/anchor/fence；发现未知 ID、非规范 schema、anchor/E1/head 不一致等，使用 `kind="monitor"`、`operation="fence-halt"` 的 admission 写 fence：`status="halted"`、`reasonCode`、`monitorId`、`updatedAt`、当前 epoch，重算 `fenceDigest`。
2. gate 对 monitor admission 只允许 fence 精确更新；其他任何 H4-c 写同时被拒绝。
3. runtime 每次 append 读取 fence ref；`halted`/缺失/损坏/epoch 不符 → `EVIDENCE_CHAIN_HALTED/409`，零写；Store gate 在写阶段复查 state[fence]。
4. halt 是**全局 H4-c 停写**：runtime genesis/append、migration anchor/finalize、K3 bootstrap、domain/evidence/head/anchor/audit/fence 的写全部关闭；读允许；C2 reconcile 返回 HALTED。
5. 清除：`kind="monitor"`/`operation="fence-clear"`，必须引用**新 epoch 的新 proof**（`newProofId`）且 CoverageValid/epoch 匹配；否则 `HALTED`。旧 proof 不能 clear；clear 只写 fence。
6. 若 fence 缺失（proof 存在后）视为 tamper/未初始化 → HALTED；初始 clear fence 与首个 proof 在 migration finalize 同事务创建。
7. 事务已在 halt 前读取 clear 并提交的在途写允许完成；halt 对之后事务生效；monitor 同时停止流量。

### 4.9 digest 规范化（统一）

**canonical JSON 规则**：plain object；keys 按 UTF-16 code unit 升序（复用 `stableStringify`）；数组保持顺序；字符串 NFC 后 UTF-8；仅 null/bool/safe integer/string/array/plain object；拒绝 `undefined`/function/symbol/BigInt/NaN/Infinity/-0；hex 一律小写 64 位。

| digest | 算法 | domain/version | 输入 |
|---|---|---|---|
| `auditDigest` | HMAC-SHA256(K3) | `KEYED_DIGEST/h4-evidence-chain-audit` v1 | proof 除自身外全部字段 |
| `fenceDigest` | HMAC-SHA256(K3) | `KEYED_DIGEST/h4-evidence-chain-fence` v1 | fence 除自身外全部字段 |
| `ticket` | HMAC-SHA256(K3) | `KEYED_DIGEST/h4-canonical-write-admission` v1 | 两阶段字段 + refsDigest + writesDigest |
| `planTicket` | HMAC-SHA256(K3) | `KEYED_DIGEST/h4-evidence-migration-plan` v1 | plan 除 planTicket 外字段 |
| `refsDigest` | SHA-256 | — | 排序 `[{collection,id}]` canonical JSON |
| `writesDigest` | SHA-256 | — | 排序 `[{collection,id,data}]` canonical JSON |
| `inventoryDigest` | SHA-256 | — | 最终 inventory 排序 `[{collection,id,recordDigest}]`；recordDigest=SHA-256(canonical record) |
| `writerSetDigest` | SHA-256 | — | 排序 canonical writer manifests |
| `preInventoryDigest`/`finalInventoryDigest` | SHA-256 | — | 对应时点 inventory，规则同上 |
| `k3BootstrapTicket` | HMAC-SHA256(K3) | `KEYED_DIGEST/h4-k3-bootstrap` v1 | bootstrap 字段 |

`writesDigest` 在最终 writes 确定后计算；ticket 不在 writes 中，无循环。

### 4.10 inventory 时点与 2 万行上限

- **时点**：pre-anchor inventory 用于 prePlan/校验；**final inventory** = anchor backfill 完成后、fence+proof 创建前的完整快照，用于 proof 的 `inventoryDigest`/counts/`checkedAt`。
- **2 万行**：`Store.list` 在 20,000 行上限会抛 503，不能作为大集合完整盘点。迁移必须使用受控 Cloud DB export/游标分页；若只能用 `Store.list` 且任一集合超过 20,000 行 → `MIGRATION_CAPACITY_EXCEEDED/409`，不写 proof，anchors 可部分（Z_chain），runtime 保持关闭。
- 不得截断/采样/只看前 2 万行；`inventoryDigest` 必须覆盖完整集合；proof counts 必须与 final inventory 一致；否则拒绝。
- 记录扫描方法（export/cursor）在迁移报告/plan 中；proof 绑定 digest/counts，不额外加字段。

### 4.11 错误码映射（按层，消除重复）

| 层/情形 | code | HTTP |
|---|---|---:|
| K3 config 缺失/非法 | `NOT_CONFIGURED` | 503 |
| K3 domain 缺失/单边/损坏 | `DOMAIN_INCOMPLETE` | 409 |
| K3 realm/version/fingerprint 变化 | `DOMAIN_MISMATCH` | 409 |
| domain 写无 k3-bootstrap / 部分存在 / fence 存在 | `K3_BOOTSTRAP_DENIED` | 409 |
| audit proof 缺失/HMAC/绑定/覆盖字段失效 | `EVIDENCE_CHAIN_PROOF_REQUIRED` | 409 |
| precheck/final ticket/epoch/policy/writer/proof 不匹配；旧 writer；change/persist 写 H4-c | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` | 409 |
| fence halted/缺失/损坏/epoch 不符/clear 无新 proof | `EVIDENCE_CHAIN_HALTED` | 409 |
| anchor/head/evidence 结构损坏/孤儿/断链 | `EVIDENCE_CHAIN_BROKEN` | 409 |
| head CAS 失败 | `EVIDENCE_HEAD_CONFLICT` | 409 |
| evidence ID 预占/写冲突 | `CONFLICT` | 409 |
| inventory 超 2 万且无 export | `MIGRATION_CAPACITY_EXCEEDED` | 409 |
| sequence/字段/来源非法 | `EVIDENCE_INVALID` | 409 |
| 时间越界 | `EVIDENCE_STALE` | 409 |

C2 统一信封映射：除 K3 config 503 外均 409；不返回原始异常；不得把 ADMISSION/HALTED 混用 PROOF。

## 5. 运行时算法

### 5.1 首条链 `EmptyProof`

输入：job、expectedHead=null、config、now、decision/source/observedAt/actorId、precheck；**无 hasExistingEvidence**。

1. 校验 config/job/now/source/observedAt/actorId。
2. `applyEvidenceDomain` 只读精确；失败 `DOMAIN_*`。
3. `CoverageValid`（proof 22 字段/HMAC/epoch/policy/writer/collections）。
4. `FenceClear`（fence 存在/clear/HMAC/epoch）。
5. `admissionPrecheck`（无 digest）校验 kind=runtime/operation=genesis/epoch/policy/writer/proofId。
6. 读 head 必须 null；读 anchor 必须 null；读 E1..E9 必须全 null；任一存在 → `BROKEN`。
7. 构造 anchor/E1/head；C2 追加 job/log 等；最终 writes 确定。
8. 计算 refsDigest/writesDigest，mint final ticket；Store gate 重算/校验 shape；写 anchor+E1+head；无 domain/fence 写。
9. 失败 → 事务回滚，零写。

### 5.2 非首条 `ChainProof`

1. 步骤 1–5 同上，operation=append。
2. head 必须存在且与 expectedHead revision/lastEvidenceId/lastSequence 完全匹配；否则 HEAD_CONFLICT/BROKEN。
3. anchor 必须存在且 org/job/firstEvidenceId/createdAt 匹配；否则 BROKEN。
4. 完整链校验 E1..lastSequence；>last 必须 null；否则 BROKEN/CONFLICT。
5. sequence=last+1；>9 → EVIDENCE_INVALID；构造 evidence+next head；C2 追加写；final ticket；Store gate；写 evidence+head；anchor/fence/domain 不写。

### 5.3 删除 `hasExistingEvidence`

- API 不再接受任何“空链”布尔/调用方证明。
- 首链只由 K3/CoverageValid/FenceClear/precheck/head/anchor/9 IDs 决定。
- `evidenceAppendRefs` 返回完整 15 refs（含 fence）；不再只声明新 ID。
- 生产树静态扫描禁止 `hasExistingEvidence`/`emptyProof`/`callerProof`；测试只用合成 proof/admission/fence fixture。

### 5.4 优先级与最终校验

```text
config → K3 → CoverageValid → FenceClear → precheck
  → anchor/head/9 IDs/完整链 → 构造 writes → final ticket → Store gate → 写
```

任一失败不进入后续；不得用 anchor/9 IDs 绕过 proof/fence/admission；不得写 domain 修复。

### 5.5 残留 seq2 硬规则

当 H=null、A=null、E2..E9 任一存在：

1. `EmptyProof` 的 9 IDs 全空为假 → `EVIDENCE_CHAIN_BROKEN/409`。
2. 不写 E1/head/anchor/fence/domain；不改名/重编号/adopt/删除 E2。
3. 旧 writer 的 `hasExistingEvidence=false` 不再有机会：API 删除参数，旧 writer 无两阶段 admission 被 gate 拒绝。
4. head 存在 seq2 且 E1 缺失：完整链失败；不得追加 E3。
5. 迁移发现该形态：不补 anchor、不写 proof；标记不可补齐 legacy；运行时保持关闭；C1/C2 不自动修复。

## 6. canonical / 异常 / legacy 矩阵

| 类别 | 判定 | 结果 | 写 |
|---|---|---|---:|
| canonical empty | K3+Coverage+Fence+precheck+head/anchor/9 全空 | 首条成功 | X |
| canonical chain | anchor/head/1..N valid + >N null | 追加成功 | X |
| head/seq1 丢失、E2 残留 | 9 IDs 发现 E2 | BROKEN | Z |
| E2..E9 任意残留 | 9 IDs | BROKEN | Z |
| anchor 存在/head 空 | anchor 阻断 | BROKEN | Z |
| head 存在/anchor 缺 | anchor 阻断 | BROKEN | Z |
| 祖先缺失/后孤儿 | 完整链/>last | BROKEN/CONFLICT | Z |
| head seq0 | 不变量失败 | BROKEN | Z |
| 审计后旧 writer | gate 无 ticket | ADMISSION_REQUIRED | Z |
| coverage 失效 | proof/HMAC/绑定/epoch/policy/collections | PROOF_REQUIRED；已有链也阻断 | Z |
| fence halted/缺失/损坏 | fence | HALTED；全局 H4-c 停写 | Z |
| gate/monitor 异常 | 启动自检/monitor | 不就绪/HALTED | Z |
| domain 写无 bootstrap | gate | K3_BOOTSTRAP_DENIED | Z |
| legacy L1 3fce9b0 realm domain | K3 先失败 | DOMAIN_INCOMPLETE | Z |
| legacy L2 无 anchor | anchor 缺 | BROKEN；待迁移 | Z |
| legacy L3 非规范 ID/旧 schema | audit proof 排除 + gate/monitor | 无 proof→PROOF；有 proof 且 gate/fence 有效才 canonical | Z |
| legacy L4 LocalStore 缺数组 | 无 proof | PROOF_REQUIRED | Z |
| legacy L5 不可补齐 | 迁移 abort | 永久 PROOF_REQUIRED | Z |
| K3 失效 | K3 | DOMAIN_* | Z |
| audit 失效 | CoverageValid | PROOF_REQUIRED | Z |
| fence 失效 | FenceClear | HALTED | Z |

**legacy 权威性**：9 IDs 只覆盖 canonical 命名空间；非规范/旧 schema 由全量 audit 排除，audit 后由 admission/fence/monitor 持续限制；审计漏扫是迁移错误。

## 7. refs / writes 预算

### 7.1 C1 helper

| 事务 | refs | 数量 | writes |
|---|---|---:|---|
| 首条 | K3 head/version、audit、fence、anchor、head、E1..E9 | **15** | anchor+E1+head=3 |
| 非首条 | 同上（9 IDs 含 previous/新） | **15** | evidence+head=2 |

### 7.2 C2 R1

| ref | 数量 |
|---|---:|
| org、membership、job、grant | 4 |
| head、anchor、audit、fence | 4 |
| evidence 1..9 | 9 |
| K3 domain head+version | 2 |
| op key、op domain head+version | 3 |
| log、admin audit | 2 |
| **合计** | **24** |

C2 R1 writes：job pre-finalize、evidence、head、首链 anchor、log、op key、op domain 0–2、audit；0 grant/slot/claim/device、0 domain、0 fence。R2 H4-b `8+N≤90` 独立事务。

### 7.3 迁移/控制事务

| 事务 | refs | writes |
|---|---:|---|
| migration-anchor | K3 2 + fence 1 + head 1 + evidence 1..9 + anchor 1 = **14** | anchor=1 |
| migration-finalize | K3 2 + fence 1 + audit 1 = **4** | fence+audit=2 |
| monitor halt/clear | K3 2 + proof 1 + fence 1 = **4** | fence=1 |
| k3-bootstrap | domain head+version = **2** | head+version=2 |

### 7.4 上限

- Store 90 上限；C1 15；C2 R1 24；migration 14/4；monitor 4；R2 ≤90。
- C2 R1 距 90 余 66；admission/plan/ticket 0 新增 refs；所有 refs 去重。

## 8. 并发、迁移切换、停写

### 8.1 链竞争

| 竞争 | 结果 |
|---|---|
| 两首条 | anchor create-only + ticket；一胜；另一 BROKEN/ADMISSION |
| 两非首条 | head CAS；一胜；另一 HEAD_CONFLICT |
| 首条 vs 已有 | head/anchor 检查；首条方 BROKEN |
| 旧 writer vs gate | 无 ticket → ADMISSION；零写 |
| fence halt vs append | fence 读在事务内；halt 后 append HALTED；在途可完成 |
| Cloud 冲突 | 一胜；回滚；无部分写 |
| K3 换钥 | proof/fence epoch 失效；PROOF/HALTED |

### 8.2 迁移切换（plan/gate/fence/proof）

| 阶段 | 动作 | 允许写 |
|---|---|---|
| P0 | 停旧 writer/撤 DB 凭证/流量冻结 | 无 |
| P1 | 部署 gate（closed）+ migration admission | 仅 migration |
| P2 | pre-scan/validate，生成 prePlan | 无 |
| P3 | migration-anchor（prePlan），补 anchor | anchor |
| P3.5 | final inventory（完整；>20k 中止） | 无 |
| P4 | finalPlan；migration-finalize 原子写 clear fence + audit proof | fence+audit |
| P5 | 启动 runtime，检查 CoverageValid/FenceClear/gate | runtime genesis/append |
| P6 | monitor | 正常 canonical |

顺序强制：gate 先于 proof；fence+proof 同事务；旧 writer 在 proof 后无 admission 仍被拒绝；禁止先 proof 后 gate/fence。

### 8.3 旧 writer 隔离/回滚

- 旧 C1 `5dff386` 无两阶段 admission；gate 拒绝。
- 旧 Store 代码/直连 DB 绕过 gate 的部分由 P0 停进程/撤销凭证/网络隔离/monitor 兜底；残余即安全事件。
- 回滚不得恢复旧 writer；新 runtime 失败保持 gate closed/HALTED；修复后新 epoch 重新审计；旧 proof/fence 不删除。
- 两 migration：anchor 幂等；finalize create-only 一胜；同一 targetEpoch/runId；失败方验证退出。

### 8.4 monitor 停写/清除

- monitor halt 可随时写 fence（只 fence），不依赖 proof 有效；halt 后 runtime/migration/K3 bootstrap/domain 全停。
- clear 必须引用新 epoch 新 proof；旧 proof 不能 clear；clear 只 fence，不写链/domain/audit。
- fence 缺失/损坏/tamper → HALTED；初始 clear 与首个 proof 同事务。
- monitor 自身不可用不自动 clear；启动/周期健康检查失败 → 不就绪/告警（Q20）。

## 9. 失败零写

### 9.1 规则

1. 所有 proof/fence/admission/chain 检查在构造写之前；失败空写集。
2. Store build 抛错不持久化；LocalStore next 副本/Cloud 回滚；无部分写。
3. gate 在写阶段校验 final ticket/digest/shape/fence；失败回滚。
4. migration finalize 的 fence+proof 同事务；失败两者都不写；anchor 可部分（Z_chain）。
5. 每个负向用例全库快照（含 6 集合 + C2 job/grant/log/op/audit）。
6. 迁移失败不修复/删除记录；只报告。

### 9.2 全库零写矩阵

- `Z_all`：domain/evidence/head/anchor/audit/fence + C2 job/grant/log/op/domain/audit 零变化；Provider 0。
- `Z_chain`：chain 关键（domain/evidence/head/audit/fence）零写；仅 anchor 可部分 create-only；runtime 关闭。

| ID | 失败 | 检测 | 结果 | 范围 |
|---|---|---|---|---|
| F01 | K3 config/domain 缺失/损坏/换钥 | K3 | DOMAIN_* | Z_all |
| F02 | proof 缺失/HMAC/绑定/status/legacyCount/覆盖 | CoverageValid | PROOF_REQUIRED | Z_all |
| F03 | head=null + E2..E9 | 9 IDs | BROKEN | Z_all |
| F04 | anchor/head/链/孤儿 | ChainProof | BROKEN/CONFLICT | Z_all |
| F05 | head CAS/并发 loser | Store | HEAD_CONFLICT | Z_all |
| F06 | 首条并发 loser | anchor | BROKEN | Z_all |
| F07 | 旧 writer/epoch/policy/ticket | gate | ADMISSION_REQUIRED | Z_all |
| F08 | fence halted/缺失/epoch | FenceClear/gate | HALTED | Z_all |
| F09 | gate 缺失/禁用/版本 | 启动 | 不就绪 | Z_all |
| F10 | 形状违规（genesis 缺 anchor/append 写 anchor/domain/audit） | gate | ADMISSION/BROKEN | Z_all |
| F11 | Cloud 冲突/写失败 | Cloud | 409/回滚 | Z_all |
| F12 | monitor 发现未知/非规范 | monitor | HALTED | Z_all（后续） |
| F13 | K3 换钥/domain revision | Coverage/Fence | DOMAIN/PROOF/HALTED | Z_all |
| F14 | 迁移扫描不可补齐 | migration | 不写 proof | Z_chain |
| F15 | finalize fence+proof 失败 | migration | 无 fence/proof | Z_chain |
| F16 | inventory >20k 无 export | migration | CAPACITY | Z_chain |
| F17 | plan 缺失/字段不符 | gate | ADMISSION | Z_chain/Z_all |
| F18 | domain 写无 bootstrap | gate | K3_BOOTSTRAP_DENIED | Z_all |

## 10. 与 v2/已批准设计差异

| 项 | v2/`b15aceb` | v3 |
|---|---|---|
| admission | 单阶段 ticket 含 writesDigest | 两阶段 precheck/final ticket；无循环 |
| domain | 未在 gate；只读 | domain 在 gate；独立 k3-bootstrap |
| Store 路径 | 主要 transact | change 拒绝、persist 私有、seed/init 空数组 |
| migration | 依赖当前 proof/epoch | prePlan/finalPlan 授权未来 proofId/epoch/inventory |
| monitor | health flag/服务关闭 | 持久 fence + runtime/gate 事务内停写 + clear 新 proof |
| digest | 分散 | §4.9 统一 canonical/算法/domain |
| inventory | 2 万行未处理 | export/cursor；超限 CAPACITY；final 时点 |
| refs | C1 14/C2 23 | C1 15/C2 24（fence） |
| 错误码 | PROOF_REQUIRED 混用 | PROOF/ADMISSION/HALTED/K3_BOOTSTRAP/CAPACITY 分层 |

## 11. 待 Codex 裁定

| 编号 | 事项 | 建议 |
|---|---|---|
| Q1 | 新增 anchor/audit/fence 三集合及 Store 注册/exact/create-only | 批准 |
| Q2 | audit proof HMAC/K3、仅 migration finalize 写 | 批准 |
| Q3 | legacy L2 补 anchor；L1/L3 abort；部署迁移例外 | 批准 |
| Q4 | 完整 1..lastSequence 链校验 | 采用 |
| Q5 | C1 15/C2 24/migration 14/4/monitor 4 refs | 批准 |
| Q6 | 两阶段 precheck/final ticket/writesDigest 时序 | 批准 |
| Q7 | domain 写入门 + 独立 k3-bootstrap admission/字段/ticket | 批准 |
| Q8 | Store.change/persist/seed/init 边界 | 批准 |
| Q9 | prePlan/finalPlan 未来 proofId/epoch/inventory 授权 | 批准 |
| Q10 | fence schema/admission/halt/clear/全局停写范围 | 批准 |
| Q11 | digest canonical/NFC/算法/domain/输入 | 批准 |
| Q12 | 2 万行 export/cursor/CAPACITY 错误 | 批准 |
| Q13 | inventory final 时点（anchor 后 proof 前） | 批准 |
| Q14 | 错误码分层/C2 409/503 映射 | 批准 |
| Q15 | fence clear 必须新 epoch proof | 批准 |
| Q16 | K3 bootstrap 与 fence/轮换边界 | 批准 |
| Q17 | C2 R1 24 refs | 批准 |
| Q18 | precheck 非权威、final ticket 权威 | 批准 |
| Q19 | migration plan 是否需要持久化/如何验签 | 裁定 |
| Q20 | monitor 不可用时启动/周期健康策略 | 裁定 |
| Q21 | fence 初始 clear 与 proof 同事务 | 批准 |
| Q22 | C2 reconcile 错误投影（ADMISSION/HALTED/PROOF） | 裁定 |
| Q23 | persist 私有化/静态扫描方式 | 批准 |
| Q24 | inventoryDigest 是否包含 recordDigest（建议包含） | 批准 |

## 12. 防御性负向矩阵 N01–N70

> 设计矩阵，不执行。`Z`=全库零变化；`X`=允许写集；实现时 LocalStore/fake CloudStore，无 HTTP/外部网络。

| ID | 场景 | 期望 | 写 |
|---|---|---|---:|
| N01 | canonical empty + proof/fence/admission | 首条成功 | X |
| N02 | head/anchor null + E2 canonical + no boolean | BROKEN；不建链 | Z |
| N03 | E2..E9 残留 | BROKEN | Z |
| N04 | E1 存在 | BROKEN | Z |
| N05 | anchor 存在/head 空 | BROKEN | Z |
| N06 | proof 缺失 | PROOF_REQUIRED | Z |
| N07 | proof HMAC/字段/status/legacyCount 非法 | PROOF_REQUIRED | Z |
| N08 | K3 domain 缺失/损坏 | DOMAIN_INCOMPLETE | Z |
| N09 | K3 变化 | DOMAIN_MISMATCH | Z |
| N10 | canonical chain 追加 | 成功；只写 E+head | X |
| N11 | head seq2/E1 缺 | BROKEN | Z |
| N12 | head seq1/E3 孤儿 | BROKEN/CONFLICT | Z |
| N13 | head/evidence 存在/anchor 缺 | BROKEN | Z |
| N14 | anchor 字段/ID 错 | BROKEN | Z |
| N15 | anchor created/firstEvidence 错 | BROKEN | Z |
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
| N43 | 形状违规/domain/audit 写 | ADMISSION/BROKEN | Z |
| N44 | 新 epoch 后旧 epoch | ADMISSION | Z/X |
| N45 | monitor 未知 ID | HALTED | Z |
| N46 | K3 无效但 proof 看似有效 | DOMAIN 优先 | Z |
| N47 | proof 字段/collections 非法 | PROOF_REQUIRED | Z |
| N48 | C2 24 + admission 0 refs | 不超限 | X |
| N49 | precheck 无 writesDigest；final ticket 后 mint | 无循环；成功 | X |
| N50 | writesDigest 篡改/追加写 | ADMISSION；回滚 | Z |
| N51 | runtime/migration 写 domain | K3_BOOTSTRAP_DENIED | Z |
| N52 | k3-bootstrap 精确 head+version；部分/已存在/fence | 成功或拒绝；无其他写 | X/Z |
| N53 | Store.change H4-c | ADMISSION；其他集合可 | Z |
| N54 | seed/init 非空；persist 直调 | 拒绝/静态 | Z |
| N55 | prePlan 缺失/签名错 | anchor 拒绝 | Z |
| N56 | targetProofId/epoch/policy 不符 | ADMISSION | Z |
| N57 | finalPlan/inventory/counts 不符 | finalize 拒绝 | Z_chain |
| N58 | inventory >20k 无 export | CAPACITY；无 proof | Z_chain |
| N59 | final inventory 时点 anchor 后 proof 前 | digest/counts 一致 | X |
| N60 | monitor halt | runtime/migration/domain/audit HALTED | Z |
| N61 | fence 缺失/损坏/epoch 错 | HALTED | Z |
| N62 | clear 无新 proof | HALTED；不 clear | Z |
| N63 | halt 全局范围（6 集合） | 全停；读可 | Z |
| N64 | digest canonical/NFC/key/非法值/recordDigest | 规范一致/拒绝非规范 | Z |
| N65 | 错误码映射 | PROOF/ADMISSION/HALTED/K3_BOOTSTRAP/CAPACITY 正确 | Z |
| N66 | C1 15/C2 24/migration 14/4 | ≤90；无未声明写 | X |
| N67 | C2 追加 job/log 后 final ticket | writesDigest 覆盖；成功 | X |
| N68 | k3-bootstrap 无 audit proof | 成功；之后仍需 audit | X |
| N69 | halted 时仅 fence 更新可写 | 其他 H4-c 全拒 | Z |
| N70 | finalize fence+proof 原子失败 | 两者都不写 | Z_chain |

## 13. 迁移与交付边界

### 13.1 受控迁移

1. P0 停旧 writer/撤 DB 凭证/冻结。
2. P1 部署 gate（closed）+ migration admission。
3. P2 pre-scan/validate；生成 prePlan。
4. P3 补 anchor（prePlan）。
5. P3.5 final inventory；>20k 无 export → CAPACITY，停止。
6. P4 finalPlan；migration-finalize 原子写 clear fence + audit proof。
7. P5 启动 runtime，验证 CoverageValid/FenceClear/gate；接流量。
8. P6 monitor；halt/clear 按 §4.8。
9. 不初始化 K3（除独立 k3-bootstrap 卡）；不写 evidence/head；不修复 legacy；不保留旧 writer 回滚。
10. 迁移 plan 签名/持久化待 Q19；迁移报告记录 inventory 方法/digest。

### 13.2 交付范围

- 只交设计卡；不新增代码/测试/Store 注册/迁移脚本。
- 不修改输入分支/代码；不合并/push 共享主线；不注册 HTTP/UI；不调用 Provider/设备/生产云。
- C2/C3 继续关闭；本卡不构成 C2 前置批准。

## 14. 验收与停止点

Codex 批准后另发 C1 实现卡；至少含：

1. 三集合 schema/Store 注册/gate 全路径/change 拒绝/persist-seed-init 边界；
2. K3 + CoverageValid + FenceClear + 两阶段 admission + anchor + 9 IDs + 完整链；
3. C1 15/C2 24/migration 14/4/monitor 4 refs 与 90 上限；
4. N01–N70 实现级测试（LocalStore+fake CloudStore，无 HTTP/外部网络）；
5. migration plan/fence/monitor/K3 bootstrap 工具另立卡。

本卡到此停止；等 Codex 复审并裁定 §11；不进入 C1/C2/C3。

---

**提交对象：Codex。请复审 §11；批准后再进入实现。**
