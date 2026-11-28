import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createWindowsEvidenceStore, openWindowsEvidenceStore, writeWindowsEvidenceStore,
  sealWindowsEvidenceStore, closeWindowsEvidenceStore, checkWindowsEvidenceStore, inspectWindowsEvidenceStore,
} from '../lib/face-readonly-windows-evidence.mjs';
import {
  createLocalBootstrap, createOfflineLocalBootstrap, runLocalBootstrap,
  createWindowsEvidenceReceiver, inspectWindowsEvidenceReceiver,
} from '../lib/face-readonly-local-bootstrap.mjs';
import { localBootstrapFixture } from './fixtures/face-readonly-local-bootstrap-synthetic.mjs';
import { installSessionNetworkGuard } from './fixtures/face-readonly-session-network-guard.mjs';
import { installFakeTransport } from './fixtures/face-readonly-fake-transport.mjs';
import { sessionInput, sessionResponses, SESSION_SECRET_MARKERS } from './fixtures/face-readonly-session-synthetic.mjs';
import {
  syntheticBase, reference, textByRole, roles, nativeError, closeQuiet,
  inspectPrivateAcl, inspectDisk, tightenSyntheticAcl, safeNative,
} from './fixtures/face-readonly-windows-evidence-synthetic.mjs';

let guard;
before(() => { assert.equal(process.platform, 'win32'); guard = installSessionNetworkGuard(); });
after(() => { const state = guard.snapshot(); guard.restore(); assert.equal(state.attempts, 0); });
const counts = network => ({ tls: network.tlsConnections, https: network.httpsCalls, http: network.httpRequests });
const zero = network => assert.deepEqual(counts(network), { tls: 0, https: 0, http: 0 });
function networkFor(t) {
  const cleanups = [], network = installFakeTransport({ after: cleanup => cleanups.push(cleanup) }, { responses: sessionResponses() });
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup(); }); return network;
}
function storeFor(t, { baseDirectory = syntheticBase(), ref = reference() } = {}) {
  const store = createWindowsEvidenceStore({ baseDirectory, reference: ref });
  t.after(() => closeQuiet(store, closeWindowsEvidenceStore));
  return { store, baseDirectory, reference: ref, directory: path.join(baseDirectory, ref) };
}
async function writeAll(store) { for (const role of Object.keys(roles)) await writeWindowsEvidenceStore(store, role, textByRole[role]); }
async function finish(store) { await writeAll(store); await sealWindowsEvidenceStore(store); await closeWindowsEvidenceStore(store); }
function safeResult(result) {
  const text = JSON.stringify(result); for (const marker of SESSION_SECRET_MARKERS) assert(!text.includes(marker));
  safeNative(result); assert.equal(result.output.deleteAllowed, false); assert.equal(result.output.siteVerification, 'NOT_EXECUTED');
}
async function contextFor(t, { baseDirectory = syntheticBase(), ref = reference(), request, options, input } = {}) {
  const old = await localBootstrapFixture({ ...(request ? { request } : {}), ...(options ? { options } : {}), ...(input ? { input } : {}) });
  const receiver = createWindowsEvidenceReceiver({ baseDirectory, reference: ref });
  const handle = createOfflineLocalBootstrap({ inputSource: old.source, approvalSource: old.approval,
    evidenceReceiver: receiver, isTransportInstalled: () => true, ...(options ? { options } : {}) });
  return { ...old, receiver, handle, baseDirectory, reference: ref, directory: path.join(baseDirectory, ref), old };
}

