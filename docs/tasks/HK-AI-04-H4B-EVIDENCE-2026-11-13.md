# HK-AI-04 H4-b Mock 清理交付证据

- 分支：`feat/hk-face-h4b-mock-cleanup`
- 基线：H4-a `685ac3a`
- 边界：LocalStore + Mock only；无 HTTP、Cloud/live、真实 Provider 或设备连接；H4-c 未实现。

## 实现

- `H4MockRevoker` 使用独立 revoke job validator，不放宽 H3 enroll validator。
- T1 60 秒租约/fence；T2 复核 grant/credential/device/claim/slot/release guard；Provider 在事务外调用。
- 10 秒调用窗口、30/120/600 秒退避、4 次耗尽、超时/未知/租约过期均失败关闭。
- success 原子清理 grant/slot，并仅在完整候选扫描与 release-guard CAS 成功时释放 owner claim。
- Provider 已确认删除但 Store/finalize 暂时失败时进入 local-finalize；只重做本地事务，绝不重发 Provider。
- H4 事务使用确定性 audit；job/log/audit 冲突整事务回滚。

## 运行级证据

`face-h4b.test.mjs` 覆盖：

- success、共享设备 claim 保留、disabled device 清理；
- pre-send retry、30/120/600 精确边界、attempt 4 耗尽；
- post-send unknown、terminal、10 秒超时与迟到结果零写；
- T1 双 worker、租约过期、手工 retry 权限/revision；
- 9999/10000 毫秒发送窗口；
- 82 candidates/90 refs 成功、83/91 Provider 前拒绝、Provider 后出现 83 条进入 local-finalize；
- local-finalize 恢复与 4 次耗尽，Provider 调用始终为 1；
- candidate-scan 后并发授权由 release-guard CAS 阻止幻读；
- T1 log/audit 预占回滚、最小 Provider payload/context、敏感字段零命中；
- revoke/enroll validator 隔离、runtime/binding 变化 Provider 0。

H4-c 的 confirmed_removed/confirmed_present/still_unknown 人工对账不在本交付范围。
