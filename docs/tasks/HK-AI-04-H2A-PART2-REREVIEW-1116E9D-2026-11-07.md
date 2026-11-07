# HK-AI-04 H2-a 第二部分复审（`1116e9d`）

日期：2026-11-07  
结论：**生产实现方向通过，测试交付未进入提交；H2-a 暂不关闭。**

## 独立验证

- 服务层与集合：28/28 通过；
- `admin-web`：291/291 通过；
- 根测试：51/51 通过。

## 已确认

- 统一 replay helper 会失败即抛出 `409 CONFLICT`；
- `submit`、`review`、`createGrant` 均构造确定性 expected result，并按稳定序列化精确比较；
- result 必须为非数组对象；
- 文件头已更新到 H2-a 状态；
- domain 损坏与同版本换钥改用独立设备，避免已有 claim 污染。

## 唯一阻断：提交没有包含说明中的严格重放测试

`1116e9d` 的测试差异只增加了三个独立设备，并把 domain/换钥场景切换到独立设备。仓库中的“损坏 operation key”测试仍是旧实现：

```js
data: {
  orgId,
  realm: config.realm,
  keyVersion: config.version,
  requestDigest: "x",
  createdAt: 1,
}
```

该测试没有先执行成功授权、没有损坏真实 operation key，且会因 `requestDigest: "x"` 提前触发冲突。提交中不存在所声明的以下覆盖：

- `result=null`；
- `result={}`；
- `result=[]`；
- 错误 `grantId`；
- 错误 `jobId`；
- 错误 `evidenceScope`；
- `createdAt=-1`；
- 非安全整数 `createdAt`；
- 真实记录 `_id` 与 expected op key 的硬断言。

## 最小补交要求

下一提交只补测试，不再改生产语义：

1. 使用 `device-replay` 正常创建一次授权；
2. 定位这次操作写入的真实 operation key；
3. 每个损坏场景使用隔离 fixture 或恢复完整原记录；
4. 使用相同 actor/input/idempotencyKey 重放；
5. 每项断言 `409 CONFLICT`、Provider 零调用及所有业务集合零变化；
6. 删除或重写旧的 `requestDigest: "x"` 测试。

允许顺手删除三处 `if (!this.#replayValid(...))` 的冗余外层判断，直接调用 helper；这不是放行其他生产改动。

H2-b/H2-c/H2-d、H3、H4、HTTP、Provider 和设备写操作继续关闭。
