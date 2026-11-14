# REL-AI-02 HK 人脸门禁生产发布、灰度与回滚 Runbook

- 任务：REL-AI-02
- 状态：**草案，待 Codex 复审；未批准发布，未执行部署、回滚、迁移或设备调用**
- 代码基线：`1155b7ba65991d324fb8b22bb8f7dd87f49428f9`（`fix(face): close final H4-b cleanup gaps`）
- 文档分支：`docs/hk-face-release-runbook`
- 日期：2026-11-14
- 适用对象：HK-AI-04 人脸门禁服务层（H2/H3/H4-b）及 H4-c 对账设计的生产发布准备
- 文档性质：纯文档交付；不修改运行代码、测试、集合、索引、配置或远端环境

> **硬门禁：真实 Provider、设备写、HTTP 暴露三项审批全部为“批准”之前，不得部署到任何生产或准生产环境，不得创建生产集合、不得写入真实设备、不得开放 HTTP 路由。**
>
> 当前仓库事实是：服务层只支持 `LocalStore` + `MockFaceAccessProvider`；`server.mjs` 未注册任何人脸路由；真实 Provider 与设备写未实现。因此本 Runbook 的默认位置是 **G0（离线 Mock）**，不是可直接执行的发布指令。

---

## 0. 结论摘要

1. 本 Runbook 给出生产发布、观测、灰度和回滚的**可审计流程**，但当前代码不满足生产发布条件。
2. K1/K2/K3 是三个**互相独立**的密钥域：K1 设备摘要、K2 操作幂等、K3 对账证据摘要。不得复用、不得互相回退。
3. 新增集合、初始化、validator、索引候选和兼容性检查已按仓库代码列出；生产集合初始化脚本、索引 DDL、备份/恢复工具、健康端点、指标管道均为**待确认/待实现**。
4. 灰度固定为 **Mock → 实验室设备 → 单组织 → 小流量 → 全量** 五级；每级都有进入条件、观察窗口、退出条件和回滚点。
5. `UNKNOWN_RESULT`、`cleanupPending`、`domain mismatch`、证据链损坏是**停止级**信号；不得用自动重试或手工改库“消除”。
6. 回滚分为应用回滚、配置回滚、集合数据保护与恢复验证；数据恢复是最后手段，不得用旧快照覆盖新审核/新证据。
7. 本任务未访问生产环境、未创建或修改真实密钥、未运行数据库迁移、未执行部署/回滚、未调用真实设备。
8. 本文所有“建议阈值”均标记为**待批准**；所有缺失项均标记为**待确认**。

---

## 1. 范围、基线与术语

### 1.1 范围内

- `admin-web/lib/face-service/` 下的 H2 授权、H3 合成派发、H4-a 撤权、H4-b Mock 清理、H4-c 对账设计。
- 相关集合、validator、K1/K2/K3 配置、状态机、错误分类、审计与观测信号。
- 生产发布前检查、灰度、监控告警、停止条件、回滚、演练和验收。

### 1.2 范围外

- 微信小程序编译、上传、体验版/正式版发布。
- 云函数 `dbInit`、`contentInit`、`chatInit`、`syncDevices` 等初始化或数据覆盖。
- 真实门锁/人脸设备协议、固件、网络和现场施工。
- 真实 Provider 商务、合规、个人信息保护影响评估的实质审查（只列门禁）。
- 生产数据库、对象存储、NAS、密钥管理系统的实际操作。

### 1.3 基线事实

| 项目 | 事实 | 来源 |
|---|---|---|
| 代码 HEAD | `1155b7b`（H4-b 终态） | git |
| 服务层状态 | H2/H3/H4-b 已实现；H4-c 仅设计/本地草稿 | [face-service README](../../admin-web/lib/face-service/README.md) |
| 运行时 | 仅 `LocalStore` + `MockFaceAccessProvider` | `h3b.mjs`、`h4b.mjs` 构造器校验 |
| HTTP | `FACE_ROUTES` 仅提案，`server.mjs` 未导入/注册 | [routes.mjs](../../admin-web/lib/face-service/routes.mjs) |
| 真实 Provider | `createFaceProvider` 只接受 `mode=demo|test` + `provider=mock` | [index.mjs](../../admin-web/lib/face-service/index.mjs) |
| 设备写 | 所有 job 为 `executionMode=test`、`provider=mock`、`evidenceScope=simulated` | `service.mjs`、`h4b.mjs` |
| 版本号 | 根 `package.json` 为 `0.1.0-beta.16`，后台为 `0.6.0-beta.1`；远端存在更高 beta 标签 | [package.json](../../package.json)、[admin-web/package.json](../../admin-web/package.json) |
| 版本一致性 | **待确认**：以哪个版本作为发布版本必须以变更单冻结，不得用标签名推断 | 本文 §12 |
| H4-c | 本地工作区存在未提交的 `h4c-evidence.mjs`、`store.mjs`、`index.mjs` 变更；不在本分支基线 | git status |

> H4-c 的 K3、证据集合、证据链监控在本 Runbook 中登记为“**待合入**”。在 H4-c 通过 Codex 终审并单独合入前，不得创建 `evidence_digest_domains`、`device_operation_evidence`、`device_operation_evidence_heads` 的生产集合。

### 1.4 术语

| 术语 | 定义 |
|---|---|
| K1 | 设备摘要域密钥：`DEVICE_CLAIM_*` / `DEVICE_DIGEST_REALM`，用于设备序列号 HMAC 与设备 owner claim 绑定 |
| K2 | 操作幂等域密钥：`OPERATION_KEY_*`，用于 grant/revoke/review 等操作的幂等键 HMAC 与 domain guard |
| K3 | 对账证据域密钥：`H4_EVIDENCE_*`，用于 H4-c 人工对账 evidence 的 HMAC、fingerprint 与全局 domain（待合入） |
| `UNKNOWN_RESULT` | Provider 调用结果不明；job 进入 `awaiting_result`；不得自动重发 |
| `cleanupPending` | grant 已业务撤销，但设备侧清理尚未确认；值为 `true` 时资源不得视为已释放 |
| `domain mismatch` | 已持久化的 domain head/version 与当前密钥/版本/fingerprint 不一致；失败关闭 |
| 证据链损坏 | evidence/head 缺失、序列不连续、previous 不匹配、HMAC 重算失败等；失败关闭 |
| G0–G4 | 灰度阶段：离线 Mock、实验室设备、单组织、小流量、全量 |

---

## 2. 发布前置：配置与环境变量

### 2.1 配置原则

1. 所有密钥值只来自密钥管理系统或部署平台的受控环境变量；**不得**写入 Git、文档、报告、工单、聊天或截图。
2. `admin-web/config.example` 只保留空值/占位值；真实值只存在于受控环境。
3. K1/K2/K3 必须使用**不同密钥**、**不同 realm**，不得复用。
4. 配置变更必须先快照、后变更、再验证；任何 domain 不匹配都失败关闭，禁止自动补写/自动换钥。
5. 发布前记录“配置指纹”（K1/K2/K3 的 version + fingerprint + realm），不记录密钥原文。

### 2.2 K1/K2/K3 环境变量

> 格式/长度均来自仓库代码；`<...>` 为占位符，不是可复制值。来源列是建议的受控来源，实际系统名待确认。

| 变量 | 用途 | 格式 | 长度/边界 | 值来源 | 失败行为 |
|---|---|---|---|---|---|
| `DEVICE_CLAIM_HMAC_KEY_B64` | K1 设备摘要 HMAC 密钥 | 规范 Base64；解码必须是 32 字节 | 编码长度为 4 的倍数（32 字节通常为 44 字符） | `<secret-manager>/K1` | `deviceClaimConfig` 抛出；调用方必须失败关闭。当前未接入启动检查 |
| `DEVICE_CLAIM_KEY_VERSION` | K1 密钥版本 | 十进制正整数 | `>= 1`；代码用 `Number` 整数校验，未设上限 | `<deployment-env>/K1` | 同上 |
| `DEVICE_DIGEST_REALM` | K1 部署域 | 字符串，去除首尾空白后非空 | 代码未设字符集/长度上限；建议与设备记录一致 | `<deployment-env>/K1` | 同上 |
| `OPERATION_KEY_HMAC_KEY_B64` | K2 操作幂等 HMAC 密钥 | 规范 Base64；解码必须是 32 字节 | 编码长度为 4 的倍数 | `<secret-manager>/K2` | `NOT_CONFIGURED` / 503（操作时） |
| `OPERATION_KEY_VERSION` | K2 密钥版本 | 十进制正整数 | 安全整数，`>= 1` | `<deployment-env>/K2` | `NOT_CONFIGURED` / 503 |
| `OPERATION_KEY_REALM` | K2 操作域 | `^[a-z0-9][a-z0-9-]{2,63}$` | 3–64 字符 | `<deployment-env>/K2` | `NOT_CONFIGURED` / 503 |
| `H4_EVIDENCE_HMAC_KEY_B64` | K3 证据 HMAC 密钥（待合入） | 规范 Base64；解码必须是 32 字节 | 编码长度为 4 的倍数 | `<secret-manager>/K3` | `NOT_CONFIGURED` / 503 |
| `H4_EVIDENCE_KEY_VERSION` | K3 密钥版本（待合入） | **字符串**形式的十进制正整数 | 安全整数，`>= 1`；代码要求原始值为字符串 | `<deployment-env>/K3` | `NOT_CONFIGURED` / 503 |
| `H4_EVIDENCE_REALM` | K3 证据域（待合入） | `^[a-z0-9][a-z0-9-]{2,63}$` | 3–64 字符 | `<deployment-env>/K3` | `NOT_CONFIGURED` / 503 |

