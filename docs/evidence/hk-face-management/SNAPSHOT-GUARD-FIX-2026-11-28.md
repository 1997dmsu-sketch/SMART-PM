# 人脸删除快照门禁 P1 最小修复实施记录（2026-11-28）

本报告由实施方编写，交独立复审。已实现每次破坏性删除前重核确认快照，并通过原742项加新增6项、共748项合成离线验证；不自行宣布P1验收关闭，不作真实设备删除或E1/E2放行。

## 固定来源与范围

- 固定起点及本次提交的直接父提交：`b90233833abefdfc9f412de27c64dd9273a4e3a4`。
- 独立分支：`fix/hk-face-delete-snapshot-2026-11-28`。
- 新独立工作树：`D:\chatgpt\smart\SMART-PM-face-delete-snapshot-2026-11-28`；没有移动、切换或清理原发布及实现工作树。
- 仅修改 `admin-web/lib/face-enrollment.mjs`（新增8行）与 `admin-web/tests/face-management.test.mjs`，仅新增本报告。
- SDK、HTTP路由、UI、配置、依赖、worker、源哈希清单、旧报告与旧日志原字节不变。全部旧对象、人员名单原件及新旧残留引用保留；本轮不读取真实名单、照片、凭据或连接材料。

## 修复行为与边界

原流程在初始人员读取后，等待删除进度及多次FDSearch，再连续删除各库人脸；人员身份到脸库写入全部结束才复核。外部替换同编号人员时可能先误删后续库人脸，再报告身份变化。

当前在每个实际人脸PUT前重新 `findManagementPerson(employeeNo)` 并比较既有 `managementIdentity`；在人员删除前、最后一次DeleteProcess查询之后也重核。身份变化或消失直接返回 `failed / PERSON_CHANGED_BEFORE_DELETE`，立即停止后续PUT。重核通过后才记录当前待写步骤、更新 `phase` 和 `writeAttempted`，没有额外异步查询夹在重核与对应逻辑PUT之间。

读取异常保持既有语义：首次写入之前失败为failed；已有写入后为pending并保留operation，后续跟进只读。读取失败不会新增一个把present记录误标为already-absent的步骤。已知快照变化不会因已有写入而被改记pending。原“人员已不存在后只读核对剩余库”的路径保留，它不会再发破坏性写入。

快照仍使用既有人员投影（编号、姓名、门权限/计划及有效期），不改变协议身份定义。最终一次读取与设备实际处理PUT之间仍非原子；完全相同投影的替换以及最后读取后才发生的外部改动不在本轮保证内。没有宣称消除全部TOCTOU风险、增加设备端锁或CAS能力。

## 环境、时间与命令

本机Windows 23H2 build22631.6199；Node v24.16.0；PowerShell7.6.9；Windows PowerShell5.1.22621.6133。时区Asia/Shanghai，真实执行日期2026-11-28。未安装、升级运行时/依赖，未改执行策略、TLS、网络或全局/系统Git配置。

- 负控起始：01:44:02。正式全量：01:44:22—01:46:00。
- 负控命令：`node --require ./tests/support/d-network-guard.cjs --test --test-reporter=tap "--test-name-pattern=snapshot guard" admin-web/tests/face-management.test.mjs`。
- 正式分组命令沿用原742项的参数数组：22个普通admin文件；独立guard下tenant一文件；根目录23个文件；worker三文件；worker守卫自检一文件。完整命令在 `final-offline-summary.json` 和 `run-final-offline.ps1`，50个测试文件未增删。
- 普通admin组含合成loopback HTTP/TLS夹具；tenant、根目录和worker组分别使用原既有网络守卫，不改断言或守卫。没有启动真实worker、探针或应用服务。
- 各进程stdout/stderr独立重定向，返回后立即保存原LASTEXITCODE至exit.txt，之后才解析TAP。没有把外层证据脚本的退出码代替Node测试退出码。

