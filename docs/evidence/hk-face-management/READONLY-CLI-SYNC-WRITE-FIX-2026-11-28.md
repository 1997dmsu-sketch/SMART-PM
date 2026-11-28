# 受控只读CLI同步写流P2修复与合成验证（2026-11-28）

实施方交独立复审，不自行宣布P2验收关闭。固定基线/直接父提交为`749a785e8c8b31c99def7961453e5778dff9f38a`；独立分支`fix/hk-face-readonly-sync-write-2026-11-28`，独立工作树`D:\chatgpt\smart\SMART-PM-face-readonly-sync-write-fix-2026-11-28`。主工作树和全部旧证据保持原样。

## 问题与最小修复

原P2位于导出main的注入写流边界：sink.write先同步done()成功，再在同一调用栈throw，旧代码已经resolve/settled，catch中的第二次done固定错误被忽略，help或合成完成可返回0。它不构成argv/env/JSON实机解锁。

仅修改3份既有文件并新增本报告：

- `admin-web/face-readonly.mjs`：只修改writeLine。同步callback先记录为暂定信号，write调用、返回then getter和then注册正常完成后才允许成功；catch直接以固定COMMAND_OUTPUT_FAILED拒绝，任意falsy throw也不例外。若writer返回Promise，则callback成功还须等待其完成，Promise拒绝不会被旧成功覆盖。原1秒写入期限、背压等待callback、输出error watcher及最终非零判定保留。
- `admin-web/tests/face-readonly-cli.test.mjs`：只追加5个测试，旧34项名称/断言保留。覆盖同步callback正常返回、Promise-only成功正控；help与真实Host/SDK完成15次假HTTP后，同步callback后throw Error/null/undefined均必须exit5；callback后延迟Promise.reject(undefined)也须exit5。
- `admin-web/tests/fixtures/face-readonly-cli-child.mjs`：仅增加9个固定合成场景及分支；先向真实stdout提交一行再同步callback和throw，核对已提交字节不可撤回时真实非零exit、固定stderr及关闭状态。原场景保持。

窄适配层、真实SDK/宿主/策略、品牌检查、固定错误码/敏感投影、生产入口锁定、原登记CLI/包装器、后台、worker、配置、依赖、来源清单和旧报告均未修改。没有新增实机开关、任意传输/模块注入或权限例外。

## 本机环境与真实执行

环境记录时间2026-11-28T12:08:48+08:00（Asia/Shanghai）：Windows 23H2 build22631.6199，Node v24.16.0，Windows PowerShell5.1.22621.6133、PowerShell7.6.9。没有安装/升级运行时或依赖，没有绕过组织策略、更改Git全局配置、TLS或路由。

聚焦实际命令：`node --test --test-reporter=tap admin-web/tests/face-readonly-cli.test.mjs`，39/39，exit0，起止2026-11-28T12:10:40+08:00至2026-11-28T12:10:48+08:00。本轮正式源码未发生失败后改记。此前实施的首次33/34失败及其源码/原日志继续在原目录保留，不用本轮39/39覆盖它。

完整回归使用本机新证据目录的`run-validation.mjs full`，逐组实际argv在`full/summary.json`，与原925项命令参数逐项一致。运行窗口2026-11-28T12:10:54+08:00至2026-11-28T12:12:16+08:00。各子进程stdout/stderr直接保存原始字节，先保存真实exit，再解析TAP；外层脚本退出码不能代替子进程结果。

| 分组 | tests | pass | fail | skipped | exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| admin-final | 590 | 590 | 0 | 0 | 0 |
| tenant-final | 6 | 6 | 0 | 0 | 0 |
| root-final | 297 | 297 | 0 | 0 | 0 |
| worker-final | 35 | 35 | 0 | 0 | 0 |
| worker-guard-selfcheck-final | 2 | 2 | 0 | 0 | 0 |
| 合计 | 930 | 930 | 0 | 0 | 0 |

原925+新增5=930项通过，fail/cancelled/skipped/todo均0。原53个测试文件及TAP名称多重集保留，没有新增测试文件或将describe标题算成测试。旧合成loopback HTTP/TLS和PowerShell包装器依原参数回归；新场景仅合成资料及假TLS/HTTPS底层，真实SDK/宿主/策略仍执行。成功路径先观察15次假HTTP及全部socket关闭，fixture随后才清理，不能用teardown掩盖宿主未关连接。

