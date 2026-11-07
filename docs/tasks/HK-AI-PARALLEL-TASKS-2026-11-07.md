# 海康门禁并行任务卡（2026-11-07）

本批任务不包含企业微信开发看板。所有执行者使用独立分支；未经 Codex 复审不得合并。任何任务均不得连接真实设备、调用真实 Provider、开启设备写操作或提交凭据、人脸数据及设备唯一标识。

## 任务 1：H2-a 严格重放测试补交

**执行：DeepSeek Harness**  
**优先级：P0**  
**分支：** `feat/hk-face-service-integration`  
**基线：** `1116e9d`

### 工作范围

只补 `admin-web/tests/face-service-layer.test.mjs` 的严格重放测试。生产 helper 已通过实现方向复审，不扩大生产代码。

1. 使用独立 `device-replay`、credential、cycle 和幂等键正常创建一次授权；
2. 定位真实 operation key，硬断言 `_id` 与 expected op key 一致；
3. 分别损坏 `result` 为 `null`、`{}`、`[]`、错误 `grantId`、错误 `jobId`、错误 `evidenceScope`；
4. 分别损坏 `createdAt` 为缺失/`null`、`-1`、非安全整数；
5. 使用完全相同 actor/input/idempotencyKey 重放；
6. 每项断言 `409 CONFLICT`、Provider 调用为 0、grant/job/claim/slot/log/op key 数量与内容无业务变化；
7. 删除或重写旧的 `requestDigest: "x"` 测试，确保异常不是由摘要不匹配提前触发。

### 验收

- 服务层、集合、Admin、根测试全部通过；
- 提交只包含测试，允许删除三处 replay helper 外层冗余判断但不得改变语义；
- 提交号、测试数和变更摘要交 Codex 终审。

## 任务 2：H2-b 设备 claim 模型设计核对

**执行：Kimi**  
**优先级：P1**  
**建议分支：** `docs/hk-h2b-device-claim-design`  
**参考基线：** `1116e9d`

### 工作范围

只写设计和测试矩阵，不修改生产代码：

- `device_claims` 改为设备级唯一 `ownerOrgId` 模型；
- 同一组织内多个住户可通过不同 `grant_slot_claims` 共用同一设备；
- 跨组织占用必须冲突且不泄露设备身份；
- claim 首次建立、重复使用、设备转移、释放、墓碑和审计字段；
- 与 `grant_slot_claims` 的职责边界；
- K1 domain、设备序列号只在内存使用和事务内设备快照复核；
- createGrant/revoke 所需 refs、writes、错误码及并发场景；
- 至少 20 项测试矩阵。

### 交付物

`docs/tasks/HK-AI-04-H2B-DEVICE-CLAIM-DESIGN.md`。必须标注“预研，H2-a 通过前禁止编码”。

## 任务 3：现场只读联调一页清单

**执行：Kimi**  
**优先级：P1**  
**建议分支：** `docs/hk-live-day-checklist`  
**参考：** `HK-AI-02-LIVE-APPROVAL-PACK.md`

### 工作范围

制作一页 A4 可打印打勾清单，包含：

- DS-K1T671BM 完整型号与固件核对；
- 隔离网络、只读账号、主机和端口复核；
- 叶证书 SHA-256 指纹由两人线下独立核验；
- dry-run 零网络结果；
- 六个 GET 的固定顺序和一次性执行窗口；
- 型号不符、第二次 401、非 Digest、指纹错误、重定向、超时、超限等停止条件；
- 原始响应受控保存、脱敏、删除和三方签字。

不得写入真实账号、密码、IP、完整指纹、序列号或 MAC；不得执行探针。

## 任务 4：测试时序抖动专项

**执行：DeepSeek Harness**  
**优先级：P1**  
**建议分支：** `test/face-decode-stability`  
**基线：** `1116e9d`

### 工作范围

独立排查：

- `解码超时后槽位可恢复`；
- HTTP 并发 503、队列满与恢复。

每个目标连续运行至少 20 次，记录失败频率和根因。只允许修复测试同步、资源回收或确定的生产竞态；不得简单放宽超时、减少并发、删除断言或吞掉失败。

### 验收

- 修复前后复现证据；
- 单文件连续 20 次通过；
- Admin 全量与根测试通过；
- 与 H2-a 严格重放测试分开提交。

## 任务 5：门禁管理页面静态检查

**执行：Workburry**  
**优先级：P2**  
**分支：** `feat/hk-face-admin`  
**范围：** 已有四个页面壳

### 工作范围

只做静态检查和问题清单，不接 API、不改服务层：

- 页面字段与冻结 DTO 的对应关系；
- 加载、空数据、无权限、失败、Mock 标识状态；
- 人脸图片不可在列表、日志和任务页泄露；
- 设备、申请、任务、审计四页导航与返回路径；
- 1366×768 与常用桌面宽度适配；
- 输出每页截图及 P0/P1/P2 问题列表。

### 交付物

`docs/tasks/HK-AI-05-STATIC-UI-AUDIT.md` 与脱敏截图。未经单独任务不得修改页面代码。

## 执行顺序

1. Harness 立即执行任务 1；任务 4 使用独立分支并与任务 1 分开提交。
2. Kimi 可并行执行任务 2、3。
3. Workburry 执行任务 5。
4. Codex 先终审任务 1；通过后再决定是否放行 H2-b 编码。
