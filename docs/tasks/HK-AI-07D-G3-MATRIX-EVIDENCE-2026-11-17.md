# HK-AI-07D G3 冻结矩阵交付证据（2026-11-17 · 11-18 复审修订版）

>  本文档为 G3 交付证据；不修改生产代码、不注册 HTTP、不启动服务、不监听端口、不发业务网络请求；不合并、不开始 G4。
>  所有实测数字均来自测试源码或实际运行结果；90 是**矩阵 ID 数**，不是测试函数数（实际计数见 §3）。
>  **v2（2026-11-18）**：响应独立复审退回（对远端 `5ceb22a` 的 1 P1 + 5 P2），在测试与证据范围内追加修订。最终提交谱系见 §1；修订取证见 §12。

## 1. 谱系与范围

| 项目 | 值 | 核验方式 |
|---|---|---|
| 固定实施基线 | `c8290db0c22bf5e84ceede2d58b6daad7ce2887b`（G2 收尾） | `git log --oneline` |
| 父提交 | `b3a41eaabf59e84a2f99babfee2f0c45ac418f49`（G2 独立复审通过验收） | 同上 |
| 分支 | `feat/hk-face-g3-matrix` | `git branch --show-current` |
| 已提交 1 | `4f1b0d6` test(hk-face-g3): 建立冻结矩阵公共 testkit 与网络 guard — 仅 `admin-web/tests/face-g3-testkit.mjs`（724 行新增） | `git show --stat 4f1b0d6` |
| 已提交 2 | `2c86b56` test(hk-face-g3): 补导出 h3a claim helper 供 C03/C04/C09 — 仅 testkit（4+/1-），**未改 h3a.mjs 本身** | `git show --stat 2c86b56` |
| 已提交 3 | `5ceb22a` test(hk-face-g3): 落地 90 条矩阵三文件 + 交付证据文档（4 文件 +1918 行）— 首次交付，已推送远端并核对一致 | `git show --stat 5ceb22a` |
| 已提交 4 | **本轮复审修订提交（v2）**：4 个测试文件（testkit + psrtn + ko + c）+ 本文档，与本文档一同提交；SHA 即本分支 tip（提交后 `git rev-parse HEAD`） | `git log -1 --stat` |
| 被测实现 | `admin-web/lib/face-service/retry.mjs`（G2 已验收，G3 零修改） | §9 `git diff` |
| 矩阵文件 | `face-g3-psrtn.test.mjs`（P/S/R/T/N 共 52 ID）、`face-g3-ko.test.mjs`（K/O 共 29 ID）、`face-g3-c.test.mjs`（C 共 9 ID） | 三文件源码 |
| 公共基础设施 | `face-g3-testkit.mjs`（guard + fixture + 断言 helper + SELF-CHECK） | 源码 |
| 本证据文档 | `docs/tasks/HK-AI-07D-G3-MATRIX-EVIDENCE-2026-11-17.md`（本文件，唯一新增文档） | — |

基线说明：`2c86b56` 的「补导出」是在 testkit 内把 guard 动态导入后的 `claimDispatchJob/buildClaimPlan/assertLeaseFence` 转出给 C 系列，**生产 `h3a.mjs` 无差异**（其 `buildClaimPlan:222` / `claimDispatchJob:274` 在基线即已导出）。

---

## 2. 90 行逐条证据表

记号：`Z` = 全库 `structuredClone` 前后内容级零变化；`J+L+O+D+A` = job + 1 条 queued log + op key + 0–2 条 domain + 1 条确定性 audit；`P0` = Provider/网络调用 0。每条失败行的 `expectError` 同时断言 `err.code` + `err.status`、全库 Z、Provider 0、无 500、无 stack、消息无合成标识。下表「实测」列均为统一非 HTTP 套件实际执行结果（见 §10）。

### P 系列 P01–P13（13 条，`face-g3-psrtn.test.mjs`）

| ID | 前置/注入（取自对应 test()） | 预期 code+status / 成功写集 | 实测 | 写集 | 状态 |
|---|---|---|---|---|---|
| P01 | `setupG3()` 默认（含 retry 权限、已到期、domain 预建）；`assertReceiptShape` + `assertSuccessWriteSet` + domain 计数不变 | 回执五字段 `revision=5/attempts=2/nextAttemptAt=NOW-5000` | pass：回执与写集逐字段断言通过，D=0 | J+L+O+D+A（D=0） | PASS |
| P02 | `memberOverrides.permissions=["device.audit.read","device.operation.reconcile"]` | `FORBIDDEN/403` | pass：`expectError` 双断言 + Z + P0 | Z | PASS |
| P03 | `memberOverrides.permissions=["device.audit.read"]` | `FORBIDDEN/403` | pass：同上 | Z | PASS |
| P04 | `memberOverrides.permissions=["device.operation.reconcile"]` | `FORBIDDEN/403` | pass：同上 | Z | PASS |
| P05 | `memberOverrides.role="admin", permissions=[]` | `FORBIDDEN/403` | pass：同上 | Z | PASS |
| P06 | `memberOverrides.status="suspended"` | `FORBIDDEN/403` | pass：同上 | Z | PASS |
| P07 | `orgOverrides.status="suspended"` | `FORBIDDEN/403` | pass：同上 | Z | PASS |
| P08 | `memberOverrides.orgId=ORG_OTHER`（成员跨组织） | `NOT_FOUND/404` | pass：同上（与跨组织 job 同态） | Z | PASS |
| P09 | `job=makeEnrollJob({orgId:ORG_OTHER})` | `NOT_FOUND/404`（不得 403） | pass：同上 | Z | PASS |
| P10 | 真实 `store.data` 成员 `permissions=[]`，代理 `store.get` 对 `org_memberships` 返回带权限克隆（事务外预读），transact 从 data 读真实空权限 | `FORBIDDEN/403`（事务内权威复核生效） | pass：代理在 `finally` 精确还原；双断言 + Z + P0 | Z | PASS |
| P11 | 首次 `retry` 成功取回执后 `member.permissions=[]`，同 key 重放 | `FORBIDDEN/403`，不命中旧回执 | pass：双断言 + Z + P0 | Z | PASS |
| P12 | `memberOverrides.principalId=ACTOR_B`（与 actor.actorId 不符） | `FORBIDDEN/403` | pass：双断言 + Z + P0 | Z | PASS |
| P13 | 子场景①`actorType:"system"`；②自造 service 的 actor 不带 `actorType` | `FORBIDDEN/403` | pass：两子场景均通过双断言 + Z + P0 | Z | PASS |

### S 系列 S01–S16（16 条，`face-g3-psrtn.test.mjs`）

