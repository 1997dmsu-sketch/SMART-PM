# HK-AI-01 海康 ISAPI 文档证据矩阵

- 目标登记型号：`DS-K1T671BM`
- 结论：**仅完成文档证据整理；目标设备 capability 验证 0 条，真实调用 0 条，路线未选定，Provider 未批准发布。**
- 候选端点：27 个；首期只读探针候选：6 个；项目错误码子集：50 条。
- 安全边界：未连接真实设备、未调用真实云、未操作生产数据；未编写真实设备调用代码。
- 同源交付：本文件、`HIKVISION-ISAPI-PROVIDER-WHITELIST.json`、`HIKVISION-ISAPI-EVIDENCE-MATRIX.xlsx`。

## 1. 资料、页码与型号边界

页码均指 **PDF 文件页序号（含封面）**，不是正文印刷页码。原始资料带访问控制信息，不进入公开仓库；这里只保留摘要、哈希和必要技术结论。

| 资料 | ZIP SHA-256 | PDF SHA-256 | 页数 | 明确相关型号 | 精确列出裸目标型号 |
|---|---|---|---:|---|---|
| 智能门禁一体机 ISAPI 开发指南 | `52d3c19f37ea0757dd042e050e6d012a3fe9547a6da96a9649142266637b9761` | `91f539bd463b28b664a6cee1f87bdc17c585404bf893bf3fc785f98e5b0c2c97` | 1016 | `DS-K1T671`, `DS-K1T671A`, `DS-K1T671B` | 否 |
| 测温智能门禁一体机 ISAPI 开发指南 | `9888ab2a47a24ded58a9ac591df71fb3bfcee01c34a13e951711be9005390f76` | `c2953ba53ec78f5437ed18d190ffa7706c0405d53866465a82ea072f6b22135f` | 824 | `DS-K1T671AM-3XF`, `DS-K1T671ATM-3XF`, `DS-K1T671BM-3XFTD` | 否 |

普通指南明确列出 `DS-K1T671B`，测温指南明确列出 `DS-K1T671BM-3XFTD`，两份指南均未精确列出裸型号 `DS-K1T671BM`。因此下文“文档存在”只证明产品族指南中存在相应定义，不能升级成目标设备能力。

错误码来源：两包相同的错误码工作簿，SHA-256 `5edde32c2622197261877b4a7243e18e6d145af0bac5a8976c6ef0af271b21f6`；本文行号为 XLSX 实际行号（含表头）。

## 2. 三级证据与使用规则

| 等级 | 本任务状态 | 含义 |
|---|---|---|
| 文档存在 | 已建立 | 每个候选端点均有文档、章节、PDF 页和前置条件；`workflow-only` 表示只找到集成流程，未找到独立详细 schema |
| 目标设备 capability 支持 | 0 条 | 尚未从完整目标型号与固件读取、复核 capability |
| 真实调用验证 | 0 条 | 本任务没有执行真实设备调用 |

JSON 顶层 `providerReleaseApproved=false`、`allowDeviceOperations=false`，每个候选端点均为 `candidateOnly=true`、`allowedNow=false`。AI-02 只能使用六个只读候选，AI-04 只能制作脱敏离线 fixture；二者都不能把文档示例写成真实响应。

### AI-02 首批只读候选

- `SYS-DEVICE-INFO`：`GET /ISAPI/System/deviceInfo`
- `AC-CAPABILITIES`：`GET /ISAPI/AccessControl/capabilities`
- `USER-CAPABILITIES`：`GET /ISAPI/AccessControl/UserInfo/capabilities?format=json`
- `FD-CAPABILITIES`：`GET /ISAPI/Intelligent/FDLib/capabilities?format=json`
- `FD-LIST`：`GET /ISAPI/Intelligent/FDLib?format=json`
- `FD-COUNT-ALL`：`GET /ISAPI/Intelligent/FDLib/Count?format=json`

这六项仍需默认 dry-run、真人明确授权、隔离设备与网络、主机/端口/路径限制及响应脱敏；本矩阵本身不授权连接设备。

## 3. 候选端点证据

### device

#### SYS-DEVICE-INFO — `GET /ISAPI/System/deviceInfo`

- 用途：读取型号、固件、硬件等身份信息；响应中的设备唯一标识必须脱敏。
- 文档：普通指南 §13.1.7.2 获取设备信息参数，PDF 255,256 页；测温指南 §11.1.6.2 获取设备信息参数，PDF 210,211 页；详细度：`schema`。
- capability 前置：`not-specified-in-cited-section`：不得推测独立能力节点；仍须认证并通过真实只读调用确认。
- 字段引用：`DeviceInfo.model`, `DeviceInfo.firmwareVersion`, `DeviceInfo.firmwareReleasedDate`, `DeviceInfo.hardwareVersion`。
- 条件/限制：AI-02 仅使用无查询参数的基础路径；不得请求其他控制器或记录敏感标识原文。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

### event

#### SYS-CAPABILITIES — `GET /ISAPI/System/capabilities`

- 用途：读取系统能力；事件订阅前检查 isSupportSubscribeEvent。
- 文档：普通指南 §4.4.1.2 订阅布防，PDF 20 页；测温指南 §4.4.1.2 订阅布防，PDF 20 页；详细度：`workflow-only`。
- capability 前置：`not-specified-in-cited-section`：不得推测独立能力节点；仍须认证并通过真实只读调用确认。
- 字段引用：`System.isSupportSubscribeEvent`。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

### access-control

#### AC-CAPABILITIES — `GET /ISAPI/AccessControl/capabilities`

- 用途：检查人员、人脸和人员删除总能力，以及 employeeNo 字符约束。
- 文档：普通指南 §8.12.2.2.1、§8.12.5.2.1，PDF 100,113 页；测温指南 §8.7.2.2.1、§8.7.5.2.1，PDF 90,103 页；详细度：`workflow-only`。
- capability 前置：`not-specified-in-cited-section`：不得推测独立能力节点；仍须认证并通过真实只读调用确认。
- 字段引用：`AccessControl.isSupportUserInfo`, `AccessControl.isSupportFDLib`, `AccessControl.isSupportUserInfoDetailDelete`, `AccessControl.EmployeeNoInfo.employeeNo`, `AccessControl.EmployeeNoInfo.characterType`, `AccessControl.EmployeeNoInfo.isSupportCompress`。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

### person

#### USER-CAPABILITIES — `GET /ISAPI/AccessControl/UserInfo/capabilities?format=json`

- 用途：读取人员操作、分页、列表和容量能力。
- 文档：普通指南 §13.5.14.67；§8.12.2.2.2，PDF 547,548,549,550,551,552,101 页；测温指南 §11.5.8.31；§8.7.2.2.2，PDF 455,456,457,458,459,460,91 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportUserInfo`：== true。
- 字段引用：`UserInfo.supportFunction`, `UserInfo.maxRecordNum`, `UserInfoCap.UserInfoSearchCond.maxResults`, `UserInfoSearchCond.EmployeeNoList.maxSize`。
- 条件/限制：maxRecordNum 在通用能力 schema 中为可选；目标缺失时不得按 0 或无限制处理，必须保留实际响应供复核。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### USER-COUNT — `GET /ISAPI/AccessControl/UserInfo/Count?format=json`

- 用途：查询已添加人员数量及已绑定人脸人员数量。
- 文档：普通指南 §13.5.14.68 获取人员数量，PDF 556,557 页；测温指南 §11.5.8.32 获取人员数量，PDF 464,465 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportUserInfo`：== true<br>`supportFunction`：contains get。
- 字段引用：`UserInfoCount.userNumber`, `UserInfoCount.bindFaceUserNumber`。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### USER-SEARCH — `POST /ISAPI/AccessControl/UserInfo/Search?format=json`

