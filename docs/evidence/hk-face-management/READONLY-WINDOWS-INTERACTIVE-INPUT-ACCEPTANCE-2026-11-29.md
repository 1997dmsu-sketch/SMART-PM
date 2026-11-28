# Windows 原生输入与明确确认：合成验证限定验收结论

## 对象、角色与本次变更

本文件固化项目负责人上一轮最终独立复审对实施提交 `a8bd03a794f7d2268eb990d61b222ca0fedf09e7` 的限定结论；该实施提交的直接父为 `1ebb86ea53872090a2bfcab89d1071538c221206`。上一轮结论为：未发现源码阻断项，1258＋60共1318项合成验证限定通过，有一处不影响计数或已有控件运行证据的P3措辞问题。

本轮是文档实施方，从上述固定实施提交创建独立文档分支 `docs/hk-face-readonly-interactive-input-acceptance-2026-11-29`。本轮没有重新运行测试、helper、CLI或GUI；只读核对既有源码和工件，再修订文档。此文档提交仍须交另一个独立Codex复审，不把文档实施自查当作该提交已获独立批准。

仅有两个仓库路径变化：修订[原实施报告](./READONLY-WINDOWS-INTERACTIVE-INPUT-2026-11-29.md)的P3段落及同类表格说明，新增本文件。原生helper、输入adapter、bootstrap、SDK、宿主、策略、CLI、所有测试、依赖和其余历史报告不改。

## P3 修订的精确含义

新增60项是整个定向测试集合，包含不启动采集的工厂/品牌等用例，以及交互用例。**仅交互用例实际以合成种子驱动同套Windows Forms控件**及Click/CheckedChanged/关闭路径；不能将60项全部描述为实际运行GUI。

修订不调整60/60或1318的计数，不声称新增或重跑任何测试，不补造缺失的人工交互证据。修正后的段落和新增定向表格说明均明确区分非交互用例与合成控件交互用例。这里只按文档修订关闭该措辞问题，不扩大原有验收范围。

## 已固化的限定结论

原生输入代码提供独立字段与密码遮罩，保留控件原文；确认页默认不批准，要求勾选并明确点击。审阅响应绑定同一adapter/context、提交快照、capture/challenge、视图字节及证据引用；批准前须观察helper关闭ACK、实际exit0、无锁存错误及尾输出。取消、异常和超时沿用有界收尾。

上述是源码静态核对与既有合成执行证据支持的限定结论，不是新的运行结果。原生证据接收器的ACL/文件身份门禁及既有只读策略未放宽；只有使用原生receiver的用例才涉及其原生门禁，不能将所有synthetic receiver说成经过原生ACL检查。

| 既有阶段 | tests/pass/fail/skipped | 原始进程退出码 |
| --- | --- | --- |
| 新增定向 | 60/60/0/0 | 0 |
| 原回归 admin | 918/918/0/0 | 0 |
| 原回归 tenant | 6/6/0/0 | 0 |
| 原回归 root | 297/297/0/0 | 0 |
| 原回归 worker | 35/35/0/0 | 0 |
| 原回归 worker守卫自查 | 2/2/0/0 | 0 |

原回归1258项与新增定向60项是两个互补阶段，共1318项；均0 fail/cancelled/skipped/todo，默认测试隔离。九条原回归命令保持原argv，新UI文件没有重复加入原admin命令。定向与原回归使用同一批冻结源码。1318不是本轮文档工作重新执行的结果。

两项既有副本负控均有效：explicit-consent移除明确确认门禁后，未勾选却得到exit0及36次假HTTP，对应断言失败、测试exit1；password-trim将密码改为Trim后，真实SDK的Digest只匹配trim值（original=false、trimmed=true），对应断言失败、测试exit1。均1 test / 0 pass / 1 fail，无超时或跳过，不计入1318通过数。副本中的测试只增加安全观察，不删除断言；受测原文件未变。

## 已有源码、日志与交付证据

上一轮只读复审核对的64个Git/当前文件blob、55个旧保护文件、102份源码快照（51个路径×2阶段）、456对原始/脱敏日志，以及1608个ZIP条目SHA/CRC均一致。本轮文档工作另读64个固定起点文件、上述源码快照及日志清单，并只读复算其字节/哈希；原始TAP、exit与既有summary一致，没有启动受测程序。