**代码位置**：

- K1：[collections.mjs](../../admin-web/lib/face-service/collections.mjs) `deviceClaimConfig`（约 108–122 行）。
- K2：同文件 `operationKeyConfig`（约 198–216 行）。
- K3：`h4c-evidence.mjs` `evidenceKeyConfig`（约 164–181 行）——该文件当前未提交，不能作为发布基线链接。

**K1 当前接线状态**：`deviceClaimConfig` 只在 helper/测试中使用；生产服务启动时**没有**强制读取 K1。也就是说，缺少 K1 不会阻止 Mock 服务启动，但设备接入路径一旦调用就会失败关闭。发布前必须确认设备接入代码显式调用它，否则“K1 已配置”只是静态存在，不构成运行时保护。**待确认**。

### 2.3 其他发布相关环境变量

| 变量 | 用途 | 格式/长度 | 值来源 | 失败行为 |
|---|---|---|---|---|
| `ADMIN_MODE` | 运行模式 | `demo` 或 `live` | 部署平台 | 非法值启动失败 |
| `ADMIN_ORIGIN` | 后台公开源 | 绝对 origin；live 必须 HTTPS，或回环地址的显式开发例外 | 部署平台 | live 缺失/非 HTTPS 启动失败 |
| `CLOUDBASE_ENV_ID` | 云环境标识 | 非空字符串 | 部署平台 | live 缺失启动失败 |
| `TENCENTCLOUD_SECRETID` | 云 SDK 凭据 ID | 非空字符串 | `<secret-manager>` | live 缺失启动失败 |
| `TENCENTCLOUD_SECRETKEY` | 云 SDK 凭据 Key | 非空字符串 | `<secret-manager>` | live 缺失启动失败 |
| `IDENTITY_HMAC_KEY` | 身份摘要密钥 | 字符串，`>= 16` 字符 | `<secret-manager>` | live 缺失/过短启动失败 |
| `IDENTITY_ENCRYPTION_KEY` | 身份加密密钥 | 64 位十六进制（解码 32 字节） | `<secret-manager>` | live 缺失/格式错误启动失败 |
| `ADMIN_ORG_ID` | 固定组织 ID | 非空字符串（有界 ID 语义） | 部署平台 | live 未配置时 `/api/v2` 保持关闭 |
| `ADMIN_ORG_NAME` | 组织名称 | 字符串；缺省回退 `ADMIN_ORG_ID` | 部署平台 | 非阻断 |
| `ADMIN_ORG_ADMINS` | 初始管理员 ID 列表 | 逗号分隔；逐项 trim；过滤空项 | 部署平台 | 非阻断，但需人工核对 |
| `ADMIN_DATA_DIR` | 本地数据目录 | 绝对/相对路径 | 部署平台 | 非 live 主要使用；live 使用 CloudStore |
| `HOST` / `PORT` | 监听地址/端口 | `HOST` 字符串；`PORT` 整数 | 部署平台 | demo 非回环 `HOST` 启动失败 |
| `FACE_DECODE_CONCURRENCY` | 人脸解码并发 | 正整数；缺省 2 | 部署平台 | 非法值回退默认 |
| `FACE_DECODE_QUEUE` | 人脸解码队列 | 正整数；缺省 8 | 部署平台 | 非法值回退默认 |
| `FILE_STORAGE_DEFAULT` | 文件默认后端 | `local`/`cloud`/`nas` 或空 | 部署平台 | 非法/未实现返回 `STORAGE_UNAVAILABLE` |
| `NAS_ENABLED` | NAS 开关 | `true`/`false` | 部署平台 | 未实现时不回退公开路径 |
| `FILE_RETENTION_DAYS` | 文件保留天数 | 整数或空 | 部署平台 | 空表示不自动清理 |
| `FILE_LEGACY_IMAGE_FALLBACK` | 旧图片兼容策略 | `deny`/`allow` | 部署平台 | 默认 `deny`；`allow` 仅显式配置 |

**代码位置**：

- live 启动校验：[server.mjs](../../admin-web/server.mjs) 约 1353–1379 行。
- 身份密钥：[server.mjs](../../admin-web/server.mjs) `identityKeyConfig` 约 64–87 行。
- 配置示例：[config.example](../../admin-web/config.example)。

### 2.4 配置失败关闭验证

**预演（离线、只读、合成）**：

```bash
# K1/K2 缺失配置必须抛错；只读取 helper，不启动服务、不连接云端
node --input-type=module -e "import { deviceClaimConfig, operationKeyConfig } from './admin-web/lib/face-service/collections.mjs'; for (const [name, fn] of [['K1', deviceClaimConfig], ['K2', operationKeyConfig]]) { try { fn({}); console.error(name + ' unexpectedly configured'); process.exitCode = 1; } catch (e) { console.log(name + ' fail-closed: ' + (e.code || e.message)); } }"

# live 身份密钥缺失必须启动失败；只调用纯函数
node --input-type=module -e "import { identityKeyConfig } from './admin-web/server.mjs'; try { identityKeyConfig('live', {}); console.error('live unexpectedly configured'); process.exitCode = 1; } catch (e) { console.log('identity fail-closed: ' + e.message); }"
```

**K3（仅当 H4-c 已合入本地工作区）**：

```bash
node --input-type=module -e "import { evidenceKeyConfig } from './admin-web/lib/face-service/h4c-evidence.mjs'; try { evidenceKeyConfig({}); console.error('K3 unexpectedly configured'); process.exitCode = 1; } catch (e) { console.log('K3 fail-closed: ' + (e.code || e.message)); }"
```

**正式执行（默认关闭，未执行）**：

- 在目标环境以**缺失 K1/K2/K3/身份密钥**的方式启动一次“负向启动验证”，确认进程拒绝启动或操作返回 503；该操作必须由发布负责人在维护窗口执行，不能由本任务执行。
- 负向验证不得写入任何业务记录；不得把“启动失败”误判为环境故障而绕过。

**验收断言**：

- 缺失/非法 K1：调用路径抛错，零写入。
- 缺失/非法 K2：`NOT_CONFIGURED/503`，零写入。
- 缺失/非法 K3：`NOT_CONFIGURED/503`，零写入。
- 同版本换钥：`DOMAIN_MISMATCH/409`，零写入。
- domain 单边缺失/kind 错/内部矛盾：`DOMAIN_INCOMPLETE/409`，零写入。
- live 无云配置：进程启动失败，不打开监听端口。
- 任何失败都不得回退到 demo、不得自动补写 domain、不得自动生成新密钥。

---

## 3. 数据模型：集合、初始化、validator、索引、兼容性

### 3.1 新增/相关集合

> “组织域”表示记录带 `orgId`；“全局域”表示跨组织共享，不能按 `orgId` 隔离。基线列中的“H4-c 待合入”表示当前分支 HEAD 没有该集合，只有本地工作区草稿。

