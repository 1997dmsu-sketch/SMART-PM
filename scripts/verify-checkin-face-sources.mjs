/**
 * C1 — checkin-face 体验版新文件来源清单的机器校验（零依赖，只读）。
 *
 * 消费 docs/checkin-face-experience-source-hashes.json，持续门禁以下事实：
 *   1. 清单结构与路径：schema 固定、路径唯一且合法（纯 posix 相对路径、无
 *      反斜杠/盘符/穿越/空段/隐藏段），并且落在本体验版声明的登记范围内；
 *   2. 实际文件哈希：逐条与磁盘字节 SHA-256 比对，任何漂移即失败；
 *   3. baselineSha256 只允许 null 或真实 64 位十六进制：新增文件没有旧上游
 *      原件，禁止把任意字符串填成"原始哈希"（不伪造 originalSha256）；
 *   4. 新云函数目录闭合：cloudfunctions/checkinFaceTest 下每个 .js/.json
 *      源文件都必须登记（不能只登记 10 条却遗漏新的云执行代码）；
 *   5. 本地导入闭包闭合：每个登记的本地文件的相对导入必须能在树内解析，
 *      且落在体验版登记范围内的导入目标必须同样登记；
 *   6. 旧来源校验职责保留：登记路径不得与 docs/backend-provenance.json /
 *      docs/backend-changes.json 重叠；scripts/verify-import.mjs 继续承担
 *      原有来源校验，本脚本只做新文件清单，二者互不替代。
 *
 * 退出码：0 = 全部通过；1 = 存在违规（stderr 打印逐条违规）。
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_REL = 'docs/checkin-face-experience-source-hashes.json';
const LEGACY_PROVENANCE_REL = 'docs/backend-provenance.json';
const LEGACY_CHANGES_REL = 'docs/backend-changes.json';

const issues = [];
const notes = [];
const seen = new Map();
const registered = new Set();
let entriesChecked = 0;

function fail(message) { issues.push(message); }
function note(message) { notes.push(message); }

// ---------------------------------------------------------------------------
// 1. 清单本体
// ---------------------------------------------------------------------------
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST_REL), 'utf8'));
} catch (error) {
  process.stderr.write(`[FAIL] checkin-face sources: 无法读取 ${MANIFEST_REL}: ${error.message}\n`);
  process.exit(1);
}
if (manifest?.schema !== 'checkin-face-experience-source-hashes/v1') {
  fail(`${MANIFEST_REL}: schema 必须为 checkin-face-experience-source-hashes/v1`);
}
if (typeof manifest?.baselineCommit !== 'string' || !/^[0-9a-f]{7,64}$/i.test(manifest.baselineCommit)) {
  fail(`${MANIFEST_REL}: baselineCommit 必须是提交 SHA`);
}
if (typeof manifest?.branch !== 'string' || !manifest.branch.trim()) {
  fail(`${MANIFEST_REL}: branch 缺失`);
}
if (!Array.isArray(manifest?.files) || manifest.files.length === 0) {
  fail(`${MANIFEST_REL}: files 必须是非空数组`);
  process.exitCode = 1;
  for (const issue of issues) process.stderr.write(`  - ${issue}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. 登记范围声明（C1：范围必须明确，范围外路径一律失败关闭）
// ---------------------------------------------------------------------------
const CLOUD_DIRS = ['cloudfunctions/checkinFaceTest', 'cloudfunctions/accountLogin', 'cloudfunctions/signedLeaseAccess'];
const ALLOWED_LOCAL = [
  'package.json',
  'miniprogram/pages/checkin/',
  'miniprogram/pages/face-enroll/',
  'miniprogram/services/api.js',
  'miniprogram/config/runtime.js',
  'miniprogram/app.json',
  'miniprogram/data/qishanyuan-test-preset.js',
  'miniprogram/pages/account-login/',
  'miniprogram/pages/profile/',
  'miniprogram/pages/life/index.js',
  'miniprogram/pages/life/index.wxml',
  'miniprogram/pages/rental/index.js',
  'miniprogram/pages/rental/index.wxml',
  'miniprogram/pages/home/index.js',
  'miniprogram/pages/messages/index.js',
  'miniprogram/pages/chat/index.js',
  'miniprogram/pages/property/index.js',
  'miniprogram/pages/unlock/index.js',
  'miniprogram/utils/require-login.js',
  'miniprogram/config/version.js',
  'miniprogram/config/version.json',
  'cloudfunctions/login/lib/identity-core.js',
  'cloudfunctions/phoneLogin/lib/identity-core.js',
  'cloudfunctions/phoneLogin/lib/phone-proof.js',
  'cloudfunctions/adminLogin/lib/identity-core.js',
  'admin-web/lib/local-cloud-database.mjs',
  'admin-web/lib/tenant-password-accounts.mjs',
  'admin-web/lib/tenant-auth-cloud-database.mjs',
  'admin-web/lib/qishanyuan-test-data.mjs',
  'admin-web/qishanyuan-demo.mjs',
  'admin-web/public/index.html',
  'admin-web/public/tenant-password-accounts.html',
  'admin-web/public/tenant-password-accounts.js',
  'admin-web/public/qishanyuan-test.html',
  'admin-web/public/qishanyuan-test.js',
  'admin-web/tests/tenant-password-accounts.test.mjs',
  'admin-web/tests/tenant-auth-cloud-database.test.mjs',
  'admin-web/tests/local-cloud-database.test.mjs',
  'admin-web/tests/tenant-password-routes.test.mjs',
  'admin-web/tests/qishanyuan-test-data.test.mjs',
  'tests/account-login-cloud.test.cjs',
  'tests/account-login-api.test.cjs',
  'tests/account-login-pages.test.cjs',
  'tests/identity.test.cjs',
  'tests/action-login-gate.test.cjs',
  'tests/action-login-public-pages.test.cjs',
  'tests/action-login-private-pages.test.cjs',
  'tests/action-login-checkin-pages.test.cjs',
  'tests/tenant-password-gates.test.cjs',
  'tests/qishanyuan-pages.test.cjs',
  'tests/qishanyuan-test-preset.test.cjs',
  'tests/phone-login.test.cjs',
  'tests/frontend.test.cjs',
  'tools/checkin-face-worker/',
  'tools/signed-remote-worker/',
  'admin-web/lib/hikvision-door.mjs',
  'admin-web/lib/signed-lease-administration.mjs',
  'admin-web/public/signed-lease-access.html',
  'admin-web/public/signed-lease-access.js',
  'admin-web/tests/signed-lease-administration.test.mjs',
  'tests/signed-lease-access-core.test.cjs',
  'tests/signed-lease-frontend.test.cjs',
  'tests/signed-lease-integration.test.cjs',
  'tests/signed-remote-legacy-boundary.test.cjs',
  'tests/signed-remote-worker.test.cjs',
  'tests/signed-remote-deadline.test.cjs',
  'admin-web/lib/checkin-face-test-config.mjs',
  'admin-web/public/checkin-face-test.html',
  'admin-web/public/checkin-face-test-config.js',
  'admin-web/server.mjs',
  'admin-web/package.json',
  'admin-web/package-lock.json',
  'admin-web/tests/checkin-face-config.test.mjs',
  'admin-web/tests/checkin-face-worker.test.mjs',
  'tests/checkin-face-api.test.cjs',
  'tests/checkin-face-pages.test.cjs',
  'tests/checkin-face-cloud-workflow.test.cjs',
  'tests/checkin-face-qa-gates.test.cjs',
  'tests/checkin-face-cross-module.test.cjs',
  'tests/support/',
  'scripts/checkin-face-static-check.mjs',
  'scripts/verify-checkin-face-sources.mjs',
  'scripts/package-release.py',
  'scripts/test-package-release.py',
  'docs/evidence/',
];

function allowedRoot(relPath) {
  if (CLOUD_DIRS.some((dir) => relPath === dir || relPath.startsWith(`${dir}/`))) return 'cloud';
  if (ALLOWED_LOCAL.some((prefix) => (prefix.endsWith('/') ? relPath.startsWith(prefix) : relPath === prefix))) {
    return 'local';
  }
  return null;
}

function isLegalRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 512) return false;
  if (value.includes('\\') || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return false;
  if (/[\x00-\x1f\x7f]/.test(value)) return false;
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) return false;
  return true;
}

const SHA256_RE = /^[a-f0-9]{64}$/i;

/**
 * 清单登记的是 Git blob 内容（独立复审按固定 Git blob 复算 10/10）。
 * 本机 core.autocrlf=true 时工作树为 CRLF：文本文件先做 CRLF→LF 再哈希，
 * 与 Git blob 一致；含 NUL 的二进制文件按原始字节哈希。规则固定、可复现。
 */
