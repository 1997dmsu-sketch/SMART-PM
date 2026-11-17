# HK-AI-07D G2 严格 retry 服务——交付证据

- 日期：2026-11-16（Asia/Shanghai）。
- 状态：初版 `67be0c7` 经独立复审发现 3 项 P1 + 5 项 P2，本轮已逐项修复并补回归测试，追加提交后待再次独立复审。本文交付**不表示** G2 已被 Codex 验收、**不表示** 07D 全量关闭、**不表示**可上线。
- 依据：批准的实施卡 `d16e7005ac4364bd6a1ae87066c1db150cd1f0ed`（`docs/tasks/HK-AI-07D-G2-STRICT-RETRY-TASK-2026-11-16.md`），由用户明确批准；设计依据 `docs/tasks/HK-AI-07D-RETRY-REQUEUE-DESIGN-2026-11-15.md`（提交 `51e2453`，796 行，已技术复审），经 `git show origin/docs/hk-face-retry-requeue-design:...` 只读读取，未合并文档分支。
- 批准原文关键约束：合法重放先复核权限/K2/audit、回执绑定 `expectedJobRevision+1`、零写含不新增 audit、存储元数据与语义字段分离校验；仅新增独立模块/测试/证据，需改现有生产文件时停下报告；不授权 G3/G4、不合并 main/07B、不开放 HTTP/UI。

## 1. 基线、分支与谱系

| 项 | 值 |
|---|---|
| 代码基线（父提交） | `4f9c43dfc313187b5fa971cb132dce29c294c286`（G1 验收提交，两项 P2 关闭） |
| 实施分支 | `feat/hk-face-strict-retry` |
| 隔离工作树 | `.tmp-g2-strict-retry`（`git worktree add`，`core.autocrlf=false`） |
| 最终提交 SHA | 见第 9 节交付回报（含本证据文档的提交；普通 push 后以 `git ls-remote` 复核） |
| 提交方式 | 追加提交；未 amend、未 rebase、未 squash、未 reset、未 force push |
| G1 验收提交 | 保持 `4f9c43d` 不变，未追加、未改写 |
| 07B / G5 | 未合并 `59a737a`，不依赖、不修改 07B queryJob |
| G3 / G4 / H4-c C2/C3 / K3 | 未开始、未实现、未执行初始化或迁移 |
| HTTP / UI / 小程序 | 未修改、未注册任何路由 |

## 2. 变更文件清单（相对基线仅下列 3 个新增文件）

| 文件 | 变更性质 |
|---|---|
| `admin-web/lib/face-service/retry.mjs` | 新增：严格 retry 服务 `StrictRetryService`（独立模块）；仅 import 复用 `model.mjs`/`collections.mjs`/`h3a.mjs`/`h4b.mjs`/`store.mjs`，不修改被复用文件 |
| `admin-web/tests/face-strict-retry.test.mjs` | 新增：G2-LC01–LC10 服务层契约测试（38 顶层用例 / 118 含子用例，含复审 8 组 20 条回归）；全合成 fixture |
| `docs/tasks/HK-AI-07D-G2-STRICT-RETRY-EVIDENCE-2026-11-16.md` | 本证据文档 |

对 `h3a.mjs`/`h3b.mjs`/`h4b.mjs`/`service.mjs`/`collections.mjs`/`store.mjs`/`routes.mjs`/`server.mjs`/`model.mjs` 及小程序：`git diff --name-only 4f9c43d..HEAD` 与工作区 `git status --short` 均只含上述 3 个新增文件，既有生产文件零差异。

依赖：`npm install --no-audit --no-fund` 曾规范化 `admin-web/package-lock.json`，已 `git restore`，最终相对基线零差异；未用 stub/native 跳过依赖问题。

## 3. 实现要点与冻结契约对照

`StrictRetryService` 构造 `{ store, orgId, actor, now?, env? }`，方法 `retry(jobId, body, headers)`，其中 `body` 只允许 `expectedJobRevision`、`headers` 只允许 `idempotencyKey`。

