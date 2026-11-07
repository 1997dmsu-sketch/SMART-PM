# HK-AI-04 H2-b 设计终审通过（`c60eb4f`）

日期：2026-11-07  
结论：**H2-b 设计通过，可以按独立编码卡开始定点实现。**

## 通过内容

1. H2-b 沿用现有 K1 helper、claim ID 与历史记录，不实施新算法或迁移；
2. 当前 K1 domain 没有 fingerprint，H2-b 只读复核 provider/realm/keyVersion 与记录完整性；
3. createGrant 只使用 `access_devices.claimId` 读取既有全局 owner claim，不计算、创建、迁移、释放或改写 claim；
4. `device_claims.ownerOrgId + boundDeviceId` 与 `access_devices.ownerOrgId + claimId` 双向一致；
5. 同组织多个住户通过不同 active slot 共用同一设备；
6. released slot 在 H2-b 一律 `GRANT_SLOT_CONFLICT/409`，不读取旧 job 集合作为放行依据；
7. 保持当前 `withEligibility()` 与 H2-a operation key 语义，不修改 blacklist；
8. grant 增量所有权字段只增加 `claimId/slotId`，不夹带 H2-c 身份、入住或审批扩展；
9. 既有设备缺 `claimId/ownerOrgId` 或 owner claim 时失败关闭，不自动补写、迁移或生成替代 ID。

## 编辑性说明

文档 §4.1 仍有“`K1 与 K2 的配置、密钥、realm 和指纹继续分离`”一句。应理解并在最终整合时改为：**K1/K2 配置、密钥与 realm 分离；仅 K2 当前具备 fingerprint，H2-b 不为 K1 新增 fingerprint。** 本句不得作为编码 K1 fingerprint 的依据。

## 继续关闭

设备登记/释放/转移、K1 迁移、released slot 复用、H2-c/H2-d/H3/H4、HTTP、Mock/真实 Provider 派发及设备写操作继续关闭。
