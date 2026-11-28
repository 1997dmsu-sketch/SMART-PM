# Windows 原生输入与明确确认：离线实施证据（待独立复审）

固定父提交 `1ebb86ea53872090a2bfcab89d1071538c221206`；独立分支 `feat/hk-face-readonly-interactive-input-2026-11-29`。本报告为实施方证据，完成提交与远端核验后交独立复审，不自行宣布验收关闭或解锁。

## 本机、时间与执行范围

- 日期为 2026-11-29，Asia/Shanghai；环境采集 2026-11-29T03:16:13.5673775+08:00。定向运行 2026-11-29T03:22:39+08:00 至 2026-11-29T03:24:19+08:00；1258 项回归 2026-11-29T03:24:41+08:00 至 2026-11-29T03:26:52+08:00。
- Windows 构建 22631.6199，DisplayVersion=23H2；注册表 ProductName=Windows 10 Home China（原样记录）。Node=v24.16.0，Windows PowerShell=5.1.22621.6133 Desktop，协调宿主 PowerShell=7.6.9。
- 新 helper 使用固定系统 `powershell.exe -NoLogo -NoProfile -NonInteractive -STA -File`，检查 Windows/5.1/Desktop/STA，显式引用系统自带框架程序集。未安装升级依赖、未绕过策略或申请管理员强行通过。
- 仅修改既有 Windows input adapter 和 bootstrap 两个源码；新增独立 PS/C# Forms helper、新测试和两个 fixture、说明及本报告，共 9 个 Git 路径。旧 CLI、SDK、宿主、策略、会话、Windows 证据接收器、旧测试和旧报告保持字节不变。
- 不读真实凭据、照片、连接配置、证书文件或凭据环境变量；不连接设备/云，不改路由，不写设备、删除人员、开门或运行 E1/E2。所有参数、凭据、证书与响应均为既有公开合成 fixture 或新合成种子，网络为假传输并加出站守卫。保留所有旧证据及本轮新文件，不清理残留。

## 真实输入与明确确认的代码接线

真实工厂 `createWindowsInteractiveInputAdapter()` 只接受空 options；创建不显示表单、不读取任何值。输入/确认仍经唯一品牌端口、私有快照与原有 bootstrap 连接。实际 executable 未安装这些端口或 runner，未新增 argv/env/JSON 解锁开关。真实交互模式代码可用，但本轮未以真实模式收集或确认数据。

新增 helper 的严格 frame/UTF-8/canonical base64/flat JSON 解析源自固定父提交中旧 helper 的实现，注释记录源提交及 blob；旧 helper 原字节不改。输入页面有独立字段，密码遮罩；输入数据通过 private stdout 往返，不经过公共日志或文本管道重编码。种子上限 49152，输出 input/expectations 上限 32768/8192；账号密码等控件原文不 trim。13 项合成种子与控件提交值逐项 Ordinal 核对，控件截断或改写即拒绝。型号、计划、人数及目标人员/库在确认前与提交快照再次绑定；精确审阅字节、capture、challenge 和证据引用仍被 Node 核对。

确认在所选证据接收方 open 成功后进行；使用原生接收器时继续执行原生 ACL/身份门禁。只读控件显示审阅视图和引用，不在确认页回显账号、密码或证书。未勾选时批准按钮禁用，事件处理器再次检查勾选和一次提交状态。必须勾选并明确点击批准；默认拒绝、撤回勾选、取消、关闭、无决定均不批准，Enter 在确认页不作为批准。helper 关闭 ACK、实际 exit 0、无尾输出/锁存失败后才转换成既有单次票据。

真实输入表单计时 240000ms，Node capture 与 bootstrap 独立预算 250000ms；确认页计时 25000ms，原有 approval 总上限 30000ms。合成控件模式沿用短 I/O/请求预算。close 仍有 2000ms ACK＋1500ms退出等待，finally 不被业务短 I/O 超时截断。异常环境若未观察到退出，不保证进程必已结束，也不把空 processExit 写为 0。

新增 60 项测试中，仅交互用例实际驱动同套 Windows Forms 控件与 Click/CheckedChanged/关闭路径；工厂/品牌等用例不启动采集。交互用例使用隐藏的合成窗口及明确白名单动作，不是单独解码 helper 或仅 JS 假批准对象；它们仍然是程序驱动，不是现场真人输入、阅读、点击或 Windows 身份认证的证据。

## 实测计数及首次结果

