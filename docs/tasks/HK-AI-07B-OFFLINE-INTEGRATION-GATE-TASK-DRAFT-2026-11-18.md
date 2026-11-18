# HK-AI-07B 离线集成门禁任务卡草案

- 日期：2026-11-18（Asia/Shanghai）。状态：仅任务卡，待独立审批，不授权合并或执行验证。
- 固定拟执行基线：`8ff350d3f6ec41e67cc8d42639f8c37cf96323da`，分支 `docs/hk-face-queryjob-provenance`；直接父 `59a737acf49e249a8e3388867ca605e90a47ca61`，07B 终审通过。
- 参考 main 记录：`282a20fca9f64ab80ead50372c9c3e90bf4aeba7`。获准执行时须重新 fetch 并记录 main 实际 SHA；前移后不能继续把旧无冲突结论当当前证据。
- 独立来源修订 `8ff350d` 仅登记继承的 contentList 变更；此前来源哈希 61/61 已核对，但完整 verify-import 曾因缺 wx-server-sdk 未跑完。

## 1. 可派单目标

可先派独立会话复审本文档。后续明确批准后，建立固定基线的隔离验证工作树，完成依赖/来源/语法/离线回归门禁，给出是否具备另行申请集成的条件；不得实际合并 main、G3、07B 或创建未批准的组合实现。

## 2. 允许范围

- 仅新增 `docs/tasks/HK-AI-07B-OFFLINE-INTEGRATION-GATE-EVIDENCE-2026-11-18.md`，不改生产代码、脚本、manifest、lock、来源登记数据或已验收测试。
- 安装依赖限隔离工作树，优先锁文件与缓存；安装 registry 网络与业务网络区分记录。缺锁文件、native 失败或依赖必须变更时报告阻断，不能用 stub、跳过脚本或修改依赖绕过。
- 若依赖安装/加载会触发业务网络，停止并报告；wx-server-sdk 只验证加载，不初始化真实云、不调用函数/数据库。

## 3. 离线门禁矩阵（获准后执行）

| ID | 验证与交付 |
|---|---|
| IG01 | 输入完整 SHA/父链与 origin ref 一致；记录 Node/npm、依赖目录及锁文件；工作树初始状态 |
| IG02 | 相对已 fetch 的 main 审阅完整差异，确认继承改动也登记；read-only merge-base / merge-tree 分析可合并性，不 git merge/cherry-pick，不以无冲突代替批准 |
| IG03 | 完整运行 `node scripts/verify-import.mjs`，包括来源/变更哈希、语法、所有云函数依赖 require、asset 哈希；报告真实输出数量，不硬编码仅 61 项为全部通过 |
| IG04 | 缺 wx-server-sdk 等依赖时，先依照各目录现有 manifest/lock 安装；再完整重跑 IG03；未完成则明确 BLOCKED，不仅截取哈希循环声称 verifier 通过 |
| IG05 | 07B 定向 face-service + H1 回归，覆盖 module-load guard、篡改探针、逐场景全库零写、六字段 DTO/revision；保留真实 sharp，不降级为 stub |
| IG06 | 明确列出并运行必要非 HTTP 回归及根目录无监听测试文件；全部 code/status 和零写不放宽；实际 exit/计数与隔离方式分开报告 |
| IG07 | 组织停用仍需未来 HTTP 接线门禁，07B 服务层现状不得虚报已修；列出 HTTP/UI、Provider、生产云、真机未验证项及后续 G5/G6 边界 |
| IG08 | 生产、manifest/lock、来源文件均零 diff；检查敏感输出，最终证据文档追加提交、普通 push 和远端一致 |

## 4. 安全且可证伪的验证设施

- 测试与 verify-import 在预载 guard 下执行：禁止监听、业务连接、fetch/http/https、底层 socket/TLS/UDP/DNS；在加载业务模块前安装，并覆盖 ESM 命名绑定。
- verifier 的子进程继承 guard（例如受控 NODE_OPTIONS）；先审脚本及依赖加载行为，正控仅 no-op/sentinel，不转发真实网络。
- 只显式列举非 HTTP 文件，禁止后台 npm test 全量。默认隔离受限时保留错误，降级结果单列，不宣称默认隔离通过。
- 来源校验故意错误摘要的负向控制只在内存/临时副本中执行，不能改已验收来源文件；证明错误确实被捕获。

## 5. 交付结论与停止点

每个 IG ID 给 PASS/FAIL/BLOCKED、文件/SHA/行号/命令。完整 verifier、必要回归和范围核对全通过，才可建议申请下一步集成；建议不等于批准合并。

本次仅草案准备，未安装依赖或重跑门禁。不得派为“合并 07B”任务；不得改 G1/G2/G3 里程碑，不开始 G4/C2/C3、HTTP/UI、Provider/设备/生产云、部署或上线。执行需单独明确批准。
