# HK-AI-04 H2-c 资格快照契约设计

- 状态：**设计复审稿；H2-c 编码未放行**
- 文档基线：`docs/lock-01-fast-track @ e9e8544`
- 代码事实基线：`2bc10e3`（H2-b 关闭提交，只读核对）
- 范围：资格快照、单事务边界、错误映射与竞态测试矩阵
- 明确排除：生产代码、现有测试、HTTP、Provider、设备连接及设备写操作

> 本文把内容分为“代码事实”“拟冻结规则”和“Codex 待裁定”。Q01–Q06 未获裁定前，不得把相应推荐方案当作已批准业务规则，也不得发 H2-c 编码卡。

## 1. 已批准边界与结论摘要

[H2-a 终审](HK-AI-04-H2A-FINAL-APPROVAL-F9A2B6B-2026-11-07.md) 已关闭 K2、operation domain 和严格重放；[H2-b 终审](HK-AI-04-H2B-FINAL-APPROVAL-2BC10E3-2026-11-08.md) 已关闭设备 owner claim 只读复核、K1 domain 和 slot 禁复用。本文沿用 [LOCK-01A 接口契约](../database/LOCK-01A-CONTRACT.md) 与 [LOCK-01A 数据设计](../database/LOCK-01A-DATA-DESIGN.md)，不改写上述 schema、算法或历史记录。

本轮核对得到五个关键结论：

1. 当前 `createGrant()` 没有把入住、周期、房间、目录、主入住及房间 slot 纳入事务 refs；仅有 DTO 中的 `occupancyId/cycleId` 不能证明资格。
2. 当前真实调用顺序是 `evaluateEligibility()` 先于业务 `build()`，与“完整资格复核后再作黑名单判决”的目标顺序相反；这是编码前必须裁定的接口阻断。
3. 完整固定 refs 可以放入现有单事务，但必须让资格快照在每次黑名单重试时重新预读，且不能沿用第一次尝试的旧快照。
4. 合法 operation replay 目前仍执行黑名单 prepare/evaluate；`build()` 虽返回 `writes: []`，wrapper 仍追加 subject guard writes，Store 还写审计。不得宣称“全库零写入”。
5. `CloudStore` 单事务最多 90 条去重 refs。本文最大固定布局下，候选名单超过 57 条会在事务前失败关闭；不得通过拆成两个事务或省略资格 refs 绕过。

## 2. 代码事实索引

以下行号均对应提交 `2bc10e3`。源码不在本文档基线中，因此使用“提交＋路径＋函数＋行号”的纯文本定位，不制造失效相对链接。

| 事实 | 代码入口与行号 |
| --- | --- |
| createGrant 的权限、DTO、K2、预读、固定 refs、build、写入与 replay | `admin-web/lib/face-service/service.mjs`，`createGrant()`，242–429；`#opContext/#opDomainRefs/#replayValid`，82–116 |
| createGrant 输入白名单与时间区间现状 | `admin-web/lib/face-service/dto.mjs`，`assertCreateGrantInput()`，106–143 |
| 黑名单事务前 token、subjects、guards、candidates 和动态 refs | `admin-web/lib/blacklist.mjs`，`prepareEligibility()`，460–540 |
| 黑名单事务内快照复核、精确 allow、deny/review | 同上，`evaluateEligibility()`，542–580 |
| 合并 refs、先 evaluate 后 build、guard writes、三次完整重试 | 同上，`withEligibility()`，585–606；`BLACKLIST_RETRY` 定义在 49 |
| 人员、绑定账号、房间、目录、唯一占位 helper | `admin-web/lib/occupancies.mjs`，`checkBoundUser()`，88–100；`roomRefs()/checkRoom()`，128–154；`checkPerson()`，156–167；`checkClaim()`，193–201 |
| 入住起止区间、排他结束边界和最小结束时间 | 同上，`activeAt()/minEnd()`，24–35 |
| 入住激活的完整 refs 与事务内资格规则 | 同上，`activate()`，554–675 |
| stored/effective state、cycle ended、slot、时间与房间归档 | 同上，`effective()`，897–912 |
| sponsor 是特定代理权限边界，不等于所有 member 的通用规则 | 同上，`sponsorContext()`，225–275 |
| 实名审批的 submitted、documentVersion、revision、digest domain 与冲突处理 | `admin-web/lib/verification.mjs`，`review()`，277–370 |
| identity.mjs 是 HMAC/domain helper，不是入住资格审批入口 | `admin-web/lib/identity.mjs`，`digest()/guardDomain()`，34–105 |
| 正式物业入口、组织/kind 校验与完整父子层级复核 | `admin-web/lib/property-v2.mjs`，`OrgPropertyService.catalogRecord()`，173–179；`createRooms()`，396–510，尤其 440–467 |
| 归档、revision 与 lifecycle guard | 同上，`archive()/scanArchive()/commitArchive()`，618–789 |
| refs 去重、90 条上限及事务写必须预先声明 | `admin-web/lib/store.mjs`，`CloudStore.transact()`，290–324；`LocalStore.transact()`，191–228 |
| 文件 binding 的组织、用途、ready/private、revision 与错误 | `admin-web/lib/files.mjs`，`FileService.assertBinding()`，817–835 |
| K1 domain 错误分类 | `admin-web/lib/face-service/collections.mjs`，`digestDomainMatchesDevice()`，602–622 |
| 入住测试使用真实 BlacklistService，并覆盖实名、时间、sponsor、名单和竞态 | `admin-web/tests/occupancy.test.mjs`，49–53、116–137、174–229、349–445、828–1006 |
| 现有 face-service 测试使用全局 eligible 自制桩，不能证明生产资格语义 | `admin-web/tests/face-service-layer.test.mjs`，18–31 |

