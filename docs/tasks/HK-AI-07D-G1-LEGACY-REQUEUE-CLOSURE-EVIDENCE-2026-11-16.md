# HK-AI-07D G1 旧 requeue 入口封闭——交付证据

- 日期：2026-11-16（Asia/Shanghai）。
- 状态：实施完成；已按独立复审 P2-1/P2-2 追加测试与证据修复，并按本轮要求追加 P2-3（预加载网络/监听 guard 与过滤式全量回归）。本文交付不表示 G1 已被 Codex 验收、不表示 07D 全量关闭、不表示可上线。
- 依据：远端 `968e5f3`（`docs/tasks/HK-AI-07D-G1-LEGACY-REQUEUE-CLOSURE-TASK-2026-11-16.md`），通过 `git show` 读取，未合并文档分支。

## 1. 基线、分支与谱系

| 项 | 值 |
|---|---|
| 代码基线（父提交） | `1155b7ba65991d324fb8b22bb8f7dd87f49428f9`（H4-b 终审） |
| 实施分支 | `feat/hk-face-legacy-requeue-closure` |
| 隔离工作树 | `C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\closeout-a` |
| 输入提交 | `5cba1f889278bbb6def50c8bb06de51f37bb3ab5`（本地 `codex/07d-g1-p2` 起点） |
| 远端既有补丁 | `9d294f36d1b7a3f7c29fcafbdb887c98953a716e`（`feat/hk-face-legacy-requeue-closure`；本轮仅 fast-forward，未重复提交） |
| 最终提交 SHA | 见交付回报（包含本证据文档的追加提交；普通 push 后以 `git ls-remote` 复核） |
| 提交方式 | 追加提交；未 amend、未 rebase、未 squash、未 reset、未 force push |
| 07B 合并 | 未合并 `59a737a`，未修改 07B 生产读模型；不把「已终审」写成「已合并」 |
| G2 / H4-c C2/C3 / K3 | 未开始、未实现、未执行初始化或迁移 |
| HTTP / UI / 小程序 | 未修改 |

## 2. 变更文件清单

相对基线 `1155b7b`，实际变更仅下列 7 个文件（5 个既有文件改动 + 2 个新增文件）：

| 文件 | 变更性质 |
|---|---|
| `admin-web/lib/face-service/h3b.mjs` | 删除 `H3MockDispatcher.requeue`（原 444–487 行），共 44 行删除 |
| `admin-web/lib/face-service/h4b.mjs` | 删除 `H4MockRevoker.requeue`（原 482–519 行），共 38 行删除 |
| `admin-web/tests/face-grant-d-matrix.test.mjs` | 6 处旧调用迁移为封闭负向证据 / 合法 queued fixture；新增 validator 导入与封闭断言 helper |
| `admin-web/tests/face-h4b.test.mjs` | 4 处旧调用迁移为封闭负向证据 / 合法 queued fixture；新增封闭断言 helper |
| `admin-web/tests/face-legacy-requeue-closure.test.mjs` | 新增：LC01–LC10 专门封闭测试（9 个测试）；首个 import 预加载 guard，逐场景全库逐项快照 + 四类真实副作用计数器 |
| `admin-web/tests/helpers/closure-guard.mjs` | 新增：预加载监听/业务网络 guard；禁 `listen`/`dgram.bind`/`fetch`/`http(s).request|get`，计数只增不清零，自检与恢复 |
| `docs/tasks/HK-AI-07D-G1-LEGACY-REQUEUE-CLOSURE-EVIDENCE-2026-11-16.md` | 本证据文档；P2-1/P2-2/P2-3 修复与过滤式回归记录 |

锁文件与依赖清单：`npm install` 曾因 npm 版本差异规范化 `admin-web/package-lock.json` 的 `libc` 字段（48 行删除），已 `git restore` 恢复；最终相对基线零差异。

## 3. 调用点处理表

基线检索命令：`rg -n 'requeue\(' admin-web/lib admin-web/tests`（在隔离工作树重新枚举）。

### 3.1 生产定义（2 处，全部删除）

