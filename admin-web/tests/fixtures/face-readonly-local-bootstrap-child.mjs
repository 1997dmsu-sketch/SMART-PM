import { guardSnapshot } from './face-readonly-cli-network-guard.mjs';
import { installFakeTransport, SYNTHETIC_PATHS } from './face-readonly-fake-transport.mjs';
import { SYNTHETIC_OTHER_CERT } from './hikvision-synthetic-certificates.mjs';
import { sessionResponses } from './face-readonly-session-synthetic.mjs';
import { localBootstrapFixture } from './face-readonly-local-bootstrap-synthetic.mjs';
import { runLocalBootstrap, inspectSyntheticEvidenceReceiver } from '../../lib/face-readonly-local-bootstrap.mjs';

const scenario = process.argv[2];
if (!new Set(['success', 'close-failure', 'approval-denied', 'peer-pin', 'count8', 'cancel-people']).has(scenario)) throw new Error('Unknown synthetic local bootstrap scenario');
const cleanups = [], controller = new AbortController();
let aborts = 0, cancelled = false, installed = true;
controller.signal.addEventListener('abort', event => { aborts++; event.stopImmediatePropagation(); });
const transportOptions = { responses: sessionResponses(scenario === 'count8' ? { count: 8 } : {}) };
if (scenario === 'peer-pin') transportOptions.peerCertificate = SYNTHETIC_OTHER_CERT;
if (scenario === 'cancel-people') transportOptions.onRequest = request => {
  if (!cancelled && request.path === SYNTHETIC_PATHS.people) {
    cancelled = true; queueMicrotask(() => controller.abort());
  }
  return undefined;
};
const network = installFakeTransport({ after: cleanup => cleanups.push(cleanup) }, transportOptions);
const context = await localBootstrapFixture({
  isTransportInstalled: () => installed,
  ...(scenario === 'approval-denied' ? { request: (view, controls) => controls.reject(view) } : {}),
  ...(scenario === 'close-failure' ? { receiverOptions: { onPhase: phase => {
    if (phase.phase === 'close') throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER');
  } } } : {}),
});
const result = await runLocalBootstrap(context.handle, { signal: controller.signal });
const beforeReplay = network.httpRequests;
const replay = await runLocalBootstrap(context.handle);
const report = { kind: 'synthetic-local-bootstrap-harness', result, replay,
  retryHttpDelta: network.httpRequests - beforeReplay, guard: guardSnapshot(), aborts,
  readCalls: context.readCalls, approvalCalls: context.approvalCalls,
  inspection: inspectSyntheticEvidenceReceiver(context.receiver),
  network: { httpRequests: network.httpRequests, httpsCalls: network.httpsCalls,
    tlsConnections: network.tlsConnections, earlyHttpRequests: network.earlyHttpRequests,
    allSocketsDestroyed: network.sockets.every(socket => socket.destroyed),
    requests: network.requests.map(request => ({ method: request.method, path: request.path,
      ...(request.path === SYNTHETIC_PATHS.people ? { position: request.json.UserInfoSearchCond.searchResultPosition } : {}) })) } };
process.stdout.write(`${JSON.stringify(result.output)}\n`);
if (result.exitCode) process.stderr.write(`${result.code}\n`);
installed = false;
for (const cleanup of cleanups.reverse()) cleanup();
if (process.connected) await new Promise(resolve => process.send(report, resolve));
process.disconnect?.();
process.exitCode = result.exitCode;
