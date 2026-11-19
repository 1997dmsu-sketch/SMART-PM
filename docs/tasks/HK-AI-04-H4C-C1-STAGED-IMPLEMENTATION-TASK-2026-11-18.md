# HK-AI-04 H4-c C1 分阶段实施任务卡（r1）

> 状态：**仅新增本任务卡；待 Codex 独立复审，不授权实施。** 本卡不实现 C1、不运行测试、不修改既有设计/生产代码/测试/Store/迁移脚本，不进入 C2/C3、HTTP/UI、部署上线，不安装依赖、不连接设备、不调用 Provider/生产云/支付。
>
> 输入提交：`fcae2460ab0a239c54463530b0b5001f34b1f302`（父 `bc80f741981cade3e4e3d65df709c24f31556c06`）。工作树 `C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\c1-staged-task`；分支 `docs/h4c-c1-staged-implementation-task`；开始工作时 HEAD = 输入提交，工作区干净。
>
> 设计输入（已完整阅读 1–1607 行）：`docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md`（v8；blob `c4feffa5831f5bf0e04e8e902865cb8e1f1b0183`，sha256 `d769da93c4880409c946e316f2414ca6b1135a96361934abc188111ca6dcbec7`）。冲突优先级：**§18 > §17 > §16 > §15 > §4–§14 历史正文**。
>
> **已批准/冻结契约只引用、不重开**：§18.2 writer canonical `planId(e)`/`runId="we-<e>"`、§18.4 每 epoch 至多一条 valid writer plan（`_id` create-only）、§18.5 撤销/过期/终态重签 `e'>e`、§18.7 consumed 按 planKind 校验（writer 必验 `runtimeTicket`，migration/recovery 必为显式 `null`）、§17.1 R1–R6、§17.2 39 字段/签名公式、§17.3 健康谓词与 `FENCE_EXPIRED`/`HALTED` 分离、§17.5 refs/writes 预算。本卡若与上述条款冲突，以设计为准并停止，不自行改写。
>
> 完整云指令 `/workspace/artifacts/C1-epoch-RENTAL-retry-review/DISPATCH.md`：**本机不存在**（已检查 `/workspace`、`C:\workspace` 均不可达）；**未读、不声称读过**。本卡只依据本轮用户明确范围、仓库内设计与代码事实；缺失细节列入 §13 待裁，不以猜测补齐。
>
> 代码基线：`5dff386fe5c9648b04d1623d3e1898c59332639e`（C1 final，`feat/hk-face-h4c-reconciliation`）。`fcae246` 是 `5dff386` 的后代（10 个 docs-only 提交）；`git diff --stat 5dff386..fcae246 -- . ':(exclude)docs'` 为空，即设计修订未夹带任何代码改动。

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 本卡目的 | 把已冻结的 C1 设计拆成 6 个可独立复审、串行推进的实施阶段（S0–S6），每段有依赖、允许文件、精确输入、实现/测试范围、refs/writes 预算、负向/并发/全库零写验收和复审停止点 |
| 实施对象 | C1 helper（`admin-web/lib/face-service/h4c-evidence.mjs`）、公共 index、Store 全路径门禁、C1 测试；不含任何控制事务工具 |
| C1 预算 | refs **17**；writes 首条 **3**（anchor+E+head）/非首条 **2**（E+head）；唯一 `admin_audit` 另计为 explicit 写；单事务 ≤90 |
| 冻结契约 | v8 §18 全部；v7 §17.1–§17.5；不重开 canonical ID、每个 epoch 唯一、consumed 按 planKind、39 字段、健康谓词、预算 |
| 当前状态 | 只写本卡；无代码、无测试执行、无设计修改、无依赖安装、无云/设备/支付/业务网络 |
| 实施前阻断 | §13 的 D1–D9 未清零前，S1 及之后不得开工；其中 D2（C1 17 refs 缺 proof ref）与 D3（集合名）直接阻断 S2/S4 |
| 复审 | 每段结束交 Codex 独立复审；本卡与任何阶段均不自批、不合并、不宣称 G1/C1 已通过 |

## 1. 输入、基线与只读核对

### 1.1 已核对事实（只读，2026-11-18 +08:00）

| # | 事实 | 结果/证据 |
|---:|---|---|
| 1 | 输入 SHA | `fcae2460ab0a239c54463530b0b5001f34b1f302` |
| 2 | 直接父 | `bc80f741981cade3e4e3d65df709c24f31556c06` |
| 3 | 输入 tree | `3e9ec1fbe1c6d050d61254e51e3edf7986bfd07e` |
| 4 | 工作树/分支/HEAD | `.tmp/c1-staged-task`；`docs/h4c-c1-staged-implementation-task`；HEAD 等于输入 SHA；无 upstream |
| 5 | 工作区 | `git status --porcelain` 为空（开始工作时） |
| 6 | 远端 | `origin https://github.com/1997dmsu-sketch/SMART-PM.git`；本卡开始前目标分支不存在；父设计分支 `origin/docs/hk-face-c1-epoch-uniqueness` = `fcae246…`（无前移/分叉） |
| 7 | TLS/凭据 | 逐命令 `-c http.sslBackend=openssl` 可完成 `ls-remote`；`schannel` 报 `SEC_E_NO_CREDENTIALS`，故本卡固定使用 openssl 后端，不写任何全局配置 |
| 8 | 设计文档 | 1607 行；blob/sha256 见页首；本次逐段阅读 §0–§18.13（含 §17/§18 全部表格与附录） |
| 9 | 审查证据 | `docs/tasks/HK-AI-04-H4C-C1-REVIEW-EVIDENCE-2026-11-14.md`（305 行）已读；其 C1 31/31、Admin 581/581、根 51/51 是 **5dff386 历史结果**，本卡未重跑 |
| 10 | C2 前置 | `...C2-PREFLIGHT-2026-11-14.md` 的 Q02/Q03/Q04/Q13/Q15/Q16/Q17 已做标题/行号级抽查；C2/C3 仍冻结 |
| 11 | 代码基线 | `5dff386`；`h4c-evidence.mjs` 471 行、`index.mjs` 60 行、`store.mjs` 524 行、C1 测试 1342 行 |
| 12 | 代码差异 | `5dff386..fcae246` 非 docs 差异为空；`fcae246` 仅改设计文档 |
| 13 | 云指令 | `DISPATCH.md` 本机不存在；未读取，不据此声称任何云端裁定 |
| 14 | 设计自述状态 | 设计页首仍写“设计提案，待 Codex 复审”，与“已批准”口径存在差异，列 D9 |

### 1.2 冻结契约（只引用，不重开）

| 契约 | 冻结内容 | 本卡落点 |
|---|---|---|
| canonical writer plan | `runId="we-"+decimal(e)`；`planId(e)="evidence-chain-plan:v1:writer:we-"+decimal(e)+":writer"`；`writerEpoch=e`；`targetWriteEpoch=e`；`targetProofId=f(K3 fp,domainHeadRevision,e)` | S1 常量/校验；S2 refs；S5 运行时绑定 |
| 每 epoch 唯一 | 每个 epoch 至多一条 valid writer plan；`_id` create-only 即索引；0 新增 refs/索引；非 canonical `runId` 不可执行、不计入 valid | S1 `WriterCanonicalId`；S4 Store create-only 验证 |
| 重签/终态 | 同 epoch 一律 `PLAN_DUPLICATE`；只能 `e'>e`；consumed/revoked 终态不可逆；过期不改 status | S1 校验；S5 运行时只读旧记录 |
| consumed 按 planKind | writer consumed 必须 `runtimeTicket≠null` 且验签；migration/recovery consumed 必须显式 `null`；active/revoked 一律 `null` | S1 `PlanRecordValid`；S5 `WriterPlanValid` |
| 39 字段 plan | exact 39；`planDigest/planTicket/initialStatusTicket/statusTicket/runtimeTicket` 公式；空值表；验票 0 新增 refs | S1 schema/签名；S3 票据；S4 持久化 |
| 授权分离 | active 仅一次性执行授权；runtime 只认 consumed+`runtimeTicket`+`proof.writerPlanId`；旧 W0 不写、不改、无运行授权 | S1 谓词；S5 运行时 |
| 健康/停写 | `FenceHealthy/FenceExpired/FenceHeartbeatable` 分离；`FENCE_EXPIRED` 只可 heartbeat 恢复；`HALTED` 只可 recovery/rotate；时钟回拨不得 heartbeat | S1 谓词；S5 只读判定 |
| 预算 | C1 17/(3\|2)；C2 26；migration-anchor 18/2；finalize 8/5；recovery 8/5；rotate 8/4；monitor 7/2；k3 5/4；plan 2/2；≤90 | §3.3；S6 静态核算 |
| 无双审计 | finalWriteSet 先物化（业务+唯一 audit）再签票；Store explicit 模式不自动追加/不改写；双审计 → ADMISSION/回滚 | S3 字节；S4 Store 门禁 |