### 2.1 当前控制流的准确描述

代码事实如下：

1. `prepareEligibility()` 在事务前读取 person、可选 user、可选 identity application，先读 guard epochs 再读 candidates，生成 token 和动态 refs。
2. `withEligibility()` 将业务 refs 与 token refs 合并进同一事务。
3. 事务内首先 `evaluateEligibility()`，然后才调用业务 `build()`。
4. build 返回后，wrapper 总会追加 subject `guardWrite()`；即使 build 的核心 `writes` 为空也不例外。
5. 遇 `BLACKLIST_RETRY` 时重新执行完整黑名单预读和事务，最多三次；第三次仍重试则抛出当前的 `409 BLACKLIST_RETRY`。
6. createGrant 的 operation replay 位于 build 内；合法重放不跳过 prepare/evaluate，也不保证 eligibility guards 和 admin audit 零变化。
7. createGrant 当前以 `restriction="occupancy.activate"` 复用 DB-06 判决。H2-c 保持该 restriction，不新增名单范围，不修改名单算法、guard、决定记录或重试次数。

## 3. 契约用语与 requestDigest

- **预读快照**：每次事务尝试前，由正式服务/helper 读取并用于生成 refs 和事务内比较基线的数据；预读本身不是授权依据。
- **事务快照**：`state[collection/id]` 中本次事务实际读到的记录。所有允许状态、组织、关系、revision 和时间均以此复核。
- **资格快照**：本文 R05–R18 加上 R01–R02 的当前记录及必要派生关系；不包含姓名、证件号、手机号、原始文件字节或黑名单证据内容。
- **核心写集 C**：一个 pending grant、一个 queued job、一条 queued log、一个新 slot、一个 operation key。
- **requestDigest**：继续使用 H2-a 对 parsed DTO 的稳定摘要。事务预读得到的状态、digest、epoch、房间/目录快照和名单快照均不追加进 requestDigest，避免把并发版本变化错误转化为同键异摘要。

| 输入或派生项 | 是否进入 requestDigest |
| --- | --- |
| credentialId、expectedCredentialRevision、deviceId | 是，现状保留 |
| occupancyId、cycleId、identityApplicationId | 是，现状保留 |
| validFrom、validUntil | 是，现状保留 |
| credential.personId、sourceFileId、房间/目录/主入住等预读字段 | 否 |
| person/identity/occupancy/cycle/room/catalog 的当前 revision、epoch、状态 | 否 |
| device/K1/owner claim/slot 的数据库快照 | 否；deviceId 本身已是输入 |
| org、actor、K2 realm/version | 不新增到 requestDigest；继续由 H2-a op key/domain 作用域保护 |

## 4. 完整 refs 与事务内复核表

“新增”只表示 H2-c 拟加入 createGrant 的 ref，不表示新建集合。R05–R07 已由黑名单 token refs 提供，必须按 `collection/id` 去重，不得重复计数或省略事务复核。

