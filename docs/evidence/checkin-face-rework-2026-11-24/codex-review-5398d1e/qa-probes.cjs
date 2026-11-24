'use strict';

// Review-only negative controls. Never import or execute the application or worker.
// All mutations are confined to new temporary source copies in this evidence dir.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const CANDIDATE = '/workspace/SMART-PM-review-checkin-face-5398d1e';
const OUT = __dirname;
const RUN_SUFFIX = '-attempt2';
const GUARD = path.join(OUT, 'review-network-guard.cjs');
const sha = (value) => createHash('sha256').update(value).digest('hex');
assert.ok((process.env.NODE_OPTIONS || '').includes(GUARD), 'The review guard must be inherited by every Node child');

function run(label, args, cwd) {
  const child = spawnSync(process.execPath, args, {
    cwd, env: process.env, encoding: 'utf8', timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const report = {
    command: [process.execPath, ...args], cwd,
    status: child.status, signal: child.signal,
    errorCode: child.error?.code || null,
    stdout: child.stdout || '', stderr: child.stderr || '',
  };
  fs.writeFileSync(path.join(OUT, `${label}${RUN_SUFFIX}.json`), JSON.stringify(report, null, 2) + '\n');
  assert.equal(report.signal, null, `${label}: interrupted`);
  assert.equal(report.errorCode, null, `${label}: spawn failed`);
  return report;
}

function copyFile(relative, destination) {
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(CANDIDATE, relative), target);
}

function rejectLocalInputs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    assert.ok(!entry.isSymbolicLink(), 'No links are permitted in the review source copy');
    assert.notEqual(entry.name, 'node_modules', 'Do not copy dependencies');
    assert.ok(!/^\.env(?:\.|$)/.test(entry.name), 'Do not copy environment files');
    assert.ok(!/\.local\.json$|\.(?:pem|pfx|key)$/i.test(entry.name), 'Do not copy local configuration or private material');
    if (entry.isDirectory()) rejectLocalInputs(path.join(dir, entry.name));
  }
}
rejectLocalInputs(CANDIDATE);

const protectedPaths = [
  'tools/checkin-face-worker/worker-runtime.mjs',
  'cloudfunctions/checkinFaceTest/lib/workflow.js',
  'docs/checkin-face-experience-source-hashes.json',
  'tests/checkin-face-qa-gates.test.cjs',
];
const originalHashes = Object.fromEntries(protectedPaths.map((file) => [file, sha(fs.readFileSync(path.join(CANDIDATE, file)))]));

