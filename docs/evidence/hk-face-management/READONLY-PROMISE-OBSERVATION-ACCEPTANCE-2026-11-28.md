# 本机启动层 Promise 拒绝观察 P2 限定验收（2026-11-28）

验收对象：`53a435ac524fa77c693d762556c5ac21b6c047ff`，其直接父提交为 `987bc6d3d2971ecd639a732fbbbe8126e364c1b5`。本文从验收对象建立独立文档分支 `docs/hk-face-readonly-promise-acceptance-2026-11-28`，仅新增本文，固化已完成的独立只读复审结论。编写日期为 2026-11-28（Asia/Shanghai）；本次文档任务没有新增测试运行、源码修复或设备操作，也不替代对本文档提交的独立复审。

## 限定结论

原 P2 在可安全观察的同域原生 Promise 范围内限定关闭；原 1122 项加新增 20 项、共 1142 项合成回归及两项副本负控的证据验收通过，未发现新增阻断问题。

本次关闭仅针对：端口直接返回原型未变且没有自有 `constructor` 的原生 Promise，因自有 `then` 或其他访问器而被形状门禁拒绝时，先前未挂拒绝观察器，可能让敏感 reason 经 Node 默认未处理拒绝进入 stderr 并导致非受控退出的问题。该结论不覆盖任意 Promise 篡改、跨域对象或任意进程内 JavaScript。

复审确认：

- `face-readonly-local-bootstrap.mjs` 先区分安全观察条件与允许返回的形状。原型仍为 `Promise.prototype` 且没有自有 `constructor` 时，非法形状在被拒绝前通过模块已捕获的原生 `Promise.prototype.then` 注册两个 no-op；不读取或调用覆盖的 `then`、`then` getter 或其他访问器。
- 两个 no-op 均返回 `undefined`，避免派生 Promise 再次同化原 fulfillment 值。非法形状仍抛固定故障，不转成有效输入、审批票据或成功结果；正常 Promise 的原 `accept/fail` 路径保持。
- 自有 `constructor` 或改变原型仍在调用原生 `then` 前拒绝，以免原生 `then` 查询 `constructor/species` 时触发未知覆盖属性。**这类不安全构造器／异原型 rejected Promise 仍可能触发未处理拒绝，本次未证明其拒绝已被安全观察。** 构造器 getter 回归刻意使用已 fulfilled 的 Promise，只证明拒绝且 getter 调用为零。
- 单次上下文消费、同份私有快照、同域审批、首错保留、取消订阅、有限期限、精确白名单、pin-before-send 及假证据收尾门禁未放宽。实际 CLI 未安装 runner，仍为 `LIVE_EXECUTION_LOCKED`；没有增加 argv/env/JSON 解锁口。

覆盖属性零调用的结论限于上述已覆盖返回形状与合成场景；进程内全局原型／内建函数篡改、任意后台任务或不安全构造器的拒绝不能据此宣称已隔离。

## 既有正式运行证据

本次文档任务不重跑。以下结论来自[修复实施报告](READONLY-PROMISE-OBSERVATION-FIX-2026-11-28.md)、保留的原始 stdout/stderr、真实退出码、源码副本及独立只读复审。

原运行环境为本机 Windows build 22631.6199、DisplayVersion 23H2、Node v24.16.0、Windows PowerShell 5.1.22621.6133 和执行工具宿主 PowerShell 7.6.9。原注册表 ProductName 为 Windows 10 Home China；初次只读 CIM 查询 `ACCESS_DENIED` 与后续只读注册表版本补证均保留，未通过提权或安装工具绕过。

聚焦实际运行时间为 2026-11-28T21:41:45 至 21:41:51+08:00；完整回归为 21:42:02 至 21:44:04+08:00。这些是原运行时间，不是本文任务的新运行。

原聚焦命令为：

```text
node --test --test-reporter=tap admin-web/tests/face-readonly-promise-observation.test.mjs
```

原结果为 20/20、退出码 0。完整组的实际命令参数数组与日志见原 `full/summary.json` 及实施报告；相对既有 1122 项，仅向 admin 命令追加新测试路径，旧 argv 与 TAP 标题多重集保留。

| 分组 | 原基线 | 保存的通过结果 | 原始进程退出码 |
| --- | ---: | ---: | ---: |
| admin | 782 | 802/802 | 0 |
| tenant | 6 | 6/6 | 0 |
| root | 297 | 297/297 | 0 |
| worker | 35 | 35/35 | 0 |
| worker guard selfcheck | 2 | 2/2 | 0 |
| 合计 | 1122 | 1142/1142 | 各组均 0 |

