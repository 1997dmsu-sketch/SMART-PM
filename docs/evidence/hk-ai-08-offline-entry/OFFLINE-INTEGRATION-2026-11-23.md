# HK-AI-08 受控入口离线接入执行证据（2026-11-23）

本轮实际结果：**原 CB-01～CB-06 回归 140/140，新接入验证 264/264；两进程退出码均为 0，stderr 均为空，七项来源执行前后哈希一致。** 结论仅为合成字节加载、同域私有绑定、受控编排及品牌化假传输/假输出的离线接线结果，等待独立复审；不作完整 CLI、真实文件/ACL/TOCTOU、认证/TLS 或 E1 放行结论。

## 1. 固定起点、来源及变更

- 固定直接起点：`24b53855757f5758c55131c95746cbf56746849d`，其父为 `6ed5cabb521bed3711de547ad9e310a5f4e1860c`。
- 新独立实现分支：`feat/hk-ai-08-offline-entry-integration`，在新工作树从完整固定 SHA 建立，起始工作树干净，不采用远端最新 tip，不切换或清理他人的工作树。
- 修改 `tools/hikvision-offline-config-binding/src/bridge.mjs`，新增 `tools/hikvision-offline-entry/README.md`、`src/bytes.mjs`、`src/entry.mjs`、`test/entry.test.mjs` 及本文。原 140 项测试、checker、旧报告及方案不改。
- 原桥修改集中于共享 factory/比较器、闭式字节入口及新假会话编排；原 factory 的八 API、scope 和原有行为保持兼容，新 factory 的十一 API 使用独立 scope。没有导入或启动原 CLI/runProbe、HTTP、Digest 或文件写入模块，也未借旧 Node/ACL 样本补足本轮入口。
- 基线 bridge SHA-256 为 `65549b9c7fc0920041a8f0289d2acf2d5a6b276e3393a527046c0645fb3e873a`，本轮修改后的来源另见第 5 节，不回填任何历史源码哈希。

## 2. 实际接线及静态边界

实际被测试路径为：合成 byte 数组 → `decodeSyntheticConfigBytes` → 同域 private prepare → 原值 checker → 规范冻结投影/私有 snapshot → 独立单次许可 → `executeOffline` → 品牌假传输 → 冻结闭式摘要 → 品牌假输出。新入口没有在桥外复制第二份执行配置，也不公开 snapshot 或配置读取 API。

字节入口先复制 dense 普通数组，拒绝 Proxy/getter/特殊容器；安全 length 超过 65536 时在枚举前停止。fatal UTF-8、解码前 BOM 拒绝、深度 16、解码后重复键、null 原型对象及非有限数/孤立 surrogate 检查均进入实际加载代码。后续继续使用原合成 schema、显式值及全部白名单，没有缺项默认回退。

原 `allowRead=true` 被拒绝；执行只复制私有快照 false，许可不翻转该字段。核对后修改调用者 bytes、expected、response 脚本、grant 或 context 来源不能改变执行材料；getter 陷阱证实这些合成来源不被重读。每次假传输实际比较同一快照派生视图的所有字段；新接入测试独立写出 expected，并包含 43 个字段差异负控。

许可在任何 await/假传输前同步消费，逐调用、重发、微任务边界、响应返回后及输出前复查撤销、epoch、取消、窗口及预算。取消永久阻断该绑定签发/执行；并发、错误、到期、撤销和输出失败不恢复许可。`observeTransport` 返回 trace 副本，不冻结进行中的私有 trace。没有接受任意外部执行回调或可切换的真实 transport/sink。

六 GET 的方法、路径、查询和顺序固定。G1 认证协商后的最终非 200、不可解析或型号 unknown/不匹配阻断 G2–G6；首次 401 可按固定假策略重发一次，第二次 401 停止。G2–G6 非认证状态错误/解析失败记 unknown。每端点最多两次模拟传输、整会话最多十二次，没有第二目标、重定向或响应 URL 入口。

**认证与响应材料是闭式的合成解码后记录。** 固定假策略仅接受 parseable=true、SHA-256/auth；不支持、畸形、缺省或 MD5/auth-int 等在假重发前拒绝，不省略 qop 回退。本轮没有解析原始 HTTP/XML/JSON/Digest header、计算认证摘要或生成 Authorization；这不是原 Digest 模块修复，也不证明设备支持 SHA-256。原实现可能省略 qop 后重发的历史事实保持不变。

