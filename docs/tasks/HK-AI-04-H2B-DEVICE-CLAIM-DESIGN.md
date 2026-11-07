# HK-AI-04 H2-b：设备 owner claim 模型设计与测试矩阵

> **H2-a 已由 `f9a2b6b` 正式通过并关闭。本次仍是设计修订，不含生产代码；Codex 复审通过并另发编码卡前，不得开始 H2-b 编码。**
>
> 本文只冻结设计与测试预期，不开放 `createGrant` HTTP，不实现 H2-c/H2-d/H3/H4，不调用 Mock/真实 Provider，不连接设备或生产云。

- 执行：Kimi
- 原参考代码基线：`1116e9d`
- H2-a 关闭基线：`f9a2b6b`
- 本次设计修订基线：`037083d`
- 并行任务卡：`1318c59`
- 修订任务：`HK-AI-NEXT-ASSIGNMENT-2026-11-07.md` A
- 设计日期：2026-11-07
- 复审：Codex

## 1. 目的与范围

把设备所有权和住户授权槽位彻底分开：

1. `device_claims` 是**部署域内设备级、全局唯一**的所有权记录，持有唯一 `ownerOrgId`。
2. `grant_slot_claims` 是**组织内人员＋设备＋入住周期**的授权槽位记录。
3. 同一组织多个住户可在同一设备拥有不同 slot，互不抢占设备 owner claim。
4. `createGrant` 只读取并复核既有 owner claim，不计算、创建、抢占、释放或转移它。
5. `revoke` 只释放对应 slot，不释放设备 owner claim；完整撤权状态机仍属 H4。
6. 跨组织占用必须失败关闭，错误、日志和普通 DTO 不得泄露设备序列号、真实 owner、claim 对应关系或设备唯一标识。
7. H2-b 沿用现有 K1 与 claim ID，不修改 blacklist，不把资格前置优化或新设备登记算法夹带进本阶段。

不在本设计内开放：`device_org_bindings`、真实 Provider、设备写操作、租约派发、HTTP 路由、生产迁移、K1 受控换钥及新设备登记算法。

## 2. 已冻结依据与现状差异

### 2.1 必须遵守的裁定

- `HK-AI-04-H2A-FINAL-APPROVAL-F9A2B6B-2026-11-07.md`：H2-a 已正式关闭；`f9a2b6b` 为已批准基线，不改写历史。
- `HK-AI-PARALLEL-REVIEW-2026-11-07.md`：B1 冻结现有 K1/claim ID；B2 保持 `withEligibility()` 调用边界；B3 收紧 released slot 复用；五项架构裁定已经确认。
- `HK-AI-04-H2-REVIEW-7B7EE6D-2026-11-07.md`：H2-b 只验证既有 owner claim；事务内复核 device/claim/domain 快照；不同人员可共用设备。
- `LOCK-01A-DATA-DESIGN.md`：全局固定 ID、`ownerOrgId`、slot 墓碑、转移审计和 `access_devices.claimId`。
- 早期资料中涉及 NFKC、结构化 JSON HMAC 或新固定 ID 的提案，**不作为 H2-b 编码依据**，统一移入 §4.4 的未来任务。

### 2.2 基线代码需要在未来实现时纠正的差异

以下只是设计核对结论，**本提交不修改这些代码**：

1. 当前 `createGrant` 从事务前 `serialNumber` 计算 claim ID，并在事务内创建/更新 `device_claims`；目标模型改为从 `access_devices.claimId` 取得既有引用，事务只读复核。
2. 当前 owner claim 写入 `grantId`，并用 `isReclaimable(claim, grantId)` 实现“一个 grant 独占一台设备”；该语义必须移除，不能与 slot 共用释放/复用判断。
3. 当前 `createGrant` 调用 `applyDigestDomain()` 可初始化 K1 domain；目标模型要求 domain 在设备登记阶段建立，授权阶段只做只读校验，缺失即失败关闭。
4. H2-b 不修改现有 `deviceDigest()`、`deviceClaimKey()`、序列号规范化、claim ID 格式或历史记录；新算法与迁移不得混入 owner claim 编码提交。
5. 当前测试把 `device_claims` 当作 `orgId` 过滤的组织集合；目标测试必须按全局集合读取，不能用 `orgId` 代替 `ownerOrgId`。

## 3. 核心不变量

