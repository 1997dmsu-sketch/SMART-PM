# LOCK-01A 第一轮审查：需返工

审查对象：`docs/lock-01-hikvision-face` 提交 `831d49e`，PR #7。  
范围：海康 `DS-K1T671BM` 能力调研、风险清单、Provider 契约和数据结构。  
结论：文档框架和业务隔离方向可用，但厂商事实证据、厂商残留字段及云数据库唯一性方案存在阻塞问题。暂不进入 LOCK-01B，不实现真实适配器，不连接设备。

## F01 [P1] 通用系列/接口资料被写成已确认能力，不能证明目标型号可用

位置：`HIKVISION-DS-K1T671BM-CAPABILITY.md:11-14,23-40,47-50,61-65`。

报告明确承认没有取得 `DS-K1T671BM` 精确规格页、固件版本和对应 ISAPI 指南，却同时把以下内容标为“已确认”：整个系列支持人脸、指纹、卡、掌静脉、虹膜、蓝牙/QR/NFC；FDLib 端点可完成新增/删除/修改/查询；设备侧 ISAPI 是优先路线。这些证据分别来自国际 `DS-K1T671` 系列页、通用 `ACS_USERFACE` 映射和通用 ISAPI/平台资料，适用范围没有绑定到国内 `BM` 子型号及目标固件。

其中 F3 声称“增删改查”，列出的端点却没有删除端点；`FDSearch/FDSetUp/blackFD` 语义也不能在缺少对应型号指南时直接等同于门禁人员人脸授权。F2 的多模态列表很可能包含系列/产品页中的其他能力，不能据此写入 `DS-K1T671BM` 能力矩阵。当前证据只能证明“海康生态存在这些协议或接口定义”，不能证明目标设备支持。

修复：把厂商事实分成“生态/系列存在”和“DS-K1T671BM+固件已验证”两列。未取得精确型号资料前，所有具体认证方式、端点、HTTP(S)、摘要认证和推荐路线均保持候选/待确认。为每条已确认事实保存可复核证据：官方文档标题、版本、发布日期、适用型号/固件、原始 URL、关键章节/页码和文件 SHA-256（受限文档只记录元数据与摘要，不提交原文）。删除没有出处或与列举端点不一致的“删除/修改”等结论。LOCK-01A 只有在 Q1/Q3/Q4/Q5/Q6 中足以选定路线的项目关闭后才能通过。

## F02 [P1] 文档仍混入错误厂商枚举和无出处错误码

位置：`LOCK-01A-CONTRACT.md:40-50,72`，`LOCK-01A-DATA-DESIGN.md:6,34,106`。

数据设计使用 `provider="hikvision"`，契约和旧集合映射却写成 `hkvision`。这会在后续固定 ID、查询、迁移和适配器选择中形成两个厂商值。

错误映射又直接写入 `-4043` “未开远程”，没有海康官方来源、接口路线和固件适用范围。这种裸数字很像旧厂商/其他接口残留；在锁定海康路线前不能进入统一错误契约。

修复：全项目统一受控枚举 `hikvision`。删除 `-4043` 和任何未引用的厂商码；后续错误映射表必须包含接入路线、官方码、官方含义、文档版本、内部枚举和是否可重试。LOCK-01A 不应预设尚未取得的海康错误码。

## F03 [P1] 三项“唯一约束”无法按现有云数据库模型安全实现

位置：`LOCK-01A-DATA-DESIGN.md:13,18-23,35,45,76,85,141-143`。

- `providerDeviceKey(加密)` 被直接定义为唯一索引。随机化加密不能稳定查重；确定性加密会泄露相等关系，而且项目当前不依赖云数据库唯一索引。
- `device_access_grants` 定义“有效期内唯一”，属于条件唯一/时间区间约束，现有数据模型已明确不能假设数据库支持。
- `idempotencyKey` 写成全局唯一，未经组织、路由和操作主体作用域化；不同组织使用相同客户端键会产生不应有的冲突或拒绝服务。

修复：沿用 DB-02～DB-06 的固定 ID 占位协议。设备使用带密钥摘要生成 `provider-device` claim，敏感原值另行加密；授权使用 `orgId+personId+deviceId+cycleId` 固定 claim/slot，并明确结束、换租和并发重建时的释放/历史规则；幂等操作 ID 至少绑定 `orgId+route+actor/keyDigest`，同时保存 requestDigest，事务内重放或冲突。设计中列出固定 ID 输入、摘要域/密钥版本、guard/claim 集合和竞争测试，不把“唯一索引”当作实现机制。

