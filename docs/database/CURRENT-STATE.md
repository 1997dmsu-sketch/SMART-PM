# DB-01：现状核对

状态：设计草案，可评审；未实施迁移。基线 `v0.1.0-beta.16`，提交 `282a20f`。本轮仅写文档。

## 1. 核对范围与证据

本报告是仓库代码核对，不是线上数据库盘点。未读取生产数据、索引、安全规则、NAS 或核验供应商配置；不能据此认定当前线上已部署 beta.16。

| 范围 | 当前代码事实 | 依据（相对仓库路径） | 与目标差异 |
|---|---|---|---|
| 物业目录 | community/building/floor/layout 同放 property_catalog；parentId 关联；layout 含 code/name/rooms/isPublic | `admin-web/lib/property.mjs` createCatalog、createProperty | 无 orgId、归档状态 |
| 房间 | rooms._id 是文档ID；houseId 是旧业务房产号；floorId/layoutId 等关联；floor.slots 索引房号 | 同上 createRooms、autoRooms、assignRoom | 无主租客字段、独立租住关系 |
| 出租展示 | houses 与 rooms 分离；propertyRoomId/listingId 双向关联可选；户型快照事务同步 | 同上 saveListing、batchLayout | 未关联旧房源需人工匹配，不能自动猜测 |
| 客户房源 | status=在租 且 isPublic!=true；详情按 ID 重新查询 | `cloudfunctions/getHouses/index.js`、`miniprogram/services/api.js` | 无组织、归档过滤 |
| 手机号登录 | 以服务端 OPENID 查询 users；不存在则 add；手机号可直接更新；owners 按手机号回填绑定 | `cloudfunctions/phoneLogin/index.js` | 查后新增无并发唯一保障；手机号不是唯一登录映射；不能直接升级为换号流程 |
| 其他登录入口 | login 也按 OPENID 建号；存在独立后台登录云函数 | `cloudfunctions/login/index.js`、`cloudfunctions/adminLogin/index.js` | 不能只改 phoneLogin 而留下旁路 |
| 房间绑定 | users.houses 存 houseId 数组；网页绑定设置 housesManaged=true，phoneLogin 据此停止 owners 覆盖 | `admin-web/server.mjs` binding、phoneLogin | 无角色/期限/实名依据；数组不是租约或主租客证明 |
| 旧管理接口 | houseAdmin 依赖 users.role=admin，直接改 houses，未设置 housesManaged | `cloudfunctions/houseAdmin/index.js` | 可绕过新租住/组织检查，需统一或禁写 |
| 设备权限 | getDevices/unlock 读取 users.houses；unlock 有旧 admin 与公共设备分支 | `cloudfunctions/getDevices/index.js`、`cloudfunctions/unlock/index.js` | 改绑定会影响设备权限；设备 public 与公共用房 isPublic 不是同一概念 |
| 网页账号 | 独立 accounts.json，scrypt 密码、revision 撤销会话；admin/editor/viewer | `admin-web/lib/auth.mjs`、`admin-web/server.mjs` | 无组织成员关系；当前适用于单进程部署，不等于云端 users.role |
| 内容/文件 | 图片地址、vrUrl、vrFile 内嵌业务记录；图片5MB，VR附件50MB；附件不执行 | `admin-web/lib/model.mjs`、`lib/vr.mjs`、server 上传下载 | 无统一文件表、实名资料私有下载或 NAS 适配器 |
| 存储 | 本地 JSON 串行队列+临时文件改名；云端 runTransaction，声明读写集合并写审计 | `admin-web/lib/store.mjs` | 本地单进程串行不是分布式并发证明 |
| 容量 | 云列表按100条循环，全量读；达到应用20,000条上限报错；事务引用上限90是应用保护 | 同上 CloudStore | 不能继续为多组织全量拉取后过滤；90不是已验证的云平台极限 |
| 批量任务 | 自动生成最多1000间，每次25间；户型设置界面自动每批30间提交 | `public/auto-fill.js`、`room-batches.js`、`layout-batches.js` | 多批次不是整体原子事务 |

## 2. 已确认业务需求

R01 单组织运行，预留多组织隔离。R02 保留物业层级，楼栋内户型编码唯一。
R03 稳定唯一 userId，一个已验证手机号只对应一个有效用户。
R04 一人多房，一个房间同一时刻最多一个有效主租客。
R05 管理员或有效主租客添加成员，身份审核通过后才激活。
R06 人工实名审核，第三方核验预留且默认关闭。
R07 公共用房客户不可见。R08 有业务记录归档不直接删除。
R09 内部黑名单按组织隔离，命中转复核，不自动关闭已有门锁权限。
R10 文件统一引用，NAS 仅预留；VR附件不等于在线托管。
R11 主租客退租或更换后，全体成员一并退租，不按添加人区分。
R12 无独立手机号/微信的人员也需登记，独立人员档案由管理员或主租客代提交审核。

## 3. 设计建议与待确认项

Q01、Q02已收口；Q03–Q07是设计建议，不得让后续 AI 当作用户决定实施：

- Q01 已确认：全部退租。采用入住周期整体失效，不自动将成员转入新主租客周期。
- Q02 已确认：需要独立人员档案，personId 与登录 userId 分离；管理员或主租客可代提交，不能伪造共享手机号账号。
- Q03 一期证件范围、审核所需资料、资料保留期限、人工复核责任人。实现可保留配置，真实资料采集前需确定。
- Q04 手机号注销/回收后的重新绑定办法。建议停用不释放唯一占位，换号/注销须专门验证流程，不因停用自动抢号。
- Q05 主租客的安排由谁批准。建议仅管理员激活/替换主租客，主租客只能邀请普通成员。
- Q06 房间归档、楼栋归档前是否须结束全部有效关系及下架房源。建议存在有效关系则拒绝，不能静默级联撤权。
- Q07 人工实名通过结果是否跨组织复用。建议默认各组织独立审核，证件与审核结果不向其他组织共享。

## 4. 实际核验能力与限制

本地已安装 @cloudbase/database 类型声明及现有适配器均提供 runTransaction；仓库已有本地事务与模拟 SDK 测试。未对真实云环境验证索引、事务冲突重试、缺失文档读取与创建竞争、大小/时限或安全规则。

因此采用固定 `_id` 唯一占位的候选设计，不假定支持 SQL 外键、条件唯一索引或排他时间区间约束。DB-02/03 必须在隔离测试环境完成并发探针后才可确认实施方案；失败时停止切换，不能降级成先查后写。

## 5. 后续交接

- [数据模型](DATA-MODEL.md)：字段、状态、事务、索引候选。
- [接口契约](API-CONTRACT.md)：现有兼容及新接口，权限与错误语义。
- [迁移方案](MIGRATION-PLAN.md)：只读演练、冲突、切换、回滚及验收映射。
- DB-01 文档完成不代表 DB-02–08 已实施，不发布新的产品版本。
