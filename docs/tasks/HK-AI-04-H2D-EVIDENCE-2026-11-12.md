# HK-AI-04 H2-d 全链回归与并发验收证据

日期：2026-11-12（Asia/Shanghai）

状态：**H2-d 定向测试与证据完成，提交 Codex 复审；H2-d 未关闭，H2 未整体关闭，H3/H4 未开始。**

## 1. 分支、基线与提交

| 项目 | 内容 |
|---|---|
| 工作分支 | `test/hk-face-service-h2d-acceptance` |
| 验收基线 | `feaa1e04e6ca5d64e4028301fb02a9b6b5227e68`（H2-c C4 批准基线） |
| 前序批准基线 | H2-a `f9a2b6b`；H2-b `2bc10e3`；H2-c C3 `32c891f`；C4 定点修复 `34580ab` |
| 本轮测试/证据脚本提交 | `cc844c559fcba2ea4cc2c893e0e47fb15b8eb826` |
| 本文档提交 | 当前分支 HEAD（docs 提交） |
| 生产代码改动 | **无**。本分支只新增 H2-d 测试、fixture 与证据脚本/文档 |
| 既有本地改动保护 | 未触碰未跟踪目录 `电动车充电棚配电方案/` |

本轮未合并 `main`、未改写历史、未 cherry-pick 重复提交、未连接生产云或设备。

## 2. 历史与批准范围核对

### 2.1 代码历史

- `f9a2b6b..feaa1e0` 共 21 个线性提交，无 merge commit，无重复提交主题。
- `f9a2b6b` 后第一个提交 `9852c7f` 是**仅测试**的确定性解码超时修复（`admin-web/tests/face-biometric.test.mjs` 单文件，`timeoutMs: 1 → 0`），与任务描述的“确定性解码超时修复”一致；未改生产代码。
- 生产差异仅 7 个文件，均位于已批准的 H2-b/H2-c 范围：

| 文件 | 所属阶段 |
|---|---|
| `admin-web/lib/face-service/collections.mjs` | H2-b schema/claim/K1/K2 |
| `admin-web/lib/face-service/service.mjs` | H2-b/H2-c createGrant 接线与 C4 D75 定点修复 |
| `admin-web/lib/blacklist.mjs` | H2-c C2 prepareAttempt / C3 优先级 |
| `admin-web/lib/face-service/eligibility.mjs` | H2-c C1 共享资格 helper |
| `admin-web/lib/face-service/qualification.mjs` | H2-c C3 资格预读 |
| `admin-web/lib/occupancies.mjs` | H2-c C1 共享原语 |
| `admin-web/lib/store.mjs` | H2-c C3 `(orgId,_id)` 点查 |

- 未修改 `admin-web/server.mjs`、HTTP 路由/权限注册、`cloudfunctions/`、`admin-web/public/`、小程序或生产云配置。
- 复核结论：**未发现缺失代码提交、重复 cherry-pick 或批准外生产差异。**

### 2.2 批准文档可用性说明

H2 复审、H2-a 终审、H2-b 终审与 H2-c C3 终审文档已在工作区相邻文档目录中找到并核对。任务卡指定的 `HK-AI-04-H2C-C4-FINAL-APPROVAL-FEAA1E0-2026-11-11.md` 未随本仓库或当前工作区提供；本轮以任务卡明确指定的 `feaa1e0` 作为 C4 批准基线，未据此改写任何历史或生产代码。请 Codex 复审时确认该批准文档来源；本项是证据可获取性限制，不是代码历史缺失。

## 3. H1 原 8 项独立覆盖

新增文件 `admin-web/tests/face-h2d-acceptance.test.mjs`，不依赖 C4 场景矩阵，不删除或替换既有测试。

| # | 任务要求 | H2-d 独立测试 | 结果 |
|---|---|---|---|
| 1 | submit 最小凭证、私密文件绑定 | `H2D H1-1 submit 最小凭证与私密文件绑定` | PASS |
| 2 | review 权限、expected revision、状态迁移 | `H2D H1-2 review 权限、expected revision 与状态迁移` | PASS |
| 3 | stale expectedRevision 不改 credential | `H2D H1-3 stale expectedRevision 不改 credential/operation key` | PASS |
| 4 | reviewQueue 最小投影，无图片摘要/私密位置 | `H2D H1-4 reviewQueue 最小投影，无图片摘要/私密位置/跨组织记录` | PASS |
| 5 | queryJob 组织内最小 DTO 与跨组织同态 404 | `H2D H1-5 queryJob 组织内最小 DTO 与跨组织同态 404` | PASS |
| 6 | 成员撤权在下一事务生效 | `H2D H1-6 成员撤权在下一事务生效（submit 与 createGrant）` | PASS |
| 7 | 文件 revision/可见性变化失败关闭 | `H2D H1-7 文件 revision/可见性变化失败关闭（submit 与 createGrant）` | PASS |
| 8 | Provider 零调用 | `H2D H1-8 所有 H1/H2 路径 Provider 零调用` | PASS |
| 附 | revoke 仍 STAGE_CLOSED | `H2D H1-R1 revoke 仍 STAGE_CLOSED：零写入零 Provider` | PASS |

