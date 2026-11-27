# 人脸登记管理与 FDSearch 适配实施记录（2026-11-28）

本记录由实施方编写，交独立复审。代码及合成离线验证已完成；现场复验因连接超时受阻，不能确认本轮9人名单或指定人员“可见光已入库”。负责人在2026-11-28明确选择“暂时无法恢复，先交付代码和真实受阻证据”，因此停止设备请求并提交当前实现。不得据此关闭实机验收、允许真实删除或作 E1/E2 放行。

## 分支、环境与文件范围

- 工作树起点/本次提交的直接父提交：`0e2773f736f70c735a7530aed34ecaec0ad70d83`。
- 独立分支：`feat/hk-face-registration-management-2026-11-27`。原发布工作树未切换、清理或修改。
- 实测日期为2026-11-28，时区 Asia/Shanghai；最终离线正式运行2026-11-28T01:03:36+08:00—2026-11-28T01:05:27+08:00，设备复验00:55:29—00:55:34，同端点TCP补查00:56:28约3秒。
- 本机 Windows 23H2，build22631.6199（只读注册表）；.NET OSVersion为10.0.22631.0。CIM读取被拒绝，原始记录保留，采用注册表补证，不申请系统提权以读取CIM。
- Node v24.16.0；PowerShell7.6.9；Windows PowerShell5.1.22621.6133。未安装或升级运行时、依赖、Pester、WSL或容器。
- 修改既有路径：`admin-web/lib/face-enrollment.mjs`、`admin-web/public/face-ui.js`、`admin-web/public/style.css`、`admin-web/server.mjs`、`admin-web/tests/face-server.test.mjs`、`docs/checkin-face-experience-source-hashes.json`。
- 新增路径：`admin-web/tests/face-management.test.mjs`、`admin-web/tests/face-management-ui.test.mjs`、`docs/ADMIN-FACE-MANAGEMENT.md`和本报告。
- 哈希清单仅更新已有server条目的SHA及用途；旧来源清单、云函数、worker、业务绑定、依赖清单和SDK均未修改。

## 实现与本轮适配

管理列表复用已有session和HikvisionClient，严格分页读取完整人员名单，再按设备返回的库类型/FDID逐人精确FDSearch。DTO包含人员编号、姓名、门与计划、有效期及可见光/红外状态，不包含照片、照片URL或连接材料。总数变化、重复/非法编号、不完整分页或超过1000人均停止，不显示部分结果为全量。

已定位的兼容问题是：旧管理代码在`faceSearchSupported`缺失/false时跳过FDSearch。当前实现对显式管理读取实际调用精确FDSearch，以整数计数、精确FPID及`isInLibrary`判断；不改写旧登记能力标志，也不使用`numOfFace`代替入库证据。传输/设备错误、不明确响应、计数矛盾或错误FPID仍为unknown。记录存在和建模入库分别判断，`isInLibrary=no`不能证明脸库记录不存在。

新增6项合成回归覆盖缺失/false能力、仍实际精确查询、传输失败和设备拒绝，以及prepare与已发确认令牌不能绕过零PUT约束。管理业务及旧登记两文件聚焦证据127/127保留于`FACE-MANAGEMENT-MOCK-REGRESSION-20261128T002415-bc3d3c91`；正式全量证据以下表为准。

删除实现为逐人prepare/confirm/status，校验`^[A-Za-z0-9]{1,32}$`、短时单次同会话令牌、精确人员快照、库状态和二次确认文本。先脸库后人员，ACK/全局进度不代替目标读回；错误持续优先，异步跟进不补发PUT。界面没有全选/批量清库，刷新失败隐藏旧可操作列表。HTTP接口沿用管理员session、Origin、CSRF和本机来源校验。

## 离线正式验证

最新源码共742项，实际通过742项；所有测试进程退出0，fail/cancelled/skipped/todo均0。仓库现有50个`*.test.mjs/cjs`全部纳入，未启动真实worker或设备探针。

