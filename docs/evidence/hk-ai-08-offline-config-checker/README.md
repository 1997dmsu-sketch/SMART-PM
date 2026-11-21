# HK-AI-08 离线配置核对器交付证据（2026-11-21）

状态：实施交付记录；合成验证结果见下，独立裁定以提交外的复审结果为准，本文不自批。日期按 Asia/Shanghai。

## 授权、固定输入与范围

- 授权来源：本对话用户在任务卡文档复审通过后明确“开始实现”；只覆盖该离线核对器的实施及合成验证。
- 固定任务卡：`e9e3bbb7c86c96e79d14ddc81fd30ed00a468659` 的 `docs/tasks/HK-AI-08-OFFLINE-CONFIG-CHECKER-TASK-DRAFT-2026-11-21.md`。
- 实现分支：`feat/hk-ai-08-offline-config-checker`；起点为上述完整 SHA。原任务卡的“未授权”是其提交时点状态，本记录登记后续授权，不改写原卡。
- 四文件白名单：`tools/hikvision-offline-config-checker/src/check-config.mjs`、`tools/hikvision-offline-config-checker/cli.mjs`、`tools/hikvision-offline-config-checker/test/check-config.test.mjs`、本证据文件。
- 执行分工：Codex 子智能体分别负责实现和独立测试；根 Codex 整合证据。实现者自检不代替独立复审。
- 本次不修改已批准探针、Store、Provider、路由、server、小程序、manifest/lock、已通过准备卡或模板映射，不安装依赖。

## 交付语义

核对器只判断显式提交的合成配置的格式、数量及本地匹配关系。`PASS/OK` 不证明审批有效性、签字真伪、设备身份、实际进程配置、后续同份配置绑定或设备可用性；不输出 `approvalValid`、`sameConfigBound`。

本轮库与 CLI 验证只使用合成配置。实现不自动读取配置文件、秘密或环境变量；CLI 的配置来源仅为显式 stdin，不从 argv 补齐配置。CLI 的测试通过注入流在同一进程完成，不创建真实 CLI 子进程。原探针不导入、不运行、不接线。

库入口为 `checkOfflineConfig` 与 `checkOfflineConfigJson`；CLI 导出 `runCli` 供注入流验证。纯函数 `isCliEntry` 优先使用布尔 `import.meta.main`，旧 Node 无可用属性时只比较 `argv[1]` 入口元数据与模块 URL，不把 argv 用作配置、不作文件系统查询、不输出路径。旧入口分支只有合成元数据验证，未据此声称已在旧 Node 实际启动 CLI。

## 验证范围与口径

只运行本工具的全合成测试文件，不运行后台、HTTP 或其他已关闭阶段的套件。根 Codex 在实现与测试文件冻结后独立运行的完整命令：

```sh
node --test --test-isolation=none --test-reporter=spec tools/hikvision-offline-config-checker/test/check-config.test.mjs
```

同进程隔离是本工具预定的测试方式，用于避免测试 runner 派生文件 worker；不是失败后的隔离降级。不继承其他工作线的计数。

| 项目 | 根 Codex 实测 |
|---|---|
| 环境 | Linux x86_64；Node `v24.22.1`；无依赖安装 |
| 命令退出码 | `0` |
| 实际测试节点 | `276`，全部通过；14 个顶层 OC01–OC14，子用例另计入总数，不把矩阵 ID 数当测试数 |
| fail / cancelled / skipped / todo | `0 / 0 / 0 / 0` |
| 加载期网络/进程计数 | 所列 97 个实际 guard 槽全部为 `0`，在自检前保存并断言 |
| 业务运行窗口计数 | 所列 131 个实际槽增量全部为 `0` |
| guard 正控与恢复 | 每个实际槽均实触发不转发桩、计数恰好 +1；累计计数不清零，用快照作为业务基线；函数身份、属性描述符与 ESM 命名绑定精确恢复 |

### 原始输出与固定内容

根独立运行的完整原始输出保存在本次云工作区 `/workspace/artifacts/HK-AI-08-OFFLINE-CHECKER-2026-11-21/root-tests.log`，SHA-256 为 `e8fe1a9907d86e37b2ac169317869d5450438c8b406588c3dcfcb5a07a676081`。该绝对路径是本环境取件定位，不保证 Windows 或其他聊天直接可读；原始日志没有作为额外文件加入仓库。以下三个文件的 SHA-256 固定被测源码、测试、内联合成 fixture 与内联 guard；不对本 README 自身预写递归哈希。

