# 受控只读CLI同步写流P2限定验收记录（2026-11-28）

## 对象与最终复审结论

本文件固化已完成的最终独立复审结论，记录日期为2026-11-28（Asia/Shanghai）。本轮仅新增文档，不重新运行测试或现场会话；本份新增文档的提交仍须交独立复审。

- 验收对象/本轮文档分支起点：`6dff51ebae1a3e008ebdc29113c40f5ac7fb286f`。
- 修复对象的直接父提交：`749a785e8c8b31c99def7961453e5778dff9f38a`。
- 文档分支：`docs/hk-face-readonly-sync-write-acceptance-2026-11-28`，直接从验收对象建立，本轮仅新增本文件。
- 依据：[原修复报告](READONLY-CLI-SYNC-WRITE-FIX-2026-11-28.md)、[CLI离线使用说明](../../ADMIN-FACE-READONLY-CLI-OFFLINE.md)、固定提交源码、既有原始日志/退出码、负控、源码哈希、Git blob及工件清单。

最终独立复审通过，未发现新增问题：**原P2在本次合成离线范围内关闭**，接受原925项加新增5项、共930项合成回归及旧源码负控结论。关闭对象是“同步成功回调后同一调用栈抛异常仍可能返回0”的写流错误优先问题；不扩大为真实TLS、可用实机CLI、设备或现场名单验收，不作E1/E2、派发或上线放行。

修复提交仅修改CLI的writeLine、既有测试及child fixture三份文件，并新增原修复报告。既有SDK、宿主、策略、窄命令层、品牌检查、敏感投影、生产入口、登记CLI/包装器、后台、worker、依赖、配置和旧报告均未修改。原报告中的“交独立复审、不自行关闭验收”保留为当时实施交付状态，不回改历史。

## 已核对的修复与覆盖

同步callback成功仅记录暂定信号；write调用、返回then getter及then注册正常完成后才允许成功。上述同步窗口内任意throw（包括falsy值）直接固定失败，不再经已成功的done丢弃异常。返回Promise时，callback成功还须等待Promise完成，已观察到的错误或拒绝不能被后续成功覆盖。原1秒写入期限、异步callback、false背压、watcher及最终非零判定保留。

新增5个测试、9个固定child场景，旧34项入口测试名称及断言未改。两项help正控覆盖同步callback正常返回、Promise-only成功；help负例覆盖callback后延迟Promise.reject(undefined)以及同步callback后throw Error/null/undefined；完整合成Host/SDK查询后同样覆盖三种throw并要求最终exit5。新场景仍经过真实SDK、宿主及策略，仅替换TLS/HTTPS底层，未引入可从argv/env/JSON选择的任意传输或实机开关。

child先把原始JSON行提交给真实stdout，再触发同步回调和异常。因此已提交的help/合成完成行可能保留，最终非零退出码及固定COMMAND_OUTPUT_FAILED必须压过该行；不能单看outcome认定成功。完整合成查询的15次假HTTP、无后续请求及全部socket销毁，在fixture清理前观察，不以teardown代替宿主关闭证明。

## 既有正式结果与计数

以下为既有实施结果的复审固化，**本轮没有重跑**。聚焦命令为`node --test --test-reporter=tap admin-web/tests/face-readonly-cli.test.mjs`，实际39/39、exit0，时间2026-11-28T12:10:40+08:00至12:10:48+08:00。完整回归窗口为12:10:54+08:00至12:12:16+08:00，同属2026-11-28。

| 最终分组 | tests | pass | fail | skipped | exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| admin-final | 590 | 590 | 0 | 0 | 0 |
| tenant-final | 6 | 6 | 0 | 0 | 0 |
| root-final | 297 | 297 | 0 | 0 | 0 |
| worker-final | 35 | 35 | 0 | 0 | 0 |
| worker-guard-selfcheck-final | 2 | 2 | 0 | 0 | 0 |
| 合计 | 930 | 930 | 0 | 0 | 0 |

cancelled/todo也均为0。旧925项实值argv、53个测试文件及叶测试名称多重集均保留，恰新增5项；describe标题不另算测试。各组完整命令、起止时间和真实退出码见`full/summary.json`；stdout/stderr及exit分别保存，不能用外层证据脚本退出0替代子进程结果。旧合成loopback HTTP/TLS和PowerShell包装器仍依原参数回归，不因此把新增假传输写成真实TLS证明。

## 旧源码负控的限定含义

