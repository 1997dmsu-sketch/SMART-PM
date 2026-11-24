# 入住＋人脸登记体验版：本地受控 worker

本目录的 worker 运行在负责人本机，只做**出站**调用：主动向云端测试云函数领取任务（`claimTask`）、受控下载本人照片、以**显式 `mode=device` + `validityMode=fixed`** 调用既有登记命令，再把结果上报（`reportTask`）。

它**不开放任何公网入站端口**、**不反向暴露本地管理后台 loopback**、**不让小程序运行 Node HTTPS adapter**，也不持有任何可远程开门的能力。

---

## 1. 硬边界（务必先读）

- 设备地址（origin）、账号、密码、公开证书路径、私钥、pin **只在可信本机的 Git 忽略文件与进程内存中**；不得贴聊天、提交 Git、写入发布包、写入云端、写入日志或任务输出。
- `worker token` 是独立随机凭据（不是设备秘密），由云端按 SHA-256 常量时间比对，可单独轮换；同样不得贴聊天或入 Git。
- worker 只调用 `claimTask` / `reportTask` 两个云端 action；**没有 requeue、unlock、unlockDevice、批量设备操作**。
- `runFaceEnrollment` 的 `mode`、`validityMode`、`validFrom`/`validTo`、`doorNo`、`employeeNo`、`consent` 全部由 worker **显式构造**；任何缺项立即拒绝，绝不回落到命令默认的 `simulation` / `unlimited` / `doorNo=1` / 自动生成的 employeeNo。
- 任务失败（`exitCode 2/4/5`）或结果未知：**只上报，不自动重试、不换人员编号、不删除设备残留**。云端由 `claimId + revision` CAS 保证 claim/report 幂等。
- `siteVerification` 恒为 `PENDING`：设备查询确认（ready / pending-site）**不是**现场识别通过；CLI 退出 0 也**不是**现场刷脸成功。

---

## 2. 前置条件

1. **Windows 本机**（设备登记命令仅支持 `win32`）；Node ≥ 20（建议 22）。
2. 本机已安装依赖：在项目根目录执行 `npm install`（worker 复用 `admin-web` 的 `@cloudbase/node-sdk`）。
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

   `tools/checkin-face-worker/*.local.json` 与 `tools/checkin-face-worker/.data/` 已被 `.gitignore` 忽略。**确认 `git status` 中看不到 local 文件后再填写真实值。**

2. `checkin-face-worker.local.json` 中只填**非机密**字段：`environment`、`cloudEnv`、`functionName`、`workerId`、`deviceKey`、`name`、`roomNote`。`device` 段的 `origin`（HTTPS 地址）、`username`、`certificatePath`（本机普通证书文件）按实填写；`expectedModel` **必须显式填写**（不接受命令默认型号），`planTemplateNo` 按已核验的全天计划模板填写；**密码优先走环境变量**，不要写进文件。若确需写入文件，必须确认文件被 Git 忽略且仅本机可访问。`name` 用于设备侧人员记录，当云端任务未携带姓名时必须在本机配置填写；worker 不会自行生成。

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

照片处理：云端照片下载到 `tools/checkin-face-worker/.data/` 下随机命名的受限临时 JPEG（文件权限 0o600），登记命令返回后用零覆盖并删除。该目录被 Git 忽略，不上传、不归档。

日志：只输出脱敏结构化行（任务号/领取号打码、门号、日期、退出码、结果类别）。密码、账号、证书内容/路径、照片内容、origin 主机、worker token 一律不打印。

---

## 5. 退出码语义

| 退出码 | 含义 | 处置 |
|---|---|---|
| 0 | 空闲无任务，或登记结果已成功上报且 `exitCode=0` | 无需处理 |
| 1 | 本地配置或云客户端初始化失败，未领取任务 | 检查 local 配置与环境变量 |
| 2 | 登记命令预检失败（`invalid-input`），已上报 | 人工核对任务字段与设备材料；**不重试** |
| 3 | 上报失败或任务身份字段无效 | 人工核查云端任务与网络；**不重发、不重试** |
| 4 | 设备业务阶段失败（`failed`），已上报 | 可能已部分写入；人工核查设备现状，**不重跑、不换号、不删残留** |
| 5 | 连接/未知状态/清理错误（`stopped`），已上报 | 保留 employeeNo 与设备事实，人工核查；未知结果也归入 5 |

`--loop` 模式忽略单任务退出码，继续轮询**新的**排队任务；已上报任务不会再次领取。`--once` 返回上一表的任务退出码，便于人工脚本判断。

---

## 6. 真机现场刷脸（单独记录）

worker 与登记命令只能证明「平台收件 → 设备查询确认（ready / pending-site）」，**不能证明本人现场识别通过或门锁释放**。现场刷脸必须由本人在门禁设备完成，由负责人单独记录：时间、身份、设备、结果；不把 CLI 退出 0 或 pending-site 写成「识别通过」。

---

## 7. 禁止事项

- 不开放公网入站端口、不把本地管理后台 loopback 反代到云端、不在小程序运行 Node HTTPS adapter。
- 不提交任何 `*.local.json`、证书文件、照片、token、云密钥、设备账号密码。
- 不开远程开门（`allowDeviceOperations` 保持 false）、不调用 unlock / unlockDevice、不批量设备操作。
- 不自动重试失败任务、不更换 employeeNo、不删除设备残留对象、不调用 requeue。
- 不伪造现场识别结果、不把 simulation 或 pending-site 记为设备成功或现场通过。
- 不把 `unlimited` 带入本链路；租期固定用服务端下发的 `validFrom`/`validTo`，不自行扩期或截断。
- 不删除既有人员、人脸、权限；回退按体验版与配置开关执行，见实施方案 §10。

---

## 8. 与其他模块的关系

- 云端测试服务：`cloudfunctions/checkinFaceTest`（`claimTask` / `reportTask` 的 token 鉴权、revision CAS、输出白名单校验在云端完成）。
- 本地配置页：`/checkin-face-test.html`（仅管理后台 admin 可访问，写操作留审计；不展示任何设备秘密）。
- 登记命令：`admin-web/lib/face-enrollment-command.mjs` 的 `runFaceEnrollment(input, deps)`（本 worker 只显式构造入参，不修改命令默认值）。
