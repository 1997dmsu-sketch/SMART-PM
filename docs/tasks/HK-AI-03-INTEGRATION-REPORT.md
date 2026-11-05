# HK-AI-03 集成阶段报告（DB MVP 基线）

- 任务：HK-AI-03 数据库整合与人脸私密文件
- 本阶段：**DB-02～DB-07 集成（任务 1～2）完成**；`face-biometric` 与权限（任务 4～7）未开始
- 分支：`feat/db-mvp-integration`
- 基线：`b9ee061`（`feat/db-05-occupancies`）
- 合入：`origin/feat/db-07-file-assets` @ `20e7fb8`
- 合并提交：`b0bd26a`（父：`b9ee061`、`20e7fb8`）
- 测试：**admin-web 193/193 通过**

## 1. 冲突盘点

`git merge-tree` 预检与实际合并一致：19 个提交、26 个文件，**仅 2 个文件 3 处冲突**，全部是"双方各自追加"：

| 文件 | 冲突块 | 双方内容 | 解决方式 |
|---|---|---|---|
| `admin-web/lib/store.mjs` | 1 | HEAD：身份/黑名单/入住集合；DB-07：三个文件集合 | 并集；分组注释标明来源，保持原集合语义不变 |
| `admin-web/server.mjs` | 1 | 导入区：HEAD 五个服务；DB-07 的 `property-v2` 多 `pageParams` | 并集，`property-v2` 导入合并为 `{ OrgPropertyService, OpReplay, pageParams }` |
| `admin-web/server.mjs` | 1 | 中段：HEAD `identityKeyConfig`（DB-04 fail-closed）；DB-07 文件拦截辅助函数（`assetLocators`/`matchFileAsset`/`cloudPathOf`/`extOfPath`/`legacyPurpose`/`MAX_UPLOAD`） | 两段都保留，互不覆盖 |

**未使用整文件覆盖**，所有解决均为定点合并。

## 2. 语义冲突与测试适配

合并后 3 个用例失败，原因同一：DB-07 的 `makeLiveApp` 写于 DB-04 之前，`createApp({mode:"live"})` 现在要求 `IDENTITY_HMAC_KEY` / `IDENTITY_ENCRYPTION_KEY`（fail-closed）。

处理：在 `admin-web/tests/server-files.test.mjs` 的 `makeLiveApp` 中注入**测试专用**密钥，并在 `createApp` 返回后立即恢复原环境，避免污染其他用例或真实进程。

> 这不是放宽生产校验：`identityKeyConfig` 的 live 强制逻辑未改动。

## 3. 测试结果

```text
node --test 'admin-web/tests/*.test.mjs'
tests 193 / pass 193 / fail 0
```

覆盖到 DB-07 新增的文件资源、上传、下载、拦截与 v2 接口，以及既有 DB-02～DB-05 用例。

## 4. 与任务卡的差距

| 任务 | 状态 |
|---|---|
| 1. 以 `b9ee061` 整合 DB-02～DB-07，人工解冲突 | ✅ 完成（`b0bd26a`） |
| 2. 保留组织、人员、实名审核、入住周期、黑名单、归档、claim/slot、审计语义 | ✅ 未修改语义，仅并集合并 |
| 3. 把 DB-04、DB-06 文件校验接入 DB-07 文件服务 | ⬜ 未开始 |
| 4. `face-biometric` 用途（强制 private、类型/大小/尺寸、哈希、恶意文件检查） | ⬜ 未开始 |
| 5. 权限 `device.face.submit` / `review` / `readPrivate` | ⬜ 未开始 |
| 6. 列表/公开 URL/内容/VR/房源图/`/uploads` 不返回人脸文件 | ⬜ 未开始 |
| 7. 同意版本、代提交人、保存期限、撤销/退租/过期销毁任务、逐次读取审计 | ⬜ 未开始 |
| 8. DB-08 隔离云探针前置代码 | ⬜ 未开始（不得在生产云运行） |

## 5. 下一步顺序（建议）

1. 先读 `admin-web/lib/files.mjs` 的 `PURPOSES`/`FileService.upload` 结构，确认 `face-biometric` 作为 private purpose 的接入点。
2. 加 `face-biometric`：仅 private、`image/jpeg|png`、单文件 ≤200 KB（与设备侧图片要求对齐）、尺寸校验、SHA-256 去重、魔数校验。
3. 加三个权限点，并在 `server.mjs` 的文件读取/下载/列表处接入 `readPrivate` 判定。
4. 用与 DB-07 相同的四处拦截点验证人脸文件不会被普通路径返回。
5. 最后做保留期与销毁任务、DB-08 探针前置。

## 6. 提交说明

- `b0bd26a` 为合并提交，包含共享文件 `server.mjs` / `store.mjs` 的冲突解决与一处测试适配。
- 后续 `face-biometric` 的共享文件改动将按《认领与额度分配》要求**单独提交**。