| ID | 前置/注入 | 预期 code+status / 成功写集 | 实测 | 写集 | 状态 |
|---|---|---|---|---|---|
| S01 | 默认 enroll 成功；比对 `result` 深拷贝原值、`nextAttemptAt=NOW-5000` | 成功写集，result/due 原值保留 | pass：`assertSuccessWriteSet` + 原值断言通过 | J+L+O+D+A（D=0） | PASS |
| S02 | `job=makeRevokeJob()`；`assertReceiptShape(attempts=1,nextAttemptAt=null)` | 成功写集，`nextAttemptAt=null/result=null` | pass：清空断言 + `validateRevokeJob` 不抛 | J+L+O+D+A（D=0） | PASS |
| S03 | `state:"queued", nextAttemptAt:null, result:null` | `INVALID_STATE/409` | pass：双断言 + Z + P0 | Z | PASS |
| S04 | `state:"sending"` + 活动 lease 三字段；逐字段比对 | `INVALID_STATE/409`，lease 三字段零改 | pass：三字段零改断言通过 | Z | PASS |
| S05 | `state:"awaiting_result"`（result.outcome 同值） | `INVALID_JOB/409`（H3 D53） | pass：双断言 + Z + P0 | Z | PASS |
| S06 | `state:"succeeded"` | `INVALID_STATE/409` | pass：同上 | Z | PASS |
| S07 | `state:"terminal_failed"`, `errorKind="RETRY_EXHAUSTED"` | `INVALID_STATE/409`（Q4） | pass：同上 | Z | PASS |
| S08 | 子场景①`cancelled(enroll)`；②`cancelled(revoke, finalize 形状)` | `INVALID_STATE/409`（两形状同码） | pass：两子场景均通过双断言 + Z + P0 | Z | PASS |
| S09 | `makeRevokeJob({cleanupPhase:"finalize", providerOutcome:"confirmed_removed", finalizeAttempts:1})` | `INVALID_STATE/409`（**裁定2：只验 finalize 阶段被拒，不要求 E09**） | pass：双断言 + Z + P0 | Z | PASS |
| S10 | `attempts=4, leaseGeneration=4, result.attempt=4` | `INVALID_JOB/409` | pass：双断言 + Z + P0 | Z | PASS |
| S11 | `attempts=0, leaseGeneration=0, result.attempt=0` | `INVALID_JOB/409` | pass：同上 | Z | PASS |
| S12 | `result.errorKind="UNKNOWN_RESULT"` | `INVALID_JOB/409` | pass：同上 | Z | PASS |
| S13 | `errorKind` 分别 `LOCAL_FINALIZE`/`PRE_SEND_BLOCKED`/`TERMINAL` | `INVALID_JOB/409` | pass：三子场景均通过双断言 + Z + P0 | Z | PASS |
| S14 | result 五损坏：`null`/`[]`/多字段/少 `reasonCode`/`outcome="succeeded"`；`expectNormalized` 禁泄露 `["任务结果结构非法","CONFLICT","INVALID_JOB"]` | `INVALID_JOB/409` | pass：五子场景双断言 + Z + P0 + 消息不泄露 | Z | PASS |
| S15 | action 三子场景：`"bogus"`/`"ENROLL"`/删除 `action` | `INVALID_JOB/409` | pass：三子场景均通过 | Z | PASS |
| S16 | validator 结构码四子场景：缺 `dispatchSnapshot`/快照缺 `access_devices` 版本见证/`schemaVersion=99`/`provider:"real"`；禁泄露 8 个内部短语 | `INVALID_JOB/409`（归一化，不泄露内部码） | pass：四子场景双断言 + Z + P0 + 消息不泄露 | Z | PASS |

### R 系列 R01–R09（9 条，`face-g3-psrtn.test.mjs`）

| ID | 前置/注入 | 预期 code+status / 成功写集 | 实测 | 写集 | 状态 |
|---|---|---|---|---|---|
| R01 | `expected=4 == job.revision=4` | 成功，新 `revision=5` | pass：`assertReceiptShape(revision=5)` + 写集通过 | J+L+O+D+A（D=0） | PASS |
| R02 | `job.revision=5` 传 `expected=4`（落后） | `REVISION_CONFLICT/409` | pass：双断言 + Z + P0 | Z | PASS |
| R03 | `job.revision=4` 传 `expected=5`（超前） | `REVISION_CONFLICT/409` | pass：同上 | Z | PASS |
| R04 | body=`{}`（expected 缺失） | `PARAM_ERROR/400` | pass：同上 | Z | PASS |
| R05 | `expected` 分别 `0/-1/1.5/"7"/NaN/Infinity/2**53` | `PARAM_ERROR/400` | pass：七子场景均通过 | Z | PASS |
| R06 | body 用旧名 `{expectedRevision:4}` | `PARAM_ERROR/400` | pass：双断言 + Z + P0 | Z | PASS |
| R07 | `expected=job.revision=MAX_SAFE_INTEGER-2`（+1 越 stored 上限） | `INVALID_JOB/409` | pass：同上 | Z | PASS |
| R08 | `expected=job.revision=MAX_SAFE_INTEGER` | `INVALID_JOB/409` | pass：同上 | Z | PASS |
| R09 | body 额外字段 `extra:1` | `PARAM_ERROR/400` | pass：同上 | Z | PASS |

### K 系列 K01–K16（16 条，`face-g3-ko.test.mjs`）

| ID | 前置/注入 | 预期 code+status / 成功写集 | 实测 | 写集 | 状态 |
|---|---|---|---|---|---|
| K01 | headers 传 `{}` / 完全缺省 | `PARAM_ERROR/400`，不建 op key（前后 `count(OP_KEYS)` 不变） | pass：两路径双断言 + Z + P0，op key 计数不变 | Z | PASS |
| K02 | key 六类非法：15 位/129 位/空格/斜杠/数组/逗号重复头 | `PARAM_ERROR/400`，不建 op key | pass：六子场景均通过，op key 计数不变 | Z | PASS |
| K03 | 合法首次；domain 已预建；断言 op key 六字段、回执五字段、`requestDigest=digestOf({jobId,expectedJobRevision})`、原始 key 零落库 | 成功写集；原始 key 不落库 | pass：`assertSuccessWriteSet` + 六/五字段 + 摘要绑定通过，D=0，只新增 1 条 audit | J+L+O+D+A（D=0） | PASS |
| K04 | 首次成功后同 key 同摘要再调 | 原回执逐字段相等、audit 不新增 | pass：`deepEqual(replay,receipt)` + `assertZeroWrite` + P0 | Z | PASS |
| K05 | 首次成功后同 key 改 `expectedJobRevision=5` | `CONFLICT/409`，op key 内容不变 | pass：双断言 + op key 深比较不变 + Z + P0 | Z | PASS |
| K06 | `jobs=[makeEnrollJob(), makeEnrollJob({_id:"job-g3-enroll-2"})]`，先对 JOB 成功，再同 key 对另一 job | `CONFLICT/409`，op key 不变 | pass：同上 | Z | PASS |
| K07 | 首次成功后将 job 分别改 `sending`/`succeeded`（含 leaseOwner）再同 key 重放 | 仍返回原五字段快照，不读当前状态 | pass：两子场景 `deepEqual` + 全库 Z + P0 | Z | PASS |
| K08 | K2 非法四类：Base64 非法/长度 16 字节/版本"0"/realm 大写；另测「权限预读先于 K2」（非法配置 + 空权限） | 四类 `NOT_CONFIGURED/503`；权限优先子场景 `FORBIDDEN/403` | pass：五子场景均通过双断言 + Z + P0 | Z | PASS |
| K09 | `withDomains:false`（前置 `count(DOMAINS)=0`）；断言写 head+version 2 条、`audit.target` 为五条有序引用 `join(", ")`；随后该形态合法重放 | 成功写集 `J+L+O+D+A(D=2)`；目标 5 条；重放 Z | pass：`count(DOMAINS)=2` + target 精确相等 + 重放 `deepEqual` + 全库 Z | J+L+O+D+A（D=2），重放 Z | PASS |
| K10 | `withDomains:true` 后 `removeRecord(versionId)`（head 在、version 缺） | `DOMAIN_INCOMPLETE/409`，不得补写 version | pass：双断言 + 缺项仍缺 + Z + P0 | Z | PASS |
| K11 | domain 用 `K2_ENV` 预建，service 用 `K2_ENV_B`（同 realm 换钥） | `DOMAIN_MISMATCH/409` | pass：双断言 + Z + P0 | Z | PASS |
| K12 | 首次成功后对 `op.result` 注入 12 种损坏（null/数组/错 jobId/state≠queued/revision 1.5/revision 超上限/revision≠expected+1/attempts=0/attempts=4/nextAttemptAt=-1/多字段/少字段），每次恢复原值 | 12 种全部 `CONFLICT/409`，不修复 | pass：12 子场景均双断言 + 损坏值原样恢复 + Z + P0 | Z | PASS |
| K13 | 首次成功后 `removeRecord(AUDIT_COLLECTION, auditIdFor(...))` | `CONFLICT/409`，不替 Store 补写 audit | pass：双断言 + audit 仍缺 + Z + P0 | Z | PASS |
| K14 | 首次成功后 `removeRecord(OP_KEYS, opKey)` | `CONFLICT/409`，孤立 audit 不被改写/迁移 | pass：双断言 + audit 深比较不变 + Z + P0 | Z | PASS |
| K15 | 首次成功后模拟再次失败：job 回 `retryable_failed`、`revision=5`、`result` 合法、`nextAttemptAt=NOW`，同 key + 新 revision | `CONFLICT/409`（摘要不同） | pass：双断言 + 摘要仍绑定旧 revision + Z + P0 | Z | PASS |
| K16 | 首次成功后 `op.result.revision` 篡改为 `JOB_REV+2`（类型合法） | `CONFLICT/409`，不得当成功重放，篡改值原样保留 | pass：双断言 + 篡改值保留 + 不新增 audit + Z + P0 | Z | PASS |