| 编号 | 实体与预读来源 | 事务 ref | 事务内必须复核的字段与允许状态 | 主要失败映射 | requestDigest |
| --- | --- | --- | --- | --- | --- |
| R01 | `face_credentials`；按 credentialId 组织内预读 | 固定 credentialId | orgId；approved；revision=expected；personId 与预读一致；sourceFileId/sourceFileRevision 不变 | NOT_FOUND、INVALID_STATE、REVISION_CONFLICT | ID 与 expected revision 是；快照否 |
| R02 | `file_assets`；来自 credential.sourceFileId | 固定 sourceFileId | 同 org、face-biometric、ready、private、合法 MIME/size、revision=binding | FILE_NOT_FOUND、FILE_CHANGED | 否 |
| R03 | `organizations` | 当前 orgId | 记录存在且 active | FORBIDDEN | 否 |
| R04 | `org_memberships` | 当前 membershipId | 同 org、active、含 device.access.manage | FORBIDDEN | 否 |
| R05 | `persons`；credential.personId | token ref，同 personId | 同 org、status=active、revision 与当次预读一致、userId 绑定一致 | NOT_FOUND、INVALID_STATE；revision/绑定变化走 BLACKLIST_RETRY | 否 |
| R06 | `users`；仅 person.userId 非空 | token ref，同 userId | 记录存在；无 status 的既有记录按现状视为 active，否则必须 active；无账号人员不新增 user ref | USER_DISABLED | 否 |
| R07 | `identity_applications`；按输入 ID | token ref，同 applicationId | 同 org、同 person、approved、identityDigest 非空、keyVersion 与当次预读一致、revision 与当次预读一致 | NOT_FOUND、IDENTITY_NOT_APPROVED、IDENTITY_CONFLICT；快照变化走 BLACKLIST_RETRY | 输入 ID 是；快照否 |
| R08 | `occupancies`；按输入 occupancyId | 固定 occupancyId | 同 org、person=credential.person、cycleId=输入、room/cycle/person/role 与预读一致、revision 一致；stored/effective state 与时间见 §5 | NOT_FOUND、REVISION_CONFLICT、INVALID_STATE | 输入 ID 是；快照否 |
| R09 | `occupancy_cycles`；按 occupancy.cycleId | 固定 cycleId | 同 org、room=occupancy.room、state、primaryOccupancyId、起止、endedAt、epoch/revision 与预读一致 | NOT_FOUND、REVISION_CONFLICT、INVALID_STATE | 输入 cycleId 是；快照否 |
| R10 | `rooms`；按 occupancy.roomId | 固定 roomId | 同 org、未归档；floor/building/community 绑定和 revision 与预读一致 | NOT_FOUND、ROOM_ARCHIVED、REVISION_CONFLICT | 否 |
| R11 | `property_catalog` floor；room.floorId 必填 | 固定 floorId | 同 org、kind=floor、未归档、parentId=room.buildingId、revision 一致 | NOT_FOUND、ROOM_ARCHIVED、REVISION_CONFLICT | 否 |
| R12 | `property_catalog` building；room.buildingId 必填 | 固定 buildingId | 同 org、kind=building、未归档、parentId=room.communityId、revision 一致 | NOT_FOUND、ROOM_ARCHIVED、REVISION_CONFLICT | 否 |
| R13 | `property_catalog` community；room.communityId 必填 | 固定 communityId | 同 org、kind=community、未归档、revision 一致 | NOT_FOUND、ROOM_ARCHIVED、REVISION_CONFLICT | 否 |
| R14 | `unique_claims`；由 org/room/cycle/person 计算既有 occupancy-person ID | 固定 claimId | 同 org、state=bound、ownerId=occupancyId | DUPLICATE_OCCUPANCY | 否 |
| R15 | `room_primary_slots`；既有 primarySlotId(org,room) | 固定 slotId | currentCycleId=目标 cycle；primary 时 currentOccupancyId/currentPersonId 同时匹配；member 的追加要求由 Q02 裁定 | INVALID_STATE、SPONSOR_INACTIVE | 否 |
| R16 | 当前 primary `occupancies`；cycle.primaryOccupancyId | member 且 Q02 要求时加入 | 同 org、同 room/cycle、role=primary、active、activeAt、revision 与预读一致 | NOT_FOUND、REVISION_CONFLICT、SPONSOR_INACTIVE | 否 |
| R17 | sponsor `occupancies`；仅目标 sponsorOccupancyId 非空且 Q02 要求时加入 | 固定 sponsorOccupancyId | 同 org、active、ID=cycle.primaryOccupancyId；更严格时间要求由 Q02 裁定 | NOT_FOUND、REVISION_CONFLICT、SPONSOR_INACTIVE | 否 |
| R18 | `lifecycle_guards`；既有 guardId(org) | 固定 guardId | epoch/revision 与当次预读一致；只读序列化入住结束与物业归档，不由 createGrant 写它 | 竞态由事务冲突或 REVISION_CONFLICT 失败关闭 | 否 |
| R19 | `access_devices`；H2-b 既有预读 | 固定 deviceId | 完整沿用 H2-b：org/owner、active、face capability、revision/claim/provider/realm/keyVersion 快照 | NOT_FOUND、INVALID_STATE、DEVICE_CLAIM_* | 输入 ID 是；快照否 |
| R20 | `device_claims`；H2-b 既有 claimId | 固定 claimId | active、ownerOrgId、结构与设备匹配；只读 | DEVICE_CLAIM_INVALID、DEVICE_CLAIM_CONFLICT | 否 |
| R21 | `device_digest_domains` | 固定 headId＋versionId，共 2 refs | 完整沿用 H2-b head/version 与设备配置匹配 | DOMAIN_INCOMPLETE、DEVICE_DIGEST_CONFIG_CHANGED | 否 |
| R22 | `grant_slot_claims` | 固定 slotId | 当前不存在；active/released 均不复用 | GRANT_SLOT_CONFLICT | 否 |
| R23 | grant/job/log | 三个确定性新 ID，共 3 refs | 仅全部校验通过后创建；不得覆盖已有记录 | 冲突失败关闭 | 否 |
| R24 | `operation_keys` | 固定 opKey | H2-a org/realm/keyVersion/requestDigest/result/createdAt 严格校验 | CONFLICT | 摘要本身来自 DTO |
| R25 | `operation_key_domains` | 固定 headId＋versionId，共 2 refs | 完整沿用 H2-a domain guard 与 fingerprint | H2-a 既有错误，不在本文改码 | 否 |
| R26 | `blacklist_entries` candidates | 当次 prepare 动态 N refs | 当前 org、state、restriction、subject、revision 和 activeAt；完整复用正式 evaluate | BLACKLIST_RETRY、DENIED、REVIEW_REQUIRED | 否 |
| R27 | `eligibility_guards` | 每个 subject 一个，1–3 refs | epoch 与当次 token 一致；成功/replay 可追加既有 guardWrite | BLACKLIST_RETRY | 否 |
| R28 | `blacklist_decisions` head | org/occupancy/restriction 的固定 headId | 精确 entryIds/revisions、restriction、expiresAt、allow/deny | BLACKLIST_DENIED、BLACKLIST_REVIEW_REQUIRED | 否 |

### 4.1 refs 数量与容量

