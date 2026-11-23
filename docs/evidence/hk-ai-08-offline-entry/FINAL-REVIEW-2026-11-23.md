# HK-AI-08 受控入口合成离线接入最终限定复审结论（2026-11-23）

**结论：最终只读复审通过，未发现阻塞性问题。仅接受固定提交所记录的原 140 项回归及新增 264 项合成离线接入验证通过。结论限于合成字节加载、同域私有快照绑定、独立单次令牌、受控编排及品牌化假传输/假输出；不扩大为完整 CLI 接入、真实认证/文件/ACL/TOCTOU/TLS 验证完成或 E1 放行。**

本文件固化此前已经完成的最终复审结论。本次只新增文档，没有重跑测试、产品或采集器，不产生新运行、用例计数或采集引用；提交后仍交独立复审。此前的代码、测试和取证审查均为只读，运行结论依据保留的原始日志，不冒称复审时重新执行。

## 1. 固定对象和本次文档范围

- 复审对象及本次文档分支直接起点：`f0d3a6d4a93e64cbe8e57fa31164b827edfad8d0`。
- 被复审对象的唯一父提交：`24b53855757f5758c55131c95746cbf56746849d`。
- 被复审实现共六文件变化：修改原 bridge 一项，新增入口 README、bytes/entry 源码、新测试及执行证据报告五项；原 140 测试、checker、历史报告和方案未改。
- 本次独立文档分支：`docs/hk-ai-08-offline-entry-final-review-2026-11-23`，从完整固定 SHA 新建独立工作树；本次只新增本文，不修改上述实现、测试或任何原报告。
- 原执行报告：[OFFLINE-INTEGRATION-2026-11-23.md](OFFLINE-INTEGRATION-2026-11-23.md)，15068 字节，SHA-256 `a4c9ba724ae102d0ece088edf815f23803590c14779dbd3fa6196486b83c9415`，保持原样。

最终复审分别独立核对代码门禁、测试注册/断言及取证完整性后汇总结论。源码不仅核对工作树文件，还直接读取固定提交 Git blob 原始字节，在内存重算哈希，与实际运行的来源记录对应；未以新 tip、静态预期计数或报告的 PASS 字样代替核验。

## 2. 已接受的代码与接口结论

| 项目 | 限定复核事实 |
|---|---|
| 合成字节加载 | 普通 dense byte 数组防御性复制；length 超过 65536 在 keys 枚举前拒绝。fatal UTF-8、解码前 BOM 拒绝、解码后重复键、深度 16、null 原型 JSON、有限数及 surrogate 检查符合合同，闭式 schema/显式值继续校验，不作缺项默认回退。 |
| 同域快照绑定 | prepareBytes 进入同一实例的 private prepare/WeakMap；原值 checker 与规范投影、执行视图和许可绑定于私有不可变 snapshot，没有在入口外重建另一份执行配置。额外执行字段另行校验；每次假调用实际比较完整视图。 |
| 独立单次令牌 | 私有品牌和绑定身份校验；许可在任何 await/假调用前同步消费，每次调用、认证重发、响应返回及输出前复查撤销、epoch、取消、窗口与预算。并发、失败、取消及输出失败均不恢复许可，context 文本回滚不复活旧绑定。 |
| 品牌假执行边界 | 新入口十一 API 与原八 API 分开，原 scope/八 API 的已审行为保持兼容。假传输/假输出闭式复制冻结，不接受任意执行回调，无真实环境/配置/凭据、网络、监听、子进程或文件写入入口。 |
| allowRead | 原输入 true 被拒绝；执行视图复制快照 false，许可不翻转此字段。来源修改隔离负控不构成真实执行授权。 |
| 编排及摘要 | 六端点精确顺序，G1 最终错误阻断后续，401 每端点最多一次重发、最多十二模拟传输；解析失败记 unknown。闭式摘要保留整体 status/code；假输出 fail/throw 不重试，execute 返回失败，sink.last 只保留尝试前摘要，不能据此宣称输出成功。 |

上述是合成入口的实际代码路径及其静态复核，不是原 CLI/runProbe 或原网络模块已完成接入的证明。

## 3. 已复核的两阶段实际证据

原 140 项测试文件保持原字节，在修改后实现上实际回归；新增测试通过真实 byte-entry/受控编排路径，expected 独立手写，含 43 个字段差异负控。各用例有唯一 ID，harness 逐项 await 断言后计数，失败记录 ID 并导致非零退出码；有界微任务竞态测试不靠固定 PASS 字符串替代执行。

| 阶段 | 各组实际通过/总数 | 合计 | 失败 ID |
|---|---|---:|---|
| 原 CB-01～CB-06 回归 | 46/46、6/6、5/5、50/50、23/23、10/10 | 140/140 | `[]` |
| 新接入 LOADER/BINDING/FLOW/AUTH/PERMIT/OUTPUT | 66/66、48/48、37/37、23/23、53/53、37/37 | 264/264 | `[]` |

以上共 404 项，仅表示该固定提交记录的合成断言。它们不是完整未来矩阵、设备能力或 Windows 原生权限场景的计数，也不因本文新增而增加运行次数。

此前实际运行环境为本机 Windows `10.0.22631.0`、Node `v24.16.0`，由 PowerShell Core `7.6.9` 采集；原回归时间 `2026-11-23T12:06:21.9476754+08:00` 至 `12:06:22.0720820+08:00`，新接入时间 `12:06:22.0975301+08:00` 至 `12:06:22.5649884+08:00`。这是两次 Node 合成测试进程，不是重跑 Windows PowerShell ACL 主预检。

