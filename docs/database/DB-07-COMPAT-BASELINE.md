# DB-07 文件资源改造 · 兼容性基线（改造前现状钉死）

> 本文件是**改造前**的只读盘点，用于改造后证明「现有图片和 VR 附件兼容性未被破坏」。
> 所有结论均标注 `文件:行号`；测试数字来自本次**实际执行**，不是推测。

| 项 | 值 |
|---|---|
| 仓库 | `C:\Users\Administrator\WorkBuddy\2026-10-23-16-18-12\SMART-PM` |
| 分支 | `feat/db-07-file-assets` |
| 基线提交 | `8b2d183 fix: DB-02 second review 252adf0 — sequential epoch scan, vr-download isolation` |
| 执行环境 | Node `v22.22.2`（`C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`）、npm `10.9.7` |
| 本轮动作 | **只读分析 + 实际运行现有两套测试**。未修改任何业务代码 / 现有文件、未新增测试文件、未 `git commit`、未合并分支 |
| 测试命令 | 根目录 `npm test`（`node --test tests/*.test.cjs`）；后台 `npm --prefix admin-web test`（`node --test tests/*.test.mjs`） |

## 0. 结论速览

- **现状没有统一文件表**：图片和 VR 附件都是「业务记录里内嵌 URL/元数据 + 本地磁盘或云存储文件」两套并列实现，与 `docs/database/CURRENT-STATE.md:21` 一致。
- **当前 `/api/v2` 完全没有文件路由**：`admin-web/server.mjs:269-411` 只实现物业/组织接口（catalog / rooms / create / layout / archive）。`POST /api/v2/files`、`POST /api/v2/file-links`、`GET /api/v2/files/{id}/download`（`docs/database/API-CONTRACT.md:86-92`）是 DB-07 **新增**，基线中不存在。
- **VR 下载做过隔离（R2-02）**：`admin-web/server.mjs:517` 对带 `orgId` 的 content 记录一律 404，且在云下载/本地读文件之前完成；覆盖测试 `admin-web/tests/server-v2.test.mjs:342-424`。
- **最高风险入口：`GET /api/image-url`（`admin-web/server.mjs:582-590`）** —— 仅需一个已登录会话（viewer 即可，无 `authorize`、无归属/用途/权限点校验、无审计），即可把**任意 `cloud://` fileID** 换成 600 秒可直接下载的临时 URL。详见 §2.1。
- **测试基线**：根目录 `51 通过 / 0 失败`，后台 `82 通过 / 0 失败`，合计 `133 / 0`，两条命令退出码均为 0。逐字输出见 §3.2。

### 执行副作用说明（诚实记录）

本任务**唯一新增文件是本报告** `docs/database/DB-07-COMPAT-BASELINE.md`；未修改任何既有文件、未新增测试、未 `git commit`。

共享工作区存在**并行 teammate 产出**：执行期间先后观察到未跟踪文件 `DB-02-REVIEW.tmp.md`（内容为 `origin/docs/db-01-design:docs/database/DB-02-REVIEW.md`）与 `docs/database/DB-07-IMPLEMENTATION.md`。二者均**非本任务产生**，也未参与本报告的任何结论：本轮读取 review 报告用的是 `git show … | head -400`（管道到 stdout，无重定向），全程未写入仓库；按只读约束**未删除、未修改、未纳入报告依据**（依据的是 `git show` 的原始内容与当前分支源码）。首次 `git status` 为 `working tree clean`，末次 `git status --short` 仅列出上述未跟踪文件，**业务源码零改动**。后台测试使用 `mkdtemp(tmpdir())` 并在 `after` 中清理（`admin-web/tests/server.test.mjs:41,62-65`），仓库内未产生 `.data` 目录。

---

## 1. 现状清单

### 1.1 图片：字段 / 集合 / 写入 / 读取 / 鉴权

| # | 事实 | 文件:行号 |
|---|---|---|
| P01 | 字段 `houses.cover`（单张封面） | `admin-web/lib/model.mjs:72` |
| P02 | 字段 `houses.images`（数组，最多 12 项，逐项过 `imageURL`） | `admin-web/lib/model.mjs:73-75` |
| P03 | 字段 `content.image`（内容图片） | `admin-web/lib/model.mjs:85` |
| P04 | 图片地址白名单**仅 4 类**：`https://…`、`cloud://…`、`/uploads/{uuid}.(png\|jpg\|webp)`、`/assets/room-[123].jpg`；其余（含 `javascript:`）一律 400 | `admin-web/lib/model.mjs:45-55`（正则在 `:49`）；负向用例 `admin-web/tests/server.test.mjs:144-166` |
| P05 | 业务集合白名单 `houses / content / users / rooms` | `admin-web/lib/model.mjs:16`；存储白名单 `admin-web/lib/store.mjs:5-17` |
| P06 | 演示种子用静态图片 `/assets/room-{1,2,3}.jpg` 作 `cover`，`images` 为空数组 | `admin-web/lib/store.mjs:37-38`；实际文件 `admin-web/public/assets/room-1.jpg` / `room-2.jpg` / `room-3.jpg` |
| P07 | **写入路径 A（主要）**：`POST\|PUT /api/houses[/id]`、`/api/content[/id]` → `validate()` 产出完整 data → `store.change` 合并 | `admin-web/server.mjs:646-710`（`validate` 在 `:649`，`store.change` 在 `:700-709`）；`admin-web/lib/model.mjs:56-103`；`admin-web/lib/store.mjs:175-208`（`{...old, ...value}` 在 `:188`） |
| P08 | 写入路径 A 的 live 模式额外约束：`cover/image/images` 不得以 `/` 开头（必须用云存储或 HTTPS） | `admin-web/server.mjs:657-663` |
| P09 | 写入路径 A 关联房源分支：`PropertyService.saveListing` 也走同一份 `validate` 后的 data | `admin-web/server.mjs:680-689` |
| P10 | **写入路径 B（二进制上传）**：`POST /api/uploads`。5 MB 上限、PNG/JPEG/WebP magic bytes 校验、SVG 拒绝；demo 写 `{directory}/uploads/{uuid}.{ext}`（`mode 0o600`）返回 `/uploads/{filename}`；live 走 `store.app.uploadFile({cloudPath:'admin/{filename}'})` 返回 `fileID`(`cloud://`) | `admin-web/server.mjs:542-581`（限制 `:544`、magic `:546-566`、live `:568-574`、demo `:576-580`） |
| P11 | 上传接口鉴权 `authorize(role,"uploads",true)`：admin/editor 可，viewer 403 | `admin-web/server.mjs:543`；`admin-web/lib/model.mjs:19-24`；用例 `admin-web/tests/server.test.mjs:98-114`、`:236-253` |
| P12 | 后台 UI 上传与提交：`/api/uploads` 结果填入 `cover`/`image` 字段，表单提交时 `houses.images`、`content.vrFile` 一并写回 | `admin-web/public/app.js:588-611`、`:616-633`（`:625` images、`:626` vrFile）、`:510-518`（字段定义） |
| P13 | **写入旁路（云函数）**：`contentAdmin` 的 `action:'save'` 直接把 `payload` 写入 `content`，**无字段白名单、无 `imageURL`/`vrFile` 校验**；仅依赖 `users.role==='admin'` | `cloudfunctions/contentAdmin/index.js:51-64`（权限 `:19-35`） |
| P14 | 内容初始化云函数 `contentInit` 的种子数据**不含任何图片/VR 字段**（只有 icon/bg 等） | `cloudfunctions/contentInit/index.js:18-90`（通用字段注释 `:16`） |
| P15 | **读取路径（静态，完全无需登录）**：`GET /uploads/{uuid}.(png\|jpg\|webp)`，仅 demo 模式，严格正则，直接 `readFile` 返回字节 | `admin-web/server.mjs:715-721`、`:725-735`；`admin-web/lib/static-path.mjs` 不适用该分支 |
| P16 | **读取路径（静态，完全无需登录）**：`GET /`、`/index.html`、`/app.js`、`/style.css`、`/assets/*` → `resolvePublicFile(root, path)` 读 `admin-web/public/`；有路径穿越防护 | `admin-web/server.mjs:723`；`admin-web/lib/static-path.mjs:6-21`；用例 `admin-web/tests/static-path.test.mjs:10-28` |
| P17 | **读取路径（live 换 URL）**：`GET /api/image-url?id=cloud://…` → `store.app.getTempFileURL({fileList:[{fileID:id,maxAge:600}]})` 返回 600 秒临时下载 URL | `admin-web/server.mjs:582-590`；后台 UI 调用 `admin-web/public/app.js:117-127` |
| P18 | `/api/image-url` 的鉴权：**只要求登录会话**（在 `admin-web/server.mjs:197` 之后），**未调用 `authorize`**，仅校验 `mode==='live'` 与 `id.startsWith("cloud://")`；无归属/用途/权限点/文件类型校验、无审计、且**零测试覆盖**（见 §3.4） | `admin-web/server.mjs:582-590`（与 `:596` 的通用 `authorize` 分支对比可见其被跳过） |
| P19 | **读取路径（后台）**：`GET /api/houses`、`/api/content`、`/api/dashboard` 返回业务记录整行（含 `cover/images/image/vrFile/vrUrl` 等元数据，不含文件字节）；需登录 + `authorize`；列表过滤 `!r.orgId` | `admin-web/server.mjs:635-645`、`:412-438`；`publicRecord` 对非 users 原样返回 `admin-web/lib/model.mjs:104-105` |
| P20 | **读取路径（客户小程序，公开云函数）**：`getHouses` 返回 `status=在租 且 isPublic!=true` 的**完整 houses 文档**；`contentList` 返回 `enabled=true` 的**完整 content 文档**。二者**无身份校验、无字段白名单、无组织/归档过滤** | `cloudfunctions/getHouses/index.js:11-62`（条件 `:15`、返回 `:46-56`）；`cloudfunctions/contentList/index.js:13-29`（条件 `:16`、返回 `:23-25`）；`docs/database/API-CONTRACT.md:101` 明确要求后续按白名单返回 |
| P21 | 客户端调用与消费：`api.listHouses`/`api.listContent` → `normalizeHouse` 取 `cover/image/images[0]` → 首页/租房页渲染 | `miniprogram/services/api.js:24-36`、`:45-48`；`miniprogram/pages/home/index.js:3-5,29,37,75`；`miniprogram/pages/home/index.wxml:17`；`miniprogram/pages/rental/index.js:23`；`miniprogram/pages/rental/index.wxml:95` |
| P22 | 小程序侧**没有** `cloud://` → 临时 URL 的转换逻辑（全目录检索 `getTempFileURL` / `fileID` / `downloadFile` 无匹配）；live 模式云图片仅后台 UI 通过 `/api/image-url` 转换 | `miniprogram/**`（全目录 Grep 无匹配）；对照 `admin-web/public/app.js:112-127` |

