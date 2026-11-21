# REL-AI-03 既有发布 / 真机 / 恢复 / 回滚证据盘点与缺口表（2026-11-19）

> **性质：只读盘点 + 缺口登记。** 本文不修改实现、既有文档、配置、标签或环境；不连接业务云 / 真实设备；不执行发布、上传、提审、回滚、支付或部署。
>
> 所有结论以**可定位的仓库证据**为准；未取证事项写「未知 / 未验证」，不沿用口头恢复，不把「已计划」写成「已通过」。
>
> 本文不裁决任何门禁，不自批；交付后交 Codex 独立复审。
>
> **2026-11-19 续派修订（v2）**：G4 已由调度方独立验收（来源：云 DISPATCH/REVIEW，本机无正文），状态由「待复审 / 未关闭」更新为「外部裁定称通过（本机未核验）」；本轮未重验，其余缺口与未验证状态不变，未凭推测关闭任何项。

---

## 0. 方法、范围与时间

| 项 | 值 |
|---|---|
| 取证时间 | 首轮 2026-11-19 10:30–10:40；续派核对 2026-11-19 10:55–10:58（Asia/Shanghai） |
| 取证方式 | 只读：`git for-each-ref` / `git ls-tree` / `git show` / `git grep` / `git rev-parse` / `git ls-remote` / 文件系统检索 |
| 检索范围 | 本仓库 45 个本地分支、89 个远端跟踪分支、19 个标签；任务工作树与 `宇宙智联` 工作区文本检索 |
| 网络范围 | 仅 GitHub 仓库的 `git ls-remote` / `git fetch`；**未访问任何业务云、支付、设备或生产端点** |
| 未执行 | 未安装依赖、未运行测试、未构建、未上传、未提审、未发布、未部署、未迁移、未回滚、未连接设备 |
| 结论口径 | 只登记「既有证据说了什么」与「缺什么」；不判断是否可上线 |

### 0.1 关键约束

1. **代码级 / 构建级证据 ≠ 真机证据**：沿用 `REL-AI-01C` §0 口径。
2. **E0 不采纳**：口头、聊天、会议纪要中的「已恢复 / 已验收 / 已上线」一律不进入结论（见门禁卡 §2）。
3. **不重验离线门禁**：G1/G2/G3/O10/G4/07B 按指示只登记既有裁定，不重跑。
4. **不重验即不背书**：登记「继承」不等于本任务确认其正确。

---

## 1. 本会话环境证据（环境事实，非业务验收）

> 本节回答「新会话 pwd / 正确仓库 HEAD / 运行状态 / 连通状态 / 能力」是否有证据。以下全部为 **E1 环境证据**，**不构成**任何业务验收、真机验收或发布许可。本表为首轮（固定输入 `282a20f`）记录；续派（固定输入 `888dc6e`）核对见 §1.2。

