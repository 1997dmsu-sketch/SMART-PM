# P0-B Node / Windows ACL 接线差距独立静态复审记录（2026-11-23）

## 对象与结论

- **结论：通过，仅限文档静态复审；无剩余 P0/P1/P2 发现或修改要求。** 不证明 Windows ACL、Node 接线或 E1/E2 实测通过。
- 被审文档：`docs/tasks/HK-AI-08-NODE-WINDOWS-ACL-INTEGRATION-REVIEW-2026-11-23.md`，208 行。
- 被审文档 SHA-256：`0ff88b55c9f947b63e8ebfa61bf483d56e830ea5b7c3ceba8254ca9f8ba8a9f0`。
- 对应 A 文档：`docs/tasks/HK-AI-08-E1-CONTROLLED-CONFIG-BINDING-DESIGN-2026-11-23.md`，SHA-256 `1bcbdadb5decc672c7af270254bb108df501335645d9d1884493142a91b4bef1`。
- 起点 `3bb0b95df351ef357aedff6a21a275a19b92b6f2`；最终提交/推送结果由根代理另报，本文不预写自己的提交哈希。

独立只读审阅由 Codex 子智能体 `/root/docfix_independent_review` 完成，根代理整理本记录供本地按固定 Git 版本取件；作者送审正文保留原状态，本记录登记其后结论，不构成业务授权、原生组件批准或设备执行许可。

## 核对范围与收口

- 已逐项核对固定源码事实及引用：先 runProbe 后准备目录/写文件、Windows chmod 不证明 DACL、默认 writeFile 非独占、旧错误分类对新门禁错误的限制、原报告和 console 的敏感输出。
- 已修正文与 NA01 的执行顺序：同步 `CONSUMED → mint → ACTIVE → 唯一 invoke`，不能先创建 live 能力再消费计划。
- core 与 session 分离，未来目录统一为 `tools/hikvision-e1-controlled-runner/`；公开 path/ref/PASS JSON 不铸造私有能力。
- G1 非200/型号无法核验的旧控制流与新增 identity gate 提案分开；G1 失败保留已发生请求事实，后续实际请求增量为0，不冒充整轮零请求。
- 与 A 最终版的私有 session、固定指纹模式、生命周期和停止语义一致；Node 实际写入、完整原生 ACL/对象身份回读及能力不足失败关闭仍需未来单独验证。

## 固定来源与未执行边界

| 固定来源 | 完整 SHA |
|---|---|
| 批准探针 | `558b9c864a4b820e397336200758b143556a4d87` |
| Windows ACL 候选 | `3bb0b95df351ef357aedff6a21a275a19b92b6f2` |
| 离线核对器 | `31f20c9a372c447f142312f6e95e0400372f9ee8` |
| E1/E2 准备 | `ba93485e07fa5ec5ab83dc27ea2943200d38a1f6` |

根代理另核正文的2个固定 GitHub 源链接，分别对应已存在的树/文件；正文路径行号由独立审阅结合本地固定对象核对。链接/文本检查不是代码运行、Windows API 或网络验证。

NA01–NA16 是16个未来矩阵 ID，不是实测通过数。**本轮实际测试、guard、CLI、Node/PowerShell 接线及设备调用均为0。** 独立审阅零修改、零执行、零设备网络；未读真实配置或凭据，不用静态计数代填 Windows 结果。

## 停止点

P0-B 差距复核与拟验收卡交付可关闭，Node adapter 仍未实施；原探针、离线核对器、Windows ACL 候选与其他已审交付物未修改。

本地 Windows ACL 任务沿用既有派单，结果尚待回报，不重复派发或预写 PASS。即使其合成权限预检成功，也不能替代实际 Node writer、运行期资源身份、配置绑定和 E1 执行授权。用户取消隔离网络前置继续有效，其余冻结线不因本文改变。