| 编号 | 不变量 |
| --- | --- |
| I-01 | 同一 `provider + digestRealm + K1(规范化设备标识)` 只有一个全局 claim ID。 |
| I-02 | active claim 只有一个 `ownerOrgId`；claim ID 本身不含 `orgId`。 |
| I-03 | 一个 active claim 最多绑定一个 active `access_devices` 投影；投影保存 `claimId`。 |
| I-04 | `access_devices.ownerOrgId = access_devices.orgId = device_claims.ownerOrgId = 当前调用 orgId`。本期不开放跨组织共享。 |
| I-05 | grant 只属于一个 slot；slot 固定键为 `orgId + personId + deviceId + cycleId`。 |
| I-06 | 同一设备可拥有多个不同 person/cycle 的 active slot，owner claim 不因此变化。 |
| I-07 | `createGrant` 对 `access_devices`、`device_claims`、`device_digest_domains` 的业务写入数均为 0。 |
| I-08 | `revoke` 对 `device_claims` 的写入数为 0，不能因最后一个 grant 撤销而释放设备。 |
| I-09 | 设备 revision、claimId、provider、realm、keyVersion、ownerOrgId 或 capability 在预读后变化，必须重试或失败关闭。 |
| I-10 | 序列号原文、K1/K2 密钥、完整指纹不得进入固定记录、普通 DTO、日志、测试快照或 Git。 |
| I-11 | 跨组织访问与跨组织占用不得返回 ownerOrgId、fromOrgId、toOrgId、序列号或真实 claim 对应关系。 |
| I-12 | 所有事务 refs 必须预先声明；写入必须属于 refs，且总数遵守现有限制（最多 90 个唯一 refs）。 |

## 4. K1、claim ID 与秘密边界

### 4.1 H2-b 冻结现有实现

- H2-b **不修改**现有 [`deviceDigest()`](../../admin-web/lib/face-service/collections.mjs)、[`deviceClaimKey()`](../../admin-web/lib/face-service/collections.mjs)、序列号规范化、claim ID 格式或历史记录。
- 现有 claim ID 是外部既有引用。`createGrant` 只读取 `access_devices.claimId`，不得重新计算、改换格式或要求迁移历史 ID。
- H2-b 的代码差异和测试不得改动上述 helper 的既有实现与测试向量；owner claim 模型调整不能成为更换 K1 算法的隐式通道。
- K1 与 K2 的配置、密钥、realm 和指纹继续分离；demo/test/live 不得复用部署域与密钥。

### 4.2 K1 domain 只读复核

- 既有 K1 domain head＋version refs 由设备记录和当前配置确定，授权事务只读校验完整性、provider/realm/keyVersion/fingerprint 一致性。
- domain 缺失、损坏或配置不一致均失败关闭；`createGrant` 不调用 `applyDigestDomain()` 初始化或修复 domain。
- K1 配置和密钥只在内存中使用，不进入 claim、普通 DTO、日志或测试快照。

### 4.3 设备快照与序列号边界

- `createGrant` **不读取、不解密、不规范化序列号**，只使用设备记录上的既有 `claimId`。
- H2-b 不实现 `providerDeviceCiphertext` 或密文密钥轮换，也不得为临时实现新增明文序列号字段。
- 事务前读取的设备快照用于形成 refs；事务内必须重新读取并比较 `revision/ownerOrgId/orgId/claimId/provider/digestRealm/keyVersion/status/capabilities.face`。
- 设备身份字段变化必须同时增加 device revision；事务检测到快照不一致时失败关闭，不能改向另一 claim 写入。
- 序列号、MAC、IP、K1/K2 密钥和完整指纹不得进入普通 DTO、日志、测试快照或 Git。

### 4.4 未来设备登记与 K1 迁移任务（另审，非 H2-b 要求）

NFKC、结构化 JSON HMAC、新固定 ID 格式及新设备登记算法全部移到独立的“**未来设备登记与 K1 迁移任务**”。该任务未批准前，上述内容不得进入 H2-b 代码、测试或数据迁移。

未来任务至少必须先提交并复审：

1. 现有算法、claim ID 与历史记录清单；
2. 新旧 ID 映射和受控迁移方案，禁止静默双登记；
3. 迁移期旧读、新读及失败回退的**双读与历史兼容设计**；
4. 并发登记、部分迁移、回滚、换钥和审计场景；
5. 不泄露序列号及设备唯一标识的测试矩阵。

只有迁移、双读和兼容设计另行复审通过后，才可讨论算法实施；H2-b 不承担该任务。