- H2-a/H2-b 既有固定 refs：15 条（R01–R04、R19–R25 展开后）。
- H2-c 新增固定资格 refs：最多 11 条（R08–R18；R16/R17 按 member 与 Q02 条件加入）。
- 黑名单 token 固定 refs：person、identity application、decision head 共 3 条；有绑定账号时 user 1 条；subject guards 1–3 条；candidates N 条。
- 在“有绑定账号＋identity＋三个 subjects＋member primary 与 sponsor 为不同记录”的最大布局下，去重前逻辑总数及去重后上限均为 **33＋N**；primary=sponsor 等相同 `collection/id` 会进一步去重。
- `CloudStore.transact()` 在 290–295 行先去重再限制 90。因此上述最大布局下 `N<=57` 才能进入事务；`N=58` 时为 91 refs，当前以 HTTP 400、无稳定业务 code 失败关闭。
- 该公式是容量核算，不承诺云端其他限制或性能已验证。H2-c 测试只使用隔离 Store/合约替身验证数量，不连接真实云。

## 5. 资格规则：冻结项与决策门

### 5.1 可直接从现有代码冻结的规则

1. 时间区间均为 `[start,end)`：`startsAt<=now`，且 `endsAt===null || now<endsAt`；结束时刻不再有效。
2. `null` 结束时间表示该记录自身不设结束时刻，不覆盖其他上层约束。有效结束时间为 `minEnd(occupancy.endsAt, cycle.endsAt, cycle.endedAt)`。
3. DTO 继续要求有限数且 `validFrom<validUntil`。授权区间不得超出 occupancy/cycle 的包含边界：两者的 startsAt 均不得晚于 validFrom；effectiveEnd 非 null 时 validUntil 不得晚于它。是否还要求更窄条件见 Q03。
4. person 必须 active；有绑定账号时采用 `checkBoundUser()` 语义，无账号人员不伪造账号，也不使用代理人的账号。
5. identity application 必须同 org、同 person、approved 且有 identityDigest/keyVersion；revision 也纳入当次快照，禁止读取 `identity_private` 或原始实名材料。
6. occupancy/cycle/room/catalog 的 org、关系、kind、revision/epoch 均需在事务内复核。缺失或跨组织同态 NOT_FOUND；已归档与版本/关系变化分别映射见 §7。
7. room 的 floor/building/community ID 不得因缺失而跳过。必须补验 `floor.parentId=buildingId`、`building.parentId=communityId`；这是 `property-v2.createRooms()` 已存在的层级规则。
8. occupancy-person unique claim 必须 bound 到目标 occupancy，防止仅凭一条孤立 occupancy 记录授权。
9. lifecycle guard 只读纳入事务，用于与入住结束/物业归档串行化；H2-c 不新增 guard 算法或业务写。
10. 黑名单继续使用真实 `BlacklistService` 和 `occupancy.activate` restriction；不再接受测试桩注入的 `eligible=true` 作为生产语义证据。

### 5.2 不得抢先冻结的规则

- occupancy stored state 是否只接受 active：Q01。
- member 是否必须有有效 primary/room slot，以及非空 sponsor 是否必须继续有效：Q02。
- 授权是否允许短于入住期、是否必须当前已生效：Q03。
- 正式 qualification helper 的抽取方式：Q04。
- 三次 `BLACKLIST_RETRY` 后的对外表现：Q05。
- 为调整事务内顺序所需的最小接口：Q06。

## 6. 单事务顺序与最小接口提案

### 6.1 阻断

现有 `withEligibility()` 只接受固定 refs 和 build，并固定先 evaluate 后 build。仅把新 refs 塞入数组虽然能扩大事务读取范围，却不能满足“完整资格先于黑名单判决”；只在 build 中补验也无法改变顺序。另起第二次事务会引入两次判决之间的竞态，明确禁止。

### 6.2 推荐的可选 `prepareAttempt` 钩子（Q06，未批准）

建议在现有第五个 options 参数中增加可选的“每次尝试准备”回调，保留 `deferBlocked`；它同时提供当次资格 refs 和事务内前置复核，build 接收其只读结果。伪代码只表达契约，不是生产实现：

```text
withEligibility(request, baseRefs, build, audit,
                { deferBlocked = false, prepareAttempt = null })
  for attempt = 1..3:                         # 次数不变
    token = prepareEligibility(request)       # 原算法不变
    q = prepareAttempt ? prepareAttempt(token) : null
    txRefs = unique(baseRefs + (q?.refs || []) + token.refs)
    transact(txRefs, state):
      pre = q ? q.beforeEvaluate(state, token) : null
      eligibility = evaluateEligibility(state, token, { deferBlocked })
      built = build(state, eligibility, pre)  # replay 也在 evaluate 之后才返回
      return built.writes + subjectGuardWrites(state, token)
```

约束：

- `prepareAttempt()` 是预读，不是第二个事务；`beforeEvaluate()` 与黑名单判决、H2-b、核心写入仍在同一个 `transact()`。
- 每次 `BLACKLIST_RETRY` 都重新执行 q 的预读。若资格记录在两次尝试之间变化，必须以新快照重新完整复核；无法安全表达的变化失败关闭，绝不沿用旧快照放行。
- person/identity 的快照变化仍由正式 evaluate 产生 `BLACKLIST_RETRY`；identity revision-only 变化由 q 以同一内部重试语义处理，不抢先改成另一套名单算法。
- q 不返回名单结果，不修改 candidates/guards/decisions，不复制 `evaluateEligibility()`。
- 默认无 `prepareAttempt` 时保持 DB-05 既有调用兼容；createGrant 在 H2-c 必须显式提供。
- 若 Codex 不接受该最小接口，H2-c 继续阻断；不得退化为“先黑名单、后资格”或双事务。

