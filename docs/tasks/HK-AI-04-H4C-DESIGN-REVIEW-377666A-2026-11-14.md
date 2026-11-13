# HK-AI-04 H4-c 设计终审（377666a）

- 分支：`docs/hk-face-h4c-reconciliation-design`
- 返工提交：`b6ae78d26cfcb6c9a9bd01076f0421a143cece90`
- 最新提交：`377666a1603a0281a93f9f5dcdb14d06f5f32f04`
- 结论：**大部分返工通过，但仍有 2 项 P0；H4-c 编码继续关闭。**

## 上轮返工确认

以下方向已关闭上轮阻断：

- 独立 K3 配置、fingerprint 与全局 domain head/version；
- 组织域 evidence 与 evidence head，所有 decision 同事务 CAS；
- 三种 decision 事务内读取并复核 grant；
- 公开 DTO 只接受 `operator`，拒绝伪造 `mock_provider`；
- `LOCAL_FINALIZE_EXHAUSTED` 提出 Provider=0 的人工本地恢复入口；
- RC01–RC64 连续矩阵及老数据失败关闭。

## P0-1：finalize-retry 重复恢复语义自相矛盾

§6.5 同时规定：

1. 再次耗尽后可以再次人工恢复；
2. `finalize-retry` 不同键在终态同结论返回 `duplicate:true`。

第二条会让新的恢复请求在 `terminal_failed/LOCAL_FINALIZE_EXHAUSTED` 状态直接零写返回，无法把 job 重新置为 `retryable_failed/finalize`，从而破坏第一条承诺。

返工必须冻结：

- 每一轮恢复以当前 `expectedRevision` 为新 generation；不同键且 revision 等于当前终态时允许开始新一轮；
- 仅同 operation key 同摘要重放，或不同键针对**已经被前一轮消费的旧 revision**，才返回重放/冲突；
- `requestDigest` 精确为稳定 `{jobId,expectedRevision}`；
- operation key result 的精确白名单、200/202/terminal 投影与损坏记录处理；
- 并发两次恢复、确认丢失、再次耗尽后的新 generation 测试。

## P0-2：previous evidence 只声明 ref，未冻结内容与摘要复核

§5.4 要求 previous evidence ref 等于 head.lastEvidenceId，但未要求事务内验证 previous record 的精确 schema、orgId/jobId、sequence、ID、previous 指针、K3 realm/version/fingerprint 与 HMAC digest。损坏或跨 job 的旧记录仍可能成为新链的合法父节点。

返工必须明确：追加证据前，事务内对 previous evidence 运行正式 validator，并验证：

- `orgId/jobId/sequence/_id` 与 head 完全一致；
- `sequence === head.lastSequence`；
- K3 realm/version/fingerprint 与已冻结 domain 记录一致；
- 使用对应 K3 配置重算 digest 并常量时间比较；
- 任一异常统一 `EVIDENCE_CHAIN_BROKEN/409`，整事务零写。

第一条 evidence 必须同时满足 head=0/null 且新 evidence sequence=1。旧链缺 head 的失败关闭保持不变。

## P1 文档一致性

1. §5.5 的查询边界、敏感拒绝、不可变性三行重复；§6 标题重复，应清理。
2. §6.5 写“snapshot/guard 通过 §6.1”，但 §6.1 只复核 job/grant，且 finalize-retry refs 不含 slot/claim/device/guard。应明确选择：仅复核 job/grant 后由 H4-b finalize 完整复核，或把这些 refs 加入恢复事务；不得保留矛盾描述。
3. 为 finalize-retry 补精确 refs/writes 数量、K2 result schema 和 RC 用例映射。

## Q1–Q9 裁定

| 问题 | 裁定 |
| --- | --- |
| Q1 K3 配置与 domain | 批准推荐方案 |
| Q2 confirmed_present 重新派发 | 批准 H4-c 不重新派发；未来另卡 |
| Q3 still_unknown 阈值 | 批准 60 秒、最多 8 次 |
| Q4 evidence/head 集合 | 批准两个组织域集合及 CAS |
| Q5 两段式与指针投影 | 批准 R1/R2 与稳定指针 |
| Q6 finalizeAttempts | 批准从 1 起算 |
| Q7 老任务/旧证据 | 批准失败关闭，不自动迁移 |
| Q8 finalize-retry | **概念批准，须关闭 P0-1 后才能编码** |
| Q9 K3 集合属性 | 批准 K3 domain 全局、evidence/head 组织域 |

## 边界

下一提交仍只能修改设计文档。完成上述两项 P0 与文档清理前，不发 H4-c 编码卡，不注册 HTTP，不连接 Provider 或设备。
