import fs from 'node:fs';
import path from 'node:path';
import { guardSnapshot } from './face-readonly-cli-network-guard.mjs';
import { installFakeTransport, SYNTHETIC_PATHS } from './face-readonly-fake-transport.mjs';
import { sessionResponses } from './face-readonly-session-synthetic.mjs';
import { localBootstrapFixture } from './face-readonly-local-bootstrap-synthetic.mjs';
import {
  createWindowsEvidenceReceiver, inspectWindowsEvidenceReceiver,
  createOfflineLocalBootstrap, runLocalBootstrap,
} from '../../lib/face-readonly-local-bootstrap.mjs';

const scenario = process.argv[2], baseDirectory = process.argv[3];
if (!['write-false', 'flush-false', 'seal-private-error', 'close-false', 'ack-exit-one', 'extra-output',
  'exit-during-http', 'check-unresponsive', 'restricted-created-acl'].includes(scenario)) throw new Error('Unknown synthetic native fault');
const cleanups = [], signal = path.join(baseDirectory, 'inflight.signal');
let firstHttpSignal = false;
const transport = { responses: sessionResponses() };
if (scenario === 'exit-during-http') transport.onRequest = request => {
  if (request.path === SYNTHETIC_PATHS.device && !firstHttpSignal) {
    firstHttpSignal = true; fs.writeFileSync(signal, 'SYNTHETIC_FIRST_HTTP_RECORDED', { flag: 'wx' });
    return { type: 'timeout' };
  }
  return undefined;
};
const network = installFakeTransport({ after: cleanup => cleanups.push(cleanup) }, transport);
const fixture = await localBootstrapFixture();
const receiver = createWindowsEvidenceReceiver({ baseDirectory, reference: 'SYNTHETIC_FAULT_EVIDENCE' });
const handle = createOfflineLocalBootstrap({ inputSource: fixture.source, approvalSource: fixture.approval,
  evidenceReceiver: receiver, isTransportInstalled: () => true });
const result = await runLocalBootstrap(handle);
const atReturn = { http: network.httpRequests, tls: network.tlsConnections, https: network.httpsCalls };
await new Promise(resolve => setTimeout(resolve, 100));
const afterSettling = { http: network.httpRequests, tls: network.tlsConnections, https: network.httpsCalls };
const reads = fixture.readCalls, approvals = fixture.approvalCalls;
const replay = await runLocalBootstrap(handle);
await new Promise(resolve => setImmediate(resolve));
const report = {
  kind: 'synthetic-native-evidence-fault', scenario, result, replay, atReturn, afterSettling,
  afterReplay: { http: network.httpRequests, tls: network.tlsConnections, https: network.httpsCalls },
  readCalls: reads, approvalCalls: approvals, replayReadDelta: fixture.readCalls - reads,
  replayApprovalDelta: fixture.approvalCalls - approvals, firstHttpSignal,
  inspection: inspectWindowsEvidenceReceiver(receiver), guard: guardSnapshot(),
  requests: network.requests.map(request => ({ method: request.method, path: request.path })),
  network: { earlyHttpRequests: network.earlyHttpRequests, allSocketsDestroyed: network.sockets.every(socket => socket.destroyed) },
};
for (const cleanup of cleanups.reverse()) cleanup();
process.stdout.write(`${JSON.stringify(result.output)}\n`);
if (result.exitCode) process.stderr.write(`${result.code}\n`);
if (process.connected) await new Promise(resolve => process.send(report, resolve));
process.disconnect?.();
process.exitCode = result.exitCode;
