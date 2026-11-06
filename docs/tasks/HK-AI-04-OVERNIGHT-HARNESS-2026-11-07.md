# HK-AI-04 夜间 Harness 连续开发任务卡（2026-11-07）

执行者：DeepSeek Harness  
统一复审：Codex（早间集中复审）  
工作分支：`feat/hk-face-service-integration`  
冻结基线：`d42dd4b`（含 `4aa5aff`）  
当前边界：只做服务层与测试；不得修改 `server.mjs`，不得注册 HTTP，不得连接真实 Provider 或设备，不得执行设备写调用。

## 目标

在现有 Mock、FileService 绑定校验、K1/domain guard 基础上，形成可独立复审的服务层闭环：

1. 授权输入与 credential 解耦；
2. 资格、权限、文件、设备、domain、claim、slot、grant、job、log、幂等在同一事务内保持一致；
3. 新 job 提交后通过短事务领取租约，再在事务外调用 Mock Provider；
4. 结果通过短事务落库并追加确定性日志；
5. 撤权立即使业务授权失效，清理成功后以墓碑方式释放 claim/slot；
6. 同键重放、并发竞争、权限或资格变化均不得重复调用 Provider 或产生半成品记录。

## 执行顺序与提交拆分

### H1：输入模型、集合登记与固定记录结构

建议提交：`refactor(face): freeze grant inputs and service records`

- credential 只保留人员、人脸来源、审核与图片状态；授权不得从 credential 继承 `deviceId/cycleId/validity`。
- `createGrant` 输入至少包含：
  - `credentialId`
  - `expectedCredentialRevision`
  - `deviceId`
  - `occupancyId`
  - `cycleId`
  - `identityApplicationId`
  - `validFrom`
  - `validUntil`
- 幂等摘要覆盖全部业务输入，不得包含原始设备序列号或 K1 密钥。
- 将本期实际使用的人脸集合登记到 Store 白名单及 LocalStore 初始化；全局 `device_digest_domains` 不按 `orgId` 过滤。
- 冻结 claim/slot 墓碑结构：`state=active|released`、`releasedAt`、`releasedByJobId`、`revision`。
- 冻结 job 租约结构：`leaseOwner`、`leaseExpiresAt`、`attempts`，不得保存凭据。
- 冻结确定性 log ID 规则，必须由 job、迁移序号或状态组合生成，重试不得重复追加同一迁移日志。

自审：字段最小化、无序列号/图片/摘要泄露、非法状态与未知字段拒绝。先提交，再进入 H2。

### H2：`createGrant` 原子事务

建议提交：`feat(face): create pending grant atomically`

必须复用 `BlacklistService.withEligibility()`，不得另写绕过资格 guard 的裸事务。

事务 refs 至少包含：

```text
face_credentials/<credentialId>
file_assets/<sourceFileId>
organizations/<orgId>
org_memberships/<actor.membershipId>
access_devices/<deviceId>
device_digest_domains/<headId>
device_digest_domains/<versionId>
device_claims/<claimId>
grant_slot_claims/<slotId>
device_access_grants/<grantId>
device_operation_jobs/<jobId>
device_operation_logs/<initialLogId>
operation_keys/<opKey>
```

事务内顺序：

1. 最新组织与成员记录必须有效，且当前持有 `device.access.manage`；
2. 先检查 operation key：同键同摘要直接返回既有结果；同键异摘要 409；只有新操作继续；
3. credential 必须同组织、`approved`，revision/person/source binding 均未变化；
4. `FileService.assertBinding()` 校验 `sourceFileId + sourceFileRevision`；
5. 资格快照必须由 `withEligibility()` 在同一事务内确认；
6. 设备缺失或跨组织统一 404，停用 409；原始序列号仅在内存计算 K1，不进入 DTO、日志或 operation key；
7. `applyDigestDomain()` 校验或首次原子创建 head＋version；
8. K1 claim 与 grant slot 不得被其他有效授权占用；released 墓碑可按 revision 重新占用；
9. 同事务写 pending grant、queued job、首条 log、claim、slot、operation key；
10. 任一失败必须全部零写入。

必测：成功、资格拒绝/待审、成员撤权竞态、文件 revision 竞态、设备缺失/跨组织/停用、domain 不完整/换钥、claim/slot 冲突、同键重放、异摘要冲突、两并发只成功一个。

### H3：租约、Mock 调用与结果迁移