### T 系列 T01–T06（6 条，`face-g3-psrtn.test.mjs`）

| ID | 前置/注入 | 预期 code+status / 成功写集 | 实测 | 写集 | 状态 |
|---|---|---|---|---|---|
| T01 | `nextAttemptAt=NOW, now=NOW`（等号） | 成功，`nextAttemptAt=NOW` | pass：回执 + 写集逐字段通过 | J+L+O+D+A（D=0） | PASS |
| T02 | `nextAttemptAt=NOW+1, now=NOW` | `RETRY_NOT_DUE/409` | pass：双断言 + Z + P0 | Z | PASS |
| T03 | 子场景①enroll 成功；②revoke 成功；边界字段逐项断言 | enroll 保留 due/attempts/leaseGeneration；revoke `nextAttemptAt=null` | pass：两子场景回执 + 写集断言通过 | J+L+O+D+A（D=0） | PASS |
| T04 | body 分别传 `now/nextAttemptAt/delay/backoff/force`（保留 expected） | `PARAM_ERROR/400` | pass：五子场景均通过 | Z | PASS |
| T05 | 子场景①`now=1.5`；②`now=-1`；③`result.finishedAt=NOW+10000, now=NOW` | `ADAPTER_UNAVAILABLE/503` | pass：三子场景均双断言 + Z + P0 | Z | PASS |
| T06 | 源码正则扫描 retry.mjs 无 `setTimeout/setInterval/Retry-After/fetch/网络入口`；`resetRuntimeViolations` 后跑成功路径；`setImmediate` 后比 store 无后续写 | 无自动重试、无 Retry-After、Provider 0、无定时器补写 | pass：五项 `doesNotMatch` + 运行期零违规 + store 无后续写入 | Z（成功主体写集已断言）；本条观察窗 Z | PASS |

### C 系列 C01–C09（9 条，`face-g3-c.test.mjs`）

| ID | 前置/注入 | 预期 code+status / 成功写集 | 实测 | 写集 | 状态 |
|---|---|---|---|---|---|
| C01 | `Promise.all([retry(key),retry(key)])` 同键并发 | 两回执 deepEqual；OP_KEYS/LOGS/AUDIT 各 1 条；D=0 | pass：`deepEqual(r1,r2)` + 三集合计数各 1 + domain 不变 | J+L+O+D+A（D=0） | PASS |
| C02 | `Promise.allSettled([retry(keyA),retry(keyB)])` 异键同 revision 并发 | 恰一 fulfilled、一 `INVALID_STATE/409`；败者零写 | pass：1 成功/1 失败 + 败者码+status + 恰好一个 op key | 胜者 J+L+O+D+A；败者 Z | PASS |
| C03 | **真实 claim 交互**：先 `retry` 成功（断言 lease 三字段/attempts 相对 pre 不变），再 `claimDispatchJob({owner:"worker-g3",now:()=>NOW})` | claim 读到 queued → `sending`、attempts+1、due/result 清空、lease 写入、generation+1，fence 通过 `assertLeaseFence` | pass：9 个持久化字段与 claim 返回一致 + fence 校验通过 | J+L+O+D+A（D=0） | PASS |
| C04 | **真实 claim 交互**：`makeEnrollJob({state:"queued"})` → `claimDispatchJob({owner:"worker-first"})` 产生 sending+lease/fence，记录 fence 快照，再 `retry` | `INVALID_STATE/409`，lease 三字段与 fence 零改、fence 仍有效 | pass：`expectError` 双断言 + 全库 Z + lease/fence 深比较 + `assertLeaseFence` 不抛 | Z | PASS |
| C05 | `makeEnrollJob({state:"awaiting_result", nextAttemptAt:null, result:{outcome:"awaiting_result",...}})`（**只验 retry 侧，不实现/不调用 reconcile**） | `INVALID_JOB/409` | pass：双断言 + Z + P0；证据注明「E08 未实现，未验证真实 reconcile 并发交互」 | Z | PASS（裁定1） |
| C06 | 先 `retry` 成功，再依次把 job.state 改 `succeeded`/`terminal_failed`/`cancelled`，新 key retry | `INVALID_STATE/409` | pass：三子场景均双断言 + Z + P0 | Z | PASS |
| C07 | 首次成功后把当前 job 改 `sending`+`leaseOwner="worker-late"`，同 key 重放 | 原快照逐字段相等、不读当前 job、不新增 op/log/audit/domain | pass：`deepEqual` + 四集合计数/内容不变 + 全库 Z | Z | PASS |
| C08 | `putRecord(LOGS, deterministicLogId(JOB,"queued",5), {sentinelMarker:"MUST_SURVIVE"})` 预占 | `CONFLICT/409`，整事务回滚、哨兵保留 | pass：双断言 + 预占记录深比较不变 + 哨兵存活 + Z | Z | PASS |
| C09 | **真实 claim 交互**：`claimDispatchJob({owner:"worker-old"})` 产生旧 fence → `putRecord` 复位 `makeEnrollJob()`（lease 回基线）→ `retry` 成功 | 成功；lease 三字段相对基线零改；旧 fence 不被采纳/消费，retry 后 `LEASE_FENCE_REJECTED` | pass：四字段零改 + fence 深比较 + `assert.notEqual` + `assert.throws(LEASE_FENCE_REJECTED)` | J+L+O+D+A（D=0） | PASS |

### O 系列 O01–O13（13 条，`face-g3-ko.test.mjs`）

