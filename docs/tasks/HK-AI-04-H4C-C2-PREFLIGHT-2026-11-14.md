# HK-AI-04 H4-c C2 实施前契约检查表

> 检查表，不是实现、不是批准、不是发布。**C1 未正式通过，C2 未开始。** 本卡只写文档：不修改生产代码或测试、不进入 `finalize-retry`、不修改 `server.mjs`、不注册 HTTP、不调用 Provider/设备/生产云、不改变 `b15aceb` 的状态/错误码/阈值。

- 冻结设计：`docs/hk-face-h4c-reconciliation-design` @ `b15acebe0a8049f316797bbbd2692c55de25d111`
- 设计终审批准：`docs/lock-01-fast-track` @ `ed7b66f84c79339246a81ea76762cc388d7f4778`
- C1 核对对象：`feat/hk-face-h4c-reconciliation` @ `3fce9b027b720943bb049bd5220e117e9d91217e`
- H4-b 代码基线：`1155b7ba65991d324fb8b22bb8f7dd87f49428f9`
- 本卡分支：`docs/hk-face-h4c-c2-preflight`，从 `b15aceb` 建，**不包含 C1 代码**
- 唯一产物：`docs/tasks/HK-AI-04-H4C-C2-PREFLIGHT-2026-11-14.md`
- 复审对象：Codex。复审通过前不开始 C2。

## 0. 结论与门禁

### 0.1 结论

1. 四个冻结引用均可解析：`b15aceb`（设计）、`ed7b66f`（批准）、`3fce9b0`（C1）、`1155b7ba...`（H4-b）。批准文档确认 H4-c 设计 Q1–Q9 与两项 P0 关闭，但批准把 C1/C2/C3 拆成独立阶段，**没有批准 C1 代码**。
2. C1 @ `3fce9b0` 没有对应的正式批准/复审结论。核对时 C1 分支已前进到 `6dbc9e0`，该提交自述对 `3fce9b0` 的两项 P0 返工，并明确“等待 Codex 独立复审”。因此 **C1 未正式通过**，这是 C2 的硬阻断。
3. 本检查表完成 C2 的契约、复用面、逐处 TOCTOU、create-only/CAS 线性化点、RC01–RC60 映射和三段提交拆分；**不开始 C2**。
4. C2 不能直接以 `3fce9b0` 为基线启动。至少以下五处存在需 Codex 裁定的冲突：K3 domain 首次创建语义、K3 head ID 作用域、head 为空时“无既有 evidence”的原子证明、H4-b validator 错误码、`finalizeAttempts=1` 与 H4-b 退避/耗尽计数。见 §13。
5. 本卡未修改任何生产代码或测试，未调用 Provider、设备、生产云，未注册 HTTP，未改变 `b15aceb` 的状态、错误码或阈值。

### 0.2 门禁

| 门禁 | 当前状态 | 允许的下一步 | 证据 |
|---|---|---|---|
| G1 C1 正式通过 | **未通过** | 不能开始 C2-1/2/3 | `3fce9b0` 无批准文档；`6dbc9e0` 自述待复审 |
| G2 C2 契约批准 | 待 Codex | 复审本检查表 | 本文件 |
| G3 C2-1 服务接口与只读校验 | 未开始 | G1+G2 后单独提交、单独复审 | §10.1 |
| G4 C2-2 三种 decision | 未开始 | G3 复审通过 | §10.2 |
| G5 C2-3 测试与并发证据 | 未开始 | G4 复审通过 | §10.3 |

### 0.3 C2 范围

- **C2 包含**：`confirmed_removed`、`confirmed_present`、`still_unknown` 三种 decision 的服务层入口、输入 DTO、权限、组织/成员/job/grant/cleanupSnapshot 复核、K2 operation key、K3 evidence/head、响应投影、错误码、Provider 0、RC01–RC60。
- **C2 不包含**：`finalize-retry`、`(jobId, expectedRevision)` generation、9 refs 恢复事务、四字段 K2 result；RC61–RC73 **全部且仅归 C3**，C2 不实现、不验收、不宣称覆盖（C1 对 RC69–RC73 的单元仅作 helper 证据，不计入 C2 覆盖）。
- **C2 不做**：HTTP 注册、`server.mjs` 修改、`routes.mjs` 新路由、真实 Provider、真实设备、Cloud/live、H4-d、K3 历史密钥迁移、`main` 合并。

## 1. 冻结引用与只读核对

### 1.1 引用表

| 引用 | 解析结果 | 类型 | 核对文件 | 结论 |
|---|---|---|---|---|
| `docs/hk-face-h4c-reconciliation-design` @ `b15aceb` | `b15acebe0a8049f316797bbbd2692c55de25d111` | commit（分支 tip） | `docs/tasks/HK-AI-04-H4C-RECONCILIATION-DESIGN.md`，741 行 | 可解析；设计正文与 §14 Q1–Q9、§15 RC01–RC73 完整 |
| `docs/lock-01-fast-track` @ `ed7b66f` | `ed7b66f84c79339246a81ea76762cc388d7f4778` | commit（`origin/docs/lock-01-fast-track` tip） | `docs/tasks/HK-AI-04-H4C-DESIGN-APPROVAL-B15ACEB-2026-11-14.md`、`docs/tasks/HK-AI-04-H4C-IMPLEMENTATION-TASK-2026-11-14.md` | 可解析；批准 Q1–Q9，拆 C1/C2/C3 |
| `feat/hk-face-h4c-reconciliation` @ `3fce9b0` | `3fce9b027b720943bb049bd5220e117e9d91217e` | commit（C1 核对对象） | `h4c-evidence.mjs` 452 行、`index.mjs` +1、`store.mjs` +44/-7、`face-h4c-evidence.test.mjs` 1007 行 | 可解析；**不是分支 tip**，tip 已到 `6dbc9e0` |
| H4-b @ `1155b7ba...` | `1155b7ba65991d324fb8b22bb8f7dd87f49428f9` | commit | `admin-web/lib/face-service/h4b.mjs` 549 行 | 可解析；是 `b15aceb` 与 `3fce9b0` 的共同祖先 |

### 1.2 分支拓扑事实

- `1155b7b` 是 `b15aceb` 的祖先：`b15aceb` 只比 `1155b7b` 多设计文档 741 行。
- `1155b7b` 是 `3fce9b0` 的祖先：C1 只比 `1155b7b` 多 4 个文件。
- `b15aceb` **不是** `ed7b66f` 的祖先：批准分支与设计分支是两条独立分支，批准文档用 SHA 引用设计，不靠祖先关系。
- `3fce9b0` 是 `feat/hk-face-h4c-reconciliation` 的祖先，但分支 tip 为 `6dbc9e0`（“fix(face): close H4-c C1 K3 domain P0 gaps”）。本检查表按任务指定只冻结 `3fce9b0`；`6dbc9e0` 只作为“C1 未批准”的旁证，不作为 C2 基线。

### 1.3 C1 状态

`3fce9b0` 的存在不等于 C1 通过：

- 批准文档只批准**设计**并“允许另发 H4-c 编码卡”，未逐笔批准 C1。
- `3fce9b0` 没有对应的 `HK-AI-04-H4C-C1-APPROVAL-*` 或复审结论。
- `6dbc9e0` 的 `docs/tasks/HK-AI-04-H4C-C1-REVIEW-EVIDENCE-2026-11-14.md` 明确写“两项 P0 已按指定契约返工，等待 Codex 独立复审”，并列出 `3fce9b0` 的 P0-1（append 在 domain 双缺失时隐式创建/回填）与 P0-2（realm 进入 head ID，切换 realm 形成并行命名空间）。
- 因此 G1 未通过；C2 不得开始。

### 1.4 为什么从 `b15aceb` 建文档分支

本卡分支从 `b15aceb` 建，只发布检查表。这样不会把未正式通过的 C1 代码带到文档分支，也不会让文档分支看起来像 C2 实现基线。C2 未来编码必须从 **Codex 批准的 C1 commit** 另建代码分支，不从本分支续写。

## 2. 现有实现事实与复用面

### 2.1 C1 @ `3fce9b0` 可复用 API

| API | 位置 | 语义 | C2 复用方式 |
|---|---|---|---|
| `EVIDENCE_COLLECTION` / `EVIDENCE_HEADS_COLLECTION` / `EVIDENCE_DOMAINS_COLLECTION` | `h4c-evidence.mjs:17-19` | 三个集合名 | refs/writes |
| `EVIDENCE_DIGEST_DOMAIN` / `EVIDENCE_DIGEST_ALGORITHM` / `EVIDENCE_DIGEST_ALGORITHM_VERSION` | `:21-23` | K3 域/算法/消息版本 | evidence 字段 |
| `EVIDENCE_SCHEMA_VERSION` / `H4C_EVIDENCE_SCOPE` | `:24-25` | schema `1`、`simulated` | evidence 字段 |
| `EVIDENCE_MAX_SEQUENCE` / `STILL_UNKNOWN_MAX_SEQUENCE` | `:26-27` | 9 / 8 | sequence 上限 |
| `stableValue` / `stableStringify` | `:65-77` | 键排序 JSON | requestDigest/ID 的规范化 |
| `evidenceId(orgId, jobId, sequence)` | `:82-83` | `h4c-evidence-v1:<sha256>` | 新 evidence ID |
| `evidenceHeadId(orgId, jobId)` | `:85-86` | `h4c-evidence-head-v1:<sha256>` | per-job head ID |
| `evidenceDomainIds(realm, version)` | `:92-98` | K3 head/version ID（**realm 作用域**） | K3 refs；Q03 |
| `validateEvidenceRecord` | `:100-120` | 20 字段精确 validator、大小/序列/来源/摘要格式 | 预读、写后断言 |
| `validateEvidenceHead` | `:122-135` | 9 字段精确 validator | 预读、head 断言 |
| `validateEvidenceDomainRecord` | `:137-153` | head/version 精确 validator | K3 domain 校验 |
| `evidenceKeyFingerprint` | `:155-162` | K3 指纹 | 配置校验 |
| `evidenceKeyConfig(env)` | `:165-181` | 独立 K3 配置 | 服务层取配置 |
| `evidenceDigest(record, config)` | `:197-218` | 结构化 HMAC-SHA256 | requestDigest 的 `evidenceDigest` 预览、父证据重算 |
| `applyEvidenceDomain(state, cfg)` | `:237-289` | K3 domain guard；**双缺失时返回两条 create 写** | R1/present/unknown 事务内调用；Q02 |
| `evidenceAppendRefs(job, head, domainHead, cfg)` | `:305-326` | K3、head、新 evidence、previous 的 refs | R1/present/unknown refs |
| `appendEvidenceWrites(state, opts)` | `:335-452` | domain + evidence + head 的纯事务 builder；head CAS、父证据正式复核 | R1/present/unknown 写集核心 |

