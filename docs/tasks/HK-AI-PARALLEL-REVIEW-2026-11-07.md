# 海康门禁并行任务统一复审（2026-11-07）

## 总结

| 任务 | 提交 | 结论 |
|---|---|---|
| 1 H2-a 严格重放 | `f9a2b6b` | 通过并关闭，见 H2-a 终审记录 |
| 2 H2-b claim 设计 | `037083d` | 有条件退回，修正三项架构边界后再放行编码 |
| 3 现场一页清单 | `071148f` | 通过 |
| 4 解码时序稳定性 | `ad5ccc8` | 通过，可合入 `f9a2b6b` |
| 5 页面静态审计 | 无远端提交 | 未交付 |

企业微信开发看板任务维持取消。

## 任务 2：H2-b 设计复审

### 已认可

1. `device_claims` 改为部署域内设备级唯一 owner claim，使用 `ownerOrgId`，不再绑定 grant；
2. `grant_slot_claims` 继续承担 person + device + cycle 的授权唯一性；
3. 同一组织多个住户可通过不同 slot 共用同一设备；
4. `createGrant` 只读复核 device/claim/K1 domain，不创建、转移或释放 owner claim；
5. claim 使用 `boundDeviceId` 保证同一物理设备最多一个 active device 投影；
6. K1 domain 缺失或损坏在 createGrant 中失败关闭，不由授权流程自动初始化；
7. 设备登记、释放、转移和密文序列号管理不属于 H2-b 编码。

### 编码前必须修正

#### B1：H2-b 不得静默更换 K1 算法或固定 ID

文档提出 NFKC、结构化 JSON HMAC 和未编码的 `provider-device:hikvision:{realm}:{digest}` 格式，与当前已冻结实现不同。H2-b 的 createGrant 不再计算 claim ID，因此本阶段应明确：

- 沿用现有 claim ID 作为外部既有引用；
- 不修改 `deviceDigest()`、`deviceClaimKey()`、K1 规范化或历史记录；
- 新算法只能在独立“设备登记与 K1 迁移”任务中设计迁移、双读和历史兼容后再审批。

#### B2：当前合法重放不能宣称跳过 `withEligibility`

现有 `BlacklistService.withEligibility()` 会在进入 build 前准备并评价资格。H2-b 不得为实现“重放跳过资格”而修改 blacklist 或扩大到 H2-c。

H2-b 编码保持当前调用边界：权限仍优先；重放在 `withEligibility` 的事务 build 内返回零 writes。是否把 operation key 前置到资格准备之前，留给 H2-c 单独设计和复审。

#### B3：released slot 复用增加关闭条件

同 cycle 墓碑可复用，但必须同时满足：

- 旧 grant 已为 `revoked` 或 `expired`；
- `cleanupPending !== true`；
- 旧 grant 关联的设备任务均为终态；
- slot 的 released 审计字段完整且 revision 合法。

否则返回 `GRANT_SLOT_CONFLICT/409`，不得仅凭 `state=released` 复用。

### 五项架构裁定

1. 同意 `boundDeviceId` 作为 active claim 的唯一设备投影约束。
2. 同意 createGrant 遇到缺失 K1 domain 时失败关闭，不自动初始化。
3. 同意 released slot 在 B3 条件全部满足时复用，旧 grant 永不复活。
4. 设备登记/释放/转移的权限、operation key 和审计契约另立任务，不在 H2-b 复用 `face.grant`。
5. `providerDeviceCiphertext` 与密钥轮换不进入 H2-b；禁止临时保存明文序列号。

修订文档后，H2-b 编码只允许 owner claim 只读模型、事务内 device/claim/domain 快照复核、slot 复用条件与对应测试。H2-c/H2-d/H3/H4、HTTP 和 Provider 继续关闭。

## 任务 3：现场一页清单复审

`071148f` 通过。清单与 `f15160d` 批准包一致，明确：

- 精确型号 `DS-K1T671BM`；
- 三方签字及职责分离；
- 隔离网络、最小只读账号和双人指纹核验；
- 六个 GET 的固定顺序；
- `EXECUTE-ONCE` 与唯一一次真实执行；
- fail-fast 停止条件、0700/0600 权限、脱敏与删除。

本结论只批准打印清单，不构成真实执行批准。三方线下签字前仍不得设置 `HIKVISION_PROBE_ALLOW_READ=true`。

## 任务 4：时序稳定性复审

`ad5ccc8` 通过：

- 仅把测试 `timeoutMs` 从 1 改为 0；
- 底层 sharp job 在 deadline race 前已经创建，测试仍验证超时后槽位只在底层任务 settle 后释放；
- 未放宽 3 秒恢复上限、未降低并发、未删除断言；
- Codex 独立运行目标文件 20/20 通过；HTTP 并发/恢复通过；Admin 291/291、根测试 51/51。

允许把 `ad5ccc8` cherry-pick 到 `f9a2b6b` 的后续集成分支；不得改写 H2-a 历史。

## 任务 5：页面静态审计

未发现 `feat/hk-face-admin` 或约定审计文档的最新远端提交，状态为未交付。Workburry 仍需提交：

- `HK-AI-05-STATIC-UI-AUDIT.md`；
- 四页脱敏截图；
- P0/P1/P2 问题清单；
- 1366×768 及常用桌面宽度核验；
- 明确未接 API、未改服务层。
