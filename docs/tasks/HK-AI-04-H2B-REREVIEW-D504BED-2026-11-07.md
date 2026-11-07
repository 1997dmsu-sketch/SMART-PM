# HK-AI-04 H2-b schema 复审（`d504bed`）

日期：2026-11-07
结论：**暂不通过；第 2 笔 `createGrant` 接线继续关闭。**

## 独立验证

- 历史为追加提交，`f2440e4`、`ee739f5` 均保留；
- helper：6/6 通过；
- Admin：297/297 通过；
- 根测试：51/51 通过；
- 未发现 `createGrant`、store、blacklist、files、server 或 Provider 改动。

测试全绿，但本提交误改了已经关闭的 H2-a K2 validator，形成新的 P0 回归。

## P0：错误放宽 K2 fingerprint

本次把 `validateOperationKeyDomainRecord()` 的 `keyFingerprint` 从必填改成可选。该函数属于 K2 `operation_key_domains`，H2-a 已冻结依赖 fingerprint 检测同版本换钥，不能放宽。

需要兼容无 fingerprint 的是 K1 `device_digest_domains`；其 `validateDigestDomainRecord()` 原本就没有 fingerprint 要求，无需修改 K2 validator。

### 修复

- 恢复 `validateOperationKeyDomainRecord()`：`keyFingerprint` 必须是 64 位小写十六进制；
- 保持 `validateDigestDomainRecord()` 不要求 fingerprint；
- 增加回归测试：K2 head/version 缺 fingerprint 必须拒绝；K1 head/version 无 fingerprint 必须通过；
- 不修改 H2-a 的 `applyOperationKeyDomain()`、fingerprint 算法或既有测试语义。

## P1：安全整数测试尚未完整

K1 `createdAt/enabledAt` 已改为非负安全整数，方向正确，但测试只增加 `-1`，未覆盖提交说明所称的超安全整数，也未覆盖字符串。

同时 `validateDigestDomainRecord()` 的 `keyVersion/revision` 仍使用 `Number.isInteger()`，应与冻结规则统一为安全整数。

### 修复

- `keyVersion/revision` 改为 `Number.isSafeInteger()` 并保留最小值约束；
- 对 `createdAt/enabledAt/keyVersion/revision` 补字符串和 `Number.MAX_SAFE_INTEGER + 1` 反例。

## P1：敏感字段与文本边界仍未落实

- `FORBIDDEN_CLAIM_FIELDS` 仍只有 `grantId/orgId/serialNumber`，没有提交说明中的 MAC、IP、密钥、指纹、住户和人脸类字段；
- `releaseReason` 仅检查非空和长度，没有拒绝控制字符；
- `ownerClaimMatchesDevice` 仍缺 `digestRealm`、`keyVersion` 不一致反例。

### 修复

- 将冻结任务明确禁止的敏感字段加入黑名单并逐项测试；
- `releaseReason` 使用有界、非空、无控制字符的文本校验；
- 补 realm/version 不一致测试。

## 下一提交边界

只允许恢复 K2 validator、收紧 K1 数值及 owner claim 文本/禁字段校验并补测试。不得开始 `createGrant` 接线；继续采用追加提交。
