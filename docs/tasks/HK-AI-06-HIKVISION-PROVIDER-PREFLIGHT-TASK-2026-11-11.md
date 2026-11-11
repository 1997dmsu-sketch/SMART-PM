# HK-AI-06：真实 Hikvision Provider 上线前置框架任务卡

优先级：P0  
建议执行：Provider／安全专职 Agent  
架构与复审：Codex  
状态：**仅放行默认关闭的框架、配置、内网代理契约与离线测试骨架；真实端点映射、设备连接和设备写继续关闭。**

## 1. 目的

为未来真实 Hikvision Provider 建立可复审的安全外壳，使后续取得目标设备证据后能够在不改公共 `FaceAccessProvider` 契约的前提下补入经批准的端点映射。

本卡不证明 DS-K1T671BM 支持任何写能力，不决定设备 ISAPI、海康平台 OpenAPI 或管理平台路线，也不授权向真实设备发送请求。

当前证据基线：

- `docs/devices/HIKVISION-ISAPI-PROVIDER-WHITELIST.json`：`routeDecision=undecided`；
- `providerReleaseApproved=false`；
- `allowDeviceOperations=false`；
- 27 个候选端点均为 `allowedNow=false`；
- 目标 capability 0/27、真实调用 0/27；
- HK-AI-02 代码 `f15160d` 仅通过离线复审，仍等待三方签字与一次性只读窗口。

## 2. 本阶段允许交付

### 2.1 Provider 选择与失败关闭

实现或冻结 Provider 工厂的选择规则：

- `demo/test + mock` 保持既有行为；
- `live + hikvision` 在本阶段一律返回 `503 NOT_CONFIGURED`；
- 缺少 mode/provider、未知 provider、`live + mock`、运行中切换 provider 均失败关闭；
- 不允许因真实 Provider 未配置而回退 Mock、demo 或“成功”结果；
- Mock 的 `evidenceScope=simulated` 与 `deviceEffective=false` 不得改变。

不得为了通过测试创建会返回伪造成功的 `HikvisionFaceAccessProvider`。

### 2.2 受控内网代理契约

只定义传输抽象和输入／输出边界，不实现实际 Hikvision URL 或路径：

- 应用服务不得从小程序、浏览器或公开 HTTP 直接连接设备；
- 真实 Provider 未来只能调用部署在受控内网的代理；
- 代理请求只接受服务端生成的 `operationId/jobId/deviceRef/action/requestDigest` 与最小业务载荷；
- 禁止客户端提交 host、port、URL、端点路径、认证头、证书指纹或厂商原始参数；
- 传输响应只允许规范化为 `accepted/succeeded/RETRYABLE/TERMINAL/UNKNOWN_RESULT` 及最小关联字段；
- 原始设备响应、Digest challenge、cookie、证书主体、序列号、MAC、IP 和人脸字节不得进入普通 DTO 或业务日志。

内网代理身份认证方式、网络通道和部署拓扑在本阶段只保留接口，不自行决定 mTLS、VPN、专线或平台网关。

### 2.3 Secret 与设备身份接口

只定义不透明 secret／identity provider：

- 凭据、叶证书指纹、设备地址只能由受控 secret provider 按内部 `deviceRef` 取得；
- 业务数据库、Git、命令行参数、普通环境转储和日志不得保存明文；
- Provider 只持有短生命周期引用或句柄，不返回秘密值；
- 缺少秘密、秘密版本不匹配、设备身份材料缺失时统一失败关闭；
- 不提供“跳过 TLS”“首次连接自动信任”“降级 Basic/明文 HTTP”等开关。

不得将 HK-AI-02 的探针环境变量直接复用为生产 Provider 的秘密管理方案。

### 2.4 双门禁与 kill switch

定义独立、默认关闭且不可由业务请求覆盖的运行门禁：

1. 发布门禁：Provider 已由独立复审批准；
2. 设备操作门禁：本部署明确允许设备操作；
3. kill switch：运维可单向关闭新下发，不影响查询、审计和撤权告警读取。

本阶段三者的有效结果必须恒为关闭；任何缺失、非法或互相矛盾的配置均 `503 NOT_CONFIGURED`，并保证：

- Provider／代理网络调用次数为 0；
- grant/job/log/op key 不因配置错误产生部分写入；
- 不改变既有 `providerReleaseApproved=false`、`allowDeviceOperations=false` 和全部 `allowedNow=false`。

不得把 kill switch 设计成业务用户、HTTP 请求或前端可切换字段。

### 2.5 观测、审计与错误脱敏

定义结构化观测字段白名单：

