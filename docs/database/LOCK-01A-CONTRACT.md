# LOCK-01A FaceAccessProvider 接口契约（海康 DS-K1T671BM）

- 适用任务：LOCK-01A
- 版本：第二轮，回应 `LOCK-01A-REVIEW` 的 F02/F04
- 范围：统一接口契约与错误分类；**不含实现**，不修改共享 `server.mjs`/`store.mjs`
- 厂商枚举：`hikvision`（全项目唯一写法）

## 1. 接口签名

~~~ts
interface FaceAccessContext {
  actorId: string;
  orgId: string;
  permissions: Set<string>;
  idempotencyKey: string;
  executionMode: "demo" | "test" | "live";
}

interface FaceAccessProvider {
  enrollFace(input: EnrollFaceInput, context: FaceAccessContext): Promise<OperationResult>;
  updateFace(input: UpdateFaceInput, context: FaceAccessContext): Promise<OperationResult>;
  revokeFace(input: RevokeFaceInput, context: FaceAccessContext): Promise<OperationResult>;
  queryOperation(input: QueryOperationInput, context: FaceAccessContext): Promise<OperationResult>;
  verifyEvent(input: EventPayload, context: FaceAccessContext): Promise<VerifyResult>;
}
~~~

## 2. 各方法要点

| 方法 | 输入要点 | 输出要点 | 前置校验 |
| --- | --- | --- | --- |
| `enrollFace` | `personId/deviceId/grantId/sourceFileId/validFrom/validUntil` | `jobId/state/providerRequestId?` | 实名 + 有效入住 + 设备 active + 文件 `face-biometric` 私密且 ready |
| `updateFace` | `credentialId` + 变更字段 | 同上 | 原凭证 effective；同幂等键 |
| `revokeFace` | `grantId/credentialId` | 业务立即 revoked，异步生成撤权任务 | 幂等；重复撤权返回原结果 |
| `queryOperation` | `jobId` 或 `providerRequestId` | `state/attempts/lastSuccessAt/failureReason(脱敏)` | 组织内可见 |
| `verifyEvent` | 平台回调/设备事件载荷 | `matchedJobId/action` 或 `rejected` | 验签/鉴权 + 防重放 + 时间窗 + 与任务/设备/组织匹配 |

## 3. 错误分类（统一枚举）

~~~ts
type FaceAccessError =
  | { code: "NOT_CONFIGURED" }
  | { code: "CONFLICT"; detail: string }
  | { code: "RETRYABLE"; vendor?: string; retryAfterMs?: number }
  | { code: "TERMINAL"; vendor?: string; reason: string }
  | { code: "UNKNOWN_RESULT"; jobId: string }
  | { code: "DENIED" };
~~~

## 4. 厂商错误码映射

**本轮不预设任何厂商错误码。** 取得官方错误码表前，映射表为空；实现只做"未知即 `RETRYABLE` 或 `UNKNOWN_RESULT`，并记录 jobId"的兜底。

正式映射表必须逐行包含：接入路线、官方码、官方含义、文档版本、内部枚举、是否可重试。示意：

| 接入路线 | 官方码 | 官方含义 | 文档版本 | 内部枚举 | 可重试 |
| --- | --- | --- | --- | --- | --- |
| （空，待官方码表） | — | — | — | — | — |

不得把其他厂商或旧文档的错误码写入本表。

## 5. 幂等与任务状态机

- 写操作使用作用域化幂等键 `op_id:{orgId}:{route}:{actorKeyDigest}` + `requestDigest`（见数据结构 §2）；同键同请求重放原结果，同键不同请求冲突。
- 外部网络调用在数据库事务之外：先落 `queued` 任务再发送；结果回写 `succeeded/retryable_failed/terminal_failed`。
- 双 worker 争抢由任务租约（`leaseOwner + leaseExpiresAt`）保证一次有效下发。
- 厂商成功后 DB 回写失败可恢复：靠幂等键去重，不重复创建厂商凭证。

## 6. Provider 选择与 demo/live 边界

| executionMode | 允许的 provider | 说明 |
| --- | --- | --- |
| `demo` / `test` | `MockFaceAccessProvider`（显式选择）或 `HikvisionFaceAccessProvider`（配置完整） | mock 仅限非生产 |
| `live` | **只能** `HikvisionFaceAccessProvider` 且配置完整 | 选 mock 或不完整 → `NOT_CONFIGURED` 失败关闭 |

- `MockFaceAccessProvider` **只在 demo/test 显式选择时启用**，不得作为 live 的默认值。
- `HikvisionFaceAccessProvider` 默认关闭；缺设备地址/凭证/固件版本/代理 → `NOT_CONFIGURED`，不得回退为模拟成功。
- 任务、授权、报告持久化 `executionMode / provider / evidenceScope`；mock 结果 `evidenceScope=simulated`，**永远不能把 grant 标为真实设备已生效**。
- 平台方式与设备直连方式不得运行时静默切换；切换需重启并留审计。
- 设备直连必须经受控内网代理；公网/小程序/浏览器不得直连设备 IP。

## 7. 事件/回调校验（verifyEvent）

1. 验签/鉴权：按官方机制校验来源。
2. 防重放：事件唯一 ID + 时间窗。
3. 匹配：与既有任务/设备/组织匹配；未知事件不自动创建业务记录。
4. 结果：`matched`（推进任务）或 `rejected`（忽略并审计）。

## 8. 与业务授权解耦

每次业务开门/事件处理仍需独立校验当前 grant、入住周期、人员与设备状态；厂商成功不等于授权永久有效。现有 `unlock` 一键开门路径不在本契约范围，LOCK-01 不隐式启用。

## 9. 必测用例（补充）

1. `live` 且 provider 未配置 → `NOT_CONFIGURED`，无任何下发。
2. `live` 误选 mock → 拒绝并审计。
3. 运行中切换 provider/路线 → 拒绝。
4. mock 成功 → grant 的 `evidenceScope` 仍为 `simulated`，不得写 `device_verified`。
5. 同 op_id 同 digest 重放；不同 digest 冲突。
