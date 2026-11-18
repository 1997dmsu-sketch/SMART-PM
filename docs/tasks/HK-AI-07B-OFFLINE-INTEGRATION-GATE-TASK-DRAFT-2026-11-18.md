# HK-AI-07B 离线集成门禁任务卡（草案 r2）

- 日期：2026-11-18（Asia/Shanghai）。状态：仅任务卡修订，待独立审批；**不授权合并，也不授权执行本卡步骤**。
- 修订依据：独立只读复审（2026-11-18，任务B，结论 NEEDS_REVISION）F1–F8；本版只补充执行前置、依赖安装规则、guard 设施、差异边界与记录口径，不改变原范围与冻结边界。
- 固定生产基线：`8ff350d3f6ec41e67cc8d42639f8c37cf96323da`；分支 `docs/hk-face-queryjob-provenance` 的 tip；直接父 `59a737acf49e249a8e3388867ca605e90a47ca61`。
- 执行工作树起点：本卡提交（当前 `bd3771283e81c98c6e097e0c5711c0da76017bb2`，父 = 上述基线，相对基线仅新增本卡）。若本卡再次修订，以修订后提交为起点；生产代码始终以 `8ff350d` 为基线，须用 `git diff --stat 8ff350d..HEAD` 证明除本卡（及后续修订）外零差异。
- 参考 main：`282a20fca9f64ab80ead50372c9c3e90bf4aeba7`。执行时必须重新 fetch 并记录 main 实际 SHA；main 前移后不得沿用旧的无冲突结论。
- 07B 验收指针：07B 终审与里程碑结论以调度方验收记录为准（G3 已于 `5f1d7a4` 验收关闭、O10 PASS，**不重派、不复核**）；本卡不自行认定 07B 通过；本地若无 `5f1d7a4` 对象，只能引用调度方记录，不得用其他 SHA 冒充。
- 来源登记基线：`docs/backend-provenance.json` 61 个文件、`docs/backend-changes.json` 3 条变更（phoneLogin/getHouses/contentList）、`design/asset-manifest.json` 318 项、`cloudfunctions/` 24 个函数。此前来源哈希在 **blob 级 61/61** 一致；完整 verify-import 曾因缺 wx-server-sdk 未跑完。

## 1. 可派单目标

可先派独立会话复审本文档。获准执行后：在固定基线建立隔离验证工作树，完成依赖/来源/语法/离线回归门禁，给出“是否具备另行申请集成”的条件；不得实际合并 main、G3、07B，也不得创建未批准的组合实现。

## 2. 执行前置（P1–P4，未满足不得进入 IG）

- **P1 取件与固定**：fetch 后记录 `origin/docs/hk-face-queryjob-provenance` 实际 tip 与 origin ref；前移或分叉即停止报告，**不得替换本卡固定 SHA**；目标对象不存在时同样停止，不得以其他 SHA 替代。
- **P2 行尾（EOL）**：记录 OS、`node -v`、`npm -v`、`git config core.autocrlf`、`git ls-files --eol` 抽样（至少 1 个来源文件）。必须以 `core.autocrlf=false` 检出（如 `git -c core.autocrlf=false worktree add`）。**工作树非 LF 时 IG03 记 BLOCKED**：不得把 CRLF 造成的哈希不符记为分支篡改，也不得放宽来源校验。
- **P3 哈希口径**：来源哈希以 **blob 原始字节**为权威。除运行 verify-import 外，另用 `git cat-file --batch` 复算 61 个来源文件 sha256，与 provenance/changes 对照；**blob 复算与 verify-import 结果分开报告**，前者不能替代后者。
- **P4 基线记录**：记录 fetch 时 main 实际 SHA、`git status --porcelain`、`git diff --stat 8ff350d..HEAD`、依赖目录与锁清单，并核对期望计数（61 来源 / 24 函数 / 318 资产 / 3 变更）。

## 3. 允许范围与依赖安装规则

