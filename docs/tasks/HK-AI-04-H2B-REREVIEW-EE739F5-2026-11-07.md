# HK-AI-04 H2-b schema 复审（`ee739f5`）

日期：2026-11-07  
结论：**暂不通过；第 2 笔 `createGrant` 接线继续关闭。**

## 独立验证

- 追加历史正确：`f2440e4..ee739f5`，未改写已复审提交；
- helper：6/6 通过；
- Admin：297/297 通过；
- 根测试：51/51 通过；
- 差异仅 helper 与测试，未提前修改 `createGrant`。

Owner claim 与 slot 的三项 P0 schema 已按冻结设计修正。剩余阻断集中在 K1 domain 正式 validator 与测试证据。

## P0：K1 domain 时间戳仍接受非法值

`digestDomainMatchesDevice()` 已正确调用 `validateDigestDomainRecord()`，但该正式 validator 只使用 `Number.isInteger()`，没有要求时间戳为非负安全整数。因此以下损坏记录当前返回 `{ ok: true }`：

```js
head.createdAt = -1;
version.enabledAt = -1;
```

同理，超出安全整数范围的时间戳也未失败关闭。这与已冻结的“时间戳使用非负安全整数”不符，接入事务前必须修复。

### 修复

- `validateDigestDomainRecord()` 的 `keyVersion/revision/createdAt/enabledAt` 使用安全整数校验；
- `keyVersion/revision >= 1`，`createdAt/enabledAt >= 0`；
- 补 `-1`、字符串和 `Number.MAX_SAFE_INTEGER + 1` 反例；
- 确认既有 `applyDigestDomain()` 测试继续通过。

## P1：测试重新夹带 K1 fingerprint

本轮 domain fixture 为 head/version 增加了 `keyFingerprint`，但当前 K1 schema 不定义该字段，H2-b 也明确禁止依赖 fingerprint。生产 helper 没有读取它，但该正例无法证明真实的无 fingerprint 记录可以通过。

### 修复

- 从 K1 domain fixture 删除 `keyFingerprint`；
- 增加明确断言：完整且无 fingerprint 的现有 head/version 可以通过；
- 不修改 K1 记录以新增 fingerprint，不增加同版本换钥判断。

## P1：反例覆盖尚未完全兑现

- `ownerClaimMatchesDevice` 缺 `digestRealm` 和 `keyVersion` 不一致反例；
- owner claim 敏感字段黑名单仍只有 `grantId/orgId/serialNumber`，需补任务卡列出的 MAC、IP、密钥、指纹、住户和人脸类字段；
- `releaseReason` 应使用有界、无控制字符字符串规则。

## 下一提交边界

只修正式 K1 domain validator、上述 helper 边界和测试；不得开始 `createGrant` 接线，不得修改 store/blacklist/files/server/Provider。继续采用追加提交。