- 用途：按人员 ID 等条件分页查询人员。
- 文档：普通指南 §13.5.14.72 查询人员信息；§8.12.2.2.2，PDF 563,564,101 页；测温指南 §11.5.8.36 查询人员信息；§8.7.2.2.2，PDF 470,471,91 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportUserInfo`：== true<br>`supportFunction`：contains get。
- 字段引用：`UserInfoSearchCond.searchResultPosition`, `UserInfoSearchCond.maxResults`, `UserInfoSearchCond.EmployeeNoList[].employeeNo`, `UserInfo.employeeNo`, `UserInfo.Valid`。
- 条件/限制：maxResults 与 EmployeeNoList 上限以实际 capability 为准，不能写死通用 schema 示例值。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### USER-RECORD — `POST /ISAPI/AccessControl/UserInfo/Record?format=json`

- 用途：新增人员；已存在时文档说明会报错。
- 文档：普通指南 §13.5.14.71 添加人员信息；§8.12.2.2.4，PDF 560,561,562,102 页；测温指南 §11.5.8.35 添加人员信息；§8.7.2.2.4，PDF 468,469,470,92 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportUserInfo`：== true<br>`supportFunction`：contains post。
- 字段引用：`UserInfo.employeeNo`, `UserInfo.name`, `UserInfo.userType`, `UserInfo.Valid`, `UserInfo.doorRight`, `UserInfo.RightPlan`。
- 条件/限制：先查询门禁总能力和人员能力；人员存在时不得把新增当修改。
- 条件/限制：项目不得使用 administrator 规避门权限与有效期校验。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### USER-SETUP — `PUT /ISAPI/AccessControl/UserInfo/SetUp?format=json`

- 用途：设置人员：文档描述为不存在则新增、存在则修改。
- 文档：普通指南 §13.5.14.73 设置人员信息；§8.12.2.2.3，PDF 567,568,101,102 页；测温指南 §11.5.8.37 设置人员信息；§8.7.2.2.3，PDF 475,476,91,92 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportUserInfo`：== true<br>`supportFunction`：contains setUp。
- 字段引用：`UserInfo.employeeNo`, `UserInfo.userType`, `UserInfo.Valid`, `UserInfo.doorRight`, `UserInfo.RightPlan`。
- 条件/限制：upsert 语义不等于厂商幂等保证；发送后未知结果必须先查询对账。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### USER-MODIFY — `PUT /ISAPI/AccessControl/UserInfo/Modify?format=json`

- 用途：修改已存在人员；不存在时文档说明会报错。
- 文档：普通指南 §13.5.14.70 修改人员信息；§8.12.2.2.5，PDF 558,559,560,102 页；测温指南 §11.5.8.34 修改人员信息；§8.7.2.2.5，PDF 466,467,468,92,93 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportUserInfo`：== true<br>`supportFunction`：contains put。
- 字段引用：`UserInfo.employeeNo`, `UserInfo.userType`, `UserInfo.Valid`, `UserInfo.doorRight`, `UserInfo.RightPlan`。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### USER-DETAIL-DELETE — `PUT /ISAPI/AccessControl/UserInfoDetail/Delete?format=json`

- 用途：按人员明细发起删除；成功响应只表示开始执行。
- 文档：普通指南 §8.12.2.2.6 人员删除，PDF 103 页；测温指南 §8.7.2.2.6 人员删除，PDF 93,94 页；详细度：`workflow-only`。
- capability 前置：`isSupportUserInfoDetailDelete`：== true。
- 字段引用：`UserInfo.employeeNo`。
- 条件/限制：本指南未定位到此端点的独立详细 schema，不得套用 UserInfo/Delete 的空列表语义。
- 条件/限制：完成后必须轮询 DeleteProcess 并回查人员与人脸残留。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### USER-DETAIL-DELETE-PROCESS — `GET /ISAPI/AccessControl/UserInfoDetail/DeleteProcess`

- 用途：循环查询人员明细删除进度；路径按指南保留，不自行添加 format=json。
- 文档：普通指南 §8.12.2.2.6 人员删除，PDF 103 页；测温指南 §8.7.2.2.6 人员删除，PDF 93,94 页；详细度：`workflow-only`。
- capability 前置：`isSupportUserInfoDetailDelete`：== true。
- 字段引用：本指南引用章节未给出可登记字段；待补充资料/真实脱敏响应。
- 条件/限制：未定位到独立响应 schema；processing/success/failed 枚举不得从指纹删除接口照搬。
- 条件/限制：轮询完成仍需人员和人脸查询对账。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

### face

#### FD-CAPABILITIES — `GET /ISAPI/Intelligent/FDLib/capabilities?format=json`

- 用途：读取人脸操作能力与最大人脸记录数。
- 文档：普通指南 §8.12.5.2.2–8.12.5.2.6，PDF 114,115,116,117 页；测温指南 §8.7.5.2.2–8.7.5.2.6，PDF 104,105,106,107 页；详细度：`workflow-only`。
- capability 前置：`isSupportFDLib`：== true。
- 字段引用：`FDLib.supportFunction`, `FDLib.FDRecordDataMaxNum`。
- 条件/限制：未定位到独立详细 capability schema；supportFunction 与 FDRecordDataMaxNum 均须以目标设备原始响应复核。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

### face-library

#### FD-LIST — `GET /ISAPI/Intelligent/FDLib?format=json`

- 用途：确认设备已存在的人脸库，再选择 FDID 与库类型。
- 文档：普通指南 §8.12.5.2.1 判断是否支持人脸管理，PDF 113 页；测温指南 §8.7.5.2.1 判断是否支持人脸管理，PDF 103 页；详细度：`workflow-only`。
- capability 前置：`isSupportFDLib`：== true。
- 字段引用：`FDID`, `faceLibType`。
- 条件/限制：未定位到独立详细响应 schema；不得凭通用流程固定库类型。
- 条件/限制：可见光 FDID=1 只是流程说明，目标设备仍须读取确认。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### FD-CREATE — `POST /ISAPI/Intelligent/FDLib?format=json`

- 用途：在确认库不存在时创建人脸库；仅登记候选，不进入首期自动流程。
- 文档：普通指南 §8.12.5.2.1 判断是否支持人脸管理，PDF 113 页；测温指南 §8.7.5.2.1 判断是否支持人脸管理，PDF 103 页；详细度：`workflow-only`。
- capability 前置：`isSupportFDLib`：== true。
- 字段引用：`FDID`, `faceLibType`。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

### face-capacity

#### FD-COUNT-ALL — `GET /ISAPI/Intelligent/FDLib/Count?format=json`

- 用途：查询全部人脸库记录数和容量信息。
- 文档：普通指南 §13.4.1.1 获取人脸库中人脸记录总数；§8.12.5.2.2，PDF 334,114 页；测温指南 §11.4.1.1 获取人脸库中人脸记录总数；§8.7.5.2.2，PDF 303,104 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportFDLib`：== true<br>`supportFunction`：contains get。
- 字段引用：`FDRecordDataInfo[].recordDataNumber`, `FDRecordDataInfo[].FDID`, `FDRecordDataInfo[].faceLibType`, `FDCapacity.maxRecordDataNumber`, `FDCapacity.remainRecordDataNumber`。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### FD-COUNT-BY-LIB — `GET /ISAPI/Intelligent/FDLib/Count?format=json&FDID=<FDID>&faceLibType=<faceLibType>`

- 用途：查询指定人脸库记录数。
- 文档：普通指南 §13.4.1.2 获取指定人脸库人脸记录总数，PDF 335 页；测温指南 §11.4.1.2 获取指定人脸库人脸记录总数，PDF 304 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportFDLib`：== true<br>`supportFunction`：contains get。
- 字段引用：`FDID`, `faceLibType`, `FDRecordDataInfo[].recordDataNumber`。
- 条件/限制：FDID 与 faceLibType 必须来自已核实的库信息，不得固定写死。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

### face

#### FD-SEARCH — `POST /ISAPI/Intelligent/FDLib/FDSearch?format=json`