| 阶段 | tests/pass/fail/skipped | 退出码 | 说明 |
| --- | --- | --- | --- |
| 新增定向 | 60/60/0/0 | 0 | 包含工厂/品牌等非交互用例及合成控件交互用例 |
| admin-final | 918/918/0/0 | 0 | 实际完成 |
| tenant-final | 6/6/0/0 | 0 | 实际完成 |
| root-final | 297/297/0/0 | 0 | 实际完成 |
| worker-final | 35/35/0/0 | 0 | 实际完成 |
| worker-guard-selfcheck-final | 2/2/0/0 | 0 | 实际完成 |
| check-miniprogram-final | 非计数检查 | 0 | 实际完成 |
| checkin-face-static-final | 非计数检查 | 0 | 实际完成 |
| verify-face-sources-final | 非计数检查 | 0 | 实际完成 |
| verify-import-final | 非计数检查 | 1 | 历史失败保留 |

新增定向首次 60/60，原基线另按原始九条命令回归 1258/1258；两阶段使用同一批冻结源码、默认测试隔离，共 **1258＋60＝1318** 项合成验证通过，0 fail/cancelled/skipped/todo。1318 是这两个互补阶段的合计，不把定向用例重复计入原 admin 回归。没有把原回归命令加上新 UI 文件并发运行，以免无关编译负载改变原有短超时条件。

具体覆盖：工厂只构造不采集/拒注入能力，原始 seed 私有复制/严格 UTF-8 与字段拒绝，所有确认动作，同域配对/并发/重放/取消，证据先就绪且 helper clean close 先于首个假 HTTP，真实 CLI 的伪造 env 标志仍锁定，公共 stdout/stderr/IPC 无合成敏感标记。明确批准完成 36 次假 HTTP；带首尾空白、中文和 emoji 的密码用例以真实 SDK 产生 SHA-256 Digest，断言其 response 等于原文密码结果且不同于 trim 结果，共 37 次假 HTTP。不是只检查一个假成功状态。

无效/超限输入用例要求停止、无审批或无 HTTP；不将这些断言泛化为每种非法字符、窗口状态或精确错误码分类均已覆盖。未人工验证可见窗口布局、辅助技术、所有键盘/焦点/RDP/锁屏状态或长时间交互，未验证真实身份/TLS。

## 两项副本负控

- explicit-consent：exit 1，1 test / 0 pass / 1 fail；真实安全观察：`SYNTHETIC_NEGATIVE_CONSENT {"exitCode":0,"httpRequests":36}`。
- password-trim：exit 1，1 test / 0 pass / 1 fail；真实安全观察：`SYNTHETIC_NEGATIVE_DIGEST {"original":false,"trimmed":true}`。
- explicit-consent 仅在 helper 副本移除按钮初始/勾选使能与 Click 二次门禁，未勾选动作错误产生 exit0＋36 假 HTTP，新用例明确失败。
- password-trim 仅在 helper 副本把输出密码改成 Trim，真实 SDK 的 Digest 仅匹配 trim 后值，新用例失败。
- 两个测试副本只附加无敏感值的布尔/计数观察；不改断言。copy-manifest 记录所有源文件、每次变异及最终 SHA，受测原文件全部不变。两项故意失败不计入1318的通过数，不是任意异常或超时当作负控有效。

## 原始命令、输出与退出码

以下为实际 Node argv。各进程 stdout/stderr 独立保存，实际 exit 先落盘再解析 TAP。Windows helper 的 private stdout 不接入这些日志。

```text
node --test --test-reporter=tap admin-web/tests/face-readonly-windows-interactive.test.mjs
EXIT_CODE=0
```

```text
node --test --test-reporter=tap admin-web/tests/auto-fill.test.mjs admin-web/tests/checkin-face-config.test.mjs admin-web/tests/checkin-face-worker.test.mjs admin-web/tests/face-access-plan.test.mjs admin-web/tests/face-enroll-cli.test.mjs admin-web/tests/face-enroll-powershell.test.mjs admin-web/tests/face-enrollment-command.test.mjs admin-web/tests/face-enrollment.test.mjs admin-web/tests/face-management-ui.test.mjs admin-web/tests/face-management.test.mjs admin-web/tests/face-readonly-host.test.mjs admin-web/tests/face-readonly-policy.test.mjs admin-web/tests/face-server.test.mjs admin-web/tests/face-ui.test.mjs admin-web/tests/hikvision-client.test.mjs admin-web/tests/layout-batches.test.mjs admin-web/tests/local-cloud-database.test.mjs admin-web/tests/property.test.mjs admin-web/tests/qishanyuan-test-data.test.mjs admin-web/tests/sdk-database-adapter.test.mjs admin-web/tests/server.test.mjs admin-web/tests/static-path.test.mjs admin-web/tests/tenant-password-accounts.test.mjs admin-web/tests/vr.test.mjs admin-web/tests/face-readonly-cli.test.mjs admin-web/tests/face-readonly-session.test.mjs admin-web/tests/face-readonly-local-bootstrap.test.mjs admin-web/tests/face-readonly-promise-observation.test.mjs admin-web/tests/face-readonly-windows-evidence.test.mjs admin-web/tests/face-readonly-windows-evidence-faults.test.mjs admin-web/tests/face-readonly-windows-input.test.mjs
EXIT_CODE=0
```

