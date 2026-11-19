# HK-AI-04 H4-c C1 分阶段实施任务卡（r5）

> 状态：**任务卡修订 + 设计勘误，D4a/D4b/D5 已按本轮明确裁定回写；待 Codex 复审，不授权实施。** 本修订只修订本卡与勘误文档；不实现 C1、不运行测试、不修改已验设计正文/生产代码/测试/Store/迁移脚本，不进入 C2/C3、HTTP/UI、部署上线，不安装依赖、不连接设备、不调用 Provider/生产云/支付。
>
> 本修订输入：`d095a1888a2efba7ac8bfea76dfe120a3a74bf08`（父 `09f559dcbd3f69bcec1f0a15487d2fc5bcf42b97`；tree `c96640ae33a5d51f6dc6981cde1fa8d389481ea6`）。工作树 `C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\c1-staged-task`；分支 `docs/h4c-c1-staged-implementation-task`；开始工作时 HEAD = 输入提交，工作区干净。
>
> 执行 run：`hrun-mwn0lqcp-02816b`（DSH `session-59b359d6-bd54-4f32-a4ab-244a4c0a79f9`；本修订 2026-11-19T11:53+08:00）。
>
> 设计输入：`docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md`（1607 行，v8；blob `c4feffa5831f5bf0e04e8e902865cb8e1f1b0183`，sha256 `d769da93c4880409c946e316f2414ca6b1135a96361934abc188111ca6dcbec7`）。冲突优先级：**§18 > §17 > §16 > §15 > §4–§14 历史正文**。
>
> 勘误输入：`docs/tasks/HK-AI-04-H4C-C1-REFS-ERRATUM-2026-11-19.md`（本修订同步修订 r4；E1 proof 漏算、E2 集合字面名、E3 Store 接口/DI + 不可变集合门禁、D4a/D4b/D5 本轮裁定回写）。**18/27 预算保留；Set/门禁/健康/授权规则保留；D4a/D4b/D5 以本轮裁定为准，不倒推为旧设计已明确。**
>
> 代码基线：`5dff386fe5c9648b04d1623d3e1898c59332639e`（C1 final，`feat/hk-face-h4c-reconciliation`）。`fcae246` 是 `5dff386` 的后代（10 个 docs-only 提交）；`git diff --stat 5dff386..fcae246 -- . ':(exclude)docs'` 为空。
>
> 云指令/审查：`/workspace/artifacts/FIVE-FOLLOWUPS-REVIEW-2026-11-19/DISPATCH.md` 与 `REVIEW.md` 本轮仍未取得本机可读正文；已检查 `C:\workspace\artifacts\...`、`/workspace/artifacts/...`、`\\wsl$\workspace\...`、`C:\workspace` 根及仓库 `.tmp`/`docs`，均无副本。**未读，不声称完整闭合**。派单背景：D 关闭；C/G 不重派；Git 偏差 OPEN 未恢复；E/F 等外部材料。

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 本卡目的 | 把 C1 设计拆成 6 个可独立复审、串行推进的实施阶段（S0–S6），每段有依赖、允许文件、精确输入、实现/测试范围、refs/writes 预算、负向/并发/全库零写验收和复审停止点 |
| 核心修订 | 按勘误 E1：**C1 refs 17→18**（补 `proof1`），**C2 R1 26→27**；writes 3/2 不变；余量 64→63。**18/27 按本轮口径保留（可采纳）**。C1 17 的 `audit1` 是 `admin_audit`，不是 proof |
| 集合修订 | 按勘误 E2：8 个 H4-c 集合含 **audit proof**；`admin_audit` 是通用 7 字段审计，单独 explicit 门禁，不计入 8。补全全部字面名 |
| 接口修订 | 按勘误 E3：`h4c-collections.mjs` **私有 Set + 只读 `isH4cCollection` + 冻结枚举快照（不导出 Set）**；`createH4cGate` + 构造注入；`transactFinal` explicit 入口；`#persist` 私有；`transact/change/seed/init` 全路径拒绝 H4-c 记录写；补全签名/权限/错误契约/显式写集/验收矩阵 |
| 测试修订 | 删除会启动 loopback 监听的 r1 全量 glob；改为 **33 个非 HTTP 文件 + 7 个根文件显式清单**；必须“加载前 guard”；8 个 HTTP 文件不跑 |
| D4/D5 修订 | 按 §3.3g/§3.3h：D4a `status="verified"`/`legacyCount=0`/snapshot；D4b C1 audit scopeKey=job._id、genesis/append、revision=新 sequence、targetList；D5 runtime `operationAuthDigest=null`+ticket 签名该键+runtime 白名单。均为本轮新增裁定，已关闭 |
| 当前状态 | 只写卡与勘误；无代码、无测试执行、无设计修改、无依赖安装、无云/设备/支付/业务网络 |
| 实施前阻断 | D4a/D4b/D5 已按本轮裁定关闭；仍阻断开工程序项：E2/E3/P9 未复审前 S1/S4 不得开工；D10 persist 影响未决前 S4 不得开工；D8/D9 未决前按 §13；E1 的 18/27 保留 |
| 复审 | 每段结束交 Codex 独立复审；本卡与任何阶段均不自批、不合并、不宣称 G1/C1 已通过 |

## 1. 输入、基线与只读核对

### 1.1 已核对事实（只读，2026-11-19 +08:00）

| # | 事实 | 结果/证据 |
|---:|---|---|
| 1 | 本修订输入 SHA | `d095a1888a2efba7ac8bfea76dfe120a3a74bf08` |
| 2 | 直接父 | `09f559dcbd3f69bcec1f0a15487d2fc5bcf42b97` |
| 3 | 本修订输入 tree | `c96640ae33a5d51f6dc6981cde1fa8d389481ea6`（d095a18 的 tree） |
| 4 | 工作树/分支/HEAD | `.tmp/c1-staged-task`；`docs/h4c-c1-staged-implementation-task`；HEAD 等于输入 SHA；无 upstream |
| 5 | 工作区 | `git status --porcelain` 为空（开始工作时） |
| 6 | 远端 | `origin https://github.com/1997dmsu-sketch/SMART-PM.git`；`origin/docs/h4c-c1-staged-implementation-task` = `d095a18…`；`origin/docs/hk-face-c1-epoch-uniqueness` = `fcae246…`；无前移/分叉 |
| 7 | TLS/凭据 | 逐命令 `-c http.sslBackend=openssl` 可完成 `ls-remote`/`fetch`；`schannel` 报 `SEC_E_NO_CREDENTIALS`；不写任何全局配置 |
| 8 | 设计文档 | 1607 行；blob/sha256 见页首；原卡已逐段阅读 §0–§18.13；本修订复核 §3.2/§4.2/§4.6/§4.13/§16.4/§17.2/§17.5 与 D4/D5 相关行 |
| 9 | 勘误文档 | 本修订同步修订 r4（E1/E2/E3 + 私有 Set + D4a/D4b/D5 裁定回写）；未获复审前不得实施 |
| 10 | 审查证据 | `docs/tasks/HK-AI-04-H4C-C1-REVIEW-EVIDENCE-2026-11-14.md`（305 行）已读；31/581/51 是 5dff386 历史结果，本卡未重跑 |
| 11 | 代码基线 | `5dff386`；`h4c-evidence.mjs` 471 行、`index.mjs` 60 行、`store.mjs` 524 行、C1 测试 1342 行 |
| 12 | 代码差异 | `5dff386..fcae246` 非 docs 差异为空；`fcae246` 仅改设计文档 |
| 13 | 云指令/REVIEW | 本机未取得；检查路径见页首；未读，不据此声称任何云端裁定 |
| 14 | 设计自述状态 | 设计页首仍写“设计提案，待 Codex 复审”，与“已批准”口径存在差异，列 D9 |
| 15 | 测试文件盘点 | admin-web 41 个 `.test.mjs`；其中 8 个会 `listen`/`fetch` loopback；33 个非 HTTP；根 7 个 `.test.cjs`（无 listen） |

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
| **refs/writes（勘误后）** | **C1 18/(3\|2)**；**C2 27**；migration-anchor 18/2；finalize 8/5；recovery 8/5；rotate 8/4；monitor 7/2；k3 5/4；plan 2/2；≤90 | §3.3；S6 静态核算 |
| 无双审计 | finalWriteSet 先物化（业务+唯一 audit）再签票；Store explicit 模式不自动追加/不改写；双审计 → ADMISSION/回滚 | S3 字节；S4 Store 门禁 |

- 勘误 E1/E2/E3 是对设计的**显式补正**，不是静默重开；canonical ID、每 epoch 唯一、planKind consumed、39 字段、健康谓词、错误码均不变。

### 1.3 范围

**本卡覆盖（获准实施后）**

- C1 运行时契约层：常量、exact schema、canonical ID、HMAC/摘要、admission/fence/coverage/writer-plan 谓词。
- C1 链层：**18 refs**、anchor、`1..9` 全量 evidence ID、完整 canonical 链、`previous` 复核、head CAS；删除调用方布尔。
- C1 授权层：precheck、final ticket、`refsDigest/writesDigest`、唯一 `admin_audit`、explicit 审计模式。
- Store 全路径门禁：8 个 H4-c 集合 + 通用 `admin_audit`、`transact/transactFinal/change/persist/seed/init`、create-only/exact、≤90、无双审计。
- C1 运行时覆盖：K3 domain/marker/proof/writer plan/fence 读取与失败关闭、健康过期与 halted 分离、错误码分层。
- C1 实现级测试与验收：F/N 矩阵中 C1 归属行、全库零写、并发、静态扫描、33 个非 HTTP 文件 + 7 根文件回归。

**明确不在本卡**

- migration-anchor/finalize、recovery-finalize、writer-rotate、monitor heartbeat/halt、k3-bootstrap、plan-issue/plan-revoke 的**执行事务工具**（另立卡；C1 只实现其记录 schema/票据校验和 Store create-only 语义验证）。
- C2（服务/DTO/权限/HTTP/op key/log）、C3（真实 Cloud/K3 运维/告警/Provider/设备/路由注册）。
- `admin-web/server.mjs`、`routes.mjs`、任何 HTTP/UI；任何 main/07B 合并；任何部署/上线/数据库迁移。
- 修改已批准设计、重开 epoch canonical ID/planKind consumed 等契约、新增索引/epoch 计数器（§18.8 明确不采用）。
- 安装依赖、运行真实 Cloud/设备/Provider/支付/业务网络；真实并发 Cloud 事务（C3）。
- 8 个会启动 loopback 监听的 HTTP 测试文件（见 §3.7）；它们不属于 C1 验收。

