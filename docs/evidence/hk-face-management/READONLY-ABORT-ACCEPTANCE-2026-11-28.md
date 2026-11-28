# 受控只读会话取消P2限定验收（2026-11-28）

验收对象：`a2dcc31c86527830323b432b1a33903dd8613354`；其直接父为`2d19672a7096c7d7509299495b8a26de8c9cf6cf`。本文从验收对象建立独立文档分支`docs/hk-face-readonly-abort-acceptance-2026-11-28`，仅新增本文，固化已完成的独立只读复审结论。本文编写没有新增测试运行、源码修复或实机操作，也不替代对本文档提交的独立复审。

## 限定结论

受控会话取消路径的原P2限定关闭；本次合成回归及旧源码负控证据验收通过，未发现需要返修的新增问题。该结论仅针对既有监听器调用`stopImmediatePropagation()`时取消无法关闭Host、导致继续后续只读HTTP的问题，不扩大为所有取消场景、其他入口或真实网络中止的验收。

复审确认：

- `face-readonly-session.mjs`改用`node:events.addAbortListener`，不再依赖可被已有监听器阻断的普通abort订阅；取消先固定`COMMAND_CANCELLED`，再关闭Host并拒绝取消Promise。
- 订阅后仍在Host创建前通过原生`aborted`检查预取消；有效令牌仍先消费，取消后不能重放。`finally`关闭Host，并通过订阅句柄的`[Symbol.dispose]()`解除监听，保留调用方原监听和首个错误。
- Host关闭链销毁SDK请求和Agent；Host每次请求前及SDK Digest重发前的关闭检查继续阻止后续HTTP。SDK、Host、Policy及白名单本次均未改，原双层阻写、pin-before-send、快照绑定和只读门禁未放宽。
- 新增用例在活动假HTTP已记录、正常响应尚未交付时排队取消；覆盖首设备GET、第二描述GET、首人员页、首人脸请求以及controlled runner/main。描述阶段精确比对已发送路径，列表阶段约束人员分页位置和人脸请求数；这些断言支持已覆盖既有请求序列中“取消后零后续HTTP”。清理及预取消同时检查socket关闭、原监听保留和令牌不可重放。

这里的零后续HTTP仅指合成调度中取消后不再开始后续出站请求；已经发送的请求不可撤回，不证明真实链路、内核缓冲、设备侧处理或真实取消时延。

## 既有运行证据

本次文档任务不重跑。下列结果来自[修复实施报告](READONLY-ABORT-FIX-2026-11-28.md)及本机保留的原始stdout、stderr、退出码和源码副本。

原执行环境记录为Windows 23H2 build22631.6199、Node v24.16.0、Windows PowerShell 5.1.22621.6133和PowerShell 7.6.9。聚焦运行时间为2026-11-28T16:31:13至16:31:15+08:00，完整回归为16:31:22至16:32:30+08:00；这些是原运行时间，不是本文编写时的新运行。

| 分组 | 原基线 | 本次保存结果 | 原始进程退出码 |
| --- | ---: | ---: | ---: |
| admin | 673 | 682/682 | 0 |
| tenant | 6 | 6/6 | 0 |
| root | 297 | 297/297 | 0 |
| worker | 35 | 35/35 | 0 |
| worker guard selfcheck | 2 | 2/2 | 0 |
| 合计 | 1013 | 1022/1022 | 各组均0 |

原1013项加新增9项，共1022项合成回归通过；fail、cancelled、skipped、todo均0。聚焦为原83加新增9，共92/92、exit0，不能再次加进1022总数。旧运行argv一致，TAP名称多重集无缺失；测试差异仅182行新增、0行删除，没有删改或跳过原断言。新增9项由首人员页1项、两阶段描述2项、成功/传输失败/首人脸取消清理3项、预取消1项和runner/main各1项构成。

三项相关静态检查原结果为exit0。`verify-import`仍为exit1的既有基线失败，未并入通过数，也未修文件或来源清单凑绿：`cloudfunctions/login/config.json`实际SHA256为`aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`，预期为`ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`。

