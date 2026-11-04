# LOCK-01A FaceAccessProvider 接口契约（海康 DS-K1T671BM）

- 适用任务：LOCK-01A
- 版本：第三轮，回应 `LOCK-01A-REVIEW` 第二轮的 F03（op_id 缺客户端幂等键）与 F05（未知错误）
- 范围：统一接口契约与错误分类；**不含实现**，不修改共享 `server.mjs`/`store.mjs`
- 厂商枚举：`hikvision`（全项目唯一写法）

## 1. 接口签名

~~~ts
interface FaceAccessContext {
  actorId: string;
  actorType: "user" | "system" | "agent";
  orgId: string;
  permissions: Set<string>;
  idempotencyKey: string;   // 客户端生成，16–128 字符，[A-Za-z0-9._:-]
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
  | { code: "RETRYABLE"; vendor?: string; retryAfterMs?: number }   // 仅限"确认未执行"或厂商明示可重试
  | { code: "TERMINAL"; vendor?: string; reason: string }
  | { code: "UNKNOWN_RESULT"; jobId: string }                      // 可能已执行，必须先查询/对账
  | { code: "DENIED" };
~~~

**默认安全原则**：无法证明请求未执行时，一律 `UNKNOWN_RESULT`，不得自动重试。人脸录入/撤权都是外部副作用，仅靠本地幂等键不能证明厂商侧幂等。

## 4. 厂商错误码映射

**本轮不预设任何厂商错误码。** 官方码表取得前，映射表为空，按下列默认分类处理：

| 情形 | 默认分类 | 处理 |
| --- | --- | --- |
| 连接前失败（请求未发送，如 DNS/连接被拒） | `RETRYABLE` | 可直接退避重试 |
| 已发送但解析失败 / 断连 / 超时 / 未知官方码 | `UNKNOWN_RESULT` | 进入 `awaiting_result`；先调 `queryOperation` 或人工对账，**不得自动重试** |
| 官方明确可重试，且已确认请求未执行（或厂商声明幂等） | `RETRYABLE` | 按官方退避重试 |
| 官方明确终态失败 | `TERMINAL` | 告警并人工复核 |

正式映射表必须逐行包含：接入路线、官方码、官方含义、文档版本、内部枚举、默认分类、是否可重试。禁止写入其他厂商或旧文档的错误码。

## 5. 幂等与任务状态机

- 固定 ID：`op_id = claimId("device-operation", orgId + "|" + route + "|" + actorId, HMAC-K2(idempotencyKey))`；同时保存 `requestDigest`（规范化业务输入）。
- 语义：
  - 同 `idempotencyKey` + 同 `requestDigest` → 重放原结果；
  - 同 `idempotencyKey` + 不同 `requestDigest` → `CONFLICT`；
  - 不同 `idempotencyKey` → 不同 `op_id`，**必须允许新操作**（同一操作者同路由可多次合法操作）。
- `idempotencyKey` 规范：长度 16–128，字符集 `[A-Za-z0-9._:-]`；长度或字符非法直接拒绝。
- 保存期限不短于任务历史保留期；超期后同键再提交视为新操作并写审计，**不得静默重放旧结果**。
- `actorId` 需带 `actorType`（user/system/agent），避免不同主体摘要碰撞。
- 外部网络调用在数据库事务之外：先落 `queued` 任务再发送；`sending` 之后的结果只允许回写 `succeeded/retryable_failed/terminal_failed/awaiting_result`。
- 双 worker 争抢由任务租约（`leaseOwner + leaseExpiresAt`）保证一次有效下发。
- 厂商成功后 DB 回写失败可恢复：靠 op_id 去重，不重复创建厂商凭证。

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
6. **未知官方码 / 发送后断连 → `UNKNOWN_RESULT`，不自动重试；对账成功后才推进终态。**
7. **发送前失败 → `RETRYABLE`；发送后断连 → `UNKNOWN_RESULT`（两类分开验证）。**
8. **同一 actor、同一 route、不同 `idempotencyKey` → 两次操作都执行，不误判为重复。**
9. **非法或超长 `idempotencyKey` → 拒绝；超保存期同键再提交 → 新操作 + 审计。**
10. **`queryOperation` 对账成功后不得重复下发（enroll/revoke 均验证）。**
