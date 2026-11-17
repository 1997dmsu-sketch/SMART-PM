# HK-AI-07D G3 冻结矩阵验证任务卡（草案 · 修订版 · 待独立审批）

- 日期：2026-11-17（Asia/Shanghai）。
- 状态：**草案 · 修订版，待用户 / Codex 独立审批**。本卡的准备与提交不表示 G3 已开始、已执行或已通过；未经批准不得据本卡开展实施。本卡**不启动实施**，不新建实施分支、不改生产代码。修订依据：用户 2026-11-17 对初版草案 `c120d1b` 的三项裁定 + 四项修正（见 §6 修订记录）。
- 目的：在 G1 旧 requeue 入口封闭、G2 严格 `retry` 服务实现并分别独立验收通过的基线上，执行设计 §5 的 90 条冻结测试矩阵，证明 G2 服务满足 §4 全部冻结契约，为 G4 兼容/封闭审查提供完整、可复跑、可证伪的验证证据。
- 定位（设计 §6 门禁表）：G3 = 「§5 矩阵 90 条可执行并通过」，位于 G2（服务实现）之后、G4（兼容/封闭审查）之前。**G3 通过不等于 G4 通过，也不等于 07D 全量关闭或可上线**。
- **实施基线（固定）**：`c8290db0c22bf5e84ceede2d58b6daad7ce2887b`（G2 收尾提交，含首次 domain 重放正例与计数统一；父提交 `b3a41eaabf59e84a2f99babfee2f0c45ac418f49` 为 G2 独立复审通过验收提交）。被测实现为 `admin-web/lib/face-service/retry.mjs`。**90 是矩阵 ID 数，不是测试函数条数**：每行 ID 允许含多个子场景，实际测试函数/exit 计数另报，不以「恰好 90 个 test()」为目标（见 §4）。
- 设计依据（oracle）：`docs/tasks/HK-AI-07D-RETRY-REQUEUE-DESIGN-2026-11-15.md`（796 行，2026-11-16 技术复审通过；来源提交 `51e2453`，位于未合并的 `docs/hk-face-retry-requeue-design` 分支，跨分支只读引用，不得误认作当前分支已批准文档）§4.1–§4.13、§5（§5.1 记号 + §5.2–§5.9 八系列 + §5.10 对照）、§6、§7 追溯矩阵、附录 A（字段与 ID 公式，冻结）、附录 B。矩阵定义仅存在于该设计提交，**当前验收分支工作树内无此文件**。

## 前置门禁（设计 §6；状态为草案准备时实测）

| 门禁 | 内容 | 当前状态 |
|---|---|---|
| G0 | 本设计获 Codex 批准 | 已获技术复审通过（2026-11-16）；仅限设计 |
| G1 | 旧 `h3b.requeue`/`h4b.requeue` 封闭 | 已通过独立验收，提交 `4f9c43d`，验收结论保持 |
| G2 | 严格 `retry` 服务实现 | 已通过独立验收，验收 `b3a41ea` / 收尾 `c8290db`；**本卡固定实施基线** |
| G3 | §5 矩阵 90 条可执行并通过 | **本卡目标**；草案修订版，未开始，不宣称已通过 |
| G4 | 兼容/封闭审查：旧日志/审计/queued 不误用、无迁移/回填 | 未开始；O10/O11 计入本卡 90 条（按用户裁定），**G4 后续独立复核，不因 G3 覆盖而免验** |
| G5 | 07B `queryJob` revision 合并 | 未合并（远端 tip `59a737a` 已终审）；服务层矩阵以服务返回值为准，**非 G3 硬前置** |
| G6 | HTTP 编码卡批准 + `routes.mjs`/`server.mjs` 登记 | 未批准；**本卡不注册任何路由、不启动 HTTP**；错误 code/status 只在服务层断言 |

## 1. 范围和禁止项

本卡仅**执行/新增** G3 服务层 90 条矩阵测试与配套证据。验证对象是 G2 已实现的 `retry` 服务；**测试若暴露服务缺陷，回退给 G2 修复并另立任务，不在 G3 修改契约或生产代码**。

允许变更（批准后生效，独立工作树、独立分支，从固定基线 `c8290db` 起，不混入其他功能）：

| 文件 | 允许范围 |
|---|---|
| `admin-web/tests/face-<...>-matrix.test.mjs`（新增，文件名实施时定） | 90 条服务层矩阵用例，全合成 fixture；可按八系列分文件，但 ID 必须 P01–P13 / S01–S16 / R01–R09 / K01–K16 / T01–T06 / C01–C09 / O01–O13 / N01–N08 连续编号、每条有预期；每行可含多个子场景 |
| `docs/tasks/HK-AI-07D-G3-MATRIX-EVIDENCE-2026-11-17.md`（新增） | 证据文档：逐条 ID → 预期 → 实测 → 写集 → 前置依赖，及 §5.10 覆盖对照 |

