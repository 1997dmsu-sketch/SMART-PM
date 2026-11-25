'use strict';

/**
 * D 路门禁测试（checkin-face 退修 0d6c674）——R10 静态门禁 + C1 来源校验器 + 网络守卫。
 *
 * 运行方式（业务模块加载前安装不转发网络守卫）：
 *   node --require <root>/tests/support/d-network-guard.cjs --test tests/checkin-face-qa-gates.test.cjs
 * 原始模式（不预载守卫）只用于记录降级差异，本文件的守卫用例会在该模式下精确失败。
 *
 * 全部用例为合成/本机文件级验证：不连接设备、云或微信；负控只在本次新建的
 * 临时副本上进行，绝不动共享工作树的其他文件。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const STATIC_CHECK = path.join(ROOT, 'scripts', 'checkin-face-static-check.mjs');
const SOURCE_VERIFY = path.join(ROOT, 'scripts', 'verify-checkin-face-sources.mjs');
const GUARD = path.join(ROOT, 'tests', 'support', 'd-network-guard.cjs');
const WORKER_RUNTIME = path.join(ROOT, 'tools', 'checkin-face-worker', 'worker-runtime.mjs');

const MODE_MSG = 'worker 请求构造必须显式 mode=device（缺失即失败）';
const VALIDITY_MSG = 'worker 请求构造必须显式 validityMode=fixed（缺失即失败）';
const networkGuard = globalThis.__DSH_D_NETWORK_GUARD__;
const businessBaselines = new Map();
test.before(() => {
  assert.ok(networkGuard, 'The D guard must be preloaded before any test or business import');
  networkGuard.assertLoadTimeClean();
});
test.beforeEach((t) => { businessBaselines.set(t.name, networkGuard.snapshot()); });
test.afterEach((t) => {
  if (!t.name.startsWith('guard：')) networkGuard.assertNoViolations(businessBaselines.get(t.name), t.name);
});


function tmpdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `d-qa-${label}-`));
}

function runNode(args, cwd) {
  const env = { ...process.env };
  // A deliberately nested test-runner negative control needs a fresh runner
  // context. Keep NODE_OPTIONS intact so the network guard still propagates.
  if (args.includes('--test')) delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8' });
}

function copyTree(src, dest, relPaths) {
  for (const rel of relPaths) {
    const from = path.join(src, ...rel.split('/'));
    const to = path.join(dest, ...rel.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

function copyFullTree(src, dest, { excludeDirs = ['.git', 'node_modules', 'dist', '.data', '.cache', '.artifacts'] } = {}) {
  const walk = (dir, base) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (excludeDirs.includes(entry.name)) continue;
        walk(full, base);
      } else {
        if (entry.isSymbolicLink()) throw new Error('SYNTHETIC_COPY_SYMLINK_REJECTED');
        if (/^\.env(?:\.|$)|\.local\.json$|\.(?:pem|pfx|key)$/i.test(entry.name) || entry.name === 'project.private.config.json') continue;
        const rel = path.relative(base, full).replaceAll('\\', '/');
        const to = path.join(dest, ...rel.split('/'));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(full, to);
      }
    }
  };
  walk(src, src);
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const realWorkerSource = fs.readFileSync(WORKER_RUNTIME, 'utf8');
// 以真实文件内容做最小静态树：负控只改本副本内的 worker-runtime 构造段落。
function buildStaticTree(label) {
  const dir = tmpdir(`r10-${label}`);
  copyTree(ROOT, dir, [
    'scripts/checkin-face-static-check.mjs',
    'tools/checkin-face-worker/worker-runtime.mjs',
    'tools/checkin-face-worker/claim-and-enroll.mjs',
    '.gitignore',
    'miniprogram/config/runtime.js',
    'miniprogram/services/api.js',
  ]);
  fs.mkdirSync(path.join(dir, 'miniprogram', 'pages', 'checkin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'miniprogram', 'pages', 'face-enroll'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'cloudfunctions', 'checkinFaceTest'), { recursive: true });
  return dir;
}

function buildSourcesTree(label) {
  // 清单收口后为 107 条（覆盖全树新/改文件）：负控必须用全树副本，再按磁盘复算基线。
  const dir = tmpdir(`c1-${label}`);
  copyFullTree(ROOT, dir);
  rebaseManifest(dir);
  return dir;
}

/**
 * 与校验器同一规则（Git blob 归一：文本 CRLF→LF，二进制按原始字节）复算哈希。
 * 多路并行编辑期间清单会暂时落后；负控副本先按磁盘复算基线，再施加单一篡改，
 * 保证每条负控只命中自己的断言。
 */