| ID | 前置/注入 | 预期 code+status / 成功写集 | 实测 | 写集 | 状态 |
|---|---|---|---|---|---|
| O01 | 成功回执 `Object.keys().sort()` | 精确 `[attempts,jobId,nextAttemptAt,revision,state]` | pass：键集合 + `assertReceiptShape` | J+L+O+D+A（D=0） | PASS |
| O02 | 首次 + 同键重放回执逐字段比对 | 逐字段相等 | pass：`deepEqual` + 逐字段 `equal` | Z（重放） | PASS |
| O03 | 成功响应 JSON 扫描 | 无 `leaseOwner/leaseExpiresAt/leaseGeneration/lease/requestDigest/digest/opKey/op_key/op:/原始 key` | pass：`assertResponseClean` 全项不命中 | Z（扫描） | PASS |
| O04 | 成功响应 JSON 扫描 | 无 `result/errorKind/reasonCode/message/stack` | pass：同上 | Z（扫描） | PASS |
| O05 | 成功响应 JSON 扫描 | 无 `orgId/actorId/actorType/membershipId/principalId/credentialId/deviceId/serial/personId/fileId/objectKey/grantId/claimId/slotId/provider/evidenceScope` 等 | pass：同上 | Z（扫描） | PASS |
| O06 | 成功响应 JSON 扫描 | 无 `auditId/logId/createdAt/updatedAt` | pass：同上 | Z（扫描） | PASS |
| O07 | enroll / revoke 两成功子场景 | `state="queued"`；enroll `nextAttemptAt` 为 number、revoke 为 null | pass：两子场景类型断言 + 写集断言 | J+L+O+D+A（D=0） | PASS |
| O08 | 遍历 12 个既有错误码各构造一次失败；内联 `CODE_STATUS` 冻结映射表 | 码 ∈ §4.10 12 码、status 匹配映射、消息固定、全库 Z | pass：12 子场景的 `err.code/err.status/err.message` 三要素 + Z 均通过（详见 §7） | Z | PASS |
| O09 | ①跨组织 job（`orgId=ORG_OTHER`）②不存在 job（`job-g3-missing-0001`） | 两者 `NOT_FOUND/404/"任务不可用"` 三要素完全同态，各全库 Z + P0 | pass：两次 failure tuple 相等 + Z + P0 | Z | PASS |
| O10 | 静态三子项：①剥离注释后扫 `admin-web/lib/**/*.mjs` 无 `\brequeue\b`；②`server.mjs` 无 `/\/retry\b/` 无 `device-operation-job-retry`；③`routes.mjs` 无 `["']device-operation-job-retry["']` | 三子项全过才算 PASS；③预期应已清理 | **blocked**：①②局部 PASS、③ FAIL（描述行仍在），整体 BLOCKED 不计 PASS（见 §5） | Z | **BLOCKED** |
| O11 | 旧 requeue 遗留：`state=queued` job + 旧 log（deterministicLogId）+ 旧 audit（`action:"H4 requeue"`）+ 新 key 请求 | `INVALID_STATE/409`，不误用旧结果、不反推/补写 op key、不迁移 | pass：双断言 + op key 仍缺 + 旧 audit/log 原样保留；`t.diagnostic` 记录「G3 覆盖不替代 G4 独立复核」 | Z | PASS（裁定3） |
| O12 | 成功后扫描响应/log/audit/op key 四类载体 | 无原始 key、合成手机号/证件号/序列号/objectKey/PII 字面量；`requestDigest` 仅允许存在于 op key | pass：四类载体 `universal` 全不命中；`outward` 仅 op key 例外 | Z（扫描） | PASS |
| O13 | 成功后取 log/audit | log 精确 15 语义字段（`errorKind/reasonCode/alertCode=null`）；audit 六语义字段；二者无 key/digest/message/stack | pass：`LOG_FIELDS.length===15` + `semanticKeys` 精确 + null 断言 + 敏感扫描（详见 §7） | J+L+O+D+A（D=0） | PASS |

### N 系列 N01–N08（8 条，`face-g3-psrtn.test.mjs`）

| ID | 前置/注入（代表性失败） | 预期 code+status | 实测 | 写集 | 状态 |
|---|---|---|---|---|---|
| N01 | `expected=0` | `PARAM_ERROR/400` | pass：双断言 + Z + P0 | Z | PASS |
| N02 | `permissions=["device.audit.read"]` | `FORBIDDEN/403` | pass：同上 | Z | PASS |
| N03 | `job.orgId=ORG_OTHER` | `NOT_FOUND/404` | pass：同上 | Z | PASS |
| N04 | `state="queued"` | `INVALID_STATE/409` | pass：同上 | Z | PASS |
| N05 | `expected=JOB_REV+1=5` | `REVISION_CONFLICT/409` | pass：同上 | Z | PASS |
| N06 | `nextAttemptAt=NOW+100000` | `RETRY_NOT_DUE/409` | pass：同上 | Z | PASS |
| N07 | 子场景①换钥同 realm（`K2_ENV_B`）②同键异摘要重放 | ①`DOMAIN_MISMATCH/409` ②`CONFLICT/409` | pass：两子场景均双断言 + Z + P0 | Z | PASS |
| N08 | 子场景①`expected=MAX_SAFE_INTEGER`（溢出）②成功后删 audit 再重放 | ①`INVALID_JOB/409` ②`CONFLICT/409` | pass：两子场景均双断言 + Z + P0 | Z | PASS |

---

## 3. 计数核对（ID 数与测试函数数分开报）

### 3.1 矩阵 ID 口径（90）

| 系列 | 范围 | ID 数 | 可直接执行 | 真实 claim 交互 | blocked |
|---|---|---:|---:|---:|---:|
| P | P01–P13 | 13 | 13 | 0 | 0 |
| S | S01–S16 | 16 | 16 | 0 | 0 |
| R | R01–R09 | 9 | 9 | 0 | 0 |
| K | K01–K16 | 16 | 16 | 0 | 0 |
| T | T01–T06 | 6 | 6 | 0 | 0 |
| C | C01–C09 | 9 | 6 | 3（C03/C04/C09） | 0 |
| O | O01–O13 | 13 | 12 | 0 | 1（O10） |
| N | N01–N08 | 8 | 8 | 0 | 0 |
| **合计** | — | **90** | **86** | **3** | **1** |

核对：13+16+9+16+6+9+13+8 = **90**；86（显式含 C05 裁定1、S09 裁定2）+ 3（C03/C04/C09 真实 claim 交互，已含在 C 系列 9 条内不重复计）+ 1（O10 blocked，仍占 1 个 ID）= **90**。矩阵 ID 父测试声明数：psrtn 52 + ko 29 + c 9 = **90**（与 ID 数一一对应）。

### 3.2 实际测试函数计数（另报，非 90）

统一非 HTTP 套件实测：首版 `5ceb22a` 为 **`# tests 313 / # pass 313 / # fail 0`**；v2 复审修订后为 **`# tests 322 / # pass 322 / # fail 0`**；R2 剩余项（底层 guard 入口补齐 + SELF-CHECK-7）后为 **`# tests 326 / # pass 326 / # fail 0`**（见 §10/§12/§13）。按文件（每个文件经传递 import 都会运行 testkit 的 SELF-CHECK，故逐文件计数含重复自检；新增一条自检会在 4 个 G3 文件各计一次，合计 +4）：

| 文件 | 首版（5ceb22a） | v2 实测 | R2 后实测 | 其中矩阵 ID 父测试 | 说明 |
|---|---:|---:|---:|---:|---|
| `face-strict-retry.test.mjs` | 130 pass | 130 pass | 130 pass | — | G2 既有回归（LC01–LC10 + REG/P1/P2），本次重跑未改 |
| `face-g3-testkit.mjs` | 4 pass | 6 pass | 7 pass | — | 首版 SELF-CHECK-1..4；v2 增 5（ESM 同步）/6（独立 oracle）；R2 增 7（底层入口） |
| `face-g3-psrtn.test.mjs` | 96 pass | 98 pass | 99 pass | 52 | 52 ID 父测试 + 子场景（含传递运行的自检） |
| `face-g3-ko.test.mjs` | 70 pass | 72 pass | 73 pass | 29 | 29 ID 父测试 + 子场景（含传递运行的自检） |
| `face-g3-c.test.mjs` | 13 pass | 16 pass | 17 pass | 9 | 9 ID 父测试 + C08-RERUN 子用例 + 传递自检 |
| **统一套件合计** | **313 pass** | **322 pass** | **326 pass / 0 fail** | **90** | 五文件显式列举，避免 `tests/*.test.mjs` glob 拉入 HTTP 套件 |

