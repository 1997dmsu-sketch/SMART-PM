# 固定原探针写入模块来源

- 仓库：`https://github.com/1997dmsu-sketch/SMART-PM.git`
- 原探针提交：`558b9c864a4b820e397336200758b143556a4d87`
- 原路径：`tools/hikvision-probe/src/fs-safe.mjs`
- Git blob：`61bef04d51de884ac9eeb45d61eb5780e52b0c95`
- 原始字节：1198
- SHA-256：`d618507e8ad74479945a36bbc1dd080e4b93b03e241ac53642c7d59b5d98613d`

同目录 `fs-safe.mjs` 经 `git cat-file blob` 原始 stdout 字节取件，未重编码或改换行，没有复制改写其函数。它不是完整探针，也不是新的 live 入口。核验 worker 对字节哈希及导出集合验证后，通过内存 data URL 导入这份原始源码，只调用 `ensurePrivateDir`、`writePrivateFile`；不导入原 CLI、编排器或传输器。

原代码在 Windows 上跳过 POSIX mode 断言；本目录副本保持这一事实，不以改代码制造 ACL 通过。目录/文件 ACL 的创建、回读、拒绝负控和新合成对象清理由上层独立 Windows 核验器完成。
