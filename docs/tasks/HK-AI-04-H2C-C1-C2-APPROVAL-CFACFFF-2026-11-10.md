# HK-AI-04 H2-c C1/C2 终审（`cfacfff`）

结论：**通过；C1、C2 正式关闭。C3 可另发编码卡，尚未开始。**

复审对象：

- 分支：`feat/hk-face-service-h2c-eligibility`
- 提交：`cfacfff`
- 基线：H2-b `2bc10e3`
- 累计范围：`0565ff3`、`3461726`、`ac9585f`、`e4508ea`、`cfacfff`

## 独立验证

- C1/C2 定向测试：27/27（C1 17、C2 10）；
- Admin：341/341；
- 根测试：51/51；
- `e4508ea..cfacfff`：仅修改资格 helper 与定向测试，`git diff --check` 通过。

## 关闭项

1. primary occupancy 在计划阶段必须绑定 `cycle.primaryOccupancyId`；
2. 事务内 `cycle.primaryOccupancyId` 预读后变化返回 `REVISION_CONFLICT/409`，并有只读零变化证据；
3. 非 null lifecycle guard 预读基线必须绑定当前组织固定 guard ID；
4. 事务内当前 guard 的 `_id/orgId/epoch/revision` 均须与当前组织和预读基线一致；
5. sponsor 清空、改写与目标 revision 变化均失败关闭；
6. member/primary/sponsor/lifecycle/catalog 预读基线均为强制项；
7. `prepareAttempt` 每次 attempt 重新规划 refs，非法 refs 在事务前以 503 失败关闭；
8. refs 合并去重后 90 条可执行、91 条在事务前拒绝；
9. 不传 hook 时原 blacklist guard、decision 与 `deferBlocked` 行为保持不变。

## C3 放行边界

C3 可以单独发卡，范围仅为把已批准的 C1/C2 契约接入 `createGrant()`：

- 每次 attempt 预读并规划完整资格 refs；
- 事务内按冻结顺序执行权限/operation 状态、完整资格、真实黑名单、H2-b 设备与 claim/slot 复核、核心写集；
- C3 必须在构造 helper 请求前识别业务记录与 credential/输入错配，按冻结矩阵返回 `REVISION_CONFLICT/409` 或对应同态错误，不得把业务错配暴露为 helper 的 `PARAM_ERROR/400`；
- 保持 Provider 调用为 0，不注册 HTTP，不连接设备；
- H2-d/H3/H4 继续关闭。

本终审不等于 C3 已开始，也不批准 HTTP、Provider 或设备写操作。
