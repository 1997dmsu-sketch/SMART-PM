# SMART-PM 交付状态索引补充（2026-11-23）

> 本页是既有需求入口的 P1 状态维护，范围限 HK-AI-08 后续交付；不是新的需求总纲、实施卡或设备执行授权。日期按 Asia/Shanghai。固定提交证明指定范围，文档通过、代码交付、离线实测、Windows 本机实测、真实设备准入分别登记。

## 1. 与历史快照的关系

- 起点为需求入口提交 `37b86144cf3e24599b23629d4eac717c657ba797`；[11/21 文档复审状态](DOCUMENT-REVIEW-STATUS-2026-11-21.md)保留原字节，不改写其 HK-01、HK-04 及 §3/§4 当时记录。
- 此后核对器已交付并完成 Linux 合成复现，不能再把历史“核对器未实现、未运行、实现未授权”当作当前状态。Windows ACL 候选和 P0 设计也分别已有交付；这些事实不等于 E1/E2 准入或执行通过。
- 原[需求台账](REQUIREMENTS-REGISTER.md)与[待决清单](OPEN-DECISIONS.md)未在本次修改；租赁业务确认值、其他工作线验收结论与冻结范围不由本页重判。本页不是全项目分支的新一轮穷尽盘点。
- 旧来源正文的“待独立复审”保留送审时点；下表另列本对话后续独立结论，不将作者自检当作独立验收。

## 2. 当前交付与验证范围

