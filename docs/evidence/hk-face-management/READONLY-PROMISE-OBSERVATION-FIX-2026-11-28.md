# 本机启动层 Promise 拒绝观察 P2：最小修复与合成回归

本次为实施补证，交另一个独立 Codex 复审；不自行宣布 P2 验收关闭。固定直接父提交为 `987bc6d3d2971ecd639a732fbbbe8126e364c1b5`，独立分支 `fix/hk-face-readonly-promise-observe-2026-11-28`。旧工作树未切换或清理，全部旧报告、日志、对象及新旧残留引用保留。

## 环境与真实时间

本机 Windows NT 10.0、build 22631.6199、DisplayVersion 23H2；注册表 ProductName 原文为 Windows 10 Home China（保留注册表标签，不据此改写 build）。Node v24.16.0，Windows PowerShell 5.1.22621.6133，执行工具宿主 PowerShell 7.6.9。环境记录时间 2026-11-28T21:39:09+08:00（Asia/Shanghai）。初次只读 CIM 查询返回 ACCESS_DENIED，改读同机 Windows 版本注册表及 System.Environment；未提权或安装工具。原记录 windows=null 与补充版本记录均保留。

聚焦运行 2026-11-28T21:41:45+08:00 至 2026-11-28T21:41:51+08:00；完整回归 2026-11-28T21:42:02+08:00 至 2026-11-28T21:44:04+08:00。控制实验原元数据使用 UTC Z，换算 Asia/Shanghai 为 2026-11-28 21:43:25—21:43:28；未回填旧时间。

证据根为本机独立目录 `D:/chatgpt/smart/FACE-READONLY-PROMISE-FIX-20261128T213909-fb3e242d`，下文工件名均相对该根。原件留本地受控目录；非云端附件，不伪造附件 ID。

## 修复范围与拒绝边界

仅修改既有 `admin-web/lib/face-readonly-local-bootstrap.mjs`，新增 `admin-web/tests/face-readonly-promise-observation.test.mjs`、`admin-web/tests/fixtures/face-readonly-promise-observation-child.mjs` 和本报告，共四个 Git 路径。其余现有源码、旧测试、生产 CLI、依赖、配置、旧文档均未改。

原实现先拒绝原生 Promise 的 own then／访问器形状，再挂拒绝处理器。因此端口直接返回已经拒绝、或稍后拒绝的同域原生 Promise，只要增加一个 own then，就可能绕过观察而触发 Node 默认未处理拒绝。

本次把“可安全调用原生 then”与“允许返回的形状”拆开：确认原型仍为 Promise.prototype 且没有 own constructor 后，若存在 own then 或任意访问器，先通过模块已捕获的 Promise.prototype.then 注册两个无操作处理器，再抛固定故障。两个处理器均返回 undefined，派生 Promise 不会再次同化原 fulfillment 值。覆盖的 then 函数、then getter 或其他 getter 均不读取／调用；非法形状仍被拒绝，不转换为可批准票据或有效输入。正常形状仍走原 accept/fail。

**未扩大覆盖域：** own constructor 或原型改变仍在调用原生 then 前拒绝。原生 then 本身会查询 constructor/species，不能为消费拒绝而调用未知覆盖属性。本次没有证明这类不安全构造器／异原型 rejected Promise 的拒绝已被安全观察；它们仍可能触发未处理拒绝。对应构造器 getter 回归刻意使用已经 fulfilled 的 Promise，只证明拒绝且 getter 为零。进程内全局原型／内建函数被可信代码篡改、跨域／任意 Promise 形状及任意后台任务也不属于本次 P2 证据范围；不把此修复宣称为任意 JavaScript 沙盒或通用 Promise 隔离。

单次上下文、同份私有快照、同域审批、首错优先、取消监听、有限期限、精确请求白名单、pin-before-send、无删除与假证据契约均未放宽。实际 CLI 仍由原入口调用 main({signal})，未安装 runner，继续 LIVE_EXECUTION_LOCKED；不增加 argv/env 解锁口。

## 正式回归

聚焦实际命令：

```text
node --test --test-reporter=tap admin-web/tests/face-readonly-promise-observation.test.mjs
```

退出码 0，实际 20/20；fail/cancelled/skipped/todo 均为 0。完整组保留原 1122 项的全部 argv（仅向 admin 组追加新测试路径）及 TAP 标题多重集，实测 1122＋20＝1142 项全部通过；suite 数不计入测试数。

| 运行 | tests | pass | 退出码 | 判定 |
|---|---|---|---|---|
| admin-final | 802 | 802 | 0 | 符合预期 |
| tenant-final | 6 | 6 | 0 | 符合预期 |
| root-final | 297 | 297 | 0 | 符合预期 |
| worker-final | 35 | 35 | 0 | 符合预期 |
| worker-guard-selfcheck-final | 2 | 2 | 0 | 符合预期 |
| check-miniprogram-final | N/A | N/A | 0 | 符合预期 |
| checkin-face-static-final | N/A | N/A | 0 | 符合预期 |
| verify-face-sources-final | N/A | N/A | 0 | 符合预期 |
| verify-import-final | N/A | N/A | 1 | 保留既有失败，不属于通过测试计数 |