### 2.2 H4-b @ `1155b7b` 可复用 API

| API | 位置 | 语义 | C2 复用方式 |
|---|---|---|---|
| `validateRevokeJob(job)` | `h4b.mjs:84-120` | 24 字段 revoke job 精确 validator；state/phase/result/finalizeAttempts | C2 所有 decision 先跑；错误码见 Q07 |
| `H4MockRevoker.finalize(jobId)` | `:475-481` | 只接受 `retryable_failed` + `cleanupPhase=finalize` + `now>=nextAttemptAt`；本地 finalize | `confirmed_removed` R2 |
| `H4MockRevoker.requeue/expire/scanExpired` | `:482-548` | H4-b 现有入口 | 仅用于“禁止重新派发”的负向测试 |
| `H4MockRevoker` 构造器 | `:188-195` | 只接受 `LocalStore` + `MockFaceAccessProvider` | C2 依赖注入/构造方式见 Q18 |
| `deterministicLogId(jobId, token, occurrence)` | `collections.mjs:481` | 确定性 log ID | R1/present/unknown log |
| `validateSnapshot` | `h4b.mjs:62-75` | **私有**；8+N 的 snapshot 精确校验 | C2 R1 只读预校验需要；Q06 |
| `candidateDisposition` | `h4b.mjs:176-184` | **私有**；outside/block/clear/invalid | R1 预扫 82/83 需要；Q06 |

### 2.3 K2、Store、权限、DTO 事实

| 事实 | 位置 | 对 C2 的约束 |
|---|---|---|
| K2 `#opContext(route, idempotencyKey)` | `service.mjs:117-126` | 私有；C2 的 `reconcile` 必须加在同一 `FaceCredentialService` 内，或另建可复用 K2 层；不得复制 K2 |
| K2 `#replayValid(existing, op, requestDigest, expected)` | `:132-145` | 要求 `existing.result` 与 `expected` **精确深等**；`confirmed_removed` 只能传稳定指针，不能传会随 R2 变化的完整响应 |
| K2 `#opDomainWrites(state, op, now)` | `:147-151` | 返回 0–2 条 domain create 写 |
| K2 `operationKeyConfig` / `operationKey` / `operationKeyDomainIds` / `operationKeyFingerprint` / `applyOperationKeyDomain` | `collections.mjs:199-314` | `face.reconcile` 复用；K2 缺失/非法 `NOT_CONFIGURED/503`；domain 异常 `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH` |
| `assertIdempotencyKey` | `collections.mjs:182-189` | 16–128 位 `[A-Za-z0-9._:-]`；非法 `PARAM_ERROR/400` |
| `digestOf(value)` | `service.mjs:57-58` | `SHA-256(stable JSON)`；C2 requestDigest 复用 |
| `Store.transact(refs, build, audit)` | `store.mjs:287-343` | build 只拿到**已声明 refs** 的 state；未声明的记录读不到；所有事务内复核的记录必须在 refs |
| 确定性 audit | `store.mjs:90-99`、`:116-126` | refs 必须含 `admin_audit/<auditId>`；去重后 ≤90；audit 由 Store 写，不在 build 返回的 writes 中 |
| `createOnlyCollections` / `exactWriteCollections` | `store.mjs:101-114` | evidence/domain create-only；evidence/head/domain 精确字段；head 可 CAS 更新 |
| 权限 `device.operation.reconcile` | `org.mjs:104` | 权限名冻结，不新增别名 |
| `publicJobResult` | `dto.mjs:254-263` | 只返回最小 job 字段；C2 响应不得复制 job/evidence 原文 |
| 路由提案 `POST /api/v2/device-operation-jobs/:jobId/reconcile` | `routes.mjs:54-59` | 只作为提案；C2 不注册 |

### 2.4 缺口

- 没有 reconcile 输入 DTO/validator。
- 没有 `reconcile` 服务方法、没有三种 decision 的事务 builder。
- 没有响应投影（200/202/terminal/duplicate）。
- 没有 C2 测试文件；C1 测试只覆盖 helper，不覆盖服务入口。
- `validateSnapshot`、`candidateDisposition` 未导出。
- C1 `applyEvidenceDomain` 在 `3fce9b0` 的“双缺失即创建”语义与 C2-1 只读校验冲突（Q02）。

### 2.5 是否需要导出共享 validator

**结论：需要，但导出范围待 Codex 裁定。**

| validator | 是否必须共享 | 理由 | 可选实现 |
|---|---|---|---|
| `validateSnapshot` | **是** | R1 写前只读校验和 R1 事务内 §6.1 复核必须与 H4-b `finalize` 完全同一语义；复制会漂移，也可能被认定为复制释放算法 | 从 `h4b.mjs` 导出（设计 §6.5 明文允许“编码时导出为共享函数或等价调用”） |
| `candidateDisposition` | **建议是** | R1 预扫 N≥83 必须与 H4-b `#finalize` 的 candidate 语义一致；否则 82/83 边界会出现第二套定义 | 导出 `candidateDisposition`，或导出只读 `countFinalizeCandidates(grants, job)` |
| C1 `validateEvidenceRecord/Head/Domain` | 已导出 | C2 直接复用，无需再导出 | 直接 import |
| H4-b `validateRevokeJob` | 已导出 | C2 直接复用 | 直接 import；错误码归一见 Q07 |

如果 Codex 不允许修改 `h4b.mjs`（即使是只加 export），则 C2 只能在 `h4c-reconcile.mjs` 内实现“等价只读副本”，并把该副本列为 C2 的高风险复审点；本卡不自行选择。

## 3. 三种 decision 契约总表

### 3.1 总表

| 维度 | `confirmed_removed` | `confirmed_present` | `still_unknown` |
|---|---|---|---|
| 前置 job 状态 | `awaiting_result`；`cleanupPhase="dispatch"`；`providerOutcome=null`；`evidenceScope="simulated"`；`action="revoke"`；`revision===expectedRevision` | 同左 | 同左 |
| 权限 | `device.operation.reconcile`；组织 `active`；成员 `active` 且权限含该点；`actorType="user"` | 同左 | 同左 |
| 输入 DTO | `{jobId, expectedRevision, decision:"confirmed_removed", evidence:{sourceType:"operator", sourceCode:"OPERATOR_CONFIRMED_REMOVED", observedAt}}` + `Idempotency-Key` | `decision:"confirmed_present"`，`sourceCode:"OPERATOR_CONFIRMED_PRESENT"` | `decision:"still_unknown"`，`sourceCode:"OPERATOR_UNCERTAIN"` |
| refs | R1：org、membership、job、grant、evidence、previous（可选）、head、K3 head/version、op key、op head/version、log、audit（设计写 14–15，逐项去重实际 13/14，Q05）；R2：H4-b `8+N` | org、membership、job、grant、evidence、previous（可选）、head、K3 head/version、op key、op head/version、log、audit（13/14，Q05） | 同 present |
| writes | R1：job 转 `retryable_failed/finalize`、evidence、head、K3 domain 0–2、log、op key、op domain 0–2、audit；R2：H4-b 写 job/grant/slot/claim/guard/log/audit；**R1 0 grant/slot/claim/device** | job 转 `terminal_failed`、evidence、head、K3 domain、log、op key、op domain、audit；**0 grant/slot/claim/device** | evidence、head、K3 domain、log、op key、op domain、audit；**0 job/grant/slot/claim/device** |
| 事务内复核 | §6.1 job/grant/snapshot 全部；R1 追加 state/phase/outcome；R2 由 H4-b 再验 slot/claim/device/guard | §6.1 job/grant/snapshot 全部；追加 state/phase/outcome；slot/claim/device/guard 不读不写 | §6.1 job/grant/snapshot 全部；追加 state/phase/outcome；job/grant 只读 |
| K2 | `face.reconcile`；requestDigest 含 decision/evidenceDigest/previous/sequence；result 为稳定指针 | 同左；result 形状待 Q11 | 同左；result 形状待 Q11 |
| K3 evidence/head | evidence sequence 1..9；head CAS；previous 正式复核；K3 domain 0–2 | 同左 | sequence 1..8；60 秒；最多 8 次；最终 confirmed 可用 sequence 9；head CAS |
| 响应投影 | complete 200 / pending 202 / terminal 200；terminal 同 decision 新键 `duplicate:true` | 200 `terminal_failed`；`cleanupPhase="terminal"`；`terminalReason="RECONCILE_CONFIRMED_PRESENT"` | 200 `awaiting_result`；`cleanupPhase=null`；`terminalReason=null` |
| 错误码 | `CAPACITY_EXCEEDED`、`LOCAL_FINALIZE_EXHAUSTED`、`RETRY_NOT_DUE`、`CONFLICT` 等 | `INVALID_STATE`、`RECONCILE_CONFLICT`、`CONFLICT` 等 | `RECONCILE_THROTTLED`、`RECONCILE_LIMIT`、`CONFLICT` 等 |
| Provider | **0**（R2 只走 H4-b 本地 finalize） | **0** | **0** |

### 3.2 共同前置

三种 decision 事务内都必须先满足：

```text
job.orgId === orgId
job._id === jobId
job.revision === expectedRevision
job.action === "revoke"
job.state === "awaiting_result"
job.cleanupPhase === "dispatch"
job.providerOutcome === null
job.evidenceScope === "simulated"
job.cleanupSnapshot 通过 H4-b validateSnapshot
job.cleanupSnapshot.grantId === job.grantId
grant = state[device_access_grants/job.grantId]
grant.orgId === orgId
grant.state === "revoked"
grant.cleanupPending === true
grant.cleanupJobId === jobId
grant.credentialId === job.credentialId
grant.deviceId === job.deviceId
grant.claimId === job.cleanupSnapshot.claimId
grant.slotId === job.cleanupSnapshot.slotId
grant.revision 为安全正整数
```

不满足：`REVISION_CONFLICT`、`INVALID_STATE`、`CLEANUP_SNAPSHOT_REQUIRED`、`DEVICE_CLAIM_INVALID`、`INVALID_JOB` 之一，零写。注意 `validateRevokeJob` 是前置，但其 `assertSafeInt` 可能抛 `PARAM_ERROR`，见 Q07。

