# 本机可信启动层离线接入实施证据（2026-11-28）

实施方交独立复审，不自行宣布验收。固定起点/直接父为`ed3cb0cf5813aa9d61b8e5c4492f273f4de1d422`，独立分支`feat/hk-face-readonly-local-bootstrap-2026-11-28`，新工作树`D:\chatgpt\smart\SMART-PM-face-readonly-local-bootstrap-2026-11-28`。原主工作树、所有旧工作树、Git对象、报告、日志、失败记录和新旧引用均保留。

## 文件范围与实现

仅新增6个Git路径：编排模块`admin-web/lib/face-readonly-local-bootstrap.mjs`，测试`admin-web/tests/face-readonly-local-bootstrap.test.mjs`，两份`face-readonly-local-bootstrap-child.mjs`、`face-readonly-local-bootstrap-synthetic.mjs` fixture，以及[说明](../../ADMIN-FACE-READONLY-LOCAL-BOOTSTRAP.md)和本报告。没有修改继承文件；实际CLI、session、SDK、Host、Policy、旧测试/fixture、UI、worker、配置、依赖、来源清单及全部旧报告原字节不变。

- 默认`createLocalBootstrap`拒绝执行；实际`admin-web/face-readonly.mjs`仍不传runner，保持LIVE_EXECUTION_LOCKED。离线装配必须通过私有WeakMap品牌的合成输入、审批与内存接收器端口，不能从argv/env/JSON提供approved、token、Host/provider/runner或动态模块路径。
- 私密材料只从代码级合成source读取一次，使用TypedArray内部槽及native set复制受限字节，复用严格UTF-8/重复键/字段解析及既有session.prepare，私有快照贯穿审阅和执行；审核后不重读来源。证书及独立预期pin先内存校验，执行仍由原SDK对peer做pin-before-send。输出只安全DTO和固定错误码，不返回原异常、原始响应体、照片或模板。
- 编排上下文同步先消费再await；默认审批拒绝，合成approve/reject仅能返回本域审阅票据。跨域/克隆/布尔/重复/迟到决定不能授权或续发。controller结束不公开session/token/runner，不能重跑；main预检尚未进入适配器时，不虚称session令牌已被消费。
- 证据接收open先于批准与HTTP。虚拟reference只新建、不覆盖，拒绝路径/控制字符等形式；已失败引用保留。未完成材料审查的引用不公开，敏感值碰撞拒绝。receiver只有本次claim的owner能关闭或改状态，顺序或并发复用均不能污染原记录。
- 端口只观察同步契约值或受限原生Promise；返回值Proxy、未知字段、访问器/then及自有constructor等拒绝，不先执行任意then getter。每阶段有限deadline，IO≤5000ms、审批≤30000ms，只能缩短。取消使用addAbortListener，保留首错并关闭内部执行；迟到结果不能恢复。旧Node能力缺失仍仅静态边界，不宣称已实测旧运行时。
- 固定调用session授权、controlled runner及同一main，原真实SDK/Host/Policy贯穿底层假TLS/HTTPS；不新增设备端点。原≤120秒总执行预算、≤5秒单请求、≤256逻辑请求及每个请求原同端点一次Digest往返保持；没有业务重试、写请求或自动恢复。

这些品牌和fixture回调是可信JavaScript的代码级能力，不验证真实操作者身份/现场同意，也不是针对任意可信代码的沙盒。isTransportInstalled不是可由输入提交的安全证明；本轮独立网络守卫与底层假传输共同限定实际测试，不能扩成全机器/其他原生代码网络隔离保证。

## 候选输出与证据完成语义

接收器只在内存按stdout、stderr、main-exit三个固定角色保留候选记录，经seal/close后判断记录完整。没有实现真实文件落盘、ACL、文件身份或原子发布；测试日志及交付证明由本轮外部取证工具另存本机。

`mainExitCode`是候选主函数结果；`exitCode`是编排器最终结果。main0后写入/seal/close失败仍须最终非零、证据不完整；已捕获的成功行及候选0不能单独作成功。`evidence.status=COMPLETE`只表示工件记录完整，查询拒绝可以有完整证据但最终仍非零。更早的设备/策略错误仍按首错保留，不能用后续收尾成功覆盖，也不承诺覆盖首错为另一个系统错误类别。

敏感值检查只针对动态DTO文本，不将固定JSON键或协议枚举视为凭据回显；合法账号名readonly/list或同名密码不会仅因协议词碰撞被误拒，动态字段及reference保护仍在。全部输出保持siteVerification=NOT_EXECUTED、deleteAllowed=false，不能把合成成功换成现场PASS。仅可释放引用和清零持有的可变缓冲，不宣称JavaScript字符串已被可靠擦除。

## 本机真实执行

2026-11-28T18:21:10+08:00记录：Windows 23H2 build22631.6199、Node v24.16.0、Windows PowerShell 5.1.22621.6133、PowerShell 7.6.9。没有安装或升级运行时/依赖，也未修改网络、Git全局/系统、TLS或组织安全策略。

