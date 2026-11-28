# Windows 原生证据接收器限定验收（2026-11-28）

验收对象为 `d196edffdb856816d1efdcf0655d98a95aa1c345`，其直接父提交为 `67ef46c3c59d09c6c899c40d4af8b8cf8b119518`。本文从验收对象建立独立文档分支 `docs/hk-face-readonly-windows-evidence-acceptance-2026-11-28`，仅新增本文，固化已经完成的独立只读复审结论。编写日期为 2026-11-28（Asia/Shanghai）；本次文档任务没有新增测试运行、源码修改、原生接收器执行或设备访问，也不替代对本文档提交的独立复审。

## 限定结论

Windows 原生证据接收器的**本机 Windows／NTFS 合成接入**限定验收通过；原1142项加新增51项、共1193项合成回归、分层故障注入及两项移除门禁负控的证据一致，未发现需要返修的问题。

该结论仅覆盖本机所测环境、合成输入、新建合成文件和假传输下的固定接收器链路；没有验收真实操作者身份、真实输入／审批、真实TLS／网络或现场门禁机。实际CLI保持 `LIVE_EXECUTION_LOCKED`，本结论不授权解锁、实机连接、人员操作、开门或E1/E2。

复审确认：

- 原生工厂只产生私有品牌句柄，构造时不读磁盘或启动进程；不接受任意hook、helper、模块路径或文件名。原生准备先于审批，审批后再检查身份、权限和成员，之后才发行既有单次令牌进入固定SDK／Host／Policy。原有同份快照、同域审批、单次消费及首错语义未放宽。
- 固定后端使用Windows PowerShell5.1 Desktop及内置 `Add-Type`，无执行策略绕过或依赖安装。协议仅open/check/write/seal/close，严格UTF-8、拒绝重复／未知字段且最多8帧；仅支持已存在本地NTFS基目录。
- 对祖先持有禁止共享删除的句柄；以已持父句柄相对 `NtCreateFile(FILE_CREATE)` 新建并同时取得目录／文件句柄，创建时设置精确当前用户＋SYSTEM的保护DACL。既存对象拒绝，不覆盖、不修ACL，不通过先创建后加权限补救。
- 持有句柄核owner/DACL、卷／文件ID、属性、链接数、大小，再只读重开路径比对身份及成员集合。固定三个角色按顺序各写一次，写后同句柄重读、flush及哈希；拒绝未知成员、重解析、链接及身份矛盾。
- seal只生成 `candidate-only`、`finalResultRequired=true` 的候选清单。关闭接受条件包含ACK、真实子进程退出0、无首错／待响应／残留输出；异常退出即使为0也不能算成功。并发写锁存首错，并发close幂等共享Promise。main候选0不能覆盖写入／flush／seal／关闭失败。

## 既有运行证据

本次文档任务不重跑。以下结果来自[实施报告](READONLY-WINDOWS-EVIDENCE-2026-11-28.md)、[使用说明](../../ADMIN-FACE-READONLY-WINDOWS-EVIDENCE.md)及本机保留的原始stdout/stderr、真实退出码、源码副本和独立复审。

原执行环境为Windows build22631.6199、DisplayVersion23H2、Node v24.16.0、Windows PowerShell5.1.22621.6133 Desktop及工具宿主PowerShell7.6.9。环境记录为2026-11-28T22:36:39+08:00；最终完整运行是22:59:49至23:01:31+08:00。这些是原运行时间，不是本文编写期间的新测试。

| 最终分组 | 原基线 | 保存的通过结果 | 原始进程退出码 |
| --- | ---: | ---: | ---: |
| admin | 802 | 853/853 | 0 |
| tenant | 6 | 6/6 | 0 |
| root | 297 | 297/297 | 0 |
| worker | 35 | 35/35 | 0 |
| worker guard selfcheck | 2 | 2/2 | 0 |
| 合计 | 1142 | 1193/1193 | 各测试组均0 |

fail、cancelled、skipped、todo均0，无超时或信号退出。原1142项的命令参数和TAP标题多重集保留，仅向admin组追加两份新测试路径；suite不计作test，聚焦是完整套件子集，不能重复加总。三项相关静态检查原结果为退出0；`verify-import` 仍为退出1的既有基线失败，未并入通过数。

新增51项＝14项工厂纯校验＋19项实际Windows合成文件的ACL／身份／生命周期＋9项编排接入＋9项分层故障注入。核心聚焦42/42，最终故障聚焦9/9。工厂纯校验不冒称文件系统操作，注入不冒称真实磁盘硬故障。

原聚焦命令分别是：

```text
node --test --test-reporter=tap admin-web/tests/face-readonly-windows-evidence.test.mjs
node --test --test-reporter=tap admin-web/tests/face-readonly-windows-evidence-faults.test.mjs
```

