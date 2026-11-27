# 本机人脸登记管理

在管理后台“人脸门禁”页面使用“人脸登记管理”面板。它复用当前管理员的设备会话，不连接云数据库，不启动派发 worker，也不提供远程开门操作。

## 查看

1. 登录本机管理后台，连接模拟设备或现场设备。
2. 点击“查询设备列表”。人员分页读取完成后才显示完整总数和可操作列表。
3. 列表显示人员编号、姓名、门权限及计划、有效期，以及可见光／红外库状态。没有返回库、状态未确认和明确未入库分别显示，不互相替代。

人员列表最多读取1000条；达到边界、分页计数矛盾或响应不完整时停止并报告查询失败，不把部分结果显示为全量。人脸状态通过设备返回的库类型和编号逐库精确查询，不读取照片或跟随照片 URL。

部分固件没有声明旧版 `faceSearchSupported` 能力标志。管理查询仍会实际读取精确 FDSearch，并根据计数、匹配人员编号和 `isInLibrary` 判断状态；能力标志缺失不等于接口失败。查询失败或响应不明确仍显示“状态未确认”，同时阻止删除准备及已确认操作的后续写入，不以人员记录的 `numOfFace` 替代入库证据。该适配不改变原登记流程的能力判断。

“人脸已入库”不表示已完成现场识别或实际开门验证。“未入库”也不等于脸库记录不存在：尚未建模的记录仍需在删除时精确清除。

## 逐条删除与跟进

1. 在目标行点击“删除此人员”。服务器先读取目标并生成短时、单次、同会话确认令牌，此时不发送删除请求。
2. 确认框逐条列出人员编号和姓名，并提示“删除不可逆，需重新录入才能恢复”。取消不会发送删除。
3. 确认后，服务器重新核对人员快照，先精确清除所有已确认库中的该人员记录并读回，再提交人员删除。
4. 删除结果区显示成功、失败、未找到或处理中，以及逐步设备状态。后台重新查询剩余名单；刷新失败时不保留可再次删除的旧名单。
5. 异步处理中只查询结果，不重发删除。页面最多自动跟进三次，之后可点击“查询删除结果”；重新进入页面或刷新状态也能恢复当前会话的待跟进操作。

界面不提供全选、批量清库或定时清理。服务器拒绝数组、多个编号、额外字段以及不符合 `^[A-Za-z0-9]{1,32}$` 的人员编号。确认失效、快照变化、未知库状态或已有待跟进删除时，不会开始新的删除。

已提交写入但结果未知时保留操作编号和已完成步骤。若只删了人脸、尚未提交人员删除，跟进仅确认状态；需要新的逐条确认才能再次开始删除流程，不会自动补发人员删除。

## 本机服务接口

全部接口沿用既有管理员 session、仅本机来源、Origin 和 CSRF 校验。

```text
POST /api/face/list       {}
POST /api/face/delete     {action:"prepare", employeeNo:"SYNTHETIC01"}
POST /api/face/delete     {action:"confirm", employeeNo:"SYNTHETIC01", confirmationToken:"本次返回的令牌", confirmationText:"DELETE SYNTHETIC01"}
POST /api/face/delete     {action:"status", id:"本次返回的operationId"}
```

列表和删除 DTO 只包含必要的人员、权限、有效期、库状态及操作结果；连接地址、设备账号、密码、证书、图片及图片地址不会返回。现有连接表单成功后清空连接输入，不将材料持久化到浏览器存储。

## 海康协议依据

采用[海康官方《明眸门禁》](https://open.hikvision.com/hardware/v2/08%E5%8D%8F%E8%AE%AE%E9%80%8F%E4%BC%A0/%E6%98%8E%E7%9C%B8%E9%97%A8%E7%A6%81.html)列出的接口；不能将任务中的参考路径当作已验证协议。

```text
POST /ISAPI/AccessControl/UserInfo/Search?format=json
POST /ISAPI/Intelligent/FDLib/FDSearch?format=json

PUT /ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=<设备返回的库编号>&faceLibType=<设备返回的库类型>
{"FPID":[{"value":"SYNTHETIC01"}]}

PUT /ISAPI/AccessControl/UserInfoDetail/Delete?format=json
{"UserInfoDetail":{"mode":"byEmployeeNo","EmployeeNoList":[{"employeeNo":"SYNTHETIC01"}]}}

GET /ISAPI/AccessControl/UserInfoDetail/DeleteProcess?format=json
```

人员删除是异步操作。设备进度或一次 HTTP 成功不足以证明目标已删除，必须精确读回人员及每个脸库记录。明确设备错误和未知响应不能被旧的成功字段覆盖。

连接层仍使用原 `HikvisionClient` 的 Digest 认证和发送前公钥 pin；没有修改其实现。`developmentTls=true` 仅采用既有开发证书例外，跳过 CA／名称验证但保留强制 pin，不能描述成完整 TLS 信任验证通过。

官方通用接口说明不等于该型号／固件的实机删除验证。当前实际设备验证结果应以本轮交付记录为准；没有明确测试人员和二次确认时，不执行真实删除。

## 离线验证

新增管理业务、界面和 HTTP 合成回归覆盖：分页和不完整响应、逐库记录与建模状态、脸先人后、成功／未找到／部分失败、单次确认与失效／重放／跨会话、批量禁止、异步跟进、页面重进恢复以及敏感字段不回显。

常规 admin-web 测试与 `tenant-password-routes.test.mjs` 分组执行：后者须在业务模块加载前预加载既有 `tests/support/d-network-guard.cjs`，其余真实 loopback 测试不能使用这个禁止所有网络的守卫。不得删除、放宽或跳过守卫断言。

首次失败、重测日志及真实设备验证工件保存在独立本机目录，不提交真实人员清单、连接材料或照片。旧报告、日志和残留引用保持不变。
