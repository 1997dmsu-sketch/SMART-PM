# Windows 原生证据接收器：合成接入实施报告（2026-11-28）

本次作为实施方执行，交另一独立 Codex 复审，不自行宣布实机或 E1/E2 放行。固定直接父提交为 `67ef46c3c59d09c6c899c40d4af8b8cf8b119518`，独立分支 `feat/hk-face-readonly-windows-evidence-2026-11-28`。旧工作树未切换或清理；全部旧对象、报告、日志和新旧残留引用保留。

## 环境、时间与范围

本机 Windows build 22631.6199、DisplayVersion 23H2（注册表 ProductName 原文 Windows 10 Home China），Node v24.16.0，Windows PowerShell 5.1.22621.6133 Desktop，执行工具宿主 PowerShell 7.6.9。环境记录时间 2026-11-28T22:36:39+08:00，Asia/Shanghai。未安装、升级运行时或依赖，未绕过执行策略或申请管理员提权。

最终完整运行 2026-11-28T22:59:49+08:00 至 2026-11-28T23:01:31+08:00；其他阶段见下表及各 summary。控制元数据 UTC Z 与本地 +08:00 区分，未回填旧时间。证据根为本机独立目录 `D:/chatgpt/smart/FACE-READONLY-WINDOWS-EVIDENCE-20261128T223639-8f81480d`，下文工件名相对此根。本机路径不是云端附件，异机复审须实际取件。

本次仅修改既有 `admin-web/lib/face-readonly-local-bootstrap.mjs`；新增原生 Node 后端、固定 PS5.1/C# helper、两份测试及两份测试 fixture、[使用说明](../../ADMIN-FACE-READONLY-WINDOWS-EVIDENCE.md)和本报告，共10个Git路径。实际CLI、SDK、Host、Policy、旧测试、旧报告、依赖与连接配置均未改。旧登记 PowerShell 包装器未启动或复用为只读入口。

## 实现与门禁

原生接收器是不可序列化的私有品牌，只有可信代码可装配；没有 argv/env/JSON 解锁、任意 hook/helper/module/文件名入口。工厂不读磁盘或启动进程，原生 open 在审批前准备，审批成功后再 check 身份／权限／成员，之后才发行原受控令牌进入固定 SDK/Host/Policy。实际 CLI 仍 LIVE_EXECUTION_LOCKED。

固定 Windows PowerShell5.1 Desktop 子进程通过 `-NoLogo -NoProfile -NonInteractive -File` 执行内置 Add-Type；仅固定 JSON-lines 协议 open/check/write/seal/close，严格 UTF-8、拒重复／未知字段、最多8帧。base须已存在本地NTFS，拒绝UNC、设备路径、ADS、路径穿越、重解析及保留名称。没有回退、删除、覆盖、ACL修复或宽权限操作。

后端先持有祖先句柄（共享读写、禁止共享删除），再以已持父句柄相对 NtCreateFile(FILE_CREATE) 原子新建目录／文件并取得句柄。创建时设置受保护DACL，恰当前用户和SYSTEM的显式完全控制；不以“先创建再Set-Acl”补权限。OBJ_DONT_REPARSE、目录选项组合及NTFS限定失败即停。

按句柄 GetSecurityInfo 核 owner/DACL；按同一持有句柄核卷ID、fileID、类型、重解析、链接数和大小，再以路径只读重开核同一身份。每阶段核目录成员集合，写后同句柄重读与预期UTF-8字节比较；最后flush/hash。固定角色仅stdout.jsonl、stderr.txt、main-exit.txt，顺序固定各一次，exit仅0/2/4/5加LF。

seal生成candidate-seal.json，明确candidate-only、finalResultRequired=true，不宣告最终成功。close再验证并尝试释放所有句柄，Node同时等待ACK、真实进程退出0、无首错／待响应／残留输出，才接受关闭。非法状态／并发写永久锁存首错；并发close共享Promise。后端意外退出、stderr、协议、超时会触发既有取消链，main候选0不能压过收尾失败。

普通协议等待4500ms，close命令2000ms加最多1500ms退出观察；原外层默认5000ms仅可缩短。调用方极短ioTimeout可先返回INCOMPLETE，不能声称此刻已观察native closed；后端仍有终止预算。主动kill时native.processExit常为null且closed=true，不把null回填为退出0或某个非零数。

