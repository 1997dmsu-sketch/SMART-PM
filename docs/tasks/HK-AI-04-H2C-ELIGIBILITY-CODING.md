# HK-AI-04 H2-c 完整资格快照编码任务卡

**负责人：DeepSeek Harness**

**优先级：P0**

**建议分支：** `feat/hk-face-service-h2c-eligibility`

**代码基线：** `feat/hk-face-service-h2b-owner-claim @ 2bc10e3`

**设计与裁定：**

- `HK-AI-04-H2C-ELIGIBILITY-DESIGN.md`
- `HK-AI-04-H2C-DESIGN-APPROVAL-BCB2CD6-2026-11-09.md`

## 1. 目标

让 `FaceCredentialService.createGrant()` 仅在真实人员、实名、入住、周期、房间及物业目录资格全部有效，并通过真实黑名单评价后，才在同一事务中写入 H2-b 已冻结的 pending grant、queued job、log、slot 和 operation key。

## 2. 分阶段提交

### C1：共享只读资格 helper

- 抽取人员、绑定账号、实名、occupancy/cycle、room/catalog、unique claim、primary slot/sponsor、时间区间的预读计划与事务内校验原语；
- helper 只返回 refs、最小快照与只读上下文，不写任何集合；
- 不改变现有 `OccupancyService.activate()` 行为；
- 为 primary/member、时间边界、目录层级和损坏快照写独立单元测试。

完成 C1 后提交并自审；不得提前把半成品接入 createGrant。

### C2：`withEligibility()` 可选 attempt hook

- 按终审 Q06 实现 async `prepareAttempt`；
- 每次 attempt 重新 prepare，事务内先 `beforeEvaluate`，再调用原 `evaluateEligibility`，最后 build；
- hook 竞态用 `BLACKLIST_RETRY` 进入原有最多三次完整重试；
- 原调用方不传 hook 时行为保持不变；
- 补 DB-05/DB-06 兼容回归、一次重试成功、三次耗尽、`deferBlocked` 和 guard/decision 不变测试。

完成 C2 后提交并自审；不得修改名单算法或错误码。

### C3：createGrant 接线

- 使用 C1 helper 生成每次 attempt 的资格 refs/快照；
- 事务内顺序遵循终审：权限与 operation 状态 → 完整资格 → 真实 blacklist evaluate → H2-b device/domain/claim/slot → 核心写集；
- operation replay 仍执行资格准备与真实评价；核心写集零变化，允许既有 guard/audit 副作用；
- 沿用 H2-a/H2-b 的 ID、schema、K1/K2、owner claim 与 slot 规则；
- Provider 调用保持 0。

完成 C3 后提交并自审，不注册 HTTP。

### C4：D01–D75 场景矩阵

- 使用真实 `BlacklistService` 和完整实名/入住/周期/房间 fixture；
- 落实设计 D01–D75，条件项按终审 Q01–Q06 转为唯一预期；
- 记录 prepare/transact/evaluate/build 调用次数；
- 失败路径以故障注入后的快照为基线，深比较全部业务与只读集合；
- refs 90/91 边界使用隔离合约测试，不连接真实云；
- Admin 全量与根测试必须通过。

## 3. 固定实现边界

- face grant 仅允许当前有效 active occupancy/cycle；
- member 必须依赖有效 primary/room slot，非空 sponsor 必须仍有效；
- `validFrom <= now < validUntil`，且授权区间包含于 occupancy/cycle 共同有效区间；
- 三次重试耗尽保持 `409 BLACKLIST_RETRY`；
- 超过 90 refs 失败关闭；不得拆事务或省略 refs；
- 不读取实名私密材料、文件字节或名单证据正文；
- 不保存姓名、手机号、地址、证件号、序列号、MAC、IP、凭据或完整指纹。

## 4. 禁止范围

- 不改 HTTP/server 路由；
- 不调用 Mock 或真实 Provider；
- 不连接设备或执行设备写操作；
- 不实现 H2-d/H3/H4；
- 不修改 K1/K2 算法、claim ID、slot 复用、operation ID 或名单决定算法；
- 不以自制 eligibility 桩替代真实黑名单验收。

## 5. 每笔提交回报

```text
阶段：C1/C2/C3/C4
分支/提交：
基线：2bc10e3
修改文件：
完成条目：
新增测试与结果：
Admin/根测试：
Provider/设备/HTTP：0 / 无 / 未注册
未完成与下一阶段：
```

任何阶段测试不全绿时不得进入下一阶段。C4 全部完成后申请 H2-c 终审；通过前不得宣称 H2-c 关闭。
