# HIKVISION DS-K1T671BM 厂商能力核对（第三稿）

- 适用任务：LOCK-01A
- 版本：第三轮（2026-11-05 补入设备侧 ISAPI 门禁人脸接口证据）
- 设备型号：`DS-K1T671BM`
- 访问日期：2026-11-04、2026-11-05（Asia/Shanghai）
- 结论：**路线仍未定**。BM 精确型号与固件仍未取得，§2.2 依旧为 0 条；但"门禁一体机"设备侧 ISAPI 的端点、人脸图片硬指标、门禁事件类型已取得官方文档证据，Q3/Q5 的**协议层**问题关闭，剩余为型号适配、认证方式与商务/合规项。

## 0. 结论速览

1. 已核实的是"海康生态存在"层面（§2.1）：人脸识别终端产品线、FDLib 接口映射、事件通知结构、固件门户、平台 OpenAPI。
2. "`DS-K1T671BM` + 目标固件已验证"：**本轮仍为 0 条**（§2.2）。
3. **新增（2026-11-05）**：设备侧"门禁一体机"接口文档可公开取得（《门禁一体机》ISAPI 1.1–1.27、《人员管理(以人为中心)》、《附录D2.1 门禁事件》），端点与字段级要求见 §4。
4. 由此，Q3（人员/权限/事件端点）与 Q5（是否允许平台下发人脸；格式与质量要求）从"待厂商确认"降为**"文档级确认，待型号适配"**；仍不得据此标记 LOCK-01A 完成。
5. 路线 A（设备侧 ISAPI）由此获得**端点级证据**；路线 C（HCNetSDK 原生集成）维持排除。
6. 文档证据是"门禁一体机"通用口径，**不绑定 `DS-K1T671BM`**；按 §7 证据规范，不得把它写成"BM 已确认"。

## 1. 官方入口与访问记录

| 入口 | URL | 访问时间 | HTTP | 字节 | 抓取快照 SHA-256 |
| --- | --- | --- | --- | --- | --- |
| 海康官网 | https://www.hikvision.com/cn/ | 2026-11-04 | 200 | 406200 | 0410164d75ea2b2f4c92fbc3ae5f329fb8d305dfa8f7821a9df31ddffd8854c3 |
| 开放平台 | https://open.hikvision.com/ | 2026-11-04 | 200 | 55510 | 085cd330766f7c8f86bd3c0596ba7fd1eb9f3769ac3de1bc424fd3af7723dcfa |
| 技术合作伙伴平台 TPP | https://tpp.hikvision.com/ | 2026-11-04 | 200 | 169162 | 5ab6c32ac25eca28e1545429679fdf7a36dba08a7f90bfd23982f5e49d891d0d |
| 人脸识别终端分类页 | https://www.hikvision.com/au-en/products/Access-Control-Products/terminals/face-recognition-terminal/ | 2026-11-04 | 200 | 1113021 | 7a7603c8d5773ca743550fe04b1afb9dc25cf9ec1faca82c3fcda9894589e297 |
| ACS_USERFACE 接口定义页 | https://open.hikvision.com/hardware/v2/接口定义/NET_DVR_SendWithRecvRemoteConfig(ACS_USERFACE).html | 2026-11-04 | 200 | 4403 | 30a4a8a4c25714ace35e6ae6b28ae63221db955ea93c8cad60040983dde78495 |
| **《门禁一体机》ISAPI 全文** | https://open.hikvision.com/hardware/v2/08协议透传/门禁一体机.html | 2026-11-05 | 200 | 401080 | 30f733d229806143115e4ab22de2ff567a907b1b7fc361cc949a495bc53898b7 |
| **《人员管理(以人为中心)》** | https://open.hikvision.com/docs/docId?productId=5cda567cf47ae80dd41a54b3&version=%2F16e18c75bd644f1dbf9e8301d6fc9b73&curNodeId=6d952a6cf7894484a6b43c04b865f52f | 2026-11-05 | 200 | 45320 | ff0cd5a57be003cfde5bc2fced435694b0954abc1612df9e32aa4047f636b9fa |
| **《附录D2.1 门禁事件》** | https://open.hikvision.com/docs/docId?productId=5cda567cf47ae80dd41a54b3&version=%2F16e18c75bd644f1dbf9e8301d6fc9b73&curNodeId=fbbe7f3b06b047e0b89aacb5f44b0e69 | 2026-11-05 | 200 | 20998 | 774ae31729495b03b61cda042f0b020b31028bd4c399da753ab202a2f02d25d6 |

注：

