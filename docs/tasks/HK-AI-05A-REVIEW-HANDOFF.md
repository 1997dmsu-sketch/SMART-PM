# HK-AI-05A 交 Codex 复审 · 交接说明

日期：2026-11-07
任务卡：`HK-AI-05A-ADMIN-UI-REMEDIATION.md`（`5f85396`）
分支：`feat/hk-face-admin`　基线：`708c3ab`　执行者：Workburry　复审者：Codex
状态：**请求复审中。Codex 通过前不宣称「演示页面已通过」，不制作演示包，不合并 main。**

## 1. 提交链与范围

| 提交 | 内容 | 文件数 |
|---|---|---|
| `708c3ab` | 基线：HK-AI-05 静态审计交付（已通过复审 `7655c28`） | — |
| `33ce350` | `feat(ui): add persistent mock boundary, synthetic states and reconciliation` | 8 个页面文件（876+/341-） |
| `07e7616` | `test(ui): add static checks and refreshed screenshots` | 24 文件（1 MD + 20 PNG + 3 tests） |
| 本交接说明提交 | `docs(hk-ai-05a): add review handoff notes` | 1 MD |

相对 `708c3ab` 的全部变更 = 页面 8 + 检查脚本 3 + 新截图 20 + 验证记录 1 + 本说明 1；**越界路径 0**（无 `admin-web` / 服务层 / 数据库 / store / blacklist / files / server 改动）。`708c3ab` 与 `33ce350` 哈希未变，历史未改写。

## 2. 验证结论（team-lead 独立复核后的数字）

- 静态检查 `hk-face-admin/tests/hk-ai-05a-static-check.mjs`：**30 PASS / 0 FAIL**，退出码 0（team-lead 独立实跑复现）。
- CDP 运行时验证 `hk-face-admin/tests/hk-ai-05a-cdp-verify.mjs`，结构化证据 `hk-ai-05a-verify-result.json`：**26 项断言 `ok:true` 全真**，0 失败；六态 × 四业务页 **24 组合**全通过（相邻态 DOM + 结构双重差异，非只换文字）；reload 4/4 回 `ready`；存储零写入。
- Network 域：`total=114 / file=114 / nonFile=0`，`consoleErrors=0`（以结果 JSON 为准；**非 file:// 请求 0**）。
- 对比度：26 元素实算，最小 6.11:1、最大 16.48:1，Mock 横幅与次级文字全部 ≥4.5:1。**作用域仅限 Mock 横幅 + `--text-2` 类次级文字**，非全站达标、非正式 WCAG 认证。
- 打印态：`.mock-banner` computed `display=flex` / `visibility=visible`，innerText 含逐字文案与四项。
- 键盘：900×768 下 12 步 Tab 全部 `matches(':focus-visible')` 且有可见 outline，第 12 步到 `.table-wrap`（显式 `tabindex="0"`），ArrowRight 使 `scrollLeft 0→12`。
- Escape / 点击均关闭 toast；Enter 带 `text` 可激活。
- UNKNOWN_RESULT：unknown 行按钮仅 `["query","reconcile"]`；`data-action="retry"` 只在 `app.js:252` 的 `t.retryable` 且非 `t.unknown` 分支；取消 `device.operation.retry` 后 disabled + 缺权限说明。
- 20 张新截图：`docs/tasks/screenshots/hk-ai-05a/`，IHDR 20/20 签名与文件名宽高一致、Mock 横幅 20/20 命中、10 类禁显值正则 20/20 零命中。
- **既有 21 个 HK-AI-05 证据文件**：与 `git show 708c3ab:<path>` **21/21 逐字节一致**；两份既有审计报告 `UNCHANGED`；`references/` 未修改。
- `git diff --check 708c3ab..HEAD`：退出码 0、stdout 空；工作树干净。

## 3. 复审必读：三个字面扫描会误判的点（高优先级）

### 3.1 `WebSocket` / `ws://127.0.0.1` 属验证工具链，不是页面网络请求

- `hk-face-admin/tests/hk-ai-05a-cdp-verify.mjs:162` 的 `new WebSocket(\`ws://127.0.0.1:${port}...\`)` 是 Node 22 内置全局 WebSocket 连接 **Chrome DevTools Protocol 本地回环**，仅用于离线渲染取证。
- `hk-face-admin/tests/hk-ai-05a-static-check.mjs:152` 的 `WebSocket` 是**检查正则的字面量**（用于判定页面零网络 API），不是调用。
- 页面运行时的 7 个文件（5 HTML + `styles.css` + `app.js`）对 `https?://` / `fetch(` / XHR / WebSocket / EventSource / sendBeacon / `<img` / `data:image` / `base64,` / `@import` / localStorage / sessionStorage **零命中**。
- CDP Network 域实测 `nonFile=0`。
- **请勿对全目录 grep `WebSocket` 就判定「新增网络请求」**：应排除 `hk-face-admin/tests/`，或按上述运行时口径判定。

### 3.2 「自动重试」字面 10 处全部是否定式禁用声明

任务卡 §5 原文是「自动重试禁用」「不出现『再次新增』」「受控重试按钮只在 retryable 状态展示」，是**行为约束**，不是文案禁令。实现中的 10 处命中均在表达「已关闭 / 禁用 / 不执行 / 不提供」：

