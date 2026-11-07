# HK-AI-05 门禁管理页面 · 脱敏截图与渲染 / 响应式验证报告

> **本轮为静态壳渲染，未接 API、未连真实设备、未调用真实 Provider。**
> 页面为零数据静态壳：`tbody` 全空、统计值一律为「—」、不含任何真实设备 / 人脸 / 账号 / 凭据数据。

本报告是 `team-lead` 派发的**并行子任务产出**，只覆盖「脱敏截图 + 渲染 / 响应式 / 打印样式 / 脱敏核查」。主审计报告为同目录下的 `HK-AI-05-STATIC-UI-AUDIT.md`（由另一名 QA 产出），本报告**不替代、不修改、不评价**主报告，也不改动任何产品代码。

> **补充说明（与静态审计对接后追加）**：应主审计 `§1.3` 与 `§4.5` 的边界划分，视觉结论归本报告；本轮按其提供的 `styles.css` 静态推断点补测了 **900 / 1024 / 1280** 三档宽度（见 §5.4），并把打印态标识与交付落点两项如实补入（见 §6.2、§11）。

---

## 1. 任务范围与边界

| 项 | 内容 |
| --- | --- |
| 被测目录 | `C:/Users/Administrator/WorkBuddy/2026-10-23-16-18-12/hk-face-admin/` |
| 被测页面 | `index.html`、`devices.html`、`applications.html`、`tasks.html`、`audits.html` |
| 仓库基线 | 独立本地仓库，分支 `feat/hk-face-admin`，HEAD `3b2339b`，**无 remote**（见 §11） |
| 交付目录 | `hk-face-admin/docs/tasks/screenshots/`（PNG / PDF） |
| 报告文件 | `hk-face-admin/docs/tasks/HK-AI-05-RENDER-CHECK.md`（本文件） |
| 产品文件 | 5 个 HTML、`styles.css`、`app.js`、`README.md` —— **全部零改动** |

**执行的边界**：未安装 playwright / puppeteer / puppeteer-core，未 `npm install`，未引入任何依赖；全程仅 `file://` 本地打开；未联网、未连真实设备、未调用真实 Provider、未执行 `git add / commit / push / merge`、未改动 SMART-PM；所有中间验证脚本与临时 profile 放在系统临时目录，不属于项目交付物。

---

## 2. 验证环境与工具

| 工具 | 版本 / 路径 | 用途 |
| --- | --- | --- |
| Google Chrome | **156.0.8078.81**（`ProductVersion` 与 `FileVersion` 一致）<br>`C:/Program Files/Google/Chrome/Application/chrome.exe` | headless 截图、`--print-to-pdf`、CDP print 媒体验证 |
| Microsoft Edge | 156.0.4314.58（仅读取版本备案，**未用于截图**） | 环境记录 |
| Node.js | `C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`（22.22.2） | 仅用于校验 PNG IHDR / PDF 结构、CDP 管道通信；未安装任何 npm 包 |
| Chrome DevTools Protocol | `--remote-debugging-pipe`（本地管道） | 读取 print 媒体下的 computed style |

> 说明：Windows 上 `chrome.exe --version` 会异常拉起 GUI 并输出 GCM / GAIA 报错，因此版本改由**可执行文件元数据**读取，未使用 `--version`。

---

## 3. 可复现命令

以下为实际使用的参数模板（Git Bash 路径写法）。所有截图使用独立 `--user-data-dir`，并附加严格离线参数，避免默认 profile 与后台网络行为。

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
BASE="--headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
--disable-background-networking --disable-component-update --disable-sync --disable-default-apps \
--disable-extensions --disable-domain-reliability --metrics-recording-only \
--safebrowsing-disable-auto-update --disable-features=Translate,MediaRouter,OptimizationHints \
--hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=1500"
URL="file:///C:/Users/Administrator/WorkBuddy/2026-10-23-16-18-12/hk-face-admin/devices.html"

# 截图（按需替换 --window-size / --screenshot / URL）
"$CHROME" $BASE --window-size=1366,768 \
  --user-data-dir="C:/Users/Administrator/AppData/Local/Temp/hk-chrome-repro1" \
  --screenshot="C:/Users/Administrator/AppData/Local/Temp/hk-repro-1366.png" "$URL"

# 打印 PDF（styles.css:217 @media print，隐藏清单在 :218）
"$CHROME" $BASE \
  --user-data-dir="C:/Users/Administrator/AppData/Local/Temp/hk-chrome-repro2" \
  --print-to-pdf="C:/Users/Administrator/AppData/Local/Temp/hk-repro-print.pdf" "$URL"
