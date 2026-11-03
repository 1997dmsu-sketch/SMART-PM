# DB-07 第一轮审查：需返工

PR： https://github.com/1997dmsu-sketch/SMART-PM/pull/5
审查head：`562b5ac`，分支feat/db-07-file-assets。检查DB-07相对DB-02 `8b2d183`的改动，包含共享store/server提交及后续修复，不把未合入DB-03/04/06误判为删除。结论：3项问题需修复，暂不建议合并。

## F01 [P1] 私密文件下载绕过已确定的显式权限点

位置：`admin-web/lib/files.mjs:65–67,296–301,836–841`，`admin-web/server.mjs` buildFileService。

authorizeDownload只要actor.role=admin就直接允许私密文件读取；identity-document的权限映射还是identity.review，而非DB-04已明确区分的identity.readPrivate。server传入的是后台account.role而非组织membership.role，导致某组织内只有viewer资格的全局管理员同样可走此旁路。黑名单证据也因admin分支绕过blacklist.read。

独立临时库复现：admin actor的permissions=[]，上传一份虚构identity-document后authorizeDownload返回20字节PNG，并未拒绝。现有测试甚至把admin无权限下载200作为预期，因此测试通过不能证明满足DB-04/DB-06安全契约。

修复：与已复核的DB-04/06统一主体与权限来源，私密证件读取必须显式identity.readPrivate，黑名单证据必须显式blacklist.read，角色本身不能替代权限。用当前有效组织membership复核，不以全局account.role提升组织权限。读写权限按用途分别定义，不要为上传行为授予私有资料读取权限。补HTTP测试：全局admin+组织viewer、组织admin但无权限、只有identity.review、权限撤销后读取均拒绝；显式允许者才读且留审计。

## F02 [P1] 旧拦截点只取第一条匹配，重复别名可掩盖私密登记

位置：`admin-web/server.mjs` matchFileAsset（约65行）及image-url、vr-download、uploads静态分支。

matchFileAsset使用assets.find。一个定位符若匹配多条登记，public记录排前时，后面的private记录完全被忽略。registerLegacy查重不是固定ID原子唯一占位，并发登记/历史导入可能产生重复；文件密级冲突必须拒绝，不能依赖数组顺序。

独立HTTP复现：为同一uploads/uuid.png登记public与private两条资产（public在前），不带会话访问/uploads/uuid.png，返回200和20字节文件。与“已登记私密旧路径必须404”的红线相反。contentList的publicVrFile已采用所有命中都为public的逻辑，server没有保持一致。

修复：汇总全部匹配，只要任一private或存在冲突即拒绝，不让public覆盖private；三个旧入口共用失败关闭判定。补两种数组顺序以及objectKey/legacyUrls/cloudFileId交叉别名测试；并发重复登记需避免或显式报冲突，不应自动放宽已有密级。

## F03 [P2] 普通成员可列出私密文件的完整存储元数据

位置：`admin-web/lib/files.mjs:617–653`，GET /api/v2/files及file-links GET路由。

list仅按orgId/查询条件过滤，返回原始file_assets记录，不按私密用途权限过滤，也没有DTO投影。普通viewer因此能拿到私密证件的objectKey、cloudFileId（云文件时）、legacyUrls、原始文件名、上传者和关联信息。下载拒绝并不能消除元数据暴露；文件名可能含姓名/证件信息。这里未声称cloudFileId本身一定可绕过云存储规则下载。

独立复现：同组织viewer调用list，返回identity-document的private对象定位符。HTTP路由直接回传该结果。file-links同样应审查其是否泄露无权查看的证件/证据实体关联。

修复：在分页前按有效组织权限过滤私密资源，普通返回使用最小DTO，不返回存储定位符；关联列表与文件读取权限保持一致。补混合公开/私密文件跨页测试，检查无敏感字段、无越权关联，并保证nextCursor正确。

## 文件清点及集成范围

