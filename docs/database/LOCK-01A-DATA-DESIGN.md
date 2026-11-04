# LOCK-01A 数据结构评审稿（海康 DS-K1T671BM）

- 适用任务：LOCK-01A
- 范围：仅结构设计，**不建表、不迁移、不写生产数据**。
- 基线：docs/db-01-design（提交 81f9c89）；依赖 DB-05（入住）、DB-07（私密文件）。
- 厂商枚举：本任务 `provider = "hikvision"`（受控枚举，最终以厂商确认结果为准）。

## 1. 设计原则

1. 人员以稳定 `personId` 为主键，不用手机号。
2. 授权必须归属 `orgId`，并绑定人员、房间/入住周期（`occupancyId`+`cycleId`）、设备和有效期。
3. 业务授权事实（grant）与厂商凭证（credential）分离；厂商成功不等于业务授权永久有效。
4. 写操作走"持久任务 + 租约 + 结果回写"，幂等键全局唯一。
5. 人脸原图/特征/密钥不入普通列表、日志与响应；敏感厂商标识加密或受保护映射。

## 2. 集合总览

| 集合 | 作用 | 关键唯一约束 |
| --- | --- | --- |
| `access_devices` | 门禁设备主数据 | `orgId + providerDeviceKey(加密)` 唯一 |
| `face_credentials` | 人脸凭证档案（业务侧） | `orgId + personId + sourceFileId` 唯一；`orgId+personId` 可存在历史多版本，仅一条 effective |
| `device_access_grants` | 业务授权事实 | `orgId + personId + deviceId + cycleId` 唯一（有效授权） |
| `device_operation_jobs` | 设备操作任务 | 幂等键唯一；任务租约字段 |
| `device_operation_logs` | 不可变操作历史 | 只追加，不更新 |

## 3. 集合设计

### 3.1 access_devices

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 平台稳定设备 ID |
| `orgId` / `communityId` / `buildingId` | string | 归属链 |
| `provider` | enum | `hikvision` |
| `providerDeviceKey` | string(加密) | 海康序列号/平台资源 ID 的受保护映射，不暴露给客户端 |
| `deviceType` | string | 门禁终端类型 |
| `model` | string | 例如 `DS-K1T671BM` |
| `firmwareVersion` | string | 锁定固件版本 |
| `gatewayId` | string? | 联网/代理标识（如走内网代理则为代理节点） |
| `capabilities` | object | `{ face: bool, remoteUnlock: bool, ... }` |
| `status` | enum | `draft | active | offline | disabled | archived` |
| `revision` | int | 乐观锁 |
| `createdAt/updatedAt/archivedAt` | datetime | 审计 |

索引：`orgId`、`orgId+status`、`providerDeviceKey`(唯一)。状态机：`draft→active→(offline↔active)→disabled→archived`。

### 3.2 face_credentials

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 凭证档案 ID |
| `orgId` / `personId` | string | 归属 |
| `sourceFileId` | string | 引用 DB-07 `private/face-biometric` 文件用途；厂商不允许平台存原图则改为一次性提交引用、成功后按策略删除 |
| `consentId` / `consentVersion` / `consentedAt` | string/string/datetime | 授权同意 |
| `submittedBy` | object | 代提交人信息；代提交人不能成为凭证所有者 |
| `reviewState` | enum | `draft | submitted | approved | rejected | revoked` |
| `qualityState` / `reviewerId` / `reviewReason` | string | 质量状态与审核 |
| `biometricDigest` | string | 仅幂等/变更识别的带密钥摘要，不保存可逆特征 |
| `revision` / `createdAt/updatedAt` | — | 审计 |

约定：普通列表/详情**不返回**原图定位、厂商特征值或完整生物识别数据。

### 3.3 device_access_grants

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 授权 ID |
| `orgId` / `personId` / `deviceId` | string | 主体 |
| `occupancyId` / `cycleId` | string | 入住周期 |
| `grantSource` / `approverId` | string | 授权来源与批准人 |
| `validFrom` / `validUntil` | datetime | 有效期 |
| `state` | enum | `pending | effective | suspended | revoked | expired` |
| `credentialId` | string? | 关联厂商凭证 |
| `revision` | int | 乐观锁 |

