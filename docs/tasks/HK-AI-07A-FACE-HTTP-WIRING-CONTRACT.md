# HK-AI-07A 门禁 HTTP 接线契约与测试矩阵

设计提案，待 Codex 复审。**本卡只写文档：不注册路由、不调用业务 HTTP、不修改 `server.mjs`、不接 Provider、不连接设备、不修改服务层生产代码、不新增权限名或状态名。**

- 服务基线：`feat/hk-face-h4b-mock-cleanup` @ `1155b7ba65991d324fb8b22bb8f7dd87f49428f9`
- H4-c 设计基线：`docs/hk-face-h4c-reconciliation-design` @ `b15acebe0a8049f316797bbbd2692c55de25d111`
- 本轮分支：`docs/hk-face-http-wiring-design`
- 现有路由提案：[routes.mjs](../../admin-web/lib/face-service/routes.mjs#L6-L60)
- 现有 HTTP 信封：[server.mjs](../../admin-web/server.mjs#L431-L438)
- H4-c 对账/恢复契约：[H4-c 设计](HK-AI-04-H4C-RECONCILIATION-DESIGN.md)
- 边界：本卡只冻结“未来接线必须满足的 HTTP 契约”。所有端点在本卡合并后仍然关闭；注册与调用必须另发编码卡。

## 0. 结论与冻结摘要

### 0.1 冻结的九个端点

| ID | Method | Path | Permission | 幂等 | 本卡结论 |
|---|---|---|---|---|---|
| E01 | POST | `/api/v2/face-credentials` | `device.face.submit` | 必须 | 路径、DTO、状态冻结；继续关闭 |
| E02 | GET | `/api/v2/face-credentials/review-queue` | `device.face.review` | 不适用 | 路径、DTO 冻结；继续关闭 |
| E03 | POST | `/api/v2/face-credentials/:credentialId/review` | `device.face.review` | 必须 | 路径、DTO、状态冻结；继续关闭 |
| E04 | GET | `/api/v2/face-credentials/:credentialId/image` | `device.face.readPrivate` | 不适用 | 私密读取契约冻结；继续关闭 |
| E05 | POST | `/api/v2/device-access-grants/:grantId/revoke` | `device.access.manage` | 必须 | 路径、DTO 冻结；仅 Mock/Local 可接线，继续关闭 |
| E06 | GET | `/api/v2/device-operation-jobs` | `device.audit.read` | 不适用 | 路径/权限冻结；读模型 P0 缺口，继续关闭 |
| E07 | POST | `/api/v2/device-operation-jobs/:jobId/retry` | `device.operation.retry` | 必须 | DTO 冻结；K2 缺口，继续关闭 |
| E08 | POST | `/api/v2/device-operation-jobs/:jobId/reconcile` | `device.operation.reconcile` | 必须 | H4-c b15aceb 提案固定；等待终审与实现，继续关闭 |
| E09 | POST | `/api/v2/device-operation-jobs/:jobId/finalize-retry` | `device.operation.reconcile` | 必须 | H4-c b15aceb 提案固定；等待终审与实现，继续关闭 |

**没有 `POST /api/v2/device-access-grants`（createGrant）路径。** 现有路由表没有该路径，本卡也不新增；`createGrant` 仍只作为服务层入口存在。

### 0.2 五个必须先解决的 P0 缺口

| 编号 | 缺口 | 影响 | 本卡处理 |
|---|---|---|---|
| P0-1 | `publicJobResult` 不返回 `revision`，E06 也没有详情路由 | E07/E08/E09 的 `expectedRevision` 无权威来源，端点不可操作 | E06-E09 继续关闭；附录 A 给出读模型修正提案，需另行批准 |
| P0-2 | `H4MockRevoker.requeue` 与 `H3B.requeue` 没有 K2 operation key | 同键重放会变成 `INVALID_JOB`，无法满足 Idempotency-Key | E07 继续关闭；K2 method 名先冻结，编码卡补服务层 K2 |
| P0-3 | H4-a 的 `revoke(grantId)` 不接受 `expectedRevision`/`reasonCode` | 与 H4 设计文档的 Q01 草案不一致 | E05 按已实现的 bodyless 契约冻结；若要求 `expectedRevision`，须另开服务层卡 |
| P0-4 | H4-c 尚未实现 | E08/E09 没有任何生产代码 | 只冻结 H4-c 设计稿契约；等待 H4-c 实现卡 |
| P0-5 | 人脸图片端点没有 `credentialId -> sourceFileId` 的 HTTP 解析层 | E04 不能直接复用文件下载路由 | 冻结解析顺序与 404 同态；编码卡实现，不改 `FileService` |

### 0.3 三条不可协商的安全结论

1. 跨组织、资源不存在、私密文件无权限，统一同态 `404`；不得返回 `403` 泄露资源存在性。
2. 权限点只从当前组织成员记录的 `permissions` 读取；`admin` 角色不隐含 `device.face.review`、`device.face.readPrivate` 或任何 `device.*` 权限。
3. `awaiting_result` 只能被只读查询和人工对账观察/收敛；`retry`、调度器、定时器、回调、客户端轮询都不得把它推回 `queued` 或 `sending`。

## 1. 输入与追溯

| 输入 | 固定版本/位置 | 冻结内容 |
|---|---|---|
| H1 终审 | [`6bfe1ba`](https://github.com/1997dmsu-sketch/SMART-PM/blob/de07fc48ecc3e355cd04c0d3f1d544aba5ddaa8b/docs/tasks/HK-AI-04-H1-FINAL-APPROVAL-6BFE1BA-2026-11-07.md) | submit/review/queue/query 的权限、组织隔离、`expectedRevision` 与 409 语义 |
| H2-b 终审 | [`2bc10e3`](https://github.com/1997dmsu-sketch/SMART-PM/blob/e9e8544d641e93b0d4164280477b00664f465e76/docs/tasks/HK-AI-04-H2B-FINAL-APPROVAL-2BC10E3-2026-11-08.md) | owner claim、设备归属与 `DEVICE_CLAIM_INVALID` 语义 |
| H2-c C4 终审 | [`feaa1e0`](https://github.com/1997dmsu-sketch/SMART-PM/blob/86e5c9f86576e0a502c1f0aa7e8ffd5dffb06627/docs/tasks/HK-AI-04-H2C-C4-FINAL-APPROVAL-FEAA1E0-2026-11-11.md) | createGrant 资格、黑名单、90 refs 与 `CAPACITY_EXCEEDED` |
| H2-d 终审 | [`90cc848`](https://github.com/1997dmsu-sketch/SMART-PM/blob/f97489fb00ad605edf893653614a5707722a89da/docs/tasks/HK-AI-04-H2D-FINAL-APPROVAL-90CC848-2026-11-12.md) | 全链验收、内容级零写与敏感扫描口径 |
| H3 契约 | [H3 设计](HK-AI-04-H3-LEASE-DISPATCH-DESIGN.md#L77-L125) | 租约、fence、`UNKNOWN_RESULT`、人工重试与退避 |
| H4 契约 | [`9fd088d`](https://github.com/1997dmsu-sketch/SMART-PM/blob/9fd088da57a1400e4e5fcaaf367b787b2e371dac/docs/tasks/HK-AI-04-H4-REVOKE-RECONCILE-DESIGN.md) | 撤权、清理、证据引用与终态对账边界；其 Q04 的 `evidenceRefs` 已被 H4-c 取代 |
| H4-b 终审 | [H4-b 证据](HK-AI-04-H4B-EVIDENCE-2026-11-13.md) | LocalStore+Mock 清理、finalize、82/83 与 90 refs |
| H4-c 设计 | [H4-c 设计](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L80-L118) | 三种 decision、K3、evidence head、`finalize-retry`、错误映射与测试矩阵；b15aceb 仍标注“待 Codex 批准”，本卡按其作为提案输入，不视为已终审 |
| 路由表 | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L6-L60) | 路径与权限的唯一冻结来源 |
| 权限目录 | [org.mjs](../../admin-web/lib/org.mjs#L95-L104) | 七个 `device.*` 权限点，无新增 |
| DTO/状态 | [dto.mjs](../../admin-web/lib/face-service/dto.mjs#L59-L91)、[state.mjs](../../admin-web/lib/face-service/state.mjs#L27-L40) | 不透明 ID、幂等键、job 状态机 |
| 服务实现 | [service.mjs](../../admin-web/lib/face-service/service.mjs#L199-L319)、[service.mjs](../../admin-web/lib/face-service/service.mjs#L652-L736) | submit/review/queue/revoke/query 的写集与错误 |
| H4-b 实现 | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L35-L45)、[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L475-L517) | revoke job 字段、finalize/requeue |
| 文件契约 | [files.mjs](../../admin-web/lib/files.mjs#L1045-L1094)、[files.mjs](../../admin-web/lib/files.mjs#L767-L835) | 私密下载、`device.face.readPrivate`、404 同态 |
| v2 信封 | [server.mjs](../../admin-web/server.mjs#L431-L438)、[API-CONTRACT.md](../database/API-CONTRACT.md#L7-L13) | `{data,requestId}` / `{error:{code,message},requestId}` |

## 2. 全局接线规则

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
7. 成员存在但缺权限：`FORBIDDEN/403`。
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
| 对账/恢复已受理但未完成 | 202 | 只用于 E08/E09 的 pending 投影 |
| 图片成功 | 200 | 二进制，不用 JSON 信封 |
| 列表分页 | 200 | 仅 E06 可带 `nextCursor` |

- `data` 必须是端点节冻结的对象/数组；不得把内部 job、evidence、grant 记录原样返回。
- 201 只用于 E01；E05 是动作，返回 200。
- 202 不表示“稍后自动重试”；不得附加 `Retry-After`，见 §5。

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
| `PARAM_ERROR` | 400 | DTO/枚举/未知字段/ID/时间/分页参数非法 | 0 |
| `CAPACITY_EXCEEDED` | 400 | 撤权前预扫 candidate ≥83 | 0 |
| `UNAUTHORIZED` | 401 | 仅用于 v2 内部统一说明；实际 401 由 server 登录门返回 | 0 |
| `FORBIDDEN` | 403 | 权限、成员、组织失效 | 0 |
| `NOT_FOUND` | 404 | 组织内不可见/不存在/跨组织同态 | 0 |
| `FILE_NOT_FOUND` | 404 | 私密文件不存在、跨组织、非 ready、无读权限 | 0 |
| `REVISION_CONFLICT` | 409 | credential/grant/job/head CAS 失败 | 0 |
| `INVALID_STATE` | 409 | 当前状态不允许该动作 | 0 |
| `INVALID_JOB` | 409 | revoke/enroll job 字段或阶段非法，含 retry 的 revision/状态不符 | 0 |
| `CONFLICT` | 409 | K2 摘要/结果损坏、确定性 ID 预占 | 0 |
| `FILE_CHANGED` | 409 | 人脸来源文件 revision 变化 | 0 |
| `CLEANUP_SNAPSHOT_REQUIRED` | 409 | 老 job/缺 snapshot/绑定不符 | 0 |
| `DEVICE_CLAIM_INVALID` | 409 | claim/slot/guard 损坏 | 0 |
| `DEVICE_CLAIM_CONFLICT` | 409 | 设备归属冲突 | 0 |
| `CLAIM_RELEASE_GUARD_REQUIRED` | 409 | 设备释放 guard 缺失/损坏 | 0 |
| `GRANT_SLOT_CONFLICT` | 409 | 授权槽位冲突 | 0 |
| `EVIDENCE_REQUIRED` | 409 | evidence 缺失 | 0 |
| `EVIDENCE_INVALID` | 409 | evidence 结构/短码/sourceType 不匹配 | 0 |
| `EVIDENCE_STALE` | 409 | observedAt 过期、未来或非递增 | 0 |
| `EVIDENCE_HEAD_CONFLICT` | 409 | evidence head CAS 失败 | 0 |
| `EVIDENCE_CHAIN_BROKEN` | 409 | previous evidence/链/域不一致 | 0 |
| `RECONCILE_THROTTLED` | 409 | `still_unknown` 间隔小于 60 秒 | 0 |
| `RECONCILE_LIMIT` | 409 | `still_unknown` 已达 8 次 | 0 |
| `RECONCILE_CONFLICT` | 409 | 已终态但 decision 不同 | 0 |
| `RECONCILE_GENERATION_CONSUMED` | 409 | finalize-retry 指向已消费旧 revision | 0 |
| `DOMAIN_INCOMPLETE` | 409 | K2/K3 domain 单边缺失/损坏 | 0 |
| `DOMAIN_MISMATCH` | 409 | K2/K3 换钥、版本或 fingerprint 不符 | 0 |
| `RETRY_NOT_DUE` | 409 | 未到 `nextAttemptAt` | 0 |
| `LOCAL_FINALIZE_EXHAUSTED` | 200/409 | 终态投影或错误入口 | 0 |
| `NOT_CONFIGURED` | 503 | K2/K3/Provider/运行模式缺失或非法 | 0 |
| `STORAGE_UNAVAILABLE` | 503 | 文件后端与配置不一致 | 0 |
| `ADAPTER_UNAVAILABLE` | 503 | Store/clock/未预期异常 | 0 |

`LOCAL_FINALIZE_EXHAUSTED` 的 200 与 409 区分：作为 E08/E09 的终态投影时 200；作为非法入口/状态判断的一部分时按对应 409。端点节逐项限定。

### 2.6 Idempotency-Key 与 K2

| 规则 | 冻结值 |
|---|---|
| 适用 | E01、E03、E05、E07、E08、E09；所有 POST 必须携带 |
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

| 端点 | K2 method | requestDigest 输入 | result 指针 | 状态 |
|---|---|---|---|---|
| E01 submit | `face.submit` | `{personId, sourceFileId}` | `{credentialId, reviewState}` | 已实现 |
| E03 review | `face.review` | `{credentialId, decision, expectedRevision}` | `{credentialId, reviewState}` | 已实现 |
| E05 revoke | `face.revoke` | `{grantId}` | `{grantId, jobId, grantState, cleanupPending, evidenceScope}` | 已实现 |
| E07 retry | `face.operation.retry` | `{jobId, expectedRevision}` | `{jobId, state, revision}` | **名称冻结，服务层未实现** |
| E08 reconcile | `face.reconcile` | H4-c §7.1 精确字段集，含 `decision/evidence/sourceType/sourceCode/observedAt/evidenceDigest/previousEvidenceId/sequence` | H4-c 稳定指针 | H4-c b15aceb 提案固定，待终审，未实现 |
| E09 finalize-retry | `face.reconcile.finalize` | 精确 `{jobId, expectedRevision}` | `{kind:"finalize_retry",jobId,generationRevision,recoveryId}` | H4-c b15aceb 提案固定，待终审，未实现 |
| 非 HTTP createGrant | `face.grant` | `assertCreateGrantInput` 八字段 | `{grantId,jobId,evidenceScope}` | 仅服务层，不暴露 |

- `face.operation.retry` 是本卡新增的 K2 方法名，不是权限名也不是状态名；它需要与 E07 服务层 K2 改造一起由编码卡批准。
- E08 使用 `face.reconcile` 摘要，E09 使用 `face.reconcile.finalize` 摘要；二者不得互换，也不得把 `face.revoke`/`face.operation.retry` 的摘要复用到对账路径。
- E05 的 digest 只含 `grantId`，与 H4 设计草案的 `{grantId,expectedRevision,reasonCode}` 不同；本卡以已实现的 H4-a/H4-b 为准，见 P0-3。

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
- 禁止把原始 Idempotency-Key、K1/K2/K3 密钥、图片字节、objectKey、Provider 原始响应写入任何记录或响应。

## 3. 端点契约

### E01 `POST /api/v2/face-credentials`

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

### E02 `GET /api/v2/face-credentials/review-queue`

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

字段严格来自 `publicReviewItem`。`submittedAt` 只在记录存在该字段时出现；当前 `submit` 写 `createdAt`，不写 `submittedAt`，因此可能缺省。客户端必须把缺省视为 `null`，不得依赖该字段排序。顺序不属于契约。

**Errors**

| HTTP | code | 条件 |
|---:|---|---|
| 401 | 现有登录门 | 无会话 |
| 403 | `FORBIDDEN` | 缺 `device.face.review`、成员/组织失效 |
| 503 | `ADAPTER_UNAVAILABLE` | Store 不可用 |

**隐私**

队列**不得**返回图片字节、图片 URL、objectKey、checksum、digest、文件名、人脸质量原始值或任何 Provider 数据；只返回审核元数据。

### E03 `POST /api/v2/face-credentials/:credentialId/review`

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
| Body | `expectedRevision` | 安全整数，≥1；**HTTP 必填** |

Body 精确两个字段。服务层当前实现允许省略 `expectedRevision`，HTTP 接线必须拒绝省略：H1 终审已冻结“审核使用 expectedRevision，stale 返回 409”。

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
| 400 | `PARAM_ERROR` | decision 非法、expectedRevision 缺失/非安全整数、未知字段、key 非法 | 0 |
| 403 | 现有 Origin/CSRF | 来源或令牌不符 | 0 |
| 403 | `FORBIDDEN` | 缺 `device.face.review`、成员/组织失效 | 0 |
| 404 | `NOT_FOUND` | 凭证不存在或跨组织 | 0 |
| 409 | `INVALID_STATE` | 凭证不是 `submitted` | 0 |
| 409 | `REVISION_CONFLICT` | revision 不符 | 0 |
| 409 | `CONFLICT` | 同键异摘要或 operation key 损坏 | 0 |
| 503 | `NOT_CONFIGURED` | K2 缺失/非法 | 0 |

**权限分离**

审核只改 `reviewState`，不读取、不返回图片字节；`device.face.review` 不隐含 `device.face.readPrivate`。审核人即使没有读图权限也能通过/驳回。

### E04 `GET /api/v2/face-credentials/:credentialId/image`

| 项目 | 值 |
|---|---|
| 用途 | 按凭证读取唯一人脸原图 |
| Permission | `device.face.readPrivate` |
| 幂等 | 不适用 |
| 成功 | `200` 二进制 |
| Provider | 0 |

**Request**

| 位置 | 字段 | 类型/约束 |
|---|---|---|
| Path | `credentialId` | 不透明 ID |
| Query | 无 | 不接受 `fileId`、`url`、`purpose`、`download` 等参数 |

无 body、无 Idempotency-Key。

**解析顺序**

1. 用当前 `orgId` 读取 `face_credentials/<credentialId>`；不存在/跨组织：`FILE_NOT_FOUND/404`。
2. 取 `credential.sourceFileId`，调用 `FileService.authorizeDownload(fileId, actor)`；该函数按当前成员权限、purpose `face-biometric`、`visibility=private`、`status=ready`、组织归属复核。
3. 仅鉴权通过后读取字节；private 一律代理下载，不签发临时 URL。
4. 写 `file_access` denied/download 留痕；不把文件名、objectKey、摘要写入响应。

**Response 200**

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

**Errors**

| HTTP | code | 条件 | 写 |
|---:|---|---|---:|
| 401 | 现有登录门 | 无会话 | 0 |
| 404 | `FILE_NOT_FOUND` | 凭证不存在/跨组织（尚未解析到 fileId） | 0 |
| 404 | `FILE_NOT_FOUND` | 文件不存在、非 face-biometric、非 private、非 ready、缺 `device.face.readPrivate` | `L`（file_access denied） |
| 503 | `STORAGE_UNAVAILABLE` | 文件存储后端与配置不一致 | 0 |
| 503 | `ADAPTER_UNAVAILABLE` | 读文件/Store 异常 | 0 |

`L` 表示只新增一条 `file_access_log`（denied 或 download）；它不改变凭证、文件、grant、job 等业务集合，也不是“全库零写”。

**关键结论**：缺 `device.face.readPrivate` 返回 **404**，不是 403。原因是文件契约（[files.mjs](../../admin-web/lib/files.mjs#L1045-L1072)）已冻结“无权限与不存在同态”，防止通过 403/404 差异枚举凭证或文件。审核人只有 `device.face.review` 时，调用本端点得到 404。

### E05 `POST /api/v2/device-access-grants/:grantId/revoke`

| 项目 | 值 |
|---|---|
| 用途 | 业务即时撤权并创建 revoke 清理 job |
| Permission | `device.access.manage` |
| 幂等 | 必须，K2 `face.revoke` |
| 成功 | `200` |
| Provider | 0 |

**Request**

| 位置 | 字段 | 类型/约束 |
|---|---|---|
| Path | `grantId` | 不透明 ID |
| Header | `Idempotency-Key` | §2.6 |
| Body | `{}` | 精确空对象；不允许任何字段 |

Body 不接受 `expectedRevision`、`reasonCode`、`reason`、`credentialId`、`deviceId`。H4-a 的已实现入口是 `revoke(grantId,{idempotencyKey})`；它用事务内读到的 grant revision 做 CAS，而不是客户端 expectedRevision。H4 设计 Q01 草案中的 `{expectedRevision,reasonCode}` 未进入 H4-a/H4-b，见 P0-3。

**Response 200**

```json
{
  "data": {
    "grantId": "grant-...",
    "jobId": "job-revoke-v1:...",
    "grantState": "revoked",
    "cleanupPending": true,
    "evidenceScope": "simulated"
  },
  "requestId": "uuid"
}
```

**Errors**

| HTTP | code | 条件 | 写 |
|---:|---|---|---:|
| 400 | `PARAM_ERROR` | grantId 非法、body 非空/非对象、key 非法 | 0 |
| 403 | 现有 Origin/CSRF | 来源或令牌不符 | 0 |
| 403 | `FORBIDDEN` | 缺 `device.access.manage`、成员/组织失效 | 0 |
| 404 | `NOT_FOUND` | 授权不存在或跨组织 | 0 |
| 409 | `INVALID_STATE` | 授权已是 `revoked`，或状态字段损坏；`expired` 仍允许撤权 | 0 |
| 409 | `REVISION_CONFLICT` | grant 在预读后变化、绑定字段变化 | 0 |
| 409 | `CLEANUP_SNAPSHOT_REQUIRED` | 缺少 credential/device/claim/slot/guard 或绑定不一致 | 0 |
| 409 | `CONFLICT` | revoke job/log 确定性 ID 已存在、同键异摘要 | 0 |
| 503 | `NOT_CONFIGURED` | K2 缺失/非法 | 0 |
| 503 | `ADAPTER_UNAVAILABLE` | Store/clock 不可用 | 0 |

**权限与边界**

- 只释放本 grant 的 slot；不释放共享设备的 owner claim。
- `pending/effective/suspended/expired` 均可进入撤权（H4-a 实现允许 `expired`）；只有已 `revoked` 或结构损坏才 `INVALID_STATE`。
- 只写 grant/job/log/op key/op domain/audit；不写 credential/device/claim/slot 释放（H4-b 在清理成功时处理）。
- revoke job 进入 `queued`；本端点不调用 Provider、不连接设备。
- H4-b 的 dispatcher/finalize 是 LocalStore+Mock only；live/Cloud/真实 Provider 下本端点必须 `NOT_CONFIGURED/503`。

### E06 `GET /api/v2/device-operation-jobs`

| 项目 | 值 |
|---|---|
| 用途 | 本组织任务列表；也是当前唯一的任务读取入口 |
| Permission | `device.audit.read` |
| 幂等 | 不适用 |
| 成功 | `200` |
| Provider | 0（`queryOperation` 不在本端点） |

**Request**

| 位置 | 字段 | 类型/约束 |
|---|---|---|
| Query | `state` | 可选；必须是既有 job 状态之一 |
| Query | `action` | 可选；`enroll`/`update`/`revoke` |
| Query | `limit` | 可选；1–100，默认 20 |
| Query | `cursor` | 可选；不透明游标 |
| Query | `orgId` | 仅用于组织上下文，不作为过滤条件 |

禁止 `personId/deviceId/grantId` 任意模糊搜索；不做跨组织聚合。

**Response 200（v0，当前可批准的字段）**

```json
{
  "data": [
    {
      "jobId": "job-...",
      "state": "retryable_failed",
      "attempts": 1,
      "lastSuccessAt": null,
      "failureReason": null
    }
  ],
  "requestId": "uuid",
  "nextCursor": "opaque"
}
```

字段严格来自 `publicJobResult`。**该 DTO 不包含 `revision`、`action`、`cleanupPhase`、`nextAttemptAt`**，因此不能驱动 E07/E08/E09；这是 P0-1。`failureReason` 当前对 H3/H4 job 恒为 `null`（job 写 `result.reasonCode`，不写 `failureReason`），客户端不得据此判断失败原因。

**Errors**

| HTTP | code | 条件 |
|---:|---|---|
| 400 | `PARAM_ERROR` | state/action/limit/cursor 非法 |
| 401 | 现有登录门 | 无会话 |
| 403 | `FORBIDDEN` | 缺 `device.audit.read` |
| 503 | `ADAPTER_UNAVAILABLE` | Store 或游标不可用 |

**实现缺口**：服务层当前只有 `queryJob(jobId)`，没有 `listJobs()`；E06 的路径/权限已冻结，但编码卡必须先补只读列表方法，且不得改变 `publicJobResult` 的既有调用方。

### E07 `POST /api/v2/device-operation-jobs/:jobId/retry`

| 项目 | 值 |
|---|---|
| 用途 | 人工把 `retryable_failed` 且已到期的 job 重排为 `queued` |
| Permission | `device.operation.retry` |
| 幂等 | 必须，K2 `face.operation.retry`（服务层未实现） |
| 成功 | `200` |
| Provider | 0 |

**Request**

| 位置 | 字段 | 类型/约束 |
|---|---|---|
| Path | `jobId` | 不透明 ID |
| Header | `Idempotency-Key` | §2.6 |
| Body | `expectedRevision` | 安全整数，≥1，必填 |

Body 精确一个字段；不接受 `reasonCode`、`force`、`state`、`decision`。

**Response 200**

```json
{
  "data": {
    "jobId": "job-...",
    "state": "queued",
    "revision": 4,
    "nextAttemptAt": null
  },
  "requestId": "uuid"
}
```

**Errors**

| HTTP | code | 条件 | 写 |
|---:|---|---|---:|
| 400 | `PARAM_ERROR` | expectedRevision 缺失/非法、未知字段、key 非法 | 0 |
| 403 | 现有 Origin/CSRF | 来源或令牌不符 | 0 |
| 403 | `FORBIDDEN` | 缺 `device.operation.retry`、成员/组织失效 | 0 |
| 404 | `NOT_FOUND` | job 不存在或跨组织 | 0 |
| 409 | `INVALID_JOB` | 非 `retryable_failed`、`cleanupPhase!=="dispatch"`、attempts≥4、revision 不符、**state=`awaiting_result`** | 0 |
| 409 | `RETRY_NOT_DUE` | `now < nextAttemptAt` | 0 |
| 409 | `CONFLICT` | 确定性 queued log 已存在、同键异摘要 | 0 |
| 503 | `NOT_CONFIGURED` | K2 缺失/非法 | 0 |

**状态边界**

- E07 只接受 `retryable_failed && cleanupPhase==="dispatch"` 的 revoke/enroll job；`awaiting_result` 一律 `INVALID_JOB/409`，对应 H3 D53。
- 人工重试与自动调度共享同一 job revision/log CAS；只能一方提交。
- 重排不调用 Provider，不重置 grant/credential/slot/claim。
- E07 **当前不可接线**：H4-b/H3-b 的 requeue 没有 K2。没有 K2 时，同键重放第二次会变成 `INVALID_JOB`，违反 §2.6。编码卡必须先补 operation key/domain 写入，再注册 E07。

### E08 `POST /api/v2/device-operation-jobs/:jobId/reconcile`

| 项目 | 值 |
|---|---|
| 用途 | H4-c 人工对账：`confirmed_removed`/`confirmed_present`/`still_unknown` |
| Permission | `device.operation.reconcile` |
| 幂等 | 必须，K2 `face.reconcile` |
| 成功 | `200` 或 `202` |
| Provider | 0 |

**Request**

| 位置 | 字段 | 类型/约束 |
|---|---|---|
| Path | `jobId` | 不透明 ID |
| Header | `Idempotency-Key` | §2.6 |
| Body | `jobId` | 必须与 path 完全相同，否则 `PARAM_ERROR/400` |
| Body | `expectedRevision` | 安全整数，1..`Number.MAX_SAFE_INTEGER` |
| Body | `decision` | `confirmed_removed`/`confirmed_present`/`still_unknown` |
| Body | `evidence.sourceType` | 仅 `operator` |
| Body | `evidence.sourceCode` | 与 decision 绑定，见下表 |
| Body | `evidence.observedAt` | 安全整数毫秒；不得晚于服务端 now，不得早于 job 进入 `awaiting_result` 的时间 |

Body 只允许 `jobId`、`expectedRevision`、`decision`、`evidence` 四个顶层字段；`evidence` 只允许三个字段。禁止 `digest`、`raw`、`response`、`payload`、`file`、`evidenceRefs`。

| decision | sourceCode |
|---|---|
| `confirmed_removed` | `OPERATOR_CONFIRMED_REMOVED` |
| `confirmed_present` | `OPERATOR_CONFIRMED_PRESENT` |
| `still_unknown` | `OPERATOR_UNCERTAIN` |

**Response**

| 场景 | HTTP | body 关键字段 |
|---|---:|---|
| `confirmed_removed` R1+R2 成功 | 200 | `jobState=succeeded`、`cleanupPending=false`、`cleanupPhase=complete`、`terminalReason=null` |
| `confirmed_removed` R1 成功、R2 pending | 202 | `jobState=retryable_failed`、`cleanupPending=true`、`cleanupPhase=finalize` |
| `confirmed_removed` 第 4 次耗尽 | 200 | `jobState=terminal_failed`、`cleanupPending=true`、`terminalReason=LOCAL_FINALIZE_EXHAUSTED` |
| `confirmed_present` | 200 | `jobState=terminal_failed`、`cleanupPending=true`、`terminalReason=RECONCILE_CONFIRMED_PRESENT` |
| `still_unknown` | 200 | `jobState=awaiting_result`、`cleanupPending=true`、`cleanupPhase=null`、`terminalReason=null` |
| 不同键同结论的已终态 | 200 | 既有状态 + `duplicate:true` |

```json
{
  "data": {
    "jobId": "job-...",
    "decision": "confirmed_removed",
    "jobState": "succeeded",
    "grantState": "revoked",
    "cleanupPending": false,
    "evidenceId": "h4c-evidence-v1:...",
    "evidenceSequence": 1,
    "decidedAt": 1763000000000,
    "cleanupPhase": "complete",
    "terminalReason": null,
    "duplicate": false
  },
  "requestId": "uuid"
}
```

`cleanupPhase` 是响应投影枚举 `finalize|complete|terminal`，不是 job 存储值。不得返回 evidence digest、actorId、orgId、idempotency key、requestDigest、opId、设备/人员/文件字段、异常 message/stack。

**Errors**

| HTTP | code | 条件 |
|---:|---|---|
| 400 | `PARAM_ERROR` | DTO/枚举/未知字段/时间/ID 非法，path 与 body `jobId` 不符 |
| 400 | `CAPACITY_EXCEEDED` | `confirmed_removed` 预扫 candidate ≥83 |
| 403 | `FORBIDDEN` | 缺 `device.operation.reconcile`、成员/组织失效 |
| 404 | `NOT_FOUND` | job 不存在或跨组织 |
| 409 | `REVISION_CONFLICT` | `expectedRevision` 不符、grant/head CAS 失败 |
| 409 | `INVALID_STATE` | job 非 `awaiting_result`/已终态且不属重复规则 |
| 409 | `EVIDENCE_REQUIRED` | evidence 缺失/null |
| 409 | `EVIDENCE_INVALID` | 结构/短码/decision/sourceType 不匹配/旧 schema/摘要非法 |
| 409 | `EVIDENCE_STALE` | 时间早于 unknown、未来、超 24h、非递增 |
| 409 | `EVIDENCE_HEAD_CONFLICT` | head revision/lastEvidenceId CAS 失败 |
| 409 | `EVIDENCE_CHAIN_BROKEN` | head 缺失但链存在、previous 不符或 HMAC 不符 |
| 409 | `RECONCILE_THROTTLED` | `still_unknown` 间隔小于 60 秒 |
| 409 | `RECONCILE_LIMIT` | `still_unknown` 已达 8 次 |
| 409 | `RECONCILE_CONFLICT` | 已终态但 decision 不同 |
| 409 | `CONFLICT` | op key 摘要/结果损坏、log/audit/evidence 预占 |
| 409 | `DOMAIN_INCOMPLETE` | K2 或 K3 domain 单边缺失/损坏 |
| 409 | `DOMAIN_MISMATCH` | K2/K3 换钥、版本或 fingerprint 不符 |
| 409 | `CLEANUP_SNAPSHOT_REQUIRED` | 老 job/缺 snapshot/绑定不符 |
| 409 | `DEVICE_CLAIM_INVALID` | slot/claim/guard 损坏 |
| 503 | `NOT_CONFIGURED` | K2/K3 缺失/非法、live/真实 Provider |
| 503 | `ADAPTER_UNAVAILABLE` | Store/clock 不可用 |

**K2/Provider 边界**

- `requestDigest` 严格按 H4-c §7.1；`evidenceDigest` 由服务端 K3 计算，客户端不提交。
- Provider 恒 0；`confirmed_removed` 的 R2 只调用 H4-b 本地 finalize，不重发 `revokeFace`。
- 202 不表示后台自动推进；客户端必须使用同键重放或人工再次操作，见 §5。

### E09 `POST /api/v2/device-operation-jobs/:jobId/finalize-retry`

| 项目 | 值 |
|---|---|
| 用途 | `LOCAL_FINALIZE_EXHAUSTED` 后的人工本地恢复；只重做本地 finalize |
| Permission | `device.operation.reconcile` |
| 幂等 | 必须，K2 `face.reconcile.finalize` |
| 成功 | `200` 或 `202` |
| Provider | 0 |

**Request**

| 位置 | 字段 | 类型/约束 |
|---|---|---|
| Path | `jobId` | 不透明 ID |
| Header | `Idempotency-Key` | §2.6 |
| Body | `jobId` | 必须与 path 相同，否则 `PARAM_ERROR/400` |
| Body | `expectedRevision` | 安全整数，≥1；恢复 generation 的 CAS 基准 |

Body 精确两个字段；不接受 `decision`、`evidence`、`reasonCode`。

**Response**

| 场景 | HTTP | body 关键字段 |
|---|---:|---|
| 恢复后本地 finalize 成功 | 200 | `jobState=succeeded`、`cleanupPending=false`、`cleanupPhase=complete` |
| 恢复后进入 30/120/600 重试 | 202 | `jobState=retryable_failed`、`cleanupPending=true`、`cleanupPhase=finalize` |
| 再次耗尽 | 200 | `jobState=terminal_failed`、`terminalReason=LOCAL_FINALIZE_EXHAUSTED` |

```json
{
  "data": {
    "jobId": "job-...",
    "operation": "finalize_retry",
    "generationRevision": 9,
    "recoveryId": "h4c-finalize-retry-v1:...",
    "jobState": "succeeded",
    "grantState": "revoked",
    "cleanupPending": false,
    "cleanupPhase": "complete",
    "terminalReason": null
  },
  "requestId": "uuid"
}
```

不使用 `duplicate:true`；不同键在当前未消费终态 revision 上允许开新一轮，旧 revision 返回 `RECONCILE_GENERATION_CONSUMED/409`。

**Errors**

| HTTP | code | 条件 |
|---:|---|---|
| 400 | `PARAM_ERROR` | DTO/ID/revision/path-body 不符/key 非法 |
| 403 | `FORBIDDEN` | 缺 `device.operation.reconcile`、成员/组织失效 |
| 404 | `NOT_FOUND` | job 不存在或跨组织 |
| 409 | `REVISION_CONFLICT` | `expectedRevision` 不符、并发 CAS 失败 |
| 409 | `INVALID_STATE` | job 非 `terminal_failed/LOCAL_FINALIZE_EXHAUSTED`、已 succeeded |
| 409 | `RECONCILE_GENERATION_CONSUMED` | 指向已消费旧 revision |
| 409 | `CONFLICT` | op key 结果损坏、log/audit 预占、同键异摘要 |
| 409 | `CLEANUP_SNAPSHOT_REQUIRED` | cleanupSnapshot/grant 绑定不符 |
| 503 | `NOT_CONFIGURED` | K2 缺失/非法、live/真实 Provider |
| 503 | `ADAPTER_UNAVAILABLE` | Store/clock 不可用 |

**边界**

- 只做本地 finalize；不调用 Provider、不重发 `revokeFace`、不自动轮询。
- 不重置 grant/slot/claim 资源；R2 的 H4-b finalize 仍做完整 slot/claim/device/guard CAS。
- E09 只处理 `LOCAL_FINALIZE_EXHAUSTED`，不处理 `awaiting_result`；后者只能走 E08。

### 3.10 继续关闭、不得新增的路径

| 路径/能力 | 状态 | 原因 |
|---|---|---|
| `POST /api/v2/device-access-grants` | 不存在 | 现有 routes 无此路径；本卡不新增 |
| `GET /api/v2/device-operation-jobs/:jobId` | 不存在 | 本卡不新增详情路由；读模型修正见附录 A |
| `POST /api/v2/device-operation-jobs/:jobId/query` | 不存在 | H3/H4 禁止自动/手动 Provider 查询入口 |
| `POST /api/v2/device-operation-jobs/:jobId/cancel` | 不存在 | H3 无取消入口，`sending` 不可取消 |
| `POST /api/v2/device-access-grants/:grantId/expire` | 不存在 | 到期扫描器属于内部路径，不是 HTTP |
| `POST /api/v2/face-credentials/:id/thumbnail` | 不存在 | 禁止缩略图/派生图缓存 |
| `DELETE`/`PUT` 任何人脸资源 | 不存在 | 状态迁移必须走显式动作 |
| 设备连接、Provider 调用、Cloud live | 继续关闭 | 本卡与 H4-c 均不接 |

## 4. 私密图片读取与 reviewer/readPrivate 权限分离

### 4.1 三权分立

| 权限 | 允许 | 不允许 |
|---|---|---|
| `device.face.submit` | 上传/提交人脸来源，提交凭证 | 审核、读原图 |
| `device.face.review` | 看审核队列元数据、通过/驳回 | 读原图、上传、撤权 |
| `device.face.readPrivate` | 按凭证读取原图 | 审核、提交、撤权 |
| `device.access.manage` | 创建/撤销授权 | 审核、读原图 |
| `device.audit.read` | 列任务 | 审核、读原图、撤权 |
| `device.operation.retry` | 重排已到期 retryable job | 对账、读原图 |
| `device.operation.reconcile` | 对账、finalize-retry | 重试、读原图 |

`admin` 角色不隐含以上任何权限；`org_memberships.permissions` 是唯一授权来源（[org.mjs](../../admin-web/lib/org.mjs#L95-L104)）。

### 4.2 图片访问判定

```text
credential = org-scoped get(face_credentials, credentialId)
  null/foreign -> 404 FILE_NOT_FOUND
file = credential.sourceFileId
FileService.authorizeDownload(file, actor):
  not own/not ready/not private/not face-biometric -> 404 FILE_NOT_FOUND
  private && purpose=face-biometric:
    fresh membership permission device.face.readPrivate required
    missing -> 404 FILE_NOT_FOUND (not 403)
  success -> proxy bytes, log download
```

- 不允许把 `device.face.review` 当读图权限；也不允许把 `device.face.readPrivate` 当审核权限。
- 不允许用 `?fileId=` 绕过凭证绑定；`sourceFileId` 只能来自服务端凭证记录。
- 不允许返回 302 临时 URL；private 文件一律代理字节，避免 URL 泄露/长期可用。
- 不允许缩略图、转码、OCR、质量评分等派生响应；本端点只返回原图字节。

### 4.3 404 同态与审计

| 情形 | 响应 | 审计 |
|---|---|---|
| credential 不存在 | 404 `FILE_NOT_FOUND` | 无 credential 可记；可按请求记 denied |
| credential 跨组织 | 404 `FILE_NOT_FOUND` | denied |
| 文件不存在/非 ready/非 private | 404 `FILE_NOT_FOUND` | denied |
| 缺 `device.face.readPrivate` | 404 `FILE_NOT_FOUND` | denied |
| 存储后端不匹配 | 503 `STORAGE_UNAVAILABLE` | 不记录字节 |
| 成功 | 200 字节 | download |

404 的 message 固定“文件不存在或不可见”；不得出现“无权限”“跨组织”“已停用”等差异。

## 5. `UNKNOWN_RESULT` 的人工收敛

### 5.1 状态事实

- `UNKNOWN_RESULT` 只把 job 迁到 `awaiting_result`；不自动重发，不自动查询。
- `awaiting_result` 的合法出边只有 `succeeded`/`terminal_failed`（人工对账）与显式失败关闭；H3 状态表虽列 `retryable_failed`，H4/H4-c 明确禁止把它用于自动重发。
- `retry` 入口只接受 `retryable_failed && cleanupPhase==="dispatch"`；`awaiting_result` 调用 E07 必须 `INVALID_JOB/409`。
- `finalize-retry` 只接受 `terminal_failed/LOCAL_FINALIZE_EXHAUSTED`；`awaiting_result` 调用 E09 必须 `INVALID_STATE/409`。

### 5.2 允许与禁止

| 操作 | `awaiting_result` 是否允许 | 说明 |
|---|---|---|
| E06 只读列表 | 允许 | 零写、Provider 0 |
| E08 `reconcile` | 允许 | 唯一人工收敛入口；decision 三选一 |
| E07 `retry` | **禁止** | 409 `INVALID_JOB`，零写 |
| E09 `finalize-retry` | **禁止** | 409 `INVALID_STATE`，零写 |
| 自动调度/定时器 | 禁止 | 不进入 HTTP，也不得直接改 job |
| Provider `queryOperation` | 禁止 | H3/H4 不提供该入口 |
| 客户端轮询新键 | 禁止 | 只能同键重放或人工对账 |

### 5.3 HTTP 语义

- E08 的 202 只表示 R1 已提交、R2 本地 finalize 未完成；**不加 `Retry-After`**，避免暗示自动重试。
- E08 的 `still_unknown` 返回 200 且 job 保持 `awaiting_result`；不新增 evidence 之外的 job 写。
- 同键重放返回原投影，不再写 evidence/head；不同键同结论（已终态）才可能 `duplicate:true`。
- 任何 503/409 都不是“稍后自动重试”的信号；客户端必须重新读取 E06 或同键重放，不得换新键自动重发。
- `confirmed_present` 是终态，不释放资源；后续重新清理必须另立新 generation/job，不由本卡或 HTTP 自动完成。

## 6. 容量、90 refs 与竞态

| 项目 | 冻结规则 |
|---|---|
| HTTP 层 refs | 不增加事务 refs；refs 由服务层决定 |
| 非 finalize 写 | 14–15 refs，远低于 90 |
| finalize R2 | H4-b `8+N`；N=82 → 90 成功；N=83 → 91 拒绝或 local-finalize pending |
| 预扫 | E05/E08 在 R1 写前只读预扫；N≥83 → `CAPACITY_EXCEEDED/400`，零写、Provider 0 |
| 预扫后增长 | 由 R2 的 H4-b `>90` 分支兜底，绝不半释放 |
| 请求体 | 与 refs 无关；body 大小只受 64 KiB 上限约束 |
| 并发 | 线性化点仍是 job/head/guard CAS；HTTP 不提供“先读后写”的跨请求事务 |

## 7. 端点开放状态与前置门禁

| 端点 | 服务层状态 | HTTP 状态 | 可接线前置 | 真实 Provider/设备 |
|---|---|---|---|---|
| E01 submit | H1 已实现 | 关闭 | 本卡批准 + 编码卡 | 不需要 Provider；文件存储需可用 |
| E02 queue | H1 已实现 | 关闭 | 本卡批准 + 编码卡 | 无 |
| E03 review | H1 已实现 | 关闭 | 本卡批准 + 编码卡 | 无 |
| E04 image | FileService 已实现；缺 credential 解析层 | 关闭 | 本卡批准 + 解析层编码 | 真实对象存储需另行验证 |
| E05 revoke | H4-a/H4-b 已实现，Local+Mock | 关闭 | 本卡批准 + 编码卡 | **继续关闭**；live/Cloud/真实设备禁止 |
| E06 list | 只有 `queryJob(jobId)`，无 list | 关闭 | P0-1 读模型修正 + 编码卡 | 无 |
| E07 retry | H3-b/H4-b 有 requeue，无 K2 | 关闭 | P0-2 K2 改造 + 编码卡 | **继续关闭**；只重排，不调 Provider |
| E08 reconcile | H4-c 仅设计 | 关闭 | H4-c 实现 + Codex 终审 + 编码卡 | **继续关闭**；Provider 0 |
| E09 finalize-retry | H4-c 仅设计 | 关闭 | 同上 | **继续关闭**；只本地 finalize |

**总门禁**：本卡合并后，九个端点仍然全部关闭；`server.mjs` 不注册、不调用、不新增人脸分支。注册必须另发编码卡，并逐项引用本卡端点 ID。

## 8. 测试矩阵

### 8.1 记号与 harness

- `Z`：全库内容级零变化（所有记录、排序 ID、计数、audit 均不变）。
- `Zc`：业务核心集合零变化（凭证/grant/job/log/evidence/head/domain/op key 均不变）；E01/E03 使用非确定性 `#audit`，同键重放仍可能追加一条 `admin_audit`，因此这两条重放断言用 `Zc` 而不是 `Z`。
- `L`：只新增一条 `file_access_log`（denied 或 download），业务集合不变。
- `P0`：Provider 调用入口增量为 0；`P1`：仅允许一次既有 Mock 调用。
- HTTP 测试使用 `createApp` 启动临时端口，Cookie + CSRF + Origin 登录；每个用例先固化基线快照，再比较。
- Store 使用 LocalStore 临时目录；禁止 Cloud/live/真实设备。
- 图片用例比较字节长度、Content-Type 和响应头，不把图片写入日志。
- 敏感扫描对所有响应体、日志、audit、evidence/head/op key 执行固定正则；零命中才 PASS。
- 每个失败用例同时断言无 500、无 stack、无配置值、无 Provider 调用。

### 8.2 正常路径

| ID | 端点 | 前置/请求 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| N01 | E01 | 合法 personId/sourceFileId，submit 权限 | 201，`credentialId` 稳定，`reviewState=submitted` | 0 | 凭证+op key+domain+audit |
| N02 | E01 | 同组织第二个 personId | 201，新 credentialId | 0 | 同上 |
| N03 | E02 | 一条 submitted、一条 approved | 200，仅 submitted 行，无图片字段 | 0 | Z |
| N04 | E03 | submitted，`approved`，正确 revision | 200，`reviewState=approved` | 0 | 凭证+op key+domain+audit |
| N05 | E03 | submitted，`rejected`，正确 revision | 200，`reviewState=rejected` | 0 | 同上 |
| N06 | E04 | 有 `device.face.readPrivate`，JPEG 凭证 | 200，`image/jpeg`，字节与源文件一致 | 0 | L（download） |
| N07 | E05 | pending grant，无 blocker | 200，`revoked/cleanupPending=true/jobId` | 0 | grant+job+log+op key+domain+audit |
| N08 | E06 | 同组织 3 条 job，`device.audit.read` | 200，仅本组织行，`nextCursor` 合法 | 0 | Z |
| N09 | E07 | `retryable_failed` 已到期，正确 revision | 200，`state=queued`，revision+1 | 0 | job+log（K2 后加 op key/domain） |
| N10 | E08 | `awaiting_result`，`confirmed_removed`，无 blocker | 200，`succeeded/cleanupPending=false` | 0 | H4-c X + H4-b R2 |
| N11 | E08 | `awaiting_result`，`confirmed_present` | 200，`terminal_failed/cleanupPending=true`，资源不变 | 0 | H4-c X |
| N12 | E09 | `terminal_failed/LOCAL_FINALIZE_EXHAUSTED`，正确 revision | 200 或 202，符合 §E09 矩阵 | 0 | H4-c 恢复 + H4-b finalize |

### 8.3 重放与幂等

| ID | 端点 | 前置/请求 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| R01 | E01 | 同键同 body 重放 | 201，同 credentialId | 0 | Zc |
| R02 | E01 | 同键，personId 改变 | 409 `CONFLICT` | 0 | Z |
| R03 | E03 | 同键同 decision/revision 重放 | 200，同结果 | 0 | Zc |
| R04 | E03 | 同键，decision 改变 | 409 `CONFLICT` | 0 | Z |
| R05 | E05 | 同键同 grant 重放 | 200，同 jobId | 0 | Z |
| R06 | E01/E03 | 同一原始 key 用于两个不同 K2 method | 各自成功，不互相重放 | 0 | 各自首次写 |
| R07 | E01/E05 | 不同 actor 使用同一原始 key | K2 作用域隔离；E01 可产生第二条凭证，E05 第二个请求按资源状态 409 | 0 | 按端点 |
| R08 | E07 | 同键同 revision，首次已 queued | 200，同 receipt，不重复 log | 0 | Z |
| R09 | E07 | 同键，revision 改变 | 409 `CONFLICT` | 0 | Z |
| R10 | E08 | 同键同 body，已终态 | 200，同投影，不新增 evidence/head | 0 | Z |
| R11 | E09 | 同键同 body，恢复已成功/耗尽 | 200，同 recovery 指针投影 | 0 | Z |

### 8.4 竞态

| ID | 端点 | 注入 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| C01 | E01 | 两并发同键 | 一个凭证；两个 201 同 ID | 0 | 一次核心写 |
| C02 | E03 | 两并发不同键，同 revision | 一胜 200；另一 409 `REVISION_CONFLICT`/`INVALID_STATE` | 0 | 一次写 |
| C03 | E05 | 两并发不同键，同 grant | 一胜 200；另一 409 `INVALID_STATE`/`REVISION_CONFLICT` | 0 | 一个 job |
| C04 | E07 | 人工 retry 与调度器同 job | 一胜 queued；另一 409 `INVALID_JOB`/`RETRY_NOT_DUE` | 0 | 一次 job+log |
| C05 | E07/E08 | `awaiting_result` 同时 retry + reconcile | retry 409 `INVALID_JOB`；reconcile 正常提交 | 0 | 仅 reconcile |
| C06 | E08/E05 | reconcile R2 与 H4-b finalize 同 job | 一胜；另一 409 `INVALID_JOB`/`REVISION_CONFLICT` | 0 | 不重复释放 |
| C07 | E08 | 两并发不同 decision | 一胜 200；另一 409 `INVALID_STATE`/`RECONCILE_CONFLICT` | 0 | 一次终态 |
| C08 | E09 | 两并发同 generation | 一胜 200/202；另一 409 `REVISION_CONFLICT` | 0 | 一次恢复 |
| C09 | E08 | 两并发同键 `still_unknown` | 两个 200 同 sequence；不新增第二条 evidence | 0 | 一次写 |
| C10 | E05/createGrant | 撤权与 createGrant 争 guard | guard CAS 一胜；另一 409 `REVISION_CONFLICT`/`GRANT_SLOT_CONFLICT` | 0 | 不误放 claim |

### 8.5 损坏记录与 DTO

| ID | 端点 | 注入 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| D01 | E01 | body 多 `deviceId` | 400 `PARAM_ERROR` | 0 | Z |
| D02 | E01 | 缺 `Idempotency-Key` | 400 `PARAM_ERROR` | 0 | Z |
| D03 | E01 | key 15 位、129 位、含空格或 `/` | 400 `PARAM_ERROR` | 0 | Z |
| D04 | E03 | 缺 `expectedRevision` | 400 `PARAM_ERROR` | 0 | Z |
| D05 | E03 | `decision=approve` 或大小写漂移 | 400 `PARAM_ERROR` | 0 | Z |
| D06 | E05 | body 带 `expectedRevision`/`reasonCode` | 400 `PARAM_ERROR` | 0 | Z |
| D07 | E07 | revision 为 0/小数/字符串 | 400 `PARAM_ERROR` | 0 | Z |
| D08 | E08 | path jobId 与 body jobId 不同 | 400 `PARAM_ERROR` | 0 | Z |
| D09 | E08 | evidence 多 `digest`/`raw`/`payload` | 400 `PARAM_ERROR` | 0 | Z |
| D10 | E08 | `sourceType=mock_provider` 或 sourceCode 不匹配 | 409 `EVIDENCE_INVALID` | 0 | Z |
| D11 | E08 | observedAt 早于 finishedAt、未来、超 24h | 409 `EVIDENCE_STALE` | 0 | Z |
| D12 | E08 | previous evidence 缺字段/错 sequence/HMAC 不符 | 409 `EVIDENCE_CHAIN_BROKEN` | 0 | Z |
| D13 | E06 | `limit=0/101`、state 未知 | 400 `PARAM_ERROR` | 0 | Z |
| D14 | E06/E07 | job 未知字段、revision 非安全整数、phase 矛盾 | 409 `INVALID_JOB` 或 503 `ADAPTER_UNAVAILABLE`，零写 | 0 | Z |
| D15 | 全部 | 跨组织 credential/grant/job ID | 404 `NOT_FOUND`/`FILE_NOT_FOUND`，同态 | 0 | Z |
| D16 | 全部 | 路径 `%ZZ`/双重编码/编码斜杠 | 400 `PARAM_ERROR`，不 500/503 | 0 | Z |

### 8.6 容量

| ID | 端点 | 注入 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| P01 | E05 | 82 candidates | 200；R2 成功；claim 按 H4-b 保留 | 0 | H4-b 90 refs 内 |
| P02 | E05 | 83 candidates 预扫 | 400 `CAPACITY_EXCEEDED`；R1 零写 | 0 | Z |
| P03 | E05 | R1 后增长到 83 | 202 pending；不半释放 slot/claim | 0 | R1 写 + finalize pending |
| P04 | E08 | 82 candidates `confirmed_removed` | 200 succeeded | 0 | H4-c X + H4-b R2 |
| P05 | E08 | 83 candidates `confirmed_removed` | 400 `CAPACITY_EXCEEDED`，零写 | 0 | Z |
| P06 | 全部 | body >65536 字节 | 413 `PARAM_ERROR`，不 503 | 0 | Z |
| P07 | E06 | `limit=101` | 400 `PARAM_ERROR` | 0 | Z |

### 8.7 隐私

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

### 8.8 失败关闭与配置

| ID | 端点 | 注入 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| F01 | E01/E03/E05 | K2 缺失/非法 | 503 `NOT_CONFIGURED` | 0 | Z |
| F02 | E01/E03/E05 | K2 domain 单边缺失/损坏 | 409 `DOMAIN_INCOMPLETE` | 0 | Z |
| F03 | E01/E03/E05 | K2 换钥/fingerprint 不符 | 409 `DOMAIN_MISMATCH` | 0 | Z |
| F04 | E08/E09 | K3 缺失/非法 | 503 `NOT_CONFIGURED` | 0 | Z |
| F05 | 全部 | `live`/真实 Provider/设备连接请求 | 503 `NOT_CONFIGURED`；无网络/设备调用 | 0 | Z |
| F06 | E05/E07/E08/E09 | CloudStore 或非 Mock H4-b | 503 `NOT_CONFIGURED` | 0 | Z |
| F07 | E04 | 文件存储后端与配置不一致 | 503 `STORAGE_UNAVAILABLE`，无字节 | 0 | Z |
| F08 | 全部 | Store/clock 抛错 | 503 `ADAPTER_UNAVAILABLE`，无部分写 | 0 | Z |
| F09 | 全部 | 未注册路径/错误方法 | 404 或 405，不进入业务 | 0 | Z |
| F10 | 全部 | 503 响应扫描 | 无密钥、无配置值、无异常 message | 0 | Z |
| F11 | 全部 | body 超限 | 413 `PARAM_ERROR`，不得落为 503 | 0 | Z |
| F12 | 全部 | 任一失败路径计数 Provider | Provider 增量为 0 | 0 | Z |

### 8.9 `UNKNOWN_RESULT` 人工收敛

| ID | 端点 | 前置/请求 | 预期 | Provider | 写集 |
|---|---|---|---|---|---|
| U01 | E06 | `awaiting_result` 列表 | 200，可见 `awaiting_result` | 0 | Z |
| U02 | E07 | 对 `awaiting_result` retry | 409 `INVALID_JOB`，零写 | 0 | Z |
| U03 | E08 | `still_unknown`，无间隔/次数问题 | 200，状态不变，evidence sequence+1 | 0 | H4-c 证据写 |
| U04 | E08 | 60 秒内第二次 `still_unknown` | 409 `RECONCILE_THROTTLED` | 0 | Z |
| U05 | E08 | 第 9 次 `still_unknown` | 409 `RECONCILE_LIMIT` | 0 | Z |
| U06 | E08 | `confirmed_removed` 成功 | 唯一进入 `succeeded` 的 HTTP 路径 | 0 | H4-c X + R2 |
| U07 | E08 | `confirmed_present` | `terminal_failed`，grant/slot/claim 不释放 | 0 | H4-c X |
| U08 | E09 | 对 `awaiting_result` finalize-retry | 409 `INVALID_STATE`，零写 | 0 | Z |
| U09 | 全部 | 503/unknown 后换新键自动重发 | 契约禁止；测试客户端只允许同键重放/读列表 | 0 | Z |

## 9. 逐项追溯矩阵

| 契约项 | 冻结值 | 来源 |
|---|---|---|
| E01 路径/权限 | `POST /api/v2/face-credentials` + `device.face.submit` | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L7-L13)、[org.mjs](../../admin-web/lib/org.mjs#L97) |
| E01 DTO | `{personId,sourceFileId}` → `{credentialId,reviewState}` | [dto.mjs](../../admin-web/lib/face-service/dto.mjs#L112-L120)、[service.mjs](../../admin-web/lib/face-service/service.mjs#L199-L255) |
| E02 路径/权限 | `GET .../review-queue` + `device.face.review` | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L14-L20)、[org.mjs](../../admin-web/lib/org.mjs#L98) |
| E02 DTO | `publicReviewItem[]` | [dto.mjs](../../admin-web/lib/face-service/dto.mjs#L235-L251) |
| E03 路径/权限 | `POST .../:credentialId/review` + `device.face.review` | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L21-L27) |
| E03 DTO | `{decision,expectedRevision}` → `{credentialId,reviewState}` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L258-L313)、H1 终审 |
| E04 路径/权限 | `GET .../:credentialId/image` + `device.face.readPrivate` | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L28-L33)、[org.mjs](../../admin-web/lib/org.mjs#L99) |
| E04 私密读取 | 代理字节、404 同态、无 URL | [files.mjs](../../admin-web/lib/files.mjs#L1045-L1094) |
| E05 路径/权限 | `POST .../:grantId/revoke` + `device.access.manage` | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L34-L40)、[org.mjs](../../admin-web/lib/org.mjs#L101) |
| E05 DTO | 空 body → `{grantId,jobId,grantState,cleanupPending,evidenceScope}` | [service.mjs](../../admin-web/lib/face-service/service.mjs#L652-L728) |
| E06 路径/权限 | `GET /api/v2/device-operation-jobs` + `device.audit.read` | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L41-L46)、[org.mjs](../../admin-web/lib/org.mjs#L102) |
| E06 DTO | `publicJobResult[]` | [dto.mjs](../../admin-web/lib/face-service/dto.mjs#L254-L263) |
| E07 路径/权限 | `POST .../:jobId/retry` + `device.operation.retry` | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L47-L53)、[org.mjs](../../admin-web/lib/org.mjs#L103) |
| E07 DTO | `{expectedRevision}` → `{jobId,state,revision}` | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L482-L517)、H3 Q07 |
| E08 路径/权限 | `POST .../:jobId/reconcile` + `device.operation.reconcile` | [routes.mjs](../../admin-web/lib/face-service/routes.mjs#L54-L59)、[org.mjs](../../admin-web/lib/org.mjs#L104) |
| E08 DTO/错误 | H4-c §4/§7/§11/§13 | [H4-c 设计](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L80-L118)、[H4-c 设计](HK-AI-04-H4C-RECONCILIATION-DESIGN.md#L380-L410) |
| E09 路径/权限 | `POST .../:jobId/finalize-retry` + `device.operation.reconcile` | H4-c §6.5/§13.2；不在 routes.mjs，属 H4-c 新增提案 |
| K2 格式/作用域 | 16–128、HMAC、org+method+actor | [dto.mjs](../../admin-web/lib/face-service/dto.mjs#L84-L86)、[collections.mjs](../../admin-web/lib/face-service/collections.mjs#L182-L256) |
| K2 domain 错误 | `DOMAIN_INCOMPLETE`/`DOMAIN_MISMATCH` | [collections.mjs](../../admin-web/lib/face-service/collections.mjs#L257-L330) |
| 404 同态 | 跨组织/不存在统一 404 | [org.mjs](../../admin-web/lib/org.mjs#L160-L185)、[service.mjs](../../admin-web/lib/face-service/service.mjs#L112-L115) |
| 409 revision | review/revoke/reconcile 映射 | H1 终审、[service.mjs](../../admin-web/lib/face-service/service.mjs#L688-L690)、H4-c §11 |
| 503 配置 | K2/K3/Provider/Store | H4-c §11、[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs#L51-L61) |
| UNKNOWN 人工 | 只查/只对账，不自动重试 | H3 [Q05/Q07](HK-AI-04-H3-LEASE-DISPATCH-DESIGN.md#L77-L101)、H4-c §1 |

## 10. 待 Codex 裁定

| 编号 | 问题 | 本卡建议 |
|---|---|---|
| Q1 | 是否批准九个端点路径与“无 createGrant HTTP 路径” | 批准；createGrant 另立卡 |
| Q2 | `publicJobResult` 缺 `revision`，E07/E08/E09 无 CAS 基准 | 批准附录 A 的读模型修正；否则 E06-E09 保持关闭 |
| Q3 | `face.operation.retry` K2 名称与服务层改造 | 批准名称；E07 编码卡补 K2 后再接线 |
| Q4 | E05 是否必须 `expectedRevision`/`reasonCode` | 本卡按已实现 bodyless 冻结；若要扩展，另开服务层卡 |
| Q5 | E01 同键重放用 201 | 批准；不扩展 H1 result |
| Q6 | 图片缺 `readPrivate` 用 404 还是 403 | 用 404，沿用文件契约 |
| Q7 | E02 `submittedAt` 缺省、E06 `failureReason` 恒 null | 接受为已知缺口；编码卡不得伪造字段 |
| Q8 | E08/E09 是否等 H4-c 实现后再开 | 是；本卡不实现 H4-c |
| Q9 | 202 是否加 `Retry-After` | 不加；禁止暗示自动重试 |
| Q10 | 413 的 code | `PARAM_ERROR`；不得落为 `ADAPTER_UNAVAILABLE/503` |

## 附录 A：读模型修正提案（未冻结，需另行批准）

E07/E08/E09 需要 job 的当前 `revision`。当前 `publicJobResult` 不返回它，E06 也没有详情路由。建议在**不新增路由**的前提下，给 E06 列表项增加以下只读字段：

| 字段 | 类型 | 来源 | 用途 |
|---|---|---|---|
| `revision` | 安全整数 ≥1 | `job.revision` | E07/E08/E09 的 CAS 基准 |
| `action` | `enroll`/`update`/`revoke` | `job.action` | 区分 enroll/revoke 路径 |
| `cleanupPhase` | `dispatch`/`finalize`/`null` | `job.cleanupPhase`（enroll job 无此字段） | 区分 retryable_failed 是否可 retry |
| `nextAttemptAt` | 安全整数或 `null` | `job.nextAttemptAt` | 展示退避到期时间 |

约束：

- 只读投影，不新增集合、不新增状态/权限、不改变 `publicJobResult` 既有服务调用方。
- 必须由 H1/H3/H4 契约修订批准；本卡不把它当作已冻结 DTO。
- 若 Codex 拒绝该提案，则必须新增 `GET /api/v2/device-operation-jobs/:jobId` 详情路由；但该路由不在现有 routes.mjs，本卡不自行新增。

## 附录 B：交付验证命令

```text
git diff --check
# 相对链接：解析文档中所有非 http(s) 链接，确认目标存在
# 敏感扫描：云厂商密钥、私钥块、口令/密钥/令牌赋值、32 字节 Base64、64 位 hex、手机号、身份证号
```

验证结果记录在提交说明与最终回报中；本卡不运行任何 Provider、设备或 Cloud 调用。

## 附录 C：本卡不做的事

- 不修改 `server.mjs`，不注册、不调用任何业务 HTTP。
- 不修改 `service.mjs`、`h4b.mjs`、`files.mjs`、`collections.mjs`、`store.mjs` 或测试。
- 不实现 H4-c、不接真实 Provider、不连接设备、不创建 Cloud 资源。
- 不新增权限名、状态名、decision、`evidenceScope`、错误码。
- 不把本卡当作 HTTP 上线批准；Codex 终审通过前，九个端点继续关闭。
