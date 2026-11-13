# HK-AI-04 H4-c UNKNOWN_RESULT 人工对账契约设计（返工稿）

设计提案，待 Codex 批准。**本轮只设计，不修改生产代码或测试，不注册 HTTP，不连接 Cloud/live、真实 Provider 或真实设备。**

- 服务层基线：`feat/hk-face-h4b-mock-cleanup` @ `1155b7ba65991d324fb8b22bb8f7dd87f49428f9`
- 任务卡：`547fee5`（`docs/tasks/HK-AI-04-H4C-RECONCILIATION-DESIGN-TASK-2026-11-13.md`）
- 前次设计：`d6815749dd478e8027ee54c2d82c9fd9b3e1826e`
- 复审记录：`0c281045f00035c52089bafc3a1042f94f41e5a3`（[HK-AI-04-H4C-DESIGN-REVIEW-D681574-2026-11-14.md](https://github.com/1997dmsu-sketch/SMART-PM/blob/0c281045f00035c52089bafc3a1042f94f41e5a3/docs/tasks/HK-AI-04-H4C-DESIGN-REVIEW-D681574-2026-11-14.md)）
- H4-b 终审：`HK-AI-04-H4B-APPROVAL-1155B7B-2026-11-13.md`（任务卡提交 `547fee5`）
- 分支：`docs/hk-face-h4c-reconciliation-design`
- 边界：H4-c 只冻结 `awaiting_result` 的人工对账入口；不实现 H4-d、HTTP 注册、真实 Provider、设备写或生产部署。

## 0. 复审返工对照

| 复审项 | 本稿处理 | 位置 |
|---|---|---|
| P0-1 K3 换钥保护不完整 | 新增独立 K3 配置、结构化 HMAC、fingerprint、全局 head/version、同版本换钥失败关闭、Store/refs/错误映射 | §5、§8、§11 |
| P0-2 evidence 链无原子 head/CAS | 新增 `device_operation_evidence_heads`，每 job 一条；所有 decision 同事务 CAS head，证据 create-only，链/分叉/预读插入失败关闭 | §5、§6、§9 |
| P0-3 事务未读 grant | 三种 decision 的 refs 均加入 grant，并在事务内复核 `revoked/cleanupPending/cleanupJobId/绑定` | §6、§8 |
| P0-4 local finalize 耗尽无人工闭环 | 新增 `finalize-retry` 手工本地恢复入口（独立 K2 method、权限、CAS、幂等、Provider 0） | §6.5、§13 |
| P0-5 用户伪造 `mock_provider` | 公开 DTO 只允许 `sourceType=operator`；`mock_provider` 从 H4-c 公开输入删除，未来受信适配器另立卡 | §4、§5 |
| P1-1 集合/schema/Store/索引 | 冻结 evidence/head/K3 domain 的集合属性、validator、Store 登记、seed/init、索引与敏感字段 | §5.5 |
| P1-2 schema/algorithm/key 版本混用 | 分离 `schemaVersion`、`digestAlgorithmVersion`、`keyVersion` | §5.2、§5.3 |
| P1-3 confirmed_present/still 未验 job/grant/snapshot | 三种 decision 统一复核 job、grant、cleanupSnapshot、evidenceScope | §6.1、§6.3、§6.4 |
| P1-4 200/202/终态失败投影 | 明确 complete/pending/terminal/ack-loss/不同键重复的响应矩阵 | §13 |
| P1-5 RC 矩阵缺口 | 新增 K3/head/grant/provider 伪造/恢复/投影用例，RC01–RC64 连续编号 | §15 |

## 1. 结论与冻结边界

H4-c 冻结一个**人工、显式、幂等、终态收敛**的对账入口：

| decision | 业务结果 | 资源结果 | Provider |
|---|---|---|---|
| `confirmed_removed` | 复用 H4-b local finalize，job 最终 `succeeded` | 按 H4-b 的 candidate/guard CAS 释放 slot，必要时释放 owner claim | **0** |
| `confirmed_present` | job `terminal_failed` | grant 保持 `revoked`、`cleanupPending=true`；slot/claim 不释放 | **0** |
| `still_unknown` | job 保持 `awaiting_result` | 业务状态不变；追加 evidence/log/op key/audit | **0** |

`awaiting_result` 不得被自动查询、定时器、重试或回调推动；离开该状态的唯一路径是持 `device.operation.reconcile` 的人工请求。H4-c 不新增自动 query、轮询、Provider 调用或设备连接。

## 2. 当前实现事实与复用点

| 事实 | 代码/证据 | 对 H4-c 的约束 |
|---|---|---|
| revoke job 使用独立 validator，字段集合精确固定 | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 35–40、84–120 行 | 不新增 job 顶层字段；H4-c 不复制 revoke 状态机 |
| `candidateDisposition` 固定 pending/effective/suspended/expired 阻断、revoked+cleanupPending 阻断、revoked+false 清除 | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 176–184 行 | `confirmed_removed` 必须复用同一 candidate 语义 |
| finalize 在事务内重验 grant/slot/claim/device/guard，guard 先读、candidate 后扫，再 CAS revision/epoch | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 340–437 行 | 不建立第二套 release 算法；不按 slotId 盲写 |
| finalize 事务 refs 为 `8+N`（job/grant/slot/claim/device/guard/log/N candidates/audit） | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 361–364 行；[H4-b 证据](HK-AI-04-H4B-EVIDENCE-2026-11-13.md) R31 | 82 candidates/90 refs 是冻结边界；83/91 失败关闭或进入 local-finalize |
| local finalize 只做本地事务，最多 4 次，耗尽为 `LOCAL_FINALIZE_EXHAUSTED` | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 438–453、475–481 行 | `confirmed_removed` 只调用该本地路径，Provider 恒 0；耗尽后需人工恢复 |
| K2 operation key：HMAC、domain head/version、requestDigest、严格重放 | [service.mjs](../../admin-web/lib/face-service/service.mjs) 第 117–151 行；[collections.mjs](../../admin-web/lib/face-service/collections.mjs) 第 220–309 行 | 复用同一 K2 机制，不写原始幂等键 |
| 确定性 audit 由 Store 写入，refs 去重后上限 90 | [store.mjs](../../admin-web/lib/store.mjs) 第 87–96、263–315、398–454 行 | 每个 H4-c 事务必须声明 deterministic audit ref |
| 路由提案已存在但未注册 | [routes.mjs](../../admin-web/lib/face-service/routes.mjs) 第 54–59 行 | 未来路径只写提案，不注册 `server.mjs` |
| `device.operation.reconcile` 已在权限目录 | [org.mjs](../../admin-web/lib/org.mjs) 第 104 行 | 权限名冻结，不新增别名 |
| 公开 job DTO 只返回最小字段 | [dto.mjs](../../admin-web/lib/face-service/dto.mjs) 第 253–263 行 | reconcile 响应不复制 job/evidence 原文 |

H4-b 终审见 [H4-b 终审](https://github.com/1997dmsu-sketch/SMART-PM/blob/547fee5/docs/tasks/HK-AI-04-H4B-APPROVAL-1155B7B-2026-11-13.md)，H4 设计终审见 [H4 设计终审](https://github.com/1997dmsu-sketch/SMART-PM/blob/547fee5/docs/tasks/HK-AI-04-H4-DESIGN-APPROVAL-1542A6C-2026-11-13.md)，H4 原始对账设计见 [H4 撤权/对账契约](https://github.com/1997dmsu-sketch/SMART-PM/blob/9fd088d/docs/tasks/HK-AI-04-H4-REVOKE-RECONCILE-DESIGN.md) Q04（其 `succeeded/terminal_failed` 目标由本卡三种 decision 取代，资源/证据语义沿用）。

## 3. 权限与事务内复核

1. 权限固定为 `device.operation.reconcile`，不接受 `device.access.manage`、`device.audit.read` 或 `device.operation.retry` 代办。
2. 事务外先做 `#require` 快速失败；事务内必须重新读取并复核：
   - `organizations/<orgId>.status === "active"`；
   - `org_memberships/<actor.membershipId>` 的 `orgId/status/principalId|actorId` 与 actor 一致；
   - membership `permissions` 含 `device.operation.reconcile`；
   - actorType 只允许 `user`/`system`/`agent`，H4-c 人工入口实际只接受 `user`。
3. 跨组织与不存在同态：`store.get(..., orgId)` 返回 null，统一 `NOT_FOUND/404`，不泄露 job 是否存在。
4. `expectedRevision` 必须与事务内 `job.revision` 严格相等；否则 `REVISION_CONFLICT/409`，零写。
5. **所有 decision 的事务都必须读取并复核 grant**（§6.1），事务外预读不能替代。

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
| `decision` | 枚举三值 | 见 §6 |
| `evidence` | 精确对象，仅 3 字段 | 不接受 `digest`、`raw`、`response`、`payload`、`file` 等 |
| `evidence.sourceType` | **仅 `operator`** | H4-c 公开入口不允许 `mock_provider`/`device`/`provider_query`/`live` |
| `evidence.sourceCode` | 固定短码，≤32，见 §4.1 | 不接受自由文本 |
| `evidence.observedAt` | 安全整数毫秒，≥0 | 不晚于服务端 now，且不早于 job 进入 `awaiting_result` 的时间 |
| `Idempotency-Key` | 16–128，`[A-Za-z0-9._:-]` | 与 K2 `assertIdempotencyKey` 完全一致 |

### 4.1 sourceType/sourceCode 与 decision 的绑定

H4-c 公开 DTO **只有人工来源**；`mock_provider` 已从公开输入删除。若未来引入受信 Mock 适配器，必须另立卡定义独立调用边界，不得复用本 HTTP 请求。

| decision | 允许 sourceType | 允许 sourceCode |
|---|---|---|
| `confirmed_removed` | `operator` | `OPERATOR_CONFIRMED_REMOVED` |
| `confirmed_present` | `operator` | `OPERATOR_CONFIRMED_PRESENT` |
| `still_unknown` | `operator` | `OPERATOR_UNCERTAIN` |

事务内额外绑定：`actorType==="user"` 且 `sourceType==="operator"`；任何 `mock_provider`/`device` 输入 → `EVIDENCE_INVALID/409`（即使格式合法）。sourceCode 与 decision 不匹配 → `EVIDENCE_INVALID/409`。H4-c 只接受 `evidenceScope=simulated` 的合成证据；`device_verified` 或任何真实设备证据在 Mock 阶段失败关闭。

## 5. evidence 契约

### 5.1 三个新集合及属性

| 集合 | 属性 | 用途 |
|---|---|---|
| `device_operation_evidence` | **组织域**，带 `orgId`，不可变 create-only | 每条证据的不可变记录 |
| `device_operation_evidence_heads` | **组织域**，带 `orgId`，每 job 一条 | 原子 head/CAS、链尾、间隔/次数 |
| `evidence_digest_domains` | **全局部署域**，无 `orgId` | K3 稳定 head + 版本历史，防同版本换钥 |

三集合均需在 H4-c 编码时登记到 [store.mjs](../../admin-web/lib/store.mjs) 的 `collections`、`seed()` 与 `init()` 默认数组；LocalStore/CloudStore 同契约。本轮不修改 Store。

### 5.2 evidence 记录字段白名单

```text
_id, orgId, jobId, schemaVersion, sequence,
decision, sourceType, sourceCode, observedAt,
digestDomain, digestAlgorithm, digestAlgorithmVersion,
keyRealm, keyVersion, keyFingerprint, digest,
previousEvidenceId, evidenceScope, actorId, createdAt
```

字段说明：`schemaVersion` 表示记录 schema；`digestAlgorithmVersion` 表示 HMAC 消息/算法版本；`keyVersion` 表示 K3 密钥版本。三者独立，不得互相替代。

| 字段 | 约束 |
|---|---|
| `_id` | `h4c-evidence-v1:<sha256([orgId,jobId,sequence]) 前 32 hex>`；同一 job/sequence 唯一 |
| `schemaVersion` | 固定 `1` |
| `sequence` | 安全整数 1..9；同一 job 连续；still_unknown 最多到 8，最终裁定可到 9 |
| `decision` | 三值枚举，与 sourceCode 绑定 |
| `sourceType` | 固定 `operator`（H4-c） |
| `sourceCode` | 见 §4.1；短码固定 |
| `observedAt` | 安全整数；`job.createdAt ≤ observedAt ≤ now`；且 `observedAt ≥ job.result.finishedAt` |
| `digestDomain` | 固定 `KEYED_DIGEST/h4-reconcile-evidence` |
| `digestAlgorithm` | 固定 `HMAC-SHA256` |
| `digestAlgorithmVersion` | 固定 `1` |
| `keyRealm` | K3 realm，3–64 小写字母/数字/连字符 |
| `keyVersion` | K3 密钥版本，正整数；与 `digestAlgorithmVersion` 独立 |
| `keyFingerprint` | 64 位小写十六进制，K3 配置不可逆指纹 |
| `digest` | 64 位小写十六进制，服务端计算；客户端不得提交 |
| `previousEvidenceId` | 前一条 evidence ID；第一条为 `null`；必须等于 head 的 `lastEvidenceId` |
| `evidenceScope` | 固定 `simulated` |
| `actorId` | 有界 actor ID，仅内部引用 |
| `createdAt` | 服务端安全整数时间戳 |

单条记录 ≤4096 bytes；未知字段、空白 ID、控制字符、非安全整数一律 `EVIDENCE_INVALID/409`。禁止入库：原始 Provider 请求/响应、异常 message/stack、序列号、IP/MAC、账号、姓名/手机号/地址/证件号、图片/字节/base64、objectKey、checksum、完整证书指纹、原始幂等键、K1/K2/K3 密钥。

### 5.3 K3 配置、fingerprint 与 domain guard

| 项目 | 冻结建议 |
|---|---|
| 用途域 | `KEYED_DIGEST/h4-reconcile-evidence` |
| 算法/消息版本 | HMAC-SHA256；`digestAlgorithmVersion=1` |
| 配置 | `H4_EVIDENCE_HMAC_KEY_B64`（规范 Base64 的 32 字节）、`H4_EVIDENCE_KEY_VERSION`（正整数）、`H4_EVIDENCE_REALM`（3–64 小写字母/数字/连字符） |
| 密钥来源 | **独立 K3**；不复用 K1/K2；缺失/非法 → `NOT_CONFIGURED/503` |
| keyFingerprint | `HMAC-SHA256(key, JSON.stringify(["KEYED_DIGEST/h4-evidence-fingerprint","v1",realm,keyVersion]))`，64 hex |
| 消息 | 稳定排序 JSON：`{domain, algorithmVersion, realm, keyVersion, orgId, jobId, decision, sequence, sourceType, sourceCode, observedAt, evidenceScope, previousEvidenceId}` |
| 摘要 | `HMAC-SHA256(key, message)`，64 hex；写入 evidence 的 `digest` |
| 换钥 | 同版本不同 key ⇒ fingerprint 不符 ⇒ `DOMAIN_MISMATCH/409`；版本不同必须受控迁移；H4-c 不做自动迁移 |
| 历史验证 | evidence 同时保存 `keyRealm/keyVersion/keyFingerprint`，可按历史版本重算；domain head/version 提供稳定锚点 |

**domain 集合与 ID**

```text
evidence_digest_domains/<headId>       headId    = evidence-digest-domain:<base64url(realm)>
evidence_digest_domains/<versionId>    versionId = evidence-digest-domain-version:<base64url(realm)>:<version>
```

| 记录 | 字段 |
|---|---|
| head | `_id, kind:"head", realm, keyVersion, keyFingerprint, revision, createdAt` |
| version | `_id, kind:"version", realm, keyVersion, keyFingerprint, enabledAt` |

`applyEvidenceDomain(state, {realm,version,fingerprint,now})` 与 K2 `applyOperationKeyDomain` 同构：

- 两者都不存在：本次事务创建 head+version（refs 已声明），writes 0–2；
- 只有一边存在、kind 错、head/version 的 realm/keyVersion/keyFingerprint 彼此矛盾：`DOMAIN_INCOMPLETE/409`；
- 两者完整且内部一致，但 realm/keyVersion/keyFingerprint 与当前配置不一致：`DOMAIN_MISMATCH/409`；
- 同版本换钥即 fingerprint 不一致：失败关闭，零业务写；
- head 稳定（不含版本），version 记录保留历史；不得用环境变量当前值替代 domain 校验。

**用途说明**：该摘要证明“这条合成证据由当前组织、job、decision、sequence、K3 realm/keyVersion 产生”，防止低熵短码被枚举/替换；它不是原始 Provider 响应的哈希。H4-c 不接收原始响应；未来真实设备证据若需绑定原始响应，必须在 H5/后续卡定义受信适配器摘要。

### 5.4 evidence head 记录与 CAS

字段白名单：

```text
_id, orgId, jobId, revision, lastSequence, lastEvidenceId, lastObservedAt, createdAt, updatedAt
```

| 字段 | 约束 |
|---|---|
| `_id` | `h4c-evidence-head-v1:<sha256([orgId,jobId]) 前 32 hex>` |
| `revision` | ≥1；每次 CAS +1 |
| `lastSequence` | 0..9；空链为 0 |
| `lastEvidenceId` | `null` 或 1–128 有界 ID；与 lastSequence 同时为 0/null |
| `lastObservedAt` | 0 或安全整数；最后一条 evidence 的 observedAt |
| `createdAt/updatedAt` | 服务端安全时间戳；updatedAt 用于 60 秒间隔 |

事务内算法：

1. 事务外预读 head（可能 null）、按 `(orgId,jobId)` 检查是否已有 evidence（只用于识别“head 缺失但链存在”的损坏）。
2. 事务 refs 必须包含 head（新建/更新）与新 evidence；若 head 已存在，还包含 `previousEvidenceId` 指向的旧 evidence。
3. 事务内重新读取 head：
   - 预读为 null：head 必须仍为 null，且该 job 无既有 evidence；否则 `EVIDENCE_CHAIN_BROKEN/409`；
   - 预读非 null：head 必须存在，`revision` 与 `lastEvidenceId` 完全匹配；否则 `EVIDENCE_HEAD_CONFLICT/409`（消失/被替换为 `EVIDENCE_CHAIN_BROKEN`）。
4. `sequence = lastSequence + 1`；`previousEvidenceId = lastEvidenceId`；新 evidence ID 对 `(org,job,sequence)` 确定性；若已存在 → `CONFLICT/409`。
5. 写入新 evidence，并更新/创建 head：`lastSequence=sequence`、`lastEvidenceId=newId`、`lastObservedAt=observedAt`、`revision+1`、`updatedAt=now`。
6. 并发不同键：只有一个 head CAS 能提交；失败方 `EVIDENCE_HEAD_CONFLICT/409`，不得分叉。同键重放在 op key 层直接返回，不再 CAS。

### 5.5 Store/schema/索引与敏感字段

H4-c 编码时必须一并冻结，但本轮不实现：

| 项目 | 要求 |
|---|---|
| `collections` | 追加 `device_operation_evidence`、`device_operation_evidence_heads`、`evidence_digest_domains` |
| `seed()`/`init()` | 三集合初始化为 `[]`；旧 LocalStore 数据文件按现有 `||= []` 模式补齐 |
| validator | `validateEvidenceRecord`、`validateEvidenceHead`、`validateEvidenceDomainRecord`，精确字段 + `rejectUnknownFields`；错误统一 `EVIDENCE_INVALID`/`DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH` |
| 索引（提案） | evidence `(orgId, jobId, sequence)`；head `(orgId, jobId)`；domain `(realm, kind, keyVersion)` |
| 查询边界 | H4-c 只按确定性 ID 点查/事务读；不提供公开全量查询；未来审计分页另设计 |
| 敏感拒绝 | validator 拒绝未知字段；禁止原始响应/序列号/IP/MAC/账号/图片/objectKey/checksum/证书指纹/原始幂等键 |
| 不可变性 | evidence create-only；head 只允许 CAS 更新指定字段；domain 只按 K3 guard 写入 |

## 6. 三种 decision 的状态机、grant 复核与写集

状态迁移只发生在 `awaiting_result`。**三种 decision 的事务都必须读取 grant，并校验 job/grant/cleanupSnapshot 绑定**；事务外预读只用于 refs/快速失败。

### 6.1 grant/job 事务内统一复核（P0-3）

每种 decision 事务内：

```text
job.orgId === orgId
job._id === jobId
job.revision === expectedRevision
job.action === "revoke"
job.cleanupSnapshot 通过 H4-b validateSnapshot
job.evidenceScope === "simulated"
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

§6.1 只定义**job/grant/snapshot 共同绑定**；各 decision 的 job 状态前置在 §6.2/§6.3/§6.4 分别追加（R1：`awaiting_result`、`cleanupPhase="dispatch"`、`providerOutcome=null`；confirmed_present/still_unknown 同；finalize-retry：`terminal_failed`/`cleanupPhase="finalize"`/`providerOutcome="confirmed_removed"`）。

任一不满足 → `CLEANUP_SNAPSHOT_REQUIRED`/`REVISION_CONFLICT`/`INVALID_STATE`，零写。R1 在切 job 到 finalize 前必须完成上述复核；R2 由 H4-b finalize 再复核一次。`grant` 必须加入每个事务的 refs（§8.1）。

### 6.2 `confirmed_removed`：两段式提交，保住 H4-b 82/90

H4-b finalize 的 `8+N` 在 N=82 时正好 90；同一事务再加 evidence/head/K3/op key 会变成 94+，破坏冻结边界。因此 H4-c 采用两段：

**R1 — decision/intent（不释放资源）**

- 事务内前置：`job.state==="awaiting_result"`、`job.cleanupPhase==="dispatch"`、`job.providerOutcome===null`、`job.evidenceScope==="simulated"`；并完成 §6.1 共同绑定复核。
- refs（去重后 14–15 条）：
  `organizations/org`、`org_memberships/actor`、`device_operation_jobs/job`、`device_access_grants/grant`、
  `device_operation_evidence/evidence`、`device_operation_evidence/previous`（有则）、
  `device_operation_evidence_heads/head`、`evidence_digest_domains/k3Head`、`evidence_digest_domains/k3Version`、
  `operation_keys/op`、`operation_key_domains/opHead`、`operation_key_domains/opVersion`、
  `device_operation_logs/log`、`admin_audit/audit`。
- writes：
  - job：`awaiting_result → retryable_failed`，`cleanupPhase:"finalize"`，`providerOutcome:"confirmed_removed"`，`finalizeAttempts:1`，`nextAttemptAt=now`，`result` 为标准 5 字段 `{attempt,outcome:"retryable_failed",errorKind:"LOCAL_FINALIZE",reasonCode:"RECONCILE_CONFIRMED_REMOVED",finishedAt}`；
  - evidence（新记录）；
  - evidence head（新建/更新 CAS）；
  - K3 domain（首次 0–2）；
  - 一条 deterministic reconcile log；
  - operation key（result 为指向 evidence/job 的稳定指针，见 §7）；
  - operation key domain writes（0–2）；
  - audit（Store 写入）。
- **不写** grant/slot/claim/device；不调用 Provider。

**R2 — H4-b local finalize（复用原算法）**

- 调用现有 [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 475–481 行 `finalize(jobId)`，只走本地事务，Provider 0。
- refs/writes 与 H4-b 完全一致：`8+N`；job `succeeded`、grant `cleanupPending=false`、slot 合法 released 墓碑、无 blocker 时 owner claim released + release guard CAS、success log、audit。
- N≤82 时 90 refs 内成功；N=83 时 H4-b 原有 `>90` 分支进入 local-finalize pending，**绝不半释放**。
- R1 写前只读预扫 N≥83 → `CAPACITY_EXCEEDED/400`，零写；R1 后增长到 83 的竞态由 R2 的 H4-b `>90` 分支兜底。
- R1 写前还只读校验 `cleanupSnapshot`/grant/slot/claim/device/guard 精确 schema 与绑定；缺失/损坏直接 `CLEANUP_SNAPSHOT_REQUIRED`/`DEVICE_CLAIM_INVALID`，R1 零写。R2 再事务内重验防 TOCTOU。

**失败/恢复**

- R1 成功、R2 失败：job `retryable_failed`/finalize；H4-b `#localFinalizeFailure` 30/120/600 重试，最多 4 次；资源不释放，Provider 0。
- R2 成功：job `succeeded`，`cleanupPending=false`。
- R2 第 4 次耗尽：`terminal_failed/LOCAL_FINALIZE_EXHAUSTED`；grant 保持 `revoked/cleanupPending=true`，slot/claim 不释放；可通过 §6.5 人工本地恢复，不重复 Provider。
- `finalizeAttempts` 从 1 起算：人工 confirmed_removed 视为第 1 次本地 finalize 尝试；H4-b 允许 1..3 进入重试，第 4 次耗尽。该口径见 §14 Q6。

### 6.3 `confirmed_present`：终态、保留资源

单事务：

- 事务内前置：`job.state==="awaiting_result"`、`job.cleanupPhase==="dispatch"`、`job.providerOutcome===null`、`job.evidenceScope==="simulated"`；并完成 §6.1 共同绑定复核。
- job：`awaiting_result → terminal_failed`，`revision+1`，`result` 为 `{attempt,outcome:"terminal_failed",errorKind:"TERMINAL",reasonCode:"RECONCILE_CONFIRMED_PRESENT",finishedAt}`；`nextAttemptAt=null`，无 lease。
- grant：**不修改**，保持 `revoked/cleanupPending=true/cleanupJobId`；事务内复核 §6.1，响应从事务复核结果投影。
- slot/claim/device/guard：不修改；保持 active 墓碑（job 仍 `awaiting_result`，尚未成功 local finalize）。
- 写：evidence、evidence head、K3 domain、log、op key、op domain、audit；Provider 0。
- 后续：`terminal_failed` 终态；H4-b `requeue` 只接受 `retryable_failed`，不会重派。H4-c 不允许未来受控重新派发；未来重新清理必须 H4-d 新 generation/job。

### 6.4 `still_unknown`：状态不变，只追加事件

单事务：

- 事务内前置：`job.state==="awaiting_result"`、`job.cleanupPhase==="dispatch"`、`job.providerOutcome===null`、`job.evidenceScope==="simulated"`；并完成 §6.1 共同绑定复核。
- job：**零写**（revision/state/result/cleanupPending 不变）；事务内仍读取并复核 §6.1。
- grant：**零写**；事务内读取并复核 §6.1。
- 写：evidence（sequence+1）、evidence head CAS、K3 domain、log、op key、op domain、audit；Provider 0。
- 证据链：`sequence = head.lastSequence+1`，`previousEvidenceId = head.lastEvidenceId`；`still_unknown` 的 sequence 上限 8。
- 频控：`now - head.updatedAt < 60_000` → `RECONCILE_THROTTLED/409`（`RECONCILE_STILL_UNKNOWN_MIN_INTERVAL_MS=60_000`）。
- 次数上限：head.lastSequence ≥8 时再提交 still_unknown → `RECONCILE_LIMIT/409`；最终 confirmed 裁定可作为 sequence 9。
- 并发：所有提交 CAS head；同 sequence 争同一 evidence ID；后提交者 `EVIDENCE_HEAD_CONFLICT`/`CONFLICT`，不分叉；客户端用新键重试时重新读 head 并重算间隔/上限。
- `still_unknown` 每次必须使用新 Idempotency-Key；同键按 §7 重放。

### 6.5 `LOCAL_FINALIZE_EXHAUSTED` 人工本地恢复（P0-4）

`confirmed_removed` R2 第 4 次耗尽后，H4-b `finalize()` 只接受 `retryable_failed`，若无恢复入口任务会永久 `cleanupPending=true`。H4-c 因此冻结一个**仅本地**恢复入口，不是第四种 decision：

| 项目 | 契约 |
|---|---|
| 入口 | `reconcileFinalize(jobId, {expectedRevision}, {idempotencyKey})` |
| 权限 | `device.operation.reconcile`；事务内复核组织/成员/actor |
| K2 method | `face.reconcile.finalize`（独立摘要与 op key） |
| 允许前置 | job `terminal_failed`、`providerOutcome:"confirmed_removed"`、`cleanupPhase:"finalize"`、`result.errorKind==="LOCAL_FINALIZE"`、`result.reasonCode==="LOCAL_FINALIZE_EXHAUSTED"`；grant `revoked/cleanupPending=true/cleanupJobId===jobId`；snapshot/guard 通过 §6.1 |
| CAS | `job.revision===expectedRevision`；grant 绑定复核；head 不参与（不新增证据） |
| 写 | job 转 `retryable_failed`/finalize，`finalizeAttempts:1`，`nextAttemptAt=now`，`result` 为 `{attempt,outcome:"retryable_failed",errorKind:"LOCAL_FINALIZE",reasonCode:"RECONCILE_FINALIZE_RECOVERY",finishedAt}`；log/op key/op domain/audit |
| 后续 | 同事务后调用 H4-b `finalize(jobId)`；Provider 0；成功则 `succeeded/cleanupPending=false`，失败进入 30/120/600 重试，再次耗尽可再次人工恢复 |
| 重放 | 同 op key 同摘要返回原结果；同键异摘要 `CONFLICT`；不同键在终态同结论 `duplicate:true` |
| 禁止 | 不调用 Provider、不重发 revokeFace、不自动轮询、不重置 grant/slot/claim 资源、不把终态改回业务有效 |

该入口使 H4-c 具备“耗尽后人工收敛”闭环；若 Codex 不接受该入口，则 H4-c 必须明确声明“cleanup 不闭环”，不得宣称完成。见 §14 Q8。

## 7. K2 operation key、requestDigest、严格重放

### 7.1 K2

- method 固定 `face.reconcile`（恢复入口 `face.reconcile.finalize`）；沿用 [service.mjs](../../admin-web/lib/face-service/service.mjs) 第 117–151 行的 `#opContext`/`#replayValid`/`#opDomainWrites`。
- `operationKey` 由 HMAC/K2 派生，记录保存 `orgId/realm/keyVersion/requestDigest/result/createdAt`；**不保存原始 Idempotency-Key**。
- `requestDigest = SHA-256(stable({jobId, expectedRevision, decision, evidence:{sourceType,sourceCode,observedAt}, evidenceDigest, previousEvidenceId, sequence}))`；evidenceDigest 为 §5.3 服务端 K3 摘要。
- K2 缺失/非法 → `NOT_CONFIGURED/503`；domain 单边缺失/损坏 → `DOMAIN_INCOMPLETE/409`；完整但与配置不一致 → `DOMAIN_MISMATCH/409`；均零写。
- K3 与 K2 独立：K3 缺失/非法 → `NOT_CONFIGURED/503`；K3 domain 错误见 §5.3；任何一方错误都不得借用另一方配置。

### 7.2 严格重放

| 情形 | 行为 |
|---|---|
| 同 op key、同 requestDigest | 返回已有 operation key 稳定 result/投影；不重跑 decision/evidence，不新增核心写；Provider 0 |
| 同 op key、异 requestDigest | `CONFLICT/409`，不改写 operation key |
| operation key result 为 null/数组/错 jobId/错 decision/异常 createdAt | `CONFLICT/409`，零写 |
| 同 op key、`confirmed_removed` R1 已提交、R2 未完成 | 202 pending 投影；不重复 R1/Provider；H4-b 恢复路径完成 |
| 同 op key、R2 已成功 | 200 complete 投影；核心写集不变 |
| 同 op key、R2 已耗尽 | 200 terminal 投影（`terminalReason=LOCAL_FINALIZE_EXHAUSTED`）；恢复入口可用 |
| 不同 op key、已终态且 decision 相同 | `duplicate:true`，返回既有终态，零写 |
| 不同 op key、已终态且 decision 不同 | `RECONCILE_CONFLICT/409`，保留原终态 |
| job 已终态且非上述重复 | `INVALID_STATE/409`，零写 |

`confirmed_removed` 的 operation key 存**稳定指针**（decision/evidenceId/sequence），不是会随 finalize 变化的完整响应；这样既保持 K2 记录不可变，又允许 R2 完成后同键返回最终投影。该“指针 + 投影”是 H4-c 明确例外（§14 Q5）。

## 8. refs/writes、90-ref 上限与候选扫描

### 8.1 逐 decision refs/writes

| 事务 | refs | writes |
|---|---|---|
| R1 confirmed_removed | org、membership、job、**grant**、evidence、previous evidence（可选）、evidence head、K3 head/version、op key、op domain head/version、log、audit = 14–15 | job pre-finalize、evidence、head、K3 domain 0–2、log、op key、op domain 0–2、audit；**0** grant/slot/claim/device |
| R2 confirmed_removed | H4-b `8+N`：job、grant、slot、claim、device、guard、success log、N candidates、audit | H4-b 原写集：job succeeded、grant cleanupPending=false、slot/claim/guard 原规则、log、audit |
| confirmed_present | org、membership、job、**grant**、evidence、previous（可选）、evidence head、K3 head/version、op key、op domain 2、log、audit = 14–15 | job terminal、evidence、head、K3 domain、log、op key、domain、audit；**0** grant/slot/claim/device |
| still_unknown | 同上 14–15 | evidence、head、K3 domain、log、op key、domain、audit；**0** job/grant/slot/claim/device |
| finalize-retry | org、membership、job、grant、op key、op domain 2、log、audit = 9 | job retryable_failed/finalize、log、op key、domain、audit；**0** evidence/grant/slot/claim/device |

所有事务 `store.transact` 前去重；`8+N` 的 N 是 H4-b candidate 集合（不含 `revoked+cleanupPending=false`）。

### 8.2 82/83 与 90 上限

- H4-b finalize `8+N`：N=82 → 90 成功；N=83 → 91，pre-send 拒绝或 Provider 成功后 local-finalize pending。H4-c 不改变该边界。
- R1 写前只读预扫：N≤82 允许；N≥83 → `CAPACITY_EXCEEDED/400`，R1 零写、Provider 0、无 evidence/head/op key；R1 后增长到 83 由 R2 H4-b `>90` 分支兜底。
- 非 finalize 事务 14–15 refs，远低于 90；`finalize-retry` 9 refs。
- R1 预扫只做 candidate 计数/有效性，不释放、不写 slot/claim/guard；释放算法只有 H4-b 一套。

### 8.3 candidate/guard/墓碑复用

- candidate 顺序：先读 release guard，再 list grants；guard witness 事务内 CAS `revision+epoch`。
- 只排除 `outside` 和 `revoked+cleanupPending=false`；pending/effective/suspended/expired/revoked+true 全部阻断。
- 当前 job 合法 slot 墓碑（`releasedByJobId===jobId`）和合法 claim 墓碑（`releasedByAuditId===auditId`）允许；其他 job/部分墓碑拒绝。
- slot/claim/guard/device 结构损坏 → `DEVICE_CLAIM_INVALID`/`CLEANUP_SNAPSHOT_REQUIRED`，零写。
- 不删除/不复用 released slot 墓碑；不触碰其他 grant 的 owner claim。

### 8.4 确定性 evidence/log/audit ID

| 对象 | 公式 | 说明 |
|---|---|---|
| evidence | `h4c-evidence-v1:${sha256(stable([orgId,jobId,sequence])).slice(0,32)}` | 同 job/sequence 唯一；并发同 sequence 冲突 |
| evidence head | `h4c-evidence-head-v1:${sha256(stable([orgId,jobId])).slice(0,32)}` | 每 job 一条 |
| K3 head/version | `evidence-digest-domain:<b64url(realm)>` / `...:<version>` | 全局稳定 head/版本 |
| reconcile log | `deterministicLogId(jobId, eventToken, occurrence)`（[collections.mjs](../../admin-web/lib/face-service/collections.mjs) 第 481 行） | `eventToken` 用独立 token，避免与 H4-b 同 revision 日志碰撞：`reconcile_still_unknown`（occurrence=sequence）、`reconcile_confirmed_removed`（1）、`reconcile_confirmed_present`（1）、`reconcile_finalize_retry`（1）；log 的 `state` 仍写真实 job 状态 |
| reconcile audit | `audit-h4c-v1:${sha256(stable([orgId,jobId,decision,sequence,jobRevision])).slice(0,32)}` | 每次决定/恢复唯一；Store deterministic audit 写入 |
| R2 finalize log/audit | H4-b 原 `deterministicLogId` / `audit-h4-v1` | 不替换、不复制 H4-b ID 算法 |
| operation key | 现有 `operationKey`/K2 | 不把原始幂等键写入固定 ID |

log 数据不新增 `evidenceId/sequence` 字段；证据通过 evidence/head 的 `jobId/sequence/decision` 关联，审计通过 deterministic audit target 关联。

## 9. 并发与线性化

| 竞争 | 线性化点 | 结果 |
|---|---|---|
| 两个 `confirmed_removed` 同 job 不同键 | R1 job revision CAS + evidence head CAS | 一胜；另一 `REVISION_CONFLICT`/`EVIDENCE_HEAD_CONFLICT`，零写 |
| 同 op key 并发 | operation key 唯一 ID + 事务 | 一胜；另一重放同一结果，核心写不重复 |
| `confirmed_present` vs `confirmed_removed` | job revision CAS | 先提交者定终态；另一 `INVALID_STATE`/`RECONCILE_CONFLICT` |
| reconcile R2 vs H4-b `finalize` | job revision + H4-b validator | 一胜；另一 `INVALID_JOB`/`REVISION_CONFLICT`，不重复释放 |
| reconcile vs `expire` | expire 只接受 `sending`；reconcile 只接受 `awaiting_result` | 状态互斥；expire 先提交则 reconcile 重读，反之 expire 拒绝 |
| reconcile R2 vs `createGrant` | guard 先读 + candidate list + guard CAS | createGrant 在 guard 读后提交 → finalize `REVISION_CONFLICT`，不释放 claim；createGrant 在前 → candidate/blocker 阻断 |
| `still_unknown` 并发 | evidence head CAS + sequence/ID | 一胜；另一 `EVIDENCE_HEAD_CONFLICT`；不分叉，不双写 |
| `still_unknown` 预读后插入 | head revision/lastEvidenceId CAS | 后提交者失败；重试重算间隔/上限 |
| grant 在预读后变化 | 事务内 grant 复核 | `REVISION_CONFLICT`/`CLEANUP_SNAPSHOT_REQUIRED`，零写 |
| callback 重跑 | 确定性 log/audit/evidence ID + create-only | 同 callback 只提交一次；preoccupied ID 整事务回滚 |
| finalize-retry vs 另一个 finalize-retry | job revision CAS + op key | 一胜；另一重放/`REVISION_CONFLICT`；Provider 0 |

`confirmed_removed` 的 R1 与 R2 不是同一事务，但线性化点明确：R1 提交决定/证据/head/op key，R2 提交资源释放；R2 失败不撤销 R1，转 local-finalize pending。任何路径不得把 R1 的“已确认删除”当作资源已释放。

## 10. 老任务、缺 snapshot、缺 guard、损坏墓碑与旧证据

| 情形 | 结果 | 写 |
|---|---|---|
| H3 enroll job / action≠revoke | `INVALID_JOB/409` | 0 |
| H4-b 之前的老 revoke job 缺 `cleanupSnapshot`/`cleanupPhase`/`providerOutcome` | `CLEANUP_SNAPSHOT_REQUIRED/409` | 0 |
| snapshot schema 非 1、字段不精确、>4096 bytes、grant/credential/device 绑定不符 | `CLEANUP_SNAPSHOT_REQUIRED/409` | 0 |
| 缺 release guard / guard ID/org/claim/revision/epoch 不符 | `CLEANUP_SNAPSHOT_REQUIRED`/`DEVICE_CLAIM_INVALID/409` | 0 |
| slot/claim 损坏、released 字段不合法、activeClaimId 指向他人 | `DEVICE_CLAIM_INVALID/409` | 0 |
| 旧 evidence 缺 digest/schemaVersion/sequence/previousEvidenceId | `EVIDENCE_INVALID/409` | 0 |
| evidence head 缺失但已有 evidence、head 消失、head 与 evidence 链不符 | `EVIDENCE_CHAIN_BROKEN/409` | 0 |
| K3 domain 单边缺失/损坏/同版本换钥 | `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH/409` | 0 |
| job 已 `terminal_failed`/`succeeded` | `INVALID_STATE`/重复规则 | 0 |
| job 无 `result.finishedAt` 或非安全整数 | `INVALID_JOB/409` | 0 |

禁止自动迁移、补写、猜测、回填历史 job/evidence/head/guard/claim/domain。

## 11. 错误映射

| code | HTTP | 触发 | 写 |
|---|---:|---|---|
| `PARAM_ERROR` | 400 | DTO/枚举/未知字段/时间类型/长度非法 | 0 |
| `NOT_CONFIGURED` | 503 | K2/K3 缺失/非法、Cloud/live/真实 Provider | 0 |
| `NOT_FOUND` | 404 | job 不存在/跨组织同态 | 0 |
| `FORBIDDEN` | 403 | 权限/成员/组织失效 | 0 |
| `REVISION_CONFLICT` | 409 | expectedRevision/grant/head CAS 失败 | 0 |
| `INVALID_STATE` | 409 | job 非 `awaiting_result`/已终态 | 0 |
| `EVIDENCE_REQUIRED` | 409 | evidence 缺失/null | 0 |
| `EVIDENCE_INVALID` | 409 | 结构/短码/decision/sourceType 不匹配/摘要/旧 schema | 0 |
| `EVIDENCE_STALE` | 409 | 时间早于 unknown、未来、超 24h、非递增 | 0 |
| `EVIDENCE_HEAD_CONFLICT` | 409 | head revision/lastEvidenceId CAS 失败 | 0 |
| `EVIDENCE_CHAIN_BROKEN` | 409 | head 缺失但链存在、head 消失、previous 不符 | 0 |
| `RECONCILE_THROTTLED` | 409 | still_unknown 间隔 <60s | 0 |
| `RECONCILE_LIMIT` | 409 | still_unknown 已达 8 次 | 0 |
| `RECONCILE_CONFLICT` | 409 | 已终态但 decision 不同 | 0 |
| `CONFLICT` | 409 | op key 摘要/结果损坏、log/audit/evidence preoccupation | 0 |
| `DOMAIN_INCOMPLETE` | 409 | K2/K3 domain 单边缺失/损坏 | 0 |
| `DOMAIN_MISMATCH` | 409 | K2/K3 换钥/版本/fingerprint 不符 | 0 |
| `CLEANUP_SNAPSHOT_REQUIRED` | 409 | 老 job/缺 snapshot/guard/绑定 | 0 |
| `DEVICE_CLAIM_INVALID` | 409 | 损坏墓碑/claim/slot/guard | 0 |
| `CAPACITY_EXCEEDED` | 400 | 预扫 N≥83 | 0 |
| `LOCAL_FINALIZE_EXHAUSTED` | 200/409 | 终态投影或错误入口；资源不释放 | 0 |
| `ADAPTER_UNAVAILABLE` | 503 | Store/clock 不可用 | 0 |
| `RETRY_NOT_DUE` | 409 | H4-b local finalize 未到 nextAttemptAt | 0 |

HTTP 状态只由统一错误信封输出；H4-c 不新增错误字段，不把原始异常 message/stack 返回。

## 12. 字段白名单

| 对象 | 白名单 | 约束 |
|---|---|---|
| 请求体 | `jobId`、`expectedRevision`、`decision`、`evidence{sourceType,sourceCode,observedAt}` | 精确；未知字段拒绝；sourceType 仅 operator |
| evidence 记录 | 见 §5.2 | 不可变、create-only、无原始载荷 |
| evidence head | 见 §5.4 | 每 job 一条；CAS 更新 |
| K3 domain | 见 §5.3 | 全局 head/version；精确 validator |
| revoke job | H4-b `JOB_FIELDS` 24 项（[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 第 35–40 行） | H4-c 不新增 job 顶层字段；老 job 缺字段失败关闭 |
| job `cleanupSnapshot` | H4-b `SNAPSHOT_FIELDS` 16 项 | 不修改、不重算、不补写 |
| grant | H4-b 现有字段 + `cleanupPending/cleanupJobId/revokedAt/revokedByActorId` | H4-c 只在 R2 通过 H4-b 修改 cleanupPending；不新增字段 |
| reconcile log | H3/H4 既有字段：`_id,orgId,jobId,action,fromState,state,actorType,actorId,at,revision,attempt,leaseGeneration,evidenceScope,errorKind,reasonCode,alertCode` | 不新增 evidenceId/sequence 字段 |
| operation key | `orgId,realm,keyVersion,requestDigest,result,createdAt` | 不存原始幂等键 |
| 响应 | 见 §13 | 最小 DTO |

## 13. 最小响应 DTO 与未来 HTTP 路径

### 13.1 响应矩阵

| 场景 | HTTP | jobState | cleanupPending | cleanupPhase | terminalReason |
|---|---:|---|---|---|---|
| confirmed_removed R1+R2 成功 | 200 | `succeeded` | false | `complete` | null |
| confirmed_removed R1 成功、R2 pending | 202 | `retryable_failed` | true | `finalize` | null |
| confirmed_removed 第 4 次耗尽 | 200 | `terminal_failed` | true | `terminal` | `LOCAL_FINALIZE_EXHAUSTED` |
| confirmed_present | 200 | `terminal_failed` | true | `terminal` | `RECONCILE_CONFIRMED_PRESENT` |
| still_unknown | 200 | `awaiting_result` | true | null | null |
| 不同键同结论的已终态 | 200 | 既有状态 | 依既有 | 依既有 | 依既有 + `duplicate:true` |
| 未提交错误 | 4xx/5xx | — | — | — | 错误信封 |

响应：

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
  "terminalReason": null,
  "duplicate": false
}
```

`cleanupPhase` 是响应投影枚举（`finalize|complete|terminal`），不是 job 的 `cleanupPhase` 存储值（H4-b 存储值只有 `dispatch|finalize`）。

不返回：evidence digest/原始证据、actorId、orgId、idempotency key、requestDigest、opId、设备/人员/文件字段、异常 message/stack。

**ack loss**：R1/R2 提交后响应丢失，同键重放返回相同 200/202/terminal 投影，不重复 evidence/head/资源写；不同键在终态同结论 `duplicate:true`，不同结论 `RECONCILE_CONFLICT`。

### 13.2 HTTP 路径提案（不注册）

沿用 [routes.mjs](../../admin-web/lib/face-service/routes.mjs) 第 54–59 行既有提案，并补充恢复入口提案：

```text
POST /api/v2/device-operation-jobs/:jobId/reconcile
Permission: device.operation.reconcile
Header: Idempotency-Key: <16-128 [A-Za-z0-9._:-]>
Body: §4

POST /api/v2/device-operation-jobs/:jobId/finalize-retry
Permission: device.operation.reconcile
Header: Idempotency-Key: <16-128 [A-Za-z0-9._:-]>
Body: { jobId, expectedRevision }
```

H4-c 不修改 `server.mjs`、不注册路由、不新增权限点；路径仅作为后续 HTTP 卡输入。`finalize-retry` 只做本地 finalize，不得调用 Provider。

## 14. 待 Codex 裁定

### Q1 K3 配置与 domain

**建议**：独立 K3 `H4_EVIDENCE_HMAC_KEY_B64`/`H4_EVIDENCE_KEY_VERSION`/`H4_EVIDENCE_REALM`；HMAC-SHA256；`KEYED_DIGEST/h4-reconcile-evidence`；全局 `evidence_digest_domains` head/version；fingerprint 检测同版本换钥；不复用 K1/K2，不回退无密钥 SHA-256。**请批准新增 K3 与全局 domain 集合。**

### Q2 `confirmed_present` 是否允许未来受控重新派发

**建议**：H4-c 不允许。`terminal_failed` 为终态；未来重新清理 H4-d 新 generation/job。**请裁定。**

### Q3 `still_unknown` 间隔/次数上限

**建议**：60 秒 + 同一 job 最多 8 次；最终 confirmed 裁定可作 sequence 9；由 evidence head CAS 原子执行。**请裁定阈值。**

### Q4 evidence/head 独立集合与 CAS

**建议**：独立 `device_operation_evidence` + `device_operation_evidence_heads`；每 job 一条 head；所有 decision 同事务 CAS；不分叉。**请批准两个组织域集合及 Store 登记。**

### Q5 `confirmed_removed` 两段式与 operation key 指针

**建议**：R1（决定/证据/head/op key）+ R2（H4-b finalize）；op key 存稳定指针；pending 202，complete 200，terminal 200 投影；同键不重复 decision/释放。**请裁定该异步/投影语义。**

### Q6 `finalizeAttempts` 从 1 起算

**建议**：R1 视为第 1 次本地 finalize，`finalizeAttempts=1`；R2 失败递增到 2/3/4。**请裁定，或改用新 `reconcile_pending` phase。**

### Q7 老任务/旧证据失败关闭

**建议**：不迁移/补写/猜测；老 job 缺 snapshot/guard、旧 evidence/head/domain 损坏一律 409。**请裁定。**

### Q8 `LOCAL_FINALIZE_EXHAUSTED` 恢复入口

**建议**：H4-c 内提供 `finalize-retry` 手工本地恢复（权限/CAS/幂等，Provider 0）；否则 H4-c 必须声明 cleanup 不闭环。**请裁定是否接受该入口。**

### Q9 K3 全局 vs 组织域

**建议**：K3 domain 全局，evidence/head 组织域；全局防止按组织绕过同版本换钥。**请裁定集合属性。**

## 15. 连续测试矩阵（RC01–RC64）

记号：`Z`=全库内容级零变化（含 job/grant/slot/claim/device/guard/evidence/head/domain/log/op key/audit）；`P0`=Provider 0；`X`=允许的 H4-c 写集。所有用例先固化注入后基线，再比较。

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| RC01 | `awaiting_result`，无 blocker，confirmed_removed | R1+R2 成功；job succeeded；cleanupPending=false；slot released；无 blocker 时 claim released | 0 | X |
| RC02 | 同上，confirmed_present | job terminal_failed；grant revoked/cleanupPending=true；slot/claim 不变 | 0 | X |
| RC03 | 同上，still_unknown | job 保持 awaiting_result；仅 evidence/head/log/op key/domain/audit | 0 | X |
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
| RC37 | observedAt 非递增/previous 链断 | EVIDENCE_STALE/EVIDENCE_CHAIN_BROKEN/409 | 0 | Z |
| RC38 | still_unknown 同键重放 | 原结果；零写；不新增 sequence | 0 | Z |
| RC39 | still_unknown 新键 | sequence+1；evidence/head/log/op key 各一条 | 0 | X |
| RC40 | 两并发同键 reconcile | 一胜；另一重放；核心写不重复 | 0 | Z/X |
| RC41 | 两并发不同 decision | 一胜；另一 INVALID_STATE/CONFLICT | 0 | Z |
| RC42 | reconcile R2 vs H4-b finalize | 一胜；另一 INVALID_JOB/REVISION_CONFLICT | 0 | X/Z |
| RC43 | reconcile vs expire | 状态互斥；失败方零写 | 0 | Z |
| RC44 | reconcile R2 vs createGrant/guard | guard CAS 拒绝；无错放 claim | 0 | X/Z |
| RC45 | 事务 callback 重跑 | 仅一次提交；log/audit/evidence/head create-only | 0 | X |
| RC46 | 任一失败路径 | 全库内容级 Z；无 grant/job/slot/log/op key/evidence/head 增量 | 0 | Z |
| RC47 | log/audit/op key/evidence/head ID 预占 | 整事务回滚；原记录不变 | 0 | Z |
| RC48 | 注入序列号/IP/MAC/账号/图片/objectKey/原始幂等键 | 证据/日志/响应/审计零命中 | 0 | Z |
| RC49 | Cloud/live/真实 Provider/设备连接 | NOT_CONFIGURED/503；不发起网络/设备调用 | 0 | Z |
| RC50 | 老 job 缺 cleanupSnapshot/cleanupPhase | CLEANUP_SNAPSHOT_REQUIRED/409 | 0 | Z |
| RC51 | 缺 guard/损坏 slot/claim/guard | CLEANUP_SNAPSHOT_REQUIRED/DEVICE_CLAIM_INVALID/409 | 0 | Z |
| RC52 | 成功响应字段扫描 | 仅 §13.1 字段；无 digest/actor/opId/PII | 0 | Z |
| RC53 | K3 head/version 单边缺失 | DOMAIN_INCOMPLETE/409；零写 | 0 | Z |
| RC54 | K3 同版本换钥/fingerprint 不符 | DOMAIN_MISMATCH/409；零写 | 0 | Z |
| RC55 | K3 domain kind/realm/version 内部矛盾 | DOMAIN_INCOMPLETE/409；不自动补写 | 0 | Z |
| RC56 | evidence head 缺失但已有 evidence / head 消失 | EVIDENCE_CHAIN_BROKEN/409；零写 | 0 | Z |
| RC57 | 两并发不同键争同一 head/sequence | 一胜；另一 EVIDENCE_HEAD_CONFLICT；无分叉 | 0 | X/Z |
| RC58 | grant 在事务预读后变化（state/cleanupPending/revision） | 事务内复核失败；REVISION_CONFLICT/INVALID_STATE；零写 | 0 | Z |
| RC59 | grant.cleanupJobId/binding 与 job/snapshot 不符 | CLEANUP_SNAPSHOT_REQUIRED/409；零写 | 0 | Z |
| RC60 | 用户提交 sourceType=mock_provider | EVIDENCE_INVALID/409；不写证据 | 0 | Z |
| RC61 | LOCAL_FINALIZE_EXHAUSTED 后 finalize-retry | job 回 retryable_failed/finalize；本地 finalize 成功；Provider 0 | 0 | X |
| RC62 | finalize-retry 权限/CAS/同键重放 | 403/409 或重放原结果；零重复释放 | 0 | Z |
| RC63 | finalize-retry 再次耗尽 | terminal_failed/LOCAL_FINALIZE_EXHAUSTED 投影；资源不释放；可再次人工恢复 | 0 | X |
| RC64 | 200/202/terminal/ack-loss/不同键重复投影 | 与 §13.1 一致；无重复核心写；Provider 0 | 0 | Z/X |

矩阵共 **64** 条，连续编号，覆盖三种 decision、权限/跨组织/revision、K2/K3/domain、重放/异摘要/损坏、evidence head 分叉、grant 事务复核、candidate/82/83/guard/墓碑、并发 finalize/expire/createGrant/第二个 reconcile、callback/预占、Z/P0/敏感扫描/Cloud-live 失败关闭、local-finalize 耗尽人工恢复与老任务。

## 16. 验收与后续门禁

- 本轮只修改本设计文档；未修改任何生产代码或测试，未注册 HTTP。
- 交付前执行：`git diff --check`、相对链接检查、敏感值扫描；全部通过后再提交/推送。
- H4-c 编码必须在 Codex 对本次返工（尤其 Q1–Q9）终审通过后单独发卡；本设计不构成 H4-c 或完整门禁上线批准。
- H4-d、HTTP 注册、Cloud/live、真实 Provider、真实设备写、`server.mjs` 与 `main` 合并继续关闭。