| 位置 | 处理 | 说明 |
|---|---|---|
| `admin-web/lib/face-service/h3b.mjs:444` `H3MockDispatcher.requeue` | 删除 | 仅该方法使用的私有字段/helper 经逐一计数复核均未变成死代码（按出现次数计）：`assertBoundedId`(3)、`logRef`(5)、`unique`(3)、`assertLogAbsent`(4)、`patch`(4)、`SERVICE_ACTOR`(4)、`safeNow`(6)、`keyOf`(12)、`ref`(10)、`validateDispatchJob`(6) 仍被其他方法使用 |
| `admin-web/lib/face-service/h4b.mjs:482` `H4MockRevoker.requeue` | 删除 | 同理（按出现次数计）：`assertBoundedId`(9)、`deterministicLogId`(10)、`logFor`(3)、`patchRecord`(8)、`safeNow`(12)、`keyOf`(2)、`ref`(29)、`validateRevokeJob`(13) 仍被其他方法使用 |

删除后 `rg -n 'requeue' admin-web/lib` 结果为零。无改名（无 `_requeue`）、无重新导出、无转发、无可调用的抛错 stub、无 `actor=null` 分支、无隐藏开关。

### 3.2 测试调用点（10 处，全部处理）

| 文件:行（基线） | 原用途 | 处理 |
|---|---|---|
| face-grant-d-matrix.test.mjs:1745 | `RETRY_NOT_DUE` 断言 | 改为封闭负向证据：原型链无 requeue + TypeError，退避前后均验证 |
| face-grant-d-matrix.test.mjs:1748 | 成功重排 → queued | 改为测试内合法 queued fixture（保留 result/nextAttemptAt），经 `validateDispatchJob` 后继续原 second dispatch 断言 |
| face-grant-d-matrix.test.mjs:1773 | `RETRY_NOT_DUE` 断言 | 改为封闭负向证据（120000/600000 边界前后） |
| face-grant-d-matrix.test.mjs:1776 | 成功重排 → queued | 改为封闭负向证据（该用例仅验证边界值，不依赖后续 dispatch） |
| face-grant-d-matrix.test.mjs:1866 | `INVALID_JOB` 禁止重排 | 改为封闭负向证据（awaiting_result 不可达） |
| face-grant-d-matrix.test.mjs:2041 | attempt=4 `INVALID_JOB` | 改为封闭负向证据，保留 attempt=4 耗尽与 Provider 计数断言 |
| face-grant-d-matrix.test.mjs:2075/2081/2082 | 权限/CAS 重排 | 整用例改为封闭负向证据 + 全库 deepEqual；权限 fixture 保留但不再有可调用对象 |
| face-grant-d-matrix.test.mjs:2096 | actor/revision 参数校验 | 整用例改为「旧入口已整体移除」封闭证据 + 全库 deepEqual |
| face-h4b.test.mjs:129/131 | `RETRY_NOT_DUE` + 成功重排 | 改为封闭负向证据；随后用合法 revoke queued fixture（清空 result/nextAttemptAt）经 `validateRevokeJob` 保留资源未释放断言 |
| face-h4b.test.mjs:189/191 | 30/120/600 边界重排 | 改为封闭负向证据 + 每次迭代用合法 queued fixture 后继续第 4 次耗尽断言 |
| face-h4b.test.mjs:442/444/445 | 权限/CAS 重排 | 整用例改为封闭负向证据 + 全库 deepEqual |
| face-h4b.test.mjs:747 | awaiting_result 禁止续跑 | 从统一 rejects 循环中拆出，单独做封闭负向证据；dispatch/finalize 原断言保留 |

### 3.3 旧测试保留/拆分对应关系

| 原测试标题 | 新标题 / 处理 |
|---|---|
| `H3-b D44/D45：pre_send 瞬态统一预算、退避到期 CAS 重排后再发` | `H3-b D44/D45：pre_send 退避边界保留；旧 requeue 封闭，测试 fixture 构造 queued 后再发`（保留 30s 边界、second dispatch、attempts=2、Provider=2 断言） |
| `H3-b D42/D43：第二、三次失败严格使用 120000/600000 退避边界` | `H3-b D42/D43：第二、三次失败 120000/600000 退避边界保留；旧 requeue 封闭`（保留边界值断言） |
| `H3-b D32/D40：post_send unknown 与异常结果进入 awaiting_result，禁止重排` | 标题补「旧 requeue 已封闭」（保留 awaiting_result 断言） |
| `H3-b D44：attempt=4 的名单瞬态与 Mock pre_send 均耗尽终态` | 标题不变，内部 INVALID_JOB 断言改为封闭证据（保留耗尽/Provider 断言） |
| `H3-b D54：人工重排要求 device.operation.retry，自动重排共享 CAS` | `H3-b D54：旧人工 requeue 整体封闭，不保留 device.operation.retry/CAS 旁路` |
| `H3-b 人工重排 actor 与 revision 参数先失败关闭` | `H3-b 旧 requeue 的 actor/revision 参数校验入口已整体移除` |
| `H4-b pre-send retry observes 30 second boundary and never releases resources` | `H4-b pre-send retry boundary; old requeue closed, resources untouched` |
| `H4-b dispatch retry uses exact 30/120/600 boundaries and attempt 4 exhausts` | 标题补 `; old requeue closed`（保留第 4 次耗尽与 Provider=4 断言） |
| `H4-b manual retry requires current revision and device.operation.retry` | `H4-b old manual requeue is closed; no revision/permission bypass remains` |
| `H4-b awaiting_result rejects every automatic or manual continuation` | 标题不变，requeue 从循环拆为独立封闭断言 |

