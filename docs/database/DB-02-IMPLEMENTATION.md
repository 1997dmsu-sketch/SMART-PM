# DB-02 实施交接：组织范围与物业归档

状态：首轮审查（`9206c6c`）与第二轮复查（`252adf0`，R2-01/R2-02）不通过项均已返工完成，修复映射见 §6。基线 `docs/db-01-design` 提交 `a82fe6e`，开发分支 `feat/db-02-org-scope-archive`。
范围仅限 admin-web 服务端；未修改登录、实名、门锁逻辑，未连接或操作真实云环境，未合并 main。
依据文档：[数据模型](DATA-MODEL.md)、[接口契约](API-CONTRACT.md) §2、§8、[迁移方案](MIGRATION-PLAN.md)。

## 1. 本次实现

- 新增集合（LocalStore/CloudStore 白名单）：`organizations`、`org_memberships`、`unique_claims`、`lifecycle_guards`、`operation_keys`。
- `lib/org.mjs`：固定 ID 组织引导（`OrgService.bootstrap`，幂等，禁止请求驱动建组织）、显式成员映射（`grantMembership`）、`organizationsFor`、`requireMembership`。无成员关系与组织不存在统一返回 404，不泄露其他组织存在性；写操作要求组织内 admin 角色。
- `lib/claims.mjs`：固定 ID 唯一占位（`claim-<sha256(namespace,scope,key)>`）。命名空间：`catalog-name`（org+parent+kind+name）、`layout-code`（org+building+code）、`floor-level`（org+building+level）、`room-no`（org+floor+roomNo）、`room-listing`（预留，本期未写入，见 §3）。
- `lib/property-v2.mjs`（`OrgPropertyService`）：`listCatalog`/`listRooms`（服务端 orgId 过滤先于游标分页，limit 默认 20 最大 100）、`createCatalog`、`createProperty`（new/existing）、`createRooms`（1–30/批，同步 floor.slots）、`batchLayout`（≤30，expectedRevisions，同步关联房源）、`archive`（六类对象）。新记录带 `orgId,schemaVersion=2,revision,createdAt/updatedAt`。
- `/api/v2` 路由（server.mjs）：`GET me/organizations`、`GET property/catalog`、`GET rooms`、`POST property/create`、`POST property/catalog`、`POST property/layout`、`POST property/{community|building|floor|layout|room|house}/{id}/archive`。统一信封 `{data,requestId,nextCursor?}` / `{error:{code,message},requestId}`；组织上下文取自 `X-Org-Id` 头或 `orgId` 查询参数并经服务端成员关系校验（单组织账号可省略）；POST 强制 `Idempotency-Key`。
- 归档语义：只标记不删除；`property_catalog`/`rooms` 用 `status=archived`，`houses` 归档同时写 `lifecycle=archived` + `status=下架` + `statusBeforeArchive`（保存原业务状态供追溯），旧接口对已归档房源的非「下架」改写返回 409，防止归档房源被重新上架后对客户可见（修复 F04）。阻塞时返回 `ARCHIVE_BLOCKED` 与非敏感计数。
- 引导配置：demo 自动建 `org-demo`（演示管理员为 org admin）；live 通过 `ADMIN_ORG_ID`/`ADMIN_ORG_NAME`/`ADMIN_ORG_ADMINS` 配置，未配置时 `/api/v2` 返回 503 `ADAPTER_UNAVAILABLE`，旧后台功能不受影响。
- 后台版本 0.3.0-beta.1。旧 `/api/*` 接口、旧 PropertyService、小程序及全部云函数零改动。

## 2. 关键设计决定（请重点评审）

