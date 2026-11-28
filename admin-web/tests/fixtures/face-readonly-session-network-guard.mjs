import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import dgram from 'node:dgram';

// Parent-process guard, independent of the bottom-transport fixture and the
// production authorization brand. Children use the existing deny-all preload.
export function installSessionNetworkGuard() {
  const originals = [], denied = Object.create(null);
  const replace = (target, key, label) => {
    if (typeof target?.[key] !== 'function') return;
    originals.push([target, key, target[key]]);
    target[key] = () => {
      denied[label] = (denied[label] ?? 0) + 1;
      throw Object.assign(new Error('SYNTHETIC_SESSION_NETWORK_BLOCKED'), { code: 'SYNTHETIC_SESSION_NETWORK_BLOCKED' });
    };
  };
  for (const key of ['connect', 'createConnection']) replace(net, key, `net.${key}`);
  replace(net.Socket.prototype, 'connect', 'net.Socket.connect');
  replace(tls, 'connect', 'tls.connect');
  for (const [module, label] of [[http, 'http'], [https, 'https']]) for (const key of ['request', 'get']) replace(module, key, `${label}.${key}`);
  for (const key of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) {
    replace(dns, key, `dns.${key}`); replace(dns.promises, key, `dns.promises.${key}`);
    replace(dns.Resolver?.prototype, key, `dns.Resolver.${key}`);
    replace(dns.promises?.Resolver?.prototype, key, `dns.promises.Resolver.${key}`);
  }
  for (const key of ['connect', 'send', 'bind']) replace(dgram.Socket.prototype, key, `dgram.Socket.${key}`);
  return {
    snapshot: () => ({ attempts: Object.values(denied).reduce((sum, value) => sum + value, 0), denied: { ...denied } }),
    restore() { for (const [target, key, original] of originals.toReversed()) target[key] = original; },
  };
}
