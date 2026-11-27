# 只读复验宿主实施与合成验证（2026-11-28）

实施方交独立复审。固定基线/直接父提交为 `b873465808b312246cc454e7b102ff49f4e66e86`；独立分支 `feat/hk-face-readonly-host-2026-11-28`，独立工作树 `D:\chatgpt\smart\SMART-PM-face-readonly-host-2026-11-28`。保留原发布、实现、修复、文档工作树及全部新旧证据，没有切换或清理他人工作树。

本轮只新增两项生产模块、两项测试、一项假传输fixture、[使用说明](../../ADMIN-FACE-READONLY-HOST.md)和本报告，共7个路径。所有既有源码、测试、SDK、源哈希清单、依赖、配置、旧报告、原始日志及残留引用原字节不变。

## 实现

- `admin-web/lib/face-readonly-host.mjs`：只接受connect、单次list、state、disconnect/close；拒绝登记、删除、跟进删除及未知操作/参数，窄provider代理只含describe/list/close。配置仅本机调用方内存提供，模块不读取文件、环境或真实连接材料，不自动创建服务或联网。
- `admin-web/lib/face-readonly-policy.mjs`：method+精确path/query+阶段+规范正文白名单。默认拒绝，不用GET/POST类别代替业务判断；计划编号绑定本次读回引用，人员编号绑定本次完整分页，库类型/编号绑定本次描述结果。
- 任一层异常都触发宿主不可重置的首错误码熔断、关闭客户端；出站前、响应后及顶层完成前再次检查。provider即使吞掉FDSearch异常继续遍历，也不能再发网或返回假COMPLETE。关闭期间不能复活，放弃的晚响应缓冲清零。
- 继续使用原SDK的pin-before-send和Digest；缺证书、错误pin或缺peer证书时零HTTP。没有修改SDK、TLS/ACL/session/Origin/CSRF门禁，也没有设置任何派发或设备操作开关。
- 仅回传安全投影，不透传整份能力响应、连接字段、照片URL/模板；名单动作标志deleteAllowed强制false，保留人脸观测结果。单会话连接/list一次；总时限120s、单请求5s、逻辑请求256均仅能缩短；单调时钟与取消race确保停止。

精确请求白名单、条件性fallback、引用链绑定及生命周期见使用说明。所有PUT/DELETE和未知POST均拒绝，包含UserInfo/Record等写POST；干净复验也不开放DeleteProcess。默认后台、worker和CLI没有接入或启动本宿主；不是完整CLI或现场运行器交付。未来接入本机后台必须显式注入host并继续原鉴权。

## 实际环境与运行

2026-11-28，Asia/Shanghai；Windows 23H2 build22631.6199，Node v24.16.0，PowerShell7.6.9，Windows PowerShell5.1.22621.6133。没有安装/升级依赖、WSL或运行时，没有修改路由、证书、安全策略或全局/系统Git配置。

首次策略聚焦：62/62，exit0。首次宿主聚焦：81项中80通过/1失败，exit1；失败仅为悬挂响应时宿主看门狗先于SDK截止时间触发，实际READONLY_REQUEST_TIMEOUT与测试预期HIKVISION_TIMEOUT不一致。保留原始日志及首次测试源码副本；将该项改名为HTTPS response watchdog timeout并保持精确码断言为READONLY_REQUEST_TIMEOUT，未删除/跳过断言或改变阻断实现。

随后第一轮全量891/891通过，日志在根目录。实施侧复核发现只读名单沿用底层deleteAllowed可能为true，于宿主复制投影为false，并增加正控断言；随后在final-r2新目录重新运行以下全部套件，不覆盖第一轮结果。

最终完整运行时间：2026-11-28T03:49:39+08:00—2026-11-28T03:50:37+08:00。

