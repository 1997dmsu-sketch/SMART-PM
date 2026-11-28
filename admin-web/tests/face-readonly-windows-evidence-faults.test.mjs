import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syntheticBase, sha256 } from './fixtures/face-readonly-windows-evidence-synthetic.mjs';
import { SESSION_SECRET_MARKERS } from './fixtures/face-readonly-session-synthetic.mjs';

// These cases are explicit fault injection into a new artifact copy. They do
// not claim an actual hardware/disk failure, and cannot configure production
// runtime hooks, executable paths or transport. Every object is retained.
const project = fileURLToPath(new URL('../../', import.meta.url));
const helper = 'tools/hikvision-readonly-evidence/WindowsEvidence.cs';
const launcher = 'tools/hikvision-readonly-evidence/Invoke-WindowsEvidence.ps1';
const childFile = 'admin-web/tests/fixtures/face-readonly-windows-evidence-fault-child.mjs';
const guardFile = 'admin-web/tests/fixtures/face-readonly-cli-network-guard.mjs';
const marker = 'SYNTHETIC_PRIVATE_NATIVE_FAULT_REASON_72C9';
const fullWrite = '[DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WriteFile(IntPtr handle, byte[] buffer, uint length, out uint written, IntPtr overlapped);';
const fullFlush = '[DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool FlushFileBuffers(IntPtr handle);';
const closeCheck = 'if (!Native.CloseHandle(item.Handle)) Remember(new EvidenceFault("NATIVE_EVIDENCE_CLOSE"));';
const returnAfterAck = 'return failure == null ? 0 : 1;';
const specNames = ['write-false', 'flush-false', 'seal-private-error', 'close-false', 'ack-exit-one',
  'extra-output', 'exit-during-http', 'check-unresponsive', 'restricted-created-acl'];

