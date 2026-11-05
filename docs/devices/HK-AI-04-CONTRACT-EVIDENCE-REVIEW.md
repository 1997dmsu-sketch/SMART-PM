# HK-AI-04A：门禁后端契约与证据核对

- 状态：**待 Codex 复审，未冻结，不是 AI-D 开发完成或真实接入批准**
- 文档基线：`docs/lock-01-fast-track@8b47fb7`
- 工作分支：`docs/hk-ai-04-contract-evidence`
- 范围：只整理厂商无关服务、Mock、状态和证据边界；不实现后端、不决定 ISAPI 路线
- 安全边界：未修改生产代码、数据库迁移、Provider 白名单或既有证据结论；未连接设备、未调用真实 ISAPI、未开放接口

## 0. 复审入口与阅读规则

本文把已经存在的项目契约、产品族文档和本轮待复审建议分开。`C01`～`C13` 是逻辑服务操作，**不是新增 HTTP 路由，也不要求一路由一操作**；实际路由和 HTTP 错误信封由 Codex 决定。`P` 标记的命名、展示 DTO 和 Mock 触发方式均为建议，不得被当作已经冻结的接口。

任务卡输入将 LOCK-01A 契约写为 `docs/devices/LOCK-01A-CONTRACT.md`，实际文件位于 [`docs/database/LOCK-01A-CONTRACT.md`](../database/LOCK-01A-CONTRACT.md)。本交付文件名按任务卡“交付物”一节的精确路径确定。

### 0.1 输入与证据范围

| 输入 | 本文采用的内容 | 未由该输入证明的事项 |
| --- | --- | --- |
| [HK-AI-04 任务卡](../tasks/HK-AI-04-FACE-SERVICE-MOCK.md) | 服务层、持久任务、Mock 范围及验收红线 | 未证明任何真实设备能力 |
| [LOCK-01A Provider 契约](../database/LOCK-01A-CONTRACT.md) | 五个 Provider 方法、context、错误枚举、任务状态、幂等与未知结果规则 | 未提供真实厂商实现或厂商幂等保证 |
| [LOCK-01A 数据设计](../database/LOCK-01A-DATA-DESIGN.md) | 集合、claim/slot、grant 状态、租约、权限点和事务边界 | 是设计稿，不表示已建表或迁移；其中 5 MB 人脸示例不是最新决定 |
| [HK-AI-03 集成任务](../tasks/HK-AI-03-DB-PRIVATE-FACE.md) | DB-02～DB-07 集成依赖；最新人脸文件策略与权限拆分 | 本分支不证明其代码已交付；同意和销毁仍是后续项 |
| [HK-AI-01 证据矩阵](HIKVISION-ISAPI-EVIDENCE-MATRIX.md)与[白名单](HIKVISION-ISAPI-PROVIDER-WHITELIST.json) | 产品族字段、候选端点、限制和错误码证据状态 | 目标 capability 和真实调用均为 0；不得升级为目标实测 |
| [数据模型](../database/DATA-MODEL.md)、[API 契约](../database/API-CONTRACT.md)、[DB-02](../database/DB-02-REVIEW.md)～[DB-07](../database/DB-07-REVIEW.md)复审 | 组织、人员、实名、入住、黑名单、文件与事务资格边界 | 不替代 HK-AI-03 合并后的实现及全量回归；DB-08 隔离云验证另行执行 |

其他逐项复审来源：[DB-03](../database/DB-03-REVIEW.md)、[DB-04](../database/DB-04-REVIEW.md)、[DB-05](../database/DB-05-REVIEW.md)、[DB-06](../database/DB-06-REVIEW.md)。

### 0.2 证据标签与三级设备证据

- **C—项目契约**：LOCK-01A 已明确的方法、枚举和安全语义，本轮不重新设计。
- **D—数据库/复审依据**：DB-02～DB-07 和 HK-AI-03 已确定的业务依赖；实现可用性以集成验收为准。
- **F—产品族文档**：HK-AI-01 已定位的字段或流程，仅代表 `documentation=present`。
- **P—待复审提案**：本文为补齐服务衔接提出的命名或规则，需 Codex 决策后才冻结。

上述标签不取代 HK-AI-01 的三级设备证据：文档存在、目标设备 capability、真实调用验证。本分支后两级仍为 **0 / 未执行**。`DS-K1T671B`、`DS-K1T671BM-3XFTD`、通用 schema 和 fixture 均不能替代裸目标型号 `DS-K1T671BM` 的证据。

### 0.3 不变红线

1. 白名单继续保持 `candidateOnly=true`、`allowedNow=false`、`allowDeviceOperations=false`、`providerReleaseApproved=false`；本文不开放任何 GET/POST/PUT/DELETE。
2. 未知发送结果进入 `UNKNOWN_RESULT / awaiting_result`，只能查询或人工对账，**不能自动重复写入**。
3. 退租、资格失效或设备归属失效时，业务授权立即失效；撤权失败只留告警和任务，不恢复 grant。
4. Mock 仅可在 demo/test 显式选择，结果只能标 `evidenceScope=simulated`；不得产生 `device_verified`，也不证明目标设备已生效。
5. 外部网络在数据库事务外；先持久化任务，再取得租约发送。设备直连只能经受控内网代理，公网、小程序和浏览器不直连设备。
6. `FORBID-FDLIB-DELETE-ALL`、`FORBID-USERINFO-BULK-DELETE` 继续禁止；不采用延期的 `FDSearch PUT` 替代修改路线。

## 1. 服务边界与共同不变量

