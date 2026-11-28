# 单次授权与受控只读会话适配

基于`79193f4119575bf859af41e654b6daaebd1b7f35`，新增进程内单次能力与固定只读宿主适配。**实际CLI执行入口未修改，仍然LIVE_EXECUTION_LOCKED**。本次仅合成输入和假传输验证，没有发放真实现场执行授权，不提供argv/env/JSON解锁开关，也没有接入登记、删除、开门或云派发。

## 准备、审阅与一次授权

`admin-web/lib/face-readonly-session.mjs`提供四步代码接口：

1. `prepareReadonlySession(input, expectations)`：严格校验并在私有WeakMap中保存不可变快照，返回无可枚举字段的冻结句柄。准备期间只在内存解析公开证书并比较独立预期SPKI pin，不创建Host或传输。
2. `reviewReadonlySession(session)`：返回同域、冻结的非机密审阅视图。只有型号、计划号、预期人数、目标员工/库等必要字段，不返回端点、凭据、证书、序列号、pin、token或其hash。动态文本与已知机密值冲突时拒绝，不能换标签回显。
3. `authorizeReadonlySession(session, view)`：只接受本会话生成的同一视图对象，产生独立、不透明、不可序列化伪造的单次令牌。一个准备会话只发行一次，不能用克隆视图或同一审阅无限续发。
4. `executeReadonlySession(session, authorization, input, {signal})`：先消费令牌，再校验会话、输入和取消状态；执行使用私有快照，不能换用调用方后改的配置。跨会话、跨配置、取消或失败尝试都不能重放。伪令牌不能销毁他人的有效令牌；不同会话的有效令牌相互独立。

这是可信本机调用代码的进程内能力绑定，不验证外部操作者身份或证明现场人员已经同意，也不是针对任意可信JavaScript/原生代码的安全沙盒。未来现场执行须另行接入已获授权的本机发行入口；本阶段真实CLI没有发行或传入该能力。

## 同份输入与预期

`input`沿用[离线CLI协议](ADMIN-FACE-READONLY-CLI-OFFLINE.md)：`operation=list`、`mode=offline`，内存config与有限options。新增模块拒绝Proxy、访问器、未知字段或替换Host/传输的配置；不读文件、环境连接配置、照片或真实凭据。证书只通过内存`certificateBase64`传入。

`expectations`的全部必填字段：

| 字段 | 含义 |
| --- | --- |
| `expectedSpkiPin` | 独立核验的SPKI SHA256，64位小写hex；与所给证书计算值比较 |
| `expectedSerialNumber` | 已独立确认的设备序列号，精确匹配、不trim；不对外输出 |
| `expectedPlanFingerprint` | 本次批准的计划指纹，64位小写hex |
| `expectedCount` | 本次预期人数；任务目标为9，不硬编码进通用宿主 |
| `targetEmployeeNo` | 本次目标员工编号；未来现场目标为F03FF8DA7299CE148 |
| `targetFDID` | 本次批准的具体可见光库编号，不猜为1；库类型固定blackFD |

型号、模板号、端点、凭据、证书字节、TLS例外和预算均随同一配置快照绑定，后续输入须精确匹配其规范化字段及存在性。执行时必须完成两次不同校验：准备时证书公钥对独立预期pin，实际SDK连接时peer公钥对同一证书pin。不能把同次连接首次取得的证书自算指纹当作独立核验。

## 阶段门禁

- 序列号来自原白名单DeviceInfo响应，在policy XML栈中要求根的直接`serialNumber`子节点恰一且纯文本；缺失、嵌套、重复或不符即首响应后停止，不用输入回填设备观测。
- 型号及计划指纹在connect描述完成后、list之前校验；第一人员页及后续页的total均须等于预期人数，不符立即停止，不能截取或补足9人。
- 人数不符时仅补充已验证的`observation={actualCount,expectedCount,complete:false}`，实际人数来自该响应，不从请求回填；不输出不完整名单或把它标为完成。
- 人员完整分页、唯一编号及逐人逐库查询仍由既有policy约束。目标必须是唯一人员，在已描述确认的具体blackFD/FDID中有精确FPID匹配，且`status=present`与`recordStatus=present`；原解析/策略只有`isInLibrary=yes`才产生该入库状态。红外、人脸数量、聚合present、人员存在或仅记录存在均不代替。
- 无其他接口新增；精确白名单、双层阻写、缺证书/错误pin零HTTP、首错熔断、最终关闭及原P2写流错误优先语义保留。总时限≤120秒、单请求≤5秒、逻辑请求≤256，只能缩短。Digest仍仅原同端点一次认证往返，不做业务自动重试。

## 命令桥、输出与边界

`face-readonly-command.mjs`新增代码级`createControlledReadonlyRunner({session, authorization})`，仅将固定适配器注册到私有runner域；不接受任意执行函数、Host、provider、proof或模块路径。`runFaceReadonly`对该受控域直接调用适配器，让适配器先消费令牌再校验输入/取消；原离线runner逻辑不变。生产可执行入口不传runner，保持锁定。

消费时点是受控适配器调用。若CLI仍在help、读stdin、严格JSON/字段预检或外层预取消阶段失败，尚未调用适配器，不宣称令牌已消费；没有自动重试。不能把本阶段进程内调用链当成已经开放的实机CLI。

成功回传原安全的device/计划/完整名单/只读状态投影，`deleteAllowed=false`，并增加由已观测人员和库条目生成的`verification`：精确FPID、blackFD、FDID、入库布尔值及实际/预期人数。输出使用`execution=controlled-readonly`、`outcome=controlled-readonly-completed`，`siteVerification=NOT_EXECUTED`；它表示这些只读断言成立，不是现场刷脸、真实TLS、网页展示或E1/E2通过。原始body、照片/模板、凭据、序列号和pin不得借vendor文本泄漏；碰撞时拒绝输出。

已提交stdout字节不可撤回，必须结合最终退出码和完整协议判断。已知预期不符为非零拒绝，未知/传输/超时/取消/输出故障为非零停止，不将部分名单或unknown当作完成。名单仍是非原子观察；没有旧员工编号全集时只确认当前完整9人，不宣称历史集合完全一致。

本轮[实施报告](evidence/hk-face-management/READONLY-SESSION-IMPLEMENTATION-2026-11-28.md)列实际命令、计数、原日志、负控和哈希。保留首次33/34及verify-import基线失败和全部旧证据。提交推送后交独立复审，未获另行现场任务前不解锁、不连接设备、不改路由、不删除人员或开门，不作E1/E2、派发或上线放行。
