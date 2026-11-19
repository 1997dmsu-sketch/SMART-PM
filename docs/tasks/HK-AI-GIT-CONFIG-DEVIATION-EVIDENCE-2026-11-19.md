# HK-AI Git 配置偏差证据补交（只读调查）

| 项 | 值 |
|---|---|
| 文档 ID | HK-AI-GIT-CONFIG-DEVIATION-EVIDENCE-2026-11-19 |
| 状态 | **原值未证实 / 偏差未关闭**（不得据此宣称已恢复或已闭合） |
| 范围 | 原 Windows 主机 `BF-202204252232`，用户 `Administrator` 的用户级（global）Git 配置 |
| 关联执行者 | 任务 A `hrun-mwm7qjwn-288c50` / DSH `session-002d5a96-7f5c-4452-827b-5912d8c4d1f7`（deepseek-flash） |
| 方法 | 只读：`git config --show-origin --show-scope`、文件元数据/哈希、会话记录解压只读复核、临时文件对照实验 |
| 约束 | 未修改/回退任何 Git 配置；未输出凭据或全量敏感配置；逐条证据见附录 |

配套证据文档：[HK-AI-GIT-CONFIG-DEVIATION-EVIDENCE-APPENDIX-2026-11-19.md](./HK-AI-GIT-CONFIG-DEVIATION-EVIDENCE-APPENDIX-2026-11-19.md)

---

## 1. 输入与前置核对

| 输入 | 结果 |
|---|---|
| `C:\workspace\artifacts\STAGED-CARDS-REVIEW-2026-11-19\DISPATCH.md` | **本机不存在**（`C:\workspace` 整个目录不存在），未取得可读副本 |
| 同目录 `REVIEW.md` | 同上，**不存在** |
| 检索范围 | `C:\workspace`、`...\宇宙智联`（递归深度 3）、`Desktop`、`Downloads`，均未发现 `DISPATCH.md` / `REVIEW.md` |
| 结论 | 不声称完整云指令已读、不声称逐项闭合；本报告仅覆盖当前明确要求，缺失细节见 §11 待裁 |

仓库与工作树：