未使用 skip、todo、空 test、放宽 validator、禁用失败断言或数量统计代替语义验证。

## 4. LC01–LC10 证据对应

| ID | 证据位置 | 结论 |
|---|---|---|
| LC01 | 新增测试 `LC01`：直接 `import { H3MockDispatcher } from h3b.mjs`，检查实例与每层原型 `Object.getOwnPropertyDescriptor(proto,"requeue")===undefined`，并检查 h3b 模块导出面与公共 index 无 requeue 别名 | PASS |
| LC02 | 新增测试 `LC02`：直接 `import { H4MockRevoker } from h4b.mjs`，同 LC01；另验证 index 重导出的类原型同样无 requeue | PASS |
| LC03 | 新增测试 `LC03`：两实例 × actor(undefined/null/user/system) × revision(undefined/1/0) 共 24 组，全部 TypeError；每组各自 `before/after` 全库 `structuredClone(store.data)` + `assertWholeStoreEqual`（集合键→每集合→整体） | PASS |
| LC04 | 新增测试 `LC04/LC05`：H4（revoke）job 的 `retryable_failed` 到期/未到期两种 seed 入 store，调用旧入口 TypeError，每种状态独立 `before/after` 全库快照 + `assertWholeStoreEqual`；H3（enroll）侧由迁移后的 `D44/D45`、`D42/D43`、`D54` 与 actor/revision 用例提供真实 `retryable_failed` 作业上的封闭探针 + 全库 deepEqual | PASS |
| LC05 | 同测试覆盖 revoke 的 queued/sending/awaiting_result/terminal_failed 四种旧状态作业，每种状态独立 `before/after` 全库快照 + `assertWholeStoreEqual`，state/attempts/lease/revision/资源字段均不可修改；H3 侧由 `D32/D40`、`attempt=4 耗尽` 用例覆盖 awaiting_result / terminal_failed 的封闭证据 | PASS |
| LC06 | 新增测试 `LC06`：预置旧 queued job + log + audit + op key + domain，单场景前后全库 `structuredClone(store.data)` + `assertWholeStoreEqual`（集合键→每集合→整体），无新增 op key/domain，无伪造服务回执 | PASS |
| LC07 | D-matrix `D44/D45` 用 `patchRecord` 构造 enroll queued（保留 result/nextAttemptAt）并调用 `validateDispatchJob` 通过；h4b 两用例用 `Object.assign` 构造 revoke dispatch queued（清空两字段）并调用 `validateRevokeJob` 通过；新增测试 `LC07` 显式验证 revoke queued 塞入 enroll 语义字段会被 validator 拒绝 | PASS |
| LC08 | 过滤式回归 499/499、root 51/51 通过；`closure-guard.mjs` 在业务模块加载前预装，顶部断言模块加载期 `{listen:0,network:0}`；LC08 先单独 `guard.selfCheck()`（真实触发被禁止入口，`allThrew=true`、delta `{listen:1,network:5}`），再以自检后计数为 baseline，探针期间网络/监听 delta 为 0；Provider/私密文件/Store 写三类真实计数器增量为 0，`provider.calls` 增量为 0，全库逐项零变化，`finally` 恢复 | PASS |
| LC09 | 新增测试 `LC09` 读 h3b.mjs/h4b.mjs 源码断言无 `requeue`/`_requeue`/`actor==null` 标识符；`rg` 复核 lib 目录零命中；公共 index 零差异证明见 §5 | PASS |
| LC10 | 新增测试 `LC10` 验证导出面无无理由差异；`git diff --name-only 1155b7b..` 证明 server/routes/miniprogram/Store/validator/index/package 全部零差异（§5） | PASS |

注：LC03–LC06 每个独立场景均执行 `before/after` 全库 `structuredClone(store.data)` + `assertWholeStoreEqual`，快照覆盖 store 中每一个集合（含所有未知/未来集合），而非固定集合白名单；范围包含 job/log/audit/op key/domain。LC08 的四类真实副作用计数器（Provider/私密文件/Store 写/业务网络）与既有 dispatcher 回归的 Mock Provider 调用口径分离：前者增量恒为 0，后者不统称为 0。

