import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { getEventListeners } from 'node:events';
import { fileURLToPath } from 'node:url';
import {
  createLocalBootstrap, createOfflineLocalBootstrap, runLocalBootstrap,
  createSyntheticInputSource, createSyntheticApprovalSource,
  createSyntheticEvidenceReceiver, inspectSyntheticEvidenceReceiver,
} from '../lib/face-readonly-local-bootstrap.mjs';
import { installSessionNetworkGuard } from './fixtures/face-readonly-session-network-guard.mjs';
import { installFakeTransport, SYNTHETIC_PATHS as paths } from './fixtures/face-readonly-fake-transport.mjs';
import { SYNTHETIC_OTHER_CERT } from './fixtures/hikvision-synthetic-certificates.mjs';
import {
  sessionInput, sessionExpectations, sessionResponses, SESSION_SECRET_MARKERS,
  SESSION_SERIAL, SESSION_TARGET,
} from './fixtures/face-readonly-session-synthetic.mjs';
import { localBootstrapFixture } from './fixtures/face-readonly-local-bootstrap-synthetic.mjs';
import { sessionPeople } from './fixtures/face-readonly-session-synthetic.mjs';

// The suite only patches the bottom TLS/HTTPS fixture. Independent deny-all
// guards prevent a missing fixture from reaching a real networking primitive.
let guard;
before(() => { guard = installSessionNetworkGuard(); });
after(() => { const snapshot = guard.snapshot(); guard.restore(); assert.equal(snapshot.attempts, 0); });
const clone = value => structuredClone(value);
const tick = () => new Promise(resolve => setImmediate(resolve));
const pending = () => new Promise(() => {});
function safe(value, expected) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const marker of [...SESSION_SECRET_MARKERS, expected?.expectedSpkiPin, expected?.expectedSerialNumber].filter(Boolean)) {
    assert(!text.includes(marker), 'Public bootstrap output exposed synthetic private material');
  }
  for (const key of ['origin', 'username', 'password', 'certificate', 'certificateBase64', 'certificatePath',
    'authorization', 'expectedSpkiPin', 'expectedSerialNumber', 'photoBase64', 'photoBytes', 'faceURL', 'modelData', 'cardNo']) {
    assert(!text.includes(`"${key}"`), `Denied public field ${key}`);
  }
  assert.doesNotMatch(text, /BEGIN (?:CERTIFICATE|PRIVATE KEY)|\bat (?:main|file:\/\/)|SYNTHETIC_SESSION_NETWORK_BLOCKED/);
}
function networkFor(t, options = {}) {
  const cleanups = [];
  const network = installFakeTransport({ after: cleanup => cleanups.push(cleanup) }, { responses: sessionResponses(), ...options });
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup(); });
  return network;
}
const counters = network => ({ tls: network.tlsConnections, https: network.httpsCalls, http: network.httpRequests });
const zero = network => assert.deepEqual(counters(network), { tls: 0, https: 0, http: 0 });
function failed(result, code, expected) {
  safe(result, expected);
  assert([2, 4, 5].includes(result.exitCode));
  assert.equal(result.output.deleteAllowed, false);
  assert.equal(result.output.siteVerification, 'NOT_EXECUTED');
  assert.equal(result.output.error.code, result.code);
  assert.match(result.code, /^(?:LOCAL_|INPUT_|COMMAND_|SESSION_|HIKVISION_|READONLY_|LIVE_EXECUTION_LOCKED$)/);
  if (code) assert.equal(result.code, code);
  assert.notEqual(result.output.outcome, 'controlled-readonly-completed');
  return result;
}
function creatorRejected(action) {
  assert.throws(action, error => {
    safe({ code: error?.code, message: error?.message });
    assert.match(error.code, /^LOCAL_/);
    return true;
  });
}
function completed(result, context, network) {
  safe(result, context.expected);
  assert.equal(result.exitCode, 0); assert.equal(result.mainExitCode, 0);
  assert.equal(result.output.siteVerification, 'NOT_EXECUTED');
  assert.equal(result.output.deleteAllowed, false);
  assert.equal(result.output.total, 9); assert.equal(result.output.complete, true);
  assert.equal(result.output.people.length, 9);
  assert.equal(new Set(result.output.people.map(row => row.employeeNo)).size, 9);
  assert.deepEqual(result.output.verification, { status: 'CONFIRMED', FPID: SESSION_TARGET,
    faceLibType: 'blackFD', FDID: '1', inLibrary: true, actualCount: 9, expectedCount: 9 });
  assert.equal(result.evidence.status, 'COMPLETE');
  const inspection = inspectSyntheticEvidenceReceiver(context.receiver);
  safe(inspection, context.expected);
  assert.equal(inspection.opened, true); assert.equal(inspection.ready, true);
  assert.equal(inspection.sealed, true); assert.equal(inspection.closed, true);
  assert.equal(inspection.incomplete, false);
  assert.deepEqual(inspection.records.map(row => row.role), ['stdout', 'stderr', 'main-exit']);
  assert.equal(inspection.records[0].text.split('\n').length, 2);
  assert(inspection.records[0].text.endsWith('\n'));
  const candidate = JSON.parse(inspection.records[0].text);
  assert.equal(candidate.verification.FPID, SESSION_TARGET);
  assert.equal(inspection.records[1].text, '');
  assert.equal(Number(inspection.records[2].text.trim()), 0);
  assert.equal(network.requests.filter(row => row.path === paths.people).length, 9);
  assert.equal(network.requests.filter(row => row.path === paths.faces).length, 18);
  assert.equal(network.earlyHttpRequests, 0);
  assert(network.sockets.every(socket => socket.destroyed));
  return inspection;
}
async function noReplay(context, network) {
  const before = counters(network), reads = context.readCalls, approvals = context.approvalCalls;
  failed(await runLocalBootstrap(context.handle), 'LOCAL_CONTEXT_USED', context.expected);
  assert.deepEqual(counters(network), before);
  assert.equal(context.readCalls, reads); assert.equal(context.approvalCalls, approvals);
}

