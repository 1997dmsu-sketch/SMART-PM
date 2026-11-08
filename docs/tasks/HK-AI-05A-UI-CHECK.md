# HK-AI-05A 独立 QA 验证记录（UI-CHECK）

> 本文件由 **hk05a-qa-verify（独立 QA）** 新建。**未修改** `HK-AI-05-STATIC-UI-AUDIT.md`、
> `HK-AI-05-RENDER-CHECK.md`、`references/`、以及 `screenshots/` 根下 21 个既有证据文件。
> **Codex 复审通过前，不得据此宣称「演示页面已通过」；不制作演示包、不合并 main。**
>
> **复审后更新**：正式复审 `4725608`（`HK-AI-05A-UI-REVIEW-61FD240-2026-11-08.md`）结论为
> 「暂不通过；两项定点修复后复审」。本记录已按 P1-1 / P1-2 定点修复及复跑结果更新，新增
> **§13 复审定点修复与复跑留证**。核心 UI 方向、D1–D6 裁定不变。

## 0. 元信息与口径

| 项 | 值 |
|---|---|
| 验证对象 | `33ce350`（基线 `708c3ab`），分支 `feat/hk-face-admin`；复审修复追加提交（HEAD 由 `61fd240` 起） |
| 目标 worktree | `.tmp-hk-push`；另一个独立仓库 `hk-face-admin/`（HEAD `3b2339b`）**未触碰** |
| 判定标准 | `.tmp-hk-05a-acceptance.md`（team-lead 汇编，10 节） |
| 环境 | Node `v22.22.2`、Chrome `156.0.8078.81`（`--headless=new`）、`file://` 离线、每次独立 `--user-data-dir` |
| 运行时驱动 | Node 22 内置全局 `WebSocket` 连接本地回环 CDP（`--remote-debugging-port=0`）；**CDP 是 DevTools 协议，不属于页面运行时网络请求** |
| 静态脚本 | `hk-face-admin/tests/hk-ai-05a-static-check.mjs`（零第三方依赖，退出码 0/1） |
| CDP harness | `hk-face-admin/tests/hk-ai-05a-cdp-verify.mjs`（出图 + 运行时验证，零第三方依赖；`CHROME_BIN` 优先 + 跨平台探测，见 §12 / §13） |
| 结构化证据 | `hk-face-admin/tests/hk-ai-05a-verify-result.json` |
| 截图 | `docs/tasks/screenshots/hk-ai-05a/`（新建独立子目录，21 张 PNG） |

**结论摘要（含复审定点修复后复跑，详见 §13）**

- 静态检查：**31 PASS / 0 FAIL**（退出码 0；复审 P1-1 新增「冻结权限白名单」断言，30→31）。
- CDP 运行时验证：**26 PASS / 0 FAIL**（退出码 0；既有 26 项验收断言未改）。
- 六态 × 四业务页 **24/24** 组合通过；console error **0**。
- **网络请求 0、真实设备 / Provider 调用 0**（CDP `Network.requestWillBeSent` 非 `file://` 计数 = 0；复跑 `total=117 / file=117 / nonFile=0`）。
- 21 张截图：IHDR **21/21**、innerText 脱敏 10 类正则 **0 命中**、Mock 横幅逐字 + 四项 **21/21**、人工目视 **7 张通过**。
- 既有 21 个证据文件 SHA-256 **出图前后完全一致，且与 `708c3ab` 基线逐字节一致**。
- **未发现页面代码缺陷**；有 6 项「口径差异 / 观察项」如实列于 §10，交 team-lead / Codex 裁定。
- 复审两项定点修复（P1-1 权限点 `device.face.read`→`device.manage`、P1-2 便携 Chrome 探测）已完成并留证，见 **§13**。

## 1. 任务卡 7 项自动检查实测（静态脚本，逐项 PASS/FAIL）

| # | 检查 | 结果 | 实测值 |
|---|---|---|---|
| 1 | 所有 HTML 内链存在 | **PASS** | 44 个 `href/src`，精确白名单等值 + 文件真实存在，异常 0 |
| 2 | 页面零外部 URL、零网络 API | **PASS** | 8 类模式（§8）在 8 文件白名单命中 0 |
| 3 | 禁显词和值扫描 | **PASS** | 字段名层 65 个字段位命中 0；值层 10 类正则命中 0；代号化 + 门牌/地址模式 0 |
| 4 | 六态 selector 四业务页可切换且无异常 | **PASS** | 4 页 × 6 选项 + 逐字标注 + `data-state-root`；**运行时 24/24 见 §3** |
| 5 | UNKNOWN_RESULT 不出现可执行再次新增 / 自动重试 | **PASS** | 静态 6 条 + CDP DOM 层 4 条全通过（§4） |
| 6 | Escape 关 toast，Tab 可见焦点 | **PASS** | 源码 `Escape/keydown`、`:focus-visible` 7 处；CDP 真实按键 + Tab 序列通过（§6） |
| 7 | `git diff --check` 通过 | **PASS** | `708c3ab..HEAD` 退出码 0、stdout 空 |

