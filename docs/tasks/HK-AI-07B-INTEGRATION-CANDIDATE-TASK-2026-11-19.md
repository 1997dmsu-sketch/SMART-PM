# HK-AI-07B 集成候选任务卡（只读调查 · 2026-11-19）

- 日期：2026-11-19（Asia/Shanghai）。任务：独立任务 D，只读调查 + 新增本卡；**不授权执行、不授权集成、不授权合并**。main 与 07B 的合并、实现维持冻结。
- 修订 r2（2026-11-19）：按独立复审意见只修**依赖安装 / guard 自检 / 测试顺序**三处执行口径；§0.4 与 C3 的已复现无冲突预演事实（tree `0ced1e1…`）**保留不变**。本次仍为**文档修订，不是执行**：未安装依赖、未跑测试、未跑 verifier/guard、未做集成。
- 修订 r3（2026-11-19）：仅两处**非阻塞更正**，不扩大已批准候选范围、不改变执行步骤。① §2 父链 `cf7c75e` 的完整 SHA 由 `cf7c75efcdbb719caa4d77cc149679248b0a218`（39 位，`git cat-file` 判为无效对象名）更正为 `cf7c75efcdbb719caa47d77cc149679248b0a218`（40 位，`git rev-parse cf7c75e`）；② 与 HEAD/时点相关的提交统计与表述更正：§0.3 的 `origin/main..HEAD = 134`、§1 的 `git rev-parse HEAD`/`HEAD^`、§2 的“当前 HEAD”均改为按候选 tip `1be517e` 的固定表述；§13 旧值“135 提交 / 95 文件 / +30618 −512”只在 `597d2f7` 时点成立，按固定输入 `7de358b` 复算更正为“137 提交 / 95 文件 / +30637 −512”（`git rev-list --count`、`git diff --shortstat`）。另**注明**（不改 tree 值）：§0.4 的预演取证对象为 `origin/main 1be517e`，记录时 HEAD 即该输入；`7de358b` 的 tree 为 `132ac59bba3a8e297dc3e281fdca41ee31b1e33c`，差异仅来自后续文档提交。评审基线 `7de358b`（父 `dfc2143`）。
- 本卡是“候选卡”，不是执行卡：给出候选分支起点、拟纳入提交、逐文件非监听回归、guard、来源校验与验收停止点；执行须由调度方另发明确派单。
- 固定输入（门禁）：`1be517e48cadd810caa4f44df9e38e14c8b2c764`（**固定，不替换**）。
- 历史参考 main：`282a20fca9f64ab80ead50372c9c3e90bf4aeba7`。
- 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\07b-candidate-task`；分支 `docs/hk-face-07b-integration-candidate-task`。
- 本卡未安装任何依赖、未运行任何测试、未运行 `verify-import`、未运行 guard、未创建/合并/变基任何提交。文中所有通过类计数均为**引用前序证据**，本次未复验（见同名证据缺口文档）。
- 不重验 G1/G2/G3/O10/G4 与 07B 离线门禁；不接触 HTTP/UI、Provider、设备、支付、生产云、部署或上线。

## 0. 结论（候选性判断，不是批准）

1. **输入未前移**：fetch 后 `origin/main` = `282a20f`（= 历史值，前移 0 提交）；`refs/heads/feat/hk-face-07b-offline-gate` = `1be517e`（= 输入）；`refs/heads/docs/hk-face-07b-offline-integration-task` = `bd37712`；`refs/heads/codex/07b-integration-task-revision` = `cc4ec7b`。候选分支 `refs/heads/docs/hk-face-07b-integration-candidate-task` 在 fetch 时点**远端不存在**，本地无 upstream。
2. **候选范围**：`origin/main..1be517e` = **134 提交 / 93 文件 / +30288 −512**；其中到生产基线 `8ff350d` 为 129 提交 / 91 文件 / +30020 −512（与 07B 离线门禁 IG02 记录一致），其后 5 个文档提交新增 2 文件 / +268。
3. **祖先关系**：`merge-base(origin/main, 1be517e) = 282a20f`，main 是候选范围 tip 的祖先；`1be517e..origin/main` = 0，`origin/main..1be517e` = 134。**不存在分叉。**候选范围之后仅追加本卡文档提交，不改变该范围。
4. **只读冲突预演**：`git merge-tree --write-tree --name-only origin/main 1be517e` **exit 0**，tree `0ced1e1723342c7cfcfe8e9f0b6a450fc6d825c2`，无冲突输出。此项只证明合并树可生成；**无冲突不等于批准，也不代替逐文件评审**。
5. **本工作树不能直接跑来源校验**：当前检出为 CRLF（`i/lf w/crlf` 253 个文件，`core.autocrlf=true`），而 `scripts/verify-import.mjs:18` 对**工作树字节**求 sha256；执行 IG03 必须另建 `core.autocrlf=false` 的 LF 工作树。
6. **组织停用未关闭**：`queryJob`（`admin-web/lib/face-service/service.mjs:798-802`）只经 `#membership`（同文件 `:154-166`）校验成员 `status === "active"`，**不校验 `org.status`**；该缺口属未来 HTTP 接线门禁前置，本卡不得宣称已修、也不得据此宣称可上线。
7. 本卡结论仅为“可提交条件与停止点”，不含“通过/恢复/可上线/可合并”的判断。