### 1.4 本卡与后续实施卡的 Git 规则

- 本修订：修改本卡 + 同步修订勘误文档；父 = `d095a18`；普通 push 到同一分支；不 amend/rebase/reset/squash/force/cherry-pick/merge。
- 后续实施分支：建议 `feat/hk-face-h4c-c1-staged`，起点 = 本修订提交（保证设计+勘误+卡在同一祖先链）；分支名待调度方确认（D9）。
- 所有 git 命令逐命令带 `-c safe.directory="<绝对路径>"` 与 `-c http.sslBackend=openssl`；不写全局/系统 git 配置；不使用替代 SHA 或强制推送。
- push 前 `ls-remote` 确认目标分支与本地一致；若远端前移/分叉/出现平行提交，**停止并报告**，不 reset/merge/force。
- 每个阶段一个独立提交（单用途）；阶段提交只允许 §2/各段列出的文件；证据文档仅追加本阶段小节。
- 阶段失败/复审退修：在**同一阶段分支**追加修复提交，不重写历史、不跨阶段夹带下一阶段改动。

## 2. 阶段总览与依赖

| 阶段 | 产出 | 依赖 | 允许文件（生产/测试） | refs/writes | 停止点 |
|---|---|---|---|---|---|
| S0 | 基线冻结 + 勘误审批 + 待裁清零；证据 §0 | 无 | 无代码；仅证据文档 | 0/0 | Stop-0 |
| S1 | 契约层：常量、8 集合字面名、**私有 Set + `isH4cCollection` + 冻结枚举快照**、exact schema、canonical ID、摘要、谓词 | S0；E1 18/27 保留；E2/E3/P9 待批；**D4a 已关闭** | `h4c-collections.mjs`（新）、`h4c-evidence.mjs`、`index.mjs`、C1 测试 | 0/0 | Stop-1 |
| S2 | 链层：18 refs、anchor、`1..9`、完整链、无布尔 | S1；E1 18/27 保留 | 同上 | **18 / 3\|2** | Stop-2 |
| S3 | 授权层：precheck、final ticket、唯一 audit、explicit finalWriteSet | S2；**D4b/D5 已关闭**（C1 test-only audit；C2/control 另卡） | 同上 | **18 / 3\|2（0 新增）** | Stop-3 |
| S4 | Store 门禁：8 集合 + `admin_audit`、全路径、create-only/exact、explicit 模式、gate 注入、M01–M30 | S3；E2/E3/P9 批准；D10 处置 | `store.mjs`、`h4c-collections.mjs`、`h4c-evidence.mjs`、`index.mjs`、C1 测试、（条件）`store-deterministic-audit.test.mjs`、（条件）`verification.test.mjs` | 不改变预算；≤90 | Stop-4 |
| S5 | 运行时覆盖：K3/marker/proof/writer plan/fence、健康与错误分层 | S1/S2/S4；**D4a 已关闭**；D3 | `h4c-evidence.mjs`、`index.mjs`、C1 测试 | **18 / 0（只读）** | Stop-5 |
| S6 | 验收：F/N 矩阵、并发、零写、静态扫描、33+7 显式回归、证据 | S1–S5 全部 Stop 通过 | C1 测试（仅补断言）、证据文档 | 只验证 | Stop-6 |

依赖关系（串行，禁止跳段）：

```text
S0 ──> S1 ──> S2 ──> S3 ──> S4 ──> S5 ──> S6
```

- 一个阶段只有在其 Stop 获 Codex 明确通过后才可开始下一阶段；不得以“测试已绿”代替复审。
- 同一阶段内可多次提交修复，但不得夹带下一阶段内容；每段最终提交的 diff 必须能用 `git diff --stat` 复现。
- 任一阶段发现设计缺口或已冻结契约无法落地：停止该阶段，在证据中列最小反例与影响，交 Codex 裁定；不得自行“修正”设计。

## 3. 全阶段统一契约

### 3.1 H4-c 集合与 Store 写路径（勘误 E2）

8 个 H4-c 集合（§15.4/§16.5/§17.5；字面名见勘误 E2，待批准）：

| 集合 | 字面名 | 约束 | 可写事务 |
|---|---|---|---|
| evidence | `device_operation_evidence`（现名） | exact + create-only | C1 genesis/append、C2 |
| evidence head | `device_operation_evidence_heads`（现名） | exact + 可更新（CAS） | C1、C2 |
| K3 domain | `evidence_digest_domains`（现名） | exact + create-only | 仅 k3-bootstrap（C1 只读） |
| anchor | `evidence_chain_anchors`（勘误 E2） | exact (6) + create-only | C1 首条；migration-anchor |
| audit proof | `evidence_chain_audits`（勘误 E2） | exact (24) + create-only | finalize、recovery、rotate |
| fence | `evidence_chain_fences`（§15.1.1） | exact (12) + 可更新 | finalize、recovery、monitor |
| K3 marker | `evidence_chain_k3_markers`（勘误 E2） | exact (18) + create-only | 仅 k3-bootstrap |
| plans | `evidence_chain_plans`（§15.2.1） | exact (39) + create-only（status 精确更新） | plan-issue/revoke、finalize、recovery、rotate |
| 通用审计 | `admin_audit`（现名） | exact (7) + explicit | 所有事务唯一审计；**不计入 8 集合** |

- `admin_audit` 不是 8 个 H4-c 集合之一；H4-c 对它的写只能作为 `transactFinal` 的唯一 audit，且必须被 gate 校验。
- 若 Codex 裁定 8 集合中的 “audit” = `admin_audit`，则 audit proof 需成为第 9 个集合（仍需字面名）；C1 refs 仍 18、C2 27；本卡不依赖“8”这个计数成立，但需在 Stop-0 明确选哪种。

Store 写路径（§4.4；S4 实现并测试）：

| API | H4-c 行为 | 验收要点 |
|---|---|---|
| `transactFinal` | 唯一允许写 H4-c 的 explicit 入口；必须 final ticket + 唯一 audit | gate 重算 digest；shape/fence 终检；无 ticket → `ADMISSION_REQUIRED`；90 上限；无自动 audit |
| `transact` | 旧签名保留；refs 含 H4-c 8 集合 → 一律拒绝 | 不 build、不写；`ADMISSION_REQUIRED`；非 H4-c 行为不变 |
| `change` | **一律拒绝** H4-c | 任何 H4-c 集合名 → 拒绝、零写 |
| `#persist` | private；仅 `init`/`transact`/`transactFinal` 内部可用 | 外部无入口；不得作为绕过 gate 的入口 |
| `seed()` | 只允许空数组 | 任一 H4-c 集合非空 → 拒绝 |
| `init()` | 只补空数组默认值（不写记录） | 不写 evidence/head/anchor/audit proof/fence/marker/plan；不持久化链 |
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
| audit proof | 24 | v4 22 字段 + `k3MarkerDigest` + `writerPlanId`；见下方分解 | §4.2/§16.4 |
| plan | 39 | 字段名以 §17.2 表 1–39 为唯一清单（30 core + 9 status/runtime）；writer canonical ID 见 §18.2 | §17.2/§18.2 |

audit proof 24 字段分解（冻结）：

```text
_id, kind, scope, schemaVersion, realm, keyVersion, keyFingerprint,
domainHeadId, domainHeadRevision, writeEpoch, admissionPolicyVersion,
writerSetDigest, auditedCollections, status, canonicalEvidenceCount,
canonicalHeadCount, anchorCount, legacyCount, inventoryDigest, checkedAt,
checkedBy, auditDigest, k3MarkerDigest, writerPlanId
```

- `status` 仅接受 `"verified"`；`legacyCount` 为安全非负整数且仅接受 0；含义为可信全量盘点后仍不满足当前 canonical schema/K3/链/anchor 的 evidence/head 记录数；counts/inventoryDigest 为 epoch 激活前快照，append 不每次全扫（本轮裁定，见 §3.3g）。
- 所有 validator 必须拒绝多字段/缺字段/类型错误/非 plain object；拒绝信息走统一错误码。
- `stableStringify` 规则沿用现有实现：plain object、key UTF-16 升序、数组有序、NFC/UTF-8、拒绝 `undefined/function/symbol/BigInt/NaN/Infinity/-0`、hex 小写 64。

### 3.3 refs/writes 预算（勘误 E1 后；本卡不重开其他契约）

| 事务 | refs 组成 | refs | writes | writes |
|---|---|---:|---|---:|
| C1 首条/非首条 | domain2 + proof1 + audit1 + fence1 + marker1 + writerPlan1 + anchor1 + head1 + E1..9 | **18** | anchor+E+head / E+head | **3 / 2** |
| C2 R1 | C1 18 + org/member/job/grant4 + op key/domain3 + job log/op log2 | **27** | job/evidence/head/anchor/log/op/audit | — |
| migration-anchor | domain2+fence1+marker1+writerPlan1+plan1+head1+E9+anchor1+audit1 | **18** | anchor+audit | **2** |
| migration-finalize | domain2+fence1+marker1+W0+plan1+proof1+audit1 | **8** | fence+proof+migrationPlan+W0+runtimeTicket+audit | **5** |
| recovery-finalize | domain2+fence1+marker1+W1+recoveryPlan1+proof1+audit1 | **8** | fence+proof+recoveryPlan+W1+runtimeTicket+audit | **5** |
| writer-rotate | domain2+fence1+marker1+W0+W1+proof1+audit1 | **8** | fence+proof+W1+runtimeTicket+audit | **4** |
| monitor heartbeat/halt | domain2+proof1+fence1+marker1+writerPlan1+audit1 | **7** | fence+audit | **2** |
| k3-bootstrap | domain2+fence1+marker1+audit1 | **5** | domain2+marker+audit | **4** |
| plan-issue/plan-revoke | plan1+audit1 | **2** | plan+audit | **2** |
| C2 R2 | H4-b 8+N | **≤90** | 独立事务 | — |

