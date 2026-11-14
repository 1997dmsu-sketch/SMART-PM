# REL-AI-01 微信小程序体验版上线协助 · 脱敏报告

**负责人：** Workburry（发布 AI）
**执行日期：** 2026-11-14（GMT+8）
**发布对象：** 微信小程序**体验版**（非公开正式版）
**状态：** 本地预检、编译、体验版上传均完成；真机 UI 冒烟待授权测试账号执行（见 §7、§8）

> 本报告按任务卡要求脱敏：不记录完整 AppID、完整云环境标识、二维码、cookie、token、openid、手机号及任何云凭据。涉及环境标识处仅写「与仓库既有配置一致」。

## 1. 发布基线与包摘要

| 项 | 值 |
| --- | --- |
| 唯一允许分支 | `release/miniprogram-production-test-beta18` |
| 精确提交 | `6e18d04ad958f00a602b92cdfdf2a36297c25230` |
| 标签 | `v0.1.0-beta.18-production-test.1` |
| 版本号 | `0.1.0-beta.18-production-test.1` |
| runtime | `mode=live`、`allowDeviceOperations=false` |
| AppID | 与仓库既有配置一致，上传时工具回显一致（完整值不记录） |
| 云环境 | 与仓库既有配置一致，远端环境列表只读核对一致（完整值不记录） |
| 构建 ZIP | `SMART-PM-v0.1.0-beta.18-production-test.1.zip` |
| ZIP 字节数 | 9,489,378 |
| ZIP SHA-256 | `d9f0c8526b69d62c9fa7adb52439e78dbfa5225430274f6ac8c923b4800143a9` |
| 上传包大小 | 883.4 KiB / 904,594 Byte（工具回显） |
| 微信开发者工具 | 2.02.2611042（Nightly） |
| 报告分支 | `release/miniprogram-beta18-experience-report`（基于 6e18d04） |

发布包由 `git archive HEAD` 生成，未包含 node_modules、dist、.env、凭据或登录信息；ZIP、SHA256SUMS 等产物仅保留在本地 `dist/`，未提交 Git。

## 2. 本地预检（§2）

预检在独立干净工作区（detached worktree @ 6e18d04）执行；该工作区以 `core.autocrlf=false` 检出，避免 Windows 全局 CRLF 转换导致 provenance 哈希假阳性。

| # | 检查 | 结果 |
| --- | --- | --- |
| 1 | HEAD = 6e18d04、分支与标签一致 | 通过 |
| 2 | `git status --porcelain` 为空 | 通过（打包前清理了 npm 安装生成的 21 个未跟踪 lock 文件后为 0） |
| 3 | package.json / miniprogram/config/version.json 版本 | 均为 `0.1.0-beta.18-production-test.1` |
| 4 | runtime 模式与设备开关 | `live` + `allowDeviceOperations=false` |
| 5-1 | `npm test` | 51/51 通过 |
| 5-2 | `npm run check` | 通过（9 页、自定义 tabBar、handlers、JSON/JS 语法、资产引用） |
| 5-3 | `npm run verify:backend` | 通过：61 个后端文件哈希、24 个云函数依赖加载、318 项资产 |
| 5-4 | `npm run release:live` | 通过，产出 ZIP + SHA256SUMS + test-report.txt + release-manifest.json；归档内 `npm test` / `check` / `test:admin` 全过（test:admin 54/54） |
| 6 | 解压生成包到另一独立目录复跑 | 通过：npm test 51/51、npm run check、npm run test:admin 54/54；ZIP SHA-256 复算一致 |
| 7 | 记录 ZIP 文件名/字节数/SHA-256 | 见 §1 |

**过程中的两个环境级障碍（均已绕过，未修改发布基线文件）：**

1. `core.autocrlf=true` 使检出文件 LF→CRLF，导致 `verify-import.mjs` 哈希断言失败；用 `git cat-file blob` 裁决确认 blob 与 provenance 完全一致，属假阳性；以 `autocrlf=false` 重建工作区后通过。
2. `scripts/install-backend.mjs` 与 `scripts/package-release.py` 在 Windows 下 `spawn('npm')` / `subprocess.run(['npm', ...])` 找不到 `npm.cmd`（脚本为云端 Linux 编写）。处理：依赖由 bash 逐目录 `npm install` 安装（24/24 成功），打包时通过单次 `PYTHONPATH` 注入 `sitecustomize.py` 把 `npm` 透明替换为 `node npm-cli.js`；**未改动仓库任何脚本、配置或发布输入**。

## 3. 微信开发者工具预检与编译（§3）

