# HK-AI-04 H4 撤权闭环契约设计

状态：待 Codex 终审。基线 `2b92b30`；本提交只包含设计，不批准生产代码、HTTP、云端、真实 Provider 或设备写。

## 1. 证据与边界

- `FaceCredentialService.revoke()` 当前在 [service.mjs](../../admin-web/lib/face-service/service.mjs) 中以 `STAGE_CLOSED/501` 关闭；H4 才能替换该门禁。
- H3 的 [h3a.mjs](../../admin-web/lib/face-service/h3a.mjs) 与 [h3b.mjs](../../admin-web/lib/face-service/h3b.mjs) 已冻结 enroll 专用 job、60 秒租约、10 秒调用窗口、最多 4 次领取、30/120/600 秒退避、fence、确定性日志、事务外 Mock 调用与过期转 `awaiting_result`。H4 复用这些语义，不把 enroll validator 偷改成同时接受 revoke。
- [mock-provider.mjs](../../admin-web/lib/face-service/mock-provider.mjs) 已提供 `revokeFace({grantId, credentialId}, context)`，`revoke_fail` 属 post-send terminal；`post_send_unknown` 为未知结果；`pre_send_fail/device_offline` 为可确认未发送。
- owner claim 与 slot 的 active/released 互斥字段由 [collections.mjs](../../admin-web/lib/face-service/collections.mjs) 冻结。released slot 必须清 `activeClaimId` 并写 `releasedAt/releasedByJobId`；released owner claim 必须清 `boundDeviceId/activated*` 并写 `releasedAt/releasedByAuditId/releaseReason`。
- 展示层已有 `cleanupPending=true -> revoking` 优先规则，见 [dto.mjs](../../admin-web/lib/face-service/dto.mjs)。
- H3-b 已由 `HK-AI-04-H3B-APPROVAL-2B92B30-2026-11-13.md` 关闭；H4 不产生 `device_verified`，仍为 `test/mock/simulated`。

## 2. 冻结拆分

H4 分两笔实现，任一笔都不注册 HTTP。

1. **H4-a 立即撤权**：`revoke()` 只做权限、K2/重放、grant CAS、清理 job/log/op key 的单事务提交；Provider 0 次。
2. **H4-b Mock 清理**：新增动作专用 `H4MockRevoker`，复用 H3 的租约算法与错误分类，但使用独立 `validateRevokeJob/buildRevokeClaimPlan/assertRevokeFence`。不得放宽 `validateDispatchJob()` 的 enroll 约束。

H4-c（如需）才实现 `awaiting_result` 的人工对账。H4-a/b 仅保留路由描述，不接 `server.mjs`。

## 3. H4-a：立即业务撤权

### 3.1 输入与权限

- `grantId` 与 `idempotencyKey` 均按现有有界 ID/K2 规则校验。
- 事务前可点查 grant 以规划 refs，但事务内必须重新读取并先执行 `authCheck(state,{permission:"device.access.manage"})`。
- 跨组织或缺失 grant 同态 `NOT_FOUND/404`。仅 `pending/effective/suspended/expired` 可首次撤权；已 revoked 只有同 operation key 且完整结果匹配时可重放。不同 key 对已 revoked grant 返回 `INVALID_STATE/409`，不能创建第二个 cleanup job。
- 撤权不调用资格或真实黑名单；业务失效优先于设备清理。

### 3.2 确定性对象

- `cleanupJobId = "job-revoke-v1:" + SHA-256(JSON.stringify([orgId,grantId]))`，摘要为 64 位小写 hex，不含原始幂等键、设备标识或个人信息。
- job 固定：`action=revoke`、`state=queued`、`executionMode=test`、`provider=mock`、`evidenceScope=simulated`、`attempts=0`、`leaseGeneration=0`、租约/授权/nextAttemptAt/result 为 null。
- revoke job 不复制 H3 的资格快照。只内嵌严格白名单 `cleanupSnapshot`：`schemaVersion=1`、grant/credential/device/claim/slot ID 与各自 revision、原 grant state、createdAt；规范 JSON ≤4 KiB。
- grant 同事务写 `state=revoked`、`cleanupPending=true`、`cleanupJobId`、`revokedAt`、`revokedByActorId`、revision+1、updatedAt。禁止删除或改写 person/occupancy/cycle/device/claim/slot 绑定。
- operation key 结果固定 `{grantId,jobId,grantState:"revoked",cleanupPending:true,evidenceScope:"simulated"}`；record 沿用 K2 的 org/realm/keyVersion/requestDigest/result/createdAt，禁止原始幂等键。

