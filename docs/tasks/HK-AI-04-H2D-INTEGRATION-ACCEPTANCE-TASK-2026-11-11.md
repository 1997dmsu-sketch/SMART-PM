# HK-AI-04 H2-d 全链回归与并发验收任务卡

**负责人：** DeepSeek Harness（单一主验证代理）

**优先级：** P0

**建议分支：** `test/hk-face-service-h2d-acceptance`

**代码基线：** `feaa1e0`（H2-c C4 终审通过）

**批准依据：**

- `HK-AI-04-H2-REVIEW-7B7EE6D-2026-11-07.md`
- `HK-AI-04-H2A-FINAL-APPROVAL-F9A2B6B-2026-11-07.md`
- `HK-AI-04-H2B-FINAL-APPROVAL-2BC10E3-2026-11-08.md`
- `HK-AI-04-H2C-C4-FINAL-APPROVAL-FEAA1E0-2026-11-11.md`

## 1. 唯一目标

对 H1、H2-a、H2-b、H2-c 做一次不扩大生产能力的整体验收，证明原有服务层流程、真实资格、严格幂等、设备 owner claim、slot 冲突、事务容量和并发语义可在同一基线上稳定共存。

本卡以测试、证据和缺口报告为主。不得借 H2-d 新增业务状态、接口、Provider 调用或设备写能力。

## 2. 首先执行基线盘点

1. 列出 H1 原 8 项服务层回归与当前对应测试，不得用 C4 矩阵替代；
2. 列出 H2-a 的 K2/domain/严格重放、H2-b 的 device/domain/claim/slot、H2-c 的 C1–C4 对应测试；
3. 确认 `f9a2b6b` 后的确定性解码超时修复仍在当前历史中；
4. 确认生产差异只包含已批准的 H1、H2-a、H2-b、H2-c 内容；
5. 若发现历史缺失、重复 cherry-pick 或批准范围外生产差异，停止并报告，不自行合并或重写历史。

## 3. 必须保留的 H1 回归

至少独立证明：

1. `submit` 最小凭证输入与私密文件引用绑定；
2. `review` 权限、expected revision 与审核状态迁移；
3. stale revision 不改写 credential；
4. `reviewQueue` 最小投影，不含图片、摘要或私密位置；
5. `queryJob` 组织内最小 DTO 与跨组织同态 404；
6. 成员权限撤销在下一次事务立即生效；
7. 文件 revision/可见性变化失败关闭；
8. H1 路径不调用 Provider，且不得被 H2 测试替换或删除。

若当前测试分组不能明确对应以上 8 项，可新增定向回归测试；不得为凑数复制实现细节断言。

## 4. H2 全链验收矩阵

使用真实 `BlacklistService` 与正式 Store；自制资格桩只允许留在独立 helper 单测。

必须覆盖：

- K2 operation domain、同键同摘要、同键异摘要、损坏重放记录与配置换钥失败关闭；
- K1 domain、设备冻结快照、owner claim 只读、active/released slot 均不复用；
- primary 与 member 完整成功路径；实名、入住、周期、目录、primary/slot/sponsor、guard 的失败与竞态；
- 黑名单 deny、review-required、一次 retry 成功、三次耗尽；
- 权限、operation、credential/file、资格、名单、H2-b 的冻结错误优先级；
- 同 slot 双请求只有一个成功；同 operation key 双请求不得产生重复核心写集；
- 合法重放核心写集内容不变，Provider 调用保持 0；
- refs 去重后 90 条进入单事务，91 条在事务开启前拒绝；
- D75 丢失上下文、跨 attempt 旧 token、同 attempt callback 重跑。

失败测试必须以故障注入后的 state 为基线，对 grant/job/slot/log/operation key 等核心集合做内容级深比较，不能只比较数量。

## 5. 并发与稳定性

以下定向组须在独立进程中连续运行 20 次，0 次失败：

1. 同 slot 双请求竞争；
2. 同 operation key 并发重放；
3. 一次 `BLACKLIST_RETRY` 后成功与三次耗尽；
4. D75 token/事务 callback 场景；
5. 人脸解码超时后槽位恢复。

不得通过延长宽松超时、降低并发、删除断言或串行化生产路径来取得稳定结果。若发现抖动，只允许独立测试稳定性提交；生产修复须停止并另报 Codex。

## 6. 敏感数据与副作用扫描

对测试成功写集、错误信封与日志执行字段和值扫描，确认不包含：

- 人脸图片或字节、checksum、objectKey；
- 姓名、手机号、地址、证件号；
- 设备序列号、MAC、IP、凭据、原始幂等键、完整证书指纹。

同时确认 `executionMode=test`、`provider=mock`、`evidenceScope=simulated`，且 `deviceEffective=false`。

## 7. 固定验证命令

至少运行并回报：

```bash
cd admin-web
node --test --test-isolation=none \
  tests/cloud-store-point-read.test.mjs \
  tests/face-grant-eligibility.test.mjs \
  tests/face-service-layer.test.mjs \
  tests/face-eligibility.test.mjs \
  tests/blacklist-prepare-attempt.test.mjs \
  tests/face-grant-d-matrix.test.mjs
node --test --test-isolation=none tests/*.test.mjs
cd ..
npm test
git diff --check
```

另外提交 20 次稳定性运行的逐轮结果或机器可核对汇总，不能只写“已通过”。

## 8. 提交规则

优先只新增 H2-d 定向测试与一份脱敏证据文档。若现有测试已经完整覆盖，可只提交证据脚本/文档，但必须给出逐项映射和可复现命令。

发现生产缺陷时停止 H2-d，通过报告列出最小复现、实际/预期结果和受影响提交；不得在本卡混入生产修复。

## 9. 禁止范围

- 不修改 C1–C4、H2-a/H2-b 已批准业务语义；
- 不实现 H3 租约、`sending`、结果派发或自动重试；
- 不实现 H4 撤权、清理、claim/slot 释放；
- 不修改 `server.mjs`，不注册 HTTP；
- 不调用 Mock 或真实 Provider，不连接设备，不执行设备写；
- 不合并 main，不修改生产云，不迁移数据库；
- 不把 UI、Provider 前置框架或小程序上线任务并入本分支。

## 10. 交付回报模板

```text
任务：HK-AI-04 H2-d 全链回归与并发验收
分支/提交：
基线：feaa1e0
生产代码改动：无（如有则停止并报告）
H1 8 项映射：
H2 全链矩阵：
20 次稳定性：
敏感数据扫描：
组合/Admin/根测试：
Provider/HTTP/设备：0 / 未注册 / 未连接
未完成：H3、H4、HTTP、Provider、设备写
```

完成后交 Codex 复审。H2-d 通过前不得宣称 H2 整体关闭，不得进入 H3。