### 3.3 输入 DTO（严格白名单）

请求体只允许：

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

- 逐层未知字段、数组/对象类型漂移、隐式转换、`orgId/actorId/membershipId/permissions/role` 一律拒绝。
- `jobId`：1–128，`[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`；路径参数与 body 必须一致。
- `expectedRevision`：安全整数 1..`Number.MAX_SAFE_INTEGER`。
- `decision`：三值枚举。
- `evidence`：精确 3 字段；缺 `evidence` 用 `EVIDENCE_REQUIRED` 还是 `PARAM_ERROR`，Q14。
- `sourceType`：**仅 `operator`**；`mock_provider`/`device`/`provider_query`/`live` → `EVIDENCE_INVALID/409`。
- `sourceCode`：与 decision 绑定；不匹配 → `EVIDENCE_INVALID/409`。
- `observedAt`：安全整数毫秒，≥0；`job.result.finishedAt ≤ observedAt ≤ now`；24 小时上限见 Q13。
- `Idempotency-Key`：16–128，`[A-Za-z0-9._:-]`。

### 3.4 权限与 actor

1. 事务外 `#require("device.operation.reconcile")` 快速失败；事务内重读 `organizations/<orgId>` 和 `org_memberships/<actor.membershipId>`。
2. `organizations.status === "active"`；成员 `orgId/status` 一致，`principalId ?? actorId ?? _id` 与 actor 一致，`permissions` 含 `device.operation.reconcile`。
3. `actorType` 只允许 `user`；`system`/`agent` 在 H4-c 人工入口拒绝（`FORBIDDEN/403` 或 `PARAM_ERROR/400`，待 Q18 冻结）。
4. 跨组织与不存在同态：`store.get(..., orgId)` 返回 null，统一 `NOT_FOUND/404`。
5. `expectedRevision` 事务内严格相等；否则 `REVISION_CONFLICT/409`，零写。

### 3.5 响应投影

| 场景 | HTTP | jobState | grantState | cleanupPending | cleanupPhase | terminalReason | duplicate |
|---|---:|---|---|---|---|---|---|
| removed R1+R2 成功 | 200 | `succeeded` | `revoked` | false | `complete` | null | false |
| removed R1 成功、R2 pending | 202 | `retryable_failed` | `revoked` | true | `finalize` | null | false |
| removed 第 4 次耗尽 | 200 | `terminal_failed` | `revoked` | true | `terminal` | `LOCAL_FINALIZE_EXHAUSTED` | false |
| present | 200 | `terminal_failed` | `revoked` | true | `terminal` | `RECONCILE_CONFIRMED_PRESENT` | false |
| unknown | 200 | `awaiting_result` | `revoked` | true | null | null | false |
| 已终态、不同键同 decision | 200 | 既有 | 既有 | 既有 | 既有 | 既有 | **true** |
| 已终态、不同 decision | 409 | — | — | — | — | — | — |

响应字段：`jobId`、`decision`、`jobState`、`grantState`、`cleanupPending`、`evidenceId`、`evidenceSequence`、`decidedAt`、`cleanupPhase`、`terminalReason`、`duplicate`。`cleanupPhase` 是响应投影枚举（`finalize|complete|terminal`），不是 job 存储值（存储只有 `dispatch|finalize`）。

不返回：evidence digest/原始证据、actorId、orgId、idempotency key、requestDigest、opId、设备/人员/文件字段、异常 message/stack。

### 3.6 错误码总表

| code | HTTP | removed | present | unknown | 触发 |
|---|---:|---|---|---|---|
| `PARAM_ERROR` | 400 | ✓ | ✓ | ✓ | DTO/枚举/未知字段/时间类型/长度非法 |
| `NOT_CONFIGURED` | 503 | ✓ | ✓ | ✓ | K2/K3 缺失/非法、Cloud/live/真实 Provider |
| `NOT_FOUND` | 404 | ✓ | ✓ | ✓ | job 不存在/跨组织同态 |
| `FORBIDDEN` | 403 | ✓ | ✓ | ✓ | 权限/成员/组织失效、actorType 非 user |
| `REVISION_CONFLICT` | 409 | ✓ | ✓ | ✓ | expectedRevision/grant/head CAS 失败 |
| `INVALID_STATE` | 409 | ✓ | ✓ | ✓ | job 非 awaiting_result/已终态 |
| `INVALID_JOB` | 409 | ✓ | ✓ | ✓ | 老 job/字段/result/phase 非法（设计 §10） |
| `EVIDENCE_REQUIRED` | 409 | ✓ | ✓ | ✓ | evidence 缺失/null（Q14） |
| `EVIDENCE_INVALID` | 409 | ✓ | ✓ | ✓ | 结构/短码/decision/sourceType/摘要/旧 schema |
| `EVIDENCE_STALE` | 409 | ✓ | ✓ | ✓ | 早于 unknown、未来、超 24h、非递增（Q13/Q15） |
| `EVIDENCE_HEAD_CONFLICT` | 409 | ✓ | ✓ | ✓ | head revision/lastEvidenceId/lastSequence CAS 失败 |
| `EVIDENCE_CHAIN_BROKEN` | 409 | ✓ | ✓ | ✓ | head 缺失但链存在、head 消失、previous 不符 |
| `RECONCILE_THROTTLED` | 409 | — | — | ✓ | unknown 间隔 <60s |
| `RECONCILE_LIMIT` | 409 | — | — | ✓ | unknown 已达 8 次 |
| `RECONCILE_CONFLICT` | 409 | ✓ | ✓ | ✓ | 已终态但 decision 不同 |
| `RECONCILE_GENERATION_CONSUMED` | 409 | — | — | — | **C3 专属，C2 不实现** |
| `CONFLICT` | 409 | ✓ | ✓ | ✓ | op key 摘要/结果损坏、log/audit/evidence preoccupation |
| `DOMAIN_INCOMPLETE` | 409 | ✓ | ✓ | ✓ | K2/K3 domain 单边缺失/损坏 |
| `DOMAIN_MISMATCH` | 409 | ✓ | ✓ | ✓ | K2/K3 换钥/版本/fingerprint 不符 |
| `CLEANUP_SNAPSHOT_REQUIRED` | 409 | ✓ | ✓ | ✓ | 老 job/缺 snapshot/guard/绑定 |
| `DEVICE_CLAIM_INVALID` | 409 | ✓ | ✓ | ✓ | 损坏墓碑/claim/slot/guard |
| `CAPACITY_EXCEEDED` | 400 | ✓ | — | — | R1 预扫 N≥83 |
| `LOCAL_FINALIZE_EXHAUSTED` | 200/409 | ✓ | — | — | 终态投影或错误入口；资源不释放 |
| `ADAPTER_UNAVAILABLE` | 503 | ✓ | ✓ | ✓ | Store/clock 不可用 |
| `RETRY_NOT_DUE` | 409 | ✓ | — | — | H4-b finalize 未到 nextAttemptAt |

## 4. `confirmed_removed` 专项

### 4.1 R1：decision/evidence 事务（不释放资源）

**事务内顺序（建议实现顺序；顺序本身不构成冻结契约，Codex 可在复审时调整）：**

1. 组织/成员/权限复核（事务内重读）。
2. `validateRevokeJob(job)` + `job.revision===expectedRevision` + `state/phase/outcome/evidenceScope`。
3. `validateSnapshot(job.cleanupSnapshot, job)` + §6.1 grant/job/snapshot 绑定复核。
4. K2 op key：读 `operation_keys/<opKey>`；同键同摘要返回重放，异摘要 `CONFLICT`；K2 op domain guard。
5. K3 domain guard；读 per-job head；previous evidence 正式复核；head CAS。
6. 写新 evidence；写 head。
7. 写 job：`awaiting_result → retryable_failed`、`cleanupPhase="finalize"`、`providerOutcome="confirmed_removed"`、`finalizeAttempts:1`、`nextAttemptAt=now`、`leaseOwner/leaseExpiresAt/dispatchAuthorizedAt=null`、`revision+1`、`updatedAt=now`、result `{attempt:job.attempts,outcome:"retryable_failed",errorKind:"LOCAL_FINALIZE",reasonCode:"RECONCILE_CONFIRMED_REMOVED",finishedAt:now}`。
8. 写 reconcile log；K2 op key；audit 由 Store 写。

**refs（有 previous 时 14，无 previous 时 13；设计写 14–15，Q05）：**

```text
organizations/<orgId>
org_memberships/<actor.membershipId>
device_operation_jobs/<jobId>
device_access_grants/<job.grantId>
device_operation_evidence/<newEvidenceId>
device_operation_evidence/<head.lastEvidenceId>   // 仅当 head 非空
device_operation_evidence_heads/<headId>
evidence_digest_domains/<k3HeadId>
evidence_digest_domains/<k3VersionId>
operation_keys/<opKey>
operation_key_domains/<opHeadId>
operation_key_domains/<opVersionId>
device_operation_logs/<logId>
admin_audit/<auditId>
```

**writes：**

- job（见上）。
- evidence 新记录。
- evidence head（新建/更新 CAS）。
- K3 domain（`applyEvidenceDomain` 首次 0–2；Q02）。
- 一条 deterministic reconcile log：`deterministicLogId(jobId, "reconcile_confirmed_removed", 1)`。
- operation key：稳定指针（形状待 Q11）。
- K2 op domain（0–2）。
- audit（Store 依据 deterministic audit ref 写）。

**明确不写**：grant、slot、claim、device、guard。R1 不得调用 Provider。

### 4.2 R2：复用 H4-b `finalize`

- 调用现有 `H4MockRevoker.finalize(jobId)`（`h4b.mjs:475-481`），只走本地事务。
- H4-b 会重新读取并完整复核 job/grant/slot/claim/device/guard，做 guard CAS，按 8+N 写资源。
- Provider 0；不重发 revokeFace；不复制释放算法。
- R1 成功、R2 失败：job 保持 `retryable_failed/finalize`，H4-b `#localFinalizeFailure` 按 30/120/600 重试（实际计数冲突见 Q08）；资源不释放。
- R2 成功：job `succeeded`、grant `cleanupPending=false`、slot/claim 按 H4-b 原规则释放。
- R2 再次耗尽：`terminal_failed/LOCAL_FINALIZE_EXHAUSTED`；grant 保持 `revoked/cleanupPending=true`；C2 只投影 terminal，不提供恢复入口（C3）。