明确禁止：

- 不修改 `retry.mjs`/`collections.mjs`/`h3a.mjs`/`h3b.mjs`/`h4b.mjs`/`service.mjs`/`store.mjs`/`model.mjs`/`routes.mjs`/`server.mjs` 等任何现有生产文件；若发现必须改才能满足契约，**先停下并报告，另立任务，不夹带修改**。
- 不注册 HTTP、不改 `routes.mjs`/`server.mjs`、不开放 HTTP/UI（G6 门禁）；**不启动 HTTP 服务、不监听任何端口、不发起任何业务网络请求**（见 §4 网络 guard）。
- **E07 描述行的清理由独立小提交另案处理**（设计 §4.11:510 / 07A Q8）；**本卡不得夹带该清理**，O10 该项按 §3「blocked」处理。
- 不合并 `main`、不合并 07B `59a737a`（G5 门禁）；不合并 G4、不提前做兼容审查的 rewrite。
- 不调用 Provider/设备/生产云；不实现自动重试、定时器、后台调度、`Retry-After`（T06 只做源码审计 + 副作用探针）。
- 不实现 reconcile（E08）/finalize-retry（E09）；不开始 H4-c C2/C3；不改 K3、不执行初始化/迁移。
- 不迁移、不回填、不重写旧 job/log/audit/op key；不把旧 requeue 结果当作新 K2 成功。
- 不新增状态名、错误码、权限点；不改 job schema/validator/state/DTO（只复用、只断言）。
- 不修改 G1/G2 验收提交及其历史；不 amend / rebase / squash / reset / force。

## 2. 冻结契约（验证 oracle，不得自行发明或放宽）

G3 是验证阶段，契约即 oracle，测试断言必须逐条对齐下列冻结项（均出自设计 §4 与附录 A）：

1. **90 条的构成**（§5.10）：P13+S16+R9+K16+T6+C9+O13+N8 = **90 个矩阵 ID**。数量是八系列**相加**，不是维度相乘；90 指 ID 数，每行可含多个子场景，实际测试函数计数另报。文中「事务 refs（固定 8 条，去重后 ≤90）」（§4.5）是**无关概念**，不得混入矩阵计数。
2. **记号与统一失败断言**（§5.1）：`Z`=全库内容级零变化（所有集合记录/排序 ID/计数不变）；`J+L+O+D+A`=成功写集（job + 1 queued log + op key + 0–2 domain + 1 确定性 audit）；`P0`=Provider 调用恒 0。每个失败行同时断言：无 500、无 stack、无配置值、无 Provider、无设备/网络调用、`store.data` 前后 `deepEqual`。
3. **错误断言必须同时检查 `code` 与 `status`**（用户修订 3）：每条失败用例**同时**断言服务层错误的 `err.code`（冻结错误码）与 `err.status`（冻结状态码映射），二者缺一不可；DOMAIN_* 强制 status=409、NOT_FOUND=404、FORBIDDEN=403、PARAM_ERROR=400、CONFLICT/INVALID_STATE/INVALID_JOB/REVISION_CONFLICT/RETRY_NOT_DUE=409、NOT_CONFIGURED/ADAPTER_UNAVAILABLE=503（§4.10）。**status 是契约断言项，不得降为「仅说明文本」**；无需启动 HTTP 即可在服务层返回值上断言。
4. **response DTO**（§4.9.1）：精确五字段 `jobId/state/revision/attempts/nextAttemptAt`，无额外键（O01/O07）、无敏感字段（O03–O06）、错误同态 404（O09）。
5. **四类白名单**（§4.9.2–4.9.4）：log 精确 15 字段、op key 六字段、回执五字段、audit 七字段；存储元数据 `_id`/`updatedAt` 只允许出现在外层 Store 记录，不得进入嵌套回执（含值为 undefined 的键，按键存在判断）。
6. **K2 与 domain**（§4.4）：method `face.operation.retry`；requestDigest v1 仅含 `{jobId, expectedJobRevision}`；op key 六字段、result 精确五字段；严格重放先复核权限/K2/audit，回执绑定 `expectedJobRevision + 1`；合法重放 `return []`（零写、不新增 audit）；domain 全缺写 head+version 两条，单边缺/换钥失败关闭。
7. **校验顺序**（§4.5，14 步冻结）：同一失败只返回最先命中的码；状态门禁先于 validator、先于 revision；权限预读定优先级、事务内权威复核；Idempotency-Key 格式校验前置。
8. **状态与错误码**（§4.2/§4.10）：逐状态拒绝表逐行（S01–S16）；错误只用 §4.10 既有 12 码 + 固定短语消息，不新增码/状态名/权限点。
9. **时间与时钟**（§4.7）：可信时钟为唯一时间源；`now===nextAttemptAt` 算到期；body 传 `now/nextAttemptAt/delay/backoff/force` → PARAM_ERROR；溢出统一 INVALID_JOB。
10. **确定性公式**（附录 A，冻结）：K2 method、op key、requestDigest、queued log ID、audit ID 的构造公式是 ID/摘要类断言的唯一 oracle；测试按公式独立重算，不复制实现常量。
11. **执行期 oracle**（§5.1）：服务层返回值是判定通过与否的真值；HTTP 200/403/404/409/503 仅作与第 3 条 status 的映射对照，不启动 HTTP。

