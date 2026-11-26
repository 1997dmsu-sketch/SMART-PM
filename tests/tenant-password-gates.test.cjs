'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function gateFixture(t) {
  const root = path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'smartpm-auth-gate-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  // Copy only declared source inputs, never local worker configuration or dependencies.
  for (const rel of [
    '.gitignore',
    'scripts/checkin-face-static-check.mjs',
    'tools/checkin-face-worker/worker-runtime.mjs',
    'tools/checkin-face-worker/claim-and-enroll.mjs',
    'miniprogram/config/runtime.js',
    'miniprogram/services/api.js',
    'miniprogram/pages/account-login/index.js',
    'miniprogram/pages/account-login/index.wxml',
    'miniprogram/pages/profile/index.js',
  ]) {
    const target = path.join(temporary, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, rel), target);
  }
  for (const rel of ['miniprogram/pages/checkin', 'miniprogram/pages/face-enroll', 'cloudfunctions/checkinFaceTest']) {
    fs.mkdirSync(path.join(temporary, rel), { recursive: true });
  }
  const run = () => spawnSync(process.execPath, ['scripts/checkin-face-static-check.mjs'], {
    cwd: temporary, encoding: 'utf8', env: process.env,
  });
  return { temporary, run };
}

test('tenant password input exception still rejects embedded device secrets in every scope', (t) => {
  const { temporary, run } = gateFixture(t);
  const baseline = run();
  assert.equal(baseline.status, 0, baseline.stderr);
  for (const [rel, injection] of [
    ['miniprogram/pages/profile/index.js', "\nconst password = 'synthetic-embedded-value';\n"],
    ['miniprogram/pages/account-login/index.js', "\nconst password = 'synthetic-embedded-value';\n"],
    ['miniprogram/services/api.js', "\nconst privateKey = 'synthetic-embedded-value';\n"],
  ]) {
    const file = path.join(temporary, rel);
    const original = fs.readFileSync(file);
    try {
      fs.appendFileSync(file, injection);
      const negative = run();
      assert.equal(negative.status, 1, negative.stdout + negative.stderr);
      assert.match(negative.stderr, /设备.*秘密|设备密码\/硬编码密码/);
    } finally { fs.writeFileSync(file, original); }
    assert.equal(run().status, 0);
  }
});

test('tenant password clearing exception rejects nonempty expressions and same-line assignments', async (t) => {
  const { temporary, run } = gateFixture(t);
  const baseline = run();
  assert.equal(baseline.status, 0, baseline.stderr);
  const file = path.join(temporary, 'miniprogram/pages/account-login/index.js');
  const original = fs.readFileSync(file, 'utf8');
  for (const [label, injection] of [
    ['empty-string prefix plus literal', "const synthetic = { password: '' + 'synthetic-embedded-value' };"],
    ['empty-string prefix method call', "const synthetic = { password: ''.concat('synthetic-embedded-value') };"],
    ['empty-string prefix logical function call', "const synthetic = { password: '' || syntheticPasswordValue() };"],
    ['allowed clearing followed by an assignment', "this.setData({ password: '', submitting: false }); password = 'synthetic-embedded-value';"],
    ['direct function call', 'const synthetic = { password: syntheticPasswordValue() };'],
  ]) {
    await t.test(label, (caseTest) => {
      try {
        fs.writeFileSync(file, `${original}\n${injection}\n`);
        const negative = run();
        assert.equal(negative.status, 1, negative.stdout + negative.stderr);
        assert.match(negative.stderr, /\[FAIL\] checkin-face static check: 1 violation\(s\)/);
        assert.match(negative.stderr, /miniprogram\/pages\/account-login\/index\.js:\d+: 设备密码\/硬编码密码/);
        caseTest.diagnostic(`Expected synthetic rejection (exit ${negative.status}):\n${negative.stderr.trim()}`);
      } finally { fs.writeFileSync(file, original); }
    });
  }
  const restored = run();
  assert.equal(restored.status, 0, restored.stderr);
});
