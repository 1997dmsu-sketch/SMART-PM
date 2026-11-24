# checkinFaceTest 唯一接口清单（A 路，任务键 CHECKIN-FACE-REWORK-0d6c674）

本文档是 B/C/D 接入前必须对齐的唯一接口契约，由 A 路（云函数 checkinFaceTest）
落盘并实现。任何一路不得另行编造本文未定义的字段或错误码；发现缺口先回报，
不得用双方各自编造的 mock 冒充贯通证据。复审基线：0d6c674；复审对象固定于
CODEX-REVIEW-2026-11-24.md（R01/R03/R04/R06）。

约定：云函数所有响应均为 `{code, data, msg}`；code 0 为成功，非 0 为失败，
`data` 为 `null`。错误码为大写下划线闭式（closed-form）字符串，见 §5。

---

## 1. 上传契约（R01）——真实 SDK fileID 正向贯通

### 1.1 标识模型

- 小程序用 `wx.cloud.uploadFile({ cloudPath, filePath, config: { env } })`
  上传，**原样**取得返回值 `response.fileID`（形如
  `cloud://<命名空间>/<对象路径>`），并把该 fileID **原样**传入
  `createFaceTask.fileId`。全程不摘协议头、不拼接、不猜测。
- 服务端把 fileID 拆为两段：
  - **命名空间（namespace）**：`cloud://` 之后、第一个 `/` 之前的整段，
    例如 `prod-env-id.7465-prod-env-id-1300000000`。
  - **规范对象路径（canonical object path）**：第一个 `/` 之后的整段，
    形如 `test-face/{environment}/{openid}/{applicationId}/{fileName}`。
- 服务端持久保存**验证过的真实 fileID** 与**规范对象路径**（`task.fileId`、
  `task.cloudPath`）。worker 下载必须使用同一真实 fileID（`cloud://…`），
  不得回退到裸路径。

### 1.2 可信云存储命名空间：配置来源与公开管理员配置路径

- 配置来源：`test_program_config` 文档（`_id = checkin-face-test|config`）
  的 `storageNamespace` 字段，是服务端**唯一**可信命名空间来源。
- 公开管理员配置路径（admin-only，沿用后台 session + CSRF + origin 校验）：
  `PUT /api/checkin-face-test/storage`，请求体 `{ namespace, reason }`。
  - 前端页面：`admin-web/public/checkin-face-test.html` + `checkin-face-test-config.js`
    「可信云存储命名空间」小节；页面只展示/编辑该值，不回显任何秘密。
  - 服务端路由与云函数共用**同一份**校验正则
    `STORAGE_NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`
    （`cloudfunctions/checkinFaceTest/lib/validate.js` 为唯一定义，
    `admin-web/lib/checkin-face-test-config.mjs` 与 `admin-web/server.mjs`
    直接 require 该定义，两端一致校验，测试断言一致）。
  - 管理员填写的值 = 真实环境 `wx.cloud.uploadFile` 返回 fileID 中
    `cloud://` 与第一个 `/` 之间的整段（以现场联调时实际观察为准，
    见 §1.6 未验证项）。
- `setSwitch(true)`（自动通过总开关）前置条件新增：`storageNamespace`
  必须已配置，否则 `STORAGE_NAMESPACE_UNCONFIGURED` 拒绝开启且零写入。
- 服务端 `getConfig` 返回 `storageNamespaceConfigured: boolean`（只下发布尔）。

### 1.3 服务端核验顺序（全部通过才可建任务）

1. 形态：字符串、非空、长度 ≤ 512、无空白/控制字符，以 `cloud://` 开头。
2. 命名空间：语法匹配 `STORAGE_NAMESPACE_PATTERN`，且与配置的
   `storageNamespace` **完全相等**（区分大小写）。
3. 对象路径：必须以 `test-face/{environment}/{openid}/{applicationId}/` 开头
   （本人 + 本申请绑定；environment 为服务端内部常量 `checkin-face-test`）。
4. 文件名：`/^[A-Za-z0-9][A-Za-z0-9._-]{0,122}\.(jpe?g)$/i`，不含 `..`、
   不含 `%`、不含路径分隔符、不含控制字符。
5. 照片内容：仅在前四项通过之后，服务端才用 `cloud.downloadFile({ fileID })`
   做 JPEG 魔数 + ≤ 200 KiB 校验。**能下载到文件不构成归属证据**；
   归属以 1–4 的确定性绑定为准，下载只用于内容校验。

### 1.4 拒绝类别（闭式错误码）