**「是否不需要登录/权限就能访问」结论**：
- **是**：`GET /uploads/*`（P15，demo-only）、`GET /assets/*` 及全部 public 静态（P16）、云函数 `getHouses` / `contentList`（P20，客户端可直调且函数内无身份校验）。
- **需登录但无角色/归属校验**：`GET /api/image-url`（P17/P18，viewer 即可）。
- **需登录 + 全局角色**：后台列表（P19）、上传（P10/P11）。

### 1.2 VR 附件：存储 / 下载 / 隔离

| # | 事实 | 文件:行号 |
|---|---|---|
| V01 | `content.vrUrl`：VR **在线链接**，只允许无账号密码的 HTTPS 地址（≤2048 字） | `admin-web/lib/model.mjs:86`；`admin-web/lib/vr.mjs:3-21`；用例 `admin-web/tests/vr.test.mjs:4-14` |
| V02 | `content.vrFile`：**附件元数据** `{url,name,size}`，非在线托管内容 | `admin-web/lib/model.mjs:87`；`admin-web/lib/vr.mjs:22-45` |
| V03 | `vrFile.url` 格式硬校验：`^(\/vr-files\/\|cloud:\/\/[^\s]+\/admin-vr\/)[a-f0-9-]+\.(zip\|html)$`；`name` 禁 `\r\n/\\` 且须 `.zip/.html?`；`size` 1B–50 MB | `admin-web/lib/vr.mjs:29`（正则）、`:34-41`（name）、`:42-43`（size）、`:2`（`VR_LIMIT`） |
| V04 | 文件类型/内容校验：仅 ZIP（含 PK 魔数）或 HTML（前 64 KB 含 doctype/html/head/body） | `admin-web/lib/vr.mjs:46-73` |
| V05 | **上传/落盘**：`POST /api/vr-upload`（`POST`，`?name=`）。demo → `{directory}/vr-files/{uuid}.(zip\|html)`，`mode 0o600`，返回 `/vr-files/{filename}`；live → `store.app.uploadFile({cloudPath:'admin-vr/{filename}'})` 返回 `fileID` | `admin-web/server.mjs:486-508`（demo `:501-505`、live `:493-499`） |
| V06 | 上传鉴权 `authorize(role,"uploads",true)`（admin/editor 可，viewer/未登录/缺 CSRF 均 ≥400） | `admin-web/server.mjs:487`；用例 `admin-web/tests/server.test.mjs:254-285` |
| V07 | 关联写入：后台 UI 把上传结果存进 `content.vrFile`，与 `vrUrl` 一起提交 | `admin-web/public/app.js:519-526`、`:553-585`、`:626` |
| V08 | **下载接口**：`GET /api/vr-download?id=<contentId>`（参数是 **content 记录 ID**，不是文件 ID） | `admin-web/server.mjs:509-541`；UI 链接 `admin-web/public/app.js:526` |
| V09 | 下载取记录：`store.list("content").find(r._id === id)` —— 从**完整 content 集合**按 ID 取，不做组织范围查询 | `admin-web/server.mjs:511-513` |
| V10 | **隔离（R2-02 修复）**：`if (record?.orgId) fail("VR 文件不存在", 404)`，位置在 `downloadFile` / `readFile` **之前**；即带 `orgId` 的组织记录一律不服务 | `admin-web/server.mjs:514-517`；来源 `git log` `8b2d183`；审查报告 `origin/docs/db-01-design:docs/database/DB-02-REVIEW.md` 第三轮 R2-02 段；实施记录 `docs/database/DB-02-IMPLEMENTATION.md:50` |
| V11 | 隔离覆盖测试：无组织账号 404、加入其他组织仍 404、全局 admin 仍 404、旧（无 orgId）内容 200 正常下载 | `admin-web/tests/server-v2.test.mjs:342-424`（断言 `:390-392`、`:403-407`、`:420-423`） |
| V12 | 下载字节来源：live → `store.app.downloadFile({fileID:file.url})`；demo → `readFile(join(directory,"vr-files", file.url.split("/").pop()))` | `admin-web/server.mjs:521-529` |
| V13 | 下载响应：`application/octet-stream` + `Content-Disposition: attachment` + `Content-Security-Policy: sandbox; default-src 'none'` | `admin-web/server.mjs:531-540`；断言 `admin-web/tests/server.test.mjs:308-311` |
| V14 | VR 文件**不静态暴露**：`/vr-files/*` 未进入 `server.mjs:715` 的 `startsWith("/uploads/")` 分支，改走 `resolvePublicFile(root,path)` → `admin-web/public/`；而实际文件在 `{directory}/vr-files/`，故直接 GET 返回 404 | `admin-web/server.mjs:715`、`:723`；`admin-web/lib/static-path.mjs:14`；断言 `admin-web/tests/server.test.mjs:312` |
| V15 | 下载全局鉴权：需登录会话（`admin-web/server.mjs:197`）+ `authorize(role,"content")`（读权限 → **admin/editor/viewer 全部可通过**） | `admin-web/server.mjs:510`；`admin-web/lib/model.mjs:17-28`；未登录 401 断言 `admin-web/tests/server.test.mjs:313-316`；viewer 可下载断言 `admin-web/tests/server.test.mjs:305-308` |
| V16 | 小程序侧**不消费 vrFile**：VR 页只按 `vrUrl` 打开 HTTPS 在线链接；首页也只暴露 https 的 `vrUrl` | `miniprogram/pages/vr/index.js:6-9`；`miniprogram/pages/home/index.js:37,67-69`；用例 `tests/frontend.test.cjs:79-88` |
| V17 | `contentList` 云函数会把 `vrFile`（含 `url`/`name`/`size`）作为完整文档的一部分返回给**未登录**小程序用户（对象定位信息暴露，但**不返回文件字节**，因为 V14 使 `/vr-files/*` 不可直接取、`vr-download` 又要求后台登录） | `cloudfunctions/contentList/index.js:23-25`；对照 `admin-web/server.mjs:715`、`:197` |