| 集合 | 域 | 用途 | 主要写入方 | validator | 基线 |
|---|---|---|---|---|---|
| `access_devices` | 组织域 | 设备、owner claim 绑定、能力/状态 | 设备接入（待实现） | `validateAccessDeviceRecord` | 基线 |
| `face_credentials` | 组织域 | 人脸凭证审核/图片状态 | 提交、审核 | `validateRecord` + 输入 DTO | 基线 |
| `device_access_grants` | 组织域 | 授权状态、`cleanupPending`、清理任务指针 | `createGrant`、`revoke`、H4-b finalize | `validateRecord` | 基线 |
| `device_operation_jobs` | 组织域 | 任务状态机、租约、结果、清理阶段 | H2/H3/H4-b | `validateRecord` + `validateDispatchJob` / `validateRevokeJob` | 基线 |
| `device_operation_logs` | 组织域 | 确定性状态迁移日志 | H2/H3/H4-b | 通用形状校验 + 确定性 ID | 基线 |
| `device_claims` | 全局/设备域 | 设备 owner claim，墓碑释放 | 设备接入、H4-b | `validateOwnerClaimRecord` | 基线 |
| `grant_slot_claims` | 组织域 | 人+设备+周期的唯一授权槽 | `createGrant`、H4-b | `validateGrantSlotRecord` | 基线 |
| `operation_keys` | 组织域（记录带 `orgId`） | K2 幂等键结果，不存原始幂等键 | H2/H3/H4 | 通用形状 + K2 helper | 基线 |
| `device_digest_domains` | 全局域 | K1 head/version，防同版本换钥 | 设备接入/受控初始化（**当前无生产写入路径**）；`createGrant` 只读复核 | `validateDigestDomainRecord` | 基线 |
| `operation_key_domains` | 全局域 | K2 head/version，防同版本换钥 | 所有 K2 操作 | `validateOperationKeyDomainRecord` | 基线 |
| `device_claim_release_guards` | 组织域 | claim 释放的 epoch/revision 守卫 | `createGrant`、H4-b | `validateDeviceClaimReleaseGuard` | 基线 |
| `device_operation_evidence` | 组织域 | H4-c 不可变对账证据 | H4-c | `validateEvidenceRecord` | H4-c 待合入 |
| `device_operation_evidence_heads` | 组织域 | 每 job 一条证据链 head / CAS | H4-c | `validateEvidenceHead` | H4-c 待合入 |
| `evidence_digest_domains` | 全局域 | K3 head/version，防同版本换钥 | H4-c | `validateEvidenceDomainRecord` | H4-c 待合入 |

**相关但非新增集合**（发布时只读/被引用）：`organizations`、`org_memberships`、`persons`、`occupancies`、`occupancy_cycles`、`room_primary_slots`、`blacklist_entries`、`blacklist_decisions`、`eligibility_guards`、`file_assets`、`file_links`、`file_access_log`、`admin_audit`。

### 3.2 初始化

| 层 | 仓库事实 | 发布要求 |
|---|---|---|
| `LocalStore.seed()` | 新集合以空数组出现 | 仅用于本地/测试；不得用于生产初始化 |
| `LocalStore.init()` | 对新增集合使用 `\|\|= []` 补齐；保留旧数据 | 旧数据文件可打开；不得删除/重建整个文件 |
| `CloudStore` | 只校验集合白名单；没有建集合/建索引的代码 | 生产集合/索引/权限必须由受控运维单独创建；**脚本待确认** |
| 集合白名单 | [store.mjs](../../admin-web/lib/store.mjs) 约 5–50 行 | 新增集合必须先进入白名单，否则 `Invalid collection` |
| H4-c 三集合 | 本地 `store.mjs` 已临时追加；未提交 | 合入前不得创建生产集合；合入后按同一模式登记 |

**初始化硬规则**：

1. 不得运行 `dbInit`、`contentInit`、`chatInit`、`syncDevices` 或任何会覆盖既有数据的初始化函数。
2. 不得用 `seed()` 覆盖生产数据；不得删除 `admin-web/.data` 作为“重置”。
3. 新集合必须**先创建空集合/索引/权限**，再发布应用；应用不会自动建表。
4. 任何“自动补写缺失集合/缺失字段”的脚本都不在本仓库内，属于**待确认**，不得临时编写后直接跑生产。

### 3.3 Validator 与失败关闭

| 对象 | Validator/入口 | 关键约束 | 失败码 |
|---|---|---|---|
| 通用集合 | `validateRecord` | 已知集合；组织域 `orgId` + `revision >= 1`；枚举；未知集合拒绝 | `PARAM_ERROR` |
| 设备 | `validateAccessDeviceRecord` | `claimId/ownerOrgId/orgId/provider/digestRealm` 有界；`keyVersion/revision` 正整数；状态 `active/disabled`；`capabilities.face` 布尔；`ownerOrgId===orgId` | `PARAM_ERROR` / 业务码 |
| owner claim | `validateOwnerClaimRecord` | 精确字段白名单；禁止 `grantId/orgId/serialNumber`；active/released 字段互斥；`digestDomain` 固定 | `PARAM_ERROR` |
| slot | `validateGrantSlotRecord` | 禁止旧 `grantId` 字段；active/released 字段互斥；`activeClaimId` 仅 active | `PARAM_ERROR` |
| K1 domain | `validateDigestDomainRecord` | `kind=head/version`；`provider/digestRealm`；`keyVersion`；head 的 `revision/createdAt`；version 的 `enabledAt` | `PARAM_ERROR`（domain guard 映射 `DOMAIN_INCOMPLETE`） |
| K2 domain | `validateOperationKeyDomainRecord` | `realm` 正则；`keyVersion`；`keyFingerprint` 64 hex；head/version 字段 | `PARAM_ERROR`（domain guard 映射 `DOMAIN_INCOMPLETE`） |
| claim release guard | `validateDeviceClaimReleaseGuard` | `_id` 与 org/claim 一致；`epoch/revision >= 1`；时间戳 | `PARAM_ERROR` |
| H3 派发 job | `validateDispatchJob` | 精确字段；快照/版本见证；旧 job 缺快照拒绝 | `DISPATCH_SNAPSHOT_REQUIRED` / `INVALID_JOB` |
| H4-b revoke job | `validateRevokeJob` | 24 字段精确；快照 16 字段；phase/state/result 一致性；`finalizeAttempts <= 4` | `INVALID_JOB` / `CLEANUP_SNAPSHOT_REQUIRED` |
| H4-c evidence | `validateEvidenceRecord`（待合入） | 精确 20 字段；sequence 1..9；still_unknown <=8；previous 链；HMAC；<=4096 bytes | `EVIDENCE_INVALID` / `EVIDENCE_CHAIN_BROKEN` |
| H4-c head | `validateEvidenceHead`（待合入） | 精确字段；每 job 一条；lastSequence/lastEvidenceId/lastObservedAt 一致 | `EVIDENCE_INVALID` / `EVIDENCE_HEAD_CONFLICT` |
| H4-c K3 domain | `validateEvidenceDomainRecord`（待合入） | 精确 head/version 字段；ID 与 realm/version 一致；fingerprint 64 hex | `DOMAIN_INCOMPLETE` / `DOMAIN_MISMATCH` |

**代码位置**：

- 通用与 K1/K2/claim/slot：[collections.mjs](../../admin-web/lib/face-service/collections.mjs) 约 20–662 行。
- H3 job：[h3a.mjs](../../admin-web/lib/face-service/h3a.mjs) 约 8–180 行。
- H4-b job/snapshot：[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) 约 35–120 行。
- H4-c：`admin-web/lib/face-service/h4c-evidence.mjs`（**未提交；不提供链接，以本地工作区文件为准**）。

**失败关闭原则**：

- 未知字段、类型漂移、非安全整数、空白 ID、控制字符、超长/超大记录一律拒绝。
- 记录损坏时**不自动修复、不自动补写、不跳过**；整事务零写。
- 任何 validator 失败都不得被上层“降级为成功”或“忽略并继续”。

### 3.4 索引候选（未创建、未验证）

> 以下为查询/容量建议，**不是已创建索引，也不是已验证的云平台 DDL**。仓库没有索引创建脚本；生产索引必须在隔离环境验证后再建。唯一性主要依赖固定 ID + 事务，不依赖未验证的条件唯一索引。

| 集合 | 等值过滤前缀（建议） | 排序/范围（建议） | 用途 |
|---|---|---|---|
| `face_credentials` | `orgId, reviewState` | `_id` | 审核队列 |
| `device_access_grants` | `orgId, deviceId, state` | `_id` | 设备/组织授权列表 |
| `device_access_grants` | `orgId, personId, state` | `_id` | 人员授权列表 |
| `device_operation_jobs` | `orgId, state` | `nextAttemptAt, _id` | 积压/重试扫描 |
| `device_operation_jobs` | `orgId, grantId` | `_id` | 按授权查任务 |
| `device_operation_logs` | `orgId, jobId` | `at, _id` | 任务日志 |
| `device_operation_evidence` | `orgId, jobId, sequence` | `sequence` | 证据链读取（待合入） |
| `device_operation_evidence_heads` | `orgId, jobId` | `_id` | 每 job 一条 head（待合入） |
| `evidence_digest_domains` | `realm, kind, keyVersion` | `_id` | K3 domain（待合入） |
| `device_claim_release_guards` | `orgId, claimId` | `_id` | claim 释放守卫 |
| `device_claims` | `ownerOrgId, state` | `_id` | owner claim 列表 |
| `grant_slot_claims` | `orgId, deviceId, state` | `_id` | 授权槽扫描 |
| `operation_key_domains` | `realm, kind, keyVersion` | `_id` | K2 domain |
| `device_digest_domains` | `provider, digestRealm, kind` | `_id` | K1 domain |

**索引发布门槛**：

