# HK-AI-07D G1 旧 requeue 入口封闭实施卡

- 日期：2026-11-16（Asia/Shanghai）。
- 状态：独立实施卡，待执行；完成后停手，交 Codex 独立复审。本卡交付不表示生产代码已修改、G1 已关闭或可上线。
- 目的：移除 `H3MockDispatcher.requeue` 与 `H4MockRevoker.requeue`，封闭缺少无条件权限、K2 与严格重放保护的旧写入口。
- 代码基线：`1155b7ba65991d324fb8b22bb8f7dd87f49428f9`（H4-b 终审）；建议实施分支 `feat/hk-face-legacy-requeue-closure`，独立工作树，从该代码基线开始，不混入其他功能。
- 设计依据：[07D 已通过技术复审的设计](HK-AI-07D-RETRY-REQUEUE-DESIGN-2026-11-15.md) §3 Q7、§4.11、§6 G1；批准范围仅限设计，G1 的具体实施范围由本卡单列。
- 07B：`59a737acf49e249a8e3388867ca605e90a47ca61` 已终审通过，P2 已关闭，尚未合并；该合并门禁不妨碍本卡封闭旧方法，也不因此开放 E06/E07/UI。

## 1. 范围和禁止项

本卡仅实施旧入口封闭及相应测试。移除两处旧方法及其专用代码，清理调用点；优先删除方法，不保留兼容实现、转发、可调用的抛错 stub、actor=null 分支或可绕过的开关。不得仅改名为 `_requeue`、重新导出函数或藏入其他公开类。

允许变更：

| 文件 | 允许范围 |
|---|---|
| `admin-web/lib/face-service/h3b.mjs` | 删除原 `requeue`（基线 444–487 行）及仅由其使用的死代码 |
| `admin-web/lib/face-service/h4b.mjs` | 删除原 `requeue`（基线 482–519 行）及仅由其使用的死代码 |
| `admin-web/tests/face-grant-d-matrix.test.mjs` | 调整依赖旧重排的测试 fixture；新增或复用封闭负向断言 |
| `admin-web/tests/face-h4b.test.mjs` | 同上，保留与重排无关的撤权、租约、清理、finalize 验证 |
| 新增专门封闭测试文件 | 仅用于导出面、实例/原型、旁路及零副作用检查 |
| 本卡对应交付证据文档 | 记录基线、变更、命令/计数、调用点处理、边界与待复审状态 |

发现上述范围外的真实调用方时先盘点并在证据中说明；仅移除其旧调用，不能临时发明替代业务路径。共享 helper 不因本卡而改变语义。无调用点的公共 index 不应产生无理由差异。

明确禁止：

- 不实现新的 `retry`，不写 `face.operation.retry` 的 K2/op key/domain/replay 服务，不改 job schema/validator/state/DTO/权限目录/Store。
- 不修改 `server.mjs`、不注册 HTTP、不接 UI；`routes.mjs` 中 E07 候选描述清理由 Q8 的另一独立小提交处理，不夹带在本卡中。本卡完成不等于整个 G4 兼容/路由清理完成。
- 不修改 07B 生产读模型，不合并其分支，不把“已终审”写成“已合并”。
- 不实现 reconcile/finalize-retry，不开始 H4-c C2/C3，不改 K3 或执行初始化/迁移。
- 不改预约预签约、支付或小程序发布功能，不接 Provider/设备/生产云，不部署、不合并 main。

## 2. 封闭合同

1. 从两种生产模块直接 import 构造器、实例化后，实例及整个原型链均无可调用的 `requeue`；不得仅依靠 index 不导出掩盖直接 import 的入口。
2. 任意 actor（省略、null、普通 user、system）和任意 revision（省略、合法、旧值）都不能进入旧迁移。由于方法已不存在，负向测试可使用属性不存在及尝试调用抛 TypeError 来证明不可达；这不是新增业务错误码，也不得注册 HTTP 后把 TypeError 当错误映射。
3. 不保留以不同名称执行同一旧 `retryable_failed → queued` 写集的旁路，不为测试在生产模块新增 fixture/helper/模式开关。
4. 既有 job、log、audit、operation_keys、domain 数据完全保留；不迁移、不回填、不重置重试预算，不把旧 queued/log/audit 当作未来新 retry 的 K2 成功凭证。
5. 其他已批准动作保留：claim/dispatch、lease fencing/expire、UNKNOWN_RESULT 停留、H4-b revoke/local finalize、资源释放约束都不放宽。封闭人工重排不意味着允许后台自动重试。

## 3. 调用点和测试迁移

基线检索命令：`rg -n 'requeue\(' admin-web/lib admin-web/tests`。已知生产定义两处；测试调用分布于 `face-grant-d-matrix.test.mjs` 与 `face-h4b.test.mjs`。执行者必须重新枚举，给出每处“删除/改为负向断言/改用纯测试 fixture”的对照，不能只报最终 grep 为零。