function blobSha256(buffer) {
  if (!buffer.includes(0) && buffer.includes(0x0d)) {
    const normalized = Buffer.from(buffer.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    return { hash: createHash('sha256').update(normalized).digest('hex'), normalized: true };
  }
  return { hash: createHash('sha256').update(buffer).digest('hex'), normalized: false };
}

let normalizedFiles = 0;

for (const entry of manifest.files) {
  const relPath = entry?.path;
  if (!isLegalRelativePath(relPath)) {
    fail(`清单路径非法：${JSON.stringify(relPath)}`);
    continue;
  }
  const lower = relPath.toLowerCase();
  if (seen.has(lower)) fail(`清单路径重复（大小写不敏感）：${relPath} 与 ${seen.get(lower)}`);
  seen.set(lower, relPath);
  if (relPath === MANIFEST_REL) fail(`清单不得登记自身：${relPath}`);
  if (!allowedRoot(relPath)) fail(`路径超出 checkin-face 体验版登记范围：${relPath}`);
  if (!SHA256_RE.test(String(entry?.sha256 || ''))) fail(`${relPath}: sha256 必须是 64 位十六进制`);
  if (entry?.baselineSha256 !== null && !SHA256_RE.test(String(entry.baselineSha256))) {
    fail(`${relPath}: baselineSha256 只能是 null 或真实 64 位哈希，不得伪造 originalSha256`);
  }
  if (typeof entry?.purpose !== 'string' || !entry.purpose.trim()) fail(`${relPath}: 缺少 purpose 说明`);
  const absolute = join(ROOT, ...relPath.split('/'));
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    fail(`${relPath}: 文件不存在或不是普通文件`);
    continue;
  }
  const { hash: actual, normalized } = blobSha256(readFileSync(absolute));
  if (normalized) normalizedFiles += 1;
  if (actual.toLowerCase() !== String(entry.sha256).toLowerCase()) {
    fail(`${relPath}: 磁盘哈希 ${actual} 与清单 ${entry.sha256} 不符`);
  }
  registered.add(relPath);
  entriesChecked += 1;
}