```text
node --require ./tests/support/d-network-guard.cjs --test --test-reporter=tap admin-web/tests/tenant-password-routes.test.mjs
EXIT_CODE=0
```

```text
node --require ./tests/support/d-network-guard.cjs --test --test-reporter=tap tests/account-login-api.test.cjs tests/account-login-cloud.test.cjs tests/account-login-pages.test.cjs tests/action-login-checkin-pages.test.cjs tests/action-login-gate.test.cjs tests/action-login-private-pages.test.cjs tests/action-login-public-pages.test.cjs tests/checkin-face-api.test.cjs tests/checkin-face-cloud-workflow.test.cjs tests/checkin-face-cross-module.test.cjs tests/checkin-face-pages.test.cjs tests/checkin-face-qa-gates.test.cjs tests/cloud-bootstrap.test.cjs tests/frontend.test.cjs tests/identity.test.cjs tests/layout.test.cjs tests/phone-login.test.cjs tests/public-houses.test.cjs tests/qishanyuan-pages.test.cjs tests/qishanyuan-test-preset.test.cjs tests/tenant-password-gates.test.cjs tests/wechat-modules.test.cjs tests/wxml.test.cjs
EXIT_CODE=0
```

```text
node --require ./tools/checkin-face-worker/tests/network-guard.cjs --test --test-reporter=tap tools/checkin-face-worker/tests/rework-r05-r06.test.mjs tools/checkin-face-worker/tests/rework-r08-r09.test.mjs tools/checkin-face-worker/tests/sdk-resolution.test.mjs
EXIT_CODE=0
```

```text
node --require ./tools/checkin-face-worker/tests/network-guard.cjs --test --test-reporter=tap tools/checkin-face-worker/tests/network-guard-selfcheck.test.mjs
EXIT_CODE=0
```

```text
node scripts/check-miniprogram.mjs
EXIT_CODE=0
```

```text
node scripts/checkin-face-static-check.mjs
EXIT_CODE=0
```

```text
node scripts/verify-checkin-face-sources.mjs
EXIT_CODE=0
```

```text
node scripts/verify-import.mjs
EXIT_CODE=1
```

负控的完整 argv、实际退出码和布尔观察见 `negative-controls/*/result.json`；协调器 `run-validation.mjs`、`run-negative-controls.mjs`、`run-aux.mjs` 随独立证据交付。

## 源码前后哈希与固定起点

57 个固定起点文件先按原字节核对；允许修改的 adapter/bootstrap 之外 55 个文件保留原 SHA。两阶段各保存 51 个受测源码前/后哈希及原字节副本，均保持一致；定向＝原回归＝当前受测源码。提交时另核对实际 Git index/blob 与这些字节相同，不以换行转换凑哈希。

| 本轮变更源码 | 起点 SHA-256 | 定向/原回归前＝后 SHA-256 |
| --- | --- | --- |
| admin-web/lib/face-readonly-local-bootstrap.mjs | df4cc5132faf7dce18117472570feea0089add406892673db7da10222dc87b44 | 041d28bef825543909d20a726f632548deaad30fe0fb82318c9d0fec1106646d |
| admin-web/lib/face-readonly-windows-input.mjs | 62033129a6b7c159e99b5da1489bd975de58341fef93c46eba1b9362c6ba95b3 | 1ad5c7186ac0cf7441ed880dc01632e8aeab9c5f48d04797a5c30f19f4d73c87 |
| tools/hikvision-readonly-interactive/Invoke-WindowsReadonlyInteractive.ps1 | NEW | 6ac61d542c9c8047349022233ff56a2bf0abec455197d3944932651fbf89f188 |
| tools/hikvision-readonly-interactive/WindowsReadonlyInteractive.cs | NEW | d214626bbb175b7794280354ace4684a4a4ecc8c72d28964b80d1cc4453a5e44 |
| admin-web/tests/face-readonly-windows-interactive.test.mjs | NEW | 614b4d32a9251d1e22d82ccffb5b65d9d8e64de70935f2458187357dfaa8c4e6 |
| admin-web/tests/fixtures/face-readonly-windows-interactive-child.mjs | NEW | 0a856fd2d8c41c1974aaa6f0f8cc873dc67f4219a83b9319480ad677b73449e4 |
| admin-web/tests/fixtures/face-readonly-windows-interactive-synthetic.mjs | NEW | d6b5f5eab367573afcab560732819d328fe08b79ddc984370c5c98f2d7d35b1c |

