# HK-AI-04 H2-b：设备 owner claim 模型设计与测试矩阵

> **预研，H2-a 通过前禁止编码。**
>
> 本文只冻结设计与测试预期，不修改生产代码，不开放 `createGrant` HTTP，不实现 H4 撤权闭环，不调用 Mock/真实 Provider，不连接设备或生产云。

- 执行：Kimi
- 参考代码基线：`1116e9d`
- 并行任务卡：`1318c59`
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

不在本设计内开放：`device_org_bindings`、真实 Provider、设备写操作、租约派发、HTTP 路由、生产迁移和 K1 受控换钥。

## 2. 已冻结依据与现状差异

### 2.1 必须遵守的裁定

- `HK-AI-04-SHARED-DECISIONS-9BB91F9-2026-11-06.md`：K1 配置、设备标识规范化、结构化 HMAC、摘要域及换钥保护。
- `HK-AI-04-H2-REVIEW-7B7EE6D-2026-11-07.md`：H2-b 只验证既有 owner claim；事务内复核 device/claim/domain 快照；不同人员可共用设备。
- `HK-AI-04-H2A-PART2-REREVIEW-1116E9D-2026-11-07.md`：H2-a 尚未关闭，本文不得成为编码许可。
- `LOCK-01A-DATA-DESIGN.md`：全局固定 ID、`ownerOrgId`、slot 墓碑、转移审计和 `access_devices.claimId`。

### 2.2 基线代码需要在未来实现时纠正的差异

以下只是设计核对结论，**本提交不修改这些代码**：

1. 当前 `createGrant` 从事务前 `serialNumber` 计算 claim ID，并在事务内创建/更新 `device_claims`；目标模型改为从 `access_devices.claimId` 取得既有引用，事务只读复核。
2. 当前 owner claim 写入 `grantId`，并用 `isReclaimable(claim, grantId)` 实现“一个 grant 独占一台设备”；该语义必须移除，不能与 slot 共用释放/复用判断。
3. 当前 `createGrant` 调用 `applyDigestDomain()` 可初始化 K1 domain；目标模型要求 domain 在设备登记阶段建立，授权阶段只做只读校验，缺失即失败关闭。
4. 当前 K1 的序列号规范化与摘要消息仍需对齐冻结的 NFKC、ASCII 大写、字符白名单及 JSON 结构化消息；不得沿用简单字符串拼接。
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

### 4.1 设备标识规范化

只在设备登记/受控转移流程中，从厂商可信来源取得完整设备序列号：

```text
NFKC → trim → ASCII 大写 → 校验 [A-Z0-9._:-]{1,128}
```

不得使用 IP、MAC、型号或用户可编辑名称代替序列号。非法输入直接拒绝，零业务写入。

### 4.2 HMAC 消息与固定 ID

```js
JSON.stringify([
  "KEYED_DIGEST/device",
  "v1",
  "hikvision",
  digestRealm,
  keyVersion,
  normalizedDeviceIdentifier,
])
```

对以上消息执行 HMAC-SHA256，输出小写 64 位 hex：

```text
provider-device:hikvision:{digestRealm}:{digestHex}
```

`digestRealm` 为部署域，不含组织 ID；demo/test/live 不得复用 realm＋key。K1 与 K2 的配置、密钥、realm 和指纹完全分离。

### 4.3 内存与持久化边界

- K1 密钥、明文序列号只在登记/转移流程的内存中使用；不得持久化到 `device_claims`。
- 序列号如需保存，只能进入受限 `access_devices.providerDeviceCiphertext`；不得进入普通列表、错误信息或审计详情。
- `createGrant` **不需要读取或解密序列号**，只使用设备记录上的 `claimId`。
- 事务前读取的设备快照用于形成 refs；事务内必须重新读取并比较 `revision/ownerOrgId/orgId/claimId/provider/digestRealm/keyVersion/status/capabilities.face`。
- 设备身份字段变化必须同时增加 device revision；事务检测到快照不一致时失败关闭，不能改向另一 claim 写入。

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

明确禁止：`orgId`（代替 `ownerOrgId`）、`grantId`、明文序列号、MAC、IP、密钥、完整证书指纹、住户或人脸字段。

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

**墓碑复用语义**：同一 cycle 的新操作可以复用固定 slot 记录，但必须创建新的 grant/job/op，不能复活旧 grant；复用时 `activeClaimId` 改为新 grant、revision＋1，并删除旧 `releasedAt/releasedByJobId`。旧历史由 grant/job/log/audit 保留。

## 6. 生命周期与并发

### 6.1 首次建立（设备登记，不是 createGrant）

预读组织/成员权限，内存规范化序列号并计算 K1 claim/domain refs，然后在一个事务中：

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

### 7.1 前置