> 结论：90 指矩阵 ID；实际测试函数 R2 后为 326（含 G2 回归 130、testkit 自检按文件传递计数、子场景展开）。不以「恰好 90 个 test()」为目标。首版 313 保持不变。

---

## 4. 三项裁定落点

| 裁定 | 落点 | 实际落实（来自 test() 源码） |
|---|---|---|
| **裁定1：C05** | `face-g3-c.test.mjs` C05 | 只构造 `awaiting_result` 调用 retry，断言 `INVALID_JOB/409` + 全库 Z；文件头与用例名均标注「E08 未实现，未验证真实 reconcile 并发交互」；**未实现、未调用 reconcile**。归入 86 条可直接执行。 |
| **裁定2：S09** | `face-g3-psrtn.test.mjs` S09 | 只构造 `cleanupPhase=finalize` 的 `retryable_failed` job，断言 `INVALID_STATE/409` + Z；**未要求实现 E09**，用例名写明裁定2。归入 86 条可直接执行。 |
| **裁定3：O10/O11** | `face-g3-ko.test.mjs` O10/O11 | 两条均计入 90 ID。O11 用例以 `t.diagnostic` 记录「G3 覆盖不替代 G4 独立复核」。O10 因第三子项未清理整体 blocked；G4 后续独立复核不因 G3 覆盖而免验。 |

---

## 5. O10 blocked 取证（三子项，整体不计 PASS）

`O10` 用本文件内 `o10DynamicGate()`（v2 修订，源码 `face-g3-ko.test.mjs:580-590`）记录三子项并按实际结果**动态判定**：三子项全 true → PASS 且不登记 blocked；任一 false → BLOCKED 并登记 `BLOCKED_RECORDS`。**v2 修正**：不再硬编码「③ 必须失败」——避免 Q8 清理描述行后同一用例假失败（详见 §12.5）。当前 routes.mjs 描述行仍在，实测 BLOCKED（①②ok=true、③ok=false），O10 用例本身 PASS（成功记录一个 blocked）：

| 子项 | 断言 | 实测 | 说明 |
|---|---|---|---|
| ① lib 无 requeue 入口 | 剥离 `/* */` 与 `//` 注释后遍历 `admin-web/lib/**/*.mjs`，逐文件 `assert.doesNotMatch(/\brequeue\b/i)` | **PASS** | `retry.mjs:4` 注释的 `RETRY-REQUEUE-DESIGN` 文件名被剥离，不构成可调用入口 |
| ② server.mjs 无 `/retry` | `assert.doesNotMatch(/\/retry\b/)` 与 `assert.doesNotMatch(/device-operation-job-retry/)` | **PASS** | 服务层未注册任何 retry 分支 |
| ③ routes.mjs 已清理 E07 描述行 | `assert.doesNotMatch(/["']device-operation-job-retry["']/)` | **FAIL（blocked 根因）** | `admin-web/lib/face-service/routes.mjs:47` `id:"device-operation-job-retry"`、`:49` `path:"/api/v2/device-operation-jobs/:jobId/retry"` 仍在 |

独立复核（本次实测）：`grep -i requeue admin-web/lib` 仅命中 `retry.mjs:4` 注释；`grep -n retry admin-web/server.mjs` 无命中；`routes.mjs` 第 47/49 行描述行仍在。三子项结果与 `expectBlocked` 记录一致（①② ok=true，③ ok=false）。

**处理**：O10 整体 `blocked`，不计 PASS；①②仅作局部证据，不删③断言。blocked 不阻断其余 89 条执行与交付；G3 最终结论须声明「O10 blocked，待独立清理后复验」，不得宣称 90/90 全通过。
**复验前置**：设计 §4.11:510 / 07A Q8 规定的**独立小提交**清理 `routes.mjs:47-53` 后，用同一 O10 用例复验，三子项全过方可将状态由 blocked 改为 pass。**本卡不得夹带该清理**。

---

## 6. 网络 guard 证据（testkit SELF-CHECK-1..7）

### 6.1 入口清单（实测 `guardEntryNames().length = 49`）

- 原 25 个：`net.createServer`、`http.Server.prototype.listen`、`https.Server.prototype.listen`、`http.request`、`http.get`、`https.request`、`https.get`、`globalThis.fetch`、`dns.lookup`、`net.connect`、`net.createConnection`，以及 `dns.resolve*` 全 14 个：`dns.resolve/resolve4/resolve6/resolveAny/resolveCaa/resolveCname/resolveMx/resolveNaptr/resolveNs/resolvePtr/resolveSoa/resolveSrv/resolveTlsa/resolveTxt`。
- R2 新增 7 个底层入口：`net.Server.prototype.listen`、`net.Socket.prototype.connect`、`tls.connect`、`dgram.createSocket`、`dgram.Socket.prototype.send`、`dgram.Socket.prototype.bind`、`dgram.Socket.prototype.connect`。
- R2 新增 `dns.promises.*` 17 个（promise 风格、mock 返回 Promise）：`dns.promises.lookup/lookupService/resolve/resolve4/resolve6/resolveAny/resolveCaa/resolveCname/resolveMx/resolveNaptr/resolveNs/resolvePtr/resolveSoa/resolveSrv/resolveTlsa/resolveTxt/reverse`。不含 `Resolver`/`getServers`/`setServers`/`getDefaultResultOrder`/`setDefaultResultOrder`（非解析/查询入口）。
- 合计 **49 = 11 + 14 + 7 + 17**。SELF-CHECK-1 断言 18 个必需入口全覆盖、`dns.resolve*`/`dns.promises.*` 均存在、总数 `>= 48`（实测 49）。

### 6.2 加载前安装 / 加载期零违规 / 永久保留 vs 可清零

- testkit 顶层**只静态 import Node 内建模块**；被测模块（`store/collections/h3a/h4b/retry/model`）全部走 top-level `await import()`（`:213-218`）。SELF-CHECK-1 以正则断言顶层无 `import ... from "../lib/"`，并实测 `installed=true`、`phase="runtime"`、`getViolations().loadTime=[]`。
- `install()` 先把全部 49 个入口（11+14+7+17）换成桩，`assertNoLoadTimeViolation()` 通过后切到 `runtime`；有违规抛 `G3_LOADTIME_NETWORK_VIOLATION` 且**不清除** `loadTimeViolations`（SELF-CHECK-4 负向验证：制造 1 次加载期违规后断言 `loadTime.length=1` 且抛错后仍为 1）。R2 新增入口走完全相同的 install/正控/恢复流程，未改动这五处机制本身。
- `runtimeViolations` 可由 `resetRuntimeViolations()` 清零；`loadTimeViolations` **无任何清除路径**。

### 6.3 正控（不转发真实函数）

`positiveControlOne` 直接调用桩：断言 `rec.count +1`、`runtimeViolations +1`、`loadTimeViolations` 不变、返回值为 `g3Mock` sentinel（`__g3Mock===true` 且 `__g3Entry===name`），随后只清 runtime。SELF-CHECK-2 对**全部 49 个入口**逐个正控，`results.length === entries().length`，全部返回 sentinel，正控后 runtime 归零、loadTime 仍空。SELF-CHECK-7 对 R2 新增的 24 个入口（7 底层 + 17 `dns.promises.*`）逐一正控，额外断言 `__g3Entry===name`、count +1、loadTime 不变。SELF-CHECK-4 用独立 mock 的 `forwarded` 计数器证明桩**从未转发**到真实原始函数。

### 6.4 精确恢复