## 负控与正式结果

先在生产源码仍为固定基线f25开头SHA的情况下运行新六项，实际exit1、0通过/6失败、无skip；负控前后源码字节不变。原始失败日志保留，该失败是回归检出能力证明，不记入正式PASS。生产修复后才运行全套，实际748/748通过。

| 分组 | tests | pass | fail | skipped | exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| admin-final | 408 | 408 | 0 | 0 | 0 |
| tenant-final | 6 | 6 | 0 | 0 | 0 |
| root-final | 297 | 297 | 0 | 0 | 0 |
| worker-final | 35 | 35 | 0 | 0 | 0 |
| worker-guard-selfcheck-final | 2 | 2 | 0 | 0 | 0 |

`regression-coverage-verification.json` 对照前一轮742项TAP名称多重集及命令参数：原742项名称全保留、无遗漏，新增恰好6项，正式fail/cancelled/skipped/todo均0。原“全部脸库写完后读失败”用例仅把失败注入限定到第二库之后，以维持其原场景；原全部断言保留，没有跳过或删除旧用例。另新增“首库后重核读取失败”用例，验证中途停止及只读pending跟进。

新增六项对应以下真实合成情景：

| 情景 | 正式结果与写入约束 |
| --- | --- |
| FDSearch期间替换同编号人员 | failed；全部PUT为0 |
| FDSearch期间移除人员 | failed；全部PUT为0 |
| 首库删除后替换人员并保留第二库脸 | failed；总PUT仅首库1次，替换后PUT为0，替换人员与第二库脸保留 |
| 两库写完、最终DeleteProcess读取期间替换人员 | failed；此前脸库PUT共2次，替换后PUT为0，未发人员DELETE |
| 首次人脸写入前重核读取异常 | failed；无operationId、PUT为0 |
| 首库后重核读取异常 | pending；总PUT1次，follow仍pending且不再PUT，第二库与人员保留 |

三项相关静态检查 `check-miniprogram`、`checkin-face-static-check`、`verify-checkin-face-sources` 均exit0。`verify-import` 实际exit1，仍为旧基线 `cloudfunctions/login/config.json` SHA不一致：实际 `aaaca9a93deaf1a608f958a2c44301ee117baec0a66d7977c619d827892662c6`，预期 `ca3664cc370f406d81b3d260e643ac226b52d2322ca8df6346b6476796bf6fc8`。未修改该文件或旧provenance来凑匹配，不能称全部静态检查通过。

## 原始字节哈希

固定基线生产模块为 `f25fc2c34177ce755f71d9a84f28394c51a8826d3deccc166d15a6670232628f`；基线测试文件为 `7430bec898b683b6ac025801fb559be4898a76700a249c0ed2ab0a0d166ecab6`。正式测试前后以下SHA256一致，测试后磁盘字节再次核对一致。

| 受测路径 | 正式测试前=后 SHA256 |
| --- | --- |
| `admin-web/lib/hikvision-client.mjs` | `d79ef3ba00914d4bc551ab363315f6fdb183da44088577fe14c1902786e76001` |
| `admin-web/lib/face-enrollment.mjs` | `789e1fa39a7a01cce1d363f16f0ec4eb3107c3833f9063136b0d6a78acf128be` |
| `admin-web/server.mjs` | `0b4c999ee71b151efc85b6d14777d093350e034caa63c7eed017cb448878a763` |
| `admin-web/public/face-ui.js` | `43d954d22fe3ad5498764e1991b9574d04e1521542a9cdb346041c8ae1ae31fd` |
| `admin-web/public/style.css` | `0ecea30847c15a225a62292391a31b5292963c72b2b47799fa97a540779d2a3d` |
| `admin-web/tests/face-management.test.mjs` | `bf38ee5bd1ebffff67b892f7e15e63a28594c59a46dcbe6e56549a1dd979f286` |
| `admin-web/tests/face-management-ui.test.mjs` | `a813242ab62aa7298ba6bc29fee87b42a626bf820bdcd2c95aa7e255d276e3af` |
| `admin-web/tests/face-server.test.mjs` | `94b3a329e913f92425f0ee23a13704b567bd591f8e72113e5556ae65d751a224` |
| `docs/checkin-face-experience-source-hashes.json` | `d01eb1ff12c4a921dd420047d52a215a19d16ec04a4814a2f27e8c665b5dde7c` |

