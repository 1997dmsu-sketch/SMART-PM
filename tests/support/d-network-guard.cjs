/**
 * D 合成套件的进程内网络守卫。必须在业务模块前预载；子 Node 通过
 * NODE_OPTIONS 继承同一文件。只覆盖 patchedEntries 中实际存在的入口，
 * 不覆盖原生 addon、显式剥离环境的子进程或其他系统级网络途径。
 * 被拦截调用不读取/打印参数，所有正控只触及临时 no-op 哨兵。
 */
'use strict';

const assert = require('node:assert/strict');
const { syncBuiltinESMExports } = require('node:module');
const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const https = require('node:https');
const dgram = require('node:dgram');
const dns = require('node:dns');
const dnsPromises = require('node:dns/promises');

if (globalThis.__DSH_D_NETWORK_GUARD__) {
  module.exports = globalThis.__DSH_D_NETWORK_GUARD__;
} else {
  const counters = { blocked: 0, forwarded: 0 };
  const records = [];
  const seen = new WeakMap();
  const wrapperOwners = new WeakMap();
  const namedSlots = [];
  let installed = true;
  let savedLoadTime = null;
  const hadNodeOptions = Object.hasOwn(process.env, 'NODE_OPTIONS');
  const originalNodeOptions = process.env.NODE_OPTIONS;
  const ownRequire = `--require=${JSON.stringify(__filename.replace(/\\/g, '/'))}`;
  const inheritedOptions = originalNodeOptions
    ? `${originalNodeOptions} ${ownRequire}` : ownRequire;

  function patch(object, key, label, specifier) {
    if (!object || typeof object[key] !== 'function') return;
    let keys = seen.get(object);
    if (!keys) { keys = new Map(); seen.set(object, keys); }
    if (keys.has(key)) return;
    const originalDescriptor = Object.getOwnPropertyDescriptor(object, key);
    const current = object[key];
    const original = wrapperOwners.has(current) ? wrapperOwners.get(current).original : current;
    const record = {
      object, key, label, original, originalDescriptor,
      impl: original, blocked: 0, forwarded: 0,
    };
    function guardBlocked(...args) {
      counters.blocked += 1;
      record.blocked += 1;
      // 正控可暂换 record.impl；正常路径绝不调用它，也不读取 args。
      const error = new Error('D_NETWORK_GUARD_BLOCKED');
      error.code = 'D_NETWORK_GUARD_BLOCKED';
      throw error;
    }
    // 保留构造器的原 prototype 路径，其网络方法仍由本守卫逐槽覆盖。
    const prototype = Object.getOwnPropertyDescriptor(original, 'prototype');
    if (prototype && Object.hasOwn(prototype, 'value')) {
      Object.defineProperty(guardBlocked, 'prototype', prototype);
    }
    record.wrapper = guardBlocked;
    wrapperOwners.set(guardBlocked, record);
    Object.defineProperty(object, key, originalDescriptor
      ? { ...originalDescriptor, value: guardBlocked }
      : { value: guardBlocked, writable: true, enumerable: false, configurable: true });
    keys.set(key, record);
    records.push(record);
    if (specifier) namedSlots.push({ record, specifier });
  }

  function moduleEntries(object, names, prefix, specifier) {
    for (const key of names) patch(object, key, `${prefix}.${key}`, specifier);
  }
  function prototypeEntries(ctor, names, prefix) {
    if (!ctor || !ctor.prototype) return;
    for (const key of names) patch(ctor.prototype, key, `${prefix}.prototype.${key}`);
  }
  const originalConstructors = {
    netSocket: net.Socket, netServer: net.Server,
    tlsSocket: tls.TLSSocket, tlsServer: tls.Server,
    httpServer: http.Server, httpsServer: https.Server,
    httpAgent: http.Agent, httpsAgent: https.Agent,
    dgramSocket: dgram.Socket, resolver: dns.Resolver, promiseResolver: dnsPromises.Resolver,
  };
  moduleEntries(net, ['connect', 'createConnection', 'createServer'], 'net', 'node:net');
  prototypeEntries(originalConstructors.netSocket, ['connect'], 'net.Socket');
  prototypeEntries(originalConstructors.netServer, ['listen'], 'net.Server');
  moduleEntries(tls, ['connect', 'createServer'], 'tls', 'node:tls');
  prototypeEntries(originalConstructors.tlsSocket, ['connect'], 'tls.TLSSocket');
  prototypeEntries(originalConstructors.tlsServer, ['listen'], 'tls.Server');
  moduleEntries(http, ['request', 'get', 'createServer'], 'http', 'node:http');
  moduleEntries(https, ['request', 'get', 'createServer'], 'https', 'node:https');
  prototypeEntries(originalConstructors.httpServer, ['listen'], 'http.Server');
  prototypeEntries(originalConstructors.httpsServer, ['listen'], 'https.Server');
  prototypeEntries(originalConstructors.httpAgent, ['createConnection'], 'http.Agent');
  prototypeEntries(originalConstructors.httpsAgent, ['createConnection'], 'https.Agent');
  moduleEntries(dgram, ['createSocket'], 'dgram', 'node:dgram');
  prototypeEntries(originalConstructors.dgramSocket, ['send', 'bind', 'connect'], 'dgram.Socket');

  function dnsNames(object) {
    return Object.getOwnPropertyNames(object).filter((key) =>
      /^(?:lookup|lookupService|resolve[A-Za-z0-9]*|reverse)$/.test(key));
  }
  moduleEntries(dns, dnsNames(dns), 'dns', 'node:dns');
  moduleEntries(dnsPromises, dnsNames(dnsPromises), 'dns.promises', 'node:dns/promises');
  function resolverEntries(ctor, prefix) {
    if (!ctor || !ctor.prototype) return;
    const names = new Set();
    for (let p = ctor.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      for (const key of Object.getOwnPropertyNames(p)) {
        if (/^(?:resolve[A-Za-z0-9]*|reverse|cancel|setServers|setLocalAddress|getServers)$/.test(key)) names.add(key);
      }
    }
    prototypeEntries(ctor, [...names], prefix);
  }
  resolverEntries(originalConstructors.resolver, 'dns.Resolver');
  resolverEntries(originalConstructors.promiseResolver, 'dns.promises.Resolver');
  moduleEntries(dns, ['Resolver'], 'dns', 'node:dns');
  moduleEntries(dnsPromises, ['Resolver'], 'dns.promises', 'node:dns/promises');
  for (const key of ['fetch', 'WebSocket', 'EventSource']) patch(globalThis, key, `globalThis.${key}`);
  syncBuiltinESMExports();
  process.env.NODE_OPTIONS = inheritedOptions;

  function snapshot() {
    return Object.freeze({
      blocked: counters.blocked,
      forwarded: counters.forwarded,
      entries: Object.freeze(records.map((r) => Object.freeze({
        name: r.label, blocked: r.blocked, forwarded: r.forwarded,
      }))),
    });
  }
  const installationSnapshot = snapshot();
  function assertNoViolations(before, label = 'business window') {
    assert.deepEqual(snapshot(), before, `${label}: D_NETWORK_GUARD_VIOLATION`);
    return true;
  }
  function assertLoadTimeClean() {
    if (savedLoadTime === null) {
      savedLoadTime = snapshot();
      assert.deepEqual(savedLoadTime, installationSnapshot, 'D_NETWORK_GUARD_LOAD_TIME_VIOLATION');
    } else {
      // 保存首次完整加载期结果，不以正控或后续业务基线覆盖它。
      assert.deepEqual(savedLoadTime, installationSnapshot, 'D_NETWORK_GUARD_LOAD_TIME_VIOLATION');
    }
    return savedLoadTime;
  }
  function loadTimeSnapshot() { return savedLoadTime; }

  function selfTest() {
    assert.equal(installed, true, 'D_NETWORK_GUARD_NOT_INSTALLED');
    const before = counters.blocked;
    const forwardedBefore = counters.forwarded;
    let caught = 0;
    const checks = [];
    for (const record of records) {
      const originalImpl = record.impl;
      let canaryCalls = 0;
      const safeCanary = function () { canaryCalls += 1; };
      let blockedCode = false;
      let restored = false;
      const slotBefore = record.blocked;
      let canaryPositive = false;
      let forwarded = 0;
      try {
        // 同一个实际 impl 槽：直接正控证明哨兵可计数，再调用真实包裹入口。
        record.impl = safeCanary;
        Reflect.apply(record.impl, undefined, []);
        canaryPositive = canaryCalls === 1;
        const targetBefore = canaryCalls;
        try { Reflect.apply(record.object[record.key], undefined, []); }
        catch (error) { blockedCode = !!error && error.code === 'D_NETWORK_GUARD_BLOCKED'; }
        forwarded = canaryCalls - targetBefore;
        record.forwarded += forwarded;
        counters.forwarded += forwarded;
      } finally {
        record.impl = originalImpl;
        restored = record.impl === originalImpl;
      }
      if (blockedCode) caught += 1;
      checks.push(Object.freeze({
        name: record.label, canaryPositive, blockedCode,
        blockedDelta: record.blocked - slotBefore, forwarded, restored,
        wrapperIdentity: record.object[record.key] === record.wrapper,
      }));
    }
    const blockedDelta = counters.blocked - before;
    const forwarded = counters.forwarded - forwardedBefore;
    return Object.freeze({
      ok: checks.every((c) => c.canaryPositive && c.blockedCode && c.blockedDelta === 1 &&
        c.forwarded === 0 && c.restored && c.wrapperIdentity) && blockedDelta === records.length,
      attempts: records.length, caught, blockedDelta, forwarded,
      entries: Object.freeze(checks),
    });
  }

  async function verifyNamedBindings() {
    const namespaces = new Map();
    for (const { specifier } of namedSlots) {
      if (!namespaces.has(specifier)) namespaces.set(specifier, await import(specifier));
    }
    for (const { record, specifier } of namedSlots) {
      assert.equal(namespaces.get(specifier)[record.key], record.wrapper,
        `D_NETWORK_GUARD_ESM_BINDING: ${record.label}`);
    }
    return Object.freeze({ ok: true, checked: namedSlots.length });
  }

  function restore() {
    if (!installed) return Object.freeze({ ok: true, restored: records.length });
    // 先验证全部槽，避免发现外部改动后只还原一半。
    for (const record of records) {
      assert.equal(record.object[record.key], record.wrapper, `D_NETWORK_GUARD_RESTORE_CHANGED: ${record.label}`);
    }
    assert.equal(process.env.NODE_OPTIONS, inheritedOptions, 'D_NETWORK_GUARD_INHERITANCE_CHANGED');
    for (const record of [...records].reverse()) {
      if (record.originalDescriptor) Object.defineProperty(record.object, record.key, record.originalDescriptor);
      else delete record.object[record.key];
    }
    for (const record of records) {
      assert.equal(record.object[record.key], record.original, `D_NETWORK_GUARD_RESTORE_IDENTITY: ${record.label}`);
      assert.deepEqual(Object.getOwnPropertyDescriptor(record.object, record.key), record.originalDescriptor,
        `D_NETWORK_GUARD_RESTORE_DESCRIPTOR: ${record.label}`);
    }
    if (hadNodeOptions) process.env.NODE_OPTIONS = originalNodeOptions;
    else delete process.env.NODE_OPTIONS;
    syncBuiltinESMExports();
    installed = false;
    return Object.freeze({ ok: true, restored: records.length });
  }

  const state = Object.freeze({
    name: 'd-network-guard', version: 2,
    patchedEntries: Object.freeze(records.map((r) => r.label)), patchedCount: records.length,
    counters, installedAt: new Date().toISOString(),
    snapshot, assertNoViolations, assertLoadTimeClean, loadTimeSnapshot,
    selfTest, verifyNamedBindings, restore,
  });
  globalThis.__DSH_D_NETWORK_GUARD__ = state;
  module.exports = state;
}
