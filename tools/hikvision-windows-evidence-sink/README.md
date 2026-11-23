# HK-AI-08 Windows 原生证据写入离线接入

固定起点：`174d666bc1744d9dcda1d0f321571038af6bf2a4`。本阶段仅用合成字节、原已审私有绑定及品牌假传输，新增受控 Windows 证据写入能力。原八 API、离线十一 API 及其 140＋264 测试保留；本工具不运行原 CLI/runProbe、设备请求或 E1/E2，不读取真实配置/凭据。

**保留策略：所有新旧目录、文件、负控对象、报告、日志和可控编译工件都保留。没有删除/清理入口，cleanup=NOT_EXECUTED。关闭本工具自有句柄/worker 不等于删除磁盘对象。** 不调用旧启动器的成功清理路径。

## 1. 结构与私有绑定

`src/entry.mjs` 导出 `createSyntheticWindowsEvidenceEntry(context)`，在 bridge 的独立 Windows 模式中复用同一实例的 private prepare/snapshot/projection/bindings/permits，而非桥外重建配置。context 形状沿用原桥；Windows 模式的 output.policyRef 必须为 `synthetic-windows-handle-acl-v1`，rootRef 仍是合成逻辑引用，不能代替原生目录身份。

`prepareWindowsBytes` 只接受原有闭式合成 byte 数组契约。验证配置后，通过内建 broker 新建并核对原生根；在 binding 对外返回/permit 签发前，把原生 capability 不可重定向地私有关联到同一 snapshot 的 binding。异步创建期间 epoch/cancel/context 变化立即拒绝，已创建对象保留。原始 allowRead=true 仍被拒绝，执行视图保持 false。

原生 capability 为空、null 原型、冻结句柄，由 broker 私有 WeakMap 品牌识别，不含路径、SID、文件 ID 或进程引用。公共入口不接 capability/path/callback 覆盖；内部 broker 不是设备授权机构，也不构成对恶意同进程代码的隔离沙箱。

Windows API 精确为十一项：

- `prepareWindowsBytes(bytes)`（async）：结果含 binding/configBindingRef/checker/native；失败前三项为 null。未进入原生阶段时 native=null，部分创建/阻断时保留 native 状态及引用。
- `createFakeTransport({expected,responses})`：沿用已审闭式假传输；不是任意回调或真实 HTTP。
- `issueWindowsPermit(binding,grant)`（async）：实际验证原生根，再复查控制门禁，才签发原合成单次 token；结果含 token/native，失败 token=null。
- `executeWindows(binding,token,fakeTransport)`（async）：没有输出覆盖参数；结果含 configBindingRef/summary/native。真实等待原生写入、flush、回读、ACL/身份复核与最终控制门禁后才可 PASS。
- `closeWindowsBinding(binding)`（async）：先禁止进一步使用，再关闭自有句柄/worker，保留所有对象；结果含 native，不恢复许可。
- `observeWindows(binding)`：同步只返回已有 native 状态；不重读路径或发 RPC。native 观察另含 busy 和 operation（idle/validate/write/close）。
- `revokeSyntheticPermit`、`advanceSyntheticTime`、`replaceSyntheticRuntime`、`cancelSyntheticBinding`、`observeTransport`：原合成控制面及闭式观察，Windows scope 一致。

结果统一 scope=`synthetic-windows-evidence-sink-only`，成功 PASS/OK，能力不足 BLOCKED/固定 code，操作或断言失败 FAIL/固定 code。无效 context 或构造时错误 native policy 抛固定 SYNTHETIC_CONTEXT_INVALID；其余不输出输入/异常原文。replaceSyntheticRuntime 仍允许合法合成 context 并递增 epoch，使旧绑定失效；后续 prepare 若不是固定 native policy 则 NATIVE_POLICY_UNSUPPORTED，不启动 broker。已关闭 binding 的 issue/execute 为 NATIVE_BINDING_CLOSED；close 幂等缓存首次结果，失败不自行重试。summary 沿用已审闭式 schema/phase，native 单独记录实际磁盘结果；合成许可/时间仍不等于真实审批与时钟服务。

## 2. 内建 broker 与运行时

