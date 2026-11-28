import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import dgram from 'node:dgram';

// Test preload only. It is deliberately independent of the branded synthetic
// HTTPS/TLS fixture: a missing or incomplete fixture cannot reach a real socket.
const denied = Object.create(null);
const originals = [];
function refuse(label) {
  return function syntheticNetworkDenied() {
    denied[label] = (denied[label] ?? 0) + 1;
    throw Object.assign(new Error('SYNTHETIC_NETWORK_GUARD_BLOCKED'), { code: 'SYNTHETIC_NETWORK_GUARD' });
  };
}
function replace(target, key, label) {
  if (typeof target?.[key] !== 'function') return;
  originals.push([target, key, target[key]]);
  target[key] = refuse(label);
}
for (const key of ['connect', 'createConnection']) replace(net, key, `net.${key}`);
replace(net.Socket.prototype, 'connect', 'net.Socket.connect');
replace(tls, 'connect', 'tls.connect');
for (const [module, label] of [[http, 'http'], [https, 'https']]) {
  for (const key of ['request', 'get']) replace(module, key, `${label}.${key}`);
}
for (const key of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) {
  replace(dns, key, `dns.${key}`);
  replace(dns.promises, key, `dns.promises.${key}`);
  replace(dns.Resolver?.prototype, key, `dns.Resolver.${key}`);
  replace(dns.promises?.Resolver?.prototype, key, `dns.promises.Resolver.${key}`);
}
for (const key of ['connect', 'send', 'bind']) replace(dgram.Socket.prototype, key, `dgram.Socket.${key}`);

export const guardSnapshot = () => ({ attempts: Object.values(denied).reduce((sum, count) => sum + count, 0), denied: { ...denied } });
export function restoreNetworkGuard() {
  for (const [target, key, original] of originals.toReversed()) target[key] = original;
}

// Actual production-entry children use this preload but no adapter. Emit only
// guard counters on IPC; never emit argv, input, credentials, or exception text.
let reported = false;
process.on('beforeExit', () => {
  if (reported || !process.connected) return;
  reported = true;
  process.send({ kind: 'synthetic-network-guard', guard: guardSnapshot() }, () => process.disconnect());
});
