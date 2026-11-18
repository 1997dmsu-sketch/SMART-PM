# HK-AI-07D G4 兼容与封闭审查证据（2026-11-18）

> 状态：**G4 交付证据，待 Codex 独立复审**。本文件只证明 G4 兼容/封闭审查，
> **不宣布 07D 全量关闭、不宣布可上线、不宣布 07B 合并或 HTTP 接线**。
>
> 硬边界：只新增本文件与 `admin-web/tests/face-g4-compatibility.test.mjs`；
> 生产代码、既有测试、G1/G2/G3 证据零修改；不启动 HTTP、不监听端口、
> 不调用 Provider/设备/生产云/支付；不执行安装/迁移。

## 1. 基线与谱系

| 项 | 值 | 核验方式 / 实测 |
|---|---|---|
| 固定基线 | `5f1d7a409847bc78d860963f13b45358fac7b5d6` | `git rev-parse HEAD`（执行开始） |
| 基线 tree / 父 | `38675c39ea6652fca28106a80c49437e0257bede` / `5abfd746609ab8fac141ce5ecc527479250cc4e2` | `git cat-file -p HEAD` |
| 执行分支 | `feat/hk-face-g4-compatibility-review` | `git status --porcelain=v2 -b` |
| 初始工作树 | `git status --porcelain` 为空；HEAD 即固定基线 | 实测 |
| shallow 状态 | `true`；`.git/shallow` 边界 = `5abfd74…`（共享仓库浅取标记） | `git rev-parse --is-shallow-repository` / 读 `.git/shallow` |
| 谱系口径 | 浅取边界父为空**不等于无父**；谱系以 commit 对象 `parent` 行为准 | 逐级 `git cat-file -p` |
| G3 验收指针 | Codex 复审通过：90 ID 达标、O10 PASS、G3 关闭且不重派；验收提交 `5f1d7a4`。该提交自身信息为“G3 未关闭”（提交时点早于验收裁定），验收为其后的独立裁定；本卡/本证据不改写 G3 证据 | 只读引用 + 调度裁定 |
| 谱系 | `c8290db`（G2 收尾）→ `dcb36b8`（G3 R2）→ `5abfd74`（cherry-pick `521a0f0`）→ `5f1d7a4`（§14 证据）→ `b905ac`（卡 v1）→ `daffd90`（v2）→ `ff02f3a`（批准卡 v3） | `git log --oneline` |

## 2. 权威设计取件核对

| 项 | 实测 |
|---|---|
| 设计提交 | `51e2453d4ec19027976f79d22b82cc45b723f900`（`git cat-file -e …^{commit}` exit 0） |
| 文件 | `docs/tasks/HK-AI-07D-RETRY-REQUEUE-DESIGN-2026-11-15.md` |
| 总行数 | **796**（`git show <sha>:<path>` 行数；非空行 618，卡内“796 行”为总行数口径） |
| 锚点 | `§4.11 旧入口封闭与兼容` 在第 **505** 行；`§4.12 HTTP 接线门禁` 在第 **527** 行；§6 G4 门禁行在第 710 行 |
| 取件失败处置 | 若上述对象/行数不符即 BLOCKED；本次取件成功，故继续 |

## 3. 测试设施与独立性声明

- **复用测试设施（已批准）**：`admin-web/tests/face-g3-testkit.mjs` 的
  `installNetworkGuard` / `assertNoLoadTimeViolation` / `restoreNetworkGuard` /
  `getViolations` / `resetRuntimeViolations` / `positiveControlAll` / `guardEntryNames`，
  以及 LocalStore、`setupG3`、`makeEnrollJob` / `makeRevokeJob` 基础构造、独立 oracle 与断言 helper。
- **独立构造兼容 fixture**：G4-04 三场景的旧 queued job、旧 log/audit、
  旧 op key 记录、跨 method op key 与全部断言均在本文件内独立构造；
  **未 import、未复制** `face-g3-ko.test.mjs` 中 O11 的 fixture 构造、预期值与断言文本。