function blobSha256(buffer) {
  if (!buffer.includes(0) && buffer.includes(0x0d)) {
    const normalized = Buffer.from(buffer.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    return createHash('sha256').update(normalized).digest('hex');
  }
  return createHash('sha256').update(buffer).digest('hex');
}

function rebaseManifest(dir) {
  const file = path.join(dir, 'docs', 'checkin-face-experience-source-hashes.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const entry of manifest.files) {
    const absolute = path.join(dir, ...entry.path.split('/'));
    entry.sha256 = blobSha256(fs.readFileSync(absolute));
  }
  // 补登记新云函数目录内尚未入册的源文件（.js/.json/.md，含 INTERFACES.md），
  // 使负控副本基线自洽；正式清单仍由 lead 集成冻结后统一复算，本负控不抢写。
  const registeredPaths = new Set(manifest.files.map((entry) => entry.path));
  const cloudRoot = path.join(dir, 'cloudfunctions', 'checkinFaceTest');
  const collect = (abs, base) => {
    const found = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const full = path.join(abs, entry.name);
      if (entry.isDirectory()) found.push(...collect(full, base));
      else if (/\.(js|json|md)$/.test(entry.name)) found.push(path.relative(base, full).replaceAll('\\', '/'));
    }
    return found;
  };
  for (const rel of collect(cloudRoot, cloudRoot)) {
    const entryPath = `cloudfunctions/checkinFaceTest/${rel}`;
    if (!registeredPaths.has(entryPath)) {
      manifest.files.push({
        path: entryPath,
        sha256: blobSha256(fs.readFileSync(path.join(dir, ...entryPath.split('/')))),
        purpose: '负控基线自动补登记（正式清单由 lead 冻结后更新）',
        baselineSha256: null,
      });
    }
  }
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
}

function readManifest(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'checkin-face-experience-source-hashes.json'), 'utf8'));
}

function writeManifest(dir, manifest) {
  fs.writeFileSync(
    path.join(dir, 'docs', 'checkin-face-experience-source-hashes.json'),
    JSON.stringify(manifest, null, 2),
  );
}

// ---------------------------------------------------------------------------
// 网络守卫：加载前安装、命名绑定、自检不转发、子进程继承、原始/降级分列
// ---------------------------------------------------------------------------