## 旧源码负控与字节核对

负控只在独立工件副本中，将session模块替换为固定父提交的原始字节，其SHA256为`fe42dfbf6f5f720ffed37f791387a0c83505cd3f9c21f35bc5b8a3817197fa88`；其余17份依赖/测试副本保持受测字节。相同首人员页取消用例应只发送分页位置`[0]`，旧源码实际继续`[0,1,2,3,4,5,6,7,8]`，触发`ERR_ASSERTION`。原始负控为1 test、0 pass、1 fail、exit1，stderr为空。这项故意失败证明新增用例能检出原P2，不计入正式通过数，不宣称全部门禁均有负控。

独立复审已直接核对聚焦和完整回归各27项源码的执行前后哈希、磁盘字节及副本；仅session及其测试相对父证据变化，其余25项不变。实际28个提交blob和index blob均匹配27项受测文件及修复实施报告，原始交付日志的blob字节亦一致。

| 固定对象/文件 | SHA256 |
| --- | --- |
| 修复实施报告 | `696f7695d4db33aee4e6e5c259ad9e1c7f6942ec92df31c68f7b622f287e474a` |
| `admin-web/lib/face-readonly-session.mjs` | `076e4b13629ff69290bdd31b00ae30575a35df18f61692ed36503e3d1417ad4d` |
| `admin-web/tests/face-readonly-session.test.mjs` | `71adf8fcee97941f41fdb13441680196aa157a1af26a0a3de1ed308fccfa89ce` |
| 实际CLI `admin-web/face-readonly.mjs` | `a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d` |

## 证据定位与保留

本机原证据根为`D:\chatgpt\smart\FACE-READONLY-ABORT-FIX-20261128T162359-88c200ab`。关键相对定位：`focused/`、`full/`中的stdout/stderr及同名exit文件，`full/source-before.json`、`full/source-after.json`、`full/source/`，`negative-control/control.stdout.log`、`control.exit.txt`、`copy-manifest.json`、`artifact-copy/`，以及`log-manifest.json`、`artifact-manifest.json`、`git-delivery/`和`delivery-log-manifest.json`。原件与脱敏副本均保留，大小和SHA由对应清单定位；本地路径不是云端附件，异机复审必须实际取件。

修复复审包为`review-bundle-a2dcc31c8652.zip`，863116字节、360个条目，SHA256=`154ea2549814023de690b53ca742eb1d730e5628855a402155fae40e44b7099c`。独立复审已核对ZIP条目CRC、清单内容及本地字节一致。修复提交的push/ls-remote由当时原始日志支持，不将其说成本文新增的远端联网核验。

父提交各轮报告和证据保留在原`FACE-READONLY-SESSION-20261128T154416-f460def0`。首次CLI的33/34、exit1、原测试源码和日志仍在原`FACE-READONLY-CLI-OFFLINE-20261128T042047-600ed848`；没有被1022项通过覆盖或改记。所有旧Git对象、工作树、报告、日志及新旧残留引用原样保留，不清理或移动。

## 未验边界与停止点

旧Node缺少`addAbortListener`或`Symbol.dispose`时在Host创建前失败关闭的分支，仅由静态审查确认，没有实际启动该旧Node验证；namespace import不等于已实测所有Node小版本。完成/取消交错及首错保留也不得扩大为新增9项已经逐一动态覆盖的全部竞态。

实际CLI仍为`LIVE_EXECUTION_LOCKED`，没有新增argv/env/JSON解锁、现场授权发行或外部操作者认证。本结论不证明真实TLS/CA/名称校验、真实网络中止、OS信号/EPIPE、VPN或新路由、实机9人名单、`F03FF8DA7299CE148`可见光入库、现场刷脸或开门；名单与TOCTOU非原子观察边界保持。

本文仅固化限定验收，不读取真实凭据或照片，不连接设备，不改路由，不登记/删除人员，不开门，不处理云队列/派发，不清理残留，不运行或放行E1/E2、生产部署或上线。文档提交推送并核对远端完整SHA后停手，交另一独立复审，不据此解除CLI锁定或执行实机任务。
