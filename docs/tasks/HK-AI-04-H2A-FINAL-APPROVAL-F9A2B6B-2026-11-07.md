# HK-AI-04 H2-a 终审通过（`f9a2b6b`）

日期：2026-11-07  
结论：**H2-a 正式通过并关闭。**

## 独立验证

- 服务层与集合：28/28 通过；
- `admin-web`：291/291 通过；
- 根测试：51/51 通过。

## 通过范围

H2-a 已完成并验证：

1. 独立 K2 配置、结构化 HMAC 和幂等键格式；
2. 全局 `operation_key_domains` 稳定 head、版本历史、不可逆 fingerprint 与失败关闭；
3. `submit`、`review`、`createGrant` 在业务事务内接入 domain guard；
4. operation key 保存 org、realm、keyVersion、requestDigest、result、createdAt，不保存原始幂等键；
5. 重放严格校验作用域、摘要、时间戳及三条路由的确定性结果；
6. 损坏 result、错误 ID、错误 evidenceScope、异常 createdAt 均返回 `409 CONFLICT`；
7. 每个损坏场景先恢复真实基线，Provider 零调用，grant/job/slot/claim/log 内容级零变化；
8. domain 损坏、同版本换钥和 K2 缺失均失败关闭。

## 下一阶段边界

- H2-b 生产编码尚未放行；先提交并复审 `HK-AI-04-H2B-DEVICE-CLAIM-DESIGN.md`；
- H2-b 仅处理设备级 `ownerOrgId` claim 模型、事务内设备快照与 slot 边界；
- H2-c/H2-d、H3、H4、HTTP 注册、真实/Mock Provider 派发及设备写操作继续关闭；
- `f9a2b6b` 作为 H2-a 已批准基线，后续不得改写历史。