1. **唯一占位的统一解释**：旧创建路径（确定性文档 ID `cat-/room-+hash`）本身就是固定 ID 占位，与 DATA-MODEL §3.1 同构；v2 新记录用随机 ID + `unique_claims`。未给旧路径补写 claims，原因是旧 `autoFloors` 单事务可达 100 条楼层，补写 claims 会突破 90 条事务引用预算（DATA-MODEL §4）。由此 legacy 与 v2 各管各的范围，靠"legacy 无 orgId、v2 不可见"隔离；最终统一依赖 DB-08 迁移后停用旧写路径。若评审认为必须立即双写，需先重构旧批量接口的事务粒度。
2. **归档释放占位**：归档释放 catalog-name/layout-code/floor-level/room-no 占位，允许名称/编码/房号复用；历史记录保留可查。房源归档不释放房源关联（§3.1 "房源归档不自动释放占位"）。房号复用后新房 `houseId` 由随机 roomId 派生，不与归档房间重复。
3. **房间归档阻塞条件**：关联有效房源（lifecycle 非 archived）或存在旧 `users.houses` 绑定（影响设备权限）时拒绝，返回计数。occupancies 尚属 DB-05，未纳入。
4. **生命周期守卫（返工后协议）**：每组织固定文档 `guard-lifecycle-{orgId}`，**所有 v2 变更（创建/批量布局/归档）都 bump epoch**；归档拆为扫描 + 提交，提交事务内比较 epoch，不等则抛 `GUARD_CHANGED` 409 并重扫重试（最多 3 次）。**扫描的读取顺序为：先独立 `await` 读取 guard epoch，再扫描业务集合**（修复 R2-01——并行读取可能把"陈旧业务快照 + 最新 epoch"配对，让归档漏过新关联）；epoch 读取之前提交的变更会体现在 epoch 与后续扫描中，epoch 读取之后提交的变更必然被提交时比较捕获。建房事务同时重新校验 building/community/layout 的归属、层级链与 active 状态，并以事务内最新文档取冗余字段，杜绝沿用失效快照（修复 F03）。本地串行队列下该机制等价串行化；云端读取一致性（非线性化读是否可能让扫描返回早于 epoch 读取点的快照）未经真实环境验证，属 DB-08 探针范围。
5. **幂等**：`operation_keys` 与业务写入同事务；同 key 同请求体重放已存结果（含原状态码），同 key 不同请求体 409。`expiresAt`（24h）过期后同 key 返回 409 `IDEMPOTENCY_EXPIRED`，拒绝重放也拒绝重复执行（返工后实现，原为只记录不过期）；过期键的清理任务仍未实现。
6. **v2 未暴露建房 HTTP 接口**：按 §2 契约表，房间创建仍走旧 `/api/property/*` 入口；`createRooms` 仅在服务层供测试与后续切换使用。

## 3. 未解决问题（移交评审/后续任务）

- live 模式缺少组织成员授予工具（CLI 或界面）；当前仅 bootstrap 时配置的管理员有权限。
- `getHouses`/`contentList` 云函数尚未加可信组织范围与归档过滤（§8 切换门槛）；本轮已通过"归档即下架 + 旧接口禁止重新上架"把服务端可见面收敛，但小程序读取路径本身按约束未动。
- 房间归档对旧 `users.houses` 绑定的依赖将在 DB-05 后被 occupancies 取代；设备权限切换须专项验收。
- 云端并发、索引、安全规则、90 条引用预算均未实测；本地串行队列结果不构成云端并发证明（MIGRATION-PLAN §5）。
- `operation_keys` 过期键的清理任务未实现（过期拒绝已实现）。
- 归档无"取消归档"动作（设计仅定义归档）；误归档当前需直接改库，是否补恢复接口请评审决定。
- Q03–Q07 未决项状态不变；Q06 采用"存在有效关系则拒绝"。

## 4. 已执行检查

- `admin-web`：`npm test` 82 项全部通过（58 项既有回归 + 24 项新增：org-v2 服务层 17 项、server-v2 HTTP 层 8 项，其中含并发双写、越组织 404、伪造 orgId、幂等重放/冲突/过期、归档阻塞计数、游标分页 org 过滤先行、归档扫描-提交屏障（含 R2-01 两种时序与读取顺序断言）、建房事务内快照重校验、成员撤权事务内 403、旧入口对 v2 记录的读写隔离、归档房源禁止重新上架、vr-download 组织隔离）。
- 根目录：`npm test` 51 项通过；`npm run check` 通过（9 页静态结构）。
- 未运行：`test:sdk`（真实 SDK 模拟传输，与本改动无交集）、`test:browser`（v2 暂无界面）、云端探针（DB-08）。

## 6. 修订记录

### 第二轮复查（252adf0）

