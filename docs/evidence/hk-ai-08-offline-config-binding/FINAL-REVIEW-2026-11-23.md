# HK-AI-08 绑定桥及 CB-01～CB-06 最终限定复审结论（2026-11-23）

**结论：最终只读复审通过，未发现阻塞性问题。仅接受固定提交的纯内存合成配置绑定桥及 CB-01～CB-06 共 140/140 项合成离线验证证据。此结论不扩大为完整 CLI 接入、真实文件/ACL/TOCTOU 验证完成或 E1 放行。**

本文件固化此前已经完成的最终复审结论。本次仅新增文档，没有重跑测试、产品程序或采集器，不产生新运行结果、新用例计数或新的运行引用；文档提交后仍交独立复审。

## 1. 固定对象与复审依据

- 复审对象及本次文档分支直接起点：`6ed5cabb521bed3711de547ad9e310a5f4e1860c`。
- 对象唯一父提交：`8c1eeadfb0934e87ef7b713044b1e22ebd2f3815`。
- 被复审提交仅新增执行证据报告、工具 README、`src/bridge.mjs`、`test/bridge.test.mjs` 四个文件，旧 checker、ACL 工具、既有报告及方案未改。
- 本次独立文档分支：`docs/hk-ai-08-binding-final-review-2026-11-23`，在新工作树从完整固定 SHA 建立；只新增本文，不修改上述四个文件或任何历史证据。
- 执行方原报告：[CB-01-06-2026-11-23.md](CB-01-06-2026-11-23.md)，13001 字节，SHA-256 `841df896aae6e4d16bc360bb02647272857df127b7b3adbc5df9c2299250574b`，原样保留。

此前最终复审分别独立只读检查代码契约、测试断言与取证完整性后汇总结论。复审直接读取固定提交 blob 的原始字节，核对源码、报告、既有原始 stdout/stderr、退出码、前后来源 manifest 及脱敏副本；没有重新执行它们。本次文档固化不把这些既有核验写成新一次运行。

## 2. 绑定桥的限定结论

| 项目 | 已复核事实 |
|---|---|
| 私有不可变快照 | 闭式 own-data-descriptor 校验及防御性复制；Proxy 在反射前拒绝，拒绝 getter/未知字段等。私有配置递归冻结，无调用者可变对象别名；CA 用冻结普通字节数组及独立假传输副本，不依赖 freeze Buffer。 |
| 核对/执行视图绑定 | 安全复制的原值先投影给旧 checker，通过后规范化并再次核对冻结投影；执行视图只从同一私有快照派生。TLS/材料、限制、输出引用、版本、合成凭据和端点另行校验，不能由 checker PASS 补齐。 |
| 私有身份 | 每实例独立 WeakMap 品牌，公开句柄为空、null 原型、冻结对象；伪造、复制、Proxy、跨实例或仅持相同公开引用不能替代句柄身份。随机 configBindingRef 仅关联，不证明内容或授权。 |
| 独立单次令牌 | 令牌与配置句柄独立，绑定快照身份、批准引用、context epoch 及合成时间窗；每绑定最多签发一次。同步消费先于 await/假执行，微任务后重查撤销、窗口及 epoch，失败、抛出和不匹配均不恢复；并发不产生第二次假执行。 |
| allowRead | 原输入 true 被拒绝，不通过改成 false 放过；执行视图复制快照中的 false，合成许可不翻转此字段。CB-02 对调用者原对象改为 true 是隔离负控，不是执行授权。 |
| 执行边界 | 仅闭式内建假执行器，不接受任意执行回调，不加载真实配置/凭据，不导入原 CLI/transport；没有文件写入、网络、监听、子进程或清理入口。checker 的 node:net.isIP 只作词法检查。 |

## 3. 既有 140 项离线证据

| 组 | 实际通过/总数 | 验证范围 |
|---|---:|---|
| CB-01 | 46/46 | 3 正例及 43 个执行视图字段独立差异负控；expected 独立手写，逐字段不匹配及失败后不可重放有断言。 |
| CB-02 | 6/6 | 原对象/列表/端点、expected、context 来源修改隔离；公开对象冻结、字节副本隔离及公共结果不泄露配置值。 |
| CB-03 | 5/5 | prepare/签发后对合成来源设置抛错 getter，执行零重读；不是实际 env/outDir/CA 文件变化测试。 |
| CB-04 | 50/50 | 闭式输入、Proxy/getter/toJSON/原型/数组、目标/显式端口、allowRead、非 ASCII、限额/模式/端点等 fail closed，禁止用 INTERNAL_ERROR 冒充预期拒绝。 |
| CB-05 | 23/23 | 无/伪造/复制/跨域/错绑定/重放、重复签发、窗口、撤销、并发、微任务复核及 fail/throw 不恢复；门禁拒绝时假执行器不调用。 |
| CB-06 | 10/10 | 改变合成运行 context 使旧绑定失效，回滚文本/同文本重设也不恢复；区别于 CB-02 的来源修改隔离。 |