所有测试子进程正常结束，无超时、信号退出或 skip 代通过。三个静态检查退出 0。verify-import 仍退出 1，保留 cloudfunctions/login/config.json 的导入来源基线不符：实际 aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6，期望 ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8；未读取内容、修改来源或计作通过。

完整实际命令（可核对 full/summary.json 的逐参数数组与原始退出码）：

admin-final（退出码 0）：

```text
node --test --test-reporter=tap admin-web/tests/auto-fill.test.mjs admin-web/tests/checkin-face-config.test.mjs admin-web/tests/checkin-face-worker.test.mjs admin-web/tests/face-access-plan.test.mjs admin-web/tests/face-enroll-cli.test.mjs admin-web/tests/face-enroll-powershell.test.mjs admin-web/tests/face-enrollment-command.test.mjs admin-web/tests/face-enrollment.test.mjs admin-web/tests/face-management-ui.test.mjs admin-web/tests/face-management.test.mjs admin-web/tests/face-readonly-host.test.mjs admin-web/tests/face-readonly-policy.test.mjs admin-web/tests/face-server.test.mjs admin-web/tests/face-ui.test.mjs admin-web/tests/hikvision-client.test.mjs admin-web/tests/layout-batches.test.mjs admin-web/tests/local-cloud-database.test.mjs admin-web/tests/property.test.mjs admin-web/tests/qishanyuan-test-data.test.mjs admin-web/tests/sdk-database-adapter.test.mjs admin-web/tests/server.test.mjs admin-web/tests/static-path.test.mjs admin-web/tests/tenant-password-accounts.test.mjs admin-web/tests/vr.test.mjs admin-web/tests/face-readonly-cli.test.mjs admin-web/tests/face-readonly-session.test.mjs admin-web/tests/face-readonly-local-bootstrap.test.mjs admin-web/tests/face-readonly-promise-observation.test.mjs
```

tenant-final（退出码 0）：

```text
node --require ./tests/support/d-network-guard.cjs --test --test-reporter=tap admin-web/tests/tenant-password-routes.test.mjs
```

root-final（退出码 0）：

```text
node --require ./tests/support/d-network-guard.cjs --test --test-reporter=tap tests/account-login-api.test.cjs tests/account-login-cloud.test.cjs tests/account-login-pages.test.cjs tests/action-login-checkin-pages.test.cjs tests/action-login-gate.test.cjs tests/action-login-private-pages.test.cjs tests/action-login-public-pages.test.cjs tests/checkin-face-api.test.cjs tests/checkin-face-cloud-workflow.test.cjs tests/checkin-face-cross-module.test.cjs tests/checkin-face-pages.test.cjs tests/checkin-face-qa-gates.test.cjs tests/cloud-bootstrap.test.cjs tests/frontend.test.cjs tests/identity.test.cjs tests/layout.test.cjs tests/phone-login.test.cjs tests/public-houses.test.cjs tests/qishanyuan-pages.test.cjs tests/qishanyuan-test-preset.test.cjs tests/tenant-password-gates.test.cjs tests/wechat-modules.test.cjs tests/wxml.test.cjs
```

worker-final（退出码 0）：

```text
node --require ./tools/checkin-face-worker/tests/network-guard.cjs --test --test-reporter=tap tools/checkin-face-worker/tests/rework-r05-r06.test.mjs tools/checkin-face-worker/tests/rework-r08-r09.test.mjs tools/checkin-face-worker/tests/sdk-resolution.test.mjs
```

worker-guard-selfcheck-final（退出码 0）：

```text
node --require ./tools/checkin-face-worker/tests/network-guard.cjs --test --test-reporter=tap tools/checkin-face-worker/tests/network-guard-selfcheck.test.mjs
```

check-miniprogram-final（退出码 0）：

```text
node scripts/check-miniprogram.mjs
```

checkin-face-static-final（退出码 0）：

```text
node scripts/checkin-face-static-check.mjs
```

verify-face-sources-final（退出码 0）：

```text
node scripts/verify-checkin-face-sources.mjs
```

verify-import-final（退出码 1）：

```text
node scripts/verify-import.mjs
```


### 新增 20 项的实际覆盖

- source、approval、evidence open/write/seal/close 六个端口，分别覆盖 own then 数据属性的即时敏感拒绝、own then getter 的最终结果返回后敏感拒绝，共 12 项。
- own then 函数和其他访问器补充 4 项；成功值已 fulfilled 后再安装 then getter 的两项，证明观察器不二次同化。
- 普通原生 Promise 正控 1 项：8 次端口 Promise 返回贯穿真实 SDK/Host/Policy/main 与底层假 TLS/HTTPS，36 个假 HTTP，最终 0、假证据 COMPLETE。
- 不安全 constructor getter 的 fulfilled 拒绝边界 1 项；不声称覆盖其 rejected 情况。