| 审查项 | 修复方式 | 覆盖测试 |
|---|---|---|
| R2-01 归档扫描与 guard 并行读取 | `scanArchive` 改为先独立 `await` 读取 guard epoch，再扫描业务集合，提交事务内比较同一 epoch；陈旧快照+迟到创建、扫描完成后创建两种时序均强制重扫并阻塞 | org-v2 两项「R2-01 barrier」+「R2-01: the guard epoch is read alone and before every collection scan」 |
| R2-02 VR 下载绕过组织权限 | `/api/vr-download` 对带 orgId 的 content 记录一律 404，检查在云下载/本地 readFile 之前完成；盘点其余文件路径：`/uploads/*` 仅 demo 模式 uuid 图片（严格正则、无组织数据）、`/vr-files/*` 不静态暴露（仅经 vr-download）、public 静态目录有穿越防护，无其他记录驱动下载路径 | server-v2「R2-02: vr-download never serves org-scoped records; legacy records still download」（无组织账号、其他组织账号、全局 admin 均 404，旧内容 200 正常下载） |

### 第一轮审查（9206c6c）

| 审查项 | 修复方式 | 覆盖测试 |
|---|---|---|
| F01 旧入口可访问 v2 记录 | 旧 `PropertyService.get` 拒绝带 orgId 记录；snapshot/autoRooms/assignRoom/batchLayout/saveListing/context 预读走 `legacyOnly` 过滤；server 的 dashboard/audit/users binding/通用资源列表过滤 `!r.orgId`，PUT 目标带 orgId 返回 404 | server-v2「F01: legacy endpoints never expose or mutate org-scoped records」 |
| F02 归档预检查无版本保护 | 守卫 epoch 全变更 bump；归档扫描记录 epoch、提交事务内比较，冲突 409 重扫重试（≤3 次） | org-v2「F02 barrier: 扫描与提交之间的新增强制重扫并阻塞」 |
| F03 建房沿用失效快照 | 建房事务 refs 含 building/community/layout，事务内重校验归属、层级链、active 状态，冗余字段取事务内最新值 | org-v2「F03 barrier: 预读后归档 layout 则建房被拒」 |
| F04 归档房源客户仍可见 | house 归档同时写 `lifecycle=archived` + `status=下架` + `statusBeforeArchive`；旧 PUT 对归档房源非下架改写返回 409 | org-v2 house 归档断言、server-v2「F04: 归档房源不能经旧接口重新上架」 |
| 非阻断：查询未下推 | `store.list(name, orgId)` 查询下推（CloudStore 用 `.where({orgId})`，先于 orderBy） | org-v2 列表测试（既有） |
| 非阻断：expectedRevisions 可选 | batchLayout 的 expectedRevisions 改为必填；校验 listing.orgId（不符 409 `ORG_MISMATCH`） | org-v2 batchLayout 两项更新测试 |
| 非阻断：事务内鉴权缺失 | service 构造带 `membershipId`；所有写事务 refs 含组织与成员文档，事务内复查组织停用/成员撤权/非 admin（403） | org-v2「membership revoked after pre-check is caught inside the write transaction」 |
| 非阻断：幂等键过期语义 | 过期同 key 409 `IDEMPOTENCY_EXPIRED`（HTTP 预检一致）；`OP_KEY_TTL` 导出为 24h 常量 | org-v2「expired idempotency keys are rejected」 |
| 非阻断：版本号不同步 | package-lock.json 两处 version 同步至 0.3.0-beta.1 | `npm test` 间接覆盖（lock 一致性由仓库检查） |

## 5. 验收矩阵映射

| 需求 | 覆盖测试 |
|---|---|
| R01 组织隔离 | server-v2：伪造 orgId/无成员 404 同态、越组织列表不可见；org-v2：legacy 无 orgId 记录不可见、越组织建房 404 |
| R02 物业唯一 | org-v2：并发同 code/同 roomNo 仅一者成功、claim 与 slots 一致、跨组织同 code 允许 |
| R07 公共用房 | 既有 isPublic 逻辑保留（旧路径回归 58 项通过）；v2 列表/详情组织过滤 |
| R08 归档历史 | org-v2：阻塞计数、版本冲突、归档后创建被拒、claim 释放复用、历史可查、守卫 epoch 递增 |
