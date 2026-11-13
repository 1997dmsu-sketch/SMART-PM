# HK-AI-04 H3-a 编码任务：内嵌快照与租约状态机

日期：2026-11-13  
批准设计：`b2cd7abf7699a93db58c245e5773f14aa50093ee`  
批准记录：`HK-AI-04-H3-DESIGN-APPROVAL-B2CD7AB-2026-11-13.md`

## 目标

在独立分支实现 H3-a：为新建合成 job 写入最小不可变内嵌 `dispatchSnapshot`，实现严格 validator，以及不调用 Provider 的租约/fence/状态迁移 helper。为 H3-b 提供可复审基础，但本轮不得发送 Mock。

## 实施范围

1. 基于 `b2cd7ab` 建分支，不得复用/cherry-pick `9e5ff91`。
2. `createGrant` 仅在显式合成测试开关下生成内嵌 snapshot；普通 H2 行为保持不变。
3. snapshot：`schemaVersion=1`、规范 JSON ≤16 KiB、严格白名单、固定 ID/revision/epoch、禁止敏感字段及整条源记录；合法重放逐字节不改写。
4. 不新增集合/ref；真实合成路径必须证明 58 candidates/90 refs 成功、59/91 在事务前 400。
5. job validator 同时兼容旧 H2 job 与新 H3 job；旧 job 不被扫描，直接 H3 helper 请求返回 `DISPATCH_SNAPSHOT_REQUIRED`。
6. 实现纯 helper：领取计划、fence 校验、lease 字段、确定性日志、状态迁移、重排/过期所需的构造与校验；所有计数/时间使用安全整数并检查溢出。
7. helper 不开事务、不调用 Provider；如增加 orchestration，只允许使用现有 `store.transact`，不得修改 `store.mjs`、不得新增事务旁路。
8. 成功事务允许现有一条 `admin_audit`；失败/CAS 拒绝抛错，业务集合、日志和 audit 内容级零变化。

## 必测

- 内嵌 snapshot 白名单、16 KiB 边界、敏感字段拒绝、版本/缺席记录见证。
- 同 operation key 并发只生成一个内嵌 snapshot；重放逐字节一致。
- 58/90 与 59/91 的合成路径真实边界。
- queued→sending 领取、双 worker 竞争、callback 重跑、旧 fence/错 owner/generation/attempt/revision、到期等号、禁止续期。
- 旧 job 扫描排除与直接请求失败关闭。
- 确定性日志 create-only；日志冲突整体回滚。
- Provider 方法入口计数严格为 0；HTTP、Cloud/live、设备调用为 0。
- Admin 全量与根测试全绿，`git diff --check` 通过。

## 禁止项

- 不实现发送前资格复核、Mock 调用、T3 结果处理、重试调度或过期扫描 orchestration（留给 H3-b）。
- 不修改 `store.mjs`、不注册 HTTP、不接 Cloud/live、不连接设备、不做真实 Provider preflight。
- 不进入 H4 撤权、清理或对账。

## 交付

回报分支、完整提交 SHA、基线、差异文件、定向/全量测试、Provider/HTTP/设备计数、敏感扫描及未完成边界。通过 Codex 复审前不得开始 H3-b。
