# 海康人脸门禁 AI 分配单（2026-11-05）

真人现场任务计划于 2026-11-06 开始。今天只分配不依赖现场设备的 AI 工作。

| AI | 任务卡 | 今天状态 | 依赖 |
|---|---|---|---|
| AI-A 文档证据 | `HK-AI-01-EVIDENCE-MATRIX.md` | 立即开始 | 两份私密 ISAPI 资料 |
| AI-B 设备探针 | `HK-AI-02-CAPABILITY-PROBE.md` | 开发与离线测试 | 11月6日后才能执行真实只读探针 |
| AI-C 数据库隐私 | `HK-AI-03-DB-PRIVATE-FACE.md` | 立即开始 | DB-02～DB-07 分支 |
| AI-D 门禁后端 | `HK-AI-04-FACE-SERVICE-MOCK.md` | 先固定契约/Mock；集成后完成 | AI-C 集成基线 |
| AI-E 后台前端 | `HK-AI-05-ADMIN-FLOW.md` | API 契约冻结后开始 | AI-D 契约 |
| AI-F 企业微信看板 | `DEV-AI-01-WECOM-BOARD.md` | Workburry 立即开始 | 无海康设备依赖 |

## 认领状态

| 任务 | 状态 | 分支 | 基准 | 当前阻碍 |
|---|---|---|---|---|
| AI-A / HK-AI-01 | 文档阶段已入基线（`9149fd4`） | `docs/hk-isapi-evidence` | `8136b90177a0a49b59d211db01975a87d781b61a` | 等待完整铭牌/固件、厂商适用性答复及目标设备 capability；公开仓库不保存水印资料 |
| AI-B / HK-AI-02 | 待认领 | — | `8136b90` | 真实执行等待11月6日真人网络任务；开发和离线测试可先开始 |
| AI-C / HK-AI-03 | 待认领 | — | 任务卡指定 DB 分支 | 无真人依赖，可立即开始 |
| AI-D / HK-AI-04 | 待认领 | — | 等待 AI-C 集成基线 | 可先阅读契约和准备独立 Mock 模块 |
| AI-E / HK-AI-05 | 待认领 | — | 等待 AI-D API 契约 | API 冻结后开始 |
| AI-F / DEV-AI-01 | Workburry 已分配 | `feat/wecom-dev-board` | `docs/lock-01-fast-track@1358ef5` | 真实发送等待企业微信应用/群机器人配置；Mock 开发可立即开始 |

AI-A 在收到原包前可以先完成证据矩阵结构、已有资料登记映射和待核对清单；不得把二手摘要当作逐页核对完成。

指定执行模型与复审：

| 任务 | 执行模型 | 复审 |
|---|---|---|
| AI-A 文档证据 | Kimi | Codex |
| AI-B 设备探针 | DeepSeek Harness | Codex |
| AI-C 数据库隐私 | DeepSeek Harness | Codex |
| AI-D 门禁后端 | DeepSeek Harness | Codex |
| AI-E 后台前端 | Workburry | Codex |
| AI-F 企业微信开发看板 | Workburry | Codex |

Codex 另行认领 ISAPI 路线、系统架构、安全边界、关键状态机和所有阶段复审，详见 `HK-AI-OWNERSHIP-AND-BUDGET.md`。

统一限制：

1. 今天不得连接真实设备。
2. 不得实现或调用真实写接口。
3. 不得把原始水印资料、设备密码、人脸或设备唯一标识提交 Git。
4. 不得把 Mock 结果标记为真实生效。
5. `allowDeviceOperations` 继续保持 false。

推荐认领顺序：AI-A、AI-B、AI-C 同时开始；AI-D 先阅读契约并准备独立模块，等待 AI-C 集成提交；AI-E 等 AI-D 冻结 API 后开始。