describe('local bootstrap defaults and private port brands', { concurrency: false }, () => {
  test('the ordinary local bootstrap stays locked and creates no TLS or HTTP', async t => {
    const network = networkFor(t), handle = createLocalBootstrap();
    const result = failed(await runLocalBootstrap(handle), 'LIVE_EXECUTION_LOCKED');
    assert.equal(result.mainExitCode, null); zero(network);
    assert.equal(result.evidence.status, 'NOT_OPENED');
  });

  test('forged and serialized local handles cannot execute', async t => {
    const network = networkFor(t), context = await localBootstrapFixture();
    assert.deepEqual(Reflect.ownKeys(context.handle), []);
    for (const fake of [{}, clone(context.handle), { approved: true }, null, 'approved']) {
      failed(await runLocalBootstrap(fake), 'LOCAL_CONTEXT_INVALID');
    }
    zero(network); assert.equal(context.readCalls, 0); assert.equal(context.approvalCalls, 0);
    completed(await runLocalBootstrap(context.handle), context, network);
  });

  test('unbranded input approval and receiver ports are rejected before they run', async t => {
    const network = networkFor(t), context = await localBootstrapFixture();
    const good = { inputSource: context.source, approvalSource: context.approval,
      evidenceReceiver: context.receiver, isTransportInstalled: () => true };
    for (const field of ['inputSource', 'approvalSource', 'evidenceReceiver']) {
      for (const fake of [{}, { approved: true }, JSON.parse(JSON.stringify(good[field]))]) creatorRejected(() => createOfflineLocalBootstrap({ ...good, [field]: fake }));
    }
    zero(network); assert.equal(context.readCalls, 0); assert.equal(context.approvalCalls, 0);
  });

  test('unknown factory fields cannot replace Host transport execution or evidence paths', async t => {
    const network = networkFor(t), context = await localBootstrapFixture();
    const good = { inputSource: context.source, approvalSource: context.approval,
      evidenceReceiver: context.receiver, isTransportInstalled: () => true };
    for (const extra of [{ approved: true }, { allowLive: true }, { HostConstructor: () => {} },
      { provider: {} }, { transport: {} }, { execute: () => {} }, { outputDir: '../escape' }, { module: 'synthetic.mjs' }]) {
      creatorRejected(() => createOfflineLocalBootstrap({ ...good, ...extra }));
    }
    zero(network); assert.equal(context.readCalls, 0);
  });

  test('port descriptors and proxies are refused without invoking untrusted getters', () => {
    let traps = 0;
    const getter = {};
    Object.defineProperty(getter, 'read', { get() { traps++; throw new Error(SESSION_SECRET_MARKERS[0]); } });
    creatorRejected(() => createSyntheticInputSource(getter));
    const proxy = new Proxy({ request: () => true }, {
      getPrototypeOf() { traps++; throw new Error(SESSION_SECRET_MARKERS[0]); },
      ownKeys() { traps++; throw new Error(SESSION_SECRET_MARKERS[0]); },
      get() { traps++; throw new Error(SESSION_SECRET_MARKERS[0]); },
    });
    creatorRejected(() => createSyntheticApprovalSource(proxy));
    creatorRejected(() => createSyntheticEvidenceReceiver({ reference: 'SAFE', outputDir: '../escape' }));
    assert.equal(traps, 0);
  });

  test('an absent bottom transport fixture locks before loading private input', async t => {
    const network = networkFor(t), context = await localBootstrapFixture({ isTransportInstalled: () => false });
    failed(await runLocalBootstrap(context.handle), 'LIVE_EXECUTION_LOCKED', context.expected);
    zero(network); assert.equal(context.readCalls, 0); assert.equal(context.approvalCalls, 0);
    await noReplay(context, network);
  });

  for (const [label, runOptions] of [
    ['unknown run fields', { retry: true }],
    ['a forged signal', { signal: { aborted: false, addEventListener() {} } }],
  ]) test(`${label} cannot load a source and still consumes the local attempt`, async t => {
    const network = networkFor(t), context = await localBootstrapFixture();
    failed(await runLocalBootstrap(context.handle, runOptions), 'LOCAL_OPTIONS_INVALID');
    assert.equal(context.readCalls, 0); zero(network); await noReplay(context, network);
  });

  test('run option getters are refused without reading them', async t => {
    const network = networkFor(t), context = await localBootstrapFixture(); let reads = 0;
    const options = {};
    Object.defineProperty(options, 'signal', { get() { reads++; throw new Error(SESSION_SECRET_MARKERS[0]); } });
    failed(await runLocalBootstrap(context.handle, options), 'LOCAL_OPTIONS_INVALID');
    assert.equal(reads, 0); assert.equal(context.readCalls, 0); zero(network); await noReplay(context, network);
  });

  test('one local bootstrap context permits only one concurrent execution', async t => {
    const network = networkFor(t), context = await localBootstrapFixture();
    const results = await Promise.all([runLocalBootstrap(context.handle), runLocalBootstrap(context.handle)]);
    const success = results.filter(row => row.exitCode === 0), denied = results.filter(row => row.code === 'LOCAL_CONTEXT_USED');
    assert.equal(success.length, 1); assert.equal(denied.length, 1);
    assert.equal(context.readCalls, 1); assert.equal(context.approvalCalls, 1);
    completed(success[0], context, network); failed(denied[0], 'LOCAL_CONTEXT_USED');
    assert.equal(network.requests.filter(row => row.path === paths.device).length, 1);
    await noReplay(context, network);
  });

  for (const options of [{ approvalTimeoutMs: 0 }, { approvalTimeoutMs: 30001 },
    { ioTimeoutMs: 0 }, { ioTimeoutMs: 5001 }, { approvalTimeoutMs: '1' }, { retry: true }]) {
    test(`bounded local options reject ${JSON.stringify(options)}`, async t => {
      const network = networkFor(t);
      await assert.rejects(() => localBootstrapFixture({ options }), error => {
        safe({ code: error.code, message: error.message }); assert.match(error.code, /^LOCAL_/); return true;
      });
      zero(network);
    });
  }
});

