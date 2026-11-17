# HK-AI-07D G3 冻结矩阵验证任务卡（草案 · 待独立审批）

- 日期：2026-11-17（Asia/Shanghai）。
- 状态：**草案，待用户 / Codex 独立审批**。本卡的准备与提交不表示 G3 已开始、已执行或已通过；未经批准不得据本卡开展实施。本卡**不启动实施**，不新建实施分支、不改生产代码。
- 目的：在 G1 旧 requeue 入口封闭、G2 严格 `retry` 服务实现并分别独立验收通过的基线上，执行设计 §5 的 90 条冻结测试矩阵，证明 G2 服务满足 §4 全部冻结契约，为 G4 兼容/封闭审查提供完整、可复跑、可证伪的验证证据。
- 定位（设计 §6 门禁表）：G3 = 「§5 矩阵 90 条可执行并通过」，位于 G2（服务实现）之后、G4（兼容/封闭审查）之前。**G3 通过不等于 G4 通过，也不等于 07D 全量关闭或可上线**。
- 代码基线（被测对象）：G2 验收提交 `b3a41eaabf59e84a2f99babfee2f0c45ac418f49`（合并态，独立复审通过），收尾提交 `c8290db0c22bf5e84ceede2d58b6daad7ce2887b`（首次 domain 重放正例 + 计数统一）。被测实现为 `admin-web/lib/face-service/retry.mjs`，分支 `feat/hk-face-strict-retry`（只读引用，不在其上实施）。
- 设计依据（oracle）：`docs/tasks/HK-AI-07D-RETRY-REQUEUE-DESIGN-2026-11-15.md`（796 行，2026-11-16 技术复审通过；来源提交 `51e2453`，位于未合并的 `docs/hk-face-retry-requeue-design` 分支，需跨分支只读引用，不得误认作当前分支已批准文档）§4.1–§4.13、§5（§5.1 记号 + §5.2–§5.9 八系列 + §5.10 对照）、§6、§7 追溯矩阵、附录 A（字段与 ID 公式，冻结）、附录 B。矩阵定义仅存在于该设计提交，**当前验收分支工作树内无此文件**。

## 前置门禁（设计 §6；状态为草案准备时实测）

| 门禁 | 内容 | 当前状态 |
|---|---|---|
| G0 | 本设计获 Codex 批准 | 已获技术复审通过（2026-11-16）；仅限设计 |
| G1 | 旧 `h3b.requeue`/`h4b.requeue` 封闭 | 已通过独立验收，提交 `4f9c43d`，验收结论保持 |
| G2 | 严格 `retry` 服务实现 | 已通过独立验收，验收 `b3a41ea` / 收尾 `c8290db`；**本卡被测对象** |
| G3 | §5 矩阵 90 条可执行并通过 | **本卡目标**；草案，未开始，不宣称已通过 |
| G4 | 兼容/封闭审查：旧日志/审计/queued 不误用、无迁移/回填 | 未开始；O10/O11 内容属 G4 但计入本卡 90 条（见 §3 边界） |
| G5 | 07B `queryJob` revision 合并 | 未合并（远端 tip `59a737a` 已终审）；服务层矩阵以服务返回值为准，**非 G3 硬前置** |
| G6 | HTTP 编码卡批准 + `routes.mjs`/`server.mjs` 登记 | 未批准；**本卡不注册任何路由**，矩阵中的 HTTP 码仅作未来映射 |

## 1. 范围和禁止项

本卡仅**执行/新增** G3 服务层 90 条矩阵测试与配套证据。验证对象是 G2 已实现的 `retry` 服务；**测试若暴露服务缺陷，回退给 G2 修复并另立任务，不在 G3 修改契约或生产代码**。

允许变更（批准后生效，独立工作树、独立分支，从 G2 验收提交起，不混入其他功能）：