### 6.3 createGrant 事务内顺序

```text
1. q.beforeEvaluate：
   a. 复核 organization、membership、device.access.manage；
   b. 计算但不提交 H2-a domain writes，检查 K2 domain 与 operation key；
      若发现合法 replay，仅记录 replayResult，不提前 return；
   c. 复核 credential/file；
   d. 复核 person/user/identity 与 R08–R18 的完整资格快照、时间和关系；
2. 调用真实 evaluateEligibility(state, token)，得到 allow/deny/review/retry；
3. build(state, eligibility, pre)：
   a. 若为合法 replay，返回原 result，核心 writes=[]；
   b. 新操作要求 eligibility.eligible=true；
   c. 完整执行 H2-b device/K1/owner claim/grant slot 只读复核；
   d. 全部通过后才返回核心写集 C 与必要 domain writes；
4. wrapper 按既有算法追加 subject guard writes；Store 按既有行为写审计。
```

任何失败均不得产生部分 C、guard 或审计提交，Provider 调用恒为 0。合法 replay 的准确副作用是：核心写集 C 内容不变，但 eligibility_guards 与 admin_audit 可按现状变化。

## 7. 错误映射（24 项）

同态原则：缺失、不可见或跨组织均返回相同 NOT_FOUND，不泄露目标是否存在于其他组织。调用前已经非法的 DTO/区间使用 PARAM_ERROR；预读后发生版本或关键关系变化使用 REVISION_CONFLICT；当前记录自身状态不允许使用 INVALID_STATE/专用状态码。

| 编号 | 错误／HTTP | 适用条件与竞态口径 |
| --- | --- | --- |
| M01 | NOT_FOUND／404 | credential、person、identity、occupancy、cycle、room、catalog 缺失或跨 org；device 不可见沿用现状 |
| M02 | FORBIDDEN／403 | org/membership 非 active 或缺 device.access.manage |
| M03 | PARAM_ERROR／400 | DTO 非法、validFrom>=validUntil、输入授权区间超出当次有效入住边界；缺 mandatory 输入 |
| M04 | REVISION_CONFLICT／409 | credential/occupancy/cycle/room/catalog 的 revision、epoch 或关键关系在预读后变化 |
| M05 | INVALID_STATE／409 | credential 非 approved、person 非 active、occupancy/cycle 状态或当前时间不允许；Q01/Q03 的结果使用此码 |
| M06 | USER_DISABLED／403 | person 已绑定 user，但 user 缺失或停用 |
| M07 | IDENTITY_NOT_APPROVED／403 | application 非 approved 或缺 identityDigest |
| M08 | IDENTITY_CONFLICT／409 | application.personId 与 credential person 不一致 |
| M09 | ROOM_ARCHIVED／409 | room 或 floor/building/community 任一级已归档 |
| M10 | DUPLICATE_OCCUPANCY／409 | occupancy-person claim 缺失、非 bound、跨 org 或 owner 不符 |
| M11 | SPONSOR_INACTIVE／409 | Q02 采用推荐方案时，member 的 primary/slot/非空 sponsor 失效 |
| M12 | BLACKLIST_DENIED／403 | 精确且未过期的 deny |
| M13 | BLACKLIST_REVIEW_REQUIRED／409 | 有命中但无精确有效 allow/deny |
| M14 | BLACKLIST_RETRY／409 | person/identity/guard/candidate 快照变化的内部重试信号；第三次耗尽后的当前对外码由 Q05 确认 |
| M15 | CONFLICT／409 | 同 op key 异摘要或 replay 记录损坏，沿用 H2-a |
| M16 | FILE_NOT_FOUND／404 | source file 不存在、跨 org、用途/私密/ready/MIME/size 不符合 binding |
| M17 | FILE_CHANGED／409 | source file revision 与 credential binding 不一致 |
| M18 | DEVICE_CLAIM_INVALID／409 | H2-b 设备快照、owner claim 缺失/损坏/非 active/绑定不一致 |
| M19 | DEVICE_CLAIM_CONFLICT／409 | device/claim ownerOrgId 冲突 |
| M20 | DOMAIN_INCOMPLETE／503 | H2-b K1 head/version 缺失、损坏或内部矛盾 |
| M21 | DEVICE_DIGEST_CONFIG_CHANGED／503 | K1 domain 完整但与设备 provider/realm/keyVersion 不符 |
| M22 | GRANT_SLOT_CONFLICT／409 | active 或 released slot 已存在，禁止复用 |
| M23 | ADAPTER_UNAVAILABLE／503 | 正式 blacklist/必要资格适配器未配置；不得回退 eligible=true |
| M24 | HTTP 400／当前无业务 code | 去重 refs>90，CloudStore 在事务前拒绝；不得伪装成资格通过或拆分事务 |

H2-a 的 K2 domain 专用错误仍按既有实现和终审处理，本文不改码、不重编号。错误优先级由 §6.3 固定：权限/op/资格先于黑名单，黑名单先于 H2-b；组合竞态测试必须验证先出现的错误，不能只断言“某种失败”。

## 8. 测试矩阵 D01–D75

### 8.1 统一 fixture、注入和副作用断言