- 必须在隔离环境验证：查询计划、索引可用性、写入成本、冲突重试、集合/事务限额。
- 不得在业务高峰建索引；不得因建索引失败而跳过校验。
- 索引未就绪时，应用必须只做点查或小批量扫描；不得退化为全表扫描 + 先查后写。

### 3.5 兼容性检查

| 检查 | 方法 | 通过标准 | 不通过处理 |
|---|---|---|---|
| 旧 LocalStore 数据文件 | 用副本启动 `LocalStore.init()` | 缺失集合补齐为空数组；旧记录保留 | 停止；不得重建文件 |
| 旧 H3 enroll job | `validateDispatchJob` | 缺 `dispatchSnapshot` 的旧 job 被拒绝 | 失败关闭；不补写 |
| 旧 H4 revoke job | `validateRevokeJob` | 缺 `cleanupSnapshot/cleanupPhase/providerOutcome` 被拒绝 | `CLEANUP_SNAPSHOT_REQUIRED`；不迁移 |
| 旧 grant | 事务内复核 `state/cleanupPending/cleanupJobId` | `cleanupPending` 非布尔/缺失的 revoked grant 阻断 | 阻断；不猜测 |
| 旧 evidence | H4-c validator（待合入） | 缺字段/旧 schema/断链被拒绝 | `EVIDENCE_INVALID/CHAIN_BROKEN`；不补写 |
| K1 domain | `digestDomainMatchesDevice` | head/version 完整且与设备一致 | `DOMAIN_INCOMPLETE` / `DEVICE_DIGEST_CONFIG_CHANGED` |
| K2 domain | `applyOperationKeyDomain` | head/version 完整且与配置一致 | `DOMAIN_INCOMPLETE` / `DOMAIN_MISMATCH` |
| K3 domain | `applyEvidenceDomain`（待合入） | head/version 完整且与配置一致 | `DOMAIN_INCOMPLETE` / `DOMAIN_MISMATCH` |
| 组织/成员 | 事务内读取 `organizations`/`org_memberships` | `active` + 权限点 | `FORBIDDEN` / 404 同态 |
| 版本号 | 变更单冻结 + 制品清单 | 制品/提交/配置三者一致 | 停止发布 |
| 路由 | `server.mjs` 无 face 导入/注册 | 未批准前保持关闭 | 若发现已注册，立即停止 |

**代码位置**：[store.mjs](../../admin-web/lib/store.mjs) 约 222–257 行；[h3a.mjs](../../admin-web/lib/face-service/h3a.mjs)；[h4b.mjs](../../admin-web/lib/face-service/h4b.mjs)；[collections.mjs](../../admin-web/lib/face-service/collections.mjs)。

---

## 4. 备份、迁移预检与容量检查

### 4.1 备份范围与顺序

> 仓库没有生产备份脚本；以下为 Runbook 要求，不是当前可执行命令。备份工具/账号/存储位置均为**待确认**。

| 顺序 | 对象 | 内容 | 保护要求 |
|---:|---|---|---|
| 1 | 发布制品 | commit SHA、制品 SHA-256、构建日志 | 只读、与变更单绑定 |
| 2 | 配置元数据 | 变量名、版本、realm、K1/K2/K3 fingerprint、live 开关 | 不含密钥值；单独受限保存 |
| 3 | 云集合 | 人脸相关集合 + `organizations`/`org_memberships`/`admin_audit`/`file_assets` | 加密、访问审计、保留期 |
| 4 | 本地数据 | `admin-web/.data`（如适用） | 停写后复制；保留原文件 |
| 5 | 文件资产 | `file_assets` 清单、私有对象清单、校验和 | 不先删除原件；不把私密资料放入公开报告 |
| 6 | 密钥材料 | K1/K2/K3/身份密钥的受控备份 | 与数据备份分离；双人控制；不写文档 |

**备份验收**：

- 备份成功不等于可恢复；必须在隔离副本完成一次恢复验证。
- 恢复副本的集合计数、关键记录、ID、revision、domain fingerprint 必须可对账。
- 备份密钥丢失时，证据 HMAC 无法重算；因此密钥托管是恢复验收的一部分。

### 4.2 迁移预检

> 当前仓库**没有**生产迁移脚本；`scripts/db-v2-migrate.mjs` 只是历史文档中的目标接口，不存在。不得临时编写迁移脚本直接跑生产。

| 预检项 | 检查 | 通过标准 | 失败处理 |
|---|---|---|---|
| 变更范围 | 是否只新增集合/字段/索引，是否改旧主键/旧语义 | 仅增量；旧字段不变 | 停止；重新设计 |
| 数据量 | 各集合行数、增长率、最大文档 | 低于容量门槛 | 分片/延期 |
| 引用完整性 | grant→credential/device/claim/slot/guard；job→grant | 无孤儿/跨组织引用 | 人工冲突清单；不猜测 |
| 旧记录 | 缺 snapshot/guard/domain/证据 | 能失败关闭 | 不自动补写 |
| domain | K1/K2/K3 head/version 是否存在且一致 | 完整一致 | 受控修复；不换钥 |
| 索引 | 候选索引是否已建/验证 | 查询可用 | 不发布 |
| 权限/安全规则 | 客户端不可直写核心集合 | 服务端鉴权 | 不发布 |
| 回滚可行性 | 旧应用能否读新数据 | 向后兼容 | 不发布 |

**预演**：

- 使用**脱敏副本/合成数据**做只读盘点；不得连接生产、不得读取真实证件/人脸。
- 迁移 dry-run 必须零写入；重复执行必须幂等；断点恢复必须可对账。
- 任何“猜测映射/自动合并/跳过冲突”都不允许。

### 4.3 容量检查

| 限制 | 仓库事实 | 发布前检查 | 建议阈值（待批准） |
|---|---|---|---|
| 单集合列表读取 | `CloudStore.list` 每次 100 条，累计 20,000 条后报错 | 人脸集合行数/增长 | 70% 警告，85% 停止 |
| 单事务引用 | 应用上限 90 | 最坏路径 refs（H4-b `8+N`） | 80 警告，88 停止 |
| H4-b 清理候选 | 82 candidates + 8 = 90；83/91 失败关闭或 local-finalize | 单设备/组织候选数 | 任何 >82 预警 |
| evidence/head/snapshot 文档 | 单条 <=4096 bytes | 最大序列化长度 | 80% 警告 |
| 人脸图片 | 200KB 输入上限 | 上传样本/拒绝率 | 任何超限拒绝 |
| 请求体 | 默认 64KB；上传另有限制 | 最大请求 | 按端点核对 |
| 事务时长/冲突 | 云端未验证 | 隔离环境压测 | `REVISION_CONFLICT` 比例阈值 |

**容量预演**：

```bash
# 只读静态检查：确认 90-ref 上限和集合白名单存在
node --input-type=module -e "import { readFileSync } from 'node:fs'; const s = readFileSync('admin-web/lib/store.mjs','utf8'); if (!s.includes('> 90') || !s.includes('20000')) process.exit(1); console.log('capacity guards present');"
```

正式容量盘点必须在只读副本/报表上执行，**默认关闭**，不得在生产直接全量拉取。

---

## 5. 灰度计划：Mock → 实验室设备 → 单组织 → 小流量 → 全量

### 5.1 阶段总表

| 阶段 | 环境/流量 | 进入条件 | 观察窗口 | 退出条件 | 回滚点 |
|---|---|---|---|---|---|
| G0 离线 Mock | LocalStore + Mock；无 HTTP/真实设备 | 代码评审通过、离线测试通过 | 每次变更 | 证据完整；无 P0/P1 | 丢弃本地数据 |
| G1 实验室设备 | 实验室 1 台设备、1 个测试组织、合成人员 | **A1 真实 Provider + A2 设备写 + A3 HTTP 三项全批准**；实验室网络隔离 | 24h 或 100 次操作（先到者） | 0 未授权；0 证据损坏；`UNKNOWN_RESULT` 建议 <1%；`cleanupPending` 0 | 关闭 HTTP/设备开关；应用回滚 |
| G2 单组织 | 1 个试点组织；受控设备/用户 | G1 退出；备份/回滚演练完成；变更单批准 | 72h | 指标达标；无跨组织；无 domain mismatch | 停新授权；应用回滚；保留数据 |
| G3 小流量 | 5% 组织或 1% 操作量（建议，待批准） | G2 退出；容量/告警验证 | 7 天 | 错误率/积压/延迟达标 | 降回 G2；关闭新流量 |
| G4 全量 | 100% | G3 退出；Go/No-Go 签字 | 7 天 | 稳定；无停止条件 | 降级到 G3；应用回滚 |

**阶段说明**：

- **G0** 是当前唯一可执行阶段；不得把 G0 的 Mock 成功当作生产验证。
- **G1** 是第一次真实 Provider/设备/HTTP 组合；必须在实验室，不得直接进生产。三项审批缺一不可。
- **G2** 只允许一个组织；跨组织读取必须返回 404 同态。
- **G3/G4** 的比例是建议值，必须由产品/安全/运维批准；没有批准就停在上一阶段。