### 1.3 范围

**本卡覆盖（获准实施后）**

- C1 运行时契约层：常量、exact schema、canonical ID、HMAC/摘要、admission/fence/coverage/writer-plan 谓词。
- C1 链层：17 refs、anchor、`1..9` 全量 evidence ID、完整 canonical 链、`previous` 复核、head CAS；删除调用方布尔。
- C1 授权层：precheck、final ticket、`refsDigest/writesDigest`、唯一 `admin_audit`、explicit 审计模式。
- Store 全路径门禁：8 个 H4-c 集合、`transact/change/persist/seed/init`、create-only/exact、≤90、无双审计。
- C1 运行时覆盖：K3 domain/marker/proof/writer plan/fence 读取与失败关闭、健康过期与 halted 分离、错误码分层。
- C1 实现级测试与验收：F/N 矩阵中 C1 归属行、全库零写、并发、静态扫描、全量回归。

**明确不在本卡**

- migration-anchor/finalize、recovery-finalize、writer-rotate、monitor heartbeat/halt、k3-bootstrap、plan-issue/plan-revoke 的**执行事务工具**（另立卡；C1 只实现其记录 schema/票据校验和 Store create-only 语义验证）。
- C2（服务/DTO/权限/HTTP/op key/log）、C3（真实 Cloud/K3 运维/告警/Provider/设备/路由注册）。
- `admin-web/server.mjs`、`routes.mjs`、任何 HTTP/UI；任何 main/07B 合并；任何部署/上线/数据库迁移。
- 修改已批准设计、重开 epoch canonical ID/planKind consumed 等契约、新增集合/索引/epoch 计数器（§18.8 明确不采用）。
- 安装依赖、运行真实 Cloud/设备/Provider/支付/业务网络；真实并发 Cloud 事务（C3）。

### 1.4 本卡与后续实施卡的 Git 规则

- 本卡：仅新增本文档；父 = `fcae246`；普通 push 到 `docs/h4c-c1-staged-implementation-task`；不 amend/rebase/reset/squash/force/cherry-pick/merge。
- 后续实施分支：建议 `feat/hk-face-h4c-c1-staged`，起点 = 本卡提交（保证设计+卡在同一祖先链）；分支名待调度方确认（D9）。
- 所有 git 命令逐命令带 `-c safe.directory="<绝对路径>"` 与 `-c http.sslBackend=openssl`；不写全局/系统 git 配置；不使用替代 SHA 或强制推送。
- push 前 `ls-remote` 确认目标分支不存在或与本地一致；若远端前移/分叉/出现平行提交，**停止并报告**，不 reset/merge/force。
- 每个阶段一个独立提交（单用途）；阶段提交只允许 §2/各段列出的文件；证据文档仅追加本阶段小节。
- 阶段失败/复审退修：在**同一阶段分支**追加修复提交，不重写历史、不跨阶段夹带下一阶段改动。

## 2. 阶段总览与依赖

| 阶段 | 产出 | 依赖 | 允许文件（生产/测试） | refs/writes | 停止点 |
|---|---|---|---|---|---|
| S0 | 基线冻结与待裁清零；证据 §0 | 无 | 无代码；仅证据文档 | 0/0 | Stop-0 |
| S1 | 契约层：常量、exact schema、canonical ID、摘要、谓词 | S0；D3/D4 至少给出可编码结论 | `h4c-evidence.mjs`、`index.mjs`、C1 测试 | 0/0 | Stop-1 |
| S2 | 链层：17 refs、anchor、`1..9`、完整链、无布尔 | S1；**D2 必须清零** | 同上 | 17 / 3\|2 | Stop-2 |
| S3 | 授权层：precheck、final ticket、唯一 audit、explicit finalWriteSet | S2；D4/D5/D6 | 同上 | 17 / 3\|2（0 新增） | Stop-3 |
| S4 | Store 门禁：8 集合、全路径、create-only/exact、explicit 模式 | S3；D3/D7 | `store.mjs`、`h4c-evidence.mjs`、`index.mjs`、C1 测试、（条件）`store-deterministic-audit.test.mjs` | 不变；≤90 | Stop-4 |
| S5 | 运行时覆盖：K3/marker/proof/writer plan/fence、健康与错误分层 | S1/S2/S4；D3/D4 | `h4c-evidence.mjs`、`index.mjs`、C1 测试 | 17 / 0（只读） | Stop-5 |
| S6 | 验收：F/N 矩阵、并发、零写、静态扫描、全量回归、证据 | S1–S5 全部 Stop 通过 | C1 测试（仅补断言）、证据文档 | 只验证 | Stop-6 |

依赖关系（串行，禁止跳段）：

```text
S0 ──> S1 ──> S2 ──> S3 ──> S4 ──> S5 ──> S6
                 └──────────────┘
        （S5 逻辑上只依赖 S1/S2 的谓词与 refs；仍按串行顺序在 S4 后实施，避免同文件并发）
```

- 一个阶段只有在其 Stop 获 Codex 明确通过后才可开始下一阶段；不得以“测试已绿”代替复审。
- 同一阶段内可多次提交修复，但不得夹带下一阶段内容；每段最终提交的 diff 必须能用 `git diff --stat` 复现。
- 任一阶段发现设计缺口或已冻结契约无法落地：停止该阶段，在证据中列最小反例与影响，交 Codex 裁定；不得自行“修正”设计。

## 3. 全阶段统一契约

### 3.1 H4-c 集合与 Store 写路径

8 个 H4-c 集合（§15.4/§16.5/§17.5）：

| 集合 | 名称来源 | exact/create-only | 可写事务 |
|---|---|---|---|
| evidence | `device_operation_evidence`（现名） | exact + create-only | C1 genesis/append、C2 |
| evidence head | `device_operation_evidence_heads`（现名） | exact + 可更新（CAS） | C1、C2 |
| K3 domain | `evidence_digest_domains`（现名） | exact + create-only | 仅 k3-bootstrap（C1 只读） |
| anchor | **设计未给字面名**（D3） | exact + create-only | C1 首条；migration-anchor |
| admin_audit | `admin_audit`（现名） | exact 7 字段 + explicit | 所有控制/业务事务唯一审计 |
| fence | `evidence_chain_fences`（§15.1.1 出现） | exact 12 字段 + 可更新 | migration-finalize、recovery、monitor |
| K3 marker | **设计未给集合字面名**（D3）；ID 为 `evidence-chain-k3-marker:v1:global` | exact 18 字段 + create-only | 仅 k3-bootstrap |
| plans | `evidence_chain_plans`（§15.2.1 出现） | exact 39 字段 + create-only（status 仅精确更新） | plan-issue/revoke、finalize、recovery、rotate |

