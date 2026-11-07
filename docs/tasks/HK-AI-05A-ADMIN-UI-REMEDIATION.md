# HK-AI-05A：门禁管理页面演示门禁修复

优先级：**P0（11 月 15 日第一版演示）**
执行者：**Workburry**
复审者：**Codex**
分支：`feat/hk-face-admin`
基线：`708c3ab3672f72a86d17d35779bb44d46833ee9c`
前置审计：`HK-AI-05-STATIC-UI-AUDIT.md`
复审依据：`HK-AI-05-STATIC-UI-AUDIT-REVIEW-708C3AB-2026-11-07.md`

## 目标

把现有静态页面壳修成可用于第一版演示的**合成数据 UI**，明确区分 Mock 与真实设备证据，补齐关键状态、权限提示和未知结果对账表达。

本任务仍不接 HTTP/API，不调用 Provider，不连接真实门禁，不实现后端权限。页面上的操作只能改变本地合成 fixture 或显示说明，不能产生业务写入。

## 第一阶段：必须完成

### 1. 全局 Mock 状态边界

五个页面持续显示统一横幅：

> Mock 演示，未连接真实门禁

同时显示只读状态：

- `executionMode=test`
- `provider=mock`
- `evidenceScope=simulated`
- 真实设备生效：否

要求：

- 首屏可见，切页后仍存在；
- 打印态不得完全隐藏；
- 颜色和文字同时表达状态，不只依赖颜色；
- 不提供切换到 `live` 的按钮；
- 不得出现“已同步真实设备”“真实授权已生效”等误导文案。

### 2. 六类页面状态

设备、申请、任务、审计四页均提供可复核的合成状态：

1. loading；
2. empty；
3. forbidden；
4. error；
5. retrying；
6. ready。

可通过本地 fixture/state selector 演示，但必须标注“仅切换合成 UI 状态”。刷新后可恢复默认，不使用 localStorage，不发网络请求。

### 3. 设备页

使用合成记录展示：

- 脱敏设备编号；
- 型号；
- 固件版本；
- capability 状态；
- 灰度状态；
- `provider/executionMode/evidenceScope`；
- 在线状态与最近心跳。

不得展示序列号、MAC、IP、账号、密码、证书指纹或设备凭据。新增设备、同步状态等按钮继续保持无副作用，并明确标注“演示占位”。

### 4. 申请页

增加合成申请详情，展示人员代号、房间代号、入住周期、目标设备、授权起止时间、审核状态和同意记录。

- 审核、拒绝、撤销、补件按钮均为本地演示；
- 操作前要求填写理由；
- 无 `device.face.review` 时显示 forbidden 状态；
- 审核权限不自动获得 `device.face.readPrivate`；
- 私密图片区域只显示“需逐次授权查看”的占位，不放入图片、URL、摘要或字节；
- 不实现真实文件读取或下载。

### 5. 任务页与 UNKNOWN_RESULT

展示：

- jobId（合成）；
- action/state；
- attempts；
- failureReason（脱敏合成文本）；
- lastSuccessAt；
- `executionMode/provider/evidenceScope`。

必须包含 `awaiting_result / UNKNOWN_RESULT` 示例：

- 只允许“查询/人工对账”；
- 不出现“再次新增”；
- 自动重试禁用；
- 受控重试按钮只在 retryable 状态展示；
- 无 `device.operation.retry` 时不可操作，并说明缺少权限；
- 所有按钮只更新本地演示状态。

### 6. 审计页

展示合成的批准、拒绝、查看原图申请、重试、撤销、人工对账事件，并带理由与结果。

- 删除或替换未冻结的“IP / 终端”“详情摘要”展示位；
- 不展示 requestDigest、checksum、objectKey、序列号、MAC、IP、凭据或人脸内容；
- 无 `device.audit.read` 时显示 forbidden；
- 页面文案不得声称日志已写入真实不可变存储。

### 7. 导航、反馈与可访问性

- 面包屑中的“概览”可点击返回；
- 详情或局部状态提供明确返回路径；
- 所有可交互控件有可见键盘焦点；
- toast 使用合适的 `role/aria-live`，可通过关闭按钮和 Escape 关闭；
- 表格在窄宽度下可键盘到达横向滚动容器；
- 对比度问题优先修复 Mock 横幅和次级文字。

## 明确禁止

- 不修改 `admin-web`、服务层、数据库、store、blacklist、files 或 server；
- 不新增网络请求、WebSocket、设备 IP 访问或云调用；
- 不使用真实人员、人脸、姓名、手机号、身份证、房号、地址或设备标识；
- 不嵌入人脸图片、base64、永久 URL、objectKey 或摘要；
- 不把 Mock/fixture 结果标为真实设备生效；
- 不合并 `main`，不改写 `708c3ab` 历史；
- 不顺带实现 H2-b/H2-c/H3/H4 或真实 Provider。

## 测试与验收

### 自动检查

1. 所有 HTML 内链存在；
2. 页面零外部 URL、零网络 API；
3. 禁显词和值扫描通过；
4. 六态 selector 能在四个业务页切换且无异常；
5. UNKNOWN_RESULT 不出现可执行的再次新增或自动重试；
6. Escape 可关闭 toast，Tab 可见焦点；
7. `git diff --check` 通过。

### 截图

重新生成以下脱敏截图：

- 五页 1366×768；
- 四个业务页 1440×900、1920×1080；
- 任务页 UNKNOWN_RESULT；
- 申请页无私密读取权限；
- 至少一页 loading、forbidden、error、retrying；
- 一张打印态，证明 Mock 边界仍可见。

截图只使用合成 fixture，并放入独立的 `docs/tasks/screenshots/hk-ai-05a/`，不得覆盖静态审计原始证据。

### 复审门禁

- 页面与截图差异必须单独提交；
- 提交前运行静态检查和渲染检查；
- 交 Codex 复审前不得宣称“演示页面已通过”；
- Codex 通过后才能制作演示包；合并 `main` 仍需单独决定。

## 建议提交拆分

1. `fix(ui): add persistent mock evidence boundary`
2. `feat(ui): add synthetic states and permission views`
3. `feat(ui): add face admin demo details and reconciliation`
4. `test(ui): add static checks and refreshed screenshots`

## 完成回复模板

```text
完成：HK-AI-05A 门禁管理页面演示门禁修复
分支/提交：
页面改动：
六态检查：
UNKNOWN_RESULT 检查：
禁显扫描：
截图：
网络请求：0
真实设备/Provider 调用：0
未关闭问题：
请求：交 Codex 复审；通过前不制作演示包、不合并 main。
```
