# HK-AI-04 H2-d 终审（`90cc848`）

日期：2026-11-12

结论：**通过；H2-d 与 H2 整体正式关闭，允许进入 H3 契约设计。**

复审对象：

- 分支：`test/hk-face-service-h2d-acceptance`
- 提交：`90cc8486a19d408be0e3c501d9f5ec61ba13e929`
- 原始交付：`29172d3f6fa8c4b410d7bbb7795f5565446c21af`
- 基线：`feaa1e04e6ca5d64e4028301fb02a9b6b5227e68`

## 独立验证

- H1/H2 组合：164/164；
- Admin 全量：454/454；
- 根测试：51/51；
- 五组稳定性各 20 轮，共 100/100，0 失败；
- `git diff --check feaa1e0..90cc848` 通过；
- 差异只包含测试、稳定性脚本与证据文档；生产代码改动为 0；
- Provider/HTTP/设备：0／未注册／未连接。

## 关闭项

1. H1 八项服务层回归由独立 fixture 覆盖，没有用 H2/C4 测试替代；
2. H2-a K2/domain/严格重放、H2-b device/K1/owner claim/slot、H2-c C1–C4 在同一基线上全绿；
3. 新增真实 `BlacklistService` 链证据，K2 损坏与换钥保持 operation 优先，K1 domain 损坏与配置变化发生在真实资格评价之后；
4. 同 operation key 并发返回同一结果且核心写集只提交一次；
5. 同 slot 竞争、名单一次重试/三次耗尽、D75 token/callback 与解码恢复连续 20 轮稳定；
6. 失败路径以故障注入后的内容级快照比较 grant/job/slot/claim/log/key/domain/guard/audit，不只比较数量；
7. 成功写集、错误信封、日志、guard 与 admin audit 的字段和值扫描未发现人脸、私密身份、设备标识、凭据、摘要或原始幂等键泄露；
8. 所有任务继续保持 `executionMode=test`、`provider=mock`、`evidenceScope=simulated`；无可信设备回执时 `deviceEffective=false`。

## H3 前置发现

H2 当前 job/grant 足以创建原子 pending grant 与 queued enroll job，但尚不足以直接实现完整的发送前资格重验：

- job 未保存资格快照引用；
- grant 未保存 `identityApplicationId` 及资格 revision/epoch 基线；
- 不能仅凭 person/occupancy/cycle 重新定位唯一实名申请与全部事务 refs；
- 租约 fencing、过期租约的未知结果处理、Provider 调用上下文和结果日志字段尚未形成正式接线契约。

因此本终审只放行 **H3 契约设计**。H3 生产编码、Mock Provider 调用、H4、HTTP、真实 Provider、设备连接与设备写继续关闭，须在设计终审后另发编码卡。