- **F-P**：完整 primary fixture。真实组织/成员权限、已审核 credential 和私密 ready file、active person、approved identity、有效 active occupancy/cycle、active room 与三级目录、bound unique claim、匹配 primary slot、有效 H2-a/H2-b device/domain/claim，无黑名单命中。
- **F-M**：完整 member fixture。除 F-P 外有有效 current primary、匹配 room slot；sponsor 场景另有一个非空 sponsorOccupancyId。
- **T0**：调用前构造无效记录；**T1**：当次资格与黑名单预读后、事务复核前用 barrier 注入；**T2**：第一次内部 retry 后、下一次预读前注入；**T3**：黑名单评价后、H2-b 复核前注入；**PAR**：两个真实服务调用并发。
- **Z**：对下列全部集合做结构化深比较，不只比较条数：grant/job/slot/log/operation key、credential/file、org/membership、person/user/identity、occupancy/cycle/room/catalog、unique claim/room primary slot/lifecycle guard、device/device claim/K1/K2 domain、blacklist entries/decisions/eligibility guards、admin_audit。故障注入自身造成的变化先固化成“注入后基线”，Z 断言 createGrant 不再增加任何变化。
- **S**：成功时仅允许核心写集 C、既有 subject guard writes 和一条 admin audit；fixture 预建有效 K2 domain，故不得借成功路径改资格或 H2-b 只读记录。除这些明确写集外执行 Z。
- **R**：合法 replay 时 C 深比较不变，prepare/evaluate 确实执行；guard 和 admin audit 可按现状变化，其余执行 Z。
- **P0**：每一行都断言 Mock/真实 Provider 调用为 0，不读取私密文件字节，不访问设备/HTTP/生产云。
- 所有测试使用真实 `BlacklistService`；不得复用 face-service-layer 测试 18–31 行的全局 eligible 桩。竞态用事务 barrier 控制顺序，并至少正序、逆序各跑一次。

