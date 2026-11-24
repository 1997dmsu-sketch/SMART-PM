# 四路共同约束与集成接口

任务键：`CHECKIN-FACE-REWORK-0d6c674`。共同基线、固定复审和派单纪律见 README。用户授权的是此次退修；任何 worker 的自审通过不等于 Codex 验收。

## 产品规则保持

- 房号 102，只绑定负责人指定的唯一稳定项目/楼栋/房源/设备/门号，不按显示房号取任意第一条。
- 租期由负责人上线准备时手填，按租期起止、每天 24 小时通行；不得生成默认日期、24 小时总期限或 unlimited。
- 自动通过仅测试白名单主入住人。非名单走既有审核渠道，不能宣称已提交人工审核单或开放人脸入口。
- 上传本人照片和收到云回报均不等于现场刷脸通过；成功保留 `PENDING_SITE_VERIFICATION`。
- 旧公开版本/派发配置能力与相同版本正则保留；旧输入 P2 与 246 项结论不重开，EOF 不冒称已覆盖。

## 文件归属（worker 只编辑本路）

| 路线 | 可编辑范围 |
|---|---|
| A | `cloudfunctions/checkinFaceTest/`；`tests/checkin-face-cloud-workflow.test.cjs`；仅为此次可信上传配置/事务契约所必需的 `admin-web/lib/checkin-face-test-config.mjs`、该配置页脚本/HTML、`admin-web/server.mjs` 对应测试配置路由及 `admin-web/tests/checkin-face-config.test.mjs`。不可改其他 HTTP 业务入口。 |
| B | `miniprogram/pages/checkin/`、`miniprogram/pages/face-enroll/`、`miniprogram/services/api.js`；`tests/checkin-face-api.test.cjs`、`tests/checkin-face-pages.test.cjs`。 |
| C | `tools/checkin-face-worker/`（可新增其独立 package/lock、适配模块）；`admin-web/tests/checkin-face-worker.test.mjs`。 |
| D | `scripts/checkin-face-static-check.mjs`；新增专用来源校验脚本与合成贯穿测试；根 `package.json` 仅发布检查入口；`docs/checkin-face-experience-source-hashes.json`（仅集成冻结后更新）；新增本次测试证据。 |

lead 独占任务工作日志、退修交付报告和 Git 元数据。跨路修改先移交文件归属，不能同时写同一文件。原有统一登记的三个业务核心模块、PowerShell 启动器、旧验收/日志/引用保持原字节；如发现必须改旧核心，先提交最小技术缺口，不能擅自扩大。

## 两个必须先对齐的接口

1. **上传契约**：小程序原样传递 `wx.cloud.uploadFile` 的实际 `fileID`。服务端可信配置给出云存储命名空间与服务端下发的对象前缀；创建任务后持久保存验证过的真实 fileID 及规范对象路径，worker 下载使用同一真实 fileID。归属校验不能靠客户端自报 owner/environment 或字符串去头。A 先明确命名空间配置与核验方式、拒绝类别和兼容边界，B/C/D 使用同一契约；没有经实际 SDK/存储规则支持的“owner 查询接口”不能虚构。
2. **执行前复核契约（Codex 技术裁定 v1，尚未实现）**：采用一次性开始执行语义，新增 worker 鉴权动作 `beginTaskExecution`。请求字段为 `action/workerToken/workerId/taskId/claimId/revision`，不接收客户端自报“已批准”或新目标。claim 后、下载/准备完成、进入设备执行前，A 在真实事务内重新核验 claim 未过期、worker 一致、当前申请/名单/开关/房间/租期及设备绑定；只有 `CLAIMED` 且匹配当前 claim/revision 才原子推进到 `DEVICE_PROCESSING`，revision 恰好加一。成功仍用现有 `{code:0,data,msg}` 包装，`data={task,authorizedAt}`：task 为权威任务快照（含推进后的 revision、原 claimExpiresAt、fileId、employeeNo、deviceKey、门号、租期、计划指纹及配置/房间/租约关联版本）；authorizedAt 为服务端整数毫秒。

   C 必须验证该 task 与已领取/实际下载对象的全部业务字段一致，只接受预期状态推进、revision+1 和明确时间事实，不把新的租期或目标覆盖进旧任务继续执行；后续 report 使用推进后 revision。成功不延长原 claim/租期，服务端 `now >= claimExpiresAt` 即拒绝为已过期；本地时间/字段无效时失败关闭。重复开始、旧 revision、已过期、失效或回执未知不得再次返回可执行授权；失败/未收到有效答复零设备执行，不自动重领/续期/重试开始。错误沿用现有失败包装，A/C 将具体闭式错误分类补入同一接口清单，不能把非零码、缺字段或仅回显误当授权。

   所有业务写入前仍检查当前执行上下文及时限；发生超时则停止新请求，已发生或未知设备事实保留。云事务与硬件请求之间仍有窗口，不承诺跨系统原子撤销。接口白名单、类型验证、任务状态/超时处理、report 的新 revision 及丢失开始回执场景必须一起接通；只实现前端调用名不算完成。此技术裁定不是对现有代码或任何实际 SDK 能力的验收。

接口未就绪时，B 可先修组件/普通账号反馈，C 可先修绑定/依赖/照片，D 可先修 checker/来源校验；相关贯穿断言保持待集成，不记通过。

## 运行与证据

- 仅合成 fixture、假云与假登记执行器。不得执行真实 worker CLI、读取真实本地配置/凭据、连接设备、开放监听、上传体验版、部署云服务、支付/开门或 E1/E2。
- 聚焦运行现有五文件及本次新增不监听测试；不以后台全量重跑夹带监听套件。针对新导入闭包在业务模块加载前安装不转发网络 guard，并证明自检和子进程继承；如默认测试隔离不可用，原始错误与降级证据分列，不伪报默认隔离通过。
- 每个拒绝场景保存 before/after 全库快照；并发测试用可控调度验证真实交错，不只顺序重放。请求输入、输出、状态、revision、审计、设备调用计数共同断言。
- 负控仅在本次新建、明确列名的自有副本上进行；禁用对应修复应命中具体断言。不得批量删除目录、清理旧证据，或把语法/依赖失败当成契约反证。
- 新增证据必须有实际日期、环境/Node、原始命令、退出码、计数、字节/哈希和未验证项。不把 SDK 形状的合成数据说成微信真机/CloudBase 实测；不把 mode0600 说成 Windows 私密 ACL。
- 来源清单在所有路停止编辑后统一更新；D 的机器校验须实际执行。旧来源登记不伪造 originalSha256。
- 仅追加提交与普通显式 refspec 推送；不 amend/rebase/reset/squash/force/merge/cherry-pick，不推 main，不改全局/系统 Git、TLS、代理或安全配置。

所有路提交“完成/阻断”的真实回报，lead 统一交 Codex；禁止自行批准、部署或进入现场操作。
