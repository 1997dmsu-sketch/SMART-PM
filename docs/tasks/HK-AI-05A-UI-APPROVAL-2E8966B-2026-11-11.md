# HK-AI-05A 门禁管理演示 UI 终审（`2e8966b`）

日期：2026-11-11

结论：**通过；`61fd240` 的两项定点阻断关闭。**

复审对象：

- 分支：`feat/hk-face-admin`
- 基线：`708c3ab`
- 提交：`2e8966b`（包含 `61fd240` 后续修复）

## 独立验证

- `61fd240..2e8966b` 差异检查通过；
- 静态检查：31/31；
- 页面源码权限仅包含冻结权限点，已无 `device.face.read`；
- devices forbidden 证据显示 `device.manage`；
- CDP 脚本支持 `CHROME_BIN`、Linux/macOS/Windows 常见路径和 `which/where`；
- 无效 `CHROME_BIN` 返回退出码 1，并输出明确错误，不改写既有证据；
- 云端 Chromium 可自动发现和启动，但受当前 `file://` 企业策略影响无法完成页面状态切换；该限制与上次复审一致，不判为页面缺陷；
- 复审后工作树干净，未接 API、Provider 或真实设备。

## 关闭项

1. 设备页缺权限提示使用冻结权限 `device.manage`；
2. 静态检查禁止未定义的 `device.face.read`；
3. Chrome 探测不再硬编码单一 Windows 路径；
4. 浏览器缺失和启动失败均受控退出，不生成误导证据。

## 上线边界

本终审只批准 Mock 演示 UI。页面仍为零 API、零 Provider、零设备连接，不能视为完整门禁前端已上线。真实 UI 接线必须等待 HTTP 契约与路由终审后另发任务卡，并重新覆盖权限、同态 404、任务状态、`UNKNOWN_RESULT`、撤权和人工对账。

不得因本终审打开设备写、连接真实设备、合并未批准后端或发布正式版。