## 3. 验收矩阵（G3-LC 清单，对应设计 §5 八系列 90 条）

卡内以 `G3-<系列><序号>` 编号，逐条对齐设计 §5.2–§5.9；下表按系列汇总，实施时展开为 90 条逐行证据（每条 ID 可含多个子场景，实际计数另报）。

| 系列 | 范围（条数） | 覆盖 | 必须证明 |
|---|---|---|---|
| G3-P | P01–P13（13） | 权限、组织、成员、跨组织、撤销后重放、actorType | 有权限成功、各缺权限/失效/跨组织/主体不符/actorType≠user 一律 FORBIDDEN 或同态 404 且零写；撤销后同键重放不得命中旧回执 |
| G3-S | S01–S16（16） | 六种状态逐一拒绝、finalize 边界、异常分类、validator 归一化 | enroll/revoke 两形状成功写集；逐状态冻结码；状态门禁先于 validator；validator 内部码归一化为 INVALID_JOB 不泄露；**S09 只验证 finalize 阶段被拒（见裁定 2）** |
| G3-R | R01–R09（9） | revision CAS、类型、旧名、溢出、额外字段 | 相等成功、落后/超前 REVISION_CONFLICT、非法/旧名/额外字段 PARAM_ERROR、溢出 INVALID_JOB |
| G3-K | K01–K16（16） | K2、domain、严格重放、异摘要、损坏、回执 revision 篡改、audit 成对性 | key 格式、op key 六字段、同键零写重放、异摘要/篡改 CONFLICT、K2 非法 NOT_CONFIGURED、domain 三态、audit 缺失/预占 CONFLICT |
| G3-T | T01–T06（6） | 到期边界、时钟、溢出/无 override、无定时器 | 等号到期成功、未到期 RETRY_NOT_DUE、时钟非法 503、无定时器/自动重试（源码审计 + 副作用探针） |
| G3-C | C01–C09（9） | 并发、claim/lease、reconcile、ack loss、callback | 同键两并发一次迁移、异键一胜、claim 先后置（**C03/C04 用真实 claim helper，见修订 4**）、fence lease 零改、事务 callback 重跑/预占回滚；**C05 只测 retry 侧（见裁定 1）** |
| G3-O | O01–O13（13） | 五字段 DTO、四类白名单、敏感字段、同态 404、旧入口封闭、兼容 | 响应/日志/审计/op key 精确字段 + 敏感扫描；**O10 含一项 blocked（见下）、O11 计入 G3（见裁定 3）** |
| G3-N | N01–N08（8） | 八类失败零写 | 八类失败各返回冻结码 + 冻结 status 且 Provider 0、全库 Z |

**统一验证手法**：每条独立场景执行 `before = structuredClone(store.data)` / `after = structuredClone(store.data)` + `deepEqual`（零写类）；成功类逐字段断言写集内容级正确；失败类按 §2 第 3 条同时断言 `err.code` 与 `err.status`。全部合成 fixture，无真实人员/设备/组织/凭据/AppID/商户号。

### 三项裁定的落实（用户 2026-11-17）

1. **C05（裁定 1）**：只验证 retry 侧——构造 `awaiting_result` job 调用 retry，断言 `INVALID_JOB/409`（code + status）+ 全库 Z；证据与用例名中**明确标注**「E08 未实现，未验证真实 reconcile 并发交互」。不实现、不调用 reconcile。
2. **S09（裁定 2）**：只验证 `cleanupPhase=finalize` 的 `retryable_failed` job 被 retry 拒绝，断言 `INVALID_STATE/409`（code + status）+ 全库 Z；**不要求实现 E09**。
3. **O10/O11（裁定 3）**：两条均计入 G3 的 90 条；**G4 后续独立复核，不因 G3 已覆盖而免验**（证据文档须注明「G3 覆盖不替代 G4 独立复核」）。