`src/native-broker.mjs` 的内部接口为 createNativeEvidenceBroker、validateNativeEvidence、writeNativeEvidence、closeNativeEvidence、observeNativeEvidence，全部通过私有品牌能力操作。`NativeEvidence.psm1` 为 host/原生测试共用的编译与类型初始化模块。broker 只启动已安装的 `powershell.exe -NoLogo -NoProfile -NonInteractive -File` 固定 host，stdin/stdout 为有界闭式 JSON RPC，无 socket/监听。不得把私有配置、许可或凭据通过 argv/environment 传递；argv/初始 RPC 只允许固定协议的非敏感随机引用。

broker 在启动前生成 hk-win-sink-32hex 与 hk-win-compile-32hex 引用，并先 CreateNew 持久化仓库外 `<compilerRef>.launch.json`；原生 PS 测试也在编译/每次创建前 flush `<compilerRef>.fixtures.jsonl`。这些只记录已分配引用，不证明目录已创建，用于异常终止后的保全。host 按内置位置选择本机当前用户 LocalApplicationData 的固定本地 NTFS，不接受任意路径/旧引用；实际初始卷句柄另核对 NTFS 与持久 ACL 能力。compiler 工件留在仓库外本轮随机目录，CodeDOM 明确 GenerateInMemory/KeepFiles，不安装编译器或运行时。只编译读取的固定源码字节，记录源码哈希。安全策略、签名或编译能力阻止时 BLOCKED，不 Bypass、不 Unblock、不提权、不改全局策略。

native 记录精确字段：status/code/evidenceRef/compilerRef/checks/counts/newObjectStateUnverified/retained/closed；create 内部另有 capability（不对公共入口外泄）。retained 固定 true；closed 只说明自有 worker/句柄结束，不证明对象事后状态。丢失响应、部分创建或无法确认终止必须记录不确定状态并停止，不能由零完成量推断没有对象。观察另含 busy/operation，不发文件系统调用。

每个 worker 的 stdout/stderr 在解析前有界保留原始 bytes，并在确认退出后以 CreateNew 保存到该次 compilerRef 目录的 host.stdout.raw、host.stderr.raw、host.exitcode.txt、host-pipes.metadata.json；超限/日志失败或正常 close 后非零退出均失败，不宣称原始流完整。日志目录不是原生证据根，不据其权限声明设备原始资料保护；潜在个人路径只保留本机原件，提交仅含脱敏定位及哈希。关闭时还验证 UTF-8 decoder 完整结束及无未完成 JSON 行。

checks 固定十三项：platformSupported、identitySupported、locationSupported、ancestorHandlesHeld、rootCreatedExclusive、rootAclValid、nativeIdentityValid、rootEntriesValid、filesCreatedExclusive、fileAclsValid、contentVerified、flushVerified、deleteSharingDenied。open/validate 只完成相应根门禁，未执行文件检查保持 false；只有完整 write 成功才能要求十三项全 true。counts 固定六项：directoriesCreated、filesCreated、bytesWritten、bytesVerified、flushes、validationCalls；创建/写入后立即记录实际量，失败不抹除。

## 3. 原生门禁

1. 真实 Windows、Windows PowerShell 5.1 Desktop、非管理员用户、已有 .NET/Node、本地固定 NTFS。当前用户 SID 只由 WindowsIdentity 本地取得用于比较，不输出。能力不可用即 BLOCKED，不使用 POSIX/chmod/stat 降级替代。
2. 持有卷根及逐级祖先目录句柄，采用相对父句柄打开、拒绝重解析/卷变化并复核身份，明确不共享删除的生命周期。不能先按完整后代路径穿越后再补查，也不能以创建时间证明身份。
3. 在已持有父句柄下，以原子 FILE_CREATE 创建随机新根；若存在即失败，不复用、不递归 mkdir。创建时附当前用户为所有者、受保护/规范/非空、仅当前用户和 SYSTEM 两条 FullControl、向子项继承的 DACL，不先宽建后修。
4. 从持有句柄读取原生卷序列与 128 位文件 ID、文件属性/链接状态及 owner/raw DACL。逐条校验所有 ACE，不过滤未知类型；根 flags=3、文件自然继承 flags=16、mask=2032127，文件 DACL 不受保护、无多余 ACE。不得让输入自报快照/ID 代替原生读取。
5. 固定两文件名 synthetic-response.json 与 summary.json，相对根句柄 FILE_CREATE、非目录、单链接、独占持有；不可覆盖、追加或接受 ADS/相对逃逸/外部路径。文件自然继承原两 ACE，不重设文件 ACL 制造通过。
6. 同一文件句柄完成有界 WriteFile、FlushFileBuffers、回到起点回读及内容核对；在创建、写入、flush/回读、关闭等阶段复查身份与 ACL。目录项通过根句柄有界枚举，仅允许本轮已知集合；未知项不递归访问或删除。关闭后的路径观察不替代全程句柄绑定。
7. 新根须在首个假调用前验证，permit 在首 await 前消费；每次假调用及原生 await 返回后复查撤销/epoch/取消/合成窗口。原生写入在途取消可能已经产生零、部分或完整文件；最终必须失败并保留实际量，不能宣称回滚或即时中断。

