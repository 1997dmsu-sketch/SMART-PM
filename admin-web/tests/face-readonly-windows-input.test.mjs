import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createSyntheticWindowsConfirmation, createWindowsPrivateInputAdapter, inspectWindowsPrivateInputAdapter,
} from '../lib/face-readonly-windows-input.mjs';
import {
  createLocalBootstrap, createWindowsPrivateInputPorts, createOfflineLocalBootstrap, runLocalBootstrap,
  createSyntheticEvidenceReceiver, createSyntheticInputSource, createSyntheticApprovalSource,
} from '../lib/face-readonly-local-bootstrap.mjs';
import { installSessionNetworkGuard } from './fixtures/face-readonly-session-network-guard.mjs';
import { installFakeTransport, SYNTHETIC_PATHS } from './fixtures/face-readonly-fake-transport.mjs';
import { sessionInput, sessionExpectations, sessionResponses, SESSION_TARGET } from './fixtures/face-readonly-session-synthetic.mjs';
import { syntheticBase, reference, inspectDisk } from './fixtures/face-readonly-windows-evidence-synthetic.mjs';
import {
  windowsInputFixture, inspectWindowsInputFixture, safePrivateInput, privateInputError,
} from './fixtures/face-readonly-windows-input-synthetic.mjs';

let guard, expectedForSafety;
before(async () => {
  assert.equal(process.platform, 'win32', 'Windows wrapper cases require actual Windows');
  guard = installSessionNetworkGuard(); expectedForSafety = await sessionExpectations();
});
after(() => { const snapshot = guard.snapshot(); guard.restore(); assert.equal(snapshot.attempts, 0); });
const tick = () => new Promise(resolve => setImmediate(resolve));
const counters = network => ({ tls: network.tlsConnections, https: network.httpsCalls, http: network.httpRequests });
const zero = network => assert.deepEqual(counters(network), { tls: 0, https: 0, http: 0 });
function networkFor(t, options = {}) {
  const cleanups = [], network = installFakeTransport({ after: cleanup => cleanups.push(cleanup) }, { responses: sessionResponses(), ...options });
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup(); }); return network;
}
function failed(result, expected = expectedForSafety) {
  safePrivateInput(result, expected); assert([2, 4, 5].includes(result.exitCode));
  assert.equal(result.output.deleteAllowed, false); assert.equal(result.output.siteVerification, 'NOT_EXECUTED');
  assert.notEqual(result.output.outcome, 'controlled-readonly-completed'); return result;
}
function completed(result, context, network) {
  safePrivateInput(result, context.expected); assert.equal(result.exitCode, 0); assert.equal(result.mainExitCode, 0);
  assert.equal(result.output.total, 9); assert.equal(result.output.verification.FPID, SESSION_TARGET);
  assert.equal(result.output.verification.inLibrary, true); assert.equal(result.output.deleteAllowed, false);
  assert.equal(result.output.siteVerification, 'NOT_EXECUTED'); assert.equal(result.evidence.status, 'COMPLETE');
  assert.equal(network.httpRequests, 36); assert.equal(network.earlyHttpRequests, 0);
  const inspection = inspectWindowsInputFixture(context); safePrivateInput(inspection, context.expected);
  assert.equal(inspection.input.captureCalls, 1); assert.equal(inspection.input.reviewCalls, 1);
  assert.equal(inspection.input.closed, true); assert.equal(inspection.input.processExit, 0);
  assert.equal(inspection.input.failureCode, undefined); assert.equal(inspection.evidence.incomplete, false);
  assert(network.sockets.every(socket => socket.destroyed)); return inspection;
}
async function noReplay(context, network) {
  const prior = counters(network), state = inspectWindowsPrivateInputAdapter(context.adapter);
  const result = failed(await runLocalBootstrap(context.handle), context.expected); assert.equal(result.code, 'LOCAL_CONTEXT_USED');
  assert.deepEqual(counters(network), prior);
  const after = inspectWindowsPrivateInputAdapter(context.adapter);
  assert.equal(after.captureCalls, state.captureCalls); assert.equal(after.reviewCalls, state.reviewCalls);
}
const materials = async () => ({ inputBytes: Buffer.from(JSON.stringify(sessionInput())), expectationsBytes: Buffer.from(JSON.stringify(await sessionExpectations())) });