| 冻结契约（实施卡 §2） | 实现落点 |
|---|---|
| 1 方法命名 `retry`，无 requeue | 导出 `StrictRetryService.retry`，无 requeue 别名/转发 |
| 2 唯一合法前置九条 | `stateGate`(状态) + validator + `shapeGate`(形状/分类/预算/租约/CAS) + `#authorize` + K2 重放 |
| 3 成功固定 queued、Provider 0、attempts 不增 | 写集 `state:"queued"`、无 Provider 调用、attempts 原值 |
| 4 两种 job 相反 queued 不变量 | `jobPatch` 按 action 分支：enroll 保留 result/nextAttemptAt；revoke 清空两者 |
| 5 K2 独立 method、requestDigest 两字段、domain、六字段 op key、严格重放 | `REQ_METHOD="face.operation.retry"`、`digestOf({jobId,expectedJobRevision})`、`applyOperationKeyDomain`、op key 六字段快照 |
| 6 校验顺序（14 步）、状态先于 validator | 事务内严格按 2-4→6→7→8→9→10→11-13→14 编排；重放(7)在状态门禁(9)前 |
| 7 冻结错误码、固定短语消息 | 仅 §4.10 既有码；消息不含存在性/org/设备/内部字段 |
| 8 时间门禁、可信时钟、溢出 | now 安全整数≥0、回拨 503、`now>=nextAttemptAt`、newRevision 溢出 INVALID_JOB |
| 9 事务原子性、8 refs、J+L+O+D+A、audit 新命名空间 | 固定 8 refs、`deterministicLogId`、`audit-07d-v1:` + `HK-AI-07D retry`、合法重放 `return []` |
| 10 公开 DTO 精确五字段 | 回执重建为 `{jobId,state,revision,attempts,nextAttemptAt}` |

### 实现修正记录（共 11 处，全部限于新增模块自身）

实现经「静态自审 → 独立只读审查 → 真值测试」三层验证，逐层发现并修正：

| # | 来源 | 问题 | 修正 |
|---|---|---|---|
| 1 | 静态自审 | `assertReceipt` 缺 `revision<=MAX-2` 与 `nextAttemptAt<=now` 上限 | §4.4 回执绑定补全 |
| 2 | 静态自审 | 合法重放未校验可信时钟合法性 | 事务内 now 合法性前置（成功/重放共用） |
| 3 | 静态自审 | validator 归一化漏 4 类码、其他异常未收敛 503 | `VALIDATOR_STRUCTURE_CODES` 全 7 码 + `ADAPTER_UNAVAILABLE` 兜底 |
| 4 | 静态自审 | 组织/成员缺失误用 FORBIDDEN | 缺失 NOT_FOUND/404、停用/失效 FORBIDDEN/403 |
| 5 | 静态自审 | audit 成对性缺 org/createdAt 校验 | §4.4 补全 |
| 6 | 静态自审 | 注释拼写 `INVAILED_JOB`、未用 import | 修正拼写、移除 `assertSafeInt` |
| 7 | 独立审查 P2 | op key 记录未做六字段白名单 | `validReplay` 调 `exactSemanticFields` |
| 8 | 独立审查 P2 | 错误消息暴露权限点名 | 改固定短语「当前成员关系无权人工重试」 |
| 9 | 真值测试 P0 | `#opContext` 未返回 `orgId`，`validReplay` 用 `op.orgId` 恒 undefined，合法重放恒 CONFLICT | 返回值加 `orgId: this.orgId`（`retry.mjs:176`） |
| 10 | 真值测试 P1 | `expectedJobRevision=MAX_SAFE_INTEGER` 时 `deterministicLogId` 内 `assertSafeInt` 抢先抛 PARAM_ERROR/400 | 算 logId 前显式校验 newRevision 溢出 → INVALID_JOB/409（`retry.mjs:224-230`） |
| 11 | 补充审查 P2 | audit 记录未做字段白名单（与 #7 对称） | `exactSemanticFields(existingAudit, [orgId,actorId,actorType,action,target,createdAt])` |
| 12 | 测试裁决 | 服务层 DTO 静默忽略额外字段，违反 §4.3 精确白名单 | `retry(jobId, body, headers)` 对两侧做精确白名单，额外字段 PARAM_ERROR/400 |

> 注：表中 1–12 为累计修正条目（含初版 6 处 + 审查/测试 6 处）。#9/#10 是静态审查漏判、由契约真值测试抓出的真实缺陷，印证三层验证必要性。

## 4. G2-LC01–LC10 验收矩阵对应证据

