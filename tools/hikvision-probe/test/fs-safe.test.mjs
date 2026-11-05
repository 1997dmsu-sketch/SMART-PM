import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ensurePrivateDir, writePrivateFile } from "../src/fs-safe.mjs";

const POSIX = process.platform !== "win32";

test("ensurePrivateDir：新建目录为 0700", { skip: !POSIX }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "probe-fs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "out");
  await ensurePrivateDir(dir);
  const info = await stat(dir);
  assert.equal(info.mode & 0o777, 0o700);
});

test("ensurePrivateDir：既有宽松目录会被收紧为 0700", { skip: !POSIX }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "probe-fs-wide-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "existing");
  await mkdir(dir, { mode: 0o755 });
  await ensurePrivateDir(dir);
  const info = await stat(dir);
  assert.equal(info.mode & 0o777, 0o700);
});

test("writePrivateFile：文件为 0600 且内容正确", { skip: !POSIX }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "probe-fs-file-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = await ensurePrivateDir(join(root, "out"));
  const file = join(dir, "report.json");
  await writePrivateFile(file, '{"ok":true}');
  const info = await stat(file);
  assert.equal(info.mode & 0o777, 0o600);
  assert.equal(await readFile(file, "utf8"), '{"ok":true}');
});

test("Windows：调用不抛错（不做 POSIX mode 断言）", { skip: POSIX }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "probe-fs-win-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = await ensurePrivateDir(join(root, "out"));
  const file = join(dir, "report.json");
  await writePrivateFile(file, "ok");
  assert.equal(await readFile(file, "utf8"), "ok");
});