原实施证据目录名为 `FACE-READONLY-INTERACTIVE-INPUT-20261129T031612-802f1f01`，在负责人同机授权工作区：`focused/`、`full/`、`native-fixtures/`、`negative-controls/`、`git-delivery/`、各原始/脱敏日志清单及源副本全部保留。异机须由负责人实际转交，不将该本机目录冒充云端附件。

原证据包 `review-bundle-a8bd03a794f7.zip`：4002686 bytes，SHA-256 `547aeb2d3cf4f3962bb00d113148967ea7a33bef6812a33e17e66c2e03f04cce`。原包保持原字节，仍包含当时未修正的P3措辞；本轮不回写包或其中报告，复核修正须同时看当前文档提交差异。ZIP不保留NTFS ACL/文件身份语义，不能代替本机原生对象。

| 文档字节定位 | SHA-256 |
| --- | --- |
| 固定实施提交中的原报告；亦保留在旧证据目录及本轮pre-doc-source副本 | 38334c506c81a7b27ee31af8cd8f2b7dad234aa81976c7469e2f00c729bd4122 |
| 本轮修正P3后的实施报告 | 2587bcfb99f3b991825305af3e26421ced7a834b9411ac60a7ed6e7bbd5d81b6 |

本轮独立文档证据目录名为 `FACE-READONLY-INTERACTIVE-ACCEPTANCE-20261129T035723-2909a853`；`fixed-base-hashes.json`及`pre-doc-source/`保留64个固定起点字节，`existing-evidence-verification.json`记录只读核对。提交/显式普通push/ls-remote与index/commit blob核验记录由`git-delivery/`保留；本文件不预填尚未产生的提交或推送成功，以实际交付结果为准。

## 失败记录与边界继续保留

本轮文档生成辅助脚本初次终端执行因模板引号语法错误exit1，没有生成验收文档；原脚本保留。随后对原字节脚本进行一次留档执行，同样exit1，document-writer-initial-recorded.*保存真实stdout/stderr/exit；首次终端结果未另存原始文件，不将留档复现冒充首次原件。另存write-acceptance-r2.mjs修正模板，生成文档成功。此为本轮文档工具错误，不是受测程序或测试失败，没有重跑测试。

`verify-import`仍为原始exit1：login/config.json实际SHA `aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`，原基线预期 `ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`。三项其他非计数检查原为exit0，不把verify-import混写成全部静态检查通过。

父阶段辅助核验 `Actual CLI changed` 首次终端失败与随后留档exit1、r2修正exit0均保留。首次终端失败未另存原始文件的事实仍明确标为rawSeparateFile=false，不将后续留档复现冒充首次原件。历史CLI首轮33/34、原生证据首轮38/39及其原始失败日志继续保留；旧1117项记录不改写为失败。没有用本轮P3修订改记历史结果。

**实际CLI保持锁定**：executable没有安装交互端口或runner，无runner仍为LIVE_EXECUTION_LOCKED，CLI SHA继续为 `a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d`。本轮没有进行解锁、开启派发或改变allowRead。

程序驱动的合成控件不证明真人已输入、阅读或点击，不是Windows身份认证。可见布局、辅助技术、全部焦点/键盘/RDP/锁屏状态、长时间真实交互、真实公开证书来源、真实TLS/网络、设备身份及实机CLI均未验。9人名单及目标 `F03FF8DA7299CE148` 的实机可见光入库状态仍为NOT_EXECUTED。

同机同信任域、管理员/内核及受信任代码改写、Promise构造器/原型、非原子TOCTOU/句柄释放后、崩溃断电、不可变字符串及运行时副本物理擦除、旧Node仅静态兼容边界继续保留。有界失败不保证异常系统中helper必已退出，未观察到正常退出不能补写0。

本轮仅改文档，未重跑、未读真实凭据或照片、未连接设备、未改路由、未删除人员或开门、未运行E1/E2。保留全部证据及历史失败；不扩大为真人操作、真实身份、TLS或实机验收，不作E1/E2放行。完成提交推送及远端SHA核对后停手，交独立复审。