静态脚本另含：§5 横幅（5 页 × 5 项逐字）、§6 a11y（面包屑 5/5、toast 5/5、返回控件）、§8 零网络、以及「21 个既有证据文件 SHA-256 与 `git show 708c3ab` 基线一致」检查（基线取自 git 历史，工作树无法污染）。
复审 P1-1 另增「HK-AI-05 冻结权限白名单」1 条断言（30→31），实跑 31 PASS / 0 FAIL，见 §13.2。

## 2. 禁显词扫描（字段名层 vs 值层，分开归类）

- **字段名层（§2B）**：遍历 `<th>` / `<label>` / `<option>` / `placeholder` / `app.js` 的 `th()` / `kv()` 键，共 65 个字段位，命中 `IP|摘要|objectKey|序列号|MAC|凭据|requestDigest|checksum` = **0**。基线 `audits.html:79` 的「IP / 终端」「详情摘要」整列已删除。
- **值层（§2C）**：10 类正则（IPv4 / 手机号 / 身份证 / MAC / email / 外部 URL / 长字母数字串 / 长数字串 / 凭据字段 / 图片字节）对 8 个源码文件 + 5 页静态可见文本扫描，**0 命中**；对每张截图 `document.body.innerText` 再跑一次，**21/21 为 0 命中**。
- **误报处置（严格按规格）**：裸 `live` 只遍历可点击控件 textContent/value（76 个 token，0 命中，`aria-live` 在属性不计）；`真实设备生效：否` 为允许文案，仅禁肯定式误导（0 命中）；设计术语 `token` / CSS 变量 / 本地内链 / 裸 `url(` / `file://` 说明均允许；CSS 十六进制颜色字面量（如 `#222222`）非展示数据，值层扫描前剥离并用 `(?<!#)` 双保险。
- **代号化**：`人员代号` / `房间代号` / `脱敏` / `代号` 标识词齐全，`\d+栋\d+单元\d{3,4}` 门牌与具体地址模式 0 命中；真实姓名 / 房号 / 地址另由截图人工目视兜底（§8）。

## 3. 六态 × 四业务页 24 格矩阵（真浏览器 CDP）

切态方式：`document.querySelector('[data-state-select]').value = <state>; .dispatchEvent(new Event('change'))`（IIFE 内 `applyState` 经 select 的 `change` 监听重渲染 `[data-state-root]`）。

| 页 | ready | loading | empty | forbidden | error | retrying |
|---|---|---|---|---|---|---|
| devices | OK | OK | OK | OK | OK | OK |
| applications | OK | OK | OK | OK | OK | OK |
| tasks | OK | OK | OK | OK | OK | OK |
| audits | OK | OK | OK | OK | OK | OK |

每格硬断言（24/24 通过）：

- `data-ui-state` 与 `select.value` 均等于目标态；`location.href` 不变、不 reload。
- `[data-state-root].innerHTML` 与相邻态**不同**，且 DOM 结构签名（标签名 + class 序列）**也不同** —— 不只是换文字（20 次相邻比较全部双重差异）。
- 同一时刻 `.state-view` ≤ 1、无 `[hidden]` / `[aria-hidden="true"]` 残留；每次整块替换 innerHTML，无上一态 DOM 残留。
- `localStorage.length === 0 && sessionStorage.length === 0`（24/24 实测 0/0）。
- console error（`exceptionThrown` / `console.error` / `log.error`）= **0**。
- 切到 `error` 后 `Page.reload` → **4/4 回 `ready` / `ready`**。

## 4. UNKNOWN_RESULT 红线（§4，静态 + DOM 双层）