- 用途：分页查询人脸记录，用于录入对账和撤权残留检查。
- 文档：普通指南 §13.4.1.8 查找人脸库中的人脸数据；§8.12.5.2.2，PDF 343,344,345,346,114 页；测温指南 §11.4.1.8 查找人脸库中的人脸数据；§8.7.5.2.2，PDF 312,313,314,315,104 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportFDLib`：== true<br>`supportFunction`：contains get。
- 字段引用：`FDSearch.searchResultPosition`, `FDSearch.maxResults`, `FDSearch.FDID`, `FDSearch.FPID`, `FDSearch.faceLibType`。
- 条件/限制：查询响应可能含人脸 URL 或模型数据，日志与 fixture 必须移除敏感内容。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### FD-RECORD — `POST /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json`

- 用途：新增人脸记录；已存在时文档说明会报错。
- 文档：普通指南 §13.4.1.3 添加人脸数据；§8.12.5.2.4，PDF 336,337,338,115,116 页；测温指南 §11.4.1.3 添加人脸数据；§8.7.5.2.4，PDF 305,306,307,105,106 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportFDLib`：== true<br>`supportFunction`：contains post。
- 字段引用：`FaceDataRecord.faceURL`, `FaceDataRecord.modelData`, `FaceDataRecord.FDID`, `FaceDataRecord.FPID`, `FaceDataRecord.faceLibType`, `FaceDataRecord.name`, `FaceDataRecord.bornTime`, `FaceDataRecord.img`。
- 条件/限制：先下发人员并确认目标库存在。
- 条件/限制：FPID 对门禁业务必填并与 employeeNo 关联。
- 条件/限制：faceURL 与 modelData 二选一；图片二进制传输方式须 capability 和实测确认。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### FD-MODIFY — `PUT /ISAPI/Intelligent/FDLib/FDModify?format=json`

- 用途：修改已存在人脸记录。
- 文档：普通指南 §13.4.1.4 修改人脸数据；§8.12.5.2.5，PDF 338,339,340,116 页；测温指南 §11.4.1.4 修改人脸数据；§8.7.5.2.5，PDF 307,308,309,106 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportFDLib`：== true<br>`supportFunction`：contains put。
- 字段引用：`FaceDataRecord.faceURL`, `FaceDataRecord.modelData`, `FaceDataRecord.FDID`, `FaceDataRecord.FPID`, `FaceDataRecord.faceLibType`, `FaceDataRecord.img`。
- 条件/限制：按 FPID 判断记录是否存在；发送后未知结果先查询，不自动重试。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### FD-SETUP — `PUT /ISAPI/Intelligent/FDLib/FDSetUp?format=json`

- 用途：设置人脸：文档描述为不存在则新增、存在则修改。
- 文档：普通指南 §13.4.1.9 添加人脸数据（不存在则新增）；§8.12.5.2.3，PDF 347,348,115 页；测温指南 §11.4.1.9 添加人脸数据（不存在则新增）；§8.7.5.2.3，PDF 316,317,105 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportFDLib`：== true<br>`supportFunction`：contains setUp。
- 字段引用：`FaceDataRecord.faceURL`, `FaceDataRecord.modelData`, `FaceDataRecord.FDID`, `FaceDataRecord.FPID`, `FaceDataRecord.faceLibType`, `FaceDataRecord.img`。
- 条件/限制：upsert 语义不等于可安全盲重试；仍须唯一任务与查询对账。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### FD-DELETE — `PUT /ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=<FDID>&faceLibType=<FDType>`

- 用途：删除指定库中的指定人脸记录；文档流程称响应成功表示已删除。
- 文档：普通指南 §13.4.1.6 删除人脸库中的人脸数据；§8.12.5.2.6，PDF 341,342,117 页；测温指南 §11.4.1.6 删除人脸库中的人脸数据；§8.7.5.2.6，PDF 310,311,107 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportFDLib`：== true<br>`supportFunction`：contains delete。
- 字段引用：`FDID`, `faceLibType`, `FDSearchDelete.FPID[].value`, `FDSearchDelete.FPID[].rowKey`。
- 条件/限制：FPID 列表为空在门禁产品中不处理；Provider 应拒绝空列表。
- 条件/限制：删除不存在的人脸在集成流程中称不报错，仍须查询确认最终无残留。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

### event

#### EVENT-ALERT-STREAM — `GET /ISAPI/Event/notification/alertStream`

- 用途：建立非订阅 HTTP/HTTPS 长连接，接收设备全部事件。
- 文档：普通指南 §4.4.1、§4.4.1.1；§13.1.5.2，PDF 19,220 页；测温指南 §4.4.1、§4.4.1.1；§11.1.4.1，PDF 19,179 页；详细度：`schema-and-workflow`。
- capability 前置：`not-specified-in-cited-section`：不得推测独立能力节点；仍须认证并通过真实只读调用确认。
- 字段引用：`EventNotificationAlert.eventType`。
- 条件/限制：Connection: keep-alive；连接为设备到客户端的单向事件流。
- 条件/限制：超过心跳时间未收到消息应主动断开并重建；不得假设事件已鉴权、防重放。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### EVENT-SUBSCRIBE-CAP — `GET /ISAPI/Event/notification/subscribeEventCap`

- 用途：读取订阅事件类型、心跳与订阅管理能力。
- 文档：普通指南 §13.1.5.6 获取布防订阅能力，PDF 229,230,231 页；测温指南 §11.1.4.5 获取布防订阅能力，PDF 186,187,188 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportSubscribeEvent`：== true。
- 字段引用：`SubscribeEventCap.heartbeat`, `SubscribeEventCap.eventMode`, `SubscribeEventCap.EventList[].type`。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### EVENT-SUBSCRIBE — `POST /ISAPI/Event/notification/subscribeEvent`

- 用途：建立订阅长连接，仅接收订阅列表事件。
- 文档：普通指南 §4.4.1.2；§13.1.5.5，PDF 20,21,224,225,226,227,228,229 页；测温指南 §4.4.1.2；§11.1.4.4，PDF 20,21,181,182,183,184,185,186 页；详细度：`schema-and-workflow`。
- capability 前置：`isSupportSubscribeEvent`：== true<br>`EventList`：按实际支持类型订阅。
- 字段引用：`SubscribeEvent.heartbeat`, `SubscribeEvent.eventMode`, `SubscribeEvent.EventList[].type`, `SubscribeEventResponse.id`, `SubscribeEventResponse.FailedEventList`。
- 条件/限制：Connection: keep-alive；检查 FailedEventList，不能仅凭连接建立认定全部订阅成功。
- 条件/限制：心跳 eventType=heartBeat；超时断开重建不等于业务事件可自动重放。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

### event-push

#### EVENT-HTTPHOSTS-CAP — `GET /ISAPI/Event/notification/httpHosts/capabilities`

- 用途：确认设备是否支持监听主机参数配置。
- 文档：普通指南 §4.4.2.1 集成流程，PDF 22,23 页；测温指南 §4.4.2.1 集成流程，PDF 22,23 页；详细度：`workflow-only`。
- capability 前置：`not-specified-in-cited-section`：不得推测独立能力节点；仍须认证并通过真实只读调用确认。
- 字段引用：`HttpHostNotificationCap`。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### EVENT-HTTPHOSTS-GET — `GET /ISAPI/Event/notification/httpHosts?security=<security>&iv=<iv>`

- 用途：读取监听主机配置；敏感认证参数不得进入日志。
- 文档：普通指南 §4.4.2.1 集成流程，PDF 23 页；测温指南 §4.4.2.1 集成流程，PDF 23 页；详细度：`workflow-only`。
- capability 前置：`HttpHostNotificationCap`：成功返回该根节点。
- 字段引用：本指南引用章节未给出可登记字段；待补充资料/真实脱敏响应。
- 条件/限制：该路径含敏感查询参数，未来实现必须专门脱敏；本任务不定义参数值。
- 条件/限制：不属于 AI-02 首批只读白名单。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

#### EVENT-HTTPHOSTS-PUT — `PUT /ISAPI/Event/notification/httpHosts?security=<security>&iv=<iv>`

- 用途：配置设备主动推送的监听主机；仅为路线候选，不在首期自动配置。
- 文档：普通指南 §4.4.2.1–§4.4.2.2，PDF 23,24 页；测温指南 §4.4.2.1–§4.4.2.2，PDF 23,24 页；详细度：`workflow-only`。
- capability 前置：`HttpHostNotificationCap`：成功返回该根节点。
- 字段引用：本指南引用章节未给出可登记字段；待补充资料/真实脱敏响应。
- 条件/限制：设备主动连接平台并 POST 事件；监听方式不产生心跳。
- 条件/限制：认证、防重放、目标地址 allowlist 与配置覆盖风险未关闭前不得调用。
- 三级证据：文档存在=**是**；目标设备 capability=**未验证**；真实调用=**未执行**。