### 3.3 单事务 refs 与写集

| refs（去重后） | 上限 |
| --- | ---: |
| organizations、org_memberships | 2 |
| operation_key_domains head/version、operation_keys/opKey | 3 |
| grant、cleanup job、queued log | 3 |
| credential、device、owner claim、slot（生成不可变 snapshot） | 4 |
| **总计** | **12** |

写集固定为：必要的 K2 domain 首次 head/version（0 或 2）+ grant + cleanup job + queued log + operation key。任一 ref 缺失、revision 溢出、日志/job 冲突或 snapshot 不一致，整事务零写。禁止先改 grant 再补 job。

线性化点是该事务提交。相同 operation key 同摘要返回原结果且零写；同 key 异摘要 `CONFLICT/409`；两个不同 key 并发撤同一 grant，仅一个 grant CAS 获胜。

## 4. H4-b：清理 job 与租约

### 4.1 job 专用 schema

`validateRevokeJob()` 只接受 `action=revoke/test/mock/simulated` 和 H4-a 的 `cleanupSnapshot`。其余 job 字段、整数边界、状态字段互斥与 H3 一致。旧撤权记录缺 snapshot 时 `CLEANUP_SNAPSHOT_REQUIRED`，候选扫描排除；H4 不自动补写或迁移。

T1 领取固定 60 秒，attempts/generation 同步递增，最多 4 次；日志 action 固定 revoke。H3 的 enroll job 与 H4 revoke job 使用各自动作 validator，候选互不串用。

### 4.2 T2 发送前复核

顺序固定：job/fence → grant → credential → device → claim → slot → runtime config。

- grant 必须仍 `revoked`、`cleanupPending=true`、`cleanupJobId=jobId`，且所有 snapshot ID/revision 一致；不查资格、成员入住或有效期。
- credential 只核对同 org、ID 与 revision；撤权不能因图片不可读、审核状态变化或人员资格变化而被阻止。
- device 可以 disabled，但必须仍属同 org，claimId/provider/realm/keyVersion 与 snapshot 一致；设备/claim 缺失或已被受控转移属于确定性失败，不得向未知设备发送。
- owner claim 必须 active 且绑定 snapshot device；slot 必须 active 且 `activeClaimId=grantId`。released/改绑在发送前视为“本 grant 已清理”，进入 **本地幂等完成**，Provider 0 次，再按第 6 节验证并补齐剩余墓碑，不反向恢复 active。
- runtime 只允许 LocalStore + Mock + test；否则 `NOT_CONFIGURED`。

T2 成功只写 `dispatchAuthorizedAt` 与 revision，返回当前栈一次性许可。T2 callback 重跑不得产生第二份许可。剩余租约不足 10 秒时明确未发送并终结 `PRE_SEND_WINDOW_CLOSED`。

### 4.3 Provider 调用

事务外只调用一次：

```text
revokeFace({grantId, credentialId}, {
  actorType:"system", actorId:"h4-mock-revoker",
  permissions:Set("device.access.manage"), orgId,
  executionMode:"test",
  idempotencyKey:"h4-v1:" + SHA-256([orgId,jobId,"revoke",attempt])
})
```

不传 person、图片、文件位置、设备序列号、IP/MAC、凭据、原始 operation key 或源记录。10 秒超时和迟到结果沿用 H3：超时转 `UNKNOWN_RESULT`；迟到 promise 不得再写 Store。

## 5. 状态机、错误与退避