| 最终分组 | tests | pass | fail | skipped | exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| admin-final | 551 | 551 | 0 | 0 | 0 |
| tenant-final | 6 | 6 | 0 | 0 | 0 |
| root-final | 297 | 297 | 0 | 0 | 0 |
| worker-final | 35 | 35 | 0 | 0 | 0 |
| worker-guard-selfcheck-final | 2 | 2 | 0 | 0 | 0 |

最终891/891通过，为原748项加新增143项（host81、policy62），fail/cancelled/skipped/todo均0。原50个测试文件保留，新增两个测试文件，共52个。按原始TAP名称多重集及命令参数核对，原748项名称全保留；新增143个测试及1个describe套件标题，不能把标题额外计成测试。

普通admin组24文件用 `node --test --test-reporter=tap`；tenant一文件和根目录23文件用原 `tests/support/d-network-guard.cjs`；worker三文件及单独守卫自检用worker原守卫。新增143项全部合成输入及假传输，不listen、不DNS、不访问设备。原748项中的合成loopback HTTP/TLS和PowerShell包装器照常回归，没有跳过。

完整参数、每组起止时间及实际退出码在 `final-r2/final-offline-summary.json`，启动方式在同目录 `run-final-offline.ps1`。stdout/stderr分别保存，Node返回后立即保存LASTEXITCODE，再解析TAP。未把外层证据脚本的退出0当成测试退出码。

三项相关静态检查exit0；`verify-import`仍实际exit1：旧基线 `cloudfunctions/login/config.json`实际SHA `aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`，provenance预期 `ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`。未改文件或旧provenance凑匹配，不能称全部静态检查通过。

## 验证证据的含义

host81项覆盖完整描述/计划/分页/逐人逐库正控、两层阻写、额外参数/Proxy/getter、缺失或非法预期证书、错误/缺失peer证书、同公钥续证、Digest、超时/错误/重定向、错误响应、provider吞异常时熔断、预算/生命周期、并发close/disconnect、晚响应清零及后续零请求。policy62项覆盖路径/query/正文注入、规范重编码、响应重复键、引用提前/越界、错误优先、XML fallback、未知库、分页/完整性/精确FPID等。

新增假传输只patch Node的TLS/HTTPS底层；真实HikvisionClient仍执行X509解析、公钥SPKI SHA256比较、PinnedAgent回调和Digest。错pin、缺peer证书的测试明确断言零HTTP及后续零请求；缺预期证书还断言零TLS。HTTP计数表示假设备获得可发送socket后的HTTP，不把创建https.request对象当成已发送HTTP。

fixture负控故意模拟Agent在验证前同步返回socket，必须观察到1次提前HTTP，使计数器能检出该类回归；该负控测试本身按预期通过，不是本宿主实际发送了未校验HTTP。TLS/证书验证的真实网络、CA和主机名行为未在新增假传输中实测。原SDK字节未改，但不得将此合成证据写成现场TLS、设备身份或VPN已通过。

256是逻辑SDK.request预算；原SDK一次401后的同端点Digest认证重发保留，每个逻辑请求最多两次HTTP。没有其他重试；逻辑请求、HTTP、TLS连接三个计数不能混同。默认developmentTls=false；true只是既有CA/名称例外，pin仍强制，不能称完整TLS信任通过。

## 源码前后哈希

以下15项测试前后、最终磁盘一致。报告与使用说明在测试后整理，不改变受测代码。提交前后另将Git index/提交blob与这些受测字节核对。

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
| `admin-web/lib/face-readonly-host.mjs` | `67d1f13b75d203ec032232395b16954aabb006ba88c33a278a7ffd5843d6082b` |
| `admin-web/lib/face-readonly-policy.mjs` | `3e4ea808e88c6822d26328d5a2d7af759f659b5d7329d9873c4d8a02e7b9f657` |
| `admin-web/tests/face-readonly-host.test.mjs` | `d3cbd900cbd03c8e469bbff636a5e48aeaf171449f576e75e5acfb0cb1e6f112` |
| `admin-web/tests/face-readonly-policy.test.mjs` | `89dd1e481065849b6afd5fff6d08938a06f26542f2ad2a13f83813a5ebc72277` |
| `admin-web/tests/fixtures/face-readonly-fake-transport.mjs` | `2c6c55ed2ee7e7b4abb43e08b407f1b777e3f77e8253bee5b439f25aee27451a` |

