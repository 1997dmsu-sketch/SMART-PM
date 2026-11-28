import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SESSION_SECRET_MARKERS } from './fixtures/face-readonly-session-synthetic.mjs';

const marker = 'SYNTHETIC_PROMISE_PRIVATE_REASON_9D31';
const childPath = fileURLToPath(new URL('./fixtures/face-readonly-promise-observation-child.mjs', import.meta.url));
const guardUrl = new URL('./fixtures/face-readonly-cli-network-guard.mjs', import.meta.url).href;
const zero = { tls: 0, https: 0, http: 0 };

function safe(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const privateMarker of [marker, ...SESSION_SECRET_MARKERS]) {
    assert(!text.includes(privateMarker), 'Synthetic private material escaped the child boundary');
  }
  assert.doesNotMatch(text, /unhandledRejection|UnhandledPromiseRejection|uncaughtException|\n\s+at |BEGIN (?:CERTIFICATE|PRIVATE KEY)/);
}

function child(scenario) {
  return new Promise((resolve, reject) => {
    const subprocess = spawn(process.execPath, ['--import', guardUrl, childPath, scenario], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
      env: process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {},
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stdout = '', stderr = '', settled = false;
    const reports = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      subprocess.kill(); finish(new Error('Synthetic Promise child deadline exceeded'));
    }, 5000);
    for (const [stream, role] of [[subprocess.stdout, 'stdout'], [subprocess.stderr, 'stderr']]) stream.on('data', bytes => {
      if (role === 'stdout') stdout += bytes; else stderr += bytes;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 262144) {
        subprocess.kill(); finish(new Error('Synthetic Promise child output limit exceeded'));
      }
    });
    subprocess.on('message', report => reports.push(report));
    subprocess.once('error', error => finish(error));
    subprocess.once('close', (exitCode, signal) => {
      try {
        assert.equal(signal, null);
        safe({ stdout, stderr, reports });
        assert.equal(stdout.split('\n').length, 2); assert(stdout.endsWith('\n'));
        const output = JSON.parse(stdout);
        const report = reports.find(row => row.kind === 'synthetic-promise-observation');
        assert(report, 'The guarded child must reach its controlled IPC report');
        assert.equal(report.scenario, scenario);
        assert.equal(report.result.exitCode, exitCode);
        assert.deepEqual(report.result.output, output);
        assert.equal(report.guard.attempts, 0);
        assert.equal(report.network.earlyHttpRequests, 0);
        assert.equal(report.network.allSocketsDestroyed, true);
        assert.deepEqual(report.rejectionPolicy, {
          nodeOptionsPresent: false, nondefaultFlag: false, unhandledListeners: 0, uncaughtListeners: 0,
        });
        assert.deepEqual(report.afterSettling, report.atReturn);
        assert.deepEqual(report.afterReplay, report.atReturn);
        assert.equal(report.replayReadDelta, 0); assert.equal(report.replayApprovalDelta, 0);
        assert.equal(report.replay.exitCode, 5); assert.equal(report.replay.code, 'LOCAL_CONTEXT_USED');
        assert.deepEqual(report.inspectionAfterReplay, report.inspection);
        for (const field of ['overriddenThen', 'accessor', 'fulfillmentThen', 'constructor']) assert.equal(report.calls[field], 0, field);
        assert.equal(output.deleteAllowed, false); assert.equal(output.siteVerification, 'NOT_EXECUTED');
        finish(undefined, { exitCode, output, stdout, stderr, report });
      } catch (error) { finish(error); }
    });
  });
}

