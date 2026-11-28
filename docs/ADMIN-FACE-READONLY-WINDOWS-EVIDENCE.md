# Windows 原生证据接收器：合成接入

基于 `67ef46c3c59d09c6c899c40d4af8b8cf8b119518`，接入本机 Windows 原生证据存储；仍只用合成输入和假传输。实际 `admin-web/face-readonly.mjs` 未接线，保持 `LIVE_EXECUTION_LOCKED`。这不是现场操作者认证、真实凭据入口或实机名单复验。

## 固定装配与顺序

`createWindowsEvidenceReceiver({baseDirectory, reference?})` 创建私有品牌句柄。`baseDirectory` 为可信本机装配代码给出的已存在本地 NTFS 目录；`reference` 为受限唯一标识，省略时随机生成。工厂不读目录、不启动子进程，不接受 hook、helper、任意文件名或动态模块路径，不能通过 argv/env/JSON 解锁实际 CLI。

`createOfflineLocalBootstrap` 接受该句柄后，仍只使用原有合成输入／审批源、固定 SDK／Host／Policy 及底层假传输。原生准备发生在审批之前；审批后再检查原生状态，才发行既有授权并进入 runner。假接收器行为不变。

固定 Node 后端为 `admin-web/lib/face-readonly-windows-evidence.mjs`，只启动仓库内 `tools/hikvision-readonly-evidence/Invoke-WindowsEvidence.ps1`，使用 Windows PowerShell 5.1 Desktop、`-NoLogo -NoProfile -NonInteractive -File`，不使用执行策略绕过。脚本仅用内置 `Add-Type` 装载固定 C#；未安装运行时、依赖或服务。连接材料、照片、设备请求及云端能力不进入该后端。

## 创建即限制访问与句柄身份

后端持有已存在祖先目录的句柄，禁止共享删除；通过已持父句柄相对调用 `NtCreateFile(FILE_CREATE)`，在新建目录／文件的同时获得句柄并指定受保护 DACL。仅允许当前用户和 SYSTEM 的显式完全控制，不继承其他 ACE，不事后修 ACL，不覆盖旧对象。若当前环境不支持该原生契约则失败，不降级为先创建后加权限。

目录创建使用 `FILE_DIRECTORY_FILE`，通过 `OBJ_DONT_REPARSE` 拒绝重解析。仅固定本地 NTFS，拒绝 UNC、设备路径、路径穿越、ADS、DOS 保留名和超长输入。新增目录／数据文件不共享写入或删除。

每个证据阶段由持有句柄检查 owner/DACL、卷与文件 ID、重解析属性、文件类型、链接数及预期大小，再以路径只读重开对照同一 ID。目录成员集合必须恰为本阶段已创建的固定文件。写后由同一数据句柄重读核对内容；不把一次路径 `Get-Acl` 或仅 `CreateNew` 当作身份及 ACL 证明。

固定文件为 `stdout.jsonl`、`stderr.txt`、`main-exit.txt`，按角色顺序各写一次。最后一个只接受 0/2/4/5 加 LF。写入使用严格 UTF-8；没有任意文件写入口。

## seal、close 与首错

`seal` 要求三个角色齐全，flush 并从持有句柄验证内容哈希，再创建同样私有的 `candidate-seal.json`。其 `kind=candidate-only`、`finalResultRequired=true`，只列相对角色、大小和 SHA；它不宣告最终成功，不含 SID、账号、路径或连接材料。

`close` 再核身份、权限、内容与 flush，逐一尝试关闭所有句柄；不删除任何文件或目录。Node 必须同时观察关闭 ACK、真实进程退出 0、无残留输出／待响应及无首错，才能接受这一关闭结果。并发 close 共享同一个 Promise；非法状态、并发写入和乱序持续锁存首错。

后端的意外退出、stderr、协议异常、超时会触发原编排器取消及首错；不向公共输出复制原始异常文本。写入／flush／seal／close 失败即使发生在 main 候选 0 之后，最终也非零、证据 `INCOMPLETE`。旧记录、失败引用及部分文件保留，不重试或自动清理。

普通命令等待上限 4500ms，关闭命令等待 2000ms，加最多 1500ms 的退出观察；外层原默认 I/O 门禁仍为 5000ms，且只许缩短。若调用方选择极短期限，外层可能先返回 `INCOMPLETE`，此时不能声称已观察 native `closed`；后端仍有自己的终止预算。没有收到关闭及进程完成证据，不标为完整。

`inspectWindowsEvidenceReceiver` 仅返回既有安全记录投影与 native 固定状态／错误类别，不返回目录、SID 或凭据。`mainExitCode` 仍是候选；最终 `exitCode` 和证据完整性共同决定是否完成。

## 验证与保留边界

新增测试分为工厂纯校验、实际 Windows 合成文件的 ACL／身份／生命周期、真实编排链加假传输，以及新副本中的明确故障注入。注入不等于遇到真实磁盘硬故障；重命名／硬链接尝试被系统阻断也不写成已成功制造替换竞态。实际计数、首轮失败、负控、日志与前后哈希见[实施报告](evidence/hk-face-management/READONLY-WINDOWS-EVIDENCE-2026-11-28.md)。

本轮不读取已有残留或修复其权限；只对新建合成对象操作，并保留成功、失败及负控对象。没有删除代码、宽权限修复、管理员提权或策略绕过。

同 SID／管理员／内核篡改、最终检查与 I/O／释放句柄之间的非原子窗口、释放后的对象修改、崩溃／断电耐久性均不属于已证明保证。元数据只按阶段检查，不能声称持续监控或永久不可变；原生 API 和文件系统契约也不扩大为所有 Windows／文件系统版本通用通过。JavaScript 字符串不宣称可靠擦除。原 Promise 构造器／原型未覆盖边界继续保留。

真实本机输入／审批、真实 TLS／网络中止、现场 9 人及 `F03FF8DA7299CE148` 可见光入库仍未验收。本次不解锁 CLI、不连接设备、不改路由、不登记／删除人员、不开门、不运行或放行 E1/E2、派发、部署或上线。提交推送核对远端 SHA 后停手交独立复审。

原生接口依据：[NtCreateFile](https://learn.microsoft.com/windows/win32/api/winternl/nf-winternl-ntcreatefile)、[GetSecurityInfo](https://learn.microsoft.com/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo)、[安全描述符格式](https://learn.microsoft.com/en-us/windows/win32/secauthz/absolute-and-self-relative-security-descriptors)。这些是接口契约来源，不替代本机运行证据。
