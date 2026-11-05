# HK-AI-01：海康 ISAPI 证据矩阵

优先级：P0
执行者：Kimi
复审者：Codex
状态：已认领；等待原始资料私密交接
基准分支：`docs/lock-01-fast-track`
建议分支：`docs/hk-isapi-evidence`
预计：1～2 个工作日
真人任务开始：2026-11-06；本任务今天可先完成文档侧工作。

## 目标

把两份海康指南中的人员、人脸、权限、认证、事件和错误码整理成可供真实 Provider 开发使用的证据矩阵，同时明确哪些只是产品族文档能力，哪些已经由目标设备 capability 验证。

## 必读

- `docs/devices/HIKVISION-ISAPI-DOCS-2026-11-05.md`
- `docs/devices/HIKVISION-DS-K1T671BM-CAPABILITY.md`
- `docs/database/LOCK-01A-CONTRACT.md`
- `docs/database/LOCK-01A-DATA-DESIGN.md`
- `docs/tasks/HK-ISAPI-01-DOC-AND-DEVICE-VALIDATION.md`

原始资料由项目负责人私密提供，不得要求上传到公开 GitHub，不得提交带水印的 PDF/XLSX。

原始包交接校验：

- `ISAPI开发指南_智能门禁_智能门禁一体机20262005122053.zip`
  - SHA-256：`52d3c19f37ea0757dd042e050e6d012a3fe9547a6da96a9649142266637b9761`
- `ISAPI开发指南_智能门禁_测温智能门禁一体机20262005122046.zip`
  - SHA-256：`9888ab2a47a24ded58a9ac591df71fb3bfcee01c34a13e951711be9005390f76`

接收后先校验文件摘要；不一致时停止引用并报告，不自行从公开网络寻找替代版本。

## 任务

1. 建立三列证据等级：`文档存在`、`目标设备 capability 支持`、`真实调用验证`。
2. 整理人员新增、设置、修改、查询、删除和删除进度接口。
3. 整理人脸 capability、库、容量、新增、设置、修改、查询和删除接口。
4. 整理 `employeeNo ↔ FPID`、权限计划、门号、有效期和人员类型字段。
5. 整理 HTTPS、RFC 7616 Digest、事件长连接和推送方式。
6. 从错误码表提取本项目会遇到的错误码子集，但在没有接口上下文前不得判定可重试。
7. 明确普通指南包含 `DS-K1T671B`、测温指南包含 `DS-K1T671BM-3XFTD`，都没有精确列出裸型号 `DS-K1T671BM`。
8. 输出待真人核对项，准备接收11月6日的铭牌、固件和厂商回复。

## 禁止事项

- 不编写真实设备调用代码。
- 不把近似型号写成目标型号已验证。
- 不公开原始文档或水印内容。
- 不引用博客、第三方 SDK 替代官方证据。

## 验收

- 每个候选端点都有文档、章节、条件和 capability 节点。
- 未验证项清晰标记，不出现猜测结论。
- 给 HK-AI-02、HK-AI-04 提供可机器读取的接口白名单和字段清单。

## 完成回复

```text
完成：HK-AI-01
分支/提交：
新增文件：
已确认接口：
待设备 capability 确认：
待真人确认：
未关闭阻碍：
```