| 项 | 实测值 | 命令 / 说明 |
|---|---|---|
| 会话工作目录 | `C:\Users\Administrator\Documents\ChatGPT\宇宙智联\SMART-PM-H3` | 会话 pwd；**不是**任务工作树 |
| 会话工作目录 HEAD | `9fd088da57a1400e4e5fcaaf367b787b2e371dac`（分支 `docs/hk-face-h4-revoke-reconcile-design`） | 只读核对；该工作区另有 1 个无关未跟踪文件 `HK-AI-07D.patch`，**未触碰** |
| 任务工作树 | `C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\release-readiness` | 本任务唯一写入位置 |
| 任务分支 | `docs/release-readiness-followup` | `git rev-parse --abbrev-ref HEAD` |
| 任务 HEAD | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` | 与输入 SHA 一致 |
| HEAD 父 | `36adf0f2e521fc425aed5879c9dbde3b16babbe9` | `git rev-parse HEAD^` |
| HEAD 祖父 | `dcd3b158e4c903b24cd62b80d8dce6aa6229c60c` | `git rev-parse HEAD^^` |
| 工作树状态 | 干净（无修改 / 无未跟踪） | `git status --porcelain=v1 -b` |
| 远端 | `origin` → `https://github.com/<ORG>/SMART-PM.git`（账号名脱敏；仅 `origin`） | `git remote -v` |
| 远端 main | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7`（`fetch` 退出码 0） | 输入未被前移 |
| 目标远端分支 | `refs/heads/docs/release-readiness-followup` **不存在** | `git ls-remote`；本任务首推 |
| 仓库形态 | shallow = `true`；`rev-list --count HEAD` = 18 | 父链只在本地对象范围内可核 |
| Git | `git version 2.55.0.windows.3` | 可用 |
| Node | `v24.19.0` | 可执行 |
| npm | **不可用**：`D:\npm.ps1` 被 PowerShell 执行策略阻止 | 未运行任何 npm 命令；未安装任何依赖 |
| 操作系统 | Windows NT 10.0.19042.0（PowerShell 5.1.19041.1） | 仅记录 |
| 业务云 / 设备连通 | **未尝试、未建立** | 本任务无任何业务端点调用 |
| 仓库服务 / 端口 | **未启动** | 未运行 `server.mjs`、未监听端口、未开 HTTP UI |

### 1.1 环境证据的边界

- 「pwd 正确 / HEAD 正确 / 工作树干净 / 远端可达」只证明**执行环境可用且输入未变**。
- 它**不证明**：代码可发布、真机可运行、云环境正确、设备可用、支付可用、业务可验收。
- npm 不可用表明本会话**不具备**运行仓库测试 / 构建的能力；本任务因此**未执行**任何测试或构建（与任务边界一致，但也意味着不以任何本地测试作为发布依据）。

### 1.2 续派核对（2026-11-19 10:55）

> 目的：核对固定输入 `888dc6e` 与远端 tip，确认能否在上一提交之上追加文档修订。

| 项 | 实测值 | 说明 |
|---|---|---|
| 固定输入 SHA | `888dc6e0bef0ce89a801ada86761cfb643646bff` | 与派单一致 |
| 本地 HEAD | `888dc6e0bef0ce89a801ada86761cfb643646bff` | 未偏离 |
| 远端分支 tip | `888dc6e0bef0ce89a801ada86761cfb643646bff`（`docs/release-readiness-followup`） | `fetch` 退出码 0；**未前移** |
| 远端 main | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` | 未前移 |
| 分叉 / 前移 | **无** | 本地与远端同 SHA，可直接追加提交 |
| 工作树状态 | 干净（无修改 / 无未跟踪） | `git status --porcelain=v1 -b` |
| 云端评审路径 | `/workspace/artifacts/SEVEN-TASKS-REVIEW-2026-11-19` **本机不可访问** | 已探测 `/workspace`、`C:\workspace`、WSL 共享路径、临时目录、文档目录与 `.dsh`，均无正文或副本；具体文件定位**未知** |
| 调度方本轮口径 | E 文档 / F 缺口登记通过、不重派；18/27 预算可采纳（派单原文，本任务未展开其口径）；G3/O10/G4/07B 门禁验收有效，其余冻结有效 | 派单书面表述；评审正文不可访问，未逐条核对 |

**结论**：固定输入与远端 tip 一致，未发生前移或分叉，本轮可在 `888dc6e` 之上追加文档提交；G4 状态按调度方裁定更新，评审正文保持未知，不猜测条目。

---

## 2. 既有证据盘点

> 说明：「适用版本」按文件自身声明的基线判断；「结论」为文件自述，未经本任务重验；「等级」按门禁卡 §2 口径。

