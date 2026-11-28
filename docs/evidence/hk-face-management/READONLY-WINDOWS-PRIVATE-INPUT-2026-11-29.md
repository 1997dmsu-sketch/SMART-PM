# Windows 私密输入适配：合成离线实施证据（待独立复审）

本次由实施方从固定 `d8ceda2271f7ecdc36d298d98a21144ef47477d6` 建立独立实现分支 `feat/hk-face-readonly-private-input-2026-11-29`。结论仅为本机固定 PowerShell 5.1 私密管道与原有受控只读链路的合成离线验证；不自行关闭验收，不声称真实操作者身份、真实输入 UI、真实 TLS 或设备验收。

## 环境、时间与范围

- 实际日期：2026-11-29，Asia/Shanghai。环境采集 2026-11-29T01:36:27.4293223+08:00；聚焦 2026-11-29T01:49:14+08:00 至 2026-11-29T01:50:30+08:00；完整回归 2026-11-29T01:50:55+08:00 至 2026-11-29T01:53:20+08:00。
- Windows 构建 22631.6199，DisplayVersion=23H2；注册表 ProductName=Windows 10 Home China（原样记录，不用名称替代构建号）。
- Node v24.16.0；Windows PowerShell 5.1.22621.6133 Desktop，固定系统 powershell.exe；PowerShell 7=7.6.9 为协调宿主，不替代原生 helper 的 5.1。未安装或升级环境，未绕过执行策略。
- Git 范围：仅修改既有 `admin-web/lib/face-readonly-local-bootstrap.mjs`；新增私密输入模块、固定 PS/C# helper、新测试及两个 fixture、说明和本报告，共 9 个路径。原 CLI、SDK、宿主、策略、会话、Windows 原生证据接收器、旧测试及历史报告不变。
- 输入、凭据、证书、独立预期、确认事件均为合成；使用品牌化假传输，子进程加出站守卫。实际设备连接、照片读取、设备写入、开门、路由配置、worker/派发、E1/E2 均为 0 / NOT_EXECUTED。没有处理或清理旧残留。

## 接线与门禁

1. 工厂即时复制输入和独立预期原始字节，拒绝 accessor、Proxy、未知字段、伪造确认对象和超限输入。固定 Windows helper 仅接收私密 stdin；其私密 stdout 不接入公共日志。UTF-8 严格解码，原始字节通过 canonical base64 往返核对，再进入既有严格 JSON 解析与私有快照。
2. 同一个适配器仅领取一次；输入和审批端口必须为同对品牌，绑定唯一 bootstrap 上下文。复制 handle、跨域配对、上下文重用和并发重放均不能再捕获或审批。
3. 先创建/检查原生证据目的地，再审阅同一快照视图；响应逐一绑定 capture、challenge、view 字节和 evidence reference。默认为拒绝，none/cancel/reject 和异常均不能授权。辅助进程 close ACK、实际 exit 0、无残留输出且无终止错误后才铸造原有单次票据。
4. finally 直接等待 helper 自身有界 close（ACK 2000ms、退出等待 1500ms），不让业务 1ms I/O 超时提前截断收尾。超时/被终止时不把空 processExit 填成 0。原生证据接收器原有有界退出及 INCOMPLETE 规则不放宽。
5. 沿用真实 SDK、宿主、策略及证据接收器，未增加任何实际 CLI runner 或 argv/env 解锁路径。pin-before-send、精确只读白名单、阻写、取消/异常熔断保持原义。假成功路径 9 人、目标人脸命中、36 次假 HTTP 仅是合成 DTO。

`createSyntheticWindowsConfirmation` 仅为代码内品牌假事件；私密 IPC 不是真人身份认证。没有真实输入 GUI/Windows 账号验证，不声明任意受信任代码安全沙箱。可变缓冲区收尾清零不等于运行时不可变字符串/内存副本物理擦除。

## 实际执行结果

