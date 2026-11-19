# HK-AI-04 H4-c C1 refs 勘误与接口补全（r2）

> 状态：**设计勘误，待 Codex 审批；不授权实施。** 本勘误只新增/修订文档并同步任务卡；不实现 C1、不运行测试、不修改已验设计正文/生产代码/测试/Store/迁移脚本，不进入 C2/C3、HTTP/UI、部署上线，不安装依赖、不连接设备、不调用 Provider/生产云/支付。
>
> 输入：`96d1bc94f388fe51c99114fa6f1647b3c7665314`（父 `d7a4e363c2145dafc6d2ed30c271dcbdc00c8767`；tree `8af356d7d6b9712f837221c8d0d0d8cd2f4f46ed`）；工作树 `C:\Users\Administrator\Documents\ChatGPT\宇宙智联\.tmp\c1-staged-task`；分支 `docs/h4c-c1-staged-implementation-task`；开始工作时 HEAD = 输入提交，工作区干净。
>
> 设计基线：`docs/tasks/HK-AI-04-H4C-C1-EMPTY-CHAIN-PROOF-DESIGN-2026-11-16.md`（1607 行，v8；blob `c4feffa5831f5bf0e04e8e902865cb8e1f1b0183`，sha256 `d769da93c4880409c946e316f2414ca6b1135a96361934abc188111ca6dcbec7`）。冲突优先级：**§18 > §17 > §16 > §15 > §4–§14 历史正文**。
>
> 代码基线：`5dff386fe5c9648b04d1623d3e1898c59332639e`；`fcae246` 是其后代（10 个 docs-only 提交），`git diff --stat 5dff386..fcae246 -- . ':(exclude)docs'` 为空。
>
> 云指令/审查：`/workspace/artifacts/SEVEN-TASKS-REVIEW-2026-11-19/DISPATCH.md` 与 `REVIEW.md` **本机未取得**。已检查并均不可读/不存在：`C:\workspace\artifacts\SEVEN-TASKS-REVIEW-2026-11-19\DISPATCH.md`、同目录 `REVIEW.md`、`/workspace/artifacts/...`、`\\wsl$\workspace\artifacts\...`、`C:\workspace` 根；仓库 `.tmp` 与 `docs` 下也未发现同名 `DISPATCH.md`/`REVIEW.md` 副本。**未读，不声称完整闭合，不据此声称任何云端裁定**；只按本轮用户明确要求修订，未明处列 §5/§6 待裁。
>
> 本勘误不是对已验设计的静默重开：它把“proof 漏算”作为**显式 E1 勘误**记录，逐条重算 refs/writes、列出受影响条款与审批要求；设计正文不改，审批后以本勘误与任务卡为准。

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| E1 proof 漏算 | C1 17 refs 只含一个 audit 槽且按 §17.5 `:1298` 该槽是 `admin_audit`；`CoverageValid`/`WriterPlanValid`/`FenceValid` 还必须读当前 audit proof。故 **C1 由 17 修正为 18 refs**；C2 R1 由 26 修正为 27 |
| 其他事务 | migration-anchor（pre-proof）、finalize/recovery/rotate（已含 target `proof1`）、monitor（已含 current `proof1`）、k3-bootstrap、plan-issue/revoke **refs 不变**；writes 全不变 |
| 预算影响 | 单事务上限 90；C2 R1 27，余量 **63**；C1 18；无新增集合计数（按 E2 解释，proof 属于 8 集合之一）、无新增索引/epoch 计数记录、无新增写 |
| E2 集合名 | 8 个 H4-c 集合建议冻结为：`device_operation_evidence`、`device_operation_evidence_heads`、`evidence_digest_domains`、`evidence_chain_anchors`、`evidence_chain_audits`、`evidence_chain_fences`、`evidence_chain_k3_markers`、`evidence_chain_plans`；`admin_audit` 为通用 7 字段审计，单独 explicit 门禁，不计入 8 |
| E3 接口/DI | 冻结 `transactFinal`、`createH4cGate`、`h4cGate` 构造注入、`#persist` 私有、8 集合常量模块；**集合门禁用私有 Set + 只读 `isH4cCollection` + 冻结枚举快照，不导出 Set**；Store 不读环境、不 import face-service；详见 §3 |
| 审批 | **18/27 预算按本轮口径保留（可采纳）**；E1/E2/E3、任务卡 §3.7 的显式非 HTTP 测试清单、§3.3b/D10 的 persist 私有影响、§3.1/P9 的集合门禁不可变性，均交 Codex 复审；未批准前 S2 及之后不得实施 |
| 当前状态 | 只写勘误与卡片；无代码、无测试执行、无设计正文修改、无安装、无云/设备/支付/业务网络 |

