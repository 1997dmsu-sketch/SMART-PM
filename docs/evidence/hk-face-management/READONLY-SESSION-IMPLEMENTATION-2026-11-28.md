# 单次授权与受控只读适配实施证据（2026-11-28）

实施方交独立复审，不自行宣布验收。固定基线/直接父提交为`79193f4119575bf859af41e654b6daaebd1b7f35`；独立分支`feat/hk-face-readonly-session-2026-11-28`，独立工作树`D:\chatgpt\smart\SMART-PM-face-readonly-session-2026-11-28`。旧工作树、报告、日志及新旧残留引用全部保留。

## 文件范围与实现

修改3份既有文件：`face-readonly-command.mjs`、`face-readonly-host.mjs`、`face-readonly-policy.mjs`；新增会话模块、新测试、3份独立fixture、[使用说明](../../ADMIN-FACE-READONLY-SESSION.md)及本报告，共10个路径。实际CLI `admin-web/face-readonly.mjs`及原P2修复原字节不变，默认无runner仍LIVE_EXECUTION_LOCKED。旧SDK、业务provider、登记入口、UI、worker、依赖、配置、来源清单和旧测试未改。

- 会话模块用私有WeakMap保存严格校验后的不可变config/options/expectations，公开句柄和令牌无可枚举数据。审阅视图仅9个非机密字段；克隆、跨域、Proxy/访问器、未知字段及机密值换标签回显均拒绝。一个准备会话只发行一次独立token；有效token先消费，再检查会话、全部规范化输入及取消，跨配置/跨会话/失败/取消均不能重放。伪token不销毁别人的有效token。
- 预期SPKI、序列号、计划指纹、人数、目标FPID和blackFD具体FDID全部显式绑定。准备时内存证书公钥对独立expectedSpkiPin，执行时原SDK再对peer做pin-before-send；坏证书/错误预期pin在Host前拒绝，错误peer pin/无peer证书零HTTP。不读真实连接配置或证书文件。没有新增TLS绕过机制；既有developmentTls例外显式绑定，peer SPKI校验始终保留。
- policy在原DeviceInfo响应要求根的直接serialNumber子节点恰一且纯文本、精确匹配；型号/计划在list前校验；首人员页及后续页total必须匹配预期，不符合即停止，不继续人脸查询。
- 人数差异仅在当前页状态、编号唯一性及行数/total等语义校验全部通过后，以Host已验证观测返回`observation={actualCount,expectedCount,complete:false}`，不从input填actual，不返回部分名单。异常页先报原分页/员工错误，不产生人数观测。目标验证取已观测唯一人员与具体blackFD/FDID库条目，要求status/recordStatus均present；原严格FPID/isInLibrary检查继续生效，不用红外、numOfFace或聚合状态代替。
- 成功保留原安全的完整名单、device、计划和readonly投影，再加由实际条目生成的窄verification。序列号/pin及原凭据不能藏在vendor文本回显；关键字段碰撞拒绝而非清空后报成功。模式controlled-readonly、siteVerification=NOT_EXECUTED，不是实机/TLS/现场刷脸证明。
- command只新增固定代码级受控runner工厂及原安全投影export。私有controlled域先调用适配器消费令牌，再由适配器校验；实际CLI帮助、stdin/JSON或外层预取消仍属于尚未调用适配器的预检，不宣称这些路径消耗token。无自动重试。任意可信JS不是安全沙盒，也没有实现外部操作者身份认证或真实现场授权发行入口。
- 不增加任何设备端点。原精确白名单、双层阻写、首错熔断、单次connect/list/close、预算≤120秒/5秒/256逻辑请求及同端点一次Digest往返保持。没有业务自动重跑、增额、环境/JSON解锁或任意backend加载。

## 本机环境及真实运行

2026-11-28T15:44:19+08:00记录：Windows 23H2 build22631.6199，Node v24.16.0，Windows PowerShell5.1.22621.6133、PowerShell7.6.9。没有安装或升级运行时/依赖，没有更改网络、Git全局/系统、TLS或组织安全策略。

正式聚焦命令为`node --test --test-reporter=tap admin-web/tests/face-readonly-session.test.mjs`。首轮focused81/81、full1011/1011通过并保存于`focused/`、`full/`。收尾复核发现人数不符仅返回错误码，补齐实读计数观测后R2仍81/81及1011/1011。随后静审发现异常分页可能先产生人数观测，将计数门禁移至当前页完整语义校验之后，并新增两项独立异常页回归；最终在`focused-r3/`、`full-r3/`实测。各轮日志、哈希和源码副本全部保留，没有覆盖或把任何失败改记通过。

最终聚焦83/83、exit0，2026-11-28T15:59:25+08:00至2026-11-28T15:59:27+08:00。最终全量窗口2026-11-28T15:59:33+08:00至2026-11-28T16:00:42+08:00，完整实际argv及每组进程退出码见`full-r3/summary.json`；原五组参数仅admin追加新测试。各stdout/stderr直存原始字节，先保存真实exit再解析TAP，外层脚本退出码不代替测试进程。