// ---------------------------------------------------------------------------
// 3. 新云函数目录闭合：每个源文件都必须登记（.js/.json/.md 一律入册，
//    接口清单文档 INTERFACES.md 属契约文件，其漂移同样必须被门禁检出）
// ---------------------------------------------------------------------------
const CLOUD_SOURCE_EXTENSIONS = ['.js', '.json', '.md'];

function walkFiles(dirAbs, extensions, baseAbs = dirAbs) {
  const result = [];
  for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
    const full = join(dirAbs, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(full, extensions, baseAbs));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      result.push(relative(baseAbs, full).replaceAll('\\', '/'));
    }
  }
  return result.sort();
}

const cloudCoverage = [];
for (const dir of CLOUD_DIRS) {
  const abs = join(ROOT, ...dir.split('/'));
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    fail(`新云函数目录不存在：${dir}`);
    continue;
  }
  const files = walkFiles(abs, CLOUD_SOURCE_EXTENSIONS);
  cloudCoverage.push(...files);
  for (const file of files) {
    if (!registered.has(`${dir}/${file}`)) fail(`新云函数目录未登记文件（闭合缺口）：${dir}/${file}`);
  }
}

// Cloud functions deploy independently. They must ship the same reviewed
// identity coordinator locally, never require a sibling function at runtime.
const authCore = readFileSync(join(ROOT, 'cloudfunctions/accountLogin/lib/identity-core.js'));
for (const fn of ['login', 'phoneLogin', 'adminLogin', 'signedLeaseAccess']) {
  const rel = `cloudfunctions/${fn}/lib/identity-core.js`;
  if (!existsAsAuthCore(rel) || !authCore.equals(readFileSync(join(ROOT, rel)))) fail(`${rel}: 登录身份协调器必须与 accountLogin 逐字节一致`);
}
function existsAsAuthCore(rel) { return existsSync(join(ROOT, rel)) && statSync(join(ROOT, rel)).isFile(); }
const remoteProof = 'cloudfunctions/signedLeaseAccess/lib/phone-proof.js';
if (!existsAsAuthCore(remoteProof) || !readFileSync(join(ROOT, remoteProof)).equals(readFileSync(join(ROOT, 'cloudfunctions/phoneLogin/lib/phone-proof.js')))) fail(`${remoteProof}: 独立部署的手机号证明helper必须与注册服务逐字节一致`);

// ---------------------------------------------------------------------------
// 4. 本地导入闭包：相对导入必须可解析；范围内的目标必须登记
// ---------------------------------------------------------------------------
const SPEC_RE = /(?:^|[^\w.'"`])(?:import\s*\(\s*|import\s+(?:[^'"`]*?\s+from\s+)?|export\s+(?:[^'"`]*?\s+from\s+)|require\s*\(\s*|createRequire\([^)]*\)\s*\(\s*)(['"])([^'"`\n]+)\1/gm;