## 1. E1：C1 少算 audit proof ref（核心勘误）

### 1.1 事实与反例

设计 §17.5 的 C1 行（`:1283`）为：

```text
domain2 + audit1 + fence1 + marker1 + writerPlan1 + anchor1 + head1 + E1..9 = 17
```

逐项相加：`2 + 1 + 1 + 1 + 1 + 1 + 1 + 9 = 17`。其中 `audit1` 是唯一 `admin_audit` 的 ref，不是 audit proof：

- §17.5 `:1298` 明确写“唯一 `admin_audit` 已计入 C1 17 的 `audit1`”；
- §4.13 要求 `admin_audit/<auditId>` 已在 refs 中声明，且 C1 helper 只返回业务写、audit 由调用方显式加入；
- §17.5 的 C2 行 `:1284` 也以“唯一 `admin_audit` 已含 C1 `audit1`”解释 C1→C2 的继承。

因此 C1 的 17 refs 中**没有 audit proof ref**。但 C1 runtime 必须读当前 proof：

- `CoverageValid`（§3.2）要求 proof 存在、24 字段、HMAC、K3/epoch/policy/writerSet/collections 绑定；
- `WriterPlanValid`（§17.1 R3）要求 `proof.writerPlanId=plan._id`；
- `FenceValid`（§17.3）要求 `fence.epoch=proof.writeEpoch`；
- 保险丝/健康判定还需 `proof.checkedAt`/`writeEpoch`。

结论：按字面 17 refs 实现的 C1 **无法读取 proof**，`CoverageValid`/`WriterPlanValid` 无法成立；这不是测试缺项，而是 refs 清单漏算。

**可计算性不受影响**：`proofId` 由 precheck 给出（或由 K3 fp + domainHeadRevision + writeEpoch 确定性计算）；`writerPlanId` 由 §18.2 canonical `planId(writeEpoch)` 在事务前确定。因此把 proof 加入 refs 不需要先读 proof，不产生“读 proof 才能声明 proof ref”的循环。

### 1.2 修正

```text
C1 refs(18) = domain2 + proof1 + admin_audit1 + fence1 + marker1
            + writerPlan1 + anchor1 + head1 + E1..9
C2 R1 refs(27) = C1 18 + org/member/job/grant4 + op key/op domain3 + job log/op log2
```

- C1 首条/非首条 writes 不变：**3 / 2**（anchor+E+head / E+head）；唯一 `admin_audit` 由 explicit finalWriteSet 追加，事务总写 **4 / 3**。
- proof 是**只读** ref；C1 不创建/不修改 proof，故 writes 不增加。
- 不新增 proof 集合：proof 原本就是 8 个 H4-c 集合中的“audit”槽（见 E2）；本勘误只补字面名。
- 不新增索引/epoch 计数记录；C1/C2 仍 ≤90。
- 不改变 canonical ID、每 epoch 唯一、planKind consumed、39 字段、健康谓词、错误码。

### 1.3 逐条重算（所有事务）