**「隔离做到什么程度 / 有没有遗留不鉴权也能下」结论**：

- **没有发现「完全不鉴权即可下载 VR 字节」的遗留路径**：`/vr-files/*` 静态不可达（V14，测试 `server.test.mjs:312` 断言 404），`/api/vr-download` 未登录返回 401（V15，测试 `server.test.mjs:313-316`）、且位于 `/api/` 分支内受 `server.mjs:197` 会话检查保护。
- **但当前权限校验深度有限，正是 DB-07 的红线所在**：
  1. 只校验**全局角色**（viewer 即可，V15），**不校验调用者组织成员关系、不校验内容归属、不校验引用对象、不校验 `purpose/visibility`、不写下载审计**（`admin-web/server.mjs:509-541` 全程无 `audit()` 调用）。任何已登录 viewer 都能下载**任意无 `orgId` 的** content 记录的 VR 附件。
  2. R2-02 的隔离是「**带 `orgId` 就 404**」的粗粒度掩蔽（V10），不是按调用者权限判定；对 legacy（无 `orgId`）记录一律放行。
  3. `file.url.split("/").pop()` 的文件名来自业务记录（V12），其安全性完全依赖 `vrFile()` 的格式正则（V03）与 `validate()` 的字段白名单（P07）；`server.test.mjs:328-337` 已断言 `/vr-files/../../accounts.json` 被 400 拒绝。`contentAdmin` 云函数旁路（P13）不经过该校验，是潜在绕过点。
  4. 目标模型中的 `file_assets.visibility` / `file_links` / `authorizedDownload` / 读取审计（`docs/database/DATA-MODEL.md:60-61`、`:144`；`docs/database/API-CONTRACT.md:88-92`）在基线中**完全不存在**。

### 1.3 能取到文件内容的 HTTP 入口清单（下载/取流）

| # | 入口 | 返回内容 | 文件:行号 |
|---|---|---|---|
| D01 | `GET /uploads/{uuid}.(png\|jpg\|webp)` | 图片字节（demo-only，公开） | `admin-web/server.mjs:715-721`、`:725-735` |
| D02 | `GET /*`（public 静态，含 `/assets/room-{1,2,3}.jpg`） | 静态文件字节（公开） | `admin-web/server.mjs:723`；`admin-web/lib/static-path.mjs:6-21` |
| D03 | `GET /api/image-url?id=cloud://…` | 任意云对象的 **600 秒临时下载 URL**（非字节，但可直接兑换字节） | `admin-web/server.mjs:582-590` |
| D04 | `GET /api/vr-download?id=<contentId>` | VR 附件字节流（octet-stream / attachment / sandbox） | `admin-web/server.mjs:509-541` |
| D05 | `POST /api/uploads` | 写入图片并返回 URL（写入侧入口） | `admin-web/server.mjs:542-581` |
| D06 | `POST /api/vr-upload` | 写入 VR 文件并返回 url（写入侧入口） | `admin-web/server.mjs:486-508` |
| D07 | 云 SDK 原语 `uploadFile` / `downloadFile` / `getTempFileURL` | 本身无鉴权，完全依附于 D03–D06 的 HTTP 入口 | `admin-web/server.mjs:494`、`:523`、`:569`、`:586` |
| D08 | 云函数 `contentList` / `getHouses` | 返回**完整业务文档**（含 `vrFile.url`、`cover`、`images`、fileID 等元数据，**不含字节**） | `cloudfunctions/contentList/index.js:23-25`；`cloudfunctions/getHouses/index.js:46-56` |
| — | 目标接口 `/api/v2/files`、`/api/v2/file-links`、`/api/v2/files/{id}/download` | **基线中不存在**，DB-07 新增 | `docs/database/API-CONTRACT.md:86-92`；对照 `admin-web/server.mjs:269-411` 现有 v2 路由全集 |

---

## 2. 文件访问入口全景表（路径 × 鉴权要求 × 可达数据范围 × 风险等级）

风险等级定义：**高** = 可绕过权限取到/兑换文件（或把私密对象定位信息暴露给未登录方）；**中** = 需要后台登录但校验粒度不足，或属于写入侧；**低** = 完全公开但仅限静态公开资源，或有完整会话+角色+CSRF 校验且不返回字节。

