# 参数化人脸登记入口

此入口固化已经完成现场识别和门锁释放回报的单人登记流程，复用 `FaceEnrollmentService`、`HikvisionFaceProvider` 及全天计划验证器；不复制一套设备协议。界面与命令入口使用相同业务代码。它是独立的人脸登记入口，不调用或修改旧 probe CLI、allowRead 或历史ACL工具。

## 默认行为

- 一次只新增一人；默认长期有效、1号门、每天24小时，候选模板默认1但必须按实际能力、周计划、全部假日及次数限制核验后才绑定。
- 默认运行模式是 simulation；真实设备必须明确 `mode:"device"`。模拟成功不能作为实际下发结果。
- 真实模式仅在本机Windows执行，默认目标型号DS-K1T671BM；其他型号必须由调用方显式指定expectedModel，且本项目未据此宣称其他型号已通过兼容性验证。
- 无特殊安排不接受任意时段参数绕过全天校验。固定人员有效期可明确指定fixed及起止日期；每日通行仍为已核验的全天计划。
- 先查人员编号，已有编号停止，不覆盖已有人员，不自动换新编号重试。失败后可能留有部分设备状态，保留结果并核查，不自动回滚、重传或删除。

## 代码调用

```js
import { runFaceEnrollment } from "./admin-web/lib/face-enrollment-command.mjs";

// request由已获授权的表单或调用方在内存中构造。
const { exitCode, output } = await runFaceEnrollment(request);
```

返回 `{exitCode,output}`。output使用白名单，只含人员编号/房号备注、模式、阶段状态、计划证明等所需结果，不包含密码、证书内容、照片内容或文件路径。

照片从同一已打开文件句柄受限读取，前后核对元数据，随后使用同一份内存字节；证书也受限读取。字符串检查只拒绝显式UNC和Windows设备命名空间路径，不核验父目录重解析点或映射网络盘来源；调用方必须提供已确认的本机普通文件。同句柄和元数据比较不是文件锁或原子快照，不能证明绝无同尺寸并发改写。此措施不宣称解决全部Windows ACL、文件系统或TOCTOU场景，也不取代独立证据权限验收。

## stdin协议

命令入口：

```text
node admin-web/face-enroll.mjs
node admin-web/face-enroll.mjs --help
```

除help外，输入是调用方内存经标准输入送入的单个UTF-8 JSON对象，最大32KiB。禁止把真实密码保存成配置文件或放进命令行参数。help只显示用法，不读取输入、照片、证书或设备。

| 字段 | 含义/默认 |
| --- | --- |
| mode | simulation（默认）或显式device |
| name | 姓名或登记显示名 |
| room | 房号字符串；仅备注，不自动绑定小程序账号或房产数据库 |
| photoPath | 本机JPEG文件路径，≤200KiB；只做大小/格式检查，设备最终判断人脸质量 |
| consent | 必须由调用方依据本人实际同意提供布尔true |
| employeeNo | 可选；缺省按房号片段、上海日期及随机值生成≤32位编号，仍经设备查重 |
| doorNo | 默认整数1，须在设备能力中 |
| validityMode | 默认unlimited；fixed时另给validFrom/validTo |
| FDID、faceLibType | 可选且成对指定；不指定时仅自动选择明确唯一的blackFD库 |
| origin | device模式必需的HTTPS端点，不含账号、密码或其他URL数据 |
| username、password | device模式由调用方交互取得，仅在内存传递 |
| certificatePath | device模式必需，已另行核验的公开服务器证书文件，≤64KiB |
| developmentTls | 默认false；经授权的开发链/名称例外须显式true，仍强制公钥pin |
| expectedModel | device模式默认DS-K1T671BM，连接后精确核对 |
| planTemplateNo | 候选默认字符串“1”；仍必须完成计划核验，不是无条件使用编号1 |

不支持数组批量输入、命令行凭据、自动认证重试循环或跳过失败断言。设备Digest内部仅允许首次401的一次认证往返，不是业务重试。

## Windows启动器

已安装的Windows PowerShell5.1 Desktop或pwsh7均可运行：

```text
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\tools\hikvision-face-enrollment\Invoke-FaceEnrollment.ps1
```

普通模式从管道读UTF-8 JSON；代理调用可加 `-PrivateConsoleInput`，在当前控制台关闭回显读取一行输入，然后恢复。只有脚本路径进入Node进程参数，整份请求经UTF-8 stdin传递，不写输入日志。密码不经命令行、环境变量或配置文件提供。

PowerShell调用方在内存构造好 `$request` 后可使用：

```powershell
$previousEncoding = $OutputEncoding
try {
    $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $request | ConvertTo-Json -Depth 5 -Compress |
        powershell.exe -NoLogo -NoProfile -NonInteractive -File .\tools\hikvision-face-enrollment\Invoke-FaceEnrollment.ps1
    $faceRunExit = $LASTEXITCODE
} finally {
    $OutputEncoding = $previousEncoding
    $request.password = $null
    $request.username = $null
}
```

启动器只创建新的输出目录和新日志，默认 `admin-web/.data/face-runs/<时间-随机值>/`（Git忽略）。可明确指定新的OutputDirectory，既有目录拒绝覆盖；保留stdout.txt、stderr.txt及原始子进程exit-code.txt，不保存输入JSON。调用方须读取启动器最终退出码及JSON元数据，不能只看子进程曾返回0。超时、输出不完整或证据写入失败均必须保留失败状态；不自动重跑。

可用TimeoutSeconds将48秒总子进程期限缩短至1–48秒，不能延长。stdout元数据中的childExitCode及exit-code.txt保持子进程原值；wrapperExitCode和启动器实际退出码反映最终结果。即使子进程为0，非法尾行、结果/退出码矛盾、超时、捕获不全、证据写入或编码恢复失败也会使包装结果为5，不能沿用旧成功。输出目录同样拒绝显式UNC和设备命名空间；原始日志只留本地。

组织策略/签名/安全软件阻止时停止并记录类别，不设置ExecutionPolicy Bypass、不Unblock、不安装工具或修改系统策略。

## 退出码与现场结果

| 代码 | 解释 |
| --- | --- |
| 0 | 模拟完成，或设备登记已查询确认且仍待现场验证；看mode和outcome区分 |
| 2 | 输入/本地文件等预检失败，未启动对应业务写入 |
| 4 | 业务阶段失败，可能已部分写入，须核对设备现状 |
| 5 | 连接、未知状态、协议输出、清理或启动器终止错误；不得自动重试 |

真实模式outcome为device-enrollment-confirmed-pending-site，siteVerification始终PENDING。识别成功及门锁释放需现场单独回报，程序不自动把注册成功当作实际开门。API不支持FDSearch时仍不伪造建模查询成功。

本入口不远程开门、不删除人员、不修改共享计划、设备时钟或系统证书，不处理历史残留，不访问生产云，不部署上线。当前与小程序用户/房产的自动绑定仍是独立未完成的接入项。
