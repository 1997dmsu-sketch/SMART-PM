# HK-AI-02 完成说明（开发 / 离线测试，第二轮整改）

```text
完成：HK-AI-02（开发/离线测试；P0 指纹模式已整改）
分支/提交：feat/hk-isapi-capability-probe（已 rebase 到 docs/lock-01-fast-track@1358ef5）
只读白名单：6 个 GET 端点（deviceInfo / AccessControl.capabilities / UserInfo.capabilities / FDLib.capabilities / FDLib / FDLib.Count）
测试结果：46/46 通过（含 10 项真实本地自签名 TLS 集成测试）
真实设备是否执行：否（复审通过前禁止连接现场设备）
执行所需环境变量名称：HIKVISION_PROBE_ALLOW_READ / HOST / ALLOWED_HOSTS / PORT / ALLOWED_PORTS /
  USERNAME / PASSWORD / FINGERPRINT256（当前,下一枚）/ OUT_DIR / TIMEOUT_MS / MAX_BYTES / SALT
未关闭阻碍：无（等待 Codex 复审）；真实能力集标签名仍需现场人工核对
```

## 针对复审 P0 的整改

| 复审要求 | 实现 |
|---|---|
| 自签名证书不能被系统信任链提前拒绝 | 指纹模式下 `rejectUnauthorized=false` + **自有叶证书指纹校验**；非指纹模式仍强制系统信任链 |
| 指纹错误或缺失 fail closed | 取不到证书或指纹不匹配 → `FINGERPRINT_MISMATCH`，在 `secureConnect` 阶段销毁连接，**请求不会发出**（测试断言服务端未收到请求） |
| 不提供"跳过全部 TLS 验证"的配置 | 只有两种状态：系统信任链 / 指纹固定；无 `insecure`、`rejectUnauthorized=false` 的环境变量入口 |
| 当前 + 下一枚双指纹轮换 | `HIKVISION_PROBE_FINGERPRINT256` 逗号分隔，顺序即「当前, 下一枚」；报告 `target.pinnedSlot` 标明命中哪一枚 |
| 过期证书 | 解析 `valid_to`，过期仅写入报告 `warnings`，**不阻断**（复审决定） |
| 常量时间比较 | `crypto.timingSafeEqual` 比较 32 字节 SHA-256 摘要，任一长度不符直接不匹配 |
| 真实 TLS 集成测试，不得只注入模拟错误 | 新增 `test/tls.test.mjs`：本地 HTTPS 服务 + 两份自签名证书 fixture，覆盖正确/错误/缺失指纹、轮换、重定向、体积上限、超时 |

## 测试矩阵（44 项）

| 组 | 数量 | 内容 |
| --- | --- | --- |
| Digest | 7 | RFC 2617 标准向量、qop 退化、挑战解析、nonce 递增 |
| 白名单 | 9 | 路径逐字匹配、穿越、查询串、主机、端口、方法 |
| 探针 | 13 | dry-run 零请求、401→挑战→重试、认证失败、证书错误、超时、空能力、畸形 JSON、近似型号、类型不符、越权主机、缺凭据 |
| 报告/脱敏 | 8 | IP/MAC/序列号/账号/realm/nonce 不出现 |
| **真实 TLS** | **8** | 正确指纹 200、错误指纹拒发请求、无指纹仍走系统信任链、双指纹轮换 slot=1、302 拒绝、TOO_LARGE、TIMEOUT |

## 分支整改进说明

原分支基于旧任务文档，合并会删除 `HK-AI-01-EVIDENCE-MATRIX.md` 与分工记录。已 **rebase 到 `docs/lock-01-fast-track@1358ef5`**（含复审记录与 TLS 决策），rebase 后测试全绿。

## 现场执行前置（不变）

1. 指纹必须由现场人员**线下核验**（设备 Web 页面或铭牌旁证书信息），禁止首次连接自动信任。
2. 执行时 `HIKVISION_PROBE_FINGERPRINT256` 填「当前, 下一枚」。
3. 仍不连接生产云、不写设备、不采集人脸。

## 安全边界（不变）

- 只读 GET，六个白名单端点，路径逐字匹配；
- 越权主机/端口在发请求前拒绝；
- 拒绝重定向、响应体积上限、内容类型检查；
- 报告脱敏 IP/序列号/MAC/账号/realm/nonce/cookie；
- 原始响应写入 600 权限临时目录，Git 只提交测试 fixture（自签名证书为测试专用，非现场材料）。
