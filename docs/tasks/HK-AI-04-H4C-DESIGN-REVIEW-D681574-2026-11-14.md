# HK-AI-04 H4-c 设计复审（d681574）

- 复审对象：`docs/hk-face-h4c-reconciliation-design`
- 提交：`d6815749dd478e8027ee54c2d82c9fd9b3e1826e`
- 文档：`HK-AI-04-H4C-RECONCILIATION-DESIGN.md`
- 结论：**暂不通过；H4-c 编码、HTTP、真实 Provider 与设备连接继续关闭。**

## P0 阻断

### 1. K3 换钥保护契约不完整

设计提出 `H4_EVIDENCE_HMAC_KEY_B64` 与 `H4_EVIDENCE_KEY_VERSION`，但 evidence 白名单没有保存 keyVersion/realm，事务 refs 也没有稳定 domain head/version；同版本换密钥无法检测，历史证据也无法确定使用哪一版密钥验证。

返工必须冻结独立 K3 配置、结构化 HMAC 消息、不可逆 key fingerprint、稳定 head/version 记录、同版本换钥失败关闭、集合/schema/Store 登记、事务 refs 与错误映射。不得复用 K1/K2 或只依赖环境变量当前值。

### 2. 不可变 evidence 链没有原子 head

当前只读取“新 evidence + previous evidence”，却要求连续 sequence、previous 链、60 秒间隔和最多 8 次。在 job 不变的 `still_unknown` 路径中，没有 per-job head/CAS；完整链损坏、预读后插入、并发不同键和分叉无法由文档中的 refs 可靠证明。

返工应新增组织域 evidence head/control record（或给出等价、可证明的全链事务方案），至少包含 jobId、lastSequence、lastEvidenceId、lastObservedAt、revision/createdAt/updatedAt。所有 decision 必须在同一事务 CAS head；重新计算 refs、90 上限、预占与 callback 重放。

### 3. R1/confirmed_present/still_unknown 事务缺少 grant 复核

三种 decision 的 refs 均未包含 grant，但契约要求确认 grant 仍为 `revoked`、`cleanupPending=true`、`cleanupJobId=jobId`，响应还要返回 `grantState/cleanupPending`。事务外预读不能支撑该投影，也不能阻止 job 与 grant 在提交前分离。

每种 decision 的事务都必须读取并复核 grant；R1 还须在把 job 切到 finalize 前事务内复核 cleanup snapshot/job/grant 绑定。修正 refs/writes 数量及竞态矩阵。

### 4. confirmed_removed 本地 finalize 耗尽后没有人工恢复闭环

R1 将 decision 固定为 `confirmed_removed`，但 R2 第四次失败后进入 `terminal_failed/LOCAL_FINALIZE_EXHAUSTED`。现有 H4-b `finalize()` 只接受 `retryable_failed`，本设计又把终态重复请求定义为零写 duplicate，因此已确认删除的任务可能永久保持 `cleanupPending=true`，H4-c 本身无法收敛。

返工必须明确：由 H4-c 提供受权限/CAS/幂等保护的“仅本地再次 finalize”入口，或明确拆出受控后续卡并把 H4-c 的完成条件/响应改为不宣称闭环。任何方案都不得再次调用 Provider。

### 5. sourceType 与 actor 来源矛盾

设计称人工入口只接受 `actorType=user`，请求却允许用户选择 `sourceType=mock_provider`。这会让人工输入伪装成 Provider 来源。

必须绑定来源：人工用户只能提交 `operator`；`mock_provider` 只能由受信系统适配器产生，并须定义独立调用边界。若本阶段没有该适配器，应从公开 DTO 删除 `mock_provider`。

## P1 缺口

1. 冻结 `device_operation_evidence` 及 evidence head/K3 domain 的组织域或全局属性、精确 validator、Store 白名单/seed/init、查询索引和敏感字段拒绝。
2. evidence 的 `digestVersion` 与密钥版本概念混用；需分别定义 schemaVersion、digestAlgorithmVersion、keyVersion。
3. `confirmed_present/still_unknown` 必须验证 revoke job 与 grant 关系、cleanup snapshot 及 evidenceScope，而不只检查 job state。
4. 两段式 R1/R2 的 200/202/终态失败投影需覆盖 `LOCAL_FINALIZE_EXHAUSTED`、确认丢失及不同键重复请求。
5. RC 矩阵须增加：K3 domain 单边缺失/同版本换钥、evidence head 分叉/消失/并发、grant 在事务前后变化、用户伪造 provider 来源、local-finalize 耗尽后的人工恢复。

## 已认可方向

- 三种 decision 及 Provider 恒为 0；
- `confirmed_removed` 复用 H4-b local finalize，而非复制释放算法；
- evidence 独立不可变集合；
- `confirmed_present` 不在 H4-c 重新派发；
- `still_unknown` 采用间隔与次数上限；
- HTTP 仅作为未来路径提案，本阶段不注册。

## 返工边界

下一提交仍只能修改设计文档，不得新增生产代码或测试。修订后须重新执行提交级 `git diff --check`、链接和敏感值扫描，并提供连续更新后的矩阵及 refs 计数。
