# HK-AI-04 H4 设计终审通过记录（1542a6c）

- 设计分支：`docs/hk-face-h4-revocation-design`
- 原设计：`5682e05`
- 返工提交：`1542a6c`
- 结论：**设计通过；仅批准分阶段发卡，不批准直接上线、HTTP、真实 Provider 或设备连接。**

## 裁定

1. 批准确定性 admin audit 的 Store 扩展，但必须作为独立前置提交，LocalStore/CloudStore 合约与旧调用兼容性单独复审。
2. 批准组织域 `device_claim_release_guards`。`createGrant` 最大布局收紧为 `33+N`：57 candidates/90 refs 可提交，58/91 必须在事务前失败关闭。
3. 批准 H4 专用 local-finalize 阶段复用 `retryable_failed` 枚举；`providerOutcome=confirmed_removed` 后只能重试本地事务，禁止再次调用 Provider，也不得记作 `awaiting_result`。
4. 批准 device 暂时保留指向 released claim；重新登记、转移和历史记录初始化必须另开受控任务。
5. H4-c 人工对账独立发卡；R45–R47 不属于 H4-a/b 验收。

## 强制实施顺序

1. H4-0A：确定性 audit Store 能力；
2. H4-0B：release guard schema、`createGrant` CAS 与容量回归；
3. H4-a：立即业务撤权；
4. H4-b：Mock 清理、local finalize 与 R01–R44/R48–R60；
5. H4-c：另行设计/复审后才可实施。

每一阶段须独立提交、独立复审。前一阶段未通过时，后一阶段保持关闭。

## 边界

- H3 通过状态不因 H4 设计而改变；
- `server.mjs`、HTTP 路由、云端、真实 Provider、真实设备写继续关闭；
- 不得自动迁移、补写或猜测旧 claim/guard/audit 记录。