| 入口 | 方法 | 鉴权要求 | 可达数据范围 | 是否公开暴露 / 越权风险 | 风险 | 依据 |
|---|---|---|---|---|---|---|
| `/uploads/{uuid}.(png\|jpg\|webp)` | GET/HEAD | **无**（在 `/api/` 分支外，`server.mjs:713` 只查方法） | 仅 demo 模式 `{directory}/uploads/` 下 uuid 图片；严格正则 + 扩展名白名单；live 模式直接 404 | **是，完全公开**；但范围极窄、无组织数据、生产 live 禁用 | 中 | `admin-web/server.mjs:715-721`、`:725-735`；`docs/database/DB-02-IMPLEMENTATION.md:50` |
| `/*`（`/`、`/index.html`、`/app.js`、`/style.css`、`/assets/*`） | GET/HEAD | **无** | `admin-web/public/` 内文件；含 3 张静态房源图 `room-{1,2,3}.jpg` | **是，完全公开**；有穿越防护（`static-path.mjs:16-19`），不触及 `.data`/业务记录 | 低-中 | `admin-web/server.mjs:723`；`admin-web/lib/static-path.mjs:6-21`；断言 `admin-web/tests/server.test.mjs:416-424` |
| **`/api/image-url?id=cloud://…`** | GET | **仅登录会话**（`server.mjs:197`）；**无 `authorize`、无归属/用途/权限点校验、无审计、无文件类型限制** | **任意 `cloud://` fileID** → `getTempFileURL(maxAge:600)` 临时下载 URL；不限于图片、不限于本组织、不校验该文件是否应公开 | **是（越高权越权）**：任何 viewer 只要知道/猜到 fileID 即可兑换 600 秒下载凭证；改造后私密资料一旦落在云存储，此接口即天然旁路 | **高（最高）** | `admin-web/server.mjs:582-590`；UI `admin-web/public/app.js:117-127`；全库测试文件检索 `image-url`/`getTempFileURL`/`cloud://` **零覆盖** |
| `/api/vr-download?id=<contentId>` | GET | 登录会话 + `authorize(role,"content")` → **admin/editor/viewer 均可**；带 `orgId` 记录 404（R2-02） | 任意**无 `orgId`** 的 content 记录的 `vrFile` 字节；live 走 `downloadFile`，demo 走本地 `readFile` | **有越权风险**：只按全局角色、不按组织/归属/用途/权限点；无下载审计；是契约明确点名的「旧下载接口」 | **高** | `admin-web/server.mjs:509-541`、`:197`；`admin-web/lib/model.mjs:17-28`；`docs/database/API-CONTRACT.md:102` |
| `/api/uploads` | POST | 登录 + `authorize(role,"uploads",true)`（admin/editor）+ Origin/CSRF | 写入图片并返回可访问 URL；5 MB、3 种 magic 校验 | 写入侧；若 DB-07 复用此路由落私密文件即违反「新私有资料绝不复用旧公开上传路由」 | 中 | `admin-web/server.mjs:542-581`、`:543`、`:116-120`、`:198-202`；`admin-web/lib/model.mjs:19-24` |
| `/api/vr-upload` | POST | 登录 + `authorize(role,"uploads",true)` + Origin/CSRF | 写入 VR ZIP/HTML 并返回 `vrFile` 元数据；50 MB、类型校验 | 写入侧；同上 | 中 | `admin-web/server.mjs:486-508`；`admin-web/lib/vr.mjs:46-73` |
| `/api/houses`、`/api/content`、`/api/dashboard` | GET | 登录 + `authorize(role,resource)`；过滤 `!r.orgId` | 业务记录整行（含 `cover`/`images`/`image`/`vrFile`/`vrUrl` 元数据，**不含字节**） | 元数据可见面；不返回文件内容，但会暴露对象定位 | 低 | `admin-web/server.mjs:635-645`、`:412-438`、`:596`；`admin-web/lib/model.mjs:104-105` |
| `/api/houses[/id]`、`/api/content[/id]` | POST/PUT | 登录 + 写权限 + `authorize` + Origin/CSRF；`validate()` 字段白名单；live 禁 `/` 开头地址；拒绝 orgId 目标 | 写入图片 URL / VR 元数据 | 有完整校验；但 `contentAdmin` 云函数是绕过 `validate()` 的旁路 | 低-中 | `admin-web/server.mjs:646-710`、`:649`、`:657-663`、`:650-656`；`admin-web/lib/model.mjs:56-103` |
| `/api/property/snapshot` | GET | 登录 + `authorize(role,"rooms")` | 物业目录/房间/房源快照（含房源图片元数据） | 元数据，不含字节 | 低 | `admin-web/server.mjs:222-226` |
| 云函数 `contentList` | callFunction | **无身份校验、无字段白名单、无组织/归档过滤** | `enabled=true` 的**完整 content 文档**（含 `vrFile.url`、`image`、`vrUrl`，未来含 fileId） | **是，公开暴露**：未登录小程序即可拿到附件对象定位信息；契约 §8 要求按白名单返回 | **高** | `cloudfunctions/contentList/index.js:13-29`；`miniprogram/services/api.js:45-48`；`docs/database/API-CONTRACT.md:101` |
| 云函数 `getHouses` | callFunction | **无身份校验、无字段白名单、无组织/归档过滤** | `status=在租 且 isPublic!=true` 的**完整 houses 文档**（含 `cover`、`images`） | **是**：同上；DB-02 已承认此限制 | 中-高 | `cloudfunctions/getHouses/index.js:11-62`；`docs/database/DB-02-IMPLEMENTATION.md:30` |
| 云函数 `contentAdmin`（`action:save/delete/toggle`） | callFunction | `users.role==='admin'`（OPENID 映射） | 可直接写 `content` **任意字段**，绕过 `imageURL`/`vrFile` 校验 | 写入旁路；若私密文件引用经此写入则不受新用途校验 | 中 | `cloudfunctions/contentAdmin/index.js:19-35`、`:51-78` |
| 云函数 `houseAdmin` | callFunction | `users.role==='admin'` | 只改 `users.houses`，**不写文件字段** | 非文件入口（列出以证明已盘点） | 低 | `cloudfunctions/houseAdmin/index.js:28-90` |
| `/api/config` | GET | **完全公开**（位于 `server.mjs:197` 登录检查之前） | 仅 `{mode,environment,version}`，**不含任何文件内容** | 不构成文件入口（列出以证明已盘点） | 低 | `admin-web/server.mjs:121-126` |
| `/api/v2/files*`、`/api/v2/file-links*` | — | **基线不存在** | — | DB-07 新增，需按 §4-C 断言验收 | — | `docs/database/API-CONTRACT.md:86-92`；对照 `admin-web/server.mjs:269-411` |

### 2.1 最高风险入口（单点结论）

> **`GET /api/image-url`（`admin-web/server.mjs:582-590`）**

理由（全部有行号）：
1. 它是**通用**的「云对象 ID → 临时下载 URL」兑换器：只校验 `mode==='live'` 与 `id.startsWith("cloud://")`（`admin-web/server.mjs:584`），随后直接 `store.app.getTempFileURL({fileList:[{fileID:id,maxAge:600}]})`（`:586-588`）并返回 `tempFileURL`（`:589`）。**名字叫 image-url，却不校验文件类型、用途、可见性、归属或权限点**。
2. 鉴权只有 `/api/` 分支的登录会话检查（`admin-web/server.mjs:197`），**没有调用 `authorize`**（对比同文件 `:487`、`:543`、`:596` 都调用了）；任何 viewer 账号都能调用（`admin-web/lib/model.mjs:17-18`）。
3. 兑换结果是**可直接下载的 600 秒 URL**，一旦签发就脱离服务端后续鉴权，且不写任何读取审计（`admin-web/server.mjs:582-590` 全程无 `audit()`）。
4. **与 DB-07 改造正面冲突**：改造要求统一文件资源并把私密资料（证件、受限身份资料）落到本地/云存储（`docs/database/DATA-MODEL.md:60-61`、`:144`），而契约 §8 明确「旧图片/VR URL 保留兼容映射；**新私有资料绝不复用旧公开上传路由**」（`docs/database/API-CONTRACT.md:102`）与「不向客户返回私有实名文件」（`:101`）。只要私密对象的 fileID 被泄露/枚举，这个旧公开图片接口就能直接兑换下载凭证。
5. **零测试覆盖**：全库 `*.test.cjs` / `*.test.mjs` 中检索 `image-url`、`getTempFileURL`、`cloud://` 均无匹配（见 §3.4），改造时极易被遗漏回归。

次要但需并列记录：**`/uploads/*` 是唯一「完全无需登录」的文件字节入口**（`admin-web/server.mjs:715-721`），但被 demo-only + uuid 严格正则 + 3 种图片扩展名收窄到演示图片、生产 live 模式直接 404（`admin-web/server.mjs:717`），实际暴露面远小于 `/api/image-url`；若 DB-07 放宽该正则或在 live 启用，风险立即升级为最高。

---

## 3. 现有测试基线（真实执行结果）

### 3.1 执行命令与环境（逐字）

```
$ node -v && npm -v && "C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" -v
v22.22.2
10.9.7
v22.22.2

$ npm test                          # 根目录，node --test tests/*.test.cjs
$ npm --prefix admin-web test      # 后台，node --test tests/*.test.mjs
```

