# HK-AI-04 H3 实现复审与验收补齐证据（2026-11-12）

本文件把已批准设计 `ccd6d087527e46e674653ffdf22b22d7390b7e3f`
（`docs/tasks/HK-AI-04-H3-LEASE-DISPATCH-DESIGN.md`）测试矩阵 D01–D66
逐行映射到**实际执行的测试与断言**。不以设计行数或新增测试数量代替逐项证据。

## 基线与环境

- 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\SMART-PM-H3`
- 分支：`codex/hk-face-h3-mock-dispatch`
- 复审前 HEAD：`4bffab13ba763d23d91d19ea26b18602d5bb3791`（已确认）
- 批准设计提交：`ccd6d087527e46e674653ffdf22b22d7390b7e3f`
- 测试运行时：Windows，Node.js `v24.19.0`
- 测试命令：`node --test --experimental-test-isolation=none tests/*.test.mjs`
  （本机沙箱禁止 Node 测试运行器子进程命名管道，`--experimental-test-isolation=none`
  在单进程内执行；未改动任何生产代码路径）
- 复审前基线：管理端 464 项全部通过（复现确认）。
- 本轮结果：管理端 **519 项通过 / 0 失败**；其中 H3 用例 65 个（原 10 个 + 新增 55 个）。
- `git diff --check`：通过。

范围仍严格限定为：隔离合成 `LocalStore` + 进程内 `MockFaceAccessProvider`。
未调用真实 Provider，未注册 HTTP，未接线生产/云数据库，未进入 H4，未接设备，未合并 main；
未修改已批准设计的业务裁定。

## 发现并修复的最小契约差异

| # | 差异 | 修复 | 证据 |
| --- | --- | --- | --- |
| 1 | T2 内 `checkFence` 抛出的 `LEASE_FENCE_REJECTED` 被“确定性 pre-send 拒绝”分支捕获，写成 `terminal_failed`，违反 fence 拒绝零写契约 | 在 T2 catch 中先原样抛出 fence 拒绝 | `admin-web/lib/face-service/dispatcher.mjs:331-340`；测试 D12–D16、D61 |
| 2 | 领取后运行时配置切换为 live/非 Mock 没有重采样入口（D24 无法失败关闭） | 增加可选 `runtimeConfig` 探针与 `#configured()`，在领取后、资格/Provider 前判定，失败只写一条 `NOT_CONFIGURED` 终态 + `CONFIGURATION_BLOCKED` | `dispatcher.mjs:168-202、359-367`；测试 D24 |
| 3 | `revision` 接近 `Number.MAX_SAFE_INTEGER` 时先在日志 ref 计算中溢出为内部 `PARAM_ERROR`，未按 D10 返回 `INVALID_JOB` | `assertJob` 在构造任何写计划前检查 revision 递增余量 | `dispatcher.mjs:48-54`；测试 D10 |
| 4 | 确定性日志同 ID 已存在时抛通用 `Error`，契约码不稳定；快照/非 job-log 写也混在同一错误 | 拆分为稳定 `HttpError(409, …, "CONFLICT")`：日志冲突回滚且不覆盖；非允许集合写入直接拒绝 | `admin-web/lib/store.mjs:238-247`；测试 D52、D50/D52 快照 |
| 5 | 适配器能力检查只验证 `transactFaceDispatch`，未验证可信时钟入口 | 构造器同时要求 `faceDispatchTime`，非 `LocalStore` 或缺少任一时钟/事务能力即拒绝启用 | `dispatcher.mjs:177-185`；测试 D66 |

未修改的设计裁定包括：60 秒租约、10 秒调用窗口、三次重试退避、grant 保持 pending、
Mock success 不产生 device_verified、等待结果不自动重排、H4 边界。

## D01–D22

| ID | 测试名（`admin-web/tests/face-grant-d-matrix.test.mjs`） | 关键断言 | 缺口/说明 |
| --- | --- | --- | --- |
| D01 | `H3 D01 queued→sending：单条确定性领取日志，attempt=1/generation=1，J 且零 audit` | job `sending/attempts=1/leaseGeneration=1/revision=2/leaseExpiresAt=NOW+60000`；日志仅 `queued,sending`（revision 1,2）；Provider 0；除 job/日志外整库与 `admin_audit` 内容级不变 | 无 |
| D02 | `H3 D02 两个 owner 同 revision 并发 T1：仅一个领取提交，另一个 INVALID_JOB，J` | 两并发 dispatch 结果码为 `TEST_STOP`/`INVALID_JOB`；仅一条 sending 日志、job revision=2；Provider 0；整库对照不变 | 第二个 worker 在 T1 即被拒；实现没有两个 worker 同时持有 fence 的可达路径 |
| D03 | `H3 D03 事务 callback 回滚并重跑：sending log 只提交一条，J` | 同 attempt 构建两次写计划完全一致；只提交一条 sending 日志；job 唯一；Provider 0；整库对照不变 | 用 callback 重跑模拟事务回滚 |
| D04 | `H3 D04 succeeded 再次领取：INVALID_JOB，Z` | 成功后再次 dispatch 被拒；整库 deepEqual；Provider 仅前置成功链 1 次 | 前置成功链已调用 1 次 |
| D05 | `H3 D05 领取参数损坏：缺 grantId → INVALID_JOB，Z` | 缺 `grantId` 的 job 被拒；整库不变；Provider 0 | 无 |
| D06 | `H3 D06 跨组织领取：统一 NOT_FOUND，Z` | job 改到其它 org 后返回 `NOT_FOUND/404`；整库不变 | 无 |
| D07 | `H3 D07 错 action 领取：INVALID_JOB，Z` | `action=update` 被拒；整库不变 | 无 |
| D08 | `H3 D08 空白 leaseOwner：INVALID_JOB，Z` | `leaseOwner=""` 被拒；整库不变 | 无 |
| D09 | `H3 D09 不安全时间字段：INVALID_JOB；小数时钟失败关闭，均零写` | 小数 `createdAt`/`leaseExpiresAt` → `INVALID_JOB`；小数时钟与时钟回拨 → `503` 失败关闭；三种情况 store 均不变 | 设计行把“小数 now”写成 `INVALID_JOB`，Q02 却规定时钟不可用失败关闭；按 Q02 实现并单列时钟断言，未改业务裁定 |
| D10 | `H3 D10 revision 非安全整数或将溢出：INVALID_JOB，Z` | `revision=1.5` 与 `Number.MAX_SAFE_INTEGER` 均 `INVALID_JOB`；store 不变 | 无 |
| D11 | `H3 D11 attempts 负数/非安全整数/超预算：INVALID_JOB，Z` | `-1`、`1.5`、`5`（含 leaseGeneration 同步）均 `INVALID_JOB`；store 不变 | 无 |
| D12 | `H3 D12 旧 worker 在新 generation 回写：LEASE_FENCE_REJECTED，Z` | 注入新 generation/owner/revision 后旧 fence 回写被拒；注入后整库（含 audit）不变；Provider 0 | 新 generation 由注入模拟 |
| D13 | `H3 D13 回写时 now 等于 expiresAt：LEASE_FENCE_REJECTED，Z` | T2 在等号边界拒绝，注入后整库不变、Provider 0；补充 T3 边界：job 仍 sending、日志仍 `queued,sending`、Provider 1、grant pending | T3 等号回写必然已发生 1 次调用，故该子用例 Provider=1；设计行 Provider=0 只对应 T2 边界 |
| D14 | `H3 D14 错 generation 回写：LEASE_FENCE_REJECTED，Z` | generation 不一致被拒；整库不变；Provider 0 | 无 |
| D15 | `H3 D15 错 owner 回写：LEASE_FENCE_REJECTED，Z` | owner 不一致被拒；整库不变；Provider 0 | 无 |
| D16 | `H3 D16 同 owner 重入 T2：LEASE_FENCE_REJECTED，零许可零写` | 模拟适配器应用首次 T2 写计划后 rerun，第二次 T2 被拒；store 仍为 T1 后状态（`dispatchAuthorizedAt=null`）；Provider 0 | 无公开 API 可制造“已确认 T2 后同 owner 再入”，用 callback rerun + 应用写计划模拟；`dispatchAuthorizedAt` 分支本身防御性保留 |
| D17 | `H3 D17 明确 pre-send RETRYABLE：retryable_failed + 30s 退避，A+J` | `retryable_failed/attempts=1/nextAttemptAt=NOW+30000/result.errorKind=RETRYABLE`；末条日志 errorKind=`RETRYABLE`；Provider 1；grant pending；仅 job/日志变化 | 无 |
| D18 | `H3 D18 post_send_unknown：awaiting_result + RESULT_UNKNOWN 告警，A+J` | `awaiting_result/UNKNOWN_RESULT/RESULT_UNKNOWN`；末条日志 `alertCode=RESULT_UNKNOWN`；Provider 1；仅 job/日志变化 | 无 |
| D19 | `H3 lost claim commit acknowledgement expires without a send`（原有用例，已补断言） | T1 确认丢失后同 worker 重入 `INVALID_JOB`；59999ms 过期拒绝且零写；60000ms 双扫描仅一次成功；`awaiting_result/LEASE_EXPIRED_UNKNOWN`；仅一条 awaiting 结果日志；Provider 0；audit 不变 | 用“事务已提交但调用方抛错”模拟提交确认丢失，不是真正杀进程 |
| D20 | `H3 D20 已授权且调用一次后崩溃：T3 缺失，过期扫描只转 awaiting_result` | 调用挂起后过期扫描 → `awaiting_result`；放行晚到 T3 被 `LEASE_FENCE_REJECTED` 且零写；Provider 1 | 用挂起 Provider 模拟调用中崩溃 |
| D21 | `H3 D21 Mock success：succeeded 但 grant pending 且 deviceEffective=false，A+J` | T1 后仅 job+一条 sending；T2 后仅 job 的 `dispatchAuthorizedAt/revision/updatedAt`（无新日志）；T3 后 succeeded；result 精确；grant pending；`deviceEffective=false`；无 device_verified；Provider 1 | 无 |
| D22 | `H3 D22 Mock terminal_fail：terminal_failed，不排重试` | `terminal_failed/nextAttemptAt=null/TERMINAL/DEVICE_REJECTED`；末条日志无 alert；Provider 1 | 无 |

## D23–D45

| ID | 测试名 | 关键断言 | 缺口/说明 |
| --- | --- | --- | --- |
| D23 | `H3 D23 Mock 契约返回 NOT_CONFIGURED：terminal_failed + CONFIGURATION_BLOCKED，A+J` | `terminal_failed/NOT_CONFIGURED`；末条日志 `CONFIGURATION_BLOCKED`；`nextAttemptAt=null`；Provider 1 | 无 |
| D24 | `H3 D24 领取后运行配置切为 live：terminal_failed/NOT_CONFIGURED，Provider 0，J` | T1 后 runtime 切 live；终态 `NOT_CONFIGURED` + 配置告警；Provider 0；仅 job/一条日志变化 | runtime 切换用回调探针注入 |
| D25 | `H3 D25 T3 callback 重跑：只提交一条结果日志；重投零写` | 每段 callback 重跑两次共 6 次构建；只提交一条 succeeded 日志；重投 `INVALID_JOB` 且整库不变 | 设计行 Provider=0 指 T3 阶段无新增调用；本端到端用例总计 1 次调用来自 T2 后的发送 |
| D26 | `H3 D26 相同 createGrant 请求重放：原 grantId/jobId，无 snapshot 副本/核心写` | 第二次 replay 结果与首次 deepEqual；snapshot 集合内容级不变且仅 1 条；core 五集合不变；audit +1（H2 基线） | 无 |
| D27 | `H3 D27 同一 dispatcher 并发两次 dispatch：至多一次领取与一次 Mock 调用` | 两个并发 dispatch 一成一拒；拒因 `INVALID_JOB`；Provider 1；日志 `queued,sending,succeeded` | 同一 job 的第二个并发请求在 T1 即被拒，因此不存在两份已确认 T2 许可；T2 再入防御由 D16 覆盖 |
| D28 | `H3 D28 T1 后人员归档：terminal_failed/INVALID_STATE，J` | 终态 `PRE_SEND_BLOCKED/INVALID_STATE`；日志 `queued,sending,terminal_failed`；Provider 0；grant 内容级不变；仅 job/日志变化 | 注入的是 T1 后外部写 |
| D29 | `H3 D29 T1 后固定实名申请撤销（另有 approved）：IDENTITY_NOT_APPROVED，J` | 固定申请撤销、另建 approved 申请仍终态 `IDENTITY_NOT_APPROVED`；Provider 0；grant 不变 | 不按 person 搜索其它 approved 申请 |
| D30 | `H3 D30 T1 后入住关系 revision 变化：REVISION_CONFLICT，J` | 终态 `REVISION_CONFLICT`；Provider 0；grant 不变 | 无 |
| D31 | `H3 D31 T1 后周期 epoch 变化：REVISION_CONFLICT，J` | 终态 `REVISION_CONFLICT`；Provider 0 | 无 |
| D32 | `H3 D32 T1 后目录 revision 变化：REVISION_CONFLICT，J` | 终态 `REVISION_CONFLICT`；Provider 0 | 无 |
| D33 | `H3 D33 T1 后真名单明确 deny：BLACKLIST_DENIED，J` | 注入候选 + 明确 deny 决定后终态 `BLACKLIST_DENIED`；Provider 0；grant 不变 | 无 |
| D34 | `H3 D34 T1 后文件 revision 变化：FILE_BINDING_CHANGED，J` | 终态 `FILE_BINDING_CHANGED`；Provider 0；grant pending；audit 不变 | 原有用例扩充断言 |
| D35 | `H3 D35 T1 后设备绑定变化：DEVICE_CLAIM_INVALID，J` | `claimId` 变化 → 终态 `DEVICE_CLAIM_INVALID`；Provider 0 | 无 |
| D36 | `H3 D36 T1 后 owner claim 释放：DEVICE_CLAIM_INVALID，J` | 释放后的 claim 记录合法但非 active → 终态 `DEVICE_CLAIM_INVALID`；Provider 0 | 无 |
| D37 | `H3 D37 T1 后 grant slot activeClaimId 变化：GRANT_SLOT_CONFLICT，J` | 终态 `GRANT_SLOT_CONFLICT`；Provider 0 | 无 |
| D38 | `H3 D38 T1 后 grant revoked：GRANT_INACTIVE，J` | 终态 `GRANT_INACTIVE`；grant 内容级与注入后基线一致（未被 dispatcher 改写） | 无 |
| D39 | `H3 D39 T1 后 grant 有效期终点到达：GRANT_INACTIVE，J` | `validUntil=now` 终态 `GRANT_INACTIVE`；Provider 0 | 无 |
| D40 | `H3 D40 T1 后 grant suspended：GRANT_INACTIVE，J` | 终态 `GRANT_INACTIVE`；grant 内容级不变 | 无 |
| D41 | `H3 explicitly pre-send Mock failures get three retries and exhaust from sending`（原有用例） | 30000ms 前 1ms 重排 `RETRY_NOT_DUE` 且整库不变；30000ms 整点排队；同法覆盖 120000/600000 | 依赖既有 H3 用例名，未另建重复用例 |
| D42 | 同上（119999/120000ms） | 同上第 2 轮 | 同上 |
| D43 | `H3 D43 600s 退避边界：到期前人工与自动均拒，到期后并发仅一方排队` | 第 3 次失败 `nextAttemptAt=NOW+750000`；到期前 1ms 自动/人工均 `RETRY_NOT_DUE` 且整库不变；到期后并发仅一方 fulfilled；Provider 3；再领取 attempts=4 → `RETRY_EXHAUSTED`；之后人工重试 `INVALID_JOB` 零写 | 设计行 Provider=0 指重排阶段；本用例包含前置三次 pre-send 调用 |
| D44 | 上述既有重试用例 + D43 | 第 4 次领取中明确 pre-send RETRYABLE → 直接 `terminal_failed/RETRY_EXHAUSTED`；末条日志告警；Provider 4；之后 requeue `INVALID_JOB` 且整库不变 | 无 |
| D45 | `H3 D45 源记录/返回对象注入敏感字段：Provider 入参、结果、日志、快照均不泄露` | 源记录/返回对象注入 marker 后：Provider input 恰六字段、context 恰六字段且权限最小集；snapshot 顶层 18 字段与每个 version 六字段严格等白名单；snapshot/job/result/日志序列化不含 marker、`objectKey/checksum/rawResponse/stack/identityDigest/privateNote`、原始用户幂等键、私密文件路径 | 只验证合成敏感值，不代替生产数据扫描 |

## D46–D66

| ID | 测试名 | 关键断言 | 缺口/说明 |
| --- | --- | --- | --- |
| D46 | `H3 concurrent dispatch: one call outside every transaction, simulated success stays pending`（原有用例） | 每个事务 callback 重跑得到同一写计划；`enrollFace` 入口断言事务深度为 0；调用仅 1 次；上下文 `executionMode=test`、幂等键 `h3-v1:<64hex>` | 无 |
| D47 | `H3 D47 T1 后撤销发起成员 device.access.manage：FORBIDDEN，J` | 终态 `FORBIDDEN`；Provider 0；grant 不变 | 无 |
| D48 | `H3 D48 T1 后 lifecycle guard 从缺席变为存在：REVISION_CONFLICT，J` | 注入 guard 后终态 `REVISION_CONFLICT`；Provider 0 | 无 |
| D49 | `H3 D49 T1 后 member 对应主租房间 slot 解绑：SPONSOR_INACTIVE，J` | member 场景 slot 解绑 → 终态 `SPONSOR_INACTIVE`；Provider 0 | 无 |
| D50 | `H3 legacy H2 job without a snapshot fails closed` + `H3 D50/D52 快照不可覆盖、重放内容级一致、内容篡改失败关闭` | 无 snapshot 的 H2 job → `DISPATCH_SNAPSHOT_REQUIRED`，整库不变；快照写入/`change` 均 409 且不覆盖；版本内容篡改 → 终态 `REVISION_CONFLICT` | 旧 H2 job 用 `syntheticDispatch:false` 真实创建 |
| D51 | `H3 D51 有效期内结果先提交：过期扫描比较失败零写，T3 继续 succeeded` | 59999ms 扫描 `LEASE_FENCE_REJECTED` 且整库不变；随后 T3 succeeded；Provider 1；日志 `queued,sending,succeeded` | 扫描获胜分支由 D19/D20 覆盖（60000ms 仅 `awaiting_result`） |
| D52 | `H3 D52 目标日志 ID 已存在：事务回滚，原日志内容保留` | 领取日志冲突：`CONFLICT/409`，job 仍 queued，原日志内容保留，Provider 0；结果日志冲突：`CONFLICT/409`，job 仍 sending，原日志保留，Provider 1 | 设计行 Provider=0 对应领取/预发送阶段；T3 结果日志冲突必然已发生 1 次调用，作为补充子用例并单列 Provider=1 |
| D53 | `H3 unknown result never requeues`（原有用例，已补断言） | `awaiting_result` 后 requeue/dispatch 均 `INVALID_JOB`；整库不变；Provider 1 | 无 |
| D54 | `H3 manual retry requires current membership permission and shares the automatic CAS`（原有用例） | 无 `device.operation.retry` → `FORBIDDEN` 且整库不变；补权后人工与自动并发仅一方成功；Provider 1 | 无 |
| D55 | `H3 lost authorization acknowledgement never consumes the permit`（原有用例） | T2 确认丢失后 Provider 0；job 仍有 `dispatchAuthorizedAt`；60000ms 扫描转 `awaiting_result`，再次扫描空 | 用提交确认丢失模拟，不是真正杀进程；无 DB 重建许可入口 |
| D56 | `H3 D56 T1 后 K1 版本与设备不一致：DEVICE_DIGEST_CONFIG_CHANGED，J` | 终态 `DEVICE_DIGEST_CONFIG_CHANGED`；Provider 0 | 无 |
| D57 | `H3 D57 异常形状/超时统一 UNKNOWN_RESULT；晚到回调零写` | 异常成功形状 → `awaiting_result/UNKNOWN_RESULT`，Provider 1，重投 `INVALID_JOB` 零写；Mock 计时器 10000ms 超时 → `awaiting_result/RESULT_UNKNOWN`，日志仅三条，Provider 1 | 超时用 Node mock timers，未真实等待 10 秒 |
| D58 | `H3 lost claim commit acknowledgement expires without a send`（已扩充） | T1 提交确认丢失后同 owner 重入 `INVALID_JOB` 且整库不变；重入不恢复许可；到期 `awaiting_result` | “进程退出”用确认丢失模拟 |
| D59 | `H3 D59 同 operation key 并发创建：结果一致且仅一条 snapshot，H` | 两并发 createGrant 返回同一结果；snapshot/五类核心记录各只新增一条；Provider 0 | 单进程 LocalStore 串行队列 |
| D60 | `H3 D60 T1 后房间归档：ROOM_ARCHIVED，J` | 终态 `ROOM_ARCHIVED`；Provider 0 | 无 |
| D61 | `H3 D61 错 revision 或 attempt 回写：LEASE_FENCE_REJECTED，Z` | revision 或 attempts 不一致均 fence 拒绝；注入后整库不变；Provider 0 | 无 |
| D62 | `H3 D62 T2 时剩余窗口不足：terminal_failed/PRE_SEND_WINDOW_CLOSED，Provider 0，J` | T2 剩余 5 秒 → 终态 `PRE_SEND_WINDOW_CLOSED`；Provider 0；仅 job/一条日志变化 | 无 |
| D63 | `H3 D12`…`D16`、`D61`（fence 用例）+ `H3 D13` T3 子用例 | 所有 fence 拒绝均对注入后整库（含 `admin_audit`）deepEqual；无日志、无 job 写、无 audit；T3 fence 拒绝也不写 audit | 无单独 admin_audit sink 变更 |
| D64 | `H3 authentic blacklist changes between prepare and T2 refresh the token and block enrollment`（已扩充） | 首轮 T2 检测名单/guard 变化 → `BLACKLIST_RETRY`，重建 token 后第 2 次 T2 提交 `BLACKLIST_REVIEW_REQUIRED`；仅一条 terminal 日志；Provider 0；grant pending；audit 不变 | 名单注入发生在首轮 T2 事务前 |
| D65 | `H3 D65 T2 已确认但保守剩余不足：不调用 Mock，terminal_failed/PRE_SEND_WINDOW_CLOSED` | T2 提交后时钟推到仅余 5 秒 → 明确终态，Provider 0；job 清租约/授权标记；仅 job/日志变化 | 用注入时钟推进，未真实等待 |
| D66 | `H3 D66 适配器能力不足：dispatcher 拒绝启用，零写` | 声明同名方法但非 `LocalStore` 的适配器、以及缺 `faceDispatchTime` 的实例均 `ADAPTER_UNAVAILABLE`；构造过程零写；Provider 0 | 能力探针是结构性信任：只接受本仓 `LocalStore`（串行整库快照 + 单调安全整数时钟），不声称已证明第三方适配器的缺席读保护 |

## 无法在本轮验证 / 明确缺口

1. **真实 CloudStore/云事务**：缺席读保护、提交确认、超时与回滚未在真实云适配器验证；
   D66 采用“结构性拒绝”：非本仓 `LocalStore` 不得启用 dispatcher。
2. **跨进程/多 worker**：`LocalStore` 为单进程串行队列；D02/D19/D27/D51 的并发是同一
   进程内 Promise 并发，不能代替真实多进程竞争证据。
3. **真实 Provider、HTTP、设备、H4**：按范围未调用、未接线、未验证。
4. **进程崩溃**：用“事务已提交但调用方抛错”“Provider 挂起”模拟，未杀真实进程。
5. **D09 设计行内部不一致**：矩阵把小数 now 归为 `INVALID_JOB`，Q02 规定时钟不可用
   失败关闭；实现按 Q02 返回 503，测试同时保留 `INVALID_JOB` 的持久字段损坏分支。
6. **D52 告警**：日志 ID 冲突按要求整事务回滚并返回稳定 `CONFLICT`，没有额外告警写
   （回滚事务内无法再写）；“告警”仅体现为调用方可观察的冲突错误。
7. **D16 第二分支**：`dispatchAuthorizedAt !== null` 的 T2 再入检查保留为防御性代码；
   因 revision 同时递增，公开路径无法只命中该分支。
8. **D45**：仅合成标记，不代表生产数据脱敏扫描或图片字节检查。