| LC | 覆盖位置（测试文件用例名关键词） | 关键证明 |
|---|---|---|
| LC01 方法与导出面 | `LC01：retry 存在且命名正确；无 requeue 别名…` | 原型链无 requeue、模块源码无 requeue 标识符/旧实现/HTTP 注册 |
| LC02 唯一合法前置 | `LC02：§4.1 九条前置逐条证伪…` | 10 子用例逐条零写（全库 structuredClone 前后 deepEqual）+ 冻结码 |
| LC03 逐状态拒绝 | `LC03：§4.2 逐状态/情形返回冻结码…` | 12 行状态表；sending 租约三字段内容级零改；消息无敏感信息/stack |
| LC04 两种 job 写集 | 两条（enroll/revoke） | 保留 vs 清空 result/nextAttemptAt；改写后分别过 `validateDispatchJob`/`validateRevokeJob`；state=queued/revision+1/attempts 不增/lease null |
| LC05 K2/domain | 9 条 | method 分段、requestDigest 仅两字段（行为证明）、actorType=system→FORBIDDEN、domain 四态、NOT_CONFIGURED、合法重放零写、job 已推进仍返原快照、异摘要/12 种 result 篡改/audit 不成对 CONFLICT、不同 actor 不互放、op key 与 audit 字段越界 CONFLICT |
| LC06 校验顺序与零写 | 4 条优先级链 | 权限>op key 损坏>状态门禁>revision>时间，每条全库零写 |
| LC07 时间门禁 | 4 条 | 到期等号、未到期、时钟非法/回拨 503、revision MAX-2 与溢出、8 个额外字段两侧均 PARAM_ERROR |
| LC08 公开 DTO | `LC08：成功回执精确五字段…` | 键集合精确五字段、禁止字段遍历、合成标识扫描、重放回执逐字段相等 |
| LC09 与 G1 兼容 | 2 条 | 旧 requeue queued job/log/audit 不误用（INVALID_STATE 零写、不反推 op key）；旧 job 新 key 成功、同 key 复用 CONFLICT |
| LC10 零副作用 | 2 条 | fetch/http/https request+get 5 入口探针 + 正控实际触发计数 + `finally` 精确恢复；源码剥离注释后无 Provider/fetch/http；构造失败全库零写 |

## 5. 命令、exit 与计数

工作目录：`admin-web`（定向与 admin 全量）、仓库根（根测试与 git 核查）。

| 命令 | exit | pass / fail / total |
|---|---:|---|
| `node --test tests/face-strict-retry.test.mjs` | 0 | 118 / 0 / 118（38 顶层用例，复审修订后） |
| `npm test`（admin-web） | 0 | 677 / 0 / 677 |
| `npm test`（仓库根） | 0 | 51 / 0 / 51 |
| `git diff --check` | 0 | 无空白错误 |

以上为复审修订后 team-lead 独立复跑结果；初版 `67be0c7` 的 98/657/51 见第 10 节。首选默认测试隔离；无 EPERM 降级。所有计数为实际执行结果，非占位。

## 6. 零写、元数据分离与失败关闭证据

- 零写：所有拒绝/损坏/冲突场景以 `before = structuredClone(store.data)` / `after = structuredClone(store.data)` + `assert.deepEqual` 证明内容级不变；合法重放 `return []`，结合 `store.mjs` `existingDeterministicAudit` 存在且 writes 为空时直接 return 的机制，证明不新增 audit、不 persist。
- 元数据分离：`exactSemanticFields` 过滤 `_id`/`updatedAt` 后按语义字段集合精确比对；op key 六字段、audit 六字段、回执五字段、log 15 字段、result 五字段各自独立白名单，多/少字段均失败关闭。
- 失败关闭：op key/audit 字段越界、异摘要、result 12 种篡改、audit 缺失或预占、domain 单边缺/换钥、validator 结构错误均 CONFLICT 或归一化码零写，不修复、不降级。

## 7. 已知限制（交复审确认，非本卡阻断）

1. ~~DOMAIN_INCOMPLETE / DOMAIN_MISMATCH 无 HTTP status~~：**已在复审修订中关闭**——`#domainWrites()` 在 E07 边界为这两个码补 `error.status = 409`，未修改 `collections.mjs`（见第 10 节 P2-6）。
2. 本模块只做服务层，未注册 HTTP/UI（G6 门禁，符合批准范围）。
3. 测试全为合成 fixture；未在 HTTP 层、真机或生产云验证（本卡范围外）。

## 8. 边界与禁止项核对

- 未开始 G3（90 条矩阵）/ G4（兼容审查）/ reconcile（E08）/ finalize-retry（E09）/ H4-c C2/C3。
- 未改 K3、未执行初始化/迁移；未迁移/回填/重写旧 job/log/audit/op key。
- 未新增状态名/错误码/权限点；未改 job schema/validator/DTO。
- 未合并 main / 07B；未 amend/rebase/squash/reset/force；未改 G1 验收提交及历史。
- 未调用 Provider/设备/生产云；无自动重试/定时器/后台调度/Retry-After。

## 9. 交付与复审状态

