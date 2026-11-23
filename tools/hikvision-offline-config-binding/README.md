# HK-AI-08 合成配置绑定桥（CB-01–CB-06）

范围：纯内存对象 API、合成配置、内建假执行器。没有文件/环境/凭据加载、网络/设备/子进程/监听或残留处理入口，不导入原探针 CLI/transport。原 checker 保持不改。此实现不是完整 live 桥，也不产生真实审批有效性或 E1 放行结论。

固定起点：`8c1eeadfb0934e87ef7b713044b1e22ebd2f3815`。复用该树的 `../hikvision-offline-config-checker/src/check-config.mjs`（原交付 `31f20c9a372c447f142312f6e95e0400372f9ee8`），本轮不改 checker 或既有方案/报告。CB-01–CB-06 是既有未来矩阵的本阶段子集，其余文件、网络、审批真实性等验证不由本次补齐。

## API 契约

`createSyntheticBindingBridge(context)` 创建独立私有 WeakMap 域。context 为闭式 `{versions, output}`；versions 的四项为 `tool/checker/adapter/endpoints`，output 为 `rootRef/policyRef`。上下文只是本阶段合成的版本/输出标签，不认证真实工具字节或实际文件身份。

返回冻结 API：

- `prepare(input)`：闭式校验/防御性复制，先以安全复制的原值调用现有 checker，再规范化并复核投影；成功产生冻结空句柄 `binding`、随机非敏感 `configBindingRef` 和只含布尔/计数的 checker 结果。配置不公开。
- `createFakeExecutor({expected, outcome})`：产生本桥域内的假执行器句柄；outcome 仅 `success/fail/throw`。不是回调，不接受外部函数或真实传输。expected 是独立提供的合成执行视图，假执行器实际比较目标/TLS/材料/限制/输出/版本/凭据/端点/allowRead，公开观察只含布尔和计数。
- `issueSyntheticPermit(binding, grant)`：grant 严格为 `{scope:'synthetic-fake-execution-only', approvalRef, windowStart, windowEnd}`，引用匹配该快照；每个 binding 最多签发一个令牌。令牌是不含数据的冻结空对象，私有身份绑定到该快照与上下文 epoch。**公开的合成签发器不是可信审批机构，不验证真实批准单。**
- `executeSynthetic(binding, token, fakeExecutor)`：只接受本桥的三个句柄，不接受覆盖配置。令牌在任何假执行调用/await 前同步消费，执行失败也不恢复；微任务边界后再次检查撤销、窗口和 epoch。执行视图始终 allowRead=false。
- `revokeSyntheticPermit(token)`：私有状态永久撤销。
- `advanceSyntheticTime(now)`：非负安全整数，且只能单调前进；没有系统时钟回读或任意 clock 回调。
- `replaceSyntheticRuntime(context)`：仅合成测试控制面，每次调用递增 epoch；即使文本回到原值也不能恢复旧绑定/令牌。
- `observeFake(fakeExecutor)`：返回冻结的计数/比较布尔，不返回实际配置、秘密、其哈希或令牌材料。

除工厂拒绝无效 context 时抛固定错误外，操作结果均为闭式 `{scope,status,code,...}`，不格式化原输入或异常。prepare 成功含 binding/configBindingRef/checker，失败对应值为 null；permit 成功含 token；execute 成功/失败只含非敏感比较/调用计数。句柄不可通过空对象、复制、JSON、Proxy、相同公开引用或另一桥实例伪造。

公共 scope 固定为 `synthetic-config-binding-only`，成功为 PASS/OK、拒绝或合成失败为 FAIL。`createFakeExecutor` 返回带 `fakeExecutor` 的结果（拒绝时 null）；`issueSyntheticPermit` 带 token（拒绝时 null）。`observeFake` 带 calls 和 last；last 为空或闭式布尔记录：`targetMatches/tlsMatches/limitsMatch/outputMatches/versionsMatch/credentialsMatch/endpointsMatch/projectionMatches/allowReadStayedFalse/metadataFrozen/privateBytesIsolated/matched`。execute 结果带 configBindingRef（无有效绑定时 null）和 fakeCalls（该次调用0或1）。不提供私有配置读取 API。

固定拒绝码：`INVALID_INPUT`、`CHECKER_REJECTED`、`CONTEXT_MISMATCH`、`INVALID_BINDING`、`INVALID_FAKE_EXECUTOR`、`INVALID_PERMIT`、`PERMIT_ALREADY_ISSUED`、`PERMIT_BINDING_MISMATCH`、`PERMIT_USED`、`PERMIT_REVOKED`、`PERMIT_NOT_YET_VALID`、`PERMIT_EXPIRED`、`CONTEXT_CHANGED`、`INVALID_TIME`、`CLOCK_ROLLBACK`、`FAKE_EXPECTATION_MISMATCH`、`FAKE_EXECUTOR_FAILED`、`INTERNAL_ERROR`。上下文 epoch 变化永久拒绝旧绑定；窗口检查在消费前及微任务边界后进行。无效/未来窗口尝试不调用假执行器，已消费令牌不恢复。

