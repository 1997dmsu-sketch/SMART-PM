# H2-a 稳定性集成复审通过（`9852c7f`）

日期：2026-11-07  
结论：**任务 B 通过并关闭。**

## 基线与差异

- 分支：`integration/hk-face-h2a-stable`；
- 父提交：`f9a2b6b`；
- 集成提交：`9852c7f`；
- 最终差异仅 `face-biometric.test.mjs` 一行：`timeoutMs: 1` 改为 `0`。

底层 sharp job 在 deadline race 前已经创建；零毫秒截止确定性触发超时后，测试继续轮询并验证底层任务 settle 才释放槽位。未修改生产代码、3 秒恢复上限、并发数量或断言。

## 独立验证

- `face-biometric.test.mjs` 连续 20 次：20/20 通过；
- HTTP 未知 purpose 预拒绝与并发/恢复：2/2 通过；
- Admin：291/291 通过；
- 根测试：51/51 通过。

## 边界

`9852c7f` 可作为 H2-a 稳定集成基线。H2-b 仍需设计修订通过后另行放行；H2-c/H2-d/H3/H4、HTTP、Provider 和设备写操作继续关闭。
