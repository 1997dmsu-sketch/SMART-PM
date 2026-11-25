# WECHAT-EXPERIENCE-SMOKE-CHECKLIST-750809C-2026-11-25 微信测试体验版冒烟执行清单（编排定义，非执行记录）

> **状态：纯编排文档。本清单未执行任何真机冒烟、编译、上传、扫码、云调用、设备或支付操作，不构成任何放行。当前 NO-GO 保持；P3 已关闭不再修；既定目标为微信测试体验版，本清单不再把渠道作为待选问题询问。**
>
> 本清单不批准任何执行：全部用例均为「将来受控冒烟」的**定义**（角色、页面操作顺序、预期观察、脱敏证据格式、失败停止条件）。实际执行需按 §2 前置材料取得、并按 §2/§5.6 获取分项限定授权后方可开始。
>
> 本清单不重写云端 Codex B（`acceptance_gate_remediation_spec`）的评分公式 / 证据关联计算 / 判定引擎；相关部分一律标「待云端B正式交付后交叉引用，未取得不得声称一致」（§8）。组件范围 / 入口策略待云端 A 盘点交付交叉引用（§9）。
>
> 本清单不把计划或代码可读当实测通过：所有「预期」为【本轮静态推断】（对固定候选 750809c 的只读阅读），执行时必须逐条实际观察，未观察即 `NOT_EXECUTED` / `BLOCKED`，禁止预填 `PASS`。

---

## 0. 元数据与固定引用

| 项 | 值 | 取证方式 |
|---|---|---|
| 文档日期 | 2026-11-25（Asia/Shanghai） | 会话时间 |
| 执行者 | 本 Harness 会话（独立文档任务；未派子代理 / 其他 worker） | 会话事实 |
| 本清单性质 | 纯文档：仅新增本文件 1 份、1 笔 commit；不改代码 / 测试 / 既有文档 / 配置 / 清单 / 日志 / D 归档 | `git status` / `git diff --stat` |
| 代码候选（本清单编排基线） | `750809c545f4b83a0ab12193310314efff8fcc9e` | `git cat-file -t` / `git log -1` |
| 候选父提交 | `99639630e944120eb68877dccb873392deb71fcd` | `git log -1 --format=%P` |
| 候选归属远端分支 | `origin/fix/checkin-face-codex-r2-2026-11-24`（tip 即收口登记，见下行） | `git branch -r --contains` |
| 收口登记（文档登记，非代码发布版本） | `f7030aacdbf9f972e94dc8cffe992fa39e92b293`（父 750809c；变更 `docs/evidence/**/DELIVERY-REPORT-2026-11-24.md` +50 行） | `git log -1` / `git show --stat` |
| 文档起点（本清单父基线） | `6b740f02ce16e3d63f3708e486e230f7e6b53313` | `git cat-file -t` |
| 文档起点直接父 | `6e3a31f24b34a4289872e63e4f4b6d7dc6db98ec`（其父 `6e63a74c661a34a3f65d6d91208810d3a0cf368f`） | `git log -1 --format=%P` |
| 远端同线 tip 核对 | `origin/docs/release-readiness-750809c-status-sync` = `6b740f02…`，**未前移 / 未分叉**（与固定引用一致，不擅换） | `git ls-remote` |
| 任务分支 / 工作树 | `docs/experience-smoke-checklist-750809c` / `SMART-PM-H3/_experience-smoke-checklist`（HEAD=6b740f02，干净） | `git worktree add` / `git status` |
| 候选版本 | `0.1.0-beta.19-checkin-face.1`（根 `package.json`、`miniprogram/config/version.json`、`miniprogram/config/version.js` 三处一致，均 @ 750809c） | `git show 750809c:<path>` |
| 候选平台展示版本 / 上传时间 | **待外部人工核对补录**（§9）；未取得不得声称平台已对上 750809c | 待补 |

### 0.1 引用基线（本清单反复使用的固定 SHA + 路径）

| 材料 | 定位 | 类别 |
|---|---|---|
| 发布与真机验收门禁准备卡（六层模型、E0–E3、PG-00–15、RD-01–13、F-01–14、§11 NO-GO 回写、§12 解禁材料顺序） | `docs/tasks/REL-AI-03-RELEASE-DEVICE-ACCEPTANCE-GATE-PREP-2026-11-19.md` @ `6b740f02ce16e3d63f3708e486e230f7e6b53313` | 【历史准备卡】 |
| 旧体验版部署脱敏报告（含原 §6 八项逐字清单与逐项 BLOCKED 记录） | `docs/tasks/REL-AI-01-EXPERIENCE-DEPLOY-REPORT.md` @ `ecac307061eff09d7245b91d0df21d2a97ad4203`（origin/release/miniprogram-beta18-experience-report） | 【历史准备卡】 |
| 旧 8 项冒烟证据索引（8 条全 BLOCKED、空证据路径） | `docs/tasks/REL-AI-01C-SMOKE-EVIDENCE-INDEX-2026-11-14.json` @ `ecac307061eff09d7245b91d0df21d2a97ad4203` | 【历史准备卡】 |
| 入住＋人脸登记唯一接口契约（错误码全表、上传契约、事务契约、getMyTask 只读资格） | `cloudfunctions/checkinFaceTest/lib/INTERFACES.md` @ `750809c…` | 【历史准备卡】+【本轮静态推断】 |
| 服务端失败关闭配置门禁（TEST_DISABLED / ACCOUNT_NOT_ALLOWED / ROOM_UNCONFIGURED / LEASE_UNCONFIGURED / VERSION_MISMATCH / INVALIDATED 等） | `cloudfunctions/checkinFaceTest/lib/config.js` @ `750809c…` | 【本轮静态推断】 |
| 客户端白名单与审核渠道错误码分类（REVIEW_CHANNEL_CODES 闭式集合） | `miniprogram/services/api.js` @ `750809c…` | 【本轮静态推断】 |