function safe(text) {
  for (const value of [marker, ...SESSION_SECRET_MARKERS]) assert(!text.includes(value), 'Synthetic private data escaped the native fault child');
  assert.doesNotMatch(text, /BEGIN (?:CERTIFICATE|PRIVATE KEY)|S-\d-\d+(?:-\d+)+|\n\s+at /);
}
function mutation(scenario, signalPath) {
  if (scenario === 'write-false') return [fullWrite,
    'internal static bool WriteFile(IntPtr handle, byte[] buffer, uint length, out uint written, IntPtr overlapped) { written = 0; return false; }'];
  if (scenario === 'flush-false') return [fullFlush, 'internal static bool FlushFileBuffers(IntPtr handle) { return false; }'];
  if (scenario === 'seal-private-error') return [
    'internal void Seal()\n        {\n            EnsureUsable();',
    `internal void Seal()\n        {\n            EnsureUsable();\n            if (String.Equals("synthetic", "synthetic", StringComparison.Ordinal)) throw new IOException("${marker}");`,
  ];
  if (scenario === 'close-false') return [closeCheck,
    'if (!Native.CloseHandle(item.Handle) || String.Equals("synthetic", "synthetic", StringComparison.Ordinal)) Remember(new EvidenceFault("NATIVE_EVIDENCE_CLOSE"));'];
  if (scenario === 'ack-exit-one') return [returnAfterAck, 'return 1;'];
  if (scenario === 'extra-output') return [returnAfterAck, `Console.Out.WriteLine("${marker}"); return failure == null ? 0 : 1;`];
  if (scenario === 'exit-during-http') return ['Respond(output, id, null);',
    `Respond(output, id, null);\n                        if (op == "check") { for (int wait = 0; wait < 600 && !File.Exists(@"${signalPath.replaceAll('"', '""')}"); wait++) System.Threading.Thread.Sleep(5); System.Threading.Thread.Sleep(20); return 0; }`];
  if (scenario === 'check-unresponsive') return ['store.Check();', 'store.Check(); System.Threading.Thread.Sleep(60000);'];
  if (scenario === 'restricted-created-acl') return [
    'string sddl = "O:" + user + "D:P(A;;FA;;;" + user + ")(A;;FA;;;SY)";',
    // Remove only DELETE: keep the rights needed to acquire the new handle so
    // the actual GetSecurityInfo/ACL guard, rather than create denial, is hit.
    'string sddl = "O:" + user + "D:P(A;;0x001e01ff;;;" + user + ")(A;;FA;;;SY)";',
  ];
  throw new Error('Unknown fixed native fault mutation');
}
function artifact(scenario) {
  const root = syntheticBase(), copy = path.join(root, 'artifact-copy'), evidence = path.join(root, 'native-evidence');
  fs.mkdirSync(copy); fs.mkdirSync(evidence); const copied = new Map();
  function include(relative) {
    relative = relative.replaceAll('\\', '/'); if (copied.has(relative)) return;
    const source = path.resolve(project, relative);
    assert(source.startsWith(path.resolve(project) + path.sep), 'Fixed dependency copy must stay inside the project');
    const bytes = fs.readFileSync(source), target = path.join(copy, relative);
    copied.set(relative, { file: relative, bytes: bytes.length, sha256: sha256(bytes) });
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' });
    if (relative.endsWith('.mjs')) for (const match of bytes.toString('utf8').matchAll(/["'](\.{1,2}\/[^"'\r\n]+\.(?:mjs|cjs))["']/g)) {
      const dependency = path.resolve(path.dirname(source), match[1]);
      if (fs.existsSync(dependency)) include(path.relative(project, dependency));
    }
  }
  include(childFile); include(guardFile); include(launcher); include(helper);
  const target = path.join(copy, helper), original = fs.readFileSync(target), text = original.toString('utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let [before, after] = mutation(scenario, path.join(evidence, 'inflight.signal'));
  before = before.replaceAll('\n', eol); after = after.replaceAll('\n', eol);
  assert.equal(text.split(before).length, 2, 'The fault must replace exactly one known helper region');
  const changed = Buffer.from(text.replace(before, after)); fs.writeFileSync(target, changed);
  const manifest = { scenario, kind: 'synthetic-fault-injection-not-hardware-failure', copied: [...copied.values()],
    mutatedFile: helper, originalSha256: sha256(original), mutatedSha256: sha256(changed), before, after };
  fs.writeFileSync(path.join(root, 'copy-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return {
    root, copy, evidence, manifest,
    verify() {
      for (const row of copied.values()) {
        assert.equal(sha256(fs.readFileSync(path.join(project, row.file))), row.sha256, 'The tested original source must remain unchanged');
        const expected = row.file === helper ? manifest.mutatedSha256 : row.sha256;
        assert.equal(sha256(fs.readFileSync(path.join(copy, row.file))), expected, 'Only the selected helper region may change in the copy');
      }
      fs.writeFileSync(path.join(root, 'copy-verification.json'), JSON.stringify({ originalSourceUnchanged: true,
        copyFilesVerified: copied.size, onlyMutatedFile: helper, hashesVerified: true }, null, 2) + '\n', { flag: 'wx' });
    },
  };
}
async function runFault(scenario) {
  const fixture = artifact(scenario), stdoutFile = path.join(fixture.root, 'child.stdout.log'), stderrFile = path.join(fixture.root, 'child.stderr.log');
  const stdoutFd = fs.openSync(stdoutFile, 'wx'), stderrFd = fs.openSync(stderrFile, 'wx'), reports = [];
  const args = ['--import', pathToFileURL(path.join(fixture.copy, guardFile)).href, path.join(fixture.copy, childFile), scenario, fixture.evidence];
  const startedAt = new Date().toISOString(); let result, timedOut = false;
  try {
    const child = spawn(process.execPath, args, { cwd: fixture.copy, windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot, ...(process.env.TEMP ? { TEMP: process.env.TEMP, TMP: process.env.TEMP } : {}) },
      stdio: ['ignore', stdoutFd, stderrFd, 'ipc'] });
    child.on('message', report => reports.push(report));
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 25000);
    try {
      result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (exitCode, signal) => resolve({ exitCode, signal })); });
    } finally { clearTimeout(timer); }
    // Preserve the true process exit before decoding or asserting any output.
    fs.writeFileSync(path.join(fixture.root, 'child.exit.txt'), `${result.exitCode}\n`, { flag: 'wx' });
  } finally { fs.closeSync(stdoutFd); fs.closeSync(stderrFd); }
  fs.writeFileSync(path.join(fixture.root, 'child.ipc.json'), JSON.stringify(reports, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(fixture.root, 'child.result.json'), JSON.stringify({ scenario, executable: process.execPath, args,
    startedAt, endedAt: new Date().toISOString(), ...result, timedOut }, null, 2) + '\n', { flag: 'wx' });
  fixture.verify();
  const stdout = fs.readFileSync(stdoutFile, 'utf8'), stderr = fs.readFileSync(stderrFile, 'utf8');
  assert.equal(timedOut, false); assert.equal(result.signal, null); assert.equal(result.exitCode, 5);
  safe(JSON.stringify({ stdout, stderr, reports }));
  const report = reports.find(row => row.kind === 'synthetic-native-evidence-fault');
  assert(report, 'The fault child must finish through the controlled result path');
  assert.equal(report.scenario, scenario); assert.equal(report.result.exitCode, result.exitCode);
  assert.equal(stdout, `${JSON.stringify(report.result.output)}\n`); assert.equal(stderr, `${report.result.code}\n`);
  assert.equal(report.result.output.deleteAllowed, false); assert.equal(report.result.output.siteVerification, 'NOT_EXECUTED');
  assert.equal(report.result.evidence.status, 'INCOMPLETE'); assert.equal(report.inspection.incomplete, true);
  assert.equal(report.inspection.native.closed, true); assert(report.inspection.native.failureCode);
  assert.equal(report.guard.attempts, 0); assert.equal(report.network.earlyHttpRequests, 0);
  assert.equal(report.network.allSocketsDestroyed, true);
  assert.deepEqual(report.afterSettling, report.atReturn); assert.deepEqual(report.afterReplay, report.atReturn);
  assert.equal(report.replay.code, 'LOCAL_CONTEXT_USED'); assert.equal(report.replay.exitCode, 5);
  assert.equal(report.replayReadDelta, 0); assert.equal(report.replayApprovalDelta, 0);
  if (scenario === 'exit-during-http') {
    assert.equal(report.firstHttpSignal, true); assert.equal(report.atReturn.http, 1);
    assert.deepEqual(report.requests, [{ method: 'GET', path: '/ISAPI/System/deviceInfo' }]);
    assert.equal(report.inspection.native.processExit, 0);
    assert.notEqual(report.result.mainExitCode, 0);
  } else if (scenario === 'check-unresponsive') {
    assert.deepEqual(report.atReturn, { http: 0, tls: 0, https: 0 }); assert.equal(report.result.mainExitCode, null);
  } else if (scenario === 'restricted-created-acl') {
    assert.deepEqual(report.atReturn, { http: 0, tls: 0, https: 0 }); assert.equal(report.result.mainExitCode, null);
    assert.equal(report.inspection.native.failureCode, 'NATIVE_EVIDENCE_ACL'); assert.equal(report.approvalCalls, 0);
  } else {
    assert.equal(report.result.mainExitCode, 0); assert.equal(report.atReturn.http, 36);
  }
  return { report, fixture };
}

describe('native Windows receiver layered fault injection preserves terminal failure', { concurrency: false }, () => {
  for (const scenario of specNames) test(`${scenario} remains nonzero with retained incomplete evidence`, async () => {
    assert.equal(process.platform, 'win32', 'Native fault cases require Windows, not a skip');
    const { report, fixture } = await runFault(scenario);
    if (['close-false', 'ack-exit-one', 'extra-output'].includes(scenario)) {
      assert.equal(report.inspection.sealed, true);
      assert.equal(fs.existsSync(path.join(fixture.evidence, 'SYNTHETIC_FAULT_EVIDENCE', 'candidate-seal.json')), true);
    }
  });
});