## 原始结果与首轮失败保留

| 阶段 | tests | pass | fail | 测试组退出码 | 性质 |
|---|---|---|---|---|---|
| focused | 39 | 38 | 1 | 1 | 初轮混合字节，非最终 |
| focused-r2 | 42 | 42 | 0 | 0 | 核心冻结阶段 |
| faults-focused | 8 | 8 | 0 | 0 | 8项分层注入 |
| full | 1192 | 1192 | 0 | 0/0/0/0/0 | 追加ACL补证前的完整回归 |
| faults-focused-r2 | 9 | 9 | 0 | 0 | 最终9项注入 |
| full-r2 | 1193 | 1193 | 0 | 0/0/0/0/0 | 最终完整回归 |

首轮focused真实为38/39、退出1；旧readiness断言误以为当前owner不能读取已打开的文件，导致审批回调抛错，实际LOCAL_FAILURE而非预期LOCAL_APPROVAL_DENIED。shareRead允许owner读，不能把owner读取误当越权。修正为核固定文件就绪／空字节；没有跳过失败断言或修改生产权限来凑绿。

这一轮另有三路径在执行期间变化：`admin-web/tests/face-readonly-windows-evidence.test.mjs`、`admin-web/tests/fixtures/face-readonly-windows-evidence-synthetic.mjs`、`tools/hikvision-readonly-evidence/WindowsEvidence.cs`。before/after及原始日志完整保留，明确不是最终统一字节证据。随后先冻结再运行：核心42项通过。该核心R2与最终字节仅Node后端关闭预算收紧不同，不虚称它已经覆盖最终全部字节；最终full-r2重新覆盖全部用例。

第一次完整1192项为真实通过，后续因ACL收紧尝试实际被OS先阻断，追加第9项创建时受限ACL用例，而非把旧通过改写为失败。最后完整回归为 **1142＋51＝1193**，各组退出0、fail/cancelled/skipped/todo均0。聚焦是完整套件子集，不能重复加总，suite不计作test。

| 最终组 | tests | pass | 退出码 |
|---|---|---|---|
| admin-final | 853 | 853 | 0 |
| tenant-final | 6 | 6 | 0 |
| root-final | 297 | 297 | 0 |
| worker-final | 35 | 35 | 0 |
| worker-guard-selfcheck-final | 2 | 2 | 0 |
| check-miniprogram-final | N/A | N/A | 0 |
| checkin-face-static-final | N/A | N/A | 0 |
| verify-face-sources-final | N/A | N/A | 0 |
| verify-import-final | N/A | N/A | 1 |

三项静态检查原始退出0。verify-import仍退出1的既有来源基线失败，不计入通过数，不改其配置内容或来源清单：cloudfunctions/login/config.json实际SHA256 aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6，期望 ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8。

## 新增51项与分层性质

- 核心42项＝14项工厂／输入纯校验＋19项实际Windows合成文件的ACL／句柄／身份／生命周期＋9项编排接入。纯工厂校验不冒称原生文件系统操作。
- 文件成功用例独立以PS5.1 Get-Acl检查owner/protected/exact2规则，并对实际文件ID、字节、nlink及候选seal哈希核对。重命名／硬链接在持有句柄期间被系统阻断，不写成已成功替换竞态。
- 预存在目标和未知成员保留；审批前原生失败／审批后新增未知成员／证书预检失败／预取消均无后续假HTTP或零HTTP，按真实阶段区分。成功全链为36个假HTTP、实际文件落盘、原NOT_EXECUTED现场标记；上下文和同receiver均不能重放。
- 9项分层注入只在新artifact-copy改C#一处，未修改受测原件：WriteFile false、Flush false、seal合成敏感异常、CloseHandle真实关闭后报告失败、关闭ACK后exit1、额外敏感stdout、活动假HTTP中途exit0、check无响应，以及创建时仅移除当前用户DELETE权限的受限ACL。它们不是实际磁盘硬故障。