- SHA-256 为在线抓取快照摘要，不是官方文件存档；官方 PDF/SDK 仍未下载（需登录或合作伙伴权限）。
- 《人员管理》《附录D2.1》通过开放平台文档接口取得：`GET /api/open/cqsservice/cqs/doc/getById?id=<章节节点ID>&path=`，**当前无需登录**即可返回 Markdown 正文；章节节点 ID 分别为 `6d952a6cf7894484a6b43c04b865f52f`、`fbbe7f3b06b047e0b89aacb5f44b0e69`。
- 该接口公开可读属厂商站点实现现状，仅用于本轮人工核对；不做批量抓取。
- 请求型号页 `.../Pro-Series/ds-k1t671/` 时被重定向到**分类页** `.../terminals/face-recognition-terminal/`，即截至本轮仍未取得型号专用规格页。
- 厂商原文未提交进仓库（版权考虑），仓库只保留元数据、端点清单与结论摘要；本地抓取副本在仓库外留存。

## 2. 证据分级

### 2.1 生态/系列存在（泛化证据，不能证明 `DS-K1T671BM`）

| ID | 事实 | 出处 | 为什么不能算 BM 已确认 |
| --- | --- | --- | --- |
| E1 | 海康存在人脸识别终端（Face Recognition Terminal）产品线 | 分类页快照 | 分类页不绑定具体型号 |
| E2 | 产品/分类页列举多模态认证：人脸、指纹、卡、掌静脉、虹膜、蓝牙/QR/NFC | 分类页/产品页 | 系列描述，可能包含其他型号能力；未绑定 BM 与固件 |
| E3 | 官方接口定义映射表出现人脸库(FDLib) ISAPI 端点：`FDSearch`（查询）、`FaceDataRecord`（新增）、`FDSetUp`（设置）、`FDSearch`（修改） | 定义页快照 | 通用接口定义，未绑定 BM/固件；该映射表内**未见删除端点** |
| E4 | 官方接口定义出现事件通知 `EventNotificationAlert`（v2.0） | 接口定义 PDF | 通用结构；接入方式与 BM 适用性未验证 |
| E5 | 存在 DS-K1T671（非测温）固件下载门户 | 固件门户 | 门户存在不等于版本可用；BM 固件号未取得 |
| E6 | 存在 HikCentral Professional OpenAPI Developer Guide V2.6.1 | 检索定位 | 平台路线存在；BM 是否必须经平台未验证 |
| E7 | ISAPI 为设备侧 HTTP 集成协议 | 官方手册 | 通用事实；BM 的认证模式与端点未验证 |
| **E8** | **"门禁一体机" ISAPI 文档给出 1.1–1.27 节：人脸库增删改查、人员、卡、指纹、能力集、多重认证、群组、抓拍** | 《门禁一体机》快照 | 文档标题为"门禁一体机"通用手册，未出现 `DS-K1T671BM` 字样 |

### 2.2 `DS-K1T671BM` + 目标固件已验证

| 事实 | 出处 | 状态 |
| --- | --- | --- |
| （本轮 0 条） | — | 未取得精确型号规格页、固件版本、型号专用 ISAPI 指南 |

## 3. 按任务卡 §3 十项逐条核对

| # | 核对项 | 本轮结论 |
| --- | --- | --- |
| 1 | 产品系列、厂商主体、SDK/API/ISAPI 名称 | 待厂商确认（仅知存在人脸识别终端产品线 E1） |
| 2 | 人脸能力、固件、拓扑、控制器/平台、联网 | 待厂商确认 |
| 3 | 人脸录入方式 | **文档级确认**：支持服务端下发（`faceURL` 或图片二进制），支持 `modelData` 特征数据；不依赖设备本地采集。待 BM 能力集确认（§4.6） |
| 4 | 图片/特征值、格式/大小/分辨率/角度/质量 | **文档级确认**：JPG/JPEG、≤200KB、宽高 ≤400 万、建议 640×480、两眼间距 >40px、白底无逆光无 PS（§4.3）；支持 6 类特征点随图下发（§4.4） |
| 5 | 新增/更新/删除/查询/批量/有效期接口 | **文档级确认**：人脸 6 个端点（§4.1），人员/卡/指纹端点齐备（§4.2）；未见批量端点、未见人脸级有效期字段（有效期在人员/权限侧） |
| 6 | 异步任务/回调/轮询/错误码/限频/幂等/离线 | **部分确认**：人员与权限删除为异步，需轮询 `UserInfoDetail/DeleteProcess` 至 `success`（§4.5）；建模失败可查；错误码表、限频、离线行为未取得 |
| 7 | 设备/人员编号/人脸凭证/权限组/楼栋标识规则 | **部分确认**：工号为主键（字符串 ≤32 位；以卡为中心时为 1~99999999 整数）；人脸库 `FDID`、`FPID=工号`、`faceLibType`（§4.1）；权限组/楼栋规则未取得 |
| 8 | 测试环境/设备/应用审核/IP 白名单/签名/密钥轮换 | 待厂商确认 |
| 9 | 数据地域/隐私/人脸保存与删除 | 待厂商确认 |
| 10 | 接口费用/调用配额/设备许可 | 待厂商确认 |

