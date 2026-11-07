# HK-AI-04A：门禁后端契约与证据核对

优先级：P0 前置
执行者：Kimi
复审者：Codex
建议分支：`docs/hk-ai-04-contract-evidence`
基准分支：`docs/lock-01-fast-track`
状态：文档阶段已完成并通过 Codex 复审（交付 `5148159`，复审记录 `HK-AI-04A-REVIEW-2026-11-05.md`）
依赖：HK-AI-01 文档交付、LOCK-01A 契约和 HK-AI-04 任务卡；不等待真实设备

## 目标

在 DeepSeek Harness 开发 HK-AI-04 前，核对厂商无关服务契约与现有文档证据，形成可复审的字段、状态、错误和未确认项清单。此任务只整理文档，不实现后端、不连接设备，也不批准任何真实 ISAPI 调用。

## 输入

1. `docs/tasks/HK-AI-04-FACE-SERVICE-MOCK.md`
2. `docs/devices/LOCK-01A-CONTRACT.md`
3. `docs/devices/HIKVISION-ISAPI-EVIDENCE-MATRIX.md`
4. `docs/devices/HIKVISION-ISAPI-PROVIDER-WHITELIST.json`
5. `docs/tasks/HK-AI-03-DB-PRIVATE-FACE.md`
6. 已合并的 DB-02～DB-07 数据设计与复审记录

## 任务

1. 整理 HK-AI-04 服务边界：设备、凭证、授权、操作任务、操作日志、Provider、资格校验和审计。
2. 输出 API 契约表：操作名、调用方、输入、输出、权限、幂等键、事务边界、审计事件及失败语义。
3. 输出状态机表，至少覆盖 `pending`、`processing`、`succeeded`、`failed`、`awaiting_result`、`revoking`、`revoked`；逐项标明合法迁移、终态、重试和人工对账条件。
4. 对照 HK-AI-01，建立字段映射：业务字段、厂商候选字段、证据等级、适用范围、是否经目标设备验证、缺失时的 fail-closed 行为。
5. 整理错误分类：发送前确定失败、发送后未知、可重试失败、终态失败、资格失效、跨组织访问、设备归属冲突和幂等冲突。
6. 明确 Mock 场景与预期结果，覆盖成功、设备离线、发送前失败、发送后未知、终态失败、撤权失败、重复回调及乱序回调。
7. 列出所有需要 Codex 拍板或等待 AI-C/现场证据的事项，不自行补全未知字段、端点、容量、图片限制或错误码。

## 交付物

新增 `docs/devices/HK-AI-04-CONTRACT-EVIDENCE-REVIEW.md`，至少包含：

- 服务/API 契约矩阵；
- 状态迁移矩阵；
- 数据字段与证据映射；
- 错误分类和重试/对账规则；
- Mock 场景验收表；
- 已确认项、未确认项及依赖来源；
- 给 DeepSeek Harness 的实现输入清单。

只提交 Markdown。不得修改生产代码、数据库迁移、Provider 白名单开关或既有证据结论。

## 强制边界

1. `candidateOnly=true`、`allowedNow=false`、`allowDeviceOperations=false`、`providerReleaseApproved=false` 保持不变。
2. 通用指南、近似型号和 fixture 不能写成 `DS-K1T671BM` 目标设备实测能力。
3. 不实现或调用真实 GET/POST/PUT/DELETE，不接触账号、密码、证书指纹、设备地址、原始响应或人脸文件。
4. 不决定最终 ISAPI 路线；不把 Mock 成功定义为设备生效。
5. 未知结果必须进入 `awaiting_result` 并等待查询或人工对账，不能建议自动重复写入。
6. 退租或资格失效时业务授权立即失效；设备撤权失败只保留告警和任务，不恢复业务授权。

## 验收

- 每项字段和端点结论都有来源，并明确证据等级与适用范围。
- 契约包含权限、组织隔离、幂等、审计和未知结果处理。
- 状态迁移不存在从未知结果直接自动重试写操作的路径。
- 文档能直接作为 HK-AI-04 编码输入，但不包含未经确认的厂商实现假设。
- Codex 复审通过后才允许冻结契约并交 DeepSeek Harness 编码。

## 完成回复

```text
完成：HK-AI-04A 门禁后端契约与证据核对
分支/提交：
交付文件：
已核对的输入：
契约/状态/错误项数量：
需要 Codex 决策：
等待 AI-C 或现场证据：
生产代码或真实设备调用：无
```