### 4.3 82/83 candidate 边界

| 场景 | 行为 | 写 | Provider |
|---|---|---|---|
| R1 预扫 N≤82 | 允许 R1 | R1 写集 | 0 |
| R1 预扫 N≥83 | `CAPACITY_EXCEEDED/400` | **0**（无 evidence/head/op key） | 0 |
| R2 N=82 | H4-b `8+82=90`，成功 | H4-b 写集 | 0 |
| R2 N=83 | H4-b `8+83=91`，进入 local-finalize pending；不半释放 | R1 已提交 + H4-b pending 写 | 0 |
| R1 后新增第 83 个 | R1 已提交；R2 见到 91，转 pending | R1 写集 + H4-b pending | 0 |

- `N` 的定义必须与 H4-b `candidateDisposition` 一致：排除 `outside`（其他设备/claim/目标自身）与 `clear`（`revoked+cleanupPending=false`）；`pending/effective/suspended/expired/revoked+cleanupPending=true` 全部计入；`invalid` 计入并使 finalize 失败关闭。
- R1 预扫只做 candidate 计数/有效性，不释放、不写 slot/claim/guard。
- R1 预扫与 R2 之间 N 增长由 R2 的 H4-b `>90` 分支兜底；R1 不得复制该分支。
- 设计冻结边界：N=82→90；N=83→91；C2 不改变。

### 4.4 pending/complete/terminal 投影

| 判定 | 来源 | HTTP | 响应 |
|---|---|---:|---|
| R2 返回 `succeeded` | H4-b finalize 返回值/事务后 job | 200 | complete |
| R2 返回 `retryable_failed` | H4-b finalize 返回值 | 202 | pending |
| R2 返回 `terminal_failed` | H4-b finalize 返回值 | 200 | terminal |
| R1 已提交、R2 未执行/响应丢失 | 事务后 job 状态 | 202 | pending；同键重放不重复 R1 |
| job 已 terminal_failed/LOCAL_FINALIZE_EXHAUSTED | 事务后 job 状态 | 200 | terminal；不提供恢复 |
| 已终态、不同键同 decision | job/head/evidence 只读投影 | 200 | duplicate:true；零写 |

`cleanupPhase` 投影：`succeeded→complete`；`retryable_failed/finalize→finalize`；`terminal_failed→terminal`。不以存储值冒充投影。

### 4.5 禁止复制释放算法

C2 只允许：

- 调用 `H4MockRevoker.finalize(jobId)`；
- 在 R1 前只读调用 H4-b `validateSnapshot`/candidate 语义；
- 在 R1 事务内只复核 job/grant/snapshot，不写资源。

C2 禁止：

- 自己按 `slotId` 写 slot/claim/device/guard；
- 自己实现 `releasedByJobId`/`releasedByAuditId`/guard epoch CAS；
- 复制 H4-b candidate 扫描后的释放分支；
- 在 R1 里预释放或“补偿”资源；
- 把 R1 的“confirmed_removed”当作资源已释放。

### 4.6 R1/R2 两段式边界

- R1 与 R2 不是同一事务；R1 的线性化点是 job revision CAS + evidence head CAS；R2 的线性化点是 H4-b job revision + guard CAS。
- R2 失败不回滚 R1；R1 的 decision/evidence 保留，job 进入 pending。
- R1 成功后 R2 之前进程崩溃：job 为 `retryable_failed/finalize`；同键重放只能投影 pending（是否允许重放触发 finalize，Q10）。
- C2 不实现“自动重试到第 4 次”的循环；C2 只做一次 R2 调用。terminal 投影只在 job 已处于 terminal 时使用；C3 才负责恢复与完整耗尽矩阵（Q08/Q20）。

## 5. `confirmed_present` 专项

**单事务：**

- 前置：§3.2 全部；`job.state="awaiting_result"`、`cleanupPhase="dispatch"`、`providerOutcome=null`、`evidenceScope="simulated"`。
- job 写：`awaiting_result → terminal_failed`、`revision+1`、`updatedAt=now`、`nextAttemptAt=null`、无 lease、result `{attempt:job.attempts,outcome:"terminal_failed",errorKind:"TERMINAL",reasonCode:"RECONCILE_CONFIRMED_PRESENT",finishedAt:now}`；`cleanupPhase` 保持 `"dispatch"`，`providerOutcome` 保持 `null`。
- grant：**不修改**；保持 `revoked/cleanupPending=true/cleanupJobId`；事务内复核 §6.1。
- slot/claim/device/guard：**不读不写**，保持原状态；不在 refs 中。
- 写：evidence、head、K3 domain、log、op key、op domain、audit；Provider 0。
- 响应：200；`jobState="terminal_failed"`、`grantState="revoked"`、`cleanupPending=true`、`cleanupPhase="terminal"`、`terminalReason="RECONCILE_CONFIRMED_PRESENT"`、`duplicate=false`。

**禁止重新派发：**

- H4-b `requeue` 只接受 `retryable_failed`，`terminal_failed` 拒绝。
- H4-b `dispatch` 只接受 `queued`；`expire` 只接受 `sending`；`terminal_failed` 不会被自动/手动推回。
- H4-c 不新增“重新清理”入口；未来重新清理必须 H4-d 新 generation/job（批准 Q2）。
- C2 测试必须覆盖 `requeue`/`dispatch`/`expire` 对 present 终态的拒绝。

## 6. `still_unknown` 专项

**单事务：**

- 前置：§3.2 全部；job 状态三件套同上。
- job：**零写**；revision/state/result/cleanupPending 不变；事务内仍读取并复核 §6.1。
- grant：**零写**；事务内读取并复核 §6.1。
- 写：evidence（sequence+1）、head CAS、K3 domain、log、op key、op domain、audit；Provider 0。
- 证据链：`sequence = head.lastSequence+1`；`previousEvidenceId = head.lastEvidenceId`；`sequence ≤ 8`。
- 频控：`now - head.updatedAt < 60_000` → `RECONCILE_THROTTLED/409`；常量 `RECONCILE_STILL_UNKNOWN_MIN_INTERVAL_MS=60_000`，不改阈值。
- 次数：`head.lastSequence ≥ 8` 再提交 still_unknown → `RECONCILE_LIMIT/409`；最终 confirmed 裁定可作为 sequence 9。
- 并发：所有提交 CAS head；同 sequence 争同一 evidence ID；后提交者 `EVIDENCE_HEAD_CONFLICT`/`CONFLICT`，不分叉；客户端用新键重试时重新读 head 并重算间隔/上限。
- 每次 still_unknown 必须使用新 `Idempotency-Key`；同键按 §7 重放。
- 响应：200；`jobState="awaiting_result"`、`grantState="revoked"`、`cleanupPending=true`、`cleanupPhase=null`、`terminalReason=null`、`duplicate=false`。

**顺序问题（Q12）：** 同键重放、60 秒频控、8 次上限三者的判定顺序设计未完全冻结；C2 不得自行选择。

## 7. K2 operation key、requestDigest、严格重放

### 7.1 method 与记录

- method 固定 `face.reconcile`；C3 的 `face.reconcile.finalize` 不在 C2。
- 复用 `service.mjs:117-151` 的 `#opContext`/`#replayValid`/`#opDomainWrites`；`reconcile` 方法必须加在同一 `FaceCredentialService` 内，或另建可复用 K2 层（Q18）。
- operation key 记录：`orgId/realm/keyVersion/requestDigest/result/createdAt`；**不保存原始 Idempotency-Key**。
- K2 domain：`operation_key_domains` 全局 head/version；缺失/单边/损坏 `DOMAIN_INCOMPLETE`；配置不符 `DOMAIN_MISMATCH`；K2 缺失 `NOT_CONFIGURED/503`。

### 7.2 requestDigest

```text
requestDigest = SHA-256(stable({
  jobId,
  expectedRevision,
  decision,
  evidence: { sourceType, sourceCode, observedAt },
  evidenceDigest,
  previousEvidenceId,
  sequence
}))
```

- `evidenceDigest` 是 §5.3 K3 HMAC 对“将写入的 evidence 记录”的预览值；不包含 `_id`/`createdAt`/`actorId`（与 C1 消息字段一致）。
- `previousEvidenceId`/`sequence` 来自事务外预读 head；事务内 head CAS 会拒绝预读后的变化。
- 规范化用 `stableValue`/`stableStringify` 或 `digestOf`，二者必须同一排序；不得用插入顺序 JSON。
- `confirmed_removed` 的 result 是**稳定指针**，不是会随 R2 变化的完整响应；同键重放返回指针的当前投影。

### 7.3 重放矩阵

| 情形 | 行为 |
|---|---|
| 同 op key、同 requestDigest | 返回已有 operation key 稳定 result/投影；不重跑 decision/evidence；Provider 0 |
| 同 op key、异 requestDigest | `CONFLICT/409`，不改写 operation key |
| operation key result 为 null/数组/错 jobId/错 decision/异常 createdAt | `CONFLICT/409`，零写 |
| 同 op key、removed R1 已提交、R2 未完成 | 202 pending；不重复 R1/Provider（是否触发 R2 见 Q10） |
| 同 op key、R2 已成功 | 200 complete 投影；核心写集不变 |
| 同 op key、R2 已耗尽 | 200 terminal 投影；C2 不提供恢复 |
| 不同 op key、已终态且 decision 相同 | `duplicate:true`，返回既有终态，零写 |
| 不同 op key、已终态且 decision 不同 | `RECONCILE_CONFLICT/409`，保留原终态 |
| job 已终态且非上述重复 | `INVALID_STATE/409`，零写 |
| 同键并发 | operation key 唯一 ID + 事务；一胜，另一重放；核心写不重复 |

### 7.4 待裁定

- `confirmed_removed` 稳定指针的精确字段（Q11）。
- `confirmed_present`/`still_unknown` 的 operation key result 形状（Q11）。
- 不同键同 decision 的 `duplicate:true` 投影来源（job/head/evidence 还是操作记录，Q11）。
- R1-pending 同键重放是否允许调用 H4-b finalize（Q10）。

## 8. K3 evidence/head 与 CAS

### 8.1 三个集合

| 集合 | 属性 | 用途 |
|---|---|---|
| `device_operation_evidence` | 组织域、带 `orgId`、不可变 create-only | 每条证据的不可变记录 |
| `device_operation_evidence_heads` | 组织域、带 `orgId`、每 job 一条 | 原子 head/CAS、链尾、间隔/次数 |
| `evidence_digest_domains` | 全局部署域、无 `orgId` | K3 稳定 head + 版本历史，防同版本换钥 |