完整51路径前后清单见 `focused/source-before.json`、`focused/source-after.json`、`full/source-before.json`、`full/source-after.json`；固定起点57路径见 `source-pre-edit.json`；55个保护文件见 `regression-verification.json` 的 protectedHashes。实际 CLI SHA 仍为 `a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d`。

## 失败保留与工件取件

本轮定向及1258回归首次均通过，三项非计数静态检查退出0。`verify-import` 仍真实 exit1：login/config.json 实际 SHA `aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6` 对基线 `ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`。未修改配置或改记通过。
父阶段辅助核验的 `Actual CLI changed` 初次终端失败与随后留档失败、r2修正记录继续保留；首次CLI 33/34、原生证据38/39及历史Promise/构造器边界等均未改写。旧1117项记录不改写为失败。首跑前静态自查修正FDID长度、控件可能改写种子、表单快照Dispose时序，均不冒充已执行的失败测试。

本机独立目录名 `FACE-READONLY-INTERACTIVE-INPUT-20261129T031612-802f1f01`，位于项目负责人本机授权工作区；不是云端附件。原日志受控保留，同机可直接读取；异机由负责人转交最终脱敏 review-bundle ZIP。包内不携带 raw stdout/stderr 日志；由对应脱敏副本和清单校验。ZIP 是字节副本，不保留 NTFS ACL/文件身份语义，不能替代本机原生对象。

- `environment.json`、`source-pre-edit.json`、`pre-edit-source/`；两阶段 `summary/source-before/source-after.json` 与 `source/`；
- `native-fixtures/focused/`、`native-fixtures/full/` 与 `negative-controls/` 保存全部新对象、副本、外层安全输出、退出码和引用，不清理；
- `log-manifest.json` 列下表全部 raw/脱敏日志大小及 SHA；后续核验、提交推送日志由最终日志清单补充；
- `git-delivery/` 保留diff/show检查、精确路径、index/commit blob、追加提交、显式refspec push与ls-remote完整SHA证据。报告不预填尚未发生的提交/推送；以实际交付result为准。