`restore()` 逆序恢复原始函数**身份**与原始**属性描述符**（writable/enumerable/configurable/get/set），不用 bind 副本。SELF-CHECK-3 用自定义 target 验证 `fetch`（data 属性）、`get`（writable:false/enumerable:true）、`accessor`（getter）三类描述符逐项 `deepEqual` 恢复，恢复后 `installed=false`。SELF-CHECK-7 追加 tls/dgram 风格独立 mock（`connect` writable:true/enumerable:false、`createSocket` writable:false/enumerable:true）的 install→restore 验证，原始身份与描述符逐项一致，主守卫全程未受污染。

---

## 7. 双断言 / 零写 / 四类白名单 / 敏感扫描证据

### 7.1 错误 code+status 双断言
`expectError(store, action, code, status)`（testkit `:487-500`）在 `assert.rejects` 内**同时** `assert.equal(err.code, code)` 与 `assert.equal(err.status, status)`，并断言 `err instanceof Error`、`status≠500`、`400≤status≤503`、消息无合成标识、无 stack 帧；外层再断言全库 `deepEqual` 与 `getViolations().runtime.length` 不变。全部失败行（P02–P13、S03–S16、R02–R09、K01–K02/K05/K08/K10–K16、T02/T04/T05、C02/C04/C05/C06/C08、N01–N08）均经此函数。O08 另以内联 `CODE_STATUS` 表对 12 个既有码逐一校验「码→status」冻结映射与固定消息（12 子场景 pass）。

### 7.2 零写内容级证据
`assertZeroWrite(store, before)` 用 `structuredClone(store.data)` 前后 deepEqual（非引用比较）；`expectError` 内置同一手法。覆盖 K04/K07/K09(重放)/K12–K16、C02(败者)/C04/C07/C08、O08/O09、O11 及全部 N 系列。

### 7.3 四类白名单（依设计 §4.9）

| 载体 | 语义字段数 | 断言位置 | 实测 |
|---|---:|---|---|
| 公开回执 | 精确 5 键 `jobId/state/revision/attempts/nextAttemptAt` | `assertReceiptShape`（testkit `:507-515`）、O01、K03 | pass |
| operation log | 精确 15 语义字段（`LOG_FIELDS`，含 `orgId/actorId/leaseGeneration`，`errorKind/reasonCode/alertCode=null`） | `assertSuccessWriteSet`（`:551`）、O13（`LOG_FIELDS.length===15`） | pass |
| op key | 精确 6 语义字段 `orgId/realm/keyVersion/requestDigest/result/createdAt`，`result` 精确 5 字段 | K03（`:92-93`）、`assertSuccessWriteSet`（`:563`） | pass |
| admin_audit | 完整 7 键 = **6 语义**（`action/actorId/actorType/createdAt/orgId/target`）+ Store 注入 `_id`（设计 §4.9.3） | O13（`:677-679` 断言 6 语义键）、`assertSuccessWriteSet`（`:571-580`） | pass |

`_id/updatedAt` 作为 Store 元数据由 `semanticKeys()` 过滤；嵌套回执禁止携带二者（含值为 `undefined` 的键由实现侧 `Object.hasOwn` 拦截，K12 12 变体覆盖多/少字段）。

### 7.4 敏感字段扫描
O03–O06 扫成功响应 JSON（lease/digest/op key/原始 key、result/errorKind/message/stack、org/actor/凭证/设备/人员/文件字段、auditId/logId/时间戳）；O12 对响应/log/audit/op key 四类载体扫原始 key、合成手机号 `13800138000`、证件号 `110101199001010011`、序列号 `SN-G3-SYNTHETIC-0001`、`private/g3/object-key` 及 PII 字段名，`requestDigest` 仅允许出现在 op key；O13 扫 log/audit 无 key/digest/message/stack；`assertSafeError` 对错误消息扫合成标识与 stack 帧。全部 pass。

---

## 8. 可证伪（反向补丁）证据

- **G2 已有反向补丁验证（可引用，来自 `docs/tasks/HK-AI-07D-G2-STRICT-RETRY-EVIDENCE-2026-11-16.md`）**：
  - 第 144 行：临时反向补丁禁用 P1-1 检查后 `REG-P1-1` 精确失败（117/118，fail 1），还原后逐字节一致。
  - 第 161 行：临时反向补丁同时禁用两处修复后正好 8 个新断言失败（119 pass / 8 fail），既有 118 条不受影响，还原后逐字节一致，`git diff --check` 通过。
  - 第 174 行：临时反向补丁令 `assertAuditTarget` 仅接受 3 条形态（删 `withDomain` 分支）后，恰好新增的 1 条五条 target 正例失败（129 pass / 1 fail），还原后逐字节一致。
- **G3 独立反向补丁（本次实测，已恢复原状、零残留）**：对 `admin-web/tests/face-g3-testkit.mjs` 的 `makeStub` 做临时反向补丁——将 `return rec.mock();` 改为 `return rec.original();`（令拦截桩转发到真实原始函数，模拟"探针失效/假阴性"）。在执行目录 `.tmp-g3-matrix/admin-web` 运行 `node --test tests/face-g3-testkit.mjs`：结果 **SELF-CHECK-2 与 SELF-CHECK-4 精确失败**（`# pass 2 / # fail 2`），失败点为"正控桩绝不转发到真实原始函数"与"正控必须返回 sentinel"。随后用事先备份的 `face-g3-testkit.mjs.bak` 精确恢复 `return rec.mock();`，复跑回到 **4/4 全绿**（`# pass 4 / # fail 0`）；恢复后 `grep -n "return rec.mock();"` 确认原语句在位。结论：G3 网络 guard 的正控探针**可证伪，非橡皮图章**——一旦桩转发真实网络函数，自检立即捕获；且工作树已恢复原状，无反向补丁残留。

---

## 9. 生产文件零差异

实际运行（本次实测）：

```
git -C .tmp-g3-matrix diff --name-status c8290db -- admin-web/lib admin-web/server.mjs admin-web/model.mjs
```

输出为**空白**（exit 0）→ 生产文件零差异。补充核对：

- `git diff --name-status c8290db -- admin-web/lib admin-web/server.mjs admin-web/model.mjs` 输出空白 → 生产文件在全部四个提交后仍零差异；`4f1b0d6`/`2c86b56`/`5ceb22a` 与本轮修订提交**只改测试文件与本文档**，未改 `h3a.mjs`/`collections.mjs`/`retry.mjs` 等任何生产文件。
- 谱系现状（v2）：`5ceb22a` 已推送远端并 `git ls-remote` 核对一致（首次交付）；本轮复审修订在 `5ceb22a` 之上**追加一个提交**（含 4 个测试文件 + 本文档），同版本树内提交，不 amend/rebase/reset/force。

> 端到端可证伪复核（v2 新增）：临时把生产 `collections.mjs:250` 的 `op:` 前缀改为 `opX:`，G3 跨四文件大量用例（SELF-CHECK-6、C01/C02/C03、K03/K09/K12–K16、P01、S01/S02、R01、T01/T03、N08）随即 FAIL；用备份精确恢复生产文件后回到全绿。证明 ID 类预期值确实来自测试侧独立 oracle，生产公式被篡改时 G3 能捕获。`git status` 确认生产文件零残留改动。

---

## 10. 非 HTTP 套件命令与结果

实际执行命令（工作目录 `.tmp-g3-matrix/admin-web`）：

```
node --test \
  tests/face-strict-retry.test.mjs \
  tests/face-g3-testkit.mjs \
  tests/face-g3-psrtn.test.mjs \
  tests/face-g3-ko.test.mjs \
  tests/face-g3-c.test.mjs
```

实测输出（TAP 汇总）：

