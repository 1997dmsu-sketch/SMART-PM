# HK-AI-08 历史配置找回与证据缺口（2026-11-19）

> 状态：**只读调查记录，待 Codex 复审。** 本轮不连接设备、不扫描网段、不调用设备 API、不上传照片、不创建人员；设备地址一律脱敏，凭据只记录**存放机制/路径与存在性**，不记录任何值；敏感配置不进 Git。
>
> 本文回答一个问题：**真实门禁接口测试所需要的型号、地址、端口、固件、协议与凭据存放位置，历史上到底留下了什么、缺什么、哪些已过期、哪些在本轮不可验证。** 结论一律按“已找到 / 未找到 / 已过期 / 不可验证”记录；没有证据的写未知，不猜。

## 0. 调查范围与方法

| 项 | 说明 |
|---|---|
| 只读对象 | 本仓库 Git 对象与各远端分支、本地工作树、项目目录内的文件**名称与存在性**、进程环境变量**名称** |
| 未做的事 | 未连接设备、未发请求、未扫描网段/端口、未读取任何密钥值、未打开任何凭据文件内容、未做全历史敏感值穷举 |
| 凭据处理 | 只检查 `.env`/`.env.*`/`secrets.local.md` 是否存在；只列环境变量名；不读值、不复制、不截图 |
| 地址处理 | 文档中只出现 `192.168.x.x`、`<DEVICE-IP>`、`<DEVICE-REF>` 等占位；不记录真实地址 |
| 搜索边界 | 限于 `C:\Users\Administrator\Documents\ChatGPT\宇宙智联` 项目目录及其工作树；未检索操作系统级凭据库/浏览器密码库（超出本任务范围，且可能触及秘密） |
| 基线 | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7`（`origin/main` 同点） |

**方法说明：** 本分支从 `main@282a20f` 切出，而历次海康文档与只读探针都在**其他分支**，不在本分支工作树内。因此本文对所有上游文档采用“**提交 SHA + 路径 + GitHub 固定链接**”引用，不建本地相对链接，也不把文件复制进本分支。

## 1. 找回结果总表

| # | 配置项 | 结论 | 值/占位 | 主要证据 | 备注 |
|---|---|---|---|---|---|
| 1 | 完整型号 | **已找到** | `DS-K1T671BM` | 2026-11-06 日报第 13 行；06B 第 0 节 | 项目登记 + 现场照片确认；精确后缀/区域未记录 |
| 2 | 硬件版本 | **未找到** | `unknown` | 06B §2.1 要求三源对照；无值 | 需铭牌/系统信息/`deviceInfo` |
| 3 | 固件版本/build | **未找到** | `unknown` | 日报第 41 行；06B 第 0 节 | “固件与 capability 尚未验证” |
| 4 | 设备地址 | **未找到（且按政策不入 Git）** | `192.168.x.x` / `<DEVICE-IP>` | 06B §3.2；02 批准包 §2 | 真实值只允许在仓库外密封附件/工单 |
| 5 | 端口 | **未找到实际值** | 工具默认 `443`，允许 `443,8443` | 探针 README；日报第 41 行 | “HTTPS端口”仍列缺失 |
| 6 | 协议/认证 | **已找到（L1 文档级）；型号级不可验证** | ISAPI over HTTPS + Digest | LOCK-01A 证据包 §4；探针 README | 未验证 Digest/账号/SDK 实际方式 |
| 7 | 凭据存放位置 | **机制已找到；实际凭据未找到** | 运行时环境变量注入；真实值在仓库外工单 | 探针 README；02 批准包 §2/§3；06B §3.2 | 项目树无凭据文件；仅记录名称与存在性 |
| 8 | 叶证书指纹 | **未找到** | `<FINGERPRINT-REF>` | 02 批准包 §1 第 7 项；06B §3.4 | 需现场两人独立核验 |
| 9 | 序列号/MAC | **未找到（且禁止入库）** | `<MASKED-SERIAL>` / `<MASKED-MAC>` | 日报第 13 行；06B §2.4 | 照片中的序列号/二维码不进入仓库 |
| 10 | 既有只读工具 | **已找到** | `tools/hikvision-probe` @ `558b9c8` | README、完成说明 | 不在 `main`、不在本分支；未合并 |
| 11 | 已签署的 E1/E2 审批 | **未找到** | — | 06B 第 0 节；02 批准包签字栏为空 | 本轮不申请、不执行 |
| 12 | 真实 capability / 真实调用 | **未找到（0 条）** | `0/27`、`0/27` | 06B 第 0 节；06A | 型号级证据为 0 |
| 13 | 合成人员/照片 | **未找到（0 条）** | — | 06B §6.4；本轮 | 本轮 0 张、0 人 |
| 14 | 只读执行记录 | **未找到** | — | 06B 第 0 节“执行数 0”；探针卡“真实设备是否执行：否” | Git 内无“已执行”证据 |

## 2. 逐项说明与证据来源

### 2.1 完整型号：已找到

- 2026-11-06 日报：“现场照片确认设备完整型号为 `DS-K1T671BM`；照片中的序列号、二维码等信息不进入仓库。固件与 capability 尚未验证。”——`docs/tasks/DAILY-REPORT-2026-11-06.md` 第 13 行 @ `150faccd8f9d01f44cad3b849e9f8d21973acee3`。
- `HK-AI-06B` 元数据：“目标型号（项目登记）`DS-K1T671BM`”——第 0 节 @ `ba9566684d3fb391225e1081b356e3e6569823eb`。

**限定：** 这是“项目登记 + 现场照片”级证据，不是公开型号页/手册级证据；06A 明确“型号级公开证据不足”。精确后缀、硬件版本、区域标识仍为 `unknown`，不得用近似型号的公开固件/手册替代。

### 2.2 硬件版本：未找到

- `HK-AI-06B` §2.1 要求“铭牌 / Web 系统信息 / 只读 `deviceInfo`”三源对照；本轮三类来源均无值。

### 2.3 固件版本/build：未找到

- 日报第 41 行：“真实设备仍缺固件、设备时间/NTP、HTTPS 端口、最小权限账号和双人核验证书指纹。”
- `HK-AI-06B` 第 0 节：“真实 capability 0 条”“固件与 capability 尚未验证”。

### 2.4 设备地址：未找到（按政策不入 Git）

- `HK-AI-06B` §3.2：测试电脑地址 `<TEST-PC-IP>`、设备地址 `<DEVICE-IP>`，“由网络负责人书面分配；不写进仓库”“真实值只放密封附件/工单”。
- `HK-AI-02-LIVE-APPROVAL-PACK.md` §2：“设备序列号、MAC、设备 IP 明文、账号/密码、完整证书指纹”不得进入仓库；§3 通过受控输入注入，不落命令历史。
- 探针 README 的报告示例只出现 `192.168.x.x`。

**结论：** 仓库内不存在可用于直接执行的真实地址；这不是“遗漏”，而是既定脱敏政策。真实地址只能向网络负责人/现场批准包索取，且不得回填 Git。

### 2.5 端口：未找到实际值

- 探针 README：`HIKVISION_PROBE_PORT` 默认 `443`；`HIKVISION_PROBE_ALLOWED_PORTS` 默认 `443,8443`。这是**工具默认**，不是设备事实。
- 日报第 41 行明确“HTTPS 端口”仍缺。
- 02 批准包要求端口必须显式非空、纯数字，禁止依赖默认回退。

### 2.6 协议/认证：已找到（文档级），型号级不可验证

- LOCK-01A 证据包 §4：“未验证（工程级）ISAPI 认证方式（Digest/账号/SDK 登录）、是否必须经 HikCentral、错误码与限频、离线行为。”
- 探针 README：“仅实现 Digest；若设备只接受 Basic 或需要先登录 SDK，本工具会明确失败而不是降级。”
- 结论：**ISAPI + HTTPS + Digest 是文档/工具假设，不是目标设备已证事实。** 实际认证方式只能由 E1 的 `deviceInfo`/401 challenge 观察得出；E1 未执行前为 `unknown`。

### 2.7 凭据存放位置：机制已找到，实际值未找到

**机制（已找到）：**

1. 执行时通过环境变量注入，变量名见 `tools/hikvision-probe/README.md`“环境变量（只列名称）”：`HIKVISION_PROBE_HOST`、`HIKVISION_PROBE_PORT`、`HIKVISION_PROBE_USERNAME`、`HIKVISION_PROBE_PASSWORD`、`HIKVISION_PROBE_EXPECTED_MODEL`、`HIKVISION_PROBE_FINGERPRINT256` 等；密码只用于 Digest 计算，不落盘、不进日志。
2. 真实值只允许在**仓库外**的密封附件/现场批准包/离线工单；02 批准包 §2 与 06B §3.2 均如此规定。
3. 原始响应写入 `0700` 临时目录、`0600` 文件，分析后删除；禁止提交 Git。

**存在性检查（只读、只查文件名）：**

| 检查 | 结果 |
|---|---|
| 项目目录内 `.env` / `.env.*` 文件 | **未发现** |
| 项目目录内 `secrets.local.md` | **未发现** |
| 当前进程环境变量名含 `HIKVISION`/`ISAPI`/`PROBE` | **未发现** |
| `admin-web/config.example` @ `282a20f` 是否含设备地址/凭据键 | **不含**；只有 ADMIN/Tencent Cloud/NAS 等配置键 |
| `.gitignore` 是否排除敏感文件 | 已排除 `.env`、`.env.*`、`secrets.local.md`、`project.private.config.json` |
| Git 历史中是否有被删除的 `.env` | `git log --all --diff-filter=D -- '*.env' '.env*' '*secrets*'` **无输出** |

**结论：** 仓库内**没有**可读取的凭据文件；凭据的实际保管位置（哪份密封工单、哪个人、哪个受控秘密存储）**未在 Git 中记录**，本轮无法定位到具体保管人/工单编号。这是证据缺口，不是“已恢复”。

### 2.8 叶证书指纹：未找到

- 02 批准包 §1 第 7 项要求“叶证书 SHA-256 已由两人独立线下核验”，指纹写入离线工单。
- 06B §3.4 要求指纹固定模式；探针 README 明确“不提供关闭校验的开关”，证书过期只告警不阻断（复审决定）。
- 本轮无指纹值，也不应尝试连接获取（首次连接自动信任被明确禁止）。

### 2.9 序列号/MAC：未找到（禁止入库）

- 日报第 13 行：照片中的序列号、二维码等信息不进入仓库。
- 06B §2.4：序列号只允许 `<MASKED-SERIAL>` 或末 2 位；设备主键用内部 `deviceRef`。

### 2.10 既有只读工具：已找到，但不在本分支

| 项 | 值 |
|---|---|
| 路径 | `tools/hikvision-probe` |
| 分支/提交 | `origin/feat/hk-isapi-capability-probe` @ `558b9c864a4b820e397336200758b143556a4d87`；代码返工点 `59b6437169f7fbeb3ae0af45bc0968e784dcb20d` |
| 是否在 `main@282a20f` | **否**（`git ls-tree HEAD tools` 为空；`merge-base --is-ancestor` 失败） |
| 默认行为 | dry-run；`HIKVISION_PROBE_ALLOW_READ=true` 才发请求 |
| 白名单 | 6 个 GET，逐字匹配 |
| 测试 | 58 项离线测试（Linux 57+1 跳过；Windows 55+3 跳过） |
| 关键整改 | 型号前置校验、fail-fast、受控凭据输入、输出目录 `0700`/文件 `0600`、指纹固定 |
| 已知限制 | 仅 Digest；真实能力标签名可能与 fixture 不同；未做并发 |

**缺口：** E1 若直接按 `main` 工作树执行，工具不存在；必须先固定工具提交并提供获取方式，且不得用未复核版本替代。

### 2.11 已签署的 E1/E2 审批：未找到

- `HK-AI-06B` 第 0 节：`allowDeviceOperations=false`，G1–G3 均 `not_requested`，G4 不在该卡范围；真实设备连接 0、API 调用 0。
- `HK-AI-02-LIVE-APPROVAL-PACK.md` 签字栏为空；其红线写明“批准栏未全部签署前不得设置 `HIKVISION_PROBE_ALLOW_READ=true`”。

### 2.12 真实 capability / 真实调用：未找到（0 条）

- `HK-AI-06B` 第 0 节：L2 目标 capability `0/27`、L3 真实调用 `0/27`；Q01–Q35 全部 `open`。
- 06A 的 27 个端点在 06B 中一律 `candidateOnly=true`、`allowedNow=false`。

### 2.13 合成人员/照片：未找到（0 条）

- 06B §6.4 规定只用合成图/厂商测试图，默认不使用真人；本轮照片 0、人员 0。

### 2.14 只读执行记录：未找到

- `HK-AI-02-CAPABILITY-PROBE.md`：“真实设备是否执行：否（等待11月6日真人任务）”。
- `HK-AI-06B`（2026-11-14）仍写“真实设备连接 0 次、设备 API 调用 0 次”。
- 本轮检索未发现任何“已执行一次”“report.json 回填完成”的提交/文档。**不能据此断定历史上从未执行**；只能写“Git 内未找到证据”。

## 3. 已过期 / 冲突项

| 项 | 现状 | 为什么过期/冲突 | 处理 |
|---|---|---|---|
| `HK-AI-02-LIVE-APPROVAL-PACK.md` @ `cc5c7fb` | 引用代码 `f15160d`（`f15160da624e3d12beb35e37aeb28c15e8997709`）为“代码侧复审通过” | 其后 `59b6437` 因三项 P0/P1 退回返工并修复（畸形 Digest/`RESPONSE_ERROR` fail-fast、凭据受控输入），实际工具已前进到 `558b9c8` | **不得直接复用**；E1 审批须重新固定 `558b9c8` 并复核差异 |
| `HK-AI-06-HIKVISION-PROVIDER-PREFLIGHT-TASK-2026-11-11.md` | 同样引用 `f15160d` 为基线 | 同上 | 作为历史背景引用，不作为当前工具版本依据 |
| 06A/06B 的 Q01–Q35 | 全部 `open` | 没有现场只读证据关闭 | 保持 `open`；本卡不关闭任何一项 |
| 06B 预检卡（2026-11-14） | 最新设备预检，仍为 0 执行 | 日期距本轮 5 天；无新执行证据 | 不是“过期作废”，但其结论只能作为准备基线 |
| 型号级公开证据 | 06A 明确“不足” | 裸 `DS-K1T671BM` 无精确公开页/手册 | 不得用近似型号升级 |

**说明：** 以上“过期”指**不能作为当前执行依据**，不等于文档内容全部失效；历史结论仍可作为证据来源引用。

## 4. 不可验证清单（本轮）

| 项 | 为什么不可验证 | 需要什么才能验证 |
|---|---|---|
| 真实设备地址/端口 | 仓库内只有占位符，真实值按政策在仓库外 | 网络负责人书面分配 + 密封附件 |
| 固件/硬件版本 | 无设备读数、无铭牌记录 | 铭牌/系统信息/`deviceInfo`（E1） |
| 实际认证方式（Digest/Basic/SDK） | 未连接、未发挑战 | E1 的 401 challenge 观察 |
| 证书指纹 | 需两人线下核验 | 现场核验记录 |
| 上传/查询/删除能力 | 型号级能力 0 条 | E1 能力节点 + E2 单独授权实测 |
| 凭据实际保管位置 | 仓库不记录；本轮不读秘密 | 现场批准包/工单持有人 |
| 历史是否真的执行过探针 | Git 内无“已执行”证据 | 现场记录/原始报告（如存在） |
| 真机是否支持 `faceURL`/`modelData` | 仅文档级 | E1/E2 目标设备证据 |

## 5. 证据来源登记（固定 SHA）

| 来源 | 引用 | 完整 SHA | GitHub 固定链接 |
|---|---|---|---|
| 基线 `main` | `admin-web/config.example`、`.gitignore` | `282a20fca9f64ab80ead50372c9c3e90bf4aeba7` | <https://github.com/1997dmsu-sketch/SMART-PM/blob/282a20fca9f64ab80ead50372c9c3e90bf4aeba7/admin-web/config.example> |
| 设备预检 06B | `docs/tasks/HK-AI-06B-DEVICE-LAB-PREFLIGHT-2026-11-14.md` | `ba9566684d3fb391225e1081b356e3e6569823eb` | <https://github.com/1997dmsu-sketch/SMART-PM/blob/ba9566684d3fb391225e1081b356e3e6569823eb/docs/tasks/HK-AI-06B-DEVICE-LAB-PREFLIGHT-2026-11-14.md> |
| 证据索引 06A | `docs/tasks/HK-AI-06A-HIKVISION-PROVIDER-EVIDENCE-2026-11-14.md` | `08491fe8656fc6cc9bc2867c2e23a1ab677ac066` | <https://github.com/1997dmsu-sketch/SMART-PM/blob/08491fe8656fc6cc9bc2867c2e23a1ab677ac066/docs/tasks/HK-AI-06A-HIKVISION-PROVIDER-EVIDENCE-2026-11-14.md> |
| 设备证据 LOCK-01A | `docs/devices/HIKVISION-EVIDENCE-2026-11-05.md` | `37d8a851b4049c6057d5278947f8953a3b8e2b33` | <https://github.com/1997dmsu-sketch/SMART-PM/blob/37d8a851b4049c6057d5278947f8953a3b8e2b33/docs/devices/HIKVISION-EVIDENCE-2026-11-05.md> |
| 2026-11-06 日报 | `docs/tasks/DAILY-REPORT-2026-11-06.md` | `150faccd8f9d01f44cad3b849e9f8d21973acee3` | <https://github.com/1997dmsu-sketch/SMART-PM/blob/150faccd8f9d01f44cad3b849e9f8d21973acee3/docs/tasks/DAILY-REPORT-2026-11-06.md> |
| 只读执行批准包 | `docs/tasks/HK-AI-02-LIVE-APPROVAL-PACK.md` | `cc5c7fb7cee21dd1965b763077626ba0dc54ada8` | <https://github.com/1997dmsu-sketch/SMART-PM/blob/cc5c7fb7cee21dd1965b763077626ba0dc54ada8/docs/tasks/HK-AI-02-LIVE-APPROVAL-PACK.md> |
| 只读探针（工具） | `tools/hikvision-probe/README.md` | `558b9c864a4b820e397336200758b143556a4d87` | <https://github.com/1997dmsu-sketch/SMART-PM/blob/558b9c864a4b820e397336200758b143556a4d87/tools/hikvision-probe/README.md> |
| 探针返工点 | `docs/tasks/HK-AI-02-COMPLETION.md` | `59b6437169f7fbeb3ae0af45bc0968e784dcb20d`（其后 `558b9c8` 仅补文档） | <https://github.com/1997dmsu-sketch/SMART-PM/blob/59b6437169f7fbeb3ae0af45bc0968e784dcb20d/docs/tasks/HK-AI-02-COMPLETION.md> |

> 以上文档除基线两项外，均**不在**本分支工作树；只能按上述固定提交引用。GitHub 链接为固定 SHA 形式，不指向会移动的分支名。

## 6. 脱敏与“敏感配置不进 Git”

| 类别 | 本文处理 | 仓库处理 |
|---|---|---|
| 设备地址 | `<DEVICE-IP>`、`192.168.x.x` | 不写入；真实值只在密封附件/工单 |
| 端口 | 只写工具默认 `443`/`8443` | 实际端口由 E1 批准单在仓库外记录 |
| 账号/密码 | 只写变量名与“存在性” | 不写入；运行时注入，执行后清理 |
| 证书指纹 | 只写 `<FINGERPRINT-REF>` | 不写入；两人线下核验记录 |
| 序列号/MAC | `<MASKED-*>` | 不写入；照片先遮挡 |
| 原始响应 | 不引用内容 | `0700` 临时目录、`0600` 文件、用后删除 |
| 环境变量 | 只列名称 | `.gitignore` 已排除 `.env`/`.env.*`/`secrets.local.md` |

## 7. 未知清单（明确写未知，不猜）

1. `DS-K1T671BM` 的精确完整后缀、硬件版本、区域标识。
2. 目标固件版本、build、发布日期。
3. 真实设备地址、实际 HTTPS 端口。
4. 实际 ISAPI 认证方式、Digest 算法/qop、是否需 SDK 登录。
5. 真实 capability 节点名与值；是否支持人脸库、`faceURL`、`modelData`、特征点。
6. 人员编号字段长度/字符集；人脸库 `FDID`/`faceLibType` 的真实约束。
7. 上传 multipart 字段名、必填项、图片真实上限。
8. 删除语义：是否级联、是否异步、`DeleteProcess` 的真实完成判定。
9. 凭据的实际保管人/工单编号（本轮不读秘密，无法定位）。
10. 历史上是否真的执行过一次只读探针（Git 内无证据，不等于从未执行）。

以上任何一项在 E1/E2 前仍为 `unknown` 时，按本卡前置条件**停止**，不得用文档示例、Mock、近似型号或“应该支持”补齐。

## 8. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-19 | 首版：基于 `282a20f` 与既有分支证据，记录型号/地址/端口/固件/协议/凭据存放位置的找回结果与缺口；本轮 0 设备动作 |