三个集合在 C1 已登记到 `store.mjs` 的 `collections`、`seed()`、`init()`；C2 预计不再改 Store（除非 Q02/Q03 要求改 C1 语义，那属于 C1 返工，不属于 C2）。

### 8.2 evidence 记录

字段白名单（C1 `:36`）：

```text
_id, orgId, jobId, schemaVersion, sequence,
decision, sourceType, sourceCode, observedAt,
digestDomain, digestAlgorithm, digestAlgorithmVersion,
keyRealm, keyVersion, keyFingerprint, digest,
previousEvidenceId, evidenceScope, actorId, createdAt
```

关键约束：

- `_id = h4c-evidence-v1:<sha256([orgId,jobId,sequence]) 前 32 hex>`。
- `sequence` 1..9；still_unknown 最多 8；最终 confirmed 可到 9。
- `sourceType` 固定 `operator`；`sourceCode` 与 decision 绑定。
- `observedAt`：`job.createdAt ≤ observedAt ≤ now`，且 `observedAt ≥ job.result.finishedAt`；24h 上限见 Q13。
- `digest` 服务端 HMAC-SHA256；客户端不得提交。
- `previousEvidenceId` 第一条 `null`，否则必须等于 head 的 `lastEvidenceId`。
- `evidenceScope` 固定 `simulated`；`actorId` 有界；`createdAt` 服务端时间。
- 单条 ≤4096 bytes；未知字段/空白 ID/控制字符/非安全整数 `EVIDENCE_INVALID/409`。

### 8.3 head 记录与 CAS

字段白名单（C1 `:37`）：`_id, orgId, jobId, revision, lastSequence, lastEvidenceId, lastObservedAt, createdAt, updatedAt`。

事务内算法（设计 §5.4）：

1. 预读 head（可能 null）；按 `(orgId,jobId)` 检查是否已有 evidence（只用于识别“head 缺失但链存在”的损坏）。
2. refs 包含 head（新建/更新）、新 evidence；head 已存在时还包含 previous evidence。
3. 事务内先 K3 `applyEvidenceDomain`，再重读 head：
   - 预读 null：head 必须仍 null，且该 job 无既有 evidence；否则 `EVIDENCE_CHAIN_BROKEN/409`。
   - 预读非 null：head 必须存在，`revision/lastEvidenceId/lastSequence` 完全匹配；否则 `EVIDENCE_HEAD_CONFLICT/409`（消失/被替换为 `EVIDENCE_CHAIN_BROKEN`）。
4. head 非空：读取 previous，逐项校验 `validateEvidenceRecord`、`_id/orgId/jobId/sequence/observedAt`、K3 realm/version/fingerprint、`timingSafeEqual` 重算 HMAC；任一异常 `EVIDENCE_CHAIN_BROKEN/409`。
5. 第一条：head `lastSequence=0/lastEvidenceId=null`，新 evidence `sequence=1/previousEvidenceId=null`；否则 `EVIDENCE_CHAIN_BROKEN/409`。
6. 非第一条：`sequence=head.lastSequence+1`；`previousEvidenceId=head.lastEvidenceId`；确定性 ID 已存在 → `CONFLICT/409`（C1 对 sequence 1 返回 `EVIDENCE_CHAIN_BROKEN`，Q16）。
7. 写 evidence + head：`lastSequence/lastEvidenceId/lastObservedAt` 更新，`revision+1`，`updatedAt=now`。
8. 并发不同键：只有一个 head CAS 提交；失败方 `EVIDENCE_HEAD_CONFLICT/409`；同键重放在 op key 层返回。

### 8.4 空 head 的原子证明

C1 `appendEvidenceWrites` 在 `expectedHead=null` 时只要求：

- 事务内 head 为 null；
- `hasExistingEvidence === false`；
- 新 sequence=1 的确定性 evidence ID 不存在。

它**没有**在事务内枚举该 job 的所有 9 个可能 evidence ID。若 head 被删除但 sequence 2..9 的 evidence 仍存在，且调用方预读 `hasExistingEvidence=false`，C1 只检查 sequence 1，可能留下孤儿链。设计 §5.4 要求“head 缺失但已有 evidence → EVIDENCE_CHAIN_BROKEN”，但 C1 的原子性依赖调用方预读。C2 必须解决：见 Q04（声明 9 个确定性 evidence refs 并逐个判空，或由 C1 提供原子 helper）。

### 8.5 错误

- `EVIDENCE_INVALID`：schema/字段/来源/摘要格式/大小。
- `EVIDENCE_STALE`：时间早于 unknown、未来、超 24h、非递增。
- `EVIDENCE_HEAD_CONFLICT`：head CAS 失败。
- `EVIDENCE_CHAIN_BROKEN`：head 缺失但链存在、head 消失、previous 不符、HMAC 不符。
- `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH`：K3 domain 单边/损坏/换钥。
- `CONFLICT`：op key/日志/audit/evidence ID 预占。

## 9. TOCTOU 与 create-only/CAS 线性化点

### 9.1 逐处 TOCTOU

| ID | 事务外预读/检查 | 事务内复核 | 线性化点 | 失败结果 | 写 |
|---|---|---|---|---|---|
| T01 | `#require` 读 org/membership | state 中 org/membership 重读 | 事务提交 | `FORBIDDEN/403` | 0 |
| T02 | `store.get(job, orgId)` | job ref 重读 + `validateRevokeJob` | job revision CAS | `NOT_FOUND`/`INVALID_JOB` | 0 |
| T03 | `expectedRevision` | `job.revision===expectedRevision` | job revision CAS | `REVISION_CONFLICT/409` | 0 |
| T04 | job state/phase/outcome 预读 | 事务内重读 | job revision CAS | `INVALID_STATE/409` | 0 |
| T05 | `validateSnapshot` 预读 | 事务内重读 + 绑定 | job/grant 提交 | `CLEANUP_SNAPSHOT_REQUIRED/409` | 0 |
| T06 | grant 预读（响应/refs） | grant ref 重读 + §6.1 | job revision CAS | `INVALID_STATE`/`CLEANUP_SNAPSHOT_REQUIRED` | 0 |
| T07 | head 预读（sequence/refs） | head ref 重读 + CAS | head CAS | `EVIDENCE_HEAD_CONFLICT/409` | 0 |
| T08 | previous evidence 预读（refs） | previous ref 重读 + validator/HMAC | head CAS | `EVIDENCE_CHAIN_BROKEN/409` | 0 |
| T09 | K3 domain 预读 | `applyEvidenceDomain` | domain create/校验 | `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH` | 0 |
| T10 | 新 evidence ID 预计算 | 事务内 create-only 判空 | evidence create | `CONFLICT`/`EVIDENCE_CHAIN_BROKEN` | 0 |
| T11 | `hasExistingEvidence` 预读 | C1 只查 sequence 1（缺口） | head/evidence create | `EVIDENCE_CHAIN_BROKEN`（不完整） | 0；Q04 |
| T12 | K2 opKey 预计算 | op key ref 重读 | op key create | 重放/`CONFLICT` | 0 |
| T13 | K2 op domain 预读 | `applyOperationKeyDomain` | domain create/校验 | `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH` | 0 |
| T14 | log/audit ID 预计算 | 事务内 create-only 判空 | log/audit create | `CONFLICT` | 0 |
| T15 | candidate N 预扫 | R1 不复核；R2 H4-b 复核 | R2 H4-b 8+N | `CAPACITY_EXCEEDED`/pending | 0（R1 拒绝） |
| T16 | R1 前 slot/claim/device/guard 只读 | R1 不复核（不在 refs）；R2 H4-b 复核 | R2 H4-b job+guard CAS | `CLEANUP_SNAPSHOT_REQUIRED`/`DEVICE_CLAIM_INVALID` | R1 不写；R2 失败 pending |
| T17 | R1 提交 | R2 独立事务 | R1 job/head CAS；R2 H4-b job/guard CAS | 两段式；R2 失败不回滚 R1 | 见 R1/R2 |
| T18 | unknown 60s/次数预读 | head ref 重读 | head CAS | `RECONCILE_THROTTLED`/`RECONCILE_LIMIT` | 0 |
| T19 | 终态 duplicate 预读 | job/head/evidence 只读 | 无写 | `duplicate:true`/`RECONCILE_CONFLICT` | 0 |
| T20 | 同键并发 | op key 唯一 ID + 事务 | op key create | 一胜一重放 | 0 重复 |

### 9.2 create-only/CAS 表

| 对象 | 机制 | 线性化点 | 备注 |
|---|---|---|---|
| job | `revision` CAS | 事务提交 | C2 显式 `expectedRevision` |
| grant | 读 + 精确字段；R1 不写 | 事务提交 | R2 H4-b 写 `cleanupPending=false` + revision+1 |
| evidence | 确定性 ID create-only | 事务提交 | Store `createOnlyCollections` |
| evidence head | `revision/lastEvidenceId/lastSequence` CAS | 事务提交 | Store exact write；可更新 |
| K3 domain head | create-only | 事务提交 | `3fce9b0` realm 作用域；Q03 |
| K3 domain version | create-only | 事务提交 | 版本记录 |
| K2 op key | 确定性 `opKey` create-only | 事务提交 | 同键重放 |
| K2 op domain | create-only | 事务提交 | head/version |
| log | 确定性 ID create-only | 事务提交 | `deterministicLogId` |
| audit | 确定性 ID create-only | 事务提交 | Store 写 |
| slot/claim/guard | H4-b 原 CAS | R2 H4-b 事务 | C2 不复制 |

### 9.3 R1/R2 两段式线性化

```text
R1 提交：decision + evidence + head + K2 + log/audit 的线性化
R2 提交：资源释放（job succeeded/grant cleanupPending=false/slot/claim/guard）的线性化
R2 失败：不回滚 R1；job 进入 pending；资源不释放
```

任何路径不得把 R1 的“已确认删除”当作资源已释放；任何路径不得在 R1 写 grant/slot/claim/device/guard。

## 10. 预计修改文件与提交拆分

### 10.1 C2-1：服务接口与只读校验

**目标**：建立可复审的服务入口和只读校验，不写业务状态。

