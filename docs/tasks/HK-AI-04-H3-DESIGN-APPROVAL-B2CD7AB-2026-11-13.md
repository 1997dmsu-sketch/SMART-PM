# HK-AI-04 H3 设计终审：`b2cd7ab`

日期：2026-11-13  
复审对象：`docs/hk-face-h3-design-rework @ b2cd7abf7699a93db58c245e5773f14aa50093ee`  
代码基线：`90cc8486a19d408be0e3c501d9f5ec61ba13e929`  
结论：**通过；关闭 `c27f8c3` 与 `35028b7` 的设计阻断，允许按 H3-a/H3-b 拆分编码。**

## 已冻结裁定

1. `dispatchSnapshot` 内嵌既有 job，不新增集合或事务 ref；58 candidates/90 refs 仍成功，59/91 仍在事务前 400。
2. H3-a/H3-b 仅支持单进程 LocalStore + 进程内 Mock；Cloud/live、多 worker、HTTP、真实 Provider 与设备写继续 `NOT_CONFIGURED`/关闭。
3. 复用现有 `store.transact` 与 `admin_audit`，不得新增纯事务旁路或顺手修改共享 Store 契约。失败/CAS 拒绝必须抛错回滚，job/grant/log/audit 内容级零变化。
4. Mock success 的 T3 原子写 job succeeded、仍属当前 job 且仍有效 pending 的 grant effective、确定性日志及现有 audit；不生成可信 device ack，所以 `deviceEffective=false`。
5. `businessAllowed` 仍由读取时实时 eligibility 决定；资格在 Provider 调用期间失效时 job/grant 可保持 succeeded/effective，但 `businessAllowed=false`，不得改写资格或重复调用 Provider。
6. grant 在调用期间 revoked/expired/suspended、revision/绑定改变或不再 pending 时绝不复活；job terminal_failed / `GRANT_INACTIVE_AFTER_SEND`，日志告警 `SIMULATED_RESULT_DISCARDED`。
7. 确定性业务失效终结；可确认未发送的 `BLACKLIST_RETRY`、`ADAPTER_UNAVAILABLE` 等瞬态失败进入统一重试预算；未知发送结果进入 awaiting_result，永不自动重发。
8. 旧 H2 job 在候选扫描阶段排除；直接请求返回 `DISPATCH_SNAPSHOT_REQUIRED`，H3 不迁移、不补写。
9. 60 秒租约、10 秒调用窗口、禁止续期；初次外最多三次，退避 30/120/600 秒。
10. `9e5ff91` 不作为实现基线，不得 cherry-pick 其独立 snapshot、Store 旁路或 pending-success 语义。

## 独立检查

- 相对 `ccd6d08` 仅修改一份设计 Markdown；无生产代码或测试改动。
- `git diff --check ccd6d08..b2cd7ab` 通过。
- D01–D66 唯一连续；关键 D21、D44、D50、D59、D63、D66 已按正式裁定改写。
- 设计明确拆分 H3-a 与 H3-b，未放行 H4、HTTP、Cloud/live 或真实设备。

## 编码门禁

- H3-a 只实现 job 内嵌 snapshot、validator、租约/fence/状态迁移 helper 与合成测试；Provider 调用必须为 0。
- H3-a 复审通过后才允许 H3-b 发送前复核、事务外 Mock 调用、T3 原子结果、重试和过期扫描。
- 每阶段必须独立提交、全量测试、内容级副作用断言和敏感字段扫描。

