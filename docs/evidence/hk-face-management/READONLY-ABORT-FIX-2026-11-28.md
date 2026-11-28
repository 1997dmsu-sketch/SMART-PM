# 只读会话取消传播P2最小修复证据（2026-11-28）

本报告由实施方提交独立复审，不自行宣布P2验收关闭。固定起点/直接父为`2d19672a7096c7d7509299495b8a26de8c9cf6cf`；独立分支`fix/hk-face-readonly-abort-2026-11-28`，新工作树`D:\chatgpt\smart\SMART-PM-face-readonly-abort-fix-2026-11-28`。主工作树及所有旧工作树、对象、报告、日志、失败记录和新旧引用均保留。

## 最小修改与门禁

仅修改`admin-web/lib/face-readonly-session.mjs`和其既有合成测试`admin-web/tests/face-readonly-session.test.mjs`，新增本报告，共3个Git路径。旧报告、使用说明、SDK、Host、Policy、provider、业务CLI、worker、UI、依赖、配置及来源清单均原字节保留。

原缺陷：普通abort监听会被同一合法Signal已有监听器的stopImmediatePropagation阻断，Host未收到关闭，可能继续分页/人脸HTTP，到整次操作结束才返回取消错误。

修复仅将事件订阅改为`node:events.addAbortListener`，finally用返回句柄的`[Symbol.dispose]()`解除。订阅后的原生aborted检查仍在Host创建前；首错优先、Host关闭和取消Promise观察者均保留。已有其他监听器不删除。原同步先消费令牌、不可变快照/执行绑定、独立预期、pin-before-send、精确白名单及双层阻写不变。

采用namespace import避免旧Node因缺少命名导出在模块加载时失败；若addAbortListener或Symbol.dispose不可用，带Signal的执行在Host创建前以READONLY_FAILURE/非零停止，没有回退普通监听、安装运行时或改依赖。当前仅在下述Node版本实测，未宣称已覆盖其他Node小版本。

本次“取消后零后续HTTP”仅指合成调度中abort之后没有新出站；已发送请求不可撤回，设备侧处理状态及真实网络取消未验证。取消仍消费令牌、不能重放。实际`admin-web/face-readonly.mjs`完全未改，默认仍LIVE_EXECUTION_LOCKED，无新的argv/env/JSON解锁入口。

## 环境、命令与真实结果

2026-11-28T16:24:00+08:00记录：Windows 23H2 build22631.6199，Node v24.16.0，Windows PowerShell 5.1.22621.6133、PowerShell 7.6.9。未安装或升级任何运行时/依赖。

聚焦命令：`node --test --test-reporter=tap admin-web/tests/face-readonly-session.test.mjs`，实际92/92，退出码0，2026-11-28T16:31:13+08:00至2026-11-28T16:31:15+08:00。

完整回归沿用原1013项五组命令及三个静态检查和verify-import，argv未变，明细见`full/summary.json`。窗口2026-11-28T16:31:22+08:00至2026-11-28T16:32:30+08:00。所有进程stdout/stderr按原始字节分别保存，退出码在解析前立即写入同名exit文件；外层脚本退出码不代替测试进程退出码。

| 正式分组 | tests | pass | fail | skipped | exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| admin-final | 682 | 682 | 0 | 0 | 0 |
| tenant-final | 6 | 6 | 0 | 0 | 0 |
| root-final | 297 | 297 | 0 | 0 | 0 |
| worker-final | 35 | 35 | 0 | 0 | 0 |
| worker-guard-selfcheck-final | 2 | 2 | 0 | 0 | 0 |
| 合计 | 1022 | 1022 | 0 | 0 | 0 |

原1013+新增9=1022项实际通过，fail/cancelled/skipped/todo均0。旧argv完全一致、TAP名称多重集无缺失。原83项会话测试名称及断言保留；新增用例覆盖吞传播监听下的首设备/后续描述GET、首人员页、controlled runner/main取消，无后续HTTP及人脸查询、socket已关闭、令牌烧毁、预取消零HTTP，以及成功/失败/取消后监听解除且原监听仍在。新用例只用原合成配置与底层假TLS/HTTPS，真实SDK/Host/Policy执行，没有替换Host或传入任意生产backend。

