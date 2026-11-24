# CF-R2-14：5398d1e 归档证据勘误（2026-11-24）

本次只追加归档说明与[Git原始字节清单](lane-D/GIT-ARCHIVE-MANIFEST-2026-11-24.json)，不改写历史日志、旧MANIFEST或files.sha256。本勘误记录的是字节核验，不是一次产品测试、Windows补跑或验收通过。

## 固定来源与清单范围

- 固定归档提交：`5398d1e06769dc1be7e0c81e060084d412ae0665`；直接父：`d85b61835a214afb625e877c37575e636094f873`。
- 历史来源：[lane-D/MANIFEST.json](lane-D/MANIFEST.json)、[lane-D/README.md](lane-D/README.md)及[lead交付报告](DELIVERY-REPORT-2026-11-24.md)，引用内容均按上述固定提交读取，不能把并行修订中的工作树当成该历史快照。
- 新清单逐项覆盖旧MANIFEST列出的同一组61条相对路径，共169097B；不把旧MANIFEST自身、本文或新清单加入这61条。旧MANIFEST原件为10652B，SHA256 `85a6ac50f4c4bf238bd31504efbec58371a01773e4c65484d3ec9390e00c1123`，仅在新清单元数据中单独绑定。
- 每项bytes/sha256均取`git show <固定提交>:docs/evidence/checkin-face-rework-2026-11-24/lane-D/<file>`输出的原始字节；不做CRLF、BOM、编码或Unicode归一。路径唯一、相对且无`..`；新清单不是历史Windows磁盘清单的重制品。

## 七项差异

旧MANIFEST的61项中，54项与Git归档字节完全匹配，7项不匹配。新清单`comparison.differences`保留逐项旧登记值、Git归档值与分类，`files`列出全部61项的实际归档值。

| 文件（均相对lane-D） | 旧登记字节 | Git归档字节 | 核对结果 |
|---|---:|---:|---|
| `files.sha256` | 908 | 908 | SHA256不同，不能用CRLF或UTF-8 BOM变化解释，见下文。 |
| `run-cross-module-frozen-candidate.exit-code.txt` | 3 | 2 | `1\r\n`与`1\n`，退出值仍为1。 |
| `run-cross-module.exit-code.txt` | 3 | 2 | `0\r\n`与`0\n`，退出值仍为0。 |
| `run-qa-gates-raw.exit-code.txt` | 3 | 2 | `1\r\n`与`1\n`，退出值仍为1。 |
| `run-qa-gates.exit-code.txt` | 3 | 2 | `0\r\n`与`0\n`，退出值仍为0。 |
| `run-source-verify.exit-code.txt` | 3 | 2 | `1\r\n`与`1\n`，退出值仍为1。 |
| `run-static-check.exit-code.txt` | 3 | 2 | `0\r\n`与`0\n`，退出值仍为0。 |

`files.sha256`旧登记SHA256为`35f8c23be2014542aa742cab14548d131d45eceddb8d33dc226095bd365803ba`，Git归档实际为`9d97dde5dce5ac2815b0056d4bf9723f568f9c3621eb539e12efa3ab3f254cce`。当前908B内容、仅LF→CRLF版本及其分别加UTF-8 BOM的版本均不匹配旧摘要。这是内容摘要不一致，不能归入另外六项的换行差异；没有取得旧登记摘要对应的原文件，不推断变化时间、具体编辑内容或责任来源。旧文件保持原字节，新清单也不反向“修正”原日志以迎合旧hash。

六个退出码文件则可逐项由归档`0\n`或`1\n`构造对应CRLF字节，完全复算出旧登记的3B和SHA256；这只解释字节差异，不把相同数值写成相同hash。历史stdout存在UTF-16，解码只用于阅读计数，清单仍按编码未变的原字节计算。

## Windows历史回报与Linux独立证据分开

固定lead交付报告L30–34自述Windows Node v24.19.0的最终97/97、65/65、107条来源校验及npm检查通过；这些最终精确命令、原stdout/stderr与退出码未随5398d1e入树。本次没有取得或生成这些原件，不把汇总升级为已核对的Windows最终日志。旧`run-source-verify.*`记录的是来源清单复算前的exit1，README L34–40、136已说明时点，既不删除该失败快照，也不冒称它是最终exit0。

后续独立Linux复审来源为`cd87072b3dd58ce6a08a7378e4c51065133948da`中的`docs/evidence/checkin-face-rework-2026-11-24/CODEX-REVIEW-5398d1e-2026-11-24.md`及其`codex-review-5398d1e/MANIFEST.json`。该复审记录Linux Node v24.22.1的97/97、65/65、继承防护重取同组65/65（不重复累加）、107条归一来源校验，以及隔离目录真锁安装78包、SDK3.18.7解析/导入成功；未调用SDK.init或业务云/设备。这些是独立Linux证据，不能充作实施方Windows最终原件，也不证明Windows运行、生产装配或真实云连通。

原Windows最终日志若仍保有，应按原件另行补交并绑定精确命令、环境、退出码及原字节hash；没有原件就继续标未取得，不能为补件重制或要求重复旧测试。本文不将此缺口写成已补齐。

## 616报项、八条诊断与导航勘误

- 固定`git diff --check 0d6c674..5398d1e`默认口径退出2，共616项：config测试69、worker测试199、静态脚本66、页面测试282，均为既有CRLF文件新增行的尾CR，无其他尾随空格或Tab。历史报告的616数值保留；不能写默认检查零报项，也不为消除此记录批量转换旧证据行尾。
- 八条`[待集成]`来自固定`t.diagnostic`文案，不是八个skip或八处未实现分支。固定归档跨模块日志解码后为19/19、0 fail、0 skip；更早`run-cross-module-frozen-candidate.*`为11 pass、8 fail，属于另一时点，原样分列保留。这些计数是读取历史日志所得，本次没有重新运行测试；也不以删除诊断字样充当新通过。
- 旧README L39、73多写了`negative-controls/results/`层级；正确归档位置分别是[lane-D/negative-controls/c1-baseline.stdout.txt](lane-D/negative-controls/c1-baseline.stdout.txt)（配套stderr/exit-code同目录）与[lane-D/negative-controls/results.json](lane-D/negative-controls/results.json)。本文追加正确入口，不改旧README历史字节。

CF-R2-14的归档字节勘误与后续代码/测试验收分列。本说明不把旧交付报告L56的“四路全部完成、无阻断”解释为独立验收结论；今天的测试包授权不扩大为正式发布、上传部署或真实设备操作。旧已关闭事项及102、负责人手填租期、按租期起止/每天24小时、普通账号原审核渠道、待现场本人刷脸等边界保持。