前6种注入mainExitCode=0、最终5、已有36假HTTP、证据INCOMPLETE；活动HTTP退出为main5/final5、恰首deviceInfo GET一个假HTTP，native虽exit0仍是异常退出；check无响应为main=null、零HTTP；受限创建ACL为main=null、零HTTP、未审批且native明确NATIVE_EVIDENCE_ACL。所有情形均无结算后／重放新增HTTP，原始敏感reason未越过公共stdio/IPC，后端细节不回显。

核心“收紧既有新文件ACL”是条件用例。事后只读盘点未发现其deny ACE持续存在，支持本机走OS先阻断分支，不能把它算作已动态触达ACL不匹配检查。因此追加受限创建ACL：副本仅把当前用户FA收紧至0x001e01ff（移除DELETE，保留取得新句柄所需权限），SYSTEM仍FA。实际新目录创建成功后由GetSecurityInfo检查拒绝，两个冻结阶段的受限目录元数据均保留；没有授宽、恢复ACL或清理。

## 两项移除门禁负控

| 负控 | 仅变更副本文件 | tests/pass/fail | 退出码 |
|---|---|---|---|
| member-guard | WindowsEvidence.cs | 1/0/1 | 1 |
| concurrent-latch | face-readonly-windows-evidence.mjs | 1/0/1 | 1 |

各副本22件，仅一个指定文件退化，原件及其余21件字节不变。member-guard移除成员集合拒绝，新增未知成员用例实际失败于Missing expected rejection；concurrent-latch移除pending状态首错锁存，实际失败于results.every(rejected)布尔断言。故意失败不计入1193通过数，不把失败点后的断言称已执行。

## 工件盘点与辅助错误

native-object-inventory-final.json只读观察本轮新对象：379个原生数据／候选文件、122个SYNTHETIC目录，4个junction未跟随。379文件均exactPrivate；目录中112个正常私有、2个创建时故意收紧、8个为刻意预存在的拒绝目标（没有被store接管或修ACL）。文件ID、卷号、大小、SHA及ACL布尔投影均保留，不输出SID或账号。

辅助盘点最初两次exit2，第二次分类为CommandNotFoundException；改为与正式夹具一致的最小PS5.1子进程环境后exit0，没有修改用户／系统环境。首次盘点分类校验又把8个故意既存拒绝目录混入native创建目录而exit1，保留原校验器后更正分类。auxiliary-audit-notes.json记录这些辅助错误；它们没有改动产品源码或正式测试结果，不能隐去或充当原生PASS。

## 源码前后字节与原始日志

最终full-r2选定40源码：before/after、当前文件、源码副本一致；原33份仅bootstrap改变，其余32份原字节不变，新增7源码。最终9项故障聚焦的40份字节也与最终完整回归一致。下表最后列同时为最终执行前／后SHA。