## 4. 删除端点隔离与延期项

- **FORBID-FDLIB-DELETE-ALL**：`DELETE /ISAPI/Intelligent/FDLib?format=json`。删除设备内所有人脸库及其中全部人脸；任何首期 Provider/探针均禁止。文档：普通指南 §8.12.5.2.6 人脸删除，PDF 117 页；测温指南 §8.7.5.2.6 人脸删除，PDF 107 页。
- **FORBID-USERINFO-BULK-DELETE**：`PUT /ISAPI/AccessControl/UserInfo/Delete?format=json`。UserInfoDelCond.EmployeeNoList 缺失或为空表示删除全部人员并删除关联凭证；首期整体禁用，且不得与 UserInfoDetail/Delete 混用。文档：普通指南 §13.5.14.69 删除人员信息，PDF 557 页；测温指南 §11.5.8.33 删除人员信息，PDF 465 页。
- **DEFER-FDSEARCH-PUT-ALTERNATIVE**：`PUT /ISAPI/Intelligent/FDLib/FDSearch?format=json&FDID=<FDID>&FPID=<FPID>&faceLibType=<faceLibType>`。详细 schema 中另有修改已存在人脸记录的候选形式；集成流程采用 FDModify。首期不并行实现两种修改路线，待 capability 与厂商确认后再选。文档：普通指南 §13.4.1.7 修改人脸数据（不存在则报错），PDF 342,343,344 页；测温指南 §11.4.1.7 修改人脸数据（不存在则报错），PDF 311,312,313 页。

`UserInfoDetail/Delete` 的返回成功只表示开始删除，必须循环查询 `UserInfoDetail/DeleteProcess`，再回查人员和人脸。指南 §13.5.14.69／§11.5.8.33 的 `UserInfo/Delete` 是另一端点，空或缺失 `EmployeeNoList` 会删除全部人员，不能借用其请求/响应语义。人员删除流程文字提到关联凭证会删除，但项目仍须实测人脸残留，不能只凭描述关闭撤权任务。

## 5. 字段证据与项目约束

“通用 schema 必填”不等于项目应多采个人信息。尤其人脸新增中的 `name`、`bornTime` 需目标 capability 和厂商确认；不得为通过校验编造生日或证件信息。`FPID` 虽在通用 schema 标 optional，但文档明确对门禁业务必填并与 `employeeNo` 关联。

