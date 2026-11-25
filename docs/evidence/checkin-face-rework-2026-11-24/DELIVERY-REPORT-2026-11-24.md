# SMART-PM 入住与人脸四路退修：lead 交付报告（2026-11-24）

- 任务键：`CHECKIN-FACE-REWORK-0d6c674`；任务包提交 `f5e2a83174bdca7356a58d90079ed49fa8dd6a25`（父链：f5e2a831 → 24c6140f → 0d6c674…，cat-file 全链 commit 校验通过）。
- 实施基线：`0d6c674a04b224025c8640628122f27c34e8df0f`；复审固定对象：`24c6140f2c0b4942825274d1b722e520f209c96e`（CODEX-REVIEW-2026-11-24.md 全文已按固定对象读取）。
- 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\SMART-PM-H3\_rework-tree`，分支 `fix/checkin-face-review-2026-11-24`（新建，基线追加；远端此前无同任务修复分支，候选 tip 未前移）。
- 执行者：Harness `lead`（session-039bc489-353a-4ec6-86f9-ec8f5b1bd17e）；四路为 dsh-baton 实际派发的独立 Harness 执行会话（每路收到完整 UTF-8 COMMON + 卡正文 + 固定复审路径，非链接/摘要）。

## 1. 四路真实派单与执行（run_id / session_id 均为 dsh-baton 实查）

| 路 | 首次派单 run | 会话 | 续跑/对齐 run | 交付 |
|---|---|---|---|---|
| A 云端 | hrun-mwupoiq1-ca73f1 | session-ffa401ab-9a78-4d66-9432-6a942a5bfc83 | hrun-mwuqov0o-aab021 | 完成 |
| B 小程序 | hrun-mwups9u4-1b8da4 | session-4fe740d1-7cd4-4fe4-9e9a-2e24d11bb4ce | hrun-mwuqovby-345495、hrun-mwurioo2-2f01b6 | 完成 |
| C worker | hrun-mwupoj4e-fb1557 | session-2b790c51-3bda-4960-ad63-75ceb6156d9f | hrun-mwuqptg5-9aaa15、hrun-mwurip5f-ce61ea | 完成 |
| D QA 门禁 | hrun-mwupsa8q-831979 | session-9bded923-9b6e-4d07-a19e-f9165a17da61 | hrun-mwuqptp9-c10c26、hrun-mwuripne-b91eaf、hrun-mwus4kqr-4bc98e | 完成 |

（Harness 曾重启：各路中断 run 均如实记录，续跑未重做已有编辑；沙箱策略中途放开后统一在共享树内并行编辑，文件归属隔离，git 写入由 lead 独占。）

## 2. 四路目标与结果（按卡）

- **A**：R01（真实 SDK `cloud://` fileID 正向贯通+可信命名空间/对象路径/本人本申请绑定+公开管理员配置路径，配置缺失失败关闭）、R03（txStore 全方法事务上下文，业务写+audit 同事务回滚，`TX_UNSUPPORTED_QUERY` 护栏）、R04（create-only 原子首建，晚到创建者 `TASK_ALREADY_CLAIMED`，revision 单调，employeeNo 不变）、R06 服务端复核（beginTaskExecution：五字段白名单、事务内权威复核、CLAIMED→DEVICE_PROCESSING 原子推进 revision+1、闭式错误码全表）。交付 13 文件（含 `cloudfunctions/checkinFaceTest/lib/INTERFACES.md` 唯一接口清单 18905 字节）。测试：cloud-workflow **34/34**、config **16/16**，exit 0；guard 计数 0；负控 NC-1..4（裸路径/tx 回落/晚到覆盖/过期复核）均 exit 1 命中。
- **B**：R02（两页真实 checkbox-group bindchange 接线）、R11/C2（仅 auto_approved+有效 applicationId 展示受理与人脸入口；pending_review/空/畸形/未知 → 原审核渠道；撤名单竞态零上传/零建任务/零入口）、R01 衔接（fileID 原样透传、storageNamespaceConfigured 前置、REVIEW_CHANNEL_CODES 收敛为 §5 三码）。交付 7 文件。测试：api+pages **30/30**，exit 0；guard 13 进程计数 0；负控 5/5。
- **C**：R05（deviceKey 双非空精确一致，缺/异零执行）、R06 本侧（时效三检+verifyAuthorizedSnapshot 14 字段+§2.4 全部 19 服务端码透传映射 BEGIN_AUTH_REJECTED:<码>，零执行/不重领/report 推进后 revision）、R07（worker 自有 package+lock，@cloudbase/node-sdk 3.18.7 锁定，默认解析失败关闭）、R08（内存照片适配层 enrollment-adapter.mjs，保留旧装配语义，待 Codex 内容复审）、R09（清理入终态）。交付 14 文件。测试：worker 四套件 **45/45**，exit 0；guard 计数 0；负控 nc-r05/06/07/09 全部命中；正例执行器恰 1 次、拒绝 0 次。
- **D**：R10（mode=device 与 validityMode=fixed 分别断言+构造处锚定+注释剔除，单项移除负控精确失败）、C1（`scripts/verify-checkin-face-sources.mjs` 实读清单机器校验接入 `check:checkin-face`；清单统一复算 **107 条**，baselineSha256 零伪造）、独立跨模块回归+guard（预载/自检不转发/命名绑定/子进程继承）。测试：qa-gates **18/18**、cross-module **19/19**（8 个 A 接口依赖用例按清单对齐后实测通过）、合并 37/37，exit 0；负控 13/13。

