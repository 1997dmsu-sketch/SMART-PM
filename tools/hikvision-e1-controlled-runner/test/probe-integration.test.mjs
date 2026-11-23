import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  installSideEffectGuard, descriptorSnapshot, assertDescriptorSnapshotUnchanged,
} from "./testkit.mjs";
import { makePublicResult, errorToCode } from "../public-result.mjs";

// CR-2 synthetic scenario tests. Every response body below is synthetic
// fixture data; nothing here is a real device, credential, certificate or
// approval, and no real network, file or process call is ever authorized.

const SIM_RESULT_SCHEMA = "hk-ai-08-cr2-simulation-result-v1";
const SIM_SCOPE = "cr2-synthetic-fixed-probe-only";
const IDS = ["deviceInfo", "acsCapabilities", "userInfoCapabilities", "fdlibCapabilities", "fdlibList", "fdlibCount"];
const TRACE_TYPES = [
  "CAPTURED", "CHECKER", "CHECKED", "PLAN_SEALED", "GATE_PREPARING",
  "SESSION_NEW", "SESSION_PREPARING", "SESSION_READY", "EVIDENCE_READY", "ARMED",
  "CONSUMED", "SYNTHETIC_MINT", "SESSION_ACTIVE", "INVOKE_CLAIM", "PROBE_INVOKE",
  "WRAPPER", "BOUNDARY_REJECT", "SYNTHETIC_DOWNSTREAM", "SUBMISSION_NOT_SENT",
  "SUBMISSION_CONFIRMED", "SUBMISSION_UNKNOWN", "RESPONSE", "MEMORY_WRITE",
  "MEMORY_READ", "BODY_VERIFIED", "IDENTITY_CONFIRMED", "CONTROL_UPDATED",
  "RESOURCE_INVALIDATED", "LATCH", "REPORT_SEALED", "SESSION_SEALED",
  "SESSION_CLOSED", "COMPLETED", "FAILED", "UNKNOWN", "INVALIDATED",
];
const DTO_KEYS = ["checks", "code", "counts", "endpoints", "evidenceRef", "planRef", "requestOutcomeUnknown", "schemaVersion", "scope", "status"];
const REQUEST_FAULT_CODES = {
  METHOD_POST: "REQUEST_OUT_OF_SCOPE",
  HOST_SWAP: "PLAN_INVALID",
  PORT_SWAP: "PLAN_INVALID",
  PATH_SWAP: "REQUEST_OUT_OF_SCOPE",
  QUERY_SWAP: "REQUEST_OUT_OF_SCOPE",
  PIN_SWAP: "PLAN_INVALID",
  TLS_CA: "PLAN_INVALID",
  TIMEOUT_SWAP: "PLAN_INVALID",
  MAXBYTES_SWAP: "PLAN_INVALID",
  ORDER_SWAP: "REQUEST_OUT_OF_SCOPE",
};

// Contract fixtures are deliberately separate from the production validators.
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

const CHALLENGE = `Digest realm="synthetic-device", nonce="synthetic-nonce-1", qop="auth", algorithm=MD5`;

function deviceInfoXml(model = "DS-K1T671BM") {
  return `<DeviceInfo xmlns="http://www.hikvision.com/ver20/XMLSchema">
<deviceName>SYNTHETIC_DEVICE_NAME_SENTINEL</deviceName>
<model>${model}</model>
<serialNumber>SYNTHETIC_SERIAL_SENTINEL</serialNumber>
<macAddress>SYNTHETIC_MAC_SENTINEL</macAddress>
<deviceType>accessControl</deviceType>
<firmwareVersion>SYNTHETIC_FIRMWARE_SENTINEL</firmwareVersion>
</DeviceInfo>`;
}

function acsCapabilitiesXml() {
  return `<Capabilities><isSupportFaceDetection>true</isSupportFaceDetection><isSupportFaceLibrary>true</isSupportFaceLibrary></Capabilities>`;
}

const BODIES = {
  deviceInfo: deviceInfoXml(),
  acsCapabilities: acsCapabilitiesXml(),
  userInfoCapabilities: `{"faceDetection": true}`,
  fdlibCapabilities: `{"facelibrary": true}`,
  fdlibList: `{"FDList": [{"name": "synthetic-lib", "faceLibType": "black", "count": 3}]}`,
  fdlibCount: `{"totalCount": 42}`,
};
const CONTENT_TYPES = {
  deviceInfo: "application/xml",
  acsCapabilities: "application/xml",
  userInfoCapabilities: "application/json",
  fdlibCapabilities: "application/json",
  fdlibList: "application/json",
  fdlibCount: "application/json",
};

function responseStep(endpointId, attempt, status, options = {}) {
  return {
    endpointId,
    attempt,
    outcome: {
      kind: "RESPONSE",
      status,
      contentType: options.contentType ?? CONTENT_TYPES[endpointId],
      challenge: options.challenge === undefined ? null : options.challenge,
      body: options.body === undefined ? BODIES[endpointId] : options.body,
    },
  };
}

function faultStep(endpointId, attempt, code, submission) {
  return { endpointId, attempt, outcome: { kind: "FAULT", code, submission } };
}

function scenario(steps, options = {}) {
  return {
    schemaVersion: "hk-ai-08-cr2-scenario-v1",
    steps,
    events: options.events ?? [],
    requestFault: options.requestFault ?? null,
  };
}

function successSteps() {
  return [
    responseStep("deviceInfo", 1, 200),
    responseStep("acsCapabilities", 1, 200),
    responseStep("userInfoCapabilities", 1, 200),
    responseStep("fdlibCapabilities", 1, 200),
    responseStep("fdlibList", 1, 200),
    responseStep("fdlibCount", 1, 200),
  ];
}

function scenarioBytes(scenarioInput) {
  return scenarioInput.steps.reduce((total, step) => {
    if (step.outcome.kind !== "RESPONSE") return total;
    const body = step.outcome.body;
    return total + (typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.byteLength);
  }, 0);
}