| 服务/对象 | 负责 | 不负责及协作边界 |
| --- | --- | --- |
| 设备服务 `access_devices` | 全局 claim、唯一 owner、组织归属、状态、能力证据引用 | 不把设备 active 当作人员资格；跨组织只走审计转移 |
| 凭证服务 `face_credentials` | 本人、来源私密文件、提交人、审核版本、摘要与证据域 | 代提交人不成为所有者；不在普通响应返回人脸或完整摘要 |
| 授权服务 `device_access_grants` | 人员—设备—入住周期 slot、期限、业务状态 | 不用厂商成功替代当前业务资格；不处理一键开门 |
| 任务服务 `device_operation_jobs` | 固定 op_id、请求摘要、状态、attempts、租约、对账游标 | 不在数据库事务中联网；不以本地 op_id 宣称厂商幂等 |
| 操作日志 `device_operation_logs` | 只追加状态变化、脱敏结果和 auditId | 不覆盖历史，不存人脸、密钥、URL 凭据或原始敏感响应 |
| Provider | 实现既定五方法及脱敏适配；本期只实现 Mock | 不实现或调用真实 Hikvision Provider；不自行选定 ISAPI 路线 |
| 资格服务 | 每次创建/下发前重新检查组织、物业、人员、实名、入住、名单、设备 | 不使用一次性预检永久放行；沿用 DB-06 guard/epoch 与 DB-05 周期有效性 |
| 审计服务 | 记录决定、权限、版本、执行域和证据引用 | 不让无权限调用者通过审计或错误信息探知他组织资源 |

共同输入规范：

- `FaceAccessContext` 固定为 `actorId / actorType / orgId / permissions / idempotencyKey / executionMode`；组织权限必须来自当前有效组织关系，而非全局管理员身份。
- `idempotencyKey` 为 16～128 字符且仅含 `[A-Za-z0-9._:-]`。op_id 使用既定 claim 公式，作用域含 `orgId|route|actorType|actorId`；requestDigest 含规范化业务输入和 actorType。
- 人员只以组织内稳定 `personId` 关联，不使用手机号、代理人账号或证件原值作为门禁 ID；不自动合并账号或人员。
- 对请求中的 `orgId/personId/deviceId/grantId/jobId` 做同组织及实体关系校验；跨组织按不泄露存在性的 `DENIED` 处理。
- 设备 claim 全局唯一并只有一个 `ownerOrgId`；grant 的 `orgId` 必须等于设备 owner。固定 ID 占位加事务条件写提供唯一性，不依赖新增唯一索引。
- 业务资格至少要求：组织与物业未停用/归档、人员 active、实名 approved 且归属同一 person、有效 occupancy 与 cycle、名单资格允许、设备 active。名单命中待复核不能默认放行。
- `grant-state / credential-review-version / occupancy+cycle / eligibility guards / device owner / grant slot` 在授权写入事务内复核；随后落 queued 任务和日志。网络发送前再次校验，资格失效则取消未发送任务。
- grant 创建/更新与业务失效使用 revision/epoch 条件写；后台补写不得把已结束周期复活。设备证据与业务资格是两个独立维度。
- 所有时间采用明确时区和设备时间依据；有效期必须 `validFrom < validUntil`，不得使用长期权限绕过租期。

## 2. 服务/API 契约矩阵（13 项逻辑操作）

“权限”列为已确定权限或待 Codex 决定项，不表示默认组织管理员即可。审计事件名均为 P 类建议；所有失败，包括拒绝和冲突，也须留下不含敏感值的安全审计。输入中的 `expectedRevision` 是建议的条件写参数，是否对外暴露由 Q01/Q03 一并决定。

| ID / 操作 | 调用方 | 主要输入 | 主要输出 | 权限/组织 | 幂等与事务边界 | 审计事件（建议） | 失败语义 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C01 `device.claim` | 设备管理后端 | 规范化设备标识、provider、归属链、型号/固件、能力证据引用、context | deviceId、ownerOrgId、状态、revision | `device.manage`；目标组织有效 | 全局 claim + owner 条件写，无联网；重复提交按设备 claim 规则处理 | `device.claimed` | 他组织 owner 已存在→`CONFLICT`，不暴露密文；无能力证据不可虚标 active |
| C02 `device.transferOwner` | 设备管理后端 | deviceId、from/toOrg、双方授权上下文、expectedRevision、reason | 新 owner、转移时间、旧 grant/撤权任务摘要 | `device.manage` + Q03 转移授权 | 全量条件读和审计转移为一事务；旧 grant 立即 revoked；撤权任务同事务落库，发送在外 | `device.ownerTransferred` | 有效 grant/未关闭 job 的处理有原文歧义，Q03 未决前 fail-closed；禁止静默共享或双 owner |
| C03 `faceCredential.submit` | 人脸提交后端 | personId、sourceFileId、consent 引用（待 AI-C）、执行域、context | credentialId、reviewState=submitted、revision | `device.face.submit`；提交人与 person 的关系需校验 | 文件 ready/private/用途、人员组织与提交权限在事务内校验；不联网、不自动授权 | `face.submitted` | 无权限、跨组织、文件不符→`DENIED`；状态/版本冲突→`CONFLICT`；同意未就绪不得视为可正式提交 |
| C04 `faceCredential.review` | 人脸审核后端 | credentialId、expectedRevision、approve/reject、reason、context | reviewState、审核版本；通过不等于设备下发成功 | `device.face.review`；**不隐含私密读取权** | 审核决定与版本条件写；需要读原图时另验 `device.face.readPrivate` 并逐次审计 | `face.reviewed` / `face.privateRead` | 无权限→`DENIED`；重复不同决定/版本过期→`CONFLICT`；不得以审核权绕过文件权限 |
| C05 `accessGrant.create` | 授权业务后端 | personId、deviceId、occupancyId、cycleId、credentialId、有效期、来源/批准人、context | grantId、grantState=pending、jobId、jobState=queued、opId、evidenceScope | Q02；owner 组织内 | 资格 + slot + credential 审核版本 + op key + grant/job/log 同一事务；再租约发送 | `access.grantCreated`、`operation.queued` | 资格失效→`DENIED`；slot/版本/幂等冲突→`CONFLICT`；模拟环境不得产生真实生效声明 |
| C06 `accessGrant.revoke` | 退租/资格/设备归属服务或授权后端 | grantId 或资格事实引用、reason、expectedRevision、context | grantState=revoked、撤权 jobIds；不承诺设备已删除 | Q02；内部资格服务须保留原 org/device 上下文 | grant 立即失效 + slot 释放 + revoke job + log 同事务；重复撤权返回原结果 | `access.revoked`、`operation.queued` | 版本/归属冲突→`CONFLICT`；后续撤权失败/未知不恢复业务授权 |
| C07 `provider.enrollFace` | 任务 worker | personId/deviceId/grantId/sourceFileId/validFrom/validUntil、job/op 上下文 | jobId/state/providerRequestId?；状态只能为既定枚举 | 内部服务身份，不新增客户端权限；发送前重验资格 | 先 queued，再租约→sending→单次下发→回写；DB 事务外联网 | `operation.started/resultObserved` | 未发送且可证明→`RETRYABLE`；发送后未知→`UNKNOWN_RESULT`；资格失效取消未发送任务，不绕过业务撤权 |
| C08 `provider.updateFace` | 任务 worker | credentialId + 经批准变更字段、原 grant/job 上下文 | jobId/state/providerRequestId? | 内部服务身份；发送前重验资格 | 原凭证必须 effective；固定 op_id、摘要、租约同 C07 | `operation.started/resultObserved` | 原状态无效→`CONFLICT`；可变字段未定→拒绝未确认变更；未知结果禁止自动再写 |
| C09 `provider.revokeFace` | 撤权任务 worker | grantId/credentialId、业务失效版本、job/op 上下文 | jobId/state/providerRequestId? | 内部服务身份；不因资格失效而跳过清理 | 撤权任务独立租约；grant 不在此步骤才失效；未知时保留清理任务 | `operation.started/resultObserved` | 撤权失败→告警 + retryable/terminal/awaiting；不得恢复 grant；有证据未执行才可安全重试 |
| C10 `operation.query` | 授权查询方、对账 worker | jobId 或 providerRequestId?、context；对账使用原任务 | state、attempts、lastSuccessAt、脱敏 failureReason、evidenceScope | Q04；必须组织内可见 | 查询不改 op_id、不新建写任务；写回状态需原 job revision/观测版本；网络在外 | `operation.queried/reconciled` | 跨组织→`DENIED`；对账未知仍为 awaiting；查询失败不得推出写操作失败或自动补写 |
| C11 `operation.retry` | 运维/任务调度器 | jobId、expectedRevision、reason、人工或自动证据引用、原任务 context | 原 jobId/opId、attempts、nextAttemptAt、新状态 | `device.operation.retry`；原组织 | 只允许 retryable_failed；保持原 opId 和原 requestDigest，取得新租约，不重新创建厂商凭证 | `operation.retryScheduled` | awaiting/succeeded/terminal/cancelled 不得直接重试写；证据不足→`CONFLICT` 或转人工，参数待 Q05 |
| C12 `event.verify` | 事件接收服务 | 平台回调/设备事件载荷、来源上下文、组织匹配上下文 | matchedJobId/action 或 rejected | 官方鉴权机制待现场证据；不接受调用者声明 orgId | 验签/鉴权、防重放、时间窗、任务/设备/组织匹配；只推进匹配任务，未知事件不建业务记录 | `event.matched/rejected` | 无鉴权/重放/错组织/未知任务→拒绝并审计；重复或乱序事件不得回退终态或触发补写 |
| C13 `audit.read` | 审计查询后端 | orgId、对象类型/ID、时间范围、分页、context | 脱敏日志与操作历史，不含人脸/凭据/完整摘要 | `device.audit.read`；组织内 | 只读、按权限过滤、分页有界；不因审计查询改任务状态 | `audit.read` | 跨组织或无权限→`DENIED`；审计读取本身不等于私密文件读取授权 |