fake elapsedMs 只推进合成逻辑时间，以固定优先级验证窗口、session/request deadline、inactivity 边界及溢出；不是实际 socket、分块流、真实单调时钟或在途急停证据。输出只为内存假接收器，不创建 Windows 保护根、不写原始响应文件。摘要含整体 status/code，脚本剩余等失败即使六阶段已 confirmed 也不能丢失；output fail/throw 时 execute 摘要为失败，sink.last 保留写入尝试前摘要，不伪造成功写入。

以上为源码/接口静态核对；下面是本次真实进程的合成测试记录。二者均不等于原生 ACL、网络或设备验证。

## 3. 本机与两条实际命令

本机 Windows `Win32NT`、版本 `10.0.22631.0`；Node `v24.16.0`；采集器运行于 PowerShell Core `7.6.9`。发现两个已安装 Node Application 候选，明确选择第一个并核对版本。本轮不是 PowerShell ACL 预检，没有运行旧权限测试或主预检，不安装/升级任何运行时、依赖、Pester、WSL 或容器。

工作目录为本独立工作树根，按顺序各执行一次：

```powershell
node .\tools\hikvision-offline-config-binding\test\bridge.test.mjs
node .\tools\hikvision-offline-entry\test\entry.test.mjs
```

| 阶段 | 实际开始/结束（Asia/Shanghai，2026-11-23） | 退出码 | stdout/stderr 字节 |
|---|---|---:|---:|
| binding-regression | 12:06:21.9476754+08:00 / 12:06:22.0720820+08:00 | 0 | 452 / 0 |
| entry-integration | 12:06:22.0975301+08:00 / 12:06:22.5649884+08:00 | 0 | 448 / 0 |

没有准备失败、测试重试或跳过阶段。外层以两个独立 BaseStream 保存每阶段真实 stdout/stderr，WaitForExit 后立即读取该子进程 ExitCode，再等待流复制完成；不让后续 LASTEXITCODE 替代它。各阶段前后均记录七项来源，四份 manifest 完全相同。总体退出码 0，启动异常均为空。

新采集引用：`hk-entry-f67a184f60d3402f8a532606ec1863f2`。它只是本次采集关联，不是 ACL evidenceRef、残留定位、实际配置相等或审批真实性证明。元数据 NOT_EXECUTED 等字段是采集器声明，零设备边界另由固定可达源码无传输路径支持，不宣称独立网络流量观测。

## 4. 两次原始 JSON 及实际计数

binding-regression stdout（文件含末尾 LF）：

```json
{"scope":"synthetic-config-binding-cb01-cb06-tests","status":"PASS","counts":{"groups":6,"total":140,"passed":140,"failed":0},"failedCaseIds":[],"groupCounts":[{"id":"CB-01","total":46,"passed":46,"failed":0},{"id":"CB-02","total":6,"passed":6,"failed":0},{"id":"CB-03","total":5,"passed":5,"failed":0},{"id":"CB-04","total":50,"passed":50,"failed":0},{"id":"CB-05","total":23,"passed":23,"failed":0},{"id":"CB-06","total":10,"passed":10,"failed":0}]}
```

entry-integration stdout（文件含末尾 LF）：

```json
{"scope":"synthetic-offline-entry-tests","status":"PASS","counts":{"groups":6,"total":264,"passed":264,"failed":0},"failedCaseIds":[],"groupCounts":[{"id":"LOADER","total":66,"passed":66,"failed":0},{"id":"BINDING","total":48,"passed":48,"failed":0},{"id":"FLOW","total":37,"passed":37,"failed":0},{"id":"AUTH","total":23,"passed":23,"failed":0},{"id":"PERMIT","total":53,"passed":53,"failed":0},{"id":"OUTPUT","total":37,"passed":37,"failed":0}]}
```

