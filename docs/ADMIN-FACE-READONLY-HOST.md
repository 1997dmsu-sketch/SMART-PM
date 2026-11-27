# 人脸只读复验宿主

`admin-web/lib/face-readonly-host.mjs` 提供 `FaceReadonlyHost`，复用原 `FaceEnrollmentService`、`HikvisionFaceProvider` 和 `HikvisionClient`。模块导入和构造都不读取文件、环境变量或连接设备；只有调用 `connect(config)` 才可能请求设备。

这是待独立复审的宿主库，不是已接通的现场入口。没有修改默认 admin-web、worker 或 CLI，没有启动网页服务。后续如接入本机后台，应显式通过已有 `faceServiceFactory` 注入此宿主，并继续保留管理员、loopback、Origin、CSRF和session校验。不能把原后台的完整登记管理模式当成只读入口。

## API及生命周期

- 构造参数：`planTemplateNo`默认`"1"`、`expectedModel`默认`"DS-K1T671BM"`；逻辑请求预算默认/上限256，总时限默认/上限120000ms，单请求看门狗默认/上限5000ms，只能缩短。
- `connect(config)`：只接受设备模式及内存中的既有SDK连接字段，不接受额外字段、访问器或多余实参。计划号必须与构造时一致，型号必须与返回值精确相符。
- `list({})`：连接成功后只允许一次完整查询。需要完整分页及本次每个人员、每个确认库的精确FDSearch全部观察完毕，才返回结果。名单的 `deleteAllowed` 始终投影为false，实际人脸状态及 `managementSearchObserved` 保留。
- `state()`：只输出必要设备/库/计划证明与只读状态、首错误码和逻辑请求计数，不返回连接材料或整份设备能力响应。
- `disconnect()`／`close()`：幂等释放客户端。查询完成也会主动释放底层客户端及其凭据引用。关闭中途的请求不能晚到后恢复READY/COMPLETE，放弃的晚响应缓冲会清零。
- `dispatch()`仅允许`connect/list/state/disconnect`；兼容接口`enroll/retry/verify/prepareDelete/delete/followDelete`始终拒绝。不存在通用设备请求入口。

每个实例只服务一次连接与一次名单查询；错误、生命周期违规或被禁入口触发不可重置的熔断。保留首个固定错误码，关闭SDK，后续调用不再请求网络。重新安排复验须创建新实例，不能在旧实例中清除错误后继续。

## 双层阻写

入口阻写之外，原服务只得到冻结的`describe/list/close`窄provider代理，设备出站再经 `FaceReadonlyPolicy`。策略默认拒绝，验证method、完整路径/query、阶段和正文；POST使用严格UTF-8 JSON并重建规范字节，响应JSON重复键（含转义后的同名键）被拒绝。

连接阶段按源码顺序精确放行：

```text
GET /ISAPI/System/deviceInfo
GET /ISAPI/AccessControl/UserInfo/capabilities?format=json
GET /ISAPI/Intelligent/FDLib/capabilities?format=json
GET /ISAPI/Intelligent/FDLib?format=json
GET /ISAPI/Intelligent/FDLib/Count?format=json                  仅列表无库时
GET /ISAPI/AccessControl/RemoteControl/door/capabilities       仅门范围未返回时
GET /ISAPI/AccessControl/UserRightPlanTemplate/capabilities?format=json
GET /ISAPI/AccessControl/UserRightPlanTemplate/<绑定模板>?format=json
GET /ISAPI/AccessControl/UserRightWeekPlanCfg/<模板返回编号>?format=json
GET /ISAPI/AccessControl/UserRightHolidayGroupCfg/<模板引用>?format=json
GET /ISAPI/AccessControl/UserRightHolidayPlanCfg/<组引用>?format=json
```

数字路径只按本次响应中的有效引用逐一授权，不放通前缀。库类型只接受blackFD/infraredFD，未知、重复或无可用库拒绝。全天计划仍由原实现验证，读取能力包含设置能力的声明不表示执行设置。

列表阶段仅接受：

```text
POST /ISAPI/AccessControl/UserInfo/Search?format=json
POST /ISAPI/Intelligent/FDLib/FDSearch?format=json
```

人员查询仅允许当前分页条件（固定searchID、连续position、受能力限制的maxResults）；不接受EmployeeNoList、其他筛选或多余字段。人脸查询仅允许position=0、maxResults=1，以及本次确认库和已完整分页取得的精确FPID。分页矛盾、重复人员、未完整读完、未知脸状态或计数/FPID矛盾均熔断。

所有其他方法、端点、额外query、重定向、照片URL、删除进度以及写POST（例如人员Record）均不在白名单。不能仅凭“POST是读”或“GET是安全的”判断放行。

## TLS、计数与限制

宿主固定使用未修改的原SDK：缺失/非法预期证书在连接前拒绝；peer证书缺失或SPKI pin不符，在HTTP发送前拒绝。`developmentTls`默认false；已有true例外仅跳过CA/名称验证，仍强制公钥pin，不是完整TLS信任验证通过。

256是SDK逻辑request预算。原SDK每个逻辑请求最多因Digest 401在同端点认证重发一次，不能把逻辑请求数当成HTTP数或连接数；不得增加其他自动重试。总时限使用单调钟和看门狗，非系统日期回拨可延长的期限。

本次新增验证只使用合成证书与假TLS/HTTPS传输，让真实SDK的公钥解析、pin比较、Agent回调和Digest代码执行；不覆盖真实TLS握手、CA/主机名、VPN或现场设备兼容性。现有回归中的合成loopback夹具仍按原套件运行。

宿主不内置“当前必须9人”或某个真实员工的验收真值。后续现场任务须独立核对完整9人、目标FPID及具体blackFD/FDID、`isInLibrary=yes`和界面展示；名单查询并非原子快照。旧P1的最终读取/设备写入间非原子边界保持，不因新增只读宿主扩大为实机删除、开门或E1/E2放行。