| 文件 | SHA-256 |
|---|---|
| `tools/hikvision-offline-config-checker/src/check-config.mjs` | `96d8997258411d2aefe448810b09c12c97a0e03535c448ea4c540ce68026cfab` |
| `tools/hikvision-offline-config-checker/cli.mjs` | `2880f7495b388dbbdc523ac0181ff7fd66b3eaa6e14d0fe49a70fc2053649f2d` |
| `tools/hikvision-offline-config-checker/test/check-config.test.mjs` | `e5da00b7d025b9dc55099dd18e6039f1d3360cd86becd19e97dea97969c9ab3d` |

### OC01–OC14 覆盖对照

| 矩阵 | 实际断言范围 |
|---|---|
| OC01–OC04 | IPv4/IPv6/ASCII DNS 合法输入、trim/lower、精确文本匹配与拒绝地址等价猜测；库/JSON/CLI 共享契约但使用独立固定预期 |
| OC05–OC08 | 三个主机位置的非法形式、IP 式文本禁止回退、允许列表数量/空项、端口语法/范围/匹配、型号精确匹配 |
| OC09–OC10 | 错误优先顺序、布尔类型、闭式数据形状、隐藏/Symbol/访问器、解码后重复 JSON 键；根及嵌套 Proxy（含撤销 Proxy）反射前拒绝、trap 零调用 |
| OC11 | 错误 JSON/UTF-8、多字节分块、16 KiB 精确与 +1 字节边界、单字段合法但总体超限、提前停止拉流、固定内部错误、Writable 异常与临时监听恢复 |
| OC12 | 逐场景输入全量快照/特殊描述符不变、冻结与 null 原型记录、返回对象隔离；九组合成入口元数据，不启动旧 Node 或真实 CLI |
| OC13 | 离线 PASS 不产生审批真实性或后续配置绑定结论，不输出相应字段 |
| OC14 | 加载前 guard、逐入口正控、保留加载期证据、运行窗口零增量与精确恢复；仅证明下述列明入口和窗口 |

### guard 范围及限制

131 个实际槽由 97 个网络/进程槽与 34 个运行期文件读取槽组成。范围包括 fetch；HTTP/HTTPS 请求、取响应和创建/监听服务；net/TLS 连接与服务；UDP 创建、发送、绑定与连接；DNS callback/promise 与两类 Resolver 的可用解析方法、共享控制方法及构造入口；child_process 的 spawn/exec/fork 系列与 `ChildProcess.prototype.spawn`。文件槽覆盖测试文件中列明的 fs 回调/同步/Promise 读取及元数据入口。共享原型槽用别名登记，不嵌套包装，不借别名虚增实际槽数量。

网络/进程 guard 在业务模块动态导入前安装并覆盖加载和业务窗口。fs guard 为避免将 Node 模块加载器误报成配置读取，在业务模块加载后安装，**不声称覆盖模块加载期文件读取**。`process.env` 禁用通过源码复核，不声称有全局环境代理或完整 OS 沙箱。应用源码未导入 fs、DNS、HTTP/HTTPS、child_process 或批准探针；`node:net` 仅使用纯语法函数 `isIP`，不执行连接。

### 检查中发现并修正的事项

- 未知异常对象不作 `instanceof`/反射分类，使用私有 sentinel；所有 Proxy 在反射前拒绝，不能借 trap 修改输入或再抛异常。
- 输出流失败保持临时 error 监听器到本次 Writable 后续事件排空，再精确移除；失败返回 3，不进行第二次输出或打印异常。
- 超大单 chunk 在复制前检查剩余预算；超限不继续拉取后续输入。
- 兼容入口的 `main: undefined` 与属性缺失同义；布尔值优先，其他已定义非布尔值失败关闭。真实运行只覆盖上述 Node 版本；Node 20/其他版本以及符号链接入口未实测。
- 测试 guard 的共享 Resolver 原型槽及继承 listen 快照曾在首轮自检暴露问题，已在最终测试版本修正；这些中间结果不是最终通过证据。

## 未证明项与停止点

- 真实审批有效性与后续配置绑定仍需要各自的受控证据；离线检查不能自证，也不解决 TOCTOU。
- E1 其余准入未齐时仍为 BLOCKED；本次不授权 E1/E2，不连接设备、不上传照片、不查询或删除真实对象。
- S4、预签约 S2–S6、H4-c C2/C3、07B 执行、集成/合并、HTTP/UI、真实支付/退款、生产云及部署发布等冻结边界保持。
- 本阶段只追加提交、普通 push，不改写历史、不改全局/系统 Git 或 TLS，不推 main。
