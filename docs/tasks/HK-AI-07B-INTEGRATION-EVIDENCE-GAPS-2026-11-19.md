# HK-AI-07B 集成候选证据缺口（2026-11-19）

- 日期：2026-11-19（Asia/Shanghai）。任务：独立任务 D，只读调查产物。
- 对应候选卡：`docs/tasks/HK-AI-07B-INTEGRATION-CANDIDATE-TASK-2026-11-19.md`（同分支新增）。
- 固定输入：`1be517e48cadd810caa4f44df9e38e14c8b2c764`；历史 main：`282a20fca9f64ab80ead50372c9c3e90bf4aeba7`。
- 方法：仅 `git ls-remote` / `fetch`（只读更新远端跟踪引用）/ `rev-parse` / `diff` / `log` / `merge-tree --write-tree` / 文件读取；未安装依赖、未跑测试、未跑 verifier 或 guard、未改实现或已有文档。
- 用途：把“已引用但未复验”与“不可复现”的部分显式列出，避免后续把前序证据当成当前结论。

## 1. 缺口总表

| ID | 缺口 | 现状（本次可证） | 影响 | 执行时要求 / 停止点 |
|---|---|---|---|---|
| G-01 | guard 实现不在仓库 | 仅有 `guard.cjs` sha256 `4c84a87d…ae2d3` 与 `controls.cjs` sha256 `7203bdcc…3922`（前序证据）；本次未取得文件 | 无法证明重建件与旧 guard 等价 | 重建并记录新 sha256 + 79/79 负控；入口缺失或负控失败 → BLOCKED |
| G-02 | 当前检出为 CRLF | `git ls-files --eol`：`i/lf w/crlf` 253、`i/crlf w/crlf` 1；`core.autocrlf=true` | `verify-import.mjs:18` 对工作树字节求哈希，CRLF 会导致 61 文件哈希不符 | 必须另建 `core.autocrlf=false` LF 工作树；否则 C4/C5 记 BLOCKED，不得把 CRLF 差异当篡改 |
| G-03 | 通过类计数均为引用 | 20/20、8/8、51/51、61/24/318、79/79、`npm ci` exit 0 均来自前序证据文档，本次未复跑 | 不能作为“当前仍通过”的证明 | 逐项重跑并保留完整输出与 exit code |
| G-04 | merge-tree 结论有时效 | 本次 `merge-tree` exit 0、tree `0ced1e17…5c2`（基于 main `282a20f`） | main 前移后结论作废 | 每次 fetch 后重跑；不得以“无冲突”代替批准 |
| G-05 | 云端复审正文不可达 | 前序任务卡 r3 自述 `/workspace/artifacts/DEL-AI-01-CONTENT-REVIEW-2026-11-18/REVIEW.md` 本机不可达 | F1–F8 是否逐项关闭未知 | 未取得正文前不得声称已关闭；以调度方裁定为准 |
| G-06 | 07A 接线契约不在候选链 | 该文件位于 `docs/hk-face-http-wiring-design` @ `2f597e33acb3563d92cafd2d70ac238a27d796dc`，不在 `origin/main..1be517e` 内 | “组织停用 → 403”的要求无法在本候选范围内取证 | 仅作外部引用；不得作为本候选已满足的条件 |
| G-07 | G3/O10 验收记录不在本链 | `5f1d7a4` 对象存在（`git cat-file -t` = commit），验收记录正文不在候选范围 | 无法在本地复核 G3 关闭/O10 PASS | 只引用调度方记录；不得用其他 SHA 冒充，不重验 |
| G-08 | 静态计数 ≠ 执行计数 | 根测试静态 `test(`：`layout` 3、`wechat-modules` 3，而前序执行计数为 7、11（存在循环生成） | 用 grep 估算会低估 | 必须逐文件执行取实际 tests/pass 数 |
| G-09 | 监听类测试未纳入 | 8 个 admin-web 测试文件含真实 `listen`（行号见候选卡 §6），前序 IG06 明确排除 | 非监听回归不能覆盖 HTTP 监听路径 | 未获 HTTP/UI 授权不得启动；不得把“未跑”写成“通过” |
| G-10 | 依赖未安装 | 本工作树无 `node_modules`（admin-web 与 24 个云函数均无） | 无法验证 `sharp`/`wx-server-sdk`/`node-fetch` 可加载 | 按 lock 与仓库规则安装；安装失败或 `sharp` 缺失 → BLOCKED |
| G-11 | 组织停用未实现 | `queryJob`（`service.mjs:798-802`）经 `#membership`（`:154-166`）仅校验成员 active，不校验 `org.status` | 07B 现状不得虚报已修 | 归入未来 HTTP 接线门禁；本卡不外推、不实现 |
| G-12 | 真实环境零覆盖 | 未接触 HTTP/UI、Provider、设备、支付、生产云、真机、部署 | 任何“可上线/已恢复”结论无依据 | 明确列为未验证；不得写通过 |
| G-13 | 集成粒度未定 | 候选范围 134 提交为整链；07B 5 提交不可孤立（依赖 H1–H4 服务层与 sharp 链） | 窄化集成单位缺证明 | 若要窄化，另立卡另证；本卡不提供 |
| G-14 | 远端候选分支历史未知 | 本次 `ls-remote` 该 ref 为空 | 无法判断此前是否推送过 | 推送前再次 `ls-remote`；存在即先比对，不覆盖 |
| G-15 | 来源上游可追溯性 | provenance 记录上游 `mini-shop` @ `b4c9370…`，但本仓库无该远端对象 | 无法本地重放原始导入 | 只按 61/61 blob 与 changes 登记校验，不重导入 |

