# DB-05 实施交接：入住周期与租住关系

状态：已按 DB-05-REVIEW.md 修复 F01、F02，待复审。基线为 DB-06 F01 返工提交 `95dec9f8aab91dc6573198ce2f0bc9fb56f3a67c`，开发分支 `feat/db-05-occupancies`。未修改 DB-02/03/04/06 分支或 main，未合并 main。
范围仅限 admin-web 服务端、组织内 `/api/v2` 接口与本地测试；未修改登录、既有实名审核规则、门锁或旧用户数组逻辑，未调用付费接口，未连接或操作真实云数据库，未执行迁移或发布版本。
依据文档：[接口契约](API-CONTRACT.md) §5、[数据模型](DATA-MODEL.md) §2/§3.2/§5、[迁移方案](MIGRATION-PLAN.md) §5 R04/R05/R08/R11/R12。

## 1. 本次实现

- 新增 `lib/occupancies.mjs`（`OccupancyService`）及集合：
  - `occupancy_cycles`：每次主租客入住一个独立周期，包含固定主关系、epoch、pending/active/ended、有效期及结束信息。
  - `occupancies`：组织内 personId 的 primary/member 关系；主关系为 pending_review，成员邀请为 invited，激活后才为 active。人员与登录账号分离，无账号人员使用同一实名及名单协议。
  - `room_primary_slots`：每个 org+room 固定 ID，串行化主租客激活、结束和换租；不是“查询为空即占用”。
  - `occupancy_materializations`：整户结束后的成员历史补写任务，保存状态、游标、次数及版本。
  - `unique_claims` 新增 `occupancy-person`：同一人员同周期不可重复；历史关系不释放占位，主租客再次入住必须新周期。
- 创建不授权：
  - `createCycle` 仅组织管理员创建 pending 周期和主租客候选，不争用未来时段，不写主槽。
  - `createOccupancy` 仅接受 role=member；管理员可邀请，可信住户上下文 `{userId}` 仅允许本房当前有效主租客邀请。跨房、跨周期或 sponsor 失效均拒绝。
  - 创建和邀请重新检查组织、人员、房间及物业祖先状态，写周期 epoch 与 DB-02 相同 lifecycle guard。
- F01 绑定账号有效性：
  - 激活时按人员绑定的 userId 检查 `users` 文档存在且未停用；无账号人员仍可走原实名与名单协议。
  - 主租客邀请、代理建人／实名和住户读取均要求操作者账号有效；user 文档进入事务读集，避免停用或换绑与业务写入并发穿透。
- F02 创建名单：
  - 主周期、成员邀请与换租统一执行 `restriction="occupancy.create"`，命中时返回待复核的 `occupancyId` 和 `restriction`，不返回名单理由或证据，且不写周期、关系、主槽或结束旧周期。
  - 复核通过后，主周期／成员用相同 `occupancyId` 重试，换租用 `newOccupancyId`；`create` 与 `activate` 使用独立 decision head，allow 不跨范围放行。激活沿用 DB-06 原 head ID 及历史格式。
  - 名单新增、双限制独立复核、创建命中零写入与换租失败保留旧周期均有回归测试；创建资格与业务写入共用事务及 eligibility guards。
- 激活（采用 Q05 建议：仅组织管理员）：
  - 必须提供 expectedRevision 和本组织、本人员、approved 的 identityApplicationId；待审或未审核资料不能激活。
  - 通过 DB-06 `withEligibility` 重新派生 person／可选 user／identity 主体，在事务内复核名单版本并写相同 eligibility guards。命中需复核时关系、主槽、周期均不写；精确 allow 仅对当前 occupancy、限制类型和名单版本生效。
  - 事务内重新检查组织和管理员成员关系、房间与物业祖先、人员、绑定账号、关系占位、周期、期限、sponsor 和主槽。当前时间必须位于关系及周期 `[startsAt, endsAt)` 内；未来待审记录不能提前占用主槽。
  - 主租客激活争用固定槽；成员激活要求周期、主租客和主槽仍有效。成员邀请与激活均推进周期 epoch，退租或换租不能与其并发穿透。
- 结束与换租：
  - 普通成员结束只修改自身，不释放主槽；主租客结束在同一事务写周期 ended、释放主槽并创建补写任务。
  - 周期结束后，所有成员立即按 effectiveState=ended 计算，即使成员 storedState 仍暂时为 active；权限不得等待补写任务。
  - `materialize` 每批最多 25 条，按 cycleId+revision 复核，可重试、可重放；已完成任务重复执行为零写入业务关系。
  - `primary-transfer` 结束旧周期并创建新的 pending 周期／主关系，旧成员不自动带入，新主租客仍须独立实名、名单和激活检查。
  - 补录整户退租／换租时间不能早于任一已激活成员开始时间；预扫描由周期 epoch／revision 复核，避免并发激活绕过。
- 查询：
  - 返回 storedState、effectiveState、cycleId、cycleState、effectiveEndsAt、revision、cycleRevision；不返回证件或名单理由。
  - 组织管理员可查看本房有效与历史。当前主租客仅查看当前有效周期必要成员；普通住户及已结束主租客仅查看本人历史，失去房间级成员视图。
- 主租客代理（服务层）：
  - 已绑定可信且有效 userId 的当前有效主租客可凭主关系代建无账号人员，并凭本周期成员关系创建、脱敏读取、提交／补件实名申请。人员创建和实名写入均在事务内复核操作者账号、主关系、周期、主槽及成员归属；退租或账号停用后立即失权，失败不写业务数据。
  - 代建只创建人员档案，不创建登录账号或手机号映射。代理申请仍由原审核员审核；主租客不能访问审核队列、执行审核或读取私有证件资料。