## 5. 记录模型

### 5.1 `device_claims`（全局集合）

| 字段 | 必需性 | 语义 |
| --- | --- | --- |
| `_id` | 必填 | §4 的全局固定 ID。 |
| `provider` | 必填 | 当前仅 `hikvision`。 |
| `digestRealm` | 必填 | 部署域。 |
| `digestDomain` | 必填 | 固定 `KEYED_DIGEST/device`。 |
| `keyVersion` | 必填 | 正安全整数；与 domain/version 一致。 |
| `ownerOrgId` | 必填 | active 时为当前 owner；released 时保留为最后 owner，仅供受限审计。 |
| `state` | 必填 | `active` / `released`。 |
| `boundDeviceId` | active 必填 | 当前唯一 active `access_devices._id`；released 时清除。 |
| `revision` | 必填 | 从 1 开始的正安全整数，每次状态/owner/binding 改变递增。 |
| `createdAt` / `updatedAt` | 必填 | 非负安全整数时间戳。 |
| `activatedAt` / `activatedByAuditId` | active 必填 | 本次取得/重新取得所有权的时间与审计引用。 |
| `releasedAt` / `releasedByAuditId` / `releaseReason` | released 必填 | 墓碑字段；重新 active 时删除，历史由审计保留。 |
| `transferredAt` / `transferredFromOrgId` / `transferredToOrgId` / `transferAuditId` | 转移后必填 | 最近一次转移摘要；完整历史只追加到受限审计。 |

H2-b 新增或变更的记录明确禁止：`orgId`（代替 `ownerOrgId`）、`grantId`、明文序列号、MAC、IP、密钥、完整证书指纹、住户或人脸字段。历史 fixture 原样保留，不在本任务迁移、清洗或重算。

### 5.2 `access_devices`

H2-b 至少要求：

```text
_id / claimId / ownerOrgId / orgId / provider / digestRealm / keyVersion
status / capabilities.face / revision / createdAt / updatedAt
providerDeviceCiphertext（可选、受限）
```

- `claimId` 必须引用已经存在的全局 claim；不允许客户端只提供一个新序列号就进入授权。
- `ownerOrgId` 是授权所有权，`orgId` 是当前展示/归属组织；本期二者必须一致。
- 修改 `claimId/provider/digestRealm/keyVersion/ownerOrgId/providerDeviceCiphertext` 必须增加 revision 并写受限审计。

### 5.3 `grant_slot_claims`（组织内固定键）

固定 ID 的各分段必须安全编码，禁止分隔符碰撞：

```text
grant-slot:{orgId}:{personId}:{deviceId}:{cycleId}
```

| 字段 | active | released |
| --- | --- | --- |
| `orgId/personId/deviceId/cycleId` | 必填且不可变 | 保留 |
| `activeClaimId` | 必填，值为当前 `grantId`，**不是设备 claimId** | 清除 |
| `state` | `active` | `released` |
| `revision` | 正安全整数 | 每次释放/复用递增 |
| `createdAt` | 首次创建时间保留 | 保留 |
| `activatedAt` | 本次占用时间 | 保留最近占用历史摘要 |
| `releasedAt/releasedByJobId` | 删除 | 必填 |
| `updatedAt` | 必填 | 必填 |

slot 可保存 `deviceClaimId` 作为一致性复核字段，但不能用它代替 `activeClaimId`，也不能让 slot 成为设备 owner 的第二个写入口。

**墓碑复用语义**：`state=released` 本身不足以授权复用。同一 cycle 的新操作必须同时满足以下全部条件：

1. 由 `releasedByJobId → revoke job.grantId` 定位的旧 grant 存在，且状态为 `revoked` 或 `expired`；`cleanupPending !== true`。不得依赖已清除的 `activeClaimId` 反查旧 grant。
2. 旧 grant 关联的全部设备任务均为终态 `succeeded/terminal_failed/cancelled`；任一 `queued/sending/awaiting_result/retryable_failed` 或其他非终态均阻止复用。
3. slot 墓碑完整：`state=released`、`activeClaimId` 已清除、`releasedAt` 为非负安全整数、`releasedByJobId` 为合法非空引用、`revision` 为正安全整数。
4. `releasedByJobId → revoke job.grantId → 旧 grant` 链完整一致，revoke job 同时属于旧 grant 的 `deviceId`；`orgId/personId/deviceId/cycleId` 与当前 slot 一致。
5. 事务预读并声明旧 grant、`releasedByJobId` 指向的 revoke job 及旧 grant 全部关联 jobs 的 refs，事务内逐项复核快照、revision、终态和关联链，不能只检查 `state=released`。

