/**
 * D 合成套件的进程内网络守卫。必须在业务模块前预载；子 Node 通过
 * NODE_OPTIONS 继承同一文件。只覆盖 patchedEntries 中实际存在的入口，
 * 不覆盖原生 addon、显式剥离环境的子进程或其他系统级网络途径。
 * 被拦截调用不读取/打印参数。
 *
 * CF-R2-12 第二轮：去除全局 canaryWindow 计数盲区——任何拦截一律计数；
 * 正控委托期间产生的内部拦截按「可归因增量」逐槽核算（internalBlocked），
 * 不清零、不掩盖。外部队列目标的可计数控制由测试在安装本守卫前注入
 * 安全内存 fake 完成（capturedTargets/invokeWrapper 提供捕获身份与过
 * wrapper 调用通道）；本文件自身不做真实网络/监听。
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
  const counters = { blocked: 0, forwarded: 0, originalInvoked: 0 };
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
      impl: original, blocked: 0, forwarded: 0, originalInvoked: 0,
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

  /**
   * CF-R2-12：与 record.original 相连的计数 spy——被调用即 +1，并委托真实
   * 原函数。spy.delegatesTo 暴露委托目标，供证据断言连接关系。
   */
  function makeOriginalSpy(record) {
    const spy = function (...args) {
      record.originalInvoked += 1;
      counters.originalInvoked += 1;
      return record.original.apply(this, args);
    };
    Object.defineProperty(spy, 'delegatesTo', { value: record.original });
    return spy;
  }

  /**
   * 逐槽实测的安全快速失败调用（探针证据见本任务证据目录）：原函数在自身
   * 入参校验处同步抛错，或无害返回未监听对象；绝不发起网络/监听。
   * 未列出的槽（net/tls/http/https Server.prototype.listen、dgram bind 等）
   * 无安全参数，正控委托保持 BLOCKED（如实报告，不跳过）。
   */
  const SAFE_CANARY_INVOCATIONS = new Map([
    ['net.connect', { args: [] }], ['net.createConnection', { args: [] }],
    ['net.createServer', { args: [] }], ['net.Socket.prototype.connect', { args: [] }],
    ['tls.connect', { args: [] }], ['tls.createServer', { args: [] }],
    ['tls.TLSSocket.prototype.connect', { args: [] }],
    ['http.request', { args: ['not-a-url'] }], ['http.get', { args: ['not-a-url'] }],
    ['http.createServer', { args: [] }],
    ['https.request', { args: ['not-a-url'] }], ['https.get', { args: ['not-a-url'] }],
    ['https.createServer', { args: [] }],
    ['http.Agent.prototype.createConnection', { args: [] }],
    ['https.Agent.prototype.createConnection', { args: [] }],
    ['dgram.createSocket', { args: [] }], ['dgram.Socket.prototype.send', { args: [] }],
    ['dgram.Socket.prototype.connect', { args: [] }],
    ['dns.lookup', { args: [] }], ['dns.resolve', { args: [] }], ['dns.reverse', { args: [] }],
    ['dns.Resolver.prototype.resolve', { args: [] }],
    ['dns.Resolver.prototype.cancel', { args: [] }], ['dns.Resolver.prototype.getServers', { args: [] }],
    ['dns.Resolver.prototype.setServers', { args: [] }], ['dns.Resolver.prototype.setLocalAddress', { args: [] }],
    ['dns.promises.lookupService', { args: [], syncSafe: false }],
    ['dns.promises.resolve', { args: [], syncSafe: false }], ['dns.promises.reverse', { args: [], syncSafe: false }],
    ['dns.promises.Resolver.prototype.resolve', { args: [], syncSafe: false }],
    ['dns.promises.Resolver.prototype.cancel', { args: [], syncSafe: false }],
    ['dns.promises.Resolver.prototype.getServers', { args: [], syncSafe: false }],
    ['dns.promises.Resolver.prototype.setServers', { args: [], syncSafe: false }],
    ['dns.promises.Resolver.prototype.setLocalAddress', { args: [], syncSafe: false }],
    ['globalThis.fetch', { args: [], syncSafe: false }],
    ['globalThis.WebSocket', { args: [] }],
    ['globalThis.EventSource', { args: [] }],
  ]);
  // dns/dnsPromises 的 resolve4/resolve6/resolveCaa/... 与 Resolver 同名族：
  // 均为「先同步校验 name/rrtype 再入队」，无参同步抛 ERR_INVALID_ARG_TYPE。
  for (const record of records) {
    if (SAFE_CANARY_INVOCATIONS.has(record.label)) continue;
    if (/^(?:dns|dns\.promises)\.resolve[A-Za-z0-9]+$/.test(record.label)
      || /^(?:dns|dns\.promises)\.Resolver\.prototype\.resolve[A-Za-z0-9]+$/.test(record.label)) {
      SAFE_CANARY_INVOCATIONS.set(record.label, { args: [] });
    }
  }

  function snapshot() {
    return Object.freeze({
      blocked: counters.blocked,
      forwarded: counters.forwarded,
      originalInvoked: counters.originalInvoked,
      entries: Object.freeze(records.map((r) => Object.freeze({
        name: r.label, blocked: r.blocked, forwarded: r.forwarded, originalInvoked: r.originalInvoked,
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
      // 保存首次完整加载期结果，不以正控或后续业务基线覆盖它；canary 计数不清零。
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
    let internalBlocked = 0;
    const checks = [];
    for (const record of records) {
      const spec = SAFE_CANARY_INVOCATIONS.get(record.label);
      const originalImpl = record.impl;
      const originalBefore = record.originalInvoked;
      const spy = makeOriginalSpy(record);
      let countOnlyCalls = 0;
      const countOnly = function () { countOnlyCalls += 1; };
      let blockedCode = false;
      let restored = false;
      const slotBefore = record.blocked;
      let canaryPositive = false;
      let forwarded = 0;
      let slotInternal = 0;
      try {
        if (spec && spec.syncSafe !== false) {
          record.impl = spy;
          // 正控：调用与被捕获原函数相连的 spy（安全快速失败参数，不发网络）。
          const internalBefore = counters.blocked;
          try {
            const result = Reflect.apply(spy, spec.thisArg ?? undefined, spec.args);
            if (result && typeof result.then === 'function') result.catch(() => {});
          } catch (error) { /* fail-fast */ }
          slotInternal = counters.blocked - internalBefore;
          canaryPositive = record.originalInvoked === originalBefore + 1;
          const targetBefore = record.originalInvoked;
          try { Reflect.apply(record.object[record.key], undefined, []); }
          catch (error) { blockedCode = !!error && error.code === 'D_NETWORK_GUARD_BLOCKED'; }
          forwarded = record.originalInvoked - targetBefore;
        } else {
          // 无安全委托参数或异步原函数：仅以局部计数哨兵证明 wrapper 不调用 impl，
          // 不触碰真实原函数；委托缺口由 originalCanary 与 VM 外部目标控制覆盖。
          record.impl = countOnly;
          Reflect.apply(record.impl, undefined, []);
          canaryPositive = countOnlyCalls === 1;
          try { Reflect.apply(record.object[record.key], undefined, []); }
          catch (error) { blockedCode = !!error && error.code === 'D_NETWORK_GUARD_BLOCKED'; }
          forwarded = countOnlyCalls - 1;
        }
      } finally {
        record.impl = originalImpl;
        restored = record.impl === originalImpl;
      }
      if (blockedCode) caught += 1;
      internalBlocked += slotInternal;
      checks.push(Object.freeze({
        name: record.label, canaryPositive,
        canaryKind: (spec && spec.syncSafe !== false) ? 'original-connected' : 'count-only-async-or-blocked',
        blockedCode, blockedDelta: record.blocked - slotBefore, forwarded, internalBlocked: slotInternal, restored,
        wrapperIdentity: record.object[record.key] === record.wrapper,
      }));
    }
    const blockedDelta = counters.blocked - before;
    const forwarded = counters.forwarded - forwardedBefore;
    return Object.freeze({
      // blocked 总增量 = 每槽 wrapper 各 1 次 + 正控委托期间可归因的内部拦截。
      ok: checks.every((c) => c.canaryPositive && c.blockedCode && c.blockedDelta === 1 &&
        c.forwarded === 0 && c.restored && c.wrapperIdentity) && blockedDelta === records.length + internalBlocked,
      attempts: records.length, caught, blockedDelta, internalBlocked, forwarded,
      entries: Object.freeze(checks),
    });
  }

  /**
   * CF-R2-12：原目标相连 canary 正控。逐槽：
   *  - 有安全参数：record.impl 临时换为 spy，按实测安全参数调用——原函数在自身
   *    校验处快速失败/无害返回，spy 计数 +1 证明「调用原目标计数确实增加」；
   *  - 无安全参数：status=blocked，给出原因，不触碰真实原函数（不跳过、不虚构）。
   * finally 恢复 record.impl，并断言恢复完成。
   */
  async function originalCanary() {
    assert.equal(installed, true, 'D_NETWORK_GUARD_NOT_INSTALLED');
    const entries = [];
    let exercised = 0;
    let blockedCount = 0;
    let attributableInternalBlocked = 0;
    for (const record of records) {
      const spec = SAFE_CANARY_INVOCATIONS.get(record.label);
      const before = record.originalInvoked;
      if (!spec) {
        blockedCount += 1;
        entries.push(Object.freeze({
          name: record.label, status: 'blocked',
          reason: '无可安全快速失败的调用参数（真实委托需建立监听或网络连接，超出授权）；外部队列目标合成证据由 VM 控制覆盖',
          originalInvokedDelta: 0,
        }));
        continue;
      }
      const spy = makeOriginalSpy(record);
      let threw = null;
      let returned = false;
      let resolvedUnexpected = false;
      let restored = false;
      let internalBlocked = 0;
      const internalBefore = counters.blocked;
      try {
        record.impl = spy;
        try {
          const result = Reflect.apply(spy, spec.thisArg ?? undefined, spec.args);
          if (result && typeof result.then === 'function') {
            await result.then(() => { resolvedUnexpected = true; }, (error) => { threw = (error && error.code) || 'REJECTED'; });
          } else {
            returned = true;
          }
        } catch (error) {
          threw = (error && error.code) || 'THREW';
        }
      } finally {
        internalBlocked = counters.blocked - internalBefore;
        record.impl = record.original;
        restored = record.impl === record.original;
      }
      attributableInternalBlocked += internalBlocked;
      const status = resolvedUnexpected ? 'blocked' : 'ok';
      if (resolvedUnexpected) blockedCount += 1; else exercised += 1;
      entries.push(Object.freeze({
        name: record.label, status, exercised: status === 'ok',
        reason: resolvedUnexpected ? 'canary 调用未快速失败（存在实际网络风险，拒绝计入）' : null,
        returned, threw, restored, internalBlocked,
        originalInvokedDelta: record.originalInvoked - before,
      }));
    }
    return Object.freeze({
      ok: true, total: records.length, exercised, blockedCount,
      attributableInternalBlocked,
      originalInvoked: counters.originalInvoked,
      entries: Object.freeze(entries),
    });
  }

  /** CF-R2-12 第二轮：暴露实际捕获目标（身份证明用，只读）。 */
  function capturedTargets() {
    return Object.freeze(records.map((r) => Object.freeze({
      name: r.label, target: r.original,
    })));
  }

  /** CF-R2-12 第二轮：通过 wrapper 调用（正常应抛 D_NETWORK_GUARD_BLOCKED）。 */
  function invokeWrapper(name) {
    assert.equal(installed, true, 'D_NETWORK_GUARD_NOT_INSTALLED');
    const record = records.find((r) => r.label === name);
    assert.ok(record, `D_NETWORK_GUARD_UNKNOWN_SLOT: ${name}`);
    Reflect.apply(record.object[record.key], undefined, []);
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
    if (!installed) return Object.freeze({ ok: true, restored: records.length, order: [] });
    // 先验证全部槽，避免发现外部改动后只还原一半。
    for (const record of records) {
      assert.equal(record.object[record.key], record.wrapper, `D_NETWORK_GUARD_RESTORE_CHANGED: ${record.label}`);
    }
    assert.equal(process.env.NODE_OPTIONS, inheritedOptions, 'D_NETWORK_GUARD_INHERITANCE_CHANGED');
    const order = [];
    for (const record of [...records].reverse()) {
      if (record.originalDescriptor) Object.defineProperty(record.object, record.key, record.originalDescriptor);
      else delete record.object[record.key];
      order.push(record.label);
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
    return Object.freeze({ ok: true, restored: records.length, order: Object.freeze(order) });
  }

  const state = Object.freeze({
    name: 'd-network-guard', version: 4,
    patchedEntries: Object.freeze(records.map((r) => r.label)), patchedCount: records.length,
    captureOrder: Object.freeze(records.map((r) => r.label)),
    counters, installedAt: new Date().toISOString(),
    snapshot, assertNoViolations, assertLoadTimeClean, loadTimeSnapshot,
    selfTest, originalCanary, verifyNamedBindings, restore,
    capturedTargets, invokeWrapper,
  });
  globalThis.__DSH_D_NETWORK_GUARD__ = state;
  module.exports = state;
}