| ID | fixture 与变化 | 注入时点 | 预期结果（含尝试次数） | 副作用断言 |
| --- | --- | --- | --- | --- |
| D01 | F-P 全有效 | 无 | 成功，1 次；pending grant/queued job | S；P0 |
| D02 | F-M 全有效，Q02 推荐规则 | 无 | 成功，1 次 | S；P0 |
| D03 | person 缺失 | T0 | NOT_FOUND | Z；P0 |
| D04 | person 跨组织 | T0 | NOT_FOUND，与 D03 同态 | Z；P0 |
| D05 | person.status 非 active | T0 | INVALID_STATE | Z；P0 |
| D06 | person.revision 改变一次，其余仍合法 | T1 | 首次内部 BLACKLIST_RETRY，第二次完整复核后成功；prepare=2 | S（以注入后为基线）；P0 |
| D07 | person.userId 改绑到另一 active user | T1 | 首次 retry，第二次使用新 user subject/ref 后成功；不得沿用旧绑定 | S；P0 |
| D08 | person 绑定的 user 缺失 | T0 | USER_DISABLED | Z；P0 |
| D09 | bound user 停用；另测无账号 person 不受影响 | T0 | 绑定者 USER_DISABLED；无账号合法 fixture 可成功 | Z 或 S；P0 |
| D10 | identity application 缺失 | T0 | NOT_FOUND | Z；P0 |
| D11 | identity application 跨组织 | T0 | NOT_FOUND，与 D10 同态 | Z；P0 |
| D12 | identity 为 draft/submitted/rejected | T0 | IDENTITY_NOT_APPROVED | Z；P0 |
| D13 | identity.personId 不同 | T0 | IDENTITY_CONFLICT | Z；P0 |
| D14 | approved identity 缺 digest | T0 | IDENTITY_NOT_APPROVED | Z；P0 |
| D15 | identityDigest 在预读后改变且记录仍 approved | T1 | 首次 retry；第二次以新 digest/key subject 全量复核，不得使用旧 digest | S 或按新记录真实名单结果；P0 |
| D16 | keyVersion 在预读后改变 | T1 | 首次 retry；第二次重取 subject/guard refs，不使用旧版本 | S 或真实名单结果；P0 |
| D17 | identity revision-only 改变一次 | T1 | 内部 BLACKLIST_RETRY；第二次重读新 revision 后成功 | S；P0 |
| D18 | person/identity 连续变化使三次尝试均失效 | T1＋T2 每次 | 第三次后 BLACKLIST_RETRY（Q05）；无第四次 | Z（以最后注入后为基线）；P0 |
| D19 | occupancy 缺失 | T0 | NOT_FOUND | Z；P0 |
| D20 | occupancy 跨组织 | T0 | NOT_FOUND，与 D19 同态 | Z；P0 |
| D21 | occupancy.personId 与 credential person 不同 | T0/T1 | REVISION_CONFLICT | Z；P0 |
| D22 | occupancy.roomId 与预读关系不同 | T1 | REVISION_CONFLICT | Z；P0 |
| D23 | occupancy.cycleId 与输入或预读不同 | T0/T1 | REVISION_CONFLICT | Z；P0 |
| D24 | occupancy.role 非 primary/member；另例在预读后由 primary 改为 member | T0；另例 T1 | 非法角色 INVALID_STATE；预读后角色变化 REVISION_CONFLICT | Z；P0 |
| D25 | occupancy 为 invited/pending_review/ended | T0 | Q01 推荐：INVALID_STATE；未裁定前编码验收不通过 | Z；P0 |
| D26 | occupancy.revision 改变 | T1 | REVISION_CONFLICT | Z；P0 |
| D27 | now<occupancy.startsAt | T0 | INVALID_STATE | Z；P0 |
| D28 | now=occupancy.endsAt | T0 | INVALID_STATE，排他结束边界 | Z；P0 |
| D29 | occupancy.endsAt=null，cycle 仍有效 | T0 | 可成功；null 不自动失效 | S；P0 |
| D30 | cycle 缺失 | T0 | NOT_FOUND | Z；P0 |
| D31 | cycle 跨组织 | T0 | NOT_FOUND，与 D30 同态 | Z；P0 |
| D32 | cycle.roomId 与 occupancy.roomId 不同 | T0/T1 | REVISION_CONFLICT | Z；P0 |
| D33 | cycle.state=pending/ended | T0 | INVALID_STATE | Z；P0 |
| D34 | cycle.epoch 或 revision 改变 | T1 | REVISION_CONFLICT | Z；P0 |
| D35 | now 在 cycle 开始前或 endsAt/endedAt 结束时刻 | T0 | INVALID_STATE | Z；P0 |
| D36 | room 缺失、跨组织各一例 | T0/T1 | NOT_FOUND，同态 | Z；P0 |
| D37 | room.status=archived | T0/T1 | ROOM_ARCHIVED | Z；P0 |
| D38 | room 的 floor/building/community 绑定或 revision 改变 | T1 | REVISION_CONFLICT | Z；P0 |
| D39 | floor 缺失、跨组织、kind 错误各一例 | T0/T1 | NOT_FOUND，同态 | Z；P0 |
| D40 | floor 归档 | T0/T1 | ROOM_ARCHIVED | Z；P0 |
| D41 | floor.parentId!=room.buildingId | T0/T1 | REVISION_CONFLICT | Z；P0 |
| D42 | building 缺失、跨组织、kind 错误各一例 | T0/T1 | NOT_FOUND，同态 | Z；P0 |
| D43 | building 归档 | T0/T1 | ROOM_ARCHIVED | Z；P0 |
| D44 | building.parentId!=room.communityId | T0/T1 | REVISION_CONFLICT | Z；P0 |
| D45 | community 缺失、跨组织、kind 错误各一例 | T0/T1 | NOT_FOUND，同态 | Z；P0 |
| D46 | community 归档 | T0/T1 | ROOM_ARCHIVED | Z；P0 |
| D47 | 任一级 catalog revision 改变 | T1 | REVISION_CONFLICT | Z；P0 |
| D48 | validFrom<occupancy.startsAt | T0 | PARAM_ERROR | Z；P0 |
| D49 | validUntil>occupancy.endsAt | T0 | PARAM_ERROR | Z；P0 |
| D50 | validFrom<cycle.startsAt | T0 | PARAM_ERROR | Z；P0 |
| D51 | validUntil>min(cycle.endsAt,cycle.endedAt) | T0 | PARAM_ERROR | Z；P0 |
| D52 | 授权区间严格短于且包含于入住/周期 | T0 | Q03 推荐：允许并成功；若裁定不等价则按裁定 | S 或 Z；P0 |
| D53 | now<validFrom，授权尚在将来 | T0 | Q03 推荐：INVALID_STATE | Z；P0 |
| D54 | now=validFrom，且其他边界有效 | T0 | Q03 推荐：成功，开始边界包含 | S；P0 |
| D55 | now=validUntil | T0 | Q03 推荐：INVALID_STATE，结束边界排他 | Z；P0 |
| D56 | 真实 blacklist 无命中 | T0 | eligible=true，成功；无自制 eligible 桩 | S；P0 |
| D57 | 精确未过期 deny，entryIds/revisions 全匹配 | T0 | BLACKLIST_DENIED | Z；P0 |
| D58 | 有命中但无决定/决定条目不全/已过期 | T0 | BLACKLIST_REVIEW_REQUIRED | Z；P0 |
| D59 | 精确未过期 allow，完整 entryIds/revisions | T0 | 成功；decisionId 来自真实 evaluate | S；P0 |
| D60 | guard epoch 在预读后改变一次 | T1 | 第一次 retry，第二次 prepare/evaluate/build 全跑后成功；尝试=2 | S（注入后为基线）；P0 |
| D61 | 新增/修改 candidate 使其在预读后命中 | T1 | guard 变化触发完整重试；第二次真实判决 REVIEW_REQUIRED 或 DENIED | Z（注入后为基线）；P0 |
| D62 | guard/candidate 连续三次变化 | 每次 T1/T2 | BLACKLIST_RETRY；prepare/transact 各 3，无第 4 次 | Z；P0 |
| D63 | 同时撤销成员权限、改变 file revision 和 device revision | T1 | FORBIDDEN，证明权限优先；无后续资格/设备写入 | Z；P0 |
| D64 | 权限有效，同时改变 file revision 与 K1 domain | T3 前 | FILE_CHANGED，资格/文件错误先于 H2-b | Z；P0 |
| D65 | 资格有效，同时释放 owner claim 并预建 slot | T3 | DEVICE_CLAIM_INVALID，H2-b 顺序保持；slot 不被覆盖 | Z；P0 |
| D66 | 同一资格、不同 op key 并发创建同 slot | PAR | 仅一个成功，另一个 GRANT_SLOT_CONFLICT；正反顺序均只有一组 C | 成功侧 S；失败侧 Z；P0 |
| D67 | 同 op key、同 DTO 摘要合法重放 | 顺序调用 | 返回原 result；prepare/evaluate 各仍执行；核心 writes=[] | R；P0 |
| D68 | 同 op key、不同 DTO 摘要 | 顺序调用 | CONFLICT；不得重放或覆盖 | Z；P0 |
| D69 | 首次成功后 occupancy 失效，再同键同摘要重放 | T0 重放前 | Q01/Q03 对应资格错误；不得因 replay 跳过资格或名单 | Z（op/grant 等原记录不变）；P0 |
| D70 | member 的 current primary 缺失/非 active | T0/T1 | Q02 推荐：SPONSOR_INACTIVE 或缺失同态 NOT_FOUND，按裁定唯一化 | Z；P0 |
| D71 | member 的 room slot cycle/occupancy/person 不匹配 | T0/T1 | Q01/Q02 推荐：SPONSOR_INACTIVE 或 INVALID_STATE | Z；P0 |
| D72 | 非空 sponsor 非 active 或不等于 cycle.primaryOccupancyId | T0/T1 | Q02 推荐：SPONSOR_INACTIVE | Z；P0 |
| D73 | 最大布局且有 57 个 candidate refs，合计 90 | T0 | 隔离容量合约下可进入单事务并真实评价；不得丢资格 refs | 依名单结果为 S 或 Z；P0 |
| D74 | 最大布局且有 58 个 candidate refs，合计 91 | T0 | CloudStore 当前 HTTP 400、无业务 code；事务次数=0 | Z；P0 |
| D75 | prepareAttempt 未提供、返回旧快照或伪造 eligible | T0/T1 | createGrant 失败关闭（ADAPTER_UNAVAILABLE/契约错误）；不得回退成功 | Z；P0 |