负控仅在独立工件副本中把`admin-web/face-readonly.mjs`替回父提交749a785的固定Git字节（7634字节，SHA256=`a11cb407b4fd698b4334e747ef248ae25f4c1507cc2b5ca3912a189aa685f763`）。其余15份副本文件及新增测试保持当前版本；受测原件未改，副本不清理。

以`synchronous success callback followed by throw`筛选两项新测试，实际tests2、pass0、fail2、exit1，两处明确检出旧代码actual0/expected5，证明回归能够捕获原P2。该故意失败不计入正式930项通过总数。

两个负控循环均在首个Error场景断言失败后停止，**负控TAP没有继续执行null/undefined**；这两类由修复版39/39通过记录及静态循环覆盖支持。不能把负控扩写为旧代码所有异常值、真实EPIPE或OS信号均已实测。

## 历史失败与字节核对保留

此前首次入口聚焦33/34、exit1，测试期望13次请求而实际12；当时仅将期望改为12并补9次描述/计划+2页人员+1次人脸查询的完整顺序断言。原始失败日志、退出码和首次测试源码副本仍保留于原证据目录，不能用本次39/39覆盖或改记该失败。

三项相关静态检查exit0；`verify-import`仍为exit1的既有基线失败。`cloudfunctions/login/config.json`实际SHA256为`aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`，provenance预期为`ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`。原文件、来源清单及错误日志未改，不称全部静态检查通过。

已完成的独立复审重新核对22项受测源码测试前后、最终磁盘及各阶段源码副本一致，相较父提交仅3份约定文件变化、19项继承哈希不变；另核对23项固定提交Git blob（22项受测文件及原修复报告）与记录一致。生产文件在writeLine之外（含main及实际执行入口）的字节均与父提交相同，实机入口继续无runner硬锁。本轮新增验收文档不属于此前受测源码或23项blob，不混算。

## 证据定位与交付界限

修复证据本机目录：`D:\chatgpt\smart\FACE-READONLY-SYNC-WRITE-FIX-20261128T120847-4b29d0d4`。关键相对工件为`focused/`、`full/`的原stdout/stderr/exit、summary及前后哈希与source副本，`negative-control/`复制清单/原TAP/exit，以及`artifact-manifest.json`、`log-manifest.json`、`git-committed-byte-verification.json`。独立复审核对72项核心工件、22份日志记录对应的44份原始/脱敏文件，以及原报告13项工件行和22项源码行，大小/SHA256均一致。

历史首次失败目录：`D:\chatgpt\smart\FACE-READONLY-CLI-OFFLINE-20261128T042047-600ed848`，其中`focused/cli-focused.stdout.log`、stderr/exit及`face-readonly-cli.first-attempt.test.mjs`保留原始33/34真值；旧`verify-import`失败也保留。目录均为真实本机位置，不是云端附件，不伪造可远程读取能力或附件ID。

既有脱敏包`review-bundle-6dff51ebae1a.zip`实际223项、450543字节，SHA256=`f1a4fef70b986d093f3528b50df730faf0a918d11fb16cf9e971130ca766e8e5`。222项清单、清单自身、无重复名及CRC均经既有独立复审核对；原始日志继续本机受控保留，异机复审须实际取件。

修复交付的`remote-verification.json`记录普通push及ls-remote均exit0，修复分支远端完整SHA为`6dff51ebae1a3e008ebdc29113c40f5ac7fb286f`；此前复审核对的是该既有记录，未冒称当次重新联网查询。本次文档须另行提交、普通显式推送并重新核对文档分支远端完整SHA，结果随交付回报提供，不能借用修复分支记录代替。

## 未放行事项与停止点

实机执行保持锁定。真实TLS握手/CA/名称、可用实机CLI、真实EPIPE/OS信号、设备身份、网络/VPN、新路由器、网页接入及现场9人/F03FF8DA7299CE148入库状态均未因此验收。任意可信JavaScript/原生代码不是fixture网络守卫的安全沙盒保证；名单及原TOCTOU非原子边界继续保留。

本轮不重跑、不读真实凭据或照片、不连接设备、不改路由、不登记/删除人员、不开门、不处理云队列/开关或清理残留。全部旧报告、日志、失败记录、工件及新旧引用保留，不作E1/E2、派发、部署或上线放行。

本份文档提交推送并核对远端完整SHA后停手，交独立复审；不自行宣布其自身文档复审完成。