- **只有 C1 与 C2 R1 因 proof 漏算 +1**；其余事务原本已含 `proof1`（target 或 current），不重复加。
- C1 的 **3/2** 按 §17.5 口径 = helper 业务写（anchor+E+head / E+head）；唯一 `admin_audit` 由 explicit finalWriteSet 追加，事务总写 **4/3**，但不得据此新增 ref 或改写预算表。S6 同时记录两组数字。
- `proof1` 是只读 ref；C1 不创建/不修改 proof；writes 不变。
- 单事务 ≤90；C2 R1 27 距上限余 **63**。
- 票据验证（planDigest/planTicket/initialStatusTicket/statusTicket/runtimeTicket）**0 新增 refs**；`runtimeTicket` 是 plan 记录字段，不是新记录。
- **勘误 E1 未批准前不得实现 18 refs**：S2 起以审批值为准。

### 3.3a C1 API 形状（本卡冻结，随卡审批）

```js
// h4c-evidence.mjs
export function evidenceAppendRefs({ job, expectedHead, proofId, writeEpoch, auditId, config } = {})
// -> exact 18 refs, unique, stable order; no Store access

export function appendEvidenceWrites(state, {
  job, expectedHead, proofId, writeEpoch, auditId, config, now,
  decision, sourceType, sourceCode, observedAt, actorId,
} = {})
// -> business writes only: 3 (genesis: anchor+E+head) / 2 (append: E+head)
// C1 helper does NOT build admin_audit; caller/test adds it.
```

- `proofId` 由 precheck 提供（或由 K3 fp + domainHeadRevision + writeEpoch 确定性计算）；`writerPlanId=planId(writeEpoch)`；`auditId` 由调用方/测试提供。
- refs 计算不需要先读 proof，不产生循环；事务内 `appendEvidenceWrites` 从 `state` 读 proof/fence/marker/plan/anchor/head/E1..9。
- C1 helper 只返回业务写；finalWriteSet 的唯一 audit 由 S3 的 final ticket helper/调用方加入。
- 不允许把 proof/fence/marker/plan 作为“调用方布尔/自述”传入；必须按 refs 从 `state` 读取并校验。

### 3.3b 集合门禁：封闭私有集合与只读成员判定（P9）

```js
// admin-web/lib/h4c-collections.mjs（新，纯常量，无 import/副作用）
export const H4C = Object.freeze({
  evidence: "device_operation_evidence",
  evidenceHeads: "device_operation_evidence_heads",
  domains: "evidence_digest_domains",
  anchors: "evidence_chain_anchors",
  auditProofs: "evidence_chain_audits",
  fences: "evidence_chain_fences",
  k3Markers: "evidence_chain_k3_markers",
  plans: "evidence_chain_plans",
});

// 不可变枚举快照：冻结数组，仅用于枚举/断言
export const H4C_COLLECTION_NAMES = Object.freeze([
  H4C.evidence, H4C.evidenceHeads, H4C.domains, H4C.anchors,
  H4C.auditProofs, H4C.fences, H4C.k3Markers, H4C.plans,
]);

export const H4C_AUDIT_COLLECTION = "admin_audit";

// 封闭私有集合：模块作用域，绝不导出；无 add/delete/clear 外部入口
const H4C_COLLECTION_SET = new Set(H4C_COLLECTION_NAMES);
// 捕获原型方法，避免运行期替换 Set.prototype.has 绕过判定
const setHas = Set.prototype.has;

// 只读成员判定：只接受字符串；不返回集合/遍历器
export function isH4cCollection(name) {
  return typeof name === "string" && setHas.call(H4C_COLLECTION_SET, name);
}
```

- **不得导出 `H4C_COLLECTION_SET`**；`H4C_COLLECTION_NAMES` 是冻结数组；`H4C` 是冻结对象；`isH4cCollection` 是唯一成员判定入口。
- `isH4cCollection` 必须捕获模块加载时的 `Set.prototype.has` 并用 `setHas.call(privateSet, name)`，避免运行期替换原型方法绕过；不得暴露 private Set 或 `setHas`。
- **不得把 `Object.freeze(new Set(...))` 当不可变**：`Object.freeze` 不阻止 `Set.prototype.add/delete/clear`；因此本方案不导出任何 Set。
- `store.mjs` 只 import `isH4cCollection` 与 `H4C_AUDIT_COLLECTION`；不得 import Set，也不得在 Store 内另建第二份集合字面量。
- 不提供 `addH4cCollection`/`removeH4cCollection`/`setH4cCollections`/`getH4cCollectionSet` 等 API。
- 验收：命名空间无 `H4C_COLLECTION_SET`；`Object.isFrozen(H4C)`/`H4C_COLLECTION_NAMES` 为真；`push`/下标/属性赋值抛错；`isH4cCollection` 对 `admin_audit`、`__proto__`、`constructor`、空串、null/对象/Symbol 返回 false，对 8 个字面量返回 true。

### 3.3c Gate 签名、调用权限与错误契约

```js
// h4c-evidence.mjs
export function createH4cGate({ config, health = {} } = {})
// 返回 Object.freeze({ verify({ state, refs, writes, admission, now }) })
// verify 成功返回 undefined；失败抛 HttpError；不得返回布尔
```

- `config` 必须是 `evidenceKeyConfig()` 结果（key Buffer、realm、version、fingerprint）；gate 不读 `process.env`。
- `health = { windowMs: 300000, skewMs: 30000 }`（安全整数，window>0，skew≥0）；非法 → `NOT_CONFIGURED`/`EVIDENCE_INVALID`。
- `now` 为受信服务时钟的安全整数；gate 不调用 `Date.now()`。
- 返回 gate 必须冻结，只暴露 `verify`；不暴露 key/config/health/Set；无 `setConfig`/`replace` 等 mutator。
- `verify` 必须同步、无 I/O、无 Store 访问；不得修改 `state/refs/writes/admission/now`（测试用 `structuredClone` 前后 `deepEqual`）。
- **调用权限**：只有 Store 的 `transactFinal` 在 `build(state)` 之后、任何写入之前调用一次；调用方可以预检，但不能替代这次调用；gate 可跨事务复用（无状态）。
- **错误契约**：`NOT_CONFIGURED` 503；`DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH` 409；`EVIDENCE_CHAIN_PROOF_REQUIRED` 409；`EVIDENCE_CHAIN_HALTED`/`EVIDENCE_CHAIN_FENCE_EXPIRED` 409；`EVIDENCE_CHAIN_ADMISSION_REQUIRED` 409；`EVIDENCE_CHAIN_BROKEN`/`EVIDENCE_INVALID` 409。失败必须零写。
- **C1 白名单**：仅接受 `kind="runtime"` 且 `operation∈{"genesis","append"}`；control kind/operation 默认拒绝（即使 `operationAuthDigest=null`）；runtime ticket 必须包含并签名 `operationAuthDigest:null`。
- 检查顺序：admission 形状 → refs 去重/≤90/18 shape → writes 声明/唯一 audit → refsDigest/writesDigest/ticket → fence `FenceValid(now)`/epoch → proof/marker/writer plan 绑定 → 返回。

### 3.3d Store 构造、全路径签名、权限与错误

```js
export class LocalStore {
  #h4cGate;
  constructor(directory, { h4cGate = null } = {}) { ... }
  async transactFinal(refs, build, admission, { now, auditMode = "explicit" } = {}) { ... }
  async transact(refs, build, audit) { ... }       // legacy，仅非 H4-c
  async change(name, id, build, audit) { ... }     // legacy，仅非 H4-c
  async #persist(data) { ... }                     // 私有
}
export class CloudStore {
  #h4cGate;
  constructor(app, { h4cGate = null } = {}) { ... }
  async transactFinal(refs, build, admission, { now, auditMode = "explicit" } = {}) { ... }
}
```

- `#h4cGate` 私有：构造后不可替换；无 getter/setter；不通过 `store.h4cGate` 暴露；非 null 但缺 `verify` 的对象 → 构造时 `TypeError`（编程错误，零写）。
- **`transactFinal` 唯一 H4-c 写入口**：
  1. `auditMode !== "explicit"` → `ADMISSION_REQUIRED`（不 build）。
  2. `#h4cGate == null` → `ADMISSION_REQUIRED`（不 build）。
  3. `admission` 形状错 → `ADMISSION_REQUIRED`（不 build）。
  4. `now` 非安全整数 → `EVIDENCE_INVALID`（不 build）。
  5. refs 形状/重复 → `EVIDENCE_INVALID`；>90 → 400 容量错误（不 build/不写）。
  6. 按 refs 读 state；`await build(state)` 必须返回数组；抛错原样上抛、零写。
  7. 校验 finalWriteSet：声明、字段、H4-c 子集、唯一 audit、无未声明写；失败 → `ADMISSION_REQUIRED`/`EVIDENCE_INVALID`。
  8. `#h4cGate.verify({ state, refs, writes, admission, now })`。
  9. 只写 finalWriteSet；不自动追加 audit、不随机 audit、不改 `_id/createdAt/target`。
  10. 失败整事务回滚；LocalStore 成功才落文件，CloudStore 成功才提交。
- **同一时钟**：调用方必须把同一 `now` 传给 C1 builder 上下文与 `transactFinal` options；Store 只用 `options.now` 调 gate；不得出现两个时钟或 gate 自取时间。
- **`transact`（legacy）**：refs 中任一 collection 使 `isH4cCollection` 为真 → `ADMISSION_REQUIRED`，**不 build、不写**；若 refs 不含 H4-c 但 `build` 返回 H4-c 写，按未声明写/`ADMISSION_REQUIRED` 拒绝（不得作为绕过）；非 H4-c 行为/确定性审计不变。
- **`change`（legacy）**：`isH4cCollection(name)` 为真 → `ADMISSION_REQUIRED`，**不 build、不写**；非 H4-c 行为不变。
- **`#persist`**：私有；仅 `init`/`transact`/`transactFinal` 内部调用；不暴露 `persist` 别名；外部无法触发全量持久化。
- **`seed()`**：8 个 H4-c 集合只允许空数组；任一非空 → `ADMISSION_REQUIRED`；非 H4-c 默认值不变。
- **`init()`**：缺失的 H4-c 集合补空数组（仅内存）；已有 H4-c 值不是数组 → `EVIDENCE_INVALID`（不修复）；已有非空 H4-c 数组 → 原样保留、不写/不改；不写任何 H4-c 记录；仅在数据文件不存在时持久化 seed（H4-c 为空数组）。
- LocalStore/CloudStore 语义一致；Cloud fake 事务失败整批回滚；不改 `server.mjs`/`routes.mjs`；C1 不注入生产 gate。

