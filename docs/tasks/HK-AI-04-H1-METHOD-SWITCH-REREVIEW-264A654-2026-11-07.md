# HK-AI-04 H1 方法切换复审：`264a654`（2026-11-07）

结论：**未通过，仅剩两项提交内容与说明不一致；H2 继续关闭。**

## 已确认

- `PURPOSES`、`deviceClaimKey`、`grantSlotKey` 三个无引用 import 已删除；
- stale revision 请求返回 `409 REVISION_CONFLICT`；
- 服务层 8/8、后台 288/288、根测试 51/51 独立复跑通过；
- 未进入 H2/H3/H4，未修改 HTTP/server，未调用 Provider 或设备。

## 剩余两项

### 1. 文件头实际未修改

提交说明称文件头已改成 H1 实际状态，但 `service.mjs` 当前仍写着：

- grant 通过资格后创建 grant/job/claims；
- revoke 立即 revoked 并创建清理任务；
- Provider 在事务外调用。

这些行为目前均未实现且被 `STAGE_CLOSED` 阻断。请实际修改文件头，明确：submit/review/reviewQueue/queryJob 已实现；createGrant/revoke 关闭；H2/H3/H4 未实现；本服务当前不调用 Provider。

### 2. stale 测试没有证明 credential 内容不变

测试只比较 `counts()`，credential 数量相同不能证明 `reviewState` 与 `revision` 没有被修改。请在失败前保存目标 credential 的最小快照，失败后按 `_id` 重新读取并断言：

- `reviewState === "submitted"`；
- `revision === 1`；
- 或直接深比较失败前后的目标 credential。

同时保留 operation key 数量不变断言。

## 下一提交

只改文件头与 stale 测试断言，不改生产行为。通过后直接关闭 H1 并放行 H2 原子授权事务。