完整实际argv保存在原 `full-r2/summary.json` 和实施报告。测试记录器仅为子进程指定本轮合成目录，不修改用户／系统环境。

## 故障注入、原生拒绝与负控

9项注入分别覆盖WriteFile false、Flush false、seal合成敏感异常、真实关闭句柄后报告CloseHandle失败、关闭ACK后退出1、额外敏感stdout、活动假HTTP中途退出0、check无响应，以及创建时收紧当前用户权限。每次仅在新副本中改变C#一个区域，其余20份副本文件保持该阶段来源字节；受测原件未改。

前六类注入的 `mainExitCode=0`，但最终5、证据 `INCOMPLETE`，保留此前36个假HTTP。活动HTTP退出场景是main5／最终5，恰首个deviceInfo GET的一个假HTTP；子进程虽退出0仍为异常退出。check不响应为main=null、零HTTP。受限创建ACL为main=null、未审批、零HTTP并明确 `NATIVE_EVIDENCE_ACL`。所有情形均没有结算后／重放新增HTTP，公共stdio/IPC不含合成敏感reason或原始堆栈。

核心权限收紧尝试在本机被OS先阻断，不能写成已动态进入ACL不匹配拒绝分支。为补该分支，新增副本仅将当前用户FA收紧至 `0x001e01ff`（移除DELETE，保留取得句柄所需权限），SYSTEM仍FA；新目录真实创建后由句柄ACL检查拒绝，没有授宽、恢复权限或清理。故障聚焦及最终完整各保留一处受限目录的原生证据。

两项移除门禁负控单独记录：

| 负控 | 仅改变的副本文件 | 实际失败点 | 原始结果 |
| --- | --- | --- | --- |
| member-guard | `WindowsEvidence.cs` | 移除成员集合拒绝后，未知成员检查发生 `Missing expected rejection` | 1 test / 0 pass / 1 fail，退出1 |
| concurrent-latch | `face-readonly-windows-evidence.mjs` | 移除pending状态首错锁存后，`results.every(rejected)` 布尔断言失败 | 1 test / 0 pass / 1 fail，退出1 |

两份负控各22件副本，只有指定的一份改变，其余21份及受测原件字节不变。故意失败不计入1193通过数；不把失败点后的断言说成已执行，也不宣称所有门禁均完成负控。34份故障child与两项负控共36份副本集合，旧8场景及新增第9场景分别按所属阶段快照核对，不把旧字节误当最终版本。

重命名／硬链接尝试在持有句柄期间被系统阻断，只支持已覆盖的阻断事实，不冒称成功制造了替换竞态。未观察到的竞态仍不在验收结论中。

## 首轮、辅助错误及历史保留

首轮focused真实为38/39、退出1。旧readiness断言误认为owner不能读取已打开文件，导致审批回调抛错，实际 `LOCAL_FAILURE` 而非 `LOCAL_APPROVAL_DENIED`；修正为检查固定文件就绪／空字节，没有通过放宽权限或跳过断言凑绿。

该轮test、fixture和C#三路径在执行中发生变化，原before/after及日志保留，不能作为最终统一字节证据。冻结后的核心R2为42/42，但与最终字节仍有Node关闭预算收紧的差异；最终完整运行覆盖全部最新字节。

此前1192项是一次真实通过；因权限收紧被OS先阻断而追加受限创建ACL补证后，才形成最终1193项通过，未把此前通过改写成失败。

辅助盘点最初两次退出2；第一次仅固定错误类别，第二次明确 `CommandNotFoundException`。改为最小PowerShell5.1子进程环境后退出0，未改用户／系统环境。首次盘点分类校验又把8个故意既存拒绝目录混入原生创建目录而退出1，保留原校验器后修正分类。原日志及 `auxiliary-audit-notes.json` 均保留，不能把这些辅助失败隐去或冒作原生PASS。

更早首轮CLI33/34、退出1，1117首轮通过后发现readonly/list静审问题的过程，以及1122／1142和全部历史证据继续保留。`verify-import` 仍为既有退出1：`cloudfunctions/login/config.json` 实际SHA-256为 `aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`，期望为 `ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`；没有读取其配置内容或修改来源清单来凑绿。

## 字节与原始证据定位

独立复审直接核对最终40份源码的运行前后、当前及副本哈希一致；原33份只有bootstrap发生预期变化，其余32份原字节不变。实际索引及修复提交的48个blob与受测字节／文档一致，另核对38个受保护父提交blob。以下是修复对象的固定哈希，不是本文新增运行：