两条命令均在分支 `feat/db-07-file-assets` / 提交 `8b2d183` 上执行，**未修改任何测试文件**。

### 3.2 真实输出（TAP 汇总块逐字摘录）

**根目录 `npm test`**：

```
> smart-pm@0.1.0-beta.16 test
> node --test tests/*.test.cjs

TAP version 13
...
1..51
# tests 51
# suites 0
# pass 51
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 279.3723
ROOT_NPM_EXIT=0
```

**后台 `npm --prefix admin-web test`**：

```
> smart-pm-admin@0.3.0-beta.1 test
> node --test tests/*.test.mjs

TAP version 13
...
1..82
# tests 82
# suites 0
# pass 82
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2234.8747
ADMIN_NPM_EXIT=0
```

**合计：133 项测试，133 通过，0 失败，0 跳过，0 todo；两条命令退出码均为 0。**
（上面 `...` 处为逐项 `ok N - <用例名>` 行，实际输出中**全部为 `ok`、无一条 `not ok`**；完整 133 条用例名见 §附录。）

> 未执行、也不声称通过：`npm run test:sdk`（`admin-web/package.json` 的 `check-sdk.mjs`）、`npm run test:browser`（`check-browser.cjs`）、根目录 `npm run check`（`scripts/check-miniprogram.mjs`）。`docs/database/DB-02-IMPLEMENTATION.md:39-41` 与 `DB-02-REVIEW.md` 第三轮记录的是**历史**执行结果，本报告只采信本轮实测。

### 3.3 每个测试文件覆盖什么（15 个文件，用例数合计 133）

**根目录 `tests/*.test.cjs`（51 项）**

| 文件 | 用例数 | 覆盖内容 | 与文件/图片/VR/下载相关 |
|---|---|---|---|
| `cloud-bootstrap.test.cjs` | 2 | live/demo 云环境初始化、配置不全不初始化 | — |
| `frontend.test.cjs` | 16 | 小程序服务层与页面：demo 读零云调用、锁权限、收藏、home/life 列表、聊天、phoneLogin | **是**：`:79-88` VR 页按 `vrUrl` 解析（有效/缺失/`javascript:` 拒绝）、`api.listContent`；`:50-51` home 图片字段渲染（间接）；`:20-22` `listContent` |
| `layout.test.cjs` | 7 | 导航胶囊在 320/375/393/430/768px 布局 | — |
| `phone-login.test.cjs` | 8 | `phoneLogin` 云函数身份同步、绑定不被 owners 覆盖 | — |
| `public-houses.test.cjs` | 1 | `getHouses` 公共房在分页/计数前过滤 | 间接：`getHouses` 返回整文档（含 `cover`/`images`） |
| `wechat-modules.test.cjs` | 11 | JS-only 加载器注册 9 个页面 + app/tabbar + JSON import 兼容性 | 间接：注册 `pages/vr/index`、`pages/home/index` |
| `wxml.test.cjs` | 6 | WXML 语法校验 | — |

**后台 `admin-web/tests/*.test.mjs`（82 项）**

| 文件 | 用例数 | 覆盖内容 | 与文件/图片/VR/下载相关 |
|---|---|---|---|
| `auto-fill.test.mjs` | 10 | 楼层/房间自动填充、1000 房间分批、重放 | — |
| `layout-batches.test.mjs` | 3 | 整栋户型批量设置分批与失败重放 | — |
| `org-v2.test.mjs` | 20 | 组织引导、成员、唯一占位、归档屏障（F02/R2-01/F03）、幂等过期、事务内撤权 | 间接：归档阻断计数涉及房源，但不测文件 |
| `property.test.mjs` | 14 | 物业目录、房号唯一、批量创建、关联房源快照 | 间接：`houses` 记录写入路径 |
| `server.test.mjs` | 20 | **HTTP 层主回归**：匿名/Origin/CSRF、角色权限、房源 CRUD、分页、内容保存、绑定、云事务、密码、限流 | **核心**：`:144-166` 图片 scheme 白名单；`:236-253` 图片上传（SVG 拒绝 / PNG 返回 `/uploads/` URL / 该 URL 可直接 GET 取回字节）；`:254-344` VR 附件全链路（上传→保存→下载→响应头→字节一致→`/vr-files/*` 404→未登录 401→非法 vrUrl/穿越 url 400→清空字段）；`:416-424` 静态 CSP 与穿越；`:98-114` viewer 不可上传 |
| `server-v2.test.mjs` | 8 | v2 信封、幂等、组织流、F01/F04、游标分页 | **核心**：`:342-424` R2-02 VR 下载组织隔离（无组织/其他组织/全局 admin 均 404，legacy 记录 200 正常下载） |
| `static-path.test.mjs` | 6 | Windows/Linux 首页与 `/assets/*` 解析、穿越/反斜杠/盘符/UNC/编码/null 拒绝 | **是**（间接保护公开静态文件入口） |
| `vr.test.mjs` | 1 | `vrLink`/`vrUpload`/`vrFile` 校验（HTTPS、ZIP/HTML、50 MB、文件名穿越） | **是** |

### 3.4 覆盖率说明与明确盲区

- **直接覆盖文件/图片/VR/下载的用例约 20 项**（`server.test.mjs` 6 项 + `server-v2.test.mjs` 1 项 + `vr.test.mjs` 1 项 + `static-path.test.mjs` 6 项 + `frontend.test.cjs` 2 项 + `public-houses.test.cjs` 1 项 + 零散断言），约占 133 项的 **15%**。属「关键路径覆盖」而非全面覆盖，与本基线定位一致。
- **零覆盖（重大盲区，DB-07 必须补）**：
  1. `GET /api/image-url` / `getTempFileURL` / 任何 `cloud://` fileID 处理 —— 全部 `*.test.cjs` / `*.test.mjs` 检索无匹配。
  2. **live 模式云存储分支**：`uploadFile`（`server.mjs:494`、`:569`）、`downloadFile`（`:523`）、`getTempFileURL`（`:586`）均无测试；现有测试全部跑 `demo` 本地模式，`server.test.mjs:377-415` 的 CloudStore 用例只测 `runTransaction` 事务写入，不测文件。
  3. `contentList` 字段白名单 / `vrFile.url` 泄露 —— `public-houses.test.cjs:14-19` 只断言 `isPublic` 过滤，无任何字段断言；`contentList` 无对应测试文件。
  4. `contentAdmin` 云函数 `action:save` 写入旁路 —— 无测试文件。
  5. **私密资料 / `visibility` / `purpose` / 下载审计** —— 概念与代码在基线中均不存在（`docs/database/DATA-MODEL.md:60-61`、`:144` 为目标设计），自然无测试。
  6. `/uploads/*` 的「无需登录」仅有 1 处隐含断言（`server.test.mjs:250` 的 `fetch(url + r.data.url)` 未带 Cookie），没有显式的鉴权/越权/正则负向用例。

### 3.5 DB-07 改造后回归风险点（按受影响概率排序）

