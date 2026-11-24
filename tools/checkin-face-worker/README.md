# 入住＋人脸登记体验版：本地受控 worker（R05–R09 退修版）

本目录的 worker 运行在负责人本机，只做**出站**调用：主动向云端测试云函数领取任务（`claimTask`）、受控下载本人照片（**进程内存 Buffer，不落盘**）、执行前调用权威复核（`beginTaskExecution`）、以**显式 `mode=device` + `validityMode=fixed`** 调用登记适配层（内存照片直接驱动既有业务服务），再把结果上报（`reportTask`，使用推进后 revision）。

它**不开放任何公网入站端口**、**不反向暴露本地管理后台 loopback**、**不让小程序运行 Node HTTPS adapter**，也不持有任何可远程开门的能力。

---

## 1. 硬边界（务必先读）

- 设备地址（origin）、账号、密码、公开证书路径、私钥、pin **只在可信本机的 Git 忽略文件与进程内存中**；不得贴聊天、提交 Git、写入发布包、写入云端、写入日志或任务输出。
- `worker token` 是独立随机凭据（不是设备秘密），由云端按 SHA-256 常量时间比对，可单独轮换；同样不得贴聊天或入 Git。
- worker 只调用 `claimTask` / `beginTaskExecution` / `reportTask` 三个云端 action；**没有 requeue、unlock、unlockDevice、批量设备操作**。
- 任务与本地 `deviceKey` **都必须明确、非空且精确一致**（R05）：缺任一或不同立即拒绝，不进入执行器。设备型号、可信证书、门号、租期、全天计划校验**独立保留**；`developmentTls` 只是 TLS 校验模式，不绕过任何材料核验。
- 进入设备执行前必须通过执行前复核（R06，见 §4.5）：过期/撤权/改租期/改绑定/快照不一致/云不可用/回执未知一律**零设备执行**，不自动重领、不续期、不重试开始。
- `runFaceEnrollment` 旧命令入口只有 `photoPath`；worker 不伪造路径、不替换读文件函数、不重命名参数。worker 走本目录 `enrollment-adapter.mjs` 适配层，把**内存照片**以 `photoBase64` 交给既有 `FaceEnrollmentService.enroll`（业务服务本就接受内存照片）；不改旧三个核心模块与 PowerShell 启动器（该适配层为新增业务服务，需交 Codex 内容复审）。
- 清理结果进入真实终态（R09）：内存释放未确认时整体记为 `stopped`（exit 5）并保留已发生的设备事实，绝不误报清理成功，也不因清理失败重发设备操作。
- 任务失败（`exitCode 2/4/5`）或结果未知：**只上报，不自动重试、不换人员编号、不删除设备残留**。云端由 `claimId + revision` CAS 保证 claim/report 幂等。
- `siteVerification` 恒为 `PENDING`：设备查询确认（ready / pending-site）**不是**现场识别通过；CLI 退出 0 也**不是**现场刷脸成功。

---

## 2. 前置条件

1. **Windows 本机**（设备登记命令仅支持 `win32`）；Node ≥ 20（建议 22）。
2. **worker 自己的依赖**（R07）：在 `tools/checkin-face-worker` 目录执行 `npm install`。本目录自带 `package.json`（锁定 `@cloudbase/node-sdk` 3.18.7 与 axios/@cloudbase/database overrides）；`package-lock.json` 应在可联网环境由 `npm install --package-lock-only --ignore-scripts` 生成后一并提交（当前交付记录见未完成项）。默认 SDK 解析边界**只**是本目录 `node_modules`；不要依赖项目根或 `admin-web` 的偶然 `node_modules`，不要设置 `NODE_PATH`。如确需其他本机边界，在 local 配置写 `sdkModulePath`（绝对路径，含 `node_modules` 的目录）。
3. 已由本地管理后台管理员完成：
   - 测试开关**默认关闭**，联调时再开启；
   - 102 **唯一**绑定（projectId / buildingId / roomId / houseId / doorNo / deviceKey）；
   - 负责人**手填**租期起止（不提供「一年 / 长期 / 自动今天」）；
   - 测试账号 openid 名单。
4. 已取得可信材料：独立 worker token、出站云密钥、设备 HTTPS origin / 账号 / 密码 / 已核验公开证书文件 / 预期型号 / 全天计划模板号。

---

## 3. 填写本地配置（只在 Git 忽略文件中）