1. 先执行 H2-a 冻结的当前权限与 operation key 前置重放检查；合法重放不再做资格或设备写入。
2. 新操作预读 device，按 `device.claimId` 形成 ref；**不得从 serialNumber 重新计算 claim ID**。
3. 使用 `orgId/personId/deviceId/cycleId` 形成 slot ref，并声明全部资格、K2 domain 和结果记录 refs。

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
| `device_access_grants/{grantId}` | 新建 pending grant | 是 |
| `device_operation_jobs/{jobId}` | 新建 queued job，lease 为空、attempts=0 | 是 |
| `device_operation_logs/{logId}` | 追加首条确定性日志 | 是 |

### 7.3 事务内复核顺序

1. 当前成员权限与 operation key（包括第二次防竞态检查）。
2. H2-c 完整资格与 credential/file 快照。
3. device 存在且可见，精确复核预读 revision 和 I-04/I-09 字段。
4. K1 domain head＋version 完整，内部字段一致且与当前配置一致；只读，不自动补写。
5. claim 存在、active，`boundDeviceId=deviceId`，`ownerOrgId=orgId`，provider/realm/keyVersion 与 device/domain 一致。
6. slot 不存在则创建；active 且 `activeClaimId` 属于其他 grant 则冲突；released 则按 §5.3 复用。
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
| `GRANT_SLOT_CONFLICT` | 409 | slot 已被其他 active grant 占用 | 0 |
| `DEVICE_TRANSFER_BLOCKED` | 409 | 转移时仍有有效 grant、清理或未关闭 job | 0 |
| `CONFLICT` | 409 | 同 operation key 不同请求摘要或重放记录损坏 | 0 |

对外消息只写“设备不可用/设备归属冲突”等通用描述。`DEVICE_CLAIM_CONFLICT` 的响应不得附带 `ownerOrgId/fromOrgId/toOrgId/claimId/boundDeviceId/serialNumber`；详细对应关系只能进入具备 `device.audit.read` 的受限审计。

## 10. 测试矩阵（36 项）

统一断言：所有失败场景 grant/job/slot/claim/log/op/domain 无业务变化，Provider 调用为 0；所有成功创建场景 Provider 仍为 0。涉及全局 claim/domain 的断言不得用 orgId 过滤来掩盖其他组织记录。

