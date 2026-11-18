# HK-AI-07D G4 兼容与封闭审查任务卡（修订版 v3 · 仅 G4-04 三场景澄清 · 待独立审批）

- 日期：2026-11-18（Asia/Shanghai）。状态：**修订版 v3（仅 G4-04），待独立审批；不授权执行 G4**。本次只改 G4-04 及其 fixture 要求与修订记录，不执行、不预判结论。
- 固定拟执行基线：`5f1d7a409847bc78d860963f13b45358fac7b5d6`（G3 验收提交；验收指针与谱系见 §0）。
- 本修订输入对象：`daffd9002ad9384a5ada3658b372b192befcb14a`（本卡 v2，父 `b905ac…`）；本次修订提交以 `daffd90` 为父。
- 权威设计：`51e2453d4ec19027976f79d22b82cc45b723f900` 的 `docs/tasks/HK-AI-07D-RETRY-REQUEUE-DESIGN-2026-11-15.md`（796 行；§4.11:505-525、§4.12:527-536、§6 G4 门禁行），跨分支只读引用，**不在本分支树内**。
- 里程碑：G1 原验收 `4f9c43d`、补充证据 `2054404`；G2 验收 `b3a41ea`、收尾 `c8290db`；E07 独立清理 `521a0f0`（`routes.mjs` 7 行删除）已引入 G3 候选。较新的 G1 补充证据仅只读引用，不混入候选。

## 0. 基线与谱系（执行前置，必须记录）

| 项 | 值 / 要求 | 核验方式 |
|---|---|---|
| 固定基线 | `5f1d7a409847bc78d860963f13b45358fac7b5d6`（tree `38675c3…`，父 `5abfd74…`） | `git cat-file -p` / `rev-parse` |
| G3 验收指针 | Codex 复审通过：90 ID 达标、O10 PASS、G3 关闭且不重派；验收提交 `5f1d7a4`。**该提交自身信息为“G3 未关闭”**（提交时点早于验收裁定），验收为其后的独立裁定；执行者不得据此改写 G3 证据或宣布关闭 | 只读引用 + 调度裁定 |
| G3 候选谱系 | `c8290db`（G2 收尾）→ `dcb36b8`（G3 R2）→ `5abfd74`（cherry-pick `521a0f0`，G3 证据 §14.1 记录的候选 HEAD）→ `5f1d7a4`（§14 证据，+57/−1）→ `b905ac`（本卡 v1）→ `daffd90`（v2）→ 本修订提交（v3） | `git log --oneline` / 逐级读 `parent` |
| shallow 声明 | 共享仓库曾被浅取标记；`rev-list`/`log` 在边界处父为空**不等于无父**，谱系一律以 commit 对象 `parent` 行为准；执行前记录 `git rev-parse --is-shallow-repository` 与 `.git/shallow` 内容 | 命令留证 |
| 权威设计取件 | 执行前取 `51e2453d…`，核对文件 796 行及 `§4.11:505`、`§4.12:527` 锚点；取件失败即 BLOCKED，不得用 G3 证据文本替代设计原文 | 命令 + SHA + 行数 |
| 执行前置 | `git rev-parse HEAD` == `5f1d7a4`；`git status --porcelain` 为空；`git diff --stat 5f1d7a4 -- admin-web docs` 为空 | 证据文档首段记录 |

## 1. 可派单目标与前置

本卡可派给新的执行会话；只有本卡获明确执行批准，才从固定基线新建独立审查工作树与结果分支。不得把“创建本文档分支”理解成 G4 已启动，也不得把本修订提交理解为执行批准。

G4 目标：独立证明旧 requeue 入口、旧 queued/result/log/audit 不会被当作严格 retry 的新 K2 成功；历史记录不迁移、不回填、不重写，HTTP 仍关闭。G3 的 O10/O11 证据可追溯，但不能免除本阶段独立复核。

## 2. 拟执行范围与禁止项

- 必需新增（仅此两个文件）：
  1. `docs/tasks/HK-AI-07D-G4-COMPATIBILITY-EVIDENCE-2026-11-18.md`
  2. `admin-web/tests/face-g4-compatibility.test.mjs`（仅合成 fixture）
- **G4 运行时证据必须由第 2 个文件独立重建**（实例、原型链、模块导出键、路由匹配），不得以“静态证据不足才补测试”为条件，也不得引用 G1 既有断言或 G3 O10 日志充当本阶段实测。
- 不改任何既有生产文件、validator、Store、schema、G1/G2/G3 已验收测试或设计。若发现缺陷，给最小复现并停止该项，另立修复任务。
- 不合并任何分支，不注册路由，不开启 HTTP/UI、Provider、设备、生产云、支付或定时任务。不实施 C1/C2/C3，不改 K3。

## 3. 测试设施与逐文件运行范围（批准后生效）

