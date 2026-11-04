# LOCK-01A 数据结构评审稿（海康 DS-K1T671BM）

- 适用任务：LOCK-01A
- 版本：第四轮，回应 `LOCK-01A-REVIEW` 第三轮的 F06（op_id 缺 actorType）
- 范围：仅结构设计，**不建表、不迁移、不写生产数据**
- 基线：`docs/db-01-design`；依赖 DB-05（入住）、DB-07（私密文件）
- 厂商枚举：`provider = "hikvision"`（全项目唯一写法）

## 1. 设计原则

1. 人员以稳定 `personId` 为主键，不用手机号。
2. 授权归属 `orgId`，绑定人员、房间/入住周期（`occupancyId`+`cycleId`）、设备与有效期。
3. 业务授权事实（grant）与厂商凭证（credential）分离；厂商成功不等于授权永久有效。
4. **不依赖云数据库唯一索引**：唯一性由"固定 ID 占位记录 + 事务内条件写"保证（§2）。
5. **设备所有权全局唯一**：一台物理设备的 claim 不按组织拆分；跨组织只能走审计转移。
6. 幂等键由客户端 `idempotencyKey` 生成，与 `orgId`/`route`/`actorType`/`actorId` 共同决定 op_id，同时保存 `requestDigest`（含 actorType）。
7. 人脸原图/特征/密钥不入普通列表、日志与响应。

## 2. 固定 ID / claim 协议（替代唯一索引）

沿用 DB-02～DB-06 的固定 ID 占位思路：先算固定 ID，再在事务内"不存在才创建"，用记录的 `revision` 做条件写；**不声明唯一索引**。

| 对象 | 固定 ID 构造 | 摘要域 / 密钥 | 唯一性机制 |
| --- | --- | --- | --- |
| 设备 | `provider-device:{provider}:{digestRealm}:{HMAC-K1(规范化设备标识)}` | `KEYED_DIGEST/device`，`keyVersion` 随记录 | 全局只允许一个 claim；claim 记录唯一 `ownerOrgId`；序列号原值另存密文 |
| 授权 | `grant-slot:{orgId}:{personId}:{deviceId}:{cycleId}` | 纯 ID 拼接 | slot 记录 `activeClaimId`；同一 slot 一个 effective grant；仅 `ownerOrgId` 可建 |
| 幂等 | `op_id = claimId("device-operation", orgId + "|" + route + "|" + actorType + "|" + actorId, HMAC-K2(idempotencyKey))`，并保存 `requestDigest` | `KEYED_DIGEST/op`，K2 版本随记录 | 同 op_id 同 digest → 重放；同 op_id 不同 digest → 冲突；不同 idempotencyKey → 不同 op_id，允许新操作；不同 actorType 同样生成不同 op_id |

约束说明：

- **设备所有权全局唯一**：`provider-device` claim **不含 `orgId`**，claim 记录保存唯一 `ownerOrgId`。同一序列号在 A、B 两家并发登记时，只允许一家成为 owner，另一家失败关闭且不写设备。
- **跨组织转移必须审计**：解绑 → 变更 `ownerOrgId` → 记 `transferredAt/fromOrgId/toOrgId/auditId`；存在有效 grant 或未关闭 job 时拒绝转移；转移后旧组织 grant 立即业务失效并生成撤权任务。
- **需要共享时不得重复登记**：另建 `device_org_bindings`，由设备 owner 显式授权、可撤销；授权关系单独审计。
- **幂等键规范**：`idempotencyKey` 由客户端生成，长度 16–128，字符集 `[A-Za-z0-9._:-]`；保存期限不短于任务历史保留期；保存期内同键同 `requestDigest` 重放原结果、同键不同 digest 冲突；超过保存期视为新操作并写审计，**不静默重放旧结果**。`actorId` 需区分用户/系统/代理类型。
- 固定 ID 只使用安全字符（hex/base32 摘要 + 受限分段），**不直接拼接未约束的 `orgId`/`route`**。
- `digestRealm` 区分环境（demo/test/live），防止测试设备与生产 claim 串号。
- `digestDomain` 与 `keyVersion` 写入记录，支持密钥轮换与历史重算。
- 固定 ID 记录集合：`device_claims`、`grant_slot_claims`、`operation_keys`；与业务集合同事务写。
- 释放规则：grant 结束/退租时 slot 记录写 `releasedAt` 并保留历史；换租或新周期用新 `cycleId` 生成新 slot；并发重建由 revision 条件写失败关闭。
- 历史只追加不覆盖，便于审计与重放。