### 0.2 候选关键页面 / 调用链速查（全部 @ `750809c545f4b83a0ab12193310314efff8fcc9e`，【本轮静态推断】）

| 页面 / 文件 | 行为与云调用 | 写类别 |
|---|---|---|
| `miniprogram/app.json` | 页面表 11 页；自定义 tabBar：首页 / 广场 / 开门 / 消息 / 我的 | 只读 |
| `miniprogram/config/runtime.js` | `mode=live`、`allowDeviceOperations=false`、`checkinFaceTestEntry=true`（纯 UI 入口开关，非服务端审批输入，不授予设备访问） | 只读 |
| `miniprogram/pages/home/index.js` | `contentList('share')` 云读；失败显式 error 面板 | 云读 |
| `miniprogram/pages/life/index.js` | `getHouses`（权限过滤 `isPublic!==true`）云读；筛选 / 空态 | 云读 |
| `miniprogram/pages/rental/index.js` | `getHouse` / `listHouses` 云读；看房预约仅 `wx.setStorageSync` 本机草稿（**不发送**）；`contactPhone` 可触发 `wx.makePhoneCall`（真实呼叫，单列冻结 WE-F05） | 云读 + 本机草稿写 |
| `miniprogram/pages/messages/index.js` | `messageList(conversations)` 云读；`messageRead` 云写已读 | 云读 / 云写 |
| `miniprogram/pages/chat/index.js` | `messageList(messages)` 云读；`markRead` / `messageSend` 云写 | 云读 / 云写 |
| `miniprogram/pages/profile/index.js` | 手机号授权 → `phoneLogin` 云写会话；`logout` 仅本地 `profile=null`；「测试入住」入口 `checkinFaceTestEntry===true` 且需已登录 | 云写（登录） |
| `miniprogram/pages/unlock/index.js` | `getDevices`（权限过滤设备列表）/ `unlockRecords` 云读；`api.unlockDevice` 在 `allowDeviceOperations=false` 时**本地抛错**（先于 `unlock` 云调用）；家庭成员 `listFamily` 当前 `unsupported` | 云读；设备写被配置硬阻断 |
| `miniprogram/pages/checkin/index.js|wxml` | `checkinFaceTest{action:getConfig}` 云读；`applyTestCheckin` 云写（仅提交服务端下发 `applicationVersion`）；`classifyApplyResult` 仅 `auto_approved` + 有效 `applicationId` 才「已受理」 | 云读 / 云写（申请） |
| `miniprogram/pages/face-enroll/index.js|wxml` | `getMyTask` 云读（5 秒只读轮询，绝不自动重发）；上传需 `uploadEligible===true` + 资格复核；`wx.cloud.uploadFile`（**真实素材上传**）+ `createFaceTask`（云写）；`ready`/`pending-site` 一律「待现场刷脸验证」，页面不呈现现场识别结论 | 云读 / 素材上传 + 云写（冻结 WE-F01） |
| `miniprogram/services/api.js` | `CHECKIN_FACE_FORBIDDEN_FIELDS` 客户端字段白名单（服务端决定字段本地抛错，绝不下发）；`uploadTestFace` 要求 `test-face/` 前缀且路径服务端下发；demo 写不能开门、demo 不发消息、demo 不传人脸 | 只读 / 上传 / 云写 |
| `cloudfunctions/checkinFaceTest/**` | 服务端门禁 + 事务 + 错误码闭式集合（INTERFACES.md §5） | 云读 / 云写（服务端） |
| `tools/checkin-face-worker/claim-and-enroll.mjs`、`admin-web/server.mjs`（`/api/checkin-face-test/*`） | 设备派发 worker / 管理配置写 | 派发 / 管理云写（冻结 WE-F03） |

---

## 1. 范围与分层边界

1. 沿用 REL-AI-03 §1 六层模型（S 模拟 / O 离线 / C 真实云只读 / D 真机 / P 支付 / H 设备），**一层一判、禁止跨层外推、禁止拼凑**（§1.1）。
2. 本清单编排：**D 层**真机冒烟（默认只读序列 §5.2、云写专项 §5.4、冻结单列 §5.5）、**C 层**受控只读核对（§5.6 T3）、**编译预览**（§5.6 T2，需授权）。**P 支付 / H 设备**不编排执行内容，只列冻结与既有引用（REL-AI-03 RD-10/RD-11/RD-12、HK-AI-06B）；任何 D 层通过都不覆盖 P / H。
3. 全部用例初始状态 `NOT_EXECUTED`；本清单不预填任何 `PASS`。旧 REL-AI-01C 的 0/8 PASS、0 FAIL、8 BLOCKED（2026-11-14）为**历史结论，不是本轮实测**，不自动恢复。
4. 代码级 / 静态 / 合成证据（候选自带 `npm test` 套件、checkin-face 静态检查、旧报告 §2–§5 的 51/51 等）**不构成任何 D 层用例通过**（REL-AI-03 §1.1-4、REL-AI-01C §0）。
5. 本清单不得被用于「为了完成冒烟暗中开放设备」：`allowDeviceOperations` 保持 `false`；设备侧 `ready` / `pending-site` 仅表示「待现场刷脸验证」，**不能称现场识别通过**，也不能证明设备能力（H 层独立门禁）。

---

## 2. 前置输入与限定授权门（未全部取得前禁止进入任何执行）

