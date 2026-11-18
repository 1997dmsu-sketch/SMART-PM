# HK-AI-07B 离线集成门禁证据（2026-11-18）

- 执行日期：2026-11-18（Asia/Shanghai）。
- 任务卡：`docs/tasks/HK-AI-07B-OFFLINE-INTEGRATION-GATE-TASK-DRAFT-2026-11-18.md`（草案 r3，提交 `cc4ec7b`）。
- 分支：`feat/hk-face-07b-offline-gate`；工作树 `C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\07b-gate-execution`。
- 本文件为本轮唯一新增；未改生产代码、脚本、manifest、lock、来源登记或已验收测试。

## 0. 结论

| IG | 结论 | 关键证据 |
|---|---|---|
| IG01 | PASS | 输入/父链/origin ref 一致；Node/npm/OS/autocrlf/EOL 已记录；期望计数 61/24/318/3 |
| IG02 | PASS | main=`282a20f`；129 提交 / 91 文件 / +30020 −512；merge-tree 干净（tree `e76753b`，exit 0） |
| IG03 | PASS | verify-import exit 0，输出 61/24/318；guard 全进程网络调用 0；blob 复算 61/61 |
| IG04 | PASS | 24 个云函数安装 exit 0；admin-web `npm ci` exit 0（sharp 0.35.5、@cloudbase 3.18.7） |
| IG05 | PASS | 07B 20/20；H1 8/8（真实 sharp）；guard loadTime 与运行期网络计数全 0 |
| IG06 | PASS | 根目录 7 个测试共 51 项，全通过，exit 0 |
| IG07 | PASS | 未验证边界逐项列明（见 §10），未外推 |
| IG08 | PASS | 生产/manifest/lock/来源零 diff；仅新增本文件；提交与远端核对见交付回报 |

## 1. 输入与基线

