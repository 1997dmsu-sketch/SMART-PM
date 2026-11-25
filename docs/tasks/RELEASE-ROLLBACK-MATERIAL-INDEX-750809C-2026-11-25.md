# RELEASE-ROLLBACK-MATERIAL-INDEX-750809C 发布回滚材料索引（2026-11-25）

> **状态：独立文档交付（只读准备）。本索引未执行任何回滚、备份、导出、演练、部署、上传、发布或设备操作；未运行测试/静态/来源校验/构建/安装；未连接业务云/真实设备/端口，未开放 HTTP/UI，未执行支付。**
>
> 本索引**不替代** `REL-AI-03` 回滚卡（R-01–R-08）与发布准备卡 §11/§12，只按「小程序 / 云函数 / Node 后台」三个适用组件整理既有回滚材料、锚点、证据与缺件；恢复验证标准只引用既有规则，不制定新的业务验收公式。**NO-GO 保持**；本索引不自批、不解除 NO-GO、不启动下一阶段，交付后交 Codex 独立仅文档复审。

---

## 0. 元数据、输入冻结与文档边界

| 项 | 值 |
|---|---|
| 文档起点（输入基线） | `6b740f02ce16e3d63f3708e486e230f7e6b53313`（`git ls-remote origin refs/heads/docs/release-readiness-750809c-status-sync` 一致，未前移） |
| 直接父提交 | `6e3a31f24b34a4289872e63e4f4b6d7dc6db98ec`（`docs(release): append minimal NO-GO release materials and verification ordering`） |
| 代码候选（固定引用，仅用于只读代码调查） | `750809c545f4b83a0ab12193310314efff8fcc9e`（父 `99639630e944120eb68877dccb873392deb71fcd`；远端承载分支 `fix/checkin-face-codex-r2-2026-11-24` tip = 收口登记，未前移） |
| 收口登记 | `f7030aacdbf9f972e94dc8cffe992fa39e92b293`（父 750809c；仅既有交付报告追加的文档登记，Codex 仅文档复审已通过；**不视为代码发布版本**） |
| 任务分支 / 工作树 | `docs/rollback-material-index-750809c`；`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\SMART-PM-H3\_rollback-material-index`（自文档起点新建；未切换/移动任何既有用户树与 `_rework-r2` / `_release-status-sync`） |
| 执行者 | Harness `lead` 本会话（独立只读准备 + 单一文档交付；未派子代理/其他 worker） |
| 文档日期 | 2026-11-25（Asia/Shanghai） |
| 本文件性质 | 唯一新增文件 `docs/tasks/RELEASE-ROLLBACK-MATERIAL-INDEX-750809C-2026-11-25.md`；不改其他文档/代码/测试/清单/日志/D 归档；不新建重复审批卡 |
| 重复性核对 | 执行前核：本地分支/远端分支/工作树均无同目标（`docs/rollback-material-index-750809c` / `_rollback-material-index` 不存在）；本会话未另派同目标子任务 |

### 0.1 本索引做什么 / 不做什么

- **做**：按三个适用组件给出「组件/回退层、已知锚点或未知、证据 SHA 与日期/适用版本、所缺最小材料、提供角色（待指定）、只读核验方法、未来恢复验证标准、停止条件」的简明索引；区分证据类别；标注可并行只读整理项与必须外部补交项。
- **不做**：不执行回滚/备份/导出/演练；不设计设备写回滚与现场 worker 的操作/回滚步骤（仅标不在本项操作范围）；**不重新盘点候选组件清单（云端 A 任务）、不制定新的业务验收公式（云端 B 任务）、不重复旧安全问题适用性审查（云端 C 任务）**；不重复 CF/P3/guard 已收口审查；不读取凭据、完整环境/证书/设备配置，不索取秘密值。
- **云端并行任务边界**：A/B/C 云端产出未纳入本索引输入；如后续需引用其正文而不可取件，接口依赖标「待取得」，**不猜规格**。既定目标为微信测试体验版（PREP §12），本索引不再询问渠道；组件范围/体验成员/入口策略/执行授权仍待用户确认，本索引不替用户决定。

### 0.2 证据类别（本索引统一采用）

| 类别 | 含义 | 是否可作为「可回滚」依据 |
|---|---|---|
| 原始执行记录 | 当时执行会话写入仓库的报告/JSON（REL-AI-01/01C、交付报告正文等） | 可引用其记录；不因时间推移自动等效「当前有效」，平台侧结论需另行核 |
| 历史准备卡 | PREP/回滚卡/缺口表/Runbook 等既有规则文档 | 仅作规则与缺口引用，不证明已执行 |
| 云端回执 | 云端 Codex/调度方裁定经登记进入仓库（f7030aa §7） | 仅登记结论；正文本机不可访问者标未知，不冒称本地可查询或已完成 |
| 本轮静态推断 | 本会话 `git show 750809c:<path>` 读码得到的名称/存在性/版本号/开关 | **代码可读 ≠ 实测通过**，不得作为运行/平台/真机证据 |
| 未知 | 无任何可定位 E2/E3 证据 | 记为未知并进缺件清单；不沿用口头恢复 |

