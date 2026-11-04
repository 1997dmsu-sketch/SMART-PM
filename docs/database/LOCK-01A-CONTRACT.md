# LOCK-01A FaceAccessProvider 接口契约（海康 DS-K1T671BM）

- 适用任务：LOCK-01A
- 范围：统一接口契约与错误分类；**不含实现**，不修改共享 `server.mjs`/`store.mjs`。
- 基线：docs/db-01-design（提交 81f9c89）。

## 1. 接口签名

页面/小程序/管理端不直接调用厂商，统一走：

```ts
interface FaceAccessContext {
  actorId: string;          // 认证上下文来源，不能信任请求体
  orgId: string;
  permissions: Set<string>;
  idempotencyKey: string;   // 写操作必填
}

interface FaceAccessProvider {
  enrollFace(input: EnrollFaceInput, context: FaceAccessContext): Promise<OperationResult>;
  updateFace(input: UpdateFaceInput, context: FaceAccessContext): Promise<OperationResult>;
  revokeFace(input: RevokeFaceInput, context: FaceAccessContext): Promise<OperationResult>;
  queryOperation(input: QueryOperationInput, context: FaceAccessContext): Promise<OperationResult>;
  verifyEvent(input: EventPayload, context: FaceAccessContext): Promise<VerifyResult>;
}
```

## 2. 各方法要点

| 方法 | 输入要点 | 输出要点 | 前置校验 |
| --- | --- | --- | --- |
| `enrollFace` | `personId/deviceId/grantId/sourceFileId/validFrom/validUntil` | `jobId/state/providerRequestId?` | 实名通过 + 有效入住 + 设备 active + 文件 `face-biometric` 私密且 ready |
| `updateFace` | `credentialId` + 变更字段 | 同上 | 原凭证 effective；同幂等键 |
| `revokeFace` | `grantId/credentialId` | 业务立即 `revoked`，异步生成撤权任务 | 幂等；重复撤权返回原结果 |
| `queryOperation` | `jobId` 或 `providerRequestId` | `state/attempts/lastSuccessAt/failureReason(脱敏)` | 组织内可见 |
| `verifyEvent` | 平台回调/设备事件载荷 | `matchedJobId/action` 或 `rejected` | 验签/鉴权 + 防重放 + 时间窗 + 与任务/设备/组织匹配 |

## 3. 错误分类（统一枚举）

```ts
type FaceAccessError =
  | { code: "NOT_CONFIGURED" }          // 适配器未配置，失败关闭
  | { code: "CONFLICT"; detail: string } // 同键不同请求
  | { code: "RETRYABLE"; vendor?: string; retryAfterMs?: number } // 设备离线/超时/限频/未知
  | { code: "TERMINAL"; vendor?: string; reason: string }         // 终态失败，需人工复核
  | { code: "UNKNOWN_RESULT"; jobId: string }                     // 已发送、结果未知，不得误记成功
  | { code: "DENIED" };                  // 越权/跨组织，同态拒绝
```

映射原则：厂商错误码只做安全映射（不落库原始敏感信息）；`-4043` 这类"未开远程"映射为 `TERMINAL`，网络超时映射 `RETRYABLE` 或 `UNKNOWN_RESULT`。

## 4. 幂等与任务状态机

- 写操作必带 `idempotencyKey`：同键同请求→重放原结果；同键不同请求→`CONFLICT`。
- 外部网络调用在数据库事务之外：先落 `queued` 任务，再发送；结果回写 `succeeded/retryable_failed/terminal_failed`。
- 双 worker 争抢：任务租约（`leaseOwner + leaseExpiresAt`）保证一次有效下发。
- 厂商成功后 DB 回写失败可恢复：不重复创建厂商凭证，靠幂等键去重。

## 5. 事件/回调校验（verifyEvent）

1. 验签/鉴权：按官方机制（摘要/平台签名）校验来源真实。
2. 防重放：事件唯一 ID + 时间窗；重复/乱序事件安全处理。
3. 匹配：与既有任务/设备/组织匹配；未知事件不自动创建业务记录。
4. 结果：`matched`（可推进任务状态）或 `rejected`（忽略并审计）。

## 6. Provider 抽象与配置边界

- `MockFaceAccessProvider`：默认启用，确定性模拟成功/离线/超时/重复/终态失败；其测试不得标记为真实设备通过。
- `HikvisionFaceAccessProvider`：默认关闭；配置不完整（缺设备地址/凭证/固件版本/代理）→ `NOT_CONFIGURED` 失败关闭，**不得回退为模拟成功**。
- 设备直连必须走受控内网代理；平台方式与直连方式**不得运行时静默切换**。
- 厂商密钥只从服务端环境变量/密钥服务读取，不入仓库、前端包、日志或 API 响应。
- `provider=hkvision` 枚举与 `FaceAccessProvider` 绑定；现有 `unlock` 一键开门路径不在本契约范围，LOCK-01 不隐式启用。

## 7. 与业务授权解耦

每次业务开门/事件处理仍需独立校验当前 grant、入住周期、人员与设备状态；厂商成功不等于授权永久有效。