1. 复制示例（**不要直接改示例文件**）：

   ```bash
   cp tools/checkin-face-worker/worker-config.example.json tools/checkin-face-worker/checkin-face-worker.local.json
   ```

   `tools/checkin-face-worker/*.local.json` 已被 `.gitignore` 忽略。**确认 `git status` 中看不到 local 文件后再填写真实值。**

2. `checkin-face-worker.local.json` 中只填**非机密**字段：`environment`、`cloudEnv`、`functionName`、`workerId`、`deviceKey`（**必填**）、`name`、`roomNote`、可选 `sdkModulePath`。`device` 段的 `origin`（HTTPS 地址）、`username`、`certificatePath`（本机普通证书文件）按实填写；`expectedModel` **必须显式填写**（不接受命令默认型号），`planTemplateNo` 按已核验的全天计划模板填写；**密码优先走环境变量**，不要写进文件。若确需写入文件，必须确认文件被 Git 忽略且仅本机可访问。`name` 用于设备侧人员记录，当云端任务未携带姓名时必须在本机配置填写；worker 不会自行生成。

3. 用环境变量提供机密（示例，Git Bash）：

   ```bash
   export CHECKIN_FACE_WORKER_TOKEN='<负责人单独签发的随机 token>'
   export TENCENTCLOUD_SECRETID='<仅用于出站云函数调用>'
   export TENCENTCLOUD_SECRETKEY='<仅用于出站云函数调用>'
   export CHECKIN_FACE_DEVICE_USERNAME='<设备账号>'
   export CHECKIN_FACE_DEVICE_PASSWORD='<设备密码，仅内存>'
   ```

   证书文件放本机普通路径（受控、已另行核验），不复制到仓库内。示例中的 `device.password` 保持空字符串；`workerTokenEnv` 等只写**环境变量名**，不写值。

4. 在管理后台「入住＋人脸登记测试配置」页完成两项本地设置：

   - **worker token**：用页面上的密码框提交负责人本地签发的随机明文 token。服务端只保存 SHA-256、写审计并递增 revision；页面只显示「已设置/未设置」，提交后明文立即从输入框清除，不回显、不缓存、不写日志。worker 启动时从 `workerTokenEnv`（默认 `CHECKIN_FACE_WORKER_TOKEN`）指定的**环境变量**读取同一个 token——它不来自 `worker-config.example.json`，也不来自 local 文件。轮换时先在后台重新设置，再更新本机环境变量并重启 worker；与本机 `workerId`/`deviceKey` 的非机密映射保持一致。
   - **全天计划指纹**：配置 102 唯一绑定时，`accessPlanFingerprint` 为**必填**。须由负责人实际核验设备全天计划（周计划、假日、时段与次数限制）后手填 64 位十六进制指纹；未填或不一致时，登记上报不会进入「设备查询已确认」，这是预期的失败关闭行为，不要绕过。

> 禁止：把上述任何真实值写进 `worker-config.example.json`、聊天、工单、截图、日志、发布包或云函数代码。

---

## 4. 启动与停止

在项目根目录执行：

```bash
# 处理一个任务后退出（默认，便于人工核对）
npm run worker:checkin-face -- --once

# 持续轮询云端新任务（只取新任务，不重试已上报任务）
npm run worker:checkin-face -- --loop --interval-ms 15000

# 指定其他本地配置文件
npm run worker:checkin-face -- --once --config /absolute/path/to/other.local.json

# 查看全部参数
npm run worker:checkin-face -- --help
```

停止：前台按 `Ctrl+C`（`--loop` 会在当前轮询结束后优雅退出）。

---

## 4.5 执行前复核（R06，与 A 路 INTERFACES.md §2 已对齐）

顺序（任何一步失败均零设备执行、上报 `stopped`/exit 5、不自动重领/续期/重试开始）：