| 字段 | 方向 | 类型/要求 | 文档约束 | 项目边界 | 出处 |
|---|---|---|---|---|---|
| `DeviceInfo.model` | response | string / required | 通用 DeviceInfo schema | 只保存必要身份与版本信息；序列号、MAC 等不进入报告或 fixture | 普通指南 §13.1.7.2，PDF 255,256 页；测温指南 §11.1.6.2，PDF 210,211 页 |
| `DeviceInfo.firmwareVersion` | response | string / required | 通用 DeviceInfo schema | 只保存必要身份与版本信息；序列号、MAC 等不进入报告或 fixture | 普通指南 §13.1.7.2，PDF 255,256 页；测温指南 §11.1.6.2，PDF 210,211 页 |
| `DeviceInfo.firmwareReleasedDate` | response | string / optional | 通用 DeviceInfo schema | 只保存必要身份与版本信息；序列号、MAC 等不进入报告或 fixture | 普通指南 §13.1.7.2，PDF 255,256 页；测温指南 §11.1.6.2，PDF 210,211 页 |
| `DeviceInfo.hardwareVersion` | response | string / optional | 通用 DeviceInfo schema | 只保存必要身份与版本信息；序列号、MAC 等不进入报告或 fixture | 普通指南 §13.1.7.2，PDF 255,256 页；测温指南 §11.1.6.2，PDF 210,211 页 |
| `AccessControl.isSupportUserInfo` | response | boolean / conditional | true 才进入对应流程 | 缺失或 false 均失败关闭，不得调用对应写接口 | 普通指南 §8.12.2.2.1、§8.12.2.2.6、§8.12.5.2.1，PDF 100,103,113 页；测温指南 §8.7.2.2.1、§8.7.2.2.6、§8.7.5.2.1，PDF 90,93,94,103 页 |
| `AccessControl.isSupportFDLib` | response | boolean / conditional | true 才进入对应流程 | 缺失或 false 均失败关闭，不得调用对应写接口 | 普通指南 §8.12.2.2.1、§8.12.2.2.6、§8.12.5.2.1，PDF 100,103,113 页；测温指南 §8.7.2.2.1、§8.7.2.2.6、§8.7.5.2.1，PDF 90,93,94,103 页 |
| `AccessControl.isSupportUserInfoDetailDelete` | response | boolean / conditional | true 才进入对应流程 | 缺失或 false 均失败关闭，不得调用对应写接口 | 普通指南 §8.12.2.2.1、§8.12.2.2.6、§8.12.5.2.1，PDF 100,103,113 页；测温指南 §8.7.2.2.1、§8.7.2.2.6、§8.7.5.2.1，PDF 90,93,94,103 页 |
| `AccessControl.EmployeeNoInfo.employeeNo` | response | capability-node / conditional | 共同判定人员 ID 长度与字符范围 | 目标返回值未取得前，不决定稳定 personId 到 employeeNo 的最终编码 | 普通指南 §8.12.2.2.1，PDF 100 页；测温指南 §8.7.2.2.1，PDF 90 页 |
| `AccessControl.EmployeeNoInfo.characterType` | response | capability-node / conditional | 共同判定人员 ID 长度与字符范围 | 目标返回值未取得前，不决定稳定 personId 到 employeeNo 的最终编码 | 普通指南 §8.12.2.2.1，PDF 100 页；测温指南 §8.7.2.2.1，PDF 90 页 |
| `AccessControl.EmployeeNoInfo.isSupportCompress` | response | capability-node / conditional | 共同判定人员 ID 长度与字符范围 | 目标返回值未取得前，不决定稳定 personId 到 employeeNo 的最终编码 | 普通指南 §8.12.2.2.1，PDF 100 页；测温指南 §8.7.2.2.1，PDF 90 页 |
| `UserInfo.supportFunction` | response | string-list / required | 文档候选：post/delete/put/get/setUp/batchPut | 每个操作分别检查，不能以总能力替代 | 普通指南 §13.5.14.67；§8.12.2.2.2，PDF 547,548,549,550,551,552,101 页；测温指南 §11.5.8.31；§8.7.2.2.2，PDF 455,456,457,458,459,460,91 页 |
| `UserInfo.maxRecordNum` | response | integer / optional | 集成流程与通用能力 schema 均定义为最大人员数量；schema 明确为可选 | 不以通用示例值推断目标容量；缺失不得按 0 或无限制 | 普通指南 §13.5.14.67；§8.12.2.2.2，PDF 547,548,549,550,551,552,101 页；测温指南 §11.5.8.31；§8.7.2.2.2，PDF 455,456,457,458,459,460,91 页 |
| `UserInfoCap.UserInfoSearchCond.maxResults` | response | range / conditional | 通用能力 schema 示例范围 1–100 | 实际上限取目标 capability | 普通指南 §13.5.14.67；§8.12.2.2.2，PDF 547,548,549,550,551,552,101 页；测温指南 §11.5.8.31；§8.7.2.2.2，PDF 455,456,457,458,459,460,91 页 |
| `UserInfoSearchCond.EmployeeNoList.maxSize` | response | integer / conditional | 通用能力 schema 示例为 56 | 实际批量上限取目标 capability | 普通指南 §13.5.14.67；§8.12.2.2.2，PDF 547,548,549,550,551,552,101 页；测温指南 §11.5.8.31；§8.7.2.2.2，PDF 455,456,457,458,459,460,91 页 |
| `UserInfo.employeeNo` | request/response | string / required | 通用新增 schema 为 1–32；默认字母数字，特殊字符随产品变化 | 以稳定 personId 的受控映射生成，不使用手机号；最终格式由 EmployeeNoInfo 决定 | 普通指南 §13.5.14.71；§13.5.14.70，PDF 560,561,562,558 页；测温指南 §11.5.8.35；§11.5.8.34，PDF 468,469,470,466 页 |
| `UserInfo.name` | request/response | string / optional | 通用新增 schema 为 0–128 | 仅传业务必要名称，不进入普通日志 | 普通指南 §13.5.14.71；§13.5.14.70，PDF 560,561,562,558 页；测温指南 §11.5.8.35；§11.5.8.34，PDF 468,469,470,466 页 |
| `UserInfo.userType` | request/response | enum / required-on-record | 含 normal/visitor/blackList/maintenance/patient/custom1..5/administrator | 住户流程不使用 administrator；blackList 不自动映射项目黑名单 | 普通指南 §13.5.14.71；§13.5.14.70，PDF 560,561,562,558 页；测温指南 §11.5.8.35；§11.5.8.34，PDF 468,469,470,466 页 |
| `UserInfo.Valid` | request/response | object / required-on-record | 人员有效期对象 | 必须绑定 grant 的 validFrom/validUntil，不以下发成功替代业务周期校验 | 普通指南 §13.5.14.71、§13.5.14.70，PDF 561,558 页；测温指南 §11.5.8.35、§11.5.8.34，PDF 469,466 页 |
| `UserInfo.Valid.enable` | request/response | boolean / required-on-record | true 时 beginTime 必须严格小于 endTime；false 表示长期有效 | 明确设备时区/NTP；禁止默认长期有效覆盖租期 | 普通指南 §13.5.14.71、§13.5.14.70，PDF 561,558 页；测温指南 §11.5.8.35、§11.5.8.34，PDF 469,466 页 |
| `UserInfo.Valid.beginTime` | request/response | datetime / required-on-record | 即使 enable=false 仍须传合法时间 | 明确设备时区/NTP；禁止默认长期有效覆盖租期 | 普通指南 §13.5.14.71、§13.5.14.70，PDF 561,558 页；测温指南 §11.5.8.35、§11.5.8.34，PDF 469,466 页 |
| `UserInfo.Valid.endTime` | request/response | datetime / required-on-record | 即使 enable=false 仍须传合法时间 | 明确设备时区/NTP；禁止默认长期有效覆盖租期 | 普通指南 §13.5.14.71、§13.5.14.70，PDF 561,558 页；测温指南 §11.5.8.35、§11.5.8.34，PDF 469,466 页 |
| `UserInfo.Valid.timeType` | request/response | enum / required-on-record | local\|UTC；缺省 local | 明确设备时区/NTP；禁止默认长期有效覆盖租期 | 普通指南 §13.5.14.71、§13.5.14.70，PDF 561,558 页；测温指南 §11.5.8.35、§11.5.8.34，PDF 469,466 页 |
| `UserInfo.doorRight` | request/response | string / optional | 逗号分隔门权限；空表示无门权限；仅传它而不传 RightPlan 表示长期拥有对应门权限 | 项目存在租期，不得单独下发形成长期权限 | 普通指南 §13.5.14.71；§13.5.14.70，PDF 560,561,562,558 页；测温指南 §11.5.8.35；§11.5.8.34，PDF 468,469,470,466 页 |
| `UserInfo.RightPlan` | request/response | array / conditional | 不能脱离 doorRight 单独下发 | 门号与计划模板必须来自经审批映射 | 普通指南 §13.5.14.71；§13.5.14.70，PDF 560,561,562,558 页；测温指南 §11.5.8.35；§11.5.8.34，PDF 468,469,470,466 页 |
| `UserInfo.RightPlan[].doorNo` | request/response | integer / conditional | 门编号（锁 ID） | 与项目 device/door 映射核对，不以房间号代替 | 普通指南 §13.5.14.71；§13.5.14.70，PDF 560,561,562,558 页；测温指南 §11.5.8.35；§11.5.8.34，PDF 468,469,470,466 页 |
| `UserInfo.RightPlan[].planTemplateNo` | request/response | string / conditional | 同门多模板按或处理；65535/65534/65533 为特殊模板 | 特殊模板不得未经审批默认使用 | 普通指南 §13.5.14.71；§13.5.14.70，PDF 560,561,562,558 页；测温指南 §11.5.8.35；§11.5.8.34，PDF 468,469,470,466 页 |
| `UserInfoSearchCond.searchResultPosition` | request | integer / required | 查询结果起始位置 | 分页直到结果完整，避免只查第一页 | 普通指南 §13.5.14.72，PDF 563,564 页；测温指南 §11.5.8.36，PDF 470,471 页 |
| `UserInfoSearchCond.maxResults` | request | integer / required | 单次最大记录数；上限由 capability 决定 | 不写死 100 | 普通指南 §13.5.14.72，PDF 563,564 页；测温指南 §11.5.8.36，PDF 470,471 页 |
| `UserInfoSearchCond.EmployeeNoList[].employeeNo` | request | string / conditional | 按人员 ID 列表查询；列表上限由 capability 决定 | 只查询当前目标人员，避免无边界全量拉取 | 普通指南 §13.5.14.72，PDF 563,564 页；测温指南 §11.5.8.36，PDF 470,471 页 |
| `UserInfoCount.userNumber` | response | integer / required/optional | 人员总数或绑定人脸人员数 | 仅作容量和对账信号，不替代逐人员查询 | 普通指南 §13.5.14.68，PDF 556,557 页；测温指南 §11.5.8.32，PDF 464,465 页 |
| `UserInfoCount.bindFaceUserNumber` | response | integer / required/optional | 人员总数或绑定人脸人员数 | 仅作容量和对账信号，不替代逐人员查询 | 普通指南 §13.5.14.68，PDF 556,557 页；测温指南 §11.5.8.32，PDF 464,465 页 |
| `FDLib.supportFunction` | response | string-list / conditional | get/setUp/post/put/delete 分别人脸操作；未定位独立根节点 schema | 逐操作检查，缺失即禁止对应调用 | 普通指南 §8.12.5.2.2–8.12.5.2.6，PDF 114,115,116,117 页；测温指南 §8.7.5.2.2–8.7.5.2.6，PDF 104,105,106,107 页 |
| `FDLib.FDRecordDataMaxNum` | response | integer / conditional | 集成流程称返回设备最大人脸数量；未定位独立根节点 schema | 以目标原始响应复核，不采用其他产品容量 | 普通指南 §8.12.5.2.2–8.12.5.2.6，PDF 114,115,116,117 页；测温指南 §8.7.5.2.2–8.7.5.2.6，PDF 104,105,106,107 页 |
| `FDID` | request/response | string / required-in-face-record | 人脸库 ID；可见光库流程示例为 1，深度模式另有库 | 必须读取目标库信息后选择，不写死 | 普通指南 §13.4.1.2、§13.4.1.3，PDF 335,336,337 页；测温指南 §11.4.1.2、§11.4.1.3，PDF 304,305,306 页 |
| `faceLibType` | request/response | enum / required-in-face-record | 文档出现 blackFD/staticFD/infraredFD | blackFD 是厂商名单库语义，不等同项目黑名单；类型由目标库决定 | 普通指南 §13.4.1.2、§13.4.1.3，PDF 335,336,337 页；测温指南 §11.4.1.2、§11.4.1.3，PDF 304,305,306 页 |
| `FaceDataRecord.FDID` | request | string / required | 目标人脸库 ID；新增请求字段位于请求根对象 | 与 FDID 全局映射一致 | 普通指南 §13.4.1.2、§13.4.1.3，PDF 335,336,337 页；测温指南 §11.4.1.2、§11.4.1.3，PDF 304,305,306 页 |
| `FaceDataRecord.faceLibType` | request | enum / required | 目标库类型；新增请求字段位于请求根对象 | 与目标库实际类型一致 | 普通指南 §13.4.1.2、§13.4.1.3，PDF 335,336,337 页；测温指南 §11.4.1.2、§11.4.1.3，PDF 304,305,306 页 |
| `FaceDataRecord.FPID` | request/response | string / business-required-for-access-control | 通用 schema 标 optional，但注明门禁业务必填；与非视频 employeeNo 一致；新增请求字段位于请求根对象 | 建立 employeeNo↔FPID 持久映射；不得因通用 optional 而省略 | 普通指南 §13.4.1.3；§8.12.5.2.5，PDF 337,116 页；测温指南 §11.4.1.3；§8.7.5.2.5，PDF 306,106 页 |
| `FaceDataRecord.faceURL` | request | string / one-of-with-modelData | 与 modelData 二选一；请求字段位于请求根对象 | 禁止公网不可控 URL 与日志原值；目标设备能否访问须实测 | 普通指南 §13.4.1.3、§13.4.1.4，PDF 336,337,338,339 页；测温指南 §11.4.1.3、§11.4.1.4，PDF 305,306,307,308 页 |
| `FaceDataRecord.modelData` | request | string / one-of-with-faceURL | 目标模型数据；与 faceURL 二选一；请求字段位于请求根对象 | 按私密生物特征处理，不进入日志、普通响应或公开 fixture | 普通指南 §13.4.1.3、§13.4.1.4，PDF 336,337,338,339 页；测温指南 §11.4.1.3、§11.4.1.4，PDF 305,306,307,308 页 |
| `FaceDataRecord.img` | request | binary / conditional | 表单图片二进制；示例 Content-Type 为 image/jpeg | 格式、大小、分辨率、质量和是否必须该表单方式均待 capability/实测 | 普通指南 §13.4.1.3、§13.4.1.4，PDF 338,339 页；测温指南 §11.4.1.3、§11.4.1.4，PDF 307,308 页 |
| `FaceDataRecord.name` | request | string / required-in-generic-record-schema | 通用新增 schema 标必填；请求字段位于请求根对象 | 仅使用必要人员显示名；实际目标要求需 capability/实测 | 普通指南 §13.4.1.3，PDF 337 页；测温指南 §11.4.1.3，PDF 306 页 |
| `FaceDataRecord.bornTime` | request | date/string / required-in-generic-record-schema | 通用新增 schema 标必填；请求字段位于请求根对象 | 不得据此额外采集生日；先请厂商确认是否可省略及目标实际校验，禁止编造占位值 | 普通指南 §13.4.1.3，PDF 337 页；测温指南 §11.4.1.3，PDF 306 页 |
| `FDRecordDataInfo[].recordDataNumber` | response | integer / optional | 指定库已添加人脸数量 | 可选字段缺失不得按 0；与 FDRecordDataMaxNum 区分并保留原始脱敏证据 | 普通指南 §13.4.1.1、§13.4.1.2，PDF 334,335 页；测温指南 §11.4.1.1、§11.4.1.2，PDF 303,304 页 |
| `FDRecordDataInfo[].FDID` | response | string / optional | 人脸库 ID | 可选字段缺失不得按 0；与 FDRecordDataMaxNum 区分并保留原始脱敏证据 | 普通指南 §13.4.1.1、§13.4.1.2，PDF 334,335 页；测温指南 §11.4.1.1、§11.4.1.2，PDF 303,304 页 |
| `FDRecordDataInfo[].faceLibType` | response | enum / optional | 人脸库类型 | 可选字段缺失不得按 0；与 FDRecordDataMaxNum 区分并保留原始脱敏证据 | 普通指南 §13.4.1.1、§13.4.1.2，PDF 334,335 页；测温指南 §11.4.1.1、§11.4.1.2，PDF 303,304 页 |
| `FDCapacity.maxRecordDataNumber` | response | integer / optional | 容量信息中的最大记录条数 | 可选字段缺失不得按 0；与 FDRecordDataMaxNum 区分并保留原始脱敏证据 | 普通指南 §13.4.1.1、§13.4.1.2，PDF 334,335 页；测温指南 §11.4.1.1、§11.4.1.2，PDF 303,304 页 |
| `FDCapacity.remainRecordDataNumber` | response | integer / optional | 容量信息中的剩余记录条数 | 可选字段缺失不得按 0；与 FDRecordDataMaxNum 区分并保留原始脱敏证据 | 普通指南 §13.4.1.1、§13.4.1.2，PDF 334,335 页；测温指南 §11.4.1.1、§11.4.1.2，PDF 303,304 页 |
| `FDSearch.searchResultPosition` | request | integer / required | 查询结果起始位置 | 用于操作后对账；响应敏感字段必须脱敏 | 普通指南 §13.4.1.8，PDF 345,346 页；测温指南 §11.4.1.8，PDF 314,315 页 |
| `FDSearch.maxResults` | request | integer / required | 通用查询 schema 范围 1–100 | 用于操作后对账；响应敏感字段必须脱敏 | 普通指南 §13.4.1.8，PDF 345,346 页；测温指南 §11.4.1.8，PDF 314,315 页 |
| `FDSearch.FDID` | request | string / required | 可用逗号分隔多个库；项目默认只查目标库 | 用于操作后对账；响应敏感字段必须脱敏 | 普通指南 §13.4.1.8，PDF 345,346 页；测温指南 §11.4.1.8，PDF 314,315 页 |
| `FDSearch.FPID` | request | string / optional | 按单个人脸记录查询 | 用于操作后对账；响应敏感字段必须脱敏 | 普通指南 §13.4.1.8，PDF 345,346 页；测温指南 §11.4.1.8，PDF 314,315 页 |
| `FDSearch.faceLibType` | request | enum / required | 目标库类型 | 用于操作后对账；响应敏感字段必须脱敏 | 普通指南 §13.4.1.8，PDF 345,346 页；测温指南 §11.4.1.8，PDF 314,315 页 |
| `FDSearchDelete.FPID[].value` | request | string / required-in-list-item | 人脸记录 ID；空数组在门禁产品中不处理 | Provider 必须拒绝空列表并限定目标人员 | 普通指南 §13.4.1.6；§8.12.5.2.6，PDF 341,342,117 页；测温指南 §11.4.1.6；§8.7.5.2.6，PDF 310,311,107 页 |
| `FDSearchDelete.FPID[].rowKey` | request | string / optional/product-dependent | 部分轻量产品必填，用于提高查询效率 | 是否必填以目标 capability/实测为准，不编造 | 普通指南 §13.4.1.6；§8.12.5.2.6，PDF 341,342,117 页；测温指南 §11.4.1.6；§8.7.5.2.6，PDF 310,311,107 页 |
| `System.isSupportSubscribeEvent` | response | boolean / conditional | true 才支持订阅 | false 或缺失时不建立订阅连接 | 普通指南 §4.4.1、§13.1.5.5–§13.1.5.6，PDF 19,20,224,229,230 页；测温指南 §4.4.1、§11.1.4.4–§11.1.4.5，PDF 19,20,181,186,187 页 |
| `EventNotificationAlert.eventType` | event | string / conditional | 事件类型；heartBeat 表示心跳 | 心跳与业务事件分开处理；事件仍需鉴权、防重放和组织/设备匹配 | 普通指南 §4.4.1、§13.1.5.5–§13.1.5.6，PDF 19,20,224,229,230 页；测温指南 §4.4.1、§11.1.4.4–§11.1.4.5，PDF 19,20,181,186,187 页 |
| `SubscribeEventCap.heartbeat` | capability/request/response | range / conditional | 能力返回心跳范围；通用 schema 示例 1–180 秒 | 以目标能力为准；订阅连接成功不等于所有事件订阅成功 | 普通指南 §4.4.1、§13.1.5.5–§13.1.5.6，PDF 19,20,224,229,230 页；测温指南 §4.4.1、§11.1.4.4–§11.1.4.5，PDF 19,20,181,186,187 页 |
| `SubscribeEventCap.eventMode` | capability/request/response | enum / conditional | all/list 等由能力返回 | 以目标能力为准；订阅连接成功不等于所有事件订阅成功 | 普通指南 §4.4.1、§13.1.5.5–§13.1.5.6，PDF 19,20,224,229,230 页；测温指南 §4.4.1、§11.1.4.4–§11.1.4.5，PDF 19,20,181,186,187 页 |
| `SubscribeEventCap.EventList[].type` | capability/request/response | enum-list / conditional | 实际可订阅事件类型 | 以目标能力为准；订阅连接成功不等于所有事件订阅成功 | 普通指南 §4.4.1、§13.1.5.5–§13.1.5.6，PDF 19,20,224,229,230 页；测温指南 §4.4.1、§11.1.4.4–§11.1.4.5，PDF 19,20,181,186,187 页 |
| `SubscribeEvent.heartbeat` | capability/request/response | integer / conditional | 订阅心跳间隔，须在能力范围内 | 以目标能力为准；订阅连接成功不等于所有事件订阅成功 | 普通指南 §4.4.1、§13.1.5.5–§13.1.5.6，PDF 19,20,224,229,230 页；测温指南 §4.4.1、§11.1.4.4–§11.1.4.5，PDF 19,20,181,186,187 页 |
| `SubscribeEvent.eventMode` | capability/request/response | enum / conditional | list 时按事件列表订阅 | 以目标能力为准；订阅连接成功不等于所有事件订阅成功 | 普通指南 §4.4.1、§13.1.5.5–§13.1.5.6，PDF 19,20,224,229,230 页；测温指南 §4.4.1、§11.1.4.4–§11.1.4.5，PDF 19,20,181,186,187 页 |
| `SubscribeEvent.EventList[].type` | capability/request/response | enum / conditional | 门禁事件等必须来自能力列表 | 以目标能力为准；订阅连接成功不等于所有事件订阅成功 | 普通指南 §4.4.1、§13.1.5.5–§13.1.5.6，PDF 19,20,224,229,230 页；测温指南 §4.4.1、§11.1.4.4–§11.1.4.5，PDF 19,20,181,186,187 页 |
| `SubscribeEventResponse.id` | capability/request/response | integer/string / conditional | 设备返回的订阅 ID | 以目标能力为准；订阅连接成功不等于所有事件订阅成功 | 普通指南 §4.4.1、§13.1.5.5–§13.1.5.6，PDF 19,20,224,229,230 页；测温指南 §4.4.1、§11.1.4.4–§11.1.4.5，PDF 19,20,181,186,187 页 |
| `SubscribeEventResponse.FailedEventList` | capability/request/response | array / conditional | 存在时表示存在订阅失败事件 | 以目标能力为准；订阅连接成功不等于所有事件订阅成功 | 普通指南 §4.4.1、§13.1.5.5–§13.1.5.6，PDF 19,20,224,229,230 页；测温指南 §4.4.1、§11.1.4.4–§11.1.4.5，PDF 19,20,181,186,187 页 |
| `HttpHostNotificationCap` | response | xml-root / conditional | 成功返回该根节点表示支持监听主机配置 | 只证明配置能力，不证明推送认证、防重放或许可 | 普通指南 §4.4.2.1，PDF 23 页；测温指南 §4.4.2.1，PDF 23 页 |