| 编号 | 材料 / 授权 | 提供方 | 当前状态 | 未取得前禁止 |
|---|---|---|---|---|
| IN-01 | 平台展示版本 / 上传时间与候选 750809c 的绑定核对（微信公众平台 / 开发者工具**人工只读**核对） | 平台操作人（R-PLATFORM-OP） | 待取得 | 声称平台已对上 750809c；进入真机冒烟 |
| IN-02 | 体验成员实际名单与角色映射（**仅占位/脱敏代号**，不写真实 openid / 姓名 / 证件 / 照片） | 用户书面提供 | 待补 | 用占位冒充实际名单；索取或写入真实身份 |
| IN-03 | 组件范围与入口策略（哪些页面 / 云函数 / 后台 / worker 纳入本次体验） | 用户确认 + 云端 A 盘点交叉引用 | 待补 | 替用户决定范围；把「不纳入」默认换成启用 |
| IN-04 | 具体执行授权（编译预览 / 受控云只读 / 真机默认只读序列 / 云写专项，**分项限定**） | 用户 | 未授权 | 以「编排完毕」代替授权开始执行 |
| IN-05 | 环境脱敏代号（ENV-*）与测试 / 生产隔离核验记录 | 云环境管理员 | 待补 | 以「应该隔离」代替核验 |
| IN-06 | 划定测试会话与脱敏只读数据（消息会话、房源 / 设备 / 记录只读数据、空态构造数据） | 授权方 | 待补 | 使用真实住户 / 真实设备数据 |
| IN-07 | 可控云失败注入方案（WE-08 依赖，仅限受控测试云） | 云环境管理员 | 待补 | 在生产云制造失败 |
| IN-08 | 证据保管与脱敏规则确认（对应 REL-AI-03 PG-08） | 安全 / 隐私 | 待补 | 采集任何截图 / 录屏 / 日志证据 |
| IN-09 | 回滚锚点材料（REL-AI-03 §11.6 / §12-4；发布前硬门禁） | 授权方 + 发布指挥 | 待补 | 上传 / 部署 / 发布；冒烟本身不解除该门禁 |
| IN-10 | 账号切换 / 多账号（含不在名单账号 R-NONLIST）与真实授权专项 | 用户 | 未授权 | 切换账号测试负向用例 |

> 先外部提供平台版本 / 成员和前置材料，另获限定授权才能进入编译预览 / 受控云调用 / 真机冒烟（§5.6 T0–T4）。任何字段空缺 → 对应用例 `BLOCKED`，不预填。

---

## 3. 角色占位（全部待指定；不写真实姓名 / openid / 证件 / 照片）

| 角色代号 | 职责（定义） | 不得做 |
|---|---|---|
| `R-TESTER-AUTH` | 已登录授权测试者：本人微信登录、本人身份确认、本人操作、本人确认截图脱敏 | 不转交账号、不代登录、不索取验证码、不录含隐私画面 |
| `R-NONLIST` | 不在名单账号（负向用例 WE-N03/N05 观察用） | 仅按 IN-10 专项授权后使用；不借用他人账号 |
| `R-ADMIN-REVIEWER` | 管理员审查者：只读审查配置展示、名单、平台版本回显（任何**写**操作另属 WE-F03 专项） | 不写真实身份；不替测试者确认 |
| `R-PLATFORM-OP` | 平台操作人：仅人工核对平台版本 / 体验成员列表（只读） | 不上传 / 提审 / 发布 / 回退 / 删除版本 |
| `R-WITNESS` | 见证人：核对版本 / 设备 / 数据 / 停止事实 | 不做事后追认 |
| `R-EVIDENCE` | 证据保管人：证据包、哈希、留存、销毁 | 不接收未脱敏原件 |

> 角色代号 ↔ 真实身份映射表由外部书面提供并脱敏保管；本清单与仓库不保存该映射。体验成员实际名单 / 角色、组件范围 / 入口策略和具体执行授权目前均未知 → 以上全部为占位，列材料待补（§9）。

---

## 4. 证据格式规范

### 4.1 每条用例一次执行一条证据记录，字段如下

| 字段 | 要求 |
|---|---|
| 候选 SHA | 固定 `750809c545f4b83a0ab12193310314efff8fcc9e` |
| 平台展示版本 | 候选平台展示版本号 + 上传时间（由 R-PLATFORM-OP 人工补录；缺失 → `BLOCKED`） |
| 时间与时区 | ISO8601 采集时间 + 时区（Asia/Shanghai） |
| 环境脱敏代号 | `ENV-<编号>`（IN-05 分配；不写云环境 ID） |
| 角色代号 | §3 代号 |
| caseId | 本清单用例 ID（WE-xx） |
| 步骤 / 期望 / 实际 | 步骤序号；期望值=本清单定义；实际观察值逐字记录（未执行写 `NOT_EXECUTED`，观察不一致写 `FAIL`，缺字段写 `BLOCKED`） |
| 截图 / 日志相对工件 ID | `evidence/<ENV>/<caseId>/<角色代号>_<步骤>_<UTC时间戳>.png|mp4|log` |
| 结论 | 枚举 `PASS` / `FAIL` / `BLOCKED` / `NOT_EXECUTED` |
| 未验证边界 | 逐条写明（如「未采集 Network 面板」「未核对后端已读原数据」） |

### 4.2 脱敏与入库禁令