1. **领取后立即**：身份字段校验 + R05 设备绑定 + claim 时效预检（本地失败关闭；本地时间无效/偏差过大拒绝）；
2. **受控下载照片**（内存 Buffer，校验 `cloud://` fileID、≤200 KiB、JPEG；worker 下载使用服务端下发的同一真实 fileID，非 `cloud://` 一律 `FILE_ID_INVALID` 失败关闭，清单 §1.5）；
3. **下载/准备完成后**：claim 时效再检（覆盖“下载中到期”）；
4. **调用云端 `beginTaskExecution`**：请求仅 `{action, workerToken, workerId, taskId, claimId, revision}`（清单 §2.1）；不携带客户端自报“已批准”或任何新目标，白名单外字段由云端以 `CLIENT_FIELD_FORBIDDEN`/`UNKNOWN_FIELD` 拒绝；
5. **严格核验返回** `{code:0, data:{task, authorizedAt}}`（清单 §2.3/§2.5，全部满足才执行）：
   - `authorizedAt` 为服务端正整数毫秒且不晚于 `claimExpiresAt`；`task.authorizedAt === data.authorizedAt`（同一时间事实）；
   - 快照 `status === DEVICE_PROCESSING`、`revision === 请求值+1`、`claimExpiresAt` 与领取时一致（不延长）；
   - 与已领取/实际下载对象**全部业务字段一致**：`taskId/claimId/applicationId/fileId/cloudPath/employeeNo/deviceKey/doorNo/validFrom/validTo/timezone/dailyHours/accessPlanFingerprint/name`；
   - 快照 `workerId === 本次请求 workerId`；携带 `configRevision/roomRevision/leaseRevision`（非负整数）与 `roomBindingId/leaseSnapshotId`（非空字符串）；
6. **执行前最后检查**：对授权快照再查一次时效，然后才进入设备执行（最后检查与在途设备操作之间仍存在窗口；已发生/未知设备事实保留上报，不承诺跨云与硬件的全局原子撤销）；
7. **report 使用推进后 revision**；report 失败只记录（exit 3），不重发、不重试。

**错误映射（C 本地码 ↔ 清单 §2.4 服务端码；服务端码一律原样透传，绝不编造）**：

| C 本地码 | 对应服务端码（§2.4，原样透传） | 处理 |
|---|---|---|
| `BEGIN_AUTH_REJECTED:<服务端码>` | `WORKER_UNAUTHORIZED` / `INVALID_WORKER_TOKEN` / `INVALID_WORKER_ID` / `INVALID_TASK_ID` / `INVALID_CLAIM_ID` / `INVALID_REVISION` / `CLIENT_FIELD_FORBIDDEN` / `UNKNOWN_FIELD` / `TASK_NOT_FOUND` / `CLAIM_MISMATCH` / `REVISION_CONFLICT`（重复开始/旧 revision） / `WORKER_MISMATCH` / `TASK_NOT_CLAIMED` / `EXECUTION_ALREADY_STARTED` / `CLAIM_EXPIRED` / `EXECUTION_INVALIDATED`（撤名单/关开关/撤权/换房/改租期/版本变化） / `TRANSACTION_UNAVAILABLE` / `TX_UNSUPPORTED_QUERY` / `INTERNAL_ERROR` | 零执行；不重试开始。服务端可能已原子推进（`CLAIM_EXPIRED`→`UNKNOWN_RESULT/CLAIM_TIMEOUT`、`EXECUTION_INVALIDATED`→`INVALIDATED`），worker 随后上报可能因 revision 冲突失败（exit 3），服务端审计为权威记录 |
| `BEGIN_AUTH_UNAVAILABLE` | 网络失败/无有效答复/回执未知/缺 `task`/`authorizedAt` 字段/非对象回显（服务端已回码时走上一行） | 零执行；report exit 5 待人工核查 |
| `BEGIN_SNAPSHOT_MISMATCH` | 无（本地完整性校验） | 零执行；report exit 5 |
| `BEGIN_AUTH_EXPIRED` | 仅本地预检（本地 now ≥ claimExpiresAt，未发起云端调用）；服务端先行判定时表现为 `BEGIN_AUTH_REJECTED:CLAIM_EXPIRED` | 零执行；report exit 5 |

非 §5 闭式形态的异常码以本地兜底标签 `CLOUD_REJECTED` 表示，不冒充服务端码。`CLOCK_INVALID`/`CLAIM_TIME_INVALID`（本地时间/字段无效）与清单“本地时间/字段无效同样失败关闭”一致，exit 5。

**未验证项（如实记录，不冒充贯通）**：云端 `beginTaskExecution` 事务实现由 A 路完成，C 侧以合成假云按上述清单验证；真实 CloudBase 事务/真实设备执行未进行。

---

## 5. 照片与清理（R08/R09）