00:28首次742项通过的证据全部保留。随后暂存检查发现新增测试文件末尾多余空行，只移除这一空行，不改变测试逻辑或生产实现，并在独立offline-final-r2目录重跑以下全部测试；新旧日志均保留。原测试文件格式修正前副本也保留。

| 分组/工件前缀 | tests | pass | fail | skipped | exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| admin-final | 402 | 402 | 0 | 0 | 0 |
| tenant-final | 6 | 6 | 0 | 0 | 0 |
| root-final | 297 | 297 | 0 | 0 | 0 |
| worker-final | 35 | 35 | 0 | 0 | 0 |
| worker-guard-selfcheck-final | 2 | 2 | 0 | 0 | 0 |

执行方式：

1. `node --test --test-reporter=tap`后传入排序后的22个admin-web测试文件，唯一暂分离文件为tenant-password-routes。
2. `node --require ./tests/support/d-network-guard.cjs --test --test-reporter=tap admin-web/tests/tenant-password-routes.test.mjs`。
3. `node --require ./tests/support/d-network-guard.cjs --test --test-reporter=tap`后传入根目录23个测试文件。
4. `node --require ./tools/checkin-face-worker/tests/network-guard.cjs --test --test-reporter=tap`后传入worker三文件。
5. 同worker守卫下单独运行`network-guard-selfcheck.test.mjs`。

完整可复现参数数组和每组起止时间在`offline-final-r2/final-offline-summary.json`，实际启动脚本在`offline-final-r2/run-final-offline.ps1`。stdout/stderr分别重定向，紧接进程返回保存LASTEXITCODE至独立exit.txt后才解析TAP。普通admin测试包含合成loopback HTTP/TLS，不预载禁止所有网络的业务守卫；tenant及根目录/worker合成套件分别使用各自既有守卫，不改、跳过或放宽断言。两种PowerShell相关用例实际执行，无skip。

| 静态检查命令 | exit |
| --- | ---: |
| `node scripts/check-miniprogram.mjs` | 0 |
| `node scripts/checkin-face-static-check.mjs` | 0 |
| `node scripts/verify-checkin-face-sources.mjs` | 0 |
| `node scripts/verify-import.mjs` | 1 |

`verify-import`实际失败，不能记为全部静态检查通过：`cloudfunctions/login/config.json`实际SHA256为`aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`，旧provenance预期为`ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`。此前在原发布工作树已复现同一错误，两处该文件原字节相同；原始基线stderr保留。未改云函数或旧来源清单凑匹配。首次未预载tenant守卫导致的6项失败及随后分组日志也全部保留，不覆盖或改记。

## 源码前后SHA256

最终正式测试前2026-11-28T01:03:36+08:00和测试后2026-11-28T01:05:27+08:00的以下原始字节SHA256完全一致；现场复验停止后的五项运行源码哈希也与此表一致。说明文档和本报告在测试后整理，不影响受测代码。提交后需在独立本机工件记录Git blob与受测字节一致性、完整提交SHA及ls-remote结果。

| 路径 | 测试前=测试后SHA256 |
| --- | --- |
| `admin-web/lib/hikvision-client.mjs` | `d79ef3ba00914d4bc551ab363315f6fdb183da44088577fe14c1902786e76001` |
| `admin-web/lib/face-enrollment.mjs` | `f25fc2c34177ce755f71d9a84f28394c51a8826d3deccc166d15a6670232628f` |
| `admin-web/server.mjs` | `0b4c999ee71b151efc85b6d14777d093350e034caa63c7eed017cb448878a763` |
| `admin-web/public/face-ui.js` | `43d954d22fe3ad5498764e1991b9574d04e1521542a9cdb346041c8ae1ae31fd` |
| `admin-web/public/style.css` | `0ecea30847c15a225a62292391a31b5292963c72b2b47799fa97a540779d2a3d` |
| `admin-web/tests/face-management.test.mjs` | `7430bec898b683b6ac025801fb559be4898a76700a249c0ed2ab0a0d166ecab6` |
| `admin-web/tests/face-management-ui.test.mjs` | `a813242ab62aa7298ba6bc29fee87b42a626bf820bdcd2c95aa7e255d276e3af` |
| `admin-web/tests/face-server.test.mjs` | `94b3a329e913f92425f0ee23a13704b567bd591f8e72113e5556ae65d751a224` |
| `docs/checkin-face-experience-source-hashes.json` | `d01eb1ff12c4a921dd420047d52a215a19d16ec04a4814a2f27e8c665b5dde7c` |

