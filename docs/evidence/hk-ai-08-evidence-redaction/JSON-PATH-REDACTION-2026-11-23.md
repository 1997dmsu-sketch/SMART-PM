# JSON 路径替换步骤与 capture 适配离线取证（2026-11-23）

本轮仅新增可版本化的纯内存路径转换步骤和同进程 capture 适配。新套首次实际运行 **50/50 组、526 次检查、0 失败、退出码 0**；错误／残留／敏感键／损坏后行等预期拒绝也作为用例 PASS 统计。四份来源前后原始字节哈希一致。

这不是对旧 collector 的执行或替换，也未重新制作旧日志副本。旧 raw/redacted 中五条路径仍然保留，不能把本轮合成 PASS 追认成旧副本已脱敏。旧 140/264/21/34 套件、原生用例、设备、E1/E2 均未运行；allowRead 的既有源码保持原字节。

## 1. 固定起点与范围

- 仓库：`https://github.com/1997dmsu-sketch/SMART-PM.git`。
- 直接起点／本次提交父提交：`ed88f00acbf146c54fec229e6fcd47a905f83116`，已复审的文档更正提交；未替换为远端最新 tip。
- 新工作树 `SMART-PM-json-path-redaction-offline`；分支 `fix/hk-ai-08-json-path-redaction-offline`。开始时干净，既有工作树及未跟踪文件不动。
- 新增 `tools/hikvision-evidence-redaction/src/redact.mjs`、独立 `test/redact.test.mjs`、README 和本报告四个文件。旧 bytes.mjs 仅作依赖复用，原字节不修改；旧 collector、报告、回执和副本不改，不提交其正文或真实材料。
- 原问题静态来源为旧 `Collect-TlsEvidence.ps1` 第 66–68 行：5956 bytes，SHA-256 `d68b71ac6db852611791e265b9fe194c2f8df562dd6a48a60e8765e50e34b2df`。它对 raw JSON 字符串直接替换普通根，未命中 JSON 转义根。仅参考该问题，不复制含实际路径的脚本或执行旧采集流程。
- 本轮提交后停止交独立复审；提交、显式 refspec push 与远端完整 SHA 由仓库外新回执关联，不 amend 或写入循环自引用 SHA。

## 2. 实现及未接入部分

新模块仅导出 `redactEvidenceText` 和 `prepareRedactedCapture`。只在内存中处理调用者显式提供的字符串，依赖 node:util 及原严格字节 JSON loader，不读环境、文件、配置、凭据、时钟，不启动进程或连接网络；没有任意回调、目标或执行器入口。

JSON-lines 先整批严格预检：每非空行通过原 loader 的 UTF-8／语法／重复键／BOM／深度验证后，才处理字符串 token。key 不改；若含需处理或可识别敏感路径即 SENSITIVE_KEY。value 先单 token 解码，再匹配已知根；改变的 token 重新 JSON 编码，其他 token、数值词法、键序、空白、LF/CRLF 均取原片段。没有整对象 JSON 重序列化，因而不把大整数、-0、指数或日期格式改写。裸 CR 在 JSON-lines 中拒绝；text 模式保留并只作路径替换。

显式 root 有 1024 UTF-16 code units 上限，输入每流总上限 262144 UTF-8 bytes；profile root 仅支持约定的 drive/Users/account 形状。动态正则根按字面转义；支持大小写、混合／重复斜杠、单层 JSON Unicode 解码。根后有边界，不把 rootSuffix 当作根；日志文字可紧贴已知根前方，仍进行字面替换。worktree 可在 profile 内，具体 worktree 优先；任何 drive 的 Users 父根拒绝，防止先吞掉 profile 前缀后留下账号段。相同 worktree/profile 根按工作树优先整体替换。

替换后若仍识别 Users 路径或有限 shadow 探测显露目标路径，FAIL/RESIDUAL_PATH，不返回副本。shadow 最多两轮，仅识别部分 Unicode/percent 编码，不将解码结果写入输出。它不是任意编码／URL 或密码、nonce、token 等通用秘密 DLP；未匹配路径的字段仍保留。PASS 仅代表本路径转换契约通过，不代表可直接公开所有内容。

capture 适配对合成 stdout 调 JSON-lines、对合成 stderr 调 text；任一流失败，两流及 counts 全为 null，不部分返回、不退回 raw。输入拒绝 Proxy/getter/隐藏／符号／未知键，结果及 counts 冻结；固定失败码不回显输入、异常、路径或实际值。

**尚未完成：**旧 PowerShell collector 的调用点接入、子进程捕获→转换→文件落盘整链路、真实日志转换、新副本保管、ACL／文件 ID／句柄／TOCTOU，以及生产完整脱敏。本模块无文件保存步骤，未来接线仍需单独实现／复核，不能说旧采集器行为已经改变。

## 3. 实际运行及原始输出