- **严禁在仓库保存**：账号、密码、token、cookie、openid、手机号完整值、完整 AppID（只能写「与仓库既有配置一致」）、云环境 ID、IP / MAC / 序列号、真实人脸照片、真实住户资料、设备实值。
- 截图仅以集合名可见（环境代号 / 角色代号 / caseId / 时间戳），**不构成权限或关联证据**；任何含真实人员 / 人脸 / 住址 / 完整证件的截图**不采集、不提交**（REL-AI-03 §2.1-3/4、F-06）。
- 证据一旦无法脱敏即不采集；字段空缺时结论 `BLOCKED`，不预填通过。

### 4.3 证据来源五分类（本清单每处引用必须标注其一）

1. 【原始执行记录】真机 / 平台 / 云端现场执行产物——**本清单当前没有任何此类记录**；
2. 【历史准备卡】REL-AI-01/01C/03、06A/06B 等既有文档结论；
3. 【云端回执】云端 Codex A / B / C 的交付与回执——本清单发布时不可取得，标【待取得】，不冒称可查或已完成；
4. 【本轮静态推断】对 750809c 代码 / 文档的只读阅读推断，未经真机验证；
5. 【未知】无证据。

> 本清单全部「预期」=【本轮静态推断】+【历史准备卡】；不把计划或代码可读当实测通过。

---

## 5. 用例编排

### 5.1 旧 8 项功能冒烟 → 候选 750809c 适用映射（总表）

> 旧项内容为 REL-AI-01C 原 §6 逐字清单（@ ecac307 报告 §6/§10.3）。**旧结论 0/8 PASS、0 FAIL、8 BLOCKED（2026-11-14）是历史报告，不是本轮实测**；候选适用性为【本轮静态推断】。旧项 2 / 4 按「云写与否」拆分编排（§5.2 只读 vs §5.4 云写专项），不改变原判据口径。

| 旧编号 | 旧内容（REL-AI-01C §6） | 候选页面 / 调用链（@ 750809c） | 新 caseId | 类别 | 旧结论（历史，非本轮） |
|---|---|---|---|---|---|
| SMOKE-01 | 启动、首页和导航 | `app.json` + `pages/home` + `custom-tab-bar` | WE-01 | 只读观察 | BLOCKED |
| SMOKE-02 | 手机号授权取消 / 成功 / 退出 | `pages/profile` login（取消=只读 / 成功=`phoneLogin` 云写 / 退出=本地清理） | WE-02A（只读）/ WE-W01（云写） | 只读 + 云写专项 | BLOCKED |
| SMOKE-03 | 内容与房源列表、详情、空态 | `pages/home`、`pages/life`、`pages/rental`（contentList / getHouses / getHouse） | WE-03 | 只读观察 | BLOCKED |
| SMOKE-04 | 消息列表、读取、受控会话发送 | `pages/messages`、`pages/chat`（messageList / messageRead / messageSend） | WE-04A（只读）/ WE-W02、WE-W03（云写） | 只读 + 云写专项 | BLOCKED |
| SMOKE-05 | 我的页面 | `pages/profile`（getProfile 本地会话内存；live 未登录=未登录态） | WE-05 | 只读观察 | BLOCKED |
| SMOKE-06 | 开门页仅读允许设备与自己记录 | `pages/unlock`（getDevices / unlockRecords 云读） | WE-06 | 只读观察 | BLOCKED |
| SMOKE-07 | 点击开门不得发设备命令，显示关闭 / 拒绝 | `pages/unlock` requestUnlock + `api.unlockDevice`（`allowDeviceOperations=false` 本地抛错） | WE-07 | 只读 + 本地阻断观察 | BLOCKED |
| SMOKE-08 | 云失败不得回退为演示成功 | live 模式各页失败路径（error 面板；`api.call` 失败即 throw，不落 demo） | WE-08 | 受控失败注入（专项授权） | BLOCKED |

### 5.2 默认只读观察序列（D 层；前置：§2 全部取得 + IN-04「真机默认只读序列」授权；不含任何云写 / 素材上传 / 设备派发）

> 每例列：来源 SHA / 路径、前置条件、只定义的操作、预期 UI / 错误 / 失败关闭行为、证据 ID 与脱敏要求、云写 / 上传 / 派发标记、执行授权依赖、失败即停止条件。预期全部为【本轮静态推断】，执行时逐条实际观察。