## 工件

本机根目录：`D:\chatgpt\smart\FACE-READONLY-HOST-VALIDATION-20261128T034532-75d5785c`。表中相对名是真实本机文件，非云端附件；异机复审需实际取件。原始日志、失败记录、首次源码副本及第一轮全量结果均保留；脱敏副本移除个人profile路径和SID，不提交真实材料。完整清单为 `artifact-manifest.json`，原748项核对为 `regression-verification.json`。

| 相对工件 | bytes | SHA256 |
| --- | ---: | --- |
| `environment.json` | 293 | `5c674c9d1c19a98fffff5d489ed862f3a8b6967fe29c5ef353ee11d5f5b69490` |
| `regression-verification.json` | 12638 | `742472d9c10a3403bfe83f14d110c8e3af592f7da7c39204dc97cead9dfd515b` |
| `host-initial.stdout.log` | 21241 | `1cfe6b78d06fa5aac194b8f7cf1a1d68204a170e8f9d4e3d280cdfc7c6e92e59` |
| `host-initial.stdout.redacted.log` | 21241 | `1cfe6b78d06fa5aac194b8f7cf1a1d68204a170e8f9d4e3d280cdfc7c6e92e59` |
| `host-initial.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `host-initial.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `host-initial.exit.txt` | 2 | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |
| `policy-initial.stdout.log` | 11717 | `f850274d15fa9e6c00999554f45d9d9d2d895b28600b191017c995bb7856dab6` |
| `policy-initial.stdout.redacted.log` | 11717 | `f850274d15fa9e6c00999554f45d9d9d2d895b28600b191017c995bb7856dab6` |
| `policy-initial.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `policy-initial.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `policy-initial.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `final-r2/final-offline-summary.json` | 6574 | `7aa5de0a4caced19ac1367962a2d75c931fb040399a8fe76d5ac3e5c2ed0f139` |
| `final-r2/final-offline-source-before.json` | 1777 | `d40716dfb49253826e132b4f17ce60cc4268e9f66a8b24cfc77db5ac814c1e7a` |
| `final-r2/final-offline-source-after.json` | 1799 | `39ae001b277431654415f29eb9963a32e09844ecd0fdc3c353266291794b5f7b` |
| `final-r2/admin-final.stdout.log` | 123136 | `b93453669790612ad12411ce5763ae030a5ac38a20639c11b06a83aedec064a4` |
| `final-r2/admin-final.stdout.redacted.log` | 123136 | `b93453669790612ad12411ce5763ae030a5ac38a20639c11b06a83aedec064a4` |
| `final-r2/admin-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/admin-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/admin-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `final-r2/tenant-final.stdout.log` | 1451 | `22cf343fe034f5f69b16dc19e2f6c6df3819d43dacb377d45915cc5be287ccfa` |
| `final-r2/tenant-final.stdout.redacted.log` | 1451 | `22cf343fe034f5f69b16dc19e2f6c6df3819d43dacb377d45915cc5be287ccfa` |
| `final-r2/tenant-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/tenant-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/tenant-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `final-r2/root-final.stdout.log` | 98301 | `fa688cd9687f189c18cfa21c5953a2c88e7e5bd923fa4ca8e8a03cecfe63b37a` |
| `final-r2/root-final.stdout.redacted.log` | 98301 | `fa688cd9687f189c18cfa21c5953a2c88e7e5bd923fa4ca8e8a03cecfe63b37a` |
| `final-r2/root-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/root-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/root-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `final-r2/worker-final.stdout.log` | 17402 | `391c3e9a9295e5ac341f3d46b4cf7c27f48990de0fb0c1e95e123eb56fbfc644` |
| `final-r2/worker-final.stdout.redacted.log` | 17402 | `391c3e9a9295e5ac341f3d46b4cf7c27f48990de0fb0c1e95e123eb56fbfc644` |
| `final-r2/worker-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/worker-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/worker-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `final-r2/worker-guard-selfcheck-final.stdout.log` | 501 | `a70283807277ac959c2cd99f730191cd30b32d19859e30d34fe5d41a9a13f514` |
| `final-r2/worker-guard-selfcheck-final.stdout.redacted.log` | 501 | `a70283807277ac959c2cd99f730191cd30b32d19859e30d34fe5d41a9a13f514` |
| `final-r2/worker-guard-selfcheck-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/worker-guard-selfcheck-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/worker-guard-selfcheck-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `final-r2/check-miniprogram-final.stdout.log` | 185 | `89535f0f900b0398830261e5ff0bddccdc309c859b94c34154d63f5a3994a2e0` |
| `final-r2/check-miniprogram-final.stdout.redacted.log` | 185 | `89535f0f900b0398830261e5ff0bddccdc309c859b94c34154d63f5a3994a2e0` |
| `final-r2/check-miniprogram-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/check-miniprogram-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/check-miniprogram-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `final-r2/checkin-face-static-final.stdout.log` | 73 | `d3acf855ec25633177b8dfd2e04b93d122d66e0cdd7dc17fadde902208d790ad` |
| `final-r2/checkin-face-static-final.stdout.redacted.log` | 73 | `d3acf855ec25633177b8dfd2e04b93d122d66e0cdd7dc17fadde902208d790ad` |
| `final-r2/checkin-face-static-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/checkin-face-static-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/checkin-face-static-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `final-r2/verify-face-sources-final.stdout.log` | 28289 | `8f870ecadb3604229733cc8d592e52c7aab89429f86327a888decc6b1b8ac5d3` |
| `final-r2/verify-face-sources-final.stdout.redacted.log` | 28289 | `8f870ecadb3604229733cc8d592e52c7aab89429f86327a888decc6b1b8ac5d3` |
| `final-r2/verify-face-sources-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/verify-face-sources-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/verify-face-sources-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `final-r2/verify-import-final.stdout.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/verify-import-final.stdout.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `final-r2/verify-import-final.stderr.log` | 938 | `c9c7b73979a6694a497d62e02b60bac5728e4310549d21b7f396b16b9621baee` |
| `final-r2/verify-import-final.stderr.redacted.log` | 938 | `c9c7b73979a6694a497d62e02b60bac5728e4310549d21b7f396b16b9621baee` |
| `final-r2/verify-import-final.exit.txt` | 2 | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |

旧修复/验收的日志与报告、本机证书/照片/连接资料所在目录及残留引用均未读取或清理。本轮无任何新增实机证据，旧9人和F03FF8DA7299CE148“可见光已入库”仍待授权现场复验，不用合成人员替代真值。

## 停止边界

真实凭据/照片读取、设备连接、路由修改、人员登记/删除、开门、云配置/队列修改、派发、残留清理及E1/E2均0。没有运行旧probe CLI、现场只读会话或生产服务。

本宿主只约束一次显式的只读会话，不内置9人及真实目标员工验收真值，不代表完整CLI或现场UI接入。名单查询也非原子快照；原P1最终读取至设备处理PUT之间的非原子、相同投影替换等边界仍保留，不因此扩大为实机删除/开门、E1/E2或上线放行。

仅确认本轮实现和合成验证结果，提交推送后交独立复审，不自行宣布最终验收关闭。普通显式推送独立分支并核对远端完整SHA；不改历史、不强推、不推main。Git检查、提交字节、远端及干净工作树结果另存本机交付证据。
