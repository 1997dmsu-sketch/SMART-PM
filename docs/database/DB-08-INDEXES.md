# DB-08 索引候选清单

状态：**仅清单与本地查询探针；未在任何云环境创建、修改或验证索引。** 字段与顺序来自 `admin-web/probes/db08/manifest.mjs`，实际云控制台配置前须按真实查询和平台规则复核。

## 1. 候选索引

| # | 集合 | 等值过滤字段（顺序） | 升序排序字段 | 用途 |
|---:|---|---|---|---|
| 1 | `org_memberships` | `orgId, principalType, principalId, status` | `_id` | 服务端成员关系与组织列表 |
| 2 | `persons` | `orgId, userId` | `_id` | 组织内账号绑定；只查非空 userId |
| 3 | `persons` | `orgId, status` | `_id` | 组织人员分页 |
| 4 | `property_catalog` | `orgId, kind, parentId, status` | `_id` | 物业层级与归档过滤 |
| 5 | `rooms` | `orgId, buildingId, floorId, status` | `roomNo, _id` | 房间筛选和稳定分页 |
| 6 | `houses` | `orgId, lifecycle, status` | `updatedAt, _id` | 组织内出租展示 |
| 7 | `identity_applications` | `orgId, state` | `submittedAt, _id` | 实名审核队列 |
| 8 | `identity_applications` | `orgId, personId` | `_id` | 人员实名历史 |
| 9 | `identity_reviews` | `orgId, applicationId` | `decidedAt, _id` | 申请审核历史 |
| 10 | `blacklist_entries` | `orgId, subjectType, subjectKey, state` | `endsAt, _id` | 名单主体与有效期候选 |
| 11 | `occupancy_cycles` | `orgId, roomId, state` | `startsAt, _id` | 房间入住周期 |
| 12 | `occupancies` | `orgId, roomId, state` | `startsAt, _id` | 房间关系及有效期 |
| 13 | `occupancies` | `orgId, personId, state` | `startsAt, _id` | 人员入住历史 |
| 14 | `occupancy_applications` | `orgId, state` | `createdAt, _id` | 持久待审入住申请 |
| 15 | `occupancy_materializations` | `orgId, state` | `_id` | 周期历史补写任务 |
| 16 | `file_links` | `orgId, entityType, entityId` | `sortOrder, _id` | DB-07 文件引用接口预留 |
| 17 | `file_assets` | `orgId, purpose, visibility, status` | `_id` | DB-07 私密文件筛选接口预留 |

## 2. 约束与验收口径

- `orgId` 是组织集合查询的服务端强制边界，必须先进入数据库查询，再分页；不能把全量读出后的内存过滤当作组织隔离。
- 排序末尾的 `_id` 是稳定次序／游标决胜字段。当前探针检查排序和组织过滤，不宣称已实现所有业务路由的最终游标方案。
- 唯一性仍由固定 ID 占位和事务保证，不依赖未验证的唯一、稀疏或部分索引。
- `blacklist_entries.endsAt=null` 的排序和有效期过滤须由应用明确处理；不能把这个候选索引解释成完整的时间语义。
- 实际出现新的房源公开筛选、价格／户型过滤或审计管理列表时，应按真实查询另评索引；本清单不自动覆盖未实现的查询。
- `file_assets`、`file_links` 是 DB-07 接口引用，不表示文件集合、上传、下载或关联逻辑已经实现。

## 3. 查询探针与后续人工验收

`index-query-smoke` 对以上 17 条候选逐一生成等值查询，使用本批次 `orgA`、合成字段值和清单排序，检查组织边界与 `_id` 稳定次序。本地通过不代表云端已有索引。

后续经批准的隔离云验收应记录：环境、控制台实际索引定义、每条查询结果、缺失索引错误原文、执行时间和结果文件。若需创建索引，必须另走人工变更流程后重新执行探针；本分支及工具不执行索引变更。
