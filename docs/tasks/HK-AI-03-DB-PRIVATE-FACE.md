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

### 阶段 2 范围裁定（Codex，2026-11-05）

可在已通过复审的 DB MVP 基线上继续，但须按以下边界实现：

1. 复用 `sniffMime`、`policy.accept`、`maxSize` 和现有 `checksum` 字段；为 `face-biometric` 单独配置仅 JPEG/PNG、`200 KiB`、强制 private。
2. `writePermission` 必须显式设为 `device.face.submit`，不得回落为“组织管理员即可”；`readPermission` 必须是 `device.face.readPrivate`。`device.face.review` 在审核/批准动作入口显式校验，不能由文件读写权限代替。
3. 新增安全解码后的像素尺寸校验和资源上限；不能只读取宽高头或扩展名。具体尺寸参数先做成服务端策略常量，最终数值以 HK-AI-01 官方证据和真实 capability 为准，未确认前不得宣称设备兼容。
4. 现有 SHA-256 `checksum` 用于完整性、重复风险识别和审计关联，无需再存第二份摘要。禁止跨组织全局去重或向调用方暴露“其他组织已有相同人脸”的结果；本阶段不做物理文件合并。
5. 日志、API 和普通列表不得返回完整 checksum；如审计需要引用，只保存文件 ID 或不可逆的审计引用。
6. 对普通文件列表、公开 URL、内容/VR/房源图片、静态 `/uploads` 四类公开路径逐点增加拒绝测试，并补跨组织、无读取权限、权限撤销后立即拒绝测试。
7. 本阶段只完成文件策略、权限、拦截与离线测试；同意版本、代提交、保存期限、撤销/退租/过期销毁仍是后续必做项，不因阶段 2 通过而取消。

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

