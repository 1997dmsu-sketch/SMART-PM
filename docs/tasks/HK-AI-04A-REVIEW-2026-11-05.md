# HK-AI-04A `5148159` 复审记录（2026-11-05）

结论：**文档阶段通过，允许作为 AI-D Mock 后端的设计输入。** 本结论不表示 AI-D 已开发完成，不批准真实 Hikvision Provider、设备连接或写接口，也不解除 AI-C 集成依赖。

## 复审范围

- 固定提交：`5148159`
- 交付：`docs/devices/HK-AI-04-CONTRACT-EVIDENCE-REVIEW.md`
- 修改范围：仅新增 Markdown；未修改生产代码、数据库迁移、Provider 白名单和设备开关。
- 链接核验：18 个相对引用均可解析。
- 内容核验：13 个逻辑操作、grant/job/展示三轴状态、22 项字段证据、9 类错误、20 个 Mock 场景和9项待决问题均已覆盖。

## 通过项

1. Provider 五方法、`FaceAccessContext`、六类错误和既有 `op_id/requestDigest` 规则保持不变。
2. `awaiting_result` 不存在自动重复写入路径；worker 崩溃且无法证明未发送时进入未知结果。
3. 退租或资格失效先令业务 grant 失效，设备清理失败不恢复 grant。
4. Mock 仅限 demo/test，持续标记 `evidenceScope=simulated`，live 误选 Mock 失败关闭。
5. 产品族文档、目标 capability 和真实调用三层证据区分正确；目标验证仍为 0。
6. 文件平台限制与设备能力限制分离，未把 200 KiB 写成海康设备限制。
7. 禁止批量删库、禁止浏览器直连设备和外部网络在事务外等边界保持有效。

## Codex 架构裁定

### Q01：展示状态

采用 `grantState + jobState + displayState + evidenceScope + cleanupPending` 五字段 DTO。`displayState` 只由服务端投影，不持久化，也不能反向修改 grant/job。`revoking` 优先于 `revoked`；清理失败或未知时持续显示 `revoking` 并附脱敏原因。底层 `expired/suspended` 仍通过 `grantState` 保留，不新增持久枚举。

### Q02：授权创建与撤销权限

人工创建/撤销 grant 新增显式权限 `device.access.manage`，不得由 `device.manage`、组织管理员角色或审核权限隐式替代。退租/资格服务使用 `actorType=system` 的受控内部服务身份，仍须携带组织、原因、来源事实版本和审计引用；不能伪装成人工账号。

### Q03：设备转移

首版采用保守流程：存在有效 grant、`cleanupPending` 或任何未终态 job 时拒绝转移。先单独完成业务撤权和设备清理，全部终态且无残留后，才允许以 `device.manage` 执行审计转移。首版不实现“转移事务内同时撤权”。

### Q04：任务查询与人工对账

普通任务/审计查询使用 `device.audit.read`；重试仍使用 `device.operation.retry`。人工把 `awaiting_result` 裁定为成功或失败属于独立高风险操作，新增 `device.operation.reconcile`，必须填写理由和证据引用并写不可变审计。M1 可展示待对账状态，但不必开放人工终态裁定按钮。

### Q05：重试策略

只有 `retryable_failed` 可重试；`awaiting_result` 永不自动重写。自动重试策略做成服务端配置，M1 默认最多 3 次、退避 30 秒/2 分钟/10 分钟；人工重试也计入次数并沿用原 `opId/requestDigest`。租约过期但结果不明时转 `awaiting_result`。达到上限后转 `terminal_failed` 并告警。

### Q06：历史、slot 与凭证版本

任务、operation key 和日志采用同一保留策略，operation key 不得早于任务历史删除；具体生产期限等待隐私/运维政策，M1 只使用可重置合成数据。同一 `cycleId` 的已释放 slot 不允许复活；新入住必须使用新 cycle。凭证更新采用追加版本，旧版本只读保留并指向替代版本，不覆盖历史。

### Q07：对账与更新范围

M1 Mock 的 `queryOperation` 只按平台 `jobId` 查询，不伪造 `providerRequestId`。`updateFace` 首版只允许切换到已批准的新 credential 版本及收紧有效期；`personId/deviceId/occupancyId/cycleId` 不可变，更换这些字段必须撤销旧 grant 后新建。真实查询关联和厂商可变字段等待 capability 与真实调用证据。

### Q08：事件

M1 只允许进程内合成 Mock 事件，必须带唯一 `eventId`、目标 job/device、递增版本和测试域，覆盖重复及乱序。任何 live 事件路线均返回 `NOT_CONFIGURED`；取得官方鉴权、唯一 ID 和防重放证据前不开放网络回调入口。

### Q09：HTTP 边界

本轮冻结服务层语义，不在文档中臆造完整 HTTP 路由。AI-D 第一提交须单独提供 v2 路由/DTO/统一错误信封映射供 Codex 快速复审，之后 Workburry 才绑定页面。跨组织、猜测 ID 和不可见资源统一返回同态 404；权限不足但资源对当前组织可见时返回 403。HTTP 2xx 只表示平台请求成功，不代表真实设备生效。

## AI-D 开工边界

DeepSeek Harness 可以立即准备独立 Mock、状态投影、任务状态机和合成 fixture，但整合到正式服务前必须满足：

1. AI-C 阶段 2 的九项 HTTP 测试与两项资源回归通过 Codex 终审。
2. 使用 AI-C 正式导出的资格和私密文件服务，不复制一套简化逻辑。
3. 同意版本、代提交、保留/销毁尚未交付时，M1 仅使用明确标记的合成同意记录，不生成生产默认值。
4. 第一提交先交路由/DTO/权限清单和数据迁移草案；共享文件改动保持独立提交。
5. 只实现 Mock Provider；真实端点、网络、凭据和 Provider 写调用继续禁止。

## 未关闭阻碍

- AI-C 阶段 2 尚未完成。
- 同意、代提交关系、保存期限和撤销/退租/过期销毁仍待后续阶段。
- 目标设备 capability 与真实调用仍为 0；HK-AI-02 尚未通过真实执行前复审。
- 真实 Provider 路线、事件鉴权、厂商请求 ID、图片约束和删除闭环未冻结。

以上阻碍不影响 M1 Mock 核心开发，但阻止真实设备接入和生产发布。
