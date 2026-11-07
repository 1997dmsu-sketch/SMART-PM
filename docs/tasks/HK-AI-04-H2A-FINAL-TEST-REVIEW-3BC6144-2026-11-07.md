# HK-AI-04 H2-a 最终测试复审（`3bc6144`）

日期：2026-11-07  
结论：**接近通过；剩余一笔纯测试隔离修复，H2-a 暂不关闭。**

## 独立验证

- 服务层与集合：28/28 通过；
- `admin-web`：291/291 通过；
- 根测试：51/51 通过；
- 提交只修改 `face-service-layer.test.mjs`。

真实 operation key、独立 `device-replay`、相同 actor/input/idempotencyKey 和 Provider 零调用均已落实。

## 剩余阻断

### 1. 损坏场景相互叠加，时间戳断言存在假阳性

循环每次只写入当前 patch，却没有先恢复真实基线记录。执行到 `createdAt=-1` 与非安全整数时，上一轮的错误 `evidenceScope:"device_verified"` 仍保留。即使生产代码完全删除 `createdAt` 校验，这两例仍会因为 result 不匹配而通过。

每轮必须先恢复：

```js
data: {
  result: structuredClone(row.result),
  createdAt: row.createdAt,
  ...corruption,
}
```

写入后还要断言非目标字段等于基线，保证每个异常独立命中。

### 2. “业务零变化”只比较数量

`counts()` 无法发现已有 grant/job/claim/slot/log 被原地改写。测试应在循环前保存这些集合的完整快照，并在每次失败后深比较内容。operation key 本身是测试主动损坏对象，可单独比较其 `_id`、数量和预期损坏字段。

## 最小补交

下一提交仍只改测试：恢复每轮基线、增加完整业务集合快照比较。生产代码不再修改。通过后可关闭 H2-a 并放行 H2-b 设计后的编码评审。

H2-b/H2-c/H2-d、H3、H4、HTTP、Provider 和设备写操作继续关闭。