## 6. 认证与事件

- 两份指南 §3.3.1（PDF 7 页）均要求 RFC 7616 HTTP Digest，并称默认开启 HTTPS；证书信任、实际端口、Digest 算法/qop、账号权限均未由目标设备验证。
- 非订阅 `alertStream` 接收全部事件；订阅 `subscribeEvent` 仅接收列表事件。两者是 HTTP/HTTPS 长连接，建立后由设备单向发送；心跳超时后客户端应主动断开并重建（两指南 §4.4.1，PDF 19–21 页）。
- 订阅前须检查 `System/capabilities.isSupportSubscribeEvent=true` 并读取 `subscribeEventCap`；还需检查 `FailedEventList`，连接建立不等于所有事件订阅成功。
- `httpHosts` 是设备主动向平台监听地址 POST 事件的方式；监听没有心跳。配置前要求 `httpHosts/capabilities` 成功返回 `HttpHostNotificationCap`（两指南 §4.4.2，PDF 22–24 页）。推送认证、防重放、目标地址限制、许可与目标固件行为仍未关闭。

## 7. 项目错误码子集

共 50 条，逐行来自上述错误码工作簿。**全部 `retryability=undetermined`、`internalMapping=UNMAPPED`**。即使描述含“建议重新订阅”或“重新检索”，也不能脱离请求是否已执行、具体接口和目标固件上下文自动重试。`fileSizeExceedError` 描述中出现的图片大小只是通用错误码说明，不是目标设备验收阈值。