### 3.3e 显式写集与审计契约（`transactFinal` 唯一）

- `finalWriteSet = await build(state)` 必须为数组；每项 `{collection,id,data}`；`data._id===id`；字段 exact。
- 恰好一条 `collection===H4C_AUDIT_COLLECTION` 的写；不得 0 条/2 条；不得 Store 自动追加/随机 UUID。
- `admin_audit` 恰好 7 字段：`_id, orgId, actorId, actorType, action, target, createdAt`；`_id = "audit-h4c-v1:" + 32 位小写 hex`；`target` 为排序后的业务写 `collection/id`（不含 audit 自身）以 `", "` 连接；`createdAt` 安全整数。
- C1 audit 精确公式（§3.3g）：`scopeKey=job._id`；首条 `action="h4c.evidence.genesis"`/非首 `"h4c.evidence.append"`；`revision=本次新 evidence.sequence`；`targetList` 排序、不含 audit、重复业务目标拒绝；`_id="audit-h4c-v1:"+sha256(stable([orgId,scopeKey,action,targetList,revision])).slice(0,32)`；`createdAt` 同一可信 `now`。
- audit 的 `_id` 必须已在 refs 声明；`target` 必须与实际业务写目标逐项一致；`orgId/actorId/actorType/action` 为非空 opaque 字符串。
- C1 只写 anchor/E/head + audit；不得写 domain/proof/fence/marker/plan；shape 不符 → `ADMISSION_REQUIRED`。
- `writesDigest` 覆盖含 audit 的最终字节；终检后不得追加/修改任何写。
- 缺失/重复/未声明/字段错/目标不一致 → `ADMISSION_REQUIRED`，零写；`build` 抛错 → 原错误，零写。

### 3.3f 全路径验收矩阵（S4 必跑；LocalStore 与 CloudStore 各跑一遍）

| ID | 路径 | 场景 | 期望 | 零写 |
|---|---|---|---|---|
| M01 | `transactFinal` | 合法 C1 首条 | 成功；anchor+E1+head+audit | — |
| M02 | `transactFinal` | 合法 append | 成功；E+head+audit | — |
| M03 | `transactFinal` | 无 gate | `ADMISSION_REQUIRED` | Z_all |
| M04 | `transactFinal` | admission 缺失/字段错 | `ADMISSION_REQUIRED` | Z_all |
| M05 | `transactFinal` | `auditMode≠explicit` | `ADMISSION_REQUIRED` | Z_all |
| M06 | `transactFinal` | `now` 缺失/非安全整数 | `EVIDENCE_INVALID` | Z_all |
| M07 | `transactFinal` | ticket/HMAC/digest 不符 | `ADMISSION_REQUIRED` | Z_all |
| M08 | `transactFinal` | 0 条 audit | `ADMISSION_REQUIRED` | Z_all |
| M09 | `transactFinal` | 2 条 audit | `ADMISSION_REQUIRED` | Z_all |
| M10 | `transactFinal` | audit 不在 refs / ID 不符 | `ADMISSION_REQUIRED` | Z_all |
| M11 | `transactFinal` | audit 字段/target/createdAt 错 | `ADMISSION_REQUIRED` | Z_all |
| M12 | `transactFinal` | 未声明写 | `ADMISSION_REQUIRED` | Z_all |
| M13 | `transactFinal` | runtime 写 domain/proof/fence/marker/plan | `ADMISSION_REQUIRED` | Z_all |
| M14 | `transactFinal` | proof/fence/marker/plan 无效 | `PROOF_REQUIRED`/`HALTED`/`FENCE_EXPIRED` | Z_all |
| M15 | `transactFinal` | create-only 冲突 | `CONFLICT` | Z_all |
| M16 | `transactFinal` | refs >90 | 400 容量错误 | Z_all |
| M17 | `transactFinal` | build 抛错 | 原错误 | Z_all |
| M18 | `transact` | refs 含 H4-c / build 返回 H4-c 未声明写 | `ADMISSION_REQUIRED`；build 前拒绝或未声明写拒绝 | Z_all |
| M19 | `transact` | 非 H4-c | 成功/旧审计行为不变 | — |
| M20 | `change` | H4-c name | `ADMISSION_REQUIRED`；build 不被调用 | Z_all |
| M21 | `change` | 非 H4-c | 成功/行为不变 | — |
| M22 | `#persist` | 外部调用 | 无 public 入口/`TypeError` | 无写 |
| M23 | `seed` | H4-c 非空 | `ADMISSION_REQUIRED` | Z_all |
| M24 | `seed` | H4-c 空数组 | 成功；无记录 | — |
| M25 | `init` | 缺 H4-c 数组 | 仅内存 `[]`；无记录 | 无记录写 |
| M26 | `init` | 已有非空 H4-c | 原样保留；不写 | 无写 |
| M27 | `init` | H4-c 非数组/损坏 | `EVIDENCE_INVALID`；不修复 | Z_all |
| M28 | gate | verify 修改入参/读环境/读时钟 | 断言失败 | — |
| M29 | 集合门禁 | 无 Set 导出/冻结快照/谓词边界 | 通过 | — |
| M30 | 并发 | 两 `transactFinal` 同 head | 一胜；败者零写 | Z_all |

- M01–M30 的每条负向都按 §3.5 全库零写；M18/M20 另需证明 `build` 未被调用（计数器/抛错哨兵）。
- M29 另需证明 `Object.freeze(new Set()).add` 仍改变内容，故本模块不导出 Set。
- M22 以 `store.persist === undefined` 与静态扫描共同证明；`verification.test.mjs` 的 fixture 改造见 D10。

### 3.3g D4/D5 本轮明确裁定（已关闭；新增契约，不倒推旧设计）

| 项 | 裁定 | 验收 |
|---|---|---|
| D4a proof.status/legacyCount | `status` 唯一字符串 `"verified"`；`legacyCount` 安全非负整数且 `CoverageValid` 仅接受 0；含义=可信全量盘点后仍不满足当前 canonical schema/K3/链/anchor 的 evidence/head 记录数；盘点未完成/未知记录/非 0 → 不可运行 proof；counts/inventoryDigest 为 epoch 激活前快照，append 不每次全扫 | 缺失/类型错误/status 非法/非零 legacyCount → `EVIDENCE_CHAIN_PROOF_REQUIRED/409`，零写 |
| D4b audit ID（C1） | C1 helper 只返回业务写；验收用 test-only 显式 audit。`scopeKey=job._id`；首条 `action="h4c.evidence.genesis"`、非首 `"h4c.evidence.append"`；`revision=本次新 evidence.sequence`（非 jobRevision/domainHeadRevision/旧 sequence）；`targetList`=业务写 collection/id 排序、不含 audit、重复业务目标拒绝；`auditId="audit-h4c-v1:"+sha256(stable([orgId,scopeKey,action,targetList,revision])).slice(0,32)`；exact 7 字段；`createdAt` 同一可信 `now`；`target=targetList.join(", ")` | 见 §3.3h V06–V09；错误 → `ADMISSION_REQUIRED/409`，零写；C2/control 生产公式另卡，不替换/不阻断 C1 |
| D5 runtime operationAuthDigest | 显式 JSON `null`；final ticket 必须包含并签名此键，不可省略；缺失/undefined/空串/任意摘要 → `ADMISSION_REQUIRED/409`，零写；`proof/precheck/epoch/refsDigest/writesDigest` 保持；C1 工厂仅 runtime 白名单（`kind="runtime"` 且 `operation∈{"genesis","append"}`），control 默认拒绝，null 不绕控制授权 | 见 §3.3h V10–V13 |

- 上述三项是**本轮新增明确裁定**；不得写成旧设计早已明确，也不得把历史草稿值当批准。
- 保留 18/27 预算、私有 Set/`isH4cCollection`/冻结快照、已通过的健康/授权规则。
- 正负用例见 §3.3h；S1/S3/S5 门禁按裁定恢复。

### 3.3h D4/D5 正负验收矩阵（S1/S3/S5 必跑）

| ID | 项 | 用例 | 预期 |
|---|---|---|---|
| V01 | D4a 正 | `status="verified"`、`legacyCount=0`、snapshot counts/inventoryDigest 一致 | `CoverageValid` 通过 |
| V02 | D4a 负 | status 缺失/`"valid"`/`"empty"`/`"backfilled"`/非字符串 | `PROOF_REQUIRED`，零写 |
| V03 | D4a 负 | legacyCount 缺失/-1/1/1.5/`"0"`/超安全整数 | `PROOF_REQUIRED`，零写 |
| V04 | D4a 负 | 盘点未完成/未知记录/非 0 | 不可运行 proof；`PROOF_REQUIRED`，零写 |
| V05 | D4a 快照 | append 不复扫全库；proof 使用 epoch 激活前 counts/inventoryDigest | 通过且无全扫调用 |
| V06 | D4b 正 | 首条：scopeKey=job._id、action=genesis、revision=1、targetList 排序/不含 audit/无重复 | auditId 精确匹配；7 字段/createdAt/target 通过 |
| V07 | D4b 正 | 非首条：action=append、revision=新 sequence | auditId 精确匹配 |
| V08 | D4b 负 | scopeKey/action/revision（jobRevision/domainHeadRevision/旧 sequence）/targetList 未排序/含 audit/重复 | `ADMISSION_REQUIRED`，零写 |
| V09 | D4b 负 | audit 字段多/缺、createdAt≠now、target≠targetList.join | `ADMISSION_REQUIRED`，零写 |
| V10 | D5 正 | runtime genesis/append，ticket 含 `operationAuthDigest:null` 且签名覆盖该键 | 通过 |
| V11 | D5 负 | 键缺失/undefined/`""`/任意摘要 | `ADMISSION_REQUIRED`，零写 |
| V12 | D5 负 | control kind/operation（migration/recovery/monitor/k3-bootstrap）即使 null | `ADMISSION_REQUIRED`，零写 |
| V13 | D5 回归 | proof/precheck/epoch/refsDigest/writesDigest 不符 | `ADMISSION_REQUIRED`，零写 |

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

### 3.7 测试命令（显式非 HTTP 清单 + 加载前 guard）

**绝对禁止**再使用会启动 `listen` 的全量 glob（r1 原命令已删除，不再保留可执行形式）。该 glob 含 8 个 HTTP/loopback 文件，不属于 C1 验收。