describe('Windows native evidence inputs remain code-only and restricted', { concurrency: false }, () => {
  test('native store handles are opaque and invalid handles cannot start a helper', async () => {
    const baseDirectory = syntheticBase(), store = createWindowsEvidenceStore({ baseDirectory, reference: reference() });
    assert.deepEqual(Reflect.ownKeys(store), []); assert.equal(Object.getPrototypeOf(store), null); assert(Object.isFrozen(store));
    for (const forged of [{}, structuredClone(store), null, 'approved']) await assert.rejects(openWindowsEvidenceStore(forged), nativeError);
    assert.deepEqual(fs.readdirSync(baseDirectory), []);
    await closeWindowsEvidenceStore(store);
  });

  for (const [label, baseDirectory] of [
    ['relative', 'synthetic-relative'], ['UNC', '\\\\synthetic.invalid\\share'], ['dot segment', 'D:\\synthetic\\..\\escape'],
    ['alternate stream', 'D:\\synthetic:stream'], ['trailing whitespace', 'D:\\synthetic '], ['device path', '\\\\?\\D:\\synthetic'],
  ]) test(`the native factory refuses a ${label} base without filesystem reads`, () => {
    assert.throws(() => createWindowsEvidenceStore({ baseDirectory, reference: reference() }), nativeError);
  });

  for (const ref of ['', '../escape', 'A/B', 'NUL', 'A\nB']) test(`the native factory refuses reference ${JSON.stringify(ref)}`, () => {
    assert.throws(() => createWindowsEvidenceStore({ baseDirectory: 'D:\\synthetic', reference: ref }), nativeError);
  });

  test('native factories reject caller hooks and never evaluate getters or Proxy traps', () => {
    let touches = 0;
    const getter = { reference: reference() };
    Object.defineProperty(getter, 'baseDirectory', { get() { touches++; throw new Error('SYNTHETIC_PRIVATE_NATIVE_GETTER'); } });
    const proxy = new Proxy({}, { ownKeys() { touches++; throw new Error('SYNTHETIC_PRIVATE_NATIVE_PROXY'); }, getPrototypeOf() { touches++; return Object.prototype; } });
    assert.throws(() => createWindowsEvidenceStore(getter), nativeError);
    assert.throws(() => createWindowsEvidenceStore(proxy), nativeError);
    assert.throws(() => createWindowsEvidenceStore({ baseDirectory: 'D:\\synthetic', reference: reference(), helper: 'other.ps1' }), nativeError);
    assert.throws(() => createWindowsEvidenceReceiver({ baseDirectory: 'D:\\synthetic', reference: reference(), onPhase() {} }));
    assert.equal(touches, 0);
  });

  test('closing an unopened store permanently consumes it without creating objects', async () => {
    const baseDirectory = syntheticBase(), store = createWindowsEvidenceStore({ baseDirectory, reference: reference() });
    await closeWindowsEvidenceStore(store);
    await assert.rejects(openWindowsEvidenceStore(store), nativeError);
    assert.deepEqual(fs.readdirSync(baseDirectory), []);
  });
});