## F04 [P2] Mock 默认启用缺少 demo/live 边界

位置：`LOCK-01A-CONTRACT.md:66-70`。

契约写 `MockFaceAccessProvider` 默认启用，但没有限定仅 demo/test。若后续按此实现，live 配置遗漏可能把设备下发伪装成模拟成功。虽然 Hikvision Provider 声明配置缺失时失败关闭，Provider 选择器本身仍缺少 live 约束。

修复：明确 `demo/test` 才能显式选择 mock；`live` 必须显式选择 `hikvision` 且配置完整，否则 `NOT_CONFIGURED`。任务、授权和报告持久化 `executionMode/provider/evidenceScope`，mock 结果永远不能把 grant 标为真实设备已生效。补 live 缺配置、错误选择 mock 和运行中切换 Provider 的拒绝用例。

## 其他核对结果

- 四份文档均未修改业务代码、生产配置或真实设备。
- 相对链接有效，`git show --check` 与 `git diff --check` 通过。
- 业务方向正确：稳定 `personId`、组织隔离、入住周期授权、退租先业务失效再异步撤权、人脸私密文件、审核与私密读取权限分离、任务租约和不可变日志均应保留。
- `face-biometric` 是 DB-07 待集成的新用途，目前尚未实现，不能在 LOCK-01A 文档通过后视为可用。
- 本轮为纯文档审查，没有运行设备、云端或小程序测试；也未验证任何真实海康凭据、固件或接口响应。

## 返工交付

1. 修正 F01 的证据分级和端点结论，补官方资料元数据/摘要；无法取得精确型号资料时诚实保持“路线未定”，不要把 LOCK-01A 标记完成。
2. 统一 `hikvision`，清除无出处 `-4043`。
3. 用固定 claim/slot/operation ID 重写唯一性与幂等设计。
4. 补 demo/test/live Provider 选择和失败关闭契约。
5. 提交新 head 后复审；暂不开始 LOCK-01B、申请生产密钥、上传真实人脸或连接 `DS-K1T671BM`。

## 第二轮复审：6a7eea9

结论：F01 的证据分级整改通过，F02、F04 已关闭；F03 的固定占位方向正确，但设备跨组织唯一性和操作幂等 ID 仍不安全，另有未知厂商错误自动重试风险。LOCK-01A 文档暂不批准进入 LOCK-01B。

### F01 整改通过，型号资料仍是外部前置条件

能力报告已明确区分“海康生态存在”与“`DS-K1T671BM` + 目标固件已验证”，后者为 0 条；通用 FDLib、事件和多模态资料不再被写成目标设备能力，路线保持未定，删除端点和 `blackFD` 语义也已纠正。页面抓取记录了 URL、日期、状态、字节和摘要。

这关闭了首审的错误外推问题，但不表示目标设备接口已经确认。Q1/Q3/Q4/Q5/Q6 仍未关闭，现阶段不能实现 `HikvisionFaceAccessProvider` 或进入真实联调。项目负责人仍需提供精确型号规格、固件版本和对应官方指南。

### F02 已关闭

四份文档统一使用 `provider="hikvision"`；`hkvision` 和无出处 `-4043` 已删除。错误码表在取得官方资料前保持为空。

### F03 [P1] 仍需返工：设备 claim 允许跨组织重复控制同一物理设备

位置：`LOCK-01A-DATA-DESIGN.md:22-34`。

设备固定 ID 为 `device_claim:{orgId}:{provider}:{HMAC(序列号)}`。由于包含 `orgId`，同一海康序列号可在组织 A、B 各生成一条不同 claim，两个租户都可能向同一物理门禁下发人员和撤权任务。这不是普通“组织内名称可复用”，而是物理控制端点所有权冲突。

修复：明确设备是否允许多组织共享。默认应使用全局固定占位，例如 `provider-device:{provider}:{digestRealm}:{HMAC(规范化设备标识)}`，claim 保存唯一 ownerOrgId；转移组织必须走受审计的解绑/迁移事务，存在有效 grant/job 时拒绝。若业务确需共享设备，应另建受控 `device_org_bindings`，由设备 owner 明确授权，不能靠重复登记实现。补 A/B 同序列号并发登记只允许一个 owner 的测试。

### F03 [P1] 仍需返工：op_id 公式没有客户端 idempotencyKey

位置：`LOCK-01A-CONTRACT.md:11-17,62-67`，`LOCK-01A-DATA-DESIGN.md:22-34,85-99`。

