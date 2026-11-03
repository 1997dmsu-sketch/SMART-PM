# DB-08 隔离云探针与执行交接

状态：**第一轮审查返工已完成本地实现与回归；真实隔离云探针未执行，索引未创建，安全规则未应用，生产数据库未连接或操作。** 基线为 DB-05 通过点 `b9ee06118b053a458d3458241e2341ea5a4dc7e1`，开发分支为 `feat/db-08-cloud-probes`，不合并 main。返工复审通过前，不得在任何现用云环境执行本探针。

本轮不修改登录、实名、门锁或既有业务服务，不实现 DB-07 文件模块。`file_assets`、`file_links` 仅作为后续接口的安全与索引验收对象。

## 1. 第一轮审查问题与返工

| 审查问题 | 返工内容 | 本地回归 |
|---|---|---|
| 探针复制简化业务算法 | 新增 `service-store.mjs`，只转换逻辑／物理文档 ID，业务判断和事务重试全部交给 DB-03～DB-06 正式服务 | 将 `IdentityService.login` 替换为故障实现，探针必须失败并保留原始错误 |
| 固定身份只覆盖单一 winner，反向顺序出现异常 | 手机号、微信和证件均显式执行 winner=0／1；手机号和微信断言落后请求通过正式 `IDENTITY_RETRY`／owner-ref 路径重试，两个请求都解析到 winner 的稳定 ID | 三类身份双向顺序均通过；证件另一候选必须为 `IDENTITY_CONFLICT` |
| 安全适配器可自报通过，本地同名后端可冒充云证据 | 分离执行适配器、独立证据验证器和管理回查；以模块私有能力注册识别云后端；报告改为逐场景证据范围 | 零云调用、同名本地后端和虚假适配器均不能获得 `cloudEvidenceAccepted=true`；缺少独立验证器时为 `incomplete` |

## 2. 文件与证据边界

- `admin-web/probes/db08/manifest.mjs`：场景、索引、安全检查及严格执行参数。
- `backend.mjs`：统一文档前缀、组织白名单、事务引用预算、查询边界、审计、清理和云能力校验；云 SDK 只在真实执行时动态加载。
- `service-store.mjs`：将正式服务产生的随机 UUID／固定 HMAC ID 映射到本批次前缀下的物理 ID，不复制或替换业务算法；提供事务和读取时序钩子。
- `transaction-probes.mjs`：调用正式服务执行身份、入住、名单、组织和批量场景；底层后端只直接承担索引查询及 90／91 引用边界检查。
- `security-probes.mjs`：19 项原始证据校验、独立回查、管理审计读取和对象匿名反向请求。
- `run.mjs`：默认 dry-run、真实隔离执行入口及 schemaVersion 2 结果 JSON。
- `admin-web/tests/db08-probes.test.mjs`：内存后端、故障注入和独立证据模拟回归。

`LocalProbeBackend` 的场景通过只证明本地逻辑和回归，不证明云端并发、事务回滚、索引或安全规则。本地报告为 `executionScope=local-only`，事务证据为 `local-only`，模拟安全证据为 `local-independent-simulation`；均不能作为云验收。

云能力不根据类名或 `evidenceScope` 字符串判断。只有实际构造并注册的 `CloudProbeBackend` 才可能形成 `isolated-cloud*` 证据；真实安全场景还必须使用绑定该后端的 `CloudSecurityEvidenceVerifier`。每个云场景必须有实际云调用，否则以 `CLOUD_EVIDENCE_MISSING` 失败。

## 3. 正式服务覆盖矩阵

| 场景 ID | 正式服务／共享边界 | 通过条件 |
|---|---|---|
| `identity-phone-fixed-id` | `IdentityService.login` | winner=0／1 均只有一条映射和一个 userId；两个请求均稳定解析；落后请求发生正式 owner-ref 重试 |
| `identity-wechat-fixed-id` | `IdentityService.login` | 与手机号相同的双向 winner、重试和稳定解析断言 |
| `identity-document-fixed-id` | `VerificationService.review`＋正式 `verified-person` `unique_claims` | winner=0／1 均只有获胜申请通过；固定 claim 指向获胜人员；另一申请为 `IDENTITY_CONFLICT` |
| `primary-slot-contention` | `OccupancyService.createCycle`＋`activate` | 仅一个 active 主关系；固定主槽指向该关系；另一操作冲突 |
| `blacklist-activation-race` | `BlacklistService.createEntry`＋`withEligibility`＋`OccupancyService.activate` | 在正式候选读取窗口提交名单后必须重读；激活保持待审，主槽不创建 |
| `occupancy-review-request-race` | `BlacklistService.reviewOccupancy`＋`OccupancyService.createCycle` | 两种提交顺序均只放行原始人员、房间、期限及请求摘要；换参请求拒绝 |
| `organization-isolation` | `OrgService.requireMembership`＋正式人员、物业和入住服务 | A/B 数据过滤；伪造成员和跨组织房间／人员引用失败且无入住写入 |
| `index-query-smoke` | 正式服务准备夹具＋`ProbeBackend.query` | 17 条候选查询先按组织过滤，再排序分页；`_id` 次序稳定；不自动建索引 |
| `security-access-rules` | 独立安全执行／回查协议 | 19 项决定均经独立回查；两项敏感正向读取经管理通道核对审计；五次对象反向请求符合预期 |
| `transaction-reference-budget` | `ProbeBackend` 共享事务边界 | 总引用 90 可执行；总引用 91 在事务和网络请求前以 `TRANSACTION_REF_LIMIT` 拒绝 |
| `room-batch-1000` | `OrgPropertyService.createRooms`＋正式 `OpReplay` | 40 批×25 间；最终恰好 1000 间；40 批完整重放无重复；引用不超应用预算 |

