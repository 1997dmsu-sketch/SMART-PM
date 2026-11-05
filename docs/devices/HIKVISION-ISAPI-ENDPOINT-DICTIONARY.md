# 海康门禁一体机 ISAPI 端点字典（LOCK-01B 实现参考）

- 适用：LOCK-01B（`FaceAccessProvider` 设备适配层）、LOCK-01C（联调）
- 来源：S1《门禁一体机》ISAPI 全文（见 [证据包](HIKVISION-EVIDENCE-2026-11-05.md) §2）
- 生成方式：字段表由官方文档自动抽取、抽样人工核对；**字段名、必填标记与取值范围以官方原文为准**
- 边界：这是"门禁一体机"通用文档，**不是 `DS-K1T671BM` 型号级结论**；型号差异以 `GET /ISAPI/AccessControl/capabilities` 实测为准

## 0. 通用约定

| 项 | 约定 |
| --- | --- |
| 基地址 | `http(s)://<设备地址>/ISAPI/...` |
| 参数 | 统一带 `?format=json`（`capabilities` 除外） |
| 请求体 | JSON（`Content-Type: application/json`） |
| 人脸图片 | 与 JSON 一同下发：SDK 侧为"JSON + 图片二进制"；HTTP 直连可用 `faceURL` 或 multipart（**直连方式待型号确认**） |
| 成功判定 | 响应信封 `statusCode = 1`；否则读 `subStatusCode` / `errorCode` / `errorMsg` |
| 日期 | 报文日期为 `yyyy-MM-dd`；事件 `happenTime` 为 ISO8601 |
| 认证 | **未确认**（Digest / ISAPI 账号 / 是否需先登录 SDK），见风险清单 Q4 |
| 异步性 | 人脸"下发成功"仅代表受理；人员/权限删除需轮询进度（§4） |

## 1. 端点索引

| 章节 | 用途 | 方法 | 路径 | 查询参数 |
| --- | --- | --- | --- | --- |
| 1.1 | 删除人脸（按 FDID + faceLibType） | PUT | `/ISAPI/Intelligent/FDLib/FDSearch/Delete` | `FDID=<FDID>&faceLibType=<FDType>` |
| 1.2 | 查人脸数量 | GET | `/ISAPI/Intelligent/FDLib/Count` | — |
| 1.3 | 设置人脸（新增或修改，可 deleteFP 删除） | PUT | `/ISAPI/Intelligent/FDLib/FDSetUp` | — |
| 1.4 | 修改人脸（按 FDID + FPID 定位） | PUT | `/ISAPI/Intelligent/FDLib/FDSearch` | `FDID=<FDID>&FPID=<FPID>&faceLibType=<faceLibType>` |
| 1.5 | 查询人脸 | POST | `/ISAPI/Intelligent/FDLib/FDSearch` | — |
| 1.6 | 添加人脸（只新增） | POST | `/ISAPI/Intelligent/FDLib/FaceDataRecord` | — |
| 1.7 | 查人员数量 | GET | `/ISAPI/AccessControl/UserInfo/Count` | `type=<type>` |
| 1.9 | 设置人员信息（新增或修改） | PUT | `/ISAPI/AccessControl/UserInfo/SetUp` | — |
| 1.11 | 查询人员信息 | POST | `/ISAPI/AccessControl/UserInfo/Search` | — |
| 1.12 | 添加人员信息（只新增） | POST | `/ISAPI/AccessControl/UserInfo/Record` | — |
| 1.13 | 查人员与权限删除进度 | GET | `/ISAPI/AccessControl/UserInfoDetail/DeleteProcess` | — |
| 1.14 | 删除人员与权限（级联） | PUT | `/ISAPI/AccessControl/UserInfoDetail/Delete` | — |
| 1.15 | 获取门禁总能力 | GET | `/ISAPI/AccessControl/capabilities` | — |

> 原文共 27 个端点（含卡、指纹、多重认证、群组、抓拍配置）。本字典只覆盖门禁人脸主链路；其余端点见 S1 对应章节。

## 2. 端点详情

### 1.1 删除人脸库中的人脸数据

- 用途：删除人脸（按 FDID + faceLibType）
- 请求：`PUT /ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=<FDID>&faceLibType=<FDType>`

**最小请求体骨架**（按必填字段自动生成，仅示意结构）

```json
{
  "FPID": [
    {
      "value": "<string>"
    }
  ]
}
```

**请求字段**

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `FPID` | req | array | — | 人脸记录ID列表 · 如果数组下发为空[],门禁产品不做处理 |
| `operateType` | opt | enum | 枚举：byTerminal # 按终端操作 | 操作类型 |
| `terminalNoList` | opt | array | — | 终端ID列表 · 可选,array,type为byTerminal,byTerminalOrg时必填,终端ID列表（目前仅支持单个终端） |


**响应字段**（仅列顶层与关键嵌套；完整结构见原文 §1.1）

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `statusCode` | opt | int | — | 状态码 · 无法用1表示时（1表示成功且无特殊状态）必须返回 |
| `statusString` | opt | string | range 1,64 | 状态描述 · 无法用OK表示时（OK表示成功且无特殊状态）必须返回 |
| `subStatusCode` | opt | string | range 1,64 | 子状态码 · 无法用ok表示（ok表示成功且无特殊状态）必须返回 |
| `errorCode` | opt | int | — | 错误码 · 当statusCode不为1时，与subStatusCode对应 |
| `errorMsg` | opt | string | — | 错误信息 · 当statusCode不为1时，必须返回,解释信息在协议约束中，允许设备在后续的版本迭代中，进行优化丰富提升（不限制死） |
| `MErrCode` | opt | string | — | 功能模块化错误 · 通用错误码都在此字段范围中 |
| `MErrDevSelfEx` | opt | string | — | 功能模块化错误码 · 此字段是MErrCode自定义模块化错误码的扩展字段，自定义模块化错误码一共有MErrCode 的后20bit和此字段的32bit |


### 1.2 获取人脸库中人脸记录总数

- 用途：查人脸数量
- 请求：`GET /ISAPI/Intelligent/FDLib/Count?format=json`

**请求字段**

_无请求体字段（查询参数承载）_

**响应字段**（仅列顶层与关键嵌套；完整结构见原文 §1.2）

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `requestURL` | opt | string | — | 请求URL |
| `statusCode` | opt | int | — | 状态码 · 无法用1表示时（1表示成功且无特殊状态）必须返回 |
| `statusString` | opt | string | range 1,64 | 状态描述 · 无法用OK表示时（OK表示成功且无特殊状态）必须返回 |
| `subStatusCode` | opt | string | range 1,64 | 子状态码 · 无法用ok表示（ok表示成功且无特殊状态）必须返回 |
| `errorCode` | opt | int | — | 错误码 · 当statusCode不为1时，与subStatusCode对应 |
| `errorMsg` | opt | string | — | 错误信息 · 当statusCode不为1时，解释信息在协议约束中，允许设备在后续的版本迭代中，进行优化丰富提升（不限制死） |
| `FDRecordDataInfo` | opt | array | — | 人脸库记录信息 · 人脸库记录信息,{dep if errcode==1&&errMsg==ok} |
| `totalRecordDataNumber` | opt | int | — | 所有记录数据条数 · 所有记录数据条数,integer32类型 |
| `FDCapacity` | opt | object | — | 人脸库容量信息 |


### 1.3 设置人脸库中的人脸数据

- 用途：设置人脸（新增或修改，可 deleteFP 删除）
- 请求：`PUT /ISAPI/Intelligent/FDLib/FDSetUp?format=json`

**最小请求体骨架**（按必填字段自动生成，仅示意结构）

```json
{
  "faceLibType": "blackFD",
  "FDID": "<string>",
  "PicFeaturePoints": [
    {
      "featurePointType": "face",
      "coordinatePoint": {
        "x": 0,
        "y": 0
      }
    }
  ]
}
```

