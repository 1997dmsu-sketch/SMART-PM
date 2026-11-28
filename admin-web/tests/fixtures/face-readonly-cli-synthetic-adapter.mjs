import tls from 'node:tls';
import https from 'node:https';
import { createOfflineReadonlyRunner } from '../../lib/face-readonly-command.mjs';
import {
  installFakeTransport, createSyntheticResponseMap, syntheticPeople, SYNTHETIC_PATHS,
} from './face-readonly-fake-transport.mjs';
import { SYNTHETIC_OTHER_CERT } from './hikvision-synthetic-certificates.mjs';
import { SYNTHETIC_CLI_PASSWORD } from './face-readonly-cli-synthetic-input.mjs';

// Test-only branded adapter. The production runner factory itself constructs
// FaceReadonlyHost; its provider, policy, HikvisionClient and SPKI verification
// remain real. The existing transport fixture replaces only TLS and HTTPS.
export function installSyntheticCliAdapter({ scenario, controller }) {
  const cleanups = [];
  const fixtureContext = { after: cleanup => cleanups.push(cleanup) };
  const people = syntheticPeople();
  if (scenario === 'secret-echo') people[0].name = SYNTHETIC_CLI_PASSWORD;
  const responses = createSyntheticResponseMap({ people });
  const options = { responses };
  if (scenario === 'bad-pin') options.peerCertificate = SYNTHETIC_OTHER_CERT;
  if (scenario === 'missing-peer') options.peerCertificate = null;
  if (scenario === 'face-error') options.onRequest = request => request.path === SYNTHETIC_PATHS.faces ? { type: 'error' } : undefined;
  if (scenario === 'request-timeout') options.onRequest = () => ({ type: 'timeout' });
  if (scenario === 'cancel-inflight') options.onRequest = () => {
    queueMicrotask(() => controller.abort());
    return { type: 'timeout' };
  };
  const network = installFakeTransport(fixtureContext, options);
  const syntheticTlsConnect = tls.connect;
  const syntheticHttpsRequest = https.request;
  let runnerCalls = 0;
  const brandedRunner = createOfflineReadonlyRunner({
    isTransportInstalled: () => {
      runnerCalls += 1;
      if (scenario === 'proof-throw-null') throw null;
      if (scenario === 'proof-throw-undefined') throw undefined;
      if (scenario === 'cancel-before-output' && runnerCalls === 5) queueMicrotask(() => controller.abort());
      return scenario !== 'proof-false' && tls.connect === syntheticTlsConnect && https.request === syntheticHttpsRequest;
    },
  });
  return {
    runner: brandedRunner,
    restore() { for (const cleanup of cleanups.reverse()) cleanup(); },
    snapshot() {
      return {
        runnerCalls, httpRequests: network.httpRequests, httpsCalls: network.httpsCalls,
        tlsConnections: network.tlsConnections, earlyHttpRequests: network.earlyHttpRequests,
        allSocketsDestroyed: network.sockets.every(socket => socket.destroyed),
        requests: network.requests.map(request => ({
          method: request.method, path: request.path,
          ...(request.path === SYNTHETIC_PATHS.people ? { searchResultPosition: request.json.UserInfoSearchCond.searchResultPosition, maxResults: request.json.UserInfoSearchCond.maxResults } : {}),
          ...(request.path === SYNTHETIC_PATHS.faces ? { FPID: request.json.FPID, FDID: request.json.FDID, faceLibType: request.json.faceLibType } : {}),
        })),
      };
    },
  };
}
