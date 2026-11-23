# HK-AI-08 受控入口离线接入核验

固定起点 `24b53855757f5758c55131c95746cbf56746849d`。本阶段仅为有界合成字节加载、已审私有绑定桥、新受控编排、品牌化假传输/假输出的一条实际代码路径。没有真实配置/环境/凭据加载、网络、DNS、监听、子进程、Windows 文件输出或清理入口；不运行原 CLI/runProbe，不作完整 CLI 接入或 E1 放行。原 checker、原 140 项测试及历史报告保持原样。

## 1. 接口与私有域

`src/entry.mjs` 导出 `createSyntheticOfflineEntry(context)`，实现在原 bridge 模块内部与原 factory 共用校验、私有 snapshot/projection、bindings/permits WeakMap 和 epoch/time 逻辑。每个实例独立品牌域；不得在入口外重建第二份执行配置或公开快照。原 `createSyntheticBindingBridge` 的八个 API、scope 和行为保持兼容；新 factory 不公开原 object prepare/executeSynthetic 或任意执行回调。

新 factory context 与原桥相同，公开 API 精确为：

- `prepareBytes(bytes)`：严格加载后调用同域 private prepare；返回 binding/configBindingRef/checker，拒绝时三者为 null。
- `createFakeTransport({expected,responses})`：expected 与原假执行器的闭式执行视图相同，私有复制冻结；responses 为下文闭式脚本。返回 fakeTransport，失败为 null。
- `createFakeOutput({outcome})`：outcome 仅 success/fail/throw；返回 fakeOutput，失败为 null。不是文件写入器或回调。
- `issueSyntheticPermit(binding,grant)`、`revokeSyntheticPermit(token)`、`advanceSyntheticTime(now)`、`replaceSyntheticRuntime(context)`：继承原合成许可契约，grant scope 仍为 synthetic-fake-execution-only；每绑定最多签发一次，非真实审批机构。
- `cancelSyntheticBinding(binding)`：永久取消该绑定；取消不会恢复或重新签发许可。
- `executeOffline(binding,token,fakeTransport,fakeOutput)`：只消费本域品牌句柄，不接受配置、函数或传输覆盖；返回 configBindingRef 和 summary（未消费许可的门禁失败为 null）。
- `observeTransport(fakeTransport)`：返回 calls、trace、last、remainingResponses；last 为空或原桥那组闭式比较布尔。trace 每项精确为 endpointId/attempt/authenticated/requestMatched，不含请求配置或认证材料。
- `observeOutput(fakeOutput)`：返回 calls、last（空或闭式 summary），不返回配置或材料。

新 API 统一结果为冻结的 `{scope:'synthetic-offline-entry-only',status,code,...}`，成功 PASS/OK，失败 FAIL/固定 code。无有效绑定时 configBindingRef=null。工厂无效 context 抛固定 SYNTHETIC_CONTEXT_INVALID，其余不格式化原输入或异常。句柄为空、null 原型、冻结对象，只有私有 WeakMap 品牌有效。

## 2. 字节加载契约

唯一配置入口为 dense 普通 byte 数组，1–65536 字节，各项为整数 0–255；普通数组原型且仅 length/索引 own data properties。先防御性复制，拒绝 Proxy、getter、symbol、未知/隐藏键、稀疏、Buffer、TypedArray、SharedArrayBuffer 或字符串，不调用输入迭代器/toJSON。

UTF-8 fatal 解码前显式拒绝 EF BB BF BOM。JSON 根深度为 0、最大容器/值递归深度 16，拒绝无效语法、尾随内容、非有限数字、孤立 surrogate；所有对象以 null 原型构造，按字符串转义解码后的键拒绝重复。解析树只进入私有 prepare，不公开。

失败码分别为 INVALID_BYTES、INPUT_TOO_LARGE、INVALID_UTF8、BOM_NOT_ALLOWED、INVALID_JSON、DUPLICATE_KEY、INPUT_TOO_DEEP。确认普通非 Proxy 数组及安全 length 后，大于上限立即报 INPUT_TOO_LARGE，不枚举其 keys/元素；超限输入不再穷尽验证稀疏/装饰等形状。其余容器形状错误报 INVALID_BYTES。解析后使用原 hk-ai-08-synthetic-binding-v1 schema 与全部原白名单；缺项不默认回退，原始 allowRead=true 仍拒绝。合成凭据仅已知 SYNTHETIC_ 标记，host 仅保留示例范围，output 仅 synthetic- 引用。

## 3. 闭式假传输脚本

responses 是 1–12 项 dense 普通数组，每项精确为：

```js
{
  endpointId: 'deviceInfo', attempt: 1, status: 200,
  parseable: true, model: 'DS-K1T671BM', capability: 'unknown',
  challenge: null, elapsedMs: 0
}
```

endpointId 仅已审六端点 ID，attempt 仅 1/2；status 为 100–599 整数；parseable 为布尔；model 仅 DS-K1T671BM / SYNTHETIC_OTHER_MODEL / SYNTHETIC_UNKNOWN_MODEL；capability 仅 confirmed / unsupported / unknown；elapsedMs 为 0–600000 整数。非 401 的 challenge 必须为 null。401 的 challenge 可为 null 或精确 `{algorithm,qop}`：algorithm 仅 SHA-256 / MD5 / unsupported / malformed / absent，qop 仅 auth / auth-int / unsupported / malformed / absent。