建议提交：`feat(face): lease and dispatch mock face jobs`

- 只有 H2 本次新建的 job 可以进入派发；重放不得再次调用 Provider。
- 用独立短事务领取租约：仅 `queued` 或符合重试条件且无有效租约的 job 可进入 `sending`。
- 两个 worker 并发只能一个取得租约。
- 取得租约后才可在事务外调用 Mock Provider。
- 结果用独立短事务落库并追加确定性 log：
  - 成功：记录 simulated 结果；不得生成可信设备回执；
  - `RETRYABLE` → `retryable_failed`；
  - `UNKNOWN_RESULT` → `awaiting_result`，禁止自动重发；
  - `TERMINAL` → `terminal_failed`；
  - 过期租约或旧 worker 结果必须拒绝。
- Mock 永远 `executionMode=test / provider=mock / evidenceScope=simulated`，`deviceEffective=false`。

必测：租约竞争、租约过期、旧 owner 回写、各错误映射、每次迁移一条日志、重放 Provider 调用计数不增加。

### H4：撤权与清理闭环

建议提交：`feat(face): revoke grants and release claims safely`

- `device.access.manage`；不查资格。
- 首个事务立即把 grant 改为 `revoked`，创建 revoke job、log、operation key，并设置 `cleanupPending=true`。
- Provider 清理成功后，以墓碑方式释放当前 grant 对应 slot 与 claim：
  - `state=released`
  - `releasedAt`
  - `releasedByJobId`
  - `revision + 1`
- claim 只有仍指向当前 grant 时才能释放；不允许释放后来重新占用的 claim。
- 清理失败或未知：grant 保持 revoked、`cleanupPending=true`，claim/slot 保留 active，并留下告警日志。
- 同键撤权重放不得创建第二个 job 或再次调用 Provider。

必测：成功释放、失败/未知保留、并发重占用保护、重复撤权、跨组织同态 404、日志完整性。

### H5：Harness 自我复审与交接

建议提交：`docs(face): report service integration self-review`

新增 `docs/tasks/HK-AI-04-SERVICE-INTEGRATION-HANDOFF-2026-11-07.md`，必须包含：

- 分支、基线、每笔提交号与文件列表；
- 逐条验收矩阵（H1～H4）；
- 测试命令、精确通过数量、连续复跑次数；
- Provider 调用计数与并发测试结果；
- 未完成项和已知风险，不得把未覆盖项标为通过；
- 明确声明未修改 HTTP/server、未连接真实设备/生产云、未使用真实人脸；
- `git status --short` 结果；
- 请求 Codex 早间统一复审的具体提交范围。

## 夜间自审检查点（北京时间）

以下是 Harness 的执行检查点，不代表 Codex 已自动复审：

| 时间 | 检查点 | 未通过时动作 |
|---|---|---|
| 01:30 | H1 完成，定向测试通过 | 停止进入 H2，修复或记录阻断 |
| 04:00 | H2 原子事务与并发测试完成 | 禁止开始 Provider 派发 |
| 06:30 | H3 租约/结果迁移完成 | 不通过则保留 H1/H2 独立提交 |
| 08:00 | H4 与全量回归完成 | 不通过则不宣称服务闭环完成 |
| 08:30 | H5 自审报告、工作区清洁、推送完成 | 只提交已通过部分 |

每个检查点执行：

```bash
git status --short
npm test --prefix admin-web
npm test
```

涉及并发/租约的定向测试至少连续运行 3 次。

## 立即停止条件

出现任一情况，停止扩大范围，保留最小可复审提交并写入交接报告：

1. 需要修改 `server.mjs`、注册 HTTP 或开放真实 Provider；
2. 需要连接设备、生产云或使用真实人脸/设备凭据；
3. 无法把资格与业务写入保持在同一事务；
4. K1/domain、claim/slot 或幂等存在并发双写；
5. Provider 在事务内调用，或未取得租约就调用；
6. 测试不稳定、全量测试失败或工作区包含来源不明文件；
7. 需要猜测未冻结的海康写接口字段。

## 禁止事项

- 不得改写或强推已复审提交历史；
- 不得合并 `main`；
- 不得提交密钥、序列号、IP、MAC、密码、原始响应或真实人脸；
- 不得把 Mock/simulated 标记为真实生效；
- 不得进入阶段 3、真实设备写入或生产部署。