| 相对原日志（对应 .redacted.log 副本） | 原 bytes / SHA-256 | 脱敏 bytes / SHA-256 |
| --- | --- | --- |
| focused/interactive-focused.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| focused/interactive-focused.stdout.log | 15011 / 84ff05557c2d2b2e3e77d35b32170202c8f0e9a1446ade64d9a1a1980b2efd18 | 15011 / 84ff05557c2d2b2e3e77d35b32170202c8f0e9a1446ade64d9a1a1980b2efd18 |
| focused-run.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| focused-run.stdout.log | 393 / 7af300a203327cbcc96fa910bbf130ae516a65a4e4d271776f71cc7bbddba25a | 393 / 7af300a203327cbcc96fa910bbf130ae516a65a4e4d271776f71cc7bbddba25a |
| full/admin-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/admin-final.stdout.log | 215279 / 8fc802f5762af3bf95a540f0141f867aeedbf450c1a8103ac6e7f0326da36c50 | 215279 / 8fc802f5762af3bf95a540f0141f867aeedbf450c1a8103ac6e7f0326da36c50 |
| full/check-miniprogram-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/check-miniprogram-final.stdout.log | 185 / 89535f0f900b0398830261e5ff0bddccdc309c859b94c34154d63f5a3994a2e0 | 185 / 89535f0f900b0398830261e5ff0bddccdc309c859b94c34154d63f5a3994a2e0 |
| full/checkin-face-static-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/checkin-face-static-final.stdout.log | 73 / d3acf855ec25633177b8dfd2e04b93d122d66e0cdd7dc17fadde902208d790ad | 73 / d3acf855ec25633177b8dfd2e04b93d122d66e0cdd7dc17fadde902208d790ad |
| full/root-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/root-final.stdout.log | 98339 / 3bbaf2463d2cad038748edb3b768677b0d416f2c8a51219e2b50bb8b142eb11a | 98339 / 3bbaf2463d2cad038748edb3b768677b0d416f2c8a51219e2b50bb8b142eb11a |
| full/tenant-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/tenant-final.stdout.log | 1452 / 96569bc48068c4069771f9954fbd599ff16e64266f8dcf053b30101dfb50c2f8 | 1452 / 96569bc48068c4069771f9954fbd599ff16e64266f8dcf053b30101dfb50c2f8 |
| full/verify-face-sources-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/verify-face-sources-final.stdout.log | 28289 / 8f870ecadb3604229733cc8d592e52c7aab89429f86327a888decc6b1b8ac5d3 | 28289 / 8f870ecadb3604229733cc8d592e52c7aab89429f86327a888decc6b1b8ac5d3 |
| full/verify-import-final.stderr.log | 951 / 677705256f96753c8a5136df3167375d215ff220c85ffea58ebd58a1fb1f8d44 | 951 / 677705256f96753c8a5136df3167375d215ff220c85ffea58ebd58a1fb1f8d44 |
| full/verify-import-final.stdout.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/worker-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/worker-final.stdout.log | 17406 / e4afb75fcdd7642dd69bb0e60eb2afcbc61a8ccd0d7a4036386eaeabdcd16698 | 17406 / e4afb75fcdd7642dd69bb0e60eb2afcbc61a8ccd0d7a4036386eaeabdcd16698 |
| full/worker-guard-selfcheck-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/worker-guard-selfcheck-final.stdout.log | 501 / 32a1cfbcfed11b41a8bffd667d1159a7a81e1705251006d9f465e0f2343e70f0 | 501 / 32a1cfbcfed11b41a8bffd667d1159a7a81e1705251006d9f465e0f2343e70f0 |
| full-run.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full-run.stdout.log | 5462 / 6fcb7559d35fdf0d5aa39b988ebbbff022e2e0686041743d8a7b00d0cff7e2e5 | 5462 / 6fcb7559d35fdf0d5aa39b988ebbbff022e2e0686041743d8a7b00d0cff7e2e5 |
| native-fixtures/full/case_01a369b4c6c34a29b9a8cb0bdcae95a7/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_01a369b4c6c34a29b9a8cb0bdcae95a7/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_2625634813ba40bf8d430c8c75a2f9b4/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_2625634813ba40bf8d430c8c75a2f9b4/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_56205559319043ecb311fdd1c8f6c4ab/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_56205559319043ecb311fdd1c8f6c4ab/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_825c7eea81da49429d1b84cc708121ec/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_825c7eea81da49429d1b84cc708121ec/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_85eac74f11f7488b95e76dc58cd72b5f/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_85eac74f11f7488b95e76dc58cd72b5f/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_8f333136a78045ae99cc9910af738060/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_8f333136a78045ae99cc9910af738060/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_937ab90b329b40a8a74f7417fbf0aee3/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_937ab90b329b40a8a74f7417fbf0aee3/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_a2a4901d49074437bf33c3b523ffc685/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_a2a4901d49074437bf33c3b523ffc685/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_b34f341f0e90488b930a4a2f34bd1903/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_b34f341f0e90488b930a4a2f34bd1903/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| negative-controls/explicit-consent/control.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| negative-controls/explicit-consent/control.stdout.log | 2145 / 96f6417c4b4f0eca8a92ecd814907e33a568c7c10647c91569cdc93f010a482e | 2145 / 96f6417c4b4f0eca8a92ecd814907e33a568c7c10647c91569cdc93f010a482e |
| negative-controls/password-trim/control.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| negative-controls/password-trim/control.stdout.log | 2155 / 8c1a0b76edb537d32ebe1673d634721ea942e15a45b8b12f91fe74488ffddf1b | 2155 / 8c1a0b76edb537d32ebe1673d634721ea942e15a45b8b12f91fe74488ffddf1b |
| negative-run.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| negative-run.stdout.log | 1229 / b59d27104408e7b663ac0c92fd511f8b9e21c6c57e269322e8b971a6e228b369 | 1229 / b59d27104408e7b663ac0c92fd511f8b9e21c6c57e269322e8b971a6e228b369 |

## 限定结论与停止点

本报告仅证明真实输入/确认代码路径在合成控件驱动与假传输下的离线接入。不能推断真人已操作、Windows身份已认证、真实TLS/证书来源已核验、实际CLI已解锁或实机名单/人脸已复验。9人及目标 `F03FF8DA7299CE148` 实机状态仍为 NOT_EXECUTED。
同机同信任域、管理员/内核及受信任代码被改写、Promise构造器/原型、非原子TOCTOU及句柄释放后、崩溃/断电、不可变字符串内存擦除、旧Node仅静态兼容边界均保留。CLI仍锁定，未开启派发，不放宽ACL，不作E1/E2放行。全部旧证据和新对象保留；提交推送核对远端SHA后停手，交另一个独立Codex复审。