| 文件 | 变更 | 说明 |
|---|---|---|
| `admin-web/lib/face-service/dto.mjs` | 新增 `assertReconcileInput` | 严格白名单；`PARAM_ERROR`/`EVIDENCE_INVALID`/`EVIDENCE_REQUIRED`（Q14） |
| `admin-web/lib/face-service/h4c-reconcile.mjs` | 新建；只读 context/refs/preview | 不调用 `store.transact`；不写 audit |
| `admin-web/lib/face-service/service.mjs` | 新增 `reconcile(jobId, input, {idempotencyKey})` 只读路径 | 复用 `#require`/`#opContext`/`#replayValid`；不写 |
| `admin-web/lib/face-service/index.mjs` | 导出 `h4c-reconcile.mjs` | 与 C1 一致的 export 方式 |
| `admin-web/tests/face-h4c-reconcile.test.mjs` | 新建 C2-1 用例 | 权限/DTO/404/revision/state/snapshot/K2/K3 配置/Provider 0/零写 |

**C2-1 不做**：job/evidence/head 写、K2 op key 写、audit、R2 调用、三种 decision 分支。

### 10.2 C2-2：三种 decision

| 文件 | 变更 | 说明 |
|---|---|---|
| `admin-web/lib/face-service/h4c-reconcile.mjs` | 增加 refs/writes builders、response 投影 | R1/present/unknown；R2 只调用 H4-b |
| `admin-web/lib/face-service/service.mjs` | `reconcile` 接入 `store.transact` + R2 | K2 重放、审计、错误映射 |
| `admin-web/lib/face-service/h4b.mjs` | 仅按 Q06 导出 `validateSnapshot`/`candidateDisposition` | 不改行为；若 Codex 不允许，改走等价 helper |
| `admin-web/lib/face-service/index.mjs` | 无需新增（若 h4c-reconcile 已导出） | — |
| `admin-web/tests/face-h4c-reconcile.test.mjs` | 增加 decision 用例 | C2-2 定向 |

**C2-2 不做**：finalize-retry、generation、RC61–RC73、HTTP、Provider。

### 10.3 C2-3：测试与并发证据

| 文件 | 变更 | 说明 |
|---|---|---|
| `admin-web/tests/face-h4c-reconcile.test.mjs` | 补齐 RC01–RC60 | 内容级快照、并发、ack loss、82/83、Provider 0、敏感扫描 |
| `docs/tasks/` | C2 交付证据文档（名称待定） | 仅 C2 完成后；不是本卡产物 |

**C2-3 验收**：H4-c 定向全绿；Admin 全量全绿；根测试全绿；Provider/网络/设备/HTTP 注册 0；失败路径内容级零写；响应/日志/审计/持久化敏感扫描 0 命中。

### 10.4 不修改

`admin-web/server.mjs`、`admin-web/lib/face-service/routes.mjs`、`admin-web/lib/org.mjs`、`admin-web/lib/store.mjs`（C1 已登记；若 Q02/Q03 要求改语义，属于 C1 返工，不属于 C2）、`admin-web/package.json`、根 `package.json`、C1 既有测试。

## 11. RC01–RC60 实现映射

> 说明：`C2-1` 只读校验；`C2-2` 事务/decision；`C2-3` 测试与并发证据。`C1×` 表示 C1 已有 helper/单元覆盖但仍需 C2 服务级用例。`H4-b×` 表示复用 H4-b 既有测试/实现。RC 文本按设计 §15 压缩。

| RC | 场景 | C2 落点 | 实现路径 | 测试归属 | 复用 |
|---|---|---|---|---|---|
| RC01 | removed 成功 | C2-2 | R1+ R2 | C2-3 新增 | H4-b finalize |
| RC02 | present | C2-2 | 单事务 terminal | C2-3 新增 | C1 append |
| RC03 | unknown | C2-2 | 单事务 append | C2-3 新增 | C1 append |
| RC04 | 缺 reconcile 权限 | C2-1 | `#require`+事务内 membership | C2-1/3 | 无 |
| RC05 | 跨组织/不存在 | C2-1 | `store.get(...,orgId)` | C2-1/3 | 无 |
| RC06 | expectedRevision 过期 | C2-1/2 | job revision CAS | C2-1/3 | 无 |
| RC07 | job 非 awaiting_result | C2-1 | state 预检+事务内 | C2-1/3 | `validateRevokeJob` |
| RC08 | 请求/evidence 多字段 | C2-1 | `assertReconcileInput` | C2-1/3 | 无 |
| RC09 | 非法 decision | C2-1 | DTO 枚举 | C2-1/3 | 无 |
| RC10 | evidence 缺字段/类型/sourceCode 不匹配 | C2-1/2 | DTO + C1 validator | C2-1/3 | C1× |
| RC11 | observedAt 早于 finishedAt | C2-2 | C1 append floor | C2-3 | C1× |
| RC12 | observedAt 未来/超 24h/旧 schema | C2-2 | C1 + 24h（Q13） | C2-3 | C1× 部分 |
| RC13 | 同键同摘要 | C2-2 | K2 `#replayValid` | C2-3 | 无 |
| RC14 | 同键异摘要 | C2-2 | `CONFLICT` | C2-3 | 无 |
| RC15 | op result 损坏 | C2-2 | `#replayValid` | C2-3 | 无 |
| RC16 | K2 缺失/非法 | C2-1 | `operationKeyConfig` | C2-1/3 | 无 |
| RC17 | K2 domain 单边 | C2-2 | `applyOperationKeyDomain` | C2-3 | 无 |
| RC18 | K2 换钥 | C2-2 | domain mismatch | C2-3 | 无 |
| RC19 | 共享设备另一 active grant | C2-2 R2 | H4-b candidate | C2-3 | H4-b× |
| RC20 | 82 candidates/90 refs | C2-2 R2 | H4-b 8+N | C2-3 | H4-b× |
| RC21 | 83 candidates 预扫 | C2-2 R1 | `CAPACITY_EXCEEDED` | C2-3 | H4-b× 语义 |
| RC22 | R1 后新增第 83 | C2-2 R2 | H4-b >90 pending | C2-3 | H4-b× |
| RC23 | guard/claim 在读取后变化 | C2-2 R2 | H4-b guard CAS | C2-3 | H4-b× |
| RC24 | 本 job 合法墓碑 | C2-2 R2 | H4-b | C2-3 | H4-b× |
| RC25 | 其他 job/部分墓碑 | C2-2 R2 | H4-b `DEVICE_CLAIM_INVALID` | C2-3 | H4-b× |
| RC26 | R2 第 4 次耗尽 | C2-2/C3 | H4-b `#localFinalizeFailure`；Q08 | C2-3 投影；C3 完整 | H4-b× |
| RC27 | Provider 恒 0 | C2-1/2/3 | 无 Provider 调用；spy | C2-3 | 无 |
| RC28 | R1 后同键重放 | C2-2 | 202/200 投影；Q10 | C2-3 | 无 |
| RC29 | present grant 保持 | C2-2 | 不写 grant | C2-3 | C1× |
| RC30 | present 后 requeue/retry | C2-3 | H4-b 拒绝 | C2-3 | H4-b× |
| RC31 | 已终态不同 decision | C2-2 | `RECONCILE_CONFLICT` | C2-3 | 无 |
| RC32 | 已终态同 decision 新键 | C2-2 | `duplicate:true`；Q11 | C2-3 | 无 |
| RC33 | present 投影 | C2-2 | response projection | C2-3 | 无 |
| RC34 | unknown job 不变 | C2-2 | job 零写 | C2-3 | C1× |
| RC35 | 60s 内第二次 unknown | C2-2 | `RECONCILE_THROTTLED`；Q12 | C2-3 | 无 |
| RC36 | 第 9 次 unknown | C2-2 | `RECONCILE_LIMIT`；sequence 9 | C2-3 | C1× |
| RC37 | observedAt 非递增/链断 | C2-2 | C1 previous validator；Q15 | C2-3 | C1× |
| RC38 | unknown 同键重放 | C2-2 | K2 replay | C2-3 | 无 |
| RC39 | unknown 新键 | C2-2 | sequence+1 | C2-3 | C1 append |
| RC40 | 两并发同键 | C2-3 | op key unique | C2-3 | 无 |
| RC41 | 两并发不同 decision | C2-3 | job revision/head CAS | C2-3 | 无 |
| RC42 | R2 vs H4-b finalize | C2-3 | H4-b revision | C2-3 | H4-b× |
| RC43 | reconcile vs expire | C2-3 | 状态互斥 | C2-3 | H4-b× |
| RC44 | R2 vs createGrant/guard | C2-3 | H4-b guard CAS | C2-3 | H4-b× |
| RC45 | callback 重跑 | C2-3 | deterministic IDs create-only | C2-3 | 无 |
| RC46 | 任一失败路径 | C2-3 | 内容级 Z | C2-3 | 无 |
| RC47 | ID 预占 | C2-3 | `CONFLICT`；Q16 | C2-3 | 无 |
| RC48 | 敏感字段注入 | C2-3 | 扫描零命中 | C2-3 | 无 |
| RC49 | Cloud/live/Provider/设备 | C2-1 | `NOT_CONFIGURED` | C2-1/3 | 无 |
| RC50 | 老 job 缺 snapshot | C2-1 | `CLEANUP_SNAPSHOT_REQUIRED`；Q17 | C2-1/3 | `validateSnapshot` |
| RC51 | 缺 guard/损坏 slot/claim/guard | C2-1/2 | R1 只读 + R2 H4-b | C2-3 | H4-b× |
| RC52 | 响应字段扫描 | C2-2 | 最小 DTO | C2-3 | 无 |
| RC53 | K3 head/version 单边 | C2-2 | `DOMAIN_INCOMPLETE`；Q02/Q03 | C2-3 | C1× |
| RC54 | K3 同版本换钥 | C2-2 | `DOMAIN_MISMATCH` | C2-3 | C1× |
| RC55 | K3 domain 内部矛盾 | C2-2 | `DOMAIN_INCOMPLETE` | C2-3 | C1× |
| RC56 | head 缺失但 evidence 存在 | C2-2 | `EVIDENCE_CHAIN_BROKEN`；Q04 | C2-3 | C1× |
| RC57 | 两并发不同键争 head/sequence | C2-3 | head CAS | C2-3 | C1× |
| RC58 | grant 预读后变化 | C2-2 | 事务内 grant 复核 | C2-3 | 无 |
| RC59 | grant cleanupJobId/binding 不符 | C2-2 | §6.1 | C2-3 | `validateSnapshot` |
| RC60 | sourceType=mock_provider | C2-1 | DTO + C1 validator | C2-1/3 | C1× |

