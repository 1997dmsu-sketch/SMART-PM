# HK-AI-04 H4-c UNKNOWN_RESULT 人工对账设计任务

## 指派与基线

- 承接：DeepSeek Harness（设计阶段）
- 服务层基线：H4-b `1155b7ba65991d324fb8b22bb8f7dd87f49428f9`
- 终审记录：`HK-AI-04-H4B-APPROVAL-1155B7B-2026-11-13.md`
- 交付：一份 H4-c 契约设计文档；**本卡不批准生产代码或测试修改。**

## 目标

冻结 `awaiting_result` 的人工对账入口，使发送结果未知的撤权任务可以依据受控、合成证据收敛，同时保证不自动重发 Provider、不误释放 slot/claim、不泄露原始响应。

## 必须设计

1. 权限固定为 `device.operation.reconcile`；事务内复核 active organization、membership、actor 和 expectedRevision。
2. 输入包含 `jobId`、`expectedRevision`、`decision`、`evidence`、`Idempotency-Key`；定义严格 DTO、长度、字符集、时间、安全整数与未知字段拒绝。
3. decision 仅允许：
   - `confirmed_removed`：复用 H4-b local finalize，绝不调用 Provider；
   - `confirmed_present`：任务转 `terminal_failed`，grant 保持 `revoked/cleanupPending=true`，资源不释放；
   - `still_unknown`：保持 `awaiting_result`，只追加确定性日志。
4. 证据仅保存来源类型、短码、发生时间和不可逆摘要；原始设备响应、序列号、IP/MAC、账号、图片、完整指纹及原始幂等键不得入库。
5. Mock 阶段只接受 `evidenceScope=simulated` 的合成证据；Cloud/live、真实 Provider、真实设备证据继续失败关闭。
6. K2 operation key、requestDigest、严格重放结果、同键异摘要冲突、损坏记录、确认丢失与 callback 重跑必须与现有契约一致。
7. `confirmed_removed` 必须使用 H4-b 的 candidate 扫描、release guard CAS、82/83 refs、墓碑和 local-finalize 规则；不得建立第二套释放算法。
8. `confirmed_present/still_unknown` 的 job/log/audit 单事务 refs/writes、确定性 ID 和 90-ref 上限必须完整列出。
9. 对账与 H4-b finalize、过期扫描、另一个人工对账、并发 createGrant 的线性化点和冲突结果必须冻结。
10. 老任务缺 snapshot、旧证据缺摘要、损坏墓碑或缺 release guard 时失败关闭；禁止自动迁移、补写或猜测。

## 测试矩阵最低要求

连续编号并至少覆盖：

- 三种 decision 成功路径；
- 无权限、跨组织、stale revision、非法 evidence、K2/domain 错误；
- 同键重放、异摘要、损坏 operation key；
- `confirmed_removed` 的共享设备 blocker、82/83 refs、guard 幻读、当前/其他 job 墓碑；
- 与 finalize/expire/createGrant/第二个 reconcile 的并发；
- log/audit/op key 预占与事务 callback 重放；
- 内容级零副作用、Provider 调用恒为 0、敏感字段扫描；
- Cloud/live/真实 Provider/设备连接失败关闭。

## 待裁定问题

1. evidence 摘要的用途域、算法、版本与密钥来源；
2. `confirmed_present` 是否允许后续受控重新派发，还是只能保持人工处置；
3. `still_unknown` 是否需要最小间隔或次数上限；
4. 对账日志和证据记录是否独立集合，还是嵌入 job result；
5. 未来 HTTP 路径与最小响应 DTO，但本阶段不得注册路由。

## 验收

- 独立文档分支，仅新增/修改 H4-c 设计文档；
- 引用当前代码和批准文档的准确路径/章节；
- 连续测试矩阵、refs 上限、错误映射、字段白名单齐全；
- `git diff --check`、相对链接和敏感值扫描通过；
- 提交并推送后交 Codex 复审；
- 设计终审通过前不得开始 H4-c 编码。
