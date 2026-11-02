# DB-06 实施交接：组织内黑名单

状态：已实现，待交叉审查。基线 `feat/db-04-identity-review` 提交 `bb76099`（含 DB-04 首轮审查 F01–F04 返工），开发分支 `feat/db-06-blacklist`。未修改 DB-02/03/04 分支或 main，未合并 main。
范围仅限 admin-web 服务端与本地测试；未实现 DB-05 入住关系、未修改门锁逻辑、未调用付费接口、未连接或操作真实云数据库。测试使用临时 LocalStore、伪造证件值、模拟证据校验器和唯一占位写入，不创建真实入住或设备记录。
依据文档：[接口契约](API-CONTRACT.md) §6、[数据模型](DATA-MODEL.md) §2/§3.2/§5、[迁移方案](MIGRATION-PLAN.md) §5 R09。

## 1. 本次实现

- 新增集合：`blacklist_entries`、`blacklist_decisions`、`eligibility_guards`。
- 新增 `lib/blacklist.mjs`（`BlacklistService`）：
  - 主体：`person` 使用本组织 personId；`user` 必须由本组织人员档案的 userId 绑定证明，不枚举全局 users；`identity` 仅引用本组织 approved 实名申请，由服务端取得身份 HMAC，客户端不能提交原证件号或任意摘要。
  - 新增：理由/reasonCode、证据 fileIds、限制范围、`[startsAt, endsAt)` 有效期。证据仅调用 DB-07 `fileValidator(fileIds,{orgId,purpose:"blacklist-evidence"})` 接口；有证据但未配置适配器时 503，业务零写入。
  - 限制值预留 `occupancy.create` 与 `occupancy.activate`；当前 HTTP 复核仅处理 activate 命中。
  - 列表：`blacklist.read`，组织过滤先于游标分页，支持 subjectType 与 effectiveState（scheduled/active/expired/revoked）；身份 DTO 只返回 applicationId/keyVersion，不返回 subjectKey/identityDigest。敏感列表读取写审计。
  - 解除：`blacklist.manage` + expectedRevision + 理由；原理由与证据保留，追加 revokedBy/revokedAt/revokeReason；重复解除 409。
  - 新增与解除均写对应主体固定 eligibility guard 的 epoch/revision，与业务审计同事务。
- 单次复核 `reviewOccupancy`：
  - `blacklist.review`；输入 occupancyId、allow/deny、理由、entryIds 及对应 entryRevisions。事务内重新确认记录属于本组织、当前命中 activate 且版本未变。
  - 决定绑定 org+occupancyId、当时完整命中 ID/版本；expiresAt 取命中记录最早 endsAt。名单新增、版本变化或命中集合变化后，旧 allow 不可复用。
  - `blacklist_decisions` 中固定 current head 用于读取最新决定，随机 ID decision 记录追加保存每次审核历史；复核同时推进相关主体 guard，防止新 deny 与使用旧 allow 的激活并发穿透。
- `withEligibility` 是 DB-05 唯一接入边界，不提供公共姓名/手机号名单查询：
  - 预读 person、可选绑定 user、可选 approved 实名身份，派生全部主体及 guard；候选排除已解除/已到期终态记录，但保留未来生效记录以覆盖事务内时间边界。
  - 事务内重算 guard epoch、当前命中、复核 ID/版本及 expiresAt；不一致时重跑整个预读+事务，最多 3 次，仍冲突则失败关闭。
  - 无命中允许；精确 allow 允许；精确 deny 返回 403 `BLACKLIST_DENIED`；其他命中返回 409 `BLACKLIST_REVIEW_REQUIRED`，错误不携带名单理由或证据。
  - 激活业务写入与所有相关主体 guard 写入同事务提交；失败不写业务记录。
- `lib/persons.mjs` `claimAccount` 增加 person/user guard 写入：账号认领引入新名单主体时，与资格激活形成同一并发协议；未改变认领条件、用户 ID、登录逻辑或返回结构。
- `/api/v2` 路由：
  - `POST /blacklist`、`GET /blacklist`、`POST /blacklist/{id}/revoke`、`POST /occupancies/{id}/blacklist-review`。
  - 写请求统一 Idempotency-Key；组织上下文仍由服务端成员关系决定，权限点不由 admin 角色隐含。
- 后台版本 `0.6.0-beta.1`（package-lock 同步）。

## 2. DB-05 调用契约

```js
const result = await blacklist.withEligibility(
  { personId, identityApplicationId, occupancyId, restriction: "occupancy.activate" },
  additionalTransactionRefs,
  (state, eligibility) => ({
    writes: activationWrites,
    result: activationResult,
  }),
  audit,
);
```

DB-05 必须同时保证：occupancyId 属于同一组织、对应正确 personId、申请状态允许激活且不会被重复利用；激活必须提供 approved identityApplicationId，才能派生身份主体。不能把旧 users.houses、手机号或公开名单查询当作替代。DB-06 当前只把 occupancyId 当作受限复核引用，不伪造或激活该记录。

## 3. 关键设计决定

1. **只影响新申请/激活**：名单新增、解除、复核和资格检查不写已有 occupancies、users.houses、设备或门锁。
2. **放行不是永久洗白**：allow 仅匹配一个 occupancyId 和当时完整名单版本；新名单出现后必须重新复核。
3. **到期不依赖定时任务**：startsAt/endsAt 在每次资格事务内实时判断，endsAt 到点即不再命中。
4. **证据与身份最小暴露**：列表只向显式 blacklist.read 开放并审计；身份摘要不出 DTO，证据文件内容仍由 DB-07 另行鉴权。
5. **审核历史保留**：current head 可改判，随机 ID 历史决定不覆盖；所有变更与审计同事务。

## 4. 已执行检查

- `admin-web npm test`：**135 项全部通过**（DB-04 基线 120 项 + DB-06 新增 15 项：服务 13、HTTP 2）。
- 新增覆盖：三类主体、权限点、证据适配器关闭、列表审计、22 条服务/HTTP 多页、跨组织隔离、revision、解除、实时起止边界、无业务写入的命中拒绝、一次性 allow/deny、新名单使旧放行失效、追加审核历史。
- 确定性并发覆盖：资格预读后新增名单、旧 allow 预读后改判 deny、账号认领引入历史用户名单；均重跑或拒绝，模拟激活占位零写入。
- 根目录 `npm test`：**51 项通过**；`npm run check` 通过（9 页，869 KiB；静态检查，非微信开发者工具编译或视觉测试）。
- 未运行：`test:sdk`、`test:browser`、真实隔离云事务探针。

## 5. 未解决问题与上线门槛

- DB-05 尚未实现；必须接入 `withEligibility` 并验证 occupancy 状态、组织、人员与唯一生命周期，当前复核路由本身不会创建或激活入住关系。
- `occupancy.create` 仅保留资格检查范围；其独立创建/复核流程待 DB-05 设计接入，当前 HTTP 复核只接受 activate 命中。
- DB-07 文件实体和私有证据下载未实现；fileValidator 只是接口，不能据此认定证据文件真实存在或已可安全下载。
- 云端事务冲突重试、索引、安全规则与审计原子性未实测（DB-08）。本地串行队列结果不等于云端并发证明。
- 候选已排除终态历史，但大量同时有效名单仍受 CloudStore 单事务 90 引用上限；超限失败关闭。DB-08 须验证容量并在必要时调整 guard/候选分片，不能退化为无锁先查后写。
- 历史名单迁移必须同时建立对应 eligibility guard；未提供自动迁移、合并或生产初始化脚本。