与原 `6bfe1ba` H1 的对应：原 submit、review revision、权限分离、撤权/文件 revision 竞态、跨组织 queryJob、stale review 均已恢复；原 `createGrant STAGE_CLOSED` 已因 H2 开放授权而不再断言 501，改为覆盖授权拒绝路径的零核心写入（H1-8 与优先级 M1）；原 `revoke STAGE_CLOSED` 由 H1-R1 保留。

## 4. H2 全链矩阵映射

H2 证据均使用**正式 `LocalStore` + 真实 `BlacklistService` + 生产 `FaceCredentialService`**；没有用 `eligible=true` 资格桩替代真实名单判决。资格纯函数/桩仅存在于 `face-eligibility.test.mjs` 的 helper 单测。

| 验收面 | 主要证据（文件内测试名） | 结果 |
|---|---|---|
| K2 operation domain、同键同/异摘要、损坏重放、换钥失败关闭 | `face-service-layer.test.mjs`：operation_keys 元数据、K2 缺失、重放结果损坏、domain 损坏、换钥；`face-collections.test.mjs`：K2 operation key、domain head、operation key domain；`face-h2d-acceptance.test.mjs`：H2D-R2 | PASS |
| K1 domain、设备冻结快照、owner claim 只读、active/released slot 不复用 | `face-service-layer.test.mjs`：K1 domain、device 冻结字段、claim 缺失/损坏/released、active/released slot；`face-owner-claim-helpers.test.mjs` 9 项；C4 D65 | PASS |
| primary/member 成功 | `face-grant-eligibility.test.mjs`：C3 接线、C3 完整 member；C4 D01/D02 | PASS |
| 实名、入住、周期、目录、primary/slot/sponsor、guard 失败与竞态 | `face-eligibility.test.mjs` 17 项；C4 D03–D62；C3 快照/guard 竞态测试 | PASS |
| 名单 deny、review-required、一次 retry 成功、三次耗尽 | C4 D56–D62；C3 一次 retry/三次耗尽；H2D-R3/R4 | PASS |
| 权限、operation、credential/file、资格、名单、H2-b 错误优先级 | H2D-M1；C3 错误优先级；C4 D63/D64 | PASS |
| 同 slot 双请求、同 op key 并发、合法重放 | H2D-R1/R2；C4 D66–D69 | PASS |
| refs 去重后 90 单事务、91 事务前拒绝 | C3 合并 refs 90/91；C4 D73/D74；`cloud-store-point-read.test.mjs` 6 项 | PASS |
| D75 丢上下文、跨 attempt 旧 token、同 attempt callback 重跑 | C4 D75a/D75b/D75d；`scripts/h2d-concurrency.ps1` 20 轮 | PASS |
| 失败以故障注入后 state 为基线，内容级深比较 grant/job/slot/log/op key | C4 Z 断言；C3 snapshot；H2D-R1/R3/R4/M1；H2D-S1 | PASS |
| Provider 零调用 | 上述所有 H2 测试的 provider spy；H2D-S1；H2D H1-8 | PASS |

## 5. 20 轮独立进程并发/重放证据