| ID | 文件（分支@提交:路径） | 提交日期 | 适用版本 / 基线 | 自述结论 | 等级 | 本任务如何对待 |
|---|---|---|---|---|---|---|
| INV-01 | `docs/LIVE-DEPLOYMENT.md`（`main@282a20f`） | 2026-11-02（提交） | 文中写「交付版本 `v0.1.0-beta.7`」 | 联调步骤与边界说明；明确「未完成步骤不能称为已部署或已联调通过」 | E2（**版本已过期**） | 只作流程参考；**不作为 beta.16/17/18 的验收依据** |
| INV-02 | `REL-AI-01-MINIPROGRAM-EXPERIENCE-DEPLOY-2026-11-09.md`（`docs/lock-01-fast-track@ed7b66f`） | 2026-11-13（提交日期；文件日期 11-09） | 目标 `6e18d04` / `v0.1.0-beta.18-production-test.1` | 任务卡（定义，不是执行结果） | E2 | 作为发布任务定义参考 |
| INV-03 | `REL-AI-01-EXPERIENCE-DEPLOY-REPORT.md`（`release/miniprogram-beta18-experience-report@ecac307`） | 2026-11-14 22:43 | `beta.18-production-test.1` / `6e18d04` | 本地预检 51/51 等通过；上传**本地回显成功**；真机冒烟 **0/8 PASS、0 FAIL、8 BLOCKED**；不满足「可以提交审核」 | E2（平台侧为 E3 缺失） | 唯一现行真机基线；结论仍 `BLOCKED` |
| INV-04 | `REL-AI-01C-SMOKE-EVIDENCE-INDEX-2026-11-14.json`（同上） | 2026-11-14 | 同 INV-03 | 8 条记录全部 `BLOCKED`；`capturedAt` / `evidencePath` 为空；`redacted=true` | E2 | 与 INV-03 一致，无新增证据 |
| INV-05 | `REL-AI-02-HK-FACE-RELEASE-RUNBOOK.md`（`docs/hk-face-release-runbook@db06f8a`） | 2026-11-14 09:49 | `1155b7b`（H4-b 终态） | **草案，待 Codex 复审；默认 NO-GO**；真实 Provider / 设备写 / HTTP 均未实现或未批准 | E2 | 回滚 / 灰度 / 停止条件的上位参考 |
| INV-06 | `REL-AI-02-DELIVERY-REPORT-2026-11-14.md`（同上） | 2026-11-14 09:49 | 同上 | 报告中记录推送 **FAIL**（TLS / 凭据）；但远端分支实际存在同一提交 `db06f8a` | E2（**自相矛盾**） | 只登记矛盾，不宣称「推送已恢复」 |
| INV-07 | `HK-AI-06A-HIKVISION-PROVIDER-EVIDENCE-2026-11-14.md`（`docs/hk-hikvision-provider-evidence@08491fe`） | 2026-11-14 09:53 | `08491fe` | 27 个候选端点；L2 目标 capability **0/27**、L3 真实调用 **0/27**；Q01–Q35 `open` | E2 | 设备层未验证的直接证据 |
| INV-08 | `HK-AI-06B-DEVICE-LAB-PREFLIGHT-2026-11-14.md`（`docs/hk-hikvision-device-lab-preflight@ba95666`） | 2026-11-14 16:34 | `08491fe`（06A） | 现场准备与安全门禁设计；**0 连接 / 0 API / 0 人员 / 0 人脸 / 0 权限**；G1–G4 `not_requested` | E2 | 设备实验室门禁与证据模板参考 |
| INV-09 | `HK-AI-01-EVIDENCE-MATRIX.md`（`docs/hk-live-day-checklist@071148f`） | 2026-11-07 11:44 | ISAPI 文档阶段 | 文档阶段完成；**等待目标设备 capability 与真人证据** | E2 | 设备能力仍未验证的旁证 |
| INV-10 | `HK-AI-02-LIVE-DAY-CHECKLIST-A4.md`（同上） | 2026-11-07 11:44 | 只读 6 个 GET | 一页清单（勾选 / 签字模板）；**无执行记录** | E2（模板，不是执行证据） | 未来设备只读用例的参考 |
| INV-11 | `HK-AI-07B-OFFLINE-INTEGRATION-GATE-EVIDENCE-2026-11-18.md`（`feat/hk-face-07b-offline-gate@1be517e`） | 2026-11-18 18:43 | `cc4ec7b` / 生产基线 `8ff350d` | IG01–IG08 全 PASS；未合并 `59a737a` | E2 | **继承，不重验** |
| INV-12 | `HK-AI-07D-G1/G2/G3` 证据（`docs/hk-face-07d-g4-review-task@5f1d7a4`） | 2026-11-16 / 11-17 | G1–G3 | G1 实施完成、G2 合并态 `b3a41ea` 复审通过（**验收报告本机不可读，结论为用户转述，待 Codex/记录副本确认**）、G3 90 ID + O10 PASS（验收指针 `5f1d7a4`） | E2 | **继承，不重验** |
| INV-13 | `HK-AI-07D-G4-COMPATIBILITY-EVIDENCE-2026-11-18.md`（`feat/hk-face-g4-compatibility-review@49c5f79`） | 2026-11-18 18:38 | G4 | 证据已提交；**调度方 2026-11-19 独立验收通过**（依据云 DISPATCH/REVIEW；本机无正文、具体定位未知）；本轮未重验 | E2 + 调度方裁定（正文不可访问） | **继承；G4 外部裁定称通过（记录正文不可定位，本机未核验，待 Codex/记录副本）** |
| INV-14 | 标签 `v0.1.0-beta.16` / `beta.17-preview.1` / `beta.17-demo.1` / `beta.18-production-test.1` | 11-02 / 11-03 / 11-03 / 11-04 | 各标签 | 标签存在且指向固定提交（annotated tag） | E2 | 版本锚点 |
| INV-15 | `CHANGELOG.md` `beta.17-preview.1` 条目（`release/miniprogram-preview-beta17@a8c469f`） | 2026-11-03 | `beta.17-preview.1` | 写明「用于微信开发者工具编译、扫码预览和**体验版测试**」；**未记录上传结果 / 平台版本 / 真机证据** | E2（意图，不是结果） | beta.17 状态判定依据 |

### 2.1 未找到的报告类型

