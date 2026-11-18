# HK-AI-07D G4 兼容与封闭审查任务卡草案

- 日期：2026-11-18（Asia/Shanghai）。状态：任务卡准备完成，待独立审批；不授权执行 G4。
- 固定拟执行基线：`5f1d7a409847bc78d860963f13b45358fac7b5d6`，G3 候选验收通过，90 ID 达标、O10 PASS。
- 权威设计：`51e2453d4ec19027976f79d22b82cc45b723f900` 的 `docs/tasks/HK-AI-07D-RETRY-REQUEUE-DESIGN-2026-11-15.md`，跨分支只读引用。
- 里程碑：G1 原验收 `4f9c43d`、补充证据 `2054404`；G2 验收 `b3a41ea`、收尾 `c8290db`；E07 独立清理 `521a0f0` 已引入 G3 候选。较新的 G1 补充证据仅只读引用，不混入候选。

## 1. 可派单目标与前置

本卡可派给新的审查会话做卡片独立复审；只有本卡后续获明确执行批准，才从固定基线新建独立审查工作树与结果分支。不得把“创建本文档分支”理解成 G4 已启动。

G4 目标：独立证明旧 requeue 入口、旧 queued/result/log/audit 不会被当作严格 retry 的新 K2 成功；历史记录不迁移、不回填、不重写，HTTP 仍关闭。G3 的 O10/O11 证据可追溯，但不能免除本阶段独立复核。

## 2. 拟执行范围与禁止项

- 允许：新增 `docs/tasks/HK-AI-07D-G4-COMPATIBILITY-EVIDENCE-2026-11-18.md`；如静态证据不足，可新增 `admin-web/tests/face-g4-compatibility.test.mjs`（仅合成 fixture）。
- 不改任何既有生产文件、validator、Store、schema、G1/G2/G3 已验收测试或设计。若发现缺陷，给最小复现并停止该项，另立修复任务。
- 不合并任何分支，不注册路由，不开启 HTTP/UI、Provider、设备、生产云、支付或定时任务。不实施 C1/C2/C3，不改 K3。

## 3. 独立审查矩阵

| ID | 必须证明 |
|---|---|
| G4-01 | H3/H4 原型链与公共导出面不存在旧 requeue 方法、别名、兼容 stub 或绕过入口；静态与运行时证据对应 |
| G4-02 | server 无 retry handler；routes 无旧 retry 描述，list/reconcile 描述与现有导出保持；E07 七行清理不等于 HTTP 接线 |
| G4-03 | enroll/revoke 两种旧 queued 形状在新 key 下均 INVALID_STATE/409，全库零写，旧 result/due 语义不被修改 |
| G4-04 | 旧 log/audit 的 ID、action、缺失 op key 不能反推/补写新成功回执；成功凭据只来自新 method/domain/确定性审计与精确回执 |
| G4-05 | 旧历史记录作为哨兵与正常 retry 共存，除本次合法写集外，所有集合历史内容、排序与计数零变化；不做扫描迁移/回填 |
| G4-06 | 两种 job 相反 queued 不变量均保留，成功后分别通过原正式 validator；旧 worker lease/fence 不被 retry 采纳或改写 |
| G4-07 | 同键合法重放、ack loss、job 已推进后的原快照语义不因兼容处理而变化；权限撤销/损坏凭据仍 fail-closed |
| G4-08 | 对照批准设计 §4.11、§4.12、O10/O11，列出所有结论的文件/SHA/行号/运行证据及后续 G5/G6 未满足项 |

每条独立场景采用 before/after structuredClone(store.data)，失败/重放全库 deepEqual；错误同时断言 code 与 status。成功用例验证完整预期写集和其他集合不变，不用只检查记录数代替内容断言。预期 ID 使用冻结公式或固定向量独立推导。

## 4. 执行与证据（获准后才生效）

- guard 在业务模块加载前安装，覆盖已验收的网络入口，包括 ESM 命名绑定；正控不转发真实函数，业务违规不可被清零掩盖，结束恢复身份与描述符。
- 只运行显式列出的非 HTTP 文件：原 G2/G3 五文件、批准后新增的 G4 测试及核实无监听的必要回归。不得 npm test 全量或用 glob 引入监听套件。
- 如审批允许引用固定基线的 G3 testkit，标明“复用测试设施、独立构造兼容 fixture”；不能把已通过的 G3 日志直接复制为本阶段实测。
- 交付实际命令、目录、exit、计数、负向控制、矩阵逐项证据、生产文件零 diff、git diff --check、最终 SHA/父提交、普通 push 与 ls-remote。
- 最终结论分 PASS/FAIL/BLOCKED；交付后停手等 Codex 独立复审，不自行宣称 07D 全量关闭或可上线。

## 5. 当前停止点

本次仅新增任务卡草案，未执行上述审查或测试。G4 执行、main/07B 合并、HTTP/UI、部署与上线继续冻结。批准本卡不自动批准后续集成或接线。
