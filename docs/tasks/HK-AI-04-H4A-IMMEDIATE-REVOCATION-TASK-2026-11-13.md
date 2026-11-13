# HK-AI-04 H4-a 立即业务撤权任务

## 基线与范围

- 基线：H4-0B `b2b5a11`
- 设计：H4 `1542a6c` 第 3 节
- 只实现 `FaceCredentialService.revoke()` 的单事务立即撤权；Provider 调用必须为 0。
- 禁止 H4 dispatcher、清理派发、local finalize、HTTP、真实设备或云端启用。

## 契约

1. 输入：有界 `grantId` 与 16–128 位合法 Idempotency-Key；权限 `device.access.manage` 必须在事务内先复核。
2. 不查询资格/黑名单。跨组织与缺失 grant 同态 404。
3. 仅 `pending/effective/suspended/expired` 可首次撤权；同 operation key 合法重放返回旧结果且零写；不同 key 对已 revoked 返回 `INVALID_STATE/409`。
4. 同一 `store.transact` 原子写：
   - grant → `revoked, cleanupPending=true, cleanupJobId, revokedAt, revokedByActorId`；
   - `action=revoke` 的 queued cleanup job，严格 `cleanupSnapshot`；
   - queued 确定性 log；
   - K2 operation key；
   - H4-0A 确定性 admin audit。
5. `cleanupJobId`、log ID、audit ID 按设计确定性派生；冲突、损坏或预占时全部回滚。
6. snapshot 只允许设计白名单，≤4 KiB；必须绑定 grant/credential/device/claim/slot/releaseGuard 的 ID 与 revision/epoch、原 grant state、createdAt；不得含设备原值、图片、文件位置或原始幂等键。
7. operation key 结果严格为 `{grantId,jobId,grantState:"revoked",cleanupPending:true,evidenceScope:"simulated"}`，重放须精确验证。
8. 两个不同 key 并发撤同一 grant：仅一个成功，另一个 `INVALID_STATE`；只产生一套 job/log/op/audit。
9. 任一 revision/time 溢出、ref 缺失、guard/claim/slot 绑定变化、K2 配置错误均失败关闭且内容级零副作用。

## 必测

覆盖 H4 设计 R01–R12：四种可撤状态、权限撤销竞态、404 同态、K2/domain、同键重放、异摘要、双 key 并发、callback 重跑、确认丢失式重放、job/log/op/audit 预占、snapshot 字段/大小/敏感扫描、Provider 0。

## 验收

- 独立分支并推送；
- 定向、Admin、根测试全绿；`git diff --check` 通过；
- 不改 `server.mjs`，不调用 Mock/真实 Provider；
- H4-a 通过前 H4-b 保持关闭。