- `rg '再次新增|重新新增|再次下发|重复写入'` → **0**；`autoRetry|automaticRetry|自动重发` → **0**；基线旧文案「重试失败任务 / 可重试」→ **0**。
- 受控重试按钮渲染条件绑定 `t.retryable`（`unknown` 分支在前、`data-action="retry"` 只在其后出现）；全站 `[data-action="retry"]` = **1**，且只在 `retryable_failed / RETRYABLE` 行。
- **CDP DOM 层**：`awaiting_result / UNKNOWN_RESULT` 行 = 1，其按钮仅 `["query","reconcile"]`；无可执行重试、无「再次新增」类入口；含「查询」与「人工对账」。
- **权限门控**：真实鼠标点击取消 `#perm-retry` 勾选 → 重试按钮 `disabled=true`，`title="缺少 device.operation.retry 权限，不可操作"`，`#retry-perm-hint` 文本「缺少 device.operation.retry：受控重试按钮已禁用，不可操作。」；重新勾选恢复 `disabled=false`。
- 点击受控重试后 `location.href` 不变、两种存储长度 0、非 `file://` 网络计数不变（0→0）。

> **口径差异 D1（见 §10）**：验收规格 §4 第 2 条字面要求 `rg '自动重试' → 0`，但任务卡 §5 要求「自动重试禁用」。实现用 10 处**否定式禁用声明**（「已关闭 / 禁用 / 不自动重试 / 不提供 / 不执行」）表达该冻结契约。静态脚本按 §5 的 `live` 范式只判定按钮/选项/操作属性（**0 命中**），并把 10 处字面命中 + `<a>` 导航卡片 1 处描述文字作为 INFO 全量披露。**未按字面判 FAIL，也未隐藏**，交 Codex / team-lead 裁定。

## 5. Mock 横幅（5 页 × 屏幕态 / 打印态 / 对比度）

- **逐字文案** `Mock 演示，未连接真实门禁` + 四项 `executionMode=test` / `provider=mock` / `evidenceScope=simulated` / `真实设备生效：否`：静态 5/5 页命中；21 张截图 `innerText` **21/21** 命中。
- **文字 + 颜色双通道**：`.mock-banner` 有 `background:#3a1119`、`border-left:6px solid var(--brand)`、`MOCK · 演示` 徽标、`.no` 状态项；不只依赖颜色。
- **无 live 切换按钮**：76 个可点击 token 0 命中；无肯定式误导文案（`已同步真实设备|真实授权已生效|已连接真实门禁|真实设备已生效|device_verified|同步真实设备|真实设备生效：是`）0 命中。
- **打印态（CDP `Emulation.setEmulatedMedia({media:'print'})`）**：`.mock-banner` computed `display=flex`、`visibility=visible`；`innerText` 仍含逐字文案 + 四项 4/4。`styles.css` `@media print` 隐藏清单不含 `.mock-banner`，且有 `.mock-banner { display:flex !important; }` 与 `print-color-adjust:exact`。截图 `devices-print-mock-banner.png` 人工目视确认横幅保留、侧栏/按钮/状态栏隐藏。
- **对比度实算（WCAG 相对亮度公式，computed style 取实际不透明背景，半透明层向上合成）**：

| 类别 | 元素 | fg | bg | 比值 |
|---|---|---|---|---|
| Mock 横幅 | `.mock-lead` | `#ffffff` | `#3a1119` | **16.48:1** |
| Mock 横幅 | `.mock-status` | `#ffe9ec` | `#3a1119` | **14.22:1** |
| Mock 横幅 | `.mock-status .no` | `#ffd0d7` | `#3a1119` | **11.97:1** |
| Mock 横幅 | `.mock-status code` | `#ffffff` | `rgba(255,255,255,.14)`→`rgb(86,50,57)` | **10.98:1** |
| Mock 横幅 | `.mock-flag` | `#a3152b` | `#ffffff` | **7.78:1** |
| `--text-2` | `.crumb/.stat-label/.stat-hint/.muted/.hero p/.module-card p` | `#5c5c60` | `#ffffff` | **6.66:1** |
| `--text-2` | `.sub/.muted` | `#5c5c60` | `#f5f5f7` | **6.11:1** |
| `--text-2` | `.state-note` | `#5c5c60` | `#fff6f7` | **6.27:1** |

共 26 个实测元素，**最小 6.11:1、最大 16.48:1，全部 ≥ 4.5:1**（基线 FAIL 值 `--text-2 #888889` on `#fff` 3.54:1 已由 `#5c5c60` 修正）。
**作用域仅限「Mock 横幅 + 次级文字」**（任务卡点名），不引申为全站达标；证据性质 = computed style + 公式推断，**非正式 WCAG 认证**。

## 6. 键盘焦点 / toast / 窄屏表格 / 返回路径（§6）