- 仅新增证据文档 `docs/tasks/HK-AI-07B-OFFLINE-INTEGRATION-GATE-EVIDENCE-2026-11-18.md`；不改生产代码、脚本、manifest、lock、来源登记数据或已验收测试。
- 安装规则统一到仓库既有约定（`README.md` 第 45–47 行、`scripts/install-backend.mjs` 第 13–15 行）：
  - 有 lock 且与 manifest 一致：`dbInit`、`unlock` 用 `npm ci`；
  - 无 lock 的 21 个函数，以及 lock 缺 `node-fetch` 的 `addTuyaDevice`：一律 `npm install --package-lock=false`；
  - 不得手改 manifest/lock，不得提交新生 lock，不得用 `--ignore-scripts`、stub 或跳过依赖绕过。
- 安装期允许 npm registry 网络，但必须与业务网络**分开记录**（registry URL、时间、代理/网络状态、`npm_config_cache` 实际路径；Windows 上默认 `/workspace/.smart-pm-npm-cache` 需显式覆盖）。
- 记录每个函数解析到的确切版本（`npm ls --json --depth=0` 或 `node_modules/<dep>/package.json`）；无锁函数须注明“版本可能随日期变化”（`README.md` 第 47 行）。
- 任一函数安装或加载失败：该函数与 IG03/IG04 记 **BLOCKED** 并保留错误，不得以部分安装冒充通过。
- `wx-server-sdk` 只验证**加载**：不初始化真实云、不调用云函数、不读写数据库。

## 4. 离线门禁矩阵（获准后执行）

| ID | 验证与交付 |
|---|---|
| IG01 | 完整 SHA/父链与 origin ref 一致；记录 Node/npm/OS/autocrlf/EOL、依赖目录与锁清单、工作树初始状态；登记期望计数 61 来源 / 24 函数 / 318 资产 / 3 变更。 |
| IG02 | 相对重新 fetch 的 main（记录实际 SHA；参考值 282a20f）审阅差异：**以提交/文件清单分类为边界**——本卡参考统计为 129 提交 / 91 文件 / +30020 −512（admin-web 70、docs 18、scripts 1、cloudfunctions 1、CHANGELOG 1），执行时按实际重新统计；非 docs 变更只做清单级确认与逐提交分类，不做逐行代码评审。read-only `merge-base`/`merge-tree` 做语义与冲突分析，不 git merge/cherry-pick，不以无冲突代替批准。继承改动必须命中 3 条 changes（含 contentList）。 |
| IG03 | 在 LF 工作树完整运行 `node scripts/verify-import.mjs`，保存完整 stdout/stderr 与 exit code，原文须出现 61/24/318 计数；不得只摘录、不得把“仅 61 项哈希通过”当作全部通过。同时给出 P3 的 blob 复算（61/61），与 verify-import 分开报告。覆盖来源/变更哈希、语法（`.js` 的 `node --check`）、24 个函数 manifest 依赖 require（含 wx-server-sdk 与 node-fetch）、318 项资产哈希。 |
| IG04 | 按第 3 节规则安装（先审 `scripts/install-backend.mjs` 与各 manifest）；完整重跑 IG03。安装失败/缺依赖 → BLOCKED（列明函数与错误）。记录每函数解析版本与缓存路径；不得提交新 lock。 |
| IG05 | 指定 `admin-web/tests/face-service.test.mjs` 与 `admin-web/tests/face-service-h1-regression.test.mjs`；覆盖 module-load guard（loadTime 五入口为零）、篡改探针、逐场景全库零写、六字段 DTO/revision。**sharp 说明**：上述两文件只用 Node 内置模块与本地模块，不引入第三方依赖、不需要 sharp；sharp 仅被冻结的 HTTP/server 面测试（face-biometric / server-face* / trailing-payload）使用，本卡不安装、不运行、不 stub；若执行中确需 sharp，视为超范围并停止报告。真实 exit/计数与隔离方式分开报告。 |
| IG06 | 显式列出根目录 7 个无监听测试（`tests/cloud-bootstrap.test.cjs`、`tests/frontend.test.cjs`、`tests/layout.test.cjs`、`tests/phone-login.test.cjs`、`tests/public-houses.test.cjs`、`tests/wechat-modules.test.cjs`、`tests/wxml.test.cjs`）逐个运行；禁止后台 `npm test` 全量；全部 code/status 与零写不放宽；exit/计数与隔离方式分开报告。 |
| IG07 | 组织停用仍需未来 HTTP 接线门禁，07B 服务层现状不得虚报已修（`queryJob` 只校验成员 active，不校验 `org.status`）；列出 HTTP/UI、Provider、生产云、真机未验证项及 G5/G6 边界，不得外推本卡结论。 |
| IG08 | 生产、manifest/lock、来源文件、已验收测试零 diff；`git status --porcelain` 仅允许证据文件（`node_modules` 已忽略；不得遗留新 lock、guard 或临时文件）。检查敏感输出（手机号/openid/密钥/云端凭据不入证据）。证据追加提交：**父 = 执行时 HEAD（本卡提交），目标分支 = 调度方执行派单指定（默认 `codex/07b-integration-task-revision`）**；普通 push，不 force/amend/rebase/reset/squash；push 前 fetch 确认远端未分叉，push 后核验远端 SHA 与本地一致。 |