summary.json 包装为 recordType=pre-final-output-summary、notFinalAcceptance=true、summary=闭式会话摘要。写入后最终控制门禁可能失败，该磁盘摘要不等于最终验收；不覆盖文件补写 PASS。synthetic-response.json 也只包含固定合成标记，不保存配置/认证材料或真实响应。

## 4. 测试与结果分层

原 140＋264 测试文件不改，必须在本轮源码上重新实际回归。新增 JS 测试验证新入口、实际 native capability 和异步完成门禁；新增 PS5.1 用例调用相同原生核心，分别记录真实 NTFS、内存策略与受控故障注入。必要原生能力缺失时总体 BLOCKED、退出码非零，依赖用例 NOT_EXECUTED，不能跳过后打印 PASS。

新增用例包括原子创建/重名拒绝、CreateNew 不覆盖、持有句柄的 delete-access-open 拒绝（不执行删除）、实际 ID 不同的拒绝、ACL 收紧后拒绝、未知子项、重解析/多链接拒绝（如能力允许，缺失明确 BLOCKED/NOT_EXECUTED）、部分写入、flush/回读失败、伪造/跨绑定能力、输出前及原生 await 期间撤销/取消、失败不恢复许可。宽 ACL 仅内存负控，磁盘负控不扩权。所有测试对象留存，只关闭自身句柄。

root-collision 仅对本用例刚创建的同一新引用再次 FILE_CREATE，要求零新增且原句柄身份/ACL/内容未变；不拿旧残留作输入。硬链接负控的 filesCreated=2 表示两个目录项、同一个文件身份，不是两个独立文件对象。wrong-id 是两个实际原生 ID 的比较负控，delete-access 是拒绝请求 DELETE 权限的打开，均不冒称已完成恶意替换/真实删除实验。flush-error 与内容差异等受控注入另列，不冒充实际存储设备故障。

测试输出含实际 planned/executed/passed/failed/blocked/notExecuted、case ID/固定错误类别及新引用；不输出真实 SID、账号、个人绝对路径、卷/文件 ID 或异常原文。原始 stdout/stderr、独立 ExitCode、源码前后哈希及 compiler/evidence 引用留本机；报告引用脱敏副本和哈希，不改任何历史记录。

本阶段仅覆盖 FT-01～FT-03及 FT-04 的停止保全部分，cleanup=NOT_EXECUTED，不验收清理能力。不承诺 Windows/POSIX 全场景等价或消除恶意同用户、SYSTEM、管理员并发/事后修改；代码来源哈希也不原子固定整个运行时。真实配置来源、审批/凭据租约/真实时钟、原始响应与认证适配、TLS pin-before-send、DNS/peer、网络 deadline 和完整 CLI 仍未验证。只用假传输，不连接设备或运行 E1/E2；用户已取消隔离网络前置的决定不变。

## 5. API 资料与交付

开发阶段只读核对 Microsoft 官方资料，不能把文档语义当成本机实测通过：

- [NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile) 与 [OBJECT_ATTRIBUTES](https://learn.microsoft.com/en-us/windows/win32/api/ntdef/ns-ntdef-_object_attributes)：相对根句柄与 FILE_CREATE 拒绝既有对象。
- [FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)：结合卷标识与文件标识比较打开对象；仍以本机支持情况为能力门禁。
- [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo) 与 [NtQueryDirectoryFile](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntquerydirectoryfile)：从句柄读取安全描述符及目录项。

完成独立分支追加提交、普通显式 refspec 推送并核对远端完整 SHA 后停止，交独立复审。不合并、部署、上线，不作 E1 放行；任何 BLOCKED/FAIL/未知均如实保留，不放宽门禁或自行换方案凑 PASS。