| 事务 | 原 refs | 原清单是否含 proof | 修正 refs | Δ | writes 原/新 | 说明 |
|---|---:|---|---:|---:|---|---|
| C1 首条/非首条 | 17 | **否**（`audit1`=admin_audit） | **18** | +1 | 3/2 不变 | 补 `proof1`；proof 只读 |
| C2 R1 | 26 | 否（继承 C1） | **27** | +1 | 不变 | 继承 C1 18 |
| migration-anchor | 18 | 否（pre-fence/pre-proof） | 18 | 0 | 2 不变 | migration-anchor 时尚无 target proof；不要求 FenceClear |
| migration-finalize | 8 | 是（`proof1`=target） | 8 | 0 | 5 不变 | target proof create-only 已在清单 |
| recovery-finalize | 8 | 是（`proof1`=target） | 8 | 0 | 5 不变 | 新 proof E1 已在清单；source 用 halted fence，不要求旧 proof |
| writer-rotate | 8 | 是（`proof1`=target） | 8 | 0 | 4 不变 | 新 proof E1 已在清单；旧 W0 不写 |
| monitor heartbeat/halt | 7 | 是（`proof1`=current） | 7 | 0 | 2 不变 | heartbeat 需 CoverageValid；halt 只 fence+audit |
| k3-bootstrap | 5 | 否（无 proof 要求） | 5 | 0 | 4 不变 | 只 domain2+fence+marker+audit |
| plan-issue/plan-revoke | 2 | 否 | 2 | 0 | 2 不变 | plan+audit |
| C2 R2 | ≤90 | n/a | ≤90 | 0 | — | 独立事务 |

**为什么 finalize/recovery/rotate 不 +1**：

- migration-finalize 处于 `UNPROVEN`（无 proof），只创建 target proof；不存在“旧 proof”可读。
- recovery-finalize 与 writer-rotate 的授权来源是 **halted fence + plan/W1**，设计要求不要求 `FenceClear`、不要求旧 proof；target proof 已在 refs。
- 若未来实现选择额外读取旧 proof，必须另立勘误并重算，不得在本卡偷偷增加。

### 1.4 影响矩阵

| 维度 | 影响 |
|---|---|
| C1 refs | 17 → **18** |
| C2 R1 refs | 26 → **27**；距 90 余 **63** |
| C1/C2 writes | 不变（3/2；唯一 audit 另计 4/3） |
| 集合数 | 不变（8 个 H4-c；proof 原属“audit”槽）；见 E2 的字面名 |
| 索引/epoch 计数 | 0 新增 |
| Store gate shape | C1 的 H4-c 子集必须恰好 18 refs；C2 总 refs 27；总数 ≤90；缺少 proof ref 必须拒绝（新负向） |
| 运行时负向 | C1 若只声明 17（少 proof）→ 必须在读 proof 前/事务内 `ADMISSION_REQUIRED` 或 `PROOF_REQUIRED`，不得静默跳过 CoverageValid |
| 设计断言 | §0、§14、§16.5、§16.6、§17.5、§17.6、§18.8、§18.10 中 17/26 相关行需按 §1.5 更新 |
| 测试矩阵 | N107/N108/N131/Q39 的 C1/C2 计数改 18/27；新增“少 proof ref 即拒绝”用例 |
| 已关闭契约 | canonical ID、每 epoch 唯一、planKind consumed、39 字段、健康谓词、错误码：**均不变** |
| C2 | C2 R1 27；C2 R2 不变；C2 未实现，仅预算 |

### 1.5 受影响条款（位置 → 原文 → 修正）

| 位置 | 原文（摘要） | 修正 |
|---|---|---|
| §0 摘要 `:35` | `C1 17；C2 R1 26` | `C1 18；C2 R1 27` |
| §14 第 5 条 `:599` | `C1 17/C2 26/...` | `C1 18/C2 27/...` |
| §16.5 C1 行 `:901` | `... = 17` | `... + proof1 = 18` |
| §16.5 C2 行 `:902` | `C1 17 + ... = 26` | `C1 18 + ... = 27` |
| §16.5 余量 `:912` | `C2 R1 26 距 90 余 64` | `27 距 90 余 63` |
| §16.6 N107 `:954` | `C1 17/C2 26` | `C1 18/C2 27` |
| §16.6 N108 `:955` | `C1 17/C2 26/...` | `C1 18/C2 27/...` |
| §17.5 C1 行 `:1283` | `domain2+audit1+... = 17` | `domain2+proof1+audit1+... = 18` |
| §17.5 C2 行 `:1284` | `C1 17+... = 26` | `C1 18+... = 27` |
| §17.5 上限 `:1294` | `最大 C2 R1 26，余量 64` | `最大 C2 R1 27，余量 63` |
| §17.5 `:1298` | `唯一 admin_audit 已计入 C1 17 的 audit1` | 保留语义：C1 18 中 `audit1` 仍为 `admin_audit`，`proof1` 另计 |
| §17.6 Q39 `:1313` | `C1 17/C2 26 不变` | `C1 18/C2 27` |
| §17.6 N131 `:1340` | `C1 17（3/2）、C2 26...` | `C1 18（3/2）、C2 27...` |
| §18.8 表 `:1529` | `C1 / C2 R1 17 / 26` | `18 / 27` |
| §18.8 `:1531` | `不新增 store ref`（v8 唯一性语境） | 仅指 v8 唯一性改动；本 E1 是另一项，+1 proof ref，二者不矛盾 |
| §18.10 `:1553` | `17/26/18/8/8/8/7/5/2 不变` | `18/27/18/8/8/8/7/5/2`；并注明 E1 是 proof 漏算修正，非 v8 语义变更 |
| §15.4 `:729` | v5 C1 16（历史） | 历史记录不改；仅 v7/v8 当前行修正 |
| §15.4 `:730` | v5 C2 25（历史） | 同上 |