test('guard：本进程在业务模块加载前已安装命名守卫，逐槽哨兵与ESM绑定均受控', async (t) => {
  const guard = globalThis.__DSH_D_NETWORK_GUARD__;
  assert.ok(
    guard,
    '未安装 d-network-guard（本套件要求 --require tests/support/d-network-guard.cjs 预载）；原始模式运行视为降级，另行记录',
  );
  assert.equal(guard.name, 'd-network-guard');
  for (const label of [
    'net.Server.prototype.listen', 'net.Socket.prototype.connect', 'dgram.createSocket',
    'dgram.Socket.prototype.send', 'dgram.Socket.prototype.bind', 'dgram.Socket.prototype.connect',
    'dns.reverse', 'dns.promises.lookupService', 'dns.Resolver.prototype.resolve',
    'dns.promises.Resolver.prototype.resolve',
  ]) assert.ok(guard.patchedEntries.includes(label), `missing required network/listen entry: ${label}`);
  assert.equal(guard.patchedCount, guard.patchedEntries.length);
  const loadTime = guard.loadTimeSnapshot();
  assert.equal(loadTime.blocked, 0);
  assert.equal(loadTime.forwarded, 0);
  assert.ok(loadTime.entries.every((entry) => entry.blocked === 0 && entry.forwarded === 0));
  const self = guard.selfTest();
  assert.equal(self.ok, true, JSON.stringify(self));
  assert.equal(self.forwarded, 0, '任何守卫入口都不得转发真实目标');
  assert.equal(self.attempts, guard.patchedCount, 'every installed slot must have an actual positive control');
  assert.ok(self.caught === self.attempts && self.blockedDelta === self.attempts);
  const bindings = await guard.verifyNamedBindings();
  assert.equal(bindings.ok, true);
  assert.ok(bindings.checked > 0, 'ESM named imports must point at the guarded functions');
  t.diagnostic(JSON.stringify({ entries: guard.patchedEntries, loadTime, selfTest: self, esm: bindings }));
});

test('guard：子进程经 --require 继承守卫（继承后同样拦截且不转发）', () => {
  const childCode = [
    "const net = require('node:net');",
    "const guard = globalThis.__DSH_D_NETWORK_GUARD__;",
    "let caught = 0; try { net.connect(80, 'inherit-probe.invalid'); } catch (e) { if (e && e.code === 'D_NETWORK_GUARD_BLOCKED') caught += 1; }",
    "const self = guard && typeof guard.selfTest === 'function' ? guard.selfTest() : null;",
    "process.stdout.write(JSON.stringify({ present: !!guard, name: guard && guard.name, caught, self }));",
  ].join('\n');
  const result = runNode(['--require', GUARD, '-e', childCode], ROOT);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.present, true);
  assert.equal(report.name, 'd-network-guard');
  assert.equal(report.caught, 1, '子进程内的网络调用必须被拦截');
  assert.equal(report.self.ok, true);
  assert.equal(report.self.forwarded, 0, '子进程守卫同样不转发');
});

test('guard：未显式 --require 的子进程仍经 NODE_OPTIONS 自动继承守卫', () => {
  const childCode = [
    "const guard = globalThis.__DSH_D_NETWORK_GUARD__;",
    "process.stdout.write(JSON.stringify({ present: !!guard, name: guard && guard.name }));",
  ].join('\n');
  const result = runNode(['-e', childCode], ROOT);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.present, true, '嵌套 Node 子进程必须自动继承守卫');
  assert.equal(report.name, 'd-network-guard');
});

// ---------------------------------------------------------------------------
// R10：mode=device 与 validityMode=fixed 逐项断言 + 精确负控
// ---------------------------------------------------------------------------

test('R10：当前共享树静态检查通过（0 violations）', () => {
  const result = runNode([STATIC_CHECK], ROOT);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 violations/);
  assert.match(result.stdout, /source files scanned/);
});

test('R10：未变更副本静态检查通过（负控基线）', () => {
  const dir = buildStaticTree('baseline');
  const result = runNode([path.join(dir, 'scripts', 'checkin-face-static-check.mjs')], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 violations/);
});

test('R10：移除 mode=device → 只报 mode 专属消息，精确失败', () => {
  const dir = buildStaticTree('no-mode');
  const file = path.join(dir, 'tools', 'checkin-face-worker', 'worker-runtime.mjs');
  const mutated = realWorkerSource.replace(
    /    mode: "device",\r?\n    validityMode: "fixed",/,
    '    validityMode: "fixed",',
  );
  assert.notEqual(mutated, realWorkerSource, '负控必须实际改到目标行');
  fs.writeFileSync(file, mutated);
  const result = runNode([path.join(dir, 'scripts', 'checkin-face-static-check.mjs')], dir);
  assert.equal(result.status, 1, '移除 mode=device 必须失败');
  assert.match(result.stderr, /worker-runtime\.mjs:1: worker 请求构造必须显式 mode=device/);
  assert.ok(!result.stderr.includes(VALIDITY_MSG), `不得误报 validity：${result.stderr}`);
});

