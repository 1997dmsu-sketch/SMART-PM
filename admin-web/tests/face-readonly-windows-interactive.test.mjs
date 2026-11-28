import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createWindowsInteractiveInputAdapter, createSyntheticWindowsInteractiveInputAdapter,
  createSyntheticWindowsConfirmation, inspectWindowsPrivateInputAdapter, windowsPrivateInputIsInteractive,
} from '../lib/face-readonly-windows-input.mjs';
import {
  createLocalBootstrap, createWindowsPrivateInputPorts, createOfflineLocalBootstrap, runLocalBootstrap,
  createSyntheticEvidenceReceiver, createSyntheticInputSource, createSyntheticApprovalSource,
} from '../lib/face-readonly-local-bootstrap.mjs';
import { installSessionNetworkGuard } from './fixtures/face-readonly-session-network-guard.mjs';
import { installFakeTransport, SYNTHETIC_PATHS, textReply } from './fixtures/face-readonly-fake-transport.mjs';
import { sessionInput, sessionExpectations, sessionResponses, SESSION_TARGET } from './fixtures/face-readonly-session-synthetic.mjs';
import { syntheticBase, reference, inspectDisk } from './fixtures/face-readonly-windows-evidence-synthetic.mjs';
import {
  INTERACTIVE_ACTIONS, interactiveSeed, windowsInteractiveFixture, inspectWindowsInteractiveFixture,
  safeInteractiveInput, privateInputError,
} from './fixtures/face-readonly-windows-interactive-synthetic.mjs';