| # | 风险点 | 具体会挂的断言 | 依据 |
|---|---|---|---|
| R1 | 图片上传返回格式/存储路径改变 | `server.test.mjs:246-252` 断言 `url` 匹配 `^\/uploads\/` 且该 URL 能 GET 回原始字节 | `admin-web/server.mjs:576-580`、`admin-web/tests/server.test.mjs:236-253` |
| R2 | VR 附件全链路字段名/下载接口改变 | `server.test.mjs:286-343` 整条：`vrFile.name`、`vrUrl`、200 + attachment + sandbox CSP、字节一致、`/vr-files/*` 404、未登录 401、非法 url 400、`vrFile:null` 清空 | `admin-web/server.mjs:486-541`、`admin-web/tests/server.test.mjs:254-344` |
| R3 | vr-download 权限模型升级（按引用对象/purpose/组织判定） | `server-v2.test.mjs:390-423` 的「orgId 记录 404 / legacy 记录 200 / 全局 admin 404」语义必须保持或同步说明 | `admin-web/server.mjs:514-517`、`admin-web/tests/server-v2.test.mjs:342-424` |
| R4 | 统一文件资源后校验器规则变化 | `vr.test.mjs:4-23`（`vrFile` url 正则、50 MB、文件名穿越）、`server.test.mjs:144-166`（`imageURL` 4 类白名单） | `admin-web/lib/vr.mjs:22-45`、`admin-web/lib/model.mjs:45-55` |
| R5 | 新增本地/云存储适配器或静态目录 | `static-path.test.mjs:10-28` 全 6 项 + `server.test.mjs:416-424`（穿越、`/.data/...`、`/server.mjs` 404、CSP） | `admin-web/lib/static-path.mjs:6-21`、`admin-web/server.mjs:715-735` |
| R6 | `getHouses`/`contentList` 按契约 §8 加白名单/归档/组织过滤 | `public-houses.test.cjs:14-19` 与 `frontend.test.cjs:20-22,50-51,79-88` 依赖「返回整文档 / `listContent` 原样」的行为 | `cloudfunctions/getHouses/index.js:46-56`、`cloudfunctions/contentList/index.js:23-25`、`docs/database/API-CONTRACT.md:101-102` |
| R7 | live 模式本地地址约束 | `server.mjs:657-663` 禁止 `cover/image/images` 以 `/` 开头；若本地存储适配器在 live 启用需重新确认 | `admin-web/server.mjs:657-663` |
| R8 | 小程序 VR 消费方式改变（改为小程序下载附件） | `frontend.test.cjs:79-88`（按 `vrUrl` 解析）与 `home/index.js:37,67-69` | `miniprogram/pages/vr/index.js:6-9` |

---

## 4. 改造后必须验证的兼容性断言清单（工程师改完照此逐条验）

> 判定口径：**所有 [ ] 必须能勾选**。A/B 组证明「旧行为没坏」，C 组证明「安全红线没破」，D 组证明「测试基线不回退」。
>
> **断言修订记录（改造前，仅措辞）**：原 §4-A 第 5 条「live 模式 cloud 图片经 image-url 仍能换 URL」在 `FILE_LEGACY_IMAGE_FALLBACK=deny` 下会对**未登记**旧图片误判为回归，故拆成「已登记」与「未登记按开关」两条，未登记场景单独成项、切换默认值时只改一处。评审已拍板默认 **`deny`**：§4-A 现为「`deny` 下已登记公开图片仍可换 URL（200），未登记一律 403」，`allow` 仅作为开关备选值保留在同一条中。历次修订仅涉及本报告 §4 的验收断言措辞与已拍板口径备注；§1–§3 的现状描述、`文件:行号` 与实测测试数字（根 51 / 后台 82）**均未改动**，未触碰任何业务代码、既有文件或测试文件，未 `git commit`。

> **设计口径备注（已拍板，非基线现状）**：`admin-vr/` 前缀定性为 **public**（`vr-attachment` 的 `visibility=public`），`/api/vr-download?id=` 的 legacy 200 语义保持不变；`/api/image-url` 拒 `admin-vr/*.zip|html` 的依据是「图片接口只服务图片」的**作用域约束**（扩展名不在 `png|jpg|jpeg|webp`），**不是**密级判定。密级拦截只对 `private/` 前缀 / 登记为 `visibility=private` 的对象生效。因此 §4-C 的用例须把两类语义**分开命名、分开断言**：作用域 → 403、密级 → 403，并配「`admin-vr/*.html` 经 `vr-download` 仍 200」的正向对照，证明作用域拦截未伤及 VR 兼容性。口径来源 `docs/database/DB-07-IMPLEMENTATION.md` §5 末尾专节与 §10 第 3c 条（以章节/条目号为准，行号可能随方案修订漂移）。基线原未记载该设计矛盾（基线只钉改造前现状），此处按评审拍板补记，**不新增勾选断言**。

### A. 图片兼容（保留现有图片）

- [ ] `houses.cover`、`houses.images`、`content.image` 字段仍可写入，且旧 4 类地址（`https://`、`cloud://`、`/uploads/{uuid}.(png|jpg|webp)`、`/assets/room-[123].jpg`）仍被接受，其余 scheme 仍 400 — `admin-web/lib/model.mjs:45-55,72-75,85`；`admin-web/tests/server.test.mjs:144-166`
- [ ] `POST /api/uploads` 仍可用（admin/editor，viewer 403），返回的 URL 在 demo 模式下仍能被 `GET` 直接取回原始字节 — `admin-web/server.mjs:542-581,715-721`；`admin-web/tests/server.test.mjs:236-253`
- [ ] 5 MB 上限、PNG/JPEG/WebP magic bytes 校验、SVG 拒绝不变 — `admin-web/server.mjs:544-566`
- [ ] `/assets/room-{1,2,3}.jpg` 与演示种子 `cover` 仍可无鉴权访问 — `admin-web/lib/store.mjs:37`；`admin-web/lib/static-path.mjs:6-21`
- [ ] **`deny` 下已登记的公开图片仍可换 URL（200）**：live 模式**已登记**的 `cloud://` 旧图片经 `/api/image-url` 仍能换成可显示 URL（后台 UI 不白屏）；这是默认 `deny` 成立的前提，须由盘点脚本保证存量公开图片登记无遗漏 — `admin-web/server.mjs:582-590`；`admin-web/public/app.js:117-127`；设计文档 §10「存量图片显示连续性」条目
- [ ] **换临时 URL 前须已登录（未登录不得换取），且须校验文件记录归属与用途 —— 私有资料一律不签发**；**未登记**的旧 `cloud://` 图片在默认 **`deny`** 下**一律 403**（不签发 URL）；`allow` 仅作为 `FILE_LEGACY_IMAGE_FALLBACK` 的备选值保留（该值下仍可换 URL），**切换默认值时只改这一条预期值** — 设计文档 §4 配置位 / §5 拦截点 / §9 待确认 1（见 `docs/database/DB-07-IMPLEMENTATION.md`，以章节号为准，行号可能随方案修订漂移）；`docs/database/API-CONTRACT.md:102`。该开关**只作用于未登记旧图片**，不得影响 §4-C 第 1 条「登记为 private 一律 403」的红线断言
- [ ] 小程序首页/租房页仍能从 `cover || image || images[0]` 渲染 — `miniprogram/services/api.js:24-36`；`miniprogram/pages/home/index.js:3-5,29`；`miniprogram/pages/rental/index.js:23`
- [ ] `getHouses` / `contentList` 仍返回 `cover`/`images`/`image` 供客户展示（**但见 C4 白名单约束**） — `cloudfunctions/getHouses/index.js:46-56`；`cloudfunctions/contentList/index.js:23-25`

### B. VR 附件兼容（保留现有 VR）