每项都由独立网络守卫 preload 的子进程实际执行，只传最小系统环境，没有 NODE_OPTIONS、宽松 --unhandled-rejections 标志或 unhandledRejection/uncaughtException 监听。敏感 reason 为合成标记，不是真实凭据。负例核对进程与结果均固定退出 5，stdout 单行安全协议，stderr 只有固定类别，IPC/stdio 无敏感标记或堆栈；覆盖属性调用为 0。晚拒绝在编排器最终返回后才释放，再等待两个事件循环 turn；上下文重放返回 LOCAL_CONTEXT_USED，读取／审批和 HTTP 增量为 0。

source/approval/open 失败时 TLS/HTTPS/HTTP 均为 0；write/seal/close 在先前只读查询已完成后故障，保留此前 36 个假 HTTP，不虚称整个尝试零 HTTP，结算后及重放均无后续 HTTP。假证据按真实阶段保持 NOT_OPENED 或 INCOMPLETE，mainExitCode=0 的收尾失败不改记最终成功。网络守卫 attempts=0。

## 负控与关键子进程原件

仅在新建 artifact-copy 副本退化一个模块，未修改受测原文件。

| 控制运行 | tests | pass | fail | 退出码 |
|---|---|---|---|---|
| negative-old-source | 1 | 0 | 1 | 1 |
| negative-old-raw-child | N/A | N/A | N/A | 1 |
| negative-identity | 1 | 0 | 1 | 1 |
| immediate | N/A | N/A | N/A | 5 |
| late | N/A | N/A | N/A | 5 |
| close-late | N/A | N/A | N/A | 5 |
| no-assimilation | N/A | N/A | N/A | 5 |
| ordinary | N/A | N/A | N/A | 0 |

1. old-source：把新测试依赖图副本中的模块替换为固定父提交原字节，选择 source 即时敏感拒绝新测试。1 项故意失败、退出 1；另外直接运行旧副本 child，stdout 为空、退出 1、原始 stderr 含合成 reason 与堆栈、未到达受控 IPC 报告。后者为真实旧缺陷复现，不把崩溃记为受控拒绝。
2. identity-fulfillment：仅把双 no-op 改成默认 identity fulfillment＋rejection no-op；成功值含后安装 then getter 的新测试故意失败、退出 1，证明两个 no-op 都必要。

copy-manifest 保存每份副本来源、大小、SHA-256及唯一变更文件；其他副本文件和所有受测原件保持字节不变。负控故意失败与正式通过分开。负控原始日志中的 marker 是刻意合成文本；保留原件不隐藏失败。

controls/fixed-direct 额外保存 immediate、late、close-late、no-assimilation 和 ordinary 五个关键子进程的真实 stdout/stderr、立即保存的 exit.txt、IPC JSON 与 result.json。前四项退出 5，正控退出 0；它们是正式 20 项之外的补充过程证据，不重复加到 1142 测试计数。旧 raw child 在默认拒绝下提前退出，无受控报告，不据此虚构动态守卫计数。

## 源码字节与旧证据

固定父提交的 31 个选定源码先与既有最终 full-r2/source-before.json 核对一致，再保存 pre-edit-source 原字节。测试时共 33 个选定文件，聚焦与完整回归的 before/after、源码副本与当前文件哈希一致。原 31 文件仅本模块发生预期修改，其余 30 个原字节不变；新增 2 个测试源码。下表最后一列同时为聚焦及完整运行前／后值；NEW 表示父提交不存在。

