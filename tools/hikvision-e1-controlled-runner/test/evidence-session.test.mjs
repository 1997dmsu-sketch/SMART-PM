import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { installSideEffectGuard, descriptorSnapshot, assertDescriptorSnapshotUnchanged } from "./testkit.mjs";

function fixture() {
  return {
    schemaVersion: "hk-ai-08-controlled-e1-v1",
    checkerInput: {
      schemaVersion: "hk-ai-08-offline-config-v1", approvalRef: "synthetic-approval",
      approvedTarget: { deviceRef: "synthetic-device", host: "device.test", port: "443", model: "DS-K1T671BM" },
      candidate: { deviceRef: "synthetic-device", host: "device.test", allowedHosts: "device.test", port: "443", allowedPorts: "443", expectedModel: "DS-K1T671BM", allowRead: false },
    },
    credentials: { username: "synthetic-user", password: "synthetic-secret" },
    tls: { mode: "fingerprint-pinned", fingerprints: ["11".repeat(32)] },
    bounds: { timeoutMs: 10000, maxBytes: 262144 },
    authorization: { windowStartMs: 1000, windowEndMs: 10000 },
    outputPolicy: { version: "hk-ai-08-windows-evidence-v1" },
  };
}

describe("CR-1 evidence sessions: in-memory lifecycle only, never Windows proof", { concurrency: false }, () => {
  let guard;
  let baseline;
  let controls;
  let fileControls;
  let createSyntheticEvidenceModel;
  let prepareEvidenceGate;
  let capturePlan;
  let checkCapturedPlan;
  let advancePlan;
  let consumeCapturedPlan;
  let stopPlan;

  before(async () => {
    guard = installSideEffectGuard();
    ({ createSyntheticEvidenceModel } = await import("../evidence-session.mjs"));
    ({ prepareEvidenceGate } = await import("../windows-acl-bridge.mjs"));
    ({ capturePlan, checkCapturedPlan, advancePlan, consumeCapturedPlan, stopPlan } = await import("../private-plan.mjs"));
    guard.assertLoadTimeClean();
    controls = guard.positiveControls();
    fileControls = guard.installRuntimeFileGuard();
    baseline = guard.snapshot();
  });

  after(() => {
    try { guard.assertNoViolations(baseline, "entire evidence-session suite"); }
    finally { guard.restore(); }
  });

  function sealedPlan(input = fixture()) {
    const beforeSnapshot = structuredClone(input);
    const captured = capturePlan(input);
    assert.equal(captured.ok, true);
    assert.equal(checkCapturedPlan(captured.plan).ok, true);
    const afterSnapshot = structuredClone(input);
    assert.deepEqual(afterSnapshot, beforeSnapshot);
    guard.assertNoViolations(baseline, "plan creation input unchanged");
    return captured.plan;
  }

  function activeSession(fault = "NONE") {
    const plan = sealedPlan();
    const model = createSyntheticEvidenceModel();
    const session = model.prepare(plan, { fault });
    advancePlan(plan, "EVIDENCE_READY");
    advancePlan(plan, "ARMED");
    const ticket = consumeCapturedPlan(plan);
    model.activate(session, plan, ticket);
    assert.equal(model.inspect(session, plan).state, "ACTIVE");
    return { plan, model, session, ticket };
  }

  function ordinary(input, action, label) {
    const beforeSnapshot = structuredClone(input);
    try { return action(); }
    finally {
      const afterSnapshot = structuredClone(input);
      assert.deepEqual(afterSnapshot, beforeSnapshot, label);
      guard.assertNoViolations(baseline, label);
    }
  }

  test("CR1-GUARD session imports zero and all no-forward positive controls retained", (t) => {
    assert.ok(controls > 0);
    assert.ok(fileControls > 0);
    assert.ok(Object.values(guard.loadTimeSnapshot()).every((value) => value === 0));
    assert.ok(Object.values(baseline).every((value) => value >= 1));
    guard.assertNoViolations(baseline, "session guard self-check");
    t.diagnostic(JSON.stringify({ counts: guard.counts(), labels: guard.labels(), loadTime: guard.loadTimeSnapshot() }));
  });

  test("T08/NA02 native bridge cannot be made ready by PASS, ref or arbitrary callback", async (t) => {
    const probes = [
      { ready: true },
      { status: "PASS", evidenceRef: "synthetic-evidence-reference" },
      { path: "synthetic-old-output", nativeVerified: true },
    ];
    for (const input of probes) {
      await t.test(Object.keys(input).join("/"), () => {
        ordinary(input, () => {
          assert.deepEqual(prepareEvidenceGate(input), {
            scope: "native-capability-unavailable", ready: false, code: "EVIDENCE_GATE_UNVERIFIED",
          });
        }, "native bridge remains unavailable");
      });
    }
    let called = 0;
    const injected = { callback() { called += 1; }, ready: true };
    const beforeSnapshot = descriptorSnapshot(injected);
    const result = prepareEvidenceGate(injected);
    assert.equal(result.ready, false);
    assert.equal(called, 0);
    assertDescriptorSnapshotUnchanged(injected, beforeSnapshot);
    guard.assertNoViolations(baseline, "native bridge ignores callbacks");
  });

  test("NA01-SIM correct state order is explicit memory simulation, not real writer proof", () => {
    const { plan, model, session } = activeSession();
    const response = { endpointId: "deviceInfo", attempt: 1, body: "SYNTHETIC_RESPONSE" };
    ordinary(response, () => {
      const receipt = model.writeResponse(session, plan, response);
      assert.deepEqual(receipt, { bytes: 18, recordCount: 1 });
      const active = model.inspect(session, plan);
      assert.equal(active.scope, "synthetic-memory-only");
      assert.equal(active.recordCount, 1);
      assert.equal(active.bytesWritten, 18);
      model.seal(session, plan);
      assert.equal(model.inspect(session, plan).state, "SEALED");
      model.close(session, plan);
      const closed = model.inspect(session, plan);
      assert.equal(closed.state, "CLOSED");
      assert.equal(closed.closed, true);
      assert.equal(closed.recordCount, 1, "history is not rewritten by cleanup");
      assert.deepEqual(model.trace(), ["NEW", "PREPARING", "READY", "ACTIVE", "MEMORY_WRITE", "MEMORY_READ", "SEALED", "CLOSED"]);
      assert.equal(Object.hasOwn(closed, "sid"), false);
      assert.equal(Object.hasOwn(closed, "body"), false);
      assert.equal(Object.hasOwn(closed, "path"), false);
    }, "NA01 simulated lifecycle");
  });

  test("T04/T09/NA12 ordinary/ref/clone/cross-model objects cannot recover capabilities", async (t) => {
    for (const kind of ["ordinary", "reference", "clone", "other-plan", "other-model"]) {
      await t.test(kind, () => {
        const plan = sealedPlan();
        const model = createSyntheticEvidenceModel();
        const session = model.prepare(plan);
        const fakeSession = kind === "ordinary" ? {} : kind === "reference" ? "synthetic-ref" :
          kind === "clone" ? structuredClone(session) : session;
        const chosenPlan = kind === "other-plan" ? sealedPlan() : plan;
        const chosenModel = kind === "other-model" ? createSyntheticEvidenceModel() : model;
        assert.throws(() => chosenModel.assertReady(fakeSession, chosenPlan), { code: "EVIDENCE_GATE_INVALID" });
        assert.equal(model.inspect(session, plan).state, kind === "other-plan" ? "FAILED" : "READY");
        if (kind === "other-plan") {
          const response = { endpointId: "deviceInfo", attempt: 1, body: "synthetic" };
          ordinary(response, () => {
            assert.throws(() => model.writeResponse(session, plan, response), { code: "EVIDENCE_GATE_INVALID" });
            assert.equal(model.inspect(session, plan).recordCount, 0);
            assert.equal(model.inspect(session, plan).latched, true);
          }, "wrong-plan access cannot be undone by switching back to the original plan");
        }
        guard.assertNoViolations(baseline, `no capability recovery ${kind}`);
      });
    }
  });

  test("NA12 same plan cannot gain a second READY session through another model", () => {
    const input = fixture();
    ordinary(input, () => {
      const plan = sealedPlan(input);
      const first = createSyntheticEvidenceModel();
      const second = createSyntheticEvidenceModel();
      const originalSession = first.prepare(plan);
      assert.equal(first.assertReady(originalSession, plan), true);
      assert.equal(first.inspect(originalSession, plan).state, "READY");
      assert.throws(() => second.prepare(plan), { code: "EVIDENCE_GATE_INVALID" });
      assert.deepEqual(second.trace(), [], "rejected second model must not start another resource preparation");
      assert.throws(() => first.assertReady(originalSession, plan), { code: "EVIDENCE_GATE_INVALID" });
      const state = first.inspect(originalSession, plan);
      assert.equal(state.state, "FAILED");
      assert.equal(state.latched, true);
      const response = { endpointId: "deviceInfo", attempt: 1, body: "synthetic" };
      ordinary(response, () => {
        assert.throws(() => first.writeResponse(originalSession, plan, response), { code: "EVIDENCE_GATE_INVALID" });
        assert.equal(first.inspect(originalSession, plan).recordCount, 0);
      }, "second-model misuse invalidates the original capability");
    }, "single evidence-session association across models");
  });

  test("T10/NA12 failed preflight cannot be retried through a fresh model", async (t) => {
    for (const fault of ["PREFLIGHT_WRITE", "PREFLIGHT_READ", "PREFLIGHT_CLEANUP"]) {
      await t.test(fault, () => {
        const input = fixture();
        ordinary(input, () => {
          const plan = sealedPlan(input);
          const first = createSyntheticEvidenceModel();
          const second = createSyntheticEvidenceModel();
          assert.throws(() => first.prepare(plan, { fault }), { code: "EVIDENCE_GATE_FAILED" });
          assert.deepEqual(first.trace(), ["NEW", "PREPARING", "FAILED"]);
          assert.throws(() => second.prepare(plan), { code: "EVIDENCE_GATE_INVALID" });
          assert.deepEqual(second.trace(), [], "preflight failure does not return the plan's evidence claim");
          assert.throws(() => first.prepare(plan), { code: "EVIDENCE_GATE_INVALID" });
        }, `preflight ${fault} cannot recover through another model`);
      });
    }
  });

  test("T09/NA12 precheck is not transferable to an ordinary or unsealed plan", async (t) => {
    for (const kind of ["ordinary", "cloned", "ref", "unsealed"]) {
      await t.test(kind, () => {
        const valid = sealedPlan();
        const input = kind === "ordinary" ? { ready: true } : kind === "cloned" ? structuredClone(valid) :
          kind === "ref" ? "synthetic-plan-ref" : capturePlan(fixture()).plan;
        const beforeSnapshot = descriptorSnapshot(input);
        const model = createSyntheticEvidenceModel();
        assert.throws(() => model.prepare(input), { code: "EVIDENCE_GATE_INVALID" });
        assertDescriptorSnapshotUnchanged(input, beforeSnapshot);
        guard.assertNoViolations(baseline, `reject unproven plan ${kind}`);
      });
    }
  });

  test("T10/NA08 preflight fault claims plan once and never returns READY", async (t) => {
    for (const fault of ["PREFLIGHT_WRITE", "PREFLIGHT_READ", "PREFLIGHT_CLEANUP"]) {
      await t.test(fault, () => {
        const plan = sealedPlan();
        const model = createSyntheticEvidenceModel();
        const input = { fault };
        ordinary(input, () => {
          assert.throws(() => model.prepare(plan, input), { code: "EVIDENCE_GATE_FAILED" });
          assert.deepEqual(model.trace(), ["NEW", "PREPARING", "FAILED"]);
          assert.throws(() => model.prepare(plan), { code: "EVIDENCE_GATE_INVALID" });
        }, `preflight ${fault}`);
      });
    }
  });

  test("T10 preflight options reject hidden, Symbol and getter fields without evaluation", async (t) => {
    for (const kind of ["getter", "hidden", "symbol", "unknown"]) {
      await t.test(kind, () => {
        const plan = sealedPlan();
        const model = createSyntheticEvidenceModel();
        const options = { fault: "NONE" };
        let getterCalls = 0;
        if (kind === "getter") Object.defineProperty(options, "fault", { enumerable: true, get() { getterCalls += 1; throw new Error("SYNTHETIC_GETTER"); } });
        if (kind === "hidden") Object.defineProperty(options, "hidden", { value: undefined });
        if (kind === "symbol") options[Symbol("extra")] = undefined;
        if (kind === "unknown") options.fault = "SYNTHETIC_UNKNOWN_FAULT";
        const beforeSnapshot = descriptorSnapshot(options);
        let entered = 0;
        assert.throws(() => { entered += 1; model.prepare(plan, options); }, { code: "EVIDENCE_GATE_FAILED" });
        assert.equal(entered, 1);
        assert.equal(getterCalls, 0);
        assertDescriptorSnapshotUnchanged(options, beforeSnapshot);
        assert.throws(() => model.prepare(plan), { code: "EVIDENCE_GATE_INVALID" });
        guard.assertNoViolations(baseline, `preflight hostile ${kind}`);
      });
    }
  });

  test("NA12 activation requires the one private post-consumption ticket", async (t) => {
    for (const kind of ["boolean", "ordinary", "wrong-plan", "cloned-ticket", "used-ticket"]) {
      await t.test(kind, () => {
        const plan = sealedPlan();
        const model = createSyntheticEvidenceModel();
        const session = model.prepare(plan);
        advancePlan(plan, "EVIDENCE_READY"); advancePlan(plan, "ARMED");
        const ticket = consumeCapturedPlan(plan);
        let forged = kind === "boolean" ? true : kind === "ordinary" ? {} : ticket;
        if (kind === "wrong-plan") {
          const other = sealedPlan();
          advancePlan(other, "EVIDENCE_READY"); advancePlan(other, "ARMED");
          forged = consumeCapturedPlan(other);
        }
        if (kind === "cloned-ticket") forged = structuredClone(ticket);
        if (kind === "used-ticket") {
          model.activate(session, plan, ticket);
          const priorResponse = { endpointId: "deviceInfo", attempt: 1, body: "synthetic" };
          ordinary(priorResponse, () => model.writeResponse(session, plan, priorResponse), "known memory record before ticket replay");
          assert.throws(() => model.activate(session, plan, ticket), { code: "EVIDENCE_GATE_INVALID" });
          assert.equal(model.inspect(session, plan).state, "FAILED");
          assert.equal(model.inspect(session, plan).latched, true);
          const nextResponse = { endpointId: "deviceInfo", attempt: 2, body: "synthetic-next" };
          ordinary(nextResponse, () => {
            assert.throws(() => model.writeResponse(session, plan, nextResponse), { code: "EVIDENCE_GATE_INVALID" });
            assert.equal(model.inspect(session, plan).recordCount, 1);
            assert.equal(model.inspect(session, plan).bytesWritten, 9);
          }, "ticket replay latches the old ACTIVE capability without erasing prior records");
        } else {
          assert.throws(() => model.activate(session, plan, forged), { code: "EVIDENCE_GATE_INVALID" });
          assert.equal(model.inspect(session, plan).state, "FAILED");
          assert.equal(model.inspect(session, plan).latched, true);
        }
        guard.assertNoViolations(baseline, `ticket ${kind}`);
      });
    }
  });

  test("NA12 before-ACTIVE write failure cannot be followed by a valid activation", () => {
    const input = fixture();
    ordinary(input, () => {
      const plan = sealedPlan(input);
      const model = createSyntheticEvidenceModel();
      const session = model.prepare(plan);
      advancePlan(plan, "EVIDENCE_READY");
      advancePlan(plan, "ARMED");
      const validTicket = consumeCapturedPlan(plan);
      assert.equal(model.inspect(session, plan).state, "READY");
      const response = { endpointId: "deviceInfo", attempt: 1, body: "synthetic" };
      ordinary(response, () => {
        assert.throws(() => model.writeResponse(session, plan, response), { code: "EVIDENCE_GATE_INVALID" });
        assert.equal(model.inspect(session, plan).state, "FAILED");
        assert.equal(model.inspect(session, plan).latched, true);
        assert.throws(() => model.activate(session, plan, validTicket), { code: "EVIDENCE_GATE_INVALID" });
        assert.equal(model.inspect(session, plan).state, "FAILED");
        assert.equal(model.inspect(session, plan).recordCount, 0);
      }, "illegal pre-ACTIVE write is terminal even with a previously minted legitimate ticket");
    }, "before-ACTIVE gate misuse cannot recover");
  });

  test("NA03-SIM memory write keys are exclusive; no overwrite after duplicate", () => {
    const { plan, model, session } = activeSession();
    const response = { endpointId: "deviceInfo", attempt: 1, body: "first-synthetic-body" };
    ordinary(response, () => model.writeResponse(session, plan, response), "first unique key");
    const duplicate = { endpointId: "deviceInfo", attempt: 1, body: "replacement-synthetic-body" };
    ordinary(duplicate, () => {
      assert.throws(() => model.writeResponse(session, plan, duplicate), { code: "EVIDENCE_WRITE_FAILED" });
      const state = model.inspect(session, plan);
      assert.equal(state.state, "FAILED");
      assert.equal(state.latched, true);
      assert.equal(state.recordCount, 1);
      assert.equal(state.bytesWritten, 20);
    }, "duplicate key cannot overwrite");
  });

  test("NA08-SIM write/read faults preserve facts and latch; no retry", async (t) => {
    for (const [fault, expectedRecords] of [["WRITE", 0], ["READ", 1]]) {
      await t.test(fault, () => {
        const { plan, model, session } = activeSession(fault);
        const response = { endpointId: "deviceInfo", attempt: 1, body: "synthetic" };
        ordinary(response, () => {
          assert.throws(() => model.writeResponse(session, plan, response), { code: "EVIDENCE_WRITE_FAILED" });
          const state = model.inspect(session, plan);
          assert.equal(state.state, "FAILED");
          assert.equal(state.latched, true);
          assert.equal(state.recordCount, expectedRecords);
          assert.throws(() => model.writeResponse(session, plan, response), { code: "EVIDENCE_GATE_INVALID" });
          assert.equal(model.inspect(session, plan).recordCount, expectedRecords);
        }, `fault ${fault}`);
      });
    }
  });

  test("NA11-SIM endpoint and attempt are closed IDs, not caller filenames", async (t) => {
    const cases = [
      { endpointId: "synthetic-arbitrary-path", attempt: 1, body: "synthetic" },
      { endpointId: "deviceInfo", attempt: 0, body: "synthetic" },
      { endpointId: "deviceInfo", attempt: 3, body: "synthetic" },
      { endpointId: "deviceInfo", attempt: 1.5, body: "synthetic" },
      { endpointId: "deviceInfo", attempt: 1, body: "synthetic", path: "synthetic-path" },
      { endpointId: "deviceInfo", attempt: 1, body: { raw: "not-a-byte-body" } },
    ];
    for (const response of cases) {
      await t.test(`${response.endpointId}/${response.attempt}/${Object.keys(response).length}`, () => {
        const { plan, model, session } = activeSession();
        ordinary(response, () => {
          assert.throws(() => model.writeResponse(session, plan, response), { code: "EVIDENCE_WRITE_FAILED" });
          assert.equal(model.inspect(session, plan).recordCount, 0);
          assert.equal(model.inspect(session, plan).latched, true);
        }, "closed endpoint/attempt/body schema");
      });
    }
  });

  test("NA08-SIM body boundary has genuine string and byte-array positive cases", async (t) => {
    for (const body of ["", "synthetic", new Uint8Array([1, 2, 3]), "x".repeat(262144)]) {
      await t.test(`body bytes=${typeof body === "string" ? body.length : body.length}`, () => {
        const { plan, model, session } = activeSession();
        const response = { endpointId: "deviceInfo", attempt: 1, body };
        ordinary(response, () => {
          const receipt = model.writeResponse(session, plan, response);
          assert.equal(receipt.bytes, typeof body === "string" ? body.length : body.length);
          assert.equal(receipt.recordCount, 1);
          assert.equal(model.inspect(session, plan).state, "ACTIVE");
        }, "body positive bounds");
      });
    }
    const { plan, model, session } = activeSession();
    const tooLarge = { endpointId: "deviceInfo", attempt: 1, body: "x".repeat(262145) };
    ordinary(tooLarge, () => {
      assert.throws(() => model.writeResponse(session, plan, tooLarge), { code: "EVIDENCE_WRITE_FAILED" });
      assert.equal(model.inspect(session, plan).recordCount, 0);
    }, "oversize body rejected");
  });

  test("NA12 model does not write before ACTIVE or after SEALED/CLOSED", async (t) => {
    for (const target of ["READY", "SEALED", "CLOSED"]) {
      await t.test(target, () => {
        let plan, model, session;
        if (target === "READY") {
          plan = sealedPlan(); model = createSyntheticEvidenceModel(); session = model.prepare(plan);
        } else {
          ({ plan, model, session } = activeSession());
          model.seal(session, plan);
          if (target === "CLOSED") model.close(session, plan);
        }
        const beforeState = model.inspect(session, plan);
        const response = { endpointId: "deviceInfo", attempt: 1, body: "synthetic" };
        ordinary(response, () => {
          assert.throws(() => model.writeResponse(session, plan, response), { code: "EVIDENCE_GATE_INVALID" });
          if (target === "CLOSED") assert.deepEqual(model.inspect(session, plan), beforeState);
          else {
            const failed = model.inspect(session, plan);
            assert.equal(failed.state, "FAILED");
            assert.equal(failed.latched, true);
            assert.equal(failed.recordCount, beforeState.recordCount);
            assert.throws(() => model.writeResponse(session, plan, response), { code: "EVIDENCE_GATE_INVALID" });
          }
        }, `cannot append in ${target}`);
      });
    }
  });

  test("NA14-SIM failed cleanup remains unverified, not successful close", () => {
    const { plan, model, session } = activeSession("CLEANUP");
    const response = { endpointId: "deviceInfo", attempt: 1, body: "synthetic" };
    ordinary(response, () => model.writeResponse(session, plan, response), "record before cleanup fault");
    model.seal(session, plan);
    assert.throws(() => model.close(session, plan), { code: "CLEANUP_UNVERIFIED" });
    const state = model.inspect(session, plan);
    assert.equal(state.state, "FAILED");
    assert.equal(state.latched, true);
    assert.equal(state.closed, false);
    assert.equal(state.recordCount, 1);
    assert.throws(() => model.close(session, plan), { code: "EVIDENCE_GATE_INVALID" });
    guard.assertNoViolations(baseline, "cleanup failure retained");
  });

  test("T17/NA09-SIM invalidated plan cannot authorize a READY or ACTIVE session", async (t) => {
    for (const prior of ["READY", "ACTIVE"]) {
      await t.test(prior, () => {
        let plan, model, session;
        if (prior === "READY") {
          plan = sealedPlan(); model = createSyntheticEvidenceModel(); session = model.prepare(plan);
        } else ({ plan, model, session } = activeSession());
        stopPlan(plan, "AUTHORIZATION_INVALID", "INVALIDATED");
        const response = { endpointId: "deviceInfo", attempt: 1, body: "synthetic" };
        ordinary(response, () => {
          if (prior === "READY") assert.throws(() => model.assertReady(session, plan), { code: "EVIDENCE_GATE_INVALID" });
          else {
            assert.throws(() => model.writeResponse(session, plan, response), { code: "EVIDENCE_GATE_INVALID" });
            assert.throws(() => model.seal(session, plan), { code: "EVIDENCE_GATE_INVALID" });
          }
          assert.equal(model.inspect(session, plan).recordCount, 0);
        }, `plan invalidated in ${prior}`);
      });
    }
  });

  test("NA13 hidden/accessor/Symbol body metadata rejected without evaluation", async (t) => {
    for (const kind of ["getter", "hidden", "symbol", "proxy"]) {
      await t.test(kind, () => {
        const { plan, model, session } = activeSession();
        let getterCalls = 0;
        let traps = 0;
        let response = { endpointId: "deviceInfo", attempt: 1, body: "synthetic" };
        if (kind === "getter") Object.defineProperty(response, "body", { enumerable: true, get() { getterCalls += 1; throw new Error("SYNTHETIC_GETTER"); } });
        if (kind === "hidden") Object.defineProperty(response, "hidden", { value: undefined });
        if (kind === "symbol") response[Symbol("extra")] = undefined;
        if (kind === "proxy") response = new Proxy(response, {
          ownKeys() { traps += 1; throw new Error("SYNTHETIC_TRAP"); },
          get() { traps += 1; throw new Error("SYNTHETIC_TRAP"); },
          getOwnPropertyDescriptor() { traps += 1; throw new Error("SYNTHETIC_TRAP"); },
          getPrototypeOf() { traps += 1; throw new Error("SYNTHETIC_TRAP"); },
        });
        const beforeSnapshot = descriptorSnapshot(response);
        let entered = 0;
        assert.throws(() => { entered += 1; model.writeResponse(session, plan, response); }, { code: "EVIDENCE_WRITE_FAILED" });
        assert.equal(entered, 1);
        assert.equal(getterCalls, 0);
        assert.equal(traps, 0);
        assertDescriptorSnapshotUnchanged(response, beforeSnapshot);
        assert.equal(model.inspect(session, plan).recordCount, 0);
        guard.assertNoViolations(baseline, `response shape ${kind}`);
      });
    }
  });
});
