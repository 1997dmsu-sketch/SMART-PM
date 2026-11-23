import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { installSideEffectGuard, descriptorSnapshot, assertDescriptorSnapshotUnchanged } from "./testkit.mjs";

// A §6 is the independent output oracle. These constants do not come from the
// mapper being tested and do not carry a real target or secret.
const IDS = ["deviceInfo", "acsCapabilities", "userInfoCapabilities", "fdlibCapabilities", "fdlibList", "fdlibCount"];
const ROOT_KEYS = ["schemaVersion", "scope", "planRef", "evidenceRef", "status", "code", "checks", "counts", "requestOutcomeUnknown", "endpoints"];
const CHECK_KEYS = ["checkerPassed", "runnerCompatible", "evidenceGateVerified", "singleUseConsumed"];
const COUNT_KEYS = ["logicalEndpointsAttempted", "wrapperAttemptCount", "transportInvocationCount", "confirmedResponses"];
const CODES = [
  "OK", "CONFIG_UNVERIFIED", "APPROVAL_UNVERIFIED", "AUTHORIZATION_INVALID", "CONFIG_REJECTED",
  "RUNNER_MODEL_INCOMPATIBLE", "PLAN_INVALID", "EVIDENCE_GATE_UNVERIFIED", "EVIDENCE_GATE_FAILED",
  "EVIDENCE_GATE_INVALID", "PLAN_CONSUMED", "REQUEST_OUT_OF_SCOPE", "PROBE_FAILED",
  "REQUEST_OUTCOME_UNKNOWN", "EVIDENCE_WRITE_FAILED", "INTERNAL_ERROR",
];

function validContext() {
  return {
    planRef: "plan-11111111-1111-4111-8111-111111111111",
    evidenceRef: "evidence-22222222-2222-4222-8222-222222222222",
    status: "COMPLETED", code: "OK",
    checks: { checkerPassed: true, runnerCompatible: true, evidenceGateVerified: true, singleUseConsumed: true },
    counts: { logicalEndpointsAttempted: 6, wrapperAttemptCount: 6, transportInvocationCount: 6, confirmedResponses: 6 },
    requestOutcomeUnknown: false,
    endpoints: IDS.map((id) => ({ id, state: "OK" })),
  };
}

function assertShape(result) {
  assert.deepEqual(Reflect.ownKeys(result).sort(), [...ROOT_KEYS].sort());
  assert.equal(result.schemaVersion, "controlled-e1-binding-v1");
  assert.equal(result.scope, "single-authorized-e1-read-only");
  assert.deepEqual(Reflect.ownKeys(result.checks).sort(), [...CHECK_KEYS].sort());
  assert.deepEqual(Reflect.ownKeys(result.counts).sort(), [...COUNT_KEYS].sort());
  for (const key of CHECK_KEYS) assert.equal(typeof result.checks[key], "boolean");
  for (const key of COUNT_KEYS) assert.ok(Number.isSafeInteger(result.counts[key]) && result.counts[key] >= 0);
  assert.ok(["BLOCKED", "COMPLETED", "FAILED", "UNKNOWN"].includes(result.status));
  assert.ok(CODES.includes(result.code));
  assert.equal(typeof result.requestOutcomeUnknown, "boolean");
  assert.equal(result.endpoints.length, 6);
  assert.deepEqual(result.endpoints.map((entry) => entry.id), IDS);
  for (const endpoint of result.endpoints) {
    assert.deepEqual(Reflect.ownKeys(endpoint).sort(), ["id", "state"]);
    assert.ok(["NOT_ATTEMPTED", "OK", "FAILED", "UNKNOWN"].includes(endpoint.state));
  }
}