| 文件 | 允许范围 |
|---|---|
| `admin-web/tests/face-<...>-matrix.test.mjs`（新增，文件名实施时定） | 90 条服务层矩阵用例，全合成 fixture；可按八系列分文件，但 ID 必须 P01–P13 / S01–S16 / R01–R09 / K01–K16 / T01–T06 / C01–C09 / O01–O13 / N01–N08 连续编号、每条有预期 |
| `docs/tasks/HK-AI-07D-G3-MATRIX-EVIDENCE-2026-11-17.md`（新增） | 证据文档：逐条 ID → 预期 → 实测 → 写集 → 前置依赖，及 §5.10 覆盖对照 |

明确禁止：

- 不修改 `retry.mjs`/`collections.mjs`/`h3a.mjs`/`h3b.mjs`/`h4b.mjs`/`service.mjs`/`store.mjs`/`model.mjs`/`routes.mjs`/`server.mjs` 等任何现有生产文件；若发现必须改才能满足契约，**先停下并报告，另立任务，不夹带修改**。
- 不注册 HTTP、不改 `routes.mjs`/`server.mjs`、不开放 HTTP/UI（G6 门禁）；矩阵内 HTTP 码只作「若未来获准接线」的映射说明，执行期一律以服务层返回值为准（§5.1）。
- 不合并 `main`、不合并 07B `59a737a`（G5 门禁）；不合并 G4、不提前做兼容审查的rewrite。
- 不调用 Provider/设备/生产云；不实现自动重试、定时器、后台调度、`Retry-After`（T06 只做源码审计 + 副作用探针）。
- 不实现 reconcile（E08）/finalize-retry（E09）；不开始 H4-c C2/C3；不改 K3、不执行初始化/迁移。
- 不迁移、不回填、不重写旧 job/log/audit/op key；不把旧 requeue 结果当作新 K2 成功。
- 不新增状态名、错误码、权限点；不改 job schema/validator/state/DTO（只复用、只断言）。
- 不修改 G1/G2 验收提交及其历史；不 amend / rebase / squash / reset / force。

## 2. 冻结契约（验证 oracle，不得自行发明或放宽）

G3 是验证阶段，契约即 oracle，测试断言必须逐条对齐下列冻结项（均出自设计 §4 与附录 A）：

1. **90 条的构成**（§5.10）：P13+S16+R9+K16+T6+C9+O13+N8 = **90**。数量是八系列**相加**，不是维度相乘。文中「事务 refs（固定 8 条，去重后 ≤90）」（§4.5）是**无关概念**，不得混入矩阵计数。
2. **记号与统一失败断言**（§5.1）：`Z`=全库内容级零变化（所有集合记录/排序 ID/计数不变）；`J+L+O+D+A`=成功写集（job + 1 queued log + op key + 0–2 domain + 1 确定性 audit）；`P0`=Provider 调用恒 0。每个失败行同时断言：无 500、无 stack、无配置值、无 Provider、无设备/网络调用、`store.data` 前后 `deepEqual`。
3. **response DTO**（§4.9.1）：精确五字段 `jobId/state/revision/attempts/nextAttemptAt`，无额外键（O01/O07）、无敏感字段（O03–O06）、错误同态 404（O09）。
4. **四类白名单**（§4.9.2–4.9.4）：log 精确 15 字段、op key 六字段、回执五字段、audit 七字段；存储元数据 `_id`/`updatedAt` 只允许出现在外层 Store 记录，不得进入嵌套回执（含值为 undefined 的键，按键存在判断）。
5. **K2 与 domain**（§4.4）：method `face.operation.retry`；requestDigest v1 仅含 `{jobId, expectedJobRevision}`；op key 六字段、result 精确五字段；严格重放先复核权限/K2/audit，回执绑定 `expectedJobRevision + 1`；合法重放 `return []`（零写、不新增 audit）；domain 全缺写 head+version 两条，单边缺/换钥失败关闭。
6. **校验顺序**（§4.5，14 步冻结）：同一失败只返回最先命中的码；状态门禁先于 validator、先于 revision；权限预读定优先级、事务内权威复核；Idempotency-Key 格式校验前置。
7. **状态与错误码**（§4.2/§4.10）：逐状态拒绝表逐行（S01–S16）；错误只用 §4.10 既有 12 码 + 固定短语消息，不新增码/状态名/权限点；`DOMAIN_*` 必须携带 status=409。
8. **时间与时钟**（§4.7）：可信时钟为唯一时间源；`now===nextAttemptAt` 算到期；body 传 `now/nextAttemptAt/delay/backoff/force` → PARAM_ERROR；溢出统一 INVALID_JOB。
9. **确定性公式**（附录 A，冻结）：K2 method、op key、requestDigest、queued log ID、audit ID 的构造公式是 ID/摘要类断言的唯一 oracle；测试按公式独立重算，不复制实现常量。
10. **执行期 oracle**（§5.1）：服务层返回值是判定通过与否的真值；HTTP 200/403/404/409/503 仅作映射说明。

