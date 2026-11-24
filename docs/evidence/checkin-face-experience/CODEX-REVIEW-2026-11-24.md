# 入住与租期人脸登记体验版：独立复审

复审日期：2026-11-24（Asia/Shanghai）。对象为 `release/miniprogram-checkin-face-test-2026-11-24` 的固定提交 `0d6c674a04b224025c8640628122f27c34e8df0f`，基线 `6ecb337d4d7e84de6080af53e335b75ec7f46875`。本报告与所附合成证据独立提交，不修改候选实现。

## 1. 结论与范围

**不通过。该候选存在实际上传断链、组件接线及事务/派发缺陷，暂不能按可用体验版上传验收。** 发现为 1 项 P0、7 项 P1、3 项 P2；来源登记另作 C1 技术裁定。

聚焦套件 59/59、静态检查 102 文件零违规均已独立复现；额外合成探针仍复现五类缺口。因此套件通过不等于完整链路成立。旧两项 P0 的公开配置能力与版本正则对齐修复保留，不以本次新发现否定其已完成的修正。

用户已经确认：测试房号 102；负责人手填租期；人脸有效期按租期起止，每天 24 小时通行；自动通过限指定测试主入住人。上述规则不重新征询，不改成固定一天或长期有效。

本轮没有登录微信开发者工具、上传体验版、部署云函数、读取实际配置/真实凭据、访问设备、登记真实人员、开门或支付。没有运行真实 worker CLI、完整 E1/E2 或旧 246 项回归。本复审不扩大旧输入 P2 验收，EOF 独立覆盖仍按原记录 `NOT_COVERED` 保留。

## 2. 对象、谱系及证据分级

- 固定对象直接父提交：`94a9c7e21a981220afbc3b833f556f497d4706cb`。
- 自基线起六笔追加提交：`a9d7b30d2ba852d595efe10cbe6aab5d089557bd` → `b3bcb8ffda603fd12ffa9d70d51e4b70cd79e53b` → `fcd7a2fbff499f6ad39cc316912cf9a34b03c9b5` → `b4c0e9f0c42a691d8abe15bcd2c21aa37aabf59d` → `94a9c7e21a981220afbc3b833f556f497d4706cb` → `0d6c674a04b224025c8640628122f27c34e8df0f`。
- 候选相对基线为 45 文件、6792 行新增/12 行删除；独立复审工作树在运行前后均无跟踪文件或未跟踪文件变更。
- 已取得任务卡 `2bbd85dabf5463b9700bdc228c90d36a439f55c3`；实施方所称单独的 `CHECKIN-FACE-EXPERIENCE-DELIVERY-2026-11-24.md` 不在本次取件树中，未将其内容当作已阅读原件。
- 下文“动态复现”均为本轮无业务网络、假云/假设备依赖的合成探针；“静态发现”不冒充实际微信、Windows ACL 或 CloudBase 运行结果。
- 实施方报告的根测试 89/89、八组反向补丁、Windows 平台运行、IDE 登录状态及打包器 14 项失败，本轮未独立重跑；保留为交付方自述。没有据此预填上线成功。

## 3. 必须修正的发现

以下路径和行号均固定于 `0d6c674`，不得把未来修复后的行号混用。

