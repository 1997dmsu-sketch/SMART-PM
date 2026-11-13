# HK-AI-04 H4-b Mock 清理闭环任务

## 基线与边界

- 基线：H4-a `685ac3a`
- 设计：H4 `1542a6c` 第 4–7、9–11 节
- 实现独立 `H4MockRevoker`；只允许 LocalStore + Mock Provider。
- 禁止 HTTP、Cloud/live、真实 Provider、真实设备；H4-c 对账不实现。

## 必须实现

1. revoke 专用 job validator、T1 60 秒租约/fence、最多 4 次、30/120/600 秒退避；不得放宽 H3 enroll validator。
2. T2 顺序复核 job/fence、grant、credential、device、claim、slot、release guard、runtime；disabled device 可清理，改绑/损坏失败关闭。事务 callback 重跑只产生一次许可。
3. Provider 仅在事务外调用一次 `revokeFace`，输入/context 严格白名单，10 秒窗口；超时/未知/迟到结果不再写。
4. Mock success 后原子 local finalize：job succeeded、grant `cleanupPending=false`、slot 合法 released 墓碑；无其他阻断 grant 时才释放 owner claim并 CAS guard。device 保留 released claimId。
5. candidate 集合固定含 pending/effective/suspended、全部 expired、revoked+cleanupPending；只排除 revoked+false。完整分页、refs `8+N`，N=82/90 成功，N=83/91 不半释放。
6. Provider 已 confirmed_removed 但 finalize 暂时失败：持久化 `cleanupPhase=finalize/providerOutcome=confirmed_removed`，只做本地 30/120/600 重试，绝不再调 Provider；第 4 次 `LOCAL_FINALIZE_EXHAUSTED`。
7. dispatch pre-send 可重试、attempt 4 耗尽；post-send unknown/超时/租约过期 → awaiting_result 且永不自动重发；terminal 失败资源不释放。
8. 墓碑只接受当前 job 和确定性 audit；其他/部分墓碑冲突。T1/T2/T3 callback 重放、确认丢失、双 worker、过期扫描均线性化。
9. 确定性 audit 必须使用 H4-0A 合约；日志/audit/墓碑预占整事务回滚。
10. 严格字段白名单、safe integer、revision overflow 和敏感扫描；Provider 0/1 次按场景精确断言。

## 测试门槛

完成设计矩阵 R13–R44、R48–R60。R45–R47 明确排除。必须包含：9999/10000 窗口、30/120/600 边界、T1/T2 确认丢失、10 秒超时迟到、82/83 candidates、共享设备两住户、createGrant 并发 guard CAS、local finalize 四次耗尽、Cloud/live 失败关闭。

## 验收

- 可拆 H4-b1（validator/lease/T2）与 H4-b2（Provider/finalize）两笔，但最终同一独立分支；
- 定向、Admin、根测试全绿，`git diff --check` 通过；
- 不改 `server.mjs`，不实现 H4-c；
- H4-b 终审前不宣称完整门禁上线。
