# DB-08 隔离云探针与执行交接

状态：**仅完成探针代码、清单和本地验证。真实隔离云探针未执行，索引未创建，安全规则未应用，生产数据库未连接或操作。** 基线为 DB-05 通过点 `b9ee06118b053a458d3458241e2341ea5a4dc7e1`，开发分支为 `feat/db-08-cloud-probes`，不合并 main。

本轮不修改登录、实名、门锁或既有业务服务，不实现 DB-07 文件模块。`file_assets`、`file_links` 仅作为后续接口的安全与索引验收对象。

## 1. 文件与证据边界

- `admin-web/probes/db08/manifest.mjs`：场景、索引、安全检查及严格执行参数。
- `backend.mjs`：统一文档前缀、组织白名单、事务引用预算、查询边界、清理；云 SDK 只在真实执行时动态加载。
- `transaction-probes.mjs`：固定 ID、竞争、组织、索引查询、引用边界和批量重放探针。
- `security-probes.mjs`：非特权安全适配器协议及 19 项断言。
- `run.mjs`：默认 dry-run、真实隔离执行入口和结果 JSON。
- `admin-web/tests/db08-probes.test.mjs`：内存后端与虚假安全适配器回归。

`LocalProbeBackend` 的通过只证明探针逻辑和本地回归，不证明云端并发、事务回滚、索引或安全规则。真实执行报告的 `evidenceScope` 必须为 `isolated-cloud`；注入本地后端时明确写为 `local-adapter-only-not-cloud-proof`。

## 2. 覆盖矩阵

| 场景 ID | 探针动作 | 通过条件 |
|---|---|---|
| `identity-phone-fixed-id` | 两个候选用户争用经验证手机号派生的固定身份 ID，并用另一候选 ID 重放 | 仅一条身份映射；最终及重放均指向同一稳定 userId；不写原手机号 |
| `identity-wechat-fixed-id` | 两个候选用户争用 appId／微信主体摘要派生的固定 ID | 仅一条映射和一个最终 userId；不写 OPENID |
| `identity-document-fixed-id` | 同一测试组织内争用证件身份摘要固定 ID | 组织内映射唯一、重放稳定；不写证件号 |
| `primary-slot-contention` | 两个 pending 周期同时争用同一固定主租客槽 | 仅一个周期／主关系 active；主槽指向该关系；另一操作冲突 |
| `blacklist-activation-race` | guard 预读后读候选，同时新增名单并 bump 同一 guard，再尝试激活 | 最终名单和 guard 保留；激活拒绝或为旧名单操作回滚；关系不 active，主槽不创建 |
| `occupancy-review-request-race` | 对 requestVersion=1 的申请同时执行审核放行和请求换参 | 只允许一个版本成功；不得出现 request V2 配 request V1 放行 |
| `organization-isolation` | A/B 组织过滤、同主体伪造成员、跨组织房间引用 | 查询无跨组织记录；伪造成员与跨组织写均失败且无业务写入 |
| `index-query-smoke` | 对 17 条候选索引执行组织优先的等值查询和排序 | 查询可用；无跨组织结果；`_id` 次序稳定；失败记录为未验收而非自动建索引 |
| `security-access-rules` | 由非特权适配器执行 19 项 client/storage/service 检查 | allow/deny 与清单一致；敏感正向读取有同批次审计；私密文件无公开 URL |
| `transaction-reference-budget` | 89 个业务引用＋1 个审计引用；再尝试 90 个业务引用＋1 个审计引用 | 总引用 90 可执行；总引用 91 在事务和网络请求前以 `TRANSACTION_REF_LIMIT` 拒绝 |
| `room-batch-1000` | 40 批×25 间，随后用相同操作键和请求摘要完整重放 | 每批事务不超过预算；最终恰好 1000 个唯一房间；40 批均幂等重放，无重复 |

90 是本应用的安全预算，**不是已测定的云平台极限**。1000 间是本场景容量，**不是平台最大容量或生产扩容认证**。

## 3. 默认 dry-run

```bash
node admin-web/probes/db08/run.mjs --dry-run
# 或
npm --prefix admin-web run probe:db08 -- --dry-run
```

本次实际 dry-run 输出：11 个场景、17 条索引候选、19 项安全检查；`cloudCalls=0`、`cloudWrites=0`、`credentialsRead=false`。dry-run 不初始化云后端、不加载云 SDK、不读取云凭据。

可用 `--only scene-id,scene-id` 限定场景；未知场景或参数直接失败。`--run-id` 仅允许 `db08-` 开头的小写字母、数字和单连字符。

## 4. 真实隔离执行前置条件（本轮未执行）

