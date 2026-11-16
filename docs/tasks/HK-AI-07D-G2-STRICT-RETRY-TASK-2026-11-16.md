# HK-AI-07D G2 严格 retry 服务实施卡（草案 · 待批准）

- 日期：2026-11-16（Asia/Shanghai）。
- 状态：**草案，待用户 / Codex 批准**。本卡的准备与提交不表示 G2 已开始、已实现或可上线；未经批准不得据本卡开展实现。
- 目的：在 G1 旧 requeue 入口封闭并独立验收通过的基线上，实现严格人工 `retry` 服务层方法，满足 E07 冻结契约 §0 / §3 / §4，为 G3 的 90 条矩阵与 G4 兼容审查提供可独立测试的实现。
- 代码基线：`4f9c43dfc313187b5fa971cb132dce29c294c286`（G1 验收提交，父 `9d294f3`）；建议实施分支 `feat/hk-face-strict-retry`，独立工作树，从该基线开始，不混入其他功能。
- 设计依据：`docs/tasks/HK-AI-07D-RETRY-REQUEUE-DESIGN-2026-11-15.md`（796 行，已通过技术复审 2026-11-16）§0、§3 Q1–Q8、§4.1–§4.13、§5、§6、附录 A/B。设计批准仅限契约；G2 的具体实施范围由本卡单列。
- 前置门禁（设计 §6）：

| 门禁 | 内容 | 当前状态 |
|---|---|---|
| G0 | 设计获 Codex 批准 | 已通过（技术复审 2026-11-16） |
| G1 | 旧 requeue 封闭（独立提交 + 独立复审） | **已关闭**：`4f9c43d`，两项 P2 关闭，独立验收通过 |
| G2 | 严格 `retry` 服务实现（新方法、复用 validator、K2/domain/审计同事务） | 本卡范围，**未开始，待批准** |
| G3 | §5 矩阵 90 条执行 | 未开始；本卡只要求服务层配套测试，不冒充矩阵已通过 |
| G4 | 兼容/封闭审查：旧日志/审计/queued 不误用，无迁移/回填 | 未开始 |
| G5 | 07B `queryJob` revision 合并（HTTP/UI 合法 revision 来源） | 未合并；远端 tip `59a737a` 已终审、P2 已关闭；**G2 不合并、不依赖** |
| G6 | 另行 HTTP 编码卡批准 + `routes.mjs`/`server.mjs` 登记 | 未批准；**本卡不注册任何路由** |

## 1. 范围和禁止项

本卡仅实现服务层 `retry` 方法及配套测试与证据。已核对现有 helper 全部导出（`collections.mjs` 的 `operationKey`/`operationKeyConfig`/`operationKeyFingerprint`/`operationKeyDomainIds`/`applyOperationKeyDomain`/`assertIdempotencyKey`/`deterministicLogId`/`assertSafeInt`/`assertBoundedId`；`h3a.mjs` 的 `validateDispatchJob`；`h4b.mjs` 的 `validateRevokeJob`），因此**允许新增独立模块复用，不修改任何现有生产文件**。

允许变更：

| 文件 | 允许范围 |
|---|---|
| 新增 `admin-web/lib/face-service/retry.mjs`（或等价命名） | 实现 `retry(...)` 服务方法；通过 import 复用上述 K2/domain/log helper 与两个 validator；不得修改被复用文件 |
| 新增 `admin-web/tests/face-strict-retry.test.mjs`（或等价命名） | 服务层契约测试；覆盖 §4.1 前置、§4.2 拒绝表、§4.5 顺序、§4.6 写集、§4.7 时间、§4.4 重放、零写 |
| 新增本卡对应交付证据文档 | 记录基线、变更、命令/计数、LC 对应、边界与待复审状态 |

若实现中发现必须修改 `h3a.mjs`/`h3b.mjs`/`h4b.mjs`/`service.mjs`/`collections.mjs`/`store.mjs`/`routes.mjs`/`server.mjs` 才能满足契约，**先停下并报告，另立任务，不夹带修改**。

明确禁止：

