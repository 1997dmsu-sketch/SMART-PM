# D 路证据与回报（checkin-face 退修 CHECKIN-FACE-REWORK-0d6c674）

本目录是 D 路（独立贯穿 QA、静态门禁与来源校验）在本机 Windows Harness 上的实际运行证据。
所有文件由 D 路生成并只读保存；共享工作树中的正式来源清单
`docs/checkin-face-experience-source-hashes.json` 由 lead 在集成冻结后统一复算更新，D 路未抢写。

## 环境与基线

- 平台：Windows（win32 x64），Node v24.19.0（`node --version` 实测）。
- 共享工作树：`C:\Users\Administrator\Documents\ChatGPT\宇宙智联\SMART-PM-H3\_rework-tree`
- 分支：`fix/checkin-face-review-2026-11-24`，实施基线 `0d6c674a04b224025c8640628122f27c34e8df0f`（检出、干净；D 路只读 git status/log/diff，未执行任何修改 git 状态的命令）。
- 本机 `core.autocrlf=true`：工作树文本为 CRLF；哈希按 Git blob 归一（CRLF→LF）口径，与固定复审的 blob 复算一致。
- 本机无任何 `node_modules`（任务禁止安装依赖）；worker 默认依赖入口在本机按失败关闭验证（`CLOUD_SDK_RESOLVE_FAILED`），未做 npm install。

## D 路交付文件（相对 `_rework-tree`，SHA-256 见 files.sha256）

- `scripts/checkin-face-static-check.mjs`（修改）：R10 逐项断言修复。
- `scripts/verify-checkin-face-sources.mjs`（新增）：C1 新文件来源清单机器校验器。
- `package.json`（仅发布检查入口）：`check:checkin-face` 串联静态检查 + 来源校验；新增 `check:checkin-face:sources`。
- `tests/support/d-network-guard.cjs`（新增）：不转发网络守卫（预载模块）。
- `tests/checkin-face-qa-gates.test.cjs`（新增）：R10/C1 门禁与守卫测试（含套内负控）。
- `tests/checkin-face-cross-module.test.cjs`（新增）：跨模块独立回归（19 个用例）。
- 本目录（新增测试证据）；未改动 A/B/C 归属的任何生产或既有测试文件。

## 运行命令与结果（原始命令、退出码、计数）

以下命令均在共享工作树根目录执行（`Set-Location _rework-tree`）。

1. 静态门禁（R10）：
   `node scripts/checkin-face-static-check.mjs`
   → 退出码 0；`[PASS] checkin-face static check: 102 source files scanned, 0 violations`。
   证据：run-static-check.{stdout,stderr,exit-code}.txt。

2. 来源清单校验（C1）：
   `node scripts/verify-checkin-face-sources.mjs`
   → 退出码 1（此日志为复算前快照：清单落后于工作树时的失败关闭证据，逐条违规见 stderr；
   复算完成后的退出 0 见「C1 收口」一节与本路最终回报）。
   证据：run-source-verify.{stdout,stderr,exit-code}.txt。
   校验器本身的正向行为由负控基线副本证明（negative-controls/results/c1-baseline.*：退出码 0，
   entries hash-verified / covered N source files；基线副本自动补登记云目录文件，正式清单不抢写）。

3. D 路门禁套件（守卫预载）：
   `node --require <tree>/tests/support/d-network-guard.cjs --test tests/checkin-face-qa-gates.test.cjs`
   → 退出码 0；tests 18 / pass 18 / fail 0 / skipped 0。
   证据：run-qa-gates.{stdout,stderr,exit-code}.txt。

4. 原始模式（降级分列，不预载守卫）：
   `node --test tests/checkin-face-qa-gates.test.cjs`
   → 退出码 1；tests 18 / pass 17 / fail 1（唯一失败为“本进程已安装守卫”用例，失败消息明确要求 `--require` 预载）。
   证据：run-qa-gates-raw.{stdout,stderr,exit-code}.txt。

5. 跨模块独立回归（守卫预载）：
   `node --require <tree>/tests/support/d-network-guard.cjs --test tests/checkin-face-cross-module.test.cjs`
   → 退出码 0；tests 19 / pass 19 / fail 0 / skipped 0。
   依赖 A 路接口的 8 个用例（R01/A、R03/A×2、R04/A、R06/A×4）按 lead 指令先标待集成：
   每个用例输出 `[待集成]` 诊断行——当前工作树已实测通过，但正式计入等待 lead 集成冻结后的统一收口复跑；
   若 A 路接口缺失，同一用例以 `INTEGRATION_PENDING` 精确失败。
   证据：run-cross-module.{stdout,stderr,exit-code}.txt。

