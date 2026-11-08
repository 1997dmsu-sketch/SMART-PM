# HK-AI-04 H2-b 终审（`2bc10e3`）

结论：**通过，H2-b 正式关闭。**

本结论只批准 H2-b 的设备级 owner claim 只读复核、slot 占用与原子授权边界。H2-c/H2-d/H3/H4、HTTP、Provider 调用及设备写操作继续关闭，必须另发任务卡并重新复审。

## 复审范围

- 分支：`feat/hk-face-service-h2b-owner-claim`
- schema/helper：`14f37c6`
- createGrant 接线：`339d5e2`
- credential 快照修复与基础场景：`14d0728`
- 第一轮场景证据：`1f6940d`
- 最终证据：`2bc10e3`

`1f6940d..2bc10e3` 仅修改 `admin-web/tests/face-service-layer.test.mjs`，没有生产代码变化。

## 关闭项

### K1 domain

已覆盖：

- head/version 均不可达；
- version 缺失；
- head/version 内部矛盾；
- realm 与设备配置不符；
- keyVersion 与设备配置不符。

损坏或不完整记录返回 `DOMAIN_INCOMPLETE`；内部完整但与设备配置不符返回 `DEVICE_DIGEST_CONFIG_CHANGED`。失败路径核心业务记录内容级零变化。

### 设备快照

已覆盖预读后 `revision/claimId/ownerOrgId/provider/digestRealm/keyVersion/status/capabilities.face/orgId` 变化。事务内重新读取并失败关闭，不使用事务前旧值继续授权。

### owner claim 与 slot

- owner claim 缺失、released、结构损坏及绑定不一致均失败关闭；
- 同组织不同住户可在同一设备使用不同 slot，owner claim 保持不变；
- active 与 released slot 均禁止复用；
- slot 冲突使用完整业务快照深比较；
- grant 只保存既有 `claimId/slotId`，不计算或改写设备 claim。

### 并发与副作用

两个请求竞争同一 slot 时仅一个成功，另一个返回 `GRANT_SLOT_CONFLICT`。成功侧只产生一组 pending grant、queued job、queued log 与 operation key；access device、owner claim 与 K1 domain 保持只读。Mock/真实 Provider 调用均为 0。

### 数据边界

授权记录、任务、slot、日志和 operation key 未保存原始序列号、MAC、IP 或原始幂等键。证据范围保持 `simulated`。

## 独立验证

- 服务层：24/24；
- Admin：314/314；
- 根测试：51/51；
- `git diff --check`：通过。

未连接真实设备，未调用 Provider，未注册 HTTP，未执行设备写操作。

## 后续门禁

H2-c 仍未获准开始。下一阶段必须先单独定义完整资格快照、真实 `BlacklistService.withEligibility()` 契约与相应竞态矩阵，再发编码任务卡。