三项相关静态检查exit0；`verify-import`仍为exit1的既有基线失败：`cloudfunctions/login/config.json`实际SHA256为`aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`，provenance预期`ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`。原记录和来源清单不改，不能称全部静态检查通过。

## 旧源码负控

仅读固定Git blob保存原`face-readonly.mjs`（SHA256=`a11cb407b4fd698b4334e747ef248ae25f4c1507cc2b5ca3912a189aa685f763`）。在独立工件副本中仅把该文件替回基线字节，其余新测试/fixture不变，运行`node --test --test-reporter=tap --test-name-pattern="synchronous success callback followed by throw" <工件副本中的测试>`。完整实值argv和复制清单在`negative-control/`。

实际tests=2、pass=0、fail=2、exit=1；两项都检出旧代码实际0而预期5。此故意失败证明新增回归能捕获原P2，不计入正式通过总数。全部受测原件及工件副本均保留，没有修改原件来制造负控。

## 测试前后源码字节

以下22项测试前、后、最终磁盘和`full/source/`副本一致。相较基线仅上述3份源码/测试变更，其余19项继承受核对文件保持原哈希。提交时另逐项核对Git index/commit blob；本报告在测试后整理，不改变受测代码。

| 路径 | 前=后SHA256 |
| --- | --- |
| `admin-web/lib/hikvision-client.mjs` | `d79ef3ba00914d4bc551ab363315f6fdb183da44088577fe14c1902786e76001` |
| `admin-web/lib/face-enrollment.mjs` | `789e1fa39a7a01cce1d363f16f0ec4eb3107c3833f9063136b0d6a78acf128be` |
| `admin-web/server.mjs` | `0b4c999ee71b151efc85b6d14777d093350e034caa63c7eed017cb448878a763` |
| `admin-web/public/face-ui.js` | `43d954d22fe3ad5498764e1991b9574d04e1521542a9cdb346041c8ae1ae31fd` |
| `admin-web/public/style.css` | `0ecea30847c15a225a62292391a31b5292963c72b2b47799fa97a540779d2a3d` |
| `admin-web/tests/face-management.test.mjs` | `bf38ee5bd1ebffff67b892f7e15e63a28594c59a46dcbe6e56549a1dd979f286` |
| `admin-web/tests/face-management-ui.test.mjs` | `a813242ab62aa7298ba6bc29fee87b42a626bf820bdcd2c95aa7e255d276e3af` |
| `admin-web/tests/face-server.test.mjs` | `94b3a329e913f92425f0ee23a13704b567bd591f8e72113e5556ae65d751a224` |
| `docs/checkin-face-experience-source-hashes.json` | `d01eb1ff12c4a921dd420047d52a215a19d16ec04a4814a2f27e8c665b5dde7c` |
| `admin-web/lib/face-access-plan.mjs` | `f3962e72a15c55512aea5b7a87d0465d37b1142218a82138c01635c41656c9f1` |
| `admin-web/lib/face-readonly-host.mjs` | `67d1f13b75d203ec032232395b16954aabb006ba88c33a278a7ffd5843d6082b` |
| `admin-web/lib/face-readonly-policy.mjs` | `3e4ea808e88c6822d26328d5a2d7af759f659b5d7329d9873c4d8a02e7b9f657` |
| `admin-web/tests/face-readonly-host.test.mjs` | `d3cbd900cbd03c8e469bbff636a5e48aeaf171449f576e75e5acfb0cb1e6f112` |
| `admin-web/tests/face-readonly-policy.test.mjs` | `89dd1e481065849b6afd5fff6d08938a06f26542f2ad2a13f83813a5ebc72277` |
| `admin-web/tests/fixtures/face-readonly-fake-transport.mjs` | `2c6c55ed2ee7e7b4abb43e08b407f1b777e3f77e8253bee5b439f25aee27451a` |
| `admin-web/face-readonly.mjs` | `a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d` |
| `admin-web/lib/face-readonly-command.mjs` | `c09097491de33a627eb0f21797eb8d3b2d3b52c406efaeb671c61f414c302301` |
| `admin-web/tests/face-readonly-cli.test.mjs` | `42b3c01a0e219522ecb61733339fd2e5e3b0a65abedc1b8b5aab42f7dd953ca3` |
| `admin-web/tests/fixtures/face-readonly-cli-child.mjs` | `ebf4f8e064cbc8bc9edb6005269afffd13878b975ab902359c1ec1345d63b600` |
| `admin-web/tests/fixtures/face-readonly-cli-network-guard.mjs` | `170fecbf6df460f11141b5f735737ccea1f58850b210bf77f43e8826d50dd6fc` |
| `admin-web/tests/fixtures/face-readonly-cli-synthetic-adapter.mjs` | `9ee6d4d96cfb18c5f521265f339e390a89bd10368c88b13b9d83c1c3af1b42c2` |
| `admin-web/tests/fixtures/face-readonly-cli-synthetic-input.mjs` | `3d248af179c5cc6c1fdb8764cbde9a9b36bfdfba30d911dbe4a86d19831cdf03` |

