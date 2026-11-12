# HK-AI-04 H3 租约、Mock 派发与结果迁移契约设计任务卡

**负责人：** DeepSeek Harness

**优先级：** P0

**建议分支：** `docs/hk-face-h3-lease-dispatch-design`

**代码证据基线：** `90cc848`

**交付类型：** 仅 Markdown 设计；不得修改生产代码或测试。

## 1. 目标

基于已经关闭的 H2，冻结 queued job 从领取租约、发送前资格重验、事务外调用 Mock Provider到结果回写的完整契约，为后续 H3 编码卡提供无歧义输入。

本卡不实现 dispatcher，不调用 Provider，不开启 HTTP，不连接设备。

## 2. 必须以现有代码为证据

至少逐段引用并核对：

- `admin-web/lib/face-service/service.mjs` 的 grant/job 创建字段与事务顺序；
- `collections.mjs` 的 `leasePatch()`、确定性 log ID、record validator；
- `dto.mjs` 的 job 状态、Provider context 和 enroll 输入；
- `state.mjs` 的合法迁移与 `deviceEffective` 证据要求；
- `mock-provider.mjs` 的场景、错误分类、幂等作用域与调用记录；
- H2-d 真实链、并发与敏感扫描测试；
- `LOCK-01-HIKVISION-FACE.md`、`HK-AI-04A-REVIEW-2026-11-05.md` 的冻结裁定。

不得仅引用旧计划描述而忽略当前实现。

## 3. 必须回答的架构问题

### Q01：发送前资格重验所需持久字段

列出 dispatcher 重验人员、实名、入住、周期、房间目录、primary/slot/sponsor、lifecycle guard、黑名单、文件、设备与 owner claim 所需的固定引用和 revision/epoch。

当前 grant/job 缺少 `identityApplicationId` 等字段。必须裁定：

- 最小新增字段放在 grant、job 还是独立不可变 dispatch snapshot；
- 哪些字段只保存内部 ID/revision，禁止保存私密材料或摘要；
- H2 已有记录如何失败关闭，是否需要受控迁移；
- createGrant 与 dispatcher 如何共享同一份资格基线而不复制算法。

不得用“按 person 查询任意 approved identity”替代固定引用。

### Q02：租约与 fencing token

冻结：

- 哪些状态允许领取租约；
- `leaseOwner/leaseExpiresAt/attempts/revision` 的校验和更新；
- fencing token 使用 job revision、独立 lease generation 或两者组合；
- 两个 worker 并发时只有一个进入 `sending`；
- 同 owner 重入、租约续期、时钟边界与事务 callback 重跑语义；
- 旧 worker、过期租约、错误 owner 的回写必须零写入并返回固定错误。

租约领取和结果回写必须是独立短事务，Provider 调用不得位于事务内。

### Q03：发送前资格变化

明确领取租约后、Provider 调用前的重验顺序和错误映射：

```text
job/lease fencing
→ grant/credential/file
→ 完整资格与真实黑名单
→ device/K1/owner claim/slot
→ Provider 调用
```

裁定资格无效、权限/成员变化、文件变化、grant 已撤销/过期及 owner claim 变化时 job 的目标状态、日志与是否允许重试。任何失败都不得调用 Provider。

### Q04：Mock Provider 输入与上下文

逐字段冻结 `enrollFace(input, context)`：

- input 的 person/device/grant/sourceFile/有效期从哪些已复核记录取得；
- context 的 system/agent actor、权限集合、组织、executionMode 与幂等键如何生成；
- Provider 幂等键如何绑定平台 job + attempt，worker 重试不能造成不同业务操作；
- 禁止向 Provider 传递图片字节、objectKey、checksum、设备凭据或原始用户幂等键；
- Mock 只能 `executionMode=test/provider=mock/evidenceScope=simulated`。

### Q05：结果状态与 grant 投影

冻结每种结果的 job/grant/log 写入：

| Provider 结果 | job 目标状态 | grant 处理 | 自动再次发送 |
| --- | --- | --- | --- |
| success | `succeeded` | 是否 `pending→effective`，须明确 | 否 |
| RETRYABLE | `retryable_failed` | 不得伪造设备生效 | 仅按冻结重试策略 |
| UNKNOWN_RESULT | `awaiting_result` | 保持业务安全状态并告警 | **永不自动重发** |
| TERMINAL | `terminal_failed` | 不得设备生效 | 否 |
| NOT_CONFIGURED | 失败关闭 | 不得设备生效 | 否 |