function staticSpecifiers(source) {
  const result = [];
  for (const match of source.matchAll(SPEC_RE)) {
    const specifier = match[2] || '';
    if (specifier) result.push(specifier);
  }
  return result;
}

function resolveRelative(fromDirRel, specifier) {
  const segments = fromDirRel === '.' ? [] : fromDirRel.split('/');
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/');
}

function existsAsFile(relPath) {
  const absolute = join(ROOT, ...relPath.split('/'));
  return existsSync(absolute) && statSync(absolute).isFile();
}

function resolveImportTarget(fromDirRel, specifier) {
  const candidates = [
    specifier,
    `${specifier}.js`, `${specifier}.mjs`, `${specifier}.cjs`, `${specifier}.json`,
    `${specifier}/index.js`, `${specifier}/index.mjs`, `${specifier}/index.cjs`,
  ];
  for (const candidate of candidates) {
    const resolved = resolveRelative(fromDirRel, candidate);
    if (!resolved || resolved.startsWith('../') || resolved === '..') continue;
    if (existsAsFile(resolved)) return resolved;
  }
  return null;
}

let importsResolved = 0;
let externalImports = 0;
for (const relPath of registered) {
  const scope = allowedRoot(relPath);
  const source = readFileSync(join(ROOT, ...relPath.split('/')), 'utf8');
  // 导入闭包只对源码文件解析；文档（.md）与清单（.json）不参与静态导入解析。
  if (!/\.(?:mjs|cjs|js)$/.test(relPath)) continue;
  // 门径：import/require 关键字前不得是引号/反引号/词字符——字符串字面量里
  // “夹具写入的 import 字样”不认作本文件导入（近似口径，记录在案）。
  const fromDir = dirname(relPath);
  for (const specifier of staticSpecifiers(source)) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      externalImports += 1;
      note(`外部依赖导入（由依赖归属/锁文件负责）：${relPath} -> ${specifier}`);
      continue;
    }
    const target = resolveImportTarget(fromDir, specifier);
    if (!target) fail(`本地导入无法解析（闭包断开）：${relPath} -> ${specifier}`);
    else {
      importsResolved += 1;
      if (allowedRoot(target) && !registered.has(target)) {
        fail(`本地导入闭包未登记：${relPath} 导入 ${target}，但 ${target} 未在清单中`);
      }
      if (scope === 'cloud' && !registered.has(target) && !allowedRoot(target)) {
        // 云函数导入树外文件：旧共享模块不属于本清单，只记录。
        note(`云函数引用清单范围外文件（沿用旧文件）：${relPath} -> ${target}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. 与旧来源清单隔离：保留 scripts/verify-import.mjs 的原来源校验职责
// ---------------------------------------------------------------------------
let legacyProvenance = null;
let legacyChanges = null;
try { legacyProvenance = JSON.parse(readFileSync(join(ROOT, LEGACY_PROVENANCE_REL), 'utf8')); } catch { /* 缺旧清单时只提示 */ }
try { legacyChanges = JSON.parse(readFileSync(join(ROOT, LEGACY_CHANGES_REL), 'utf8')); } catch { /* 缺旧清单时只提示 */ }
const legacyKeys = new Set([
  ...Object.keys(legacyProvenance?.files || {}),
  ...Object.keys(legacyChanges || {}),
]);
for (const relPath of registered) {
  if (legacyKeys.has(relPath)) fail(`${relPath}: 与旧来源清单重叠，旧文件不得改走新清单（保留原来源校验职责）`);
}

// ---------------------------------------------------------------------------
// 6. 汇总
// ---------------------------------------------------------------------------
if (issues.length) {
  process.stderr.write(`[FAIL] checkin-face sources: ${issues.length} violation(s)\n`);
  for (const issue of issues) process.stderr.write(`  - ${issue}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `[PASS] checkin-face sources: ${entriesChecked} entries hash-verified (${normalizedFiles} CRLF→LF 按 Git blob 归一); ` +
    `cloud dirs ${CLOUD_DIRS.join(', ')} covered ${cloudCoverage.length} source files; ` +
    `local closure resolved ${importsResolved} import(s), ${externalImports} external import(s); ` +
    `baselineSha256 无伪造；与 docs/backend-provenance.json 无重叠；` +
    `原来源校验由 scripts/verify-import.mjs 继续承担（本脚本不替代）。\n`,
  );
}
for (const line of notes) process.stdout.write(`  [note] ${line}\n`);