**8 个明确不跑的 HTTP 文件**：

```text
tests/blacklist-http.test.mjs
tests/occupancy-http.test.mjs
tests/server.test.mjs
tests/server-face.test.mjs
tests/server-face-bounds.test.mjs
tests/server-files.test.mjs
tests/server-v2.test.mjs
tests/verification-http.test.mjs
```

**33 个非 HTTP 文件（显式清单；不要用 glob）**：

```text
tests/auto-fill.test.mjs
tests/blacklist.test.mjs
tests/blacklist-prepare-attempt.test.mjs
tests/cloud-store-point-read.test.mjs
tests/device-permissions.test.mjs
tests/face-binding.test.mjs
tests/face-biometric.test.mjs
tests/face-collections.test.mjs
tests/face-eligibility.test.mjs
tests/face-grant-d-matrix.test.mjs
tests/face-grant-eligibility.test.mjs
tests/face-h3a.test.mjs
tests/face-h4b.test.mjs
tests/face-h4c-evidence.test.mjs
tests/face-input-contract.test.mjs
tests/face-owner-claim-helpers.test.mjs
tests/face-purpose.test.mjs
tests/face-reference.test.mjs
tests/face-service-h1-regression.test.mjs
tests/face-service-layer.test.mjs
tests/face-service-mock.test.mjs
tests/files.test.mjs
tests/identity.test.mjs
tests/identity-config.test.mjs
tests/layout-batches.test.mjs
tests/occupancy.test.mjs
tests/org-v2.test.mjs
tests/property.test.mjs
tests/static-path.test.mjs
tests/store-deterministic-audit.test.mjs
tests/trailing-payload.test.mjs
tests/verification.test.mjs
tests/vr.test.mjs
```

**加载前 guard 要求**：

1. guard 文件放在工作树之外（如 `%TEMP%\c1-staged-guard\<random>\guard.cjs`），不提交；记录绝对路径与 sha256。
2. 通过 `NODE_OPTIONS="--require <绝对路径>\guard.cjs"`（或等价 `--import`）在**任何测试模块加载前**预加载；不得在测试文件内部才加载。
3. guard 必须 patch 并计数：`http.Server.prototype.listen`、`https.Server.prototype.listen`、`net.Server.prototype.listen`、`dgram.Socket.prototype.bind`、`net.connect`/`createConnection`、`tls.connect`、`http/https.request|get`、`globalThis.fetch`、`dns.lookup/resolve*`；patch 后调用 `module.syncBuiltinESMExports()`，并用 ESM 哨兵证明命名导入拿到被替换实现。
4. **失败关闭**：运行包装器先断言 `NODE_OPTIONS` 含 guard 且 guard sentinel 为真；guard 输出 `GUARD_ACTIVE` 与 counters；任一缺失、counters 非零（`listen_calls=0`、`network_attempts=0`、`provider_calls=0`）→ 该次 BLOCKED/FAIL，不得摘除 guard 重跑。
5. 33 文件运行中允许 `server.mjs` 被 import（如 `identity-config.test.mjs`），但必须证明 `listen_calls=0`；任何 `.listen` 命中即失败。
6. C1 定向同样带 guard：`node --test --test-isolation=none tests/face-h4c-evidence.test.mjs`。
7. 依赖不安装：`sharp` 是 `face-service-h1-regression.test.mjs` 的真实依赖；若本机缺依赖，该文件记 BLOCKED，不得 stub/跳过冒充通过；其余文件不受影响。

**7 个根文件（显式；无 listen）**：

```text
tests/cloud-bootstrap.test.cjs
tests/frontend.test.cjs
tests/layout.test.cjs
tests/phone-login.test.cjs
tests/public-houses.test.cjs
tests/wechat-modules.test.cjs
tests/wxml.test.cjs
```

- 命令：`node --test --test-isolation=none` + 上述显式文件；不得用根 glob 替代（虽然当前根 7 文件无 listen，仍按显式清单执行，避免未来新增）。
- 历史基线（5dff386）：33 非 HTTP 文件 521 项、根 7 文件 51 项；本卡不重跑，不冒充本次结果。
- Admin 全量 581/581（含 60 项 loopback）仅作历史对照，不作为 C1 验收；8 个 HTTP 文件归 C2/C3/HTTP 卡。

### 3.8 静态扫描（S6 必跑）

| 扫描 | 期望 |
|---|---|
| 生产树 `hasExistingEvidence` / `emptyProof` / `callerProof` | 0 命中 |
| K3 初始化/bootstrap/create-domain token | 0 命中（沿用 C1 既有 43 文件扫描并更新文件数） |
| marker 短 ID `k3-marker:v1:global` | 0 命中（完整 ID 除外说明条款） |
| H4-c 集合字面名 | 只出现于 `h4c-collections.mjs` 与必要引用；无第二套字面量 |
| 集合门禁导出面 | 无 `H4C_COLLECTION_SET`/任何 Set 导出；无 `add/remove/clear` API；`isH4cCollection` 为唯一成员判定 |
| H4-c 集合写入点 | 仅 `transactFinal` 的 gate 路径；`transact/change/persist/seed/init` 无 H4-c 记录写 |
| `server.mjs` / `routes.mjs` | 零 diff |
| 未授权集合/新索引/epoch 计数记录 | 0 |
| 敏感值 | 0 findings（仅计数，不输出匹配文本） |
| `git diff --stat` 允许文件 | 仅本阶段白名单；设计正文零 diff |

### 3.9 提交/复审/证据

- 证据文档：`docs/tasks/HK-AI-04-H4C-C1-STAGED-IMPLEMENTATION-EVIDENCE-2026-11-19.md`；S0 新建，之后仅追加本阶段小节，不改写历史小节。
- 每个阶段提交信息格式：`feat(face): h4c c1 <s1..s6> <一句话>`；证据提交可合并进该阶段提交。
- 每段结尾在证据中写：改动文件、diff 范围、命令/exit/计数、零写矩阵、refs/writes、未验证、下一段请求。
- 不自批；不合并；不宣称 C1/G1 通过；复审通过前不开始下一段。

## 4. S0：基线冻结、勘误审批与待裁清零（零代码）

**依赖**：无。

**允许文件**：仅证据文档新建；不修改任何代码/测试/设计。

**精确输入**：

- 本修订输入 SHA/父/tree、工作树/分支、`git status --porcelain`。
- 远端实际 ref：目标分支 = `d095a18…`，父设计分支 = `fcae246…`；前移/分叉即停。
- 设计文档 blob/sha256；`git diff --stat 5dff386..HEAD -- . ':(exclude)docs'` 为空。
- 勘误 E1/E2/E3 与 P9 的复审状态；**18/27 预算按本轮口径保留（可采纳）**；其余契约未批准前不得实施。
- 基线代码文件 hash：`git hash-object` 记录 `h4c-evidence.mjs`、`index.mjs`、`store.mjs`、C1 测试。
- 历史测试计数仅引用 5dff386 证据（33 文件 521 项、根 51 项、全量 581 项含 loopback），不重跑。

**实现范围**：无。

**测试范围**：无业务测试；可执行 `git status`、`git rev-parse`、`git ls-remote`、`git diff --stat`、`git hash-object` 并记录原始输出。

**refs/writes**：0/0。

**负向/并发/零写**：

- 远端目标分支 SHA 不同、父设计分支前移/分叉、工作区不干净、设计 blob 不匹配、`5dff386..HEAD` 出现非 docs 差异：任一命中即停止报告；不得 reset/merge/force 修复。
- 勘误未批准而提前按 18/27 实施：停止；不得把草案当批准。
- 不访问 Store，不产生数据写。

**停止点 Stop-0**：Codex 确认基线、复审勘误 E1/E2/E3 与 P9（或明确延后条件）、确认 D4a/D4b/D5 关闭回写与 D1–D10 处置；未通过不得进 S1。

## 5. S1：契约层（纯函数）

**依赖**：S0 通过；E1 18/27 保留；E2/E3/P9 至少给出可编码结论；**D4a 已关闭**（`status="verified"`/`legacyCount=0`/snapshot）。

**允许文件**：

- `admin-web/lib/h4c-collections.mjs`（新，纯常量）
- `admin-web/lib/face-service/h4c-evidence.mjs`
- `admin-web/lib/face-service/index.mjs`
- `admin-web/tests/face-h4c-evidence.test.mjs`
- 证据文档（追加 S1）

**精确输入**：

1. 常量：8 集合字面名（E2）、`EVIDENCE_CHAIN_FENCE_ID="evidence-chain-fence:v1:global"`、`EVIDENCE_CHAIN_K3_MARKER_ID="evidence-chain-k3-marker:v1:global"`、anchor 前缀、`MONITOR_HEALTH_WINDOW_MS=300000`、`CLOCK_SKEW_MS=30000`、`EVIDENCE_MAX_SEQUENCE=9`、`STILL_UNKNOWN_MAX_SEQUENCE=8`。
2. ID 公式：anchor、evidence、head、domain、fence、marker、**proof**、plan（含 §18.2 writer canonical）；admin_audit C1 test-only audit 使用 §3.3g 的精确公式（scopeKey=job._id、genesis/append、revision=新 sequence、targetList）。
3. schema 字段数组：6/20/9/7/6/7/12/18/24/39（§3.2）；`proof.status="verified"`、`legacyCount=0`（安全非负整数，仅接受 0）。
4. digest domain：audit/fence/monitor/ticket/plan/plan-status/recovery/k3-bootstrap/writer-runtime/k3-marker/maintenance-manifest；算法 HMAC-SHA256 v1，canonical JSON 规则。
5. 谓词：`FenceRecordValid/FenceStructValid/FenceHealthy/FenceExpired/FenceValid/FenceHeartbeatable`、`K3DomainExact/K3MarkerValid/CoverageValid/WriterPlanValid/PlanRecordValid/AdmissionValid`。
6. 错误码表（§3.4）。

**实现范围**：