Store 写路径（§4.4；S4 实现并测试）：

| API | H4-c 行为 | 验收要点 |
|---|---|---|
| `transact` | 唯一允许写 H4-c；必须 final ticket + explicit audit | gate 重算 digest；shape/fence 终检；无 ticket → `ADMISSION_REQUIRED`；90 上限 |
| `change` | **一律拒绝** H4-c | 任何 H4-c 集合名 → 拒绝、零写 |
| `persist` | private；仅 `transact`/`init` 内部可用 | 直接调用拒绝；不得作为绕过 gate 的入口 |
| `seed()` | 只允许空数组 | 任一 H4-c 集合非空 → 拒绝 |
| `init()` | 只补空数组默认值（不写记录） | 不写 evidence/head/anchor/audit/fence/marker/plan；不持久化链 |
| `list/get` | 只读 | 无 gate；不得被当作写入/授权依据 |

### 3.2 精确 schema 字段数（S1 必须逐字段冻结）

| 记录 | 字段数 | 关键字段/约束 | 设计位置 |
|---|---:|---|---|
| job anchor | 6 | `_id, orgId, jobId, schemaVersion, firstEvidenceId, createdAt`；`_id="h4c-evidence-anchor-v1:"+sha256(stable([orgId,jobId]))[:32]`；首条 create-only | §4.1 |
| evidence | 20 | 现有 exact 字段与 HMAC 消息；`sequence∈1..9`（`still_unknown` ≤8）；`previousEvidenceId` 完整 | 现实现 + §5 |
| evidence head | 9 | `lastSequence∈0..9`；CAS 用 `revision/lastEvidenceId/lastSequence` | 现实现 |
| domain head/version | 7 / 6 | 固定 `evidence-digest-domain:v1:global` 与 version 派生 ID；C1 只读 | 现实现 |
| admin_audit | 7 | `_id, orgId, actorId, actorType, action, target, createdAt`；`_id` 公式见 §4.13；targetList 排序、不含 audit 自身 | §4.13 |
| fence | 12 | `_id, kind, scope, schemaVersion, status, epoch, reasonCode, monitorId, heartbeatAt, validUntil, updatedAt, fenceDigest`；`status∈{clear,halted}`；`validUntil-heartbeatAt≤300000` | §15.1.1 |
| K3 marker | 18 | 完整 ID 常量；`fenceId` 固定；K3 domain/realm/version/fingerprint 绑定；`markerDigest` HMAC | §16.1 |
| audit proof | 24 | v4 22 字段 + `k3MarkerDigest` + `writerPlanId`；见 §3.2 下方分解 | §4.2/§16.4 |
| plan | 39 | 字段名以 §17.2 表 1–39 为唯一清单（30 core + 9 status/runtime）；writer canonical ID 见 §18.2 | §17.2/§18.2 |

audit proof 24 字段分解（冻结）：

```text
_id, kind, scope, schemaVersion, realm, keyVersion, keyFingerprint,
domainHeadId, domainHeadRevision, writeEpoch, admissionPolicyVersion,
writerSetDigest, auditedCollections, status, canonicalEvidenceCount,
canonicalHeadCount, anchorCount, legacyCount, inventoryDigest, checkedAt,
checkedBy, auditDigest, k3MarkerDigest, writerPlanId
```

- `status` 允许值、`legacyCount` 规则设计未逐项枚举（D4）；S1 不得猜测，需先裁定。
- 所有 validator 必须拒绝多字段/缺字段/类型错误/非 plain object；拒绝信息走统一错误码。
- `stableStringify` 规则沿用现有实现：plain object、key UTF-16 升序、数组有序、NFC/UTF-8、拒绝 `undefined/function/symbol/BigInt/NaN/Infinity/-0`、hex 小写 64。

### 3.3 refs/writes 预算（v8 权威；本卡不重开）

| 事务 | refs 组成 | refs | writes | writes |
|---|---|---:|---|---:|
| C1 首条/非首条 | domain2 + audit1 + fence1 + marker1 + writerPlan1 + anchor1 + head1 + E1..9 | **17** | anchor+E+head / E+head | **3 / 2** |
| C2 R1 | C1 17 + org/member/job/grant4 + op key/domain3 + job log/op log2 | **26** | job/evidence/head/anchor/log/op/audit | — |
| migration-anchor | domain2+fence1+marker1+writerPlan1+plan1+head1+E9+anchor1+audit1 | **18** | anchor+audit | **2** |
| migration-finalize | domain2+fence1+marker1+W0+plan1+proof1+audit1 | **8** | fence+proof+migrationPlan+W0+runtimeTicket+audit | **5** |
| recovery-finalize | domain2+fence1+marker1+W1+recoveryPlan1+proof1+audit1 | **8** | fence+proof+recoveryPlan+W1+runtimeTicket+audit | **5** |
| writer-rotate | domain2+fence1+marker1+W0+W1+proof1+audit1 | **8** | fence+proof+W1+runtimeTicket+audit | **4** |
| monitor heartbeat/halt | domain2+proof1+fence1+marker1+writerPlan1+audit1 | **7** | fence+audit | **2** |
| k3-bootstrap | domain2+fence1+marker1+audit1 | **5** | domain2+marker+audit | **4** |
| plan-issue/plan-revoke | plan1+audit1 | **2** | plan+audit | **2** |
| C2 R2 | H4-b 8+N | **≤90** | 独立事务 | — |

- C1 的 **3/2** 按 §17.5 口径 = helper 业务写（anchor+E+head / E+head）；唯一 `admin_audit` 由 explicit finalWriteSet 追加，事务总写为 4/3，但**不得**据此新增 ref 或改写预算表。S6 同时记录“helper 业务写”和“事务总写”两组数字。
- 票据验证（planDigest/planTicket/initialStatusTicket/statusTicket/runtimeTicket）**0 新增 refs**；`runtimeTicket` 是 plan 记录字段，不是新记录。
- 全部 refs 去重；单事务 ≤90；C2 R1 距上限余 64。
- **D2 未清零前不得实现 17 refs**：见 §13。

### 3.4 错误码（C1 使用面）

| 情形 | code | HTTP |
|---|---|---:|
| K3 config 缺失/非法 | `NOT_CONFIGURED` | 503 |
| domain 缺失/损坏/部分 | `DOMAIN_INCOMPLETE` | 409 |
| realm/version/rekey/domain 绑定的 proof 不匹配 | `DOMAIN_MISMATCH` | 409 |
| proof 缺失/HMAC/绑定/status/legacy/覆盖失效 | `EVIDENCE_CHAIN_PROOF_REQUIRED` | 409 |
| precheck/final ticket/旧 writer/change/persist | `EVIDENCE_CHAIN_ADMISSION_REQUIRED` | 409 |
| fence halted/缺失/epoch/时钟回拨 | `EVIDENCE_CHAIN_HALTED` | 409 |
| fence clear 但 `now>validUntil` | `EVIDENCE_CHAIN_FENCE_EXPIRED` | 409 |
| 链结构/anchor/head/1..9 孤儿/断链 | `EVIDENCE_CHAIN_BROKEN` | 409 |
| head CAS 失败 | `EVIDENCE_HEAD_CONFLICT` | 409 |
| ID 预占 | `CONFLICT` | 409 |
| 字段/sequence/来源/形状 | `EVIDENCE_INVALID` | 409 |
| 时间窗口/顺序 | `EVIDENCE_STALE` | 409 |
| plan 同 epoch 已存在 | `PLAN_DUPLICATE` | 409 |
| plan 字段/ID/票据/consumed 分支非法 | `PLAN_INVALID` | 409 |
| plan 已消费 | `PLAN_CONSUMED` | 409 |
| plan 过期 | `PLAN_EXPIRED` | 409 |
| plan 已撤销 | `PLAN_REVOKED` | 409 |
| source CAS 失败 | `PLAN_STALE` | 409 |

