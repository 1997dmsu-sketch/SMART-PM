# HK-AI-04 H2-c C1/C2 复审（`ac9585f`）

结论：**C2 通过；C1 暂不通过；C3 继续关闭。**

复审对象：

- 分支：`feat/hk-face-service-h2c-eligibility`
- 提交：`ac9585f`
- 基线：H2-b `2bc10e3`

独立复跑：

- C1/C2 定向测试：23/23；
- Admin：337/337；
- 根测试：51/51。

上一轮 sponsor 绕过、强制预读基线、hook refs 元素校验、每次 attempt 刷新 refs 以及 90/91 边界均已关闭。测试全绿，但 C1 仍有以下两项失败关闭缺口。

## P0：primary occupancy 未绑定 cycle.primaryOccupancyId

`validateEligibility()` 对 primary 只验证 room slot 指向目标 occupancy；周期检查只要求事务内 `cycle.primaryOccupancyId` 与预读值相同。它没有要求：

```text
occupancy.role == primary
⇒ cycle.primaryOccupancyId == occupancy._id
```

因此，若预读与事务内都保持同一个错误的 `cycle.primaryOccupancyId`，但 room slot 指向目标 primary occupancy，当前校验仍可能通过。这与既有入住激活语义不一致，也允许非周期主入住取得 primary 授权。

修复要求：

1. 计划阶段：primary 的 `expected.cycle.primaryOccupancyId` 必须等于 `expected.occupancy._id`，否则 `PARAM_ERROR/400`；
2. 事务阶段：primary 的当前 `cycle.primaryOccupancyId` 必须等于当前 `occupancy._id`；预读后变化返回 `REVISION_CONFLICT/409`；
3. 测试覆盖预读错误绑定、事务内变化及精确匹配成功，并断言失败时只读零变化。

## P0：lifecycle guard 基线未绑定固定 ID 与组织

`assertGrantRequest()` 对非 null guard 只检查 `epoch/revision`，没有要求 `_id` 为当前组织固定 guard ID，也没有要求 `orgId` 等于 `request.orgId`。错误组织或错误 ID 的记录只要版本值相同，就可被当作预读基线；事务内又读取当前组织的真实 guard，形成跨记录比较。

修复要求：

1. 非 null guard 必须满足 `_id === guardId(request.orgId)`；
2. 必须满足 `orgId === request.orgId`；
3. 增加错误 `_id`、跨组织 guard、合法 guard 三项定向测试；前两项在计划阶段以 `PARAM_ERROR/400` 失败关闭。

## C2 结论

C2 的 `prepareAttempt` 契约本轮可关闭：

- hook refs 每项均受控校验，非法输入在事务前返回 `ADAPTER_UNAVAILABLE/503`；
- 每次 attempt 重新准备 refs，未沿用旧 state；
- 合并去重后 90 条可执行、91 条在事务前失败；
- 不传 hook 的原有 guard、decision 与 `deferBlocked` 行为保持不变。

后续返工不得再扩大或改写 C2。

## C3 错误语义裁定

确认以下边界：

- helper 收到内部不自洽的预读请求或漏基线，返回 `PARAM_ERROR/400`；
- C3 必须在构造 helper 请求前识别真实业务记录与 credential/输入的错配，并按冻结矩阵映射为 `REVISION_CONFLICT/409` 或对应同态错误；
- 不得把 D21、D23 等业务数据错配直接暴露为 helper 的 400。

## 下一提交边界

下一提交只允许修改 C1 helper 与定向测试，关闭上述两项 P0。不得修改 `createGrant()`，不得进入 C3，不得注册 HTTP、调用 Provider、连接设备或进入 H2-d/H3/H4。