- `:focus-visible` 只读源码 Grep：7 处（含 `.table-wrap:focus-visible`）；`file://` 下 CSSOM `cssRules` 访问实测为 `SecurityError`（跨源拒绝），**focus 样式存在性只以只读源码 Grep 为据，未用运行时规则枚举反推**。
- **CDP 真实按键**：`Input.dispatchKeyEvent(keyDown Escape)` 关闭 toast（`hidden=true`）；真实鼠标点击 `#toast-close` 同样关闭；`Enter` 合成按键带 `text:'\r'` 可激活聚焦按钮；toast 为 `role="status" aria-live="polite"` + 可聚焦关闭按钮（5/5 页）。
- **900×768 Tab 序列**：12 步内 12 个可聚焦元素 `matches(':focus-visible') === true` 且有可见 outline（`#0b57d0`）；第 12 步 Tab 到 `.table-wrap`（显式 `tabindex="0"`）；`.table-wrap` `scrollWidth=1003 > clientWidth=592`（有被裁列），`ArrowRight`（`keyDown`）使 `scrollLeft 0 → 12`。
- **返回路径**：5/5 页 `.crumb` 内含 `<a href="index.html">概览</a>`；`app.js` 生成 `.back-link`「返回概览」；`.is-active` / `aria-current` 注入存在。
- **口径差异 D2（见 §10）**：规格 §6 写「四业务页 `.table-wrap` 各有显式 `tabindex="0"`」，而规格 §3 把 `applications` ready 态定义为「合成申请详情」（`detail-grid`，无表格）。实现为 `devices/tasks/audits` 三张表各带显式 `tabindex="0"`（**3/3**），`applications` 页无 `.table-wrap`。按「有表格的页面」判定，差异如实上报。

## 7. 零网络口径与运行时网络（§8）

- 静态：8 类必须零命中模式（`https?://`、协议相对 `//domain.tld`、`fetch(/XHR/WebSocket/EventSource/sendBeacon`、`@import`、`url(http|//`、`<script>/<link>` 外链、凭据 API 字段、`localStorage/sessionStorage/indexedDB`）在 8 文件白名单 **全部 0 命中**。允许项：本地内链 `styles.css`/`app.js`/5 HTML、`file://` 说明、设计术语 `token`、CSS 变量、状态值、`aria-live`、`data-state`、裸 `url(`。
- 运行时：CDP `Network.enable` 整轮 `requestWillBeSent` **总事件 96，全部为 `file://` 子资源**（`styles.css` / `app.js` 加载，规格明示「`file://` 协议本身不计」）；**非 `file://` = 0**。复审复跑一次为 `total=117 / file=117 / nonFile=0`，非 `file://` 仍为 0（见 §13）。Chrome 以 `--disable-background-networking --disable-component-update --disable-sync --disable-extensions --disable-domain-reliability --safebrowsing-disable-auto-update` 等离线参数启动。
- **网络请求 0、真实设备 / Provider 调用 0。**

## 8. 21 张脱敏截图清单（全部进 `docs/tasks/screenshots/hk-ai-05a/`）

所有 PNG：签名 `\x89PNG\r\n\x1a\n` + `IHDR`，宽高与文件名一致（独立 Node 交叉复核 `checked=21 bad=0`）；`document.body.innerText` 10 类值正则 0 命中；Mock 横幅逐字 + 四项命中。

| 组 | 文件 | 数量 | 尺寸 | 状态 |
|---|---|---|---|---|
| 五页 1366×768 | `index-1366x768.png`、`devices-1366x768.png`、`applications-1366x768.png`、`tasks-1366x768.png`、`audits-1366x768.png` | 5 | 1366×768 | ready 首屏 |
| 四业务页 1440×900 | `devices-1440x900.png`、`applications-1440x900.png`、`tasks-1440x900.png`、`audits-1440x900.png` | 4 | 1440×900 | ready |
| 四业务页 1920×1080 | `devices-1920x1080.png`、`applications-1920x1080.png`、`tasks-1920x1080.png`、`audits-1920x1080.png` | 4 | 1920×1080 | ready |
| 任务页 UNKNOWN_RESULT | `tasks-state-unknown-result-1366x768.png` | 1 | 1366×768 | ready，滚动聚焦 `UNKNOWN_RESULT` 行 |
| 申请页无私密读取权限 | `applications-state-forbidden-readprivate-1366x768.png` | 1 | 1366×768 | ready，滚动聚焦 `.private-box`（`readPrivate` 未勾选） |
| 四态各一页 | `devices-state-loading-1366x768.png`、`applications-state-forbidden-1366x768.png`、`tasks-state-error-1366x768.png`、`audits-state-retrying-1366x768.png` | 4 | 1366×768 | loading / forbidden / error / retrying |
| 复审定向证据（P1-1） | `devices-state-forbidden-1366x768.png` | 1 | 1366×768 | forbidden，显示 `device.manage` 缺失权限文案 + Mock 横幅 |
| 打印态 Mock 边界 | `devices-print-mock-banner.png` | 1 | 1366×768 | `Emulation.setEmulatedMedia({media:'print'})` |