## 4. 设备侧 ISAPI 端点证据（文档级）

来源：《门禁一体机》ISAPI 全文（1.1–1.27）与《人员管理(以人为中心)》。以下均为**设备侧路径**，与 HCNetSDK 文档中"URL 字符串"参数一致；走 SDK 时由 `NET_DVR_STDXMLConfig` / `NET_DVR_StartRemoteConfig` 承载，走直连时即普通 HTTP 请求。

### 4.1 人脸端点

| 动作 | 方法与路径 |
| --- | --- |
| 创建人脸库 | `POST /ISAPI/Intelligent/FDLib?format=json` |
| 数量 | `GET /ISAPI/Intelligent/FDLib/Count?format=json` |
| 查询 | `POST /ISAPI/Intelligent/FDLib/FDSearch?format=json` |
| 新增（只新增） | `POST /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json` |
| 设置（新增或修改） | `PUT /ISAPI/Intelligent/FDLib/FDSetUp?format=json` |
| 修改（按 FDID+FPID） | `PUT /ISAPI/Intelligent/FDLib/FDSearch?format=json&FDID=<FDID>&FPID=<FPID>&faceLibType=<faceLibType>` |
| 删除 | `PUT /ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=<FDID>&faceLibType=<FDType>` |

关键字段（`FaceDataRecord` / `FDSetUp`）：

- `faceURL` 与 `modelData` **二选一必填**；`modelData` 为海康私有建模数据（base64），第三方算法不可直接复用。
- `faceLibType`：`blackFD`（名单库）/ `staticFD`（静态库）/ `infraredFD`（红外人脸库）。
- `FDID`：人脸库 ID（创建人脸库时返回）；`FPID`：人脸记录 ID，**业务上等于人员工号**。
- `FDSetUp` 支持 `deleteFP: true` 删除该人脸，即删除存在**两条路径**。
- 附带 `name`（≤96 字节）、`gender`、`bornTime`、`bornCity` 等人员属性。

### 4.2 人员 / 卡 / 指纹端点

| 类别 | 端点 |
| --- | --- |
| 人员数量 / 查询 | `GET /ISAPI/AccessControl/UserInfo/Count`、`POST /ISAPI/AccessControl/UserInfo/Search` |
| 人员设置 / 修改 / 新增 | `PUT /ISAPI/AccessControl/UserInfo/SetUp`、`PUT .../UserInfo/Modify`、`POST .../UserInfo/Record` |
| 人员删除 / 进度 | `PUT /ISAPI/AccessControl/UserInfoDetail/Delete`、`GET /ISAPI/AccessControl/UserInfoDetail/DeleteProcess` |
| 卡 | `CardInfo/Count`、`CardInfo/Search`、`CardInfo/SetUp`、`CardInfo/Modify`、`CardInfo/Record`、`CardInfo/Delete` |
| 指纹 | `POST /ISAPI/AccessControl/FingerPrint/SetUp`、`POST /ISAPI/AccessControl/FingerPrintUpload` |

人员模型（《人员管理(以人为中心)》）：

- **以人为中心**（门禁一体机主流方式）：工号为字符串，最长 32 位；先下发人员，再按工号下发卡/人脸/指纹。
- **以卡为中心**：工号为整型 `1~99999999`，最多 8 位。
- 顺序约束：**必须先把人员工号下发成功，才能绑定人脸**。

### 4.3 人脸图片硬指标（原文）

> 照片格式：JPG 或 JPEG；照片文件大小：200KB 以内；照片分辨率：宽和高不能超过 400 万，建议 640×480；两眼间距：> 40 像素点；人脸正面免冠照，露出眉毛和眼镜；照片白底、无逆光、无 PS、无过度美颜处理。

工程含义：

- 手机自拍直传必须先压缩与质检，否则 200KB 与两眼间距两条约束会同时踩线；
- 文档只给"建议 640×480"，未给下限像素数；实际阈值需按型号实测确定；
- 光线/美颜/逆光的判定需要客户端或服务端人脸质量检测，不能只依赖设备端建模结果。

### 4.4 特征点与建模

