# 只读复验宿主限定验收记录（2026-11-28）

## 对象、依据与结论

本文件固化已完成的最终独立复审结论，记录日期为2026-11-28（Asia/Shanghai）。本次文档工作不重新运行测试或现场会话；新增文档的提交仍须交另一独立复审。

- 验收对象：`56f345fc8f3823cd0adaa853c81a64279f61e945`。
- 对象的直接父提交：`b873465808b312246cc454e7b102ff49f4e66e86`。
- 文档分支：`docs/hk-face-readonly-acceptance-2026-11-28`，直接从上述验收对象建立；本次仅新增本文件。
- 依据：[实施与合成验证报告](READONLY-HOST-IMPLEMENTATION-2026-11-28.md)、[宿主使用说明](../../ADMIN-FACE-READONLY-HOST.md)、固定提交源码、既有原始日志/退出码、前后哈希、Git blob及工件清单。

最终独立复审未发现新增阻断项，**限定验收通过**：接受只读宿主库、双层阻写及精确请求策略的实现，以及原748项加新增143项、共891项合成验证证据。该结论不包括真实TLS、完整CLI/后台接入、现场名单或设备身份确认，不作E1/E2或上线放行。

验收对象只新增7个路径（两项模块、两项测试、一项假传输fixture、使用说明和实施报告）；既有SDK、服务、后台入口、UI、worker、依赖、配置及旧证据未修改。实施报告和使用说明中的“待独立复审”保留为当时交付状态，不回改历史文件。

## 已核对的只读门禁

1. `FaceReadonlyHost`复用既有`HikvisionClient`、`HikvisionFaceProvider`和`FaceEnrollmentService`。导入及构造不读取文件、环境变量或连接材料，不自动联网或启动服务。默认admin-web、worker和CLI未接入本宿主。
2. 入口只允许一次connect、一次完整list、state和disconnect/close；派发入口仅接受connect/list/state/disconnect。登记、重试登记、verify、准备删除、删除、跟进删除及未知操作/参数均拒绝并熔断。底层服务只得到冻结的describe/list/close窄provider代理，不能取得原SDK通用请求入口。
3. 出站策略按method、完整path/query、当前阶段及规范正文精确授权，默认拒绝。计划数字路径绑定本次读回引用，人员绑定本次完整分页，库类型/编号绑定本次描述。条件性Count和门能力GET仅在规定缺项时允许；不按路径前缀放行。所有PUT/DELETE、未知POST、额外query、重定向、照片URL及DeleteProcess均拒绝。名单结果`deleteAllowed`强制为false。
4. 缺失/非法预期证书在连接前拒绝；缺peer证书或SPKI公钥pin不符在HTTP发送前拒绝。SDK原字节未改，`developmentTls`默认false；既有true例外仅跳过CA/名称验证，仍强制pin，不能据此宣告完整TLS信任通过。未修改ACL、session、Origin、CSRF、派发或设备操作开关。
5. 首个固定错误码不可被后续结果清除；任一层异常关闭客户端并永久熔断该实例。出站前、响应后及顶层完成前均检查；provider吞掉FDSearch异常也不能继续发网或返回假COMPLETE。关闭/取消后的晚响应不能恢复READY/COMPLETE，放弃的晚响应缓冲清零。
6. 总时限120000ms、单请求5000ms、逻辑请求256均为默认及上限，只可缩短；使用单调时钟和看门狗。256计数是SDK逻辑request，既有Digest在同端点401后最多重发一次，不能将逻辑请求、HTTP及TLS连接数混同。

## 既有正式合成验证结果

以下为实施阶段真实结果的复审固化，**本次没有重跑**。最终源码运行窗口为2026-11-28T03:49:39+08:00至03:50:37+08:00，记录于`final-r2/final-offline-summary.json`。当时环境：Windows 23H2 build22631.6199、Node v24.16.0、PowerShell 7.6.9及Windows PowerShell 5.1.22621.6133。

| 最终分组 | tests | pass | fail | skipped | exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| admin-final | 551 | 551 | 0 | 0 | 0 |
| tenant-final | 6 | 6 | 0 | 0 | 0 |
| root-final | 297 | 297 | 0 | 0 | 0 |
| worker-final | 35 | 35 | 0 | 0 | 0 |
| worker-guard-selfcheck-final | 2 | 2 | 0 | 0 | 0 |
| 合计 | 891 | 891 | 0 | 0 | 0 |

cancelled/todo也均为0。原50个测试文件保留，新增两个，共52个；原始TAP名称多重集和命令参数核对确认原748项全部保留，新增host81项、policy62项，共143项。另一个describe套件标题不计为额外测试。各组完整命令、起止时间和真实退出码均在原清单；stdout/stderr与退出码分别保留，不以外层证据脚本退出0替代测试结果。

新增143项使用合成输入/证书和假TLS/HTTPS底层传输，让真实SDK的X509解析、SPKI SHA256 pin比较、PinnedAgent回调与Digest代码执行；新增夹具不listen、不DNS、不访问设备。原748项中的合成loopback HTTP/TLS和PowerShell包装器仍按原套件回归，不能据此将新增假传输验证称为真实TLS。