describe('Windows private input factories are code-only and reject injected capabilities', { concurrency: false }, () => {
  test('confirmation and adapter handles are frozen opaque brands without public material', async () => {
    const confirmationEvent = createSyntheticWindowsConfirmation({ decision: 'approve' });
    const adapter = createWindowsPrivateInputAdapter({ ...await materials(), confirmationEvent });
    for (const handle of [confirmationEvent, adapter]) {
      assert(Object.isFrozen(handle)); assert.equal(Object.getPrototypeOf(handle), null); assert.deepEqual(Reflect.ownKeys(handle), []);
    }
    safePrivateInput(inspectWindowsPrivateInputAdapter(adapter));
    assert.equal(inspectWindowsPrivateInputAdapter(adapter).captureCalls, 0);
  });
  for (const decision of ['approve', 'reject', 'cancel', 'none']) test(`a branded ${decision} synthetic event does not start a process by construction`, async () => {
    const adapter = createWindowsPrivateInputAdapter({ ...await materials(), confirmationEvent: createSyntheticWindowsConfirmation({ decision }) });
    assert.equal(inspectWindowsPrivateInputAdapter(adapter).captureCalls, 0); assert.equal(inspectWindowsPrivateInputAdapter(adapter).reviewCalls, 0);
  });
  for (const [label, forged] of [['plain approved object', { approved: true }], ['boolean', true],
    ['serialized decision', JSON.parse('{"decision":"approve"}')], ['cloned brand', structuredClone(createSyntheticWindowsConfirmation({ decision: 'approve' }))], ['null', null]]) {
    test(`${label} cannot forge a Windows confirmation event`, async () => {
      assert.throws(() => createWindowsPrivateInputAdapter({ ...awaitMaterial, confirmationEvent: forged }), privateInputError);
    });
  }
  // A fixed all-ASCII input is sufficient for factory shape refusal; no helper
  // runs in these cases, and semantic parsing remains a later boundary.
  const awaitMaterial = { inputBytes: Buffer.from('{}'), expectationsBytes: Buffer.from('{}') };
  for (const [label, bytes] of [['text', '{}'], ['plain object', {}], ['DataView', new DataView(new ArrayBuffer(2))],
    ['Uint16Array', new Uint16Array(2)], ['Proxy bytes', new Proxy(new Uint8Array(2), {})]]) {
    test(`a ${label} cannot replace raw input bytes`, () => {
      assert.throws(() => createWindowsPrivateInputAdapter({ inputBytes: bytes, expectationsBytes: Buffer.from('{}') }), privateInputError);
    });
  }
  test('unknown fields cannot select a helper module callback or output destination', async () => {
    const data = await materials();
    for (const extra of [{ helper: 'other.ps1' }, { module: 'other.mjs' }, { read() {} }, { request() {} }, { outputDir: 'SYNTHETIC_OTHER' }, { approved: true }]) {
      assert.throws(() => createWindowsPrivateInputAdapter({ ...data, ...extra }), privateInputError);
    }
    assert.throws(() => createSyntheticWindowsConfirmation({ decision: 'approve', approved: true }), privateInputError);
  });
  test('factory getters and Proxy traps are never evaluated', () => {
    let touches = 0; const getter = { expectationsBytes: Buffer.from('{}') };
    Object.defineProperty(getter, 'inputBytes', { get() { touches++; throw new Error('SYNTHETIC_PRIVATE_INPUT_GETTER'); } });
    const proxy = new Proxy({}, { ownKeys() { touches++; throw new Error('SYNTHETIC_PRIVATE_INPUT_PROXY'); }, getPrototypeOf() { touches++; return Object.prototype; } });
    assert.throws(() => createWindowsPrivateInputAdapter(getter), privateInputError);
    assert.throws(() => createWindowsPrivateInputAdapter(proxy), privateInputError); assert.equal(touches, 0);
  });
  test('forged or cloned adapters cannot produce input and approval ports', async () => {
    const adapter = createWindowsPrivateInputAdapter(await materials());
    for (const forged of [{}, structuredClone(adapter), true, null]) assert.throws(() => createWindowsPrivateInputPorts({ adapter: forged }), privateInputError);
    assert.equal(inspectWindowsPrivateInputAdapter(adapter).captureCalls, 0);
  });
  test('ports from two Windows adapters cannot be mixed into one context', async () => {
    const a = createWindowsPrivateInputAdapter(await materials()), b = createWindowsPrivateInputAdapter(await materials());
    const pa = createWindowsPrivateInputPorts({ adapter: a }), pb = createWindowsPrivateInputPorts({ adapter: b });
    assert.throws(() => createOfflineLocalBootstrap({ inputSource: pa.inputSource, approvalSource: pb.approvalSource,
      evidenceReceiver: createSyntheticEvidenceReceiver(), isTransportInstalled: () => true }), privateInputError);
    assert.equal(inspectWindowsPrivateInputAdapter(a).captureCalls, 0); assert.equal(inspectWindowsPrivateInputAdapter(b).captureCalls, 0);
  });
  test('one Windows port pair cannot construct a second bootstrap domain', async () => {
    const adapter = createWindowsPrivateInputAdapter(await materials()), ports = createWindowsPrivateInputPorts({ adapter });
    createOfflineLocalBootstrap({ ...ports, evidenceReceiver: createSyntheticEvidenceReceiver(), isTransportInstalled: () => true });
    assert.throws(() => createOfflineLocalBootstrap({ ...ports, evidenceReceiver: createSyntheticEvidenceReceiver(), isTransportInstalled: () => true }), privateInputError);
  });
  test('a Windows port cannot be paired with an unrelated generic synthetic port', async () => {
    const adapter = createWindowsPrivateInputAdapter(await materials()), ports = createWindowsPrivateInputPorts({ adapter });
    for (const mixed of [{ inputSource: ports.inputSource, approvalSource: createSyntheticApprovalSource() },
      { inputSource: createSyntheticInputSource({ read: () => ({}) }), approvalSource: ports.approvalSource }]) {
      assert.throws(() => createOfflineLocalBootstrap({ ...mixed, evidenceReceiver: createSyntheticEvidenceReceiver(), isTransportInstalled: () => true }), privateInputError);
    }
  });
});