## 1. 固定输入与 fetch 记录

| 项 | 完整 SHA / 值 | 核对方式 |
|---|---|---|
| 输入（门禁） | `1be517e48cadd810caa4f44df9e38e14c8b2c764` | `git rev-parse 1be517e`（取证时 HEAD 即该提交） |
| 输入父提交 | `cc4ec7baf5ca4bcc52c3466b99b6b41b6374ff08` | `git rev-parse 1be517e^` |
| 生产基线 | `8ff350d3f6ec41e67cc8d42639f8c37cf96323da` | `git rev-parse 8ff350d` |
| 历史 main | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` | 任务输入 |
| fetch 后 `origin/main` | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` | `git fetch origin main` + `git rev-parse origin/main` |
| `refs/heads/feat/hk-face-07b-offline-gate` | `1be517e48cadd810caa4f44df9e38e14c8b2c764` | `git ls-remote origin` |
| `refs/heads/docs/hk-face-07b-offline-integration-task` | `bd3771283e81c98c6e097e0c5711c0da76017bb2` | `git ls-remote origin` |
| `refs/heads/codex/07b-integration-task-revision` | `cc4ec7baf5ca4bcc52c3466b99b6b41b6374ff08` | `git ls-remote origin` |
| 候选分支远端 | 不存在（fetch 时点） | `git ls-remote origin refs/heads/docs/hk-face-07b-integration-candidate-task`（空） |
| 候选分支 upstream | 未配置 | `git config --get-regexp '^branch\.docs/hk-face-07b-integration-candidate-task\.'`（exit 1） |

**前移差异记录**：`origin/main` 本次 fetch 未前移（0 提交，SHA 与历史 main 完全相同）。因此“main 前移后旧证据需重跑”的矩阵（§9）当前**未触发**；一旦 main 变化，一律按 §9 重跑，不沿用任何旧结论。

## 2. 候选分支起点

- 起点提交：`1be517e48cadd810caa4f44df9e38e14c8b2c764`（候选 tip，即输入门禁提交；本卡文档提交只追加在其后，不改变候选范围）。
- 工作树初始状态：`git status --porcelain --untracked-files=all` 为空；无 `node_modules`（admin-web 与 24 个云函数均未安装）；`git status --ignored` 为 0 条。
- 环境（记录用，非门禁结论）：Windows；`git 2.55.0.windows.3`；`node v24.19.0`；`npm 11.17.0`；`core.autocrlf=true`；`git ls-files --eol` 汇总 `i/lf w/crlf` 253、`i/crlf w/crlf` 1、`-text` 391。

父链（tip → main，完整 SHA）：

```text
1be517e48cadd810caa4f44df9e38e14c8b2c764  docs(face): add 07B offline integration gate evidence (IG01-IG08)
cc4ec7baf5ca4bcc52c3466b99b6b41b6374ff08  docs(face): correct H1/sharp dependency chain and expand 07B guard seams (r3)
ddad8539e72eeec1200e6b083af878a792891638  docs(face): make 07B gate card execution-start wording revision-stable
aad1223a64b45de5c47a5ff9fc7b8aed52d9803d  docs(face): revise 07B offline integration gate card (review F1-F8)
bd3771283e81c98c6e097e0c5711c0da76017bb2  docs(face): draft 07B offline integration gate task card
8ff350d3f6ec41e67cc8d42639f8c37cf96323da  docs(backend): register inherited contentList provenance change
59a737acf49e249a8e3388867ca605e90a47ca61  test(face): assert zero load-time network counters before guard reset
6e9e10b5fce702a2f126e3107bb51dc8eb29978a  test(face): add HK-AI-07B tamper and network-guard evidence
cf7c75efcdbb719caa47d77cc149679248b0a218  fix(face): keep queryJob failureReason whitelist private and read-only
f5844715a4c0f2cb6429bb77c8220b9b46d50fb3  fix(face): fail closed on unapproved queryJob failureReason
bc2a8b29441f7c8fdf1250b4c6905526d37b9c2f  feat(face): add HK-AI-07B queryJob revision read model
1155b7ba65991d324fb8b22bb8f7dd87f49428f9  fix(face): close final H4-b cleanup gaps
…（省略中间 121 条：`a82fe6e..1155b7b^`，即 §3 切片 1–11；可用 `git rev-list --reverse origin/main..1be517e` 完整重放）
a82fe6e442a814fb9880d3b21c63c95be2a1a87e  docs: DB-01 current state, data model, API and migration design
282a20fca9f64ab80ead50372c9c3e90bf4aeba7  （历史 main；`a82fe6e^`）
```

