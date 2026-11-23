# HK-AI-08 CR-1 纯合成核心实施与验收证据

状态：**CR-1 实施及合成证据独立复审通过，停在 Stop-CR1；CR-2 未启动。** 本记录不声称 Windows/native、真实 Node writer 或 E1/E2 通过。

## 1. 授权、版本与变更范围

- 用户在实施卡交付后明确“继续推进”；根 Codex 按已说明的 CR-1 纯合成范围实施。卡内“尚未授权”是卡片送审时点，不改写其历史，也不扩展为 CR-2/CR-3 或真实动作授权。
- [实施卡固定提交](https://github.com/1997dmsu-sketch/SMART-PM/blob/0dc4433a06eff3f15f164e465257a77c709e73b9/docs/tasks/HK-AI-08-E1-CONTROLLED-RUNNER-IMPLEMENTATION-TASK-2026-11-23.md)：`0dc4433a06eff3f15f164e465257a77c709e73b9`。
- 实现分支 `feat/hk-ai-08-e1-controlled-runner`，直接起点 `4df33305d488df2797cea4c3d2b286db7d8daa2c`；A 同该起点，B 固定 `e6995bcb4dd9943df9745604bfcca7c4d7ea8890`。本轮未合并这些文档线。
- 只新增任务卡 CR-1 白名单内 11 个工具/测试/说明文件和本记录，共 12 文件；既有 checker、Windows 候选、P0 设计及其他跟踪文件零修改。CR-2 的 vendor/probe-binding/测试均未创建，原探针未导入或运行。
- 真实入口仅 `executeControlledE1(input)`：安全捕获后因没有真实审批核验固定拒绝 `APPROVAL_UNVERIFIED`，不执行 checker 后续门禁、创建 session 或 transport；不安全结构固定拒绝。额外 Boolean/ref/PASS JSON/任意 callback 不产生真实能力。
- 合成 controller 与 evidence model 明确标记 `cr1-synthetic-only` / `synthetic-memory-only`，只用闭式数据/枚举及私有 WeakMap，不接受任意 source/clock/native/writer/transport 回调。真实 index 不导入该合成 controller。

## 2. 最终实测及运行边界

| 项目 | 实际记录 |
|---|---|
| 最终执行时间（Asia/Shanghai） | `2026-11-23T14:49:43+08:00`；开始/结束同秒 |
| 环境 | Linux `6.18.57` / x86_64；Node `v24.22.1` |
| 正式结果 | **262/262 测试节点通过，3 suites；退出 0** |
| fail / cancelled / skipped / todo | `0 / 0 / 0 / 0` |
| 静态顶层声明 | 53（plan 22 / session 19 / DTO 12）；不是 262 个矩阵 ID |
| 每套 guard 实际唯一槽 | **232＝92 network＋8 process＋132 运行期 fs**，三套诊断均相同，完整名称清单在 stdout/execution |
| 加载期 / 业务窗口 | 加载前网络/进程 100 槽全部 0；逐槽不转发正控后保留累计基线，成败业务窗口零增量断言通过 |
| 正控 / 恢复 | 包裹入口实际调用、计数 +1；真实 target 插槽临时换安全 canary、断言零转发并还原；函数身份/描述符/ESM 绑定精确恢复断言通过 |
| stderr | 170 字节，Node `DEP0176` / `fs.F_OK` 弃用警告；原样保留，未加抑制/trace 参数，不写成空 stderr |
| 源码前后 | 11 文件及固定 checker 共 12 项逐字节/哈希一致；未读真实配置/秘密，设备请求 0 |

唯一正式命令在实现工作树运行，没有执行 npm、HTTP 套件或其他已关闭阶段：

```sh
node --test --test-isolation=none --test-reporter=spec tools/hikvision-e1-controlled-runner/test/controlled-plan.test.mjs tools/hikvision-e1-controlled-runner/test/evidence-session.test.mjs tools/hikvision-e1-controlled-runner/test/public-result.test.mjs
```

同进程模式是卡中明确方案，不冒充默认进程隔离通过。三份 suite 的业务导入都位于 guard 安装后；同进程后续导入可命中 ESM 缓存，不称为跨进程/跨系统复现。运行期 fs guard 在模块加载后才安装，**不证明加载期 fs 零读取**。根工具启动 Node 及在进程外写取证文件，与被测业务发起子进程或文件数据 I/O 分开；业务 guard 的零调用不等于 OS 无任何 I/O。

### 2.1 NODE_PATH 的本次精确技术例外

环境只检查名称存在性：NODE_OPTIONS 不存在、NODE_PATH 存在；未主动读取/打印变量值，也未清空变量或更改全局配置。独立安全审阅者对本轮完整 10 个 `.mjs` 与固定 checker 导入闭包重新核对：只有 `node:` 和明确相对 ESM，无裸包、require/createRequire、自定义 loader 或自动 CLI。

在最终固定清单、上述唯一命令、Node v24.22.1、环境原样且 NODE_OPTIONS 仍不存在的精确范围内，独立技术复核允许继续；相对 ESM 与 `node:` 不使用 NODE_PATH。此例外不是沿用 R 的旧豁免，不泛化到其他模块、命令、版本、Windows 或整个 Node/OS 的环境行为。原始退出码先保存，再解析摘要。

首次实现版本已实测 262/262（`attempt-1`）；之后只在三个原有 guard 测试各增加一个 context 参数和一条无秘密诊断，未改 oracle、导入或数量。逆转这三处诊断后哈希精确等于旧版，独立复核后重新运行得到本节最终结果（`attempt-2-final`）。两次原始输出分别保留，不混用源码清单。

## 3. 源矩阵映射及未闭合范围

下表 P/S/D 分别指 [plan 测试](../../../tools/hikvision-e1-controlled-runner/test/controlled-plan.test.mjs)、[session 测试](../../../tools/hikvision-e1-controlled-runner/test/evidence-session.test.mjs)、[DTO 测试](../../../tools/hikvision-e1-controlled-runner/test/public-result.test.mjs) 的本次固定文件行号。PASS 只指所列 **CR-1 子判据**；完整源 ID 的组合验收本阶段均不计 PASS，仍为 **BLOCKED**。未获准/无环境的部分只登记，不造 skip/todo/恒绿占位测试。

### 3.1 A：20 个父 ID / 21 行

| 源 ID | CR-1 子判据 / 定位 | 本阶段结果；仍缺的完整组合证据 |
|---|---|---|
| T01 | 一次复制、固定 checker、false 副本、全量/属性快照；P:96、360 | PASS；真实受控来源/执行组合未验 |
| T02 | 真实入口拒布尔/ref/digest/callback，模拟拒失效控制；P:120、145 | PASS；不证明有权审批真实性 |
| T03a | 输入对象变更不能换封存副本；P:160 | PASS；未改真实 env/配置文件或执行真实 runner |
| T03b | invalidate / freshness 使旧模型失效；P:179 | PASS；权威配置/撤销来源接线未验 |
| T04 | 普通/ref/clone/另一模型不能认领身份；S:141 | PASS；未启动另一进程或真实能力传递 |
| T05 | 手写规范化 oracle、清单/端口不匹配拒绝；P:196、254 | PASS；消费后真实 probe config 未生成 |
| T06 | 双方型号同带空白仍拒 runner；P:278 | PASS；未解析真实设备型号 |
| T07 | 显式 bounds、凭据/pin/TLS/CA 形状；合法边界及重复 pin 依固定 P 归一化；P:220、238、295、312、329 | PASS；真实批准 pins/bounds 来源及绑定未验 |
| T08 | 缺 native bridge 固定 not-ready，PASS/ref/callback 不铸能力；S:92 | PASS；实际 gate/Windows 仍缺 |
| T09 | 跨 plan/model、未封存/已关闭状态拒绝；S:141、207、260、395 | PASS；真实 SID/tool/资源身份未验 |
| T10 | 三类内存预检故障终态及零 invoke；P:399、S:189、222、237 | PASS；真正 Node 写/读/清理未验 |
| T11 | 微任务准备后过期/撤销/新鲜性再核；P:419 | PASS；真实授权/时钟机制未验 |
| T12 | 起点含/终点不含、回退或未知时钟；P:442、518 | PASS；受控现场时钟未验 |
| T13 | 双消费者一胜、确认绑定、失败/未知不退还；P:457、480、497 | PASS；未进入 probe/mint 真实网络能力 |
| T14 | 固定 probe / Digest / 六端点实际编排 | BLOCKED（CR-2 未启动） |
| T15 | G1 身份门及请求方法/路径/顺序/TLS 组合 | BLOCKED（CR-2 未启动）；S:353 只验证内存记录 ID/attempt |
| T16 | 原 loop 捕获新码继续时 wrapper latch | BLOCKED（CR-2 未启动，不仿造 loop） |
| T17 | 模型 READY/ACTIVE 失效后拒写；P:179、S:438 | PASS 子判据；在途真实请求未知/停止未验 |
| T18 | 内存 write/read 故障保留记录并 latch；S:335 | PASS 子判据；GET 后 writer/后续 transport 组合未验 |
| T19 | 闭式 DTO、恶意属性、计数保留、E14、未知事实与成功限制；D:90–357 | PASS；原 probe report/raw 的真实组合尚未接入 |
| T20 | 232 槽正控/恢复及本记录 N1–N5；三个 CR1-GUARD 测试 | PASS 子判据；真实 probe/writer 联动负控留 CR-2/CR-3 |

### 3.2 B：NA01–NA16

| 源 ID | CR-1 子判据 / 定位 | 本阶段结果；仍缺的完整组合证据 |
|---|---|---|
| NA01 | 明确标记 SIM 的 READY/消费/票据/ACTIVE 顺序；S:117、P:457 | PASS 子判据；真实 Node/native/唯一 probe invoke 未验 |
| NA02 | native 不存在固定拒绝，历史 PASS 不替代；S:92 | PASS 子判据；未执行 Windows/native 路径 |
| NA03 | 内存 endpoint/attempt 键独占、重复写不覆盖；S:320 | PASS 子判据；既有真实文件/ACL 零变化未验 |
| NA04 | 重解析点、原生对象身份变化 | BLOCKED（CR-3） |
| NA05 | SID/真实执行人身份 | BLOCKED（CR-3）；计划对象同一性仅为 S:141 的子判据 |
| NA06 | 原生 DACL/ACE/扩权 | BLOCKED（CR-3；未重跑 W 工具） |
| NA07 | 真正 Node 创建后的自然继承/ACL | BLOCKED（CR-3） |
| NA08 | 内存预检/write/read、字节边界和终态；S:222、335、374 | PASS 子判据；真实 flush/close/reopen/ACL 未验 |
| NA09 | 模型计划失效即拒后续内存写；S:438 | PASS 子判据；实际请求间 ACL/句柄变化未验 |
| NA10 | 原 probe 新错误后继续 loop 的实际 wrapper 阻断 | BLOCKED（CR-2） |
| NA11 | 内存固定 endpoint/attempt；S:353 | PASS 子判据；六 GET / G1 / 401 编排及请求提交事实未验 |
| NA12 | opaque 身份、一次全局 claim/ticket、跨模型/故障后重认领、非法阶段终态；S:141–298、395 | PASS 子判据；真实存活资源能力未验 |
| NA13 | 响应元数据/DTO 隐藏键、Symbol、getter、Proxy 零执行；S:459、D:139–357 | PASS 子判据；实际受保护 raw body 落盘未验 |
| NA14 | 内存清理故障不标成功，既有记录事实保留；S:423 | PASS 子判据；真实文件/未知子项受控清理未验 |
| NA15 | 三套加载/运行 guard 及 N1/N2 | PASS 子判据；CR-2/CR-3 新导入树和 Windows 仍需重验 |
| NA16 | 真正 Node/native 对照 .NET 替身 | BLOCKED（CR-3） |

37 行映射不是 37 个已通过需求，也不与 262 节点或 53 顶层声明相加。CR-1 的阶段通过只覆盖获准纯合成范围；生产入口持续失败关闭，既有 285/285 核对器结果不借作本次计数。

## 4. 五项安全负向控制

每项先复制最终 11 文件与固定 checker 到工件新目录，再只改一个明确片段，用同一三文件命令执行。独立审阅确认每棵复制树只有指定单点变异，无新导入/原生调用。**原工作树从未修改，因而没有“还原原源码”的动作**；前后逐项对最终清单一致。

| 负控 | 单点变异 | 实际结果 / 精确判据 |
|---|---|---|
| N1 | guard 先调用 `record.target` 再抛相同错误；正控时 target 已临时换安全 canary | 退出 1，`no forwarded target call: http.request`；53 项 cancelled、0 正文通过。前置自检阻断，不触真实 target，不冒称 53 个断言失败 |
| N2 | guard 计数增量从 1 改 0 | 退出 1，`real counter delta: http.request`；53 项 cancelled、0 正文通过 |
| N3 | session 非法阶段只抛错、不 trip/latch | 262 节点中 256 pass / 6 fail，退出 1；FAILED/后续拒写等真值预期抓住退化 |
| N4 | DTO fallback 把未知标记固定 false | 262 节点中 251 pass / 11 fail，退出 1；原命名用例及 `false !== true` 证实未知事实不得降级 |
| N5 | DTO 添加固定合成 debug 字段 | 257 节点中 181 pass / 76 fail，退出 1，额外字段被精确 shape 断言抓到；父用例早断，部分动态子用例未生成，不补成 262 |

N1/N2 是 before 正控失败使测试正文取消，正式套件的 cancelled 仍为 0。所有负控均不是语法/模块导入失败。N4 最初汇总脚本寻找日志未打印的字面字段名，已在保存原始 Node 退出 1/输出后停止；后续只核留存的命名失败及 `false !== true`，没有重跑 N1–N4，也没有改写其原始日志；汇总辅助脚本的该次退出不混入正式套件结果。

## 5. 固定源码与可取件证据

下表除本记录外路径都位于 `tools/hikvision-e1-controlled-runner/`；这些是最终受测字节，提交后根代理以 Git blob 再比对，不伪称已在提交后重跑。

| 文件 | SHA-256 |
|---|---|
| `index.mjs` | `8eba07ed904549ae58d694aad35e8bdab62e1be33970da6285023795f1dda50c` |
| `private-plan.mjs` | `f0d1a36ea9b0c134f521d7583c4e3e67358d9bbf20f670d5f83a6cf740dc5c8a` |
| `controlled-runner.mjs` | `688d9679b5131f374423f024b1eccccfd0a67377de945846554469f4bc4f77d7` |
| `evidence-session.mjs` | `39e6f3e569e4a959ecac66272e0ecdac74ef7e26f398511fea1b2759711eab49` |
| `windows-acl-bridge.mjs` | `f50d5753ef28f5139b6fcd9a49692267e32d9cb435a4677335c51448f054d0f4` |
| `public-result.mjs` | `5533fe993cd931463c64098897c0c8637b25f849af6c6203dd67d959275f6669` |
| `test/testkit.mjs` | `caddd4c595acbfe6ede05ff84effe038134f22065ffb59c12f06252154594270` |
| `test/controlled-plan.test.mjs` | `5cff8004f35587d34286b3f9da7c3caac4c5d7919687b89b53e4ad5f2e26671a` |
| `test/evidence-session.test.mjs` | `4fb6f3653ba3833c3529ae8845d9e5b8c294ce559faffc5c3233a1cfb66cd3ce` |
| `test/public-result.test.mjs` | `85a5344420cb3948d08f7372c5a8cff5191f20fe46e892696ceb7fc65c6ad4c8` |
| `README.md` | `b8720e8165cd08687c86101ef5a8860b5cdf13085f0826f7391aaf0f3bf6745f` |

固定 checker SHA-256 为 `a8dbde46942aca550e13fdddb27e93bd5c9d1902e8cbdfb09cb31befc0eecfb7`，本轮未修改。云端原始工件根为 `/workspace/artifacts/HK-AI-08-CR1-2026-11-23/`，不假定 Windows/其他聊天共享该路径；跨会话以 Git 固定文件与另交原始证据包取件。

| 原始工件相对路径 | 字节 | SHA-256 |
|---|---:|---|
| `pre-run-source-manifest.json` | 3111 | `c05f3238b6c2f4bf2b2ab0f21e87d6ad3b02c8ed3aff85cf6a8ea4960912f0e0` |
| `pre-final-source-manifest.json` | 4560 | `710a6183abede7b5d426baf8a3cd37af3736175f29717ef7e141a77409d02eb3` |
| `attempt-2-final/execution.json` | 32003 | `188fffb423b256d60d77f65b0575b9b26bd4d08f78e96c1bfed6ac931f6ede59` |
| `attempt-2-final/stdout.log` | 36933 | `6574b5b6a90b29a6d653a8b6d48290216e31b35e245e50b2579993d5e6ad7c1b` |
| `attempt-2-final/stderr.log` | 170 | `249b69d35ab974152e315937721571db393b63fa95a7963acd8bd424c4199c39` |
| `negative-control-results.json` | 5046 | `35a3e8da2bd8f8a18f71bd44fa194b9d04b0344c18948df453f29275db627595` |

`attempt-1`、各 `negative-controls/N*/mutation.json` 与 `run/` 的原始输出/退出记录另外保留；负控变异源码不作为正常实现交付或执行入口。

## 6. 独立复审与停止点

根负责实施整合/实测；未参与实现的 `/root/cr1_security_review` 和 `/root/e1_task_contract_audit` 分别对源码安全、测试合同与原始执行证据做只读独立复核，均给出 **CR-1 范围通过、无残余实质发现**。两路逐项核文件哈希、原日志/退出码、232 槽、五复制树单点变异及原源码不变；不是实施者自检或本机 CLI 自批。两位复审者未亲自运行 Node/测试，其结论是对根既有执行证据的独立复核，不冒充独立复跑。

已关闭的实现缺陷包括归一化与固定 checker/P 不一致、Proxy fault 反射、会话活状态/跨模型认领/非法阶段未终态、DTO 清零事实/混淆不可读与缺省/E14 状态，以及 guard 不转发正控原 target 链路；正式回归和 N1–N5 对应证明已列上文。不以测试期临时修订改写任何既有验收提交。

**Stop-CR1：本轮只到纯合成核心，下一阶段 CR-2 尚未启动。** 真实审批/目标/账号证书材料、同份执行绑定、真正 Node/Windows ACL/对象身份与存活 writer 能力仍未验证；本地 W 任务只待既有回报、不重派。用户取消隔离网络前置继续有效。

不接真实设备/支付/云，不启动 HTTP/UI，不安装依赖、native addon 或修改全局 Git/TLS。S4、预签约 S2–S6、H4-c C2/C3、07B 执行、集成/合并、部署发布均未启动。只追加提交、普通显式 refspec push、远端 SHA 核验；最终提交与远端结果由根交付消息报告，不预填本记录自身 SHA。