## 3. 集合设计

### 3.1 `access_devices`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 平台稳定设备 ID |
| `claimId` | string | `provider-device` 全局固定 ID |
| `ownerOrgId` | string | 设备唯一所有者组织；跨组织转移需审计 |
| `digestRealm` / `keyVersion` | string/int | 环境域与摘要密钥版本 |
| `provider` | enum | `hikvision` |
| `providerDeviceCiphertext` | string | 序列号/平台资源 ID 密文，不参与索引、不下发客户端 |
| `orgId` / `communityId` / `buildingId` | string | 归属链（用于展示与授权，不作为所有权） |
| `deviceType` / `model` / `firmwareVersion` / `gatewayId` | string | 型号与固件 |
| `capabilities` | object | `{ face, remoteUnlock }` |
| `status` | enum | `draft\|active\|offline\|disabled\|archived` |
| `revision` / 时间戳 | — | 乐观锁与审计 |

非唯一索引：`orgId`、`orgId+status`、`ownerOrgId`。状态机：`draft→active→(offline↔active)→disabled→archived`。

### 3.2 `face_credentials`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` / `orgId` / `personId` | string | 归属 |
| `sourceFileId` | string | 引用 DB-07 `private/face-biometric`；厂商不允许存原图则改为一次性引用、成功后按策略删除 |
| `consentId` / `consentVersion` / `consentedAt` | string/datetime | 授权同意 |
| `submittedBy` | object | 代提交人；不能成为凭证所有者 |
| `reviewState` | enum | `draft\|submitted\|approved\|rejected\|revoked` |
| `qualityState` / `reviewerId` / `reviewReason` | string | 质量与审核 |
| `biometricDigest` | string | 带密钥摘要，仅用于幂等/变更识别 |
| `executionMode` / `evidenceScope` | enum | `demo/test/live`；`simulated/device_verified` |
| `revision` / 时间戳 | — | 审计 |

### 3.3 `device_access_grants`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` / `orgId` / `personId` / `deviceId` | string | 主体；`orgId` 必须等于设备 `ownerOrgId` |
| `slotId` / `claimId` | string | `grant-slot` 固定 ID 与占位记录 |
| `occupancyId` / `cycleId` | string | 入住周期 |
| `grantSource` / `approverId` | string | 来源与批准人 |
| `validFrom` / `validUntil` | datetime | 有效期 |
| `state` | enum | `pending\|effective\|suspended\|revoked\|expired` |
| `credentialId` | string? | 关联凭证 |
| `executionMode` / `evidenceScope` | enum | 模拟与真实设备证据必须区分 |
| `revision` | int | 乐观锁 |

唯一性：由 §2 的 `grant-slot` 保证"同一 slot 一个 effective"；只有设备 `ownerOrgId` 能创建/downstream；设备转移时旧组织所有 grant 立即 `revoked` 并生成撤权任务。

### 3.4 `device_operation_jobs`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` / `orgId` / `deviceId` / `grantId` | string | 归属 |
| `operation` | enum | `face.enroll\|face.update\|face.revoke\|face.query` |
| `opId` | string | `device-operation` 固定 ID（含客户端幂等键摘要） |
| `requestDigest` | string | 规范化业务输入摘要 |
| `providerRequestId` | string? | 厂商请求 ID |
| `state` | enum | `queued\|sending\|awaiting_result\|succeeded\|retryable_failed\|terminal_failed\|cancelled` |
| `attempts` / `nextAttemptAt` | int/datetime | 重试 |
| `leaseOwner` / `leaseExpiresAt` | string/datetime | 租约，双 worker 只一次下发 |
| `executionMode` / `evidenceScope` | enum | 区分模拟/真实 |
| `errorMapping` | string | 厂商错误码安全映射（不存原始敏感内容） |