Mock success 不得生成 `device_verified` 或受信 `device_ack`；`deviceEffective` 必须保持 false。

### Q06：租约过期与进程崩溃

领取租约后无法证明 Provider 是否被调用时，必须进入 `awaiting_result`，不得重新排队。说明：

- 过期扫描的事务 refs 和 fencing；
- `sending→awaiting_result` 的确定性日志；
- 如何区分明确的 pre-send failure 与无法证明未发送；
- query/reconcile 留给哪个后续阶段，H3 不得暗中自动裁定。

### Q07：重试策略

沿用冻结策略：只有 `retryable_failed` 可重试，最多 3 次，退避 30 秒／2 分钟／10 分钟；人工重试也计数。

设计必须说明 `retryable_failed→queued→sending` 的合法迁移、`nextAttemptAt`、达到上限后的 `terminal_failed` 与告警日志。不得直接实现 `retryable_failed→sending` 绕过状态机。

## 4. 数据与日志约束

设计须给出 job、lease、dispatch snapshot、result 和 operation log 的字段白名单。至少满足：

- revision 与时间均为非负/正安全整数；
- 每次状态迁移追加确定性、不可覆盖的 log；
- log 不含 Provider payload、私密文件位置、人脸数据、凭据、原始响应或完整错误对象；
- 只保存规范化错误类与有界脱敏原因；
- result 回写使用 lease fencing，不能只按 jobId 覆盖；
- operation key、job 与 log 的保留期关系不被破坏。

## 5. 并发与失败矩阵

设计不少于 D01–D45 的测试矩阵，至少覆盖：

1. queued 单 worker 领取；
2. 两 worker 并发只有一个成功；
3. callback 重跑幂等；
4. 非 queued、损坏 job、跨组织、错误 action；
5. lease owner 空白、时间/revision/attempt 非安全整数；
6. 旧 worker、过期租约、错误 generation 回写；
7. Provider 确认未发送的 RETRYABLE；
8. 发送后未知、worker 崩溃、租约过期；
9. success/RETRYABLE/UNKNOWN/TERMINAL/NOT_CONFIGURED；
10. 每次迁移的 log 数量、内容与确定性 ID；
11. createGrant 合法重放不调用 Provider；
12. 同 job 重复 dispatch 不重复 Provider 调用；
13. 发送前 person/identity/occupancy/cycle/catalog/blacklist/file/device/claim/slot 各自变化；
14. grant revoked/expired/suspended；
15. retry 30 秒/2 分钟/10 分钟边界与三次上限；
16. 敏感字段和值扫描；
17. Mock success 后 `deviceEffective=false`；
18. Provider 调用严格发生在事务外。

每行写明：前置状态、竞态注入点、期望错误/状态、Provider 调用次数、写集与内容级零副作用断言。

## 6. 交付文档

新增：

```text
docs/tasks/HK-AI-04-H3-LEASE-DISPATCH-DESIGN.md
```

文档必须包含：

- 当前代码证据与行号；
- Q01–Q07 明确提案；
- 字段白名单和状态迁移表；
- 事务边界时序图；
- D01–D45 或更多测试矩阵；
- 与 H2、H4、HTTP、Provider preflight 的边界；
- 仍需 Codex 裁定的问题，不得自行假定。

## 7. 验收

- 仅新增或修改 Markdown；
- `git diff --check` 通过；
- 相对链接有效；
- 不包含设备序列号、MAC、IP、账号、密码、证书指纹、人脸材料或原始响应；
- 不运行或连接 Provider；
- 不修改 H2、H4、HTTP、UI、server、数据库或生产云；
- 工作区干净，提交并推送独立分支后交 Codex 复审。

## 8. 回报模板

```text
任务：HK-AI-04 H3 租约与 Mock 派发契约设计
分支/提交：
代码证据基线：90cc848
Q01–Q07：
字段/迁移表：
测试矩阵数量：
链接与 diff-check：
生产代码/Provider/HTTP/设备：0 / 0 / 未注册 / 未连接
待 Codex 裁定：
```

设计通过前不得发 H3 编码卡，不得调用 Mock 或真实 Provider。