### 5.2 每阶段准入清单

| 检查 | G0 | G1 | G2 | G3 | G4 |
|---|---|---|---|---|---|
| 代码评审/Codex 复审 | 必须 | 必须 | 必须 | 必须 | 必须 |
| 真实 Provider 审批 A1 | 不需要 | **必须** | 必须 | 必须 | 必须 |
| 设备写审批 A2 | 不需要 | **必须** | 必须 | 必须 | 必须 |
| HTTP 暴露审批 A3 | 不需要 | **必须** | 必须 | 必须 | 必须 |
| 备份完成 | 可选 | 必须 | 必须 | 必须 | 必须 |
| 回滚演练 | 可选 | 必须 | 必须 | 必须 | 必须 |
| 监控/告警 | 本地日志 | 必须 | 必须 | 必须 | 必须 |
| 变更单/维护窗口 | 不需要 | 必须 | 必须 | 必须 | 必须 |
| 数据迁移 | 禁止 | 禁止（仅合成） | 仅批准的增量 | 仅批准的增量 | 仅批准的增量 |

### 5.3 灰度期间禁止事项

- 不得在灰度组织之外创建授权/设备/证据。
- 不得用生产真实人脸做未批准的模型/质量试验。
- 不得为了“让流程通过”关闭 domain/evidence/claim 校验。
- 不得在 `UNKNOWN_RESULT` 上自动重发；只能人工对账（H4-c 合入后）。
- 不得在 `cleanupPending=true` 时把授权显示为 active 或释放 claim。
- 不得跨阶段复用实验数据作为生产证据。

---

## 6. 观测、告警、停止条件与回滚触发

### 6.1 观测现状

| 能力 | 仓库事实 | 发布要求 |
|---|---|---|
| 健康端点 | **未实现**；只有 Mock Provider 的 `health()` 返回 `{ok, scenario}` | 待实现/待确认；不得把静态首页当健康检查 |
| 指标 | 无 metrics/tracing 代码；只有 `console.error` | 待接入日志/指标管道 |
| 日志 | 业务日志写集合；错误日志可能含错误码 | 禁止记录密钥/证件/人脸/原始 Provider 载荷 |
| 审计 | `admin_audit` + 确定性 audit | 只读查询/导出需权限与留痕 |
| 告警路由 | 仓库无配置 | 待确认值班系统/升级路径 |

> 以下指标是**建议的数据/日志派生定义**；采集方式、字段名和查询语句需在实现后冻结。阈值全部为**建议，待批准**。

### 6.2 指标与告警阈值

| ID | 指标 | 定义/来源 | 警告（建议） | 严重（建议） | 停止/回滚（建议） | 责任人 |
|---|---|---|---|---|---|---|
| M01 | 服务存活 | 进程/监听端口/只读探针连续失败 | 1 次 30s | 连续 2 次 30s | 立即停止新流量 | `<release-commander>` |
| M02 | HTTP 5xx 率 | 5xx / 总请求（5m） | >1% | >5% | >5% 持续 5m 回滚 | `<backend-oncall>` |
| M03 | HTTP p95 延迟 | 请求耗时（10m） | >1.5s | >3s | >3s 持续 10m 停止扩量 | `<backend-oncall>` |
| M04 | `queued` 积压 | `device_operation_jobs.state=queued` 数量/最老年龄 | >10 或 >5m | >50 或 >15m | >100 或 >30m 停止 | `<backend-oncall>` |
| M05 | `sending` 卡住 | `state=sending` 且 `leaseExpiresAt < now` | 任意 >2m | >5 条 | 任意 >10m 停止 | `<backend-oncall>` |
| M06 | `UNKNOWN_RESULT` 率 | `job.result.errorKind=UNKNOWN_RESULT` / 派发数（15m） | >1% | >3% | >5% 或持续 10m 停止 | `<backend-oncall>` |
| M07 | `awaiting_result` 年龄 | `state=awaiting_result` 的最老 `updatedAt` | >15m | >1h | >2h 或 >10 条停止 | `<backend-oncall>` |
| M08 | `cleanupPending` 数量 | grant `state=revoked` 且 `cleanupPending=true` | >0 | >5 或最老 >30m | >10 或最老 >2h 停止 | `<backend-oncall>` |
| M09 | domain mismatch | 错误码 `DOMAIN_MISMATCH`/`DOMAIN_INCOMPLETE`/`DEVICE_DIGEST_CONFIG_CHANGED`/`IDENTITY_CONFIG_CHANGED` | 不允许 | 任意 1 次 | **立即停止** | `<security-reviewer>` + `<backend-oncall>` |
| M10 | 证据链损坏 | `EVIDENCE_CHAIN_BROKEN`/`EVIDENCE_HEAD_CONFLICT`/`EVIDENCE_INVALID`/`EVIDENCE_STALE` | 不允许 | 任意 1 次 | **立即停止** | `<security-reviewer>` + `<backend-oncall>` |
| M11 | Provider 错误率 | `terminal_failed` + `retryable_failed` / 派发数 | >2% | >5% | >10% 或连续 15m 停止 | `<backend-oncall>` |
| M12 | 写冲突率 | `REVISION_CONFLICT`/`CONFLICT` / 写请求 | >1% | >3% | >5% 停止扩量 | `<backend-oncall>` |
| M13 | 容量余量 | 集合行数/20,000；事务 refs/90 | >70% / >80 | >85% / >88 | 达到上限停止 | `<cloud-dba>` |
| M14 | 配置漂移 | K1/K2/K3 fingerprint/version 与发布快照不一致 | 任意 | 任意 | **立即停止** | `<release-commander>` |
| M15 | 审计写失败 | `admin_audit`/确定性 audit 写入失败 | 任意 | 任意 | **立即停止** | `<cloud-dba>` |
| M16 | 对账积压（H4-c） | `awaiting_result` 且超过对账 SLA 的 job 数 | >0 | >5 | >10 或 >24h 停止 | `<backend-oncall>` |

**M09/M10 的解释**：

- `DOMAIN_MISMATCH` 是“完整 domain 与当前配置不一致”，通常意味着换钥/版本/指纹漂移；不得通过删除 domain 记录“修复”。
- `DOMAIN_INCOMPLETE` 是“单边缺失/kind 错/内部矛盾”，意味着存储损坏；不得自动补写。
- `EVIDENCE_CHAIN_BROKEN` 包括 previous evidence 缺失、序列/ID/组织/job/observedAt 不一致、HMAC 重算失败；不得把损坏记录当父节点继续追加。
- H4-c 未合入前，M10 只能在离线测试中触发；合入后必须接入生产告警。

### 6.3 停止条件（Stop-the-line）

满足任一条件，立即停止扩量/停止新授权/关闭 HTTP 或设备写开关，进入事件流程：

| ID | 停止条件 | 立即动作 |
|---|---|---|
| S01 | A1/A2/A3 任一未批准或被撤销 | 不启动 G1；已启动则停止 |
| S02 | 任意 `DOMAIN_MISMATCH` / `DOMAIN_INCOMPLETE` | 冻结配置写入；保留现场；通知安全/后端 |
| S03 | 任意 `EVIDENCE_CHAIN_BROKEN` / `EVIDENCE_HEAD_CONFLICT` | 冻结对账/证据写入；禁止补写 |
| S04 | 跨组织读取/写入成功，或权限校验被绕过 | 立即关闭路由；安全事件 |
| S05 | `cleanupPending` 超阈值或持续增长 | 停止新撤权/新授权；保留 grant/slot/claim |
| S06 | `UNKNOWN_RESULT` 超阈值 | 停止派发；禁止自动重发；转人工对账 |
| S07 | 容量达到 20,000 或 refs >90 | 停止写入/扩量；扩容或分片 |
| S08 | 审计写入失败或日志缺失 | 停止写入；恢复审计链路 |
| S09 | 备份/恢复演练失败 | 不进入下一阶段 |
| S10 | 真实设备出现未授权开门/无法撤销 | 立即切断设备写；现场处置 |

### 6.4 回滚触发

| 触发 | 类型 | 决策人 | 动作 |
|---|---|---|---|
| M01/M02/M03 严重 | 自动/值班 | `<release-commander>` | 停止新流量；应用回滚 |
| M09/M10 任意 | 手动/安全 | `<security-reviewer>` + `<release-commander>` | 冻结配置/对账；应用回滚；保留数据 |
| M08 持续 | 手动 | `<backend-oncall>` | 停止撤权/授权；修复 finalize；不回滚数据 |
| M06 持续 | 手动 | `<backend-oncall>` | 停止派发；人工对账；不自动重发 |
| M13 容量 | 手动 | `<cloud-dba>` | 扩容/分片；必要时停止写入 |
| 安全事件 | 手动 | `<security-reviewer>` | 切断入口；取证；不回滚证据 |

