# 人脸删除快照门禁 P1 限定验收结论（2026-11-28）

本文件固化本会话已经完成的最终独立复审结论，针对固定修复提交的写前快照门禁及合成离线证据。文档整理日期为2026-11-28（Asia/Shanghai）；本轮没有重新运行测试、负控、应用或设备操作。

## 固定对象与结论

- 验收对象：`0d1104ec579d7066f1f9ca95ce9f627999957eb2`。
- 修复提交的直接父提交：`b90233833abefdfc9f412de27c64dd9273a4e3a4`。
- 本文档分支以验收对象为固定起点：`docs/hk-face-snapshot-acceptance-2026-11-28`。
- 结论：**限定复审通过，原 P1 在本轮逻辑写入边界及合成离线范围内关闭，未发现新增阻断项。**

原 P1 是人员身份初次核对后，经过异步查询或首库删除发生同编号人员替换，后续脸库仍可能收到删除 PUT。此次关闭仅针对该可补的写前重核缺口，不表示所有并发替换均可识别或所有 TOCTOU 风险已消除。

本次交付只新增本文件。源实现、测试、配置、依赖、旧实施记录、旧报告与日志原字节不改；[实施记录](SNAPSHOT-GUARD-FIX-2026-11-28.md)继续保留实施方当时“不自行宣布验收关闭”的表述，本文件另行固化后续独立复审结论。

## 写前重核与停止语义

已完成的源码复核确认修复仅向生产模块新增8行检查：

1. 每个实际人脸删除 PUT 前，分别重新读取该 `employeeNo` 的人员记录并比较既有 `managementIdentity`。明确已不存在的脸库不发送 PUT。
2. 最终人员删除 PUT 前，在最后一次 DeleteProcess 查询之后再次重核。重核与对应逻辑 PUT 之间没有额外异步查询；未改变底层 SDK 的认证往返或设备处理过程。
3. 重核发现投影变化或该次重核时人员消失，直接返回 `failed / PERSON_CHANGED_BEFORE_DELETE`，停止后续 PUT；此前已有脸库写入也不会把已知变化改记为 pending。
4. 重核读取异常保持原语义：首次写前为 failed；已有写入后为 pending，并保留 operation，后续 follow 仅读、不补发删除。对于需要实际写入的当前库，步骤在重核通过后才创建；重核读取失败不会新增步骤将此前 present 的记录误记为 already-absent。

原“两库后读取不到人员、转只读 follow 核对剩余库”的 already-absent 路径保留，它不会继续发破坏性写入；不能将本结论概括为任何阶段的人员消失均返回 failed。

## 合成回归及负控验收

以下均为修复实施阶段已有运行的证据核验结论，不是本轮文档任务的新运行结果。

| 正式分组 | tests/pass | exit |
| --- | ---: | ---: |
| 普通 admin-web | 408/408 | 0 |
| 独立守卫下 tenant | 6/6 | 0 |
| 根目录 | 297/297 | 0 |
| worker 合成回归 | 35/35 | 0 |
| worker 网络守卫自检 | 2/2 | 0 |
| 合计 | **748/748** | **全部0** |

原始 TAP、独立 exit.txt 和 summary 相互吻合，fail/cancelled/skipped/todo 均0。50个测试文件的执行参数与前轮一致；按测试名称多重集独立核对，原742项全部保留，新增恰好6项。原“全部脸库写后读失败”用例只将故障注入限定到第二库完成后，以保留其原场景，原全部断言未删除或弱化；新的中途读失败用例另行覆盖首库后的停止路径。

新增6项验收范围：首写前 FDSearch 期间替换人员、移除人员；首库删除后完整替换同编号人员；最终 DeleteProcess 期间替换人员；首次重核读失败；已有首库写入后的重核读失败。

其中关键回归使用 `Map.set` 替换完整人员对象并保留第二库脸，明确断言：总 PUT 仅已授权的首库1次、替换后所有后续 PUT 为0、替换人员及第二库记录保留。最终人员 PUT 边界的回归则允许此前两次已完成的脸库 PUT，替换后仍为0次 PUT。不能把“后续 PUT 为0”误写成整个多库流程从未发送过首库 PUT。