| 新组 | 实际通过/总数 | 核验内容 |
|---|---:|---|
| LOADER | 66/66 | 精确大小/深度边界、超限早拒绝、UTF-8/BOM/重复解码键/JSON、容器/原型/访问器陷阱、闭式配置及显式字段拒绝。 |
| BINDING | 48/48 | 字节入口实际接同域私有快照、十一 API/空句柄、来源修改和 getter 隔离、43 个执行视图字段独立负控。 |
| FLOW | 37/37 | 六端点顺序及完整视图、G1 失败阻断、后续 unknown/unsupported、脚本错序/耗尽/剩余及失败输出摘要。 |
| AUTH | 23/23 | 各端点首次 401 一次重发、六端点累计十二次、第二次 401 停止、抽象算法/qop 策略拒绝。 |
| PERMIT | 53/53 | 伪造/跨域/错绑定/重放、单次签发、并发、逐次与重发前撤销/取消/窗口/epoch、回滚不复活、deadline/溢出/单调时间。 |
| OUTPUT | 37/37 | 闭式摘要与计数、秘密值不外泄、fake 品牌/脚本类型拒绝、失败/抛出不重试且不恢复许可、pre-output 状态区别。 |

各组为真实注册的独立 ID，逐项 await 断言后计数，失败转失败 ID 与非零退出码；异常和断言差异不直接输出。两阶段失败 ID 均为 `[]`。预期拒绝正确发生也算通过；404 项合计只指本次 140+264 个合成断言，不代表完整未来矩阵验收。原 140 文件原样执行，不借旧 140/140 报告冒充本次回归。

## 5. 七项来源执行前后 SHA-256

每阶段执行前后及两个阶段之间均相同，按原始文件字节计算，没有重编码或改换行凑哈希。旧 checker 和原 140 测试保持原字节。bridge 使用本轮新哈希，历史报告继续指向历史字节。

| 仓库相对路径 | 字节 | 本次执行前 = 执行后 SHA-256 |
|---|---:|---|
| tools/hikvision-offline-config-binding/src/bridge.mjs | 34947 | `a2f4b736b67fece57dec8c7a8b711de56dd59a3c58f439bb33a3707bda2b94e0` |
| tools/hikvision-offline-config-binding/test/bridge.test.mjs | 37470 | `1506f319e0792b831bc264a1d8d315cbd3eafb78f560ad795ac957c1260da17a` |
| tools/hikvision-offline-config-checker/src/check-config.mjs | 10463 | `a8dbde46942aca550e13fdddb27e93bd5c9d1902e8cbdfb09cb31befc0eecfb7` |
| tools/hikvision-offline-entry/README.md | 9892 | `a9870853d3239387ac8bf72e2861d088918e2b3181dfb25b2db7cb0fefa51730` |
| tools/hikvision-offline-entry/src/entry.mjs | 242 | `77b438bf8beaa1ab9c9bdf8885265a72d98d50c39e51feaf0091b7a659cfae76` |
| tools/hikvision-offline-entry/src/bytes.mjs | 4894 | `8eb41d8784f66f5d4416d5459ab80fd1cf72f75486afcec1d8e568259ef82e36` |
| tools/hikvision-offline-entry/test/entry.test.mjs | 52308 | `bd61740592bdf91efb5b6468c1452ab3e74dd4160084e7cce9c7b2444016746b` |

## 6. 本机原始日志、脱敏副本与工件

相对本独立工作树根目录：`../HK-AI-08-offline-entry-2026-11-23-run01/`。全部原件留本机，不提交 Git；下表按原始字节记录，stdout/stderr 的原件与脱敏副本各自逐字节相同。stdout 只有 scope、状态、组/失败 ID 和计数，stderr 为空，没有真实凭据、私有材料、账号、SID 或个人路径。

