# HK-AI-04 FileService 引用校验 `dd9c3c9` 复审（2026-11-06）

结论：**暂不通过。** 返回最小化和“不读取字节”方向正确，但尚未实现 `2ddb916` 冻结的 prepare + 事务内成员权限复核，且 MIME/大小未在事务内验证。K1/domain guard 暂缓，先修复本共享提交。

## 独立核验

- 分支/提交：`feat/hk-face-service-integration` / `dd9c3c9`
- 差异：`files.mjs` + 新测试文件，未改 `server.mjs`
- `admin-web`：268/268通过
- 根测试：51/51通过
- 未读取真实文件、未连接网络或设备

## 已通过部分

1. prepare 返回值不含 objectKey、URL、checksum和图片字节。
2. 实际下载路径未被替换，仍由 `authorizeDownload` 管理。
3. 文件 revision 变化、文件不存在和改为 public 有基本失败关闭测试。

## P0-1：没有事务 refs，也没有事务内权限复核

`prepareReference` 仅调用 `assertActorRole` 检查 actor 快照；返回 token 没有 `refs`。`assertReference` 只读取 file_assets，不调用 `authCheck`，因此 prepare 后撤销 membership 或 `device.face.submit`，FaceCredentialService 的提交事务仍可成功。

修复：FileService 必须配置 `auth.membershipId`；prepare token 内部携带 `refs = [file_assets/fileId, organizations/orgId, org_memberships/membershipId]`。调用方把这些 refs 合并进业务事务；`assertReference(state, token)` 调用 `authCheck(state,{permission:"device.face.submit"})` 并核对 token 的 org/membership。无 auth 时失败关闭。

## P0-2：purpose 可由调用者改变

当前 options 允许传任意 purpose，持 submit 权限可能据此引用其他私密用途。该接口是人脸专项接口，purpose 必须硬编码为 `face-biometric`；如未来需要通用引用 API，另行设计每个 purpose 的权限映射。

## P0-3：MIME/大小未复核

prepare 和 assert 都没有使用 `PURPOSES["face-biometric"].accept/maxSize` 做判定，只把 mimeType/size返回。事务内必须重新验证当前文件为 JPEG/PNG 且 ≤200KB；token 中的 revision/mime/size与当前记录不一致时失败关闭。

## P1：错误同态和测试缺口

按 `2ddb916`，跨组织、不存在、非 ready、错误 purpose/visibility、权限不足统一 `FILE_NOT_FOUND`/404。当前无 submit 返回403，需改为同态404，避免用引用接口枚举文件或成员权限。

新增测试：

1. prepare 后撤销 submit 或停用 membership，事务内 assert 返回404；
2. prepare 后修改 MIME/大小/revision，失败关闭；
3. 跨组织、错误 purpose、非 ready、public、无权限均同态404；
4. token 的 refs 被实际加入同一业务事务；
5. 返回/token无 bytes、URL、objectKey、checksum、locator；
6. storage adapter 的 read/tempUrl 调用次数始终为0；
7. 有 submit 无 readPrivate 可通过。

完成后复跑全部测试再申请共享提交复审。HTTP、K1后续步骤、真实 Provider和设备连接继续关闭。
