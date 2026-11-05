# 海康人脸门禁 AI 认领与额度分配

生效日期：2026-11-05
目标：把强推理额度集中在架构、安全和复审；文本整理优先 Kimi；大量编码与测试交给 DeepSeek Harness；低推理常规实现交给 Workburry。

## 1. 角色边界

### Codex：架构负责人和最终复审人

Codex 已认领：

1. ISAPI 接入路线决策与安全边界。
2. 设备侧 ISAPI、边缘代理、云端服务的系统架构。
3. 人脸凭证、授权周期、任务状态机、幂等和未知结果对账设计。
4. 数据库集成冲突和跨模块语义复审。
5. 私密文件、权限、审计和退租撤权复审。
6. 只读 capability 探针安全复审。
7. 真实 Hikvision Provider 代码审查。
8. 隔离设备联调结果、残留清理证据和生产灰度门禁复审。
9. 所有 AI 提交的优先级协调、返工决定和最终验收。

Codex 不重复执行：大批量文档摘录、机械字段录入、常规页面铺设和重复测试编码。只有发现设计错误、权限漏洞或集成阻塞时才直接修改关键代码。

### Kimi：文本、资料和证据整理

Kimi 已分配：

1. `HK-AI-01-EVIDENCE-MATRIX.md`。
2. 两份 ISAPI 指南的章节、端点、字段、能力节点和错误码摘录。
3. 型号适用范围、厂商待确认问题和真人回复整理。
4. 联调报告、清理证明和上线说明的文字初稿。

Kimi 的结论必须由 Codex 复审；不得自行决定某接口可用于目标设备，不编写或调用真实设备接口。

### DeepSeek Harness：大量代码、集成和测试

DeepSeek Harness 已分配：

1. `HK-AI-02-CAPABILITY-PROBE.md`：只读探针、fixture 和自动测试。
2. `HK-AI-03-DB-PRIVATE-FACE.md`：DB-02～DB-07 集成、`face-biometric`、权限和隔离云探针准备。
3. `HK-AI-04-FACE-SERVICE-MOCK.md`：服务层、任务队列、Mock Provider、并发和错误测试。
4. 后续真实 Hikvision Provider 的主体编码，但必须等待 Codex 路线批准和只读 capability 证据。
5. 大规模回归、竞争、跨组织、幂等、撤权和异常测试。

DeepSeek Harness 每个阶段必须独立分支、细粒度提交；共享 `server.mjs/store.mjs` 单独提交。不得跨过 Codex 复审直接进入下一阶段。

### Workburry：低推理常规实现

Workburry 已分配：

1. `HK-AI-05-ADMIN-FLOW.md` 中 API 已冻结的后台页面布局、表格、筛选、状态展示和基础交互。
2. 测试数据生成、fixture 清单、文档索引和人工验收表整理。
3. 页面空状态、加载状态、错误提示和常规响应式适配。
4. 根据已批准接口补充常规客户端调用，不设计权限和状态机。

Workburry 不负责：权限决策、设备网络、密钥、幂等、任务重试、未知结果处理、真实设备写入和数据库迁移。

## 2. 任务—执行—复审矩阵

| 任务 | 执行者 | 架构/复审 | 开始条件 |
|---|---|---|---|
| ISAPI 文档证据矩阵 | Kimi | Codex | 立即开始 |
| 只读 capability 探针 | DeepSeek Harness | Codex | 立即开发；真人任务后执行 |
| DB MVP 集成 | DeepSeek Harness | Codex | 立即开始 |
| `face-biometric` 私密文件 | DeepSeek Harness | Codex | DB 集成提交后 |
| 人脸服务层和 Mock | DeepSeek Harness | Codex | 契约先由 Codex确认 |
| 后台页面常规实现 | Workburry | Codex | API 契约冻结后 |
| ISAPI 路线决策 | Codex | 项目负责人确认 | 真人资料＋只读探针结果 |
| 边缘代理安全架构 | Codex | DeepSeek 可提供实现建议 | 路线决策后 |
| 真实 Hikvision Provider | DeepSeek Harness | Codex | 路线批准＋隔离网络就绪 |
| 联调报告文字初稿 | Kimi | Codex | 隔离联调后 |
| 测试/验收表整理 | Workburry | Codex抽查 | 每阶段提交后 |
| 隔离设备验收 | 现场真人＋Codex复审 | 项目负责人 | 真实 Provider 通过代码审查 |
| 生产灰度批准 | Codex给技术结论 | 项目负责人最终决定 | 所有 P0 门禁关闭 |

## 3. 额度控制规则

1. 同一任务只允许一个主执行模型，其他模型不重复实现。
2. Kimi 输出证据表后，Codex只审查高风险结论和抽样原文，不重新全文摘录。
3. DeepSeek Harness 先跑完整自动测试并提交结果，Codex聚焦权限、并发、未知结果和隐私边界。
4. Workburry 只在 API 冻结后工作，避免页面因契约变化重复返工。
5. Codex 每轮复审只输出阻断问题；普通格式和低风险文案交回原执行模型修改。
6. 真实设备写入前必须单独复审，不因 Mock 或只读探针通过自动放行。
7. 每个任务最多两轮常规返工；第三轮仍有 P0/P1 问题时，由 Codex直接收口设计，再交原执行模型实现。

## 4. 提交流程

```text
执行模型认领任务
      ↓
独立分支开发、自测、提交
      ↓
按任务卡回复 commit + 测试 + 未完成项
      ↓
Codex 架构/安全复审
      ↓
通过 → 进入下一阶段
返工 → 原执行模型定点修复
```

## 5. Codex 当前认领声明

```text
认领：海康人脸门禁架构、安全和全阶段复审
工作基线：docs/lock-01-fast-track
负责：路线决策、数据/权限/任务状态机、探针安全、Provider审查、联调证据、灰度门禁
不重复：全文档摘录、大量常规编码、页面铺设、机械测试录入
复审输入必须包含：完整commit、diff、测试结果、证据范围、未执行项、清理方法
真实设备写入：必须等待单独批准的隔离联调阶段
```