| 阶段 | tests/pass/fail/skip | 实际退出码 | 说明 |
| --- | --- | --- | --- |
| 新增聚焦 | 65/65/0/0 | 0 | 57 核心＋8 helper 副本故障；均实际 Windows 执行 |
| admin-final | 918/918/0/0 | 0 | 实际完成 |
| tenant-final | 6/6/0/0 | 0 | 实际完成 |
| root-final | 297/297/0/0 | 0 | 实际完成 |
| worker-final | 35/35/0/0 | 0 | 实际完成 |
| worker-guard-selfcheck-final | 2/2/0/0 | 0 | 实际完成 |
| check-miniprogram-final | 非计数检查 | 0 | 实际完成 |
| checkin-face-static-final | 非计数检查 | 0 | 实际完成 |
| verify-face-sources-final | 非计数检查 | 0 | 实际完成 |
| verify-import-final | 非计数检查 | 1 | 既有失败原样保留 |

完整计数为原 1193＋新增 65＝1258，1258 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo。聚焦与完整运行均退出 0（协调器将已知 verify-import exit 1 单列检查，不写成该检查通过）。没有重跑掩盖本次测试失败；本轮聚焦和完整套件首次均通过。

新增实测包括 UTF-8 EOF/非法序列、重复解码键、缺字段、原字节复制、大小限制、同域绑定、拒绝/取消/缺决定、重放、并发、证据已存在不覆盖、证据先就绪、审批 helper 先关闭、1ms 超时收尾、首个假 HTTP 异常后零后续、公共 stdout/stderr/IPC 不泄露合成私密标记、生产 CLI 保持锁定。

八类 helper 故障仅改源码副本：wrong-capture、wrong-challenge、wrong-reference、wrong-view、duplicate-review、private-extra-output、close-ack-exit-one、late-review。均非零、零 HTTP/零假 TLS、未产生候选 seal，重放停止。聚焦及完整共 16 套副本；每套保留副本清单和安全外层 stdout/stderr/exit/IPC，私密 helper pipe 不保存为日志。

## 两项故意负控

- challenge-binding：仅在独立副本移除 challenge 等价检查，执行单个 wrong-challenge 用例，测试 exit 1、1 test / 0 pass / 1 fail；断言 `assert(response.exitCode > 0)` 失败，证明去掉门禁会错误放行合成流程。
- private-byte-copy：仅在独立副本把私有复制改为返回调用方字节，执行 caller mutation 单例，测试 exit 1、1 test / 0 pass / 1 fail；实际 2 对预期 0 的断言失败。
- 两项未超时/跳过，原源码均哈希不变；它们是故意失败的判别力证据，不计入 1258 项通过数。命令、原/变异哈希和副本文件清单见 `negative-controls/*/{result,copy-manifest}.json`。

## 辅助核验失败与历史记录

辅助 `verify-results.mjs` 首次终端执行 exit 1，分类 `Actual CLI changed`；原因是该辅助脚本误匹配 `main({ signal })`，实际固定源码为 `main({ signal: controller.signal })`。CLI SHA 实际前后相同。原脚本保留；随后对原字节脚本做一次留档执行，真实 stdout/stderr/exit 见 `verifier-initial-recorded.*`，同样 exit 1。仅新增 `verify-results-r2.mjs` 修正文本断言，`verifier-r2.*` exit 0；未修改受测源码，也未因此重跑测试。

`verify-import` 仍 exit 1：login/config.json 实际 SHA `aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`，基线预期 `ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`。没有修配置或改写旧结论。首次 CLI 33/34、原生证据首轮 38/39、Promise/构造器边界及全部历史受阻/失败仍由旧报告及旧工件原样保留；1117 项旧记录不改写为失败。

## 实际命令与原始退出码

以下为实际 Node argv（默认测试隔离）；长命令原样列出，独立子进程的 stdout、stderr 与退出码先保存后解析。协调器及 source 快照也随本机证据交付。