| ID | 级别 | 固定位置 | 问题及证据 | 最小修改要求 |
|---|---|---|---|---|
| R01 | P0 | `miniprogram/services/api.js:75–82`；`pages/face-enroll/index.js:197–207`；云 `lib/validate.js:116–125`；worker `worker-runtime.mjs:547–550` | 实际上传透传 `cloud://…` fileID，云端只接受裸 `test-face/…` 路径，worker 又只接受 `cloud://`。动态探针：真实格式返回 `FILE_OWNERSHIP_MISMATCH`；裸路径能过云校验，却被 worker 拒为 `FILE_ID_INVALID`。现有测试将这些契约拆开模拟。 | 统一真实 SDK fileID 与对象路径的模型；服务端核验可信云环境/存储命名空间、申请、上传者及对象路径的绑定。不能仅去掉协议后信任客户端，也不能删除归属检查。用 SDK 形状的同一标识贯穿上传、创建任务、worker 下载正例，覆盖跨环境/跨申请/跨用户负例。 |
| R02 | P1 | `miniprogram/pages/checkin/index.wxml:43`、`pages/face-enroll/index.wxml:29`；对应 JS `:96–98`、`:171–173` | 单个 `checkbox` 上绑定 `change`，处理器却依赖 `checkbox-group` 的数组值。静态组件契约不匹配，实际勾选可能不更新确认值，两页按钮持续禁用。现有测试直接调用处理器，未验证 WXML 接线。 | 改成真实 `checkbox-group bindchange` 事件结构，补组件结构与处理器配套断言；平台实际交互留待修复后体验版验证，不能用函数单测代替。 |
| R03 | P1 | 云 `lib/store.js:94–128,141–179`；`lib/workflow.js:176–222` | `txStore` 只重写部分方法，继承的 `get/list/count/writeAudit` 闭包仍使用外层 DB。动态记录为 `base:get/base:list/base:count/tx:get/base:audit/tx:set`。配置/名单撤销不进入同一权威读集，事务失败也可能留下独立审计。 | 权威配置/身份/房间/租期/申请读取、业务写及对应审计使用真正事务上下文。按实际 SDK 支持实现稳定点读或守卫方案，不虚构事务查询支持；不能无事务时静默按串行实现宣称原子。测试必须分离 base/tx，覆盖配置撤销冲突及失败整组回滚。 |
| R04 | P1 | 云 `lib/workflow.js:244–298`；`lib/store.js:82–85`；claim `workflow.js:363–371` | 首次任务是“读不存在→无条件 set”。动态调度两个创建者：A 创建并领取到 `CLAIMED/revision=2` 后，延迟 B 覆盖回 `QUEUED_FOR_DISPATCH/revision=1`；第二次领取成功且 claimId 不同。确定性 ID 不能代替原子幂等。 | 首次 create-only 与已有任务处理纳入同一原子边界；已领取/终态及更高 revision 不能回退，稳定 employeeNo 不变。补首次创建与领取交错用例，断言仅一个有效 claim、revision 不回退；不要只测顺序重放或两个领取者。 |
| R05 | P1 | worker `worker-runtime.mjs:148,348–351` | 本地 `deviceKey` 缺失变空串，只有两边都非空才比对。动态探针中任务绑定 A、本地 synthetic origin 为 B，漏配 key 仍可构造 B 的请求。没有连接该 synthetic origin。 | 本地和任务稳定设备标识都必须明确、非空且精确一致，缺失/不一致在任何设备写入前拒绝；设备型号和可信证书仍分别校验，不能用一个字符串代替设备身份核验。 |
| R06 | P1 | worker `claim-and-enroll.mjs:202–240`；`worker-runtime.mjs:303–374`；云 `workflow.js:349,392` | claim 后下载与暂存可能耗时，设备执行前没有 claimExpiresAt 检查或新鲜授权复核。动态注入过期 claim 后，合成执行器仍调用一次，然后才 report；事后失效不能阻止已发生设备操作。 | 下载/准备后、实际设备执行前检查 claim 时效并重新核验当前申请、租期、配置和房间绑定；失败零设备写入。明确最后检查与已在途操作的边界，保留未知/既成设备事实，不承诺跨云与硬件的全局原子撤销。 |
| R07 | P1 | worker `worker-runtime.mjs:509–515`、`README.md:22–23`；根及 `admin-web/package.json` | 默认 SDK import 位于 tools，依赖只在 admin-web 声明，根无依赖/workspaces。按 README 在根安装或仅安装 admin 依赖，tools 的 ESM 不能据此解析到下层 admin 的 node_modules。测试注入 factory，绕开真实解析路径。此为静态安装/解析断点，未初始化真实 SDK。 | 给 worker 明确且可复现的依赖归属、锁文件与安装/解析方式。默认入口应无需注入替身即可解析依赖；不要依赖偶然根目录 node_modules 或 NODE_PATH。只做无凭据的解析/装配验证，不发真实云请求。 |
| R08 | P1 | worker `claim-and-enroll.mjs:136–150`；`README.md:22,86` | Windows 真实照片落盘仅设置 POSIX 0700/0600，且直接复用既有目录；没有建立/验证 Windows DACL、所有者、继承或重解析边界。静态缺少照片私密存储门禁，不代表本轮已发生真实泄露，也未声称做过 Windows ACL 验收。 | 优先复用已支持的受控内存输入，避免这份不必要落盘；如必须落盘，限定到已验证的 Windows 私有临时区并失败关闭。不得把 mode 数字当作 DACL 证据，不借本项重开完整旧 ACL/S4 项目。 |
| R09 | P2 | worker `claim-and-enroll.mjs:230–251,323–327` | `destroyTempJpeg()` 失败仅 warn，已构造的成功回报和 exit0 仍继续，违背清理失败退出口径。静态可达：本地照片删除失败，仍报干净完成。 | 清理结果进入整体结果，保留已确认设备结果但不报告清理成功，不因此重发设备操作或盲删旧对象。若 R08 改为无此临时文件，仍以用例证明不产生该残留和不误报成功。 |
| R10 | P2 | `scripts/checkin-face-static-check.mjs:47–51,131` | `requireText()` 采用任一模式匹配，但调用要求 mode=device 和 validityMode=fixed 同时存在。少一个仍可通过；静态 102/0 不能证明两项同时满足。 | 分别断言或全部匹配，分别移除任一项的受控负例必须失败；不要把注释匹配当作运行请求证据。 |
| R11 | P2 | 云 `lib/workflow.js:181–184`；`miniprogram/pages/checkin/index.js:124–125`、`index.wxml:50–53` | 非名单返回 code0、空 applicationId、pending_review，不创建人工审核申请；前端对任何 code0 都设 applied=true 并展示“已受理”及上传入口。名单在页面加载后撤销是合法触发情形。 | 按下文 C2 区分“自动通过且有效申请 ID”与“应走原审核渠道”；后一种不能显示已受理/已通过或开放人脸入口。不要求在测试函数另建正式审核队列。 |