## 12. C3 专属 RC61–RC73（仅 C3 实施与验收）

| RC | 内容 | 归属 | C2 禁止 |
|---|---|---|---|
| RC61 | finalize-retry 成功 | C3 | 不实现 `reconcileFinalize`/`face.reconcile.finalize` |
| RC62 | finalize-retry 权限/CAS/同键重放 | C3 | 不实现恢复权限分支 |
| RC63 | finalize-retry 再次耗尽 | C3 | 不实现 generation 重开 |
| RC64 | 200/202/terminal/ack-loss/不同键重复投影 | C3 终审 | C2 只覆盖三种 decision 的投影 |
| RC65 | finalize-retry 同 generation 并发 | C3 | 不实现 generation CAS |
| RC66 | finalize-retry 确认丢失同键重放 | C3 | 不实现四字段 K2 result |
| RC67 | finalize-retry 新 revision + 新键 | C3 | 不实现 `RECONCILE_GENERATION_CONSUMED` |
| RC68 | finalize-retry 旧 revision | C3 | 不实现 generation consumed |
| RC69 | previous evidence 跨 job/org/_id | C3 终审；C1 已有单元 | C2 不宣称完成 |
| RC70 | previous evidence 缺字段/未知字段/schema | C3 终审；C1 已有单元 | C2 不新增 schema 放宽 |
| RC71 | previous evidence sequence/lastObservedAt/head 不一致 | C3 终审；C1 已有单元 | C2 不复制链规则 |
| RC72 | previous evidence K3/HMAC 不符 | C3 终审；C1 已有单元 | C2 不绕过 HMAC |
| RC73 | 第一条 evidence head=0/null、sequence=1；反向 | C3 终审；C1 已有单元 | C2 不改变首条规则 |

**C3 硬边界**：C2 不新增 `finalize-retry` 服务方法、不新增 `face.reconcile.finalize`、不新增 `(jobId, expectedRevision)` generation、不新增 9 refs 恢复事务、不新增四字段 K2 result、不新增 `RECONCILE_GENERATION_CONSUMED` 分支、不提供“耗尽后人工恢复”的响应。C2 只允许在 `confirmed_removed` 中调用一次 H4-b `finalize` 并投影其结果。

## 13. 待 Codex 裁定项

> 以下均为 C2 开始前必须裁定的问题。本卡只列事实与选项，**不自行裁定**。

### Q01 C1 基线选择与 C1 正式通过

- 事实：`3fce9b0` 无批准文档；分支 tip `6dbc9e0` 自述对 `3fce9b0` 两项 P0 返工并等待 Codex 复审；`6dbc9e0` 的 C1 review evidence 明确“复审前不开始 C2/C3”。
- 选项：A）批准 `3fce9b0`；B）批准 `6dbc9e0`；C）要求继续返工 C1；D）指定其他 commit。
- 影响：C2 的全部 API/refs/K3 语义都依赖此选择；未选定前 G1 不通过，C2 不开始。

### Q02 K3 domain 首次创建：隐式 vs 显式初始化

- 设计 §5.3（`b15aceb:193-199`）：head/version 都不存在时，本次事务创建 head+version（refs 已声明），writes 0–2。
- C1 `3fce9b0`：`applyEvidenceDomain` 双缺失时直接返回两条 create 写（`:244-258`）；`appendEvidenceWrites` 先调用它（`:355`）。
- C1 返工 `6dbc9e0`：`applyEvidenceDomain` 只读、双缺失 `DOMAIN_INCOMPLETE`；新增显式 `initializeEvidenceDomain`；`appendEvidenceWrites` 不再创建 domain。C1 review 把 `3fce9b0` 的隐式创建列为 P0-1（domain 被删除后可回填）。
- 选项：A）保留设计/`3fce9b0` 的隐式创建；B）采纳 `6dbc9e0` 的显式初始化并修改设计；C）其他。
- 影响：R1/present/unknown 的 K3 writes 是 0–2 还是 0；C2-1 只读校验能否使用 `applyEvidenceDomain`；RC53–RC55。

### Q03 K3 head ID 作用域：realm vs 全局

- 设计 §5.3（`b15aceb:184`）：`evidence-digest-domain:<base64url(realm)>`，realm 作用域。
- C1 `3fce9b0`：`evidenceDomainIds` 按 realm 生成（`:92-98`）。
- C1 返工 `6dbc9e0`：固定 `EVIDENCE_DOMAIN_HEAD_ID="evidence-digest-domain:v1:global"`（`:38`），version 受同一 head 约束；C1 review 把 realm 作用域列为 P0-2（切 realm 可形成并行域）。
- 选项：A）保留设计/`3fce9b0`；B）采纳 `6dbc9e0` 并修改设计；C）其他。
- 影响：K3 refs/ID/domain guard/换 realm 测试；RC53–RC55。

### Q04 head 为空时如何原子证明“无既有 evidence”

- 设计 §5.4（`b15aceb:222-226`）要求：预读 null 时，事务内 head 必须仍 null 且该 job 无既有 evidence；否则 `EVIDENCE_CHAIN_BROKEN`。
- C1 `appendEvidenceWrites`（`:359-361`）只信调用方 `hasExistingEvidence`；事务内只检查新 sequence=1 的 evidence ID（`:405-407`）。若 head 被删除但 sequence 2..9 仍存在，C1 可能留下孤儿链。
- 选项：A）C2 在 refs 中声明该 job 全部 9 个确定性 evidence ID，并逐个判空；B）C1 提供原子 `assertNoExistingEvidence(state, job)` / per-job marker；C）接受预读竞态并在 C2 文档承认。
- 影响：R1/present/unknown refs 从 13/14 增至 21/22（用 9 个确定性 ID 替换原来的新 ID）；若额外保留新 ID 则 22/23；仍远低于 90 上限；RC56/RC47；C2-1 只读校验。

### Q05 refs 计数：设计 14–15 vs 逐项 13/14

- 设计 §6.2/§8.1 写 R1/present/unknown “14–15”，但按列出的 refs 去重：无 previous 13，有 previous 14。差的 1 条未在设计中说明。
- 选项：A）设计笔误，按 13/14；B）还有一条未列出的 ref（请指出）；C）把 previous 永远计入 refs（即使 null）得到 14/15。
- 影响：refs 计数、90 上限测试、文档一致性；不影响业务语义但影响“逐项”验收。

### Q06 H4-b 共享面导出范围

- `validateSnapshot` 私有（`h4b.mjs:62`）；`candidateDisposition` 私有（`:176`）。
- C2 R1 需要两者；设计 §6.5 只说 `validateSnapshot` “编码时导出为共享函数或等价调用”，未说 `candidateDisposition`。
- 选项：A）导出两者；B）只导出 `validateSnapshot`，candidate 用等价只读 helper；C）都不导出，C2 复制语义。
- 影响：C2-1/2 实现、H4-b 文件变更审批、82/83 语义一致性。

### Q07 H4-b/C1 validator 错误码归一

- `validateSnapshot` 内部 `assertBoundedId`/`assertSafeInt` 抛 `PARAM_ERROR`（`collections.mjs:407-419`），不会统一成 `CLEANUP_SNAPSHOT_REQUIRED`。
- `validateRevokeJob` 对 `revision/attempts/finalizeAttempts/createdAt` 等用 `assertSafeInt`，非法时也是 `PARAM_ERROR`，而设计 §10 期望 `INVALID_JOB/409`。
- C1 `appendEvidenceWrites` 对 job 缺 `createdAt/finishedAt` 抛 `EVIDENCE_INVALID`（`:343-350`），设计 §10 期望 `INVALID_JOB/409`。
- 选项：A）C2 在外层 catch 并映射为设计错误码；B）修改 H4-b/C1 validator 的错误码；C）接受 `PARAM_ERROR` 并修改设计。
- 影响：RC07/RC10/RC50/RC51、错误码总表、零写断言。

### Q08 `finalizeAttempts=1` 与 H4-b 退避/耗尽计数

- 设计 §6.2（`b15aceb:320`）：人工 removed 视为第 1 次 finalize，`finalizeAttempts=1`；H4-b 允许 1..3 重试，第 4 次耗尽；30/120/600。
- H4-b `DELAYS=[30_000,120_000,600_000]`（`h4b.mjs:24`）；`#localFinalizeFailure` 取 `attempts=current.finalizeAttempts+1`，`attempts>=4` 才 terminal，否则 `DELAYS[attempts-1]`（`:438-453`）。
- 若 R1 设 1：R2 第 1 次失败→attempts=2→延迟 120s；第 2 次→3→600s；第 3 次→4→terminal。即只有 3 次 R2 调用，首次延迟 120s，与“30/120/600 + 第 4 次耗尽”不一致。
- 选项：A）R1 设 0 并在 H4-b 允许 finalize 起始 0（需改 validator）；B）H4-b 对 reconcile 首轮特判 30s/计数；C）接受 120s/3 次并修改设计；D）R1 视为第 1 次但不计入 R2 调用（需明确“第 4 次”口径）。
- 影响：RC26、pending/terminal 时间、H4-b 复用边界。**这是 C2-2 的阻断项。**

### Q09 R2 非耗尽错误如何投影

- `H4MockRevoker.finalize` 前置失败抛 `INVALID_JOB`/`RETRY_NOT_DUE`（`:475-481`）；`#finalize` 内部多数错误转 `#localFinalizeFailure`，但 `#localFinalizeFailure` 自身可能抛 `INVALID_JOB`；`LEASE_FENCE_REJECTED` 会抛。
- 设计 §13 只给 complete/pending/terminal；未给 R2 抛错时的映射。
- 选项：A）任何本地失败→202 pending；B）`INVALID_JOB`/`RETRY_NOT_DUE`→409，资源不释放；C）其他。
- 影响：RC28/RC42、错误码、响应矩阵。

### Q10 R1-pending 同键重放是否允许触发 R2

- 设计 §7.2（`b15aceb:398`）：“同 op key、R1 已提交、R2 未完成 → 202 pending 投影；不重复 R1/Provider；H4-b 恢复路径完成。” “恢复路径完成”是否意味着重放请求可调用 `finalize`，未冻结。
- 选项：A）重放只读投影 202，不调用 finalize；B）重放可调用一次本地 finalize 推进；C）由独立入口推进（C3）。
- 影响：RC28/ack loss、Provider 0、C2/C3 边界。

