# HK-AI-04 H2-d 全链回归与并发验收证据

日期：2026-11-12

分支：`test/hk-face-service-h2d-acceptance`

基线：`feaa1e04e6ca5d64e4028301fb02a9b6b5227e68`

原复核提交：`29172d3f6fa8c4b410d7bbb7795f5565446c21af`

本轮复审提交：分支 HEAD（本地验证通过后创建）

## 1. 范围与结论

本提交只增加/收紧测试、稳定性验证脚本和本证据文档，生产代码改动为 0。本轮复审在 `29172d3` 基础上补齐：

- 真实 `BlacklistService` 下的 H2-a/H2-b K2 损坏重放、配置换钥、K1 domain 损坏/配置不一致；
- H2-b 换钥、slot 冲突、released slot、claim invalid 失败路径的内容级深比较；
- 敏感扫描扩展到 `admin_audit`、`eligibility_guards`、`address`、`faceBytes`、`imageBase64` 等变体；
- 正式任务卡来源记录。

验收结果：

- H1 独立回归：8/8；
- H1/H2 组合：164/164；
- Admin 全量：454/454；
- 根测试：51/51；
- 五组稳定性：每组 20 轮，共 100 轮，0 失败；
- Provider/HTTP/设备：0／未注册／未连接；
- H3、H4、HTTP、Provider 派发和设备写继续关闭。

## 2. 基线历史核对

以下批准基线均为当前 HEAD 的祖先：

| 阶段 | 提交 | 核对 |
| --- | --- | --- |
| H2-a 严格重放 | `f9a2b6b` | ancestor=yes |
| 解码稳定性整合 | `9852c7f` | ancestor=yes |
| H2-b owner claim | `2bc10e3` | ancestor=yes |
| H2-c C1/C2 | `cfacfff` | ancestor=yes |
| H2-c C3 | `32c891f` | ancestor=yes |
| H2-c C4 | `feaa1e0` | ancestor=yes |

`9852c7f` 与原稳定性提交 `ad5ccc8` 的 stable patch-id 均为：

```text
ef1fb1c9b4887ad34fa97e07acb4e94e07d09b59
```

因此确定性 `timeoutMs: 0` 修复仍在当前历史中，没有丢失或重复引入。

对 `724d888..feaa1e0` 的生产历史逐项检查，仅包含已批准的 H1、H2-a、H2-b、H2-c C1–C4 及其定点返工；本分支没有新增生产差异。

正式任务卡来源：`docs/lock-01-fast-track` 的 `86e5c9f`（提交信息 `docs(face): approve H2-c and assign H2-d`），文件 `docs/tasks/HK-AI-04-H2D-INTEGRATION-ACCEPTANCE-TASK-2026-11-11.md`。该任务卡不在 `feaa1e0`/`29172d3` 树内，本轮从该远端 docs 提交读取并记录来源。

## 3. H1 八项独立回归

文件：`admin-web/tests/face-service-h1-regression.test.mjs`

| # | 冻结要求 | 测试证据 |
| --- | --- | --- |
| H1-01 | submit 最小输入与私密文件 revision 绑定 | `H1-01 submit 只接受最小输入并保存私密文件 revision 绑定` |
| H1-02 | review 权限、expected revision、状态迁移 | `H1-02 review 强制权限与 expected revision，且只迁移审核状态` |
| H1-03 | stale revision 不改写 credential | `H1-03 stale expectedRevision 返回 409 且不改写 credential` |
| H1-04 | reviewQueue 最小投影 | `H1-04 reviewQueue 只返回 submitted 的最小投影` |
| H1-05 | queryJob 最小 DTO 与跨组织同态 404 | `H1-05 queryJob 返回组织内最小 DTO，跨组织保持同态 404` |
| H1-06 | 权限撤销下一事务立即生效 | `H1-06 prepare 后撤销成员权限，下一次事务立即失败关闭` |
| H1-07 | 文件 revision/可见性变化失败关闭 | `H1-07 文件 revision 或私密可见性在 prepare 后变化时失败关闭` |
| H1-08 | H1 路径 Provider 0 | `H1-08 submit/review/reviewQueue/queryJob 全程 Provider 调用为零` |

这些测试使用独立 LocalStore fixture，不依赖 C4 用例，也不以 H2 测试替代 H1 语义。

## 4. H2 全链映射

| 范围 | 主要证据 |
| --- | --- |
| H2-a K2/domain/严格重放 | 真实链：`face-grant-d-matrix.test.mjs` D67–D69 及新增 `H2-d 真实链 K2 损坏重放结果`、`H2-d 真实链 K2 配置换钥`；`face-service-layer.test.mjs` 的 operation domain、同键同摘要/异摘要、损坏 result 仅作为组件契约回归 |
| H2-b device/K1/claim/slot | 真实链：C4 D64–D66 及新增 `H2-d 真实链 K1 domain 损坏`、`H2-d 真实链 K1 配置不一致`；`face-service-layer.test.mjs` 的 owner claim、domain、active/released slot、全字段快照、双请求竞争仅作为组件契约回归 |
| H2-c C1 helper | `face-eligibility.test.mjs` 17 项资格、关系、时间、refs 与竞态 |
| H2-c C2 hook | `blacklist-prepare-attempt.test.mjs` 12 项 attempt、顺序、重试、90/91 与非法契约 |
| H2-c C3 接线 | `face-grant-eligibility.test.mjs` 20 项真实名单、错误优先级、重放与核心写集 |
| H2-c C4 矩阵 | `face-grant-d-matrix.test.mjs` D01–D75，真实 BlacklistService、内容级 Z/S/R 快照 |
| 同 operation key 并发 | H2-d 新增用例：两个请求均返回同一 result，核心写集只提交一次 |
| 容量 | 去重后 90 refs 进入事务，91 refs 在事务前 400 |