### 2.1 共同输出与 HTTP 边界（待复审）

建议服务层保留结构化 `{code, jobId?, retryAfterMs?, detail?}`，但 `detail` 必须脱敏，不直接返回厂商原始报文。业务读取建议同时返回 `grantState` 和 `jobState`，避免只返回一个混合状态。是否对外采用扁平 `state`，以及 `DENIED/CONFLICT/RETRYABLE/TERMINAL/UNKNOWN_RESULT/NOT_CONFIGURED` 到 HTTP 状态与错误信封的映射，由 Q01/Q09 决定；不得通过 404/409 差异泄露其他组织设备 owner。

`OperationResult.state` 使用 LOCK-01A 持久任务枚举，不能新增 `processing/failed/revoking/revoked` 写入该字段。`providerRequestId` 是可选输出，不是 Mock 必须伪造的厂商事实。

## 3. 状态机：三轴分离

### 3.1 业务 grant 状态（5 项）

枚举沿用原设计；除“退租/资格失效立即 revoked”外，具体迁移和恢复条件是 P 类提案，须经 Q01/Q06 复审，不能视为现有状态机已经批准。

| 当前状态 | 合法迁移/保持 | 迁移条件 | 终态、重试与对账 |
| --- | --- | --- | --- |
| `pending` | `pending`；`effective`；`suspended`；`revoked`；`expired` | effective 需当前资格有效、批准凭证及成功结果；资格暂时不可用可 suspended；失效立即 revoked | 非终态；失败不自动等于 revoked，除非资格/业务事实已失效；awaiting 时不得标 effective |
| `effective` | `effective`；`suspended`；`revoked`；`expired` | 每次开门/事件处理仍独立校验当前 grant、入住、人员与设备；退租或资格失效立即 revoked | 非终态；设备撤权状态不改变已发生的 revoked；模拟结果不构成真实设备生效 |
| `suspended` | `suspended`；`effective`；`revoked`；`expired` | 仅在资格恢复且重新校验后可 effective；永久失效直接 revoked | 非终态；不得因撤权失败恢复 effective |
| `revoked` | 仅保持 `revoked` | 退租、资格失效、显式撤权或旧 owner grant 失效后立即写入 | **业务终态**；可重试的是未确认设备清理任务，不是恢复 grant；同周期重建规则另需 Q06 |
| `expired` | 仅保持 `expired`；明确人工撤权语义是否可转 revoked 待 Q06 | 当前时间超过有效业务期限；新入住使用新 cycle/slot | 业务终态；过期后的设备清理与业务状态分离，不能重新激活旧周期 |

### 3.2 持久 job 状态（7 项，LOCK-01A 原枚举）

