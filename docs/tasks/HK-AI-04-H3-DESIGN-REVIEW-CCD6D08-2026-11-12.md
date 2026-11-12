# HK-AI-04 H3 设计复审：`ccd6d08`

日期：2026-11-12  
复审对象：`docs/hk-h3-lease-dispatch-design @ ccd6d087527e46e674653ffdf22b22d7390b7e3f`  
代码基线：`90cc8486a19d408be0e3c501d9f5ec61ba13e929`  
结论：**暂不通过；H3 编码、HTTP、Provider 调用及设备写继续关闭。**

## 已确认可保留的设计

- T1 领取、T2 发送前复核、事务外调用、T3 结果提交的分段方向正确。
- fence 至少绑定 owner、generation、attempt、revision；旧 worker、过期租约和重复结果失败关闭。
- Mock-only、`executionMode=test`、`evidenceScope=simulated`，不生成 `device_verified` 或受信 `device_ack`。
- `UNKNOWN_RESULT` 进入 `awaiting_result`，不得自动重发；租约过期保守进入结果不明。
- 发送前继续复核权限、资格、真实名单、文件、设备、K1、owner claim 和 slot；Provider 在事务外至多调用一次。
- 初次之外最多三次、30/120/600 秒退避、人工重试与自动调度争用同一 CAS 的方向可保留。

## 阻断项

### P0-1：独立 snapshot 会破坏已经冻结的 90-ref 容量边界

H2-d 已实测并批准：58 个名单候选时合并读集恰好为 90 refs，59 个为 91 refs 并在事务前失败。设计要求在同一 `createGrant` 事务中再增加独立 snapshot 引用和写入，但没有解释 90→91 的容量回归。

裁定：H3 不新增独立 snapshot 集合/ref。把最小、不可变、白名单化的 `dispatchSnapshot` 内嵌在创建时已写入的 job 中，沿用现有 job ref；合法重放不得重写。若坚持独立文档，必须先另案重新批准最大名单容量下降，当前不批准。

返工必须冻结内嵌字段、schemaVersion、大小上限、敏感字段禁入、旧 job 缺 snapshot 的隔离规则，并把 D59/D73/D74 更新为 58/90 仍成功、59/91 仍在事务前失败。

### P0-2：Mock success 保持 grant=pending 与现有授权投影相矛盾

现有状态契约明确 `businessAllowed = grant effective + 实时资格`。设计让 job 成为 `succeeded`，却永久保持 grant `pending`，结果是一次成功的合成授权仍永远不具备业务生效态，H3 无法完成“Mock 派发成功”的闭环。

裁定：Mock success 的 T3 必须在同一事务内完成：

1. job `sending -> succeeded`；
2. grant 仅在仍为当前 job 对应的 `pending` 且有效时 `pending -> effective`；
3. 追加确定性结果日志；
4. 保持 `evidenceScope=simulated`，不生成受信设备证据，因此 `deviceEffective=false`。

若 T2 后 grant 已 revoked/expired/suspended、绑定已变化或不再 pending，T3 绝不能恢复 grant；须冻结 job 的目标状态和 reasonCode，并补成功结果与撤权/过期并发测试。失败、未知和配置阻断均不得把 grant 置为 effective。

### P0-3：设计依赖尚不存在的“纯事务/可信存储时钟/提交回执”，但未冻结接口

当前 LocalStore/CloudStore `transact` 会追加 `admin_audit`，接口没有设计所称的存储侧时钟或独立提交回执。文档一边要求使用现有 Store，一边又要求成功迁移不得附带通用 audit，导致编码方无法判定应修改共享 Store、另建接口还是绕开审计。

裁定：H3 Mock 阶段不新增未经复审的“纯事务”旁路：

- 成功状态迁移继续使用 `store.transact`，允许且必须计入现有 `admin_audit`；操作日志仍与 job/grant 原子提交。
- 拒绝/CAS 失败必须抛错回滚，不能以空 writes 表示失败；断言 job、日志及 `admin_audit` 内容级零变化。
- 时钟作为 dispatcher 的受控依赖，在每次事务 attempt 内重新采样并校验非负安全整数；本阶段仅允许单进程 LocalStore/Mock 验证。
- Cloud/live 多 worker 派发保持 `NOT_CONFIGURED`，直到另一个 Store 能力任务明确提供服务端时钟、缺席读保护和提交确认语义并单独复审。

返工应删除“派发成功不得有通用 audit”的要求，更新 Z/J/A/H 定义和 D63/D66；不得在 H3 编码中顺手修改共享 Store 契约。

### P0-4：发送前瞬态失败被错误终结，且改变了冻结的 BLACKLIST_RETRY 语义

设计把三轮 `BLACKLIST_RETRY` 耗尽改写成 `ADAPTER_UNAVAILABLE`，又把名单适配失败等所有 pre-send 失败统一写成 `terminal_failed`。这会丢失冻结错误码，并把暂时性基础设施/并发问题误当永久业务拒绝。

裁定：

- `BLACKLIST_RETRY` 三轮耗尽仍保留 `BLACKLIST_RETRY`，不得改写。
- 确定性业务失效（授权失效、凭证/文件改变、资格明确不满足、黑名单 deny/review、设备/claim/slot 确定变化）→ `terminal_failed`，Provider 0。
- 瞬态 `BLACKLIST_RETRY`、`ADAPTER_UNAVAILABLE`、可确认未发送的临时读取/适配失败 → `retryable_failed`，使用同一预算与退避，Provider 0。
- `NOT_CONFIGURED` → `terminal_failed` 并告警。
- 无法证明是否发送 → `awaiting_result`，永不自动重发。

Q03/Q05/Q07 与测试矩阵须使用同一分类表，不能让同一 reasonCode 在不同章节得到不同目标状态。

## 必须同步收紧的 P1

1. 旧 H2 job：调度扫描必须在候选查询阶段排除缺 `dispatchSnapshot` 的 job；直接请求返回 `DISPATCH_SNAPSHOT_REQUIRED` 且零写。迁移另开任务，不在 H3 自动补写。
2. 发起权限：H3 仅支持当前由人工 `createGrant` 创建的 job，发送前继续复核 snapshot 固定的 membership/actor 与 `device.access.manage`；未来系统任务另案。
3. 日志与审计：确定性 operation log create-only；成功事务允许一条现有 admin audit。失败事务二者均零新增。
4. 结果竞态：补齐“Mock 返回 success，但 grant 在调用期间被撤销/过期/暂停”的内容级断言，禁止复活授权。
5. 设计文档应把未来测试矩阵中的 D21、D28–D40、D44、D50、D59、D63、D66 及写集符号按上述裁定改写。

## 复审证据

- `ccd6d08` 相对代码基线仅增加/修改一份 Markdown；`git diff --check 90cc848..ccd6d08` 通过。
- H2-d 冻结证据明确 58 candidates/90 refs 成功、59/91 失败。
- 当前 `state.mjs` 与 README 均要求 grant effective 才能 `businessAllowed=true`；Mock/simulated 不会产生 `deviceEffective=true`。
- 当前 Store 的两种实现均追加 `admin_audit`；CloudStore 明确限制去重后最多 90 refs。

## 下一步

下一提交只能修订 H3 设计与测试矩阵，不得开始生产编码。修订后重新申请设计终审；通过后再拆发 H3-a（dispatcher helper/状态机）与 H3-b（Mock 派发及结果迁移）编码卡。
