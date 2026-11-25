import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { syncBuiltinESMExports } from "node:module";
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
import { installSideEffectGuard } from "./testkit.mjs";

// CR-2 R3 evidence supplement. The frozen CR-1 testkit captures
// `record.original` at each wrapped position, but its positiveControls only
// exercises a swapped target, so a mutant that directly forwards to the
// captured original and then throws cannot be observed. This independent
// isolation control replaces every actual capture position with a pure
// in-memory countable fake BEFORE the unchanged guard is installed, then
// proves: captured identity, per-slot positive +1 through the wrapper, zero
// growth of the captured originals, exact coverage equality, a cumulative
// baseline that is never cleared, and a precise restore. The fakes start no
// real process, network, listener, DNS lookup, credential read or business
// file operation, and the real originals are never invoked for evidence.

const BLOCKED = "CR1_SYNTHETIC_SIDE_EFFECT_BLOCKED";
const injected = [];   // { object, key, label, category, descriptor, original, fake }
const fakeCounters = Object.create(null);
const positions = [];  // scanned capture positions, untouched until injection

function addPosition(object, key, label, category) {
  if (!object || typeof object[key] !== "function") return false;
  positions.push({
    object, key, label, category,
    descriptor: Object.getOwnPropertyDescriptor(object, key),
    original: object[key],
  });
  return true;
}

function injectPosition(position, fake) {
  fakeCounters[position.label] = 0;
  Object.defineProperty(position.object, position.key, {
    value: fake,
    writable: position.descriptor?.writable ?? true,
    enumerable: position.descriptor?.enumerable ?? false,
    configurable: true,
  });
  injected.push({ ...position, fake });
}

// Phase A: scan the exact capture positions the frozen guard wraps and record
// the true originals/descriptors BEFORE anything is replaced. This mirrors the
// guard's fixed slot selection independently; the coverage-equality test below
// proves the two selections coincide for this tree and runtime.
function scanPositions() {
  for (const key of ["request", "get", "createServer"]) {
    addPosition(http, key, `http.${key}`, "network");
    addPosition(https, key, `https.${key}`, "network");
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
  ]) addPosition(object, key, label, "network");

  for (const [object, prefix] of [[dns, "dns"], [dnsPromises, "dns.promises"]]) {
    for (const key of Object.getOwnPropertyNames(object)) {
      if (/^(lookup|lookupService|resolve.*|reverse)$/.test(key)) addPosition(object, key, `${prefix}.${key}`, "network");
    }
    if (typeof object.Resolver === "function") addPosition(object, "Resolver", `${prefix}.Resolver.constructor`, "network");
  }

  for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    addPosition(childProcess, key, `child_process.${key}`, "process");
  }
  addPosition(childProcess.ChildProcess.prototype, "spawn", "child_process.ChildProcess.spawn", "process");

  for (const key of Object.getOwnPropertyNames(fs)) {
    if (typeof fs[key] === "function") addPosition(fs, key, `fs.${key}`, "file");
  }
  for (const key of Object.getOwnPropertyNames(fsPromises)) {
    if (typeof fsPromises[key] === "function") addPosition(fsPromises, key, `fs.promises.${key}`, "file");
  }
}

