# HK-AI-05B 门禁管理页面正式接线差距审计与接线建议（修订稿）

- 文档状态：**审计修订完成，待 Codex 复审。本文不构成实现批准，不构成正式演示包批准。**
- 日期：2026-11-15（Asia/Shanghai）；初稿 2026-11-14，修订前审计提交 `fe8705e`。
- 审计分支：`docs/hk-face-admin-wiring-audit`
- 页面基线：`origin/feat/hk-face-admin` @ `2e8966b7cea1224983ea38082bb082d5cc878a6e`（已复审 Mock 演示 UI；本地以 remote ref 核对）
- 页面基线父提交：`708c3ab3672f72a86d17d35779bb44d46833ee9c`
- 服务层参照基线：`1155b7ba65991d324fb8b22bb8f7dd87f49428f9`（H4-b 终审）
- HTTP 终审：`2f597e33acb3563d92cafd2d70ac238a27d796dc`（HK-AI-07A；**九端点 HTTP blocked 9/9**）
- queryJob revision 契约：`bc2a8b29441f7c8fdf1250b4c6905526d37b9c2f`（HK-AI-07B 读模型）；最终硬化 `cf7c75efcdbb719caa47d77cc149679248b0a218`（含 `f5844715a4c0f2cb6429bb77c8220b9b46d50fb3`）
- H4 设计终审记录：`67190666680ec70632014eba91b5c4efda17e880`（批准分阶段发卡；不批准 HTTP/Provider/设备）
- H4 撤权/对账契约：`9fd088da57a1400e4e5fcaaf367b787b2e371dac`
- H4-c 设计：`b15acebe0a8049f316797bbbd2692c55de25d111`（**已批准**的设计基线）
- H4-c 批准/任务卡：`ed7b66f84c79339246a81ea76762cc388d7f4778`（批准设计并授权分阶段编码；**不授权 HTTP**）
- H4-c C1：`90e4189717e21a5d458b09da34677ef29795c767`（最新返工，**待 Codex 独立终审**）；C2/C3 未开始
- 审计范围：`hk-face-admin/` 五页及共享脚本；H1～H4 已批准契约与证据；H4-c 设计/批准/C1；页面验证、截图与交接记录
- 本轮边界：**只写文档**。未修改 HTML/CSS/JS 或 API，未调用应用 HTTP，未连接设备或 Provider，未删除 Mock/模拟标识，未制作演示包，未合并 `main`。

## 0. 结论摘要

`2e8966b` 的页面已被批准为**合成数据演示 UI**，不是已接通的正式门禁前端。终审明确要求：真实 UI 接线必须等待 HTTP 契约与路由终审后另发任务卡，并重新覆盖权限、同态 404、任务状态、`UNKNOWN_RESULT`、撤权和人工对账（`docs/tasks/HK-AI-05A-UI-APPROVAL-2E8966B-2026-11-11.md`）。

本轮修订只做三件事：**纠正批准引用、把 HTTP/queryJob/H4-c 的真实状态写回、把 66 项差距逐项挂到可解析提交与状态上。** 接线结论没有变：`2e8966b` 不能直接接 API。

旧稿总结的五类接线前置仍然成立：权限名不一致、缺少后台视图 DTO/已注册路由、页面把多条状态轴压成一条、缺少写路径 CAS/幂等/审计入参、Mock 边界硬编码。本轮只更新其中与 HTTP/queryJob/H4-c 有关的事实状态，§3–§6 的逐项判断继续适用。

### 0.1 本轮修订后的硬结论

1. **九端点 HTTP blocked 9/9。** `2f597e3` 关闭的是设计争议，不是 HTTP 编码；E01–E09 全部未注册，0 个可接线。E08 只有 `routes.mjs` 描述行，E09 连描述行都没有；`server.mjs` 无三路径分支。
2. **`queryJob` 是 job revision 的唯一权威入口。** `2f597e3` 的 Q1 裁定六字段 DTO；`bc2a8b2` 落地读模型，`f584471`/`cf7c75e` 收紧 `failureReason`。`queryJob` 仍只是服务层方法，HTTP 读取未批准；UI 仍没有合法 revision 来源。
3. **无合法 revision 时，依赖它的 mutation 按钮必须隐藏或禁用，依赖 mutation 的网络请求 0，并给出明确原因。** 不得用列表行号、数组下标、本地自增、旧 mutation 响应、缓存旧值、时间戳、`attempts` 或 `cleanupPending` 推导 revision；不得发“探测请求”。
4. **`awaiting_result`/`UNKNOWN_RESULT` 只允许查询与人工对账。** 禁止自动重试、自动轮询、定时器、回调、Provider `queryOperation`、普通 requeue；E08 未注册，reconcile 按钮必须禁用且不得可执行。
5. **Revoke 服务 implemented，HTTP blocked。** 服务层 `revoke(grantId,{idempotencyKey})` 无请求体；未来 HTTP mutation 至少 `expectedGrantRevision`；`reasonCode` 的枚举/持久化/审计/投影冻结前不得接收。
6. **Retry E07 proposed/blocked。** `h3b.requeue`/`h4b.requeue` 缺 operation key、`requestDigest`、domain guard、严格重放，**不是正式 retry 接口**；E07 未注册，不得复用 requeue。
7. **Reconcile/finalize-retry 等待 H4-c C1 终审 + C2 + C3 + RC01–RC73。** 设计已批准（`b15aceb`/`ed7b66f`），C1 最新 `90e4189` 待独立终审，C2 仅 `42f8970` 文档，C2/C3 未开始；E08/E09 完全不注册，页面不得有可执行按钮。
8. **H4-c 与 H4 的批准引用已纠正。** 旧稿错误地把 `b15aceb` 写成未批准状态，本轮改为“已批准设计基线 + `ed7b66f` 批准/任务卡”；旧稿的 H4 批准对象引用已替换为可解析的 `6719066` 批准记录与 `9fd088d` 设计，不再引用那个设计返工哈希。

### 0.2 本轮修订对照

| 项目 | 旧稿写法 | 本轮写法 | 依据 |
|---|---|---|---|
| H4 设计批准 | 旧稿把一个设计返工哈希当作批准对象 | 批准记录 `6719066`；设计契约 `9fd088d`（H4-c 的输入）；不把设计返工哈希当批准 | `6719066`、`9fd088d` |
| H4-c 状态 | 旧稿误称 `b15aceb` 未批准、无批准文 | `b15aceb` 是已批准设计；`ed7b66f` 是批准+任务卡；C1 待终审，C2/C3 未开始 | `b15aceb`、`ed7b66f`、`90e4189`、`42f8970` |
| HTTP | `routes.mjs` 8 条提案未注册 | 九端点 HTTP blocked 9/9；E08 仅描述行；E09 不在表；0 注册 | `2f597e3` |
| queryJob revision | `1155b7b` 五字段、无 `revision` | `2f597e3` Q1 定六字段；`bc2a8b2` 实现；`cf7c75e` 最终硬化 | `2f597e3`、`bc2a8b2`、`f584471`、`cf7c75e` |
| Revoke | H4 服务层实现；HTTP 未冻结 | service implemented；HTTP blocked；`expectedGrantRevision`/`reasonCode` 冻结前不接 | `1155b7b`、`2f597e3` |
| Retry | 页面有重试目标 | E07 proposed/blocked；不完整 requeue 不作正式接口 | `2f597e3`、`1155b7b` |
| Reconcile | 旧稿把 H4-c 当成仅设计提案 | 设计已批准，但 C1/C2/C3 + RC01–RC73 未齐；无可执行按钮 | `b15aceb`、`ed7b66f`、`90e4189` |
| 66 项差距 | 只有“依赖阶段” | §5.7 逐项给出依赖提交、服务/契约状态、HTTP/页面状态与结论 | 本文 §5.7 |

**建议：不要把 `2e8966b` 直接接到 API。** 先完成 W0 的契约/视图 DTO/权限决策，并为九端点逐项另发编码卡；W7 真实设备生效标志必须单独批准。

## 1. 审计范围、基线与证据版本

### 1.1 审计边界

**纳入：**

- `hk-face-admin/index.html`、`devices.html`、`applications.html`、`tasks.html`、`audits.html`、`app.js`、`styles.css`；
- `docs/tasks/HK-AI-05-STATIC-UI-AUDIT.md`、`HK-AI-05A-UI-CHECK.md`、`HK-AI-05A-REVIEW-HANDOFF.md` 与 21 张 `hk-ai-05a` 截图；
- H1～H4 已批准契约文档、H4-c 设计文档、服务层 DTO/状态机/路由/权限目录。

**不纳入：**

- 真实 HTTP 注册、`server.mjs` 接线、Cloud/live、真实 Provider、真实设备、设备写；
- 生产部署、正式演示包、`main` 合并；
- 对既有 24 条静态审计结论的重新裁定；本轮只引用与接线相关的结论。

### 1.2 证据清单

| 证据 | 版本/提交 | 出处 | 状态与用途 |
|---|---|---|---|
| 页面五页 + `app.js` | `2e8966b7cea1224983ea38082bb082d5cc878a6e` | `hk-face-admin/` | 已复审 Mock UI 基线；本轮逐行核对 |
| 页面壳恢复 | `80b8a523ede07f5415dbd48efa2c644cbf54c76a` | `hk-face-admin/` | 页面来源，非本轮重点 |
| 合成数据与六态 | `33ce350d822f98d2337256b15d4f966d09ffbe2a` | 提交 | 页面六态、Mock 横幅、UNKNOWN_RESULT 表达 |
| 静态检查/截图提交 | `07e76168289c00c035c26fd5ba88b65aae5433f6` | `hk-face-admin/tests/`、`docs/tasks/screenshots/hk-ai-05a/` | 31 项静态检查、21 张截图 |
| 交接说明 | `61fd2400d8167609f97d6f4b726663ee78d0ad56` | `docs/tasks/HK-AI-05A-REVIEW-HANDOFF.md` | 复审口径、D1～D6、未验证项 |
| 页面终审 | 文档提交 `a9ad8d8cc12adc7bb2c925fc7922a34e3b0c9d38` | `docs/tasks/HK-AI-05A-UI-APPROVAL-2E8966B-2026-11-11.md` | **通过，仅批准 Mock 演示 UI** |
| 静态 UI 审计 | `708c3ab3672f72a86d17d35779bb44d46833ee9c` | `docs/tasks/HK-AI-05-STATIC-UI-AUDIT.md` | 24 条问题：P0 2 / P1 9 / P2 13；P0-1 已闭环 |
| 静态审计复审 | 文档引用的复审 `7655c28` | `docs/tasks/HK-AI-05-STATIC-UI-AUDIT-REVIEW-708C3AB-2026-11-07.md` | 静态审计口径来源；未在本轮重跑 |
| UI 独立 QA | `07e7616` / `2e8966b` | `docs/tasks/HK-AI-05A-UI-CHECK.md` | 31/31 静态、26/26 CDP、24 组合、21 图 |
| H1 终审 | `6bfe1ba152dba8ba48da9270620f4a43577383dc`；批准文 `de07fc48ecc3e355cd04c0d3f1d544aba5ddaa8b` | `docs/tasks/HK-AI-04-H1-FINAL-APPROVAL-6BFE1BA-2026-11-07.md` | submit/review 最小入参；createGrant/revoke 在 H1 关闭 |
| H2-a 终审 | `f9a2b6b964bbc254b0c67be03ae2b09396e201e4` | `docs/tasks/HK-AI-04-H2A-FINAL-APPROVAL-F9A2B6B-2026-11-07.md` | K2、operation key、严格重放 |
| H2-b 终审 | `2bc10e3a6b734c919fc33483444c3b407d870173`；批准文 `e9e8544d641e93b0d4164280477b00664f465e76` | `docs/tasks/HK-AI-04-H2B-FINAL-APPROVAL-2BC10E3-2026-11-08.md` | owner claim、slot、设备快照 |
| H2-c 设计批准 | `bcb2cd61af0fcbc9e906ed5aa0140d00025842fc`；批准文 `ca98155a337116722bc2c0ddb79a45ddcfac14ae` | `docs/tasks/HK-AI-04-H2C-DESIGN-APPROVAL-BCB2CD6-2026-11-09.md` | 资格快照、真实黑名单、授权区间 |
| H2-c C4 终审 | `feaa1e04e6ca5d64e4028301fb02a9b6b5227e68`；批准文 `86e5c9f86576e0a502c1f0aa7e8ffd5dffb06627` | `docs/tasks/HK-AI-04-H2C-C4-FINAL-APPROVAL-FEAA1E0-2026-11-11.md` | C4 矩阵、容量 32+N |
| H2-d 终审 | `90cc8486a19d408be0e3c501d9f5ec61ba13e929`；批准文 `f97489fb00ad605edf893653614a5707722a89da` | `docs/tasks/HK-AI-04-H2D-FINAL-APPROVAL-90CC848-2026-11-12.md` | H2 整体关闭；H3 仅设计 |
| H3 设计批准 | 设计 `ccd6d087527e46e674653ffdf22b22d7390b7e3f`；批准 `b2cd7abf7699a93db58c245e5773f14aa50093ee`；批准文 `b9a639bad57dc70e894cf1bf4d506c20f8a5aac3` | `docs/tasks/HK-AI-04-H3-LEASE-DISPATCH-DESIGN.md`、`HK-AI-04-H3-DESIGN-APPROVAL-B2CD7AB-2026-11-13.md` | 租约、fence、结果迁移、重试预算 |
| H3-a 终审 | `5e590ee04fee0d71f81b22c3c2b505de1fefa293`；批准文 `e1a89159c18d2d3d7a515df593abd0c0bbf2c31c` | `docs/tasks/HK-AI-04-H3A-APPROVAL-5E590EE-2026-11-13.md` | 内嵌快照、租约/fence helper |
| H3-b 终审 | 实现 `7c3adcbd63601464a5800a3d19472455db07d4c4`；返工 `2b92b30ef985a1606ff8b1ab0cc3becbbd2a759f`；批准文 `07b636101d6c3248d093fae91dc6ac1aaef58ab8` | `docs/tasks/HK-AI-04-H3B-APPROVAL-2B92B30-2026-11-13.md` | Mock 派发生命周期关闭 |
| H4 设计终审记录 | `67190666680ec70632014eba91b5c4efda17e880` | H4 设计终审通过记录 | 批准分阶段发卡；**不批准 HTTP、真实 Provider 或设备连接** |
| H4 撤权/对账契约 | `9fd088da57a1400e4e5fcaaf367b787b2e371dac` | `docs/tasks/HK-AI-04-H4-REVOKE-RECONCILE-DESIGN.md` | 撤权、清理、未知结果对账总契约；H4-c 继承其 Q04 资源/证据语义 |
| H4-a 终审 | `685ac3a9a4cb7241ef89c02521098d1bc9756fb5`；批准文 `5aa170c023c64fd13897a9451a5f0fd0b9c66e7e` | `docs/tasks/HK-AI-04-H4A-APPROVAL-685AC3A-2026-11-13.md` | 立即业务撤权 |
| H4-b 终审 | `1155b7ba65991d324fb8b22bb8f7dd87f49428f9`；批准文 `296bcba55b26163fe673af96e949ec3332322dbb` | `docs/tasks/HK-AI-04-H4B-APPROVAL-1155B7B-2026-11-13.md` | Mock 清理、local finalize |
| H4-c 设计 | `b15acebe0a8049f316797bbbd2692c55de25d111` | `docs/tasks/HK-AI-04-H4C-RECONCILIATION-DESIGN.md` | **已批准设计基线**（`ed7b66f`）；字段/路径仍不构成 HTTP 契约 |
| H4-c 批准/任务卡 | `ed7b66f84c79339246a81ea76762cc388d7f4778` | `docs/tasks/HK-AI-04-H4C-DESIGN-APPROVAL-B15ACEB-2026-11-14.md`、`HK-AI-04-H4C-IMPLEMENTATION-TASK-2026-11-14.md` | 批准设计并授权分阶段编码；**不授权 HTTP**；C1/C2/C3 必须独立复审 |
| H4-c C1 | `90e4189717e21a5d458b09da34677ef29795c767` | `docs/tasks/HK-AI-04-H4C-C1-REVIEW-EVIDENCE-2026-11-14.md` | 最新 C1 返工；自述“等待 Codex 独立终审”；无 `reconcile`/`finalize-retry` 服务入口 |
| H4-c C2 前置 | `42f8970f065097f5163dfcbfc723932a72c51faf` | `docs/tasks/HK-AI-04-H4C-C2-PREFLIGHT-2026-11-14.md` | 仅文档；自述 C1 未正式通过、C2 未开始 |
| HTTP 终审 | `2f597e33acb3563d92cafd2d70ac238a27d796dc` | `docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md` | **九端点 HTTP blocked 9/9**；Q1–Q8 已裁定；0 注册 |
| queryJob revision 契约 | `bc2a8b29441f7c8fdf1250b4c6905526d37b9c2f` | `admin-web/lib/face-service/service.mjs` | HK-AI-07B 六字段读模型；`revision` 只取当前 job；缺失/非法 `INVALID_JOB/409` |
| queryJob 最终硬化 | `cf7c75efcdbb719caa47d77cc149679248b0a218`（含 `f5844715a4c0f2cb6429bb77c8220b9b46d50fb3`） | `admin-web/lib/face-service/service.mjs` | `failureReason` 私有只读白名单；六字段不变；E06/E07/E08/E09 仍 blocked |
| 服务层 DTO | `1155b7b` | `admin-web/lib/face-service/dto.mjs` | grant/job/review 枚举、submit/createGrant/revoke/query 输入、公开投影 |
| 服务层状态机 | `1155b7b` | `admin-web/lib/face-service/state.mjs` | 四轴迁移、`deviceEffective`、`projectAccess` |
| 服务层路由提案 | `1155b7b` | `admin-web/lib/face-service/routes.mjs` | 8 条描述路由；E08 在表、E09 不在；**全部未注册** |
| 服务层实现 | `1155b7b` | `admin-web/lib/face-service/service.mjs` | submit/review/createGrant/revoke/queryJob；queryJob 的 revision 读模型以 `bc2a8b2`/`cf7c75e` 为准 |
| 组织权限目录 | `1155b7b` | `admin-web/lib/org.mjs` | 7 个正式权限点；无 `device.manage` |
| 页面验证 | `2e8966b` | `hk-face-admin/tests/hk-ai-05a-verify-result.json` | 26/26 断言；`network.nonFile=0`；`consoleErrors=[]`；21 图 |
| 截图清单 | `2e8966b` | `docs/tasks/screenshots/hk-ai-05a/` | 21 张；合并清单 SHA-256 `fb8eb52339e52c096d385e905c43b1f36c1b6140dcc2d75af689be2b196f2e20` |