**回滚权限**：

- 应用回滚：`<release-commander>` 可决定；`<backend-oncall>` 执行。
- 配置回滚：`<release-commander>` + `<security-reviewer>` 双批准。
- 数据恢复：`<release-commander>` + `<cloud-dba>` + `<security-reviewer>` 三方批准；仅在确认无新写入或已隔离后执行。
- 任何回滚都必须记录变更单、时间线、命令/制品 SHA、验证结果。

---

## 7. 回滚与恢复

### 7.1 应用回滚

**原则**：先停新流量，再回滚应用；数据库保持向后兼容；不得用旧代码写新数据。

| 步骤 | 预演（离线/只读） | 正式执行（默认关闭） |
|---:|---|---|
| 1 | 校验上一制品 SHA-256/commit | `[正式]` 由发布平台选择上一批准制品 |
| 2 | 静态检查旧代码是否读新集合/新字段 | `[正式]` 停止新流量/关闭 face 开关 |
| 3 | 本地用旧版本跑离线测试 | `[正式]` 部署上一制品 |
| 4 | 只读核对版本/健康 | `[正式]` 验证版本、健康、只读查询 |
| 5 | 记录回滚证据 | `[正式]` 观察 30m，决定是否恢复流量 |

**禁止**：

- 不得删除新集合/新字段来“让旧代码跑起来”。
- 不得回滚到会绕过组织/实名/黑名单检查的旧接口。
- 不得在未备份/未确认新写入的情况下恢复旧数据库快照。

### 7.2 配置回滚

| 对象 | 回滚方式 | 禁止 |
|---|---|---|
| `ADMIN_MODE`/`ADMIN_ORIGIN`/云环境 | 恢复上一份完整配置快照 | 不得只改一半；不得回退到 demo |
| K1 | 恢复完全相同的 key/version/realm；domain head 必须匹配 | 不得换新 key 冒充回滚；不得删 domain |
| K2 | 同上 | 不得复用 K1；不得跳过 domain |
| K3 | 同上 | 不得删除 evidence/head；不得重算历史证据 |
| 身份密钥 | 恢复完全相同的 HMAC/加密 key | 不得导致 `IDENTITY_CONFIG_CHANGED` 后强行初始化 |
| 文件/NAS 开关 | 恢复上一值 | 不得回退到公开路径 |

**配置回滚验收**：

- 启动不报配置错误；K1/K2/K3 fingerprint 与快照一致。
- 任意 domain 不匹配必须继续失败关闭，不得“回滚后自动放行”。
- 若密钥材料无法恢复，停止业务写入，进入受控修复；不得生成新密钥覆盖。

### 7.3 集合数据保护

| 数据 | 保护规则 |
|---|---|
| `device_operation_evidence` | 不可变、create-only；禁止删除/覆盖；恢复时按 ID/序列/HMAC 校验 |
| `device_operation_evidence_heads` | 每 job 一条；只允许 CAS 更新；禁止跳号/分叉 |
| `evidence_digest_domains` | 全局 head/version；禁止自动补写/换钥；恢复需同一 K3 |
| `device_access_grants` | 只允许状态迁移；`cleanupPending` 不得手工改 false；保留历史 |
| `grant_slot_claims`/`device_claims` | 只允许墓碑释放；禁止删除/复用他人墓碑 |
| `device_operation_jobs`/`logs` | 追加/状态迁移；日志确定性 ID；禁止删审计 |
| `admin_audit` | 只追加；禁止删改 |

**硬规则**：

1. 不得用“删除记录/重建集合”解决 domain/证据/claim 冲突。
2. 不得把 `cleanupPending=true` 直接改成 `false`；只能通过 H4-b finalize 的合法路径。
3. 不得把 `awaiting_result` 直接改成 `succeeded`；只能通过人工对账（H4-c）或受控修复。
4. 不得恢复会扩大权限的旧快照；恢复后必须重新校验组织/实名/黑名单/设备绑定。

### 7.4 恢复验证

| 验证 | 方法 | 通过标准 |
|---|---|---|
| 集合完整性 | 恢复副本计数、ID 集合、revision 范围 | 与备份清单一致；无重复/缺失 |
| 证据链 | 逐条重算 HMAC、校验 previous/head | 全部通过；损坏项隔离，不继续追加 |
| Domain | K1/K2/K3 head/version/fingerprint | 与配置快照一致 |
| 授权/资源 | grant/slot/claim/device 引用 | 无孤儿；无跨组织；无“已撤销但 active” |
| 权限 | 只读/写入/跨组织负向用例 | 未授权一律拒绝；404 同态 |
| 审计 | 恢复操作是否留痕 | 有审计；无删改 |
| 业务 | 抽样 job 状态与日志 | 状态机合法；无跳变 |
| 性能 | 恢复后只读查询/队列 | 在容量门槛内 |

### 7.5 回滚演练

> 演练只在隔离环境/离线副本进行；不得在生产演练。演练本身也要有变更单和观察人。

| 演练 | 场景 | 步骤 | 通过标准 |
|---|---|---|---|
| D1 桌面演练 | 发布中止/审批撤销 | 走一遍停止条件、通知、决策链 | 30 分钟内完成决策；职责清晰 |
| D2 应用回滚 | 新版本 5xx/健康失败 | 停流量→部署上一制品→验证 | 版本正确；只读查询正常；无新写入 |
| D3 配置回滚 | K2 版本漂移 | 恢复配置快照→启动→domain 校验 | 失败关闭保持；无自动补写 |
| D4 数据恢复 | 隔离副本恢复 | 恢复备份→计数/证据/权限校验 | 全部通过；RTO/RPO 达标 |
| D5 设备止损 | 实验室设备异常 | 关闭设备写/HTTP→保留现场→回滚 | 无未授权开门；证据完整 |
| D6 对账恢复 | `UNKNOWN_RESULT`/`cleanupPending` | 人工对账/本地 finalize（H4-c 合入后） | 不重发 Provider；资源状态正确 |

**演练记录**：时间、环境、版本、审批、步骤、结果、失败项、改进项、责任人占位符、证据链接（受限）。

---

## 8. 发布前、中、后逐项清单

### 8.1 发布前（Pre-flight）

| ID | 检查 | 证据 | 责任人 | 门禁 |
|---|---|---|---|---|
| P01 | 代码冻结；仅文档分支变更 | `git status`/diff | `<release-commander>` | 必须 |
| P02 | Codex/评审通过；无未关闭 P0/P1 | 评审记录 | `<codex-reviewer>` | 必须 |
| P03 | A1 真实 Provider 批准 | 审批记录 | `<product-owner>`/`<security-reviewer>` | G1 必须 |
| P04 | A2 设备写批准 | 实验室记录/审批 | `<device-owner>` | G1 必须 |
| P05 | A3 HTTP 暴露批准 | 安全评审 | `<security-reviewer>` | G1 必须 |
| P06 | 变更单/维护窗口 | 工单 | `<release-commander>` | 必须 |
| P07 | 配置快照（名称/版本/fingerprint） | 配置清单 | `<backend-oncall>` | 必须 |
| P08 | 备份完成并验证 | 备份报告 | `<cloud-dba>` | 必须 |
| P09 | 迁移预检/兼容性检查 | 预检报告 | `<backend-oncall>` | 必须 |
| P10 | 容量检查 | 容量报告 | `<cloud-dba>` | 必须 |
| P11 | 索引/安全规则验证（隔离环境） | 验证报告 | `<cloud-dba>` | 必须 |
| P12 | 监控/告警/值班就绪 | 告警测试 | `<backend-oncall>` | 必须 |
| P13 | 回滚演练完成 | 演练记录 | `<release-commander>` | G1 必须 |
| P14 | 制品 SHA-256/commit 记录 | 制品清单 | `<release-engineer>` | 必须 |
| P15 | 负面配置验证（缺密钥失败关闭） | 验证日志 | `<backend-oncall>` | 必须 |
| P16 | 真实 Provider/设备/HTTP 未批准则不得部署 | 审批表 | `<release-commander>` | 硬门禁 |

### 8.2 发布中（During）

| ID | 检查 | 时点 | 失败动作 |
|---|---|---|---|
| D01 | 部署前再次确认三项审批 | T0 | 停止 |
| D02 | 记录部署制品/版本/操作者 | T0 | 停止 |
| D03 | 启动后只读健康/配置检查 | T0+1m | 回滚 |
| D04 | 只读 DB/集合/索引检查 | T0+2m | 回滚 |
| D05 | 合成/实验室 smoke（G1） | T0+5m | 停止扩量 |
| D06 | 监控 5xx/延迟/积压 | 持续 | 触发停止条件 |
| D07 | `UNKNOWN_RESULT`/`cleanupPending` 看板 | 持续 | 停止/人工对账 |
| D08 | domain/证据链错误 | 持续 | 立即停止 |
| D09 | 审计写入 | 持续 | 立即停止 |
| D10 | 记录时间线/截图/日志（脱敏） | 全程 | 用于复盘 |

