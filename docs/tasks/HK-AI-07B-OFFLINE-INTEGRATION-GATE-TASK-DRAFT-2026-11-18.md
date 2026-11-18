# HK-AI-07B 离线集成门禁任务卡（草案 r3）

- 日期：2026-11-18（Asia/Shanghai）。状态：仅任务卡修订，待独立审批；**不授权合并，也不授权执行本卡步骤**。
- 修订依据：独立只读复审（2026-11-18，任务B，结论 NEEDS_REVISION）F1–F8（已由 r2 落实）；r3 按调度方 2026-11-18 内容复审修订指令，纠正 H1 回归经 `files.mjs → face-image.mjs` 加载 sharp 的依赖事实，并细化 guard 入口与正负控。**本次未取得云端完整复审报告正文**（`/workspace/artifacts/DEL-AI-01-CONTENT-REVIEW-2026-11-18/REVIEW.md` 在本机不可达），故不据此声称逐项关闭；未明确项以调度方裁定为准。
- 固定生产基线：`8ff350d3f6ec41e67cc8d42639f8c37cf96323da`；分支 `docs/hk-face-queryjob-provenance` 的 tip；直接父 `59a737acf49e249a8e3388867ca605e90a47ca61`。
- 执行工作树起点：本卡所在提交（执行分支 HEAD）。其祖先链为 `bd3771283e81c98c6e097e0c5711c0da76017bb2`（上一版卡）→ `8ff350d3f6ec41e67cc8d42639f8c37cf96323da`（生产基线）；生产代码始终以 `8ff350d` 为基线，须用 `git diff --stat 8ff350d..HEAD` 证明除本卡（及后续修订）外零差异。
- 参考 main：`282a20fca9f64ab80ead50372c9c3e90bf4aeba7`。执行时必须重新 fetch 并记录 main 实际 SHA；main 前移后不得沿用旧的无冲突结论。
- 07B 验收指针：07B 终审与里程碑结论以调度方验收记录为准（G3 已于 `5f1d7a4` 验收关闭、O10 PASS，**不重派、不复核**）；本卡不自行认定 07B 通过；本地若无 `5f1d7a4` 对象，只能引用调度方记录，不得用其他 SHA 冒充。
- 来源登记基线：`docs/backend-provenance.json` 61 个文件、`docs/backend-changes.json` 3 条变更（phoneLogin/getHouses/contentList）、`design/asset-manifest.json` 318 项、`cloudfunctions/` 24 个函数。此前来源哈希在 **blob 级 61/61** 一致；完整 verify-import 曾因缺 wx-server-sdk 未跑完。

## 1. 可派单目标

可先派独立会话复审本文档。获准执行后：在固定基线建立隔离验证工作树，完成依赖/来源/语法/离线回归门禁，给出“是否具备另行申请集成”的条件；不得实际合并 main、G3、07B，也不得创建未批准的组合实现。

## 2. 执行前置（P1–P5，未满足不得进入 IG）

- **P1 取件与固定**：fetch 后记录 `origin/docs/hk-face-queryjob-provenance` 实际 tip 与 origin ref；前移或分叉即停止报告，**不得替换本卡固定 SHA**；目标对象不存在时同样停止，不得以其他 SHA 替代。
- **P2 行尾（EOL）**：记录 OS、`node -v`、`npm -v`、`git config core.autocrlf`、`git ls-files --eol` 抽样（至少 1 个来源文件）。必须以 `core.autocrlf=false` 检出（如 `git -c core.autocrlf=false worktree add`）。**工作树非 LF 时 IG03 记 BLOCKED**：不得把 CRLF 造成的哈希不符记为分支篡改，也不得放宽来源校验。
- **P3 哈希口径**：来源哈希以 **blob 原始字节**为权威。除运行 verify-import 外，另用 `git cat-file --batch` 复算 61 个来源文件 sha256，与 provenance/changes 对照；**blob 复算与 verify-import 结果分开报告**，前者不能替代后者。
- **P4 基线记录**：记录 fetch 时 main 实际 SHA、`git status --porcelain`、`git diff --stat 8ff350d..HEAD`、依赖目录与锁清单，并核对期望计数（61 来源 / 24 函数 / 318 资产 / 3 变更）。
- **P5 依赖事实**：静态追踪并记录 IG03/IG04/IG05 的第三方依赖 file:line 链（至少：`admin-web/tests/face-service-h1-regression.test.mjs` → `admin-web/lib/files.mjs` → `admin-web/lib/face-image.mjs` → `sharp`，以及 24 个云函数的 `wx-server-sdk` / `node-fetch`）；核对 `admin-web/package-lock.json` 的 sharp 版本，并证明相关源文件相对 `8ff350d` 零 diff。

## 3. 允许范围与依赖安装规则