- 可记录：`orgId`、内部 `deviceId/deviceRef`、`jobId`、action、状态迁移、attempt、租约 owner、延迟分桶、规范化错误类、配置版本；
- 不可记录：密码、认证头、realm、nonce、cookie、完整指纹、设备地址、序列号、MAC、证书主体、原始响应、人脸图片或摘要；
- 发送前失败、发送后未知、超时、断线、解析错误必须可区分；
- 发送后是否到达设备无法证明时只能进入 `UNKNOWN_RESULT/awaiting_result`，禁止自动重放写操作；
- 所有 kill switch、配置拒绝和 secret 失败都要产生脱敏安全事件。

本阶段不得开放 live 网络回调；真实事件鉴权和防重放证据取得前，live event 继续 `NOT_CONFIGURED`。

## 3. 离线测试骨架

测试必须使用纯本地 fake transport／fake secret provider，禁止 DNS、TCP、TLS 或 HTTP 访问。至少覆盖：

1. live Provider 默认 `NOT_CONFIGURED`，网络调用 0；
2. 发布门禁关闭、设备门禁关闭、kill switch 开启分别拒绝；
3. 缺配置、非法配置和配置矛盾均失败关闭；
4. 不得从请求输入 host、port、URL、path 或认证材料；
5. secret 缺失、过期、版本不符时零网络、零部分业务写入；
6. fake transport 的发送前失败映射 `RETRYABLE`；
7. fake transport 的发送后断连／超时映射 `UNKNOWN_RESULT`，不自动重放；
8. 明确终态错误映射 `TERMINAL`；
9. 日志、错误、DTO 和审计记录敏感字段扫描零命中；
10. live event／回调入口保持 `NOT_CONFIGURED`；
11. demo/test Mock 回归不变；
12. 小程序 `allowDeviceOperations=false` 回归不变。

测试不得虚构任何厂商错误码、FDID、door 编号、图片约束或端点响应。

## 4. 明确禁止

- 不连接真实设备、海康平台或生产云；
- 不设置 `HIKVISION_PROBE_ALLOW_READ=true`；
- 不新增任何实际 GET/POST/PUT/PATCH/DELETE 厂商路径；
- 不把 27 个候选端点改为 `allowedNow=true`；
- 不实现 enroll/update/revoke/query 的真实 HTTP 请求；
- 不猜测 Digest qop、HTTPS 端口、FDID、door 权限、图片格式／容量、事件签名或错误码；
- 不采集、生成、上传或提交真实人脸；
- 不修改 `createGrant()`、H2-c、H3/H4 或 HTTP 业务接线；
- 不开启前端或小程序设备写开关；
- 不合并 main，不部署，不制作“真实 Provider 已完成”的演示。

## 5. 必须等待现场只读证据后才能定稿

以下内容不得在本卡中填值或自行裁定：

1. 完整目标型号、固件与设备时间／NTP 状态；
2. 设备 ISAPI、海康平台 OpenAPI 或管理平台的最终路线；
3. 实际 HTTPS 端口、Digest 算法/qop 与认证失败语义；
4. 人脸库能力、FDID、用户／人脸／门权限的真实字段和容量；
5. 图片 MIME、尺寸、大小、质量和尾随载荷约束；
6. enroll/query/update/revoke 的真实端点、方法、请求体与响应体；
7. 重定向、超限、内容类型异常、设备错误码与未知结果的真实映射；
8. 事件来源、签名、唯一 ID、顺序、防重放窗口和设备回执可信度；
9. 删除后无残留、离线恢复和设备／平台一致性的真实证据；
10. Provider 发布批准、设备操作放行和正式回退点。

上述内容只有在 HK-AI-02 三方签字、一次性六 GET 完成、证据矩阵和白名单回填并再次复审后，才可进入独立的“端点冻结与真实 Provider 实现”任务卡。

## 6. 交付与验收

交付应拆分为独立提交：

1. Provider 选择／配置与默认关闭测试；
2. 内网代理、secret、kill switch 接口及 fake 实现；
3. 脱敏观测与失败分类测试；
4. 自审报告，列出所有仍为占位且等待现场证据的接口。

验收标准：

- 所有测试离线运行且网络调用为 0；
- 无实际厂商端点、凭据、设备地址、指纹或人脸内容进入 Git；
- live Provider 始终 `NOT_CONFIGURED`；
- `providerReleaseApproved=false`、`allowDeviceOperations=false`、27 个 `allowedNow=false` 保持；
- Mock、H2-c、现有权限和状态机回归全绿；
- 代码和文档不得宣称真实 Provider、设备联调或正式上线已经完成。

## 7. 完成回报模板

```text
完成：HK-AI-06 Provider 上线前置框架
分支/提交：
改动范围：
离线测试：
网络/设备调用：0
Provider 发布门禁：关闭
设备操作门禁：关闭
kill switch 默认状态：关闭新下发
敏感字段扫描：
等待现场证据的占位接口：
未关闭阻碍：
```
