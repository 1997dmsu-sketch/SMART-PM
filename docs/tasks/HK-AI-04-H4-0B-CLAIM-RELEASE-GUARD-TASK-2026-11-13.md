# HK-AI-04 H4-0B claim release guard 任务

## 基线与边界

- 基线：H4-0A `ec8be46`
- 设计：H4 `1542a6c`
- 仅实现 `device_claim_release_guards`、`createGrant` CAS 与容量/竞态测试。
- 禁止实现 revoke、H4 dispatcher、HTTP、Provider 或设备操作。

## 实现要求

1. 新增组织域集合 `device_claim_release_guards`，登记 Store 白名单、seed、Local init 与 `validateRecord` 分发。
2. key：`device-claim-release-guard:{b64url(orgId)}:{b64url(claimId)}`；schema 精确白名单 `_id,orgId,claimId,epoch,revision,createdAt,updatedAt`。ID 有界；epoch/revision 为正安全整数；时间为非负安全整数；未知字段拒绝。
3. `createGrant` 的每次 attempt 在事务前规划并在事务内读取 guard：
   - 该 claim 首次成功授权且没有历史 grant 时，原子创建 1/1；
   - 后续新 grant 原子 epoch+1/revision+1；
   - 合法 operation-key replay 零写、不递增；
   - guard 损坏、版本溢出或“缺 guard 但已有历史 grant”失败关闭，禁止补写迁移。
4. guard ref 必须与 grant/slot/job/log/op key 同一 `store.transact`；任何冲突整事务零写。
5. 最大布局改为 `33+N`：57 candidates/90 refs 成功，58/91 在开启事务前 400；去重后计数。
6. 两个不同 person/slot 并发引用同一 claim 时均可线性化成功并各递增一次；相同 slot 竞争仍只允许一个成功。
7. 测试必须覆盖 key 碰撞、跨组织、非法 schema、安全整数、首次创建、后续递增、重放、损坏/缺失历史、callback 重跑、并发 CAS、57/58 边界及所有业务集合内容级副作用。

## 验收

- 独立分支、追加提交并推送；
- 定向、Admin、根测试全绿，`git diff --check` 通过；
- 不得以修改 90 上限、拆事务或自动迁移绕过 guard；
- H4-0B 通过前 H4-a/H4-b 保持关闭。
