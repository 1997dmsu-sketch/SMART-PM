import path from 'node:path';
import { fail } from './model.mjs';

// Use the host filesystem's path semantics, including Windows drive letters
// and separators. A string prefix with '/' rejects every Windows asset.
export function resolvePublicFile(root, pathname, paths = path) {
  let requested;
  try {
    requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  } catch {
    fail('文件路径编码无效', 400);
  }
  if (requested.includes('\0')) fail('文件路径无效', 400);
  const directory = paths.resolve(root, 'public');
  const file = paths.resolve(directory, requested);
  const relative = paths.relative(directory, file);
  if (relative === '..' || relative.startsWith('..' + paths.sep) || paths.isAbsolute(relative)) {
    fail('文件不存在', 404);
  }
  return file;
}
