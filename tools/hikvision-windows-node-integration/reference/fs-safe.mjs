import { chmod, mkdir, stat, writeFile } from "node:fs/promises";

/**
 * 受控输出目录与文件权限。
 *
 * `mkdir(..., { mode })` 只在**新建**时生效；目录已存在时不会收紧旧权限。
 * 因此这里显式 chmod 并回读校验：POSIX 下必须是 0700/0600，否则抛错终止，
 * 避免在宽权限目录里写入设备原始响应。
 *
 * Windows 无 POSIX mode 语义，chmod 只影响只读位；此时只执行 chmod、不做 mode 断言。
 */
const POSIX = process.platform !== "win32";

export async function ensurePrivateDir(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  if (POSIX) {
    const info = await stat(directory);
    if ((info.mode & 0o777) !== 0o700) {
      throw new Error(`输出目录权限无法收紧为 0700：${directory}`);
    }
  }
  return directory;
}

export async function writePrivateFile(file, data) {
  await writeFile(file, data, { mode: 0o600 });
  await chmod(file, 0o600);
  if (POSIX) {
    const info = await stat(file);
    if ((info.mode & 0o777) !== 0o600) {
      throw new Error(`文件权限无法收紧为 0600：${file}`);
    }
  }
  return file;
}