describe('actual Windows capture preserves raw bytes and inherited strict validation', { concurrency: false }, () => {
  for (const [label, change] of [
    ['input UTF8 EOF truncation', () => ({ inputBytes: Buffer.concat([Buffer.from('{"operation":"'), Buffer.from([0xe4, 0xb8])]) })],
    ['input illegal UTF8 sequence', () => ({ inputBytes: Buffer.from([0xc0, 0xaf]) })],
    ['expectation UTF8 EOF truncation', () => ({ expectationsBytes: Buffer.concat([Buffer.from('{"expectedSerialNumber":"'), Buffer.from([0xe4, 0xb8])]) })],
    ['duplicate decoded input key', () => ({ inputBytes: Buffer.from('{"operation":"list","oper\\u0061tion":"list"}') })],
    ['duplicate decoded expectation key', () => ({ expectationsBytes: Buffer.from('{"expectedCount":9,"expected\\u0043ount":9}') })],
    ['unfinished input JSON', () => ({ inputBytes: Buffer.from('{') })],
    ['multiple input objects', () => ({ inputBytes: Buffer.from('{}{}') })],
    ['expectation array', () => ({ expectationsBytes: Buffer.from('[]') })],
    ['unknown input field', () => ({ inputBytes: Buffer.from(JSON.stringify({ ...sessionInput(), allowLive: true })) })],
    ['unknown expectation field', async () => ({ expectationsBytes: Buffer.from(JSON.stringify({ ...await sessionExpectations(), approved: true })) })],
    ['certificate path field', () => { const input = sessionInput(); input.config.certificatePath = 'SYNTHETIC_PRIVATE_PATH'; return { inputBytes: Buffer.from(JSON.stringify(input)) }; }],
    ['missing independent serial', async () => { const expected = await sessionExpectations(); delete expected.expectedSerialNumber; return { expectationsBytes: Buffer.from(JSON.stringify(expected)) }; }],
    ['missing independent target library', async () => { const expected = await sessionExpectations(); delete expected.targetFDID; return { expectationsBytes: Buffer.from(JSON.stringify(expected)) }; }],
  ]) test(`${label} is refused before approval and any HTTP`, async t => {
    const network = networkFor(t), context = await windowsInputFixture(await change());
    const result = failed(await runLocalBootstrap(context.handle), context.expected); assert.equal(result.mainExitCode, null);
    assert.equal(inspectWindowsPrivateInputAdapter(context.adapter).reviewCalls, 0); zero(network); await noReplay(context, network);
  });
  for (const field of ['inputBytes', 'expectationsBytes']) test(`over-limit ${field} cannot reach HTTP or approval`, async t => {
    const network = networkFor(t); let context;
    try { context = await windowsInputFixture({ [field]: Buffer.alloc(field === 'inputBytes' ? 32769 : 8193, 0x20) }); }
    catch (error) { assert(privateInputError(error)); zero(network); return; }
    failed(await runLocalBootstrap(context.handle), context.expected); zero(network);
    assert.equal(inspectWindowsPrivateInputAdapter(context.adapter).reviewCalls, 0);
  });
  test('input bytes are privately copied before caller mutation and read only once', async t => {
    const network = networkFor(t), body = Buffer.from(` \r\n${JSON.stringify(sessionInput())}\t `);
    const context = await windowsInputFixture({ inputBytes: body }); body.fill(0);
    completed(await runLocalBootstrap(context.handle), context, network); await noReplay(context, network);
  });
  test('independent expectation bytes are privately copied before caller mutation', async t => {
    const network = networkFor(t), expected = await sessionExpectations(), bytes = Buffer.from(JSON.stringify(expected));
    const context = await windowsInputFixture({ expectationsBytes: bytes, expectations: expected }); bytes.fill(0);
    completed(await runLocalBootstrap(context.handle), context, network); await noReplay(context, network);
  });
});

