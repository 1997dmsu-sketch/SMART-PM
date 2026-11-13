# HK-AI-04 H3-a 终审：`5e590ee`

日期：2026-11-13  
分支：`feat/hk-face-h3a-embedded-snapshot`  
提交：`5e590ee04fee0d71f81b22c3c2b505de1fefa293`  
基线：`b2cd7abf7699a93db58c245e5773f14aa50093ee`  
结论：**通过；H3-a 关闭，允许进入 H3-b。**

## 独立验证

- 定向 H3-a + C4：86/86；
- Admin 全量：463/463；
- 根测试：51/51；
- `git diff --check b2cd7ab..5e590ee` 通过；
- 4 个文件，无 `store.mjs` 修改；Provider/HTTP/设备调用为 0。

## 关闭项

1. snapshot 内嵌 job，不增加集合/ref；真实合成 58 candidates/90 refs 成功，59/91 事务前失败。
2. snapshot 严格白名单、16 KiB 边界、版本/缺席见证与 job 绑定；敏感源字段不复制。
3. 同 operation key 并发只创建一个 job；合法重放内嵌 snapshot 不变。
4. queued/sending/retry/终态字段、generation/attempt/result 不变量失败关闭。
5. T1 复用现有 `store.transact` 与 admin audit；双 worker 仅一胜，日志冲突整体回滚。
6. 旧 H2 job 不成为候选，直接请求 `DISPATCH_SNAPSHOT_REQUIRED`；缺失/跨组织同态 404。
7. T1 orchestration 仅允许 LocalStore；非 LocalStore `NOT_CONFIGURED/503`。
8. 租约安全加法、到期等号、旧 fence、错 owner/generation/attempt/revision、禁止续期均覆盖。

## 保持关闭

H3-b、HTTP、Cloud/live、多 worker、真实 Provider、设备连接与写操作、H4 继续关闭，须按下一任务卡实施和复审。

