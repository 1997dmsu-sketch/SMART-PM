'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

test('tenant password input exception still rejects embedded device secrets in every scope', (t) => {
  const root = path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'smartpm-auth-gate-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  for (const rel of ['miniprogram', 'cloudfunctions/checkinFaceTest', 'tools/checkin-face-worker', '.gitignore', 'scripts/checkin-face-static-check.mjs']) {
    const target = path.join(temporary, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(root, rel), target, { recursive: true });
  }
  const run = () => spawnSync(process.execPath, ['scripts/checkin-face-static-check.mjs'], {
    cwd: temporary, encoding: 'utf8', env: process.env,
  });
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