| 场景 | 错误码 | 说明 |
|---|---|---|
| 裸路径 `test-face/…`（旧实现曾接受） | `INVALID_FILE_ID` | 不再接受；必须真实 `cloud://` fileID |
| 非 `cloud://` / 空 / 超长 / 控制字符 / 畸形 | `INVALID_FILE_ID` | 形态拒绝 |
| 命名空间与配置不一致（跨环境） | `FILE_NAMESPACE_MISMATCH` | 不换环境 |
| 对象路径非本 openid/本 applicationId 前缀（跨用户/跨申请） | `FILE_OWNERSHIP_MISMATCH` | 不换人、不换申请 |
| 文件名非法（扩展名/`..`/分隔符/`%`） | `INVALID_FILE_ID` | 畸形路径拒绝 |
| 服务端 `storageNamespace` 未配置 | `STORAGE_NAMESPACE_UNCONFIGURED` | 配置缺失失败关闭 |
| 下载失败/非 JPEG/超 200 KiB | `PHOTO_INVALID` | 内容校验，不落任务 |

### 1.5 兼容边界

- 旧数据（裸路径 fileId）不重写、不迁移；worker 下载侧对非 `cloud://` 一律
  `FILE_ID_INVALID` 失败关闭（原有行为保持）。客户端在新契约下重新上传，
  排队态任务经 `replaceFacePhoto`（事务内 CAS）更新 fileId/cloudPath，
  employeeNo 永不改变。
- 同名对象路径重复上传：`wx.cloud.uploadFile` 对同一 cloudPath 返回相同
  fileID（覆盖对象内容）；fileID 相同时不触发换照片分支、不 bump revision。
- 服务端下发的相对 cloudPath（`getMyTask` 的 `cloudPath`，供 uploadFile
  使用）保持原格式 `test-face/{environment}/{openid}/{applicationId}/photo.jpg`，
  不包含 `cloud://` 前缀（该前缀由小程序 SDK 返回的 fileID 携带）。
- `createFaceTask` 的入参白名单不变：`action/applicationId/fileId/consent`。

### 1.6 未验证项（精确缺口，不得视为已覆盖）

- 真实腾讯 fileID 命名空间的具体形态（`env-id.bucket-domain` 与旧式
  `env-id` 两种历史形态）未经真实 SDK 实测；契约以「与管理员配置完全相等」
  适配任一形态，由管理员按现场联调实际返回值填写。
- 对象路径是否被 fileID 百分号编码未实测；本契约按不编码假设严格拒绝 `%`，
  若真实 SDK 返回编码形态需在联调时调整（当前视为拒绝更安全的方向）。
- `cloud.downloadFile` 在本云函数内读取跨环境/他人文件的能力未实测；
  归属判定不依赖其可读性。

---

## 2. 执行前复核契约（R06）—— beginTaskExecution

### 2.1 调用

- action：`beginTaskExecution`（worker 专用，走 worker token 鉴权）。
- 请求字段白名单：`action / workerToken / workerId / taskId / claimId / revision`。
  任何其他字段（含 `approved`、`status` 等）被 `CLIENT_FIELD_FORBIDDEN`
  或 `UNKNOWN_FIELD` 拒绝。**不接收客户端自报“已批准”或任何新目标字段**
  （新 employeeNo、新租期、新房间一律不在白名单，无法传入）。
- `workerToken`：与服务端配置哈希常量时间比对（SHA-256，同一
  `WORKER_UNAUTHORIZED` 语义，与 claimTask/reportTask 一致）。
- `workerId`：`/^[A-Za-z0-9_-]{1,64}$/`；`taskId`：与任务确定性 id 相同
  模式；`claimId`：`/^[A-Za-z0-9-]{16,80}$/`；`revision`：安全整数且 ≥ 2。

### 2.2 服务端在真实事务内逐项复核（全部点读，无集合查询）

事务边界内重新读取**当前权威状态**（不是回显旧 claim 快照）并校验：

1. `task` 存在（`TASK_NOT_FOUND`）；
2. `task.claimId === claimId`（`CLAIM_MISMATCH`）；
3. `task.revision === revision`（`REVISION_CONFLICT`）；
4. `task.status === CLAIMED`（否则 `EXECUTION_ALREADY_STARTED` /
   `TASK_NOT_CLAIMED`）；
5. `task.workerId === workerId`（`WORKER_MISMATCH`）；
6. 时限：服务端 `now >= claimExpiresAt` 即拒绝（`CLAIM_EXPIRED`）。
   **成功不延长原 claimExpiresAt、不延长租期**；