- 错误优先级：K3 config → domain → marker → proof → writer plan → fence/health → precheck/ticket → chain → shape。任一失败必须在返回任何写之前抛出。
- 不得把 `FENCE_EXPIRED` 与 `HALTED`、`PROOF_REQUIRED` 与 `ADMISSION_REQUIRED` 混用；C2 统一投影 409，K3 config 503。

### 3.5 全库零写验收协议（每个负向用例强制）

1. 失败前对 `store.data` 做 `structuredClone` 快照；LocalStore 另记 `demo-data.json` 的 sha256。
2. 断言抛出的错误码与设计一致。
3. `assert.deepEqual(store.data, before)` 全库深比较；按 8 个 H4-c 集合 + `admin_audit` 分别做内容级比较（不只数量）。
4. 断言没有新增/修改 `admin_audit`（无双审计、无自动审计）。
5. LocalStore 断言数据文件 sha256 不变；CloudStore fake 断言事务未提交、目标行未变。
6. 纯函数：对输入 `state` 做 `structuredClone`，调用后 `deepEqual`，证明不修改入参。
7. 并发失败方：除全库零写外，断言成功方恰好产生一条 anchor/evidence/head（或一张 plan），不存在双 proof/fence/audit。
8. 证据文档记录每个用例的快照方法、错误码、比较范围与结果；不得只写“已零写”。

### 3.6 并发验收协议

| 竞争 | 预期 |
|---|---|
| 两首条 genesis | anchor create-only 一胜；败者 `EVIDENCE_CHAIN_BROKEN`；无第二 anchor/evidence/head |
| 两非首条 append 同 head | head CAS 一胜；败者 `EVIDENCE_HEAD_CONFLICT`；无分叉/半写 |
| 首条 anchor 写成功但 E/head 失败 | 整事务回滚；anchor/evidence/head/audit 零写 |
| 两 plan-issue 同 epoch canonical `_id` | create-only 一胜；败者 `PLAN_DUPLICATE`；plan+audit 零写（S4 以 Store 语义验证；签发工具另卡） |
| 同 epoch 不同 `runId` | 非 canonical 在 `PlanRecordValid` 即 `PLAN_INVALID`；不产生记录 |
| 不同 epoch active plan 共存 | 允许；runtime 只认当前 `proof.writerPlanId`；旧 plan 无运行授权 |
| fence expired vs append | `EVIDENCE_CHAIN_FENCE_EXPIRED`；零写；status 仍 clear |
| fence halted vs append | `EVIDENCE_CHAIN_HALTED`；零写 |
| 时钟回拨 vs heartbeat | `HALTED`；零写；不得 heartbeat |
| 旧 W0 重放 | `PROOF_REQUIRED`/`PLAN_*`；零写；旧记录不改写 |

- LocalStore 队列与 CloudStore fake 都是串行化执行：C1 只能证明 CAS/create-only **语义**，不能证明真实 Cloud 并发；真实并发归 C3，证据中必须标注“未验证”。
- S6 对每个并发对连续运行 10 次，记录逐轮结果；任一轮失败即阶段失败，不得放宽断言或串行化生产路径。

### 3.7 测试与 guard 命令（获准实施后）

```powershell
# C1 定向
cd admin-web
node --test --test-isolation=none tests/face-h4c-evidence.test.mjs

# Store 门禁定向（S4/S6）
node --test --test-isolation=none tests/store-deterministic-audit.test.mjs
node --test --test-isolation=none tests/cloud-store-point-read.test.mjs

# Admin 全量（S6；基线 41 文件 / 581 项，5dff386 历史值）
node --test --test-isolation=none "tests/*.test.mjs"

# 根测试（S6；基线 7 文件 / 51 项）
cd ..
node --test --test-isolation=none "tests/*.test.cjs"

# 静态
node --check admin-web/lib/face-service/h4c-evidence.mjs
node --check admin-web/lib/face-service/index.mjs
node --check admin-web/lib/store.mjs
git diff --check
```

- C1 定向必须另跑一次带 network guard 的版本，记录 `network_attempts=0 provider_calls=0 http_servers=0`；guard 存放工作树之外，不提交。
- Admin 全量含既有 `127.0.0.1` loopback 测试，必须披露数量，不得计为外部网络；不得新增路由。
- 不安装依赖；不跑真实 Cloud/设备/Provider；不启动 server。

### 3.8 静态扫描（S6 必跑）

| 扫描 | 期望 |
|---|---|
| 生产树 `hasExistingEvidence` / `emptyProof` / `callerProof` | 0 命中 |
| K3 初始化/bootstrap/create-domain token | 0 命中（沿用 C1 既有 43 文件扫描并更新文件数） |
| marker 短 ID `k3-marker:v1:global` | 0 命中（完整 ID 除外说明条款） |
| H4-c 集合写入点 | 仅 `transact` 的 gate 路径；`change/persist/seed/init` 无 H4-c 记录写 |
| `server.mjs` / `routes.mjs` | 零 diff |
| 未授权集合/新索引/epoch 计数记录 | 0 |
| 敏感值 | 0 findings（仅计数，不输出匹配文本） |
| `git diff --stat` 允许文件 | 仅本阶段白名单；设计文档零 diff |

### 3.9 提交/复审/证据

- 证据文档：`docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-EVIDENCE-2026-11-18.md`；S0 新建，之后仅追加本阶段小节，不改写历史小节。
- 每个阶段提交信息格式：`feat(face): h4c c1 <s1..s6> <一句话>`；证据提交可合并进该阶段提交。
- 每段结尾在证据中写：改动文件、diff 范围、命令/exit/计数、零写矩阵、refs/writes、未验证、下一段请求。
- 不自批；不合并；不宣称 C1/G1 通过；复审通过前不开始下一段。

## 4. S0：基线冻结与待裁清零（零代码）

**依赖**：无。

**允许文件**：仅证据文档新建；不修改任何代码/测试/设计。

**精确输入**：

- 输入 SHA/父/tree、工作树/分支、`git status --porcelain`。
- `origin` 远端实际 ref：目标分支不存在；父设计分支 tip = `fcae246…`。
- 设计文档 blob/sha256；`git diff --stat 5dff386..HEAD -- . ':(exclude)docs'` 为空。
- 基线代码文件 hash：`git hash-object` 记录 `h4c-evidence.mjs`、`index.mjs`、`store.mjs`、C1 测试。
- 历史测试计数仅引用 5dff386 证据（31/581/51），不重跑、不冒充本卡结果。

**实现范围**：无。

**测试范围**：无业务测试；可执行 `git status`、`git rev-parse`、`git ls-remote`、`git diff --stat`、`git hash-object` 并记录原始输出。

**refs/writes**：0/0。

**负向/并发/零写**：

- 远端目标分支已存在且 SHA 不同、父设计分支前移/分叉、工作区不干净、设计 blob 不匹配、`5dff386..HEAD` 出现非 docs 差异：任一命中即停止报告；不得 reset/merge/force 修复。
- 不访问 Store，不产生数据写。

**停止点 Stop-0**：Codex 确认基线、确认 D1–D9 的处置（清零或明确延后及条件）；未通过不得进 S1。

## 5. S1：契约层（纯函数）

**依赖**：S0 通过；D3/D4 至少给出可编码结论（集合名、proof.status/legacyCount 规则）。

**允许文件**：

- `admin-web/lib/face-service/h4c-evidence.mjs`
- `admin-web/lib/face-service/index.mjs`
- `admin-web/tests/face-h4c-evidence.test.mjs`
- 证据文档（追加 S1）

**精确输入**：

