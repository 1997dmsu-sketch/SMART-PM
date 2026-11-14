# HK-AI-07A 门禁 HTTP 接线契约（Codex 已裁定 · 设计关闭）

> **状态：Codex 已裁定（2026-11-14），本卡设计关闭。设计关闭不等于 HTTP 编码批准。** 九个端点在本卡合并后仍全部关闭；注册、调用、DTO 实现必须另发编码卡并重新复审。
>
> **本卡只写这一份 Markdown：不注册路由、不调用应用 HTTP、不修改 `server.mjs`、不接 Provider、不连接设备、不实现 retry、不开始 H4-c C2/C3、不修改服务层生产代码或测试、不新增权限名或状态名。**
>
> 本轮为“裁定写回”：把上一稿“待 Codex 裁定”的 Q1–Q8 逐条写回为 **Codex 已裁定**，每题注明裁定日期 **2026-11-14** 与依据；清理与新裁定冲突的旧段落（revoke bodyless 冻结、E06 契约冻结、读模型列表扩展、`routes.mjs` 三方案、E05 `expectedRevision` 等），所有未实现项统一收敛为 `blocked` 或 `proposed`。
>
> **裁定效力边界**：Codex 裁定只关闭“设计争议”，不构成任何端点的 HTTP 编码批准、不改变 `server.mjs` 注册状态、不解除 H4-c 阶段门禁、不授权连接 Provider/设备/生产云。编码仍须独立卡片并逐项引用本卡端点 ID。

