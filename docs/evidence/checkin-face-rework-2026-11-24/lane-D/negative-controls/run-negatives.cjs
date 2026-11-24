/**
 * D 路负控证据生成（只在 _lanes/D/negative-controls 自有副本上执行）。
 * R10：全树副本 ×5（基线/删mode/删validity/双删/注释掉）跑静态检查；
 * C1：清单子集副本 ×8（基线/改哈希/重复/非法路径/漏云文件/伪baseline/超范围/闭包缺口）跑来源校验。
 * 每个场景保存 stdout/stderr/exit-code 与 results.json 汇总；不动共享工作树。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const TREE = 'C:/Users/Administrator/Documents/ChatGPT/宇宙智联/SMART-PM-H3/_rework-tree';
const OUT = path.join(__dirname, 'results');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const now = new Date();

function record(name, kind, mutated, status, stdout, stderr) {
  fs.writeFileSync(path.join(OUT, `${name}.stdout.txt`), stdout);
  fs.writeFileSync(path.join(OUT, `${name}.stderr.txt`), stderr);
  fs.writeFileSync(path.join(OUT, `${name}.exit-code.txt`), String(status));
  results.push({ name, kind, mutated, exitCode: status, at: now.toISOString() });
}

function runIn(cwd, scriptRel) {
  return spawnSync(process.execPath, [path.join(cwd, ...scriptRel.split('/'))], { cwd, encoding: 'utf8' });
}

function copyTree(src, dest, { exclude = [], subset = null } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  const included = (rel) => {
    if (exclude.some((prefix) => rel === prefix || rel.startsWith(prefix + '/'))) return false;
    if (!subset) return true;
    return subset.some((prefix) => (prefix.endsWith('/') ? rel.startsWith(prefix) : rel === prefix));
  };
  const walk = (dir, base) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(base, full).replaceAll('\\', '/');
      if (entry.isDirectory()) walk(full, base);
      else if (included(rel)) {
        const to = path.join(dest, ...rel.split('/'));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(full, to);
      }
    }
  };
  walk(src, src);
}

/** 与校验器同一规则（Git blob 归一）复算哈希，让负控副本基线自洽（清单由 lead 冻结后统一更新）。 */
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
    entry.sha256 = blobSha256(fs.readFileSync(path.join(dir, ...entry.path.split('/'))));
  }
  // 补登记新云函数目录内尚未入册的源文件（.js/.json/.md，含 INTERFACES.md），
  // 使负控副本基线自洽；正式清单仍由 lead 集成冻结后统一复算。
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

// ---------------------------------------------------------------------------
// R10 负控（全树副本）
// ---------------------------------------------------------------------------
const workerRel = 'tools/checkin-face-worker/worker-runtime.mjs';
const realWorker = fs.readFileSync(path.join(TREE, workerRel), 'utf8');
const PAIR = /    mode: "device",\r?\n    validityMode: "fixed",/;

const r10Cases = [
  ['r10-baseline', (text) => text],
  ['r10-no-mode', (text) => text.replace(PAIR, '    validityMode: "fixed",')],
  ['r10-no-validity', (text) => text.replace(PAIR, '    mode: "device",')],
  ['r10-neither', (text) => text.replace(PAIR, '')],
  ['r10-commented', (text) => text
    .replace(/    mode: "device",/, '    // mode: "device",')
    .replace(/    validityMode: "fixed",/, '    // validityMode: "fixed",')],
];

for (const [name, mutate] of r10Cases) {
  const dest = path.join(__dirname, name);
  fs.rmSync(dest, { recursive: true, force: true });
  copyTree(TREE, dest, { exclude: ['.git', 'docs/evidence'] });
  const mutated = mutate(realWorker);
  if (name !== 'r10-baseline' && mutated === realWorker) {
    throw new Error(`${name}: 负控未实际命中目标行`);
  }
  fs.writeFileSync(path.join(dest, workerRel), mutated);
  const run = runIn(dest, 'scripts/checkin-face-static-check.mjs');
  record(name, 'r10', name !== 'r10-baseline', run.status, run.stdout, run.stderr);
}

// ---------------------------------------------------------------------------
// C1 负控（全树副本：清单收口后为 107 条覆盖全树，子集副本无法满足存在性校验）
// ---------------------------------------------------------------------------
function buildC1(name) {
  const dest = path.join(__dirname, name);
  fs.rmSync(dest, { recursive: true, force: true });
  copyTree(TREE, dest, { exclude: ['.git'] });
  // 多路并行编辑期间清单暂时落后；负控副本先按磁盘复算基线，再施加单一篡改。
  rebaseManifest(dest);
  return dest;
}

function manifestOf(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'checkin-face-experience-source-hashes.json'), 'utf8'));
}
function writeManifest(dir, manifest) {
  fs.writeFileSync(
    path.join(dir, 'docs', 'checkin-face-experience-source-hashes.json'),
    JSON.stringify(manifest, null, 2),
  );
}

// c1-baseline
(() => {
  const dir = buildC1('c1-baseline');
  const run = runIn(dir, 'scripts/verify-checkin-face-sources.mjs');
  record('c1-baseline', 'c1', false, run.status, run.stdout, run.stderr);
})();