7. 权威 gate（与派发同源）：config `enabled && dispatchEnabled`、
   `task.configRevision === config.revision`、名单 active、申请
   `auto_approved` 且版本/房间/租期 revision 一致、房间绑定
   `_id/revision/doorNo` 一致、租期 `_id/revision/validFrom/validTo/窗口内`。
   任一不符 → `EXECUTION_INVALIDATED`。
8. 全部通过才原子推进：`CLAIMED → DEVICE_PROCESSING`，
   `revision` **恰好 +1**，claimId/claimExpiresAt/employeeNo/fileId/
   门号/租期/计划指纹等业务字段不变；同一事务写 audit
   （action `beginTaskExecution`，revision = 推进后值）。

### 2.3 成功响应

```json
{
  "code": 0,
  "data": {
    "task": {
      "taskId": "<任务确定性 id>",
      "applicationId": "<申请 id>",
      "name": "<登记姓名>",
      "employeeNo": "<稳定人员编号，不变>",
      "fileId": "cloud://<命名空间>/<规范对象路径>",
      "cloudPath": "test-face/<environment>/<openid>/<applicationId>/<fileName>",
      "doorNo": 7,
      "deviceKey": "<非空稳定设备标识>",
      "validFrom": "YYYY-MM-DDT00:00:00",
      "validTo": "YYYY-MM-DDT23:59:59",
      "timezone": "Asia/Shanghai",
      "dailyHours": "24x7",
      "accessPlanFingerprint": "<64 位十六进制>",
      "claimId": "<领取 id，不变>",
      "claimExpiresAt": <原领取过期毫秒，不延长>,
      "status": "DEVICE_PROCESSING",
      "revision": <claim 时 revision + 1>,
      "configRevision": <n>,
      "roomRevision": <n>,
      "leaseRevision": <n>,
      "roomBindingId": "<id>",
      "leaseSnapshotId": "<id>",
      "workerId": "<领取者>",
      "authorizedAt": <服务端整数毫秒时间>
    },
    "authorizedAt": <服务端整数毫秒时间>
  },
  "msg": ""
}
```

`authorizedAt` 为服务端生成时间（进入事务时 `now()` 的整数毫秒），
不回显客户端时间。

### 2.4 错误分类清单（闭式，worker 必须全部按「零设备执行」处理）

| 错误码 | 语义 | 服务端状态副作用 |
|---|---|---|
| `WORKER_UNAUTHORIZED` | token 缺失/不匹配/未配置 | 无 |
| `INVALID_WORKER_TOKEN` / `INVALID_WORKER_ID` / `INVALID_TASK_ID` / `INVALID_CLAIM_ID` / `INVALID_REVISION` | 字段白名单/格式违规 | 无 |
| `CLIENT_FIELD_FORBIDDEN` / `UNKNOWN_FIELD` | 携带白名单外字段（含自报已批准/新目标） | 无 |
| `TASK_NOT_FOUND` | 任务不存在 | 无 |
| `CLAIM_MISMATCH` | claimId 与任务当前 claim 不一致 | 无 |
| `REVISION_CONFLICT` | revision 与任务当前 revision 不一致（重复开始/旧 revision） | 无 |
| `WORKER_MISMATCH` | workerId 与领取者不一致 | 无 |
| `TASK_NOT_CLAIMED` | 任务不在 CLAIMED（排队/终态等） | 无 |
| `EXECUTION_ALREADY_STARTED` | 任务已 DEVICE_PROCESSING，不重复授权 | 无 |
| `CLAIM_EXPIRED` | 服务端 now ≥ claimExpiresAt（本地时间/字段无效同样失败关闭） | 任务原子推进 `UNKNOWN_RESULT` + resultCode `CLAIM_TIMEOUT` + audit；不延长、不重授权 |
| `EXECUTION_INVALIDATED` | 复核时已撤名单/关开关/撤权/换房/改租期/版本变化 | 任务原子推进 `INVALIDATED` + resultCode 为具体 gate 码 + audit |
| `TRANSACTION_UNAVAILABLE` | 数据库无事务能力 | 无；失败关闭，不静默降级 |
| `TX_UNSUPPORTED_QUERY` | 服务端事务内误用集合查询（编程错误护栏） | 无 |
| `INTERNAL_ERROR` | 云不可用/DB 异常/未知错误 | 视同拒绝 |

### 2.5 C 路义务（由 C 路实现，A 只提供服务端复核）

- 下载/准备完成后、**设备执行前**调用 beginTaskExecution；仅在
  `code === 0` 且 `task.status === 'DEVICE_PROCESSING'` 且
  `task.revision === 请求 revision + 1` 且 `authorizedAt` 为明确时间事实时，
  才允许设备写入。
