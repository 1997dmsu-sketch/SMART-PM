# 受控只读CLI离线接入实施与证据（2026-11-28）

实施方交独立复审，不自行宣布最终验收。固定基线/直接父提交为 `c3f8176d33f43e14aa498aa52679e29865ac0674`；独立分支 `feat/hk-face-readonly-cli-offline-2026-11-28`，新工作树 `D:\chatgpt\smart\SMART-PM-face-readonly-cli-offline-2026-11-28`。保留其他工作树和全部旧证据。

## 文件范围与实现

本次仅新增9个路径：`admin-web/face-readonly.mjs`、`admin-web/lib/face-readonly-command.mjs`、`admin-web/tests/face-readonly-cli.test.mjs`、4份`face-readonly-cli-*`测试fixture、[使用说明](../../ADMIN-FACE-READONLY-CLI-OFFLINE.md)及本报告。旧SDK、宿主、策略、登记CLI/包装器、后台、UI、worker、依赖、配置、来源清单、报告及日志均未修改。

- 实际可执行入口不提供runner，合法离线输入仍返回`LIVE_EXECUTION_LOCKED`、exit5。无argv/env/JSON或隐藏开关能解锁；help不读stdin或连接材料。顶层仅接受operation=list、mode=offline；config只收内存证书，不接受路径、照片、通用请求或加载模块。
- 32KiB原始UTF-8输入、有限输入期限、单个严格JSON；拒绝非法EOF/BOM、重复解码键、过深结构、未知字段/动作和错误类型。凭据仅在合成内存输入中；不读取真实材料。
- 测试子进程先装独立Node网络守卫及合成TLS/HTTPS底层，再经同一CLI main和品牌化runner，固定new真实FaceReadonlyHost。真实SDK证书解析/SPKI pin、宿主和策略均执行；不能由输入注入host/provider/任意request。代码级fixture能力不是任意可信JS的安全沙盒。
- 固定一次connect、一次完整list、finally close；保留全部精确白名单、双层阻写、缺证书/错pin零HTTP、首错熔断及仅可缩短的120秒/5秒/256逻辑请求预算。没有业务自动重试；Digest既有一次认证往返保留。
- 输出重建安全投影，包含人员/库状态与全天计划证明，deleteAllowed恒false。普通文本与输入敏感值冲突时清空；身份、FDID、型号、模板及指纹等关键值不能投影为空，否则READONLY_OUTPUT、非零。原始错误及堆栈不回显。
- 写流必须等callback/Promise，延后错误及throw null/reject undefined也不能报成功。取消在输出前或输出时均使最终非零；已提交到流的字节不能撤回，消费者须以最终退出码及完整协议判断，不可单看旧成功行。未新增PowerShell包装器或把旧48秒包装器接到120秒宿主。

## 本机环境及实际执行

环境记录于2026-11-28T04:20:47+08:00：Windows 23H2 build22631.6199，Node v24.16.0，Windows PowerShell5.1.22621.6133、PowerShell7.6.9。协作执行曾因额度中断；负责人继续后完成剩余修改，正式测试实际在11:54以后执行，未回填凌晨时间。没有安装依赖/运行时、绕过执行策略或更改Git/TLS/路由配置。初期规则文件发现曾返回旧受控目录ACCESS_DENIED，未取得内容、改变权限或重试绕过，后续只读明确项目及合成证据路径。

聚焦实际命令为`node --test --test-reporter=tap admin-web/tests/face-readonly-cli.test.mjs`。第一次33/34、exit1，失败为face-error场景的测试期望13个HTTP，实际12；按9次描述/计划读取+2页人员+1次人脸查询核对后，仅修正精确计数为12，并加完整12条路径顺序断言。没有修改生产门禁、跳过或删除断言；首次源码和原stdout/stderr/exit均保留。第二次34/34、exit0。

正式完整回归窗口为2026-11-28T11:56:25+08:00至2026-11-28T11:58:23+08:00；由本机证据目录`run-validation.mjs full`串行启动原五组及静态检查，完整实际argv见`full/summary.json`，原891组参数只给admin追加新测试文件。各进程stdout/stderr直存原始字节，关闭时先保存真实exit再解析统计；外层脚本退出码不代替各组真值。

| 分组 | tests | pass | fail | skipped | exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| admin-final | 585 | 585 | 0 | 0 | 0 |
| tenant-final | 6 | 6 | 0 | 0 | 0 |
| root-final | 297 | 297 | 0 | 0 | 0 |
| worker-final | 35 | 35 | 0 | 0 | 0 |
| worker-guard-selfcheck-final | 2 | 2 | 0 | 0 | 0 |
| 合计 | 925 | 925 | 0 | 0 | 0 |

最终原891+新增34=925项通过，cancelled/todo也为0。原52个测试文件保留，新增1个，共53个。TAP名称多重集确认原项均在；新入口两个describe标题不额外计为测试。新增覆盖真实子进程锁定、输入边界、完整分页/逐人逐库、缺证书和错pin零HTTP、熔断、取消、敏感值投影及写流异常。旧891中的合成loopback HTTP/TLS与PowerShell包装器仍按原参数运行；这不代表新增假传输覆盖真实TLS或设备。

三项相关静态检查exit0；`verify-import`仍是exit1的已知基线失败：`cloudfunctions/login/config.json`实际SHA256为`aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`，旧provenance预期`ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`。未改该文件或来源清单凑匹配，不能称所有静态检查通过。

## 故意失败负控