// Phase B: inject pure in-memory countable fakes. Each fake only increments
// its own counter and never starts a real process, network, listener, DNS
// lookup, credential read or business file operation.
function injectFakes() {
  for (const position of positions) {
    if (position.key === "Resolver" && (position.object === dns || position.object === dnsPromises)) continue;
    const label = position.label;
    const fake = function safeSyntheticOriginalTarget() {
      fakeCounters[label] += 1;
      return undefined;
    };
    injectPosition(position, fake);
  }
  // Resolver constructors: the guard walks the CONSTRUCTOR's prototype chain
  // to wrap the resolver methods. The real chains of dns.Resolver and
  // dnsPromises.Resolver share one deeper prototype (ResolverBase), which the
  // guard folds into aliases; we mirror that structure with counting fakes:
  // a shared synthetic base object plus per-constructor depth-0 prototypes.
  // The real Resolver prototypes are never touched.
  const sharedResolverBase = {};
  const sharedBaseLabels = new Set();
  function collectResolverChain(RealResolver) {
    const depth0 = [];
    const deeper = [];
    let depth = 0;
    const seen = new Set();
    for (let prototype = RealResolver.prototype; prototype && prototype !== Object.prototype;
      prototype = Object.getPrototypeOf(prototype)) {
      for (const key of Object.getOwnPropertyNames(prototype)) {
        if (!seen.has(key) && /^(resolve.*|reverse|cancel|setServers|setLocalAddress)$/.test(key)) {
          seen.add(key);
          (depth === 0 ? depth0 : deeper).push(key);
        }
      }
      depth += 1;
    }
    return { depth0, deeper };
  }
  for (const [object, prefix] of [[dns, "dns"], [dnsPromises, "dns.promises"]]) {
    const position = positions.find((entry) => entry.object === object && entry.key === "Resolver");
    if (!position) continue;
    const { depth0, deeper } = collectResolverChain(position.original);
    for (const key of deeper) {
      if (sharedBaseLabels.has(key)) continue;
      sharedBaseLabels.add(key);
      const label = `${prefix}.Resolver.${key}`;
      fakeCounters[label] = 0;
      const methodFake = function safeSyntheticResolverMethod() {
        fakeCounters[label] += 1;
        return undefined;
      };
      Object.defineProperty(sharedResolverBase, key, {
        value: methodFake, writable: true, enumerable: true, configurable: true,
      });
      injected.push({
        object: sharedResolverBase, key, label, category: "network",
        descriptor: { value: methodFake, writable: true, enumerable: true, configurable: true },
        original: methodFake, fake: methodFake,
      });
    }
    const syntheticPrototype = Object.create(sharedResolverBase);
    for (const key of depth0) {
      const label = `${prefix}.Resolver.${key}`;
      fakeCounters[label] = 0;
      const methodFake = function safeSyntheticResolverMethod() {
        fakeCounters[label] += 1;
        return undefined;
      };
      Object.defineProperty(syntheticPrototype, key, {
        value: methodFake, writable: true, enumerable: true, configurable: true,
      });
      injected.push({
        object: syntheticPrototype, key, label, category: "network",
        descriptor: { value: methodFake, writable: true, enumerable: true, configurable: true },
        original: methodFake, fake: methodFake,
      });
    }
    fakeCounters[position.label] = 0;
    const fake = function safeSyntheticResolverConstructor() {
      fakeCounters[position.label] += 1;
      return undefined;
    };
    fake.prototype = syntheticPrototype;
    Object.defineProperty(object, "Resolver", {
      value: fake,
      writable: position.descriptor?.writable ?? true,
      enumerable: position.descriptor?.enumerable ?? false,
      configurable: true,
    });
    injected.push({ ...position, fake });
  }
  // Propagate the injected fakes into the ESM namespace bindings BEFORE the
  // guard is installed, so the guard's own named-binding capture and restore
  // assertions observe the synthetic originals (and our own restore re-syncs
  // the real functions afterwards).
  syncBuiltinESMExports();
}