1. 常量：8 集合名（D3）、`EVIDENCE_CHAIN_FENCE_ID="evidence-chain-fence:v1:global"`、`EVIDENCE_CHAIN_K3_MARKER_ID="evidence-chain-k3-marker:v1:global"`、anchor 前缀、`MONITOR_HEALTH_WINDOW_MS=300000`、`CLOCK_SKEW_MS=30000`、`EVIDENCE_MAX_SEQUENCE=9`、`STILL_UNKNOWN_MAX_SEQUENCE=8`。
2. ID 公式：anchor、evidence、head、domain、fence、marker、proof、plan（含 §18.2 writer canonical）；admin_audit（D4）。
3. schema 字段数组：6/20/9/7/6/7/12/18/24/39（§3.2）。
4. digest domain：audit/fence/monitor/ticket/plan/plan-status/recovery/k3-bootstrap/writer-runtime/k3-marker/maintenance-manifest；算法 HMAC-SHA256 v1，canonical JSON 规则。
5. 谓词：`FenceRecordValid/FenceStructValid/FenceHealthy/FenceExpired/FenceValid/FenceHeartbeatable`、`K3DomainExact/K3MarkerValid/CoverageValid/WriterPlanValid/PlanRecordValid/AdmissionValid`。
6. 错误码表（§3.4）。

**实现范围**：

- 只加纯函数/常量/validator/摘要/谓词；不改任何调用方，不改 Store，不写记录。
- 保留现有 26 个 C1 导出及其行为；index 只增不删；仍无任何 initialization/bootstrap/create-domain 入口。
- 所有 validator 必须 exact（多/缺/类型错都拒绝）；所有摘要必须可从持久字段重建（不依赖内存 plan 对象）。
- `PlanRecordValid` 必须实现 §17.2 + §18.2/§18.7：writer canonical ID、空值表、initialStatusTicket、statusTicket、consumed 按 planKind、runtimeTicket 验签。
- `WriterPlanValid` 只接受 consumed+runtimeTicket+`proof.writerPlanId`；active 不放行。
- 健康谓词严格区分 `FenceHealthy`（业务写）与 `FenceHeartbeatable`（heartbeat）；不得混用。

**测试范围**：

- 每个 schema 的正例/反例；多字段、缺字段、错类型、非 plain object。
- canonical ID 例：`e=1`→`we-1`、`e=7`→`we-7`、`e=10`→`we-10`；拒绝 `we-07`、`we-0`、`WE-7`、空串、非正整数。
- HMAC 向量：用测试 K3 key 对固定输入计算并断言；不得用生产 key。
- fence 谓词真值表：healthy / expired / halted / clock rollback / future heartbeat / window 超限。
- plan 39 字段 exact；各 planKind 空值表；consumed writer 缺/坏 runtimeTicket；migration/recovery consumed 带非 null runtimeTicket；active/revoked 带 runtimeTicket；revoke 的 targetProofId 非 null。
- marker 18 字段/完整 ID/短 ID 拒绝；proof 24 字段/`k3MarkerDigest`/`writerPlanId` 缺失拒绝。
- 纯函数不修改输入（structuredClone + deepEqual）。

**refs/writes**：0/0。

**负向/并发/零写**：无 Store 写；负向即上表拒绝用例。并发不适用。

**停止点 Stop-1**：Codex 审 schema/ID/谓词/签名公式与 §18.2/§18.7 逐条一致；确认没有生产调用点、没有 Store 改动；未通过不得进 S2。

## 6. S2：链层（17 refs、anchor、1..9、完整链）

**依赖**：S1 通过；**D2 清零**（C1 refs 的 proof ref 归属或替代读法）；D3 集合名可编码。

**允许文件**：

- `admin-web/lib/face-service/h4c-evidence.mjs`
- `admin-web/lib/face-service/index.mjs`
- `admin-web/tests/face-h4c-evidence.test.mjs`
- 证据文档（追加 S2）

**精确输入**：

- C1 refs 组成（§3.3）：domain head/version 2 + audit 1 + fence 1 + marker 1 + writerPlan 1 + anchor 1 + head 1 + E1..9 9 = 17；若 D2 裁定补 proof，则为 18 并须 Codex 明确批准预算变更；本卡不猜。
- anchor：6 字段、ID 公式、首条 create-only、`firstEvidenceId=E1`。
- evidence：20 字段、`evidenceId(orgId,jobId,seq)`；head：9 字段、`lastSequence∈0..9`。
- 链规则：`EmptyProof`（head=null/anchor=null/E1..9=null）；`ChainProof`（anchor valid、head valid、1..N canonical、previous 正确、N+1..9 null）；N=9 再 append → `EVIDENCE_INVALID`。
- 删除 `hasExistingEvidence`；测试/production 静态扫描 0 命中。
- 现有 `expectedHead` CAS 语义保留；首条不再依赖调用方布尔。

**实现范围**：

- 重写 `evidenceAppendRefs`：返回 exact 17 refs（去重、稳定顺序）；读取全部 E1..9、anchor、head、fence、marker、writerPlan、audit（D6 接口）。
- 重写 `appendEvidenceWrites`：只返回 3/2 条业务写；事务内重读 head；首条要求 anchor/head/E1..9 全空；非首条要求 anchor/head/1..N 完整、N+1..9 空；previous 全字段复核（schema/ID/org/job/seq/observedAt/K3/HMAC）。
- 不写 domain；不 adopt/重编号/删除孤儿；任一失败在返回写之前抛错。
- 首条 anchor + E + head 原子；append E + head 原子。
- 错误码按 §3.4：孤儿/断链/anchor 不配 → `EVIDENCE_CHAIN_BROKEN`；CAS → `EVIDENCE_HEAD_CONFLICT`；seq 预占 → `CONFLICT`（按设计 §5.5/§11 统一）。

**测试范围**：

- refs 精确数量/集合/去重；每个 ref 的 collection/id 断言。
- 首条成功只写 anchor+E1+head；append 只写 E+head。
- head=null + E2..9 任一存在 → BROKEN；E1 存在 → BROKEN；anchor 存在/head null → BROKEN；head seq2 但 E1 缺 → BROKEN；anchor 字段/ID/firstEvidence 错 → BROKEN。
- 完整链 1..N 正例；N+1..9 非空 → BROKEN；N=9 再 append → INVALID；`still_unknown` 第 8 条后 E9 仍 null。
- previous 的 schema/ID/org/job/seq/observedAt/K3/HMAC 任一损坏 → BROKEN；`observedAt` 递减/越界 → STALE（相等是否允许按已冻结 Q15，若未冻结列待裁）。
- `expectedHead` 过期 → HEAD_CONFLICT；head 被删除仍带 expectedHead → BROKEN。
- 负向全库零写（§3.5）；无 `hasExistingEvidence` token。
- 并发：两首条、两 append、anchor 成功但 E/head 失败。

**refs/writes**：17 / 3（首条）或 2（非首条）；0 domain 写；唯一 audit 不在 helper。

**负向/并发/零写**：按 §3.5/§3.6；重点 F03/F04/F05/F06。

**停止点 Stop-2**：Codex 审 refs 17 组成（尤其 D2 结论）、anchor/1..9/完整链、无布尔、零写证据；未通过不得进 S3。

## 7. S3：授权层（precheck、final ticket、唯一 audit）

**依赖**：S2 通过；D4（audit ID/revision）、D5（operationAuthDigest）、D6（C1 API 与 audit 注入）清零。

**允许文件**：

- `admin-web/lib/face-service/h4c-evidence.mjs`
- `admin-web/lib/face-service/index.mjs`
- `admin-web/tests/face-h4c-evidence.test.mjs`
- 证据文档（追加 S3）

**精确输入**：