| 类型 | 检索结果 |
|---|---|
| 名为 `OPS-AI-01` / `OPS-AI-01B` 的环境恢复报告 | **0 命中**（全部 refs + 工作区文本检索） |
| 名为 `REL-AI-01C` 的独立报告 | **0 个独立文件**；仅作为 `REL-AI-01-EXPERIENCE-DEPLOY-REPORT.md` 的 §10 追加内容存在 |
| beta.17 的体验版上传 / 真机冒烟报告 | **0 个** |
| 名为「环境恢复」的独立报告 | **0 个**；仅有设计性回滚 / 无残留条款（INV-05 §7、INV-08 §9），均未执行 |
| 支付相关发布 / 回滚证据 | **0 个**（本次检索范围内） |

---

## 3. 指定事项重新取证

### 3.1 OPS-AI-01 / OPS-AI-01B

| 项 | 结论 |
|---|---|
| 仓库证据 | **无**：45 个本地分支、89 个远端跟踪分支、19 个标签的工作树内容检索均无 `OPS-AI`；提交信息检索亦无 |
| 历史状态 | **未知** |
| 口头「已恢复」是否采纳 | **否**：无 E2 / E3 证据，按门禁卡 §2 记为未验证 |
| 对门禁的影响 | PG-06（环境清单与隔离）、PG-07（回滚锚点）无法关闭 |
| 停止点 | 在发布指挥提供可复核报告（含时间 / 环境代号 / 操作 / 结果）之前，不得以「环境已恢复」为前提进入任何层 |

> 说明：本任务**不否定**该任务可能在其他系统 / 其他仓库执行过；本文只陈述「本仓库与本次检索范围内无证据」。若报告存在于代码仓库之外，须由发布指挥提供可复核副本，另行复审。

### 3.2 REL-AI-01C

| 项 | 结论 |
|---|---|
| 定位 | `release/miniprogram-beta18-experience-report@ecac307`；报告 §10；证据索引 blob `8a4a738767a9bf63219b71761bcabf0367313507` |
| 记录结论 | 体验版 `0.1.0-beta.18-production-test.1`；真机冒烟 **0/8 PASS、0 FAIL、8 BLOCKED**；授权测试人员 / 设备 / 微信版本均未提供；上一体验版回退锚点待补录 |
| 本次新增证据 | **无**：分支 tip 仍为 `ecac307`（2026-11-14），未发现 11-14 之后的新增验收提交 |
| 当前状态 | **BLOCKED**（维持原结论，不「恢复」） |
| 对门禁的影响 | PG-10 无法关闭；PG-15 不得给出 GO |
| 停止点 | 需授权人员本人登录 + 8 项逐项 E3 证据 + 回退锚点补录，才可重新提交复审 |

### 3.3 beta.17 历史状态

| 项 | 结论 |
|---|---|
| 标签 | `v0.1.0-beta.17-preview.1` → `a8c469f`（2026-11-03）；`v0.1.0-beta.17-demo.1` → `6527a76`（2026-11-03，父提交 `a8c469f`） |
| 版本号 | `miniprogram/config/version.json` 分别为 `0.1.0-beta.17-preview.1`（channel「小程序预览版」）与 `0.1.0-beta.17-demo.1`（channel「离线测试数据版」） |
| CHANGELOG 表述 | preview 条目称「用于…扫码预览和体验版测试」；demo 条目为离线预览；**均无上传结果、无平台版本、无真机证据** |
| 可证明的事实 | 标签 / 版本号 / 提交谱系存在；preview 与 demo 是两种不同用途的制品 |
| 不可证明的事实 | 是否上传过体验版、是否被设为体验版、是否有人真机扫码、是否通过任何验收 |
| 历史状态判定 | **未验证**（不是「已上线」，也不是「已失败」） |
| 对门禁的影响 | beta.17 不能作为回滚锚点或「曾经可用」的依据；PG-02 / PG-07 仍需发布指挥选定版本 |

### 3.4 beta.18 补充

| 项 | 结论 |
|---|---|
| 提交 / 标签 | `6e18d04` / `v0.1.0-beta.18-production-test.1`；父提交 `a8c469f`（即 beta.17-preview），**不是** `main` |
| 上传 | 报告记录 `cli upload` **本地回显成功**（2026-11-14 17:45 +0800）；**平台显示版本 / 时间未确认** |
| 冒烟 | 8/8 `BLOCKED` |
| 回退锚点 | 冻结 ZIP / SHA-256 / commit / tag 有记录；平台上一体验版锚点**缺失** |
| 结论 | 「已上传（本地回显）」可记录；「平台生效 / 可回退 / 可验收」均**未验证** |

### 3.5 REL-AI-02 推送状态

