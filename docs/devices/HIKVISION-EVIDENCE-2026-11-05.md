# LOCK-01A 设备侧 ISAPI 证据包（2026-11-05）

- 适用任务：LOCK-01A（海康 `DS-K1T671BM` 门禁人脸接入前期调研）
- 用途：供其他 AI / 评审人**独立复核**本次结论，不替代厂商型号文档
- 配套文件：`HIKVISION-DS-K1T671BM-CAPABILITY.md`（结论与端点表）、`evidence/hikvision-2026-11-05.json`（机读清单）
- 一句话结论：**"门禁一体机"设备侧 ISAPI 的人脸下发能力已取得文档级证据；`DS-K1T671BM` 型号级适配仍未验证。**

> ⚠️ 评审边界：本包所有结论的适用范围是**通用"门禁一体机"**，不等于 `DS-K1T671BM`。
> 请勿据此批准 LOCK-01B（模拟适配器实现），除非 Q1/Q4/Q6 另行关闭。

## 1. 本次相对上一版（第二轮）改了什么

| 项目 | 第二轮 | 第三轮（本包） |
| --- | --- | --- |
| 人脸录入方式 | 待厂商确认 | 文档级确认：支持平台下发（图片 / `modelData`） |
| 图片格式与大小 | 待厂商确认 | 文档级确认：JPG/JPEG、≤200KB、建议 640×480、两眼间距 >40px |
| 增删改查端点 | 待厂商确认（"生态端点无删除"） | 6+1 个端点齐备，**含两条删除路径** |
| 事件 | 仅知存在 `EventNotificationAlert` 结构 | 事件类型码表 + 通知信封字段 |
| 覆盖范围 | 生态层面 | 通用门禁一体机（仍非 BM 型号级） |

## 2. 证据来源（可复现）