- **guard**：testkit 在业务模块加载前安装 guard（49 个入口，含 ESM 命名绑定）；
  加载期违规为空；正控逐入口 +1 且桩不转发真实函数；`G4-GUARD` 用例实测
  `guardEntryNames().length = 49`。

## 4. 实际命令与结果

工作目录：`admin-web`

```text
node --test \
  tests/face-strict-retry.test.mjs \
  tests/face-g3-testkit.mjs \
  tests/face-g3-psrtn.test.mjs \
  tests/face-g3-ko.test.mjs \
  tests/face-g3-c.test.mjs \
  tests/face-g4-compatibility.test.mjs
```

实测（统一套件）：`# tests 343 / # pass 343 / # fail 0`，cancelled/skipped/todo 均 0，**exit 0**，duration 838.58ms。

逐文件实测（同一命令逐文件重跑）：

| 文件 | tests | pass | fail | exit |
|---|---:|---:|---:|---:|
| `tests/face-strict-retry.test.mjs` | 130 | 130 | 0 | 0 |
| `tests/face-g3-testkit.mjs` | 7 | 7 | 0 | 0 |
| `tests/face-g3-psrtn.test.mjs` | 99 | 99 | 0 | 0 |
| `tests/face-g3-ko.test.mjs` | 73 | 73 | 0 | 0 |
| `tests/face-g3-c.test.mjs` | 17 | 17 | 0 | 0 |
| `tests/face-g4-compatibility.test.mjs` | 17 | 17 | 0 | 0 |
| **合计** | **343** | **343** | **0** | 0 |

G4 文件内 17 条 = 7 条 testkit SELF-CHECK（随 import 运行）+ 10 条 G4 用例。
未运行 `npm test`、未用 glob、未运行任何 HTTP/监听套件。

## 5. G4-01～G4-08 逐项证据

测试文件：`admin-web/tests/face-g4-compatibility.test.mjs`（本提交新增）。

| ID | 证据位置（文件:行） | 断言摘要 | 实测 |
|---|---|---|---|
| G4-01 | `face-g4-compatibility.test.mjs:100` | H3/H4 模块导出键、原型链逐级描述符、原型实例属性均无 `requeue`；`lib/face-service/*.mjs` 剥离注释后无 `\brequeue\b` | PASS |
| G4-02 | `:141` | `FACE_ROUTES` 含 list/reconcile、无 retry id；`matchFaceRoute(POST,…/retry)` 为 null、reconcile/list 命中；`server.mjs` 剥离注释后无 `retry` 标识符 | PASS |
| G4-03 | `:166` | 旧 enroll/revoke queued 形状 + 新 key → `INVALID_STATE/409`；全库零写；result/due/lease 字段原样 | PASS |
| G4-04(a) | `:201` | 旧 queued + 新 key → `INVALID_STATE/409`；拒绝先于 key 写入；`operation_keys` 零新增 | PASS |
| G4-04(b) | `:225` | 旧 job `retryable_failed` + 全新 key → 成功；回执 `R+1`；旧 log/audit 原样；op key 摘要绑定 `{jobId,R}` | PASS |
| G4-04(c) | `:265` | 严格 retry 已用 key（先证明 op key 由严格 retry 创建）改请求 revision 复用 → `CONFLICT/409` 全库零写 | PASS |
| G4-05 | `:290` | 旧 log/audit 哨兵共存零变化；跨 method op key 互不重放/互不影响；成功只新增本方法 1 条 op key；不做扫描迁移/回填 | PASS |
| G4-06 | `:328` | enroll/revoke 两种形状成功；分别通过原 `validateDispatchJob` / `validateRevokeJob`；`leaseGeneration` 与 lease 字段不被 retry 改写 | PASS |
| G4-07 | `:363` | 同键合法重放/ack loss 零写返回同一回执；job 推进后快照稳定；成员 suspended → `FORBIDDEN/403`；回执多字段 → `CONFLICT/409` | PASS |
| G4-08 | 本文 §6 | 对照设计 §4.11 六行、§4.12、O10/O11 与 §6 门禁，列文件/行号与运行证据 | PASS |

