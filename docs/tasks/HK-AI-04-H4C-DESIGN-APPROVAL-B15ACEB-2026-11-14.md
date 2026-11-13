# HK-AI-04 H4-c 对账设计终审批准（b15aceb）

- 复审对象：`docs/hk-face-h4c-reconciliation-design @ b15acebe0a8049f316797bbbd2692c55de25d111`
- 基线：`1155b7ba65991d324fb8b22bb8f7dd87f49428f9`
- 结论：**通过；允许另发 H4-c 编码卡。**
- 边界：本批准不授权 HTTP 注册、真实/Cloud Provider、真实设备连接或写操作、H4-d、合并 `main`。

## P0 关闭结论

1. **finalize-retry generation：关闭。** generation 冻结为 `(jobId, expectedRevision)`；同键同摘要只重放不可变四字段指针，不同键可在当前未消费的 exhausted revision 开新一轮，旧 revision 明确返回 `RECONCILE_GENERATION_CONSUMED/409`。每轮提交令 job revision 增加，CAS、并发、确认丢失、再次耗尽后的新 generation 均有对应矩阵证据 RC65–RC68。
2. **previous evidence 完整复核：关闭。** 父证据在追加事务内经过正式精确 validator，并复核 ID、组织、job、sequence、observedAt、K3 domain/config；摘要按冻结消息重算并以 `crypto.timingSafeEqual` 比较。第一条证据与非首条链尾规则、失败关闭错误及 RC69–RC73 已闭环。

## Q1–Q9 裁定

| 问题 | 裁定 |
|---|---|
| Q1 | 批准独立 K3、结构化 HMAC、不可逆 fingerprint 与全局 `evidence_digest_domains`。 |
| Q2 | 批准 H4-c 不重新派发 `confirmed_present`；未来若需重清理，另立 H4-d generation/job 契约。 |
| Q3 | 批准 `still_unknown` 最短 60 秒、最多 8 次，最终裁定可使用 sequence 9。 |
| Q4 | 批准组织域 immutable evidence 与每 job evidence head；所有追加必须同事务 CAS，禁止分叉。 |
| Q5 | 批准 `confirmed_removed` R1/R2 两段式以及 operation key 稳定指针 + 当前投影。 |
| Q6 | 批准 `finalizeAttempts` 从 1 起算，第四次耗尽进入 `LOCAL_FINALIZE_EXHAUSTED`。 |
| Q7 | 批准老任务、旧证据、缺 snapshot/guard/domain 数据失败关闭；不得自动补写或猜测迁移。 |
| Q8 | 批准仅本地 `finalize-retry` 人工恢复入口及 generation 语义；Provider 恒为 0。 |
| Q9 | 批准 K3 domain 为全局部署域，evidence/head 为组织域。 |

## 编码约束

- 必须按 schema/K3、对账状态机、恢复与完整矩阵分阶段提交和复审。
- `confirmed_removed` R2 与恢复必须复用 H4-b finalize/validator，不得复制或放宽资源释放算法。
- K2/K3、evidence/head、operation key、job/grant、log/audit 必须在各自冻结事务内完成严格校验；所有失败路径内容级零副作用。
- H4-c 公开输入只接受 `sourceType=operator`；不得接受用户伪造 `mock_provider`。
- Provider 调用必须保持 0；不得修改 `server.mjs` 或注册提案路由。

## 非阻断说明

设计 §5.3 的“可按历史版本重算”只表示记录携带版本锚点；H4-c 没有历史密钥材料，运行时仍按 §5.4 对非当前 K3 失败关闭。编码和测试不得据此实现历史密钥回退。