describe('local private input is bounded and snapshotted before review', { concurrency: false }, () => {
  test('review mutations cannot replace the single private input and expectations snapshot', async t => {
    const network = networkFor(t), input = sessionInput(), expectations = await sessionExpectations();
    const bytes = Buffer.from(JSON.stringify(input));
    let reviewed;
    const context = await localBootstrapFixture({ materials: { inputBytes: bytes, expectations }, request: (view, controls) => {
      reviewed = view; safe(view, expectations); assert(Object.isFrozen(view));
      bytes.fill(0);
      for (const field of Object.keys(expectations)) expectations[field] = 'SYNTHETIC_MUTATED_EXPECTATION';
      input.config.origin = 'https://other-synthetic.invalid'; input.config.password = 'SYNTHETIC_CHANGED_PASSWORD';
      return controls.approve(view);
    } });
    completed(await runLocalBootstrap(context.handle), context, network);
    assert.equal(context.readCalls, 1); assert.equal(reviewed.expectedCount, 9);
    await noReplay(context, network);
  });

  for (const [label, inputBytes] of [
    ['illegal EOF UTF-8 bytes', Buffer.concat([Buffer.from('{"operation":"'), Buffer.from([0xe4, 0xb8])])],
    ['duplicate decoded JSON keys', Buffer.from('{"operation":"list","operation":"list"}')],
    ['malformed JSON', Buffer.from('{')],
    ['over-limit bytes', Buffer.alloc(32769, 0x20)],
    ['text instead of raw bytes', '{}'],
  ]) test(`the input source refuses ${label} before approval or HTTP`, async t => {
    const network = networkFor(t), context = await localBootstrapFixture({ materials: { inputBytes, expectations: await sessionExpectations() } });
    const result = failed(await runLocalBootstrap(context.handle));
    assert.equal(result.mainExitCode, null); assert.equal(context.approvalCalls, 0); zero(network);
    await noReplay(context, network);
  });

  test('unknown input fields cannot request live mode file reads or output destinations', async t => {
    const network = networkFor(t), input = { ...sessionInput(), outputDir: '../escape', approve: true };
    const context = await localBootstrapFixture({ input });
    const result = failed(await runLocalBootstrap(context.handle));
    assert.equal(result.mainExitCode, null); assert.equal(context.approvalCalls, 0); zero(network);
    await noReplay(context, network);
  });

  test('loaded input accessors are rejected without invoking them', async t => {
    const network = networkFor(t);
    let reads = 0;
    const materials = { expectations: await sessionExpectations() };
    Object.defineProperty(materials, 'inputBytes', { get() { reads++; throw new Error(SESSION_SECRET_MARKERS[0]); } });
    const context = await localBootstrapFixture({ materials });
    failed(await runLocalBootstrap(context.handle));
    assert.equal(reads, 0); assert.equal(context.approvalCalls, 0); zero(network);
  });

  test('source errors and private exception text never enter public output', async t => {
    const network = networkFor(t), context = await localBootstrapFixture({ read: () => { throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'); } });
    failed(await runLocalBootstrap(context.handle)); zero(network);
    assert.equal(context.approvalCalls, 0); await noReplay(context, network);
  });

  test('a stalled source has a bounded deadline and cannot be retried', async t => {
    const network = networkFor(t), context = await localBootstrapFixture({ read: pending, options: { ioTimeoutMs: 1 } });
    failed(await runLocalBootstrap(context.handle), 'LOCAL_IO_TIMEOUT');
    zero(network); assert.equal(context.approvalCalls, 0); await noReplay(context, network);
  });

  for (const port of ['source', 'approval', 'receiver']) test(`a direct ${port} return with a then getter is rejected before Promise assimilation`, async t => {
    const network = networkFor(t); let reads = 0;
    const value = {};
    Object.defineProperty(value, 'then', { get() { reads++; throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'); } });
    const change = port === 'source' ? { read: () => value }
      : port === 'approval' ? { request: () => value }
        : { receiverOptions: { onPhase: () => value } };
    const context = await localBootstrapFixture(change);
    failed(await runLocalBootstrap(context.handle));
    assert.equal(reads, 0); zero(network); await tick(); zero(network); await noReplay(context, network);
  });

  for (const port of ['source', 'approval', 'receiver']) test(`a direct ${port} Proxy return is rejected without invoking traps`, async t => {
    const network = networkFor(t); let traps = 0;
    const value = new Proxy({}, {
      get() { traps++; throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'); },
      getPrototypeOf() { traps++; throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'); },
      ownKeys() { traps++; throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'); },
    });
    const change = port === 'source' ? { read: () => value }
      : port === 'approval' ? { request: () => value }
        : { receiverOptions: { onPhase: () => value } };
    const context = await localBootstrapFixture(change);
    failed(await runLocalBootstrap(context.handle));
    assert.equal(traps, 0); zero(network); await tick(); zero(network); await noReplay(context, network);
  });
});

describe('local approval is bound and cannot be serialized or replayed', { concurrency: false }, () => {
  for (const [label, request] of [
    ['boolean true', () => true], ['JSON approved', () => ({ approved: true })],
    ['missing decision', () => undefined], ['cloned ticket', (view, controls) => clone(controls.approve(view))],
    ['cloned review', (view, controls) => controls.approve({ ...view })],
  ]) test(`approval refuses ${label} with zero HTTP`, async t => {
    const network = networkFor(t), context = await localBootstrapFixture({ request });
    const result = failed(await runLocalBootstrap(context.handle));
    assert.equal(result.mainExitCode, null); zero(network); await noReplay(context, network);
  });

  test('explicit rejection never authorizes device traffic', async t => {
    const network = networkFor(t), context = await localBootstrapFixture({ request: (view, controls) => controls.reject(view) });
    failed(await runLocalBootstrap(context.handle), 'LOCAL_APPROVAL_DENIED');
    zero(network); await noReplay(context, network);
  });

  test('an approval adapter with no configured request defaults to rejection', async t => {
    const network = networkFor(t), context = await localBootstrapFixture();
    context.handle = createOfflineLocalBootstrap({ inputSource: context.source,
      approvalSource: createSyntheticApprovalSource(), evidenceReceiver: context.receiver,
      isTransportInstalled: () => true });
    failed(await runLocalBootstrap(context.handle), 'LOCAL_APPROVAL_DENIED');
    assert.equal(context.approvalCalls, 0); zero(network); await noReplay(context, network);
  });

  test('a ticket from another local review domain cannot approve this context', async t => {
    const network = networkFor(t); let foreign;
    const first = await localBootstrapFixture({ request: (view, controls) => (foreign = controls.reject(view)) });
    failed(await runLocalBootstrap(first.handle), 'LOCAL_APPROVAL_DENIED');
    const second = await localBootstrapFixture({ request: () => foreign });
    failed(await runLocalBootstrap(second.handle), 'LOCAL_APPROVAL_INVALID'); zero(network);
    await noReplay(first, network); await noReplay(second, network);
  });

  test('catching a second approval cannot restore the first approval ticket', async t => {
    const network = networkFor(t), context = await localBootstrapFixture({ request: (view, controls) => {
      const first = controls.approve(view);
      try { controls.approve(view); } catch { /* A duplicate decision must poison the entire attempt. */ }
      return first;
    } });
    failed(await runLocalBootstrap(context.handle), 'LOCAL_APPROVAL_USED'); zero(network);
    await noReplay(context, network);
  });

  test('approval timeout and a late decision cannot resume or renew the attempt', async t => {
    const network = networkFor(t); let release, savedView, savedControls;
    const context = await localBootstrapFixture({ options: { approvalTimeoutMs: 1 }, request: (view, controls) => {
      savedView = view; savedControls = controls;
      return new Promise(resolve => { release = resolve; });
    } });
    const result = failed(await runLocalBootstrap(context.handle), 'LOCAL_APPROVAL_TIMEOUT');
    creatorRejected(() => savedControls.approve(savedView));
    release({ approved: true }); await tick();
    failed(result, 'LOCAL_APPROVAL_TIMEOUT'); zero(network); await noReplay(context, network);
  });

  test('transport capability loss during review stops before HTTP', async t => {
    const network = networkFor(t); let installed = true;
    const context = await localBootstrapFixture({ isTransportInstalled: () => installed, request: (view, controls) => {
      installed = false; return controls.approve(view);
    } });
    failed(await runLocalBootstrap(context.handle), 'LIVE_EXECUTION_LOCKED'); zero(network);
    await noReplay(context, network);
  });
});

describe('local evidence receiver has independent completion semantics', { concurrency: false }, () => {
  test('evidence readiness is established before approval or HTTP', async t => {
    const network = networkFor(t), context = await localBootstrapFixture({ receiverOptions: { onPhase: phase => {
      if (phase.phase === 'open') throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER');
    } } });
    failed(await runLocalBootstrap(context.handle), 'LOCAL_EVIDENCE_FAILURE');
    assert.equal(context.approvalCalls, 0); zero(network); await noReplay(context, network);
  });

  test('complete evidence is captured only after the fixed review and single execution', async t => {
    const network = networkFor(t), context = await localBootstrapFixture();
    const inspection = completed(await runLocalBootstrap(context.handle), context, network);
    assert(context.events.indexOf('evidence:open') < context.events.indexOf('approval'));
    assert(context.events.indexOf('approval') < context.events.indexOf('evidence:write:stdout'));
    assert.equal(inspection.phases.filter(row => row.phase === 'open').length, 1);
    assert.equal(inspection.phases.filter(row => row.phase === 'close').length, 1);
    await noReplay(context, network);
  });

  test('a reserved reference cannot overwrite evidence from a prior rejected attempt', async t => {
    const network = networkFor(t), reference = 'LOCAL_BOOTSTRAP_COLLISION_REFERENCE';
    const first = await localBootstrapFixture({ receiverOptions: { reference }, request: (view, controls) => controls.reject(view) });
    failed(await runLocalBootstrap(first.handle), 'LOCAL_APPROVAL_DENIED');
    const before = inspectSyntheticEvidenceReceiver(first.receiver);
    const second = await localBootstrapFixture({ receiverOptions: { reference } });
    failed(await runLocalBootstrap(second.handle), 'LOCAL_EVIDENCE_EXISTS');
    assert.equal(second.approvalCalls, 0); zero(network);
    assert.deepEqual(inspectSyntheticEvidenceReceiver(first.receiver), before);
  });

  test('a different context cannot close or alter an already complete shared receiver', async t => {
    const network = networkFor(t), first = await localBootstrapFixture();
    completed(await runLocalBootstrap(first.handle), first, network);
    const before = inspectSyntheticEvidenceReceiver(first.receiver), traffic = counters(network);
    const second = await localBootstrapFixture();
    second.handle = createOfflineLocalBootstrap({ inputSource: second.source, approvalSource: second.approval,
      evidenceReceiver: first.receiver, isTransportInstalled: () => true });
    const result = failed(await runLocalBootstrap(second.handle), 'LOCAL_EVIDENCE_EXISTS', second.expected);
    assert.equal(result.evidence.status, 'NOT_OPENED'); assert.equal(second.approvalCalls, 0);
    assert.deepEqual(inspectSyntheticEvidenceReceiver(first.receiver), before);
    assert.deepEqual(counters(network), traffic); await noReplay(second, network);
  });

  test('a concurrent rejected context cannot close the receiver owned by a pending approval', async t => {
    const network = networkFor(t); let release, reached;
    const waitingForApproval = new Promise(resolve => { reached = resolve; });
    const first = await localBootstrapFixture({ request: (view, controls) => {
      reached();
      return new Promise(resolve => { release = () => resolve(controls.approve(view)); });
    } });
    const running = runLocalBootstrap(first.handle);
    await waitingForApproval;
    const before = inspectSyntheticEvidenceReceiver(first.receiver);
    assert.equal(before.opened, true); assert.equal(before.closed, false); zero(network);
    const second = await localBootstrapFixture();
    second.handle = createOfflineLocalBootstrap({ inputSource: second.source, approvalSource: second.approval,
      evidenceReceiver: first.receiver, isTransportInstalled: () => true });
    const rejected = failed(await runLocalBootstrap(second.handle), 'LOCAL_EVIDENCE_EXISTS', second.expected);
    assert.equal(rejected.evidence.status, 'NOT_OPENED'); assert.equal(second.approvalCalls, 0);
    assert.deepEqual(inspectSyntheticEvidenceReceiver(first.receiver), before); zero(network);
    release(); completed(await running, first, network);
    await noReplay(first, network); await noReplay(second, network);
  });

  for (const reference of ['../escape', '/absolute', 'D:\\synthetic\\evidence', 'dir/leaf', 'dir\\leaf', 'name:stream', '', 'x'.repeat(65), 'bad\u0000name']) {
    test(`evidence references reject unsafe form ${JSON.stringify(reference)}`, () => {
      creatorRejected(() => createSyntheticEvidenceReceiver({ reference }));
    });
  }

  for (const selected of ['username', 'password', 'serial', 'pin']) test(`a ${selected} cannot be relabelled as a public evidence reference`, async t => {
    const network = networkFor(t), input = sessionInput(), expected = await sessionExpectations();
    const reference = selected === 'serial' ? expected.expectedSerialNumber : selected === 'pin' ? expected.expectedSpkiPin : input.config[selected];
    const context = await localBootstrapFixture({ input, expectations: expected, receiverOptions: { reference } });
    const result = failed(await runLocalBootstrap(context.handle), 'LOCAL_EVIDENCE_REFERENCE', expected);
    assert.equal(Object.hasOwn(result.evidence, 'reference'), false);
    const inspection = inspectSyntheticEvidenceReceiver(context.receiver);
    safe(inspection, expected); assert.equal(Object.hasOwn(inspection, 'reference'), false);
    assert.deepEqual(inspection.records, []); zero(network); assert.equal(context.approvalCalls, 0);
  });

  for (const scenario of ['bad-utf8', 'bad-certificate']) test(`an early ${scenario} rejection cannot reveal an unreviewed private reference`, async t => {
    const network = networkFor(t), input = sessionInput(), expected = await sessionExpectations();
    const reference = scenario === 'bad-utf8' ? input.config.username : expected.expectedSerialNumber;
    if (scenario === 'bad-certificate') input.config.certificateBase64 = Buffer.from('SYNTHETIC_INVALID_CERTIFICATE').toString('base64');
    const materials = { inputBytes: scenario === 'bad-utf8' ? Buffer.from([0xe4, 0xb8]) : Buffer.from(JSON.stringify(input)), expectations: expected };
    const context = await localBootstrapFixture({ materials, receiverOptions: { reference } });
    const result = failed(await runLocalBootstrap(context.handle), undefined, expected);
    assert.equal(Object.hasOwn(result.evidence, 'reference'), false);
    const inspection = inspectSyntheticEvidenceReceiver(context.receiver);
    safe(inspection, expected); assert.equal(Object.hasOwn(inspection, 'reference'), false);
    assert.deepEqual(inspection.records, []); zero(network); assert.equal(context.approvalCalls, 0);
  });

  for (const [phase, role] of [['write', 'stdout'], ['write', 'stderr'], ['write', 'main-exit'], ['seal', undefined]]) {
    test(`a ${phase}${role ? ` ${role}` : ''} receiver failure cannot produce final success`, async t => {
      const network = networkFor(t), context = await localBootstrapFixture({ receiverOptions: { onPhase: event => {
        if (event.phase === phase && event.role === role) throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER');
      } } });
      const result = failed(await runLocalBootstrap(context.handle), 'LOCAL_EVIDENCE_FAILURE', context.expected);
      assert.equal(result.evidence.status, 'INCOMPLETE');
      safe(inspectSyntheticEvidenceReceiver(context.receiver), context.expected);
      assert(network.sockets.every(socket => socket.destroyed)); await noReplay(context, network);
    });
  }

  test('a close failure keeps main success provisional and makes the final exit nonzero', async t => {
    const network = networkFor(t), context = await localBootstrapFixture({ receiverOptions: { onPhase: event => {
      if (event.phase === 'close') throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER');
    } } });
    const result = failed(await runLocalBootstrap(context.handle), 'LOCAL_EVIDENCE_FAILURE', context.expected);
    assert.equal(result.mainExitCode, 0); assert.equal(result.exitCode, 5);
    assert.equal(result.evidence.status, 'INCOMPLETE');
    const inspection = inspectSyntheticEvidenceReceiver(context.receiver);
    safe(inspection, context.expected);
    assert.equal(JSON.parse(inspection.records.find(row => row.role === 'stdout').text).outcome, 'controlled-readonly-completed');
    assert.equal(Number(inspection.records.find(row => row.role === 'main-exit').text.trim()), 0);
    assert.notEqual(result.output.outcome, 'controlled-readonly-completed');
    await noReplay(context, network);
  });

  test('complete failure evidence never turns a nonzero main result into success', async t => {
    const network = networkFor(t, { peerCertificate: SYNTHETIC_OTHER_CERT }), context = await localBootstrapFixture();
    const result = failed(await runLocalBootstrap(context.handle), 'HIKVISION_TLS_PIN', context.expected);
    assert.equal(result.mainExitCode, 4); assert.equal(result.exitCode, 4);
    assert.equal(result.evidence.status, 'COMPLETE');
    const inspection = inspectSyntheticEvidenceReceiver(context.receiver);
    assert.equal(inspection.sealed, true); assert.equal(inspection.closed, true);
    assert.equal(Number(inspection.records.find(row => row.role === 'main-exit').text.trim()), 4);
    assert.equal(JSON.parse(inspection.records.find(row => row.role === 'stdout').text).error.code, 'HIKVISION_TLS_PIN');
    assert.equal(network.httpRequests, 0); await noReplay(context, network);
  });

  test('a receiver acknowledgement cannot substitute for the fixed evidence contract', async t => {
    const network = networkFor(t), context = await localBootstrapFixture({ receiverOptions: { onPhase: () => true } });
    failed(await runLocalBootstrap(context.handle), 'LOCAL_EVIDENCE_INVALID');
    zero(network); assert.equal(context.approvalCalls, 0);
  });

  for (const phase of ['open', 'write', 'close']) test(`a stalled receiver ${phase} stops at its bounded I/O deadline`, async t => {
    let reached = false;
    const network = networkFor(t), context = await localBootstrapFixture({ options: { ioTimeoutMs: 50 }, receiverOptions: { onPhase: event => {
      if (event.phase === phase) { reached = true; return pending(); }
      return undefined;
    } } });
    const result = failed(await runLocalBootstrap(context.handle), 'LOCAL_IO_TIMEOUT');
    assert.equal(reached, true, `The receiver must reach the intended ${phase} phase`);
    assert(inspectSyntheticEvidenceReceiver(context.receiver).phases.some(row => row.phase === phase));
    if (phase === 'open') { zero(network); assert.equal(context.approvalCalls, 0); }
    else assert.equal(result.evidence.status, 'INCOMPLETE');
    await noReplay(context, network);
  });
});

describe('local startup preserves readonly fail-closed gates', { concurrency: false }, () => {
  for (const [label, alter] of [
    ['missing certificate', input => { delete input.config.certificateBase64; }],
    ['certificate path', input => { input.config.certificatePath = 'SYNTHETIC_PRIVATE_CERTIFICATE_PATH'; }],
  ]) test(`${label} input is rejected before approval and transport`, async t => {
    const network = networkFor(t), input = sessionInput(); alter(input);
    const context = await localBootstrapFixture({ input });
    failed(await runLocalBootstrap(context.handle)); zero(network); assert.equal(context.approvalCalls, 0);
  });

  test('an independent expected pin mismatch stops before receiver approval or TLS', async t => {
    const network = networkFor(t), context = await localBootstrapFixture({ expectations: await sessionExpectations({ expectedSpkiPin: '0'.repeat(64) }) });
    failed(await runLocalBootstrap(context.handle), 'SESSION_PIN_MISMATCH');
    zero(network); assert.equal(context.approvalCalls, 0); await noReplay(context, network);
  });

  for (const [label, transport, expectedChanges, code] of [
    ['missing peer certificate', { peerCertificate: null }, {}, 'HIKVISION_TLS_PIN'],
    ['serial mismatch', { responses: sessionResponses({ serial: 'SYNTHETIC_OTHER_SERIAL' }) }, {}, 'READONLY_IDENTITY'],
    ['model mismatch', { responses: sessionResponses({ model: 'SYNTHETIC_OTHER_MODEL' }) }, {}, 'READONLY_MODEL'],
    ['plan mismatch', {}, { expectedPlanFingerprint: '0'.repeat(64) }, 'READONLY_PLAN_MISMATCH'],
    ['count eight', { responses: sessionResponses({ count: 8 }) }, {}, 'READONLY_COUNT_MISMATCH'],
    ['target not in visible library', { responses: sessionResponses({ targetFace: 'no' }) }, {}, 'SESSION_TARGET_UNCONFIRMED'],
    ['wrong visible library', {}, { targetFDID: 'MISSING' }, 'SESSION_TARGET_UNCONFIRMED'],
  ]) test(`${label} remains a nonzero readonly result through startup`, async t => {
    const network = networkFor(t, transport), context = await localBootstrapFixture({ expectations: await sessionExpectations(expectedChanges) });
    const result = failed(await runLocalBootstrap(context.handle), code, context.expected);
    assert.equal(result.evidence.status, 'COMPLETE');
    if (label === 'missing peer certificate') assert.equal(network.httpRequests, 0);
    if (['serial mismatch', 'model mismatch', 'plan mismatch'].includes(label)) assert.equal(network.requests.filter(row => row.path === paths.people).length, 0);
    if (label === 'count eight') {
      assert.equal(network.requests.filter(row => row.path === paths.people).length, 1);
      assert.equal(network.requests.filter(row => row.path === paths.faces).length, 0);
      assert.deepEqual(result.output.observation, { actualCount: 8, expectedCount: 9, complete: false });
    }
    await noReplay(context, network);
  });

  test('a swallowed cancellation during first people HTTP closes and sends no later request', async t => {
    const controller = new AbortController();
    const original = event => event.stopImmediatePropagation();
    controller.signal.addEventListener('abort', original);
    let triggered = false;
    const network = networkFor(t, { onRequest: request => {
      if (!triggered && request.path === paths.people) {
        triggered = true; queueMicrotask(() => controller.abort());
      }
      return undefined;
    } });
    const context = await localBootstrapFixture();
    failed(await runLocalBootstrap(context.handle, { signal: controller.signal }), 'COMMAND_CANCELLED', context.expected);
    await tick();
    assert.equal(triggered, true);
    assert.deepEqual(network.requests.filter(row => row.path === paths.people).map(row => row.json.UserInfoSearchCond.searchResultPosition), [0]);
    assert.equal(network.requests.filter(row => row.path === paths.faces).length, 0);
    assert(network.sockets.every(socket => socket.destroyed));
    assert.deepEqual(getEventListeners(controller.signal, 'abort'), [original]);
    await noReplay(context, network);
  });

  test('pre-cancelled startup consumes its context without loading or networking', async t => {
    const network = networkFor(t), context = await localBootstrapFixture(), controller = new AbortController();
    controller.abort();
    failed(await runLocalBootstrap(context.handle, { signal: controller.signal }), 'COMMAND_CANCELLED');
    assert.equal(context.readCalls, 0); assert.equal(context.approvalCalls, 0); zero(network);
    await noReplay(context, network);
  });

  test('cancellation while approval is pending prevents late approval and HTTP', async t => {
    const network = networkFor(t), controller = new AbortController(); let controls, view, release;
    const context = await localBootstrapFixture({ request: (supplied, capability) => {
      view = supplied; controls = capability;
      queueMicrotask(() => controller.abort());
      return new Promise(resolve => { release = resolve; });
    } });
    failed(await runLocalBootstrap(context.handle, { signal: controller.signal }), 'COMMAND_CANCELLED');
    creatorRejected(() => controls.approve(view));
    release(true); await tick(); zero(network); await noReplay(context, network);
  });
});

const cliPath = fileURLToPath(new URL('../face-readonly.mjs', import.meta.url));
const childPath = fileURLToPath(new URL('./fixtures/face-readonly-local-bootstrap-child.mjs', import.meta.url));
const guardUrl = new URL('./fixtures/face-readonly-cli-network-guard.mjs', import.meta.url).href;
function child({ scenario = 'success', production = false, argv = [], env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['--import', guardUrl, production ? cliPath : childPath, ...(production ? argv : [scenario])];
    const processChild = spawn(process.execPath, args, { cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
      env: { ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}), ...env }, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    let stdout = '', stderr = ''; const reports = [];
    const timer = setTimeout(() => { processChild.kill(); reject(new Error('Synthetic local bootstrap child deadline exceeded')); }, 5000);
    for (const [stream, label] of [[processChild.stdout, 'stdout'], [processChild.stderr, 'stderr']]) stream.on('data', bytes => {
      if (label === 'stdout') stdout += bytes; else stderr += bytes;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 262144) { processChild.kill(); reject(new Error('Synthetic child output limit exceeded')); }
    });
    processChild.on('message', report => reports.push(report));
    processChild.once('error', error => { clearTimeout(timer); reject(error); });
    processChild.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      try {
        assert.equal(signal, null); safe({ stdout, stderr, reports });
        assert(stdout.endsWith('\n')); assert.equal(stdout.split('\n').length, 2);
        const output = JSON.parse(stdout);
        const report = reports.find(row => row.kind === (production ? 'synthetic-network-guard' : 'synthetic-local-bootstrap-harness'));
        assert(report); assert.equal(report.guard.attempts, 0);
        if (!production) {
          assert.equal(report.result.exitCode, exitCode); assert.deepEqual(report.result.output, output);
          assert.equal(report.retryHttpDelta, 0); failed(report.replay, 'LOCAL_CONTEXT_USED');
          assert.equal(report.network.earlyHttpRequests, 0); assert.equal(report.network.allSocketsDestroyed, true);
        }
        resolve({ exitCode, output, stdout, stderr, report });
      } catch (error) { reject(error); }
    });
    processChild.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    processChild.stdin.end(production ? Buffer.from(JSON.stringify(sessionInput())) : undefined);
  });
}

describe('local bootstrap process boundary and installed CLI lock', { concurrency: false }, () => {
  test('a guarded child runs the real main through the local controller and reports the same process exit', async () => {
    const result = await child();
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, '');
    assert.equal(result.output.verification.FPID, SESSION_TARGET);
    assert.equal(result.report.result.evidence.status, 'COMPLETE');
    assert.equal(result.report.readCalls, 1); assert.equal(result.report.approvalCalls, 1);
    assert.equal(result.report.network.httpRequests, 36);
  });

  for (const [scenario, code, mainExit, status] of [
    ['close-failure', 'LOCAL_EVIDENCE_FAILURE', 0, 'INCOMPLETE'],
    ['approval-denied', 'LOCAL_APPROVAL_DENIED', null, undefined],
    ['peer-pin', 'HIKVISION_TLS_PIN', 4, 'COMPLETE'],
    ['count8', 'READONLY_COUNT_MISMATCH', 4, 'COMPLETE'],
    ['cancel-people', 'COMMAND_CANCELLED', 5, undefined],
  ]) test(`the ${scenario} child preserves final exit and safe failure evidence`, async () => {
    const result = await child({ scenario });
    assert.equal(result.output.error.code, code); assert(result.exitCode > 0);
    assert.equal(result.stderr, `${code}\n`); assert.equal(result.report.result.mainExitCode, mainExit);
    if (status) assert.equal(result.report.result.evidence.status, status);
    if (scenario === 'peer-pin') assert.equal(result.report.network.httpRequests, 0);
    if (scenario === 'approval-denied') assert.equal(result.report.network.tlsConnections, 0);
    if (scenario === 'count8') assert.equal(result.report.network.requests.filter(row => row.path === paths.faces).length, 0);
    if (scenario === 'cancel-people') {
      assert.equal(result.report.aborts, 1);
      assert.deepEqual(result.report.network.requests.filter(row => row.path === paths.people).map(row => row.position), [0]);
      assert.equal(result.report.network.requests.filter(row => row.path === paths.faces).length, 0);
    }
  });

  test('the installed CLI still refuses plausible local bootstrap environment unlocks', async () => {
    const result = await child({ production: true, env: { NODE_ENV: 'test', FACE_READONLY_ALLOW_LIVE: 'true',
      FACE_READONLY_LOCAL_APPROVED: 'true', FACE_READONLY_BOOTSTRAP: 'synthetic', FACE_READONLY_SESSION: 'synthetic' } });
    assert.equal(result.exitCode, 5); assert.equal(result.output.error.code, 'LIVE_EXECUTION_LOCKED');
    assert.equal(result.output.siteVerification, 'NOT_EXECUTED'); assert.equal(result.output.deleteAllowed, false);
    assert.equal(result.stderr, 'LIVE_EXECUTION_LOCKED\n');
  });

  test('help remains inert and does not load a private source or register a runner', async () => {
    const result = await child({ production: true, argv: ['--help'] });
    assert.equal(result.exitCode, 0); assert.equal(result.output.outcome, 'help');
    assert.equal(result.output.liveExecution, 'LOCKED'); assert.equal(result.stderr, '');
  });

  test('a proposed live command argument cannot unlock the installed CLI', async () => {
    const result = await child({ production: true, argv: ['--live'] });
    assert.equal(result.exitCode, 2); assert.equal(result.output.error.code, 'UNSUPPORTED_ARGUMENTS');
    assert.equal(result.output.deleteAllowed, false); assert.equal(result.output.siteVerification, 'NOT_EXECUTED');
  });
});

describe('local output privacy distinguishes fixed protocol enums from observed text', { concurrency: false }, () => {
  for (const [field, value] of [['username', 'readonly'], ['username', 'list'], ['password', 'readonly']]) {
    test(`a legitimate ${field} equal to the fixed protocol value ${value} can complete`, async t => {
      const network = networkFor(t), input = sessionInput();
      input.config[field] = value;
      const context = await localBootstrapFixture({ input });
      const result = await runLocalBootstrap(context.handle);
      completed(result, context, network);
      // These strings are required protocol enums, not reflected credentials.
      // Do not apply a blanket JSON substring ban to readonly or list.
      assert.equal(result.output.mode, 'readonly');
      assert.equal(result.output.operation, 'list');
      assert.equal(Object.hasOwn(result.output, field), false);
      assert(result.output.people.every(person => person.name !== value && person.employeeNo !== value));
      await noReplay(context, network);
    });
  }

  for (const scenario of ['serial-in-firmware', 'pin-in-person-name']) {
    test(`observed ${scenario} still fails at the inherited session output guard`, async t => {
      const expected = await sessionExpectations();
      let responses;
      if (scenario === 'serial-in-firmware') {
        responses = sessionResponses({ deviceXml: `<DeviceInfo><model>DS-K1T671BM</model><firmwareVersion>${SESSION_SERIAL}</firmwareVersion><serialNumber>${SESSION_SERIAL}</serialNumber></DeviceInfo>` });
      } else {
        const people = sessionPeople();
        people[0].name = expected.expectedSpkiPin;
        responses = sessionResponses({ people });
      }
      const network = networkFor(t, { responses });
      const context = await localBootstrapFixture({ expectations: expected });
      const result = failed(await runLocalBootstrap(context.handle), 'READONLY_OUTPUT', expected);
      assert.equal(result.mainExitCode, 5);
      assert.equal(result.evidence.status, 'COMPLETE');
      const inspection = inspectSyntheticEvidenceReceiver(context.receiver);
      safe(inspection, expected);
      assert.equal(JSON.parse(inspection.records.find(record => record.role === 'stdout').text).error.code, 'READONLY_OUTPUT');
      assert(network.sockets.every(socket => socket.destroyed));
      await noReplay(context, network);
    });
  }
});