- 云端照片下载后**只在进程内存**以 Buffer 传递，不写 `tools/checkin-face-worker/.data`、不写任何临时 JPEG；测试以“不产生该文件 + 无写盘 API”证明无残留。
- 适配层把内存照片交给业务服务后，本地解码副本与证书副本在返回前 `fill(0)`；服务内部照片副本按服务自身 TTL 释放。**不承诺**字符串副本或进程内存的安全擦除效果（进程退出即释放）。
- 清理失败/未确认：保留已发生的设备事实（输出中的 device/enrollment 原样保留），整体记为 `stopped`（exit 5，`CLEANUP_FAILED`），**不重发设备操作、不盲删旧对象、不误报清理成功**。
- 日志：只输出脱敏结构化行（任务号/领取号打码、门号、日期、退出码、结果类别）。密码、账号、证书内容/路径、照片内容、origin 主机、worker token 一律不打印。

---

## 6. 退出码语义

| 退出码 | 含义 | 处置 |
|---|---|---|
| 0 | 空闲无任务，或登记结果已成功上报且 `exitCode=0` | 无需处理 |
| 1 | 本地配置或云客户端初始化失败（含 deviceKey 缺失、SDK 未解析），未领取任务 | 检查 local 配置、`tools/checkin-face-worker` 的 `npm install` 与环境变量 |
| 2 | 登记命令预检失败（`invalid-input`，含 deviceKey 缺失/不一致、任务字段无效），已上报 | 人工核对任务字段与设备材料；**不重试** |
| 3 | 上报失败或任务身份字段无效 | 人工核查云端任务与网络；**不重发、不重试** |
| 4 | 设备业务阶段失败（`failed`），已上报 | 可能已部分写入；人工核查设备现状，**不重跑、不换号、不删残留** |
| 5 | 执行前复核未通过/过期/撤权/云不可用/连接/未知状态/清理错误（`stopped`），已上报 | 保留 employeeNo 与设备事实，人工核查；未知结果也归入 5 |

`--loop` 模式忽略单任务退出码，继续轮询**新的**排队任务；已上报任务不会再次领取。`--once` 返回上一表的任务退出码，便于人工脚本判断。

---

## 7. 真机现场刷脸（单独记录）

worker 与登记命令只能证明「平台收件 → 设备查询确认（ready / pending-site）」，**不能证明本人现场识别通过或门锁释放**。现场刷脸必须由本人在门禁设备完成，由负责人单独记录：时间、身份、设备、结果；不把 CLI 退出 0 或 pending-site 写成「识别通过」。

---

## 8. 禁止事项

- 不开放公网入站端口、不把本地管理后台 loopback 反代到云端、不在小程序运行 Node HTTPS adapter。
- 不提交任何 `*.local.json`、证书文件、照片、token、云密钥、设备账号密码。
- 不开远程开门（`allowDeviceOperations` 保持 false）、不调用 unlock / unlockDevice、不批量设备操作。
- 不自动重试失败任务、不更换 employeeNo、不删除设备残留对象、不调用 requeue。
- 不伪造现场识别结果、不把 simulation 或 pending-site 记为设备成功或现场通过。
- 不把 `unlimited` 带入本链路；租期固定用服务端下发的 `validFrom`/`validTo`，不自行扩期或截断。
- 不删除既有人员、人脸、权限；回退按体验版与配置开关执行，见实施方案 §10。

---

## 9. 与其他模块的关系

- 云端测试服务：`cloudfunctions/checkinFaceTest`（`claimTask` / `beginTaskExecution` / `reportTask` 的 token 鉴权、revision CAS、输出白名单校验在云端完成；`beginTaskExecution` 事务由 A 路接通）。
- 本地配置页：`/checkin-face-test.html`（仅管理后台 admin 可访问，写操作留审计；不展示任何设备秘密）。
- 登记业务服务：`admin-web/lib/face-enrollment.mjs` 的 `FaceEnrollmentService`（本 worker 只经 `enrollment-adapter.mjs` 显式构造入参，不改旧命令默认值、不改 `face-enrollment-command.mjs` / PowerShell 启动器）。
- 本目录文件：`claim-and-enroll.mjs`（主流程）、`worker-runtime.mjs`（配置/云客户端/入参构造/输出白名单）、`execution-authorization.mjs`（R06 执行前复核）、`enrollment-adapter.mjs`（R08 内存照片适配层）、`package.json`（R07 依赖归属）。