## 3. 拟纳入提交（候选范围与分类）

候选单位为整段祖先链 `origin/main..1be517e`，共 134 提交。按提交顺序切片的落点如下（区间均含两端，计数已核对合计 134）：

| # | 切片（完整 SHA 起..止） | 提交数 | 内容 |
|---|---|---|---|
| 1 | `a82fe6e442a814fb9880d3b21c63c95be2a1a87e..b0bd26a7e507ef6610d97112108679d5937cbaec` | 33 | DB-01…DB-07、DB-05 基线整合（唯一 merge 提交 `b0bd26a`，含冲突解决） |
| 2 | `fea808b10b0b6bad187c8e92df9cc05f60ba527e` | 1 | HK-AI-03 集成阶段报告 |
| 3 | `7e9cf3dc504a8b90fd49a21450cb7d8ec6378917..c7516e60fa719810a361ceb6fccab9367b5a1989` | 9 | face 用途/权限点、sharp 解码、HTTP 拦截与资源边界 |
| 4 | `ff14fca15887598cdc13b3ac70728696dffab3f2` | 1 | 已终审 Mock 骨架纳入 |
| 5 | `70be08a0894bbfd19a57a551a7be426830fa66ce..6bfe1ba152dba8ba48da9270620f4a43577383dc` | 25 | 集合/凭证服务/K1 域摘要/H1 冻结与返工 |
| 6 | `7b7ee6dacae30fd261c60614ab830c6e6c0e68a6..2bc10e3a6b734c919fc33483444c3b407d870173` | 20 | H2 createGrant、H2-a 操作域、H2-b owner claim |
| 7 | `0565ff3958dcd8b840ff05cd338662901d6b8cb9..90cc8486a19d408be0e3c501d9f5ec61ba13e929` | 14 | H2-c 资格接线、H2-d 全链验收与稳定性 |
| 8 | `94b1bd4bd8080dad8f67bedefc62611367b4cdda..2b92b30ef985a1606ff8b1ab0cc3becbbd2a759f` | 8 | H3 设计、H3-a 内嵌快照、H3-b mock dispatch |
| 9 | `ec8be46e95866371a20f873d8ffb697b6cb5e90a..ff3c4921f8baf8a3c1d60d94a19c076e590e8074` | 4 | store 确定性审计、claim 释放 guard |
| 10 | `9cb4bed6eb9362ab972591ae790ed78bfabefbcc..685ac3a9a4cb7241ef89c02521098d1bc9756fb5` | 5 | H4-a 即时撤权 |
| 11 | `f0ad594f716a2c44a9ab67f9837bc22a89b55d4a..1155b7ba65991d324fb8b22bb8f7dd87f49428f9` | 3 | H4-b mock 清理收口 |
| 12 | `bc2a8b29441f7c8fdf1250b4c6905526d37b9c2f..59a737acf49e249a8e3388867ca605e90a47ca61` | 5 | HK-AI-07B 读模型与失败关闭、篡改/网络 guard 证据 |
| 13 | `8ff350d3f6ec41e67cc8d42639f8c37cf96323da` | 1 | 来源登记：`docs/backend-changes.json` 增补 contentList（+5 行） |
| 14 | `bd3771283e81c98c6e097e0c5711c0da76017bb2..1be517e48cadd810caa4f44df9e38e14c8b2c764` | 5 | 07B 离线门禁任务卡 r1–r3 与证据（+268 行） |

07B 生产提交明细（切片 12）：

| 提交 | 变更文件 | 规模 |
|---|---|---|
| `bc2a8b2` feat(face): queryJob revision read model | `service.mjs`、`face-service.test.mjs`、`face-service-h1-regression.test.mjs` | +424 −3 |
| `f584471` fix(face): fail closed on unapproved failureReason | `service.mjs`、`face-service.test.mjs` | +49 −13 |
| `cf7c75e` fix(face): whitelist private and read-only | `service.mjs`、`face-service.test.mjs` | +191 −32 |
| `6e9e10b` test(face): tamper and network-guard evidence | `face-service.test.mjs` | +392 −30 |
| `59a737a` test(face): zero load-time counters | `face-service.test.mjs` | +18 −2 |

