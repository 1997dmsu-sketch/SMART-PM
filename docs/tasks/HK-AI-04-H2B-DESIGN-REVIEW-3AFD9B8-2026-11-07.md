# HK-AI-04 H2-b 设计复审（`3afd9b8`）

日期：2026-11-07  
结论：**暂不通过；不发 H2-b 编码卡。**

本提交已正确关闭上一轮三项问题：H2-b 不更换既有 K1/claim ID、真实重放不宣称跳过 `withEligibility()`、released slot 增加旧 grant/job/cleanup 条件。继续复核现有代码能力后，仍有以下阻断。

## P0-1：K1 fingerprint 与同版本换钥检测在当前模型中不存在

现有 `device_digest_domains` 只保存 `provider/digestRealm/keyVersion` 及时间/revision；`deviceClaimConfig()` 也不产生 fingerprint。只有 K2 的 `operation_key_domains` 保存 `keyFingerprint`。

设计多处要求 H2-b 对 K1 fingerprint 只读复核，并在 D08 断言“同版本换 key”失败。这在“不修改 K1 helper/schema”的冻结边界下无法实现，会迫使编码者夹带 K1 schema 和迁移。

### 修订要求

- H2-b 只按当前能力复核 K1 domain 的 head/version、provider、digestRealm、keyVersion 和记录完整性；
- 删除 H2-b 中所有 K1 fingerprint 复核与同版本换 key 检测要求；
- 明确记录当前限制：同版本静默换 K1 无法由现有 domain 检出，运维禁止这样换钥；
- fingerprint、同版本换钥检测、历史记录补写与迁移全部移入未来 K1 迁移任务。

## P0-2：released slot 的“全部 jobs 终态”存在幻读窗口

设计要求事务前列出旧 grant 的全部 jobs 并将它们加入 refs。但预读完成后、授权事务提交前，另一流程仍可能新增一个未终态 job。事务未引用固定 job-set guard，无法发现该 phantom insert，因此“全部 jobs 已终态”并不成立。

H4 尚未开放，当前没有获批的 grant job-set epoch/guard 或固定 head 能让所有 job 创建共同递增。

### 本阶段裁定

- H2-b **不复用 released slot**；遇到任何 `state=released` 均返回 `GRANT_SLOT_CONFLICT/409`；
- 删除 H2-b 对旧 grant/job 动态列表预读、D22 合法复用及相关 refs 要求；
- released slot 复用推迟到 H4 或独立任务，必须先设计固定 job-set guard/epoch，使 job 创建与复用事务串行化；
- active slot 仍按既有冲突语义处理，新 cycle 使用新的固定 slot ID。

## P1：夹带 H2-c 字段与资格要求

文档要求新 grant 保存 `identityApplicationId/approverId`，并引用“H2-c 完整资格快照”。当前 credential 审核记录并未冻结 `approverId` 来源，H2-b 也无权修改身份/入住资格契约。

### 修订要求

- H2-b 只新增/调整 owner claim 与 slot 必需字段：`claimId/slotId` 及现有 grant 输入投影；
- 不新增 `approverId`，不扩展 identity/occupancy/cycle/room/building/community 资格模型；
- 保持现有 `withEligibility()` 行为和 H2-a operation key 行为，其完整资格修订留给 H2-c。

## P1：现有数据可用性边界需明示

H2-b 要求 `access_devices.claimId/ownerOrgId` 和既有 owner claim，但设备登记、旧记录迁移均不在本阶段。设计需明确：

- 缺少新字段或 owner claim 的现有设备一律失败关闭；
- H2-b 仅通过受控测试 fixture 验证模型，不在 demo/live 自动补写或迁移；
- 在设备登记/迁移任务完成前，该路径不得宣称可用于生产设备授权。

## 已认可并保留

- `device_claims` 为全局 owner claim，禁止 grantId；
- `boundDeviceId` 约束唯一 active device 投影；
- 同组织多个住户可在同设备使用不同 active slot；
- createGrant 不计算 claim ID、不读取序列号、不写 device/claim/K1 domain；
- 跨组织错误不得泄露 owner、claim 或设备标识；
- 不修改 blacklist、HTTP、Provider、H3/H4。

## 下一步

Kimi 只修订 Markdown 与 D01–D36 矩阵，提交复审。通过前不得开始 H2-b 编码。修订分支最终应基于最新 `docs/lock-01-fast-track`，确保引用的 H2-a 终审与并行复审文件存在。