- 只加纯函数/常量/validator/摘要/谓词；不改任何调用方，不改 Store，不写记录。
- `h4c-collections.mjs` 只含字面名、**模块私有 Set**、`isH4cCollection`、冻结 `H4C`/`H4C_COLLECTION_NAMES`；无 import、无副作用；**不导出 Set**；`store.mjs` 与 `h4c-evidence.mjs` 必须从它取名字/谓词。
- 保留现有 26 个 C1 导出及其行为；index 只增不删；仍无任何 initialization/bootstrap/create-domain 入口。
- 所有 validator 必须 exact（多/缺/类型错都拒绝）；`proof.status` 仅 `"verified"`、`legacyCount` 安全非负整数且仅接受 0；所有摘要必须可从持久字段重建（不依赖内存 plan 对象）。
- `CoverageValid` 只接受 `legacyCount=0`；`counts/inventoryDigest` 取 epoch 激活前快照，append 不触发全库扫描；盘点未完成/未知记录 → 不可运行 proof。
- `PlanRecordValid` 必须实现 §17.2 + §18.2/§18.7：writer canonical ID、空值表、initialStatusTicket、statusTicket、consumed 按 planKind、runtimeTicket 验签。
- `WriterPlanValid` 只接受 consumed+runtimeTicket+`proof.writerPlanId`；active 不放行。
- 健康谓词严格区分 `FenceHealthy`（业务写）与 `FenceHeartbeatable`（heartbeat）；不得混用。
- `createH4cGate` 可先落纯逻辑；S4 接 Store。

**测试范围**：

- 每个 schema 的正例/反例；多字段、缺字段、错类型、非 plain object。
- 集合字面名精确断言（8 个字面量 + `admin_audit`）；无第二套常量。
- 集合门禁（M29）：命名空间无 `H4C_COLLECTION_SET`；`H4C`/`H4C_COLLECTION_NAMES` 冻结；`push`/下标/属性赋值抛错；`isH4cCollection` 对 `admin_audit`/`__proto__`/`constructor`/空串/非字符串 false；对 8 字面量 true；`Object.freeze(new Set()).add` 仍生效（证明不能导出 Set）；替换 `Set.prototype.has` 后判定仍不变（捕获原型方法）。
- canonical ID 例：`e=1`→`we-1`、`e=7`→`we-7`、`e=10`→`we-10`；拒绝 `we-07`、`we-0`、`WE-7`、空串、非正整数。
- proof ID 公式/24 字段；anchor 6/head 9/fence 12/marker 18/plan 39 的 exact；`proof.status` 仅 `"verified"`、`legacyCount` 安全非负且仅 0；V01–V05 正负/快照用例。
- C1 test-only audit 按 §3.3g 精确公式：scopeKey=job._id、genesis/append、revision=新 sequence、targetList 排序去重不含 audit、7 字段/createdAt/target；V06–V09 正负用例；C2/control 公式不阻塞 C1。
- HMAC 向量：用测试 K3 key 对固定输入计算并断言；不得用生产 key。
- fence 谓词真值表：healthy / expired / halted / clock rollback / future heartbeat / window 超限。
- plan 各 planKind 空值表；consumed writer 缺/坏 runtimeTicket；migration/recovery consumed 带非 null runtimeTicket；active/revoked 带 runtimeTicket；revoke 的 targetProofId 非 null。
- 纯函数不修改输入（structuredClone + deepEqual）。

**refs/writes**：0/0。

**负向/并发/零写**：无 Store 写；负向即上表拒绝用例。并发不适用。

**停止点 Stop-1**：Codex 审 schema/ID/集合名/谓词/签名公式与 E1/E2/§18.2/§18.7 一致，并确认 D4a/D4b 回写与 V01–V09 正负用例；确认没有生产调用点、没有 Store 改动；未通过不得进 S2。

## 6. S2：链层（18 refs、anchor、1..9、完整链）

**依赖**：S1 通过；E1 18/27 已按口径保留；E2 集合名可编码。

**允许文件**：

- `admin-web/lib/h4c-collections.mjs`
- `admin-web/lib/face-service/h4c-evidence.mjs`
- `admin-web/lib/face-service/index.mjs`
- `admin-web/tests/face-h4c-evidence.test.mjs`
- 证据文档（追加 S2）

**精确输入**：

- C1 refs 组成（§3.3）：domain head/version 2 + **proof 1** + audit 1 + fence 1 + marker 1 + writerPlan 1 + anchor 1 + head 1 + E1..9 9 = **18**。
- anchor：6 字段、ID 公式、首条 create-only、`firstEvidenceId=E1`。
- evidence：20 字段、`evidenceId(orgId,jobId,seq)`；head：9 字段、`lastSequence∈0..9`。
- proof：`proofId` 由 precheck/确定性公式提供；`writerPlanId=planId(writeEpoch)`；`auditId` 由调用方/测试提供。
- 链规则：`EmptyProof`（head=null/anchor=null/E1..9=null）；`ChainProof`（anchor valid、head valid、1..N canonical、previous 正确、N+1..9 null）；N=9 再 append → `EVIDENCE_INVALID`。
- 删除 `hasExistingEvidence`；测试/production 静态扫描 0 命中。
- 现有 `expectedHead` CAS 语义保留；首条不再依赖调用方布尔。

**实现范围**：

- 重写 `evidenceAppendRefs`（§3.3a）：返回 exact **18** refs（去重、稳定顺序）；包含 proof、admin_audit、fence、marker、writerPlan、anchor、head、E1..9、domain2；不访问 Store。
- 重写 `appendEvidenceWrites`：只返回 3/2 条业务写；事务内重读 head；首条要求 anchor/head/E1..9 全空；非首条要求 anchor/head/1..N 完整、N+1..9 空；previous 全字段复核（schema/ID/org/job/seq/observedAt/K3/HMAC）。
- 不写 domain；不 adopt/重编号/删除孤儿；任一失败在返回写之前抛错。
- 首条 anchor + E + head 原子；append E + head 原子。
- 错误码按 §3.4：孤儿/断链/anchor 不配 → `EVIDENCE_CHAIN_BROKEN`；CAS → `EVIDENCE_HEAD_CONFLICT`；seq 预占 → `CONFLICT`（按设计 §5.5/§11 统一）。
- proof/fence/marker/plan 的完整 CoverageValid 校验在 S5 接入；S2 只保证 refs 声明与链/anchor。

**测试范围**：

- refs 精确数量/集合/去重；逐个断言 18 个 ref；特别断言 `proof1` 存在。
- 首条成功只写 anchor+E1+head；append 只写 E+head。
- head=null + E2..9 任一存在 → BROKEN；E1 存在 → BROKEN；anchor 存在/head null → BROKEN；head seq2 但 E1 缺 → BROKEN；anchor 字段/ID/firstEvidence 错 → BROKEN。
- 完整链 1..N 正例；N+1..9 非空 → BROKEN；N=9 再 append → INVALID；`still_unknown` 第 8 条后 E9 仍 null。
- previous 的 schema/ID/org/job/seq/observedAt/K3/HMAC 任一损坏 → BROKEN；`observedAt` 递减/越界 → STALE（相等是否允许按已冻结 Q15，若未冻结列待裁）。
- `expectedHead` 过期 → HEAD_CONFLICT；head 被删除仍带 expectedHead → BROKEN。
- **负向：17 refs/缺 proof ref 必须被拒绝**（`ADMISSION_REQUIRED`/`PROOF_REQUIRED`），不得静默通过。
- 负向全库零写（§3.5）；无 `hasExistingEvidence` token。
- 并发：两首条、两 append、anchor 成功但 E/head 失败。

**refs/writes**：**18** / 3（首条）或 2（非首条）；0 domain 写；唯一 audit 不在 helper。

**负向/并发/零写**：按 §3.5/§3.6；重点 F03/F04/F05/F06。

**停止点 Stop-2**：Codex 审 refs **18** 组成（含 proof1）、anchor/1..9/完整链、无布尔、零写证据、缺 proof 拒绝用例；未通过不得进 S3。

## 7. S3：授权层（precheck、final ticket、唯一 audit）

**依赖**：S2 通过；**D4b/D5 已关闭**（C1 audit 精确公式；runtime `operationAuthDigest=null` + ticket 签名该键 + runtime 白名单）；§3.3a API 已审。

**允许文件**：

- `admin-web/lib/h4c-collections.mjs`
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

- admin_audit：C1 验收用 test-only 显式 audit，但 ID 必须按 §3.3g 精确公式（scopeKey=job._id；首条 action `"h4c.evidence.genesis"`/非首 `"h4c.evidence.append"`；revision=新 evidence.sequence；targetList 排序、不含 audit、重复业务目标拒绝）；exact 7 字段；`createdAt` 同一可信 `now`；`target=targetList.join(", ")`；C2/control 生产公式另卡，不阻塞 C1。
- audit 必须作为 finalWriteSet 的一部分在签票前物化；Store explicit 模式不得再追加第二个 audit。
- `operationAuthDigest` runtime **显式 JSON null**；final ticket 必须包含并签名该键，不可省略；缺失/undefined/空串/任意摘要 → `ADMISSION_REQUIRED`；`proof/precheck/epoch/refsDigest/writesDigest` 保持。
- C1 工厂仅接受 `kind="runtime"` 且 `operation∈{"genesis","append"}`；control kind/operation 默认拒绝，null 不绕控制授权。

**实现范围**：

- 两阶段：precheck（无 digest，fail-fast）→ final ticket（finalWriteSet 确定后 mint）。
- 提供 finalWriteSet 构造/验签 helper；C1 helper 仍只返回业务写，audit 由调用方/测试显式传入。
- 无 ticket/字段不一致/digest 不一致 → `EVIDENCE_CHAIN_ADMISSION_REQUIRED`；proof 失效 → `PROOF_REQUIRED`，两者不混。
- 不提前签票；不在 ticket 里包含自身；不在终检后追加写。
- 0 新增 refs；ticket 字节不落库（除非作为 plan 字段的既有设计）。

**测试范围**：

- precheck 各字段错 → ADMISSION；final ticket 对 refs/writes 的字节级绑定。
- `refsDigest`/`writesDigest` 篡改、audit 字段/字节篡改、audit ID 错、targetList 顺序错 → ADMISSION。
- finalWriteSet 缺 audit、双 audit、audit 不在 refs、Store 试图自动追加 audit → ADMISSION/回滚。
- C1 audit 按 §3.3g 精确公式做 V06–V09 正负用例；C2/control 公式不阻塞 C1。
- 用 fixed test K3 key 的 HMAC 向量；runtime ticket 含 `operationAuthDigest:null` 且签名覆盖该键（V10）；缺失/undefined/空串/任意摘要/control kind 或 operation（V11–V12）；proof/precheck/epoch/refsDigest/writesDigest 不符（V13）。
- 只有业务写、没有 ticket 的旧路径 → ADMISSION；ticket 正确但 chain 失败 → 链错误优先，零写。
- 零写协议 + 并发：同 ticket/同 head 一胜。