| 领域 | 状态码 | 子状态码 | 错误码 | 原文技术描述 | XLSX 行 | 重试性 |
|---|---:|---|---|---|---:|---|
| general | 4 Invalid Operation | `notSupport` | `0x40000001` | 设备不支持 | 159 | undetermined |
| general | 4 Invalid Operation | `lowPrivilege` | `0x40000002` | 没有足够的权限进行此操作 | 160 | undetermined |
| authentication | 4 Invalid Operation | `badAuthorization` | `0x40000003` | 认证不通过 | 161 | undetermined |
| general | 4 Invalid Operation | `methodNotAllowed` | `0x40000004` | HTTP方法不允许 | 162 | undetermined |
| general | 4 Invalid Operation | `invalidOperation` | `0x40000006` | 接口输入指令非法操作(例如：设备不支持的通道号,不支持的硬件等下发会返回无效操作) | 164 | undetermined |
| general | 4 Invalid Operation | `notActivated` | `0x40000007` | 设备未激活 | 165 | undetermined |
| general | 4 Invalid Operation | `invalidContent` | `0x4000000A` | 非法的报文内容 | 168 | undetermined |
| general | 4 Invalid Operation | `maxSessionUserLink` | `0x4000000B` | 达到最大用户连接 | 169 | undetermined |
| face-media | 3 Device Error | `fileSizeExceedError` | `0x30006010` | 文件太大，包括升级包等太大。人脸下发等操作时, 设备对图片大小有限制，人脸图片太大时(目前为200KB)，可能会返回失败，手动抓拍时，图片过大 | 149 | undetermined |
| face | 4 Invalid Operation | `addFaceRecordFailed` | `0x400010C1` | 人脸记录添加失败 | 395 | undetermined |
| face | 4 Invalid Operation | `deleteFaceRecordFailed` | `0x400010C2` | 人脸记录删除失败 | 396 | undetermined |
| face | 4 Invalid Operation | `modifyFaceRecordFailed` | `0x400010C3` | 人脸记录修改失败 | 397 | undetermined |
| face | 4 Invalid Operation | `queryFaceRecordFailed` | `0x400010C4` | 人脸记录查询失败 | 398 | undetermined |
| face-media | 4 Invalid Operation | `faceLowQulity` | `0x40006010` | 人脸质量较差：人脸采集时可能发生 | 1736 | undetermined |
| face-media | 4 Invalid Operation | `faceResolutionOrRatioError` | `0x40006011` | 人脸分辨率或宽高比异常：人脸下发时可能发生 | 1737 | undetermined |
| face | 4 Invalid Operation | `faceDataNotExist` | `0x40006012` | 用户人脸数据不存在:一般按人员查找人脸时，可能发生 | 1738 | undetermined |
| face-media | 4 Invalid Operation | `facePicWearingMask` | `0x40006016` | 人脸图片佩戴口罩 | 1742 | undetermined |
| face-media | 4 Invalid Operation | `facePicAngleError` | `0x40006017` | 人脸图片角度错误 | 1743 | undetermined |
| event | 4 Invalid Operation | `subscribeTypeErr` | `0x4000a016` | 订阅的metaData类型,设备不支持 | 1904 | undetermined |
| event | 4 Invalid Operation | `subscribeIDErr` | `0x4000a017` | 订阅链接的ID不存在,建议重新订阅。 | 1905 | undetermined |
| general | 5 Invalid  Format | `badJsonFormat` | `0x50000002` | JSON格式错误 | 1923 | undetermined |
| general | 5 Invalid  Format | `badURLFormat` | `0x50000003` | URL格式错误 | 1924 | undetermined |
| general | 6 Invalid Content | `badParameters` | `0x60000001` | 参数错误（例如：必选节点没下发话） | 1925 | undetermined |
| general | 6 Invalid Content | `badJsonContent` | `0x60000017` | JSON报文错误 | 1947 | undetermined |
| general | 6 Invalid Content | `MessageParametersLack` | `0x60000019` | 报文参数缺少 | 1949 | undetermined |
| query | 6 Invalid Content | `invalidSearchConditions` | `0x6000001A` | 检索条件失效,请重新检索 | 1950 | undetermined |
| general | 6 Invalid Content | `beyondARGSRangeLimit` | `0x60000025` | 超出参数范围限制 | 1961 | undetermined |
| face-capacity | 6 Invalid Content | `faceLibraryNumError` | `0x6000002D` | 超过人脸库最大个数 | 1969 | undetermined |
| face-capacity | 6 Invalid Content | `faceImagesNumError` | `0x6000002E` | 超过人脸图片最大张数 | 1970 | undetermined |
| face-media | 6 Invalid Content | `faceDataAnalysisError` | `0x6000002F` | 图片数据识别失败 | 1971 | undetermined |
| face | 6 Invalid Content | `faceDataPIDError` | `0x60000030` | 人脸数据PID无效 | 1972 | undetermined |
| face-library | 6 Invalid Content | `faceLibraryIDError` | `0x60000031` | 人脸库ID无效 | 1973 | undetermined |
| face-media | 6 Invalid Content | `multipleFaceObjectError` | `0x60000035` | 多张人脸目标错误（导入人脸库的图片中存在多个有效目标,且没有坐标区分） | 1977 | undetermined |
| event | 6 Invalid Content | `eventNotSupport` | `0x60001024` | 订阅事件不支持 | 2112 | undetermined |
| permission | 6 Invalid Content | `holidayGroupDownload` | `0x60006009` | 假日组下载失败 | 2366 | undetermined |
| face | 6 Invalid Content | `deleteNoExistFace` | `0x60006015` | 删除的人脸不存在 | 2378 | undetermined |
| event | 6 Invalid Content | `deployExceedMax` | `0x60006018` | 布防超过最大连接数 | 2381 | undetermined |
| person | 6 Invalid Content | `employeeNoNotExist` | `0x6000601f` | 工号不存在 | 2388 | undetermined |
| person | 6 Invalid Content | `employeeNoAlreadyExist` | `0x60006020` | 工号已存在 | 2389 | undetermined |
| person | 6 Invalid Content | `illegalEmployeeNo` | `0x60006036` | 工号错误 | 2411 | undetermined |
| face-media | 6 Invalid Content | `faceDataLenShort` | `0x6000603c` | 人脸数据长度小于1K | 2417 | undetermined |
| permission | 6 Invalid Content | `planNumberOverlap` | `0x6000604A` | 计划编号冲突：类似周、假日、假日组、计划模版编号非法 | 2431 | undetermined |
| face-media | 6 Invalid Content | `pictureFaceDetectZero` | `0x6000604C` | 图片中不存在人脸图片：人脸下发时可能发生 | 2433 | undetermined |
| face-media | 6 Invalid Content | `faceTypeError` | `0x6000604D` | 下发的人脸错误：人脸下发时可能发生 | 2434 | undetermined |
| person-capacity | 6 Invalid Content | `deviceUserFull` | `0x60007000` | 人员已满（人员数量已达上限） | 2440 | undetermined |
| face-capacity | 6 Invalid Content | `deviceFaceFull` | `0x60007001` | 人脸已满（人脸数量已达上限） | 2441 | undetermined |
| person | 6 Invalid Content | `deviceUserAlreadyExist` | `0x60007002` | 人员已存在（新增人员时） | 2442 | undetermined |
| person | 6 Invalid Content | `deviceUserNotExist` | `0x60007003` | 人员不存在（删除人员时,修改人员时,基于人员ID查询卡、人脸时） | 2443 | undetermined |
| face | 6 Invalid Content | `deviceUserAlreadyExistFace` | `0x60007004` | 人员ID已存在一张人脸（新增人脸时） | 2444 | undetermined |
| face-media | 6 Invalid Content | `invalidFaceRegion` | `0x60007012` | 人脸区域不合法 | 2455 | undetermined |