任一条件不满足统一返回 `GRANT_SLOT_CONFLICT/409`，业务写入为 0。全部满足时才创建新的 grant/job/op；复用时 `activeClaimId` 改为新 grant、slot revision＋1，并删除旧 `releasedAt/releasedByJobId`。旧 grant 永不复活，旧历史由 grant/job/log/audit 保留。

## 6. 生命周期与并发

### 6.1 首次建立（未来设备登记独立任务，不是 createGrant）

本节只记录现有登记边界，**不属于 H2-b 编码范围**，沿用而不修改当前 helper。NFKC、结构化 JSON HMAC 和新固定 ID 等算法变更只能走 §4.4 的独立迁移复审，不得因本节进入 H2-b。

未来登记任务预读组织/成员权限，按届时获准的既有算法处理序列号并形成 K1 claim/domain refs，然后在一个事务中：

1. 复核当前权限、组织状态和 K1 domain head＋version。
2. 空 domain 才允许同时初始化 head＋version；不完整或配置变化失败关闭。
3. claim 不存在：创建 `state=active`、`ownerOrgId=当前组织`、`boundDeviceId=设备ID`、`revision=1` 的 claim。
4. 创建 `access_devices`，其 `claimId/ownerOrgId/provider/realm/keyVersion` 与 claim 一致。
5. 同事务追加受限 `admin_audit`；不写 grant、slot、job，不调用 Provider。

### 6.2 重复使用

| 场景 | 结果 |
| --- | --- |
| 同 owner、同 device、同 claim 的登记重放 | 返回既有结果；revision、审计和业务记录不重复增加。 |
| 同 owner、同 claim、不同 deviceId | `DEVICE_CLAIM_CONFLICT/409`，不创建第二个 active 设备投影。 |
| 不同 owner 的 active claim | `DEVICE_CLAIM_CONFLICT/409` 通用错误，不泄露真实 owner。 |
| 同 owner、多个住户 createGrant | 每个独立 slot 可分别成功；claim/domain/device 均不改写。 |
| released claim 重新登记 | 只能走显式设备登记流程；校验无 active 设备投影，revision＋1，写激活审计并删除墓碑字段。createGrant 不得自动重新激活。 |

### 6.3 设备转移（独立受控任务，不在 H2-b 编码）

1. 默认拒绝直接改 `ownerOrgId`；不得通过换 K1、重建 claim 或撤销单个 grant 实现转移。
2. 转移前，源组织所有 grant 必须为 `revoked/expired` 且无 `cleanupPending=true`；所有关联 job 必须为关闭状态。否则 `DEVICE_TRANSFER_BLOCKED/409`。
3. 预读所有相关 grant/job/device/claim/domain 快照并声明 refs；超过事务容量则拒绝，不分批提交部分转移。
4. 同一事务内复核全部 revision 和状态，解绑源设备、变更 claim owner/binding、建立目标设备投影，并追加 `fromOrgId/toOrgId/auditId` 受限审计。
5. owner 改变采用 revision＋1 的 active→active 原子转移；不会在中间提交可被 createGrant 利用的 released 状态。
6. 转移与 createGrant 并发时，双方都必须引用 device＋claim；只有一个能基于原 revision 成功，另一个重试或 `REVISION_CONFLICT/409`，不得出现旧 owner 新 grant。

本阶段不自动完成旧组织撤权；需要撤权时必须先由 H4 闭环完成，再允许转移。

### 6.4 释放与墓碑

- **设备 claim 释放**：只用于设备解绑/退役的独立管理流程；存在 active slot、有效 grant、未关闭 job 或 active 设备投影时拒绝。写 `state=released`、释放时间与审计，revision＋1，不删除记录。
- **slot 释放**：revoke 事务写 `state=released/releasedAt/releasedByJobId`，清除 `activeClaimId`，revision＋1。
- 设备 claim 与 slot 不得继续共用当前 `releaseClaim()` / `isReclaimable()` 的 grant 语义；两者使用不同校验器。

## 7. `createGrant` 事务契约（H2-b 部分）

### 7.1 调用边界与真实重放语义

