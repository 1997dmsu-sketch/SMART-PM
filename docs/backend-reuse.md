# 后端复用记录

## 来源与边界

- 来源：https://github.com/1997dmsu-sketch/mini-shop
- 分支：`main`（仓库默认分支；用户未指定其他分支）。
- 提交：`b4c9370b62548492a6dc167c6aba98890a5df91e`。
- 迁入 `cloudfunctions/` 下全部 61 个跟踪文件，业务代码未改写。
- 旧前端、旧设计目录、H5 测试页面及旧页面需求未迁入。
- 旧仓库说明只用于理解后端实现，不作为新页面需求来源。

## 能力清单

| 能力 | 云函数 |
| --- | --- |
| 登录 | login、phoneLogin、adminLogin |
| 初始化 | dbInit |
| 房源列表 | getHouses |
| 内容管理 | contentInit、contentList、contentAdmin |
| 房屋与门锁授权 | houseAdmin |
| 通通锁 | listLocks、getLockKey、unlock、unlockRecords |
| 涂鸦门锁 | listTuyaDevices、openTuyaLock、getTuyaDynamicPassword |
| 设备 | getDevices、syncDevices |
| 智能水电表 | meterService |
| 消息 | chatInit、messageList、messageSend、messageRead |
| 历史兼容 | addTuyaDevice（旧项目标记废弃，保留原代码，不作为新入口） |

后续按完整设计图选择所需接口；该清单不意味着新小程序必须包含所有旧功能。

## 已核对的对接入口

- `login`：取微信云函数上下文身份，查询或创建用户。
- `phoneLogin`：接收微信手机号授权 `code`。
- `getHouses`：支持 community、priceMin、priceMax、roomType、rentType、page、pageSize。
- `contentList`：以 type 查询内容。
- `houseAdmin`：action 为 listRooms、listUsers、listDevices、bind、unbind。
- `meterService`：action 为 list、detail、records。
- `messageList`：action 为 conversations 或 messages。
- `messageRead`：可传 conversationId；身份从微信上下文读取。

## 联调条件与验证边界

这些函数依赖微信云数据库和云函数身份上下文。门锁、水电表还依赖真实设备与服务配置。
本地依赖加载和复制校验不证明云端调用成功，旧说明中的“已就绪”也不等于本次已验证。

`dbInit` 使用以下环境变量名，值应在最终选定的微信云函数配置中安全设置：

- TTLOCK_CLIENT_ID、TTLOCK_CLIENT_SECRET、TTLOCK_USERNAME、TTLOCK_PASSWORD_MD5
- TUYA_ACCESS_ID、TUYA_ACCESS_SECRET、TUYA_UID
- ADMIN_USERNAME、ADMIN_INITIAL_PASSWORD

本次没有请求或复制这些凭证，没有运行会写入种子数据的初始化函数。
旧环境是否继续复用需在云端联调前明确；当前无需凭证即可完成源码迁入与本地准备。

后续需针对实际启用的接口验证登录、权限、数据读写及设备响应。
旧项目文档提到的测试模式/授权放行逻辑需在接入真实门锁前检查，
目前保留原后端行为，不将复制成功表述为生产可用。

## 依赖安装发现

`addTuyaDevice/package-lock.json` 缺少清单中声明的 node-fetch，原样执行 npm ci 会失败。
安装器仅对该历史函数使用 npm install --package-lock=false，原清单、锁文件不变。
此为本地准备方式；修复旧锁文件应作为单独代码变更处理。