## 真实设备只读复验与阻断

此前2026-11-27的本机UI曾读取完整9人、找到目标`F03FF8DA7299CE148`，但该人员可见光状态为unknown、FDSearch实际调用0次。该运行起始业务源码为`d98b100494783450fc0dc4e9f5683876a35f7e920970bf5ad3b8abb5ab18a785`，结束哈希为当前f25开头版本，旧记录明确`unchanged=false`。它不能作为当前源码真实FDSearch已通过的证据，更不能将旧9人结果挪作本轮实测。

2026-11-28用户在本机密码窗口点击连接后，当前源码通过既有SDK开始读取设备描述；唯一逻辑GET在5007ms后返回`HIKVISION_TIMEOUT`。会话00:55:34以exit1停止，stdout/stderr捕获字符数均0，凭据未持久化。业务层转译后的启动错误为`LOCAL_READONLY_VALIDATION_ERROR`，原传输错误码保留在`device-operations.json`。没有HTTP状态可报告，不能解释为账号错误、证书错误或接口不支持。

| 验证层 | 本轮结果 |
| --- | --- |
| 同一配置端点TCP补查 | 一次连接，3010ms，TCP_TIMEOUT；未读取账号密码、未发HTTP |
| SDK设备描述读取 | 一次逻辑GET，HIKVISION_TIMEOUT，5007ms |
| TLS pin/HTTPS响应 | 本轮未确认；未关闭pin或改换端口 |
| 人员搜索/FDSearch | NOT_EXECUTED，均0次 |
| 当前9人名单 | UNVERIFIED |
| 目标“可见光已入库” | UNVERIFIED，不能填写PASS |
| 实际删除、写设备、开门 | 0；本次临时验证宿主在传输层和服务facade均拒绝写操作 |

两次网络操作分别记录：一次SDK逻辑GET（实际TLS/HTTP进度未取得）加一次独立TCP诊断；不能统称仅一次连接，也不推断更底层握手连接总数。没有换端口、扫描、HTTP回退、自动重试或改网络配置。失败后用户确认暂不恢复，停止现场请求。跨网方向选为现场路由器/VPN网关互联；目前没有可用管理入口且路由器后续会变更，未配置VPN、端口映射、路由或派发。

## 删除协议与未验证边界