| caseId | 来源 @ 750809c | 前置 | 操作（定义） | 预期 UI / 错误 / 失败关闭 | 证据 ID / 脱敏 | 云写 / 上传 / 派发 | 授权依赖 | 失败即停 |
|---|---|---|---|---|---|---|---|---|
| WE-01 | `miniprogram/app.json`、`pages/home/index.js`、`custom-tab-bar/index.js` | 体验版可打开；R-TESTER-AUTH 本人已登录；IN-01/05/06 | 冷启动；观察首页渲染；逐个切换 5 个 tab（首页/广场/开门/消息/我的） | 无白屏 / 致命错误；5 tab 可达且选中态正确；首页调用 `contentList('share')`，失败时显示 error 面板 + 重新加载，**不回退 demo**（live 下 `isDemo()===false` 恒定） | `EVT-WE-01-*`；截图仅环境/角色/caseId/时间，无身份实值 | 否（云读） | IN-01/02/04/05/06/08 | 白屏 / 致命错误 / 出现 demo 内容冒充 live → 立即停 |
| WE-02A | `pages/profile/index.js` | 同上；账号处于未登录态 | 打开「我的」；触发手机号授权弹窗后选择**取消** | 未获取手机号授权时提示「未获取手机号授权」或直接关闭授权流程；**无 `phoneLogin` 调用**（code 缺失即 return）；页面保持未登录态 | `EVT-WE-02A-*` | 否 | IN-04（只读序列） | 出现登录成功迹象 / 后端会话写入迹象 → 立即停 |
| WE-02B | `pages/profile/index.js`（logout） | 已完成 WE-W01 登录（另需云写专项授权） | 「账号设置」→「退出当前账号」→ 确认 | 确认后回到未登录态；`logout` 仅本地清理会话内存，无云调用 | `EVT-WE-02B-*` | 否 | WE-W01 已执行 | 退出后仍显示已登录 / 出现云调用迹象 → 停 |
| WE-03 | `pages/home`、`pages/life`、`pages/rental` | 授权账号 + 脱敏只读数据（IN-06） | 打开内容流、房源列表（筛选/搜索）、房源详情；按 IN-06 构造空态 | 列表 / 详情正确加载；空态正确呈现（不报错、不回退 demo）；`getHouses` 结果仅非公共房源（`isPublic!==true` 客户端再过滤） | `EVT-WE-03-*`；数据脱敏 | 否（云读） | IN-06 | 出现 demo 房源冒充 / 公共用房可见 / 云失败回退 demo → 停 |
| WE-04A | `pages/messages/index.js`、`pages/chat/index.js` | 授权账号 + 划定测试会话（IN-06） | 打开消息列表；点击分类入口（物业通知/工单/缴费/访客） | 会话列表渲染（`messageList conversations`）；分类入口显示「尚未接入」本地提示；**本步骤不触发任何已读 / 发送调用** | `EVT-WE-04A-*`；会话摘要脱敏 | 否（云读） | IN-06 | 出现非预期已读 / 发送请求迹象 → 停 |
| WE-05 | `pages/profile/index.js`、`config/version.js` | 授权账号（可未登录 / 已登录两态观察） | 打开「我的」；检查展示与入口；点「关于我们」 | 页面正常展示，无越权信息；未登录显示未登录态；关于弹窗版本号=候选 `0.1.0-beta.19-checkin-face.1`；「测试入住」入口仅在 `checkinFaceTestEntry===true`（候选为 true）时可见，未登录点击不进入入住页 | `EVT-WE-05-*` | 否 | — | 出现他人资料 / 越权信息 → 停 |
| WE-06 | `pages/unlock/index.js` | 授权账号 + 脱敏设备 / 记录数据（IN-06） | 打开开门页；查看「我的门锁」「最近开门」；点「查看家庭成员」 | 设备列表来自 `getDevices`（权限过滤），记录来自 `unlockRecords`；仅显示当前账号可见设备与自己记录，无跨组织数据；家庭成员入口显示 `listFamily` 未接入的错误文案（「旧后端尚未提供家庭成员查询接口」）；无数据显示空态文案 | `EVT-WE-06-*`；设备名/记录脱敏 | 否（云读） | IN-06 | 出现跨组织 / 他人设备或记录 → 停 |
| WE-07 | `pages/unlock/index.js`、`services/api.js` | 授权账号；`allowDeviceOperations=false` 已静态确认 | 点击「一键开门」→ 确认弹窗「确认开门」 | 确认后弹「开门未完成」+「真实开门尚未启用，请完成设备联调后开启」；该错误在 `unlock` 云调用**之前**本地抛出（配置 false 先校验），**无设备命令、无 unlock 请求**；页面不泄露设备 / 人员 / 凭据字段 | `EVT-WE-07-*`；请求观察记录（脱敏）如需采集 → 另需受控采集授权 | 否（云读 + 本地阻断） | IN-04；受控 Network 采集另批 | 出现任何真实设备请求 / 开门成功迹象 → 立即断网停止（F-03） |
| WE-08 | `services/api.js`（live 失败路径）、各页 error 面板 | 授权账号 + 受控失败注入（IN-07，仅测试云） | 在受控环境注入云调用失败（如函数缺失 / 环境错误）；观察首页 / 广场 / 消息页行为 | 显式失败（error 面板 + 重试），**不静默回退 demo、不假成功**；错误信息含「服务连接失败…请检查云环境及该函数是否已部署」类文案 | `EVT-WE-08-*`；注入方案与时间线记录 | 否（受控云操作，非写入） | IN-07（受控云调用授权） | 出现 demo 成功 / 静默回退 → 停 |

> 附带观察（不单独成例，归 WE-03）：看房预约表单提交仅写本机草稿（`wx.setStorageSync`），弹窗明确「尚未发送给物业」；执行时确认**无云调用**。

### 5.3 新入住 / 人脸入口负向场景（仅定义，不执行；页面只读观察 + `getConfig` / `getMyTask` 云读）

> 全部负向状态来自候选代码与 INTERFACES.md 契约【本轮静态推断】；不自行补充未知业务政策。前置：R-TESTER-AUTH / R-NONLIST 相应账号（R-NONLIST 需 IN-10 专项授权）、体验版可打开、受控云环境。失败关闭 = 页面按代码定义展示拒绝 / 关闭文案且不产生任何云写 / 上传 / 派发。

