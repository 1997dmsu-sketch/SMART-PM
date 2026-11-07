# HK-AI-04 H2-a 第一部分复审：`b6ae1f9`（2026-11-07）

结论：**不通过，需先修 domain 状态机与记录校验，再进入 H2-a 第二部分。H2-b 继续关闭。**

独立验证：集合+服务层定向 22/22、后台 285/285、根测试 51/51 通过。

## 已确认正确

- `operation_key_domains` 已登记 CloudStore 白名单、seed 和 LocalStore init；
- K2 配置增加 realm，缺失/非法配置为 `503 NOT_CONFIGURED`；
- fingerprint 与 operation digest 均使用约定的结构化 HMAC；
- operation key 固定 ID 纳入 realm，原始 idempotency key 不进入 ID；
- 同版本换密钥、head-only、伪造 kind 已有基础测试。

## P0-1：换版本被误分类为 `DOMAIN_INCOMPLETE`

当前按“当前配置版本”构造 version record ID。已有完整 v1 domain 时把配置改成 v2，state 中会出现旧 head、缺少 v2 version record，代码先按单边缺失返回 `DOMAIN_INCOMPLETE`。约定应由稳定 head 的 version/fingerprint 直接判定配置误改，返回 `DOMAIN_MISMATCH`。

状态机顺序固定为：

1. 无 head 且无当前 version：首次初始化；
2. head 存在但自身结构损坏：`DOMAIN_INCOMPLETE`；
3. 有效 head 的 realm/version/fingerprint 与当前配置不同：立即 `DOMAIN_MISMATCH`；
4. head 与当前配置一致后，当前 version 缺失或损坏：`DOMAIN_INCOMPLETE`；
5. head/version 两条记录彼此不一致：`DOMAIN_INCOMPLETE`；
6. 两条完整且与配置一致：继续。

补“完整 v1 + 当前 v2”直接 `DOMAIN_MISMATCH` 测试。

## P0-2：缺少正式 record validator 与 `validateRecord` 分发

`operation_key_domains` 已成为正式集合，但当前只有 `applyOperationKeyDomain()` 内部的轻量 `valid()`，`validateRecord()` 不会分发专用校验。以下字段未被强制：

- head：`revision >= 1`、`createdAt` 安全整数；
- version：`enabledAt` 安全整数；
- realm 格式、keyVersion 正整数、fingerprint 64 位小写 hex；
- kind 必须为 head/version。

新增并导出 `validateOperationKeyDomainRecord()`，由 `validateRecord()` 对该集合自动分发；`applyOperationKeyDomain()` 复用该 validator，不得维护第二套宽松规则。

## P0-3：存储内部矛盾与配置不匹配没有正确区分

如果 head 与 version 的 realm/version/fingerprint 彼此不同，当前统一落到 `DOMAIN_MISMATCH`。这属于存储对不完整/损坏，应为 `DOMAIN_INCOMPLETE`。只有“两条记录彼此一致，但与当前配置不同”才是 `DOMAIN_MISMATCH`。

补 head/version fingerprint、version、realm 彼此不一致的独立反例。

## P1：realm 约束过宽

`operationKeyConfig()` 目前只 trim 后检查非空，domain ID helper 也接受空白以外的任意 1–128 字符。收紧为部署域格式，例如 `[a-z0-9][a-z0-9-]{2,63}`，并测试大写、空格、控制字符、过短和过长均为 `503 NOT_CONFIGURED`。

## 下一提交边界

只修第一部分的 validator、状态机、realm 校验和定向测试。不得接入 submit/review/createGrant，不得开始 H2-b，不得修改 claim/资格/HTTP/server，不得调用 Provider 或设备。
