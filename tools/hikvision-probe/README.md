# 海康只读 capability 探针（HK-AI-02）

默认 **dry-run**：不设置 `HIKVISION_PROBE_ALLOW_READ=true` 时，程序只打印将要访问的白名单端点，**不发起任何网络请求**。

用途：在隔离网络里对 `DS-K1T671BM` 执行**只读**能力探测，产出可回填 HK-AI-01 证据矩阵与 HK-AI-02 验收报告的结构化数据。

> 本工具不包含、也不允许出现 POST / PUT / PATCH / DELETE 设备调用。

## 只读端点白名单

```text
GET /ISAPI/System/deviceInfo
GET /ISAPI/AccessControl/capabilities
GET /ISAPI/AccessControl/UserInfo/capabilities?format=json
GET /ISAPI/Intelligent/FDLib/capabilities?format=json
GET /ISAPI/Intelligent/FDLib?format=json
GET /ISAPI/Intelligent/FDLib/Count?format=json
```

路径与查询串**逐字匹配**（不做前缀匹配），任何额外参数、尾随斜杠、`..` 都会被拒绝。

## 快速开始

```bash
cd tools/hikvision-probe
node --test 'test/*.test.mjs'     # 35 项离线测试，无需设备
node cli.mjs                      # dry-run：只打印计划
```

现场执行（**必须经项目负责人确认隔离网络后**）：

```bash
export HIKVISION_PROBE_ALLOW_READ=true
export HIKVISION_PROBE_HOST=192.168.1.64
export HIKVISION_PROBE_ALLOWED_HOSTS=192.168.1.64
export HIKVISION_PROBE_USERNAME='<设备账号>'
export HIKVISION_PROBE_PASSWORD='<设备密码>'
node cli.mjs
```

## 环境变量（只列名称）

| 变量 | 必填 | 说明 |
|---|---|---|
| `HIKVISION_PROBE_ALLOW_READ` | 是（执行时） | 必须为字面量 `true`，否则 dry-run |
| `HIKVISION_PROBE_HOST` | 执行时 | 目标设备地址 |
| `HIKVISION_PROBE_ALLOWED_HOSTS` | 执行时 | 允许访问的主机，逗号分隔；默认取 `HOST` |
| `HIKVISION_PROBE_PORT` | 否 | 默认 `443` |
| `HIKVISION_PROBE_ALLOWED_PORTS` | 否 | 默认 `443,8443` |
| `HIKVISION_PROBE_USERNAME` | 执行时 | ISAPI 账号 |
| `HIKVISION_PROBE_PASSWORD` | 执行时 | 仅用于 Digest 计算，不落盘、不进日志 |
| `HIKVISION_PROBE_CA_PEM` | 否 | 受控 CA 的 PEM 路径（自签名设备必须显式提供） |
| `HIKVISION_PROBE_FINGERPRINT256` | 否 | 证书 SHA-256 指纹固定（与 CA 二选一或并用） |
| `HIKVISION_PROBE_OUT_DIR` | 否 | 报告与原始响应目录，默认系统临时目录 |
| `HIKVISION_PROBE_TIMEOUT_MS` | 否 | 默认 `10000` |
| `HIKVISION_PROBE_MAX_BYTES` | 否 | 默认 `262144` |
| `HIKVISION_PROBE_SALT` | 否 | 主机哈希盐 |

## 安全设计

1. **只读**：方法固定 `GET`，白名单外端点无代码路径可达。
2. **不接受重定向**：任何 3xx 直接判失败，避免被引到其他主机。
3. **证书**：默认校验证书；自签名场景用受控 CA 或指纹固定，**不提供关闭校验的开关**。
4. **超时与体积**：默认 10s、256 KB；超限立即中断。
5. **脱敏**：报告只保留型号、固件、能力节点、计数；IP 打码为 `x.x`，序列号/MAC/账号不进入报告，realm/nonce/cookie/证书主体不输出。
6. **原始响应**：写入权限 `600` 的临时目录，仅用于受控分析，**禁止提交 Git**。

## 报告结构

```json
{
  "generatedAt": "...",
  "target": { "host": "192.168.x.x", "port": 443, "hostFingerprint": "…", "caMode": "system-store" },
  "device": { "model": "DS-K1T671BM", "firmwareVersion": "V3.2.1", "deviceType": "AccessControl" },
  "capabilities": { "acsNodeCount": 5, "faceLibraryManagement": true, "acsFaceRelated": ["isSupportFaceLibrary"] },
  "counts": { "faceRecords": 12, "faceLibraries": 1 },
  "checks": [{ "id": "deviceInfo", "status": 200, "ok": true }],
  "blockers": []
}
```

## 现场执行步骤（2026-11-06）

1. 现场确认为隔离网络，记录设备型号与铭牌信息（不拍照上传）。
2. 准备受控 CA 或证书指纹；不要临时关闭校验。
3. 先 dry-run，确认 6 个端点与目标主机无误。
4. 设置 `HIKVISION_PROBE_ALLOW_READ=true` 执行一次；失败时保留 `checks`，不要反复重试。
5. 把 `report.json` 回填 HK-AI-01 证据矩阵的"目标设备 capability"列。
6. 分析完成后删除临时目录；原始响应不入库、不外发。

## 测试覆盖（35 项）

- Digest：RFC 2617 标准向量、qop 退化、挑战解析、nonce 递增
- 白名单：路径逐字匹配、穿越、查询串、主机、端口、方法
- 探针：dry-run 零请求、401→挑战→重试、认证失败、证书错误、超时、空能力、畸形 JSON、近似型号不支持、响应类型不符、越权主机拒绝、缺凭据拒绝
- 报告/脱敏：IP/MAC/序列号/账号/realm/nonce 不出现

## 已知限制

- 真实设备的能力集标签名可能与 fixture 不同；解析器按"任意 `<tag>true</tag>`"收集，不会因未知标签失败，但 `faceLibraryManagement` 的判定依赖名称含 `FaceLibrary`/`FDLib`。
- 仅实现 Digest；若设备只接受 Basic 或需要先登录 SDK，本工具会明确失败而不是降级。
- 未做并发；6 个端点串行请求，避免对门禁设备造成额外负载。
