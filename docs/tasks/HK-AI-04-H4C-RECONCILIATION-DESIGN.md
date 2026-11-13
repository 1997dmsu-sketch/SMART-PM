# HK-AI-04 H4-c UNKNOWN_RESULT 人工对账契约设计

设计提案，待 Codex 批准。**本轮只设计，不修改生产代码或测试，不注册 HTTP，不连接 Cloud/live、真实 Provider 或真实设备。**

- 服务层基线：`feat/hk-face-h4b-mock-cleanup` @ `1155b7ba65991d324fb8b22bb8f7dd87f49428f9`
- 任务卡：`547fee5`（`docs/tasks/HK-AI-04-H4C-RECONCILIATION-DESIGN-TASK-2026-11-13.md`）
- H4-b 终审：`HK-AI-04-H4B-APPROVAL-1155B7B-2026-11-13.md`（任务卡提交 `547fee5`）
- 分支：`docs/hk-face-h4c-reconciliation-design`
- 边界：H4-c 只冻结 `awaiting_result` 的人工对账入口；不实现 H4-d、HTTP 注册、真实 Provider、设备写或生产部署。

## 1. 结论与冻结边界

H4-c 冻结一个**人工、显式、幂等、终态收敛**的对账入口：

| decision | 业务结果 | 资源结果 | Provider |
|---|---|---|---|
| `confirmed_removed` | 复用 H4-b local finalize，job 最终 `succeeded` | 按 H4-b 的 candidate/guard CAS 释放 slot，必要时释放 owner claim | **0** |
| `confirmed_present` | job `terminal_failed` | grant 保持 `revoked`、`cleanupPending=true`；slot/claim 不释放 | **0** |
| `still_unknown` | job 保持 `awaiting_result` | 业务状态不变；仅追加确定性日志、证据和幂等记录 | **0** |

`awaiting_result` 不得被自动查询、定时器、重试或回调推动；离开该状态的唯一路径是持 `device.operation.reconcile` 的人工请求。H4-c 不新增自动 query、轮询、Provider 调用或设备连接。

## 2. 当前实现事实与复用点

| 事实 | 代码/证据 | 对 H4-c 的约束 |
|---|---|---|
| revoke job 使用独立 validator，字段集合精确固定 | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 35–40、84–120 行 | 不新增 job 顶层字段；H4-c 不复制一套 revoke 状态机 |
| `candidateDisposition` 固定 pending/effective/suspended/expired 阻断、revoked+cleanupPending 阻断、revoked+false 清除 | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 176–184 行 | `confirmed_removed` 必须复用同一 candidate 语义 |
| finalize 在事务内重验 grant/slot/claim/device/guard，guard 先读、candidate 后扫，再 CAS revision/epoch | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 340–437 行 | 不建立第二套 release 算法；不按 slotId 盲写 |
| finalize 事务 refs 为 `8+N`（job/grant/slot/claim/device/guard/log/N candidates/audit） | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 361–364 行；[H4-b 证据](HK-AI-04-H4B-EVIDENCE-2026-11-13.md) R31 | 82 candidates/90 refs 是冻结边界；83/91 必须失败关闭或进入 local-finalize |
| Provider 成功后的 local finalize 只做本地事务，最多 4 次，耗尽为 `LOCAL_FINALIZE_EXHAUSTED` | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 438–453、475–481 行 | `confirmed_removed` 只调用该本地路径，Provider 恒 0 |
| T1 60 秒租约、T2 复核、T3 回写、expire/requeue 的合法入口 | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 211–339、454–533 行 | 对账与这些入口按状态/CAS 线性化，不新增旁路 |
| K2 operation key：HMAC、domain head/version、requestDigest、严格重放 | [service.mjs](../../admin-web/lib/face-service/service.mjs) 第 117–151 行；[collections.mjs](../../admin-web/lib/face-service/collections.mjs) 第 220–309 行 | 复用同一 K2 机制，不写原始幂等键 |
| 确定性 audit 由 Store 写入，refs 去重后上限 90 | [store.mjs](../../admin-web/lib/store.mjs) 第 87–96、263–315、398–454 行 | H4-c 每次写必须声明 deterministic audit ref |
| 路由提案已存在但未注册 | [routes.mjs](../../admin-web/lib/face-service/routes.mjs) 第 54–59 行 | 未来路径只写提案，不注册 `server.mjs` |
| `device.operation.reconcile` 已在权限目录 | [org.mjs](../../admin-web/lib/org.mjs) 第 104 行 | 权限名冻结，不新增别名 |
| 公开 job DTO 只返回最小字段 | [dto.mjs](../../admin-web/lib/face-service/dto.mjs) 第 253–263 行 | reconcile 响应不复制 job/evidence 原文 |