| 源码 | 固定父提交SHA-256 | 最终前后SHA-256 |
|---|---|---|
| `admin-web/lib/hikvision-client.mjs` | `d79ef3ba00914d4bc551ab363315f6fdb183da44088577fe14c1902786e76001` | `d79ef3ba00914d4bc551ab363315f6fdb183da44088577fe14c1902786e76001` |
| `admin-web/lib/face-enrollment.mjs` | `789e1fa39a7a01cce1d363f16f0ec4eb3107c3833f9063136b0d6a78acf128be` | `789e1fa39a7a01cce1d363f16f0ec4eb3107c3833f9063136b0d6a78acf128be` |
| `admin-web/server.mjs` | `0b4c999ee71b151efc85b6d14777d093350e034caa63c7eed017cb448878a763` | `0b4c999ee71b151efc85b6d14777d093350e034caa63c7eed017cb448878a763` |
| `admin-web/public/face-ui.js` | `43d954d22fe3ad5498764e1991b9574d04e1521542a9cdb346041c8ae1ae31fd` | `43d954d22fe3ad5498764e1991b9574d04e1521542a9cdb346041c8ae1ae31fd` |
| `admin-web/public/style.css` | `0ecea30847c15a225a62292391a31b5292963c72b2b47799fa97a540779d2a3d` | `0ecea30847c15a225a62292391a31b5292963c72b2b47799fa97a540779d2a3d` |
| `admin-web/tests/face-management.test.mjs` | `bf38ee5bd1ebffff67b892f7e15e63a28594c59a46dcbe6e56549a1dd979f286` | `bf38ee5bd1ebffff67b892f7e15e63a28594c59a46dcbe6e56549a1dd979f286` |
| `admin-web/tests/face-management-ui.test.mjs` | `a813242ab62aa7298ba6bc29fee87b42a626bf820bdcd2c95aa7e255d276e3af` | `a813242ab62aa7298ba6bc29fee87b42a626bf820bdcd2c95aa7e255d276e3af` |
| `admin-web/tests/face-server.test.mjs` | `94b3a329e913f92425f0ee23a13704b567bd591f8e72113e5556ae65d751a224` | `94b3a329e913f92425f0ee23a13704b567bd591f8e72113e5556ae65d751a224` |
| `docs/checkin-face-experience-source-hashes.json` | `d01eb1ff12c4a921dd420047d52a215a19d16ec04a4814a2f27e8c665b5dde7c` | `d01eb1ff12c4a921dd420047d52a215a19d16ec04a4814a2f27e8c665b5dde7c` |
| `admin-web/lib/face-access-plan.mjs` | `f3962e72a15c55512aea5b7a87d0465d37b1142218a82138c01635c41656c9f1` | `f3962e72a15c55512aea5b7a87d0465d37b1142218a82138c01635c41656c9f1` |
| `admin-web/lib/face-readonly-host.mjs` | `4a9365370607cc246c600351a0dd4e9c293728fbbcd035f587b356bc0976f20d` | `4a9365370607cc246c600351a0dd4e9c293728fbbcd035f587b356bc0976f20d` |
| `admin-web/lib/face-readonly-policy.mjs` | `e24a109d1948bbe6b289eb27b1f03b111deb37639f207c895ae6cc9aa23e4086` | `e24a109d1948bbe6b289eb27b1f03b111deb37639f207c895ae6cc9aa23e4086` |
| `admin-web/tests/face-readonly-host.test.mjs` | `d3cbd900cbd03c8e469bbff636a5e48aeaf171449f576e75e5acfb0cb1e6f112` | `d3cbd900cbd03c8e469bbff636a5e48aeaf171449f576e75e5acfb0cb1e6f112` |
| `admin-web/tests/face-readonly-policy.test.mjs` | `89dd1e481065849b6afd5fff6d08938a06f26542f2ad2a13f83813a5ebc72277` | `89dd1e481065849b6afd5fff6d08938a06f26542f2ad2a13f83813a5ebc72277` |
| `admin-web/tests/fixtures/face-readonly-fake-transport.mjs` | `2c6c55ed2ee7e7b4abb43e08b407f1b777e3f77e8253bee5b439f25aee27451a` | `2c6c55ed2ee7e7b4abb43e08b407f1b777e3f77e8253bee5b439f25aee27451a` |
| `admin-web/face-readonly.mjs` | `a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d` | `a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d` |
| `admin-web/lib/face-readonly-command.mjs` | `0217c79857b055f8485ec0631c2ab03b48e03d18e8d86f5b529d53f1fdb28e35` | `0217c79857b055f8485ec0631c2ab03b48e03d18e8d86f5b529d53f1fdb28e35` |
| `admin-web/tests/face-readonly-cli.test.mjs` | `42b3c01a0e219522ecb61733339fd2e5e3b0a65abedc1b8b5aab42f7dd953ca3` | `42b3c01a0e219522ecb61733339fd2e5e3b0a65abedc1b8b5aab42f7dd953ca3` |
| `admin-web/tests/fixtures/face-readonly-cli-child.mjs` | `ebf4f8e064cbc8bc9edb6005269afffd13878b975ab902359c1ec1345d63b600` | `ebf4f8e064cbc8bc9edb6005269afffd13878b975ab902359c1ec1345d63b600` |
| `admin-web/tests/fixtures/face-readonly-cli-network-guard.mjs` | `170fecbf6df460f11141b5f735737ccea1f58850b210bf77f43e8826d50dd6fc` | `170fecbf6df460f11141b5f735737ccea1f58850b210bf77f43e8826d50dd6fc` |
| `admin-web/tests/fixtures/face-readonly-cli-synthetic-adapter.mjs` | `9ee6d4d96cfb18c5f521265f339e390a89bd10368c88b13b9d83c1c3af1b42c2` | `9ee6d4d96cfb18c5f521265f339e390a89bd10368c88b13b9d83c1c3af1b42c2` |
| `admin-web/tests/fixtures/face-readonly-cli-synthetic-input.mjs` | `3d248af179c5cc6c1fdb8764cbde9a9b36bfdfba30d911dbe4a86d19831cdf03` | `3d248af179c5cc6c1fdb8764cbde9a9b36bfdfba30d911dbe4a86d19831cdf03` |
| `admin-web/lib/face-readonly-session.mjs` | `076e4b13629ff69290bdd31b00ae30575a35df18f61692ed36503e3d1417ad4d` | `076e4b13629ff69290bdd31b00ae30575a35df18f61692ed36503e3d1417ad4d` |
| `admin-web/tests/face-readonly-session.test.mjs` | `71adf8fcee97941f41fdb13441680196aa157a1af26a0a3de1ed308fccfa89ce` | `71adf8fcee97941f41fdb13441680196aa157a1af26a0a3de1ed308fccfa89ce` |
| `admin-web/tests/fixtures/face-readonly-session-child.mjs` | `dd353ec9cfcf76d83f7d528a063e40095a9f87a66be2813792a64f24fd07323e` | `dd353ec9cfcf76d83f7d528a063e40095a9f87a66be2813792a64f24fd07323e` |
| `admin-web/tests/fixtures/face-readonly-session-network-guard.mjs` | `f1073e115563fb420ca5c242e16d0eb544d9739ade2a545c31bbcdeb2c86085d` | `f1073e115563fb420ca5c242e16d0eb544d9739ade2a545c31bbcdeb2c86085d` |
| `admin-web/tests/fixtures/face-readonly-session-synthetic.mjs` | `74d4b2493de7b88cf4502415ff084325bf8f582e9f10440b42a3a89f7a9eca07` | `74d4b2493de7b88cf4502415ff084325bf8f582e9f10440b42a3a89f7a9eca07` |
| `admin-web/lib/face-readonly-local-bootstrap.mjs` | `18fb339670371ff5a25e608ce5133e998cb7af5a4f7409657e7883d9713f49b8` | `d96a7d63574785c64b3c7c0da2977383a8488f6b390b71b30edf28d960ccbfec` |
| `admin-web/tests/face-readonly-local-bootstrap.test.mjs` | `937dfe5f322db0920b04d538bcf880b188d41125bc115e5ed349d19ad51e2d57` | `937dfe5f322db0920b04d538bcf880b188d41125bc115e5ed349d19ad51e2d57` |
| `admin-web/tests/fixtures/face-readonly-local-bootstrap-child.mjs` | `1878e07aefb5eac0633b02b52126b3bcb392df7b87f5708be970c580779e2bf1` | `1878e07aefb5eac0633b02b52126b3bcb392df7b87f5708be970c580779e2bf1` |
| `admin-web/tests/fixtures/face-readonly-local-bootstrap-synthetic.mjs` | `8b844c4c3a432af44560449316e6fdc0d43736d38323ff591423a494fc2da0fd` | `8b844c4c3a432af44560449316e6fdc0d43736d38323ff591423a494fc2da0fd` |
| `admin-web/tests/face-readonly-promise-observation.test.mjs` | `98377256f578e7855aaccec335ee4f1a0739a3231bbfccdfcf4d10fc482da5fa` | `98377256f578e7855aaccec335ee4f1a0739a3231bbfccdfcf4d10fc482da5fa` |
| `admin-web/tests/fixtures/face-readonly-promise-observation-child.mjs` | `26d862896338c5e86dd2959b882e39b72226b1b5ff97026940466e77b0651c59` | `26d862896338c5e86dd2959b882e39b72226b1b5ff97026940466e77b0651c59` |
| `admin-web/tests/face-readonly-windows-evidence.test.mjs` | `NEW` | `f5ad0e6225839f91eea4cad486c2966cf103bed93365f1791b7a43d382109dc1` |
| `admin-web/tests/fixtures/face-readonly-windows-evidence-synthetic.mjs` | `NEW` | `aaa5335c5642bc4df457ab35baafbf4e5c1c70365bffceaf3ee6811fa0b2eb22` |
| `admin-web/lib/face-readonly-windows-evidence.mjs` | `NEW` | `6fd355d3a5cf1ab09f1db79d53cbd2bc7b412ab213f3abbb9eddf3dc2cf34be0` |
| `tools/hikvision-readonly-evidence/Invoke-WindowsEvidence.ps1` | `NEW` | `6b0ee013c7d75a3cb20880f85690ba4d249a26df0aa08ff055a3b365f5c704f4` |
| `tools/hikvision-readonly-evidence/WindowsEvidence.cs` | `NEW` | `d428e1b9ac7e68131c0e5b4a94c1d0b16a2612ca6d8baec9f2ba1576b8064029` |
| `admin-web/tests/face-readonly-windows-evidence-faults.test.mjs` | `NEW` | `c2f2f0ef525c13ae3559ae61cf1c3ce4cd5a043cbed3341d810e2d10a3af3ad1` |
| `admin-web/tests/fixtures/face-readonly-windows-evidence-fault-child.mjs` | `NEW` | `9bd826cbc075e021ae9a2d09b85c980fe715d83cbe86567b9a881cbd076563e6` |