```text
precheck = { kind, operation, writeEpoch, admissionPolicyVersion, writerSetDigest, proofId }
refsDigest   = SHA-256(canonical sorted refs [{collection,id}])
writesDigest = SHA-256(canonical sorted finalWriteSet [{collection,id,data}])
ticket       = HMAC-SHA256(K3, "KEYED_DIGEST/h4-canonical-write-admission" v1,
                 canonical(precheck ∪ {refsDigest, writesDigest, operationAuthDigest}))
finalWriteSet = C1 业务写（anchor+E+head 或 E+head）+ 唯一 admin_audit（7 字段）
```

- admin_audit：`_id` 按 §4.13 公式（D4）；`targetList` 排序、不含 audit 自身；`createdAt=now` 安全整数；字段恰好 7。
- audit 必须作为 finalWriteSet 的一部分在签票前物化；Store explicit 模式不得再追加第二个 audit。
- `operationAuthDigest` 的 runtime 取值见 D5；不得自造第三种语义。

**实现范围**：

- 两阶段：precheck（无 digest，fail-fast）→ final ticket（finalWriteSet 确定后 mint）。
- 提供 finalWriteSet 构造/验签 helper（D6 接口）；C1 helper 仍只返回业务写，audit 由调用方/测试显式传入。
- 无 ticket/字段不一致/digest 不一致 → `EVIDENCE_CHAIN_ADMISSION_REQUIRED`；proof 失效 → `PROOF_REQUIRED`，两者不混。
- 不提前签票；不在 ticket 里包含自身；不在终检后追加写。
- 0 新增 refs；ticket 字节不落库（除非作为 plan 字段的既有设计）。

**测试范围**：

- precheck 各字段错 → ADMISSION；final ticket 对 refs/writes 的字节级绑定。
- `refsDigest`/`writesDigest` 篡改、audit 字段/字节篡改、audit ID 错、targetList 顺序错 → ADMISSION。
- finalWriteSet 缺 audit、双 audit、audit 不在 refs、Store 试图自动追加 audit → ADMISSION/回滚。
- 用 fixed test K3 key 的 HMAC 向量；错误 proof/epoch/operationAuth → 拒绝。
- 只有业务写、没有 ticket 的旧路径 → ADMISSION；ticket 正确但 chain 失败 → 链错误优先，零写。
- 零写协议 + 并发：同 ticket/同 head 一胜。

**refs/writes**：17 / 3\|2；ticket 0 新增；事务总写 4/3（含 audit），helper 业务写 3/2。

**停止点 Stop-3**：Codex 审 ticket 公式/字节绑定/唯一 audit/explicit 边界；确认 no double audit；未通过不得进 S4。

## 8. S4：Store 全路径门禁（8 集合、explicit、≤90）

**依赖**：S3 通过；D3（集合名）、D7（gate 接口/K3 配置/persist 私有）清零。

**允许文件**：

- `admin-web/lib/store.mjs`
- `admin-web/lib/face-service/h4c-evidence.mjs`
- `admin-web/lib/face-service/index.mjs`
- `admin-web/tests/face-h4c-evidence.test.mjs`
- `admin-web/tests/store-deterministic-audit.test.mjs`（**仅当** additive gate 改动使其需要补断言；不得弱化既有断言）
- 证据文档（追加 S4）

**精确输入**：

- 8 集合注册、exact/create-only 集合表（§3.1）；head 可更新；fence 可更新（halt/heartbeat）；plan 仅 status 精确更新。
- `transact` gate：H4-c 写必须 final ticket + explicit audit；重算 digest；校验最终写集；读 fence 后、构造 finalWriteSet 前判 `FenceValid(now)`，写阶段用 `state[fence]` 复查。
- `change` 对 H4-c 一律拒绝；`persist` 私有；`seed` 非空拒绝；`init` 只补空数组。
- 90 refs 上限；去重；未声明写拒绝；create-only 拒绝重复 `_id`；exact 写不注入 `updatedAt`。
- `auditMode:"explicit"` / `transactFinal` 的调用契约（D7）；无 audit → 拒绝；有 audit 但未在 refs → 拒绝；不得生成随机 audit。
- LocalStore 与 CloudStore 语义一致；Cloud fake 事务失败整批回滚。

**实现范围**：

- 仅改 Store 与 gate helper；不改 `server.mjs`/`routes.mjs`；不改非 H4-c 集合语义。
- gate 对旧 writer（无 ticket）持续拒绝；对 `change/persist/seed/init` 全路径拒绝 H4-c 记录写。
- explicit 模式下 Store 只写 finalWriteSet；不自动 `auditRecord`；不改 `_id/createdAt/target`。
- 任何 gate 失败整事务回滚，不持久化 LocalStore 文件。

**测试范围**：

- LocalStore/CloudStore 各路径正/负：transact/change/persist/seed/init。
- 8 集合 exact 字段；evidence/domain/anchor/marker/plan create-only；head CAS 可更新；fence 可更新。
- H4-c 经 `change` → 拒绝；`persist` 直调 → 拒绝；`seed` 非空 → 拒绝；`init` 非空不补记录。
- 90/91 refs；未声明写；重复 `_id`；exact 字段多/缺；explicit audit 7 字段；无双审计；旧 writer ADMISSION。
- 每个负向全库零写 + LocalStore 文件 hash 不变 + Cloud fake 回滚。
- 并发：同 anchor/plan `_id` create-only 一胜；同 head 两 append 一胜。
- `store-deterministic-audit.test.mjs` 回归（若改）。

**refs/writes**：不改变任何预算；gate 0 新增 refs；≤90。

**停止点 Stop-4**：Codex 审 Store diff、gate 放置点、explicit 模式、全路径拒绝、无双重审计、非 H4-c 零回归；未通过不得进 S5。

## 9. S5：运行时覆盖（K3/marker/proof/writer plan/fence）

**依赖**：S1/S2/S4 通过；D3/D4 清零。

**允许文件**：

- `admin-web/lib/face-service/h4c-evidence.mjs`
- `admin-web/lib/face-service/index.mjs`
- `admin-web/tests/face-h4c-evidence.test.mjs`
- 证据文档（追加 S5）

**精确输入**：

- audit proof 24 字段；marker 18；fence 12；plan 39；`CoverageValid/K3MarkerValid/WriterPlanValid/FenceValid/FenceHeartbeatable`（§17.1/§17.3/§18.7）。
- 运行时顺序：config → K3 domain → marker → proof → writer plan → fence/health → precheck → anchor/head/1..9 → finalWriteSet/ticket → gate → 写。
- `WriterPlanValid`：consumed + `statusTargetProofId=proof._id` + `proof.writerPlanId=plan._id` + runtimeTicket 验签 + `writerEpoch=proof.writeEpoch` + marker/key 绑定；**active 不放行**；运行时不要求 `now∈window`。
- 健康：`FenceValid=FenceHealthy` 只给业务写；`FenceHeartbeatable` 只给 heartbeat；`FENCE_EXPIRED` 与 `HALTED` 分离；时钟回拨不得 heartbeat。
- 旧 W0 保持 consumed、旧 proof 非当前 → 无运行授权；不得改写旧记录。

**实现范围**：

- 实现只读覆盖校验并接入 append 前置；不实现 recovery/rotate/monitor/k3-bootstrap/plan-issue 的执行事务。
- K3 domain 仍只读；marker/proof/fence/plan 缺失/损坏/绑定错一律失败关闭。
- 错误码按 §3.4，不降级到 anchor/9 IDs；不自动修复。
- 无新 refs；无新集合/索引。

**测试范围**：

