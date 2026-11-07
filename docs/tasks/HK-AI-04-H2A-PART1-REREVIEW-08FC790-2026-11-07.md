# HK-AI-04 H2-a 第一部分复审：`08fc790`（2026-11-07）

结论：**主体返工有效，但仍有三项小范围失败关闭缺口；第一部分暂不通过，第二部分继续关闭。**

独立验证：集合 18/18、后台 286/286、根测试 51/51 通过。

## 已关闭

- 完整 v1 head 遇到配置 v2 时直接 `DOMAIN_MISMATCH`；
- 新增 `validateOperationKeyDomainRecord()` 并接入 `validateRecord()`；
- head/version 的 realm 或 keyVersion 矛盾归为 `DOMAIN_INCOMPLETE`；
- realm 基础格式已收紧；
- head revision/createdAt、version enabledAt、fingerprint 格式已校验。

## 剩余三项

### 1. head/version fingerprint 彼此矛盾仍误报 mismatch

两条记录各自格式合法但 fingerprint 不同，当前直接分别与配置比较并返回 `DOMAIN_MISMATCH`。先比较 head/version 两条记录的 fingerprint；彼此不同属于存储损坏，必须 `DOMAIN_INCOMPLETE`。只有两条记录彼此一致后，才能与当前配置比较并判定 `DOMAIN_MISMATCH`。

### 2. realm 前后空格被静默 trim

`operationKeyConfig()` 先 `.trim()` 再正则校验，`" test-realm "` 会被接受。配置必须精确匹配，不做静默规范化；带前后空格、大写、控制字符均 `503 NOT_CONFIGURED`。

### 3. 首次初始化参数未失败关闭

`applyOperationKeyDomain()` 在无记录时直接返回 writes，没有先校验输入 realm/version/fingerprint/now。直接调用 helper 可生成非法正式记录。

新增统一输入校验并在任何分支前执行：

- realm 匹配冻结正则；
- version 为 >=1 的安全整数；
- fingerprint 为 64 位小写 hex；
- now 为非负安全整数。

首次生成的 head/version 记录也应分别通过 `validateOperationKeyDomainRecord()` 后再返回。

## 下一提交边界

只修以上三项和反例测试。通过后放行 H2-a 第二部分；不得提前接入业务路径或开始 H2-b。