### O10 真实阻断（用户修订 1，须标 blocked，不得计 PASS）

O10 冻结预期含三子项：①无旧 `requeue` 可调用入口；②`server.mjs` 无 `/retry` 分支；③**E07 描述行已按 Q8 清理**。只读核实（固定基线 `c8290db`）：

- ① 成立：`admin-web/lib` 全目录无 `requeue` 可调用入口（仅 `retry.mjs:4` 注释含设计文档路径字样）。
- ② 成立：`admin-web/server.mjs` 无 `/retry` 分支。
- ③ **不成立（阻断）**：`admin-web/lib/face-service/routes.mjs:47-53` 仍保留 `device-operation-job-retry` 路由描述行（`POST /api/v2/device-operation-jobs/:jobId/retry` + `device.operation.retry`）。设计 §4.11:510 明确该行「按 07A Q8 的**独立小提交**执行，不夹带业务变更」，当前尚未清理。

**处理**：O10 整体标记 **blocked**（子项 ①② 可作为已通过的局部证据单独记录，但不代表 O10 通过）。不得删减第 ③ 子项断言、不得计为 PASS。待独立清理任务完成该描述行后，用同一 O10 用例复验通过，方可将 O10 状态由 blocked 改为 pass。**blocked 不阻断其余 89 条执行与交付**，但 G3 最终结论须如实声明「O10 blocked，待独立清理任务后复验」，不得宣称 90/90 全通过。

### 前置依赖分类（只读核实 + 用户裁定后的最终口径）

固定基线 `c8290db` 上：`h3a.mjs:222 buildClaimPlan` / `:274 claimDispatchJob` 是真实存在的 LocalStore-only claim helper（不调 Provider）；lease/fence 已实现（`h3a.mjs:262`、`collections.mjs:489`）；E08 reconcile 状态机任何分支均未实现；E09 finalize-retry（07D 语义）未实现。最终口径：

- **可直接执行（86 条）**：P01–13、S01–16、R01–09、K01–16、T01–06、C01/02/06/07/08、O01–09/11–13、N01–08，含 C05/S09 按裁定 1/2 的 retry 侧断言。
- **真实交互验证（C03/C04/C09，3 条）**：**使用 h3a 已有真实 claim helper**（`claimDispatchJob` 先/后置）构造 claim 交互，验证 retry 与 claim 的先后行为（C03 retry 先提交→claim 读 queued/attempts+1/清 due/result；C04 claim 先产生 sending→retry 拒绝；C09 fence lease 三字段零改）。**不得仅手改 job 状态代替真实 claim 交互验证**（用户修订 4）。
- **blocked（O10，1 条）**：见上。
- 计数校验：86 + 3（C03/C04/C09 归入 C 系列已计）+ O10 blocked（仍占 1 个 ID）= 90 个 ID；C03/C04/C09 已含在 C 系列 9 条内，不重复计数。

## 4. 执行与交付（批准后生效）

在独立工作树完成依赖安装后执行并记录实际命令、工作目录、exit 与计数。**删除 `npm test` 全量后台要求**（用户修订 2）：不运行 admin-web 与仓库根的全量 `npm test`（其 glob 会拉入 HTTP 套件），改为**明确列举的非 HTTP 套件**，并安装网络 guard。

明确列举的非 HTTP 套件（实施时以实际文件名核对，均为无 server 监听的单元/服务层测试）：

```text
# admin-web：仅以下非 HTTP 套件（逐文件显式列出，不用 tests/*.test.mjs glob）
node --test \
  tests/face-strict-retry.test.mjs \
  tests/face-<G3 矩阵文件 A>.test.mjs \
  tests/face-<G3 矩阵文件 B>.test.mjs   # 按实际拆分列出全部矩阵文件

# 复查既有非 HTTP 回归（可选，需逐个确认无 HTTP 监听后列入）
# 如 tests/face-h3a.test.mjs / face-h4b.test.mjs / store-deterministic-audit.test.mjs 等

# 仓库根：仅非 HTTP 套件（显式列出，不跑 npm test 全量）
node --test tests/<非 HTTP 套件...>.test.cjs

git diff --check
```

