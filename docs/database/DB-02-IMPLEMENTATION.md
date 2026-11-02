# DB-02 实施交接：组织范围与物业归档

状态：已实现，待交叉审查。基线 `docs/db-01-design` 提交 `a82fe6e`，开发分支 `feat/db-02-org-scope-archive`。
范围仅限 admin-web 服务端；未修改登录、实名、门锁逻辑，未连接或操作真实云环境，未合并 main。
依据文档：[数据模型](DATA-MODEL.md)、[接口契约](API-CONTRACT.md) §2、§8、[迁移方案](MIGRATION-PLAN.md)。

## 1. 本次实现

- 新增集合（LocalStore/CloudStore 白名单）：`organizations`、`org_memberships`、`unique_claims`、`lifecycle_guards`、`operation_keys`。
- `lib/org.mjs`：固定 ID 组织引导（`OrgService.bootstrap`，幂等，禁止请求驱动建组织）、显式成员映射（`grantMembership`）、`organizationsFor`、`requireMembership`。无成员关系与组织不存在统一返回 404，不泄露其他组织存在性；写操作要求组织内 admin 角色。
- `lib/claims.mjs`：固定 ID 唯一占位（`claim-<sha256(namespace,scope,key)>`）。命名空间：`catalog-name`（org+parent+kind+name）、`layout-code`（org+building+code）、`floor-level`（org+building+level）、`room-no`（org+floor+roomNo）、`room-listing`（预留，本期未写入，见 §3）。
- `lib/property-v2.mjs`（`OrgPropertyService`）：`listCatalog`/`listRooms`（服务端 orgId 过滤先于游标分页，limit 默认 20 最大 100）、`createCatalog`、`createProperty`（new/existing）、`createRooms`（1–30/批，同步 floor.slots）、`batchLayout`（≤30，expectedRevisions，同步关联房源）、`archive`（六类对象）。新记录带 `orgId,schemaVersion=2,revision,createdAt/updatedAt`。
- `/api/v2` 路由（server.mjs）：`GET me/organizations`、`GET property/catalog`、`GET rooms`、`POST property/create`、`POST property/catalog`、`POST property/layout`、`POST property/{community|building|floor|layout|room|house}/{id}/archive`。统一信封 `{data,requestId,nextCursor?}` / `{error:{code,message},requestId}`；组织上下文取自 `X-Org-Id` 头或 `orgId` 查询参数并经服务端成员关系校验（单组织账号可省略）；POST 强制 `Idempotency-Key`。
- 归档语义：只标记不删除；`property_catalog`/`rooms` 用 `status=archived`，`houses` 用独立的 `lifecycle=archived`（不动业务 status 在租/已租/下架）。阻塞时返回 `ARCHIVE_BLOCKED` 与非敏感计数。
- 引导配置：demo 自动建 `org-demo`（演示管理员为 org admin）；live 通过 `ADMIN_ORG_ID`/`ADMIN_ORG_NAME`/`ADMIN_ORG_ADMINS` 配置，未配置时 `/api/v2` 返回 503 `ADAPTER_UNAVAILABLE`，旧后台功能不受影响。
- 后台版本 0.3.0-beta.1。旧 `/api/*` 接口、旧 PropertyService、小程序及全部云函数零改动。

## 2. 关键设计决定（请重点评审）

1. **唯一占位的统一解释**：旧创建路径（确定性文档 ID `cat-/room-+hash`）本身就是固定 ID 占位，与 DATA-MODEL §3.1 同构；v2 新记录用随机 ID + `unique_claims`。未给旧路径补写 claims，原因是旧 `autoFloors` 单事务可达 100 条楼层，补写 claims 会突破 90 条事务引用预算（DATA-MODEL §4）。由此 legacy 与 v2 各管各的范围，靠"legacy 无 orgId、v2 不可见"隔离；最终统一依赖 DB-08 迁移后停用旧写路径。若评审认为必须立即双写，需先重构旧批量接口的事务粒度。
2. **归档释放占位**：归档释放 catalog-name/layout-code/floor-level/room-no 占位，允许名称/编码/房号复用；历史记录保留可查。房源归档不释放房源关联（§3.1 "房源归档不自动释放占位"）。房号复用后新房 `houseId` 由随机 roomId 派生，不与归档房间重复。
3. **房间归档阻塞条件**：关联有效房源（lifecycle 非 archived）或存在旧 `users.houses` 绑定（影响设备权限）时拒绝，返回计数。occupancies 尚属 DB-05，未纳入。
4. **生命周期守卫**：每组织固定文档 `guard-lifecycle-{orgId}`，创建与归档同事务读写该文档（归档 bump epoch），用于把"归档预检查后新增"变成可检测的写冲突。本地串行队列下该机制等价串行化；云端争用重试行为未经真实环境验证，属 DB-08 探针范围。
5. **幂等**：`operation_keys` 与业务写入同事务；同 key 同请求体重放已存结果（含原状态码），同 key 不同请求体 409。`expiresAt`（24h）仅记录，过期不重放拒绝、无清理任务——选择"宁重放不重复写"的安全方向，保留期配置待补。
6. **v2 未暴露建房 HTTP 接口**：按 §2 契约表，房间创建仍走旧 `/api/property/*` 入口；`createRooms` 仅在服务层供测试与后续切换使用。

## 3. 未解决问题（移交评审/后续任务）

- live 模式缺少组织成员授予工具（CLI 或界面）；当前仅 bootstrap 时配置的管理员有权限。
- `getHouses`/`contentList` 云函数尚未加可信组织范围与归档过滤（§8 切换门槛）；归档房源对小程序客户仍可见，直至切换完成。本轮按约束未动云函数。
- 房间归档对旧 `users.houses` 绑定的依赖将在 DB-05 后被 occupancies 取代；设备权限切换须专项验收。
- 云端并发、索引、安全规则、90 条引用预算均未实测；本地串行队列结果不构成云端并发证明（MIGRATION-PLAN §5）。
- `operation_keys` 保留期配置与过期清理未实现。
- 归档无"取消归档"动作（设计仅定义归档）；误归档当前需直接改库，是否补恢复接口请评审决定。
- Q03–Q07 未决项状态不变；Q06 采用"存在有效关系则拒绝"。

## 4. 已执行检查

- `admin-web`：`npm test` 71 项全部通过（58 项既有回归 + 13 项新增：org-v2 服务层 10 项、server-v2 HTTP 层 5 项，其中含并发双写、越组织 404、伪造 orgId、幂等重放/冲突、归档阻塞计数、游标分页 org 过滤先行）。
- 根目录：`npm test` 51 项通过；`npm run check` 通过（9 页静态结构）。
- 未运行：`test:sdk`（真实 SDK 模拟传输，与本改动无交集）、`test:browser`（v2 暂无界面）、云端探针（DB-08）。

## 5. 验收矩阵映射

| 需求 | 覆盖测试 |
|---|---|
| R01 组织隔离 | server-v2：伪造 orgId/无成员 404 同态、越组织列表不可见；org-v2：legacy 无 orgId 记录不可见、越组织建房 404 |
| R02 物业唯一 | org-v2：并发同 code/同 roomNo 仅一者成功、claim 与 slots 一致、跨组织同 code 允许 |
| R07 公共用房 | 既有 isPublic 逻辑保留（旧路径回归 58 项通过）；v2 列表/详情组织过滤 |
| R08 归档历史 | org-v2：阻塞计数、版本冲突、归档后创建被拒、claim 释放复用、历史可查、守卫 epoch 递增 |