**不可孤立性（本卡结论）**：`queryJob` 读模型位于 `admin-web/lib/face-service/service.mjs`，该文件同时承载 H1–H4 的服务层与集合校验，并通过 `face-service.test.mjs` 导入服务层、`face-service-h1-regression.test.mjs:8` → `admin-web/lib/files.mjs:65-69` → `admin-web/lib/face-image.mjs:15` 加载 `sharp`。因此**不能把切片 12 单独切出并声称与整链等价**；若调度方要求更窄的集成单位，须另立卡并用差异/依赖证据另行证明，本卡不给出该结论。

## 4. 生产变化（清单级，非逐行评审）

`git diff --numstat origin/main..1be517e` 按区聚合（合计 93 文件 / +30288 −512）：

| 区域 | 文件 | + | − |
|---|---|---|---|
| `admin-web/lib/face-service/` | 13 | 4118 | 0 |
| `admin-web/lib/`（其余新增/修改） | 15 | 6198 | 488 |
| `admin-web/tests/` | 36 | 15134 | 0 |
| `admin-web/server.mjs` | 1 | 811 | 17 |
| `admin-web/scripts/` | 2 | 125 | 0 |
| `admin-web/package*.json` | 2 | 632 | 6 |
| `cloudfunctions/contentList/index.js` | 1 | 155 | 1 |
| `scripts/file-inventory.mjs` | 1 | 365 | 0 |
| `docs/` | 20 | 2726 | 0 |
| `CHANGELOG.md` / `admin-web/config.example` | 1 / 1 | 6 / 18 | 0 / 0 |

- 生产面（非 docs）改动集中在 admin-web 服务层与回归测试；云函数侧唯一生产改动为 `cloudfunctions/contentList/index.js`（对应来源登记变更）。
- `admin-web/lib/property.mjs` 为既有文件的改写（+474 −467），不在来源清单；集成时按清单级确认，不做逐行评审（卡内边界）。
- 本卡未对 93 个文件做逐行代码评审，也未做业务正确性判断。

## 5. 来源登记与依赖变化

| 项 | 值 | 证据 |
|---|---|---|
| 来源清单 | 61 个文件 | `docs/backend-provenance.json`（`files` 键计数） |
| 来源上游 | `https://github.com/1997dmsu-sketch/mini-shop` @ `main` @ `b4c9370b62548492a6dc167c6aba98890a5df91e` | 同文件头部字段 |
| 变更登记 | 3 条：`cloudfunctions/phoneLogin/index.js`、`getHouses/index.js`、`contentList/index.js` | `docs/backend-changes.json` |
| 资产清单 | 318 项 | `design/asset-manifest.json` |
| 云函数 | 24 个目录 | `cloudfunctions/` |
| verifier 输出口径 | `Verified 61 backend files … 24 functions, and 318 assets.` | `scripts/verify-import.mjs:35` |
| verifier 哈希对象 | **工作树字节**（`readFileSync(file)`），非 git blob | `scripts/verify-import.mjs:16-19` |
| 本卡所在检出 | CRLF：253 个 `i/lf w/crlf` | `git ls-files --eol` |

依赖变化（相对 main）：

- `admin-web/package.json`：`0.2.0-beta.6` → `0.6.0-beta.1`；新增 `sharp: 0.35.5`（`admin-web/package.json:19`）；`@cloudbase/node-sdk` 保持 `3.18.7`。
- `admin-web/package-lock.json`：+627 −3（lockfileVersion 与 sharp 依赖树随之变化；`sharp` 解析版本 `0.35.5` 见 lock 内 `"version": "0.35.5"`）。
- 仓库根 `package.json`、`project.config.json`：零 diff；24 个云函数 `package.json`/lock 零 diff（仅 `contentList/index.js` 变）。
- 依赖安装/解析版本为前序证据引用：`wx-server-sdk@3.0.4`、`node-fetch@2.7.0`（5 个函数）、`sharp@0.35.5`、`@cloudbase/node-sdk@3.18.7`；本轮**未安装、未复验**。

## 6. 逐文件非监听回归（执行时逐文件运行）

**集合定义**：仓库根 `tests/` 下 7 个文件均无 `listen`/`createServer`（本次静态核对，未运行）；执行时必须**逐文件**单独运行，禁止后台全量 `npm test`。