> 说明：上表中的 `docs/tasks/...` 批准文档多数不在 `feat/hk-face-admin` 树内，来自其他文档分支。本文以“路径 + 提交”记录出处，不把不在当前分支的文件写成可点击相对链接，避免离线链接失效。
>
> 证据分组：`2f597e3` 定 HTTP/UI 门禁与 Q1–Q8；`bc2a8b2`/`f584471`/`cf7c75e` 落地 queryJob revision 读模型；`b15aceb`/`ed7b66f` 批准 H4-c 设计并分阶段发卡；`90e4189` 是 C1 最新返工，不等于 C1 终审。**任何一组都不注册 HTTP。**

### 1.3 页面验证结论（只证明 Mock UI，不证明正式接线）

- 静态检查：**31 PASS / 0 FAIL**；包含 21 个既有证据文件 SHA-256 基线比对、权限白名单、零外链/零网络 API、禁显词、六态枚举、Mock 横幅逐字、打印态、焦点、toast。
- CDP 运行时：**26 项断言 `ok:true`**；六态 × 四业务页 **24/24**；reload 4/4 回 `ready`；`localStorage`/`sessionStorage` 全程 0；`network.total=117 / file=117 / nonFile=0`；`consoleErrors=[]`。
- 截图：21 张；IHDR 21/21；Mock 横幅 21/21；10 类禁显值 21/21 零命中；对比度最小 6.11:1、最大 16.48:1（作用域仅 Mock 横幅与 `--text-2` 类次级文字）。
- 这些结论的适用范围是 **`file://` 离线 Mock UI**。页面没有 API、没有会话、没有组织上下文、没有服务端权限、没有真实设备证据；因此不能据此宣称正式接线可用。

### 1.4 证据缺口（本轮无法闭环）

| 编号 | 缺口 | 影响 | 处理建议 |
|---|---|---|---|
| E-01 | H4-c C1 最新 `90e4189` 仍自述“等待 Codex 独立终审”；C2 仅 `42f8970` 文档；C2/C3 未开始；RC01–RC73 未完成 | E08/E09 不能注册；页面不得有可执行 reconcile/finalize-retry 按钮 | C1 先终审；C2、C3 独立提交/复审；RC01–RC73 齐备后再谈 HTTP 编码卡 |
| E-02 | queryJob revision 读模型已在 `bc2a8b2` 落地、`cf7c75e` 硬化，但 HTTP 读取未批准、未注册 | UI 没有合法 job revision 来源；revision 依赖按钮必须禁用且 0 请求 | 另发 queryJob/列表 HTTP 编码卡；未批准前不接 UI |
| E-03 | 九端点 HTTP blocked 9/9；无编码卡；E08 仅 `routes.mjs` 描述行，E09 不在表；`server.mjs` 0 注册 | 页面任何正式写路径都不可用 | 逐端点编码卡；E05/E07/E08/E09 先满足各自前置 |
| E-04 | 没有后台视图 DTO：设备列表、申请详情、任务列表、审计列表 | 页面字段无法逐项映射到正式 DTO | W0 新增视图 DTO 文档并复审 |
| E-05 | 没有审计读取路由/响应 DTO；`admin_audit` 与 operation log 形状不同 | 审计页无法接线 | W0 定义 `device.audit.read` 视图与分页 |
| E-06 | 没有 enroll/`awaiting_result` 的人工对账契约；H4-c 只覆盖 revoke job | 任务页“人工对账”对 enroll 任务无正式语义 | W0 明确 H4-d 或把 enroll 限制为“查询” |
| E-07 | 没有自由文本 `reason` 字段；H4 只有 `revokeReason` 枚举；H4-c 只有固定 `sourceCode`；revoke HTTP 的 `reasonCode` 未冻结 | 页面“理由必填”无法落库/审计；撤权理由不能提前接线 | 先完成“撤权服务与 HTTP 契约加固”；未冻结前不接收 `reasonCode` |
| E-08 | 没有 consent/同意记录字段；HK-AI-03 报告标注“未开始” | 申请页“同意记录”是 Mock 合成 | 标记 TBD；未批准前不得作为正式字段 |
| E-09 | 没有 `device_verified` 真实设备证据；H1～H4 全部 Mock/LocalStore | `真实设备生效` 无法接线 | 保持“否”；W7 单独批准真实设备 |
| E-10 | 页面分支不含服务层代码；服务层分支不含页面；queryJob/H4-c 分支也不含页面 | 页面/服务无法在同一树中联调 | W0 建集成分支并固定双方提交 |
| E-11 | 没有正式状态的截图：queued/sending/terminal_failed/cancelled、reconcile 403、跨组织 404、权限撤销、revision 缺失/禁用 | 视觉验收证据不足 | W6 补截图矩阵 |
| E-12 | 既有 24 条静态审计仍有 23 条开放；本轮未重新裁定 | 页面壳层问题可能掩盖接线问题 | 只引用与接线相关项；W6 复跑 |

> 已关闭的旧缺口：H4 批准对象引用已改用可解析的 `6719066` 批准记录与 `9fd088d` 设计；H4-c 已有 `ed7b66f` 批准/任务卡；H4-c 复审链 `0c28104`、`93c529d` 均可解析。旧稿中“H4 批准对象不可解析”“H4-c 没有批准文”两条不再成立，已由 E-01～E-03 的当前缺口替代。

## 2. 契约状态与判定规则

### 2.1 状态标签

本文所有字段/路由都带以下标签之一，**未批准的内容不写成冻结契约**：

| 标签 | 含义 |
|---|---|
| `[FROZEN]` | H1～H4 已批准契约中明确存在的字段、枚举、权限或语义 |
| `[APPROVED-DESIGN]` | 设计已批准，但编码/HTTP 未实现；只能作为接线目标，不能当作现有 API |
| `[PROPOSED]` | 设计或 `routes.mjs` 中的提案；未注册、未批准，不得写成已可用 |
| `[HTTP-BLOCKED]` | 服务/契约可能已存在，但 HTTP 未注册或未获批准；不得接线、不得验收 |
| `[TBD]` | 契约缺口或未批准字段/路由；必须由 Codex/契约负责人裁定 |
| `[FORBIDDEN]` | 明确禁止展示、返回或落库的内容 |

### 2.2 已批准契约的实际覆盖

H1～H4 已批准的是**服务层 Mock 契约**，不是 HTTP 契约，也不是后台视图 DTO。HTTP 传输/认证/错误信封与 E01–E04 契约另由 `2f597e3` 定义，但九端点仍未注册；本审计不把 `2f597e3` 当作已可用 API：

- **H1**：`submit` 只接收 `personId/sourceFileId`；`review` 使用 `expectedRevision`；`createGrant/revoke` 在 H1 返回 `STAGE_CLOSED`。
- **H2-a**：K2 operation key、严格重放、`operation_keys` 记录。
- **H2-b**：设备 owner claim、设备快照、slot 唯一占用；grant 保存 `claimId/slotId`。
- **H2-c/C4**：完整资格快照、真实 `BlacklistService`、授权区间必须在 occupancy/cycle 有效区间内。
- **H2-d**：H1/H2 全链验收；明确 H3 前缺口：job 未存资格快照引用、grant 未存 `identityApplicationId` 与资格 revision/epoch 基线。
- **H3**：job 内嵌 dispatch snapshot、租约/fence、T1/T2/T3、结果迁移、三次重试预算、`awaiting_result` 不自动重发；Mock success 仍为 `simulated`，`deviceEffective=false`。
- **H4**：立即业务撤权、异步清理、local finalize、未知结果对账总契约；H4-a/b 已关闭；H4-c 已批准设计并分阶段编码。
- **H4-c**：只覆盖 **revoke job** 的 `awaiting_result` 人工对账；三种 decision；设计 `b15aceb` 已由 `ed7b66f` 批准；C1 待终审，C2/C3 未开始。
- **queryJob revision（07B）**：`2f597e3` Q1 裁定六字段 DTO；`bc2a8b2` 实现、`f584471`/`cf7c75e` 硬化。`revision` 是 job CAS 的唯一权威读模型，但 `queryJob` 的 HTTP 读取未批准，E06/E07/E08/E09 继续 blocked。

**关键结论：** H1～H4 没有定义以下内容：

- 设备列表/详情视图 DTO（型号、固件、灰度、在线、心跳）；
- 申请详情聚合 DTO（人员 + 房间 + 入住周期 + 设备 + 授权 + 同意记录）；
- 任务列表视图 DTO（`action`、`result`、`executionMode/provider/evidenceScope` 的公开投影）；
- 审计列表视图 DTO（`admin_audit` 与 `device_operation_logs` 的联合投影）；
- 分页/筛选、后台视图 DTO、错误码到 UI 的映射（HTTP 信封与 E01–E04 契约已由 `2f597e3` 定义，但九端点 0 注册）；
- 自由文本理由、同意记录、批次审批、导出、设备同步/写操作。

因此，页面当前大部分“业务字段”只能标 `[TBD]`，不能写成 `[FROZEN]`。

**queryJob 的例外与边界：** `queryJob` 六字段 DTO 是已裁定并已实现的服务层读模型（`2f597e3` Q1；`bc2a8b2`；`cf7c75e`），但它是**服务层方法**，不是已注册 HTTP 端点。页面不能直接调用服务层；在 `queryJob` HTTP 读取获批前，UI 仍没有合法 revision 来源，所有依赖 revision 的按钮必须隐藏/禁用并保持 0 请求。

### 2.3 页面与服务层分支关系

- 页面分支 `origin/feat/hk-face-admin` @ `2e8966b` 基于 `origin/main @ 282a20f`，只有页面与页面测试；不含 `admin-web/lib/face-service/`。
- 服务层基线 `1155b7b` 含 H1～H4-b 代码与测试；不含 `hk-face-admin/`。
- queryJob revision 分支 `cf7c75e`（含 `bc2a8b2`、`f584471`）只改服务层与测试；H4-c C1 `90e4189` 只改 C1 helper/证据；两者都不含页面。
- 页面、服务层、queryJob、H4-c **没有共同集成分支**。任何“页面直接接 API”的方案都必须先建集成分支，固定页面提交与服务提交，再注册路由；不能只在页面分支里写 `fetch`。

### 2.4 九个端点与 queryJob 的 HTTP 状态（本次修订核心）

`2f597e3` 的结论必须逐字成立：**九个端点在本卡合并后仍全部关闭；注册、调用、DTO 实现必须另发编码卡并重新复审。** 设计关闭不等于 HTTP 编码批准。

| ID | 端点 | 服务层 | 契约 | HTTP | revision 来源 | 页面后果 |
|---|---|---|---|---|---|---|
| E01 | `POST /api/v2/face-credentials` | implemented | implemented | **blocked** | not-applicable | 提交按钮不可用；只可保留 Mock |
| E02 | `GET /api/v2/face-credentials/review-queue` | implemented | implemented | **blocked** | credential `revision`（仅展示） | 审核队列不可接 |
| E03 | `POST /api/v2/face-credentials/:credentialId/review` | implemented | implemented | **blocked** | credential `revision`；HTTP 字段 `expectedCredentialRevision` 必填 | 通过/拒绝按钮不可用 |
| E04 | `GET /api/v2/face-credentials/:credentialId/image` | implemented | implemented | **blocked** | not-applicable | 原图入口不可用 |
| E05 | `POST /api/v2/device-access-grants/:grantId/revoke` | implemented | **blocked** | **blocked** | grant revision；无权威读取；未来至少 `expectedGrantRevision` | 撤权按钮不可用；`reasonCode` 冻结前不接 |
| E06 | `GET /api/v2/device-operation-jobs` | **blocked**（无 `listJobs()`） | proposed / blocked | **blocked** | job revision 只能按 ID `queryJob` | 任务列表不可接；不能用列表行做 revision |
| E07 | `POST /api/v2/device-operation-jobs/:jobId/retry` | **blocked**（无正式 retry；只有不完整 requeue） | proposed | **blocked** | job revision 只能按 ID `queryJob` | 重试按钮不可用；不得复用 requeue |
| E08 | `POST /api/v2/device-operation-jobs/:jobId/reconcile` | **blocked**（C1 仅 helper） | proposed | **blocked** | job revision 只能按 ID `queryJob`；`expectedRevision` 指 job revision | 对账按钮禁用；当前无 200/202 |
| E09 | `POST /api/v2/device-operation-jobs/:jobId/finalize-retry` | **blocked**（C3 未开始） | proposed | **blocked** | job revision 只能按 ID `queryJob` | 恢复按钮禁用；当前无入口 |
| — | `queryJob(jobId)`（**不是九端点**） | **implemented**（`bc2a8b2`/`cf7c75e`） | Q1 六字段已裁定；HTTP 未批准 | **未注册** | **job revision 唯一权威来源** | 无 HTTP 来源 → 依赖按钮禁用、0 请求 |

摘要：**HTTP blocked 9/9；0 注册；0 可接线。** E05 的“服务层 bodyless”只是实现事实，不是 HTTP 契约；E06 没有列表方法；E07 没有正式 retry；E08/E09 没有服务入口。`queryJob` 虽已实现服务层读模型，但其 HTTP 暴露不在九端点内，也未获批准。

**E05 的额外冻结门禁：** 当前没有权威 grant revision 读取；`expectedGrantRevision` 的字段命名、权威读取路径与 stale 409 语义，以及 `reasonCode` 的枚举/长度/持久化/审计/响应投影，都必须在独立的“撤权服务与 HTTP 契约加固”任务中冻结。**两者冻结前 E05 不得接线、不得注册、不得在页面接收。**

**UI 门禁（与 `2f597e3` §3.7/§3.8 一致）：**

1. job revision 只能来自按 ID 的 `queryJob`；mutation 前必须重查，且该 revision 只用于同一 job。
2. 无合法 revision（缺失、非法、HTTP 未实现、读取失败）→ 依赖它的“重试/对账/恢复”按钮**隐藏或禁用**；禁用态**不得发请求**，不得点击兜底猜测，不得发探测请求。
3. 禁止从列表行号、数组下标、本地自增、旧 mutation 响应、缓存旧值、时间戳、`attempts`、`cleanupPending` 推导 revision。
4. `awaiting_result`/`UNKNOWN_RESULT` 只允许只读查询与人工对账；禁止 retry、普通 requeue、自动轮询、定时器、回调、Provider `queryOperation`。
5. E08/E09 未注册 → 页面不得渲染可执行的“对账/恢复”按钮；只能显示不可用原因，网络请求为 0。
6. 权限撤销后下一次请求立即 403；页面清空数据/私密内容/按钮，不得用旧 200 响应覆盖 forbidden。
7. 候选路由事实：`routes.mjs` 有 8 条描述行；E08 有描述行但 server 未注册；E09 不在表；E07/E08 描述行是历史提案，Q8 要求未来独立小提交清理，本轮零修改。

## 3. 权限审计

### 3.1 正式权限点与页面用法

正式权限目录见 `admin-web/lib/org.mjs`（`1155b7b`）第 90–105 行，共 7 个：

`device.face.submit`、`device.face.review`、`device.face.readPrivate`、`device.access.manage`、`device.audit.read`、`device.operation.retry`、`device.operation.reconcile`。

页面 `hk-face-admin/app.js:120-125` 的 `PERM_NOTE` 使用：

| 页面 | 页面当前权限 | 正式权限 | 判定 |
|---|---|---|---|
| 设备 | `device.manage` | 无此权限点；管理为 `device.access.manage` | **P0 不一致** |
| 申请 | `device.face.review` | `device.face.review`（审核）；`device.face.submit`（提交）；`device.access.manage`（授权/撤权）；`device.face.readPrivate`（原图） | 只覆盖审核，缺三权 |
| 任务 | `device.operation.retry` | 读取 `device.audit.read`；重试 `device.operation.retry`；对账 `device.operation.reconcile` | 读/写混淆，缺对账 |
| 审计 | `device.audit.read` | `device.audit.read` | 名称正确，但仅用于 forbidden 文案，未用于行级/查询门控 |

页面 `hk-face-admin/tests/hk-ai-05a-static-check.mjs:452` 把 `device.manage` 放进“冻结权限白名单”。这是 **HK-AI-05A 页面级白名单**，不是 H1～H4 组织权限目录；两者冲突必须由 Codex 裁定。

### 3.2 七权限逐项审计

| 权限 | 正式语义 | 页面当前行为 | 目标行为 | 差距 | 依赖阶段 |
|---|---|---|---|---|---|
| `device.face.submit` | `submit` 只建 credential（`personId/sourceFileId`） | 完全没有；申请页只有“新建申请（演示占位）” | 独立提交入口；只收集人员与人脸来源；无设备/授权/周期字段；成功进 `submitted` | **E01 服务 implemented / HTTP blocked**；页面缺流程 | W0/W3 |
| `device.face.review` | `review` 只做 approve/reject；HTTP 字段 `expectedCredentialRevision` 必填 | 审核页四个按钮（通过/拒绝/撤销/补件）全部在 `device.face.review` 下；理由必填但只写本地 toast | 通过/拒绝走 review；撤销走 `device.access.manage`；补件无正式路由，暂不提供 | **E03 服务 implemented / HTTP blocked；审核/撤权/补件混权** | W0/W3 |
| `device.face.readPrivate` | `GET /face-credentials/:id/image` 已冻结；逐次授权、独立于 review | 只有一个本地 checkbox + “需逐次授权查看”占位；不加载字节 | 独立原图入口；每次请求复核权限；审计；不缓存；不在列表/日志/任务页泄露字节/URL | **E04 服务 implemented / HTTP blocked**；无真实读取与审计 | W0/W3 |
| `device.access.manage` | `createGrant` 与 `revoke` 的组织成员权限 | 无；设备页用不存在的 `device.manage`；申请页没有创建授权/撤权入口 | createGrant 八项输入；revoke **服务 implemented、HTTP blocked**；未来 mutation 至少 `expectedGrantRevision`；`reasonCode` 冻结前不接 | **权限名错误 + 功能缺失；revoke HTTP blocked** | W0/W3 |
| `device.audit.read` | 任务/审计读取；`queryJob` 服务层已用它；HTTP 读取未批准 | 任务页整页用 retry 权限门控；审计页只用它显示 forbidden 文案 | 任务列表/查询、审计列表/查询用 audit.read；`queryJob` 只按 ID 读；只读用户可看不可操作 | **读/写权限混淆；E06 列表 blocked；queryJob HTTP 未注册** | W0/W4/W5 |
| `device.operation.retry` | 仅 `retryable_failed` 且到 `nextAttemptAt`；E07 未注册 | 有 checkbox；仅 retryable 行显示重试；无 due/revision/attempts 上限 | **E07 proposed/blocked**；未来必须 `expectedJobRevision` + K2/摘要/域/严格重放；**不复用不完整 requeue**；未知结果永不出重试 | **E07 未实现、未注册；页面按钮须禁用** | W0/W4 |
| `device.operation.reconcile` | 仅 `awaiting_result` 的人工终态裁定；E08 未注册 | **完全没有**；unknown 行“人工对账”按钮无门控；错误态也有“人工对账（演示）” | H4-c 设计已批准；三 decision + evidence + `expectedRevision`；**C1 终审+C2+C3+RC01–RC73 前不注册**；无权限 403 | **P0 缺权限/DTO/服务入口；当前无可执行按钮** | W0/W4 |