| 源码 | 固定父提交／修改前 SHA-256 | 测试前后 SHA-256 |
|---|---|---|
| `admin-web/lib/hikvision-client.mjs` | `d79ef3ba00914d4bc551ab363315f6fdb183da44088577fe14c1902786e76001` | `d79ef3ba00914d4bc551ab363315f6fdb183da44088577fe14c1902786e76001` |
| `admin-web/lib/face-enrollment.mjs` | `789e1fa39a7a01cce1d363f16f0ec4eb3107c3833f9063136b0d6a78acf128be` | `789e1fa39a7a01cce1d363f16f0ec4eb3107c3833f9063136b0d6a78acf128be` |
| `admin-web/server.mjs` | `0b4c999ee71b151efc85b6d14777d093350e034caa63c7eed017cb448878a763` | `0b4c999ee71b151efc85b6d14777d093350e034caa63c7eed017cb448878a763` |
| `admin-web/public/face-ui.js` | `43d954d22fe3ad5498764e1991b9574d04e1521542a9cdb346041c8ae1ae31fd` | `43d954d22fe3ad5498764e1991b9574d04e1521542a9cdb346041c8ae1ae31fd` |
| `admin-web/public/style.css` | `0ecea30847c15a225a62292391a31b5292963c72b2b47799fa97a540779d2a3d` | `0ecea30847c15a225a62292391a31b5292963c72b2b47799fa97a540779d2a3d` |
| `admin-web/tests/face-management.test.mjs` | `bf38ee5bd1ebffff67b892f7e15e63a28594c59a46dcbe6e56549a1dd979f286` | `bf38ee5bd1ebffff67b892f7e15e63a28594c59a46dcbe6e56549a1dd979f286` |
| `admin-web/tests/face-management-ui.test.mjs` | `a813242ab62aa7298ba6bc29fee87b42a626bf820bdcd2c95aa7e255d276e3af` | `a813242ab62aa7298ba6bc29fee87b42a626bf820bdcd2c95aa7e255d276e3af` |
| `admin-web/tests/face-server.test.mjs` | `94b3a329e913f92425f0ee23a13704b567bd591f8e72113e5556ae65d751a224` | `94b3a329e913f92425f0ee23a13704b567bd591f8e72113e5556ae65d751a224` |
| `docs/checkin-face-experience-source-hashes.json` | `d01eb1ff12c4a921dd420047d52a215a19d16ec04a4814a2f27e8c665b5dde7c` | `d01eb1ff12c4a921dd420047d52a215a19d16ec04a4814a2f27e8c665b5dde7c` |
| `admin-web/lib/face-access-plan.mjs` | `f3962e72a15c55512aea5b7a87d0465d37b1142218a82138c01635c41656c9f1` | `f3962e72a15c55512aea5b7a87d0465d37b1142218a82138c01635c41656c9f1` |
| `admin-web/lib/face-readonly-host.mjs` | `4a9365370607cc246c600351a0dd4e9c293728fbbcd035f587b356bc0976f20d` | `4a9365370607cc246c600351a0dd4e9c293728fbbcd035f587b356bc0976f20d` |
| `admin-web/lib/face-readonly-policy.mjs` | `e24a109d1948bbe6b289eb27b1f03b111deb37639f207c895ae6cc9aa23e4086` | `e24a109d1948bbe6b289eb27b1f03b111deb37639f207c895ae6cc9aa23e4086` |
| `admin-web/tests/face-readonly-host.test.mjs` | `d3cbd900cbd03c8e469bbff636a5e48aeaf171449f576e75e5acfb0cb1e6f112` | `d3cbd900cbd03c8e469bbff636a5e48aeaf171449f576e75e5acfb0cb1e6f112` |
| `admin-web/tests/face-readonly-policy.test.mjs` | `89dd1e481065849b6afd5fff6d08938a06f26542f2ad2a13f83813a5ebc72277` | `89dd1e481065849b6afd5fff6d08938a06f26542f2ad2a13f83813a5ebc72277` |
| `admin-web/tests/fixtures/face-readonly-fake-transport.mjs` | `2c6c55ed2ee7e7b4abb43e08b407f1b777e3f77e8253bee5b439f25aee27451a` | `2c6c55ed2ee7e7b4abb43e08b407f1b777e3f77e8253bee5b439f25aee27451a` |
| `admin-web/face-readonly.mjs` | `a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d` | `a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d` |
| `admin-web/lib/face-readonly-command.mjs` | `0217c79857b055f8485ec0631c2ab03b48e03d18e8d86f5b529d53f1fdb28e35` | `0217c79857b055f8485ec0631c2ab03b48e03d18e8d86f5b529d53f1fdb28e35` |
| `admin-web/tests/face-readonly-cli.test.mjs` | `42b3c01a0e219522ecb61733339fd2e5e3b0a65abedc1b8b5aab42f7dd953ca3` | `42b3c01a0e219522ecb61733339fd2e5e3b0a65abedc1b8b5aab42f7dd953ca3` |
| `admin-web/tests/fixtures/face-readonly-cli-child.mjs` | `ebf4f8e064cbc8bc9edb6005269afffd13878b975ab902359c1ec1345d63b600` | `ebf4f8e064cbc8bc9edb6005269afffd13878b975ab902359c1ec1345d63b600` |
| `admin-web/tests/fixtures/face-readonly-cli-network-guard.mjs` | `170fecbf6df460f11141b5f735737ccea1f58850b210bf77f43e8826d50dd6fc` | `170fecbf6df460f11141b5f735737ccea1f58850b210bf77f43e8826d50dd6fc` |
| `admin-web/tests/fixtures/face-readonly-cli-synthetic-adapter.mjs` | `9ee6d4d96cfb18c5f521265f339e390a89bd10368c88b13b9d83c1c3af1b42c2` | `9ee6d4d96cfb18c5f521265f339e390a89bd10368c88b13b9d83c1c3af1b42c2` |
| `admin-web/tests/fixtures/face-readonly-cli-synthetic-input.mjs` | `3d248af179c5cc6c1fdb8764cbde9a9b36bfdfba30d911dbe4a86d19831cdf03` | `3d248af179c5cc6c1fdb8764cbde9a9b36bfdfba30d911dbe4a86d19831cdf03` |
| `admin-web/lib/face-readonly-session.mjs` | `076e4b13629ff69290bdd31b00ae30575a35df18f61692ed36503e3d1417ad4d` | `076e4b13629ff69290bdd31b00ae30575a35df18f61692ed36503e3d1417ad4d` |
| `admin-web/tests/face-readonly-session.test.mjs` | `71adf8fcee97941f41fdb13441680196aa157a1af26a0a3de1ed308fccfa89ce` | `71adf8fcee97941f41fdb13441680196aa157a1af26a0a3de1ed308fccfa89ce` |
| `admin-web/tests/fixtures/face-readonly-session-child.mjs` | `dd353ec9cfcf76d83f7d528a063e40095a9f87a66be2813792a64f24fd07323e` | `dd353ec9cfcf76d83f7d528a063e40095a9f87a66be2813792a64f24fd07323e` |
| `admin-web/tests/fixtures/face-readonly-session-network-guard.mjs` | `f1073e115563fb420ca5c242e16d0eb544d9739ade2a545c31bbcdeb2c86085d` | `f1073e115563fb420ca5c242e16d0eb544d9739ade2a545c31bbcdeb2c86085d` |
| `admin-web/tests/fixtures/face-readonly-session-synthetic.mjs` | `74d4b2493de7b88cf4502415ff084325bf8f582e9f10440b42a3a89f7a9eca07` | `74d4b2493de7b88cf4502415ff084325bf8f582e9f10440b42a3a89f7a9eca07` |
| `admin-web/lib/face-readonly-local-bootstrap.mjs` | `47db5b7dbcbd3571ce8cd5eba714907dcb0347019b572aa5f2c3c4b9d5ed1963` | `18fb339670371ff5a25e608ce5133e998cb7af5a4f7409657e7883d9713f49b8` |
| `admin-web/tests/face-readonly-local-bootstrap.test.mjs` | `937dfe5f322db0920b04d538bcf880b188d41125bc115e5ed349d19ad51e2d57` | `937dfe5f322db0920b04d538bcf880b188d41125bc115e5ed349d19ad51e2d57` |
| `admin-web/tests/fixtures/face-readonly-local-bootstrap-child.mjs` | `1878e07aefb5eac0633b02b52126b3bcb392df7b87f5708be970c580779e2bf1` | `1878e07aefb5eac0633b02b52126b3bcb392df7b87f5708be970c580779e2bf1` |
| `admin-web/tests/fixtures/face-readonly-local-bootstrap-synthetic.mjs` | `8b844c4c3a432af44560449316e6fdc0d43736d38323ff591423a494fc2da0fd` | `8b844c4c3a432af44560449316e6fdc0d43736d38323ff591423a494fc2da0fd` |
| `admin-web/tests/face-readonly-promise-observation.test.mjs` | `NEW` | `98377256f578e7855aaccec335ee4f1a0739a3231bbfccdfcf4d10fc482da5fa` |
| `admin-web/tests/fixtures/face-readonly-promise-observation-child.mjs` | `NEW` | `26d862896338c5e86dd2959b882e39b72226b1b5ff97026940466e77b0651c59` |