### 动态探针原始结果

原始输出见 [probes.stdout.txt](review-0d6c674/probes.stdout.txt) 与 [stale-claim.stdout.json](review-0d6c674/stale-claim.stdout.json)。探针进程退出 0 表示**预期缺陷已被断言捕获**，不是产品通过。过期 claim 的假登记函数有意返回失败，worker 观察退出码为 4；它被调用一次本身就是缺陷证据，不是假设备成功结果。

## 4. C1 / C2 技术裁定

### C1：新文件来源登记

采用专门的新文件哈希清单，不往旧 mini-shop 来源记录虚构 `originalSha256`。新增文件没有旧上游原件，`baselineSha256:null` 应保留其真实含义。此裁定不改变既有来源校验历史。

当前 `docs/checkin-face-experience-source-hashes.json` 为 9 个新云函数文件与 1 个后台配置模块，共 10 条；本轮按固定 Git blob 独立复算 10/10 一致。**但 `scripts/verify-import.mjs:12–19` 不读取该清单**，手动比对一次不足以构成持续发布门禁。

实施方应新增实际消费清单的机器校验并纳入本候选发布检查：路径/唯一性、文件哈希及新云函数目录和本地导入闭包范围须明确；修复后同步更新清单。不能仅写“已登记”而没有检查入口，也不因采用独立清单跳过旧来源校验。C1 在机器门禁交付前仍未关闭。

### C2：普通账号审核边界

允许非测试账号留在既有审核渠道；测试函数不自动批准、不写测试申请、不授予人脸权限，这一边界保留。当前 `pending_review` 只能表示“需要走原有流程”，**不能证明已经创建正式人工审核单**。

前端仅在 `auto_approved` 且存在有效 applicationId 时显示测试入住受理及照片入口；其他结果明确提示原有审核渠道，不冒充提交成功。无需为此次测试版再建设正式审核系统。代码及撤名单竞态回归修复后，C2 才可关闭。

## 5. 本轮实测和未验证项

运行环境为云端 Linux、Node v24.22.1；不是本地 Windows 或微信开发者工具。候选目录：`/workspace/SMART-PM-review-checkin-face-0d6c674`。项目源码未改。

| 检查 | 本轮实际结果 | 证据 |
|---|---|---|
| 五个聚焦文件 | 59 tests /59 pass，fail/cancelled/skipped/todo 均 0，退出 0、stderr 空 | `focused.stdout.txt`、`focused.stderr.txt`、`focused.exit-code.txt` |
| 四项独立探针 | R01/R03/R04/R05 均触发报告所述缺陷，探针退出 0 | `probes.cjs`、`probes.stdout.txt`、对应 exit-code |
| 过期 claim 探针 | 执行器调用 1 次；仅假云/假登记，脚本退出 0 | `stale-claim-probe.mjs`、stdout/stderr/exit-code |
| 专项静态检查 | 102 source files、0 violations、退出 0；仍有 R10 | `static.stdout.txt`、对应 stderr/exit-code |
| 小程序结构检查 | 11 页、900 KiB、退出 0；工具自身声明非开发者工具编译/视觉测试 | `structure.stdout.txt`、对应 stderr/exit-code |
| 新来源哈希 | 10/10 与固定 Git blob 相符 | 清单原件及本报告 C1；未声称现有 verify-import 已消费它 |