平台 `Win32NT`，`Microsoft Windows NT 10.0.22631.0`；命令宿主 PowerShell 7.6.9，外层采集 Windows PowerShell 5.1.22621.6133 Desktop，Node v24.16.0。没有安装、升级、WSL／容器、Pester、管理员 UAC 提权、执行策略 Bypass／Unblock 或关闭防护。

实际唯一新套命令，在本工作树根执行：

```powershell
node --experimental-vm-modules tools/hikvision-evidence-redaction/test/redact.test.mjs
```

外层新专用采集入口（不会启动旧套件）：

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File ..\HK-AI-08-json-path-redaction-2026-11-23-run01\Capture-RedactionSuite.ps1 -Attempt 1
```

采集器先写意图，stdout/stderr 用独立 CreateNew 文件与 BaseStream 原始字节并发采集；退出后立即保存 ExitCode，再等待复制完成。120 秒有界采集，本次未超时且确认退出。该采集器只捕获新合成测试结果，不使用新模块转换任何旧 raw，也不为旧日志生成副本。

| 项目 | 实际值 |
|---|---|
| startedUtc | 2026-11-23T13:03:20.8360040+00:00 |
| endedUtc | 2026-11-23T13:03:21.1723514+00:00 |
| exitCode | 0 |
| timedOut / childQuiescent | false / true |
| stdout bytes / stderr bytes | 5751 / 173 |
| NDJSON | 51 行 = 50 个 case + 1 个 summary，无 manifest |
| IDs | caseId RD-01～RD-50，连续唯一，失败 ID 为空 |
| source hashes | 4 项前后相同 |

日期为真实执行日 2026-11-23；以上 UTC 对应 Asia/Shanghai 同日 +08:00，不改写旧执行时间。stderr 的 173 bytes 是真实 VM ExperimentalWarning 及 trace-warnings 提示，完整保留，没有静默删去或视为测试失败。

原始最后一行 JSON：

```json
{"scope":"offline-evidence-path-redaction-tests","type":"summary","status":"PASS","cases":50,"passed":50,"failed":0,"assertions":526}
```

526 为动态递增的检查总量，含多输入负控、结构、冻结、计数与字面比较，不表示 526 种独立安全场景。本轮只运行一次新套，无失败运行被隐藏或改判；开发期间静态审查收窄了 Users 父根、根长度及裸 CR／语法拒绝策略，均在首次运行前完成。

## 4. 关键合成证据

独立测试自有路径与预期字面值，不从实现反算预期。全部根／账号标记为合成；未打开任何旧 raw/redacted 文件。业务 VM 只链接 util 和原 bytes 模块，driver 仅读取这两份业务源码；测试检查回调属于 driver，不是业务任意执行入口。VM 不是 OS 沙箱或全机网络审计。

- RD-02 的同结构 broker manifest 含恰五个合成 sources.path，实际经过 JSON.stringify 后输入。输出逐字与独立期望比较，并 JSON 解析复核五条占位符路径，状态和计数不变；实际 counts 为 records=1、stringTokens=30、changedTokens=5、worktreeReplacements=5、profileReplacements=0。输入原字符串不变。这是新合成数据，不是旧日志的脱敏结果。
- 覆盖普通 text、JSON 双反斜杠、正／混合斜杠、大小写、Unicode token、重复路径、无命中、幂等、正则元字符、rootSuffix、profile 内 worktree 优先与相同根。
- RD-33/RD-38 等逐字验证大整数、-0、指数、日期、空白和非路径 token 不被全对象重序列化改写。
- RD-29/RD-36 等确认 getter/Proxy 调用者陷阱次数为 0；闭式键、输入类型、最大字节／每行／深度／孤立 surrogate 等按固定码拒绝。
- RD-35 等覆盖 stdout 可转换但 stderr 失败时两流均 null；敏感 key、未知 profile 残留、损坏后行与整批语法优先均不输出部分副本。
- RD-47/RD-48 核对 Users 父根／1024 上限及后行语法错误优先；RD-49 核对 JSON-lines 裸 CR 拒绝而 text 保留；RD-50 核对前缀／中文紧贴的已知根字面替换。

原 140/264/21/34、Windows 原生／ACL 主预检、原探针 CLI 全部 NOT_EXECUTED；没有借用旧结果宣称本轮回归了这些套件。旧 CONTROL-006 仍为 FAIL，原数据及 6 项 NOT_EXECUTED 保留。

## 5. 来源前后原始字节哈希

本次读取／执行的新来源及复用的旧 loader 如下。原始字节哈希直接来自 before/after 采集，不通过改编码或换行凑匹配；README 作为来源说明保全，不声称其被业务模块加载。

| 相对文件 | bytes | 执行前 SHA-256（执行后相同） | 前后 |
|---|---:|---|---|
| `tools/hikvision-evidence-redaction/src/redact.mjs` | 9459 | `50b61b9ae33a683d9c219e7ce7c61281acd5d8ea86673560ce8c365b11aef723` | 相同 |
| `tools/hikvision-evidence-redaction/test/redact.test.mjs` | 27562 | `903a4ae0db9c1f38e5c93e2ad3cad6705bbdf0df551496566f21fe0981e38193` | 相同 |
| `tools/hikvision-evidence-redaction/README.md` | 7175 | `70c6bace0fefa3c9cc5c9159a02ac7627ecc6133eff3005336bee40993b23e00` | 相同 |
| `tools/hikvision-offline-entry/src/bytes.mjs` | 4894 | `8eb41d8784f66f5d4416d5459ab80fd1cf72f75486afcec1d8e568259ef82e36` | 相同 |

## 6. 工件、保全与脱敏边界

新目录 `HK-AI-08-json-path-redaction-2026-11-23-run01/` 与本工作树同级；从仓库根相对定位为 `../HK-AI-08-json-path-redaction-2026-11-23-run01/`，不是云端 /workspace/artifacts。仅新目录创建受保护的当前执行用户／SYSTEM 两条规则并读回；不改旧目录 ACL，不将其说成原 ACL 或 TOCTOU 预检通过。

原始 stdout/stderr、退出码、意图、metadata、前后来源哈希均保留。本轮测试输出仅闭式 case/summary，不输出断言原文或实际输入；未调用旧故障替换器制作“redacted”旁本，也不宣称完成生产数据去敏。冻结索引包含 11 个当时工件，自身单列；交付阶段的报告副本与回执另行关联，不覆盖此索引。

| 相对工件 | bytes | SHA-256 |
|---|---:|---|
| `attempt-01.exitcode.txt` | 3 | `13bf7b3039c63bf5a50491fa3cfd8eb4e699d1ba1436315aef9cbe5711530354` |
| `attempt-01.intent.json` | 529 | `5779cbf79ce58aaeaf3c34984097372f6b26ddf9ac36ef71bc524941ff8dfd10` |
| `attempt-01.metadata.json` | 785 | `8b6c569684b782129fe6ac08185850e9e502399aefaa831ba6e2e47cd17f0f82` |
| `attempt-01.source-after.json` | 791 | `f73891b9819eedeff64baea6278cbfe16487c7f608a84d26170529edbd8f861c` |
| `attempt-01.source-before.json` | 791 | `f73891b9819eedeff64baea6278cbfe16487c7f608a84d26170529edbd8f861c` |
| `attempt-01.stderr.raw` | 173 | `ffdd404a0d6dfd6eff5284bd1b83fc613735f5687eb97d32bf3116e83cffc69f` |
| `attempt-01.stdout.raw` | 5751 | `7f3716f10936655193f62bff959efd735ec0d6cfba039c04594b2d745d22e8f9` |
| `Capture-RedactionSuite.ps1` | 3879 | `45addf67acedb7b7ab4bf5375a26264d31e81cdc4e930713139a8a943b792cc8` |
| `execution-context.json` | 323 | `ca330220abd545f4ad27ec56906a9ada24e482a8fc2632d7ac14b19b11520aa0` |
| `preservation-after.json` | 15247 | `0c71522e291271f1a22239aa2a03577acd26d20516a4b1620d14a5286ebc2c2c` |
| `preservation-before.json` | 13459 | `5a7c16d8b32b3d52889f79bef11a8561387d465b91ed57e13ac9619be330b597` |
| `evidence-index.json` | 1872 | `cda9cf71f68fe7b02003cf6d9c4032129997138c62ded896613c83e4a7e6e8ce` |

`preservation-before.json` 与 `preservation-after.json` 分别逐项记录：44 个旧 TLS 阶段已知工件、5 个旧更正阶段工件、24 份既有源码／报告，前后全部相同。包含旧 collector、原 raw/redacted、原报告、错误草稿及回执；没有改旧索引或复写旧说明。其他旧对象与残留不处理。提交后还以固定 Git blob 和当前来源核对，结果在本轮新目录的 delivery.receipt.json，不改写提交。

## 7. 交接与禁止动作

本轮不读真实配置／凭据，不取得设备证书，不请求设备／扫描／上传照片／人员／权限操作，不运行 E1/E2，不接生产云、支付、部署或上线；没有真实 TLS、完整 CLI 或 E1 放行。allowRead 的既有源码不改。Git 远端查询及交付推送属于单独授权的仓库传输，不把它算成设备请求，也不冒称全机零网络。

提交前仅四个新增路径，执行 git diff --check；追加提交后 git show --check。普通 push 使用显式 `HEAD:refs/heads/fix/hk-ai-08-json-path-redaction-offline`，再 ls-remote 比对完整 SHA。不推 main、不强推、不 amend/rebase/reset/squash/merge/cherry-pick，不改系统／全局 Git/TLS/代理／安全配置。推送失败保留本地提交及真实结果，不改配置或抹去失败。交付后停止，等待独立复审。
