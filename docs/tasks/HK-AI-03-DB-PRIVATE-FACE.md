# HK-AI-03：数据库集成与人脸私密文件

优先级：P0
执行者：DeepSeek Harness
复审者：Codex
基准：`origin/feat/db-05-occupancies` 的 `b9ee061`，人工整合 `origin/feat/db-07-file-assets`
建议分支：`feat/db-mvp-integration`
预计：4～7 个工作日
真人任务依赖：无，今天可以开始。

## 目标

建立海康人脸门禁所需的统一 DB 基线，并增加严格私密的 `face-biometric` 文件用途。只做平台数据和权限，不连接海康设备。

## 任务

1. 以 `b9ee061` 为基线整合 DB-02～DB-07，人工解决 `server.mjs`、`store.mjs` 冲突，禁止整文件覆盖。
2. 保留组织、人员、实名审核、入住周期、黑名单、归档、固定 claim/slot 和审计语义。
3. 将 DB-04、DB-06 文件校验接入 DB-07 文件服务。
4. 新增 `face-biometric`：强制 private、图片类型、大小/尺寸限制、哈希与恶意文件检查。
5. 新增权限：`device.face.submit`、`device.face.review`、`device.face.readPrivate`。
6. 普通文件列表、公开 URL、内容、VR、房源图片和静态 `/uploads` 均不得返回人脸文件。
7. 增加同意版本、本人/代提交人、保存期限、撤销/退租/过期销毁任务和逐次读取审计。
8. 修复并执行 DB-08 隔离云探针前置代码；不得在生产云运行。

## 验收

- DB-02～DB-07 全量测试同时通过。
- 跨组织、猜测 ID、旧路径、public/private 重复登记均不能泄露人脸文件。
- 无 `device.face.readPrivate` 时列表、详情、关联和下载均不可见。
- 权限撤销后下一次读取立即拒绝。
- 日志无 Base64、永久 URL、完整人脸摘要或个人信息。

## 完成回复

```text
完成：HK-AI-03
分支/提交：
共享文件独立提交：
新增集合/权限/purpose：
测试：
隔离云是否执行：
迁移与回滚：
未关闭阻碍：
```