---

## 1. 结论摘要

1. **组件范围与锚点未冻结**：候选 750809c 无冻结标签/制品哈希，线上基线未知，平台上一体验版锚点、云函数远端版本/导出、配置快照、数据备份/恢复验证均缺 → **NO-GO 继续**（PREP `fb9f84ef…` §11.1/§11.6/§12）。
2. 本索引未发现新的「已验证可回滚」证据。既有唯一平台侧体验版上传记录为 beta.18 的 CLI 本地回显（2026-11-14），平台显示版本/时间未确认、真机 0/8 PASS、0 FAIL、8 BLOCKED → **beta.18 与 main 均不能直接指定为可用回滚版本**。
3. Node 后台是否纳入体验版范围**未知** → 后台行全部标「条件适用」，不替用户决定；现场 worker/设备仅标不在本项操作范围，不设计设备写回滚。
4. 回滚材料缺件与 PREP §12 步骤 4（外部补交硬门禁）一致；本索引只整理、只核可只读项，不派单、不执行。
5. CF01–CF14 代码退修/静态合成验收已收口（收口登记 f7030aa §7，云端回执）；本索引不重复审 CF/P3/guard，也不把静态/合成验收当作回滚可用性证据。

---

## 2. 主索引（三个适用组件）

> 列说明：回退层编号沿用 REL-AI-03 回滚卡（R-01 平台 / R-02 制品 / R-03 云函数 / R-04 配置 / R-05 数据）；「未来恢复验证标准」均引自既有规则且**须另行单独授权**，本索引不执行。

### 2.1 小程序（miniprogram）——适用；回退层 R-01 平台体验版入口 / R-02 制品

