# HK-AI-04 H3-b 编码任务：Mock 派发与结果迁移

日期：2026-11-13  
基线：`feat/hk-face-h3a-embedded-snapshot @ 5e590ee04fee0d71f81b22c3c2b505de1fefa293`  
批准设计：`b2cd7abf7699a93db58c245e5773f14aa50093ee`

## 目标

在 H3-a 基线上完成单进程 LocalStore + 进程内 Mock 的 H3-b：T2 发送前复核、事务外至多一次 Mock 调用、T3 job/grant 原子结果、瞬态重试、过期扫描。完成后仍不注册 HTTP、不连接真实设备。

## 必须实现

1. T2 顺序：job/fence → grant/credential/file/发起权限 → 完整资格/真实名单 → device/K1/owner claim/slot。
2. 每次 BLACKLIST_RETRY 重建 token/refs并重验 fence，最多三轮；耗尽保留 `BLACKLIST_RETRY`。
3. T2 成功只写 `dispatchAuthorizedAt`/revision/audit，返回一次性进程内许可；许可不可从 DB 恢复或跨实例转交。
4. Mock 调用严格在事务外，Provider 方法入口最多一次；固定 test/mock/simulated 和最小 system context。
5. T3 success：若 grant 仍为当前 job 对应、同 revision、pending、有效且绑定未变，原子写 job succeeded + grant effective + 日志 + audit。
6. grant 在调用期间失效/改绑：不复活，job terminal_failed / `GRANT_INACTIVE_AFTER_SEND`，告警 `SIMULATED_RESULT_DISCARDED`。
7. 实时资格在调用期间失效不改写资格：job succeeded、grant effective，但读取投影 `businessAllowed=false`、`deviceEffective=false`。
8. 明确业务失败 terminal；可确认 Provider 0 的 BLACKLIST_RETRY/ADAPTER_UNAVAILABLE 与 Mock pre_send RETRYABLE 进入统一预算；UNKNOWN_RESULT/超时/异常形状进入 awaiting_result，永不自动重发。
9. 退避 30/120/600 秒；初次外最多三次；人工 `device.operation.retry` 与自动重排争用同一 CAS。
10. 60 秒租约、10 秒调用窗口、禁止续期；租约过期保守 awaiting_result；扫描查询阶段排除缺 snapshot 的旧 job。
11. 所有成功迁移复用现有 `store.transact` 并产生现有 audit；失败/CAS/fence 拒绝抛错且业务、日志、audit 内容级零变化。

## 测试与验收

- 按批准设计 D01–D66 逐项映射，H3-a 已覆盖项可复用但必须完整列证据。
- 特别覆盖 D21 三子例、D44 两类瞬态、D50、D59、D63、D66。
- callback 重跑、提交确认丢失、调用崩溃、T3/过期扫描竞争、日志冲突、晚到结果。
- Provider input/context 严格白名单；结果、日志、audit、snapshot 敏感字段和值扫描。
- Provider 只允许 `MockFaceAccessProvider`；Cloud/live/非 LocalStore 构造或运行均 `NOT_CONFIGURED` 且零写。
- 定向测试、Admin 全量、根测试、`git diff --check` 全绿。

## 禁止项

- 不修改 `store.mjs`，不新增事务旁路。
- 不注册 HTTP、不修改 server 接线、不连接 Cloud/live、真实 Provider 或设备。
- 不进入 H4 撤权、设备清理、人工对账或可信设备证据。

## 交付门禁

独立分支提交并推送，回报完整 SHA、差异、D01–D66 映射、测试、调用计数及边界。通过 Codex 终审前不得开展 H4 或上线接线。