### 8.2 矩阵验收补充

1. D06、D07、D15–D18、D60–D62 必须同时记录 prepare、transaction、evaluate、build 的实际调用次数，证明是完整重试而不是只重跑最后一个函数。
2. D66 对两个并发方向分别深比较全部记录，不能接受“两个都成功但后写覆盖”或“靠唯一索引兜底”。
3. D67 不得断言 admin_audit/eligibility_guards 全不变；D03–D65、D68–D75 的失败路径则必须包含这两类集合的零新增断言。
4. D73–D74 只验证 refs 容量契约，不宣称已完成 DB-08 真实云探针。
5. Q01–Q06 裁定后，将条件项转成唯一预期；未裁定前不得通过删除测试或放宽断言制造“通过”。

## 9. Codex 待裁定事项（仅六项）

| 编号 | 无法由现有契约单独确定的事项 | 推荐方案 | 影响 |
| --- | --- | --- | --- |
| Q01 | face grant 是否只允许 stored `occupancy.state=active` | 是，并要求 cycle active、stored/effective 均有效；scheduled/invited/pending_review/ended 不授权 | D25、D69、D71；拒绝把旧邀请或待审关系直接变成门禁资格 |
| Q02 | member 是否必须依赖有效 primary/room slot 与 sponsor | member 必须有当前有效 primary 和匹配 slot；sponsorOccupancyId 非空时必须仍 active 且等于 cycle.primaryOccupancyId；null 不虚构 sponsor | 增加 R16/R17 条件 refs；D02、D70–D72；与 activate() 639–653 对齐 |
| Q03 | 授权可否短于入住期，是否必须从当前时间开始 | 允许严格更短，但必须完全包含于 occupancy/cycle；要求 `validFrom<=now<validUntil`，now 也在入住有效区间；不要求时间戳精确等于 now | D48–D55；若允许未来授权需另定 scheduled grant 状态，当前不新增 |
| Q04 | qualification refs/helper 是否复用或抽取正式 OccupancyService | 抽取共享只读 qualification helper，由 OccupancyService 与 FaceCredentialService 复用；property 使用 OrgPropertyService 的 org/kind/层级规则，禁止复制一套简化逻辑 | 决定编码文件边界与回归范围；不修改黑名单算法 |
| Q05 | 三次 BLACKLIST_RETRY 耗尽的对外错误码 | 当前服务层保留 `409 BLACKLIST_RETRY`；H2-c 不注册 HTTP、不新增映射。未来若对外改用稳定 QUALIFICATION_RETRY 需另审兼容性 | D18、D62；避免擅自改 DB-06 现有调用方 |
| Q06 | 如何实现“完整资格先于黑名单判决”且每次 retry 刷新快照 | 批准 §6.2 单个可选 prepareAttempt 钩子及 build 第三参只读上下文；保持单事务、三次重试和原 evaluate/guard/decision | 这是编码阻断项；不批准则 H2-c 不开工，不允许双事务或缩小 refs |

## 10. 数据、兼容与交付边界

- 不新增、迁移或补写历史 occupancy、identity、device、claim 数据；缺 claim、owner 或必要组织字段时失败关闭。
- 不读取或记录姓名、手机号、地址、证件号、设备序列号、MAC、IP、凭据、完整指纹、人脸、黑名单证据或原始响应。
- 不改 `deviceDigest()/deviceClaimKey()`、K1/K2 schema、operation ID、slot 规则、guard/decision 算法。
- 不改变 DB-05 入住激活、DB-06 名单审核和 DB-07 私密文件读取权限；资格 helper 只允许返回最小必要字段。
- 本稿不包含生产代码或测试改动，因此没有服务测试“通过”声明；D01–D75 是待编码后执行的验收计划。
- 本文提交后等待 Codex 复审与 Q01–Q06 裁定。复审通过前，H2-c 编码、H2-d/H3/H4、HTTP、Provider 和设备写操作继续关闭。