## 合成输入及执行视图

prepare 的根字段精确为：`schemaVersion='hk-ai-08-synthetic-binding-v1'`、`dataClass='synthetic-only'`、`approvalRef`、`approvedTarget`、`candidate`、`execution`。

- approvedTarget：`deviceRef/host/port/model`；candidate：旧 checker 的 `deviceRef/host/allowedHosts/port/allowedPorts/expectedModel/allowRead`。端口输入为显式数字字符串，allowRead 必须原本为 false，绝不将 true 改为 false 后放过。
- execution：`tls/limits/output/versions/credentials/endpoints`。
- tls：`mode='fingerprint-pinned'/fingerprints/caBytes`；fingerprints 为 1–2 个不重复的规范大写 64 位十六进制字符串；caBytes 为最多 4096 个 0–255 整数的 dense 普通数组。拒绝 Buffer、TypedArray、SharedArrayBuffer 和稀疏/访问器数组；不靠 freeze Buffer。私有数组复制冻结；假传输得到另一个字节副本，并验证修改副本不影响私有材料。
- limits：显式正安全整数 `timeoutMs/requestDeadlineMs/sessionDeadlineMs/maxBytes`；要求 timeout ≤ requestDeadline ≤ sessionDeadline，且分别不超过 120000/120000/600000ms，maxBytes ≤ 262144。不是实际网络超时已实现的证明。
- credentials：`username/password`，仅接收以 `SYNTHETIC_` 开头的有限长度合成标记；不读取真实秘密。
- output：仅 `synthetic-` 引用，不接受实际路径；versions 为非空有限 ASCII 标签，tool/checker 为 40 位小写十六进制，adapter/endpoints 为合成版本标签。必须与工厂当前 context 相同。
- endpoints：六个闭式 `{id,method,path,expect}` 对象，顺序/字面值与下表一致；每个对象及数组都私有复制并冻结。

target 的 host 仅允许规范化后为 `example.invalid` 或文档示例网段的 IP（192.0.2.0/24、198.51.100.0/24、203.0.113.0/24）。这不触发解析/连接。approvalRef/deviceRef/rootRef/policyRef 必须是有限长度 synthetic- 标签；型号限定 DS-K1T671BM，不认证真实设备。对象只允许普通/null 原型且全部为 enumerable own data property，拒绝 Proxy、getter、符号、隐藏键、未知字段、toJSON 等。

先对原值复制后的四根投影调用旧 checker，保留其 ASCII-before-lowercase、精确型号和端口拒绝语义；通过后才作 trim/lowercase/端口规范字符串，并对冻结规范投影再次调用 checker。完整快照包含额外字段，它们由桥另行校验，不由 checker PASS 补齐。

假执行器 expected 为闭式 `{target,tls,limits,output,versions,credentials,endpoints,allowRead}`，target 为 `{deviceRef,host,port,model}`（port 为规范整数）；其他形状同上，allowRead=false。测试必须独立写出预期规范值，不从生产快照生成预期。

expected 只是匹配器的观察预期，不驱动路径、请求或配置；为负对照，允许同类型/有限长度 ASCII 的合法差异值（含 model、mode、端点 id/method/path/expect），但仍保持闭式结构、数组数量、合成凭据和保留 host 范围。不得通过规范化 expected 消除差异；任一字段不匹配即执行失败且令牌不恢复。prepare 的端点/模型/模式白名单不因此改变。

| id | method | path | expect |
|---|---|---|---|
| deviceInfo | GET | /ISAPI/System/deviceInfo | xml |
| acsCapabilities | GET | /ISAPI/AccessControl/capabilities | xml |
| userInfoCapabilities | GET | /ISAPI/AccessControl/UserInfo/capabilities?format=json | json |
| fdlibCapabilities | GET | /ISAPI/Intelligent/FDLib/capabilities?format=json | json |
| fdlibList | GET | /ISAPI/Intelligent/FDLib?format=json | json |
| fdlibCount | GET | /ISAPI/Intelligent/FDLib/Count?format=json | json |

## 验证及限制

仅运行本目录合成测试，不运行原探针、权限预检、HTTP/TLS/设备测试。CB-01–CB-06 为六组要求，实际子用例数与失败 ID 以运行输出为准。

```powershell
node .\tools\hikvision-offline-config-binding\test\bridge.test.mjs
```

CB-03 用 prepare 后的合成来源 getter 陷阱模拟 env/outDir/CA 来源被替换，验证零重读；不读取或修改真实 process.env/文件。CB-06 改的是桥内合成运行上下文，不把原输入修改隔离误算成版本改变失效。令牌测试包含伪造/跨域/错快照/重放/时间/撤销/并发及失败后不可重用。

本阶段不提供 JSON/字节输入解析器，字符串/Buffer 不是配置入口；未来真实加载器的编码/重复键检查仍需另行实现和复审。文件 ACL/原生 ID、DNS/对端、Digest/TLS/绝对网络时限及真实审批/撤销机制都不在本次实现范围。完整 CLI 仍未接入，E1/E2 未执行；全部旧报告、日志和残留引用保持不动。
