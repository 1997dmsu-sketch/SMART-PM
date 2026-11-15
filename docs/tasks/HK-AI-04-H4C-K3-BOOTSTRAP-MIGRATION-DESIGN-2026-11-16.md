# HK-AI-04 H4-c K3 首次初始化与受控迁移设计

- 日期：2026-11-16（Asia/Shanghai）；优先级：P0。
- 状态：设计冻结建议，供后续实施卡与独立复审；本提交不授权生产执行或发布。
- 分支：`docs/hk-face-k3-bootstrap-migration-design`。
- 文档基线：`282a20fca9f64ab80ead50372c9c3e90bf4aeba7`（`work`，开始时工作区干净）。
- 本轮仅新增本文；未修改生产代码、HTTP、Provider、设备或真实密钥，未执行初始化、迁移或恢复。

## 1. 输入核对与适用顺序

已执行 `git fetch origin`。仓库 fetch refspec 仅含 main，随后显式 fetch 下列四条分支，核对提交对象及远端分支头：

| 输入 | 远端分支 | 完整 SHA | 核对结果 |
|---|---|---|---|
| H4-c 设计 | docs/hk-face-h4c-reconciliation-design | b15acebe0a8049f316797bbbd2692c55de25d111 | 设计 §5 K3、链验证与失败关闭基线 |
| 批准/任务卡 | docs/lock-01-fast-track | ed7b66f84c79339246a81ea76762cc388d7f4778 | 批准 Q1–Q9；实施按 C1/C2/C3 分段复审 |
| C1 最新 | feat/hk-face-h4c-reconciliation | 5dff386fe5c9648b04d1623d3e1898c59332639e | 移除全部生产初始化 helper；固定 global head，只读 guard |
| REL-AI-02 | docs/hk-face-release-runbook | db06f8ab90679b9d9f2384b98d28255dd0681431 | Runbook 为待复审草案；生产工具、备份/恢复仍待实现 |

可复查输入（固定提交链接，不要求本分支复制前置文档）：