- 原本验证“旧 requeue 成功”的断言改为入口封闭负向证据，不继续声称旧路径可成功。
- 若后续 dispatch/第四次耗尽/lease 测试需要一个重排后的 queued 状态，可在测试文件内构造合法的既有 queued fixture，并运行原正式 validator。enroll 必须保留原 result/nextAttemptAt，revoke dispatch queued 必须清空两字段；仅构造测试数据，不复制成生产重排算法。
- 不删除包含后续 claim、耗尽、UNKNOWN_RESULT、并发、资源释放等独立断言的整个测试。将这些断言与旧方法调用解耦；保留旧用例标题或给出明确重命名/拆分对应关系。
- 旧路径的权限、revision、到期错误码测试失去调用对象后，应明确改为封闭证据；新的严格权限/CAS/到期合同留给 G2 与 07D 的 90 项矩阵，不能把 G1 负向 TypeError 计作 G2 已通过。
- 不使用跳过、todo、空 test、放宽 validator、禁用失败断言或统计数量来代替语义验证。

## 4. G1 验收矩阵

本表为执行前验收要求，尚未运行。

| ID | 场景 | 必须证明 |
|---|---|---|
| LC01 | 直接 import H3 模块，创建 dispatcher | 实例与原型链无可调用 requeue，未增加替代导出 |
| LC02 | 直接 import H4 模块，创建 revoker | 同 LC01 |
| LC03 | 两实例，省略 actor/null/user/system，缺省/合法/旧 revision | 旧入口不可达，无任何业务迁移 |
| LC04 | 两种 job 的 retryable_failed（到期/未到期） | 调用旧入口不能转 queued；全库前后内容级相等 |
| LC05 | queued/sending/awaiting_result/terminal_failed 等旧 job | 旧入口不能修改状态、attempts、lease、revision 或资源 |
| LC06 | 已有旧 queued/log/audit 数据 | 数据未改写，不新增 op key/domain，不伪造新服务回执 |
| LC07 | 需要 queued 状态的既有测试 | 测试内 fixture 经过正式 validator；两种 job 的相反不变量均保留 |
| LC08 | 既有 claim/dispatch/UNKNOWN_RESULT/expire/finalize/释放回归 | 原约束通过；不增加自动重试或 Provider/设备路径 |
| LC09 | 生产源码、模块导出、公共 index 与调用点盘点 | 两旧方法删除，无别名、兼容封装、隐藏开关或剩余可执行调用 |
| LC10 | HTTP/UI/Store/validator 范围检查 | server/routes/小程序/Store/validator 无修改，未合并其他分支 |

LC03–LC06 每个独立场景必须在动作前后分别保存 `before = structuredClone(store.data)`、`after = structuredClone(store.data)` 并 deepEqual；范围包含 job/log/audit/op key/domain 及全库其他集合。封闭探针独立统计 Provider、私密文件、服务写、业务网络调用为 0；计数 guard 自检不得抹掉模块加载期调用。其他既有 dispatcher 回归可能使用 Mock Provider，须与封闭探针的 0 调用口径分开，不能将全套 Mock 调用统称为 0。

## 5. 执行和交付

在正确代码工作树完成依赖安装后执行并记录实际命令、工作目录、exit 与计数：

```text
# admin-web
node --test tests/face-grant-d-matrix.test.mjs tests/face-h4b.test.mjs
node --test tests/<新增封闭测试文件>.test.mjs
npm test

# 仓库根
npm test
git diff --check
```

新增测试文件命令以实际文件名替换；没有新文件时说明覆盖位置，不执行占位命令。首选默认测试隔离；确有环境 EPERM 时保留失败记录，可补 none 降级证据但不得伪报默认隔离通过。锁文件与依赖清单原则上零差异，不用 stub/native 跳过掩盖依赖问题。

交付证据必须包含：

- 基线/分支/父提交/最终 SHA，逐文件 diff 与调用点处理表；旧测试保留/拆分映射、LC01–LC10 对应证据。
- 定向、Admin 全量、根测试命令/exit/实际计数，内容级零副作用、旁路/敏感字段检查与所有限制。
- 对 `h3a.mjs`、validator/state、`store.mjs`、`service.mjs`、`routes.mjs`、`server.mjs` 与小程序的无差异证明；遇到范围外需要，另立任务，不顺带修改。
- 追加提交，普通 push 并以 ls-remote 核对；不 amend/rebase/squash/reset/force，不改变既有批准提交。交付后停手，等待 G1 独立复审；不自行开始 G2。

## 6. 本轮文档来源与状态

最终 07D 补丁来源提交标识为 `24c626f31e645468f40af653367ae1f9822f985c`；附件 SHA-256 为 `74aedc1c2b3b36285995663730bb5cd85bdb451069ee2907611d561eec95cca4`，正文 796 行，blob `3a628d12f097c3cb6f20fa59a5505dea25631adf`，90 项矩阵。本文档分支以 git am 导入，保留作者与正文；导入后的实际提交为 `51e2453d4ec19027976f79d22b82cc45b723f900`，因本环境 committer 元数据不同，不声称与来源提交 SHA 相同。

本轮只导入已批准设计并新增本任务卡；未运行上述实施测试，未改生产代码。本卡的实际发布提交、普通推送及远端核验 SHA 见交付回报。