describe("CR-1 public result: closed DTO and hostile-value safety", { concurrency: false }, () => {
  let guard;
  let baseline;
  let makePublicResult;
  let errorToCode;
  let controls;
  let fileControls;

  before(async () => {
    guard = installSideEffectGuard();
    ({ makePublicResult, errorToCode } = await import("../public-result.mjs"));
    guard.assertLoadTimeClean();
    controls = guard.positiveControls();
    fileControls = guard.installRuntimeFileGuard();
    baseline = guard.snapshot();
  });

  after(() => {
    try { guard.assertNoViolations(baseline, "entire public-result suite"); }
    finally { guard.restore(); }
  });

  function ordinary(input, operation, label) {
    const beforeSnapshot = structuredClone(input);
    try { return operation(); }
    finally {
      const afterSnapshot = structuredClone(input);
      assert.deepEqual(afterSnapshot, beforeSnapshot, label);
      guard.assertNoViolations(baseline, label);
    }
  }

  test("CR1-GUARD DTO loading clean, counters prove positive controls without forwarding", (t) => {
    assert.ok(controls > 0);
    assert.ok(fileControls > 0);
    assert.ok(Object.values(guard.loadTimeSnapshot()).every((value) => value === 0));
    assert.ok(Object.values(baseline).every((value) => value >= 1));
    guard.assertNoViolations(baseline, "public-result guard self-check");
    t.diagnostic(JSON.stringify({ counts: guard.counts(), labels: guard.labels(), loadTime: guard.loadTimeSnapshot() }));
  });

  test("T19 closed default output records unknown evidence as false/zero, not approved", () => {
    const result = makePublicResult();
    assertShape(result);
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.code, "INTERNAL_ERROR");
    assert.equal(result.planRef, null);
    assert.equal(result.evidenceRef, null);
    assert.deepEqual(result.checks, Object.fromEntries(CHECK_KEYS.map((key) => [key, false])));
    assert.deepEqual(result.counts, Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])));
    assert.deepEqual(result.endpoints, IDS.map((id) => ({ id, state: "NOT_ATTEMPTED" })));
    assert.equal(result.requestOutcomeUnknown, false);
    guard.assertNoViolations(baseline, "default DTO");
  });

  test("T19 valid context retains only the exact approved DTO fields", () => {
    const input = validContext();
    ordinary(input, () => {
      const result = makePublicResult(input);
      assertShape(result);
      assert.deepEqual(result, { schemaVersion: "controlled-e1-binding-v1", scope: "single-authorized-e1-read-only", ...input });
      assert.notEqual(result.checks, input.checks);
      assert.notEqual(result.counts, input.counts);
      assert.notEqual(result.endpoints, input.endpoints);
      assert.equal(Object.isFrozen(result), true);
      assert.equal(Object.isFrozen(result.checks), true);
      assert.equal(Object.isFrozen(result.counts), true);
      assert.equal(Object.isFrozen(result.endpoints), true);
      for (let i = 0; i < result.endpoints.length; i += 1) assert.notEqual(result.endpoints[i], input.endpoints[i]);
    }, "exact successful DTO");
  });

  test("T19 known errors remain fixed categories and never expose raw error text", async (t) => {
    for (const code of CODES.filter((value) => value !== "OK")) {
      await t.test(code, () => {
        const error = new Error("SYNTHETIC_RAW_ERROR_SENTINEL");
        error.code = code;
        error.target = "SYNTHETIC_TARGET_SENTINEL";
        const beforeSnapshot = descriptorSnapshot(error);
        assert.equal(errorToCode(error), code);
        assertDescriptorSnapshotUnchanged(error, beforeSnapshot);
        const result = makePublicResult({ code, status: code === "REQUEST_OUTCOME_UNKNOWN" ? "UNKNOWN" : "FAILED" });
        assertShape(result);
        assert.equal(result.code, code);
        assert.equal(JSON.stringify(result).includes("SYNTHETIC_"), false);
        guard.assertNoViolations(baseline, `fixed ${code}`);
      });
    }
  });

  test("T19 raw report and all extra metadata are rejected, not serialized", async (t) => {
    const probes = [
      ["host", "SYNTHETIC_HOST_SENTINEL"], ["port", 65531],
      ["hostFingerprint", "SYNTHETIC_TARGET_HASH_SENTINEL"], ["password", "SYNTHETIC_PASSWORD_SENTINEL"],
      ["headers", { Authorization: "SYNTHETIC_AUTH_HEADER_SENTINEL" }],
      ["body", "SYNTHETIC_BODY_SENTINEL"], ["path", "SYNTHETIC_PATH_SENTINEL"],
      ["sid", "SYNTHETIC_SID_SENTINEL"], ["message", "SYNTHETIC_MESSAGE_SENTINEL"],
      ["stack", "SYNTHETIC_STACK_SENTINEL"], ["approvalValid", true], ["sameConfigBound", true],
    ];
    for (const [key, value] of probes) {
      await t.test(key, () => {
        const input = { ...validContext(), [key]: value };
        ordinary(input, () => {
          const result = makePublicResult(input);
          assertShape(result);
          assert.equal(result.code, "INTERNAL_ERROR");
          assert.equal(result.status, "FAILED", "known nonzero facts survive metadata rejection");
          assert.deepEqual(result.counts, input.counts, "do not rewrite already known calls as zero");
          assert.equal(JSON.stringify(result).includes("SYNTHETIC_"), false);
          assert.equal(Object.hasOwn(result, key), false);
        }, `reject extra ${key}`);
      });
    }
  });

  test("T19 nested metadata, hidden keys and Symbols cannot bypass the DTO shape", async (t) => {
    const cases = [
      ["checks-extra", (i) => { i.checks.approvalValid = true; }],
      ["counts-extra", (i) => { i.counts.targetHash = "SYNTHETIC_HASH_SENTINEL"; }],
      ["endpoint-extra", (i) => { i.endpoints[0].body = "SYNTHETIC_BODY_SENTINEL"; }],
      ["nested-_id-undefined", (i) => { i.endpoints[0]._id = undefined; }],
      ["nested-updatedAt-undefined", (i) => { i.endpoints[0].updatedAt = undefined; }],
      ["root-hidden", (i) => { Object.defineProperty(i, "hidden", { value: "SYNTHETIC_HIDDEN_SENTINEL" }); }],
      ["checks-hidden", (i) => { Object.defineProperty(i.checks, "hidden", { value: undefined }); }],
      ["endpoint-Symbol", (i) => { i.endpoints[0][Symbol("extra")] = "SYNTHETIC_SYMBOL_SENTINEL"; }],
      ["root-Symbol", (i) => { i[Symbol("extra")] = undefined; }],
    ];
    for (const [name, mutate] of cases) {
      await t.test(name, () => {
        const input = validContext(); mutate(input);
        const beforeSnapshot = descriptorSnapshot(input);
        let entered = 0;
        const result = (() => { entered += 1; return makePublicResult(input); })();
        assert.equal(entered, 1);
        assertShape(result);
        assert.equal(result.code, "INTERNAL_ERROR");
        assert.equal(JSON.stringify(result).includes("SYNTHETIC_"), false);
        assertDescriptorSnapshotUnchanged(input, beforeSnapshot);
        guard.assertNoViolations(baseline, `nested DTO ${name}`);
      });
    }
  });

  test("T19 getter/proxy/unknown thrown values are not inspected or executed", async (t) => {
    for (const mode of ["root-getter", "nested-getter", "root-proxy", "error-getter", "error-proxy", "primitive"]) {
      await t.test(mode, () => {
        let getters = 0;
        let traps = 0;
        let input = validContext();
        const hostile = { get() { traps += 1; throw new Error("SYNTHETIC_TRAP"); },
          ownKeys() { traps += 1; throw new Error("SYNTHETIC_TRAP"); },
          getOwnPropertyDescriptor() { traps += 1; throw new Error("SYNTHETIC_TRAP"); },
          getPrototypeOf() { traps += 1; throw new Error("SYNTHETIC_TRAP"); } };
        if (mode === "root-getter") Object.defineProperty(input, "code", { enumerable: true, get() { getters += 1; throw new Error("SYNTHETIC_GETTER"); } });
        if (mode === "nested-getter") Object.defineProperty(input.checks, "checkerPassed", { enumerable: true, get() { getters += 1; throw new Error("SYNTHETIC_GETTER"); } });
        if (mode === "root-proxy") input = new Proxy(input, hostile);
        if (mode === "error-getter") {
          input = new Error("SYNTHETIC_ERROR");
          Object.defineProperty(input, "code", { enumerable: true, get() { getters += 1; throw new Error("SYNTHETIC_GETTER"); } });
        }
        if (mode === "error-proxy") input = new Proxy(new Error("SYNTHETIC_ERROR"), hostile);
        if (mode === "primitive") input = "SYNTHETIC_UNKNOWN_EXCEPTION";
        const beforeSnapshot = descriptorSnapshot(input);
        let entered = 0;
        if (mode.startsWith("error-") || mode === "primitive") {
          const code = (() => { entered += 1; return errorToCode(input); })();
          assert.equal(code, "INTERNAL_ERROR");
        } else {
          const result = (() => { entered += 1; return makePublicResult(input); })();
          assertShape(result);
          assert.equal(result.code, "INTERNAL_ERROR");
        }
        assert.equal(entered, 1);
        assert.equal(getters, 0);
        assert.equal(traps, 0);
        assertDescriptorSnapshotUnchanged(input, beforeSnapshot);
        guard.assertNoViolations(baseline, `hostile ${mode}`);
      });
    }
  });

  test("T19 counts, endpoint identities and references cannot encode arbitrary values", async (t) => {
    const cases = [
      ["logical>6", (i) => { i.counts.logicalEndpointsAttempted = 7; }],
      ["negative", (i) => { i.counts.transportInvocationCount = -1; }],
      ["fraction", (i) => { i.counts.confirmedResponses = 1.5; }],
      ["unsafe", (i) => { i.counts.wrapperAttemptCount = Number.MAX_SAFE_INTEGER + 1; }],
      ["wrong-id", (i) => { i.endpoints[0].id = "SYNTHETIC_TARGET_SENTINEL"; }],
      ["wrong-order", (i) => { [i.endpoints[0], i.endpoints[1]] = [i.endpoints[1], i.endpoints[0]]; }],
      ["unknown-state", (i) => { i.endpoints[0].state = "SYNTHETIC_UNKNOWN_STATE"; }],
      ["unknown-code", (i) => { i.code = "SYNTHETIC_UNKNOWN_CODE"; }],
      ["unknown-status", (i) => { i.status = "SYNTHETIC_UNKNOWN_STATUS"; }],
      ["arbitrary-ref", (i) => { i.planRef = "SYNTHETIC_PATH_SENTINEL"; }],
      ["wrong-ref-kind", (i) => { i.evidenceRef = i.planRef; }],
      ["naked-uuid", (i) => { i.planRef = "11111111-1111-4111-8111-111111111111"; }],
    ];
    for (const [name, mutate] of cases) {
      await t.test(name, () => {
        const input = validContext(); mutate(input);
        ordinary(input, () => {
          const result = makePublicResult(input);
          assertShape(result);
          assert.equal(result.code, "INTERNAL_ERROR");
          assert.equal(JSON.stringify(result).includes("SYNTHETIC_"), false);
        }, `invalid DTO ${name}`);
      });
    }
  });

  test("T19 malformed report retains confirmed nonzero and uncertain-call facts", async (t) => {
    for (const unknown of [false, true]) {
      await t.test(`unknown=${unknown}`, () => {
        const input = validContext();
        input.code = "SYNTHETIC_UNMAPPABLE_ERROR";
        input.status = unknown ? "UNKNOWN" : "FAILED";
        input.requestOutcomeUnknown = unknown;
        if (unknown) {
          input.counts = { logicalEndpointsAttempted: 1, wrapperAttemptCount: 1, transportInvocationCount: 1, confirmedResponses: 0 };
          input.endpoints = IDS.map((id, index) => ({ id, state: index === 0 ? "UNKNOWN" : "NOT_ATTEMPTED" }));
        }
        ordinary(input, () => {
          const result = makePublicResult(input);
          assertShape(result);
          assert.equal(result.code, "INTERNAL_ERROR");
          assert.equal(result.status, unknown ? "UNKNOWN" : "FAILED");
          assert.deepEqual(result.counts, input.counts);
          assert.deepEqual(result.endpoints, input.endpoints);
          assert.equal(result.requestOutcomeUnknown, unknown);
          assert.equal(JSON.stringify(result).includes("SYNTHETIC_"), false);
        }, "safe known facts survive error mapping");
      });
    }
  });

  test("T19 unreadable facts are UNKNOWN, distinct from an ordinary empty context", async (t) => {
    const empty = {};
    ordinary(empty, () => {
      const result = makePublicResult(empty);
      assertShape(result);
      assert.equal(result.code, "INTERNAL_ERROR");
      assert.equal(result.status, "BLOCKED");
      assert.equal(result.requestOutcomeUnknown, false);
      assert.deepEqual(result.counts, Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])));
      assert.deepEqual(result.endpoints, IDS.map((id) => ({ id, state: "NOT_ATTEMPTED" })));
    }, "facts genuinely absent");

    for (const mode of ["root-proxy", "counts-getter", "unknown-getter", "nested-count-getter", "counts-proxy"]) {
      await t.test(mode, () => {
        let getters = 0;
        let traps = 0;
        let input = validContext();
        const hostile = {
          get() { traps += 1; throw new Error("SYNTHETIC_FACTS_PROXY"); },
          ownKeys() { traps += 1; throw new Error("SYNTHETIC_FACTS_PROXY"); },
          getOwnPropertyDescriptor() { traps += 1; throw new Error("SYNTHETIC_FACTS_PROXY"); },
          getPrototypeOf() { traps += 1; throw new Error("SYNTHETIC_FACTS_PROXY"); },
        };
        if (mode === "root-proxy") input = new Proxy(input, hostile);
        if (mode === "counts-proxy") input.counts = new Proxy(input.counts, hostile);
        if (mode === "counts-getter") Object.defineProperty(input, "counts", {
          enumerable: true, get() { getters += 1; throw new Error("SYNTHETIC_FACTS_GETTER"); },
        });
        if (mode === "unknown-getter") Object.defineProperty(input, "requestOutcomeUnknown", {
          enumerable: true, get() { getters += 1; throw new Error("SYNTHETIC_FACTS_GETTER"); },
        });
        if (mode === "nested-count-getter") Object.defineProperty(input.counts, "transportInvocationCount", {
          enumerable: true, get() { getters += 1; throw new Error("SYNTHETIC_FACTS_GETTER"); },
        });
        const beforeSnapshot = descriptorSnapshot(input);
        let entered = 0;
        const result = (() => { entered += 1; return makePublicResult(input); })();
        assertShape(result);
        assert.equal(entered, 1);
        assert.equal(result.code, "INTERNAL_ERROR");
        assert.equal(result.status, "UNKNOWN", "inaccessible facts do not prove no earlier calls");
        assert.equal(result.requestOutcomeUnknown, true);
        assert.equal(getters, 0);
        assert.equal(traps, 0);
        assertDescriptorSnapshotUnchanged(input, beforeSnapshot);
        if (mode === "unknown-getter") {
          assert.deepEqual(result.counts, validContext().counts, "separately safe nonzero counters are retained");
        }
        guard.assertNoViolations(baseline, `unreadable facts ${mode}`);
      });
    }
  });

  test("E14 contradictory unknown code/status/flag cannot downgrade uncertainty", async (t) => {
    const cases = [
      { status: "FAILED", code: "REQUEST_OUTCOME_UNKNOWN", requestOutcomeUnknown: false },
      { status: "UNKNOWN", code: "INTERNAL_ERROR", requestOutcomeUnknown: false },
    ];
    for (const contradiction of cases) {
      await t.test(`${contradiction.status}/${contradiction.code}`, () => {
        const input = { ...validContext(), ...contradiction };
        ordinary(input, () => {
          const result = makePublicResult(input);
          assertShape(result);
          assert.equal(result.code, "INTERNAL_ERROR");
          assert.equal(result.status, "UNKNOWN");
          assert.equal(result.requestOutcomeUnknown, true);
          assert.deepEqual(result.counts, input.counts, "known calls remain even when metadata contradicts itself");
          assert.equal(JSON.stringify(result).includes("SYNTHETIC_"), false);
        }, "unknown may not be downgraded by contradictory metadata");
      });
    }
  });

  test("T19 incomplete success cannot claim COMPLETED/OK", async (t) => {
    const cases = [
      ["missing checks", (i) => { delete i.checks; }],
      ["false checker", (i) => { i.checks.checkerPassed = false; }],
      ["false gate", (i) => { i.checks.evidenceGateVerified = false; }],
      ["not consumed", (i) => { i.checks.singleUseConsumed = false; }],
      ["no plan ref", (i) => { i.planRef = null; }],
      ["no evidence ref", (i) => { i.evidenceRef = null; }],
      ["unattempted endpoint", (i) => { i.endpoints[5].state = "NOT_ATTEMPTED"; }],
      ["only five logical", (i) => { i.counts.logicalEndpointsAttempted = 5; }],
      ["unconfirmed response", (i) => { i.counts.confirmedResponses = 5; }],
      ["unknown outcome", (i) => { i.requestOutcomeUnknown = true; }],
    ];
    for (const [name, mutate] of cases) {
      await t.test(name, () => {
        const input = validContext(); mutate(input);
        ordinary(input, () => {
          const result = makePublicResult(input);
          assertShape(result);
          assert.equal(result.code, "INTERNAL_ERROR");
          assert.notEqual(result.status, "COMPLETED");
          assert.deepEqual(result.counts, input.counts);
        }, `incomplete success ${name}`);
      });
    }
  });
});