| 组件/回退层 | 已知锚点或未知 | 证据 SHA / 日期 / 适用版本 | 所缺最小材料 | 提供角色（待指定） | 只读核验方法 | 未来恢复验证标准（需单独授权） | 停止条件 |
|---|---|---|---|---|---|---|---|
| 小程序 / 平台体验版入口（R-01） | 已知：beta.18 体验版上传为 CLI **本地回显成功**（版本 `0.1.0-beta.18-production-test.1`，本地上传时间 2026-11-14 17:45 +0800，微信开发者工具 2.02.2611042）；**平台显示版本/上传时间未确认**。未知：beta.18 之前的「上一体验版」版本号/上传时间/是否仍可切换、平台当前展示状态 | 原始执行记录：REL-AI-01 报告 §5/§8/§10.2，blob `99cbe4b5c854236f6f515449cfdb2ebf95e60ce6` @ `ecac307061eff09d7245b91d0df21d2a97ad4203`（2026-11-14 22:43；适用 beta.18-production-test.1 / `6e18d04…`）；REL-AI-01C 索引 blob `8a4a738767a9bf63219b71761bcabf0367313507`（8 条全 BLOCKED） | 上一体验版本号、上传时间、是否仍可切换/回退、平台展示状态（平台侧人工补录；CLI 无版本列表接口） | 授权测试人员/测试账号持有人 + 发布指挥 | 仓库内报告/JSON 按 blob SHA 核对；平台侧无只读接口 → 属必须外部补交（§4） | R-01（回滚卡 §4）：平台显示目标版本 + 授权测试人员本人可打开 + 入口与预期一致；不删除任何既有版本；无锚点则只能撤回入口/重新上传冻结包 | F-07/F-08（PREP §6）；锚点缺失 → R-01 不可执行，不声称可回退 |
| 小程序 / 制品与源码（R-02） | 已知：beta.18 冻结提交 `6e18d04ad958f00a602b92cdfdf2a36297c25230`；annotated 标签 `v0.1.0-beta.18-production-test.1`（tag 对象 `c63b863650d77e2ff4c64fe0cf7b8470729c0d14`）；冻结 ZIP `SMART-PM-v0.1.0-beta.18-production-test.1.zip`，9,489,378 字节，SHA-256 `d9f0c8526b69d62c9fa7adb52439e78dbfa5225430274f6ac8c923b4800143a9`（REL-AI-01C §10.2 当时复核 `FROZEN_INTACT=True`）。**ZIP 未入库**（仅当时本地 dist/），当前无法复核其存在性（回滚卡 §2.1）。beta.17-preview/demo 标签存在（`a8c469f…`/`6527a76…`，2026-11-03）但无上传/平台/真机证据，**不作回滚锚点**；`origin/main`=`282a20fca9f64ab80ead50372c9c3e90bf4aeba7` 不得当线上版本（PREP §11.8 #2）。未知：本轮候选 750809c 无冻结标签、无制品哈希（未打包；打包须后续单独授权，PREP §12 步骤 5） | 原始执行记录：REL-AI-01 §1/§10.2（同上 blob）；标签对象 `c63b863…` → `6e18d04…`；打包脚本 `scripts/package-release.py`（候选 blob `63d568a1dfe97e079bb6042b742c8a79d7bdf030` @ 750809c，按 HEAD `git archive`，要求干净工作区与 live 配置匹配） | 当前线上各组件实际版本清单与候选差异清单；候选冻结 tag + 唯一 commit + 制品 SHA-256/manifest/命令日志 | 发布执行人 + 发布指挥（版本冻结）；授权方补交线上清单 | `git rev-parse <tag>^{commit}`、`git ls-tree`、报告内哈希比对；候选无制品可核（未构建） | R-02（回滚卡 §4）：版本号/提交/大小/SHA-256 与冻结记录一致，重新编译无错误 | F-01；未冻结 SHA 不打发布包（PREP §11.8 #4）；不重打 ZIP 冒充原包；不把「打包通过」当部署（§11.7） |
| 小程序 / 候选静态版本信息（本轮静态推断，非实测） | 候选 750809c：根 `package.json` 与 `miniprogram/config/version.json` 均为 `0.1.0-beta.19-checkin-face.1`（version.json releaseDate 2026-11-24，channel「入住＋人脸登记体验版候选（待负责人确认）」）；`miniprogram/config/runtime.js`：`mode=live`、`allowDeviceOperations=false`、`checkinFaceTestEntry=true`（注释明确该开关非服务端审批输入、不授予设备访问）；`project.config.json` AppID 存在（脱敏不引值；仓库联调配置不证明生产绑定） | 本轮静态推断：`miniprogram/config/version.json` blob `2e92386bec3b9427ea5d98ef49e176c60ceefc41`、`runtime.js` blob `2e2ea0001b6211d8e1ddf665a9dbabea3e0e2205` @ 750809c（2026-11-25 12:40 +0800 提交） | 微信编译/预览/授权真机冒烟/平台版本对应（PREP §11.8 #6，旧 0/8 不自动恢复） | 真机执行人 + 授权测试人员 | 仅 `git show` 读码；**代码可读 ≠ 编译/真机/live 实测** | 候选真机 8 项逐项 E3 证据（截图/录屏+时间+设备/系统/微信版本，脱敏），另需单独授权执行 | F-04/F-05；不用开发者工具模拟器冒充真机；不用代码级证据冒充真机通过 |

### 2.2 云函数（cloudfunctions）——适用；回退层 R-03 云函数回退 / R-04 配置

| 组件/回退层 | 已知锚点或未知 | 证据 SHA / 日期 / 适用版本 | 所缺最小材料 | 提供角色（待指定） | 只读核验方法 | 未来恢复验证标准（需单独授权） | 停止条件 |
|---|---|---|---|---|---|---|---|
| 云函数 / 远端函数列表与版本（R-03） | 已知：REL-AI-01C §10.6（2026-11-14，只读 `cli cloud functions list`）：远端 24 个函数与 beta.18 标签内 24 目录一致；点名 8 函数 `contentList/getHouses/phoneLogin/messageList/messageRead/messageSend/getDevices/unlockRecords` 全部 PRESENT；变更 0。**属当时事实，非本轮复核**。本轮静态：候选 750809c 含 25 个函数目录，新增 `cloudfunctions/checkinFaceTest`（`checkinFaceTest@1.0.0`）。未知：远端当前实际函数列表/版本/代码一致性 | 原始执行记录：REL-AI-01 §4/§10.6（blob `99cbe4b5…` @ `ecac307…`）；本轮静态推断：750809c `cloudfunctions/` 目录清单（`git ls-tree`） | 云函数版本导出记录与回退包（GAP-10）；函数配置/依赖/权限/存储访问规则/索引快照；真实云存在性与事务重试、失效/撤权负向验收（PREP §11.8 #5，not_requested） | 云环境管理员；授权方补交环境绑定（§12 步骤 2） | `git ls-tree/show 750809c:cloudfunctions/**`（目录/名称/包版本）；真实云 C 层只读核对须另行授权（PREP §12 步骤 6），本项不连接云 | R-03（回滚卡 §4）：函数列表与版本快照一致、点名函数存在、无未知函数；不整批覆盖 | F-03（未知云函数）；回退点未知 → R-03 不可执行；不部署未批准函数 |
| 云函数 / 配置与依赖快照（R-04 相关） | 未知：环境绑定/权限/命名空间/唯一房间/租期/版本/允许账号/派发开关的脱敏核对（PREP §11.3）；配置快照（名称/版本/fingerprint）未知（GAP-11）。已知（名称性）：PREP §11.3 记录本机进程 `ADMIN_MODE/ADMIN_ORIGIN/CLOUDBASE_ENV_ID/TENCENTCLOUD_SECRETID/TENCENTCLOUD_SECRETKEY/ADMIN_DATA_DIR/PORT/HOST` 均未设置；候选树内无 `.env`/`.env.local`（本轮静态核对，**不是**「生产缺配置」结论） | 历史准备卡：PREP §11.3/§11.8 #3（blob `fb9f84ef…` @ `6b740f02…`）；本轮静态推断：`git ls-tree -r 750809c` 无 `.env` 命中 | 配置清单（名称/版本/fingerprint，不含密钥值）+ 环境一致性 + HTTPS 健康入口 | 云环境管理员 + 安全/隐私 | 仅名称/存在性核对（沿用 §11.3 口径）；不读凭据值、不读生产配置 | R-04（回滚卡 §4）：启动无配置错误、`allowDeviceOperations=false`、模式/环境与快照一致；不出现「回滚后自动放行」 | F-02/F-06；无快照不执行 R-04；不把进程变量缺失推成生产缺配置 |

