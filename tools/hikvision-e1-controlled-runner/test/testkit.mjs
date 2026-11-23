import assert from "node:assert/strict";
import { syncBuiltinESMExports } from "node:module";
import { types } from "node:util";
import http, * as httpNamed from "node:http";
import https, * as httpsNamed from "node:https";
import net, * as netNamed from "node:net";
import tls, * as tlsNamed from "node:tls";
import dgram, * as dgramNamed from "node:dgram";
import dns, * as dnsNamed from "node:dns";
import dnsPromises, * as dnsPromisesNamed from "node:dns/promises";
import childProcess, * as childNamed from "node:child_process";
import fs, * as fsNamed from "node:fs";
import fsPromises, * as fsPromisesNamed from "node:fs/promises";

// This is test-only infrastructure. All controls throw before forwarding, so a
// positive control cannot create a socket, listener, file, or child process.
const BLOCKED = "CR1_SYNTHETIC_SIDE_EFFECT_BLOCKED";
let activeGuard = false;

/** Install before importing business modules. Never install nested guards. */
export function installSideEffectGuard() {
  assert.equal(activeGuard, false, "a CR-1 guard is already active");
  activeGuard = true;
  const records = [];
  const slots = new WeakMap();
  let restored = false;
  let runtimeFilesInstalled = false;
  let loadTime = null;
  const namespaces = [
    [http, httpNamed], [https, httpsNamed], [net, netNamed], [tls, tlsNamed],
    [dgram, dgramNamed], [dns, dnsNamed], [dnsPromises, dnsPromisesNamed],
    [childProcess, childNamed], [fs, fsNamed], [fsPromises, fsPromisesNamed],
  ];
  const namedBefore = namespaces.flatMap(([object, namespace]) =>
    Object.keys(namespace)
      .filter((key) => key !== "default" && typeof object[key] === "function")
      .map((key) => ({ object, namespace, key, value: namespace[key] })));

  function assertActive() {
    assert.equal(restored, false, "CR-1 guard has been restored");
  }

  function wrap(object, key, label, kind = "network") {
    if (!object || typeof object[key] !== "function") return;
    const keys = slots.get(object) || new Set();
    if (keys.has(key)) {
      const previous = records.find((entry) => entry.object === object && entry.key === key);
      assert.ok(previous, `known shared guard slot: ${label}`);
      previous.aliases.push(label);
      return;
    }
    keys.add(key);
    slots.set(object, keys);
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    const inherited = records.find((entry) => entry.stub === object[key]);
    const original = inherited ? inherited.original : object[key];
    const record = {
      object, key, label, kind, aliases: [label], descriptor, original,
      target: original, calls: 0, targetCalls: 0,
    };
    // target is the wrapped call target, not an unrelated dummy. Normal guard
    // calls never invoke it. Controls temporarily replace this exact target
    // with a no-op and restore the original reference in finally, so an unsafe
    // forwarding mutant can be detected without calling the system function.
    record.stub = function noForwardSideEffect(...args) {
      record.calls += 1;
      const error = new Error(BLOCKED);
      error.code = BLOCKED;
      throw error;
    };
    Object.defineProperty(object, key, {
      value: record.stub,
      writable: descriptor?.writable ?? true,
      enumerable: descriptor?.enumerable ?? false,
      configurable: descriptor?.configurable ?? true,
    });
    records.push(record);
  }

  function sync() {
    syncBuiltinESMExports();
  }

  function snapshot() {
    assertActive();
    return Object.freeze(Object.fromEntries(records.map((record) => [record.label, record.calls])));
  }

  function assertNoViolations(before, label = "guarded business window") {
    assert.deepEqual(snapshot(), before, `${label}: no guarded side effects`);
  }

  function positiveControls(selected = records) {
    assertActive();
    for (const record of selected) {
      const targetBefore = record.target;
      const canary = function safeWrappedTargetCanary() {
        record.targetCalls += 1;
        return undefined;
      };
      record.target = canary;
      try {
        const canaryBefore = record.targetCalls;
        Reflect.apply(record.target, record.object, []);
        assert.equal(record.targetCalls, canaryBefore + 1, `callable target delta: ${record.label}`);
        const canaryBaseline = record.targetCalls;
        const before = record.calls;
        assert.throws(() => Reflect.apply(record.object[record.key], record.object, []),
          { code: BLOCKED }, `no-forward control: ${record.label}`);
        assert.equal(record.calls, before + 1, `real counter delta: ${record.label}`);
        assert.equal(record.target, canary, `controlled target identity: ${record.label}`);
        assert.equal(record.targetCalls, canaryBaseline, `no forwarded target call: ${record.label}`);
      } finally {
        record.target = targetBefore;
        assert.equal(record.target, targetBefore, `restored call target: ${record.label}`);
      }
    }
    for (const item of namedBefore) {
      const record = records.find((entry) => entry.object === item.object && entry.key === item.key);
      if (record) assert.equal(item.namespace[item.key], record.stub, `ESM sync: ${record.label}`);
    }
    return selected.length;
  }

  function assertLoadTimeClean() {
    assertActive();
    assert.equal(loadTime, null, "load-time window is captured once before controls");
    assert.equal(runtimeFilesInstalled, false, "module loading precedes runtime file guard");
    const captured = snapshot();
    for (const [label, count] of Object.entries(captured)) {
      assert.equal(count, 0, `module-load side effects: ${label}`);
    }
    loadTime = captured;
    return loadTime;
  }

  function loadTimeSnapshot() {
    assert.ok(loadTime, "load-time window has not been captured");
    return loadTime;
  }

  function installRuntimeFileGuard() {
    assertActive();
    assert.ok(loadTime, "capture loading counts before file guard or positive controls");
    assert.equal(runtimeFilesInstalled, false, "runtime file guard installs once");
    const start = records.length;
    // Block all callable exported fs data/metadata interfaces, including stream
    // constructors, promise APIs, fd writes, mutations, watches and globbing.
    // No FileHandle can be obtained by CR-1: open is blocked before forwarding.
    // Module-loader file reads are intentionally outside this runtime window.
    for (const [object, prefix] of [[fs, "fs"], [fsPromises, "fs.promises"]]) {
      for (const key of Object.getOwnPropertyNames(object)) {
        if (typeof object[key] === "function") wrap(object, key, `${prefix}.${key}`, "file");
      }
    }
    sync();
    runtimeFilesInstalled = true;
    return positiveControls(records.slice(start));
  }

  function restore() {
    assertActive();
    try {
      for (const record of [...records].reverse()) {
        if (record.descriptor) Object.defineProperty(record.object, record.key, record.descriptor);
        else delete record.object[record.key];
      }
      sync();
      for (const record of records) {
        assert.equal(record.object[record.key], record.original, `restored identity: ${record.label}`);
        assert.deepEqual(Object.getOwnPropertyDescriptor(record.object, record.key), record.descriptor,
          `restored descriptor: ${record.label}`);
      }
      for (const item of namedBefore) {
        assert.equal(item.namespace[item.key], item.value, `restored ESM binding: ${item.key}`);
      }
    } finally {
      restored = true;
      activeGuard = false;
    }
  }

  try {
    for (const key of ["request", "get", "createServer"]) {
      wrap(http, key, `http.${key}`);
      wrap(https, key, `https.${key}`);
    }
    for (const [object, key, label] of [
      [globalThis, "fetch", "fetch"],
      [globalThis, "WebSocket", "WebSocket"],
      [globalThis, "EventSource", "EventSource"],
      [net, "connect", "net.connect"],
      [net, "createConnection", "net.createConnection"],
      [net, "createServer", "net.createServer"],
      [net.Socket.prototype, "connect", "net.Socket.connect"],
      [net.Server.prototype, "listen", "net.Server.listen"],
      [http.Server.prototype, "listen", "http.Server.listen"],
      [https.Server.prototype, "listen", "https.Server.listen"],
      [http.Agent.prototype, "createConnection", "http.Agent.createConnection"],
      [https.Agent.prototype, "createConnection", "https.Agent.createConnection"],
      [tls, "connect", "tls.connect"],
      [tls, "createServer", "tls.createServer"],
      [dgram, "createSocket", "dgram.createSocket"],
      [dgram.Socket.prototype, "send", "dgram.Socket.send"],
      [dgram.Socket.prototype, "bind", "dgram.Socket.bind"],
      [dgram.Socket.prototype, "connect", "dgram.Socket.connect"],
    ]) wrap(object, key, label);

    for (const [object, prefix] of [[dns, "dns"], [dnsPromises, "dns.promises"]]) {
      for (const key of Object.getOwnPropertyNames(object)) {
        if (/^(lookup|lookupService|resolve.*|reverse)$/.test(key)) wrap(object, key, `${prefix}.${key}`);
      }
      const Resolver = object.Resolver;
      if (typeof Resolver === "function") {
        const seen = new Set();
        for (let prototype = Resolver.prototype; prototype && prototype !== Object.prototype;
          prototype = Object.getPrototypeOf(prototype)) {
          for (const key of Object.getOwnPropertyNames(prototype)) {
            if (!seen.has(key) && /^(resolve.*|reverse|cancel|setServers|setLocalAddress)$/.test(key)) {
              seen.add(key);
              wrap(prototype, key, `${prefix}.Resolver.${key}`);
            }
          }
        }
        wrap(object, "Resolver", `${prefix}.Resolver.constructor`);
      }
    }
    for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
      wrap(childProcess, key, `child_process.${key}`, "process");
    }
    wrap(childProcess.ChildProcess.prototype, "spawn", "child_process.ChildProcess.spawn", "process");
    sync();
  } catch (error) {
    try { restore(); } catch { /* retain the original installation failure */ }
    throw error;
  }

  return Object.freeze({
    snapshot,
    assertNoViolations,
    assertUnchanged: assertNoViolations,
    positiveControls,
    assertLoadTimeClean,
    loadTimeSnapshot,
    installRuntimeFileGuard,
    restore,
    labels: () => Object.freeze(records.map((record) => record.label)),
    counts: () => Object.freeze({
      total: records.length,
      network: records.filter((record) => record.kind === "network").length,
      process: records.filter((record) => record.kind === "process").length,
      file: records.filter((record) => record.kind === "file").length,
    }),
  });
}