| 当前状态 | 合法下一状态 | 迁移条件 | 终态/重试/人工对账 |
| --- | --- | --- | --- |
| `queued` | `sending`、`cancelled` |  worker 取得有效租约且发送前资格仍有效；失效则取消 | 非终态；可等待调度，未发送前不得称成功 |
| `sending` | `succeeded`、`retryable_failed`、`terminal_failed`、`awaiting_result` | 唯一有效租约下发；回写只能进入 LOCK-01A 指定的四种状态 | 非终态；不得直接回 queued/sending 形成隐式重试；租约恢复需先确定上次结果 |
| `awaiting_result` | `awaiting_result`、`succeeded`、`retryable_failed`、`terminal_failed` | 发送后超时、断连、解析失败或未知码进入；仅查询/人工对账可推进 | **不得自动重试写操作**；对账未明则保持；证明未执行后可转 retryable_failed，再按规则重试 |
| `succeeded` | 仅保持 `succeeded` | 有可归属任务的成功结果；模拟证据仍为 simulated | 任务终态；重复/迟到回调幂等确认，不重复下发；不表示业务资格永远有效 |
| `retryable_failed` | `sending`、`cancelled` | 只有确认未执行或厂商明确幂等/可重试，持 `device.operation.retry` 权限重新租约 | 非终态；沿用原 opId/requestDigest；参数和调度待 Q05 |
| `terminal_failed` | 仅保持 `terminal_failed` | 已确认终态失败，或人工对账作出终态决定 | 任务终态；告警人工复核，不能改按普通 retry；新业务决定必须新操作 |
| `cancelled` | 仅保持 `cancelled` | 尚未发送且资格失效、业务取消或运维终止 | 任务终态；若业务仍有效但确需下发，须新建带独立审计的操作，不能复活旧任务 |

恢复补充：worker 崩溃后若无法证明 `sending` 请求未执行，必须转 `awaiting_result`，不能直接重新发送。厂商成功后 DB 回写失败靠 op_id 去重和对账恢复，不重复创建厂商凭证。

### 3.3 API 展示/投影状态（7 项，P，不替换持久枚举）

| 展示状态 | grantState + jobState 投影 | 合法展示迁移 | 终态、重试与人工对账 |
| --- | --- | --- | --- |
| `pending` | grant=pending，尚无任务或当前 job=queued | →processing / succeeded / failed / awaiting_result / revoking / revoked | 非终态；queued 尚未证明设备执行 |
| `processing` | 当前 job=sending，或 grant=effective 且更新任务 queued/sending | →succeeded / failed / awaiting_result / revoking / revoked | 非终态；processing 只是展示名，不写入 job.state |
| `succeeded` | 当前所需 job=succeeded；grant 是否 effective 仍单独返回；Mock 标 simulated | 资格变化→revoking/revoked；新更新→processing | 本次任务终态，不是永久授权；重复结果保持 |
| `failed` | 当前 job=retryable_failed / terminal_failed / cancelled，且无更高优先级投影 | retryable_failed 经许可→processing；业务失效→revoking/revoked | 是否终态由底层 job 决定；必须返回可区分原因，不以 failed 自动重试 |
| `awaiting_result` | 当前 job=awaiting_result，且业务未进入撤权投影 | 查询/人工对账→succeeded/failed；资格失效→revoking/revoked | 保持待查；**不存在 awaiting_result→自动重复写入的路径** |
| `revoking` | grant=revoked/expired/suspended 且 cleanupPending=true（清理任务 queued/sending/awaiting_result/retryable_failed/terminal_failed）；或设备转移待清理 | 清理确认且无其他未决清理→revoked；失败可停留 revoking 并告警 | 不是 grant 枚举；撤权失败仍保持业务失效，revoking 可长期存在 |
| `revoked` | grant=revoked 且 cleanupPending=false；设备清理结果另以 jobState/cleanupState 返回 | 仅保持；新业务授权走新周期/新操作 | **不等于设备已经删除**；无任务或无证据也可能落此投影，失败任务继续告警与对账，不恢复 grant |

建议投影优先级为 `revoking > revoked > awaiting_result > processing > failed > succeeded > pending`，仅用于解决同一对象的展示冲突，不能反向修改持久状态。Q01 必须确认“当前任务”的选择规则、expired/suspended 的展示方式，以及业务已经 revoked、清理 terminal_failed 时是否展示 `revoking + failedReason`，而不是展示 revoked 让调用方误认为无残留。建议 DTO 返回 `grantState/jobState/displayState/evidenceScope/cleanupPending`，但是否扁平化由 Codex 拍板。

## 4. 字段证据映射（22 项）

下表“缺失行为”针对真实适配器必需信息；Mock 不得借缺失信息编造真实能力。所有厂商候选字段均只有 F 类产品族文档证据，`目标验证=否`；C/D/P 项是业务或服务映射，也不构成设备验证。具体页码、章节和字段定义见 [HK-AI-01 §3、§5](HIKVISION-ISAPI-EVIDENCE-MATRIX.md)。