## 5. 零副作用 / 范围边界证明

相对基线 `1155b7b` 执行 `git diff --name-only`，逐路径核对：

```
ZERO-DIFF  admin-web/lib/face-service/h3a.mjs
ZERO-DIFF  admin-web/lib/face-service/state.mjs
ZERO-DIFF  admin-web/lib/store.mjs
ZERO-DIFF  admin-web/lib/face-service/service.mjs
ZERO-DIFF  admin-web/lib/face-service/routes.mjs
ZERO-DIFF  admin-web/server.mjs
ZERO-DIFF  admin-web/lib/face-service/index.mjs
ZERO-DIFF  admin-web/package.json
ZERO-DIFF  admin-web/package-lock.json
ZERO-DIFF  miniprogram/
```

其他边界：

- 未实现新的 `retry`，未写 `face.operation.retry` 的 K2/op key/domain/replay 服务；未改 job schema/validator/state/DTO/权限目录/Store。
- 未修改 `server.mjs`，未注册 HTTP，未接 UI；`routes.mjs` 中 E07 候选描述清理未夹带（留待 Q8 独立小提交）。
- 未合并 07B 分支 `59a737a`，未改其生产读模型。
- 未实现 reconcile/finalize-retry，未开始 H4-c C2/C3，未改 K3，未执行初始化/迁移。
- 未改预约预签约、支付或小程序发布功能；未接 Provider/设备/生产云；未部署；未合并 main。

## 6. 测试命令与实际结果

本轮在 `C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\closeout-a\admin-web` 与仓库根执行。所有 Node 测试均通过 `--import`（根测试用 `NODE_OPTIONS=--import=file:///...`）预加载 `tests/helpers/closure-guard.mjs`；guard 在业务模块加载前禁止监听与业务网络并计数。默认测试隔离在本机因 `spawn EPERM` 不可用，保留一次失败记录；下表结果为 `--experimental-test-isolation=none` 降级，未伪报默认隔离通过。

| 命令 | 工作目录 | exit | 计数/结果 |
|---|---|---|---|
| `node --test --experimental-test-isolation=none --import ./tests/helpers/closure-guard.mjs tests/face-legacy-requeue-closure.test.mjs` | `admin-web` | 0 | 9 tests / 9 pass / 0 fail / 0 skipped / 0 todo |
| 同上，文件为 `tests/face-grant-d-matrix.test.mjs tests/face-h4b.test.mjs` | `admin-web` | 0 | 142 tests / 142 pass / 0 fail / 0 skipped / 0 todo |
| 同上（closure 置于最后），33 个非监听 `tests/*.test.mjs`（排除下表 8 个） | `admin-web` | 0 | 499 tests / 499 pass / 0 fail / 0 skipped / 0 todo |
| `node --test --experimental-test-isolation=none` + `NODE_OPTIONS=--import=file:///.../closure-guard.mjs`，7 个 `tests/*.test.cjs` | 仓库根 | 0 | 51 tests / 51 pass / 0 fail / 0 skipped / 0 todo |
| `node --input-type=module --import ./tests/helpers/closure-guard.mjs -e <selfCheck>` | `admin-web` | 0 | `{"allThrew":true,"delta":{"listen":1,"network":5}}` |
| `git diff --check` | 仓库根 | 0 | 无 whitespace 错误 |
| 默认隔离（无 none）复跑封闭测试 | `admin-web` | 1 | `Error: spawn EPERM`（环境限制，保留记录） |

**排除的监听测试（8 个）**：`server.test.mjs`、`blacklist-http.test.mjs`、`occupancy-http.test.mjs`、`server-face-bounds.test.mjs`、`server-face.test.mjs`、`server-files.test.mjs`、`server-v2.test.mjs`、`verification-http.test.mjs`。审阅源文件后确认它们均调用 `.listen(...)`（部分通过 `createApp`），与 guard 的“禁止启动监听”合同冲突，按指令排除，未运行、未启动任何监听。其余 33 个测试在 guard 下运行；guard 若被任一测试触发监听/业务网络会直接抛错，499/499 通过即证明未发生。过滤式命令将 `face-legacy-requeue-closure.test.mjs` 置于最后，guard 覆盖前 32 个文件后，才在该文件结束时恢复（`after`），不在中途提前恢复。

