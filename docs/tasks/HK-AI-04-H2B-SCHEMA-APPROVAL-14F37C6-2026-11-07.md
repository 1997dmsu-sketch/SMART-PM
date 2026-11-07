# HK-AI-04 H2-b schema/helper 终审（`14f37c6`）

日期：2026-11-07
结论：**通过；H2-b 第 1 笔关闭，允许开始第 2 笔 `createGrant` 接线。**

## 复审基线

- 分支：`feat/hk-face-service-h2b-owner-claim`；
- 提交：`14f37c6`；
- 历史保留：`f2440e4`、`ee739f5`、`d504bed`；
- 差异限于 `collections.mjs` 与 helper 测试，尚未修改 `createGrant`。

## 独立验证

- helper：9/9 通过；
- Admin：300/300 通过；
- 根测试：51/51 通过；
- `git diff --check` 通过；
- 未修改 store/blacklist/files/server；
- 未调用 Provider、网络或设备。

## 通过项

1. K2 `operation_key_domains.keyFingerprint` 恢复必填，H2-a 换钥保护保持不变；
2. K1 `device_digest_domains` 不要求 fingerprint，时间戳、版本与 revision 使用安全整数边界；
3. owner claim 正确区分 active/released 字段及审计墓碑；
4. slot 使用 `activeClaimId`，released 状态清除 active 字段并保留墓碑；
5. claim/slot 使用字段白名单，敏感字段失败关闭；
6. domain helper 区分 `DOMAIN_INCOMPLETE` 与 `DEVICE_DIGEST_CONFIG_CHANGED`；
7. `releaseReason` 有长度和控制字符边界。

## 第 2 笔允许范围

只允许在同一分支追加 `createGrant` 接线与测试：

- 事务前只准备必要 refs，不信任事务前设备快照；
- 事务内重新读取并校验 device、K1 domain head/version、owner claim、slot；
- device/claim/domain 只读，必须零写入；
- claim 必须属于当前组织并与设备 provider/realm/version/boundDevice 一致；
- slot 不存在时创建 active slot；任何既有 active 或 released slot 均返回 `GRANT_SLOT_CONFLICT/409`；
- grant 只增加冻结的 `claimId/slotId` 所有权字段；
- operation key 重放继续返回零 writes；
- Provider 调用次数保持 0；
- 任一校验失败整事务零写入。

## 继续关闭

- owner claim 登记、释放、转移与自动迁移；
- released slot 复用；
- H2-c/H2-d/H3/H4；
- HTTP/server 接线；
- Mock/真实 Provider 调用；
- 真实设备或生产云操作。

第 2 笔完成后必须提交事务内容级零变化、并发竞争、跨组织、设备 revision 变化、domain 损坏、claim 不匹配及 slot 冲突测试，再交 Codex 复审。
