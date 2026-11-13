# H4-0A 重放契约返工通过（ff3c492）

- 基线：H4-0B `b2b5a11`
- 返工：`e18cf6c`、`ff3c492`
- 结论：**通过，替代原 H4-0A 对“audit 已存在即回调前拒绝”的语义。**

冻结语义：确定性 audit 已存在时仍执行事务 callback；callback 返回合法空数组则作为零写重放成功且 audit 不变，返回任何业务写则 409 并回滚。audit 缺失时即使业务写集为空也首次创建 audit。Local/Cloud 均拒绝非数组写集。

自报验证：定向 12/12、Admin 504/504、根测试 51/51；Codex 已核对 Store 差异与 `git diff --check`。

H4-a 新基线为 `ff3c492`。