### 3.3 权限差距台账

| ID | 页面 | 当前行为 | 目标行为 | 依赖阶段 | 验收方法 |
|---|---|---|---|---|---|
| G-P01 | 设备页 | 使用 `device.manage`；权限目录无此点 | 改为正式读/管理权限；页面静态白名单同步 | W0/W2 | 契约评审 + T-P01 + T-P13 |
| G-P02 | 申请页 | 通过/拒绝/撤销/补件全部在 `device.face.review` 下 | 通过/拒绝走 review；撤销走 `device.access.manage`；补件无契约不提供 | W0/W3 | T-P02 + T-P03 + T-APP03 |
| G-P03 | 申请页 | 无 `device.face.submit` 提交流程 | 独立提交入口，只收 `personId/sourceFileId` | W0/W3 | T-P08 + T-C02 + T-APP01 |
| G-P04 | 申请页/设备页 | 无 `device.access.manage` 创建授权/撤权 | createGrant 八项输入；revoke grantId + CAS；独立权限 | W0/W3 | T-P03 + T-C03 + T-C05 + T-APP02 |
| G-P05 | 申请页 | `readPrivate` 只是本地 checkbox + 占位 | 独立原图入口；逐次权限/审计；不缓存 | W0/W3 | T-P04 + T-PR06 + T-APP05 |
| G-P06 | 任务页/错误态 | 无 `device.operation.reconcile`；按钮无门控 | 独立权限；三 decision/evidence/version；403 可处理 | W0/W4 | T-P07 + T-U01..U12 |
| G-P07 | 任务页 | 整页用 `device.operation.retry` 门控 | 读取用 `device.audit.read`；操作分别用 retry/reconcile | W1/W4 | T-P05 + T-P06 |
| G-P08 | 审计页 | `device.audit.read` 只用于 forbidden 文案 | 列表/查询/详情均按 audit.read；无权限不返回数据 | W1/W5 | T-P05 + T-AU01 |
| G-P09 | 全局 | 本地 checkbox 模拟权限撤销 | 服务端会话复核；403 清空数据；重新拉权限 | W1/W6 | T-P10 + T-E03/T-E12 |
| G-P10 | 设备页 | 无正式设备读取权限定义 | W0 裁定 `device.access.manage`/`device.audit.read`/新 `device.read` | W0 | 契约评审 + T-P01 |

### 3.4 权限撤销与会话

页面没有真实会话，只有三个本地 checkbox：

- `perm-review`：取消后整页切 `forbidden`（`app.js:394-396`）；
- `perm-retry`：取消后禁用已有重试按钮（`app.js:398-403`）；
- `perm-private`：只弹 toast，不改变任何内容（`app.js:411-414`）。

目标行为：

1. 权限来自认证会话与组织成员关系，不由页面开关决定；
2. 每次请求由服务端在事务内复核；页面只做展示与快速失败；
3. 权限被撤销后，**下一次请求立即 403**；页面清除数据/私密内容，切 forbidden，不保留可继续操作的按钮；
4. 正在进行的请求返回 403 时，**不得用旧 200 响应覆盖 forbidden**；页面必须丢弃旧响应并重新拉权限；
5. 组织切换/重新登录必须重新拉取权限，不使用旧缓存；服务端不得缓存权限结论；
6. 页面不得把“本地取消 checkbox”当作权限撤销测试通过。

## 4. 状态审计

### 4.1 四轴状态与页面用词

正式状态轴（`dto.mjs:20-50`）：

| 轴 | 枚举 | 页面是否使用 |
|---|---|---|
| 凭证审核 | `draft/submitted/approved/rejected/revoked` | 未使用；页面写“待审批（合成）”“已补件（合成）” |
| 图片质量 | `pending/verified/rejected` | 未使用 |
| 授权 | `pending/effective/suspended/revoked/expired` | 未使用；页面“审核状态”混用了凭证与授权 |
| 任务 | `queued/sending/awaiting_result/succeeded/retryable_failed/terminal_failed/cancelled` | 只用 `succeeded`、`awaiting_result`、`retryable_failed` |

`publicReviewItem` 还会投影 `displayState`：`revoked/rejected/image_rejected/approved/pending_review/draft`（`dto.mjs:235-251`）；`publicAccessState` 投影 `revoking/revoked/failed/awaiting_result/active/simulated/pending_sync`（`dto.mjs:208-233`）。页面没有这些投影。

### 4.2 八个任务状态展示矩阵

| 状态 | 正式语义 | 允许动作 | 页面当前 | 目标展示 | 判定 |
|---|---|---|---|---|---|
| `pending` | **授权**状态，不是任务状态；H2 创建后 grant=pending、job=queued | 无（等待派发） | 申请页“待审批”实际是凭证 `submitted`；没有 grant pending 表达 | 凭证显示 `submitted`；授权单独显示 `pending`；两者不合并 | **P1 概念混淆** |
| `queued` | job 已建单、未领取；attempts=0，lease=null | 无重试；取消需后续批准 | 无行；统计“执行中”只写“模拟排队下发” | 行级 `queued`；显示 attempts=0；不显示重试；`nextAttemptAt=null` | **P1 缺失** |
| `sending` | 已领取、有 lease/fence；10 秒调用窗口 | 无取消、无重试；超时/崩溃 → `awaiting_result` | 无行；`retrying` 是 UI 演示态 | 行级 `sending`；显示“发送中”；禁止取消/重试；不可当成 `retrying` | **P1 缺失/命名冲突** |
| `awaiting_result` | 结果未知；只能人工对账；永不自动重发 | 查询；`device.operation.reconcile`（仅 revoke 有 H4-c 契约） | 有 1 行 `UNKNOWN_RESULT`；按钮 query+reconcile；reconcile 无权限门控 | 行级 `awaiting_result`；只读查询 + 人工对账；对账需权限/decision/evidence/expectedRevision；**E08 未注册 → 按钮禁用、0 请求**；enroll 仅查询（TBD）；禁止 retry/requeue/auto | **P0 对账未接线** |
| `retryable_failed` | 可重试失败；需到 `nextAttemptAt`；最多 3 次重试（attempts=1/2/3 后 next） | 查询；`device.operation.retry`（到期） | 有 1 行；retry 受 checkbox 门控；无 due/attempts 上限 | 显示 `nextAttemptAt`；未到期禁用；**E07 未注册 → 按钮禁用**；未来带 `expectedJobRevision`；`attempts=4` 直接 terminal；409/403 提示 | **P0 门控不足；E07 blocked** |
| `terminal_failed` | 终态；alertCode/reasonCode；不可重试 | 查询（只读） | 无行；只在 error 态文案出现“TERMINAL（合成）” | 行级 `terminal_failed`；显示 alertCode/reasonCode；无重试/对账 | **P1 缺失** |
| `succeeded` | job 成功不等于设备生效；Mock 下 `deviceEffective=false` | 查询 | 有 1 行；显示 `succeeded`；没有 `deviceEffective` 投影 | 显示 `succeeded` + `simulated` + `真实设备生效：否`；只有 `device_verified` 才可 `active` | **P1 投影缺失** |
| `cancelled` | 终态；可从 queued/retryable_failed 进入 | 无 | 无 | 行级 `cancelled`；无操作；不显示重试 | **P2 缺失** |

### 4.3 状态差距台账

| ID | 页面 | 当前行为 | 目标行为 | 依赖阶段 | 验收方法 |
|---|---|---|---|---|---|
| G-S01 | 申请页 | “待审批”是凭证 `submitted`；没有 grant `pending` | 凭证审核轴与授权轴分开显示；`pending` 只用于 grant | W3 | T-J11 + T-C10 |
| G-S02 | 任务页 | 无 queued 行；“执行中”只写“模拟排队下发” | 行级 `queued`；attempts=0；无重试；`nextAttemptAt=null` | W4 | T-J01 |
| G-S03 | 任务页 | 无 sending 行；`retrying` 是 UI 态 | 行级 `sending`；禁止取消/重试；超时→awaiting_result | W4 | T-J02 + T-S01..S24 |
| G-S04 | 任务页 | awaiting_result 有行，但 reconcile 无权限/无 H4-c DTO | 三 decision + evidence + expectedRevision；200/202/terminal；enroll 仅查询 | W0/W4 | T-P07 + T-J12..J15 |
| G-S05 | 任务页 | retryable_failed 有行；无 due/attempts 上限/`expectedJobRevision` | 到期才可重试；attempts=4→terminal；409/403；**E07 未注册时按钮禁用** | W4 | T-J04..J06 + T-R11 |
| G-S06 | 任务页/错误态 | terminal_failed 只在 error 文案出现 | 行级 terminal_failed；alertCode/reasonCode；无操作 | W4 | T-J07 + T-AU06 |
| G-S07 | 任务页 | succeeded 有行；无 `deviceEffective`/`evidenceScope` 投影 | 显示 `simulated`；真实生效否；只有 device_verified 才 active | W6/W7 | T-J09/T-J10 + T-M05 |
| G-S08 | 任务页 | 无 cancelled | 行级 cancelled；无操作；不显示重试 | W4 | T-J08 |
| G-S09 | 四业务页 | `retrying` 作为六态之一，文案“受控重试中” | 只作局部 action pending；不写 job 枚举；不暗示自动重试 | W4 | T-C10 + T-S01..S24 |
| G-S10 | 任务页/审计页 | 无 cleanupPending/cleanupPhase/terminalReason | 按 H4-b/H4-c 投影；revoking/terminal 不误释放资源 | W4/W5 | T-J16 + T-U12 |

### 4.4 命名冲突与 `retrying`

- 静态审计 N-01 记录过两套任务状态命名冲突（`queued/sending/...` 与 `pending/processing/...`）。H1～H4 已用 `JOB_STATE` 冻结为 `queued/sending/awaiting_result/succeeded/retryable_failed/terminal_failed/cancelled`，因此**任务轴以 H1～H4 为准**。
- 页面的 `retrying`（`app.js:126`、`166-173`、`427-433`）是**六态 UI 演示状态**，不是服务端 job 状态。它不能映射为 `retrying` job；目标 UI 若需要“重试请求进行中”，应作为局部 action pending，不得写进 job 枚举。
- 页面把“系统自动重试已关闭”与“受控重试中”放在同一状态，容易被误读为自动重试正在运行。接线后必须区分：自动重试永不发生；人工/受控重试是显式请求，且仅 `retryable_failed` 到期。

### 4.5 job revision 与 mutation 门控

`queryJob` 是 job revision 的唯一权威入口。`2f597e3` Q1 冻结六字段 `jobId/state/revision/attempts/lastSuccessAt/failureReason`；`bc2a8b2` 落地，`cf7c75e` 硬化。`revision` 必须为正安全整数，且只来自服务端当前 job 记录。

| 失败类 | 服务端行为 | UI 行为 | 网络 |
|---|---|---|---|
| revision 缺失（记录无 `revision`/读取未实现/读取失败） | `INVALID_JOB/409`，零写 | 隐藏或禁用依赖按钮，显示“未取得合法任务版本，暂不可操作”；不得猜测 | 依赖 mutation **0 请求** |
| revision 非法（0/负数/小数/字符串/NaN/Infinity/≥2^53） | 服务端记录侧 `INVALID_JOB/409`；客户端传入侧 `PARAM_ERROR/400`，零写 | 禁用按钮；不得转换/截断/补默认值 | 0 请求 |
| revision stale（与当前 job 不一致） | `REVISION_CONFLICT/409`，零写 | 显示冲突，重新按 ID `queryJob`；不得自动重试/自动覆盖 | 仅用户显式再次操作时重查 |
| 权限撤销 | 下一次请求 `403`，零业务写 | 清空数据/私密内容/按钮，切 forbidden；旧 200 不覆盖 | 0 mutation |
| E07/E08/E09 未注册 | `404/405`，不进入业务 | 按钮隐藏/禁用，显示“接口未注册/前置未完成” | **0 请求** |

**revision 禁止来源：** 列表行号、数组下标、本地自增、旧 mutation 响应、缓存旧 revision、时间戳、`attempts`、`cleanupPending`、digest 前缀、客户端自算。任何“先发请求再判断”的探测都不允许。

**mutation 字段命名（Q2）：** Review/CreateGrant 用 `expectedCredentialRevision`；Revoke 未来用 `expectedGrantRevision`；requeue/retry 未来用 `expectedJobRevision`；Reconcile/Finalize-retry 用 `expectedRevision`（指 job revision）；所有读取端点不带 revision 字段。

## 5. 逐页审计

> §3.3、§4.3、§5.1–§5.6 的 `G-` 表保留“当前行为/目标/阶段”；全部 66 项的**依赖提交、服务/契约状态、HTTP/页面状态**统一见 §5.7，ID 一一对应，不重复维护两套状态。

### 5.1 设备页 `devices.html`

**本轮状态：** 设备读取不在九端点内，HTTP blocked；设备视图 DTO 仍未批准。新增/同步/导出按钮必须禁用并说明原因。设备行不消费 job revision，因此 revision 门控不影响设备行本身，但也不能把 job 的 `executionMode/evidenceScope` 塞进设备行。

**当前行为（`2e8966b`）：**

- 3 条合成设备（`app.js:70-80`）：`DEV-DEMO-001..003`，字段 `id/model/fw/capability/grey/prov/online/heartbeat`。
- 8 列表格（`app.js:193-195`）：设备编号、型号、固件、capability 状态、灰度、provider/executionMode/evidenceScope、在线、心跳。
- 3 个占位按钮（`devices.html:59-63`）：新增设备、导出清单、同步状态；点击仅 toast，无副作用。
- 权限提示 `device.manage`（`app.js:121`）；forbidden 态显示它（`app.js:149-155`）。
- Mock 横幅写死（`devices.html:41-50`），每页一份。
- 无详情、分页、筛选、聚合 DTO；统计卡 4 个（`app.js:182-187`）。

**字段映射：**

| 页面字段 | Mock 示例 | 正式来源 | 状态 | 说明 |
|---|---|---|---|---|
| 设备编号（脱敏） | `DEV-DEMO-001` | `access_devices._id`（内部有界 ID） | `[FROZEN]` 内部 / 视图 `[TBD]` | 不能显示 `serialNumber`；ID 是否可展示待视图 DTO |
| 型号 | `MODEL-DEMO-A1` | H1～H4 无 | `[TBD]` | 可能来自设备接入/DB-08，但不在本契约 |
| 固件版本 | `FW-DEMO-2.4.0` | H1～H4 无；`LOCK-01A` 只是“缺固件→NOT_CONFIGURED” | `[TBD]` | 不是列表 DTO 字段 |
| capability 状态 | `capability=face.grant / 就绪` | `access_devices.capabilities.face`（boolean） | `[FROZEN]` 内部 / 视图 `[TBD]` | 只能映射“是否支持人脸”，不能映射“grant/就绪” |
| 灰度状态 | `canary-10%` 等 | H1～H4 无 | `[TBD]` | 无灰度字段/枚举 |
| provider/executionMode/evidenceScope | `mock / test / simulated` | `access_devices.provider`；`executionMode/evidenceScope` 在 **job** | `[FROZEN]` 部分 / **对象错位** | 设备记录没有 executionMode/evidenceScope；不能把 job 字段塞进设备行 |
| 在线状态 | `在线（模拟）` | H1～H4 无 | `[TBD]` | 不能声称真实在线 |
| 最近心跳 | `2026-11-07 09:12（模拟）` | H1～H4 无 | `[TBD]` | 无心跳字段/时区/来源 |
| 统计卡 4 项 | 3/1/1/1 | H1～H4 无聚合 DTO | `[TBD]` | 统计口径、时间窗、离线阈值均未定义 |
| 新增/同步/导出 | 占位按钮 | 无设备写/同步/导出路由 | `[TBD]`；本阶段 `[FORBIDDEN]` | 不得在正式页面提供设备写入口 |

**差距台账：**

| ID | 页面 | 当前行为 | 目标行为 | 依赖阶段 | 验收方法 |
|---|---|---|---|---|---|
| G-D01 | 设备页 | 8 个字段中仅 ID/provider/capabilities.face 有正式内部对应；其余 5 个为 Mock | 先批准设备视图 DTO；只展示已批准字段；未批准字段不出现 | W0/W2 | 契约评审 + T-C01 + T-D01 |
| G-D02 | 设备页 | 型号/固件/灰度/在线/心跳无来源 | 若保留，必须给出来源、类型、空值、脱敏、时区；否则删除 | W0/W2 | 字段清单逐项签字 + T-D02 |
| G-D03 | 设备页 | 把 job 的 executionMode/evidenceScope 放在设备行 | 设备行只放设备字段；环境信息放全局横幅或 job 行 | W2 | T-D03 |
| G-D04 | 设备页 | 无详情/分页/筛选/聚合 | 只做已批准列表；分页/筛选按视图 DTO；无聚合不显示统计卡 | W2 | T-D04 |
| G-D05 | 设备页 | 新增/同步/导出按钮可点（toast） | 未批准前禁用并说明；正式接线后按权限/路由开放 | W1/W2 | T-P14 + T-D05 |
| G-D06 | 设备页 | 无跨组织/404 状态 | 跨组织与不存在统一 404；不泄露存在性 | W2/W6 | T-P11 + T-E04 |
| G-D07 | 设备页 | 无 serial/IP/MAC/凭据禁显门控 | 字段白名单 + 扫描；任何真实硬件标识不得进 DOM/日志/截图 | W6 | T-PR02 + T-PR08 |

### 5.2 凭证/申请页 `applications.html`

**本轮状态：** E01 submit、E03 review、E04 image、E05 revoke 全部 HTTP blocked；createGrant 仍无 HTTP。revoke 服务已 implemented，但未来 mutation 至少 `expectedGrantRevision`，`reasonCode` 冻结前不接收。审核通过/拒绝、撤销、原图、新建、批量、导出均不可接；理由/同意仍为 `[TBD]`。

**凭证（credential）域核对（`2e8966b`）：**