| # | 项 | 结果 |
| --- | --- | --- |
| 1 | 导入本次生成并校验过的解压目录 | 通过（`cli open`，使用 release:live ZIP 解压目录） |
| 2 | 项目 AppID 与目标小程序一致 | 通过（工具回显 `Using AppID`，与仓库既有配置一致） |
| 3 | 选择既有目标云环境 | 通过（`cli cloud env list`，远端仅列出仓库所配置的那个环境） |
| 4 | 平台已上传/体验版本回退依据 | **未能由 CLI 查询**（工具无查询接口），详见 §8 未关闭问题 1 |
| 5 | 编译无 WXML/JS/依赖/云环境初始化错误 | 通过：`cli preview` 编译成功（883.4 KiB），随后 `cli upload` 再编译成功；IDE 日志中 `[ERROR]` 行均为 backend ReactiveCache 诊断输出，非编译错误 |
| 6 | Network/控制台无未知域名、凭据、真实设备写请求 | 静态核对通过：小程序源码无硬编码外部 http(s) 域名；`allowDeviceOperations=false` 且 `services/api.js` 对真实开门有硬阻断；编译/上传期 IDE 日志无未知域名或设备写请求记录。**实时 Network 面板未能程序化采集**，见 §8 未关闭问题 4 |
| 7 | 不执行 dbInit/contentInit/chatInit/syncDevices | 通过：本任务未调用、未部署任何数据库初始化/迁移函数；源码中亦无这些函数的客户端调用 |

前置环境修复（与本任务包内容无关，仅工具链）：微信开发者工具服务端口此前处于关闭状态。通过官方启动参数 `--enable-service-port` 重启 IDE 后，由 IDE 自身持久化 `security.enableServicePort=true`、写入 `.ide-status=On` 并监听 CLI 服务端口；`cli islogin` 返回 `{"login":true}`。此前直接改写 settings JSON 的方案会被运行中的 IDE 内存态覆盖，已弃用。启动 Electron 应用时另需清除会话注入的 `ELECTRON_RUN_AS_NODE`。

## 4. 云函数边界（§4）

只读核对方式：`cli cloud functions list --env <目标环境>`（不部署、不下载、不覆盖）。

- 远端返回 24 个云函数，与标签内 24 个目录一一对应。
- 任务卡点名的 8 个函数 `contentList / getHouses / phoneLogin / messageList / messageRead / messageSend / getDevices / unlockRecords` **全部存在**。
- **实际变更：无**。未整批覆盖、未部署任何函数；`getHouses` 未更新（本次不触发公共用房过滤的远端改动，因此无需导出远端版本与云函数回退点）；未部署人脸、海康、门禁写或数据库初始化函数。

## 5. 体验版上传（§5）

```
cli upload --project <release ZIP 解压目录> \
  -v 0.1.0-beta.18-production-test.1 \
  -d "生产环境受控测试版；真实设备操作关闭；不含未完成的人脸门禁集成。"
```

| 项 | 值 |
| --- | --- |
| 上传结果 | 成功（`√ upload`） |
| 版本号 | `0.1.0-beta.18-production-test.1` |
| 本地上传时间 | 2026-11-14 17:45 +0800 |
| 平台显示版本号/上传时间 | 待平台侧确认（CLI 的 `--info-output` 仅回传包大小），见 §8 未关闭问题 3 |
| 执行人 | Workburry（发布 AI，使用既有授权登录会话） |
| 构建 ZIP SHA-256 | `d9f0c8526b69d62c9fa7adb52439e78dbfa5225430274f6ac8c923b4800143a9` |
| 微信开发者工具版本 | 2.02.2611042 |
| 云函数改动 | 无 |

未提交审核、未发布正式版、未扩大体验成员范围、未移动或改写标签、未合并 main。

## 6. 体验版冒烟测试矩阵（§6）

**说明：** 以下 8 项 UI 冒烟须由授权测试账号在体验版中实际执行；本次自动化侧仅完成编译、上传与代码级/单元级证据采集，**未以任何方式伪造通过**。代码级证据来自冻结基线自带的测试套件（51/51）与静态检查，不能替代真机 UI 冒烟。