describe('actual Windows evidence handles ACL identity and fixed files', { concurrency: false }, () => {
  test('native success preserves exact UTF8 role bytes private ACL and candidate hashes', async t => {
    const f = storeFor(t); await openWindowsEvidenceStore(f.store);
    const identities = Object.fromEntries(Object.entries(roles).map(([role, file]) => [role, fs.statSync(path.join(f.directory, file), { bigint: true }).ino]));
    await checkWindowsEvidenceStore(f.store); await finish(f.store);
    inspectDisk(f.directory);
    for (const [role, file] of Object.entries(roles)) assert.equal(fs.statSync(path.join(f.directory, file), { bigint: true }).ino, identities[role]);
    const inspection = inspectWindowsEvidenceStore(f.store); safeNative(inspection);
    assert.equal(inspection.opened, true); assert.equal(inspection.sealed, true); assert.equal(inspection.closed, true);
    assert.equal(inspection.processExit, 0); assert.deepEqual(inspection.writtenRoles, Object.keys(roles));
    assert.equal(inspection.failureCode, undefined);
  });

  test('an existing destination is never opened or overwritten', async t => {
    const baseDirectory = syntheticBase(), ref = reference(), directory = path.join(baseDirectory, ref);
    fs.mkdirSync(directory); const file = path.join(directory, 'sentinel.txt'); fs.writeFileSync(file, 'SYNTHETIC_KEEP_ME', { flag: 'wx' });
    const f = storeFor(t, { baseDirectory, ref }); await assert.rejects(openWindowsEvidenceStore(f.store), nativeError);
    assert.equal(fs.readFileSync(file, 'utf8'), 'SYNTHETIC_KEEP_ME'); assert.deepEqual(fs.readdirSync(directory), ['sentinel.txt']);
  });

  test('a missing base is refused instead of recursively creating parent directories', async t => {
    const parent = syntheticBase(), missing = path.join(parent, 'not-created');
    const f = storeFor(t, { baseDirectory: missing }); await assert.rejects(openWindowsEvidenceStore(f.store), nativeError);
    assert.equal(fs.existsSync(missing), false); assert.deepEqual(fs.readdirSync(parent), []);
  });

  test('a junction ancestor is refused before creating the evidence destination', async t => {
    const base = syntheticBase(), target = path.join(base, 'target'), junction = path.join(base, 'junction');
    fs.mkdirSync(target); fs.symlinkSync(target, junction, 'junction');
    const f = storeFor(t, { baseDirectory: junction }); await assert.rejects(openWindowsEvidenceStore(f.store), nativeError);
    assert.deepEqual(fs.readdirSync(target), []); assert.equal(fs.lstatSync(junction).isSymbolicLink(), true);
  });

  for (const [label, action] of [
    ['file rename', f => fs.renameSync(path.join(f.directory, roles.stdout), path.join(f.directory, 'stdout-retained.jsonl'))],
    ['evidence directory rename', f => fs.renameSync(f.directory, `${f.directory}_retained`)],
    ['base directory rename', f => fs.renameSync(f.baseDirectory, `${f.baseDirectory}_retained`)],
    ['hardlink creation', f => fs.linkSync(path.join(f.directory, roles.stdout), path.join(f.directory, 'retained-link.jsonl'))],
  ]) test(`the retained native handles block ${label} during the evidence lifetime`, async t => {
    const f = storeFor(t); await openWindowsEvidenceStore(f.store);
    assert.throws(() => action(f), error => ['EPERM', 'EACCES', 'EBUSY'].includes(error?.code));
    await checkWindowsEvidenceStore(f.store); await finish(f.store); inspectDisk(f.directory);
  });

  test('an unexpected member is refused on recheck and cannot be sealed as complete', async t => {
    const f = storeFor(t); await openWindowsEvidenceStore(f.store);
    const extra = path.join(f.directory, 'unexpected-synthetic.txt'); fs.writeFileSync(extra, 'SYNTHETIC_UNEXPECTED', { flag: 'wx' });
    await assert.rejects(checkWindowsEvidenceStore(f.store), nativeError);
    await assert.rejects(writeWindowsEvidenceStore(f.store, 'stdout', textByRole.stdout), nativeError);
    await assert.rejects(sealWindowsEvidenceStore(f.store), nativeError);
    assert.equal(fs.readFileSync(extra, 'utf8'), 'SYNTHETIC_UNEXPECTED'); assert.equal(fs.existsSync(path.join(f.directory, 'candidate-seal.json')), false);
  });

  test('a tightened synthetic DACL is rejected without granting broader access', async t => {
    const f = storeFor(t); await openWindowsEvidenceStore(f.store);
    const changed = tightenSyntheticAcl(path.join(f.directory, roles.stdout));
    // The test does not permit widening permissions or restoring the ACL.
    // If Windows blocks the metadata mutation itself, that is recorded by the
    // asserted prevention branch; it is not a manufactured successful race.
    if (changed.changed) {
      assert.equal(changed.blocked, false); assert.equal(changed.category, 'CHANGED');
      await assert.rejects(checkWindowsEvidenceStore(f.store), nativeError);
      await assert.rejects(writeWindowsEvidenceStore(f.store, 'stdout', textByRole.stdout), nativeError);
      assert.equal(fs.existsSync(path.join(f.directory, 'candidate-seal.json')), false);
    } else {
      assert.equal(changed.blocked, true); assert(['ACCESS_DENIED', 'ACCESS_OR_SHARING_DENIED'].includes(changed.category));
      await checkWindowsEvidenceStore(f.store); await finish(f.store);
    }
  });

  for (const [label, first] of [
    ['out-of-order role', store => writeWindowsEvidenceStore(store, 'stderr', '')],
    ['unknown role', store => writeWindowsEvidenceStore(store, '../escape', 'SYNTHETIC')],
    ['seal before all roles', store => sealWindowsEvidenceStore(store)],
    ['invalid exit bytes', async store => { await writeWindowsEvidenceStore(store, 'stdout', textByRole.stdout); await writeWindowsEvidenceStore(store, 'stderr', ''); return writeWindowsEvidenceStore(store, 'main-exit', '0'); }],
    ['invalid UTF8 string', store => writeWindowsEvidenceStore(store, 'stdout', '\ud800')],
  ]) test(`${label} permanently fails the native attempt`, async t => {
    const f = storeFor(t); await openWindowsEvidenceStore(f.store);
    await assert.rejects(first(f.store), nativeError);
    await assert.rejects(writeWindowsEvidenceStore(f.store, 'stdout', textByRole.stdout), nativeError);
    await assert.rejects(sealWindowsEvidenceStore(f.store), nativeError);
    assert.equal(fs.existsSync(path.join(f.directory, 'candidate-seal.json')), false);
  });

  test('a duplicate role permanently refuses subsequent evidence writes', async t => {
    const f = storeFor(t); await openWindowsEvidenceStore(f.store);
    await writeWindowsEvidenceStore(f.store, 'stdout', textByRole.stdout);
    await assert.rejects(writeWindowsEvidenceStore(f.store, 'stdout', textByRole.stdout), nativeError);
    await assert.rejects(writeWindowsEvidenceStore(f.store, 'stderr', ''), nativeError);
    assert.equal(fs.existsSync(path.join(f.directory, 'candidate-seal.json')), false);
  });

  test('concurrent writes to one role permanently stop the native attempt', async t => {
    const f = storeFor(t); await openWindowsEvidenceStore(f.store);
    const results = await Promise.allSettled([
      writeWindowsEvidenceStore(f.store, 'stdout', textByRole.stdout),
      writeWindowsEvidenceStore(f.store, 'stdout', textByRole.stdout),
    ]);
    assert(results.every(result => result.status === 'rejected'));
    for (const result of results) nativeError(result.reason);
    await assert.rejects(writeWindowsEvidenceStore(f.store, 'stderr', ''), nativeError);
    await assert.rejects(sealWindowsEvidenceStore(f.store), nativeError);
    assert.equal(fs.existsSync(path.join(f.directory, 'candidate-seal.json')), false);
  });

  test('concurrent close calls share one native close and remain idempotent', async t => {
    const f = storeFor(t); await openWindowsEvidenceStore(f.store); await writeAll(f.store); await sealWindowsEvidenceStore(f.store);
    await Promise.all([closeWindowsEvidenceStore(f.store), closeWindowsEvidenceStore(f.store)]);
    await closeWindowsEvidenceStore(f.store);
    const inspection = inspectWindowsEvidenceStore(f.store);
    assert.equal(inspection.closed, true); assert.equal(inspection.processExit, 0); assert.equal(inspection.failureCode, undefined);
    inspectDisk(f.directory);
  });

  test('closing before seal preserves incomplete private files and cannot reopen', async t => {
    const f = storeFor(t); await openWindowsEvidenceStore(f.store); await writeWindowsEvidenceStore(f.store, 'stdout', textByRole.stdout);
    await closeWindowsEvidenceStore(f.store);
    await assert.rejects(openWindowsEvidenceStore(f.store), nativeError);
    assert.equal(fs.readFileSync(path.join(f.directory, roles.stdout), 'utf8'), textByRole.stdout);
    assert.equal(fs.existsSync(path.join(f.directory, 'candidate-seal.json')), false);
    const acl = inspectPrivateAcl(f.directory, { sealed: false });
    assert(acl.rows.every(row => row.ownerCurrent && row.protected && row.allowedExactly));
  });
});