**请求字段**

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `faceURL` | opt | string | — | 图片url |
| `faceLibType` | req | enum | 枚举：blackFD # 名单库,staticFD # 静态库,infraredFD # 红外人脸库 | 人脸库类型 · 必填,人脸库类型: blackFD-名单库,staticFD-静态库,string类型,最大长度为32 |
| `FDID` | req | string | range 1,64 | 人脸库ID |
| `FPID` | opt | string | range 1,64 | 人脸记录ID · 可选,人脸记录ID,string类型,如果外部传入,最长64字节,字母数字组合,需要保证唯一性; 如果外部不传则由设备自动生成（与非视频工号（… |
| `deleteFP` | opt | bool | — | 是否删除该人脸 · 可选，boolean，是否删除该人脸，true-是（只有删除该人脸时，才填写该字段；新增或修改人脸时，不填写该字段） |
| `modelData` | opt | string | — | 目标模型数据 · 可选，目标模型数据，字符串类型，传输过程中针对二进制非建模数据进行base64的加密处理 |
| `PicFeaturePoints` | opt | array | — | 特征图片坐标 · 图片特征点下发,若设备仅支持3种类型的特征点,平台下发3种以上特征点时,设备不能报错 &nbsp; 背景：不同设备人脸评分算法不一致,导致平台… |
| `PicFeaturePoints.featurePointType` | req | enum | 枚举：face # 人脸,leftEye # 左眼,rightEye # 右眼,leftMouthCorner # 左嘴角,rightMouthCorner # 右嘴角,nose # 鼻子 | 特征点类型 · 必填,string,特征点类型:face-人脸,leftEye-左眼,rightEye-右眼,leftMouthCorner-左嘴角,right… |
| `PicFeaturePoints.coordinatePoint` | opt | object | — | 点坐标 |
| `PicFeaturePoints.coordinatePoint.x` | req | int | range 0,1000 | x坐标 · 坐标进行归一化处理 |
| `PicFeaturePoints.coordinatePoint.y` | req | int | range 0,1000 | y坐标 · 坐标进行归一化处理 |
| `PicFeaturePoints.coordinatePoint.width` | opt | int | range 0,1000 | 宽度 · 当featurePointType为face时必填 |
| `PicFeaturePoints.coordinatePoint.height` | opt | int | range 0,1000 | 高度 · 当featurePointType为face时必填 |
| `faceType` | opt | enum | 枚举：normalFace # 普通人脸（默认）,patrolFace # 巡更人脸,hijackFace # 胁迫人脸,superFace # 超级人脸 | 人脸类型 |
| `saveFacePic` | opt | bool | — | 是否保存人脸底图 |
| `leaderPermission` | opt | array | range 1,4 | 首次认证权限 · 数组为空表示清空人员首次认证权限 表示人员具有1,2,3,4门编号的首次认证权限 |


**响应字段**（仅列顶层与关键嵌套；完整结构见原文 §1.3）

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `statusCode` | opt | int | — | 状态码 · 无法用1表示时（1表示成功且无特殊状态）必须返回 |
| `statusString` | opt | string | range 1,64 | 状态描述 · 无法用OK表示时（OK表示成功且无特殊状态）必须返回 |
| `subStatusCode` | opt | string | range 1,64 | 子状态码 · 无法用ok表示（ok表示成功且无特殊状态）必须返回 |
| `errorCode` | opt | int | — | 错误码 · 当statusCode不为1时，与subStatusCode对应 |
| `errorMsg` | opt | string | — | 错误信息 · 当statusCode不为1时，必须返回,解释信息在协议约束中，允许设备在后续的版本迭代中，进行优化丰富提升（不限制死） |
| `MErrCode` | opt | string | — | 功能模块化错误 · 通用错误码都在此字段范围中 |
| `MErrDevSelfEx` | opt | string | — | 功能模块化错误码 · 此字段是MErrCode自定义模块化错误码的扩展字段，自定义模块化错误码一共有MErrCode 的后20bit和此字段的32bit |


### 1.4 修改指定人脸库中的人脸数据

- 用途：修改人脸（按 FDID + FPID 定位）
- 请求：`PUT /ISAPI/Intelligent/FDLib/FDSearch?format=json&FDID=<FDID>&FPID=<FPID>&faceLibType=<faceLibType>`

**最小请求体骨架**（按必填字段自动生成，仅示意结构）

```json
{
  "name": "<string>",
  "bornTime": "<string>",
  "PicFeaturePoints": [
    {
      "featurePointType": "face",
      "coordinatePoint": {
        "x": 0,
        "y": 0
      }
    }
  ]
}
```

**请求字段**

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `faceURL` | opt | string | range 0,256 | 人脸图片URL方式上传时输入的图片存储URL |
| `name` | req | string | range 0,96 | 人脸图片对应的人员姓名 |
| `gender` | opt | enum | 枚举：male # 男,female # 女,unknown # 未知 | 人脸图片对应的人员性别 |
| `bornTime` | req | date | — | 人脸图片对应的人员出生日期 |
| `city` | opt | string | — | 人脸图片对应的人员出生城市编号(详见全国各省份城市列表) |
| `certificateType` | opt | enum | 枚举：officerID # 军官证,ID # 身份证,other # 其他,LawyerCertificate # 律师证,birthCertificate # 出生证明,householdRegister # 户口簿,ju… | 证件类型 |
| `certificateNumber` | opt | string | — | 证件号 |
| `caseInfo` | opt | string | range 0,192 | 备注信息 · dep if type == blackFD |
| `tag` | opt | string | range 0,195 | 自定义标签 · 单个标签最大48字节,(最多4个标签,英文逗号隔开,最大长度为195字节),dep if faceLibType == blackFD |
| `address` | opt | string | range 0,192 | 人员住址 · dep if faceLibType == staticFD |
| `customInfo` | opt | string | range 0,192 | 自定义信息 · dep if faceLibType == staticFD |
| `modelData` | opt | string | — | 目标模型数据 · 传输过程中针对二进制非建模数据进行base64的加密处理 |
| `rowKey` | opt | string | range 0,64 | 人脸记录数据库主键 · 根据rowKey进行查询,能提高查找效率 |
| `transfer` | opt | bool | — | 是否转存 · PBG对接,需要设备开启微视云安全认证,为了兼容原有功能,对部分协议进行变更,&nbsp; 涉及到名单添加和名单修改2个接口,协议中增加是否转存的… |
| `PicFeaturePoints` | opt | array | — | 图片特征点下发 · 若设备仅支持3种类型的特征点,平台下发3种以上特征点时,设备不能报错 &nbsp; 背景：不同设备人脸评分算法不一致,导致平台评分通过的人脸… |
| `PicFeaturePoints.featurePointType` | req | enum | 枚举：face # 人脸,leftEye # 左眼,rightEye # 右眼,leftMouthCorner # 左嘴角,rightMouthCorner # 右嘴角,nose # 鼻子 | 特征点类型 |
| `PicFeaturePoints.coordinatePoint` | opt | object | — | 区域 · 坐标原点位于左上方 |
| `PicFeaturePoints.coordinatePoint.x` | req | int | range 0,1000 | x坐标 · 坐标进行归一化处理,归至0-1000 |
| `PicFeaturePoints.coordinatePoint.y` | req | int | range 0,1000 | y坐标 · 坐标进行归一化处理,归至0-1000 |
| `PicFeaturePoints.coordinatePoint.width` | opt | int | range 0,1000 | 宽度 · 当featurePointType为face时必填 |
| `PicFeaturePoints.coordinatePoint.height` | opt | int | range 0,1000 | 高度 · 当featurePointType为face时必填 |
| `faceType` | opt | enum | 枚举：normalFace # 普通人脸（默认）,patrolFace # 巡更人脸,hijackFace # 胁迫人脸,superFace # 超级人脸 | 人脸类型 |
| `saveFacePic` | opt | bool | — | 是否保存人脸底图 |
| `leaderPermission` | opt | array | range 1,4 | 首次认证权限 · 数组为空表示清空人员首次认证权限 表示人员具有1,2,3,4门编号的首次认证权限 |