H2-a/H2-b 的**全链证据**以 C4 真实服务用例与新增 `H2-d 真实链` 用例为准。`face-service-layer.test.mjs` 仍保留既有 `eligible=true` 组件桩，只用于 H2-a/H2-b 的 device/ID/slot 组件契约回归，不再作为全链资格评价证据；全链用例断言真实 `BlacklistService` 的 prepare/evaluate 调用计数，K2 失败按冻结优先级在评价前失败、K1 失败在真实评价后失败。

失败用例以故障注入后的 state 为基线，对 grant、job、slot、claim、log、operation key、domain、guard、audit 等集合进行内容级深比较。H2-b 的换钥、slot 冲突、released slot、claim invalid 失败路径已从集合数量比较升级为 `businessSnapshot()` 深比较。

## 5. 20 轮稳定性

可复现命令：

```bash
cd admin-web
node scripts/verify-face-h2d-stability.mjs
```

脚本为每一轮启动独立 Node 测试进程，校验退出码与精确 pass 数；任何一轮不匹配立即失败。实际结果：

| 组 | 每轮通过数 | 轮数 | 失败 |
| --- | ---: | ---: | ---: |
| 同 slot 双请求竞争（D66） | 1 | 20 | 0 |
| 同 operation key 并发 | 1 | 20 | 0 |
| 一次名单重试成功 + 三次耗尽（D60/D62） | 2 | 20 | 0 |
| D75 token/callback | 4 | 20 | 0 |
| 解码超时后槽位恢复 | 1 | 20 | 0 |

机器汇总：

```json
{"result":"PASS","groups":5,"totalRuns":100,"totalFailures":0}
```

没有延长超时、降低并发、删除断言或串行化生产路径。

## 6. 敏感数据与副作用

`face-service-layer.test.mjs` 对成功写集、错误信封与日志执行递归字段扫描和原始值扫描：

- 扫描集合：grant、job、slot、`device_operation_logs`、`operation_keys`、`eligibility_guards`、`admin_audit`；
- 禁止字段：人脸字节/图片及 `faceBytes`/`imageBase64`/`faceData`/`imageData`/`imageBytes` 变体、`objectKey`、checksum、姓名、手机号、`address`、证件标识（`idCard`/`idNumber`）、序列号、MAC、IP、账号密码、secret、证书指纹、原始幂等键；
- 禁止值：测试序列号前缀、原始 submit/review/grant/扫描幂等键，以及 Person 源记录中的姓名/地址/证件/人脸字节/图片 base64/checksum/objectKey 哨兵值；
- 所有 job 均为 `executionMode=test`、`provider=mock`、`evidenceScope=simulated`；
- 所有 grant 均为 `evidenceScope=simulated`；
- 使用 `projectAccess()` 验证无受信设备回执时 `deviceEffective=false`；
- Provider 计数保持 `{enroll:0,revoke:0}`。

哨兵值只存在于 Person 源记录，成功写集、错误信封、`device_operation_logs` 与 `admin_audit` 均未复制；失败信封仅含 `code/status/message`。

## 7. 固定回归命令

```bash
cd admin-web
node --test --test-isolation=none \
  tests/cloud-store-point-read.test.mjs \
  tests/face-grant-eligibility.test.mjs \
  tests/face-service-layer.test.mjs \
  tests/face-service-h1-regression.test.mjs \
  tests/face-eligibility.test.mjs \
  tests/blacklist-prepare-attempt.test.mjs \
  tests/face-grant-d-matrix.test.mjs
# 164/164 PASS

node --test --test-isolation=none tests/*.test.mjs
# 454/454 PASS

node scripts/verify-face-h2d-stability.mjs
# {"result":"PASS","groups":5,"totalRuns":100,"totalFailures":0}

cd ..
npm test
# 51/51 PASS

git diff --check
# 通过（无输出）
```

环境：Windows、Node `v24.19.0`、npm `11.17.0`。DSH `workspace-write` 沙箱会拦截 Node 子进程管道（`spawnSync`/`node --test` 默认按文件 spawn 时 `EPERM`），因此稳定性脚本与根 `npm test` 在完整权限下执行；未修改测试或放宽断言规避。

## 8. 未开放范围

- H3 租约、`sending`、结果派发与重试；
- H4 撤权、清理、claim/slot 释放；
- `server.mjs`、HTTP 路由；
- Mock/真实 Provider 调用、设备连接和设备写；
- main 合并、生产云与数据库迁移。

本提交交 Codex 复审。通过前不得宣称 H2 整体关闭，不得进入 H3。