- [ ] `content.vrUrl` 仍是 HTTPS 外链，小程序 VR 页仍能按内容 ID 解析，非法链接仍被拒 — `admin-web/lib/vr.mjs:3-21`；`miniprogram/pages/vr/index.js:6-9`；`tests/frontend.test.cjs:79-88`
- [ ] `content.vrFile` 仍保留 `{url,name,size}`，ZIP/HTML 类型、50 MB、文件名/url 正则校验不变 — `admin-web/lib/vr.mjs:2,22-45,46-73`；`admin-web/tests/vr.test.mjs:4-23`
- [ ] `POST /api/vr-upload` 返回的 url 仍能保存到 `content.vrFile` 并被 `vr-download` 取回 — `admin-web/server.mjs:486-508`；`admin-web/public/app.js:571-574,626`
- [ ] `GET /api/vr-download?id=<legacy contentId>` 仍返回原字节，响应头仍是 `attachment` + `sandbox; default-src 'none'` — `admin-web/server.mjs:509-541`；`admin-web/tests/server.test.mjs:305-311`
- [ ] `/vr-files/*` 仍**不静态暴露**（直接 GET 404） — `admin-web/server.mjs:715,723`；`admin-web/tests/server.test.mjs:312`
- [ ] 未登录访问 `vr-download` 仍 401；viewer 仍不能上传 VR/图片 — `admin-web/server.mjs:197,487,543`；`admin-web/tests/server.test.mjs:266-275,313-316`
- [ ] **R2-02 隔离不回退**：带 `orgId` 的 content 记录一律 404，且检查位置在 `downloadFile` / `readFile` **之前**；无组织账号、其他组织账号、全局 admin 均 404，legacy 记录 200 — `admin-web/server.mjs:514-517`；`admin-web/tests/server-v2.test.mjs:342-424`
- [ ] `/vr-files/../../accounts.json` 之类的穿越 `vrFile.url` 仍被 400 拒绝 — `admin-web/lib/vr.mjs:29`；`admin-web/tests/server.test.mjs:328-337`

### C. 安全红线（私密资料不得经公开图片接口或旧下载接口访问）

- [ ] **私密资料（证件 / `visibility=private` / `identity_private` 引用）不能通过 `GET /api/image-url` 兑换临时 URL** —— 该接口须收敛为「仅 public 图片 + 按引用对象/用途/权限点校验」或直接下线通用 fileID 兑换；不得保留「任意 `cloud://` → 600s URL」 — `admin-web/server.mjs:582-590`；`docs/database/API-CONTRACT.md:102`
- [ ] **私密资料不能通过 `/api/vr-download` 下载** —— 旧下载接口只服务 legacy `content.vrFile`，不得被复用为通用文件下载通道 — `admin-web/server.mjs:509-541`；`docs/database/API-CONTRACT.md:102`
- [ ] `POST /api/uploads`、`POST /api/vr-upload` 不得成为私密文件的落地路径；新私有资料走 `/api/v2/files` — `admin-web/server.mjs:486-508,542-581`；`docs/database/API-CONTRACT.md:88,92`
- [ ] **`contentList` 本轮已纳入修复范围**：收敛为三态鉴权 + 字段白名单（剔除 `vrFile`、`fileIds`/`assetIds`、`orgId`），不得向未登录客户返回 fileId、`vrFile.url`、私有文件引用或实名资料；**修复后应从风险清单移入已修复项**。兼容性对象只有 `home`（`miniprogram/pages/home/index.js:24`）与 `vr`（`miniprogram/pages/vr/index.js:6`）两页；返回结构 `{code:0,data,total}` 必须保持，否则 `miniprogram/services/api.js:21`（`code !== 0` 抛错）与 `api.js:45-48`（`listContent`，`r.data||[]` 在 `:47`）会坏 — `cloudfunctions/contentList/index.js:23-25`；`docs/database/API-CONTRACT.md:101`。**`getHouses` 不在本轮范围、不进 T05 必测范围**（`life/index.js:41`、`rental/index.js:70` 走 `api.listHouses()` → `getHouses`），仍按遗留切换门槛处理 — `cloudfunctions/getHouses/index.js:46-56`；`docs/database/DB-02-IMPLEMENTATION.md:30`
- [ ] `/uploads/*` 公开静态仍限 demo + uuid 严格正则 + 3 种图片扩展名；live 模式仍 404，不得放宽 — `admin-web/server.mjs:715-721`
- [ ] `contentAdmin` 的 `action:save` 旁路不得绕过新文件用途/权限校验（或纳入同一服务层） — `cloudfunctions/contentAdmin/index.js:51-64`；`docs/database/API-CONTRACT.md:3`
- [ ] 新 `GET /api/v2/files/{id}/download` **每次**校验引用对象与 purpose，私有文件代理下载/短期签名 URL，并写读取审计 — `docs/database/API-CONTRACT.md:90`；`docs/database/DATA-MODEL.md:60-61,144`
- [ ] NAS/私有存储未配置时返回 `STORAGE_UNAVAILABLE`，**不得**把私密资料回退到公开路径 — `docs/database/API-CONTRACT.md:92`；`docs/database/DATA-MODEL.md:144`
- [ ] 新增任何文件相关路由后，重新走一遍 §2 全景表，确认没有新增「无鉴权即可取字节」的入口

### D. 测试基线不回退

- [ ] 改造后 `npm test` 仍 **51/51**、`npm --prefix admin-web test` 仍 **82/82**（合计 133/0）；若断言被有意更新，须逐条列出并说明「旧行为为何变更、兼容性如何补偿」
- [ ] 为 `/api/image-url` 补至少 1 项越权/白名单测试（当前 0 覆盖） — §3.4(1)
- [ ] 为 live 模式 `uploadFile`/`downloadFile`/`getTempFileURL` 分支补测试（当前 0 覆盖） — §3.4(2)
- [ ] 为 `contentList` 白名单与 `contentAdmin` 写入旁路补测试（当前 0 覆盖） — §3.4(3)(4)
- [ ] 为「私密文件经旧入口（image-url / vr-download / uploads / vr-upload）访问一律被拒」补**负向**测试 — §4-C
- [ ] 保留并复跑 `server.test.mjs:236-344`、`server-v2.test.mjs:342-424`、`vr.test.mjs:4-23`、`static-path.test.mjs:10-28` 四组兼容性回归 — §3.5 R1–R5

---

## 附录：本次实测的全部 133 条用例名（取自实际 TAP 输出，逐项均为 `ok`）

> 以下逐项名称逐字摘自本次 `npm test` 与 `npm --prefix admin-web test` 的 TAP 输出；`--- duration_ms …` 元数据行已省略。**输出中无一条 `not ok`。**

**根目录 `npm test`（51 项）**