### 2.3 Node 后台（admin-web）——**条件适用**（是否纳入体验版范围未知，不替用户决定）；回退层 R-04 配置 / R-05 数据 / REL-AI-02 §7.1 应用回滚

| 组件/回退层 | 已知锚点或未知 | 证据 SHA / 日期 / 适用版本 | 所缺最小材料 | 提供角色（待指定） | 只读核验方法 | 未来恢复验证标准（需单独授权） | 停止条件 |
|---|---|---|---|---|---|---|---|
| Node 后台 / 范围先决（R-04/R-05 前置） | 未知：后台是否纳入体验版范围（PREP §12 步骤 1 待用户确认）；生产主机/进程管理/HTTPS 入口/域名/健康 URL 从所读资料不可确认（PREP §11.2）；REL-AI-02 TBD-15 同口径 | 历史准备卡：PREP §11.2/§12 步骤 1-2（blob `fb9f84ef…` @ `6b740f02…`） | 组件范围书面确认；后台若纳入：实际生产主机/域名/管理方式的脱敏清单 | 用户（书面确认）+ 授权方（补交） | 仅文档引用；示例回环地址不是生产 URL | 按步骤 1 明确范围后决定适用门禁（PREP §12 按范围补充） | 替用户决定未定范围；把「不纳入」默认换成启用；为释放 NO-GO 擅自缩小范围 |
| Node 后台 / 启动与配置快照（R-04） | 已知（规则，名称性）：后台环境变量名称清单（`ADMIN_MODE/ADMIN_ORIGIN/CLOUDBASE_ENV_ID/TENCENTCLOUD_SECRETID/TENCENTCLOUD_SECRETKEY/IDENTITY_HMAC_KEY/IDENTITY_ENCRYPTION_KEY/ADMIN_ORG_ID/ADMIN_DATA_DIR/HOST/PORT/NAS_ENABLED/FILE_STORAGE_DEFAULT` 等，值只来自受控环境）+ K1/K2/K3 密钥域变量（`DEVICE_CLAIM_*`/`OPERATION_KEY_*`/`H4_EVIDENCE_*`，不读取密钥原文）。本轮静态：候选 750809c `admin-web/package.json` = `smart-pm-admin@0.2.0-beta.6`；`server.mjs`、`config.example`、`create-admin.mjs`、`start-demo.cmd` 存在。**版本口径不一致（历史事实，待确认）**：REL-AI-02 §1.3 基线 `1155b7ba65991d324fb8b22bb8f7dd87f49428f9`（2026-11-14）后台为 `0.6.0-beta.1`、根为 `0.1.0-beta.16`；发布版本必须变更单冻结，不得按包名/标签推断（REL-AI-02 TBD-12）。未知：完整配置快照 | 历史准备卡：REL-AI-02 §2.2/§2.3/§1.3、TBD-12/13（blob `e33ab665a97a15258de0bb20f5cb73ae7835831e` @ `db06f8ab90679b9d9f2384b98d28255dd0681431`，2026-11-14 09:49）；本轮静态推断：`admin-web/package.json` blob `6b862aa610bc977836662094402ca0227e7804ca` @ 750809c | 完整配置快照（名称/版本/fingerprint，不含密钥值）（GAP-11）；生产主机/进程管理/健康 URL（TBD-03/TBD-15） | 云环境管理员 + 发布指挥 | `git show 750809c:admin-web/**` 名称/存在性；不读生产配置实值、不连接主机、不启动服务 | REL-AI-02 §7.2：恢复上一份完整配置快照，启动不报配置错误、K1/K2/K3 fingerprint 与快照一致、domain 不匹配继续失败关闭；R-04 同口径 | S02/M14；F-02；配置回滚需发布指挥+安全复核双批准；不得只改一半；不得回退到 demo |
| Node 后台 / 数据目录与数据兼容（R-05 / 应用回滚） | 已知：`ADMIN_DATA_DIR` 为本地数据目录（live 主要用 CloudStore，REL-AI-02 §2.3）；`admin-web/.data` 为运行态产物，不在 Git；REL-AI-02 §4.1 备份顺序含「本地数据 `admin-web/.data`（停写后复制，保留原文件）」。兼容规则（既有）：不删新集合/新字段让旧代码跑起来；数据恢复是最后手段；恢复后重新校验组织/实名/黑名单/设备绑定。未知：数据目录快照与备份 | 历史准备卡：REL-AI-02 §4.1/§7.1/§7.3、回滚卡 §1.1/§6（blob `a5e84d11ba4fe44d63be8f129e14a7124dbdb390` @ `6b740f02…`） | 数据目录快照 + 备份清单 + 隔离副本恢复验证记录（GAP-13） | DBA + 云环境管理员 | 仅规则引用；不读备份秘密、不导出数据 | REL-AI-02 §7.4 恢复验证表 + AC09 备份恢复副本通过计数/ID/权限/证据校验 | S09；数据恢复需发布指挥+云DBA+安全复核三方批准；禁止用旧快照覆盖新审核/新证据；禁止删集合/记录/重建集合 |