原 100 项 bootstrap 测试文件未改。旧文档四份受保护哈希见 regression-verification.json；Git 索引与最终提交还需逐 blob 对照受测字节，真实结果另存 git-delivery，不用仅工作树哈希代替。

首轮 1117 为原 R1 已通过记录，保留其后 readonly/list 静审发现及 R2 1122 证据，不把先前通过误写成首次失败。首次 CLI 33/34 的失败、verify-import 基线失败和其他历史限制均保留；不重写旧记录。以下仅本次只读读取并计算引用文件哈希，未重跑旧记录：

| 旧证据相对根／工件 | 字节数 | SHA-256 |
|---|---|---|
| `FACE-READONLY-LOCAL-BOOTSTRAP-20261128T182110-f33fd780/full/summary.json` | 6987 | `5dcf493e212fb95214b6ffe8070be2148fc36f6df44f71e9ae4c9f327797fea0` |
| `FACE-READONLY-LOCAL-BOOTSTRAP-20261128T182110-f33fd780/full-r2/summary.json` | 6990 | `179ebfb79cd6b009dba3d5a086fd5fb2bc6a75677c4401badfb04869a1d03a84` |
| `FACE-READONLY-LOCAL-BOOTSTRAP-20261128T182110-f33fd780/log-manifest-full-r2.json` | 18462 | `8c0d66f36b0cb81a419389ab0d40d2100876c2a7032efe62187de7d4458b2259` |
| `FACE-READONLY-LOCAL-BOOTSTRAP-20261128T182110-f33fd780/artifact-manifest-full-r2.json` | 2781 | `a325784fe52c224e6e52b3ed5bbce1098db9c30f520d494ef5b2ea5f9a6a7f3b` |
| `FACE-READONLY-LOCAL-BOOTSTRAP-20261128T182110-f33fd780/git-delivery/result.json` | 1129 | `9f0294f88cdfbdd84402e7b7cfffd474024ca1f7baf5f07d60f923475d8ef558` |
| `FACE-READONLY-LOCAL-BOOTSTRAP-20261128T182110-f33fd780/history-r1/manifest.json` | 645 | `abc653ca96bc014797761f5b48a61139afb687421cb62d4c703249e865369c6a` |
| `FACE-READONLY-CLI-OFFLINE-20261128T042047-600ed848/focused/cli-focused.stdout.log` | 10172 | `a0a9772a1c4783257033f9cc805516a74e423fd7cea08440e71fdbf5a0bbb764` |
| `FACE-READONLY-CLI-OFFLINE-20261128T042047-600ed848/focused/cli-focused.exit.txt` | 2 | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |

## stdout/stderr 与核心工件定位

原 stdout/stderr 使用独立文件描述符捕获，进程 close 后立即保存真实退出码，再解析 TAP 或 JSON；stdout/stderr 不合并。每个运行的相邻 exit.txt 和 result.json／summary.json 保存该次退出码与真实启动参数。原日志留本机受控目录，脱敏副本替换个人 profile 前缀与 SID；表中 raw 与 redacted 分别计算大小和 SHA-256。

| 原件 | bytes | SHA-256 | 脱敏副本 | bytes | SHA-256 |
|---|---|---|---|---|---|
| `controls/fixed-direct/close-late.stderr.log` | 23 | `12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a` | `controls/fixed-direct/close-late.stderr.redacted.log` | 23 | `12be67e5d4b877b5bf4522d238ed5cbfacb49f62e52f37183e34675a23993c0a` |
| `controls/fixed-direct/close-late.stdout.log` | 215 | `a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19` | `controls/fixed-direct/close-late.stdout.redacted.log` | 215 | `a87e95f48e3ef9ccd3a1412041e9918c0d55c10e37961a4819f7b4a766f81c19` |
| `controls/fixed-direct/immediate.stderr.log` | 14 | `d9004177df15995c8078e0abcc3ae6631b1e59678ddef45409e0e32cc075bcce` | `controls/fixed-direct/immediate.stderr.redacted.log` | 14 | `d9004177df15995c8078e0abcc3ae6631b1e59678ddef45409e0e32cc075bcce` |
| `controls/fixed-direct/immediate.stdout.log` | 206 | `3a124474073eada215a3bdb13943bfe094c02005f975f4c07edce35afda2cf4a` | `controls/fixed-direct/immediate.stdout.redacted.log` | 206 | `3a124474073eada215a3bdb13943bfe094c02005f975f4c07edce35afda2cf4a` |
| `controls/fixed-direct/late.stderr.log` | 14 | `d9004177df15995c8078e0abcc3ae6631b1e59678ddef45409e0e32cc075bcce` | `controls/fixed-direct/late.stderr.redacted.log` | 14 | `d9004177df15995c8078e0abcc3ae6631b1e59678ddef45409e0e32cc075bcce` |
| `controls/fixed-direct/late.stdout.log` | 206 | `3a124474073eada215a3bdb13943bfe094c02005f975f4c07edce35afda2cf4a` | `controls/fixed-direct/late.stdout.redacted.log` | 206 | `3a124474073eada215a3bdb13943bfe094c02005f975f4c07edce35afda2cf4a` |
| `controls/fixed-direct/no-assimilation.stderr.log` | 14 | `d9004177df15995c8078e0abcc3ae6631b1e59678ddef45409e0e32cc075bcce` | `controls/fixed-direct/no-assimilation.stderr.redacted.log` | 14 | `d9004177df15995c8078e0abcc3ae6631b1e59678ddef45409e0e32cc075bcce` |
| `controls/fixed-direct/no-assimilation.stdout.log` | 206 | `3a124474073eada215a3bdb13943bfe094c02005f975f4c07edce35afda2cf4a` | `controls/fixed-direct/no-assimilation.stdout.redacted.log` | 206 | `3a124474073eada215a3bdb13943bfe094c02005f975f4c07edce35afda2cf4a` |
| `controls/fixed-direct/ordinary.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `controls/fixed-direct/ordinary.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `controls/fixed-direct/ordinary.stdout.log` | 5016 | `883a984e4e6db502e8add0dfe10f6c499ceba1e5ca7c31c8391a2e9706b0a8a5` | `controls/fixed-direct/ordinary.stdout.redacted.log` | 5016 | `883a984e4e6db502e8add0dfe10f6c499ceba1e5ca7c31c8391a2e9706b0a8a5` |
| `controls/identity-fulfillment/negative-identity.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `controls/identity-fulfillment/negative-identity.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `controls/identity-fulfillment/negative-identity.stdout.log` | 2028 | `372b1c39cbdc5c31fbcfabe5888e56d197bbce824b87ac3854f5fb0b06b5935d` | `controls/identity-fulfillment/negative-identity.stdout.redacted.log` | 2028 | `372b1c39cbdc5c31fbcfabe5888e56d197bbce824b87ac3854f5fb0b06b5935d` |
| `controls/old-source/negative-old-raw-child.stderr.log` | 1980 | `fda7bbf9823b6e4bd02c94d68403a077bb959304461e7b5bb5250a907f037a99` | `controls/old-source/negative-old-raw-child.stderr.redacted.log` | 1980 | `fda7bbf9823b6e4bd02c94d68403a077bb959304461e7b5bb5250a907f037a99` |
| `controls/old-source/negative-old-raw-child.stdout.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `controls/old-source/negative-old-raw-child.stdout.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `controls/old-source/negative-old-source.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `controls/old-source/negative-old-source.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `controls/old-source/negative-old-source.stdout.log` | 1963 | `19cd5e76b19b5912dcabc4b37da329e46a9737ad7f17b10297eb1818d29e0853` | `controls/old-source/negative-old-source.stdout.redacted.log` | 1963 | `19cd5e76b19b5912dcabc4b37da329e46a9737ad7f17b10297eb1818d29e0853` |
| `focused/promise-focused.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `focused/promise-focused.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `focused/promise-focused.stdout.log` | 5585 | `a450d0c2defa6efa9e70d4a9e61ae4df0551d0f7a5d2c753b4cc7c1b344b499a` | `focused/promise-focused.stdout.redacted.log` | 5585 | `a450d0c2defa6efa9e70d4a9e61ae4df0551d0f7a5d2c753b4cc7c1b344b499a` |
| `full/admin-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `full/admin-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `full/admin-final.stdout.log` | 187056 | `9121b6b735fc1ebfb8004f0b1af53ac4fa246bbd552255c2ba9d88fb94fb9681` | `full/admin-final.stdout.redacted.log` | 187056 | `9121b6b735fc1ebfb8004f0b1af53ac4fa246bbd552255c2ba9d88fb94fb9681` |
| `full/check-miniprogram-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `full/check-miniprogram-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `full/check-miniprogram-final.stdout.log` | 185 | `89535f0f900b0398830261e5ff0bddccdc309c859b94c34154d63f5a3994a2e0` | `full/check-miniprogram-final.stdout.redacted.log` | 185 | `89535f0f900b0398830261e5ff0bddccdc309c859b94c34154d63f5a3994a2e0` |
| `full/checkin-face-static-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `full/checkin-face-static-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `full/checkin-face-static-final.stdout.log` | 73 | `d3acf855ec25633177b8dfd2e04b93d122d66e0cdd7dc17fadde902208d790ad` | `full/checkin-face-static-final.stdout.redacted.log` | 73 | `d3acf855ec25633177b8dfd2e04b93d122d66e0cdd7dc17fadde902208d790ad` |
| `full/root-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `full/root-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `full/root-final.stdout.log` | 98375 | `6a5e2448ce14e924e8b6e84afdc01be9b711a91c804e11ce434ae4105c863467` | `full/root-final.stdout.redacted.log` | 98375 | `6a5e2448ce14e924e8b6e84afdc01be9b711a91c804e11ce434ae4105c863467` |
| `full/tenant-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `full/tenant-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `full/tenant-final.stdout.log` | 1452 | `7cfb09f492e8768c46a05a1717c8ed957810a3b6e5c139f0bae0e72f4b76d932` | `full/tenant-final.stdout.redacted.log` | 1452 | `7cfb09f492e8768c46a05a1717c8ed957810a3b6e5c139f0bae0e72f4b76d932` |
| `full/verify-face-sources-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `full/verify-face-sources-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `full/verify-face-sources-final.stdout.log` | 28289 | `8f870ecadb3604229733cc8d592e52c7aab89429f86327a888decc6b1b8ac5d3` | `full/verify-face-sources-final.stdout.redacted.log` | 28289 | `8f870ecadb3604229733cc8d592e52c7aab89429f86327a888decc6b1b8ac5d3` |
| `full/verify-import-final.stderr.log` | 945 | `54e8dc64287ec87b04b3ada4d8ab01e5c7b62f51ea9004de3ca87720df50b8ea` | `full/verify-import-final.stderr.redacted.log` | 945 | `54e8dc64287ec87b04b3ada4d8ab01e5c7b62f51ea9004de3ca87720df50b8ea` |
| `full/verify-import-final.stdout.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `full/verify-import-final.stdout.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `full/worker-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `full/worker-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `full/worker-final.stdout.log` | 17407 | `b1a097eb651b877638211f4de705aa003f12a4c50d482a1931134c8ee097b796` | `full/worker-final.stdout.redacted.log` | 17407 | `b1a097eb651b877638211f4de705aa003f12a4c50d482a1931134c8ee097b796` |
| `full/worker-guard-selfcheck-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `full/worker-guard-selfcheck-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `full/worker-guard-selfcheck-final.stdout.log` | 501 | `d7bd830c6eaf02fd202c2382db1da2dd1033d1bd45b7ed888669de2895db255d` | `full/worker-guard-selfcheck-final.stdout.redacted.log` | 501 | `d7bd830c6eaf02fd202c2382db1da2dd1033d1bd45b7ed888669de2895db255d` |