共有36个副本集合（34份故障child＋2份负控）；每份故障copy21件、只改C#，且分别对其所属阶段的原始快照核对，旧8场景副本不错误比对成新增第9场景后的child字节。regression-verification.json列全部副本及逐场景结果。

真实stdout/stderr以独立文件描述符保存，进程close后立即保存exit.txt，再解析TAP/JSON；不让后续命令覆盖退出码。log-manifest.json列124个原始日志及各自脱敏副本的相对名、大小和独立SHA；包括正式、首轮失败、34份child、负控及辅助观察。脱敏副本替换profile前缀／SID；原件留本地受控目录。Git交付日志另有delivery-log-manifest.json，不提前虚构其存在即代表推送成功。

核心工件清单（artifact-manifest.json不含自引用）：

| 相对工件 | bytes | SHA-256 |
|---|---|---|
| `environment.json` | 566 | `fee375794dfc6acf37ee53d65115c4e3d1fb45cec78e2db2d42f4e998923b3aa` |
| `source-pre-edit.json` | 5022 | `fabe335f4a0a8d40a6163e7943a26d934127f392524c4355b2005bd733b07716` |
| `focused/summary.json` | 627 | `5161adce61b3aa6c27c64648a80ac853c272b6bd5520dbc996ed1db3b493a28d` |
| `focused/source-before.json` | 4759 | `7e323d15effca6ffb9b178d3fafee00769beb8b53f7d15595d1a5af24d3be78c` |
| `focused/source-after.json` | 4781 | `6772848e425e9ad6ff9ee7789924409c8e77aae90c46024d8050f6c50bd2e9a7` |
| `focused-r2/summary.json` | 630 | `38a9eb13b59d7f1bb67fd8f03b5f6c1893a30c0042a2c2dac384095d52c2d1a7` |
| `focused-r2/source-before.json` | 4759 | `78f88e42397a69cb892fcb192e54f64a683eddf2ebe6af015e44f8ff8b24983c` |
| `focused-r2/source-after.json` | 4780 | `245da719dcac10a670b73dffacd31ce0e9b0ca8351203b088d638b456c836f4b` |
| `faults-focused/summary.json` | 645 | `18a2fec523f01c14aaeeaaab47717afb7ec2adaefbd2e02ef7d7426a57b74226` |
| `faults-focused-r2/summary.json` | 648 | `37819ab24ae09683ad08dcdfb3bf28c2fac694649203ac4a1e5b86f8b6c6a8bc` |
| `faults-focused-r2/source-before.json` | 5044 | `7d8a02b0738d2e72b49c6be57f9f90df32554743e5847f96f049c3dba40bb8ae` |
| `faults-focused-r2/source-after.json` | 5065 | `67eb2616410c92535c5528be528a611cd3c82d20e6939145f40b70519c006da0` |
| `full/summary.json` | 7423 | `26b81f775b1e11f74a3874e6b9e5df1605c68439f3816137eda1c2f4b5edcbb2` |
| `full/source-before.json` | 5044 | `5107f78bc89207c358b9fe980842d391c44dae5657531b0b887238ede8b781d3` |
| `full/source-after.json` | 5065 | `8324fae5ffc7776ea6d2f7bba31bd9fe0d5f70398077a13a7bf366bfdf84fd97` |
| `full-r2/summary.json` | 7426 | `ec591c6e1af962d04beda93e37235bbfc60c1133df3e511e6c30d3a74425f29c` |
| `full-r2/source-before.json` | 5044 | `c69da70b545ca9aa784b59b7a247bea0060cea760b1c7b501944e151fcc9678c` |
| `full-r2/source-after.json` | 5065 | `95f64c14d65d883f4af86083188834086fc00b86bc3a207360ff9f9f561c0f26` |
| `negative-controls/summary.json` | 1510 | `5e6a542e4a2c087ca96b14f04a8a1f8f0dd1005392afaec50ccb37f4c1f35c6c` |
| `negative-controls/member-guard/copy-manifest.json` | 4796 | `35224cd738dabd0ebd2c4a0a3e4e96fbb34c32c94b4fa09d58e948c9e3818ace` |
| `negative-controls/concurrent-latch/copy-manifest.json` | 4677 | `5c5a090f95fc694aae676c3864c96bdb4a78d53f648a2c3016cc03621dcf678d` |
| `native-object-inventory.json` | 152753 | `fb861dc64f7910949eddbdc9bdc744f0373aadc3a6bb357fc02d42b95b0c12f7` |
| `native-object-inventory-final.json` | 335966 | `f12ad5a0a1f66fbd9a2f8e805126608edb0574ab054b11a9b12c324f4e813bda` |
| `auxiliary-audit-notes.json` | 1104 | `d53b5b52be79fc95eb3d1a15e89cc7f2b2efcb06a0171c3e07e99e46ec484ddb` |
| `regression-verification.json` | 28263 | `1badccdf907d827711c54fc8a68383267ec696d0f518df426854819b81559445` |
| `log-manifest.json` | 51166 | `ae60fe4735be44340087a19408315ff280669b84b0f26f07ae16bfa7ecd36d70` |

