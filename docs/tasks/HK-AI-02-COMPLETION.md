# HK-AI-02 完成说明（整改第六轮：59b6437 退回返工）

```text
完成：HK-AI-02（52227b6 复审五项整改）
分支/提交：feat/hk-isapi-capability-probe
只读白名单：6 个 GET 端点（未变）
测试结果：58 项（Linux 57 通过 + 1 跳过；Windows 55 通过 + 3 跳过）
真实设备是否执行：否（复审通过前禁止；现场仍需批准栏）
执行所需环境变量名称：ALLOW_READ / HOST / ALLOWED_HOSTS / PORT / ALLOWED_PORTS /
  USERNAME / PASSWORD / EXPECTED_MODEL / FINGERPRINT256 / OUT_DIR / TIMEOUT_MS /
  MAX_BYTES / SALT（CA_PEM 仅批量部署迁移时使用）
未关闭阻碍：等待 Codex 复审（59b6437 曾因三项缺陷退回）；真实型号标签仍以现场读数为准
```

## 针对 `52227b6` 的五项整改

| # | 复审要求 | 实现 |
|---|---|---|
| 1 | 预批准型号校验 | 新增 `HIKVISION_PROBE_EXPECTED_MODEL`；缺失即拒绝执行（零请求）；`deviceInfo` 解析为空或与期望不一致 → 在第二个请求前 `abort` |
| 2 | 立即停止条件 | 第二次 401、不可解析 challenge、指纹错误、重定向、超时、响应超限、内容类型异常、网络/TLS 错误 → `aborted` 并停止后续端点；仅首次 401 挑战允许重试一次 |
| 3 | 命令示例泄露风险 | README 改为 `read -rsp` 无回显注入 + 结束 `unset`；示例强制包含 `EXPECTED_MODEL` 与指纹；删除“自签名必须提供 CA”的表述 |
| 4 | 输出目录权限 | 新增 `src/fs-safe.mjs`：既有目录显式 `chmod 0700` 并回读校验；报告与 raw 以 `0600` 写入；任一步失败即终止（Windows 无 POSIX mode 语义，只执行不校验） |
| 5 | 文档计数不一致 | README 与完成说明统一为实际测试数（55 项） |

## `59b6437` 复审退回的三项（本轮已修复）

| 复审项 | 修复 |
|---|---|
| P0-1 畸形 Digest 未 fail-fast | `DigestError` 现在携带 `code=AUTH_CHALLENGE`；challenge 解析失败、缺字段、不支持的算法、Authorization 构造失败全部映射为致命认证错误。新增“缺 realm”和“SHA1 算法”两项测试，均断言后五个端点零调用 |
| P0-2 `RESPONSE_ERROR` 未 fail-fast | 将 `RESPONSE_ERROR` 纳入致命传输错误；新增响应流重置测试，断言 1 次调用后中止 |
| P1-3 README 凭据/指纹注入 | 改为 `set +o history` + `read -r/-rsp` 受控输入；结束后 `unset` 本次注入的全部变量并恢复历史；模板不再出现内联现场值或占位 `export` |

## fail-fast 行为矩阵

| 场景 | 行为 |
|---|---|
| 期望型号缺失 | 启动即拒绝，0 请求 |
| deviceInfo 无型号 / 型号不符 | 1 请求后中止，`MODEL_UNPARSED` / `MODEL_MISMATCH` |
| 首次 401 + 有效 Digest | 重试一次并继续 |
| 第二次 401 | 中止，`AUTH_FAILED` |
| 无 / 不可解析 challenge | 中止，`AUTH_CHALLENGE` |
| 指纹错误、重定向、超时、超限、类型异常、TLS 错误 | 中止，对应错误码 |
| 其它 HTTP 状态（如 404） | 记端点失败，继续（能力端点可能本就不支持） |

## 测试矩阵（58 项）

| 组 | 数量 | 内容 |
| --- | --- | --- |
| Digest | 7 | RFC 2617 向量、qop 退化、挑战解析、nonce |
| 白名单 | 9 | 路径逐字、穿越、查询串、主机、端口、方法 |
| TLS（真实本地） | 10 | 正确/错误/缺失指纹、轮换、302、体积、超时、过期告警 |
| 探针 fail-fast | 19 | 型号缺失/为空/不符、第二次 401、无/畸形挑战、不支持算法、`RESPONSE_ERROR`、各类中止、空能力/畸形 JSON 不中断 |
| 文件系统权限 | 4 | 新建/既有目录 0700、文件 0600、Windows 分支 |
| 报告/脱敏 | 9 | IP/MAC/序列号/账号/nonce 不出现 |

## 现场执行前置（不变）

1. 项目负责人 + 现场负责人签署批准栏，确认完整型号、固件、隔离网络、最小权限账号、目标主机/端口。
2. 线下核验叶证书 SHA-256 指纹并填入 `HIKVISION_PROBE_FINGERPRINT256`（可带下一枚）。
3. 设置 `HIKVISION_PROBE_EXPECTED_MODEL` 为批准型号原文。
4. 先 dry-run 核对 6 个端点；再执行一次；失败保留 `checks`/`aborted`，不反复重试。
5. 报告与原始响应写入 0700 目录/0600 文件，分析后删除。

## 安全边界（不变）

只读 GET、六个白名单端点、严禁重定向、纯指纹模式（过期仅告警）、无降级开关、报告脱敏、原始响应不入库。