| 事件 | job 目标 | grant | slot/claim | 自动再发 |
| --- | --- | --- | --- | --- |
| H4-a 提交 | queued | revoked + cleanupPending | 不变 | 待 T1 |
| Mock success | succeeded | cleanupPending=false | 第 6 节释放 | 否 |
| device_offline/pre_send_fail，attempt<4 | retryable_failed | 保持 revoked/pending | 不变 | 30/120/600 秒后 |
| 上述错误 attempt=4 | terminal_failed + RETRY_EXHAUSTED | 保持 revoked/pending | 不变 | 否 |
| post_send_unknown、超时、租约过期 | awaiting_result + RESULT_UNKNOWN | 保持 revoked/pending | 不变 | 永不自动 |
| revoke_fail/terminal | terminal_failed | 保持 revoked/pending | 不变 | 否 |
| NOT_CONFIGURED | terminal_failed + CONFIGURATION_BLOCKED | 保持 revoked/pending | 不变 | 否 |
| 本地已清理且绑定可证明 | succeeded | cleanupPending=false | 保持/补全合法墓碑 | 否 |

任何失败/未知均不得把 grant 恢复为 effective，也不得释放 slot/claim。人工 retry 只适用于 retryable_failed，要求 `device.operation.retry` 并遵守同一 due/CAS；awaiting_result 只能由第 8 节对账。

## 6. 成功清理与墓碑

T3 success 为一个事务，refs 固定：job、grant、slot、owner claim、device、目标 result log、以及“同设备可能仍有效的 grant 集合”的**预读候选 refs**。

### 6.1 slot

若 slot 仍 active 且 `activeClaimId=grantId`，写 released 墓碑：清 `activeClaimId/activatedAt`，写 `releasedAt=now`、`releasedByJobId=jobId`、revision+1、updatedAt。若已经是与本 job 一致的合法 released 墓碑，视为幂等；其他 releasedByJobId 或损坏记录 `GRANT_SLOT_CONFLICT`，不得覆盖。

### 6.2 owner claim

claim 是设备级组织 owner，不属于单一住户。只有同时满足以下条件才释放：

1. 当前 claim active、绑定同 device/org/provider/realm/version；
2. device.claimId 仍为该 claim；
3. 除目标 grant 外，不存在同 org/device/claimId 且状态为 `pending/effective/suspended` 或 `revoked && cleanupPending=true` 的 grant；
4. 候选列表在事务外按 `(orgId,deviceId,claimId)` 完整读取，事务 refs 包含每个候选；事务内重算，缺页、读取故障或候选数使总 refs >90 时失败关闭，claim 保持 active；禁止分批释放；
5. 同一事务读取稳定设备级 lifecycle guard `device-claim-release-guard:{claimId}`（H4 新增全局/组织域 guard 需单独 schema），其 revision/epoch 由新增授权和 H4 释放共同 CAS，防止“扫描后新 grant”幻读。

释放时清 `boundDeviceId/activatedAt/activatedByAuditId`，写 `releasedAt`、`releasedByAuditId`（本次 T3 admin audit ID）、`releaseReason="no-active-grants"`、revision+1、updatedAt。device 保留 claimId/ownerOrgId，因 claim 已 released，新授权固定失败关闭；重新登记/转移必须另开受控任务。

若存在其他有效/待清理 grant，claim 保持 active，但本 grant 的 slot 仍可释放且 cleanupPending 可清。两名住户共用设备时撤销其中一人绝不释放 owner claim。

### 6.3 原子写集与容量

基础 refs 7（job/grant/slot/claim/device/log/guard）+ 其他候选 grant `N`。上限为 `7+N≤90`，即 `N≤83`；实现必须以最终去重结果计算。超限或列表不完整时不调用 Provider（T2 已调用后的 T3 容量异常则保守进入 awaiting_result，slot/claim 不释放），不得只释放一半。成功 T3 原子写 job succeeded、grant cleanupPending=false、slot 墓碑、可选 claim 墓碑、guard、结果日志和 audit。

## 7. 崩溃、确认丢失与竞争

- H4-a 提交确认丢失：调用方只能用同 operation key 重放；不得创建第二 job。
- T1/T2 提交确认丢失：停止当前栈，Provider 0；租约到期转 awaiting_result。
- Provider 已调用而 T3 确认丢失：不得再次发送；同 fence 回放 T3 只允许同结果幂等或 fence 拒绝。
- 撤权与新增授权竞争：H4-a grant CAS 先提交则 createGrant 看到 revoked/slot active 并拒绝；createGrant 先提交另一个 slot/grant，则 claim release guard/candidate refs 阻止 H4 释放 owner claim。
- 两个撤权竞争同 device：各自释放自己的 slot；最后一个且完整证明无其他 grant 的事务才释放 claim。
- 日志 ID 沿用 `deterministicLogId(jobId,targetState,newRevision)`，create-only 冲突必须回滚全部业务写。