### 2.4 现场 worker / 设备——**不在本项操作范围**（仅标注，不设计其回滚）

- 现场 worker `tools/checkin-face-worker`（`@smartpm/checkin-face-worker@0.1.0-checkin-face.1`，依赖 `@cloudbase/node-sdk` 锁定 `3.18.7`，blob `c8ea6c3f0a68b92cec8755ed3b0e8b58018f167a` @ 750809c）为本地受控工具；是否纳入体验版范围同 §2.3 第一行（用户确认），本索引不设计其操作/回滚步骤、不读取其 `.local.json`/环境变量值。
- 设备回滚（R-06）与设备写回滚：以既有 `HK-AI-06B` §9 RB-01–RB-09 规则为准（回滚卡 §0 引用 `docs/hk-hikvision-device-lab-preflight@ba95666`）；本项**不设计设备写回滚**，0 设备连接/0 设备操作保持。

### 2.5 跨组件：数据备份与恢复验证（R-05）

| 组件/回退层 | 已知锚点或未知 | 证据 SHA / 日期 | 所缺最小材料 | 提供角色（待指定） | 只读核验方法 | 未来恢复验证标准（需单独授权） | 停止条件 |
|---|---|---|---|---|---|---|---|
| 数据库/集合 + 本地数据（R-05） | 已知（规则）：REL-AI-02 §4.1 备份范围与顺序 6 项（发布制品 / 配置元数据 / 云集合 / 本地数据 / 文件资产 / 密钥材料）；备份验收三原则（备份成功≠可恢复、隔离副本恢复验证、密钥托管属恢复验收一部分）；仓库**没有**生产备份脚本（TBD-06）。未知：任何已存在备份/恢复验证记录 | 历史准备卡：REL-AI-02 §4.1/§7.4（blob `e33ab665…` @ `db06f8a…`）；缺口表 GAP-13（blob `0099cda5fede1beba7d8cfbc6d40340dff11aea3` @ `6b740f02…`） | 备份报告 + 隔离副本恢复演练记录（D4）；备份工具/账号/存储位置（TBD-06） | DBA + 云环境管理员 | 只读核对材料存在性与规则引用；不读取备份内容/密钥 | R-05（回滚卡 §4）：计数/ID/revision/审计与备份清单一致，权限负向用例仍拒绝；REL-AI-02 §7.4/AC09/AC10 | S09；不虚构「已备份/已演练」；只有确认新写入受影响且备份已验证才恢复；不得先删原件 |

### 2.6 跨组件：失败触发 / 负责人 / 见证人

