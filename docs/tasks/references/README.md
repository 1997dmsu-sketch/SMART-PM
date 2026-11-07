# 冻结依据只读证据快照

本目录为 `HK-AI-05-STATIC-UI-AUDIT.md` §1.2 所引用 4 份冻结依据的**只读证据快照**，用途是让报告中的 `文件:行号` 证据在离线状态下也可复核。

## 来源

- 远端仓库：`1997dmsu-sketch/SMART-PM`
- 分支 / 提交：`docs/lock-01-fast-track` @ `1318c5929ebc0d35e852c14d54239082a232278f`（短哈希 `1318c59`）
- 拉取方式：`https://raw.githubusercontent.com/1997dmsu-sketch/SMART-PM/1318c5929ebc0d35e852c14d54239082a232278f/<远端路径>`
- 拉取时间：2026-11-07
- 快照为远端文件逐字副本，未做任何编辑；权威版本仍在远端仓库。

## 文件清单与校验

| 本地快照 | 远端路径（仓库内） | 大小 | 行数 | SHA-256 |
| --- | --- | --- | --- | --- |
| `HK-AI-05-ADMIN-FLOW.md` | `docs/tasks/HK-AI-05-ADMIN-FLOW.md` | 1,812 B | 59 | `3d32caa0884d29bca98280914a1a2d77ba1a0597904cd791f43d0a2cd5576fb7` |
| `LOCK-01A-CONTRACT.md` | `docs/database/LOCK-01A-CONTRACT.md` | 7,380 B | 116 | `11221eefad38488ecd9a837dba7d1c16a64999852ad744e42cd9dde93d17cbf5` |
| `DEMO-M1-PLAN-2026-11-15.md` | `docs/tasks/DEMO-M1-PLAN-2026-11-15.md` | 6,649 B | 109 | `1e00d09381a3185e5665bd76bca23b15c44127fe445a7efe47aaaddc0c87e900` |
| `HK-AI-04A-CONTRACT-EVIDENCE-PREP.md` | `docs/tasks/HK-AI-04A-CONTRACT-EVIDENCE-PREP.md` | 3,978 B | 76 | `0260025c725753d86b4c2f2052cbfa6d66c9568f8c0dfe327542cf8a9d6ed8a0` |

合计 19,819 B / 360 行。SHA-256 由 `sha256sum` 实测。

## 使用与边界

1. 主报告 §1.2 及全文中的 `:行号` 引用**以本目录快照为准**；若远端文件后续更新，行号可能失效，需重新拉取并核对。
2. 这些是**设计 / 任务文档**，不是代码；不含凭据、人脸数据、设备唯一标识、账号密码、证书指纹或原始响应。
3. 本目录为**只读证据**，不得作为实现依据直接修改；冻结口径的变更需走 Codex 复审。
4. 若后续裁定把页面壳与报告并入 SMART-PM 仓库，本目录可按需移除并改回仓库内相对路径（届时 4 份文档本就在该仓库内）——此动作**尚未执行**，需项目负责人确认。