function assertEnvelopeShape(envelope) {
  assert.deepEqual(Reflect.ownKeys(envelope).sort(), ["result", "schemaVersion", "scope", "simulation", "trace"]);
  assert.equal(envelope.schemaVersion, SIM_RESULT_SCHEMA);
  assert.equal(envelope.scope, SIM_SCOPE);
  assert.deepEqual(Reflect.ownKeys(envelope.simulation).sort(),
    ["bytesWritten", "identityConfirmed", "invokeClaimed", "invokeCount", "recordCount"]);
  for (const [key, value] of Object.entries(envelope.simulation)) {
    if (key === "recordCount" || key === "bytesWritten" || key === "invokeCount") {
      assert.ok(Number.isSafeInteger(value) && value >= 0, `simulation ${key} is a safe count`);
    } else {
      assert.equal(typeof value, "boolean", `simulation ${key} is boolean`);
    }
  }
  for (const entry of envelope.trace) {
    assert.deepEqual(Reflect.ownKeys(entry).sort(), ["attempt", "endpointId", "type"]);
    assert.ok(TRACE_TYPES.includes(entry.type), `trace type in fixed enum: ${entry.type}`);
    assert.ok(entry.endpointId === null || IDS.includes(entry.endpointId), "trace endpointId is null or a fixed id");
    assert.ok(Number.isSafeInteger(entry.attempt) && entry.attempt >= 0 && entry.attempt <= 2, "trace attempt is 0..2");
  }
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.simulation), true);
  assert.equal(Object.isFrozen(envelope.trace), true);
}

function assertDtoShape(result) {
  assert.deepEqual(Reflect.ownKeys(result).sort(), [...DTO_KEYS].sort());
  assert.equal(result.schemaVersion, "controlled-e1-binding-v1");
  assert.equal(result.scope, "single-authorized-e1-read-only");
  assert.ok(["BLOCKED", "COMPLETED", "FAILED", "UNKNOWN"].includes(result.status));
  assert.ok(["OK", "CONFIG_UNVERIFIED", "APPROVAL_UNVERIFIED", "AUTHORIZATION_INVALID", "CONFIG_REJECTED",
    "RUNNER_MODEL_INCOMPATIBLE", "PLAN_INVALID", "EVIDENCE_GATE_UNVERIFIED", "EVIDENCE_GATE_FAILED",
    "EVIDENCE_GATE_INVALID", "PLAN_CONSUMED", "REQUEST_OUT_OF_SCOPE", "PROBE_FAILED",
    "REQUEST_OUTCOME_UNKNOWN", "EVIDENCE_WRITE_FAILED", "INTERNAL_ERROR"].includes(result.code));
  assert.equal(typeof result.requestOutcomeUnknown, "boolean");
  assert.equal(result.endpoints.length, 6);
  assert.deepEqual(result.endpoints.map((entry) => entry.id), IDS);
}

function assertCounts(counts, expected) {
  assert.deepEqual(counts, expected);
}

const FIXTURE_SENTINELS = [
  "SYNTHETIC_SERIAL_SENTINEL", "SYNTHETIC_MAC_SENTINEL", "SYNTHETIC_DEVICE_NAME_SENTINEL",
  "SYNTHETIC_FIRMWARE_SENTINEL", "SYNTHETIC_HOST_SENTINEL", "SYNTHETIC_MODEL_SENTINEL",
  "SYNTHETIC_PASSWORD_SENTINEL", "SYNTHETIC_AUTH_HEADER_SENTINEL", "SYNTHETIC_VENDOR_ERROR_SENTINEL",
];

function assertRedacted(value, label) {
  const json = JSON.stringify(value);
  for (const sentinel of FIXTURE_SENTINELS) {
    assert.equal(json.includes(sentinel), false, `${label} leaks ${sentinel}`);
  }
  assert.equal(json.includes("device.test"), false, `${label} leaks no target host`);
  assert.equal(json.includes("synthetic-user"), false, `${label} leaks no username`);
  assert.equal(json.includes("synthetic-secret"), false, `${label} leaks no password`);
}