正式聚焦命令：`node --test --test-reporter=tap admin-web/tests/face-readonly-local-bootstrap.test.mjs`；实际100/100、exit0，2026-11-28T18:49:22+08:00至2026-11-28T18:49:26+08:00。正式全量窗口2026-11-28T18:49:37+08:00至2026-11-28T18:51:42+08:00；完整argv及每组退出码见`full-r2/summary.json`，沿用原五组，仅admin追加新测试文件。正式命令进程的stdout/stderr先按原始字节分别保存，进程退出码立即写同名exit文件，再解析TAP；外层工具exit不代替测试进程。

| 正式分组 | tests | pass | fail | skipped | exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| admin-final | 782 | 782 | 0 | 0 | 0 |
| tenant-final | 6 | 6 | 0 | 0 | 0 |
| root-final | 297 | 297 | 0 | 0 | 0 |
| worker-final | 35 | 35 | 0 | 0 | 0 |
| worker-guard-selfcheck-final | 2 | 2 | 0 | 0 | 0 |
| 合计 | 1122 | 1122 | 0 | 0 | 各组0 |

原1022+新增100=1122项通过，fail/cancelled/skipped/todo均0。旧argv与TAP名称多重集保留，原27项受保护源码哈希不变。新增100测试与7个describe标题分开统计；聚焦结果不重复加进全量总数。首轮focused95/95及full1117/1117通过，源字节和日志保留在focused/、full/；其报告和生成器原字节另存history-r1/。收尾静审发现整份JSON敏感词扫描会误拒合法readonly/list账号，最小修正为解析后只扫描动态文本，并新增正控及敏感动态值负例；当前focused-r2/、full-r2/为修正后的独立复测，不覆盖首轮。首轮和本轮都没有正式套件失败，故意退化失败另列。

用例覆盖默认锁定、私有端口品牌与非法句柄、源字节/expectations突变、非法UTF-8和重复JSON键、返回值getter/Proxy、一次上下文并发、未批准/拒绝/重复/跨域/迟到票据、源/审批/接收器超时、准备失败零网络、引用路径/覆盖/早期及敏感换标签、顺序与并发receiver所有权、候选main0但最终close失败、完整拒绝证据仍非零、旧pin/身份/计划/人数/目标门禁、吞传播取消及真实子进程main/最终exit一致、实际CLI/env/argv保持锁定。第二轮另有3个协议词凭据正控和2个动态serial/SPKI反射负例，后两者证明继承Session保护仍在，不宣称逐字段单独验证新收集器。用例目标为合成9人及SYNTHFACE9，另含8/10人等反例；不是现场名单或F03FF8DA7299CE148证据。

三个相关静态检查exit0。verify-import仍实际exit1：`cloudfunctions/login/config.json`实际SHA256=`aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`、来源预期=`ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`；未改配置或清单凑绿。旧首次CLI 33/34、exit1、首版源码和日志仍保留在原`FACE-READONLY-CLI-OFFLINE-20261128T042047-600ed848`，不能被本次通过覆盖。

## 工件副本负控

首轮两项负控保留在negative-controls/，第二轮三项在`negative-controls-r2/`。前两项各只改变一处门禁，第三项仅将新模块替换为首轮full/source/中的原始字节；其他副本和受测工作树不变，不修改旧证据。

| 负控 | 退化 | tests/pass/fail | 进程exit | 原始失败所证明 |
| --- | --- | --- | ---: | --- |
| context-once | 省略state.used=true | 1/0/1 | 1 | 预期1个LOCAL_CONTEXT_USED拒绝实际为0；不等价于证明发出了两轮HTTP |
| evidence-before-approval | 跳过open准备阶段 | 1/0/1 | 1 | 预期退出码集合[2,4,5]包含断言实际为false；该原始失败不单独证明实际exitCode=0或审批/HTTP次数 |
| protocol-word-collision | 替换为R1整份JSON扫描的模块 | 1/0/1 | 1 | 合法readonly账号完成断言被旧模块误拒，新正控可检出 |

故意失败单独保留，不计入正式通过数。完整复制清单、唯一文件变化前后SHA、真实命令、stdout/stderr及exit见各copy-manifest/result。只证明相应回归检出所列退化，不宣称全部门禁均做变异负控。

## 源码前后哈希

以下31项在测试前、后、当前磁盘及`full-r2/source/`一致；其中27项继承不变，新增模块/测试/fixture共4项。实际CLI继续保持原a5f9…SHA。仅所列文件做本轮逐项哈希，不扩大为所有传递依赖逐项取证；Git范围检查另保证没有修改任何继承路径。

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
| `admin-web/lib/face-readonly-local-bootstrap.mjs` | `47db5b7dbcbd3571ce8cd5eba714907dcb0347019b572aa5f2c3c4b9d5ed1963` |
| `admin-web/tests/face-readonly-local-bootstrap.test.mjs` | `937dfe5f322db0920b04d538bcf880b188d41125bc115e5ed349d19ad51e2d57` |
| `admin-web/tests/fixtures/face-readonly-local-bootstrap-child.mjs` | `1878e07aefb5eac0633b02b52126b3bcb392df7b87f5708be970c580779e2bf1` |
| `admin-web/tests/fixtures/face-readonly-local-bootstrap-synthetic.mjs` | `8b844c4c3a432af44560449316e6fdc0d43736d38323ff591423a494fc2da0fd` |

