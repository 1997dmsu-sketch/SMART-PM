import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolvePublicFile } from '../lib/static-path.mjs';

for (const [platform, paths, root] of [
  ['Windows', path.win32, 'C:\\Users\\Administrator\\WeChatProjects\\SMART-PM\\admin-web'],
  ['Linux', path.posix, '/workspace/SMART-PM/admin-web'],
]) {
  test(`${platform}: homepage and assets resolve inside public`, () => {
    for (const [url, file] of [['/', 'index.html'], ['/index.html', 'index.html'], ['/app.js', 'app.js'], ['/style.css', 'style.css'], ['/assets/room-1.jpg', 'assets/room-1.jpg']]) {
      assert.equal(resolvePublicFile(root, url, paths), paths.resolve(root, 'public', file));
    }
  });
  test(`${platform}: traversal cannot escape public`, () => {
    for (const url of ['/../server.mjs', '/%2e%2e/server.mjs', '/%2fetc/passwd', '/../public-other/secrets']) {
      assert.throws(() => resolvePublicFile(root, url, paths), error => error.status === 404);
    }
  });
}
test('Windows: backslash, drive and UNC escapes are rejected', () => {
  for (const url of ['/%2e%2e%5cserver.mjs', '/D:%5csecrets', '/%5c%5cserver%5cshare%5cfile']) {
    assert.throws(() => resolvePublicFile('C:\\project\\admin-web', url, path.win32), error => error.status === 404);
  }
});
test('invalid encodings and null bytes return an explicit bad request', () => {
  for (const url of ['/%xx', '/%00']) assert.throws(() => resolvePublicFile('/app', url), error => error.status === 400);
});