命令（仓库根）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\h2d-concurrency.ps1 -Rounds 20
```

执行方式：每个场景每一轮都启动**独立的 `node --test` 进程**，用 `--test-name-pattern` 只执行目标用例；没有在同一进程重复 20 次代替独立进程。脚本只编排测试，不修改生产代码，未放宽超时、未降低并发、未删断言、未串行化生产路径。

| 组 | 轮数 | 结果 | 单轮耗时 min/avg/max (ms) |
|---|---:|---|---|
| 同 slot 双请求 | 20 | 20/20 PASS | 172.3 / 183.7 / 203.2 |
| 同 operation key 并发重放 | 20 | 20/20 PASS | 185.1 / 197.6 / 219.2 |
| BLACKLIST_RETRY 一次后成功 | 20 | 20/20 PASS | 172.7 / 180.5 / 192.3 |
| BLACKLIST_RETRY 三次耗尽 | 20 | 20/20 PASS | 173.1 / 184.4 / 207.7 |
| D75 丢弃 prepareAttempt 上下文 | 20 | 20/20 PASS | 168.2 / 174.9 / 182.5 |
| D75 跨 attempt 旧 token | 20 | 20/20 PASS | 169.1 / 182.5 / 235.5 |
| D75 同 attempt callback 重跑 | 20 | 20/20 PASS | 174.7 / 179.8 / 190.9 |
| 解码超时后槽位恢复 | 20 | 20/20 PASS | 142.7 / 148.3 / 154.5 |

逐轮结果（P=PASS，F=FAIL；每格对应 R01–R20）：

```text
same-slot               P P P P P P P P P P P P P P P P P P P P
same-operation-key      P P P P P P P P P P P P P P P P P P P P
blacklist-retry-success P P P P P P P P P P P P P P P P P P P P
blacklist-retry-exhaust P P P P P P P P P P P P P P P P P P P P
d75-drop-context        P P P P P P P P P P P P P P P P P P P P
d75-old-token           P P P P P P P P P P P P P P P P P P P P
d75-callback-rerun      P P P P P P P P P P P P P P P P P P P P
decode-timeout-slot     P P P P P P P P P P P P P P P P P P P P
```

汇总：**160/160 通过，0 失败，脚本退出码 0**。脚本输出的 JSON 逐轮记录 `ok/exitCode/pass/fail/durationMs`，可按命令重新生成；Node 版本 `v24.19.0`。

## 6. 敏感信息与运行模式扫描

### 6.1 成功写集

`H2D-S1` 对一次真实成功授权产生的**变化记录**逐条扫描（grant/job/slot/log/operation key/eligibility guard/operation domain/admin audit），确认不包含：

- 人脸图片/字节/base64；
- `objectKey`、`checksum`、私密文件路径；
- 姓名、手机号、地址、证件号；
- 设备序列号、MAC、IP、证书指纹；
- 原始幂等键或 `idempotencyKey` 字段。

测试 fixture 故意在 Person/Device/File 源记录中放入上述敏感字段；成功写集未复制这些字段或值。

### 6.2 错误信封与日志

- `INVALID_STATE`（资格失效）与 `BLACKLIST_DENIED`（真实名单拒绝）错误信封只含 `code/status/message`，不含人员、设备、文件或原始幂等键。
- 失败路径不新增 grant/job/slot/log/operation key/admin audit/eligibility guard；`device_operation_logs` 保持成功路径的一条，不因失败追加。
- `queryJob` 只返回 `jobId/state/attempts/lastSuccessAt/failureReason`，不返回 `opId/requestDigest/deviceId/credentialId/grantId/provider/leaseOwner/executionMode/evidenceScope`。
- `reviewQueue` 只返回最小展示字段，不含 `sourceFileId/objectKey/checksum/private path`。

### 6.3 运行模式

成功 job/grant 断言：

- `executionMode = "test"`
- `provider = "mock"`
- `evidenceScope = "simulated"`
- `projectAccess(...).deviceEffective = false`
- `businessAllowed = false`（grant 仍为 pending，job queued）

## 7. 命令与结果

工作目录 `admin-web`：

```powershell
node --test --test-isolation=none tests/cloud-store-point-read.test.mjs tests/face-grant-eligibility.test.mjs tests/face-service-layer.test.mjs tests/face-eligibility.test.mjs tests/blacklist-prepare-attempt.test.mjs tests/face-grant-d-matrix.test.mjs
# 151/151 PASS

node --test --test-isolation=none tests/face-h2d-acceptance.test.mjs
# 15/15 PASS

node --test --test-isolation=none tests/*.test.mjs
# 456/456 PASS
```

仓库根：

```powershell
node --test --test-isolation=none tests/*.test.cjs
# 51/51 PASS

git diff --check
# 通过（无输出）
```

`npm test` 原样执行在 Windows DSH 沙箱下报 `spawn EPERM`（Node `node:test` 默认按文件 spawn 子进程，被沙箱命名管道限制拦截），因此使用等价的单进程隔离命令 `node --test --test-isolation=none tests/*.test.cjs` 完成同一批 51 项根测试；未通过修改测试或放宽断言规避。

## 8. Provider / HTTP / 设备状态

| 项目 | 状态 |
|---|---|
| Mock/真实 Provider 调用 | 0（所有 H2/H1 测试 provider spy 断言 `enroll=0/revoke=0`） |
| HTTP 路由注册 | 未注册；`server.mjs`/routes 未改动 |
| 设备连接/写入 | 未连接、未写入；`access_devices`/`device_claims` 只读，成功与失败快照均不变 |
| 生产云/数据库迁移 | 未连接、未执行 |
| UI/小程序/Provider 前置 | 未新增、未上线 |
| `main` 合并 | 未合并 |

## 9. 未完成与后续门禁

- **H3 未开始**：租约、sending、派发、自动重试未实现。
- **H4 未开始**：撤权闭环、清理、claim/slot 释放未实现。
- HTTP、真实/Mock Provider 派发、设备写操作继续关闭。
- H2 整体未关闭；本文件只申请 **H2-d 复审**。H2-d 通过前不得宣布 H2 关闭或进入 H3。

## 10. 请 Codex 复审

1. 核对 `feaa1e0` 基线、本轮 `cc844c5` 测试/脚本提交与本文档提交；
2. 核对 H1 8 项独立覆盖未被 C4 替换或删除；
3. 核对 H2 矩阵是否使用真实 `BlacklistService`/正式 Store，映射是否有遗漏；
4. 复核 20 轮独立进程证据（160/160）与脚本未放宽超时/并发/断言；
5. 复核敏感写集、错误信封、日志与运行模式扫描结论；
6. 确认本分支无生产代码改动、无 HTTP/Provider/设备写、无 H3/H4 越界；
7. 对 §2.2 的 C4 终审文档可获取性给出结论。

复审通过前，H2-d 保持“待复审”，H2 不关闭。