| caseId | 场景 | 来源 @ 750809c | 操作（定义） | 预期 UI / 失败关闭（静态推断） | 云写/上传/派发 | 失败即停 |
|---|---|---|---|---|---|---|
| WE-N01 | 入住页总开关关闭 | `pages/checkin/index.js`（buildIneligibleReason）| 打开「测试入住」页 | 显示「自动通过不可用」+「测试开关未开启，当前不提供自动通过。」；提交按钮禁用 | 否（云读） | 出现可用入口 / 可提交 → 停 |
| WE-N02 | 测试配置未完成 | 同上 | 同上 | 「测试配置尚未完成，当前不提供自动通过。」；提交禁用 | 否 | 同上 |
| WE-N03 | 账号不在测试名单 | 同上（accountEligible=false） | 以名单外账号打开入住页 | 「当前账号不在测试名单，请走既有审核流程。」；提交禁用；**不显示人脸入口** | 否 | 名单外账号出现自动通过能力 → 停 |
| WE-N04 | 租期待配置 | 同上（leaseConfigured） | 名单内账号但租期未配置 | 「租期待配置：负责人填写起止后才会启用，本页不会自行选择日期。」；即使 eligible 也不可提交；页面不填默认日期 | 否 | 页面自行填日期 / 可提交 → 停 |
| WE-N05 | 提交被拒-普通账号（pending_review 通道） | `checkin/index.js` classifyApplyResult + INTERFACES.md §5（ACCOUNT_NOT_ALLOWED 不对外暴露） | 名单外账号尝试提交（若 UI 可达） | 服务端返回 code0 pending_review → 「未自动通过」+「测试入住不自动审批普通账号…请走既有审核流程」；**不显示人脸入口**；页面不替用户提交人工审核申请 | 云读（提交路径被服务端零写拒绝） | 出现「已受理」/ 人脸入口 → 停 |
| WE-N06 | 提交被拒-审核渠道错误码 | `services/api.js` REVIEW_CHANNEL_CODES（APPLICATION_FORBIDDEN / APPLICATION_NOT_APPROVED / ACCOUNT_NOT_ALLOWED 防御保留） | 受控环境使服务端返回上述码 | 「未自动通过」+ 原因文案 + 既有审核渠道提示；**绝不显示成功 / 受理 / 人脸入口**；其他错误码不吞并、显示明确错误 | 否 | 该码被显示为成功 → 停 |
| WE-N07 | 人脸页无任务 / 资格未确认 | `pages/face-enroll/index.js`（TASK_NOT_FOUND 但 uploadEligible!==true） | 有 applicationId 但资格未确认时打开人脸页 | 「人脸登记入口未开放 / 登记资格尚未确认…」；上传卡片关闭；不显示成功 | 否（云读） | 出现上传入口 → 停 |
| WE-N08 | 上传路径未下发 | 同上（cloudPath 缺失） | 资格已确认但 cloudPath 未下发 | 「上传路径待服务端下发…本页不会自行拼接路径。」；上传按钮禁用 | 否 | 本地拼接路径 / 可上传 → 停 |
| WE-N09 | 任务终态负向（失效 / 失败待核 / 结果待核） | `face-enroll` STATUS_VIEW（INVALIDATED / FAILED_REVIEW / UNKNOWN_RESULT） | 受控环境使任务处于对应终态 | 分别显示「已失效，待人工核查」「失败，待人工核查」「结果待核」；均**不自动重发、不扩大通行范围**（INTERFACES.md §3.6：终态 uploadEligible=false） | 否（云读） | 自动重发 / 显示成功 → 停 |
| WE-N10 | 直达人脸页无申请标识 | `face-enroll/index.js` onLoad | 无 applicationId 直接打开人脸页 | 本地显示「缺少入住申请标识，请先完成测试入住。」；无云调用 | 否 | 出现云调用 / 默认申请 → 停 |
| WE-N11 | 正面只读状态观察（仅当管理员已完成专项配置后；不属于默认序列） | `checkin` / `face-enroll` wxml + `cloudfunctions/checkinFaceTest/lib/config.js` | 名单内 + 开关 / 102 / 租期已配置（由 WE-F03 专项完成）后，观察配置只读卡与任务状态视图 | 房号 102 / 租期只读卡按服务端下发展示；任务状态 QUEUED_FOR_DISPATCH / CLAIMED / DEVICE_PROCESSING / DEVICE_CONFIRMED / PENDING_SITE_VERIFICATION 显示对应文案；**`ready` / `pending-site` 一律显示「待现场刷脸验证」，页面不呈现现场识别结论，不得称现场识别通过** | 否（云读；其前置配置属于 WE-F03 管理云写专项） | ready/pending-site 被写成识别通过 → 停 |

### 5.4 云写专项授权序列（单列；每项需 IN-04「云写专项」限定授权；一次一项、证据归档后再下一项）

| caseId | 云写内容 | 来源 @ 750809c | 前置 | 操作（定义） | 预期 | 证据 / 脱敏 | 失败即停 |
|---|---|---|---|---|---|---|---|
| WE-W01 | 手机号授权成功建立会话 + 退出清理 | `pages/profile` + `phoneLogin` | 授权账号本人登录；脱敏手机号授权环境 | 授权成功路径：确认授权 → 登录 → 观察「我的」→ 退出（WE-02B） | 成功建立会话、profile 显示脱敏昵称；失败显式呈现不假成功；退出后会话清理 | 后端「仅本会话」只读核对记录（脱敏、含时间/环境代号）；不记录手机号 | 非预期会话 / 他人信息 → 停（F-09/F-10） |
| WE-W02 | 已读标记（messageRead） | `pages/messages` markAllRead / `pages/chat` markRead | 划定测试会话（IN-06） | 在授权会话内标记已读 | 仅授权会话内生效；已读不改消息原数据（需后端只读核对确认）；无跨会话写入 | 消息 ID（脱敏）+ 后端核对记录 | 跨会话写入 / 原数据被改 → 停 |
| WE-W03 | 受控会话发送（messageSend） | `pages/chat` send | 划定测试会话；内容 ≤ 500 字 | 在明确测试会话内发送一条测试消息 | 发送成功仅在该会话内可见；失败显式呈现（弹「未发送」）；空内容 / 超长被本地拦截 | 消息 ID（脱敏）；不截取他人消息内容 | 消息出现在非授权会话 → 停（F-05/F-09） |
| WE-W04 | 测试入住申请提交（applyTestCheckin） | `pages/checkin` submit + INTERFACES.md §3.2 | 开关 / 名单 / 102 / 租期已由管理员专项配置（WE-F03 前置）；账号在名单；确认主入住人 | 勾选「本人为主入住人」→ 提交（仅携带服务端下发 applicationVersion） | 仅 `auto_approved` + 有效 applicationId 显示「入住申请已受理」并可进入人脸页；pending_review / 未知一律「未自动通过」；房号 / 租期 / 审批字段不由本页提交 | 申请结果（脱敏）；后端仅本人记录核对 | 非名单账号被受理 / 页面自造房号租期 → 停 |