| 最终分组 | tests | pass | fail | skipped | exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| admin-final | 673 | 673 | 0 | 0 | 0 |
| tenant-final | 6 | 6 | 0 | 0 | 0 |
| root-final | 297 | 297 | 0 | 0 | 0 |
| worker-final | 35 | 35 | 0 | 0 | 0 |
| worker-guard-selfcheck-final | 2 | 2 | 0 | 0 | 0 |
| 合计 | 1013 | 1013 | 0 | 0 | 0 |

最终原930+新增83=1013项通过，fail/cancelled/skipped/todo均0。原53个测试文件保留，新增1个，共54个。TAP名称多重集和实值argv确认原930保留；新增83测试与4个describe标题分别统计。旧合成loopback HTTP/TLS与PowerShell包装器依原参数回归，新增场景只有合成9人SYNTHFACE1…SYNTHFACE9，不能充作现场9人或F03FF8DA7299CE148证据。

新增用例覆盖快照突变、13项执行输入对比、独立预期缺失、review/token造假和跨域、单次发行/并发消费、取消及失败后零重放、期望及peer pin、serial错误/缺失/嵌套/重复、型号/计划、8/10人首分页停止及实际计数、目标no/absent/missing/duplicate/错FPID/仅红外/错库/缺目标、预算与输出、真实main子进程和生产入口锁定。标准合成完整序列36次假HTTP（9描述/计划+9分页+18逐人逐库），socket关闭先观察再fixture清理。

三项相关静态检查exit0；`verify-import`仍实际exit1的既有基线失败：`cloudfunctions/login/config.json`实际SHA256=`aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`，provenance预期=`ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`。未改文件或清单凑绿。首次33/34失败、其首版测试和所有旧错误日志仍在原CLI证据目录；原P2限定验收不扩大。

## 故意退化负控

三轮负控分别保留在`negative-controls/`、`negative-controls-r2/`及`negative-controls-r3/`，最终轮各仅修改独立工件副本的一处门禁，受测原文件未动：

| 最终负控 | 退化 | tests/pass/fail | exit | 被检出行为 |
| --- | --- | --- | ---: | --- |
| token-consumption | 省略grant.used=true | 1/0/1 | 1 | 并发消费者被放行为两个成功，预期仅一个 |
| plan-before-list | 省略预期计划指纹比对 | 1/0/1 | 1 | 计划不符未给READONLY_PLAN_MISMATCH |

故意失败不计入正式通过总数。完整复制清单、单一变更前后SHA、实际命令、stdout/stderr/exit均保留。它们只证明相应回归能检出这两处退化，不宣称全部门禁均做了变异负控。

## 最终源码前后哈希

以下27项在最终测试前后、当前磁盘及`full-r3/source/`一致。相较基线，3份继承模块收紧、19份继承哈希不变，新增5份受测模块/测试/fixture。CLI本体保持原a5f9…哈希；文档在测试后整理。提交前后另核对Git index/commit blob与这些字节及两份新文档一致。

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
| `admin-web/lib/face-readonly-host.mjs` | `4a9365370607cc246c600351a0dd4e9c293728fbbcd035f587b356bc0976f20d` |
| `admin-web/lib/face-readonly-policy.mjs` | `e24a109d1948bbe6b289eb27b1f03b111deb37639f207c895ae6cc9aa23e4086` |
| `admin-web/tests/face-readonly-host.test.mjs` | `d3cbd900cbd03c8e469bbff636a5e48aeaf171449f576e75e5acfb0cb1e6f112` |
| `admin-web/tests/face-readonly-policy.test.mjs` | `89dd1e481065849b6afd5fff6d08938a06f26542f2ad2a13f83813a5ebc72277` |
| `admin-web/tests/fixtures/face-readonly-fake-transport.mjs` | `2c6c55ed2ee7e7b4abb43e08b407f1b777e3f77e8253bee5b439f25aee27451a` |
| `admin-web/face-readonly.mjs` | `a5f9d431e3cb9669a7174ad6d13ca3d58bb0c392db5aad8f356aff92533e539d` |
| `admin-web/lib/face-readonly-command.mjs` | `0217c79857b055f8485ec0631c2ab03b48e03d18e8d86f5b529d53f1fdb28e35` |
| `admin-web/tests/face-readonly-cli.test.mjs` | `42b3c01a0e219522ecb61733339fd2e5e3b0a65abedc1b8b5aab42f7dd953ca3` |
| `admin-web/tests/fixtures/face-readonly-cli-child.mjs` | `ebf4f8e064cbc8bc9edb6005269afffd13878b975ab902359c1ec1345d63b600` |
| `admin-web/tests/fixtures/face-readonly-cli-network-guard.mjs` | `170fecbf6df460f11141b5f735737ccea1f58850b210bf77f43e8826d50dd6fc` |
| `admin-web/tests/fixtures/face-readonly-cli-synthetic-adapter.mjs` | `9ee6d4d96cfb18c5f521265f339e390a89bd10368c88b13b9d83c1c3af1b42c2` |
| `admin-web/tests/fixtures/face-readonly-cli-synthetic-input.mjs` | `3d248af179c5cc6c1fdb8764cbde9a9b36bfdfba30d911dbe4a86d19831cdf03` |
| `admin-web/lib/face-readonly-session.mjs` | `fe42dfbf6f5f720ffed37f791387a0c83505cd3f9c21f35bc5b8a3817197fa88` |
| `admin-web/tests/face-readonly-session.test.mjs` | `6c32c8decc4ca894d0b15c5f9bc43a35ced7b1ca1f9870f347218965730f4365` |
| `admin-web/tests/fixtures/face-readonly-session-child.mjs` | `dd353ec9cfcf76d83f7d528a063e40095a9f87a66be2813792a64f24fd07323e` |
| `admin-web/tests/fixtures/face-readonly-session-network-guard.mjs` | `f1073e115563fb420ca5c242e16d0eb544d9739ade2a545c31bbcdeb2c86085d` |
| `admin-web/tests/fixtures/face-readonly-session-synthetic.mjs` | `74d4b2493de7b88cf4502415ff084325bf8f582e9f10440b42a3a89f7a9eca07` |

