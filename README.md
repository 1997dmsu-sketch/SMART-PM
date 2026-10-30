# 宇宙物业智联小程序

按本次上传的 10 张完整设计图重建的原生微信小程序，复用 mini-shop 的 24 个云函数。
不继承旧前端页面或旧页面需求。详细解析见 [设计解析](docs/design-analysis.md)。

## 当前内容

- `miniprogram/`：首页、广场、开门、消息、我的、租房详情、房源信息及补充咨询页。
- `cloudfunctions/`：原样复制的旧后端；来源提交与文件校验在 `docs/backend-provenance.json`。
- `design/screens/` 与 `design/slices/`：本次完整设计图和原始切图，不打入运行包。
- `tests/`：本地服务隔离、筛选、收藏、消息和开门调用守卫的行为测试。

## 打开设计演示

在微信开发者工具导入本目录 `/workspace/SMART-PM`，项目配置指向 `miniprogram/`。
当前 AppID 为 `touristappid`，`miniprogram/config/runtime.js` 默认为 `demo`，
无需生产凭证即可查看设计与本地交互。若开发者工具当前版本要求正式 AppID，请填入你有权使用的 AppID。
所有示例页标识设计演示；开门、电话、消息发送等不会操作真实设备或账户。

此处已完成本地检查，尚未在微信开发者工具编译或真机验证。项目尚未提交或推送到 GitHub。

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
`verify-import` 验证原样迁入的后端和切图；后续有意修改后端时应单独记录差异。

## 真实环境对接

1. 选择有权使用的小程序 AppID 和微信云环境；不默认连接旧线上环境。
2. 设置 `project.config.json` 的 AppID 和 `miniprogram/config/runtime.js` 的 `cloudEnv`，将 mode 改为 `live`。
3. 在对应微信云环境部署所需云函数并配置数据库权限；不要直接运行初始化函数覆盖既有数据。
4. 验证登录、住户房屋授权与设备归属后，再显式开启 `allowDeviceOperations` 并进行门锁联调。

`live` 调用失败会显示错误，不偷偷回退为演示成功。
当前家庭成员、住户房源详情、预约提交等缺接口；水电表接口缺住户过滤，默认不开放。
蓝牙、VR、支付等未完成对接，具体状态见设计解析。凭证仅在微信云环境安全配置，不写入代码。