- DB-02 归档接入：房间存在有效入住关系时返回 ARCHIVE_BLOCKED 及非敏感计数；有效性同时检查关系、周期、主槽和时间。激活／结束与归档共享 lifecycle guard，归档扫描后的激活会触发 GUARD_CHANGED 重扫。

## 2. HTTP 接口

| 接口 | 当前权限与语义 |
|---|---|
| `GET /api/v2/rooms/{roomId}/occupancies` | 组织管理员；分页、组织过滤先于游标 |
| `POST /api/v2/rooms/{roomId}/occupancy-cycles` | 组织管理员；primaryPersonId、startsAt、endsAt；创建复核后携带原 occupancyId 重试 |
| `POST /api/v2/occupancies` | 当前网页为组织管理员；roomId、personId、cycleId、role=member、startsAt、endsAt；创建复核后携带原 occupancyId 重试 |
| `POST /api/v2/occupancies/{id}/activate` | 组织管理员；expectedRevision、identityApplicationId |
| `POST /api/v2/occupancies/{id}/end` | 组织管理员；expectedRevision、reason、endsAt |
| `POST /api/v2/rooms/{roomId}/primary-transfer` | 组织管理员；旧 occupancyId/cycleId 及版本、新主租客及人员版本、oldEndsAt、新周期 startsAt/endsAt、reason；创建复核后携带原 newOccupancyId 重试 |
| `GET /api/v2/occupancy-materializations/{id}` | 组织管理员；查询补写状态，不以任务完成作为失效时点 |

所有写接口沿用统一 Idempotency-Key、服务端组织成员关系和事务内幂等记录。激活／结束返回 200，创建周期、邀请及换租返回 201。创建名单拒绝仍为原 403／409 状态，错误字段仅新增不透明的 `occupancyId`、`restriction`；复核后须重新发起创建并复用原幂等语义，不能由客户端自行生成审批结论。
主租客邀请、住户自读、代建人员及代理实名已在服务层用可信 `{userId}` 上下文覆盖测试；现有网页只有后台账号会话，因此本轮没有新增住户 HTTP 登录或从 body 接收 userId 的旁路。小程序接入时必须复用 DB-03 服务端身份上下文。

## 3. 兼容性与未改变范围

- 不回写 users.houses／owners，不修改旧 bind/unbind、登录、既有实名审核与账号认领规则、设备或门锁行为；新关系当前不授予设备权限。DB-04 仅扩展受入住周期约束的代理服务入口，原管理员接口保持可用。
- 实名创建、脱敏读取和提交／补件响应保留原字段；创建及提交／补件新增 revision，便于代理客户端进行乐观锁续作。
- DB-06 原黑名单维护、复核历史和激活资格协议保持兼容；新增创建范围的独立复核，激活 decision head ID 不变。原 `reviewOccupancy` 缺省 restriction 仍为 `occupancy.activate`。
- 绑定账号缺失或停用不再能激活、邀请、代理或读取住户关系；未绑定账号的人员档案不被强制创建账号。
- DB-07 文件适配器和 DB-08 迁移／云端验收未实现；没有生产初始化脚本。

## 4. 已执行检查

- 修复后专项 `node --test tests/occupancy.test.mjs tests/occupancy-http.test.mjs tests/blacklist.test.mjs tests/blacklist-http.test.mjs`：**41／41 通过**，无失败、跳过或取消。
- `admin-web npm test`：**161／161 通过**，无失败、跳过或取消。
- 覆盖：实名门槛、无账号人员协议、主租客争槽、同周期唯一、未来生效与结束边界、跨房 sponsor、邀请后退租、成员单独结束、整周期立即失效、补写分批与重放、退租／激活竞争、补录时间边界、换租不带旧成员、名单命中零写入及精确放行、归档竞态、跨组织、住户历史可见性、主租客代建与代理实名、越权审核／私有读取拒绝、退租后代理零写入、HTTP 幂等和响应封装。
- F01／F02 新增回归：缺失／停用账号激活与正常／无账号激活对照，停用后邀请／代理／住户读取零业务写入，创建限制主周期／邀请／换租，双限制独立复核，创建资格预读后新增名单竞争，以及 HTTP 创建复核重试引用与名单理由不泄漏。
- 根目录 `npm test`：**51／51 通过**；`npm run check` 通过（9 页，869 KiB；静态检查，非微信开发者工具编译或视觉测试）。
- 未运行：`test:sdk`、`test:browser`、真实隔离云事务探针。

## 5. 未解决问题与验收门槛

- 本地串行队列结果不等于云端并发证明。DB-08 必须验证事务冲突重试／回滚、缺失固定文档并发创建、索引、安全规则、原子审计和 90 引用预算；云失败不得退化为无锁执行。
- 补写 worker 的部署调度未接入；当前提供服务层可重放 `materialize` 和任务查询。即使 worker 未运行或失败，周期结束也必须立即生效。
- 主租客住户侧 HTTP／小程序适配尚未开放，不能由客户端传 userId、personId 或 sponsor 自行声称邀请资格；须使用服务端登录身份映射。
- 自然到期通过 effectiveState 实时失效，不依赖定时任务；自然到期历史的存储态整理未另建调度器。
- 旧数组绑定、设备权限切换、数据迁移和生产发布仍是独立验收事项，本轮不构成上线或切换许可。