核心清单 artifact-manifest.json 不含自引用；所有 SHA 均由实读字节计算：

| 工件 | bytes | SHA-256 |
|---|---|---|
| `environment.json` | 590 | `7f89d4fa3389b48a4cbe6704ea903c281b50a5e32916ca689492ada7112d390e` |
| `environment.redacted.json` | 588 | `79f383b732b8a4f784e79c876aec474536ed6d0a7417b3791db6852c8e7a1267` |
| `environment-windows.json` | 346 | `e9677e82d666edf6c56d238efb967c965919c8db5d55e74983e048ab3c126099` |
| `source-pre-edit.json` | 5286 | `143e4a1a12b01fae2a8d50088a0da945f600d91110b6ecf9a099a42ad3872b44` |
| `focused/summary.json` | 631 | `3cad86fa1a754c86bcbf8823326f569406cbe3748b447d05ecb0222fa342e9ed` |
| `focused/source-before.json` | 4095 | `de66d32954f180147159b73a4ce2f5569afd12f02bc12524d109b9bd5b4c8a97` |
| `focused/source-after.json` | 4116 | `ff62a922fc41f82d5ec28066f756b1772183ebd91bc9a44478b0a9568793f574` |
| `full/summary.json` | 7282 | `65df4446a94d6ddbcf64cbb29fe1522265f7c81f900360c51a096af4ec9be1ef` |
| `full/source-before.json` | 4095 | `cf7bb52dd639332e6baae8cb9642266f6bbc6b539c3dc2fc397747ac75938179` |
| `full/source-after.json` | 4116 | `1265560226b0ce4cd158b75aa72dd7903c680dc0cae746b98222a32594f3340d` |
| `controls/summary.json` | 5685 | `1b7142767882c4a3ec88fef33c62d2ac33b04984746ac9429f04de27ffa71e46` |
| `controls/old-source/copy-manifest.json` | 3701 | `20dc77ea5b0dc5a254bec531acea9285a0fb9b0f82be9653e56c16075a76eae7` |
| `controls/identity-fulfillment/copy-manifest.json` | 3701 | `800ae584ebbf470d6e406f0d1dc130ecd42c90d97908c1807a329576a7fc2117` |
| `regression-verification.json` | 3891 | `dc87aab49200a28f0c950a54f8b2c5d809d577f580dbeeadb09e234c966ea901` |
| `log-manifest.json` | 13250 | `44c006d45301c1998ff0c98e1918ced53b897168c882f4ac4d210a8b46212d95` |