**testkit 使用范围**：批准复用 `admin-web/tests/face-g3-testkit.mjs` 的 guard 与存储设施——`installNetworkGuard`、`assertNoLoadTimeViolation`、`restoreNetworkGuard`、`getViolations`、`resetRuntimeViolations`、`positiveControlAll`、`guardEntryNames`，以及 LocalStore/fixture 基础构造。**兼容 fixture 必须独立构造**：不得 import 或复制 `face-g3-ko.test.mjs` 中 O11 的 fixture 构造、预期值、断言文本；证据文档须声明“复用测试设施、独立构造兼容 fixture”。

**逐文件允许清单**（禁止 `npm test`、`node --test tests/`、`tests/*.test.mjs` glob 或任何未列文件）：

```text
cd admin-web
node --test \
  tests/face-strict-retry.test.mjs \
  tests/face-g3-testkit.mjs \
  tests/face-g3-psrtn.test.mjs \
  tests/face-g3-ko.test.mjs \
  tests/face-g3-c.test.mjs \
  tests/face-g4-compatibility.test.mjs
```

- 以上 6 个文件为唯一允许集；逐文件记录 exit 与计数，合计另报。
- **G4-04 fixture**：三场景各自独立构造——旧 requeue 遗留 queued job（`operation_keys` 无该 job 记录）、由合成 fixture 置为 `retryable_failed` 的旧 job（满足全部前置）、以及由严格 retry 实际创建并留有回执的 op key；不得用“旧 key”称谓代替真实 op key 记录，不得合并为一条用例。
- 若执行中发现必须追加文件：**先停手**，书面列明路径、非 HTTP 理由、预期计数，获批准后追加；不得先跑后报。
- 每个文件运行前确认无 HTTP 监听；guard 在业务模块加载前安装，覆盖已验收网络入口（含 ESM 命名绑定）；正控不转发真实函数、业务违规不可被清零掩盖、结束精确恢复身份与描述符。

## 4. 独立审查矩阵

| ID | 必须证明 |
|---|---|
| G4-01 | H3/H4 原型链与公共导出面不存在旧 requeue 方法、别名、兼容 stub 或绕过入口；静态与运行时证据对应，且运行时证据由 `face-g4-compatibility.test.mjs` 独立重建（实例属性、原型链描述符、模块导出键），不以 G1 断言/G3 日志替代 |
| G4-02 | server 无 retry handler；routes 无旧 retry 描述，list/reconcile 描述与现有导出保持；E07 七行清理不等于 HTTP 接线。**运行时负向断言**：`FACE_ROUTES` 无 retry id；`matchFaceRoute("POST","/api/v2/device-operation-jobs/<id>/retry")` 不匹配；guard 记录 `listen`/`createServer` 调用为 0 |
| G4-03 | enroll/revoke 两种旧 queued 形状在新 key 下均 INVALID_STATE/409，全库零写，旧 result/due 字段逐字段原样 |
| G4-04 | 旧 log/audit 的 ID、action、缺失 op key 不能反推/补写新成功回执；成功凭据只来自新 method/domain/确定性审计与精确回执。**三独立场景见下方“G4-04 三独立场景”**：旧 queued job+新 key→INVALID_STATE/409 零写；旧 job 合法再失败+全新 key→成功；严格 retry 已用 key 在请求 revision 改变后复用→CONFLICT/409 零写。**旧 requeue 从未写 operation_keys，不得仅因“旧 key”称谓断言冲突** |
| G4-05 | 旧历史记录作为哨兵与正常 retry 共存，除本次合法写集外，所有集合历史内容、排序与计数零变化；不做扫描迁移/回填；**其他 K2 method 的 op key 与本方法互不重放、互不影响**，成功写集不含其他 method 的 op key |
| G4-06 | 两种 job 相反 queued 不变量均保留，成功后分别通过原正式 validator；旧 worker lease/fence 不被 retry 采纳或改写 |
| G4-07 | 同键合法重放、ack loss、job 已推进后的原快照语义不因兼容处理而变化；权限撤销/损坏凭据仍 fail-closed |
| G4-08 | 对照批准设计 §4.11、§4.12、O10/O11 与 §6 门禁，逐项列出文件/SHA/行号/运行证据；对照表须覆盖 §4.11 表全部 6 行（含“旧 job 再次失败后新 key 可重试、旧 key 摘要不同 CONFLICT”与跨 method 隔离），并列出 G5/G6 未满足项 |

### G4-04 三独立场景（各自独立 fixture 与断言，不得合并计为一条）

1. **(a) 旧 queued job + 新 key**：构造旧 requeue 遗留的 queued job（enroll/revoke 两形状，旧 log/audit 保留，`operation_keys` 无该 job 记录），以新 key 调用严格 retry → `INVALID_STATE/409`；`before/after structuredClone(store.data)` 全库 deepEqual，`operation_keys` 零新增。与 G4-03 互补：G4-03 断言两种 queued 形状被拒，本场景断言拒绝发生在任何 key/回执写入之前。
2. **(b) 旧 job 再次合法失败 + 全新 key → 成功**：将同一旧 job 以合成 fixture 置为 `retryable_failed` 并满足全部前置（权限、revision、attempts、nextAttemptAt、无 lease、cleanupPhase 合法），使用一个从未出现过的全新 key → 成功；写集为严格 retry 的合法写集（job + 1 条 queued log + op key + 0–2 条 domain + 1 条确定性 audit），其他集合内容/排序/计数不变。证据须注明“以合成 fixture 构造 retryable_failed，未验证 worker 真实失败路径”。
3. **(c) 已成功使用的 key 在请求 revision 改变后复用 → CONFLICT**：先用严格 retry 以 key `K` 和 `expectedJobRevision=R` 成功并留下回执（job 推进到 `R+1`），再以同一 `K`、`expectedJobRevision=R+1`（摘要不同）复用 → `CONFLICT/409`；全库 deepEqual 零写，原回执、job、log、audit、op key 均不变。