## 工件与取件

本机证据目录：`D:\chatgpt\smart\FACE-READONLY-SESSION-20261128T154416-f460def0`。不是云端附件，异机复审须实际取件。原始日志、各阶段源码副本和退化副本保留；`log-manifest-full-r3.json`列全部本轮原始/脱敏日志的相对名、大小及SHA，`artifact-manifest.json`列核心工件；首次及R2清单也未覆盖。提交/远端证明后续另存，不冒充测试结果。

| 关键相对工件 | bytes | SHA256 |
| --- | ---: | --- |
| `environment.json` | 341 | `bebf72661118081dd15394e0a5915afcfffe6f2c511d244c96049509260865e4` |
| `focused/summary.json` | 594 | `ddc232cd84334af44eeae133da3590b37cefae218725cdbdcb834c034ab1b26a` |
| `full/summary.json` | 6920 | `6599af343a0c6bcd07f08f82b228825715ecd54c6bb1011a193b9a3533a3fa06` |
| `focused-r2/summary.json` | 597 | `21e73f14819f081577eb8db4c8a84ba2af30308245030134bc333b490ebbfb0b` |
| `full-r2/summary.json` | 6923 | `57bf613c370c24bc836017ca309f95bbc2004fb49f4ee65cb91c5c8e77cb6b23` |
| `focused-r3/summary.json` | 597 | `7c48c5fdc785299bfbc5b11f03c1603daf35894db1358068e9d55e47296c216c` |
| `full-r3/summary.json` | 6923 | `495da3dbc46b580f2da8f9b74cecbe393360c8521f3649e8c778e8d76050c5ac` |
| `full-r3/source-before.json` | 3280 | `b46301e5709f6caecabbbb2b3b6eacbcf7b102d027bb51caf34509f5b21d6f7f` |
| `full-r3/source-after.json` | 3301 | `4bbf014acd0ec105379a28a995c0fe71e6dd7050c96169d2ae590b4f086a1334` |
| `negative-controls-r3/token-consumption/result.json` | 717 | `110391ceb0abe3d4869e9aa8f305418abae9b176faea9a6557b94d51b75f200c` |
| `negative-controls-r3/plan-before-list/result.json` | 725 | `d204833548608c3b57b763518f49ae8c15fe35ff4236965dd076bfdbb2589376` |
| `regression-verification-full-r3.json` | 1834 | `6f4379ef7bf15e9cd1135ce3a711c4d06912ddf457b104a0a4005a583e63a7a7` |
| `log-manifest-full-r3.json` | 26452 | `359fda4445ba877543b4681a9512432eed81964600e694d1617eccd701577a51` |

提交后生成含脱敏日志、源码副本和交付证明的`review-bundle-<提交前12位>.zip`；实际文件名/大小/SHA写入`review-bundle-result.json`并随最终回报提供，不伪造附件ID。

## 停止边界

本轮没有真实授权发行、真实凭据/照片/证书文件读取、设备连接、路由修改、人员登记/删除、开门、旧残留清理、云端队列/开关或派发操作。实际CLI入口保持锁定；没有运行旧probe、正式E1/E2或生产服务。

不宣称真实TLS握手/CA/名称、可用实机CLI、真实EPIPE/OS信号、设备身份/权限、VPN、新路由、网页显示或现场9人/F03已验证。未来现场必须独立核验pin、序列号、计划指纹及库编号，再另行受控接入授权入口；没有可信旧编号全集时不宣称名单同历史集合相等。名单及原TOCTOU非原子边界保留，进程内能力不是针对任意可信代码的沙盒。

全部旧对象、报告、日志、失败记录和新旧引用保留。普通显式推送独立分支并核对完整远端SHA后停手，交另一独立复审，不自行宣布验收或E1/E2、删除/开门、派发、部署、上线放行。