```
ok 1 - live bootstrap initializes only the selected cloud environment
ok 2 - demo and incomplete configuration do not initialize a live environment
ok 3 - demo read workflows use zero cloud calls and missing house stays missing
ok 4 - demo writes cannot unlock, send, log in, or add family
ok 5 - demo markRead is local and does not mutate original fixtures
ok 6 - live cloud failures never silently fall back to demo
ok 7 - live device list calls permission-filtered getDevices and maps location
ok 8 - unlock requires opt-in and login, sends only deviceId, suppresses duplicates
ok 9 - missing family/property and unscoped meter operations are explicit
ok 10 - rental favorite appears in profile favorites and toggles off
ok 11 - home search produces a meaningful empty result
ok 12 - life rental filter reaches adapter and only matching houses display
ok 13 - chat preserves draft and displays failed send in demo
ok 14 - phone login cancellation never calls backend
ok 15 - phone login suppresses duplicates, authenticates and logs out
ok 16 - phone login backend rejection clears busy state and permits retry
ok 17 - rental detail rechecks visibility after a cached listing becomes public
ok 18 - VR page resolves published content links by ID and rejects invalid links
ok 19 - navigation stays clear of capsule at 320px
ok 20 - navigation stays clear of capsule at 375px
ok 21 - navigation stays clear of capsule at 393px
ok 22 - navigation stays clear of capsule at 430px
ok 23 - navigation stays clear of capsule at 768px
ok 24 - invalid capsule falls back and zero status bar remains zero
ok 25 - older SDK and unavailable capsule do not break pages
ok 26 - login rejects missing authorization or identity before cloud calls
ok 27 - new login uses trusted WeChat identity and creates an unbound user
ok 28 - returning user updates existing account without duplicate creation
ok 29 - matched owner returns bound state and synchronized houses
ok 30 - existing house binding survives absent or unavailable owners collection
ok 31 - phone exchange errors cannot create an account
ok 32 - user database failure returns login failure
ok 33 - manual admin binding is not overwritten by legacy owner data on login
ok 34 - customer rental query excludes public rooms before pagination and count, preserving legacy rooms
ok 35 - WeChat JS-only loader registers pages/home/index
ok 36 - WeChat JS-only loader registers pages/life/index
ok 37 - WeChat JS-only loader registers pages/unlock/index
ok 38 - WeChat JS-only loader registers pages/messages/index
ok 39 - WeChat JS-only loader registers pages/profile/index
ok 40 - WeChat JS-only loader registers pages/rental/index
ok 41 - WeChat JS-only loader registers pages/property/index
ok 42 - WeChat JS-only loader registers pages/chat/index
ok 43 - WeChat JS-only loader registers pages/vr/index
ok 44 - WeChat JS-only loader registers app and custom tab bar
ok 45 - Node-compatible JSON import reproduces the reported WeChat incompatibility
ok 46 - rejects the reported wx:else/wx:for combination
ok 47 - accepts separate conditional and loop blocks for record rendering
ok 48 - rejects the reported entity-escaped filter expression
ok 49 - accepts literal operators inside bindings and entities in ordinary text
ok 50 - rejects orphaned branches and malformed binding syntax
ok 51 - else branches cannot cross loop scope
```

**后台 `npm --prefix admin-web test`（82 项）**

```
ok 1 - floor fill supports exclusion and custom naming
ok 2 - room numbering uses floor, padded serial, prefix and complete exclusions
ok 3 - invalid ranges, missing floors, excessive counts and width overflow are rejected
ok 4 - floor auto-fill is idempotent and preserves existing floor names
ok 5 - multi-floor room fill creates and retries without overwriting records
ok 6 - concurrent auto-fill cannot duplicate rooms and invalid layout leaves all floors unchanged
ok 7 - 1000-room generation uses bounded transactions and supports full replay
ok 8 - lost batch response retains saved rooms and replay fills only missing rooms
ok 9 - 1001 rooms and invalid batch offsets fail before writing
ok 10 - batch runner rejects non-advancing server responses
ok 11 - whole building layout assignment processes 1000 unique rooms in bounded requests
ok 12 - failed layout batch stops further requests and reports confirmed progress; replay uses same IDs
ok 13 - invalid selection and inconsistent responses are rejected
ok 14 - bootstrap is idempotent, creates guard and admin memberships, never from request-shaped input
ok 15 - organizationsFor exposes only own memberships; requireMembership does not leak other orgs
ok 16 - layout code uniqueness is org+building scoped and claim-based; other orgs may reuse
ok 17 - room creation writes claim and slot consistently; concurrency cannot duplicate room numbers
ok 18 - listCatalog filters by organization before cursor pagination
ok 19 - legacy records without orgId stay invisible to the v2 surface
ok 20 - archiving a layout releases its code claim and blocks dependent creation
ok 21 - archive is blocked by active rooms, listings and bound legacy users, with counts only
ok 22 - house archive keeps the room link and does not release the listing placeholder
ok 23 - batchLayout checks expectedRevisions, rejects archived rooms and syncs listings
ok 24 - batchLayout requires expectedRevisions and rejects cross-organization listing links
ok 25 - idempotent operations replay results and reject same-key different-body retries
ok 26 - createProperty keeps new/existing modes with org-scoped name claims
ok 27 - F02 barrier: a creation landing between archive scan and commit forces a rescan that blocks
ok 28 - R2-01 barrier: a stale catalog snapshot plus a creation after the epoch read cannot slip an archive through
ok 29 - R2-01 barrier: a creation after the completed scan but before the commit is caught by the epoch comparison
ok 30 - R2-01: the guard epoch is read alone and before every collection scan
ok 31 - F03 barrier: archiving the layout between pre-read and commit rejects room creation
ok 32 - expired idempotency keys are rejected instead of replayed or re-executed
ok 33 - membership revoked after pre-check is caught inside the write transaction
ok 34 - layout code uniqueness is scoped to building, and names remain separate
ok 35 - catalog rejects mismatched hierarchy and invalid room counts
ok 36 - batch creation preserves room numbers and rolls back all rooms on duplicate
ok 37 - concurrent batches cannot create duplicate room numbers
ok 38 - batch layout synchronizes linked listings without changing price, area, status or bindings
ok 39 - cross-building selection is rejected atomically
ok 40 - legacy rooms can be explicitly archived without changing houseId or occupants
ok 41 - old local data gains empty catalog without destructive migration
ok 42 - listing ownership cannot be reassigned or duplicate-created
ok 43 - cloud multi-record batch reads before writes and rolls back on log failure
ok 44 - combined property creation saves a new community and building together
ok 45 - combined creation rejects duplicate or invalid input without orphan communities
ok 46 - concurrent combined creation cannot duplicate the same property
ok 47 - public layout propagates to rooms and linked rentals and can be reverted
ok 48 - v2 responses use the envelope and never leak other organizations
ok 49 - v2 writes require Idempotency-Key and replay identical retries
ok 50 - full org-scoped flow: create hierarchy, list with filters, archive with blockers
ok 51 - granted non-admin membership can read but not write
ok 52 - v2 cursor pagination is stable and org-filtered over HTTP
ok 53 - F01: legacy endpoints never expose or mutate org-scoped records
ok 54 - F04: archived listings cannot be re-published through the legacy endpoint
ok 55 - R2-02: vr-download never serves org-scoped records; legacy records still download
ok 56 - anonymous clients cannot read protected data
ok 57 - origin and CSRF are checked before mutations
ok 58 - viewer cannot write or upload; editor cannot bind or manage accounts
ok 59 - house creation, filtering, publishing, auditing and persistence
ok 60 - invalid fields, image schemes and missing records fail without writes
ok 61 - pagination is bounded and search does not interpret regex
ok 62 - content saves description compatible with miniprogram and draft status
ok 63 - room ID cannot change and duplicate IDs are rejected
ok 64 - binding validates room and maintains explicit binding override, without role editing
ok 65 - image upload rejects SVG and accepts PNG with persistent local URL
ok 66 - VR project attachments persist and download as attachments, with role and CSRF protection
ok 67 - account permissions change revokes sessions and never exposes hashes
ok 68 - logout invalidates the session cookie
ok 69 - cloud mode fails closed instead of silently using demo storage
ok 70 - cloud store writes business record and audit within the same transaction
ok 71 - static responses include CSP and do not serve data or secrets
ok 72 - concurrent room creation cannot create duplicate property identifiers
ok 73 - password changes require old password and revoke previous sessions
ok 74 - repeated invalid login requests are throttled
ok 75 - property HTTP endpoints enforce admin writes and listing snapshots come from the room
ok 76 - Windows: homepage and assets resolve inside public
ok 77 - Windows: traversal cannot escape public
ok 78 - Linux: homepage and assets resolve inside public
ok 79 - Linux: traversal cannot escape public
ok 80 - Windows: backslash, drive and UNC escapes are rejected
ok 81 - invalid encodings and null bytes return an explicit bad request
ok 82 - VR links require HTTPS and archive metadata rejects oversized or unsafe values
```