三个相关静态检查exit0；verify-import仍exit1，原`cloudfunctions/login/config.json`实际SHA256=`aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`、provenance预期=`ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`，未改文件或清单凑绿。旧CLI首次33/34、exit1及首版源码继续保留在原`FACE-READONLY-CLI-OFFLINE-20261128T042047-600ed848`；父提交各轮证据继续保留在`FACE-READONLY-SESSION-20261128T154416-f460def0`。

## 旧源码负控

在新建`negative-control/artifact-copy/`中保留最新合成测试及所有依赖，仅将session模块替换为从固定父Git对象提取的原始字节，SHA256=`fe42dfbf6f5f720ffed37f791387a0c83505cd3f9c21f35bc5b8a3817197fa88`。不修改受测工作树或旧证据。

负控实际命令为node --test --test-reporter=tap --test-name-pattern选中`a pre-existing stopImmediatePropagation listener cannot allow later people or face HTTP after first-page cancellation`，完整argv见`negative-control/result.json`。测试结果1/0/1（tests/pass/fail），真实exit1；旧源码未停止后续HTTP，断言失败，被新增回归检出。该故意失败单独保存，不计入正式通过数；它仅证明此用例检出本P2，不宣称全部门禁均有负控。

## 前后哈希与提交字节

两份变更文件的固定父原字节和本次受测字节：

| 文件 | 父提交SHA256 | 本次SHA256 |
| --- | --- | --- |
| `admin-web/lib/face-readonly-session.mjs` | `fe42dfbf6f5f720ffed37f791387a0c83505cd3f9c21f35bc5b8a3817197fa88` | `076e4b13629ff69290bdd31b00ae30575a35df18f61692ed36503e3d1417ad4d` |
| `admin-web/tests/face-readonly-session.test.mjs` | `6c32c8decc4ca894d0b15c5f9bc43a35ced7b1ca1f9870f347218965730f4365` | `71adf8fcee97941f41fdb13441680196aa157a1af26a0a3de1ed308fccfa89ce` |

以下27项测试前、后、当前磁盘及`full/source/`副本一致；相较父证据，仅以上2项变化，其余25项保持。实际CLI SHA256=`a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d`。提交前后另以28个index/commit blob核对27项受测字节与本报告，不因换行转换替换受测字节。

| 路径 | 测试前=后SHA256 |
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
| `admin-web/lib/face-readonly-host.mjs` | `4a9365370607cc246c600351a0dd4e9c293728fbbcd035f587b356bc0976f20d` |
| `admin-web/lib/face-readonly-policy.mjs` | `e24a109d1948bbe6b289eb27b1f03b111deb37639f207c895ae6cc9aa23e4086` |
| `admin-web/tests/face-readonly-host.test.mjs` | `d3cbd900cbd03c8e469bbff636a5e48aeaf171449f576e75e5acfb0cb1e6f112` |
| `admin-web/tests/face-readonly-policy.test.mjs` | `89dd1e481065849b6afd5fff6d08938a06f26542f2ad2a13f83813a5ebc72277` |
| `admin-web/tests/fixtures/face-readonly-fake-transport.mjs` | `2c6c55ed2ee7e7b4abb43e08b407f1b777e3f77e8253bee5b439f25aee27451a` |
| `admin-web/face-readonly.mjs` | `a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d` |
| `admin-web/lib/face-readonly-command.mjs` | `0217c79857b055f8485ec0631c2ab03b48e03d18e8d86f5b529d53f1fdb28e35` |
| `admin-web/tests/face-readonly-cli.test.mjs` | `42b3c01a0e219522ecb61733339fd2e5e3b0a65abedc1b8b5aab42f7dd953ca3` |
| `admin-web/tests/fixtures/face-readonly-cli-child.mjs` | `ebf4f8e064cbc8bc9edb6005269afffd13878b975ab902359c1ec1345d63b600` |
| `admin-web/tests/fixtures/face-readonly-cli-network-guard.mjs` | `170fecbf6df460f11141b5f735737ccea1f58850b210bf77f43e8826d50dd6fc` |
| `admin-web/tests/fixtures/face-readonly-cli-synthetic-adapter.mjs` | `9ee6d4d96cfb18c5f521265f339e390a89bd10368c88b13b9d83c1c3af1b42c2` |
| `admin-web/tests/fixtures/face-readonly-cli-synthetic-input.mjs` | `3d248af179c5cc6c1fdb8764cbde9a9b36bfdfba30d911dbe4a86d19831cdf03` |
| `admin-web/lib/face-readonly-session.mjs` | `076e4b13629ff69290bdd31b00ae30575a35df18f61692ed36503e3d1417ad4d` |
| `admin-web/tests/face-readonly-session.test.mjs` | `71adf8fcee97941f41fdb13441680196aa157a1af26a0a3de1ed308fccfa89ce` |
| `admin-web/tests/fixtures/face-readonly-session-child.mjs` | `dd353ec9cfcf76d83f7d528a063e40095a9f87a66be2813792a64f24fd07323e` |
| `admin-web/tests/fixtures/face-readonly-session-network-guard.mjs` | `f1073e115563fb420ca5c242e16d0eb544d9739ade2a545c31bbcdeb2c86085d` |
| `admin-web/tests/fixtures/face-readonly-session-synthetic.mjs` | `74d4b2493de7b88cf4502415ff084325bf8f582e9f10440b42a3a89f7a9eca07` |