说明：G4-04 三场景各自独立用例、独立 fixture、独立断言，未合并计为一条；
`CONFLICT` 只用于严格 retry 实际创建过的 op key 被摘要不同请求复用；
旧 requeue 从未写 `operation_keys`，场景 (a) 明确断言 op key 零新增。

## 6. 设计 §4.11 六行对照与 G4-08 结论

| 设计 §4.11 行 | 要求 | G4 证据 | 结果 |
|---|---|---|---|
| 518 | 旧 requeue queued（H3/H4 形状）→ `INVALID_STATE`，不得回滚/重置 | G4-03 / G4-04(a) | PASS |
| 519 | 旧 queued 日志只作历史，不作 K2 回执、不参与重放 | G4-04(b)（旧 log 原样）/ G4-05（哨兵） | PASS |
| 520 | 旧 audit 不满足新命名空间，不得当成功凭据 | G4-04(b) / G4-05（旧 audit 原样，成功只新增新命名空间 1 条） | PASS |
| 521 | 旧 requeue 未写 `operation_keys`，不得反推/补写 | G4-04(a)（零新增）/ G4-05（异构记录不迁移） | PASS |
| 522 | 旧 job 再次失败进入 `retryable_failed`：新 key 允许重试；旧 key 摘要不同 → `CONFLICT` | G4-04(b)（新 key 成功）/ G4-04(c)（摘要不同 CONFLICT） | PASS |
| 523 | 其他 K2 method 的 op key：method 不同，互不重放、不受影响 | G4-05（跨 method 隔离） | PASS |

- §4.12 HTTP 门禁：本阶段不接线；`FACE_ROUTES` 无 retry、server 无 retry handler、guard 记录 listen 0。
- O10/O11：G3 证据只读引用；本阶段以独立 fixture 重建，未用 G3 日志替代。
- **G5/G6 未满足项**：07B `queryJob` revision 尚未合并；HTTP 编码卡未批准、`routes.mjs`/`server.mjs` 未接线——均不在 G4 范围，继续冻结。

## 7. 零修改与清洁性

| 检查 | 实测 |
|---|---|
| 生产/既有测试零 diff | `git diff --stat 5f1d7a4 --` 为空（本提交前；提交后仅新增 2 个文件） |
| 新增文件 | 仅 `admin-web/tests/face-g4-compatibility.test.mjs` 与本文 |
| 空白错误 | `git diff --check` exit 0；`git show --check` exit 0 |
| 未跟踪杂项 | 无（`status --porcelain=v2` 只列上述两个新文件） |

## 8. 未验证项与边界（不隐瞒）

1. **worker 真实失败路径未验证**：G4-04(b) 以合成 fixture 构造 `retryable_failed`，不等于复现真实 worker 失败。
2. **HTTP/UI 未验证**：本阶段不注册、不启动、不监听；`matchFaceRoute` 负向断言只证明路由描述表无 retry。
3. **真实旧实例未构造**：H3/H4 构造器依赖 LocalStore/Mock 依赖，本文件以原型实例（`Object.create(prototype)`）验证原型链与实例表面，另加模块导出键与源码封闭扫描；未运行旧 requeue 真实调用（入口已不存在）。
4. **07B/G5 未合并、G6 未批准**：均继续冻结，不在 G4 结论内。
5. **未执行安装/迁移/业务测试**：本套件只用 Node 内置模块与本地模块，无第三方依赖。

## 9. 结论

- G4-01～G4-08 **全部具有独立运行证据（PASS）**；统一非 HTTP 套件 **343/343 pass、0 fail**。
- 本结论仅覆盖 G4 兼容/封闭审查；**不宣布 07D 全量关闭、不宣布可上线、不宣布 07B 合并或 HTTP 接线**。
- 最终提交 SHA/父提交：即本证据与测试所在的追加提交（push 后 `ls-remote` 核对，见交付回报）。
- 停手交 Codex 独立复审，不自批。