### 8.3 发布后（Post）

| ID | 检查 | 时点 | 通过标准 |
|---|---|---|---|
| O01 | 24h 稳定性 | T0+24h | 无停止条件 |
| O02 | 72h 稳定性（G2） | T0+72h | 指标达标 |
| O03 | 7 天稳定性（G3/G4） | T0+7d | 指标达标 |
| O04 | 积压/`UNKNOWN_RESULT`/`cleanupPending` 趋势 | 每日 | 无增长 |
| O05 | domain/证据链巡检 | 每日 | 0 异常 |
| O06 | 容量/增长 | 每周 | 低于门槛 |
| O07 | 备份/恢复抽检 | 每周 | 通过 |
| O08 | 审计/权限抽检 | 每周 | 无越权 |
| O09 | 发布报告/复盘 | 关闭前 | 归档 |
| O10 | 关闭或降级决定 | 关闭前 | 签字 |

---

## 9. 审批、责任与变更控制

### 9.1 三项硬审批

| 审批 | 范围 | 批准人（占位） | 证据 | 失效条件 |
|---|---|---|---|---|
| A1 真实 Provider | 供应商、协议、鉴权、错误映射、数据最小化、限流 | `<product-owner>` + `<security-reviewer>` | 评审记录、合同/合规结论、接口测试 | 供应商/协议/密钥/版本变化 |
| A2 设备写 | 设备型号、实验室、写操作范围、回滚、现场安全 | `<device-owner>` + `<release-commander>` | 实验室报告、设备清单、回滚演练 | 设备/固件/网络/现场变化 |
| A3 HTTP 暴露 | 路由、鉴权、CSRF、限流、WAF、日志脱敏 | `<security-reviewer>` + `<backend-lead>` | 安全评审、渗透/负向测试 | 路由/权限/源站变化 |

**规则**：

- 三项必须**同时有效**；任何一项为“待定/有条件/已过期”都视为未批准。
- 审批必须绑定 commit/制品/配置；代码或配置变化后重新审批。
- 审批人不得是同一人；至少安全与发布职责分离。
- 审批撤销立即触发 S01。

### 9.2 责任人占位符

| 角色 | 占位符 | 职责 |
|---|---|---|
| 发布指挥 | `<release-commander>` | Go/No-Go、停止/回滚决策、对外沟通 |
| 后端值班 | `<backend-oncall>` | 应用、队列、错误、回滚执行 |
| 云/DBA | `<cloud-dba>` | 集合、索引、备份、恢复、容量 |
| 安全评审 | `<security-reviewer>` | 密钥、权限、跨组织、事件 |
| 产品负责人 | `<product-owner>` | 范围、灰度比例、业务验收 |
| 设备负责人 | `<device-owner>` | 实验室设备、现场、设备回滚 |
| 发布工程 | `<release-engineer>` | 制品、SHA、部署记录 |
| Codex 复审 | `<codex-reviewer>` | 独立代码/文档复审 |

### 9.3 变更控制

- 每次发布/回滚/配置变更必须有变更单：ID、范围、审批、时间窗、制品 SHA、配置快照、回滚点、验证人。
- 变更单不得包含密钥/证件/人脸/真实账号。
- 紧急变更也必须事后补审批与复盘；不得跳过 A1/A2/A3（除非明确“停止/回滚”操作）。

---

## 10. 预演命令与正式执行

### 10.1 约定

- **`[预演]`**：只使用离线合成数据、`LocalStore`、Mock Provider、临时目录、只读静态检查；不得连接生产/云/真实设备。
- **`[正式]`**：会改变环境/数据/配置/设备；**默认关闭**，必须 `RELEASE_EXECUTE=1` + 三项审批 + 变更单 + 双人复核。本任务**未执行**任何正式操作。
- 未标记的命令仅为说明，不是授权。

### 10.2 预演命令（可离线执行）

| 目的 | 命令 | 说明 |
|---|---|---|
| 文档空白检查 | `git diff --check` | 只读 |
| 离线测试（单文件） | `node admin-web/tests/face-collections.test.mjs` | 合成数据；不联网 |
| 离线测试（H4-b） | `node admin-web/tests/face-h4b.test.mjs` | LocalStore + Mock |
| 配置失败关闭 | 见 §2.4 | 只调用纯函数 |
| 容量静态检查 | 见 §4.3 | 只读源码 |
| 链接检查 | 本地临时脚本解析相对链接 | 只读；脚本不提交 |
| 敏感扫描 | 本地临时脚本/`git grep` 限定文档 | 只读 |

> 说明：`node --test` 在当前 Windows 沙箱会因测试运行器 `spawn` 的命名管道限制报 `EPERM`；因此本 Runbook 建议用单文件 `node <test>.test.mjs` 方式做离线预演，或由具备正常进程权限的 CI 执行 `npm test`。该限制是执行环境限制，不是业务失败。

### 10.3 正式执行（默认关闭）

| 操作 | 形式（占位，不是可复制命令） | 默认 | 前置 |
|---|---|---|---|
| 创建生产集合/索引 | `<cloud-ops> apply --manifest <approved-manifest>` | 关闭 | A2/A3 + 变更单 + 备份 |
| 部署应用 | `<release-platform> deploy --artifact <sha256> --env <approved-env>` | 关闭 | A1/A2/A3 + Go |
| 开放 HTTP | `<gateway> enable --route face --change <id>` | 关闭 | A3 + 安全评审 |
| 启用设备写 | `<device-gateway> enable --scope <lab-or-pilot> --change <id>` | 关闭 | A2 + 实验室报告 |
| 数据迁移 | `<migration> apply --manifest <approved>` | 关闭 | 预检 + 备份 + 演练 |
| 回滚 | `<release-platform> rollback --to <previous-sha256>` | 关闭 | 停止条件 + 双人批准 |
| 数据恢复 | `<restore> --snapshot <approved> --target <isolated>` | 关闭 | 三方批准 + 隔离 |

**正式执行硬规则**：

1. 默认 `RELEASE_EXECUTE=0`；任何脚本不得把“未设置”解释为“执行”。
2. 正式命令必须绑定变更单 ID、审批 ID、制品 SHA、配置指纹。
3. 执行前再次检查 A1/A2/A3；执行后记录结果。
4. 禁止在生产直接运行 `dbInit`/初始化函数/种子脚本。
5. 禁止在本任务/文档评审阶段执行任何正式命令。

---

## 11. 失败恢复验收标准

### 11.1 验收项

| ID | 标准 | 证据 |
|---|---|---|
| AC01 | 服务恢复，健康/只读探针通过 | 监控/日志 |
| AC02 | 无跨组织读写；未授权请求 403/404 同态 | 负向测试 |
| AC03 | grant/slot/claim/device 引用一致；无“撤销后 active” | 对账报告 |
| AC04 | `cleanupPending=true` 的 grant 未被错误释放 | 对账报告 |
| AC05 | `awaiting_result` 未被自动改写；`UNKNOWN_RESULT` 有对账记录 | 任务/证据 |
| AC06 | K1/K2/K3 domain 与配置快照一致；无 `DOMAIN_MISMATCH` | 配置/日志 |
| AC07 | evidence/head 链完整；HMAC 重算通过 | 证据校验报告 |
| AC08 | 审计记录完整；无删改 | 审计导出 |
| AC09 | 备份恢复副本通过计数/ID/权限/证据校验 | 恢复报告 |
| AC10 | 回滚/恢复时间满足 RTO/RPO | 时间线 |
| AC11 | 事件复盘完成；改进项有责任人/期限 | 复盘报告 |

### 11.2 RTO/RPO（建议，待批准）

| 指标 | 建议值 | 说明 |
|---|---|---|
| RTO | 2 小时 | 从停止到服务恢复 |
| RPO | 15 分钟 | 允许丢失的最大数据窗口 |
| 证据恢复 | 24 小时 | 证据链校验/补齐 |
| 回滚决策 | 30 分钟 | 从触发到决定 |

> 这些值没有仓库依据，必须由业务/安全/运维批准；未批准前不得对外承诺。

---

## 12. 待确认与待批准清单

### 12.1 待确认（仓库缺失/不可见）