正式测试 fail、cancelled、skipped、todo 均为 0，无超时或信号退出。聚焦 20 项是完整 1142 项的子集，不能重复加总；suite 也不计作 test。三项相关静态检查原结果为退出 0。

新增 20 项由六个端口（source、approval、evidence open/write/seal/close）的即时／最终返回后敏感拒绝 12 项、覆盖函数／其他访问器补充 4 项、防 fulfillment 二次同化 2 项、普通原生 Promise 正控 1 项和 fulfilled 构造器 getter 边界 1 项组成。

子进程使用独立网络守卫 preload 与底层假 TLS/HTTPS，只传最小系统环境；没有 `NODE_OPTIONS`、宽松拒绝策略标志或 `unhandledRejection/uncaughtException` 监听。已覆盖负例的进程及结果均受控退出 5，stdout 为安全协议、stderr 仅固定类别，IPC/stdio 不含合成敏感 reason 或堆栈；覆盖属性调用计数为 0。晚拒绝在编排器最终结果返回后才释放，再等待两个事件循环 turn；上下文重放被拒绝，后续读取、审批和 HTTP 增量均为 0。

source/approval/open 的预执行失败为零 TLS/HTTPS/HTTP。write/seal/close 发生在此前合成只读查询之后，保留已发送的 36 个**假** HTTP；只证明结算后及重放无新增 HTTP，不能写成全程零 HTTP。`close-late` 的 `mainExitCode=0`，但最终为 5、假证据为 `INCOMPLETE`，没有被候选成功改记。普通 Promise 正控的 8 次端口返回可完成，最终 0、假证据 `COMPLETE`；这只证明内存假接收器契约。

## 两项副本负控

负控只修改独立 `artifact-copy` 中的一个模块；各副本其余 18 份依赖／测试文件保持来源字节，受测原件未改。

| 负控 | 副本退化 | 原始 TAP | 退出码 |
| --- | --- | --- | ---: |
| `old-source` | 模块替换为固定父提交 `987bc6d3d2971ecd639a732fbbbe8126e364c1b5` 原字节 | 1 test / 0 pass / 1 fail | 1 |
| `identity-fulfillment` | 双 no-op 改为默认 identity fulfillment 加 rejection no-op | 1 test / 0 pass / 1 fail | 1 |

两项实际失败点都是 `safe()` 的合成敏感标记逃逸断言，证明新测试能检出原缺陷及不完整观察器；不得称失败点之后的数值或状态断言已经执行。故意失败不计入 1142 正式通过数，也不宣称所有门禁均完成负控。

另外，旧源码副本直接 child 的真实 stdout 为空、stderr 含合成 reason 与未处理拒绝堆栈、退出 1、未到达受控 IPC 报告。这是原问题的真实合成复现，不是受控退出；没有受控报告便不虚构该次动态守卫计数。

固定源码另保留 immediate、late、close-late、no-assimilation、ordinary 五份直接 child 过程证据，前四项受控退出 5，正控退出 0；覆盖属性调用 0、守卫 attempts=0、无结算后或重放新增 HTTP。它们是补充过程证据，不重复计入测试总数。全部 reason 均为刻意构造的合成标记，不是真实凭据。

## 源码、原始日志与提交字节

独立复审直接核对了聚焦及完整运行各 33 份选定源码的 before/after、当前字节和源码副本，哈希一致。相对父提交的原 31 份选件仅模块发生预期修改，其余 30 份原样；原 100 项 bootstrap 测试文件未改。实际索引及验收对象提交的 38 个 blob 与证据一致，另核对 34 个受保护父提交 blob；这些是修复提交的核对范围，不是本文任务新增测试。

| 固定文件／对象 | SHA-256 |
| --- | --- |
| 原模块（`987bc6d`） | `47db5b7dbcbd3571ce8cd5eba714907dcb0347019b572aa5f2c3c4b9d5ed1963` |
| 修复模块 `admin-web/lib/face-readonly-local-bootstrap.mjs` | `18fb339670371ff5a25e608ce5133e998cb7af5a4f7409657e7883d9713f49b8` |
| 新测试 `admin-web/tests/face-readonly-promise-observation.test.mjs` | `98377256f578e7855aaccec335ee4f1a0739a3231bbfccdfcf4d10fc482da5fa` |
| 新 child `admin-web/tests/fixtures/face-readonly-promise-observation-child.mjs` | `26d862896338c5e86dd2959b882e39b72226b1b5ff97026940466e77b0651c59` |
| 实际 CLI `admin-web/face-readonly.mjs` | `a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d` |
| 修复实施报告 | `e97d88396e5e400445bb1c16d01071cf3a911bf5b883689c625882290ce03efa` |