## 2. 证据来源清单（本卡引用）

| 来源 | 完整 SHA / 路径 | 支撑内容 |
|---|---|---|
| 输入门禁提交 | `1be517e48cadd810caa4f44df9e38e14c8b2c764` | 候选起点、07B 证据文档 |
| 门禁任务卡 r3 | `docs/tasks/HK-AI-07B-OFFLINE-INTEGRATION-GATE-TASK-DRAFT-2026-11-18.md`（`cc4ec7b` 引入，`1be517e` 内容） | IG01–IG08、guard 入口、停止点 |
| 门禁证据 | `docs/tasks/HK-AI-07B-OFFLINE-INTEGRATION-GATE-EVIDENCE-2026-11-18.md` | 20/20、8/8、51/51、61/24/318、79/79、guard sha |
| 生产基线 | `8ff350d3f6ec41e67cc8d42639f8c37cf96323da` | 129 提交 / 91 文件 / +30020 −512 |
| 来源清单 | `docs/backend-provenance.json`（61 项，上游 `b4c9370…`） | 61 文件与上游坐标 |
| 变更登记 | `docs/backend-changes.json`（3 条） | phoneLogin / getHouses / contentList |
| verifier | `scripts/verify-import.mjs:16-35` | 工作树字节哈希、61/24/318 输出 |
| 依赖 | `admin-web/package.json:19`、`admin-web/package-lock.json` | `sharp 0.35.5`、`@cloudbase 3.18.7` |
| 组织停用现状 | `admin-web/lib/face-service/service.mjs:154-166`、`:798-802` | 仅成员 active，不校验 `org.status` |
| sharp 依赖链 | `admin-web/tests/face-service-h1-regression.test.mjs:8` → `admin-web/lib/files.mjs:65-69` → `admin-web/lib/face-image.mjs:15` | H1 回归真实加载 sharp |
| 07A 外部契约 | `2f597e33acb3563d92cafd2d70ac238a27d796dc:docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md` | 组织停用 403 的接线要求（范围外引用） |

## 3. 明确“未知”项（不得填补）

- 云端复审 F1–F8 是否逐项关闭：**未知**。
- guard 重建件能否与旧 sha256 一致：**未知**。
- G3/O10 验收记录正文与其时间点：**未知**（仅有 `5f1d7a4` 对象与调度方口述记录）。
- 远端候选分支此前是否存在：**未知**（本次观测为空）。
- 生产云、真实设备、支付、真机、部署的实际状态：**未知且未接触**。
- 07B 在 HTTP/UI 层的行为：**未实现、未验证**。

## 4. 缺口关闭条件（供后续执行卡引用）

1. 在 LF 工作树完成 C1–C11 全序列，逐项给出 PASS/FAIL/BLOCKED 与完整输出、exit code。
2. guard 重建件及其 79/79 负控、正控、ESM 绑定、子进程继承结果入证据，并记录执行前后 sha256。
3. 明确区分“复跑得到的结果”与“引用的历史结果”；引用部分必须标注来源提交与日期。
4. main 若前移，按候选卡 §9 重跑，旧结论一律标注作废。
5. 组织停用与 HTTP/UI、Provider、设备、生产云保持未验证状态，直到另立接线门禁卡。

## 5. 结论

本文件不产生任何“通过/恢复/可上线/可合并”结论；它只说明：现有证据的边界、哪些结论仍可引用、哪些必须在执行时重跑。任何执行派单都必须以本文件与候选卡 §8/§9 的停止点为准。