## 3. 验收矩阵（G3-LC 清单，对应设计 §5 八系列 90 条）

卡内以 `G3-<系列><序号>` 编号，逐条对齐设计 §5.2–§5.9；下表按系列汇总，实施时展开为 90 条逐行证据。

| 系列 | 范围（条数） | 覆盖 | 必须证明 |
|---|---|---|---|
| G3-P | P01–P13（13） | 权限、组织、成员、跨组织、撤销后重放、actorType | 有权限成功、各缺权限/失效/跨组织/主体不符/actorType≠user 一律 FORBIDDEN 或同态 404 且零写；撤销后同键重放不得命中旧回执 |
| G3-S | S01–S16（16） | 六种状态逐一拒绝、finalize 边界、异常分类、validator 归一化 | enroll/revoke 两形状成功写集；逐状态冻结码；状态门禁先于 validator；validator 内部码归一化为 INVALID_JOB 不泄露 |
| G3-R | R01–R09（9） | revision CAS、类型、旧名、溢出、额外字段 | 相等成功、落后/超前 REVISION_CONFLICT、非法/旧名/额外字段 PARAM_ERROR、溢出 INVALID_JOB |
| G3-K | K01–K16（16） | K2、domain、严格重放、异摘要、损坏、回执 revision 篡改、audit 成对性 | key 格式、op key 六字段、同键零写重放、异摘要/篡改 CONFLICT、K2 非法 NOT_CONFIGURED、domain 三态、audit 缺失/预占 CONFLICT |
| G3-T | T01–T06（6） | 到期边界、时钟、溢出/无 override、无定时器 | 等号到期成功、未到期 RETRY_NOT_DUE、时钟非法 503、无定时器/自动重试（源码审计 + 副作用探针） |
| G3-C | C01–C09（9） | 并发、claim/lease、reconcile、ack loss、callback | 同键两并发一次迁移、异键一胜、claim 先后置、fence lease 零改、事务 callback 重跑/预占回滚（前置依赖见下） |
| G3-O | O01–O13（13） | 五字段 DTO、四类白名单、敏感字段、同态 404、旧入口封闭、兼容 | 响应/日志/审计/op key 精确字段 + 敏感扫描；O10/O11 封闭与兼容断言 |
| G3-N | N01–N08（8） | 八类失败零写 | 八类失败各返回冻结码且 Provider 0、全库 Z |

**统一验证手法**：每条独立场景执行 `before = structuredClone(store.data)` / `after = structuredClone(store.data)` + `deepEqual`（零写类）；成功类逐字段断言写集内容级正确。全部合成 fixture，无真实人员/设备/组织/凭据/AppID/商户号。

### 前置依赖分类（只读核实，需独立审批裁定处理口径）

