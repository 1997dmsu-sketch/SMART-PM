# HK-AI-02 现场只读执行批准与执行包

- 代码状态：`f15160d` 代码侧复审通过（58 项测试、fail-fast 已关闭三个阻断）
- 本包用途：现场批准、一次性执行、证据回填与无残留清理
- **红线**：批准栏未全部签署前，任何人不得设置 `HIKVISION_PROBE_ALLOW_READ=true`；即使签字完成，也只允许一次只读执行

## 1. 执行前检查（全部为“是”才可继续）

| # | 检查项 | 证据/记录方式 | 结论 |
|---|---|---|---|
| 1 | 设备铭牌型号与 `HIKVISION_PROBE_EXPECTED_MODEL` 完全一致 | 现场目视核对，记录型号与固件版本 | ☐ |
| 2 | 固件版本已记录，且与任务卡/厂商答复一致 | 设备 Web 页面或铭牌，记录版本号 | ☐ |
| 3 | 设备处于隔离网络，执行机与设备同网段、无公网出口 | 现场网络负责人确认 | ☐ |
| 4 | 执行机不连接生产云、不安装生产凭据 | 执行人自查 | ☐ |
| 5 | 目标主机与端口已登记，且在允许列表内 | 现场记录主机/端口（不写入仓库明文） | ☐ |
| 6 | 使用最小权限只读账号（仅需读取 deviceInfo/capabilities） | 账号名记录在离线工单 | ☐ |
| 7 | 叶证书 SHA-256 已由**两人独立**线下核验 | 核验人 A/B 签字，指纹写入离线工单 | ☐ |
| 8 | 一次性执行窗口已设定（建议 ≤30 分钟，超时即停） | 记录开始/结束时间与时区 | ☐ |
| 9 | 已宣读停止条件（§4），执行人确认理解 | 执行人签字 | ☐ |
| 10 | 原始响应处置方式已确认（临时目录 0700、文件 0600、用后删除） | 现场负责人确认 | ☐ |

> 职责分离：执行人不得同时担任现场负责人或项目负责人；批准人不得代替执行人操作。

## 2. 不得进入仓库的信息

- 设备序列号、MAC、设备 IP 明文、账号/密码、完整证书指纹；
- 原始响应报文（`.raw`）与未脱敏 `report.json`；
- 任何带水印的厂商资料。

仓库只允许记录：`已核验` 布尔值、核验时间、执行结果摘要（型号/固件/能力位）、报告文件名（不含路径中的主机信息）。

## 3. 一次性执行步骤

```bash
set +o history                       # 不写入 shell 历史

read -rp  '设备地址: '   HIKVISION_PROBE_HOST
read -rp  '设备账号: '   HIKVISION_PROBE_USERNAME
read -rp  '批准型号: '   HIKVISION_PROBE_EXPECTED_MODEL
read -rsp '设备密码: '   HIKVISION_PROBE_PASSWORD; echo
read -rsp '叶证书指纹: ' HIKVISION_PROBE_FINGERPRINT256; echo

export HIKVISION_PROBE_HOST HIKVISION_PROBE_USERNAME \
       HIKVISION_PROBE_EXPECTED_MODEL HIKVISION_PROBE_PASSWORD \
       HIKVISION_PROBE_FINGERPRINT256
export HIKVISION_PROBE_ALLOWED_HOSTS="$HIKVISION_PROBE_HOST"

node cli.mjs                          # 先 dry-run：必须只打印 6 个 GET
export HIKVISION_PROBE_ALLOW_READ=true
node cli.mjs; echo "exit=$?"           # 唯一一次真实执行
```

执行后立即：

```bash
unset HIKVISION_PROBE_HOST HIKVISION_PROBE_USERNAME HIKVISION_PROBE_EXPECTED_MODEL \
      HIKVISION_PROBE_PASSWORD HIKVISION_PROBE_FINGERPRINT256 \
      HIKVISION_PROBE_ALLOWED_HOSTS HIKVISION_PROBE_ALLOW_READ
set -o history
```

## 4. 停止条件（任一触发即停止，不再重试）

| 触发 | 处理 |
|---|---|
| `model` 为空或与批准型号不一致 | 立即停止，记录 `aborted` |
| 指纹不匹配 / 取不到证书 | 立即停止，不降级为系统信任链 |
| 第二次 401、非 Digest challenge、不支持算法 | 立即停止 |
| 重定向、超时、响应超限、内容类型异常、`RESPONSE_ERROR` | 立即停止 |
| 窗口超时或现场网络负责人要求中止 | 立即停止 |
| 出现任何写操作迹象（本工具本不应有） | 立即停止并上报 |

**不得**为了“拿到完整报告”而重跑、放宽超时、关闭校验或改用 CA。

## 5. 证据回填（执行后 1 小时内）

1. 只从 `report.json` 读取：`device.model`、`device.firmwareVersion`、`capabilities.*`、`counts.*`、`aborted`、`checks`；
2. 回填 `HK-AI-01` 证据矩阵的“目标设备 capability”列，标注“已由 `f15160d` 探针实测”；
3. 若 `capabilities` 为空或能力位缺失，如实写“设备未返回”，**不得推断为支持**；
4. 原始响应不复制进仓库；如需保留，转入受控离线介质并登记编号。

## 6. 清理与无残留证明

```bash
ls -la "$HIKVISION_PROBE_OUT_DIR"     # 确认只剩待删除文件
# 删除 raw 与 report（或转移到离线介质后再删）
rm -rf "$HIKVISION_PROBE_OUT_DIR"
ls "$HIKVISION_PROBE_OUT_DIR"          # 应报不存在
git status --porcelain                 # 应为空
```

现场记录并签字：

| 项 | 结果 |
|---|---|
| 是否只执行一次 | ☐ 是 / ☐ 否（说明原因） |
| 是否触发停止条件 | ☐ 否 / ☐ 是（哪一条） |
| 原始响应是否已删除 | ☐ 是 / ☐ 转入离线介质（编号：______） |
| 工作区是否无 Git 变更 | ☐ 是 / ☐ 否 |

## 7. 批准签字栏

| 角色 | 姓名 | 签字 | 日期时间（含时区） |
|---|---|---|---|
| 现场负责人 |  |  |  |
| 项目负责人 |  |  |  |
| 执行人 |  |  |  |

执行窗口：____:____ 至 ____:____（时区：________）

批准结论：☐ 批准一次只读执行　☐ 拒绝

> 本栏签署后仅授权**一次**只读探针；任何重跑都需要重新签署。签字影像/扫描件存离线工单，不入仓库。