| 项 | 结论 |
|---|---|
| 报告记录 | `db06f8a` 的交付报告 §3.3 写「推送 FAIL（本机 TLS / 凭据不可用）」 |
| 远端事实 | `git ls-remote origin refs/heads/docs/hk-face-release-runbook` 返回 `db06f8ab90679b9d9f2384b98d28255dd0681431`（2026-11-19 取证） |
| 矛盾 | 报告称「未推送」，但包含该报告的同一提交已在远端 |
| 解释边界 | 不排除后续由其他执行者补推；**本任务无法确定**推送时间、执行人与授权 |
| 处理 | 记「远端存在 + 报告状态过期」，不宣称「推送失败已恢复」，也不据此认定流程合规 |
| 对门禁的影响 | 证据链完整性存疑；PG-03 / PG-15 复审时需说明 |

### 3.6 设备实验室（H 层）

| 项 | 结论 |
|---|---|
| 06A | 27 个候选端点；L2 / L3 均 0/27；Q01–Q35 `open` |
| 06B | 只读 R1–R6、写 W1–W7、停止 S01–S12、回滚 RB-01–RB-09 均为**计划**；执行数 0 |
| 设备身份 | 完整型号 / 固件 / 硬件版本 / 区域均未取得；`capability` 结论全部 `unknown` |
| 结论 | 设备层**完全未验证**；不得以任何其他层证据替代 |

### 3.7 离线门禁（继承，不重验）

| 门禁 | 既有结论 | 状态 |
|---|---|---|
| G1 | 实施完成 + P2 修复；被 G2 证据引用为验收提交 `4f9c43d` | 继承 |
| G2 | 合并态 `b3a41ea` 独立复审通过（验收报告本机不可读，结论为用户转述） | 继承 |
| G3 + O10 | 90 ID 达判据、O10 PASS、G3 关闭（验收指针 `5f1d7a4`） | 继承 |
| G4 | 外部裁定称通过（调度方独立验收 2026-11-19；来源云 DISPATCH/REVIEW，本机无正文，未核验） | 继承；**未核验，open（待 Codex/记录副本）** |
| 07B | IG01–IG08 全 PASS；未合并 `59a737a` | 继承 |

**注意**：以上为文件自述与后续证据的引用关系；本任务未运行测试、未复算、未逐行复核，不为其正确性背书。

**G4 更新（2026-11-19 续派）**：G4 状态由「待复审 / 未关闭」改为「外部裁定称通过（本机未核验）」，依据为调度方独立验收裁定（云 DISPATCH/REVIEW `/workspace/artifacts/SEVEN-TASKS-REVIEW-2026-11-19`）；本机无法访问评审正文，**具体文件定位未知**；本任务未重跑 G4、未复核其证据。**在取得可定位记录（文件名/作者/时间/哈希）并经 Codex 核验前，G4 项保持 open/unverified，不据此解除 PG-03 阻塞。** G1/G2/G3/O10/07B 记录不变，其余冻结（S4、预签约 S2、`main` / 07B 合并与实施、HTTP/UI、支付、设备、部署）不变。

---

## 4. 证据缺口表

> 状态：`open`（缺口存在）/ `partial`（部分证据）/ `blocked`（被外部条件阻塞）。责任角色全部 **待定**。