## 3. lead 集成冻结复跑（提交前实测，Node v24.19.0 / win32）

| 命令（guard 预载） | 结果 |
|---|---|
| 原五文件 `node --require tests/support/d-network-guard.cjs --test …` | **97/97 pass，exit 0**（基线时 59/59） |
| 新增无监听套件（qa-gates+cross-module+worker×3） | **65/65 pass，exit 0** |
| `node scripts/checkin-face-static-check.mjs` | 102 files / 0 violations，exit 0 |
| `node scripts/verify-checkin-face-sources.mjs` | 107 entries hash-verified，exit 0 |
| `npm.cmd run check:checkin-face` | exit 0 |

## 4. 提交链与远端核对

- 4 笔追加提交（普通提交，无 amend/rebase/reset/squash/force/merge/cherry-pick）：
  1. `fbbf9d5` fix(face): A-lane cloud upload contract, tx boundaries, atomic create and beginTaskExecution recheck
  2. `541bce5` fix(face): B-lane miniprogram checkbox wiring and review-channel gating
  3. `8ffd98b` fix(face): C-lane worker deviceKey, authorization freshness, deps and photo handling
  4. `d85b618` test(face): D-lane QA gates, source verifier, cross-module regression and source hashes
- 推送：`git push origin HEAD:refs/heads/fix/checkin-face-review-2026-11-24`（新建远端分支，普通显式 refspec）。
- 核对：`git ls-remote --heads origin refs/heads/fix/checkin-face-review-2026-11-24` = `d85b61835a214afb625e877c37575e636094f873` = 本地 HEAD，完全一致；工作树干净。

## 5. diff --check / git show --check 实值（如实记录）

- `git show --check`：fbbf9d5=69、541bce5=282、8ffd98b=199、d85b618=66；全部为 trailing-whitespace 报项，且**全部集中在四个基线即为 CRLF 的文件**（checkin-face-config.test.mjs / checkin-face-pages.test.cjs / checkin-face-worker.test.mjs / checkin-face-static-check.mjs），属行尾 CR 的既有仓库形态（基线 tip 0d6c674 自身 show --check 亦有 32 项同类报项）；其余全部文件 0 报项。
- `git diff --check 0d6c674..HEAD` 合计 616 项 = 上述四文件之和，无其他文件。
- 行尾说明：本分支按逐文件匹配基线行尾（LF 基线文件提交 LF，CRLF 基线文件提交 CRLF）；例外为 `tests/checkin-face-cloud-workflow.test.cjs`（基线 CRLF，A 路提交为 LF，内容经测试全绿，作为已知外观偏差记录，不影响执行与哈希清单——清单按 CRLF→LF 归一复算）。

## 6. 实测 / 未验证 / 阻断

- 实测：§2/§3 全部命令、退出码、计数、负控、哈希复算（107 条）、ls-remote 核对。
- 未验证（如实，不以合成冒充）：真实腾讯 fileID 命名空间形态与 % 编码（INTERFACES §1.6）；真实 CloudBase 事务点读/写与冲突重试（§3.3，含 102 唯一性 count 在事务内不可用的已知边界）；真实设备执行、微信开发者工具上传、真机、CloudBase 实测；worker 依赖真实 npm 装配（仅失败关闭路径）；`enrollment-adapter.mjs` 待 Codex 内容复审；D 路 8 个 A 接口依赖用例的 `[待集成]` 诊断标记待 Codex 确认收口；`git show --check` 的 CR 报项性质见 §5。
- 阻断：无（四路全部完成并按卡交付）。
- 停止点：**交独立 Codex 复审，本报告不自批**。未上传体验版、未部署、未连接设备、未开放 HTTP/UI、未支付/开门、未跑真实 worker CLI/E1/E2/旧 246 项；未推 main；未改全局/系统 Git/TLS/代理/安全配置；门禁诊断与 CR2 工件未触碰。

---

## 7. 状态补充（2026-11-25 Asia/Shanghai）：四路退修最终收口结论登记