1. 保持现有 [`BlacklistService.withEligibility()`](../../admin-web/lib/blacklist.mjs) 调用边界，**不修改 blacklist**。当前成员权限仍优先；权限通过后才进入该边界。
2. `withEligibility()` 会先准备／评价资格。operation key 合法重放**不跳过该过程**，也不在前置阶段直接返回。
3. 重放在 `withEligibility()` 的事务 `build` 内识别：返回旧 `result` 和 `writes: []`，grant/job/slot/claim/log/op/domain 等业务集合均不变化，Provider 调用为 0。
4. 同 operation key 不同请求摘要同样不得绕过上述调用边界，在事务 `build` 内返回 `CONFLICT/409` 且零业务写入。
5. 新操作预读 device，按 `device.claimId` 形成 ref；**不得从 serialNumber 重新计算 claim ID**。
6. 使用 `orgId/personId/deviceId/cycleId` 形成 slot ref，并声明全部资格、K2 domain 和结果记录 refs。operation key 前置重放优化留给 H2-c，不属于 H2-b。

### 7.2 refs 与写入

| 记录 | 事务内用途 | H2-b 是否允许写入 |
| --- | --- | --- |
| `organizations/{orgId}`、`org_memberships/{membershipId}` | 当前组织、成员和权限复核 | 否 |
| `operation_keys/{opKey}`、`operation_key_domains/head+version` | H2-a 重放、域与结果 | 按 H2-a，允许 op/domain 原子写 |
| `face_credentials/{credentialId}`、`file_assets/{sourceFileId}` | 人员、审核、revision 与文件绑定 | 否 |
| person/identity/occupancy/cycle/room/building/community/eligibility 所需 refs | H2-c 完整资格快照 | 由 H2-c 冻结，不在本文扩大 |
| `access_devices/{deviceId}` | 复核预读快照、active、`capabilities.face=true` | **否** |
| `device_digest_domains/head+version` | 只读校验 K1 provider/realm/version/fingerprint 完整性 | **否** |
| `device_claims/{device.claimId}` | 只读复核 active、owner、binding、provider/realm/version | **否** |
| `grant_slot_claims/{slotId}` | 新占用、同 grant 重入或墓碑复用 | 是 |
| `releasedByJobId → revoke job.grantId` 定位的旧 `device_access_grants/{grantId}` | 仅墓碑复用时：复核 revoked/expired、cleanupPending 和关联链，不使用已清除的 activeClaimId | **否** |
| `releasedByJobId` 指向的 revoke job 及旧 grant 全部关联 `device_operation_jobs` | 仅墓碑复用时：预读并声明全部 refs，复核终态、grant/device 关联和快照 | **否** |
| 新 `device_access_grants/{grantId}` | 新建 pending grant | 是 |
| 新 `device_operation_jobs/{jobId}` | 新建 queued job，lease 为空、attempts=0 | 是 |
| `device_operation_logs/{logId}` | 追加首条确定性日志 | 是 |

墓碑复用所需旧 grant/job refs 必须在新操作预读阶段确定并全部声明；超过事务容量时失败关闭，不得用少读、未声明写入或分批提交绕过。

### 7.3 授权事务 `build` 内复核顺序

1. 复核 operation key（包括防竞态检查）。合法重放按 §7.1 返回旧结果和 `writes: []`；同键异摘要返回 `CONFLICT/409`。
2. 使用 `withEligibility()` 已准备／评价的资格与 credential/file 快照，不提前绕过资格，不在 H2-b 改变其语义。
3. device 存在且可见，精确复核预读 revision 和 I-04/I-09 字段。
4. K1 domain head＋version 完整，内部字段一致且与当前配置一致；只读，不自动补写。
5. claim 存在、active，`boundDeviceId=deviceId`，`ownerOrgId=orgId`，provider/realm/keyVersion 与 device/domain 一致。
6. slot 不存在则创建；active 且 `activeClaimId` 属于其他 grant 则冲突；released 则必须按 §5.3 复核全部旧 grant/job refs 后才可复用。
7. 同一事务写 grant/job/slot/log/op 及 H2-a/H2-c 已批准 writes；任一项失败全部回滚，Provider 调用为 0。

grant 至少保存 `claimId/slotId/identityApplicationId/approverId/executionMode/evidenceScope`；job 至少保存 `opId/requestDigest`；审计不得保存序列号、名单详情或人脸摘要。

## 8. `revoke` 的 claim/slot 边界（仅 H4 预研）

当前仍返回 `STAGE_CLOSED`；下表不是开放编码的许可。

### 8.1 refs

