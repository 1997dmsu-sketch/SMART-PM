# HK-AI-08 合成 TLS pin-before-send 门禁

本目录只实现完全品牌化的假 TLS／假 HTTP 接收端。运行时仅导入 `node:crypto` 和 `node:util`，只在内存中处理明确标记的合成输入，不读取真实配置、凭据、环境、文件、时间或网络。`allowRead` 必须是输入原值 `false`，不默认补齐、不改写为 `true`。现有 FAIL、NOT_EXECUTED 和其他证据均保留，不能用本模块替换或提升原结论。

这里真实执行的是 SHA-256 和 `timingSafeEqual`；握手、证书提供、过期标记与 HTTP 接收都是假对象的受控脚本。`rawCertificate` 仅是假 raw 字节，允许 `null` 或空数组表示缺失，不解析 X.509，也未实测证书有效期。`expired` 只是合成布尔／null；命中 pin 时 `true` 只作为 summary 告警，仍允许发送。pin-only 不检验 hostname／信任链，不回退到 CA／系统信任或无 pin 模式。

## API 和闭式输入

导出 `createSyntheticPinnedSendHarness(input)`，工厂输入必须精确为：

```js
{
  schemaVersion: 'hk-ai-08-synthetic-tls-pin-v1',
  dataClass: 'synthetic-only',
  allowRead: false,
  mode: 'fingerprint-pinned',
  fingerprints: [/* 1–2 个不重复的规范大写 64 位 SHA-256 十六进制字符串 */],
}
```

工厂无效输入只抛 `TypeError('SYNTHETIC_TLS_CONFIG_INVALID')`。输入仅接受普通或 null 原型记录、dense 普通数组；拒绝 Proxy（包括已撤销 Proxy）、访问器、Symbol、隐藏属性、未知键、稀疏数组、数组装饰、Buffer、TypedArray 和自定义原型。先检查描述符再读取值，不调用输入 getter、回调或强制转换。配置、请求规格和假证书字节均做私有防御复制与冻结；修改调用者输入不会改变后续门禁。

返回的 API 冻结，方法如下：

| 方法 | 输入与行为 | 正常结果额外字段 |
|---|---|---|
| `prepareRequest({endpointId, attempt})` | 精确两键，旧六端点 ID，attempt 仅 1／2 | `request` |
| `createFakePeer({rawCertificate, expired, outcome})` | 精确三键；raw 为 null 或最多 4096 个 0–255 整数的 dense 普通数组；expired 为 true／false／null；outcome 为 `success`／`tls-error` | `peer` |
| `releaseHandshake(peer)` | 同域句柄，只释放一次；可在 send 前 latch 或在 send 等待时释放 | 无 |
| `send(request, peer)` | Promise；同步消费本域两个句柄，再等待假握手、读取 raw、比 pin、在微任务边界复查终止状态、序列化并投递 HTTP | `summary` |
| `observePeer(peer)` | 只读冻结快照，不暴露 raw、pin 或 HTTP payload | `observation` |
| `cancelPeer(peer)` | 首次设置永久 `TLS_CANCELLED`、关闭并唤醒等待中的 send；先取消不连接 | 无 |

所有 operation 结果深冻结，共同包含 `scope: 'synthetic-tls-pin-before-send-only'`、`status: 'PASS' / 'FAIL'` 和固定 `code`。prepare／create／release／observe 正常为 `PASS/OK`；send 成功也为 `PASS/OK`。首次有效取消返回 `FAIL/TLS_CANCELLED`，表示该 peer 已进入失败终态。成功 send 也关闭假连接；之后取消为 `FAIL/PEER_CLOSED`，不修改之前的 PASS 快照。

`releaseHandshake` 的 `PASS/OK` 仅表示成功释放一次假握手门闩，不表示 TLS 成功。若该次释放触发脚本 `tls-error`，假连接立即关闭，等待中的 send 返回 `FAIL/TLS_HANDSHAKE_FAILED`。

request／peer 句柄为空的 null 原型冻结对象，仅本工厂私有 WeakMap 中的身份有效。伪造、复制、Proxy 包装或跨工厂句柄均无效。无效 prepare 返回 `INVALID_REQUEST` 与 `request:null`，无效 create 返回 `INVALID_PEER` 与 `peer:null`；无效 observe 返回 `INVALID_PEER` 与 `observation:null`。其余固定拒绝码为 `INVALID_REQUEST`、`INVALID_PEER`、`REQUEST_USED`、`PEER_USED`、`HANDSHAKE_ALREADY_RELEASED`、`PEER_CLOSED`、`INTERNAL_ERROR`。send 按无效 request、无效 peer、request 已使用、peer 已使用依次拒绝，不新增连接或字节；有效未使用的预取消 peer 返回 `TLS_CANCELLED`。重复 release 优先返回 `HANDSHAKE_ALREADY_RELEASED`。

## 固定 HTTP 与时序证据