| ID | 缺口 | 影响门禁 | 需要的证据（最小） | 责任角色 | 状态 | 停止点 |
|---|---|---|---|---|---|---|
| GAP-01 | `OPS-AI-01` / `01B` 无任何仓库证据 | PG-06 / PG-07 | 报告（时间 / 环境代号 / 操作 / 结果 / 证据哈希） | 发布指挥（待定） | `open` | 不得假设环境已恢复 |
| GAP-02 | beta.17 无上传 / 平台 / 真机证据 | PG-02 / PG-07 | 平台版本页（脱敏）+ 上传时间 + 设备 / 微信版本 | 测试账号持有人（待定） | `open` | 不得以 beta.17 作回滚锚点 |
| GAP-03 | REL-AI-01C 真机 8 项全 BLOCKED | PG-10 / PG-15 | 8 项逐项 E3 证据（截图 / 录屏 + 时间 + 设备 + 版本） | 真机执行人（待定） | `blocked` | 不得进入发布审批 |
| GAP-04 | 授权测试人员 / 设备 / 微信版本未提供 | PG-05 / PG-10 | 书面指定 + 设备型号 / 系统 / 微信版本 | 项目负责人（待定） | `open` | 真机部分立即停止 |
| GAP-05 | 上一体验版回退锚点未补录 | PG-07 / R-01 | 版本号 + 上传时间 + 是否可切换 + 平台状态 | 测试账号持有人（待定） | `open` | 不得声称可回退 |
| GAP-06 | 平台当前版本 / 上传时间未确认 | PG-09 / PG-10 | 平台版本页（脱敏） | 测试账号持有人（待定） | `open` | 上传成功≠平台生效 |
| GAP-07 | 实时 Network / Console 未采集 | PG-10 | 真机抓包 / 控制台记录（脱敏） | 真机执行人（待定） | `open` | 不得据此断言无未知域名 |
| GAP-08 | 发布对象 / 版本未冻结 | PG-02 | 唯一 tag + commit + 制品 SHA-256 | 发布指挥（待定） | `open` | 不得进入 Stage 2 之后 |
| GAP-09 | 平台回滚能力未知 | PG-07 / R-01 | 平台「版本管理」能力确认 | 测试账号持有人（待定） | `open` | 只能按「重新上传冻结包」预案 |
| GAP-10 | 云函数远端版本 / 回退点未知 | PG-09 / R-03 | 函数列表 + 版本快照 + 导出记录 | 云管理员（待定） | `open` | 本次无法执行 R-03 |
| GAP-11 | 配置快照（名称 / 版本 / fingerprint）未知 | PG-06 / R-04 | 配置清单（不含密钥值） | 云管理员（待定） | `open` | 本次无法执行 R-04 |
| GAP-12 | 测试云环境清单与隔离证据缺失 | PG-06 / PG-09 | 环境代号 + 网络拓扑（脱敏）+ 隔离核验 | 云管理员 + 网络安全（待定） | `open` | 不得进入 C 层 |
| GAP-13 | 数据备份 / 恢复未验证 | PG-07 / R-05 | 备份报告 + 恢复演练记录 | DBA（待定） | `open` | 本次无法执行 R-05 |
| GAP-14 | 设备 capability 0/27；Q01–Q35 open | PG-11 | 06B G1 R1–R6 证据 | 设备实验室负责人（待定） | `blocked` | 设备层保持关闭 |
| GAP-15 | 设备实验室网络 / 审批 / 账号未提供 | PG-06 / PG-11 | G1 审批单 + 隔离网核验 + 专用账号 | 设备实验室负责人（待定） | `open` | 不得连接设备 |
| GAP-16 | 支付范围与证据缺失 | PG-12 / R-07 | 范围书面确认；若在范围则需沙箱流水 / 对账 | 支付负责人（待定） | `open` | 不得默认「不需要支付门禁」 |
| GAP-17 | 全部责任角色未指定 | PG-05 | 角色清单 + 书面授权 | 项目负责人（待定） | `open` | 不得开始任何门禁 |
| GAP-18 | 证据包 / 脱敏 / 保管人未定 | PG-08 | 字段清单 + 脱敏规则 + 保管人与期限 | 安全 / 隐私（待定） | `open` | 不得采集 E3 |
| GAP-19 | G4 验收记录正文不可访问（状态已按调度方裁定更新为通过；具体文件未知） | PG-03 / PG-15 | 评审记录副本或可访问路径（含文件清单） | 调度方 / Codex 复审 | `open` | 复审时须补记录副本；不得据此推断其他门禁闭合 |
| GAP-20 | REL-AI-02 推送状态自相矛盾 | PG-03 / PG-15 | 补推记录或说明 | 发布指挥（待定） | `open` | 复审时需解释 |
| GAP-21 | 证据时效：多数为 11-07～11-14 | 全部 | 最新复核时间戳 | 各责任角色（待定） | `open` | 旧证据只作历史，不作当日结论 |
| GAP-22 | C 层真实云只读未在本次执行 | PG-09 | 只读核对记录（时间 / 环境代号 / 结果） | 云管理员（待定） | `open` | 不得以 11-14 记录代替当日事实 |

### 4.1 缺口统计

| 状态 | 数量 |
|---|---|
| `open` | 20 |
| `blocked` | 2 |
| `partial` | 0 |

> 计数以本表 22 行为准；`blocked` 指被外部条件（授权 / 设备 / 平台）阻塞，不是「无法解决」。
>
> **本轮变更**：GAP-19 由「G4 未关闭」改为「G4 验收记录正文不可访问」——G4 状态本身已按调度方书面裁定更新为「已通过」，不再是缺口；缺口总数与状态分布不变。

---

## 5. 证据来源索引

> 路径格式：`分支@提交:路径`；blob SHA 用于固定文件内容。标签为 annotated tag，另注 tag 对象 SHA。