## 8. UNKNOWN_RESULT 与人工对账

H4-b 不自动重发 awaiting_result。未来 H4-c 入口要求 `device.operation.reconcile`、expectedRevision、Idempotency-Key 与不可变证据摘要，只允许：

- `confirmed_removed`：按第 6 节提交 succeeded 与墓碑；
- `confirmed_present`：terminal_failed，cleanupPending 保持 true；不得自动重发；
- `still_unknown`：保持 awaiting_result，仅追加一次确定性对账日志。

证据只保存短码、来源类型、时间与不可逆摘要；原始响应离线保存，不入库。Mock 阶段只能使用合成证据，`evidenceScope=simulated`。本设计不批准 H4-c 编码，须单独发卡。

## 9. 错误映射

| 条件 | 对外码/HTTP | 副作用 |
| --- | --- | --- |
| grant 不可见 | NOT_FOUND/404 | 零写 |
| 权限不足 | FORBIDDEN/403 | 零写 |
| 幂等冲突/记录损坏 | CONFLICT/409 | 零写 |
| grant 状态不允许或已有别的 cleanup job | INVALID_STATE/409 | 零写 |
| snapshot/记录损坏 | CLEANUP_SNAPSHOT_REQUIRED 或 INVALID_JOB/409 | 零写 |
| device/claim/slot 绑定变化 | DEVICE_CLAIM_INVALID / DEVICE_CLAIM_CONFLICT / GRANT_SLOT_CONFLICT，409 | 未发送则终结；已发送则 awaiting_result |
| refs 超限/读取不完整 | ADAPTER_UNAVAILABLE/503 | 未发送可重试；已发送保守未知 |
| 环境错误 | NOT_CONFIGURED/503 | terminal_failed，grant 仍 revoked/pending |
| fence/CAS 失败 | LEASE_FENCE_REJECTED/409 | 零写 |

错误 message、stack、ownerOrgId、设备身份及 Provider payload 不进入响应或日志。

## 10. 字段白名单与保留

- grant 新增仅：`cleanupPending,cleanupJobId,revokedAt,revokedByActorId`；禁止 cleanup 原始响应。
- cleanup job 沿用 H3 job 字段，`dispatchSnapshot` 替换为严格 `cleanupSnapshot`；不得同时存在两类 snapshot。
- result 只含 `attempt,outcome,errorKind,reasonCode,finishedAt`。
- log 只含 H3 已批准字段，action=revoke，短码 reason/alert；禁止个人/设备原值。
- slot/claim 仅使用现有 validator 白名单；所有 ID 有界，revision 为正安全整数，时间为非负安全整数，递增前检查溢出。
- grant/job/log/op key/slot/claim 墓碑属于同一保留组；清理策略未批准前不得单独删除 operation key 或墓碑。

## 11. 测试矩阵

以下均为合成 LocalStore/Mock 测试；每项断言 Provider 调用数及内容级快照。