| ID | 业务/服务字段 | 厂商候选字段/路线 | 等级 | 适用范围 | 目标验证 | 缺失/不符时 fail-closed |
| --- | --- | --- | --- | --- | --- | --- |
| F01 | `personId` | `UserInfo.employeeNo` ↔ `FaceDataRecord.FPID` 的受控稳定映射 | C+D+F | 门禁人员与人脸关联；不使用手机号 | 否 | 未取得 employeeNo 长度、字符和压缩能力前不生成最终编码；映射缺失即不下发 |
| F02 | `credentialId/sourceFileId` | 不直接等于 `faceURL`；候选 `img` 或 `modelData` 路线 | C+D+F+P | DB-07 private 人脸到受控 Provider 输入 | 否 | 非 private/ready/face-biometric 即拒绝；不将私密 ID 暴露成公网 URL；路线未定不联网 |
| F03 | `validFrom` | `UserInfo.Valid.beginTime` | C+F | 有期限人员权限 | 否 | 时区/NTP 未明或日期非法→拒绝；不得填默认长期时间 |
| F04 | `validUntil` | `UserInfo.Valid.endTime` | C+F | 有期限人员权限 | 否 | 缺失或不在租期内→拒绝；不得永久有效 |
| F05 | grant 有期限语义 | `UserInfo.Valid.enable=true` + `timeType` | C+F | 必须绑定租期 | 否 | **业务 revoked 不得映射为 `enable=false`**；文档 false 为长期有效，撤权走删除路线 |
| F06 | 设备/门映射 | `UserInfo.doorRight`、`RightPlan[].doorNo` | D+F+P | 经审批设备与门编号映射 | 否 | 映射未审批、为空或以房间号代替门号→禁止下发 |
| F07 | 授权周期/计划 | `UserInfo.RightPlan[].planTemplateNo` | D+F+P | 与 doorRight 联合使用 | 否 | 未知或特殊模板 65535/65534/65533 未审批→拒绝；不只传 doorRight 形成长期权限 |
| F08 | 人员角色/资格 | `UserInfo.userType` | D+F | 普通住户/访客等最小权限 | 否 | 不使用 administrator 规避校验；项目黑名单不自动映射 blackList |
| F09 | 必要显示名 | `UserInfo.name`、`FaceDataRecord.name` | D+F | 仅必要业务显示名 | 否 | 目标要求未确认则不决定必填；不进入普通日志，不额外采集 |
| F10 | 无业务出生日期字段 | `FaceDataRecord.bornTime` 通用 schema 候选 | F+P | 只用于说明隐私冲突，不是采集决定 | 否 | 不因通用 schema 必填而收集或编造生日；待厂商确认可省略/替代，否则不开放该写路线 |
| F11 | 能力核验引用 | `AccessControl.isSupportUserInfo/isSupportFDLib/isSupportUserInfoDetailDelete` | C+F | 对应人员、人脸、明细删除前置 | 否 | 缺失、false 或证据过期→`NOT_CONFIGURED`，不得调用相应写接口 |
| F12 | 操作能力白名单 | `UserInfo.supportFunction`、`FDLib.supportFunction` | C+F | 按 post/put/get/setUp/delete 逐项判定 | 否 | 缺具体操作能力→拒绝对应操作；不得以总能力替代 |
| F13 | 人脸库引用 | `FDID`、`FaceDataRecord.FDID` | F | 目标已存在人脸库 | 否 | 未读取并复核目标库→不写死 1、不自动建库、不下发 |
| F14 | 人脸库类型 | `faceLibType`、`FaceDataRecord.faceLibType` | F | 与 FDID 联合确定库 | 否 | 不确定→拒绝；厂商 blackFD 不等同项目黑名单 |
| F15 | 文件策略与媒体输入 | `FaceDataRecord.img` 等候选；平台 JPEG/PNG、200 KiB | C+D+F | AI-C 平台边界与目标厂商边界分开 | 否 | 平台超 200 KiB/类型不符直接拒绝；目标大小、分辨率、质量、传输方式未确认不得宣称兼容 |
| F16 | 人脸模型数据 | `FaceDataRecord.modelData` | C+F | 私密生物特征候选路线 | 否 | 不进日志、普通响应或公开 fixture；来源/格式未确认不得生成 |
| F17 | 分页与批量边界 | `UserInfoSearchCond.searchResultPosition/maxResults/EmployeeNoList` | F+P | 查询对账与批量任务 | 否 | 上限不写死 100/56；capability 未知则不做真实批量；分页必须完整 |
| F18 | 人员/人脸容量 | `UserInfo.maxRecordNum`、`FDLib.FDRecordDataMaxNum`、`FDCapacity.*` | F | 容量预检，不代替逐人对账 | 否 | optional 缺失不得按 0 或无限制；未确认容量→真实下发关闭 |
| F19 | `providerRequestId` | **未确认厂商请求 ID 字段** | C+P | 可选对账线索，不得伪造 | 否 | 缺失时只按 jobId 及经确认查询线索对账；不能编造，查询路线待 Q07 |
| F20 | 事件唯一 ID/结果 | `EventNotificationAlert.eventType` 仅是事件类型，**不是唯一 ID** | C+F+P | 回调验签、防重放、任务匹配 | 否 | 无官方唯一 ID、鉴权或时间窗→拒绝状态推进；未知事件不建业务记录 |
| F21 | 删除进度/无残留 | `UserInfoDetail/DeleteProcess`；人员/人脸查询对账 | C+F | 删除人员后闭环 | 否 | 无独立 schema 或枚举→不套用指纹接口；须轮询并回查人员/人脸，不能仅凭“开始删除”成功关闭 |
| F22 | 厂商错误映射 | HK-AI-01 项目错误码子集 50 条 | C+F | 文档错误码原始证据 | 否 | 全部保持 `retryability=undetermined`、`internalMapping=UNMAPPED`；未知码发送后→UNKNOWN_RESULT |

补充字段边界：

- AI-C 最新平台文件边界是 **private、JPEG/PNG、200 KiB**，`writePermission=device.face.submit`、`readPermission=device.face.readPrivate`；LOCK-01A 数据设计的 5 MB 示例不得覆盖此决定。200 KiB 是平台策略，不引用通用错误码中的“200KB”作为目标设备验收阈值。
- 同意版本、本人/代提交关系、保存期限、撤销/退租/过期销毁任务仍是 AI-C 后续依赖。本文保留输入位置，不声明这些能力已经可用。
- 设备型号/固件/硬件只保留必要身份及版本；序列号、MAC、证书、账号、nonce、完整 checksum、人脸 URL/二进制/模型不进入 fixture、日志或普通响应。
- 所有查询只限定当前组织、设备和人员；`faceURL` 不允许公网不可控地址。删除目标必须限定具体人员/FPID，空列表与批量删除 fail-closed。

### 4.1 候选端点使用边界（6 组）

以下只引用 [HK-AI-01 §3 的端点 ID](HIKVISION-ISAPI-EVIDENCE-MATRIX.md)，不重写或扩充其方法、路径和 schema。每组均为 `documentation=present / targetCapability=unverified / realCall=not-executed`，`allowedNow=false`；这不是 AI-D 的真实端点实现清单。