| 引用 | 分支@提交 | 路径 | blob / tag SHA |
|---|---|---|---|
| SRC-01 | `main@282a20f` | `docs/LIVE-DEPLOYMENT.md` | `ae38ab4e842e52cdd093a1a79d585755dcafc7b0` |
| SRC-02 | `docs/lock-01-fast-track@ed7b66f` | `docs/tasks/REL-AI-01-MINIPROGRAM-EXPERIENCE-DEPLOY-2026-11-09.md` | `d05045166907697a8481fa5dc54f5daecfaaba44` |
| SRC-03 | `release/miniprogram-beta18-experience-report@ecac307` | `docs/tasks/REL-AI-01-EXPERIENCE-DEPLOY-REPORT.md` | `99cbe4b5c854236f6f515449cfdb2ebf95e60ce6` |
| SRC-04 | 同上 | `docs/tasks/REL-AI-01C-SMOKE-EVIDENCE-INDEX-2026-11-14.json` | `8a4a738767a9bf63219b71761bcabf0367313507` |
| SRC-05 | `docs/hk-face-release-runbook@db06f8a` | `docs/tasks/REL-AI-02-HK-FACE-RELEASE-RUNBOOK.md` | `e33ab665a97a15258de0bb20f5cb73ae7835831e` |
| SRC-06 | 同上 | `docs/tasks/REL-AI-02-DELIVERY-REPORT-2026-11-14.md` | `907f94a55df28f2e8d79002d985321c4ae793049` |
| SRC-07 | `docs/hk-hikvision-provider-evidence@08491fe` | `docs/tasks/HK-AI-06A-HIKVISION-PROVIDER-EVIDENCE-2026-11-14.md` | `05ae181705813b0c7ec06f1ec9e879875a50fc97` |
| SRC-08 | `docs/hk-hikvision-device-lab-preflight@ba95666` | `docs/tasks/HK-AI-06B-DEVICE-LAB-PREFLIGHT-2026-11-14.md` | `1528040de912d9cd0b6d1d5c20d7a2b84f4c5e7c` |
| SRC-09 | `docs/hk-live-day-checklist@071148f` | `docs/tasks/HK-AI-01-EVIDENCE-MATRIX.md` | `f83af4fe3b90b8f984cf731039685ba8807fcec7` |
| SRC-10 | 同上 | `docs/tasks/HK-AI-02-LIVE-DAY-CHECKLIST-A4.md` | `4cd49170cac120118486bd6637ad3ab4de4be300` |
| SRC-11 | `feat/hk-face-07b-offline-gate@1be517e` | `docs/tasks/HK-AI-07B-OFFLINE-INTEGRATION-GATE-EVIDENCE-2026-11-18.md` | `5970fe17afb575912c45083bdaf37f55ba58c5fc` |
| SRC-12 | `docs/hk-face-07d-g4-review-task@5f1d7a4` | `docs/tasks/HK-AI-07D-G1-LEGACY-REQUEUE-CLOSURE-EVIDENCE-2026-11-16.md` | `01b2ff3b5f4d5126fbcac961e916445e85362034` |
| SRC-13 | 同上 | `docs/tasks/HK-AI-07D-G2-STRICT-RETRY-EVIDENCE-2026-11-16.md` | `9f6b458571fcc1b0df29e9a3ee2cb629dd08fe70` |
| SRC-14 | 同上 | `docs/tasks/HK-AI-07D-G3-MATRIX-EVIDENCE-2026-11-17.md` | `7d7e1405507b6040582d8c3578e287a92050e6c3` |
| SRC-15 | `feat/hk-face-g4-compatibility-review@49c5f79` | `docs/tasks/HK-AI-07D-G4-COMPATIBILITY-EVIDENCE-2026-11-18.md` | `527f991cf1aaeddcea845d822559387fde1acc93` |
| SRC-16 | `release/miniprogram-preview-beta17@a8c469f` | `CHANGELOG.md` | `2b024dfeeb7e60008860ce1f867be758af4c9221` |
| SRC-17 | 同上 | `miniprogram/config/version.json` | `d3f6783360a58cc208db725bd344b2c8e327e156` |
| SRC-18 | `release/miniprogram-demo-beta17@6527a76` | `miniprogram/config/version.json` | `b2fa91a4b40db44464106699f67b00d137f62584` |
| TAG-01 | `refs/tags/v0.1.0-beta.16` | annotated tag | `1b1bfa3c896017c42c499a2b2c123c29b75990fd` → `282a20f` |
| TAG-02 | `refs/tags/v0.1.0-beta.17-preview.1` | annotated tag | `bf583bb859d49bb4382fbc77b78b9b437d717150` → `a8c469f` |
| TAG-03 | `refs/tags/v0.1.0-beta.17-demo.1` | annotated tag | `7cd4b38ea160fd20df04cbf1352a9c25dfc05158` → `6527a76` |
| TAG-04 | `refs/tags/v0.1.0-beta.18-production-test.1` | annotated tag | `c63b863650d77e2ff4c64fe0cf7b8470729c0d14` → `6e18d04` |

### 5.1 引用规则