test('R10：移除 validityMode=fixed → 只报 validity 专属消息，精确失败', () => {
  const dir = buildStaticTree('no-validity');
  const file = path.join(dir, 'tools', 'checkin-face-worker', 'worker-runtime.mjs');
  const mutated = realWorkerSource.replace(
    /    mode: "device",\r?\n    validityMode: "fixed",/,
    '    mode: "device",',
  );
  assert.notEqual(mutated, realWorkerSource, '负控必须实际改到目标行');
  fs.writeFileSync(file, mutated);
  const result = runNode([path.join(dir, 'scripts', 'checkin-face-static-check.mjs')], dir);
  assert.equal(result.status, 1, '移除 validityMode=fixed 必须失败');
  assert.match(result.stderr, /worker-runtime\.mjs:1: worker 请求构造必须显式 validityMode=fixed/);
  assert.ok(!result.stderr.includes(MODE_MSG), `不得误报 mode：${result.stderr}`);
});

test('R10：两项都移除 → 两条专属消息同时出现', () => {
  const dir = buildStaticTree('neither');
  const file = path.join(dir, 'tools', 'checkin-face-worker', 'worker-runtime.mjs');
  fs.writeFileSync(
    file,
    realWorkerSource.replace(/    mode: "device",\r?\n    validityMode: "fixed",/, ''),
  );
  const result = runNode([path.join(dir, 'scripts', 'checkin-face-static-check.mjs')], dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /必须显式 mode=device/);
  assert.match(result.stderr, /必须显式 validityMode=fixed/);
});

test('R10：把两项改成注释 → 仍双双失败（注释命中不算证据）', () => {
  const dir = buildStaticTree('commented');
  const file = path.join(dir, 'tools', 'checkin-face-worker', 'worker-runtime.mjs');
  const mutated = realWorkerSource
    .replace(/    mode: "device",/, '    // mode: "device",')
    .replace(/    validityMode: "fixed",/, '    // validityMode: "fixed",');
  // 只改首个出现点：失败输出对象里的第二个 validityMode 原样保留，
  // 以此证明门禁只看与 consent:true 共置的请求构造处，而不是文件内
  // 任意位置的同名字符串。
  assert.match(mutated, /\n    validityMode: "fixed",/m, '对照组第二处 validityMode 必须保留');
  assert.match(mutated, /\/\/ mode: "device"/);
  fs.writeFileSync(file, mutated);
  const result = runNode([path.join(dir, 'scripts', 'checkin-face-static-check.mjs')], dir);
  assert.equal(result.status, 1, '注释掉的构造必须判缺失');
  assert.match(result.stderr, /必须显式 mode=device/);
  assert.match(result.stderr, /必须显式 validityMode=fixed/);
});

test('R10：真实字段删除后多行块注释不能冒充请求构造', () => {
  const dir = buildStaticTree('multiline-comment');
  const file = path.join(dir, 'tools/checkin-face-worker/worker-runtime.mjs');
  const mutated = realWorkerSource.replace(
    /    mode: "device",\r?\n    validityMode: "fixed",/,
    '    /*\n    mode: "device",\n    validityMode: "fixed",\n    */',
  );
  assert.notEqual(mutated, realWorkerSource);
  fs.writeFileSync(file, mutated);
  const result = runNode([path.join(dir, 'scripts/checkin-face-static-check.mjs')], dir);
  assert.equal(result.status, 1, 'cross-line comment literals are not executable request fields');
  assert.match(result.stderr, /必须显式 mode=device/);
  assert.match(result.stderr, /必须显式 validityMode=fixed/);
});