- 设计正文保持原样；以上为**勘误生效后的权威读数**，审批后以本表覆盖对应行。
- 其他出现 17/26 的位置若属于历史版本（v4/v5/v6）或非 refs 语境（如章节号、时间），不在修正范围；S6 用精确文本扫描确认无遗漏。

## 2. E2：8 个 H4-c 集合的字面名与 admin_audit 边界

### 2.1 解释

设计 §15.4 `:740`、§16.5 `:912`、§17.5 `:1297` 只给简写“evidence/head/domains/anchor/audit/fence/k3-markers/plans”。结合：

- §4.2/§4.12/§4.13 把“audit proof”作为独立 24 字段记录，且 recovery 写明“H4-c 子集恰好 fence+proof”，`admin_audit` 是另一个 7 字段记录；
- §17.5 `:1298` 把 `admin_audit` 计入 C1 的 `audit1`，说明它是通用审计日志，不是 8 个 H4-c 集合之一；

本勘误把 8 集合中的 “audit” 解释为 **audit proof**，把 `admin_audit` 作为通用集合单独做 explicit 门禁。

### 2.2 建议冻结的字面名

| 逻辑集合 | 字面名 | 约束 | 写入事务 |
|---|---|---|---|
| evidence | `device_operation_evidence` | exact + create-only | C1、C2 |
| evidence head | `device_operation_evidence_heads` | exact + CAS 更新 | C1、C2 |
| K3 domain | `evidence_digest_domains` | exact + create-only | 仅 k3-bootstrap（C1 只读） |
| anchor | `evidence_chain_anchors` | exact (6) + create-only | C1 首条、migration-anchor |
| audit proof | `evidence_chain_audits` | exact (24) + create-only | migration-finalize、recovery、rotate |
| fence | `evidence_chain_fences` | exact (12) + 可更新 | finalize、recovery、monitor |
| K3 marker | `evidence_chain_k3_markers` | exact (18) + create-only | 仅 k3-bootstrap |
| plans | `evidence_chain_plans` | exact (39) + create-only（status 精确更新） | plan-issue/revoke、finalize、recovery、rotate |
| 通用审计 | `admin_audit` | exact (7) + explicit | 所有事务的唯一审计（不计入 8 集合） |

- 命名理由：与设计已出现的 `evidence-chain-audit:v1:` / `evidence-chain-plan:v1:` / `evidence-chain-fence:v1:` 前缀一致；snake_case 与现有集合一致。
- 替代解释：若 Codex 裁定 8 集合中的 “audit” = `admin_audit`，则 audit proof 必须成为第 9 个集合（同样需要字面名），C1 refs 仍为 18、C2 27；本勘误不依赖“8”这个数字成立，但需在审批时明确选哪一种。
- 本勘误不创建/部署 Cloud 集合；只冻结逻辑名，供实现卡使用。

## 3. E3：Store 接口与依赖注入方案

### 3.1 共享常量模块与不可变集合门禁

新增纯常量模块（无 import、无副作用）：