- `organizations/{orgId}`、`org_memberships/{membershipId}`；
- `device_access_grants/{grantId}` 及其 `grant_slot_claims/{grant.slotId}`；
- `access_devices/{grant.deviceId}`、`device_claims/{grant.claimId}`，用于快照一致性复核；
- 新 revoke `device_operation_jobs/{jobId}`、`device_operation_logs/{logId}`；
- `operation_keys/{opKey}`、`operation_key_domains/head+version`；
- H4 若需处理既有未关闭 job，必须预读并显式加入其 refs，不得事务内追加未声明写入。

### 8.2 writes 与禁止事项

1. 当前权限有效且 grant 属于本组织；同 op 重放返回原结果。
2. grant → `revoked`、`cleanupPending=true`、revision＋1。
3. slot → released，记录 `releasedAt/releasedByJobId`，清除 `activeClaimId`，revision＋1。
4. 新建 revoke queued job、首条 log 和 operation key；不得重新执行黑名单/入住资格检查，不得要求设备在线。
5. **不写 `device_claims`，不改 ownerOrgId/boundDeviceId/revision，不释放设备。**
6. 清理成功后由 H4 清除 `cleanupPending`；grant 保持 revoked，slot 保持 released，不能恢复旧授权。

## 9. 错误与信息暴露

| 错误 | HTTP | 使用场景 | 业务写入 |
| --- | --- | --- | --- |
| `NOT_FOUND` | 404 | device/credential 不存在或跨组织不可见 | 0 |
| `FORBIDDEN` | 403 | 当前成员权限不足或已撤权 | 0 |
| `DEVICE_CLAIM_CONFLICT` | 409 | 其他 owner 占用、同 claim 重复绑定不同 device、转移/释放条件冲突 | 0 |
| `DEVICE_CLAIM_INVALID` | 409 | claim 缺失、released、字段不完整或 device/claim 引用不一致 | 0 |
| `DEVICE_DIGEST_CONFIG_CHANGED` | 503 | 完整 K1 domain 与当前版本/指纹配置不一致 | 0 |
| `DOMAIN_INCOMPLETE` | 503 | K1 head/version 缺失、损坏或内部矛盾 | 0 |
| `NOT_CONFIGURED` | 503 | K1/K2 配置缺失或非法 | 0 |
| `REVISION_CONFLICT` | 409 | device/claim/credential 等预读快照已变化 | 0 |
| `INVALID_STATE` | 409 | device 非 active 或 `capabilities.face` 不可用 | 0 |
| `GRANT_SLOT_CONFLICT` | 409 | slot 已被其他 active grant 占用；或 released slot 的旧 grant 状态、cleanupPending、关联 jobs 终态、墓碑字段、revision、releasedByJobId 关联链及 refs 中任一项不满足 §5.3 | 0 |
| `DEVICE_TRANSFER_BLOCKED` | 409 | 转移时仍有有效 grant、清理或未关闭 job | 0 |
| `CONFLICT` | 409 | 同 operation key 不同请求摘要或重放记录损坏 | 0 |

对外消息只写“设备不可用/设备归属冲突”等通用描述。`DEVICE_CLAIM_CONFLICT` 的响应不得附带 `ownerOrgId/fromOrgId/toOrgId/claimId/boundDeviceId/serialNumber`；详细对应关系只能进入具备 `device.audit.read` 的受限审计。

## 10. 测试矩阵（36 项）

统一断言：所有失败场景 grant/job/slot/claim/log/op/domain 无业务变化，Provider 调用为 0；所有成功创建场景 Provider 仍为 0。涉及全局 claim/domain 的断言不得用 orgId 过滤来掩盖其他组织记录。

