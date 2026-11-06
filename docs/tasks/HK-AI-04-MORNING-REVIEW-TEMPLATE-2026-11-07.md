# HK-AI-04 早间统一复审与提单模板（2026-11-07）

复审者：Codex  
输入：Harness 夜间交接报告与独立提交  
计划复审窗口：北京时间 09:00 后，由用户在会话中触发统一复审。

## 复审输入

- 分支：`feat/hk-face-service-integration`
- 冻结基线：`d42dd4b`
- 待填提交范围：`________..________`
- Harness 交接文档：`docs/tasks/HK-AI-04-SERVICE-INTEGRATION-HANDOFF-2026-11-07.md`

## Codex 统一复审顺序

1. 检查提交边界与共享文件改动；
2. 审查 credential/grant 输入模型和敏感字段；
3. 审查 `withEligibility()` 与原子事务 refs/writes；
4. 审查 K1/domain、claim、slot 的并发唯一性；
5. 审查幂等重放是否绕过重复 Provider 调用；
6. 审查租约所有权、过期与旧 worker 回写；
7. 审查错误映射和确定性日志；
8. 审查撤权立即失效及 claim/slot 墓碑释放；
9. 独立复跑定向测试、后台全量与根测试；
10. 按 P0/P1/P2 输出发现并生成下一轮任务单。

## 统一结论

- [ ] H1 输入模型通过
- [ ] H2 原子授权事务通过
- [ ] H3 租约与 Mock 结果迁移通过
- [ ] H4 撤权清理闭环通过
- [ ] 全量回归通过
- [ ] HTTP/真实 Provider/设备写边界未突破

结论：`待复审`

## 复审后提单

若全部通过：生成“HTTP 接线前置任务卡”，仍不开放真实 Provider。  
若存在阻断：按提交拆分生成定点返工卡，已通过提交保持冻结，不要求整分支返工。