缺预期证书断言零TLS；错pin或缺peer证书断言零HTTP，随后也无新增请求。此处HTTP计数为假设备取得可发送socket后的HTTP，不是`https.request`对象创建数。fixture负控故意模拟Agent校验前同步返回socket，预期检出1次提前HTTP；该负控按预期通过，证明计数器能检出该类回归，不是本宿主实际发送了未校验HTTP。

## 失败历史与静态检查保留

- 首次policy聚焦62/62、exit0。首次host聚焦为81项中80通过、1失败、exit1：悬挂HTTPS响应时宿主看门狗先于SDK截止，实际为`READONLY_REQUEST_TIMEOUT`，旧断言期望`HIKVISION_TIMEOUT`。仅将该测试更名并精确修正期望错误码；未删除/跳过断言，未改变阻断实现。首次stdout/stderr、exit及首次测试源码副本原样保留，不能改记为首次通过。
- 此后第一轮全量891/891通过；随后复核发现底层名单可能带`deleteAllowed=true`，在宿主结果投影中固定为false并加正控断言。最终源码在新的`final-r2/`目录完整验证891/891，未覆盖第一轮结果或此前源码副本。
- 三项相关静态检查（`check-miniprogram.mjs`、`checkin-face-static-check.mjs`、`verify-checkin-face-sources.mjs`）exit0。
- `verify-import`仍为**exit1的基线失败**：`cloudfunctions/login/config.json`实际SHA256为`aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`，provenance预期为`ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`。未修改该文件或旧provenance凑匹配；本结论不等于全部静态检查通过。

## 源码与原始证据定位

已完成的独立复审核对15项受测源码测试前后哈希、最终磁盘字节及17项Git blob（15项加两份文档）一致；10项继承的受核对文件与父提交一致。全表保留于实施报告，主要新增源码/测试为：

| 路径 | 已核对SHA256 |
| --- | --- |
| `admin-web/lib/face-readonly-host.mjs` | `67d1f13b75d203ec032232395b16954aabb006ba88c33a278a7ffd5843d6082b` |
| `admin-web/lib/face-readonly-policy.mjs` | `3e4ea808e88c6822d26328d5a2d7af759f659b5d7329d9873c4d8a02e7b9f657` |
| `admin-web/tests/face-readonly-host.test.mjs` | `d3cbd900cbd03c8e469bbff636a5e48aeaf171449f576e75e5acfb0cb1e6f112` |
| `admin-web/tests/face-readonly-policy.test.mjs` | `89dd1e481065849b6afd5fff6d08938a06f26542f2ad2a13f83813a5ebc72277` |
| `admin-web/tests/fixtures/face-readonly-fake-transport.mjs` | `2c6c55ed2ee7e7b4abb43e08b407f1b777e3f77e8253bee5b439f25aee27451a` |

原始本机证据目录仍为`D:\chatgpt\smart\FACE-READONLY-HOST-VALIDATION-20261128T034532-75d5785c`。以下均为该目录下的相对工件，不是云端附件：

- `host-initial.stdout.log`、`host-initial.stderr.log`、`host-initial.exit.txt`及`face-readonly-host.first-attempt.test.mjs`：首次失败真值。
- 根目录第一轮全量日志与`face-readonly-host.pre-permission-projection.mjs`、对应测试副本：后续收紧投影前的历史记录。
- `final-r2/`下各组stdout/stderr、退出码及最终汇总：最终891项与静态检查真值。
- `regression-verification.json`、`final-r2/final-offline-source-before.json`、`final-r2/final-offline-source-after.json`、`git-committed-byte-verification.json`：回归保留及字节核对依据。
- `artifact-manifest.json`和实施报告工件表：原始/脱敏副本的相对名、大小及SHA256。独立复审核对报告60条工件记录及清单74条原始记录，均与文件匹配。
- `review-bundle-56f345fc8f38.zip`：供实际取件的脱敏复审包，93个条目、169244字节，SHA256=`ca95d0c3c348e06a961669a77e556227f8eae0cbadd32cbfb2fa8cdb48cbd78d`。原始日志仍在本机受控保留；异机复审须实际传递该包，不能把本机路径当作远端可读附件。

实施交付的`remote-verification.json`记录2026-11-28T03:56:47+08:00普通推送及ls-remote均exit0，实施分支远端完整SHA与`56f345fc8f3823cd0adaa853c81a64279f61e945`一致。既有独立复审核对的是该记录，未将其写成当次重新查询远端。本次文档提交须另行普通显式推送、重新核对文档分支远端SHA，并在交付回报中给出结果；不能借用实施分支记录代替。

## 未验收事项与停止点

真实TLS握手、CA/主机名验证、现场证书和设备身份、VPN/新路由器连通性、完整CLI及后台/UI接入均未因此验收。现场9人名单及`F03FF8DA7299CE148`显示“可见光已入库”仍待单独授权实机复验；不以合成人员替代现场真值。

名单查询并非原子快照。原P1最终读取至设备处理PUT之间非原子、相同投影替换等边界继续保留，不因只读宿主通过而扩大为删除流程原子性保证或真实设备写入验收。

本次只新增验收文档，不重跑、不读取真实凭据或照片、不连接设备、不修改路由，不登记/删除人员、开门、清理残留或处理云端队列/开关。全部旧对象、报告、日志、失败记录及新旧残留引用保留。没有E1/E2、派发、部署或上线放行。

文档提交推送并核对远端完整SHA后停手，交独立复审；本文件不自行宣告其自身的文档复审完成。
