# 海康智能门禁 ISAPI 资料登记与初步证据结论

登记日期：2026-11-05  
来源：项目负责人通过私密会话提供  
用途：LOCK-01 海康 `DS-K1T671BM` 人脸门禁能力核对  
公开策略：仓库只保存文件元数据、摘要和必要的接口结论；原始压缩包/PDF/XLSX 带有接收方水印和有效期，不提交公开仓库，由项目负责人通过受控方式提供给被授权开发者。

## 1. 原始资料清单

| 文件 | ZIP SHA-256 | 内容 |
|---|---|---|
| `ISAPI开发指南_智能门禁_智能门禁一体机20262005122053.zip` | `52d3c19f37ea0757dd042e050e6d012a3fe9547a6da96a9649142266637b9761` | 1016 页 PDF、日志类型、字典信息、错误码 XLSX |
| `ISAPI开发指南_智能门禁_测温智能门禁一体机20262005122046.zip` | `9888ab2a47a24ded58a9ac591df71fb3bfcee01c34a13e951711be9005390f76` | 824 页 PDF、日志类型、字典信息、错误码 XLSX |

文件内部摘要：

| 包 | 文件 | SHA-256 |
|---|---|---|
| 普通一体机 | PDF | `91f539bd463b28b664a6cee1f87bdc17c585404bf893bf3fc785f98e5b0c2c97` |
| 测温一体机 | PDF | `c2953ba53ec78f5437ed18d190ffa7706c0405d53866465a82ea072f6b22135f` |
| 两包相同 | `日志类型.xlsx` | `f89bb6f365921e32c8cb323cf296fe73e4faf0e284f0bab00bfd882e9e6327ac` |
| 两包相同 | `字典信息.xlsx` | `00bb0b06e7fa91d82920d482aa2bf18f3e617f10b324191e45c91051ad885d4f` |
| 两包相同 | `错误码.xlsx` | `5edde32c2622197261877b4a7243e18e6d145af0bac5a8976c6ef0af271b21f6` |

PDF 元数据：创建日期为 2026-10-13，文件于 2026-11-05 生成/修改；PDF 未加密、不含 JavaScript。资料页面带有接收方水印和有效期信息。

## 2. 型号适用范围结论

普通智能门禁一体机指南的适用产品列表包含：

- `DS-K1T671`
- `DS-K1T671A`
- `DS-K1T671B`

但没有精确列出 `DS-K1T671BM`。

测温智能门禁一体机指南的适用产品列表包含：

- `DS-K1T671AM-3XF`
- `DS-K1T671ATM-3XF`
- `DS-K1T671BM-3XFTD`
- 其他 `DS-K1T671...-3XF` 变体

但没有精确列出裸型号 `DS-K1T671BM`。

因此当前证据等级为：

- **已确认：**海康智能门禁一体机产品族存在完整 ISAPI 人员与人脸管理流程。
- **部分相关：**指南覆盖 `DS-K1T671B` 和 `DS-K1T671BM-3XFTD` 两个近似型号。
- **仍待确认：**项目现场设备完整铭牌是否实际为某个带后缀型号；目标固件是否返回相应 capability；裸型号 `DS-K1T671BM` 是否在普通指南覆盖范围内。

不得仅凭近似型号把所有接口标记为目标设备已验证。

## 3. 文档已确认的候选接入流程

### 3.1 通信和认证

- ISAPI 基于 HTTP/REST，设备作为服务端，业务程序作为客户端。
- 设备需要固定或可达地址，客户端请求必须能够到达设备。
- 客户端使用 RFC 7616 HTTP Digest 摘要认证。
- 文档说明设备默认开启 HTTPS；真实设备仍需核对证书和端口配置。
- 事件支持 HTTP/HTTPS 长连接布防，也支持设备向平台监听地址推送。

### 3.2 人员与人脸顺序

文档明确要求先下发人员，再下发人脸：

1. 查询门禁总能力：`GET /ISAPI/AccessControl/capabilities`。
2. `isSupportUserInfo=true` 才可进入人员流程。
3. 新增人员：`POST /ISAPI/AccessControl/UserInfo/Record?format=json`。
4. 修改人员：`PUT /ISAPI/AccessControl/UserInfo/Modify?format=json`。
5. 查询人员：`POST /ISAPI/AccessControl/UserInfo/Search?format=json`。
6. 删除人员：`PUT /ISAPI/AccessControl/UserInfoDetail/Delete?format=json`，并轮询 `GET /ISAPI/AccessControl/UserInfoDetail/DeleteProcess`。
7. `isSupportFDLib=true` 才可进入人脸流程。
8. 人脸 `FPID` 与人员 `employeeNo` 对应关联。

### 3.3 人脸能力与接口候选

所有操作必须先读取：

- `GET /ISAPI/Intelligent/FDLib/capabilities?format=json`
- 根据 `supportFunction` 中的 `get | setUp | post | put | delete` 决定允许的操作。

候选接口：

- 查询数量：`GET /ISAPI/Intelligent/FDLib/Count?format=json`
- 查询人脸：`POST /ISAPI/Intelligent/FDLib/FDSearch?format=json`
- 幂等设置：`PUT /ISAPI/Intelligent/FDLib/FDSetUp?format=json`
- 新增人脸：`POST /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json`
- 修改人脸：`PUT /ISAPI/Intelligent/FDLib/FDModify?format=json`
- 删除指定人脸：`PUT /ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=<FDID>&faceLibType=<FDType>`
- 删除全部人脸库：`DELETE /ISAPI/Intelligent/FDLib?format=json`，该接口危险，首期适配器禁止开放。

文档说明人脸图片当前限制为 200 KB 以内，但必须以真实设备 capability 和实际响应为准。可见光人脸库通常使用 `FDID=1`；深度模式可能涉及 `FDID=2`，首期不得在未查询能力时固定写死。

## 4. 资料仍未关闭的问题

1. 现场设备完整型号和后缀。
2. 固件版本、构建日期和区域版本。
3. 实际 `AccessControl/capabilities` 返回值。
4. 实际 `FDLib/capabilities` 支持函数、容量、图片格式和尺寸。
5. 是否启用 HTTPS、证书状态和 Digest 算法。
6. 人员权限计划、门号和模板的实际字段要求。
7. 删除人员是否自动删除人脸；必须通过查询实测，不能假设。
8. 事件订阅在目标固件上的支持方式和认证行为。
9. 设备是否在局域网、云端是否需要边缘代理。
10. 设备许可、账号角色和同时连接限制。

## 5. 资料使用红线

- 不把文档示例中的管理员用户名、密码、IP、证书或示例数据当作真实配置。
- 不执行或复制任何批量删除全部人脸库的操作到生产代码。
- 不提交带水印的原始资料到公开仓库。
- 不在 capability 未返回支持时调用对应写接口。
- 不将普通一体机或测温一体机的近似型号结论直接写成 `DS-K1T671BM` 已验证能力。