```text
node --test --test-reporter=tap admin-web/tests/face-readonly-windows-input.test.mjs
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

## 源码前后哈希与保护范围

`focused` 与 `full` 各保存 46 个受测源码前/后 SHA-256 和原字节副本，均相同，且聚焦＝完整＝当前源码。49 个固定起点文件中，除允许改动的 bootstrap 外其余 48 个源码、旧测试、说明与报告均保持基线字节。提交时还需核对 index/Git blob 与这些受测字节一致，交付结果单独留档。

| 受测路径 | 运行前＝后 SHA-256 |
| --- | --- |
| admin-web/lib/hikvision-client.mjs | d79ef3ba00914d4bc551ab363315f6fdb183da44088577fe14c1902786e76001 |
| admin-web/lib/face-enrollment.mjs | 789e1fa39a7a01cce1d363f16f0ec4eb3107c3833f9063136b0d6a78acf128be |
| admin-web/server.mjs | 0b4c999ee71b151efc85b6d14777d093350e034caa63c7eed017cb448878a763 |
| admin-web/public/face-ui.js | 43d954d22fe3ad5498764e1991b9574d04e1521542a9cdb346041c8ae1ae31fd |
| admin-web/public/style.css | 0ecea30847c15a225a62292391a31b5292963c72b2b47799fa97a540779d2a3d |
| admin-web/tests/face-management.test.mjs | bf38ee5bd1ebffff67b892f7e15e63a28594c59a46dcbe6e56549a1dd979f286 |
| admin-web/tests/face-management-ui.test.mjs | a813242ab62aa7298ba6bc29fee87b42a626bf820bdcd2c95aa7e255d276e3af |
| admin-web/tests/face-server.test.mjs | 94b3a329e913f92425f0ee23a13704b567bd591f8e72113e5556ae65d751a224 |
| docs/checkin-face-experience-source-hashes.json | d01eb1ff12c4a921dd420047d52a215a19d16ec04a4814a2f27e8c665b5dde7c |
| admin-web/lib/face-access-plan.mjs | f3962e72a15c55512aea5b7a87d0465d37b1142218a82138c01635c41656c9f1 |
| admin-web/lib/face-readonly-host.mjs | 4a9365370607cc246c600351a0dd4e9c293728fbbcd035f587b356bc0976f20d |
| admin-web/lib/face-readonly-policy.mjs | e24a109d1948bbe6b289eb27b1f03b111deb37639f207c895ae6cc9aa23e4086 |
| admin-web/tests/face-readonly-host.test.mjs | d3cbd900cbd03c8e469bbff636a5e48aeaf171449f576e75e5acfb0cb1e6f112 |
| admin-web/tests/face-readonly-policy.test.mjs | 89dd1e481065849b6afd5fff6d08938a06f26542f2ad2a13f83813a5ebc72277 |
| admin-web/tests/fixtures/face-readonly-fake-transport.mjs | 2c6c55ed2ee7e7b4abb43e08b407f1b777e3f77e8253bee5b439f25aee27451a |
| admin-web/face-readonly.mjs | a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d |
| admin-web/lib/face-readonly-command.mjs | 0217c79857b055f8485ec0631c2ab03b48e03d18e8d86f5b529d53f1fdb28e35 |
| admin-web/tests/face-readonly-cli.test.mjs | 42b3c01a0e219522ecb61733339fd2e5e3b0a65abedc1b8b5aab42f7dd953ca3 |
| admin-web/tests/fixtures/face-readonly-cli-child.mjs | ebf4f8e064cbc8bc9edb6005269afffd13878b975ab902359c1ec1345d63b600 |
| admin-web/tests/fixtures/face-readonly-cli-network-guard.mjs | 170fecbf6df460f11141b5f735737ccea1f58850b210bf77f43e8826d50dd6fc |
| admin-web/tests/fixtures/face-readonly-cli-synthetic-adapter.mjs | 9ee6d4d96cfb18c5f521265f339e390a89bd10368c88b13b9d83c1c3af1b42c2 |
| admin-web/tests/fixtures/face-readonly-cli-synthetic-input.mjs | 3d248af179c5cc6c1fdb8764cbde9a9b36bfdfba30d911dbe4a86d19831cdf03 |
| admin-web/lib/face-readonly-session.mjs | 076e4b13629ff69290bdd31b00ae30575a35df18f61692ed36503e3d1417ad4d |
| admin-web/tests/face-readonly-session.test.mjs | 71adf8fcee97941f41fdb13441680196aa157a1af26a0a3de1ed308fccfa89ce |
| admin-web/tests/fixtures/face-readonly-session-child.mjs | dd353ec9cfcf76d83f7d528a063e40095a9f87a66be2813792a64f24fd07323e |
| admin-web/tests/fixtures/face-readonly-session-network-guard.mjs | f1073e115563fb420ca5c242e16d0eb544d9739ade2a545c31bbcdeb2c86085d |
| admin-web/tests/fixtures/face-readonly-session-synthetic.mjs | 74d4b2493de7b88cf4502415ff084325bf8f582e9f10440b42a3a89f7a9eca07 |
| admin-web/lib/face-readonly-local-bootstrap.mjs | df4cc5132faf7dce18117472570feea0089add406892673db7da10222dc87b44 |
| admin-web/tests/face-readonly-local-bootstrap.test.mjs | 937dfe5f322db0920b04d538bcf880b188d41125bc115e5ed349d19ad51e2d57 |
| admin-web/tests/fixtures/face-readonly-local-bootstrap-child.mjs | 1878e07aefb5eac0633b02b52126b3bcb392df7b87f5708be970c580779e2bf1 |
| admin-web/tests/fixtures/face-readonly-local-bootstrap-synthetic.mjs | 8b844c4c3a432af44560449316e6fdc0d43736d38323ff591423a494fc2da0fd |
| admin-web/tests/face-readonly-promise-observation.test.mjs | 98377256f578e7855aaccec335ee4f1a0739a3231bbfccdfcf4d10fc482da5fa |
| admin-web/tests/fixtures/face-readonly-promise-observation-child.mjs | 26d862896338c5e86dd2959b882e39b72226b1b5ff97026940466e77b0651c59 |
| admin-web/tests/face-readonly-windows-evidence.test.mjs | f5ad0e6225839f91eea4cad486c2966cf103bed93365f1791b7a43d382109dc1 |
| admin-web/tests/fixtures/face-readonly-windows-evidence-synthetic.mjs | aaa5335c5642bc4df457ab35baafbf4e5c1c70365bffceaf3ee6811fa0b2eb22 |
| admin-web/lib/face-readonly-windows-evidence.mjs | 6fd355d3a5cf1ab09f1db79d53cbd2bc7b412ab213f3abbb9eddf3dc2cf34be0 |
| tools/hikvision-readonly-evidence/Invoke-WindowsEvidence.ps1 | 6b0ee013c7d75a3cb20880f85690ba4d249a26df0aa08ff055a3b365f5c704f4 |
| tools/hikvision-readonly-evidence/WindowsEvidence.cs | d428e1b9ac7e68131c0e5b4a94c1d0b16a2612ca6d8baec9f2ba1576b8064029 |
| admin-web/tests/face-readonly-windows-evidence-faults.test.mjs | c2f2f0ef525c13ae3559ae61cf1c3ce4cd5a043cbed3341d810e2d10a3af3ad1 |
| admin-web/tests/fixtures/face-readonly-windows-evidence-fault-child.mjs | 9bd826cbc075e021ae9a2d09b85c980fe715d83cbe86567b9a881cbd076563e6 |
| admin-web/lib/face-readonly-windows-input.mjs | 62033129a6b7c159e99b5da1489bd975de58341fef93c46eba1b9362c6ba95b3 |
| tools/hikvision-readonly-input/Invoke-WindowsReadonlyInput.ps1 | 66af3cef92fa5762365f1720edbb9eaa22e4189651e2b9a4c8531f22f561438a |
| tools/hikvision-readonly-input/WindowsReadonlyInput.cs | fee520395ffb2de8a2faefc97c009413621ae53d1ce6b43e1d8b3a449c0c5785 |
| admin-web/tests/face-readonly-windows-input.test.mjs | 3467da736c42bbff51fc86c8ffcdde311279e38b80dffecd286238de5cf6bec0 |
| admin-web/tests/fixtures/face-readonly-windows-input-synthetic.mjs | 197b93c8df17a50b209147bd9fb9ac71c10c7ae411110913e02913d28a249c03 |
| admin-web/tests/fixtures/face-readonly-windows-input-child.mjs | ecf90446edbcdea748c12bd125dec3bcecc49c3b7a598c630083a6530a8994c3 |

完整保护文件清单见 `regression-verification.json` 的 protectedHashes；固定源清单见 `source-pre-edit.json`。既有 CLI SHA 保持 `a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d`。

## 工件定位与取件

本机独立目录名：`FACE-READONLY-PRIVATE-INPUT-20261129T013627-cec1f3ac`，位于项目负责人已授权的本机工作区下。不是云端附件或共享路径；同机复核可实际读取该目录，异机须由负责人转交最终脱敏 review-bundle ZIP。ZIP 仅为字节副本，不保留 NTFS ACL/文件身份语义，不代替原生对象原件。

- `environment.json`、`source-pre-edit.json`、`focused/{summary,source-before,source-after}.json`、`full/{summary,source-before,source-after}.json`、各 phase 的 `source/`；
- `native-fixtures/focused/`、`native-fixtures/full/` 保存本轮全部合成对象及 16 套故障副本，不递归清理；原 evidence refs 不替换、不迁移；
- `negative-controls/` 保存两项原字节副本、变异副本和故意失败日志；
- `log-manifest.json` 列下表全部原日志/脱敏副本大小与完整 SHA；核验后的 `verifier-r2` 日志及后续 Git stdout/stderr 由最终日志清单补充，最终 ZIP 的 entry manifest 逐项列大小、SHA 并校验 CRC；
- `git-delivery/` 留存 scope、diff/show check、index/commit blob 哈希、追加提交、显式 push 及 ls-remote 远端完整 SHA。当前报告不预填尚未产生的提交/推送成功；以实际交付结果文件为准。

原日志受控保留本机，脱敏仅替换个人 profile 路径和 SID；不把 raw stderr 复制进聊天。下表每行给出原文件及其 `.redacted.log` 对应副本。

| 相对原日志（脱敏副本同名加 .redacted） | 原 bytes / SHA-256 | 脱敏 bytes / SHA-256 |
| --- | --- | --- |
| focused/private-input-focused.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| focused/private-input-focused.stdout.log | 15693 / f13515080714514bf21cc1a2289289b958eeb4a788fcc0b4402c483cfee087d9 | 15693 / f13515080714514bf21cc1a2289289b958eeb4a788fcc0b4402c483cfee087d9 |
| full/admin-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/admin-final.stdout.log | 215297 / 4c6e27ecb572a028806decbff3c1c7a76aa1529755584f2716d4b242d0721d75 | 215297 / 4c6e27ecb572a028806decbff3c1c7a76aa1529755584f2716d4b242d0721d75 |
| full/check-miniprogram-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/check-miniprogram-final.stdout.log | 185 / 89535f0f900b0398830261e5ff0bddccdc309c859b94c34154d63f5a3994a2e0 | 185 / 89535f0f900b0398830261e5ff0bddccdc309c859b94c34154d63f5a3994a2e0 |
| full/checkin-face-static-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/checkin-face-static-final.stdout.log | 73 / d3acf855ec25633177b8dfd2e04b93d122d66e0cdd7dc17fadde902208d790ad | 73 / d3acf855ec25633177b8dfd2e04b93d122d66e0cdd7dc17fadde902208d790ad |
| full/root-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/root-final.stdout.log | 98353 / 1ca026f7f3086e3784a031e32e839af993d6a6d64d5f460f6f9c634ecdd65a26 | 98353 / 1ca026f7f3086e3784a031e32e839af993d6a6d64d5f460f6f9c634ecdd65a26 |
| full/tenant-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/tenant-final.stdout.log | 1452 / 6fb87d29bb1892da93d99790d95d4ecf3aff813981fd12d69619cd8f6221838c | 1452 / 6fb87d29bb1892da93d99790d95d4ecf3aff813981fd12d69619cd8f6221838c |
| full/verify-face-sources-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/verify-face-sources-final.stdout.log | 28289 / 8f870ecadb3604229733cc8d592e52c7aab89429f86327a888decc6b1b8ac5d3 | 28289 / 8f870ecadb3604229733cc8d592e52c7aab89429f86327a888decc6b1b8ac5d3 |
| full/verify-import-final.stderr.log | 947 / 6e02652bec703df72e038f6e1c870b29de3c093bcd5016f1b02d28ee158d4b01 | 947 / 6e02652bec703df72e038f6e1c870b29de3c093bcd5016f1b02d28ee158d4b01 |
| full/verify-import-final.stdout.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/worker-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/worker-final.stdout.log | 17403 / c07ac876f88a42e3b3397d2e84dec76097d1e993024e30e3cce3cc26322f845e | 17403 / c07ac876f88a42e3b3397d2e84dec76097d1e993024e30e3cce3cc26322f845e |
| full/worker-guard-selfcheck-final.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| full/worker-guard-selfcheck-final.stdout.log | 501 / 506ed19b612ab54274f6ba96625f06a5275be3d125f7054c1d85a20ddf17af49 | 501 / 506ed19b612ab54274f6ba96625f06a5275be3d125f7054c1d85a20ddf17af49 |
| native-fixtures/full/case_012c4ec78c374b968035fba3b171ed4e/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_012c4ec78c374b968035fba3b171ed4e/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_0422f37daa574f4087a0e9398b5f2605/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_0422f37daa574f4087a0e9398b5f2605/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_1c81ed7a1f45416486b9ba541de94593/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_1c81ed7a1f45416486b9ba541de94593/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_49e18f3ad69746f783e5c764604acaaf/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_49e18f3ad69746f783e5c764604acaaf/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_4c11d04c566844ab971b5c487f042246/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_4c11d04c566844ab971b5c487f042246/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_4c669d05bd904d0e8bae38146069fafb/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_4c669d05bd904d0e8bae38146069fafb/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_88808b0a9f9a457fa02e15569634b443/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_88808b0a9f9a457fa02e15569634b443/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_9c764484a55d4e17a3e49efad26761f5/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_9c764484a55d4e17a3e49efad26761f5/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| native-fixtures/full/case_e56943decf8b4ed5952c629292093d6e/child.stderr.log | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a | 23 / 12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a |
| native-fixtures/full/case_e56943decf8b4ed5952c629292093d6e/child.stdout.log | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 | 215 / a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19 |
| negative-controls/challenge-binding/control.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| negative-controls/challenge-binding/control.stdout.log | 1912 / 1a86e9bf66c1f0470849e7f981ce809ad9146f0484301e389a5ad89693e989bb | 1912 / 1a86e9bf66c1f0470849e7f981ce809ad9146f0484301e389a5ad89693e989bb |
| negative-controls/private-byte-copy/control.stderr.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| negative-controls/private-byte-copy/control.stdout.log | 2123 / 3e34b5214aaf07fc9aae59923ba3c5e71ca1453a9b5f0ce29b73f2baee79874e | 2123 / 3e34b5214aaf07fc9aae59923ba3c5e71ca1453a9b5f0ce29b73f2baee79874e |
| verifier-initial-recorded.stderr.log | 914 / dd0773b7958e7b6b06c66e0c63162184e167860c9c5cffeabcae9b3397822031 | 914 / dd0773b7958e7b6b06c66e0c63162184e167860c9c5cffeabcae9b3397822031 |
| verifier-initial-recorded.stdout.log | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | 0 / e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |

## 未验证边界与停止点

同 SID/管理员/内核和受信任代码改写不在防御范围；Promise 构造器/原型旧边界保留。文件 ACL/身份阶段核对并非覆盖检查至使用间所有竞态，也不覆盖句柄释放之后、崩溃/断电和全场景 POSIX 等价；不改变原生接收器边界。旧 Node 兼容性未新增实际运行。

本轮没有验证真实 Windows 人机审批或真实凭据输入、真实网络/TLS、实机 CLI、设备身份、当前人数和目标人脸入库状态。实际 CLI 保持锁定；9 人及目标 `F03FF8DA7299CE148` 的实机复验仍为 NOT_EXECUTED。不开启派发、不作 E1/E2 放行。保留全部旧证据及本轮新对象，完成提交与远端 SHA 核验后停手，交另一个独立 Codex 复审。