### 3.5 `device_operation_logs`

只追加：`_id、jobId、orgId、operatorId、at、fromState、toState、result(脱敏)、auditId`。不得覆盖既有历史。

## 4. 与既有 `devices` 集合的映射

| 既有 devices | 新 access_devices | 口径 |
| --- | --- | --- |
| `deviceId` | `_id` | 迁移映射表，不改历史开门记录 |
| `platform` | `provider="hikvision"` | 受控枚举收敛；旧 tuya/ttlock 不在本任务范围 |
| `lockId` / `macAddress` | `providerDeviceCiphertext` + 全局 `claimId` | 序列号加密，claim 全局去重 |
| `houseId` | 归属链 + grant 的 `occupancyId/cycleId` | 从"房子"升级为"入住周期授权" |
| `enableRemote` | `capabilities.remoteUnlock` | 能力位，不等于授权 |
| （无） | `device_access_grants` | 新增业务授权事实，取代 houses 数组判断 |

迁移与真实接入属 LOCK-01B/C，本任务只出映射口径，不迁移。

## 5. DB-07 新增用途：`face-biometric`

DB-07 现有 `PURPOSES` 无 `face-biometric`，**尚未实现**，不能在 LOCK-01A 通过后视为可用。整合时新增：

~~~js
"face-biometric": {
  maxSize: 5 * MB,
  accept: IMAGE_MIMES,
  visibility: "private",
  private: true,
  writePermission: null,
  readPermission: "device.face.readPrivate",
}
~~~

## 6. 权限点

| 权限点 | 用途 |
| --- | --- |
| `device.manage` | 设备创建/能力核验 |
| `device.face.review` | 人脸申请审核（不含私密读取） |
| `device.face.readPrivate` | 人脸原图逐次私密读取 |
| `device.operation.retry` | 任务重试 |
| `device.audit.read` | 审计读取 |

## 7. 竞争与一致性测试

1. 同一 slot 并发创建 → 只允许一个成功，另一个按 revision 失败关闭。
2. 同 op_id 同 requestDigest → 重放原结果；不同 digest → 冲突。
3. **同一序列号在组织 A、B 并发登记 → 只产生一个 owner，另一方失败关闭且不写设备。**
4. 摘要密钥轮换后旧记录可按 keyVersion 重算、不误判冲突。
5. slot 释放/换租/新周期重建 → 旧记录保留 `releasedAt`，不覆盖。
6. mock 执行的记录 `evidenceScope=simulated`，不得写成 `device_verified`。
7. **跨组织转移：存在有效 grant 或未关闭 job 时拒绝；否则审计迁移，旧组织 grant 立即 revoked 并生成撤权任务。**
8. **同一 actor、同一 route、不同 `idempotencyKey` → 生成不同 op_id，两次操作都允许。**
9. **`idempotencyKey` 非法字符/超长 → 拒绝；超过保存期再提交 → 视为新操作并审计，不静默重放。**
10. **未知厂商错误 → `UNKNOWN_RESULT`，不自动重试，对账后才到终态。**
11. **同一 `actorId`、不同 `actorType`、相同 `idempotencyKey` → 生成不同 op_id，互不重放。**

## 8. 待集成时确定

1. 设备是否允许跨组织共享（建议不共享；确需共享用 `device_org_bindings`）。
2. `device_claims` 是否同时保留可逆密文与摘要（建议：摘要查重 + 密文展示）。
3. `face_credentials` 是否保留历史多版本。
4. slot 释放后是否允许同 cycle 重建（建议禁止，新周期新 slot）。
5. `executionMode` 是否随 grant 复制到 job（建议复制，便于审计）。
6. `digestRealm` 粒度（env 或 env+region）。