- 必须校验返回 task 与已领取/实际下载对象的全部业务字段一致
  （fileId/employeeNo/deviceKey/doorNo/租期/计划指纹/claimId），
  不接受新租期或新目标覆盖进旧任务继续执行。
- 后续 `reportTask` 使用**推进后的 revision**。
- 任何失败/无有效答复 → 零设备执行；不自动重领/续期/重试开始；
  重复开始、旧 revision、已过期、失效、回执未知不得再次获得可执行授权。
- 云事务与硬件请求之间仍有窗口：已发生或未知的设备事实保留
  （report exitCode 5 / UNKNOWN_RESULT 语义不变），本契约不承诺跨系统原子撤销。

---

## 3. 事务契约（R03/R04）—— 服务端实现声明

### 3.1 事务实际支持能力（按 wx-server-sdk 文档实现，未实测项见 §3.3）

- 事务内**支持**：单文档点读 `tx.collection(c).doc(id).get()`、点写
  `doc(id).set()`、`collection(c).add()`（含指定 `_id`）。
- 事务内**不支持**：`where()` 查询、`count()`、`collection.get()`、
  `orderBy` 等集合查询。代码不假定 range query 在事务内有效。
- `db.runTransaction` 缺失时：所有写入路径抛 `TRANSACTION_UNAVAILABLE`
  失败关闭，**绝不静默降级为串行非原子实现**。

### 3.2 原子边界（业务写 + 对应 audit 同事务）

| 路径 | 事务内权威 gate（全部点读） | 事务内写入 |
|---|---|---|
| applyCheckin | config/allowlist/room/lease（点读）+ 申请幂等读取 | APPLICATION + audit |
| createFaceTask 首建 | config/allowlist/room/lease/申请（点读） | TASK（create-only）+ audit |
| createFaceTask 换照片 | 同上 + 任务点读 | TASK CAS（revision+1）+ audit |
| claimTask（每候选） | config/申请/房间/租期（点读） | TASK CAS 推进 + audit |
| claim 超时清理（每条） | 任务点读复核 | TASK → UNKNOWN_RESULT + audit |
| reportTask | config/申请/房间/租期（点读）+ 任务点读 | TASK 终态 + audit |
| beginTaskExecution | §2.2 全集（点读） | TASK → DEVICE_PROCESSING + audit |

- 提交失败（含冲突耗尽、模拟提交故障）→ 业务与 audit **全回滚**，
  不回落到外层 DB 写任何东西。
- 事务冲突按快照隔离自动重试（mock 与代码均实现/依赖此语义）；
  回调必须幂等（全部为「点读当前值 → 校验 → 写」的 CAS 结构）。

### 3.3 稳定守卫与明确缺口

- 102 唯一性 count（`where({displayNo:'102'}).count()`）是集合查询，
  事务内不可用。稳定守卫 = **确定性 `_id` 单点读**（永远绑定负责人配置的
  唯一稳定文档，绝不按显示房号取任意第一条）+ **管理员写入时 count 门禁**
  （`upsertRoomBinding` 写前计数，写路径在事务外、被真实 SDK 支持）。
  云函数侧在 apply/create 的**非事务预检**中仍执行完整 count 防歧义；
  事务内复核依赖确定性点读。**已知边界**：绕过公开方法直接注入同号重复
  文档、且发生在预检与提交之间的场景，事务内无法用 count 检出；
  确定性点读仍保证不会误绑到另一条，报告为精确缺口，不宣称已覆盖。
- 同名未过申请（CONCURRENT_APPLICATION）检查是集合查询：在非事务预检执行；
  事务内以确定性 applicationId 点读复核。本系统无任何路径写入
  非 auto_approved 申请，该检查为纵深防御，边界如实记录。
- 事务内集合查询误用由 `TX_UNSUPPORTED_QUERY` 硬性抛错（store 层，
  不回落 base），测试断言 tx 上下文 list/count 必然抛错。

### 3.4 revision 单调性与不可破坏状态（R04）

- 任务首建为**事务内 create-only**（先点读、后写，同一原子边界）；
  已存在任务绝不无条件覆盖。晚到创建者（读无记录后另一创建者已建并被
  领取）在冲突重试后走「已有任务」分支：已领取/终态 → `TASK_ALREADY_CLAIMED`，
  不重置 claim、不回退 revision、不换 employeeNo。
- 所有推进路径 revision 恰好 +1；claimId 只在 claim 时生成一次；
  终态不覆盖；employeeNo 由申请生成后永不改变（换照片、失效、超时均不变）。