合计 **21 张**（5+4+4+1+1+4+1+1）。

**人工目视（7 张）**：`devices-1366x768`、`tasks-state-unknown-result`、`applications-state-forbidden-readprivate`、`devices-print-mock-banner`、`applications-state-forbidden`、`devices-state-loading`、`index-1366x768` —— 均为 DEMO 前缀合成代号（DEV-DEMO / MODEL-DEMO / FW-DEMO / PERSON-DEMO / ROOM-DEMO / APP-DEMO / JOB-DEMO），**无真实人员姓名、房号、地址、手机号、身份证、MAC/IP、序列号、凭据、人脸图片、外链或字节内容**；私密区域仅「需逐次授权查看（演示占位）」；UNKNOWN_RESULT 行仅「查询 / 人工对账」。

> **展示取舍 D3（见 §10）**：`tasks-state-unknown-result` 与 `applications-state-forbidden-readprivate` 两张为特写，用 `scrollIntoView` 聚焦目标行/区域，故 Mock 横幅位于视口之外。横幅可见性由：基础 5 张 1366×768 首屏截图、21/21 `innerText` 命中、`devices-print-mock-banner.png` 打印态截图共同证明。

## 9. 既有 21 个证据文件 SHA-256 前后一致

- 出图前记录 21 个文件（20 PNG + 1 PDF）SHA-256；出图后重算，**前后差异 0**。
- 与 `git show 708c3ab:<path>` 基线内容逐字节比对，**21/21 一致**（基线来自 git 历史，工作树无法污染）。
- 独立工具链交叉复核（`sha256sum` + `git show`，不复用 harness 的 Node `crypto`）：`checked=21 mismatch=0`（复审复跑后再次核验，见 §13.6）。
- `git diff --name-only 708c3ab -- docs/tasks/screenshots/` 排除 `hk-ai-05a/` 后 = **无 tracked 变更**。
- `HK-AI-05-STATIC-UI-AUDIT.md`、`HK-AI-05-RENDER-CHECK.md`、`references/` 5 文件未修改。

## 10. 口径差异 / 观察项（如实上报，非页面缺陷，交 team-lead / Codex 裁定）

| 编号 | 内容 | 处置 |
|---|---|---|
| **D1** | 规格 §4 字面 `rg '自动重试' → 0` 与任务卡 §5「自动重试禁用」存在口径张力；实现有 10 处**否定式禁用声明** + 1 处首页导航卡片描述文字 | 按 §5 `live` 范式只判定可操作控件（0 命中，PASS）；10 处字面 + 1 处 `<a>` 描述已由静态脚本 INFO 全量披露（含 `文件:行号` 与上下文）。**未判 FAIL、未隐藏** |
| **D2** | 规格 §6「四业务页 `.table-wrap` 各有」vs 规格 §3 `applications` ready 为详情网格（无表格） | 实现 3 张表 3/3 带 `tabindex="0"`，按「有表格的页面」判定；CDP 在 900×768 实测 Tab 可达并方向键滚动 |
| **D3** | 两张特写截图因滚动聚焦目标行，Mock 横幅在视口之外 | 由基础 5 张首屏 + 21/21 `innerText` + 打印态截图共同证明横幅可见性 |
| **D4** | CDP 方向键使 `scrollLeft 0→12`（生效），`End` 合成按键在 headless 下未进一步滚动 | 规格要求「方向键 / End 可滚入被裁列」，方向键已生效；`End` 行为如实记录为运行时限制，未引申为页面缺陷 |
| **D5** | 对比度作用域 | 仅限「Mock 横幅 + `--text-2` 类次级文字」，computed style + 公式推断，**非正式 WCAG 认证**，不引申为全站达标 |
| **D6** | `file://` CSSOM `cssRules` 实测 `SecurityError` | 符合规格预期；focus 样式存在性只以只读源码 Grep 为据，未用运行时规则枚举反推 |