H4-b 的关键边界见 [H4-b 终审](https://github.com/1997dmsu-sketch/SMART-PM/blob/547fee5/docs/tasks/HK-AI-04-H4B-APPROVAL-1155B7B-2026-11-13.md) 与 [H4 设计终审](https://github.com/1997dmsu-sketch/SMART-PM/blob/547fee5/docs/tasks/HK-AI-04-H4-DESIGN-APPROVAL-1542A6C-2026-11-13.md)；H4 原始对账设计见 [H4 撤权/对账契约](https://github.com/1997dmsu-sketch/SMART-PM/blob/9fd088d/docs/tasks/HK-AI-04-H4-REVOKE-RECONCILE-DESIGN.md) Q04（其 `succeeded/terminal_failed` 目标由本卡的三种 decision 取代，证据与资源语义沿用）。

## 3. 权限与事务内复核

1. 权限固定为 `device.operation.reconcile`，不接受 `device.access.manage`、`device.audit.read` 或 `device.operation.retry` 代办。
2. 事务外先做 `#require` 快速失败；事务内必须重新读取并复核：
   - `organizations/<orgId>.status === "active"`；
   - `org_memberships/<actor.membershipId>` 的 `orgId/status/principalId|actorId` 与 actor 一致；
   - membership `permissions` 含 `device.operation.reconcile`；
   - actorType 只允许 `user`/`system`/`agent`，H4-c 人工入口实际只接受 `user`。
3. 跨组织与不存在同态：`store.get(..., orgId)` 返回 null，统一 `NOT_FOUND/404`，不泄露 job 是否存在。
4. `expectedRevision` 必须与事务内 `job.revision` 严格相等；否则 `REVISION_CONFLICT/409`，零写。

## 4. 输入 DTO（严格白名单）

请求体只允许以下字段；逐层未知字段、数组/对象类型漂移、隐式转换一律拒绝。

```json
{
  "jobId": "<1-128 opaque id>",
  "expectedRevision": 7,
  "decision": "confirmed_removed",
  "evidence": {
    "sourceType": "operator",
    "sourceCode": "OPERATOR_CONFIRMED_REMOVED",
    "observedAt": 1763000000000
  }
}
```

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `jobId` | 1–128，`[A-Za-z0-9][A-Za-z0-9._:-]{0,127}` | 不接受空白、控制字符、路径分隔符 |
| `expectedRevision` | 安全整数，1..`Number.MAX_SAFE_INTEGER` | 事务内 CAS 基准 |
| `decision` | 枚举三值 | 见 §5 |
| `evidence` | 精确对象，仅 3 字段 | 不接受 `digest`、`raw`、`response`、`payload`、`file` 等 |
| `evidence.sourceType` | `mock_provider` / `operator` | H4-c 拒绝 `device`、`provider_query`、`live` |
| `evidence.sourceCode` | 固定短码，≤32，见 §4.1 | 不接受自由文本 |
| `evidence.observedAt` | 安全整数毫秒，≥0 | 不晚于服务端 now，且不早于 job 进入 `awaiting_result` 的时间 |
| `Idempotency-Key` | 16–128，`[A-Za-z0-9._:-]` | 与 K2 `assertIdempotencyKey` 完全一致 |

### 4.1 sourceCode 与 decision 的绑定

| decision | 允许的 sourceType | 允许的 sourceCode |
|---|---|---|
| `confirmed_removed` | `mock_provider` / `operator` | `MOCK_REVOKE_ABSENT`、`MOCK_QUERY_ABSENT`、`OPERATOR_CONFIRMED_REMOVED` |
| `confirmed_present` | `mock_provider` / `operator` | `MOCK_REVOKE_PRESENT`、`MOCK_QUERY_PRESENT`、`OPERATOR_CONFIRMED_PRESENT` |
| `still_unknown` | `mock_provider` / `operator` | `MOCK_QUERY_UNKNOWN`、`OPERATOR_UNCERTAIN` |

sourceCode 与 decision 不匹配 → `EVIDENCE_INVALID/409`，零写。H4-c 只接受 `evidenceScope=simulated` 的合成证据；`device_verified` 或任何真实设备证据在 Mock 阶段失败关闭。

## 5. evidence 契约：独立集合、来源、短码、时间、不可逆摘要

### 5.1 存储选择：独立不可变集合

建议新增 **`device_operation_evidence`** 独立集合，每条证据不可变、create-only、确定性 ID：

| 理由 | 说明 |
|---|---|
| `still_unknown` 不能改 job | 该 decision 要求 job 保持 `awaiting_result`；把证据嵌入 job 会违反“状态不变”并污染 H4-b 精确 job 字段集合 |
| H4-b `validateResult` 是精确 5 字段 | 把 decision/evidence 塞进 `job.result` 会破坏 H4-b validator，或迫使 H4-b 放宽白名单 |
| 旧证据可独立校验 | 证据链、sequence、旧 schema 可以在不改 job 的情况下失败关闭 |
| refs 可控 | 新证据 1 条 + 可选上一条 head；confirmed_removed 的 finalize 仍是 H4-b `8+N` |
| 不嵌入 log | log 是事件流，不是不可变证据记录；把结构化证据塞进 log 会绕过字段校验 |

**不采用**“嵌入 job”或“嵌入 log”。若 Codex 要求减少集合，可退化为 job 内 `reconcileEvidence`，但必须同时修改 H4-b 精确 schema、`still_unknown` 零 job 写和旧证据校验，代价更高。

### 5.2 证据字段白名单

```text
_id, orgId, jobId, sequence, decision,
sourceType, sourceCode, observedAt,
digest, digestAlgorithm, digestVersion, digestDomain,
previousEvidenceId, evidenceScope, actorId, createdAt
```

| 字段 | 约束 |
|---|---|
| `_id` | `h4c-evidence-v1:<sha256([orgId, jobId, sequence]) 前 32 hex>`；同一 job/sequence 只能有一条 |
| `sequence` | 安全整数 1..9；同一 job 连续，1 为第一条；`still_unknown` 最多到 8，最终裁定可到 9 |
| `decision` | 三值枚举，与 sourceCode 绑定 |
| `sourceType/sourceCode` | 见 §4.1；短码固定 |
| `observedAt` | 安全整数；`job.createdAt ≤ observedAt ≤ now`；且 `observedAt ≥ job.result.finishedAt`（job 进入 awaiting_result 的时间） |
| `digest` | 64 位小写十六进制，服务端计算，见 §5.3；客户端不得提交 |
| `digestAlgorithm` | 固定 `HMAC-SHA256` |
| `digestVersion` | 固定 `1` |
| `digestDomain` | 固定 `KEYED_DIGEST/h4-reconcile-evidence` |
| `previousEvidenceId` | 前一条证据 ID；第一条为 `null`；链断裂 → `EVIDENCE_INVALID` |
| `evidenceScope` | 固定 `simulated` |
| `actorId` | 有界 actor ID，仅内部引用 |
| `createdAt` | 服务端安全整数时间戳 |

禁止入库：原始 Provider 请求/响应、异常 message/stack、序列号、IP/MAC、账号、姓名/手机号/地址/证件号、图片/字节/base64、objectKey、checksum、完整证书指纹、原始幂等键、K1/K2/K3 密钥。

### 5.3 摘要用途域、算法、版本与密钥来源

| 项目 | 冻结建议 |
|---|---|
| 用途域 | `KEYED_DIGEST/h4-reconcile-evidence`，域分离固定字符串 |
| 算法 | HMAC-SHA256，64 位小写十六进制 |
| 版本 | `digestVersion=1`；密钥版本 `H4_EVIDENCE_KEY_VERSION` 单独记录 |
| 密钥来源 | 新增独立 K3：`H4_EVIDENCE_HMAC_KEY_B64`（规范 Base64 的 32 字节）；**不复用 K1/K2** |
| 消息 | 稳定排序 JSON：`{domain, version, orgId, jobId, decision, sequence, sourceType, sourceCode, observedAt, evidenceScope, previousEvidenceId}` |
| 失败关闭 | K3 缺失/非法/版本不匹配 → `NOT_CONFIGURED/503`；不得回退 K1/K2，不得用无密钥 SHA-256 代替 |
| 换钥 | 旧证据保留 `digestVersion`；新版本未受控迁移前，新的对账失败关闭；H4-c 不做自动迁移 |

**用途说明**：该摘要证明“这条合成证据确实由当前组织、当前 job、当前 decision 和当前 sequence 产生”，并防止低熵短码被离线枚举/替换；它**不是**原始 Provider 响应的哈希。H4-c 不接收原始响应，因此不存储、不重算原始响应摘要。未来真实设备证据若需要绑定原始响应，必须在 H5/后续卡单独定义适配器可信摘要，不得在本卡放宽。

### 5.4 证据时间与陈旧规则

- `observedAt` 必须是安全整数；字符串 ISO 时间在 DTO 层拒绝（HTTP 层可不做隐式转换）。
- `observedAt < job.result.finishedAt` → `EVIDENCE_STALE/409`；
- `observedAt > now` → `EVIDENCE_STALE/409`（不设未来容忍窗）；
- `now - observedAt > 24h` → `EVIDENCE_STALE/409`（`EVIDENCE_MAX_AGE_MS=86_400_000`）；
- `still_unknown` 的 `observedAt` 必须严格大于上一条证据的 `observedAt`，否则 `EVIDENCE_STALE/409`；
- 旧 schema/缺 `digest`/缺 `sequence`/缺 `previousEvidenceId` 的旧证据：`EVIDENCE_INVALID/409`，禁止补写或猜测。

## 6. 三种 decision 的状态机与写集

状态迁移只发生在 `awaiting_result`：

| 当前 job | decision | 目标 job | grant | slot/claim | 关键写 |
|---|---|---|---|---|---|
| `awaiting_result` | `confirmed_removed` | `succeeded`（经 local finalize） | `cleanupPending=false` | 按 H4-b 释放/CAS | R1 intent + R2 H4-b finalize |
| `awaiting_result` | `confirmed_present` | `terminal_failed` | 保持 `revoked/cleanupPending=true` | 不释放 | job + evidence + log + op key + audit |
| `awaiting_result` | `still_unknown` | 保持 `awaiting_result` | 不变 | 不释放 | evidence + log + op key + audit |

### 6.1 `confirmed_removed`：两段式提交，保住 H4-b 82/90

H4-b finalize 的 `8+N` 在 N=82 时已经正好 90；如果同一个事务再加 evidence/op key/domain，会变成 91+，直接破坏 82/83 边界。因此 H4-c 明确采用两段：

**R1 — decision/intent（不释放资源）**

- refs（去重后 9–10 条）：
  `organizations/org`、`org_memberships/actor`、`device_operation_jobs/job`、
  `device_operation_evidence/evidence`、`device_operation_evidence/previous`（有则）、
  `operation_keys/op`、`operation_key_domains/head`、`operation_key_domains/version`、
  `device_operation_logs/log`、`admin_audit/audit`。
- writes：
  - job：`awaiting_result → retryable_failed`，`cleanupPhase:"finalize"`，`providerOutcome:"confirmed_removed"`，`finalizeAttempts:1`，`nextAttemptAt=now`，`result` 为标准 5 字段 `{attempt,outcome:"retryable_failed",errorKind:"LOCAL_FINALIZE",reasonCode:"RECONCILE_CONFIRMED_REMOVED",finishedAt}`；
  - evidence（新记录）；
  - 一条 deterministic reconcile log；
  - operation key（result 为指向 evidence/job 的稳定指针，见 §7）；
  - operation key domain writes（0–2，首次）；
  - audit（Store 写入）。
- **不写** grant/slot/claim/device；不调用 Provider。

**R2 — H4-b local finalize（复用原算法）**

- 调用现有 [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 475–481 行 `finalize(jobId)`，它只会走 `#finalize` 的本地事务，Provider 0。
- refs 与 H4-b 完全一致：`8+N`（job/grant/slot/claim/device/guard/success log/N candidates/audit）。
- writes 与 H4-b 完全一致：job `succeeded`、grant `cleanupPending=false`、slot 合法 released 墓碑、无 blocker 时 owner claim released + release guard CAS、success log、audit。
- N≤82 时 90 refs 内成功；N=83 时 H4-b 原有 `>90` 分支进入 local-finalize pending，**绝不半释放**。
- R1 在写前先做一次**只读** candidate 预扫；N≥83 直接 `CAPACITY_EXCEEDED/400`，零写（见 §8.2）。R1 之后 candidate 增长到 83 的竞态由 R2 的 H4-b `>90` 分支兜底。
- R1 写前还必须只读校验 `cleanupSnapshot`、grant、slot、claim、device、release guard 的精确 schema 与绑定；缺失/损坏直接 `CLEANUP_SNAPSHOT_REQUIRED`/`DEVICE_CLAIM_INVALID`，R1 零写。R2 仍按 H4-b 在事务内重验一次，防止 TOCTOU。

**失败/恢复语义**

- R1 成功、R2 失败（容量、guard phantom、store 暂时不可用）：job 已是 `retryable_failed`/finalize，H4-b `#localFinalizeFailure` 按 30/120/600 重试，最多 4 次；资源保持未释放，Provider 0。
- R2 成功：job `succeeded`，`cleanupPending=false`。
- R2 到达 4 次：`terminal_failed/LOCAL_FINALIZE_EXHAUSTED`；grant 保持 `revoked/cleanupPending=true`，slot/claim 不释放；不得自动重发 Provider。
- `finalizeAttempts` 从 1 起算：R1 的“人工确认删除”视为第 1 次本地 finalize 尝试；H4-b 允许 1..3 进入重试，第 4 次耗尽。该口径需 Codex 确认（见 §14 Q6）。

### 6.2 `confirmed_present`：终态、保留资源

单事务：

- job：`awaiting_result → terminal_failed`，`revision+1`，`result` 为 `{attempt,outcome:"terminal_failed",errorKind:"TERMINAL",reasonCode:"RECONCILE_CONFIRMED_PRESENT",finishedAt}`；`nextAttemptAt=null`，无 lease。
- grant：**不修改**，保持 `revoked`、`cleanupPending=true`、`cleanupJobId` 指向该 job。
- slot：不修改，保持 active 墓碑（job 仍为 `awaiting_result`，尚未发生成功的 local finalize）。
- claim/guard/device：不修改。
- 写：evidence、log、op key、op domain、audit；Provider 0。
- 后续：`terminal_failed` 是终态；`requeue` 只接受 `retryable_failed`，不会把本任务重新派发。H4-c **不允许**未来受控重新派发；若未来要重新清理，必须另开 H4-d 设计（新 cleanup generation/job，不复用本终态）。

### 6.3 `still_unknown`：状态不变，只追加事件

单事务：

- job：**零写**（revision 不变，state/result/cleanupPending 不变）。
- 写：evidence（sequence+1）、log、op key、op domain、audit；Provider 0。
- 证据链：`sequence = previous.sequence + 1`；`previousEvidenceId` 指向上一条；`still_unknown` 的 `sequence` 上限 8。
- `still_unknown` 不改变 `expectedRevision`（job revision 不变），但每次必须使用**新的** Idempotency-Key；同键仍按 §7 重放。
- 频控：相邻 `still_unknown` 的服务端 `now` 间隔至少 60 秒（`RECONCILE_STILL_UNKNOWN_MIN_INTERVAL_MS=60_000`），否则 `RECONCILE_THROTTLED/409`。
- 次数上限：同一 job 最多 8 次 `still_unknown`；第 9 次仍为 `still_unknown` → `RECONCILE_LIMIT/409`；最终 confirmed 裁定允许作为 sequence 9 提交。
- 频控/上限的原子性：同一 job 的下一 sequence 由 `previous.sequence+1` 决定，evidence `_id` 对 `(org,job,sequence)` 确定性；两个并发 `still_unknown` 会争同一 evidence ID，后提交者 `CONFLICT/409`，不会双写；客户端可用新键重试，重试时重新读取 head 并重新计算间隔/上限。

## 7. K2 operation key、requestDigest、严格重放

### 7.1 K2

- method 固定 `face.reconcile`；沿用 [service.mjs](../../admin-web/lib/face-service/service.mjs) 第 117–151 行的 `#opContext`/`#replayValid`/`#opDomainWrites`。
- `operationKey = HMAC/K2` 派生，记录保存 `orgId/realm/keyVersion/requestDigest/result/createdAt`；**不保存原始 Idempotency-Key**。
- `requestDigest = SHA-256(stable({jobId, expectedRevision, decision, evidence:{sourceType,sourceCode,observedAt}, evidenceDigest, previousEvidenceId}))`；`evidenceDigest` 为 §5.3 的服务端 K3 摘要。
- K2 缺失/非法 → `NOT_CONFIGURED/503`；domain 单边缺失/损坏 → `DOMAIN_INCOMPLETE/409`；完整但与配置不一致 → `DOMAIN_MISMATCH/409`；均零写。

### 7.2 严格重放

| 情形 | 行为 |
|---|---|
| 同 op key、同 requestDigest | 返回已有 operation key 的稳定 result；不重跑 decision/evidence，不新增核心写；Provider 0 |
| 同 op key、异 requestDigest | `CONFLICT/409`，不改写 operation key |
| operation key `result` 为 null/数组/错 jobId/错 decision/异常 createdAt | `CONFLICT/409`，零写 |
| 同 op key、`confirmed_removed` 已 R1 但 R2 未完成 | 返回 `202` 的稳定指针（`jobState=retryable_failed`、`cleanupPending=true`）；不重复 R1、不重复 Provider；本地 finalize 可由 H4-b 恢复路径完成 |
| 同 op key、`confirmed_removed` 已 R2 完成 | 返回最终 `200` 投影；核心写集不变 |
| 不同 op key、已终态且 decision 相同 | `duplicate:true`，返回既有终态，零写 |
| 不同 op key、已终态且 decision 不同 | `RECONCILE_CONFLICT/409`，保留原终态 |
| job 已 `terminal_failed`/`succeeded` 且非上述重复 | `INVALID_STATE/409`，零写 |

`confirmed_removed` 的 operation key 存的是**稳定指针**（decision/evidenceId/sequence），不是会随 finalize 变化的完整响应；这样既保持 K2 记录不可变，又允许 R2 完成后同一键返回最终投影。该“指针 + 投影”是 H4-c 的明确例外，见 §14 Q5。

## 8. refs/writes、90-ref 上限与候选扫描

### 8.1 逐 decision refs/writes

| 事务 | refs | writes |
|---|---|---|
| R1 confirmed_removed | org、membership、job、evidence、previous evidence（可选）、op key、op domain head/version、log、audit = 9–10 | job pre-finalize、evidence、log、op key、domain 0–2、audit；**0** grant/slot/claim/device |
| R2 confirmed_removed | H4-b `8+N`：job、grant、slot、claim、device、guard、success log、N candidates、audit | H4-b 原写集：job succeeded、grant cleanupPending=false、slot/claim/guard 按原规则、log、audit |
| confirmed_present | org、membership、job、evidence、previous（可选）、op key、op domain 2、log、audit = 9–10 | job terminal、evidence、log、op key、domain、audit；**0** grant/slot/claim/device |
| still_unknown | 同上 9–10 | evidence、log、op key、domain、audit；**0** job/grant/slot/claim/device |

所有事务在 `store.transact` 前去重；`8+N` 的 N 是 H4-b candidate 集合（不含已清除的 `revoked+cleanupPending=false`）。

### 8.2 82/83 与 90 上限

- H4-b finalize 的 `8+N` 在 N=82 时 = 90，成功；N=83 时 = 91，H4-b 现有保护进入 local-finalize pending（Provider 成功后）或 pre-send 拒绝（Provider 前）。H4-c **不改变**该边界。
- R1 写前只读预扫：
  - N≤82：允许 R1；
  - N≥83：`CAPACITY_EXCEEDED/400`，R1 零写、Provider 0、无 evidence/op key；
  - R1 后 N 增长到 83：R2 H4-b 的 `>90` 分支进入 local-finalize pending，绝不半释放。
- R1 的只读预扫只做 candidate 计数/有效性判断，**不**自行释放、不写 slot/claim/guard；释放算法只有 H4-b 一套。

### 8.3 candidate/guard/墓碑复用

- candidate 顺序：先读 release guard，再 list grants；guard witness 在事务内 CAS `revision+epoch`。
- 只排除 `outside` 和 `revoked+cleanupPending=false`；pending/effective/suspended/expired/revoked+true 全部阻断。
- 当前 job 的合法 slot 墓碑（`releasedByJobId===jobId`）和合法 claim 墓碑（`releasedByAuditId===auditId`）允许；其他 job/部分墓碑拒绝。
- 任何 slot/claim/guard/device 结构损坏 → `DEVICE_CLAIM_INVALID`/`CLEANUP_SNAPSHOT_REQUIRED`，零写。
- 不删除、不复用 released slot 墓碑；不触碰其他 grant 的 owner claim。

### 8.4 确定性 evidence/log/audit ID

| 对象 | 公式 | 说明 |
|---|---|---|
| evidence | `h4c-evidence-v1:${sha256(stable([orgId,jobId,sequence])).slice(0,32)}` | 同一 job/sequence 唯一；并发同 sequence 冲突 |
| reconcile log | `deterministicLogId(jobId, eventToken, occurrence)`（[collections.mjs](../../admin-web/lib/face-service/collections.mjs) 第 481 行） | `eventToken` 用独立 token，避免与 H4-b 同 revision 日志碰撞：`reconcile_still_unknown`（occurrence=sequence）、`reconcile_confirmed_removed`（occurrence=1）、`reconcile_confirmed_present`（occurrence=1）；log 数据里的 `state` 仍写真实 job 状态 |
| reconcile audit | `audit-h4c-v1:${sha256(stable([orgId,jobId,decision,sequence,jobRevision])).slice(0,32)}` | 每次决定唯一；Store deterministic audit 写入 |
| R2 finalize log/audit | H4-b 原 `deterministicLogId` / `audit-h4-v1` | 不替换、不复制 H4-b ID 算法 |
| operation key | 现有 `operationKey`/K2 | 不把原始幂等键写入固定 ID |

log 数据不新增 `evidenceId/sequence` 字段；证据通过 evidence 记录的 `jobId/sequence/decision` 与 job 关联，审计通过 deterministic audit target 关联。

## 9. 并发与线性化

| 竞争 | 线性化点 | 结果 |
|---|---|---|
| 两个 `confirmed_removed` 同 job 不同键 | R1 job revision CAS / evidence sequence | 一胜；另一 `REVISION_CONFLICT`/`CONFLICT`，零写 |
| 同 op key 并发 | operation key 唯一 ID + 事务 | 一胜；另一重放同一结果，核心写不重复 |
| `confirmed_present` vs `confirmed_removed` | job revision CAS | 先提交者定终态；另一 `INVALID_STATE`/`RECONCILE_CONFLICT` |
| reconcile R2 vs H4-b `finalize` | job revision + H4-b `validateRevokeJob` | 一胜；另一 `INVALID_JOB`/`REVISION_CONFLICT`，不重复释放 |
| reconcile vs `expire` | `expire` 只接受 `sending`；reconcile 只接受 `awaiting_result` | 状态互斥；若 expire 先提交，reconcile 重新读；反之 expire 拒绝 |
| reconcile R2 vs `createGrant` | guard 先读 + candidate list + guard CAS | createGrant 在 guard 读后提交 → finalize `REVISION_CONFLICT`，不释放 claim；createGrant 在前 → candidate/blocker 阻断 |
| `still_unknown` 并发 | evidence sequence/ID + previous head | 同等 sequence 一胜一 `CONFLICT`；不双写；重试重算间隔/上限 |
| callback 重跑 | 确定性 log/audit ID + create-only | 同 callback 重跑只提交一次；preoccupied ID 整事务回滚 |

`confirmed_removed` 的 R1 与 R2 不是同一事务，但线性化点明确：R1 提交决定/证据/op key，R2 提交资源释放；R2 失败不撤销 R1，转为 local-finalize pending。任何路径不得把 R1 的“已确认删除”当作资源已释放。

## 10. 老任务、缺 snapshot、缺 guard、损坏墓碑与旧证据

| 情形 | 结果 | 写 |
|---|---|---|
| H3 enroll job / action≠revoke | `INVALID_JOB/409` | 0 |
| H4-b 之前的老 revoke job 缺 `cleanupSnapshot`/`cleanupPhase`/`providerOutcome` | `CLEANUP_SNAPSHOT_REQUIRED/409` | 0 |
| snapshot schema 非 1、字段不精确、>4096 bytes、grant/credential/device 绑定不符 | `CLEANUP_SNAPSHOT_REQUIRED/409` | 0 |
| 缺 release guard / guard ID/org/claim/revision/epoch 不符 | `CLEANUP_SNAPSHOT_REQUIRED` 或 `DEVICE_CLAIM_INVALID/409` | 0 |
| slot/claim 损坏、released 字段不合法、activeClaimId 指向他人 | `DEVICE_CLAIM_INVALID/409` | 0 |
| 旧 evidence 缺 digest/sequence/previousEvidenceId、schema 不符 | `EVIDENCE_INVALID/409` | 0 |
| job 已 `terminal_failed`/`succeeded` | `INVALID_STATE`/重复规则 | 0 |
| job 无 `result.finishedAt` 或非安全整数 | `INVALID_JOB/409` | 0 |

禁止自动迁移、补写、猜测、回填历史 job/evidence/guard/claim。

## 11. 错误映射

| code | HTTP | 触发 | 写 |
|---|---:|---|---|
| `PARAM_ERROR` | 400 | DTO/枚举/未知字段/时间类型/长度非法 | 0 |
| `NOT_CONFIGURED` | 503 | K2/K3 缺失/非法、Cloud/live/真实 Provider | 0 |
| `NOT_FOUND` | 404 | job 不存在/跨组织同态 | 0 |
| `FORBIDDEN` | 403 | 权限/成员/组织失效 | 0 |
| `REVISION_CONFLICT` | 409 | expectedRevision/guard CAS 失败 | 0 |
| `INVALID_STATE` | 409 | job 非 `awaiting_result`/已终态 | 0 |
| `EVIDENCE_REQUIRED` | 409 | evidence 缺失/null | 0 |
| `EVIDENCE_INVALID` | 409 | 结构/短码/decision 不匹配/摘要/链/旧 schema | 0 |
| `EVIDENCE_STALE` | 409 | 时间早于 unknown、未来、超 24h、非递增 | 0 |
| `RECONCILE_THROTTLED` | 409 | still_unknown 间隔 <60s | 0 |
| `RECONCILE_LIMIT` | 409 | still_unknown 已达 8 次 | 0 |
| `RECONCILE_CONFLICT` | 409 | 已终态但 decision 不同 | 0 |
| `CONFLICT` | 409 | op key 摘要/结果损坏、log/audit/evidence preoccupation | 0 |
| `DOMAIN_INCOMPLETE` | 409 | K2 domain 单边缺失/损坏 | 0 |
| `DOMAIN_MISMATCH` | 409 | K2 换钥/版本/fingerprint 不符 | 0 |
| `CLEANUP_SNAPSHOT_REQUIRED` | 409 | 老 job/缺 snapshot/guard/绑定 | 0 |
| `DEVICE_CLAIM_INVALID` | 409 | 损坏墓碑/claim/slot/guard | 0 |
| `CAPACITY_EXCEEDED` | 400 | 预扫 N≥83 | 0 |
| `LOCAL_FINALIZE_EXHAUSTED` | 409 | local finalize 第 4 次耗尽 | 资源不释放 |
| `ADAPTER_UNAVAILABLE` | 503 | Store/clock 不可用 | 0 |
| `RETRY_NOT_DUE` | 409 | H4-b local finalize 未到 nextAttemptAt | 0 |

HTTP 状态只由统一错误信封输出；H4-c 不新增错误字段，不把原始异常 message/stack 返回。

## 12. 字段白名单

| 对象 | 白名单 | 约束 |
|---|---|---|
| 请求体 | `jobId`、`expectedRevision`、`decision`、`evidence{sourceType,sourceCode,observedAt}` | 精确；未知字段拒绝 |
| evidence 记录 | 见 §5.2 | 不可变、create-only、无原始载荷 |
| revoke job | H4-b `JOB_FIELDS` 24 项（[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 35–40 行） | H4-c **不新增 job 顶层字段**；老 job 缺字段失败关闭 |
| job `cleanupSnapshot` | H4-b `SNAPSHOT_FIELDS` 16 项 | 不修改、不重算、不补写 |
| grant | H4-b 现有字段 + `cleanupPending/cleanupJobId/revokedAt/revokedByActorId` | H4-c 只在 R2 通过 H4-b 修改 `cleanupPending`；不新增字段 |
| reconcile log | H3/H4 既有字段：`_id,orgId,jobId,action,fromState,state,actorType,actorId,at,revision,attempt,leaseGeneration,evidenceScope,errorKind,reasonCode,alertCode` | 不新增 evidenceId/sequence 字段；证据用独立集合关联 |
| operation key | `orgId,realm,keyVersion,requestDigest,result,createdAt` | 不存原始幂等键 |
| 响应 | 见 §13 | 最小 DTO |

## 13. 最小响应 DTO 与未来 HTTP 路径

### 13.1 响应

```json
{
  "jobId": "job-revoke-v1:...",
  "decision": "confirmed_removed",
  "jobState": "succeeded",
  "grantState": "revoked",
  "cleanupPending": false,
  "evidenceId": "h4c-evidence-v1:...",
  "evidenceSequence": 1,
  "decidedAt": 1763000000000,
  "cleanupPhase": "complete",
  "duplicate": false
}
```

| 字段 | 说明 |
|---|---|
| `jobId/decision/jobState/grantState/cleanupPending/evidenceId/evidenceSequence/decidedAt` | 必有 |
| `cleanupPhase` | 仅 `confirmed_removed`：`finalize`/`complete` |
| `duplicate` | 仅不同键同结论的重复对账为 `true`；其余 `false` 或省略 |

不返回：evidence digest/原始证据、actorId、orgId、idempotency key、requestDigest、opId、设备/人员/文件字段、异常 message/stack。

### 13.2 HTTP 路径提案（不注册）

沿用 [routes.mjs](../../admin-web/lib/face-service/routes.mjs) 第 54–59 行已存在的提案：

```text
POST /api/v2/device-operation-jobs/:jobId/reconcile
Permission: device.operation.reconcile
Header: Idempotency-Key: <16-128 [A-Za-z0-9._:-]>
Body: §4
200: confirmed_removed 已完成 / confirmed_present / still_unknown
202: confirmed_removed 已记录决定，local finalize pending
4xx/5xx: §11
```

H4-c 不修改 `server.mjs`、不注册路由、不新增权限点；路径仅作为后续 HTTP 卡输入。

## 14. 待 Codex 裁定

### Q1 evidence 摘要的用途域、算法、版本与密钥来源

**建议**：独立 K3 `H4_EVIDENCE_HMAC_KEY_B64`，HMAC-SHA256，`KEYED_DIGEST/h4-reconcile-evidence`，`digestVersion=1`；不复用 K1/K2，不回退无密钥 SHA-256。理由：证据短码低熵，需要防枚举/防替换；K2 换钥不应使历史证据失效；K3 可独立轮换。**请裁定是否批准新增 K3 环境配置。**

### Q2 `confirmed_present` 是否允许未来受控重新派发

**建议**：H4-c 不允许。`terminal_failed` 为终态；`requeue` 只接受 `retryable_failed`，已自然失败关闭。未来重新清理必须 H4-d 新设计（新 cleanup generation/job、独立权限与审计），不得在本卡开口子。**请裁定是否接受“H4-c 不提供重新派发”。**

### Q3 `still_unknown` 是否需要间隔或次数上限

**建议**：需要。60 秒最小间隔 + 同一 job 最多 8 次；最终 confirmed 裁定可作为 sequence 9。用 evidence sequence/previous head 的确定性 ID 做并发收敛；若 Codex 要求严格原子计数，则需新增 per-job control record（见 Q4 备选）。**请裁定 60s/8 是否合适，或给出替代阈值。**

### Q4 对账证据采用独立集合还是嵌入 job

**建议**：独立不可变 `device_operation_evidence`。理由见 §5.1：`still_unknown` 不得改 job；H4-b `validateResult` 是精确 5 字段；旧证据/链校验需要独立记录；confirmed_removed 的 R2 仍保持 H4-b `8+N`。**备选**：嵌入 job 需修改 H4-b 精确 schema 并允许 `still_unknown` 写 job，不建议。

### Q5 `confirmed_removed` 两段式与 operation key 指针

**建议**：接受 R1（决定/证据/op key）+ R2（H4-b finalize）两段式；operation key 存稳定指针，response 由 job/evidence 投影；R1 后 R2 失败返回 202，由 H4-b local finalize 恢复；同键重放在 pending/final 两阶段分别返回 202/200，但**不重复 decision、不重复资源释放、Provider 0**。理由：单事务加 evidence/op key 会把 H4-b 82/90 推到 91，破坏冻结边界。**请裁定该异步/投影语义是否可接受。**

### Q6 `finalizeAttempts` 从 1 起算

**建议**：R1 把人工 confirmed_removed 视为第 1 次本地 finalize 尝试，`finalizeAttempts=1`；R2 失败后 H4-b 递增到 2/3/4，第 4 次耗尽。这样不修改 H4-b validator。**备选**：新增 `reconcile_pending` phase 或允许 0，需改 H4-b schema；不建议。**请裁定。**

### Q7 老任务/旧证据的失败关闭口径

**建议**：不迁移、不补写、不猜测；任何老 job 缺 snapshot/guard 或旧 evidence 缺 digest/sequence 一律 409。**请裁定是否接受“历史记录只能人工受控修复，不在 H4-c 自动兼容”。**

## 15. 连续测试矩阵（RC01–RC52）

记号：`Z`=全库内容级零变化（含 job/grant/slot/claim/device/guard/evidence/log/op key/domain/audit）；`P0`=Provider 0；`X`=允许的 H4-c 写集。所有用例先固化注入后基线，再比较。

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| RC01 | `awaiting_result`，无 blocker，confirmed_removed | R1+R2 成功；job succeeded；cleanupPending=false；slot released；无 blocker 时 claim released | 0 | X |
| RC02 | 同上，confirmed_present | job terminal_failed；grant revoked/cleanupPending=true；slot/claim 不变 | 0 | X |
| RC03 | 同上，still_unknown | job 保持 awaiting_result；仅 evidence/log/op key/audit | 0 | X |
| RC04 | 成员缺 `device.operation.reconcile` | FORBIDDEN/403 | 0 | Z |
| RC05 | 跨组织 jobId / 不存在 | NOT_FOUND/404 同态 | 0 | Z |
| RC06 | expectedRevision 过期 | REVISION_CONFLICT/409 | 0 | Z |
| RC07 | job 非 awaiting_result（queued/sending/terminal） | INVALID_STATE/409 | 0 | Z |
| RC08 | 请求多字段/evidence 多字段 | PARAM_ERROR/400 | 0 | Z |
| RC09 | 非法 decision / 大小写/空串 | PARAM_ERROR/400 | 0 | Z |
| RC10 | evidence 缺字段/类型错/sourceCode 与 decision 不符 | EVIDENCE_INVALID/409 | 0 | Z |
| RC11 | observedAt 早于 job.result.finishedAt | EVIDENCE_STALE/409 | 0 | Z |
| RC12 | observedAt 未来/超 24h/旧 evidence 缺 digest | EVIDENCE_STALE 或 EVIDENCE_INVALID/409 | 0 | Z |
| RC13 | 同 op key 同摘要，任一种 decision 已成功 | 返回原结果；核心写集不变 | 0 | Z |
| RC14 | 同 op key 异摘要 | CONFLICT/409 | 0 | Z |
| RC15 | operation key result 损坏/错 jobId/错 decision | CONFLICT/409 | 0 | Z |
| RC16 | K2 缺失/非法 | NOT_CONFIGURED/503 | 0 | Z |
| RC17 | K2 domain 单边缺失/损坏 | DOMAIN_INCOMPLETE/409 | 0 | Z |
| RC18 | K2 换钥/fingerprint 不符 | DOMAIN_MISMATCH/409 | 0 | Z |
| RC19 | confirmed_removed + 共享设备另一 active grant | 目标 slot released；owner claim 保持 active；其他 grant 不变 | 0 | X |
| RC20 | 82 candidates / 90 refs | R1 通过；R2 H4-b 成功，claim 保持（有 blocker） | 0 | X |
| RC21 | 83 candidates 预扫 | CAPACITY_EXCEEDED/400；R1 零写 | 0 | Z |
| RC22 | R1 后新增第 83 个 candidate | R2 进入 local-finalize pending；slot/claim 不半释放 | 0 | X |
| RC23 | guard/claim 在 guard 读后变化 | R2 REVISION_CONFLICT/DEVICE_CLAIM_INVALID；不释放 | 0 | Z |
| RC24 | 当前 job 的合法 slot/claim 墓碑已存在 | R2 接受本 job 墓碑，不重复写 | 0 | X |
| RC25 | 其他 job 或部分墓碑 | DEVICE_CLAIM_INVALID/409；不覆盖 | 0 | Z |
| RC26 | R2 连续失败至第 4 次 | terminal_failed/LOCAL_FINALIZE_EXHAUSTED；资源不释放 | 0 | X |
| RC27 | 任意 confirmed_removed 路径 | Provider 恒 0；无 enroll/revoke 调用 | 0 | X |
| RC28 | confirmed_removed R1 后同键重放 | 202 pending；R2 完成后 200 final；无重复 decision/释放 | 0 | Z/X |
| RC29 | confirmed_present | grant 保持 revoked/cleanupPending=true；slot/claim 不释放 | 0 | X |
| RC30 | confirmed_present 后 requeue/retry | 拒绝；terminal 不可重派 | 0 | Z |
| RC31 | 已终态后不同 decision | RECONCILE_CONFLICT/409 | 0 | Z |
| RC32 | 已终态后同 decision 新键 | duplicate:true；零写 | 0 | Z |
| RC33 | confirmed_present 响应/投影 | 含 jobState/cleanupPending；不显示已删除 | 0 | Z |
| RC34 | still_unknown | job revision/state/result/cleanupPending 均不变 | 0 | X |
| RC35 | 60 秒内第二次 still_unknown | RECONCILE_THROTTLED/409 | 0 | Z |
| RC36 | 第 9 次 still_unknown | RECONCILE_LIMIT/409；最终裁定仍可用 sequence 9 | 0 | Z |
| RC37 | observedAt 非递增/previous 链断 | EVIDENCE_STALE/EVIDENCE_INVALID/409 | 0 | Z |
| RC38 | still_unknown 同键重放 | 原结果；零写；不新增 sequence | 0 | Z |
| RC39 | still_unknown 新键 | sequence+1；evidence/log/op key 各一条 | 0 | X |
| RC40 | 两并发同键 reconcile | 一胜；另一重放；核心写不重复 | 0 | Z/X |
| RC41 | 两并发不同 decision | 一胜；另一 INVALID_STATE/CONFLICT | 0 | Z |
| RC42 | reconcile R2 vs H4-b finalize | 一胜；另一 INVALID_JOB/REVISION_CONFLICT | 0 | X/Z |
| RC43 | reconcile vs expire | 状态互斥；失败方零写 | 0 | Z |
| RC44 | reconcile R2 vs createGrant/guard | guard CAS 拒绝；无错放 claim | 0 | X/Z |
| RC45 | 事务 callback 重跑 | 仅一次提交；log/audit create-only | 0 | X |
| RC46 | 任一失败路径 | 全库内容级 Z；无 grant/job/slot/log/op key/evidence 增量 | 0 | Z |
| RC47 | log/audit/op key/evidence ID 预占 | 整事务回滚；原记录不变 | 0 | Z |
| RC48 | 注入序列号/IP/MAC/账号/图片/objectKey/原始幂等键 | 证据/日志/响应/审计零命中 | 0 | Z |
| RC49 | Cloud/live/真实 Provider/设备连接 | NOT_CONFIGURED/503；不发起网络/设备调用 | 0 | Z |
| RC50 | 老 job 缺 cleanupSnapshot/cleanupPhase | CLEANUP_SNAPSHOT_REQUIRED/409 | 0 | Z |
| RC51 | 缺 guard/损坏 slot/claim/guard | CLEANUP_SNAPSHOT_REQUIRED/DEVICE_CLAIM_INVALID/409 | 0 | Z |
| RC52 | 成功响应字段扫描 | 仅 §13.1 字段；无 digest/actor/opId/PII | 0 | Z |

矩阵共 **52** 条，连续编号，覆盖三种 decision、权限/跨组织/revision、K2/domain、重放/异摘要/损坏、candidate/82/83/guard/墓碑、并发 finalize/expire/createGrant/第二个 reconcile、callback/预占、Z/P0/敏感扫描/Cloud-live 失败关闭与老任务。

## 16. 验收与后续门禁

- 本轮只新增本设计文档；未修改任何生产代码或测试，未注册 HTTP。
- 交付前执行：`git diff --check`、相对链接检查、敏感值扫描；全部通过后再提交/请求推送。
- H4-c 编码必须在 Codex 对本设计（尤其 Q1–Q7）终审通过后单独发卡；本设计不构成 H4-c 或完整门禁上线批准。
- H4-d、HTTP 注册、Cloud/live、真实 Provider、真实设备写、`server.mjs` 与 `main` 合并继续关闭。