- 已执行scripts/file-inventory.mjs --dry-run，只读取内置演示种子：16条引用全部为跳过的外链/静态资源，已登记0、待登记0。不能据此宣称真实云图片覆盖率100%。未执行--apply或写生产库。
- 上线前必须提供真实houses/content导出与file_assets的对账结果、人工复核清单和实际云下载探针；当前脚本是离线JSON工具，不会自动验证真实云端对象存在或完成线上登记。待登记为0也不等于覆盖率100%（还需处理人工复核、未识别引用与密级冲突）。
- 该分支基于DB-02。整合时应保留已通过复核的DB-03/04/06及其权限规则，不能直接替换server/store。
- DB-04/06期待fileValidator(fileIds,{orgId,purpose})；当前分支没有完成这两条业务链的真实接入，且实名/名单实体attach仍未支持。整合时必须验证文件ready、私密用途、组织、归属与引用权限，不能注入恒true验证器。
- NAS保持不可用占位，符合本期范围；本轮不要求连接NAS。VR文件只作为附件，不视为已托管可执行VR站点。

## 实跑验证

后台107项测试通过；根目录51项通过；9页静态检查通过（867 KiB）。后台数量较DB-06少是分支基线不同，不能视为全栈整合回归已通过。独立复现使用临时LocalStore、虚构PNG及本地HTTP，已清理。未调用云存储或真实私密资料。

## 给开发AI

在原PR/分支修复F01–F03并补测试，更新实施文档说明与DB-04/06的权限对齐及待接入边界。保持共享文件改动可独立整合，提交新head供复核。暂不合并main、不执行生产清点写入或发布版本。

## 第二轮复审：b2e40bf

结论：F02 已通过；F01、F03 仅部分修复，暂不建议合并。

### F01 仍未通过：证件读取使用了错误权限，组织角色来源也未修正

显式权限逻辑已加入，但 `identity-document` 仍映射到 `identity.review`。DB-04 已将“审核申请”和“读取私有证件”拆成 `identity.review` 与 `identity.readPrivate`；当前持有审核权但没有私有读取权的账号仍能下载证件字节。独立复现：actor permissions 只有 `identity.review`，`authorizeDownload` 成功返回 20 字节虚构 PNG。

此外 `buildFileService` 仍把全局 `account.role` 作为文件 actor.role，而不是当前组织 `membership.role`。文件路由调用 `requireMembership(... write:false)`，因此全局 admin、组织 viewer 仍可能以 admin 身份执行 public 文件写操作。修复时应分别定义上传/关联/读取权限：证件上传可使用审核工作流专用写权限，证件读取必须 `identity.readPrivate`；证据读取必须 `blacklist.read`；角色和权限一律来自当前有效组织成员关系并在事务内复核。

### F02 已通过

server 的 locator 匹配收集全部命中并采用 private 优先；同一路径 public 在前、private 在后时，匿名 `/uploads/*` 返回 404。registerLegacy 也实现密级只升不降。仍应保留并发重复登记测试和唯一占位/冲突策略，避免依赖事后扫描。

### F03 仍未通过：脱敏条目仍泄露私密资源存在性，关联列表未同步鉴权

未授权调用者现在看不到 objectKey、cloudFileId、legacyUrls 和 originalName，这是有效改进；但 `GET /api/v2/files` 仍返回私密条目的 ID、purpose、storage、size、MIME 和时间，暴露某人员/组织存在证件或黑名单证据。独立复现中普通 viewer 仍能定位 private 记录，只是 objectKey 为 undefined。`GET /api/v2/file-links` 继续直接返回原始关联行，没有按目标文件的私密权限过滤，可能泄露证件/证据与业务实体的关联。

修复：无对应私密读取权限的调用者应在分页前过滤这些文件和关联；若业务确需显示“已上传”状态，应由对应业务接口返回不含 fileId、purpose、storage、size、MIME 的布尔状态，而不是暴露文件资源记录。补混合 public/private 跨页、file-links、权限撤销和组织角色不一致测试。