这是合成的解码后响应/挑战记录，不是原始 HTTP/XML/JSON/Digest header 解析器，也不生成 Authorization 或计算真实认证摘要。固定假策略仅接受 parseable=true、algorithm=SHA-256、qop=auth；MD5、缺省、不支持或畸形项在假认证重发前拒绝，不隐式省略 qop。真实设备算法支持仍 UNKNOWN，真实认证适配仍未验证。

每次假调用实际比较同一私有快照派生视图与 expected 的全部字段；不匹配为 FAKE_EXPECTATION_MISMATCH，且不消费 response。脚本的 endpointId/attempt 必须与该次实际编排相同，否则 FAKE_SCRIPT_MISMATCH；耗尽报 FAKE_SCRIPT_EXHAUSTED，成功完成六端点后有多余记录报 FAKE_SCRIPT_REMAINS。每次实际假调用的 calls/transmissions 都加一（包括不匹配/耗尽）；trace.requestMatched 仅在完整视图及脚本 id/attempt 都匹配时为 true，authenticated 仅 attempt=2 时为 true。脚本/expected 的调用者修改不影响私有副本。

## 4. 编排与逐次门禁

六 GET 字面、查询及顺序继承原桥 ENDPOINTS；端点和认证重发分别计数。G1 任意非 200、不可解析、型号 unknown/不匹配即停止，G2–G6 NOT_EXECUTED；parseable=false 为 G1_RESPONSE_INVALID，unknown/other model 均为 G1_MODEL_MISMATCH。G2–G6 非 200（认证错误除外）或解析失败记 unknown 后继续（stage code 分别 HTTP_STATUS / RESPONSE_INVALID）；200 可解析才采用脚本显式 capability，成功 code=OK，绝不把解析失败写成零或 confirmed。

每端点首次 401 最多一次认证重发；第二次 401 立即 AUTH_RETRY_EXHAUSTED 并停止。首次挑战不满足上述策略报 AUTH_CHALLENGE_REJECTED，不进行第二次假调用；最多六逻辑端点/十二模拟传输，无会话重试、重定向或响应 URL 入口。

许可在任何 await/假调用前同步消费。每次假调用前、微任务边界后、响应返回后及输出前，复查 binding/token identity、撤销、epoch、合成窗口、取消、会话 deadline/剩余预算。取消也阻断该绑定后续签发。fake 的 elapsedMs 单调推进本域合成时间，累加先检查安全整数溢出；控制门禁优先，多个时间阈值同时达到时固定按 sessionDeadlineMs、requestDeadlineMs、timeoutMs 的顺序报告，边界均为 >=。它不证明真实网络时钟、分块流超时或在途 socket 急停。

控制失败、fake 不匹配、输出失败或内部异常均不恢复许可。旧绑定在 context 变更/回滚后永久失效。取消码 SESSION_CANCELLED，其余继承原码，并新增 INVALID_TRANSPORT、INVALID_OUTPUT、AUTH_CHALLENGE_REJECTED、AUTH_RETRY_EXHAUSTED、G1_HTTP_STATUS、G1_RESPONSE_INVALID、G1_MODEL_MISMATCH、FAKE_SCRIPT_MISMATCH、FAKE_SCRIPT_EXHAUSTED、FAKE_SCRIPT_REMAINS、FAKE_OUTPUT_FAILED、SESSION_DEADLINE_EXCEEDED、REQUEST_DEADLINE_EXCEEDED、INACTIVITY_TIMEOUT、CLOCK_OVERFLOW、TRANSMISSION_BUDGET_EXCEEDED。

## 5. 闭式输出与验证

summary 精确为 `{schemaVersion:'hk-ai-08-offline-summary-v1',phase:'synthetic-offline-only',status,code,counts,stages,allowReadStayedFalse}`；status/code 表示整体会话结果，与 execute 返回结果一致；counts 精确为 logicalEndpoints/transmissions/authRetries/unknownEndpoints；stages 固定六项，每项为 id/state/code/httpStatus/transmissions。初始 state/code 为 NOT_EXECUTED、httpStatus=null、transmissions=0；进入后 state 仅 confirmed/unsupported/unknown/blocked，code 只固定类别，httpStatus 只脚本数值或 null。permit 消费后已知快照 allowRead=false，summary.allowReadStayedFalse 必须 true。

发生至少一次假传输后，尝试一次假输出保存冻结 summary（包括失败摘要）；消费前/首假调用前门禁失败不调用输出。输出 fail/throw 返回 FAKE_OUTPUT_FAILED，不重试、不恢复许可；此时返回 summary 的整体状态相应更新，sink.last 仍保留写入尝试时的 pre-output summary，不回填伪造成功写入。输出前控制面失败保留结果摘要，但不调用 fake output。公开结果/观察只含固定字段、ID、计数、布尔、非敏感引用与状态码，不含目标、凭据、CA/pin、原响应/异常或其摘要。

回归命令（本轮运行时由外层分别保存原始 stdout/stderr、退出码和前后源码哈希）：

```powershell
node .\tools\hikvision-offline-config-binding\test\bridge.test.mjs
node .\tools\hikvision-offline-entry\test\entry.test.mjs
```

原 140 项文件不改；新增接入场景以实际输出计数，不能借旧 140/140 代替本次回归。仅覆盖 NT-01～NT-04、EV 等的合成编排/策略子集，不验收这些完整生产要求。Windows 文件 sink/ACL/句柄/文件 ID/TOCTOU、真实来源文件加载、pin-before-send、DNS/peer、真实审批/撤销/时钟、原始响应解析与完整 CLI 仍未验证。历史报告、日志和新旧引用全部保留，不访问或处理任何残留；提交推送并核对远端 SHA 后停手交独立复审。
