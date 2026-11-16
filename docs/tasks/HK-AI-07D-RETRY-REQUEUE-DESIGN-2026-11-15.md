# HK-AI-07D E07 人工重试（retry/requeue）契约设计

> **状态：设计已获技术复审通过（2026-11-16）；本批准仅限设计，不构成 HTTP 编码批准或生产实现批准。**
>
> E07 在 [HK-AI-07A](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L663-L676) 中为 `blocked / proposed`；本卡是 07A §3.2 / Q3 要求的**独立任务**，只冻结 E07 的服务层契约设计，不改变 07A 的九端点关闭状态（HTTP blocked 9/9）。
>
> **交付范围**：仅本 Markdown。不修改生产代码或测试、不注册 HTTP、不实现自动重试、不开始或触碰 H4-c（C2/C3 均未开始）、不调用 Provider/设备/生产云、不合并 `main`。
>
> **裁定口径**：本卡引用的 Codex 裁定分两组，不得混用——07A 的 Q1–Q8 是 **2026-11-14** 的 HTTP 接线裁定；本卡的 Q1–Q8 是 **2026-11-15** 针对 E07 的裁定（见 §3）。
>
> **2026-11-16 更新**：07B 远端 tip 已到 `59a737a`，已终审通过、P2 已关闭，但**尚未合并**；G5 继续保留“未合并”阻断。E07 继续 blocked。
>
> **2026-11-16 复审修订**：按 Codex 4 项意见修订——四类字段白名单、重放 revision 等式绑定、validator 错误归一化、revoke cancelled 状态门禁；矩阵扩为 90 条。技术复审已通过，但批准仅限设计。

- 工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\hk-07d-retry-requeue`
- 分支：`docs/hk-face-retry-requeue-design`（从基线新建的隔离分支）
- 基线：`1155b7ba65991d324fb8b22bb8f7dd87f49428f9`（H4-b 终审提交；本分支父提交）
- 本轮唯一变更文件：本文件（见 §8 核验）
- 现有 E07 描述行：[routes.mjs](../../admin-web/lib/face-service/routes.mjs#L47-L52)（描述表，未注册；由 Q8 的独立清理提交处理，本卡不修改）
- 现有状态机：[state.mjs](../../admin-web/lib/face-service/state.mjs#L27-L40)
- 现有重排实现：[h3b.mjs](../../admin-web/lib/face-service/h3b.mjs#L444-L487)、[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L482-L519)
- 现有 revision 读模型（已终审通过，尚未合并）：[07B service.mjs](https://github.com/1997dmsu-sketch/SMART-PM/blob/59a737acf49e249a8e3388867ca605e90a47ca61/admin-web/lib/face-service/service.mjs#L99-L137)

## 0. 结论摘要

1. **只允许** `retryable_failed` 且 `cleanupPhase==="dispatch"`（enroll job 无该字段）、`result.errorKind==="RETRYABLE"`、`attempts∈[1,3]`、`now>=nextAttemptAt` 的 job 被人工重排；成功结果固定 `queued`（Q1），绝不直接 `sending`，Provider 恒 0。
2. 重排**不增加 `attempts`**（Q2）；下一次实际 dispatch/claim 才按现有约定 `+1`（[h3a.mjs](../../admin-web/lib/face-service/h3a.mjs#L222-L255)、[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L211-L235)）。
3. **严格尊重 `nextAttemptAt`**（Q3）：早于到期 `RETRY_NOT_DUE/409`，无 override/force/重设退避；enroll job 保留原 due 供领取复核，revoke job 在门禁通过后按自身 queued 不变量清空。
4. `terminal_failed` **永不允许**（Q4）；`awaiting_result` 只能 query/reconcile，重排返回 `INVALID_JOB`（H3 D53）。
5. K2 使用**独立 method `face.operation.retry`**、结构化 `requestDigest`、现有 operation domain、严格重放与损坏失败关闭；operation key 的 `result` 只存重建五字段回执的**不可变快照**（Q6）。
6. 响应 DTO 精确五字段 `jobId/state/revision/attempts/nextAttemptAt`；不暴露 lease、digest、原始错误、设备/组织/人员字段。
7. 先**封闭**不完整入口 `h3b.requeue`/`h4b.requeue`（Q7），再用严格方法替换；旧 requeue 的日志/审计/queued 结果不得被误用为新 K2 成功。
8. 设计已获批准，仍须：严格服务实现、测试矩阵执行、兼容/封闭审查全部通过，再**另行批准**才可 HTTP 接线（Q8）；本卡不注册任何路由。

## 1. 基线与共同祖先核验（事实）

### 1.1 工作树、分支与远端

| 项目 | 值 | 核验方式 |
|---|---|---|
| 工作树 | `C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\hk-07d-retry-requeue` | `git worktree list` |
| 分支 | `docs/hk-face-retry-requeue-design` | `git status -sb` |
| 基线（父提交） | `1155b7ba65991d324fb8b22bb8f7dd87f49428f9` | `git rev-parse HEAD` |
| 远端 `main` | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` | GitHub Branches API（2026-11-15），与本地 `origin/main` 一致 |
| 远端 `feat/hk-face-h4b-mock-cleanup` | `1155b7ba65991d324fb8b22bb8f7dd87f49428f9` | GitHub Branches API，与本地基线一致 |
| 远端 `docs/hk-face-http-wiring-design` | `2f597e33acb3563d92cafd2d70ac238a27d796dc` | GitHub Branches API，与本地 ref 一致 |
| 远端 `feat/hk-face-queryjob-revision` | `59a737acf49e249a8e3388867ca605e90a47ca61`（2026-11-16；终审通过、P2 关闭、未合并） | GitHub Branches API；本地 `origin` ref 已指向该提交 |

说明：本机 `git ls-remote` 因当前会话无 GitHub 凭据而失败（`schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`），远端 SHA 改用公开 GitHub API 只读核验；推送能力见 §8.4。

### 1.2 为什么选 `1155b7b` 作为共同基线

`1155b7b`（H4-b 终审提交）是 07A、07B、H4-c C1 三条后续线的共同祖先：

| 对象 | 提交 | `git merge-base` 结果 |
|---|---|---|
| 07A HTTP 契约 | `2f597e3` | `1155b7b` |
| 07B queryJob revision（旧 tip `cf7c75e`；当前远端 tip `59a737a`，终审通过、未合并） | `cf7c75e` / `59a737a` | `1155b7b` |
| H4-c C1 | `5dff386` | `1155b7b` |

因此：以 `1155b7b` 为基线，能把 E07 依赖的“当前 requeue 实现、已批准 H3/H4 代码、K2、store 事务、queryJob 读模型（同伴提交）”放在同一可复现祖先上比较，而不会把 07A/07B/H4-c 的未合并文档或代码误当基线事实。07B 远端 tip 虽在 2026-11-16 前进到 `59a737a` 并已终审通过（P2 关闭），但尚未合并，仍不能当作已合并依赖；共同祖先判断仍以 `1155b7b` 为准。