- marker 18 字段/完整 ID/短 ID/HMAC/K3 绑定；proof 24 字段/`k3MarkerDigest`/`writerPlanId`。
- proof/marker/domain/epoch/policy/writerSet/collections 任一不符 → PROOF/DOMAIN。
- writer plan：active-only、consumed 缺/坏 runtimeTicket、runtimeTicket 字段不符、旧 W0、`statusTargetProofId` 不符 → PROOF/PLAN_INVALID；零写。
- fence：halted/缺失/epoch/digest/健康过期/时钟回拨/未来心跳 → HALTED/FENCE_EXPIRED；业务写零写。
- 错误优先级：K3 无效但 proof 看似有效 → DOMAIN 优先；proof 缺失但 chain 也坏 → PROOF 优先。
- 运行时只读：断言不写 marker/proof/fence/plan；旧记录字节不变。
- 覆盖 N97–N100、N104、N107–N111、N113–N132 中运行时行（见 §11）；F22/F25–F28/F31/F33/F34/F37/F38/F40。

**refs/writes**：17 / 0（只读验证；genesis/append 写仍归 S2/S3）。

**停止点 Stop-5**：Codex 审运行时判定顺序、planKind consumed、旧 W0、健康分离、只读性；未通过不得进 S6。

## 10. S6：验收（矩阵、并发、零写、静态、全量回归）

**依赖**：S1–S5 全部 Stop 通过。

**允许文件**：

- `admin-web/tests/face-h4c-evidence.test.mjs`（仅补缺失断言；不得新增生产代码）
- 证据文档（追加 S6）
- 若发现生产缺陷：**停止 S6**，回到拥有该代码的阶段追加修复提交并重走该段 Stop；不得在 S6 修生产代码。

**精确输入**：

- §11 的 F/N 归属表；§3.5/§3.6 协议；§3.7 命令；§3.8 扫描；§3.3 预算。
- 历史基线：C1 31/31、Admin 581/581、根 51/51（5dff386）仅作对照，不冒充本次结果。

**实现范围**：无生产实现；只补测试断言与证据。

**测试范围**：

- C1 定向全绿；带 guard 0/0/0。
- Admin 全量、根测试全绿；披露 loopback 数量。
- 并发对 10 轮全胜；每轮记录。
- 全部 F/N C1 行逐项 PASS/FAIL/未测；不允许“部分通过”概括。
- 静态扫描 §3.8 全 0。
- 预算静态核算：C1 17/3|2；所有行 ≤90；无未声明写。
- `git diff --stat` 仅白名单；设计零 diff；`server.mjs`/`routes.mjs` 零 diff；无 C2/C3 代码。

**refs/writes**：只验证，不新增。

**停止点 Stop-6**：Codex 最终独立复审；不通过则退回对应阶段；通过也只表示 C1 任务卡/实现可进入下一道独立流程，不表示 G1/C1 已批准、不授权合并/部署。

## 11. 负向/并发/零写总矩阵（C1 归属）

### 11.1 F 矩阵（C1 适用）

| ID | 场景 | 阶段 | 期望 | 零写范围 |
|---|---|---|---|---|
| F01 | K3 config/domain 缺失/损坏 | S5 | DOMAIN_* | Z_all |
| F02 | proof 缺失/HMAC/绑定/status/legacy/覆盖 | S5 | PROOF_REQUIRED | Z_all |
| F03 | head=null + E2..9 任一 | S2 | BROKEN | Z_all |
| F04 | anchor/head/链/孤儿 | S2 | BROKEN/CONFLICT | Z_all |
| F05 | CAS/并发 loser | S2 | HEAD_CONFLICT | Z_all |
| F06 | 首条 loser | S2 | BROKEN | Z_all |
| F07 | 旧 writer/epoch/policy/ticket | S3/S4 | ADMISSION | Z_all |
| F08 | fence halted/缺失/epoch | S5 | HALTED | Z_all |
| F09 | gate 缺失/版本 | S4 | 不就绪 | Z_all |
| F10 | 形状违规/domain/audit proof 写 | S4 | ADMISSION/BROKEN | Z_all |
| F11 | Cloud 冲突 | S4 | 回滚 | Z_all |
| F13 | K3 变化 | S5 | DOMAIN/PROOF/HALTED | Z_all |
| F17 | plan 缺失/不符 | S5 | ADMISSION/PLAN_INVALID | Z_all/Z_chain |
| F18 | domain 无 bootstrap | S5 | DOMAIN_INCOMPLETE | Z_all |
| F21 | audit 注入/双审计 | S3/S4 | ADMISSION；回滚 | Z_all |
| F22 | marker 缺失/字段/HMAC/绑定 | S5 | PROOF/HALTED | Z_all |
| F25 | plan 签名/字段/window | S5 | PLAN_INVALID | Z_all/Z_chain |
| F26 | plan consumed/expired/revoked 重放 | S5 | PLAN_* | Z_all |
| F27 | plan key/marker 不符 | S5 | PLAN_INVALID | Z_all |
| F28 | monitor health 过期 | S5 | FENCE_EXPIRED | Z_all |
| F29 | clock 回拨/未来/非法 | S5 | HALTED | Z_all |
| F30 | heartbeat 写失败/并发 | 另卡 | HALTED/回滚 | Z_all |
| F31 | audit finalWriteSet 注入/双审计 | S3/S4 | ADMISSION | Z_all |
| F32 | fence ID/schema/查找 ID | S5 | HALTED/PROOF | Z_all |
| F33 | marker 短 ID/ref 不一致 | S1/S5 | PROOF/HALTED | Z_all |
| F34 | plan 改 status 后旧票据 | S1/S5 | PLAN_INVALID | Z_all |
| F35 | recovery source CAS | 另卡 | PLAN_STALE/HALTED | Z_all |
| F36 | monitor 完整 coverage | 另卡 | HALTED | Z_all |
| F37 | writer plan status/key/marker | S1/S5 | PLAN_INVALID | Z_all |
| F38 | 同 K3 旧 plan/proof 重放 | S5 | PLAN_CONSUMED/STALE | Z_all |
| F39 | rotate 原子失败 | 另卡 | Z_chain | Z_chain |
| F40 | proof writerPlanId 缺失/不符 | S5 | PROOF_REQUIRED | Z_all |

### 11.2 N 矩阵归属（不重开设计；只划 C1 与另卡）

- **C1 本卡覆盖**：N01–N20、N25–N38（N21–N24 迁移/legacy 行归另卡）、N42–N44、N46–N47、N49–N51（domain 写拒绝）、N53–N54、N60–N63（仅 runtime 读侧）、N64–N66（C1 自身预算）、N77–N78、N81、N85–N86（只读校验）、N88–N90、N92–N93（C1 17）、N95（C1 行）、N97–N100（只读校验）、N104、N107–N111、N113–N117（runtime 读侧）、N118–N126（校验/读侧）、N129–N132、N133–N135（Store create-only/validator）、N138–N142（validator/Store 语义）。
- **另卡覆盖（migration/recovery/monitor/writer-rotate/k3-bootstrap/plan-issue 执行事务）**：N21–N24、N39–N41、N45、N52、N55–N59、N67–N76、N79–N80、N82–N84、N87、N91、N94、N101–N103、N105–N106、N127–N128、N136–N137（执行侧）。
- **元项**：N96/N112（云报告不可读）在本卡 §13/§14 记录，不声称关闭。
- **待裁 D8**：§14 第 6 条“N01–N142 实现级测试”与第 7 条“迁移/恢复/…工具另立卡”存在归属张力；上表按第 7 条划界，若 Codex 要求 C1 覆盖全部 N，须先明确“以合成记录代替执行工具”的测试边界，否则 S6 无法诚实给出全绿。

### 11.3 并发矩阵