| 工件 | 字节 | SHA-256 |
|---|---:|---|
| binding-regression.stdout.raw | 452 | `81f282e630d54649819749875b4b637033e3f102ddfe5950156ad357247cedcc` |
| binding-regression.stdout.redacted.txt | 452 | `81f282e630d54649819749875b4b637033e3f102ddfe5950156ad357247cedcc` |
| binding-regression.stderr.raw | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| binding-regression.stderr.redacted.txt | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| binding-regression.exitcode.txt | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| binding-regression.metadata.json | 486 | `f9f11bf012aff7b5337d46ddf4ae4e8264bcbef482a7b1c4425f59b03c909fca` |
| binding-regression.sources.before.json | 1261 | `14b708c7cc1ab337dcfd69840b39fa72536927e1b051b19f20a8db132115a538` |
| binding-regression.sources.after.json | 1261 | `14b708c7cc1ab337dcfd69840b39fa72536927e1b051b19f20a8db132115a538` |
| entry-integration.stdout.raw | 448 | `31f1e9f9067fe110490dfdf47cff69d15f1b78f9c184cf3c3dcbf994a44b9d1e` |
| entry-integration.stdout.redacted.txt | 448 | `31f1e9f9067fe110490dfdf47cff69d15f1b78f9c184cf3c3dcbf994a44b9d1e` |
| entry-integration.stderr.raw | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| entry-integration.stderr.redacted.txt | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| entry-integration.exitcode.txt | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| entry-integration.metadata.json | 475 | `50d8cc10e973f32a43bdeaa65f8d0f04b6b947e799a68c5cb7ed0d5eff7a894b` |
| entry-integration.sources.before.json | 1261 | `14b708c7cc1ab337dcfd69840b39fa72536927e1b051b19f20a8db132115a538` |
| entry-integration.sources.after.json | 1261 | `14b708c7cc1ab337dcfd69840b39fa72536927e1b051b19f20a8db132115a538` |
| run.metadata.json | 1606 | `c84dabbaba656473662be1c1df262301959643e81e6cf20cf656a5c1710eee57` |
| capture-offline-entry.ps1 | 5730 | `2a248ad59a6d390ffeef842e5e28bf9b328050040412ba7ac1ad8603ab5ad652` |
| artifacts.manifest.json | 2897 | `778ffc7391d61dc3139e4cffa7fa5a8b5a306f44059b24d26288d99db78709d2` |

## 7. 历史保全、未验证项与交接

原 [CB 执行报告](../hk-ai-08-offline-config-binding/CB-01-06-2026-11-23.md)（13001 字节，SHA-256 `841df896aae6e4d16bc360bb02647272857df127b7b3adbc5df9c2299250574b`）及 [最终限定复审](../hk-ai-08-offline-config-binding/FINAL-REVIEW-2026-11-23.md)（9206 字节，SHA-256 `f26a97e7ca7aa3e64f822105f483404246ca898d28defea0825ea172008a1fef`）保持原样。既有 run01 准备失败及外层原始流缺失的历史限制不回填，全部旧日志不改。

以下引用保持分别关联，不认领、复用或清理其候选对象，也未检查其当前存在或内容：

- 旧 ACL 失败：`hk-acl-f03a3e07eb4f4c13a5ee8d1326ec84a4`，仍保留原 CLEANUP_FAILED，现存状态未重查。
- 既有 Windows ACL 成功样本：`hk-acl-ede6254418504fb5be49561f3cdb0865`。
- 既有 Node 启动失败：`hk-node-acl-549bdd3a8849407aa3dd9253ff28c6dd`。
- 既有 Node 成功样本：`hk-node-acl-8023cbfe08e44160a493abacd7c88246`。
- 既有绑定桥采集：`hk-cb-143b0d8768dc4ef4acd470f2daaf5d94`。

本轮未创建 ACL 合成根/哨兵，清理为 **NOT_EXECUTED / 不适用**，没有新的 cleanupVerified=true 结论。新增磁盘内容仅为本轮代码、文档及日志；日志保留复核，不处理任何新旧残留。

仍未验证：真实配置/来源文件加载、可信审批/凭据租约/撤销及真实时钟，代码字节/文件对象的原子身份绑定，Windows 文件 sink/CreateNew/句柄/ACL/文件 ID/TOCTOU，原始响应解析与认证摘要，pin-before-send、DNS/peer、实际网络绝对时限与在途急停，完整 CLI。before/after 哈希和合成 epoch 不消除哈希后路径重读或同用户并发风险；本次 NT-01～NT-04/EV 只覆盖其合成编排/策略子集，其他完整生产要求仍未完成。

禁止动作核对：未读真实配置/凭据，未连接设备、HTTP/TLS、DNS、扫描、监听或真实照片/人员/权限操作，未运行旧主预检、原探针或 E1/E2；未手动清理、递归删除、放宽 ACL、管理员提权或绕过安全策略；未改全局/系统 Git/TLS/代理，不安装依赖。仅交付使用授权的 Git ls-remote/push，不推 main，不 amend/rebase/reset/squash/force/merge/cherry-pick，不部署或上线。

完成独立分支追加提交、普通显式 refspec 推送并核对远端完整 SHA 后停止，交独立复审；本报告不自行宣布完整接入验收或 E1 放行。
