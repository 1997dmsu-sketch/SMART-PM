import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const provenance = JSON.parse(readFileSync(resolve(root, 'docs/backend-provenance.json')));
const changes = JSON.parse(readFileSync(resolve(root, 'docs/backend-changes.json')));
for (const [name, change] of Object.entries(changes)) {
  assert.equal(change.originalSha256, provenance.files[name], `Invalid original hash: ${name}`);
  assert.ok(change.reason, `Missing change reason: ${name}`);
}
for (const [name, expected] of Object.entries(provenance.files)) {
  const file = resolve(root, name);
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  assert.equal(hash, changes[name]?.sha256 || expected, `Imported file differs from source: ${name}`);
  if (name.endsWith('.js')) {
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
  }
}
const names = readdirSync(resolve(root, 'cloudfunctions'));
for (const name of names) {
  const require = createRequire(resolve(root, 'cloudfunctions', name, 'package.json'));
  const manifest = require('./package.json');
  for (const dependency of Object.keys(manifest.dependencies || {})) require(dependency);
}
const assets = JSON.parse(readFileSync(resolve(root, 'design/asset-manifest.json')));
for (const {file, sha256} of assets) {
  assert.equal(createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex'), sha256, file);
}
console.log(`Verified ${Object.keys(provenance.files).length} backend files against original provenance plus documented patches, syntax and dependency loading for ${names.length} functions, and ${assets.length} assets.`);
console.log('These checks do not invoke cloud functions or validate live WeChat services.');