测试源码实际注册 140 个唯一 ID，各项 await 断言完成后计数；失败进入 failedCaseIds 并导致非零退出码，不靠固定 PASS 字符串代替断言。既有 raw stdout 的六组计数为 `46/6/5/50/23/10`，总计 `140/140`，失败 ID 为 `[]`。

既有实际执行发生于本机 Windows `10.0.22631.0`，Node `v24.16.0`，由 PowerShell Core `7.6.9` 采集，时间为 `2026-11-23T11:36:51.8235394+08:00` 至 `11:36:51.9878834+08:00`。这是 Node 合成回归，不是新一次 Windows PowerShell 原生 ACL 检查。

- run02 原始 stdout：452 字节，含末尾 LF；SHA-256 `81f282e630d54649819749875b4b637033e3f102ddfe5950156ad357247cedcc`，与脱敏副本逐字节相同，与原报告 JSON 全字段对应。
- run02 原始及脱敏 stderr：均为 0 字节；SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
- run02 退出码文件：实际字节为 `0\n`，2 字节；SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`。采集器分流保存 BaseStream，WaitForExit 后立即保存该子进程 ExitCode。
- run01 为采集器 Node 多路径选择导致的准备失败，测试 **NOT_EXECUTED**，不计入 140 项或测试运行次数。早期外层原始 shell 流未单独落盘的限制原样保留，错误类别摘要不冒充原始日志。run02 仅修正采集器路径选择，没有修改被测代码或放宽断言。

元数据中的 `deviceRequests=0` 等字段是采集器声明，零设备执行边界另由固定可达源码无传输路径支持，不冒称独立网络流量观测。原始日志仍只在本机保存，不在此次文档提交中复制或上传。

## 4. 源码及工件完整性

此前复审重算原报告列明的四项来源及十四项工件的字节数和 SHA-256，全部匹配；另外直接核对提交 blob 原始字节，与已执行来源、工作树及报告一致。以下来源的执行前后哈希相同：

| 来源 | 字节 | SHA-256（执行前 = 执行后 = 固定提交字节） |
|---|---:|---|
| tools/hikvision-offline-config-binding/README.md | 9204 | `e65de1e94f0c7ff6f90cb65cad12939317ed10bef8ac6bc41964355e1fba0262` |
| tools/hikvision-offline-config-binding/src/bridge.mjs | 21696 | `65549b9c7fc0920041a8f0289d2acf2d5a6b276e3393a527046c0645fb3e873a` |
| tools/hikvision-offline-config-binding/test/bridge.test.mjs | 37470 | `1506f319e0792b831bc264a1d8d315cbd3eafb78f560ad795ac957c1260da17a` |
| tools/hikvision-offline-config-checker/src/check-config.mjs | 10463 | `a8dbde46942aca550e13fdddb27e93bd5c9d1902e8cbdfb09cb31befc0eecfb7` |

run02 before/after manifest 及 run01 prehash 相同；run02 artifacts manifest 中九项也全部匹配。工件完整相对定位、字节数及逐项哈希继续以原报告第 6 节为准，不改写历史记录。两组日志目录相对本次独立工作树根仍为 `../HK-AI-08-config-binding-2026-11-23-run01/`、`../HK-AI-08-config-binding-2026-11-23-run02/`。

## 5. 历史保留与未完成边界

保留原报告、日志与所有新旧引用，互不替换，不以新 PASS 覆盖旧 FAIL：

- 既有 ACL 失败：`hk-acl-f03a3e07eb4f4c13a5ee8d1326ec84a4`，仍为原 CLEANUP_FAILED，现存状态未重查。
- 既有 Windows ACL 成功样本：`hk-acl-ede6254418504fb5be49561f3cdb0865`，未重跑。
- 既有 Node 首次失败：`hk-node-acl-549bdd3a8849407aa3dd9253ff28c6dd`，未重新验证、认领或清理。
- 既有 Node 成功样本：`hk-node-acl-8023cbfe08e44160a493abacd7c88246`，未重跑。
- 绑定桥采集引用：`hk-cb-143b0d8768dc4ef4acd470f2daaf5d94`，只作该次采集关联，不是 ACL evidenceRef、残留定位或授权证明。

本轮文档工作没有访问候选残留、检查其存在、认领、复用、放宽 ACL 或清理；不生成新的 cleanupVerified 结论。CB 内存回归不创建 ACL 证据根/哨兵，不能写成新的原生清理通过。

合成许可签发器不是可信审批机构；合成时间、版本和输出标签不认证真实批准单、代码字节或文件 ID。仍未完成真实配置加载及编码/重复键边界、真实审批/撤销与时钟、Windows ACL 保护根接入与 TOCTOU、pin-before-send、Digest/qop 拒绝适配、DNS/peer 绑定、绝对网络时限、响应解析/脱敏或完整 CLI。CB-03/CB-06 的合成验证不能替代这些真实来源和执行身份要求。

本次仅新增本文，追加提交并普通推送到独立文档分支，以显式 refspec 交付并核对远端完整 SHA 后停手。除 Git 交付外不发起网络操作，不重跑、不清理、不读真实配置/凭据、不连接设备、不运行原探针或 E1/E2，不合并、部署或上线。**本文不作 E1 放行。**