| 文件 | 前序证据计数（未复验） | 备注 |
|---|---|---|
| `tests/cloud-bootstrap.test.cjs` | 2/2 | 静态 `test(` 计数 2，仅供参考 |
| `tests/frontend.test.cjs` | 16/16 | — |
| `tests/layout.test.cjs` | 7/7 | 静态 `test(` 仅 3，含循环生成，**静态计数不能替代执行计数** |
| `tests/phone-login.test.cjs` | 8/8 | — |
| `tests/public-houses.test.cjs` | 1/1 | — |
| `tests/wechat-modules.test.cjs` | 11/11 | 静态 `test(` 仅 3，同上 |
| `tests/wxml.test.cjs` | 6/6 | — |
| 合计 | 51/51（前序证据 IG06） | 本轮未运行 |

**明确排除（监听类，不属本集合）**：以下 admin-web 测试文件含真实 `listen`，**不得**计入“非监听回归”，也不得在未获 HTTP/UI 授权时启动：

| 文件 | `listen` 行 |
|---|---|
| `admin-web/tests/blacklist-http.test.mjs` | 30 |
| `admin-web/tests/occupancy-http.test.mjs` | 39 |
| `admin-web/tests/server.test.mjs` | 43 |
| `admin-web/tests/server-face.test.mjs` | 100 |
| `admin-web/tests/server-face-bounds.test.mjs` | 51 |
| `admin-web/tests/server-files.test.mjs` | 62、309 |
| `admin-web/tests/server-v2.test.mjs` | 41 |
| `admin-web/tests/verification-http.test.mjs` | 29 |

另：07B 定向 `admin-web/tests/face-service.test.mjs`（静态 `test(` = 20）与 H1 `admin-web/tests/face-service-h1-regression.test.mjs`（静态 = 8）属服务层非监听回归，必须逐文件运行；前序证据称 20/20 与 8/8，本轮未复验。

## 7. 执行顺序：安装、guard 自检、正控、运行期禁网（r2 修订）

**原则**：registry 访问只允许发生在**安装阶段**；运行期（`verify-import` 与全部测试）必须**零网络**。两阶段不得混跑：安装阶段不预加载 guard（否则 npm 访问 registry 会被拦截），运行阶段必须预加载 guard 且网络计数为 0。P0–P5 为强制顺序，**顺序倒置即该轮证据作废**。

| 阶段 | 做什么 | guard | 网络 | 通过条件 |
|---|---|---|---|---|
| P0 前置 | 记录 OS/Node/npm/`core.autocrlf`/`git ls-files --eol`；确认 **LF** 检出；记录 24 个云函数与 admin-web 的 manifest/lock 哈希，并确认相对固定输入 `1be517e` 零差异 | 未加载 | 不访问 | 非 LF → BLOCKED；manifest/lock 已有差异 → 停止 |
| P1 安装 | 按前序门禁卡第 3 节规则安装（`dbInit`/`unlock` 用 `npm ci`；`addTuyaDevice` 与 21 个无 lock 函数用 `npm install --package-lock=false`；admin-web 用 `npm ci`）；记录 registry URL、时间、代理、`npm_config_cache` 与每包解析版本 | **不加载**（`NODE_OPTIONS` 不得挂 guard） | **仅 npm registry** | 24/24 与 admin-web exit 0；无新生 lock；manifest/lock 零改动；`sharp@0.35.5` 真实安装 |
| P2 guard 构建与独立自检 | 在工作树外重建 `guard.cjs`/`controls.cjs`；跑 `controls.cjs`：逐入口负控、ESM 命名绑定、子进程继承；断言入口数 = **G3 49 + Resolver 30 = 79** | 仅 guard 自身 | 0 | 79/79 均抛 `NETWORK_BLOCKED`，`failed=0`、`missing=0`；入口计数断言失败即 BLOCKED |
| P3 安装后正控 | 在 guard 预加载下：`require("wx-server-sdk")`、`sharp` 真实生成+解码、`spawnSync` 管道、`fs`/`crypto`；记录网络计数增量 | 预加载 | 0 | 全部可用且网络增量 **0**；任一网络命中 → 停止 |
| P4 运行期校验 | **先** `verify-import`，**再** 07B/H1 定向，**再** 7 个非监听文件逐个；每个测试文件独立进程、独立 guard 报告；对 `node --check` 子进程与 `node --test` worker 做继承探针 | 预加载 | 0 | 见 C8–C11 |
| P5 收尾 | blob 复算、manifest/lock/来源零 diff、`git status`、敏感扫描 | — | 0 | 见 C9/C12 |

**顺序要点（本次修订核心）**：