90 是本应用的安全预算，**不是已测定的云平台极限**。1000 间是本场景容量，**不是平台最大容量或生产扩容认证**。

## 4. 默认 dry-run

```bash
node admin-web/probes/db08/run.mjs --dry-run
# 或
npm --prefix admin-web run probe:db08 -- --dry-run
```

本次实际 dry-run 输出：11 个场景、17 条索引候选、19 项安全检查；`cloudCalls=0`、`cloudWrites=0`、`credentialsRead=false`。dry-run 不初始化云后端、不加载云 SDK、不读取云凭据。

可用 `--only scene-id,scene-id` 限定场景；未知场景或参数直接失败。`--run-id` 仅允许 `db08-` 开头的小写字母、数字和单连字符。

## 5. 真实隔离执行前置条件（本轮未执行）

1. 必须等待返工复审通过，再由负责人另行创建并人工确认**专用、可清空的隔离测试环境**。环境名必须包含 `test`、`probe` 或 `isolat`，并排除 `prod`、`live`、`release`、`main`。代码校验不能替代人工确认环境。
2. 明确批准该环境的测试写入。严禁使用生产凭据或含现有生产数据的环境。凭据只通过进程环境注入，不写入仓库、报告或命令输出。
3. 事务探针使用显式的 `DB08_CLOUD_SECRET_ID`、`DB08_CLOUD_SECRET_KEY`。管理 SDK 具有绕过低权限客户端规则的能力，不能用于证明客户端拒绝规则。
4. 安全场景必须同时配置 `DB08_SECURITY_ADAPTER` 和 `DB08_SECURITY_VERIFIER`。前者用非特权身份实际发起请求，后者独立检索对应证据并执行对象反向请求；二者不能仅凭同一自报布尔值形成通过。
5. 两项受控服务正向读取必须产生本批次审计，探针通过管理回查后端读取并核对 actor、org、resource、action。没有执行适配器、独立验证器或管理回查后端时，安全场景为 `not-run`，总报告为 `incomplete`。
6. 所有输入均为合成摘要和测试记录。不得传入真实手机号、OPENID、证件、证据内容或生产文件。DB-07 未实现，真实隔离文件对象和服务读取路径仍须后续实现与审查。
7. 按 `DB-08-INDEXES.md` 人工核对隔离环境的实际索引。本工具不会创建索引或修改安全规则；缺失索引或规则不一致应记录失败，不得自动修补后宣称原配置通过。

安全执行适配器返回的是**原始证据，不是通过结论**。协议核心字段如下：

```js
{
  privileged: false,
  async prepare(context) {}, // 可选；只能创建合成、本批次前缀夹具
  async check(check, context) {
    return {
      envId: context.envId,
      actorType: check.actor,
      tokenType: "isolated-test-token", // anonymous 必须为 none；禁止 management-sdk
      transport: check.channel,
      requestId: "actual-request-id",
      observedAt: Date.now(),
      httpStatus: 403,
      errorCode: "PERMISSION_DENIED", // 成功时为 null
      rawResponse: { /* 实际原始响应 */ },
      responseDigest: "<sha256(JSON.stringify(rawResponse))>",
      target: {
        orgId: context.orgId,
        action: check.action,
        resourceId: "<本批次资源 ID>",
        collection: check.collection, // 如清单包含
        purpose: check.purpose, // 如清单包含
      },
      // requiresAudit 时另返回本批次 auditId 及预期 actor/action/resource 字段
      // storage 或 forbidPublicUrl 时返回 objectUrl；私密对象 publicUrl 必须为 null
    };
  },
  async cleanup(context) {},
}
```