## 实际命令

核心聚焦：`node --test --test-reporter=tap admin-web/tests/face-readonly-windows-evidence.test.mjs`，故障聚焦：`node --test --test-reporter=tap admin-web/tests/face-readonly-windows-evidence-faults.test.mjs`。均由记录器为测试子进程设置专用SMART_PM_SYNTHETIC_EVIDENCE_ROOT，指向本轮唯一native-fixtures阶段目录；不读取连接材料或改变用户／系统环境。

admin-final（真实退出码 0）：

```text
node --test --test-reporter=tap admin-web/tests/auto-fill.test.mjs admin-web/tests/checkin-face-config.test.mjs admin-web/tests/checkin-face-worker.test.mjs admin-web/tests/face-access-plan.test.mjs admin-web/tests/face-enroll-cli.test.mjs admin-web/tests/face-enroll-powershell.test.mjs admin-web/tests/face-enrollment-command.test.mjs admin-web/tests/face-enrollment.test.mjs admin-web/tests/face-management-ui.test.mjs admin-web/tests/face-management.test.mjs admin-web/tests/face-readonly-host.test.mjs admin-web/tests/face-readonly-policy.test.mjs admin-web/tests/face-server.test.mjs admin-web/tests/face-ui.test.mjs admin-web/tests/hikvision-client.test.mjs admin-web/tests/layout-batches.test.mjs admin-web/tests/local-cloud-database.test.mjs admin-web/tests/property.test.mjs admin-web/tests/qishanyuan-test-data.test.mjs admin-web/tests/sdk-database-adapter.test.mjs admin-web/tests/server.test.mjs admin-web/tests/static-path.test.mjs admin-web/tests/tenant-password-accounts.test.mjs admin-web/tests/vr.test.mjs admin-web/tests/face-readonly-cli.test.mjs admin-web/tests/face-readonly-session.test.mjs admin-web/tests/face-readonly-local-bootstrap.test.mjs admin-web/tests/face-readonly-promise-observation.test.mjs admin-web/tests/face-readonly-windows-evidence.test.mjs admin-web/tests/face-readonly-windows-evidence-faults.test.mjs
```

