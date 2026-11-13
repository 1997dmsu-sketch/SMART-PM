# HK-AI-04 H3 实现复审：`9e5ff91`

日期：2026-11-13  
复审对象：`codex/hk-face-h3-mock-dispatch @ 9e5ff91b9820468c7991f7f444943aa202cc0bc2`  
代码基线：`90cc8486a19d408be0e3c501d9f5ec61ba13e929`  
结论：**不通过；不得合并，H3 编码、HTTP、真实 Provider 与设备写继续关闭。**

## 门禁状态

本分支从 `ccd6d08` 继续编码，但 `ccd6d08` 已在正式复审 `c27f8c3` 中判定暂不通过，并明确要求“下一提交只能修订 H3 设计与测试矩阵，不得开始生产编码”。本分支没有包含或关闭该复审的四项 P0，而是把被退回的方案直接实现。因此即使自带测试全部通过，也不能视为已获批实现。

## P0 阻断

### P0-1：独立 snapshot 直接造成 90-ref 容量回归

实现新增 `face_dispatch_snapshots`，并在合成 `createGrant` 的 `baseRefs` 中额外加入 snapshot ref。H2-d 已冻结 58 candidates = 90 refs、59 candidates = 91 refs；合成路径会把原本合法的 58/90 推为 91。

当前 D73/D74 仍测试非合成 H2 路径，没有证明 `syntheticDispatch=true` 下 58 candidates 可成功，因此测试避开了真实回归。

返工：按 `c27f8c3` 裁定，把最小不可变 `dispatchSnapshot` 内嵌于既有 job，不新增集合/ref；补合成路径 58/90 成功、59/91 事务前失败和合法重放不改写测试。

### P0-2：成功后 grant 仍 pending，完整授权功能无法生效

`resultWrites(SUCCESS)` 只把 job 改为 `succeeded`；实现和 D21 明确断言 grant 继续 `pending`。现有状态契约要求 grant=`effective` 才可能 `businessAllowed=true`，所以此实现即使 Mock 成功，业务授权仍永久不生效。

返工：T3 成功必须在同一事务内把仍属当前 job、仍有效且仍 pending 的 grant 迁移为 `effective`，同时写 job succeeded 与确定性日志；仍不生成受信设备回执，因此 `deviceEffective=false`。若 Provider 返回期间 grant 被 revoked/expired/suspended，禁止复活，并冻结对应 job 结果。

### P0-3：私设 `transactFaceDispatch` 绕开现有审计与 Store 契约

本分支修改共享 `LocalStore`，新增只允许 job/log 写入且不追加 `admin_audit` 的专用事务旁路，并改变 snapshot 的通用写入/覆盖行为。这正是 `c27f8c3` 明确禁止在 H3 中顺手引入的未复审 Store 契约。

该实现还只支持 `LocalStore instanceof`，无法证明 CloudStore 多 worker、服务端时钟与提交确认语义；因此不能作为可上线的租约实现。

返工：H3 Mock 阶段复用现有 `store.transact`；成功迁移保留现有 admin audit，失败/CAS 拒绝通过抛错保证 job/log/audit 内容级零变化。Cloud/live dispatcher 继续 `NOT_CONFIGURED`。共享 Store 能力若需升级，另开任务卡和独立复审。

### P0-4：瞬态资格错误仍被永久终结，冻结错误码仍被改写

`#authorize` 在第三次 `BLACKLIST_RETRY` 后落为 `ADAPTER_UNAVAILABLE`，并把 `BLACKLIST_RETRY`、`ADAPTER_UNAVAILABLE` 等发送前瞬态失败写成 `terminal_failed`。这没有落实正式复审要求：三轮耗尽必须保留 `BLACKLIST_RETRY`，可确认未发送的瞬态错误应进入 `retryable_failed` 并使用统一预算/退避。

返工时统一 Q03/Q05/Q07 与实现：

- 明确业务失效 → `terminal_failed`；
- `BLACKLIST_RETRY`、`ADAPTER_UNAVAILABLE` 等可确认未发送的瞬态失败 → `retryable_failed`；
- `NOT_CONFIGURED` → `terminal_failed`；
- 无法证明是否发送 → `awaiting_result`。

## P1 问题

1. 验收文档把 `ccd6d08` 写为“已批准设计”，与正式记录不符，须更正。
2. D73/D74 必须覆盖真实合成 createGrant，而不是沿用未增加 snapshot ref 的 H2 路径。
3. D21 必须改为验证 job succeeded + grant effective + `businessAllowed=true` + `deviceEffective=false`。
4. D28–D40、D44、D64 需要按新的确定性/瞬态分类重新断言。
5. 旧 H2 job 必须在扫描候选阶段排除；不得反复选中后才报 `DISPATCH_SNAPSHOT_REQUIRED`。
6. 本分支对 `blacklist.mjs`、`store.mjs`、`service.mjs` 的共享生产改动不得在设计返工提交中夹带。

## 独立验证

- `git diff --check 90cc848..9e5ff91`：通过。
- H3/C4 定向文件：146/146 通过。
- Admin 全量：523/523 通过。
- 根测试：51/51 通过。
- 差异：9 文件，新增约 2288 行、删除 19 行；包含共享生产代码、调度器、独立 snapshot、测试和文档。

测试通过证明实现与其自带测试一致，不证明其符合已经生效的复审裁定。上述四项 P0 均可由生产代码直接复现，故不予批准。

## 下一步

1. 停止在 `9e5ff91` 上继续堆叠修补，不合并该分支。
2. 先从设计分支提交一笔**纯文档**返工，逐项关闭 `c27f8c3` 的 P0/P1；不得带生产代码。
3. 设计终审通过后，从批准基线重新拆发：H3-a（job 内嵌 snapshot、状态/租约 helper）与 H3-b（Mock 调用、结果/grant 原子迁移、重试与过期扫描）。
4. HTTP、Cloud/live dispatcher、真实 Provider、设备连接与写操作继续关闭。