## 原始日志、工件和取件

本机新证据目录：`D:\chatgpt\smart\FACE-READONLY-SYNC-WRITE-FIX-20261128T120847-4b29d0d4`。不是云端附件；异机复审需实际取件。`focused/`、`full/`、`negative-control/`保存各stdout/stderr/exit；`log-manifest.json`列每份原始和脱敏副本的相对名、大小、SHA256；`artifact-manifest.json`为核心工件清单。各阶段`source/`保留原字节副本，不清理。

| 关键相对工件 | bytes | SHA256 |
| --- | ---: | --- |
| `environment.json` | 341 | `4bb24435d3c4bd2e8c76c0882d2f0d11950db734b6fff88baaac5495ffab8ad7` |
| `baseline-source.json` | 197 | `7380680f936e6370390a12b6361fd347aafc8021045bbbe02f4824ea8f3dbfe2` |
| `baseline-face-readonly.mjs` | 7634 | `a11cb407b4fd698b4334e747ef248ae25f4c1507cc2b5ca3912a189aa685f763` |
| `focused/summary.json` | 586 | `8e41e318c3b74ef8865fd61c8831c2dad18ac549055a3defc3bc97bdd5c4dea5` |
| `focused/source-before.json` | 2635 | `63f8c0fdce60d5de7aa0f329556115190ad22c67dd2afaf2efaa9bbcd817b59a` |
| `focused/source-after.json` | 2656 | `3864cd9a27f44db03ed45f52095cb822ebbfc265f9f202822a1949a86a4fab7b` |
| `full/summary.json` | 6862 | `e45384f5a8dcefe71007d38b623ce138341eaa7e97730f4da38e2ead8f747fe8` |
| `full/source-before.json` | 2635 | `f53f49d27f6c3debe998176121968012eb23c9b7e18deb99cb9f73d96bfad054` |
| `full/source-after.json` | 2656 | `a73da2786cf3f9f3ee5b3eaeba64623769f8c18f34141b9745e57c677728a400` |
| `negative-control/copy-manifest.json` | 3186 | `9686eb88a4862a2970e58cc760560fed88681cfa2ab44c1b21c9e8b65699aeda` |
| `negative-control/result.json` | 658 | `5f905c78807da0b1f4e5f6e2436134554c9b0996af8612e34f666f6d63b4f876` |
| `regression-verification.json` | 1489 | `7b83e42b072f809b3bca06bd8a1a2d8b8b9c5a71ae33c8ac2288719eedc7df3b` |
| `log-manifest.json` | 7868 | `b3cc21de82c8664b869d9baa8682a271177e31ad59f2868cfe7fcc2d69b7b3a2` |

普通提交/推送、完整远端SHA和干净工作树另记新目录交付文件。提交后生成`review-bundle-<提交前12位>.zip`，包含脱敏日志、源码副本和交付记录；实际名称/大小/SHA另存`review-bundle-result.json`并随最终回报提供，不伪造附件ID。

## 限定范围与停止点

实际CLI继续无runner硬锁；新测试只在专用子进程中装配品牌化假传输，无argv/env/JSON可解锁设备。未读取真实凭据、照片、证书或连接配置；设备连接、路由修改、人员登记/删除、开门、云端队列/派发修改和手动残留清理均0。原全部报告、日志、失败记录及新旧引用保留。

本轮仅提供P2修复及合成证据，不自行关闭验收；不扩大为真实TLS、可用实机CLI、真实EPIPE/OS信号、完整后台或现场9人/F03FF8DA7299CE148状态。任意可信JavaScript/原生代码不在测试guard沙盒保证内；已提交输出仍需结合最终退出码判断。原TOCTOU非原子边界继续保留，不作E1/E2、删除/开门、派发或上线放行。

提交推送、远端核验后停手，交另一独立复审。