1. **安装先于 verify-import**：`scripts/verify-import.mjs:25-29` 会对 24 个函数的依赖执行 `require()`，未安装时必然失败；该失败**不得**记为“来源篡改”。verifier 必须在 P1 完成后运行；安装前只允许做不含依赖加载的静态检查。
2. **guard 自检先于任何业务模块加载**：P2 必须在 P3/P4 之前完成；自检未通过不得进入 P3/P4，不得“摘掉 guard 继续跑”。
3. **正控先于测试**：P3 在业务模块加载前证明 `sharp`/`wx-server-sdk` 不被 guard 误伤；`sharp` 是 H1 回归的真实依赖（`face-service-h1-regression.test.mjs:8` → `files.mjs:65-69` → `face-image.mjs:15`），禁止 stub、排除或以 guard 禁止。
4. **运行期禁网**：P3/P4 的每个进程都必须 `NODE_OPTIONS=--require <guard.cjs>` 预加载；guard 报告的网络调用合计必须为 0。安装期 registry 访问单独记录，**不得**计入运行期网络，也不得作为“运行期已联网”的解释。
5. **子进程继承实证**：`node --check` 子进程与 `node --test` worker 必须证明继承 `NODE_OPTIONS`（环境回显 + 子进程内 `net.connect` 被拦截并计数）；仅做 `--check` 的子进程不执行业务代码，但仍须记录继承事实。
6. **verify-import 与 blob 复算口径分开**：verify-import 是工作树字节 + 依赖加载 + 语法 + 资产的整体校验；blob 复算是 `git cat-file` 对象级 61/61。两者分别报告，任一不能替代另一；**安装前不得用 blob 通过冒充 verifier 通过**，也不得把 verifier 的依赖加载失败写成来源不符。

**guard 自身要求（沿用前序证据口径）**：

- 前序 guard 仅存 sha256：`guard.cjs` `4c84a87d83a4151e06e9b974a297eabd45a83ed073b125e66941d516376ae2d3`、`controls.cjs` `7203bdccf2db5583c7ae5c6302f5c91a62c94f8c0a6f63023194d858134b3922`；文件不在仓库内，重建件与旧 sha 是否一致**未知**，不得以“sha256 相同”作为复用证明。
- 入口集合必须覆盖 G3 已验收 49 项与 `dns.Resolver` 30 项（合计 79）；缺一即不合格，记 BLOCKED。
- 打补丁后调用 `syncBuiltinESMExports()`，并用 ESM 哨兵证明命名导入拿到被替换实现（不能只验 CJS `require`）。
- guard/controls 存放于**工作树之外**；记录绝对路径、文件清单、执行前后两次 sha256 与完整 `NODE_OPTIONS` 原文。

## 8. 来源校验与候选验收停止点

执行侧（获准后）最小校验序列，全部需在 **LF 检出**中进行：

| 序号 | 校验 | 通过条件 | 失败处理 |
|---|---|---|---|
| C1 | 输入/父链/origin ref | HEAD=`1be517e`，父=`cc4ec7b`；目标 ref 未前移 | 停止报告 |
| C2 | main 与差异 | fetch 后记录 main 实际 SHA；`git diff --stat` 与 §3/§4 重算一致 | 差异不一致即停止 |
| C3 | merge-tree 只读 | exit 0 且如实记录 tree/冲突；保留已复现事实（main 未前移时 tree `0ced1e17…` 有效）；不得 merge/cherry-pick | 有冲突即停止（不作“已解决”声明） |
| C4 | 环境与 LF/基线 | 记录 OS/Node/npm/autocrlf/EOL；工作树为 LF；24 函数与 admin-web 的 manifest/lock 哈希入证，并确认相对 `1be517e` 零差异 | 非 LF 或已有差异 → 停止 |
| C5 | 依赖安装（registry 阶段） | 24 函数 + admin-web 按规则安装 exit 0；guard **未加载**；registry/缓存/解析版本入证；无新生 lock、manifest/lock 零改动 | 任一失败 BLOCKED |
| C6 | guard 构建与独立自检 | 入口 **79 = G3 49 + Resolver 30**；79/79 负控、ESM 命名绑定、子进程继承全通过；工作树外存放，sha256 双记 | 不合格 BLOCKED |
| C7 | 安装后正控 | `wx-server-sdk` 加载、`sharp` 真实生成+解码、`spawnSync` 管道、`fs`/`crypto` 正常；网络增量 0 | 任一网络命中即停止 |
| C8 | `verify-import`（安装后、guard 下） | exit 0，原文含 61/24/318；完整 stdout/stderr 与 guard 报告 | BLOCKED |
| C9 | blob 级复算 | `git cat-file` 61/61 一致；与 C8 分开报告 | 不一致即停止 |
| C10 | 07B/H1 定向 | `face-service.test.mjs` 20/20、`face-service-h1-regression.test.mjs` 8/8，exit 0，guard 网络计数 0 | FAIL 即停止 |
| C11 | 逐文件非监听 | §6 的 7 个文件逐个 exit 0、全通过、guard 网络 0、无 listen | 任一失败即停止 |
| C12 | 范围与敏感 | 生产、manifest/lock、来源文件、已验收测试相对执行起点零 diff；`git status` 仅证据文件；无手机号/openid/密钥/云凭据 | 超出即停止 |

