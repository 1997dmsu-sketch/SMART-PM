# HK-AI-04 H2-c C1 复审（`e4508ea`）

结论：**暂不通过；C2 保持通过；C3 继续关闭。**

复审对象：

- 分支：`feat/hk-face-service-h2c-eligibility`
- 提交：`e4508ea`
- 基线：`2bc10e3`，包含已复审的 `ac9585f`

独立复跑：

- C1/C2 定向测试：25/25（C1 15、C2 10）；
- Admin：339/339；
- 根测试：51/51。

计划阶段的 primary 周期绑定，以及非 null lifecycle guard 预读基线的固定 ID/组织绑定已经实现。测试全绿，但事务阶段仍有一项失败关闭缺口，另缺一项必要竞态证据。

## P0：事务内 lifecycle guard 记录身份未复核

当前计划阶段已要求：

```text
expected.lifecycleGuard._id == guardId(request.orgId)
expected.lifecycleGuard.orgId == request.orgId
```

但事务阶段只比较当前 guard 的 `epoch/revision`。若 `lifecycle_guards/<正确 ref>` 下的记录内容损坏，其 `_id` 或 `orgId` 已变成其他值，而 epoch/revision 恰好与预读基线相同，当前实现仍会判定通过。

修复要求：

1. 非 null 基线时，事务内当前 guard 也必须满足 `_id === guardId(request.orgId)`；
2. 当前 guard 必须满足 `orgId === request.orgId`；
3. 任一身份字段变化或损坏返回 `REVISION_CONFLICT/409`；
4. 增加当前 guard 错误 ID、跨组织和合法稳定记录三项测试，并断言校验只读、状态内容不变。

## P1：缺少 primaryOccupancyId 事务竞态测试

生产代码已增加事务内：

```text
occupancy.role == primary
&& cycle.primaryOccupancyId != occupancy._id
→ REVISION_CONFLICT/409
```

但新增测试只覆盖计划阶段错误绑定，没有证明预读后 `cycle.primaryOccupancyId` 变化会命中该分支。

补测要求：

1. 从合法 primary 基线开始，仅在事务 state 中把 `cycle.primaryOccupancyId` 改为其他 occupancy；
2. 断言 `REVISION_CONFLICT/409`；
3. 深比较校验前后 state，证明零写入；
4. 保留合法精确匹配成功的正例。

## 下一提交边界

下一提交只允许修改 C1 helper 与定向测试，关闭上述 P0/P1。不得修改 C2、`createGrant()`，不得进入 C3，不得注册 HTTP、调用 Provider、连接设备或进入 H2-d/H3/H4。
