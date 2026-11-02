# DB-02 交叉审查：暂不通过

审查提交：`2560e09`，分支 `feat/db-02-org-scope-archive`；设计基线 `a82fe6e`。
本轮仅审查，不修改开发分支、不合并、不触碰生产数据。以下行号对应被审查提交。

## 阻断问题

### F01 [P1] 旧入口可以绕过新组织边界

位置：`admin-web/server.mjs:222–226`（遗留路由未改，但新增v2与其共用集合引入此问题）；新v2鉴权在约290–304行。

本地HTTP复现：用v2服务创建org-demo小区；创建只有全局viewer角色、没有任何组织成员关系的账号。
- GET /api/v2/property/catalog → 404。
- 同账号GET /api/property/snapshot → 200，catalog包含上述小区ID与orgId。

旧PropertyService.snapshot无org过滤。旧创建/修改、rooms/houses/users列表和绑定等入口也仍直接访问同一store；“v2不读取无orgId记录”是单向隔离，不能证明旧路径不会访问v2记录。全局admin同样能通过旧路径绕过组织写权限。

修复要求：明确legacy/v2数据范围和切换状态。旧读至少排除v2记录；旧写按目标及所有关联对象拒绝操作v2，或统一进入组织鉴权服务。覆盖snapshot、资源列表/详情、导出、绑定及文件引用等相关路径；没有封闭旧入口前不能开启live v2。新增无组织账号及其他组织账号的旧入口越权测试。

### F02 [P1] 归档预检查不随生命周期守卫重新验证

位置：`admin-web/lib/property-v2.mjs:646–671`，关联扫描在约548–624行事务外。

确定性复现：在小区归档完成无子节点预检查、即将transact时，先提交一次createCatalog(building)。随后归档仍成功，数据库留下 archived community + active building。

原因：预检查未记录guard epoch，事务只读最新guard并递增，从不比较预检查时版本或重新检查关联。先完成的创建不会与之后才启动的归档事务发生写冲突。事务重试同样会复用过期blockers结果。

修复要求：对关联扫描使用明确的版本保护协议；创建、归档和绑定等会影响阻塞条件的路径必须共同增加版本。预读版本与提交版本不同则重新扫描，不能只重复写相同epoch。测试用屏障精确暂停在扫描后，覆盖新增下级、创建房间、绑定/关联房源等。

### F03 [P1] 创建房间沿用已失效的事务外户型快照

位置：`admin-web/lib/property-v2.mjs:393–407`。

确定性复现：createRooms读到有效户型后、进入事务前，将该户型归档；createRooms仍返回count=1，新房间引用已归档户型。

原因：事务refs只声明floor，未声明building/community/layout；创建使用闭包里的旧户型数据，生命周期守卫也未验证预读版本。

修复要求：事务内重新读取并校验全部父级/户型及组织归属，结合正确guard协议确保并发状态变更无法穿透。补“户型归档与建房”屏障测试，及公共用房属性快照一致性测试。此方法目前只服务层可调用，不代表允许保留错误并由后续HTTP接口继承。

### F04 [P1] 房源归档后仍满足现有客户查询条件

位置：`admin-web/lib/property-v2.mjs:655–658`；对应 `cloudfunctions/getHouses/index.js:15`。

归档house只写lifecycle=archived，保留status=在租；getHouses仍只过滤status和isPublic。这样的房源列表和详情仍返回。交接文档已经披露这一限制，但live配置后archive路由可直接使用，故不能算完成“归档不可见”。

修复要求：要么协调部署客户查询过滤（另说明范围），要么在兼容阶段将归档房源显式下架并禁止旧接口重新上架，或禁用该归档能力直到完整切换。保持数据兼容不能以客户继续看到已归档房源为代价。补列表、计数、详情行为测试。

## 非阻断但需纳入修订

- listCatalog/listRooms/requireMembership使用store.list全量读取跨组织集合后过滤，虽在应用分页前过滤，但不是数据库查询下推。沿用20,000条集合上限会让无关组织数据量影响其他组织；应增加带org过滤及游标的存储查询接口。
- batchLayout的expectedRevisions可缺省，与契约“修改需版本”不一致；应强制完整版本，补漏传拒绝测试。
- batchLayout校验listing.propertyRoomId但不校验listing.orgId；脏关联/迁移错误可能跨组织修改，应拒绝整批。
- organization/membership仅在事务前鉴权；组织停用或成员撤权与写请求并发须有事务版本/guard策略。
- 幂等expiresAt未执行到期语义，package.json与package-lock版本未同步。
- 云端索引/并发探针未运行，仍是正式启用门槛，不能用本地队列测试替代。

## 已执行验证

- admin-web `npm test`：71项通过。
- 根目录 `npm test`：51项通过。
- `npm run check`：9页静态检查通过。
- 新增临时独立复现程序（只用临时LocalStore及本机HTTP）确认F01、F02、F03。未写业务源码，临时数据已清理。
- F04由归档写入与客户查询条件直接核对，未调用真实云接口。
- 未运行真实云数据库、门锁操作或生产数据迁移。GitHub PR列表API返回Forbidden，因此按远程分支提交审查，不声称已检查/评审某个PR。

## 给开发AI的返工任务

继续原开发分支，优先修复F01–F04；每项提供独立回归测试与实际输出。不要迁移生产数据库，不合并main。若需更改原范围（例如客户云函数过滤），先列出最小改动与兼容策略供确认；在未完整接通时保持live功能关闭。修复后提交新hash，再交叉审查。
