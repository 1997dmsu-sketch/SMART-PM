# 签约租期海康远程开门：独立复审退修

日期：2026-11-27，Asia/Shanghai。固定修复前对象 `66e0395c105cda21244d375ef6d01682bc6cfe1e`。本轮只修独立B/C报告的5项，不解除真实执行冻结；旧对象与交付容器保持原字节。

## 原报告与结论

| 路线 | 报告结论 | 原报告字节 / SHA-256 |
|---|---|---|
| A：身份与云事务 | 静态PASS，无实质发现 | 13308 / cf7da38d802f809c4043a732bc0e92d7e08f74fa312fd49ac55434c234b78a50 |
| B：传输与worker | NEEDS_REVISION，2 P1、2 P2 | 12787 / f781577135bdb63e90a4a97ec072c68410268591a18b8818cfa29b122db93f93 |
| C：小程序与后台 | NEEDS_REVISION，1 P3 | 10256 / 5995974e915c46f88cb2a2b26028e4f1dcc8362b5fc42d64d7d6078af75190e9 |

原报告保存在主Codex工件目录 `signed-remote-dispatch-2026-11-27/{A,B,C}/REVIEW.md`。A不因B/C退修而重开；修复未修改其云服务、身份helper、后台路由或签约资格业务。

## 修正内容

- **B-01 / P1**：此前只在pin回调和request.end前核时，真实Node的异步socket交接可能在之后才flush。现在在request的socket事件（flush前）及最终应用层socket.write分别核对同一截止；过期销毁request/socket，不把同步假transport当作异步边界的证据。
- **B-02 / P1**：此前Date.now回退可延长401重发剩余预算。现在claim首次校验时锚定单调时钟预算，贯穿公开证书读取、型号GET、fresh begin和client；每次取epoch剩余与原monotonic剩余的较小值，初发、401、TLS、socket交接和最终write均不能重建更长预算。未传absoluteDeadline的旧调用仍保留原行为。
- **B-03 / P2**：自定义JSON reader及通用trim曾接受或擦除非JSON空白。现在语法空白只接受SP/HTAB/CR/LF，保留原文本供严格语法验证；非法Unicode首尾/内部空白失败关闭。XML语法同样不擦除非法边界。
- **B-04 / P2**：正则隐式转换曾让数组拒绝码穿透。parser只接受明确数值或字符串标量，再归一成闭合字符串；worker独立检查string/null类型，不受支持值只报告一次合法unknown，不形成数组payload。
- **C-01 / P3**：旧账号回调曾调用通用隐私清理，取消新账号当前操作。现在私密视图记录epoch所有者，已由有效新账号接管时仅丢弃旧回调；logout或视图仍属失效旧账号时继续清隐私。load在loading早退前清旧owner，异步登录核对后才接管；既有modal owner token、query序号和同epoch hide/show继续保留。

应用层最后写入检查不承诺撤回已经交给TLS/内核的字节，也不承诺设备收到或物理动作发生在同一毫秒；初始云/工作机时钟可信度和现场网络/证书/设备仍需真实环境核实。

## 修复方限定证据

下表是修复方定向实测，不能称为独立复验或修订版全量通过。

| 范围 | 红控 | 修复后 |
|---|---|---|
| B发送边界 | 原10项4 pass / 6 fail，exit1 | 11/11，文件内fake与预载guard两方式各exit0 |
| B解析及worker预算 | 原25项22 pass / 3 fail；加入时钟用例后26项22 pass / 4 fail，exit1 | 26/26，两方式各exit0 |
| C旧登录回调 | 原30项20 pass / 10 fail；接管边界32项30 pass / 2 fail，exit1 | 32/32，exit0 |

原输出在主Codex工件目录 `signed-remote-remediation-2026-11-27/{B,C}`。一次父runner预载fake因Node自身spawn bootstrap不兼容终止于exit143，业务前失败；原日志保留，不将其改成测试通过或产品回归。后续两种正确安全装配结果分别保留，不修改冻结guard。

独立复验和最终解压源码组合回归结果以新的固定对象、原始日志和交付清单另行记录，不沿用旧610替代。旧610/610与归档6/6仍只是66e0395的历史证据。

## 未改变的边界

签约确认自动取得本人/房屋/租期资格，无额外门禁申请；人脸后补，注册不授权；押金与第三方支付不上线。本轮没有部署、上传体验版、真实云读写、设备/照片/支付、真实TLS/监听、worker执行、主机时钟修改或全局Git/TLS/ACL修改。小程序两项真实功能开关均保持false。CR-2、D/E、EOF、WP06和其它冻结线不重开。

本地Harness部署准备派单 `hrun-mwy0lzpx-b32c39` 已由负责人回报completed，三份Windows报告在当前云端仍待可读取原件；完成状态和旧候选包核验不等于主Codex内容复核或部署批准。