1. 所有引用以 `分支@提交:路径` + blob SHA 固定；仅给分支名不算可复核。
2. 远端分支若后续前移，以本文记录的提交为准，不自动跟随。
3. 标签为 annotated tag：引用 tag 对象 SHA，并注明其指向的提交。

---

## 6. 未验证清单（汇总）

| # | 事项 | 状态 |
|---|---|---|
| 1 | OPS-AI-01 / 01B 环境恢复 | 未知（无证据） |
| 2 | beta.17 体验版上传 / 真机 | 未验证 |
| 3 | beta.18 平台生效 / 平台版本 / 上传时间 | 未验证 |
| 4 | REL-AI-01C 真机 8 项 | BLOCKED（0/8） |
| 5 | 上一体验版回退锚点 | 未知 |
| 6 | 云函数回退点 / 配置快照 / 数据备份 | 未知 |
| 7 | 设备 capability / 设备实验室执行 | 0 / 未执行 |
| 8 | 支付 | 未知（范围亦未定） |
| 9 | 发布对象 / 版本冻结 | 待定 |
| 10 | 角色 / 授权 | 全部待定 |
| 11 | G4 复审 | 外部裁定称通过（调度方独立验收；本机无正文，未核验；待 Codex/记录副本） |
| 12 | 任何回滚 / 演练 | 未执行 |

---

## 7. 结论边界

- 本文**不给出**任何「可以发布」「可以上线」「已验收」「已恢复」的结论。
- 本文只回答：**现有证据是什么、在哪里、说了什么、缺什么**。
- 所有缺口关闭都需要可定位证据（E2 / E3，或调度方书面裁定并注明来源与访问范围）与书面批准；口头说明、无法定位的记录不构成完整关闭。
- 本文与门禁卡、回滚卡一并提交，交 Codex 独立复审；复审意见可能推翻本文任何登记。

---

## 8. 变更记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v1 | 2026-11-19 | 初版：环境证据、15 项盘点、7 项重新取证、22 项缺口、18 项来源 + 4 个标签索引 | 本任务执行人 |
| v2 | 2026-11-19 | 续派修订：G4 更新为「外部裁定称通过（调度方独立验收；本机无正文，未核验）」；新增 §1.2 续派核对；INV-13 / §3.7 / §6 / GAP-19 同步；缺口统计与其余未验证状态不变 | 本任务执行人 |
| v3 | 2026-11-21 | 独立复审回写：G4 改为「外部裁定称通过（本机未核验）」，PG-03 该项 open/unverified、不据此解除阻塞；G2 验收报告本机不可读加注；冻结范围补 S4/预签约 S2/HTTP/UI/支付/设备/部署；INV-02 日期改提交日期 | 本任务执行人 |
---

## 8. 2026-11-21 状态同步（S2/S3 已关闭、S4 已实施待复审）

> 本节仅同步门禁状态，不裁决门禁、不自批、不表示可上线。

| 门禁 | 状态 | 证据 |
|---|---|---|
| S2 Stop-2 | **ACCEPTED / CLOSED（外部裁定）** | `fd4bf4e`（H4-c C1 S4 前置清单）记载：`923dbf1`，53/53 + guard 8/8，Store/路由/生产接线零差异 |
| S3 Stop-3 | **ACCEPTED / CLOSED（外部裁定）** | 同上：`49ca13ec`，66/66 + guard 8/8；隐藏/Symbol 字段拒绝 `ADMISSION_REQUIRED`/409；网络/监听/Provider 计数 0 |
| S4 | **已实施，待 Codex 复审（并非通过）** | 分支 `feat/h4c-c1-s4` @ `6d2b3f0`，基线 `49ca13ec`；相对基线 5 文件 +932/−34；本机实跑 C1 定向 **92/92**、D10-A **15/15**、D10-B **12/12** |
| S4 未覆盖 | M02、M28、M29、M30b；33+7 全量、8 个 HTTP 文件、真实 Cloud 并发（D11）、UI/设备/支付/部署 | 均未执行，未声称通过 |

补充事实（2026-11-21 取证）：

- `codex/07d-g1-p2` @ `b5e7b97`（G1 前置守卫 + P2 证据，3 文件 +248/−71）此前仅存本地，已推送 `origin/codex/07d-g1-p2`。
- 本地 65 个分支中 60 个有同名远端；其余 5 个的提交已在其它远端分支上（`c075229`、`2054404`、`f2bb6de`）或属备份分支（`backup/h2d-local-13a439f`）。
- worktree 共 67 个：61 个 HEAD 已在远端且无未提交改动（可回收），6 个需人工确认（3 个 review 目录含未跟踪复审产物、主仓与 `SMART-PM-H3` 为在用目录）。
