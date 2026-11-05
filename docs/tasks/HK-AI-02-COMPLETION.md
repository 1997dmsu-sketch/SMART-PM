# HK-AI-02 完成说明（开发 / 离线测试）

```text
完成：HK-AI-02（开发/离线测试）
分支/提交：feat/hk-isapi-capability-probe
只读白名单：6 个 GET 端点（deviceInfo / AccessControl.capabilities / UserInfo.capabilities / FDLib.capabilities / FDLib / FDLib.Count）
测试结果：35/35 通过（node --test，离线，无设备依赖）
真实设备是否执行：否（等待 2026-11-06 真人任务与隔离网络确认）
执行所需环境变量名称：HIKVISION_PROBE_ALLOW_READ / HIKVISION_PROBE_HOST / HIKVISION_PROBE_ALLOWED_HOSTS / HIKVISION_PROBE_PORT / HIKVISION_PROBE_ALLOWED_PORTS / HIKVISION_PROBE_USERNAME / HIKVISION_PROBE_PASSWORD（可选 CA_PEM、FINGERPRINT256、OUT_DIR、TIMEOUT_MS、MAX_BYTES、SALT）
未关闭阻碍：自签名证书采用 CA 还是指纹固定，需现场确认；真实能力集标签名可能与 fixture 不同
```

## 交付内容

代码位于 `tools/hikvision-probe/`：

| 文件 | 职责 |
| --- | --- |
| `src/allowlist.mjs` | 6 个只读端点、路径逐字匹配、主机/端口允许列表 |
| `src/digest.mjs` | RFC 7616/2617 Digest（MD5、SHA-256、`-sess`） |
| `src/http.mjs` | 只读 HTTPS：拒绝重定向、证书校验/指纹固定、超时、体积上限、类型检查 |
| `src/probe.mjs` | 编排：dry-run 默认、401 取挑战重试、逐端点容错、报告脱敏 |
| `src/report.mjs` | deviceInfo / capabilities / count / FDLib 解析 |
| `src/redact.mjs` | IP、MAC、序列号、账号、realm/nonce/cookie 脱敏 |
| `cli.mjs` | 环境变量入口、报告与原始响应落盘（600） |
| `test/*.test.mjs` | 35 项离线测试 |
| `fixtures/*` | 设备报文 fixture（不含真实设备数据） |

## 安全边界落实情况

| 任务卡要求 | 实现 |
| --- | --- |
| 默认 dry-run | `HIKVISION_PROBE_ALLOW_READ !== "true"` 时**不调用 transport**，测试断言 0 次调用 |
| 只读 | 方法常量 `GET`；无 POST/PUT/PATCH/DELETE 代码路径 |
| 主机/端口/路径白名单 | 逐字匹配 + 允许列表；越权主机在发请求前抛错 |
| 禁止重定向 | `http.mjs` 对 3xx 直接失败 |
| 超时/体积/类型 | 默认 10s、256KB、JSON/XML 白名单 |
| 证书 | `rejectUnauthorized: true`；支持受控 CA 与 SHA-256 指纹固定；无关闭校验开关 |
| 脱敏 | 报告不含 IP、序列号、MAC、账号、realm、nonce、cookie、证书主体 |
| 原始响应隔离 | 写入 600 权限临时目录，Git 仅提交 fixture |

## 测试矩阵

| 场景 | 覆盖方式 |
| --- | --- |
| Digest 正确性 | RFC 2617 §3.5 标准向量（response 值逐字比对） |
| 401 → 挑战 → 重试 | 假传输：首个端点 2 次调用，其余复用挑战各 1 次 |
| 认证失败 | 始终 401：6 项检查全失败、blockers 6 条 |
| 证书错误 / 超时 | 注入 `HttpError`，按端点记录且不中断其他端点 |
| 空能力集 | 返回空 XML，`faceLibraryManagement=false` |
| 畸形 JSON | 计数解析为 null，探针不崩溃 |
| 近似型号不支持 | `DS-K1T671B` + 无人脸能力位，不推断为支持 |
| 响应类型不符 | `text/html` 记录为失败而非成功 |
| 越权主机 / 缺凭据 | 发请求前拒绝 |

## 现场执行前的待确认项

1. 自签名证书：用受控 CA（`CA_PEM`）还是证书指纹（`FINGERPRINT256`），需项目负责人决定并记录。
2. 设备账号类型与权限（是否允许读取 capabilities）。
3. 能力集真实标签名：解析器对未知标签容错，但 `faceLibraryManagement` 依赖名称含 `FaceLibrary`/`FDLib`，现场需人工核对一次。
4. 是否需要固定出口 IP / 网络白名单。
