# HK-AI-04 `6b9c7ac` Mock 骨架复审（2026-11-06）

结论：**代码骨架可运行，契约复审不通过，暂不允许集合或 HTTP 接线。** 本提交没有真实设备、网络或生产云调用；Mock/live 隔离方向正确。问题集中在已冻结契约被重新定义，需定点修订后复审。

## 核验

- 分支/提交：`feat/hk-face-service-mock` / `6b9c7ac`，基线 `44d27a6`
- 根测试：51/51 通过
- `admin-web`：229/229 通过（含本轮新增 10 项）
- 变更范围：独立 `lib/face-service` 骨架及测试，未接 `server.mjs`、集合或真实 Provider

## 三项契约裁定

1. **Provider 方法名不认可。** 冻结接口继续使用 `enrollFace`、`updateFace`、`revokeFace`、`queryOperation`、`verifyEvent`。`health` 可作为独立健康检查适配器，但不得替换或计入这五个业务方法。现有 `upsertCredential`、`deleteCredential`、`queryCredential` 须按冻结语义拆分/改名。
2. **`device.face.manage` 不认可。** 人工授权/撤权使用 `device.access.manage`；任务查询使用 `device.audit.read`；重试使用 `device.operation.retry`；人工对账使用 `device.operation.reconcile`。人脸提交、审核和私密图片读取继续使用各自权限。`/api/v2/face-credentials` 等路径仅可保留为提案，修正 DTO、权限及错误信封后再冻结。
3. **集合及并发约定认可，但尚不批准接线。** 使用 `access_devices`、`face_credentials`、`device_access_grants`、`device_operation_jobs`、`device_operation_logs`，以及 `device_claims`、`grant_slot_claims`、`operation_keys`。组织域记录采用 `orgId`，可变记录采用 `revision` 条件写；设备唯一占用由全局 `device_claims` 保证。待 AI-C 阶段 2 终审通过且本骨架修订通过后再实现。

## 阻断项

### P0：状态模型与授权来源错误

- 凭证只保存 `reviewState = draft/submitted/approved/rejected/revoked`；图片质量是独立状态，不得把 `sync_pending/synced/sync_failed` 写进凭证审核状态。
- grant 状态固定为 `pending/effective/suspended/revoked/expired`。
- job 状态固定为 `queued/sending/awaiting_result/succeeded/retryable_failed/terminal_failed/cancelled`。
- `businessAllowed` 必须由 grant 和实时资格快照决定，不能由凭证审核或同步状态决定。
- `deviceEffective` 必须由 grant、job 和受信设备证据投影；不得用 `providerKind === "real"` 作为生效证据。Mock 永远不能产生真实设备生效结论。

### P0：Mock 幂等语义错误

当前缓存仅按 action，导致不同人员或不同凭证的同类请求复用首个结果。应按 `opId/Idempotency-Key + requestDigest`：同键同摘要重放；同键不同摘要冲突；不同键独立执行。`post_send` 失败不得自动重试，并须投影为冻结的 `UNKNOWN_RESULT` 语义。

### P1：DTO、权限及错误码需对齐

- `personId` 按项目既有规则校验为有界不透明 ID，不能强制 UUID。
- 审核员应能凭 `device.face.review` 查看最小审核队列；下载图片及私密字段仍要求 `device.face.readPrivate`。
- Provider 失败分类对外统一为 `RETRYABLE`、`TERMINAL`、`UNKNOWN_RESULT`；live 未配置返回 `NOT_CONFIGURED`，不要新增 `MOCK_FORBIDDEN` 作为公共契约。
- 跨组织、猜测 ID、不可见资源同态 404；资源可见但权限不足为 403；HTTP 2xx 不表示设备已生效。

## 下一次提交范围

只修改独立骨架与测试：对齐五个 Provider 方法、三轴状态、权限、DTO、错误映射及幂等键语义；不得接 `server.mjs`、建集合或连接真实设备。保留并扩充 Mock 场景，明确该提交仍是部分骨架。通过复审后再进入集合与 HTTP 接线。
