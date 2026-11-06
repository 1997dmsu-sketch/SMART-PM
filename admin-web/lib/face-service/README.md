# HK-AI-04 人脸服务层 Mock 骨架

状态：**骨架**，未接入 `server.mjs`，未接入数据库集合；正式集成等待 AI-C 阶段 2 终审与指定基线。

## 目录

| 文件 | 内容 |
|---|---|
| `dto.mjs` | 凭证/任务输入校验、对外最小投影（不含图片字节与摘要） |
| `state.mjs` | 凭证状态机、`businessAllowed` / `deviceEffective` / 告警投影 |
| `mock-provider.mjs` | 七种 Mock 场景、失败分类（post_send 不可重试） |
| `routes.mjs` | 路由描述表（method/path/permission/DTO），仅匹配、不注册 |
| `index.mjs` | 入口；`live` 模式选择 Mock 直接失败 |

## 契约假设（待 Codex 对齐）

- `FaceAccessProvider`：`health()`、`upsertCredential()`、`deleteCredential()`、`queryCredential()`；
- 权限名沿用 AI-C 的 `device.face.submit|review|readPrivate`；`device.face.manage` 为占位，待定名；
- 集合 `access_devices` / `face_credentials` / `device_access_grants` / `device_operation_jobs` / `device_operation_logs` 尚未建表。

## 安全边界

- Mock 成功 `deviceEffective` 恒为 `false`，不得标记真实设备生效；
- 发送后未知结果 `UNKNOWN_RESULT` 不可自动重试；
- `live` 模式禁止 Mock，真实 Provider 未实现前必须失败关闭；
- 对外响应不含人脸图片、不含 SHA-256。

## 下一步

1. 按 LOCK-01A 契约补齐集合读写与任务队列（租约、幂等键、requestDigest）；
2. 接 `server.mjs` 路由并补 HTTP 测试；
3. 真实 Provider 继续关闭。