| ID | 文档 | 类型 | 字节 | SHA-256（前 16 位） |
| --- | --- | --- | --- | --- |
| S1 | [门禁一体机（ISAPI 全文 1.1–1.27）](https://open.hikvision.com/hardware/v2/08%E5%8D%8F%E8%AE%AE%E9%80%8F%E4%BC%A0/%E9%97%A8%E7%A6%81%E4%B8%80%E4%BD%93%E6%9C%BA.html) | 静态页 | 401,080 | `30f733d229806143` |
| S2 | [人员管理(以人为中心)](https://open.hikvision.com/docs/docId?productId=5cda567cf47ae80dd41a54b3&version=%2F16e18c75bd644f1dbf9e8301d6fc9b73&curNodeId=6d952a6cf7894484a6b43c04b865f52f) | 文档服务（Markdown） | 45,320 | `ff0cd5a57be003cf` |
| S3 | [附录D2.1 门禁事件](https://open.hikvision.com/docs/docId?productId=5cda567cf47ae80dd41a54b3&version=%2F16e18c75bd644f1dbf9e8301d6fc9b73&curNodeId=fbbe7f3b06b047e0b89aacb5f44b0e69) | 文档服务（Markdown） | 20,998 | `774ae31729495b03` |

复现方式（抓取时无需登录）：

```bash
curl -s "https://open.hikvision.com/api/open/cqsservice/cqs/doc/getById?id=<nodeId>&path="
# 返回 { code: 0, data: { content: "<markdown 正文>" } }
```

S2 的 `nodeId` 为 `6d952a6cf7894484a6b43c04b865f52f`，S3 为 `fbbe7f3b06b047e0b89aacb5f44b0e69`。

> 该接口在抓取时无需鉴权，属厂商站点实现现状，可能随时变更；本包只做人工核对，不做批量抓取。
> 厂商原文未入库（版权），仓库仅保留元数据、端点与摘要。

## 3. 关键事实与原文位置

| # | 事实 | 出处 | 原文位置 |
| --- | --- | --- | --- |
| F1 | 人脸下发支持 `faceURL` 或 `modelData`（二选一必填） | S1 §1.6 添加人脸数据 | 请求报文字段注释 |
| F2 | 图片格式：JPG/JPEG，≤200KB，宽高 ≤400 万，建议 640×480，两眼间距 >40px，白底无逆光无 PS | S2 | 下发人脸章节"备注 2" |
| F3 | 必须先下发人员工号，才能绑定人脸 | S2 | 同上"备注 1" |
| F4 | 人脸端点 7 个，删除有 `FDSearch/Delete` 与 `FDSetUp{deleteFP:true}` 两条路径 | S1 §1.1–§1.6 | 各节 URL |
| F5 | 支持 `PicFeaturePoints` 六类特征点，坐标归一化 0–1000 | S1 §1.3 | `PicFeaturePoints` 注释 |
| F6 | 删除人员级联卡/指纹/人脸，且异步：需轮询 `DeleteProcess` 至 `success` | S2 / S1 §1.13–1.14 | 删除人员章节 |
| F7 | 事件：`event_acs` / `OnEventNotify`，字段含 eventId、eventType、happenTime、status | S3 | 通知报文结构 |
| F8 | 事件类型码示例：196893 人脸通过、197151 人脸失败、198919 远程软件开门 | S3 | 附录 D.2.1.1 |
| F9 | 能力集：`GET /ISAPI/AccessControl/capabilities` 可自证能力位 | S1 §1.15 | 获取门禁总能力 |

## 4. 已验证 / 未验证（请重点复核这条线）

| 级别 | 内容 |
| --- | --- |
| **文档级已验证**（通用门禁一体机） | F1–F9；端点路径、字段名、图片阈值、事件结构均可在上述来源中逐条定位 |
| **未验证（型号级）** | `DS-K1T671BM` 是否支持上述端点；`capabilities` 实际返回；是否支持 `modelData`/特征点 |
| **未验证（工程级）** | ISAPI 认证方式（Digest/账号/SDK 登录）、是否必须经 HikCentral、错误码与限频、离线行为 |
| **未验证（合规/商务）** | 人脸存储地域与删除机制、接口费用与设备许可 |

## 5. 已知的判读风险

1. **把通用文档当型号能力**——本包最主要的误用风险；`HIKVISION-DS-K1T671BM-CAPABILITY.md` §2.2 仍为 0 条。
2. **`blackFD` 语义**——文档中为"名单库"，门禁场景默认使用；但它是否等价于"门禁人员库"未获书面确认。
3. **`FDID` 固定为 1**——HCNetSDK 示例中固定为 1，直连时是否必须固定、是否可自建库，未验证。
4. **"返回成功"≠"已生效"**——人脸下发返回 `ResponseStatus` 只代表受理；建模结果需另行确认（`SearchModelFailRecord`）。
5. **特征点收益未量化**——文档称可提高建模成功率，但无具体阈值或实测数据。

## 6. 请评审方回答的六个问题

1. 这些证据足以支撑"路线 A（设备直连 ISAPI）技术上可行"的判断吗？还是必须等型号实测？
2. 依据 §4 端点，能否直接设计 `FaceAccessProvider` 的 enroll/update/revoke/query 契约？缺口在哪？
3. 图片硬指标是否足以制定上传校验规则？还缺哪些量化项（角度、光照、遮挡）？
4. 异步删除与建模，应如何映射到 `device_operation_jobs` 的状态机？`UNKNOWN_RESULT` 的边界划在哪？
5. 有没有我们误读的字段或语义（尤其 `blackFD`、`FDID`、`modelData`）？
6. 证据分级是否恰当？有没有把"文档级"写成"型号级"的地方？

## 7. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-04 | 第一、二轮：生态证据与候选路线；BM 型号级 0 条 |
| 2026-11-05 | 第三轮：补入 S1–S3 三份设备侧 ISAPI 证据；Q3/Q5 协议层关闭；新增本证据包与机读清单 |