实现依据[海康官方《明眸门禁》](https://open.hikvision.com/hardware/v2/08%E5%8D%8F%E8%AE%AE%E9%80%8F%E4%BC%A0/%E6%98%8E%E7%9C%B8%E9%97%A8%E7%A6%81.html)，而非将任务中的参考路径当成事实：

```text
PUT /ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=<设备返回的库编号>&faceLibType=<设备返回的库类型>
{"FPID":[{"value":"SYNTHETIC01"}]}

PUT /ISAPI/AccessControl/UserInfoDetail/Delete?format=json
{"UserInfoDetail":{"mode":"byEmployeeNo","EmployeeNoList":[{"employeeNo":"SYNTHETIC01"}]}}

GET /ISAPI/AccessControl/UserInfoDetail/DeleteProcess?format=json
```

以上删除路径及请求体只做官方协议核对与合成验证，**未对真实设备执行或验证删除**；红外库实机兼容性同样未确认。用户本轮禁止删除/开门，未申请测试删除或自动清理。也未登记人员、上传照片、读取照片URL、查询云端住户/房屋/绑定或启派发。没有扩大为完整CLI接入或E1/E2通过。

原HikvisionClient文件未改，仍为HTTPS+Digest+发送前强制公钥pin；既有`developmentTls=true`只采用既有CA/名称例外，不能写成完整证书信任验证通过。未用-k/insecure、导入根证书、更换设备证书、修改安全策略或读取真实照片。账号密码仅本机窗口和进程内存使用；原始人员名单仅保存在旧本机受控证据，未写入本报告、Git或聊天。

## 工件定位、字节数与哈希

本轮根目录：`D:\chatgpt\smart\FACE-MANAGEMENT-READONLY-20261128T002105-22ad4914`。以下工件名均相对该目录，都是同一台Windows上真实可读文件；不在Git，不是云端附件。负责人可在本机直接读取，若交远端独立复审，需另提供这些实际文件，不能用本地路径冒充附件ID。完整清单为`delivery-artifact-manifest.json`，含原件、脱敏副本和旧证据只读哈希。

日志脱敏副本移除个人profile路径和SID；没有把设备地址、账号、密码、证书或照片写入日志。原始日志未改；stderr为空时仍保留实际0字节工件和其SHA256。

| 原日志 | bytes | SHA256 | 脱敏副本 | bytes | SHA256 |
| --- | ---: | --- | --- | ---: | --- |
| `offline-final-r2/admin-final.stdout.log` | 90478 | `453ec6b1a70a7bead04c8223497c8d36aa711a8cdb747934b93f7459586e6835` | `offline-final-r2/admin-final.stdout.redacted.log` | 90478 | `453ec6b1a70a7bead04c8223497c8d36aa711a8cdb747934b93f7459586e6835` |
| `offline-final-r2/admin-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `offline-final-r2/admin-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `offline-final-r2/tenant-final.stdout.log` | 1454 | `e3a4f2593c9b227d55253b370e669770f7de50d9bcb5ecb9627820a12f4d0e10` | `offline-final-r2/tenant-final.stdout.redacted.log` | 1454 | `e3a4f2593c9b227d55253b370e669770f7de50d9bcb5ecb9627820a12f4d0e10` |
| `offline-final-r2/tenant-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `offline-final-r2/tenant-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `offline-final-r2/root-final.stdout.log` | 98375 | `95af6051f988777cb38f5f3d00325fb6dfda3618d1ea27242cbf69d096569a73` | `offline-final-r2/root-final.stdout.redacted.log` | 98375 | `95af6051f988777cb38f5f3d00325fb6dfda3618d1ea27242cbf69d096569a73` |
| `offline-final-r2/root-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `offline-final-r2/root-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `offline-final-r2/worker-final.stdout.log` | 17409 | `596676afbc0f85fee3e2dddd2ac53fab4df9384599b982a2e795b85bc9b2791a` | `offline-final-r2/worker-final.stdout.redacted.log` | 17409 | `596676afbc0f85fee3e2dddd2ac53fab4df9384599b982a2e795b85bc9b2791a` |
| `offline-final-r2/worker-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `offline-final-r2/worker-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `offline-final-r2/worker-guard-selfcheck-final.stdout.log` | 500 | `3c0a45c3571515580170f46c6694f3cfb15bf278bbb34b31177d00236c4421f3` | `offline-final-r2/worker-guard-selfcheck-final.stdout.redacted.log` | 500 | `3c0a45c3571515580170f46c6694f3cfb15bf278bbb34b31177d00236c4421f3` |
| `offline-final-r2/worker-guard-selfcheck-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `offline-final-r2/worker-guard-selfcheck-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `offline-final-r2/check-miniprogram-final.stdout.log` | 185 | `89535f0f900b0398830261e5ff0bddccdc309c859b94c34154d63f5a3994a2e0` | `offline-final-r2/check-miniprogram-final.stdout.redacted.log` | 185 | `89535f0f900b0398830261e5ff0bddccdc309c859b94c34154d63f5a3994a2e0` |
| `offline-final-r2/check-miniprogram-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `offline-final-r2/check-miniprogram-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `offline-final-r2/checkin-face-static-final.stdout.log` | 73 | `d3acf855ec25633177b8dfd2e04b93d122d66e0cdd7dc17fadde902208d790ad` | `offline-final-r2/checkin-face-static-final.stdout.redacted.log` | 73 | `d3acf855ec25633177b8dfd2e04b93d122d66e0cdd7dc17fadde902208d790ad` |
| `offline-final-r2/checkin-face-static-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `offline-final-r2/checkin-face-static-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `offline-final-r2/verify-face-sources-final.stdout.log` | 28289 | `8f870ecadb3604229733cc8d592e52c7aab89429f86327a888decc6b1b8ac5d3` | `offline-final-r2/verify-face-sources-final.stdout.redacted.log` | 28289 | `8f870ecadb3604229733cc8d592e52c7aab89429f86327a888decc6b1b8ac5d3` |
| `offline-final-r2/verify-face-sources-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `offline-final-r2/verify-face-sources-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `offline-final-r2/verify-import-final.stdout.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `offline-final-r2/verify-import-final.stdout.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `offline-final-r2/verify-import-final.stderr.log` | 935 | `dffb30b5bcdc777922c9414338267c0df4e49bbff140574bd493da3996823b20` | `offline-final-r2/verify-import-final.stderr.redacted.log` | 935 | `dffb30b5bcdc777922c9414338267c0df4e49bbff140574bd493da3996823b20` |

| 非敏感结构化证据 | bytes | SHA256 |
| --- | ---: | --- |
| `runtime-proof.json` | 363 | `1a6a0b241aea1ea82658150554e572dfbdef41ef159d4c341008aa79cbf2d961` |
| `startup-error.json` | 74 | `d1f0365416c23d2013c701de423e6231f27380acb68ec67bbfe387ee04e0819f` |
| `server-stopped.json` | 89 | `d3035327dbd551e432205dcf3d10d8c66aa59df0eb03fba473a1389e426d147c` |
| `source-hashes-final.json` | 513 | `3216f32f163b8ed1d26bbd1c166c7f5f02cc50272ad038b5a599a66c33b83b5d` |
| `device-operations.json` | 199 | `c48325598dffca6502e3dd391ccd8f6475338a395ab00ce637640ce270e6f528` |
| `launcher-result.json` | 76 | `7ca0821ba584a18b8bfc3e8924b6a0676e51be1c83b225696a87f692959405e3` |
| `same-endpoint-tcp.json` | 227 | `dd02b57e8d4093674056e311e395ec64845cf1bd19d79744da9353b5ab9bd8f5` |
| `offline-final-r2/final-offline-summary.json` | 6460 | `08286fa022410229d48465023c183c01fe901fcac0ae7e8e97f4dc82252b1bb9` |
| `offline-final-r2/final-offline-source-before.json` | 1062 | `308ab668080f867a7fb90ed9eef84e9609a195f3697ba48f3f0d6ca552aeece5` |
| `offline-final-r2/final-offline-source-after.json` | 1084 | `2a0dcfaa9b1e005657ff2bb06ebd1ec043c64ad1c574b804ae468c0796cf03f0` |

旧目录`FACE-MANAGEMENT-VALIDATION-20261127T195333-6ecc181f`以及本轮所有更早工件原样保留：原始名单、首次失败、分组重测、旧UI、原始日志、报告和残留引用均未清理。旧名单含个人信息，不直接提交；其字节数和哈希列在本轮清单中供本机复核。新增六项聚焦回归目录也保留。受测生产实现失败时未放宽门禁，此轮没有真实删除真值证据。

## 交付停止点

本次只可确认实现和742项合成离线验证通过。相关三项静态检查通过，verify-import基线失败保留；实机名单/FDSearch适配验收仍受网络阻断。后续需先建立有效的现场网络/VPN入口，再另行执行只读复验并新增证据，不覆盖本报告的失败记录。

代码交独立复审；不自行宣布实机验收、删除放行、E1/E2放行或上线。
