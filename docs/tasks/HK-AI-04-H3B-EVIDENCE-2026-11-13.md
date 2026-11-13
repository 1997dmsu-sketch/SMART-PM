# HK-AI-04 H3-b D01–D66 证据映射

基线：H3-a `5e590ee`。本表只覆盖单进程 `LocalStore` + 进程内
`MockFaceAccessProvider`；HTTP、Cloud/live、真实设备与 H4 均未启用。

证据文件：

- `admin-web/tests/face-h3a.test.mjs`：H3-a 快照、T1、fence、日志冲突与
  LocalStore 边界；
- `admin-web/tests/face-grant-d-matrix.test.mjs`：H2/C4 真实资格基线及本次
  `H3-b ...` 用例；
- `admin-web/lib/face-service/h3b.mjs`：T2、事务外 Mock、T3、重排和扫描。

| ID | 自动化证据 |
|---|---|
| D01 | `face-h3a`: T1 单 worker；`H3-b D01/D21a` |
| D02 | `face-h3a`: two workers compete |
| D03 | `face-h3a`: callback/确定性日志唯一提交 |
| D04 | `face-h3a`: 非 queued 拒绝；`H3-b D22/D23` 重投拒绝 |
| D05 | `face-h3a`: strict job schema |
| D06 | `face-h3a`: cross-org 同态 404 |
| D07 | `face-h3a`: action 白名单 |
| D08 | `face-h3a`: owner 边界 |
| D09 | `face-h3a`: 时钟/租约安全整数 |
| D10 | `face-h3a`: revision 溢出边界 |
| D11 | `face-h3a`: attempts 边界 |
| D12 | `face-h3a`: stale generation fence |
| D13 | `face-h3a`: expiry equality fence |
| D14 | `face-h3a`: generation mismatch |
| D15 | `face-h3a`: owner mismatch |
| D16 | `face-h3a`: 同 owner 重入/禁止续期 |
| D17 | `H3-b D44/D45`：pre_send retryable + 30 秒退避 |
| D18 | `H3-b D32/D40`：post_send unknown |
| D19 | `H3-b D19/D51`：双扫描仅一次提交 |
| D20 | `H3-b D38/D50`：已领取后过期保守 awaiting_result |
| D21 | `H3-b D01/D21a`、`D21b`、`D21c` 三子例 |
| D22 | `H3-b D22/D23`：terminal_fail |
| D23 | `H3-b D22/D23`：Provider NOT_CONFIGURED |
| D24 | `H3-b D24/D62/D65`：运行配置切换，Provider=0 |
| D25 | `face-h3a` 日志冲突/fence；`H3-b D63/D66` |
| D26 | C4 `D67` 合法重放，snapshot 深比较 |
| D27 | `H3-b D27`：两个 dispatcher 仅一次调用 |
| D28 | `H3-b D28-D40/D47/D56/D60`：person archived |
| D29 | 同上：固定 identity revoked |
| D30 | 同上：occupancy revision |
| D31 | 同上：cycle epoch |
| D32 | 同上；C4 `D38/D41/D44/D47` 目录见证 |
| D33 | `H3-b D33`：T1 后写入真实 deny 决定，T2 由真实 BlacklistService 阻断且 Provider=0 |
| D34 | `H3-b D28-D40...`：file revision |
| D35 | 同上：device claimId |
| D36 | 同上：owner claim released |
| D37 | 同上：slot activeClaimId |
| D38 | 同上：grant revoked；另见 `D21c` |
| D39 | `D21c` expired + T2 grant 有效期检查 |
| D40 | `D21c` suspended |
| D41 | `H3-b D44/D45`：29999 拒绝、30000 成功 |
| D42 | `H3-b D42/D43`：第二次失败精确 120000，119999 拒绝、120000 可重排 |
| D43 | `H3-b D42/D43`：第三次失败精确 600000，599999 拒绝、600000 可重排 |
| D44 | `H3-b D44 attempt=4` 两类瞬态，原码与 Provider 次数 |
| D45 | `H3-b` 敏感扫描 + Provider input/context 白名单 |
| D46 | `H3-b D46`：T2/T3 callback 各重跑一次，Provider 仍只调用一次 |
| D47 | `H3-b D28-D40...`：权限撤销 |
| D48 | C4 lifecycle guard 竞态；T2 snapshot/witness 复核 |
| D49 | C4 member primary/slot/sponsor 真实资格矩阵；T2 复用 helper |
| D50 | `face-h3a` old job；`H3-b D38/D50` 扫描排除/直接拒绝 |
| D51 | `H3-b D19/D51`：结果/扫描共享 fence CAS |
| D52 | `face-h3a` deterministic log collision；`H3-b D63/D66` |
| D53 | `H3-b D32/D40`：awaiting_result 不可重排 |
| D54 | `H3-b D54`：权限与人工/自动 CAS |
| D55 | `H3-b D55/D58`：T2 已提交但确认丢失，Provider=0，租约过期后保守收敛 |
| D56 | C4 K1 domain 全变体；T2 `digestDomainMatchesDevice` |
| D57 | `H3-b D57`：注入确定性 10000ms 超时，迟到成功结果对核心业务零写入 |
| D58 | `H3-b D55/D58`：T1 已提交但确认丢失，Provider=0，租约过期后保守收敛 |
| D59 | C4/H2-d operation key 并发、90/91 refs 与 snapshot 深比较 |
| D60 | `H3-b D28-D40...`：room archived |
| D61 | `face-h3a` fence revision/attempt mismatch |
| D62 | `H3-b D24/D62/D65`：窗口不足 |
| D63 | `face-h3a` fence 回滚；`H3-b D63/D66` 内容级零变化 |
| D64 | C4 `D60–D62` token 重建；`H3-b D44 BLACKLIST_RETRY` 三轮保码 |
| D65 | `H3-b D24/D62/D65`：授权后保守窗口检查 |
| D66 | `face-h3a` Cloud 拒绝；`H3-b D63/D66` 非 LocalStore/Mock 拒绝与正例 |

补充门禁：定向测试还断言 Mock 入口调用计数、最小 input/context、job/grant 原子
迁移、审计增量、失败零 Provider、敏感字段和值扫描。全部运行结果记录在提交回报中。
