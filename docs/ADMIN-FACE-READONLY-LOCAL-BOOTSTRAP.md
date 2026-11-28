# 本机可信启动层：离线接入

基于`ed3cb0cf5813aa9d61b8e5c4492f273f4de1d422`新增固定本机编排模块，只验证合成输入、底层假传输和内存证据接收契约。实际`admin-web/face-readonly.mjs`未接线，仍然`LIVE_EXECUTION_LOCKED`。本阶段没有真实人工授权发行或设备连接，业务接收器不做真实文件落盘，也不作Windows ACL验收；测试日志和交付证明另存在本机证据目录。

## 默认拒绝与代码级端口

`admin-web/lib/face-readonly-local-bootstrap.mjs`提供：

- `createLocalBootstrap()`：创建默认锁定的本机启动句柄，不装配输入、审批或网络能力。
- `createOfflineLocalBootstrap({inputSource, approvalSource, evidenceReceiver, isTransportInstalled, options})`：仅供可信测试装配代码使用；端口必须来自本模块私有品牌，拒绝普通对象、克隆、未知字段、Host/provider/runner替换及动态模块路径。
- `createSyntheticInputSource({read})`：每个编排上下文读取一次内存`{inputBytes, expectations}`。原始UTF-8字节复用既有严格解析器，独立expectations交给既有session校验；不接受文件路径，不读环境连接配置、照片或真实证书。
- `createSyntheticApprovalSource({request})`：固定回调收到非机密审阅视图及`approve/reject`控制器；只能返回与本次同域视图绑定的不可序列化票据。`true`、`approved=true`、JSON或跨域票据不能批准。
- `createSyntheticEvidenceReceiver({reference, onPhase})`：模块内存中的假接收器；`onPhase`仅供代码级故障或延迟模拟，不能用返回的自称成功对象替代固定契约。
- `runLocalBootstrap(handle, {signal})`：一次性运行；`inspectSyntheticEvidenceReceiver(handle)`只供测试查看安全的候选记录状态，不公开session、授权token或runner。

这些工厂是可信JavaScript的代码级能力，不是外部身份认证、真实人工同意证明或针对任意进程内代码篡改的沙盒。`isTransportInstalled`也不是可由输入提交的安全证明；独立测试网络守卫与假TLS/HTTPS共同限定本轮动态执行。生产模块不导入测试fixture，生产CLI没有接收这些能力的argv/env/JSON通道。

## 固定执行顺序

编排器先消费自身一次性上下文，再加载内存材料、复制字节并完成私有session准备。审阅后不重新读取来源或从调用方对象重建执行配置。

证据接收准备先于批准和执行；准备失败不发放session授权，也不创建TLS/HTTP。审批只看到既有非机密审阅视图，不收到端点、凭据、证书、序列号或pin。拒绝、取消、超时、迟到或重复决定不能恢复上下文或自动续发授权。

批准后由固定代码调用既有`authorizeReadonlySession`、`createControlledReadonlyRunner`和同一`main`，贯穿真实SDK、Host及Policy，底层仅为假传输。不接任意执行函数、Host或backend，不新增设备请求和写权限。

session令牌在适配器调用时消费；若main尚在输入预检、外层预取消等阶段结束，不虚称该令牌已经消费。但编排器仍永久终止且不公开任何能力对象，因此不能借它重放或重新批准。

新增端口等待有固定有限期限，只允许缩短。取消沿用抗`stopImmediatePropagation`的订阅，关闭执行上下文并保留首错；迟到回调不恢复执行。底层120秒总预算、5秒单请求、256逻辑请求上限、精确白名单、每个逻辑请求原同端点一次Digest认证往返、pin-before-send、序列号/型号/计划/人数及目标库门禁均保持。

## 假证据契约与最终退出码

`reference`是受限虚拟标识，不是路径；拒绝目录分隔符、绝对路径、路径穿越、控制字符和覆盖已保留记录。失败尝试的引用也保留，不通过删除记录释放名称。与已知私密材料碰撞的动态引用不得跨标签回显。

假接收器按固定角色接收候选stdout、stderr及main退出码，完成seal和close；只在内存保留，不创建真实目录或文件。公开检查仅返回安全投影，原始输入、凭据、证书、序列号、pin、token及其hash不写入普通日志或输出。敏感值检查针对动态DTO文本，固定JSON键和协议枚举不作为凭据回显，因此合法账号名`readonly`或`list`不会仅因协议词碰撞而被拒绝；动态文本和reference保护继续生效。

`mainExitCode`是候选主函数结果，`exitCode`才是编排器最终结果。main为0但后续写入、seal或close失败时，最终必须非零，证据不能标为完整成功。已经记录的成功行或候选0不能撤回，也不能独立证明最终成功。

`evidence.status=COMPLETE`只表示这次工件记录完整；已知查询拒绝也可以有完整证据，但最终退出码仍非零。消费者必须结合最终退出码、完整协议和记录状态判断。失败或不完整记录保留，不能补写PASS或自动重跑。

所有结果保持`siteVerification=NOT_EXECUTED`和`deleteAllowed=false`。合成名单和`verification`只代表假传输下的断言，不是现场9人、`F03FF8DA7299CE148`、真实TLS或网页显示的复验结果。

## 验证与停止点

聚焦命令：

```text
node --test --test-reporter=tap admin-web/tests/face-readonly-local-bootstrap.test.mjs
```

原1022项回归、新增项实际数量、负控、真实stdout/stderr、退出码及前后哈希见[实施报告](evidence/hk-face-management/READONLY-LOCAL-BOOTSTRAP-2026-11-28.md)。故意退化失败与正式通过分别记录；首次CLI 33/34和verify-import基线失败及全部旧证据保留。

本阶段没有证明真实操作者身份、现场审批、真实Windows安全输入、真实证据落盘/ACL/文件身份/TOCTOU、真实TLS或网络中止、OS信号/EPIPE及实机兼容性。假接收器通过不等于这些层通过，JavaScript字符串也不宣称已可靠擦除。实际CLI仍锁定，没有读取真实凭据或照片、连接设备、改路由、登记/删除人员、开门、处理云派发或清理残留。

提交推送并核对远端完整SHA后停手交独立复审。未来现场仍须另行核对精确端点及既有路由、独立证书pin与设备身份、批准计划、具体blackFD/FDID和只读授权；不据此解锁或放行E1/E2、实机、派发、部署或上线。