调研已核实：G2 验收提交 `c8290db` 上，`h3a.mjs` 已实现 `buildClaimPlan`/`claimDispatchJob`（LocalStore-only、不调 Provider）与 lease/fence；`h4b.mjs` 有 H4-b 自身 finalize（**非** E09）；E08 reconcile 状态机在任何分支均未实现；E09 finalize-retry（07D 语义）未实现。据此 90 条分三类：

- **A 类 84 条**：纯服务层 + 合成 store 可直接执行（P01–13、S01–08/10–16、R01–09、K01–16、T01–06、C01/02/06/07/08、O01–09/11–13、N01–08）。
- **B 类 4 条**：需构造前置状态即可，不调用未实现模块——C03/C04/C09（调用或模拟已实现的 claim/lease）、O10（静态封闭检查，「封闭后」口径建议随 G4 确认）。
- **C 类 2 条**：C05（reconcile 交互，E08 未实现）、S09（finalize-retry 能力，E09 未实现）。**但两者的 retry 侧都可执行且正好覆盖矩阵预期返回值**（C05 → INVALID_JOB、S09 → INVALID_STATE，均 + 零写）。

**需独立审批裁定**：
1. C05 是否接受「只测 retry 侧 + 标注 E08 未实现、不测 reconcile 真实交互」；否则需先批准 E08，超出本卡范围。
2. S09 按「当前可执行（retry 侧已覆盖预期）」处理，还是要求 E09 成功路径（后者超范围）。
3. O10/O11 内容属 G4 但计入本卡 90 条：确认「计入 G3、不与 G4 重复或漏项」的处理方式，避免 G4 重跑时口径冲突。

## 4. 执行与交付（批准后生效）

在独立工作树完成依赖安装后执行并记录实际命令、工作目录、exit 与计数：

```text
# admin-web（定向矩阵 + 全量）
node --test tests/<G3 矩阵测试文件>.test.mjs
npm test

# 仓库根
npm test
git diff --check
```

矩阵测试文件命令以实施时实际文件名替换；若按八系列分文件，需给出每个文件的命令与条数小计，小计之和必须为 90。首选默认测试隔离；确有 EPERM 时保留失败记录、可补 none 降级证据但不得伪报默认隔离通过。锁文件与依赖清单零差异，不用 stub/native 跳过掩盖依赖问题。

交付证据必须包含：

- 基线/分支/父提交/最终 SHA；逐条 90 行证据表（ID → 前置/注入 → 预期 → 实测 → 写集 Z 或 J+L+O+D+A）；§5.10 八系列条数对照与合计 90 的核对。
- 定向、Admin 全量、根测试命令/exit/实际计数；零写内容级证据、敏感字段扫描、四类白名单断言、可证伪（反向补丁）证据。
- 对 A/B/C 三类前置的实际处理记录，以及独立审批对 §3 三项裁定点的结论落点。
- 对 `retry.mjs` 等所有现有生产文件的零差异证明；发现缺陷回退 G2、另立任务，不顺带修改。
- 追加提交，普通 push 并以 `git ls-remote` 核对；不 amend / rebase / squash / reset / force，不改变既有批准提交。交付后停手，等待 G3 独立复审；不自行开始 G4。

## 5. 本轮文档来源与状态

- 设计来源提交 `51e2453`（`docs/hk-face-retry-requeue-design`，796 行，未合并；`git am` 导入后 SHA 可能因 committer 元数据不同，不声称相同）。
- G1 验收提交 `4f9c43dfc313187b5fa971cb132dce29c294c286`；G2 验收提交 `b3a41eaabf59e84a2f99babfee2f0c45ac418f49`，收尾 `c8290db0c22bf5e84ceede2d58b6daad7ce2887b`。
- 本卡为**草案**：仅准备文档，未执行 90 条矩阵、未改生产代码、未注册 HTTP、未合并分支、未开始 G4；G4、main/07B 合并、HTTP/UI、上线继续冻结。批准后方可开展实施。
