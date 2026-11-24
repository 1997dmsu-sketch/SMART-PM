# 统一人脸登记入口：UTF-8 EOF 独立回归补证任务（2026-11-24）

## 1. 任务与固定基线

用户已要求继续安排下一项最小工作。本卡仅安排独立 EOF 覆盖补证，实施与 Windows 合成验证交本地 Harness，结果交独立 Codex；本卡交付不表示已创建 Harness 派单、已运行测试或已取得补证结果。

- 仓库：`https://github.com/1997dmsu-sketch/SMART-PM.git`。
- 直接代码与证据起点：`6ecb337d4d7e84de6080af53e335b75ec7f46875`，父为已验收修复 `f3bef713f651daf90c71cba43674cf1d1dbdecf5`，再前为 `2d7f935868662d6fe6d4830de9d975af1ba4a260`。
- [既有验收记录](https://github.com/1997dmsu-sketch/SMART-PM/blob/6ecb337d4d7e84de6080af53e335b75ec7f46875/docs/evidence/hk-face-enrollment/INPUT-P2-ACCEPTANCE-2026-11-24.md)：两 P2 已关闭；246/246 为旧合成运行结果，本次不重开验收、不重跑整套来代替新覆盖。
- 现有 EOF 边界是非阻断 `NOT_COVERED`，本任务不把它改判成旧测试失败。补证前继续保留该状态。
- 执行分支：`test/hk-face-enrollment-utf8-eof-2026-11-24`；从上述 6ecb337 新建独立 worktree，不合并本任务文档分支。
- 执行人先查同任务 running/queued、同名本地/远端分支与既有 EOF 交付；已在做则续原任务，已覆盖则提供固定证据，不重复创建或覆盖。查询结果按实际时间记录。

## 2. 最小实施范围

唯一允许修改的既有文件：

`admin-web/tests/face-enroll-powershell.test.mjs`

唯一允许新增的已跟踪文件：

`docs/evidence/hk-face-enrollment/UTF8-EOF-REGRESSION-2026-11-24.md`

在既有 PS5.1/PS7 参数化测试装配内，各新增一个有独立标题的 EOF 回归；同一回归内可有负例及必要的正控。复用既有 run/invoke/fakeEntry，不改变旧测试逻辑、标题、断言、输入向量或 helper 语义。若这个范围不足，以具体差异报告，不自行扩大。

以下全部原字节不变：生产 PowerShell 启动器、CLI、三个业务核心模块（`admin-web/lib/face-enrollment.mjs`、`admin-web/lib/hikvision-client.mjs`、`admin-web/lib/face-access-plan.mjs`）、其他测试、package/lock、原验收/修复文档、所有旧日志/工件/引用。原 240＋6 项测试不删除、不放宽。新运行产生的本轮 fixture 使用全新目录，不复用或清理旧残留。

## 3. EOF 样本与真实装配

固定基线测试文件 L151–179 的旧向量 `[0xe4,0xb8]` 在 L163 后仍拼接 ASCII JSON 尾部，只覆盖非法续字节，不修改这个历史样本。

本任务只补一类明确的 EOF 样本：

1. 以纯合成 ASCII JSON 字符串前缀开始，末尾追加原始 `[0xe4,0xb8]`。
2. 缓冲区必须直接在这两个字节后结束；不拼接 JSON 尾部、不加引号/换行/终止符，不先转为 JS 字符串，不用 PowerShell 文本管道重编码。
3. 以 `Buffer` 经既有 invoke→run→stdin.end 送入实际 PowerShell 启动器副本，再真正关闭 stdin，使读取器遇到 EOF；先断言发送缓冲区实际尾字节及长度。
4. 使用既有 fakeEntry 复制真实启动器，只将登记 child 换成会在第一条语句留下合成启动哨兵的假入口。不得接真实登记实现或设备 adapter，不用 JS/.NET helper 单测代替实际包装器链路。
5. PS5.1 和 PS7 分别执行同一 EOF 类别。这不宣称所有 UTF-8 长度及前缀组合均已覆盖，不新增其他编码边界任务。

参考实际生产路线：启动器 L49–66 为原始字节读取与严格解码，L215–228 调用该路径，登记子进程准备/启动在其后。本任务不改变这些行。

## 4. 固定 oracle 与有效性证据

每个宿主均独立保存对应结果，并断言：

- 包装器进程退出码 `2`、summary.wrapperExitCode=`2`；
- summary.childExitCode=`null`、timedOut=`false`、error=`input-invalid-or-too-large`；
- 捕获到的包装器 stderr 为空、stdout 是既有单行 JSON 形状；
- 该新证据目录内 child stdout/stderr 文件为空，exit-code.txt 为原有 `not-started-or-unknown` 加 LF；
- 本负例新 fixture 根在请求前无启动哨兵，结束后仍无；拒绝摘要不泄露合成载荷、不输出替换字符。

“Node 未启动”只指被测包装器的登记 child，不指测试 runner 本身或其他正控的 Node。child=null 单独不足以证明解码门有效：每个宿主用同一假入口源码、独立全新目录及合法 UTF-8 输入作正控，证实 child 能实际启动并留下哨兵。正控不得污染 EOF 负例目录，不删除哨兵凑结果。

至少一次安全可证伪控制：只在工件副本中单点关闭严格 UTF-8 拒绝，复用新增 EOF 断言，证明 EOF 用例会失败且假 child 可达。不修改或覆盖受测原启动器/仓库文件，不运行真实 child。负控与正式结果分列；无法安全完成时如实报告缺证，不以人工判断代替。

保留既有合法 U+FFFD/恰 32KiB 正例等原断言，不把其中刻意返回 `4` 的假 child 误报为整套回归失败。

## 5. 执行环境与唯一正式命令

执行必须在本地 Windows，使用已经安装的 Windows PowerShell 5.1 和 PowerShell 7。记录 Windows、父 shell、两 PowerShell 与 Node 的实际版本；旧证据的 5.1.22621.6133 / 7.6.9 / Node v24.16.0 只作来源记录，不预填成本机结果。

唯一正式聚焦命令，在新 worktree 仓库根执行：

```text
node --test admin-web/tests/face-enroll-powershell.test.mjs
```

不执行 `npm.cmd --prefix admin-web test` 或其他全量/HTTP/设备套件。该文件只运行其已有合成装配与本次新增 EOF，不是完整 CLI 或真实登记验收。使用默认测试隔离，不擅自切换隔离参数、安装/升级依赖或放宽系统策略。

正式完结要求两宿主的新 EOF 都真实执行通过。缺宿主、权限拒绝、ENOENT、skip/todo/cancelled 不计该宿主 PASS；如环境不齐，报告部分结果及 BLOCKED，不安装环境来绕过。本轮不要求因缺项改写旧 246/246。

可证伪工件命令可用精确 test-name-pattern 只选新增 EOF；完整命令、真实退出码及未选择项单列，不把 pattern 跳过旧项说成全套通过。每个命令先保存原始退出码和 stdout/stderr，再做解析；不得仅保留摘要或用管道末端退出码替代。

## 6. 证据、提交与停止点

新报告需包含：固定基线、真实执行时间（Asia/Shanghai）、环境、命令、两宿主逐项结果、正控/负控、实际测试计数和未覆盖项。旧 246/246 单独标历史，不能预填新增后 248 或宣称本轮复跑了 246。

运行前后对受测启动器、CLI、三个业务核心模块与本次测试作仓库相对路径/字节/SHA-256 清单；受测版本提交后核对 Git blob 与实际测试字节一致。生产源码、旧报告和旧工件零 diff。

原始运行日志及新指纹清单保存在本地独立证据目录，不增加本卡白名单外的 Git 文件。新报告只列相对工件名/大小/SHA-256，并给独立复审可实际读取的受控交付方式；本地绝对路径不假定在云端可读。无附件或取件通道时明确材料尚未交付，不伪造附件 ID 或证据通过。不把重命名副本冒称已脱敏。

追加提交前核对变更范围恰为一个既有测试＋一个新报告，执行 git diff --check；提交后 git show --check。普通显式 refspec 推送 `HEAD:refs/heads/test/hk-face-enrollment-utf8-eof-2026-11-24`，ls-remote 核完整 SHA，回报父提交链及干净工作树。若推送失败保留本地事实，不改配置或强推。

只追加提交，不 amend/rebase/reset/squash/force/merge/cherry-pick，不推 main，不改全局/系统 Git、TLS 或安全设置。不读取真实凭据/照片/私钥、不连接设备、不重复登记人员、不清理旧残留、不运行 E1/E2；默认 simulation、长期、1 号门及已核验全天规则不动。

完成后停在 **Stop-EOF**，交独立 Codex 复审；若 EOF 真值负例失败，保留失败并报告，不顺带改生产实现或重开已关闭 P2。只有本次补证独立通过后才可在新的范围记录中标明该 EOF 样本已覆盖，原验收快照的 NOT_COVERED 原文保留。