| 正式字段/状态 | 来源 | 页面当前 | 判定 |
|---|---|---|---|
| `credentialId` | `face_credentials._id`；`publicReviewItem.credentialId` | 显示为“申请单号 `APP-DEMO-0001`” | `[TBD]`：ID 语义混用；正式 `credentialId` 形如 `fc-...` |
| `personId` | `face_credentials.personId` | 显示为“人员代号” | `[FROZEN]` |
| `sourceFileId` / `sourceFileRevision` | `face_credentials` 内部字段 | 未显示 | `[FROZEN]` 内部；展示 `[TBD]`，且不得显示文件字节/`objectKey` |
| `reviewState` | `draft/submitted/approved/rejected/revoked` | 写“待审批/已补件” | `[FROZEN]`；页面未用枚举 |
| `imageState` | `pending/verified/rejected` | 未显示 | `[FROZEN]`；视图 `[TBD]` |
| `evidenceScope` | `simulated/device_verified` | 未按记录显示 | `[FROZEN]`；`device_verified` 仅 W7 |
| `revision` / `submittedAt` | credential 记录 | 未显示 | `[FROZEN]` 内部；详情是否展示 `[TBD]` |
| `cleanupPending` | credential 公开投影 | 未显示 | `[FROZEN]`；详情是否展示 `[TBD]` |
| `device/grant/validFrom/validUntil/occupancy/cycle` | **不在 credential 上**；在 grant/occupancy/cycle | 页面把设备/周期/授权放在“申请详情” | `[TBD]`：必须拆到 grant/occupancy/cycle 聚合，不能写进 credential |
| submit 输入 | 只允许 `personId/sourceFileId` | “新建申请”无表单 | `[FROZEN]`；**E01 HTTP blocked** |
| review 输入 | `decision` + `expectedCredentialRevision`（HTTP 必填） | 四个按钮都走 review，无 revision | `[FROZEN]`；**E03 HTTP blocked** |

**当前行为：**

- 2 条合成申请（`app.js:81-90`），但只展示第一条（`app.js:202`）。
- 详情 8 项（`app.js:213-216`）：人员代号、房间代号、入住周期、目标设备、授权起止、审核状态、同意记录、申请单号。
- 4 个操作按钮（`app.js:224-227`）：审核通过、拒绝、撤销、补件；全部挂 `data-action="review"`，全部在 `device.face.review` 下；理由必填（`app.js:336-351`）但只写本地操作记录。
- 私密区占位（`app.js:218-220`）；两个 checkbox（`app.js:231-235`）；`readPrivate` 勾选只弹 toast（`app.js:412-414`）。
- 顶部 3 个占位按钮（`applications.html:59-63`）：新建申请、批量审批、导出。
- 无 grant 创建、无 `access.manage`、无 `expectedRevision`、无 409 处理、无字段级权限。

**字段映射：**

| 页面字段 | Mock 示例 | 正式来源 | 状态 | 说明 |
|---|---|---|---|---|
| 人员代号 | `PERSON-DEMO-001` | `face_credentials.personId` / `publicReviewItem.personId` | `[FROZEN]` | 有界不透明 ID；不能显示姓名/手机号 |
| 房间代号 | `ROOM-DEMO-A-101` | `device_access_grants.occupancyId` / `cycleId`（需再解析 room） | `[FROZEN]` 内部 / 视图 `[TBD]` | 没有“房间代号”直接字段；需 occupancy/room 视图 |
| 入住周期 | `2026-11-01 ~ 2026-11-30（演示）` | occupancy/cycle 有效区间 | `[TBD]` 派生 | 不是 credential/grant 字段；需定义聚合与格式 |
| 目标设备 | `DEV-DEMO-001` | `device_access_grants.deviceId` | `[FROZEN]` 内部 / 视图 `[TBD]` | 显示名/脱敏待定 |
| 授权起止时间 | `2026-11-01 00:00 ~ ...` | `device_access_grants.validFrom/validUntil`（毫秒安全整数） | `[FROZEN]` 内部 / 格式 `[TBD]` | 时区、格式、是否含端点待定 |
| 审核状态 | `待审批（合成）` / `已补件（合成）` | `face_credentials.reviewState` + `displayState` | `[FROZEN]` | 页面未用枚举；“已补件”不是正式状态 |
| 同意记录 | `已签署（合成）` | H1～H4 无；HK-AI-03 报告“未开始” | `[TBD]` | 未批准前不得作为正式字段展示 |
| 申请单号 | `APP-DEMO-0001` | `credentialId` 或 `identityApplicationId`？ | `[TBD]` | 页面把“申请”与“凭证”混为一谈；正式 `credentialId` 形如 `fc-...` |
| 私密内容 | 占位 | `GET /face-credentials/:id/image` 已冻结契约 | `[HTTP-BLOCKED]` | E04 未注册；逐次授权；无字节/URL/objectKey |
| 新建/批量/导出 | 占位 | 无 submit 表单、无批量、无导出路由 | `[TBD]` | 本阶段不提供批量/导出 |

**差距台账：**

| ID | 页面 | 当前行为 | 目标行为 | 依赖阶段 | 验收方法 |
|---|---|---|---|---|---|
| G-A01 | 申请页 | “新建申请”只是 toast；没有 `device.face.submit` | 独立提交表单，只收 `personId/sourceFileId`；成功 `submitted`；无设备/授权/周期字段 | W0/W3 | T-C02 + T-P08 + T-APP01 |
| G-A02 | 申请页 | 没有创建授权/`access.manage` | 审核通过后单独 `createGrant`，八项输入；`expectedCredentialRevision`；失败 409；**createGrant 仍无 HTTP** | W0/W3 | T-C03 + T-P03 + T-APP02 |
| G-A03 | 申请页 | 通过/拒绝/撤销/补件全在 review 权限下 | 通过/拒绝走 review；撤销走 `device.access.manage` + grantId；补件无契约，暂不提供；**E03/E05 HTTP blocked** | W0/W3 | T-P02 + T-APP03 |
| G-A04 | 申请页 | 无 `expectedRevision`/`Idempotency-Key` | review/createGrant 用 `expectedCredentialRevision`；revoke 未来用 `expectedGrantRevision`；全部带幂等键；409 提示刷新 | W0/W3 | T-C04 + T-I02..I04 |
| G-A05 | 申请页 | `readPrivate` 仅本地 checkbox；无请求/审计 | 独立原图入口；每次复核权限；记录读取审计；不缓存；**E04 HTTP blocked** | W0/W3 | T-P04 + T-PR06 + T-APP05 |
| G-A06 | 申请页 | 自由文本理由必填，但只写本地 toast | 要么新增已批准的审计备注字段，要么删除“已记录理由”的承诺；**revoke `reasonCode` 冻结前不接** | W0/W3 | T-C05 + T-APP06 |
| G-A07 | 申请页 | “同意记录：已签署（合成）”无正式字段 | 未批准前标 `[TBD]`，不作为正式数据；如需展示先补 consent 契约 | W0 | 契约评审 + T-APP07 |
| G-A08 | 申请页 | 申请单号/凭证 ID/identityApplicationId 混用 | 明确三种 ID 的语义与展示；列表用 credentialId；授权用 grantId/identityApplicationId | W0/W3 | T-C01 + T-APP08 |

### 5.3 任务页 `tasks.html`

**本轮状态：** E06 list、E07 retry、E08 reconcile、E09 finalize-retry 全部 HTTP blocked。`queryJob` 服务层六字段读模型已实现（`bc2a8b2`/`cf7c75e`），但 HTTP 未注册；页面没有合法 revision 来源 → 所有 mutation 按钮必须隐藏/禁用、0 请求、显示原因。`awaiting_result` 只允许只读查询与人工对账；人工对账需 H4-c C1 终审 + C2 + C3 + RC01–RC73，当前无可执行按钮。

**当前行为：**

- 3 条任务（`app.js:91-104`）：succeeded、awaiting_result/UNKNOWN_RESULT、retryable_failed。
- 8 列表格（`app.js:276-281`）：jobId、action/state、结果、attempts、failureReason、lastSuccessAt、executionMode/provider/evidenceScope、操作。
- unknown 行只有 query+reconcile（`app.js:247-249`）；retryable 行有 query+retry（`app.js:250-252`）；succeeded 行只有 query（`app.js:253-255`）。
- retry 按钮受 `device.operation.retry` checkbox 门控（`app.js:271-274`、`398-403`）；reconcile **无权限门控**。
- 统计“执行中 1 / 等待中 0 / 成功 1 / 未知结果 1”（`app.js:261-266`），但没有 queued/sending 行。
- 错误态也有“人工对账（演示）”按钮（`app.js:163`），无权限门控。

**字段映射：**

| 页面字段 | Mock 示例 | 正式来源 | 状态 | 说明 |
|---|---|---|---|---|
| jobId | `JOB-DEMO-0001` | `queryJob.jobId` | `[FROZEN]` | 六字段读模型；HTTP 未注册 |
| revision | 无（页面无此字段） | `queryJob.revision`（正安全整数，仅当前 job 记录） | `[FROZEN]` 服务模型 / `[HTTP-BLOCKED]` | **job revision 唯一权威来源**；无 HTTP 读取 → mutation 按钮禁用、0 请求；禁止列表/缓存/本地推导 |
| action / state | `grant.face / succeeded` | `job.action/state`；公开 DTO 只保证 `state` | `[FROZEN]` 内部 / action 公开 `[TBD]` | `action` 不在 `queryJob` 六字段 |
| 结果 | `SUCCEEDED/RETRYABLE/UNKNOWN_RESULT` | `publicJobResult` 无 `result`；内部 `job.result` | `[TBD]` | 需视图 DTO 或只显示 state |
| attempts | `1/2/3` | `queryJob.attempts` | `[FROZEN]` | 0–4；显示上限需说明 |
| failureReason | 脱敏合成文本 | `queryJob.failureReason` | `[FROZEN]` **但有遗留 bug** | `queryJob` 已收紧私有白名单；`publicJobResult` 仍读 `job.failureReason`，H3 写 `job.result`，见 G-T04；二者不得混用 |
| lastSuccessAt | 时间（模拟） | `queryJob.lastSuccessAt` | `[FROZEN]` | 可能 null；时区/格式待定 |
| executionMode/provider/evidenceScope | `test/mock/simulated` | 内部 `job` 字段 | `[TBD]` | 不在 `publicJobResult`；适合全局横幅/详情，不适合列表 |
| 操作 query | 有 | `queryJob(jobId)` 服务方法已实现六字段；HTTP 未批准/未注册 | `[HTTP-BLOCKED]` | 只能按 ID 重查；不能用列表行做 revision |
| 操作 retry | 有 | `POST /device-operation-jobs/:jobId/retry` 是 E07 候选；未注册；`device.operation.retry` | `[PROPOSED]`/`[HTTP-BLOCKED]` | E07 未实现；未来 `expectedJobRevision`；**不得复用 requeue** |
| 操作 reconcile | 有 | `POST /device-operation-jobs/:jobId/reconcile` 是 E08 候选；H4-c 三 decision；未注册 | `[PROPOSED]`/`[HTTP-BLOCKED]` | C1 终审+C2+C3+RC01–RC73 前不注册；当前无 200/202；按钮禁用 |
| 统计卡 4 项 | 1/0/1/1 | H1～H4 无聚合 DTO | `[TBD]` | “执行中/等待中”没有枚举映射 |

**差距台账：**

| ID | 页面 | 当前行为 | 目标行为 | 依赖阶段 | 验收方法 |
|---|---|---|---|---|---|
| G-T01 | 任务页 | 只有 3 个 job 状态行 | 覆盖 queued/sending/awaiting_result/retryable_failed/terminal_failed/succeeded/cancelled；按状态显示允许动作 | W4 | T-S01..S08 + 截图矩阵 |
| G-T02 | 任务页 | reconcile 按钮无权限门控、无 DTO/服务入口 | H4-c 设计已批准；`device.operation.reconcile`；三 decision + evidence + expectedRevision；**C1 终审+C2+C3+RC01–RC73 前 E08 不注册**；当前无可执行按钮 | W0/W4 | T-P07 + T-U01..U12 + T-R13 |
| G-T03 | 任务页 | retry 只受 checkbox 控制 | **E07 proposed/blocked**；未来仅 `retryable_failed` 到期 + `expectedJobRevision` + K2/幂等；**不复用 requeue**；attempts=4 terminal；409/403 | W4 | T-J04..J06 + T-I05 + T-R11 |
| G-T04 | 任务页 | `failureReason` 从 `job.failureReason` 读，H3 实际写 `job.result` | 统一公开投影从 `job.result` 取脱敏 `reasonCode`/`errorKind`；无值显示 `—`；`queryJob` 白名单不得复用到 `publicJobResult` 而不评审 | W0/W4 | 契约测试 + T-C08 |
| G-T05 | 任务页 | 公开行显示 action/result/env，但 `publicJobResult` 不提供 | 只显示已批准公开字段；其余进详情或全局横幅 | W0/W4 | T-C08 + T-C01 |
| G-T06 | 任务页 | 页面没有自动重试按钮，但无服务端保证证明 | 服务端禁止 `awaiting_result` 自动查询/重试/回调/普通 requeue；页面无自动定时器；**E08 未注册 → 对账按钮禁用** | W4 | T-U01 + T-R12 + 代码/契约评审 |
| G-T07 | 任务页 | unknown 的 reconcile 对 enroll 任务也开放 | enroll 的 `awaiting_result` 仅查询；人工对账仅 revoke（H4-c）或等 H4-d 批准 | W0/W4 | T-U02 + 契约评审 |
| G-T08 | 任务页 | 无 cross-org 404 | 同组织外 job 统一 404；不显示存在性 | W4/W6 | T-P11 + T-E04 |
| G-T09 | 任务页 | 无幂等/重复点击保护 | E07/E08 的 K2/摘要/域/严格重放均未实现；未来带 `Idempotency-Key`；按钮防重复 | W4 | T-I05..I06 + T-R08/T-R09 |

### 5.4 审计/对账页 `audits.html`

**本轮状态：** 九端点中没有审计读取端点；`queryJob` 只读 job，不是审计查询。审计列表/查询/分页/导出全部 `[HTTP-BLOCKED]`；对账事件只读展示，不能替代任务页的人工对账。页面“非不可变”声明保持不变。

**当前行为：**

- 6 条合成事件（`app.js:105-119`）：批准、拒绝、查看原图申请、重试、撤销、人工对账；字段 time/type/subject/result/reason/target。
- 7 列表格（`app.js:303-307`）；每行一个“查询（演示）”按钮（`app.js:291-292`）。
- 统计 4 项（`app.js:294-299`），其中“今日通行/今日告警”为 0，“日志保留”为 `—`。
- 页面声明“不写入真实或不可变存储”（`app.js:301-302`、`audits.html:82`），这是正确的；但“不可变操作审计查询”在任务卡中是目标，不是现状。
- 没有权限门控到行/查询；没有分页/筛选/导出实现（按钮占位）。

**字段映射：**

| 页面字段 | Mock 示例 | 正式来源 | 状态 | 说明 |
|---|---|---|---|---|
| 发生时间 | `2026-11-07 09:10（模拟）` | `admin_audit.createdAt` / `device_operation_logs.at` | `[FROZEN]` 内部 / 视图 `[TBD]` | 两源时间字段不同 |
| 事件类型 | 批准/拒绝/... | `admin_audit.action` / log `action` | `[FROZEN]` 内部 / 视图 `[TBD]` | 没有统一枚举 |
| 主体代号 | `OPER-DEMO-01` | `admin_audit.actorId` / log `actorId` | `[FROZEN]` 内部 / 视图 `[TBD]` | 不可显示真实姓名 |
| 结果 | 通过/驳回/... | `admin_audit` **无 result**；log `state/errorKind` 部分 | `[TBD]` | 页面结果是合成 |
| 理由 | 自由文本 | 无正式字段；H4 `revokeReason` 是枚举 | `[TBD]`/`[FORBIDDEN]` 伪称已审计 | 不能把页面理由当正式审计 |
| 关联对象 | `APP-DEMO-0001` | `admin_audit.target` / log `jobId` | `[FROZEN]` 内部 / 视图 `[TBD]` | `target` 是字符串，含 collection/id |
| 查询 | 有 | 无审计读取路由；`queryJob` 只查 job | `[HTTP-BLOCKED]` | 需 audit.read 视图/分页；九端点无此端点 |
| 统计卡 | 0/0/6/— | 无聚合 DTO | `[TBD]` | 留存周期未定义 |
| 对账 | 1 条事件 | H4-c 响应字段 | `[PROPOSED]`/`[HTTP-BLOCKED]` | E08 未注册；审计页不能替代任务对账操作 |

**差距台账：**

| ID | 页面 | 当前行为 | 目标行为 | 依赖阶段 | 验收方法 |
|---|---|---|---|---|---|
| G-AU01 | 审计页 | 无正式 audit read 路由/视图 DTO | 定义 `device.audit.read` 列表/查询；分页/筛选；`admin_audit` 与 operation log 的联合投影 | W0/W5 | 契约评审 + T-C09 + T-AU01 |
| G-AU02 | 审计页 | result/reason 是合成字段 | 只展示已批准字段；无 reason 字段就不显示“理由”；不得伪称不可变 | W0/W5 | T-C08 + T-AU02 |
| G-AU03 | 审计页 | 审计列表与人工对账混在一页 | 审计只读；“对账”是对任务的操作，回任务页；审计页只展示对账事件 | W5 | T-AU03 |
| G-AU04 | 审计页 | 导出/高级筛选占位 | 未批准前禁用；正式接线后分页/筛选/导出按权限 | W5 | T-AU04 |
| G-AU05 | 审计页 | 声明“不写入真实或不可变存储”（正确） | 只有 Store 提供不可变保证后才可改文案；否则保持“非不可变”声明 | W0/W5 | 契约/存储评审 + T-AU05 |
| G-AU06 | 审计页 | 无 alertCode/reasonCode 展示 | 展示规范化短码；不展示原始异常/Provider 文本 | W5 | T-AU06 |

### 5.5 概览页 `index.html`

**本轮状态：** 概览统计没有聚合 DTO、没有 HTTP 端点；模块卡权限矩阵未接。当前只能保留 Mock 数据，不得把统计卡当作正式数据。

- 4 个统计卡（`index.html:59-63`）为硬编码 3/2/3/6；没有聚合 DTO，正式接线后必须删除或改为已批准统计。
- 4 个模块卡链接正常；侧栏/面包屑互链正常。
- “本轮范围与边界”列表（`index.html:96-105`）声明零 API/零真实设备，当前正确；接线后必须更新，不能继续声称“未接 API”。
- 没有权限感知：无权限模块仍可点入，进入后由页面 forbidden 态兜底；目标应在概览层就按权限隐藏/禁用模块。

| ID | 页面 | 当前行为 | 目标行为 | 依赖阶段 | 验收方法 |
|---|---|---|---|---|---|
| G-O01 | 概览 | 统计卡硬编码 | 只用已批准聚合 DTO；否则不显示数字 | W0/W6 | T-C01 + T-O01 |
| G-O02 | 概览 | 模块卡不按权限隐藏 | 按 7 权限矩阵显示/禁用；无权限模块不误导 | W1/W6 | T-P01..P08 + T-O02 |

### 5.6 跨页/全局差距

**本轮状态：** 九端点 HTTP blocked 9/9、0 注册；没有页面/服务共同集成分支；权限撤销、404 同态、隐私裁剪、Mock 横幅都只有目标契约，未接线。所有全局 API 工作仍 blocked。

