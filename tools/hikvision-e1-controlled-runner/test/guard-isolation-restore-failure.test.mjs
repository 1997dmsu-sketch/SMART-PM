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

// R3-RESTORE failure-injection regressions. Three deliberate failure modes
// prove that the isolation suite's after() strong guarantee still restores
// every real builtin, descriptor and ESM binding even when the cumulative
// assertion, guard.restore() or the identity/counter verification throws. The
// injected failures stay visible (non-zero exit with the original reasons)
// while the final verifier suite below confirms the real restoration. Only
// pure in-memory fakes are used; no real network/process/listen/DNS/credential
// or business file is ever invoked for evidence.

const BLOCKED = "CR1_SYNTHETIC_SIDE_EFFECT_BLOCKED";
const TAMPERED_LABEL = "http.request";
const allHarnesses = [];

function createHarness() {
  const positions = [];
  const injected = [];
  const fakeCounters = Object.create(null);

  function addPosition(object, key, label, category) {
    if (!object || typeof object[key] !== "function") return false;
    positions.push({
      object, key, label, category,
      descriptor: Object.getOwnPropertyDescriptor(object, key),
      original: object[key],
    });
    return true;
  }

  function scan() {
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

  function inject() {
    for (const position of positions) {
      if (position.key === "Resolver" && (position.object === dns || position.object === dnsPromises)) continue;
      const label = position.label;
      fakeCounters[label] = 0;
      const fake = function safeSyntheticOriginalTarget() {
        fakeCounters[label] += 1;
        return undefined;
      };
      Object.defineProperty(position.object, position.key, {
        value: fake,
        writable: position.descriptor?.writable ?? true,
        enumerable: position.descriptor?.enumerable ?? false,
        configurable: true,
      });
      injected.push({ ...position, fake });
    }
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
    syncBuiltinESMExports();
  }

  function restoreReal() {
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
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "failure-injection real-builtin restore failures");
  }

  allHarnesses.push({ injected, fakeCounters });
  return { positions, injected, fakeCounters, scan, inject, restoreReal };
}

function hardenedAfter(harness, guard, baseline) {
  if (!guard) {
    harness.restoreReal();
    return;
  }
  const failures = [];
  try {
    const expectedFinal = Object.fromEntries(Object.entries(baseline).map(([key, value]) => [key, value + 1]));
    guard.assertNoViolations(expectedFinal, "failure-injection cumulative window");
  } catch (error) {
    failures.push(error);
  }
  try {
    guard.restore();
  } catch (error) {
    failures.push(error);
  }
  try {
    for (const entry of harness.injected) {
      assert.equal(entry.object[entry.key], entry.fake, `restored captured identity: ${entry.label}`);
      assert.equal(harness.fakeCounters[entry.label], 0, `captured original never forwarded: ${entry.label}`);
    }
  } catch (error) {
    failures.push(error);
  }
  try {
    harness.restoreReal();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "failure-injection after() failures; every slot restore was still attempted");
}

function perSlotSuite(name, failureTest) {
  const harness = createHarness();
  describe(`failure-injection: ${name}`, { concurrency: false }, () => {
    let guard;
    let baseline;
    before(async () => {
      harness.scan();
      harness.inject();
      guard = installSideEffectGuard();
      guard.assertLoadTimeClean();
      guard.positiveControls();
      guard.installRuntimeFileGuard();
      baseline = guard.snapshot();
    });
    after(() => hardenedAfter(harness, guard, baseline));
    test("per-slot positive control +1 with zero growth of the captured synthetic original", () => {
      for (const entry of harness.injected) {
        const before = guard.snapshot()[entry.label];
        const fakeBefore = harness.fakeCounters[entry.label];
        assert.throws(() => Reflect.apply(entry.object[entry.key], entry.object, []),
          { code: BLOCKED }, `wrapper blocks: ${entry.label}`);
        assert.equal(guard.snapshot()[entry.label], before + 1, `real counter delta +1: ${entry.label}`);
        assert.equal(harness.fakeCounters[entry.label], fakeBefore, `captured original zero growth: ${entry.label}`);
      }
    });
    failureTest(harness, guard);
  });
}

perSlotSuite("cumulative-assertion-failure", (harness) => {
  test("injected failure: one extra guarded-slot call breaks the cumulative window", () => {
    const entry = harness.injected[0];
    assert.throws(() => Reflect.apply(entry.object[entry.key], entry.object, []), { code: BLOCKED });
  });
});

perSlotSuite("identity-and-counter-failure", (harness) => {
  test("injected failure: calling the captured synthetic original grows its counter", () => {
    const entry = harness.injected[0];
    entry.fake();
    assert.equal(harness.fakeCounters[entry.label], 1, "the injected call reached the fake");
  });
});

perSlotSuite("guard-restore-failure", (harness) => {
  test("injected failure: a non-configurable slot makes guard.restore() throw", () => {
    const entry = harness.injected.find((item) => item.label === TAMPERED_LABEL);
    assert.ok(entry, "tampered slot exists in the injected set");
    Object.defineProperty(entry.object, entry.key, { configurable: false });
    assert.equal(Object.getOwnPropertyDescriptor(entry.object, entry.key).configurable, false);
  });
});

describe("restore verifier after the injected failures", { concurrency: false }, () => {
  test("every slot is back to its real original except the deliberately tampered one", () => {
    for (const harness of allHarnesses) {
      for (const entry of harness.injected) {
        if (entry.label === TAMPERED_LABEL) {
          // The tamper made http.request non-configurable: its guard stub
          // remains by design and still blocks; everything else is real.
          assert.equal(typeof entry.object[entry.key], "function", "tampered slot still callable");
          assert.throws(() => Reflect.apply(entry.object[entry.key], entry.object, []),
            { code: BLOCKED }, "tampered slot keeps the blocking stub");
        } else {
          assert.equal(entry.object[entry.key], entry.original, `real builtin restored after failures: ${entry.label}`);
        }
      }
    }
    assert.equal(httpNamed.get, http.get, "http ESM binding re-synced");
    assert.equal(fsNamed.realpathSync, fs.realpathSync, "fs ESM binding re-synced");
    assert.equal(fsPromisesNamed.readFile, fsPromises.readFile, "fs.promises ESM binding re-synced");
    assert.equal(childNamed.spawn, childProcess.spawn, "child_process ESM binding re-synced");
    assert.equal(netNamed.connect, net.connect, "net ESM binding re-synced");
    assert.equal(dnsPromisesNamed.resolve4, dnsPromises.resolve4, "dns.promises ESM binding re-synced");
  });
});
