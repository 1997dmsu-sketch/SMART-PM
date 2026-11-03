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
