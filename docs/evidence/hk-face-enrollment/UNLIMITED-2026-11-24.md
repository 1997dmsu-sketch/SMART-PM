# 长期有效登记：实现与纯离线验证

本轮按长期有效需求扩展已有本地人脸登记功能。记录为执行方开发证据，待独立复审；没有真实人员/照片下发，也不作现场识别、门锁、生产或 E1/E2 放行结论。

- 固定起点：`e7be329342404265034a2277330b09cddf16547b`。
- 独立分支：`feat/hk-face-unlimited-validity-2026-11-24`。
- 工作树代号：`SMART-PM-face-unlimited-2026-11-24`。原工作树、报告、日志与全部新旧残留引用保留。
- 新离线证据目录代号：`FACE-UNLIMITED-OFFLINE-20261124-095856-9a32bf0d`。不含用户提供的照片、姓名、房号、凭据或证书。

## 协议依据与实现

本机 `HK-AI-08-isapi-reference-2026-11-23-run01/ordinary-guide.pdf` 物理第558、561、564、567页明确：`Valid.enable=false` 为人员长期有效，此时仍须发送合法的 beginTime/endTime；第551页描述设备时间范围。`2037` 等上界只用于日期合法性，不是长期语义来源。timeType 省略或 local 为本地时间，本实现显式发送 local。

`validityMode` 仅接受 fixed/unlimited；只有字段缺省（undefined）兼容默认 fixed，null、空串、布尔及未知模式拒绝。设备的 Valid.enable 选项明确含 false 才开放长期模式；模拟能力支持该模式。长期模式忽略请求内日期，从已归一化设备范围生成合法日期，真实 JSON 布尔 false 与日期一起下发。固定模式保持日期校验。

重试认领和最终查询共用严格比较：enable 对应本次模式、begin/end 对应本次快照、timeType 缺省或 local；相反模式、错误日期或 UTC 不会被采纳。上传成功门禁、门号/库约束、照片与同意要求、TLS pin-before-send、会话隔离、显式重试及清理边界均未放宽。未修改旧 CLI、allowRead 或 ACL 工具。

页面默认固定期限，明确能力允许时提供“长期有效”，切换后不提交用户日期，记录卡片仅显示长期有效。照片与原本四阶段状态语义保持不变。

## 真实执行结果

本机 Windows；PowerShell 7.6.9 Core；Node v24.16.0。Asia/Shanghai 时间 2026-11-24 10:01:11.8245475 至 10:01:13.3532651。

```text
npm.cmd --prefix admin-web test
EXIT_CODE=0
tests=136 pass=136 fail=0 cancelled=0 skipped=0 todo=0
```

其中业务40、页面辅助15；相对原121项新增15项（业务10、页面5）。新测试使用合成配置、假 provider 和假传输，未读取真实照片或凭据。原有传输18项、服务入口9项及其他管理端回归一起运行。四份改动源码/测试的原始字节 SHA-256 在完整测试前后保持一致。

新增用例覆盖：长期能力缺失/不同枚举形态、非法模式、合法范围日期、真实布尔 false、错误 enable/日期/timeType 读回、重试模式绑定、固定模式兼容，以及页面不提交日期、不显示占位截止日。此补丁未新增浏览器运行验证；页面标记与构造器由合成测试覆盖，不能写成实际浏览器或真机通过。

真实日志、退出码、执行时间和源码前后哈希按原样提交为 `artifacts/unlimited-*`，见 [字节与SHA-256索引](artifacts/unlimited-sha256.json)。另提供 Git blob 字节哈希，以区分 Windows CRLF 工作树和 Git 字节。原 artifacts/sha256.json 及所有先前报告保持原样。

## 待现场验证

能力与通用协议支持该表示，不等于此固件已接受本次真实登记。下一次获准真实下发时，须核对人员 Valid.enable 读回为 false，并保留真实写入/查询结果；设备不支持 FDSearch 的情况仍为 pending-site，建模及实际刷脸结果须现场确认。本轮设备请求0、设备写入0、真实照片上传0。