**验收停止点（任一命中即停，不得继续、不得自批）**：

- S1 门禁输入 SHA 与 `1be517e` 不符，或目标分支已前移/分叉；
- S2 main 在 fetch 后不是 `282a20f`（前移）——按 §9 重跑，旧“无冲突/可快进”结论作废；
- S3 merge-tree 出现冲突或非零；
- S4 工作树非 LF（本卡实测当前检出即 CRLF）；
- S5 `verify-import` 非 0 或计数不是 61/24/318，或 blob 复算不足 61/61；
- S6 依赖安装失败、`sharp` 缺失、`wx-server-sdk` 加载失败，或安装阶段被预加载 guard 导致 registry 不可达；
- S7 07B 非 20/20、H1 非 8/8、7 个非监听文件任一失败；
- S8 guard 入口不足 79（G3 49 + Resolver 30）、负控未拦截、ESM 绑定或子进程继承未证明、或正控触发网络；
- S9 范围核对出现生产/manifest/lock/来源/已验收测试 diff，或安装产生新 lock；
- S10 任何要求“合并 main / 合并 07B / 启动 HTTP/UI / 接 Provider 或设备 / 部署上线”的动作——超出授权，直接停止；
- S11 顺序倒置：先跑 `verify-import` 再安装、guard 自检晚于业务模块加载、或运行期出现 registry/网络访问——该轮证据**作废并重跑**，不得以“重试后通过”覆盖。

## 9. main 前移矩阵（哪些旧证据必须重跑）

旧证据的绑定关系：main `282a20f`、生产基线 `8ff350d`、guard sha 如上、Node `v24.19.0`、npm `11.17.0`、`sharp@0.35.5`、`wx-server-sdk@3.0.4`、`node-fetch@2.7.0`。本卡记录的是**当时**时点；main 一旦前移：

| main 前移触及 | 必须重跑 | 不得沿用 |
|---|---|---|
| 任意新提交 | C1 输入核对、C2 差异统计、C3 merge-tree（新 merge-base） | 旧 merge-tree tree/“无冲突”、旧提交/文件数 |
| `cloudfunctions/`、`design/`、`docs/backend-provenance.json`、`docs/backend-changes.json` | C8 `verify-import`（安装后）、C9 blob 复算、61/24/318/3 计数 | 旧 61/24/318 计数与旧来源结论 |
| `admin-web/package.json`、`admin-web/package-lock.json` | C5 安装与解析版本、C7 `sharp`/`wx-server-sdk` 正控 | 旧 0.35.5/3.18.7 版本结论 |
| `admin-web/lib/`、`admin-web/server.mjs` | C10 07B/H1、C11 逐文件非监听 | 旧 20/20、8/8、51/51 |
| `tests/`（仓库根） | C11 逐文件非监听 | 旧逐文件计数 |
| `docs/` | 仅证据文本与差异统计；不改变门禁计数 | 旧差异统计 |
| 任何情况 | 重新 fetch 并记录实际 SHA | 任何“可快进/已通过/已恢复”结论 |

## 10. 组织停用：未来 HTTP 接线前置（本卡不外推）

- 现状（本次只读核对）：`queryJob` 在 `admin-web/lib/face-service/service.mjs:798-802` 仅调用 `this.#require("device.audit.read")`；`#require`（`:167-172`）依赖 `#membership`（`:154-166`），后者只校验 `membership.status === "active"` 与 `orgId` 匹配，**未读取 `org.status`**。
- 前序门禁卡 IG07 已明确：`queryJob` 只校验成员 active，不校验 `org.status`，“组织停用仍需未来 HTTP 接线门禁，07B 服务层现状不得虚报已修”。
- 未来接线契约引用（不在候选范围内）：`docs/hk-face-http-wiring-design` @ `2f597e33acb3563d92cafd2d70ac238a27d796dc` 的 `docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md` 规定“组织/成员不可见 404；组织停用或缺权限 403”。该文件不在本次候选祖先链中，仅作外部引用，不构成本卡证据链的一部分。
- 结论：组织停用属**未来 HTTP 接线门禁前置**，本卡既不实现、也不宣称关闭；任何“已修/可上线”表述都超出本卡范围。

