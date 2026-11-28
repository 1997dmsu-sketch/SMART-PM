import fs from 'node:fs';
import path from 'node:path';
import { guardSnapshot } from './face-readonly-cli-network-guard.mjs';
import { installFakeTransport } from './face-readonly-fake-transport.mjs';
import { sessionResponses } from './face-readonly-session-synthetic.mjs';
import {
  windowsInteractiveFixture, inspectWindowsInteractiveFixture, safeInteractiveInput,
} from './face-readonly-windows-interactive-synthetic.mjs';
import { runLocalBootstrap } from '../../lib/face-readonly-local-bootstrap.mjs';

const scenario = process.argv[2];
if (!['approve', 'default-reject', 'review-cancel', 'capture-close', 'utf8-eof'].includes(scenario)) {
  throw new Error('Unknown synthetic Windows interactive child');
}
const cleanups = [], network = installFakeTransport({ after: cleanup => cleanups.push(cleanup) }, { responses: sessionResponses() });
const context = await windowsInteractiveFixture({ nativeEvidence: true,
  ...(scenario === 'default-reject' ? { omitAction: true } : scenario === 'approve' ? {} : scenario === 'utf8-eof'
    ? { seedBytes: Buffer.concat([Buffer.from('{"origin":"'), Buffer.from([0xe4, 0xb8])]) } : { action: scenario }) });
const result = await runLocalBootstrap(context.handle), atReturn = network.httpRequests;
await new Promise(resolve => setImmediate(resolve));
const inspection = inspectWindowsInteractiveFixture(context), replay = await runLocalBootstrap(context.handle);
const report = { kind: 'synthetic-windows-interactive-input', scenario, result, replay, inspection,
  afterSettlingDelta: network.httpRequests - atReturn, retryHttpDelta: network.httpRequests - atReturn,
  guard: guardSnapshot(), network: { httpRequests: network.httpRequests, tlsConnections: network.tlsConnections,
    httpsCalls: network.httpsCalls, earlyHttpRequests: network.earlyHttpRequests,
    allSocketsDestroyed: network.sockets.every(socket => socket.destroyed),
    requests: network.requests.map(request => ({ method: request.method, path: request.path })) },
  disk: { created: fs.existsSync(context.directory), candidateSeal: fs.existsSync(path.join(context.directory, 'candidate-seal.json')) } };
safeInteractiveInput({ output: result.output, report }, context.expected);
for (const cleanup of cleanups.reverse()) cleanup();
process.stdout.write(`${JSON.stringify(result.output)}\n`);
if (result.exitCode) process.stderr.write(`${result.code}\n`);
if (process.connected) await new Promise(resolve => process.send(report, resolve));
process.disconnect?.(); process.exitCode = result.exitCode;