| 文件／对象 | SHA-256 |
| --- | --- |
| `admin-web/lib/face-readonly-local-bootstrap.mjs` | `d96a7d63574785c64b3c7c0da2977383a8488f6b390b71b30edf28d960ccbfec` |
| `admin-web/lib/face-readonly-windows-evidence.mjs` | `6fd355d3a5cf1ab09f1db79d53cbd2bc7b412ab213f3abbb9eddf3dc2cf34be0` |
| `tools/hikvision-readonly-evidence/WindowsEvidence.cs` | `d428e1b9ac7e68131c0e5b4a94c1d0b16a2612ca6d8baec9f2ba1576b8064029` |
| `tools/hikvision-readonly-evidence/Invoke-WindowsEvidence.ps1` | `6b0ee013c7d75a3cb20880f85690ba4d249a26df0aa08ff055a3b365f5c704f4` |
| 实际CLI `admin-web/face-readonly.mjs` | `a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d` |
| 原实施报告 | `978d14e0a4b1875f98714a0ad11bdff7dc29508c9057a1346494cf85fb8604ca` |

原证据根为 `D:/chatgpt/smart/FACE-READONLY-WINDOWS-EVIDENCE-20261128T223639-8f81480d`。关键相对定位：

- `focused/`、`focused-r2/`、`faults-focused/`、`faults-focused-r2/`、`full/`、`full-r2/` 中的stdout/stderr、相邻exit文件、summary及源码before/after／副本。
- `native-fixtures/` 中各阶段的原生对象、故障副本、copy-manifest／verification及child原始stdout/stderr、退出码、IPC和结果；`negative-controls/` 中两份独立副本及原日志。
- `regression-verification.json`、`log-manifest.json`、`artifact-manifest.json`、`native-object-inventory-final.json`、`auxiliary-audit-notes.json`，以及原 `git-delivery/`、`delivery-log-manifest.json` 和 `review-bundle-result.json`。

原stdout/stderr分流保存，真实退出码先保存再解析。独立复审核对124组测试原始／脱敏日志、304组Git原始／脱敏日志、26个核心工件的大小和SHA；没有仅凭summary认定通过。

原生对象盘点及现物只读核对为379个文件、122个目录：112个正常私有目录、2个仅移除DELETE的受限创建目录、8个刻意既存拒绝目录，后8个只保留原sentinel／keep文件，未被store接管或修ACL。379文件的字节／哈希／fileID／卷号／链接数和目录身份一致，4个junction未跟随；没有重新运行ACL测试或触碰旧残留。

修复复审包为 `review-bundle-d196edffdb85.zip`，5,890,918字节、2270项，SHA-256为 `1c90ba06f84d0aa048a5d9498e435ad054ebef0729cb8d936e299ec36a89351f`。独立复审已重算整包及各项SHA／CRC。原始日志和environment原件留本地，包中提供脱敏材料；ZIP不携带原NTFS ACL／fileID，不能代替本机对象与元数据证据。本机路径不是云端附件，异机须实际取件，不伪造附件ID。

原push／ls-remote真实日志支持修复对象远端SHA；这不是本文新增的远端联网核验。所有旧Git对象、工作树、源码、报告、日志、新建合成对象及新旧残留引用原样保留，不移动、覆盖、删除或清理。

## 未验边界与停止点

元数据按阶段检查，不是持续监控或永久不可变。虽然创建并取句柄的单步契约避免了先创建后打开窗口，但不能扩大为整个证据生命周期原子发布；最终检查与I/O／释放之间、释放后的修改仍有非原子边界。同SID／管理员／内核干预、崩溃／断电耐久性、其他Windows／文件系统版本通用行为均未验，JavaScript字符串不宣称可靠擦除，原Promise构造器／原型未覆盖边界继续保留。

普通命令4500ms，关闭命令2000ms加最多1500ms退出观察；外层默认5000ms仅可缩短。极短外层期限可能先返回 `INCOMPLETE`，此时未必已观察到native `closed`，不能声称释放完成。主动终止时 `native.processExit` 常为null，不能回填成0或具体非零；候选main0、seal存在、进程0均不能单独证明最终成功。

实际CLI仍不传runner且保持锁定。真实操作者身份、真实本机安全输入／审批、真实TLS／网络中止、OS信号／EPIPE、路由／VPN、现场9人及 `F03FF8DA7299CE148` 可见光入库均未验收。本结论不扩大为完整实机CLI、现场刷脸或开门，不作E1/E2、派发、生产部署或上线放行。

本文只新增文档，不重跑、不读真实凭据或照片、不连接设备、不改路由、不登记／删除人员、不开门、不处理云队列、不清理任何新旧对象。文档提交须仅新增本文，执行 `git diff --check` 及追加提交后的 `git show --check`，普通显式推送独立文档分支并用 `git ls-remote` 核对完整远端SHA；本轮真实交付证明另保存在 `D:/chatgpt/smart/FACE-READONLY-WINDOWS-EVIDENCE-ACCEPTANCE-20261128T232142-c21ada65`。完成后停手交另一独立复审，不据此解除CLI锁定或执行现场任务。