### Q11 K2 result 指针形状与 duplicate 投影

- 设计 §7（`b15aceb:412`）只冻结 removed “稳定指针（decision/evidenceId/sequence）”，未给 exact JSON；present/unknown 的 result 未冻结。
- 不同键同 decision 的 `duplicate:true` 需要 evidenceId/sequence/decidedAt；来源未冻结（job/head/evidence/operation key）。
- 选项：A）统一 `{decision,jobId,evidenceId,sequence}`；B）再加 `jobState`；C）duplicate 从 head/evidence 只读投影。
- 影响：`#replayValid` 精确深等、RC13/RC28/RC32、响应字段。

### Q12 unknown 的 replay/60s/8 次判定顺序

- 设计 §6.4（`:342-345`）与 §7.2（`:395`）分别要求频控、上限、同键重放；未冻结优先级。
- 选项：A）同键重放优先，然后 60s，然后 8 次；B）60s 优先；C）8 次优先。
- 影响：RC35/RC36/RC38、错误码。

### Q13 `EVIDENCE_STALE` 的 24 小时上限

- 设计 §11（`:505`）与 RC12 提到“超 24h”；设计 §5.2 只写 `job.createdAt ≤ observedAt ≤ now`；C1 `:348-351` 只做 floor/now，没有 24h。
- 选项：A）C2 增加 24h 下限；B）C1 增加；C）不实现 24h（以设计 §5.2 为准）。
- 影响：RC12、`EVIDENCE_STALE` 语义。

### Q14 缺 evidence 的错误码

- 设计 §11（`:503`）有 `EVIDENCE_REQUIRED/409`；C1 validator 不产生该码；DTO 层通常 `PARAM_ERROR/400` 或 `EVIDENCE_INVALID/409`。
- 选项：A）DTO 缺 evidence → `EVIDENCE_REQUIRED/409`；B）`PARAM_ERROR/400`；C）`EVIDENCE_INVALID/409`。
- 影响：RC10、错误码。

### Q15 observedAt 单调性：允许相等还是严格递增

- 设计 RC37 写“非递增”；C1 `:396` 只在 `observedAt < previous.observedAt` 时 `EVIDENCE_STALE`，相等允许。
- 选项：A）严格递增（相等 stale）；B）非递减（相等允许，C1 现状）。
- 影响：RC37、evidence 链。

### Q16 sequence=1 evidence ID 预占的错误码

- 设计 §5.4 第 6 步（`:235`）：“若已存在 → CONFLICT/409”。
- C1 `:405-407`：sequence 1 已存在 → `EVIDENCE_CHAIN_BROKEN`；其他 sequence → `CONFLICT`。
- 选项：A）按设计统一 `CONFLICT`；B）保留 C1 的首条链损坏语义；C）按场景区分。
- 影响：RC47、`EVIDENCE_CHAIN_BROKEN`/`CONFLICT` 测试。

### Q17 C1 job 错误码 vs 服务层 `INVALID_JOB`

- C1 `appendEvidenceWrites` 对缺 `job.createdAt/finishedAt` 抛 `EVIDENCE_INVALID`（`:343-350`）；设计 §10 期望 `INVALID_JOB/409`。
- 选项：A）C2 先 `validateRevokeJob`，把该路径挡在 `INVALID_JOB`；B）C1 改错误码；C）接受 `EVIDENCE_INVALID`。
- 影响：RC50、错误码、C1/C2 边界。

### Q18 服务入口形状与 H4-b finalizer 依赖

- `FaceCredentialService` 的 K2 方法是私有（`service.mjs:117-151`）；`H4MockRevoker` 构造器要求 `LocalStore` + `MockFaceAccessProvider`（`h4b.mjs:188-195`）。
- 选项：A）在 `FaceCredentialService` 加 `reconcile(jobId, input, {idempotencyKey})`，构造器注入 `revoker`/factory；B）新建独立 `H4cReconcileService`，自带 K2（有复制风险）；C）在 service 内直接 `new H4MockRevoker`（需 provider/store 满足）。
- 另：202 在服务层如何表示（`{status:202,data}` vs 抛错 vs 返回 `httpStatus`）未冻结。
- 影响：C2-1 接口、测试、HTTP 未来接线。

### Q19 audit/log 的确定性字段

- 设计 §8.4（`:443-455`）冻结 evidence/head/K3/log/audit ID 公式；未冻结 audit `action` 文本、`jobRevision` 取迁移前还是迁移后、log `eventToken`/`occurrence` 的 exact 组合。
- 选项：A）audit 用 `job.revision+1`（目标 revision）；B）用迁移前；C）由 Codex 给 exact 文本。
- 影响：RC45/RC47、确定性 ID 测试、审计可追溯。

### Q20 C2/C3 测试归属

- RC69–RC73 是 previous evidence 链，C1 已有单元；但设计把它们放在 RC61–RC73，C3 负责“完整矩阵”。
- RC26 terminal 在 C2 只有一次 R2 调用时不可自然到达；需要靠 C3 恢复/多次 finalize 或测试直接驱动 H4-b。
- 选项：A）C2 只覆盖 RC01–RC60，RC69–RC73 由 C3 重跑；B）C2 也声明 RC69–RC73 的服务级用例；C）RC26 归 C3。
- 影响：C2-3 验收范围、C3 启动条件。

## 14. 检查命令与结果

### 14.1 冻结引用

```powershell
git cat-file -t b15aceb
git cat-file -t ed7b66f
git cat-file -t 3fce9b0
git cat-file -t 1155b7ba65991d324fb8b22bb8f7dd87f49428f9
git rev-parse --verify docs/hk-face-h4c-reconciliation-design
git rev-parse --verify origin/docs/lock-01-fast-track
git rev-parse --verify feat/hk-face-h4c-reconciliation
```

结果：

| 命令 | 结果 |
|---|---|
| `git cat-file -t b15aceb` | `commit` |
| `git cat-file -t ed7b66f` | `commit` |
| `git cat-file -t 3fce9b0` | `commit` |
| `git cat-file -t 1155b7ba...` | `commit` |
| design 分支 tip | `b15acebe0a8049f316797bbbd2692c55de25d111` |
| approval 分支 tip | `ed7b66f84c79339246a81ea76762cc388d7f4778` |
| C1 分支 tip | `6dbc9e07616ccd2d33734f53f8c71ba18f6d6ac1`（核对对象仍为 `3fce9b0`） |

### 14.2 文件可解析

```powershell
git cat-file -e b15aceb:docs/tasks/HK-AI-04-H4C-RECONCILIATION-DESIGN.md
git cat-file -e ed7b66f:docs/tasks/HK-AI-04-H4C-DESIGN-APPROVAL-B15ACEB-2026-11-14.md
git cat-file -e ed7b66f:docs/tasks/HK-AI-04-H4C-IMPLEMENTATION-TASK-2026-11-14.md
git cat-file -e 3fce9b0:admin-web/lib/face-service/h4c-evidence.mjs
git cat-file -e 3fce9b0:admin-web/tests/face-h4c-evidence.test.mjs
git cat-file -e 1155b7b:admin-web/lib/face-service/h4b.mjs
```

结果：全部 exit 0（文件存在）；设计 741 行、批准 38 行、实现任务 48 行、C1 模块 452 行、C1 测试 1007 行、H4-b 549 行。

### 14.3 祖先关系

```powershell
git merge-base --is-ancestor 1155b7b b15aceb
git merge-base --is-ancestor 1155b7b 3fce9b0
git merge-base --is-ancestor b15aceb ed7b66f
git merge-base --is-ancestor 3fce9b0 feat/hk-face-h4c-reconciliation
```

结果：

| 关系 | exit | 结论 |
|---|---:|---|
| `1155b7b → b15aceb` | 0 | H4-b 是设计分支祖先 |
| `1155b7b → 3fce9b0` | 0 | H4-b 是 C1 祖先 |
| `b15aceb → ed7b66f` | 1 | 批准分支不包含设计 tip；用 SHA 引用 |
| `3fce9b0 → C1 tip` | 0 | C1 tip 已前进到 `6dbc9e0` |

### 14.4 `git diff --check`

```powershell
git diff --check
git diff --check b15aceb..HEAD
```

结果：`git diff --check HEAD` 通过。

### 14.5 敏感值扫描

```powershell
# 对唯一新增文档扫描；模式仅输出计数，不输出匹配文本
$patterns = @(
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
  'AKIA[0-9A-Z]{16}',
  'gh[pousr]_[A-Za-z0-9]{30,}',
  'sk-[A-Za-z0-9]{20,}',
  'H4_EVIDENCE_HMAC_KEY_B64\s*=\s*[A-Za-z0-9+/=]{16,}',
  'OPERATION_KEY_HMAC_KEY_B64\s*=\s*[A-Za-z0-9+/=]{16,}',
  '(?i)(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["'']?[A-Za-z0-9+/=_-]{12,}',
  'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}',
  '(?<!\d)1[3-9]\d{9}(?!\d)',
  '(?<!\d)\d{17}[\dXx](?!\d)',
  '(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)'
)
$files = @('docs/tasks/HK-AI-04-H4C-C2-PREFLIGHT-2026-11-14.md')
$hits = 0
foreach ($f in $files) {
  foreach ($p in $patterns) {
    $m = Select-String -Path $f -Pattern $p -AllMatches
    if ($m) { $hits += $m.Count }
  }
}
"files=$($files.Count); findings=$hits"
```

结果：`files=1; findings=0`。

### 14.6 未执行项

- 未运行 C1/C2 测试：本卡不实现代码；C1 测试属于 C1 复审范围。
- 未运行 Admin 全量/根测试：同上；C2-3 才要求。
- 未调用 Provider/设备/生产云/HTTP：本卡边界。
- 未修改 `server.mjs`/`routes.mjs`/生产代码/测试。

## 15. 交付声明

- 本卡唯一产物：`docs/tasks/HK-AI-04-H4C-C2-PREFLIGHT-2026-11-14.md`。
- 本卡不构成 C1 批准、C2 启动、C3 启动、HTTP 接线、真实 Provider/设备/Cloud/live 或生产发布批准。
- 下一步：Codex 复审本检查表与 §13 Q01–Q20；Q01（C1 基线）和 Q02/Q04/Q08 关闭前，C2 不得开始。
- 复审通过后，C2 仍须按 C2-1→C2-2→C2-3 逐笔提交、逐笔复审；前一笔未通过不得进入下一笔。
