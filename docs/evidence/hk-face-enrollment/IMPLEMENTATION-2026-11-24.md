# 人脸门禁本地联调实现与验证记录

日期：2026-11-24，Asia/Shanghai。性质：执行方开发记录，尚待独立复审。

本轮完成电脑管理端的建人、上传照片、授门权和查询四阶段实现；合成验证及三项真实只读能力读取成功。没有创建真实人员、上传真实人脸、授予真实门权限或执行刷脸开门。本记录不作生产部署、完整设备兼容性、原 CLI 接入或 E1/E2 放行结论。

## 来源与工作树

- 仓库：`https://github.com/1997dmsu-sketch/SMART-PM.git`。
- 起点：`282a20fca9f64ab80ead50372c9c3e90bf4aeba7`，普通 fetch 得到并固定的 main 提交。
- 独立分支：`feat/hk-face-device-enrollment-2026-11-24`。
- 独立工作树代号：`SMART-PM-face-enrollment-2026-11-24`；保留原主目录、所有其他工作树及未跟踪对象。
- 原参考：本机 `HK-AI-08-isapi-reference-2026-11-23-run01/ordinary-guide.pdf`。对照 FDSetUp、UserInfo、FDSearch 等定义；未将通用指南当作每个型号能力的替代。

旧 ACL/绑定桥/TLS 合成验证的报告、原始日志及新旧残留引用均未改写或清理。本轮不运行旧 probe CLI，不改 `allowRead`；此前真实管理员开门记录属于另一轮，不作为本轮人脸结果。

## 实现与边界

- 新增 `hikvision-client.mjs`，HTTPS TLS 建立且 SPKI 公钥 pin 匹配后才交接 socket 发送 HTTP。严格链/名称验证为默认；显式开发模式仅对当前连接提供链/名称例外，仍强制 pin。合成错误/缺失 pin 测试确认零解密 HTTP 字节。仅首次 401 触发一次 Digest 认证重发；不自动重试超时写入，不跟随重定向。
- 新增 `face-enrollment.mjs`，按会话持有独立客户端、照片和阶段状态。新编号先查询碰撞；人员建立时显式空门权，照片成功提交后才授所选门权，人员 `Valid` 约束有效期。
- FDSetUp 使用 `faceURL` JSON part 和 `img` JPEG part（`faceImage.jpg`）；`FPID=employeeNo`。库、类型和门从返回能力选取，不把缺失门能力默认解释为门1。
- 上传尝试与成功提交分别记录。`putFace` 成功返回后才置 `faceSubmitted`；照片过期或上传超时即使查询到关联数量，也不能升级为本次已提交。显式继续才可重发上传；无自动删除/回滚。
- 明确支持 FDSearch 时须确认指定 FPID 的 `isInLibrary=yes`，不使用数量替代建模判据。不支持 FDSearch 时不调用它，核对 `numOfFace>0` 只进入 `pending-site`，`faceModelingVerified=false`。此状态仅说明已成功提交且人员、门权、人脸关联数量已确认。
- 管理端增加管理员本地 loopback 人脸入口，保留 Origin/CSRF/角色限制。凭据和照片不进入 store、audit、公共上传目录或云；状态不回传凭据/照片。服务端失败照片最多保存十分钟，成功、断开和会话关闭后释放。
- 页面默认模拟，提供四阶段状态、显式继续/查询、JPEG 本机按比例压缩及照片同意勾选。联调工作上限 200 KiB，非实测设备字节能力。未对照片质量、活体或现场识别作成功保证。

人员创建、照片上传、门权写入是三个独立设备操作；非跨进程原子事务。外部客户端修改、设备时钟/权限计划、超时结果、进程重启续传和真实照片质量仍需后续现场验证。超时不自动采纳为成功，不自动删除或撤权。首次仅使用新的专用测试编号并避免并发管理。

## 本机验证

Windows 注册表原值：`Windows 10 Home China`、DisplayVersion `23H2`、build `22631.6199`；未按名称自行推断系统版本。PowerShell `7.6.9 Core`，.NET `10.0.14`，Node `v24.16.0`。本轮是 Node 管理端开发验证，未重跑 Windows PowerShell 5.1 ACL 原生用例，也未安装/升级运行时、依赖、Pester、WSL 或容器。

最终执行：2026-11-24 09:40:03.9227931 至 09:40:05.4180182，UTC+08:00。

```text
npm.cmd --prefix admin-web test
EXIT_CODE=0
tests=121 pass=121 fail=0 cancelled=0 skipped=0 todo=0
```

本轮新增测试覆盖：传输 18、业务 30、服务入口 9、页面辅助 10，合计 67；完整管理端回归共 121。业务测试包含三项“上传尝试不等于成功提交”的新增纯假 provider 回归。最终测试前后 11 个源码/测试文件按原始字节计算 SHA-256，全部一致，见 [前哈希](artifacts/source-before.json) 和 [后哈希](artifacts/source-after.json)。原仓库 Windows 工作树的 CRLF 与 Git blob 的 LF 可不同，另提供 [提交字节哈希](artifacts/source-git-index.json) 区分；未重编码或改写源码来匹配哈希。仅本证据目录的 `artifacts/*` 设置 `-text`，保持日志/清单原始字节，不改 Git 全局或系统配置。