### 5.5 冻结单列（禁止进入默认可执行序列；未经专项授权一律不执行，不借冒烟暗中开放）

| caseId | 内容 | 来源 @ 750809c | 冻结理由 / 边界 |
|---|---|---|---|
| WE-F01 | 人脸照片上传（`wx.cloud.uploadFile` 真实素材上传 + `createFaceTask`） | `pages/face-enroll` + `services/api.js` + INTERFACES.md §1 | 真实人脸照片 + 真实云存储写；涉及隐私与素材上传，必须专项授权（IN-10 + 用户专项授权）；未授权不得为「完成冒烟」上传任何照片 |
| WE-F02 | 真实设备开门（`unlockDevice`） | `pages/unlock` + `services/api.js` | 设备写；需 `allowDeviceOperations=true`（当前候选恒 false，静态推断）+ 登录 + 真实设备；默认序列绝不尝试开启开关（F-02） |
| WE-F03 | 设备派发 / worker 与管理配置写（`claim-and-enroll.mjs`、`beginTaskExecution` / `reportTask`、`admin-web /api/checkin-face-test/*`、`setSwitch(true)`、名单 / 102 / 租期配置写） | `tools/checkin-face-worker/**`、`admin-web/server.mjs`、`cloudfunctions/checkinFaceTest/**` | 设备派发与管理云写；设备侧 `ready` / `pending-site` 不等于现场识别通过（H 层独立，REL-AI-03 PG-11） |
| WE-F04 | 支付 / 退款 / 对账 | 候选无支付证据 | 本候选范围未含支付证据；若纳入另明确范围专项授权，不借此开启真实收退款（REL-AI-03 PG-12） |
| WE-F05 | 真实电话呼叫（`wx.makePhoneCall`） | `pages/rental` contactPhone | 触发真实外呼；仅当脱敏测试号码预先书面批准后才允许点击 |
| WE-F06 | 平台操作：体验版上传 / 提审 / 发布 / 扩大体验成员 / 回退 / 删除版本 | —（引用 REL-AI-03 §0.2） | 全部冻结；本清单不授权任何平台写操作 |

### 5.6 受控执行顺序（全部前置后；任一阶段失败即按 §6 停止，不自行回滚、不继续补测）

```text
T0 材料核对：§2 全部取得（IN-01..IN-10 状态转已取得/已补）
   ↓
T1 平台版本 / 入口人工只读核对（R-PLATFORM-OP）：平台展示版本 ↔ 750809c 绑定
   ↓
T2 编译预览（需 IN-04「编译预览」授权；微信开发者工具 preview；产出编译日志 / 包大小工件；不等于真机）
   ↓
T3 受控云只读核对（C 层；云函数存在性 / 版本只读列表；REL-AI-03 PG-09 模式；零写）
   ↓
T4 D 层默认只读序列 WE-01..WE-07（一次一项；§5.2）
   ↓
T5 云写专项 WE-W01..W04（逐项授权、逐项执行、逐项后端只读核对）
   ↓
T6 冻结序列 WE-F01..F06：仅专项授权后单独立案执行，不属于冒烟默认路径
```

---

## 6. 失败停止矩阵（本清单细化；上位 REL-AI-03 §6 F-01–F-14 继续适用）

| ID | 触发条件 | 立即动作 | 恢复条件（需书面批准） | 禁止掩盖 |
|---|---|---|---|---|
| F-WE01 | 前置材料 / 限定授权未取得即开始任何执行 | 停止；保留现场 | 按 §2 补齐 + 重新审批 | 先执行后补审批 |
| F-WE02 | 身份未知 / 名单无法核对 / 出现不在名单账号操作 | 停止；隔离该会话 | 名单书面确认 + 重新基线 | 借用他人账号（F-10） |
| F-WE03 | 出现非预期云写 / 素材上传 / 设备派发迹象，或未知云函数 / 域名 / 未批准 HTTP 调用 | 立即断开；记录脱敏证据 | 安全 / 云管理员书面说明 + 重新审批 | 忽略日志、删除记录（F-03） |
| F-WE04 | 页面出现真实住户 / 人脸 / 完整手机号 / 凭据或设备实值 | 停止；隔离；按隐私事件处理 | 隐私负责人批准 + 仅合成数据 | 「只测一次」（F-09） |
| F-WE05 | 任一用例 FAIL / 结果不确定，或证据缺字段（时间 / 环境代号 / 角色 / caseId / 工件任一缺） | 该例记 BLOCKED，停止后续项；不开返工卡前不重试 | 修复 + 重新执行受影响项（F-05/F-13） | 把 FAIL 改写成 BLOCKED / PASS；事后补时间补哈希 |
| F-WE06 | 平台展示版本与候选 750809c 不一致 / 版本三处不一致 | 停止；不声称可回退 | 发布指挥 + Codex 重新冻结（F-01/F-08） | 改版本号、重打包冒充 |
| F-WE07 | 回滚锚点不可证明（REL-AI-03 §11.6） | 不进入上传 / 部署 / 发布 | 补齐锚点 + 回滚演练通过 | 用「到时候再说」代替锚点（F-07） |

