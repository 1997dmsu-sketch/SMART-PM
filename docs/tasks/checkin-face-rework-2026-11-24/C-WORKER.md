# C：worker 设备绑定、授权新鲜度、依赖和照片

先读 README、COMMON 和固定复审全文。本路负责 R05–R09，和 A 对齐执行前复核；文件归属按 COMMON。

## 必做

1. 任务与本地 deviceKey 都非空且精确相等；缺任一或不同立即拒绝，不进入执行器。型号/可信证书/门号/租期/全天计划校验独立保留，禁止 developmentTls 绕过材料。
2. claim 后下载/准备完成，进入设备执行前校验 claim 时间并调用 A 的权威复核，严格绑定 task/claim/revision/worker 和返回的当前快照；超时/过期/撤权/不一致/云不可用均零执行。不能只靠最终 report 判断失效；不得因未知结果自动换号、重领或重试。
3. 默认 `@cloudbase/node-sdk` 依赖在 tools 安装/解析边界可复现。优先 worker 自己的 package/lock 与清晰安装说明，或证实可行的显式解析边界；不依赖偶然根 node_modules/NODE_PATH。新增依赖必须锁定并有无凭据的默认解析/装配证据，不能测试时一直注入 factory。
4. 优先避免把照片另存到未经验证的 Windows 临时区。已静态确认：旧 `runFaceEnrollment` 命令入口要求 `photoPath`，并没有 `photoBase64` 公开入参；业务 `FaceEnrollmentService.enroll` 才接受内存照片。不得用假路径、任意替换 readInputFile 或重命名参数伪装成现成命令内存能力。若新增 worker 专用业务服务适配层，放本路目录，不改旧三个核心模块或 PS 启动器；必须保留旧装配中的型号/唯一库/门号/fixed起止/全天计划及执行前指纹核验、安全输出和未知结果语义，并交 Codex 内容复审。若确需落盘，建立可证明的私有 Windows 能力并失败关闭，不将0700/0600当DACL。
5. 清理结果纳入真实终态，不把残留当成功；保留已发生的设备事实，不能清理失败就重发设备。若内存方案消除了文件，测试应证明不产生该文件和不误报清理结果。不要承诺内存/磁盘安全擦除效果。

## 验证

- 缺/空/不同/正确 deviceKey；已过期和下载中到期 claim；准备后撤权/改租期/改绑定；复核不可用；同一未失效快照正例。
- 用计数的假设备执行器逐场景证明前置拒绝为0次，合法路径恰好1次；云错误、重复 report 和未知事实不触发第二次登记。
- 默认依赖路径无凭据解析；照片路径使用合成字节，不读真实照片、配置或证书；落盘方案若无实际Windows保护证据必须记阻断。
- 保留 mode=device、validityMode=fixed、租期边界、24x7和PENDING_SITE_VERIFICATION；不能用旧simulation默认冒充真实请求正确。

本轮只能合成执行，禁止真实 CLI、云/设备调用。完成后交 lead，不 stage/commit/push、不自批。