独立验证器的 `verify(check, evidence, context)` 必须独立找到同一请求，返回相同 `requestId`、`responseDigest`、`targetDigest` 和 `actorType`，以及 `observedDecision`、`verifiedAt`、`evidenceRef`、`verificationMethod`。`reverseRequest` 对 `objectUrl` 发起独立匿名请求，返回实际响应及摘要。摘要一致性和决定不符均失败，不能由适配器声明 `pass` 代替。

## 6. 后续隔离执行与结果判定示例

以下仅为后续经批准的操作手册，**本次没有运行这些命令**。

```bash
export DB08_PROBE_ENV='db08-isolated-test'
export DB08_PROBE_CONFIRM='db08:db08-isolated-test:db08-20261103-a-a'
export DB08_CLOUD_SECRET_ID='< isolated-only credential >'
export DB08_CLOUD_SECRET_KEY='< isolated-only credential >'
export DB08_SECURITY_ADAPTER='/absolute/path/to/isolated-security-adapter.mjs'
export DB08_SECURITY_VERIFIER='/absolute/path/to/isolated-security-verifier.mjs'

node admin-web/probes/db08/run.mjs \
  --execute-isolated \
  --run-id db08-20261103-a \
  > db08-20261103-a-result.json
```

`DB08_PROBE_CONFIRM` 必须精确等于 `db08:<环境名>:<orgA>`。schemaVersion 2 报告按场景记录 `status`、`evidenceScope` 和 `cloudCalls`。只有全部已选场景均为 `pass` 且证据范围以 `isolated-cloud` 开头，才有 `cloudEvidenceAccepted=true`；`not-run` 使总状态为 `incomplete`，证据缺失或不一致使总状态为 `fail`。另需核对 `cleanup.verifiedEmpty=true` 和实际事务／云调用计数。

本地模拟即使单项 `status=pass`，`cloudEvidenceAccepted` 仍为 false。失败结果不得改写成通过，也不能把其他场景的云证据套用到未执行场景。

默认执行结束后自动清理。只有人工需要保留现场时才使用 `--keep-fixtures`，报告会标记 `retained-by-request` 并给出清理命令。

## 7. 保留现场的清理

仍须使用原隔离环境和原 runId，并重新满足精确确认：

```bash
node admin-web/probes/db08/run.mjs \
  --execute-isolated \
  --cleanup-only \
  --run-id db08-20261103-a \
  > db08-20261103-a-cleanup.json
```

清理同时按 `probeRunId=<runId>` 和文档 ID 前缀双重约束；组织集合只扫描本批次的 A/B 组织，全局集合只扫描同 `probeRunId`。每 25 条分批删除，最后重新查询确认本批次为零。清理事务不新增审计，避免永远残留最后一条清理日志。安全适配器持有的存储／客户端夹具由其 `cleanup` 清理。

若清理失败，报告为失败；不得改跑生产环境、放宽前缀或手工删除非本批次数据。本地回归覆盖了“非本批次文档保留”，云端清理仍属于未执行验收项。

## 8. 本次实际本地验证

- `node --test admin-web/tests/db08-probes.test.mjs`：**20／20 通过**。覆盖正式服务故障传播、三类身份双向 winner、正式重试、名单读取窗口、双向入住审核竞争、17 条索引查询、90／91 引用、1000 间重放、独立安全证据、两次管理审计读取、五次对象反向请求和云能力防伪。
- 管理端 `npm test`：**184／184 通过**，无失败、跳过或取消。
- 根目录 `npm test`：**51／51 通过**，无失败、跳过或取消。
- `npm run check`：通过，9 页、自定义 tab bar、JSON／JS 与资源引用静态检查，包体 869 KiB；这不是微信开发者工具编译或视觉测试。
- dry-run 复验：11 个场景、17 条索引、19 项安全检查，云调用／写入／凭据读取均为 0。

## 9. 未解决问题与禁止事项

- 真实云事务冲突、SDK 重试／回滚、固定文档并发创建、实际索引、实际客户端／存储安全规则、云端原子审计和云端清理均**未执行、未验收**。
- `CloudSecurityEvidenceVerifier` 的真实独立检索和匿名反向请求仍未实现，基类会明确拒绝执行；当前只有本地独立模拟实现，不能据此宣称真实私密文件或实名资料已经安全。
- 17 条索引是查询候选，不是 DDL；19 项安全检查是验收清单，不是已部署规则。详见另外两份清单。
- DB-07 文件模块仍未实现；本分支只保留接口级探针引用。
- 返工复审通过前，不得在现用云环境执行 DB-08；不得操作生产数据库或合并 main。本分支不构成发布或上线许可。
