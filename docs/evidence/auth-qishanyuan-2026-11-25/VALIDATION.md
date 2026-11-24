# 集成验证记录

执行日期：2026-11-25（Asia/Shanghai）；代码起点72fe242556aea604473281dc52b45837155fa43a。

最终候选按打包器`checkin-face-offline`同一文件范围执行：全部根`tests/*.test.cjs`，原checkin配置/worker两套，新增租客后台、真实handler注入、本地事务及栖山苑初始化四套，以及原worker三套。业务加载前预载`tests/support/d-network-guard.cjs`，默认Node测试隔离。真实HTTP server factory被测试注入的本地对象替代，不创建HTTP对象，不监听或发起请求。

- Node合计327 tests /327 pass /0 fail /0 cancelled /0 skipped /0 todo，exit0。
- `python scripts/test-package-release.py`：6/6，exit0。重复ZIP项警告来自刻意的负例。
- 静态检查181份源码，0违规；小程序结构检查12页通过。仅静态语法/资源/处理器核验，不等同微信开发者工具编译。
- 新增/变更JS语法检查通过；旧引入后端61/61指纹与四项有据patch登记吻合。没有执行依赖安装或完整`verify-import`的SDK加载部分。
- 同版四份身份协调器逐字节相同；源清单和闭包校验通过（实际登记数以随包manifest及校验器输出为准）。

真实LocalStore临时目录测试验证整事务单次持久化、共享既有写队列、失败与不可克隆回执的全库/磁盘零变化、已关闭句柄拒绝、create-only冲突，以及实际开通码→管理员创建→相同userId密码登录→重置旧密码失效。真实server handler注入测试验证session、Origin、CSRF、管理员角色与当前revision门禁；数据库初始化内部哨兵不会进入HTTP响应。

页面VM消费实际API与唯一基准源，验证232间公开单间、首层10间所有ID/房号别名均拒绝、待配置不伪造价格单位、禁预约及关闭预设后不复活旧缓存。隔离本地初始化测试验证242间、未知/半初始化拒覆盖、旧demo/live不改、合法重启不重复和并发create-only。

独立交叉复核发现的三项P2均已修正并回归：服务端/前端资料长度边界一致；本地事务克隆回执在提交前完成；数据库装配纳入租客路由脱敏边界。其他副本反证已保留在本次外部artifacts：缺失DTO/离页清理、限速额度/开户码截止/重置revision防护被禁用时，相应用例按预期失败。正式候选未使用这些反向修改。

本记录不声明微信平台上传、实际云事务、私有集合权限部署、实际账号开通、设备人脸登记或开门成功。旧版本包与旧输入P2/EOF边界保持原记录。新ZIP将在干净提交的导出树上重跑同一打包profile；ZIP哈希和该次结果记录在独立交付索引，不在此预填。