- 原回归 raw stdout：452 字节，SHA-256 `81f282e630d54649819749875b4b637033e3f102ddfe5950156ad357247cedcc`。
- 新接入 raw stdout：448 字节，SHA-256 `31f1e9f9067fe110490dfdf47cff69d15f1b78f9c184cf3c3dcbf994a44b9d1e`。
- 两份 stdout 均 LF 结尾，与各自脱敏副本逐字节相同，与原报告 JSON 全字段对应。两份原始/脱敏 stderr 均为 0 字节，SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
- 两个退出码文件均为原始字节 `300A`（即 `0\n`），2 字节，SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`。采集器以独立 BaseStream 保存 stdout/stderr，WaitForExit 后立即读取该子进程 ExitCode。

新运行日志目录相对本次独立工作树根为 `../HK-AI-08-offline-entry-2026-11-23-run01/`。原件继续留本机，不随本次文档提交复制或上传。元数据中的 NOT_EXECUTED 等为采集器声明，零设备路径另由固定可达源码支持，不冒称独立网络流量观测。

## 4. 完整性复审结论

此前独立取证复审逐行重算原报告中的 **七项来源和十九项工件**的字节数及 SHA-256，全部匹配；七项来源另与固定提交 blob 原始字节直接对应。四份执行前后来源 manifest 完全相同，artifact manifest 的十八项均匹配，其自身哈希也与报告一致。工件逐项定位与哈希继续以原报告第 6 节为准，不回填历史记录。

| 来源 | 字节 | 执行前 = 执行后 = 固定提交字节 SHA-256 |
|---|---:|---|
| tools/hikvision-offline-config-binding/src/bridge.mjs | 34947 | `a2f4b736b67fece57dec8c7a8b711de56dd59a3c58f439bb33a3707bda2b94e0` |
| tools/hikvision-offline-config-binding/test/bridge.test.mjs | 37470 | `1506f319e0792b831bc264a1d8d315cbd3eafb78f560ad795ac957c1260da17a` |
| tools/hikvision-offline-config-checker/src/check-config.mjs | 10463 | `a8dbde46942aca550e13fdddb27e93bd5c9d1902e8cbdfb09cb31befc0eecfb7` |
| tools/hikvision-offline-entry/README.md | 9892 | `a9870853d3239387ac8bf72e2861d088918e2b3181dfb25b2db7cb0fefa51730` |
| tools/hikvision-offline-entry/src/entry.mjs | 242 | `77b438bf8beaa1ab9c9bdf8885265a72d98d50c39e51feaf0091b7a659cfae76` |
| tools/hikvision-offline-entry/src/bytes.mjs | 4894 | `8eb41d8784f66f5d4416d5459ab80fd1cf72f75486afcec1d8e568259ef82e36` |
| tools/hikvision-offline-entry/test/entry.test.mjs | 52308 | `bd61740592bdf91efb5b6468c1452ab3e74dd4160084e7cce9c7b2444016746b` |

修改后的 bridge 使用上述新哈希；更早报告中 `65549b9c…` 等历史哈希继续指向其原提交字节，不能改写为本次新值。哈希前后相同也不构成代码路径、文件对象或原生身份的原子绑定证明。

## 5. 历史保留、真实能力边界与停止点

保留全部原报告、日志和新旧引用，互不替换，不以新 PASS 覆盖旧 FAIL：

- 旧 ACL 失败 `hk-acl-f03a3e07eb4f4c13a5ee8d1326ec84a4`，仍保留原 CLEANUP_FAILED，现存状态未知且未重查。
- 既有 Windows ACL 成功样本 `hk-acl-ede6254418504fb5be49561f3cdb0865`。
- 既有 Node 启动失败 `hk-node-acl-549bdd3a8849407aa3dd9253ff28c6dd`。
- 既有 Node 成功样本 `hk-node-acl-8023cbfe08e44160a493abacd7c88246`。
- 既有绑定桥采集 `hk-cb-143b0d8768dc4ef4acd470f2daaf5d94`。
- 受控入口采集 `hk-entry-f67a184f60d3402f8a532606ec1863f2`，仅关联该次采集，不是 ACL evidenceRef、残留定位、配置相等或审批真实性证明。

更早绑定桥 run01 准备失败及其外层原始流未单独落盘的限制不回填，不将摘要冒充原始日志。本轮文档工作不读取日志或候选残留，不检查其存在、认领、复用、清理或放宽 ACL；不产生新 cleanupVerified。受控入口内存测试没有创建 ACL 根/哨兵，不能把“不适用”写为新的原生清理通过。

假响应/挑战仅为合成的解码后记录，SHA-256/auth 是固定假策略；未解析原始 HTTP/XML/JSON/Digest header、生成 Authorization 或计算真实认证摘要，不是原 Digest 修复，也不证明设备支持该算法。原实现可能省略 qop 后重发的历史事实保留。假 elapsedMs 不证明真实 deadline/分块流/在途急停；内存假输出不证明 Windows 文件保护。sink.last 的 pre-output 摘要不替代 execute 的输出失败结论。

真实来源文件加载、可信审批/凭据租约/撤销及真实时钟、代码字节/文件对象原子绑定、Windows sink/CreateNew/句柄/ACL/文件 ID/TOCTOU、原始响应解析、pin-before-send、DNS/peer、真实网络时限与完整 CLI 仍未验证；合成 epoch 与前后哈希不消除同用户并发或哈希后路径重读风险。本次仅接受 NT/EV 的合成编排和策略子集，不将其完整生产要求改判通过。

本次仅新增本文，追加提交并普通推送独立文档分支，以显式 refspec 交付、核对远端完整 SHA 后停止交独立复审。除 Git 交付外不发起网络操作；不重跑、不清理、不读真实配置/凭据、不连接设备、不运行原探针或 E1/E2，不合并、部署或上线。**本文不作 E1 放行。**
