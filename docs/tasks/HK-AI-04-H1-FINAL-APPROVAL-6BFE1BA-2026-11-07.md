# HK-AI-04 H1 终审通过：`6bfe1ba`（2026-11-07）

结论：**通过。H1 正式关闭，放行 H2 原子授权事务；H3/H4、HTTP、真实 Provider 与设备写调用继续关闭。**

## 终审确认

- submit 只接收 personId/sourceFileId，credential 不保存设备、授权、周期或有效期字段；
- review 使用 expectedRevision，stale revision 返回 `409 REVISION_CONFLICT`，目标 credential 状态与版本不变，operation key 零新增；
- reviewQueue/queryJob 保持权限与组织隔离；
- createGrant/revoke 在 H1 均返回 `STAGE_CLOSED`，零业务写入、零 Provider 调用；
- 旧 revoke、任务执行与 Provider 死代码已删除；
- 文件头准确说明 H1 已实现与关闭边界；
- 未修改 HTTP/server，未连接设备或生产云。

独立验证：

- 服务层：8/8；
- 后台全量：288/288；
- 根测试：51/51。

## H2 放行范围

下一提交可一次性实现 createGrant 原子事务：

1. 事务内当前成员与 `device.access.manage` 权限复核；
2. `FileService.assertBinding()` 与 approved credential/expected revision 复核；
3. 复用 `BlacklistService.withEligibility()`，资格不通过零写入；
4. 校验 access device 存在、组织归属、active 状态，并只在内存使用序列号计算 K1 claim；
5. `applyDigestDomain()`、device claim、grant slot；
6. `pending` grant、`queued` job（lease 为空、attempts=0、simulated/mock/test）；
7. 首条确定性 operation log；
8. operation key 与覆盖全部授权输入的 request digest；
9. 上述记录与 domain 首次初始化在同一事务完成，任一冲突或资格变化必须零写入；
10. 同键同摘要重放不创建新记录，不调用 Provider；同键不同摘要冲突。

H2 不允许：领取租约、进入 sending、调用 Mock/真实 Provider、实现撤权清理、注册 HTTP 或修改 `server.mjs`。

测试稳定性抖动作为独立工作保留，最迟在 H2 终审前关闭，不与 H2 生产逻辑提交混合。