| ID | 场景与操作 | 必须断言 |
| --- | --- | --- |
| D01 | 重跑当前序列号规范化的全部既有测试向量与历史 fixture | 结果与基线逐字节一致；不新增、不替换规范化规则，不迁移历史记录。 |
| D02 | 重跑当前 `deviceDigest()` 的全部固定向量 | 摘要与调用行为保持不变；helper 实现及既有测试未被改写。 |
| D03 | 重跑当前 `deviceClaimKey()`、claim ID 格式与历史 ID 向量 | 全部输出保持不变；H2-b 不要求重算或替换历史 claim ID。 |
| D04 | 既有 K1/K2 配置异常回归 | 保持现有失败关闭行为及错误分类，零写入；K1/K2 配置互不替代，不借测试修改 helper。 |
| D05 | H2-b 新增／变更 claim 的 schema 检查及历史 fixture 兼容 | 新增／变更记录必填字段、时间戳、revision 合法，禁止 `grantId/orgId/serialNumber` 等字段；历史 fixture 原样保留，不自动迁移、清洗或重算。 |
| D06 | createGrant 遇到空 domain | `DOMAIN_INCOMPLETE/503`，head/version 均不初始化，claim/device/grant/slot/job 不写。 |
| D07 | domain 只有 head、只有 version、kind 错误或字段互相矛盾 | `DOMAIN_INCOMPLETE/503`，不自动补写。 |
| D08 | 完整 domain 遇到同版本换 key 或 keyVersion 改变 | `DEVICE_DIGEST_CONFIG_CHANGED/503`，不产生第二个 claim。 |
| D09 | 读取既有 active owner claim 与历史 fixture | 既有 ID、owner、binding 和 revision 在授权前后不变；无登记、重新激活或 owner 迁移副作用。 |
| D10 | createGrant 仅通过 access_device.claimId 定位 owner claim | 对摘要、固定键及规范化 helper 的调用计数均为 0；不读取序列号，不调用 `applyDigestDomain()`，既有 claim 可正常使用。 |
| D11 | claim.boundDeviceId 指向其他 active device | `DEVICE_CLAIM_INVALID/409`，不向另一 device 或替代 claim 写入，不创建第二个投影。 |
| D12 | A、B 两组织以各自 deviceId 并发 createGrant，claim owner 仅属于 A | A 可基于既有 claim 创建，B 按可见性 404 或通用 `DEVICE_CLAIM_CONFLICT/409`；owner/binding 不变，响应无真实 owner/claim/serial。 |
| D13 | released owner claim 上调用 createGrant | `DEVICE_CLAIM_INVALID/409`，不得自动重新激活、删除墓碑或增加 revision；显式登记路径不在本阶段实现。 |
| D14 | access_device 缺 claimId、claim 不存在或 device/claim 的 provider/realm/keyVersion 不一致 | `DEVICE_CLAIM_INVALID/409`，零写入，不计算新 claim。 |
| D15 | 同组织人员 P1 在设备 D 创建 grant | 复用既有 claim；device/claim/domain revision 与内容不变；新增一个 pending grant/queued job/slot/log/op。 |
| D16 | 同组织人员 P2 在同一设备 D 创建 grant | 成功且生成不同 slot；D15 的 grant/slot 不变；新增／变更 claim 不写 grantId。 |
| D17 | 同一人员在同一设备的新 cycle 创建 grant | 新 slot 成功，旧 cycle slot/grant 不复活；owner claim 不变。 |
| D18 | 同一 person/device/cycle 使用不同 op key 并发创建 | 只有一个新 grant 成功，另一个 `GRANT_SLOT_CONFLICT/409`；无双 grant/job/log。 |
| D19 | 同一 operation key/input 重放 | 调用计数证明本次仍进入 `withEligibility()` 且资格 prepare/evaluate 确实执行；事务 build 返回旧 result、`writes: []`，业务集合不变，Provider=0。 |
| D20 | 同 operation key 不同 input | 仍进入 `withEligibility()` 及其资格 prepare/evaluate，在事务 build 内返回 `CONFLICT/409`；不能借重放绕过该调用边界，零业务写入，Provider=0。 |
| D21 | active slot 指向其他 grant，或 activeClaimId 缺失/损坏 | 失败关闭；不得把损坏 slot 当作可复用墓碑。 |
| D22 | released slot 同 cycle 合法复用 | 旧 grant 为 revoked/expired、`cleanupPending !== true`、全部关联 jobs 均为三种终态，墓碑字段/revision/关联链完整且全部 refs 已声明时才成功；新 grant/job/op 创建，slot revision＋1、activeClaimId 为新 grant、旧 released 字段删除，旧 grant/jobs 不变且旧 grant 不复活。 |
| D23 | released slot 的旧 grant 逐项为非 revoked/expired | 每项均 `GRANT_SLOT_CONFLICT/409`，即使 state=released 也不复用，零业务写入。 |
| D24 | released slot 的旧 grant `cleanupPending=true` | `GRANT_SLOT_CONFLICT/409`，不得清理该标志、复用 slot 或复活旧 grant，零业务写入。 |
| D25 | 旧 grant 关联 job 逐项为 `queued/sending/awaiting_result/retryable_failed` 及未知非终态 | 每项均 `GRANT_SLOT_CONFLICT/409`；全部旧 jobs 已预读并声明 refs，不能只检查 releasedByJobId；零业务写入。 |
| D26 | 墓碑字段、revision、关联链或 refs 逐项异常 | `state` 非 released、activeClaimId 未清除、releasedAt 非法、revision 非正安全整数、releasedByJobId 空/非 revoke/错 device/错 grant、旧 job 漏声明等每项均 `GRANT_SLOT_CONFLICT/409`，零业务写入。 |
| D27 | 预读后 device revision 或 claimId/provider/realm/keyVersion/ownerOrgId 改变 | `REVISION_CONFLICT/409` 或有界重试后仍失败；事务逐项识别，不能只比较 orgId/status，不能写旧 claim/domain。 |
| D28 | 预读后 claim revision、owner 或 binding 改变 | `REVISION_CONFLICT/409` 或通用归属冲突；grant/slot 不写。 |
| D29 | createGrant 全部成功路径检查 writes 白名单及 device 非 active／`capabilities.face != true` 失败路径 | 成功时 `device_claims/device_digest_domains/access_devices` 写次数为 0，未声明写入被 Store 拒绝；失败时 `INVALID_STATE/409` 且 claim/slot/grant/job/op 不变。 |
| D30 | revoke 单个 grant（H4 放行后） | 仅目标 grant/slot/revoke job/log/op 改变；其他住户 slot 与 owner claim 完全不变。 |
| D31 | revoke 最后一个 grant、同 op 重放及清理完成 | owner claim 仍不释放；重放不新增 job；清理后 grant 不恢复、slot 不自动 active。 |
| D32 | 设备有 active slot/有效 grant/cleanupPending/未关闭 job 时转移或释放 | `DEVICE_TRANSFER_BLOCKED/409` 或通用冲突；claim owner/binding/revision 不变。 |
| D33 | 全部旧 grant/job 关闭后 A→B 转移（独立任务放行后） | 单事务解绑源设备并绑定目标；claim revision＋1，from/to/audit 完整；旧 grant 不复活。 |
| D34 | 转移与 createGrant 并发 | 仅一个基于原快照成功；另一方冲突/有界重试；不存在旧 owner 下新增 grant。 |
| D35 | 设备 claim 释放后并发 createGrant 与重新登记（独立任务放行后） | createGrant 不得自动激活；重新登记只有一个成功；无 active grant 与 released claim 的矛盾状态。 |
| D36 | 错误 DTO、普通列表、日志、审计导出和 Git 快照扫描 | 无序列号、MAC、IP、K1/K2、完整指纹、原始幂等键；跨组织错误不暴露 owner/from/to。 |

