# HK-AI-04 人脸服务层 Mock 骨架（精确契约 72a093a）

状态：**部分骨架**。未接 `server.mjs`、未建集合、未连接真实设备；等待契约复审通过 + AI-C 阶段 2 终审后再接线。

## 冻结接口

```text
enrollFace / updateFace / revokeFace / queryOperation / verifyEvent
health 仅作独立健康检查，不计入业务方法
```

所有业务方法接收冻结的 **FaceAccessContext**：

```text
{ orgId, deviceId, grantId?, validFrom, validUntil }   // 毫秒时间戳，左闭右开
```

- `revokeFace` 必须提供 `context.grantId`；
- `queryOperation({ jobId })` 按 **jobId** 查询；
- `verifyEvent` 必须带签名，缺失直接拒绝（不使用默认签名）。

## 权限

| 场景 | 权限 |
|---|---|
| 人脸提交 | `device.face.submit` |
| 审核队列 / 审核 | `device.face.review` |
| 图片下载 / 私密字段 | `device.face.readPrivate` |
| 人工授权 / 撤权 | `device.access.manage` |
| 任务查询 | `device.audit.read` |
| 重试 / 对账 | `device.operation.retry` / `device.operation.reconcile` |

不使用 `device.face.manage`。

## 状态轴

- 凭证审核：`draft/submitted/approved/rejected/revoked`
- 图片质量：`pending/verified/rejected`（仅此三种）
- 授权：`pending/effective/suspended/revoked/expired`
- 任务：`queued/sending/awaiting_result/succeeded/retryable_failed/terminal_failed/cancelled`
  - `terminal_failed` 是终态，不得原地回 `queued`；重试/对账须创建新 job。

## 授权投影

- `businessAllowed` = grant `effective` + 实时资格快照允许；与审核状态无关；
- `deviceEffective` = 上述 + 成功 job + **绑定 org/device/grant/job 的受信 `device_ack`**；
- Mock 回执 `kind="mock_result"` 永不产生真实设备生效。

## 展示 DTO

`publicReviewItem(record, { scope })` 输出 `displayState`、`evidenceScope`、`cleanupPending`；
审核队列用 `scope="review"`，私密详情用 `scope="private"`；两者都不含图片字节与摘录。

## 幂等与错误

- `opId + requestDigest`：同键同摘要重放、同键不同摘要 `CONFLICT`、不同键独立执行；
- 对外分类仅 `RETRYABLE / TERMINAL / UNKNOWN_RESULT`；未配置为 `NOT_CONFIGURED`；
- `createFaceProvider()` 缺省不启用 Mock，必须显式 `mode="demo" | "test"`。

## 路由（提案，未注册）

- `/api/v2/face-credentials`、`/review-queue`、`/:id/review`、`/:id/image`
- `/api/v2/device-access-grants/:grantId/revoke`
- `/api/v2/device-operation-jobs`、`/:jobId/retry`、`/:jobId/reconcile`

## 下一步

1. 本次契约复审通过；
2. AI-C 阶段 2 已通过，按指定基线接线集合与 HTTP；
3. 真实 Provider 继续关闭。
