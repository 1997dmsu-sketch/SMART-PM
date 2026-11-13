# HK-AI-04 H4-c 对账与本地恢复实现任务卡

## 1. 输入与基线

- 代码基线：`feat/hk-face-h4b-mock-cleanup @ 1155b7ba65991d324fb8b22bb8f7dd87f49428f9`
- 冻结设计：`docs/hk-face-h4c-reconciliation-design @ b15aceb`
- 终审批准：[HK-AI-04-H4C-DESIGN-APPROVAL-B15ACEB-2026-11-14.md](./HK-AI-04-H4C-DESIGN-APPROVAL-B15ACEB-2026-11-14.md)
- 新分支建议：`feat/hk-face-h4c-reconciliation`

## 2. 交付拆分

### C1：schema、Store、K3 与 evidence 链 helper

- 登记 `device_operation_evidence`、`device_operation_evidence_heads`、`evidence_digest_domains`。
- 实现三个精确 validator、K3 配置/fingerprint/domain guard、确定性 ID、HMAC 生成及父证据正式复核。
- 覆盖同版本换钥、domain 单边/损坏、首条链、父证据 schema/归属/sequence/HMAC、head CAS/分叉。
- 本提交不得接状态机。

### C2：三种 reconcile decision

- 实现 `confirmed_removed` R1 + 复用 H4-b finalize 的 R2。
- 实现 `confirmed_present` 与 `still_unknown`，包括 60 秒/8 次、grant/job/snapshot 事务复核、K2 严格重放与响应投影。
- Provider 调用 0；不得复制 H4-b 资源释放实现。

### C3：finalize-retry 与终审矩阵

- 实现 `(jobId, expectedRevision)` generation、9 refs 恢复事务、四字段 K2 result、CAS、确认丢失与 `RECONCILE_GENERATION_CONSUMED`。
- 恢复事务后仅调用 H4-b 本地 finalize；不得调用或重发 Provider。
- 完成 RC01–RC73，失败路径必须比较内容级快照；补全并发、83 refs、敏感字段和 Provider 0 证据。

每一笔提交都必须先通过独立复审，前一笔未通过不得进入下一笔。

## 3. 强制验收

- H4-c 定向测试全绿；Admin 全量与根测试全绿。
- RC01–RC73 有逐项可追溯测试或明确复用证据，不得只用数量比较证明零副作用。
- evidence create-only、head CAS、operation key create-only；损坏记录不得被覆盖修复。
- K2/K3 配置缺失或 domain 异常失败关闭；K1/K2/K3 不得混用。
- 响应、日志、审计与持久化扫描不得出现原始幂等键、密钥、序列号、IP/MAC、PII、图片/字节、objectKey、checksum、异常 stack/message。
- 提交说明须列出变更文件、测试命令与计数、Provider 调用计数、HTTP/设备边界、未完成项。

## 4. 明确关闭

- 不修改或注册 HTTP 路由，不改 `server.mjs`。
- 不接 Cloud/live/真实 Provider，不连接或写入真实设备。
- 不实现 H4-d，不做 K3 历史密钥迁移，不合并 `main`。
- 不把本任务完成表述为“完整门禁已上线”。

