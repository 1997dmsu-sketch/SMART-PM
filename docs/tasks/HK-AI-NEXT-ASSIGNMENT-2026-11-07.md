# 海康门禁下一轮任务卡（2026-11-07）

依据：`HK-AI-PARALLEL-REVIEW-2026-11-07.md`。企业微信看板任务继续取消。所有任务使用独立分支，未经 Codex 复审不得合并。

## A. Kimi：修订 H2-b 设备 claim 设计

**优先级：P0**
**分支：** `docs/hk-h2b-device-claim-design`
**当前提交：** `037083d`
**交付：** 修订 `docs/tasks/HK-AI-04-H2B-DEVICE-CLAIM-DESIGN.md`

### 必改项

1. **冻结 K1 边界**
   - H2-b 不修改现有 `deviceDigest()`、`deviceClaimKey()`、序列号规范化、claim ID 格式或历史记录；
   - 删除把 NFKC/结构化 JSON HMAC/新固定 ID 当作 H2-b 编码要求的表述；
   - 将新算法移入“未来设备登记与 K1 迁移任务”，要求迁移、双读与兼容设计后另审。
2. **修正重放语义**
   - 当前 `BlacklistService.withEligibility()` 会先准备/评价资格；
   - H2-b 的 operation key 重放仍在其事务 build 内返回零 writes；
   - 不宣称重放跳过资格，不修改 blacklist；前置重放优化留给 H2-c。
3. **收紧 released slot 复用**
   - 旧 grant 为 `revoked` 或 `expired`；
   - `cleanupPending !== true`；
   - 关联设备任务全部为终态；
   - slot 墓碑审计字段完整、revision 合法；
   - 任一不满足返回 `GRANT_SLOT_CONFLICT/409`。
4. 更新 D01–D36 测试矩阵，使测试与以上三项一致。
5. 在文档开头明确：H2-a 已由 `f9a2b6b` 关闭；本次仍是设计修订，不含生产代码。

### 验收

- 只修改 Markdown；
- 相对链接有效；
- 不包含设备凭据、地址、序列号、完整指纹或人脸数据；
- 提交号交 Codex 复审，通过后才发 H2-b 编码卡。

## B. DeepSeek Harness：整合时序稳定性修复

**优先级：P0**
**建议分支：** `integration/hk-face-h2a-stable`
**基线：** `feat/hk-face-service-integration @ f9a2b6b`
**引入提交：** `test/face-decode-stability @ ad5ccc8`

### 工作

1. 从 `f9a2b6b` 新建集成分支；
2. cherry-pick `ad5ccc8`，如无冲突不得改写其语义；
3. 运行 `face-biometric.test.mjs` 连续 20 次；
4. 运行 HTTP 并发/恢复测试；
5. 运行 Admin 全量与根测试；
6. 检查最终差异只能是 H2-a 已批准内容加一行 `timeoutMs: 0` 测试修复。

### 禁止

- 不修改生产解码代码；
- 不放宽 3 秒恢复上限、不降低并发、不删断言；
- 不进入 H2-b/H2-c/H3/H4；
- 不注册 HTTP、调用 Provider 或连接设备。

### 交付

集成分支与单一整合提交，附 20 次稳定性、HTTP、Admin、根测试结果，交 Codex 复审。

## C. Workburry：补交门禁管理页面静态审计

**优先级：P1**
**分支：** `feat/hk-face-admin`；若远端分支不存在，先从原页面壳提交恢复并推送，不改服务层。
**交付：** `docs/tasks/HK-AI-05-STATIC-UI-AUDIT.md` 与四页脱敏截图。

### 检查范围

1. 设备、申请、任务、审计四页的路由与返回路径；
2. 字段与冻结 DTO 的对应关系，列出未冻结字段；
3. loading、空数据、无权限、失败、重试和 Mock 标识；
4. 列表、日志、任务页不得展示人脸图片、摘要、objectKey、设备序列号、MAC、IP 或凭据；
5. 1366×768、1440×900、1920×1080 三种桌面尺寸；
6. 键盘焦点、表格横向溢出、对话框关闭、错误提示可读性；
7. 每项问题标记 P0/P1/P2，写明页面、触发步骤、预期和实际结果。