| 逻辑用途 | HK-AI-01 候选端点 ID | 已定位的文档含义 | 使用边界与缺失证据 |
| --- | --- | --- | --- |
| 身份与 capability | `SYS-DEVICE-INFO`、`AC-CAPABILITIES`、`USER-CAPABILITIES`、`FD-CAPABILITIES`、`FD-LIST`、`FD-COUNT-ALL` | 型号/版本、人员/人脸能力、库与容量只读候选 | 属 AI-02 受控只读范围，不因此批准 AI-04 调用；须型号/指纹/权限/真人批准及独立脱敏复核 |
| 录入 | `USER-RECORD`、`FD-RECORD`；候选 upsert `USER-SETUP`、`FD-SETUP` | 先人员后人脸的候选写入路线 | 未选 route；upsert 描述不等于厂商幂等；能力、图片、库、人员 ID 均未确认，禁止真实写入 |
| 更新 | `USER-MODIFY`、`FD-MODIFY` | 修改已存在人员/人脸的候选路线 | 可变字段和前后一致性待 Q07；延期 `DEFER-FDSEARCH-PUT-ALTERNATIVE` 不并行实现 |
| 查询/对账 | `USER-SEARCH`、`FD-SEARCH`、`USER-COUNT`、`FD-COUNT-ALL`、`FD-COUNT-BY-LIB` | 逐人/逐脸及容量查询候选 | 不是已确认的 `queryOperation` 厂商事务查询接口；只读仍需批准，须完整分页、限定目标并脱敏 |
| 撤权 | `FD-DELETE`、`USER-DETAIL-DELETE`、`USER-DETAIL-DELETE-PROCESS` | 人脸删除及人员明细删除进度候选 | 删除语义/schema 未闭环；必须回查人员/人脸；`FORBID-FDLIB-DELETE-ALL`、`FORBID-USERINFO-BULK-DELETE` 永远不在首期使用 |
| 事件 | `EVENT-ALERT-STREAM`、`EVENT-SUBSCRIBE-CAP`、`EVENT-SUBSCRIBE`、`EVENT-HTTPHOSTS-CAP`、`EVENT-HTTPHOSTS-GET`、`EVENT-HTTPHOSTS-PUT` | 长连接、订阅或设备主动推送候选 | 路线、鉴权、唯一 ID、防重放、目标限制均未确认；不得自动配置 httpHosts，连接成功不等于事件可信 |

其余候选 `SYS-CAPABILITIES` 只用于事件订阅能力判断；`FD-CREATE` 仅登记候选，不进入首期自动建库。27 个候选端点的完整方法、路径、章节、页码和开关以白名单及证据矩阵为唯一事实源，本文没有改动。

## 5. 错误分类与处理（9 项）

统一枚举只使用 `NOT_CONFIGURED / CONFLICT / RETRYABLE / TERMINAL / UNKNOWN_RESULT / DENIED`。下表是应用情形到枚举的建议映射；不把任一厂商码直接提升为可重试。`vendor` 和 `reason` 仅可保留脱敏安全信息。

| ID | 分类/触发 | 对外/内部枚举 | 任务与 grant 处理 | 重试、查询与人工对账 |
| --- | --- | --- | --- | --- |
| E01 | 发送前确定失败：本地校验拒绝，或有证据证明 DNS/连接失败且请求未发送 | `RETRYABLE`；单纯输入/状态非法可 `CONFLICT`/`DENIED` | 任务未发送→retryable_failed；资格/权限拒绝未发任务→cancelled；grant 不伪造设备成功 | 证明未执行才可退避重试；不能仅凭“离线”三个字推断未发送 |
| E02 | 发送后未知：断连、超时、解析失败、未知官方码、租约恢复无法证明未执行 | `UNKNOWN_RESULT{jobId}` | job→awaiting_result；grant 不升级 effective；已 revoked 保持 revoked | 只 queryOperation/人工对账；未明保持，禁止自动重复 enroll/update/revoke |
| E03 | 可重试失败：官方明确可重试且已确认未执行，或厂商明确幂等 | `RETRYABLE` | job→retryable_failed；保持原 opId/digest | `device.operation.retry` + 原任务条件写；调度、退避、上限待 Q05 |
| E04 | 终态失败：官方明确终态，或人工对账确认不可继续 | `TERMINAL` | job→terminal_failed；撤权场景 grant 仍失效并持续告警 | 不普通重试；人工复核后若需新业务操作，重新授权、审计、生成新 opId |
| E05 | 资格失效：退租、实名/人员/房间/组织/名单/设备状态不再满足 | 对已失效业务事实用 `DENIED`；版本竞争可 `CONFLICT` | 未发送任务 cancelled；相关 grant 立即 revoked；另建/保留撤权清理任务 | 不通过重试恢复资格；恢复需新的有效资格与授权决定；设备清理继续对账 |
| E06 | 跨组织访问或猜测 ID | `DENIED`（对外不泄露存在性） | 不改任务/grant，不返回 owner、文件、名单原因或私密元数据 | 重试无意义；审计拒绝事件，避免错误差异泄露 |
| E07 | 设备归属冲突：全局 claim 已属其他 owner、转移条件不满足、grant org≠owner | `CONFLICT` | 不写设备、不双 owner、不继续下发；已确认转移时旧 grant 立即 revoked | 只能审计转移/共享流程；转移前置歧义由 Q03 决定 |
| E08 | 幂等冲突：同 op_id 不同 digest、非法 key、slot/revision 竞争 | `CONFLICT` | 不覆盖原请求，不新建厂商副作用；同 key 同 digest 重放原结果 | 修正后使用新 key；不同 actorType 不互相重放；超期同键为新操作并审计 |
| E09 | 配置/证据未就绪：live 误选 Mock、配置不完整、能力/路线未批准 | `NOT_CONFIGURED` | 无任何下发，不回退模拟成功；真实 grant 不标 device_verified | 补齐配置和证据后走新受控执行；重试相同错误配置无意义 |

### 5.1 重试与对账算法约束

1. **发送前**：若已明确请求未发出，可记 retryable_failed；若无法明确是否发出，按发送后未知处理。
2. **发送后**：无论超时、连接中断、响应畸形或未知厂商码，先持久化 awaiting_result，记录安全错误引用；不得原地循环重发。
3. **查询**：queryOperation 不生成新的写任务。查询回包必须匹配 org/device/job/operation 和已确认的请求关联；查询自身失败不等于原写失败。
4. **成功对账**：以条件写推进原任务，重复回写幂等；不得重新创建厂商人员/人脸。模拟环境只写 simulated。
5. **失败对账**：仅证据充分时区分 retryable_failed/terminal_failed；否则继续 awaiting_result。人工决定需要角色、理由、时间和证据引用。
6. **撤权**：grant 已先失效。撤权未知/失败保留 cleanupPending 与告警，不能因设备不可用而恢复 grant。
7. **历史**：op key 保存不短于任务历史；具体期限待 Q06。超期同键作为新操作并审计，不静默重放。