| 竞争 | 阶段 | 预期 |
|---|---|---|
| 两首条 genesis | S2/S4 | anchor create-only 一胜；败者 BROKEN；零写 |
| 两 append 同 head | S2/S4 | CAS 一胜；败者 HEAD_CONFLICT；零写 |
| 两 plan-issue 同 epoch `_id` | S4 | create-only 一胜；败者 PLAN_DUPLICATE；plan+audit 零写 |
| 同 epoch 不同 `runId` | S1/S5 | PLAN_INVALID；无非 canonical 记录 |
| 同 epoch 串行重签 | S1/S5 | PLAN_DUPLICATE；旧记录不变 |
| 不同 epoch active 共存 | S5 | 允许；runtime 只认当前 proof 绑定的 consumed plan |
| consumed/revoked 后同 epoch 重签 | S1/S5 | PLAN_DUPLICATE；只能 e'>e |
| fence expired vs append | S5 | FENCE_EXPIRED；零写；status 仍 clear |
| halted vs append | S5 | HALTED；零写 |
| 时钟回拨 vs heartbeat | S5/另卡 | HALTED；零写；不得 heartbeat |

## 12. 逐段复审停止点

| Stop | 阶段 | 复审输入 | 通过条件 | 失败处置 |
|---|---|---|---|---|
| Stop-0 | S0 | 基线报告、D1–D9 处置 | SHA/父/远端/设计 blob/代码零 diff 全部一致；D2/D3/D7 至少有可编码结论 | 停止报告；不改写历史；不猜合同 |
| Stop-1 | S1 | diff + 测试 + 证据 | schema/ID/谓词/签名与 §17.2/§18.2/§18.7 一致；0 Store 改动；0 写 | 同阶段追加修复 |
| Stop-2 | S2 | diff + refs/链测试 + 零写 | 17 refs（或 D2 批准后的明确数量）；anchor/1..9/完整链；无布尔；零写 | 同阶段追加修复 |
| Stop-3 | S3 | diff + ticket/audit 测试 | finalWriteSet 字节绑定；唯一 audit；explicit；0 新增 refs | 同阶段追加修复 |
| Stop-4 | S4 | Store diff + 全路径测试 | 8 集合/全路径/explicit/≤90/无双审计；非 H4-c 零回归 | 同阶段追加修复 |
| Stop-5 | S5 | diff + 运行时谓词测试 | K3/marker/proof/writer plan/fence/健康/错误顺序正确；只读；旧 W0 无授权 | 同阶段追加修复 |
| Stop-6 | S6 | 全量证据 | 全绿 + F/N 逐项 + 10 轮并发 + 静态 0 + 预算 + 白名单；未验证单列 | 退回对应阶段；不得 S6 直接修 |

交付回报模板（每个 Stop 必填）：

```text
阶段：S0..S6
分支/提交（完整 SHA）/父：
改动文件（完整清单）：
命令 / exit / 计数（定向、Admin、根、guard）：
refs/writes 实测（helper 业务写 / 事务总写）：
F/N 逐项（PASS/FAIL/未测）：
全库零写证据（快照方法、集合级比较、文件 hash）：
未验证/未测（必须单列，不得并入通过）：
远端状态（push 前 ls-remote、push 后远端 SHA）：
请求复审项：
```

## 13. 待裁项（实施前必须清零或明确延后条件）

| ID | 缺失/歧义 | 证据 | 阻断阶段 | 建议/需要 Codex 裁定 |
|---|---|---|---|---|
| D1 | 云派单 `DISPATCH.md` 本机不存在 | 用户消息 + 本机路径检查 | S0 | 确认本卡范围是否与云端派单一致；若不一致以云端为准，本卡重写 |
| D2 | **C1 17 refs 组成不含 audit proof ref**，但 `CoverageValid` 必须读当前 proof；按 17 逐项相加恰为 domain2+audit1+fence1+marker1+writerPlan1+anchor1+head1+E1..9，无 proof | 设计 §17.5 `:1283`、§16.5 `:901`；`CoverageValid` §3.2 | **S2** | 二选一：① 补 `proof1`，C1 变 18 refs（需批准预算变更）；② 明确 proof 由哪个已列 ref/签名票据承载（不得靠未声明读）；未裁定不得实现 |
| D3 | 集合字面名缺失：anchor、audit proof、K3 marker；设计只明确 `evidence_chain_fences`、`evidence_chain_plans`、3 个现有集合 | 设计 §15.4 `:740`、§16.1 `:835`、§17.5 `:1297` | S1/S2/S4 | 建议 `evidence_chain_anchors`、`evidence_chain_audits`、`evidence_chain_k3_markers`；需 Codex 冻结后才能写常量 |
| D4 | proof `status` 允许值、`legacyCount` 规则未枚举；admin_audit `_id` 公式的 `revision` 在 C1 首条/追加时的取值未定义 | 设计 §4.2 `:159`、§4.13 `:316` | S1/S3 | 冻结 proof.status/legacyCount；明确 audit `revision` = head revision 或 evidence sequence，及 C1 的 `action/scopeKey` |
| D5 | runtime 的 `operationAuthDigest` 取值未定义；§4.6 只列 migration/recovery/monitor/k3-bootstrap | 设计 §4.6 `:212` | S3 | 建议 runtime 显式 `null`（JSON null）；需确认不得自造 digest |
| D6 | C1 新 API 形状未定义：refs/builder 如何接收 proof/fence/marker/writerPlan/anchor/audit；是否提供 finalWriteSet helper | 现 `evidenceAppendRefs` 签名 `admin-web/lib/face-service/h4c-evidence.mjs:322`；设计 §4.13 `:324` | S2/S3 | 冻结最小导出集与参数；C1 helper 只返回业务写，audit 由调用方/测试显式传入 |
| D7 | Store gate 接口未定义：如何获得 K3 config/ticket、`auditMode` 如何传、`persist` 如何私有化、Local/Cloud 如何对齐 | 设计 §4.4 `:166`、§4.13 `:322`；现 `store.mjs` 无 gate | S4 | 冻结 `transact` options / gate 工厂；禁止 Store 读环境或信任调用方布尔 |
| D8 | N01–N142 与“工具另立卡”的测试归属冲突 | 设计 §14 第 6/7 条 `:600-601` | S6 | 确认 §11.2 划界；若要求 C1 全覆盖，明确合成记录边界 |
| D9 | 设计页首自述“待 Codex 复审”，与“已批准设计”口径不一致；实施分支名/起点未派单 | 设计页首 `:3`；本卡 §1.4 | S0 | 明确批准文/批准 SHA 与实施分支；本卡不代替批准 |

## 14. 明确未做/未验证

- 未实现任何 C1 代码；未修改 `h4c-evidence.mjs`/`index.mjs`/`store.mjs`/测试/设计。
- 未运行任何测试；31/581/51 是 5dff386 历史证据，不是本卡结果。
- 未安装依赖；未访问真实 Cloud/K3/设备/Provider/支付/业务网络；未注册 HTTP/UI；未部署。
- 未读 `/workspace/artifacts/C1-epoch-RENTAL-retry-review/DISPATCH.md`（本机不存在）；不声称与云端派单逐项一致。
- 未验证真实 Cloud 并发事务（LocalStore 队列/Cloud fake 串行）；归 C3。
- 未验证 D2/D3/D4/D5/D6/D7 的任何一种猜测；这些必须由 Codex 裁定后才能进入对应阶段。
- 本卡不自批、不宣称 C1/G1 通过、不授权合并/实施。

## 15. 本卡交付

- 分支：`docs/h4c-c1-staged-implementation-task`；父：`fcae2460ab0a239c54463530b0b5001f34b1f302`。
- 文件范围：仅本文件（单文档提交）。
- 提交后由交付回报给出：完整 SHA、`git show --stat`、`git ls-remote` 远端 SHA、固定 SHA 文件 URL。
- 普通 push；不 amend/rebase/reset/squash/force/cherry-pick/merge；push 前若远端目标分支前移/分叉，停止报告。
- 交 Codex 独立复审：重点为 §13 的 D1–D9、§3.3 的 C1 17 refs 与 §3.2 的 24/39/18/12 字段、§5–§10 的阶段边界与停止点、§11 的 C1/另卡归属。
- 复审前不开始 S1；不自批。