| endpointId | GET 精确路径 |
|---|---|
| deviceInfo | `/ISAPI/System/deviceInfo` |
| acsCapabilities | `/ISAPI/AccessControl/capabilities` |
| userInfoCapabilities | `/ISAPI/AccessControl/UserInfo/capabilities?format=json` |
| fdlibCapabilities | `/ISAPI/Intelligent/FDLib/capabilities?format=json` |
| fdlibList | `/ISAPI/Intelligent/FDLib?format=json` |
| fdlibCount | `/ISAPI/Intelligent/FDLib/Count?format=json` |

每次序列化精确为 `GET <path> HTTP/1.1\r\nHost: example.invalid\r\n`，attempt=2 另加 `Authorization: SYNTHETIC_DIGEST_AUTH\r\n`，最后 `\r\n`。没有其他头、body 或外部 host／path／headers／凭据入口。这里只标记合成认证重发，不处理真实 401、Digest 挑战或原始解析；每次 request，包括 attempt=2，必须使用新 peer 重新过门禁。

创建 peer 和 prepare 都不连接、不释放握手、不构造可自动发送的 HTTP 请求。send 先记录等待并建立一次假连接。假握手真正完成后才读取该 peer 的私有 raw 字节；TLS 错误立即 `TLS_HANDSHAKE_FAILED`，无证书／空 raw 为 `TLS_CERTIFICATE_MISSING`，错误 pin 为 `TLS_PIN_MISMATCH`，均关闭并收到零 HTTP 字节。只有真实 hash 比对成功，且一次微任务之后仍未取消／终止，才序列化并调用私有假接收端。

`summary` 精确包含 `allowReadStayedFalse`、`pinMatched`、`pinnedSlot`（null／0／1）、`certificateExpired`（null／布尔）、`httpWrites`、`httpBytes`、`clientTrace`。无效或已使用句柄的 send 以零新增写入生成 summary，失败不能复用旧 PASS。取消窗口可能已经验证 pin，因此可以 `pinMatched:true` 同时 `TLS_CANCELLED` 与零 HTTP。

`observation` 精确包含 `connections`、`handshakes`、`certificateReads`、`httpWrites`、`httpBytes`、`authorizationPresent`、`closed`、`trace`。HTTP 计数来自独立私有接收函数实际收到的 Buffer 长度，Authorization 布尔也从收到的 Buffer 检出；不是根据成功状态／attempt 硬编码。等待握手时 connections=1、handshakes=0、certificateReads=0、HTTP=0。假握手完成后 handshakes=1；TLS 错误也记录一次已完成的失败握手。

两种 trace 的每项都精确为 `{event, sequence}`，共享整个工厂域的单调序号。peer event 仅 `CONNECT/HANDSHAKE/HTTP_RECEIVED/CLOSE`；client event 仅 `HANDSHAKE_WAIT/CERTIFICATE_READ/PIN_VERIFIED/HTTP_WRITE/FAILED/CANCELLED`。成功时 `HANDSHAKE < CERTIFICATE_READ < PIN_VERIFIED < HTTP_WRITE < HTTP_RECEIVED < CLOSE`。观测与结果不输出输入值、指纹／hash、raw、HTTP payload、异常或凭据。

## 离线验证

使用已安装 Node 的 VM 模块测试接口，不安装依赖：

```powershell
node --experimental-vm-modules .\tools\hikvision-offline-tls-pin\test\pin-before-send.test.mjs
```

运行方分别保存真实 stdout、stderr、退出码与来源前后哈希。VM 实验性警告保留在 stderr；结果数量与失败 ID 以实际输出为准，不预填通过数。

## 来源和未证明事项

密码学比较语义静态参考本机 Git 原始 blob `558b9c864a4b820e397336200758b143556a4d87:tools/hikvision-probe/src/http.mjs` 的 `matchFingerprint`：对证书 raw 做 SHA-256，并对固定长度摘要使用 `timingSafeEqual`。未复制整个网络模块，也不导入或执行该模块。新输入约束比原 normalization 更窄，只接受规范大写值；两槽都比较后返回命中槽。过期只告警的范围与计划 §7 保持一致。

| 静态来源项 | 固定值 |
|---|---|
| Git commit | `558b9c864a4b820e397336200758b143556a4d87` |
| 路径 | `tools/hikvision-probe/src/http.mjs` |
| Git blob | `e96481d2954df4efe6ac43dbe8fd915a3e9c5587` |
| 原始字节长度 | 7858 bytes |
| 原始字节 SHA-256 | `e64b04bd10370682f9b4b1ff577b8c481801d1c9976335ce276cdcaa4f6c2573` |

本模块只证明假接收端的 HTTP 字节计数和假对象时序，不证明真实 Node `secureConnect`／HTTP 内核发送时序、真实 DNS／peer 身份、绝对 deadline、Digest 原始解析、完整 CLI 或真实 Windows E1。它也不使 NT-05 或其他尚未执行的真实／集成检查变为完成。任何真实设备、服务端证书、凭据、响应或网络操作均不在本目录范围内。
