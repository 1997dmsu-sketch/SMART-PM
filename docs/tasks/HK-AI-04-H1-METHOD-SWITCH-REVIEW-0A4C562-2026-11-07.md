# HK-AI-04 H1 方法切换复审：`0a4c562`（2026-11-07）

结论：**不通过，H1 暂不关闭；H2 继续关闭。**

## 阻断项

### P0：旧撤权与 Provider 执行链仍保留在生产类中

`FaceCredentialService` 同时存在两个同名 `revoke()`：

- 前一个方法仍会写 grant/job/operation key，并调用 `#runJob()`；
- 后一个方法才返回 `STAGE_CLOSED`；
- `#runJob()`、`#closeJob()` 以及 Provider 调用链也仍保留。

JavaScript 当前由后一个同名方法覆盖前一个，因此测试能通过，但阶段关闭依赖方法覆盖顺序，而不是生产代码中不存在该执行路径。后续移动或删除第二个方法会静默恢复旧写入及 Provider 调用，不能接受。

返工要求：

1. 删除旧 `revoke()`、`#runJob()`、`#closeJob()`；
2. 删除仅由这些死代码使用的 imports/constants；
3. 保留唯一的阶段关闭 `revoke()`；
4. 更新文件头注释，使其准确说明 createGrant/revoke/Provider 均关闭。

### P1：测试削弱既有审核并发契约

审核测试从 `expectedRevision: 1` 改为不传版本。冻结契约要求审核使用期望 revision，H1 方法切换不应削弱该证明。

返工要求：恢复 `expectedRevision: 1`，并保留 stale revision 冲突测试；本轮不借机扩大审核实现范围。

### P1：删除了与 H1 无关的查询隔离回归

原有“跨组织任务查询同态 404”测试被删除，但 `queryJob()` 仍是开放方法。该测试与 grant/revoke 阶段关闭无关，必须恢复。

### P1：零 Provider 仅由代码阅读推断

现有阶段关闭测试只统计集合数量，没有注入计数或抛错 Provider。返工后为 createGrant/revoke 注入 spy Provider，并断言调用次数始终为 0。

## 已确认通过的部分

- `submit` 只接受最小入参；credential 不再保存设备、授权、周期和有效期字段；
- submit 文件 revision 与成员权限在事务内重新校验；
- createGrant 当前运行时返回 `STAGE_CLOSED`，集合计数不变；
- revoke 当前运行时返回 `STAGE_CLOSED`，集合计数不变；
- 权限分离测试成立；
- 后台全量测试 286/286 通过，定向服务层测试 6/6 通过。

## 下一提交范围

只允许清理上述死代码并恢复/补充测试。不得进入 H2，不得注册 HTTP，不得修改 `server.mjs`，不得连接真实 Provider 或设备。

复审入口：提交新的单一返工 commit，并报告定向、后台全量与根测试结果。
