# HK-AI-04：人脸门禁服务层、任务队列与 Mock Provider

优先级：P0
执行者：DeepSeek Harness
架构与复审：Codex
基准：HK-AI-03 的 `feat/db-mvp-integration`
建议分支：`feat/hk-face-service-mock`
预计：4～6 个工作日
真人任务依赖：真实 Provider 不开始；服务层设计和 Mock 今天可先准备。

## 目标

实现与厂商无关的人脸凭证、设备授权、操作任务、重试/对账和审计服务，以及只能在 demo/test 使用的 Mock Provider。

## 任务

1. 实现 `access_devices`、`face_credentials`、`device_access_grants`、`device_operation_jobs`、`device_operation_logs`。
2. 实现 LOCK-01A 的 `FaceAccessProvider` 契约。
3. 实现全局物理设备 claim、唯一 owner、入住周期 grant slot、操作幂等键、requestDigest 和任务租约。
4. 对接稳定 `personId`、实名 approved、有效 occupancy、黑名单/资格决定和房间/组织状态。
5. 退租先令业务授权立即失效，再按设备创建撤权任务。
6. 发送后断连、解析失败和未知错误进入 `UNKNOWN_RESULT/awaiting_result`，禁止自动重复新增或删除。
7. Mock 支持成功、设备离线、发送前失败、发送后未知、终态失败、撤权失败和重复回调。
8. Mock 仅 demo/test 可显式选择；live 选 Mock 或真实配置不完整必须失败关闭。

## 本轮不做

- 不实现真实 Hikvision Provider。
- 不连接真实设备。
- 不依据近似型号固定写死 FDID、能力、图片限制或错误码。

## 验收

- 未实名、无有效入住、已退租、人员禁用、房间归档、组织停用和名单待复核均不能产生有效下发。
- 同键同请求重放；同键不同请求冲突；两个 worker 不重复下发。
- Mock 成功不能标记真实设备已生效。
- 撤权失败持续告警，业务授权仍保持失效。

## 完成回复

```text
完成：HK-AI-04
分支/提交：
集合与状态机：
Mock 场景：
测试：
真实设备调用：无
依赖 HK-AI-03 的内容：
未关闭阻碍：
```