describe('Windows evidence receiver through the actual readonly bootstrap and fake transport', { concurrency: false }, () => {
  test('the controlled readonly stack completes with real native evidence and a locked site result', async t => {
    const network = networkFor(t), context = await contextFor(t);
    const result = await runLocalBootstrap(context.handle); safeResult(result);
    assert.equal(result.exitCode, 0); assert.equal(result.mainExitCode, 0); assert.equal(result.evidence.status, 'COMPLETE');
    assert.equal(result.output.total, 9); assert.equal(result.output.verification.inLibrary, true); assert.equal(network.httpRequests, 36);
    const inspection = inspectWindowsEvidenceReceiver(context.receiver); safeResult(result); safeNative(inspection);
    assert.equal(inspection.opened, true); assert.equal(inspection.sealed, true); assert.equal(inspection.closed, true); assert.equal(inspection.incomplete, false);
    assert.equal(inspection.native.processExit, 0); assert.equal(inspection.native.closed, true);
    inspectDisk(context.directory, Object.fromEntries(inspection.records.map(row => [row.role, row.text])));
    const prior = counts(network); const replay = await runLocalBootstrap(context.handle); safeResult(replay);
    assert.equal(replay.code, 'LOCAL_CONTEXT_USED'); assert.deepEqual(counts(network), prior);
    const beforeReuse = inspectWindowsEvidenceReceiver(context.receiver);
    const reused = createOfflineLocalBootstrap({ inputSource: context.source, approvalSource: context.approval,
      evidenceReceiver: context.receiver, isTransportInstalled: () => true });
    const rejectedReuse = await runLocalBootstrap(reused); safeResult(rejectedReuse);
    assert.equal(rejectedReuse.code, 'LOCAL_EVIDENCE_EXISTS'); assert.deepEqual(counts(network), prior);
    assert.deepEqual(inspectWindowsEvidenceReceiver(context.receiver), beforeReuse);
    assert(network.sockets.every(socket => socket.destroyed));
  });

  test('certificate input refusal occurs before creating a native evidence directory', async t => {
    const network = networkFor(t), input = sessionInput(); delete input.config.certificateBase64;
    const context = await contextFor(t, { input }); const result = await runLocalBootstrap(context.handle); safeResult(result);
    assert.equal(result.exitCode, 2); assert.equal(result.mainExitCode, null);
    assert.equal(context.old.approvalCalls, 0); assert.equal(fs.existsSync(context.directory), false); zero(network);
  });

  test('native destination failure blocks approval and sends zero fake HTTP', async t => {
    const network = networkFor(t), baseDirectory = syntheticBase(), ref = reference();
    fs.mkdirSync(path.join(baseDirectory, ref)); fs.writeFileSync(path.join(baseDirectory, ref, 'keep.txt'), 'SYNTHETIC_KEEP', { flag: 'wx' });
    const context = await contextFor(t, { baseDirectory, ref }); const result = await runLocalBootstrap(context.handle); safeResult(result);
    assert.equal(result.exitCode, 5); assert.equal(result.mainExitCode, null); assert.equal(context.old.approvalCalls, 0); zero(network);
    assert.equal(result.evidence.status, 'INCOMPLETE'); assert.equal(fs.readFileSync(path.join(context.directory, 'keep.txt'), 'utf8'), 'SYNTHETIC_KEEP');
  });

  test('native evidence is ready before approval and explicit denial preserves its incomplete objects', async t => {
    const network = networkFor(t), baseDirectory = syntheticBase(), ref = reference(), directory = path.join(baseDirectory, ref);
    let reached = false;
    const context = await contextFor(t, { baseDirectory, ref, request: (view, control) => {
      reached = true; assert(Object.values(roles).every(file => fs.existsSync(path.join(directory, file))));
      for (const file of Object.values(roles)) assert.equal(fs.readFileSync(path.join(directory, file)).length, 0);
      return control.reject(view);
    } });
    const result = await runLocalBootstrap(context.handle); safeResult(result);
    assert.equal(reached, true); assert.equal(result.code, 'LOCAL_APPROVAL_DENIED'); assert.equal(result.exitCode, 4); zero(network);
    assert.equal(result.evidence.status, 'INCOMPLETE'); assert.equal(fs.existsSync(path.join(directory, 'candidate-seal.json')), false);
    assert.equal(inspectWindowsEvidenceReceiver(context.receiver).closed, true);
  });

  test('unknown member added during approval stops before the first fake HTTP', async t => {
    const network = networkFor(t), baseDirectory = syntheticBase(), ref = reference(), directory = path.join(baseDirectory, ref);
    const context = await contextFor(t, { baseDirectory, ref, request: (view, control) => {
      fs.writeFileSync(path.join(directory, 'approval-retained.txt'), 'SYNTHETIC_APPROVAL_CHANGE', { flag: 'wx' });
      return control.approve(view);
    } });
    const result = await runLocalBootstrap(context.handle); safeResult(result);
    assert.equal(result.exitCode, 5); assert.equal(result.mainExitCode, null); zero(network);
    assert.equal(result.evidence.status, 'INCOMPLETE'); assert.equal(fs.existsSync(path.join(directory, 'candidate-seal.json')), false);
  });

  test('a pre-cancelled native context is consumed without creating an evidence child directory', async t => {
    const network = networkFor(t), context = await contextFor(t), controller = new AbortController(); controller.abort();
    const result = await runLocalBootstrap(context.handle, { signal: controller.signal }); safeResult(result);
    assert.equal(result.code, 'COMMAND_CANCELLED'); assert.equal(result.exitCode, 5); zero(network);
    assert.equal(fs.existsSync(context.directory), false); assert.equal(context.old.readCalls, 0); assert.equal(context.old.approvalCalls, 0);
    assert.equal((await runLocalBootstrap(context.handle)).code, 'LOCAL_CONTEXT_USED');
  });

  test('cancellation during native-prepared approval stops without HTTP and retains the directory', async t => {
    const network = networkFor(t), controller = new AbortController();
    const context = await contextFor(t, { request: () => { controller.abort(); return undefined; } });
    const result = await runLocalBootstrap(context.handle, { signal: controller.signal }); safeResult(result);
    assert.equal(result.code, 'COMMAND_CANCELLED'); assert.equal(result.exitCode, 5); zero(network);
    assert.equal(fs.existsSync(context.directory), true); assert.equal(result.evidence.status, 'INCOMPLETE');
    assert.equal(inspectWindowsEvidenceReceiver(context.receiver).native.closed, true);
  });

  test('a shortened native startup deadline remains nonzero and cannot replay', async t => {
    const network = networkFor(t), context = await contextFor(t, { options: { ioTimeoutMs: 1 } });
    const result = await runLocalBootstrap(context.handle); safeResult(result);
    // The inherited one-millisecond deadline may expire during input copying
    // before the helper starts. Do not claim a later phase was reached merely
    // because this bounded attempt failed.
    assert.equal(result.exitCode, 5); assert.equal(result.code, 'LOCAL_IO_TIMEOUT');
    assert.equal(result.mainExitCode, null); assert.equal(context.old.approvalCalls, 0); zero(network);
    const before = counts(network); const replay = await runLocalBootstrap(context.handle);
    assert.equal(replay.code, 'LOCAL_CONTEXT_USED'); assert.deepEqual(counts(network), before);
    const native = inspectWindowsEvidenceReceiver(context.receiver).native;
    if (native.processExit !== null) assert.equal(native.closed, true);
  });

  test('the ordinary bootstrap remains locked and cannot accept a native receiver as an unlock', async t => {
    const network = networkFor(t), context = await contextFor(t);
    const result = await runLocalBootstrap(createLocalBootstrap()); safeResult(result);
    assert.equal(result.code, 'LIVE_EXECUTION_LOCKED'); zero(network); assert.equal(fs.existsSync(context.directory), false);
    assert.throws(() => createLocalBootstrap({ evidenceReceiver: context.receiver }));
  });
});