| 组件/回退层 | 已知锚点或未知 | 证据 SHA / 日期 | 所缺最小材料 | 提供角色（待指定） | 只读核验方法 | 未来恢复验证标准（需单独授权） | 停止条件 |
|---|---|---|---|---|---|---|---|
| 决策/审批链（全部组件） | 已知（规则）：回滚卡 §3 决策树与 §3.1 执行顺序；REL-AI-02 §6.3 S01–S10 停止条件、§6.4 回滚触发表与权限（应用回滚=发布指挥决定/后端值班执行；配置回滚=发布指挥+安全复核双批准；数据恢复=发布指挥+云DBA+安全复核三方批准）；PREP §6 F-01–F-14。未知：全部责任角色与见证人未指定（GAP-17）；变更单/审批/停止链未落实（PREP §11.6） | 历史准备卡：回滚卡 §3/§7（blob `a5e84d11…`）、REL-AI-02 §6.3/§6.4/§9（blob `e33ab665…`）、PREP §6/§7（blob `fb9f84ef…`），均 @ 2026-11-14～11-19 | 角色书面指定清单（GAP-17）、变更单/维护窗口/审批签字（PG-14）、见证人 | 项目负责人（角色指定）+ 发布指挥（变更单） | 只读核对既有规则；角色仍全部待定 | 回滚卡 §5.1 演练 D1–D6 通过判据 + REL-AI-02 AC11 事件复盘；D6 需 H4-c 合入 | 未指定角色不开始对应门禁（PG-05）；演练未通过不进发布审批（PG-13）；每次停止写证据包（PREP §6.1） |

---

## 3. 证据来源索引（完整 SHA / 路径）

> 路径格式：`分支@完整提交SHA:路径` + blob SHA；类别见 §0.2。

| ID | 类别 | 定位 | blob SHA | 日期 / 适用版本 | 本索引引用要点 |
|---|---|---|---|---|---|
| SRC-01 | 历史准备卡 | `docs/release-readiness-750809c-status-sync@6b740f02ce16e3d63f3708e486e230f7e6b53313:docs/tasks/REL-AI-03-RELEASE-DEVICE-ACCEPTANCE-GATE-PREP-2026-11-19.md` | `fb9f84eff2fde2cd3d376812ba2662ebea8d09fe` | 2026-11-19 起，§11 登记 2026-11-25 12:55、§12 登记 2026-11-25 13:08（+08:00） | NO-GO 结论、回滚硬门禁（§11.6）、§11.8 门禁表、§12 最小材料与验证顺序 |
| SRC-02 | 历史准备卡 | 同上分支@`6b740f02…`:`docs/tasks/REL-AI-03-ROLLBACK-CARD-2026-11-19.md` | `a5e84d11ba4fe44d63be8f129e14a7124dbdb390` | 2026-11-19（v1） | R-01–R-08 层级、锚点清单、决策树、验收标准、D1–D6 |
| SRC-03 | 历史准备卡 | 同上分支@`6b740f02…`:`docs/tasks/REL-AI-03-EVIDENCE-GAP-REGISTER-2026-11-19.md` | `0099cda5fede1beba7d8cfbc6d40340dff11aea3` | 2026-11-19（首轮） | GAP-01–GAP-22 缺口、§3.2/3.3/3.4 重新取证、SRC/TAG 索引 |
| SRC-04 | 原始执行记录 | `release/miniprogram-beta18-experience-report@ecac307061eff09d7245b91d0df21d2a97ad4203:docs/tasks/REL-AI-01-EXPERIENCE-DEPLOY-REPORT.md` | `99cbe4b5c854236f6f515449cfdb2ebf95e60ce6` | 2026-11-14 22:43；适用 `v0.1.0-beta.18-production-test.1`/`6e18d04…` | beta.18 上传本地回显、平台锚点 BLOCKED、冻结 ZIP/SHA-256、云函数 24 零变更 |
| SRC-05 | 原始执行记录 | 同上@`ecac307…`:`docs/tasks/REL-AI-01C-SMOKE-EVIDENCE-INDEX-2026-11-14.json` | `8a4a738767a9bf63219b71761bcabf0367313507` | 2026-11-14 | 8 条 `BLOCKED`，`capturedAt`/`evidencePath` 为空，`redacted=true` |
| SRC-06 | 历史准备卡 | `docs/hk-face-release-runbook@db06f8ab90679b9d9f2384b98d28255dd0681431:docs/tasks/REL-AI-02-HK-FACE-RELEASE-RUNBOOK.md` | `e33ab665a97a15258de0bb20f5cb73ae7835831e` | 2026-11-14 09:49；基线 `1155b7ba65991d324fb8b22bb8f7dd87f49428f9` | 回滚触发 §6.4、回滚与恢复 §7、演练 §7.5、失败恢复验收 §11、TBD-01–16 |
| SRC-07 | 原始执行记录（自述矛盾已登记） | 同上@`db06f8a…`:`docs/tasks/REL-AI-02-DELIVERY-REPORT-2026-11-14.md` | `907f94a55df28f2e8d79002d985321c4ae793049` | 2026-11-14 09:49 | 推送自述 FAIL 与远端分支存在矛盾（GAP-20），不宣称「推送已恢复」 |
| SRC-08 | 云端回执（经登记） | `fix/checkin-face-codex-r2-2026-11-24@f7030aacdbf9f972e94dc8cffe992fa39e92b293:docs/evidence/checkin-face-rework-2026-11-24/DELIVERY-REPORT-2026-11-24.md` | `818569043dc051e6a8eba89ddfb4514318df77a5` | 2026-11-24 报告 + 2026-11-25 §7 收口登记 | CF01–CF14 收口、750809c 为 CF11 代码验收固定对象、真实环境/回滚准备保持待验（§7.6） |
| SRC-09 | 本轮静态推断 | `fix/checkin-face-codex-r2-2026-11-24@750809c545f4b83a0ab12193310314efff8fcc9e:miniprogram/config/version.json` | `2e92386bec3b9427ea5d98ef49e176c60ceefc41` | 候选提交 2026-11-25 12:40 +0800 | 候选版本 `0.1.0-beta.19-checkin-face.1` |
| SRC-10 | 本轮静态推断 | 同上@`750809c…`:`miniprogram/config/runtime.js` | `2e2ea0001b6211d8e1ddf665a9dbabea3e0e2205` | 同上 | `mode=live`、`allowDeviceOperations=false`、`checkinFaceTestEntry=true`（代码可读，非实测） |
| SRC-11 | 本轮静态推断 | 同上@`750809c…`:`admin-web/package.json` | `6b862aa610bc977836662094402ca0227e7804ca` | 同上 | 后台 `smart-pm-admin@0.2.0-beta.6`（与 REL-AI-02 基线 `0.6.0-beta.1` 口径不一致，待确认） |
| SRC-12 | 本轮静态推断 | 同上@`750809c…`:`tools/checkin-face-worker/package.json` | `c8ea6c3f0a68b92cec8755ed3b0e8b58018f167a` | 同上 | worker `@cloudbase/node-sdk@3.18.7` 锁定（依赖装配仍待真实 npm 验证，见 SRC-08 §6） |
| SRC-13 | 本轮静态推断 | 同上@`750809c…`:`scripts/package-release.py` | `63d568a1dfe97e079bb6042b742c8a79d7bdf030` | 同上 | 制品流程：按 HEAD `git archive`、要求干净工作区与 live 配置匹配；本项未构建 |
| TAG-01 | 版本锚点 | `refs/tags/v0.1.0-beta.16`（annotated `1b1bfa3c896017c42c499a2b2c123c29b75990fd` → `282a20fca9f64ab80ead50372c9c3e90bf4aeba7`） | — | 2026-11-02 | `origin/main` 输入基线；不得当线上版本 |
| TAG-02 | 版本锚点 | `refs/tags/v0.1.0-beta.17-preview.1`（annotated `bf583bb859d49bb4382fbc77b78b9b437d717150` → `a8c469f…`） | — | 2026-11-03 | 无上传/平台/真机证据，不作回滚锚点 |
| TAG-03 | 版本锚点 | `refs/tags/v0.1.0-beta.17-demo.1`（annotated `7cd4b38ea160fd20df04cbf1352a9c25dfc05158` → `6527a76…`） | — | 2026-11-03 | 离线测试数据版，不作回滚锚点 |
| TAG-04 | 版本锚点 | `refs/tags/v0.1.0-beta.18-production-test.1`（annotated `c63b863650d77e2ff4c64fe0cf7b8470729c0d14` → `6e18d04ad958f00a602b92cdfdf2a36297c25230`） | — | 2026-11-04 | 冻结源码锚点；平台生效未确认，不得直接指定为可用回滚版本 |