describe('private approval binds one snapshot view and native evidence reference', { concurrency: false }, () => {
  test('explicit synthetic approval completes through the real readonly stack and native evidence', async t => {
    const network = networkFor(t), context = await windowsInputFixture({ nativeEvidence: true });
    const inspection = completed(await runLocalBootstrap(context.handle), context, network);
    inspectDisk(context.directory, Object.fromEntries(inspection.evidence.records.map(r => [r.role, r.text]))); await noReplay(context, network);
  });
  test('an omitted confirmation defaults to denial with zero HTTP', async t => {
    const network = networkFor(t), data = await materials(), adapter = createWindowsPrivateInputAdapter(data), ports = createWindowsPrivateInputPorts({ adapter });
    const receiver = createSyntheticEvidenceReceiver(), handle = createOfflineLocalBootstrap({ ...ports, evidenceReceiver: receiver, isTransportInstalled: () => true });
    const result = failed(await runLocalBootstrap(handle)); assert.equal(result.code, 'LOCAL_APPROVAL_DENIED'); assert.equal(result.exitCode, 4); zero(network);
    const state = inspectWindowsPrivateInputAdapter(adapter); assert.equal(state.captureCalls, 1); assert.equal(state.reviewCalls, 1); assert.equal(state.closed, true); assert.equal(state.processExit, 0);
  });
  for (const decision of ['reject', 'cancel', 'none']) test(`an explicit ${decision} event never authorizes HTTP and cannot replay`, async t => {
    const network = networkFor(t), context = await windowsInputFixture({ decision });
    failed(await runLocalBootstrap(context.handle), context.expected); zero(network); assert.equal(inspectWindowsPrivateInputAdapter(context.adapter).closed, true);
    await noReplay(context, network);
  });
  test('native evidence and closed approval helper precede the first fake HTTP', async t => {
    let context, observed = false;
    const network = networkFor(t, { onRequest: request => {
      if (!observed && request.path === SYNTHETIC_PATHS.device) {
        observed = true; const inspection = inspectWindowsInputFixture(context);
        assert.equal(inspection.input.closed, true); assert.equal(inspection.input.processExit, 0);
        assert.equal(inspection.input.reviewCalls, 1); assert.equal(inspection.evidence.ready, true);
        for (const file of ['stdout.jsonl', 'stderr.txt', 'main-exit.txt']) assert.equal(fs.readFileSync(path.join(context.directory, file)).length, 0);
      }
      return undefined;
    } });
    context = await windowsInputFixture({ nativeEvidence: true }); completed(await runLocalBootstrap(context.handle), context, network); assert.equal(observed, true);
  });
  test('an existing evidence destination prevents review without overwriting the sentinel', async t => {
    const network = networkFor(t), baseDirectory = syntheticBase(), evidenceReference = reference(), directory = path.join(baseDirectory, evidenceReference);
    fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'keep.txt'), 'SYNTHETIC_RETAINED', { flag: 'wx' });
    const context = await windowsInputFixture({ nativeEvidence: true, baseDirectory, evidenceReference });
    failed(await runLocalBootstrap(context.handle), context.expected); assert.equal(inspectWindowsPrivateInputAdapter(context.adapter).reviewCalls, 0); zero(network);
    assert.equal(fs.readFileSync(path.join(directory, 'keep.txt'), 'utf8'), 'SYNTHETIC_RETAINED'); assert.deepEqual(fs.readdirSync(directory), ['keep.txt']);
  });
  test('pre-cancellation consumes the attempt before capture or native directory creation', async t => {
    const network = networkFor(t), context = await windowsInputFixture({ nativeEvidence: true }), controller = new AbortController(); controller.abort();
    const result = failed(await runLocalBootstrap(context.handle, { signal: controller.signal }), context.expected);
    assert.equal(result.code, 'COMMAND_CANCELLED'); assert.equal(inspectWindowsPrivateInputAdapter(context.adapter).captureCalls, 0);
    assert.equal(fs.existsSync(context.directory), false); zero(network); await noReplay(context, network);
  });
  test('an unavailable fake transport locks before private capture', async t => {
    const network = networkFor(t), context = await windowsInputFixture({ installed: false });
    const result = failed(await runLocalBootstrap(context.handle), context.expected); assert.equal(result.code, 'LIVE_EXECUTION_LOCKED');
    assert.equal(inspectWindowsPrivateInputAdapter(context.adapter).captureCalls, 0); zero(network); await noReplay(context, network);
  });
  test('a one millisecond capture deadline still closes the native helper before return', async t => {
    const network = networkFor(t), context = await windowsInputFixture({ options: { ioTimeoutMs: 1 } });
    const result = failed(await runLocalBootstrap(context.handle), context.expected);
    assert.equal(result.code, 'LOCAL_IO_TIMEOUT'); assert.equal(result.mainExitCode, null); zero(network);
    const state = inspectWindowsPrivateInputAdapter(context.adapter); assert.equal(state.closed, true);
    assert.equal(state.reviewCalls, 0); assert.notEqual(state.processExit, undefined); await noReplay(context, network);
  });
  test('a failed first fake HTTP stops later requests and retains its terminal result', async t => {
    const network = networkFor(t, { onRequest: () => ({ type: 'error' }) }), context = await windowsInputFixture();
    const result = failed(await runLocalBootstrap(context.handle), context.expected), atReturn = counters(network);
    assert.equal(network.httpRequests, 1);
    await tick(); assert.deepEqual(counters(network), atReturn); assert(network.sockets.every(socket => socket.destroyed));
    await noReplay(context, network);
  });
  test('concurrent execution of one private context captures and approves only once', async t => {
    const network = networkFor(t), context = await windowsInputFixture();
    const results = await Promise.all([runLocalBootstrap(context.handle), runLocalBootstrap(context.handle)]);
    assert.equal(results.filter(r => r.exitCode === 0).length, 1); assert.equal(results.filter(r => r.code === 'LOCAL_CONTEXT_USED').length, 1);
    completed(results.find(r => r.exitCode === 0), context, network); await noReplay(context, network);
  });
  test('the ordinary bootstrap cannot install private ports as an unlock', async t => {
    const network = networkFor(t), context = await windowsInputFixture();
    const result = failed(await runLocalBootstrap(createLocalBootstrap())); assert.equal(result.code, 'LIVE_EXECUTION_LOCKED'); zero(network);
    assert.throws(() => createLocalBootstrap({ ...context.ports })); assert.equal(inspectWindowsPrivateInputAdapter(context.adapter).captureCalls, 0);
  });
});

