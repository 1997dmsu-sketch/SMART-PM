# DB-06 第一轮审查：需返工

对象：`feat/db-06-blacklist` 提交 `18bcae9`，基线 `bb76099`。发现1项可复现阻断问题，暂不建议作为DB-05激活实现的通过基线。未修改开发代码、未合并main或上线。

## F01 [P1] 先查名单后读guard，可漏掉并发新增的有效黑名单

位置：`admin-web/lib/blacklist.mjs:427–440`，prepareEligibility。

当前顺序为读取blacklist_entries候选列表，然后读取eligibility_guards版本。若候选列表返回后、guard读取前新增一条命中名单，新建事务已同时推进guard；资格检查得到的是“旧候选 + 新epoch”。随后evaluateEligibility对比新epoch相等，不会重扫；新名单未进入candidateIds，最终无命中并允许激活。

确定性独立复现（临时LocalStore，调用正式createEntry/withEligibility）：

1. 创建组织与人员，起初无名单。
2. 拦截第一次list(blacklist_entries)，保留返回的空快照。
3. 在返回该快照前，通过createEntry为该人员提交有效occupancy.activate限制（名单与guard事务成功）。
4. 继续withEligibility，模拟激活只写测试unique_claims占位。
5. 实际结果：`{ result: 'ACTIVATED', activeBlacklist: 1, activationWritten: true }`。预期应重扫后BLACKLIST_REVIEW_REQUIRED，且激活占位不存在。

现有并发测试在整个prepareEligibility结束后才注入名单，能验证预读后变化，却未覆盖预读内部的这一窗口。此问题不依赖云端特殊行为，单机确定性时序已经复现。新增名单先于激活事务提交，因此不能解释为“激活完成后新增名单不撤销现有入住”的业务规则。

### 修复要求

- 派生完整person/user/identity主体后，先await读取guard及epoch，再await扫描名单候选；不要并行执行这两步。
- 保留事务内epoch复核及冲突后整个预读流程重试，名单变更与激活继续写同一guard。
- 加确定性回归：在名单读取已取快照但尚未读guard的原窗口注入新增，修复后必须重扫/拒绝且零激活写入。
- 覆盖首次不存在guard、已有guard、已有allow后新增另一命中名单；至少验证person，并检查user/identity使用相同协议。
- 继续保留现有“预读完成后新增”“allow改deny”“认领新增用户主体”等回归。

## 验证及范围

- 后台npm test：135项通过；根目录npm test：51项通过；9页静态检查通过，实际输出867 KiB。
- 独立复现仅使用临时本地数据与测试占位，已清理；未操作真实云环境、真实入住或门锁。
- 审查包含组织/显式权限点、名单起止时间、撤销、放行名单版本匹配、主体派生及认领guard接入。除上述问题，本轮未确认其他阻断项；不构成完整安全认证。
- reviewOccupancy目前接受不校验实体的occupancyId，开发文档明确由DB-05负责同组织/同人员/申请状态与唯一生命周期校验。接入时必须实现这些条件，不能把当前复核HTTP接口视为完整入住审批。
- 身份申请参数在DB-06可省略；DB-05激活必须强制提供并事务验证批准申请、人员有效性和组织权限。
- DB-07文件校验与DB-08云端事务探针仍未完成；本地通过不等于生产通过。

## 给开发AI

在原DB-06分支修复F01并补上述回归，更新DB-06-IMPLEMENTATION.md后提供提交哈希。暂不合并main、不发布版本、不迁移生产数据。修复复核通过后再让DB-05依赖该提交。