tenant-final（真实退出码 0）：

```text
node --require ./tests/support/d-network-guard.cjs --test --test-reporter=tap admin-web/tests/tenant-password-routes.test.mjs
```

root-final（真实退出码 0）：

```text
node --require ./tests/support/d-network-guard.cjs --test --test-reporter=tap tests/account-login-api.test.cjs tests/account-login-cloud.test.cjs tests/account-login-pages.test.cjs tests/action-login-checkin-pages.test.cjs tests/action-login-gate.test.cjs tests/action-login-private-pages.test.cjs tests/action-login-public-pages.test.cjs tests/checkin-face-api.test.cjs tests/checkin-face-cloud-workflow.test.cjs tests/checkin-face-cross-module.test.cjs tests/checkin-face-pages.test.cjs tests/checkin-face-qa-gates.test.cjs tests/cloud-bootstrap.test.cjs tests/frontend.test.cjs tests/identity.test.cjs tests/layout.test.cjs tests/phone-login.test.cjs tests/public-houses.test.cjs tests/qishanyuan-pages.test.cjs tests/qishanyuan-test-preset.test.cjs tests/tenant-password-gates.test.cjs tests/wechat-modules.test.cjs tests/wxml.test.cjs
```

worker-final（真实退出码 0）：

```text
node --require ./tools/checkin-face-worker/tests/network-guard.cjs --test --test-reporter=tap tools/checkin-face-worker/tests/rework-r05-r06.test.mjs tools/checkin-face-worker/tests/rework-r08-r09.test.mjs tools/checkin-face-worker/tests/sdk-resolution.test.mjs
```

