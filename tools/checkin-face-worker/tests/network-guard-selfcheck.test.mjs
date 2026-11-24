/**
 * network guard 自检与子进程继承证明（单独运行，不并入主套件，避免计入主套件 totalCalls）。
 * 断言：本进程已安装 guard、触发会计数并抛错不转发、子进程继承 env + NODE_OPTIONS 且实际生效。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import https from 'node:https';

test('guard 在本进程已安装并可触发计数（不转发）', () => {
  assert.equal(process.env.CHECKIN_FACE_NETWORK_GUARD, '1');
  assert.equal(globalThis.__CHECKIN_FACE_NETWORK_GUARD__?.installed, true);
  const before = globalThis.__CHECKIN_FACE_NETWORK_GUARD__.totalCalls();
  assert.throws(() => https.request({ host: 'synthetic-device.invalid', path: '/' }), /network guard/);
  assert.ok(globalThis.__CHECKIN_FACE_NETWORK_GUARD__.totalCalls() >= before + 1, '触发必须会计数');
  assert.ok(globalThis.__CHECKIN_FACE_NETWORK_GUARD__.firstCall(), '首次触发被记录');
});

test('guard 经 env + NODE_OPTIONS 被子进程继承并实际生效', () => {
  const childEnv = { ...process.env, CHECKIN_FACE_GUARD_EXIT_LOG: '' };
  const info = spawnSync(process.execPath, [
    '-e',
    "console.log(JSON.stringify({env: process.env.CHECKIN_FACE_NETWORK_GUARD, opts: process.env.NODE_OPTIONS || ''}))",
  ], { encoding: 'utf8', env: childEnv });
  assert.equal(info.status, 0, `子进程失败：${info.stderr}`);
  const parsed = JSON.parse(info.stdout.trim());
  assert.equal(parsed.env, '1');
  assert.match(parsed.opts, /network-guard\.cjs/);

  const guarded = spawnSync(process.execPath, [
    '-e',
    "try { require('node:https').get({ host: 'synthetic-device.invalid' }); console.log('LEAKED'); } catch (error) { console.log(String(error.message).includes('network guard') ? 'GUARDED' : 'OTHER:' + error.message); }",
  ], { encoding: 'utf8', env: childEnv });
  assert.equal(guarded.status, 0, `子进程失败：${guarded.stderr}`);
  assert.equal(guarded.stdout.trim(), 'GUARDED', '子进程出站被阻断且未转发');
});