- `PicFeaturePoints`：支持 `face`、`leftEye`、`rightEye`、`leftMouthCorner`、`rightMouthCorner`、`nose` 六类，坐标为**归一化 0–1000**，可随图片 URL 以 JSON 下发，或编码进图片数据。
- 文档给出的背景与解法：不同设备人脸评分算法不一致，平台评分通过的照片可能在设备侧建模失败；由平台统一提取特征点下发可提高建模成功率。
- 设备取特征点优先级：图片内携带 > JSON 参数。
- 建模失败可查：`/ISAPI/AccessControl/SearchModelFailRecord?format=json`（能力位）。

### 4.5 删除与幂等（对 LOCK-01 状态机的影响）

- 删除人员会**级联删除**其卡、指纹、人脸。
- 文档明确：`UserInfoDetail/Delete` 返回不代表删除完成，需轮询 `UserInfoDetail/DeleteProcess`，进度为 `success` 才算完成。
- 人脸下发返回 `ResponseStatus` 同样只是"已受理"，不等于设备已建模可用。
- 对应 LOCK-01A-CONTRACT 的结论：**所有"成功"必须二次查询确认**；未知结果一律按 `UNKNOWN_RESULT` 处理，不自动重试。

### 4.6 设备能力自证

- `GET /ISAPI/AccessControl/capabilities` 返回门禁总能力，含 `人脸库管理`、`采集人脸图片`、`人脸数据自更新`、`人员图片异步下发` 等布尔能力位。
- 这是**验证 `DS-K1T671BM` 是否支持本方案的最快路径**：拿到测试机后先拉该接口，比等型号手册更快。

### 4.7 门禁事件

来源：《附录D2.1 门禁事件》（事件类型码表 + 通知信封）。

- 通知分类：`event_acs`；方法名：`OnEventNotify`。
- 信封关键字段：`eventId`、`eventType`、`happenTime`（ISO8601）、`status`（0 瞬时 / 1 开始 / 2 停止 / 3 脉冲 / 4 联动结果 / 5 异步图片）、`srcName`、`timeout`。
- 事件类型码举例：`196893 人脸认证通过`、`197151 人脸认证失败`、`198919 远程软件开门`、`197390 认证成功等待远程开门`、`197889 黑名单事件`。
- 门禁事件既支持**事件订阅**，部分类别还支持门禁点事件查询。

### 4.8 证据边界

- 上述端点与字段来自"门禁一体机"通用文档，**不构成 `DS-K1T671BM` 的能力承诺**。
- 型号差异可能体现在：是否支持 `modelData`、是否支持特征点、`capabilities` 的具体能力位、人脸库类型。
- 因此 §2.2 仍为 0 条，LOCK-01A 不得据此标记完成。

## 5. 候选路线（不是结论）

| 路线 | 说明 | 状态 |
| --- | --- | --- |
| A 设备侧 ISAPI | 业务服务器经受控内网代理直连终端 HTTP(S) | **端点级证据已具备**（§4）；待 Q1/Q4/Q6 |
| B 平台 OpenAPI | 经综合安防平台（HikCentral）统一管理 | 待 Q6、Q7、Q9 |
| C 硬件 SDK | HCNetSDK/NET_DVR 桌面/服务端集成 | 排除：项目为 Node 服务端 + 云函数，无法承载原生 SDK/长连接/回调 |

**决策条件**：Q1（精确型号+固件）、Q4（认证方式）、Q6（是否必须平台）关闭后才选定路线；在此之前路线保持"未定"。
Q3、Q5 已在协议层关闭，不再作为阻塞项。

## 6. 需向厂商/项目负责人索取

1. `DS-K1T671BM` 官方产品规格书、用户手册、固件说明（含版本号与发布日期）——**仍是第一优先**。
2. 该型号 `AccessControl/capabilities` 的实测输出（或型号专用 ISAPI 指南）。
3. HikCentral Professional OpenAPI 指南（若最终走平台路线）。
4. 认证方式（ISAPI 账号 / Digest / 是否依赖 SDK 登录）与 IP 白名单要求。
5. 是否必须经综合安防平台（HikCentral）才能被第三方管理。
6. `DS-K1T671BM` 与国际同系列型号的接口差异说明。
7. 错误码表、调用限频、离线与并发行为。
8. 测试环境、账号、测试设备、密钥轮换与费用配额。

## 7. 证据记录规范

- 每条"已确认"必须同时具备：官方文档标题、版本、发布日期、适用型号/固件、原始 URL、关键章节/页码、文件 SHA-256。
- 本文 §4 属**文档级确认**（通用门禁一体机），不得写成"`DS-K1T671BM` 已验证"；型号级结论需单独标注来源与固件版本。
- 受限或版权文档只记录元数据与摘要，不提交原文。
- 在线页面抓取只作快照，须注明抓取时间与最终 URL。
- 无法取得精确型号资料时，保持"路线未定"，不得把 LOCK-01A 标记完成。