补充事实：H4 设计稿 `9fd088d`（`docs/hk-face-h4-revoke-reconcile-design`）是 `ccd6d08` 的**另一条**后继线（`git merge-base 9fd088d 1155b7b = ccd6d08`），不是 `1155b7b` 的祖先；本卡不把该分支上的 `HK-AI-04-H4-REVOKE-RECONCILE-DESIGN.md` 当作已批准设计（其抬头自述“设计提案，待 Codex 批准”，[9fd088d 行 1–5](https://github.com/1997dmsu-sketch/SMART-PM/blob/9fd088d/docs/tasks/HK-AI-04-H4-REVOKE-RECONCILE-DESIGN.md#L1-L5)）。H4 的已批准设计是另一份文件（§1.4）。

### 1.3 基线文件与已批准提交的字节一致性（证据）

在 `1155b7b` 上，以下文件与各自“终审/批准”提交的 blob 完全相同：

| 文件 | 批准提交 | blob（一致） |
|---|---|---|
| `admin-web/lib/face-service/h3a.mjs` | H3-a `5e590ee` | `1999a8239f84d1828215a2b2dde8d082ed78c5af` |
| `admin-web/lib/face-service/h3b.mjs` | H3-b `2b92b30` | `4158369d7d908e0b89298311e48b86828e6ee403` |
| `docs/tasks/HK-AI-04-H3-LEASE-DISPATCH-DESIGN.md` | H3 设计 `b2cd7ab` | `a9bc05639f0aaad8114e23b28a78dab3593f25f2` |
| `admin-web/lib/face-service/h4b.mjs` | H4-b `1155b7b` | 基线即 H4-b 终审提交本身 |

结论：本卡对 H3-a/H3-b/H4-b 代码与 H3 设计文档的引用，等于对已批准版本的引用，不是对未批准改动或旧分支的引用。

### 1.4 批准链（事实）

| 对象 | 批准/终审 | 证据 |
|---|---|---|
| H3 设计 `b2cd7ab` | 2026-11-13 终审通过 | [H3 设计终审](https://github.com/1997dmsu-sketch/SMART-PM/blob/547fee5/docs/tasks/HK-AI-04-H3-DESIGN-APPROVAL-B2CD7AB-2026-11-13.md) |
| H3-a `5e590ee` | 终审通过 | [H3-a 批准](https://github.com/1997dmsu-sketch/SMART-PM/blob/547fee5/docs/tasks/HK-AI-04-H3A-APPROVAL-5E590EE-2026-11-13.md) |
| H3-b `2b92b30` | 终审通过，H3 关闭 | [H3-b 批准](https://github.com/1997dmsu-sketch/SMART-PM/blob/547fee5/docs/tasks/HK-AI-04-H3B-APPROVAL-2B92B30-2026-11-13.md) |
| H4 设计 `1542a6c` | 设计通过（不批准 HTTP/真实 Provider） | [H4 设计终审](https://github.com/1997dmsu-sketch/SMART-PM/blob/547fee5/docs/tasks/HK-AI-04-H4-DESIGN-APPROVAL-1542A6C-2026-11-13.md) |
| H4-a `685ac3a` | 终审通过 | [H4-a 批准](https://github.com/1997dmsu-sketch/SMART-PM/blob/547fee5/docs/tasks/HK-AI-04-H4A-APPROVAL-685AC3A-2026-11-13.md) |
| H4-b `1155b7b` | 终审通过，H4-a/b 关闭 | [H4-b 批准](https://github.com/1997dmsu-sketch/SMART-PM/blob/547fee5/docs/tasks/HK-AI-04-H4B-APPROVAL-1155B7B-2026-11-13.md) |
| H4-c 设计 `b15aceb` | 2026-11-14 设计批准（C2/C3 未开始） | [H4-c 设计批准](https://github.com/1997dmsu-sketch/SMART-PM/blob/ed7b66f84c79339246a81ea76762cc388d7f4778/docs/tasks/HK-AI-04-H4C-DESIGN-APPROVAL-B15ACEB-2026-11-14.md) |

**文件改名事实**：H4 已批准设计是 `docs/tasks/HK-AI-04-H4-REVOCATION-DESIGN-2026-11-13.md`（`1542a6c`）；`HK-AI-04-H4-REVOKE-RECONCILE-DESIGN.md`（`9fd088d`）是后续**未批准草案**。同理，基线里的 H3 设计文档抬头第 3 行仍写“设计返工提案，待 Codex 批准”，但 `b2cd7ab` 已有终审通过记录（§1.4）；本卡以批准记录 + blob 一致性为准，不把陈旧抬头当状态。

### 1.5 引用规则

1. 基线代码/文档用 `commit:path:line` 明示，并给相对链接；相对链接行号以 `1155b7b` 工作树为准。
2. 不在 `1155b7b` 树内的同伴产物（07A、07B、H4 批准设计、H4-c 设计、批准记录）一律用带提交 SHA 的 GitHub permalink，不建“看似本地”的失效链接。
3. 全文三分：**事实**（可复核的代码/文档/批准记录）、**提案**（本卡新增契约）、**裁定**（Codex 2026-11-15 Q1–Q8）。事实不得外推为契约。

## 2. 现状事实（每条可复核）

### 2.1 状态机（已批准）

- 七个 job 状态：`queued/sending/awaiting_result/succeeded/retryable_failed/terminal_failed/cancelled`（`1155b7b:admin-web/lib/face-service/dto.mjs:42-50`）。
- 转移表：`queued→sending/cancelled`；`sending→awaiting_result/succeeded/retryable_failed/terminal_failed`；`awaiting_result→succeeded/retryable_failed/terminal_failed`；`retryable_failed→queued/cancelled`；`succeeded/terminal_failed/cancelled` 无出边（`1155b7b:admin-web/lib/face-service/state.mjs:27-40`）。
- 唯一断言入口 `assertTransition`（`state.mjs:57-63`）；H3 设计把 `retryable_failed→queued` 的原子写集定义为“job + 一条 queued log”，条件是“到期、权限与 CAS”（`1155b7b:docs/tasks/HK-AI-04-H3-LEASE-DISPATCH-DESIGN.md:117-126`，尤其第 123 行）。

### 2.2 两种 job 形状与相反的 queued 不变量（关键事实）

**enroll job（H3-a/H3-b）**：`action==="enroll"`，字段集合精确（含内嵌 `dispatchSnapshot`，无 `cleanupPhase`）。`validateDispatchJob` 对 `queued && attempts>0` 要求：无 lease、`attempts<4`、`nextAttemptAt` 为安全整数、`result` 非空，且 `result.outcome==="retryable_failed"`、`result.attempt===attempts`（`1155b7b:admin-web/lib/face-service/h3a.mjs:161-210`，queued 分支在 181–188）。

**revoke job（H4-b）**：`action==="revoke"`，24 字段（含 `cleanupPhase`、`providerOutcome`、`finalizeAttempts`、`cleanupSnapshot`）。`validateRevokeJob` 对 `queued` 要求：`cleanupPhase==="dispatch"`、`nextAttemptAt===null`、`result===null`（`1155b7b:admin-web/lib/face-service/h4b.mjs:84-120`，queued 分支在 100–103）。

**结论（事实）**：同一集合里的两种 job 对“queued 时是否保留 result/nextAttemptAt”有**相反**的不变量。任何 E07 写集必须按 job 形状分支，不能用一个统一 patch 同时满足两个 validator；这是本设计 §4.6 的直接依据，也是“错误/result 清理保留”必须逐形状定义的原因。

### 2.3 当前 requeue 实现与缺口（事实）

| 维度 | `h3b.requeue`（`h3b.mjs:444-487`） | `h4b.requeue`（`h4b.mjs:482-519`） |
|---|---|---|
| 签名 | `(jobId, expectedRevision, actor=null)` | `(jobId, expectedRevision=null, actor=null)` |
| revision | 必填安全整数（446 行）；事务内必须等于 `current.revision`（469–471 行） | 仅当 `actor!==null` 才要求（488–492 行）；否则只比较预读 `job.revision`（507–508 行） |
| 权限 | **仅当 actor 非空**才复核组织/成员/`device.operation.retry`（463–468 行）；`actor=null` 无权限检查 | 同上（501–506 行） |
| 状态前置 | `retryable_failed`、`attempts<4`、`nextAttemptAt` 安全整数（469–471 行） | `cleanupPhase==="dispatch"`、`retryable_failed`、`attempts<4`（486–487 行） |
| 到期门禁 | `now < nextAttemptAt` → `RETRY_NOT_DUE`（472 行） | 同（509 行） |
| 写集 | job（仅 `state/revision/updatedAt`，**保留** result 与 nextAttemptAt）+ queued log + 非确定性 audit（473–485 行） | job（`state/revision/updatedAt`，**清空** `nextAttemptAt/result`）+ log + 确定性 audit（510–518 行） |
| K2 | **无** operation key / `requestDigest` / domain（460 行 refs 只有 job/log/member/org） | **无**（497 行 refs 同样不含 op key） |
| 严格重放 | **无**；同键第二次按状态/CAS 失败 | **无**；同键第二次同样失败（失败原因是状态已 queued） |
| 服务层审计 | `#audit("重排合成门禁任务")`（485 行），store 追加随机 `admin_audit` | `audit-h4-v1:<sha256([orgId,jobId,phase,revision])>`（122–128 行），同事务确定性 audit |

补充事实：

- h3b 的 queued log 硬编码 `action:"enroll"`（475–480 行）；h4b 的 log 构造器同样硬编码 `"revoke"`（132–137 行）。E07 若同时服务两种 job，必须改用 `job.action`，否则 log 与 job 不一致。
- 两处都**没有**把权限检查作为无条件前置：系统路径（`actor=null`）可绕过 `device.operation.retry`；E07 不允许存在这种路径。
- 两处都**没有**“逐状态明确错误码”：除 `RETRY_NOT_DUE` 外基本落到 `INVALID_JOB`，无法区分 `queued/sending/awaiting_result/succeeded/terminal_failed/cancelled`。
- 现有测试只覆盖“到期重排、未到期拒绝、actor 权限、revision”四类：`H3-b D44/D45`（`1155b7b:admin-web/tests/face-grant-d-matrix.test.mjs:1738-1785`）、`D32/D40`（同文件 1860–1870、2041）、`D54`（2071–2085）、参数先失败（2088–2096）；H4-b 手工重试权限/revision（`1155b7b:admin-web/tests/face-h4b.test.mjs:430-445`）与未到期（129–131、189–191）。**没有任何**E07 级 K2/重放/domain/并发/敏感字段测试。

### 2.4 K2、operation domain、审计与事务的现有机制（事实）

- `operation_keys` 记录固定六字段：`orgId/realm/keyVersion/requestDigest/result/createdAt`（写法见 `1155b7b:admin-web/lib/face-service/service.mjs:242-250`、`303-307`；白名单另见 H4 批准设计 §10）。
- op key 作用域：`orgId + method + actorType + actorId + 原始 key`，HMAC 派生，原始 Idempotency-Key 不落库（`1155b7b:admin-web/lib/face-service/collections.mjs:244-251`；`service.mjs:117-126`）。
- `requestDigest` 为 `SHA-256(stable(...))`，`stable` 递归按 key 排序（`service.mjs:57-58`）；已有 method 的摘要输入见 07A §2.7（[L374-L390](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L374-L390)）。
- operation domain：head/version 的 ID 只由 **realm** 决定（`collections.mjs:232-238`），`applyOperationKeyDomain` 在双缺时创建两条、单边缺失/损坏 `DOMAIN_INCOMPLETE`、完整但版本/指纹不符 `DOMAIN_MISMATCH`、配置缺失/非法 `NOT_CONFIGURED/503`（`collections.mjs:199-216`、`257-317`；`service.mjs:147-151`）。**domain 是部署 realm 级，不是 method 级**，E07 不得另造 method 子域。
- 严格重放：现有 `#replayValid` 校验 org/realm/keyVersion/createdAt/digest，并对 `result` 做深比较（`service.mjs:132-145`）；E07 的回执是历史快照，不能与“当前 job 推导值”深比较（原因见 §4.4）。
- 确定性审计：Store 要求 `admin_audit/<auditId>` 必须在 refs 中，且同一 `auditId` 已存在时 build 必须返回**空写集**，否则整事务 `409`（`1155b7b:admin-web/lib/store.mjs:87-96`、`263-316`，零写分支在 281–285，审计写入在 303–310）。这是 E07 实现“同键重放零写”的现成机制。
- Store 事务在克隆态构建、抛错不落盘；未声明的写会抛错；所有写 ID 必须已在 refs 中（`store.mjs:286-301`）。
- 现有 K2 method 只有 `face.submit/face.review/face.grant/face.revoke`；**没有** `face.operation.retry`（07A §1.4 [L160-L170](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L160-L170)；本卡 §2.3 的代码复核一致）。

### 2.5 queryJob revision 读模型（07B，未合并）

- 基线 `queryJob(jobId)` 只返回 `publicJobResult` 五字段，**没有 `revision`**（`1155b7b:admin-web/lib/face-service/service.mjs:731-736`；`dto.mjs:254-263`）。
- 07B 在 `cf7c75e` 增加六字段读模型，`59a737a` 终审通过（仅测试文件变更、生产代码未动）：`jobId/state/revision/attempts/lastSuccessAt/failureReason`，`revision` 必须为正安全整数且只来自服务端当前 job 记录，任何非法/缺失 **`INVALID_JOB/409` 失败关闭**（[59a737a service.mjs:99-137](https://github.com/1997dmsu-sketch/SMART-PM/blob/59a737acf49e249a8e3388867ca605e90a47ca61/admin-web/lib/face-service/service.mjs#L99-L137)；入口 [798-803](https://github.com/1997dmsu-sketch/SMART-PM/blob/59a737acf49e249a8e3388867ca605e90a47ca61/admin-web/lib/face-service/service.mjs#L798-L803)）。
- 07A Q1/Q2/Q7 已裁定：唯一权威 job revision 入口是**按 ID 的 `queryJob`**；requeue/retry 字段名为 `expectedJobRevision`；无合法 revision 时 UI 必须隐藏/禁用并零请求（07A [L720-L743](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L720-L743)、[L1245-L1260](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L1245-L1260)）。
- **复审状态（2026-11-16）**：`59a737a` 已终审通过；P2（模块加载期网络计数在核验前被清零）已由该提交关闭——测试在 guard 自检/清零前保存 `networkGuard.loadTime` 并断言五入口为 0（`59a737a:admin-web/tests/face-service.test.mjs:351-378`）。由于**尚未合并**，仍不能作为已合并依赖。
- **依赖结论（事实）**：07B 尚未合并前，E07 的 HTTP/UI 没有已合并的 revision 读模型；服务层实现可以用 store 内记录做测试，但**不得**把未合并分支当作已交付依赖，也不得从列表/本地状态猜 revision。

### 2.6 路由、权限与注册事实

- `device.operation.retry` 已在权限目录（`1155b7b:admin-web/lib/org.mjs:102-104`）；角色 `admin` 不隐含任何 `device.*`（07A §1.6 [L202-L215](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L202-L215)）。
- `routes.mjs` 有 E07 描述行 `POST /api/v2/device-operation-jobs/:jobId/retry` + `device.operation.retry`（`1155b7b:admin-web/lib/face-service/routes.mjs:47-52`），但它是**描述表**，`matchFaceRoute` 无 server 调用方、server 未注册（07A §1.5 [L179-L198](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L179-L198)）。
- 当前调用 `/retry` 的实际结果是未注册的 `404/405`、零写、Provider 0（07A §3.1 [L663-L676](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L663-L676)）。

### 2.7 已批准设计中的重试语义

- H3 设计 Q07（`1155b7b:docs/tasks/HK-AI-04-H3-LEASE-DISPATCH-DESIGN.md:99-101`）：初次发送外最多三次重试；`attempts=1/2/3` 的 pre-send RETRYABLE 写 30/120/600 秒退避；到期边界 `now ≥ nextAttemptAt`；自动与人工争用同一 CAS；短事务校验组织、权限、`expectedRevision`、`retryable_failed` 和预算后写 `queued` 并追加日志；**保留原 attempt 及 due 时间供领取复核，领取时清 due 并扣下一次预算**；人工需 `device.operation.retry` 且遵守同一退避；保留原 job/grant/operation key/`requestDigest`；重排不调用 Provider。
- H4 批准设计 §5（[1542a6c:HK-AI-04-H4-REVOCATION-DESIGN-2026-11-13.md:100-114](https://github.com/1997dmsu-sketch/SMART-PM/blob/1542a6cf94c1eff8a441bb39da43f4a0342fb3cb/docs/tasks/HK-AI-04-H4-REVOCATION-DESIGN-2026-11-13.md#L100-L114)）：dispatch 阶段的**人工 retry 只适用于可确认未发送的 `retryable_failed`**；finalize 阶段的自动/人工 retry 只重做本地事务、绝不调用 Provider；`awaiting_result` 只能由未来 H4-c 对账处理。
- H4 批准设计 §8（同链接 [L167-L175](https://github.com/1997dmsu-sketch/SMART-PM/blob/1542a6cf94c1eff8a441bb39da43f4a0342fb3cb/docs/tasks/HK-AI-04-H4-REVOCATION-DESIGN-2026-11-13.md#L167-L175)）：`awaiting_result` 不得被自动重发；未来对账属于 H4-c，明确不随 H4-a/b 批准编码。

### 2.8 UNKNOWN_RESULT 与 H4-c 边界

- `UNKNOWN_RESULT` 只进入 `awaiting_result`；离开该状态的唯一人工入口是 `device.operation.reconcile`（H4-c 设计 §1，[b15aceb:HK-AI-04-H4C-RECONCILIATION-DESIGN.md:39-49](https://github.com/1997dmsu-sketch/SMART-PM/blob/b15acebe0a8049f316797bbbd2692c55de25d111/docs/tasks/HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L39-L49)）。
- 对 `awaiting_result` 发起 retry：H3 D53 冻结为 `INVALID_JOB/409` 零写（`1155b7b:docs/tasks/HK-AI-04-H3-LEASE-DISPATCH-DESIGN.md:208`）；07A §3.8/§6.1 重申禁止（[L780-L795](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L780-L795)）。
- H4-c 仍只完成 C1 只读 helper；C2/C3 未开始、E08/E09 未注册（07A §1.7 [L217-L228](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L217-L228)）。E07 不处理 `terminal_failed` 的本地恢复，也不实现 `finalize-retry`。

### 2.9 07A 对 E07 的既有约束（不得违反）

- E07 为 `blocked / proposed`；**不得复用不完整 requeue**；未来独立任务必须冻结 K2 method、Idempotency-Key、`requestDigest`、operation domain、`expectedJobRevision`、lease、`attempts`、`nextAttemptAt`、严格重放、`retryable_failed` 前置（07A §3.2 [L678-L698](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L678-L698)）。
- `awaiting_result`/`UNKNOWN_RESULT` 禁止普通 requeue 与自动重试（同节；§3.8）。
- 候选端点只允许留在设计文档；`routes.mjs` 的候选描述行由未来独立小提交清理，且清理不得夹带业务变更（07A Q8 [L851-L863](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L851-L863)）。
- 本卡只写本 Markdown；不改上述任何文件。

## 3. Codex 裁定（E07，2026-11-15）

> 本节是本卡唯一有效的 Q1–Q8 写回；与 07A 的 Q1–Q8（2026-11-14）同名但不同任务，禁止互相引用。

| 编号 | 问题 | 裁定 | 对本卡的直接后果 |
|---|---|---|---|
| Q1 | 重排成功后的状态 | **`queued`**。绝不直接 `sending`，绝不调用 Provider。 | §4.6 写集固定 `state:"queued"`；§5 S 系列与 C 系列按此断言。 |
| Q2 | 重排是否增加 `attempts` | **不增加**；由下一次实际 dispatch 按现约定计数（claim/leasePatch `+1`）。 | §4.6 `attempts` 原值保留；回执 `attempts` 是重排时值；预算仍 1..3。 |
| Q3 | `nextAttemptAt` 与 override | **严格尊重**，禁止 override；未到期拒绝；不得重设/延长/清零后放行。 | §4.7 时间门禁与写集；无 `force/now/nextAttemptAt` 入参。 |
| Q4 | `terminal_failed` 是否可重试 | **永不允许**。 | §4.2 拒绝表；`LOCAL_FINALIZE_EXHAUSTED` 也不经 E07；E09 另案。 |
| Q5 | 是否额外要求 `device.audit.read` | **不要求**；只要求 `device.operation.retry`，审计为内部同事务写入。 | §4.5 权限只查 retry；审计不作为响应字段。 |
| Q6 | operation key 的 `result` 存什么 | 只存重建**五字段 DTO** 所需的不可变快照；内部版本/校验元数据与 DTO **分开**。 | §4.9 回执五字段；op key 记录 `result` 只含回执，`realm/keyVersion/requestDigest/createdAt` 在外层。 |
| Q7 | 旧入口怎么处理 | **先封闭**不完整入口，后续另案用严格契约替换；旧结果不得误用为新 K2 成功。 | §4.11 封闭与兼容为硬前置；新 method/新审计前缀，旧 receipt 不可重放。 |
| Q8 | HTTP 何时可接 | 设计批准 + 严格服务实现 + 测试矩阵 + 兼容/封闭审查通过后，**另行批准**才可 HTTP 接线。 | §4.12 门禁；本卡不注册、不改 `routes.mjs`/`server.mjs`。 |

## 4. 提案：E07 严格人工重试契约

### 4.1 范围与唯一合法前置

**服务层方法名**：`retry`，**不得**命名为 `requeue`，不得复用 `h3b.requeue`/`h4b.requeue`（Q7）。建议签名：

```text
retry(jobId, { expectedJobRevision }, { idempotencyKey })
```

**唯一合法前置（全部成立才允许）**：

1. `job.state === "retryable_failed"`；
2. job 形状合法且属于可派发阶段：`action==="enroll"`（无 `cleanupPhase`）或 `action==="revoke" && cleanupPhase==="dispatch"`；
3. `job.result` 为精确五字段对象，`outcome==="retryable_failed"`、`errorKind==="RETRYABLE"`、`attempt===job.attempts`、`finishedAt` 为安全整数；
4. `job.attempts ∈ [1,3]`（`0` 或 `≥4` 一律失败关闭）；
5. `job.nextAttemptAt` 为安全整数，且 `now >= job.nextAttemptAt`；
6. `job.leaseOwner/leaseExpiresAt/dispatchAuthorizedAt` 均为 `null`（`leaseGeneration===attempts` 由 validator 保证）；
7. `expectedJobRevision === job.revision`；
8. 当前组织/成员/权限在事务内复核通过；
9. K2 重放检查未命中“异摘要/损坏”分支。

**不合法前置的一律零写**（§5 N 系列）。

### 4.2 逐状态拒绝表（提案，冻结错误码）

| 当前状态/情形 | 错误码 | 说明 |
|---|---|---|
| `queued` | `INVALID_STATE/409` | 已重排或已领取；同键重放走 §4.4 回执，**不**按本行拒绝 |
| `sending` | `INVALID_STATE/409` | 活动租约期间禁止人工改状态；不触碰 lease |
| `awaiting_result` | `INVALID_JOB/409` | H3 D53 冻结；只允许 query/reconcile |
| `succeeded` | `INVALID_STATE/409` | 终态 |
| `terminal_failed` | `INVALID_STATE/409` | Q4 永不允许；含 `LOCAL_FINALIZE_EXHAUSTED` |
| `cancelled` | `INVALID_STATE/409` | 终态；enroll/revoke 两形状同码（状态门禁先于 validator） |
| `retryable_failed` 但 `cleanupPhase==="finalize"` | `INVALID_STATE/409` | 属 E09 `finalize-retry` 边界，E07 不处理 |
| `retryable_failed` 但 `result.errorKind!=="RETRYABLE"` | `INVALID_JOB/409` | 异常分类失败关闭（含 `UNKNOWN_RESULT`/`LOCAL_FINALIZE`/`PRE_SEND_BLOCKED`/`TERMINAL`） |
| `retryable_failed` 但 `attempts<1` 或 `attempts>=4` | `INVALID_JOB/409` | 预算/记录损坏 |
| `retryable_failed` 已到期但 revision 不符 | `REVISION_CONFLICT/409` | 见 §4.5 顺序（状态先于 revision，revision 先于时间） |
| 不存在/跨组织 | `NOT_FOUND/404` | 与 §4.5 的权限失败顺序一致；不得用 403 区分 |

错误消息统一为固定短语（例如“任务当前不可重试”“任务已被修改，请刷新后重试”“未到重试时间”），不得包含存在性、org、设备或内部字段。

**状态门禁先于形状校验（冻结）**：`queued/sending/succeeded/terminal_failed/cancelled` 对 enroll/revoke 两形状都在第 9 步直接返回 `INVALID_STATE`，不调用 validator；`awaiting_result` 返回 `INVALID_JOB`（H3 D53）。validator 只在状态仍为 `retryable_failed` 时调用（§4.5 第 10 步），且不放宽（§4.13）。因此 `validateRevokeJob` 不接受 `cancelled` 不会改变本端点预期。

### 4.3 输入 DTO（精确白名单）

| 位置 | 字段 | 约束 |
|---|---|---|
| Path/服务参数 | `jobId` | 有界不透明 ID：`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`；百分比解码失败 `PARAM_ERROR/400` |
| Header | `Idempotency-Key` | 仅 header；`^[A-Za-z0-9._:-]{16,128}$`；缺失/非法 `PARAM_ERROR/400`，零写、不建 op key |
| Body | `expectedJobRevision` | **必填**，`Number.isSafeInteger(v) && v>=1`；字符串/小数/NaN/Infinity/2^53/0/负数一律 `PARAM_ERROR/400` |
| Header | `X-CSRF-Token`、`X-Org-Id` 等 | 沿用 07A §2.1/§2.2 的已冻结传输层；不属于本卡新增 |

**Body 精确只允许一个字段**。以下字段出现即 `PARAM_ERROR/400`、零写（不论值是否合法）：

`reason`、`reasonCode`、`message`、`note`、`comment`、`force`、`override`、`now`、`time`、`nextAttemptAt`、`delay`、`backoff`、`attempts`、`leaseOwner`、`leaseGeneration`、`leaseExpiresAt`、`actorId`、`orgId`、`membershipId`、`permissions`、`role`、`jobId`（body 内）、`expectedRevision`、`expectedCredentialRevision`、`expectedGrantRevision`、`decision`、`evidence`、`metadata`。

**别名拒绝**：`expectedRevision` 不是本端点的字段名；必须 `expectedJobRevision`（07A Q2 [L389](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L389)）。

### 4.4 K2：独立 method、结构化 requestDigest、domain、严格重放

**method**：`face.operation.retry`（本卡冻结；07A 的候选名至此成为本设计的契约名）。它**独立于** `face.submit`/`face.review`/`face.grant`/`face.revoke`/`face.reconcile`/`face.reconcile.finalize`；不同 method 的 op key 互不重放。

**op key**：`operationKey({ orgId, method:"face.operation.retry", actorType:"user", actorId, idempotencyKey, config })`；原始 key 不落库（`1155b7b:admin-web/lib/face-service/collections.mjs:244-251`）。`actorType` 必须是 **`"user"`**；系统/服务主体不得调用（无自动重试）。

**requestDigest（结构化，冻结 v1）**：

```text
requestDigest = SHA-256( JSON.stringify( stable({ jobId, expectedJobRevision }) ) )
stable = 对象 key 递归升序排序；数组保序；不含 undefined；不拼接原始 body
```

- 摘要只含两个字段，不含 reason/message/时间/attempts/lease/decision/evidence。
- 摘要算法版本 `v1` 随本设计冻结；未来若改算法，必须换 method（如 `face.operation.retry.v2`），不得让同 method 的旧记录被新算法误读。
- 不得使用原始 Idempotency-Key 或 requestDigest 原值作为响应/日志/审计字段。

**operation domain**：复用现有 realm 级 `operation_key_domains`（head/version 由 `operationKeyDomainIds(realm)` 决定，`collections.mjs:232-238`；写入规则 `257-317`）。E07 **不**新建 method 子域。结果：

| domain 状态 | 结果 |
|---|---|
| head/version 均缺 | 同事务写 head+version（0–2 条），继续 |
| 单边缺失/损坏/kind 不符 | `DOMAIN_INCOMPLETE/409`，零写 |
| 版本/换钥/fingerprint 不符 | `DOMAIN_MISMATCH/409`，零写 |
| K2 配置缺失/非法 | `NOT_CONFIGURED/503`，零写 |
| 完整且匹配 | 0 条 domain 写 |

**op key 记录（精确六字段）**：

```text
{ orgId, realm, keyVersion, requestDigest, result, createdAt }
```

`result` = 五字段回执快照（§4.9），内部元数据在记录外层（Q6）。禁止在 `result` 内放 digest/revision 校验元数据/lease/错误原文。Store 事务会注入 `_id` 与 `updatedAt`；二者是存储元数据，不属于语义六字段，校验只针对六字段。

**严格重放（冻结）**：

| 情形 | 行为 |
|---|---|
| 同 op key、同 digest、`result` 精确合法 | 返回该快照；**零写**（含不新增 audit）；不读当前 job、不重跑迁移 |
| 同 op key、异 digest | `CONFLICT/409`；不改写 op key |
| 同 op key、`result` 为 null/数组/错 `jobId`/`state!=="queued"`/`revision` 非法/不等于 `expectedJobRevision+1`/超上限/`attempts` 越界/`nextAttemptAt` 超范围/多字段/少字段 | `CONFLICT/409`，零写，不修复、不降级 |
| op key 存在但确定性 audit 缺失 | `CONFLICT/409`，零写（否则 store 会为空写补一条 audit，破坏零写） |
| audit 存在但 op key 缺失 | `CONFLICT/409`，零写（预占/损坏） |
| op key/audit 的 `createdAt` 非安全整数、org/realm/keyVersion 不符 | `CONFLICT/409`，零写 |
| 同键在 job 后续再次失败后复用 | 摘要不同 → `CONFLICT/409`，零写（幂等键不得复用） |
| 不同 actor 同原始 key | op key 作用域不同，互不重放；各自按自身权限 |
| 不同 job 同 key | 摘要不同 → `CONFLICT/409` |

**回执与请求的绑定（冻结）**：重放不读当前 job，但必须把快照绑定到本次请求：

| 校验 | 规则 | 失败 |
|---|---|---|
| `jobId` | `result.jobId === jobId` | `CONFLICT/409` |
| `state` | `result.state === "queued"` | `CONFLICT/409` |
| revision 等式 | `result.revision === expectedJobRevision + 1` | `CONFLICT/409` |
| revision 上限 | `Number.isSafeInteger(result.revision) && result.revision <= Number.MAX_SAFE_INTEGER - 2` | `CONFLICT/409` |
| attempts | 安全整数且 `1 <= result.attempts <= 3` | `CONFLICT/409` |
| nextAttemptAt | `null` 或（安全整数且 `0 <= nextAttemptAt <= now`） | `CONFLICT/409` |
| 键集合 | 精确五字段 | `CONFLICT/409` |

- `revision` 等式把快照绑定到 `requestDigest`（摘要含 `expectedJobRevision`）；**类型合法但 `revision` 被篡改的快照必须 `CONFLICT/409`，不得当作成功重放**。
- `attempts` 不参与摘要，只做范围校验，不是请求绑定字段。
- `now` 取可信时钟；时钟非法 → `ADAPTER_UNAVAILABLE/503`（§4.7）。
- 上述任一失败均**零写**，不修复、不重新生成回执。

**为什么不能直接套用 `#replayValid`**：现有 `#replayValid` 用“当前请求推导的 expected result”与存量 `result` 深比较（`service.mjs:132-145`）。E07 成功后 job 会继续被 claim/派发，`revision`/`state` 已前进；若用当前 job 重算 expected，合法重放会被误判为冲突。因此 E07 必须使用**快照校验**（结构/范围 + `revision` 等式绑定），并原样返回快照。

### 4.5 校验顺序与事务原子性（冻结）

事务 refs（固定 8 条，去重后仍 ≤90）：

```text
organizations/<orgId>
org_memberships/<membershipId>
device_operation_jobs/<jobId>
device_operation_logs/<logId>
operation_keys/<opKey>
operation_key_domains/<headId>
operation_key_domains/<versionId>
admin_audit/<auditId>
```

**顺序（冻结；同一失败只返回最先命中的码）**：

| # | 检查（按错误优先级；第 1、5 项为事务前校验/派生，第 2–4 项先预读并在事务内原序复核） | 失败 | 写 |
|---:|---|---|---:|
| 1 | DTO：jobId、body 精确字段、`expectedJobRevision`、Idempotency-Key 格式 | `PARAM_ERROR/400` | 0 |
| 2 | 组织存在且 `status==="active"` | 缺失 `NOT_FOUND/404`；停用 `FORBIDDEN/403` | 0 |
| 3 | 成员存在、`orgId` 匹配、`status==="active"`、主体等于 `actor.actorId`、`actorType==="user"` | 缺失/跨组织 `NOT_FOUND/404`；主体/状态/类型不符 `FORBIDDEN/403` | 0 |
| 4 | `membership.permissions` 含 `device.operation.retry` | `FORBIDDEN/403` | 0 |
| 5 | K2 配置与 op key 派生（事务前；缺失/非法） | `NOT_CONFIGURED/503` | 0 |
| 6 | operation domain（`applyOperationKeyDomain`） | `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH/409` | 0 |
| 7 | op key 重放/冲突/损坏 + 回执绑定（§4.4；含 audit 成对性） | 命中合法快照返回；否则 `CONFLICT/409` | 0（重放） |
| 8 | job 存在且 `job.orgId===orgId` | `NOT_FOUND/404` | 0 |
| 9 | **状态门禁**：`queued/sending/succeeded/terminal_failed/cancelled` → 拒绝；`awaiting_result` → 拒绝；未知状态 → 拒绝；`retryable_failed` 继续 | `INVALID_STATE`（前五种）/`INVALID_JOB`（awaiting/未知） | 0 |
| 10 | **形状校验**：仅 `retryable_failed` 调对应 validator；结构错误归一化（§4.5.1） | `INVALID_JOB/409` | 0 |
| 11 | 阶段/分类/预算：`cleanupPhase==="finalize"`；`result.errorKind!=="RETRYABLE"`；`attempts∉[1,3]` | `INVALID_STATE`（finalize）/`INVALID_JOB`（其余） | 0 |
| 12 | `job.revision===expectedJobRevision` | `REVISION_CONFLICT/409` | 0 |
| 13 | 时间门禁 `now>=nextAttemptAt` | `RETRY_NOT_DUE/409` | 0 |
| 14 | 构造写集并提交 | 成功 | J+L+O+D+A |

#### 4.5.1 validator 错误归一化（冻结）

validator 只在第 10 步、且 `job.state==="retryable_failed"` 时调用。任何结构性异常按下表归一化，**不把 validator 内部码直接暴露给调用方**：

| validator 抛出 | E07 对外 | 覆盖场景（基线事实） |
|---|---|---|
| `INVALID_JOB` | `INVALID_JOB/409` | 字段集/状态字段/结果结构非法（`h3a.mjs:167,176-208`；`h4b.mjs:85-118`） |
| `DISPATCH_SNAPSHOT_REQUIRED` | `INVALID_JOB/409` | enroll job 缺/坏 `dispatchSnapshot`（`h3a.mjs:30,54,99,110,117,147,164`） |
| `CLEANUP_SNAPSHOT_REQUIRED` | `INVALID_JOB/409` | revoke job 缺/坏 `cleanupSnapshot`（`h4b.mjs:64,73`） |
| `PARAM_ERROR` | `INVALID_JOB/409` | 坏 ID、非法安全整数、快照超 16 KiB 等 helper 抛错（`h3a.mjs:121`；`assertBoundedId`/`assertSafeInt`） |
| 其他结构码（当前 validator 不抛，防御性）`DEVICE_CLAIM_INVALID`/`DEVICE_CLAIM_CONFLICT`/`GRANT_SLOT_CONFLICT` | `INVALID_JOB/409` | 未来 validator 引入结构校验时统一失败关闭 |
| 其他同步异常 | `ADAPTER_UNAVAILABLE/503` | 非预期实现错误；零写、无 500、无 stack |

规则：

1. 归一化只发生在 E07 边界，**不修改、不放宽** H3/H4 validator，也不改变其端点行为。
2. validator 必须是纯同步调用，不得触达 store/Provider/clock/网络。
3. 缺快照、坏 ID、非法整数都按“记录损坏”处理，对外统一 `INVALID_JOB/409`；不得泄露具体 validator 码、字段名或原始 message。
4. 归一化后的错误同样零写；`build` 抛出即整事务不落盘。
5. 客户端输入错误仍由第 1 步 `PARAM_ERROR/400` 处理；第 10 步的 `PARAM_ERROR` 只可能来自记录本身，禁止混用。

**为什么第 7 步必须先于 job 状态**：同键合法重放必须在 job 已前进（甚至已 `sending`/`succeeded`）后仍返回原回执，否则“提交后确认丢失”无法恢复；但权限（第 2–4 步）必须先于重放，否则撤销权限后仍能读旧结果（07A R13/F16 语义，[L1038-L1054](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L1038-L1054)）。

**为什么状态先于 revision**：状态是动作的前置；revision 是该迁移的 CAS。`queued`/`terminal_failed` 等情形必须稳定返回 `INVALID_STATE`，不因 revision 是否过期而漂移；只有“状态仍是 `retryable_failed`”时，revision 不符才是有意义的 `REVISION_CONFLICT`。

**原子性**：

- 除第 1、5 项的事务前校验/派生与第 2–4 项的预读外，所有权威业务检查都在同一个 `store.transact` 的 build 内完成；预读不得作为放行依据；`LocalStore` 在克隆态构建，抛错即整事务不落盘（`1155b7b:admin-web/lib/store.mjs:263-316`）。
- 写集顺序：`[...domainWrites, job, log, opKey]`；audit 由 store 在同一次持久化中写入（`store.mjs:294-310`）。
- 任何未声明写、ID 不在 refs、log/audit ID 预占 → 整事务回滚或 409；不存在“部分写”。
- 本方法**不调用** Provider、不发网络、不连接设备、不写 Cloud。

### 4.6 状态迁移写集（按 job 形状，冻结）

共同部分：

| 对象 | 写入 |
|---|---|
| job | `state:"queued"`、`revision=expectedJobRevision+1`、`updatedAt=now`；其余业务字段不动；`attempts` 不动；`leaseGeneration` 不动；`leaseOwner/leaseExpiresAt/dispatchAuthorizedAt` 必须为 `null` 且保持 `null` |
| log | 确定性 ID `deterministicLogId(jobId,"queued",newRevision)`（`collections.mjs:481-486`），create-only；字段沿用 H3/H4 白名单（`orgId,jobId,action,fromState,state,actorType,actorId,at,revision,attempt,leaseGeneration,evidenceScope,errorKind,reasonCode,alertCode`），其中 `action=job.action`、`fromState:"retryable_failed"`、`state:"queued"`、`actorType:"user"`、`actorId=actor.actorId`、`attempt=job.attempts`、`leaseGeneration=job.leaseGeneration`、`errorKind/reasonCode/alertCode=null`；15 个语义字段，Store 另注入 `_id`/`updatedAt` |
| op key | 六字段，`result`=五字段回执（§4.9） |
| domain | 0–2 条（§4.4）；缺失时两条，存在时 0 条 |
| audit | 确定性 ID（附录 A），同事务；字段与 Store `target` 规则见 §4.9.3；`action` 与本卡新命名空间一致，不得复用旧 requeue 的 action 字符串 |

**enroll job（H3 形状）**：只写 `state/revision/updatedAt`；**保留** `nextAttemptAt`（已到期的原值）与 `result`（`retryable_failed` 的原值），不重写、不清空、不延长。依据：`h3a.mjs:181-188` 要求 queued 且 attempts>0 时两者必须存在；H3 Q07 要求“保留原 attempt 及 due 时间供领取复核”（`HK-AI-04-H3-LEASE-DISPATCH-DESIGN.md:101`）。

**revoke job（H4 形状）**：写 `state/revision/updatedAt/nextAttemptAt:null/result:null`；保留 `cleanupPhase:"dispatch"`、`providerOutcome:null`、`finalizeAttempts:0`、`cleanupSnapshot`。依据：`h4b.mjs:100-103` 要求 queued 时两者必须为 null；门禁已在第 13 步通过，清空不是“override”。

**禁止**：`state:"sending"`；任何 `lease*` 写；`attempts±`；`leaseGeneration±`；新建/修改 `nextAttemptAt`；把 job 直接写终态；写 grant/credential/device/claim/slot/evidence。

### 4.7 时间门禁、可信时钟与溢出（冻结）

1. **时间源**：只用服务端注入的可信时钟（与 `FaceCredentialService` 的 `now` 同源）；客户端 body 不得携带任何时间字段。
2. **时钟合法性**：`now` 必须 `Number.isSafeInteger(now) && now>=0`；否则 `ADAPTER_UNAVAILABLE/503`、零写。
3. **单调性**：`now < job.result.finishedAt` 视为时钟回拨/记录异常 → `ADAPTER_UNAVAILABLE/503`、零写。
4. **门禁**：`now >= job.nextAttemptAt` 才允许；`now === nextAttemptAt` **算到期**；`now < nextAttemptAt` → `RETRY_NOT_DUE/409`、零写。
5. **不 override**：本方法没有 `force`/`now`/`nextAttemptAt`/`delay`/`backoff` 入参；不得“立即重试”或重设退避；不写新的 `nextAttemptAt`。
6. **溢出**：`newRevision = expectedJobRevision + 1` 必须为安全整数且 `<= Number.MAX_SAFE_INTEGER - 2`（与 `h3a.mjs:176` 的 stored-revision 上限一致），否则 `INVALID_JOB/409`、零写。`attempts` 不做算术，天然无溢出。
7. **无定时器**：不存在延迟任务、后台调度、`Retry-After`、自动重试；失败不触发任何后续动作。

### 4.8 revision CAS、并发、lease、reconcile、ack loss（冻结）

| 竞争/场景 | 线性化点 | 结果 |
|---|---|---|
| 同键两并发 | operation key 唯一 ID + 单事务 + 确定性 audit | 一次迁移；两个请求都得到同一回执；op key/log/audit 各 1 条 |
| 异键并发、同 expectedJobRevision | job revision CAS（第 12 步）+ 状态门禁（第 9 步） | 一胜；败者读到 `queued` → `INVALID_STATE/409`，零写；不得用旧 revision 重试 |
| retry vs worker claim | retry 只接受 `retryable_failed`；claim 只接受 `queued` | 互斥；retry 先提交则 claim 随后按现约定 `attempts+1`、清 due/result（`h3a.mjs:228-234`、`h4b.mjs:225-227`） |
| claim 先提交（`sending`） | lease 状态 | retry `INVALID_STATE/409`，零写；**不**清 lease、**不**增/减 `leaseGeneration`、**不**消费 fence |
| retry vs reconcile | 状态互斥：`retryable_failed` vs `awaiting_result` | `awaiting_result` 时 retry `INVALID_JOB/409`；reconcile 未实现（E08 blocked），retry 不得替代 |
| reconcile 已提交终态 | 状态检查 | retry `INVALID_STATE/409`，零写 |
| 提交后 ack loss | 已提交的 op key + audit | 同键重放返回**原快照**（可能已过期）；核心写零重复；不读当前 job |
| 事务 callback 重跑 | 确定性 log/audit ID + create-only | 仅一次提交；预占 ID → 整事务回滚 |

**回执是历史快照，不是实时状态**：`ack loss` 后 job 可能已被 claim 到 `sending`；回执仍写 `state:"queued"`、旧 `revision/attempts`。客户端必须把回执当“受理确认”，当前状态一律重新 `queryJob`（Q7 的唯一权威入口）。

### 4.9 公开 DTO 与四类字段白名单（冻结）

#### 4.9.1 公开响应 DTO（唯一对外形状）

```json
{
  "jobId": "job-...",
  "state": "queued",
  "revision": 4,
  "attempts": 2,
  "nextAttemptAt": 1763000000000
}
```

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `jobId` | string | `job._id`（必须等于查询目标；若存在 `job.jobId` 且不等 → `INVALID_JOB`） | 不透明 ID |
| `state` | `"queued"` | 提交后的 job 状态 | 固定值；不返回 `sending` |
| `revision` | 正安全整数 | 提交后的 job `revision` | 只来自服务端记录 |
| `attempts` | 1–3 安全整数（成功路径） | 重排时的 `job.attempts`（**不增加**，Q2） | 不是下一次 dispatch 的计数 |
| `nextAttemptAt` | number 或 null | enroll：保留的原 due；revoke：`null` | 不是新退避 |

公开响应**只允许**上表五个字段。以下一律禁止：`leaseOwner/leaseExpiresAt/leaseGeneration`、`requestDigest`、operation key/op id、原始 Idempotency-Key、`result/errorKind/reasonCode`、异常 message/stack、`orgId/actorId/membershipId`、`grantId/credentialId/deviceId/personId`、设备序列号/IP/MAC、文件 objectKey/字节、`auditId/logId`、`cleanupPhase/providerOutcome`、任何“已确认发送/设备成功”的暗示。

#### 4.9.2 内部 operation log（同事务写入）

精确白名单（与 §4.6 一致）：`orgId, jobId, action, fromState, state, actorType, actorId, at, revision, attempt, leaseGeneration, evidenceScope, errorKind, reasonCode, alertCode`；Store 事务另注入 `_id` 与 `updatedAt`（非语义元数据，不参与契约判断）。

- **允许**：`orgId/actorId/leaseGeneration/errorKind/reasonCode/alertCode`（内部审计与回放需要；本端点重排时 `errorKind/reasonCode/alertCode` 恒为 `null`）。
- **禁止**：`requestDigest`、op key、原始 Idempotency-Key、异常 message/stack、Provider payload、PII/设备凭据/序列号/objectKey。
- §4.6 对 log 的写入要求不违反公开 DTO 禁入清单：这是内部记录，不是公开响应。

#### 4.9.3 内部 admin_audit（同事务、确定性 ID）

精确字段：`_id`（auditId）、`orgId`、`actorId`、`actorType`、`action`、`target`、`createdAt`。

- **允许**：`orgId/actorId`（Store 固定写入）；`target` 由 Store 按本次 writes 生成，可包含内部记录 ID（job/log/op key/domain）。
- **禁止**：`requestDigest` 值、原始 Idempotency-Key、异常 message/stack、Provider payload、PII/设备凭据。
- `target` 中出现的 `operation_keys/<opKey>` 是 HMAC 派生内部标识，不是原始幂等键；不得出现在公开响应。

#### 4.9.4 operation key 记录与 result

逻辑六字段：`orgId, realm, keyVersion, requestDigest, result, createdAt`；Store 事务另注入 `_id` 与 `updatedAt`（非语义元数据）；`result` 精确五字段（§4.9.1 回执）。

- **允许**：`orgId/realm/keyVersion/requestDigest/createdAt`（内部校验）；`result` 仅五字段。
- **禁止**：原始 Idempotency-Key、日志/审计字段（`actorId/leaseGeneration/errorKind/action/at` 等）、异常 message/stack、PII/设备字段。

#### 4.9.5 跨载体规则（解决“禁入清单与写集冲突”）

- §4.6 要求写入的 `orgId/actorId/leaseGeneration/errorKind` 等是**内部 log/audit/job 字段**，受 4.9.2/4.9.3 白名单允许；它们不得出现在 4.9.1 公开响应。
- `requestDigest` 只允许在 4.9.4 的 op key 记录中；不得进入公开响应、log、audit。
- 原始 Idempotency-Key、异常 message/stack、Provider 原始响应、PII/设备凭据在**任何载体**都禁止。
- 四类白名单独立：公开 DTO 不得因内部需要而扩字段；内部记录不得因公开禁入而删必要字段。

**成功状态码（若未来获准接线）**：统一 `200`；不使用 `201`/`202`；不返回 `Retry-After`。本卡不注册，故不构成 HTTP 契约。

### 4.10 错误映射（提案；只使用既有码）

| code | HTTP | 触发 | 写 |
|---|---:|---|---:|
| `PARAM_ERROR` | 400 | DTO/未知字段/ID/key 格式/revision 类型 | 0 |
| `FORBIDDEN` | 403 | 组织停用、成员失效、缺 `device.operation.retry`、actorType 非 user | 0 |
| `NOT_FOUND` | 404 | 组织/成员/job 不存在或跨组织（同态） | 0 |
| `REVISION_CONFLICT` | 409 | `expectedJobRevision` 与当前 revision 不符 | 0 |
| `INVALID_STATE` | 409 | `queued/sending/succeeded/terminal_failed/cancelled`、finalize 阶段 | 0 |
| `INVALID_JOB` | 409 | job 形状/结果分类/预算/溢出/unknown result/validator 结构错误归一化 | 0 |
| `RETRY_NOT_DUE` | 409 | `now < nextAttemptAt` | 0 |
| `CONFLICT` | 409 | 同键异摘要、op key/result/audit 损坏或预占 | 0 |
| `DOMAIN_INCOMPLETE` | 409 | K2 domain 单边缺失/损坏 | 0 |
| `DOMAIN_MISMATCH` | 409 | K2 realm 版本/换钥/fingerprint 不符 | 0 |
| `NOT_CONFIGURED` | 503 | K2 配置缺失/非法、非 LocalStore/Mock 合成范围 | 0 |
| `ADAPTER_UNAVAILABLE` | 503 | 时钟非法/回拨、Store 异常 | 0 |

不新增错误码、不新增状态名、不新增权限点（07A §2.9 [L403-L413](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L403-L413)）。

### 4.11 旧入口封闭与兼容（Q7，硬前置）

**封闭（独立提交，需另行批准；本卡不改代码）**：

1. 删除/私有化 `H3MockDispatcher.requeue`（`h3b.mjs:444-487`）与 `H4MockRevoker.requeue`（`h4b.mjs:482-519`），移除调用点；旧行为测试改为“入口不存在/不可调用”的负向断言。
2. 清理 `routes.mjs` 的 E07 描述行（`routes.mjs:47-52`）按 07A Q8 的独立小提交执行，不夹带业务变更。
3. 增加静态断言：生产代码无 `requeue(` 可调用入口、`server.mjs` 无 `/retry` 分支、无“旧 requeue 写 op key”的误解。
4. 封闭完成前，严格服务不得上线；封闭与严格服务不得在同一改动里混做。

**兼容规则**：

| 旧对象 | 新契约的处理 |
|---|---|
| 旧 requeue 的 queued job（无论 H3 还是 H4 形状） | 新 retry 视为 `INVALID_STATE`；不得“回滚/重置”成可重试 |
| 旧 requeue 的 queued 日志 | 只作历史；不作为 K2 回执、不参与重放 |
| 旧 requeue 的 audit（`H4 requeue` / `重排合成门禁任务`） | 不满足新 `audit-07d-v1:` 命名空间；不得当作成功凭据 |
| 旧 requeue 从未写 `operation_keys` | 新服务不得从日志/审计反推/补写 op key |
| 旧 job 再次失败进入 `retryable_failed` | 允许用**新 key**重试（当前记录满足全部前置）；旧 key 复用会因摘要不同 `CONFLICT` |
| 其他 K2 method 的 op key | method 不同，互不重放；不受影响 |

**禁止**：迁移、回填、重写历史、把旧 audit/log 改造成新回执、为旧 job 伪造 op key。

### 4.12 HTTP 接线门禁（Q8）

E07 HTTP **仍 blocked**。接线必须依次满足：

1. 本设计获 Codex 批准（2026-11-16 技术复审通过，已满足）；
2. 严格服务实现（新 `retry` 方法，不复用旧 requeue）完成并通过独立复审；
3. §5 测试矩阵全部执行通过（含并发/重放/零写/敏感字段）；
4. 兼容/封闭审查通过（§4.11 的封闭已完成、旧数据不误用）；
5. 07B `queryJob` revision 读模型合并（`59a737a` 已终审通过、P2 已关闭，但仍未合并；合并前 UI 无合法 revision 来源）；
6. **另行**的 HTTP 编码卡批准，并在同一卡中同步 `routes.mjs`/`server.mjs` 与 DTO/错误映射。

本卡不修改 `routes.mjs`/`server.mjs`，不注册、不调用、不新增旁路。

### 4.13 与现有 validator 的兼容约束

1. 严格服务必须复用 `validateDispatchJob`（`h3a.mjs:161-210`）与 `validateRevokeJob`（`h4b.mjs:84-120`），不得复制/放宽；只在状态门禁通过（`state==="retryable_failed"`）后调用（§4.5 第 10 步）。
2. 不得为了让“统一写集”通过而修改任一 validator；如需统一 job 形状，另开 schema 迁移卡（本卡不涉及）。
3. 配置/运行范围：只批准 `LocalStore` + 合成 Mock 范围；其他 store/provider/live/Cloud → `NOT_CONFIGURED/503`、零写（与 H3-b/H4-b 的 `NOT_CONFIGURED` 边界一致，`h3b.mjs:208-214`、`h4b.mjs` 构造器同语义）。
4. 事务 refs 固定 8 条，无候选扫描、无 90-ref 风险；若未来增加 refs，必须重新证明 ≤90 且不改变既有 82/83 边界。
5. validator 的结构性错误按 §4.5.1 归一化为 `INVALID_JOB/409`；归一化只发生在 E07 边界，不改变 H3/H4 端点或 validator 自身行为。

## 5. 测试矩阵（90 条；编号连续、每条有预期）

### 5.1 记号

- `Z`：全库内容级零变化（job/log/op key/domain/audit/所有其他集合的记录、排序 ID、计数均不变）。
- `J+L+O+D+A`：成功写集 = job + 一条 queued log + op key + 0–2 条 domain + 一条确定性 audit。
- `P0`：Provider 调用 0（本方法任何路径都不得调用 Provider）。
- 矩阵中的 `200/403/404/409/503` 是服务层错误码与“若未来获准接线”的 HTTP 映射；本卡未注册 HTTP，执行阶段以服务层返回值为准。
- 每个失败行同时断言：无 500、无 stack、无配置值、无 Provider、无设备/网络调用、`store.data` 前后 deepEqual。

### 5.2 P：权限与租户（P01–P13）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| P01 | 有 `device.operation.retry`，到期 `retryable_failed` | 200 五字段回执，`state=queued` | 0 | J+L+O+D+A |
| P02 | 缺 `device.operation.retry`（其他 device.* 齐全） | `FORBIDDEN/403` | 0 | Z |
| P03 | 仅有 `device.audit.read` | `FORBIDDEN/403`（不隐含 retry） | 0 | Z |
| P04 | 仅有 `device.operation.reconcile` | `FORBIDDEN/403` | 0 | Z |
| P05 | `admin` 角色、permissions 为空 | `FORBIDDEN/403` | 0 | Z |
| P06 | membership `status!=="active"` | `FORBIDDEN/403` | 0 | Z |
| P07 | organization `status!=="active"` | `FORBIDDEN/403` | 0 | Z |
| P08 | membership 属另一组织 | `NOT_FOUND/404` 同态 | 0 | Z |
| P09 | job 属另一组织 | `NOT_FOUND/404` 同态（不得 403） | 0 | Z |
| P10 | 预读后、提交前撤销 retry 权限 | `FORBIDDEN/403`，事务内复核生效 | 0 | Z |
| P11 | 首次成功后撤销权限，再同键重放 | `FORBIDDEN/403`；不得命中旧回执 | 0 | Z |
| P12 | membership 主体与 `actor.actorId` 不符 | `FORBIDDEN/403` | 0 | Z |
| P13 | `actor.actorType` 为 `system`/缺失 | `FORBIDDEN/403`（只允许 user） | 0 | Z |

### 5.3 S：状态与异常分类（S01–S16）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| S01 | enroll `retryable_failed`、dispatch、已到期 | 200；job `queued`、revision+1、attempts 不变、nextAttemptAt 保留 | 0 | J+L+O+D+A |
| S02 | revoke `retryable_failed`、`cleanupPhase=dispatch`、已到期 | 200；job `queued`、`nextAttemptAt=null`、`result=null` | 0 | J+L+O+D+A |
| S03 | `queued` | `INVALID_STATE/409` | 0 | Z |
| S04 | `sending`（活动 lease） | `INVALID_STATE/409`；lease 三字段零改 | 0 | Z |
| S05 | `awaiting_result` | `INVALID_JOB/409`（H3 D53） | 0 | Z |
| S06 | `succeeded` | `INVALID_STATE/409` | 0 | Z |
| S07 | `terminal_failed`（`RETRY_EXHAUSTED`） | `INVALID_STATE/409`（Q4） | 0 | Z |
| S08 | `cancelled`（enroll 与 revoke 两形状） | `INVALID_STATE/409`；状态门禁先于 validator，validator 不放宽 | 0 | Z |
| S09 | revoke `retryable_failed`、`cleanupPhase=finalize` | `INVALID_STATE/409`（E09 边界） | 0 | Z |
| S10 | `retryable_failed`、`attempts=4`（损坏） | `INVALID_JOB/409` | 0 | Z |
| S11 | `retryable_failed`、`attempts=0`（损坏） | `INVALID_JOB/409` | 0 | Z |
| S12 | `retryable_failed`、`result.errorKind="UNKNOWN_RESULT"` | `INVALID_JOB/409` | 0 | Z |
| S13 | `retryable_failed`、`result.errorKind="LOCAL_FINALIZE"/"PRE_SEND_BLOCKED"/"TERMINAL"` | `INVALID_JOB/409` | 0 | Z |
| S14 | `result` 缺失/数组/多字段/`attempt!==attempts`/`outcome!=="retryable_failed"` | `INVALID_JOB/409` | 0 | Z |
| S15 | action 未知/缺失；enroll 带 `cleanupPhase`；revoke 缺 `cleanupSnapshot` | `INVALID_JOB/409` | 0 | Z |
| S16 | `retryable_failed` 但 validator 抛 `DISPATCH_SNAPSHOT_REQUIRED`/`CLEANUP_SNAPSHOT_REQUIRED`/坏 ID/非法整数 | `INVALID_JOB/409`（归一化；不泄露 validator 内部码） | 0 | Z |

### 5.4 R：revision 与 CAS（R01–R09）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| R01 | `expectedJobRevision===job.revision` | 成功；新 revision=旧+1 | 0 | J+L+O+D+A |
| R02 | expected 落后 1（并发已改） | `REVISION_CONFLICT/409` | 0 | Z |
| R03 | expected 超前 1 | `REVISION_CONFLICT/409` | 0 | Z |
| R04 | expected 缺失 | `PARAM_ERROR/400` | 0 | Z |
| R05 | expected 为 `0/-1/1.5/"7"/NaN/Infinity/2^53` | `PARAM_ERROR/400` | 0 | Z |
| R06 | 使用 `expectedRevision`/`expectedCredentialRevision` 旧名 | `PARAM_ERROR/400` | 0 | Z |
| R07 | expected=`MAX_SAFE_INTEGER-2`（+1 越过 stored 上限） | `INVALID_JOB/409` | 0 | Z |
| R08 | expected=`MAX_SAFE_INTEGER` | `INVALID_JOB/409` | 0 | Z |
| R09 | body 含 `attempts/nextAttemptAt/reason/message/force/override/jobId/orgId/actorId` | `PARAM_ERROR/400` | 0 | Z |

### 5.5 K：K2、domain、重放（K01–K16）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| K01 | 缺 `Idempotency-Key` | `PARAM_ERROR/400`；不建 op key | 0 | Z |
| K02 | key 15/129 位、空格、斜杠、数组、重复头 | `PARAM_ERROR/400` | 0 | Z |
| K03 | 合法首次 | op key 语义六字段（+ Store 注入 `_id`/`updatedAt`）；`result` 精确五字段；原始 key 零落库 | 0 | J+L+O+D+A |
| K04 | 同键同摘要，job 仍 `retryable_failed` | 同回执；**零写**（audit 不新增） | 0 | Z |
| K05 | 同键、`expectedJobRevision` 改变 | `CONFLICT/409`；op key 不变 | 0 | Z |
| K06 | 同键、`jobId` 改变 | `CONFLICT/409` | 0 | Z |
| K07 | 同键重放但 job 已推进到 `sending`/`succeeded` | 仍返回原快照；零写；不读当前状态 | 0 | Z |
| K08 | K2 配置缺失/非法（Base64/长度/版本/realm） | `NOT_CONFIGURED/503` | 0 | Z |
| K09 | domain head/version 均缺 | 写 head+version 两条 + J+L+O+A | 0 | J+L+O+D+A |
| K10 | domain 单边缺失/损坏/kind 不符 | `DOMAIN_INCOMPLETE/409` | 0 | Z |
| K11 | domain 版本/换钥/fingerprint 不符 | `DOMAIN_MISMATCH/409` | 0 | Z |
| K12 | op key `result` 结构损坏（null/数组/错 jobId/state≠queued/revision 非安全整数或超上限/attempts 越界/nextAttemptAt 超范围/多字段/少字段） | `CONFLICT/409`；不修复 | 0 | Z |
| K13 | op key 存在但确定性 audit 缺失 | `CONFLICT/409`（防 store 补空 audit） | 0 | Z |
| K14 | audit 存在但 op key 缺失 | `CONFLICT/409`（预占/损坏） | 0 | Z |
| K15 | 同键在 job 再次失败后复用（revision 已变） | `CONFLICT/409`（摘要不同） | 0 | Z |
| K16 | op key `result` 类型合法但 `revision !== expectedJobRevision + 1`（篡改） | `CONFLICT/409`；**零写**，不得当成功重放 | 0 | Z |

### 5.6 T：时间与时钟（T01–T06）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| T01 | `now===nextAttemptAt` | 成功（等号算到期） | 0 | J+L+O+D+A |
| T02 | `now===nextAttemptAt-1` | `RETRY_NOT_DUE/409` | 0 | Z |
| T03 | 成功后检查边界字段 | enroll：nextAttemptAt 原值、attempts 原值、leaseGeneration 原值；revoke：nextAttemptAt=null | 0 | J+L+O+D+A |
| T04 | body 传 `now/nextAttemptAt/delay/backoff/force` | `PARAM_ERROR/400`；服务端只用可信时钟 | 0 | Z |
| T05 | 时钟非安全整数/负数/早于 `result.finishedAt` | `ADAPTER_UNAVAILABLE/503` | 0 | Z |
| T06 | 失败后等待/重试/定时器观察 | 无自动重试、无 `Retry-After`、Provider 0 | 0 | Z |

### 5.7 C：并发、lease、reconcile、ack loss（C01–C09）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| C01 | 同键两并发 | 一次迁移；两回执相同；op key/log/audit 各 1 | 0 | J+L+O+D+A |
| C02 | 异键同 revision 两并发 | 一胜；另一 `INVALID_STATE/409`；零写 | 0 | Z |
| C03 | retry 先提交，随后 claim | claim 读到 `queued`，attempts+1、清 due/result；retry 未写 lease | 0 | J+L+O+D+A |
| C04 | claim 先提交（sending），随后 retry | `INVALID_STATE/409`；lease 零改 | 0 | Z |
| C05 | `awaiting_result` 同时 retry + reconcile（E08 未实现） | retry `INVALID_JOB/409`；不得替代对账 | 0 | Z |
| C06 | 其他路径先把 job 推到终态 | retry `INVALID_STATE/409`；零写 | 0 | Z |
| C07 | 提交后 ack loss + 同键重放 | 原快照；核心写零重复；不读当前 job | 0 | Z |
| C08 | 事务 callback 重跑/预占 log/audit ID | 只提交一次；预占则整事务回滚 | 0 | Z |
| C09 | 旧 worker fence 观察 | retry 前后 leaseOwner/leaseExpiresAt/leaseGeneration 零改 | 0 | J+L+O+D+A |

### 5.8 O：输出、敏感与兼容（O01–O13）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| O01 | 成功响应键集合 | 精确 `jobId/state/revision/attempts/nextAttemptAt`，无额外键 | 0 | J+L+O+D+A |
| O02 | 同键重放响应 | 与首次逐字段相等（含 nextAttemptAt） | 0 | Z |
| O03 | 响应扫描 | 无 lease、`requestDigest`、op key、原始 Idempotency-Key | 0 | Z |
| O04 | 响应扫描 | 无 `result/errorKind/reasonCode/message/stack` | 0 | Z |
| O05 | 响应扫描 | 无 org/actor/授权/凭证/设备/人员/文件字段 | 0 | Z |
| O06 | 响应扫描 | 无 auditId/logId/createdAt/updatedAt | 0 | Z |
| O07 | 类型断言 | `state==="queued"`；enroll `nextAttemptAt` 为 number，revoke 为 null | 0 | J+L+O+D+A |
| O08 | 错误映射 | 只用 §4.10 既有码；消息固定、无存在性/配置泄漏 | 0 | Z |
| O09 | 跨组织/不存在 job | 404 状态与消息完全同态 | 0 | Z |
| O10 | 静态检查（封闭后） | 无旧 `requeue` 可调用入口、`server.mjs` 无 `/retry` 分支、E07 描述行已按 Q8 清理 | 0 | Z |
| O11 | 构造旧 requeue 的 queued 状态/日志/audit，新 key 请求 | `INVALID_STATE/409`；不误用旧结果、不迁移 | 0 | Z |
| O12 | 日志/审计/op key/响应敏感扫描 | 无原始 key、digest 原值、手机号/证件/序列号/objectKey | 0 | Z |
| O13 | 成功写后检查内部 log/audit 白名单 | log 精确 15 字段（含 orgId/actorId/leaseGeneration；errorKind/reasonCode/alertCode=null）；audit 含 orgId/actorId/target/createdAt；二者不含 requestDigest/原始 key/message/stack | 0 | J+L+O+D+A |

### 5.9 N：失败零写（N01–N08）

| ID | 失败类 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| N01 | DTO/未知字段/key 格式 | `PARAM_ERROR/400` | 0 | Z |
| N02 | 权限/组织/成员 | `FORBIDDEN/403` 或 `NOT_FOUND/404` | 0 | Z |
| N03 | 不存在/跨组织 job | `NOT_FOUND/404` | 0 | Z |
| N04 | 状态/阶段/分类/预算 | `INVALID_STATE`/`INVALID_JOB/409` | 0 | Z |
| N05 | revision CAS | `REVISION_CONFLICT/409` | 0 | Z |
| N06 | 时间门禁 | `RETRY_NOT_DUE/409` | 0 | Z |
| N07 | K2/domain/重放冲突 | `CONFLICT`/`DOMAIN_*`/`NOT_CONFIGURED` | 0 | Z |
| N08 | 损坏记录/回执校验失败 | `CONFLICT`/`INVALID_JOB` | 0 | Z |

### 5.10 数量与覆盖对照

| 系列 | 范围 | 条数 | 覆盖 |
|---|---|---:|---|
| P | P01–P13 | 13 | 权限、组织、成员、跨组织、撤销后重放、actorType |
| S | S01–S16 | 16 | 六种状态逐一拒绝（enroll/revoke）、finalize 边界、异常分类、validator 归一化 |
| R | R01–R09 | 9 | revision CAS、类型、旧名、溢出、额外字段 |
| K | K01–K16 | 16 | K2、domain、严格重放、异摘要、损坏、回执 revision 篡改、audit 成对性 |
| T | T01–T06 | 6 | 到期边界、时钟、溢出/无 override、无定时器 |
| C | C01–C09 | 9 | 并发、claim/lease、reconcile、ack loss、callback |
| O | O01–O13 | 13 | 五字段 DTO、四类白名单、敏感字段、同态 404、旧入口封闭、兼容 |
| N | N01–N08 | 8 | 八类失败零写 |
| **合计** | — | **90** | 权限/状态/revision/K2/时间/并发/重放/零写/敏感字段/四类白名单全覆盖 |

## 6. 实施前置与验收门禁

| 门禁 | 内容 | 状态（本卡） |
|---|---|---|
| G0 | 本设计获 Codex 批准 | 已获技术复审通过（2026-11-16）；仅限设计 |
| G1 | 旧 `h3b.requeue`/`h4b.requeue` 封闭（独立提交、独立复审） | 未开始；本卡不改代码 |
| G2 | 严格 `retry` 服务实现（新方法、复用 validator、K2/domain/审计同事务） | 未开始 |
| G3 | §5 矩阵 90 条可执行并通过 | 未开始（本卡为未来矩阵，不宣称已通过） |
| G4 | 兼容/封闭审查：旧日志/审计/queued 不误用，无迁移/回填 | 未开始 |
| G5 | 07B `queryJob` revision 合并（HTTP/UI 合法 revision 来源） | 未合并；远端 tip `59a737a` 已终审通过、P2 已关闭；合并前仍是阻断 |
| G6 | 另行 HTTP 编码卡批准 + `routes.mjs`/`server.mjs` 同步登记 | 未批准；E07 HTTP 仍 blocked |

**本卡明确不做**：不修改生产代码/测试、不注册 HTTP、不实现自动重试、不开始 H4-c C2/C3、不实现 reconcile/finalize-retry、不调用 Provider/设备/生产云、不合并 `main`、不新增权限/状态/错误码。

## 7. 追溯矩阵

| 要求 | 设计位置 | 测试 |
|---|---|---|
| 仅 `retryable_failed`，逐状态拒绝 | §4.1、§4.2 | S01–S16、P 系列 |
| UNKNOWN_RESULT 仅 query/reconcile | §2.8、§4.2 | S05、S12、C05 |
| 异常分类 fail closed | §4.2、§4.13 | S12–S16、N08 |
| 输入 jobId/expectedJobRevision/Idempotency-Key | §4.3 | R01–R09、K01–K02 |
| 拒绝 reason/message/额外字段 | §4.3 | R09、O08、N01 |
| K2 独立 method、结构化 digest、domain | §4.4 | K03–K14 |
| 同键重放异摘要冲突 | §4.4 | K04–K07、K15–K16 |
| 损坏 result 失败关闭 | §4.4、§4.9 | K12–K14、K16、N08 |
| 校验先后与原子性 | §4.5 | N 系列、C08 |
| revision/attempts/nextAttemptAt/lease/leaseGeneration | §4.6、§4.7 | S01–S02、T01–T03、C09 |
| 错误/result 清理保留 | §4.6 | S01–S02、T03 |
| 时间门禁、可信 clock、溢出 | §4.7 | T01–T05、R07–R08 |
| revision CAS、并发、lease、reconcile、ack loss | §4.8 | R01–R03、C01–C07 |
| operation key create-only、失败零写 | §4.4、§4.5 | K03、K13–K14、N01–N08 |
| 公开 DTO/日志/审计/op key 四类白名单 | §4.9 | O01–O07、O12–O13 |
| validator 结构错误归一化 | §4.5.1、§4.13 | S15–S16 |
| revoke cancelled 与 enroll 同码 | §4.2、§4.5 第 9 步 | S08 |
| terminal_failed 永不允许 | Q4、§4.2 | S07、S09 |
| 不额外要求 audit.read | Q5、§4.5 | P03、P11 |
| 成功仅存五字段快照 | Q6、§4.4、§4.9 | K03、K12、K16 |
| 先封闭旧入口、旧结果不误用 | Q7、§4.11 | O10–O11 |
| HTTP 另行批准 | Q8、§4.12 | O10（静态 0 注册） |

## 8. 交付核验

### 8.1 变更范围

```text
git status --porcelain
git show --stat --oneline HEAD
git diff --check
git diff --stat HEAD^..HEAD
```

预期：仅 `docs/tasks/HK-AI-07D-RETRY-REQUEUE-DESIGN-2026-11-15.md`；无生产代码、测试、路由、server 变更。

### 8.2 行号与链接核验

- 相对链接：解析本文所有非 `http(s)` 链接，确认文件存在、`#Lx-Ly` 的 `y` 不超过文件行数。
- 绝对链接：以本机 git 对象复核 `commit:path:line`（与 GitHub permalink 同一对象），保证提交存在、行号在范围内。
- 交叉核对：`state.mjs`、`dto.mjs`、`h3a.mjs`、`h3b.mjs`、`h4b.mjs`、`service.mjs`、`collections.mjs`、`store.mjs`、`routes.mjs`、`org.mjs` 的行号均在 `1155b7b` 工作树复核；07A/07B/H4/H4-c 用各自提交复核。

### 8.3 敏感扫描

对全文执行：云厂商密钥、私钥块、口令/密钥/令牌赋值、32 字节 Base64、64 位 hex、手机号、身份证号、原始 Idempotency-Key、`requestDigest` 原值、设备序列号。目标：零命中（示例值使用占位符）。

### 8.4 提交与推送

- 提交：本卡交付时如环境允许，提交单一 Markdown；提交说明引用 `HK-AI-07D`、基线 `1155b7b` 与 Q1–Q8。
- 推送：仅普通 push `docs/hk-face-retry-requeue-design`，**禁止 force**；推送后核对远端 SHA。
- 阻断记录：当前会话 `git ls-remote`/推送因无 GitHub 凭据失败（`SEC_E_NO_CREDENTIALS`）；远端 SHA 已用公开 API 只读核验（§1.1）。若提交时仍不可推送，按“本地已提交、远端未推送”如实回报，不伪造远端 SHA。

## 附录 A：字段与 ID 公式（冻结）

| 对象 | 公式/字段 |
|---|---|
| K2 method | `face.operation.retry` |
| op key | `operationKey({orgId, method:"face.operation.retry", actorType:"user", actorId, idempotencyKey, config})` |
| requestDigest | `SHA-256(JSON.stringify(stable({jobId, expectedJobRevision})))`，stable 为递归 key 升序 |
| queued log ID | `deterministicLogId(jobId, "queued", expectedJobRevision+1)` |
| audit ID | `audit-07d-v1:` + `SHA-256(JSON.stringify(["HK-AI-07D/retry-audit","v1",orgId,jobId,opKey]))`.hex.slice(0,32) |
| audit 字段 | `{auditId, orgId, actorId, actorType:"user", action:"HK-AI-07D retry"}` |
| op key 记录 | `{orgId, realm, keyVersion, requestDigest, result:{jobId,state,revision,attempts,nextAttemptAt}, createdAt}` |
| 回执 | `{jobId, state:"queued", revision, attempts, nextAttemptAt}` |
| job 写（enroll） | `{state:"queued", revision:R+1, updatedAt:now}`；保留 result/nextAttemptAt/attempts/leaseGeneration |
| job 写（revoke dispatch） | `{state:"queued", revision:R+1, updatedAt:now, nextAttemptAt:null, result:null}`；其余不变 |
| 时钟 | 服务端可信 `now`；安全整数、≥0、≥`result.finishedAt`；客户端不可传入 |
| 溢出 | `R+1 <= Number.MAX_SAFE_INTEGER-2` |

## 附录 B：本卡不做的事

- 不修改 `h3a.mjs`、`h3b.mjs`、`h4b.mjs`、`service.mjs`、`collections.mjs`、`store.mjs`、`routes.mjs`、`server.mjs` 或任何测试。
- 不实现 retry 服务、不封闭旧 requeue、不迁移/回填旧 job。
- 不实现 reconcile（E08）或 finalize-retry（E09）；不开始 H4-c C2/C3。
- 不注册 HTTP、不新增权限/状态/错误码、不新增路由/旁路。
- 不调用 Provider、不连接设备、不创建 Cloud 资源、不合并 `main`。
- 不把本设计的任何“提案/矩阵”写成“已实现/已通过”。