上下文声明了 `idempotencyKey`，但固定 ID 公式写成 `op_id:{orgId}:{route}:{actorKeyDigest}`。若 `actorKeyDigest` 只是操作者摘要，同一操作者在同一路由的第二次合法操作会永远命中第一次操作；若其含义是“actor/keyDigest”，文档也没有定义 keyDigest 的输入，无法安全实现。

修复：给出无歧义公式，例如 `op_id = claimId("device-operation", orgId + "|" + route + "|" + actorId, HMAC(idempotencyKey))`，并把 `requestDigest` 绑定规范化业务输入。明确 idempotencyKey 长度、字符、保存期限、过期后行为和 actor 类型；同键同请求重放、同键不同请求冲突，不同键必须允许新操作。固定 ID 本身只使用安全字符，不直接拼接未经约束的 orgId/route。

### F05 [P1] 未知厂商错误不应自动进入 RETRYABLE

位置：`LOCK-01A-CONTRACT.md:38-60`。

文档在官方码表为空时允许“未知即 `RETRYABLE` 或 `UNKNOWN_RESULT`”。对人脸新增/删除这类外部副作用，未知响应自动重试可能重复创建凭证，或在撤权已成功后反复调用。仅靠本地幂等键不能证明海康端幂等。

修复：未知厂商码、解析失败和发送后断连默认进入 `UNKNOWN_RESULT/awaiting_result`，先通过官方查询接口或人工对账解析；只有官方明确可重试、且已确认请求未执行或厂商支持幂等时才进入 `RETRYABLE`。把“连接前失败”和“可能已发送”分开，分别测试。

### F04 已关闭

Provider 选择已按 demo/test/live 明确：mock 只能在非生产显式选择，live 只能使用配置完整的 Hikvision Provider，缺配置失败关闭；记录持久化 executionMode/provider/evidenceScope，模拟结果不能标记真实设备生效。

### 第二轮核对

- 四份文档相对链接有效，`git show --check` 与 `git diff --check` 通过。
- 本轮仍为纯文档审查，没有连接设备、云环境或真实人脸数据。
- 可保留当前证据分级、Provider 模式边界、私密权限、退租立即失效和异步撤权设计。

返工只需修改设计文档并提供新 head；不要开始 LOCK-01B 或真实设备联调。

## 第三轮复审：369c4f5

结论：设备全局所有权和未知结果处理已通过；幂等键已进入 op_id，但公式遗漏 `actorType`，与文档自身的主体隔离要求不一致。修正这一处后可结束 LOCK-01A 的本地设计复审；目标型号资料仍是进入 LOCK-01B 的外部前置条件。

### 设备所有权整改通过

设备 claim 已改为不含 orgId 的全局 `provider-device` 固定占位，记录唯一 `ownerOrgId`；A/B 同序列号并发登记只允许一个 owner。跨组织转移要求审计，并在存在有效 grant 或未关闭 job 时拒绝；共享设备必须通过单独 binding，不能重复登记。该项关闭。

### 未知厂商结果整改通过

连接前明确未发送才可 `RETRYABLE`；发送后断连、超时、解析失败和未知官方码统一进入 `UNKNOWN_RESULT/awaiting_result`，先查询或人工对账，禁止自动重试。新增了录入和撤权对账后不得重复下发的测试要求。该项关闭。

### F06 [P1] op_id 仍遗漏 actorType

位置：`LOCK-01A-CONTRACT.md:10-17,68-75`，`LOCK-01A-DATA-DESIGN.md:22-36`。

上下文新增了 `actorType: user|system|agent`，说明也写“actorId 需带 actorType，避免不同主体摘要碰撞”；但实际公式仍为：

`claimId("device-operation", orgId + "|" + route + "|" + actorId, HMAC-K2(idempotencyKey))`

因此 user `abc` 与 system `abc` 在相同组织、路由和客户端键下仍生成同一 op_id。后提交的一方可能错误重放前者结果或得到冲突，审计主体也会混淆。

修复：公式的 scope 明确加入 actorType，例如 `orgId|route|actorType|actorId`；规范化 requestDigest 时也记录 actorType。补同 actorId、不同 actorType、相同 idempotencyKey 生成不同 op_id 且互不重放的测试。契约和数据设计必须使用完全相同的公式。

### 第三轮核对

- `hikvision` 枚举、Provider demo/live 边界、固定设备 claim、grant slot 和未知结果策略保持正确。
- `git show --check`、提交差异检查通过；本轮仍无业务代码、云端或设备操作。
- Q1/Q3/Q4/Q5/Q6 尚未关闭，`DS-K1T671BM` 精确能力为 0 条已验证；公式修复通过只代表本地设计可用，不授权开发真实 Hikvision Provider。
