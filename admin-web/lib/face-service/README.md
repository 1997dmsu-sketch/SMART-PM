# HK-AI-04 人脸服务层 Mock 骨架（契约修订版）

状态：**部分骨架**。未接 `server.mjs`、未建集合、未连接真实设备；等待 AI-C 阶段 2 终审与本次契约复审通过后再接线。

## 冻结契约

**Provider 方法**（`health` 仅作独立健康检查，不计入业务方法）：

```text
enrollFace / updateFace / revokeFace / queryOperation / verifyEvent
```

**权限**（不使用 `device.face.manage`）：

| 场景 | 权限 |
|---|---|
| 人脸提交 | `device.face.submit` |
| 审核队列 / 审核 | `device.face.review` |
| 图片下载 / 私密字段 | `device.face.readPrivate` |
| 人工授权 / 撤权 | `device.access.manage` |
| 任务查询 | `device.audit.read` |
| 重试 | `device.operation.retry` |
| 人工对账 | `device.operation.reconcile` |

**三轴状态**（互不串写）：

- 凭证审核：`draft/submitted/approved/rejected/revoked`
- 图片质量：`pending/verified/rejected`
- 授权：`pending/effective/suspended/revoked/expired`
- 任务：`queued/sending/awaiting_result/succeeded/retryable_failed/terminal_failed/cancelled`

**授权投影**：

- `businessAllowed` = grant 为 `effective` 且实时资格快照允许；与凭证审核/同步状态无关；
- `deviceEffective` = 上述 + 成功 job + 受信设备证据（`device_ack`, `trusted`）；Mock 永不产生生效。

**幂等与错误**：

- `opId + requestDigest`：同键同摘要重放、同键不同摘要冲突、不同键独立执行；
- 对外分类仅 `RETRYABLE / TERMINAL / UNKNOWN_RESULT`；live 未配置为 `NOT_CONFIGURED`；
- `post_send` 未知结果不自动重试，任务停在 `awaiting_result`。

## 集合（已认可，未建表）

`access_devices`、`face_credentials`、`device_access_grants`、`device_operation_jobs`、`device_operation_logs`、`device_claims`、`grant_slot_claims`、`operation_keys`；组织域 `orgId`，可变记录 `revision` 条件写。

## 下一步

1. 本次契约复审通过；
2. AI-C 阶段 2 终审通过后，按指定基线接线集合与 HTTP；
3. 真实 Provider 继续关闭。