- 服务基线：`feat/hk-face-h4b-mock-cleanup` @ `1155b7ba65991d324fb8b22bb8f7dd87f49428f9`
- H4-c 设计基线：`docs/hk-face-h4c-reconciliation-design` @ `b15acebe0a8049f316797bbbd2692c55de25d111`
- H4-c 设计批准：[H4-c 设计终审批准 ed7b66f](https://github.com/1997dmsu-sketch/SMART-PM/blob/ed7b66f84c79339246a81ea76762cc388d7f4778/docs/tasks/HK-AI-04-H4C-DESIGN-APPROVAL-B15ACEB-2026-11-14.md)；只批准设计并授权分阶段编码，**不授权 HTTP**
- H4-c C1 代码：`feat/hk-face-h4c-reconciliation` @ `5dff386fe5c9648b04d1623d3e1898c59332639e`，[C1 证据包](https://github.com/1997dmsu-sketch/SMART-PM/blob/5dff386fe5c9648b04d1623d3e1898c59332639e/docs/tasks/HK-AI-04-H4C-C1-REVIEW-EVIDENCE-2026-11-14.md) 自述“等待 Codex 独立复审”
- H4-c C2 前置检查：[C2 preflight 42f8970](https://github.com/1997dmsu-sketch/SMART-PM/blob/42f8970f065097f5163dfcbfc723932a72c51faf/docs/tasks/HK-AI-04-H4C-C2-PREFLIGHT-2026-11-14.md)，仅文档，明确“C1 未正式通过、C2 未开始”
- H4-c C2（三种 decision）与 C3（finalize-retry）：**未开始、未实现**
- 本轮分支：`docs/hk-face-http-wiring-design`；在 `255c380b302201044235bf3cfb5128ea64e2050d` 之后**追加单一提交**（不 amend、不 rebase、不 squash、不 force push）；初稿 `befc2d3a2cb11e1215ac5925eeb334f1b746a7f3` 完整保留在历史中
- 本轮唯一变更文件：本文件；服务、路由、server、测试、Provider 全部零差异
- 现有路由描述表：[routes.mjs](../../admin-web/lib/face-service/routes.mjs#L6-L62)
- 现有 HTTP 信封：[server.mjs](../../admin-web/server.mjs#L434-L438)
- H4-c 对账/恢复设计：[H4-c 设计](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L80-L118)
- 边界：本卡只处理“未来接线必须满足的 HTTP 契约”，且以 2026-11-14 Codex 裁定为准。九个端点在本卡合并后**全部继续关闭**；注册与调用必须另发编码卡。

## 0. 复盘结论

### 0.1 三项缺口逐条处理

上一稿被指出的三个缺口，按“只读核对事实 → 写回 Codex 裁定 → 关闭 → 验收行”逐条处理。**三项缺口都以“关闭（裁定）”收尾，不以“改成可以接线”收尾。**

| 编号 | 复审缺口 | 只读核对事实（2026-11-14） | 本轮处理（Codex 裁定写回） | 结论 | 验收行 |
|---|---|---|---|---|---|
| G-01 | `publicJobResult` 没有 `revision`，却在上一稿冻结了 E07/E08/E09 的 `expectedRevision`，等于凭空冻结 CAS 基准 | `publicJobResult` 精确只有 `jobId/state/attempts/lastSuccessAt/failureReason` 五个字段（[dto.mjs](../../admin-web/lib/face-service/dto.mjs#L254-L263)）；`queryJob(jobId)` 只回这个投影（[service.mjs](../../admin-web/lib/face-service/service.mjs#L731-L736)）；没有 `listJobs()`，也没有 job 详情路由 | 写回 **Q1（2026-11-14）**：`queryJob` 最小公开 DTO 固定为 `jobId/state/revision/attempts/lastSuccessAt/failureReason`；`revision` 必须正安全整数且只来自服务端当前 job 记录；缺失或非法失败关闭；禁止返回 lease/digest/op key/原始错误/设备与隐私字段；E06 未实现继续 blocked。旧“E06 列表加字段”提案作废 | **关闭（裁定）**：读模型方向已定但未实现；E06/E07/E08/E09 不开放 | D23–D26、S13、S19–S20、S17 |
| G-02 | 上一稿把 `h3b.requeue`/`h4b.requeue` 当成可接线的 retry，宣称 K2 method `face.operation.retry` 名称冻结 | 两个 requeue 都**没有** operation key、`requestDigest`、K2 domain guard、严格重放或 audit 关联：`h3b.requeue(jobId, expectedRevision, actor)` 只写 job+log（[h3b.mjs](../../admin-web/lib/face-service/h3b.mjs#L444-L487)）；`h4b.requeue(jobId, expectedRevision = null, actor = null)` 只在传入 `actor` 时校验 revision，也只写 job+log（[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L482-L519)）；`face.operation.retry` 不在已实现 K2 method 集合内 | 写回 **Q3（2026-11-14）**：E07 blocked/proposed；**不复用不完整 requeue**；未来独立任务冻结 K2 method、Idempotency-Key、`requestDigest`、operation domain、`expectedJobRevision`、`nextAttemptAt`、`attempts`、lease 状态、严格重放、`retryable_failed` 前置；`awaiting_result`/`UNKNOWN_RESULT` 禁止普通 requeue 和自动重试 | **关闭（裁定）**：retry 未实现、不注册 | F13、F17、U10–U16、S03–S05、S17 |
| G-03 | 上一稿把 H4 草案的 `revoke {expectedRevision, reasonCode}` 与 H4-c 的 `reconcile`/`finalize-retry` 当成契约事实；而实际 revoke 无请求体，H4-c 只有 C1 代码在等终审、C2/C3 未开始 | 实际入口是 `revoke(grantId, { idempotencyKey })`，`requestDigest` 只含 `{grantId}`（[service.mjs](../../admin-web/lib/face-service/service.mjs#L652-L728)）；H4-a/H4-b 没有任何 `reasonCode` 入参、枚举、持久化或审计字段；`reconcile`/`finalize-retry` 在服务层**不存在**；C1 `5dff386` 只交付 `h4c-evidence.mjs` 只读 helper，无 reconcile 入口；`routes.mjs` 只有 E08 描述行且 server 未注册，E09 连描述行都没有 | 写回 **Q4/Q5/Q6（2026-11-14）**：bodyless 仅服务层实现事实，**不批准 HTTP**；E05 HTTP blocked；未来 mutation 至少 `expectedGrantRevision`；`reasonCode` 在独立“撤权服务与 HTTP 契约加固”冻结前不得接收；E08/E09 完全不注册，直到 C1 终审 + C2 + C3 + RC01–RC73 + 最小响应投影 + Provider 0 证据齐备 | **关闭（裁定）**：E05/E08/E09 契约与 HTTP 均不开放 | D06、D19、D29、F14–F15、F18、S06、S10–S12 |

补充说明：

- 三项缺口的共同根因是“把提案写成事实”。Codex 裁定（2026-11-14）关闭设计争议，但不把任何端点变成可编码状态；因此本卡保留四层结构（§0.3），状态词只使用 `implemented/proposed/blocked/not-applicable` 四个基本值（§0.2）。
- 本卡不把任何缺口“修好”，只把契约的**可断言范围**收窄到实现事实与已裁定文本以内；修复必须另发服务层/编码卡。

### 0.2 九个端点状态摘要

状态值基于四个基本值，逐列含义固定：

| 状态值 | 列内含义 |
|---|---|
| `implemented` | 以当前提交的代码或已终审文档为依据，该维度事实成立 |
| `proposed` | 只有提案/设计稿或已裁定但未实现的文本依据，未冻结，不可接线、不可验收 |
| `blocked` | 缺权威依据或前置未完成，本卡明确关闭 |
| `not-applicable` | 该维度对该端点不适用 |

`proposed / blocked` 只用于 E06 契约单元格：Q1 已裁定 `queryJob` 最小 DTO，但服务层未实现（blocked），E06 列表 HTTP 契约亦不可冻结（proposed）；端点整体登记 blocked，**不得读作 ready 或可编码**。

| ID | 端点 | 服务层 | 契约 | HTTP | 权限 | 幂等 | revision 来源 | Provider/设备 | 说明与依据（2026-11-14） |
|---|---|---|---|---|---|---|---|---|---|
| E01 | `POST /api/v2/face-credentials` | implemented | implemented | blocked | implemented | implemented | not-applicable | not-applicable | 服务层 `submit` 已实现（[service.mjs](../../admin-web/lib/face-service/service.mjs#L199-L255)）；`device.face.submit`；K2 `face.submit`；HTTP 未注册（编码卡门禁） |
| E02 | `GET /api/v2/face-credentials/review-queue` | implemented | implemented | blocked | implemented | not-applicable | implemented | not-applicable | `reviewQueue` 已实现（[service.mjs](../../admin-web/lib/face-service/service.mjs#L315-L319)）；只回 `publicReviewItem`；credential `revision` 仅展示，不是 job CAS 基准 |
| E03 | `POST /api/v2/face-credentials/:credentialId/review` | implemented | implemented | blocked | implemented | implemented | implemented | not-applicable | 服务层 `expectedRevision` 可选（[service.mjs](../../admin-web/lib/face-service/service.mjs#L258-L313)）；**Q2 裁定 HTTP 字段名为 `expectedCredentialRevision` 且必填**；K2 `face.review` |
| E04 | `GET /api/v2/face-credentials/:credentialId/image` | implemented | implemented | blocked | implemented | not-applicable | not-applicable | not-applicable | 缺 `credentialId → sourceFileId` 的 HTTP 解析层；`FileService` 私密读取已实现（[files.mjs](../../admin-web/lib/files.mjs#L1049-L1094)）；`device.face.readPrivate` |
| E05 | `POST /api/v2/device-access-grants/:grantId/revoke` | implemented | blocked | blocked | implemented | implemented | blocked | not-applicable | **Q4**：bodyless 只是服务层实现事实，不批准 HTTP；**Q5**：加固任务冻结 `reasonCode` 前不接收；未来 mutation 至少 `expectedGrantRevision`；无权威 grant revision 读取；live/Cloud 永久关闭 |
| E06 | `GET /api/v2/device-operation-jobs` | blocked | proposed / blocked | blocked | implemented | not-applicable | blocked | not-applicable | **Q1**：`queryJob` 最小 DTO 已裁定但未实现；**Q7**：唯一权威 revision 入口是按 ID 的 `queryJob`；无 `listJobs()`，列表 HTTP 契约不冻结 |
| E07 | `POST /api/v2/device-operation-jobs/:jobId/retry` | blocked | proposed | blocked | implemented | proposed | blocked | not-applicable | **Q3**：不复用不完整 requeue；独立任务冻结 K2/摘要/域/`expectedJobRevision`/lease/重放；**未注册**，不得宣称 `face.operation.retry` 已实现 |
| E08 | `POST /api/v2/device-operation-jobs/:jobId/reconcile` | blocked | proposed | blocked | implemented | proposed | blocked | proposed | **Q6**：C1 终审 + C2 + C3 + RC01–RC73 + 最小响应投影 + Provider 0 证据齐备前完全不注册；`routes.mjs` 仅演示描述行（[routes.mjs](../../admin-web/lib/face-service/routes.mjs#L54-L59)） |
| E09 | `POST /api/v2/device-operation-jobs/:jobId/finalize-retry` | blocked | proposed | blocked | implemented | proposed | blocked | proposed | **Q6**：C3 未开始；HTTP 路径仅存在于 H4-c §13.2 提案（[H4-c 设计](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L598-L614)）；不在 `routes.mjs`，**不得注册** |

摘要计数：`服务层` implemented 5 / blocked 4；`契约` implemented 4 / blocked 1（E05）/ proposed 3（E07–E09）/ `proposed / blocked` 1（E06）；`HTTP` **blocked 9**（0 个可接线、0 个已注册）；`权限` implemented 9（权限名都在目录内，端点仍关闭）；`幂等` implemented 3 / proposed 3 / not-applicable 3；`revision 来源` implemented 2 / blocked 5 / not-applicable 2；`Provider/设备` not-applicable 7 / proposed 2。

### 0.3 文档四层结构

| 层 | 内容 | 章节 | 可引用强度 |
|---|---|---|---|
| 第一层 | **实现事实**：只读核对到的服务方法、DTO 字段、K2 method、路由表、权限目录、H4-c 阶段 | §1 | 可作为“现状”引用；不得外推为契约 |
| 第二层 | **已冻结契约**：传输、认证、错误码，以及 E01–E04 的路径与 DTO、E04 私密读取（§5）、已实现 K2 method 的幂等规则 | §2、§5 | 编码卡必须逐条满足；仍不代表已注册 |
| 第三层 | **已裁定但未实现/不得接线**：E05（blocked）、E06（proposed / blocked）、E07/E08/E09（proposed）、`queryJob` 最小 DTO、UI revision 规则、`UNKNOWN_RESULT` 收敛 | §3、附录 A | 只能作为编码卡的输入；不得据此注册或实现 |
| 第四层 | **继续关闭端点**：九端点全关闭、不存在的路径、注册门禁、`routes.mjs` 候选处置 | §4、§6 | 合并后仍全部关闭 |

### 0.4 五条不可协商的安全结论

1. 跨组织、资源不存在、私密文件无权限，统一同态 `404`；不得返回 `403` 泄露资源存在性。
2. 权限点只从当前组织成员记录的 `permissions` 读取；`admin` 角色不隐含 `device.face.review`、`device.face.readPrivate` 或任何 `device.*` 权限。
3. `awaiting_result` 只能被只读查询和人工对账观察/收敛；`retry`、普通 `requeue`、调度器、定时器、回调、客户端轮询都不得把它推回 `queued` 或 `sending`。
4. job revision 的唯一权威入口是**按 ID 的 `queryJob`**；列表行号、数组下标、本地自增、旧 mutation 响应、缓存旧值都不是 revision 来源（Q7，2026-11-14）。
5. 无合法 job revision 时，UI 必须隐藏或禁用依赖它的按钮并**禁止请求**；服务端对缺失或非法的 revision 必须失败关闭（Q1/Q7，2026-11-14）。

### 0.5 本卡明确不宣称

- 不宣称 Codex 裁定（Q1–Q8）等于 HTTP 编码批准；裁定只关闭设计争议，九端点仍 blocked 9/9。
- 不宣称 `face.operation.retry` 已实现或已冻结；它必须由 Q3 的独立任务冻结。
- 不宣称 E05 bodyless 是已冻结的 HTTP 契约；bodyless 只是服务层实现事实（Q4）。
- 不宣称 E06 已有列表或 revision 的 HTTP 读取；`queryJob` 的 HTTP 暴露未获批准，E06 继续 blocked（Q1/Q7）。
- 不宣称 `reasonCode` 可被接收；枚举、持久化、审计、投影均未冻结（Q4/Q5）。
- 不宣称 H4-c 已完成：C1 待独立终审，C2/C3 未开始，E08/E09 完全不注册（Q6）。

## 1. 第一层：实现事实（只读核对，2026-11-14）

本节只记录“代码现在是什么样”，不据此推断契约。所有结论均可在所列文件的对应行复核。

### 1.1 服务入口与权限

| 入口 | 位置 | 权限（`#require`） | 幂等 | 返回值 |
|---|---|---|---|---|
| `submit(input, {idempotencyKey})` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L199-L255) | `device.face.submit` | K2 `face.submit` | `{credentialId, reviewState}` |
| `review(credentialId, {decision, expectedRevision}, {idempotencyKey})` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L258-L313) | `device.face.review` | K2 `face.review` | `{credentialId, reviewState}` |
| `reviewQueue()` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L315-L319) | `device.face.review` | 不适用 | `publicReviewItem[]` |
| `createGrant(input, {idempotencyKey})` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L322) | `device.access.manage` | K2 `face.grant` | `{grantId, jobId, evidenceScope}`；**无 HTTP 路径** |
| `revoke(grantId, {idempotencyKey})` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L652-L728) | `device.access.manage` | K2 `face.revoke` | `{grantId, jobId, grantState, cleanupPending, evidenceScope}` |
| `queryJob(jobId)` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L731-L736) | `device.audit.read` | 不适用 | `publicJobResult` |

事实补充：

- `review` 的服务层字段名是 `expectedRevision`，在服务层是**可选**的：只有 `Number.isInteger(expectedRevision)` 为真才做 CAS（[service.mjs](../../admin-web/lib/face-service/service.mjs#L291-L293)）。**Q2（2026-11-14）裁定 HTTP 字段名为 `expectedCredentialRevision` 且必填**；它只指 credential revision，不得映射 job revision。
- `createGrant` 的八字段已包含 `expectedCredentialRevision`（[dto.mjs](../../admin-web/lib/face-service/dto.mjs#L105-L108)），与 Q2 的命名一致；`createGrant` 仍是服务层入口，没有 HTTP 路径，也不在本卡九端点内。
- `queryJob(jobId)` 只有单个 job 入参；**没有 `listJobs()`**，也没有按状态/action 过滤的列表方法。
- 七个 `device.*` 权限名已在目录内，但“权限存在”不等于“端点可用”；九端点全部未注册。

### 1.2 `queryJob` 与 `publicJobResult` 精确字段

`publicJobResult(job)` 的完整实现（[dto.mjs](../../admin-web/lib/face-service/dto.mjs#L254-L263)）当前只输出五个字段：

| 字段 | 类型 | 取值来源 | 事实说明 |
|---|---|---|---|
| `jobId` | string | `job.jobId \|\| job._id` | 不透明 ID |
| `state` | string | `job.state` | 既有 job 状态机值 |
| `attempts` | number | `job.attempts ?? 0` | 缺省 0 |
| `lastSuccessAt` | number \| null | `job.lastSuccessAt ?? null` | 缺省 null |
| `failureReason` | string \| null | `job.failureReason` 截断 120 字符 | H3/H4 job 写 `result.reasonCode`，不写 `failureReason`，因此对这两类 job 恒为 `null` |

**Q1（2026-11-14）裁定的目标 DTO** 追加第六字段 `revision`（正安全整数，只来自服务端当前 job 记录）；该字段**当前未实现**，见 §3.5。除此之外，以下字段仍不在投影中：

| 字段 | 是否存在 | 影响 |
|---|---|---|
| `revision` | 否（Q1 已裁定、未实现） | E07/E08/E09 的 CAS 基准没有可用读取；E06 继续 blocked |
| `action` | 否 | 无法区分 enroll/update/revoke 路径 |
| `cleanupPhase` | 否 | 无法判断 `retryable_failed` 是否处于 dispatch 可重试阶段 |
| `nextAttemptAt` | 否 | 无法展示退避到期时间 |
| `orgId`/`deviceId`/`grantId`/`credentialId` | 否 | 列表不能作为跨组织或资源归属证据 |
| `result`/`errorKind`/`reasonCode` | 否 | 失败原因不能通过 `failureReason` 反推 |
| `lease`/`requestDigest`/operation key | 否 | 不得以任何形式补充进公开 DTO（Q1） |

### 1.3 `requeue`／retry 现状

| 方法 | 签名 | 权限复核 | revision 校验 | K2 operation key | `requestDigest` | K2 domain guard | 严格重放 |
|---|---|---|---|---|---|---|---|
| `h3b.requeue` | `(jobId, expectedRevision, actor = null)` | 仅当 `actor` 非空时，事务内复核 `device.operation.retry` | `expectedRevision` 必须安全整数，且等于 `current.revision` | **无** | **无** | **无** | **无**；第二次同键按状态/CAS 失败 |
| `h4b.requeue` | `(jobId, expectedRevision = null, actor = null)` | 同上 | 仅当 `actor` 非空时要求 `expectedRevision`；未传时只比对 `job.revision` | **无** | **无** | **无** | **无**；第二次同键按状态/CAS 失败 |

缺失清单（每项都是重试端点可接线的硬前提）：

1. 没有 `#opContext`/operation key 写入，同键重放第二次会退化为 `INVALID_JOB`，不是首结果。
2. 没有 `requestDigest`，无法区分“同键同请求”与“同键异请求”。
3. 没有 K2 domain head/version 写入与 `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH` 失败关闭。
4. 没有把成功写集与 operation key 放进同一事务的严格重放。
5. 没有把 audit 与 operation key 关联的审计幂等。
6. 没有 `lease` 状态、`attempts` 预算、`nextAttemptAt` 的对外只读投影。

因此：**`face.operation.retry` 不是已实现的 K2 method，E07 不可接线。**

### 1.4 K2 实际实现

已实现的 K2 method 只有四个（[service.mjs](../../admin-web/lib/face-service/service.mjs#L204-L727)）：

| K2 method | 服务入口 | `requestDigest` 输入 | result 指针 | 状态 |
|---|---|---|---|---|
| `face.submit` | `submit` | `{personId, sourceFileId}` | `{credentialId, reviewState}` | implemented |
| `face.review` | `review` | `{credentialId, decision, expectedRevision}`（缺省为 null） | `{credentialId, reviewState}` | implemented |
| `face.grant` | `createGrant` | `assertCreateGrantInput` 八字段 | `{grantId, jobId, evidenceScope}` | implemented（无 HTTP） |
| `face.revoke` | `revoke` | `{grantId}` | `{grantId, jobId, grantState, cleanupPending, evidenceScope}` | implemented |
| `face.operation.retry` | 无 | 无 | 无 | proposed |
| `face.reconcile` | 无 | 无 | 无 | proposed |
| `face.reconcile.finalize` | 无 | 无 | 无 | proposed |

机制事实：

- operation key = `HMAC` 派生，作用域 `orgId + method + actorType + actorId + 原始 key`，记录只存 `orgId/realm/keyVersion/requestDigest/result/createdAt`（[collections.mjs](../../admin-web/lib/face-service/collections.mjs#L244-L254)）。
- 重放校验是严格摘要相等：`existing.requestDigest === requestDigest` 且 `result` 与 `expected` 深比较一致，否则 `CONFLICT/409`（[service.mjs](../../admin-web/lib/face-service/service.mjs#L132-L145)）。
- domain 失败关闭：配置缺失/非法 `NOT_CONFIGURED/503`，单边缺失/损坏 `DOMAIN_INCOMPLETE/409`，换钥/版本不符 `DOMAIN_MISMATCH/409`（[collections.mjs](../../admin-web/lib/face-service/collections.mjs#L199-L300)）。
- 原始 Idempotency-Key 不落库；记录中只有派生后的 op key。

### 1.5 路由与注册事实

`FACE_ROUTES` 是**描述表**，不是注册表（[routes.mjs](../../admin-web/lib/face-service/routes.mjs#L6-L62)）：

| # | route id | Method | Path | permission | idempotent |
|---:|---|---|---|---|---|
| 1 | `face-credential-submit` | POST | `/api/v2/face-credentials` | `device.face.submit` | 是 |
| 2 | `face-review-queue` | GET | `/api/v2/face-credentials/review-queue` | `device.face.review` | 无 |
| 3 | `face-credential-review` | POST | `/api/v2/face-credentials/:credentialId/review` | `device.face.review` | 是 |
| 4 | `face-credential-image` | GET | `/api/v2/face-credentials/:credentialId/image` | `device.face.readPrivate` | 无 |
| 5 | `device-grant-revoke` | POST | `/api/v2/device-access-grants/:grantId/revoke` | `device.access.manage` | 是 |
| 6 | `device-operation-job-list` | GET | `/api/v2/device-operation-jobs` | `device.audit.read` | 无 |
| 7 | `device-operation-job-retry` | POST | `/api/v2/device-operation-jobs/:jobId/retry` | `device.operation.retry` | 是 |
| 8 | `device-operation-job-reconcile` | POST | `/api/v2/device-operation-jobs/:jobId/reconcile` | `device.operation.reconcile` | 是 |

注册事实：

- `matchFaceRoute` 已存在但**没有任何 server 调用方**；`server.mjs` 没有 import `routes.mjs`，也没有 `/api/v2/face-credentials`、`/api/v2/device-access-grants`、`/api/v2/device-operation-jobs` 分支。
- `server.mjs` 现存的唯一人脸相关路由是 `POST /api/v2/files/:id/face-review`（[server.mjs](../../admin-web/server.mjs#L665-L684)），与九端点无关。
- **E08 在 `routes.mjs` 有描述行（第 8 条），但 server 未注册；E09 不在 `routes.mjs`。** 这两点都是“候选路径不得在 routes/server 出现”的验收对象（Q8）。

### 1.6 权限目录事实

`org.mjs` 的可授予权限点包含七个 `device.*`（[org.mjs](../../admin-web/lib/org.mjs#L89-L105)）：

```text
device.face.submit
device.face.review
device.face.readPrivate
device.access.manage
device.audit.read
device.operation.retry
device.operation.reconcile
```

- 角色（`admin/editor/viewer/resident`）不隐含任何 `device.*` 权限。
- 本卡不新增权限点；`device.operation.retry` 存在不等于 E07 可用（端点未注册）。

### 1.7 H4-c 实施阶段事实

| 阶段 | 提交/产物 | 内容 | 状态 |
|---|---|---|---|
| 设计 | `b15aceb` | 三种 decision、K3、evidence head、`finalize-retry`、RC01–RC73 | 已批准（`ed7b66f`） |
| C1 | `5dff386` `h4c-evidence.mjs` | 只读 evidence/domain 校验 helper；已删除全部 K3 初始化能力 | **待 Codex 独立终审**；不在本分支 |
| C2 前置 | `42f8970` 文档 | 检查表；自述 G1 未通过、C2 未开始 | proposed（仅文档） |
| C2 | 无 | `confirmed_removed`/`confirmed_present`/`still_unknown` 服务入口 | **未开始** |
| C3 | 无 | `finalize-retry` 服务入口 | **未开始** |
| HTTP | 无 | 九端点注册 | **0 注册** |

C1 的代码事实：`h4c-evidence.mjs` 只导出 evidence/head/domain 的校验、追加写构建、K3 摘要与配置读取；**没有 `reconcile`、没有 `reconcileFinalize`、没有服务层入口**；K3 初始化入口已全部删除，固定 head 为字面常量 `evidence-digest-domain:v1:global`，运行时只读失败关闭。

### 1.8 文件私密读取事实

- 人脸文件 purpose `face-biometric`：写入需 `device.face.submit`，读取需 `device.face.readPrivate`（[files.mjs](../../admin-web/lib/files.mjs#L138-L150)）。
- `authorizeDownload(fileId, actor)` 对 private 文件逐次复核成员权限；无权限与不存在同态 `404`（[files.mjs](../../admin-web/lib/files.mjs#L1049-L1094)）。
- 审核权限 `device.face.review` 与读图权限 `device.face.readPrivate` 正交。

### 1.9 事实使用规则

1. 本节任何一行都不能单独当作 HTTP 契约；契约只在 §2 冻结。
2. 代码没有的字段（尤其 job `revision`）不得用“应该会有”“读缓存即可”补齐。
3. C1 `5dff386` 未终审前，不得把 H4-c 设计里的方法名、DTO、错误码当作可用事实；只能引用为提案。
4. 本卡不修改上述任何文件；事实仅用于收窄契约。

## 2. 第二层：已冻结契约

只冻结：传输/认证/CSRF、组织与权限、信封与错误码、E01–E04 的路径与 DTO、E04 的私密读取（§5），以及已实现 K2 method 的幂等规则。**E05/E06 只记录服务层事实与关闭状态，不冻结 HTTP 契约；也不冻结任何候选端点的 DTO、状态迁移或 K2 method。**

### 2.1 传输、认证与 CSRF

| 项目 | 冻结规则 |
|---|---|
| 前缀 | `/api/v2`，不得使用 `/api/face-*` 别名 |
| 认证 | 现有 HttpOnly `smartpm_session` Cookie；不使用 Bearer、不接收 body 中的 actor |
| Origin | POST 必须匹配配置的 `ADMIN_ORIGIN`；不匹配按现有 server 行为 `403`，不进入业务 |
| CSRF | POST 必须带 `X-CSRF-Token`，值等于当前会话 `csrf`；不匹配 `403` |
| Content-Type | 写请求 `application/json`；图片响应为 `image/jpeg` 或 `image/png` |
| Body 上限 | 沿用 `body(req)` 的 65536 字节；超限必须是带 `PARAM_ERROR` 的 `413`，不得落到 `503` |
| 方法 | 仅本卡表中方法；不用 PUT/DELETE/PATCH 表达状态迁移 |
| 缓存 | 所有 API 响应 `Cache-Control: no-store`；图片响应另加 `Pragma: no-cache` |
| 安全头 | `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY` 沿用 server |
| requestId | 每个 v2 请求由 server 生成 UUID；响应原样返回；不接受客户端指定 |

`401` 与 Origin/CSRF `403` 发生在 v2 分派之前，沿用现有 `{error:string}` 形状；本卡不修改该层。其余业务错误一律使用 v2 错误信封。

### 2.2 组织上下文与权限

1. 组织解析顺序固定：`X-Org-Id` 请求头 → `?orgId=` → 唯一 active membership；多组织且未指定 `PARAM_ERROR/400`；零组织 `NOT_FOUND/404`。
2. 请求体中的 `orgId`、`actorId`、`membershipId`、`permissions`、`role` 一律视为未知字段，`PARAM_ERROR/400`。
3. 组织上下文由 server 侧 `requireMembership("adminAccount", account._id, orgId)` 解析；服务层再次读取 `organizations/<orgId>` 与 `org_memberships/<membershipId>`，写入请求必须在事务内复核。
4. 权限只取 `membership.permissions` 数组；角色 `admin/editor/viewer/resident` 不蕴含任何 `device.*` 权限。
5. 组织不存在、成员不存在、跨组织资源：`NOT_FOUND/404`，消息统一“不存在或不可见”。
6. 组织存在但 `status !== "active"`：`FORBIDDEN/403`。
7. 成员存在但缺权限：`FORBIDDEN/403`。**权限撤销后下一个请求立即失败，不得使用缓存权限或旧结果。**
8. 路径参数只接受 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`；先做百分号解码校验，解码失败 `PARAM_ERROR/400`，不得冒泡成 500/503。

### 2.3 成功信封与状态

```json
{
  "data": {},
  "requestId": "uuid",
  "nextCursor": "opaque"
}
```

| 场景 | HTTP | 说明 |
|---|---:|---|
| 普通读取/动作成功 | 200 | `data` 为对象或数组 |
| 新建凭证 | 201 | 首提交与同键重放都用 201，见 §2.6 |
| 对账/恢复已受理但未完成 | 202 | **本卡不产生 202**：E08/E09 完全未注册（Q6）；未来如批准，202 语义须由独立编码卡冻结 |
| 图片成功 | 200 | 二进制，不用 JSON 信封 |
| 列表分页 | 200 | 仅 E06 未来批准后使用 `nextCursor`；当前 E06 未注册 |

- `data` 必须是端点节冻结的对象/数组；不得把内部 job、evidence、grant 记录原样返回。
- 201 只用于 E01；E05 是动作。E05 的 HTTP 未获批准（Q4），其未来成功码须由加固后的编码卡确认。
- 202 不表示“稍后自动重试”；不得附加 `Retry-After`，见 §6。

### 2.4 错误信封

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "凭证已被修改，请刷新后重试"
  },
  "requestId": "uuid"
}
```

- `code` 必须来自 §2.5 或端点错误表；不得新增同义码。
- `message` 是固定、非敏感的中文短语；禁止异常 `message`、`stack`、SQL、文件路径、Provider 响应、设备序列号、人员字段。
- 未预期异常：`ADAPTER_UNAVAILABLE/503`，消息“服务暂不可用”，只记录 `error.code || error.name`。
- `422` 不用于任何人脸端点；资料不完整一律映射到既有 400/409 码。
- 失败响应不得包含 `data`、`nextCursor`、`duplicate` 以外的成功字段。

### 2.5 状态码与错误码总表

| code | HTTP | 语义 | 写 |
|---|---:|---|---:|
| `PARAM_ERROR` | 400 | DTO/枚举/未知字段/ID/时间/分页参数/revision 字段（`expectedCredentialRevision`、`expectedGrantRevision`、`expectedJobRevision`、`expectedRevision`）非正安全整数 | 0 |
| `CAPACITY_EXCEEDED` | 400 | 撤权前预扫 candidate ≥83 | 0 |
| `UNAUTHORIZED` | 401 | 仅用于 v2 内部统一说明；实际 401 由 server 登录门返回 | 0 |
| `FORBIDDEN` | 403 | 权限、成员、组织失效 | 0 |
| `NOT_FOUND` | 404 | 组织内不可见/不存在/跨组织同态 | 0 |
| `FILE_NOT_FOUND` | 404 | 私密文件不存在、跨组织、非 ready、无读权限 | 0 |
| `REVISION_CONFLICT` | 409 | credential/grant/job/head CAS 失败；stale revision | 0 |
| `INVALID_STATE` | 409 | 当前状态不允许该动作 | 0 |
| `INVALID_JOB` | 409 | revoke/enroll job 字段或阶段非法；查询侧 job 记录缺失合法 `revision` 时失败关闭（Q1）；未来 retry 的错误映射须由独立任务冻结（Q3） | 0 |
| `CONFLICT` | 409 | K2 摘要/结果损坏、确定性 ID 预占 | 0 |
| `FILE_CHANGED` | 409 | 人脸来源文件 revision 变化 | 0 |
| `CLEANUP_SNAPSHOT_REQUIRED` | 409 | 老 job/缺 snapshot/绑定不符 | 0 |
| `DEVICE_CLAIM_INVALID` | 409 | claim/slot/guard 损坏 | 0 |
| `DEVICE_CLAIM_CONFLICT` | 409 | 设备归属冲突 | 0 |
| `CLAIM_RELEASE_GUARD_REQUIRED` | 409 | 设备释放 guard 缺失/损坏 | 0 |
| `GRANT_SLOT_CONFLICT` | 409 | 授权槽位冲突 | 0 |
| `EVIDENCE_REQUIRED` | 409 | evidence 缺失（**仅候选 E08**） | 0 |
| `EVIDENCE_INVALID` | 409 | evidence 结构/短码/sourceType 不匹配（**仅候选 E08**） | 0 |
| `EVIDENCE_STALE` | 409 | observedAt 过期、未来或非递增（**仅候选 E08**） | 0 |
| `EVIDENCE_HEAD_CONFLICT` | 409 | evidence head CAS 失败（**仅候选 E08**） | 0 |
| `EVIDENCE_CHAIN_BROKEN` | 409 | previous evidence/链/域不一致（**仅候选 E08**） | 0 |
| `RECONCILE_THROTTLED` | 409 | `still_unknown` 间隔小于 60 秒（**仅候选 E08**） | 0 |
| `RECONCILE_LIMIT` | 409 | `still_unknown` 已达 8 次（**仅候选 E08**） | 0 |
| `RECONCILE_CONFLICT` | 409 | 已终态但 decision 不同（**仅候选 E08**） | 0 |
| `RECONCILE_GENERATION_CONSUMED` | 409 | finalize-retry 指向已消费旧 revision（**仅候选 E09**） | 0 |
| `DOMAIN_INCOMPLETE` | 409 | K2/K3 domain 单边缺失/损坏 | 0 |
| `DOMAIN_MISMATCH` | 409 | K2/K3 换钥、版本或 fingerprint 不符 | 0 |
| `RETRY_NOT_DUE` | 409 | 未到 `nextAttemptAt`（**仅候选 E07**） | 0 |
| `LOCAL_FINALIZE_EXHAUSTED` | 200/409 | 终态投影或错误入口（**仅候选 E08/E09**） | 0 |
| `NOT_CONFIGURED` | 503 | K2/K3/Provider/运行模式缺失或非法 | 0 |
| `STORAGE_UNAVAILABLE` | 503 | 文件后端与配置不一致 | 0 |
| `ADAPTER_UNAVAILABLE` | 503 | Store/clock/未预期异常 | 0 |

标注“仅候选”的 code 属于 H4-c/H3 设计清单，**当前没有任何已注册端点会产生它们**；它们不因写进本表而变为已实现。`LOCAL_FINALIZE_EXHAUSTED` 的 200 与 409 区分只在候选端点投影时成立。

### 2.6 Idempotency-Key 与 K2

| 规则 | 冻结值 |
|---|---|
| 适用 | 已冻结：E01、E03；服务层已实现但 HTTP 关闭：E05（Q4）；候选（未冻结）：E07、E08、E09 |
| 位置 | 仅 `Idempotency-Key` 请求头；不得放在 body/query/cookie |
| 格式 | `^[A-Za-z0-9._:-]{16,128}$`，区分大小写，不去空格，不接受数组/重复头 |
| 缺失/非法 | `PARAM_ERROR/400`，零写，不创建 operation key |
| 作用域 | `orgId + K2 method + actorType + actorId + key` |
| 原始键 | 只用于 HMAC 派生；不得写入 job/log/audit/evidence/response |
| 同键同摘要 | 返回首次结果与首次成功状态；核心写集为零；Provider 0 |
| 同键异摘要 | `CONFLICT/409`，不覆盖 operation key |
| 不同 actor 同原始键 | K2 作用域不同，互不重放；是否产生第二条业务记录由各端点确定性 ID 决定 |
| 同键跨端点 | K2 method 不同，互不重放；不得把一个端点的 key 当另一个端点的重放 |
| 记录损坏 | `result` 非对象、错 `orgId/realm/keyVersion/createdAt`、摘要不符：`CONFLICT/409`，零写 |
| K2 配置 | 缺失/非法：`NOT_CONFIGURED/503`；domain 单边：`DOMAIN_INCOMPLETE/409`；版本/换钥不符：`DOMAIN_MISMATCH/409` |
| 过期 | 人脸 K2 记录当前无 `expiresAt`，本卡不引入过期语义；不得套用通用 `IDEMPOTENCY_EXPIRED` |

**201 重放语义**：E01 首提交与同键重放都返回 `201`。理由是 `assertSubmitInput` 的 H1 结果只有 `{credentialId,reviewState}`，没有 `created` 标志；用 200/201 区分会迫使服务层扩展已批准 result。该选择在 E01 节固定，不推广到其他端点。

### 2.7 K2 method 映射

| 端点 | K2 method | `requestDigest` 输入 | result 指针 | 状态 |
|---|---|---|---|---|
| E01 submit | `face.submit` | `{personId, sourceFileId}` | `{credentialId, reviewState}` | implemented |
| E03 review | `face.review` | `{credentialId, decision, expectedRevision}`（服务层字段名；HTTP 对外为 `expectedCredentialRevision`） | `{credentialId, reviewState}` | implemented |
| E05 revoke | `face.revoke` | `{grantId}` | `{grantId, jobId, grantState, cleanupPending, evidenceScope}` | implemented（仅服务层；HTTP blocked，Q4） |
| 非 HTTP createGrant | `face.grant` | `assertCreateGrantInput` 八字段（含 `expectedCredentialRevision`） | `{grantId, jobId, evidenceScope}` | implemented，仅服务层 |
| E07 retry | `face.operation.retry`（候选名） | 未定义 | 未定义 | **proposed，未实现；名称待 Q3 独立任务冻结** |
| E08 reconcile | `face.reconcile`（H4-c 提案） | H4-c §7.1 精确字段集 | H4-c 稳定指针 | **proposed，未实现；Q6 前不注册** |
| E09 finalize-retry | `face.reconcile.finalize`（H4-c 提案） | `{jobId, expectedRevision}`（job revision，兼恢复 generation 基准） | `{kind:"finalize_retry",jobId,generationRevision,recoveryId}` | **proposed，未实现；Q6 前不注册** |

- `face.operation.retry` **不是**已冻结名称；Q3（2026-11-14）要求由未来独立任务连同 E07 服务层 K2 改造一起冻结。
- E08 用 `face.reconcile` 摘要，E09 用 `face.reconcile.finalize` 摘要；二者不得互换，也不得把 `face.revoke`/`face.operation.retry` 的摘要复用到对账路径。
- E05 的服务层 digest 只含 `grantId`，与 H4 设计草案的 `{grantId,expectedRevision,reasonCode}` 不同；该 digest 不构成 HTTP 契约，E05 HTTP 仍 blocked（Q4/Q5），见 §3.6。
- **Q2 命名**：Submit 不用任何 `expectedRevision`；Review/CreateGrant 用 `expectedCredentialRevision`；Revoke 未来用 `expectedGrantRevision`；requeue/retry 未来用 `expectedJobRevision`；Reconcile/Finalize-retry 用 `expectedRevision`（指 job revision）；读取端点一律不用。

### 2.8 错误优先级与信息边界

本卡不承诺一个跨端点的全序，因为服务层检查顺序因端点而异；但固定以下边界：

1. 未登录永远 `401`；Origin/CSRF 永远 `403`，均不进入业务。
2. 组织/成员不可见 `404`；组织停用或缺权限 `403`。
3. 资源不存在、跨组织、私密文件无权限 `404`；不得用 `403` 区分“存在但无权”。
4. 只有资源可见且权限通过后，才可能出现 `409`（状态/revision/证据/域）。
5. `503` 只由配置、Store/clock、文件后端或未预期异常产生；出现 `503` 时必须零业务写。
6. 同一请求同时满足多个失败条件时，返回该端点错误表中“最先检查”的码；客户端不得据此推断资源是否存在。
7. 所有失败路径都不得调用 Provider、不得连接设备、不得写 job/grant/log/evidence/head/domain/op key/admin audit；唯一例外是 E04 在已解析到 `fileId` 后按文件契约写一条 `file_access_log` denied 留痕。

### 2.9 明确禁止

- 禁止在 `server.mjs` 的 `/api/v2/` 分支之外新增人脸特判。
- 禁止用 `GET` 产生业务写；禁止用 `POST /retry` 处理 `awaiting_result`。
- 禁止自动重试、自动轮询、定时器、回调重放来推动 job。
- 禁止把 `orgId`、`actorId`、`role`、`permissions` 从 body 提升为权限依据。
- 禁止新增权限点、状态名、decision 枚举或 `evidenceScope` 值。
- 禁止把原始 Idempotency-Key、K1/K2/K3 密钥、图片字节、objectKey、Provider 原始响应、`requestDigest`、evidence digest/head 写入任何记录或响应。
- 禁止从缓存、列表行号、数组下标、本地自增、旧 mutation 响应或时间戳推导任何 revision 字段（`expectedCredentialRevision`/`expectedGrantRevision`/`expectedJobRevision`/`expectedRevision`）。
- 禁止在读取端点携带任何 `expectedRevision` 类字段；读取不使用 revision（Q2）。
- 禁止在 `reasonCode` 枚举、持久化与审计契约冻结前接收该字段；未来注册后出现即 `PARAM_ERROR/400`，当前 E05 未注册（Q4/Q5）。

### 2.10 端点事实与契约状态：E01–E04 冻结；E05/E06 关闭

E04 见 §5。

#### E01 `POST /api/v2/face-credentials`

| 项目 | 值 |
|---|---|
| 用途 | 提交人脸凭证；只绑定人员与私密人脸来源文件 |
| Permission | `device.face.submit`，显式成员权限 |
| 幂等 | 必须，K2 `face.submit` |
| 成功 | `201` |
| Provider | 0 |

**Request**

| 位置 | 字段 | 类型/约束 |
|---|---|---|
| Header | `Idempotency-Key` | §2.6 |
| Header | `X-CSRF-Token` | 当前会话 |
| Header | `X-Org-Id` | 可选；多组织时必需 |
| Body | `personId` | 1–128 不透明 ID，`[A-Za-z0-9][A-Za-z0-9._:-]{0,127}` |
| Body | `sourceFileId` | 同上；必须是本组织 `face-biometric` private ready 文件，JPEG/PNG，≤200 KiB |

Body 精确只允许这两个字段；任何 `deviceId/grantId/validFrom/validUntil/orgId` 等字段 `PARAM_ERROR/400`。

**Response 201**

```json
{
  "data": {
    "credentialId": "fc-...",
    "reviewState": "submitted"
  },
  "requestId": "uuid"
}
```

**Errors**

| HTTP | code | 条件 | 写 |
|---:|---|---|---:|
| 400 | `PARAM_ERROR` | 未知字段、ID 非法、body 非对象、key 缺失/非法 | 0 |
| 401 | 现有登录门 | 无会话 | 0 |
| 403 | 现有 Origin/CSRF | 来源或令牌不符 | 0 |
| 403 | `FORBIDDEN` | 缺 `device.face.submit`、成员/组织失效 | 0 |
| 404 | `FILE_NOT_FOUND` | 来源文件不存在、跨组织、非 face-biometric、非 ready、超限 | 0 |
| 409 | `FILE_CHANGED` | 文件 revision 在预读后变化 | 0 |
| 409 | `CONFLICT` | 同键异摘要或 operation key 损坏 | 0 |
| 503 | `NOT_CONFIGURED` | K2 缺失/非法 | 0 |
| 503 | `ADAPTER_UNAVAILABLE` | Store/clock 不可用 | 0 |

**说明**

- 服务层 `submit` 不验证 `personId` 是否存在；该验证在 createGrant 的资格链完成。HTTP 不额外查询人员，避免把提交阶段变成人员枚举面。
- `credentialId` 由 operation key 派生；不同 actor 使用同一原始 key 会得到不同 credentialId，这是 K2 actor 作用域的既有结果。
- 同键重放固定 201，理由见 §2.6。

#### E02 `GET /api/v2/face-credentials/review-queue`

| 项目 | 值 |
|---|---|
| 用途 | 列出本组织 `reviewState=submitted` 的凭证 |
| Permission | `device.face.review` |
| 幂等 | 不适用 |
| 成功 | `200` |
| Provider | 0 |

**Request**

无 body、无 query、无 Idempotency-Key。`X-Org-Id` 可选。

**Response 200**

```json
{
  "data": [
    {
      "credentialId": "fc-...",
      "orgId": "org-...",
      "personId": "person-...",
      "reviewState": "submitted",
      "imageState": "verified",
      "displayState": "pending_review",
      "evidenceScope": "simulated",
      "cleanupPending": false,
      "revision": 1
    }
  ],
  "requestId": "uuid"
}
```

字段严格来自 `publicReviewItem`（[dto.mjs](../../admin-web/lib/face-service/dto.mjs#L235-L251)）。`submittedAt` 只在记录存在该字段时出现；当前 `submit` 写 `createdAt`，不写 `submittedAt`，因此可能缺省。客户端必须把缺省视为 `null`，不得依赖该字段排序。顺序不属于契约。

**这里的 `revision` 是 credential revision**，只能用于 E03 的 `expectedCredentialRevision`；它不是 job revision，不能驱动 E07/E08/E09。

**Errors**

| HTTP | code | 条件 |
|---:|---|---|
| 401 | 现有登录门 | 无会话 |
| 403 | `FORBIDDEN` | 缺 `device.face.review`、成员/组织失效 |
| 503 | `ADAPTER_UNAVAILABLE` | Store 不可用 |

**隐私**

队列**不得**返回图片字节、图片 URL、objectKey、checksum、digest、文件名、人脸质量原始值或任何 Provider 数据；只返回审核元数据。

#### E03 `POST /api/v2/face-credentials/:credentialId/review`

| 项目 | 值 |
|---|---|
| 用途 | 审核 `submitted` 凭证 |
| Permission | `device.face.review` |
| 幂等 | 必须，K2 `face.review` |
| 成功 | `200` |
| Provider | 0 |

**Request**

| 位置 | 字段 | 类型/约束 |
|---|---|---|
| Path | `credentialId` | 不透明 ID |
| Header | `Idempotency-Key` | §2.6 |
| Body | `decision` | 精确 `approved` 或 `rejected` |
| Body | `expectedCredentialRevision` | 正安全整数，≥1；**HTTP 必填**（Q2，2026-11-14） |

Body 精确两个字段。服务层当前字段名为 `expectedRevision` 且允许省略；HTTP 接线必须映射为 `expectedCredentialRevision` 并拒绝省略：H1 终审与 Q2 均要求“审核使用 credential revision，stale 返回 409”。该字段**不得**用于 job revision，也不得由 job revision 代替。

**Response 200**

```json
{
  "data": {
    "credentialId": "fc-...",
    "reviewState": "approved"
  },
  "requestId": "uuid"
}
```

**Errors**

| HTTP | code | 条件 | 写 |
|---:|---|---|---:|
| 400 | `PARAM_ERROR` | decision 非法、`expectedCredentialRevision` 缺失/非正安全整数、未知字段、key 非法 | 0 |
| 403 | 现有 Origin/CSRF | 来源或令牌不符 | 0 |
| 403 | `FORBIDDEN` | 缺 `device.face.review`、成员/组织失效 | 0 |
| 404 | `NOT_FOUND` | 凭证不存在或跨组织 | 0 |
| 409 | `INVALID_STATE` | 凭证不是 `submitted` | 0 |
| 409 | `REVISION_CONFLICT` | credential revision 不符（stale） | 0 |
| 409 | `CONFLICT` | 同键异摘要或 operation key 损坏 | 0 |
| 503 | `NOT_CONFIGURED` | K2 缺失/非法 | 0 |

**权限分离**

审核只改 `reviewState`，不读取、不返回图片字节；`device.face.review` 不隐含 `device.face.readPrivate`。审核人即使没有读图权限也能通过/驳回。

#### E05 `POST /api/v2/device-access-grants/:grantId/revoke`（HTTP blocked；bodyless 仅为服务层事实）

> **Q4（2026-11-14）裁定：无请求体仅内部服务实现事实，不批准 HTTP。E05 HTTP blocked。** 未来 mutation 至少 `expectedGrantRevision`；在 Q5 的“撤权服务与 HTTP 契约加固”完成前不得接收 `reasonCode`，也不得注册本端点。

| 项目 | 值 |
|---|---|
| 用途 | 业务即时撤权并创建 revoke 清理 job（服务层事实） |
| Permission | `device.access.manage` |
| 幂等 | 服务层已实现 K2 `face.revoke`；**HTTP 未批准** |
| 成功 | **未批准**（本卡不冻结 HTTP 成功码） |
| Provider | 0 |

**服务层事实（不构成 HTTP 契约）**

| 位置 | 字段 | 类型/约束 |
|---|---|---|
| Path | `grantId` | 不透明 ID |
| Header | `Idempotency-Key` | §2.6 |
| Body | 无 | 服务层入口 `revoke(grantId, {idempotencyKey})` 无请求体 |

服务层不接受 `expectedRevision`、`reasonCode`、`reason`、`credentialId`、`deviceId`；它用事务内读到的 grant revision 做 CAS，而不是客户端传版本。**这只说明服务层当前形状，不构成“bodyless 已冻结为 HTTP 契约”**。Q4 已明确：未来 mutation 至少带 `expectedGrantRevision`，因此 bodyless 不是未来 HTTP 契约的最终形态。

**服务层返回（参考，未冻结为 HTTP）**

```json
{
  "grantId": "grant-...",
  "jobId": "job-revoke-v1:...",
  "grantState": "revoked",
  "cleanupPending": true,
  "evidenceScope": "simulated"
}
```

**未来 HTTP 若获批准的错误映射（参考，本卡不冻结）**

| HTTP | code | 条件 |
|---:|---|---|
| 400 | `PARAM_ERROR` | grantId 非法、body/字段非法、key 非法、`reasonCode` 未冻结即出现 |
| 403 | `FORBIDDEN` | 缺 `device.access.manage`、成员/组织失效 |
| 404 | `NOT_FOUND` | 授权不存在或跨组织 |
| 409 | `INVALID_STATE` | 授权已是 `revoked`，或状态字段损坏；`expired` 仍允许撤权 |
| 409 | `REVISION_CONFLICT` | grant 在预读后变化、绑定字段变化、`expectedGrantRevision` 不符 |
| 409 | `CLEANUP_SNAPSHOT_REQUIRED` | 缺少 credential/device/claim/slot/guard 或绑定不一致 |
| 409 | `CONFLICT` | revoke job/log 确定性 ID 已存在、同键异摘要 |
| 503 | `NOT_CONFIGURED` | K2 缺失/非法 |

**权限与边界**

- 只释放本 grant 的 slot；不释放共享设备的 owner claim。
- `pending/effective/suspended/expired` 均可进入撤权（H4-a 实现允许 `expired`）；只有已 `revoked` 或结构损坏才 `INVALID_STATE`。
- 只写 grant/job/log/op key/op domain/audit；不写 credential/device/claim/slot 释放（H4-b 在清理成功时处理）。
- revoke job 进入 `queued`；本端点不调用 Provider、不连接设备。
- H4-b 的 dispatcher/finalize 是 LocalStore+Mock only；live/Cloud/真实 Provider 下必须 `NOT_CONFIGURED/503`。
- **Q5 前置**：HTTP 接线前必须独立完成“撤权服务与 HTTP 契约加固”，冻结 `reasonCode` 枚举、长度及字符、持久化位置、审计字段、响应投影、敏感信息禁入、历史兼容。

#### E06 `GET /api/v2/device-operation-jobs`（HTTP blocked）

> **Q1/Q7（2026-11-14）裁定**：`queryJob` 最小公开 DTO 已定（§3.5），但**未实现**；唯一权威 job revision 入口是按 ID 的 `queryJob`，不是列表。E06 无 `listJobs()`，列表契约不冻结，HTTP blocked。

| 项目 | 值 |
|---|---|
| 用途 | 本组织任务列表（服务层方法不存在） |
| Permission | `device.audit.read`（权限名在目录内） |
| 幂等 | 不适用 |
| 成功 | **未批准**（本卡不冻结列表 DTO 或状态码） |
| Provider | 0（`queryOperation` 不在本端点） |

**列表参数（旧稿候选，已降级，不构成契约）**

| 位置 | 字段 | 旧稿约束（作废） |
|---|---|---|
| Query | `state` | 可选；必须是既有 job 状态之一 |
| Query | `action` | 可选；`enroll`/`update`/`revoke` |
| Query | `limit` | 可选；1–100，默认 20 |
| Query | `cursor` | 可选；不透明游标 |

**当前事实**

- 服务层只有 `queryJob(jobId)`，**没有 `listJobs()`**，也没有按状态/action 过滤的方法（[service.mjs](../../admin-web/lib/face-service/service.mjs#L731-L736)）。
- `publicJobResult` 只有五字段，无 `revision`；Q1 的六字段目标 DTO 尚未实现（[dto.mjs](../../admin-web/lib/face-service/dto.mjs#L254-L263)）。
- E06 未注册：当前行为 `404/405`，零写、Provider 0。
- 即使未来实现列表，列表行也不能作为 mutation 的 revision 来源；UI 必须按 Q7 回到 `queryJob` 重查（§3.7）。
- **实现缺口**：编码卡必须先补只读列表方法或明确不做列表，并冻结 DTO；不得改变 `publicJobResult` 的既有调用方。`queryJob` 的 HTTP 暴露同样未获批准，本卡不新增任何读取路由。

## 3. 第三层：已裁定但未实现 / 不得接线

本节所有内容都**不可接线**。候选端点自身状态只使用 `proposed` 或 `blocked`；引用已实现端点（E01–E04）的事实状态时另行标注。E05/E06 已在上节按裁定降级。

### 3.1 E07 `retry`：blocked / proposed（Q3 已裁定，2026-11-14）

| 维度 | 现状 | 结论 |
|---|---|---|
| 服务入口 | 只有 `h3b.requeue`/`h4b.requeue`，无 `retry` 方法、无 K2 | blocked |
| 权限 | `device.operation.retry` 已在目录 | blocked（权限名已存在、端点未注册） |
| revision 权威 | 无 job revision 的 HTTP 读取；Q1 的 `queryJob` DTO 未实现 | blocked |
| K2 | 无 op key、无 `requestDigest`、无 domain guard、无严格重放 | blocked |
| 审计 | 每次成功一条 audit，但与 op key 无关联、无幂等 | blocked |
| HTTP | `routes.mjs` 有描述行，server 未注册 | blocked |

上一稿冻结的 `{expectedRevision} → {jobId,state,revision,nextAttemptAt}` 线形状**作废**，不再作为契约。本卡不定义 E07 的响应 DTO、不定义其 K2 method、不定义其错误映射；这些必须由 §3.2 的独立设计补齐。**Q3 明确：不复用不完整的 `requeue`。**

当前行为（本卡合并后仍然成立）：`POST /api/v2/device-operation-jobs/:jobId/retry` **未注册**，返回 `404/405`，不进入业务，零写，Provider 0。

### 3.2 未来 `retryable_failed` 独立设计（Q3 裁定：必须独立任务）

**Q3（2026-11-14）裁定：E07 为 blocked/proposed；不得复用 `h3b.requeue`/`h4b.requeue`；未来独立任务冻结下列全部内容。** 本卡不实现、不冻结、不验收。

| 待办项 | 必须冻结的内容 | 当前状态 |
|---|---|---|
| 权限 | `device.operation.retry`，只从成员 `permissions` 读取 | 权限已存在；端点关闭（blocked） |
| K2 method | method 名、摘要输入、result 指针、domain 作用域；不得与 `face.reconcile` 混用 | proposed（名称未冻结） |
| Idempotency-Key | 格式、作用域、原始键不落库、同键同摘要重放、异摘要 `CONFLICT` | proposed |
| `requestDigest` / operation domain | 精确字段集、domain head/version、失败关闭 | proposed |
| `expectedJobRevision` | 权威读取（按 ID `queryJob`）+ 正安全整数规则 + stale 409 | blocked（依赖 Q1 DTO 实现） |
| lease 状态 | `sending` 的 `leaseGeneration/leaseExpiresAt` 不得被普通 retry 绕过 | proposed |
| `attempts` | `attempts>=4` 拒绝；重排不重置预算 | proposed |
| `nextAttemptAt` | 未到期 `RETRY_NOT_DUE`；到期边界 `now >= nextAttemptAt` | proposed |
| 同键重放 | 必须返回首次成功 receipt，而不是第二次 `INVALID_JOB` | blocked（服务层无 K2） |
| 异摘要冲突 | 同键不同请求必须 `CONFLICT/409`，不覆盖 op key | blocked（服务层无摘要） |
| 审计 | audit 与 op key 同事务、可重放、可追溯 | proposed |
| `retryable_failed` 前置 | 仅接受 `retryable_failed && cleanupPhase==="dispatch"`；`awaiting_result` 禁止 | blocked（端点未注册） |
| 测试 | 服务层 K2 单测 + HTTP 契约测试 + 并发/重放/损坏矩阵 | blocked（未开始） |

约束：该设计必须**另立 H3/H4 独立任务**（Q3 已裁定），不得把 E07 直接塞进本卡或 H4-c 的 C2/C3。

### 3.3 E08 `reconcile`：blocked / proposed（Q6 已裁定，2026-11-14）

**Q6 裁定：E08 在下列全部条件具备前完全不注册。** 依赖链（缺一不可）：

1. **C1 `5dff386` 通过 Codex 独立终审**（当前只自述“等待复审”）。
2. **C2 三种 decision 实现**：`confirmed_removed`、`confirmed_present`、`still_unknown` 的服务层入口、DTO、K2/K3、evidence/head、错误码；当前未开始。
3. **RC01–RC73** 的 H4-c 矩阵可执行并通过。
4. **H4-c 最小响应投影**冻结：只含 `jobId/decision/jobState/grantState/cleanupPending/evidenceId/evidenceSequence/decidedAt/cleanupPhase/terminalReason/duplicate`；不得含 digest、actorId、orgId、idempotency key、requestDigest、opId、设备/人员/文件字段。
5. **Provider 调用为 0 的证据**：R2 只复用 H4-b 本地 finalize，不重发 `revokeFace`。
6. 另发 HTTP 编码卡，并在 `routes.mjs` 与 `server.mjs` 同步登记（Q6/Q8）。

本卡只保留 H4-c 设计已批准的语义（decision 三值、`still_unknown` 60 秒/8 次、`confirmed_present` 终态、R1/R2 两段式），**不冻结 HTTP DTO、不定义 E08 的 `expectedRevision`、不注册路径**。Q2 已定：E08 的 `expectedRevision` 指 job revision，不是 credential/grant revision。当前行为：未注册，`404/405`，零写。

### 3.4 E09 `finalize-retry`：blocked / proposed（Q6 已裁定，2026-11-14）

- 依赖 C3（`finalize-retry` 服务入口）完成并通过复审；C3 未开始。Q6 要求与 E08 同批条件齐备前**完全不注册**。
- generation 语义来自 H4-c 设计：`(jobId, expectedRevision)`；**Q2 裁定** `expectedRevision` 指 job revision，并同时作为恢复 generation 基准。同键同摘要只重放四字段指针，不同键在当前未消费终态 revision 可开新一轮，旧 revision `RECONCILE_GENERATION_CONSUMED/409`。
- 只做本地 finalize；不调用 Provider、不重发 `revokeFace`、不自动轮询、不重置 grant/slot/claim。
- E09 不在 `routes.mjs`，**不得注册**；当前行为 `404/405`，零写。

### 3.5 `queryJob` 最小公开 DTO（Q1 已裁定；未实现，blocked）

**Q1（2026-11-14）裁定**：`queryJob` 的最小公开 DTO 精确为 `jobId/state/revision/attempts/lastSuccessAt/failureReason` 六个字段。

| 字段 | 类型 | 权威来源 | 说明 |
|---|---|---|---|
| `jobId` | string | `job.jobId \|\| job._id` | 不透明 ID |
| `state` | string | `job.state` | 既有 job 状态机值 |
| `revision` | 正安全整数 | **仅服务端当前 job 记录**的 `job.revision` | 1..`Number.MAX_SAFE_INTEGER`；缺失或非法必须失败关闭 |
| `attempts` | number | `job.attempts ?? 0` | 缺省 0 |
| `lastSuccessAt` | number \| null | `job.lastSuccessAt ?? null` | 缺省 null |
| `failureReason` | string \| null | `job.failureReason` 截断 120 字符 | H3/H4 job 恒为 `null` |

规则：

1. **唯一来源**：`revision` 只能取自服务端当前 job 记录；不得来自缓存、列表行号、数组下标、本地自增、时间戳、digest 前缀或旧 mutation 响应。
2. **类型与失败关闭**：必须 `Number.isSafeInteger(revision) && revision >= 1`。服务端记录缺失或非法 → **不返回该 DTO**，按 `INVALID_JOB/409` 失败关闭（零写）；不得用 `0`、`null`、字符串或推算值补齐。客户端传入的 revision 非法 → `400 PARAM_ERROR`。
3. **禁止字段**：不得返回 `lease`（含 `leaseGeneration/leaseOwner/leaseExpiresAt`）、`requestDigest`、operation key、原始错误/`stack`、设备字段、隐私字段（人员、图片、objectKey 等）。
4. **权限与同态**：`device.audit.read`；跨组织/不存在同态 `404`，不得用 `403` 区分。
5. **未实现**：当前 `publicJobResult` 仍只有五字段，`queryJob` 无 `revision`（[dto.mjs](../../admin-web/lib/face-service/dto.mjs#L254-L263)）；本卡不修改服务层，E06/E07/E08/E09 继续 blocked。
6. **不新增 HTTP 路由**：`queryJob` 的 HTTP 暴露（无论路径）未获批准，须由独立编码卡解决；本卡不新增详情路由，也不把列表行当权威来源。
7. **UI**：在 `queryJob` 的 HTTP 读取获批并实现前，UI 没有合法 revision 来源 → 按钮隐藏/禁用、零请求（§3.7）。

示例与字段约束见附录 A。

### 3.6 revoke 契约：bodyless 仅为服务层事实；HTTP blocked（Q4/Q5 已裁定）

| 来源 | 内容 | 实现状态 | 本卡结论（2026-11-14） |
|---|---|---|---|
| H4 原设计 Q01 草案（`9fd088d`） | `revoke {expectedRevision, reasonCode}` | H4-a/H4-b 均未实现，入口为 bodyless | **不采用**；只作历史输入 |
| H4-c 设计（`b15aceb`） | revoke 输入不变；对账读取 grant 状态，不新增 revoke 字段 | 设计已批准；实现未开始 | **不扩展**；E05 仍 blocked |
| 服务层实现 | `revoke(grantId, {idempotencyKey})`，digest `{grantId}`，事务内用 `grant.revision` CAS | 已实现（事实） | **仅服务层事实**；不构成 HTTP 契约 |
| **Q4 裁定** | 无请求体仅内部服务实现事实，不批准 HTTP；E05 HTTP blocked；未来 mutation 至少 `expectedGrantRevision`；正式枚举及审计契约冻结前不得接收 `reasonCode` | **已裁定** | E05 契约 blocked、HTTP blocked |
| **Q5 裁定** | HTTP 接线前完成独立“撤权服务与 HTTP 契约加固”：枚举、长度及字符、持久化位置、审计字段、响应投影、敏感信息禁入、历史兼容 | **已裁定，任务未开始** | 加固完成前不得注册/编码 |

`expectedRevision` → **`expectedGrantRevision`** 的关闭理由：

- Q2 已定名：Revoke 的未来 mutation 字段是 `expectedGrantRevision`，不得沿用旧稿的 `expectedRevision`。
- 当前服务层 `revoke` 用事务内读到的 grant revision 做 CAS；客户端没有权威 grant revision 读取端点（E06 是 job，不是 grant）。
- 在无权威读取的情况下接收客户端版本号，只会制造“客户端自己编版本号”的伪契约。
- 因此：**E05 HTTP 不开放**；未来注册时 mutation 至少带 `expectedGrantRevision`，且该字段必须先有权威 grant revision 读取设计。

`reasonCode` 的关闭理由：

- 代码中 `revoke` 路径没有任何 `reasonCode` 入参、枚举、持久化字段或审计字段；`reasonCode` 只出现在 job `result` 的服务端生成值（H3/H4-c）。
- **Q4/Q5 裁定**：在正式枚举与审计契约冻结前不得接收 `reasonCode`。E05 当前未注册，带该字段的请求为 `404/405`；未来注册后若出现即 `400 PARAM_ERROR`。
- 未来必须在 Q5 的加固任务中同时冻结：枚举清单、长度与字符集、持久化位置、audit 字段、响应投影、敏感信息禁入、历史兼容。

### 3.7 UI revision 规则（Q7 已裁定，2026-11-14）

**Q7 裁定：唯一权威 job revision 入口是按 ID 的 `queryJob`。UI 在依赖 job revision 的 mutation 前必须重查。**

1. 页面只能在 mutation 前按 ID 调用 `queryJob` 取得**最新** `revision`；该 revision 只用于本次 mutation 的同一 job。
2. 禁止用列表行号、数组下标、本地自增、旧 mutation 响应、缓存旧 revision、时间戳、`attempts`、`cleanupPending` 推导 revision。
3. 无合法 revision（缺失、非法、读取未实现或读取失败）→ 依赖它的“重试/对账/恢复”按钮必须**隐藏或禁用**；禁用态不得发请求，也不得在点击时兜底猜测。
4. 禁止在无 revision 时发“探测请求”判断是否可用；页面对未注册端点必须零请求。
5. 禁止为 `awaiting_result` 渲染“重试”按钮；只能渲染只读状态与（未来）对账入口。
6. 读取端点不使用 `expectedRevision`；读取只回显状态，不产生 CAS。
7. 当前 `queryJob` 的 HTTP 暴露未获批准（§3.5），所以 UI **没有合法来源**：本轮及编码卡完成前，相关按钮一律隐藏/禁用，网络请求为 0。未来 UI 编码卡必须先有 `queryJob` HTTP 读取的独立批准，再按端点逐项启用；本卡不提供 UI 代码。

### 3.8 `UNKNOWN_RESULT` 收敛（Q3 已裁定：禁止普通 requeue 与自动重试）

`awaiting_result` 的合法操作只有两类（其余一律禁止）：

| 操作 | 是否允许 | 说明 |
|---|---|---|
| 只读查询（按 ID `queryJob`） | 允许（设计层） | 零写、Provider 0；HTTP 读取未注册 |
| 人工对账 `device.operation.reconcile`（候选 E08） | 允许（HTTP 仍有门禁） | 唯一人工收敛入口；decision 三选一；当前未注册 |
| `retry`（E07） | 禁止 | `409 INVALID_JOB`（H3 D53）；当前未注册 |
| 普通 `requeue` | 禁止 | 服务层只接受 `retryable_failed`；`awaiting_result` 直接 `INVALID_JOB` |
| 自动调度/定时器 | 禁止 | 不进入 HTTP，也不得直接改 job |
| Provider `queryOperation` | 禁止 | 无 HTTP 入口；调用计数必须为 0 |
| 新键轮询 | 禁止 | 只能同键重放（已实现端点）或人工对账 |

- `awaiting_result` 的合法出边只有 `succeeded`/`terminal_failed`（人工对账）与显式失败关闭；H3 状态表虽列 `retryable_failed`，H4/H4-c 明确禁止把它用于自动重发。
- 普通 `requeue` 不能替代 reconcile：它没有证据、没有 K3、没有 decision，且会绕过“结果不明”的审计链；**Q3 明确禁止把普通 requeue 当 retry 或自动重试使用**。

### 3.9 状态词表

| 词 | 用途 | 禁止 |
|---|---|---|
| `implemented` | 有代码或已终审文档依据，事实成立 | 不得外推为 HTTP 已注册 |
| `proposed` | 设计已提出/已裁定但未实现、未冻结 | 不得写成可接线或可编码 |
| `blocked` | 缺前置或本卡关闭 | 不得写成 `ready`/`partial`/`已就绪`/`开放` |
| `not-applicable` | 该维度不适用 | 不得用于掩盖未实现 |

## 4. 第四层：继续关闭端点

### 4.1 九个端点全部关闭

| 端点 | 登记状态 | 关闭依据 | 允许下一步 |
|---|---|---|---|
| E01 submit | blocked | 本卡只冻结契约；server 未注册 | 编码卡：注册 + DTO 校验 + K2 + 测试 |
| E02 queue | blocked | 同上 | 编码卡 |
| E03 review | blocked | 同上；HTTP 必填 `expectedCredentialRevision`（Q2） | 编码卡 + 补齐校验 |
| E04 image | blocked | 缺 `credentialId → sourceFileId` 解析层 | 编码卡 + 解析层 |
| E05 revoke | blocked | Q4：bodyless 不是 HTTP 批准；Q5 加固任务未完成；未来至少 `expectedGrantRevision`；live/Cloud 永久关闭 | 服务与契约加固 + 编码卡 |
| E06 list | blocked | 无 `listJobs()`；Q1 DTO 未实现；无权威 revision 的 HTTP 读取 | `queryJob` DTO 实现 + 列表契约 + 编码卡 |
| E07 retry | blocked | 无 K2/摘要/domain guard/严格重放；Q3 独立任务未开始 | 独立设计任务（§3.2） |
| E08 reconcile | blocked | Q6：C1 终审、C2、C3、RC01–RC73、投影、Provider 0 证据未齐 | H4-c C2 + 复审 + 编码卡 |
| E09 finalize-retry | blocked | Q6：C3 未开始，其余前置同 E08 | H4-c C3 + 复审 + 编码卡 |

**总门禁**：本卡合并后，九个端点仍然全部关闭；`server.mjs` 不注册、不调用、不新增人脸分支。注册必须另发编码卡，并逐项引用本卡端点 ID。Codex 裁定（Q1–Q8）**不解除**本门禁。

### 4.2 不存在、不得新增的路径

| 路径/能力 | 状态 | 原因 |
|---|---|---|
| `POST /api/v2/device-access-grants` | 不存在 | 现有 routes 无此路径；本卡不新增 |
| `GET /api/v2/device-operation-jobs/:jobId` | 不存在 | 本卡不新增详情路由；`queryJob` 的 HTTP 暴露须独立批准（Q1/Q7） |
| `POST /api/v2/device-operation-jobs/:jobId/query` | 不存在 | H3/H4 禁止 Provider 查询入口 |
| `POST /api/v2/device-operation-jobs/:jobId/cancel` | 不存在 | H3 无取消入口，`sending` 不可取消 |
| `POST /api/v2/device-operation-jobs/:jobId/retry` | 描述表有、未注册 | E07 候选；Q3 独立任务完成前不得注册 |
| `POST /api/v2/device-operation-jobs/:jobId/reconcile` | 描述表有、未注册 | E08 候选；Q6 前置未齐，不得注册 |
| `POST /api/v2/device-operation-jobs/:jobId/finalize-retry` | 不在描述表、未注册 | E09 候选；Q6 前置未齐，不得注册 |
| `POST /api/v2/device-access-grants/:grantId/expire` | 不存在 | 到期扫描器属于内部路径，不是 HTTP |
| `POST /api/v2/face-credentials/:id/thumbnail` | 不存在 | 禁止缩略图/派生图缓存 |
| `DELETE`/`PUT` 任何人脸资源 | 不存在 | 状态迁移必须走显式动作 |
| 设备连接、Provider 调用、Cloud live | 继续关闭 | 本卡与 H4-c 均不接 |

### 4.3 注册门禁（编码卡必须逐项满足）

1. 只注册本卡 §2 冻结的端点；候选端点不得注册，直到对应前置完成。**E05 须先完成 Q5 加固；E07 须先完成 Q3 独立任务；E08/E09 须先满足 Q6 全部条件。**
2. 每个端点必须在 `routes.mjs` 增加/复用描述行，并在 `server.mjs` 唯一分支内调用服务层；不得新增旁路。
3. 每个端点的错误码必须落在 §2.5；不得新增同义码。
4. 每个端点必须携带 §8 对应矩阵行作为验收；候选端点行只能在对应前置完成后启用。
5. 不得在注册 PR 中顺带实现 retry、reconcile 或 finalize-retry。
6. 变更必须只落在 `server.mjs`、`routes.mjs`、服务层与测试；其他文件零差异；文档与代码分开提交。
7. **Q7**：依赖 job revision 的 mutation，UI 必须在每次请求前按 ID 重查 `queryJob`；无合法 revision 时不得注册“可点击”的控件。
8. **Q1**：读取投影不得包含 lease、`requestDigest`、operation key、原始错误、设备或隐私字段。

### 4.4 `routes.mjs` 描述表处置（Q8 已裁定，2026-11-14）

**Q8 裁定：候选仅设计文档；`routes.mjs` 只允许“已冻结且批准进入实现阶段”的描述；proposal 不得暴露为运行时契约；现有候选描述由未来独立小提交清理；本轮不修改 `routes.mjs`。**

| 项目 | 裁定结果 |
|---|---|
| 候选端点（E07/E08/E09） | 只在设计文档记录；不是运行时契约，不得作为注册依据 |
| `routes.mjs` 允许内容 | 已冻结且已批准进入实现阶段的描述行；proposal 不进入 |
| 现有 E07/E08 描述行 | 视为历史提案；**未来独立小提交清理**，不得夹带业务变更 |
| E09 | 不加入描述表 |
| 本轮动作 | **不修改 `routes.mjs`**（零差异）；`server.mjs` 同样零差异、三路径 0 分支 |

上一稿的 A/B/C 三方案（保留候选/移除候选/加入 E09）**作废**：Q8 已直接给出规则，不再需要选择。清理提交必须是独立、可回滚、仅触及描述表的小提交，并在提交说明中引用 Q8。

## 5. E04 私密图片与三权分立（已冻结）

### 5.1 三权分立

| 权限 | 允许 | 不允许 |
|---|---|---|
| `device.face.submit` | 上传/提交人脸来源，提交凭证 | 审核、读原图 |
| `device.face.review` | 看审核队列元数据、通过/驳回 | 读原图、上传、撤权 |
| `device.face.readPrivate` | 按凭证读取原图 | 审核、提交、撤权 |
| `device.access.manage` | 创建/撤销授权 | 审核、读原图 |
| `device.audit.read` | 列任务 | 审核、读原图、撤权 |
| `device.operation.retry` | （未来）重排已到期 retryable job | 对账、读原图；当前端点关闭 |
| `device.operation.reconcile` | （未来）对账、finalize-retry | 重试、读原图；当前端点关闭 |

`admin` 角色不隐含以上任何权限；`org_memberships.permissions` 是唯一授权来源（[org.mjs](../../admin-web/lib/org.mjs#L89-L105)）。

### 5.2 请求与解析顺序

| 位置 | 字段 | 类型/约束 |
|---|---|---|
| Path | `credentialId` | 不透明 ID |
| Query | 无 | 不接受 `fileId`、`url`、`purpose`、`download` 等参数 |

无 body、无 Idempotency-Key。解析顺序：

1. 用当前 `orgId` 读取 `face_credentials/<credentialId>`；不存在/跨组织：`FILE_NOT_FOUND/404`。
2. 取 `credential.sourceFileId`，调用 `FileService.authorizeDownload(fileId, actor)`；该函数按当前成员权限、purpose `face-biometric`、`visibility=private`、`status=ready`、组织归属复核。
3. 仅鉴权通过后读取字节；private 一律代理下载，不签发临时 URL。
4. 写 `file_access` denied/download 留痕；不把文件名、objectKey、摘要写入响应。

### 5.3 响应头

| Header | 值 |
|---|---|
| `Content-Type` | `image/jpeg` 或 `image/png` |
| `Content-Length` | 实际字节数 |
| `Content-Disposition` | `inline; filename*=UTF-8''<encoded>` |
| `Cache-Control` | `no-store` |
| `Pragma` | `no-cache` |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Security-Policy` | `sandbox; default-src 'none'` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Resource-Policy` | `same-origin` |

不返回 `ETag`、不处理 `Range`、不返回缩略图、不重定向、不返回 JSON 信封。

### 5.4 错误与 404 同态

| HTTP | code | 条件 | 写 |
|---:|---|---|---:|
| 401 | 现有登录门 | 无会话 | 0 |
| 404 | `FILE_NOT_FOUND` | 凭证不存在/跨组织（尚未解析到 fileId） | 0 |
| 404 | `FILE_NOT_FOUND` | 文件不存在、非 face-biometric、非 private、非 ready、缺 `device.face.readPrivate` | `L`（file_access denied） |
| 503 | `STORAGE_UNAVAILABLE` | 文件存储后端与配置不一致 | 0 |
| 503 | `ADAPTER_UNAVAILABLE` | 读文件/Store 异常 | 0 |

`L` 表示只新增一条 `file_access_log`（denied 或 download）；它不改变凭证、文件、grant、job 等业务集合，也不是“全库零写”。

**关键结论**：缺 `device.face.readPrivate` 返回 **404**，不是 403。原因是文件契约（[files.mjs](../../admin-web/lib/files.mjs#L1049-L1072)）已冻结“无权限与不存在同态”，防止通过 403/404 差异枚举凭证或文件。审核人只有 `device.face.review` 时，调用本端点得到 404。

### 5.5 审计留痕

| 情形 | 响应 | 审计 |
|---|---|---|
| credential 不存在 | 404 `FILE_NOT_FOUND` | 无 credential 可记；可按请求记 denied |
| credential 跨组织 | 404 `FILE_NOT_FOUND` | denied |
| 文件不存在/非 ready/非 private | 404 `FILE_NOT_FOUND` | denied |
| 缺 `device.face.readPrivate` | 404 `FILE_NOT_FOUND` | denied |
| 存储后端不匹配 | 503 `STORAGE_UNAVAILABLE` | 不记录字节 |
| 成功 | 200 字节 | download |

404 的 message 固定“文件不存在或不可见”；不得出现“无权限”“跨组织”“已停用”等差异。

## 6. `UNKNOWN_RESULT` 的人工收敛

### 6.1 状态事实

- `UNKNOWN_RESULT` 只把 job 迁到 `awaiting_result`；不自动重发，不自动查询。
- `awaiting_result` 的合法出边只有 `succeeded`/`terminal_failed`（人工对账）与显式失败关闭；H3 状态表虽列 `retryable_failed`，H4/H4-c 明确禁止把它用于自动重发。
- 普通 `requeue` 只接受 `retryable_failed && cleanupPhase==="dispatch"`；`awaiting_result` 调用必须 `INVALID_JOB`。
- `retry` 入口（候选 E07）只接受 `retryable_failed && cleanupPhase==="dispatch"`；`awaiting_result` 调用必须 `INVALID_JOB/409`（H3 D53）；当前端点未注册。**Q3（2026-11-14）明确：不得用普通 `requeue` 代替 retry，也不得自动重试。**
- `finalize-retry`（候选 E09）只接受 `terminal_failed/LOCAL_FINALIZE_EXHAUSTED`；`awaiting_result` 调用必须 `INVALID_STATE/409`；当前端点未注册。

### 6.2 允许与禁止

| 操作 | `awaiting_result` 是否允许 | 说明 |
|---|---|---|
| 按 ID `queryJob` 只读 | 允许（设计层） | 零写、Provider 0；HTTP 读取未注册 |
| E06 列表只读 | 允许（设计层） | 零写、Provider 0；无 `listJobs()`，HTTP 未注册 |
| E08 `reconcile`（候选） | 允许（HTTP 仍有门禁） | 唯一人工收敛入口；decision 三选一；Q6 前不注册 |
| E07 `retry` | **禁止** | 409 `INVALID_JOB`，零写；当前未注册 |
| 普通 `requeue` | **禁止** | 服务层直接拒绝；不得绕过 reconcile（Q3） |
| E09 `finalize-retry` | **禁止** | 409 `INVALID_STATE`，零写；当前未注册 |
| 自动调度/定时器 | 禁止 | 不进入 HTTP，也不得直接改 job |
| Provider `queryOperation` | 禁止 | H3/H4 不提供该入口；调用 0 |
| 客户端轮询新键 | 禁止 | 只能同键重放或人工对账 |

### 6.3 HTTP 语义（全部为未来参考，当前无端点产生）

- E08 的 202 只表示 R1 已提交、R2 本地 finalize 未完成；**不加 `Retry-After`**，避免暗示自动重试。当前 E08 未注册，**不产生 202**。
- E08 的 `still_unknown` 返回 200 且 job 保持 `awaiting_result`；不新增 evidence 之外的 job 写。（未来条件，当前不适用。）
- 同键重放返回原投影，不再写 evidence/head；不同键同结论（已终态）才可能 `duplicate:true`。（未来条件。）
- 任何 503/409 都不是“稍后自动重试”的信号；客户端必须重新按 ID 读取 `queryJob` 或同键重放，不得换新键自动重发。
- `confirmed_present` 是终态，不释放资源；后续重新清理必须另立新 generation/job，不由本卡或 HTTP 自动完成。

## 7. 容量、90 refs 与竞态

| 项目 | 冻结规则 |
|---|---|
| HTTP 层 refs | 不增加事务 refs；refs 由服务层决定 |
| 非 finalize 写 | 14–15 refs，远低于 90 |
| finalize R2 | H4-b `8+N`；N=82 → 90 成功；N=83 → 91 拒绝或 local-finalize pending |
| 预扫 | E05/E08 在 R1 写前只读预扫；N≥83 → `CAPACITY_EXCEEDED/400`，零写、Provider 0 |
| 预扫后增长 | 由 R2 的 H4-b `>90` 分支兜底，绝不半释放 |
| 请求体 | 与 refs 无关；body 大小只受 64 KiB 上限约束 |
| 并发 | 线性化点仍是 job/head/guard CAS；HTTP 不提供“先读后写”的跨请求事务 |

## 8. 测试矩阵

### 8.1 记号、阶段与 harness

- `Z`：全库内容级零变化（所有记录、排序 ID、计数、audit 均不变）。
- `Zc`：业务核心集合零变化（凭证/grant/job/log/evidence/head/domain/op key 均不变）；E01/E03 使用非确定性 `#audit`，同键重放仍可能追加一条 `admin_audit`，因此这两条重放断言用 `Zc` 而不是 `Z`。
- `L`：只新增一条 `file_access_log`（denied 或 download），业务集合不变。
- `P0`：Provider 调用入口增量为 0；`P1`：仅允许一次既有 Mock 调用。
- **阶段**：本卡矩阵分两类。
  - **当前静态验收（§8.10，S 系列）**：只读代码/文档即可判定，不启动 server、不发 HTTP、不跑测试。
  - **未来契约测试（§8.2–§8.9，N/R/C/D/P/V/F/U 系列）**：HTTP 接线卡（候选端点还需 C2/C3 完成）后才能执行；现在不得执行，也不得当作已通过。
- HTTP 测试使用 `createApp` 启动临时端口，Cookie + CSRF + Origin 登录；每个用例先固化基线快照，再比较。
- Store 使用 LocalStore 临时目录；禁止 Cloud/live/真实设备。
- 图片用例比较字节长度、Content-Type 和响应头，不把图片写入日志。
- 敏感扫描对所有响应体、日志、audit、evidence/head/op key 执行固定正则；零命中才 PASS。
- 每个失败用例同时断言无 500、无 stack、无配置值、无 Provider 调用。

### 8.2 未来契约测试：正常路径

| ID | 端点 | 前置/请求 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| N01 | E01 | 合法 personId/sourceFileId，submit 权限 | 201，`credentialId` 稳定，`reviewState=submitted` | 0 | 凭证+op key+domain+audit |
| N02 | E01 | 同组织第二个 personId | 201，新 credentialId | 0 | 同上 |
| N03 | E02 | 一条 submitted、一条 approved | 200，仅 submitted 行，无图片字段 | 0 | Z |
| N04 | E03 | submitted，`approved`，正确 revision | 200，`reviewState=approved` | 0 | 凭证+op key+domain+audit |
| N05 | E03 | submitted，`rejected`，正确 revision | 200，`reviewState=rejected` | 0 | 同上 |
| N06 | E04 | 有 `device.face.readPrivate`，JPEG 凭证 | 200，`image/jpeg`，字节与源文件一致 | 0 | L（download） |
| N07 | E05 | pending grant，无 blocker | **404/405**；E05 HTTP blocked（Q4）；加固完成 + 编码卡后另验 200 | 0 | Z |
| N08 | E06 | 同组织 3 条 job，`device.audit.read` | **404/405**；无 `listJobs()`、未注册；列表契约未冻结 | 0 | Z |
| N09 | E07 | `retryable_failed` 已到期，持 `device.operation.retry` | **404/405**；未注册、业务未进入；旧版 200 queued 期望作废（无 K2/无审计） | 0 | Z |
| N10 | E08 | `awaiting_result`，`confirmed_removed` | **404/405**；候选未注册；H4-c C2 完成前不得返回 200 | 0 | Z |
| N11 | E08 | `awaiting_result`，`confirmed_present` | **404/405**；同上 | 0 | Z |
| N12 | E09 | `terminal_failed/LOCAL_FINALIZE_EXHAUSTED`，正确 revision | **404/405**；C3 未开始 | 0 | Z |
| N13 | E06 | 任意 job 列表 | **404/405**；E06 未注册；Q1 只定 `queryJob` DTO，列表字段不得外推 | 0 | Z |
| N14 | E07/E08/E09 | 客户端在无权威 revision 时尝试 mutation | 0 请求发出（客户端契约，Q7）；若强行请求则 404/405 | 0 | Z |
| N15 | E05 | 任意 body 字段（含 `expectedGrantRevision/reasonCode`） | **404/405**（未注册，Q4）；加固后若注册必须按新契约校验，`reasonCode` 未冻结即 400 | 0 | Z |

### 8.3 未来契约测试：重放与幂等

| ID | 端点 | 前置/请求 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| R01 | E01 | 同键同 body 重放 | 201，同 credentialId | 0 | Zc |
| R02 | E01 | 同键，personId 改变 | 409 `CONFLICT` | 0 | Z |
| R03 | E03 | 同键同 decision/`expectedCredentialRevision` 重放 | 200，同结果 | 0 | Zc |
| R04 | E03 | 同键，decision 改变 | 409 `CONFLICT` | 0 | Z |
| R05 | E05 | 同键同 grant 重放 | **404/405**；HTTP 未批准（Q4）；加固后另验 | 0 | Z |
| R06 | E01/E03 | 同一原始 key 用于两个不同 K2 method | 各自成功，不互相重放 | 0 | 各自首次写 |
| R07 | E01/E05 | 不同 actor 使用同一原始 key | E01 K2 作用域隔离；E05 未注册时 404/405（加固后另验） | 0 | 按端点 |
| R08 | E07 | 同键同 revision 重放 | **404**；未注册，不创建 op key；旧版 200 receipt 期望作废 | 0 | Z |
| R09 | E07 | 同键，revision 改变 | **404**；不覆盖不存在的 op key | 0 | Z |
| R10 | E08 | 同键同 body 重放 | **404**；未注册；C2 完成后再验 200 同投影 | 0 | Z |
| R11 | E09 | 同键同 body 重放 | **404**；未注册；C3 完成后再验 | 0 | Z |
| R12 | E01/E03；E05 仅服务层 | operation key 记录缺失/非对象/错 org/realm/keyVersion/createdAt/摘要不符 | 409 `CONFLICT`；不新建、不覆盖、不返回旧结果 | 0 | Z |
| R13 | E01/E03；E05 仅服务层 | 权限撤销后同键重放 | 403 `FORBIDDEN`；不命中 op key 缓存、不返回旧结果 | 0 | Z |
| R14 | E07/E08/E09 | 未实现端点同键异摘要 | 404/405；不进入 K2、不写 op key | 0 | Z |

### 8.4 未来契约测试：竞态

| ID | 端点 | 注入 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| C01 | E01 | 两并发同键 | 一个凭证；两个 201 同 ID | 0 | 一次核心写 |
| C02 | E03 | 两并发不同键，同 revision | 一胜 200；另一 409 `REVISION_CONFLICT`/`INVALID_STATE` | 0 | 一次写 |
| C03 | E05 | 两并发不同键，同 grant | **404/405**（HTTP 未批准，Q4）；加固后另验一胜 | 0 | Z |
| C04 | E07 | 人工 retry 与调度器同 job | **404/405**（未注册）；并发均不写；C2 后另验 | 0 | Z |
| C05 | E07/E08 | `awaiting_result` 同时 retry + reconcile | 两者均 **404/405**（均未注册）；零写 | 0 | Z |
| C06 | E08/E05 | reconcile R2 与 H4-b finalize 同 job | **404/405**（E08 未注册）；不重复释放 | 0 | Z |
| C07 | E08 | 两并发不同 decision | **404/405**；C2 后另验一胜 | 0 | Z |
| C08 | E09 | 两并发同 generation | **404/405**；C3 后另验一胜 | 0 | Z |
| C09 | E08 | 两并发同键 `still_unknown` | **404/405**；C2 后另验一次写 | 0 | Z |
| C10 | E05/createGrant | 撤权与 createGrant 争 guard | E05 HTTP **404/405**（Q4）；服务层 guard CAS 另验一胜，不误放 claim | 0 | Z |
| C11 | E01/E03；E05 仅服务层 | 请求开始后、事务提交前成员权限被撤销 | 403 `FORBIDDEN`；事务内复核生效；零写 | 0 | Z |
| C12 | E07/E08/E09 | 未注册端点并发请求 | 全部 404/405；无业务写、无 Provider、无 op key | 0 | Z |
| C13 | E08 | 权限撤销与候选 reconcile 并发 | 404（未注册）；若未来注册必须 403、零写 | 0 | Z |

### 8.5 未来契约测试：DTO 与损坏记录

| ID | 端点 | 注入 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| D01 | E01 | body 多 `deviceId` | 400 `PARAM_ERROR` | 0 | Z |
| D02 | E01 | 缺 `Idempotency-Key` | 400 `PARAM_ERROR` | 0 | Z |
| D03 | E01 | key 15 位、129 位、含空格或 `/` | 400 `PARAM_ERROR` | 0 | Z |
| D04 | E03 | 缺 `expectedCredentialRevision`（或旧名 `expectedRevision`） | 400 `PARAM_ERROR`；旧名不得被接受 | 0 | Z |
| D05 | E03 | `decision=approve` 或大小写漂移 | 400 `PARAM_ERROR` | 0 | Z |
| D06 | E05 | 任意 body 字段（`expectedGrantRevision`/`reasonCode`/`reason`） | **404/405**（HTTP 未批准，Q4）；加固后若注册必须 400，`reasonCode` 未冻结不得接收 | 0 | Z |
| D07 | E07 | revision 为 0/小数/字符串 | **404**（未注册先于 DTO）；若注册后必须 400 | 0 | Z |
| D08 | E08 | path jobId 与 body jobId 不同 | **404**（未注册）；C2 后必须 400 | 0 | Z |
| D09 | E08 | evidence 多 `digest`/`raw`/`payload` | **404**（未注册）；C2 后必须 400 | 0 | Z |
| D10 | E08 | `sourceType=mock_provider` 或 sourceCode 不匹配 | **404**（未注册）；C2 后必须 409 `EVIDENCE_INVALID` | 0 | Z |
| D11 | E08 | observedAt 早于 finishedAt、未来、超 24h | **404**（未注册）；C2 后必须 409 `EVIDENCE_STALE` | 0 | Z |
| D12 | E08 | previous evidence 缺字段/错 sequence/HMAC 不符 | **404**（未注册）；C2 后必须 409 `EVIDENCE_CHAIN_BROKEN` | 0 | Z |
| D13 | E06 | 任意列表 query（`limit=0/101`、state 未知） | **404/405**（未注册）；列表契约未冻结 | 0 | Z |
| D14 | E06/E07 | job 未知字段、phase 矛盾 | E06 **404/405**、不读取 revision；E07 404；不得 500 | 0 | Z |
| D15 | 全部 | 跨组织 credential/grant/job ID | 404 `NOT_FOUND`/`FILE_NOT_FOUND`，同态 | 0 | Z |
| D16 | 全部 | 路径 `%ZZ`/双重编码/编码斜杠 | 400 `PARAM_ERROR`，不 500/503 | 0 | Z |
| D17 | E03/E07/E08/E09 | revision 字段（`expectedCredentialRevision`/`expectedJobRevision`/`expectedRevision`）为 0、-1、1.5、`"7"`、NaN、Infinity、2^53 | 400 `PARAM_ERROR`；不进入业务（E07–E09 未注册时先 404/405） | 0 | Z |
| D18 | E03 | stale credential revision（落后或超前） | 409 `REVISION_CONFLICT`；零写；不得 200/500 | 0 | Z |
| D19 | E05 | body 带 `reasonCode`、`reason`、`force`、嵌套 `metadata.reasonCode` | **404/405**（HTTP 未批准，Q4）；加固后若注册必须 400；`reasonCode` 未冻结一律拒绝 | 0 | Z |
| D20 | UI | 无合法 revision（缺失/非法/读取失败） | 按钮隐藏或禁用、不发请求（客户端 0 网络，Q7） | 0 | Z |
| D21 | E03 | credential revision 边界：`MAX_SAFE_INTEGER` 可读但不可 +1；`MAX_SAFE_INTEGER+1` 输入 | 输入 400；写入侧 409 `INVALID_STATE`/`REVISION_CONFLICT`；零写 | 0 | Z |
| D22 | 全部 | 用列表行号/数组下标/本地自增/缓存值/旧 mutation 响应/时间戳作为 revision | 客户端不得发送；服务端 400 或 409；不得接受为 CAS 基准（Q7） | 0 | Z |
| D23 | queryJob | 正常 job，`revision=4` | 六字段 DTO；`revision` 为正安全整数且只来自服务端当前 job 记录（Q1） | 0 | Z |
| D24 | queryJob | 服务端 job 记录缺 `revision` | **失败关闭**：不返回该 DTO/行；`INVALID_JOB/409`；不得补 0/null/字符串 | 0 | Z |
| D25 | queryJob | 记录 `revision` 为字符串/0/负数/小数/非安全整数 | **失败关闭**：同上；不得取整、截断、回退缓存或列表值 | 0 | Z |
| D26 | E07/E08/E09 | stale job revision（未来正确字段名，落后或超前） | 当前 **404/405**（未注册）；注册后必须 409 `REVISION_CONFLICT`、零写 | 0 | Z |
| D27 | E03 | 用 job revision 冒充 credential revision | 409 `REVISION_CONFLICT` 或 400；字段名必须为 `expectedCredentialRevision`，不得混用（Q2） | 0 | Z |
| D28 | createGrant（服务层，非 HTTP） | `expectedCredentialRevision` 正确/过期 | 正确通过；过期 409；本卡不新增 HTTP 路径（Q2） | 0 | Z |
| D29 | E05 | 未来 `expectedGrantRevision` 契约未完成 | **不注册**（404/405）；bodyless 不是已批准 HTTP 契约；Q5 加固完成前零编码 | 0 | Z |

### 8.6 未来契约测试：容量

| ID | 端点 | 注入 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| P01 | E05 | 82 candidates | **404/405**（HTTP 未批准，Q4）；服务层容量另验；加固后另验 200 | 0 | Z |
| P02 | E05 | 83 candidates 预扫 | **404/405**（未注册）；加固后另验 400 `CAPACITY_EXCEEDED` | 0 | Z |
| P03 | E05 | R1 后增长到 83 | **404/405**（未注册）；加固后另验 202 pending、不半释放 | 0 | Z |
| P04 | E08 | 82 candidates `confirmed_removed` | **404**（未注册）；C2 后另验 200 succeeded | 0 | Z |
| P05 | E08 | 83 candidates `confirmed_removed` | **404**（未注册）；C2 后另验 400 | 0 | Z |
| P06 | 全部 | body >65536 字节 | 413 `PARAM_ERROR`，不 503 | 0 | Z |
| P07 | E06 | 任意列表 query（`limit=101`） | **404/405**（未注册）；列表契约未冻结 | 0 | Z |
| P08 | E07/E08/E09 | 任意 body（含超大/畸形 JSON）发到未注册端点 | 404/405；不解析 body、不返回 413、不 503 | 0 | Z |
| P09 | 全部 | HTTP 层 refs 计数 | 不新增 refs；E05 服务层仍 14–15（HTTP blocked）；finalize 90 上限不变 | 0 | Z |

### 8.7 未来契约测试：隐私

| ID | 端点 | 注入/检查 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| V01 | E02 | 队列响应扫描 | 无图片字节/URL/objectKey/checksum/文件名/Provider 数据 | 0 | Z |
| V02 | E04 | 只有 `device.face.review` 的成员读图 | 404 `FILE_NOT_FOUND`，无字节，denied 留痕 | 0 | L |
| V03 | E03 | 只有 `device.face.readPrivate` 的成员审核 | 403 `FORBIDDEN` | 0 | Z |
| V04 | E04 | 有 `readPrivate` 的成员读图 | 200，字节一致，download 留痕 | 0 | L |
| V05 | E02/E03/E04 | admin 角色但 permissions 为空 | queue/review 403；image 404 | 0 | Z |
| V06 | E04 | 跨组织 credential | 404，与不存在不可区分 | 0 | Z |
| V07 | E04 | 响应头 | 无 ETag/Range/302；有 no-store/nosniff/CSP sandbox | 0 | Z |
| V08 | 全部 | 在记录/请求注入姓名、手机号、证件号、IP、MAC、序列号、objectKey、原始 key | 响应/日志/audit/evidence 零命中 | 0 | Z |
| V09 | 全部 | 触发 404/409/503 | 错误消息无资源存在性、PII、配置值、stack | 0 | Z |
| V10 | E04 | `?fileId=`、`?url=`、`?purpose=` | 参数被忽略或 400；不得读取其他文件 | 0 | Z |
| V11 | E04 | 尝试通过 `/api/v2/files/:id/download` 读 face 文件 | 现有文件契约拒绝或 404，不泄露 | 0 | Z |
| V12 | 全部 | 响应/日志/audit/evidence 扫描 `requestDigest` | 零命中；不得返回任何摘要原值或可逆前缀 | 0 | Z |
| V13 | 全部 | 扫描原始 `Idempotency-Key` | 零命中；只存在 HMAC 派生 op key | 0 | Z |
| V14 | E08 | 响应扫描 evidence digest/head/fingerprint/K3 配置 | 零命中；只允许 `evidenceId` 与 `evidenceSequence` | 0 | Z |
| V15 | 全部 | 扫描 PII 与伪 revision 来源 | 无姓名/手机/证件/人脸/序列号/objectKey；无缓存、行号、本地自增作为 revision | 0 | Z |
| V16 | UI | 无权威 revision 时监听网络 | 0 个 `/retry`、`/reconcile`、`/finalize-retry` 请求 | 0 | Z |

### 8.8 未来契约测试：失败关闭与配置

| ID | 端点 | 注入 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| F01 | E01/E03；E05 仅服务层 | K2 缺失/非法 | 503 `NOT_CONFIGURED`（E05 HTTP 未批准） | 0 | Z |
| F02 | E01/E03；E05 仅服务层 | K2 domain 单边缺失/损坏 | 409 `DOMAIN_INCOMPLETE` | 0 | Z |
| F03 | E01/E03；E05 仅服务层 | K2 换钥/fingerprint 不符 | 409 `DOMAIN_MISMATCH` | 0 | Z |
| F04 | E08/E09 | K3 缺失/非法 | **404**（未注册）；C2/C3 后必须 503 `NOT_CONFIGURED` | 0 | Z |
| F05 | 全部 | `live`/真实 Provider/设备连接请求 | 503 `NOT_CONFIGURED`；无网络/设备调用 | 0 | Z |
| F06 | E05/E07/E08/E09 | CloudStore 或非 Mock H4-b | E05 **404/405**（HTTP 未批准，Q4）；E07–E09 404（未注册） | 0 | Z |
| F07 | E04 | 文件存储后端与配置不一致 | 503 `STORAGE_UNAVAILABLE`，无字节 | 0 | Z |
| F08 | 全部 | Store/clock 抛错 | 503 `ADAPTER_UNAVAILABLE`，无部分写 | 0 | Z |
| F09 | 全部 | 未注册路径/错误方法 | 404 或 405，不进入业务 | 0 | Z |
| F10 | 全部 | 503 响应扫描 | 无密钥、无配置值、无异常 message | 0 | Z |
| F11 | 全部 | body 超限 | 413 `PARAM_ERROR`，不得落为 503 | 0 | Z |
| F12 | 全部 | 任一失败路径计数 Provider | Provider 增量为 0 | 0 | Z |
| F13 | E07 | 持 `device.operation.retry` 调用 `/retry` | 404/405；无 K2 记录、无 job 写、Provider 0 | 0 | Z |
| F14 | E08/E09 | 调用 `/reconcile`、`/finalize-retry` | 404/405；H4-c 未完成前不注册 | 0 | Z |
| F15 | 静态/运行时 | 候选路径出现在 `routes.mjs`/`server.mjs` | 静态断言：server 0 分支；运行时三路径 404/405；描述行不是注册依据（Q8） | 0 | Z |
| F16 | 全部 | 撤权后下一请求 | 403 `FORBIDDEN`（组织/成员失效同）；无缓存授权、无旧结果复用 | 0 | Z |
| F17 | E01/E03；E05 仅服务层 | operation key 缺失/损坏 | 缺失 400、损坏 409；零写；不新建、不回退旧结果 | 0 | Z |
| F18 | E08/E09 | H4-c 前置未齐 | **完全不注册**（404/405）；条件：C1 终审 + C2 + C3 + RC01–RC73 + 最小响应投影 + Provider 0 证据（Q6） | 0 | Z |
| F19 | 静态 | 候选路径出现在 server 注册表 | `server.mjs` 0 分支；`routes.mjs` 描述不得被当作运行时契约（Q8）；本轮两文件零差异 | 0 | Z |

### 8.9 未来契约测试：`UNKNOWN_RESULT` 人工收敛

| ID | 端点 | 前置/请求 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| U01 | 按 ID `queryJob` | `awaiting_result` 只读 | 设计层允许；HTTP 读取未注册（404/405）；零写 | 0 | Z |
| U02 | E07 | 对 `awaiting_result` retry | 404（未注册）；若注册必须 409 `INVALID_JOB`（H3 D53），且 Q3 前不得注册 | 0 | Z |
| U03 | E08 | `still_unknown`，无间隔/次数问题 | 404（未注册）；C2 后 200，状态不变、sequence+1 | 0 | Z |
| U04 | E08 | 60 秒内第二次 `still_unknown` | 404；C2 后 409 `RECONCILE_THROTTLED` | 0 | Z |
| U05 | E08 | 第 9 次 `still_unknown` | 404；C2 后 409 `RECONCILE_LIMIT` | 0 | Z |
| U06 | E08 | `confirmed_removed` 成功 | 404；C2 后唯一进入 `succeeded` 的 HTTP 路径 | 0 | Z |
| U07 | E08 | `confirmed_present` | 404；C2 后 `terminal_failed`，grant/slot/claim 不释放 | 0 | Z |
| U08 | E09 | 对 `awaiting_result` finalize-retry | 404；C3 后 409 `INVALID_STATE` | 0 | Z |
| U09 | 全部 | 503/unknown 后换新键自动重发 | 契约禁止；测试客户端只允许同键重放/按 ID 读取 | 0 | Z |
| U10 | 服务层 | 对 `awaiting_result` 直接调用 `h3b.requeue`/`h4b.requeue` | 409 `INVALID_JOB`；零写；不得推回 `queued` | 0 | Z |
| U11 | `queryJob`/E08 | `awaiting_result` 只允许只读查询与人工对账 | 只读按 ID `queryJob`（HTTP 未注册）；E08 候选（Q6 门禁）；Provider `queryOperation` 无入口、调用 0 | 0 | Z |
| U12 | 全部 | 202/409/503 响应头与定时器 | 无 `Retry-After`；无定时器/自动重试/回调重放推动 job | 0 | Z |
| U13 | E07 | 持 `device.operation.retry` 权限 | 权限存在不等于端点可用；仍 404，不激活未注册路由 | 0 | Z |
| U14 | 设计 | 未来 `retryable_failed` 独立任务（Q3） | 未实现：K2 method、Idempotency-Key、`requestDigest`、operation domain、`expectedJobRevision`、lease、attempts、nextAttemptAt、同键重放、异摘要冲突均未冻结 | 0 | Z |
| U15 | E07/服务层 | `requeue` 无完整 K2 | E07 **不注册**（404/405）；不得以 `requeue` 冒充 retry；K2/digest/domain/严格重放独立任务完成前零注册（Q3） | 0 | Z |
| U16 | UI/服务层 | `UNKNOWN_RESULT`/`awaiting_result` | 不显示普通重试、不发 retry 请求；普通 `requeue` 409 `INVALID_JOB`；仅按 ID 只读与人工对账（E08 候选）（Q3） | 0 | Z |

### 8.10 当前静态验收（只读代码/文档，不启动服务）

| ID | 检查对象 | 静态预期 | 证据位置 |
|---|---|---|---|
| S01 | `publicJobResult` | 精确五字段；无 `revision/action/cleanupPhase/nextAttemptAt` | [dto.mjs](../../admin-web/lib/face-service/dto.mjs#L254-L263) |
| S02 | `queryJob`/`revoke` | `queryJob` 只收 jobId、需 `device.audit.read`、无 `listJobs`；`revoke(grantId,{idempotencyKey})` 无 body | [service.mjs](../../admin-web/lib/face-service/service.mjs#L652-L736) |
| S03 | `h3b.requeue` | 无 op key/`requestDigest`/domain；`expectedRevision` 必填 | [h3b.mjs](../../admin-web/lib/face-service/h3b.mjs#L444-L487) |
| S04 | `h4b.requeue` | 无 op key/digest/domain；`expectedRevision` 仅在 `actor` 非空时校验 | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L482-L519) |
| S05 | K2 已实现集合 | 仅 `face.submit`/`face.review`/`face.grant`/`face.revoke`；无 `face.operation.retry`/`face.reconcile` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L117-L151)、[service.mjs](../../admin-web/lib/face-service/service.mjs#L199-L727) |
| S06 | `review` 的 revision | 服务层 `expectedRevision` 可选；HTTP 字段名必须为 `expectedCredentialRevision` 且必填（Q2） | [service.mjs](../../admin-web/lib/face-service/service.mjs#L291-L293)、§3.5 |
| S07 | `routes.mjs` | 8 条描述；E08 在表内但 server 未注册；E09 不在表内 | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L6-L62) |
| S08 | `server.mjs` | 无三路径分支；人脸相关只有 `files/:id/face-review` | [server.mjs](../../admin-web/server.mjs#L434-L438)、[server.mjs](../../admin-web/server.mjs#L665-L684) |
| S09 | 权限目录 | 7 个 `device.*`；无新增；admin 不隐含 | [org.mjs](../../admin-web/lib/org.mjs#L89-L105) |
| S10 | H4-c 阶段 | 设计 `b15aceb` 已批准（`ed7b66f`）；C1 `5dff386` 待独立终审；C2 仅 `42f8970` 文档；C2/C3 未开始 | H4-c 设计、C1 证据包、C2 preflight |
| S11 | C1 代码边界 | `h4c-evidence.mjs` 只有 evidence/head/domain 只读 helper；无 `reconcile`/`finalize` 服务入口；无 K3 初始化 | C1 `5dff386` |
| S12 | 九端点登记 | 0 注册；`http-ready` blocked 9/9；状态仅四值 | §0.2、§4.1 |
| S13 | revision 权威 | credential revision（E02 投影）与 grant revision（事务内）；job revision 仅有 Q1 目标 DTO（未实现），唯一权威入口是按 ID `queryJob`；列表行不是权威 | [dto.mjs](../../admin-web/lib/face-service/dto.mjs#L235-L263)、[service.mjs](../../admin-web/lib/face-service/service.mjs#L731-L736)、§3.5 |
| S14 | UI 契约 | 依赖 job revision 的 mutation 前必须按 ID 重查 `queryJob`；无合法 revision → 按钮隐藏/禁用、零请求（Q7） | §3.7、S19–S20 |
| S15 | 状态词 | 无 `ready`/`partial`/`已就绪`/`开放` 作为状态值；未实现项只用 `proposed`/`blocked` | §0.2、§3.9 |
| S16 | 敏感/隐私静态扫描 | 示例中无 `requestDigest` 原值、原始 Idempotency-Key、evidence digest/head、PII | 附录 B |
| S17 | 三项缺口 | G-01/G-02/G-03 各有事实、Codex 裁定写回、关闭、验收行，且无“已实现”宣称 | §0.1 |
| S18 | 变更范围 | 仅本 Markdown；`server.mjs`/`routes.mjs`/服务层/测试零差异；单提交；工作区干净 | `git diff --stat`、`git status` |
| S19 | UI revision 来源（Q7） | 依赖 job revision 的 mutation 前必须重查 `queryJob`；禁止列表行号、本地自增、旧 mutation 响应、缓存旧 revision | §3.7、Q7 |
| S20 | UI 无 revision 行为（Q1/Q7） | 无合法 revision → 按钮隐藏/禁用；相关 `/retry`、`/reconcile`、`/finalize-retry` 网络请求为 0；无探测请求 | V16、§3.7 |
| S21 | `routes.mjs` 处置（Q8） | 候选仅为设计文档；本轮 `routes.mjs` 零差异；E07/E08 描述行清理列为未来独立小提交；E09 不入表 | §4.4、Q8 |

### 8.11 数量与连续性

| 系列 | 编号范围 | 条数 | 阶段 |
|---|---|---:|---|
| N | N01–N15 | 15 | 未来契约测试 |
| R | R01–R14 | 14 | 未来契约测试 |
| C | C01–C13 | 13 | 未来契约测试 |
| D | D01–D29 | 29 | 未来契约测试 |
| P | P01–P09 | 9 | 未来契约测试 |
| V | V01–V16 | 16 | 未来契约测试 |
| F | F01–F19 | 19 | 未来契约测试 |
| U | U01–U16 | 16 | 未来契约测试 |
| S | S01–S21 | 21 | 当前静态验收 |
| **合计** | — | **152** | — |

- 上一稿 138 条；本轮按 Q1–Q8 裁定追加 **14 条**：D23–D29（7）、F18–F19（2）、U15–U16（2）、S19–S21（3）。
- 同时把与裁定冲突的期望改为未注册 `404/405`：E05 的 N07、R05、C03、P01–P03、D06、D19；E06 的 N08、N13、D13、D14、P07、U01。D29 为新增行，不在此列。
- 每个系列编号连续、无重复；全表 152 个 ID 唯一。新增行的端点状态与 §0.2、§4.1 一致：9 个 HTTP 全部 blocked。

## 9. 追溯矩阵

| 契约项 | 冻结/事实值 | 来源 |
|---|---|---|
| E01 路径/权限 | `POST /api/v2/face-credentials` + `device.face.submit` | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L7-L13)、[org.mjs](../../admin-web/lib/org.mjs#L97) |
| E01 DTO | `{personId,sourceFileId}` → `{credentialId,reviewState}` | [dto.mjs](../../admin-web/lib/face-service/dto.mjs#L112-L120)、[service.mjs](../../admin-web/lib/face-service/service.mjs#L199-L255) |
| E02 路径/权限 | `GET .../review-queue` + `device.face.review` | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L14-L20)、[org.mjs](../../admin-web/lib/org.mjs#L98) |
| E02 DTO | `publicReviewItem[]`，含 credential `revision` | [dto.mjs](../../admin-web/lib/face-service/dto.mjs#L235-L251) |
| E03 路径/权限 | `POST .../:credentialId/review` + `device.face.review` | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L21-L27) |
| E03 DTO | `{decision,expectedCredentialRevision}` → `{credentialId,reviewState}`；服务层字段名为 `expectedRevision` 且可选，HTTP 必填 | [service.mjs](../../admin-web/lib/face-service/service.mjs#L258-L313)、H1 终审、Q2 |
| E04 路径/权限 | `GET .../:credentialId/image` + `device.face.readPrivate` | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L28-L33)、[org.mjs](../../admin-web/lib/org.mjs#L99) |
| E04 私密读取 | 代理字节、404 同态、无 URL | [files.mjs](../../admin-web/lib/files.mjs#L1049-L1094) |
| E05 路径/权限 | `POST .../:grantId/revoke` + `device.access.manage`；HTTP blocked | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L34-L40)、[org.mjs](../../admin-web/lib/org.mjs#L101)、Q4 |
| E05 服务层 DTO | 无请求体 → `{grantId,jobId,grantState,cleanupPending,evidenceScope}`；digest 仅 `{grantId}`；**不构成 HTTP 契约** | [service.mjs](../../admin-web/lib/face-service/service.mjs#L652-L728)、Q4/Q5 |
| E06 路径/权限 | `GET /api/v2/device-operation-jobs` + `device.audit.read`；HTTP blocked | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L41-L46)、[org.mjs](../../admin-web/lib/org.mjs#L102) |
| E06 DTO | 当前 `publicJobResult` 五字段、无 revision；Q1 目标六字段未实现 | [dto.mjs](../../admin-web/lib/face-service/dto.mjs#L254-L263)、§3.5 |
| E06 缺口 | 无 `listJobs()`，只有 `queryJob(jobId)`；列表契约不冻结 | [service.mjs](../../admin-web/lib/face-service/service.mjs#L731-L736)、Q1/Q7 |
| E07 现状 | 仅 `requeue`，无 K2/digest/domain/严格重放；Q3 禁止复用 | [h3b.mjs](../../admin-web/lib/face-service/h3b.mjs#L444-L487)、[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L482-L519) |
| E07 候选命名 | K2 method 名称/摘要/域由 Q3 独立任务冻结；未实现 | §1.4、§3.2、Q3 |
| E08 现状 | 仅 H4-c 设计；`routes.mjs` 描述行存在，server 未注册 | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L54-L59)、[H4-c 设计](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L539-L614) |
| E09 现状 | 仅 H4-c §13.2 提案；不在 `routes.mjs` | [H4-c 设计](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L598-L614) |
| K2 格式/作用域 | 16–128、HMAC、org+method+actor、原始键不落库 | [dto.mjs](../../admin-web/lib/face-service/dto.mjs#L59-L91)、[collections.mjs](../../admin-web/lib/face-service/collections.mjs#L199-L254) |
| K2 domain 错误 | `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH` | [collections.mjs](../../admin-web/lib/face-service/collections.mjs#L257-L300) |
| 安全整数 | `assertSafeInt`；revision 必须 1..`MAX_SAFE_INTEGER` | [collections.mjs](../../admin-web/lib/face-service/collections.mjs#L415) |
| 404 同态 | 跨组织/不存在统一 404 | [org.mjs](../../admin-web/lib/org.mjs#L160-L178)、[service.mjs](../../admin-web/lib/face-service/service.mjs#L112-L115) |
| 409 revision | review/revoke 映射 | H1 终审、[service.mjs](../../admin-web/lib/face-service/service.mjs#L688-L690) |
| 503 配置 | K2/K3/Provider/Store | H4-c 设计 §11、[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L51-L61) |
| UNKNOWN 人工 | 只查/只对账，不自动重试、不普通 requeue | H3 [D53](HK-AI-04-H3-LEASE-DISPATCH-DESIGN.md#L77-L101)、H4-c §1、§6 |
| H4-c 阶段 | 设计已批准；C1 待终审；C2/C3 未开始 | [H4-c 设计](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L1-L60)、C1 证据包、C2 preflight |

## 10. Codex 裁定（Q1–Q8，2026-11-14）

> **裁定日期：2026-11-14。** 本节是 Q1–Q8 的唯一有效写回；上一稿的“本卡建议 / 待裁定 / 未裁定”表述全部作废。
>
> **裁定效力**：只关闭设计争议，**不批准 HTTP 编码**；不改变九端点 blocked 状态（§4.1）；不解除 H4-c 阶段门禁；不授权 Provider/设备/生产云。

| 编号 | 问题 | Codex 裁定（2026-11-14） | 依据 | 关闭后果 |
|---|---|---|---|---|
| Q1 | `queryJob`/`publicJobResult` 是否返回 `revision`，最小 DTO 是什么 | **2026-11-14 裁定**：最小公开 DTO 固定为 `jobId/state/revision/attempts/lastSuccessAt/failureReason`。`revision` 必须为**正安全整数**，且只来自**服务端当前 job 记录**；缺失或非法**失败关闭**；不得返回 `lease`、`requestDigest`、operation key、原始错误、设备或隐私字段。E06 未实现，继续 blocked | `publicJobResult` 现仅五字段（[dto.mjs](../../admin-web/lib/face-service/dto.mjs#L254-L263)）；`queryJob` 只按 jobId 读（[service.mjs](../../admin-web/lib/face-service/service.mjs#L731-L736)）；无 `listJobs()`（§1.1）；Q7 指定 `queryJob` 为唯一权威入口 | §3.5、附录 A 改写；E06 契约记 `proposed / blocked`；旧“E06 列表加字段”提案作废；不新增详情路由 |
| Q2 | 各 mutation 用哪个 revision 字段 | **2026-11-14 裁定**：**Submit** 只用 `Idempotency-Key`，不用 `expectedRevision`；**Review / CreateGrant** 用 `expectedCredentialRevision`；**Revoke（未来）** 用 `expectedGrantRevision`；**requeue/retry（未来）** 用 `expectedJobRevision`；**Reconcile** 用 `expectedRevision`（指 job revision）；**Finalize-retry** 用 `expectedRevision`，并同时作为恢复 generation 基准；**所有读取**不用 `expectedRevision` | `review` 服务层现名 `expectedRevision`（[service.mjs](../../admin-web/lib/face-service/service.mjs#L258-L313)）；`createGrant` 已用 `expectedCredentialRevision`（[dto.mjs](../../admin-web/lib/face-service/dto.mjs#L105-L108)）；`revoke` 无 body、事务内 CAS（[service.mjs](../../admin-web/lib/face-service/service.mjs#L652-L728)）；requeue 无 K2（§1.3）；H4-c §13.2 以 job revision 作 generation 基准 | E03 字段改名并必填；E05/E07/E08/E09 契约不因命名而解禁；读取端点禁止携带 revision |
| Q3 | E07 是否复用 requeue、如何冻结 | **2026-11-14 裁定**：E07 为 **blocked/proposed**；**不复用不完整 requeue**；未来独立任务冻结 K2 method、Idempotency-Key、`requestDigest`、operation domain、`expectedJobRevision`、`nextAttemptAt`、`attempts`、lease 状态、严格重放、`retryable_failed` 前置。`awaiting_result`/`UNKNOWN_RESULT` 禁止普通 requeue 和自动重试 | `h3b.requeue`/`h4b.requeue` 无 op key/digest/domain/严格重放（[h3b.mjs](../../admin-web/lib/face-service/h3b.mjs#L444-L487)、[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L482-L519)）；`face.operation.retry` 不在已实现 K2 集合（§1.4）；H3 D53 禁止 `awaiting_result` retry | §3.2 成为独立任务清单；E07 不注册；U10、U15、U16 固化 |
| Q4 | E05 是否接收请求体与 `reasonCode` | **2026-11-14 裁定：无请求体仅内部服务实现事实，不批准 HTTP。** E05 HTTP **blocked**。未来 mutation 至少 `expectedGrantRevision`；正式枚举及审计契约冻结前**不得接收 `reasonCode`** | `revoke(grantId,{idempotencyKey})` 无 body（[service.mjs](../../admin-web/lib/face-service/service.mjs#L652-L728)）；H4-a/H4-b 无 `reasonCode` 入参、枚举、持久化或审计字段（§1.1、§3.6） | E05 契约由 implemented 降 **blocked**；bodyless 不再称“冻结”；D06、D19、N15、P01–P03 改口径 |
| Q5 | `reasonCode` 与撤权 HTTP 契约在哪个阶段冻结 | **2026-11-14 裁定**：HTTP 接线前必须完成独立 **“撤权服务与 HTTP 契约加固”**，定义 `reasonCode` 枚举、长度及字符、持久化位置、审计字段、响应投影、敏感信息禁入、历史兼容 | 当前 `reasonCode` 无任何实现（§3.6）；Q4 已关闭当前接收 | 新增前置任务；加固完成前 E05 不注册、不编码 |
| Q6 | H4-c 完成前 E08/E09 是否注册 | **2026-11-14 裁定**：E08 reconcile / E09 finalize-retry **完全不注册**，直到：C1 Codex 终审、C2、C3、RC01–RC73、H4-c 最小响应投影、**Provider 调用 0 证据**全部具备 | C1 `5dff386` 待终审；C2/C3 未开始；C2 preflight `42f8970` 自述未开始；`routes.mjs` 仅 E08 描述行（§1.5、§1.7） | §3.3、§3.4、§4.1、F18 固化；任何提前注册即违反本卡 |
| Q7 | UI 的 job revision 唯一权威入口与使用规则 | **2026-11-14 裁定**：唯一权威入口是**按 ID 的 `queryJob`**。UI 在依赖 job revision 的 mutation 前**必须重查**；禁止列表行号、本地自增、旧 mutation 响应推测、缓存旧 revision；无合法 revision **隐藏/禁用按钮并禁止请求** | `queryJob(jobId)` 是唯一 job 读取（[service.mjs](../../admin-web/lib/face-service/service.mjs#L731-L736)）；`publicJobResult` 无 revision（§1.2）；无 `listJobs()`（§1.1） | §3.7 改写；S19/S20、D20、V16 固化；`queryJob` HTTP 读取未获批准前 UI 无合法来源 |
| Q8 | 候选路由是否保留在 `routes.mjs` 描述表 | **2026-11-14 裁定**：**候选仅设计文档**；`routes.mjs` 只允许**已冻结且批准进入实现阶段**的描述；proposal 不得暴露为运行时契约；现有候选描述由**未来独立小提交**清理；**本轮不修改 `routes.mjs`** | `routes.mjs` 是描述表，`matchFaceRoute` 无 server 调用方（§1.5）；E08 描述行存在、E09 不在；server 未注册（§1.5） | §4.4 只保留裁定；A/B/C 三方案作废；本卡 `routes.mjs` 零差异；清理任务单列 |

### 10.1 裁定后的未完成项（全部 blocked/proposed，不得当作已批准）

| 未完成项 | 状态 | 阻塞条件 |
|---|---|---|
| 九个端点的 HTTP 注册与编码 | blocked 9/9 | 每端点独立编码卡；E05 另需 Q5 加固，E07 另需 Q3 任务，E08/E09 另需 Q6 条件 |
| `queryJob` 最小 DTO（含 `revision`）实现 | blocked | Q1 已裁定、服务层未实现；`publicJobResult` 仍五字段 |
| `queryJob` 的 HTTP 读取路径 | blocked | 未获批准；本卡不新增路由（Q1/Q7） |
| “撤权服务与 HTTP 契约加固” | blocked | Q5；未开始，`reasonCode` 等均未定义 |
| `retryable_failed` 独立重试任务 | blocked | Q3；K2/摘要/域/lease/重放均未实现 |
| H4-c C1 终审、C2、C3、RC01–RC73 | blocked | Q6；C1 仅自述待复审，C2/C3 未开始 |
| `routes.mjs` 候选描述清理 | blocked | Q8；未来独立小提交，本轮零修改 |

## 附录 A：`queryJob` 最小公开 DTO（Q1 已裁定，未实现）

目标投影（六字段，顺序不构成契约）：

```json
{
  "jobId": "job-...",
  "state": "retryable_failed",
  "revision": 4,
  "attempts": 1,
  "lastSuccessAt": null,
  "failureReason": null
}
```

| 字段 | 类型 | 来源 | 字段权限 | 缺失/跨组织 |
|---|---|---|---|---|
| `jobId` | string | `job.jobId \|\| job._id` | `device.audit.read` | 跨组织/不存在 404 同态 |
| `state` | string | `job.state` | `device.audit.read` | 同上 |
| `revision` | 正安全整数 | **仅服务端当前 job 记录**的 `job.revision` | `device.audit.read` | 记录缺失/非法 → `INVALID_JOB/409` 失败关闭 |
| `attempts` | number | `job.attempts ?? 0` | `device.audit.read` | 同上 |
| `lastSuccessAt` | number 或 null | `job.lastSuccessAt ?? null` | `device.audit.read` | 同上 |
| `failureReason` | string 或 null | `job.failureReason`，截断 120 字符 | `device.audit.read` | 同上 |

约束：

1. `revision` 只来自服务端当前 job 记录；禁止缓存、列表行号、数组下标、本地自增、旧 mutation 响应、时间戳、digest 前缀。
2. 必须 `Number.isSafeInteger(revision) && revision >= 1`；`0`、负数、小数、字符串、`NaN`、`Infinity`、`2^53` 及以上 → 失败关闭（服务端记录侧 `INVALID_JOB/409`；客户端输入侧 `PARAM_ERROR/400`）。
3. 不得返回 `lease`（`leaseGeneration`/`leaseOwner`/`leaseExpiresAt`）、`requestDigest`、operation key、原始错误或 `stack`、设备字段、人员/图片/objectKey 等隐私字段。
4. 只读投影；不新增集合、不新增状态/权限、不改变既有 `publicJobResult` 调用方；本卡不实现。
5. 不新增 HTTP 路由；`queryJob` 的 HTTP 暴露须独立编码卡批准，列表行不得替代。
6. 未实现前 E06/E07/E08/E09 继续 blocked；UI 无合法 revision → 隐藏/禁用按钮、零请求。

## 附录 B：交付验证命令

```text
git diff --check                     # 含提交差异
git show --stat --oneline HEAD       # 仅一份 Markdown
git log --oneline -3                 # 255c380 后单提交，befc2d3 保留
git diff --stat 255c380..HEAD        # 仅本文件
git status --porcelain               # 工作区干净
git ls-remote origin docs/hk-face-http-wiring-design   # 远端 SHA 核验
# 相对链接：解析文档中所有非 http(s) 链接，确认文件存在、行号在文件范围内
# 敏感扫描：云厂商密钥、私钥块、口令/密钥/令牌赋值、32 字节 Base64、64 位 hex、手机号、身份证号
# 矩阵连续性：N01–N15、R01–R14、C01–C13、D01–D29、P01–P09、V01–V16、F01–F19、U01–U16、S01–S21，共 152 条
# 状态断言：九端点 HTTP 全部 blocked；Q1–Q8 全部标注“2026-11-14”与依据
# 静态断言：server.mjs 无三路径分支；routes.mjs 与 255c380 零差异；K2 集合无 retry/reconcile
```

本卡只做静态验证：不启动 server、不发 HTTP、不跑 Provider/设备/Cloud、不执行任何业务写。验证结果记录在提交说明与最终回报中。

## 附录 C：本卡不做的事

- 不修改 `server.mjs`，不注册、不调用任何业务 HTTP。
- 不修改 `service.mjs`、`h4b.mjs`、`h3b.mjs`、`files.mjs`、`collections.mjs`、`store.mjs`、`routes.mjs` 或测试。
- 不实现 retry、reconcile、finalize-retry；不开始 H4-c C2/C3；不修改 C1。
- 不实现 `queryJob` 的 `revision` 扩展，也不新增任何 job 读取路由。
- 不接真实 Provider、不连接设备、不创建 Cloud 资源、不合并 `main`。
- 不新增权限名、状态名、decision、`evidenceScope`、错误码。
- 不把 Codex 裁定（Q1–Q8）当作 HTTP 上线批准；九个端点继续关闭，注册必须另发编码卡。
