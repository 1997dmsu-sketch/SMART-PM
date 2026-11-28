import fs from 'node:fs';
import path from 'node:path';
import { guardSnapshot } from './face-readonly-cli-network-guard.mjs';
import { installFakeTransport } from './face-readonly-fake-transport.mjs';
import { sessionResponses } from './face-readonly-session-synthetic.mjs';
import { windowsInputFixture, inspectWindowsInputFixture } from './face-readonly-windows-input-synthetic.mjs';
import { runLocalBootstrap } from '../../lib/face-readonly-local-bootstrap.mjs';

const scenario = process.argv[2];
if (!['approve', 'default-reject', 'cancel', 'none', 'utf8-eof'].includes(scenario)) throw new Error('Unknown synthetic Windows input child');
const cleanups = [], network = installFakeTransport({ after: cleanup => cleanups.push(cleanup) }, { responses: sessionResponses() });
const context = await windowsInputFixture({ nativeEvidence: true,
  ...(scenario === 'default-reject' ? { omitConfirmation: true } : scenario === 'approve' ? {} : scenario === 'utf8-eof'
    ? { inputBytes: Buffer.concat([Buffer.from('{"operation":"'), Buffer.from([0xe4, 0xb8])]) } : { decision: scenario }) });
const result = await runLocalBootstrap(context.handle), atReturn = network.httpRequests;
await new Promise(resolve => setImmediate(resolve));
const inspection = inspectWindowsInputFixture(context);
const replay = await runLocalBootstrap(context.handle);
const report = { kind: 'synthetic-windows-private-input', scenario, result, replay, inspection,
  afterSettlingDelta: network.httpRequests - atReturn, retryHttpDelta: network.httpRequests - atReturn,
  guard: guardSnapshot(), network: { httpRequests: network.httpRequests, tlsConnections: network.tlsConnections,
    httpsCalls: network.httpsCalls, earlyHttpRequests: network.earlyHttpRequests,
    allSocketsDestroyed: network.sockets.every(socket => socket.destroyed),
    requests: network.requests.map(request => ({ method: request.method, path: request.path })) },
  disk: { created: fs.existsSync(context.directory), candidateSeal: fs.existsSync(path.join(context.directory, 'candidate-seal.json')) } };
for (const cleanup of cleanups.reverse()) cleanup();
process.stdout.write(`${JSON.stringify(result.output)}\n`);
if (result.exitCode) process.stderr.write(`${result.code}\n`);
if (process.connected) await new Promise(resolve => process.send(report, resolve));
process.disconnect?.(); process.exitCode = result.exitCode;