describe("CR-2 synthetic probe wiring: fixed runProbe + non-forwarding transport", { concurrency: false }, () => {
  let guard;
  let baseline;
  let positiveCount;
  let fileCount;
  let createSyntheticProbeController;
  let binding;

  before(async () => {
    guard = installSideEffectGuard();
    ({ createSyntheticProbeController } = await import("../controlled-runner.mjs"));
    binding = await import("../probe-binding.mjs");
    // Preload the fixed new module tree in the load window. The owner's
    // prepare holds the only literal dynamic import of the probe binding;
    // warming that exact (private-plan, "./probe-binding.mjs") resolution pair
    // here makes every business-window prepare a pure resolution-cache hit
    // with zero loader fs calls. Load-window loader reads are excluded from
    // the zero data-I/O claim per the ruling, and the runtime fs guard is
    // installed only after this warm-up.
    const warmup = createSyntheticProbeController(fixture());
    warmup.check(control());
    await warmup.prepare({ fault: "NONE" });
    guard.assertLoadTimeClean();
    positiveCount = guard.positiveControls();
    fileCount = guard.installRuntimeFileGuard();
    baseline = guard.snapshot();
  });

  after(() => {
    try { guard.assertNoViolations(baseline, "entire probe-integration suite"); }
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

  async function ready(input = fixture()) {
    const controller = createSyntheticProbeController(input);
    assert.deepEqual(controller.check(control()), { ok: true, code: "OK", state: "SEALED" });
    assert.deepEqual(await controller.prepare({ fault: "NONE" }), { ok: true, code: "OK", state: "EVIDENCE_READY" });
    return controller;
  }

  async function armed(input = fixture()) {
    const controller = await ready(input);
    assert.deepEqual(controller.arm({ ...control(), confirmed: true }), { ok: true, code: "OK", state: "ARMED" });
    return controller;
  }

  test("CR2-GUARD new import tree loads clean and every no-forward control retained", (t) => {
    assert.ok(positiveCount > 0);
    assert.ok(fileCount > 0);
    const load = guard.loadTimeSnapshot();
    assert.ok(Object.keys(load).length > 0);
    assert.ok(Object.values(load).every((count) => count === 0), "vendor/binding load-time side effects are zero");
    assert.ok(Object.values(baseline).every((count) => count >= 1), "cumulative baseline counts after positive controls");
    const labels = guard.labels().join("\n");
    for (const name of ["fetch", "Socket", "listen", "tls", "dgram", "dns.promises", "child_process", "fs", "https.request", "https.get"]) {
      assert.ok(labels.includes(name), `actual guard inventory contains ${name}`);
    }
    const bindingKeys = Reflect.ownKeys(binding).filter((key) => typeof key === "string");
    assert.deepEqual(bindingKeys.sort(), ["endpointIdForPath", "fixedEndpoints", "fixedProbe", "requestPathFor"],
      "probe-binding exposes only fixed references and pure data helpers");
    assert.deepEqual(Reflect.ownKeys(binding.fixedProbe).sort(),
      ["assertContentType", "parseChallenge", "parseDeviceInfo", "runProbe"]);
    assert.equal(binding.fixedEndpoints.length, 6);
    assert.deepEqual(binding.fixedEndpoints.map((entry) => entry.id), IDS);
    assert.equal(binding.endpointIdForPath("/ISAPI/System/deviceInfo"), "deviceInfo");
    assert.equal(binding.endpointIdForPath("/ISAPI/AccessControl/UserInfo/capabilities?format=json"), "userInfoCapabilities");
    assert.equal(binding.endpointIdForPath("/ISAPI/System/anything-else"), null);
    assert.equal(binding.requestPathFor("fdlibCount"), "/ISAPI/Intelligent/FDLib/Count?format=json");
    guard.assertNoViolations(baseline, "binding guard self-check");
    t.diagnostic(JSON.stringify({ counts: guard.counts(), labels: guard.labels(), loadTime: guard.loadTimeSnapshot() }));
  });

  test("T14 six-endpoint success: unique invoke, 6 logical/6 downstream/6 confirmed, synthetic COMPLETED", async () => {
    const input = fixture();
    const script = scenario(successSteps());
    await unchanged(input, async () => {
      const controller = await armed(input);
      const envelope = await controller.invokeScenario(script);
      assertEnvelopeShape(envelope);
      const result = envelope.result;
      assertDtoShape(result);
      assert.equal(result.status, "COMPLETED");
      assert.equal(result.code, "OK");
      assert.ok(/^plan-[0-9a-f-]{36}$/.test(result.planRef), "plan ref is the fixed random form");
      assert.ok(/^evidence-[0-9a-f-]{36}$/.test(result.evidenceRef), "evidence ref is the fixed random form");
      assert.deepEqual(result.checks, {
        checkerPassed: true, runnerCompatible: true, evidenceGateVerified: true, singleUseConsumed: true,
      });
      assertCounts(result.counts, {
        logicalEndpointsAttempted: 6, wrapperAttemptCount: 6, transportInvocationCount: 6, confirmedResponses: 6,
      });
      assert.equal(result.requestOutcomeUnknown, false);
      assert.deepEqual(result.endpoints.map((entry) => entry.state), ["OK", "OK", "OK", "OK", "OK", "OK"]);
      assert.deepEqual(envelope.simulation, {
        invokeClaimed: true, invokeCount: 1, identityConfirmed: true,
        recordCount: 6, bytesWritten: scenarioBytes(script),
      });
      const types = envelope.trace.map((entry) => entry.type);
      assert.equal(types.filter((type) => type === "PROBE_INVOKE").length, 1, "the fixed runProbe was invoked exactly once");
      assert.equal(types.filter((type) => type === "INVOKE_CLAIM").length, 1, "the invoke claim happened exactly once");
      assert.equal(types.filter((type) => type === "IDENTITY_CONFIRMED").length, 1);
      assert.equal(types.includes("REPORT_SEALED"), true);
      assert.equal(types.includes("SESSION_SEALED"), true);
      assert.equal(types.includes("SESSION_CLOSED"), true);
      assert.equal(types[types.length - 1], "COMPLETED");
      const invoke = types.indexOf("PROBE_INVOKE");
      assert.ok(types.indexOf("INVOKE_CLAIM") < invoke, "claim precedes the probe invoke");
      const snapshot = controller.snapshot();
      assert.equal(snapshot.scope, SIM_SCOPE);
      assert.equal(snapshot.state, "COMPLETED");
      assert.equal(snapshot.invokeCount, 1);
      assert.equal(snapshot.transportInvocationCount, 6);
      assertRedacted(envelope, "success envelope");
      assertRedacted(snapshot, "success snapshot");
    }, "T14 full success");
  });

  test("T14 first legal 401: challenge retry, seven downstream and six logical endpoints, still COMPLETED", async () => {
    const input = fixture();
    const steps = [
      responseStep("deviceInfo", 1, 401, { challenge: CHALLENGE, body: "" }),
      responseStep("deviceInfo", 2, 200),
      ...successSteps().slice(1),
    ];
    const script = scenario(steps);
    await unchanged(input, async () => {
      const controller = await armed(input);
      const envelope = await controller.invokeScenario(script);
      assertEnvelopeShape(envelope);
      assert.equal(envelope.result.status, "COMPLETED");
      assert.equal(envelope.result.code, "OK");
      assertCounts(envelope.result.counts, {
        logicalEndpointsAttempted: 6, wrapperAttemptCount: 7, transportInvocationCount: 7, confirmedResponses: 7,
      });
      assert.equal(envelope.simulation.identityConfirmed, true);
      assert.equal(envelope.simulation.recordCount, 7);
      assert.equal(envelope.simulation.bytesWritten, scenarioBytes(script));
      const deviceInfoEvents = envelope.trace.filter((entry) => entry.endpointId === "deviceInfo");
      assert.equal(deviceInfoEvents.filter((entry) => entry.type === "RESPONSE").length, 2);
      assert.equal(deviceInfoEvents.some((entry) => entry.type === "IDENTITY_CONFIRMED" && entry.attempt === 2), true);
      guard.assertNoViolations(baseline, "401 challenge");
    }, "T14 legal first 401");
  });

  test("NA11 every endpoint may use its single legal 401 once: twelve downstream at most, COMPLETED", async () => {
    const input = fixture();
    const steps = IDS.flatMap((id) => [
      responseStep(id, 1, 401, { challenge: CHALLENGE, body: "" }),
      responseStep(id, 2, 200),
    ]);
    const script = scenario(steps);
    await unchanged(input, async () => {
      const controller = await armed(input);
      const envelope = await controller.invokeScenario(script);
      assertEnvelopeShape(envelope);
      assert.equal(envelope.result.status, "COMPLETED");
      assertCounts(envelope.result.counts, {
        logicalEndpointsAttempted: 6, wrapperAttemptCount: 12, transportInvocationCount: 12, confirmedResponses: 12,
      });
      assert.equal(envelope.simulation.recordCount, 12);
      assert.equal(envelope.simulation.identityConfirmed, true);
    }, "per-endpoint single challenge");
  });

  test("NA11 second 401 rejects without further sends", async () => {
    const input = fixture();
    const steps = [
      responseStep("deviceInfo", 1, 401, { challenge: CHALLENGE, body: "" }),
      responseStep("deviceInfo", 2, 401, { challenge: CHALLENGE, body: "" }),
      ...successSteps().slice(1),
    ];
    const script = scenario(steps);
    await unchanged(input, async () => {
      const controller = await armed(input);
      const envelope = await controller.invokeScenario(script);
      assertEnvelopeShape(envelope);
      assert.equal(envelope.result.status, "FAILED");
      assert.equal(envelope.result.code, "PROBE_FAILED");
      assertCounts(envelope.result.counts, {
        logicalEndpointsAttempted: 1, wrapperAttemptCount: 2, transportInvocationCount: 2, confirmedResponses: 2,
      });
      assert.equal(envelope.simulation.identityConfirmed, false);
      assert.deepEqual(envelope.result.endpoints.map((entry) => entry.state),
        ["FAILED", "NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED"]);
    }, "second 401 rejected");
  });

  test("T15 G1 final non-200 latches with G1 facts kept and G2-G6 downstream zero", async () => {
    const input = fixture();
    const steps = [
      responseStep("deviceInfo", 1, 403, { body: "<error>synthetic-forbidden</error>" }),
      ...successSteps().slice(1),
    ];
    const script = scenario(steps);
    await unchanged(input, async () => {
      const controller = await armed(input);
      const envelope = await controller.invokeScenario(script);
      assertEnvelopeShape(envelope);
      assert.equal(envelope.result.status, "FAILED");
      assert.equal(envelope.result.code, "PROBE_FAILED");
      assertCounts(envelope.result.counts, {
        logicalEndpointsAttempted: 1, wrapperAttemptCount: 6, transportInvocationCount: 1, confirmedResponses: 1,
      });
      assert.equal(envelope.simulation.identityConfirmed, false);
      assert.equal(envelope.simulation.recordCount, 1, "G1 response facts are kept");
      assert.deepEqual(envelope.result.endpoints.map((entry) => entry.state),
        ["FAILED", "NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED"]);
      const types = envelope.trace.map((entry) => entry.type);
      assert.equal(types.includes("LATCH"), true);
      assert.equal(types.filter((type) => type === "BOUNDARY_REJECT").length, 6,
        "the G1 latch itself and every later wrapper call are boundary rejections");
    }, "T15 G1 non-200 latch");
  });

  test("T15 G1 200 with missing or wrong model latches identity and never reaches G2-G6", async (t) => {
    for (const kind of ["wrong-model", "unparsable-model"]) {
      await t.test(kind, async () => {
        const input = fixture();
        const body = kind === "wrong-model" ? deviceInfoXml("SYNTHETIC-WRONG-MODEL") : "<DeviceInfo><deviceName>no-model</deviceName></DeviceInfo>";
        const steps = [responseStep("deviceInfo", 1, 200, { body }), ...successSteps().slice(1)];
        const script = scenario(steps);
        await unchanged(input, async () => {
          const controller = await armed(input);
          const envelope = await controller.invokeScenario(script);
          assertEnvelopeShape(envelope);
          assert.equal(envelope.result.status, "FAILED");
          assert.equal(envelope.result.code, "PROBE_FAILED");
          assertCounts(envelope.result.counts, {
            logicalEndpointsAttempted: 1, wrapperAttemptCount: 6, transportInvocationCount: 1, confirmedResponses: 1,
          });
          assert.equal(envelope.simulation.identityConfirmed, false);
          assert.equal(envelope.simulation.recordCount, 1);
        }, `G1 ${kind}`);
      });
    }
  });

  test("NA11 G2-G6 non-200 follow the fixed loop without full-round retry and end PROBE_FAILED", async () => {
    const input = fixture();
    const steps = [
      responseStep("deviceInfo", 1, 200),
      responseStep("acsCapabilities", 1, 500, { body: "<error>synthetic-server-error</error>" }),
      ...successSteps().slice(2),
    ];
    const script = scenario(steps);
    await unchanged(input, async () => {
      const controller = await armed(input);
      const envelope = await controller.invokeScenario(script);
      assertEnvelopeShape(envelope);
      assert.equal(envelope.result.status, "FAILED");
      assert.equal(envelope.result.code, "PROBE_FAILED");
      assert.equal(envelope.result.requestOutcomeUnknown, false);
      assertCounts(envelope.result.counts, {
        logicalEndpointsAttempted: 6, wrapperAttemptCount: 6, transportInvocationCount: 6, confirmedResponses: 6,
      });
      assert.equal(envelope.simulation.identityConfirmed, true);
      assert.equal(envelope.simulation.recordCount, 6, "non-200 bodies are also recorded");
      assert.deepEqual(envelope.result.endpoints.map((entry) => entry.state),
        ["OK", "FAILED", "OK", "OK", "OK", "OK"]);
      assert.equal(envelope.result.checks.evidenceGateVerified, true, "the memory gate lifecycle still completed");
      const types = envelope.trace.map((entry) => entry.type);
      assert.equal(types.includes("LATCH"), false, "G2-G6 HTTP failures are endpoint facts, not latches");
    }, "G2-G6 non-200 semantics");
  });

  test("T15 request tampering: every fixed perturbation is rejected with a fixed code and zero downstream", async (t) => {
    for (const [kind, expectedCode] of Object.entries(REQUEST_FAULT_CODES)) {
      await t.test(kind, async () => {
        const input = fixture();
        const script = scenario(successSteps(), { requestFault: { atWrapper: 1, kind } });
        await unchanged(input, async () => {
          const controller = await armed(input);
          const envelope = await controller.invokeScenario(script);
          assertEnvelopeShape(envelope);
          assert.equal(envelope.result.status, "FAILED");
          assert.equal(envelope.result.code, expectedCode);
          assertCounts(envelope.result.counts, {
            logicalEndpointsAttempted: 0, wrapperAttemptCount: 6, transportInvocationCount: 0, confirmedResponses: 0,
          });
          assert.equal(envelope.simulation.invokeClaimed, true);
          assert.equal(envelope.simulation.invokeCount, 1);
          assert.deepEqual(envelope.result.endpoints.map((entry) => entry.state),
            ["NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED"]);
        }, `requestFault ${kind}`);
      });
    }
  });

  test("T17 revocation/expiry before the first request and between responses reject without downstream", async (t) => {
    await t.test("before-first-request", async () => {
      const input = fixture();
      await unchanged(input, async () => {
        const controller = await armed(input);
        assert.deepEqual(controller.setControl(control({ revoked: true })), { ok: false, code: "AUTHORIZATION_INVALID", state: "INVALIDATED" });
        const envelope = await controller.invokeScenario(scenario(successSteps()));
        assertEnvelopeShape(envelope);
        assert.equal(envelope.result.status, "FAILED");
        assert.equal(envelope.result.code, "AUTHORIZATION_INVALID");
        assertCounts(envelope.result.counts, {
          logicalEndpointsAttempted: 0, wrapperAttemptCount: 0, transportInvocationCount: 0, confirmedResponses: 0,
        });
        assert.equal(envelope.simulation.invokeCount, 0);
        assert.equal(envelope.simulation.invokeClaimed, false);
      }, "pre-first-request revocation");
    });

    for (const [name, event, expectedCode] of [
      ["between-responses-revoke", { afterResponse: 2, kind: "CONTROL", control: { ...control(), revoked: true } }, "AUTHORIZATION_INVALID"],
      ["between-responses-expiry", { afterResponse: 2, kind: "CONTROL", control: { ...control(), nowMs: 10000 } }, "AUTHORIZATION_INVALID"],
      ["between-responses-fresh-false", { afterResponse: 2, kind: "CONTROL", control: { ...control(), fresh: false } }, "APPROVAL_UNVERIFIED"],
      ["between-responses-resource-invalidated", { afterResponse: 1, kind: "RESOURCE_INVALIDATED" }, "EVIDENCE_GATE_INVALID"],
    ]) {
      await t.test(name, async () => {
        const input = fixture();
        const script = scenario(successSteps(), { events: [event] });
        await unchanged(input, async () => {
          const controller = await armed(input);
          const envelope = await controller.invokeScenario(script);
          assertEnvelopeShape(envelope);
          assert.equal(envelope.result.status, "FAILED");
          assert.equal(envelope.result.code, expectedCode);
          const after = event.afterResponse;
          // The fixed vendor loop still attempts the remaining endpoints, so
          // every later wrapper call is counted and then rejected by the latch.
          assertCounts(envelope.result.counts, {
            logicalEndpointsAttempted: after, wrapperAttemptCount: 6,
            transportInvocationCount: after, confirmedResponses: after,
          });
          const types = envelope.trace.map((entry) => entry.type);
          assert.equal(types.includes("LATCH"), true);
          assert.equal(types.filter((type) => type === "BOUNDARY_REJECT").length, 6 - after);
        }, `event ${name}`);
      });
    }
  });

  test("T17 in-flight invalidation and revocation make the window result sticky-UNKNOWN", async (t) => {
    for (const kind of ["invalidate", "revoke"]) {
      await t.test(kind, async () => {
        const input = fixture();
        const script = scenario(successSteps());
        await unchanged(input, async () => {
          const controller = await armed(input);
          const pending = controller.invokeScenario(script);
          if (kind === "invalidate") controller.invalidate();
          else controller.setControl(control({ revoked: true }));
          const envelope = await pending;
          assertEnvelopeShape(envelope);
          assert.equal(envelope.result.status, "UNKNOWN", "the in-window change makes the outcome unknown");
          assert.equal(envelope.result.requestOutcomeUnknown, true);
          assert.equal(envelope.result.code, "AUTHORIZATION_INVALID", "the earlier terminal cause is kept");
          assertCounts(envelope.result.counts, {
            logicalEndpointsAttempted: 1, wrapperAttemptCount: 6, transportInvocationCount: 1, confirmedResponses: 0,
          });
          assert.equal(envelope.simulation.recordCount, 0, "the unconfirmed in-flight body is not recorded");
          assert.equal(envelope.simulation.identityConfirmed, false);
          assert.deepEqual(envelope.result.endpoints.map((entry) => entry.state),
            ["UNKNOWN", "NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED"]);
        }, `in-flight ${kind}`);
      });
    }
  });

  test("T18 write/read/report-seal/cleanup faults: EVIDENCE_WRITE_FAILED, facts kept, no downstream continuation", async (t) => {
    await t.test("WRITE", async () => {
      const input = fixture();
      await unchanged(input, async () => {
        const controller = createSyntheticProbeController(input);
        controller.check(control());
        assert.deepEqual(await controller.prepare({ fault: "WRITE" }),
          { ok: true, code: "OK", state: "EVIDENCE_READY" }, "WRITE is a runtime fault, not a preflight one");
        assert.deepEqual(controller.arm({ ...control(), confirmed: true }), { ok: true, code: "OK", state: "ARMED" });
        const envelope = await controller.invokeScenario(scenario(successSteps()));
        assertEnvelopeShape(envelope);
        assert.equal(envelope.result.status, "FAILED");
        assert.equal(envelope.result.code, "EVIDENCE_WRITE_FAILED");
        assertCounts(envelope.result.counts, {
          logicalEndpointsAttempted: 1, wrapperAttemptCount: 6, transportInvocationCount: 1, confirmedResponses: 0,
        });
        assert.equal(envelope.simulation.recordCount, 0);
      }, "write fault");
    });
    await t.test("READ", async () => {
      const input = fixture();
      await unchanged(input, async () => {
        const controller = createSyntheticProbeController(input);
        controller.check(control());
        assert.deepEqual(await controller.prepare({ fault: "READ" }),
          { ok: true, code: "OK", state: "EVIDENCE_READY" }, "READ is a runtime fault, not a preflight one");
        assert.deepEqual(controller.arm({ ...control(), confirmed: true }), { ok: true, code: "OK", state: "ARMED" });
        const envelope = await controller.invokeScenario(scenario(successSteps()));
        assertEnvelopeShape(envelope);
        assert.equal(envelope.result.status, "FAILED");
        assert.equal(envelope.result.code, "EVIDENCE_WRITE_FAILED");
        assertCounts(envelope.result.counts, {
          logicalEndpointsAttempted: 1, wrapperAttemptCount: 6, transportInvocationCount: 1, confirmedResponses: 0,
        });
        assert.equal(envelope.simulation.recordCount, 1, "read-fault keeps the stored record");
        assert.equal(envelope.simulation.bytesWritten, Buffer.byteLength(BODIES.deviceInfo, "utf8"));
      }, "read fault");
    });
    await t.test("REPORT_SEAL", async () => {
      const input = fixture();
      const script = scenario(successSteps());
      await unchanged(input, async () => {
        const controller = createSyntheticProbeController(input);
        controller.check(control());
        assert.deepEqual(await controller.prepare({ fault: "REPORT_SEAL" }),
          { ok: true, code: "OK", state: "EVIDENCE_READY" }, "REPORT_SEAL is a legal runtime fault, not a preflight one");
        assert.deepEqual(controller.arm({ ...control(), confirmed: true }), { ok: true, code: "OK", state: "ARMED" });
        const envelope = await controller.invokeScenario(script);
        assertEnvelopeShape(envelope);
        assert.equal(envelope.result.status, "FAILED");
        assert.equal(envelope.result.code, "EVIDENCE_WRITE_FAILED");
        assertCounts(envelope.result.counts, {
          logicalEndpointsAttempted: 6, wrapperAttemptCount: 6, transportInvocationCount: 6, confirmedResponses: 6,
        });
        assert.equal(envelope.simulation.recordCount, 6);
        assert.equal(envelope.simulation.bytesWritten, scenarioBytes(script));
        assert.equal(envelope.result.checks.evidenceGateVerified, false);
        const types = envelope.trace.map((entry) => entry.type);
        assert.equal(types.includes("REPORT_SEALED"), false, "the original report is never sealed on REPORT_SEAL fault");
      }, "report seal fault");
    });
    await t.test("CLEANUP", async () => {
      const input = fixture();
      const script = scenario(successSteps());
      await unchanged(input, async () => {
        const controller = createSyntheticProbeController(input);
        controller.check(control());
        assert.deepEqual(await controller.prepare({ fault: "CLEANUP" }),
          { ok: true, code: "OK", state: "EVIDENCE_READY" }, "CLEANUP is a runtime fault, not a preflight one");
        assert.deepEqual(controller.arm({ ...control(), confirmed: true }), { ok: true, code: "OK", state: "ARMED" });
        const envelope = await controller.invokeScenario(script);
        assertEnvelopeShape(envelope);
        assert.equal(envelope.result.status, "FAILED");
        assert.equal(envelope.result.code, "EVIDENCE_WRITE_FAILED");
        assertCounts(envelope.result.counts, {
          logicalEndpointsAttempted: 6, wrapperAttemptCount: 6, transportInvocationCount: 6, confirmedResponses: 6,
        });
        assert.equal(envelope.simulation.recordCount, 6, "cleanup failure does not rewrite history");
        assert.equal(envelope.result.checks.evidenceGateVerified, false);
        const types = envelope.trace.map((entry) => entry.type);
        assert.equal(types.includes("SESSION_SEALED"), true);
        assert.equal(types.includes("SESSION_CLOSED"), false, "close is not claimed after cleanup failure");
      }, "cleanup fault");
    });
  });

  test("E14 fault submissions: confirmed/unknown submissions stay UNKNOWN and sticky; NOT_SUBMITTED never zeroes counts", async (t) => {
    for (const [name, code, submission, expectedStatus, expectedCode, expectedUnknown] of [
      ["NOT_SUBMITTED/NETWORK", "NETWORK", "NOT_SUBMITTED", "FAILED", "PROBE_FAILED", false],
      ["CONFIRMED_SUBMITTED/TIMEOUT", "TIMEOUT", "CONFIRMED_SUBMITTED", "UNKNOWN", "REQUEST_OUTCOME_UNKNOWN", true],
      ["CONFIRMED_SUBMITTED/RESPONSE_ERROR", "RESPONSE_ERROR", "CONFIRMED_SUBMITTED", "UNKNOWN", "REQUEST_OUTCOME_UNKNOWN", true],
      ["UNKNOWN/FINGERPRINT_MISMATCH", "FINGERPRINT_MISMATCH", "UNKNOWN", "UNKNOWN", "REQUEST_OUTCOME_UNKNOWN", true],
    ]) {
      await t.test(name, async () => {
        const input = fixture();
        const steps = [responseStep("deviceInfo", 1, 200), faultStep("acsCapabilities", 1, code, submission)];
        const script = scenario(steps);
        await unchanged(input, async () => {
          const controller = await armed(input);
          const envelope = await controller.invokeScenario(script);
          assertEnvelopeShape(envelope);
          assert.equal(envelope.result.status, expectedStatus);
          assert.equal(envelope.result.code, expectedCode);
          assert.equal(envelope.result.requestOutcomeUnknown, expectedUnknown);
          assertCounts(envelope.result.counts, {
            logicalEndpointsAttempted: 2, wrapperAttemptCount: 2, transportInvocationCount: 2, confirmedResponses: 1,
          }, "already-counted downstream calls are never zeroed");
          assert.equal(envelope.simulation.recordCount, 1);
          assert.equal(envelope.simulation.identityConfirmed, true);
          assert.deepEqual(envelope.result.endpoints.map((entry) => entry.state),
            ["OK", expectedUnknown ? "UNKNOWN" : "FAILED", "NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED"]);
          const types = envelope.trace.map((entry) => entry.type);
          if (submission === "NOT_SUBMITTED") assert.equal(types.includes("SUBMISSION_NOT_SENT"), true);
          else if (submission === "CONFIRMED_SUBMITTED") assert.equal(types.includes("SUBMISSION_CONFIRMED"), true);
          else assert.equal(types.includes("SUBMISSION_UNKNOWN"), true);
        }, `submission ${name}`);
      });
    }
  });

  test("T13 concurrent invoke: one claim and one fixed P call; no manual consumption interface", async () => {
    const input = fixture();
    const script = scenario(successSteps());
    await unchanged(input, async () => {
      const controller = await armed(input);
      assert.deepEqual(Object.keys(controller).sort(),
        ["arm", "check", "invalidate", "invokeScenario", "prepare", "setControl", "snapshot"],
        "the new factory exposes exactly the fixed seven-method surface");
      const [first, second] = await Promise.all([
        controller.invokeScenario(script),
        controller.invokeScenario(script),
      ]);
      assertEnvelopeShape(first);
      assertEnvelopeShape(second);
      assert.equal(first.result.status, "COMPLETED");
      assert.equal(second.result.status, "FAILED");
      assert.equal(second.result.code, "PLAN_CONSUMED");
      assert.equal(second.simulation.invokeClaimed, true, "the profile reports the one existing claim made by the winner");
      assert.equal(second.simulation.invokeCount, 1, "the rejected caller never increments the single invoke count");
      assertCounts(first.result.counts, {
        logicalEndpointsAttempted: 6, wrapperAttemptCount: 6, transportInvocationCount: 6, confirmedResponses: 6,
      });
      assert.equal(controller.snapshot().invokeCount, 1, "only one invoke was ever counted");
      const third = await controller.invokeScenario(script);
      assert.equal(third.result.status, "FAILED");
      assert.equal(third.result.code, "PLAN_CONSUMED", "a consumed plan can never be re-invoked");
    }, "T13 unique invoke");
  });

  test("hostile scenarios are rejected with CONFIG_UNVERIFIED before any execution right", async (t) => {
    const cases = [
      ["wrong-schema", (s) => { s.schemaVersion = "synthetic-schema"; }],
      ["empty-steps", (s) => { s.steps = []; }],
      ["thirteen-steps", (s) => { s.steps = Array.from({ length: 13 }, (_, i) => ({ endpointId: IDS[i % 6], attempt: 1, outcome: { kind: "RESPONSE", status: 200, contentType: "application/xml", challenge: null, body: "" } })); }],
      ["hole-steps", (s) => { s.steps = Array(2); }],
      ["unknown-endpoint", (s) => { s.steps[0].endpointId = "synthetic-arbitrary"; }],
      ["attempt-zero", (s) => { s.steps[0].attempt = 0; }],
      ["attempt-three", (s) => { s.steps[0].attempt = 3; }],
      ["attempt-fraction", (s) => { s.steps[0].attempt = 1.5; }],
      ["status-99", (s) => { s.steps[0].outcome.status = 99; }],
      ["status-600", (s) => { s.steps[0].outcome.status = 600; }],
      ["status-string", (s) => { s.steps[0].outcome.status = "200"; }],
      ["content-type-too-long", (s) => { s.steps[0].outcome.contentType = "x".repeat(129); }],
      ["challenge-too-long", (s) => { s.steps[0].outcome.challenge = "x".repeat(4097); }],
      ["body-function", (s) => { s.steps[0].outcome.body = () => "synthetic"; }],
      ["body-object", (s) => { s.steps[0].outcome.body = { raw: "not-bytes" }; }],
      ["body-too-large", (s) => { s.steps[0].outcome.body = "x".repeat(262145); }],
      ["unknown-fault-code", (s) => { s.steps[0].outcome = { kind: "FAULT", code: "SYNTHETIC_FAULT", submission: "UNKNOWN" }; }],
      ["unknown-submission", (s) => { s.steps[0].outcome = { kind: "FAULT", code: "NETWORK", submission: "SYNTHETIC_SUBMISSION" }; }],
      ["event-after-zero", (s) => { s.events = [{ afterResponse: 0, kind: "RESOURCE_INVALIDATED" }]; }],
      ["event-beyond-steps", (s) => { s.events = [{ afterResponse: 7, kind: "RESOURCE_INVALIDATED" }]; }],
      ["event-duplicate-ordinal", (s) => { s.events = [{ afterResponse: 1, kind: "RESOURCE_INVALIDATED" }, { afterResponse: 1, kind: "RESOURCE_INVALIDATED" }]; }],
      ["event-descending", (s) => { s.events = [{ afterResponse: 2, kind: "RESOURCE_INVALIDATED" }, { afterResponse: 1, kind: "RESOURCE_INVALIDATED" }]; }],
      ["event-unknown-kind", (s) => { s.events = [{ afterResponse: 1, kind: "SYNTHETIC_EVENT" }]; }],
      ["event-control-extra-key", (s) => { s.events = [{ afterResponse: 1, kind: "CONTROL", control: { ...control(), confirmed: true } }]; }],
      ["request-fault-zero", (s) => { s.requestFault = { atWrapper: 0, kind: "PATH_SWAP" }; }],
      ["request-fault-thirteen", (s) => { s.requestFault = { atWrapper: 13, kind: "PATH_SWAP" }; }],
      ["request-fault-unknown-kind", (s) => { s.requestFault = { atWrapper: 1, kind: "SYNTHETIC_FAULT" }; }],
      ["hidden-key", (s) => { Object.defineProperty(s, "hidden", { value: "synthetic" }); }],
      ["symbol-key", (s) => { s[Symbol("extra")] = "synthetic"; }],
      ["steps-getter", (s, c) => {
        Object.defineProperty(s, "steps", { enumerable: true, get() { c.getters += 1; throw new Error("SYNTHETIC_GETTER"); } });
      }],
      ["steps-proxy", (s, c) => {
        s.steps = new Proxy(s.steps, {
          get() { c.traps += 1; throw new Error("SYNTHETIC_TRAP"); },
          ownKeys() { c.traps += 1; throw new Error("SYNTHETIC_TRAP"); },
          getOwnPropertyDescriptor() { c.traps += 1; throw new Error("SYNTHETIC_TRAP"); },
          getPrototypeOf() { c.traps += 1; throw new Error("SYNTHETIC_TRAP"); },
        });
      }],
      ["body-getter", (s, c) => {
        Object.defineProperty(s.steps[0].outcome, "body", { enumerable: true, get() { c.getters += 1; throw new Error("SYNTHETIC_GETTER"); } });
      }],
      ["step-hidden", (s) => { Object.defineProperty(s.steps[0], "hidden", { value: undefined }); }],
      ["step-symbol", (s) => { s.steps[0][Symbol("extra")] = undefined; }],
    ];
    for (const [name, mutate] of cases) {
      await t.test(name, async () => {
        const input = fixture();
        const hostile = scenario(successSteps());
        const counters = { getters: 0, traps: 0 };
        mutate(hostile, counters);
        const beforeSnapshot = descriptorSnapshot(hostile);
        await unchanged(input, async () => {
          const controller = await armed(input);
          const envelope = await controller.invokeScenario(hostile);
          assertEnvelopeShape(envelope);
          assert.equal(envelope.result.status, "FAILED");
          assert.equal(envelope.result.code, "CONFIG_UNVERIFIED");
          assertCounts(envelope.result.counts, {
            logicalEndpointsAttempted: 0, wrapperAttemptCount: 0, transportInvocationCount: 0, confirmedResponses: 0,
          });
          assert.equal(envelope.simulation.invokeCount, 0, "no execution right was created");
          assert.equal(envelope.simulation.invokeClaimed, false);
          assert.equal(envelope.simulation.recordCount, 0);
          assert.equal(counters.getters, 0);
          assert.equal(counters.traps, 0);
        }, `hostile scenario ${name}`);
        assertDescriptorSnapshotUnchanged(hostile, beforeSnapshot);
      });
    }
  });

  test("T19 closed DTO redaction: synthetic projection never carries target, credentials, raw bodies or raw report", async () => {
    const input = fixture();
    const script = scenario(successSteps());
    await unchanged(input, async () => {
      const controller = await armed(input);
      const envelope = await controller.invokeScenario(script);
      assertEnvelopeShape(envelope);
      assertRedacted(envelope, "COMPLETED envelope");
      assertRedacted(controller.snapshot(), "COMPLETED snapshot");
    }, "closed synthetic output");

    const rawReport = {
      generatedAt: "2026-11-23T00:00:00.000Z",
      aborted: null,
      target: { host: "SYNTHETIC_HOST_SENTINEL", port: 443, hostFingerprint: "SYNTHETIC_HASH_SENTINEL" },
      device: { model: "SYNTHETIC_MODEL_SENTINEL", serialNumber: "SYNTHETIC_SERIAL_SENTINEL" },
      capabilities: {},
      counts: {},
      checks: [],
      blockers: [],
      warnings: [],
    };
    const rawBefore = descriptorSnapshot(rawReport);
    const rejected = makePublicResult(rawReport);
    assertDtoShape(rejected);
    assert.equal(rejected.code, "INTERNAL_ERROR");
    assert.notEqual(rejected.status, "COMPLETED");
    assertRedacted(rejected, "raw-report negative");
    assertDescriptorSnapshotUnchanged(rawReport, rawBefore);
    const vendorError = new Error("SYNTHETIC_VENDOR_ERROR_SENTINEL");
    vendorError.code = "NETWORK";
    assert.equal(errorToCode(vendorError), "INTERNAL_ERROR", "vendor-only codes never enter the public DTO");
    guard.assertNoViolations(baseline, "DTO redaction");
  });
});
