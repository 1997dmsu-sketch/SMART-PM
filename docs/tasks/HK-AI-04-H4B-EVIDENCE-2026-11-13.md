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

## 冻结矩阵映射

| ID | 运行证据 |
| --- | --- |
| R13 | `H4 validator rejects enroll jobs`：revoke validator 拒绝 enroll |
| R14 | 同用例：H4 validator 严格 action/phase，H3 全量回归保持通过 |
| R15 | `two workers compete`：仅一 worker 成功，Provider=1 |
| R16 | `transaction callback replay` 与 T1 log/audit 预占 |
| R17 | `T1/T2 acknowledgement loss`：Provider=0，租约到期 unknown |
| R18 | T2 binding/grant 快照失败关闭组 |
| R19 | credential/person corruption，Provider=0 |
| R20 | disabled device success |
| R21 | device/claim/slot binding corruption，Provider=0 |
| R22 | 本 job tombstone local finalize；其他 job/部分 tombstone 拒绝 |
| R23 | runtime live/非 Mock/Cloud 均 NOT_CONFIGURED |
| R24 | callback replay，Provider=1 |
| R25 | 9999/10000 毫秒边界 |
| R26 | success 完整闭环 |
| R27 | shared effective grant 使 claim 保持 active |
| R28 | 无 blocker 时 claim released，device 保留 claimId |
| R29 | `revoked cleanupPending candidate blocks owner claim release` |
| R30 | candidate-scan phantom 被 release-guard CAS 阻止 |
| R31 | 82/90 成功；83/91 pre-send 拒绝；post-send 转 local finalize |
| R32 | other-job tombstone 拒绝且不覆盖 |
| R33 | `T2 rejects ... claim` 与 `T3 refuses released or structurally corrupt owner claim` |
| R34 | pre-send attempt 1 → 30 秒 |
| R35 | attempt 2/3 → 120/600 秒精确边界 |
| R36 | attempt 4 → terminal_failed/RETRY_EXHAUSTED |
| R37 | revoke_fail → terminal，资源不释放 |
| R38 | post_send_unknown → awaiting_result |
| R39 | 10 秒 timeout 与迟到 success 零写 |
| R40 | T1/T2 ack loss 后 expire，不重发 |
| R41 | T3 callback/ack loss，Provider 始终 1 |
| R42 | `T3 and expiry race commits only one legal terminal state` |
| R43 | manual retry 权限、revision、due 全部复核 |
| R44 | `awaiting_result rejects every automatic or manual continuation` |
| R48 | `two shared-device revoke jobs release claim only after both slots close` |
| R49 | scan 后并发授权由 guard CAS 阻止 claim 释放 |
| R50 | Provider 最小 payload/context 与敏感扫描 |
| R51 | `validator rejects unknown fields, unsafe numbers and phase contradictions` |
| R52 | Cloud/live/non-Mock 构造或 T2 失败关闭 |
| R53 | H4-0B 既有 guard 首建/递增/replay 回归随 Admin 全量通过 |
| R54 | H4-0B 57/90、58/91 createGrant 回归随 Admin 全量通过 |
| R55 | 真实 guard revision/epoch CAS 的 phantom 注入测试 |
| R56 | unknown state、revoked 非布尔 cleanupPending 保守阻断 |
| R57 | dispatch/retry phase 对其他 job/audit/部分墓碑失败关闭 |
| R58 | Provider success 后 Store/83 candidates → confirmed_removed/finalize |
| R59 | local finalize 恢复与第 4 次 LOCAL_FINALIZE_EXHAUSTED，Provider=1 |
| R60 | local/T3 callback 与确认丢失收敛，Provider 不增加 |

补充 TOCTOU 证据：`T3 rejects every pre-read candidate that disappears or leaves scope`
覆盖候选在扫描后缺失、改 deviceId、改 claimId，均进入 local-finalize，绝不释放资源。
