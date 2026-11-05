# HK-AI-02：海康只读 capability 探针

优先级：P0
执行者：DeepSeek Harness
复审者：Codex
基准分支：`docs/lock-01-fast-track`
建议分支：`feat/hk-isapi-capability-probe`
预计：1～2 个工作日开发；真人网络任务完成后执行
真人任务开始：2026-11-06。

## 目标

实现一个默认离线、显式授权后才允许读取目标设备 capability 的安全探针。今天只开发和测试，不连接任何真实设备；11月6日现场人员准备隔离网络后再执行。

## 允许的只读接口

```text
GET /ISAPI/System/deviceInfo
GET /ISAPI/AccessControl/capabilities
GET /ISAPI/AccessControl/UserInfo/capabilities?format=json
GET /ISAPI/Intelligent/FDLib/capabilities?format=json
GET /ISAPI/Intelligent/FDLib?format=json
GET /ISAPI/Intelligent/FDLib/Count?format=json
```

## 任务

1. 实现 HTTPS + RFC 7616 Digest 客户端。
2. 默认 dry-run；只有 `HIKVISION_PROBE_ALLOW_READ=true` 才能发送只读请求。
3. 主机、端口和路径使用严格白名单，禁止重定向到其他主机。
4. 设置连接/读取超时、最大响应大小和内容类型检查。
5. 输出型号、固件、能力节点、容量和支持函数的结构化报告。
6. 自动脱敏 IP、序列号、MAC、用户名、realm、nonce、cookie、证书主体和唯一设备标识。
7. 原始响应只进入受控临时目录；Git 只提交脱敏 fixture。
8. 使用离线 fixture 覆盖认证失败、证书错误、超时、空能力、畸形 JSON/XML、近似型号但能力不支持。

## 强制安全边界

- 本任务不得出现 POST、PUT、PATCH 或 DELETE 设备调用。
- 不得把设备密码写入参数、日志、测试 fixture 或 Git。
- 不得关闭证书校验来绕过问题；自签名证书须使用受控 CA/指纹方案并记录决定。
- 未经真人现场确认，不得执行探针。

## 证书决策（Codex，2026-11-05）

首台隔离网络试点设备采用 **SHA-256 叶证书指纹固定**。指纹必须由现场人员通过可信的线下渠道取得并复核，禁止首次网络连接自动信任（TOFU）；不匹配时必须 fail closed。实现需支持当前、下一枚双指纹的短期轮换窗口，并在联调记录中登记设备编号（脱敏）、固件版本、指纹类型、复核人、复核时间和轮换时间。

批量部署阶段再迁移到受控私有 CA。任何模式均不得提供“跳过全部 TLS 校验”的运行开关。

当前 `feat/hk-isapi-capability-probe@8ceb8a5` 尚未满足该决策：`rejectUnauthorized: true` 会让现场自签名证书在指纹比较前因证书链不受信而失败。修复后必须用本地自签名 TLS 服务覆盖正确指纹成功、错误指纹失败、无指纹失败、重定向失败四类集成测试，才可执行现场探针。

## 验收

- dry-run 默认不产生网络请求。
- 非白名单端点和主机被拒绝。
- 报告可用于 HK-AI-01 更新目标设备证据列。
- 所有自动测试无需真实设备即可运行。

## 完成回复

```text
完成：HK-AI-02（开发/离线测试）
分支/提交：
只读白名单：
测试结果：
真实设备是否执行：否（等待11月6日真人任务）
执行所需环境变量名称（不含值）：
未关闭阻碍：
```