提交前、提交后分别核对Git index/提交blob与上述受测字节；结果在本机结构化交付证据中记录。仅本报告为测试结束后新增文档，不影响受测实现。

## 工件定位与交付

本轮工件根目录：`D:\chatgpt\smart\FACE-DELETE-SNAPSHOT-VALIDATION-20261128T014143-c051d42a`。以下相对工件均真实存在于该Windows本机，不是云端附件；同机可直接读取，另机复审需由负责人实际提供文件。不得把本机路径当成远端可读附件ID。

所有原始日志保留；脱敏副本只移除个人profile路径/SID。日志内容仅为合成测试，不含设备地址、真实账号密码、证书、照片或云凭据。完整原件/脱敏副本/退出码/元数据清单见 `artifact-manifest.json`。

| 相对工件名 | bytes | SHA256 |
| --- | ---: | --- |
| `environment.json` | 245 | `5dbb49dfeb38668c6a80913b7dc826999ad0bb628cae13dae1413614d2808e63` |
| `baseline-source-hashes.json` | 976 | `fec1bcedb615ea8bc406fb342792725ceb4bb61a62d4c01af12eaecf451bf47c` |
| `baseline-negative-summary.json` | 1607 | `4efc66d7d692adfb1bf0c13153bf316dca70512026aefcc4287c620b19a0f5e2` |
| `baseline-negative.stdout.log` | 5554 | `042b381618ba93abcfa2816375893ad1e847c31692fb61f1565b612d5e2fd7df` |
| `baseline-negative.stdout.redacted.log` | 5554 | `042b381618ba93abcfa2816375893ad1e847c31692fb61f1565b612d5e2fd7df` |
| `baseline-negative.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `baseline-negative.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `baseline-negative.exit.txt` | 2 | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |
| `final-offline-source-before.json` | 1062 | `23f782117d4a5b447a8e1fbdd0db7c3cb1c32a2228b480f1553ffd56df499836` |
| `final-offline-source-after.json` | 1084 | `6c45a34d32f046ee5f8c670f6cebb43c3ac5b7cbbb75b59aaf07e56a043381c2` |
| `final-offline-summary.json` | 6460 | `6f4e34c2f2891342c9ebe541126112da2abe2d6b19c129437c79c078827a448b` |
| `regression-coverage-verification.json` | 2593 | `bc125a51a22ef8b6a11eeeaab54b919b064d7105b5d1b110bbe0106830cc219d` |
| `admin-final.stdout.log` | 91891 | `4cfaa8a1cef483f07a3e98eff953400688dd4dbdca7741ff1072a0e09385b8ba` |
| `admin-final.stdout.redacted.log` | 91891 | `4cfaa8a1cef483f07a3e98eff953400688dd4dbdca7741ff1072a0e09385b8ba` |
| `admin-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `admin-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `admin-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `tenant-final.stdout.log` | 1452 | `ae1b625c4daf0890709e0ffa5e316c2254f4b3fb8f3c161f01ee6eeec0403a2b` |
| `tenant-final.stdout.redacted.log` | 1452 | `ae1b625c4daf0890709e0ffa5e316c2254f4b3fb8f3c161f01ee6eeec0403a2b` |
| `tenant-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `tenant-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `tenant-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `root-final.stdout.log` | 98347 | `ffe57045aa5ee340f7145f0cc3c77a1e568e424de0e39e84a5d6959f8ab9288d` |
| `root-final.stdout.redacted.log` | 98347 | `ffe57045aa5ee340f7145f0cc3c77a1e568e424de0e39e84a5d6959f8ab9288d` |
| `root-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `root-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `root-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `worker-final.stdout.log` | 17406 | `e9cb755b1814b287c7e69aa32fa1fc94f65adebd8513a12ece300e768c45354a` |
| `worker-final.stdout.redacted.log` | 17406 | `e9cb755b1814b287c7e69aa32fa1fc94f65adebd8513a12ece300e768c45354a` |
| `worker-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `worker-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `worker-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `worker-guard-selfcheck-final.stdout.log` | 501 | `89f547bfc1b555680b7bec1ca19b119d9cc2970c9ab6dc1d016110e3a4532bc2` |
| `worker-guard-selfcheck-final.stdout.redacted.log` | 501 | `89f547bfc1b555680b7bec1ca19b119d9cc2970c9ab6dc1d016110e3a4532bc2` |
| `worker-guard-selfcheck-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `worker-guard-selfcheck-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `worker-guard-selfcheck-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `check-miniprogram-final.stdout.log` | 185 | `89535f0f900b0398830261e5ff0bddccdc309c859b94c34154d63f5a3994a2e0` |
| `check-miniprogram-final.stdout.redacted.log` | 185 | `89535f0f900b0398830261e5ff0bddccdc309c859b94c34154d63f5a3994a2e0` |
| `check-miniprogram-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `check-miniprogram-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `check-miniprogram-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `checkin-face-static-final.stdout.log` | 73 | `d3acf855ec25633177b8dfd2e04b93d122d66e0cdd7dc17fadde902208d790ad` |
| `checkin-face-static-final.stdout.redacted.log` | 73 | `d3acf855ec25633177b8dfd2e04b93d122d66e0cdd7dc17fadde902208d790ad` |
| `checkin-face-static-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `checkin-face-static-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `checkin-face-static-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `verify-face-sources-final.stdout.log` | 28289 | `8f870ecadb3604229733cc8d592e52c7aab89429f86327a888decc6b1b8ac5d3` |
| `verify-face-sources-final.stdout.redacted.log` | 28289 | `8f870ecadb3604229733cc8d592e52c7aab89429f86327a888decc6b1b8ac5d3` |
| `verify-face-sources-final.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `verify-face-sources-final.stderr.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `verify-face-sources-final.exit.txt` | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `verify-import-final.stdout.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `verify-import-final.stdout.redacted.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `verify-import-final.stderr.log` | 940 | `e752eb402a46b99e37ef8c9588f5d2b138c648fb4754cb5774a3eba68f92581d` |
| `verify-import-final.stderr.redacted.log` | 940 | `e752eb402a46b99e37ef8c9588f5d2b138c648fb4754cb5774a3eba68f92581d` |
| `verify-import-final.exit.txt` | 2 | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |

前一轮目录 `FACE-MANAGEMENT-READONLY-20261128T002105-22ad4914` 及 `FACE-MANAGEMENT-VALIDATION-20261127T195333-6ecc181f` 原件全部保留，旧报告没有覆盖。原9人名单、目标入库状态受阻及未实测删除的限制保持原结论；本轮无任何新增实机证据。

## 禁止动作与停止点

本轮实际凭据读取、真实设备连接、人员登记/删除、开门、照片读取/上传、云数据库修改、派发启动、残留清理及E1/E2均为0。仅合成输入、假client和合成loopback夹具；未改变ACL、证书pin、会话/CSRF/Origin、单次确认、逐人限制或只读跟进门禁。

普通显式推送到本独立修复分支，`git ls-remote`核对完整远端SHA；不amend/rebase/reset/squash/force/merge/cherry-pick，不推main。提交、检查与远端结果另保存在本机交付证据，工作树须最终干净。

完成后交独立复审；本报告只记录实施和合成验证，不关闭实机验收或作删除/E1/E2放行。
