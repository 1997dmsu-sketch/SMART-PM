# 宇宙物业智联小程序

当前版本：**v0.1.0-beta.13 · 后端联调版**。
本版本连接已确认的真实微信云环境，部署步骤见 [真实后端联调](docs/LIVE-DEPLOYMENT.md)。
需要离线设计演示时，请下载标签 `v0.1.0-beta.2`。
交付范围、导入步骤与验收用例见 [测试交付说明](docs/TESTING.md)，变更见 [版本记录](CHANGELOG.md)。

按本次上传的 10 张完整设计图重建的原生微信小程序，复用 mini-shop 的 24 个云函数。
不继承旧前端页面或旧页面需求。详细解析见 [设计解析](docs/design-analysis.md)。

## 当前内容

- `miniprogram/`：首页、广场、开门、消息、我的、租房详情、房源信息及补充咨询页。
- `cloudfunctions/`：复用旧后端；原始来源校验在 `docs/backend-provenance.json`，后续修复独立记录在 `docs/backend-changes.json`。
- `admin-web/`：独立电脑端网页管理后台，双击 `start-demo.cmd` 后打开 http://127.0.0.1:4173；部署见 [后台说明](docs/ADMIN-WEB.md)。
- `design/screens/` 与 `design/slices/`：本次完整设计图和原始切图，不打入运行包。
- `tests/`：本地服务隔离、筛选、收藏、消息和开门调用守卫的行为测试。

## 打开后端联调版

在微信开发者工具导入本目录，确认：

- AppID：`wxd83b20cbba2a0b24`
- 微信云环境：`cloud1-d6gs08jbb8aa7a138`
- 运行模式：`live`
- 真实门锁操作：关闭

使用有此小程序开发权限的微信扫码登录。先核对云函数及环境权限，重新编译后预览。
真实数据未配置会显示空态或错误；消息发送/已读、手机号登录会操作对应真实测试账号数据。
仅对测试账号和明确的测试会话联调。不会自动部署函数或初始化数据库。

本版本尚未在微信平台上传、编译或真机验收，不能视为已完成线上部署。

## 本地检查

当前环境 Node.js 24，前端没有第三方依赖。仓库根目录执行：

```bash
npm test
npm run check
node scripts/install-backend.mjs
node scripts/verify-import.mjs
```

后端安装器最多并行安装4个函数；有一致锁文件的使用 `npm ci`，
无锁文件及旧 `addTuyaDevice` 锁文件缺失 node-fetch 的情况使用 `npm install --package-lock=false`。
保留原清单与锁文件。无锁依赖不保证跨日期得到同一版本。
缓存默认 `/workspace/.smart-pm-npm-cache`，可通过 `npm_config_cache` 覆盖。

`npm run check` 检查模板和引用结构，不等价于微信编译器验证。
`verify-import` 根据原始来源与独立变更记录验证后端和切图。

## 真实环境对接

1. 当前已按用户确认选定上述 AppID 与旧云环境；先核对登录者权限。
2. AppID、cloudEnv 与 live 已配置；如需切换环境，请显式修改后重新验证。
3. 在对应微信云环境部署所需云函数并配置数据库权限；不要直接运行初始化函数覆盖既有数据。
4. 验证登录、住户房屋授权与设备归属后，再显式开启 `allowDeviceOperations` 并进行门锁联调。

`live` 调用失败会显示错误，不偷偷回退为演示成功。
当前家庭成员、住户房源详情、预约提交等缺接口；水电表接口缺住户过滤，默认不开放。
蓝牙、VR、支付等未完成对接，具体状态见设计解析。凭证仅在微信云环境安全配置，不写入代码。