| ID | 页面 | 当前行为 | 目标行为 | 依赖阶段 | 验收方法 |
|---|---|---|---|---|---|
| G-X01 | 全局 | 页面零 API、零会话、零组织上下文；`routes.mjs` 明示未注册 | 建 API 客户端：认证、`X-Org-Id`/组织上下文、`Idempotency-Key`、错误信封、请求取消、超时 | W1 | T-C09 + T-C07 + T-E04 |
| G-X02 | 全局 | 页面分支与服务分支无共同树 | 建集成分支，固定页面 `2e8966b` + 服务 `1155b7b`（或后续批准提交） | W0 | 分支/提交清单评审 |
| G-X03 | 全局 | 五页横幅、`executionMode=test`、`provider=mock`、`evidenceScope=simulated`、`真实设备生效：否` 写死 | 横幅由配置/服务端投影驱动；Mock 阶段仍显示同一文案；禁止删除 Mock 标识 | W1/W6 | T-M01..M08 |
| G-X04 | 全局 | 没有 mock/live 切换，也没有拒绝 live 的服务端开关 | 显式 `executionMode`；Mock 阶段 live 失败关闭；页面无 live 入口 | W0/W1 | T-M06 + T-M07 |
| G-X05 | 全局 | 无跨组织/404 同态 | 所有读写按组织域；不存在与跨组织同 404；不泄露存在性 | W1/W6 | T-P11 + T-E04 |
| G-X06 | 全局 | 无隐私/禁显字段门控 | 字段白名单、响应裁剪、DOM/日志/截图扫描；私密原图逐次授权 | W6 | T-PR01..PR10 |
| G-X07 | 全局 | 无 `device_verified`/真实设备生效派生 | 只有 `device_ack/trusted/device/simulated→device_verified` 且 `deviceEffective` 才显示 active/生效；否则 false | W6/W7 | T-M04 + T-M05 |
| G-X08 | 全局 | 现有焦点/表格/toast/对比度/三尺寸通过，但只覆盖 Mock UI | 接线后保持 31/31 与 26/26 回归，并补正式状态截图 | W6 | T-A01..A12 |
| G-X09 | 全局 | 页面“理由/同意/审计”表达没有正式落点 | 先补契约或删除承诺；不得把本地 toast 当审计 | W0 | T-C05 + T-APP06 + T-AU02 |

### 5.7 五页面及跨页 66 项逐项状态与依赖提交

> **统计口径：** 本节覆盖全文全部 66 个 `G-` 项，与 §3.3（10）、§4.3（10）、§5.1（7）、§5.2（8）、§5.3（9）、§5.4（6）、§5.5（2）、§5.6（9）、§6（5）一一对应；不新增、不删除 ID。`服务/契约` 只表示服务层/契约事实，`HTTP/页面` 才表示能否接线。
>
> - `服务/契约`：`implemented` = 服务或契约事实成立；`proposed` = 只有设计/提案；`blocked` = 缺实现或前置；`not-applicable` = 不适用。
> - `HTTP/页面`：`blocked` = HTTP 未注册/未批准；`proposed` = 候选未注册；`open` = 页面侧仍开放；`forbidden` = 明确不提供。
> - **任何 `implemented` 都不等于 HTTP 已注册；九端点 HTTP 仍 blocked 9/9。**

| ID | 页面 | 差距（简） | 依赖提交 | 服务/契约 | HTTP/页面 | 本轮结论/门槛 |
|---|---|---|---|---|---|---|
| G-P01 | 设备 | `device.manage` 不在权限目录 | `1155b7b`、`2f597e3` | implemented | open | 改 `device.access.manage`；静态白名单同步；无 HTTP 依赖 |
| G-P10 | 设备 | 无正式设备读权限定义 | `1155b7b`、`2f597e3` | blocked | open | W0 裁定设备读权限；无设备读端点 |
| G-D01 | 设备 | 8 字段仅 3 个有正式内部对应 | `1155b7b`、`2f597e3` | blocked | open | 先批设备视图 DTO；未批字段不出现 |
| G-D02 | 设备 | 型号/固件/灰度/在线/心跳无来源 | `1155b7b`、`2f597e3` | blocked | open | 未批准字段不显示 |
| G-D03 | 设备 | job env 塞设备行 | `1155b7b`、`2f597e3` | blocked | open | 设备行只放设备字段；env 放横幅/job |
| G-D04 | 设备 | 无详情/分页/筛选/聚合 | `1155b7b`、`2f597e3` | blocked | open | 无聚合不显示统计卡 |
| G-D05 | 设备 | 新增/同步/导出可点 | `2f597e3` | blocked | forbidden | 未批准前禁用并说明；无设备写路由 |
| G-D06 | 设备 | 无跨组织/404 | `1155b7b`、`2f597e3` | implemented | open | 服务 404 已有；页面待接 |
| G-D07 | 设备 | 无禁显门控 | `1155b7b`、`2f597e3` | implemented | open | 字段白名单 + DOM/日志/截图扫描 |
| G-P02 | 申请 | 四个按钮混在 review | `1155b7b`、`2f597e3` | implemented | blocked | E03/E05 HTTP blocked；撤权拆分 |
| G-P03 | 申请 | 无 submit 流程 | `1155b7b`、`2f597e3` | implemented | blocked | E01 HTTP blocked |
| G-P04 | 申请/设备 | 无 `access.manage` 创建/撤权 | `1155b7b`、`2f597e3` | implemented | blocked | createGrant 无 HTTP；E05 blocked；`expectedGrantRevision`/`reasonCode` 冻结前不接 |
| G-P05 | 申请 | `readPrivate` 占位 | `1155b7b`、`2f597e3` | implemented | blocked | E04 HTTP blocked |
| G-S01 | 申请 | `pending`/`submitted` 混用 | `1155b7b`、`2f597e3` | implemented | blocked | 两轴分开；E01/E03/E05 blocked |
| G-A01 | 申请 | 新建申请仅 toast | `1155b7b`、`2f597e3` | implemented | blocked | E01 blocked |
| G-A02 | 申请 | 无 createGrant | `1155b7b`、`2f597e3` | implemented | blocked | createGrant 无 HTTP；`expectedCredentialRevision` |
| G-A03 | 申请 | 审核/撤权/补件混权 | `1155b7b`、`2f597e3` | implemented | blocked | E03/E05 blocked；补件无契约 |
| G-A04 | 申请 | 无 revision/幂等 | `1155b7b`、`2f597e3` | implemented | blocked | 409；HTTP 未接 |
| G-A05 | 申请 | 原图无请求/审计 | `1155b7b`、`2f597e3` | implemented | blocked | E04 blocked |
| G-A06 | 申请 | 理由只写 toast | `1155b7b`、`2f597e3` | blocked | open | `reasonCode` 冻结前不接；自由文本无字段 |
| G-A07 | 申请 | 同意记录合成 | `1155b7b`、`2f597e3` | blocked | open | consent `[TBD]`；不显示为正式字段 |
| G-A08 | 申请 | ID 语义混用 | `1155b7b`、`2f597e3` | implemented | open | credentialId/grantId/identityApplicationId |
| G-P06 | 任务/错误态 | reconcile 无权限/DTO | `b15aceb`、`ed7b66f`、`90e4189`、`2f597e3` | proposed | blocked | C1 终审+C2+C3+RC01–RC73；无可执行按钮 |
| G-P07 | 任务 | 整页用 retry 门控 | `1155b7b`、`2f597e3` | implemented | blocked | 读 audit.read；E07/E08 blocked |
| G-S02 | 任务 | 无 queued 行 | `1155b7b`、`2f597e3` | implemented | blocked | E06 blocked |
| G-S03 | 任务 | 无 sending 行 | `1155b7b`、`2f597e3` | implemented | blocked | E06 blocked；sending 无取消/重试 |
| G-S04 | 任务 | awaiting_result reconcile 未接 | `b15aceb`、`ed7b66f`、`90e4189`、`2f597e3` | proposed | blocked | 只查询+人工对账；E08 blocked；C1-C3 |
| G-S05 | 任务 | retry 无 due/revision | `1155b7b`、`2f597e3` | proposed | blocked | E07 blocked；不复用 requeue |
| G-S06 | 任务 | terminal 只在错误文案 | `1155b7b`、`2f597e3` | implemented | blocked | E06 blocked |
| G-S07 | 任务 | 无 `deviceEffective` 投影 | `1155b7b`、`2f597e3` | implemented | blocked | E06 blocked |
| G-S08 | 任务 | 无 cancelled | `1155b7b`、`2f597e3` | implemented | blocked | E06 blocked |
| G-S10 | 任务/审计 | 无 cleanup 投影 | `1155b7b`、`b15aceb`、`2f597e3` | proposed | blocked | H4-c C1/C2/C3；E08 blocked |
| G-T01 | 任务 | 只有 3 个状态行 | `1155b7b`、`2f597e3`、`bc2a8b2` | implemented | blocked | E06 blocked；revision 无 HTTP |
| G-T02 | 任务 | reconcile 无门控/DTO | `b15aceb`、`ed7b66f`、`90e4189`、`2f597e3` | proposed | blocked | E08 blocked；C1-C3；无按钮 |
| G-T03 | 任务 | retry 只受 checkbox 控制 | `2f597e3`、`1155b7b` | proposed | blocked | E07 blocked；`expectedJobRevision`；不复用 requeue |
| G-T04 | 任务 | `failureReason` bug | `1155b7b`、`2f597e3` | blocked | open | `publicJobResult` 未修；E06 blocked |
| G-T05 | 任务 | 公开 action/result/env | `1155b7b`、`2f597e3` | implemented | blocked | 只显示六字段；E06 blocked |
| G-T06 | 任务 | 无自动重试保证 | `1155b7b`、`2f597e3` | implemented | blocked | awaiting_result 禁止 auto/retry/requeue |
| G-T07 | 任务 | enroll reconcile 开放 | `b15aceb`、`ed7b66f`、`2f597e3` | proposed | blocked | enroll 仅查询；H4-d `[TBD]` |
| G-T08 | 任务 | 无 cross-org 404 | `1155b7b`、`2f597e3` | implemented | open | 服务 404 已有；页面待接 |
| G-T09 | 任务 | 无幂等保护 | `2f597e3`、`1155b7b` | proposed | blocked | E07/E08 K2 未实现 |
| G-P08 | 审计 | `audit.read` 只用于文案 | `1155b7b`、`2f597e3` | blocked | open | 无 audit read 路由 |
| G-AU01 | 审计 | 无 audit DTO/路由 | `1155b7b`、`2f597e3` | blocked | open | W0 定义；HTTP blocked |
| G-AU02 | 审计 | result/reason 合成 | `1155b7b`、`2f597e3` | blocked | open | 无字段不显示；保持非不可变 |
| G-AU03 | 审计 | 审计/对账混页 | `2f597e3`、`b15aceb` | blocked | open | 对账回任务页；E08 blocked |
| G-AU04 | 审计 | 导出/筛选占位 | `2f597e3` | blocked | forbidden | 未批准禁用 |
| G-AU05 | 审计 | 不可变声明 | `1155b7b`、`2f597e3` | implemented | open | 保持“非不可变” |
| G-AU06 | 审计 | 无 alertCode/reasonCode | `1155b7b`、`2f597e3` | blocked | open | 无端点；E06 blocked |
| G-O01 | 概览 | 统计卡硬编码 | `1155b7b`、`2f597e3` | blocked | open | 无聚合 DTO；不显示数字 |
| G-O02 | 概览 | 模块不按权限 | `1155b7b`、`2f597e3` | implemented | open | 权限矩阵；模块隐藏/禁用 |
| G-P09 | 全局 | 本地 checkbox 模拟撤销 | `1155b7b`、`2f597e3` | implemented | open | 403 清空/重拉；旧 200 不覆盖 |
| G-S09 | 全局 | `retrying` 当六态 | `1155b7b`、`2f597e3` | implemented | open | 只作 action pending；不写 job 枚举 |
| G-X01 | 全局 | 零 API/会话 | `2f597e3` | implemented | blocked | HTTP 信封冻结；9/9 blocked |
| G-X02 | 全局 | 无集成分支 | `2e8966b`、`1155b7b`、`2f597e3` | blocked | blocked | W0 建分支；固定双方提交 |
| G-X03 | 全局 | 横幅硬编码 | `2e8966b`、`2f597e3` | implemented | open | 配置化；不删 Mock 标识 |
| G-X04 | 全局 | 无 live 开关 | `2f597e3` | implemented | open | 页面无 live；fail closed |
| G-X05 | 全局 | 无 404 同态 | `1155b7b`、`2f597e3` | implemented | open | 统一 404；不泄露存在性 |
| G-X06 | 全局 | 无隐私门控 | `1155b7b`、`2f597e3` | implemented | open | 字段白名单/响应裁剪/扫描 |
| G-X07 | 全局 | 无 `device_verified` | `1155b7b`、`2f597e3` | proposed | blocked | 仅 W7；Mock 阶段 false |
| G-X08 | 全局 | 仅 Mock UI 回归 | `2e8966b`、`2f597e3` | implemented | open | 31/31、26/26 + T-R 系列 |
| G-X09 | 全局 | 理由/同意/审计无落点 | `1155b7b`、`2f597e3` | blocked | open | 补契约或删承诺；toast 不是审计 |
| G-M01 | 全局 | 横幅五份复制 | `2e8966b`、`2f597e3` | implemented | open | 单一配置源；五页一致 |
| G-M02 | 全局 | 真实生效否硬编码 | `1155b7b`、`2f597e3` | implemented | open | `deviceEffective` fail closed |
| G-M03 | 任务/设备 | 行级 simulated 硬编码 | `1155b7b`、`2f597e3` | implemented | open | 服务端投影；不把 job env 塞设备行 |
| G-M04 | 全局 | 无 `device_verified` 正向 | `1155b7b`、`2f597e3` | proposed | blocked | 仅 W7；受信 device_ack 才 active |
| G-M05 | 全局 | 无 live 拒绝测试 | `2f597e3` | implemented | open | `NOT_CONFIGURED` fail closed |

**项数核对：** 设备 9（G-P01、G-P10、G-D01–D07）；申请 13（G-P02–P05、G-S01、G-A01–A08）；任务 18（G-P06–P07、G-S02–S08、G-S10、G-T01–T09）；审计 7（G-P08、G-AU01–AU06）；概览 2（G-O01–O02）；全局 17（G-P09、G-S09、G-X01–X09、G-M01–M05）。合计 **66**。

## 6. Mock 边界、`simulated`/`device_verified` 与真实设备生效

### 6.1 当前页面

- 五页每页都有一份 Mock 横幅（`index.html:41-50`、`devices.html:41-50`、`applications.html:41-50`、`tasks.html:41-50`、`audits.html:41-50`），逐字包含：
  - `Mock 演示，未连接真实门禁`
  - `executionMode=test`
  - `provider=mock`
  - `evidenceScope=simulated`
  - `真实设备生效：否`
- 横幅在 `state-root` 之外，所以六态切换/错误/空态/无权限时仍显示；打印态保留（已由 CDP 验证）。
- 设备/任务行还重复显示 `mock/test/simulated`，作为合成标记。
- 页面没有任何 `device_verified` 分支；没有 `deviceEffective` 字段；没有真实设备证据。
- Mock 阶段九端点 HTTP blocked；页面不得因为“有按钮”就发 API 请求。无合法 revision 或端点未注册时，按钮禁用且网络 0。

### 6.2 正式语义

- `EVIDENCE_SCOPE` 只有 `simulated` / `device_verified`（`dto.mjs:15-18`）。
- `projectAccess`（`state.mjs:84-116`）：
  - `businessAllowed = grant.effective && eligibility.allowed`；
  - `deviceEffective` 还要求最新 job `succeeded` + `evidenceVerified`；
  - `evidenceVerified` 要求 `trusted=true`、`kind=device_ack`、`source=device`、`evidenceScope=device_verified`，且 org/device/grant/job/action 全部匹配；
  - Mock success 不生成 `device_ack`，所以 `deviceEffective=false`。
- H3 终审：Mock success 的 T3 写 job succeeded、grant effective，但**不生成可信 device ack**，`deviceEffective=false`。
- H4-c：`evidenceScope` 固定 `simulated`；`device_verified` 在 Mock 阶段失败关闭。

### 6.3 页面应如何接线

| 项目 | 当前 | 目标 | 风险 |
|---|---|---|---|
| 横幅文案 | 写死 | 由部署配置 + 服务端 `executionMode/provider` 派生；Mock 阶段保持原文案 | 如果直接删横幅，违反“Mock 不伪装真实” |
| `真实设备生效` | 写死“否” | 由 `deviceEffective`/`displayState` 派生；无证据时 false | 硬编码“是”或从 `grant effective` 推导“是”都错误 |
| 行级 `evidenceScope` | 写死 `simulated` | 用服务端投影；`device_verified` 才显示真实 | 不能把 `succeeded` 当 `deviceEffective` |
| `active` 展示 | 无 | 只有 `effective + succeeded + device_verified` 才 `active`；否则 `simulated/pending_sync` | 不能因为 job succeeded 就显示“已生效” |
| live 入口 | 无 | 继续无；live 由服务端配置控制，页面不提供切换 | 页面切 live 会绕过部署门禁 |

| ID | 页面 | 当前行为 | 目标行为 | 依赖阶段 | 验收方法 |
|---|---|---|---|---|---|
| G-M01 | 全局 | 横幅硬编码、五份复制 | 单一配置源；五页一致；六态/打印保留 | W1 | T-M01/M02 |
| G-M02 | 全局 | `真实设备生效：否` 硬编码 | 投影派生；无证据 fail closed | W6/W7 | T-M05 |
| G-M03 | 任务/设备 | 行级 simulated 硬编码 | 用服务端 `evidenceScope`；不把 job env 塞设备行 | W2/W4 | T-M04 |
| G-M04 | 全局 | 无 `device_verified` 正向路径 | 只有受信 device_ack 才显示 active/生效；Mock 阶段永不 | W7 | T-M05 |
| G-M05 | 全局 | 无 live 拒绝测试 | 服务端 live/NOT_CONFIGURED 失败关闭；页面显示不可用 | W1 | T-M06 |

## 7. 错误态、空态、权限撤销、跨组织同态与隐私

### 7.1 错误态

当前 `renderError`（`app.js:157-165`）固定显示：

- `TERMINAL（合成）`
- “合成加载失败”
- 六类错误枚举文字
- “人工对账（演示）”按钮（无权限门控）

问题：

1. 所有错误都被当成 TERMINAL；没有区分 400/401/403/404/409/429/503。
2. 没有 `requestId`，无法支持排障。
3. 没有“刷新/重试/返回”分级动作；错误态里的“人工对账”对普通错误不适用。
4. 不显示服务端 `error.code`，也不保留用户输入。
5. 没有网络断开/超时/取消。