```js
// admin-web/lib/h4c-collections.mjs
export const H4C = Object.freeze({
  evidence: "device_operation_evidence",
  evidenceHeads: "device_operation_evidence_heads",
  domains: "evidence_digest_domains",
  anchors: "evidence_chain_anchors",
  auditProofs: "evidence_chain_audits",
  fences: "evidence_chain_fences",
  k3Markers: "evidence_chain_k3_markers",
  plans: "evidence_chain_plans",
});

// 不可变枚举快照：冻结数组，仅用于枚举/断言；不可 push/splice/改下标
export const H4C_COLLECTION_NAMES = Object.freeze([
  H4C.evidence, H4C.evidenceHeads, H4C.domains, H4C.anchors,
  H4C.auditProofs, H4C.fences, H4C.k3Markers, H4C.plans,
]);

export const H4C_AUDIT_COLLECTION = "admin_audit";

// 封闭私有集合：模块作用域，绝不导出；不存在 add/delete/clear 外部入口
const H4C_COLLECTION_SET = new Set(H4C_COLLECTION_NAMES);
// 捕获原型方法，避免运行期替换 Set.prototype.has 绕过判定
const setHas = Set.prototype.has;

// 只读成员判定：只接受字符串；不返回集合、不暴露遍历器
export function isH4cCollection(name) {
  return typeof name === "string" && setHas.call(H4C_COLLECTION_SET, name);
}
```

- `H4C_COLLECTION_SET` **不得导出**，也不得通过任何函数返回；`H4C_COLLECTION_NAMES` 是冻结数组；`H4C` 是冻结对象。
- `isH4cCollection` 必须捕获模块加载时的 `Set.prototype.has` 并用 `setHas.call(privateSet, name)`，避免运行期替换原型方法绕过；不得暴露 private Set 或 `setHas`。
- **不得**把 `Object.freeze(new Set(...))` 当不可变：`Object.freeze` 只冻结对象自身属性，`Set.prototype.add/delete/clear` 仍可改变内容；因此本方案不导出任何 Set，只导出 `isH4cCollection` 谓词。
- `store.mjs` 只 import `isH4cCollection` 与 `H4C_AUDIT_COLLECTION`，不 import Set；`h4c-evidence.mjs` 只 import 字面名/谓词。
- 该模块不包含 K3 key、不读环境、无 Store 依赖；不得提供 `addH4cCollection`/`removeH4cCollection`/`setH4cCollections` 之类 API。
- 测试必须证明：命名空间无 `H4C_COLLECTION_SET`；`Object.isFrozen(H4C)`/`Object.isFrozen(H4C_COLLECTION_NAMES)` 为真；`push`/下标赋值/属性赋值抛错；`isH4cCollection` 对 `admin_audit`、`__proto__`、`constructor`、空串、null/对象/Symbol 返回 false；对 8 个字面量返回 true。

### 3.2 Gate 工厂、签名与调用权限

```js
// h4c-evidence.mjs
export function createH4cGate({ config, health = {} } = {}) { ... }

// 返回冻结对象，仅暴露 verify；不暴露 key/config/health
{
  verify({ state, refs, writes, admission, now }) { ... } // 成功返回 undefined；失败抛 HttpError
}
```

- `config`：`evidenceKeyConfig()` 的结果（key Buffer、realm、version、fingerprint）；gate 不读 `process.env`。
- `health`：`{ windowMs = 300000, skewMs = 30000 }`，仅用于 fence 健康判定；非法 → `NOT_CONFIGURED`/`EVIDENCE_INVALID`。
- `now`：受信服务时钟的安全整数，事务调用方显式传入；gate 不调用 `Date.now()`。
- 返回的 gate 必须 `Object.freeze`；只含 `verify` 函数；不暴露 `key`/`config`/`health`/Set；无 `setConfig` 等 mutator。
- `verify` 必须同步、无 I/O、不得修改 `state/refs/writes/admission/now`；测试用 `structuredClone` 前后 `deepEqual` 证明。
- **调用权限**：只有 Store 的 `transactFinal` 在构建 finalWriteSet 后、写入前调用一次；调用方可以预检，但不能替代 Store 的这次调用；gate 可跨事务复用（无状态）。
- **错误契约**：`verify` 只抛 `HttpError`，不返回布尔；错误码见 §3.4；失败时 Store 不得写入任何字节。
- `verify` 的职责（顺序即失败优先级）：
  1. `admission` 形状（kind/operation/writeEpoch/admissionPolicyVersion/writerSetDigest/proofId/ticket/operationAuthDigest）。
  2. refs 去重、≤90；C1 的 H4-c 子集恰好 18（domain2+proof+fence+marker+writerPlan+anchor+head+E1..9+audit）；C2 允许额外非 H4-c refs。
  3. writes 全部已在 refs；恰好一个 `admin_audit`（7 字段）；runtime 不得写 domain；无未声明写。
  4. `refsDigest`/`writesDigest` 重算；ticket HMAC 重算；`operationAuthDigest` 绑定。
  5. `state` 内 fence `FenceValid(now)`、epoch=proof.writeEpoch；proof 24 字段/`k3MarkerDigest`/`writerPlanId`；marker 18 字段；writer plan consumed+runtimeTicket；proof/marker/plan/fence 交叉绑定。
  6. 失败抛对应错误码；成功返回 `undefined`，不写任何记录。

