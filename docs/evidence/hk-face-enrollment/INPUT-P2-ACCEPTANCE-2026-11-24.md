# 统一登记入口：两项 P2 修复限定验收结论

日期：2026-11-24，Asia/Shanghai。

被复审修复提交：`f3bef713f651daf90c71cba43674cf1d1dbdecf5`；其唯一父提交为 `2d7f935868662d6fe6d4830de9d975af1ba4a260`。本文件从修复提交建立独立文档分支 `docs/hk-face-enrollment-input-p2-acceptance-2026-11-24`，仅固化本会话已经完成的静态及提交证据复审结论，不产生新的测试或现场运行结果。

## 验收结论

本次限定验收通过：路径被 trim、PowerShell 非法 UTF-8 替换两项 P2 关闭。通过范围仅为这两项输入处理修复，以及原240项加新增6项、共246项已记录的合成回归证据；复审未发现阻断缺陷。

| 问题 | 修复及核对依据 |
| --- | --- |
| 路径被 trim 后可能选择另一文件 | [命令模块](../../../admin-web/lib/face-enrollment-command.mjs) 对路径保留原文，再交既有 localPath 解析；普通非路径文本仍 trim。照片和公开证书的新增测试分别区分 ASCII 空格、U+3000 前导路径与其 trim 后路径，假读取器收到原路径解析结果。 |
| PowerShell 将非法 UTF-8 替换后交给 CLI | [启动器](../../../tools/hikvision-face-enrollment/Invoke-FaceEnrollment.ps1) 从原始 stdin 字节受限读取，32769字节用于检测超过32768字节的输入；使用 UTF8Encoding(false,true) 严格解码，异常在 Node 子进程启动前拒绝，临时字节缓冲在 finally 清零。 |

两项修复的 [命令模块测试](../../../admin-web/tests/face-enrollment-command.test.mjs) 和 [PowerShell测试](../../../admin-web/tests/face-enroll-powershell.test.mjs) 均使用合成输入及假服务。PS5.1/7分别验证非法字节拒绝、child=null、未出现启动哨兵，以及合法 U+FFFD 在恰32KiB输入时完整转发。有效边界假子进程故意返回4，测试核对原码保留；不将该控制结果误记为整套回归失败。

## 已记录运行与证据核对

修复方原运行命令为 `npm.cmd --prefix admin-web test`，时间为 `2026-11-24T13:53:36.9584938+08:00` 至 `2026-11-24T13:54:05.0044045+08:00`。本次文档工作及此前复审均没有重跑。

- [原始stdout](artifacts/input-p2-admin-tests.stdout.txt) 有246个不重名的通过项；原240项逐名、逐出现次数全部保留，新增恰6项。汇总为 tests=246、pass=246、fail/cancelled/skipped/todo均0。
- [原始stderr](artifacts/input-p2-admin-tests.stderr.txt) 为0字节；[退出码原件](artifacts/input-p2-admin-tests.exit-code.txt) 为12字节 `EXIT_CODE=0\n`（这里的 `\n` 表示原件中的LF字节）。
- [十工件索引](artifacts/input-p2-sha256.json) 的字节数及SHA-256全部与提交原始blob相符。
- [测试前](artifacts/input-p2-source-before.json) 与 [测试后](artifacts/input-p2-source-after.json) 的九份源码原始字节指纹一致，两个清单自身也逐字节相同；[Git blob指纹](artifacts/input-p2-source-git-index.json) 的基线及暂存记录分别与父提交及修复提交原始blob吻合，未以换行转换凑匹配。
- [回归及旧证据检查](artifacts/input-p2-evidence-check.json) 与日志相符。旧证据目录51份已跟踪文件、三个业务核心模块与父提交逐字节未变；原失败、原报告、日志及新旧对象/残留引用不改。
- [原运行摘要](artifacts/input-p2-validation.json) 的原生PowerShell属性采集为null，该记录保留；[补充环境查询](artifacts/input-p2-windows-powershell.json) 的实际stdout及退出码0确认 Windows PowerShell `5.1.22621.6133 Desktop`。父运行时为 PowerShell `7.6.9 Core`、Node `v24.16.0`；PS5.1及7新增测试均未跳过。

以上为对既有提交物的一致性复核，并非独立重跑或对历史采集过程的外部认证。详细修复记录及完整工件定位继续保留于 [INPUT-P2-FIX-2026-11-24.md](INPUT-P2-FIX-2026-11-24.md)。

## EOF截断覆盖边界

新增非法编码向量中，标为“截断多字节”的 `[0xe4,0xb8]` 后仍拼接JSON尾部；该断言覆盖随后遇到ASCII的非法续字节拒绝，没有单列“输入流在多字节序列中结束”的EOF截断样本。EOF情形的独立回归覆盖状态为 **NOT_COVERED**，不得写成该场景已经实测通过。

这是非阻断覆盖限制：静态复核确认实现使用一次性严格 UTF-8 解码，未发现实现缺陷；该限制不改写246项实际通过结果，也不扩大成所有编码边界均已逐项验证。本轮不为补齐此样本重跑或修改测试。

## 门禁及范围

显式UNC/设备命名空间拒绝、普通文件/大小/同句柄/前后元数据检查、32KiB上限、私密控制台、原子新目录、超时、原始子退出码保留，以及终止错误持续压过旧成功的门禁均未放宽。默认simulation、长期、1号门及经核验的全天计划规则不变；旧probe、allowRead及历史ACL工具未修改。

父目录重解析点、映射盘及非原子文件快照等已声明限制仍保留。结论不扩大为完整Windows ACL/文件身份/TOCTOU验收、新入口真实设备登记、现场识别或开门成功、完整CLI验收、生产上线或E1/E2放行。

本次仅新增本文件，未修改源码、测试或旧工件；不重跑、不读取真实凭据/照片/私钥、不连接设备、不重复登记人员、不清理残留、不运行E1/E2。既有工作树、全部旧证据及新旧引用保留。提交普通推送并核对远端SHA后停止，交文档提交独立复审。