| 项 | 值 | 核对命令 |
|---|---|---|
| 工作树 HEAD | `cc4ec7baf5ca4bcc52c3466b99b6b41b6374ff08` | `git rev-parse HEAD` |
| HEAD 父 | `ddad8539e72eeec1200e6b083af878a792891638` | `git rev-parse HEAD^` |
| 生产基线 | `8ff350d3f6ec41e67cc8d42639f8c37cf96323da` | `git rev-parse 8ff350d` |
| 基线父 | `59a737acf49e249a8e3388867ca605e90a47ca61` | 任务卡记录，未改动 |
| 参考 main | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` | `git rev-parse refs/remotes/origin/main` |
| 输入分支 | `docs/hk-face-07b-offline-integration-task` = `bd37712`，未前移 | `git ls-remote` |
| 修订分支 | `codex/07b-integration-task-revision` = `cc4ec7b`，未前移 | `git ls-remote` |
| 本轮分支 | `feat/hk-face-07b-offline-gate`（远端执行前不存在） | `git ls-remote` |

`git diff --stat 8ff350d..HEAD`：仅 `docs/tasks/HK-AI-07B-OFFLINE-INTEGRATION-GATE-TASK-DRAFT-2026-11-18.md`（+70），生产代码零差异。

## 2. 环境与行尾（P2/P4）

- OS：Windows（Git for Windows 2.55.0.windows.3）；Node `v24.19.0`；npm `11.17.0`。
- `core.autocrlf=true`（系统级）。检出后工作树为 CRLF，**不满足卡内 P2**；本轮以 `core.autocrlf=false` + `checkout-index -a -f` 重写为 LF，之后 `git status` 干净。
- EOL 汇总（`git ls-files --eol`，644 个跟踪文件）：`w/lf=252`、`w/crlf=1`、二进制/无行尾 391。
  - 唯一 `w/crlf`：`admin-web/lib/property.mjs`，其索引为 `i/crlf`（仓库既有 CRLF blob，不在 61 项来源清单，未修改）。
  - 61 个来源文件全部为 `w/lf`（verify-import 在 LF 工作树 61/61 通过）。
- 期望计数：`docs/backend-provenance.json` 61 文件、`docs/backend-changes.json` 3 条（phoneLogin / getHouses / contentList）、`design/asset-manifest.json` 318 项、`cloudfunctions/` 24 个函数。

## 3. IG01 输入/环境

- 完整 SHA、父链与 origin ref 已核对（见 §1）。
- 工作树初始状态：`git status --porcelain` 为空；`git add -A` 后仍为空（内容级零差异）。
- 依赖目录与锁清单：24 个云函数中 3 个有 lock（`addTuyaDevice`、`dbInit`、`unlock`），21 个无 lock；`admin-web/package-lock.json` 存在；仓库根无 lock。
- 期望计数核对通过（61/24/318/3）。

## 4. IG02 差异与可合并性

- 差异对象：`refs/remotes/origin/main`（`282a20f`，执行前已 fetch）… `8ff350d`。
- 规模：**129 提交 / 91 文件 / +30020 −512**。
- 按顶层目录分类：`admin-web` 70、`docs` 18、`scripts` 1、`cloudfunctions` 1（`contentList/index.js`）、`CHANGELOG.md` 1。
- merge-base：`282a20f`（main 即分叉基点）。
- `git merge-tree --write-tree --name-only origin/main 8ff350d`：exit 0，tree `e76753b12e7e5666075d7dda4e4eb5a0aa67c711`，**无冲突输出**。
- 继承改动命中 3 条 changes（含 contentList）；未做任何 merge/cherry-pick，不以无冲突代替批准。
- 说明：以上为清单级与语义/冲突分析，未做 91 文件逐行代码评审（卡内边界）。

## 5. IG03 verify-import 与来源哈希

### 5.1 完整运行（LF 工作树，guard 下）

```text
NODE_OPTIONS="--require %TEMP%\07b-guard\r3\guard.cjs"
GUARD_REPORT=%TEMP%\07b-guard\verify
node scripts/verify-import.mjs
```

- exit code：**0**
- 完整输出：

```text
Verified 61 backend files against original provenance plus documented patches, syntax and dependency loading for 24 functions, and 318 assets.
These checks do not invoke cloud functions or validate live WeChat services.
```

- guard 报告：25 个进程（1 主进程 + 24 个 `node --check` 子进程）全部写报告，网络调用合计 **0**。

### 5.2 blob 级复算（与 verify-import 分开）

```text
git cat-file --batch < 61 个 provenance 路径
→ blob_checked=61 of 61 mismatches=0
```

- 61 个提交 blob 的 sha256 与 `docs/backend-provenance.json` / `docs/backend-changes.json` 完全一致；工作树 LF 字节亦一致（verify-import 通过）。
- 结论：来源校验严格口径通过，未放宽。

## 6. IG04 依赖安装

规则（与 README 45–47、`scripts/install-backend.mjs` 13–15 一致）：

- `dbInit`、`unlock`：`npm ci`；
- 其余 21 个无 lock 函数与 `addTuyaDevice`（lock 缺 `node-fetch`）：`npm install --package-lock=false`。

执行（Windows 下按其规则用 `npm.cmd` 逐目录，未使用 `install-backend.mjs` 的 `spawn('npm')`）：

```text
npm.cmd ci|install --no-audit --no-fund --fetch-retries=5 --fetch-timeout=600000 --prefix cloudfunctions/<name>
```

- 24/24 函数 **exit 0**，`FAILED` 0 次；安装日志 `24` 行 exit=0。
- `admin-web`：`npm ci` **exit 0**（npmjs registry；`--maxsockets=2` 重试成功；`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`，浏览器二进制不在本门禁范围，未下载）。
- `npm ls --depth=0`：admin-web exit 0（`@cloudbase/node-sdk@3.18.7`、`playwright@1.62.1`、`sharp@0.35.5`）；`cloudfunctions/contentList` exit 0（`wx-server-sdk@3.0.4`）。
- 解析版本：24 个函数 `wx-server-sdk@3.0.4`；5 个函数 `node-fetch@2.7.0`（addTuyaDevice / getLockKey / listLocks / meterService / unlock）。
- 未生成/未提交新 lock；manifest/lock 零 diff。
- registry 网络与业务网络区分：安装期仅 npm registry；测试/verifier 期 guard 全禁，见 §9。

## 7. IG05 07B 定向与 H1 回归

命令（仓库根，guard 下）：

```text
NODE_OPTIONS="--require ...\guard.cjs" node --test admin-web/tests/face-service.test.mjs
NODE_OPTIONS="--require ...\guard.cjs" node --test admin-web/tests/face-service-h1-regression.test.mjs
```

| 目标 | tests | pass | fail | exit | guard 报告 | 网络调用 |
|---|---|---|---|---|---|---|
| `face-service.test.mjs`（07B） | 20 | 20 | 0 | 0 | 2 | 0 |
| `face-service-h1-regression.test.mjs`（H1） | 8 | 8 | 0 | 0 | 2 | 0 |

- 07B 自检诊断（实测）：`guardLoadTime={"fetch":0,"httpRequest":0,"httpGet":0,"httpsRequest":0,"httpsGet":0}`；`networkCounters` 同为全 0；篡改探针 `tamperAttempts>=4, tamperSuccesses=0`。
- H1 真实加载 sharp（`face-service-h1-regression.test.mjs:8` → `files.mjs:65-69` → `face-image.mjs:15`，使用点 `face-image.mjs:102`），未 stub、未跳过。
- sharp 正控：`sharp@0.35.5` 真实生成并 JPEG 解码成功（267 bytes），guard 计数不变。

## 8. IG06 根目录无监听测试

逐个执行（guard 下，禁止全量 `npm test`）：

| 文件 | tests | pass | fail | exit | guard 网络 |
|---|---|---|---|---|---|
| `tests/cloud-bootstrap.test.cjs` | 2 | 2 | 0 | 0 | 0 |
| `tests/frontend.test.cjs` | 16 | 16 | 0 | 0 | 0 |
| `tests/layout.test.cjs` | 7 | 7 | 0 | 0 | 0 |
| `tests/phone-login.test.cjs` | 8 | 8 | 0 | 0 | 0 |
| `tests/public-houses.test.cjs` | 1 | 1 | 0 | 0 | 0 |
| `tests/wechat-modules.test.cjs` | 11 | 11 | 0 | 0 | 0 |
| `tests/wxml.test.cjs` | 6 | 6 | 0 | 0 | 0 |
| **合计** | **51** | **51** | **0** | 0 | 0 |

- 7 个文件均无 `listen`/`createServer`；未启动任何 HTTP 监听。

## 9. guard 证据

- 实现：工作树外 `%TEMP%\07b-guard\r3\guard.cjs`，经 `NODE_OPTIONS=--require` 预加载；`sha256=4c84a87d83a4151e06e9b974a297eabd45a83ed073b125e66941d516376ae2d3`。
- 对照脚本：`%TEMP%\07b-guard\r3\controls.cjs`，`sha256=7203bdccf2db5583c7ae5c6302f5c91a62c94f8c0a6f63023194d858134b3922`。
- 入口：**79 个** = G3 已验收 49（11 + 14 + 7 + 17）+ Resolver 30（`dns.Resolver` 15 + `dns.promises.Resolver` 15）。
  - 49：`net.createServer`、`http.Server.prototype.listen`、`https.Server.prototype.listen`、`http.request`、`http.get`、`https.request`、`https.get`、`globalThis.fetch`、`dns.lookup`、`net.connect`、`net.createConnection`；`dns.resolve/resolve4/resolve6/resolveAny/resolveCaa/resolveCname/resolveMx/resolveNaptr/resolveNs/resolvePtr/resolveSoa/resolveSrv/resolveTlsa/resolveTxt`；`net.Server.prototype.listen`、`net.Socket.prototype.connect`、`tls.connect`、`dgram.createSocket`、`dgram.Socket.prototype.send/bind/connect`；`dns.promises.lookup/lookupService/resolve/resolve4/resolve6/resolveAny/resolveCaa/resolveCname/resolveMx/resolveNaptr/resolveNs/resolvePtr/resolveSoa/resolveSrv/resolveTlsa/resolveTxt/reverse`。
  - Resolver 30：`dns.Resolver.prototype.{cancel,resolve,resolve4,…,resolveTxt}` 与 `dns.promises.Resolver.prototype.{cancel,resolve,resolve4,…,resolveTxt}`。
- 负控：79/79 入口各调用一次，全部抛出 `NETWORK_BLOCKED` 且计数 +1；`failed=0`、`missing=0`。
- 正控（全部通过，且网络计数增量 0）：`wx-server-sdk` 加载成功；`sharp` 真实加载并解码成功；`spawnSync` 管道输出 `pipe-ok`；`fs` 读取与 `crypto` 正常。
- ESM 命名绑定：打补丁后 `syncBuiltinESMExports()`；ESM 探针 `import { connect } from "node:net"` 调用被拦截（`blocked=true, code=NETWORK_BLOCKED`）。
- 子进程继承：CJS 与 ESM 探针子进程均 `inherited=true`、`entries=79`、`net.connect` 计数 1、`matchesParentEntries=true`。
- 全部门禁运行的 guard 报告合计 43 个进程，网络调用 **0**。

## 10. IG07 未验证与边界

以下**未验证**，不得外推：

- HTTP/UI：未注册路由、未启动 HTTP、未跑任何 HTTP/UI 测试。
- Provider / 设备 / 真实支付：未调用。
- 生产云 / 真实数据库 / 真机：未接触。
- 组织停用：`queryJob` 仅校验成员 active，不校验 `org.status`；仍需未来 HTTP 接线门禁。
- G5/G6 边界与部署上线：未开始。
- 本轮仅**建议申请**下一步集成；建议不等于批准合并。

## 11. IG08 范围与交付

- `git diff --stat 8ff350d..HEAD -- cloudfunctions admin-web scripts tests docs/backend-provenance.json docs/backend-changes.json design package.json`：空（生产/manifest/lock/来源零 diff）。
- 本轮仅新增本证据文件；`node_modules` 已忽略；未遗留新 lock、guard 或临时文件。
- 敏感扫描：本文档不含手机号、openid、密钥、云端凭据；全部为合成 fixture 与命令输出。
- 证据追加提交后普通 push 到 `feat/hk-face-07b-offline-gate`，并以 `git ls-remote` 核对远端 SHA 与本地一致（结果见调度回报）。

## 12. 命令与退出码汇总

| # | 命令（工作树根，除注明外） | exit | 关键计数 |
|---|---|---|---|
| 1 | `node scripts/verify-import.mjs`（guard） | 0 | 61 / 24 / 318 |
| 2 | `git cat-file --batch`（61 路径） | 0 | 61/61，0 不符 |
| 3 | 24 × `npm ci|install`（cloudfunctions） | 0 | 24/24 |
| 4 | `npm ci`（admin-web） | 0 | sharp 0.35.5 |
| 5 | `npm ls --depth=0`（admin-web / contentList） | 0 / 0 | 树有效 |
| 6 | `node --test admin-web/tests/face-service.test.mjs`（guard） | 0 | 20/20 |
| 7 | `node --test admin-web/tests/face-service-h1-regression.test.mjs`（guard） | 0 | 8/8 |
| 8 | 7 × `node --test tests/<name>.test.cjs`（guard） | 0 | 51/51 |
| 9 | `node controls.cjs`（guard） | 0 | 79/79 负控 |
| 10 | `git merge-tree --write-tree --name-only origin/main 8ff350d` | 0 | 无冲突 |

## 13. 已知观察与待裁

- 观察（非缺陷、未修）：`admin-web/lib/property.mjs` 为仓库既有 CRLF blob（`i/crlf`），不在来源清单，未修改；不影响本轮门禁。
- 环境说明：Windows 上按 `install-backend.mjs` 的同一规则以 `npm.cmd` 逐目录安装；`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`（UI 冻结，浏览器二进制不在范围）。
- 未取得云端完整复审报告正文（`/workspace/artifacts/DEL-AI-01-CONTENT-REVIEW-2026-11-18/REVIEW.md` 在本机不可达），本轮按卡 r3 与调度指令执行，未据其声明逐项关闭。
- 若需复跑：按 §12 命令、同一 guard 与 `core.autocrlf=false` 工作树执行即可。