**禁止监听及业务网络的 guard（用户修订 2，必须安装并留证）**：在矩阵测试入口安装 guard，对 `net.createServer`/`server.listen`/`http.request`/`https.request`/`fetch`/`dns.lookup`/`net.connect` 等打桩并计数；任何一次调用即令用例失败并打印调用栈。guard 须在 `before` 安装、`after` 精确恢复原函数身份（沿用 G2 `face-strict-retry.test.mjs` LC10 探针手法），并提供**正控**（故意触发一次，确认计数 +1 被捕获、随后恢复），防止探针失效造成假阴性。证据文档记录 guard 覆盖的入口清单与正控结果。

矩阵测试文件命令以实施时实际文件名替换；若按八系列分文件，需给出每个文件的命令与条数小计，ID 小计之和必须为 90（实际测试函数计数另报，不要求恰好 90）。首选默认测试隔离；确有 EPERM 时保留失败记录、可补 none 降级证据但不得伪报默认隔离通过。锁文件与依赖清单零差异，不用 stub/native 跳过掩盖依赖问题。

交付证据必须包含：

- 固定基线 `c8290db` / 分支 / 父提交 `b3a41ea` / 最终 SHA；逐条 90 行证据表（ID → 前置/注入 → 预期 code+status → 实测 → 写集 Z 或 J+L+O+D+A → 状态 pass/blocked）；§5.10 八系列 ID 对照与合计 90 的核对，实际测试函数计数另报。
- 非 HTTP 套件的显式命令/exit/实际计数；零写内容级证据、敏感字段扫描、四类白名单断言、错误 code+status 双断言证据、可证伪（反向补丁）证据、网络 guard 入口清单与正控结果。
- 三类前置口径（可直接执行 / C03-C04-C09 真实 claim 交互 / O10 blocked）的实际处理记录，三项裁定（C05/S09/O10-O11）的落点，O10 blocked 的取证与复验前置条件。
- 对 `retry.mjs` 等所有现有生产文件的零差异证明；发现缺陷回退 G2、另立任务，不顺带修改。
- 追加提交，普通 push 并以 `git ls-remote` 核对；不 amend / rebase / squash / reset / force，不改变既有批准提交。交付后停手，等待 G3 独立复审；不自行开始 G4。

## 5. 本轮文档来源与状态

- 设计来源提交 `51e2453`（`docs/hk-face-retry-requeue-design`，796 行，未合并；`git am` 导入后 SHA 可能因 committer 元数据不同，不声称相同）。设计 §4.11:510 与 07A Q8 规定 E07 描述行由独立小提交清理。
- G1 验收提交 `4f9c43dfc313187b5fa971cb132dce29c294c286`；G2 验收提交 `b3a41eaabf59e84a2f99babfee2f0c45ac418f49`；固定实施基线（G2 收尾）`c8290db0c22bf5e84ceede2d58b6daad7ce2887b`。
- 本卡为**草案修订版**：仅修订文档，未执行 90 条矩阵、未改生产代码、未注册 HTTP、未清理 E07 描述行、未合并分支、未开始 G4；G4、main/07B 合并、HTTP/UI、上线继续冻结。批准后方可开展实施。

## 6. 修订记录（对初版草案 c120d1b）

用户 2026-11-17 裁定与修正，逐条落实：

| # | 要求 | 落实位置 |
|---|---|---|
| 裁定 1 | C05 只验 retry 侧 INVALID_JOB/409 + 全库零写，标注「E08 未实现，未验证真实 reconcile 并发交互」 | §3 裁定 1、G3-C 行 |
| 裁定 2 | S09 只验 finalize 阶段被拒 INVALID_STATE/409，不要求 E09 | §3 裁定 2、G3-S 行 |
| 裁定 3 | O10/O11 均计入 G3；G4 后续独立复核，不因 G3 覆盖免验 | §3 裁定 3、门禁表 G4 行 |
| 修正 1 | O10 因 routes.mjs E07 描述行未清理标 blocked，待独立清理任务后复验；不删断言、不计 PASS | §3「O10 真实阻断」、`routes.mjs:47-53` 取证 |
| 修正 2 | 删除全量 `npm test`，改显式非 HTTP 套件 + 禁止监听/业务网络 guard（含正控） | §4 命令块与 guard 段、G6 禁止项 |
| 修正 3 | 错误断言同时检查 code + status，status 不降为纯说明，不启动 HTTP | §2 第 3 条、§3 统一验证手法 |
| 修正 4 | 固定实施基线 c8290db；90 为矩阵 ID 数、每行可多子场景、实际计数另报；C03/C04 用真实 claim helper 不手改状态 | 前言基线行、§2 第 1 条、§3 前置分类、§4 |
