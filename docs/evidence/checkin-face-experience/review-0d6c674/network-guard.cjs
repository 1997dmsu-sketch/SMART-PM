'use strict';
// Review-only guard: outbound/listening entry points throw; no real target is forwarded.
const fs = require('node:fs');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const calls = Object.create(null);
function block(object, key, name) {
  if (typeof object?.[key] !== 'function') return;
  calls[name] = 0;
  object[key] = function () {
    calls[name]++;
    const error = new Error('REVIEW_NETWORK_BLOCKED');
    error.code = 'REVIEW_NETWORK_BLOCKED';
    throw error;
  };
}
for (const name of ['http', 'https']) {
  const object = require('node:' + name);
  for (const key of ['request', 'get', 'createServer']) block(object, key, name + '.' + key);
}
const net = require('node:net');
for (const key of ['connect', 'createConnection', 'createServer']) block(net, key, 'net.' + key);
block(net.Socket.prototype, 'connect', 'net.Socket.connect');
block(net.Server.prototype, 'listen', 'net.Server.listen');
const tls = require('node:tls');
for (const key of ['connect', 'createServer']) block(tls, key, 'tls.' + key);
const dgram = require('node:dgram');
block(dgram, 'createSocket', 'dgram.createSocket');
for (const key of ['send', 'bind', 'connect']) block(dgram.Socket.prototype, key, 'dgram.Socket.' + key);
const dns = require('node:dns');
for (const key of Object.keys(dns)) if (/^(?:lookup|resolve|reverse)/.test(key)) block(dns, key, 'dns.' + key);
for (const key of Object.keys(dns.promises)) if (/^(?:lookup|resolve|reverse)/.test(key)) block(dns.promises, key, 'dns.promises.' + key);
for (const key of ['fetch', 'WebSocket', 'EventSource']) block(globalThis, key, 'global.' + key);
syncBuiltinESMExports();
process.once('exit', () => {
  fs.appendFileSync(path.join(__dirname, 'network-events.jsonl'), JSON.stringify({
    pid: process.pid, slotCount: Object.keys(calls).length,
    totalCalls: Object.values(calls).reduce((sum, n) => sum + n, 0),
    nonzero: Object.fromEntries(Object.entries(calls).filter(([, n]) => n)),
  }) + '\n');
});
