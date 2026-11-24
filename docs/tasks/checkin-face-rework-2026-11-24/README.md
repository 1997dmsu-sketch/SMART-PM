# 入住与人脸体验版：四路 Harness 退修投递包

日期：2026-11-24（Asia/Shanghai）。用户已经授权执行四路退修。本包的执行目标是代码修复与合成验证，不是上传体验版、部署或真实设备登记。

## 当前投递事实

本包由云端 Codex 准备。当前云端没有 dsh-baton MCP、CLI 或本地 Windows 执行连接；本包**尚未投递到 Harness**，无 run_id/session_id，状态为 `READY_NOT_DISPATCHED`。文档存在或 Git 推送成功不能改记为 queued/running/completed。

执行基线：`0d6c674a04b224025c8640628122f27c34e8df0f`。

固定复审依据：`24c6140f2c0b4942825274d1b722e520f209c96e` 的 `docs/evidence/checkin-face-experience/CODEX-REVIEW-2026-11-24.md`，含原始合成证据。必须按该固定对象读取，不能仅凭短摘要修复。

| 路线 | 卡片 | 主责 | 可先行部分 |
|---|---|---|---|
| A | [A-CLOUD.md](A-CLOUD.md) | R01、R03、R04；提供 R06 的云端复核支持 | 上传标识/事务设计及各自契约用例 |
| B | [B-MINIPROGRAM.md](B-MINIPROGRAM.md) | R02、R11/C2；上传链路适配 | 两页组件事件、普通账号反馈 |
| C | [C-WORKER.md](C-WORKER.md) | R05–R09 | deviceKey、依赖解析、照片处理设计 |
| D | [D-QA-GATES.md](D-QA-GATES.md) | R10、C1；独立贯穿回归及负控 | 静态门禁、来源校验器、独立 oracle |

## 本地调度会话执行指令

1. 使用现有本地 Windows Harness/dsh-baton。先读实际工具定义或 CLI help，查询 sessions 与近期 runs，按 `CHECKIN-FACE-REWORK-0d6c674`、原候选分支、checkin/入住/人脸等同任务线索核实 running/queued。优先续原 WorkBuddy 实施会话，由它担任 lead；同任务已在执行时只更新原会话，不再新建。
2. 确认无重复后，把本 README、[COMMON.md](COMMON.md)、四张卡及固定复审原文的 UTF-8 正文投递给 lead。lead 可创建四个不同文件归属的 Harness worker；每路返回真实 run_id、session_id 和实查状态，不能预填。模型沿用 Harness 已配置默认值，不虚报模型或借本任务改全局设置。
3. lead 核对远端候选是否前移。仅当固定基线仍适用、没有重复修复且工作区干净时，新建专用隔离工作树和 `fix/checkin-face-review-2026-11-24` 分支，从固定基线追加；若已有同任务修复分支则核对后续接。候选前移且无法确认兼容时报告具体差异，不 reset/强推覆盖。
4. 四路在这一任务专用工作树按 COMMON 文件归属并行编辑；**只有 lead 能执行 Git 写入/提交/推送**，worker 不切分支、不 stage、不 commit。不把四个相互依赖分支做 merge/cherry-pick 集成。若 Harness 不能让 worker 在该专用树协作，则由 lead 串行接入各路原始文件补丁并逐项核验，不能假称已集成。
5. A/C 先对齐上传契约和执行前复核接口，B/D 可先做无依赖部分；未定接口不得用双方各自编造的 mock 当作贯通证据。技术疑点形成精确方案交 Codex，不把它升级为新业务政策。每路完成后由 lead 冻结编辑、汇总测试、统一更新来源哈希。
6. 交付追加提交、普通显式 refspec push、ls-remote 完整 SHA、clean status、精确文件/测试/负控/未完成项与真实派单回执；停手交 Codex。没有派发成功就只报 `BLOCKED_DISPATCH` 和实际错误，不把本包当实施交付。

## 给本地原调度会话的简短投递文本

> 执行 SMART-PM `CHECKIN-FACE-REWORK-0d6c674`。先从本消息指定的任务包固定提交读取 `docs/tasks/checkin-face-rework-2026-11-24/README.md`、COMMON.md 和 A/B/C/D 卡；复审固定依据为 `24c6140f2c0b4942825274d1b722e520f209c96e`，实现基线为 `0d6c674a04b224025c8640628122f27c34e8df0f`。查重后优先续原 WorkBuddy lead，通过 dsh-baton 实际派发四路，返回真实 run_id/session_id/状态，再按卡实施并停手交独立复审。不能只回“开工”，不能把不存在的 run_id 写成已派发；不上传、不部署、不连接设备。

EOF 双 PowerShell 补证继续保留原任务及 `NOT_COVERED` 状态，本包不重复创建、不合并其证据。其他供应商/CR-2/旧冻结工作线也不重复派发。