- 仅新增证据文档 `docs/tasks/HK-AI-07B-OFFLINE-INTEGRATION-GATE-EVIDENCE-2026-11-18.md`；不改生产代码、脚本、manifest、lock、来源登记数据或已验收测试。
- 安装规则统一到仓库既有约定（`README.md` 第 45–47 行、`scripts/install-backend.mjs` 第 13–15 行）：
  - 有 lock 且与 manifest 一致：`dbInit`、`unlock` 用 `npm ci`；
  - 无 lock 的 21 个函数，以及 lock 缺 `node-fetch` 的 `addTuyaDevice`：一律 `npm install --package-lock=false`；
  - 不得手改 manifest/lock，不得提交新生 lock，不得用 `--ignore-scripts`、stub 或跳过依赖绕过。
- `admin-web` 依赖按 `admin-web/package-lock.json` 用 `npm ci` 安装（`sharp` 0.35.5、`@cloudbase/node-sdk` 3.18.7）；**`sharp` 是 H1 回归的真实必需依赖（见 IG05 导入链），不得 stub、不得排除、不得以 guard 禁止**；native 安装失败按 BLOCKED 处理。
- 安装期允许 npm registry 网络，但必须与业务网络**分开记录**（registry URL、时间、代理/网络状态、`npm_config_cache` 实际路径；Windows 上默认 `/workspace/.smart-pm-npm-cache` 需显式覆盖）。
- 记录每个函数/包解析到的确切版本（`npm ls --json --depth=0` 或 `node_modules/<dep>/package.json`）；无锁函数须注明“版本可能随日期变化”（`README.md` 第 47 行）。
- 任一依赖安装或加载失败：对应 IG 记 **BLOCKED** 并保留错误，不得以部分安装冒充通过。
- `wx-server-sdk` 只验证**加载**：不初始化真实云、不调用云函数、不读写数据库。

## 4. 离线门禁矩阵（获准后执行）

| ID | 验证与交付 |
|---|---|
| IG01 | 完整 SHA/父链与 origin ref 一致；记录 Node/npm/OS/autocrlf/EOL、依赖目录与锁清单、工作树初始状态；登记期望计数 61 来源 / 24 函数 / 318 资产 / 3 变更。 |
| IG02 | 相对重新 fetch 的 main（记录实际 SHA；参考值 282a20f）审阅差异：**以提交/文件清单分类为边界**——本卡参考统计为 129 提交 / 91 文件 / +30020 −512（admin-web 70、docs 18、scripts 1、cloudfunctions 1、CHANGELOG 1），执行时按实际重新统计；非 docs 变更只做清单级确认与逐提交分类，不做逐行代码评审。read-only `merge-base`/`merge-tree` 做语义与冲突分析，不 git merge/cherry-pick，不以无冲突代替批准。继承改动必须命中 3 条 changes（含 contentList）。 |
| IG03 | 在 LF 工作树完整运行 `node scripts/verify-import.mjs`，保存完整 stdout/stderr 与 exit code，原文须出现 61/24/318 计数；不得只摘录、不得把“仅 61 项哈希通过”当作全部通过。同时给出 P3 的 blob 复算（61/61），与 verify-import 分开报告。覆盖来源/变更哈希、语法（`.js` 的 `node --check`）、24 个函数 manifest 依赖 require（含 wx-server-sdk 与 node-fetch）、318 项资产哈希。 |
| IG04 | 按第 3 节规则安装（先审 `scripts/install-backend.mjs` 与各 manifest）；完整重跑 IG03。安装失败/缺依赖 → BLOCKED（列明函数与错误）。记录每函数解析版本与缓存路径；不得提交新 lock。 |
| IG05 | 指定 `admin-web/tests/face-service.test.mjs` 与 `admin-web/tests/face-service-h1-regression.test.mjs`；覆盖 module-load guard（loadTime 五入口为零）、篡改探针、逐场景全库零写、六字段 DTO/revision。**sharp 真实依赖（本版纠正 r2 的错误判断）**：静态导入链为 `admin-web/tests/face-service-h1-regression.test.mjs:8` → `admin-web/lib/files.mjs:65–69` → `admin-web/lib/face-image.mjs:15`（`import sharp from "sharp"`），解码使用点在 `face-image.mjs:102`；顶层 import 即触发加载，故 H1 回归必须安装并**真实加载 sharp**（按 `admin-web/package-lock.json` 的 0.35.5 执行 `npm ci`），**禁止 stub、排除或以 guard 禁止**；`face-service.test.mjs` 经 `service.mjs` 本地链，不加载 sharp。执行时须重新做同一静态追踪并把 file:line 写入证据，且证明相关文件相对 `8ff350d` 零 diff；sharp 安装/加载失败 → IG05/IG04 记 BLOCKED。真实 exit/计数与隔离方式分开报告。 |
| IG06 | 显式列出根目录 7 个无监听测试（`tests/cloud-bootstrap.test.cjs`、`tests/frontend.test.cjs`、`tests/layout.test.cjs`、`tests/phone-login.test.cjs`、`tests/public-houses.test.cjs`、`tests/wechat-modules.test.cjs`、`tests/wxml.test.cjs`）逐个运行；禁止后台 `npm test` 全量；全部 code/status 与零写不放宽；exit/计数与隔离方式分开报告。 |
| IG07 | 组织停用仍需未来 HTTP 接线门禁，07B 服务层现状不得虚报已修（`queryJob` 只校验成员 active，不校验 `org.status`）；列出 HTTP/UI、Provider、生产云、真机未验证项及 G5/G6 边界，不得外推本卡结论。 |
| IG08 | 生产、manifest/lock、来源文件、已验收测试零 diff；`git status --porcelain` 仅允许证据文件（`node_modules` 已忽略；不得遗留新 lock、guard 或临时文件）。检查敏感输出（手机号/openid/密钥/云端凭据不入证据）。证据追加提交：**父 = 执行时 HEAD（本卡提交），目标分支 = 调度方执行派单指定（默认 `codex/07b-integration-task-revision`）**；普通 push，不 force/amend/rebase/reset/squash；push 前 fetch 确认远端未分叉，push 后核验远端 SHA 与本地一致。 |