## 6. Mock 场景与验收（20 项）

实现建议：Mock 只接受结构化、显式的 test scenario 配置，不依赖真实主机、账号或网络故障；外部响应不得控制 Mock 场景。fixture 全部使用合成 ID、合成图片字节和模拟事件，命名包含 `simulated`，不包含任何厂商原始响应或真实人脸。持久化 `executionMode=demo/test`、`provider=mock`、`evidenceScope=simulated`。

| ID | 场景与合成触发 | 预期状态/结果 | 必须断言 |
| --- | --- | --- | --- |
| M01 | 录入成功：有效资格 + approved credential + demo | queued→sending→succeeded；grant 可按规则 effective | evidenceScope=simulated；无 device_verified；审计完整，无真实网络 |
| M02 | 更新成功：effective credential + 合法变更 | 原任务终态不被改写；新 opId 成功 | 不重复创建厂商凭证；更新范围未冻结前仅使用 Mock 批准字段 |
| M03 | 撤权成功：有效 grant 被退租触发 | grant 先 revoked；清理 job 后 succeeded | 任一设备清理状态不回写 grant；返回业务/任务双状态 |
| M04 | 设备离线且证明未发送 | RETRYABLE → retryable_failed | attempts/nextAttemptAt 合规；不发第二次请求；与 M06 严格区分 |
| M05 | 发送前资格/输入失败 | DENIED 或 CONFLICT；未发送任务 cancelled/不创建 | 无厂商副作用；资格失败不默认 RETRYABLE；失败审计脱敏 |
| M06 | 发送后断连 | UNKNOWN_RESULT → awaiting_result | 自动重复写入次数=0；查询前状态保持；grant 不升级 effective |
| M07 | 发送后超时 | 同 M06 | 不将 timeout 当作未执行；无新 opId/新厂商凭证 |
| M08 | 发送后畸形响应/解析失败 | UNKNOWN_RESULT → awaiting_result | 原始敏感报文不入日志；禁止自动重试 |
| M09 | 未知厂商码（发送后） | UNKNOWN_RESULT → awaiting_result | 不自行映射 RETRYABLE/TERMINAL；保留安全错误引用 |
| M10 | 明确终态失败 | TERMINAL → terminal_failed | 普通 retry 拒绝；告警；不标成功，不自动换 route |
| M11 | 撤权可重试失败 | grant=revoked；revoke job=retryable_failed；cleanupPending=true | 持续告警；只重试原清理任务，不恢复 grant |
| M12 | 撤权发送后未知 | grant=revoked；revoke job=awaiting_result | 不自动重复删除；查询/人工对账后才推进；无假成功 |
| M13 | 重复成功回调 | 第一次 matched；后续 matched/幂等确认 | job 仍 succeeded，状态历史不伪造新迁移；写操作仅一次 |
| M14 | 重复失败/未知回调 | 幂等处理或 rejected，不覆盖更终态事实 | 不从 succeeded 倒退 failed/awaiting；不触发重发 |
| M15 | 乱序回调：成功后收到先前 sending/失败 | 迟到旧事件被忽略/拒绝并审计 | 终态不回退；状态版本/事件顺序规则可测试 |
| M16 | 未知任务或错组织回调 | rejected | 不创建业务记录；不泄露匹配到的他组织 job/device |
| M17 | 同 op_id 同 digest 重放 | 返回原 job/result | 副作用仅一次；actorId/actorType/org/route 参与作用域 |
| M18 | 同 op_id 不同 digest；同 actorId 不同 actorType 同 key | 前者 CONFLICT；后者不同 opId、均可执行 | 不覆盖原 digest；user/system/agent 互不重放；另测非法 key 拒绝 |
| M19 | 双 worker + 资格并发失效 | 租约仅一个有效发送；失效后未发送任务 cancelled；grant 立即 revoked | 不重复下发；旧 epoch/revision 不回写；撤权清理任务仍可追踪 |
| M20 | live 误选 Mock 或配置不完整 | NOT_CONFIGURED，零下发并审计 | 无 simulated 成功、无 device_verified、无静默 route/provider 切换 |

附加回归应覆盖：同 actor/route 不同 key 允许新操作；超保存期同键新建并审计；查询对账成功后 enroll/revoke 均不重复下发；跨组织读取/重试/审计拒绝；无 `device.face.readPrivate` 的 reviewer 不能读取原图；权限撤销后下一次读取立即拒绝。

Mock 验收必须同时核对数据库状态、追加日志、权限审计、网络调用替身计数和证据字段，不能仅检查 API 返回 200。测试断言中的“零真实网络”应通过禁用真实适配器/网络出口及调用计数验证，而不是 Mock 自报。

## 7. 已确认项、未确认项与依赖

### 7.1 可作为 Mock 编码输入的既定项

1. Provider 五方法、FaceAccessContext 和六个错误枚举不改变。
2. grant 五状态、job 七状态不改变；本文七展示状态需单独确认 DTO，不反向修改持久枚举。
3. 全局设备 owner、周期 grant slot、op_id 固定 ID、requestDigest、revision 条件写、任务租约和只追加日志沿用既定设计。
4. 未知结果对账、业务先失效、外部联网在事务外、Mock 证据隔离均为强制安全语义。
5. 资格校验接入 DB-02～DB-06；私密文件接入 HK-AI-03 的最新文件权限和 200 KiB 策略。

### 7.2 等待 AI-C / 集成证据

| 依赖 | 需要交付/复核 | 未满足时的处理 |
| --- | --- | --- |
| AI-C-01 | HK-AI-03 合并后的 DB-02～DB-07 全量测试与真实服务导出接口 | AI-D 不自行重写人员/入住/名单/文件逻辑；以接口对接并复跑集成测试 |
| AI-C-02 | face-biometric private、JPEG/PNG、200 KiB、安全像素解码及资源限制；提交/审核/私读权限 | 不合规文件 fail-closed；不把平台限制写成设备限制 |
| AI-C-03 | 同意版本、本人/代提交关系、保存期限、撤销/退租/过期销毁 | 未交付前标记未完成，不造默认同意或永久保存 |
| AI-C-04 | 资格快照接口：person/identity/occupancy+cycle/guards/room/org/device 的版本化读取与事务写入协作 | 没有事务内重验不得落有效 grant 或发送任务 |
| AI-C-05 | DB-08 返工后正式服务/共享事务核心的隔离探针证据 | 不把简化探针或 dry-run 当云端事务、索引、规则、容量证明；不在生产云执行 |

