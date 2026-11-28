import { guardSnapshot } from './face-readonly-cli-network-guard.mjs';
import { installFakeTransport } from './face-readonly-fake-transport.mjs';
import { sessionResponses } from './face-readonly-session-synthetic.mjs';
import { localBootstrapFixture } from './face-readonly-local-bootstrap-synthetic.mjs';
import { runLocalBootstrap, inspectSyntheticEvidenceReceiver } from '../../lib/face-readonly-local-bootstrap.mjs';

// This process deliberately installs no unhandled-rejection or uncaught-error
// listener. The parent launches it with Node's default rejection policy.
const marker = 'SYNTHETIC_PROMISE_PRIVATE_REASON_9D31';
const scenario = process.argv[2];
const ordinary = scenario === 'ordinary-success';
const [port, shape, settlement] = ordinary ? [] : String(scenario).split(':');
if (!ordinary && (!['source', 'approval', 'open', 'write', 'seal', 'close'].includes(port)
  || !['undefined', 'function', 'getter', 'other-accessor', 'constructor'].includes(shape)
  || !['immediate-reject', 'late-reject', 'fulfilled-object', 'fulfilled'].includes(settlement))) {
  throw new Error('Unknown synthetic Promise observation scenario');
}

const cleanups = [];
const network = installFakeTransport({ after: cleanup => cleanups.push(cleanup) }, { responses: sessionResponses() });
const calls = { overriddenThen: 0, accessor: 0, fulfillmentThen: 0, constructor: 0, ordinaryPromises: 0 };
const lateRejections = [];
let injected = false, controllerReturned = false, releasedAfterReturn = 0;
let injectedPhase = null;
const counts = () => ({ tls: network.tlsConnections, https: network.httpsCalls, http: network.httpRequests });

function portValue(successValue) {
  if (ordinary) { calls.ordinaryPromises++; return Promise.resolve(successValue); }
  injected = true;
  let value;
  if (settlement === 'fulfilled-object') {
    // It is fulfilled before the getter is installed. A rejection-only
    // observer with an implicit identity fulfillment handler would re-resolve
    // this value and invoke the newly installed getter in its derived Promise.
    const payload = {};
    value = Promise.resolve(payload);
    Object.defineProperty(payload, 'then', { get() { calls.fulfillmentThen++; throw new Error(marker); } });
  } else if (settlement === 'fulfilled') value = Promise.resolve(undefined);
  else value = new Promise((_resolve, reject) => {
    if (settlement === 'immediate-reject') reject(new Error(marker));
    else lateRejections.push(() => {
      if (controllerReturned) releasedAfterReturn++;
      reject(new Error(marker));
    });
  });
  if (shape === 'undefined') Object.defineProperty(value, 'then', { value: undefined });
  if (shape === 'function') Object.defineProperty(value, 'then', { value() { calls.overriddenThen++; throw new Error(marker); } });
  if (shape === 'getter') Object.defineProperty(value, 'then', { get() { calls.overriddenThen++; throw new Error(marker); } });
  if (shape === 'other-accessor') Object.defineProperty(value, 'privateMetadata', { get() { calls.accessor++; throw new Error(marker); } });
  if (shape === 'constructor') Object.defineProperty(value, 'constructor', { get() { calls.constructor++; throw new Error(marker); } });
  return value;
}

const context = await localBootstrapFixture({
  read: supplied => ordinary || port === 'source' ? portValue(supplied) : supplied,
  request: (view, control) => {
    if (ordinary) return portValue(control.approve(view));
    if (port === 'approval') return portValue(undefined);
    return control.approve(view);
  },
  receiverOptions: { onPhase: phase => {
    if (ordinary) return portValue(undefined);
    if (!injected && phase.phase === port) {
      injectedPhase = `${phase.phase}${phase.role ? `:${phase.role}` : ''}`;
      return portValue(undefined);
    }
    return undefined;
  } },
});
const result = await runLocalBootstrap(context.handle);
controllerReturned = true;
const atReturn = counts();
// Release late rejection only after runLocalBootstrap has returned its final
// result. Two event-loop turns expose Node's default unhandled-rejection path.
for (const release of lateRejections) release();
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));
const afterSettling = counts();
const inspection = inspectSyntheticEvidenceReceiver(context.receiver);
const reads = context.readCalls, approvals = context.approvalCalls;
const replay = await runLocalBootstrap(context.handle);
await new Promise(resolve => setImmediate(resolve));
const report = {
  kind: 'synthetic-promise-observation', scenario, result, replay, calls,
  injected, injectedPhase, releasedAfterReturn, lateRejectionCount: lateRejections.length,
  atReturn, afterSettling, afterReplay: counts(),
  readCalls: reads, approvalCalls: approvals,
  replayReadDelta: context.readCalls - reads, replayApprovalDelta: context.approvalCalls - approvals,
  inspection, inspectionAfterReplay: inspectSyntheticEvidenceReceiver(context.receiver),
  guard: guardSnapshot(),
  network: { earlyHttpRequests: network.earlyHttpRequests, allSocketsDestroyed: network.sockets.every(socket => socket.destroyed) },
  rejectionPolicy: {
    nodeOptionsPresent: Object.hasOwn(process.env, 'NODE_OPTIONS'),
    nondefaultFlag: process.execArgv.some(arg => arg.startsWith('--unhandled-rejections')),
    unhandledListeners: process.listenerCount('unhandledRejection'),
    uncaughtListeners: process.listenerCount('uncaughtException'),
  },
};
for (const cleanup of cleanups.reverse()) cleanup();
process.stdout.write(`${JSON.stringify(result.output)}\n`);
if (result.exitCode) process.stderr.write(`${result.code}\n`);
if (process.connected) await new Promise(resolve => process.send(report, resolve));
process.disconnect?.();
process.exitCode = result.exitCode;