目标错误映射（**当前九端点 HTTP blocked，未注册端点先表现为 404/405；下表是编码卡验收目标，不是现状**）：

| HTTP | 规范 code | UI | 动作 |
|---:|---|---|---|
| 400 | `PARAM_ERROR` | 表单错误/字段提示 | 保留输入；revision 字段非正安全整数直接 400；不重试 |
| 401 | `UNAUTHORIZED` | 会话失效 | 重新登录；清空敏感数据 |
| 403 | `FORBIDDEN` | forbidden | 清空数据；显示缺权限点；不重试；下次请求立即拒绝 |
| 404 | `NOT_FOUND` | not-found | 与跨组织同态；不显示“无权限”差异；`queryJob` 同态 404 |
| 409 | `INVALID_JOB` | invalid-job | 服务端 job 记录缺合法 `revision`/状态非法 → 失败关闭；UI 禁用 mutation，零写 |
| 409 | `REVISION_CONFLICT` | conflict | revision stale；刷新数据/按 ID 重查 `queryJob`；不自动重试 |
| 409 | `INVALID_STATE`/`CONFLICT`/`EVIDENCE_*` | conflict | 刷新数据；不自动重试；提示重新核对 |
| 429 | `RECONCILE_THROTTLED`/限流 | busy | 显示等待时间；不自动重试 |
| 503 | `NOT_CONFIGURED`/`ADAPTER_UNAVAILABLE` | unavailable | 显示服务不可用；可人工重试一次；不循环 |
| 网络 | — | offline | 显示离线；不伪造数据 |

### 7.2 空态

当前 `renderEmpty`（`app.js:142-147`）统一“暂无合成数据”。

目标区分：

- 真无数据：显示空态 + 有权限时的创建 CTA；
- 筛选后无结果：提示清除筛选；
- 无权限：forbidden，不是 empty；
- 跨组织/不存在：404，不是 empty；
- 加载失败：error，不是 empty；
- Mock 空 fixture：保留“合成”标识，不误导为真实零数据。

### 7.3 权限撤销

页面只有本地 checkbox，没有会话/成员权限。目标：

1. 服务端在每次请求/事务内复核组织、成员、权限；权限撤销后**下一次请求立即 403**；
2. 页面清空行数据、私密内容、按钮，切 forbidden；
3. 正在进行的请求返回 403 时，不得用旧 200 响应覆盖 forbidden；必须丢弃旧响应并重新拉权限；
4. 组织切换/重新登录重新拉权限；服务端不得缓存权限结论；
5. 不用本地 toggle 代替服务端测试；本地 checkbox 只用于 Mock 演示，不是权限撤销证据。

### 7.4 跨组织同态

正式实现：

- `LocalStore.get(name,id,orgId)` 在 `orgId` 不匹配时返回 null（`store.mjs:281-286`）；
- `CloudStore.get` 同样以 `orgId` 过滤（`store.mjs:408-423`）；
- 服务层 `#find` 使用 `this.orgId`（`service.mjs:112-115`）；
- 不存在与跨组织都走 `NOT_FOUND/404`。

页面目标：

- 所有请求带会话组织，不由用户自由选择；
- 跨组织记录显示与不存在完全相同的 404 页；
- 不显示“该记录属于其他组织”；
- 列表不返回其他组织计数/存在性。

### 7.5 隐私字段

当前 Mock 页面值层是干净的：21 张截图 10 类禁显值 0 命中；页面只用 `DEMO` 前缀，无图片/字节/外链。

接线后必须保持：

- 列表/日志/任务页不出现人脸图片、缩略图、base64、`objectKey`、`checksum`、永久 URL；
- 私密原图只通过逐次授权入口读取；每次读取有权限、理由（若契约批准）与审计；
- 不把私密内容写入 localStorage/sessionStorage/IndexedDB/URL；
- 错误信息不回显原始响应、异常 message/stack、设备地址、序列号、账号；
- 导出/截图/打印不包含私密字段。

## 8. 禁显项清单

| 类别 | 禁显内容 | 依据 | 当前页面 | 接线要求 |
|---|---|---|---|---|
| 设备凭据 | `serialNumber`、设备账号/密码、厂商内部凭据、IP/MAC | HK-AI-05 任务卡禁止事项；LOCK-01A | 未出现 | 响应裁剪 + DOM/日志/截图扫描 |
| 人脸材料 | 图片字节、base64、缩略图、永久 URL、`objectKey`、`checksum`、文件路径 | H4-c §5.2/§6.3；HK-AI-05A 边界 | 仅占位；无字节 | 原图只走授权入口；列表/日志/任务零字节 |
| Provider 原始数据 | 原始请求/响应、payload、异常 message/stack、设备地址 | H3/H4 字段白名单；H4-c §11 | 未出现 | 只显示规范化 `errorKind/reasonCode/alertCode` |
| 幂等/摘要 | 原始幂等键、`opId`、`requestDigest`、K1/K2/K3 密钥/指纹 | H2-a/H4-c 白名单 | 未出现 | 不返回、不显示、不入日志 |
| 人员隐私 | 姓名、手机号、地址、证件号、同意内容（未批准） | HK-AI-05 任务卡；HK-AI-03 | 仅 DEMO 代号 | 只显示有界 ID；PII 需单独批准 |
| 内部绑定 | `claimId`、`slotId`、`digestRealm`、`keyVersion`、`ownerOrgId` | H2-b/H4 内部字段 | 未出现 | 不作为列表展示；仅在受控详情/排障视图 |
| 错误权限点 | `device.manage`、`device.face.read` | H1～H4 权限目录 | 设备页使用 `device.manage` | 改为正式权限或删除；静态检查更新 |
| 伪状态 | `retrying` 作为 job 状态；`已补件` 作为正式审核状态 | H1～H4 `JOB_STATE`/`REVIEW_STATE` | 页面使用 | 只作 UI 瞬时态/删除；显示正式枚举 |
| 伪生效 | “真实设备生效：是”“已同步真实设备”“真实授权已生效”无 `device_verified` | H3/H4 `deviceEffective`；HK-AI-05A | 未出现（显示“否”） | 只在受信证据后显示；否则 false |
| revision 推导 | 列表行号、数组下标、本地自增、旧 mutation 响应、缓存旧值、时间戳、`attempts`、`cleanupPending` | `2f597e3` Q1/Q7 | 未出现（页面无 revision 字段） | 只从按 ID `queryJob` 读取；无合法值则禁用按钮、0 请求 |
| 未注册端点请求 | 对 E07/E08/E09 发探测/重试/对账请求 | `2f597e3` Q3/Q6/Q7 | 页面有占位按钮 | 按钮禁用 + 网络 0；不得点击兜底 |
| 未冻结 reasonCode | revoke 的自由文本理由/提前枚举 `reasonCode` | `2f597e3` Q4/Q5 | 页面有“理由必填” | 枚举/持久化/审计/投影冻结前不接收 |
| 自动收敛 | `awaiting_result` 自动 retry/普通 requeue/轮询/回调 | `2f597e3` Q3 | 页面有“受控重试中”文案 | 只允许只读查询 + 人工对账；不得自动重发 |
| 设备写 | 新增/同步/导出/删除全部人脸库 | HK-AI-05 禁止事项；H4 边界 | 占位按钮 | 未批准前禁用/不显示；不提供“删除全部” |

**结论：** 当前 Mock 页面在“值层”没有发现禁显值；风险集中在接线后的字段选择、错误信息、私密读取、revision 推导和权限文案。`device.manage` 是当前唯一明确的权限术语错误；`retrying` 是唯一明确的伪 job 状态；无合法 revision 时任何 mutation 请求都属于伪接线。

## 9. 页面风险清单

| 风险 | 严重度 | 说明 | 触发条件 | 缓解 |
|---|---|---|---|---|
| 权限点错误导致越权/不可授权 | P0 | `device.manage` 不在权限目录，无法授予；若后端兼容该名，会形成影子权限 | 直接接线设备页 | W0 统一为 `device.access.manage` 或新只读权限 |
| 审核权限被用于撤权 | P0 | 页面“撤销”与 review 同权；无 access.manage | 审核员点击撤销 | 拆分 action/权限；撤权走 grant |
| 人工对账无权限 | P0 | reconcile 按钮无 `device.operation.reconcile` | 任意用户可点 | 加权限 + 服务端事务复核 |
| 未知结果被误重试 | P0 | 页面当前无重试，但无服务端保证；H4-c 仅 revoke | 后续开发加重试/轮询 | 服务端守卫 + UI 不显示 + 测试 |
| 视图 DTO 缺失导致内部字段泄露 | P0 | 设备/审计/任务无公开投影；可能直接返回 internal record | 直接 `JSON.stringify(record)` | W0 视图 DTO + 字段白名单 |
| 版本冲突导致覆盖 | P0 | 无 expectedRevision；revoke/reconcile 可能旧版本提交 | 双人同时操作 | CAS + 409 + 刷新 |
| 无合法 revision 仍可点 mutation | P0 | 页面没有 revision 来源，若按钮可点就会猜版本/发请求 | 直接接线任务页 | 无合法 revision → 隐藏/禁用 + 明确原因 + 网络 0 |
| revision 伪来源 | P0 | 列表行号/缓存/旧响应/本地自增会被当成 CAS 基准 | 页面用列表渲染 | 只允许按 ID `queryJob`；服务端缺失/非法 `INVALID_JOB/409` |
| stale revision 自动重试 | P0 | 409 后自动重发会放大冲突/重复写 | 网络抖动/并发 | 409 只提示刷新；不自动重试；重新 `queryJob` |
| 候选路由提前注册 | P0 | E07/E08/E09 未满足前置就注册，等于绕过 H4-c/重试契约 | 编码卡夹带 | Q8 规则；E08 描述行未来独立清理；E09 不入表；本轮零修改 |
| H4-c 提前接线 | P0 | C1 未终审、C2/C3 未开始就渲染对账按钮 | “设计已批准”被误读为可编码 | C1+C2+C3+RC01–RC73 前 E08/E09 不注册；按钮禁用 |
| revoke 提前接收 reasonCode | P0 | `reasonCode` 枚举/审计未冻结，提前接收会形成伪契约 | 按 H4 草案接线 | Q4/Q5 加固完成前 E05 不注册、不接收 |
| queryJob HTTP 提前暴露 | P0 | 读模型已实现被误读为 HTTP 可用 | 直接加 GET 路由 | 独立编码卡；未批准前 UI 无合法 revision |
| 跨组织枚举 | P1 | 页面无组织上下文/404 | 改 URL/ID | 组织域 + 同态 404 |
| 私密原图无审计 | P1 | 只有占位；正式读取无 reason/audit 契约 | 接 image 路由 | 先补契约；逐次审计 |
| 理由“已记录”但未落库 | P1 | 本地 toast 冒充审计 | 审核/撤销 | 新增备注字段或删除承诺 |
| 状态误导 | P1 | pending/submitted/queued 混用；retrying 非 job 状态 | 接线后沿用页面标签 | 统一枚举 + 标签映射 |
| Mock 横幅硬编码 | P1 | 五份复制；切换环境可能不一致 | 只改一页 | 单一配置源 + 回归 |
| 真实设备生效误判 | P1 | 硬编码“否”或从 succeeded 推导 | 接真实设备 | `deviceEffective` + `device_verified` |
| 权限撤销后残留数据 | P1 | 本地 checkbox 不清数据 | 权限被撤 | 403 清空 + 重新拉取 |
| 错误态误导 | P1 | 全部 TERMINAL；错误态提供对账 | 任意 4xx/5xx | 错误映射 + requestId |
| 无幂等导致重复写 | P1 | 双击/重试可能重复 | 提交/审核/撤权 | `Idempotency-Key` + 禁用按钮 |
| 可访问性回归 | P2 | 新组件可能丢失焦点/对比度 | 接线改造 | 保留 31/31、26/26；补测 |
| 无分页/筛选 | P2 | 数据量上来后不可用 | 正式数据 | 视图 DTO + 分页 |
| 审计“不可变”误称 | P2 | 当前页面已声明非不可变 | 改文案 | 存储保证后再改 |

## 10. 分阶段接线任务

> 原则：每阶段独立提交、独立复审；前一阶段未通过，后一阶段保持关闭。任何阶段都不得删除 Mock 标识、不得接真实设备、不得绕过权限。

### W0 契约与决策关闭（只写文档）

**目标：** 把所有 `[TBD]` 变成批准/拒绝，避免边写边猜。

**必须关闭：**

1. 设备列表读取权限：`device.access.manage` / `device.audit.read` / 新 `device.read`？
2. `device.manage` 的处置：删除，还是新增正式权限？（建议删除，统一 `device.access.manage`）
3. 设备视图 DTO：ID、名称/型号/固件/能力/灰度/在线/心跳的来源与禁显。
4. 申请视图 DTO：credential + grant + occupancy/cycle + room + consent 的聚合边界。
5. 同意记录契约：字段、来源、展示、保留。
6. 理由/备注契约：review/reconcile 是否允许自由文本；revoke `reasonCode` 的枚举/长度/持久化/审计/投影；冻结前不得接收。
7. 审计读取路由与视图 DTO：`admin_audit` + operation log 的联合、分页、筛选、不可变声明。
8. enroll `awaiting_result` 的人工对账：H4-c 只覆盖 revoke；enroll 是只读查询还是另立 H4-d？
9. H4-c 阶段门禁：C1 终审、C2、C3、RC01–RC73、最小响应投影、Provider 0 证据；未齐前 E08/E09 不注册。
10. 九端点 HTTP 编码卡：**9/9 仍 blocked**；逐项引用 `2f597e3` 端点 ID；E05 先加固、E07 先独立任务、E08/E09 先 H4-c 条件。
11. 任务/授权/凭证状态到 UI 标签的映射表（含 `retrying` 只作 UI 态）。
12. 真实设备生效投影：`deviceEffective` 是否暴露给前端；如何暴露。
13. 批量审批/导出/补件/设备写：是否在首期范围；不在则明确不提供。
14. 集成分支策略：页面 `2e8966b` + 服务批准提交（含 queryJob `cf7c75e`）；谁负责合并/复审。
15. queryJob HTTP 读取编码卡：路径、响应六字段、权限、同态 404；未批准前 UI 无合法 revision。
16. UI revision 门禁：无合法 revision 时隐藏/禁用 mutation、明确原因、网络 0；禁止探测请求/本地推导。

**退出标准：** Codex 批准/拒绝每项；形成一份“接线契约决定记录”；未批准项在页面中保持不可用。

### W1 基础设施与 Mock/正式双模式

- API 客户端：认证、组织上下文、`Idempotency-Key`、错误信封、超时/取消、请求 ID。
- 权限提供者：7 权限矩阵；登录/组织切换刷新；403 统一处理。
- Mock/正式模式：`executionMode` 配置；Mock 模式仍零网络；正式模式失败关闭。
- 横幅配置化：五页一致；六态/打印保留；不删除 Mock 标识。
- 路由守卫：未登录/无权限/跨组织 404。
- 基础组件：loading/empty/forbidden/error/conflict/busy；toast 保留现有 a11y。

**退出：** 契约测试通过；Mock 模式仍 0 非 file 请求；不触碰真实设备。

### W2 设备页（只读）

- 只接已批准设备视图 DTO；未批准字段不显示。
- 列表/详情/分页/筛选（按批准范围）。
- 状态：loading/empty/forbidden/error/ready。
- 禁显扫描：serial/IP/MAC/凭据/内部绑定。
- 设备写/同步/导出保持不可用，除非 W0 批准。

**退出：** 设备页无写操作；跨组织 404；字段清单 100% 可追溯；截图。

### W3 申请页（submit / review / createGrant / revoke / readPrivate 拆分）

- 提交：只收 `personId/sourceFileId`；`device.face.submit`；E01 HTTP blocked，编码卡后另验。
- 审核：approve/reject；HTTP 字段 `expectedCredentialRevision` 必填；`device.face.review`；E03 blocked。
- 授权：`createGrant` 八项输入；`device.access.manage`；`expectedCredentialRevision`；createGrant 仍无 HTTP。
- 撤权：grantId；`device.access.manage`；**服务 implemented、HTTP blocked**；未来 `expectedGrantRevision`；`reasonCode` 冻结前不接；CAS/409。
- 原图：独立入口；`device.face.readPrivate`；逐次审计；不缓存；E04 blocked。
- 理由：仅在 W0 批准后显示/提交；否则不承诺“已审计”；revoke `reasonCode` 未冻结不得接收。
- 补件/批量/导出：未批准不提供。

**退出：** 四权分离测试；409/403/404；无图片字节；审计事件。**任一 HTTP 编码卡未批准时，本阶段不得开始页面接线。**

### W4 任务页（状态 / retry / reconcile）

- 覆盖 7 个 job 状态 + `pending` grant；queued/sending/terminal_failed/cancelled 行级展示。
- 读取用 `device.audit.read`；重试用 `device.operation.retry`（E07）；对账用 `device.operation.reconcile`（E08）。
- revision：每次 mutation 前按 ID `queryJob` 取最新 `revision`；无合法值 → 按钮隐藏/禁用、明确原因、**网络 0**；禁止列表/缓存/本地推导。
- retry：**E07 proposed/blocked**；未来仅 `retryable_failed` 且到期 + `expectedJobRevision` + K2/幂等；attempts=4 terminal；**不复用不完整 requeue**；409/403。
- reconcile：**E08 blocked**；仅 `awaiting_result`；H4-c 三 decision + evidence + `expectedRevision`；**C1 终审+C2+C3+RC01–RC73 前不注册**；当前不得有可执行按钮；200/202/terminal 是未来投影，不是现状。
- enroll unknown：只查询；对账 `[TBD]`；不得自动 retry/requeue。
- alertCode/reasonCode/cleanup 字段展示。

**退出：** 状态矩阵全绿；UNKNOWN_RESULT 无重试；对账权限/幂等/并发；revision 缺失/非法/stale/0 请求全通过；截图。

### W5 审计页（只读）

- audit.read 路由；`admin_audit` + operation log 联合投影。
- 分页/筛选/导出（按批准）。
- 不可变声明仅在存储保证后修改。
- 对账事件只读展示；操作回任务页。
- 跨组织 404；禁显；时间/主体/结果映射。

**退出：** 审计查询契约测试；无原始载荷；分页边界；截图。

### W6 横切与验收

- 权限撤销：403 清空、重新拉取、禁止旧响应覆盖。
- 跨组织同态：404 一致。
- 隐私：原图逐次授权、DOM/存储/日志/截图扫描。
- 错误/空态：完整映射。
- a11y/响应式/打印：保留 31/31、26/26；补正式状态。
- 证据：截图矩阵、结构化结果、提交清单。

**退出：** 全量 E2E；Codex 复审；无真实设备/Provider；无 Mock 标识删除。

### W7 真实设备生效（单独批准，不在本轮）