本机可实际读取上述证据根；跨机器复审可取最终生成的 review-bundle-<提交前12位>.zip，其中含脱敏日志、源码副本、负控副本、清单与真实 Git 交付证明，原始日志留本地；ZIP 文件名、字节数、SHA 和逐项校验由 review-bundle-result.json 给出。它不是上传附件；不把本机路径声称云端可读。原始 environment.json 含宿主程序路径，打包使用 environment.redacted.json。

## 交付核验及停止点

本次只允许上述四路径：执行 git diff --check，追加提交后 git show --check；逐 blob 比较受测源码／报告与索引、最终提交，并核对直接父提交。普通显式推送目标为 HEAD:refs/heads/fix/hk-face-readonly-promise-observe-2026-11-28，再用 git ls-remote 核对完整远端 SHA，最终树须干净。真实命令、stdout/stderr、退出码、完整提交及远端核验结果存 git-delivery/result.json；若未存在成功结果则不得认定交付完成。报告不虚构自身提交 SHA，也不通过 amend 回填。

所有运行只用合成输入、假传输和假证据接收器；旧基线保留其本机合成 loopback／PowerShell 验证，不把这些当真实设备请求。本次零设备连接，未读真实凭据或照片、未改路由、未登记或删除人员、未开门、未启动派发、未处理或清理任何旧对象、未运行 E1/E2。未修改全局／系统 Git、TLS、代理或安全配置，未安装升级依赖，未执行 amend/rebase/reset/squash/force/merge/cherry-pick 或推 main。

实际 CLI 仍锁定。真实身份／人工审批、真实证据落盘／Windows ACL／文件身份及 TOCTOU、真实 TLS／网络、现场 9 人和 F03FF8DA7299CE148 入库状态均未验收；本报告仅为实现与合成回归补证，不扩大为这些层通过，不作 E1/E2 或上线放行。提交推送核验后停手，交独立复审。