- 不注册 HTTP、不改 `routes.mjs`/`server.mjs`、不开放 HTTP/UI（G6 门禁）。
- 不合并 `main`、不合并 07B `59a737a`（G5 门禁）。
- 不调用 Provider/设备/生产云；不实现自动重试、定时器、后台调度、`Retry-After`。
- 不实现 reconcile（E08）/finalize-retry（E09）；不开始 H4-c C2/C3；不改 K3、不执行初始化/迁移。
- 不迁移、不回填、不重写旧 job/log/audit/operation_keys；不把旧 requeue 结果当作新 K2 成功。
- 不新增状态名、错误码、权限点；不改 job schema/validator/state/DTO（只复用）。
- 不修改 G1 验收提交及其历史；不 amend / rebase / squash / reset / force。

## 2. 冻结契约（必须逐条实现，不得自行发明）

1. **方法与命名**（§4.1）：服务层方法名 `retry`，不得命名为 `requeue`，不得复用或转发 `h3b.requeue`/`h4b.requeue`。建议签名 `retry(jobId, { expectedJobRevision }, { idempotencyKey })`。
2. **唯一合法前置**（§4.1 九条全部成立才允许）：`state==="retryable_failed"`；形状合法且属可派发阶段（enroll 无 `cleanupPhase`，或 revoke 且 `cleanupPhase==="dispatch"`）；`result` 为精确五字段且 `outcome==="retryable_failed"`、`errorKind==="RETRYABLE"`、`attempt===attempts`、`finishedAt` 安全整数；`attempts∈[1,3]`；`nextAttemptAt` 安全整数且 `now>=nextAttemptAt`；三个 lease 字段均为 null；`expectedJobRevision===job.revision`；组织/成员/权限事务内复核通过；K2 重放未命中异摘要/损坏。任一不成立一律零写。
3. **成功语义**（§3 Q1/Q2）：成功状态固定 `queued`，绝不 `sending`；Provider 恒 0；`attempts` 不增（由下一次实际 dispatch/claim 才 `+1`）。
4. **两种 job 相反 queued 不变量**（§2.2 / §4.6）：enroll 保留 `result` 与 `nextAttemptAt`（已到期原值），revoke 清空两者为 null；必须按 job 形状分支，禁止统一 patch 同时满足两个 validator。
5. **K2**（§4.4）：独立 method `face.operation.retry`；`actorType` 必须为 `"user"`（系统/服务主体不得调用）；`requestDigest = SHA-256(JSON.stringify(stable({ jobId, expectedJobRevision })))`，stable 为 key 递归升序、数组保序、不含 undefined，仅两字段，不含 reason/时间/attempts/lease/evidence；复用 realm 级 `operation_key_domains`（不建 method 子域）；op key 精确六字段 `{ orgId, realm, keyVersion, requestDigest, result, createdAt }`，`result` 只存五字段回执不可变快照；严格重放全表逐条实现（合法快照零写返回、异摘要/损坏/audit 不成对/字段越界一律 `CONFLICT/409` 零写、不修复不降级）。
6. **校验顺序**（§4.5 冻结 14 步）：按优先级返回最先命中的码；第 1/5 事务前校验，第 2–4 先预读并在事务内原序复核；状态门禁（第 9 步）先于形状校验（第 10 步）；validator 不放宽（§4.5.1 错误归一化）；每个失败分支零写。
7. **拒绝表与错误映射**（§4.2 / §4.10）：逐状态/情形使用冻结错误码，只使用既有码；错误消息为固定短语，不得包含存在性、org、设备或内部字段。
8. **时间门禁**（§4.7）：只用服务端注入可信时钟；`now` 必须安全整数且 `>=0`，否则 `ADAPTER_UNAVAILABLE/503`；`now < job.result.finishedAt` 视为回拨 → 同码零写；`now >= nextAttemptAt` 才允许（等于算到期），否则 `RETRY_NOT_DUE/409`；无 `force`/`now`/`nextAttemptAt`/`delay`/`backoff` 入参；`newRevision` 必须安全整数且 `<= Number.MAX_SAFE_INTEGER - 2`，否则 `INVALID_JOB/409`；无定时器/延迟/自动重试。
9. **事务原子性**（§4.5 / §4.6）：固定 8 条 refs；写集 J+L+O+D+A 同事务；log 用 `deterministicLogId(jobId,"queued",newRevision)` create-only，15 个语义字段；op key 六字段；domain 0–2 条；audit 确定性 ID、新 `audit-07d-v1:` 命名空间，不复用旧 requeue action；合法重放零写（含不新增 audit）。
10. **公开 DTO**（§4.9）：精确五字段 `jobId/state/revision/attempts/nextAttemptAt`；不暴露 lease/digest/原始错误/设备/组织/人员字段。

