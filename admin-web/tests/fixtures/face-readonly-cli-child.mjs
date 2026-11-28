import { guardSnapshot } from './face-readonly-cli-network-guard.mjs';
import { installSyntheticCliAdapter } from './face-readonly-cli-synthetic-adapter.mjs';
import { main } from '../../face-readonly.mjs';
import { Readable } from 'node:stream';

// This executable is never imported by production. Scenario labels select
// fixed test behavior, never a hostname, credential, path, or real transport.
const scenario = process.argv[2];
const allowed = new Set(['success', 'secret-echo', 'bad-pin', 'missing-peer', 'face-error', 'request-timeout', 'cancel-inflight', 'cancel-before', 'cancel-before-output', 'cancel-output-boundary', 'input-timeout', 'help-poison', 'arguments-poison', 'stdout-throw', 'stdout-throw-null', 'stdout-reject-undefined', 'stdout-callback', 'stdout-delayed-callback', 'stderr-throw', 'unbranded-runner', 'proof-false', 'proof-throw-null', 'proof-throw-undefined']);
const synchronousScenarios = new Map([
  ['help-sync-callback-return', { help: true, behavior: 'sync-callback-return' }],
  ['help-promise-only-fulfill', { help: true, behavior: 'promise-only-fulfill' }],
  ['help-sync-callback-promise-reject-undefined', { help: true, behavior: 'sync-callback-promise-reject-undefined' }],
  ['help-sync-callback-throw-error', { help: true, behavior: 'sync-callback-throw-error' }],
  ['help-sync-callback-throw-null', { help: true, behavior: 'sync-callback-throw-null' }],
  ['help-sync-callback-throw-undefined', { help: true, behavior: 'sync-callback-throw-undefined' }],
  ['stdout-sync-callback-throw-error', { behavior: 'sync-callback-throw-error' }],
  ['stdout-sync-callback-throw-null', { behavior: 'sync-callback-throw-null' }],
  ['stdout-sync-callback-throw-undefined', { behavior: 'sync-callback-throw-undefined' }],
]);
for (const fixedScenario of synchronousScenarios.keys()) allowed.add(fixedScenario);
if (!allowed.has(scenario)) throw new Error('Unknown fixed synthetic scenario');
const synchronousScenario = synchronousScenarios.get(scenario);
const controller = new AbortController();
const adapter = installSyntheticCliAdapter({ scenario, controller });
const counters = { inputReads: 0, stdoutWrites: 0, stderrWrites: 0, unbrandedCalls: 0 };
let stdin = process.stdin;
if (scenario === 'help-poison' || scenario === 'arguments-poison' || synchronousScenario?.help) stdin = {
  [Symbol.asyncIterator]() { counters.inputReads += 1; throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'); },
  on() { counters.inputReads += 1; throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'); },
};
if (scenario === 'input-timeout') stdin = new Readable({ read() { counters.inputReads += 1; } });
if (scenario === 'cancel-before') controller.abort();
const sink = (target, key, behavior) => ({ write(value, ...args) {
  counters[key] += 1;
  if (behavior === 'throw') throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER');
  if (behavior === 'throw-null') throw null;
  if (behavior === 'reject-undefined') return Promise.reject(undefined);
  if (behavior === 'callback') {
    const callback = args.find(arg => typeof arg === 'function');
    queueMicrotask(() => callback?.(new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER')));
    return false;
  }
  if (behavior === 'delayed-callback') {
    const callback = args.find(arg => typeof arg === 'function');
    setTimeout(() => callback?.(new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER')), 20);
    return true;
  }
  if (behavior === 'promise-only-fulfill') {
    target.write(value);
    return Promise.resolve();
  }
  if (behavior === 'sync-callback-return' || behavior === 'sync-callback-throw-error' || behavior === 'sync-callback-throw-null' || behavior === 'sync-callback-throw-undefined' || behavior === 'sync-callback-promise-reject-undefined') {
    // Keep the bytes already submitted to the real stdout, then exercise the
    // synchronous writer boundary independently of its native async callback.
    target.write(value);
    const callback = args.find(arg => typeof arg === 'function');
    callback?.();
    if (behavior === 'sync-callback-throw-error') {
      const error = new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER');
      error.cause = error;
      throw error;
    }
    if (behavior === 'sync-callback-throw-null') throw null;
    if (behavior === 'sync-callback-throw-undefined') throw undefined;
    if (behavior === 'sync-callback-promise-reject-undefined') return new Promise((_, reject) => setTimeout(() => reject(undefined), 20));
    return true;
  }
  if (behavior === 'cancel') controller.abort();
  return target.write(value, ...args);
} });
let exitCode;
try {
  exitCode = await main({
    argv: scenario === 'help-poison' || synchronousScenario?.help ? ['--help'] : scenario === 'arguments-poison' ? ['--allow-live=SYNTHETIC_ARG_SECRET_MARKER'] : [], stdin,
    stdout: sink(process.stdout, 'stdoutWrites', synchronousScenario?.behavior ?? (scenario === 'stdout-throw' ? 'throw' : scenario === 'stdout-throw-null' ? 'throw-null' : scenario === 'stdout-reject-undefined' ? 'reject-undefined' : scenario === 'stdout-callback' ? 'callback' : scenario === 'stdout-delayed-callback' ? 'delayed-callback' : scenario === 'cancel-output-boundary' ? 'cancel' : undefined)),
    stderr: sink(process.stderr, 'stderrWrites', scenario === 'stderr-throw' ? 'throw' : undefined),
    signal: controller.signal, inputTimeoutMs: scenario === 'input-timeout' ? 20 : 1000,
    runner: scenario === 'unbranded-runner' ? async () => { counters.unbrandedCalls += 1; throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'); } : adapter.runner,
  });
} catch {
  // An unexpected throw is reported only as a fixed marker and raw nonzero
  // exit. The parent's assertion will fail without printing sensitive values.
  exitCode = 99;
}
const network = adapter.snapshot();
adapter.restore();
const report = { kind: 'synthetic-cli-harness', returnedExitCode: exitCode, counters, network, guard: guardSnapshot() };
if (process.connected) await new Promise(resolve => process.send(report, resolve));
process.disconnect?.();
process.exitCode = Number.isInteger(exitCode) ? exitCode : 98;