| ID | 固定交付 | 当前范围结论 | 未证明或尚待材料 |
|---|---|---|---|
| HK-CHECK | 离线配置核对器 `31f20c9a372c447f142312f6e95e0400372f9ee8`；[交付证据](https://github.com/1997dmsu-sketch/SMART-PM/blob/31f20c9a372c447f142312f6e95e0400372f9ee8/docs/evidence/hk-ai-08-offline-config-checker/README.md) | 实现已交付；本对话独立代码与测试证据复审通过。Linux 合成测试 285/285，14 个顶层 ID（OC01–OC14） | 仅格式/字段匹配；不产生真实 `approvalValid` 或 `sameConfigBound`，不证明设备可达或 TOCTOU 已解决 |
| HK-PREP | 原离线复现及 E1/E2 准备卡 `ba93485e07fa5ec5ab83dc27ea2943200d38a1f6`；[准备卡](https://github.com/1997dmsu-sketch/SMART-PM/blob/ba93485e07fa5ec5ab83dc27ea2943200d38a1f6/docs/tasks/HK-AI-08-E1-E2-HARNESS-PREPARATION-2026-11-21.md) | 仅准备文档与静态复核；后续离线复现由 Codex 在 Linux 执行，见下一行 | 原准备文档中的派发时点不替代最新本地任务状态；E1/E2 真实准入须另核 |
| HK-REPLAY | 便携包复现 `6533f012a1f64d7fe9f70bb8f637ef7c1b9dc598`；[实测报告](https://github.com/1997dmsu-sketch/SMART-PM/blob/6533f012a1f64d7fe9f70bb8f637ef7c1b9dc598/docs/evidence/hk-ai-08-offline-config-checker/CODEX-PORTABLE-REPLAY-2026-11-21.md) | 同一 Linux x86_64 / Node v24.22.1，从便携包全新解压实测 285/285、退出 0；包内八文件执行前后相同。独立证据复审通过 | 不是 Windows 或跨系统验收；未执行真实 CLI、设备探针或真实配置读取 |
| HK-WIN | Windows ACL 预检候选 `3bb0b95df351ef357aedff6a21a275a19b92b6f2`；[交付证据](https://github.com/1997dmsu-sketch/SMART-PM/blob/3bb0b95df351ef357aedff6a21a275a19b92b6f2/docs/evidence/hk-ai-08-windows-evidence-preflight/README.md) | 实现候选已交付、独立静态复核通过；源文件声明 51 个场景（8 正向＋43 负向），云端 PowerShell/ACL 实际执行 0 | 用户回报相关工作已指派给本地电脑；本对话尚未取得运行回报，未独立核验当前运行状态。不得把 51 个声明场景记成 51/51 PASS，亦不据此断言本地未执行 |
| HK-P0-A | 受控配置绑定设计 `4df33305d488df2797cea4c3d2b286db7d8daa2c`；[设计](https://github.com/1997dmsu-sketch/SMART-PM/blob/4df33305d488df2797cea4c3d2b286db7d8daa2c/docs/tasks/HK-AI-08-E1-CONTROLLED-CONFIG-BINDING-DESIGN-2026-11-23.md)／[独立记录](https://github.com/1997dmsu-sketch/SMART-PM/blob/4df33305d488df2797cea4c3d2b286db7d8daa2c/docs/evidence/hk-ai-08-p0-design-2026-11-23/CONFIG-BINDING-REVIEW.md) | P0-A 设计交付关闭；独立静态复审及 A/B 接口一致性通过。17 个错误 ID、20 个父验证 ID（T03a/b 分行，共 21 行）均为设计 | 受控 runner 未在本交付实施；本轮实际测试 0。审批真实性、同份配置执行接线仍未证明 |
| HK-P0-B | Node / Windows ACL 接线差距复核 `e6995bcb4dd9943df9745604bfcca7c4d7ea8890`；[差距与拟验收卡](https://github.com/1997dmsu-sketch/SMART-PM/blob/e6995bcb4dd9943df9745604bfcca7c4d7ea8890/docs/tasks/HK-AI-08-NODE-WINDOWS-ACL-INTEGRATION-REVIEW-2026-11-23.md)／[独立记录](https://github.com/1997dmsu-sketch/SMART-PM/blob/e6995bcb4dd9943df9745604bfcca7c4d7ea8890/docs/evidence/hk-ai-08-p0-design-2026-11-23/NODE-ACL-REVIEW.md) | P0-B 文档交付关闭；独立静态复审通过，NA01–NA16 为 16 个未来验证 ID | Node adapter、实际 Node writer 与原生 ACL/对象身份回读尚未实施/实测；本轮测试、接线与设备调用均 0 |

HK-CHECK、HK-REPLAY 的后续独立通过依据为本对话根 Codex 的已给结论；本页转录其范围，不伪造新增复跑或 Harness 派单编号。两项 P0 的独立结论另有上表固定 Git 记录可取件。

### 2.1 离线计数的解释

- 285/285 是测试节点数，不是 285 个需求 ID，也不是设备请求数。便携包复跑使用批准的 `--test-isolation=none` 同进程模式，未新增子进程隔离通过声明。
- 便携复跑 guard 实际槽为 131＝97 网络/进程＋34 运行期文件读取；加载期核对 97 槽为 0，正控后的业务增量为 0。文件 guard 在模块加载后安装；不覆盖加载期文件读取，环境禁读为源码边界，不是全局环境代理或 OS 沙箱。
- 报告分别保留旧启动门禁差异、首次辅助摘要解析失败与最终 attempt-2 的退出 0；不把辅助脚本失败说成测试失败，也不把第一次未持久化的退出码补写为 0。
- Windows ACL PASS 即便后续取得，也只证明该合成预检范围。默认清理后的目录、公开 PASS JSON 或 evidenceRef 不等于实际 Node writer 的存活私有能力，更不等价于 POSIX 权限或 E1 放行。

## 3. 当前未闭合的证据与接续点

| 接续项 | 当前记录 | 取得材料后的处理边界 |
|---|---|---|
| 本地 Windows ACL 回报 | 用户已说明相关工作指派给本地电脑；本索引无本地任务编号、实时状态或执行结果 | 沿用既有本地任务，不重复派发。接收固定版本/文件完整性、Windows 与 PowerShell 版本、实际命令/退出码、逐项原始结果及清理状态；先独立核验，再登记实际通过范围。材料不含真实账号、地址、指纹、SID 或凭据值 |
| P0-A/B 后续实施 | 设计/差距文本已关闭；实现与组合版本尚需另案确定 | 另列完整范围、起点与组合版本后推进；不从本页直接启动 runner、Node/原生适配器或 Windows 接线 |
| E1 真实准入 | 本轮没有读取真实批准包、设备配置、激活/目标/证书或账号权限材料；未取得可放行证据 | 沿既有准入单独核验有权审批、同份配置绑定、目标/证书/权限及实际证据保护；不把离线 PASS 或设计通过当作授权 |
| E1/E2 执行结果 | 本轮未连接设备、未执行设备 GET、未上传照片；其他会话/本地是否执行不由本页无证据推断 | 原单目标、六 GET 白名单及 E1/E2 分阶段边界保留；真实动作须明确授权。E2 不因 E1 准备完成而自动开放 |

用户已明确“不需要隔离网络”，该前置保持取消；本页不重新要求隔离网、VLAN 或同类替代证明。取消该前置不取消其他准入证据，也不授权扫描或写设备。

## 4. 其他工作线与当前范围

- 租赁合同 v4 和文本映射沿用既有关闭结论，本次不改/重做；DOCX 版式等未验证范围保留。A-01、A-02、A-04、A-05、A-08 等业务未决仍归用户，不代选政策；费用及旧条款审核暂缓不等于旧值获批。
- G1–G4 等既有验收结论不重开；原报告副本缺口不被本页转录关闭。历史凭据风险、Git 配置偏差和 UDP 缺口本次未处置或重新取证。
- S4、预签约 S2–S6、H4-c C2/C3、07B 执行、main/07B 合并、HTTP/UI、真实支付/退款、设备/生产云操作及部署发布不因本页放行；本次没有启动这些动作。
- 本页只维护需求入口及本状态索引，不修改实现、测试、准备卡、两项 P0 正文、已验收交付物、历史快照或全局 Git/TLS 配置。

## 5. 固定远端核验与取件

2026-11-23，根 Codex 在本次整理中实际执行 `git ls-remote origin`，按下列完整 ref 精确查询，退出 0；返回值均与本页固定对象一致。此查询是 Git 交付核验，不是设备、支付、应用 HTTP 或 Windows 运行验证。

| 远端分支（`refs/heads/` 后缀） | 本次查询返回的完整 SHA |
|---|---|
| `docs/requirements-register` | `37b86144cf3e24599b23629d4eac717c657ba797` |
| `feat/hk-ai-08-offline-config-checker` | `31f20c9a372c447f142312f6e95e0400372f9ee8` |
| `docs/hk-ai-08-codex-offline-replay-report` | `6533f012a1f64d7fe9f70bb8f637ef7c1b9dc598` |
| `feat/hk-ai-08-windows-evidence-acl-preflight` | `3bb0b95df351ef357aedff6a21a275a19b92b6f2` |
| `docs/hk-ai-08-e1-config-binding-design` | `4df33305d488df2797cea4c3d2b286db7d8daa2c` |
| `docs/hk-ai-08-node-windows-acl-integration-review` | `e6995bcb4dd9943df9745604bfcca7c4d7ea8890` |
| `main` | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` |

准备卡来源 `ba93485e07fa5ec5ab83dc27ea2943200d38a1f6` 按本地固定 Git 对象核对；本轮未对其分支另作远端 tip 断言。所有文档链接使用固定提交；原始 `/workspace/artifacts` 路径不假定在 Windows 或其他聊天可见。

本页自身交付位于独立文档分支 `docs/requirements-delivery-status-2026-11-23`，不将该分支写成已经合入需求入口原分支或 main；本页最终提交与普通推送结果由根 Codex 在交付回报中另报。任何实施、合并、发布仍需另案授权。

## 6. 2026-11-24 当前状态补充（执行者 Harness，HK-AI-08 状态同步）

> 本段为 2026-11-24 实际生成时刻（Asia/Shanghai，约 08:50）追加的当前状态补充。上文 §1–§5 为截至 2026-11-23 的既有记录（固定起点提交 `184d6e12c39c3012205661e378e197abdd20ed8f`，2026-11-23T05:22:22Z，即 +08:00 13:22:22），原字节保留；其中“未实施/未验证/BLOCKED”均为该时点快照，不作为当前状态。本段不是新需求总纲、实施卡或执行授权。无法取件或尚无回执的项记 UNKNOWN/待收口，不预填通过。

### 6.1 代码交付（CR-2 实施）

| 项 | 本执行登记 |
|---|---|
| 固定提交 | `72d654a847d10d75b0fc479586a1c97647e28a9c`，分支 `feat/hk-ai-08-e1-cr2-synthetic` |
| 远端 tip | 2026-11-24 08:37:23 +08:00 `git ls-remote` 退出 0，返回 tip 即上述完整 SHA |
| 提交原文范围 | 13 文件（2707+/4−）：改 4（证据 README、runner README、controlled-runner.mjs、private-plan.mjs）＋增 9（probe-binding.mjs、test/probe-integration.test.mjs、vendor/probe-558b9c8/ 六件与 VENDOR-SOURCES.json）；提交自述两步入库，最终四文件命令 339/339、退出 0、guard 232 槽、Node v24.19.0（非裁定首选 v24.22.1，原文已自报） |
| 登记口径 | 有提交 ≠ 执行完成 / Stop-CR2 交付 / 验收通过。仅按提交原文登记其自述内容；不记“已完成”或“已验收” |

### 6.2 既有合成实测（TLS 合成）

- 固定提交 `c9d49b659cecf8ffacba9d86b12e9a1cf7fb895a`（父 `35da2f3`）：合成 TLS pin-before-send 门禁。原报告自述 140/140、264/264、21/21（784 checks）、34/34（5982 断言），四进程退出码均 0，负控零 HTTP 字节；原文明确仅合成范围，真实 TLS/完整 CLI/完整 NT-05/E1-E2 未完成，交独立复审。
- 任务输入所述“TLS 代码与运行证据既有限定通过”仅按来源登记；本执行不自行验收、不复跑。
- 旧 CONTROL-006 FAIL（源自 `f0f23dbb` Windows 补测）保持原样，不改 PASS。

### 6.3 文档更正（脱敏陈述）

- 固定提交 `2234022ad3e5583d4e8eb4567d69bba7bd4f034d`（父为 `c9d49b6`）：撤回原报告第 146 行“broker 源文件审计中的绝对任务工作树路径在脱敏副本改为占位符”的陈述；相对工件 `regressions.broker-memory.stdout.raw` 与 `regressions.broker-memory.stdout.redacted.txt` 逐字节相同（131681 B），五条任务路径实际未替换。
- 收口状态：A 回执未取得 → 按截点保留、待独立收口；不等待、不预填通过，后续由主会话登记。本执行不重做脱敏副本、不重跑采集。

### 6.4 独立验收

| 项 | 登记 |
|---|---|
| CR-1 既有交付 `2712ea7866377d889a78e413fcb7de420b9ad1ab` | 本执行已读原文：262/262、退出 0、Stop-CR1、未参与实现的两路只读独立复审通过；按原文登记，不重判 |
| CR-2 技术裁定 `716b1f0053d5ad34b45fc78d5cf79e5739f2aa36` | 本执行已读原文：前置报告 `1d72602` 有条件通过＋三项勘误 CR2-PF-01/02/03；CR-2 代码基线固定 `2712ea7`；实施后停 Stop-CR2 交 Codex 独立复审，实施方不自批 |
| 新本地 Codex 统一诊断 | 待取得；未取得回执前不引用其内容，不预填通过（UNKNOWN） |

### 6.5 现场诊断

- “现场 TCP 成功 / HTTPS 根不受信任”仅用户转述其他本地会话结果，非本任务实测；本任务未连接设备、未运行测试、未安装、未 HTTP 监听。
- HTTP_STATUS000 不等于账号错误、接口不存在或离线，不据此推断原因。
- 不重派 WindowsACL / 设备诊断 / 供应商 / CR-2；不查看、不污染正在运行的诊断输出。
- CR-2 run `hrun-mwt4lg4d-2f0219`：本执行仅只读登记，未联系、未 steer/cancel/重派。

### 6.6 本执行 Git 动作与核对记录

- 固定起点 `184d6e1` 与来源分支远端 tip 一致（08:37:23 ls-remote，退出 0）；其父链本地完整核对：28 个祖先、最老根 `08d00a59` 无缺失父（共享克隆为浅克隆，边界 `5abfd74` 不在该链上）。
- 目标分支 `docs/requirements-hk-ai-08-status-sync`：上述 ls-remote 未返回该 ref（远端不存在），本执行新建独立分支与独立 worktree `.tmp/requirements-hk-ai-08-status-sync`（起点即固定起点），未移动既有树；非覆盖。
- 证据取件：五个固定提交按完整 SHA 读原文；`2712ea7`/`716b1f0` 本地已有，`72d654a`/`c9d49b6`/`2234022` 于 2026-11-24 08:48:51–08:48:54 +08:00 fetch（退出 0）。
- 早前两次 ls-remote（2026-11-24 02:49:36 起、02:55:05 起）因连接超时失败（exit 128，约 300s），08:37:23 重试成功；失败记录如实保留。
- 本页未写入真实设备地址、凭据、指纹或任务绝对路径；仅引用任务编号与相对工件名。本段自身最终提交 SHA、直接父与推送核对结果由执行回报另报，不预填。