原证据根为 `D:/chatgpt/smart/FACE-READONLY-PROMISE-FIX-20261128T213909-fb3e242d`。关键工件相对定位：

- `focused/`、`full/` 的 stdout/stderr、相邻 `.exit.txt`、`summary.json`，以及 `source-before.json`、`source-after.json`、`source/`。
- `source-pre-edit.json`、`pre-edit-source/`、`regression-verification.json`，及两份 `controls/*/copy-manifest.json` 与 `artifact-copy/`。
- `controls/old-source/negative-old-source.*`、`negative-old-raw-child.*`，`controls/identity-fulfillment/negative-identity.*`；`controls/fixed-direct/` 中五个直接 child 的 stdout/stderr、退出码、IPC JSON 与结果。
- `log-manifest.json`、`artifact-manifest.json`、`git-delivery/`、`delivery-log-manifest.json` 和 `review-bundle-result.json`。

原件与脱敏副本分别保留，原始 stdout/stderr 分流保存，退出码先保存再解析。独立复审核对 36 组测试原始／脱敏日志及 15 个核心工件的大小和 SHA，并核对修复交付的 Git 原始／脱敏日志与真实 `ls-remote` 证明。该远端证明来自修复交付，不冒称本文已完成自身的新远端核验。

修复复审包为 `review-bundle-53a435ac524f.zip`，1,510,764 字节、618 个条目，SHA-256 为 `7694241cee660f7c3ee7696e0ba3c4b1a84a2b375c8afb5825f463b9e280b8f9`。独立复审已重算整包及各条目的 SHA/CRC；原始日志与原始 environment 文件留本地，包中提供脱敏材料。本机路径不是云端附件；异机复审须实际取件，不伪造附件 ID。

## 历史记录保留

原 `FACE-READONLY-LOCAL-BOOTSTRAP-20261128T182110-f33fd780` 中的首轮 1117 是已通过记录；其后静审发现 readonly/list 协议词碰撞，再形成 1122 项通过证据。不能把首轮通过改写成一次失败，也不能抹去其后发现的问题及修正过程。

更早 `FACE-READONLY-CLI-OFFLINE-20261128T042047-600ed848` 的首次 CLI 33/34、退出 1、原始测试源码与日志继续保留。`verify-import` 仍为既有退出 1，未计入通过数：`cloudfunctions/login/config.json` 实际 SHA-256 为 `aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`，预期为 `ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`；未读取其配置内容或修改来源来凑绿。

所有既有 Git 对象、工作树、报告、日志、合成工件与新旧残留引用原样保留，不移动、覆盖、清理或处理旧队列。本文只新增文档，不修改旧验收报告或日志。

## 未验边界与停止点

实际 CLI 仍锁定。本次既有动态证据来自 Node v24.16.0，不据此补写其他 Node 版本已实测；旧 Node 的相关分支只静审的历史边界保留。假传输与假接收器不证明真实操作者身份、现场批准、真实 Windows 安全输入、证据落盘／ACL／文件身份／TOCTOU、真实 TLS／网络中止、OS 信号／EPIPE、VPN／路由、实机 9 人名单或 `F03FF8DA7299CE148` 可见光入库，亦不消除原有非原子观察边界。

本文仅固化原 P2 的限定关闭及合成证据结论，不读取真实凭据或照片，不连接设备、不改路由、不登记／删除人员、不开门、不启动派发、不运行或放行 E1/E2、生产部署或上线。

本文档提交须仅新增本文，检查 `git diff --check`、追加提交后的 `git show --check`，普通显式推送至独立文档分支并用 `git ls-remote` 核对完整远端 SHA；真实交付结果另保存在本轮独立本机目录 `D:/chatgpt/smart/FACE-READONLY-PROMISE-ACCEPTANCE-20261128T221158-65fa0b50`。完成后停手交另一独立复审，不据此解除 CLI 锁定或执行实机任务。