// Real interactive adapters are inspected only at construction. Every capture
// below uses fabricated bytes and the hidden synthetic WinForms driver, real
// readonly SDK/Host/policy code, and an independently guarded fake transport.
let guard, expectedForSafety;
before(async () => {
  assert.equal(process.platform, 'win32', 'Interactive WinForms cases require actual Windows');
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
function opaque(handle) {
  assert(Object.isFrozen(handle)); assert.equal(Object.getPrototypeOf(handle), null); assert.deepEqual(Reflect.ownKeys(handle), []);
  const state = inspectWindowsPrivateInputAdapter(handle); safeInteractiveInput(state);
  assert.equal(state.captureCalls, 0); assert.equal(state.reviewCalls, 0); assert.equal(state.closed, false); assert.equal(state.processExit, null);
}
function failed(result, expected = expectedForSafety) {
  safeInteractiveInput(result, expected); assert([2, 4, 5].includes(result.exitCode));
  assert.equal(result.output.deleteAllowed, false); assert.equal(result.output.siteVerification, 'NOT_EXECUTED');
  assert.notEqual(result.output.outcome, 'controlled-readonly-completed'); return result;
}
function completed(result, context, network, expectedHttp = 36) {
  safeInteractiveInput(result, context.expected); assert.equal(result.exitCode, 0); assert.equal(result.mainExitCode, 0);
  assert.equal(result.output.total, 9); assert.equal(result.output.verification.FPID, SESSION_TARGET);
  assert.equal(result.output.verification.inLibrary, true); assert.equal(result.output.deleteAllowed, false);
  assert.equal(result.output.siteVerification, 'NOT_EXECUTED'); assert.equal(result.evidence.status, 'COMPLETE');
  assert.equal(network.httpRequests, expectedHttp); assert.equal(network.earlyHttpRequests, 0);
  const inspection = inspectWindowsInteractiveFixture(context); safeInteractiveInput(inspection, context.expected);
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
const seedMaterial = async () => Buffer.from(JSON.stringify(await interactiveSeed()));
const offline = ports => createOfflineLocalBootstrap({ ...ports, evidenceReceiver: createSyntheticEvidenceReceiver(), isTransportInstalled: () => true });

describe('interactive input factories stay code-only and reject injected approval capabilities', { concurrency: false }, () => {
  test('real default and empty-options factories expose frozen opaque handles without starting capture', () => {
    for (const adapter of [createWindowsInteractiveInputAdapter(), createWindowsInteractiveInputAdapter({})]) {
      opaque(adapter); assert.equal(windowsPrivateInputIsInteractive(adapter), true);
    }
  });
  test('real interactive factory refuses material decisions callbacks destinations and environment-style flags', () => {
    for (const options of [{ config: sessionInput().config }, { inputBytes: Buffer.from('{}') }, { seedBytes: Buffer.from('{}') },
      { expectations: expectedForSafety }, { decision: 'approve' }, { action: 'approve' }, { approved: true },
      { confirmationEvent: createSyntheticWindowsConfirmation({ decision: 'approve' }) }, { read() {} }, { request() {} },
      { helper: 'other.ps1' }, { outputDir: 'SYNTHETIC_OTHER' }, { allowLive: true }, { FACE_READONLY_APPROVED: 'true' }]) {
      assert.throws(() => createWindowsInteractiveInputAdapter(options), privateInputError);
    }
  });
  test('real factory rejects accessors and Proxy options without invoking user code', () => {
    let touches = 0;
    const getter = Object.defineProperty({}, 'action', { get() { touches++; throw new Error('SYNTHETIC_GETTER'); } });
    const proxy = new Proxy({}, { ownKeys() { touches++; throw new Error('SYNTHETIC_PROXY'); }, getPrototypeOf() { touches++; return Object.prototype; } });
    assert.throws(() => createWindowsInteractiveInputAdapter(getter), privateInputError);
    assert.throws(() => createWindowsInteractiveInputAdapter(proxy), privateInputError); assert.equal(touches, 0);
  });
  test('real factory rejects primitive array and inherited-capability option bags', () => {
    for (const options of [null, true, 'approve', [], Object.create({ approved: true }), new Date()]) {
      assert.throws(() => createWindowsInteractiveInputAdapter(options), privateInputError);
    }
  });
  test('synthetic action selection alone constructs opaque handles without native IO', async () => {
    const seedBytes = await seedMaterial();
    for (const action of INTERACTIVE_ACTIONS) {
      const adapter = createSyntheticWindowsInteractiveInputAdapter({ seedBytes, action });
      opaque(adapter); assert.equal(windowsPrivateInputIsInteractive(adapter), false);
    }
    opaque(createSyntheticWindowsInteractiveInputAdapter({ seedBytes }));
  });
  test('synthetic factory refuses unrecognized action values', async () => {
    const seedBytes = await seedMaterial();
    for (const action of ['', true, 'APPROVE', 'approve ', 'click', { decision: 'approve' }]) {
      assert.throws(() => createSyntheticWindowsInteractiveInputAdapter({ seedBytes, action }), privateInputError);
    }
  });
  test('synthetic factory requires genuine Uint8Array seed bytes', () => {
    for (const seedBytes of ['{}', {}, null, new DataView(new ArrayBuffer(2)), new Uint16Array(2), new Proxy(new Uint8Array(2), {})]) {
      assert.throws(() => createSyntheticWindowsInteractiveInputAdapter({ seedBytes }), privateInputError);
    }
  });
  test('synthetic getter options and Proxy traps cannot run before strict refusal', () => {
    let touches = 0;
    const getter = Object.defineProperty({}, 'seedBytes', { get() { touches++; throw new Error('SYNTHETIC_SEED_GETTER'); } });
    const actionGetter = Object.defineProperty({ seedBytes: Buffer.from('{}') }, 'action', { get() { touches++; return 'approve'; } });
    const proxy = new Proxy({}, { ownKeys() { touches++; throw new Error('SYNTHETIC_SEED_PROXY'); }, getPrototypeOf() { touches++; return Object.prototype; } });
    for (const options of [getter, actionGetter, proxy]) assert.throws(() => createSyntheticWindowsInteractiveInputAdapter(options), privateInputError);
    assert.equal(touches, 0);
  });
  test('synthetic factory cannot receive approval flags serialized config or transport callbacks', async () => {
    const seedBytes = await seedMaterial();
    for (const extra of [{ approved: true }, { decision: 'approve' }, { confirmationEvent: {} }, { inputBytes: Buffer.from('{}') },
      { config: {} }, { helper: 'other.ps1' }, { module: 'other.mjs' }, { request() {} }, { outputDir: 'SYNTHETIC_OTHER' }, { allowLive: true }]) {
      assert.throws(() => createSyntheticWindowsInteractiveInputAdapter({ seedBytes, ...extra }), privateInputError);
    }
  });
  test('49153 seed bytes fail synchronously with the fixed size category', () => {
    assert.throws(() => createSyntheticWindowsInteractiveInputAdapter({ seedBytes: Buffer.alloc(49153, 0x20) }), error => {
      assert(privateInputError(error)); assert.equal(error.code, 'WINDOWS_INPUT_SIZE'); return true;
    });
  });
  test('plain and structured-cloned interactive adapter handles cannot mint ports', async () => {
    const adapter = createSyntheticWindowsInteractiveInputAdapter({ seedBytes: await seedMaterial() });
    for (const forged of [{}, structuredClone(adapter), true, null]) {
      assert.throws(() => createWindowsPrivateInputPorts({ adapter: forged }), privateInputError);
    }
    opaque(adapter);
  });
  test('input and approval ports from two synthetic UI domains cannot be mixed', async () => {
    const seedBytes = await seedMaterial(), a = createSyntheticWindowsInteractiveInputAdapter({ seedBytes, action: 'approve' });
    const b = createSyntheticWindowsInteractiveInputAdapter({ seedBytes, action: 'approve' });
    const pa = createWindowsPrivateInputPorts({ adapter: a }), pb = createWindowsPrivateInputPorts({ adapter: b });
    assert.throws(() => offline({ inputSource: pa.inputSource, approvalSource: pb.approvalSource }), privateInputError);
    assert.equal(inspectWindowsPrivateInputAdapter(a).captureCalls, 0); assert.equal(inspectWindowsPrivateInputAdapter(b).reviewCalls, 0);
  });
  test('one interactive port pair cannot construct a second bootstrap domain', async () => {
    const adapter = createSyntheticWindowsInteractiveInputAdapter({ seedBytes: await seedMaterial() });
    const ports = createWindowsPrivateInputPorts({ adapter }); offline(ports); assert.throws(() => offline(ports), privateInputError);
  });
  test('interactive input and approval ports cannot pair with unrelated generic synthetic ports', async () => {
    const adapter = createSyntheticWindowsInteractiveInputAdapter({ seedBytes: await seedMaterial() });
    const ports = createWindowsPrivateInputPorts({ adapter });
    for (const mixed of [{ inputSource: ports.inputSource, approvalSource: createSyntheticApprovalSource() },
      { inputSource: createSyntheticInputSource({ read: () => ({}) }), approvalSource: ports.approvalSource }]) {
      assert.throws(() => offline(mixed), privateInputError);
    }
  });
  test('claiming an interactive adapter for ports is one-use without starting its helper', async () => {
    const adapter = createSyntheticWindowsInteractiveInputAdapter({ seedBytes: await seedMaterial() });
    createWindowsPrivateInputPorts({ adapter }); assert.throws(() => createWindowsPrivateInputPorts({ adapter }), privateInputError);
    assert.equal(inspectWindowsPrivateInputAdapter(adapter).captureCalls, 0);
  });
  test('real and synthetic interactive port brands do not permit cross-domain replay', async () => {
    const real = createWindowsInteractiveInputAdapter();
    const synthetic = createSyntheticWindowsInteractiveInputAdapter({ seedBytes: await seedMaterial(), action: 'approve' });
    const realPorts = createWindowsPrivateInputPorts({ adapter: real }), syntheticPorts = createWindowsPrivateInputPorts({ adapter: synthetic });
    assert.throws(() => offline({ inputSource: realPorts.inputSource, approvalSource: syntheticPorts.approvalSource }), privateInputError);
    assert.throws(() => offline({ inputSource: syntheticPorts.inputSource, approvalSource: realPorts.approvalSource }), privateInputError);
    assert.equal(inspectWindowsPrivateInputAdapter(real).captureCalls, 0); assert.equal(inspectWindowsPrivateInputAdapter(synthetic).captureCalls, 0);
  });
});

describe('hidden WinForms capture preserves strict seed bytes and readonly material boundaries', { concurrency: false }, () => {
  const invalidSeeds = [
    ['illegal UTF8', () => Buffer.from([0xc0, 0xaf])],
    ['UTF8 EOF truncation', () => Buffer.concat([Buffer.from('{"origin":"'), Buffer.from([0xe4, 0xb8])])],
    ['duplicate decoded key', () => Buffer.from('{"origin":"a","or\\u0069gin":"b"}')],
    ['duplicate literal key', () => Buffer.from('{"password":"a","password":"b"}')],
    ['unfinished JSON', () => Buffer.from('{')],
    ['concatenated objects', () => Buffer.from('{}{}')],
    ['array seed', () => Buffer.from('[]')],
    ['unknown approval field', async () => Buffer.from(JSON.stringify({ ...await interactiveSeed(), approved: 'true' }))],
    ['nested config field', async () => Buffer.from(JSON.stringify({ ...await interactiveSeed(), config: { origin: 'SYNTHETIC_OTHER' } }))],
    ['nonstring expected count', async () => Buffer.from(JSON.stringify({ ...await interactiveSeed(), expectedCount: 9 }))],
    ['missing independent serial', async () => { const seed = await interactiveSeed(); delete seed.expectedSerialNumber; return Buffer.from(JSON.stringify(seed)); }],
    ['missing target library', async () => { const seed = await interactiveSeed(); delete seed.targetFDID; return Buffer.from(JSON.stringify(seed)); }],
    ['nonboolean TLS string', async () => Buffer.from(JSON.stringify(await interactiveSeed({ developmentTls: 'yes' })))],
    ['empty seed', () => Buffer.alloc(0)],
    ['capture input over its inherited bound', async () => Buffer.from(JSON.stringify(await interactiveSeed({ password: 'SYNTHETIC_OVERSIZE_PASSWORD'.repeat(1400) })))],
    ['capture expectations over their inherited bound', async () => Buffer.from(JSON.stringify(await interactiveSeed({ expectedSerialNumber: 'SYNTHETIC_OVERSIZE_SERIAL'.repeat(380) })))],
  ];
  for (const [label, makeBytes] of invalidSeeds) test(`${label} never reaches review or HTTP`, async t => {
    const network = networkFor(t), context = await windowsInteractiveFixture({ seedBytes: await makeBytes() });
    const result = failed(await runLocalBootstrap(context.handle), context.expected); assert.equal(result.mainExitCode, null);
    assert.equal(inspectWindowsPrivateInputAdapter(context.adapter).reviewCalls, 0); zero(network); await noReplay(context, network);
  });
  test('synthetic seed bytes are privately copied before caller mutation', async t => {
    const network = networkFor(t), bytes = Buffer.from(` \r\n${JSON.stringify(await interactiveSeed())}\t `);
    const context = await windowsInteractiveFixture({ seedBytes: bytes }); bytes.fill(0);
    completed(await runLocalBootstrap(context.handle), context, network); await noReplay(context, network);
  });
  test('password leading and trailing whitespace reaches exact real SDK Digest hashing', async t => {
    const password = '  SYNTHETIC_CLI_PASSWORD_SECRET_MARKER_原文🙂  ', seed = await interactiveSeed({ password });
    const realm = 'synthetic-interactive-realm', nonce = 'synthetic-interactive-nonce'; let digestChecks = 0;
    const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
    const network = networkFor(t, { onRequest: (request, count) => {
      if (count === 1) return textReply('synthetic authenticate', 401, {
        'www-authenticate': `Digest realm="${realm}", nonce="${nonce}", algorithm=SHA-256, qop="auth"`,
      });
      if (count !== 2) return undefined;
      const header = request.headers.Authorization;
      assert(typeof header === 'string' && header.startsWith('Digest '), 'A Digest response must be present');
      const parts = Object.fromEntries([...header.slice(7).matchAll(/([A-Za-z]+)=(?:"([^"\\]*)"|([^,\s]+))/g)].map(match => [match[1], match[2] ?? match[3]]));
      assert(parts.username === seed.username, 'The fabricated username must reach the SDK unchanged');
      assert.equal(parts.realm, realm); assert.equal(parts.nonce, nonce);
      assert.equal(parts.algorithm, 'SHA-256'); assert.equal(parts.qop, 'auth'); assert.equal(parts.nc, '00000001');
      assert.equal(parts.uri, request.path); assert.match(parts.cnonce, /^[a-f0-9]{32}$/);
      const responseFor = candidate => hash(`${hash(`${seed.username}:${realm}:${candidate}`)}:${nonce}:${parts.nc}:${parts.cnonce}:auth:${hash(`${request.method}:${request.path}`)}`);
      assert(parts.response === responseFor(password), 'Digest must use every original password character');
      assert(parts.response !== responseFor(password.trim()), 'Digest must differ from a trimmed password'); digestChecks++;
      return undefined;
    } });
    const context = await windowsInteractiveFixture({ seed }); completed(await runLocalBootstrap(context.handle), context, network, 37);
    assert.equal(digestChecks, 1); assert.equal(network.requests[0].headers.Authorization, undefined);
    assert.equal(network.requests[0].path, network.requests[1].path); await noReplay(context, network);
  });
});

describe('one visible-control consent gesture binds one readonly execution', { concurrency: false }, () => {
  test('checked explicit approval completes 36 fake requests through real SDK Host policy and native evidence', async t => {
    const network = networkFor(t), context = await windowsInteractiveFixture({ nativeEvidence: true });
    const inspection = completed(await runLocalBootstrap(context.handle), context, network);
    inspectDisk(context.directory, Object.fromEntries(inspection.evidence.records.map(row => [row.role, row.text])));
    await noReplay(context, network);
  });
  test('double approve cannot create a second authorization or HTTP execution', async t => {
    const network = networkFor(t), context = await windowsInteractiveFixture({ action: 'double-approve' });
    completed(await runLocalBootstrap(context.handle), context, network); const atReturn = counters(network);
    await tick(); assert.deepEqual(counters(network), atReturn); await noReplay(context, network);
  });
  test('omitted synthetic action defaults to reject with zero HTTP', async t => {
    const network = networkFor(t), context = await windowsInteractiveFixture({ omitAction: true });
    const result = failed(await runLocalBootstrap(context.handle), context.expected);
    assert.equal(result.code, 'LOCAL_APPROVAL_DENIED'); assert.equal(result.exitCode, 4); zero(network);
    const state = inspectWindowsPrivateInputAdapter(context.adapter);
    assert.equal(state.captureCalls, 1); assert.equal(state.reviewCalls, 1); assert.equal(state.closed, true); assert.equal(state.processExit, 0);
    await noReplay(context, network);
  });
  for (const action of ['reject', 'unchecked-approve', 'check-uncheck', 'review-cancel', 'review-close', 'review-none', 'capture-cancel', 'capture-close']) {
    test(`${action} cannot authorize HTTP or replay a consumed context`, async t => {
      const network = networkFor(t), context = await windowsInteractiveFixture({ action });
      const result = failed(await runLocalBootstrap(context.handle), context.expected); assert.equal(result.mainExitCode, null); zero(network);
      const state = inspectWindowsPrivateInputAdapter(context.adapter);
      assert.equal(state.captureCalls, 1); assert.equal(state.reviewCalls, action.startsWith('capture-') ? 0 : 1);
      assert.equal(state.closed, true);
      if (action.startsWith('capture-')) assert.notEqual(state.processExit, undefined);
      else assert.equal(state.processExit, 0);
      await noReplay(context, network);
    });
  }
});

describe('interactive private lifecycle closes before any transport and remains terminal', { concurrency: false }, () => {
  test('native evidence is ready and the interactive helper has exited before the first fake HTTP', async t => {
    let context, observed = false;
    const network = networkFor(t, { onRequest: request => {
      if (!observed && request.path === SYNTHETIC_PATHS.device) {
        observed = true; const inspection = inspectWindowsInteractiveFixture(context);
        assert.equal(inspection.input.closed, true); assert.equal(inspection.input.processExit, 0);
        assert.equal(inspection.input.reviewCalls, 1); assert.equal(inspection.evidence.ready, true);
        for (const file of ['stdout.jsonl', 'stderr.txt', 'main-exit.txt']) assert.equal(fs.readFileSync(path.join(context.directory, file)).length, 0);
      }
      return undefined;
    } });
    context = await windowsInteractiveFixture({ nativeEvidence: true }); completed(await runLocalBootstrap(context.handle), context, network);
    assert.equal(observed, true);
  });
  test('an existing evidence directory blocks review and preserves its synthetic sentinel', async t => {
    const network = networkFor(t), baseDirectory = syntheticBase(), evidenceReference = reference(), directory = path.join(baseDirectory, evidenceReference);
    fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'keep.txt'), 'SYNTHETIC_INTERACTIVE_RETAINED', { flag: 'wx' });
    const context = await windowsInteractiveFixture({ nativeEvidence: true, baseDirectory, evidenceReference });
    failed(await runLocalBootstrap(context.handle), context.expected); assert.equal(inspectWindowsPrivateInputAdapter(context.adapter).reviewCalls, 0); zero(network);
    assert.equal(fs.readFileSync(path.join(directory, 'keep.txt'), 'utf8'), 'SYNTHETIC_INTERACTIVE_RETAINED'); assert.deepEqual(fs.readdirSync(directory), ['keep.txt']);
  });
  test('pre-cancellation consumes the context before capture or native evidence creation', async t => {
    const network = networkFor(t), context = await windowsInteractiveFixture({ nativeEvidence: true }), controller = new AbortController(); controller.abort();
    const result = failed(await runLocalBootstrap(context.handle, { signal: controller.signal }), context.expected);
    assert.equal(result.code, 'COMMAND_CANCELLED'); assert.equal(inspectWindowsPrivateInputAdapter(context.adapter).captureCalls, 0);
    assert.equal(fs.existsSync(context.directory), false); zero(network); await noReplay(context, network);
  });
  test('an unavailable fake transport locks before the hidden input form is constructed', async t => {
    const network = networkFor(t), context = await windowsInteractiveFixture({ installed: false });
    const result = failed(await runLocalBootstrap(context.handle), context.expected); assert.equal(result.code, 'LIVE_EXECUTION_LOCKED');
    assert.equal(inspectWindowsPrivateInputAdapter(context.adapter).captureCalls, 0); zero(network); await noReplay(context, network);
  });
  test('a one millisecond capture deadline closes the helper before returning failure', async t => {
    const network = networkFor(t), context = await windowsInteractiveFixture({ options: { ioTimeoutMs: 1 } });
    const result = failed(await runLocalBootstrap(context.handle), context.expected);
    assert.equal(result.code, 'LOCAL_IO_TIMEOUT'); assert.equal(result.mainExitCode, null); zero(network);
    const state = inspectWindowsPrivateInputAdapter(context.adapter); assert.equal(state.closed, true); assert.equal(state.reviewCalls, 0);
    assert.notEqual(state.processExit, undefined); await noReplay(context, network);
  });
  test('a first fake HTTP failure cannot start later requests after the result returns', async t => {
    const network = networkFor(t, { onRequest: () => ({ type: 'error' }) }), context = await windowsInteractiveFixture();
    failed(await runLocalBootstrap(context.handle), context.expected); const atReturn = counters(network);
    assert.equal(network.httpRequests, 1); await tick(); assert.deepEqual(counters(network), atReturn);
    assert(network.sockets.every(socket => socket.destroyed)); await noReplay(context, network);
  });
  test('concurrent execution of one context captures and approves only once', async t => {
    const network = networkFor(t), context = await windowsInteractiveFixture();
    const results = await Promise.all([runLocalBootstrap(context.handle), runLocalBootstrap(context.handle)]);
    assert.equal(results.filter(result => result.exitCode === 0).length, 1);
    assert.equal(results.filter(result => result.code === 'LOCAL_CONTEXT_USED').length, 1);
    completed(results.find(result => result.exitCode === 0), context, network); await noReplay(context, network);
  });
  test('an approved domain cannot transfer its decision to a separate default-denied domain', async t => {
    const network = networkFor(t), approved = await windowsInteractiveFixture(), denied = await windowsInteractiveFixture({ omitAction: true });
    completed(await runLocalBootstrap(approved.handle), approved, network); const prior = counters(network);
    const result = failed(await runLocalBootstrap(denied.handle), denied.expected); assert.equal(result.code, 'LOCAL_APPROVAL_DENIED');
    assert.deepEqual(counters(network), prior); assert.equal(inspectWindowsPrivateInputAdapter(denied.adapter).reviewCalls, 1);
    await noReplay(approved, network); await noReplay(denied, network);
  });
  test('ordinary local bootstrap remains locked and cannot install interactive ports', async t => {
    const network = networkFor(t), context = await windowsInteractiveFixture();
    const result = failed(await runLocalBootstrap(createLocalBootstrap())); assert.equal(result.code, 'LIVE_EXECUTION_LOCKED'); zero(network);
    assert.throws(() => createLocalBootstrap({ ...context.ports })); assert.equal(inspectWindowsPrivateInputAdapter(context.adapter).captureCalls, 0);
  });
});

const childPath = fileURLToPath(new URL('./fixtures/face-readonly-windows-interactive-child.mjs', import.meta.url));
const guardUrl = new URL('./fixtures/face-readonly-cli-network-guard.mjs', import.meta.url).href;
const cliPath = fileURLToPath(new URL('../face-readonly.mjs', import.meta.url));
function publicChild({ scenario = 'approve', production = false } = {}) {
  return new Promise((resolve, reject) => {
    const env = { SystemRoot: process.env.SystemRoot, windir: process.env.SystemRoot,
      ...(process.env.TEMP ? { TEMP: process.env.TEMP, TMP: process.env.TEMP } : {}),
      ...(process.env.SMART_PM_SYNTHETIC_EVIDENCE_ROOT ? { SMART_PM_SYNTHETIC_EVIDENCE_ROOT: process.env.SMART_PM_SYNTHETIC_EVIDENCE_ROOT } : {}),
      ...(production ? { FACE_READONLY_APPROVED: 'true', FACE_READONLY_WINDOWS_INPUT: 'true', FACE_READONLY_INTERACTIVE: 'true',
        FACE_READONLY_WINDOWS_INTERACTIVE: 'true', FACE_READONLY_ALLOW_LIVE: 'true' } : {}) };
    const child = spawn(process.execPath, ['--import', guardUrl, production ? cliPath : childPath, ...(production ? [] : [scenario])],
      { windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    let stdout = '', stderr = '', settled = false; const reports = [];
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('Synthetic Windows interactive public child deadline exceeded')); }, 20000);
    for (const [stream, role] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', bytes => {
      if (role === 'stdout') stdout += bytes; else stderr += bytes;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 262144) { child.kill(); finish(new Error('Synthetic interactive public output exceeded limit')); }
    });
    child.on('message', message => reports.push(message)); child.once('error', error => finish(error));
    child.once('close', (exitCode, signal) => {
      try {
        assert.equal(signal, null); safeInteractiveInput({ stdout, stderr, reports }, expectedForSafety);
        assert(stdout.endsWith('\n')); assert.equal(stdout.split('\n').length, 2);
        const output = JSON.parse(stdout), report = reports.find(item => item.kind === (production ? 'synthetic-network-guard' : 'synthetic-windows-interactive-input'));
        assert(report); assert.equal(report.guard.attempts, 0); assert.equal(output.deleteAllowed, false); assert.equal(output.siteVerification, 'NOT_EXECUTED');
        if (!production) {
          assert.equal(report.result.exitCode, exitCode); assert.deepEqual(report.result.output, output);
          assert.equal(report.afterSettlingDelta, 0); assert.equal(report.retryHttpDelta, 0);
          assert.equal(report.replay.code, 'LOCAL_CONTEXT_USED'); assert.equal(report.network.earlyHttpRequests, 0);
          assert.equal(report.network.allSocketsDestroyed, true);
        }
        // Only verified outer public streams and IPC are retained. Never attach
        // listeners or log files to a private PowerShell helper pipe.
        const directory = syntheticBase();
        fs.writeFileSync(path.join(directory, 'public-stdout.txt'), stdout, { flag: 'wx' });
        fs.writeFileSync(path.join(directory, 'public-stderr.txt'), stderr, { flag: 'wx' });
        fs.writeFileSync(path.join(directory, 'public-exit.txt'), `${exitCode}\n`, { flag: 'wx' });
        fs.writeFileSync(path.join(directory, 'public-ipc.json'), JSON.stringify(reports, null, 2) + '\n', { flag: 'wx' });
        finish(undefined, { stdout, stderr, output, report, exitCode, directory });
      } catch (error) { finish(error); }
    });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') finish(error); });
    child.stdin.end(production ? Buffer.from(JSON.stringify(sessionInput())) : undefined);
  });
}
describe('interactive wrapper public process output never exposes private input', { concurrency: false }, () => {
  for (const scenario of ['approve', 'default-reject', 'review-cancel', 'capture-close', 'utf8-eof']) {
    test(`${scenario} child keeps material off outer stdout stderr and IPC`, async () => {
      const response = await publicChild({ scenario });
      if (scenario === 'approve') {
        assert.equal(response.exitCode, 0); assert.equal(response.stderr, ''); assert.equal(response.report.network.httpRequests, 36);
        assert.equal(response.report.inspection.input.processExit, 0); assert.equal(response.report.disk.candidateSeal, true);
      } else {
        assert(response.exitCode > 0); assert.equal(response.stderr, `${response.output.error.code}\n`); assert.equal(response.report.network.httpRequests, 0);
        assert.equal(response.report.disk.candidateSeal, false);
        if (['capture-close', 'utf8-eof'].includes(scenario)) assert.equal(response.report.disk.created, false);
      }
    });
  }
  test('interactive approval environment flags cannot unlock the actual CLI executable', async () => {
    const response = await publicChild({ production: true }); assert.equal(response.exitCode, 5);
    assert.equal(response.output.error.code, 'LIVE_EXECUTION_LOCKED'); assert.equal(response.stderr, 'LIVE_EXECUTION_LOCKED\n');
  });
});