- report 幂等：终态 + 输出指纹一致 → 幂等返回，不重复推进；
  重传 CAS 与审计不破坏状态。

---

## 4. 接口/白名单变更汇总（本次 A 路新增/修改）

1. `ACTION_FIELDS` 新增 `beginTaskExecution: ['action','workerToken','workerId','taskId','claimId','revision']`；
   `WORKER_ACTIONS` 新增 `beginTaskExecution`。
2. `createFaceTask.fileId` 语义收紧：只接受 `cloud://<可信命名空间>/<本人本申请对象路径>`。
3. 配置文档新增 `storageNamespace`；公开管理路由
   `PUT /api/checkin-face-test/storage`；`setSwitch(true)` 新增前置；
   `getConfig` 新增 `storageNamespaceConfigured`。
4. 新增闭式错误码：`INVALID_FILE_ID`（语义扩展）、`FILE_NAMESPACE_MISMATCH`、
   `STORAGE_NAMESPACE_UNCONFIGURED`、`CLAIM_EXPIRED`、`EXECUTION_INVALIDATED`、
   `EXECUTION_ALREADY_STARTED`、`TASK_NOT_CLAIMED`、`WORKER_MISMATCH`、
   `TRANSACTION_UNAVAILABLE`、`TX_UNSUPPORTED_QUERY`。
5. 已有错误码语义不变：`FILE_OWNERSHIP_MISMATCH`、`PHOTO_INVALID`、
   `TASK_ALREADY_CLAIMED`、`REVISION_CONFLICT`、`CLAIM_MISMATCH`、
   `DISPATCH_DISABLED`、`WORKER_UNAUTHORIZED` 等。

---

## 5. 错误码全表（checkinFaceTest 当前闭式集合）

`UNKNOWN_ACTION` / `INVALID_ACTION` / `ACTION_FORBIDDEN` /
`INVALID_PAYLOAD` / `UNKNOWN_FIELD` / `CLIENT_FIELD_FORBIDDEN` /
`OPENID_REQUIRED` / `WORKER_UNAUTHORIZED` / `INVALID_WORKER_TOKEN` /
`INVALID_WORKER_ID` / `INVALID_TASK_ID` / `INVALID_CLAIM_ID` /
`INVALID_REVISION` / `INVALID_EXIT_CODE` / `INVALID_OUTPUT` /
`INVALID_VERSION` / `INVALID_APPLICATION_ID` / `CONSENT_REQUIRED` /
`INVALID_FILE_ID` / `FILE_NAMESPACE_MISMATCH` / `FILE_OWNERSHIP_MISMATCH` /
`STORAGE_NAMESPACE_UNCONFIGURED` / `PHOTO_INVALID` /
`TEST_DISABLED` / `ACCOUNT_NOT_ALLOWED` / `ROOM_UNCONFIGURED` /
`ROOM_NOT_UNIQUE` / `LEASE_UNCONFIGURED` / `LEASE_EXPIRED` /
`VERSION_MISMATCH` / `CONCURRENT_APPLICATION` / `INVALIDATED` /
`APPLICATION_NOT_APPROVED` / `APPLICATION_CONFLICT` /
`APPLICATION_FORBIDDEN` / `TASK_FORBIDDEN` / `TASK_ALREADY_CLAIMED` /
`TASK_NOT_FOUND` / `TASK_NOT_CLAIMED` / `EXECUTION_ALREADY_STARTED` /
`CLAIM_MISMATCH` / `WORKER_MISMATCH` / `REVISION_CONFLICT` /
`CLAIM_EXPIRED` / `EXECUTION_INVALIDATED` / `DISPATCH_DISABLED` /
`TRANSACTION_UNAVAILABLE` / `TX_UNSUPPORTED_QUERY` / `INTERNAL_ERROR`。
其中 `ACCOUNT_NOT_ALLOWED` 不对外暴露：普通账号返回
`{code:0, data:{applicationId:'', result:'pending_review', idempotent:false}}`，
不写任何测试集合、不开放人脸入口（C2 边界不变）。

---

## 6. 本文档的验证状态

- 合成验证：A 路批准套件 `tests/checkin-face-cloud-workflow.test.cjs`、
  `admin-web/tests/checkin-face-config.test.mjs` 全量通过（退出码 0），
  覆盖 §1/§2/§3 的正反例；运行命令、退出码、计数与哈希见 A 路回报证据。
- 未验证项：§1.6 与 §3.3 全部条目；真实微信开发者工具上传、真实
  CloudBase 事务行为、真实设备执行均未进行，不以合成 fixture 冒充。
