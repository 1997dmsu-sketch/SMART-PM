# 海康人脸门禁 AI 分配单（2026-11-05）

真人现场任务计划于 2026-11-06 开始。今天只分配不依赖现场设备的 AI 工作。

项目里程碑：**第一版演示定于 2026-11-15**，按 M1 模拟闭环交付；11月13日冻结演示范围，11月14日完成彩排。真实设备接入属于后续 M2，不作为本次演示完成条件。

11月15日前的任务优先级、逐日交付和降级方案统一以 `DEMO-M1-PLAN-2026-11-15.md` 为准。

| AI | 任务卡 | 今天状态 | 依赖 |
|---|---|---|---|
| AI-A 文档证据 | `HK-AI-01-EVIDENCE-MATRIX.md` | 立即开始 | 两份私密 ISAPI 资料 |
| AI-B 设备探针 | `HK-AI-02-CAPABILITY-PROBE.md` | 开发与离线测试 | 11月6日后才能执行真实只读探针 |
| AI-C 数据库隐私 | `HK-AI-03-DB-PRIVATE-FACE.md` | 立即开始 | DB-02～DB-07 分支 |
| AI-D0 契约证据准备 | `HK-AI-04A-CONTRACT-EVIDENCE-PREP.md` | Kimi 立即开始 | AI-A 文档与 LOCK-01A 契约 |
| AI-D 门禁后端 | `HK-AI-04-FACE-SERVICE-MOCK.md` | 先固定契约/Mock；集成后完成 | AI-C 集成基线 |
| AI-E 后台前端 | `HK-AI-05-ADMIN-FLOW.md` | API 契约冻结后开始 | AI-D 契约 |
| AI-F 企业微信看板 | `DEV-AI-01-WECOM-BOARD.md` | Workburry 立即开始 | 无海康设备依赖 |

## 认领状态

| 任务 | 状态 | 分支 | 基准 | 当前阻碍 |
|---|---|---|---|---|
| AI-A / HK-AI-01 | 文档阶段已入基线（`9149fd4`） | `docs/hk-isapi-evidence` | `8136b90177a0a49b59d211db01975a87d781b61a` | 等待完整铭牌/固件、厂商适用性答复及目标设备 capability；公开仓库不保存水印资料 |
| AI-B / HK-AI-02 | `f15160d` 代码侧复审通过 | `feat/hk-isapi-capability-probe` | `8136b90` | 三项返工已关闭；等待现场/项目负责人批准、隔离环境和一次性窗口，批准前禁止设置 `HIKVISION_PROBE_ALLOW_READ=true` |
| AI-C / HK-AI-03 | 阶段2通过（`c7516e6`） | `feat/db-mvp-integration` | `b9ee061`（`feat/db-05-occupancies`） | 221/221 admin、51/51根测试及smoke通过；阶段3继续关闭，等待单独安排 |
| AI-D0 / HK-AI-04A | 文档阶段通过 Codex 复审（`5148159`） | `docs/hk-ai-04-contract-evidence` | `8b47fb7` | 九项架构裁定见 `HK-AI-04A-REVIEW-2026-11-05.md`；不代表真实能力验证 |
| AI-D / HK-AI-04 | `3484e00` 复审未通过 | `feat/hk-face-service-mock` | 幂等与证据绕过已关闭；剩余事件全局顺序和P1收口 | 按 `HK-AI-04-REVIEW-3484E00-2026-11-06.md` 补跨eventId乱序、最小拒绝响应和展示/update边界；暂不接线 |
| AI-E / HK-AI-05 | 今日由 Workburry 启动页面壳 | `feat/hk-face-admin` | 先用合成 fixture；等待 AI-D DTO 后绑定 | 今日交设备/申请/任务/审计页面壳，持续显示 Mock 标识 |
| AI-F / DEV-AI-01 | Workburry 已分配，演示前降为 P1 | `feat/wecom-dev-board` | `docs/lock-01-fast-track@1358ef5` | 暂不占用 AI-E 关键路径；真实发送仍等待企业微信配置 |
| HK-HUMAN-02 安装视频 | Kimi 负责脚本/分镜/字幕，真人负责断电接线与拍摄 | `docs/hk-install-video` | DS-K1T671BM + PDC-K7B-12V5A | 先交文档包；端子与锁铭牌经真人复核后再出最终成片 |

> AI-B 现场批准与执行包：`docs/tasks/HK-AI-02-LIVE-APPROVAL-PACK.md`。批准栏（现场负责人 + 项目负责人 + 执行人）签署前禁止设置 `HIKVISION_PROBE_ALLOW_READ=true`；一次批准只授权一次只读执行。

AI-A 在收到原包前可以先完成证据矩阵结构、已有资料登记映射和待核对清单；不得把二手摘要当作逐页核对完成。

指定执行模型与复审：

| 任务 | 执行模型 | 复审 |
|---|---|---|
| AI-A 文档证据 | Kimi | Codex |
| AI-B 设备探针 | DeepSeek Harness | Codex |
| AI-C 数据库隐私 | DeepSeek Harness | Codex |
| AI-D0 契约证据准备 | Kimi | Codex |
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

## 状态更新（2026-11-05 傍晚）

- **AI-B**：`59b6437` 完成 `52227b6` 五项整改——`EXPECTED_MODEL` 前置校验、fail-fast 编排（第二次 401/挑战不可解析/指纹/重定向/超时/超限/类型异常即中止）、README 无回显凭据示例、输出目录强制 0700 与报告 0600、文档计数统一为 55 项。离线回归 55 项（Windows 跳过 3 项 POSIX 权限用例）。**待 Codex 复审；复审通过前不得连接真实设备。**
- **AI-C**：已认领并推进到阶段 2，分支 `feat/db-mvp-integration`。已完成：DB-02～DB-07 集成（`b0bd26a`）、`face-biometric` 用途与三项权限（`7e9cf3d`）、权限即时复核与严格容器校验（`5468466`）、sharp 真实解码与审核 HTTP 路由（`36e5e68`）、上传预限流/总期限/有界并发（`b4dc783`）、未知 purpose 预拒绝（`4d410aa`）、尾随载荷精确检查（`8592763`；`4d410aa`、`8592763` 已复审通过）。**剩余：九项人脸 HTTP 测试与两项资源回归；完成后申请阶段 2 终审。**
- **AI-D**：DeepSeek Harness 已提交独立 Mock 骨架 `6b9c7ac`；当前按复审记录修订契约，等待复审通过后再接线。