### 边界

- 只审计，不接 API，不修改 UI 和服务层；
- 只使用合成 fixture；
- 截图不得包含真实人脸、姓名、手机号、地址、设备标识或凭据；
- 若页面壳无法运行，记录启动命令、错误和阻断，不自行扩大修复范围。

## D. DeepSeek Harness：H2-b 第 2 笔 createGrant 接线

状态：**已关闭；`2bc10e3` 终审通过。**

已验收：

- K1 domain 缺失、损坏、内部矛盾和配置变化失败关闭；
- device 全部冻结快照字段在事务内复核；
- owner claim 只读，active/released slot 均禁止复用；
- 并发竞争仅一个成功，业务副作用及敏感字段边界已验证。

不得继续在本卡扩大范围。H2-c/H2-d/H3/H4、HTTP、Provider 和设备写操作继续关闭，需另发任务卡。

## F. Kimi：H2-c 资格快照契约设计

**优先级：P0**
**状态：已发卡，仅允许文档设计；编码关闭。**
**任务卡：** `docs/tasks/HK-AI-04-H2C-ELIGIBILITY-DESIGN-TASK.md`

基于真实 `BlacklistService.withEligibility()` 与现有实名、入住、周期、房间模型，冻结 H2-c 完整资格快照、事务 refs、错误映射和不少于 D01–D40 的竞态测试矩阵。只允许 Markdown；设计经 Codex 复审通过后，才可另发 DeepSeek Harness 编码卡。

H2-d/H3/H4、HTTP、Provider 和设备写操作继续关闭。

## H. Cloud Code（DeepSeek）：微信小程序 beta.18 体验版上线协助

**优先级：P0**

**状态：已发卡；只允许上传体验版，不允许正式发布。**

**任务卡：** `docs/tasks/REL-AI-01-MINIPROGRAM-EXPERIENCE-DEPLOY-2026-11-09.md`

使用唯一冻结标签 `v0.1.0-beta.18-production-test.1` 完成本地预检、live 包摘要、微信开发者工具编译、体验版上传、脱敏冒烟测试和回退记录。不得包含 H2-c、人脸后台、Provider 或设备写能力，不得迁移数据库或提交正式审核。

原 Workburry 分配已取消，不再执行本任务。

## I. DeepSeek Harness：H2-c C1/C2 定点返工

**优先级：P0**

**状态：`e4508ea` 复审：C2 通过，C1 暂不通过；C3 关闭。**

**复审记录：** `docs/tasks/HK-AI-04-H2C-C1-REREVIEW-E4508EA-2026-11-10.md`

只修 C1 的事务内 lifecycle guard 身份复核，并补 primaryOccupancyId 预读后变化的竞态测试。C2 已通过，不得再扩大或改写。不得修改 `createGrant()` 或进入 C3。

## G. DeepSeek Harness：H2-c 完整资格快照编码

**优先级：P0**

**状态：设计 `bcb2cd6` 已通过；按 C1→C2→C3→C4 分阶段放行。**

**任务卡：** `docs/tasks/HK-AI-04-H2C-ELIGIBILITY-CODING.md`

代码基线为 H2-b `2bc10e3`。先实现共享只读资格 helper，再实现兼容的 `withEligibility.prepareAttempt`，之后接入 createGrant，最后完成 D01–D75。每阶段必须独立提交、全绿并自审。

H2-d/H3/H4、HTTP、Provider 和设备写操作继续关闭。

## E. Workburry：HK-AI-05A 门禁管理页面演示门禁修复

**优先级：P0**
**分支：** `feat/hk-face-admin`，基线 `708c3ab`，只允许追加提交。
**任务卡：** `docs/tasks/HK-AI-05A-ADMIN-UI-REMEDIATION.md`

修复持续 Mock 边界、六类页面状态、权限提示、UNKNOWN_RESULT 人工对账与审计禁显位；只使用合成 fixture，不接 API、不修改后端、不连接设备。完成后更新独立截图目录并交 Codex 复审，通过前不得制作演示包或合并 main。