worker-guard-selfcheck-final（真实退出码 0）：

```text
node --require ./tools/checkin-face-worker/tests/network-guard.cjs --test --test-reporter=tap tools/checkin-face-worker/tests/network-guard-selfcheck.test.mjs
```

check-miniprogram-final（真实退出码 0）：

```text
node scripts/check-miniprogram.mjs
```

checkin-face-static-final（真实退出码 0）：

```text
node scripts/checkin-face-static-check.mjs
```

verify-face-sources-final（真实退出码 0）：

```text
node scripts/verify-checkin-face-sources.mjs
```

verify-import-final（真实退出码 1）：

```text
node scripts/verify-import.mjs
```


## 历史、交付与停止点

全部旧报告／Git对象／工作树和残留引用原样保留，包含首轮CLI33/34退出1、1117首轮通过后发现readonly/list静审问题的过程、1122、1142及verify-import基线失败；不重写或用本次通过覆盖。此前修复报告和限定验收文档受保护哈希由source-pre-edit及交付记录核对。

只允许上述10路径；提交前git diff --check及暂存检查，追加提交后git show --check；逐blob核受测源码／旧保护文件／新文档，普通显式push到HEAD:refs/heads/feat/hk-face-readonly-windows-evidence-2026-11-28，再git ls-remote核完整SHA并保持树干净。实际本地提交、直接父及远端证明存git-delivery/result.json；报告不虚构自身SHA或用amend回填。复审包review-bundle-<提交前12位>.zip另给大小、SHA及逐项校验，不伪造云附件；ZIP不能保存原NTFS ACL／fileID，必须结合原始元数据和本机保留对象复核。junction不跟随，原始日志留本地。

实际CLI保持锁定，不读真实凭据或照片，不连接设备，不改路由，不登记／删除人员或开门，不启动worker／云派发，不运行E1/E2，不处理或清理任何新旧对象。未改全局／系统Git、TLS、代理或安全策略，未amend/rebase/reset/squash/force/merge/cherry-pick或推main。

本次只证明本机所测Windows/NTFS契约和合成链路。元数据按阶段检查，不是持续监控；同SID／管理员／内核干预、最终校验到I/O／释放之间及释放后的非原子变化、崩溃／断电耐久性、跨Windows／文件系统通用行为未验。极短外层期限可能先INCOMPLETE返回，未观察closed不得称已完成释放；原Promise构造器／原型不安全域继续未覆盖，也不宣称可靠擦除JavaScript字符串。

真实操作者身份／审批、真实安全输入、真实TLS／网络中止、现场9人及F03FF8DA7299CE148可见光入库仍未验收；本次原生合成落盘不扩大为这些通过，不作E1/E2、派发、实机、部署或上线放行。提交推送核验后停手交独立复审。
