# HIKVISION DS-K1T671BM 厂商能力核对

- 适用任务：LOCK-01A（海康 DS-K1T671BM 门禁人脸录入接入）
- 状态：调研稿（待厂商资料补充，未进入真实设备联调）
- 设备型号锁定：`DS-K1T671BM`
- 本轮访问日期：2026-11-03（Asia/Shanghai）
- 原则：只采信海康官方来源；无法证实的一律标"待厂商确认"，不补全、不猜测。

## 0. 结论速览

1. 厂商主体：杭州海康威视数字技术股份有限公司；`DS-K1T671` 系列在官网归入 **Face Recognition Terminal / Pro-Series**（门禁人脸终端）。"BM" 精确子型号的规格页与固件版本本轮未取得，**待厂商确认**。
2. 接入路线存在两条官方路线：**设备侧 ISAPI（HTTP 直连）** 与 **平台侧（HikCentral Professional OpenAPI / 综合安防管理平台）**，另有面向桌面的 **HCNetSDK（NET_DVR）**。开放平台官方接口定义已把 NET_DVR 命令映射到 ISAPI URL，说明两条路线同源。
3. 官方接口定义已公开 **人脸库(FDLib) ISAPI 端点**（新增/删除/修改/查询），但**人员、权限计划、事件订阅的完整端点集合与认证细节**需以 DS-K1T671BM 对应固件的官方 ISAPI 指南为准，本轮**资料不足，不最终锁定厂商接口细节**。
4. 推荐路线（待官方文档确认后定稿）：**优先验证"设备侧 ISAPI + 受控内网代理"**，备选"海康综合安防平台 OpenAPI"。

## 1. 官方资料入口与访问记录

| 入口 | 地址 | 本轮状态 | 备注 |
| --- | --- | --- | --- |
| 海康威视官网 | <https://www.hikvision.com/cn/> | 已访问（200） | 产品/服务与支持 |
| 海康开放平台 | <https://open.hikvision.com/> | 已访问（200） | 硬件接口定义、开放 API |
| 技术合作伙伴平台 TPP | <https://tpp.hikvision.com/> | 已访问（200） | 文档/SDK 下载（需合作伙伴权限） |
| DS-K1T671 系列产品页 | <https://www.hikvision.com/au-en/products/Access-Control-Products/Face-Recognition-Terminals/Pro-Series/ds-k1t671/> | 已访问（200） | 确认系列归属与多模态能力 |
| 官方接口定义（人脸库映射） | <http://open.hikvision.com/hardware/v2/接口定义/NET_DVR_SendWithRecvRemoteConfig(ACS_USERFACE).html> | 已访问（200，GBK 编码） | NET_DVR→ISAPI 映射表，见 §2 |
| DS-K1T671 固件门户 | <https://www.hikvisioneurope.com/uk/portal/>（Product Firmware / Access Control / Terminal / DS-K1T671） | 检索定位，未下载 | 需登录/资质后核对具体版本 |
| HikCentral Professional OpenAPI 指南 | HikCentral Professional OpenAPI V2.6.1 Developer Guide（pinfo.hikvision.com） | 检索定位，未下载 | 平台路线的官方依据 |

> 访问记录要求见任务卡 §1.1：报告须记录实际访问日期、文档名称、版本号与来源。以上为本轮实测；后续下载的 PDF/接口包需补充文件名、版本、发布日期与原链接，且不得把需登录的资料重新公开到仓库。

## 2. 已核实事实（仅官方来源）

| # | 事实 | 出处 | 状态 |
| --- | --- | --- | --- |
| F1 | DS-K1T671 属于 Face Recognition Terminal / Pro-Series（门禁人脸终端） | hikvision.com 产品页 | 已确认 |
| F2 | 该系列支持多模态认证：人脸、指纹、卡、掌静脉、虹膜、蓝牙/QR/NFC | hikvision.com 产品页 | 已确认 |
| F3 | 官方开放平台接口定义存在"人脸库(FDLib)"操作，且给出 ISAPI 端点：查询 `POST /ISAPI/Intelligent/FDLib/FDSearch?format=json`；新增 `POST /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json`；设置 `PUT /ISAPI/Intelligent/FDLib/FDSetUp?format=json`；修改 `PUT /ISAPI/Intelligent/FDLib/FDSearch?format=json&FDID=1&FPID=&faceLibType=blackFD` | open.hikvision.com 接口定义（ACS_USERFACE 映射表） | 已确认（端点存在，具体字段/该型号是否全开待确认） |
| F4 | 官方接口定义存在事件通知 `EventNotificationAlert`（version 2.0）XML 结构 | open.hikvision.com 接口定义 PDF | 已确认（事件订阅机制存在，具体接入方式待确认） |
| F5 | 存在 DS-K1T671（非测温）固件下载门户；系列区分测温/非测温版本 | hikvisioneurope.com 门户 | 已确认（版本号待确认） |
| F6 | 平台侧存在 HikCentral Professional OpenAPI（Developer Guide V2.6.1） | pinfo.hikvision.com | 已确认（平台路线存在） |
| F7 | ISAPI 为海康设备侧 HTTP 集成协议，配套"安全服务/认证"配置（摘要认证） | 官方手册（enpinfo.hikvision.com） | 已确认（认证细节按型号/固件待确认） |