```
# tests 326
# suites 0
# pass 326
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

按文件逐跑（R2 后，均 0 fail）：`face-strict-retry` 130、`face-g3-testkit` 7（SELF-CHECK-1..7，R2 增底层入口自检）、`face-g3-psrtn` 99、`face-g3-ko` 73、`face-g3-c` 17（含 C08-RERUN 子用例）；合计 326（含传递运行的 SELF-CHECK）。首版（5ceb22a）为 313 pass；v2 修订后为 322 pass；R2 补齐底层入口后为 326 pass（新增 1 条自检在 4 个 G3 文件各计一次，+4）。`git diff --check` 通过；生产文件零差异（§9）。

**声明**：本次仅运行上述显式列举的非 HTTP 单元/服务层测试套件，**未运行** `npm test` 全量（避免 glob 拉入 HTTP 套件）、**未启动 HTTP 服务**、**未监听任何端口**、**未发起任何业务网络请求**。网络 guard 已在被测模块加载前安装，49 个入口全覆盖，加载期与运行期网络违规均为 0（§6）。

---

## 11. 结论

- 矩阵 **90 个 ID**：**89 条 PASS + 1 条（O10）blocked**。不得宣称 90/90 全通过。
- 统一非 HTTP 套件 **326 pass / 0 fail**（首版 313、v2 322）；生产文件零差异；网络 guard 49 入口、加载期零违规、正控与精确恢复自检全过。
- 三项裁定（C05 只验 retry 侧、S09 只验 finalize、O10/O11 计入 G3 且不替代 G4）均按用户批准落实。
- **G3 未整体关闭**：O10 因 `routes.mjs:47-53` 的 E07 描述行未清理而 blocked，待独立 Q8 小提交清理后用同一用例复验（O10 用例已改为动态 gate，清理后自动转 PASS，见 §12）。
- 本次**不开始 G4**、**不合并任何分支**、**不开 HTTP/UI**、**不上线**、**不改任何生产文件**；如测试暴露服务缺陷，回退 G2 另立任务，不在 G3 修改契约或生产代码。

（本证据文档只新增本 Markdown 一份；所有实测数字来自测试源码与实际运行结果，不含估算。）

---

## 12. 独立复审退回修订取证（2026-11-18，v2）

复审对象：远端 `5ceb22a`（首版交付）。退回 1 P1 + 5 P2，全部在 G3 测试与证据范围内修订，生产代码零改动。逐项如下。

### 12.1 P1 — 成功路径网络违规可漏报（已关闭）
- 复审实测：成功路径注入一次被 guard 截获的 fetch，仍 96/96 通过。根因：成功用例不查 `getViolations().runtime`，仅失败路径 `expectError` 查。
- 修订：`assertSuccessWriteSet()` 进入取 `netBefore`、退出断言 runtime 无新增（testkit L581/L640）+ `assertNoNetworkViolation()`（L642）；新增导出 `assertNoNetworkViolation()`；psrtn/ko/c 的对未走该 helper 的成功用例（P11/N07/N08、K04–K16/O01–O13、C03/C06/C07/C09）在 retry 后显式调用。
- **可证伪（team-lead 独立复核）**：在 P01 成功断言前注入 `await globalThis.fetch("https://example.invalid")`，`node --test --test-name-pattern=P01` → P01 `not ok`，报"成功路径不得产生任何网络/Provider 调用"；恢复后 P01 全绿。

### 12.2 P2-2 — ESM 命名网络入口未同步拦截（已关闭）
- 根因：guard 用 `obj[key]=stub` 打桩 CJS 默认导出对象；被测代码若用 `import { request } from "node:http"` 拿 ESM 活绑定，指向原函数绕过桩。实测 Node v22.22.2：`http.request=stub` 后 `namedRequest===stub` 为 false，调用 `syncBuiltinESMExports()` 后为 true。
- 修订：testkit 顶层 `import { syncBuiltinESMExports } from "node:module"`；`install()` 打桩后（L137）与 `restore()` 恢复后（L202）各调用一次（均加 `if (!entriesOverride)` 防止独立 mock guard 产生全局副作用掩盖缺陷）；新增 SELF-CHECK-5 动态 `await import("node:http")` 验证命名导出同步。
- 可证伪：临时禁用 `install()` 的 `syncBuiltinESMExports()` → SELF-CHECK-5 FAIL；恢复后全绿。

### 12.3 P2-3 — ID 预期值复用生产 helper（已关闭）
- 复审实测：把生产 `operationKey` 的 `op:` 前缀改错，G3 仍 183/183 通过。根因：`opContextFor()` 与 `assertSuccessWriteSet()` 用生产 `operationKey`/`deterministicLogId`/`auditIdFor` 算预期 ID，循环认证。
- 修订：testkit 新增 B2 节测试侧独立 oracle（§独立重算，`createHmac`/`createHash`，segment 复刻生产 `encodeSegment` 的 base64url 语义）：`independentOpKey`/`independentOpFingerprint`/`independentLogId`/`independentAuditId`。`assertSuccessWriteSet()` L585/L606/L629 与 `find(OP_KEYS, opKey)` L619 全换 independent 版本；psrtn/ko/c 三文件断言生产写入的预期 ID 全换 independent 版本，并各自加独立交叉校验。
- **端到端可证伪（team-lead 独立复核）**：备份后临时把生产 `collections.mjs:250` 的 `op:` 改为 `opX:`，跨四文件大量用例 FAIL（SELF-CHECK-6、C01/C02/C03、K03/K09/K12–K16、P01、S01/S02、R01、T01/T03、N08）；精确恢复生产文件后 322/322 全绿，`git status` 确认生产零残留。

### 12.4 P2-4 — C08 未覆盖事务 callback 重跑（已关闭）
- 修订：新增 C08-RERUN 子用例（归属 C08，不增矩阵 ID）。测试侧桩包裹 `store.transact`，使 `retry` 的 build callback 在同一 state 两份克隆上各执行一次（模拟 `CloudStore.runTransaction` 重跑 callback），捕获两次写集比对后只提交第二次；校验两次写集 deepEqual（log/audit/op key 命中独立 oracle）、只一条 job/log/audit/opkey、卸载桩后同键二次真实 retry 零写重放、全库除合法写集零变化、零网络。
- 可证伪：临时把第二次写集 log ID 改为 `...:5-NONDET` → C08-RERUN FAIL（"callback 重跑两次必须产出逐字段相同的确定性写集"）；恢复后全绿。
- 覆盖局限：`StrictRetryService` 构造器仅允许 LocalStore，无法用真 `CloudStore.runTransaction`；采用测试侧桩模拟 build 双次调用，"只提交一次"由桩保证，追加"提交后同键二次真实 retry 零写重放"补强幂等证据。未改生产 `store.mjs`/`retry.mjs`。

### 12.5 P2-5 — O10 固定要求描述行存在、清理后反失败（已关闭；O10 仍 blocked）
- 根因：原 O10 硬编码断言 `record.results[2].ok === false`（routes.mjs 描述行必须仍在），Q8 清理后会假失败。
- 修订：ko 文件新增本文件内 `o10DynamicGate()`，blocked 由三子项实际结果动态推导（全 true→PASS 不登记 blocked；任一 false→BLOCKED 并登记），断言 `record.blocked === !results.every(r=>r.ok)`，不再硬编码③失败。三子项判定函数以 routesSource 注入便于内存证伪。
- **当前状态**：`routes.mjs:47-53` 描述行仍在 → ③=false → O10 判 **BLOCKED**（符合"O10 继续 blocked"），O10 用例本身 PASS（成功记录一个 blocked）。
- 可证伪：内存中把 routes 源码 `device-operation-job-retry` 替换为已清理形态喂给同一 gate → `cleaned.blocked === false`（自动转 PASS），证明 Q8 清理后同一用例不会假失败。全程未改生产 `routes.mjs`。

### 12.6 P2-6 — 证据文档未提交状态（本修订关闭）
- 首版证据文档 §1/§9/§10/§11 描述 `5ceb22a` 之前"三矩阵文件 untracked、未提交"的 313-pass 状态。本 v2 已更新：谱系表补入 `5ceb22a`（已推送并核对一致）与本轮修订提交；计数更新为 322 pass；§9 改为"已提交"口径；新增本节记录 6 项修订取证。

### 12.7 v2 统一验证
- 统一非 HTTP 套件 `node --test tests/face-strict-retry.test.mjs tests/face-g3-testkit.mjs tests/face-g3-psrtn.test.mjs tests/face-g3-ko.test.mjs tests/face-g3-c.test.mjs` → v2 为 **322 pass / 0 fail**；R2 补齐底层入口后复跑为 **326 pass / 0 fail**（§13）。
- 生产文件零差异；FALSIFY-TEMP/临时补丁零残留；`git diff --check` 通过。
- 三项独立可证伪（P1 注入 fetch、P2-3 改生产 op: 前缀、P2-5 内存清理 routes）均由 team-lead 独立复核通过；P2-2、P2-4 由实现 worker 反向补丁验证通过。
- 结论口径不变：90 ID 中 89 PASS + 1（O10）blocked，G3 整体未关闭；O10 待 Q8 独立清理后用同一用例复验；G4/合并/HTTP/UI/上线继续冻结。

---

## 13. G3 v2 独立复审 R2 剩余项 — 底层 guard 入口补齐（2026-11-18）

### 13.1 缺口（复审原话）
guard 仍未覆盖以下底层入口，ESM 同步不能代替这些入口的拦截：
- `net.Server.prototype.listen`
- `net.Socket.prototype.connect`
- `tls.connect`
- UDP（dgram）相关入口
- `dns.promises` 相关入口

### 13.2 补齐内容（仅 `face-g3-testkit.mjs`）
- 顶层新增 Node 内建静态 import：`node:tls`、`node:dgram`（被测模块仍全部走 top-level `await import()`）。
- `resolveEntries()` 追加 7 个底层入口：`net.Server.prototype.listen`、`net.Socket.prototype.connect`、`tls.connect`、`dgram.createSocket`、`dgram.Socket.prototype.send`、`dgram.Socket.prototype.bind`、`dgram.Socket.prototype.connect`。
- `dns.promises` 按正则 `/^(lookup|lookupService|resolve|reverse)/` 枚举 17 个 promise 风格入口（mock 返回 `Promise.resolve(g3Mock(...))` 供正控 `await`）；未包裹 `Resolver`/`getServers`/`setServers`/`getDefaultResultOrder`/`setDefaultResultOrder`。
- 入口总数由 25 增至 **49**（11 + 14 + 7 + 17）。`makeStub`「绝不转发 original」、active WeakMap 防嵌套、正控、`restore()` 精确恢复、`syncBuiltinESMExports()` 五处机制**未改动**。

### 13.3 可配置性与 ESM 同步实测（Node v22.22.2-6）
- 7 个新底层入口均 `hasOwn=true`、`configurable=true`、`writable=true`、`typeof=function`，可安全打桩。
- `dns.promises` 正则命中 17 个函数键，与 §6.1 清单一致。
- `tls.connect = stub` / `dgram.createSocket = stub` 后，命名导出 `import { connect } from "node:tls"` 与 `import { createSocket } from "node:dgram"` 在 `syncBuiltinESMExports()` 前 `=== stub` 为 false、之后为 true；testkit 的 `install()` 已在打桩后调用同步，SELF-CHECK-7 实测两者 `=== rec.stub`。

### 13.4 SELF-CHECK-7（新增第 7 条自检）
1. `networkGuard.entries()` 包含全部 7 个底层入口与 17 个 `dns.promises.*` 入口；
2. 对每个新增入口跑 `positiveControlOne(name)`，断言 `__g3Mock===true`、`__g3Entry===name`、count +1、runtime +1 后归零、loadTime 不变；
3. `await import("node:tls").connect` 与 `await import("node:dgram").createSocket` 均 `===` 对应 `rec.stub`，并调用命名入口确认返回 sentinel、记 1 次 runtime 违规；
4. 参照 SELF-CHECK-3 的独立 mock 思路，对自定义 target 上的 tls/dgram 风格函数做 install→restore，断言原始身份与属性描述符（`writable`/`enumerable`/`configurable`/`value`）逐项一致，主守卫零污染。

### 13.5 实测计数
- testkit 单文件：`# tests 7 / # pass 7 / # fail 0`；`guardEntryNames().length = 49`。
- 统一五文件套件：`# tests 326 / # pass 326 / # fail 0`（首版 313、v2 322 保持不变；新增 1 条自检在 4 个 G3 文件各计一次）。
- `git diff --check` 通过；生产代码零改动；未 commit / 未 push（由 team-lead 统一提交）。