**口径**：旧 requeue 从未写 `operation_keys`，因此不存在“旧 requeue 的 op key”；不得仅因某键被称为“旧 key”就断言 `CONFLICT`。`CONFLICT` 只适用于**严格 retry 实际创建过**的 op key 被摘要不同的请求复用；场景 (a) 必须断言 `operation_keys` 零新增，场景 (c) 必须先证明该 key 由严格 retry 创建并有回执。

## 5. 断言方法（按证据类型区分）

- **存储类场景（G4-03～G4-07）**：`before = structuredClone(store.data)` / `after = structuredClone(store.data)`，失败与重放全库 `deepEqual`；错误同时断言 `code` 与 `status`；成功用例验证完整预期写集，其他集合内容/排序/计数不变，不以记录数代替内容断言。
- **静态/原型/导出面类（G4-01、G4-02 静态部分）**：导出键枚举 + 原型链 `getOwnPropertyDescriptor` + 源码扫描（先剥离注释）+ guard 入口计数；不适用 `store.data` 前后比较。
- **路由封闭（G4-02 运行时部分）**：`FACE_ROUTES` id 集合断言 + `matchFaceRoute` 负向匹配；不启动监听。
- 预期 ID 一律用冻结公式或固定向量独立推导，不复制实现常量。

## 6. 执行与证据

- 交付：实际命令、工作目录、退出码、逐文件计数、负向控制、矩阵逐项证据（文件/SHA/行号/运行证据）、生产文件零 diff、`git diff --check`、最终 SHA/父提交。
- 证据文档须含：基线与谱系核验（含 shallow 状态）、验收指针引用、设计取件核对、testkit 复用与 fixture 独立性声明、guard 入口数与正控结果。
- **提交纪律**：只追加提交，不改既有提交；**不 amend / rebase / squash / reset / force**；普通 push 结果分支（分支名批准时指定），push 后 `ls-remote` 核对；不合并任何分支。
- **结论口径**：PASS / FAIL / BLOCKED；任一 G4 项未获证即整体 BLOCKED，不得条件 PASS、不得自称 07D 关闭或可上线；交付后停手等 Codex 独立复审。

## 7. 当前停止点

本修订只改本卡，未执行审查或测试，未改生产代码，未注册或启动 HTTP，未合并、未部署。G4 执行、C1 实现、C2/C3、main/07B 合并、HTTP/UI、部署与上线继续冻结。批准本卡不自动批准后续集成或接线。

## 8. 修订记录（v1 → v3；第 1–9 行为 v2，第 10 行为 v3）

| # | 复审问题（级别） | 修订位置 | 验收要求 |
|---|---|---|---|
| 1 | 运行时证据闭环 / 必需独立 G4 测试与 testkit 范围（P2） | 前置行、§2、§3、G4-01 | G4 测试为必需且含独立运行时断言；testkit 仅复用 guard/store；证据声明 |
| 2 | 旧 key 摘要冲突与跨 method 隔离（P2） | G4-04、G4-05、G4-08 | 两条断言均出现在证据表；§4.11 表 6 行逐行对照 |
| 3 | 逐文件允许回归清单（P2） | §3 | 仅 6 个文件；无 glob/npm test；追加须先批 |
| 4 | 验收指针与谱系（P3） | §0 | 证据记录基线/验收/谱系/shallow 状态 |
| 5 | 兼容 fixture 独立（P3） | §3 | 不 import/复制 O11；声明独立构造 |
| 6 | 提交纪律与 BLOCKED 口径（P3） | §6 | 无 amend/rebase/force；未证即 BLOCKED |
| 7 | 跨分支设计取件（P3） | §0 | 取 `51e2453d` 并核对 796 行/锚点，失败即 BLOCKED |
| 8 | 静态与存储断言区分（P3） | §5 | 按证据类型分别执行并记录 |
| 9 | 无监听路由匹配（P3） | G4-02 | `FACE_ROUTES`/`matchFaceRoute`/guard 三重断言 |
| 10 | 续派 A：G4-04 三独立场景与“旧 key”口径（v2 → v3） | 标题/状态、G4-04、§3、§8 | 三场景各自 fixture 与断言；旧 queued+新 key→INVALID_STATE/409 零写；旧 job 合法再失败+全新 key→成功；严格 retry 已用 key 改 revision 复用→CONFLICT/409 零写；旧 requeue 无 op key 不得臆断冲突 |