### 3.3 Store 构造、全路径签名与显式写集

```js
new LocalStore(directory, { h4cGate })   // 或 { h4cGate: null }
new CloudStore(app, { h4cGate })
```

- `#h4cGate` 为私有字段：构造后不可替换，无 getter/setter，不通过 `store.h4cGate` 暴露；`h4cGate=null` 时任何 H4-c 写一律 `ADMISSION_REQUIRED`（fail closed）。
- 构造参数含非 null、但缺 `verify` 函数的对象 → `TypeError`（编程错误，构造即失败，不产生 Store 写）。

**`transactFinal(refs, build, admission, { now, auditMode = "explicit" } = {})`**：

1. `auditMode !== "explicit"` → `ADMISSION_REQUIRED`（不 build）。
2. `#h4cGate` 为空 → `ADMISSION_REQUIRED`（不 build）。
3. `admission` 形状错 → `ADMISSION_REQUIRED`（不 build）。
4. `now` 非安全整数 → `EVIDENCE_INVALID`（不 build）。
5. refs 形状/重复 → `EVIDENCE_INVALID`；>90 → 沿用 Store 容量错误 400（不 build/不写）。
6. 按 refs 读 state；`await build(state)` 必须返回数组；抛错则原样上抛、零写。
7. 校验 finalWriteSet：声明、字段、H4-c 子集、唯一 audit、无未声明写；失败 → `ADMISSION_REQUIRED`/`EVIDENCE_INVALID`。
8. `#h4cGate.verify({ state, refs, writes, admission, now })`。
9. 只写 finalWriteSet；不自动追加 audit、不随机 audit、不改 `_id/createdAt/target`；失败整事务回滚。
10. LocalStore 成功才落文件；CloudStore 成功才提交。

**同一时钟**：调用方必须把同一 `now` 传给 C1 builder 上下文与 `transactFinal` options；Store 只用 `options.now` 调 gate；不得出现两个时钟或 gate 自取时间。

**`transact(refs, build, audit)`（legacy）**：保留旧签名，仅非 H4-c；若任一 ref 的 collection 使 `isH4cCollection` 为真 → `ADMISSION_REQUIRED`，**不 build、不写**；若 refs 不含 H4-c 但 `build` 返回 H4-c 写，按未声明写/`ADMISSION_REQUIRED` 拒绝（不得绕过）；非 H4-c 行为/确定性审计不变。

**`change(name, id, build, audit)`（legacy）**：`isH4cCollection(name)` 为真 → `ADMISSION_REQUIRED`，**不 build、不写**；非 H4-c 行为不变。

**`#persist(data)`**：私有；仅 `init`/`transact`/`transactFinal` 内部调用；不暴露 `persist` 别名；外部无法以任何 public 方法触发全量持久化。

**`seed()`**：8 个 H4-c 集合只允许空数组；任一非空 → `ADMISSION_REQUIRED`；非 H4-c 默认值不变。

**`init()`**：缺失的 H4-c 集合补空数组（仅内存）；已有 H4-c 值不是数组 → `EVIDENCE_INVALID`（不修复）；已有非空 H4-c 数组 → 原样保留、不写/不改；不写任何 H4-c 记录；仅在数据文件不存在时持久化 seed（其中 H4-c 为空数组）。