五文件命令（从固定候选目录运行）：

```sh
node --require "$ART/network-guard.cjs" --test \
  tests/checkin-face-api.test.cjs \
  tests/checkin-face-pages.test.cjs \
  tests/checkin-face-cloud-workflow.test.cjs \
  admin-web/tests/checkin-face-config.test.mjs \
  admin-web/tests/checkin-face-worker.test.mjs
node --require "$ART/network-guard.cjs" "$ART/probes.cjs"
node --require "$ART/network-guard.cjs" "$ART/stale-claim-probe.mjs"
node --require "$ART/network-guard.cjs" scripts/checkin-face-static-check.mjs
node --require "$ART/network-guard.cjs" scripts/check-miniprogram.mjs
```

原始运行 `ART=/workspace/artifacts/checkin-face-review-0d6c674-20261124`。所附两个探针内保存了本次固定工作树路径，异机复现须在另存副本中适配路径、重新记录哈希和结果，不能把修改后的脚本称为本次原字节。guard 会在其所在目录追加退出日志，故不得直接运行已归档原件，应另建运行副本。脚本中的用户名、口令、token、证书位置及 `.invalid` origin 均为合成常量，未读取真实材料。

本轮预载 `network-guard.cjs` 阻止可用的 53 个网络入口并同步 ESM 绑定；触发会计数后抛错，不转发真实目标。附录中 10 个 Node 进程退出记录的 totalCalls 均为 0。**该辅助 guard 未作为完整产品验收对象做系统级认证或完整负控，数字只陈述本次已安装入口的观察**；它不覆盖所有操作系统网络方式、子进程或文件系统，不能据此宣称 Windows/CLI/全系统零副作用。聚焦测试与探针会创建并清理其自有合成临时数据，没有清理旧报告或其他工作树。

原始脚本、日志和退出码均逐字节附在 [review-0d6c674](review-0d6c674/MANIFEST.json)，manifest 记录每份附件字节数与 SHA-256；未重制脱敏副本或把自述日志替换为新版本。

## 6. 退修任务与停止点

续原 WorkBuddy 实施会话，从 `0d6c674` 追加修复 R01–R11 及 C1/C2；先核对该分支是否已经前移及是否已有相同修复，避免覆盖他人提交。不得把本报告当作已经实际派单的回执。

1. 先恢复真实上传标识契约、WXML 事件和实际依赖解析，补贯穿同一输入的正反例。
2. 收拢真正事务边界、任务原子创建、设备 key 和执行前新鲜授权；以分离 base/tx、并发交错、过期/撤权探针证明失败零设备写入。
3. 解决照片私密处理与清理状态，收口静态 checker、普通账号反馈和机器来源校验。保留实际设备事实，不自动重试未知结果。
4. 用批准的无业务网络聚焦套件验证，每类修复至少有会在禁用修复后失败的契约断言；不为了凑数重跑旧 246 或监听套件。新增接口/依赖的白名单和锁文件变更如实列出，不能隐藏在“仅两处修复”中。
5. 更新来源哈希、独立交付报告、准确命令/退出码及未完成项，追加提交、普通显式 refspec push、ls-remote 核对完整 SHA 后停手，交 Codex 复审；不自批。

修复通过后，才进入本次已授权的体验版准备：核对当前版本/回退锚点、解决打包器失败并提供原始失败依据、测试云部署与存储访问隔离、指定体验成员/入口、负责人在本地填 102 绑定与租期、可信设备材料及受控 worker。它们属于尚未完成的真实交付步骤，不能用合成 `PENDING_SITE_VERIFICATION` 预填。

本报告不授权正式发布/提审、扩大测试名单、main 合并、真实支付、开门、批量设备操作或旧冻结线实施。未来现场刷脸结果须单独记录，不以上传照片或云回报替代本人现场验证。