**页面代码缺陷：无。** 静态 31/31、CDP 26/26 通过；未发现需要实现工程师修复的失败项（唯一一次 C7.3 FAIL 为 QA harness 自身用不冒泡 `new Event('change')` 触发 `document` 委托监听所致，改用真实鼠标点击后通过，**与页面代码无关**）。复审 P1-1 指出的「未冻结权限点」为**规格符合性**问题，已按复审要求在本轮定点修复，见 §13。

## 11. 未验证项与限制（对齐规格 §9，不扩大范围）

- 48 个未冻结字段 ↔ 冻结 DTO 符合性、N-01 状态机命名冲突、N-06 表格语义与筛选枚举、N-08 文档表述、完整告警组件 / 七态状态机、DTO 定义补齐 —— 未涉及。
- 1024 / 1280 另 3 页补测、≤760px 断点、375/414 窄屏、高 DPI / UI 缩放、跨浏览器（Firefox / Safari / 旧 Chrome）、真实键盘硬件、多页打印分页、真实屏幕阅读器、正式 WCAG 认证、像素级逐图比对、三尺寸逐格 computed style 留档 —— 未做。
- 服务层 / 后端权限真实生效、真实 Provider / 设备调用、HTTP 接线、合并 `main`、改写 `708c3ab` 历史 —— 任务卡明确禁止，未做。
- 既有 21 个证据截图的**内容**复审未做（只校验未被改动，未重拍、未覆盖）。
- `aria-current` 静态 HTML 兜底（禁用 JS / 打印态丢失）不在本任务范围。
- 对比度结论为 CDP computed + 公式计算推断；`localStorage/sessionStorage` 在 `file://` 下可访问且实测长度 0，未覆盖其它 origin 策略。
- 打印态用 `Emulation.setEmulatedMedia({media:'print'})`（CSS media 生效）出 PNG，未用 `--print-to-pdf`；未验证分页。
- 本轮 P1-2 仅在 Windows 实跑（`CHROME_BIN` 成功/失败分支 + 默认平台探测）；darwin / linux 候选路径为静态代码审查，未在对应平台实跑（复审排除跨浏览器认证）。

## 12. 复现命令

```bash
cd /c/Users/Administrator/WorkBuddy/2026-10-23-16-18-12/.tmp-hk-push
NODE="/c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"

# A. 静态检查（退出码 0/1，逐项 PASS/FAIL，含 21 文件 SHA-256 基线比对 + P1-1 权限白名单）
"$NODE" hk-face-admin/tests/hk-ai-05a-static-check.mjs

# B/C. CDP 出图 + 24 组合 + 运行时 8 项（自动启动 headless Chrome，file:// 离线）
"$NODE" hk-face-admin/tests/hk-ai-05a-cdp-verify.mjs
# 产物：docs/tasks/screenshots/hk-ai-05a/*.png、hk-face-admin/tests/hk-ai-05a-verify-result.json

# B/C（指定浏览器，复审 P1-2）：CHROME_BIN 优先级最高，非空即用并校验文件存在
CHROME_BIN=/path/to/chromium "$NODE" hk-face-admin/tests/hk-ai-05a-cdp-verify.mjs
# 未设置时按 process.platform 探测 win32/darwin/linux 常见路径，再以 which/where 兜底；
# 找不到浏览器则输出候选路径清单 + CHROME_BIN 提示后退出 1，不产生任何截图。

# 独立交叉复核
git diff --check 708c3ab..HEAD
for p in $(git ls-tree -r --name-only 708c3ab -- docs/tasks/screenshots/); do \
  [ "$(git show "708c3ab:$p" | sha256sum | cut -d' ' -f1)" = "$(sha256sum "$p" | cut -d' ' -f1)" ] || echo "MISMATCH $p"; done
```

## 13. 复审定点修复与复跑留证（P1-1 / P1-2）

> 依据：`git show origin/docs/lock-01-fast-track:docs/tasks/HK-AI-05A-UI-REVIEW-61FD240-2026-11-08.md`（49 行，
> 结论「暂不通过；两项定点修复后复审」）。核心 UI 方向已认可（Mock 边界、六态、UNKNOWN_RESULT、
> 禁显、截图、权限分离）；**下一提交只修两项及受影响证据**。本轮不 amend、不改写 `708c3ab`/`33ce350`/
> `07e7616`/`61fd240` 历史，单个追加提交，不 push。

### 13.1 P1-1：设备页未冻结权限点 `device.face.read` → `device.manage`