6. 冻结候选缺陷证明（A/B/C 修复落地前、同一测试文件运行）：
   → 退出码 1；tests 19 / pass 11 / fail 8；8 个失败均为 `INTEGRATION_PENDING` 精确捕获：
   R01/A（云端拒 SDK 形状 fileID「照片不属于本次申请」+ worker 对裸路径 `FILE_ID_INVALID`）、
   R03/A（事务内 8 次外层 base 访问路由清单 + 提交失败残留 `applyCheckin` 独立审计）、
   R04/A（延迟创建者把 CLAIMED 回退 revision 2→1、第二次领取成功且 claimId 不同）、
   R06/A ×4（beginTaskExecution 未接通）。
   证据：run-cross-module-frozen-candidate.{stdout,stderr,exit-code}.txt。

7. 旧 246 项、监听套件、真实 worker/设备/云/微信上传：**未运行**（本路禁止项）。
   既有五文件属 A/B/C，由 lead 集成冻结后统一运行；本路未重跑。

## R10 负控（全树自有副本，精确失败）

脚本：negative-controls/run-negatives.cjs；结果：negative-controls/results/results.json（13 例，逐例 stdout/stderr/exit-code）。
每例在 `_lanes/D/negative-controls/<name>/` 的全树副本上运行静态检查或来源校验，共享工作树不被触碰：

| 负控 | 变更 | 期望 | 实测退出码 | 命中断言 |
|---|---|---|---|---|
| r10-baseline | 无 | 0 | 0 | 0 violations |
| r10-no-mode | 删 `mode:"device"` | 1 | 1 | 仅「必须显式 mode=device」 |
| r10-no-validity | 删 `validityMode:"fixed"` | 1 | 1 | 仅「必须显式 validityMode=fixed」 |
| r10-neither | 两项都删 | 1 | 1 | 两条专属消息 |
| r10-commented | 两项改成注释（第二处 validityMode 保留） | 1 | 1 | 两条专属消息（注释命中不算） |
| c1-baseline | 无（清单按磁盘复算基线） | 0 | 0 | 10 entries hash-verified |
| c1-hash | 篡改一条 sha256 | 1 | 1 | 磁盘哈希不符 + 路径 |
| c1-dup | 重复路径 | 1 | 1 | 清单路径重复 |
| c1-illegal | `../` 穿越路径 | 1 | 1 | 清单路径非法 |
| c1-missing | 删 lib/config.js 条目 | 1 | 1 | 云目录闭合缺口 |
| c1-fake-baseline | baselineSha256 填伪串 | 1 | 1 | 不得伪造 originalSha256 |
| c1-scope | 登记旧云函数目录路径 | 1 | 1 | 超出登记范围 |
| c1-closure | 新文件导入未登记的体验版新文件 | 1 | 1 | 本地导入闭包未登记 |

## R10 / C1 修复说明

- R10：`requireText`（任一命中即过）改为逐项断言 + 请求构造处锚定（与 `consent:true` 硬要求共置的 ±15 行窗口），
  注释剔除后才匹配；mode 与 validity 各自专属消息，任一缺失即失败。对 worker 内部重构（Core/wrapper、内存/落盘入口）不绑定函数名。
- C1：新增校验器消费 `docs/checkin-face-experience-source-hashes.json`：清单结构与路径合法性/唯一性（大小写不敏感）、
  磁盘哈希（Git blob 归一）、新云函数目录全量闭合（.js/.json/.md 一律入册，含 INTERFACES.md 契约文件）、
  本地导入闭包闭合（相对导入可解析 + 范围内目标必须登记；文档/清单不参与导入解析）、
  baselineSha256 只允许 null 或真实 64 位哈希（不伪造 originalSha256）、与 docs/backend-provenance.json / backend-changes.json
  隔离（原来源校验职责保留，`scripts/verify-import.mjs` 不动）。已接入候选发布检查入口 `npm run check:checkin-face`。

## 网络守卫（新导入闭包、加载前安装）

- 命名绑定：`globalThis.__DSH_D_NETWORK_GUARD__`（name=d-network-guard，patchedCount≥10）。
- 自检不转发：`selfTest()` 逐入口触发并断言全部抛 `D_NETWORK_GUARD_BLOCKED`、`forwarded === 0`（套内用例 1）。
- 测试子进程继承：`node --require <guard> -e ...` 子进程实测拦截且不转发（套内用例 2）；
  无 `--require` 的原始子进程不继承（套内用例 3）。
- 原始模式与降级分列：见上文命令 3/4 两份证据。
- 边界声明（与固定复审同口径）：守卫只覆盖已列入口，不是操作系统级/全系统安全验收。