**响应字段**（仅列顶层与关键嵌套；完整结构见原文 §1.4）

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `statusCode` | opt | int | — | 状态码 · 无法用1表示时（1表示成功且无特殊状态）必须返回 |
| `statusString` | opt | string | range 1,64 | 状态描述 · 无法用OK表示时（OK表示成功且无特殊状态）必须返回 |
| `subStatusCode` | opt | string | range 1,64 | 子状态码 · 无法用ok表示（ok表示成功且无特殊状态）必须返回 |
| `errorCode` | opt | int | — | 错误码 · 当statusCode不为1时，与subStatusCode对应 |
| `errorMsg` | opt | string | — | 错误信息 · 当statusCode不为1时，必须返回,解释信息在协议约束中，允许设备在后续的版本迭代中，进行优化丰富提升（不限制死） |
| `MErrCode` | opt | string | — | 功能模块化错误 · 通用错误码都在此字段范围中 |
| `MErrDevSelfEx` | opt | string | — | 功能模块化错误码 · 此字段是MErrCode自定义模块化错误码的扩展字段，自定义模块化错误码一共有MErrCode 的后20bit和此字段的32bit |


### 1.5 查找人脸库中的人脸数据

- 用途：查询人脸
- 请求：`POST /ISAPI/Intelligent/FDLib/FDSearch?format=json`

**最小请求体骨架**（按必填字段自动生成，仅示意结构）

```json
{
  "searchResultPosition": 0,
  "maxResults": 0,
  "faceLibType": "blackFD",
  "FDID": "<string>"
}
```

**请求字段**

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `searchResultPosition` | req | int | — | 查询结果在结果列表中的起始位置 · 当记录条数很多时,一次查询不能获取所有的记录,下一次查询时指定位置可以查询后面的记录 |
| `maxResults` | req | int | range 1,100 | 本次查询最大记录数 |
| `faceLibType` | req | enum | 枚举：blackFD # 名单库,staticFD # 静态库,infraredFD # 红外人脸库 | 人脸库类型 |
| `FDID` | req | string | range 1,64 | 人脸库ID · 当需要查询多个人脸库时，用逗号隔开。 |
| `FPID` | opt | string | range 1,64 | 人脸记录ID · 不支持查询多个人脸记录 |
| `startTime` | opt | string | — | 起始出生日期 |
| `endTime` | opt | string | — | 截止出生日期 |
| `name` | opt | string | — | 姓名 |
| `gender` | opt | enum | 枚举：any # 条件不限（搜索的时候使用）,female # 女,male # 男,unknown # 未知 | 性别 |
| `city` | opt | string | — | 城市编码 · 出生城市编号(详见:全国各省份城市列表) |
| `certificateType` | opt | enum | 枚举：ID # 身份证,LawyerCertificate # 律师证,birthCertificate # 出生证明,householdRegister # 户口簿,judgeCertificate # 法官证,office… | 证件类型 |
| `certificateNumber` | opt | string | range 1,64 | 证件号 |
| `isInLibrary` | opt | enum | 枚举：unknown # 未知,no # 未入库,yes # 已入库 | 是否入库 · 即按建模是否成功来进行查询 |
| `isDisplayCaptureNum` | opt | bool | — | 显示抓拍数量 |
| `rowKey` | opt | string | — | 人脸记录数据库主键 · 根据rowKey进行查询,能提高查找效率 |
| `transfer` | opt | bool | — | 转存 · PBG对接,需要设备开启微视云安全认证,为了兼容原有功能,对部分协议进行变更,涉及到名单添加和名单修改2个接口,协议中增加是否转存的字段,不填默认不转… |
| `updateType` | opt | enum | 枚举：full # 全量,latest # 最近一次更新 | 人脸信息更新类型 · B86物联中控主机新增。 full：表示PAD在规定的时间范围内向主机拉取全量的人脸信息。 latest：表示PAD当前操作只拉取最新一次… |