// R10: an actual request loses both fields, yet equivalent block-comment text
// without leading asterisks remains within the static checker's anchor window.
const r10 = fs.mkdtempSync(path.join(OUT, 'r10-block-comment-'));
for (const relative of [
  'scripts/checkin-face-static-check.mjs',
  'tools/checkin-face-worker/worker-runtime.mjs',
  'tools/checkin-face-worker/claim-and-enroll.mjs',
  '.gitignore', 'miniprogram/config/runtime.js', 'miniprogram/services/api.js',
]) copyFile(relative, r10);
for (const relative of ['miniprogram/pages/checkin', 'miniprogram/pages/face-enroll', 'cloudfunctions/checkinFaceTest']) {
  fs.mkdirSync(path.join(r10, relative), { recursive: true });
}
const r10Baseline = run('r10-baseline', ['scripts/checkin-face-static-check.mjs'], r10);
assert.equal(r10Baseline.status, 0, r10Baseline.stderr);
const runtime = path.join(r10, 'tools/checkin-face-worker/worker-runtime.mjs');
const source = fs.readFileSync(runtime, 'utf8');
const realFields = /    mode: "device",\r?\n    validityMode: "fixed",/;
assert.equal([...source.matchAll(new RegExp(realFields.source, 'g'))].length, 1, 'One request field pair must be changed');
const mutated = source.replace(realFields, '    /*\n    mode: "device",\n    validityMode: "fixed",\n    */');
assert.notEqual(mutated, source);
const request = mutated.split('  const request = {')[1].split('\n  };')[0];
const executableRequest = request.replace(/\/\*[\s\S]*?\*\//g, '');
assert.doesNotMatch(executableRequest, /\bmode\s*:/);
assert.doesNotMatch(executableRequest, /\bvalidityMode\s*:/);
assert.match(executableRequest, /\bconsent\s*:\s*true/);
fs.writeFileSync(runtime, mutated);
const r10Negative = run('r10-block-comment-negative', ['scripts/checkin-face-static-check.mjs'], r10);
assert.equal(r10Negative.status, 0, 'Known defect reproduction: comment literals are incorrectly accepted');
assert.match(r10Negative.stdout, /0 violations/);

// C1: preserve the frozen manifest byte-for-byte, change just one registered
// source with a harmless comment, then compare the dedicated verifier with the
// actual shared-tree test. No manifest rebasing helper is invoked here.
const c1 = fs.mkdtempSync(path.join(OUT, 'c1-stale-manifest-'));
fs.cpSync(CANDIDATE, c1, { recursive: true, filter: (from) => path.basename(from) !== '.git' });
const manifestFile = path.join(c1, 'docs/checkin-face-experience-source-hashes.json');
const manifestBefore = fs.readFileSync(manifestFile);
const manifest = JSON.parse(manifestBefore);
const changed = 'cloudfunctions/checkinFaceTest/lib/workflow.js';
assert.ok(manifest.files.some((entry) => entry.path === changed));
const c1Baseline = run('c1-source-baseline', ['scripts/verify-checkin-face-sources.mjs'], c1);
assert.equal(c1Baseline.status, 0, c1Baseline.stderr);
const target = path.join(c1, changed);
const targetBefore = fs.readFileSync(target);
fs.appendFileSync(target, '\n// Review-only source drift: manifest intentionally stays frozen.\n');
assert.notEqual(sha(fs.readFileSync(target)), sha(targetBefore));
assert.deepEqual(fs.readFileSync(manifestFile), manifestBefore);
const c1Verifier = run('c1-stale-dedicated-verifier', ['scripts/verify-checkin-face-sources.mjs'], c1);
assert.equal(c1Verifier.status, 1, 'The dedicated source verifier must reject the stale manifest');
assert.match(c1Verifier.stderr, /cloudfunctions\/checkinFaceTest\/lib\/workflow\.js: 磁盘哈希/);
const c1Test = run('c1-stale-selected-qa-test', [
  '--test', '--test-reporter=tap', '--test-name-pattern=^C1：共享树清单校验', 'tests/checkin-face-qa-gates.test.cjs',
], c1);
assert.equal(c1Test.status, 0, 'Known defect reproduction: the selected QA test treats verifier failure as success');
assert.match(c1Test.stdout, /# pass 1\b/);
assert.match(c1Test.stdout, /# fail 0\b/);
assert.deepEqual(fs.readFileSync(manifestFile), manifestBefore);

for (const file of protectedPaths) {
  assert.equal(sha(fs.readFileSync(path.join(CANDIDATE, file))), originalHashes[file], `Candidate changed: ${file}`);
}
const result = {
  scope: 'review-only, synthetic filesystem copies, no business module execution',
  r10: { baselineExit: r10Baseline.status, fieldsRemovedFromExecutableRequest: true, blockCommentIncorrectlyAcceptedExit: r10Negative.status, copy: r10 },
  c1: { baselineExit: c1Baseline.status, dedicatedVerifierExitAfterSingleSourceDrift: c1Verifier.status, sharedTreeQaTestExitAfterSameDrift: c1Test.status, selectedTestPasses: 1, manifestUnchanged: true, copy: c1 },
  candidateProtectedHashesUnchanged: originalHashes,
  commandsAndOutputs: ['r10-baseline', 'r10-block-comment-negative', 'c1-source-baseline', 'c1-stale-dedicated-verifier', 'c1-stale-selected-qa-test'].map((label) => `${label}${RUN_SUFFIX}.json`),
};
fs.writeFileSync(path.join(OUT, 'qa-probes-results.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