## 3. 验收矩阵（G2 服务层 LC 清单）

本清单是 G2 的实现验收点，**区别于** G3 的 90 条矩阵；G2 通过不等于 G3/G4 通过。

| ID | 场景 | 必须证明 |
|---|---|---|
| G2-LC01 | 方法与导出面 | 新增 `retry` 方法存在且命名正确；无 `requeue` 别名/转发/隐藏开关；不复用旧入口 |
| G2-LC02 | 唯一合法前置 | §4.1 九条逐条成立才允许；每条不成立的独立场景零写且返回冻结错误码 |
| G2-LC03 | 逐状态拒绝 | §4.2 全部状态/情形逐行；状态门禁先于 validator；错误消息不含敏感字段 |
| G2-LC04 | 两种 job 写集 | enroll 保留 result/nextAttemptAt，revoke 清空；均 state=queued、revision+1、attempts 不变、lease 字段保持 null；两种 validator 均通过 |
| G2-LC05 | K2/domain | 独立 method、requestDigest 仅两字段、domain 四种状态、op key 六字段、严格重放全表（含 audit 成对性、损坏失败关闭） |
| G2-LC06 | 校验顺序与零写 | §4.5 14 步按序；每个失败分支零写（全库 structuredClone 前后 deepEqual） |
| G2-LC07 | 时间门禁 | 到期/未到期/等于到期；时钟非法/回拨；无 override 入参；revision 溢出 |
| G2-LC08 | 公开 DTO | 精确五字段；无敏感/内部字段泄露 |
| G2-LC09 | 与 G1 兼容 | 旧 requeue queued job/log/audit 不被误用为新 K2 成功；不迁移/回填；旧 job 再次失败可用新 key 重试、旧 key 复用 `CONFLICT` |
| G2-LC10 | 零副作用边界 | 服务层不调用 Provider/设备/网络；不改 HTTP/UI/Store/validator/权限目录；不合并分支 |

每个 LC 独立场景执行 `before = structuredClone(store.data)` / `after = structuredClone(store.data)` + `deepEqual`（零写类）。服务层测试全部使用合成 fixture，不含真实人员/设备/组织/凭据/AppID/商户号。

## 4. 执行与交付（批准后生效）

在独立工作树完成依赖安装后执行并记录实际命令、工作目录、exit 与计数：

```text
# admin-web
node --test tests/<新增服务层测试文件>.test.mjs
npm test

# 仓库根
npm test
git diff --check
```

新增测试文件命令以实际文件名替换；没有新文件时说明覆盖位置，不执行占位命令。首选默认测试隔离；确有环境 EPERM 时保留失败记录，可补 none 降级证据但不得伪报默认隔离通过。锁文件与依赖清单原则上零差异，不用 stub/native 跳过掩盖依赖问题。

交付证据必须包含：

- 基线/分支/父提交/最终 SHA，逐文件 diff 与 LC01–LC10 对应证据。
- 定向、Admin 全量、根测试命令/exit/实际计数，内容级零写证据、旁路/敏感字段检查与所有限制。
- 对 `h3a.mjs`/`h3b.mjs`/`h4b.mjs`/`service.mjs`/`collections.mjs`/`store.mjs`/`routes.mjs`/`server.mjs` 与小程序的无差异证明；遇到范围外需要，另立任务，不顺带修改。
- 追加提交，普通 push 并以 `git ls-remote` 核对；不 amend / rebase / squash / reset / force，不改变既有批准提交。交付后停手，等待 G2 独立复审；不自行开始 G3/G4。

## 5. 本轮文档来源与状态

- 设计来源提交 `51e2453d4ec19027976f79d22b82cc45b723f900`（`git am` 导入，796 行；导入后提交 SHA 与来源提交不同，因 committer 元数据不同，不声称相同）。
- G1 验收提交 `4f9c43dfc313187b5fa971cb132dce29c294c286`。
- 本卡为**草案**：仅准备文档，未改生产代码、未实现 `retry`、未注册 HTTP、未合并分支、未开始 G3/G4。批准后方可开展实现。