## 5. 隔离验证设施（guard）

- **存放**：工作树之外的临时目录（如 `%TEMP%\07b-guard\<随机>`），不入 git；证据记录绝对路径、文件清单与执行前后两次 `sha256`（必须一致）。
- **预加载**：`NODE_OPTIONS=--require <guard.cjs>`，在业务模块加载前完成；对 Node 内置模块调用 `syncBuiltinESMExports()` 覆盖 ESM 命名绑定；记录完整 `NODE_OPTIONS` 原文。
- **子进程继承**：verify-import 的 `node --check` 子进程与 `node --test` worker 必须继承 `NODE_OPTIONS`，用受控探针（子进程打点/计数/环境回显）证明；仅做 `--check` 的子进程不执行代码，须在证据中说明其不产生网络能力，但仍记录环境已传递。
- **禁止面（逐入口独立计数）**：`fetch`；`http.request/get`；`https.request/get`；`net.connect`；`tls.connect`；`dgram.createSocket`；`dns.lookup/resolve`；`Server.listen`（http/net）。
- **负控**：对每个被禁入口各执行一次应当失败的调用（不得真实联网），逐项记录 {入口, 结果, 计数增量}；任一入口未拦截 → guard 不合格，IG 记 BLOCKED。
- **正控**：`require('wx-server-sdk')` 成功（模拟 IG03 依赖加载）；ESM 命名导入哨兵（如 `import { connect } from "node:net"`、`import { request } from "node:http"`）证明命名绑定被覆盖；no-op/sentinel 不转发真实网络。
- **不降级**：guard 异常或误报时保留错误并停止，不得摘除 guard 继续跑，不得宣称默认隔离通过。
- **来源校验负控**：故意错误摘要只在内存/临时副本执行，不改已验收来源文件，并证明错误被捕获。

## 6. 结论与停止点

- 每个 IG 给 PASS/FAIL/BLOCKED、文件/SHA/行号/命令与完整输出；实际 exit/计数与隔离方式分开。
- 完整 verifier、必要回归和范围核对全通过，才可**建议申请**下一步集成；**建议不等于批准合并**。
- 不得派为“合并 07B”任务；不得改 G1/G2/G3 里程碑；不开始 G4 执行、C1 实现、C2/C3、main/07B 合并、HTTP/UI、Provider/设备/生产云、部署或上线。
- 本卡仅草案修订，未安装依赖、未跑门禁、未做集成；执行需调度方单独明确批准。