test('R10：分散假consent锚点、字符串及其他对象不能补齐真实request字段', () => {
  const dir = buildStaticTree('decoy-anchors');
  const file = path.join(dir, 'tools/checkin-face-worker/worker-runtime.mjs');
  const mutated = realWorkerSource.replace(/    mode: "device",\r?\n    validityMode: "fixed",/, '')
    + '\nconst decoyMode = { consent: true, mode: "device" };\n'
    + 'const decoyValidity = { consent: true, validityMode: "fixed" };\n'
    + `const decoyText = "const request = { consent: true, mode: 'device', validityMode: 'fixed' }";\n`;
  assert.notEqual(mutated, realWorkerSource);
  fs.writeFileSync(file, mutated);
  const result = runNode([path.join(dir, 'scripts/checkin-face-static-check.mjs')], dir);
  assert.equal(result.status, 1, 'facts cannot be accumulated across unrelated objects or quoted source');
  assert.match(result.stderr, /必须显式 mode=device/);
  assert.match(result.stderr, /必须显式 validityMode=fixed/);
});

// ---------------------------------------------------------------------------
// C1：新文件来源清单校验器 + 精确负控（全部在自有副本上）
// ---------------------------------------------------------------------------

test('C1：共享树冻结清单必须与磁盘一致，任何来源违规均失败关闭', () => {
  const result = runNode([SOURCE_VERIFY], ROOT);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /entries hash-verified/);
  assert.match(result.stdout, /covered \d+ source files/);
  assert.match(result.stdout, /verify-import\.mjs/);
  assert.match(result.stdout, /无伪造/);
});

test('C1：未变更副本校验通过（负控基线）', () => {
  const dir = buildSourcesTree('baseline');
  const result = runNode([path.join(dir, 'scripts', 'verify-checkin-face-sources.mjs')], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /entries hash-verified/);
  assert.match(result.stdout, /covered \d+ source files/);
});

test('C1：篡改任一清单哈希 → 精确失败并指出路径与实际哈希', () => {
  const dir = buildSourcesTree('hash');
  const manifest = readManifest(dir);
  const target = manifest.files.find((entry) => entry.path === 'cloudfunctions/checkinFaceTest/index.js');
  assert.ok(target, '负控目标必须在清单中');
  const original = target.sha256;
  target.sha256 = (original[0] === '0' ? '1' : '0') + original.slice(1);
  writeManifest(dir, manifest);
  const result = runNode([path.join(dir, 'scripts', 'verify-checkin-face-sources.mjs')], dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cloudfunctions\/checkinFaceTest\/index\.js: 磁盘哈希/);
});

test('C1：清单路径重复 → 精确失败', () => {
  const dir = buildSourcesTree('dup');
  const manifest = readManifest(dir);
  manifest.files.push(JSON.parse(JSON.stringify(manifest.files[1])));
  writeManifest(dir, manifest);
  const result = runNode([path.join(dir, 'scripts', 'verify-checkin-face-sources.mjs')], dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /清单路径重复/);
});

test('C1：非法路径（../ 穿越）→ 精确失败', () => {
  const dir = buildSourcesTree('illegal');
  const manifest = readManifest(dir);
  manifest.files[1].path = '../cloudfunctions/checkinFaceTest/index.js';
  writeManifest(dir, manifest);
  const result = runNode([path.join(dir, 'scripts', 'verify-checkin-face-sources.mjs')], dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /清单路径非法/);
});

test('C1：遗漏云函数目录内文件 → 闭合缺口失败', () => {
  const dir = buildSourcesTree('closure');
  const manifest = readManifest(dir);
  manifest.files = manifest.files.filter((entry) => entry.path !== 'cloudfunctions/checkinFaceTest/lib/config.js');
  writeManifest(dir, manifest);
  const result = runNode([path.join(dir, 'scripts', 'verify-checkin-face-sources.mjs')], dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cloudfunctions\/checkinFaceTest\/lib\/config\.js/);
  assert.match(result.stderr, /闭合缺口/);
});