- `device_verified` 证据、受信 `device_ack`、`deviceEffective` 投影。
- 真实 Provider/设备连接、设备写、灰度。
- 只有 W7 批准后，页面才可显示“真实设备生效：是”或 `active`。
- 本轮明确不实现。

## 11. 测试矩阵

> 记号：`PASS` 预期通过；`FAIL-CLOSED` 预期拒绝且零写；`Z` 内容级零变化；`UI` 需浏览器/CDP；`CONTRACT` 需契约测试。矩阵覆盖页面、权限、状态、Mock 边界、错误/空态、跨组织、隐私、幂等、可访问性与回归。
>
> **阶段声明：** 矩阵中 E01–E09 的 API 用例都是**未来编码卡验收**，不是现状。当前九端点 HTTP blocked 9/9，执行时预期 `404/405`、零写、Provider 0；只有页面静态/Mock 用例可立即执行。任何“成功 200/201/202”行都必须在对应编码卡批准后才可执行。
>
> 编号说明：`T-S01..S24` 表示“四业务页 × 六态”的逐格用例；正文中引用 `T-S01`、`T-S05`、`T-S09` 等具体编号时，均落在该范围内。`T-U01..U12`、`T-APP01..08`、`T-D01..D05`、`T-AU01..AU06`、`T-O01..O02` 为补充专项用例。**本次修订新增 `T-R01..R15` 连续专项**（revision 缺失/非法/stale、按钮禁用、网络 0、权限撤销、候选路由未注册），见 §11.10。

### 11.1 契约与字段映射

| ID | 覆盖 | 方法 | 预期 | 关联 |
|---|---|---|---|---|
| T-C01 | 每页字段 → 正式 DTO 或 `[TBD]` | 逐字段清单评审 | 无“未批准字段被当成冻结” | G-D01/G-A08/G-T05/G-AU01 |
| T-C02 | submit 只收 `personId/sourceFileId` | 请求 DTO 测试；未知字段 | 400；无 credential 写入 | G-A01 |
| T-C03 | createGrant 八项输入 | 请求 DTO；缺/多字段 | 400；无 grant/job/slot 写入 | G-A02 |
| T-C04 | review decision/`expectedCredentialRevision` | 请求 DTO；非法 decision/版本 | 400/409；零写；当前 E03 未注册 → 404/405 | G-A04 |
| T-C05 | revoke 只收 grantId；无自由文本理由 | 请求 DTO | 多余字段 400；理由不进 revoke；当前 E05 未注册 → 404/405；未来至少 `expectedGrantRevision` | G-A06 |
| T-C06 | reconcile 严格 DTO | 未知字段/错 sourceType/decision | 400/409 `EVIDENCE_INVALID`；零写；当前 E08 未注册 → 404/405 | G-T02 |
| T-C07 | `Idempotency-Key` 格式 | 15/16/128/129 字符 | 15/129 拒绝；16/128 接受 | G-X01 |
| T-C08 | 响应最小 DTO | 检查 opId/digest/原始证据 | 不出现 | G-T05/G-AU02 |
| T-C09 | 路由表与注册 | 对照 `routes.mjs`/`server.mjs` | **九端点 0 注册**；E08 仅描述行；E09 不在表；未批准路由不注册 | G-X01 |
| T-C10 | 状态枚举 | 源码/响应扫描 | 只出现 H1～H4 枚举；无 `retrying` job | G-S09 |

### 11.2 权限矩阵

| ID | 覆盖 | 方法 | 预期 | 关联 |
|---|---|---|---|---|
| T-P01 | 无任何权限访问设备页 | UI + API | forbidden/403；无数据 | G-D01 |
| T-P02 | 仅 review 访问申请页 | UI + API | 可通过/拒绝；无撤销/授权/原图 | G-A03 |
| T-P03 | 仅 access.manage | UI + API | 可 createGrant/revoke；无 review/readPrivate | G-A02 |
| T-P04 | readPrivate 原图 | UI + API | 200 字节流；审计；无 URL/缓存 | G-A05 |
| T-P05 | 仅 audit.read 访问任务/审计 | UI + API | 只读；无 retry/reconcile | G-P07 |
| T-P06 | retry 权限 + retryable 到期 | UI + API | 成功排队；未知/未到期拒绝 | G-T03 |
| T-P07 | reconcile 权限 + awaiting_result | UI + API | 成功/202/terminal；无权限 403 | G-T02 |
| T-P08 | submit 权限 | UI + API | 创建 credential；无审核能力 | G-A01 |
| T-P09 | 缺权限 | UI + API | 403；不泄露存在性 | G-X05 |
| T-P10 | 权限中途撤销 | UI + API | 下一次 403；清空数据；按钮不可用 | G-P09 |
| T-P11 | 跨组织/不存在 | API | 同为 404；body/时序无可区分 | G-X05 |
| T-P12 | 7 权限组合 | 矩阵自动化 | 每项动作只受对应权限 | 全权限 |
| T-P13 | 静态权限名 | grep/扫描 | 无 `device.manage`/`device.face.read` | G-P01 |
| T-P14 | 无权限按钮 | UI | 隐藏或 disabled + 原因 | G-D05/G-A03 |

### 11.3 页面六态与错误/空态

| ID | 覆盖 | 方法 | 预期 | 关联 |
|---|---|---|---|---|
| T-S01..S24 | 四业务页 × loading/empty/forbidden/error/retrying/ready | CDP | 24/24 结构可辨；默认 ready；reload 恢复 | 现有 |
| T-S25 | index 概览 | UI | 横幅、模块、边界声明 | G-O01 |
| T-S26 | 打印态 | CDP print | Mock 横幅可见；无操作控件 | G-M01 |
| T-S27 | 正式状态截图 | CDP | queued/sending/terminal/cancelled/reconcile 403/404/权限撤销 | E-11 |
| T-S28 | 空态 vs 无权限 vs 404 | UI | 四者视觉/文案不同 | G-X05/G-AU01 |
| T-S29 | 错误码矩阵 | UI | 400/401/403/404/409/429/503 各自状态 | G-X01 |
| T-S30 | 加载取消/超时 | UI | 取消后不渲染旧响应 | G-X01 |

### 11.4 任务状态与对账

| ID | 覆盖 | 方法 | 预期 | 关联 |
|---|---|---|---|---|
| T-J01 | queued | UI/API | attempts=0；无重试；无 lease | G-T01 |
| T-J02 | sending | UI/API | 无取消/重试；超时→awaiting_result | G-T01 |
| T-J03 | awaiting_result 无重试 | UI/DOM/API | 只有 query/reconcile；无 retry/new | G-T06 |
| T-J04 | retryable_failed 未到期 | API/UI | **当前 E07 未注册 → 404/405**；未来 `RETRY_NOT_DUE/409`；按钮禁用 | G-T03 |
| T-J05 | retryable_failed 到期 | API/UI | **当前 E07 未注册 → 404/405**；未来编码卡后成功 queued 一次 | G-T03 |
| T-J06 | attempts=4 | API/UI | terminal_failed；之后重试零写 | G-T03 |
| T-J07 | terminal_failed | UI | 无操作；显示 alertCode | G-S06 |
| T-J08 | cancelled | UI | 无操作；终态 | G-S08 |
| T-J09 | succeeded + simulated | UI | 显示 simulated；真实生效否 | G-S07 |
| T-J10 | succeeded + device_verified | UI（W7） | active/真实生效是；仅受信证据 | G-M04 |
| T-J11 | pending vs submitted | UI | 两轴分开显示 | G-S01 |
| T-J12 | reconcile 三 decision | API/UI | **当前 E08 未注册 → 404/405**；C1-C3+RC01–RC73 后未来 removed/present/unknown 对应 200/202/terminal | G-T02 |
| T-J13 | reconcile 并发 | API | **当前 404/405**；未来仅一个 CAS 成功，另一个 409 | G-T02 |
| T-J14 | reconcile 同键重放 | API | **当前 404/405**；未来原结果、零写 | T-I06 |
| T-J15 | enroll unknown | API/UI | 仅查询；无 reconcile（TBD） | G-T07 |
| T-J16 | cleanupPending | UI | 显示 revoking/cleanupPending；不误释放 | G-S10 |

### 11.5 Mock/真实设备边界

| ID | 覆盖 | 方法 | 预期 | 关联 |
|---|---|---|---|---|
| T-M01 | 五页横幅逐字 | DOM | 5/5 文案+四项 | G-M01 |
| T-M02 | 六态/打印横幅 | CDP | 全部保留 | G-M01 |
| T-M03 | 无 live 入口 | 控件扫描 | 0 命中 | G-X04 |
| T-M04 | simulated 行 | UI/API | `evidenceScope=simulated` | G-M03 |
| T-M05 | device_verified 伪造 | API | 非受信证据不生效；`deviceEffective=false` | G-M04 |
| T-M06 | live/NOT_CONFIGURED | API | 失败关闭；页面不可用 | G-M05 |
| T-M07 | 肯定式误导文案 | 全文/控件扫描 | 未批准前 0 命中 | G-M01 |
| T-M08 | Mock 标识删除回归 | 静态检查 | 31/31 仍通过 | G-M01 |

### 11.6 隐私与禁显

| ID | 覆盖 | 方法 | 预期 | 关联 |
|---|---|---|---|---|
| T-PR01 | 图片字节/URL | DOM/network/response | 0 字节；无 URL | G-X06 |
| T-PR02 | serial/IP/MAC/凭据 | DOM/response/log | 0 命中 | G-D07 |
| T-PR03 | Provider 原始载荷/stack | response/log | 0 命中 | G-X06 |
| T-PR04 | opId/requestDigest/原始幂等键 | response/DOM | 0 命中 | G-X06 |
| T-PR05 | 人员 PII | DOM/截图 | 只显示有界 ID | G-X06 |
| T-PR06 | readPrivate 审计 | API/audit | 每次读取有权限/审计；无缓存 | G-A05 |
| T-PR07 | 列表/日志/任务零图片 | 全页扫描 | 0 图片/字节 | G-X06 |
| T-PR08 | 截图/打印脱敏 | 截图扫描 | 10 类正则 0 命中 | G-X06 |
| T-PR09 | 存储 | localStorage/sessionStorage/IndexedDB | 无私密内容 | G-X06 |
| T-PR10 | 错误信息 | UI | 无原始 message/stack | G-X01 |

### 11.7 跨组织/权限撤销/幂等

| ID | 覆盖 | 方法 | 预期 | 关联 |
|---|---|---|---|---|
| T-E01 | 400 | UI | 表单错误；保留输入 | G-X01 |
| T-E02 | 401 | UI | 登录；清数据 | G-P09 |
| T-E03 | 403 | UI | forbidden；清数据 | G-P09 |
| T-E04 | 404 跨组织 | API/UI | 与不存在同态 | G-X05 |
| T-E05 | 409 版本 | UI | 冲突提示；刷新；不自动重试 | G-A04 |
| T-E06 | 429/503 | UI | busy/unavailable；不循环 | G-X01 |
| T-E07 | 网络断开/超时 | UI | offline；不伪造 | G-X01 |
| T-E08 | 空数据 | UI | 空态 + CTA（有权限） | G-X01 |
| T-E09 | 筛选空 | UI | 清除筛选提示 | G-X01 |
| T-E10 | 权限空 | UI | forbidden，非 empty | G-P09 |
| T-E11 | requestId | UI | 显示/可复制 | G-X01 |
| T-E12 | 旧响应覆盖 | UI | 403 后旧 200 不覆盖 | G-P09 |
| T-I01 | submit 重放 | API | 原结果；零写 | G-A01 |
| T-I02 | review 重放 | API | 原结果；零写 | G-A04 |
| T-I03 | createGrant 重放 | API | 原 grant/job；无新 slot | G-A02 |
| T-I04 | revoke 重放 | API | 原 job；零写 | G-A03 |
| T-I05 | retry 重放 | API | 原 queued；不重复 | G-T03 |
| T-I06 | reconcile 重放 | API | 原投影；不重复 evidence | G-T02 |
| T-I07 | 同键异摘要 | API | 409 CONFLICT；零写 | G-X01 |
| T-I08 | 并发双击 | UI/API | 仅一次写；按钮禁用 | G-X01 |
| T-I09 | ack loss | API | 重放返回原结果；不重复 | G-T02 |

### 11.8 可访问性与回归

| ID | 覆盖 | 方法 | 预期 | 关联 |
|---|---|---|---|---|
| T-A01 | 焦点可见 | CDP | 所有可交互控件 `:focus-visible` | G-X08 |
| T-A02 | 表格键盘滚动 | CDP | tabindex + ArrowRight | G-X08 |
| T-A03 | toast | CDP | role/status、Escape、关闭 | G-X08 |
| T-A04 | 对比度 | 计算 | ≥4.5:1（现有范围） | G-X08 |
| T-A05 | 三尺寸 | CDP | 1366/1440/1920 无页面级溢出 | G-X08 |
| T-A06 | 打印 | CDP | 横幅保留；操作隐藏 | G-X08 |
| T-A07 | console | CDP | 0 error | G-X08 |
| T-A08 | 网络 | CDP | Mock 模式 nonFile=0 | G-X01 |
| T-A09 | 存储 | CDP | Mock 模式 0 写 | G-X01 |
| T-A10 | 静态检查 | Node | 31/31 + 新权限/字段断言 | G-X08 |
| T-A11 | 截图 | CDP | 21 + 正式状态新增 | E-11 |
| T-A12 | 设备/Provider | 代码/运行 | 0 调用 | W6 |

### 11.9 补充专项用例（设备/申请/对账/审计/概览）

**设备：**

| ID | 覆盖 | 方法 | 预期 | 关联 |
|---|---|---|---|---|
| T-D01 | 设备字段映射 | 逐字段评审 | 每个字段有来源或 TBD | G-D01 |
| T-D02 | 未批准字段 | UI | 型号/固件/灰度/在线/心跳不出现或明确 TBD | G-D02 |
| T-D03 | 环境字段对象 | UI/API | 设备行不出现 job 的 executionMode/evidenceScope | G-D03 |
| T-D04 | 列表/分页/筛选 | UI/API | 只按批准范围；无聚合不显示统计卡 | G-D04 |
| T-D05 | 设备写入口 | UI | 新增/同步/导出 disabled 且有原因 | G-D05 |

**申请/授权/撤权：**

| ID | 覆盖 | 方法 | 预期 | 关联 |
|---|---|---|---|---|
| T-APP01 | submit 表单 | UI/API | 只收 personId/sourceFileId；成功 submitted | G-A01 |
| T-APP02 | createGrant 表单 | UI/API | 八项输入；expectedCredentialRevision；409 提示 | G-A02 |
| T-APP03 | 审核/撤销/补件拆分 | UI/API | review 只 approve/reject；撤销走 access.manage；补件不提供 | G-A03/G-P02 |
| T-APP04 | 版本冲突 | UI/API | expectedRevision 过期→409；刷新；不覆盖 | G-A04 |
| T-APP05 | readPrivate | UI/API | 独立入口；权限；审计；不缓存 | G-A05 |
| T-APP06 | 理由/同意 | UI/API | 理由有正式落点或删除承诺；同意未批准不显示 | G-A06/G-A07/G-X09 |
| T-APP07 | ID 语义 | UI/API | credentialId/grantId/identityApplicationId 不混用 | G-A08 |
| T-APP08 | 授权状态 | UI | pending/effective/revoked/expired 正确显示 | G-S01 |

**UNKNOWN_RESULT / 对账：**

| ID | 覆盖 | 方法 | 预期 | 关联 |
|---|---|---|---|---|
| T-U01 | 无自动重试 | 代码/运行/定时器 | awaiting_result 不被自动查询/重试/回调推动 | G-T06 |
| T-U02 | enroll unknown | UI/API | 仅查询；不提供 reconcile（TBD） | G-T07 |
| T-U03 | reconcile 权限 | UI/API | 无权限 403；不暴露 job | G-P06 |
| T-U04 | reconcile DTO | API | 未知字段/错 sourceType/decision 400/409；零写 | G-T02 |
| T-U05 | confirmed_removed 200 | API | job succeeded；cleanupPending=false；资源释放 | G-T02 |
| T-U06 | confirmed_removed 202 | API | job retryable_failed；cleanupPending=true；finalize | G-T02 |
| T-U07 | confirmed_present | API | job terminal_failed；grant revoked+cleanupPending=true；资源不释放 | G-T02 |
| T-U08 | still_unknown | API | job awaiting_result；只追加 evidence/log/op/audit | G-T02 |
| T-U09 | throttle | API | 60 秒内 409 `RECONCILE_THROTTLED`；零写 | G-T02 |
| T-U10 | limit | API | 第 9 次 409 `RECONCILE_LIMIT`；零写 | G-T02 |
| T-U11 | 并发对账 | API | 单一 CAS 成功；其他 409；不分叉 | G-T02 |
| T-U12 | cleanup 投影 | UI/API | cleanupPending/cleanupPhase/terminalReason 正确 | G-S10 |

**审计/概览：**

| ID | 覆盖 | 方法 | 预期 | 关联 |
|---|---|---|---|---|
| T-AU01 | audit read 路由 | API/UI | 只读；分页/筛选；无权限 403 | G-AU01 |
| T-AU02 | 字段白名单 | API/UI | 无 result/reason 字段就不显示；不伪称不可变 | G-AU02 |
| T-AU03 | 审计/对账分离 | UI | 审计只读；对账回任务页 | G-AU03 |
| T-AU04 | 分页/导出 | UI/API | 按批准范围；未批准 disabled | G-AU04 |
| T-AU05 | 不可变声明 | 评审 | 存储无保证时保持“非不可变”文案 | G-AU05 |
| T-AU06 | 告警/短码 | UI/API | alertCode/reasonCode 规范化；无原始异常 | G-AU06/G-S06 |
| T-O01 | 概览统计 | UI/API | 只用已批准聚合；否则不显示数字 | G-O01 |
| T-O02 | 概览权限 | UI | 模块按权限显示/禁用 | G-O02 |

### 11.10 本次修订新增专项（T-R01–T-R15）

> 编号连续、无重复。`T-R01..R04` 是 revision 契约；`T-R05..R06` 是按钮禁用/网络 0；`T-R07` 是权限撤销；`T-R08..R13` 是九端点/候选路由/H4-c 门禁；`T-R14..R15` 是禁用原因与 Mock 回归。API 行均为未来编码卡验收；当前执行预期 `404/405`、零写、Provider 0。