与 LOCK-01A 契约的衔接：本矩阵不直接生成 `RETRYABLE` 或 `TERMINAL` 映射。已发送后超时、断连、解析失败或未知官方码仍按 `UNKNOWN_RESULT` 处理并先查询/人工对账；只有后续证据确认未执行或厂商明确幂等/可重试后，才能逐行建立内部映射。

## 8. 真人待确认清单

| ID | 负责人 | 待确认问题 | 必要证据 | 阻塞 |
|---|---|---|---|---|
| H01 | 项目负责人 | 完整铭牌型号与全部后缀是什么？是否实际为测温或带后缀型号？ | 脱敏铭牌照片与设备管理页；序列号/MAC/激活码/二维码/账号仅保留必要末位 | 型号适用性与文档选择 |
| H02 | 项目负责人/厂商 | 目标固件、构建日期、硬件版本、区域版本及推荐固件是什么？ | 设备管理页脱敏截图与厂商书面回复 | 能力基线与复现 |
| H03 | 海康支持 | 裸型号 DS-K1T671BM 是否书面适用普通指南，还是必须使用其他型号指南？ | 明确完整型号、固件与指南版本对应关系的书面答复 | 把文档证据升级为目标型号证据 |
| H04 | 探针执行人 | 实际 AccessControl/capabilities 返回哪些人员、人脸、删除与 employeeNo 节点？ | 隔离设备只读响应及脱敏报告 | 人员与人脸流程准入 |
| H05 | 探针执行人 | 实际 UserInfo/capabilities 的 supportFunction、maxRecordNum、分页和列表上限是什么？ | 隔离设备只读响应及脱敏报告 | 人员操作与容量 |
| H06 | 探针执行人 | 实际 FDLib/capabilities 的 supportFunction 与 FDRecordDataMaxNum 是什么？ | 隔离设备只读响应及脱敏报告 | 人脸操作与容量 |
| H07 | 海康支持/现场 | 应选择哪个 FDID 与 faceLibType？是否需要建库？深度模式是否涉及双库？ | FDLib 列表、识别模式能力与厂商书面说明 | 人脸库路线 |
| H08 | 海康支持 | 人脸图片格式、大小、分辨率、宽高比、角度、质量和下发频率是什么？ | 目标型号/固件书面约束与隔离实测 | 录入实现与离线 fixture |
| H09 | 现场网络/安全 | HTTPS 端口、证书信任、设备时间/NTP、Digest 算法与最小权限账号是什么？ | 受控配置记录与认证测试；不得提供密码、nonce 或证书私钥 | 安全连接 |
| H10 | 海康支持/现场 | UserInfoDetail/Delete 的请求和进度响应 schema 是什么？删除人员是否级联删除人脸？ | 适用接口说明、删除进度响应与删除前后人员/人脸回查 | 撤权闭环 |
| H11 | 项目/厂商 | 门号、doorRight、RightPlan 与计划模板如何映射？是否确需特殊模板？ | 经审批的门/模板映射与权限验证 | 避免长期或超范围权限 |
| H12 | 海康支持/测试 | 新增人脸通用 schema 中 name/bornTime 等字段是否对目标设备确实必填？能否省略非必要个人信息？ | 目标 capability、厂商书面答复与最小化测试 | 隐私最小化与请求兼容性 |
| H13 | 海康支持/安全 | alertStream、subscribeEvent、httpHosts 的认证、事件唯一 ID、时间窗、防重放与重连行为是什么？ | 官方说明、脱敏事件样本与异常测试 | 事件验签与对账 |
| H14 | 商务/海康支持 | 是否需要设备许可、平台许可或合作伙伴权限？并发连接与调用配额是什么？ | 书面许可、配额和费用说明 | 立项与容量 |
| H15 | 现场网络 | 是否有未承载生产通行的隔离设备、独立 VLAN/局域网与同网段边缘主机？ | 隔离拓扑、访问控制、断网和人工开门预案 | 任何真实读写验证 |
| H16 | 隐私/运营 | 测试人员同意、私密人脸保存期限、测试门、撤销验证与清理签字是否准备？ | 书面同意、测试记录及人员/人脸/权限无残留签字 | 真实写联调 |

## 9. 未关闭阻碍

1. 完整铭牌、固件、硬件和区域版本未知，且厂商尚未书面确认裸型号适用指南。
2. 目标设备所有 capability 均未读取；`UserInfoDetail/Delete`、其进度响应、`FDLib/capabilities`、人脸库列表缺少独立详细 schema 证据。
3. 人脸图片约束、FDID/faceLibType、人员与人脸容量、门号/权限模板、通用必填个人信息字段尚未确认。
4. HTTPS/Digest 实际配置、事件认证/防重放、许可/连接数和隔离边缘网络未确认。
5. 以上事项关闭并完成交叉审查前，不进入真实 Provider 写调用，不合并路线结论，不操作生产数据。
