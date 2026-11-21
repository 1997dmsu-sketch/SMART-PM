# HK-AI-08 Codex 便携包离线复现记录（2026-11-21）

状态：**本轮离线复现已执行，交独立复审；Windows 未执行。** 本文记录执行事实，不自批，不增加新功能或放行真实设备。

## 1. 授权、对象与执行者

- 用户在准备包交付后明确“先由你来实现”，本任务执行者由计划中的 Harness 改为 Codex；本轮直接执行既有离线复现任务，不要求用户再创建 Harness 会话，不伪造 Harness 派单编号。
- 新报告分支：`docs/hk-ai-08-codex-offline-replay-report`，起点/直接父固定为 `ba93485e07fa5ec5ab83dc27ea2943200d38a1f6`。
- 批准实现固定为 `31f20c9a372c447f142312f6e95e0400372f9ee8`；原实现、测试、交付 README、两份准备卡均保持不变。本轮仓库只新增本文。
- 执行范围：在当前云端 Linux 中从已交付 ZIP 全新解压，核对 manifest 和 Git 字节，运行唯一合成测试文件，记录执行前后字节与原始输出。没有运行原探针、真实 CLI、HTTP/后台套件或任何 E1/E2 设备动作。
- 用户已明确“不需要隔离网络”；本轮不恢复该前置，也不把当前网络说成已隔离。此项不扩展为真实设备连接或照片写入授权。

## 2. 取件与完整性

| 对象 | 固定值或实测 |
|---|---|
| 输入 ZIP | `HK-AI-08-Harness-Preparation-2026-11-21.zip` |
| ZIP 字节数 / SHA-256 | `43386` / `e71a8b77bf6d5016d152acec795e7169c5575e7ad13919416a2d9ce0bacdb91d` |
| manifest SHA-256 | `2f7e1ce7e4aa632bad2253d6da7233f9069b6027716c1071de416f64e8746f2b` |
| 清单 | 七项内容文件 + manifest，共八个唯一文件；名称按固定允许集合匹配，非目录/符号链接，无绝对路径或父目录跳转 |
| 来源核对 | 四批准文件分别与实现提交、准备提交的 Git blob 相同；两准备卡与准备提交相同；参考日志与原固定 SHA-256 相同 |
| 解压及执行后 | 全新目录，不覆盖旧文件；八文件字节数与 SHA-256 在执行前后逐项完全相同 |

| 批准文件 | 本次前后相同的 SHA-256 |
|---|---|
| `src/check-config.mjs` | `a8dbde46942aca550e13fdddb27e93bd5c9d1902e8cbdfb09cb31befc0eecfb7` |
| `cli.mjs` | `e6c59224a3b8cacf8e30198363eefd255dc2925fbcc116e3be652c4d3b35e185` |
| `test/check-config.test.mjs` | `66175ee2db3159db1f349bd4bdbe02fe0a284ac7487fde93eb6da2f79d74d972` |
| 交付 `README.md` | `fc659f7cf731643330d84dd9b50e9549264fa8161ffef095c344fb3080676e6d` |

前三行路径均位于 `tools/hikvision-offline-config-checker/`，README 位于本证据目录。全部八文件的执行前后字节数/哈希见本轮 `metadata.json`，没有用摘要或 JSON 丢键替代原字节比较。

## 3. 启动门禁差异及中间结果

旧 Harness 卡要求 `NODE_OPTIONS` 或 `NODE_PATH` 任一存在就停止。本轮最初确实在套件启动前因此停止。后续仅检查名称存在性：`NODE_OPTIONS` 不存在、`NODE_PATH` 存在；没有读取、打印这些变量的值，也没有清空或改写变量、全局配置或 TLS。

根 Codex 使用 `cloud-environment:cloud-environment-runtime` 技能核对当前运行环境；没有请求或应用环境配置变更。针对此任务，独立只读复核先确认固定四文件只使用 `node:` 内建模块和明确相对 ESM 导入，无 `require`、`createRequire`、裸包或自定义 loader。相对 ESM 不使用 `NODE_PATH`，该变量本身不执行预加载，因此允许在环境原样、`NODE_OPTIONS` 仍不存在、固定 Node 24.22.1/命令/guard 都不变的精确范围内继续。这是本轮 Codex 的技术方案差异，**没有逐字执行旧 Harness 启动流程，也没有修改或泛化其门禁**。不据此证明整个进程或操作系统没有任何环境影响。

