import { guardSnapshot } from './face-readonly-cli-network-guard.mjs';
import { installSyntheticCliAdapter } from './face-readonly-cli-synthetic-adapter.mjs';
import { main } from '../../face-readonly.mjs';
import { Readable } from 'node:stream';

// This executable is never imported by production. Scenario labels select
// fixed test behavior, never a hostname, credential, path, or real transport.
const scenario = process.argv[2];
const allowed = new Set(['success', 'secret-echo', 'bad-pin', 'missing-peer', 'face-error', 'request-timeout', 'cancel-inflight', 'cancel-before', 'cancel-before-output', 'cancel-output-boundary', 'input-timeout', 'help-poison', 'arguments-poison', 'stdout-throw', 'stdout-throw-null', 'stdout-reject-undefined', 'stdout-callback', 'stdout-delayed-callback', 'stderr-throw', 'unbranded-runner', 'proof-false', 'proof-throw-null', 'proof-throw-undefined']);
if (!allowed.has(scenario)) throw new Error('Unknown fixed synthetic scenario');
const controller = new AbortController();
const adapter = installSyntheticCliAdapter({ scenario, controller });
const counters = { inputReads: 0, stdoutWrites: 0, stderrWrites: 0, unbrandedCalls: 0 };
let stdin = process.stdin;
if (scenario === 'help-poison' || scenario === 'arguments-poison') stdin = {
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
  if (behavior === 'cancel') controller.abort();
  return target.write(value, ...args);
} });
let exitCode;
try {
  exitCode = await main({
    argv: scenario === 'help-poison' ? ['--help'] : scenario === 'arguments-poison' ? ['--allow-live=SYNTHETIC_ARG_SECRET_MARKER'] : [], stdin,
    stdout: sink(process.stdout, 'stdoutWrites', scenario === 'stdout-throw' ? 'throw' : scenario === 'stdout-throw-null' ? 'throw-null' : scenario === 'stdout-reject-undefined' ? 'reject-undefined' : scenario === 'stdout-callback' ? 'callback' : scenario === 'stdout-delayed-callback' ? 'delayed-callback' : scenario === 'cancel-output-boundary' ? 'cancel' : undefined),
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