冻结权限白名单（5 个，复审锁定）：`device.manage`、`device.face.review`、`device.face.readPrivate`、`device.operation.retry`、`device.audit.read`。
`device.face.read` 不在其中；`device.face.readPrivate` 为合法冻结权限，**未改动**。

| 文件:行号 | 修改前 | 修改后 |
|---|---|---|
| `hk-face-admin/app.js:121` | `devices: "device.face.read",` | `devices: "device.manage",` |
| `hk-face-admin/app.js:149` | `var perm = PERM_NOTE[p] \|\| "device.face.read";` | `var perm = PERM_NOTE[p] \|\| "device.manage";` |
| `hk-face-admin/README.md:51` | `` `forbidden` 态分别对应缺少 `device.face.read` / … `` | `device.manage` / … |

- 静态脚本 `hk-ai-05a-static-check.mjs` 新增 1 条断言：扫描 8 个页面交付文件所有 `device\.[A-Za-z.]+` 字面，
  断言全部落在 5 个白名单内，且 `/device\.face\.read\b/` 不命中（`readPrivate` 中 `read` 后接 `P` 非词边界，
  不误伤）。断言数 **30 → 31**。
- 新增定向证据 `docs/tasks/screenshots/hk-ai-05a/devices-state-forbidden-1366x768.png`：
  IHDR `1366×768`、`78040B`、签名 OK；`innerText` 10 类值正则 0 命中；Mock 横幅逐字 + 四项命中；
  state=`forbidden`，清楚显示 `device.manage` 缺失权限文案。

### 13.2 静态脚本复跑

```
=== 汇总：31 PASS / 0 FAIL ===   EXIT=0
PASS  P1-1 冻结权限白名单：页面源码 device.* 字面全部落在 5 个冻结权限内，且无 device.face.read
      ::  命中 device.audit.read, device.face.readPrivate, device.face.review, device.manage,
          device.operation.retry；越界 0；device.face.read\b 命中 false
PASS  21 个既有证据文件 SHA-256 与 708c3ab 基线逐字节一致  ::  21/21 一致
```

### 13.3 P1-2：CDP 脚本硬编码 Windows Chrome 路径 → 便携探测

`hk-ai-05a-cdp-verify.mjs` 移除 `const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";`，改为：

- `platformChromeCandidates()`：按 `process.platform` 列候选 —— win32（含 `Program Files (x86)`、`%LOCALAPPDATA%`）、
  darwin（`/Applications/Google Chrome.app/...`、`~/Applications/...`、Chromium.app）、
  linux（`/usr/bin/google-chrome*`、`/usr/bin/chromium*`、`/snap/bin/chromium`）。
- `resolveChrome()`：`CHROME_BIN`（非空即用并 `fs.existsSync` 校验）→ 平台候选 → `which`/`where` 兜底。
- `failChrome()`：找不到时打印 `ERROR` + `CHROME_BIN` 值 + 候选路径清单（逐条 `[存在]/[不存在]`）+
  `CHROME_BIN=/path/to/chromium node ...` 提示 + 「浏览器解析阶段即退出，未产生任何截图」，`process.exit(1)`。
- `launchChrome(chromePath)`：`spawn(chromePath, ...)` 并新增 `proc.on("error", ...)` 监听，错误信息指向所选路径，退出 1。
- 头部用法注释、`hk-face-admin/README.md` §11、本文件 §12 均补充 `CHROME_BIN` 用法。
- **不改变页面零网络约束、不改变既有 26 项验收断言**；仅因新增 1 张截图把 harness 的
  `SHOTS` 与「B/C N 张截图」断言从 20 改 21（这是受影响证据，非新增验收项）。

### 13.4 CDP harness 复跑（默认路径 / CHROME_BIN 成功分支）

| 分支 | Chrome 来源行 | 断言 | 网络 | console error | 退出码 |
|---|---|---|---|---|---|
| 默认路径（平台探测） | `INFO  Chrome 来源：平台探测 = C:/Program Files/Google/Chrome/Application/chrome.exe` | **26 PASS / 0 FAIL** | `nonFile=0` | 0 | 0 |
| 显式 `CHROME_BIN` 成功 | `INFO  Chrome 来源：CHROME_BIN = C:/Program Files/Google/Chrome/Application/chrome.exe` | **26 PASS / 0 FAIL** | `nonFile=0` | 0 | 0 |

结构化证据 `hk-face-admin/tests/hk-ai-05a-verify-result.json`（最后一次成功复跑，即 `CHROME_BIN` 成功分支）：

