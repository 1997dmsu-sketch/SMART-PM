# HK-AI-04 H1 helper 层复审通过：`51f3fa1`（2026-11-07）

结论：**通过。仅放行 H1 submit/createGrant 方法切换；H2 仍关闭。**

已确认：

- `assertBoundedId` 拒绝空白、超长与控制字符；
- `assertSafeInt` 使用安全整数和明确下界；
- occurrence、now、expiresAt、attempts、revision 均严格失败关闭；
- active/released claim 缺少 grantId、revision 或墓碑审计字段时不可复用；
- `releaseClaim` 要求完整 active 记录、合法 jobId 与时间，并保留 grantId；
- `access_devices` 与其他本期集合已登记 Store；
- 未修改 HTTP、server、真实 Provider 或设备边界。

独立验证：

- H1 定向测试：5/5；
- 人脸解码定向复跑：7/7；
- 后台完整测试：290/290；
- 根测试：51/51。

一次并行运行多组重测试时，解码超时恢复用例因资源竞争失败；停止并行压力后定向与后台全量均通过，不归因于本提交。

下一提交只允许：

1. `submit` 切换到 `assertSubmitInput`，credential 不再写 device/grant/有效期字段；
2. `createGrant` 切换到 `assertCreateGrantInput`，设备、周期和有效期从授权输入取得；
3. 幂等摘要覆盖八项授权输入；
4. 更新直接受影响的服务层测试；
5. 不实现 H2 原子事务，不调用 Provider，不修改 HTTP/server。