const childPath = fileURLToPath(new URL('./fixtures/face-readonly-windows-input-child.mjs', import.meta.url));
const guardUrl = new URL('./fixtures/face-readonly-cli-network-guard.mjs', import.meta.url).href;
const cliPath = fileURLToPath(new URL('../face-readonly.mjs', import.meta.url));
function publicChild({ scenario = 'approve', production = false, childFile = childPath, preload = guardUrl } = {}) {
  return new Promise((resolve, reject) => {
    const env = { SystemRoot: process.env.SystemRoot, windir: process.env.SystemRoot,
      ...(process.env.TEMP ? { TEMP: process.env.TEMP, TMP: process.env.TEMP } : {}),
      ...(process.env.SMART_PM_SYNTHETIC_EVIDENCE_ROOT ? { SMART_PM_SYNTHETIC_EVIDENCE_ROOT: process.env.SMART_PM_SYNTHETIC_EVIDENCE_ROOT } : {}),
      ...(production ? { FACE_READONLY_APPROVED: 'true', FACE_READONLY_WINDOWS_INPUT: 'true' } : {}) };
    const args = ['--import', preload, production ? cliPath : childFile, ...(production ? [] : [scenario])];
    const child = spawn(process.execPath, args, { windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    let stdout = '', stderr = '', settled = false; const reports = [];
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('Synthetic Windows public child deadline exceeded')); }, 15000);
    for (const [stream, role] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', bytes => {
      if (role === 'stdout') stdout += bytes; else stderr += bytes;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 262144) { child.kill(); finish(new Error('Synthetic public output exceeded limit')); }
    });
    child.on('message', message => reports.push(message)); child.once('error', error => finish(error));
    child.once('close', (exitCode, signal) => {
      try {
        assert.equal(signal, null); safePrivateInput({ stdout, stderr, reports }, expectedForSafety);
        assert(stdout.endsWith('\n')); assert.equal(stdout.split('\n').length, 2);
        const output = JSON.parse(stdout), report = reports.find(r => r.kind === (production ? 'synthetic-network-guard' : 'synthetic-windows-private-input'));
        assert(report); assert.equal(report.guard.attempts, 0); assert.equal(output.deleteAllowed, false); assert.equal(output.siteVerification, 'NOT_EXECUTED');
        if (!production) {
          assert.equal(report.result.exitCode, exitCode); assert.deepEqual(report.result.output, output);
          assert.equal(report.afterSettlingDelta, 0); assert.equal(report.retryHttpDelta, 0);
          assert.equal(report.replay.code, 'LOCAL_CONTEXT_USED'); assert.equal(report.network.earlyHttpRequests, 0); assert.equal(report.network.allSocketsDestroyed, true);
        }
        finish(undefined, { stdout, stderr, output, report, exitCode });
      } catch (error) { finish(error); }
    });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') finish(error); }); child.stdin.end(production ? Buffer.from(JSON.stringify(sessionInput())) : undefined);
  });
}
describe('Windows private wrapper public process boundary never emits private input', { concurrency: false }, () => {
  for (const scenario of ['approve', 'default-reject', 'cancel', 'none', 'utf8-eof']) test(`the ${scenario} public child keeps materials off stdout stderr and IPC`, async () => {
    const response = await publicChild({ scenario });
    if (scenario === 'approve') {
      assert.equal(response.exitCode, 0); assert.equal(response.stderr, ''); assert.equal(response.report.network.httpRequests, 36);
      assert.equal(response.report.inspection.input.processExit, 0); assert.equal(response.report.disk.candidateSeal, true);
    } else {
      assert(response.exitCode > 0); assert.equal(response.stderr, `${response.output.error.code}\n`); assert.equal(response.report.network.httpRequests, 0);
      if (scenario === 'utf8-eof') assert.equal(response.report.disk.created, false);
    }
  });
  test('plausible private-input approval environment flags cannot unlock the actual CLI', async () => {
    const response = await publicChild({ production: true }); assert.equal(response.exitCode, 5);
    assert.equal(response.output.error.code, 'LIVE_EXECUTION_LOCKED'); assert.equal(response.stderr, 'LIVE_EXECUTION_LOCKED\n');
  });
});