```
assertions=26  allOk=true  fails=0
network={"total":117,"file":117,"nonFile":0,"samples":[]}
consoleErrors=[]  （长度 0）
screenshots=21
newShot(devices-state-forbidden)={"ihdr":{"sigOk":true,"width":1366,"height":768,"bytes":78040,"ok":true},
                                 "leaks":[],"banner":true,"state":"forbidden"}
evidenceIntegrity={"beforeCount":21,"afterCount":21,"beforeAfterChanged":[],
                   "baselineMismatch":[],"allConsistent":true}
```

> 说明：默认路径复跑日志曾为 `total=99 / file=99 / nonFile=0`；最后一次结构化 JSON 记录的是
> `CHROME_BIN` 成功分支后的 `117 / file=117 / nonFile=0`。两者**非 `file://` 请求均为 0**，满足规格。

### 13.5 CHROME_BIN 失败分支实测

临时设不存在的 `CHROME_BIN=C:/__definitely_not_exists__/chrome.exe`（内联环境变量，未持久化，测后即失效）：

```
EXIT=1
ERROR: CHROME_BIN 指向的文件不存在。
  CHROME_BIN = C:/__definitely_not_exists__/chrome.exe
已探测的候选路径清单：
  - C:/Program Files/Google/Chrome/Application/chrome.exe  [存在]
  ...
解决办法：设置环境变量后重试，例如：
  CHROME_BIN=/path/to/chromium node hk-face-admin/tests/hk-ai-05a-cdp-verify.mjs
浏览器解析阶段即退出，未产生任何截图。
PASS  文件清单一致（无新增截图）
PASS  21 张截图 SHA-256 完全一致（无覆盖）
PASS  verify-result.json 未被改写
```

结论：退出码 1、明确错误、候选清单、`CHROME_BIN` 提示齐全；**无新截图、未改写结构化证据**。

### 13.6 重跑截图字节变化（如实列出，未静默覆盖）

复审说明「其余 20 张不应因这次改动而需要重拍——若重跑 harness 导致字节变化，请如实列出」。
以修复前 20 张 SHA-256 与最终工作树对比（修正了 `sha256sum` 对二进制输出的 `*` 前缀误判后）：

```
compared=20  changed=1
CHANGED  docs/tasks/screenshots/hk-ai-05a/audits-state-retrying-1366x768.png
         before=5e9681d3d128deb689be  after=3a431498c428e5c83100
```

- 唯一变化为 `audits-state-retrying-1366x768.png`（`retrying` 受控重试进度为**动画态**，CDP 每次
  `Page.captureScreenshot` 落在动画的不同帧，导致像素/字节差异；**非页面代码改动、非权限点改动引起**）。
- 其余 19 张 SHA-256 完全一致；新增第 21 张为 `devices-state-forbidden-1366x768.png`。
- 独立 Node IHDR 复核：`checked=21 bad=0`（21 张签名与文件名宽高全部一致）。
- 既有 `docs/tasks/screenshots/` 根下 21 个原始证据：独立交叉复核 `checked=21 mismatch=0`，
  与 `708c3ab` 基线逐字节一致，前后差异 0、基线差异 0。

### 13.7 本轮边界

- 只修 P1-1 / P1-2 及受影响证据；未扩大到正式 DTO、跨浏览器 / 屏幕阅读器认证、1024/1280 补测等复审排除项。
- 不接 API、不改后端、不调 Provider、不连设备、不合并 main、不制作演示包、不改写历史、不 push。
- **Codex 复审通过前不宣称「演示页面已通过」。**

## 14. 结论

HK-AI-05A 改造结果在**静态检查（31/31）**与**真浏览器 CDP 运行时验证（26/26）**下全部通过：六态 24/24、UNKNOWN_RESULT 红线、Mock 边界（含打印态）、Escape / Tab / 焦点、对比度（最小 6.11:1）、零存储写入、console error 0。**网络请求 0、真实设备 / Provider 调用 0**；21 张脱敏截图 IHDR / 脱敏 / 人工目视通过；既有 21 个证据文件 SHA-256 前后与基线完全一致。

复审两项定点修复（P1-1 `device.face.read`→`device.manage` + 冻结权限白名单断言；P1-2 便携 Chrome 探测 + `CHROME_BIN` 成功/失败分支）已完成并留证（§13），核心 UI 方向与 D1–D6 裁定不变。

以上为**独立 QA 验证结论，不等于 Codex 复审通过**。**Codex 复审通过前不宣称「演示页面已通过」，不制作演示包，不合并 `main`。**
