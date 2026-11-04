# HIKVISION DS-K1T671BM 厂商能力核对（返工稿）

- 适用任务：LOCK-01A
- 版本：第二轮，回应 `docs/devices/LOCK-01A-REVIEW.md` 的 F01
- 设备型号：`DS-K1T671BM`
- 访问日期：2026-11-04（Asia/Shanghai）
- 结论：**路线未定**。在 Q1/Q3/Q4/Q5/Q6 关闭前，不认定该型号已开放任一具体人脸接口。

## 0. 结论速览

1. 已核实的只有"海康生态存在"层面（§2.1）：存在人脸识别终端产品线、开放平台接口定义中出现人脸库(FDLib)相关 ISAPI 端点、存在事件通知结构、存在固件门户与平台 OpenAPI。
2. "`DS-K1T671BM` + 目标固件已验证"：**本轮 0 条**（§2.2）。
3. 设备侧 ISAPI 与平台 OpenAPI 都只是**候选路线**，不是结论；本轮不选路线。
4. 精确型号规格、固件版本、对应 ISAPI 指南均未取得，按任务卡要求全部标"待厂商确认"。

## 1. 官方入口与访问记录

| 入口 | URL | 访问时间 | HTTP | 字节 | 抓取快照 SHA-256 |
| --- | --- | --- | --- | --- | --- |
| 海康官网 | https://www.hikvision.com/cn/ | 2026-11-04 | 200 | 406200 | 0410164d75ea2b2f4c92fbc3ae5f329fb8d305dfa8f7821a9df31ddffd8854c3 |
| 开放平台 | https://open.hikvision.com/ | 2026-11-04 | 200 | 55510 | 085cd330766f7c8f86bd3c0596ba7fd1eb9f3769ac3de1bc424fd3af7723dcfa |
| 技术合作伙伴平台 TPP | https://tpp.hikvision.com/ | 2026-11-04 | 200 | 169162 | 5ab6c32ac25eca28e1545429679fdf7a36dba08a7f90bfd23982f5e49d891d0d |
| 人脸识别终端分类页 | https://www.hikvision.com/au-en/products/Access-Control-Products/terminals/face-recognition-terminal/ | 2026-11-04 | 200 | 1113021 | 7a7603c8d5773ca743550fe04b1afb9dc25cf9ec1faca82c3fcda9894589e297 |
| ACS_USERFACE 接口定义页 | https://open.hikvision.com/hardware/v2/%e6%8e%a5%e5%8f%a3%e5%ae%9a%e4%b9%89/NET_DVR_SendWithRecvRemoteConfig(ACS_USERFACE).html | 2026-11-04 | 200 | 4403 | 30a4a8a4c25714ace35e6ae6b28ae63221db955ea93c8cad60040983dde78495 |

注：

- SHA-256 为**在线页面抓取快照**摘要，不是官方文件存档。官方 PDF/SDK 未下载（需登录或合作伙伴权限），取得后按 §6 补元数据。
- 请求型号页 `.../Pro-Series/ds-k1t671/` 时被重定向到**分类页** `.../terminals/face-recognition-terminal/`，即本轮没有取得型号专用规格页。

## 2. 证据分级

### 2.1 生态/系列存在（泛化证据，不能证明 `DS-K1T671BM`）

