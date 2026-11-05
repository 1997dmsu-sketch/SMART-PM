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
node --test 'test/*.test.mjs'     # 55 项离线测试（Windows 跳过 3 项 POSIX 权限用例），无需设备
node cli.mjs                      # dry-run：只打印计划
```

现场执行（**必须经项目负责人确认隔离网络并签署批准栏后**）。密码不写进命令历史，
用无回显读取注入；本试点固定使用指纹模式，**必须**提供预批准型号与叶证书指纹：

```bash
read -rsp '设备密码: ' HIKVISION_PROBE_PASSWORD; echo
export HIKVISION_PROBE_PASSWORD
export HIKVISION_PROBE_ALLOW_READ=true
export HIKVISION_PROBE_HOST=192.168.1.64
export HIKVISION_PROBE_ALLOWED_HOSTS=192.168.1.64
export HIKVISION_PROBE_USERNAME='<设备账号>'
export HIKVISION_PROBE_EXPECTED_MODEL='DS-K1T671BM'
export HIKVISION_PROBE_FINGERPRINT256='<线下核验的当前指纹>[,<下一枚>]'
node cli.mjs
unset HIKVISION_PROBE_PASSWORD HIKVISION_PROBE_ALLOW_READ
```

执行顺序固定：先 `deviceInfo` 校验完整型号，一致后才继续其余五个端点；任何安全/传输
错误立即中止，不会"跑完全部再看结果"。

## 环境变量（只列名称）

| 变量 | 必填 | 说明 |
|---|---|---|
| `HIKVISION_PROBE_ALLOW_READ` | 是（执行时） | 必须为字面量 `true`，否则 dry-run |
| `HIKVISION_PROBE_HOST` | 执行时 | 目标设备地址 |
| `HIKVISION_PROBE_ALLOWED_HOSTS` | 执行时 | 允许访问的主机，逗号分隔；默认取 `HOST` |
| `HIKVISION_PROBE_PORT` | 否 | 默认 `443` |
| `HIKVISION_PROBE_ALLOWED_PORTS` | 否 | 默认 `443,8443` |
| `HIKVISION_PROBE_USERNAME` | 执行时 | ISAPI 账号 |
| `HIKVISION_PROBE_PASSWORD` | 执行时 | 仅用于 Digest 计算，不落盘、不进日志；示例用无回显读取 |
| `HIKVISION_PROBE_EXPECTED_MODEL` | **执行时必填** | 预批准的完整型号；缺失即拒绝执行，`deviceInfo` 型号不一致立即中止 |
| `HIKVISION_PROBE_FINGERPRINT256` | **试点必填** | 已线下核验的叶证书 SHA-256 指纹，**逗号分隔**，顺序为「当前, 下一枚」，支持轮换 |
| `HIKVISION_PROBE_CA_PEM` | 否 | 受控 CA（批量部署迁移时使用；试点阶段以指纹为准） |
| `HIKVISION_PROBE_OUT_DIR` | 否 | 报告与原始响应目录，默认系统临时目录；**既有目录会被强制收紧为 0700，失败即终止** |
| `HIKVISION_PROBE_TIMEOUT_MS` | 否 | 默认 `10000` |
| `HIKVISION_PROBE_MAX_BYTES` | 否 | 默认 `262144` |
| `HIKVISION_PROBE_SALT` | 否 | 主机哈希盐 |

## 安全设计

1. **只读**：方法固定 `GET`，白名单外端点无代码路径可达。
2. **不接受重定向**：任何 3xx 直接判失败，避免被引到其他主机。
3. **证书**：默认走系统信任链；自签名场景用**线下核验的 SHA-256 叶证书指纹固定**（可配当前+下一枚，常量时间比较，错误或缺失即终止）。**不提供关闭校验的开关**：要么系统信任链，要么指纹固定。证书过期**只告警不阻断**（复审决定，报告 `warnings`）。
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

## 测试覆盖（55 项，Windows 下 3 项 POSIX 权限用例跳过）

- Digest：RFC 2617 标准向量、qop 退化、挑战解析、nonce 递增
- **真实 TLS**：本地自签名服务 + 正确/错误/缺失指纹、双指纹轮换、重定向、体积、超时
- 白名单：路径逐字匹配、穿越、查询串、主机、端口、方法
- **fail-fast**：型号缺失/不一致/解析为空 → 只发 1 次请求即中止；第二次 401、不可解析挑战、指纹错误、重定向、超时、超限、内容类型异常 → 中止后续端点
- **输出目录**：既有 0755 目录被收紧为 0700；报告/原始响应 0600；权限失败即终止
- 探针：dry-run 零请求、401→挑战→重试、空能力/畸形 JSON 不中断、越权主机拒绝、缺凭据拒绝
- 报告/脱敏：IP/MAC/序列号/账号/realm/nonce 不出现

## 已知限制

- 真实设备的能力集标签名可能与 fixture 不同；解析器按"任意 `<tag>true</tag>`"收集，不会因未知标签失败，但 `faceLibraryManagement` 的判定依赖名称含 `FaceLibrary`/`FDLib`。
- 仅实现 Digest；若设备只接受 Basic 或需要先登录 SDK，本工具会明确失败而不是降级。
- 指纹模式不额外校验证书有效期与主机名（安全边界由预共享指纹承担）；指纹须线下核验，禁止首次连接自动信任。
- 未做并发；6 个端点串行请求，避免对门禁设备造成额外负载。
