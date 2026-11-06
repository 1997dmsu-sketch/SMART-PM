# HK-AI-04 共享权限复审与 K1/FileService 裁定（2026-11-06）

## `9bb91f9` 复审结论

**通过。** 提交只修改 `admin-web/lib/org.mjs` 并新增权限测试；`device.access.manage`、`device.audit.read`、`device.operation.retry`、`device.operation.reconcile` 可通过 `OrgService.grantMembership()` 正式授予，未批准的 `device.face.manage` 仍被拒绝。

- `admin-web`：264/264通过
- 根测试：51/51通过
- 未修改 files/server，未连接设备或网络
- 文件开头新增 BOM 建议后续顺手移除，不阻断本提交

本结论不表示 `d2a994a` 服务层通过；`0d893eb` 的生产代码阻断继续有效。

## 裁定一：设备 claim HMAC-K1

### 配置

- `DEVICE_CLAIM_HMAC_KEY_B64`：标准 Base64 编码的32字节随机密钥；解码后必须恰好32字节。
- `DEVICE_CLAIM_KEY_VERSION`：大于等于1的整数。
- `DEVICE_DIGEST_REALM`：3–64位小写字母、数字和连字符，正则 `[a-z0-9][a-z0-9-]{2,63}`。

建议 realm：`smart-pm-test-local`、`smart-pm-demo-local`、`smart-pm-live-<deployment>`。realm 标识部署域，不含 orgId；不同部署不得复用 realm+key。live 三项缺失、格式错误或密钥不足均 `NOT_CONFIGURED`/503并零业务写入。demo/test 只能显式注入测试配置，不得读取或复用 live 密钥。密钥、完整指纹和原始设备标识不得写 Git、日志或普通 DTO。

### 规范化与算法

设备唯一标识使用厂商可信来源的完整序列号，不使用 IP、MAC、型号或用户可编辑名称。规范化：字符串 NFKC → trim → ASCII 大写；最终必须匹配 `[A-Z0-9._:-]{1,128}`，否则拒绝。

摘要消息固定为：

```js
JSON.stringify([
  "KEYED_DIGEST/device",
  "v1",
  "hikvision",
  digestRealm,
  keyVersion,
  normalizedDeviceIdentifier
])
```

使用 `HMAC-SHA256`，输出小写64位 hex。claim ID：

```text
provider-device:hikvision:{digestRealm}:{digestHex}
```

claim 记录保存 `provider/digestRealm/digestDomain="KEYED_DIGEST/device"/keyVersion/ownerOrgId/revision`，不保存序列号明文。序列号如需展示，只能在受限 `access_devices` 记录中加密保存。

### 配置变化保护

新增受限配置守卫 `device_digest_domains`：固定 ID `device-digest-domain:{digestRealm}`，保存 keyVersion 和不可逆 keyFingerprint。首次空域可初始化；同 realm 发现版本或密钥指纹变化时返回 `DEVICE_DIGEST_CONFIG_CHANGED`/503，零业务写入。不得因换密钥计算出新 claim 后把同一设备静默登记第二次。受控轮换另行开卡。

K1 只用于设备 claim。operation key 的 HMAC-K2 必须使用独立配置/密钥域，不能复用 K1；K2 在 operation key 重构提交前单独冻结。

## 裁定二：允许新增 FileService 引用校验接口

允许在 `files.mjs` 增加正式的“验证引用但不返回字节”能力，必须单独提交、单独测试。采用 prepare + 事务内复核模式，避免预读后文件或权限变化：

```js
const token = await fileService.prepareReference(fileId, {
  purpose: "face-biometric",
  permission: "device.face.submit"
});

// FaceCredentialService 将 token.refs 加入自己的 store.transact refs，
// 并在事务 build 内调用：
const file = fileService.assertReference(state, token);
```

要求：

1. prepare 只形成快照/token，不返回 bytes、URL、objectKey、checksum或存储定位符。
2. assertReference 在同一业务事务中复查 org、file revision、ready、private、purpose、MIME、大小和当前 membership 权限。
3. 提交引用使用 `device.face.submit`，不要求 `device.face.readPrivate`；引用校验不等于读取原图。
4. 只有实际下载/读取图片字节时才走 `authorizeDownload` 和 `device.face.readPrivate` 并写读取审计。
5. 文件不存在、跨组织、非 ready、错误 purpose 或权限不足均同态 `FILE_NOT_FOUND`/404；不得泄露差异。
6. Face credential 提交事务本身记录提交审计和 sourceFileId；引用校验不伪造“已下载”审计。

必测：有 submit 无 readPrivate 可引用；无 submit 拒绝；prepare 后撤权/文件 revision 变化导致事务失败关闭；跨组织/错误用途/非 ready 拒绝；返回对象无字节/URL/摘要/locator；存储 adapter 的 read/tempUrl 调用次数为0。

## 后续顺序

1. 单独提交 FileService 引用校验与测试。
2. 单独提交 K1 配置、domain guard、设备 claim/slot 固定键与测试。
3. 重构服务层资格、pending grant、租约/日志、幂等与撤权闭环。
4. 补齐完整测试后复审。

HTTP、阶段3、真实 Provider、设备连接和生产写接口继续关闭。