| ID | 覆盖 | 方法 | 预期 | 关联 |
|---|---|---|---|---|
| T-R01 | queryJob 唯一权威 | 服务/UI | 六字段只来自按 ID `queryJob`；列表行/缓存/旧响应/本地推导一律拒绝 | G-T01/G-T05 |
| T-R02 | revision 缺失 | API/UI | 记录无 `revision` → `INVALID_JOB/409`，零写；UI 无合法来源 → 按钮禁用、0 请求 | G-T02/G-T03 |
| T-R03 | revision 非法 | API/UI | 0/-1/小数/字符串/NaN/Infinity/≥2^53 → 服务 `INVALID_JOB/409` 或客户端 `PARAM_ERROR/400`，零写 | G-T02/G-T03 |
| T-R04 | revision stale | API/UI | 旧 revision → `REVISION_CONFLICT/409`；不自动重试；重新按 ID 查询 | G-T02/G-T03 |
| T-R05 | 按钮禁用 | UI/DOM | 无合法 revision/E07/E08/E09 未注册 → 重试/对账/恢复按钮隐藏或 disabled；无点击 handler | G-P06/G-T02/G-T03 |
| T-R06 | 网络 0 | CDP network | 上述禁用态点击/加载均 0 请求；无 `/retry`、`/reconcile`、`/finalize-retry` 探测 | G-T06/G-X01 |
| T-R07 | 权限撤销 | UI/API | 下一次请求 403；清空数据/私密内容/按钮；旧 200 不覆盖 forbidden；重拉权限 | G-P09 |
| T-R08 | 九端点 HTTP blocked | API | E01–E09 均 404/405；零写；Provider 0；无 `server.mjs` 分支 | G-X01/G-X02 |
| T-R09 | 候选路由未注册 | 静态 | `routes.mjs` 仅 8 条描述；E08 有描述行、E09 不在；server 无 import/分支；本轮零修改 | G-X02/G-T02 |
| T-R10 | revoke 冻结门禁 | API/UI | E05 404/405；`expectedGrantRevision`/`reasonCode` 冻结前不被接收；服务 implemented 不等于 HTTP | G-P04/G-A03 |
| T-R11 | retry E07 门禁 | API/UI | E07 404/405；不复用 `requeue`；awaiting_result 不 retry；未来 `expectedJobRevision` | G-T03 |
| T-R12 | awaiting_result 收敛 | API/UI | 只允许只读查询 + 人工对账；无 retry/普通 requeue/自动轮询/Provider query；E08 未注册 | G-T06/G-T02 |
| T-R13 | reconcile/finalize 门禁 | API/UI | C1 终审+C2+C3+RC01–RC73 前 E08/E09 完全不注册；页面无可执行按钮、无 200/202 | G-P06/G-T02 |
| T-R14 | 禁用原因/可访问性 | UI/CDP | disabled 有可见原因/`aria-describedby`；焦点可达；不是静默禁用；文案不承诺“稍后自动重试” | G-D05/G-T03 |
| T-R15 | Mock 回归 | 静态/CDP | 31/31、26/26、21 图仍通过；Mock 横幅/`simulated` 未删除；网络 nonFile=0 | G-X08/G-M01 |

## 12. 待确认项

| 编号 | 待确认 | 为什么不能冻结 | 建议 |
|---|---|---|---|
| Q01 | 设备列表读取权限 | H1～H4 没有设备读权限；页面用不存在的 `device.manage` | 优先复用 `device.access.manage`，或新增 `device.read`；Codex 裁定 |
| Q02 | `device.manage` 是否保留 | 不在组织权限目录；05A 页面级白名单与正式目录冲突 | 建议删除，统一 `device.access.manage` |
| Q03 | 设备型号/固件/灰度/在线/心跳来源 | H1～H4 无字段；可能来自 DB-08/设备接入 | 先出设备视图 DTO；未批准不显示 |
| Q04 | 申请详情聚合边界 | credential/grant/occupancy/cycle/room/identity 分散 | 出一个聚合视图 DTO 或明确多请求组合 |
| Q05 | 同意记录 | H1～H4 无；HK-AI-03 未开始 | 未批准前标 TBD，不作为正式字段 |
| Q06 | 自由文本理由与 revoke `reasonCode` | `admin_audit` 无 reason；H4 `revokeReason` 是枚举；H4-c 是固定短码；`reasonCode` 未冻结 | review/reconcile 理由另定；revoke 先做“撤权服务与 HTTP 契约加固”，冻结前不接收 |
| Q07 | 审计读取路由/视图 | 无正式路由；两套日志形状 | W0 定义 audit.read 列表/详情/分页 |
| Q08 | enroll `awaiting_result` 对账 | H4-c 只覆盖 revoke | 只读查询，或另立 H4-d |
| Q09 | H4-c 阶段门禁与 E08/E09 | 设计已批准（`b15aceb`/`ed7b66f`）；C1 `90e4189` 待终审；C2 仅 `42f8970` 文档；C2/C3 未开始；RC01–RC73 未完成 | 逐阶段复审；C1+C2+C3+RC01–RC73 前 E08/E09 不注册、页面无可执行按钮 |
| Q10 | `deviceEffective` 是否暴露前端 | `projectAccess` 是内部投影；无 HTTP 响应 | 定义只读投影字段；不暴露内部证据 |
| Q11 | `retrying` 的 UI 语义 | 不是 job 状态 | 只作局部 action pending；不写 job 枚举 |
| Q12 | 批量审批/导出/补件/设备写 | 无路由/权限/契约 | 首期不做；页面保持禁用 |
| Q13 | 页面与服务层集成方式 | 页面/服务/queryJob/H4-c 无共同树 | 建集成分支；固定 `2e8966b` + `1155b7b` + `cf7c75e`（或后续批准提交） |
| Q14 | 审计“不可变”文案 | 当前正确声明非不可变；存储未保证 | 存储保证后再改 |
| Q15 | 真实设备生效 | 无 `device_verified` 证据 | 保持“否”；W7 单独批准 |
| Q16 | queryJob HTTP 读取编码卡 | 服务读模型已 implemented，但 HTTP 未批准；无路径/权限/错误信封冻结 | 独立编码卡；先定路径、六字段、`device.audit.read`、404 同态；未批准前 UI 无合法 revision |
| Q17 | UI revision 禁用态 | 无合法 revision 时按钮行为、原因文案、0 请求尚无编码卡 | 单独 UI 卡片；用 T-R02..R06 验收；不得在接线卡里顺手加探测请求 |

## 13. 结论与复审请求

**结论：**

1. `2e8966b` 可以作为 Mock 演示 UI 基线，但**不能直接作为正式接线基线**。
2. 页面与正式契约的最大差距是**权限名、视图 DTO、九端点 HTTP 未注册、job revision 来源、写路径 CAS/幂等/审计入参**，不是视觉。
3. 当前页面在 Mock 值层是干净的（21 图 0 泄露、0 非 file 网络、0 真实设备/Provider）；接线时必须保持这些边界。
4. **H4-c 设计已批准**（`b15aceb`/`ed7b66f`），但 C1 最新 `90e4189` 待独立终审，C2 仅 `42f8970` 文档，C2/C3 未开始，RC01–RC73 未完成；E08/E09 完全不注册，页面当前不得有可执行对账/恢复按钮。
5. **九端点 HTTP blocked 9/9**；`queryJob` 六字段读模型已在 `bc2a8b2` 落地、`cf7c75e` 硬化，但 HTTP 读取未批准；revoke 服务 implemented/HTTP blocked；E07 retry proposed/blocked，不完整 requeue 不作正式接口。
6. 无合法 job revision 时，依赖它的 mutation 按钮必须隐藏/禁用、给出明确原因、网络请求 0；`awaiting_result` 只允许只读查询与人工对账，禁止自动重试/普通 requeue。
7. 建议先完成 W0 的 16 项决策 + 九端点逐项编码卡，再按 W1～W6 分阶段接线；W7 真实设备单独批准。

**请求 Codex 复审本审计文档，重点裁定：**

- Q01/Q02 设备读权限与 `device.manage`；
- Q03/Q04 设备/申请视图 DTO；
- Q06/Q07 理由/`reasonCode` 与审计读取；
- Q08/Q09 enroll 对账与 H4-c C1/C2/C3 门禁；
- Q10 `deviceEffective` 的前端投影；
- Q16/Q17 queryJob HTTP 读取与 UI revision 禁用态。

**本文件不修改任何页面、服务、路由或设备状态。复审通过前，不开始接线编码。**

## 附录 A：页面行号索引

| 位置 | 内容 |
|---|---|
| `hk-face-admin/app.js:70-119` | 设备/申请/任务/审计合成 fixture |
| `hk-face-admin/app.js:120-125` | `PERM_NOTE` 四页权限 |
| `hk-face-admin/app.js:126` | 六态枚举 |
| `hk-face-admin/app.js:129-173` | loading/empty/forbidden/error/retrying 渲染 |
| `hk-face-admin/app.js:176-199` | 设备 ready 态与 8 列表格 |
| `hk-face-admin/app.js:201-237` | 申请详情、四个 review 按钮、私密占位、两个 checkbox |
| `hk-face-admin/app.js:239-283` | 任务 ready 态、状态 badge、query/retry/reconcile |
| `hk-face-admin/app.js:285-310` | 审计 ready 态、7 列表格 |
| `hk-face-admin/app.js:320-416` | 本地 action/change 处理 |
| `hk-face-admin/app.js:418-440` | 六态切换与默认 ready |
| `hk-face-admin/index.html:41-50` | 概览 Mock 横幅 |
| `hk-face-admin/index.html:59-63` | 概览统计卡 |
| `hk-face-admin/index.html:96-105` | 本轮范围/边界声明 |
| `hk-face-admin/devices.html:41-50` | 设备 Mock 横幅 |
| `hk-face-admin/devices.html:59-63` | 新增/导出/同步占位 |
| `hk-face-admin/applications.html:41-50` | 申请 Mock 横幅 |
| `hk-face-admin/applications.html:59-63` | 新建/批量/导出占位 |
| `hk-face-admin/tasks.html:41-50` | 任务 Mock 横幅 |
| `hk-face-admin/tasks.html:59-63` | 新建/对账/刷新占位 |
| `hk-face-admin/audits.html:41-50` | 审计 Mock 横幅 |
| `hk-face-admin/audits.html:59-62` | 导出/筛选占位 |
| `hk-face-admin/*.html:66-77` | 六态选择器（四业务页） |
| `hk-face-admin/*.html:79-81` | 状态根容器 |

## 附录 B：关键契约行号索引

| 位置 | 内容 |
|---|---|
| `admin-web/lib/face-service/dto.mjs:20-50` | 四轴枚举 |
| `admin-web/lib/face-service/dto.mjs:106-144` | createGrant 八项输入 |
| `admin-web/lib/face-service/dto.mjs:112-120` | submit 只收 personId/sourceFileId |
| `admin-web/lib/face-service/dto.mjs:167-178` | revoke/query 输入 |
| `admin-web/lib/face-service/dto.mjs:208-233` | `publicAccessState` 投影 |
| `admin-web/lib/face-service/dto.mjs:235-251` | `publicReviewItem` 投影 |
| `admin-web/lib/face-service/dto.mjs:254-263` | `publicJobResult` 旧五字段（`1155b7b`；queryJob 已改用 `queryJobDto`） |
| `admin-web/lib/face-service/state.mjs:19-40` | grant/job 迁移表 |
| `admin-web/lib/face-service/state.mjs:65-116` | `deviceEffective`/`projectAccess` |
| `admin-web/lib/face-service/service.mjs:100-115` | 权限/组织域读取 |
| `admin-web/lib/face-service/service.mjs:199-319` | submit/review/reviewQueue |
| `admin-web/lib/face-service/service.mjs:322-649` | createGrant |
| `admin-web/lib/face-service/service.mjs:652-728` | revoke（服务实现；HTTP blocked） |
| `admin-web/lib/face-service/service.mjs:731-736` | queryJob（`1155b7b` 旧五字段） |
| `admin-web/lib/face-service/service.mjs:99-137` | `queryJobDto` 六字段/revision 失败关闭（`cf7c75e`） |
| `admin-web/lib/face-service/service.mjs:797-803` | `queryJob` 唯一权威 revision 读模型（`cf7c75e`） |
| `admin-web/tests/face-service.test.mjs` | 07B-01～07B-14 定向测试（`cf7c75e`）；本轮未重跑 |
| `admin-web/lib/face-service/routes.mjs:3-60` | 8 条描述路由；E08 在表、E09 不在；未注册 |
| `admin-web/lib/org.mjs:90-105` | 7 个正式权限点 |
| `admin-web/lib/store.mjs:116-125` | `admin_audit` 记录形状 |
| `admin-web/lib/store.mjs:281-286` | LocalStore 组织域 `get` |
| `admin-web/lib/store.mjs:408-423` | CloudStore 组织域 `get` |

## 附录 C：证据文件哈希（Git blob）

| 文件 | 提交 | blob |
|---|---|---|
| `hk-face-admin/app.js` | `2e8966b` | `b34a6f46a39ccd63e37867633c7da612082f04e4` |
| `hk-face-admin/index.html` | `2e8966b` | `23672b3a5ab59dbf494be426f53d71b38162ebea` |
| `hk-face-admin/devices.html` | `2e8966b` | `d5b3ca012ef937636ff163f3fa5c256e44fd3c35` |
| `hk-face-admin/applications.html` | `2e8966b` | `69f682bfeaaad42436e2f2654c4679a6634ec5f1` |
| `hk-face-admin/tasks.html` | `2e8966b` | `4b3dc141d1e426a2aa5f90d02bf504857caf4fba` |
| `hk-face-admin/audits.html` | `2e8966b` | `e67e498270dca0688708bee79dee00b3f842e05a` |
| `docs/tasks/HK-AI-05A-REVIEW-HANDOFF.md` | `2e8966b` | `95f6428fd3b3f9ec13846a8f4b282c9941827533` |
| `docs/tasks/HK-AI-05-STATIC-UI-AUDIT.md` | `2e8966b` | `5c15f804a499eecdaf1713ce3545969738b8d50d` |
| `docs/tasks/HK-AI-05A-UI-CHECK.md` | `2e8966b` | `b325e818a9340ddccf34076624741394aa6802dc` |
| `admin-web/lib/face-service/dto.mjs` | `1155b7b` | `0f77815aaa0c17765078838f622457b632f4409e` |
| `admin-web/lib/face-service/routes.mjs` | `1155b7b` | `2cab81380dd936b453edfb4f08a03664d7d3f230` |
| `admin-web/lib/face-service/state.mjs` | `1155b7b` | `4d8b362b0ed49d6bf5f64d228a879bf6bae257d2` |
| `admin-web/lib/face-service/service.mjs` | `1155b7b` | `e8be71e9ba34f49af52a5736e955da72882de73d` |
| `admin-web/lib/face-service/service.mjs` | `cf7c75e` | `e1e4c95b742d04033b5b9adc5c95a3e3515da2b7` |
| `admin-web/tests/face-service.test.mjs` | `cf7c75e` | `d5bd5ce6367a1fbbc3b5fa81a42a8a377eb12ad1` |
| `admin-web/lib/org.mjs` | `1155b7b` | `dece8b76cad341bb531e891b522aa0f947aed83b` |
| `docs/tasks/HK-AI-05A-UI-APPROVAL-2E8966B-2026-11-11.md` | `a9ad8d8` | `bc94785fe4e7643c3ca022b29932d4f78e358e0e` |
| `docs/tasks/HK-AI-04-H1-FINAL-APPROVAL-6BFE1BA-2026-11-07.md` | `de07fc4` | `31f4ba70d81b742f6a54cc22295f12e469103046` |
| `docs/tasks/HK-AI-04-H3-DESIGN-APPROVAL-B2CD7AB-2026-11-13.md` | `b9a639b` | `12d677b114fc0c9032494c4ffb49e0ffa252c2ba` |
| `docs/tasks/HK-AI-04-H4-REVOKE-RECONCILE-DESIGN.md` | `9fd088d` | `f980ae84a325904fce3b66f14c36249d42a1d3ce` |
| `docs/tasks/HK-AI-07A-FACE-HTTP-WIRING-CONTRACT.md` | `2f597e3` | `0be0feeae69d3017185e645708c1c23f799c958c` |
| `docs/tasks/HK-AI-04-H4C-DESIGN-APPROVAL-B15ACEB-2026-11-14.md` | `ed7b66f` | `8f584c1289a10dd0332cd0a5e3b0aa6cb5f1a6e4` |
| `docs/tasks/HK-AI-04-H4C-IMPLEMENTATION-TASK-2026-11-14.md` | `ed7b66f` | `5068d85fb3584e56dc04ecb971541e8e0b192e35` |
| `docs/tasks/HK-AI-04-H4C-RECONCILIATION-DESIGN.md` | `b15aceb` | `f99fd3b15bfa7220f538d7f5ce893649d5ab5577` |
| `docs/tasks/HK-AI-04-H4C-C1-REVIEW-EVIDENCE-2026-11-14.md` | `90e4189` | `c540fc5540cf37b05611c0be93821ea50a455cf4` |
| 21 张截图清单合并哈希 | `2e8966b` | `fb8eb52339e52c096d385e905c43b1f36c1b6140dcc2d75af689be2b196f2e20` |

> 说明：截图为二进制，逐文件 SHA-256 已由 `HK-AI-05A-UI-CHECK.md` 与 `hk-ai-05a-verify-result.json` 记录；本表只记录清单合并哈希，避免在文档中复制 21 行二进制哈希。

## 附录 D：本轮修订验收清单

| 检查 | 方法 | 通过条件 |
|---|---|---|
| 变更范围 | `git diff --name-only HEAD^` | 只有本审计 Markdown；HTML/CSS/JS/API/测试零变化 |
| diff 格式 | `git diff --check` | exit 0；无空白错误 |
| 提交引用 | 提取 7–40 位十六进制引用，逐项 `git cat-file -t` | 全部解析为 commit/blob/tree；无缺失对象 |
| 批准引用 | 人工核对 H4/H4-c/HTTP/queryJob 四组 | 只用 `6719066`、`9fd088d`、`b15aceb`、`ed7b66f`、`2f597e3`、`bc2a8b2`、`cf7c75e` 等可解析提交；不以设计返工哈希冒充批准 |
| G- 编号 | 正则统计 `G-[A-Z]+[0-9]{2}` | 66 个，无重复；与 §5.7 项数核对一致 |
| T- 编号 | 正则统计 `T-[A-Z]+[0-9]{2}` | 既有系列按本文定义连续（`T-S01..S24` 为范围记号）；`T-R01..T-R15` 连续、无重复 |
| 离线链接 | 扫描 Markdown 链接目标语法与外链协议 | 无外链；不依赖当前分支不存在的本地文件可点击链接 |
| 敏感扫描 | 扫描密钥/令牌/私钥/手机号/身份证/真实 IP/MAC/图片字节 | 除提交/blob 哈希与 `DEMO` 占位外 0 命中 |
| 远端 | `git ls-remote origin refs/heads/docs/hk-face-admin-wiring-audit` | 与本地 `HEAD` 一致 |

---

**文档结束。本轮只修订本审计 Markdown；未修改 HTML/CSS/JS 或 API，未调用应用 HTTP，未连接 Provider/设备，未删除 Mock/模拟标识，未制作演示包，未合并 `main`。**