**远端 tip 核验（本轮 `git ls-remote origin`，2026-11-25）**：`refs/heads/main`=`282a20f…`、`release/miniprogram-beta18-experience-report`=`ecac307…`、`docs/hk-face-release-runbook`=`db06f8a…`、`docs/release-readiness-750809c-status-sync`=`6b740f02…`、`fix/checkin-face-codex-r2-2026-11-24`=`f7030aa…`，均与固定引用一致，**无前移**。

---

## 4. 可并行只读整理项 vs 必须外部补交项

### 4.1 可并行只读整理项（本项已完成或可继续；不连接生产/设备）

1. 仓库内 SHA/标签/对象/blob 核对与远端 tip 核对（本项已完成，见 §3 尾部）。
2. 候选 750809c 静态盘点：组件目录/版本号/开关/环境变量名称（本项已完成，均为「本轮静态推断」类）。
3. 候选与**已提供**线上清单的差异比对、组件部署顺序（待外部先提供清单，PREP §12 步骤 3）。
4. 回滚材料完整性核对（本索引本身）。
5. 配置核验表、制品检查表、验收用例的只读定义（PREP §12 文末「可继续只读的明确事项」）。

### 4.2 必须外部补交项（本项不执行、不派单）

| # | 材料 | 依据 |
|---|---|---|
| 1 | 组件范围/体验成员/入口策略与具体执行授权（用户书面确认；既定微信测试体验版目标不再作为渠道询问） | PREP §12 步骤 1 |
| 2 | 脱敏目标小程序/云环境授权绑定、当前线上版本与部署清单；后台若纳入：实际生产主机/域名/管理方式 | PREP §12 步骤 2 |
| 3 | 平台上一体验版锚点（版本号/上传时间/是否可切换/平台展示状态，人工补录） | REL-AI-01C §10.2；GAP-05/06/09 |
| 4 | 可执行回滚包：上一稳定版本/制品哈希与可切换证明、云函数导出/回退包、完整配置快照、数据备份/恢复验证、负责人/见证人、停止条件 | PREP §12 步骤 4（发布前硬门禁） |
| 5 | 候选制品：固定 750809c 独立干净源码树打包 + 制品哈希/manifest/命令日志（后续单独授权） | PREP §12 步骤 5 |
| 6 | 候选微信编译/受控真机冒烟/平台版本绑定、真实云权限/事务/失效撤权验收原始证据（后续单独授权验证，当前冻结） | PREP §12 步骤 6 |
| 7 | 角色书面指定、变更单、演练 D1–D6 记录、Codex 复核与用户明确发布授权 | PG-05/PG-13/PG-14/PG-15 |

