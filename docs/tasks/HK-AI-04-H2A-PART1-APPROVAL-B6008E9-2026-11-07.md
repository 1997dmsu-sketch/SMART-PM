# HK-AI-04 H2-a 第一部分终审：`b6008e9`（2026-11-07）

结论：**通过。放行 H2-a 第二部分；H2-b 继续关闭。**

独立验证：

- 集合定向：18/18；
- 后台全量：286/286；
- 根测试：51/51。

已确认：

- `operation_key_domains` 完成 Store 全局集合登记；
- K2 key/version/realm 严格配置校验，错误为 `503 NOT_CONFIGURED`；
- operation digest 与 key fingerprint 使用结构化 HMAC 用途域；
- head/version 正式 validator 与 `validateRecord()` 分发生效；
- 首次初始化、配置 mismatch、存储 incomplete 的状态机顺序正确；
- realm 不做 trim，版本/fingerprint/时间戳均严格失败关闭；
- head/version 内部 realm/version/fingerprint 矛盾均为 `DOMAIN_INCOMPLETE`；
- 完整记录与当前配置不同为 `DOMAIN_MISMATCH`；
- now/createdAt/enabledAt 要求非负安全整数。

## 第二部分放行范围

仅允许：

1. submit/review/createGrant 的事务 refs 同时包含稳定 head 与当前 version record；
2. 三条路径在事务内调用 `applyOperationKeyDomain()`，把首次 domain writes 与业务记录、operation key 原子提交；
3. operation key 统一保存 `orgId/realm/keyVersion/requestDigest/result/createdAt`；
4. 重放严格校验 realm、keyVersion、requestDigest，缺字段或损坏失败关闭；
5. 测试三条路径首次共建/后续复用同一 domain、同版本换钥/换版本/损坏 domain 零业务写入；
6. 断言 operation key 记录与固定 ID 均不含原始 idempotency key。

不得开始 H2-b；不得修改 device claim、完整资格、租约、HTTP/server、Provider 或设备写调用。
