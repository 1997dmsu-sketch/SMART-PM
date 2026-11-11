# HK-AI-04 H2-c C4 终审（`feaa1e0`）

日期：2026-11-11

结论：**通过；C4 与 H2-c 正式关闭，允许进入 H2-d。**

复审对象：

- 分支：`feat/hk-face-service-h2c-c4-d-matrix`
- 提交：`feaa1e04e6ca5d64e4028301fb02a9b6b5227e68`
- 基线：`32c891f`（C3 终审通过）
- 生产修复：`34580ab`（仅 D75 适配器契约失败关闭）

## 独立验证

- C4 D01–D75：72/72；
- C1/C2/C3、H2-b、Store 点查与 C4 组合：151/151；
- Admin 全量：441/441；
- 根测试：51/51；
- `git diff --check` 通过；
- 无跳过、独占或 TODO 测试；
- Provider/HTTP/设备：0／未注册／未连接。

## 通过依据

1. D01–D75 使用真实 `BlacklistService`、完整独立 fixture、内容级快照与受控竞态注入；
2. 人员、账号、实名、入住、周期、房间与三级目录、primary/slot/sponsor、lifecycle guard 的缺失、跨组织、状态、时间与 revision 变化均有失败关闭证据；
3. 黑名单 deny、review-required、一次重试、三次耗尽、guard/candidate 竞态及真实评价顺序均已覆盖；
4. 权限、operation、credential/file、完整资格、名单与 H2-b 的错误优先级保持 C3 冻结顺序；
5. 合法重放返回原结果且核心写集不变；同键异摘要与损坏记录失败关闭；资格失效后不能借重放绕过当前资格；
6. K1 domain、owner claim、slot、设备快照和双请求竞争保持 H2-b 语义；
7. D75 对丢失准备上下文、跨 attempt 旧 token 与同 attempt callback 重跑给出确定性证据；
8. `service.mjs` 的 D75 定点修复把无效适配器上下文映射为 `ADAPTER_UNAVAILABLE/503`，并以 token 对象身份绑定同一次 attempt；未改变正常 C1/C2/C3 判决或核心写集；
9. 成功路径仍只产生 pending grant、queued job、slot、首条 log 与 operation key；Provider 调用为 0。

## 容量裁定

C4 实测最大布局为 `32 + N`。Q02 冻结规则要求非空 sponsor 等于 primary，refs 按 `collection/id` 去重后两者为同一条，因此：

- 58 个候选时为 90 refs，可进入单事务；
- 59 个候选时为 91 refs，在事务前以 400 失败关闭。

该结果是冻结去重规则的直接结果，替代早期设计文档中未计入 primary/sponsor 同 ID 去重的 `33 + N` 估算，不构成资格弱化、拆事务或丢弃 refs。

## 后续边界

H2-c 已关闭，不再扩大 C1–C4。下一步只允许按独立任务卡执行 H2-d 全链回归、并发稳定性与 H2 总体验收。

H3 租约与派发、H4 撤权闭环、HTTP 注册、Mock/真实 Provider 调用、设备写、main 合并和生产云操作继续关闭，须在 H2-d 终审后另行发卡。