### 7.3 等待厂商/现场证据

对应 [HK-AI-01 H01～H16](HIKVISION-ISAPI-EVIDENCE-MATRIX.md)：

- **现场 H01/H02/H03**：完整铭牌、后缀、固件/硬件/区域版本及裸型号指南适用性。
- **只读 capability H04～H07**：人员、人脸、删除能力，employeeNo 约束，FDID/faceLibType/库容量；真实只读探针需另行复审与批准，当前不执行。
- **媒体与权限 H08/H11/H12**：目标图片约束、门/计划模板映射、name/bornTime 最小化及真实校验。
- **安全与删除 H09/H10/H13**：HTTPS/Digest、设备时间、最小权限账号、删除 schema 和级联行为、事件认证/唯一 ID/防重放。
- **许可、隔离与隐私 H14～H16**：许可/配额、隔离网络、测试同意、保存期限与无残留签字。

这些事项未关闭前，真实 Provider 写路线仍关闭；AI-B 的 dry-run 或离线测试通过不等于 capability 证据。

## 8. 需要 Codex 拍板（9 项）

| ID | 决策问题 | 本文安全默认/可选建议 |
| --- | --- | --- |
| Q01 | 七展示状态是否采用？DTO 是返回 grantState + jobState + cleanupPending，还是扁平 displayState？ | 建议三轴均返回； revoked 必须不暗示设备删除完成 |
| Q02 | accessGrant.create/revoke 的权限点及谁能代表退租/资格服务调用？ | 未决定前不能默认管理员；内部服务身份与人工权限分离并审计 |
| Q03 | device.transferOwner 权限及“存在有效 grant/job 拒绝”与“转移后旧 grant 失效”的先后规则？ | 有未关闭 job 先拒绝；无有效 grant 才转移最保守。若允许带 grant 转移，须同事务先 revoked + 落撤权任务再变更 owner，且定义清理期 owner 语义 |
| Q04 | queryOperation 使用哪个已存在/新权限？人工对账角色、证据格式及二次复核要求？ | 默认组织内最小权限；审计读权限不自动获得操作/私读权限 |
| Q05 | retryable 证据来源、自动/人工边界、退避、上限、租约恢复和告警频率？ | awaiting 永不自动重写；retryable 保持 opId/digest，调度参数不写死 |
| Q06 | op key/任务历史保留期；slot 同 cycle 重建、expired 后显式撤权状态、凭证多版本策略？ | 默认历史不短于任务；新入住新 cycle；禁止复活旧 grant/cycle |
| Q07 | 无 providerRequestId 时，各路线如何按 job/device/person/operation 对账？updateFace 允许变更哪些字段？ | 未确认前只 Mock，不编造请求 ID 或查询关联；最小字段集、完整条件写 |
| Q08 | 事件采用哪种路线及鉴权、唯一事件 ID、时间窗、防重放、乱序版本规则？ | 无官方证据则 rejected；eventType 不能充当事件 ID，心跳不推进业务 |
| Q09 | 上述逻辑操作如何映射 HTTP 路由、revision 参数及统一错误信封？跨组织是否统一 404？ | 服务层语义先于路由决定；不泄露他组织资源存在性，HTTP 200 不代表设备成功 |

Codex 复审时应明确：哪些 P 项被接受、哪些需修改、哪些是 AI-D 编码硬阻塞。复审通过前本文不能标为“冻结契约”。

## 9. 给 DeepSeek Harness 的实现输入清单

前置：仅在 Codex 复审通过并指定整合基线后，在 HK-AI-03 交付的 DB MVP 基线上开发；不要从本文档基线直接假设生产集合已经存在。

1. **基线核对**：记录 HK-AI-03 实际 commit、服务导出与 DB-02～DB-07 全量测试；保留 LOCK-01A 的方法、枚举、op_id 公式及错误类型。
2. **数据结构**：实现 `access_devices`、`face_credentials`、`device_access_grants`、`device_operation_jobs`、`device_operation_logs` 及固定 `device_claims/grant_slot_claims/operation_keys`；不得自行加唯一索引假设。
3. **事务核心**：设备 claim、grant slot、资格 guards、op key、job/log 写入复用正式事务原语；外部网络在事务外。不要为测试另写一套简化资格逻辑。
4. **资格接口**：按 AI-C-01/04 对接稳定 personId、approved 实名、有效入住周期、名单决定、人员/房间/组织状态；每次下发前重新检查。
5. **文件接口**：按 AI-C-02/03 对接私密文件、提交/审核/私读权限、同意与销毁；日志与响应只做最小引用。
6. **任务执行**：实现 queued→租约 sending→四种允许结果的持久状态机；awaiting 不自动重写，retry 保留 opId/digest，崩溃恢复默认未知。
7. **业务失效**：退租/资格/owner 变化先使 grant 失效，再按设备生成撤权任务；设备失败持续告警，绝不恢复业务授权。
8. **Provider 边界**：只实现显式 demo/test Mock；live 选 Mock/配置不完整→NOT_CONFIGURED；不实现真实 Hikvision Provider、不新增真实 ISAPI 路由。
9. **证据字段**：任务、授权、报告持久化 executionMode/provider/evidenceScope；Mock 只能 simulated，禁止 device_verified。
10. **Mock 验收**：逐项实现 M01～M20，含调用次数、重复/乱序事件、并发与跨组织负向测试；测试数据完全合成且可清理。
11. **审计与脱敏**：所有决定、重试、对账、私读和拒绝可追踪；操作日志只追加；不落原始人脸、密钥、完整摘要、账号或设备敏感标识。
12. **暂缓项**：凡 Q01～Q09 未拍板、AI-C 或现场证据未提供，不得自行补全权限、路由、字段、容量、FDID、图片限制、删除语义或厂商错误映射。

### 9.1 本阶段完成定义

本任务只完成上述核对文档。AI-D 的完成应另附实际提交、测试结果、集合/状态机、Mock 场景、与 HK-AI-03 的依赖和未关闭阻碍；本文不构成编码、云端验证、设备验证或发布批准。