// c1-hash
(() => {
  const dir = buildC1('c1-hash');
  const manifest = manifestOf(dir);
  const target = manifest.files.find((entry) => entry.path === 'cloudfunctions/checkinFaceTest/index.js');
  const original = target.sha256;
  target.sha256 = (original[0] === '0' ? '1' : '0') + original.slice(1);
  writeManifest(dir, manifest);
  const run = runIn(dir, 'scripts/verify-checkin-face-sources.mjs');
  record('c1-hash', 'c1', true, run.status, run.stdout, run.stderr);
})();

// c1-dup
(() => {
  const dir = buildC1('c1-dup');
  const manifest = manifestOf(dir);
  manifest.files.push(JSON.parse(JSON.stringify(manifest.files[1])));
  writeManifest(dir, manifest);
  const run = runIn(dir, 'scripts/verify-checkin-face-sources.mjs');
  record('c1-dup', 'c1', true, run.status, run.stdout, run.stderr);
})();

// c1-illegal
(() => {
  const dir = buildC1('c1-illegal');
  const manifest = manifestOf(dir);
  manifest.files[1].path = '../cloudfunctions/checkinFaceTest/index.js';
  writeManifest(dir, manifest);
  const run = runIn(dir, 'scripts/verify-checkin-face-sources.mjs');
  record('c1-illegal', 'c1', true, run.status, run.stdout, run.stderr);
})();

// c1-missing (cloud closure gap)
(() => {
  const dir = buildC1('c1-missing');
  const manifest = manifestOf(dir);
  manifest.files = manifest.files.filter((entry) => entry.path !== 'cloudfunctions/checkinFaceTest/lib/config.js');
  writeManifest(dir, manifest);
  const run = runIn(dir, 'scripts/verify-checkin-face-sources.mjs');
  record('c1-missing', 'c1', true, run.status, run.stdout, run.stderr);
})();

// c1-fake-baseline
(() => {
  const dir = buildC1('c1-fake-baseline');
  const manifest = manifestOf(dir);
  manifest.files[0].baselineSha256 = 'this-is-not-a-hash';
  writeManifest(dir, manifest);
  const run = runIn(dir, 'scripts/verify-checkin-face-sources.mjs');
  record('c1-fake-baseline', 'c1', true, run.status, run.stdout, run.stderr);
})();

// c1-scope
(() => {
  const dir = buildC1('c1-scope');
  const manifest = manifestOf(dir);
  manifest.files[0].path = 'cloudfunctions/dbInit/index.js';
  writeManifest(dir, manifest);
  const run = runIn(dir, 'scripts/verify-checkin-face-sources.mjs');
  record('c1-scope', 'c1', true, run.status, run.stdout, run.stderr);
})();

// c1-closure (local import closure gap)
(() => {
  const dir = buildC1('c1-closure');
  const extra = path.join(dir, 'miniprogram', 'pages', 'checkin', 'fake-extra.js');
  const helper = path.join(dir, 'miniprogram', 'pages', 'checkin', 'fake-helper.js');
  fs.mkdirSync(path.dirname(extra), { recursive: true });
  fs.writeFileSync(extra, "import helper from './fake-helper.js';\nexport default helper;\n");
  fs.writeFileSync(helper, 'export default 1;\n');
  const manifest = manifestOf(dir);
  manifest.files.push({
    path: 'miniprogram/pages/checkin/fake-extra.js',
    sha256: createHash('sha256').update(fs.readFileSync(extra)).digest('hex'),
    purpose: '负控夹具：本地导入闭包未闭合',
    baselineSha256: null,
  });
  writeManifest(dir, manifest);
  const run = runIn(dir, 'scripts/verify-checkin-face-sources.mjs');
  record('c1-closure', 'c1', true, run.status, run.stdout, run.stderr);
})();

fs.writeFileSync(
  path.join(OUT, 'results.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      tree: TREE,
    },
    cases: results,
    note: 'C1 负控副本先按磁盘复算清单基线（rebaseManifest，与校验器同一 blob 归一规则），再施加单一篡改；共享树上的正式清单由 lead 在集成冻结后统一复算更新，本负控不抢写。',
    expectation: {
      'r10-baseline': 'exit 0（负控基线）',
      'r10-no-mode': 'exit 1，仅 mode 消息',
      'r10-no-validity': 'exit 1，仅 validity 消息',
      'r10-neither': 'exit 1，两条消息',
      'r10-commented': 'exit 1，两条消息（注释命中不算）',
      'c1-baseline': 'exit 0（负控基线）',
      'c1-hash': 'exit 1，磁盘哈希不符',
      'c1-dup': 'exit 1，路径重复',
      'c1-illegal': 'exit 1，路径非法',
      'c1-missing': 'exit 1，云目录闭合缺口',
      'c1-fake-baseline': 'exit 1，伪造 baselineSha256',
      'c1-scope': 'exit 1，超出登记范围',
      'c1-closure': 'exit 1，本地导入闭包未登记',
    },
  }, null, 2),
);
console.log(JSON.stringify(results, null, 2));
