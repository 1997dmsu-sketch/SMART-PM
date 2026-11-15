# HK-AI-07C 撤权服务与 HTTP 契约加固（E05 未来契约 · 待 Codex 裁定）

> **状态：纯文档设计，待 Codex 裁定；E05 HTTP 继续 blocked。** 本卡只冻结“将来接线必须满足什么”，不批准编码、不注册路由、不调用应用 HTTP、不接 Provider/设备、不开始 H4-c C2/C3、不合并 `main`。
>
> **本卡只写这一份 Markdown。** 服务层、测试、`server.mjs`、`routes.mjs`、`store.mjs`、`collections.mjs`、`h4b.mjs`、`h4c-evidence.mjs` 全部零差异；工作区除本文件外不得有本卡产生的改动。用户已有的未跟踪文件与改动一律保留。
>
> **裁定效力边界：** 本卡的建议（Q1–Q8）在 Codex 明确写回“裁定”前都只是建议；即使全部采纳，也只关闭设计争议，不解除 E05 的 blocked 状态。服务实现、数据迁移、权威查询、故障/并发测试、HTTP 注册、UI 接线都必须另发编码卡并逐项通过门槛（§13）。

- 服务与测试基线：`feat/hk-face-h4c-reconciliation` @ `90e4189717e21a5d458b09da34677ef29795c767`。本卡只读核对；撤权相关文件与 `2f597e33` 零差异（§1.2 已列命令与结果）。
- HTTP 契约终审：[HK-AI-07A 门禁 HTTP 接线契约 @ 2f597e33](https://github.com/1997dmsu-sketch/SMART-PM/blob/2f597e33acb3563d92cafd2d70ac238a27d796dc/docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md)，分支 `docs/hk-face-http-wiring-design`。
- H4-b 终审代码：[1155b7ba65991d324fb8b22bb8f7dd87f49428f9](https://github.com/1997dmsu-sketch/SMART-PM/commit/1155b7ba65991d324fb8b22bb8f7dd87f49428f9)，分支 `feat/hk-face-h4b-mock-cleanup`。
- H4-c 设计：[HK-AI-04 H4-c 对账契约 @ b15acebe](https://github.com/1997dmsu-sketch/SMART-PM/blob/b15acebe0a8049f316797bbbd2692c55de25d111/docs/tasks/HK-AI-04-H4C-RECONCILIATION-DESIGN.md)，分支 `docs/hk-face-h4c-reconciliation-design`。
- 本轮分支：`docs/hk-face-revoke-contract-hardening`，从 `2f597e33` 切出，**唯一变更文件**为本文件；不 amend、不 rebase、不 squash、不 force push。
- 现有 E05 路由描述：[routes.mjs](../../admin-web/lib/face-service/routes.mjs#L34-L40)。
- 现有 revoke 服务：[service.mjs](../../admin-web/lib/face-service/service.mjs#L652-L728)。
- 现有 revoke 测试：[face-service-layer.test.mjs](../../admin-web/tests/face-service-layer.test.mjs#L346-L396)、[face-h4b.test.mjs](../../admin-web/tests/face-h4b.test.mjs#L97-L113)。
- 现有 H4-b 清理器：[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L84-L120)、[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L454-L548)。
- 现有 H4-c 设计：[H4-c §6.1](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L255-L281)、[H4-c §7](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L382-L412)、[H4-c §13](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L539-L596)。

## 0. 结论与边界

### 0.1 一句话结论

E05 的旧事实是“无请求体的服务层撤权”；本卡把它加固为“有严格请求体、权威 grant revision、固定 reasonCode 枚举、独立 K2 摘要、确定性审计、最小响应投影、明确状态机与并发线性化点”的未来契约。**契约文本冻结为候选，端点在 Codex 明确解锁与全部门槛通过前继续 blocked。**

### 0.2 本卡冻结什么、不冻结什么

| 维度 | 本卡处理 | 状态 | 不宣称 |
|---|---|---|---|
| 请求 DTO | 冻结 `{grantId, expectedGrantRevision, reasonCode}` 三字段、路径/正文一致性、未知字段拒绝、`Idempotency-Key` 仅请求头 | 候选冻结，待裁定 | 不宣称已可接收请求 |
| grant revision 权威 | 冻结“只来自权威同组织 grant 查询 DTO”的规则；Q3 提出查询 DTO 与未来读取路径 | proposed / blocked | 不宣称查询端点已存在或已批准 |
| reasonCode | 冻结五值最小业务枚举、权限、审计用途、隐私禁入、历史兼容 | 候选冻结，待裁定 | 不宣称服务已接收、持久化或投影 |
| K2 | 冻结方法 `face.revoke`、精确摘要三字段、同键同摘要重放、异摘要 `CONFLICT`、严格 result 投影、原始 key 不落库 | 候选冻结，待裁定 | 不宣称旧 operation key 可重放 |
| 状态机 | 冻结允许状态、已 `revoked` 同/不同键、`cleanupPending`、cleanup job 同事务创建、Provider/派发后续阶段、`UNKNOWN_RESULT` 禁止自动重试 | 候选冻结，待裁定 | 不宣称 H4-c C2/C3 已开始 |
| 审计 | 冻结 actor、reasonCode、grant/job 指针、时间、revision、审计 ID 重放语义、隐私禁入 | 候选冻结，待裁定 | 不宣称 Store 当前可承载这些字段 |
| 响应 | 冻结五字段最小 DTO、operation/result 指针落点、禁止内部字段 | 候选冻结，待裁定 | 不宣称 HTTP 已批准成功码 |
| 错误 | 冻结错误矩阵、优先级、零副作用、无 500/stack | 候选冻结，待裁定 | 不宣称 E05 已注册 |
| 测试 | 设计 75 条未来契约测试（超过 40 条最低要求） | 设计，未执行 | 不宣称当前通过 |
| 接线 | 冻结服务、迁移、查询、测试、Codex 解锁门槛 | blocked | 不宣称可编码、可注册、可上线 |

### 0.3 九端点中的位置

07A 的九个端点在本卡合并后仍然 **HTTP blocked 9/9**；本卡只处理 E05 的设计前置。E01–E04、E06–E09 的状态不变；E08/E09 仍受 H4-c C1 终审、C2、C3、RC01–RC73、最小响应投影、Provider 0 证据约束（[07A §4.1](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L808-L822)、[07A Q6](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L1258-L1258)、[H4-c §16](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L736-L741)）。

| 端点 | 本卡后登记状态 | 原因 |
|---|---|---|
| E05 revoke | **blocked** | 本卡只冻结候选契约；服务改造、迁移、权威查询、测试、编码卡、Codex 解锁均未完成 |
| 其余八端点 | 不变 | 不在本卡范围；E08/E09 继续按 Q6 关闭 |

### 0.4 本卡明确不宣称

- 不宣称 E05 已可编码、已可注册、已可调用、已可上线。
- 不宣称 bodyless 是最终 HTTP 契约；它只是旧服务层事实。
- 不宣称 `reasonCode` 已实现；本卡只冻结候选枚举与审计规则。
- 不宣称已有权威 grant revision 读取；Q3 只是设计建议。
- 不宣称 H4-c C1 已终审、C2/C3 已开始或 E08/E09 可注册。
- 不宣称旧 operation key、旧审计、旧 grant 可以自动迁移或自动补写。
- 不宣称 `device.access.manage` 可由角色隐含；仍只从成员 `permissions` 显式读取。

## 1. 只读核对：基线事实

本节只记录“现在是什么”，不据此推断契约。所有行号均可在所列文件复核；所有相对链接在 `2f597e33` 树内可解析。

### 1.1 07A 对 E05 的关闭状态

07A 在 2026-11-14 已把 E05 的旧 bodyless 说法降级为“仅服务层事实”，并明确：

| 07A 位置 | 冻结内容 | 对 07C 的约束 |
|---|---|---|
| [E05 节](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L574-L628) | E05 HTTP blocked；bodyless 不批准 HTTP；未来 mutation 至少 `expectedGrantRevision`；`reasonCode` 未冻结前不得接收 | 07C 只能设计，不得注册 |
| [Q4](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L1256-L1256) | 无请求体仅内部服务事实；E05 HTTP blocked；未来至少 `expectedGrantRevision` | 本卡不把 bodyless 写成契约 |
| [Q5](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L1257-L1257) | HTTP 接线前必须完成独立“撤权服务与 HTTP 契约加固”，冻结枚举、长度字符、持久化位置、审计、响应、敏感禁入、历史兼容 | 本卡即该前置的设计稿；完成不等于批准 |
| [§3.6](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L745-L766) | 旧 H4 草案 `{expectedRevision, reasonCode}` 不采用；服务层 digest 仅 `{grantId}`；无权威 grant revision 读取；`expectedRevision` 改名 `expectedGrantRevision` | 本卡必须补权威读取与摘要 |
| [§2.6](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L354-L372)、[§2.7](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L374-L389) | K2 格式、作用域、同键同摘要/异摘要、原始 key 不落库；E05 digest `{grantId}`、result 五字段 | 本卡改摘要与 result，必须列冲突 |
| [§2.5](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L315-L352) | 错误码总表；`PARAM_ERROR/400`、`REVISION_CONFLICT/409`、`INVALID_STATE/409`、`CONFLICT/409`、`NOT_CONFIGURED/503` 等 | 本卡不得新增同义码 |
| [§4.1](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L808-L822)、[§4.3](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L840-L849) | 九端点全关闭；注册必须另发编码卡并逐项引用端点 ID | 本卡不注册 |

结论：**07A 已经为 07C 留出“设计前置”的位置，但没有给 E05 任何 HTTP 编码批准。** 本卡必须同时做到“把契约写清楚”和“继续关闭”。

### 1.2 当前 revoke 服务事实

入口与权限：

| 项目 | 当前事实 | 证据 |
|---|---|---|
| 签名 | `revoke(grantId, { idempotencyKey } = {})`，无请求体 | [service.mjs](../../admin-web/lib/face-service/service.mjs#L652-L652) |
| 权限 | 外层 `#require("device.access.manage")`；事务内再次复核组织、成员、权限 | [service.mjs](../../admin-web/lib/face-service/service.mjs#L653-L653)、[service.mjs](../../admin-web/lib/face-service/service.mjs#L681-L681) |
| 路径参数 | `grantId` 只做 `assertBoundedId`；不接受 body | [service.mjs](../../admin-web/lib/face-service/service.mjs#L654-L654) |
| K2 method | `face.revoke` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L655-L655) |
| requestDigest | `SHA-256(stable({grantId}))`，只含 `grantId` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L656-L656) |
| K2 result | `{grantId, jobId, grantState, cleanupPending, evidenceScope}` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L660-L660) |
| job ID | `job-revoke-v1:<digest([orgId, grantId])>` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L657-L657) |
| 审计 | 确定性 `audit-h4-v1:<digest([orgId, jobId, "queue", 1])>`；Store 自动写 action/target/createdAt | [service.mjs](../../admin-web/lib/face-service/service.mjs#L659-L659)、[service.mjs](../../admin-web/lib/face-service/service.mjs#L726-L726) |
| 事务写集 | grant `revoked/cleanupPending=true/cleanupJobId`、job `queued`、log、op key、op domain 0–2、audit | [service.mjs](../../admin-web/lib/face-service/service.mjs#L713-L726) |
| Provider | 0；只创建清理 job，不派发、不连设备 | [service.mjs](../../admin-web/lib/face-service/service.mjs#L717-L717)、[service.mjs](../../admin-web/lib/face-service/service.mjs#L651-L651) |
| 返回 | 直接返回 K2 result，不额外投影 | [service.mjs](../../admin-web/lib/face-service/service.mjs#L727-L727) |

事务内检查顺序与缺口：

| 顺序 | 当前检查 | 证据 | 与 07C 的关系 |
|---:|---|---|---|
| 1 | 组织 active、成员 active、权限 `device.access.manage` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L681-L681) | 保留；组织/成员不存在需按 07A 区分 404/403（§1.7 BC-18） |
| 2 | K2 domain 写入计算、op key 重放 | [service.mjs](../../admin-web/lib/face-service/service.mjs#L682-L684) | 保留；结果形状要换（BC-01/BC-04） |
| 3 | grant 存在且同组织，否则 404 | [service.mjs](../../admin-web/lib/face-service/service.mjs#L685-L686) | 保留；跨组织同态 404 |
| 4 | 状态属于 `pending/effective/suspended/expired`，否则 `INVALID_STATE/409` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L687-L687) | **顺序要改**：Q2 要求先 revision 再 state（BC-03） |
| 5 | `current.revision !== 预读 grant.revision` 或绑定字段变化，否则 `REVISION_CONFLICT/409` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L688-L688) | 旧 CAS 基准是预读值，不是客户端 `expectedGrantRevision`（BC-02） |
| 6 | grant revision 是 `≥1` 安全整数、未溢出 | [service.mjs](../../admin-web/lib/face-service/service.mjs#L689-L690) | 保留；非法 revision 失败关闭（Q7） |
| 7 | credential/device/claim/slot/guard 存在、结构、绑定一致 | [service.mjs](../../admin-web/lib/face-service/service.mjs#L691-L711) | 保留；任何缺失/损坏 `CLEANUP_SNAPSHOT_REQUIRED/409` |
| 8 | job/log 确定性 ID 未被占用 | [service.mjs](../../admin-web/lib/face-service/service.mjs#L712-L712) | 保留；占用 `CONFLICT/409` |
| 9 | 时钟、cleanupSnapshot、grant/job 写入 | [service.mjs](../../admin-web/lib/face-service/service.mjs#L713-L725) | 保留；新增 grant revision/审计字段 |
| 10 | 审计 action `撤销门禁授权`，actor 来自会话 | [service.mjs](../../admin-web/lib/face-service/service.mjs#L726-L726) | 保留 action；新增 reasonCode 等（BC-06） |

关键事实：

- 当前服务**没有** `expectedGrantRevision` 入参，也**没有** `reasonCode` 入参、枚举、持久化或审计字段；`reasonCode` 只作为 job `result` 的服务端执行原因出现于 H3/H4/H4-c。
- 当前服务**没有** grant 查询方法/HTTP 读取；`queryJob` 是 job 读取且需 `device.audit.read`（[service.mjs](../../admin-web/lib/face-service/service.mjs#L731-L736)）。
- 当前服务**总是**创建 `executionMode:"test"`、`provider:"mock"`、`evidenceScope:"simulated"` 的 job，即使运行环境是 live/cloud；H4-b 构造器才在派发侧拒绝非 LocalStore/Mock（[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L188-L191)）。这是 07C 必须在撤权服务侧补的失败关闭（BC-09）。
- grant 记录没有字段白名单；`validateRecord` 只校验 orgId/revision 与 state 枚举（[collections.mjs](../../admin-web/lib/face-service/collections.mjs#L68-L99)）。未知字段、缺失 `cleanupPending/cleanupJobId` 的历史记录需要失败关闭策略（Q7）。

基线核对命令与结果（只读）：

```text
git -C SMART-PM diff --stat 2f597e3 90e4189 -- \
  admin-web/lib/face-service/service.mjs \
  admin-web/lib/face-service/h4b.mjs \
  admin-web/lib/face-service/dto.mjs \
  admin-web/tests/face-service-layer.test.mjs \
  admin-web/tests/face-h4b.test.mjs
# 输出为空：撤权相关文件在 2f597e3 与 90e4189 之间零差异
```

### 1.3 H4-b 清理阶段事实

H4-b 的 job 是独立 validator，字段集合精确固定 24 项（[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L35-L40)），`validateRevokeJob` 校验 action/phase/lease/result 等（[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L84-L120)）。关键阶段：

| 阶段 | 入口 | 行为 | 证据 |
|---|---|---|---|
| `queued` | 撤权事务创建 | `cleanupPhase:"dispatch"`、`providerOutcome:null`、`finalizeAttempts:0`、`attempts:0` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L717-L717) |
| `sending` | `dispatch` 领取 | 60 秒租约、`attempts+1`、`leaseGeneration+1`；Provider 调用在事务外 | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L454-L473) |
| 成功 | `#finalize` | grant `cleanupPending=false`、slot released、无 blocker 时 claim released；Provider 只 Mock | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L340-L437) |
| 预发送失败 | `dispatchRetry` | `retryable_failed`，30/120/600 秒退避；attempt 4 → `terminal_failed` | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L151-L159)、[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L180-L199) |
| 结果不明 | `unknown`/`expire` | `awaiting_result`；租约过期扫描 `sending → awaiting_result` | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L160-L163)、[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L520-L548) |
| 人工重排 | `requeue` | 只接受 `retryable_failed && cleanupPhase==="dispatch"`；需 `expectedRevision`（actor 非空时）与 `device.operation.retry` | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L482-L519) |
| 本地 finalize | `finalize` | 只接受 `retryable_failed && cleanupPhase==="finalize"`；未到期 `RETRY_NOT_DUE` | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L475-L481) |

不变量：

1. `cleanupPending=false` 只由 H4-b finalize 成功写入；`terminal_failed`/`awaiting_result` 保持 `true`（[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L412-L414)、[H4-c §13.1](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L541-L554)）。
2. `awaiting_result` 没有自动重试、自动查询、定时器或普通 `requeue` 出边；普通 `requeue` 只接受 `retryable_failed && dispatch`（[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L482-L487)）。
3. H4-b 只支持 LocalStore + MockFaceAccessProvider；其它配置构造即 `NOT_CONFIGURED/503`（[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L188-L191)）。
4. 82 candidates/90 refs 是冻结边界；83 条时 pre-send 拒绝或进入 local-finalize pending，不半释放（[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L359-L367)、[H4-c §8.2](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L428-L433)）。

### 1.4 H4-c 的边界事实

H4-c 只冻结 `awaiting_result` 的人工对账，不扩展 revoke：

- 权限是 `device.operation.reconcile`，不是 `device.access.manage`（[H4-c §3](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L68-L78)）。
- 三种 decision 的事务都必须读取并复核 grant（`state==="revoked"`、`cleanupPending===true`、`cleanupJobId===jobId`、绑定一致），事务外预读不能替代（[H4-c §6.1](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L255-L281)）。
- K2 `face.reconcile`/`face.reconcile.finalize` 与 E05 的 `face.revoke` 独立，不得互换摘要（[H4-c §7](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L382-L412)）。
- 最小响应用的是 reconcile/job 投影（`jobId/decision/jobState/grantState/cleanupPending/...`），不是 E05 的 grant 投影（[H4-c §13.1](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L541-L596)）。
- `reasonCode` 在 H3/H4 是 job `result` 的服务端执行原因（如 `REVOKE_FAIL`、`LEASE_EXPIRED_UNKNOWN`、`LOCAL_FINALIZE_EXHAUSTED`），**不是**用户可提交的业务原因；07C 的业务 `reasonCode` 必须与之区分（BC-05）。
- H4-c C2/C3 未开始；E08/E09 仍 blocked；本卡不得“顺手”实现或注册（[H4-c §16](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L736-L741)）。

### 1.5 当前测试事实

现有测试是“旧 bodyless 服务层”的证据，不是 07C 的未来契约：

| 测试 | 当前断言 | 证据 |
|---|---|---|
| 撤权立即失效、同键重放零写、Provider 0 | 首次 `OUT.grantState==="revoked"`、`cleanupPending===true`；同键重放返回同一 `out`；业务快照不变 | [face-service-layer.test.mjs](../../admin-web/tests/face-service-layer.test.mjs#L346-L364) |
| 已撤权异 key | 不同 key 再撤同一 grant → `INVALID_STATE`；缺权限 → `FORBIDDEN`；不存在 → `NOT_FOUND` | [face-service-layer.test.mjs](../../admin-web/tests/face-service-layer.test.mjs#L366-L381) |
| 两个不同 key 并发 | 只有一个 fulfilled；另一个 `INVALID_STATE`；只有一个 revoke job | [face-service-layer.test.mjs](../../admin-web/tests/face-service-layer.test.mjs#L383-L396) |
| 确定性 audit 预占 | 预占 audit ID 后撤权 409，业务快照不变 | [face-service-layer.test.mjs](../../admin-web/tests/face-service-layer.test.mjs#L398-L415) |
| claim/device 绑定损坏 | `CLEANUP_SNAPSHOT_REQUIRED`，业务快照不变 | [face-service-layer.test.mjs](../../admin-web/tests/face-service-layer.test.mjs#L417-L436) |
| pending/effective/suspended/expired 均可撤 | 四种状态都返回 `revoked` | [face-service-layer.test.mjs](../../admin-web/tests/face-service-layer.test.mjs#L438-L460) |
| job/log/op 预占 | 分别 `CONFLICT`，核心内容不变 | [face-service-layer.test.mjs](../../admin-web/tests/face-service-layer.test.mjs#L462-L491) |
| job/snapshot 脱敏 | 无 `idem-`、序列号、IP/MAC、图片、objectKey、sourceFile；snapshot ≤4KiB | [face-service-layer.test.mjs](../../admin-web/tests/face-service-layer.test.mjs#L493-L504) |
| K2 domain 损坏/换钥 | `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH`，全库零变化 | [face-service-layer.test.mjs](../../admin-web/tests/face-service-layer.test.mjs#L506-L545) |
| 事务内权限撤销/成员停用 | `FORBIDDEN/403`，全库零变化 | [face-service-layer.test.mjs](../../admin-web/tests/face-service-layer.test.mjs#L547-L573) |
| H4-b 成功/未知/awaiting_result/validator | Provider 1 次或 0 次；`awaiting_result` 拒绝自动或人工继续；validator 拒绝未知字段/相位矛盾 | [face-h4b.test.mjs](../../admin-web/tests/face-h4b.test.mjs#L97-L145)、[face-h4b.test.mjs](../../admin-web/tests/face-h4b.test.mjs#L740-L753)、[face-h4b.test.mjs](../../admin-web/tests/face-h4b.test.mjs#L804-L818) |

测试影响：Q2 把“已撤权异 key”从 `INVALID_STATE` 改为“先 revision 后 state”，并发失败方也从 `INVALID_STATE` 改为 `REVISION_CONFLICT`；现有测试必须在未来编码卡中改写，**本卡不修改测试**（BC-03/BC-10）。

### 1.6 权威 revision 缺口

| revision 类型 | 现有读取 | 能否用于 E05 | 证据 |
|---|---|---|---|
| credential revision | `publicReviewItem` 的 `revision` | 不能；它是 credential，不是 grant | [dto.mjs](../../admin-web/lib/face-service/dto.mjs#L235-L251) |
| job revision | Q1 目标 DTO 六字段，但**当前未实现**；`queryJob` 只回五字段 | 不能；它是 job，不是 grant | [dto.mjs](../../admin-web/lib/face-service/dto.mjs#L254-L263)、[service.mjs](../../admin-web/lib/face-service/service.mjs#L731-L736) |
| grant revision | **没有**服务方法、没有 DTO、没有 HTTP 路径 | 当前没有任何合法来源 | [07A §3.6](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L755-L760) |

结论：E05 若要接收 `expectedGrantRevision`，必须先设计并实现“权威同组织 grant 查询 DTO”（Q3）。没有它，客户端只能编造 revision，这正是 07A 拒绝开放 E05 的理由。

### 1.7 基线冲突清单

下表是本卡最重要的“诚实边界”。**“冲突”不是指本卡写错，而是指新设计与已冻结基线/现有实现/现有测试不一致，必须由 Codex 明确超驰或由编码卡迁移。**

| ID | 基线事实 | 07C 设计 | 冲突/影响 | 处理建议 | 状态 |
|---|---|---|---|---|---|
| BC-01 | 07A §2.7 冻结 E05 digest `{grantId}`、result 五字段（含 `jobId/evidenceScope`）；服务层同 | 新 digest `{grantId,expectedGrantRevision,reasonCode}`；新 result 五字段（含 `grantRevision/cleanupJobId`） | 直接改变 K2 摘要与 result；旧 operation key 不可重放 | 保留 `face.revoke` 方法名，新摘要/result 作为 07C 契约；旧 key 失败关闭；迁移卡处理 | **P0 冲突，需裁定** |
| BC-02 | 服务层无 `expectedGrantRevision`，CAS 基准是预读 `grant.revision`；无 grant 查询 DTO | 客户端必须提交 `expectedGrantRevision`，且只能来自权威查询 | 服务入口、DTO、测试、UI 全链路缺口 | Q3 新增查询 DTO；编码卡改服务签名；本卡不编码 | **P0 缺口** |
| BC-03 | 服务先查 state（4）再查 revision（5）；已撤权异 key → `INVALID_STATE` | Q2 先校验 revision，再返回状态冲突；stale → `REVISION_CONFLICT` | 现有测试 366–396 的期望会变 | Codex 裁定 Q2；编码卡改顺序与测试 | **P0 冲突** |
| BC-04 | 旧 result 有 `jobId`、`evidenceScope`；无 `grantRevision`/`cleanupJobId` | 新 result 有 `grantRevision`/`cleanupJobId`；无 `jobId`/`evidenceScope` | 字段重命名/删除/新增，破坏旧重放 | 不保留别名；旧 key 失败关闭；响应只按新 DTO | **P0 冲突** |
| BC-05 | H3/H4/H4-c 的 job `result.reasonCode` 是服务端执行原因（`REVOKE_FAIL` 等） | 业务 `reasonCode` 是用户提交的五值枚举，只进审计 | 同名不同义，可能被误写进 job/grant | 明确命名空间：业务 reasonCode 只进审计；job.result.reasonCode 保持执行原因 | **命名冲突，需写回** |
| BC-06 | Store 确定性审计白名单只有 `auditId/orgId/actorId/actorType/action`；auditRecord 无 reasonCode/grant/job/revision | 审计需 actor、reasonCode、grant/job 指针、时间、revision | 当前 Store 会拒绝额外字段（400） | 编码卡扩展 Store 审计 schema；本卡只设计；列为 P0 门槛 | **P0 缺口** |
| BC-07 | H4-b finalize 要求 `grant.cleanupPending===true` 且 `cleanupJobId===jobId`；旧服务总是创建 job | Q5 允许 `cleanupJobId` 为 null（无 job 时） | 若 revoked 且 `cleanupPending=true` 却无 job，H4-b 无法收敛 | 规定：`cleanupPending=true` ⇒ job 必须存在；null 只用于已确认无 job 的历史/查询投影；否则 409 失败关闭 | **需细化，非放宽** |
| BC-08 | H4 原设计 `9fd088d` 有 `revokeReason` 落 grant、方法名 `face.grant.revoke`；H4-a/b 未实现 | 07C 用 `face.revoke`、reasonCode 只进审计、不写 grant | 历史设计与当前实现/本卡三方不一致 | 以当前 `face.revoke` 为方法名；`revokeReason` 不采用；历史草案只作输入 | **历史冲突，需声明** |
| BC-09 | 当前 revoke 无条件创建 `executionMode:"test"/provider:"mock"` job；H4-b 只在派发侧拒绝非 LocalStore/Mock | 07C 要求撤权事务前就拒绝 live/cloud/非 Mock：`NOT_CONFIGURED/503` | 当前实现可能在 live 环境写入 mock job | 编码卡在 revoke 入口增加运行模式 gate；本卡只冻结 | **P0 缺口** |
| BC-10 | 现有并发测试期望失败方 `INVALID_STATE` | Q2 期望失败方 `REVISION_CONFLICT`（revision 先于 state） | 测试期望冲突 | Codex 裁定 Q2；编码卡改测试；本卡不改 | **P0 冲突** |
| BC-11 | 07A §7 提到 E05 pre-scan N≥83 → `CAPACITY_EXCEEDED/400`；当前 revoke 无 pre-scan | 07C 把 82/90 容量留给 H4-b finalize；E05 不返回 `CAPACITY_EXCEEDED` | 与 07A §7/P02 的表述不完全一致 | 若 Codex 要求 E05 预扫，另立编码项；否则在 07A 后续更正中写清 E05 不预扫 | **基线表述冲突** |
| BC-12 | `assertRevokeInput` 是 Provider DTO，要求 `{grantId, credentialId}`；与 HTTP 撤权无关 | 新 HTTP body 要求 `{grantId,expectedGrantRevision,reasonCode}`，禁止 `credentialId` | 误复用会接受 `credentialId`、拒绝 `reasonCode` | 新建独立 HTTP validator，不复用 `assertRevokeInput`；本卡只设计 | **实现陷阱** |
| BC-13 | 07A E05 成功码“未批准” | 07C 建议 200 | 只是建议，不是已批准 | Codex 裁定；E05 仍 blocked | **待裁定** |
| BC-14 | 07A §2.9 禁止在 reasonCode 枚举/持久化/审计冻结前接收 | 07C 正是该冻结 | 07C 通过后才可解除该禁令；当前仍禁止 | 以 Codex 裁定为界；本卡不写“已解除” | **待裁定** |
| BC-15 | 旧 `face.revoke` operation key 存旧 digest/result | 新请求同 raw key 会算出新 digest → `CONFLICT` | 旧 key 不可重放；历史数据仍在 | 不原地改写；迁移卡盘点/归档；确认无 live 客户端 | **迁移冲突** |
| BC-16 | grant 无字段白名单；旧记录可能缺 `cleanupPending/cleanupJobId` 或 revision 非法 | Q7 要求缺失/非法 revision 失败关闭，不推定默认值 | 老数据可能直接 409；无法撤销 | 失败关闭是正确的；修复只能走受控迁移/修复卡；不自动补写 | **数据冲突** |
| BC-17 | 旧审计 ID `audit-h4-v1:<...>`，无 reasonCode | 新审计 ID `audit-h4-revoke-v1:<...>`，含 reasonCode/actor/revision | 新旧审计并存；旧审计不可补 reasonCode | 新前缀避免碰撞；旧审计只读、显示 legacy/null；不回填 | **兼容冲突** |
| BC-18 | 当前服务对“成员不存在”返回 403 | 07A §2.2 对“成员不存在”要求 404；组织停用/缺权限 403 | 错误码与 07A 不完全一致 | 07C 按 07A：不存在/不可见 404，停用/缺权限 403；编码卡改映射与测试 | **基线冲突** |

**冲突处理总原则：**

1. 任何“旧摘要/旧 result/旧审计/旧 grant”都不自动迁移、不补写、不猜测；失败关闭优先。
2. 任何“新字段/新语义”都不保留旧别名；避免客户端同时看到 `jobId` 和 `cleanupJobId`。
3. 任何“状态/错误码”冲突都以 07A 已冻结表为准；本卡只新增 E05 端点级映射，不新增同义码。
4. 任何“测试期望”冲突都在未来编码卡中改写；本卡不修改测试。

## 2. 状态词与 E05 登记

### 2.1 状态词

本卡只使用 07A §3.9 的四个状态值：

| 词 | 本卡含义 | 禁止写法 |
|---|---|---|
| `implemented` | 当前代码/已终审文档已有事实 | 不得外推为“可接线” |
| `proposed` | 本卡冻结了候选文本，但未获 Codex 裁定或未实现 | 不得写成“已批准”“已冻结生效” |
| `blocked` | 缺前置或本卡明确关闭 | 不得写成 `ready`/`partial`/`已就绪`/`开放` |
| `not-applicable` | 该维度不适用 | 不得用来掩盖未实现 |

“冻结候选”不是第五个状态值：它表示“文本可验收、后续编码必须逐条满足”，但登记状态仍是 `proposed` 或 `blocked`。

### 2.2 E05 登记表

| 维度 | 当前事实 | 本卡后 | 说明 |
|---|---|---|---|
| 服务层 | `implemented`（旧 bodyless 入口） | `blocked`（需新服务改造） | 旧入口不能当作新契约；新服务必须另发编码卡 |
| 契约 | `blocked`（07A Q4/Q5） | `proposed`（本卡候选，待裁定） | 裁定只关闭设计争议，不批准编码 |
| HTTP | `blocked`（0 注册） | **`blocked`（0 注册）** | 本卡不写 `server.mjs`、不写 `routes.mjs`、不注册 |
| 权限 | `implemented`（`device.access.manage` 已在目录） | `implemented` | 不新增权限点；不隐含于角色 |
| 幂等 | `implemented`（旧 `face.revoke` 摘要/result） | `proposed`（新摘要/result） | 旧 key 不可重放；迁移另议 |
| revision | `blocked`（无权威 grant 读取） | `blocked`（Q3 只给 DTO） | 查询 DTO/HTTP 未实现、未批准 |
| Provider/设备 | `not-applicable`（撤权 HTTP 不调用） | `not-applicable` | 派发/清理后续阶段不属于 E05 HTTP |
| 测试 | 旧服务层测试存在 | `proposed`（75 条未来契约测试） | 未执行；不宣称通过 |

**E05 总体登记：blocked。** 本卡不会把 E05 变成可接线；它只把“将来接线必须满足什么”写到可复审的程度。

## 3. 权限与组织边界

### 3.1 权限点

| 项目 | 冻结候选 |
|---|---|
| 撤权权限 | `device.access.manage`，只从当前组织成员记录的 `permissions` 数组读取 |
| 新增权限 | 无；不新增 `device.grant.read`、`device.grant.revoke` 或按 reasonCode 的细粒度权限 |
| 角色 | `admin/editor/viewer/resident` 均不隐含 `device.access.manage`；显式授予才有效 |
| 其他权限 | `device.audit.read` 只能读任务/审计，不能撤权；`device.operation.retry/reconcile` 不能撤权；`device.face.*` 不能撤权 |
| reasonCode 与权限 | 五个 reasonCode 共用同一个 `device.access.manage`；reasonCode 不改变授权、不升级权限、不触发额外工作流 |
| grant 查询权限 | 建议同样使用 `device.access.manage`（Q1/Q3）；不新增读权限 |

权限目录证据：[org.mjs](../../admin-web/lib/org.mjs#L89-L105)。`admin` 角色不隐含任何 `device.*` 是 07A §0.4 的不可协商结论（[07A §0.4](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L77-L83)）。

### 3.2 组织解析

按 07A §2.2 冻结顺序（[07A §2.2](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L264-L273)）：

1. `X-Org-Id` 请求头 → `?orgId=` → 唯一 active membership。
2. 多组织且未指定：`PARAM_ERROR/400`。
3. 零组织：`NOT_FOUND/404`。
4. 请求体中的 `orgId/actorId/membershipId/permissions/role` 一律未知字段，`PARAM_ERROR/400`；不得从 body 提升权限依据。
5. `adminAccount` 通过 `requireMembership` 解析组织；服务层再次读取 `organizations/<orgId>` 与 `org_memberships/<membershipId>`。

### 3.3 事务内复核（不可省略）

撤权事务必须重新读取并逐项复核，**事务外 `#require` 只用于快速失败，不能替代**：

```text
organizations/<orgId>.status === "active"
org_memberships/<actor.membershipId>.orgId === orgId
org_memberships/<actor.membershipId>.status === "active"
membership 主体 ID 与 actor 一致
membership.permissions 含 "device.access.manage"
actorType === "user"（HTTP 入口；system/agent 不得借用户会话）
```

任一不满足：

| 情形 | HTTP | code | 写 |
|---|---:|---|---:|
| 组织/成员不存在或不可见 | 404 | `NOT_FOUND` | 0 |
| 组织停用 | 403 | `FORBIDDEN` | 0 |
| 成员停用 | 403 | `FORBIDDEN` | 0 |
| 缺 `device.access.manage` | 403 | `FORBIDDEN` | 0 |
| 请求开始后权限被撤销/成员停用 | 403 | `FORBIDDEN` | 0 |
| actorType 不是 user | 403 | `FORBIDDEN` | 0 |

**权限撤销立即失败：** 事务内复核是硬要求；不得使用缓存权限、旧 session 权限、旧 mutation 结果或前端隐藏来替代。权限撤销后下一个请求立即 403，不命中旧 K2/旧 result。

### 3.4 跨组织同态

- grant 不存在、grant 属于其他组织、grant 在事务内消失：统一 `NOT_FOUND/404`，消息固定“授权不存在或不可见”。
- 不得用 403 区分“存在但跨组织”；403 只用于当前组织/成员/权限问题。
- 先权限后资源：缺权限时即使 grant 跨组织也返回 403；有权限但 grant 不可见才 404。这样不泄露资源存在性。
- 事务内 `store.get(..., orgId)` 为 null 即 404；不得先按全局 ID 读取再比较 orgId 后返回不同错误。

### 3.5 端点级错误优先级

本卡固定 E05 的检查顺序（用于同时满足多个失败条件时选码）：

| 序 | 检查 | 结果 |
|---:|---|---|
| 1 | 登录会话 | 401（现有登录门形状，不是 v2 信封） |
| 2 | Origin / CSRF | 403（现有形状，不进入业务） |
| 3 | 组织解析（多组织未指定/零组织） | 400 / 404 |
| 4 | 组织/成员/权限/actorType | 404 / 403 |
| 5 | 请求 DTO（body/path/Idempotency-Key/reasonCode/revision 类型） | 400 |
| 6 | K2 配置 | 503 `NOT_CONFIGURED` |
| 7 | grant 可见性 | 404 `NOT_FOUND` |
| 8 | K2 domain / operation key 完整性 | 409 `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH`/`CONFLICT` |
| 9 | `expectedGrantRevision` CAS | 409 `REVISION_CONFLICT` |
| 10 | grant 状态 | 409 `INVALID_STATE` |
| 11 | cleanup 绑定 / job/log/audit 预占 | 409 `CLEANUP_SNAPSHOT_REQUIRED`/`CONFLICT` |
| 12 | 时钟/Store | 503 `ADAPTER_UNAVAILABLE` |

说明：

- 第 5 步在权限之后：未授权请求不进入字段级校验，避免把端点 schema 当作未授权探测面；有权限的请求才返回 400。
- 第 6 步在 grant 可见性之前：K2 配置是全局能力，配置不可用时任何业务都不能进行；这不泄露具体 grant 是否存在。
- 第 8 步在 revision 之前：K2 记录损坏/摘要不符说明幂等层不可用，优先失败关闭；但这不会返回旧结果。
- 第 9 步先于第 10 步：Q2 的核心；已撤权但 revision 过期返回 `REVISION_CONFLICT`，revision 当前但状态已撤权返回 `INVALID_STATE`。
- 所有失败路径都不写 grant/job/log/audit/op key/domain，Provider 0；唯一例外不在 E05（E04 的文件访问日志）。

## 4. 请求 DTO（严格白名单）

### 4.1 路径、方法与传输

| 项目 | 冻结候选 |
|---|---|
| 方法 | `POST`；不得用 PUT/PATCH/DELETE 表达撤权 |
| 路径 | `/api/v2/device-access-grants/:grantId/revoke`（沿用 07A E05 路径描述） |
| 认证 | 现有 HttpOnly `smartpm_session` Cookie；不接受 Bearer，不接受 body 中的 actor |
| Origin | 必须匹配 `ADMIN_ORIGIN`，否则现有 403，不进入业务 |
| CSRF | 必须带 `X-CSRF-Token`，值等于当前会话 `csrf`，否则 403 |
| Content-Type | `application/json`；缺失或其它类型 `PARAM_ERROR/400` |
| Body 上限 | 65536 字节；超限 `413 PARAM_ERROR`，不得落为 503 |
| 缓存 | `Cache-Control: no-store` |
| requestId | 每个 v2 请求由 server 生成 UUID；响应原样返回；不接受客户端指定 |
| 查询参数 | 无；任何 query 参数 `PARAM_ERROR/400`（含 `?idempotencyKey=`、`?orgId=` 之外的业务参数） |

### 4.2 请求体：精确三字段

```json
{
  "grantId": "<opaque-grant-id>",
  "expectedGrantRevision": 7,
  "reasonCode": "REVOKE_ADMIN_ACTION"
}
```

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---:|---|---|
| `grantId` | string | 是 | `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`；百分号解码失败 400 | 必须与路径 `:grantId` 完全相等；不相等 400 |
| `expectedGrantRevision` | number | 是 | `Number.isSafeInteger` 且 `1..Number.MAX_SAFE_INTEGER`；不接受字符串/小数/0/负数/NaN/Infinity | 事务内 CAS 基准；只来自权威 grant 查询 DTO |
| `reasonCode` | string | 是 | 精确五值枚举，见 §6；大小写敏感，不去空格，不做 Unicode 归一化 | 只进审计与摘要；不写 grant/job/response |

**为什么 body 也必须有 `grantId`：** 本卡按任务要求冻结“严格 body `grantId`”；它与路径参数形成双绑定，避免路径/正文混淆，并让 `requestDigest` 的 `grantId` 字段有明确来源。路径与正文必须一致；任何一方缺失都 400。

**精确白名单：**

- 顶层只允许 `grantId/expectedGrantRevision/reasonCode` 三个键。
- 未知顶层字段一律 400：`credentialId`、`deviceId`、`personId`、`orgId`、`actorId`、`membershipId`、`role`、`permissions`、`idempotencyKey`、`reason`、`note`、`comment`、`metadata`、`force`、`expectedRevision`（旧名）、`expectedJobRevision`、`jobId`、`cleanupJobId`、`grantRevision`、`duplicate`。
- 嵌套对象/数组一律拒绝；`metadata.reasonCode`、`reason.text` 等同样 400。
- 不允许隐式类型转换：`"7"` 不是 revision；`true`/`null` 不是枚举。
- 重复 JSON 键：解析后以最后值为准的实现不得被当作合法契约；客户端不得发送重复键；测试应覆盖“重复键被拒绝或至少不被当作合法契约”的显式策略（编码卡确定解析层行为）。

### 4.3 Idempotency-Key：仅请求头

| 项目 | 冻结候选 |
|---|---|
| 位置 | 仅 `Idempotency-Key` 请求头；不得在 body/query/cookie |
| 格式 | `^[A-Za-z0-9._:-]{16,128}$`，区分大小写，不去空格 |
| 缺失/非法 | `PARAM_ERROR/400`，零写，不创建 operation key |
| 重复头 | 不接受数组/重复头；重复即 400 |
| 作用域 | `orgId + "face.revoke" + actorType + actorId + raw key` |
| 原始 key | 只用于 HMAC 派生；不得写入 grant/job/log/audit/operation key 记录/response/error |
| 头名大小写 | HTTP 头名大小写不敏感；值大小写敏感 |

### 4.4 DTO 校验顺序

1. 方法/路径/Content-Type/body 上限。
2. Body 必须是普通对象（非数组、非 null）。
3. 顶层未知字段拒绝。
4. `grantId` 字符串/长度/字符集；与路径一致。
5. `expectedGrantRevision` 类型/正安全整数。
6. `reasonCode` 字符串/精确枚举。
7. `Idempotency-Key` 存在/格式/非重复。
8. 进入权限与事务检查。

所有 DTO 失败：`PARAM_ERROR/400`，零写，Provider 0，不回显字段值（尤其 reasonCode 原文、grantId 原文）。

### 4.5 明确禁止

- 禁止把 `expectedRevision` 旧名当别名接受；出现即 400。
- 禁止把 `jobId`/`cleanupJobId` 作为请求字段；客户端不能指定清理 job。
- 禁止把 `grantRevision` 作为请求字段；请求只接受 `expectedGrantRevision`。
- 禁止接受 `reason`/`reasonText`/`note` 等自由文本；只能 `reasonCode`。
- 禁止复用 Provider 的 `assertRevokeInput`（它要求 `{grantId,credentialId}`，是 Mock Provider 输入，见 [dto.mjs](../../admin-web/lib/face-service/dto.mjs#L167-L172)）；必须新建独立 HTTP validator（BC-12）。
- 禁止把原始 `Idempotency-Key` 放进错误消息、日志、审计或响应。

## 5. 权威 grant revision 与 CAS

### 5.1 为什么必须有权威查询

`expectedGrantRevision` 是 CAS 基准。没有权威读取时，客户端只能：

- 用 grant 创建顺序/数组下标/本地自增推测；
- 用 credential revision 或 job revision 冒充；
- 用上次撤权响应里的 `grantRevision` 当“当前值”；
- 用 `cleanupPending`/`cleanupJobId` 推导；
- 用时间戳/摘要前缀/缓存旧值。

这些都被 07A Q7/Q2 明确禁止（[07A §3.7](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L768-L778)、[07A Q2](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L1254-L1254)）。因此 Q3 必须先给出“权威同组织 grant 查询 DTO”。

### 5.2 权威 grant 查询 DTO（Q3 建议，待裁定）

**服务方法（建议名）：** `queryGrant(grantId)`

**权限：** `device.access.manage`（与撤权同权限；不新增读权限）。

**未来 HTTP 路径（仅提案，不注册）：** `GET /api/v2/device-access-grants/:grantId`
- 这是 E05-R 读取提案，不属于 07A 九端点；必须由 Codex 单独批准并另发编码卡。
- **本轮不写入 `routes.mjs`、不注册 `server.mjs`、不调用应用 HTTP。**
- 若 Codex 拒绝新增读取端点，E05 因无权威 revision 继续 blocked；不得用伪来源替代。

**响应 DTO（精确五字段）：**

```json
{
  "data": {
    "grantId": "<opaque-grant-id>",
    "grantState": "effective",
    "grantRevision": 7,
    "cleanupPending": false,
    "cleanupJobId": null
  },
  "requestId": "uuid"
}
```

| 字段 | 类型 | 约束 | 来源 |
|---|---|---|---|
| `grantId` | string | 1–128 有界 ID | grant 记录 `_id` |
| `grantState` | enum | `pending/effective/suspended/revoked/expired` | grant `state` |
| `grantRevision` | number | 正安全整数 `1..MAX_SAFE_INTEGER`；缺失/非法失败关闭 | grant `revision` |
| `cleanupPending` | boolean | 非 revoked 记录缺失时按 false 投影；revoked 记录缺失即失败关闭 | grant `cleanupPending` |
| `cleanupJobId` | string \| null | 1–128 有界 ID 或 null；不透明；无 job 才 null | grant `cleanupJobId` |

**禁止返回：** `orgId`、`credentialId`、`deviceId`、`personId`、`occupancyId`、`cycleId`、`claimId`、`slotId`、`validFrom`、`validUntil`、`evidenceScope`、`createdAt`、`updatedAt`、`revokedAt`、`revokedByActorId`、job 状态/attempts/lease/cleanupPhase/result、`requestDigest`、operation key、任何 PII/设备字段。

**错误：**

| HTTP | code | 条件 | 写 |
|---:|---|---|---:|
| 400 | `PARAM_ERROR` | grantId 非法、query 参数、body 非空 | 0 |
| 401 | 现有登录门 | 无会话 | 0 |
| 403 | `FORBIDDEN` | 缺 `device.access.manage`、组织/成员停用 | 0 |
| 404 | `NOT_FOUND` | grant 不存在/跨组织，同态 | 0 |
| 409 | `INVALID_STATE` | grant revision 缺失/非法；revoked 但 `cleanupPending` 缺失/非布尔 | 0 |
| 409 | `CLEANUP_SNAPSHOT_REQUIRED` | `cleanupPending=true` 但 `cleanupJobId` 缺失/指向不存在或非本 grant 的 job；`cleanupPending=false` 但 `cleanupJobId` 指向损坏/非 succeeded job | 0 |
| 503 | `ADAPTER_UNAVAILABLE` | Store/clock 不可用 | 0 |

**读取语义：**

- 返回**当前** grant 投影，不是历史快照；与撤权响应的“首次结果投影”不同（§7.4）。
- 读操作零写；不写 audit/log/op key；不调用 Provider。
- `grantRevision` 是唯一可用于 E05 的 revision；不得从 `cleanupPending`、`cleanupJobId`、job revision、credential revision、数组下标、时间戳、摘要前缀或旧撤权响应推导。
- UI 在每次撤权请求前按 ID 重新查询；不得跨页面缓存、不得用列表行、不得在无合法 revision 时发探测请求。
- 查询失败/超时/409/503 → 撤权按钮隐藏或禁用，零请求；不得点击时兜底猜一个 revision。

### 5.3 revision 规则

| 输入/记录 | 规则 | HTTP |
|---|---|---|
| `expectedGrantRevision` 缺失 | 必填；缺失即失败 | 400 `PARAM_ERROR` |
| 0、负数、小数、字符串、布尔、null、NaN、Infinity、`2^53` 及以上 | 非正安全整数 | 400 `PARAM_ERROR` |
| `1..MAX_SAFE_INTEGER` 但不是当前 grant revision | 过期或超前 | 409 `REVISION_CONFLICT` |
| 等于当前 revision | CAS 通过，进入状态检查 | 继续 |
| grant 记录 `revision` 缺失/非法/非正安全整数 | 服务端数据损坏；失败关闭，不推定 1 | 409 `INVALID_STATE` |
| grant 记录 `revision == MAX_SAFE_INTEGER` | 无法 +1，失败关闭 | 409 `INVALID_STATE` |
| grant 记录 `revision` 合法但绑定字段变化 | 事务内复核失败 | 409 `REVISION_CONFLICT` |

**关键区分：**

- **400 是客户端输入形状错误**：revision 缺失、类型错、非正安全整数。
- **409 是 CAS 失败**：输入合法但不等当前值（stale/future），或事务内发现绑定变化。
- **409 `INVALID_STATE` 是服务端记录损坏/状态不允许**：grant revision 本身非法、溢出、已撤权、状态未知。
- 不得把服务端记录损坏返回 400；不得把客户端 stale 返回 400；不得把“已撤权”返回 `REVISION_CONFLICT` 如果 revision 已匹配（Q2 顺序）。

### 5.4 已撤权的 revision 语义

撤权事务把 grant revision 从 `N` 写到 `N+1`；H4-b finalize 成功再写到 `N+2`。因此：

| 请求 | `expectedGrantRevision` | 当前 grant | 结果 |
|---|---:|---|---|
| 首次撤权 | `N` | `pending/effective/suspended/expired`, revision `N` | 200，响应 `grantRevision=N+1` |
| 同键重放 | 同首次 `N` | 已 `revoked`, revision `N+1`（或 `N+2`） | 200，返回首次结果投影（不重新 CAS） |
| 不同键、旧 revision | `N` | 已 `revoked`, revision `N+1` | 409 `REVISION_CONFLICT`（先 revision） |
| 不同键、当前 revision | `N+1` 或 `N+2` | 已 `revoked` | 409 `INVALID_STATE`（revision 已匹配，状态不允许） |
| 清理成功后不同键 | `N+1` | `revoked`, revision `N+2` | 409 `REVISION_CONFLICT` |
| 清理成功后不同键 | `N+2` | `revoked`, revision `N+2` | 409 `INVALID_STATE` |

**不要用撤权响应的 `grantRevision` 直接再撤一次：** 响应是 `N+1`，那是撤权后的 revision；再次撤权时它是“当前值”，但状态已是 `revoked`，所以返回 `INVALID_STATE`，不是 duplicate。要判断当前状态，应调用权威查询。

### 5.5 老 grant 的 revision 缺失（Q7）

- 任何 `revision` 缺失、`0`、负数、小数、字符串、`NaN`、`Infinity`、非安全整数的老 grant：**失败关闭**。
- 不得 `revision ?? 1`、`Number(revision)`、取整、截断、回退缓存、用创建顺序补、用 `updatedAt` 推。
- 撤权：`INVALID_STATE/409`，零写；查询：`INVALID_STATE/409`，不返回 DTO。
- 只能通过受控数据修复/迁移卡修正；本卡不自动补写、不删除、不重算。

## 6. reasonCode：最小业务枚举与审计用途

### 6.1 Q1 建议：五值最小业务枚举，统一权限

`reasonCode` 是**业务撤权原因短码**，不是自由文本、不是 job 执行错误、不是设备/Provider 返回码。建议只保留以下五个值；不设 `OTHER`，避免它变成自由文本倾倒口：

| `reasonCode` | 含义 | 适用场景 | 权限 | 审计用途 | 禁止携带 |
|---|---|---|---|---|---|
| `REVOKE_USER_REQUEST` | 用户/住户主动申请撤销 | 本人或授权代表提出撤权 | `device.access.manage` | 审计分类 `user_request`；统计用户主动撤权 | 姓名、电话、地址、证件号、申请文本 |
| `REVOKE_ADMIN_ACTION` | 管理员日常管理操作 | 换房、退租、权限清理、误授权纠正 | `device.access.manage` | 审计分类 `admin_action`；区分日常管理与安全事件 | 备注、工单正文、内部口令 |
| `REVOKE_SECURITY_RISK` | 安全风险/异常事件处置 | 可疑通行、失窃、冲突、风控要求 | `device.access.manage` | 审计分类 `security_risk`；供安全审计聚合 | 事件描述、嫌疑人信息、监控截图、设备序列号 |
| `REVOKE_DEVICE_CHANGE` | 设备更换、拆除、迁移 | 门禁设备退场/换机/位置变更 | `device.access.manage` | 审计分类 `device_change`；与设备生命周期对账 | 设备序列号、MAC、IP、安装地址 |
| `REVOKE_COMPLIANCE` | 合规/审计/法务要求 | 监管、诉讼保全、内部合规检查 | `device.access.manage` | 审计分类 `compliance`；供合规审计 | 案号、法务意见、证件号、证据原文 |

规则：

1. **权限统一：** 五个值都只要求 `device.access.manage`；不按 reasonCode 拆分权限，不因 `SECURITY_RISK` 自动升级权限，不触发额外审批流。
2. **枚举固定：** 精确匹配，区分大小写，不去首尾空格，不做 Unicode 归一化、不做别名映射、不接受中文标签。`revoke_admin_action`、`ADMIN_ACTION`、`REVOKE-ADMIN-ACTION`、前后带空格均为非法。
3. **必填：** 新 HTTP 请求必须带 `reasonCode`；缺失 400。历史记录可以没有，见 §6.4。
4. **无自由文本：** 请求体没有 `reason/reasonText/note/comment/metadata`；出现即 400。业务详情只能进入另行批准的审计/工单系统，不能塞进本字段。
5. **无 PII/设备信息/异常文本：** reasonCode 本身是短码，但仍要扫描请求与审计，禁止姓名、地址、手机号、证件号、设备序列号、MAC/IP、异常 message/stack、图片/objectKey、原始幂等键。
6. **未知值：** `PARAM_ERROR/400`，零写，不创建 op key/audit/job。
7. **新增值：** 必须另发设计与 Codex 裁定；不得在编码卡里“顺手”加第六个值。

### 6.2 为什么是这五个

- 覆盖人工撤权的主要业务动因：用户主动、管理员日常、安全风险、设备变更、合规。
- 不包含系统自动原因（到期、凭证撤销、资格失效、设备退役扫描）：那些不是 E05 的人工 HTTP 入口，不能借本端点伪装。
- 不包含 `OTHER`：一旦允许“其他”，调用方会把姓名、电话、事由写进去，破坏隐私与枚举可审计性。
- 不包含 job 执行原因（`REVOKE_FAIL`、`LEASE_EXPIRED_UNKNOWN`、`LOCAL_FINALIZE_EXHAUSTED`）：这些是 H3/H4/H4-c 的服务端结果，不是用户可提交的业务原因（BC-05）。

### 6.3 审计用途与摘要绑定（Q6）

- `reasonCode` **只写入确定性审计记录**，不写 grant、不写 job、不写 job.result、不写 log、不写响应。
- `reasonCode` **必须进入 `requestDigest`**：同 key、同 grant、同 revision、不同 reasonCode → `CONFLICT/409`，不能重放成首次结果。理由：reasonCode 是请求语义的一部分；如果不绑定摘要，调用方可以用同一个 key 把“安全风险”改写成“用户申请”，而系统仍返回旧成功结果，审计与请求不一致。
- 审计记录同时保存 `reasonCode` 与固定 `action`；`action` 不拼接 reasonCode 原文，避免把枚举变成自由文本。
- UI/报表把 reasonCode 映射为固定中文标签；映射表由前端/报表维护，不进入请求，不进入响应。

### 6.4 历史兼容

| 历史对象 | 处理 |
|---|---|
| 旧撤权 grant/job/log/audit 无 `reasonCode` | 只读兼容：缺失视为 `null`/`legacy`，不伪造枚举、不回填、不拒绝读取 |
| 旧 `face.revoke` operation key 的 result 无 reasonCode | 旧记录不重放新请求；旧 key 失败关闭（§7.6）；不原地改写 |
| 旧审计 ID `audit-h4-v1` | 保留；新审计用 `audit-h4-revoke-v1` 前缀；两者并存，不冲突 |
| 旧 H4 草案 `revokeReason` 落 grant | 不采用；当前代码未实现；不新增该字段（BC-08） |
| 旧服务层调用无 reasonCode | 仅作为旧服务事实存在；不能作为新 HTTP 契约；编码卡迁移调用方与测试 |

**历史兼容不等于自动迁移。** 旧记录保持原样；需要修复的走受控迁移/修复卡；本卡不执行迁移。

### 6.5 禁止内容清单

以下内容出现在 `reasonCode` 或请求其它位置即 400，并触发敏感扫描：

- 自由文本、句子、标点、空格、换行、控制字符。
- 姓名、昵称、地址、手机号、座机、证件号、邮箱、账号、工号。
- 设备序列号、MAC、IP、IMEI、安装位置、门禁点名称。
- 异常 message、stack、SQL、文件路径、Provider 响应、HTTP 头原文。
- 原始 Idempotency-Key、requestDigest、operation key、K1/K2/K3 密钥、图片字节、objectKey。
- 案号、工单号、法务意见等可识别文本（放独立系统，不放本字段）。

## 7. K2 幂等契约

### 7.1 独立 method

| 项目 | 冻结候选 |
|---|---|
| K2 method | `face.revoke`，E05 独立方法 |
| 不得复用 | `face.grant`、`face.submit`、`face.review`、`face.reconcile`、`face.reconcile.finalize`、`face.operation.retry` |
| 不得改名 | 不改成 `face.grant.revoke`（H4 历史草案名，BC-08）；不新增 `face.revoke.v2`（会增加第二身份；如 Codex 坚持，另裁） |
| 作用域 | `orgId + "face.revoke" + actorType + actorId + raw key`；同 raw key 不同 actor 不互相重放 |
| 跨端点 | 同 raw key 用于 E01/E03/E05 不互相重放；K2 method 不同 |

### 7.2 精确 requestDigest

```text
requestDigest = SHA-256( stableStringify({
  grantId: <body.grantId>,
  expectedGrantRevision: <body.expectedGrantRevision>,
  reasonCode: <body.reasonCode>
}) )
```

| 规则 | 值 |
|---|---|
| 字段 | **精确三个**：`grantId`、`expectedGrantRevision`、`reasonCode` |
| 不包含 | `orgId`、`actorId`、`actorType`、`requestId`、时间戳、路径原文、header、raw Idempotency-Key、`credentialId`、`deviceId`、`jobId`、`cleanupJobId`、`grantRevision`、`reason`、`metadata` |
| 序列化 | 稳定排序 JSON、无多余空白、UTF-8；数组/对象不进入摘要 |
| 算法 | SHA-256，输出 64 位小写十六进制，仅存于 operation key 记录 |
| 来源 | 只从通过 §4 校验的 body 构造；不得从原始请求字符串、路径、header 或客户端摘要读取 |
| 变更 | 三字段任一变化 → 新摘要；同 key 不同摘要 → `CONFLICT/409` |

注意：`grantId` 在路径与 body 各有一份，摘要使用 body 值；由于 §4.2 要求二者相等，摘要与实际资源一致。若未来取消 body `grantId`，必须另裁并改摘要；本卡不预留旧格式。

### 7.3 operation key 记录

精确字段（沿用现有 K2 记录形状）：

```json
{
  "orgId": "<org-id>",
  "realm": "<k2-realm>",
  "keyVersion": 1,
  "requestDigest": "<64-hex>",
  "result": {
    "grantId": "<opaque-grant-id>",
    "grantState": "revoked",
    "grantRevision": 8,
    "cleanupPending": true,
    "cleanupJobId": "<opaque-job-id>"
  },
  "createdAt": 1763000000000
}
```

| 规则 | 冻结候选 |
|---|---|
| `_id` | HMAC 派生的 `op:` 前缀 key；原始 Idempotency-Key 不落库 |
| 字段 | 只允许 `orgId/realm/keyVersion/requestDigest/result/createdAt` |
| `result` | 精确五字段，见 §7.4；不得含内部字段 |
| 不可变 | 首次写入后不更新、不覆盖、不追加 |
| 原始 key | 不存、不回显、不写日志/审计 |
| 损坏 | 缺字段/错 orgId/错 realm/错 keyVersion/非安全整数 createdAt/摘要不符/result 非对象 → `CONFLICT/409`，零写 |
| 过期 | 不引入 `expiresAt`；不套用 `IDEMPOTENCY_EXPIRED` |

### 7.4 严格 result 投影（operation/result 指针的落点）

**本卡对“operation/result 指针”的解释：**

- **operation 指针** = 内部 `operation_keys/<opKey>` 记录；它由 HMAC 派生，**不返回给客户端**。
- **result 指针** = 该记录的 `result` 字段；它精确等于响应 `data` 的五字段投影，不是完整 grant/job 记录，也不是内部状态快照。
- 响应不额外增加 `operationKey`/`requestDigest`/`operation` 嵌套对象；客户端只看到 `data` 五字段。

`result` 精确字段：

| 字段 | 类型 | 约束 |
|---|---|---|
| `grantId` | string | 与请求一致，1–128 有界 ID |
| `grantState` | string | 固定 `"revoked"` |
| `grantRevision` | number | 正安全整数，等于撤权事务写入的 `N+1` |
| `cleanupPending` | boolean | 正常撤权为 `true`；历史无 job 的查询投影可为 `false` |
| `cleanupJobId` | string \| null | 正常撤权为非空不透明 ID；无 job 为 `null` |

禁止出现在 `result`：`jobId`（旧名）、`evidenceScope`、`jobState`、`cleanupPhase`、`attempts`、`lease*`、`providerOutcome`、`requestDigest`、`opKey`、`operationKey`、`reasonCode`、`actorId`、`orgId`、`credentialId`、`deviceId`、`personId`、`claimId`、`slotId`、`snapshot`、`createdAt`、`duplicate`。

### 7.5 重放规则

| 情形 | 行为 | HTTP | 写 |
|---|---|---:|---:|
| 同 op key、同 requestDigest | 返回已有 `result` 五字段；不重跑事务、不新增 audit/job/log；Provider 0 | 200 | 0 |
| 同 op key、异 requestDigest | `CONFLICT/409`；不覆盖 op key；不返回旧结果 | 409 | 0 |
| 同 raw key、不同 actor | op key 作用域不同，互不重放；各自按 grant revision/state 规则 | 200/409 | 按各自 |
| 同 raw key、不同端点 | K2 method 不同，互不重放 | 各自 | 各自 |
| op key 记录缺失但首次请求未提交 | 正常首次执行；允许重试 | 200/4xx | 按结果 |
| op key 记录损坏 | `CONFLICT/409`；零写 | 409 | 0 |
| op key result 形状不符 | `CONFLICT/409`；零写 | 409 | 0 |
| 旧 `face.revoke` key（旧 digest/result） | 新请求同 raw key 会算出不同 digest → `CONFLICT/409`；不迁移、不解释旧值 | 409 | 0 |
| K2 配置缺失/非法 | `NOT_CONFIGURED/503`；零写，不创建 op key | 503 | 0 |
| K2 domain 单边缺失/损坏 | `DOMAIN_INCOMPLETE/409`；零写 | 409 | 0 |
| K2 换钥/版本/fingerprint 不符 | `DOMAIN_MISMATCH/409`；零写 | 409 | 0 |

### 7.6 首次结果语义（重要）

- 同键同摘要重放返回**首次成功的 result 投影**，不是当前 grant 状态。
- 因此清理完成后重放，`grantRevision` 仍是撤权时的 `N+1`、`cleanupPending` 仍是 `true`；这是不可变 receipt，不是 live state。
- 需要当前状态时调用权威 grant 查询（§5.2），它返回 `N+2`/`false`。
- 不允许把“重放返回旧投影”解释为清理未完成；也不允许为了返回“当前值”而改写 op key（会破坏幂等与不可变）。
- 如果 Codex 希望撤权重放返回“当前投影”，必须明确超驰 07A §2.6 的“首次结果”规则；本卡建议保持首次结果，避免二次读取与竞态。

### 7.7 原始 key 禁入

- 原始 Idempotency-Key 只存在于请求内存与 HMAC 输入；不写 operation key 记录、不写 grant/job/log/audit、不写响应/错误、不写测试快照。
- op key ID 是 HMAC 派生值；它不是原始 key，不得被客户端当作可逆标识。
- 日志/审计只允许记录“K2 成功/失败类别”，不记录 key 或摘要原值。
- 测试数据中的 key 必须使用明显的测试占位符，且测试结束不写入仓库文档。

## 8. 状态机与 cleanup job

### 8.1 grant 状态

| 状态 | 是否允许撤权 | 说明 | 证据 |
|---|---|---|---|
| `pending` | 允许 | 已创建未生效；可立即撤销 | 当前服务允许（[service.mjs](../../admin-web/lib/face-service/service.mjs#L687-L687)） |
| `effective` | 允许 | 已生效；可立即撤销 | 同上 |
| `suspended` | 允许 | 暂停；可立即撤销 | 同上 |
| `expired` | 允许 | 已过期仍允许撤权（H4-a 明确允许） | 同上；[07A E05](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L624-L625) |
| `revoked` | **不允许新撤权** | 同键重放例外；不同键按 Q2 返回冲突 | 见 §8.2 |
| 未知/缺失/损坏 | 不允许 | 失败关闭；不猜测 | `INVALID_STATE/409` |

`state` 迁移：`pending/effective/suspended/expired → revoked`；`revoked` 是终态；`expired` 在状态表中是终态，但撤权作为手动业务动作允许从 `expired` 进入 `revoked`（当前实现与 07A 均如此）。不得从 `revoked` 回到任何状态。

### 8.2 已 `revoked`：同键与不同键（Q2）

**同键同摘要：**

- 返回首次 result 投影；200；零写；Provider 0；不新增 job/audit。
- 不要求当前 grant revision 等于请求 revision；op key 分支在 revision 检查之前。

**不同键：不是 duplicate。** 撤权没有 `duplicate:true` 语义；`duplicate` 只属于 H4-c reconcile 的“不同键同结论”场景（[H4-c §7.2](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L393-L410)）。

不同键的顺序固定为：

1. DTO/权限/可见性/K2 完整性通过。
2. 读取当前 grant（事务内）。
3. **先比较 `expectedGrantRevision` 与 `grant.revision`：**
   - 不相等（stale/超前）→ `REVISION_CONFLICT/409`，零写。
4. revision 相等后再看状态：
   - `state === "revoked"` → `INVALID_STATE/409`，零写；
   - 其它不允许状态/损坏 → `INVALID_STATE/409`；
   - 允许状态 → 正常撤权。

因此：

- 不同键 + 旧 revision → `REVISION_CONFLICT`（不是 `INVALID_STATE`）。
- 不同键 + 当前 revision + 已 revoked → `INVALID_STATE`（不是 duplicate、不是 200）。
- 不同键 + 当前 revision + 允许状态 → 正常撤权（现实中只有 grant 被其它路径恢复才可能，当前无此路径）。
- 并发两个不同键同 revision：一个成功；另一个事务内看到 revision 已 `+1` → `REVISION_CONFLICT`；只有一个 job/audit。

**为什么不返回 duplicate：** 撤权是状态变更，不是“同一结论的重复提交”；不同 key 表示调用方认为是新请求。返回 duplicate 会掩盖“已撤权”事实，也会让调用方误以为可以继续轮询清理。明确 409 更安全。

### 8.3 `cleanupPending` 与 `cleanupJobId`

| 字段 | 类型 | 语义 | 约束 |
|---|---|---|---|
| `cleanupPending` | boolean | grant 已撤销但清理尚未成功完成 | 撤权成功写 `true`；H4-b finalize 成功写 `false`；`terminal_failed`/`awaiting_result` 保持 `true` |
| `cleanupJobId` | string \| null | 清理 job 的不透明指针 | 正常撤权非空；无 job 为 null；不得嵌套 job 对象 |

规则：

1. **`cleanupPending=true` ⇒ `cleanupJobId` 必须非空且指向存在的 revoke job。** 如果 grant 已 revoked、`cleanupPending=true` 但 job 缺失/不属于本 grant/action 不是 revoke → `CLEANUP_SNAPSHOT_REQUIRED/409`，失败关闭；不得返回 null 让客户端以为“没有清理”。
2. **`cleanupPending=false` ⇒ `cleanupJobId` 可以为 null（无 job）或历史指针（有 job 且已成功）。**
3. **正常新撤权：** 必须创建 cleanup job，响应 `cleanupPending=true`、`cleanupJobId` 非空；不允许“新撤权成功但无 job”的旁路。
4. **无 job 的场景：** 只用于已 `revoked` 且确认无 cleanup job 的历史记录/查询投影；此时 `cleanupPending=false`、`cleanupJobId=null`。若历史记录 `cleanupPending` 缺失 → 失败关闭，不推定 false（Q7）。
5. **旧 job 指针：** 不因清理成功而清空 `cleanupJobId`；它保留为历史指针，便于审计/对账；不得复用给新 grant。
6. **不透明：** 客户端不得解析 `job-revoke-v1:` 前缀、不得用 job ID 推导 revision/state、不得构造 job ID。

### 8.4 必要 cleanup job：同事务创建（Q4）

正常撤权事务（单事务）写集：

| 集合 | 写 | 说明 |
|---|---|---|
| `device_access_grants/<grantId>` | 1 | `state:"revoked"`、`cleanupPending:true`、`cleanupJobId:jobId`、`revokedAt`、`revokedByActorId`、`revision:N+1`、`updatedAt` |
| `device_operation_jobs/<jobId>` | 1 | `action:"revoke"`、`state:"queued"`、`cleanupPhase:"dispatch"`、`providerOutcome:null`、`finalizeAttempts:0`、`attempts:0`、`executionMode:"test"`、`provider:"mock"`、`evidenceScope:"simulated"`、`cleanupSnapshot` 16 字段 |
| `device_operation_logs/<logId>` | 1 | 确定性 queued 日志 |
| `operation_keys/<opKey>` | 1 | §7.3 记录 |
| `operation_key_domains/<head/version>` | 0–2 | 首次创建 |
| `admin_audit/<auditId>` | 1 | 确定性审计，§9 |

不写：`face_credentials`、`access_devices`、`device_claims`、`grant_slot_claims`、`device_claim_release_guards`、任何 Provider/设备。资源释放只由 H4-b finalize 在清理成功时处理（[H4-c §8.1](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L416-L426)）。

**“必要”的判定：**

- 当前 `createGrant` 产生的 grant 总有 slot/claim/guard 绑定，因此正常撤权必须创建 job；这是“必要”。
- 已 `revoked` 的 grant 不再创建 job；不同键按 §8.2 返回冲突。
- 历史/人工数据如果确认无 job 且 `cleanupPending=false`，只读投影 null；不允许用“无 job”绕过清理写路径。
- 若未来批准“无需清理”的 grant 类型，必须另立卡定义；本卡不新增旁路。

**job ID：** `job-revoke-v1:<digest([orgId, grantId])>`（沿用当前确定性 ID）。若该 ID 已被占用：

- 同键同摘要重放：op key 分支先返回，不检查 job。
- 不同键：revision/state 先失败，通常到不了 job 检查；若状态仍允许但 job 已被占用 → `CONFLICT/409`，零写；不得覆盖或复用旧 job。

### 8.5 撤权之后的 job 阶段（Provider/派发）

| 阶段 | 驱动者 | 是否属于 E05 HTTP | 行为 |
|---|---|---|---|
| `queued` | 撤权事务 | 是（只创建） | 事务提交后返回；HTTP 不派发 |
| `sending` | H4-b `dispatch`（LocalStore+Mock） | 否 | 60 秒租约；Provider 调用在事务外；只 Mock |
| `succeeded` | H4-b finalize | 否 | grant `cleanupPending=false`；slot/claim 按 H4-b 规则释放；Provider 只 Mock |
| `retryable_failed` | H4-b dispatch/finalize | 否 | 30/120/600 秒退避；attempt 4 耗尽 |
| `terminal_failed` | H4-b terminal | 否 | 资源不释放；`cleanupPending` 保持 true；不自动重试 |
| `awaiting_result` | H4-b `unknown`/`expire` | 否 | `UNKNOWN_RESULT`；禁止自动重试/普通 requeue；只能 E08 人工对账（blocked） |
| `cancelled` | 仅 queued/retryable_failed 的取消路径 | 否 | 撤权路径不使用；不得用 cancel 绕过清理 |

**E05 HTTP 的成功不表示清理完成。** 它只表示 grant 已撤销、cleanup job 已入队。客户端必须看 `cleanupPending`，而不是轮询 job 或重发撤权；不得自动重试、不得定时器、不得回调推动 job。

**Provider 0 边界：** E05 HTTP 事务内 Provider 调用 0；H4-b dispatch/finalize 是独立本地清理器，只允许 LocalStore + Mock；live/Cloud/真实 Provider/设备连接一律 `NOT_CONFIGURED/503`（[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L188-L191)）。

### 8.6 运行模式 gate（BC-09）

撤权事务前必须确认：

- Store 是 LocalStore（或未来批准的等价测试 Store）；
- `executionMode === "test"`；
- `provider === "mock"`；
- `evidenceScope === "simulated"`。

任一不满足 → `NOT_CONFIGURED/503`，零写，不创建 grant 更新/job/log/op key/audit。不得像当前服务那样无条件写 `test/mock` job 到 live 环境。

### 8.7 `UNKNOWN_RESULT`：禁止自动重试

- `awaiting_result` 没有自动出边；`retry`/普通 `requeue`/调度器/定时器/回调/客户端轮询都不得把它推回 `queued`/`sending`。
- 普通 `requeue` 只接受 `retryable_failed && cleanupPhase==="dispatch"`，且需 `device.operation.retry` 与 `expectedJobRevision`；这不是 E05 的入口。
- E05 不得提供“重新撤权”来推动清理；已 revoked + revision 当前 → `INVALID_STATE`；revision 过期 → `REVISION_CONFLICT`。
- 唯一人工收敛是 E08 reconcile（`device.operation.reconcile`），当前 blocked；H4-c C2/C3 未开始。
- 失败/未知时 `cleanupPending` 保持 true；UI 显示“清理中/清理失败”，不得显示“已生效/可通行”，不得自动重发。

### 8.8 并发与线性化

| 竞争 | 线性化点 | 结果 | 写 |
|---|---|---|---|
| 两个不同键、同 `expectedGrantRevision` | grant revision CAS | 一胜 200；另一 `REVISION_CONFLICT/409` | 一次 X |
| 同键并发 | op key 唯一 ID + 事务 | 一胜；另一重放同 result；核心写一次 | 一次 X |
| 撤权 vs H4-b finalize | grant state/revision + H4-b job CAS | 状态互斥；撤权只从非 revoked 开始；finalize 只从 retryable_failed/finalize 开始 | 各自 |
| 撤权 vs createGrant 同 slot | slot/guard CAS + grant 状态 | 一胜；不误放 claim；失败方零写 | 各自 |
| 撤权 vs 权限撤销 | 事务内成员复核 | 403；零写 | 0 |
| 撤权 vs 查询 | 查询只读 | 查询看到提交前/后之一；不改变 grant | 0 |
| 同键、不同 actor | op key 作用域不同 | 不互相重放；按 grant CAS 一胜 | 一次 X |
| 撤权 vs 旧 job 残留 | job 确定性 ID 预占 | `CONFLICT/409`；零写 | 0 |

**线性化点：** grant `revision` CAS 是撤权业务状态的唯一线性化点；op key 唯一 ID/事务是重放的线性化点；job/log/audit 确定性 ID 是防止重复写的第二道闸。HTTP 不提供跨请求事务，也不允许“先读后写”绕过事务内复核。

## 9. 审计契约

### 9.1 审计记录字段

撤权成功必须在同一事务写**恰好一条**确定性审计。建议字段（未来编码卡扩展 Store 审计 schema）：

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `_id` / `auditId` | string | 确定性 ID，见 §9.2 | 不超过 128 字符 |
| `orgId` | string | 当前组织 | 不返回给未授权方 |
| `actorId` | string | 当前会话 actor | 不写姓名/工号/邮箱 |
| `actorType` | string | 固定 `"user"`（HTTP） | 不接受 body actor |
| `action` | string | 固定 `"撤销门禁授权"` | 不拼接 reasonCode/自由文本 |
| `reasonCode` | string | 五值枚举，见 §6 | 只在此处持久化 |
| `grantId` | string | grant 指针 | 1–128 有界 ID |
| `cleanupJobId` | string \| null | 清理 job 指针；无 job 为 null | 不透明 |
| `cleanupJobRevision` | number \| null | job 创建时 revision，通常 1；无 job 为 null | 正整数 |
| `expectedGrantRevision` | number | 客户端 CAS 基准 | 正安全整数 |
| `grantRevision` | number | 撤权事务写入的 `N+1` | 正安全整数 |
| `at` | number | 服务端时间，安全整数毫秒 | 不接受客户端时间 |
| `requestId` | string \| null | 服务端生成的关联 ID（可选） | 不接受客户端指定 |

**最小要求：** actor、reasonCode、grant/job 指针、时间、revision 五类信息必须在审计中可追溯。`requestId` 是可选关联，不是必须；如果 Store 暂不支持，不得用随机字符串冒充确定性审计。

### 9.2 审计 ID 与重放语义

```text
auditId = "audit-h4-revoke-v1:" +
  SHA-256( stableStringify([
    orgId,
    grantId,
    expectedGrantRevision,
    reasonCode,
    actorId
  ]) )
```

| 情形 | 审计行为 |
|---|---|
| 首次成功提交 | 写 1 条；ID 由上述公式确定性生成 |
| 同键同摘要重放 | 写 0 条；校验审计存在且字段匹配；不新增、不改写 |
| 同键异摘要 | 在 K2 层 `CONFLICT/409`；不进入审计写 |
| 不同键、已撤销/revision 过期 | 在 revision/state 层失败；不进入审计写 |
| 不同 actor 同 raw key | op key 作用域不同；只有 grant CAS 成功者写 1 条；失败方零写 |
| 审计 ID 已被占用 | `CONFLICT/409`；整事务回滚；不得覆盖 |
| 同键重放但审计缺失/字段不符 | `CONFLICT/409`；零写；视为审计链损坏 |
| 任意失败路径 | 0 条审计 |

**为什么审计 ID 不含原始 key：** 原始 key 是敏感凭据；审计 ID 用业务字段 + actor 派生，既能确定性去重，又不需要存储/暴露原始 key。不同 key 的同请求会得到相同审计 ID，但该请求在第一次提交后已无法再次成功（revision/state 冲突），所以不会误合并两条成功审计。

**审计不可变：** 审计记录 create-only；不更新、不删除、不回填 reasonCode。旧审计保留原样，读取侧把缺失 reasonCode 显示为 legacy/null。

### 9.3 Store 扩展要求（BC-06）

当前 Store 的确定性审计输入白名单只有 `auditId/orgId/actorId/actorType/action`（[store.mjs](../../admin-web/lib/store.mjs#L51-L57)），`auditRecord` 只写 action/target/createdAt（[store.mjs](../../admin-web/lib/store.mjs#L116-L126)）。因此 07C 的审计字段**当前无法落地**。

未来编码卡必须：

1. 扩展 `AUDIT_INPUT_FIELDS` 与 `auditRecord`，支持 `reasonCode/grantId/cleanupJobId/cleanupJobRevision/expectedGrantRevision/grantRevision/at/requestId`。
2. 保持旧调用方兼容：未提供新字段时写 `null` 或不写，不改变现有审计 ID/行为。
3. 保持确定性审计只能由 Store 写入，业务代码不得直接写 `admin_audit`。
4. 对新增字段做有界校验：ID ≤128、枚举精确、revision 正安全整数、时间安全整数。
5. 不把原始请求、异常 message/stack、Idempotency-Key、requestDigest、op key、PII 写入审计。

该扩展是编码卡 P0 门槛，不是本卡可执行改动。

### 9.4 审计禁止内容

- 原始请求体、完整 header、Cookie、CSRF token、Idempotency-Key。
- 异常 message/stack、SQL、文件路径、Provider 请求/响应、设备序列号/MAC/IP。
- 姓名、地址、手机号、证件号、邮箱、账号、工号。
- 图片字节、objectKey、checksum、人脸特征/质量值。
- requestDigest、operation key、K1/K2/K3 密钥、任何 32 字节 Base64/64 位 hex 密钥材料。
- 自由文本 reason/note/comment。

审计只允许：固定 action、reasonCode 枚举、ID 指针、revision、时间、actor 不透明 ID、requestId（可选）。

## 10. 响应 DTO 与 HTTP 语义

### 10.1 成功响应

**HTTP 200**，使用 07A 统一成功信封（[07A §2.3](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L275-L295)）：

```json
{
  "data": {
    "grantId": "<opaque-grant-id>",
    "grantState": "revoked",
    "grantRevision": 8,
    "cleanupPending": true,
    "cleanupJobId": "<opaque-job-id>"
  },
  "requestId": "uuid"
}
```

| 字段 | 类型 | 成功撤权值 | 说明 |
|---|---|---|---|
| `grantId` | string | 请求 grant | 不透明 ID |
| `grantState` | string | 固定 `"revoked"` | 撤权后的业务状态 |
| `grantRevision` | number | `N+1` | 撤权事务写入的 revision |
| `cleanupPending` | boolean | `true` | 清理尚未成功完成 |
| `cleanupJobId` | string | 非空不透明 job ID | 正常撤权必须有 job；无 job 的历史查询才 null |

**精确五字段。** `data` 不得有第六个字段；不得嵌套 job/operation/audit 对象。

### 10.2 禁止出现在响应中的字段

- `jobId`（旧名）、`evidenceScope`（旧 result 字段）。
- `jobState`、`cleanupPhase`、`attempts`、`leaseGeneration`、`leaseOwner`、`leaseExpiresAt`、`providerOutcome`、`finalizeAttempts`、`result`（job 结果）。
- `requestDigest`、`opKey`、`operationKey`、`operation` 嵌套对象、`idempotencyKey`。
- `reasonCode`（只进审计）、`actorId`、`orgId`、`credentialId`、`deviceId`、`personId`、`claimId`、`slotId`、`snapshot`。
- `createdAt`、`updatedAt`、`revokedAt`、`revokedByActorId`。
- `duplicate`、`nextCursor`、`error`、`stack`、`trace`。
- 任何 PII、设备信息、原始请求、异常文本、配置值、密钥。

### 10.3 状态码

| 场景 | HTTP | 说明 |
|---|---:|---|
| 首次撤权成功 | 200 | `data` 五字段；`cleanupPending=true` |
| 同键同摘要重放 | 200 | 首次 result 投影；零写 |
| 已撤权不同键、revision 过期 | 409 | `REVISION_CONFLICT` |
| 已撤权不同键、revision 当前 | 409 | `INVALID_STATE` |
| 未注册/当前运行时 | 404/405 | 不进入业务；E05 blocked |
| 202 | **不使用** | 撤权业务已提交，cleanup 用 `cleanupPending` 表达；202 会暗示未完成/可轮询 |
| 201 | **不使用** | 201 只用于 E01 新建凭证（07A §2.3） |
| 422 | **不使用** | 07A 明确 422 不用于任何人脸端点 |

不返回 `Retry-After`；不返回 `Location`；不返回重定向。

### 10.4 失败响应

使用 07A 错误信封（[07A §2.4](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L297-L313)）：

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "授权已变化，请刷新后重试"
  },
  "requestId": "uuid"
}
```

- 失败响应不得包含 `data`、`nextCursor`、`duplicate`。
- `message` 固定、非敏感、中文短语；不拼接字段值、ID 原文、reasonCode 原文、异常 message/stack。
- 401/Origin/CSRF 403 沿用现有 `{error:string}` 形状，不进入 v2 业务信封（07A §2.1）。
- 未预期异常 → `ADAPTER_UNAVAILABLE/503`，只记录 `error.code || error.name`；不得 500、不得返回 stack。

### 10.5 响应头

| Header | 值 |
|---|---|
| `Content-Type` | `application/json; charset=utf-8` |
| `Cache-Control` | `no-store` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `X-Frame-Options` | `DENY` |
| `requestId` | 响应体中的 UUID；不另设客户端可控头 |

## 11. 错误矩阵

### 11.1 端点级错误表

| HTTP | code | 条件 | 写 | 备注 |
|---:|---|---|---:|---|
| 400 | `PARAM_ERROR` | body 非对象/数组/null；缺 `grantId`/`expectedGrantRevision`/`reasonCode`；未知顶层/嵌套字段；body 与 path `grantId` 不一致；grantId 非法；revision 非正安全整数；reasonCode 非枚举/自由文本；Content-Type 错误；JSON 畸形；Idempotency-Key 缺失/非法/重复/在 body/query；query 参数存在 | 0 | 不创建 op key/audit/job |
| 401 | 现有登录门 | 无会话 | 0 | 现有形状 |
| 403 | 现有 Origin/CSRF | Origin 不匹配/CSRF 不符 | 0 | 现有形状，不进入业务 |
| 403 | `FORBIDDEN` | 缺 `device.access.manage`；组织停用；成员停用；actorType 非 user；事务内权限撤销 | 0 | 不泄露 grant 存在性 |
| 404 | `NOT_FOUND` | 组织/成员不存在或不可见 | 0 | 消息“组织或成员不存在或不可见” |
| 404 | `NOT_FOUND` | grant 不存在/跨组织/事务内消失 | 0 | 消息“授权不存在或不可见” |
| 409 | `REVISION_CONFLICT` | `expectedGrantRevision` 合法但不等于当前 grant revision（stale/超前）；事务内绑定字段变化；并发失败方 | 0 | Q2 先 revision |
| 409 | `INVALID_STATE` | grant 已 `revoked` 且 revision 当前；grant state 未知/损坏；grant revision 缺失/非法/溢出 | 0 | 不是 400；不是 duplicate |
| 409 | `CLEANUP_SNAPSHOT_REQUIRED` | credential/device/claim/slot/guard 缺失/损坏/绑定不一致；已 revoked 且 `cleanupPending=true` 但 job 缺失/不属于本 grant | 0 | 当前服务同码 |
| 409 | `CONFLICT` | 同 key 异摘要；op key 记录/result 损坏；job/log/audit 确定性 ID 预占；旧 `face.revoke` key 不兼容 | 0 | 不覆盖旧记录 |
| 409 | `DOMAIN_INCOMPLETE` | K2 domain head/version 单边缺失或损坏 | 0 | 当前 K2 机制 |
| 409 | `DOMAIN_MISMATCH` | K2 换钥/版本/fingerprint 不符 | 0 | 当前 K2 机制 |
| 413 | `PARAM_ERROR` | body >65536 字节 | 0 | 不得落为 503 |
| 503 | `NOT_CONFIGURED` | K2 配置缺失/非法；运行模式非 LocalStore/Mock/test；live/Cloud/真实 Provider | 0 | 不发起网络/设备调用 |
| 503 | `ADAPTER_UNAVAILABLE` | Store/clock 异常；未预期异常 | 0 | 不返回 stack/message |
| 404/405 | — | E05 当前未注册；任何方法/路径未匹配 | 0 | 当前运行时事实；不进入业务 |

### 11.2 明确不由 E05 产生的 code

| code | 归属 | 原因 |
|---|---|---|
| `CAPACITY_EXCEEDED/400` | H4-b finalize / 候选预扫 | 当前 revoke 无 pre-scan；82/90 由 H4-b 处理；若 Codex 要求 E05 预扫，另立编码项（BC-11） |
| `INVALID_JOB/409` | H3/H4 job 查询/派发 | E05 请求不读取 job 字段；job 损坏不会作为撤权错误返回；清理侧自行失败关闭 |
| `FILE_NOT_FOUND`/`FILE_CHANGED` | E01/E04 | 撤权不读人脸文件 |
| `EVIDENCE_*`/`RECONCILE_*` | E08/E09 | E05 不接收证据、不做对账 |
| `RETRY_NOT_DUE`/`LOCAL_FINALIZE_EXHAUSTED` | H4-b/E08/E09 | 清理阶段内部；E05 不暴露重试/恢复 |
| `DEVICE_CLAIM_INVALID`/`GRANT_SLOT_CONFLICT` | createGrant/finalize | 撤权只复核绑定，不释放/不占用 slot/claim；绑定损坏统一 `CLEANUP_SNAPSHOT_REQUIRED` |

### 11.3 零副作用定义

| 记号 | 含义 | 适用 |
|---|---|---|
| `Z` | 全库内容级零变化：grant/job/log/audit/operation key/domain/credential/device/claim/slot/guard 全部不变 | 所有失败/重放路径 |
| `X` | 允许的成功写集：grant 1 + job 1 + log 1 + op key 1 + domain 0–2 + audit 1 | 首次成功 |
| `P0` | Provider 调用入口增量 0 | 所有 E05 路径 |
| `Zc` | 业务核心不变；仅 audit 可能追加 | 本卡不使用；E05 重放连 audit 也不写，故用 `Z` |

- 失败路径不得写 audit；不得“先写 audit 再回滚”；事务抛出即整事务回滚。
- 重放路径不得写 audit/job/log/op key/domain；只读 op key 并返回 result。
- 503 路径不得写任何业务记录；不得先写 domain/op key 再报配置错误。
- 任何路径不得返回 500/stack/配置值；未预期异常统一 503 `ADAPTER_UNAVAILABLE`。

## 12. 测试设计（75 条未来契约测试）

### 12.1 记号与 harness

| 记号 | 含义 |
|---|---|
| `Z` | 全库内容级零变化：grant/job/log/audit/operation key/domain/credential/device/claim/slot/guard 全部不变 |
| `X` | 允许的成功写集：grant 1 + job 1 + log 1 + op key 1 + domain 0–2 + audit 1 |
| `P0` | Provider 调用入口增量 0 |
| `本卡不执行` | 这些是未来契约测试；当前分支只写文档，不启动 server、不发 HTTP、不跑测试 |

**未来 harness（编码卡实现）：**

- LocalStore 临时目录；禁止 Cloud/live/真实 Provider/设备。
- HTTP 用 `createApp` 临时端口；Cookie + CSRF + Origin 登录；每例先固化基线快照，再比较。
- 服务层用例直接构造 `FaceCredentialService`；HTTP 用例只在 E05 注册后执行。
- 敏感扫描对响应体、日志、audit、grant/job 记录执行固定正则；零命中才 PASS。
- 每个失败用例同时断言无 500、无 stack、无配置值、无 Provider 调用。
- 并发用例用两个独立 service/HTTP 会话，`Promise.allSettled` 后比较最终快照。

### 12.2 权限与组织（RCP01–RCP06）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| RCP01 | 成员显式 `device.access.manage`；grant pending；正确 revision/body/key | 200；`grantState=revoked`；`cleanupPending=true`；`cleanupJobId` 非空 | 0 | X |
| RCP02 | 成员无 `device.access.manage`（其它权限齐全） | 403 `FORBIDDEN`；不读 grant、不写 | 0 | Z |
| RCP03 | `admin` 角色但 `permissions` 不含 `device.access.manage` | 403 `FORBIDDEN`；角色不隐含权限 | 0 | Z |
| RCP04 | 组织停用，或成员停用/不存在（按 07A 映射） | 组织/成员停用 403；成员不存在 404；均零写 | 0 | Z |
| RCP05 | grant 属于其它组织；与不存在 grant 对比 | 两者均 404 `NOT_FOUND`，消息一致“授权不存在或不可见” | 0 | Z |
| RCP06 | 外层权限检查通过后，事务 callback 内删除/停用成员或移除权限 | 403 `FORBIDDEN`；事务回滚；零写 | 0 | Z |

### 12.3 请求 DTO（RCD01–RCD12）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| RCD01 | body 缺 `grantId`（path 有） | 400 `PARAM_ERROR`；不进入业务 | 0 | Z |
| RCD02 | body `grantId` 与 path 不一致 | 400 `PARAM_ERROR`；不按任一 ID 查询 | 0 | Z |
| RCD03 | 未知字段 `credentialId`/`deviceId`/`orgId`/`actorId`/`idempotencyKey`/`reason`/`metadata` | 400 `PARAM_ERROR`；逐字段拒绝 | 0 | Z |
| RCD04 | 嵌套对象/数组：`metadata.reasonCode`、`reason.text`、`evidence{}` | 400 `PARAM_ERROR`；不递归接受 | 0 | Z |
| RCD05 | body 为数组、null、字符串、数字 | 400 `PARAM_ERROR` | 0 | Z |
| RCD06 | `Idempotency-Key` 缺失；15/129 位；含空格/`/`；重复头 | 400 `PARAM_ERROR`；不创建 op key | 0 | Z |
| RCD07 | `Idempotency-Key` 放在 body 或 query | 400 `PARAM_ERROR`；只有 header 合法 | 0 | Z |
| RCD08 | 缺 `expectedGrantRevision` | 400 `PARAM_ERROR` | 0 | Z |
| RCD09 | revision 为 0、-1、1.5、`"7"`、`true`、null、`1e309`（Infinity）、`2^53` | 全部 400 `PARAM_ERROR`；不进入业务 | 0 | Z |
| RCD10 | reasonCode 缺失、未知值、大小写漂移、前后空格、连字符 | 全部 400 `PARAM_ERROR`；不做别名/归一化 | 0 | Z |
| RCD11 | reasonCode 为自由句子、姓名/手机号/证件号/设备序列号/异常 stack | 400 `PARAM_ERROR`；敏感扫描零命中 | 0 | Z |
| RCD12 | Content-Type 非 JSON；JSON 畸形；body >65536；任意 query 参数 | Content-Type/畸形/query → 400；超限 → 413 `PARAM_ERROR`；均零写 | 0 | Z |

### 12.4 revision 与状态（RCV01–RCV11）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| RCV01 | grant revision N；发送 N-1（stale） | 409 `REVISION_CONFLICT`；不写 | 0 | Z |
| RCV02 | 发送 N+1（future） | 409 `REVISION_CONFLICT`；不写 | 0 | Z |
| RCV03 | grant pending，revision N；发送 N | 200；grant `revoked`、revision N+1 | 0 | X |
| RCV04 | grant effective/suspended/expired，revision N；发送 N | 均 200；grant `revoked`、revision N+1 | 0 | X |
| RCV05 | 已 revoked、当前 revision N+1；不同 key 发送 N+1 | 409 `INVALID_STATE`；不写；不返回 duplicate | 0 | Z |
| RCV06 | 已 revoked、当前 revision N+1；不同 key 发送 N（stale） | 409 `REVISION_CONFLICT`（revision 先于 state） | 0 | Z |
| RCV07 | 已 revoked，`cleanupPending=true` 和 `false` 两种；当前 revision；不同 key | 两者均 409 `INVALID_STATE`；不新建 job | 0 | Z |
| RCV08 | grant 记录 `revision` 缺失/0/字符串/小数/非安全整数 | 409 `INVALID_STATE`；失败关闭；不推定 1 | 0 | Z |
| RCV09 | grant revision = `MAX_SAFE_INTEGER` | 409 `INVALID_STATE`；不溢出写 | 0 | Z |
| RCV10 | 两个不同 key 并发，均发送 N | 一个 200；另一个 409 `REVISION_CONFLICT`；仅一个 job/audit | 0 | 一次 X |
| RCV11 | 同 key 并发两次，均发送 N | 两个 200，同 result 投影；核心写一次；audit 一条 | 0 | 一次 X |

### 12.5 幂等与 K2（RCI01–RCI13）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| RCI01 | 首次成功后同 key 同 body 重放 | 200；同一五字段 result；无新 job/audit/op key | 0 | Z |
| RCI02 | 同 key，`grantId` 改为另一合法 grant | 409 `CONFLICT`；不覆盖 op key；不改另一 grant | 0 | Z |
| RCI03 | 同 key，`expectedGrantRevision` 改为另一值 | 409 `CONFLICT`；不覆盖 | 0 | Z |
| RCI04 | 同 key，reasonCode 改为另一枚举 | 409 `CONFLICT`；reasonCode 绑定摘要 | 0 | Z |
| RCI05 | 同 raw key，不同 actor；并发/顺序各一 | 不互相重放；grant CAS 一胜；失败方按 revision/state 409 | 0 | 一次 X |
| RCI06 | 同 raw key 先用于 E01/E03，再用于 E05 | K2 method 不同；互不重放；各自结果独立 | 0 | 各自 |
| RCI07 | 首次成功后把 op key `result` 改成 null/数组/少字段/多字段/错 `grantId` | 409 `CONFLICT`；零写；不返回旧值 | 0 | Z |
| RCI08 | op key 的 `orgId/realm/keyVersion/createdAt/requestDigest` 任一损坏 | 409 `CONFLICT`；零写；不重建 | 0 | Z |
| RCI09 | 注入旧 `face.revoke` op key：旧 digest `{grantId}`、旧 result 五字段 | 新请求同 raw key → 409 `CONFLICT`；不迁移、不解释旧值 | 0 | Z |
| RCI10 | 首次成功后模拟 H4-b finalize 成功（grant N+2/false）；同 key 重放 | 200；仍返回首次 N+1/true；零写；查询返回 N+2/false | 0 | Z |
| RCI11 | 首次成功后删除/篡改对应 audit；同 key 重放 | 409 `CONFLICT`；零写；视为审计链损坏 | 0 | Z |
| RCI12 | 删除/非法化 K2 配置 | 503 `NOT_CONFIGURED`；零写；不创建 op key | 0 | Z |
| RCI13 | K2 domain 单边缺失/损坏；或换钥/fingerprint 不符 | 409 `DOMAIN_INCOMPLETE` 或 `DOMAIN_MISMATCH`；零写 | 0 | Z |

### 12.6 状态、job 与绑定（RCS01–RCS11）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| RCS01 | 正常撤权：pending grant、完整绑定、正确 body/key | 单事务写 grant（revoked/N+1/cleanupPending true/cleanupJobId）、job queued、log、op key、domain 0–2、audit；Provider 0 | 0 | X |
| RCS02 | 预先占用确定性 job ID | 409 `CONFLICT`；整事务回滚；grant 不变 | 0 | Z |
| RCS03 | 预先占用确定性 queued log ID | 409 `CONFLICT`；整事务回滚 | 0 | Z |
| RCS04 | credential/device/claim/slot/guard 缺失、结构损坏 | 409 `CLEANUP_SNAPSHOT_REQUIRED`；零写 | 0 | Z |
| RCS05 | credential person、device claimId、claim device、slot activeClaimId/cycleId、guard claimId 任一不一致 | 409 `CLEANUP_SNAPSHOT_REQUIRED`；零写 | 0 | Z |
| RCS06 | 运行配置 live/cloud/非 Mock/非 LocalStore | 503 `NOT_CONFIGURED`；零写；无网络/设备调用 | 0 | Z |
| RCS07 | 时钟返回非安全整数/负数/抛错 | 503 `ADAPTER_UNAVAILABLE`；零写 | 0 | Z |
| RCS08 | 撤权成功后把 job 置 `awaiting_result`（模拟 UNKNOWN_RESULT）；同 key 重放 / 不同 key 当前 revision | 重放返回首次投影；不同 key → `INVALID_STATE`；不新建 job；不自动 retry；不调 Provider | 0 | Z |
| RCS09 | 清理进入 `terminal_failed`；不同 key 当前 revision | 409 `INVALID_STATE`；cleanupPending 保持 true；不自动 retry；E08 未注册 | 0 | Z |
| RCS10 | 模拟 H4-b finalize 成功：grant N+2、cleanupPending false；查询/重放 | 查询返回 N+2/false；重放返回 N+1/true；无新 job/audit | 0 | Z |
| RCS11 | 当前运行时访问 E05 路径/方法 | 404/405；不进入业务；零写；Provider 0 | 0 | Z |

### 12.7 审计（RCA01–RCA06）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| RCA01 | 首次成功 | 恰好一条 audit；含 actorId/actorType/action/reasonCode/grantId/cleanupJobId/cleanupJobRevision/expectedGrantRevision/grantRevision/at | 0 | X |
| RCA02 | 成功审计扫描 | 无原始请求、异常 message/stack、Idempotency-Key、requestDigest、op key、PII、设备序列号/MAC/IP、图片/objectKey | 0 | X |
| RCA03 | 同 key 同摘要重放 | audit 数量不变；不新增、不改写 | 0 | Z |
| RCA04 | 预先占用确定性 audit ID | 409 `CONFLICT`；整事务回滚；grant/job 不变 | 0 | Z |
| RCA05 | 首次成功后删除/篡改 audit；同 key 重放 | 409 `CONFLICT`；零写 | 0 | Z |
| RCA06 | 读取旧 `audit-h4-v1` 记录（无 reasonCode） | 只读兼容；missing 显示 legacy/null；不回填、不拒绝 | 0 | Z |

### 12.8 响应与权威查询（RCR01–RCR09）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| RCR01 | 首次成功响应 | `data` 精确五字段；无 `jobId/evidenceScope/jobState/lease/requestDigest/opKey/actor/org/PII` | 0 | X |
| RCR02 | 首次成功 `cleanupJobId` | 非空不透明字符串；不嵌套 job；不暴露 job 状态 | 0 | X |
| RCR03 | 查询已 revoked、cleanupPending false、无 job 的历史 grant | 200；`cleanupJobId=null`；`cleanupPending=false`；`grantRevision` 合法 | 0 | Z |
| RCR04 | 查询已 revoked、cleanupPending true、cleanupJobId 缺失/指向不存在/非本 grant job | 409 `CLEANUP_SNAPSHOT_REQUIRED`；不返回 null 掩盖 | 0 | Z |
| RCR05 | 查询已 revoked、cleanupPending false、cleanupJobId 指向损坏/非 succeeded job | 409 `CLEANUP_SNAPSHOT_REQUIRED`；失败关闭；不把损坏指针当 null | 0 | Z |
| RCR06 | 查询非 revoked grant，cleanupPending/cleanupJobId 缺失 | 200；`cleanupPending=false`、`cleanupJobId=null`；revision 必须合法 | 0 | Z |
| RCR07 | 查询 grant revision 缺失/非法/0/字符串/非安全整数 | 409 `INVALID_STATE`；不返回 DTO | 0 | Z |
| RCR08 | 查询缺 `device.access.manage`；跨组织 grant | 缺权限 403；跨组织 404 同态 | 0 | Z |
| RCR09 | 首次/重放成功状态码 | 200；不返回 201/202；无 `Retry-After`/`Location` | 0 | X/Z |

### 12.9 并发、零副作用与敏感字段（RCC01–RCC07）

| ID | 前置/注入 | 预期 | Provider | 写集 |
|---|---|---|---|---:|
| RCC01 | 撤权与 H4-b finalize 同 grant 并发 | 撤权只从非 revoked 开始，finalize 只从 retryable_failed/finalize 开始；状态互斥；无重复 job/释放 | 0 | 各自合法写 |
| RCC02 | 撤权与 createGrant 争同一 slot/guard | 一胜；失败方 409；不误放 claim、不产生第二个 active slot | 0 | 各自合法写 |
| RCC03 | 权限撤销与撤权并发 | 事务内复核失败 403；零写；无部分 job/audit | 0 | Z |
| RCC04 | 遍历所有失败路径（400/403/404/409/503） | 全库 Z；Provider 0；无 500/stack/配置值；无部分写 | 0 | Z |
| RCC05 | 成功/重放/失败响应、audit、log、job 扫描 | 无原始 key、requestDigest、op key、reason 自由文本、PII、设备序列号/MAC/IP、图片/objectKey、异常文本 | 0 | X/Z |
| RCC06 | 请求注入姓名/手机号/证件号/设备序列号/异常文本（含 reasonCode 与未知字段） | 400 `PARAM_ERROR`；零写；敏感扫描零命中 | 0 | Z |
| RCC07 | 静态：本分支范围 | 仅本文件变更；`server.mjs`/`routes.mjs`/服务/测试零差异；E05 未注册；无 Provider/设备调用；无 H4-c C2/C3 | 0 | Z |

### 12.10 覆盖与数量

| 系列 | 编号 | 条数 | 覆盖 |
|---|---|---:|---|
| RCP | RCP01–RCP06 | 6 | 权限、角色不隐含、组织/成员、跨组织同态、事务内撤权 |
| RCD | RCD01–RCD12 | 12 | 严格 body、未知字段、header-only key、revision/reasonCode 类型、大小/Content-Type |
| RCV | RCV01–RCV11 | 11 | stale/current/future revision、四种可撤状态、已 revoked 同/不同键、并发 |
| RCI | RCI01–RCI13 | 13 | 同键同摘要、异摘要、跨 actor/端点、损坏、旧 key、重放后清理、K2 配置/domain |
| RCS | RCS01–RCS11 | 11 | 同事务 job、job/log 预占、绑定、运行模式、UNKNOWN_RESULT/terminal/finalize、未注册 |
| RCA | RCA01–RCA06 | 6 | 审计字段、隐私、重放、预占、缺失、旧审计 |
| RCR | RCR01–RCR09 | 9 | 最小 DTO、cleanupJobId null、查询失败关闭、权限/跨组织、状态码 |
| RCC | RCC01–RCC07 | 7 | 并发、零副作用、敏感扫描、静态范围 |
| **合计** | — | **75** | 超过 40 条最低要求；编号连续、无重复 |

**测试阶段：** 除 RCC07 可静态执行外，其余 74 条是未来契约测试，必须在服务改造 + 权威查询 + 迁移 + HTTP 注册后执行；本卡不执行、不宣称通过。

## 13. 接线门槛（Q8）

### 13.1 门槛表

| 门槛 | 内容 | 当前状态 | 未满足的后果 |
|---|---|---|---|
| G1 Codex 裁定 | Q1–Q8 逐条写回裁定；明确接受基线冲突处理 | blocked | 不得进入编码 |
| G2 服务实现 | `revoke` 改严格输入、K2 新摘要/result、审计字段、revision 先于 state、运行模式 gate、grant 查询方法 | blocked | E05 仍不可接线 |
| G3 数据迁移 | 旧 `face.revoke` op key 盘点/归档；Store 审计 schema 扩展；老 grant revision/cleanup 字段修复策略 | blocked | 旧数据可能 409；不得自动补写 |
| G4 权威查询 | `queryGrant` 服务 + 未来 HTTP 读取（如批准）+ UI 每次重查 | blocked | 客户端无合法 revision |
| G5 测试 | 75 条矩阵、故障/并发/敏感扫描、零副作用；服务层 + HTTP 层 | blocked | 不得宣称通过 |
| G6 HTTP 编码卡 | `server.mjs`/`routes.mjs` 注册、信封、CSRF、错误映射；只注册 E05，不夹带 E07/E08/E09 | blocked | 不得注册 |
| G7 Codex 明确解锁 | 对 G1–G6 结果复审并写“可接线” | blocked | 本卡及任何编码卡不得自行解锁 |
| G8 永久关闭项 | live/Cloud/真实 Provider/设备、H4-c C2/C3、E08/E09、`main` 合并 | 关闭 | 不得借 E05 开口 |

### 13.2 接线顺序

```text
G1 Codex 裁定
  → G2 服务实现 + 单测
  → G3 数据迁移/审计 schema（独立卡）
  → G4 权威查询 + UI（独立卡）
  → G5 75 条契约测试（服务层 + HTTP 层）
  → G6 HTTP 注册编码卡（只 E05）
  → G7 Codex 复审解锁
  → 才可讨论上线
```

任何一步失败都回到 blocked；不得跳步、不得合并 G2/G3/G6 到一张卡、不得在 E05 卡里顺带实现 retry/reconcile/finalize-retry。

### 13.3 当前必须保持关闭

- `server.mjs` 不注册 `/api/v2/device-access-grants/:grantId/revoke`；当前 404/405。
- `routes.mjs` 不改；E05 描述行仍是描述，不是注册依据。
- 不调用 Provider、不连接设备、不写 Cloud/live。
- 不开始 H4-c C2/C3；不实现 reconcile/finalize-retry；不注册 E08/E09。
- 不合并 `main`；不 force push；不改用户已有改动。

## 14. 待 Codex 裁定：Q1–Q8

> 以下全部是**建议**。在 Codex 写回“裁定”前，不得当作已批准；即使批准，也不解除 E05 blocked（§13 G7 仍需单独解锁）。

### Q1 reasonCode 枚举粒度与权限归属

**问题：** reasonCode 用多大枚举？是否按原因拆权限？是否允许 `OTHER`？

**建议：**

- 五值最小业务枚举：`REVOKE_USER_REQUEST`、`REVOKE_ADMIN_ACTION`、`REVOKE_SECURITY_RISK`、`REVOKE_DEVICE_CHANGE`、`REVOKE_COMPLIANCE`。
- 五值统一使用 `device.access.manage`；不新增权限、不按原因拆权限、不因 `SECURITY_RISK` 升级权限。
- 不设 `OTHER`；新增原因必须另立设计。
- 新 HTTP 必填；历史记录可为 null/legacy；未知值 400。

**理由：**

- 覆盖人工撤权主要动因，又不把自由文本塞进枚举。
- 统一权限符合 07A §1.6“不新增权限点”、§5.1 权限正交（[07A §5.1](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L867-L879)）。
- 若按原因拆权限，会制造“安全风险撤权需要额外权限”的授权漏洞或审批旁路；reasonCode 只是审计标签，不是授权依据。
- `OTHER` 会退化为自由文本，违反“禁止自由文本/PII”。

**基线依据/冲突：** 07A Q4/Q5 要求冻结枚举、长度字符、持久化、审计、敏感禁入、历史兼容；当前代码无 reasonCode（§1.2）。H4 原设计 `revokeReason` 是 grant 字段且五值不同（BC-08），本建议不沿用。

**若否决：** 若要求更大枚举或按原因拆权限，必须给出每个值的权限矩阵、审计映射、隐私边界；E05 仍 blocked。

### Q2 已 revoked / 不同键：不是 duplicate，先 revision 后 state

**问题：** 已撤权 grant 收到不同 key 请求时返回 200 duplicate、`INVALID_STATE` 还是 `REVISION_CONFLICT`？顺序是什么？

**建议：**

- 同 key 同摘要：200 重放首次 result；零写。
- 不同 key：**不是 duplicate**；不返回 `duplicate:true`。
- 先比较 `expectedGrantRevision` 与当前 `grant.revision`：
  - 不相等 → 409 `REVISION_CONFLICT`；
  - 相等且 `state==="revoked"` → 409 `INVALID_STATE`；
  - 相等且状态允许 → 正常撤权。
- 并发两个不同 key：一胜；另一 `REVISION_CONFLICT`。

**理由：**

- 撤权是状态变更，不是“同结论重复提交”；duplicate 只属于 H4-c reconcile 的终态重复语义（[H4-c §7.2](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L393-L410)）。
- 先 revision 后 state 让客户端能区分“我拿的是旧版本”与“我已经撤过了”：前者刷新后重试，后者不应重试。
- 若先 state，则所有不同 key 都返回 `INVALID_STATE`，客户端无法知道是 revision 过期还是状态终态；也不利于并发诊断。
- 现有服务/测试先 state 后 revision（BC-03/BC-10），本建议要求编码卡改顺序与测试。

**基线依据/冲突：** 当前服务第 687 行先 state、688 行后 revision；现有测试期望不同键 `INVALID_STATE`（[face-service-layer.test.mjs](../../admin-web/tests/face-service-layer.test.mjs#L366-L396)）。这是明确的 P0 超驰点。

**若否决：** 若 Codex 坚持先 state，则 stale 请求也返回 `INVALID_STATE`；必须写清客户端无法区分 revision 过期，且 Q2 的“明确状态冲突”目标未达成。E05 仍 blocked。

### Q3 权威同组织 grant 查询 DTO

**问题：** `expectedGrantRevision` 从哪里来？是否新增 grant 读取端点/服务方法？权限是什么？字段是什么？

**建议：**

- 新增 `queryGrant(grantId)` 服务方法，权限 `device.access.manage`，同组织。
- DTO 精确五字段：`grantId/grantState/grantRevision/cleanupPending/cleanupJobId`。
- 未来 HTTP `GET /api/v2/device-access-grants/:grantId`，仅提案，不注册；需 Codex 单独批准与独立编码卡。
- revision 必须正安全整数；缺失/非法失败关闭；revoked 且 `cleanupPending=true` 但 job 缺失 → 409 `CLEANUP_SNAPSHOT_REQUIRED`。
- 跨组织/不存在 404 同态；无 body/无 Idempotency-Key；no-store。

**理由：**

- 没有权威读取，E05 的 `expectedGrantRevision` 只能是伪契约；07A §3.6 已明确这一点（[07A §3.6](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L755-L760)）。
- E02 是 credential revision，E06 是 job 且 blocked；不能冒充 grant revision。
- 复用 `device.access.manage` 避免新增权限；授权人本来就能管理 grant，读取 revision 不扩大权限。
- 五字段与撤权响应共用同一投影，减少客户端分叉；但查询是当前值，撤权响应是首次 receipt，语义分开。

**基线依据/冲突：** 07A §4.2 未列 `GET /api/v2/device-access-grants/:grantId`；这是新增读取提案，不是九端点之一（BC-02）。若 Codex 不允许新增路径，E05 无法获得权威 revision，必须继续 blocked。

**若否决：** E05 永久 blocked；不得用列表行、credential revision、job revision、缓存或时间戳替代。

### Q4 必要 cleanup job 同事务创建

**问题：** 撤权是否必须同时创建 cleanup job？什么情况可以不创建？job 是否可与 grant 分开事务？

**建议：**

- 正常可撤 grant（当前所有 createGrant 产生的 grant）必须**同一事务**创建 cleanup job：grant 更新 + job + log + op key + domain + audit。
- job 确定性 ID `job-revoke-v1:<digest([orgId,grantId])>`；create-only；已占用 → `CONFLICT/409`。
- 已 revoked 不创建新 job；不同键按 Q2 冲突。
- 无 job 只用于已 revoked 且确认无 cleanup job 的历史/查询投影；新撤权成功不允许无 job 旁路。
- Provider 0；job 只入队，不派发。

**理由：**

- 分开事务会出现“grant 已撤销但 job 没建”的半状态，客户端无法清理；同事务保证原子性。
- 先建 job 再改 grant 或反过来都会留下可观察的中间态；必须同一 `store.transact`。
- 确定性 ID + create-only 是并发/重放的第二道闸；job/log/audit 预占失败整事务回滚。
- Provider 调用必须在事务外且只在 H4-b dispatcher；E05 不调用 Provider。

**基线依据/冲突：** 当前服务已经同事务创建 job（[service.mjs](../../admin-web/lib/face-service/service.mjs#L713-L726)）；但当前无条件创建 test/mock job（BC-09）。H4-b finalize 要求 job/snapshot 绑定（BC-07）。

**若否决：** 若允许分开事务或无 job 成功，必须定义补偿、对账、半状态展示与失败关闭；否则不能接线。

### Q5 仅最小不透明 `cleanupJobId`，无 job 则 null

**问题：** 响应里的 job 指针叫什么？能否返回 job 对象/状态/attempts？无 job 怎么表示？

**建议：**

- 字段名 `cleanupJobId`，类型 `string | null`；正常撤权为非空不透明 ID；无 job 为 null。
- 只返回 ID；不返回 job 对象、`jobState`、`cleanupPhase`、`attempts`、`lease`、`providerOutcome`、`result`。
- 不保留旧 `jobId` 别名；不返回 `evidenceScope`。
- `cleanupPending=true` ⇒ `cleanupJobId` 必须非空且 job 存在/属于本 grant；否则 409 失败关闭。
- 客户端不得解析 `job-revoke-v1:` 前缀、不得构造 job ID、不得用 job ID 推 revision/state。

**理由：**

- job 内部字段（lease/attempts/result）会泄露调度/Provider 细节，且随清理阶段变化；撤权响应只需“有没有清理、清理 job 是谁”。
- 旧 `jobId` 与 H4-c reconcile 的 `jobId` 语义不同；保留别名会让客户端误用。
- null 只应表示“确实没有 job”，不能表示“job 丢失”；后者必须 409。

**基线依据/冲突：** 旧 result 有 `jobId`、`evidenceScope`（BC-04）；H4-b finalize 要求 `cleanupJobId===jobId`（BC-07）。新 DTO 直接替换，不保留旧字段。

**若否决：** 若要求返回 job 状态/attempts，必须另立“job 读取”契约并处理与 E06 的关系；E05 仍 blocked。

### Q6 reasonCode 仅审计，摘要绑定

**问题：** reasonCode 存哪里？是否写 grant/job/response？是否进 requestDigest？

**建议：**

- reasonCode 只写确定性审计；不写 grant、不写 job、不写 job.result、不写 log、不写响应。
- reasonCode 进入 `requestDigest` 三字段之一；同 key 不同 reasonCode → `CONFLICT/409`。
- 审计保存 reasonCode + 固定 action；不保存自由文本/姓名/设备信息/异常文本。
- job.result.reasonCode 继续是 H3/H4/H4-c 的服务端执行原因；两者命名空间分开。

**理由：**

- 业务原因属于审计证据，不属于授权状态；写 grant/job 会让业务记录携带可变的用户输入，扩大隐私面。
- 不绑定摘要会让同 key 改写原因而仍重放旧成功结果，审计与请求不一致。
- 与 job 执行原因同名不同义，必须明确分离，防止编码时误写。

**基线依据/冲突：** H3/H4/H4-c 的 job.result.reasonCode 是执行原因（BC-05）；H4 原设计 `revokeReason` 落 grant（BC-08）；07A 禁止未冻结接收（BC-14）。本建议是 07C 的冻结候选。

**若否决：** 若要求 reasonCode 落 grant/job 或响应，必须给出字段白名单、迁移、隐私扫描与历史兼容；否则不能接线。

### Q7 老 grant revision 缺失失败关闭，不推定默认值

**问题：** 老 grant 没有 revision/cleanup 字段时，是否默认 1/false/null？是否自动修复？

**建议：**

- revision 缺失/非法/0/负数/小数/字符串/非安全整数 → 409 `INVALID_STATE`，失败关闭。
- 不 `?? 1`、不 `Number()`、不取整、不回退缓存/时间戳/创建顺序。
- 已 revoked 且 `cleanupPending` 缺失 → 失败关闭；非 revoked 缺失 `cleanupPending` 可按 false 投影（它不是 revision，且未撤权时语义确定）。
- `cleanupPending=true` 但 job 缺失 → 409 `CLEANUP_SNAPSHOT_REQUIRED`。
- 修复只能走受控迁移/修复卡；不自动补写、不删除、不重算。

**理由：**

- revision 是 CAS 安全边界；默认 1 会把损坏数据变成可撤权，可能撤错版本。
- cleanup 字段缺失意味着无法判断是否已清理；默认 false 会误导 UI 显示“已清理”。
- 失败关闭符合 07A/H4-c 的“不猜测、不自动迁移”原则（[H4-c §10](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L475-L491)）。

**基线依据/冲突：** 当前 grant 无字段白名单，旧记录可能缺字段（BC-16）；H4-b finalize 已要求 cleanupPending true/cleanupJobId 匹配（BC-07）。本建议比当前更严格，是编码卡要补的失败关闭。

**若否决：** 若要求默认值/自动修复，必须证明不会撤错版本、不会掩盖未清理状态，并给出迁移审计；否则不能接线。

### Q8 门槛与 Codex 明确解锁后才可接线

**问题：** 什么条件下可以从文档进入服务/HTTP 编码？

**建议：**

- 必须依次完成 §13 G1–G7：Codex 裁定、服务实现、数据迁移/审计 schema、权威查询+UI、75 条测试、HTTP 编码卡、Codex 复审解锁。
- G8 永久关闭项不得借 E05 开口：live/Cloud/真实 Provider/设备、H4-c C2/C3、E08/E09、`main` 合并。
- 任何一步未通过都保持 blocked；不得“先注册再补测试”。
- 本卡不执行任何门槛，只写门槛。

**理由：**

- E05 是写操作，涉及 grant 状态、cleanup job、审计与幂等；任一缺口都可能造成错撤/漏清理/审计缺失。
- 07A 已明确 Codex 裁定不等于 HTTP 编码批准（[07A §10](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L1245-L1260)）；本卡必须延续该边界。
- 数据迁移与审计 schema 是跨卡改动，不能夹在 E05 服务卡里。

**基线依据/冲突：** 07A §4.3 注册门禁、§10.1 未完成项（[07A §10.1](HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md#L1262-L1272)）；H4-c §16 后续门禁。本卡不修改这些门禁。

**若否决：** 若要求提前编码/注册，必须由 Codex 明确写“超驰 07A 门禁”，并承担未迁移/未测试/未审计风险；否则不得接线。

## 15. 交付验证

### 15.1 验证命令

```text
git diff --check
git show --stat --oneline HEAD
git diff --stat 2f597e3..HEAD
git diff --name-only 2f597e3..HEAD
git status --porcelain=v1
# 相对链接：解析本文档所有非 http(s) 链接，确认文件存在、行号在文件范围内
# GitHub 链接：解析 blob/<sha>/<path>，确认 sha 与 path 在本地仓库存在
# 敏感扫描：云厂商密钥、私钥块、口令/密钥/令牌赋值、32 字节 Base64、64 位 hex、手机号、身份证号
# 范围断言：server.mjs/routes.mjs/服务/测试零差异；E05 未注册
git ls-remote origin refs/heads/docs/hk-face-revoke-contract-hardening
```

### 15.2 验证结果

| 项目 | 预期 | 实测 |
|---|---|---|
| `git diff --check` | 无输出 | `git diff --cached --check` 无输出（exit 0） |
| 变更文件 | 仅本 Markdown | `git diff --cached --stat` 为 1 file changed；仅本文件 |
| 相对链接 | 全部存在；行号在范围内 | 110 条相对链接，0 错误；0 条行号越界 |
| GitHub 链接 | commit + path 存在 | 3 条 GitHub 链接，0 错误 |
| 敏感扫描 | 0 命中 | 13 类正则，0 命中 |
| 代码/测试零差异 | 是 | 暂存区仅本文件；服务/测试/`server.mjs`/`routes.mjs` 无暂存改动 |
| 远端 SHA | 与本地 HEAD 一致 | push 后在最终回报核对；本文档不自引用远端 SHA |

### 15.3 工具限制记录

如果 push/ls-remote 因本机凭据、代理、TLS 或沙箱限制失败，必须在最终回报中给出具体命令、退出码与错误原文，不得声称已推送。相对链接/敏感扫描/`git diff --check` 仍须在本地完成并记录。

## 16. 本卡不做的事

- 不修改任何 JavaScript、测试、`server.mjs`、`routes.mjs`、`store.mjs`、`collections.mjs`、`h4b.mjs`、`h4c-evidence.mjs`。
- 不注册 E05 或任何 HTTP 路径；不调用应用 HTTP。
- 不调用 Provider、不连接设备、不写 Cloud/live。
- 不开始 H4-c C2/C3；不实现 retry/reconcile/finalize-retry；不注册 E08/E09。
- 不合并 `main`；不 force push；不改用户已有改动。
- 不执行数据迁移、不补写旧 grant/audit/operation key。
- 不新增权限名、状态名、错误码、decision、`evidenceScope` 值。
- 不把本卡的建议写成“已批准”；E05 继续 blocked。

## 附录 A：请求/响应示例（占位符，不含真实值）

**请求：**

```http
POST /api/v2/device-access-grants/<opaque-grant-id>/revoke
Content-Type: application/json
Idempotency-Key: <16-128-char-key>
X-CSRF-Token: <session-csrf>
X-Org-Id: <opaque-org-id>

{
  "grantId": "<opaque-grant-id>",
  "expectedGrantRevision": 7,
  "reasonCode": "REVOKE_ADMIN_ACTION"
}
```

**成功 200：**

```json
{
  "data": {
    "grantId": "<opaque-grant-id>",
    "grantState": "revoked",
    "grantRevision": 8,
    "cleanupPending": true,
    "cleanupJobId": "<opaque-job-id>"
  },
  "requestId": "<uuid>"
}
```

**冲突 409：**

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "授权已变化，请刷新后重试"
  },
  "requestId": "<uuid>"
}
```

**权威查询 200（当前投影）：**

```json
{
  "data": {
    "grantId": "<opaque-grant-id>",
    "grantState": "revoked",
    "grantRevision": 9,
    "cleanupPending": false,
    "cleanupJobId": "<opaque-job-id>"
  },
  "requestId": "<uuid>"
}
```

## 附录 B：公式汇总

```text
jobId          = "job-revoke-v1:" + SHA-256( stableStringify([orgId, grantId]) )
requestDigest  = SHA-256( stableStringify({grantId, expectedGrantRevision, reasonCode}) )
opKey          = HMAC-derived operation key (orgId + "face.revoke" + actorType + actorId + raw key)
auditId        = "audit-h4-revoke-v1:" + SHA-256( stableStringify([
                   orgId, grantId, expectedGrantRevision, reasonCode, actorId
                 ]) )
```

- `stableStringify`：对象键排序、无多余空白、UTF-8；数组保持顺序。
- 所有 SHA-256/HMAC 输出为 64 位小写十六进制；不得把原始 key/密钥写入任何记录。
- `jobId`/`auditId` 是确定性 ID；`opKey` 是 HMAC 派生 ID；三者都不等于原始 Idempotency-Key。

## 附录 C：追溯矩阵

| 要求 | 本卡位置 | 测试 |
|---|---|---|
| 严格 body 三字段、未知字段拒绝 | §4.2、§4.4 | RCD01–RCD12 |
| Idempotency-Key header-only | §4.3 | RCD06–RCD07 |
| revision 正安全整数、仅权威查询 | §5.2–§5.5 | RCV01–RCV11、RCR07 |
| stale `REVISION_CONFLICT/409`、缺失非法 `PARAM_ERROR/400` | §5.3 | RCV01–RCV02、RCD08–RCD09 |
| reasonCode 五值枚举、权限、审计用途 | §6.1–§6.3 | RCD10–RCD11、RCA01 |
| 禁止自由文本/PII/设备/异常 | §6.5 | RCD11、RCC05–RCC06 |
| 历史兼容 | §6.4、§9.2 | RCA06、RCI09 |
| K2 独立 method、精确摘要、重放/异摘要 | §7.1–§7.5 | RCI01–RCI13 |
| operation key 严格 result、不存原始 key | §7.3–§7.4、§7.7 | RCI01–RCI11、RCC05 |
| 权限、事务内复核、跨组织 404、权限撤销立即失败 | §3.2–§3.4 | RCP01–RCP06 |
| 状态机、已 revoked 同/不同键、cleanupPending | §8.1–§8.3 | RCV05–RCV07、RCS08–RCS10 |
| job 同事务创建 | §8.4 | RCS01–RCS03 |
| Provider/派发后续阶段、UNKNOWN_RESULT 禁自动重试 | §8.5–§8.7 | RCS08–RCS09、RCC01 |
| 审计 actor/reasonCode/grant/job/时间/revision | §9.1–§9.3 | RCA01–RCA05 |
| 审计 ID 重放语义 | §9.2 | RCA03–RCA05、RCI11 |
| 最小 DTO 五字段、禁止内部字段 | §10.1–§10.2 | RCR01–RCR02、RCR09 |
| operation/result 指针 | §7.4 | RCI01–RCI11 |
| 错误矩阵与零副作用 | §11 | RCC04 |
| 并发 | §8.8 | RCV10–RCV11、RCC01–RCC03 |
| 敏感字段 | §6.5、§9.4 | RCC05–RCC06 |
| 接线门槛 | §13、§14 Q8 | RCC07（静态） |

## 附录 D：基线提交

| 名称 | 分支 | 提交 |
|---|---|---|
| 07A HTTP 契约终审 | `docs/hk-face-http-wiring-design` | `2f597e33acb3563d92cafd2d70ac238a27d796dc` |
| H4-b 终审代码 | `feat/hk-face-h4b-mock-cleanup` | `1155b7ba65991d324fb8b22bb8f7dd87f49428f9` |
| H4-c 设计 | `docs/hk-face-h4c-reconciliation-design` | `b15acebe0a8049f316797bbbd2692c55de25d111` |
| 当前撤权服务/测试 | `feat/hk-face-h4c-reconciliation` | `90e4189717e21a5d458b09da34677ef29795c767` |
| H4 历史草案（仅参考） | `docs/hk-face-h4-revoke-reconcile-design` | `9fd088da57a1400e4e5fcaaf367b787b2e371dac`（`HK-AI-04-H4-REVOKE-RECONCILE-DESIGN.md`） |

> 注：H4 历史草案只作为“旧 bodyless 说法/旧 reason 字段”的反例引用，不构成本卡基线；其 `face.grant.revoke` 名称与 `revokeReason` 落 grant 均未采用。
