# HK-AI-04 H4-0A 确定性事务审计任务

## 基线与范围

- 基线：H3-b `2b92b30`
- 设计：H4 `1542a6c`
- 本卡只实现 Store 的可选确定性 audit 能力与合约测试。
- 禁止实现 release guard、revoke、H4 dispatcher、HTTP、Provider 或设备调用。

## 要求

1. `store.transact(refs, build, audit)` 在 `audit.auditId` 存在时：
   - 严格校验有界 ID；
   - 要求 `admin_audit/<auditId>` 已列入 refs；
   - LocalStore 与 CloudStore 均在同一事务内读取其缺席并 create-only 写入；
   - 已存在时整事务冲突回滚；
   - 不再额外生成随机 audit。
2. 未提供 `auditId` 的所有旧调用保持现有随机审计行为与签名，现有测试必须全绿。
3. 确定性记录白名单为 `_id,orgId,actorId,actorType,action,target,createdAt`；`target` 仍由实际 writes 生成，调用方不得注入覆盖。
4. audit ref 计入 90-ref 上限；重复 ref 去重后计数。
5. callback 重放、提交确认丢失模拟、预占 audit ID、业务写失败、审计写失败均须证明业务与审计同成败。
6. Cloud 合约测试必须断言同一 transaction、确定性 doc ID、create-only 语义；不得只测 LocalStore。

## 验收

- 独立分支、追加提交并推送；
- 定向、Admin 全量、根测试全绿；
- `git diff --check` 通过；
- 报告变更文件、测试数和工作区状态；
- H4-0A 通过前 H4-0B/H4-a/H4-b 保持关闭。