- [H4-c 设计](https://github.com/1997dmsu-sketch/SMART-PM/blob/b15acebe0a8049f316797bbbd2692c55de25d111/docs/tasks/HK-AI-04-H4C-RECONCILIATION-DESIGN.md)
- [批准](https://github.com/1997dmsu-sketch/SMART-PM/blob/ed7b66f84c79339246a81ea76762cc388d7f4778/docs/tasks/HK-AI-04-H4C-DESIGN-APPROVAL-B15ACEB-2026-11-14.md)、[实施任务卡](https://github.com/1997dmsu-sketch/SMART-PM/blob/ed7b66f84c79339246a81ea76762cc388d7f4778/docs/tasks/HK-AI-04-H4C-IMPLEMENTATION-TASK-2026-11-14.md)
- [C1 证据包](https://github.com/1997dmsu-sketch/SMART-PM/blob/5dff386fe5c9648b04d1623d3e1898c59332639e/docs/tasks/HK-AI-04-H4C-C1-REVIEW-EVIDENCE-2026-11-14.md)、[C1 契约](https://github.com/1997dmsu-sketch/SMART-PM/blob/5dff386fe5c9648b04d1623d3e1898c59332639e/admin-web/lib/face-service/h4c-evidence.mjs)
- [REL-AI-02 Runbook](https://github.com/1997dmsu-sketch/SMART-PM/blob/db06f8ab90679b9d9f2384b98d28255dd0681431/docs/tasks/REL-AI-02-HK-FACE-RELEASE-RUNBOOK.md)

冲突处理：原设计 §5.3 按 realm 建 head、双缺自动创建的旧文字不再适用；采用 C1 的固定 global head 与永不初始化合同。Runbook §4.2 的“受控修复”在 K3 上只能指本设计的可信备份恢复，不能重新生成锚点。原批准的 Q1–Q9 不重编号；本文 Q1–Q8 是 K3 专项裁定建议。

## 2. 不变量与信任边界

1. 初始化只能由单独打包、单独授权的受控 CLI/migration 执行。不得提供 HTTP、管理后台、服务启动 hook、业务 helper、动态 import 入口或 `mode: initialize` 开关；运行时身份无 domain/marker 写权限。
2. 运行时在空库、单缺、双缺、损坏、换钥时均只读失败关闭；不得 catch 后补写。CLI 不进入 face-service 公共 index 或应用制品依赖图。
3. 固定 head ID：`evidence-digest-domain:v1:global`，无 orgId，不含 realm/version。版本 ID：`evidence-digest-domain-version:<base64url(UTF-8 realm)>:<keyVersion>`。禁止并行第二 head/realm。
4. 只允许在维护窗口、全局停写、存储侧 fencing 生效后首次初始化。仅进程 mutex、HTTP 维护页、调用者空数组 proof、事务外 count=0 均不构成安全保证。
5. 全局三集合为 `evidence_digest_domains`、`device_operation_evidence`、`device_operation_evidence_heads`，检查覆盖全部组织、全部分页、异常 ID 和历史记录。任何一条存量都禁止首次初始化。
6. 同版本换钥永久禁止；更高版本也不允许通过 bootstrap 绕过。realm 迁移另立任务。不得删除 domain、marker、证据再冒充空库。
7. 锚点缺失时仅可信备份恢复；无法证实首次部署的“看似空库”也按灾难恢复处理。空库本身不能证明从未初始化。

## 3. 存储与 bootstrap marker 合同

### 3.1 domain 精确 schema

保持 C1 精确 validator，无新字段：

| 记录 | 精确字段 | 首次取值 |
|---|---|---|
| head | `_id, kind, realm, keyVersion, keyFingerprint, revision, createdAt` | 固定 ID、kind=head、revision=1 |
| version | `_id, kind, realm, keyVersion, keyFingerprint, enabledAt` | 固定算法生成 ID、kind=version |

realm、version、fingerprint 两记录完全一致；`createdAt=enabledAt` 为事务绑定时间。K3 配置沿用 `H4_EVIDENCE_HMAC_KEY_B64`（规范 Base64、32 字节）、`H4_EVIDENCE_KEY_VERSION`（十进制正整数字符串）、`H4_EVIDENCE_REALM`（3–64 规范字符）。独立于 K1/K2，缺失不得回退。fingerprint 严格使用 C1 的 HMAC-SHA256 与 canonical JSON 数组 `["KEYED_DIGEST/h4-evidence-fingerprint","v1",realm,version]`；不另创算法。

### 3.2 marker 提案

新增迁移专属全局集合提案 `evidence_digest_bootstrap_markers`；固定 `_id=evidence-digest-bootstrap:v1:global`。不增加 C1 domain 字段，不要求业务运行时创建或维护 marker。集合登记、云权限与备份接线须后续实施，本文不声称已存在。

marker 精确字段建议：`_id, schemaVersion, deploymentId, migrationId, headId, versionId, realm, keyVersion, keyFingerprint, fenceToken, manifestDigest, artifactSha, changeId, operatorRef, reviewerRef, committedAt`。

- `schemaVersion=1`；deploymentId 绑定可信云账号/环境/数据库身份，不能只用调用者自由字符串；operator/reviewer 为受限内部引用，不能相同。
- `migrationId` 为一次操作的唯一 ID；manifestDigest 绑定经过批准的预检清单、空集合结果、目标身份、制品及配置元数据，不含秘密。
- marker 与 head/version **同一原子事务 create-only**，全部不存在才允许提交；任一冲突整笔失败。marker 不可 update/delete，失败尝试写外部审计，不写“pending marker”。
- marker 的存在永久消耗 bootstrap 资格。marker 丢失也不能恢复资格；外部部署台账保存已签验的初始化收据和备份索引，覆盖数据库整体丢失场景。
- marker 不是独立的真实性证明：必须与外部受控台账、目标身份、备份链交叉核对。台账不可用/不一致即停止。

## 4. 维护窗口、停写与 fencing

维护负责人批准变更单并冻结目标部署身份、制品 SHA、迁移清单、时间窗口、双人职责与撤销条件。先完成隔离恢复演练和可用备份，再执行：

1. 阻断全部业务写入口，包括后台 worker、定时任务、CLI、旧应用实例、直连数据库身份和所有组织；等待在途事务排空，核验写审计无残留。仅关 HTTP 不足以停写。
2. 存储侧切换到维护写策略：仅当前迁移身份可执行限定事务；旧业务凭据撤权/失效。该策略必须拒绝旧客户端提交，不能依赖旧应用自觉检查锁。
3. 获取数据库权威、全局独占的 fencing lock，锁键绑定 deploymentId，token 为服务端单调递增 epoch；记录 owner、leaseUntil、revision。续租和接管必须 CAS，token 永不复用。
4. 每个迁移写事务都必须原子读取并核验锁的 owner/token/租约及维护策略世代，提交时 token 已过期或被接管必须拒绝。旧持有者迟到提交必须被数据库强制拒绝。
5. 在这一稳定窗口用 CloudStore/底层权威数据库做全局完整枚举，读完分页并确认结束；限额、超时、权限不全、未知集合状态、读取失败均失败关闭。LocalStore、副本、缓存或调用者 proof 不可替代生产权威读取。

C1 Store 的点 refs 事务不能原子证明三个集合全局为空。空检查成立的前提是存储侧排除了所有并发写入，而不是把外部扫描包装成 proof。如果数据库/IAM 无法提供上述排他写策略、提交时 fencing 或多记录原子 create-only，结论为 NO-GO；实施卡须先补足基础设施能力，不降级为普通 Store helper。锁、marker、审计的实际事务支持必须通过真实后端的隔离测试证明。

## 5. 首次初始化流程与确认丢失

以下是后续 CLI 的行为合同，不是现有可执行命令。

| 阶段 | 必须完成 | 可写范围 |
|---|---|---|
| dry-run | 只读检查目标身份、外部首次部署台账、权限、三集合、marker、配置、备份及能力；生成待批准 manifest | 数据库零写；受控外部报告 |
| prepare | 进入维护窗口、停写排空、获得 fencing，复查批准清单未变化 | 锁/维护控制面与外部审计 |
| preflight | 在有效 fencing 下重新完整枚举；三集合及 marker 均空；台账证明从未初始化 | 零 domain/evidence 写 |
| commit | 原子检查锁/策略世代及 marker/head/version 不存在；同事务 create-only 三条记录 | 仅 marker + head + version；锁续租另行受控 |
| verify | 权威回读三条，精确 schema、字段绑定、配置 fingerprint、C1 只读 guard；记录事务 ID 和外部收据 | 外部审计；不补写业务数据 |
| release | 将收据纳入可信备份并验证；双人复核后撤迁移凭据，恢复业务写策略，再释放维护锁 | 控制面；保持运行时 domain/marker 不可写 |

dry-run 结果不能直接作为 apply 的空库 proof。apply 必须重新扫描；清单、配置、制品或目标变化须重新审批。锁租约不足以覆盖提交时先续租并重验；失锁立即停止。

提交超时/确认丢失时不盲重试创建：保持停写，重新获取有效 fencing 后回读。三条完整、同 migrationId/manifest/deployment/config 且外部事务证据可核验，判为已提交，仅继续 verify；这是只读确认，不是再次初始化。三条全缺且后端确认原事务已终止未提交，才允许同批准操作重试。部分存在、不同操作占用、未知提交状态均停止并进入事故核查。完整且相同的重复执行只返回 ALREADY_APPLIED，不覆盖时间戳或 revision。

## 6. 受控迁移、回滚与灾难恢复

### 6.1 分类

| 场景 | 裁定 |
|---|---|
| 真正首次部署，无历史，无 marker，三集合空 | 仅按 §4–5 bootstrap |
| 已有完整匹配锚点 | 只读核验；不得重新初始化 |
| 已有证据/证据 head，但 domain 缺失或旧格式 | 冻结写入；可信备份恢复或另发专项迁移卡，不自动补齐 |
| 同 realm、同 keyVersion、不同密钥 | 禁止，包括直接改 fingerprint、删 marker 后重建 |
| 同 realm、升 keyVersion | 另立轮换实施卡；本设计不授权执行，C1 当前仍 DOMAIN_MISMATCH |
| realm 变化 | 另立 realm 迁移任务，禁止第二 head 命名空间 |
| head/version/marker 单缺、双缺、全库丢失 | 灾难恢复；禁止重新 bootstrap |

后续版本轮换卡必须先解决历史 evidence 的验证能力、密钥托管、链尾追加兼容性、唯一固定 head 的 CAS 切换、版本记录 create-only、全局停写、fencing、备份和回退矩阵。C1 只接受当前 K3，不能因保存了历史 version 就声称支持历史密钥验证；存在旧链时不得直接切新配置上线。不得重签、覆盖或删除旧 evidence 来适配新钥。

### 6.2 回滚界线

提交前失败可终止操作、撤销临时身份，在确认无在途事务后退出维护；保留失败审计。三条原子提交后不可通过删除 domain/marker“回滚为空”。回读失败或配置错误保持停写；先判断是否能恢复原配置并只读核验，无法核验则进入恢复流程。应用回滚不得启动有自动初始化能力的旧制品。恢复写入前，必须证明所选应用仍执行只读 domain guard。

### 6.3 可信备份恢复

可信备份须具备受控来源、不可变清单/完整性签验、明确一致性时间点、部署身份绑定、外部初始化收据、三集合与 marker 的一致副本，以及独立受限托管的原 K3 密钥版本。只备份 head/version 或仅复制 fingerprint 不足以恢复证据真实性。

恢复先隔离演练，再在全局停写和 fencing 下按独立恢复变更单执行。核对 marker/domain/schema、完整 evidence 链、HMAC、head/sequence、关联 job/grant 与审计的一致性；新于备份的证据不得被旧快照静默覆盖，须盘点增量并给出可验证恢复方案，否则保持 NO-GO。不得接受操作者现场拼装记录、当前环境变量、空集合 proof、截图或不明来源导出作为信任锚。无可信备份/原密钥时保持失败关闭并上报不可恢复事实；不生成新钥冒充恢复。

## 7. 错误矩阵

下列 `K3M_*` 为迁移 CLI 拟议分类，不加入生产模块，也不新增 HTTP 映射。CLI 建议 exit：0=成功/已完成，2=输入配置，3=安全前提不足，4=状态冲突，5=提交不确定/核验或恢复阻断。失败尝试可写受控外部审计；“零写”指 domain/marker/evidence/业务数据零变更，锁操作单独记账。

| 条件 | CLI 分类 / exit | 运行时既有结果（适用时） | 处置 |
|---|---|---|---|
| K3 缺失、编码/版本非法，或 K1/K2 代用 | K3M_CONFIG_INVALID / 2 | NOT_CONFIGURED / 503 | 零写，修正配置后重新预检 |
| 目标身份、制品、manifest 不一致 | K3M_TARGET_MISMATCH / 3 | — | 零写，不猜目标 |
| 无窗口、停写未排空、权限/fencing 能力不足 | K3M_MAINTENANCE_REQUIRED / 3 | — | 零写，NO-GO |
| 锁忙、过期、token 旧或提交前被接管 | K3M_FENCE_REJECTED / 3 | — | 事务回滚；旧持有者不得继续 |
| 扫描分页不完整、权限/限额/超时 | K3M_SCAN_INCOMPLETE / 3 | — | 零写，不把未知当空 |
| 任一三集合非空或首次部署台账不可信 | K3M_BOOTSTRAP_FORBIDDEN / 4 | 缺锚时 DOMAIN_INCOMPLETE / 409 | 禁止初始化，分类迁移/恢复 |
| marker 存在且三条完全匹配本次操作 | ALREADY_APPLIED / 0 | 匹配 guard 返回空写集 | 仅回读确认，不写记录 |
| marker 存在但操作不同，或任一记录部分缺失/损坏 | K3M_STATE_CONFLICT / 4 | DOMAIN_INCOMPLETE / 409（domain 损坏时） | 不覆盖，事故核查/恢复 |
| domain 双缺，即使库看似空 | 须验证首次部署，否则 BOOTSTRAP_FORBIDDEN / 4 | DOMAIN_INCOMPLETE / 409 | 运行时永不初始化 |
| realm/version/同版本 fingerprint 与固定 head 不同 | K3M_DOMAIN_MISMATCH / 4 | DOMAIN_MISMATCH / 409 | 禁止换钥；分类另立卡 |
| create-only 冲突，包括并发抢占 | K3M_CREATE_CONFLICT / 4 | — | 整事务零写，回读分类 |
| 提交确认丢失/超时 | K3M_COMMIT_UNKNOWN / 5 | — | 可能已原子提交三条；按 §5 对账，禁盲写 |
| 提交后回读不符、审计收据/备份不能核验 | K3M_VERIFY_BLOCKED / 5 | 运行时仍按 domain 合同判定 | 保持停写，不删记录 |
| 无可信备份或原 K3 | K3M_RECOVERY_BLOCKED / 5 | 缺/坏锚失败关闭 | 不重建，不恢复业务写 |

C1 的判定顺序保留：固定 head 缺/坏为 DOMAIN_INCOMPLETE；head 完整但与当前配置不同先 DOMAIN_MISMATCH；head 匹配后 version 缺/坏或内部绑定矛盾为 DOMAIN_INCOMPLETE。marker 异常由部署门禁阻断，不谎称 C1 已读取 marker。

## 8. 测试矩阵与实施验收

以下均为后续实施必测项，本文未执行这些运行测试；合成 fixture 不得调用生产初始化 helper。每个拒绝用例比较三集合、marker 及全库业务数据的内容级前后快照；审计/锁变化单独断言。涉及后端提交、权限、fencing 的项目不能只用 fake CloudStore 证明。

| 编号 | 场景 | 必须断言 |
|---|---|---|
| K3B01 | 合成空库 dry-run | 全库零写，清单绑定目标/制品/配置，无秘密 |
| K3B02 | 可信首次部署成功 | 恰好原子创建三条；精确 schema、固定 head、fingerprint、时间绑定；guard 只读通过 |
| K3B03 | 缺配置、非法编码/version、K1/K2 代用 | 配置错误、零写 |
| K3B04 | 三集合逐一有记录，含其他组织/异常 ID/最后一页 | 全部拒绝，不能用 org 过滤绕过 |
| K3B05 | 分页失败、达到 list 限额、权限缺失 | SCAN_INCOMPLETE，不以已读部分推断为空 |
| K3B06 | 全库空但台账显示已初始化；台账不可用 | 禁止 bootstrap，走恢复 |
| K3B07 | marker-only/head-only/version-only/各种两条组合及 schema 损坏 | 不补写、不覆盖，内容级不变 |
| K3B08 | 同 manifest 重跑；不同 migrationId 抢占 | 前者只读确认，后者冲突；revision/时间不变 |
| K3B09 | 两迁移进程并发，create-only 竞争 | 至多一笔三条提交；绝无部分记录/第二 head |
| K3B10 | 扫描后并发业务写、旧实例/worker/直连身份写 | 存储策略拒绝；若不能拒绝则禁止初始化 |
| K3B11 | lease 过期、续租失败、接管、旧 token 迟到提交 | 数据库提交拒绝旧持有者；新 token 单调增加 |
| K3B12 | 扫描后失锁/配置或目标变化 | 提交拒绝或重新审批，零 domain 写 |
| K3B13 | 提交前崩溃、事务中故障、提交后确认丢失 | 全无或完整三条；按 §5 只读分类，未知态不盲重试 |
| K3B14 | 提交后回读失败、外部收据或备份失败 | 保持停写，不删 marker/domain |
| K3B15 | 多组织、第二 realm version 已存在、同版本换钥、升版本 | global head 唯一；bootstrap 拒绝存量；runtime 配置变化 MISMATCH |
| K3B16 | 运行时空库/单缺/双缺/损坏/有证据失锚 | C1 失败关闭且零写，公共 index/生产树无初始化能力 |
| K3B17 | HTTP/后台/启动参数尝试初始化；运行时身份直接写 domain/marker | 无入口，存储拒绝；CLI 不随业务制品发布 |
| K3B18 | 可信备份隔离恢复，篡改/错误部署/缺密钥/增量证据 | 正例全链 HMAC/引用一致；反例阻断，不覆盖新证据 |
| K3B19 | 应用/配置回滚 | 不回退到自动初始化；保持 marker 与不可变历史 |
| K3B20 | 敏感扫描与副作用 | 无密钥/原始 payload/PII/stack；Provider、设备、HTTP 注册均为 0 |

实施验收须提交逐项证据、命令/exit/计数、后端事务及 IAM 证明、故障注入结果、全局停写/锁接管演练和恢复演练。延续 C1 定向、Admin/根回归及生产初始化旁路静态检查。未通过独立复审不得推进生产；Runbook 仍需单独更新并批准，H4-c 合入与发布门槛不因本文降低。

## 9. K3 专项 Q1–Q8 裁定建议

| 问题 | 裁定建议 | 理由/落点 |
|---|---|---|
| Q1 谁可以首次初始化，能否 HTTP？ | 仅独立受控 CLI/migration，双人变更；禁止 HTTP 和业务运行时 | §2、§5；维持 C1 无初始化能力 |
| Q2 如何证明三集合全局空？ | 维护窗口 + 全局停写排空 + 存储策略 + fencing 下权威完整扫描 | §4；拒绝调用者 proof、普通点 refs 冒充全局原子证明 |
| Q3 marker 必须吗，存在哪里？ | 必须；专属全局集合固定 ID，与两条锚点原子 create-only，外部台账防全库丢失后重建 | §3；marker 不进入 domain 精确 schema |
| Q4 head/version 如何创建及重跑？ | 固定 global head + 版本 ID + marker 三条原子 create-only；重跑仅匹配后只读确认 | §3、§5；任何部分状态禁止补写 |
| Q5 同版本换钥、升版本如何处理？ | 同版本换钥禁止；升版本另立轮换卡，先解决旧链验证与兼容性 | §6.1；本卡无自动轮换/历史 key fallback |
| Q6 realm 能否新建平行命名空间？ | 不允许；realm 迁移另立任务，固定 global head 不变 | §2、§6；不能靠换 realm 绕过锚点 |
| Q7 锚点丢失或误初始化如何回滚？ | 提交后不得删锚重来；仅可信备份恢复，缺备份/密钥失败关闭 | §6.2–6.3；保护新增证据，禁止旧快照静默覆盖 |
| Q8 当前是否可以实施/上线？ | 仅交付文档设计；后续工具、存储权限/fencing、测试、Runbook 更新及独立批准完成后另行授权执行 | §8；本文不使 C1 或门禁系统生产就绪 |

## 10. 本次文档交付校验

本提交以 main 基线新建文档分支，不合并四条输入分支；指定输入通过固定提交读取，避免混入生产代码。校验项为输入 SHA 核对、仅新增本文件、Markdown 本地链接检查、关键冻结项/矩阵完整性和 `git diff --check`。由于仅文档变更，不运行应用测试，不访问 Cloud/live、Provider 或设备。提交 SHA、普通推送及远端一致性由交付回报给出，避免在提交中记录自身 SHA。
