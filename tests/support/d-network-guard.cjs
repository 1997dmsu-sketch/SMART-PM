/**
 * D 路合成测试专用网络守卫（预载模块，CJS）。
 *
 * 用法：node --require <abs>/tests/support/d-network-guard.cjs --test <测试文件...>
 *
 * 职责：在业务模块加载之前替换 Node 全部可用网络入口（net/tls/http/https/dns
 * + fetch/WebSocket 全局），被调用时只计数并抛错，绝不转发到真实目标。
 * 命名绑定挂在 globalThis.__DSH_D_NETWORK_GUARD__，提供 selfTest() 证明
 * 「拦截生效 + forwarded 恒为 0」，供测试与子进程（经 --require 继承）断言。
 *
 * 边界（诚实声明）：本守卫只覆盖已列出入口，不覆盖系统级网络方式（如
 * 原生 addon、其他进程）；它是本次合成套件的测试隔离手段，不是产品安全验收。
 */
'use strict';

const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');

if (globalThis.__DSH_D_NETWORK_GUARD__) {
  // 已由外层安装（例如测试子进程继承 --require 时重复加载），保持首个实例。
  module.exports = globalThis.__DSH_D_NETWORK_GUARD__;
} else {
  const counters = { blocked: 0, forwarded: 0 };
  const patched = [];

  function blocked(name, target) {
    counters.blocked += 1;
    const detail = target && typeof target === 'object'
      ? JSON.stringify({ host: target.host, hostname: target.hostname, port: target.port, path: target.path })
      : '';
    const error = new Error(`[d-network-guard] ${name} 被拦截（不转发）：${detail}`);
    error.code = 'D_NETWORK_GUARD_BLOCKED';
    throw error;
  }

  function patch(obj, name) {
    if (!obj || typeof obj[name] !== 'function') return false;
    obj[name] = function guardBlocked(...args) {
      counters.blocked += 1;
      const first = args.find((arg) => arg && typeof arg === 'object');
      const detail = first ? JSON.stringify({ host: first.host, hostname: first.hostname, port: first.port, path: first.path, href: first.href }) : '';
      const error = new Error(`[d-network-guard] ${name} 被拦截（不转发）：${detail}`);
      error.code = 'D_NETWORK_GUARD_BLOCKED';
      throw error;
    };
    patched.push(name);
    return true;
  }

  patch(net.Socket.prototype, 'connect');
  patch(net, 'connect');
  patch(net, 'createConnection');
  patch(tls, 'connect');
  patch(http, 'request');
  patch(http, 'get');
  patch(https, 'request');
  patch(https, 'get');
  patch(dns, 'lookup');
  for (const name of ['resolve', 'resolve4', 'resolve6', 'resolveCname', 'resolveMx', 'resolveTxt', 'resolveSrv', 'resolveNaptr', 'resolvePtr', 'resolveNs', 'resolveSoa', 'lookupService']) {
    patch(dns, name);
  }
  if (dns.promises) {
    patch(dns.promises, 'lookup');
    for (const name of ['resolve', 'resolve4', 'resolve6', 'resolveCname', 'resolveMx', 'resolveTxt', 'resolveSrv', 'resolveNaptr', 'resolvePtr', 'resolveNs', 'resolveSoa']) {
      patch(dns.promises, name);
    }
  }
  if (typeof globalThis.fetch === 'function') {
    globalThis.fetch = function guardBlockedFetch() {
      counters.blocked += 1;
      const error = new Error('[d-network-guard] fetch 被拦截（不转发）');
      error.code = 'D_NETWORK_GUARD_BLOCKED';
      throw error;
    };
    patched.push('fetch');
  }
  if (typeof globalThis.WebSocket === 'function') {
    globalThis.WebSocket = function guardBlockedWebSocket() {
      counters.blocked += 1;
      const error = new Error('[d-network-guard] WebSocket 被拦截（不转发）');
      error.code = 'D_NETWORK_GUARD_BLOCKED';
      throw error;
    };
    patched.push('WebSocket');
  }

  function selfTest() {
    const attempts = [
      ['net.connect', () => net.connect(80, '10.255.255.254.invalid')],
      ['net.createConnection', () => net.createConnection({ host: '10.255.255.254.invalid', port: 443 })],
      ['http.get', () => http.get('http://10.255.255.254.invalid/')],
      ['https.request', () => https.request({ host: '10.255.255.254.invalid', port: 443, path: '/', method: 'GET' })],
      ['dns.lookup', () => dns.lookup('probe.invalid')],
      ['dns.resolve4', () => dns.resolve4('probe.invalid')],
    ];
    if (typeof globalThis.fetch === 'function' && patched.includes('fetch')) {
      attempts.push(['fetch', () => globalThis.fetch('https://probe.invalid/')]);
    }
    const before = counters.blocked;
    let caught = 0;
    for (const [name, run] of attempts) {
      try { run(); }
      catch (error) { if (error && error.code === 'D_NETWORK_GUARD_BLOCKED') caught += 1; }
    }
    const ok = caught === attempts.length && counters.forwarded === 0;
    return { ok, attempts: attempts.length, caught, blockedDelta: counters.blocked - before, forwarded: counters.forwarded };
  }

  const state = Object.freeze({
    name: 'd-network-guard',
    version: 1,
    patchedEntries: Object.freeze([...patched]),
    patchedCount: patched.length,
    counters,
    installedAt: new Date().toISOString(),
    selfTest,
  });
  globalThis.__DSH_D_NETWORK_GUARD__ = state;
  module.exports = state;
}