### 13.6 可证伪实测结果（独立验收员 g2-review-repro，fresh eyes）
两项反向补丁均先备份到工作树外、真跑、再逐字节 `cmp` 精确还原，复跑回全绿：
- **可证伪 A（桩转发检测）**：临时把 `makeStub` 的 `return rec.mock();` 改为 `return rec.original();`。
  testkit 单文件由 7/7 变为 **`# tests 7 / # pass 3 / # fail 4 / exit 1`**，失败用例为
  **SELF-CHECK-2、SELF-CHECK-4、SELF-CHECK-5、SELF-CHECK-7**（均为依赖 sentinel 的断言；
  首个错误原文 `net.createServer: 桩返回值必须是安全 sentinel（证明未转发真实原始函数）`）。
  这证明桩确实阻断真实网络函数、哨兵断言非橡皮图章。恢复后 `grep -n "return rec.mock();"`
  原语句在第 119 行在位，`cmp` IDENTICAL，复跑 7/7。
- **可证伪 B（新入口可移除检测）**：临时从 `resolveEntries()` 删除 `tls.connect` 条目。
  testkit 单文件由 7/7 变为 **`# tests 7 / # pass 5 / # fail 2 / exit 1`**，失败用例恰为
  **SELF-CHECK-1、SELF-CHECK-7**，错误原文 `缺少必需拦截入口：tls.connect`。
  恢复后 `grep -n 'name: "tls.connect"'` 原条目在第 81 行在位，`cmp` IDENTICAL，复跑 7/7。
- **ESM 同步独立复现**：`tlsNs.connect === recTls.stub`、`dgramNs.createSocket === recDgram.stub`
  均为 true（`=== original` 为 false）；直接调用命名入口返回 `__g3Entry` 匹配的 sentinel 并记
  1 次 runtime 违规。单列脚本证明命名导出在 `syncBuiltinESMExports()` 前不跟随 CJS 改动、同步后指向桩。
- **可配置性真相**：49 入口 = 11 基础 + 14 `dns.resolve*` + 7 底层 + 17 `dns.promises.*`，无重复，
  未包裹 `Resolver`/`getServers`/`setServers`/`getDefaultResultOrder`/`setDefaultResultOrder`。
- **干净性**：生产代码与其余四个测试文件对 `fd1ab69` 零差异，`git diff --check` 通过，无
  FALSIFY/TEMP/`rec.original();` 残留，`git status --short` 仍只有 testkit 与证据文档两文件 M。
- **结论**：V1–V6 全部 PASS，建议追加提交。HEAD 终态仍 `fd1ab69`，由 team-lead 统一提交。

> 口径不变：90 ID 中 89 PASS + 1（O10）blocked，G3 整体未关闭；O10 待 Q8 独立清理后复验；G4 / 合并 / HTTP / UI / 上线继续冻结。
