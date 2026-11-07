# HK-AI-04 H2-a 第一部分复审：`8ec35f4`（2026-11-07）

结论：**三项主修复通过，仅剩时间戳非负校验；补齐后第一部分直接通过。第二部分/H2-b 当前继续关闭。**

独立验证：集合 18/18、后台 286/286、根测试 51/51 通过。

已确认：

- head/version fingerprint 矛盾为 `DOMAIN_INCOMPLETE`；
- realm 不再 trim，带空格配置为 `503 NOT_CONFIGURED`；
- `applyOperationKeyDomain()` 在任何状态分支前校验 realm/version/fingerprint/now；
- 首次生成的 head/version 分别经过正式 validator；
- 生成记录、配置 mismatch 与存储 incomplete 的判定顺序正确。

剩余一项：

- `now`、head `createdAt`、version `enabledAt` 当前只要求 `Number.isSafeInteger()`，仍接受负数；
- 按上一轮冻结规则统一要求非负安全整数；
- 补 `now=-1`、`createdAt=-1`、`enabledAt=-1` 三个反例。

下一提交只修改时间戳下界与定向测试。通过后放行 H2-a 第二部分，不再扩大第一部分范围。