| ID | 场景 | 期望 |
| --- | --- | --- |
| R01 | effective grant 首次 revoke | grant revoked/pending + queued job/log/op 原子提交，Provider 0 |
| R02 | pending/suspended/expired grant | 同样立即失效并建清理 job |
| R03 | 同 operation key 重放 | 原结果，核心零写 |
| R04 | 同 key 异摘要 | CONFLICT，零写 |
| R05 | 两个不同 key 并发撤同一 grant | 一胜一 INVALID_STATE，仅一 job |
| R06 | 权限在事务前后撤销 | FORBIDDEN，零写 |
| R07 | 跨组织/缺失 grant | 同态 404 |
| R08 | job/log/op key 预占 | 全事务回滚 |
| R09 | K2 domain 损坏/换钥 | 失败关闭，grant 不变 |
| R10 | H4-a callback 重跑 | 仅一组写入 |
| R11 | H4-a 提交确认丢失后重放 | 同 job/result |
| R12 | cleanup snapshot 超限/未知字段 | 400，零写 |
| R13 | H3 dispatcher 读取 revoke job | INVALID_JOB，零写 |
| R14 | H4 dispatcher 读取 enroll job | INVALID_JOB，零写 |
| R15 | T1 双 worker | 一胜一 fence 拒绝 |
| R16 | T1 callback 重跑/日志冲突 | 一条 sending log 或全回滚 |
| R17 | T1 确认丢失 | Provider 0，到期 awaiting_result |
| R18 | T2 grant 不再 revoked/cleanupPending | terminal_failed，Provider 0，不复活 |
| R19 | T2 credential revision 变化 | 确定性失败，Provider 0 |
| R20 | T2 device disabled 但绑定未变 | 允许清理 |
| R21 | T2 device/claim/slot 改绑 | 失败关闭，Provider 0 |
| R22 | T2 slot 已被本 job 合法释放 | 本地幂等成功，Provider 0 |
| R23 | T2 runtime 非 test/mock | NOT_CONFIGURED，Provider 0 |
| R24 | T2 callback 重跑 | 一份许可，Provider 至多 1 |
| R25 | 剩余窗口 9999/10000 | 前者拒绝，后者可调用 |
| R26 | Mock success | job succeeded、grant cleanupPending=false、slot released |
| R27 | success 且另有 effective grant | claim 保持 active |
| R28 | success 且无其他 grant | claim released、device 保留旧 claimId |
| R29 | success 时另一 grant cleanupPending | claim 保持 active |
| R30 | candidate 列表扫描后插入新 grant | guard CAS 阻止 claim 释放 |
| R31 | 候选 refs 恰好 90/91 | 90 成功；91 失败关闭且不半释放 |
| R32 | slot 已由其他 job released | GRANT_SLOT_CONFLICT，零覆盖 |
| R33 | claim 已损坏/released | 不覆盖；失败/未知，cleanupPending 保持 |
| R34 | Provider pre_send fail attempt 1 | retryable_failed + 30s |
| R35 | attempt 2/3 边界 | 120s/600s 精确边界 |
| R36 | attempt 4 pre_send fail | terminal_failed + RETRY_EXHAUSTED |
| R37 | revoke_fail post-send | terminal_failed，资源不释放 |
| R38 | post_send_unknown | awaiting_result，资源不释放 |
| R39 | 10s 超时与迟到 success | awaiting_result，迟到零写 |
| R40 | Provider 调用中崩溃 | 到期 awaiting_result，不重发 |
| R41 | T3 callback 重跑/确认丢失 | 一条结果日志，无第二次 Provider |
| R42 | T3 与过期扫描竞争 | 仅一条合法终态 |
| R43 | 人工 retry 无权限/未到期 | FORBIDDEN/INVALID_STATE，零写 |
| R44 | awaiting_result 自动轮询 | 不重发，零写 |
| R45 | confirmed_removed 对账 | succeeded + 合法墓碑原子提交 |
| R46 | confirmed_present 对账 | terminal_failed，cleanupPending=true |
| R47 | still_unknown 对账重放 | 一条确定性日志 |
| R48 | 同设备两住户各撤权并发 | 两 slot 各释放，最后事务才可释放 claim |
| R49 | 撤权与 createGrant 并发 | 不释放仍被引用的 claim |
| R50 | 敏感标记注入 | job/log/result/op/provider input 均零命中 |
| R51 | revision/time/attempt 溢出与字符串 | 失败关闭，零写 |
| R52 | Cloud/live/真实 Provider | NOT_CONFIGURED，零调用 |

## 12. 待 Codex 裁定

1. 是否批准新增 `device-claim-release-guard`（推荐；没有它无法在不扫描锁表的 Store 中证明无幻读）。
2. claim 候选总 refs 超过 90 时，是否固定为“slot 可否仍释放但 claim 保持 active”；本设计选择**同一 T3 不半释放，整体进入 awaiting_result**，最保守。
3. device 保留指向 released claim 并阻止后续授权，重新登记另开任务，是否接受。
4. H4-c 对账是否独立发卡（推荐），H4-a/b 不提前实现。

Codex 通过本设计并明确以上裁定前，H4 编码、HTTP、真实 Provider 与设备连接继续关闭。