## 3. 按任务卡 §3 十项逐条核对

| # | 核对项 | 本轮结论 | 依据 / 待确认点 |
| --- | --- | --- | --- |
| 1 | 产品系列、厂商主体、SDK/API/ISAPI 名称 | 部分确认 | 厂商与系列已确认（F1）；具体 API 包名称与版本待厂商确认 |
| 2 | 人脸能力、固件、拓扑、控制器/平台、联网 | 部分确认 | 人脸+多模态已确认（F2）；固件版本、是否需要控制器/综合安防平台待确认；以太网 TCP/IP |
| 3 | 人脸录入方式（服务端 API/蓝牙/设备本地/厂商 App） | 部分确认 | 官方存在平台下发人脸库的 ISAPI 端点（F3）；DS-K1T671BM 是否开放平台下发、是否还支持本地采集，待确认 |
| 4 | 图片/特征值、格式/大小/分辨率/角度/质量 | 待厂商确认 | 需 DS-K1T671BM 官方 ISAPI 指南给字段定义 |
| 5 | 新增/更新/删除/查询/批量/有效期接口 | 部分确认 | 增删改查有官方 FDLib 端点（F3）；批量与"有效期"语义待确认 |
| 6 | 异步任务/回调/轮询/错误码/限频/幂等/离线 | 部分确认 | 事件通知结构存在（F4）；错误码、限频、幂等、离线行为待确认 |
| 7 | 设备/人员编号/人脸凭证/权限组/楼栋标识规则 | 待厂商确认 | 需官方 ISAPI 指南 |
| 8 | 测试环境/设备/应用审核/IP 白名单/签名/密钥轮换 | 待厂商确认 | 需 TPP 企业注册/合作伙伴权限 |
| 9 | 数据地域/隐私条款/人脸保存与删除 | 待厂商确认 | 需官方隐私与合规说明 |
| 10 | 接口费用/调用配额/设备许可 | 待厂商确认 | 需商务/TPP 确认 |

## 4. 接入路线分析

| 路线 | 说明 | 官方依据 | 对本项目影响 |
| --- | --- | --- | --- |
| A 设备侧 ISAPI | 业务服务器经受控内网代理直连门禁终端 HTTP(S)，摘要认证 | F3/F4/F7 | 最贴近"独立适配层"目标；不依赖综合安防平台；必须受控内网代理，公网/小程序不得直连设备 IP |
| B 平台侧 OpenAPI | HikCentral Professional（综合安防平台）统一管理设备，业务侧对接平台 | F6 | 需部署/采购综合安防平台；多设备统一管理更省心；增加一层依赖与成本 |
| C 硬件 SDK（HCNetSDK/NET_DVR） | 桌面/服务端 SDK，与 ISAPI 同源映射 | F3 映射表 | 适合 C++/桌面集成；本项目为 Node 服务端，优先排除 |

**本轮结论（任务卡 §9 要求明确表态）：** 当前资料不足，**不最终锁定**任一具体厂商接口细节。推荐**优先验证路线 A（设备侧 ISAPI + 受控内网代理）**、以路线 B 为备选；待取得 DS-K1T671BM 官方 ISAPI 指南与固件版本后再定稿，并在报告中固化选择依据。

## 5. 需向厂商/项目负责人索取并核对的官方资料

1. DS-K1T671BM 官方产品规格书、用户手册、最新固件说明（含固件版本号与发布日期）。
2. 与该型号/固件匹配的门禁人脸终端 ISAPI 开发指南（人员、卡、人脸、权限计划、门状态、事件订阅）。
3. HikCentral Professional OpenAPI 指南（若走平台路线）。
4. 认证方式：摘要认证/平台 OAuth/签名规则、回调或事件订阅机制。
5. 是否必须通过海康综合安防管理平台，是否允许业务服务器直连设备。
6. 中国大陆"BM"型号与国际同系列型号是否存在接口差异。

## 6. 风险 / 费用 / 测试设备 / 合规

见同目录 [HIKVISION-DS-K1T671BM-RISKS.md](HIKVISION-DS-K1T671BM-RISKS.md)。

## 7. 待厂商确认清单

汇总至 [HIKVISION-DS-K1T671BM-RISKS.md](HIKVISION-DS-K1T671BM-RISKS.md) 的 §4 主清单，按编号跟踪。