## 11. 冻结与禁止

- 禁止：merge、cherry-pick、rebase、reset、squash、force、amend；禁止写全局 git 配置；禁止关闭 TLS 校验；禁止替换本卡固定 SHA。
- 禁止：修改实现代码、已有文档、manifest/lock、来源登记、已验收测试；禁止触碰无关未跟踪文件。
- 禁止：安装依赖、跑业务测试、跑设备/支付/生产云、部署上线、启动 HTTP/UI。
- 不重验 G1/G2/G3/O10/G4 与 07B 离线门禁；不改变里程碑状态。
- 本卡仅建议“是否具备另行申请执行/集成的条件”；**建议不等于批准**。

## 12. 未验证与未知

- 前序证据中的 20/20、8/8、51/51、61/24/318、79/79、`npm ci` exit 0 均为**引用**，本卡未复跑。
- 云端完整复审报告正文（`/workspace/artifacts/DEL-AI-01-CONTENT-REVIEW-2026-11-18/REVIEW.md`）在本机不可达，F1–F8 是否逐项关闭**未知**。
- G3 验收对象 `5f1d7a4` 在本仓库存在（`git cat-file -t` = commit），但其验收记录正文不在本卡证据链内；O10 同上。
- `guard.cjs`/`controls.cjs` 实际内容与旧 sha256 是否可重建一致**未知**。
- 远端候选分支在本次 fetch 前是否曾存在**未知**（本次观测为不存在）。
- 未做逐文件代码评审、未做业务/安全评审、未接触任何真实环境。

## 13. 交付与本卡自身提交

- 本卡与证据缺口文档为本分支相对 `1be517e` 的**唯一新增**（两份文档），不改任何既有文件。
- 截至固定输入 `7de358b`（r2 修订后）的分支 tip 相对 main 为 **137 提交 / 95 文件 / +30637 −512**（依据 `git rev-list --count origin/main..7de358b`、`git diff --shortstat origin/main..7de358b`）；候选范围定义仍是 `origin/main..1be517e` = 134 提交 / 93 文件 / +30288 −512，**不因本卡提交而变化**。
- 提交方式：普通 `git commit` 追加；推送目标精确为 `refs/heads/docs/hk-face-07b-integration-candidate-task`（**不推 `origin/main`**，不推其他跟踪 ref）。
- 推送后以 `git ls-remote` 核对远端完整 SHA 与本地一致；本卡自身提交 SHA、父提交与 GitHub 固定 SHA 链接见调度回报（避免在文档内预写未生成的值）。
- 本卡不自批：交付后由 Codex 独立复审；复审通过前不得据此执行或合并。

## 14. 参考链接（固定 SHA）

- 门禁任务卡 r3：<https://github.com/1997dmsu-sketch/SMART-PM/blob/1be517e48cadd810caa4f44df9e38e14c8b2c764/docs/tasks/HK-AI-07B-OFFLINE-INTEGRATION-GATE-TASK-DRAFT-2026-11-18.md>
- 门禁证据：<https://github.com/1997dmsu-sketch/SMART-PM/blob/1be517e48cadd810caa4f44df9e38e14c8b2c764/docs/tasks/HK-AI-07B-OFFLINE-INTEGRATION-GATE-EVIDENCE-2026-11-18.md>
- `queryJob` 现状：<https://github.com/1997dmsu-sketch/SMART-PM/blob/1be517e48cadd810caa4f44df9e38e14c8b2c764/admin-web/lib/face-service/service.mjs#L798-L802>
- `#membership`：<https://github.com/1997dmsu-sketch/SMART-PM/blob/1be517e48cadd810caa4f44df9e38e14c8b2c764/admin-web/lib/face-service/service.mjs#L154-L166>
- `verify-import`：<https://github.com/1997dmsu-sketch/SMART-PM/blob/1be517e48cadd810caa4f44df9e38e14c8b2c764/scripts/verify-import.mjs#L16-L35>
- 来源清单：<https://github.com/1997dmsu-sketch/SMART-PM/blob/1be517e48cadd810caa4f44df9e38e14c8b2c764/docs/backend-provenance.json>
- 变更登记：<https://github.com/1997dmsu-sketch/SMART-PM/blob/1be517e48cadd810caa4f44df9e38e14c8b2c764/docs/backend-changes.json>