| ID | 事项 | 影响 | 责任占位 |
|---|---|---|---|
| TBD-01 | 生产集合创建/初始化脚本不存在 | 无法自动建集合 | `<cloud-dba>` |
| TBD-02 | 索引 DDL/验证未提供 | 查询/容量不可保证 | `<cloud-dba>` |
| TBD-03 | 健康端点未实现 | 只能人工/替代探针 | `<backend-oncall>` |
| TBD-04 | 指标/追踪/告警路由未实现 | 观测依赖日志/人工 | `<backend-oncall>` |
| TBD-05 | 部署/回滚自动化未提供 | 依赖发布平台 | `<release-engineer>` |
| TBD-06 | 备份/恢复工具未提供 | 恢复依赖云厂商/手工 | `<cloud-dba>` |
| TBD-07 | 生产迁移脚本不存在 | 不能执行迁移 | `<backend-oncall>` |
| TBD-08 | H4-c 未合入；三集合/K3 仅本地草稿 | 证据链/对账不可生产 | `<codex-reviewer>` |
| TBD-09 | HTTP 路由未注册 | 无法对外提供服务 | `<backend-lead>` |
| TBD-10 | 真实 Provider 未实现 | 只能 Mock | `<product-owner>` |
| TBD-11 | 设备写未实现 | 只能实验室/模拟 | `<device-owner>` |
| TBD-12 | 版本号不一致（beta.16 vs 更高标签） | 发布版本不可判定 | `<release-commander>` |
| TBD-13 | K1 未接入启动检查 | 缺失 K1 可能不阻止启动 | `<backend-oncall>` |
| TBD-14 | 远端仓库设置（分支保护/CI/部署钩子）不可见 | 推送影响不可完全确认 | `<release-commander>` |
| TBD-15 | 真实域名/IP/账号/凭据不在本文；部署拓扑待确认 | 无法给出具体命令 | `<release-commander>` |
| TBD-16 | K1 domain 无生产写入路径 | `createGrant` 只读复核，首次设备接入需受控创建 head/version | `<device-owner>` + `<cloud-dba>` |

### 12.2 待批准（建议阈值）

| ID | 建议 | 当前状态 |
|---|---|---|
| AP-01 | G1 观察 24h/100 次操作 | 待批准 |
| AP-02 | G2 观察 72h | 待批准 |
| AP-03 | G3 5% 组织或 1% 操作量 | 待批准 |
| AP-04 | G4 全量后观察 7 天 | 待批准 |
| AP-05 | `UNKNOWN_RESULT` 警告/严重/停止 1%/3%/5% | 待批准 |
| AP-06 | `cleanupPending` 严重 >5 或 >30m；停止 >10 或 >2h | 待批准 |
| AP-07 | `queued` 严重 >50 或 >15m；停止 >100 或 >30m | 待批准 |
| AP-08 | 5xx 严重 >5%；p95 严重 >3s | 待批准 |
| AP-09 | RTO 2h / RPO 15m | 待批准 |
| AP-10 | 容量 70%/85% 警告/停止 | 待批准 |

---

## 13. 交付、验证与复审

### 13.1 本任务验证

| 验证 | 方法 | 通过标准 |
|---|---|---|
| `git diff --check` | Git 空白/冲突标记检查 | 无输出 |
| 链接检查 | 离线解析本文相对链接并检查目标存在 | 0 断链 |
| 敏感扫描 | 扫描真实域名/IP/账号/凭据/长密钥/AppID/云环境 ID | 0 命中 |

### 13.2 交付物

- 本文：`docs/tasks/REL-AI-02-HK-FACE-RELEASE-RUNBOOK.md`
- 报告：`docs/tasks/REL-AI-02-DELIVERY-REPORT-2026-11-14.md`
- 分支：`docs/hk-face-release-runbook`
- 仅文档变更；不包含代码、测试、配置、密钥、部署或数据。

### 13.3 复审与停止

- 提交/推送后**停止**，交 Codex 复审。
- 复审重点：三项硬门禁、K1/K2/K3 独立性、集合/初始化/索引事实、停止条件、回滚/恢复边界、是否有未批准的正式命令。
- 复审通过前，不得进入 G1，不得创建生产集合，不得部署。

---

## 附录 A：关键代码/文档索引

| 主题 | 位置 |
|---|---|
| 集合、K1/K2、validator | [collections.mjs](../../admin-web/lib/face-service/collections.mjs) |
| 服务层、createGrant/revoke | [service.mjs](../../admin-web/lib/face-service/service.mjs) |
| H3 派发/UNKNOWN_RESULT | [h3b.mjs](../../admin-web/lib/face-service/h3b.mjs) |
| H4-b 清理/cleanupPending | [h4b.mjs](../../admin-web/lib/face-service/h4b.mjs) |
| H4-c 证据/K3（未提交） | `admin-web/lib/face-service/h4c-evidence.mjs`（本地工作区） |
| 路由提案（未注册） | [routes.mjs](../../admin-web/lib/face-service/routes.mjs) |
| Store/初始化/容量 | [store.mjs](../../admin-web/lib/store.mjs) |
| live 配置/身份密钥 | [server.mjs](../../admin-web/server.mjs) |
| 配置示例 | [config.example](../../admin-web/config.example) |
| 发布打包（不上传/不部署） | [package-release.py](../../scripts/package-release.py) |
| 迁移/备份/回滚原则 | [MIGRATION-PLAN.md](../database/MIGRATION-PLAN.md) |
| 数据模型/索引候选 | [DATA-MODEL.md](../database/DATA-MODEL.md) |
| H3 设计/错误分类 | [HK-AI-04-H3-LEASE-DISPATCH-DESIGN.md](./HK-AI-04-H3-LEASE-DISPATCH-DESIGN.md) |
| H4-b 证据 | [HK-AI-04-H4B-EVIDENCE-2026-11-13.md](./HK-AI-04-H4B-EVIDENCE-2026-11-13.md) |
| H3-b 证据 | [HK-AI-04-H3B-EVIDENCE-2026-11-13.md](./HK-AI-04-H3B-EVIDENCE-2026-11-13.md) |
| 真实环境联调（不自动部署） | [LIVE-DEPLOYMENT.md](../LIVE-DEPLOYMENT.md) |

## 附录 B：错误码与处置

| 错误码 | 含义 | 处置 |
|---|---|---|
| `NOT_CONFIGURED` | K2/K3/Provider/运行模式未配置 | 停止；补配置；不得回退 demo |
| `DOMAIN_INCOMPLETE` | domain 单边缺失/损坏 | 停止；受控修复；不自动补写 |
| `DOMAIN_MISMATCH` | 配置与 domain 不一致 | 停止；核对 key/version/fingerprint |
| `DEVICE_DIGEST_CONFIG_CHANGED` | K1 配置与设备不一致 | 停止；核对设备/摘要域 |
| `IDENTITY_CONFIG_CHANGED` | 身份摘要配置不一致 | 停止；核对身份密钥 |
| `CLEANUP_SNAPSHOT_REQUIRED` | 旧 job/绑定缺失 | 停止；人工核对；不补写 |
| `DEVICE_CLAIM_INVALID` | claim/slot/guard 损坏 | 停止；保留现场 |
| `INVALID_JOB` | job 字段/状态非法 | 停止；查状态机 |
| `REVISION_CONFLICT` | revision/CAS 失败 | 重读；不得强行覆盖 |
| `CONFLICT` | 幂等/确定性 ID 冲突 | 查重放；不得改 ID |
| `EVIDENCE_INVALID` | 证据结构/短码/摘要非法 | 停止；人工核对 |
| `EVIDENCE_STALE` | observedAt 早于 unknown/未来/非递增 | 停止；核对时间线 |
| `EVIDENCE_CHAIN_BROKEN` | 证据链断/previous 不符 | 停止；不继续追加 |
| `EVIDENCE_HEAD_CONFLICT` | head CAS 失败 | 停止；重读；不得分叉 |
| `RECONCILE_THROTTLED` | still_unknown 间隔不足 | 等待；不得绕过 |
| `RECONCILE_LIMIT` | still_unknown 次数上限 | 停止；走最终裁定 |
| `RECONCILE_CONFLICT` | 已终态但 decision 不同 | 停止；保留原终态 |
| `RECONCILE_GENERATION_CONSUMED` | finalize-retry 使用旧 revision | 重新读取；不得重放旧 generation |
| `CAPACITY_EXCEEDED` | 候选/引用超限 | 停止；分片/扩容 |
| `LOCAL_FINALIZE_EXHAUSTED` | 本地 finalize 耗尽 | 人工恢复；不重发 Provider |

## 附录 C：变更记录

| 日期 | 版本 | 变更 | 作者 |
|---|---|---|---|
| 2026-11-14 | 0.1 | 初稿；基于 `1155b7b`；仅文档 | `<codex-reviewer>` 复审前 |

---

**结束语**：本 Runbook 的默认结论是 **NO-GO**。只有当 A1/A2/A3 三项审批、代码合入、集合/索引/备份/监控/演练全部满足，并且 G0→G4 逐级验收通过，才可讨论生产发布。本文不构成发布批准。