---

## 5. 未冻结组件/锚点 → NO-GO 继续

| 未冻结/未齐项 | 现状 | 依据 |
|---|---|---|
| 发布组件范围与目标绑定 | 待用户确认；既定微信测试体验版目标不等于已获上传/部署放行 | PREP §11.2/§12 |
| 线上基线（小程序/云函数/后台当前版本） | 未确认；main 不得当线上版本 | PREP §11.8 #2 |
| 候选版本/制品 | 750809c 无冻结标签/制品哈希；未打包 | PREP §11.7/§12 步骤 5 |
| 平台上一体验版锚点 | 未知（版本/时间/可切换性） | GAP-05；REL-AI-01C §10.2 |
| 云函数远端版本/回退包/配置快照 | 未知 | GAP-10/GAP-11 |
| 数据备份与恢复验证 | 未知；无备份脚本 | GAP-13；REL-AI-02 TBD-06 |
| 负责人/见证人/审批链 | 全部待定 | GAP-17；PREP §11.6 |

**结论**：组件与锚点未冻结，回滚不可证明可用，**NO-GO 继续**（与 PREP §11.1/§11.6 一致）。本索引不解除 NO-GO、不自批；完成后停止，交 Codex 独立仅文档复审，不启动下一阶段。

---

## 6. 单列：旧 Windows 最终原始日志（NOT_VERIFIED）

- 旧 Windows 最终原始日志缺件仍 **NOT_VERIFIED**，与新代码修复和真实生产门禁分开；CF14 归档勘误已接受、新 61/61 清单，旧日志/清单原字节保留（收口登记 f7030aa §7.5；PREP §11.9）。
- 本项**不重复派修、不重跑补旧日志、不伪造**；616 项 CRLF、旧 `git diff --check` exit 2 及待集成历史说明原样保留，不借此重开已关闭修复。
- 该缺件与本索引的回滚材料整理无关，仅按约定单列，不参与 NO-GO 之外的任何推断。

---

## 7. 交付核对

| 项 | 结果 |
|---|---|
| 变更范围 | 仅新增本文件（`git status --porcelain` 仅本文件；`git diff --stat` 1 file changed） |
| `git diff --check`（提交前） | worktree vs index：exit 0；`git diff --cached --check`（index vs HEAD）：exit 0（无空白/冲突标记报项） |
| `git show --check`（提交后） | 最终提交上执行，退出码见交付回报 |
| 提交方式 | 一笔普通新提交；无 amend/rebase/reset/squash/force/merge/cherry-pick |
| 推送 | `git push origin HEAD:refs/heads/docs/rollback-material-index-750809c`（普通显式 refspec，新建远端分支） |
| 最终 SHA | `git ls-remote origin refs/heads/docs/rollback-material-index-750809c` 与本地 HEAD 一致（值见交付回报） |
| 工作树 | 提交后干净（`git status --porcelain` 为空） |
| 固定链接 | `https://github.com/1997dmsu-sketch/SMART-PM/blob/<最终SHA>/docs/tasks/RELEASE-ROLLBACK-MATERIAL-INDEX-750809C-2026-11-25.md`（以交付回报最终 SHA 为准） |

---

## 8. 变更记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v1 | 2026-11-25 | 初版：三组件回滚材料索引、证据类别、可并行只读项与外部补交项划分、NO-GO 结论、旧 Windows 日志单列 | Harness lead（本会话） |