```
app.js:117  未知结果先查询 / 人工对账，不自动重试（合成）
app.js:161  此错误态不提供自动重试；如需复核请切到 ready 使用「查询 / 人工对账」
app.js:170  仅受控重试，系统自动重试已关闭（冻结契约）
app.js:268  冻结契约：系统自动重试已关闭；未知结果（awaiting_result / UNKNOWN_RESULT）…
app.js:359  人工对账…不自动重试（本地演示）
app.js:360  不执行自动重试
index.html:84   合成任务…受控重试门控，自动重试禁用
index.html:102  系统自动重试禁用；受控重试仅在 retryable 状态且具备 device.operation.retry 时可操作
README.md:67    系统自动重试已关闭；受控重试按钮只在 retryable 状态
tasks.html:83   系统自动重试禁用，未知结果仅查询 / 人工对账，重复下发不提供
```

验收规格 §4 曾把 `rg '自动重试' → 0` 写成字面口径，属**规格汇编时过度收紧**（责任在 team-lead，不在实现）。裁定见 §4 D1。
静态脚本已把这 10 处以 INFO 全量披露（含文件:行号与上下文），**未判 FAIL、未隐藏**。

### 3.3 其它允许的合法字面

- `aria-live="polite"` 5 处是 a11y 属性，不等于「live 模式切换」；判定 live 入口应遍历可点击控件 textContent / value（实测 76 个控件 0 命中）。
- `真实设备生效：否` 是任务卡 §1 要求显示的只读状态，属允许文案；只禁「已同步真实设备」「真实授权已生效」等肯定式误导（实测 0 命中）。
- `IP / 终端`、`详情摘要` 两列已整列删除（含 `app.js` 渲染串零命中），新表头不含禁显词。

## 4. 口径差异裁定（D1–D6，team-lead）

| 编号 | 事项 | 裁定 |
|---|---|---|
| **D1** | 规格 §4「自动重试字面 0 命中」vs 任务卡 §5「自动重试禁用」 | **以任务卡行为口径为准，不判 FAIL。** 10 处均为否定式禁用声明，且恰恰是在表达「已禁用」；行为层已由 CDP 证明无可执行自动重试。已全量披露交 Codex 知悉。若 Codex 坚持字面口径，需另开任务删除这些说明文案（不推荐：会削弱状态边界表达）。 |
| **D2** | 规格 §6 写「四业务页 `.table-wrap` 各有 tabindex」，但规格 §3 把 applications ready 定义为详情网格（无表格） | **规格自身不一致，责任在 team-lead。** 任务卡 §7 原文只要求「表格在窄宽度下可键盘到达横向滚动容器」，故按「有表格的页面」判定：devices / tasks / audits 3/3 带显式 `tabindex="0"`，CDP 实测 Tab 可达且方向键滚动。非实现缺陷。 |
| **D3** | 两张特写截图用 `scrollIntoView` 聚焦目标行，Mock 横幅在视口之外 | 不构成缺陷。「持续可见 / 首屏可见」由 5 张基础首屏截图 + 20/20 innerText 命中 + 打印态截图共同证明。复审时请注意特写图的取景范围。 |
| **D4** | headless 下 `End` 合成按键未进一步滚动（ArrowRight 已生效 `0→12`） | harness 限制，如实记录；不扩大为跨浏览器验证，不据此判失败。 |
| **D5** | 对比度作用域 | 仅限 Mock 横幅 + 次级文字（任务卡 §7 点名范围），computed style + 公式推断，非全站达标、非正式 WCAG 认证。 |
| **D6** | `file://` 下 CSSOM `cssRules` = `SecurityError` | 符合规格：focus 样式以只读源码 Grep 为据，未用运行时规则枚举反推。 |

另：QA 曾对**刚创建、未推送**的第 4 个提交执行一次 `git commit --amend --no-edit`，用于修正其自身静态脚本中「既有截图目录无 tracked 变更」检查误把 `hk-ai-05a/` 新子目录计入的问题。`708c3ab`、`33ce350` 与基线历史均未改动。

## 5. 未验证项（明确不扩大范围）

沿用验收规格 §9 与任务卡边界，**本次未开展**：48 个未冻结字段 ↔ 冻结 DTO 符合性结论与补 DTO 定义、N-01 状态机命名冲突（需 Codex 澄清）、N-06 表格语义与 12 个筛选下拉补真实枚举、P1-7 四类告警完整组件、P1-8 七态状态机 + 8 类 Mock 场景全覆盖、三尺寸逐格 computed style 留档、1024 / 1280 另 3 页补测、≤760px 断点、高 DPI / UI 缩放、跨浏览器（Firefox / Safari / 旧版 Chrome）、真实键盘硬件、多页数据打印分页、真实屏幕阅读器、正式 WCAG 符合性认证、像素级逐图比对、`aria-current` 的静态 HTML 兜底。
服务层 / 后端权限真实生效、真实 Provider / 设备调用、HTTP 接线、合并 main、改写 `708c3ab` 历史均在任务卡「明确禁止」之列。

## 6. 边界声明与请求

- **网络请求 0（非 `file://` = 0）、真实设备 / Provider 调用 0**；全程 `file://` 离线，只用合成 fixture。
- 未接 API、未改后端、未调 Provider、未连设备、未合并 main、未制作演示包。
- 页面仍为**合成演示 UI**，不是已接通 Mock Provider 的运行时系统；横幅持续显示「Mock 演示，未连接真实门禁」及 `executionMode=test` / `provider=mock` / `evidenceScope=simulated` / `真实设备生效：否`。
- HK-AI-05 静态审计任务已在 `7655c28` 关闭；本次为另开的 HK-AI-05A 修复，**不推翻、不改写**其已验收结论（累计 24 条 / 开放 23 条口径不变）。

**请求 Codex 复审。通过前不宣称「演示页面已通过」，不制作演示包；合并 `main` 仍需单独决定。**