**refs/writes**：**18** / 3\|2；ticket 0 新增；事务总写 4/3（含 audit），helper 业务写 3/2。

**停止点 Stop-3**：Codex 审 D4b/D5 回写（V06–V13）、ticket 公式/字节绑定/唯一 audit/explicit 边界、runtime 白名单；确认 no double audit；未通过不得进 S4。

## 8. S4：Store 全路径门禁（8 集合 + admin_audit、explicit、≤90）

**依赖**：S3 通过；**E2/E3 批准 + P9 集合门禁不可变性批准**；D10（persist 私有影响）有明确处置。

**允许文件**：

- `admin-web/lib/store.mjs`
- `admin-web/lib/h4c-collections.mjs`
- `admin-web/lib/face-service/h4c-evidence.mjs`
- `admin-web/lib/face-service/index.mjs`
- `admin-web/tests/face-h4c-evidence.test.mjs`
- `admin-web/tests/store-deterministic-audit.test.mjs`（**仅当** additive gate 改动使其需要补断言；不得弱化既有断言）
- `admin-web/tests/verification.test.mjs`（**仅当** D10 选择“改 fixture”时；只替换 `store.persist` 直调，不改 identity 断言）
- 证据文档（追加 S4）

**精确输入**：

- 8 集合字面名（E2）+ `admin_audit`；exact/create-only 集合表（§3.1）；head 可更新；fence 可更新；plan 仅 status 精确更新。
- `transactFinal`：H4-c explicit 入口；校验 final ticket + 唯一 audit；gate 重算 digest；读 fence 后、构造 finalWriteSet 前判 `FenceValid(now)`，写阶段用 `state[fence]` 复查。
- `transact` 旧路径：refs 含 8 集合任一 → `ADMISSION_REQUIRED`，不 build/不写；非 H4-c 行为不变。
- `change` 对 8 集合任一拒绝；`#persist` 私有；`seed` 非空拒绝；`init` 只补空数组。
- 90 refs 上限；去重；未声明写拒绝；create-only 拒绝重复 `_id`；exact 写不注入 `updatedAt`。
- `createH4cGate` + `h4cGate` 构造注入（§3.3b）；`now` 由调用方显式传入；gate 不读环境/不调用 `Date.now()`。
- LocalStore 与 CloudStore 语义一致；Cloud fake 事务失败整批回滚。

**实现范围**：

- 仅改 Store + gate 接线 + 常量模块；不改 `server.mjs`/`routes.mjs`；不改非 H4-c 集合语义。
- gate 对旧 writer（无 ticket）持续拒绝；对 `transact/change/persist/seed/init` 全路径拒绝 H4-c 记录写。
- explicit 模式下 Store 只写 finalWriteSet；不自动 `auditRecord`；不改 `_id/createdAt/target`。
- 任何 gate 失败整事务回滚，不持久化 LocalStore 文件。
- 无 gate 时 H4-c 写 fail closed；`init/seed` 不写记录、不需要 gate。

**测试范围**：

- 按 §3.3f **M01–M30 全路径矩阵**逐条跑（LocalStore 与 CloudStore 各一遍）；每条负向全库零写。
- 集合门禁不可变性 M29：命名空间无 `H4C_COLLECTION_SET`；`H4C`/`H4C_COLLECTION_NAMES` 冻结；`push`/下标/属性赋值抛错；`isH4cCollection` 边界（`admin_audit`/`__proto__`/`constructor`/空串/非字符串）；
- gate 冻结/不暴露 config/key；`verify` 不修改入参、不读环境/时钟（M28）。
- LocalStore/CloudStore 各路径正/负：`transactFinal`/`transact`/`change`/`#persist`/`seed`/`init`。
- 8 集合 exact 字段；evidence/domain/anchor/audit proof/marker/plan create-only；head CAS 可更新；fence 可更新。
- H4-c 经 `transact`/`change` → 拒绝且 build 不被调用；`#persist` 外部不可调；`seed` 非空 → 拒绝；`init` 非空不补记录。
- 90/91 refs；未声明写；重复 `_id`；exact 字段多/缺；explicit audit 7 字段；无双审计；旧 writer ADMISSION。
- 每个负向全库零写 + LocalStore 文件 hash 不变 + Cloud fake 回滚。
- 并发：同 anchor/plan `_id` create-only 一胜；同 head 两 append 一胜。
- `store-deterministic-audit.test.mjs` 回归（若改）；`verification.test.mjs` fixture 改造后回归（若改）。

**refs/writes**：不改变任何预算；gate 0 新增 refs；≤90；C1 18 / C2 27 的 shape 校验。

**停止点 Stop-4**：Codex 审 Store diff、gate 放置点、构造注入、explicit 模式、M01–M30 全路径、私有 Set/谓词/冻结快照、D10 处置、非 H4-c 零回归；未通过不得进 S5。

## 9. S5：运行时覆盖（K3/marker/proof/writer plan/fence）

**依赖**：S1/S2/S4 通过；E2/E3/P9 批准；D3 清零；**D4a 已关闭**（`status="verified"`/`legacyCount=0`/snapshot）。

**允许文件**：

- `admin-web/lib/h4c-collections.mjs`
- `admin-web/lib/face-service/h4c-evidence.mjs`
- `admin-web/lib/face-service/index.mjs`
- `admin-web/tests/face-h4c-evidence.test.mjs`
- 证据文档（追加 S5）

**精确输入**：

- audit proof 24 字段；marker 18；fence 12；plan 39；`CoverageValid/K3MarkerValid/WriterPlanValid/FenceValid/FenceHeartbeatable`（§17.1/§17.3/§18.7）；`status="verified"`、`legacyCount=0`、counts/inventoryDigest 为 epoch 激活前快照，append 不全扫（§3.3g）。
- 运行时顺序：config → K3 domain → marker → proof → writer plan → fence/health → precheck → anchor/head/1..9 → finalWriteSet/ticket → gate → 写。
- `WriterPlanValid`：consumed + `statusTargetProofId=proof._id` + `proof.writerPlanId=plan._id` + runtimeTicket 验签 + `writerEpoch=proof.writeEpoch` + marker/key 绑定；**active 不放行**；运行时不要求 `now∈window`。
- 健康：`FenceValid=FenceHealthy` 只给业务写；`FenceHeartbeatable` 只给 heartbeat；`FENCE_EXPIRED` 与 `HALTED` 分离；时钟回拨不得 heartbeat。
- 旧 W0 保持 consumed、旧 proof 非当前 → 无运行授权；不得改写旧记录。

**实现范围**：

- 实现只读覆盖校验并接入 append 前置；不实现 recovery/rotate/monitor/k3-bootstrap/plan-issue 的执行事务。
- K3 domain 仍只读；marker/proof/fence/plan 缺失/损坏/绑定错一律失败关闭。
- 错误码按 §3.4，不降级到 anchor/9 IDs；不自动修复。
- 无新 refs；无新集合/索引。
- C1 的 proof ref 18 必须在此被实际使用；若只声明不使用，S5 不通过。

**测试范围**：

- marker 18 字段/完整 ID/短 ID/HMAC/K3 绑定；proof 24 字段/`k3MarkerDigest`/`writerPlanId`。
- `proof.status="verified"`、`legacyCount=0` 正例（V01）；status 非 `"verified"`/缺失/类型错，legacyCount 非 0/负数/非安全整数，盘点未完成/未知记录 → `PROOF_REQUIRED`（V02–V04）；append 不复扫全库、使用 snapshot（V05）。
- proof/marker/domain/epoch/policy/writerSet/collections 任一不符 → PROOF/DOMAIN。
- writer plan：active-only、consumed 缺/坏 runtimeTicket、runtimeTicket 字段不符、旧 W0、`statusTargetProofId` 不符 → PROOF/PLAN_INVALID；零写。
- fence：halted/缺失/epoch/digest/健康过期/时钟回拨/未来心跳 → HALTED/FENCE_EXPIRED；业务写零写。
- 错误优先级：K3 无效但 proof 看似有效 → DOMAIN 优先；proof 缺失但 chain 也坏 → PROOF 优先。
- 运行时只读：断言不写 marker/proof/fence/plan；旧记录字节不变。
- 覆盖 N97–N100、N104、N107–N111、N113–N132 中运行时行（§11）；F22/F25–F28/F31/F33/F34/F37/F38/F40。

**refs/writes**：**18** / 0（只读验证；genesis/append 写仍归 S2/S3）。

**停止点 Stop-5**：Codex 审 D4a 回写与 V01–V05、运行时判定顺序、planKind consumed、旧 W0、健康分离、只读性、proof ref 实际使用；未通过不得进 S6。

## 10. S6：验收（矩阵、并发、零写、静态、33+7 显式回归）

**依赖**：S1–S5 全部 Stop 通过。

**允许文件**：

- `admin-web/tests/face-h4c-evidence.test.mjs`（仅补缺失断言；不得新增生产代码）
- 证据文档（追加 S6）
- 若发现生产缺陷：**停止 S6**，回到拥有该代码的阶段追加修复提交并重走该段 Stop；不得在 S6 修生产代码。

**精确输入**：

- §11 的 F/N 归属表；§3.5/§3.6 协议；§3.7 显式 33+7 清单与 guard；§3.8 扫描；§3.3 预算（C1 18/C2 27）。
- 历史基线：33 非 HTTP 521 项、根 51 项、全量 581 项（5dff386）仅作对照，不冒充本次结果。

**实现范围**：无生产实现；只补测试断言与证据。

**测试范围**：