## 工件与取件

本机证据根：`D:\chatgpt\smart\FACE-READONLY-ABORT-FIX-20261128T162359-88c200ab`，不在Git内。`log-manifest.json`列原始/脱敏stdout、stderr的相对名、字节数及SHA；`artifact-manifest.json`列其他核心工件。原件留本机受控目录；不是云端可读附件，异机复审须实际取件。

| 相对工件 | bytes | SHA256 |
| --- | ---: | --- |
| `environment.json` | 337 | `1d7ac15d65710a527d576a64e1e536db2b98cbaca2fb8c662f5389fbf0ba950e` |
| `baseline/manifest.json` | 592 | `b77eb0e5d773db5431487687686111799e803f89d6245074366e80bd25b71c22` |
| `focused/summary.json` | 594 | `add49dc6e195eb65605302092f8afaa9bc086db90169d813726f9b3e6f7f464a` |
| `full/summary.json` | 6920 | `2a2192024f72b28577fa1c78aa51f99463352d92424dbd6b4570a4bfeff41e94` |
| `full/source-before.json` | 3280 | `ab4498f3c6c304cd1ab03bd0ec5fee37bb37877e52b0a1ab52e7d3f0004d82c2` |
| `full/source-after.json` | 3301 | `8294b6afb0e8a079efbd89d7fdb3e59b95c722a60393c3282a4677185b40273c` |
| `negative-control/copy-manifest.json` | 3569 | `316cba6c584f40da1b6987649189038de36b212a6e5e6e6cdf486ff307e2b4f5` |
| `negative-control/result.json` | 728 | `905d3ffb88d3d5c1501bddcef3f0dc9eb0446af066ffcb26d662e7a47896dd41` |
| `regression-verification.json` | 1462 | `3de514b9ca8ff7df929786627b9dcb2032a8d55f1ab7478a2e2e527a55f05294` |
| `log-manifest.json` | 8632 | `7d295a5278a7c74847abbac6608c0507f558b5ce6c59f0b37cd7c235448d02e2` |

Git命令stdout/stderr/退出码另存`git-delivery/`，其中result记录实际提交、显式推送和ls-remote远端核验，提交前不预填。完成后生成含脱敏日志、源码/旧源码副本和交付证明的`review-bundle-<提交前12位>.zip`；实际名称、大小、SHA及条目校验见`review-bundle-result.json`，不伪造附件ID。

## 停止边界

本轮仅合成离线验证，保留全部旧证据；没有读取真实凭据/照片/设备证书文件，没有连接设备、改路由、登记/删除人员、开门、清理残留或处理云队列/开关。没有运行E1/E2或生产服务。

实际CLI继续锁定。没有证明真实TLS握手/CA/名称、真实网络中止、实机名单9人或F03FF8DA7299CE148状态、真实EPIPE/OS信号、外部操作者身份认证或现场授权发行。进程内能力不是任意可信JavaScript的安全沙盒；名单及TOCTOU仍为非原子观察。普通推送并核对远端完整SHA后停手，交另一独立Codex复审，不自行宣布P2关闭或E1/E2、实机、派发及上线放行。