## 与 A 路唯一接口清单（INTERFACES.md）的对齐结论

跨模块回归的 A 接口依赖用例已按清单 §1/§2/§3/§5 收敛（oracle 用清单闭式码表字面值，不调用生产 helper 计算期望值）：

- §1（R01）：S1 用 SDK 形状 fileID 贯穿上传→创建→worker 下载并逐段断言；负例按 §1.4 码表逐一断言
  `FILE_OWNERSHIP_MISMATCH`（跨用户/跨申请）、`FILE_NAMESPACE_MISMATCH`（跨环境）、
  `INVALID_FILE_ID`（裸路径/非 cloud:///文件名含 %、..、分隔符）、`STORAGE_NAMESPACE_UNCONFIGURED`（未配置命名空间，零任务写入）；
  §1.2 断言 getConfig 只下发 `storageNamespaceConfigured` 布尔不下发值；§1.5 断言 worker 对非 cloud:// 一律 `FILE_ID_INVALID`。
- §2（R06）：S6a 断言成功推进 `DEVICE_PROCESSING`/revision+1/claimExpiresAt 不延长/authorizedAt 正整数毫秒且 ≤ claimExpiresAt，
  并按 §2.3 断言快照字段（workerId、task.authorizedAt===data.authorizedAt、cloudPath、timezone、dailyHours、roomBindingId、leaseSnapshotId）；
  S6b 断言本地 `BEGIN_AUTH_EXPIRED` + 云端 `CLAIM_EXPIRED` + 副作用 UNKNOWN_RESULT/`CLAIM_TIMEOUT`/审计；
  S6c 断言 `EXECUTION_INVALIDATED` + INVALIDATED + 具体 resultCode + 审计；
  S6d 断言 `WORKER_MISMATCH`/`CLAIM_MISMATCH`/`INVALID_REVISION`（revision<2）/`EXECUTION_ALREADY_STARTED`/`REVISION_CONFLICT`；
  以上失败全部零设备执行（执行器调用计数断言）。
- §3（R03/R04）：S3a 断言事务内权威读取/审计不回落外层 base，并断言事务上下文集合查询硬性抛 `TX_UNSUPPORTED_QUERY`（§3.3）；
  S3b 断言提交故障业务写与审计整组回滚（base 全库不变）；S4 断言首建 create-only、晚到创建者 `TASK_ALREADY_CLAIMED`、
  revision 不回退、employeeNo 不变、单一有效 claim。
- 8 个 A 接口依赖用例均带 `[待集成]` 诊断标记：当前工作树实测通过，正式计入等待 lead 集成冻结后统一收口复跑。

## C1 收口（lead 冻结指令，已执行）

四路停止编辑后，D 路按真实用途统一复算 `docs/checkin-face-experience-source-hashes.json`：
- 条目数：**107**（A 云函数 10 含 INTERFACES.md、admin-web 5 + 云工作流测试 1；B 两页 8 + api/runtime 2 + 测试 2；C worker 目录 10 + admin worker 测试 1；D 脚本/测试/守卫/根 package.json 6；D 证据目录 62）。
- sha256 与校验器同一口径（文本 CRLF→LF Git blob 归一；生成物含 NUL 按原始字节）。
- `baselineSha256` 一律 null：不虚构 originalSha256；原有 10 条语义保持不变（仅 sha256 复算、purpose 随实现更新）。
- 复算后 `node scripts/verify-checkin-face-sources.mjs` 与 `npm run check:checkin-face` 的退出码/输出见本路最终回报（证据目录在复算前定格，运行输出不入树以免破坏已登记哈希）。

## 未验证项与阻断

1. 来源清单已按 lead 冻结指令统一复算（107 条）；复算后的校验器与发布检查运行退出码见本路最终回报。
2. 真实微信 fileID 命名空间形态、真实 CloudBase 事务行为、真实设备执行、真实 `wx.cloud.uploadFile` 均未实测
   （与 A 路 INTERFACES §1.6/§3.3 同一口径）；全部为合成 fixture/假云/假设备。
3. worker 默认依赖入口在本机以失败关闭路径验证（未安装依赖）；安装后解析成功路径未验证（任务禁止 npm install）。
4. 既有五文件与旧 246 项不属本路，未运行；等待 lead 集成冻结后的统一收口。
5. 无阻断项：D 路必做（R10、C1 校验器与接入及收口复算、跨模块回归、负控、守卫）全部完成并实测。

## 停止点

按任务纪律：D 路不自批、不上传体验版、不部署、不开始上线、不执行任何 Git 写入命令。停手等待 lead 集成冻结与 Codex 复审。