test('C1：伪造 baselineSha256 → 拒绝（不伪造 originalSha256）', () => {
  const dir = buildSourcesTree('fake-baseline');
  const manifest = readManifest(dir);
  manifest.files[0].baselineSha256 = 'this-is-not-a-hash';
  writeManifest(dir, manifest);
  const result = runNode([path.join(dir, 'scripts', 'verify-checkin-face-sources.mjs')], dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /不得伪造 originalSha256/);
});

test('C1：登记范围外路径（旧云函数目录）→ 拒绝', () => {
  const dir = buildSourcesTree('scope');
  const manifest = readManifest(dir);
  manifest.files[0].path = 'cloudfunctions/dbInit/index.js';
  writeManifest(dir, manifest);
  const result = runNode([path.join(dir, 'scripts', 'verify-checkin-face-sources.mjs')], dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /路径超出 checkin-face 体验版登记范围/);
});

test('C1：本地导入闭包未闭合（新文件导入未登记的体验版新文件）→ 失败', () => {
  const dir = buildSourcesTree('local-closure');
  const extra = path.join(dir, 'miniprogram', 'pages', 'checkin', 'fake-extra.js');
  const helper = path.join(dir, 'miniprogram', 'pages', 'checkin', 'fake-helper.js');
  writeText(extra, "import helper from './fake-helper.js';\nexport default helper;\n");
  writeText(helper, 'export default 1;\n');
  const manifest = readManifest(dir);
  manifest.files.push({
    path: 'miniprogram/pages/checkin/fake-extra.js',
    sha256: createHash('sha256').update(fs.readFileSync(extra)).digest('hex'),
    purpose: '负控夹具：本地导入闭包未闭合',
    baselineSha256: null,
  });
  writeManifest(dir, manifest);
  const result = runNode([path.join(dir, 'scripts', 'verify-checkin-face-sources.mjs')], dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /本地导入闭包未登记/);
  assert.match(result.stderr, /fake-helper\.js/);
});