- C1 定向全绿；带 guard 0/0/0。
- 33 个非 HTTP 文件显式运行全绿；7 个根文件显式运行全绿；**不运行 8 个 HTTP 文件**；guard 必须加载前生效且 `listen_calls=0`。
- §3.3f **M01–M30** 全绿（LocalStore + CloudStore），含私有 Set/谓词/冻结快照、transactFinal/transact/change/#persist/seed/init 全路径。
- §3.3h **V01–V13** 全绿：D4a status/legacy/snapshot、D4b audit 精确公式、D5 runtime null/白名单。
- 并发对 10 轮全胜；每轮记录。
- 全部 F/N C1 行逐项 PASS/FAIL/未测；不允许“部分通过”概括。
- 静态扫描 §3.8 全 0。
- 预算静态核算：C1 **18**/3\|2；C2 27；所有行 ≤90；无未声明写；缺 proof ref 负向用例通过。
- `git diff --stat` 仅白名单；设计正文零 diff；`server.mjs`/`routes.mjs` 零 diff；无 C2/C3 代码。

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
| **F41** | **C1 只声明 17 refs/缺 proof ref** | **S2/S4** | **ADMISSION_REQUIRED/PROOF_REQUIRED** | **Z_all** |
| **F42** | **集合门禁导出可变 Set / 成员判定可被 add 绕过** | **S1/S4** | **断言失败/拒绝** | **N/A** |
| **F43** | **proof.status/legacyCount 缺失或非法** | **S1/S5** | **PROOF_REQUIRED** | **Z_all** |
| **F44** | **audit ID 前缀/长度/scopeKey/targetList 错（C1 test-only）** | **S3/S4** | **ADMISSION_REQUIRED** | **Z_all** |
| **F45** | **runtime ticket 缺/错 operationAuthDigest（D5 未裁定）** | **S3** | **ADMISSION_REQUIRED；无正向验收** | **Z_all** |

### 11.2 N 矩阵归属（不重开设计；只划 C1 与另卡）

- **C1 本卡覆盖**：N01–N20、N25–N38（N21–N24 迁移/legacy 行归另卡）、N42–N44、N46–N47、N49–N51（domain 写拒绝）、N53–N54、N60–N63（仅 runtime 读侧）、N64–N66（C1 自身预算；当前以 N131 的 18/27 为准）、N77–N78、N81、N85–N86（只读校验）、N88–N90、N92–N93（历史值不重开；当前预算按 N131）、N95（C1 行）、N97–N100（只读校验）、N104、N107–N111、N113–N117（runtime 读侧）、N118–N126（校验/读侧）、N129–N132、N133–N135（Store create-only/validator）、N138–N142（validator/Store 语义）。
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
| Stop-0 | S0 | 基线报告、勘误 E1–E3、P9、D1–D10、D4a/D4b/D5 关闭回写 | SHA/父/远端/设计 blob/代码零 diff 一致；18/27 保留；集合名/Store 接口/门禁不可变；D4a/D4b/D5 已按本轮裁定关闭 | 停止报告；不改写历史；不猜合同 |
| Stop-1 | S1 | diff + 测试 + 证据 | schema/ID/集合名/谓词/签名与 E1/E2/§18.2/§18.7 一致；D4a/D4b 回写与 V01–V09；0 Store 改动；0 写 | 同阶段追加修复 |
| Stop-2 | S2 | diff + refs/链测试 + 零写 | **18 refs**（含 proof1）；anchor/1..9/完整链；无布尔；缺 proof 负向拒绝；零写 | 同阶段追加修复 |
| Stop-3 | S3 | diff + ticket/audit 测试 | D4b/D5 回写与 V06–V13；finalWriteSet 字节绑定；唯一 audit；explicit；0 新增 refs | 同阶段追加修复 |
| Stop-4 | S4 | Store diff + M01–M30 + 全路径测试 | 8 集合+admin_audit/全路径/explicit/≤90/无双审计；gate 注入；私有 Set/谓词/冻结快照；D10 处置；非 H4-c 零回归 | 同阶段追加修复 |
| Stop-5 | S5 | diff + 运行时谓词测试 | D4a 回写与 V01–V05；K3/marker/proof/writer plan/fence/健康/错误顺序正确；只读；旧 W0 无授权；proof ref 实际使用 | 同阶段追加修复 |
| Stop-6 | S6 | 全量证据 | 33+7 全绿 + F/N 逐项 + 10 轮并发 + 静态 0 + 预算 18/27 + 白名单 + guard 0；8 HTTP 未跑单列 | 退回对应阶段；不得 S6 直接修 |

交付回报模板（每个 Stop 必填）：

```text
阶段：S0..S6
分支/提交（完整 SHA）/父：
改动文件（完整清单）：
命令 / exit / 计数（C1 定向、33 非 HTTP、7 根、guard）：
refs/writes 实测（helper 业务写 / 事务总写；C1 18 / C2 27）：
F/N 逐项（PASS/FAIL/未测）：
全库零写证据（快照方法、集合级比较、文件 hash）：
未验证/未测（必须单列，不得并入通过；8 HTTP 文件明确未跑）：
远端状态（push 前 ls-remote、push 后远端 SHA）：
请求复审项：
```

## 13. 待裁项（实施前必须清零或明确延后条件）

| ID | 缺失/歧义 | 证据 | 阻断阶段 | 建议/需要 Codex 裁定 |
|---|---|---|---|---|
| D1 | 云派单/审查 `DISPATCH.md`/`REVIEW.md` 本机未取得 | 页首检查路径；仓库无副本 | S0 | 提供可读副本，或确认本轮只按用户明确要求修订、不声称逐项闭合 |
| D2 | C1 17 refs 缺 audit proof；`CoverageValid` 无法成立 | 设计 §17.5 `:1283`、§16.5 `:901`、§17.5 `:1298` | S2 | **勘误 E1：C1 18、C2 27；writes 不变；18/27 按本轮口径保留（可采纳）** |
| D3 | 集合字面名缺失；8 集合中 “audit” 所指 | 设计 §15.4 `:740`、§16.5 `:912`、§17.5 `:1297` | S1/S4 | **勘误 E2：8 个字面名 + admin_audit 通用边界；待复审** |
| D4a | proof.status/legacyCount | 本轮明确裁定：`"verified"` + 安全非负且仅 0 + snapshot；§3.3g/§3.3h V01–V05 | **CLOSED（本轮裁定）** | 已关闭；S1/S5 按 V01–V05 验收 |
| D4b | C1 audit action/revision/scopeKey/targetList | 本轮明确裁定：scopeKey=job._id；genesis/append；revision=新 sequence；targetList 排序去重；§3.3g/§3.3h V06–V09 | **CLOSED（C1）** | 已关闭；C2/control 生产公式另卡，不阻塞 C1 |
| D5 | runtime operationAuthDigest | 本轮明确裁定：显式 null；ticket 必须签名该键；V10–V13；runtime 白名单 | **CLOSED（本轮裁定）** | 已关闭；control 默认拒绝，null 不绕授权 |
| D6 | C1 API 形状未定义 | 原卡 §3.3；现 `h4c-evidence.mjs:322` | — | **本卡 §3.3a 已冻结**（`evidenceAppendRefs`/`appendEvidenceWrites` 参数、proofId/auditId 来源）；随卡审批 |
| D7 | Store 接口/依赖注入/集合门禁未定义 | 设计 §4.4 `:166`、§4.13 `:322` | S4 | **勘误 E3 + 本卡 §3.3b–§3.3f：私有 Set + `isH4cCollection` + 冻结枚举快照（不导出 Set）、`createH4cGate`、构造注入、`transactFinal`、`#persist` 私有、全路径错误契约与 M01–M30 矩阵；待复审** |
| D8 | N01–N142 与“工具另立卡”的测试归属 | 设计 §14 第 6/7 条 `:600-601` | S6 | 确认 §11.2 划界；若要求 C1 全覆盖，明确合成记录边界 |
| D9 | 设计页首自述“待 Codex 复审”与“已批准”口径不一致；实施分支名/起点未派单 | 设计页首 `:3`；本卡 §1.4 | S0 | 明确批准文/批准 SHA 与实施分支；本卡不代替批准 |
| D10 | `#persist` 私有会破坏 `verification.test.mjs:381` 的直调 | `admin-web/tests/verification.test.mjs:381` | S4 | 建议 S4 改该测试为 `init()` 前写 `demo-data.json`（仅 fixture）；或批准其他等价方案 |
| D11 | 真实 Cloud 并发事务未验证（LocalStore 队列/Cloud fake 串行） | 本卡 §3.6 | C3 | 不在 C1 关闭；证据标注未验证 |

## 14. 明确未做/未验证

- 未实现任何 C1 代码；未修改 `h4c-evidence.mjs`/`index.mjs`/`store.mjs`/测试/设计正文。
- 未运行任何测试；33 文件 521 项、根 51 项、全量 581 项均为 5dff386 历史证据，不是本卡结果。
- 未安装依赖；未访问真实 Cloud/K3/设备/Provider/支付/业务网络；未注册 HTTP/UI；未部署。
- 未读 `/workspace/artifacts/FIVE-FOLLOWUPS-REVIEW-2026-11-19/DISPATCH.md` 与 `REVIEW.md`（本机未取得）；不声称与云端派单/审查逐项一致。
- 8 个 HTTP/loopback 测试文件明确不跑；C1 验收不含它们；其 60 项 loopback 历史结果不是 C1 证据。
- 未验证真实 Cloud 并发事务；归 C3。
- C1 18/C2 27 保留；**D4a/D4b/D5 已按本轮裁定关闭**；E2/E3/P9 仍待 Codex 复审；D8/D9/D10 未决；不得把未批项当批准。
- 未验证集合门禁实现（仅文档方案）；不得声称已证明不可变。
- D4a/D4b/D5 的裁定已回写，但未写代码/未运行测试；不得声称运行已验证。
- 本卡不自批、不宣称 C1/G1 通过、不授权合并/实施。

## 15. 本修订交付

- 分支：`docs/h4c-c1-staged-implementation-task`；父：`d095a1888a2efba7ac8bfea76dfe120a3a74bf08`。
- 文件范围：本卡修订 + 同步修订 `docs/tasks/HK-AI-04-H4C-C1-REFS-ERRATUM-2026-11-19.md`；不处理其他文件。
- 提交后由交付回报给出：完整 SHA、`git show --stat`、`git ls-remote` 远端 SHA、固定 SHA 文件 URL（卡与勘误各一）。
- 普通 push；不 amend/rebase/reset/squash/force/cherry-pick/merge；push 前若远端目标分支前移/分叉，停止报告。
- 交 Codex 独立复审：重点为 **D4a/D4b/D5 本轮裁定回写与 V01–V13**、勘误 E1 的 C1 18/C2 27、E2 的 8 集合字面名、E3 的 Store 接口/DI/不可变集合门禁（P9）、§3.3d–§3.3f 的签名/权限/错误/显式写集/M01–M30、§3.7 的 33+7 显式清单与 guard、D10 的 persist 影响。
- 复审前不开始 S1；不自批。