const repository = fileURLToPath(new URL('../../', import.meta.url));
const inputHelperRelative = 'tools/hikvision-readonly-input/WindowsReadonlyInput.cs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function copiedFaultGraph(directory) {
  const destination = path.join(directory, 's'), manifest = [], visited = new Set();
  function copy(relative) {
    const absolute = path.resolve(repository, relative), key = path.relative(repository, absolute);
    assert(!key.startsWith('..') && !path.isAbsolute(key), 'Only checked-in source descendants may be copied');
    if (visited.has(key)) return; visited.add(key);
    const bytes = fs.readFileSync(absolute), output = path.join(destination, key);
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, bytes, { flag: 'wx' });
    manifest.push({ source: key.replaceAll('\\', '/'), bytes: bytes.length, sha256: digest(bytes) });
    if (/\.(?:mjs|cjs)$/.test(key)) for (const match of bytes.toString('utf8').matchAll(/['"](\.{1,2}\/[^'"\r\n]+\.(?:mjs|cjs))['"]/g)) {
      copy(path.relative(repository, path.resolve(path.dirname(absolute), match[1])));
    }
  }
  copy('admin-web/tests/fixtures/face-readonly-windows-input-child.mjs');
  copy('admin-web/tests/fixtures/face-readonly-cli-network-guard.mjs');
  for (const relative of ['tools/hikvision-readonly-input/Invoke-WindowsReadonlyInput.ps1', inputHelperRelative,
    'tools/hikvision-readonly-evidence/Invoke-WindowsEvidence.ps1', 'tools/hikvision-readonly-evidence/WindowsEvidence.cs']) copy(relative);
  return { destination, manifest, verifyOriginals() {
    for (const item of manifest) assert.equal(digest(fs.readFileSync(path.join(repository, item.source))), item.sha256,
      'The original source must remain unchanged by a synthetic helper-copy fault');
  } };
}
const captureEcho = 'return ",\\"captureId\\":" + Quote(captureId) + ",\\"inputBase64\\":" + Quote(Convert.ToBase64String(input))';
const reviewEcho = 'return ",\\"captureId\\":" + Quote(captureId) + ",\\"challenge\\":" + Quote(challenge) + ",\\"reference\\":" + Quote(reference)';
const viewEcho = '+ ",\\"viewBase64\\":" + Quote(viewBase64) + ",\\"decision\\":" + Quote(selectedEvent);';
const respond = 'Respond(output, id, null, response);';
const privateFaultCases = [
  { name: 'wrong-capture', anchor: captureEcho, replacement: captureEcho.replace('Quote(captureId)', "Quote(new string('0', 32))"),
    reviews: 0, code: 'WINDOWS_INPUT_BINDING' },
  { name: 'wrong-challenge', anchor: reviewEcho, replacement: reviewEcho.replace('Quote(challenge)', "Quote(new string('0', 32))"),
    reviews: 1, code: 'WINDOWS_INPUT_BINDING' },
  { name: 'wrong-reference', anchor: reviewEcho, replacement: reviewEcho.replace('Quote(reference)', 'Quote("WRONG")'),
    reviews: 1, code: 'WINDOWS_INPUT_BINDING' },
  { name: 'wrong-view', anchor: viewEcho, replacement: viewEcho.replace('Quote(viewBase64)', 'Quote("e30=")'),
    reviews: 1, code: 'WINDOWS_INPUT_BINDING' },
  { name: 'duplicate-review', anchor: respond, replacement: respond + '\n                        if (op == "review") ' + respond,
    reviews: 1, code: 'WINDOWS_INPUT_PROTOCOL' },
  { name: 'private-extra-output', anchor: respond,
    replacement: respond + '\n                        if (op == "review") Console.Out.WriteLine("SYNTHETIC_PRIVATE_HELPER_OUTPUT_MARKER");',
    reviews: 1, code: 'WINDOWS_INPUT_PROTOCOL' },
  { name: 'close-ack-exit-one', anchor: 'return session.Failure == null ? 0 : 1;', replacement: 'return 1;',
    reviews: 1, code: 'WINDOWS_INPUT_PROCESS' },
  { name: 'late-review', anchor: 'response = session.Review(command);',
    replacement: 'System.Threading.Thread.Sleep(60000); response = session.Review(command);', reviews: 1, code: 'WINDOWS_INPUT_TIMEOUT' },
];
describe('private helper artifact-copy faults cannot mint approval or leak raw pipe data', { concurrency: false }, () => {
  for (const fault of privateFaultCases) test(`${fault.name} stops before HTTP and remains terminal`, async () => {
    const directory = syntheticBase(), copy = copiedFaultGraph(directory), helper = path.join(copy.destination, inputHelperRelative);
    const original = fs.readFileSync(helper, 'utf8');
    assert.equal(original.split(fault.anchor).length - 1, 1, 'A helper-copy mutation must have exactly one source anchor');
    const changed = original.replace(fault.anchor, fault.replacement); assert.notEqual(changed, original);
    fs.writeFileSync(helper, changed);
    const manifest = { kind: 'synthetic-private-input-helper-copy', fault: fault.name, source: copy.manifest,
      mutation: { path: inputHelperRelative, originalSha256: digest(Buffer.from(original)), mutatedSha256: digest(Buffer.from(changed)) } };
    fs.writeFileSync(path.join(directory, 'source-copy-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    const response = await publicChild({ childFile: path.join(copy.destination, 'admin-web/tests/fixtures/face-readonly-windows-input-child.mjs'),
      preload: pathToFileURL(path.join(copy.destination, 'admin-web/tests/fixtures/face-readonly-cli-network-guard.mjs')).href });
    // Only the outer, already checked public stream is persisted. The private
    // PowerShell pipe includes base64 materials and is never a log artifact.
    fs.writeFileSync(path.join(directory, 'public-stdout.txt'), response.stdout, { flag: 'wx' });
    fs.writeFileSync(path.join(directory, 'public-stderr.txt'), response.stderr, { flag: 'wx' });
    fs.writeFileSync(path.join(directory, 'public-exit.txt'), `${response.exitCode}\n`, { flag: 'wx' });
    fs.writeFileSync(path.join(directory, 'public-ipc.json'), JSON.stringify(response.report, null, 2) + '\n', { flag: 'wx' });
    assert(response.exitCode > 0); assert.equal(response.output.error.code, fault.code);
    assert.equal(response.report.network.httpRequests, 0); assert.equal(response.report.network.tlsConnections, 0);
    assert.equal(response.report.inspection.input.captureCalls, 1); assert.equal(response.report.inspection.input.reviewCalls, fault.reviews);
    assert.equal(response.report.inspection.input.closed, true); assert.equal(response.report.disk.candidateSeal, false);
    assert.equal(response.report.result.mainExitCode, null);
    assert.equal(response.report.result.evidence.status, fault.reviews ? 'INCOMPLETE' : 'NOT_OPENED');
    assert.equal(response.report.replay.code, 'LOCAL_CONTEXT_USED'); copy.verifyOriginals();
  });
});