1. 由负责人另行创建并人工确认**专用、可清空的隔离测试环境**。环境名必须包含 `test`、`probe` 或 `isolat`，并排除 `prod`、`live`、`release`、`main`。代码校验不能替代人工确认环境。
2. 明确批准该环境的测试写入。严禁使用生产凭据或含现有生产数据的环境。凭据只通过进程环境注入，不写入仓库、报告或命令输出。
3. 事务探针使用显式的 `DB08_CLOUD_SECRET_ID`、`DB08_CLOUD_SECRET_KEY`。管理 SDK 具有绕过低权限客户端规则的能力，不能用于证明客户端拒绝规则。
4. 安全场景必须另配 `DB08_SECURITY_ADAPTER`。适配器使用非特权客户端／存储身份执行拒绝检查，并通过受控服务入口执行两项审核员正向读取。没有适配器时，包含安全场景的真实执行在创建后端前失败。
5. 所有输入均为合成摘要和测试记录。不得传入真实手机号、OPENID、证件、证据内容或生产文件。DB-07 未实现，私密文件对象和服务读取路径须由隔离适配器提供测试替身／测试实现，其结果仍须单独审查。
6. 按 `DB-08-INDEXES.md` 人工核对隔离环境的实际索引。本工具不会创建索引或修改安全规则；缺失索引或规则不一致应记录失败，不得自动修补后宣称原配置通过。

安全适配器模块导出对象或创建函数，协议如下：

```js
{
  privileged: false,
  async prepare(context) {}, // 可选；所有 ID/objectKey 使用 context.prefix
  async check(check, context) {
    return {
      decision: "allow", // 或 "deny"
      audited: false,
      auditId: undefined, // requiresAudit 时必须是本 prefix 下的审计 ID
      publicUrlIssued: false,
    };
  },
  async cleanup(context) {}, // 清理适配器创建的 client/storage fixtures
}
```

`context` 包含 `runId`、`prefix`、`envId`、`orgA`、`orgB`、合成 `fixtures` 和当前 `orgId`。适配器不得读取生产数据；不得把管理 SDK 的 allow 当作客户端规则结果。

## 5. 隔离执行与结果保存示例

以下仅为后续经批准的操作手册，**本次没有运行这些命令**。示例 runId 为 `db08-20261103-a`，两个专用组织为 `db08-20261103-a-a`、`db08-20261103-a-b`。

```bash
export DB08_PROBE_ENV='db08-isolated-test'
export DB08_PROBE_CONFIRM='db08:db08-isolated-test:db08-20261103-a-a'
export DB08_CLOUD_SECRET_ID='< isolated-only credential >'
export DB08_CLOUD_SECRET_KEY='< isolated-only credential >'
export DB08_SECURITY_ADAPTER='/absolute/path/to/isolated-security-adapter.mjs'

node admin-web/probes/db08/run.mjs \
  --execute-isolated \
  --run-id db08-20261103-a \
  > db08-20261103-a-result.json
```

`DB08_PROBE_CONFIRM` 必须精确等于 `db08:<环境名>:<orgA>`。结果 JSON 应随交叉审查保存，但至少核对：`status=pass`、所有目标场景均 pass、`evidenceScope=isolated-cloud`、`cleanup.verifiedEmpty=true`，以及实际事务／云调用计数。失败结果不得改写成通过。

如需分阶段执行，可用 `--only` 排除 `security-access-rules`；未执行的安全场景必须单列为未验收，不能由其他场景代替。

默认执行结束后自动清理。只有人工需要保留现场时才使用 `--keep-fixtures`，报告会标记 `retained-by-request` 并给出清理命令。

## 6. 保留现场的清理

仍须使用原隔离环境和原 runId，并重新满足精确确认。清理不需要安全适配器：

```bash
node admin-web/probes/db08/run.mjs \
  --execute-isolated \
  --cleanup-only \
  --run-id db08-20261103-a \
  > db08-20261103-a-cleanup.json
```

清理同时按 `probeRunId=<runId>` 和文档 ID 前缀双重约束；组织集合只扫描本批次的 A/B 组织，全局集合只扫描同 `probeRunId`。每 25 条分批删除，最后重新查询确认本批次为零。清理事务不新增审计，避免永远残留最后一条清理日志。安全适配器持有的存储／客户端夹具由其 `cleanup` 清理。

若清理失败，报告为失败；不得改跑生产环境、放宽前缀或手工删除非本批次数据。本地回归覆盖了“非本批次文档保留”，云端清理仍属于未执行验收项。

## 7. 本地验证与未解决问题

- 专项 `node --test admin-web/tests/db08-probes.test.mjs`：**16／16 通过**。覆盖 dry-run 零云调用、执行确认、前缀／组织／未声明写入、90／91 引用预检、三类固定身份、主槽、名单、双向审核竞争、17 条查询、1000 间重放、安全适配器失败关闭及清理保护。
- 管理端 `npm test`：**180／180 通过**，无失败、跳过或取消；根目录 `npm test`：**51／51 通过**。
- `npm run check`：通过，9 页、自定义 tab bar、JSON／JS 与资源引用静态检查，包体 869 KiB；这不是微信开发者工具编译或视觉测试。
- dry-run 复验：11 个场景、17 条索引、19 项安全检查，云调用／写入／凭据读取均为 0。
- 真实云事务冲突、SDK 重试／回滚、缺失固定文档并发创建、实际索引、实际客户端／存储安全规则、云端原子审计和云端清理均**未执行、未验收**。
- 安全适配器只有协议和虚假测试实现，没有连接任何真实客户端、存储或审核服务；不能据此宣称私密文件或实名资料已经安全。
- 17 条索引是查询候选，不是 DDL；19 项安全检查是验收清单，不是已部署规则。详见另外两份清单。
- DB-07 文件模块仍未实现；本分支只保留接口级探针引用。
- 本轮不操作生产数据库，不合并 main，不构成发布或上线许可。