交付阶段另核对受测字节、两份新文档及两份保护旧报告的index/commit blob，实际条目数和结果写入git-delivery；固定父、仅新增路径、diff/show检查、显式push及ls-remote均以真实日志为准，提交前不预填SHA。

## 工件与取件

本机证据根：`D:\chatgpt\smart\FACE-READONLY-LOCAL-BOOTSTRAP-20261128T182110-f33fd780`，不写Git。`log-manifest-full-r2.json`列原始/脱敏stdout、stderr相对名、字节数及SHA；原件保持本机受控。`artifact-manifest-full-r2.json`列以下核心工件，首轮manifest未覆盖。不是云端附件，异机复审须实际取件，不能把本机路径冒充附件ID。

| 相对工件 | bytes | SHA256 |
| --- | ---: | --- |
| `environment.json` | 337 | `737e5973775331f53d184ffcda15b77c11285ab471db0ab400f88964730bbc3e` |
| `history-r1/manifest.json` | 645 | `abc653ca96bc014797761f5b48a61139afb687421cb62d4c703249e865369c6a` |
| `focused/summary.json` | 604 | `f61593a8228dc80578b4511d51dc8a02215e5daa805e7e11905ff4d1c2f7a3d0` |
| `full/summary.json` | 6987 | `5dcf493e212fb95214b6ffe8070be2148fc36f6df44f71e9ae4c9f327797fea0` |
| `focused-r2/summary.json` | 609 | `ac69c364e2aaed299f08f74b0b172c81962365114425dfee9efc61a3bc38e2ad` |
| `full-r2/summary.json` | 6990 | `179ebfb79cd6b009dba3d5a086fd5fb2bc6a75677c4401badfb04869a1d03a84` |
| `full-r2/source-before.json` | 3817 | `8968e9dfaf616d1309c20fe04997d4b2c9b09ee73c06bf3bc5b448c2341351ab` |
| `full-r2/source-after.json` | 3838 | `aec51395e08d2cbf02407a3dd0e7d52c0d068a5b22b040782bb111c0cbab7ab2` |
| `negative-controls-r2/context-once/result.json` | 735 | `38232efe940561d9fec9446335f30eeb1c3196fe81e2c76b5e378c8911dc588a` |
| `negative-controls-r2/context-once/copy-manifest.json` | 3936 | `623e89b6589a2d813e2ea5f8a57cec167c1e506adda8faba260183d74c801ad3` |
| `negative-controls-r2/evidence-before-approval/result.json` | 751 | `ab9ce22956231f5f722ee3ea792ae082fa410c12ac2869dbd3fc940218d1bb70` |
| `negative-controls-r2/evidence-before-approval/copy-manifest.json` | 3961 | `d050da82e74ee306391f6ed0e10e47ec59c5376030924382468611780eb26800` |
| `negative-controls-r2/protocol-word-collision/result.json` | 769 | `2c417fad55e597c2aa69b96a06da96f8f43cd008761d888b8c5170fe320c8b88` |
| `negative-controls-r2/protocol-word-collision/copy-manifest.json` | 3981 | `41817baff0dd0ec1809907069ed85bbff1135ef3f153e79d23cb4787402db5ee` |
| `regression-verification-full-r2.json` | 1667 | `04fdcb24a705bf5c301fd7e244427b30cb763e98fe54426ba09aa81fa8193f88` |
| `log-manifest-full-r2.json` | 18462 | `8c0d66f36b0cb81a419389ab0d40d2100876c2a7032efe62187de7d4458b2259` |

实际Git交付证明另存git-delivery；提交后生成含脱敏日志、源码/退化副本、文档及交付证明的review-bundle-<提交前12位>.zip，实际文件名、大小、SHA和逐项校验记录写入review-bundle-result.json，不虚构附件。

## 停止边界

本轮未读取真实凭据、照片或设备证书文件，未连接设备、改路由、登记/删除人员、开门、处理云派发/开关或旧队列，未清理任何旧对象或残留。仅根执行回归及取证工具，子任务没有运行项目/测试。全部旧对象、报告、日志、失败和新旧引用保留。

实际CLI仍锁定。没有验证真实身份/人工审批、Windows私密输入、真实证据文件/ACL/身份/TOCTOU、真实TLS/网络中止、真实OS信号/EPIPE、现场9人/F03状态、刷脸或网页显示。没有运行或放行E1/E2、实机、派发、部署、上线。普通推送并核对远端完整SHA后停手交另一独立复审，不自行宣布验收。