仅在独立工件副本移除runner品牌检查，运行`node --test --test-reporter=tap --test-name-pattern="an unbranded runner" <工件副本中的测试文件>`；完整实值argv、复制清单/变更前后SHA和结果在`negative-control/`。实际exit=1，tests=1、pass=0、fail=1、skipped=0。该故意失败按预期被检出，不能计入正式通过总数。原件未修改，副本与失败日志不清理；负控只调用安全假runner，不访问设备。

## 受测源码前后哈希

以下22项在最终测试前、后及交付磁盘一致；其中15项继承文件与既有受测哈希一致。提交时另核对暂存/提交Git blob与受测字节，不让换行转换改变交付。文档在测试后整理，不改变受测代码。

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
| `admin-web/face-readonly.mjs` | `a11cb407b4fd698b4334e747ef248ae25f4c1507cc2b5ca3912a189aa685f763` |
| `admin-web/lib/face-readonly-command.mjs` | `c09097491de33a627eb0f21797eb8d3b2d3b52c406efaeb671c61f414c302301` |
| `admin-web/tests/face-readonly-cli.test.mjs` | `bc5d1633fd01f88c123fc3c2d40d3fec4a3dfdfbb634877205f3b80709ed38c5` |
| `admin-web/tests/fixtures/face-readonly-cli-child.mjs` | `9bc07247acd5950a15bafe0a69abcee147cc2d674531b7ecdda352a6f027ff49` |
| `admin-web/tests/fixtures/face-readonly-cli-network-guard.mjs` | `170fecbf6df460f11141b5f735737ccea1f58850b210bf77f43e8826d50dd6fc` |
| `admin-web/tests/fixtures/face-readonly-cli-synthetic-adapter.mjs` | `9ee6d4d96cfb18c5f521265f339e390a89bd10368c88b13b9d83c1c3af1b42c2` |
| `admin-web/tests/fixtures/face-readonly-cli-synthetic-input.mjs` | `3d248af179c5cc6c1fdb8764cbde9a9b36bfdfba30d911dbe4a86d19831cdf03` |

## 工件及取件

真实本机目录：`D:\chatgpt\smart\FACE-READONLY-CLI-OFFLINE-20261128T042047-600ed848`。不是云端附件；异机复审须实际取件。本报告仅引用本轮新工件，不覆盖此前证据。原始stdout/stderr与逐项exit保留，脱敏副本去除个人profile前缀/SID；`log-manifest.json`列每份原始/脱敏副本的相对名、字节数、SHA256。`artifact-manifest.json`为本轮核心工件清单，提交/远端核验记录在交付后另存，不能冒充测试结果。

| 关键相对工件 | bytes | SHA256 |
| --- | ---: | --- |
| `environment.json` | 341 | `249772652d6b83c7dd9d3e208a4b8c7dd5989e44f24075afe57752d16e3895d2` |
| `focused/summary.json` | 586 | `22224bfae0291749c01864026f0f8a1d88c9b3b0410583d3f1792f69e7ca7958` |
| `face-readonly-cli.first-attempt.test.mjs` | 24505 | `80132317761025612bf5bbeb36962f5835430b0346385a3e852912f98ba2ec03` |
| `focused-r2/summary.json` | 589 | `5db2f7bb57708ce8ce508c438e62cfc1c6ec01ee3253a6164303657e8be0da3d` |
| `full/summary.json` | 6862 | `8324911a07b56098f8aea2f32bf2126ded14847a3aaad744390a89e95e5a7ffd` |
| `full/source-before.json` | 2635 | `34492237ea7e8829cf482201a94503da3994646e91be626c653cf2b2f889d784` |
| `full/source-after.json` | 2656 | `58e621b502c73b24609fdf469415edfe26a5a235c526a251311827970c3564a9` |
| `negative-control/result.json` | 628 | `471a04be9f2ab75b5ba8ac4511ed847791c6dea12805042e5ef009c8cfc2dd19` |
| `negative-control/copy-manifest.json` | 3172 | `68b6c688bedd9a809280332626a3134ec61a2327d2e0959b14cc281245d7c011` |
| `regression-verification.json` | 1292 | `949949fcae137f3cfad2443362beff3e4ebbde0c6865e6730e230730451f8f1f` |
| `log-manifest.json` | 8576 | `041ec9c4f666f35d00fba874d3852066b61d88727fb9ec646142171c15b7ec35` |

`tested-source/`保留受测22份源码字节供核对。提交后另生成含脱敏日志及交付记录的`review-bundle-<提交前12位>.zip`，名称/大小/SHA保存在`review-bundle-result.json`并随最终回报提供；本报告不伪造尚未生成的附件ID。

## 未验证与停止边界

本轮真实凭据/照片读取、设备连接、路由修改、人员登记/删除、开门、残留清理、云配置/队列或派发操作均0。实机执行保持锁定，不运行旧probe、E1/E2或生产服务。原全部报告、原始日志、失败记录及新旧残留引用均保留。

本次只交付受控CLI离线接入。未验收真实TLS握手/CA/名称、现场证书及设备身份、VPN、新路由、可用实机CLI、网页展示或E1/E2/上线。现场9人与F03FF8DA7299CE148“可见光已入库”仍UNVERIFIED，合成EMP1/EMP2不是真值。名单非原子快照；旧P1最终读取到设备处理PUT间非原子及相同投影替换边界保持。

普通显式推送本次独立分支并核对远端完整SHA后停手，交另一独立复审，不自行放开实机执行或宣布验收关闭。