**响应字段**（仅列顶层与关键嵌套；完整结构见原文 §1.5）

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `requestURL` | opt | string | — | 请求URL |
| `statusCode` | req | int | — | 状态码 |
| `statusString` | req | string | — | 状态描述 |
| `subStatusCode` | req | enum | 枚举：ok # 成功,activeNumMax # 已达License允许接入最大设备数目,licenseExpired # License过期 | 子状态码 |
| `errorCode` | opt | int | — | 当statusCode不为1时 |
| `errorMsg` | opt | string | — | 当statusCode不为1时 |
| `responseStatusStrg` | opt | enum | 枚举：OK # 查询结束,MORE # 还有数据等待查询,NO MATCH # 没有匹配数据 | 查询状态 |
| `numOfMatches` | opt | int | — | 本次返回的记录条数 |
| `totalMatches` | opt | int | — | 符合条件的记录总条数 |
| `MatchList` | opt | array | — | 查询到的匹配数据信息 |
| `MatchList.FDID` | opt | string | range 1,64 | 人脸库ID |
| `MatchList.FDName` | opt | string | — | 人脸库的名称 |
| `MatchList.FPID` | opt | string | range 1,64 | 人脸记录ID |
| `MatchList.faceURL` | opt | string | — | 人脸图片URL |
| `MatchList.name` | opt | string | — | 姓名 |
| `MatchList.gender` | opt | enum | 枚举：any # 条件不限（搜索的时候使用）,female # 女,male # 男,unknown # 未知 | 性别 |
| `MatchList.bornTime` | opt | string | — | 人员的出生日期 |
| `MatchList.city` | opt | string | — | 出生城市编号(详见全国各省份城市列表 string类型 |
| `MatchList.certificateType` | req | enum | 枚举：ID # 身份证,LawyerCertificate # 律师证,birthCertificate # 出生证明,householdRegister # 户口簿,judgeCertificate # 法官证,office… | 证件类型 |
| `MatchList.certificateNumber` | opt | string | range 1,64 | 证件号 |
| `MatchList.caseInfo` | opt | string | — | 备注信息 |
| `MatchList.tag` | opt | string | — | 自定义标签 |
| `MatchList.address` | opt | string | — | 人员住址 |
| `MatchList.customInfo` | opt | string | — | 自定义信息 |
| `MatchList.isInLibrary` | opt | enum | 枚举：unknown # 未知,no # 未入库,yes # 已入库 | 是否入库 · 即按建模是否成功来进行查询 |
| `MatchList.captureNum` | opt | int | — | 抓拍数量 |
| `MatchList.rowKey` | opt | string | — | 人脸记录数据库主键 · 根据rowKey进行查询,能提高查找效率 |
| `MatchList.modelData` | opt | string | — | 目标模型数据 · 传输过程中对二进制建模数据进行base64编码处理 |
| `MatchList.faceType` | opt | enum | 枚举：normalFace # 普通人脸（默认）,patrolFace # 巡更人脸,hijackFace # 胁迫人脸,superFace # 超级人脸 | 人脸类型 |
| `MatchList.saveFacePic` | opt | bool | — | 是否保存人脸底图 |

> 仅列前 30 项，原文共 36 项，完整字段见官方原文。

### 1.6 添加人脸数据

- 用途：添加人脸（只新增）
- 请求：`POST /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json`

**最小请求体骨架**（按必填字段自动生成，仅示意结构）

```json
{
  "faceLibType": "blackFD",
  "FDID": "<string>",
  "name": "<string>",
  "bornTime": "<string>",
  "PicFeaturePoints": [
    {
      "featurePointType": "face",
      "coordinatePoint": {
        "x": 0,
        "y": 0
      }
    }
  ],
  "cutOutRect": {
    "x": 0,
    "y": 0,
    "width": 0,
    "height": 0
  }
}
```

**请求字段**

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `faceURL` | opt | string | — | 人脸url · 本字段和modelData字段二选一必填 |
| `faceLibType` | req | enum | 枚举：blackFD # 名单库,staticFD # 静态库,infraredFD # 红外人脸库 | 人脸库类型 · 人脸库类型: blackFD-名单库,staticFD-静态库,string类型,最大长度为32 |
| `FDID` | req | string | range 1,64 | 人脸库ID |
| `FPID` | opt | string | range 1,1000 | 人脸记录ID · 人脸记录ID（与非视频工号（人员ID）字段一致）,对应门禁设备,业务上该字段为必填 |
| `name` | req | string | range 1,1000 | 人脸图片对应的人员姓名 · 最大长度为96字节 |
| `gender` | opt | enum | 枚举：male # 男,female # 女,unknown # 未知 | 人脸图片对应的人员性别 · 最大长度为32 |
| `bornTime` | req | string | — | 人脸图片对应的人员出生日期 · 最大长度为20 |
| `city` | opt | string | — | 人脸图片对应的人员出生城市编号 · 人脸图片对应的人员出生城市编号(详见:全国各省份城市列表),string类型,最大长度为32 |
| `certificateType` | opt | enum | 枚举：ID # 身份证,officerID # 军官证,other # 其他,LawyerCertificate # 律师证,birthCertificate # 出生证明,householdRegister # 户口簿,ju… | 证件类型 |
| `certificateNumber` | opt | string | range 1,64 | 证件号 · 由数字和字母 "0-9a-zA-Z"组成 |
| `caseInfo` | opt | string | — | 备注信息 · string类型,最大长度为192字节,{dep if type == blackFD} |
| `tag` | opt | string | — | 自定义标签 · 自定义标签,单个标签最大48字节,(最多4个标签,英文逗号隔开,最大长度为195字节),string类型,,{dep if faceLibTyp… |
| `address` | opt | string | — | 人员住址 · 最大长度为192字节,{dep if faceLibType == staticFD } |
| `customInfo` | opt | string | — | 自定义信息 · 最大长度为192字节,{dep if faceLibType == staticFD } |
| `modelData` | opt | string | — | 目标模型数据 · 目标模型数据，字符串类型，传输过程中针对二进制非建模数据进行base64的加密处理；本字段和faceURL字段二选一必填 |
| `transfer` | opt | bool | — | PBG对接 · boolean类型，PBG对接，需要设备开启微视云安全认证，为了兼容原有功能，对部分协议进行变更， 涉及到名单添加和名单修改2个接口，协议中增加… |
| `operateType` | opt | enum | 枚举：byTerminal # 按终端操作 | 操作类型 |
| `terminalNoList` | opt | array | — | type为byTerminal · type为byTerminal,byTerminalOrg时必填,终端ID列表（目前仅支持单个终端） |
| `PicFeaturePoints` | opt | array | — | 图片特征点坐标 |
| `PicFeaturePoints.featurePointType` | req | enum | 枚举：face # 人脸,leftEye # 左眼,rightEye # 右眼,leftMouthCorner # 左嘴角,rightMouthCorner # 右嘴角,nose # 鼻子 | 特征点类型 · 特征点类型:face-人脸,leftEye-左眼,rightEye-右眼,leftMouthCorner-左嘴角,rightMouthCorne… |
| `PicFeaturePoints.coordinatePoint` | opt | object | — | 坐标点 · 坐标原点位于左上方,坐标基于当前导入的图片 |
| `PicFeaturePoints.coordinatePoint.x` | req | int | range 0,1000 | x坐标 · 坐标进行归一化处理 |
| `PicFeaturePoints.coordinatePoint.y` | req | int | range 0,1000 | y坐标 · 坐标进行归一化处理 |
| `PicFeaturePoints.coordinatePoint.width` | opt | int | range 0,1000 | 宽度 · 当featurePointType为face时必填 |
| `PicFeaturePoints.coordinatePoint.height` | opt | int | range 0,1000 | 高度 · 当featurePointType为face时必填 |
| `cutOutRect` | opt | object | — | 图片裁剪框 · 坐标原点位于左上方,用于抠图的目标框 |
| `cutOutRect.x` | req | float | range 0,1 | x坐标 · 坐标进行归一化处理 |
| `cutOutRect.y` | req | float | range 0,1 | y坐标 · 坐标进行归一化处理 |
| `cutOutRect.width` | req | float | range 0,1 | 宽度 |
| `cutOutRect.height` | req | float | range 0,1 | 高度 |
| `faceType` | opt | enum | 枚举：normalFace # 普通人脸（默认）,patrolFace # 巡更人脸,hijackFace # 胁迫人脸,superFace # 超级人脸 | 人脸类型 |
| `saveFacePic` | opt | bool | — | 是否保存人脸底图 |
| `leaderPermission` | opt | array | range 1,4 | 首次认证权限 · 数组为空表示清空人员首次认证权限 表示人员具有1,2,3,4门编号的首次认证权限 |


**响应字段**（仅列顶层与关键嵌套；完整结构见原文 §1.6）

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `requestURL` | opt | string | — | 请求URL |
| `statusCode` | req | int | — | 状态码 |
| `statusString` | req | string | — | 状态描述 |
| `subStatusCode` | req | string | — | 子状态码 |
| `errorCode` | opt | int | — | 错误码 · 当statusCode不为1时 |
| `errorMsg` | opt | string | — | 错误描述 · 当statusCode不为1时 |
| `FPID` | opt | string | range 1,64 | 人脸记录ID · 人脸数据添加成功之后返回的人脸记录ID,具有唯一性 {dep if errcode == 1 && errMsg == ok} |
| `rowKey` | opt | string | — | 人脸记录rowKey · 人脸数据添加成功之后返回的人脸记录rowKey,具有唯一性,string类型,最大长度为64字节,{dep if errcode ==… |


### 1.7 获取人员数量

- 用途：查人员数量
- 请求：`GET /ISAPI/AccessControl/UserInfo/Count?format=json&type=<type>`

**请求字段**

_无请求体字段（查询参数承载）_

**响应字段**（仅列顶层与关键嵌套；完整结构见原文 §1.7）

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `UserInfoCount` | req | object | — | 用户数量 |


### 1.9 设置人员信息

- 用途：设置人员信息（新增或修改）
- 请求：`PUT /ISAPI/AccessControl/UserInfo/SetUp?format=json`

**最小请求体骨架**（按必填字段自动生成，仅示意结构）

```json
{
  "UserInfo": {
    "employeeNo": "<string>",
    "userType": "normal",
    "Valid": {
      "enable": false,
      "beginTime": "<string>",
      "endTime": "<string>"
    },
    "deviceInfoList": [
      {
        "devShortSerialNum": "<string>"
      }
    ],
    "phoneNoList": [
      {
        "phoneNo": "<string>"
      }
    ]
  }
}
```

**请求字段**

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `UserInfo` | req | object | — | 人员信息 |
| `UserInfo.employeeNo` | req | string | range 1,32 | 工号（人员ID） · 默认仅支持数字、字母，门禁主机产品额外支持特殊字符'-'，门口机产品未做字符限制，信发门牌产品支持中文。 |
| `UserInfo.deleteUser` | opt | bool | — | 是否删除该人员 |
| `UserInfo.name` | opt | string | range 0,128 | 姓名 |
| `UserInfo.userType` | req | enum | 枚举：normal # 普通人（主人）,visitor # 来宾（访客）,blackList # 非授权名单人,maintenance # 维护人员（包括保洁、维修人员等),patient # 病患,custom1 # 自定义… | 人员类型 · maintenance：维护人员需要在任意时间都能进入房间，administrator：人员对所有门/楼层具备访问权限，设备无需校验doorRig… |
| `UserInfo.onlyVerify` | opt | bool | — | 该人员是否仅认证 |
| `UserInfo.closeDelayEnabled` | opt | bool | — | 是否关门延迟 · true-是，false-否 |
| `UserInfo.Valid` | req | object | — | 有效期参数 · （enable不使能代表长期有效）（有效时间跨度为1970年1月1日0点0分0秒~2037年12月31日23点59分59秒） |
| `UserInfo.Valid.enable` | req | bool | — | 使能有效期 · 1、enable为true，表示人员非长期有效，且beginTime必须严格小于endTme；2、enable为false，表示人员长期有效，这… |
| `UserInfo.Valid.beginTime` | req | string | — | 有效期起始时间 · timeType字段不存在或为local时，beginTime为设备本地时间，如：2017-08-01T17:30:08；timeType字… |
| `UserInfo.Valid.endTime` | req | string | — | 有效期结束时间 · timeType字段不存在或为local时，endTime为设备本地时间，如：2017-08-01T17:30:08；timeType字段为… |
| `UserInfo.Valid.timeType` | opt | enum | 枚举：local # 设备本地时间,UTC # UTC时间 | 时间类型 |
| `UserInfo.belongGroup` | opt | string | — | 所属群组 |
| `UserInfo.linkageUpdateAuthMemberNum` | opt | bool | — | 关联更新本群组在多重认证组中参与认证的人员数量 · 1、默认为false。场景：群组1含义人员1和2，多重认证组1中设置群组1参与认证人员数量为2，当修改人员1… |
| `UserInfo.password` | opt | string | — | 密码 |
| `UserInfo.localPassword` | opt | string | range 4,8 | 单机密码 · 仅限在单机管理密码模式下（可通过/ISAPI/AccessControl/UserAndRight/PwMgrParams?format=json… |
| `UserInfo.doorRight` | opt | string | — | 门权限 · 1、当配置为空时，表示人员没有门权限，且RightPlan一般与doorRight配合使用。2、当只下发doorRight，不下发RightPlan… |
| `UserInfo.RightPlan` | opt | array | — | 门权限计划（锁权限计划） · 1、只下发RightPlan，不下发doorRight，设备需报错。2、doorRight和RightPlan均下发时，设备需校验… |
| `UserInfo.RightPlan.doorNo` | opt | int | — | 门编号（锁ID） |
| `UserInfo.RightPlan.planTemplateNo` | opt | string | — | 计划模板编号 · 同个门不同计划模板采用权限“或的”方式处理，默认无计划模板编号。65535-7*24小时生效，65534-周一到周五24小时生效，65533-… |
| `UserInfo.maxOpenDoorTime` | opt | int | — | 最大认证次数 · 0为无次数限制 |
| `UserInfo.openDoorTime` | opt | int | — | 已认证次数 |
| `UserInfo.roomNumber` | opt | int | — | 房间号 |
| `UserInfo.floorNumber` | opt | int | — | 层号 |
| `UserInfo.doubleLockRight` | opt | bool | — | 反锁开门权限 · true-有权限，false-无权限 |
| `UserInfo.localUIRight` | opt | bool | — | 是否具有设备本地UI访问权限 · true-有权限，false-无权限 |
| `UserInfo.linkageUserID` | opt | enum | 枚举：1 # 本地管理员,2 # 人员管理员 | 关联的用户序号 · 1、localUIRight为true，linkageUserID不下发或者下发为1，表示本地管理员。 2、localUIRight为tru… |
| `UserInfo.userVerifyMode` | opt | enum | 枚举：cardAndPw # 刷卡+密码,card # 刷卡,cardOrPw # 刷卡或密码,fp # 指纹,fpAndPw # 指纹+密码,fpOrCard # 指纹或刷卡,fpAndCard # 指纹+刷卡,fpAndC… | 人员验证方式 · 人员验证方式的优先级高于读卡器验证方式，若为空表示人员验证方式无效。 |
| `UserInfo.checkUser` | opt | bool | — | 设备是否进行人员重复添加校验 · false-不校验，true-校验（如果不配置该字段，则设备默认进行人员重复校验）（如果确认设备端不存在任何人员信息，可将其置… |
| `UserInfo.gender` | opt | enum | 枚举：male # 男,female # 女,unknown # 未知 | 人脸图片对应的人员性别 |
| `UserInfo.PersonInfoExtends` | opt | array | — | 人员信息扩展 · 用于配置人员在设备UI界面的扩展信息显示，明眸当前仅支持一个value，不支持id字段，用于作为工号显示；智能主机按标准实现。 |
| `UserInfo.PersonInfoExtends.id` | opt | int | range 1,32 | 人员信息扩展序号 · 与/ISAPI/AccessControl/personInfoExtendName?format=json中的id对应，用于关联valu… |
| `UserInfo.PersonInfoExtends.value` | opt | string | — | 人员信息扩展内容 |
| `UserInfo.dynamicCode` | opt | string | — | 动态权限码 |
| `UserInfo.callNumbers` | opt | array | — | 呼叫号码列表 · （1）roomNumber的扩展，支持多房间号，两者同时存在时，优先解析callNumbers。（2）楼宇对讲：1、国内规则：1-1-1-层号… |
| `UserInfo.callNumbersContactsDisplay` | opt | array | — | 房间号是否显示在人员通讯录中 · 1、要求顺序与callNumbers中的元素一一对应。2、默认为true。3、当设备不支持callNumbers，仅支持roo… |
| `UserInfo.floorNumbers` | opt | array | — | 层号列表 · floorNumber的扩展，支持多层，两者同时存在时，优先解析floorNumbers。要求floorNumbers与callNumbers的数… |
| `UserInfo.groupId` | opt | int | — | 本地考勤组织编号 |
| `UserInfo.localAtndPlanTemplateId` | opt | int | — | 本地考勤计划模板 |
| `UserInfo.groupName` | opt | string | range 1,64 | 组织架构 |

> 仅列前 40 项，原文共 53 项，完整字段见官方原文。

**响应字段**（仅列顶层与关键嵌套；完整结构见原文 §1.9）

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `statusCode` | opt | int | — | 状态码 · 无法用1表示时（1表示成功且无特殊状态）必须返回 |
| `statusString` | opt | string | range 1,64 | 状态描述 · 无法用OK表示时（OK表示成功且无特殊状态）必须返回 |
| `subStatusCode` | opt | string | range 1,64 | 子状态码 · 无法用ok表示（ok表示成功且无特殊状态）必须返回 |
| `errorCode` | opt | int | — | 错误码 · 当statusCode不为1时，与subStatusCode对应 |
| `errorMsg` | opt | string | — | 错误信息 · 当statusCode不为1时，必须返回,解释信息在协议约束中，允许设备在后续的版本迭代中，进行优化丰富提升（不限制死） |
| `MErrCode` | opt | string | — | 功能模块化错误 · 通用错误码都在此字段范围中 |
| `MErrDevSelfEx` | opt | string | — | 功能模块化错误码 · 此字段是MErrCode自定义模块化错误码的扩展字段，自定义模块化错误码一共有MErrCode 的后20bit和此字段的32bit |


### 1.11 查询人员信息

- 用途：查询人员信息
- 请求：`POST /ISAPI/AccessControl/UserInfo/Search?format=json`

**最小请求体骨架**（按必填字段自动生成，仅示意结构）

```json
{
  "UserInfoSearchCond": {
    "searchID": "<string>",
    "searchResultPosition": 0,
    "maxResults": 0,
    "EmployeeNoList": [
      {
        "employeeNo": "<string>"
      }
    ]
  }
}
```

**请求字段**

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `UserInfoSearchCond` | req | object | — | 查询条件 |
| `UserInfoSearchCond.searchID` | req | string | — | 搜索记录唯一标识 · 搜索记录唯一标识,用来确认上层客户端是否为同一个(倘若是同一个,设备记录内存,下次搜索加快速度),string类型 |
| `UserInfoSearchCond.searchResultPosition` | req | int | — | 查询结果在结果列表中的起始位置 · 1、当记录条数很多时,一次查询不能获取所有的记录,下一次查询时指定位置可以查询后面的记录（若设备支持的最大totalMatc… |
| `UserInfoSearchCond.maxResults` | req | int | — | 本次协议调用可获取的最大记录数 · 如maxResults值大于设备能力集返回的范围，则设备按照能力集最大值返回，设备不进行报错 |
| `UserInfoSearchCond.EmployeeNoList` | opt | array | — | 人员ID列表 · EployeeNoList字段不存在或为空时，代表查询所有人员 |
| `UserInfoSearchCond.EmployeeNoList.employeeNo` | req | string | range 1,32 | 工号 |
| `UserInfoSearchCond.fuzzySearch` | opt | string | range 1,32 | 模糊查询关键字 · 敏感信息加密 |
| `UserInfoSearchCond.groupIdList` | opt | array | — | 本地考勤组织编号查询范围 |
| `UserInfoSearchCond.groupNameList` | opt | array | — | 本地考勤组织名称查询范围 |
| `UserInfoSearchCond.arrangeType` | opt | enum | 枚举：personal # 个人排班,group # 部门排班,all # 所有已排班,none # 所有未排班 | 排班类型 · 该字段存在时表示查询处于个人排班、部门排班、已排班状态的人 |
| `UserInfoSearchCond.userType` | opt | enum | 枚举：normal # 普通人（主人),visitor # 来宾（访客),blackList # 非授权名单人,patient # 病患,maintenance # 维护人员,custom1 # 自定义人员类型1,custom… | 人员类型 |
| `UserInfoSearchCond.deviceIDList` | opt | array | — | 要查询的设备编号(床位)列表 |
| `UserInfoSearchCond.hasFace` | opt | bool | — | 已录入人脸 |
| `UserInfoSearchCond.hasCard` | opt | bool | — | 已录入卡 |
| `UserInfoSearchCond.hasFingerprint` | opt | bool | — | 已录入指纹 |
| `UserInfoSearchCond.hasIris` | opt | bool | — | 已录入虹膜 |
| `UserInfoSearchCond.hasVoiceprint` | opt | bool | — | 已录入声音 |
| `UserInfoSearchCond.hasIDCard` | opt | bool | — | 已录入身份证 |
| `UserInfoSearchCond.hasCollection` | opt | bool | — | 已完成凭证采集 · 当设备处于采集模式时，若开启采集人员名单,本字段用于区分采集人员名单中的人员是否已完成凭证采集 |
| `UserInfoSearchCond.hasRemoteControl` | opt | bool | — | 已录入遥控器 |
| `UserInfoSearchCond.hasPPAndPV` | opt | bool | — | 已录入掌纹掌静脉 |
| `UserInfoSearchCond.userLevel` | opt | enum | 枚举：Employee # 普通员工,DepartmentManager # 部门主管 | 用户级别 |
| `UserInfoSearchCond.meetingID` | opt | string | range 1,32 | 会议编号UUID · UI可根据会议ID查询该会议下的人员信息，然后根据会议签到状态进行过滤，在会议签到历史页面展示出正常签到、迟到的人员信息。 |
| `UserInfoSearchCond.sortByNameFlag` | opt | enum | 枚举：! # 姓名特殊人员,A # A,B # B,C # C,D # D,E # E,F # F,G # G,H # H,I # I,J # J,K # K,L # L,M # M,N # N,O # O,P # P,Q #… | 姓名排序标识 · 1、包含!，A~Z，其中!表示姓名为空或者首字符为特殊符号的人员。2、用于首次进入通讯录页面（!）和按照类型（!，A~Z）查询。3、若查询数量… |
| `UserInfoSearchCond.sortByBoxNumFlag` | opt | bool | — | 格口占用数量排序标识 · 1、不下发该字段，默认为false。2、当为true时，表示人员信息查询时，按照人员占用格口数量从大到小进行排序。当人员占用的格口数量… |
| `UserInfoSearchCond.isLinkageUserGroup` | opt | bool | — | 是否关联人员组织 · 1、true-查询关联人员组织的人员，且需要下发userGroupNodeID字段，具体指明哪一个人员组织；2、false-查询未关联人员… |
| `UserInfoSearchCond.userGroupNodeID` | opt | string | range 1,32 | 人员组织编号 · 单个人员组织的唯一标识，由数字、大小写字母组成。 |
| `UserInfoSearchCond.isDisplaySubGroupNode` | opt | bool | — | 是否显示子人员组织 · true-显示，false-不显示，不下发该字段，默认为true |
| `UserInfoSearchCond.groupID` | opt | int | range 1,32 | 群组编号 · 指的是多重认证里面的群组概念 |
| `UserInfoSearchCond.remoteControlNo` | opt | string | range 1,9 | 遥控器号 |
| `UserInfoSearchCond.regionPermissionGroupFlag` | opt | bool | — | 区域权限组关联标识 |
| `UserInfoSearchCond.regionPermissionGroupID` | opt | int | range 1,32 | 区域权限组编号 · 1、与regionPermissionGroupFlag字段配合使用，两者不可独立下发。2、当regionPermissionGroupFl… |
| `UserInfoSearchCond.groupDistributeUserType` | opt | enum | 枚举：allFailure # 历史分配失败的全部人员 | 区域权限组分配人员类型 · 本字段与regionPermissionGroupFlag、regionPermissionGroupID字段配合使用，不可单独下发… |
| `UserInfoSearchCond.roomNumber` | opt | int | — | 房间号 |
| `UserInfoSearchCond.filterValidFloor` | opt | bool | — | 按最大有效楼层数过滤 · 不下发该字段，默认为false，按照设备支持的最大楼层能力返回。场景：梯控主机，平台端事先设置为128层，后Web端调整为32层，则W… |


**响应字段**（仅列顶层与关键嵌套；完整结构见原文 §1.11）

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `UserInfoSearch` | req | object | — | 查询结果 |
| `UserInfoSearch.searchID` | req | string | — | 搜索记录唯一标识 |
| `UserInfoSearch.responseStatusStrg` | req | enum | 枚举：OK # 查询结束,MORE # 还有数据等待查询,NO MATCH # 没有匹配数据 | 查询状态字符串描述 · OK-查询结束,MORE-还有数据等待查询,NO MATCH-没有匹配数据 |
| `UserInfoSearch.numOfMatches` | req | int | — | 本次返回的记录条数 |
| `UserInfoSearch.totalMatches` | req | int | — | 符合条件的记录总条数 |
| `UserInfoSearch.UserInfo` | opt | array | — | 人员信息 |
| `UserInfoSearch.UserInfo.employeeNo` | req | string | range 1,32 | 工号（人员ID） |
| `UserInfoSearch.UserInfo.name` | opt | string | range 0,128 | 姓名 |
| `UserInfoSearch.UserInfo.boxNum` | opt | int | range 0,200 | 占用格口数量 |
| `UserInfoSearch.UserInfo.userType` | req | enum | 枚举：normal # 普通人（主人),visitor # 来宾（访客),blackList # 非授权名单人,patient # 病患,maintenance # 维护人员（包括保洁、维修人员等),custom1 # 自定义… | 人员类型 |
| `UserInfoSearch.UserInfo.onlyVerify` | opt | bool | — | 该人员是否仅认证 |
| `UserInfoSearch.UserInfo.sortByNamePosition` | opt | int | range 0,99999 | 人员按照姓名排序后的实际位置编号 · 从0开始 |
| `UserInfoSearch.UserInfo.sortByNameFlag` | opt | enum | 枚举：! # 姓名特殊人员,A # A,B # B,C # C,D # D,E # E,F # F,G # G,H # H,I # I,J # J,K # K,L # L,M # M,N # N,O # O,P # P,Q #… | 姓名排序标识 |
| `UserInfoSearch.UserInfo.closeDelayEnabled` | opt | bool | — | 是否关门延迟 |
| `UserInfoSearch.UserInfo.Valid` | opt | object | — | 有效期参数 · 1、enable为true，表示人员非长期有效，且beginTime必须严格小于endTme；2、enable为false，表示人员长期有效，这… |
| `UserInfoSearch.UserInfo.Valid.enable` | req | bool | — | 使能有效期 |
| `UserInfoSearch.UserInfo.Valid.beginTime` | req | datetime | — | 有效期起始时间 · timeType字段不存在或为local时，beginTime为设备本地时间，如：2017-08-01T17:30:08；timeType字… |
| `UserInfoSearch.UserInfo.Valid.endTime` | req | datetime | — | 有效期结束时间 · timeType字段不存在或为local时，beginTime为设备本地时间，如：2017-08-01T17:30:08；timeType字… |
| `UserInfoSearch.UserInfo.Valid.timeType` | opt | enum | 枚举：local # 设备本地时间,UTC # UTC时间 | 时间类型 |
| `UserInfoSearch.UserInfo.belongGroup` | opt | string | — | 所属群组 |
| `UserInfoSearch.UserInfo.password` | opt | string | range 0,8 | 密码 · 当人员没有配置密码的时候，可返回为空 |
| `UserInfoSearch.UserInfo.localPassword` | opt | string | range 0,8 | 单机密码 · 仅限在单机管理密码模式下（可通过/ISAPI/AccessControl/UserAndRight/PwMgrParams?format=json… |
| `UserInfoSearch.UserInfo.doorRight` | opt | string | — | 门权限 · 1、当返回为空时，表示人员没有门权限，且RightPlan一般与doorRight配合使用。2、当只下发doorRight，不下发RightPlan… |
| `UserInfoSearch.UserInfo.RightPlan` | opt | array | — | 门权限计划 |
| `UserInfoSearch.UserInfo.RightPlan.doorNo` | opt | int | — | 门编号（锁ID） |
| `UserInfoSearch.UserInfo.RightPlan.doorName` | opt | string | range 0,32 | 门名称 |
| `UserInfoSearch.UserInfo.RightPlan.regionNodeName` | opt | string | range 0,32 | 门所属区域名称 |
| `UserInfoSearch.UserInfo.RightPlan.planTemplateNo` | opt | string | — | 计划模板编号 · 同个门不同计划模板采用权限“或的”方式处理，默认无计划模板编号。65535-7*24小时生效，65534-周一到周五24小时生效，65533-… |
| `UserInfoSearch.UserInfo.RightPlan.planTemplateName` | opt | array | — | 计划模板名称 · 计划模板名称和计划模板编号一一对应 |
| `UserInfoSearch.UserInfo.maxOpenDoorTime` | opt | int | — | 最大认证次数 |

> 仅列前 30 项，原文共 94 项，完整字段见官方原文。

### 1.12 添加人员信息

- 用途：添加人员信息（只新增）
- 请求：`POST /ISAPI/AccessControl/UserInfo/Record?format=json`

**最小请求体骨架**（按必填字段自动生成，仅示意结构）

```json
{
  "UserInfo": {
    "employeeNo": "<string>",
    "userType": "normal",
    "Valid": {
      "enable": false,
      "beginTime": "<string>",
      "endTime": "<string>"
    },
    "deviceInfoList": [
      {
        "devShortSerialNum": "<string>"
      }
    ],
    "phoneNoList": [
      {
        "phoneNo": "<string>"
      }
    ]
  }
}
```

**请求字段**

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `UserInfo` | req | object | — | 人员信息 |
| `UserInfo.employeeNo` | req | string | range 1,32 | 工号 · 默认仅支持数字、字母，门禁主机产品额外支持特殊字符'-'，门口机产品未做字符限制，信发门牌产品支持中文。 |
| `UserInfo.name` | opt | string | range 0,128 | 姓名 |
| `UserInfo.userType` | req | enum | 枚举：normal # 普通人（主人）,visitor # 来宾（访客）,blackList # 非授权名单人,maintenance # 维护人员（包括保洁、维修人员等),patient # 病患,custom1 # 自定义… | 人员类型 · maintenance：维护人员需要在任意时间都能进入房间，administrator：人员对所有门/楼层具备访问权限，设备无需校验doorRig… |
| `UserInfo.onlyVerify` | opt | bool | — | 该人员是否仅认证 |
| `UserInfo.closeDelayEnabled` | opt | bool | — | 是否关门延迟 |
| `UserInfo.Valid` | req | object | — | 人员有效期 |
| `UserInfo.Valid.enable` | req | bool | — | 使能有效期 · 1、enable为true，表示人员非长期有效，且beginTime必须严格小于endTme；2、enable为false，表示人员长期有效，这… |
| `UserInfo.Valid.beginTime` | req | datetime | — | 有效期起始时间 · timeType字段不存在或为local时，beginTime为设备本地时间，如：2017-08-01T17:30:08；timeType字… |
| `UserInfo.Valid.endTime` | req | datetime | — | 有效期结束时间 · timeType字段不存在或为local时，beginTime为设备本地时间，如：2017-08-01T17:30:08；timeType字… |
| `UserInfo.Valid.timeType` | opt | enum | 枚举：local # 设备本地时间,UTC # UTC时间 | 时间类型 |
| `UserInfo.belongGroup` | opt | string | — | 所属群组 |
| `UserInfo.password` | opt | string | range 4,8 | 凭证密码 · 纯数字组成 |
| `UserInfo.localPassword` | opt | string | range 4,8 | 单机密码 · 仅限在单机管理密码模式下（可通过/ISAPI/AccessControl/UserAndRight/PwMgrParams?format=json… |
| `UserInfo.doorRight` | opt | string | — | 门权限 · 1、当配置为空时，表示人员没有门权限，且RightPlan一般与doorRight配合使用。2、当只下发doorRight，不下发RightPlan… |
| `UserInfo.RightPlan` | opt | array | — | 门权限计划（锁权限计划） · 1、只下发RightPlan，不下发doorRight，设备需报错。2、doorRight和RightPlan均下发时，设备需校验… |
| `UserInfo.RightPlan.doorNo` | opt | int | — | 门编号（锁ID） |
| `UserInfo.RightPlan.planTemplateNo` | opt | string | — | 计划模板编号 · 同个门不同计划模板采用权限“或的”方式处理，默认无计划模板编号。65535-7*24小时生效，65534-周一到周五24小时生效，65533-… |
| `UserInfo.maxOpenDoorTime` | opt | int | — | 最大认证次数 · 0为无次数限制，认证次数配置与人员类型没有关联，但非授权人员配置的认证次数，设备实际不会生效，因为非授权人员没有访问权限。 |
| `UserInfo.roomNumber` | opt | int | — | 房间号 |
| `UserInfo.floorNumber` | opt | int | — | 层号 |
| `UserInfo.doubleLockRight` | opt | bool | — | 反锁开门权限 |
| `UserInfo.localUIRight` | opt | bool | — | 是否具有设备本地UI访问权限 |
| `UserInfo.linkageUserID` | opt | enum | 枚举：1 # 本地管理员,2 # 人员管理员 | 关联的用户序号 · 1、localUIRight为true，linkageUserID不下发或者下发为1，表示本地管理员。 2、localUIRight为tru… |
| `UserInfo.userVerifyMode` | opt | enum | 枚举：cardAndPw # 刷卡+密码,card # 刷卡,cardOrPw # 刷卡或密码,fp # 指纹,fpAndPw # 指纹+密码,fpOrCard # 指纹或刷卡,fpAndCard # 指纹+刷卡,fpAndC… | 人员验证方式 · 人员验证方式的优先级高于读卡器验证方式，若为空表示人员验证方式无效。 |
| `UserInfo.checkUser` | opt | bool | — | 设备是否进行人员重复添加校验 · false-不校验，true-校验（如果不配置该字段，则设备默认进行人员重复校验）（如果确认设备端不存在任何人员信息，可将其置… |
| `UserInfo.gender` | opt | enum | 枚举：male # 男,female # 女,unknown # 未知 | 人脸图片对应的人员性别 |
| `UserInfo.PersonInfoExtends` | opt | array | — | 人员信息扩展 · 用于配置人员在设备UI界面的扩展信息显示，明眸当前仅支持一个value，不支持id字段，用于作为工号显示；智能主机按标准实现。 |
| `UserInfo.PersonInfoExtends.id` | opt | int | range 1,32 | 人员信息扩展序号 · 与/ISAPI/AccessControl/personInfoExtendName?format=json中的id对应，用于关联valu… |
| `UserInfo.PersonInfoExtends.value` | opt | string | — | 人员信息扩展内容 |
| `UserInfo.operateType` | opt | string | — | 操作类型 · byTerminal:按终端操作 |
| `UserInfo.terminalNoList` | opt | array | — | 终端ID列表 · type为byTerminal,byTerminalOrg时必填,终端ID列表（目前仅支持单个终端） |
| `UserInfo.dynamicCode` | opt | string | — | 动态权限码 |
| `UserInfo.callNumbers` | opt | array | — | 呼叫号码列表 · （1）roomNumber的扩展，支持多房间号，两者同时存在时，优先解析callNumbers。（2）楼宇对讲：1、国内规则：1-1-1-层号… |
| `UserInfo.callNumbersContactsDisplay` | opt | array | — | 房间号是否显示在人员通讯录中 · 1、要求顺序与callNumbers中的元素一一对应。2、默认为true。3、当设备不支持callNumbers，仅支持roo… |
| `UserInfo.floorNumbers` | opt | array | — | 层号列表 · floorNumber的扩展，支持多层，两者同时存在时，优先解析floorNumbers。要求floorNumbers与callNumbers的数… |
| `UserInfo.groupId` | opt | int | range 1,128 | 本地考勤组织编号 |
| `UserInfo.localAtndPlanTemplateId` | opt | int | — | 本地考勤计划模板 |
| `UserInfo.groupName` | opt | string | range 1,128 | 组织架构 |
| `UserInfo.age` | opt | int | range 0,120 | 年龄 |

> 仅列前 40 项，原文共 61 项，完整字段见官方原文。

**响应字段**（仅列顶层与关键嵌套；完整结构见原文 §1.12）

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `statusCode` | opt | int | — | 状态码 · 无法用1表示时（1表示成功且无特殊状态）必须返回 |
| `statusString` | opt | string | range 1,64 | 状态描述 · 无法用OK表示时（OK表示成功且无特殊状态）必须返回 |
| `subStatusCode` | opt | string | range 1,64 | 子状态码 · 无法用ok表示（ok表示成功且无特殊状态）必须返回 |
| `errorCode` | opt | int | — | 错误码 · 当statusCode不为1时，与subStatusCode对应 |
| `errorMsg` | opt | string | — | 错误信息 · 当statusCode不为1时，必须返回,解释信息在协议约束中，允许设备在后续的版本迭代中，进行优化丰富提升（不限制死） |
| `MErrCode` | opt | string | — | 功能模块化错误 · 通用错误码都在此字段范围中 |
| `MErrDevSelfEx` | opt | string | — | 功能模块化错误码 · 此字段是MErrCode自定义模块化错误码的扩展字段，自定义模块化错误码一共有MErrCode 的后20bit和此字段的32bit |


### 1.13 获取人员信息及权限删除进度

- 用途：查人员与权限删除进度
- 请求：`GET /ISAPI/AccessControl/UserInfoDetail/DeleteProcess?format=json`

**请求字段**

_无请求体字段（查询参数承载）_

**响应字段**（仅列顶层与关键嵌套；完整结构见原文 §1.13）

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `UserInfoDetailDeleteProcess` | req | object | — | 人员删除信息 |
| `UserInfoDetailDeleteProcess.status` | req | enum | 枚举：processing # 处理中,success # 成功,failed # 失败 | 状态 |
| `UserInfoDetailDeleteProcess.percent` | opt | int | range 0,100 | 进度值 |


### 1.14 配置人员信息及权限删除

- 用途：删除人员与权限（级联）
- 请求：`PUT /ISAPI/AccessControl/UserInfoDetail/Delete?format=json`

**最小请求体骨架**（按必填字段自动生成，仅示意结构）

```json
{
  "UserInfoDetail": {
    "mode": "all"
  }
}
```

**请求字段**

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `UserInfoDetail` | req | object | — | 用户信息 |


**响应字段**（仅列顶层与关键嵌套；完整结构见原文 §1.14）

| 字段 | 必填 | 类型 | 取值 / 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `statusCode` | opt | int | — | 状态码 · 无法用1表示时（1表示成功且无特殊状态）必须返回 |
| `statusString` | opt | string | range 1,64 | 状态描述 · 无法用OK表示时（OK表示成功且无特殊状态）必须返回 |
| `subStatusCode` | opt | string | range 1,64 | 子状态码 · 无法用ok表示（ok表示成功且无特殊状态）必须返回 |
| `errorCode` | opt | int | — | 错误码 · 当statusCode不为1时，与subStatusCode对应 |
| `errorMsg` | opt | string | — | 错误信息 · 当statusCode不为1时，必须返回,解释信息在协议约束中，允许设备在后续的版本迭代中，进行优化丰富提升（不限制死） |
| `MErrCode` | opt | string | — | 功能模块化错误 · 通用错误码都在此字段范围中 |
| `MErrDevSelfEx` | opt | string | — | 功能模块化错误码 · 此字段是MErrCode自定义模块化错误码的扩展字段，自定义模块化错误码一共有MErrCode 的后20bit和此字段的32bit |
| `lockStatus` | opt | enum | 枚举：lock # 锁定,unlock # 未锁定 | 锁定状态 · 输入参数中loginPassword错误时返回本节点，剩余尝试次数为0时锁定设备 |
| `retryTimes` | opt | int | range 0,6 | 剩余尝试次数 · 输入参数中loginPassword错误时返回本节点，剩余尝试次数每失败一次减1，剩余尝试次数为0时锁定设备 |
| `resLockTime` | opt | int | range 0,1800 | 解锁剩余时间 · 设备锁定状态下返回剩余锁定时间 |
| `lockType` | opt | enum | 枚举：lockIP # 锁定IP,lockFunction # 锁定功能 | 锁定类型 · 不传该字段，默认表示锁定IP |


### 1.15 获取门禁总能力

- 用途：获取门禁总能力
- 请求：`GET /ISAPI/AccessControl/capabilities`

**能力集说明**

- 该端点返回 XML 能力集（原文 URL **不带** `?format=json`）；布尔能力位为 `true` 表示支持，**不支持时该字段不返回**。
- 判定方式：能力位存在且为 `true`；未知字段应忽略。
- 这是验证 `DS-K1T671BM` 是否支持本方案的**第一步**，应在写适配器之前执行并留存输出。

**与本项目相关的关键能力位**

| 能力位 | 类型 | 与本项目的关系 |
| --- | --- | --- |
| 人脸库管理 | bool | **最关键**：决定能否平台下发人脸 |
| 采集人脸图片 | bool | 设备是否可主动采集人脸图 |
| 人员图片异步下发 | bool | 大批量下发时的异步通道 |
| 人脸数据自更新 | bool | 设备侧人脸数据同步策略 |
| 是否支持查询人脸建模失败记录 | bool | 建模失败可观测性 |
| 权限控制器人脸检测识别参数 | bool | 识别阈值类参数可配置性 |
| 人脸直通模式参数 | bool | 直通模式（仅识别、不控门） |
| 查询人脸直通事件 | bool | 事件获取的补充通道 |
| 识别单元人脸区域参数 | bool | 识别区域配置 |
| 人脸比对约束条件参数配置 | bool | 1:N 比对阈值 |
| 人脸测温事件主动获取 | bool | 测温机型专用，本项目不使用 |

> 完整能力位上百项且随固件变化，原文 §1.15 为全量清单；实现时按需读取、容忍未知字段。

## 3. 与 `FaceAccessProvider` 的映射

| Provider 方法 | 端点序列 | 幂等键建议 | 说明 |
| --- | --- | --- | --- |
| `enrollFace` | 1.12 添加人员 → 1.6 添加人脸 → 1.5/1.2 查询确认 | `orgId:personId:deviceId:cycleId` | 人员已存在时改用 1.9（SetUp 支持增改），避免 1.12 冲突 |
| `updateFace` | 1.9/1.10 修改人员 → 1.4 修改人脸（或 1.3 FDSetUp） | 同上 | 1.4 用 `FDID+FPID` 定位，不产生新记录 |
| `revokeFace` | 1.1 删除人脸；整人撤权用 1.14 + 1.13 轮询 | `grantId` | 1.14 会级联删除卡/指纹/人脸，撤销范围要先确认 |
| `queryOperation` | 1.2 人脸数 + 1.5 查询 + `SearchModelFailRecord` | 任务 ID | "已下发"与"已建模可用"必须分开判定 |
| `verifyEvent` | 事件信封（`event_acs` / `OnEventNotify`） | `eventId` | 校验 `eventType`、`happenTime` 时间窗、来源设备 |

## 4. 幂等与异步（实现必须遵守）

1. **人员必须先于人脸**：先 1.12/1.9 建人员，再 1.6/1.3 下发人脸；顺序颠倒会失败。
2. **删除是异步**：1.14 返回不代表完成，必须轮询 1.13，直到进度为 `success`。
3. **建模是异步**：1.6 返回 `FPID`/`rowKey` 只代表受理；建模结果需查 `SearchModelFailRecord` 或 1.2/1.5 复核。
4. **未知结果不重试**：超时/响应缺失按 `UNKNOWN_RESULT` 处理，先查询对账，确认未执行才允许重试。
5. **删除有两条路径**：1.1（`FDSearch/Delete`）与 1.3 的 `deleteFP:true`；实现二选一并固定，避免状态分裂。

## 5. 仍需型号确认的点

- `DS-K1T671BM` 是否支持上述全部端点（以 `capabilities` 能力位为准）
- HTTP 直连时图片下发走 `faceURL`、multipart 还是其他方式
- `FDID` 是否固定为 1、是否允许自建人脸库
- `blackFD` 是否等价于门禁人员库
- 认证方式、错误码、并发与限频