隔离说明：首选默认隔离；本机 `spawn EPERM` 失败记录已保留，随后使用 `--experimental-test-isolation=none`。锁文件与依赖清单零差异；测试依赖通过指向同仓库已安装 `node_modules` 的环境 junction 提供，未提交、未改依赖清单。

## 7. 敏感字段与旁路检查

- 封闭测试使用合成 fixture（org-g1 等），不含真实人员、住户、设备、门禁凭据、AppID、商户号或密钥。
- 不打印 token/Cookie/密码/私钥；不上传真实人脸；不调用真实设备；不执行数据库迁移。
- `closure-guard.mjs` 在业务模块加载前安装：禁 `net.Server.listen`、`dgram.Socket.bind`、`globalThis.fetch`、`node:http/https request/get`；计数只增不清零，`restore()` 幂等。
- `LC08` 先单独执行 `guard.selfCheck()`：真实触发被禁止入口并断言全部抛错，记录自检增量 `{listen:1,network:5}`；此后以自检后计数为 baseline，探针期间 `guard.delta()` 的 `{listen:0,network:0}` 才被接受，没有清零掩盖模块加载期调用。
- `LC08` 的 Provider/私密文件/Store 写计数器用 `installSideEffectCounters` 包裹真实方法，安装时记录 baseline、探针只读 delta，`finally` 逆序恢复；Provider 6 方法、FileService 9 方法、Store 3 写方法。
- 其他既有 dispatcher 回归中的 Mock Provider 调用与封闭探针的 4 类真实计数器 0 口径分离陈述，未将全套 Mock 调用统称为 0。

## 8. 独立复审 P2 缺口修复（追加提交）

独立复审确认生产删除符合范围，但提出证据缺口。本文件按 P2-1/P2-2/P2-3 追加测试与证据；本轮只改测试、测试 helper 与证据，不改生产代码、不改写历史。

### P2-1 逐场景全库快照

- 原 `fullSnapshot(store)` 用固定 10 集合白名单逐个 `store.list(name)`，不满足「全库前后内容级相等」。
- 改为 `structuredClone(store.data)`，覆盖 store 中每一个集合（含所有未知/未来集合）。
- 新增 `assertWholeStoreEqual(after, before, label)`：先比较集合键集合，再对每个集合 `deepEqual`，最后整体 `deepEqual`。
- LC03 的 24 组 actor/revision、LC04/LC05 的 6 种 job 状态、LC06 的单场景，均各自保存动作前后快照并逐项比较，不跨场景复用。

### P2-2 真实副作用计数器

- 原 LC08 仅用 `provider.calls.length` 与对象引用比较，未真实统计私密文件、Store 写、网络。
- 新增 Provider 6 方法、FileService 9 方法、Store 3 写方法计数器；安装时记录 baseline，探针只读 delta，`finally` 恢复。
- 网络不再由测试内 wrapper 统计，统一由预加载 guard 统计（见 P2-3），避免两套网络计数重复/互相覆盖。

### P2-3 预加载网络/监听 guard 与过滤式回归（本轮新增）

- 新增 `admin-web/tests/helpers/closure-guard.mjs`，并在测试文件第一个 import 及测试命令 `--import` 中预加载，确保先于 `LocalStore`/`FileService`/h3b/h4b 等业务模块。
- 顶部断言 `moduleLoadCounters = {listen:0, network:0}`：业务模块加载期不得监听或调用网络。
- `guard.selfCheck()` 分别真实触发 `listen` 与 5 个网络入口，断言全部拦截、delta `{listen:1,network:5}`；此后以自检后的计数为 baseline，探针期间 delta 为 0；全程不清零。
- `LC08` 的 `finally` 恢复 Provider/文件/Store wrapper；测试文件 `after` 恢复 guard。
- 监听测试 8 个全部排除（依据源文件 `.listen` 审阅）；过滤式 admin 499/499、root 51/51、定向 142/142、封闭 9/9 全部通过。

本轮追加后按 §6 重跑；计数与上表一致。
## 9. 限制与待复审

- 本卡仅封闭两个旧写入口，未实现 G2 的新 `retry` 严格权限/CAS/到期合同；G1 负向 TypeError 不得计作 G2 已通过。
- 07D 全量 90 项矩阵、G4 兼容/路由清理、07B 合并门禁均不在本卡范围。
- 交付后停手，等待 Codex 独立复审；不自行开始 G2。
- B/C/D 本轮未收到独立输入/SHA 或任务卡，未执行，也未写任何报告/设计卡；仅完成指定的 G1 P2 范围。
