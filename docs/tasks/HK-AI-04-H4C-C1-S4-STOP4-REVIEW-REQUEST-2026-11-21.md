# HK-AI-04 H4-c C1 S4 复审请求（Stop-4）

- 分支：`feat/h4c-c1-s4`
- 基线：`49ca13ec77a94bce09a566ce1e42870accbcade7`（S0/S1⊂S2⊂S3 线性栈顶，已用 `merge-base --is-ancestor` 核验）
- 提交：`a05596c`（实施）→ `42ed148`（复审自查修复）→ `b4907ca`（BOM 清理）→ `6d2b3f0`（链层用例）
- 变更规模：5 文件 / +932 −34；`h4c-evidence.mjs` **零 diff**

## 1. 请复审的问题（按优先级）

1. **B1 处置是否可接受**：前置清单 §3.3 写「`verify` 内复用 S3 `validateH4cAdmission`」。实测该做法会让 S1 冻结夹具（`s1GateWrites`，非 18 refs 规范形）失败，等于重开 S1。故改为**在 Store 层强制 C1 写预算与集合白名单**，`gate.verify` 保持原样。安全性质是否等价？
2. **`store.mjs` 多 import 一个符号**：除 `isH4cCollection`、`H4C_AUDIT_COLLECTION` 外，另引 `H4C_COLLECTION_NAMES`。原因是 8 个 H4-c 集合中有 5 个不在 `seed()` 形状内；不引用冻结名单就得在本文件复制第二套字面量。哪个更可接受？
3. **夹具 `insert()` 改为直接播种**：S2/S3 时代的夹具用 `store.transact` 灌 H4-c 数据，S4 封口后必须改路。现为直接写 Store 状态 + 补等价审计行 + 保留 create-only 重复即 409。是否满足「不得弱化零写断言」？

## 2. 实现落点对照

| 契约（§3.3/§3.4） | 落点 | 用例 |
|---|---|---|
| 构造 `{ h4cGate }`、`#h4cGate` 私有、缺 `verify` → `TypeError` | `LocalStore` / `CloudStore` 构造器 | — |
| `transactFinal(refs, build, admission, { now, auditMode })` | 两处（Local / Cloud） | M03/M05/M06 |
| 唯一 audit：7 字段、排序 target、`createdAt === now`、必须在 refs 内 | `finalAuditWrite()` | M08/M09/M10/M11 |
| 业务写 2（append）/ 3（genesis）；仅 anchor/evidence/heads | `C1_WRITABLE_COLLECTIONS` + 条数检查 | M13/M15 |
| `transact` 遇 H4-c → `ADMISSION_REQUIRED`/409，build 不执行 | 入口守卫 + 未声明写映射 | M18a/M18b |
| `change` 遇 H4-c name → 同上 | 入口守卫 | M20 |
| `#persist` 私有 | `#persist`，`Object.hasOwn(store,"persist")===false` | M22 |
| `seed` 拒绝注入 | `seed(injection)` | M23 |
| `init` 四态 + 私有已提交基线 | `init()` + `#assertH4cUnchanged()` | M24–M27 |
| 非 H4-c 语义不变 | 未改原分支逻辑 | M19/M21 |
| 容量上限 90 → 400 | 前置检查 | M16 |
| build 抛错原样透出 | 不包装 | M17 |

## 3. 测试证据（本机实跑，非声称）

| 套件 | 结果 |
|---|---|
| `node tests/face-h4c-evidence.test.mjs` | **92 / 92** |
| `node tests/verification.test.mjs`（D10-A） | **15 / 15** |
| `node tests/store-deterministic-audit.test.mjs`（D10-B） | **12 / 12** |

- 未运行：33+7 全量、8 个 HTTP 文件、`npm test`、真实 Cloud、UI、设备、支付、部署。
- D10-A/B 均按「fixture-only、保留原断言」执行：D10-A 用临时文件构造历史数据；D10-B 用目录访问失败模拟持久化异常并在 `finally` 恢复。

## 4. 未覆盖（不声称通过）

M02（append 形态）、M28、M29、M30b（genesis 并发链层判定）。其中 M01 使用 S1 规范化夹具而非 18 refs 规范形，故在证据中标注 `partial`。

## 5. 明显的自带风险

1. **Store 与 gate 的职责边界被移动了**：写预算从 gate 移到 Store 后，任何绕过 Store 直接调 `gate.verify` 的路径不再受预算保护（当前生产代码无此路径，但这是设计层面的弱化，需裁定）。
2. **`#assertH4cUnchanged` 与夹具播种冲突**：任何直接改 `store.data` 的测试都无法再走 `transactFinal`，未来新增测试可能踩坑。
3. **Cloud 侧未做真并发**：M30a 只覆盖 Local 队列；Cloud fake 串行化未验证（D11 仍 OPEN）。

## 6. 建议复审顺序

1. `store.mjs` 的 `transactFinal`（Local 优先，Cloud 对照）
2. `finalAuditWrite` 与 `#assertH4cUnchanged`
3. M13 与 M15 两条用例（最容易掩盖问题）
4. D10-A / D10-B 两处 fixture-only 改动
5. 上述三处偏差的裁定