完整真实 stdout/stderr/退出码见 [测试 stdout](artifacts/admin-tests.stdout.txt)、[stderr](artifacts/admin-tests.stderr.txt)、[退出码](artifacts/admin-tests.exit-code.txt)。stdout 10458 字节，SHA-256 `b35859f29bddc8371bfc45142f599be23473fb5a66d252d6faf8f393d2874372`；stderr 0 字节，SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

较早的完整 118 项通过日志仍保存在本轮本地目录，未覆盖；随后增加上述三项回归才得到最终 121 项。

浏览器使用本轮独立本机演示服务及无人物的随机合成 JPEG：原图 896250 字节（页面 876 KB），本机处理后页面 172 KB、720×720，模拟四阶段全部完成，显示“模拟同步完成·未下发现场设备”；采集的 warn/error 控制台为空。文件选择工具曾中断，后使用可用的文件选择流程完成，未把中断写成成功。页面验证后补正上传提交状态，最终完整回归通过；演示服务已重新载入最终代码，旧演示日志保留。没有用该合成图片测试真机。

## 真实只读能力证据

本轮新 Node 客户端使用已获授权的开发 TLS 模式及本地既有公开证书公钥 pin，只读取下列三项逻辑 GET。Digest 可能包含 401 认证往返，不把三项逻辑 GET 称为仅三次底层连接。完成记录工件写入时间为 2026-11-24 09:09:00.6871358+08:00。

| 路径 | 最终 HTTP | 耗时 ms |
| --- | --- | --- |
| `/ISAPI/AccessControl/UserInfo/capabilities?format=json` | 200 | 292.1738 |
| `/ISAPI/Intelligent/FDLib/capabilities?format=json` | 200 | 275.4098 |
| `/ISAPI/Intelligent/FDLib?format=json` | 200 | 284.2746 |

进程退出码 0，stderr 为空，设备写入 0。[stdout](artifacts/device-capabilities.stdout.txt)、[stderr](artifacts/device-capabilities.stderr.txt)、[退出码](artifacts/device-capabilities.exit-code.txt) 为不含凭据/证书内容的原样副本。

实测返回库 `1/blackFD`、`2/infraredFD`，门范围 1..1；人脸功能含 `setUp`，`isSuportFDSearch=false`，人员查询支持 `numOfFace`。人员能力有效期范围 2000..2037。本轮未再次读取 deviceInfo；界面 `describe()` 的 deviceInfo 解析仅由合成测试覆盖，既有设备型号/固件取证不充作本轮新读取结果。

另以刚捕获的三份响应进行零网络离线重放；deviceInfo 明确使用 `OFFLINE-FIXTURE/synthetic` XML，非真实身份核验。退出码 0，门范围、双库、禁止 FDSearch 的归一化符合预期。见 [重放结果](artifacts/capability-replay.json) 和 [退出码](artifacts/capability-replay.exit-code.txt)。

## 工件保留

本轮独立本地目录代号：`HK-FACE-ENROLLMENT-20261124-090826-e3465025`，不写入其他取证目录。仓库可提交工件的全部相对名称、字节数与 SHA-256 见 [清单](artifacts/sha256.json)。私有原件只留本地，不提交证书、公钥指纹、账号、密码、个人路径或真实生物识别照片。

| 本地相对工件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `node-readiness.private.json` | 5265 | `09e7c7ab38cc2d20f1c40e7d08e4f88278df8ee30e7f70fad44657a181198197` |
| `user.body.private.json` | 2047 | `5b4a7ccc79d660885fbcc1e629b2cb7add819b4518a74353bd8de4c9edaed4bc` |
| `face.body.private.json` | 760 | `d282e34abe6c282b8b71232e2cd6caabcbaf719871eed771ebdc46a8fb4f33fa` |
| `libraries.body.private.json` | 214 | `963f58319477547c87336aa2d85dfdb26f58f2c27d8690a0e8a30a67f91e0bf3` |
| `browser-narrow.jpg` | 82144 | `7e3b3b63a3fe31b3746f0072a68f4a9b855c1081320b43ad6aaecb67be989a29` |

本地 `local-artifacts-final.sha256.json` 封存 30 个当前静态工件，SHA-256 `72fb03fbd419abd1cd2e1274a73e266de4d4b167e41b60cad89034dd8491aadb`；两个仍在写入的最终演示服务日志明确未纳入静态封存。较早索引遇到两个运行中服务日志的文件共享锁；停止本轮自建旧演示服务后重新建立最终索引，旧索引及旧日志均保留。这是工件索引过程问题，不是业务测试失败或通过的依据。

## 结论与待人工补齐

可进入独立代码复审，之后安排单名测试人员的真实联调。仍需本人同意的正面 JPEG、姓名/显示名与新编号、门1的权限开始/结束时间，以及本人现场刷脸观察。此时才能执行人员和照片的真实下发并核对建模/识别与门锁结果。

未读取其他真实凭据或私钥，未导入根证书或修改设备安全配置，未连接生产云，未合并、部署或上线，未处理历史残留，未作 E1 放行。本次参与实现的交叉代码检查不冒充独立验收。