test('C1：源码漂移但不更新清单，专用校验与正式共享树用例均必须失败', () => {
  const dir = buildSourcesTree('frozen-source-drift');
  const file = path.join(dir, 'cloudfunctions/checkinFaceTest/lib/workflow.js');
  const manifestFile = path.join(dir, 'docs/checkin-face-experience-source-hashes.json');
  const beforeManifest = fs.readFileSync(manifestFile);
  fs.appendFileSync(file, '\n// Synthetic review source drift; frozen manifest stays unchanged.\n');
  const verifier = runNode([path.join(dir, 'scripts/verify-checkin-face-sources.mjs')], dir);
  assert.equal(verifier.status, 1);
  assert.match(verifier.stderr, /cloudfunctions\/checkinFaceTest\/lib\/workflow\.js: 磁盘哈希/);
  const formal = runNode([
    '--test', '--test-reporter=tap', '--test-name-pattern=^C1：共享树冻结清单',
    path.join(dir, 'tests/checkin-face-qa-gates.test.cjs'),
  ], dir);
  assert.equal(formal.status, 1, `the actual frozen-tree test must not count source-verifier rejection as PASS: ${formal.stdout} ${formal.stderr}`);
  assert.match(formal.stdout, /not ok .*C1：共享树冻结清单/);
  assert.match(formal.stdout, /# fail 1\b/);
  assert.deepEqual(fs.readFileSync(manifestFile), beforeManifest);
});

// ---------------------------------------------------------------------------
// CF-R2-11：同名 getter/method 与构造后 request.mode 覆盖的绕过识别 + 回归
// ---------------------------------------------------------------------------

const CF_R2_11_OVERRIDE_MSG = /request 硬要求字段不得被同名 getter\/method\/重复字段覆盖或扩展（CF-R2-11）/;
const CF_R2_11_POST_MSG = /request 构造后不得再赋值覆盖 mode\/validityMode\/consent（CF-R2-11）/;

test('CF-R2-11：同名 getter 覆盖 mode → 门禁精确失败（绕过负例）', () => {
  const dir = buildStaticTree('cfr2-getter');
  const file = path.join(dir, 'tools', 'checkin-face-worker', 'worker-runtime.mjs');
  const mutated = realWorkerSource.replace(
    '    consent: true,',
    '    consent: true,\n    get mode() { return "simulation"; },',
  );
  assert.notEqual(mutated, realWorkerSource, '负控必须实际注入同名 getter');
  fs.writeFileSync(file, mutated);
  const result = runNode([path.join(dir, 'scripts', 'checkin-face-static-check.mjs')], dir);
  assert.equal(result.status, 1, '同名 getter 覆盖必须被门禁拒绝');
  assert.match(result.stderr, CF_R2_11_OVERRIDE_MSG);
});

test('CF-R2-11：同名 method 覆盖 mode → 门禁精确失败（绕过负例）', () => {
  const dir = buildStaticTree('cfr2-method');
  const file = path.join(dir, 'tools', 'checkin-face-worker', 'worker-runtime.mjs');
  const mutated = realWorkerSource.replace(
    '    consent: true,',
    '    consent: true,\n    mode() { return "simulation"; },',
  );
  assert.notEqual(mutated, realWorkerSource, '负控必须实际注入同名 method');
  fs.writeFileSync(file, mutated);
  const result = runNode([path.join(dir, 'scripts', 'checkin-face-static-check.mjs')], dir);
  assert.equal(result.status, 1, '同名 method 覆盖必须被门禁拒绝');
  assert.match(result.stderr, CF_R2_11_OVERRIDE_MSG);
});

test('CF-R2-11：构造后 request.mode = "simulation" 覆盖 → 门禁精确失败（绕过负例）', () => {
  const dir = buildStaticTree('cfr2-post');
  const file = path.join(dir, 'tools', 'checkin-face-worker', 'worker-runtime.mjs');
  const mutated = `${realWorkerSource}\nrequest.mode = "simulation";\n`;
  assert.notEqual(mutated, realWorkerSource, '负控必须实际注入构造后赋值');
  fs.writeFileSync(file, mutated);
  const result = runNode([path.join(dir, 'scripts', 'checkin-face-static-check.mjs')], dir);
  assert.equal(result.status, 1, '构造后覆盖 request.mode 必须被门禁拒绝');
  assert.match(result.stderr, CF_R2_11_POST_MSG);
});

test('CF-R2-11：正常字面量构造对照（正例）→ 门禁通过', () => {
  const dir = buildStaticTree('cfr2-positive');
  const result = runNode([path.join(dir, 'scripts', 'checkin-face-static-check.mjs')], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 violations/);
});

// ---------------------------------------------------------------------------
// CF-R2-12：与原目标相连的 canary（正控计数→负控零计数→顺序恢复→子进程继承）
// ---------------------------------------------------------------------------

test('guard：CF-R2-12 原目标相连 canary：正控计数增加、拦截时零计数、基线不清零', async (t) => {
  const guard = globalThis.__DSH_D_NETWORK_GUARD__;
  assert.ok(guard, '本套件要求守卫预载');
  const canary = await guard.originalCanary();
  assert.equal(canary.ok, true);
  assert.ok(canary.exercised >= 1, '至少一个槽必须以真实原函数完成相连正控');
  assert.ok(canary.blockedCount >= 1, '不可安全委托的槽必须显式 BLOCKED');
  for (const entry of canary.entries) {
    if (entry.status === 'ok') {
      assert.equal(entry.originalInvokedDelta, 1, `${entry.name}: 调用原目标必须使计数 +1`);
      assert.equal(entry.restored, true, `${entry.name}: finally 必须恢复 record.impl`);
    } else {
      assert.ok(entry.reason, `${entry.name}: BLOCKED 槽必须给出原因，不得静默跳过`);
    }
  }
  // 负控：guard 拦截路径不得调用任何原目标
  const before = guard.snapshot();
  let blockedCode = null;
  try { require('node:net').connect(80, 'cfr2-neg.invalid'); } catch (error) { blockedCode = error.code; }
  assert.equal(blockedCode, 'D_NETWORK_GUARD_BLOCKED');
  const after = guard.snapshot();
  assert.equal(after.originalInvoked, before.originalInvoked, '拦截时原目标调用计数必须为零增长');
  assert.equal(after.blocked, before.blocked + 1);
  assert.ok(after.entries.every((entry, i) => entry.originalInvoked === before.entries[i].originalInvoked));
  // 加载期基线复断言不得清零 canary 计数
  const countBefore = guard.snapshot().originalInvoked;
  assert.ok(countBefore > 0, '前置正控必须已产生原目标计数');
  guard.assertLoadTimeClean();
  assert.equal(guard.snapshot().originalInvoked, countBefore, 'assertLoadTimeClean 不得清零计数掩盖调用');
  t.diagnostic(JSON.stringify({
    version: guard.version, exercised: canary.exercised, blockedCount: canary.blockedCount,
    originalInvoked: countBefore,
  }));
});

test('guard：CF-R2-12 捕获/替换/恢复顺序与 finally 恢复（子进程验证）', () => {
  const childCode = [
    "const net = require('node:net');",
    "const guard = globalThis.__DSH_D_NETWORK_GUARD__;",
    "const before = net.connect;",
    "(async () => {",
    "  const canary = await guard.originalCanary();",
    "  const restoredAll = canary.entries.every((e) => e.status !== 'ok' || e.restored === true);",
    "  const res = guard.restore();",
    "  const orderReverse = JSON.stringify(res.order) === JSON.stringify([...guard.captureOrder].reverse());",
    "  const wrapperReplaced = net.connect !== before;",
    "  process.stdout.write(JSON.stringify({ canaryOk: canary.ok, exercised: canary.exercised, blockedCount: canary.blockedCount,",
    "    restoredAll, restoreOk: res.ok, restoredCount: res.restored, orderReverse, wrapperReplaced,",
    "    captureCount: guard.captureOrder.length }));",
    "})().catch((e) => { process.stdout.write(JSON.stringify({ error: String(e && e.message) })); process.exitCode = 1; });",
  ].join('\n');
  const result = runNode(['--require', GUARD, '-e', childCode], ROOT);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.canaryOk, true);
  assert.ok(report.exercised >= 1);
  assert.equal(report.restoredAll, true, 'canary 的 finally 必须恢复每个委托槽');
  assert.equal(report.restoreOk, true);
  assert.equal(report.restoredCount, report.captureCount);
  assert.equal(report.orderReverse, true, 'restore 必须按捕获顺序逆序恢复');
  assert.equal(report.wrapperReplaced, true, 'restore 后包装器必须被原始函数替换（guard 内部 RESTORE_IDENTITY/DESCRIPTOR 断言已通过）');
});

test('guard：CF-R2-12 子进程经 NODE_OPTIONS 继承的原目标 canary 正控', () => {
  const childCode = [
    "const guard = globalThis.__DSH_D_NETWORK_GUARD__;",
    "(async () => {",
    "  const canary = await guard.originalCanary();",
    "  process.stdout.write(JSON.stringify({ version: guard && guard.version,",
    "    ok: canary && canary.ok, exercised: canary && canary.exercised, blockedCount: canary && canary.blockedCount }));",
    "})().catch((e) => { process.stdout.write(JSON.stringify({ error: String(e && e.message) })); process.exitCode = 1; });",
  ].join('\n');
  const result = runNode(['-e', childCode], ROOT);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.version, 3, '子进程必须继承 v3 守卫');
  assert.equal(report.ok, true);
  assert.ok(report.exercised >= 1, '子进程内原目标相连 canary 必须有效');
  assert.ok(report.blockedCount >= 1);
});