**停止后的通用处置**（沿用 REL-AI-03 §6.1）：先急停 / 断开（按风险），再记录；保留脱敏证据（时间、环境代号、版本 SHA、触发条件、已执行步骤、截图 / 日志哈希）；不删除原始证据（含敏感值者按 F-06 隔离）；按已批准流程报告发布指挥 / 见证人 / 安全隐私角色；**不自行回滚、不继续补测、不自行恢复**。

---

## 7. 本清单的证据来源与状态区分

- 全部内容来源：对固定候选 `750809c…` 的只读代码阅读（`git show 750809c:<path>`，未把文档分支旧代码当候选）【本轮静态推断】；REL-AI-03 / REL-AI-01 / REL-AI-01C 既有文档【历史准备卡】；`INTERFACES.md` 契约【历史准备卡 + 本轮静态推断】；远端分支与 tip 核对（`git fetch` / `git ls-remote`，只读，未前移 / 未分叉）。
- 云端 Codex A / B / C 的交付与回执：本清单发布时不可取得【待取得】；不冒称本地可查询或已完成，不重复其目标、不打断。
- 本清单**没有**【原始执行记录】：未运行任何测试 / 静态 / 来源校验 / 构建 / 安装 / 源码脚本，未上传、未扫码、未连接端口或云、未触碰设备 / 支付 / 备份回滚演练。
- 本清单不宣称真机通过，不宣称 CORE-01 通过；旧 Windows 最终原始日志仍 NOT_VERIFIED 单列（REL-AI-03 §11.9），不重复派修、不重跑补旧日志、不伪造。

---

## 8. 云端 B 接口依赖（未取得不得声称一致）

- 云端 B（`acceptance_gate_remediation_spec`）负责验收表整改公式 / 证据关联计算 / 判定引擎；**本清单不重写其任何公式或判定规则**。
- 待 B 正式交付后，本清单与执行证据以 **B 交付的固定 SHA** 交叉引用其评分 / 关联规则；在取得之前：涉及评分、证据关联、自动判定的部分一律写「待云端B正式交付后交叉引用，未取得不得声称一致」，**不编造 B 的 SHA、文件名或内容**。
- 同理，组件范围 / 入口策略待云端 A（`release_appendix_document_review`）盘点交付后交叉引用；本清单 §5 的页面范围仅以 750809c 仓库内容为准，不代替 A 的组件盘点结论。

---

## 9. 未验证 / 待取得清单

| 项 | 状态 | 说明 |
|---|---|---|
| 平台展示版本 / 上传时间 ↔ 750809c 绑定 | 待取得（IN-01） | 需平台侧人工只读核对；未核对不得进入真机冒烟 |
| 体验成员实际名单 / 角色 | 待补（IN-02） | 仅占位；不写真实 openid / 姓名 / 证件 / 照片 |
| 组件范围 / 入口策略 / 具体执行授权 | 待补（IN-03 / IN-04） | 待用户确认；待云端 A 交付交叉引用 |
| 环境代号 / 隔离核验 / 测试会话 / 失败注入方案 | 待补（IN-05/06/07） | 未取得不执行 |
| 账号切换 / 不在名单账号专项 | 未授权（IN-10） | 负向用例 WE-N03/N05 依赖 |
| 旧 8 项真机冒烟 | 历史 0/8 PASS、0 FAIL、8 BLOCKED（2026-11-14） | 非本轮实测，不自动恢复 |
| 设备能力（HK-AI-06B） | 0 执行、Q01–Q35 open | 独立 H 层门禁，本清单不覆盖 |
| 回滚锚点 | 不可证明可用（REL-AI-03 §11.6） | 发布前硬门禁；冒烟不解除 |
| 云端 B 评分 / 关联规则 | 待取得 | §8；未取得不得声称一致 |
| 支付是否在范围 | 未知 / 待定 | WE-F04 冻结单列 |

---

## 10. 边界与禁令（本清单口径）

1. 本清单**不执行**：不上传、不扫码、不连接云 / 设备 / 端口、不运行测试 / 静态 / 来源校验 / 构建 / 安装 / 源码脚本、不创建 PR / 合并、不改全局 / 系统 Git / TLS / 代理 / 安全配置。
2. 本清单**不宣称**：真机通过、CORE-01 通过、旧 8 项自动恢复、设备现场识别通过（`ready` / `pending-site` 仅是「待现场刷脸验证」）、云端 A / B / C 已交付或可本地查询。
3. 截图仅集合名可见（环境 / 角色 / caseId / 时间），**不构成权限或关联证据**。
4. P3 已关闭不再修；渠道既定微信测试体验版不再询问。
5. 本清单为一份 MD、一笔 commit；完成后停手，交 Codex 独立**仅文档**复审；不自批 NO-GO 解除、不启动下一阶段、不重复派单。

---

## 11. 变更记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v1 | 2026-11-25（Asia/Shanghai） | 初版编排：固定引用与候选调用链速查（§0）、前置授权门（§2）、角色占位（§3）、证据格式与五类来源（§4）、旧 8 项映射 WE-01..08（§5.1）、默认只读序列（§5.2）、新入住 / 人脸负向场景 WE-N01..N11（§5.3）、云写专项 WE-W01..W04（§5.4）、冻结单列 WE-F01..F06（§5.5）、执行顺序（§5.6）、失败停止 F-WE01..07（§6）、云端 B 接口依赖（§8）、待取得清单（§9）、边界与禁令（§10） | 本 Harness 会话（独立文档任务，未派子代理） |