旧基线生产模块上的同6项负控真实结果为 **0通过、6失败、exit1、无skip**，失败来源为业务断言，证明旧缺口可被检出。负控生产源码与父提交 blob 一致，前后字节未变化。它与正式748项通过分开记录，不改记为正式PASS。

三项相关静态检查既有结果为exit0；`verify-import`仍为旧基线 `cloudfunctions/login/config.json` 哈希差异、exit1，如实保留。未修改旧来源清单或目标文件凑匹配，不能据此声称全部静态检查通过。

## 源码及原始证据核验

最终复审已独立核对九项受测源码的测试前后SHA256、当前磁盘与验收提交 Git blob，一致。核心原始字节SHA256如下：

| 对象 | SHA256 |
| --- | --- |
| 修复后 `admin-web/lib/face-enrollment.mjs` | `789e1fa39a7a01cce1d363f16f0ec4eb3107c3833f9063136b0d6a78acf128be` |
| 修复后 `admin-web/tests/face-management.test.mjs` | `bf38ee5bd1ebffff67b892f7e15e63a28594c59a46dcbe6e56549a1dd979f286` |
| 负控生产模块、修复父提交生产 blob | `f25fc2c34177ce755f71d9a84f28394c51a8826d3deccc166d15a6670232628f` |
| 未改动的 `admin-web/lib/hikvision-client.mjs` | `d79ef3ba00914d4bc551ab363315f6fdb183da44088577fe14c1902786e76001` |

实施记录的57条工件表记录、manifest中60个原件/脱敏条目，实际字节数和SHA256均匹配；20组日志原件与脱敏副本字节一致。正式与负控原始日志、退出码及前后哈希均保留，详见实施记录中的逐项清单。

本机证据根目录为 `D:\chatgpt\smart\FACE-DELETE-SNAPSHOT-VALIDATION-20261128T014143-c051d42a`，关键相对定位为：

- `baseline-negative.stdout.log`、`baseline-negative.stderr.log`、`baseline-negative.exit.txt`、`baseline-negative-summary.json`。
- `final-offline-summary.json`、`final-offline-source-before.json`、`final-offline-source-after.json`、`regression-coverage-verification.json`。
- 各组 `*.stdout.log`、`*.stderr.log`、`*.exit.txt`，以及 `artifact-manifest.json`。
- `git-committed-byte-verification.json`、`local-commit-result.json`、`remote-verification.json`。

复审包 `review-bundle-0d1104ec579d.zip` 实际90,607字节，SHA256为 `6988c515a6a451e67a67632f4e67f786a8ed3a1b2b3544424d1e9ce3d3999b7a`；58项逐一匹配清单及磁盘，无额外或重复文件。本机原始日志继续保留，包提供脱敏日志及非敏感证据。上述路径只表示同机可读取的实际文件，另机复审需要负责人实际提供，不是云端附件或虚构附件ID。

最终复审核对验收提交及其父、分支和干净工作树与交付记录一致；原推送/ls-remote记录均指向完整SHA `0d1104ec579d7066f1f9ca95ce9f627999957eb2`。该复审对远端仅核对既有记录，未联网重查，也不替代本次文档分支自身随后需要完成的推送和远端SHA核验。

## TOCTOU与实机边界

快照继续采用既有人员投影：编号、姓名、门权限/计划及有效期。最终一次读取与设备实际处理 PUT 仍非原子；完全相同投影的替换、最后读取后才发生的外部变化，以及底层认证往返期间的残余窗口，均不在本轮保证内。没有新增或声称设备端锁、CAS、零误删或完整竞态消除能力。

SDK证书pin、ACL、session/Origin/CSRF、单次确认、逐人限制及只读跟进门禁未放宽。此结论不扩大为完整CLI接入、真实设备删除验收、设备当前人员/人脸状态核验、现场识别/开门成功或E1/E2放行。此前9人名单和指定目标入库状态受网络阻断、未完成新源码实机复验的限制仍保留。

## 文档交付停止点

本轮仅新增本文件，保留全部旧报告、日志、对象及新旧残留引用；没有重跑测试/负控、读取真实凭据/照片/名单、连接设备、删除人员、开门、启动派发、处理旧队列或清理残留。也不配置VPN、部署或上线。

本文件提交推送并核对完整远端SHA后，停止并交独立复审文档准确性及范围；不以文档交付扩大上述限定验收。