唯一约束：有效期内 `orgId + personId + deviceId + cycleId` 唯一。状态机：`pending→effective→(suspended→effective|revoked)→expired`。退租时整户 grant 立即 `revoked`（业务层立即无权开门），并为每台设备生成撤权任务。

### 3.4 device_operation_jobs

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 任务 ID |
| `orgId` / `deviceId` / `grantId` | string | 归属 |
| `operation` | enum | `face.enroll | face.update | face.revoke | face.query` |
| `idempotencyKey` | string(唯一) | 平台幂等键；同键同请求重放原结果，同键不同请求冲突 |
| `requestDigest` | string | 请求摘要（防重放/审计） |
| `providerRequestId` | string? | 厂商请求 ID |
| `state` | enum | `queued | sending | awaiting_result | succeeded | retryable_failed | terminal_failed | cancelled` |
| `attempts` / `nextAttemptAt` | int/datetime | 重试 |
| `leaseOwner` / `leaseExpiresAt` | string/datetime | 租约/锁，双 worker 争抢只一次下发 |
| `errorMapping` | string | 厂商错误码的安全映射 |

不记录厂商密钥、人脸原图或完整厂商响应中的敏感内容。

### 3.5 device_operation_logs

只追加：`_id、jobId、orgId、operatorId、at、fromState、toState、result(脱敏)、auditId`。**不得用更新覆盖既有历史。**

## 4. 与既有 devices 集合的映射与迁移口径

现有小程序云端 `devices` 集合（`cloudfunctions/getDevices|syncDevices|unlock`）字段为 `deviceId/deviceName/platform/lockId/lockName/macAddress/battery/houseId/status/enableRemote/enableBluetooth`，`platform ∈ {ttlock, tuya}`，鉴权仅"用户 houses 含 device.houseId 或 public"。

| 既有 devices | 新 access_devices | 口径 |
| --- | --- | --- |
| `deviceId` | `_id`（重定稳定 ID） | 迁移映射表，不改历史开门记录 |
| `platform` | `provider=hkvision` | 受控枚举收敛；旧 tuya/ttlock 不在本任务范围 |
| `lockId/macAddress` | `providerDeviceKey(加密)` | 海康序列号，加密保护 |
| `houseId` | `orgId+communityId+buildingId` + grant 的 `occupancyId/cycleId` | 从"房子"升级为"入住周期授权" |
| `enableRemote` | `capabilities.remoteUnlock` | 能力位，不直接等同授权 |
| （无） | `device_access_grants` | 新增业务授权事实，取代 houses 数组判断 |

迁移与真实接入为 LOCK-01B/C 事项，01A 只出映射口径，**不迁移**。

## 5. DB-07 新增文件用途：face-biometric

DB-07 现有 `PURPOSES`：`listing-image / content-image / vr-attachment / identity-document / evidence / other`，**无 face-biometric**。本任务在 DB-07 整合时新增：

```js
"face-biometric": {
  maxSize: 5 * MB,
  accept: IMAGE_MIMES,          // 具体格式待厂商质量要求确认（如 JPEG）
  visibility: "private",
  private: true,
  writePermission: null,        // 上传：组织管理员/代提交受控流程
  readPermission: "device.face.readPrivate", // 逐次读取并审计
}
```

## 6. 权限点映射

| 权限点 | 用途 |
| --- | --- |
| `device.manage` | 设备创建/能力核验 |
| `device.face.review` | 人脸申请审核（不含私密读取） |
| `device.face.readPrivate` | 人脸原图逐次私密读取 |
| `device.operation.retry` | 任务重试 |
| `device.audit.read` | 审计读取 |

## 7. 待集成时确定（开放问题）

1. `providerDeviceKey` 采用加密存储还是映射表（海康序列号/平台资源 ID 形态）。
2. `face_credentials` 是否保留历史多版本，或单一有效版本 + 历史日志。
3. 授权唯一约束是否追加 `grantSource` 维度。
4. 有效期由授权显式维护，还是由入住周期派生（建议显式 `validUntil`，便于撤权审计）。