## 5. 隔离验证设施（guard）

- **存放**：工作树之外的临时目录（如 `%TEMP%\07b-guard\<随机>`），不入 git；证据记录绝对路径、文件清单与执行前后两次 `sha256`（必须一致）。
- **预加载**：`NODE_OPTIONS=--require <guard.cjs>`，在任何业务模块加载前完成；对 Node 内置模块打补丁后调用 `module.syncBuiltinESMExports()`，使 ESM 命名导入与 CJS 共享同一被替换实现；记录完整 `NODE_OPTIONS` 原文。
- **必须覆盖的入口（逐入口独立计数；计数允许重叠，但每个入口必须有自身 seam 的命中证明，不能只靠底层 net 一刀切）**：
  - 连接：`net.Socket.prototype.connect`；`net.connect`；`net.createConnection`；
  - UDP：`dgram.Socket.prototype.bind`；`dgram.Socket.prototype.send`；
  - DNS：回调式 `dns.lookup`、`dns.lookupService`、`dns.resolve*`（含 resolve4/6、MX、TXT、SRV、PTR、NS、CAA、NAPTR、SOA）及 `dns.Resolver.prototype.resolve*`；Promise 式 `dns.promises.lookup`、`dns.promises.resolve*`；
  - TLS/HTTP/HTTPS/fetch：`tls.connect`；`http.request` / `http.get`；`http.Server.prototype.listen`；`https.request` / `https.get`；`globalThis.fetch`。
- **ESM 命名绑定**：打补丁后 `syncBuiltinESMExports()`；用 ESM 哨兵（`import { connect } from "node:net"`、`import { lookup } from "node:dns/promises"`、`import { request } from "node:http"`）证明命名导入拿到的是被替换实现（调用即失败并计数），不得只验证 CJS `require`。
- **子进程继承**：verify-import 的 `node --check` 子进程与 `node --test` worker 必须继承 `NODE_OPTIONS`；用受控探针（子进程内 `net.connect` 应失败并计数、环境回显）证明；仅做 `--check` 的子进程不执行代码，须在证据中说明其不产生网络能力，但仍记录环境已传递。
- **逐入口负控**：对上面每个入口各执行一次应失败调用（不得真实联网），逐项记录 `{入口, seam, 结果, 计数增量}`；任一入口未拦截 → guard 不合格，IG 记 BLOCKED。
- **正控（必需依赖必须可用）**：`require("wx-server-sdk")` 成功（模拟 IG03 依赖加载）；`sharp` 真实加载并完成一次内存内生成/解码（如 `sharp({create:{...}}).jpeg().toBuffer()`），证明 guard 不误伤 sharp；`spawnSync(process.execPath, ["-e", ...])` 管道通信正常（verify-import 依赖）；fs/crypto 正常；以上正控均不得触发网络。
- **不降级**：guard 异常或误报时保留错误并停止，不得摘除 guard 继续跑，不得宣称默认隔离通过。
- **来源校验负控**：故意错误摘要只在内存/临时副本执行，不改已验收来源文件，并证明错误被捕获。

## 6. 结论与停止点

- 每个 IG 给 PASS/FAIL/BLOCKED、文件/SHA/行号/命令与完整输出；实际 exit/计数与隔离方式分开。
- 完整 verifier、必要回归和范围核对全通过，才可**建议申请**下一步集成；**建议不等于批准合并**。
- 不得派为“合并 07B”任务；不得改 G1/G2/G3 里程碑；不开始 G4 执行、C1 实现、C2/C3、main/07B 合并、HTTP/UI、Provider/设备/生产云、部署或上线。
- 本卡仅草案修订，未安装依赖、未跑门禁、未做集成；执行需调度方单独明确批准。