复审实跑：后台 110 项、根目录 51 项、9 页静态检查全部通过；F02 独立复现通过，F01/F03 上述场景仍可复现。该分支仍基于 DB-02，整合 DB-04/06 时必须采用最终权限点，不能以本分支测试中的 `identity.review` 作为证件读取标准。

## 第三轮复审：420d028

结论：F02、F03 通过；F01 仍有一个明确的权限点映射错误，修正后再复审。

- F02 保持通过：重复 public/private 定位符采用 private 优先，匿名旧静态入口返回 404。
- F03 已通过：无私密读取权限的文件在分页前过滤，不再返回私密记录；`GET /api/v2/file-links` 同样先按目标文件读取权限过滤。独立 viewer 复现中私密记录完全不可见。
- 组织角色来源已修正为 `membership.role`，不再用全局 account.role 提升组织内文件写权限。
- 私密写入与读取已经拆分为 writePermission/readPermission，结构正确。

### F01 [P1] 剩余问题：identity-document 仍映射到 identity.review

`PURPOSES["identity-document"].readPermission` 仍是 `identity.review`，代码注释也把它称为 DB-04 读取权限。但 DB-04 已明确拆分：`identity.review` 用于审核队列/决定，`identity.readPrivate` 才允许逐次读取证件原文并强制审计。当前拥有审核权、没有私有读取权的账号仍能通过文件下载接口取得证件字节。

独立复现：actor permissions 仅含 `identity.review`，不含 `identity.readPrivate`，`authorizeDownload` 成功返回 20 字节虚构 PNG。现有测试也把这一行为写成成功预期，因此 110 项通过不覆盖最终权限模型。

修复：将 identity-document 的 `readPermission` 改为 `identity.readPrivate`，同步 HTTP/服务测试和实施文档；验证只有 identity.review 时下载/列表/关联均不可见，只有 identity.readPrivate 时可读取并留下访问审计，权限撤销后立即拒绝。上传权限继续独立按已确定的组织角色或专用写权限处理。

实跑后台 110 项、根目录 51 项、9 页静态检查全部通过。除上述权限点映射外，本轮未发现新的可复现阻断项。分支仍需在 DB-04/06 基线上整合后跑全量回归与 DB-08 云端探针。

## 第四轮复审：20e7fb8

结论：**DB-07 独立分支复审通过，可以进入集成阶段。** 第一轮提出的 F01–F03 均已关闭，本轮未发现新的可复现阻断项；这不等于已批准直接合并 main 或上线生产。

- F01 通过：`identity-document` 的 `readPermission` 已改为 `identity.readPrivate`。独立临时库验证中，仅持 `identity.review` 返回同态 `FILE_NOT_FOUND`；持 `identity.readPrivate` 可读取 20 字节虚构 PNG，并生成下载访问审计。上传仍按组织管理员角色独立控制，无私密读取权限的管理员可以上传但不能读取。
- F02 保持通过：相同定位符同时存在 public/private 登记时采用最严密级，匿名静态入口返回 404。
- F03 保持通过：未获私密读取权限的调用者在分页前被过滤，文件列表与文件关联列表均不暴露私密记录；权限授予后可见，撤销后下一次请求立即拒绝。
- 组织上下文继续采用当前有效 `membership.role` 与 `membership.permissions`，未恢复全局账号角色旁路。

实跑验证：后台 111 项、根目录 51 项、9 页静态检查全部通过；`git show --check` 未发现空白错误。独立复现仅使用临时 LocalStore、虚构 PNG 和本地 HTTP，未调用云存储、NAS 或真实私密资料。

集成边界仍保持不变：DB-07 基于 DB-02，不能直接覆盖 DB-05/DB-04/DB-06 的共享 `store.mjs`、`server.mjs`；应由单一集成负责人以 DB-05 已复核 head 为基线整合。整合时必须把 DB-04/06 的 `fileValidator` 接到 DB-07，复核文件 `ready` 状态、组织、purpose、private 密级与引用权限，并重新运行合并后的全量测试。生产上线前还必须用真实云数据执行文件清点并确认覆盖率 100%，本轮演示种子 dry-run 不能替代该检查。
