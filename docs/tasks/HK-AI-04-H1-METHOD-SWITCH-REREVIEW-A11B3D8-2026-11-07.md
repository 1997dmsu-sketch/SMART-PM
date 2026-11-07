# HK-AI-04 H1 方法切换复审：`a11b3d8`（2026-11-07）

结论：**核心 P0 已关闭，但 H1 暂不终审通过；补一笔小范围返工后复审。H2 继续关闭。**

## 已关闭

- 旧的写库并调用 Provider 的 `revoke()` 已删除，只剩阶段关闭实现；
- `#runJob()`、`#closeJob()`、`classifyProviderError`、`GRANT_STATE`、`JOB_STATE` 已删除；
- 审核成功用例恢复 `expectedRevision: 1`；
- 跨组织任务查询同态 404 用例已恢复；
- createGrant/revoke 使用计数抛错 Provider，直接证明调用次数为 0；
- 定向服务层测试 7/7、后台全量 287/287 独立复跑通过。

## 剩余返工

### P1：补回 stale revision 冲突回归

上一轮返工单要求“恢复 `expectedRevision: 1`，并保留 stale revision 冲突测试”。当前只覆盖成功版本，没有用错误/过期 revision 断言 `REVISION_CONFLICT` 且 credential、operation key 不变。

新增一个独立用例：

1. 创建 submitted credential；
2. 使用 stale `expectedRevision` 审核；
3. 断言 `409 REVISION_CONFLICT`；
4. 断言 reviewState/revision 未变，operation key 未新增。

### P1：清理剩余无引用 import，并修正文档头

`service.mjs` 仍导入但未使用：

- `PURPOSES`；
- `deviceClaimKey`；
- `grantSlotKey`。

文件头仍描述 grant 会创建 claims、revoke 会立即失效、Provider 会在事务外调用；这些行为当前均处于关闭状态。删除无引用 import，并将文件头改为 H1 当前真实边界，避免把未开放的 H2/H3/H4 行为写成已实现。

## 测试抖动裁定

首次全量 285/287、复跑 287/287 的并发/解码时序抖动不归因于本提交，不阻断本次 P0 关闭。单独登记为测试稳定性工作，最迟在 H2 终审前关闭；不得与本次小返工混在同一提交。

## 下一提交范围

只允许：修正文档头、删除三个无用 import、新增 stale revision 零写入测试。不得进入 H2，不得修改 HTTP/server，不得连接 Provider 或设备。
