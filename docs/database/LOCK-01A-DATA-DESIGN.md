# LOCK-01A 数据结构评审稿（海康 DS-K1T671BM）

- 适用任务：LOCK-01A
- 版本：第二轮，回应 `LOCK-01A-REVIEW` 的 F02/F03
- 范围：仅结构设计，**不建表、不迁移、不写生产数据**
- 基线：`docs/db-01-design`；依赖 DB-05（入住）、DB-07（私密文件）
- 厂商枚举：`provider = "hikvision"`（全项目唯一写法）

## 1. 设计原则

1. 人员以稳定 `personId` 为主键，不用手机号。
2. 授权归属 `orgId`，绑定人员、房间/入住周期（`occupancyId`+`cycleId`）、设备与有效期。
3. 业务授权事实（grant）与厂商凭证（credential）分离；厂商成功不等于授权永久有效。
4. **不依赖云数据库唯一索引**：唯一性由"固定 ID 占位记录 + 事务内条件写"保证（§2）。
5. 幂等键按 `orgId + route + actor/keyDigest` 作用域化，同时保存 `requestDigest`。
6. 人脸原图/特征/密钥不入普通列表、日志与响应。

## 2. 固定 ID / claim 协议（替代唯一索引）

沿用 DB-02～DB-06 的固定 ID 占位思路：先算固定 ID，再在事务内"不存在才创建"，用记录的 `revision` 做条件写；**不声明唯一索引**。

| 对象 | 固定 ID 构造 | 摘要域 / 密钥 | 唯一性机制 |
| --- | --- | --- | --- |
| 设备 | `device_claim:{orgId}:{provider}:{HMAC-K1(规范化序列号)}` | `KEYED_DIGEST/device`，`keyVersion` 随记录保存 | 事务内 upsert-if-absent；序列号原值另存密文，不参与查询 |
| 授权 | `grant_slot:{orgId}:{personId}:{deviceId}:{cycleId}` | 纯 ID 拼接，无摘要 | slot 记录保存 `activeClaimId`；同一 slot 只允许一个 effective grant |
| 幂等 | `op_id:{orgId}:{route}:{actorKeyDigest}` + `requestDigest` | `KEYED_DIGEST/op` | 同 op_id 同 digest → 重放原结果；同 op_id 不同 digest → 冲突 |

约束说明：

- 固定 ID 输入必须先规范化（trim、大小写、ID 形态）；非法输入拒绝，不做模糊匹配。
- `digestDomain` 与 `keyVersion` 写入记录，支持密钥轮换与历史重算。
- 固定 ID 记录集合：`device_claims`、`grant_slot_claims`、`operation_keys`；与业务集合同事务写。
- 释放规则：grant 结束/退租时 slot 记录写 `releasedAt` 并保留历史；换租或新周期用新 `cycleId` 生成新 slot；并发重建由 revision 条件写失败关闭。
- 历史只追加不覆盖，便于审计与重放。

## 3. 集合设计

### 3.1 `access_devices`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 平台稳定设备 ID |
| `claimId` | string | `device_claim` 固定 ID（查重） |
| `orgId` / `communityId` / `buildingId` | string | 归属链 |
| `provider` | enum | `hikvision` |
| `providerDeviceCiphertext` | string | 序列号/平台资源 ID 密文，不参与索引、不下发客户端 |
| `digestDomain` / `keyVersion` | string/int | 摘要域与密钥版本 |
| `deviceType` / `model` / `firmwareVersion` / `gatewayId` | string | 型号与固件 |
| `capabilities` | object | `{ face, remoteUnlock }` |
| `status` | enum | `draft\|active\|offline\|disabled\|archived` |
| `revision` / 时间戳 | — | 乐观锁与审计 |

非唯一索引：`orgId`、`orgId+status`。状态机：`draft→active→(offline↔active)→disabled→archived`。

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
| `_id` / `orgId` / `personId` / `deviceId` | string | 主体 |
| `slotId` / `claimId` | string | `grant_slot` 固定 ID 与占位记录 |
| `occupancyId` / `cycleId` | string | 入住周期 |
| `grantSource` / `approverId` | string | 来源与批准人 |
| `validFrom` / `validUntil` | datetime | 有效期 |
| `state` | enum | `pending\|effective\|suspended\|revoked\|expired` |
| `credentialId` | string? | 关联凭证 |
| `executionMode` / `evidenceScope` | enum | 模拟与真实设备证据必须区分 |
| `revision` | int | 乐观锁 |

唯一性：由 §2 的 `grant_slot` 保证"同一 slot 一个 effective"；结束/换租写 `releasedAt` 并保历史。

### 3.4 `device_operation_jobs`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` / `orgId` / `deviceId` / `grantId` | string | 归属 |
| `operation` | enum | `face.enroll\|face.update\|face.revoke\|face.query` |
| `opId` | string | `op_id` 固定 ID（作用域化幂等键） |
| `requestDigest` | string | 请求摘要 |
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
| `lockId` / `macAddress` | `providerDeviceCiphertext` + `claimId` | 序列号加密，claim 摘要查重 |
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
3. 同设备序列号并发 upsert `device_claim` → 只产生一条 claim。
4. 摘要密钥轮换后旧记录可按 keyVersion 重算、不误判冲突。
5. slot 释放/换租/新周期重建 → 旧记录保留 `releasedAt`，不覆盖。
6. mock 执行的记录 `evidenceScope=simulated`，不得写成 `device_verified`。

## 8. 待集成时确定

1. `device_claim` 是否同时保留可逆密文与摘要（建议：摘要查重 + 密文展示）。
2. `face_credentials` 是否保留历史多版本。
3. slot 释放后是否允许同 cycle 重建（建议禁止，新周期新 slot）。
4. `executionMode` 是否随 grant 复制到 job（建议复制，便于审计）。
