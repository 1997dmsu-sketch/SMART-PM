import { lstat, open, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

// This is a synthetic worker, never the probe CLI. The launcher owns ACL
// creation/checking and any later disposition of its newly created root.
const SCOPE = "synthetic-original-node-writer-only";
const REFERENCE_SHA256 = "d618507e8ad74479945a36bbc1dd080e4b93b03e241ac53642c7d59b5d98613d";
const NAMES = Object.freeze(["report.json", "sentinel.raw"]);
const STAGES = Object.freeze(["ensure", "write", "rewrite"]);
const counts = { ensureCalls: 0, writeCalls: 0, filesObserved: 0 };
const observed = new Set();

class WorkerFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new WorkerFailure(code);
}

function expectedContent(name, revision) {
  return Buffer.from(name === "sentinel.raw"
    ? `SMART-PM synthetic Node ACL sentinel v${revision}\r\n`
    : `{"scope":"synthetic-node-write-only","revision":${revision}}\r\n`, "ascii");
}

function rootArgument(value) {
  if (typeof value !== "string" || value.length > 2048 ||
      !/^[A-Za-z]:\\/.test(value) || value.includes("/") || !isAbsolute(value) ||
      value !== resolve(value) || !/^hk-node-acl-[0-9a-f]{32}$/.test(basename(value))) {
    fail("ROOT_INVALID");
  }
  for (const segment of value.slice(3).split("\\")) {
    if (!segment || segment === "." || segment === ".." ||
        segment.endsWith(".") || segment.endsWith(" ") || /[<>:"|?*\x00-\x1f]/.test(segment)) {
      fail("ROOT_INVALID");
    }
  }
  return value;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function checkRoot(root, identity) {
  const info = await lstat(root, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink()) fail("ROOT_INVALID");
  if (identity && !sameIdentity(identity, info)) fail("ROOT_CHANGED");
  return info;
}

function fixedFile(root, name) {
  if (!NAMES.includes(name)) fail("FILE_INVALID");
  const file = join(root, name);
  if (relative(root, file) !== name) fail("FILE_INVALID");
  return file;
}

function checkFileInfo(info) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) fail("FILE_INVALID");
}

async function checkEntries(root, identity, empty) {
  await checkRoot(root, identity);
  const entries = await readdir(root, { withFileTypes: true });
  if (empty) {
    if (entries.length !== 0) fail("DIRECTORY_NOT_EMPTY");
    return;
  }
  const names = entries.map((item) => item.name).sort();
  if (names.length !== NAMES.length || names.some((name, index) => name !== NAMES[index])) {
    fail("ENTRY_SET_INVALID");
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) fail("FILE_INVALID");
    checkFileInfo(await lstat(fixedFile(root, entry.name), { bigint: true }));
  }
  await checkRoot(root, identity);
}

async function verifyFile(root, identity, name, revision, previousIdentity) {
  await checkRoot(root, identity);
  const path = fixedFile(root, name);
  const expected = expectedContent(name, revision);
  const before = await lstat(path, { bigint: true });
  checkFileInfo(before);
  if (previousIdentity && !sameIdentity(previousIdentity, before)) fail("FILE_CHANGED");
  if (before.size !== BigInt(expected.length)) fail("CONTENT_MISMATCH");
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    checkFileInfo(opened);
    if (!sameIdentity(before, opened)) fail("FILE_CHANGED");
    if (opened.size !== BigInt(expected.length)) fail("CONTENT_MISMATCH");
    // Bound the read even if an unexpected concurrent writer grows the file.
    const content = Buffer.alloc(expected.length + 1);
    let total = 0;
    while (total < content.length) {
      const { bytesRead } = await handle.read(content, total, content.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total !== expected.length || !content.subarray(0, total).equals(expected)) {
      fail("CONTENT_MISMATCH");
    }
    const afterRead = await handle.stat({ bigint: true });
    checkFileInfo(afterRead);
    if (!sameIdentity(before, afterRead) || afterRead.size !== BigInt(expected.length)) {
      fail("FILE_CHANGED");
    }
  } finally {
    await handle.close();
  }
  const afterPath = await lstat(path, { bigint: true });
  checkFileInfo(afterPath);
  if (!sameIdentity(before, afterPath)) fail("FILE_CHANGED");
  await checkRoot(root, identity);
  observed.add(name);
  counts.filesObserved = observed.size;
  return afterPath;
}

async function originalWriter() {
  const reference = new URL("./reference/fs-safe.mjs", import.meta.url);
  const info = await lstat(reference, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.size !== 1198n) {
    fail("REFERENCE_INVALID");
  }
  const bytes = await readFile(reference);
  if (bytes.length !== 1198 || createHash("sha256").update(bytes).digest("hex") !== REFERENCE_SHA256) {
    fail("REFERENCE_INVALID");
  }
  // Execute the exact verified bytes, avoiding a second path lookup at import.
  // The frozen reference imports only node:fs/promises, with no relative imports.
  const module = await import(`data:text/javascript;base64,${bytes.toString("base64")}`);
  const exports = Object.keys(module).sort();
  if (exports.length !== 2 || exports[0] !== "ensurePrivateDir" || exports[1] !== "writePrivateFile" ||
      typeof module.ensurePrivateDir !== "function" || typeof module.writePrivateFile !== "function") {
    fail("REFERENCE_INVALID");
  }
  return module;
}

async function run(stage, inputRoot) {
  const original = await originalWriter();
  const root = rootArgument(inputRoot);
  const identity = await checkRoot(root);
  if (stage === "ensure") {
    await checkEntries(root, identity, true);
    counts.ensureCalls += 1;
    await original.ensurePrivateDir(root);
    await checkEntries(root, identity, true);
    return;
  }
  if (stage === "write") {
    await checkEntries(root, identity, true);
    for (const name of NAMES) {
      counts.writeCalls += 1;
      await original.writePrivateFile(fixedFile(root, name), expectedContent(name, 1));
      await verifyFile(root, identity, name, 1);
    }
  } else {
    await checkEntries(root, identity, false);
    const prior = new Map();
    for (const name of NAMES) prior.set(name, await verifyFile(root, identity, name, 1));
    for (const name of NAMES) {
      counts.writeCalls += 1;
      await original.writePrivateFile(fixedFile(root, name), expectedContent(name, 2));
      await verifyFile(root, identity, name, 2, prior.get(name));
    }
  }
  await checkEntries(root, identity, false);
  for (const name of NAMES) await verifyFile(root, identity, name, stage === "write" ? 1 : 2);
}

const argumentsPassed = process.argv.slice(2);
const stage = STAGES.includes(argumentsPassed[0]) ? argumentsPassed[0] : "unknown";
let status = "FAIL";
let code = "ARGUMENTS_UNSUPPORTED";
let exitCode = 3;
if (process.platform !== "win32") {
  status = "BLOCKED";
  code = "PLATFORM_UNSUPPORTED";
  exitCode = 2;
} else if (argumentsPassed.length === 2 && stage !== "unknown") {
  try {
    await run(stage, argumentsPassed[1]);
    status = "PASS";
    code = "OK";
    exitCode = 0;
  } catch (error) {
    code = error instanceof WorkerFailure ? error.code : "IO_FAILED";
  }
}
process.stdout.write(`${JSON.stringify({ scope: SCOPE, status, stage, nodeVersion: process.version, counts, code })}\n`);
process.exitCode = exitCode;
