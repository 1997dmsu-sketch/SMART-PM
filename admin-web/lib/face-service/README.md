# HK-AI-04 人脸服务层 Mock 骨架（精确契约 cc569a8）

状态：**部分骨架**。未接 `server.mjs`、未建集合、未连接真实设备；等待契约复审通过后再接线。

## 冻结接口（双参数）

```text
enrollFace(input, context)
updateFace(input, context)
revokeFace(input, context)
queryOperation(input, context)
verifyEvent(input, context)
health()   // 独立健康检查，不计入业务方法
```

**FaceAccessContext 六字段**：

```text
actorId / actorType(user|system|agent) / orgId
permissions: Set<string>
idempotencyKey: 16–128 位 [A-Za-z0-9._:-]
executionMode: demo|test|live
```

业务字段在 `input`：

| 方法 | input |
|---|---|
| enroll | `personId, deviceId, grantId, sourceFileId, validFrom, validUntil` |
| update | `credentialId, sourceFileId` |
| revoke | `grantId, credentialId` |
| query | `jobId` |
| event | `domain, eventId, jobId, deviceId, version, occurredAt, signature` |

`opId/requestDigest` 由服务端按 `context.idempotencyKey + 规范化 input` 派生，不接受客户端自由输入。

## 四轴状态

- 凭证审核：`draft/submitted/approved/rejected/revoked`
- 图片质量：`pending/verified/rejected`
- 授权：`pending/effective/suspended/revoked/expired`
- 任务：`queued/sending/awaiting_result/succeeded/retryable_failed/terminal_failed/cancelled`
  - `sending` 不可直接取消（结果不明 → `awaiting_result`）；`terminal_failed` 为终态。

## 授权投影

- `businessAllowed` = grant `effective` + 实时资格快照；
- `deviceEffective`：job 必须同时匹配 `orgId/deviceId/grantId/credentialId`，证据须为
  `kind=device_ack`、`source=device`、`trusted`、`evidenceScope=device_verified`，
  且 `jobId/action` 与 job 一致；普通调用者伪造 `{trusted:true}` 不生效；
- `evidenceScope` 冻结值仅 `simulated` / `device_verified`。

## 事件（Mock）

- 固定测试域 `mock.test`、递增 `version`、`occurredAt` 5 分钟时间窗；
- 签名格式 `mock-sig:<domain>:<eventId>:<version>`（**仅用于合成 fixture，不是生产鉴权**）；
- 事件必须匹配同组织、同设备上的 job；版本必须严格递增；同 ID 同摘要重放，不同摘要 `CONFLICT`；
- 返回只含 `matchedJobId/action` 或 `rejected`，不回显 payload；
- `executionMode=live` 一律 `NOT_CONFIGURED`。

## 幂等与错误

- 幂等作用域 = 组织 + 方法 + actor 类型 + actor ID + 幂等键；同作用域同摘要重放，不同摘要 `CONFLICT`；
- 对外分类：`RETRYABLE / TERMINAL / UNKNOWN_RESULT / NOT_CONFIGURED`；
- `createFaceProvider({mode, provider})` 必须**同时显式** `mode=demo|test` 与 `provider="mock"`。

## 路由（提案，未注册）

- `/api/v2/face-credentials`、`/review-queue`、`/:id/review`、`/:id/image`
- `/api/v2/device-access-grants/:grantId/revoke`
- `/api/v2/device-operation-jobs`、`/:jobId/retry`、`/:jobId/reconcile`
