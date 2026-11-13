# HK-AI-04 H4 撤权闭环设计任务

## 指派

- 承接：DeepSeek Harness（设计阶段）
- 基线：H3-b 通过提交 `2b92b30`
- 前置批准：`HK-AI-04-H3B-APPROVAL-2B92B30-2026-11-13.md`
- 交付：一份 H4 设计文档；**本卡不批准生产代码修改。**

## 目标

冻结撤权从“业务立即失效”到“Mock 设备清理确认”的完整状态机、事务边界、幂等、租约、错误映射、墓碑释放与审计证据，为后续 H4 编码卡提供唯一依据。

## 必须覆盖

1. `revoke` 事务内立即将 grant 置 `revoked`，并原子创建清理 job、首条 log 与 operation key；不查资格，不在事务内调用 Provider。
2. 清理 job 的租约、fence、attempt、退避、超时、未知结果与人工对账必须复用 H3 已冻结语义；不得另建旁路 Store。
3. Mock Provider 调用必须在事务外；回调重放、提交确认丢失和迟到结果不得重复撤权或释放资源。
4. 清理成功后：slot 写 released 墓碑（清除 `activeClaimId`，保留审计字段）；仅在确认设备没有其他有效 grant 时释放 owner claim；清除 `cleanupPending`。
5. 可重试失败、未知结果或终态失败：grant 始终保持 `revoked`，`cleanupPending=true`，claim/slot 不释放并持续告警。
6. 定义并发撤权、同键重放、异摘要冲突、撤权与新增授权竞争、多个住户共用设备、重复设备确认的线性化点。
7. 给出所有事务 refs/writes 的最坏数量和 90-ref 上限处理；禁止拆事务规避资格或所有权保护。
8. 定义最小 DTO、错误信封、日志/审计字段白名单与敏感字段禁显；不得保存序列号、IP、MAC、原始幂等键或图片数据。
9. 给出连续编号的测试矩阵，至少覆盖成功、失败、UNKNOWN_RESULT、超时、迟到结果、租约竞争、墓碑冲突、claim 仍被其他 grant 使用、内容级零副作用及 Provider 调用次数。
10. 明确 HTTP、真实 Provider、设备连接、生产云仍关闭；H4 设计不得暗含上线授权。

## 设计问题

- 清理 job 的 action/method 与冻结 Provider 方法如何映射；
- `cleanupPending`、job 与 grant 的精确状态转换；
- owner claim 的“无其他有效 grant”判定集合、refs 和竞态保护；
- slot/claim 墓碑的 revision、时间与审计 ID 来源；
- UNKNOWN_RESULT 后人工对账成功/失败如何落库；
- 老数据缺字段时的失败关闭及是否需要独立迁移任务。

## 验收

- 仅新增/修改 H4 设计文档；
- 所有引用指向当前代码或已批准文档的准确行号/章节；
- `git diff --check` 通过，链接有效，敏感值扫描无命中；
- 提交并推送独立文档分支；
- Codex 通过设计终审前，不得开始 H4 编码。
