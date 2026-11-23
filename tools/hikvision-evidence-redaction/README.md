# HK-AI-08 离线路径替换步骤与 capture 适配

固定起点 `ed88f00acbf146c54fec229e6fcd47a905f83116`。本工具是可版本化、纯内存的路径转换步骤：未来 collector 可使用的新步骤，旧 collector 不动、未接入与未跑。它不调用原 collector，不读写文件、不启动进程、不读取环境变量、配置或时钟，不访问网络、设备或真实 TLS。旧源码、原报告、旧 collector 及 raw/redacted 副本不改；本轮不新制作旧日志脱敏副本。旧 `allowRead=false` 代码保持原字节，不代表真实 CLI 接入或 E1 放行。

问题来源仅为旧 PowerShell collector 的静态审查：对 raw JSON 字符串直接 `Replace`，不能可靠命中 JSON 双反斜杠编码的路径。静态来源长度为 5956 bytes、SHA-256 为 `d68b71ac6db852611791e265b9fe194c2f8df562dd6a48a60e8765e50e34b2df`。本工具不复制旧脚本的实际路径，也不把旧日志当作转换输入。

## 公共接口

`src/redact.mjs` 只导出两个同步函数：

```js
redactEvidenceText({ text, format, worktreeRoot, profileRoot })
prepareRedactedCapture({ stdout, stderr, worktreeRoot, profileRoot })
```

输入必须是普通原型或 null 原型对象，精确包含上述 enumerable own data properties。所有值必须是 primitive string；拒绝 Proxy、getter、symbol、隐藏键、未知键、包装字符串及其他对象，不调用输入方法或任意执行回调。`format` 仅 `json-lines` 或 `text`。text/stdout/stderr 不接受孤立 surrogate，空字符串允许；每个转换输入的 UTF-8 上限为 262144 bytes。先验证闭式输入和 format、text 的 Unicode/总字节上限，再验证 roots。capture 先检查两个流的字符串形状，再按 stdout、stderr 顺序转换；任一失败不返回另一流的结果。

两个 root 都必须由调用者显式提供，各最多 1024 个 UTF-16 code units，是 drive 绝对 Windows 目录，至少包含一个正常目录段。接受大小写、正反混合分隔符、重复分隔符和可选尾分隔符；不接受 drive 根目录、相对/UNC/extended 路径、`.`/`..` 段、控制字符、`<>:"|?*`、尾点/尾空格或保留设备名。`profileRoot` 必须恰为 `drive:\Users\account`（大小写不敏感），不能多一层目录。worktree 恰为任何 drive 的 `Users` 父目录时拒绝，避免父目录先替换后把账号留在占位符后；worktree 等于 profile 时允许，按 worktree 优先整体替换。不读取环境变量或推测本机路径。

单流成功返回深冻结、精确字段：

```js
{
  scope: 'offline-evidence-path-redaction-only', status: 'PASS', code: 'OK',
  text: transformedText,
  counts: { records, stringTokens, changedTokens, worktreeReplacements, profileReplacements }
}
```

失败精确返回 `{ scope, status:'FAIL', code, text:null, counts:null }`。错误码只可能是 `INVALID_INPUT`、`INVALID_ROOT`、`INPUT_TOO_LARGE`、`INVALID_JSON_LINES`、`SENSITIVE_KEY`、`RESIDUAL_PATH`、`INTERNAL_ERROR`，不回显输入或异常。

capture 使用同一 `redactEvidenceText` 路径：stdout 的 format 为 `json-lines`，stderr 为 `text`。成功深冻结返回 `{ scope, status:'PASS', code:'OK', stdout, stderr, counts:{ stdout:counts, stderr:counts } }`；任一失败精确返回 `{ scope, status:'FAIL', code, stdout:null, stderr:null, counts:null }`。它不部分成功，也不退回 raw；调用者未来仍需自行决定如何保管转换结果，本工具没有文件保存步骤。

## 转换与保留边界

`json-lines` 保留原 LF/CRLF、只含 space/tab 的空白行、键序、空白、数值词法及所有未改变 token 的原字节；CR 仅可作为 CRLF 的一部分，裸 CR 拒绝为 `INVALID_JSON_LINES`。先对整批每个非空白行调用现有 `../../hikvision-offline-entry/src/bytes.mjs` 的 `decodeSyntheticConfigBytes`，严格检查单条 JSON、重复键、BOM、UTF-8/孤立 surrogate 和最大深度 16；每行最多 65536 bytes。该 loader 的原文件不改，返回的解析树直接丢弃。全部行验证通过后才转换 token；任意行 loader 的拒绝优先统一为 `INVALID_JSON_LINES`，整批输出为 null，前行也不公开。

语法验证后只扫描 JSON string token，并用 `JSON.parse` 解码单个 token。只替换字符串 value 中的已知 root：worktree 优先映射为 `<TASK_WORKTREE>`，profile 映射为 `<USER_PROFILE>`；改变的 token 用 `JSON.stringify` 编码，未改变 token 原样复制。不对整对象 parse/stringify，因此大整数、`-0`、指数、日期及非路径字段保持原词法。单层 JSON Unicode 转义中的路径可在 token 解码后命中。key 只检查、不改写；key 中有已知目标或可识别的其他 Users 路径即 `SENSITIVE_KEY`，避免改变 schema。

已知根按大小写不敏感方式匹配，允许正斜杠、反斜杠、混合及重复分隔符；动态 root 中的正则特殊字符按字面转义。日志中根前可以紧贴中文说明或其他文字前缀，仍按显式已知根替换，不要求前边界。根之后必须是路径分隔符、字符串结束或合理文本分隔符（ASCII 空白、引号、括号、逗号等）；字母、数字、下划线、连字符和文件名扩展等 suffix 不作边界，句点仅在其后为结束/ASCII 空白时作句号。worktree 可以位于 profile 内，匹配 worktree 后不再次把同一位置计入 profile。

`text` 不解析 JSON，直接替换显式 root，重复反斜杠也可匹配，其他字节原样保留。两种格式在替换后若仍可识别 `drive:\Users\account`（含大小写变化、混合或重复分隔符），返回 `RESIDUAL_PATH`，不作为安全副本返回。另有最多两轮、只用于失败探测的 `\uXXXX` / `%XX` shadow 展开；若展开后显露已知 root 或 Users 路径，同样失败，不将展开内容写入输出。这只是有限残留探测，不承诺任意多重编码、URL、其他目录、密码、nonce、token 或任意秘密的通用 DLP。未命中路径的字段（包括未知 password/nonce）保持不变；PASS 只表示本路径转换契约通过，不能称为生产完整脱敏。

计数来自实际转换：`records` 是通过严格校验的非空白 JSON 行数；`stringTokens` 包含 JSON key 和 value；`changedTokens` 是实际改变的 JSON value token 数；两个 replacements 是各已知根实际匹配次数。`text` 不产生 JSON records/token，因此前三项为 0，两个替换次数照实统计。失败只返回 null counts，不返回部分计数。所有成功结果及其各层 counts 都冻结。

## 本轮验证范围

本阶段仅使用合成 fixtures 验证路径转换与 capture 的全成全败契约，不使用真实日志作为转换输入。验证结果由独立测试记录给出，本文不预先宣称通过，也不运行旧套件。尚未执行旧 collector，未修改旧副本，未验证文件保管、ACL、文件句柄/ID、TOCTOU、生产完整脱敏、真实 TLS/网络或真实设备行为。未来如接入 collector，仍需另行审查调用点和文件保管，不能从本纯内存 PASS 推断那些工作已完成。