describe("CR-2 guard isolation: countable synthetic originals at the real capture positions", { concurrency: false }, () => {
  let guard;
  let baseline;
  let positiveCount;
  let fileCount;

  before(async () => {
    // Inject the countable fakes at the actual capture positions BEFORE the
    // unchanged guard is installed, so the guard captures OUR fakes as
    // record.original. This window covers only this suite: it starts after
    // every earlier suite finished and is fully restored in after().
    scanPositions();
    injectFakes();
    guard = installSideEffectGuard();
    guard.assertLoadTimeClean();
    positiveCount = guard.positiveControls();
    fileCount = guard.installRuntimeFileGuard();
    baseline = guard.snapshot();
  });

  after(() => {
    if (!guard) {
      // Defensive: never leak the fakes past this suite, even if before()
      // failed between injection and guard installation.
      restoreRealBuiltins();
      return;
    }
    // Strong restore guarantee (R3-RESTORE): every failure path still attempts
    // the full real-builtin restore; each phase error is collected so one
    // failing check never skips the remaining slots or the ESM re-sync, and
    // every collected failure stays visible (re-thrown, never turned into PASS).
    const failures = [];
    try {
      // Every slot received exactly one extra +1 from the per-slot positive
      // control below; the cumulative baseline is preserved, never cleared.
      const expectedFinal = Object.fromEntries(Object.entries(baseline).map(([key, value]) => [key, value + 1]));
      guard.assertNoViolations(expectedFinal, "isolation suite cumulative window");
    } catch (error) {
      failures.push(error);
    }
    try {
      guard.restore();
    } catch (error) {
      failures.push(error);
    }
    try {
      // The guard restored the captured synthetic originals (our fakes)...
      for (const entry of injected) {
        assert.equal(entry.object[entry.key], entry.fake, `restored captured identity: ${entry.label}`);
        assert.equal(fakeCounters[entry.label], 0, `captured original never forwarded: ${entry.label}`);
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      // ...and the real builtins are restored byte-precisely in reverse order,
      // attempting every slot even when an earlier one fails.
      restoreRealBuiltins();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "guard-isolation after() failures; every slot restore was still attempted");
  });

  function restoreRealBuiltins() {
    const failures = [];
    for (const entry of [...injected].reverse()) {
      try {
        if (entry.descriptor) Object.defineProperty(entry.object, entry.key, entry.descriptor);
        else delete entry.object[entry.key];
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      syncBuiltinESMExports();
    } catch (error) {
      failures.push(error);
    }
    for (const entry of injected) {
      try {
        assert.equal(entry.object[entry.key], entry.original, `real builtin restored: ${entry.label}`);
      } catch (error) {
        failures.push(error);
      }
    }
    const bindingChecks = [
      () => assert.equal(httpNamed.request, http.request, "http ESM binding re-synced to the real function"),
      () => assert.equal(httpsNamed.get, https.get, "https ESM binding re-synced to the real function"),
      () => assert.equal(netNamed.connect, net.connect, "net ESM binding re-synced to the real function"),
      () => assert.equal(tlsNamed.connect, tls.connect, "tls ESM binding re-synced to the real function"),
      () => assert.equal(dgramNamed.createSocket, dgram.createSocket, "dgram ESM binding re-synced to the real function"),
      () => assert.equal(dnsNamed.resolve4, dns.resolve4, "dns ESM binding re-synced to the real function"),
      () => assert.equal(dnsPromisesNamed.resolve4, dnsPromises.resolve4, "dns.promises ESM binding re-synced to the real function"),
      () => assert.equal(childNamed.spawn, childProcess.spawn, "child_process ESM binding re-synced to the real function"),
      () => assert.equal(fsNamed.realpathSync, fs.realpathSync, "fs ESM binding re-synced to the real function"),
      () => assert.equal(fsPromisesNamed.readFile, fsPromises.readFile, "fs.promises ESM binding re-synced to the real function"),
    ];
    for (const check of bindingChecks) {
      try { check(); } catch (error) { failures.push(error); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "guard-isolation real-builtin restore failures");
  }

  test("coverage set exact equality: the guard wrapped exactly our injected capture positions", (t) => {
    const labels = [...guard.labels()].sort();
    const injectedLabels = injected.map((entry) => entry.label).sort();
    assert.deepEqual(labels, injectedLabels, "wrapped slot set equals the injected capture set");
    assert.equal(guard.counts().total, injected.length, "total slot count equals injected count");
    assert.equal(guard.counts().network, injected.filter((entry) => entry.category === "network").length);
    assert.equal(guard.counts().process, injected.filter((entry) => entry.category === "process").length);
    assert.equal(guard.counts().file, injected.filter((entry) => entry.category === "file").length);
    assert.equal(positiveCount, injected.filter((entry) => entry.category !== "file").length,
      "the guard's own no-forward controls covered every network/process slot");
    assert.equal(fileCount, injected.filter((entry) => entry.category === "file").length,
      "the runtime file guard covered every fs slot");
    t.diagnostic(JSON.stringify({ counts: guard.counts(), labels: guard.labels(), totalInjected: injected.length }));
  });

  test("per-slot positive control +1 with zero growth of the captured synthetic original", () => {
    for (const entry of injected) {
      const before = guard.snapshot()[entry.label];
      const fakeBefore = fakeCounters[entry.label];
      assert.throws(() => Reflect.apply(entry.object[entry.key], entry.object, []),
        { code: BLOCKED }, `wrapper blocks: ${entry.label}`);
      assert.equal(guard.snapshot()[entry.label], before + 1, `real counter delta +1: ${entry.label}`);
      assert.equal(fakeCounters[entry.label], fakeBefore, `captured original zero growth: ${entry.label}`);
    }
  });

  test("captured identity: the wrapper is live at every position and never is our fake or the real builtin", () => {
    for (const entry of injected) {
      const current = entry.object[entry.key];
      assert.equal(typeof current, "function", `${entry.label} is callable while guarded`);
      assert.notEqual(current, entry.fake, `${entry.label} is not the synthetic original while guarded`);
      assert.notEqual(current, entry.original, `${entry.label} is not the real builtin while guarded`);
    }
  });

  test("cumulative load baseline is preserved and never cleared", () => {
    const load = guard.loadTimeSnapshot();
    assert.ok(Object.keys(load).length > 0);
    assert.ok(Object.values(load).every((count) => count === 0), "load-window counts remain zero");
    for (const [label, count] of Object.entries(baseline)) {
      assert.ok(count >= 1, `cumulative baseline retained: ${label}`);
    }
  });
});