async function refused(scenario) {
  const response = await child(scenario);
  const { exitCode, output, stderr, report } = response;
  const [port, , settlement] = scenario.split(':');
  const beforeMain = ['source', 'approval', 'open'].includes(port);
  const expectedCode = ['source', 'approval'].includes(port) ? 'LOCAL_FAILURE' : 'LOCAL_EVIDENCE_FAILURE';
  assert.equal(exitCode, 5); assert.equal(report.result.code, expectedCode);
  assert.equal(output.error.code, expectedCode); assert.equal(stderr, `${expectedCode}\n`);
  assert.equal(report.injected, true);
  assert.equal(report.result.mainExitCode, beforeMain ? null : 0);
  assert.equal(report.readCalls, 1);
  assert.equal(report.approvalCalls, port === 'source' || port === 'open' ? 0 : 1);
  assert.equal(report.lateRejectionCount, settlement === 'late-reject' ? 1 : 0);
  assert.equal(report.releasedAfterReturn, settlement === 'late-reject' ? 1 : 0);
  assert.equal(report.calls.ordinaryPromises, 0);
  if (beforeMain) assert.deepEqual(report.atReturn, zero);
  else assert.equal(report.atReturn.http, 36);
  const inspection = report.inspection;
  assert.equal(report.result.evidence.status, port === 'source' ? 'NOT_OPENED' : 'INCOMPLETE');
  assert.equal(inspection.opened, port !== 'source');
  assert.equal(inspection.ready, !['source', 'open'].includes(port));
  assert.equal(inspection.sealed, port === 'close');
  assert.equal(inspection.closed, !['source', 'close'].includes(port));
  assert.equal(inspection.incomplete, port !== 'source');
  assert.equal(inspection.records.length, ['seal', 'close'].includes(port) ? 3 : 0);
  if (!['source', 'approval'].includes(port)) assert.equal(report.injectedPhase, port === 'write' ? 'write:stdout' : port);
  return response;
}

describe('malformed native Promise refusals observe rejection without overridden properties', { concurrency: false }, () => {
  for (const port of ['source', 'approval', 'open', 'write', 'seal', 'close']) {
    test(`${port}: immediate sensitive rejection with own then data is observed before refusal`, async () => {
      await refused(`${port}:undefined:immediate-reject`);
    });
    test(`${port}: sensitive rejection after final result with own then getter stays controlled`, async () => {
      await refused(`${port}:getter:late-reject`);
    });
  }

  for (const scenario of [
    'source:function:immediate-reject',
    'source:other-accessor:immediate-reject',
    'approval:other-accessor:late-reject',
    'close:function:late-reject',
  ]) test(`${scenario} never invokes the covered property`, async () => { await refused(scenario); });

  for (const scenario of ['source:undefined:fulfilled-object', 'approval:getter:fulfilled-object']) {
    test(`${scenario} observer does not re-assimilate the existing fulfillment value`, async () => { await refused(scenario); });
  }

  test('ordinary native Promise returns still complete every port with the real readonly stack and fake transport', async () => {
    const { exitCode, stderr, output, report } = await child('ordinary-success');
    assert.equal(exitCode, 0); assert.equal(stderr, '');
    assert.equal(output.outcome, 'controlled-readonly-completed'); assert.equal(output.total, 9);
    assert.equal(report.result.mainExitCode, 0); assert.equal(report.result.evidence.status, 'COMPLETE');
    assert.equal(report.calls.ordinaryPromises, 8); assert.equal(report.injected, false);
    assert.equal(report.readCalls, 1); assert.equal(report.approvalCalls, 1);
    assert.equal(report.atReturn.http, 36);
    assert.equal(report.inspection.opened, true); assert.equal(report.inspection.ready, true);
    assert.equal(report.inspection.sealed, true); assert.equal(report.inspection.closed, true);
    assert.equal(report.inspection.incomplete, false); assert.equal(report.inspection.records.length, 3);
  });

  test('an unsafe constructor getter on a fulfilled native Promise remains refused without invoking it', async () => {
    // This positive observation boundary intentionally uses an already
    // fulfilled Promise. It makes no claim that an unsafe constructor getter
    // can be safely observed on every rejected native Promise.
    await refused('source:constructor:fulfilled');
  });
});
