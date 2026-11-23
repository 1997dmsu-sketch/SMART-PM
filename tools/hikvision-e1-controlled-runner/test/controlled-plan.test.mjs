import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  installSideEffectGuard,
  descriptorSnapshot,
  assertDescriptorSnapshotUnchanged,
} from "./testkit.mjs";

// Contract fixtures are deliberately separate from the production validators.
// No real address, credential, certificate, approval, file or device is used.
function fixture() {
  return {
    schemaVersion: "hk-ai-08-controlled-e1-v1",
    checkerInput: {
      schemaVersion: "hk-ai-08-offline-config-v1",
      approvalRef: "synthetic-approval",
      approvedTarget: { deviceRef: "synthetic-device", host: "device.test", port: "443", model: "DS-K1T671BM" },
      candidate: {
        deviceRef: "synthetic-device", host: "device.test", allowedHosts: "device.test",
        port: "443", allowedPorts: "443", expectedModel: "DS-K1T671BM", allowRead: false,
      },
    },
    credentials: { username: "synthetic-user", password: "synthetic-secret" },
    tls: { mode: "fingerprint-pinned", fingerprints: ["11".repeat(32)] },
    bounds: { timeoutMs: 10000, maxBytes: 262144 },
    authorization: { windowStartMs: 1000, windowEndMs: 10000 },
    outputPolicy: { version: "hk-ai-08-windows-evidence-v1" },
  };
}

function control(overrides = {}) {
  return { nowMs: 2000, fresh: true, revoked: false, approval: "VERIFIED_SYNTHETIC", ...overrides };
}

