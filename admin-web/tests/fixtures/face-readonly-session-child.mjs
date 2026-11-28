import { guardSnapshot } from './face-readonly-cli-network-guard.mjs';
import { installFakeTransport, SYNTHETIC_PATHS } from './face-readonly-fake-transport.mjs';
import { SYNTHETIC_OTHER_CERT } from './hikvision-synthetic-certificates.mjs';
import { sessionInput, sessionResponses, sessionExpectations } from './face-readonly-session-synthetic.mjs';
import { prepareReadonlySession, reviewReadonlySession, authorizeReadonlySession, executeReadonlySession } from '../../lib/face-readonly-session.mjs';
import { createControlledReadonlyRunner } from '../../lib/face-readonly-command.mjs';
import { main } from '../../face-readonly.mjs';

// Only fixed scenario labels are accepted. A real Host/provider/SDK runs over
// the synthetic bottom TLS/HTTPS fixture after the independent deny-all guard.
const scenario = process.argv[2];
if (!new Set(['success', 'peer-pin', 'missing-peer', 'serial', 'model', 'plan', 'count8', 'count10', 'target-no', 'target-absent', 'face-error', 'budget', 'cancel-inflight']).has(scenario)) throw new Error('Unknown synthetic session scenario');
const input = sessionInput(scenario === 'budget' ? { options: { maxRequests: 1 } } : {});
const expected = await sessionExpectations();
const responseOptions = {};
if (scenario === 'serial') responseOptions.serial = 'SYNTHETIC_OTHER_SERIAL';
if (scenario === 'model') responseOptions.model = 'SYNTHETIC_OTHER_MODEL';
if (scenario === 'count8') responseOptions.count = 8;
if (scenario === 'count10') responseOptions.count = 10;
if (scenario === 'target-no') responseOptions.targetFace = 'no';
if (scenario === 'target-absent') responseOptions.targetFace = 'absent';
if (scenario === 'plan') expected.expectedPlanFingerprint = '0'.repeat(64);
const controller = new AbortController();
const cleanups = [];
const options = { responses: sessionResponses(responseOptions) };
if (scenario === 'peer-pin') options.peerCertificate = SYNTHETIC_OTHER_CERT;
if (scenario === 'missing-peer') options.peerCertificate = null;
if (scenario === 'face-error') options.onRequest = request => request.path === SYNTHETIC_PATHS.faces ? { type: 'error' } : undefined;
if (scenario === 'cancel-inflight') options.onRequest = () => { queueMicrotask(() => controller.abort()); return { type: 'timeout' }; };
const network = installFakeTransport({ after: cleanup => cleanups.push(cleanup) }, options);
const session = await prepareReadonlySession(input, expected);
const view = reviewReadonlySession(session);
const authorization = authorizeReadonlySession(session, view);
const runner = await createControlledReadonlyRunner({ session, authorization });
let exitCode = 99, replay, retryHttpDelta;
try {
  exitCode = await main({ argv: [], stdin: process.stdin, stdout: process.stdout, stderr: process.stderr,
    signal: controller.signal, runner, inputTimeoutMs: 1000 });
  const before = network.httpRequests;
  try { replay = await executeReadonlySession(session, authorization, input); }
  catch (error) { replay = { error: { code: error?.code } }; }
  retryHttpDelta = network.httpRequests - before;
} catch { /* Parent requires the actual main return value and safe envelope. */ }
const report = {
  kind: 'synthetic-session-harness', returnedExitCode: exitCode, replay, retryHttpDelta,
  guard: guardSnapshot(), network: {
    httpRequests: network.httpRequests, httpsCalls: network.httpsCalls, tlsConnections: network.tlsConnections,
    earlyHttpRequests: network.earlyHttpRequests, allSocketsDestroyed: network.sockets.every(socket => socket.destroyed),
    requests: network.requests.map(request => ({ method: request.method, path: request.path,
      ...(request.path === SYNTHETIC_PATHS.people ? { searchResultPosition: request.json.UserInfoSearchCond.searchResultPosition } : {}),
      ...(request.path === SYNTHETIC_PATHS.faces ? { FPID: request.json.FPID, FDID: request.json.FDID, faceLibType: request.json.faceLibType } : {}),
    })),
  },
};
for (const cleanup of cleanups.reverse()) cleanup();
if (process.connected) await new Promise(resolve => process.send(report, resolve));
process.disconnect?.();
process.exitCode = Number.isInteger(exitCode) ? exitCode : 98;