> 本节为**登记**主会话 Codex 最终裁定（登记时间 2026-11-25，Asia/Shanghai），保留自 2026-11-24 起的全部历史记录与时间截点；**不是本 Harness 本轮重跑实测**，也不改变上文各节当时记录的实测口径。

### 7.1 结论

四路退修可按**代码修复及静态/合成门禁**阶段性收口，当前无已知未修代码阻断；**不等于**全部旧 Windows 执行证据完整、真实环境验证通过或批准发布。已关闭项不再重复修。

### 7.2 CF01～10 / CF13（72fe242 静态接受，非本轮实测）

- 范围：CF01 命名空间/配置竞争；CF02 配置 CAS 与版本竞争；CF03 begin 前成功上报/终态及回执约束；CF04 设备计划指纹绑定；CF05 来源与正式发布检查门禁；CF06 claim 截止等号边界；CF07 worker 身份合法非空/绑定；CF08 begin 后 revision 与失败上报引用；CF09 证书路径字面保留；CF10 撤权后页面状态保护；CF13 跨模块执行器计数接线。
- 状态：均已在 `72fe242556aea604473281dc52b45837155fa43a` 由原三路云端 Codex **最终静态复审接受**（来源任务 `r2_cloud_closure_review` / `r2_worker_closure_review` / `r2_gate_closure_review`）。
- 口径：仅登记**静态接受**，不写作本次 Harness/本地 Codex 重跑实测；其后未改动已接受业务实现。

### 7.3 CF11（750809c 最终独立复审 PASS，原 P2 关闭）

- 代码验收固定对象 `750809c545f4b83a0ab12193310314efff8fcc9e`（父 `99639630e944120eb68877dccb873392deb71fcd`）。
- 独立聚焦 51/51（失败 0、跳过 0）+ 仓库外独立 35/35 正负探针；覆盖条件/箭头/块体箭头序列前项、点/下标、括号左值/基对象、数组/对象多目标/嵌套解构，及合法 photoPath/planTemplateNo 与只读对照。
- 静态 102 source / 0 violations；来源校验 189 条；完整远端 SHA、直接父链、两个 `git show --check`、增量 `git diff --check` 通过，工作树干净。
- 口径：以上为 **Codex 此前独立结果**，非本轮执行。

### 7.4 CF12（10963dd 独立合成复审接受，不重开）

- 在 `10963ddb0d62bb168ecf81a6cf03b909107a5f3c` 独立合成复审接受：安装 guard 前注入安全计数原目标，99 槽捕获身份/正控/拦截通过，ESM 命名绑定 48/48；额外 99 个逐槽直接转发缺陷均 exit 2 且精确 `FORWARDING_DETECTED … countDelta=1`；原 11 个 BLOCKED 槽合成证据闭合、不再阻断。
- 口径：后续该实现保持；**不写作 750809c 本轮重新跑 99 槽，不重开 CF12**。

### 7.5 CF14（归档勘误已关闭）

- `72fe242` 新清单 61/61 字节及哈希接受；旧日志/清单原字节保留。
- 616 项 CRLF、旧 `git diff --check` exit 2 及历史待集成诊断均按真实时点保留解释，不将旧 FAIL 改 PASS。
- 旧 Windows 最终原始日志缺件另列 **NOT_VERIFIED**：不因归档更正或新版本通过而追认已补齐，不伪造/重跑补旧日志。

### 7.6 单列未验证 / 外部门禁（保持待验）

真实 Cloud 事务/并发、真实 SDK 依赖/商户/设备/TLS 链、微信真机、真实上传/发布及生产目标/配置/回滚准备，均未因本次静态/合成验收获得验证，按原有流程保持待验；其中特定既有证据状态照原档，不把泛列未验项当作新造缺陷。上传、部署、发布、设备操作、HTTP/UI、真实支付和生产云继续冻结；不自动进入下一阶段。

### 7.7 证据来源与口径说明

- 可参考本机 Codex 复审报告（`codex-review-750809c/FINAL-CLOSURE-INDEX.md`、同目录 `REVIEW.md`、`codex-review-10963dd/REVIEW.md` 等）；按约定**不将本机绝对路径或敏感值写入 Git**，本节正文已登记全部裁定。
- 仓库证据一律使用固定 SHA 的既有链接；区分原三路回执、Codex 独立结果、Harness 历史结果。
- 不将本机未入库报告编造 GitHub 链接或声称已归档仓库；有来源取件限制如实标明。
- 不跨版本累加数字；不以 Harness 86/86 或旧 113/113 冒充本轮独立验证。

### 7.8 登记信息

- 登记执行者：Harness lead（本会话，dsh-baton 派发）；本补充仅为文档状态登记，未运行任何测试/静态/来源校验，未改动代码/测试/guard/来源清单/D 归档与旧证据。
- 本补充后交独立 Codex **仅文档复审**；不自批发布/实施。