首次真正启动的套件输出为 285 pass、0 fail，但取证辅助脚本把 Node 的 `ℹ` 摘要前缀当作非单词字符，解析失败，辅助脚本退出 1；测试进程退出码在解析前未持久化，因此不从该次日志反推其退出码。该次 stdout/stderr 原样保留在工件根目录，不覆盖、不混入最终证据。随后只修正工件辅助脚本，改为先保存进程退出码再解析既有摘要格式；重新从 ZIP 解压到 `attempt-2` 并完整复跑，得到下节结果。批准的四文件、测试预期和 guard 均未修改。

## 4. 最终实测

| 项目 | 本次实际值 |
|---|---|
| 时间（Asia/Shanghai） | `2026-11-21T13:56:26+08:00`，开始/结束同秒；非旧日志时间 |
| 系统 / 内核 / 架构 | Linux / `6.18.57` / `x86_64` |
| Node | `v24.22.1`；版本与帮助命令均成功，固定测试参数受支持；未安装或升级依赖 |
| 测试退出码 | `0`，在摘要解析前写入 `execution.json` |
| 测试总节点 / pass | `285 / 285` |
| 顶层 ID | `OC01`–`OC14`，共 14；不是 285 个矩阵 ID |
| fail / cancelled / skipped / todo | `0 / 0 / 0 / 0` |
| guard 实际槽 | `131 = 97` 网络/进程 + `34` 运行期文件读取 |
| 加载期 / 业务窗口 | 业务模块动态导入期间的 97 槽计数全部 `0`；正控后业务增量 `0` |
| 正控 / 恢复 | 保留逐入口不转发正控、累计基线和最终断言；函数身份、描述符和 ESM 绑定精确恢复检查随套件通过 |
| stderr | `0` 字节 |
| 包内八文件 | 执行前后全部相同 |

命令在新解压目录中启动，未从 Git 工作树直接运行测试：

```sh
node --test --test-isolation=none --test-reporter=spec tools/hikvision-offline-config-checker/test/check-config.test.mjs
```

同进程模式是批准方案；根工具启动 Node 测试主进程，不等于允许业务创建真实子进程。guard 的“零调用”仅限既有清单与窗口：文件 guard 在业务模块加载后安装，不覆盖加载期 fs；环境禁读是源码边界，不是全局运行时环境代理或 OS 沙箱。

## 5. 可复核工件

本轮云工作区根定位为 `/workspace/artifacts/HK-AI-08-CODEX-PORTABLE-REPLAY-2026-11-21/`；最终证据位于其 `attempt-2/` 子目录。该路径不是 Windows 本地路径，跨聊天应使用本次交付的证据包下载，而非假定路径共享。原始工件未增加为仓库文件。

| 最终文件 | 字节数 | SHA-256 |
|---|---:|---|
| `metadata.json` | 8937 | `05caa0c56574950611409f53ad805588f9b71f67946007e2ddd0ac181acd6d92` |
| `execution.json` | 287 | `a74468431a8d3fad9eb607280fdda6c3c19c2c4dfd96873faaf745dd52fe8217` |
| `replay.stdout.log` | 17635 | `57a492b8c735444bb586f5054e3075e5d229b1ecb4cbe71e245f571ffcf9be3e` |
| `replay.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

第一轮未完成摘要取证的 stdout 为 17642 字节、SHA-256 `216ae6d3d12efc1a799258554ad6201456af000fad2e1deba245ee8c4e56849e`，stderr 为 0 字节。它与原实现交付的基准日志、此次 `attempt-2` 日志分别保存，不冒充彼此。

## 6. 结论边界及停止点

- 本次实际验证了**同一 Linux/Node 版本下从便携包重新执行**，不是新系统或跨 Node 版本验收。测试耗时造成日志字节/哈希不同属独立运行事实，不要求与基准日志哈希相等。
- 当前没有 Windows、PowerShell 或 Wine；Windows/PowerShell 执行仍为 `NOT_EXECUTED`，未证明 Windows 重定向、ACL、真实 CLI 或旧 Node 行为，也不将报告伪称 Windows 报告。
- 离线核对器实施已在 `31f20c9` 交付；本次没有新增生产代码或重开其验收。输入全部为批准合成 fixture，不读取真实配置/凭据，不连接设备、不上传照片、不创建人员或下发权限。
- E1/E2 的真实审批、目标/证书/权限及同份配置绑定等证据仍需各自补齐，离线 PASS 不产生 `approvalValid` 或 `sameConfigBound`，不解决 TOCTOU；取消隔离网络前置不改变这些事实。
- S4、预签约 S2–S6、H4-c C2/C3、07B 执行、集成/合并、HTTP/UI、真实支付/退款、设备/生产云操作及部署上线仍未在本轮启动。只追加本报告并普通推送，不推 main，不改全局 Git/TLS 或历史。

本报告及原始证据交独立只读复核；本文不预填自己的提交 SHA 或远端核验结果，提交/普通推送后由根代理另行报告。
