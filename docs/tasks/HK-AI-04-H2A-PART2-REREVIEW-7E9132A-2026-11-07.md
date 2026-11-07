# HK-AI-04 H2-a 第二部分复审（`7e9132a`）

日期：2026-11-07  
结论：**暂不通过；剩余两项定点返工。H2-b 继续关闭。**

## 独立验证

- 服务层与集合：28/28 通过；
- `admin-web`：291/291 通过；
- 根测试：51/51 通过。

domain 损坏与同版本换钥已经通过真实 `createGrant` 路径验证失败关闭。统一 replay helper 也补齐了 org、域、版本、时间戳和摘要校验，但仍有以下缺口。

## 阻断项

### P0：`result` 并未按声明验证为“非空对象”

当前判断为：

```js
existing.result && typeof existing.result === "object"
```

因此 `{}`、`[]` 以及与路由不匹配的对象都能通过。`review` / `createGrant` 随后会把该伪造结果作为成功重放返回。

需按 route 校验最小结果结构：

- `face.submit`：非数组普通对象，`credentialId` 与确定的 credential ID 一致，`reviewState === "submitted"`；
- `face.review`：非数组普通对象，`credentialId` 与请求一致，`reviewState` 为本次 decision 对应状态；
- `face.grant`：非数组普通对象，`grantId`、`jobId` 为有界 ID，`evidenceScope === "simulated"`，并与本次确定性 ID 一致。

建议把 route 期望结果传入统一 replay helper；不满足时返回 `409 CONFLICT`，业务集合零变化。

### P1：“缺 result/createdAt”测试没有命中目标条件

新测试写入了 `createdAt: 1`，并把 `requestDigest` 写成固定的 `"x"`。调用时会先因摘要不一致失败，即使删除 `result` 校验，测试仍会通过。因此它无法证明缺失 `result` 或 `createdAt` 被拒绝。

测试必须使用与请求完全一致的真实 `requestDigest`，分别覆盖：

1. 缺失 `result`；
2. `result={}`；
3. `result=[]`；
4. result 字段或确定性 ID 与路由不匹配；
5. 缺失、负数或非安全整数 `createdAt`。

每项均断言 `409 CONFLICT` 且相关业务集合零变化。

### P1：文件头仍未更新

提交中的 `service.mjs` 文件头仍写着“H1 阶段、createGrant 阶段关闭、H2 未实现”，与提交说明和实际代码不符。需按当前 H2-a 状态修正。

## 允许的下一提交

仅修改 result 的路由级重放校验、上述定点测试和文件头注释。不得进入 H2-b/H2-c/H2-d、H3、H4、HTTP、Provider 或设备写调用。
