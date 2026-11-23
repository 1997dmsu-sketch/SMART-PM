# HK-AI-08 CR-2 前置报告独立复审与技术裁定记录（2026-11-23）

## 1. 结论与范围

前置报告 `1d726020756460ffb368dd2f92b895306c3243b4` **有条件通过**。17 项来源一致，G1–G7 属 CR-2 接续工作，不重开 CR-1；原报告仍需下表三项文本勘误，不能因本补充已解释而冒称原文已经修正。

Codex 的 [接口技术裁定与实施范围补充](../../tasks/HK-AI-08-CR2-INTERFACE-DECISIONS-2026-11-23.md) 已经三路文本复审通过，无残余技术文本修改要求。正文共 175 行，SHA-256 为 `f6db10df57e2781821be6bd3f5d7f76bf589c5bf21df855c28ec31eb6c7e5a58`。该结论不等于 CR-2 实现验收或任何真实执行授权。

## 2. Git 与来源证据

- 对象 HEAD 为 `1d726020756460ffb368dd2f92b895306c3243b4`，直接父为 `2712ea7866377d889a78e413fcb7de420b9ad1ab`；该对象仅新增原报告与 SOURCE-INVENTORY 两文件，435 行。
- 原报告 blob：`5febeb7acf208e86be228ba5575f0a203cfcc485`，29618 字节、220 行；SOURCE-INVENTORY blob：`a5521fd3f434e9732b7af506cbb0c1d6d110136d`，9061 字节、215 行。
- 复审时 `git ls-remote origin` 实际确认：`docs/hk-ai-08-cr2-integration-preflight` 为 `1d726020756460ffb368dd2f92b895306c3243b4`，`feat/hk-ai-08-e1-controlled-runner` 为 `2712ea7866377d889a78e413fcb7de420b9ad1ab`，main 为 `282a20fca9f64ab80ead50372c9c3e90bf4aeba7`。
- 逐条以 `git show <commit>:<path>` 原始字节复算并比较 commit/path/blob/字节数/SHA-256，17/17 一致；未用文本重定向后的副本代替原 blob。
- 原报告第 1–220 行和 inventory 全部条目已读；按其定位检查 CR-1、六探针、checker、原卡与 A/B 固定源码/文本。组合 22 个导出中，CR-1 新增模块为 20，外部 checker 为 2。
- 技术裁定中的五个固定 SHA 文件链接已通过本地 Git 对象解析；这不宣称独立 HTTP 可达性检查。
- 本次复审在独立文档 worktree 进行。主工作树 `/workspace/SMART-PM` 的 HEAD 仍为 `0af1b4c700319952d78f8312a46e7d1036b631b3`，跟踪及未跟踪状态均无变化。

## 3. 原报告须回写的三项

| ID | 级别 | 原报告行 | 发现与要求 |
|---|---|---|---|
| CR2-PF-01 | P2 | 198 | G7 把已有生命周期事件写成止于 ACTIVE。保留现有 COMPLETED/FAILED/UNKNOWN/INVALIDATED 和会话 MEMORY_WRITE/MEMORY_READ/SEALED/CLOSED/FAILED 事实，仅列缺少请求窗口编排事件及组合证据 |
| CR2-PF-02 | P2 | 148、196 | §3.5 与 §4 的 G5 含义冲突。以 §4 为准：G5 只指 identityConfirmed；raw body/DTO 接线归 G2/G6 |
| CR2-PF-03 | P3 | 5、218 | Git 网络和共享元数据写入已经发生，不能统称只读或零网络。“零”限定为项目代码/测试/业务网络/设备等实际未执行项 |

三项为 Harness 文档回写范围，须在原分支追加提交；SOURCE-INVENTORY 及 CR-1 不改。本轮未替执行者回写原报告，也未生成 Harness 派单编号。

## 4. 技术裁定的复审收口

采用单一私有 owner，原 controller/session 成为兼容 facade；新工厂仅在合成 profile 内调用固定 P，既有入口、DTO、原测试和 guard 原字节冻结。禁止导出 binding/session、任意 adapter 或重写 probe loop。D1–D7 具体要求、场景 schema、三种 submission、唯一 invoke、私有 writer、identity、ref、trace、精确 5 改动＋9 新增文件范围均以链接正文为准。

| 独立审阅者 | 发现与处理 | 最终结果 |
|---|---|---|
| `/root/cr1_core_impl`，可实现性 | CR2-API-01：缺少报告封存故障的可达数据入口；CR2-API-02：缺少确定在途窗口。已在正文 L50/L118 固定 prepare 八故障与消费后微任务边界；随后核对 L82/L117/L163 | 通过，两项关闭 |
| `/root/cr1_security_review`，安全边界 | CR2-SEC-01 与 API-01 是同一缺口，合并处理；核对合成/真实入口隔离、封闭输出和终态事实，后续核对 submission 三行 | 通过，无新增实质问题 |
| `/root/e1_task_contract_audit`，契约对齐 | 指出“提交已知”不能推出“结果已知失败”。正文 L82/L117/L163 明确 CONFIRMED_SUBMITTED 未取得完整结果仍 UNKNOWN＋黏性 true，TIMEOUT/RESPONSE_ERROR 必测，NOT_SUBMITTED 不清零已发生计数或先前未知 | 通过，该项关闭 |

以上审阅者未撰写技术裁定正文，各自只读核对。最终均核对正文 SHA-256；可实现性/安全审阅先完整读稿，再对最后三行作增量收口，契约审阅覆盖最终变化。本文由根 Codex 汇总，不能当作实现执行日志。

## 5. 实际执行与停止点

- 本轮执行的是 Git 取件/对象查询/远端查询、源码和文档静态阅读、原始字节哈希/链接解析，以及本次两份新文档的追加交付；未修改原报告、inventory、CR-1 实现或既有验收记录。
- 本轮 Node/项目代码/测试/guard/构建/项目 CLI/PowerShell 预检、业务网络和设备调用均为 0。历史 262/262 只是已验收 CR-1 的既有事实，不是本轮复跑，不替代未来 CR-2 新树的运行证据。
- Windows ACL 工作只等待既有任务回报，不重派；交付方完全访问环境自述不构成本会话权限或业务授权。用户取消隔离网络前置保持有效。
- 未实际派发 Harness、未启动 CR-2 实现；后续执行若获准，须按最终技术裁定的固定代码基线、白名单、停止点实施。CR-3/E1/E2 及其他冻结线不因本文放行。