**显式写集/审计（`transactFinal` 唯一）**：

- `finalWriteSet = await build(state)` 必须为数组；每项 `{collection,id,data}`；`data._id===id`；字段 exact。
- 恰好一条 `collection===H4C_AUDIT_COLLECTION` 的写；不得 0 条/2 条；不得自动追加/随机 UUID。
- `admin_audit` 恰好 7 字段：`_id, orgId, actorId, actorType, action, target, createdAt`；`_id` 为 `audit-h4c-v1:`+32 位小写 hex；`target` 为排序后的业务写 `collection/id`（不含 audit 自身）以 `", "` 连接；`createdAt` 安全整数。
- audit 的 `_id` 必须已在 refs 中声明；`target` 必须与实际业务写目标逐项一致；`orgId/actorId/actorType/action` 必须为非空 opaque 字符串。
- C1 只写 anchor/E/head + audit；不得写 domain/proof/fence/marker/plan；shape 不符 → `ADMISSION_REQUIRED`。
- `writesDigest` 覆盖含 audit 的最终字节；终检后不得追加/修改任何写。

**错误契约（与 §3.4 对齐）**：K3 config → `NOT_CONFIGURED` 503；domain → `DOMAIN_*`；proof → `PROOF_REQUIRED`；fence → `HALTED`/`FENCE_EXPIRED`；ticket/audit/undeclared/H4-c legacy → `ADMISSION_REQUIRED`；chain/shape → `BROKEN`/`EVIDENCE_INVALID`；create-only 冲突 → `CONFLICT`；>90 → 400 容量错误；build 抛错 → 原错误。所有失败均零写。

- LocalStore 与 CloudStore 语义一致；Cloud fake 事务失败整批回滚。
- 不改 `server.mjs`/`routes.mjs`；C1 不注入生产 gate（C2 再接线）。

### 3.4 测试依赖注入与安全验收

```js
const gate = createH4cGate({ config: TEST_K3_CONFIG, health: { windowMs: 300000, skewMs: 30000 } });
const store = await new LocalStore(dir, { h4cGate: gate }).init();
// 或 new CloudStore(fakeApp, { h4cGate: gate })
```

- 测试用固定 K3 key、固定 `now`；不得用生产 key。
- 前置 domain/fence/proof/marker/plan 记录可直接构造 `store.data`（测试 setup），但被测写路径必须走 `transactFinal` + gate；不得为测试新增生产初始化 helper。
- 必须覆盖集合门禁不可变性：命名空间无 `H4C_COLLECTION_SET`；`Object.isFrozen(H4C)`/`H4C_COLLECTION_NAMES`；`push`/下标/属性赋值抛错；`isH4cCollection` 对 `admin_audit`/`__proto__`/`constructor`/空串/非字符串为 false；对 8 个字面量为 true；`Object.freeze(new Set()).add` 仍生效（证明不能导出 Set）；替换 `Set.prototype.has` 后判定仍不变（捕获原型方法）。
- 必须覆盖 `transactFinal/transact/change/#persist/seed/init` 全路径负向与零写（完整矩阵见任务卡 §3.3f）。
- `verification.test.mjs:381` 直接 `store.persist(store.data)` 模拟 legacy 数据；`#persist` 私有后会失败。见 §5 P5/D10：建议把该测试改为在 `init()` 前直接写 `demo-data.json`，不改 identity 断言；需批准将该测试纳入 S4 允许文件。

## 4. 对任务卡的具体修订

任务卡 r3 将同步（**18/27 预算按本轮口径保留，可采纳**）：

1. C1 17→**18**、C2 26→**27**；writes 3/2 不变；余量 64→63；本轮明确可采纳。
2. 8 集合表改为“audit proof”并补字面名；`admin_audit` 单列为通用 explicit 审计，不计入 8。
3. 增加 `admin-web/lib/h4c-collections.mjs`（**私有 Set + `isH4cCollection` + 冻结枚举快照，不导出 Set**）、`transactFinal`/`createH4cGate`/`h4cGate` 构造注入/`#persist` 私有的阶段允许文件、签名、权限、错误契约、显式写集与 **M01–M30 全路径验收矩阵**。
4. 删除 r1 中会启动 loopback 监听的全量 glob 命令；改为 **33 个非 HTTP 文件显式清单 + 7 个根文件显式清单**，并加“加载前 guard”要求；8 个会 `listen` 的 HTTP 文件明确不跑。
5. D2/D3/D7 标记为“勘误 E1/E2/E3，待审批”；新增 D10（persist 私有化对 `verification.test.mjs:381` 的影响）。
6. S2/S3/S5 的 refs 全部按 18；S6 按 18/27 验收。