/** Snapshot hostile own properties without evaluating getters or proxy traps. */
export function descriptorSnapshot(input) {
  const seen = new Map();
  function capture(value) {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
      return { primitive: value };
    }
    if (seen.has(value)) return seen.get(value);
    const node = { target: value, proxy: types.isProxy(value), entries: [] };
    seen.set(value, node);
    if (node.proxy) return node;
    node.prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    node.keys = Reflect.ownKeys(descriptors);
    for (const key of node.keys) {
      const descriptor = descriptors[key];
      node.entries.push({
        key,
        descriptor,
        child: Object.hasOwn(descriptor, "value") ? capture(descriptor.value) : null,
      });
    }
    return node;
  }
  return capture(input);
}

/** Compare descriptor snapshots by identity/flags, never by reading properties. */
export function assertDescriptorSnapshotUnchanged(input, before) {
  const visited = new Set();
  function compare(value, node) {
    if (Object.hasOwn(node, "primitive")) {
      assert.equal(value, node.primitive, "primitive input unchanged");
      return;
    }
    assert.equal(value, node.target, "input reference unchanged");
    if (visited.has(node)) return;
    visited.add(node);
    assert.equal(types.isProxy(value), node.proxy, "proxy identity unchanged");
    if (node.proxy) return;
    assert.equal(Object.getPrototypeOf(value), node.prototype, "prototype unchanged");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    assert.deepEqual(Reflect.ownKeys(descriptors), node.keys, "all own keys unchanged");
    for (const entry of node.entries) {
      const descriptor = descriptors[entry.key];
      assert.ok(descriptor, "descriptor still present");
      const keys = Reflect.ownKeys(entry.descriptor);
      assert.deepEqual(Reflect.ownKeys(descriptor), keys, "descriptor kind unchanged");
      for (const key of keys) assert.equal(descriptor[key], entry.descriptor[key], `descriptor ${String(key)} unchanged`);
      if (entry.child) compare(descriptor.value, entry.child);
    }
  }
  compare(input, before);
}
