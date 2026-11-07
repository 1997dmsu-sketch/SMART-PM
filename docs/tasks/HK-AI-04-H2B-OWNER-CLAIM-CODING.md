# HK-AI-04 H2-b owner claim 定点编码任务卡

**执行：DeepSeek Harness**  
**优先级：P0**  
**建议分支：** `feat/hk-face-service-h2b-owner-claim`  
**代码基线：** `integration/hk-face-h2a-stable @ 9852c7f`  
**设计依据：** `docs/hk-h2b-device-claim-design @ c60eb4f`  
**复审：** Codex

## 1. 允许修改

- `admin-web/lib/face-service/collections.mjs`：仅 owner claim/device/slot 的 schema 与只读校验 helper；
- `admin-web/lib/face-service/service.mjs`：仅 createGrant 的 owner claim、device snapshot、K1 domain 只读复核与 slot 行为；
- `admin-web/lib/store.mjs`：只有集合登记确有缺口时允许独立提交；
- 对应单元测试与服务层测试。

共享文件必须单独提交。不得修改 `server.mjs`、HTTP 路由、blacklist、files、Provider 或前端。

## 2. createGrant 目标流程

### 事务前

1. 保持 H2-a 权限、K2/op context 和 `withEligibility()` 调用边界；
2. 预读 `access_devices/{deviceId}`；缺失/跨组织维持同态 404；
3. 设备必须包含 `claimId/ownerOrgId/provider/digestRealm/keyVersion/revision/status/capabilities.face`；缺失返回 `DEVICE_CLAIM_INVALID/409`；
4. 使用既有 `device.claimId` 声明 claim ref；禁止读取 serialNumber、调用 `deviceClaimKey()` 或计算替代 ID；
5. 用现有 provider/realm/version 形成 K1 domain head/version refs；不计算 fingerprint。

### 同一 `withEligibility` 事务 build 内

1. 保持 H2-a 权限与 operation key 重放逻辑；重放仍经过现有资格 prepare/evaluate；
2. 精确复核 device 预读快照：revision、claimId、ownerOrgId、orgId、provider、digestRealm、keyVersion、status、`capabilities.face`；
3. device 必须满足 `ownerOrgId === orgId === 当前 orgId`、active、face capability 为 true；
4. 只读复核 K1 domain head/version 存在、kind 正确、provider/realm/keyVersion 内外一致；缺失/损坏失败关闭，不调用 `applyDigestDomain()`；
5. 只读复核 owner claim 存在且 active，`ownerOrgId/boundDeviceId/provider/digestRealm/keyVersion` 与 device/domain 一致；
6. claim 或 device 的 revision/身份字段在预读后变化时失败关闭；
7. slot 不存在时创建 active slot；active slot 一律冲突（合法 op 重放已在此前返回）；released slot 也一律 `GRANT_SLOT_CONFLICT/409`；
8. 新 grant 增加且只增加 `claimId/slotId` 两个 H2-b 所有权字段；
9. 同事务仍只写新 grant、queued job、active slot、首条 log、operation key 及 H2-a 已批准 writes；
10. `device_claims`、`access_devices`、`device_digest_domains` 写入次数必须为 0，Provider 调用为 0。

## 3. 错误边界

- 缺失/跨组织不可见：`NOT_FOUND/404`；
- device 缺 claimId/ownerOrgId、claim 缺失/released/损坏、device-claim 引用不一致：`DEVICE_CLAIM_INVALID/409`；
- claim owner 为其他组织：通用 `DEVICE_CLAIM_CONFLICT/409`，响应不得包含 ownerOrgId、claimId 或设备身份；
- device 非 active 或无 face capability：`INVALID_STATE/409`；
- K1 domain 缺失/损坏：`DOMAIN_INCOMPLETE/503`；
- provider/realm/keyVersion 与当前配置不一致：沿设计映射为 `DEVICE_DIGEST_CONFIG_CHANGED/503`；
- active/released slot：`GRANT_SLOT_CONFLICT/409`；
- 任一失败路径业务零写入、Provider 零调用。

## 4. 必须测试

至少覆盖：

1. 同组织 P1/P2 在同一设备、不同 slot 均成功，只有一个 owner claim且内容/revision 不变；
2. 同一人新 cycle 使用新 slot 成功；
3. 同一 person/device/cycle 并发只有一个成功；
4. operation key 同键重放与异摘要回归，证明仍进入现有 `withEligibility()`；
5. device 缺 claimId、缺 ownerOrgId、claim 不存在、claim released 分别失败；
6. ownerOrgId/orgId/boundDeviceId/provider/realm/keyVersion 任一不一致分别失败；
7. device 非 active、face capability 缺失/false 分别失败；
8. K1 domain 缺 head、缺 version、kind 错、字段矛盾、配置版本不一致分别失败，且不自动补写；
9. active slot、released slot、损坏 slot 分别冲突；全部终态的旧 grant/jobs 也不能让 released slot 复用；
10. 预读后 device revision/claimId/ownerOrgId 或 claim revision/owner/binding 变化时失败关闭；
11. 成功及失败路径均断言 claim/device/K1 domain 内容级快照不变；
12. 响应、错误、日志及提交扫描不含序列号、MAC、IP、K1/K2、完整指纹、原始幂等键；
13. 恢复 H1/H2-a 全部回归。

测试可使用受控合成 owner claim/device fixture；不得自动把现有旧 fixture 迁移成新模型。

## 5. 提交与验收

建议拆分：

1. schema/helper 与测试；
2. createGrant 接线；
3. H2-b 场景测试。

每笔提交均须保持测试可运行。最终提交：

- 服务层、集合、Admin 全量、根测试全部通过；
- 列出每个提交号与差异；
- 明确真实/Mock Provider 调用为 0；
- 未连接设备或生产云；
- 交 Codex 复审，未经通过不得进入 H2-c。

## 6. 继续禁止

- 修改 K1 算法、claim ID 或增加 K1 fingerprint；
- 设备登记、owner claim 创建/释放/转移、历史迁移；
- released slot 复用或 job-set guard；
- identity/occupancy/cycle/room/building/community 完整资格扩展；
- H2-c/H2-d/H3/H4；
- HTTP、server、Provider 派发、设备写操作。