| # | 冒烟项 | 代码级/单元级证据 | 体验版 UI 冒烟 |
| --- | --- | --- | --- |
| 1 | 启动、首页和导航 | `npm run check` 覆盖 9 页、tabBar、路由引用；preview 编译成功 | 未执行（待授权测试账号） |
| 2 | 手机号授权取消/成功/退出 | 用例：取消不调用后端、抑制重复、认证与退出、后端拒绝可重试 | 未执行（待授权测试账号） |
| 3 | 内容与房源列表、详情、空态 | 用例：demo 读流程零云调用、缺失房源保持缺失、租房筛选 | 未执行（待授权测试账号） |
| 4 | 消息列表、读取、测试会话内发送 | 用例：标记已读不改原数据、失败发送显式呈现 | 未执行（待授权测试账号） |
| 5 | 我的页面 | 静态检查覆盖页面与 handler | 未执行（待授权测试账号） |
| 6 | 开门页仅读允许设备与自己记录 | 用例：live 设备列表走权限过滤的 getDevices | 未执行（待授权测试账号） |
| 7 | 点击开门不发设备命令，显示关闭/拒绝 | `allowDeviceOperations=false` + api.js 硬阻断 + 用例「unlock 需显式 opt-in 与登录、仅发 deviceId、抑制重复」「demo 写不能开门」 | 未执行（待授权测试账号） |
| 8 | 云失败不得回退为演示成功 | 用例：live cloud failures never silently fall back to demo | 未执行（待授权测试账号） |

未使用真实住户资料、真实人脸、生产门锁；未记录任何脱敏错误码（因未发生失败）。

## 7. 停止条件与回退点（§7）

**停止条件检查：** 版本/提交/AppID/云环境一致；`allowDeviceOperations=false`；编译与预检全部通过；无数据库初始化/迁移；无未知云函数、未知域名或真实设备写请求；未出现登录/组织隔离/公共用房过滤/消息权限异常的证据；平台未要求覆盖无法确认来源的远端云函数。**未触发任何停止条件。**

**回退点：**

1. **代码/构建锚点**：冻结提交 `6e18d04`、标签 `v0.1.0-beta.18-production-test.1`、ZIP SHA-256 `d9f0c852…43a9`；可用同一 ZIP 解压目录重新编译上传。
2. **体验版入口**：在小程序平台「版本管理」将体验版重新指定为本次上传前的版本（该版本号与时间需人工读取并补录，见 §8 未关闭问题 1）；异常时撤回本次体验入口。
3. **云函数**：本次零变更，无需回退；未产生需要恢复的远端版本。
4. **设备/数据**：设备写开关从未开启，数据库零初始化/迁移，无回退动作。

禁止且未采用的掩盖手段：打开设备写开关、切 demo、修改线上数据。

## 8. 未关闭问题

1. **平台既有体验版本号/上传时间未能程序化读取**：微信开发者工具 CLI 无查询平台版本列表的接口，`--info-output` 仅返回包大小；本地 IDE 缓存中的历史版本记录仅为本地项目列表，不能作为平台回退依据。需平台侧人工补录，作为回退点 2 的完整锚点。
2. **§6 八项真机 UI 冒烟未执行**：需授权测试账号与脱敏测试数据；本报告只给出代码级证据，不宣称通过。
3. **平台显示的版本号与上传时间待确认**：本地上传命令与包大小回显成功，平台侧版本列表需人工核对。
4. **实时 Network/Console 面板未程序化采集**：已用静态检查与 IDE 日志核对替代，未发现未知域名、凭据或设备写请求；建议真机冒烟时同步复核。
5. **本任务范围内不包含**：H2-c、人脸管理后台、Hikvision Provider、设备写能力、真实人脸录入、海康设备连接、线上数据迁移。

> 结论表述边界：本任务完成的是**体验版上传**，不是生产正式上线；未提交审核，未发布公开版本。

## 9. 回报模板（§10 对照）

```text
任务：REL-AI-01 微信小程序体验版上线协助
负责人：Workburry
发布基线：6e18d04 / v0.1.0-beta.18-production-test.1
本地测试与打包：npm test 51/51、check、verify:backend、release:live 全通过；解压目录复跑通过
ZIP/SHA-256：SMART-PM-v0.1.0-beta.18-production-test.1.zip / d9f0c8526b69d62c9fa7adb52439e78dbfa5225430274f6ac8c923b4800143a9
开发者工具编译：2.02.2611042，preview 与 upload 均成功，883.4 KiB，无编译错误
体验版上传：成功，0.1.0-beta.18-production-test.1，2026-11-14 17:45 +0800
云函数变更：无（只读核对 24 个，点名 8 个全部存在）
冒烟测试：8 项 UI 冒烟未执行（待授权测试账号）；代码级/单元级证据已记录
真实设备/人脸/数据库迁移：0 / 0 / 0
回退点：冻结提交+标签+ZIP SHA-256；平台体验版重新指定（既有版本号待人工补录）；云函数零变更
报告分支/提交：release/miniprogram-beta18-experience-report
阻断：无（§8 列出 5 项未关闭问题）
```