| ID | 场景与操作 | 必须断言 |
| --- | --- | --- |
| D01 | 序列号 NFKC、trim、ASCII 大写后等价输入登记 | 得到同一 claim ID；非法字符、空值、超长按用例分别拒绝且零写入。 |
| D02 | 固定测试向量计算 K1 | 与冻结 JSON 消息及 HMAC-SHA256 小写 hex 完全一致；不是旧字符串拼接结果。 |
| D03 | provider/realm/keyVersion/serial 分别变化 | 摘要或固定 ID 按契约变化；realm 不含 orgId；无分段碰撞。 |
| D04 | K1 缺 key、非 32 字节、非法 Base64、非法版本/realm | `NOT_CONFIGURED/503`，零写入；K1/K2 配置互不替代。 |
| D05 | claim schema 检查 | 必填字段、时间戳、revision 合法；存在 `grantId/orgId/serialNumber` 等禁止字段即拒绝。 |
| D06 | 空 domain 首次登记 | head＋version＋claim＋access_device＋audit 原子成功，无 grant/slot/job。 |
| D07 | domain 只有 head、只有 version、kind 错误或字段互相矛盾 | `DOMAIN_INCOMPLETE/503`，不自动补写。 |
| D08 | 完整 domain 遇到同版本换 key 或 keyVersion 改变 | `DEVICE_DIGEST_CONFIG_CHANGED/503`，不产生第二个 claim。 |
| D09 | 首次设备登记 | claim 为 active、唯一 ownerOrgId、boundDeviceId 正确、revision=1；序列号不明文落盘。 |
| D10 | 同 owner/device/claim 登记重放 | 返回原结果，记录数、revision、审计数不增加。 |
| D11 | 同 owner 以不同 deviceId 登记同一物理设备 | `DEVICE_CLAIM_CONFLICT/409`，第二个 access_device 不创建。 |
| D12 | A、B 两组织并发登记同一序列号 | 仅一个全局 active claim；另一方通用冲突，响应无真实 owner/claim/serial。 |
| D13 | released claim 由显式登记流程重新激活 | revision＋1、激活审计存在、旧 released 字段删除；createGrant 本身不能触发此路径。 |
| D14 | access_device 缺 claimId、claim 不存在或 claim released | `DEVICE_CLAIM_INVALID/409`，零写入，不计算新 claim。 |
| D15 | 同组织人员 P1 在设备 D 创建 grant | 复用既有 claim；device/claim/domain revision 与内容不变；新增一个 pending grant/queued job/slot/log/op。 |
| D16 | 同组织人员 P2 在同一设备 D 创建 grant | 成功且生成不同 slot；D15 的 grant/slot 不变；claim 仍只有一个且无 grantId。 |
| D17 | 同一人员在同一设备的新 cycle 创建 grant | 新 slot 成功，旧 cycle slot/grant 不复活；owner claim 不变。 |
| D18 | 同一 person/device/cycle 使用不同 op key 并发创建 | 只有一个新 grant 成功，另一个 `GRANT_SLOT_CONFLICT/409`；无双 grant/job/log。 |
| D19 | 同一 operation key/input 重放 | 返回原结果，资格不再执行，所有业务集合无变化，Provider=0。 |
| D20 | 同 operation key 不同 input | `CONFLICT/409`，不能借重放绕过 slot/claim 校验，零写入。 |
| D21 | active slot 指向其他 grant，或 activeClaimId 缺失/损坏 | 失败关闭；不得把损坏 slot 当作可复用墓碑。 |
| D22 | released slot 同 cycle 复用 | 新 grant/job/op 成功；slot revision＋1、activeClaimId 为新 grant，旧 released 字段删除，旧 grant 不复活。 |
| D23 | 跨组织 deviceId、伪造 device.ownerOrgId/orgId、claim owner 为其他组织 | 分别按可见性返回 404 或通用 `DEVICE_CLAIM_CONFLICT/409`，不泄露 owner。 |
| D24 | device 与 claim 的 provider/realm/keyVersion/boundDeviceId 不一致 | `DEVICE_CLAIM_INVALID/409`，不向任何“看起来匹配”的替代 claim 写入。 |
| D25 | device 非 active 或 `capabilities.face != true` | `INVALID_STATE/409`，claim/slot/grant/job/op 不变。 |
| D26 | 预读后修改 device revision | `REVISION_CONFLICT/409` 或有界重试后仍失败；不能写旧 claim/domain。 |
| D27 | 预读后仅修改 claimId/provider/realm/keyVersion/ownerOrgId，revision 同步改变 | 事务内逐项识别，失败关闭；不能只比较 orgId/status。 |
| D28 | 预读后 claim revision、owner 或 binding 改变 | `REVISION_CONFLICT/409` 或通用归属冲突；grant/slot 不写。 |
| D29 | createGrant 全部成功路径检查 writes 白名单 | `device_claims/device_digest_domains/access_devices` 写次数为 0；未声明写入被 Store 拒绝。 |
| D30 | revoke 单个 grant（H4 放行后） | 仅目标 grant/slot/revoke job/log/op 改变；其他住户 slot 与 owner claim 完全不变。 |
| D31 | revoke 最后一个 grant、同 op 重放及清理完成 | owner claim 仍不释放；重放不新增 job；清理后 grant 不恢复、slot 不自动 active。 |
| D32 | 设备有 active slot/有效 grant/cleanupPending/未关闭 job 时转移或释放 | `DEVICE_TRANSFER_BLOCKED/409` 或通用冲突；claim owner/binding/revision 不变。 |
| D33 | 全部旧 grant/job 关闭后 A→B 转移 | 单事务解绑源设备并绑定目标；claim revision＋1，from/to/audit 完整；旧 grant 不复活。 |
| D34 | 转移与 createGrant 并发 | 仅一个基于原快照成功；另一方冲突/有界重试；不存在旧 owner 下新增 grant。 |
| D35 | 设备 claim 释放后并发 createGrant 与重新登记 | createGrant 不得自动激活；重新登记只有一个成功；无 active grant 与 released claim 的矛盾状态。 |
| D36 | 错误 DTO、普通列表、日志、审计导出和 Git 快照扫描 | 无序列号、MAC、IP、K1/K2、完整指纹、原始幂等键；跨组织错误不暴露 owner/from/to。 |

## 11. 实施前复审问题

以下问题需要 Codex 在编码前明确确认；本文给出默认建议，但不借预研自行扩大范围：

1. 是否同意 `device_claims.boundDeviceId` 作为“同一物理设备只有一个 active access_device 投影”的约束字段；若不同意，需要给出等价的事务内唯一性方案。
2. 是否同意 K1 domain 缺失在 createGrant 中一律 `DOMAIN_INCOMPLETE/503`，而不是由授权路径首次初始化。
3. 是否同意 released slot 可在同 cycle 被新 grant 复用，但旧 grant 永不复活；若最终禁止，应把 D22 改为 `GRANT_SLOT_CONFLICT/409` 并要求新 cycle。
4. 设备登记、释放和转移的权限点、operation key 方法名及审计 DTO 需在各自任务卡冻结，不能复用 `face.grant` 或普通住户权限。
5. `providerDeviceCiphertext` 的加解密密钥管理与轮换不属于 H2-b；实现前必须引用独立安全设计，不得临时明文保存 serialNumber。

## 12. 验收边界

本设计通过只表示 H2-b 可以进入定点编码复审。实际编码仍须等待 H2-a 正式通过，并满足：

- 只修改获准的 claim/device/slot 代码与测试，不夹带 H2-c/H2-d/H3/H4；
- 恢复全部 H1/H2-a 回归，新增本矩阵中获准的用例；
- 服务层、集合、Admin 全量和根测试通过；
- 所有失败路径零业务写入、Provider 零调用；
- 不注册 HTTP、不调用真实或 Mock Provider、不连接设备或生产云；
- `allowDeviceOperations=false`，真实写接口继续关闭。
