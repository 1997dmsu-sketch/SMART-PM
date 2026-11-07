# HK-AI-04 H2-a 第二部分复审（`3d1f03e`）

日期：2026-11-07  
结论：**暂不通过；H2-a 第二部分未关闭，H2-b 继续关闭。**

## 独立验证

- `admin-web`：288/288 通过；
- 根测试：51/51 通过；
- `face-service-layer` + `face-collections`：25/25 通过。

三条路径已经把 operation domain refs、guard writes、业务 writes 与 operation key 放入同一事务；K2 缺失也会以 `503 NOT_CONFIGURED` 失败关闭。当前阻断集中在损坏幂等记录的失败关闭和业务层回归证据。

## 阻断项

### P0：损坏的 operation key 可被当作成功重放

`submit`、`review`、`createGrant` 的重放分支只比较 `realm`、`keyVersion`、`requestDigest`。它们没有验证 `orgId`、非负安全整数 `createdAt` 及与操作类型匹配的 `result`。

当一条记录保留前三个字段但缺少或伪造 `result` 时：

- `review` 与 `createGrant` 会返回 `undefined`；
- `submit` 会忽略记录中的结果并返回固定成功结果；
- 损坏记录没有失败关闭，也没有正式 schema validator 阻止其写入或读取。

需增加统一的 operation key 记录 validator/replay helper，至少校验：`orgId`、`realm`、`keyVersion`、`requestDigest`、`result`、`createdAt`，并针对 route 校验最小 result 结构。任一缺失、类型错误或作用域不符均须冲突或存储损坏错误，且业务集合零变化。

### P1：第二部分缺少业务路径级失败关闭测试

现有新增测试只直接覆盖共享 domain、记录元数据和 K2 缺失。第一部分的 helper 测试不能证明三条业务路径在以下情况下均原子失败：

1. 同版本更换 K2；
2. domain 只有 head 或只有 version；
3. domain 的 kind、realm、version 或 fingerprint 损坏；
4. operation key 缺少上述元数据或 result；
5. 失败后三条路径对应的 credential/grant/job/claim/slot/log/op key 均无变化。

至少为 `submit`、`review`、`createGrant` 各覆盖一次失败路径，并覆盖三类共同根因，不能只断言 helper 抛错。

### P1：服务文件头状态已失真

`service.mjs` 文件头仍写着“H1 阶段、createGrant 阶段关闭、H2 未实现”，而同文件已经实现 H2 createGrant。应随返工同步为当前 H2-a/H2 状态，防止后续开发按错误边界操作。

## 返工边界

下一提交只允许：

1. operation key 记录校验与统一 replay helper；
2. 三条路径改用该 helper；
3. 上述失败关闭测试；
4. 修正文档头注释。

不得进入 H2-b、H2-c、H2-d、H3、H4，不得注册 HTTP、调用 Provider 或执行设备写操作。