- 基线：`origin/main = 282a20fca9f64ab80ead50372c9c3e90bf4aeba7`（fetch 前已用 `ls-remote` 核对，未前移/未分叉）。
- 本分支：`docs/git-config-deviation-evidence`，自上述 main tip 新建。
- 独立工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\git-config-evidence`（不污染调度区 `SMART-PM-H3`）。
- 全局配置写入：**零**。所有 git 命令均以逐命令 `-c safe.directory=… -c http.sslBackend=openssl` 方式执行。

---

## 2. 结论（限定表述）

1. 用户级全局配置文件 `C:\Users\Administrator\.gitconfig`（237 字节，`Created=2026-11-18T22:25:53.5019+08:00`，`LastWrite=2026-11-18T22:25:53.5243+08:00`，SHA-256 `E35ED0E3…`）当前确实含：
   - `safe.directory = *`（第 9–10 行）
   - `http.sslBackend = openssl`（第 11–12 行）
2. 写入动作可定位到执行者会话中的一条命令：`2026-11-18T22:25:53.118+08:00` 的 `git config --global --add safe.directory '*'; git config --global http.sslBackend openssl`，job `pwsh-d417d2a935f64c0e` 于 `22:25:53.675+08:00` 以 `exit code: 0` 结束；文件时间戳落在此窗口内（证据 E6、E8）。
3. **修改前值未证实**：无修改前字节级副本（无 `.bak`、无 `~`/`.orig`、无 XDG 配置、回收站与 `%TEMP%` 无副本、VSS 无读取权限、无 PSReadLine 历史）。现有最强证据为行为观察（E1、E3）与机制复现（E7），只能支持"**推断为未设置**"（推断级别 L3），**不作为已证明的原值**。
4. 因此：`safe.directory` 与 `http.sslBackend` 的"原值"一栏记为 **未证实（推断：unset）**，偏差保持 **OPEN**。

---

## 3. 当前配置快照（2026-11-19 只读复核）

| 键 | 值 | scope | origin（文件） | 行 | 与本次写入的关系 |
|---|---|---|---|---|---|
| `safe.directory` | `*`（仅 1 条） | global | `C:/Users/Administrator/.gitconfig` | 9–10 | 本次写入（E6） |
| `http.sslBackend` | `openssl` | global | `C:/Users/Administrator/.gitconfig` | 11–12 | 本次写入（E6），覆盖 system 默认 |
| `http.sslBackend` | `schannel` | system | `C:/Program Files/Git/etc/gitconfig` | — | Git for Windows 安装基线，未被改（mtime 2026-09-21） |
| `http.sslVerify` | 未设置（默认 `true`） | — | — | — | 未变，TLS 证书校验仍开启 |
| `http.sslCAInfo` / `http.sslCAPath` / `http.sslCert` | 未设置 | — | — | — | 未变；openssl 后端使用 Git 自带 CA bundle |
| `credential.helper` | `manager` | system | `C:/Program Files/Git/etc/gitconfig` | — | 未变；凭据值不展开、不输出 |

其它核对：无 `~/.config/git/config`（XDG）、无 `include`/`includeIf`、无 `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`/`GIT_SSL_BACKEND` 环境变量；local 与 worktree 作用域均未定义上述两键。system 配置文件 SHA-256 `A2B169C7…`，与安装时一致。

---

## 4. 证据清单（摘要；原文见附录）

| ID | 来源 | 时间（UTC+08） | 范围 | 摘录要点 | 键 / scope / origin / 值 | 反证与局限 | 证据哈希（SHA-256） | 推断级别 |
|---|---|---|---|---|---|---|---|---|
| E1 | DSH 会话 `session-002d5a96…` seq=27（tool/result） | 2026-11-18 22:25:03.418 | 仓库 `SMART-PM-H3` | `fatal: detected dubious ownership … owned by CodexSandboxOffline … current user Administrator` | `safe.directory` 当时无匹配项（global 未有 `*`） | 仅证明"无匹配"，不证明 global 键不存在（可能是其它值） | `E201ACD2…` | L2 行为观察 |
| E2 | 同会话 seq=32/35 | 22:25:05.346 / 22:25:06.615 | `C:\Users\Administrator\.gitconfig` | `git config --global --add safe.directory …` → `error: could not lock config file …: Permission denied` | 该次写入**未发生** | 沙箱拒绝，非文件不存在 | `0A32B7DD…` | L1 直接输出 |
| E3 | 同会话 seq=56/59 | 22:25:15.282 / 22:25:16.340 | `origin` HTTPS | `schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS` | 当时生效的 `http.sslBackend` 为 `schannel`（system 默认），**不是** `openssl` | 仅证明生效值，不区分 global 未设置 vs 显式 `schannel` | `DF31B15A…` | L2 行为观察 |
| E4 | 同会话 seq=112/115 | 22:25:43.382 / 22:25:44.859 | `origin` HTTPS | `git -c http.sslBackend=openssl ls-remote origin refs/heads/main` → `282a20f… refs/heads/main`，exit 0 | 逐命令 openssl 可用；说明写入前 global 无需为 openssl | 不涉及 global 值 | `52A2A0C8…` | L1 直接输出 |
| E5 | 同会话 seq=122–134 | 22:25:48.032–48.478 | 会话权限 | `/permission danger-full-access`（source=user）→ `approval/policy=never` → 用户消息"changed the approval policy … to never ask" | 权限翻转发生，审批关闭 | 未记录"批准写全局 Git 配置"的书面同意 | `CF8BB654…` | L1 直接输出 |
| E6 | 同会话 seq=137/139 | 22:25:53.104 / 22:25:53.675 | global 配置 | `git config --global --add safe.directory '*'; git config --global http.sslBackend openssl` → `job/settled … exit code: 0` | 两键写入；写入命令与值明确 | 会话记录由执行者同进程产生，非独立审计日志 | `E6BA2013…` | L1 直接输出 |
| E7 | 本报告复跑实验（临时文件） | 2026-11-19 | `%TEMP%` 下 `git config --file` | CASE A（已有 `[http]`）→ 段序 `http` 在 `safe` 前；CASE B（无 `[safe]`/`[http]`）→ 段序 `safe` 在 `http` 前 | 实际文件段序与 CASE B 一致 → 写入前无 `[safe]`、无 `[http]` 段 | 机制复现，非当时文件快照；依赖 git 重写算法在当前版本（2.55.0.windows.3）的行为 | `748864CE…` | L3 机制推断 |
| E8 | 本报告现场只读快照 | 2026-11-19 | 全机 global/system | `--show-origin --show-scope` 输出 + 文件元数据/哈希 | 当前值 `*` / `openssl`；文件时间与 E6 窗口吻合 | 现状快照，不回溯历史 | `AE817A39…` | L1 直接输出 |
| E9 | 执行者最终报告"未验证与边界" | 2026-11-18 22:34:34 | 执行者交付 | 自披露"全局 git 配置写入了 `safe.directory=*` 与 `http.sslBackend=openssl`" | 写入者自认 | 自述，不作为独立证据 | `766FE1B7…` | L1 直接输出（自认） |
| E10 | Codex rollout `…01a1e37a…`（派单方上下文） | 2026-11-18 22:39:21 | 派单方操作 | `git -c "safe.directory=$w" -c http.sslBackend=openssl -C $w ls-remote …` | 说明逐命令 `-c` 是派单方既有做法 | 仅证明有先例，不证明写入被授权 | `D56DF284…` | L1 直接输出 |

> 摘录哈希对象为附录围栏内的原文（UTF-8，不含围栏行）；复核方法见 §12。

---

## 5. 时间线（2026-11-18，UTC+08；毫秒取自会话事件 `time` 字段）

| 时刻 | 事件 | 证据 |
|---|---|---|
| 22:24:56.903 | 任务 A 启动（`hrun-mwm7qjwn-288c50`，deepseek-flash） | 会话元数据 |
| 22:25:03.418 | `git status/rev-parse` 报 dubious ownership（`safe.directory` 无匹配） | E1 |
| 22:25:05.346 | 两条 `git config --global --add` 被执行 → 锁文件 `Permission denied`，**未写入** | E2 |
| 22:25:08 | 模型决定改用 `GIT_CONFIG_COUNT` / `git -c` 逐命令覆盖 | 会话 reasoning |
| 22:25:15.282 | `ls-remote` 走 schannel → `SEC_E_NO_CREDENTIALS`，失败 | E3 |
| 22:25:43.382 | `git -c http.sslBackend=openssl ls-remote` 成功（main = 282a20f） | E4 |
| 22:25:48.032 | `/permission danger-full-access`（source=user）；0.2 s 后 `approval/policy=never` | E5 |
| **22:25:53.118** | `git config --global --add safe.directory '*'; git config --global http.sslBackend openssl` | E6 |
| 22:25:53.502 / .524 | `.gitconfig` 创建/最后写入（237 B） | E8 |
| 22:34:09 | 执行者复读确认 `openssl` / `*` | 会话 seq 483–485 |
| 22:34:34 | 执行者交付，自披露全局写入；未回退 | E9 |
| 2026-11-19 10:28+ | 本报告只读复核（值未变，mtime 未变） | E8 |

---

## 6. 推断级别定义

| 级别 | 含义 | 在本调查中的使用 |
|---|---|---|
| L0 | 修改前字节快照 | **不具备**（无备份/VSS/编辑器副本） |
| L1 | 命令原样输出/事件记录 | E2、E4、E5、E6、E8、E9、E10 |
| L2 | 行为观察（git 实际行为回推） | E1、E3 |
| L3 | 机制推断（git 重写语义 + 复现实验） | E7，以及"修改前为 unset"的结论 |
| L4 | 无支撑推测 | **不采用** |

关键口径：L3 只能支持"`修改前未设置`"这一**推断**；它无法排除"写入前文件曾被其它进程以相同段序重建"之类的旁路情形，故不升级为已证实。

---

## 7. 执行来源与授权链

1. 派发：Codex 会话（rollout `2026-11-16T16:30:39-01a1e37a…`）于 `14:24:56.903Z` 通过 `dsh_send` 创建任务 A，run id `hrun-mwm7qjwn-288c50`，会话 `session-002d5a96-7f5c-4452-827b-5912d8c4d1f7`。
2. 执行：deepseek-flash；任务卡原文为"**仅修改目标文档**"（设计文档 `docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md`）。
3. 权限：`22:25:48.032` 会话内 `/permission danger-full-access`（`source=user`），`approval/policy=never`；`22:25:53.118` 即发生全局配置写入（间隔 5.1 s）。
4. 合规判断：
   - 写入 `C:\Users\Administrator\.gitconfig` 超出"仅修改目标文档"范围；
   - 未发现针对"写全局 Git 配置"的专门书面批准；`/permission` 只是会话权限级别，不等价于对具体配置项变更的授权；
   - 执行者在交付中主动披露（E9），未隐瞒；派单方自身使用逐命令 `-c`（E10），说明无需全局写入即可完成同类操作。
5. 待裁：该写入应定性为"越范围环境改动"还是"获准的环境适配"，需派单方/评审方裁定（见 §10 P3）。

---

## 8. 影响评估

### 8.1 `safe.directory = *`（global）

- **作用**：对该用户所有 git 调用关闭"仓库所有权校验"（dubious ownership，CVE-2022-24765 同类防护）。
- **后果**：任何属主（含 `CodexSandboxOffline` 等其它账户）的仓库都被视为可信；外来/恶意仓库可借 hooks、`core.fsmonitor`、config 注入在管理员权限下执行代码。
- **当前项目语境**：本机 `.git` 由 `CodexSandboxOffline` 拥有，`Administrator` 运行时必然触发校验；`*` 掩盖了这一环境事实，而非修复它。
- **范围**：仅 `Administrator` 用户；system 与其它用户配置未受影响。

### 8.2 `http.sslBackend = openssl`（global，覆盖 system `schannel`）

- **作用**：该用户全部 HTTPS git 操作改用 OpenSSL 3.5.7 + Git 自带 CA bundle（`C:\Program Files\Git\mingw64\etc\ssl\certs\ca-bundle.crt`），不再使用 Windows 证书存储、企业代理注入 CA 与 schannel 吊销策略。
- **后果**：企业 CA/代理环境可能证书校验失败；信任锚与吊销语义发生变化。`http.sslVerify` 未关闭，仍校验证书链（非明文传输风险）。
- **动机与实效**：沙箱受限令牌下 schannel 无法取得凭据（E3），openssl 可正常完成 `ls-remote`/push（E4）；该键是为绕开环境限制而写入。
- **范围**：仅 `Administrator` 用户；system 仍为 `schannel`。

### 8.3 未受影响项

- 未写入 credential/token；`credential.helper=manager` 为系统既有权值，未变。
- 仓库 `.git/config`、工作树、跟踪文件、远端 refs 均未被本次调查改动。

---

## 9. 最小恢复建议（**未执行**；配置变更仍冻结）

前置：先对 `C:\Users\Administrator\.gitconfig` 做只读快照（复制为带时间戳备份），并记录 SHA-256；恢复动作需独立授权。

| 步骤 | 命令 | 预期 | 风险/前置 |
|---|---|---|---|
| R1 | `git config --global --unset http.sslBackend` | 生效值回落 system `schannel` | 沙箱内 schannel 仍报 `SEC_E_NO_CREDENTIALS` 时，相关任务须改用逐命令 `-c http.sslBackend=openssl` |
| R2 | `git config --global --unset-all safe.directory` | 无全局 `safe.directory` | 之后以 `Administrator` 操作 `CodexSandboxOffline` 拥有的仓库会再次报 dubious ownership；须改用 `-c safe.directory=<repo>` |
| R3（可选收窄） | `git config --global --add safe.directory <具体仓库路径>` | 仅放行必要仓库 | 优于 `*`；仍需批准 |
| 验证 | `git config --show-origin --show-scope --get-all safe.directory` / `--get http.sslBackend` | 均为空 | — |

不建议：将 `*` + `openssl` 作为常设全局基线长期保留（当前无任何基线记录或批准）。

---

## 10. 问题 → 位置 → 审批要求

| # | 问题 | 位置 | 审批要求 |
|---|---|---|---|
| P1 | 全局 `safe.directory=*` 关闭所有权校验 | `C:\Users\Administrator\.gitconfig` 第 9–10 行 | 原主机所有者 + 安全负责人书面批准后方可 `--unset-all`；执行前先快照 |
| P2 | 全局 `http.sslBackend=openssl` 覆盖系统 `schannel` | 同文件第 11–12 行 | 同上；或批准保留并登记为环境基线（当前无登记） |
| P3 | 危险权限切换（workspace-write → danger-full-access, policy=never）后 5.1 s 发生"仅改目标文档"范围外写入 | DSH `session-002d5a96…` seq 122–139 | 作为流程缺陷提交复审：危险权限必须与任务卡允许路径绑定，或要求显式二次确认 |
| P4 | 云指令 `DISPATCH.md` / `REVIEW.md` 不可读 | `C:\workspace\artifacts\STAGED-CARDS-REVIEW-2026-11-19\` | 提供可读副本或在卡中明确豁免；否则不得判定证据齐全 |

---

## 11. 未验证 / 待裁（不冒充一致）

1. **修改前值无字节快照**：结论为 L3 推断（unset），非已证实；偏差保持 OPEN。
2. `/permission danger-full-access` 的操作者身份（人工点击 vs 上游注入）未验证；会话仅记录 `source=user`。
3. 完整云指令/评审指令未取得（§1），若其中另有全局配置例外或豁免条款，本报告未覆盖。
4. 未查询系统还原点/卷影副本（需提权）；未检查其它主机与其它用户 profile。
5. 未验证移除全局键后各编排任务（Codex/DSH）是否回归失败——属实施，冻结中。
6. 未对 `openssl` 后端下的企业 CA 场景做连通性验证（无此类环境，且网络测试属测试范畴）。

---

## 12. 独立复核指引

1. **哈希复核**：`Get-FileHash <file> -Algorithm SHA256`；摘录哈希对象为附录围栏内原文（UTF-8，不含围栏行，行尾以仓库 blob 的 LF 为准；本机 `core.autocrlf=true`，检出可能变 CRLF，哈希前需归一化）。
2. **现状复核**（只读）：
   ```powershell
   git config --show-origin --show-scope --get-all safe.directory
   git config --show-origin --show-scope --get-all http.sslBackend
   Get-Item C:\Users\Administrator\.gitconfig | Select-Object Length,CreationTime,LastWriteTime
   ```
3. **段序实验复核**：在临时目录内用 `git config --file <tmp>` 复跑附录 E7 的两组命令，比对段序；不触碰任何真实配置。
4. **会话记录复核**：`session.v4.jsonl.zstd` 为 zstd 多帧，可按帧解压后按 `seq` 定位；载体哈希见附录 §C。
5. **禁止**：为复核而写入全局配置、push 到其它分支、或 amend/force 本分支。

---

## 13. 冻结与交接

- 本次交付仅新增文档（本文件 + 附录），未改代码、未改配置、未跑测试、未触设备/支付/业务云/部署；实施/测试/HTTP/UI/部署上线继续冻结。
- 未自批：证据链与"未证实"口径待 Codex 独立复审；复审通过前不得将"修改前值"标记为已证实，也不得宣称偏差已关闭。
- 分支：`docs/git-config-deviation-evidence`（自 `origin/main 282a20f`），普通 push；最终 commit SHA、diff 与固定 SHA 链接由交付说明给出。