| ID | 事实 | 出处 | 为什么不能算 BM 已确认 |
| --- | --- | --- | --- |
| E1 | 海康存在人脸识别终端（Face Recognition Terminal）产品线 | 分类页快照 | 分类页不绑定具体型号 |
| E2 | 产品/分类页列举多模态认证：人脸、指纹、卡、掌静脉、虹膜、蓝牙/QR/NFC | 分类页/产品页 | 系列描述，可能包含其他型号能力；未绑定 BM 与固件 |
| E3 | 官方接口定义 `NET_DVR_SendWithRecvRemoteConfig` 映射表出现人脸库(FDLib) ISAPI 端点：`POST /ISAPI/Intelligent/FDLib/FDSearch?format=json`（查询）、`POST /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json`（新增）、`PUT /ISAPI/Intelligent/FDLib/FDSetUp?format=json`（设置）、`PUT /ISAPI/Intelligent/FDLib/FDSearch?format=json&FDID=1&FPID=&faceLibType=blackFD` | 定义页快照 | 通用接口定义，未绑定 BM/固件；映射表内**未见删除端点**；`blackFD` 属布控库语义，不能等同于门禁人员人脸授权 |
| E4 | 官方接口定义 PDF 出现事件通知 `EventNotificationAlert`（version 2.0） | 接口定义 PDF（检索定位，未下载） | 通用结构；接入方式与 BM 适用性未验证 |
| E5 | 存在 DS-K1T671（非测温）固件下载门户 | 固件门户（检索定位，未下载） | 门户存在不等于版本可用；BM 固件号未取得 |
| E6 | 存在 HikCentral Professional OpenAPI Developer Guide V2.6.1 | 检索定位，未下载 | 平台路线存在；BM 是否必须经平台未验证 |
| E7 | ISAPI 为设备侧 HTTP 集成协议 | 官方手册（检索定位，未下载） | 通用事实；BM 的认证模式与端点未验证 |

### 2.2 `DS-K1T671BM` + 目标固件已验证

| 事实 | 出处 | 状态 |
| --- | --- | --- |
| （本轮 0 条） | — | 未取得精确型号规格页、固件版本、对应 ISAPI 指南 |

## 3. 按任务卡 §3 十项逐条核对

| # | 核对项 | 本轮结论 |
| --- | --- | --- |
| 1 | 产品系列、厂商主体、SDK/API/ISAPI 名称 | 待厂商确认（仅知存在人脸识别终端产品线 E1） |
| 2 | 人脸能力、固件、拓扑、控制器/平台、联网 | 待厂商确认 |
| 3 | 人脸录入方式 | 待厂商确认（生态存在 FDLib 端点不等于 BM 支持） |
| 4 | 图片/特征值、格式/大小/分辨率/角度/质量 | 待厂商确认 |
| 5 | 新增/更新/删除/查询/批量/有效期接口 | 待厂商确认（生态端点无删除；语义未证） |
| 6 | 异步任务/回调/轮询/错误码/限频/幂等/离线 | 待厂商确认（仅知存在 `EventNotificationAlert` 结构） |
| 7 | 设备/人员编号/人脸凭证/权限组/楼栋标识规则 | 待厂商确认 |
| 8 | 测试环境/设备/应用审核/IP 白名单/签名/密钥轮换 | 待厂商确认 |
| 9 | 数据地域/隐私/人脸保存与删除 | 待厂商确认 |
| 10 | 接口费用/调用配额/设备许可 | 待厂商确认 |

## 4. 候选路线（不是结论）

| 路线 | 说明 | 关闭后才可选定的前置项 |
| --- | --- | --- |
| A 设备侧 ISAPI | 业务服务器经受控内网代理直连终端 HTTP(S) | Q3、Q4、Q5、Q6 |
| B 平台 OpenAPI | 经综合安防平台（HikCentral）统一管理 | Q6、Q7、Q9 |
| C 硬件 SDK | HCNetSDK/NET_DVR 桌面/服务端集成 | 本项目为 Node 服务端，排除 |

**决策条件**：Q1（精确型号+固件）、Q3（人员/权限/事件端点）、Q4（认证方式）、Q5（是否允许平台下发人脸）、Q6（是否必须平台）关闭后，才选定路线并记录官方依据；在此之前路线保持"未定"。

## 5. 需向厂商/项目负责人索取

1. `DS-K1T671BM` 官方产品规格书、用户手册、固件说明（含版本号与发布日期）。
2. 与该型号/固件匹配的门禁人脸终端 ISAPI 开发指南。
3. HikCentral Professional OpenAPI 指南（若走平台路线）。
4. 认证方式、回调/事件订阅机制、BM 与国际同系列差异。
5. 测试环境、账号、IP 白名单、密钥轮换与费用配额。

## 6. 证据记录规范

- 每条"已确认"必须同时具备：官方文档标题、版本、发布日期、适用型号/固件、原始 URL、关键章节/页码、文件 SHA-256。
- 受限文档只记录元数据与摘要，不提交原文。
- 在线页面抓取只作快照，须注明抓取时间与最终 URL。
- 无法取得精确型号资料时，保持"路线未定"，不得把 LOCK-01A 标记完成。