```

**命令有效性复核**：用上述模板在系统临时目录重跑一次，`hk-repro-1366.png` = `1366x768 / 64740 B`，与交付物 `devices-1366x768.png` 的 `1366x768 / 64740 B` **字节级完全一致**，确认模板与实际生成交付截图的参数一致、渲染具有确定性。`--print-to-pdf` 复现同样成功（`%PDF-1.4`）；PDF 字节数受渲染时序影响不固定，故只校验结构（头 / 页对象 / EOF），不做字节比对。

---

## 4. 截图与打印产物清单

**首轮**共 **12 张 PNG + 1 份 PDF**，全部位于 `hk-face-admin/docs/tasks/screenshots/`。**本轮补交（P1）新增 8 张 PNG 后，现共 20 PNG + 1 PDF / 21 文件 / 1,449,077 B**，见 §12.2；下表为**首轮基线清单**，新增 8 张的逐项校验见 §12.2，不并入本表。所有 PNG 均经 Node 读取 IHDR 校验 `PNG signature` 与宽高，全部与文件名一致。

| 文件名 | 类型 | 尺寸 | 字节数 | 校验结果 |
| --- | --- | --- | --- | --- |
| `index-1366x768.png` | PNG | 1366×768 | 69,930 | signature ok |
| `devices-1366x768.png` | PNG | 1366×768 | 64,740 | signature ok |
| `applications-1366x768.png` | PNG | 1366×768 | 61,429 | signature ok |
| `tasks-1366x768.png` | PNG | 1366×768 | 62,581 | signature ok |
| `audits-1366x768.png` | PNG | 1366×768 | 60,123 | signature ok |
| `index-1920x1080.png` | PNG | 1920×1080 | 88,738 | signature ok |
| `devices-1920x1080.png` | PNG | 1920×1080 | 71,365 | signature ok |
| `index-768x1024.png` | PNG | 768×1024 | 65,646 | signature ok |
| `devices-768x1024.png` | PNG | 768×1024 | 63,165 | signature ok |
| `devices-900x768.png` | PNG | 900×768 | 53,857 | signature ok（补测） |
| `devices-1024x768.png` | PNG | 1024×768 | 58,202 | signature ok（补测） |
| `devices-1280x768.png` | PNG | 1280×768 | 64,378 | signature ok（补测） |
| `devices-print.pdf` | PDF | `%PDF-1.4` | 121,672 | `/Type /Page` = 1、`%%EOF` 存在 |

合计 905,826 字节（约 885 KB）。**失败项：无** —— 13 个产物均一次生成成功，无 headless 启动失败、无需替代方案。**本轮补交后自校验**：`905,826 + 543,251 = 1,449,077`，与截图目录实测总字节数精确一致；既有 13 个产物字节数 / mtime 未变、源码 8 文件 SHA-256 前后一致。

> 跨文档清单说明（**已由 team-lead 汇编对齐，本条为最终口径**）：主审计报告 `§1.3` 原预留 6 个占位名（`01-` 前缀 / `06-common-desktop-widths.png`），现已替换为实际清单；其早期版本曾写「共 9 张 PNG + 1 份 PDF」，**现版 §1.3 / §4.6 / 文末均已同步为 12 PNG + 1 PDF（13 个文件 / 905,826 B）**，与本报告 §4 的 13 项清单一致。3 张补测图（`devices-900x768.png` / `devices-1024x768.png` / `devices-1280x768.png`）生成于本报告首版之后，来源明确、已并入 §4 清单；12 张 PNG 的 signature / IHDR 校验由本报告 §4 与 team-lead 全量复核共同承担并全部通过。两份报告现无数量或文件名差异；本报告不代改主报告。

---

## 5. 逐宽度观察结论

### 5.1 1366×768 —— 5 个页面全覆盖

| 检查项 | 观察结论 |
| --- | --- |
| 侧边栏 | 固定左栏约 216px 完整可见，`.main` 的 `margin-left` 正确让位，**无遮挡、无重叠** |
| 中文 | 正常渲染，无乱码、无方框、无问号替换 |
| `notice` 提示条 | 粉色提示条完整可见，文案「页面壳演示…未接入任何真实接口、真实数据或真实硬件设备」可读 |
| `env-tag` Mock 标识 | 「SHELL · 未联调」与「演示环境」均可见 |
| 统计卡 | 5 页各 4 张，值均为「—」占位，按 `styles.css:111` / `:181` 默认 `repeat(4, minmax(0,1fr))` 呈 **4 列等宽**，无挤压 |
| `index.html` 模块区 | 4 张模块卡（DEVICES / APPLICATIONS / TASKS / AUDITS）4 列，无错位 |
| 表格 | 4 个业务页各 **8 列表头**（如 `devices.html:79-80`：设备编号 / 设备名称 / 设备类型 / 安装点位 / 在线状态 / 固件版本 / 最近心跳 / 操作），`tbody` 全空 |
| 空状态与分页 | `.empty`（「暂无设备数据」等）居中显示，`.pagination`（「共 0 条 · 上一页 1 下一页」）与表格对齐，**无错位** |
| 横向溢出 | **无页面级横向溢出**，无横向滚动条 |
| 敏感信息 | 未见真实设备型号 / 序列号 / 人脸 / 账号 / IP / 凭据 |

补充：`index.html` 的「本轮范围与边界」面板在 768 高度下首屏仅露出标题与首行，需纵向滚动查看；在 1920×1080 下完整可见（见 R3）。

### 5.2 1920×1080 —— `index.html` / `devices.html`

- `.content { max-width: 1320px }`（`styles.css:85`）生效：主区自侧栏右缘起，内容宽约 1320px，**右侧留白约 380px（约视口 20%）**，属预期约束而非布局异常。
- 统计卡 / 模块卡仍为 4 列，卡片未被拉伸变形；`index.html`「本轮范围与边界」面板**完整可见**（含 4 条边界 bullet 与 `feat/hk-face-admin` 标签）。
- `devices.html` 8 列表头全部完整可见，无列挤压。
- 无横向溢出、无文字重叠、中文正常；`notice` / `env-tag` 可见；无敏感信息。

### 5.3 768×1024 —— `index.html` / `devices.html`

- **`styles.css:204` 断点核查通过**：`@media (max-width: 1000px)` 生效，`.stat-grid` / `.module-grid` 由 4 列降为 **2 列**（2×2 排布），目视与 CDP `gridTemplateColumns` 结果一致。此为 `team-lead` 指定的核查点。
- **`styles.css:207` 未触发**：768 > 760，故 sidebar 仍为 `position: fixed` 左侧固定栏（约 216px），**不堆叠到顶部**，`.main` 仍保留 `margin-left`。这是断点设计的预期行为，**不判为缺陷**。
- `devices.html` 筛选区字段换行（`styles.css:132` `.filters { flex-wrap: wrap }`），「查询 / 重置」按钮仍在行内，无重叠。
- **表格**：8 列在 `.table-wrap { overflow-x: auto }`（`styles.css:142`）内发生**内部横向裁剪** —— 首屏可见前 5 列，第 6 列显示为「固件版…」被截断，「最近心跳」「操作」不可见；需容器内横向滚动查看。页面级无横向滚动条，属容器内部滚动的设计后果，**不是页面级横向溢出**（详见 R1 与 §5.4 临界定位）。
- 空状态与分页位置正常、无错位；中文正常；`notice` / `env-tag` 可见；无敏感信息。

### 5.4 补测：900 / 1024 / 1280（回应静态审计的区间推断）

> **时序与验证手段声明（诚实边界）**：这 3 张 PNG 生成于本报告首版（11:51:53 / 18,301 B / 256 行）**之后**（`devices-1024x768.png` 11:53:45、`devices-1280x768.png` 11:53:46、`devices-900x768.png` 11:54:28），是为回应主审计静态推断而追加的补测，**均为本 QA 生成、来源明确**；本报告已随之重写，当前版本时间戳晚于 3 张截图，§4 / §9 / §10 已同步为 12 PNG + 1 PDF。
>
> 三档均**仅通过 Chrome headless CLI 出图 + 逐张人工目视（PNG 像素级查看）得出结论，未做 CDP computed style 复核** —— 本轮唯一一次 CDP computed style 读取用于 §6.2 的 1366 print 媒体实证，**不覆盖这三档**。因此下表与结论中的列数、表头可见性、溢出、中文、筛选栏等均为**目视判断**，不引申为 computed style 层面的实证；§6.2 与 R2 的打印态实证结论也**不外推**到这三档。

主审计报告提出：`styles.css:142` 的 `.table-wrap { overflow-x:auto }`、`:146` 的 `thead th { white-space: nowrap }` 与 `:132` 的 `.filters { flex-wrap:wrap }` 存在，但 `:204` / `:207` 两个断点**只改栅格与侧栏，没有针对 8 列表格与筛选栏的专门规则**，建议重点实测 1024～1280 区间。本轮据此补测三档（均 `devices.html`、高度 768）：

| 宽度 | 统计卡 | 8 列表格表头 | 筛选栏 | 页面级横向溢出 |
| --- | --- | --- | --- | --- |
| **1280×768** | 4 列 | **8 列全部完整可见**，无横向滚动、无列挤压 | 4 字段 + 查询 / 重置 同一行 | 无 |
| **1024×768** | 4 列 | **8 列全部完整可见** | 4 字段一行，查询 / 重置 换到第二行 | 无 |
| **900×768** | 2 列（≤1000 断点触发） | 前 7 列完整，第 8 列「操作」被切（仅见「操」） | 3 + 1 字段分两行，按钮无重叠 | 无 |
| **768×1024**（§5.3） | 2 列 | 前 5 列可见，第 6 列「固件版…」截断，「最近心跳」「操作」不可见 | 2 行 | 无 |

**结论**：

- 静态审计建议重点看的 **1024～1280 区间实测是安全的**：两档 8 列表头均完整可见、无横向滚动、无列挤压；连同 1366 / 1920，**≥1024 的四档全部完整**。
- 8 列表格内部横向裁剪的**临界宽度在 900～1024 之间**：900 起仅末列被切，768 加剧到后 2 列不可见。风险区间实际落在 `<1000px`（栅格降 2 列、主区变窄），而非 1024～1280。
- 静态估算核对成立：`:35` `.main { margin-left: 216px }` + `:85` `.content { padding: 26px }` → 1024 下内容宽约 756px（`1024 - 216 - 52`），足以容纳 8 个 nowrap 表头；900 下约 632px，末列放不下；768 下约 500px，后 2 列放不下。与实测逐档一致。
- 所有档位**均无页面级横向溢出、无列挤压**：`overflow-x:auto` 在窄档位按设计承接滚动，`white-space:nowrap` 保证表头不被压缩变形。
- 补测仅对 `devices.html` 出图；`applications` / `tasks` / `audits` 同为 8 列结构可推及，但**未实测出图**，列宽文案长度不同，临界点可能略有差异。

---

## 6. 打印样式验证（`styles.css:217`）

### 6.1 交付 PDF

`devices-print.pdf` 由 Chrome CLI `--print-to-pdf` 生成：`%PDF-1.4`、121,672 B、`/Type /Page` 对象 1 个、`%%EOF` 存在，结构完整。

> **方法论说明**：直接解析 PDF 文本层不可靠 —— Chrome 输出中文为字形编码（含 `ToUnicode` / `beginbfchar`），对 raw / inflate 后的流搜索中文或 `SHELL` 均返回 false，但**不能据此判定元素存在与否**。因此不拿文本检索结果下结论，改用 CDP computed style 做实证。

### 6.2 CDP 实证（`--remote-debugging-pipe`，本地管道、零网络、零依赖）

对 `devices.html` 调用 `Emulation.setEmulatedMedia({ media: "print" })` 后读取 `getComputedStyle`：

```json
{
  "mediaPrint": true,
  "display": {
    ".sidebar": "none",   ".actions": "none",   ".filters": "none",
    ".pagination": "none", ".toast": "none",   ".env-tag": "none",
    ".main": "block",     ".notice": "block",  ".panel": "block",
    ".stat-grid": "grid", ".table-wrap": "block", ".empty": "block"
  },
  "exists": { "（12 个选择器全部为 true）": true },
  "mainMarginLeft": "0px",
  "statColumns": "347.5px 347.5px",
  "docWidth": 741,
  "winWidth": 756
}
```

`styles.css` 原文（`:217-221`）：

```css
@media print {                                                    /* :217 */
  .sidebar, .actions, .filters, .pagination, .toast, .env-tag { display: none !important; }  /* :218 */
  .main { margin-left: 0; }                                         /* :219 */
  .panel, .stat-card, .hero { break-inside: avoid; }                /* :220 */
}
```

结论：

- `matchMedia("print").matches = true`，实验确实处于 print 媒体。
- `:218` 声明要隐藏的 **6 个选择器全部命中** `display: none`：`.sidebar` / `.actions` / `.filters` / `.pagination` / `.toast` / `.env-tag`。
- `.main { margin-left: 0 }`（`:219`）生效（computed `0px`），因侧栏隐藏而不再留左侧空白。
- **`.notice` 未被隐藏**：computed `display: block`；`.panel` / `.stat-grid` / `.table-wrap` / `.empty` 同样保持可见，正文内容未被误隐藏。
- `scrollWidth 741 ≤ innerWidth 756`，print 媒体下**无横向溢出**。
- `statColumns = 347.5px 347.5px`：CDP 视口 756px 同样触发 1000px 断点降为 2 列，与响应式规则自洽。
- print 媒体截图目视复核（系统临时文件，非交付物）：左侧栏、筛选、操作按钮、分页、`.env-tag` 均消失；`.notice` 粉色提示条**仍完整可见**；顶栏「演示环境」**仍可见**；中文正常，统计值仍为「—」，无敏感信息。

**打印态标识计数（与主审计 P2-1 口径已对齐）**：屏幕态共 **4 处**壳标识 —— `.sidebar-foot` 左下角版本标识（`devices.html:28`）、`.env-tag`「SHELL · 未联调」（`:35`）、无 class 的裸 `<span>演示环境</span>`（`:36`）、`.notice` 提示条（`:41`）。打印态隐藏 `.env-tag` 与 `.sidebar`（连带 `.sidebar-foot`），**保留 2 处** —— `.notice` + 「演示环境」，即「**四处降为两处**」，而非原表述「从三处降为一处」。

CDP computed style 实证：`.env-tag` = `display:none`、`.notice` = `display:block`、`.main` margin-left `0px`；print 媒体截图右上角「演示环境」肉眼可见、`.notice` 提示条完整。「不是完全丢失」的定性成立，P2 定级不变。主审计已按本轮实证更正其 §1.1 / §4.2 / §5.3 共 5 处为「四处降为两处」，**两份报告口径已一致**；本报告未代改其报告。

> 行号口径：`@media print` 规则起始于 `styles.css:217`，隐藏清单在 `:218`。本报告标题用 `:217`，主审计报告用 `:218` 指清单行，二者指向同一规则，不冲突。

**判定：`styles.css:217` 打印样式规则生效，已实证。**

---

## 7. 发现的问题与证据

> 以下均为**观察项**，本轮不修改任何页面代码；是否纳入后续优化由 `team-lead` / 主审计报告决定。

### R1 · 窄宽度下 8 列表格右侧列首屏不可见（设计后果，非缺陷）

- **证据**：`devices-768x1024.png` 中第 6 列表头显示为「固件版…」被截断，「最近心跳」「操作」不可见；`devices-900x768.png` 中第 8 列「操作」被切；`devices.html:79-80` 定义 8 个 `<th>`；`styles.css:142` `.table-wrap { overflow-x: auto }` 与 `:146` `thead th { white-space: nowrap }` 共同作用。
- **临界定位（§5.4 补测）**：≥1024（1024 / 1280 / 1366 / 1920）8 列**全部完整可见**；900 起末列被切；768 后 2 列不可见。裁剪临界在 **900～1024 之间**，风险区间是 `<1000px` 而非 1024～1280。
- **判定**：容器内部横向滚动按设计生效，所有档位页面级无横向滚动条、无列挤压、无内容不可达，属宽表在「固定侧栏 + 窄主区」布局下的设计取舍。4 个业务页均为 8 列，同样现象可推及 `applications` / `tasks` / `audits`（本轮仅对 `devices` 出图）。
- **可选改善方向**（不在本轮范围）：窄屏下隐藏次要列或折叠为卡片；不建议移除 `overflow-x:auto`，否则会引入真正的页面级溢出。

### R2 · 打印样式未覆盖裸 `<span>演示环境</span>`（轻微一致性问题）

- **证据**：5 个页面第 35 行为 `<span class="env-tag">SHELL · 未联调</span>`，第 36 行为**无 class 的裸 span** `<span>演示环境</span>`（`index.html:36`、`devices.html:36`、`applications.html:36`、`tasks.html:36`、`audits.html:36`）。`styles.css:218` 的隐藏清单只含 `.env-tag`，因此 print 媒体下 `.env-tag` 被隐藏而「演示环境」仍显示；CDP print 媒体截图右上角可肉眼看到「演示环境」。
- **影响**：打印件仍保留 **2 处**壳标识（`.notice` 提示条 + 「演示环境」），详见 §6.2。两者均为**无害的 Mock 文案，不含任何敏感信息**，不构成脱敏问题；但与「隐藏所有环境标识」的打印意图不一致。
- **判定**：轻微一致性问题，非阻塞、非缺陷定级。

### R3 · 1366×768 首页底部面板需纵向滚动（视口高度差异，非布局错位）

- **证据**：`index-1366x768.png` 中「本轮范围与边界」仅见标题与首行；`index-1920x1080.png` 中该面板（含 4 条 bullet）完整可见。
- **判定**：由 768 与 1080 的视口高度差造成，属正常纵向滚动，不是元素错位或截断。

---

## 8. 脱敏核查

### 8.1 源文件正则扫描

对 5 个 HTML + `app.js` + `styles.css` 共 7 个文件，按 9 类模式扫描：IPv4 字面量、http(s) URL、外部 `<script>/<link>`、`@import` / CDN 关键字、凭据式字段（`api_key` / `secret` / `token` / `password` / `webhook` / `access_key`）、`key=` 参数、序列号 / SN、图片资源引用、`fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon`。

```
index.html        CLEAN
devices.html      CLEAN
applications.html CLEAN
tasks.html        CLEAN
audits.html       CLEAN
app.js            CLEAN
styles.css        CLEAN
```

`app.js` 头部注释亦明确：「零依赖、零网络请求，file:// 直接打开即可运行…不读取、不写入、不请求任何真实业务数据」。

主审计补充的正面结论与本轮扫描一致：全目录 `<img>` / `background-image` / `url(` / `base64` / `data:image` / `http(s)://` 零命中，5 页只引用本地 `styles.css` / `app.js`。**但根因是根本没有图片功能，不是对真实人脸做了脱敏** —— 因此「无敏感图片」这一结论只在静态壳范围内成立，接入真实数据后需重新评估。

### 8.2 页面结构证据

- 5 页 `tbody` 全空；4 张统计卡值均为「—」。
- `.notice` 明确声明「未接入任何真实接口、真实数据或真实硬件设备」。
- `audits.html:79` 的 `IP / 终端` 仅为**表头字段名**，无 IP 值。

### 8.3 像素级目视

12 张 PNG 逐张检查 + 1 张 print 媒体截图复核：**未出现**真实设备型号、序列号、人脸照片、账号、密码、IP 地址或任何凭据。统计值、表格、提示文案全部为占位 / Mock 内容。

### 8.4 网络与仓库隔离

- 全程仅 `file://`；Chrome 附加 `--disable-background-networking`、`--disable-component-update`、`--disable-sync`、`--disable-extensions`、`--disable-domain-reliability`、`--metrics-recording-only`、`--safebrowsing-disable-auto-update`、`--disable-features=Translate,MediaRouter,OptimizationHints` 等离线参数，且每次使用独立 `--user-data-dir`。
- 未连真实设备、未调用真实 Provider、未向 `127.0.0.1` 以外发起任何网络请求（本轮连本地 mock server 都未启动）。
- `git status --porcelain` = `?? docs/`：仅本轮与另一名 QA 新增的报告 / 截图目录为未跟踪文件；**5 个 HTML、`styles.css`、`app.js`、`README.md` 零改动**；HEAD `3b2339b`、分支 `feat/hk-face-admin` 保持不变。

> **脱敏结论：通过，截图与 PDF 可外发。** 未触发「发现敏感字样立即停止并报告」的停止条件。

---

## 9. 未验证项（明确列出，不含糊带过）

1. **本轮为静态壳渲染**：未接 API、未连真实设备、未调用真实 Provider、未产生任何真实业务数据流。因此真实数据填充后的列宽自适应、长文本换行、中英文 / 数字混排、分页多页、状态标签颜色等**均未验证**。
2. **PDF 文本层**：Chrome 输出中文为字形编码，未做文本层断言，也未做 PDF 与 print-media 截图的逐像素比对；打印隐藏规则改以 CDP computed style 实证（见 §6.2）。
3. **`≤760px` 断点未验证**：本轮覆盖 768 / 900 / 1024 / 1280 / 1366 / 1920 六档，但 `styles.css:207`（sidebar 变静态、nav 横排、`.sidebar-foot` 隐藏、布局纵向堆叠）**未触发也未验证**。建议后续补 375 / 414 / 760 三档。
4. **临界宽度未精确定位**：已补测 900 / 1024 / 1280，将 8 列表格裁剪临界收窄到 **900～1024 之间**；760～900 之间（如 800 / 850）未测，未给出精确像素阈值。
5. **仅对 `devices.html` 补测中间宽度**：`applications` / `tasks` / `audits` 同为 8 列但未出图，表头文案长度不同，临界点可能略有差异。
6. **高 DPI / UI 缩放未验证**：统一使用 `--force-device-scale-factor=1`。
7. **多页数据下的打印分页未验证**：当前为空态，PDF 仅 1 页；`break-inside: avoid` 在有数据时的表现未测。
8. **无自动化 DOM 断言**：未安装 playwright / puppeteer / puppeteer-core，未 `npm install`；验证手段仅为 Chrome headless CLI 出图 + PNG/PDF 结构校验 + 一次 CDP computed style 读取 + 人工目视。**该唯一一次 CDP 读取用于 §6.2 的 print 媒体实证，不覆盖 §5.4 的 900 / 1024 / 1280 三档 —— 三档为「仅出图 + 人工目视，未做 computed style 复核」，其结论不外推为实证级断言。**
9. **跨浏览器未验证**：Edge 仅读取版本号备案，未用其截图；Firefox / Safari 未涉及。
10. **远端分支归属未自行复核**：受「不联网」边界约束，未执行 `git ls-remote`；SMART-PM 远端是否存在 `feat/hk-face-admin` 仅引用主审计结论（见 §11）。

---

## 10. 结论

| 项 | 结论 |
| --- | --- |
| 产物 | **首轮 12 PNG + 1 PDF**，本轮补交后 **20 PNG + 1 PDF** 全部生成成功，PNG 签名 / IHDR 尺寸全部匹配文件名，PDF 结构完整；**失败项：无**（见 §12.2） |
| 1366×768（5 页） | 通过：侧栏无遮挡、无横向溢出、中文正常、`notice` / `env-tag` 可见、4 列统计卡、空状态与分页无错位、无敏感数据 |
| 1920×1080（首轮 2 页 → 本轮 5 页） | 通过：`max-width:1320px` 约束生效、右侧留白符合预期、面板与 8 列表头完整可见、无溢出；本轮补齐 applications / tasks / audits 三页，三尺寸 × 四业务页矩阵 12/12 完整（§12.3） |
| 768×1024（2 页） | 通过（含 1 项观察）：`styles.css:204` 4 列 → **2 列**已验证；`styles.css:207` 按 768>760 未触发属预期；宽表内部横向滚动见 R1 |
| 补测 900 / 1024 / 1280 | 通过：1024～1280 区间 8 列表头**完整可见**，静态审计的区间风险推断未被渲染证实；裁剪临界收窄到 900～1024 |
| 打印样式 `styles.css:217` | **通过**，CDP computed style 实证 6 个隐藏选择器全部 `display:none`、`.main` margin-left `0px`；`.notice` 与「演示环境」两处标识保留 |
| 脱敏 | **通过**，源文件扫描 7/7 CLEAN、首轮 12 张 + 本轮 8 张截图逐张目视无敏感内容、产品文件零改动、无网络外联；本轮补充 5 页 `innerText` 9 类正则扫描（§12.7） |
| 观察项 | R1 窄宽度宽表内部横向滚动、R2 打印遗漏裸 span「演示环境」、R3 视口高度差异 —— 均非阻塞，未改代码 |
| 落点 | **已闭环**：项目负责人裁定推送到 `SMART-PM` 新分支后，已从 `origin/main @ 282a20f` 新建 `feat/hk-face-admin` 并推送页面壳恢复提交 `80b8a52`；本报告与截图迁入该分支 `docs/tasks/`（§12.1 / §12.9） |

**路由决策：NoOne** —— 未发现需要回退给 Engineer 修复的源码缺陷；R1 / R2 属设计取舍与轻微一致性问题，交由 `team-lead` 与主审计报告决定是否纳入后续优化。§11 的落点偏差为**首轮**待裁定事项，**本轮已由项目负责人裁定并闭环**，见 §12.1。

---

## 11. 交付落点说明（首轮待裁定；**本轮已闭环，见 §12.1**）

主审计报告 `§6` 提出 P0-1 结构性阻塞，本轮按只读方式复核了本地侧证据：

| 核实项 | 命令（只读） | 结果 |
| --- | --- | --- |
| 本仓库是否有远端 | `git -C hk-face-admin remote -v` | **输出为空** → 无 remote，无法推送 |
| 本仓库当前分支 | `git -C hk-face-admin rev-parse --abbrev-ref HEAD` | `feat/hk-face-admin` |
| SMART-PM 本地是否已有该分支 | `git -C SMART-PM branch -a --list '*hk-face*'` | **无匹配** |
| SMART-PM **远端**是否有该分支 | 主审计用 `git ls-remote --heads` 核实为不存在 | **本轮未自行复核**：该命令需联网，超出「不联网」边界，仅引用主审计结论 |

- 任务卡要求在 `docs/tasks/` 交付、并由 Codex 在 `feat/hk-face-admin` 分支复审；**本报告的 12 张 PNG + 1 份 PDF + 本 Markdown 全部落在 `hk-face-admin/docs/tasks/`**，因此与主报告同样面临「SMART-PM 侧无既定落点 / 无 remote 可推送」的偏差。
- **首轮处置**：未推送、未迁移、未创建 remote、未改 SMART-PM、未执行任何写 git 操作（`git status --porcelain` 仍为 `?? docs/`，工作树除新增产物外干净）。**该状态仅描述首轮**；本轮已按裁定推送，见 §12.1 / §12.9。
- **待裁定**：仓库归属（独立仓库 or 并入 SMART-PM）、是否推送、是否需要把报告 / 截图迁移到 SMART-PM 侧落点。QA 不自行决定，等 `team-lead` 统一裁定后再执行；本轮交付物在当前位置可正常查阅与外发。

---

*首轮报告：QA（devboard-qa-verify） · Chrome 156.0.8078.81 · HEAD `3b2339b` · 静态壳渲染，未接 API / 未连真实设备*  
*本轮补交增补记录见 §12（P1，2026-11-07）；页面壳源码 8 文件 SHA-256 前后一致，HEAD 仍 `3b2339b`。*

---

## 12. 本轮补交渲染增补记录（P1，2026-11-07）

### 12.1 触发、裁定与边界

- **触发**：补交门禁管理页面静态审计（P1），要求覆盖 1366×768 / **1440×900** / 1920×1080 三种桌面尺寸与四页脱敏截图；首轮 1440×900 零覆盖、1920×1080 仅 `index` / `devices` 两页。
- **本轮产出**：新增 8 张 PNG，三尺寸 × 四业务页矩阵 **12/12 完整**；另用 CDP 补做键盘焦点、对话框关闭、错误提示可读性、900×768 溢出与对比度的运行时实证。
- **边界**：只审计、不接 API、不修改 UI 与服务层；**未注入任何 fixture 数据**，页面保持空表合成形态；全程 `file://` 离线、零网络请求；截图不含真实人脸、姓名、手机号、地址、设备序列号、MAC、IP 或凭据。
- **交付落点变化**：P0-1 已闭环 —— 项目负责人裁定后，从 `origin/main @ 282a20f` 在 `SMART-PM` 新建 `feat/hk-face-admin` 并推送页面壳恢复提交 `80b8a52`；本报告与 `screenshots/` 迁入该分支 `docs/tasks/`。本报告中 `hk-face-admin/docs/tasks/...` 为工作区独立仓库的首轮路径，迁入后为 `docs/tasks/...`，**文件名与内容不变**。本地独立仓库首轮快照保留，HEAD 仍 `3b2339b`。
- **可运行性**：无阻断。Chrome 156.0.8078.81 headless CLI 出图成功，无启动失败、无需替代方案。

### 12.2 新增 8 张截图与校验

| 文件名 | 尺寸 | 字节数 | IHDR |
| --- | --- | --- | --- |
| `devices-1440x900.png` | 1440×900 | 67,036 | PASS |
| `applications-1440x900.png` | 1440×900 | 63,271 | PASS |
| `tasks-1440x900.png` | 1440×900 | 64,274 | PASS |
| `audits-1440x900.png` | 1440×900 | 62,076 | PASS |
| `index-1440x900.png` | 1440×900 | 83,951 | PASS |
| `applications-1920x1080.png` | 1920×1080 | 67,611 | PASS |
| `tasks-1920x1080.png` | 1920×1080 | 68,727 | PASS |
| `audits-1920x1080.png` | 1920×1080 | 66,305 | PASS |

合计 **8 PNG / 543,251 B**；基线 13 文件 / 905,826 B；总计 **21 文件 / 1,449,077 B**，自校验 `905,826 + 543,251 = 1,449,077` 与目录实测一致。Node 读取 PNG 签名与 IHDR 宽高 **10/10 PASS**（含既有 `index-1920x1080.png` / `devices-1920x1080.png`），失败项 0。既有 13 个产物字节数 / mtime 未变、源码 8 文件 SHA-256 前后一致。

### 12.3 三尺寸 × 四业务页 15 组合 CDP 实证

`Emulation.setDeviceMetricsOverride` + `Runtime.evaluate`，1366×768 / 1440×900 / 1920×1080 三档 × 四业务页 12 格 + 概览 3 格：

- `docScrollWidth == docClientWidth`、`pageOverflowX=false`，`window.scrollTo(9999,0)` 后 `scrollX=0` → **页面级横向溢出 0**。
- `.table-wrap` 实测 `scrollWidth == clientWidth`：1366 `1058/1058`、1440 `1132/1132`、1920 `1228/1228`；置 `scrollLeft=9999` 回读仍 0 → **容器级滚动在该三档下亦未触发**（`styles.css:142` 声明 `overflow-x:auto` 保留为窄屏兜底）。
- 8 个 `<th>` 各 `scrollWidth<=clientWidth`、右边界全在容器内、文字截断 0；统计卡 4 列（1366 `264px×4` / 1440 `282.5px×4` / 1920 `306.5px×4`）。
- 1440×900 五页：`sidebar right=216` / `main left=216`、`sidebarOverlapsMain=false`；`.notice` / `.env-tag` computed `display:block` 且 rect 完整在视口内；`innerText` 中文 325–506 字、无 U+FFFD 乱码。
- 1920 档 `.actions` 右缘 410px 留白来自 `.content{max-width:1320px}`（`styles.css:85`），属预期约束。

### 12.4 900×768 四页 CDP 数值复核（未出图，四页分三类）

| 页面 | `clientWidth/scrollWidth` | 可滚 | 可见列 | 末列 |
| --- | --- | --- | --- | --- |
| `devices.html` | `592/614` | 22px | 7/8 | 被切 |
| `applications.html` | `592/602` | 10px | 7/8 | **同样被切** |
| `tasks.html` | `592/592` | 0 | **8/8** | 全可见 |
| `audits.html` | `592/592` | 0 | **8/8** | 全可见 |

这**修正了首轮 §5.4 / §9.5「另 3 个业务页同为 8 列但列文案长度不同，临界点可能略有差异」的推及**：实测四页分三类，tasks / audits 在 900 档完全不裁。裁剪临界仍在 900～1024、风险区间 <1000px，P2-4 维持 P2。

**键盘维度（重要更正）**：补差分析曾推断「无 `tabindex` / 无 focus 样式 + 空 `<tbody>` → 键盘用户无法滚出被裁列」（拟定 P1）。CDP 实测相反 —— Chrome 156 的 **`focusable-scroll-container`** 把有溢出的容器自动加入 Tab 序列，devices / applications 在**第 15 次 Tab** 焦点落在 `DIV.table-wrap`（`focus-visible=true`、UA `outline:auto 1px`），ArrowRight×3 / End 使 `scrollLeft` `0→22`（applications `0→10`）、第 8 列 `inside:true`；mouseWheel 与 `scrollBy` 同样可达。故主报告 **N-02 由 P1 降为 P2**，性质改为「静态缺口成立、运行时可达，但依赖 UA 特性、无显式保障，跨浏览器未验证」。首次用 `rawKeyDown` 派发方向键未触发滚动、换 `keyDown` 才生效，属 harness 差异而非页面缺陷。

### 12.5 键盘焦点 / 对话框 / 错误提示 / 可访问性 CDP 实证

- **焦点（5 页全实证）**：`focusable` index=9、devices/applications/tasks=16、audits=15；`[tabindex]=0`、`[accesskey]=0`；前 8 焦点按 DOM 顺序；40 个焦点元素全部 `matches(':focus-visible')=true`、`outlineStyle:auto / 1px / rgb(16,16,16)`；对比度 #101010 对 #fff 19.03:1、#fafafb 18.24:1、#f5f5f7 17.48:1、#fff0f2 17.21:1、红按钮 #ff2442 5.06:1，**全部 ≥3:1**；Enter / Space 可激活。→ 主报告 N-03 定性为「无显式保障」而非「焦点不可辨」。
- **对话框**：`<dialog>` / modal / ESC / keydown 全零命中，`app.js` 键盘监听 = 0、仅 2 处 click 监听，全页 `[role]` 仅 1 个。**Esc 不关闭**（keydown 已送达 document，`+200ms` / `+600ms` 仍 `visible:true, opacity:1`）；`pointer-events:none` 不可点击关闭；toast 无 tabindex、不在 Tab 序列 → 无键盘关闭；唯一消失机制 `setTimeout(...,2200)`，**秒表实测 2218 ms** + 0.18s 淡出。→ N-04 明确写「N/A：无对话框」。
- **错误提示**：13px / 400 / `#fff` on `#222` = **15.91:1 对比度合格**（远超 AA 4.5:1 / AAA 7:1），**不得写「读不清」**；缺口在 `role="status" aria-live="polite"`（非 alert）、固定文案无六类错误差异化、2218 ms 停留（按 300 字/分需 3.0–3.6s、200 字/分需 4.5–5.4s）、`pointer-events:none`、打印态 `display:none`。打印媒体 CDP：`matchMedia('print')=true`、`.toast` computed `display:none`（class / textContent 仍在，仅 CSS 隐藏）、`.env-tag`/`.sidebar`=none、`.notice` 与裸 span「演示环境」=block、`.main margin-left=0px`；AX 树中 toast 隐藏后 `StaticText` 仍 `ignored:false`。→ N-05。
- **表格语义 / 筛选**：12 个 `<select>` 每个 `options.length=1`、`selectedIndex=0`、均未 disabled，ArrowDown / ArrowUp / Home / End / Alt+ArrowDown / Space 均无法改变选择；`th[scope]=0`、`table>caption=0`、`table[aria-label]=0`、`[tabindex]=0`；`aria-current="page"` 由 `app.js` 运行时注入、静态 HTML 无兜底。→ N-06。正面项：`<label for>` 关联齐备。

### 12.6 对比度复核（N-09a / N-09b）与 P0-2 补强

1440×900 下 5 页各 **28–32 个渲染文本元素**低于 WCAG AA 普通文本阈值（index 32/8 类，devices·applications·tasks 各 29/9 类，audits 28/9 类）：

- **N-09a（共享次要文字 token）**：`--text-2:#888889`（`styles.css:9`）被 15 处复用，字号 11–13px；按**实际背景**分三档：on `#ffffff` **3.54:1**、on `#fcfcfd` **3.45:1**（`.empty`）、on `#f5f5f7` **3.25:1**（`.sub` / `.muted`，继承 `--bg`）。不可只按纯白底计算。
- **N-09b（Mock 壳标识与品牌色）**：`.env-tag` `#d98013` on `#fff6e8` = **2.78:1**（全页最低，12px/400）；`.nav-link.is-active` `#ff2442` on `#fff0f2` = 3.40:1；`.brand-mark` / `.btn-primary` / `.idx` / `.go` `#fff` on `#ff2442` 或 `#ff2442` on `#fff` = 3.76:1。
- **4 处 Mock 壳标识逐项**：`.sidebar-foot`（各页 `:28`）3.54:1、`.env-tag`（`:35`）2.78:1、顶栏裸 span「演示环境」（`:36`）3.54:1、`.notice`（`:41`）`#a3152b` on `#fff0f2` = **7.04:1 达标**且是文字最多最显眼的一处 → **4 处中 3 处低于 AA，另一处达标**，不得写成全称式「4 处对比度不足」。这为主报告 **P0-2** 补上可量化的显著性证据，**不改其 P0 定级**（定级依据是语义缺失）。
- **作用域限定**：toast（15.91:1）与 UA 焦点环（5.06–19.03:1）**均达标**，达标断言仅指这两者本身，**不引申为「页面整体对比度达标」**。PASS 侧交叉校验：`.notice` 7.04:1、`.crumb strong` #222、`.stat-value` 26px #222、toast 15.91:1 均达标且未进 FAIL 列表 → 算法无系统性误报。
- **证据性质**：【运行时实证】= CDP computed `color` / 背景色 + 元素存在性；【计算推断】= WCAG 相对亮度公式与 4.5:1（普通文本）/ 3:1（大文本）阈值。**不是**像素级目视、真实辅助技术评估或正式 WCAG 认证；未覆盖 hover / focus / disabled 交互态、`<select>` 原生下拉、空壳中无实例的 CSS 类（`.badge*` / `.link` / `tbody td`）。

### 12.7 脱敏与隔离复核

- 5 页 `document.body.innerText`（index 793 字 / devices 469 / applications 471 / tasks 462 / audits 468）经 9 类正则（IPv4、手机号、MAC、email、http(s) URL、含数字长字母数字串、凭据关键词、6 位以上长数字串等）扫描：4 个业务页命中 `{}`；index 仅 `credWords:["token"]`，出处为「颜色 / 字号 / 圆角等 token」设计术语，**误报并排除**。
- 四业务页 1366×768 截图 + 本轮 8 张新增 PNG 逐张像素级目视：数据行全空、「暂无…记录」、统计值「—」、页面自带「未接入任何真实接口、真实数据或真实硬件设备」声明，无真实人脸、姓名、手机号、地址、设备标识或凭据。
- 隔离：源码 8 文件 SHA-256 与初始快照一致；截图目录 21 文件（20 PNG + 1 PDF）、14:15 后新增恰好 8 张；**无 .md 新建或修改**（本条仅指渲染 QA 侧，报告修订由 team-lead 完成）；`git status --porcelain` = `?? docs/`；HEAD `3b2339b`、分支 `feat/hk-face-admin` 未变。

### 12.8 可复现命令

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
BASE="C:/Users/Administrator/WorkBuddy/2026-10-23-16-18-12/hk-face-admin"
OUT="$BASE/docs/tasks/screenshots"

# 出图（按需替换 --window-size / --screenshot / URL）
"$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1440,900 \
  --screenshot="$OUT/devices-1440x900.png" \
  "file:///$BASE/devices.html"

# 打印 PDF
"$CHROME" --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
  --print-to-pdf="$OUT/devices-print.pdf" "file:///$BASE/devices.html"

# CDP 实证：--remote-debugging-pipe（本地管道、零网络、零依赖）
# 关键调用：Emulation.setDeviceMetricsOverride / Runtime.evaluate /
#           Input.dispatchKeyEvent / Accessibility.getFullAXTree /
#           Emulation.setEmulatedMedia({media:'print'})
```

**harness 备注**：`Input.dispatchKeyEvent` 的 `rawKeyDown` 不触发滚动容器默认行为，方向键须用 `keyDown`；Enter 合成按键需带 `text`。`file://` 下 CSSOM `cssRules` 跨源拒绝，「无 focus / outline 规则」以只读源码全文检索为据，未用运行时规则枚举印证。测量用 `Emulation.setDeviceMetricsOverride`、出图用 `--window-size`，为两个会话，视口标称值、DPR、Chrome 版本与离线参数一致。

### 12.9 未验证项与裁定

1. **1024 / 1280 三档补 applications / tasks / audits**：首轮补测只覆盖 `devices.html`；本轮仅完成 900×768 四页 CDP 数值复核（**未出图**），1024 / 1280 的另 3 页仍未测。**team-lead 裁定不补做**：本轮要求的三种桌面尺寸（1366 / 1440 / 1920）已全部实证，补做属扩大范围且非交付必需；渲染 QA 已确认该动作虽在其只读边界内，但未经单独授权不开展。未放宽「只新增 8 张 PNG」的边界。
2. 1366×768 四页的 CDP computed 可见性沿用首轮 §5.1 目视结论，本轮未重做逐格 CDP 读取；三尺寸 15 组合已做溢出实证。
3. ≤760px 断点、高 DPI、跨浏览器（Firefox / Safari / 旧版 Chrome）、真实键盘硬件、多页数据打印分页、焦点态截图、显示滚动条配置 —— 未验证。**N-02 的「键盘可达」仅对 Chrome 156 成立**。
4. 有数据填充后的表现（长文本换行、列宽自适应、状态徽章、分页多页）：本轮**未注入任何 fixture 数据**，如需注入必须使用合成脱敏数据、`file://` 离线、不接 API 并显式标注。
5. 真实屏幕阅读器 / 弱视模拟、正式 WCAG 符合性认证未做；对比度结论为 CDP computed + 公式计算推断。

### 12.10 与主报告一致性对照

| 项 | 主报告 `HK-AI-05-STATIC-UI-AUDIT.md` | 本报告 |
| --- | --- | --- |
| 问题总数 | **24 条：P0 2 / P1 9 / P2 13** | 引用，不另立问题 |
| P0-1 | 已闭环（`80b8a52`） | §12.1 |
| 截图 | 20 PNG + 1 PDF / 1,449,077 B | §12.2 |
| 三尺寸 | 15 组合无溢出 | §12.3 |
| N-02 | P1 → **P2**（实证推翻静态推断） | §12.4 |
| N-03 / N-04 / N-05 / N-06 | 无显式保障 / N/A / 时长缺口 / 语义缺口 | §12.5 |
| N-09a / N-09b | 低对比度族，2.78–3.54:1 | §12.6 |
| P0-2 补强 | 4 处中 3 处低于 AA，`.notice` 7.04:1 达标 | §12.6 |

*§12 结束 · 本轮新增 8 张 PNG（543,251 B），无页面代码 / CSS / JS / 服务层改动。*