describe("CR-1 controlled plan: synthetic contract, not E1 execution", { concurrency: false }, () => {
  let guard;
  let baseline;
  let positiveCount;
  let fileCount;
  let createSyntheticController;
  let executeControlledE1;

  before(async () => {
    guard = installSideEffectGuard();
    ({ createSyntheticController } = await import("../controlled-runner.mjs"));
    ({ executeControlledE1 } = await import("../index.mjs"));
    guard.assertLoadTimeClean();
    positiveCount = guard.positiveControls();
    fileCount = guard.installRuntimeFileGuard();
    baseline = guard.snapshot();
  });

  after(() => {
    try { guard.assertNoViolations(baseline, "entire controlled-plan suite"); }
    finally { guard.restore(); }
  });

  async function unchanged(input, action, label) {
    const beforeSnapshot = structuredClone(input);
    try { return await action(); }
    finally {
      const afterSnapshot = structuredClone(input);
      assert.deepEqual(afterSnapshot, beforeSnapshot, label);
      guard.assertNoViolations(baseline, label);
    }
  }

  function noDispatch(controller) {
    const snapshot = controller.snapshot();
    assert.equal(snapshot.transportInvocationCount, 0);
    assert.equal(snapshot.invokeCount, 0);
  }

  async function ready(input = fixture()) {
    const controller = createSyntheticController(input);
    assert.deepEqual(controller.check(control()), { ok: true, code: "OK", state: "SEALED" });
    assert.deepEqual(await controller.prepare({ fault: "NONE" }), { ok: true, code: "OK", state: "EVIDENCE_READY" });
    return controller;
  }

  test("CR1-GUARD loaded modules zero; every no-forward control retained", (t) => {
    assert.ok(positiveCount > 0);
    assert.ok(fileCount > 0);
    const load = guard.loadTimeSnapshot();
    assert.ok(Object.keys(load).length > 0);
    assert.ok(Object.values(load).every((count) => count === 0));
    assert.ok(Object.values(baseline).every((count) => count >= 1));
    const labels = guard.labels().join("\n");
    for (const name of ["fetch", "Socket", "listen", "tls", "dgram", "dns.promises", "child_process", "fs"]) {
      assert.ok(labels.includes(name), `actual guard inventory contains ${name}`);
    }
    guard.assertNoViolations(baseline, "guard self-check");
    t.diagnostic(JSON.stringify({ counts: guard.counts(), labels: guard.labels(), loadTime: guard.loadTimeSnapshot() }));
  });

  test("T01 source captured exactly once and checker snapshot stays non-executing", async () => {
    const input = fixture();
    await unchanged(input, async () => {
      const controller = createSyntheticController(input);
      const initial = controller.snapshot();
      assert.equal(initial.scope, "cr1-synthetic-only");
      assert.equal(initial.state, "CAPTURED");
      assert.equal(initial.sourceCaptureCount, 1);
      assert.equal(initial.checkerInvocationCount, 0);
      assert.deepEqual(controller.check(control()), { ok: true, code: "OK", state: "SEALED" });
      const checked = controller.snapshot();
      assert.equal(checked.sourceCaptureCount, 1);
      assert.equal(checked.checkerInvocationCount, 1);
      assert.equal(checked.checkerPassed, true);
      assert.equal(checked.runnerCompatible, true);
      assert.equal(checked.coreFrozen, true);
      assert.equal(checked.configurationFrozen, true);
      assert.equal(checked.checkerAllowReadDisabled, true);
      assert.equal(checked.consumed, false);
      assert.equal(input.checkerInput.candidate.allowRead, false);
      noDispatch(controller);
    }, "T01 full before/after");
  });

  test("T02 real entry cannot accept ref, Boolean, digest or synthetic controller as approval", async (t) => {
    for (const mode of ["valid-data", "approval-boolean", "self-digest", "fake-session", "callbacks"]) {
      await t.test(mode, async () => {
        const input = fixture();
        let callbacks = 0;
        const injected = mode === "callbacks" ? { transport() { callbacks += 1; }, ready: true } :
          mode === "fake-session" ? { scope: "synthetic-memory-only", ready: true, evidenceRef: "synthetic-ref" } :
          mode === "self-digest" ? { digest: "synthetic-digest" } : { approvalValid: true };
        const beforeInjected = descriptorSnapshot(injected);
        await unchanged(input, async () => {
          const result = await executeControlledE1(input, injected);
          assert.equal(result.status, "BLOCKED");
          assert.equal(result.code, "APPROVAL_UNVERIFIED");
          assert.equal(result.checks.evidenceGateVerified, false);
          assert.equal(result.checks.checkerPassed, false, "real approval is absent before semantic checker validation");
          assert.equal(result.checks.runnerCompatible, false);
          assert.equal(result.checks.singleUseConsumed, false);
          assert.equal(result.counts.transportInvocationCount, 0);
          assert.equal(callbacks, 0);
          assertDescriptorSnapshotUnchanged(injected, beforeInjected);
        }, `T02 ${mode}`);
      });
    }
  });

  test("T02 simulation also rejects unverified or stale control", async (t) => {
    for (const value of ["REF_ONLY", "SELF_SIGNED", "UNKNOWN", true, null]) {
      await t.test(String(value), async () => {
        const input = fixture();
        await unchanged(input, async () => {
          const controller = createSyntheticController(input);
          const result = controller.check(control({ approval: value }));
          assert.equal(result.ok, false);
          assert.equal(result.code, "APPROVAL_UNVERIFIED");
          noDispatch(controller);
        }, "T02 authority cannot be self-asserted");
      });
    }
  });

  test("T03a mutation of source data cannot replace the private captured snapshot", async () => {
    const input = fixture();
    const original = structuredClone(input);
    const controller = createSyntheticController(input);
    input.credentials.password = "changed-synthetic-secret";
    input.checkerInput.candidate.host = "replacement.test";
    input.tls.fingerprints[0] = "22".repeat(32);
    const beforeMutated = structuredClone(input);
    assert.equal(controller.matchesCapturedInput(original), true);
    assert.equal(controller.matchesCapturedInput(input), false);
    assert.deepEqual(controller.check(control()), { ok: true, code: "OK", state: "SEALED" });
    assert.equal(controller.snapshot().sourceCaptureCount, 1);
    noDispatch(controller);
    const afterMutated = structuredClone(input);
    assert.deepEqual(afterMutated, beforeMutated);
    assert.equal(original.checkerInput.candidate.allowRead, false);
    guard.assertNoViolations(baseline, "T03a never reread source");
  });

  test("T03b controlled invalidation and fresh=false stop the existing plan", async (t) => {
    for (const reason of ["reconfigure", "stale-authority"]) {
      await t.test(reason, async () => {
        const input = fixture();
        await unchanged(input, async () => {
          const controller = await ready(input);
          if (reason === "reconfigure") controller.invalidate();
          else controller.setControl(control({ fresh: false }));
          const arm = controller.arm({ ...control(), confirmed: true });
          assert.equal(arm.ok, false);
          assert.equal(controller.snapshot().stopLatched, true);
          noDispatch(controller);
        }, `T03b ${reason}`);
      });
    }
  });

  test("T05 host trim/lower and explicit decimal port preserve allowed normalization", async () => {
    const input = fixture();
    input.checkerInput.approvedTarget.host = " DEVICE.TEST ";
    input.checkerInput.candidate.host = " Device.Test ";
    input.checkerInput.candidate.allowedHosts = ", device.test ,";
    input.checkerInput.approvedTarget.port = "0443";
    input.checkerInput.candidate.port = "443";
    input.checkerInput.candidate.allowedPorts = "0443";
    await unchanged(input, async () => {
      const controller = createSyntheticController(input);
      assert.deepEqual(controller.check(control()), { ok: true, code: "OK", state: "SEALED" });
      const expected = {
        deviceRef: "synthetic-device", host: "device.test", port: 443,
        allowedHosts: ["device.test"], allowedPorts: [443], expectedModel: "DS-K1T671BM",
        username: "synthetic-user", password: "synthetic-secret", fingerprints: ["11".repeat(32)],
        timeoutMs: 10000, maxBytes: 262144, tlsMode: "fingerprint-pinned",
      };
      assert.equal(controller.matchesNormalizedBinding(expected), true, "normalization is checked against a handwritten oracle");
      assert.equal(controller.matchesNormalizedBinding({ ...expected, allowedHosts: [", device.test ,"] }), false);
      assert.equal(controller.matchesNormalizedBinding({ ...expected, port: "443" }), false);
      noDispatch(controller);
    }, "T05 normalized match");
  });

  test("T07 fixed pin parser normalization is uppercase hex with separators removed", async () => {
    const input = fixture();
    input.tls.fingerprints = [Array(32).fill("ab").join(":")];
    await unchanged(input, async () => {
      const controller = createSyntheticController(input);
      assert.deepEqual(controller.check(control()), { ok: true, code: "OK", state: "SEALED" });
      const expected = {
        deviceRef: "synthetic-device", host: "device.test", port: 443,
        allowedHosts: ["device.test"], allowedPorts: [443], expectedModel: "DS-K1T671BM",
        username: "synthetic-user", password: "synthetic-secret", fingerprints: ["AB".repeat(32)],
        timeoutMs: 10000, maxBytes: 262144, tlsMode: "fingerprint-pinned",
      };
      assert.equal(controller.matchesNormalizedBinding(expected), true);
      assert.equal(controller.matchesNormalizedBinding({ ...expected, fingerprints: ["ab".repeat(32)] }), false);
      noDispatch(controller);
    }, "pin normalization source oracle");
  });

  test("T07 duplicate approved pins follow fixed parser deduplication, not host-list repair", async () => {
    const input = fixture();
    input.tls.fingerprints = ["ab".repeat(32), Array(32).fill("AB").join(":")];
    await unchanged(input, async () => {
      const controller = createSyntheticController(input);
      assert.equal(controller.check(control()).ok, true);
      assert.equal(controller.matchesNormalizedBinding({
        deviceRef: "synthetic-device", host: "device.test", port: 443,
        allowedHosts: ["device.test"], allowedPorts: [443], expectedModel: "DS-K1T671BM",
        username: "synthetic-user", password: "synthetic-secret", fingerprints: ["AB".repeat(32)],
        timeoutMs: 10000, maxBytes: 262144, tlsMode: "fingerprint-pinned",
      }), true);
      noDispatch(controller);
    }, "duplicate pins use approved parser semantics");
  });

  test("T05 checker mismatches are CONFIG_REJECTED without defaults or list repair", async (t) => {
    const cases = [
      ["different host", (i) => { i.checkerInput.candidate.host = "other.test"; }],
      ["different port", (i) => { i.checkerInput.candidate.port = "8443"; }],
      ["duplicate allowed host", (i) => { i.checkerInput.candidate.allowedHosts = "device.test,device.test"; }],
      ["duplicate allowed port", (i) => { i.checkerInput.candidate.allowedPorts = "443,443"; }],
      ["missing explicit port", (i) => { i.checkerInput.candidate.port = ""; }],
      ["read enabled", (i) => { i.checkerInput.candidate.allowRead = true; }],
      ["different model", (i) => { i.checkerInput.candidate.expectedModel = "SYNTHETIC-WRONG-MODEL"; }],
    ];
    for (const [name, mutate] of cases) {
      await t.test(name, async () => {
        const input = fixture(); mutate(input);
        await unchanged(input, async () => {
          const controller = createSyntheticController(input);
          const result = controller.check(control());
          assert.equal(result.ok, false);
          assert.equal(result.code, "CONFIG_REJECTED");
          noDispatch(controller);
        }, `T05 ${name}`);
      });
    }
  });

  test("T06 both matching model strings with boundary whitespace remain runner-incompatible", async (t) => {
    for (const model of [" DS-K1T671BM", "DS-K1T671BM ", "\tDS-K1T671BM\n"]) {
      await t.test(JSON.stringify(model), async () => {
        const input = fixture();
        input.checkerInput.approvedTarget.model = model;
        input.checkerInput.candidate.expectedModel = model;
        await unchanged(input, async () => {
          const controller = createSyntheticController(input);
          const result = controller.check(control());
          assert.equal(result.code, "RUNNER_MODEL_INCOMPATIBLE");
          assert.equal(controller.snapshot().checkerPassed, true);
          noDispatch(controller);
        }, "T06 compatibility is stricter than raw model equality");
      });
    }
  });

  test("T07 explicit bounds reject every missing, non-integer or out-of-range value", async (t) => {
    for (const [field, maximum] of [["timeoutMs", 10000], ["maxBytes", 262144]]) {
      for (const value of [undefined, null, "1", 0, -1, 1.5, maximum + 1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
        await t.test(`${field}:${String(value)}`, async () => {
          const input = fixture(); input.bounds[field] = value;
          await unchanged(input, async () => {
            const controller = createSyntheticController(input);
            const result = controller.check(control());
            assert.equal(result.ok, false);
            assert.equal(result.code, "CONFIG_UNVERIFIED");
            noDispatch(controller);
          }, `T07 ${field}`);
        });
      }
    }
  });

  test("T07 approved bound limits and one or two pins have positive cases", async (t) => {
    for (const bounds of [{ timeoutMs: 1, maxBytes: 1 }, { timeoutMs: 10000, maxBytes: 262144 }]) {
      for (const pinCount of [1, 2]) {
        await t.test(`${bounds.timeoutMs}/${bounds.maxBytes},pins=${pinCount}`, async () => {
          const input = fixture();
          input.bounds = bounds;
          input.tls.fingerprints = pinCount === 1 ? ["11".repeat(32)] : ["11".repeat(32), "22".repeat(32)];
          await unchanged(input, async () => {
            const controller = createSyntheticController(input);
            assert.deepEqual(controller.check(control()), { ok: true, code: "OK", state: "SEALED" });
            noDispatch(controller);
          }, "T07 valid boundaries");
        });
      }
    }
  });

  test("T07 no missing credentials, fallback TLS, CA fields or malformed pin lists", async (t) => {
    const cases = [
      ["empty user", (i) => { i.credentials.username = ""; }],
      ["empty password", (i) => { i.credentials.password = ""; }],
      ["missing credentials", (i) => { delete i.credentials; }],
      ["empty pins", (i) => { i.tls.fingerprints = []; }],
      ["three pins", (i) => { i.tls.fingerprints = ["11".repeat(32), "22".repeat(32), "33".repeat(32)]; }],
      ["bad pin", (i) => { i.tls.fingerprints = ["synthetic-not-a-pin"]; }],
      ["63 hex pin", (i) => { i.tls.fingerprints = ["a".repeat(63)]; }],
      ["65 hex pin", (i) => { i.tls.fingerprints = ["a".repeat(65)]; }],
      ["empty item", (i) => { i.tls.fingerprints = [""]; }],
      ["system trust", (i) => { i.tls.mode = "system"; }],
      ["CA trust", (i) => { i.tls.mode = "ca"; }],
      ["mixed trust", (i) => { i.tls.mode = "mixed"; }],
      ["CA data", (i) => { i.tls.ca = "SYNTHETIC-CA-NOT-A-CERTIFICATE"; }],
      ["CA path", (i) => { i.tls.caPath = "synthetic-ca-path"; }],
    ];
    for (const [name, mutate] of cases) {
      await t.test(name, async () => {
        const input = fixture(); mutate(input);
        await unchanged(input, async () => {
          const controller = createSyntheticController(input);
          const result = controller.check(control());
          assert.equal(result.ok, false);
          assert.equal(result.code, "CONFIG_UNVERIFIED");
          noDispatch(controller);
        }, `T07 ${name}`);
      });
    }
  });

  test("T01 adversarial descriptors are refused without evaluation or mutation", async (t) => {
    for (const kind of ["getter", "hidden", "symbol-key", "function-value", "proxy", "pin-getter", "pin-hidden", "pin-hole"]) {
      await t.test(kind, () => {
        let getterCalls = 0;
        let traps = 0;
        let input = fixture();
        if (kind === "getter") Object.defineProperty(input.credentials, "password", {
          enumerable: true, configurable: true, get() { getterCalls += 1; throw new Error("SYNTHETIC_GETTER"); },
        });
        if (kind === "hidden") Object.defineProperty(input, "hidden", { value: "synthetic", enumerable: false });
        if (kind === "symbol-key") input[Symbol("synthetic-extra")] = "synthetic";
        if (kind === "function-value") input.credentials.password = () => "synthetic";
        if (kind === "pin-getter") Object.defineProperty(input.tls.fingerprints, "0", {
          enumerable: true, configurable: true, get() { getterCalls += 1; throw new Error("SYNTHETIC_GETTER"); },
        });
        if (kind === "pin-hidden") Object.defineProperty(input.tls.fingerprints, "hidden", { value: "synthetic" });
        if (kind === "pin-hole") input.tls.fingerprints = Array(1);
        if (kind === "proxy") input = new Proxy(input, {
          get() { traps += 1; throw new Error("SYNTHETIC_PROXY_GET"); },
          ownKeys() { traps += 1; throw new Error("SYNTHETIC_PROXY_KEYS"); },
          getOwnPropertyDescriptor() { traps += 1; throw new Error("SYNTHETIC_PROXY_DESCRIPTOR"); },
          getPrototypeOf() { traps += 1; throw new Error("SYNTHETIC_PROXY_PROTOTYPE"); },
        });
        const beforeSnapshot = descriptorSnapshot(input);
        let entered = 0;
        const controller = (() => { entered += 1; return createSyntheticController(input); })();
        const result = controller.check(control());
        assert.equal(entered, 1);
        assert.equal(result.ok, false);
        assert.equal(result.code, "CONFIG_UNVERIFIED");
        assert.equal(getterCalls, 0);
        assert.equal(traps, 0);
        assertDescriptorSnapshotUnchanged(input, beforeSnapshot);
        noDispatch(controller);
        guard.assertNoViolations(baseline, `descriptor ${kind}`);
      });
    }
  });

  test("T10 synthetic preflight fault never mints or invokes transport", async (t) => {
    for (const fault of ["PREFLIGHT_WRITE", "PREFLIGHT_READ", "PREFLIGHT_CLEANUP"]) {
      await t.test(fault, async () => {
        const input = fixture();
        await unchanged(input, async () => {
          const controller = createSyntheticController(input);
          assert.equal(controller.check(control()).ok, true);
          const result = await controller.prepare({ fault });
          assert.equal(result.ok, false);
          assert.equal(result.code, "EVIDENCE_GATE_FAILED");
          const state = controller.snapshot();
          assert.equal(state.mintCount, 0);
          assert.equal(state.activationCount, 0);
          assert.equal(state.stopLatched, true);
          noDispatch(controller);
        }, `T10 ${fault}`);
      });
    }
  });

  test("T11 async gate must recheck expiry, revocation and freshness after yielding", async (t) => {
    for (const [name, overrides, code] of [
      ["expiry", { nowMs: 10000 }, "AUTHORIZATION_INVALID"],
      ["revocation", { revoked: true }, "AUTHORIZATION_INVALID"],
      ["freshness", { fresh: false }, "APPROVAL_UNVERIFIED"],
    ]) {
      await t.test(name, async () => {
        const input = fixture();
        await unchanged(input, async () => {
          const controller = createSyntheticController(input);
          assert.equal(controller.check(control()).ok, true);
          const pending = controller.prepare({ fault: "NONE" });
          controller.setControl(control(overrides));
          const result = await pending;
          assert.equal(result.ok, false);
          assert.equal(result.code, code);
          assert.equal(controller.snapshot().mintCount, 0);
          noDispatch(controller);
        }, `T11 ${name}`);
      });
    }
  });

  test("T12 approved time interval is start-inclusive and end-exclusive", async (t) => {
    for (const [nowMs, expected] of [[999, false], [1000, true], [9999, true], [10000, false], [10001, false]]) {
      await t.test(`now=${nowMs}`, async () => {
        const input = fixture();
        await unchanged(input, async () => {
          const controller = createSyntheticController(input);
          const result = controller.check(control({ nowMs }));
          assert.equal(result.ok, expected);
          assert.equal(result.code, expected ? "OK" : "AUTHORIZATION_INVALID");
          noDispatch(controller);
        }, "T12 exact boundaries");
      });
    }
  });

  test("T13 single synchronous consumer wins; no invocation is invented in CR-1", async () => {
    const input = fixture();
    await unchanged(input, async () => {
      const controller = await ready(input);
      assert.deepEqual(controller.arm({ ...control(), confirmed: true }), { ok: true, code: "OK", state: "ARMED" });
      const result = await Promise.all([
        Promise.resolve().then(() => controller.consume(control())),
        Promise.resolve().then(() => controller.consume(control())),
      ]);
      assert.equal(result.filter((r) => r.ok).length, 1);
      assert.equal(result.find((r) => !r.ok).code, "PLAN_CONSUMED");
      const snapshot = controller.snapshot();
      assert.equal(snapshot.consumed, true);
      assert.equal(snapshot.mintCount, 1);
      assert.equal(snapshot.activationCount, 1);
      noDispatch(controller);
      const trace = snapshot.trace;
      assert.ok(trace.indexOf("CONSUMED") >= 0);
      assert.ok(trace.indexOf("CONSUMED") < trace.indexOf("SYNTHETIC_MINT"));
      assert.ok(trace.indexOf("SYNTHETIC_MINT") < trace.indexOf("SYNTHETIC_ACTIVE"));
    }, "T13 single consumption");
  });

  test("T13 no bare or false confirmation may arm or consume the session", async (t) => {
    for (const confirmation of [false, undefined, true]) {
      await t.test(`confirmation=${String(confirmation)}`, async () => {
        const input = fixture();
        await unchanged(input, async () => {
          const controller = await ready(input);
          const arg = confirmation === undefined ? control() : { ...control(), confirmed: confirmation };
          const arm = controller.arm(arg);
          assert.equal(arm.ok, confirmation === true);
          assert.equal(controller.snapshot().consumed, false);
          assert.equal(controller.snapshot().mintCount, 0);
          noDispatch(controller);
        }, "confirmation is required before ARM");
      });
    }
  });

  test("T13 failure and unknown outcomes never return the consumption right", async (t) => {
    for (const unknown of [false, true]) {
      await t.test(`unknown=${unknown}`, async () => {
        const input = fixture();
        await unchanged(input, async () => {
          const controller = await ready(input);
          assert.equal(controller.arm({ ...control(), confirmed: true }).ok, true);
          assert.equal(controller.consume(control()).ok, true);
          controller.fail({ unknown });
          const retry = controller.consume(control());
          assert.equal(retry.ok, false);
          assert.equal(retry.code, "PLAN_CONSUMED");
          assert.equal(controller.snapshot().consumed, true);
          assert.equal(controller.snapshot().mintCount, 1);
          assert.equal(controller.snapshot().stopLatched, true);
          noDispatch(controller);
        }, "T13 no refund of consumed plan");
      });
    }
  });

  test("T12 backward or unknown clocks cannot arm a previously ready session", async (t) => {
    for (const nowMs of [1999, NaN, Infinity, undefined]) {
      await t.test(String(nowMs), async () => {
        const input = fixture();
        await unchanged(input, async () => {
          const controller = await ready(input);
          const result = controller.arm({ ...control({ nowMs }), confirmed: true });
          assert.equal(result.ok, false);
          assert.equal(controller.snapshot().stopLatched, true);
          noDispatch(controller);
        }, "T12 unreliable clock");
      });
    }
  });
});