## 11. 已确认架构裁定

以下五项已经确认，本次 Codex 复审应核对其落实一致性，不再作为开放问题扩大 H2-b：

1. `device_claims.boundDeviceId` 是“同一物理设备只有一个 active access_device 投影”的约束字段，授权事务必须只读复核。
2. K1 domain 缺失在 createGrant 中一律 `DOMAIN_INCOMPLETE/503`，不得由授权路径首次初始化。
3. released slot 只有满足 §5.3 的全部严格条件才可在同 cycle 复用；旧 grant 永不复活，任一条件不满足均为 `GRANT_SLOT_CONFLICT/409`。
4. 设备登记、释放和转移均属独立受控任务；其权限点、operation key 方法名及审计 DTO 在各自任务卡冻结，不能复用 `face.grant` 或普通住户权限。
5. `providerDeviceCiphertext` 的加解密密钥管理与轮换不属于 H2-b；实施前必须引用独立安全设计，不得临时明文保存 serialNumber。

## 12. 验收边界

**本次设计只有经 Codex 复审通过并另发 H2-b 编码卡后，才可开始定点编码。** H2-a 已由 `f9a2b6b` 关闭，但本提交本身不是编码许可。未来获准编码时须满足：

- 只修改编码卡点名的 claim/device/slot 代码与测试，不夹带 H2-c/H2-d/H3/H4，不修改 blacklist 或 K1 helper；
- 恢复全部 H1/H2-a 回归，新增本矩阵中获准的用例；
- 服务层、集合、Admin 全量和根测试通过；
- 所有失败路径零业务写入、Provider 零调用；
- 不注册 HTTP、不调用真实或 Mock Provider、不连接设备或生产云；
- `allowDeviceOperations=false`，真实写接口继续关闭。