- 初版提交 `67be0c7dd74ffd31c1bd30bdef3ee73d6f6edb5e` 已普通 push 并核对远端；本轮修订追加提交 SHA、普通 push 与 `git ls-remote` 远端核对结果：见最终交付回报。
- 交付后停手，等待 G2 再次独立复审；不自行开始 G3/G4。
- 初版经独立复审发现 3 P1 + 5 P2，已逐项修复（第 10 节）；修订后契约真值测试 118/118 全绿。**本文交付不等于 Codex 独立复审通过**。

## 10. 独立复审修订记录（对 67be0c7 的 3 P1 + 5 P2）

复审报告位于 Codex 云环境 `/workspace/artifacts/HK-AI-07D-G2-REVIEW-67BE0C7.md`（本机不可读），缺陷清单由用户转述。修订前由独立只读 worker 用最小探针**实测复现全部 8 项**（非静态推断），并确认初版 98 个契约测试全部漏检。

| 项 | 缺陷 | 根因 | 修复（retry.mjs） | 契约依据 |
|---|---|---|---|---|
| P1-1 | 预占确定性 log 被覆盖，违反 create-only | 写集无条件写 logId，Store 对已存在 `_id` 合并覆盖 | 状态/形状门禁后、写集前拦截 `if (state[LOGS/logId]) conflict()`；合法重放提前 return 不受影响 | §4.6/§4.8/§4.5、C08、§4.10 CONFLICT |
| P1-2 | 非 LocalStore 适配器仍能提交 | 构造器仅校验 `transact` 方法 | `instanceof LocalStore` 门禁，否则 NOT_CONFIGURED/503 | §4.13.3、§4.10 |
| P1-3 | 缺失 actorType 默认 user 绕过门禁 | `actorType \|\| "user"` | 提取 `assertMembership` 要求 `actorType==="user"`，缺失/system → FORBIDDEN；去 `#opContext` 与 audit meta 的默认值 | §4.4/§4.5 步3、P13 |
| P2-4 | 嵌套回执接受 `_id`/`updatedAt` | `exactSemanticFields` 全局过滤元数据对嵌套 result 同样生效 | `assertReceipt` 进入精确校验前拦截嵌套回执的 `_id`/`updatedAt`（带类型守卫） | §4.4/§4.9.4/§4.9.1 |
| P2-5 | 权限与 K2 校验顺序错误 | K2 派生在事务外、权限在事务内，K2 非法先于权限返回 | 抽出 `assertMembership`；DTO 后、K2 前做事务外权限预读（仅定优先级），事务内权威复核保留；Idempotency-Key 格式校验前置保住第 1 步 | §4.5 步1-5、L382、N02/N07 |
| P2-6 | domain 错误缺 409 status | `collections.mjs` 的 `schemaError` 只带 code | `#domainWrites` try/catch 为 DOMAIN_* 补 `status=409`，不改 helper | §4.4/§4.10、K10/K11 |
| P2-7 | 损坏审计值仍可重放 | audit 成对性只校字段集与 org/createdAt | 追加 actorId/actorType/action/target 值校验，target 须含 job 与 op key 分段 | §4.5 步7、§4.4/§4.9.3、K13/K14 |
| P2-8 | jobId 未执行冻结正则 | 仅用 `assertBoundedId`，不校验不透明 ID 形状 | `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`，非法 → PARAM_ERROR/400；移除未用 import | §4.3、§4.10、N01 |

**回归测试**：新增 REG-P1-1/P1-2/P1-3、REG-P2-4/P2-5/P2-6/P2-7/P2-8 共 8 组 20 条负向用例，均以全库 `structuredClone` 前后 `deepEqual` 证明零写；`assertSafeError` 收紧为对 DOMAIN_* 强制校验 `status=409`（堵住此前"status 存在才校验"的盲区）。

**可证伪验证**：team-lead 用临时反向补丁禁用 P1-1 检查后 REG-P1-1 精确失败（117/118，fail 1），还原后逐字节一致；修订 worker 另对 P2-6 做过反向补丁验证（fail 3）。测试为契约真值断言，非假阳性。

**对 spec 的必要偏差（均由修订 worker 说明理由并经 team-lead 复核采纳）**：P1-1 落点后移至状态/形状门禁之后（否则合法重放与 §4.11 旧 queued job 会误命中 CONFLICT）；P2-5 的 Idempotency-Key 格式校验前置（否则"非法 key + 无权限"会错误返回 FORBIDDEN 而非 PARAM_ERROR）；P2-4 加类型守卫（避免 null/数组回执泄漏非 CONFLICT 码）。

**范围**：本轮仅改两个本卡新增文件（实现 + 测试）并更新本证据文档；既有生产文件、G1 提交、G3/G4、main/07B、HTTP/UI 均零改动。