## 5. 审批要求（问题 → 位置 → 审批）

| # | 问题 | 位置 | 审批要求 |
|---|---|---|---|
| P1 | C1 proof 漏算；17 无法读 proof | 设计 §17.5 `:1283`、§16.5 `:901`、§0 `:35`、§14 `:599`、N107/N108/N131 | 确认 E1：C1 **18**、C2 R1 **27**（18/27 本轮已可采纳）；writes 不变；受影响行按 §1.5 覆盖 |
| P2 | 集合字面名缺失；8 集合中 audit 的所指 | 设计 §15.4 `:740`、§16.5 `:912`、§17.5 `:1297` | 批准 §2 的 8 个字面名 + `admin_audit` 通用边界；若选“audit=admin_audit”，需同时批准 proof 为第 9 集合 |
| P3 | Store 接口/依赖注入/集合门禁未定义 | 设计 §4.4 `:166`、§4.13 `:322`（无接口定义） | 批准 §3 的 `transactFinal`、`createH4cGate`、构造注入、`#persist` 私有、`h4c-collections.mjs` 私有 Set + `isH4cCollection` + 冻结枚举快照；不得导出可变 Set |
| P4 | 卡片全量测试命令会启动 loopback 监听 | 卡片 r1/r2 §3.7 | 批准改为 33 个非 HTTP 文件显式清单 + 7 根文件；8 个 HTTP 文件不跑；guard 必须在加载前 |
| P5 | `#persist` 私有会破坏 `verification.test.mjs:381` | `admin-web/tests/verification.test.mjs:381` | 批准将该测试改为 `init()` 前写 `demo-data.json`（仅 fixture，不改 identity 断言），纳入 S4 允许文件；或批准其他等价方案 |
| P6 | N01–N142 与“工具另立卡”归属 | 设计 §14 第 6/7 条 `:600-601` | 批准卡片 §11.2 的 C1/另卡划分；若要求 C1 全覆盖，需明确“合成记录代替执行工具”的边界 |
| P7 | 设计页首自述“待 Codex 复审” | 设计 `:3` | 明确批准文/批准 SHA 与实施分支；本勘误不代替批准 |
| P8 | 云 DISPATCH/REVIEW 不可读 | 本机路径（§页首） | 提供可读副本，或确认本轮只按用户明确要求修订、不声称逐项闭合 |
| P9 | 集合门禁若导出可变 Set，可被 import 方 `add` 绕过 | `h4c-collections.mjs` 设计 | 批准“私有 Set + 只读 `isH4cCollection` + 冻结枚举快照”；不得导出 Set，不得把 `Object.freeze(Set)` 当不可变 |

## 6. 未验证 / 未做

- 未实现任何代码；未运行任何测试；未修改设计正文/生产代码/测试/Store。
- 未验证真实 Cloud 并发、真实 K3/设备/Provider/支付/业务网络。
- 未取得 `/workspace/artifacts/SEVEN-TASKS-REVIEW-2026-11-19/DISPATCH.md` 与 `REVIEW.md`；未读，不声称闭合。
- P1–P9 均待 Codex 复审；**18/27 预算按本轮口径保留**；D10/P5 未决前 S4 不得开工。
- 本勘误不自批、不宣称 C1/G1 通过、不授权合并/实施。

## 7. 交付

- 本勘误（r2）与任务卡 r3 将在同一提交追加；提交后由交付回报给出完整 SHA、父、diff、远端 SHA 与固定 SHA 链接。
- 普通 push；不 amend/rebase/reset/squash/force/cherry-pick/merge；远端前移/分叉即停止报告。
- 交 Codex 复审 P1–P9；未批准前不进入实现。
