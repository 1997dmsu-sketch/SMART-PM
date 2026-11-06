# HK-AI-04 服务层 `d2a994a` 复审（2026-11-06）

结论：**服务层复审不通过，禁止注册 HTTP。** 流程拆分方向正确，Provider 已在事务外调用，但当前实现绕过正式组织/文件/入住/设备服务，claim、slot、幂等、grant 初态和任务执行语义均偏离冻结设计。问题不止是申报的测试缺口，必须先修生产代码。

## 独立核验

- 分支：`feat/hk-face-service-integration`
- 提交：`e71cb3b`、`d2a994a`（分支还包含集合和初版服务提交）
- 基线链包含：AI-C `c7516e6`、Mock `724d888`
- `admin-web`：262/262通过
- 根测试：51/51通过
- 未修改 `server.mjs`，未注册 HTTP，未连接网络或设备

## 已通过方向

1. submit/review/grant/revoke/query 已拆成独立方法。
2. review 不自动建 grant/job，撤权不被名单检查阻止。
3. Provider 调用位于 `store.transact` 之外。
4. Mock job 保持 `provider=mock`、`executionMode=test`、`evidenceScope=simulated`。
5. 名单阻断测试桩下 grant/job/operation key 零写入。

## P0-1：正式资格与设备归属完全未校验

现有测试库只建立 file 和 membership，没有 person、identity application、occupancy、cycle、room、access device，`createGrant` 仍成功。`withEligibility` 只解决名单竞态，不替代完整资格检查。

必须在同一 grant 事务内验证：person 属于组织且有效；identity application approved 且属于该 person；occupancy active 且 person/room/cycle 一致；cycle active 且未过期；room/building/community 未归档；access_device active、ownerOrgId 正确且 capability.face 可用；credential approved、版本未变且属于同一 person。发送前 worker 再复核当前资格，失效则 queued→cancelled，不调用 Provider。

## P0-2：credential 与 grant 输入模型错误

submit 使用 `assertEnrollInput`，要求客户端提前提供 deviceId、grantId 和授权有效期，并把它们写入 credential；随后 createGrant 又生成另一个 grantId。冻结 C03 credential 只绑定 person、sourceFile、同意/提交/审核版本，不预绑定设备授权。

修复：submit 输入移除 deviceId/grantId/授权期限；createGrant 显式接收并校验 `personId/deviceId/occupancyId/cycleId/credentialId/validFrom/validUntil/grantSource`。credential 与 person 一致，授权期限不得超出 occupancy/cycle。

## P0-3：claim/slot 固定键错误

- `deviceClaimKey(deviceId)` 不是冻结的全局设备 claim。正式键基于 provider、digestRealm 和 HMAC-K1(规范化设备标识)，claim 保存唯一 ownerOrgId；grant 创建只读取既有设备 owner，不为每个 grant 重新占有设备。
- `grantSlotKey(deviceId, grantId)` 因 grantId 每次不同，无法阻止同一入住周期重复授权。冻结键为 `grant-slot:{orgId}:{personId}:{deviceId}:{cycleId}`，slot 保存 activeClaimId、revision 和 releasedAt。

按冻结键重写并补同 slot 并发只成功一次、旧 cycle slot 不复活、换租新 cycle 可新建测试。

## P0-4：grant 初态及原子日志错误

C05 要求同一事务写 `grantState=pending`、`jobState=queued`、op key、slot、job 和只追加 operation log。当前 grant 直接写 `effective`，且从未写 `device_operation_logs`。Mock succeeded 也只能表示 simulated，不能自动证明真实设备 effective。

修复：创建时 pending；按批准的业务投影决定模拟展示，不虚写真实生效。grant/job/log/op/slot 和 credential/资格版本复核同事务完成。

## P0-5：幂等重放会重复调用 Provider

createGrant/revoke 从 operation key 重放原 result 后，方法结尾仍按 `result.jobId` 调 `#runJob`。同 key 同输入会再次下发并增加 attempts。必须区分 `createdNewJob` 与 replay；只有本次新建且成功取得任务租约的 worker 才能下发。补同键重放 Provider 调用次数不增加的测试。

operation key 还必须校验16–128字符及字符集，并按 K2 摘要生成固定 ID；不得把原始 idempotency key 和未约束分段直接拼入记录 ID。

## P0-6：任务状态、租约和错误映射不符合契约

当前 queued 任务没有 lease/sending，调用前不重验资格；所有非 UNKNOWN 错误都写 terminal_failed，导致 RETRYABLE 被错误终结。必须实现：租约原子领取；queued→sending；发送前重验；RETRYABLE→retryable_failed；UNKNOWN_RESULT→awaiting_result；TERMINAL→terminal_failed；每次迁移追加 operation log。无法证明未发送时不得自动重试。

## P0-7：撤权没有释放 slot，成功清理也不闭环

撤权事务必须立即 grant→revoked、释放 slot（保留历史 releasedAt）、创建 revoke job/log/op。当前未写 slot；清理成功后仍保留 cleanupPending=true。成功时清除 cleanupPending，失败/未知保持 true，任何结果都不得恢复 grant。设备 owner claim 不随单个 grant 撤销。

## P1：组织、文件和权限复用不成立

1. `#membership` 直接按调用方传入 membershipId 读表，没有通过 `OrgService.requireMembership` 核对 principal，也没有在业务写事务内重新检查最新权限；权限撤销可与写入竞态。
2. `device.access.manage`、`device.audit.read` 等尚未加入 `OrgService` 的可授予清单，测试通过直接写 membership 绕过正式入口。
3. submit 直接读 `file_assets`，未复用 `FileService` 的组织、purpose、ready/private 和审计边界。应注入正式服务或增加正式的“引用校验但不返回图片字节”方法；不能要求 submitter 因引用自己的文件而获得 readPrivate。
4. review 的 expectedRevision 当前可省略，应强制要求；credential 需保存 submittedBy/reviewer/decision reason，按政策验证自审边界。

共享 `org.mjs`、`files.mjs` 如需修改，必须独立提交并单独测试。

## 下一轮要求

先重构服务层和固定键，再补已申报的3/6/10/16/18测试及上述并发、租约、重放、日志、slot、撤权闭环测试。不得注册 HTTP；阶段3、真实 Provider、设备连接和生产写接口继续关闭。
