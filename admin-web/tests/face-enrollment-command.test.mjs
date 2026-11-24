import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { runFaceEnrollment } from "../lib/face-enrollment-command.mjs";
import { FaceEnrollmentService, SimulatedFaceProvider, FACE_PHOTO_LIMIT } from "../lib/face-enrollment.mjs";
import { HttpError } from "../lib/model.mjs";
import { SYNTHETIC_CERT } from "./fixtures/hikvision-synthetic-certificates.mjs";

// Synthetic framing only; no person's photo and no network transport is used.
const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0, 1, 0xff, 0xd9]);
const now = () => new Date("2026-11-23T16:30:00Z");
const randomBytes = size => { assert.equal(size, 7); return Buffer.from("01020304050607", "hex"); };
const input = overrides => ({ name: "合成命令测试人员", room: "TEST1205", photoPath: "C:/synthetic/private/photo.jpg", consent: true, ...overrides });
const deviceInput = overrides => input({
  mode: "device", origin: "https://synthetic.invalid", username: "synthetic-device-admin", password: "synthetic-device-password-only",
  certificatePath: "C:/synthetic/private/public.cer", ...overrides,
});

function fixture({ provider = new SimulatedFaceProvider(), photoBytes = photo, certificateBytes = Buffer.from(SYNTHETIC_CERT), model = "DS-K1T671BM", connect, enroll, close } = {}) {
  const observed = { reads: [], buffers: [], connects: [], enrollments: [], closes: 0, creates: 0, providerConfigs: [] };
  const describe = provider.describe.bind(provider);
  provider.describe = async () => { const state = await describe(); state.device = { ...state.device, model, firmware: "V3.3.180" }; return state; };
  const deps = {
    now, randomBytes, platform: "win32",
    async readInputFile(path, options) {
      observed.reads.push({ path, ...options });
      const bytes = Buffer.from(options.kind === "certificate" ? certificateBytes : photoBytes);
      observed.buffers.push(bytes);
      return bytes;
    },
    createService() {
      observed.creates += 1;
      const service = new FaceEnrollmentService({ providerFactory: config => { observed.providerConfigs.push(config); return provider; } });
      return {
        async connect(config) { observed.connects.push(config); return connect ? connect(config) : service.connect(config); },
        async enroll(values) { observed.enrollments.push(values); return enroll ? enroll(values) : service.enroll(values); },
        close() { observed.closes += 1; service.close(); if (close) return close(); },
      };
    },
  };
  return { deps, observed, provider };
}

function assertNoSecrets(result, values = deviceInput()) {
  const serialized = JSON.stringify(result);
  for (const secret of [values.username, values.password, values.photoPath, values.certificatePath, photo.toString("base64"), SYNTHETIC_CERT])
    if (secret) assert.ok(!serialized.includes(secret), "output contained synthetic credential/photo/path material");
  const forbidden = new Set(["username", "password", "authorization", "certificate", "certificateBase64", "photo", "photoBase64", "photoPath", "certificatePath"]);
  const visit = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) { assert.ok(!forbidden.has(key), `output exposed ${key}`); visit(child); }
  };
  visit(result.output);
}

test("default command completes an explicitly identified simulation with unlimited all-day access", async () => {
  const { deps, observed } = fixture();
  const result = await runFaceEnrollment(input(), deps);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.protocolVersion, 1);
  assert.equal(result.output.outcome, "simulation-completed");
  assert.equal(result.output.mode, "simulation");
  assert.equal(result.output.personnelId, "FTEST12052026112401020304050607");
  assert.equal(result.output.personnelId.length, 31);
  assert.equal(result.output.roomNote, "TEST1205");
  assert.equal(result.output.validityMode, "unlimited");
  assert.equal(result.output.dailyHours, "24x7");
  assert.equal(result.output.siteVerification, "NOT_APPLICABLE");
  assert.equal(result.output.enrollment.status, "ready");
  assert.equal(result.output.enrollment.accessPlanTemplateNo, "1");
  assert.deepEqual(result.output.enrollment.steps.map(step => step.state), ["success", "success", "success", "success"]);
  assert.deepEqual(observed.connects, [{ mode: "simulation" }]);
  assert.equal(observed.reads.length, 1);
  assert.equal(observed.reads[0].kind, "photo");
  assert.equal(observed.reads[0].maxBytes, FACE_PHOTO_LIMIT);
  assert.equal(observed.enrollments.length, 1);
  assert.equal(observed.enrollments[0].photoBase64, photo.toString("base64"));
  assert.equal(observed.enrollments[0].consent, true);
  assert.equal(observed.enrollments[0].room, undefined, "room is a note, not a cloud/door room binding");
  assert.equal(observed.closes, 1);
  assert.ok(observed.buffers.every(bytes => bytes.every(byte => byte === 0)));
  assertNoSecrets(result);
});

test("photo paths retain significant leading whitespace instead of selecting a trimmed sibling", async () => {
  for (const photoPath of [" photos/synthetic.jpg", "\u3000photos/synthetic.jpg"]) {
    const { deps, observed } = fixture();
    const result = await runFaceEnrollment(input({ photoPath }), deps);
    assert.equal(result.exitCode, 0);
    assert.equal(observed.reads.length, 1);
    assert.equal(observed.reads[0].path, resolve(photoPath));
    assert.notEqual(observed.reads[0].path, resolve(photoPath.trim()));
    assert.equal(observed.enrollments.length, 1);
    assert.equal(observed.enrollments[0].photoBase64, photo.toString("base64"));
    assertNoSecrets(result, input({ photoPath }));
  }
});

test("public certificate paths retain significant leading whitespace with only a fake device service", async () => {
  for (const certificatePath of [" certificates/synthetic.cer", "\u3000certificates/synthetic.cer"]) {
    const { deps, observed } = fixture();
    const values = deviceInput({ certificatePath });
    const result = await runFaceEnrollment(values, deps);
    assert.equal(result.exitCode, 0);
    const reads = observed.reads.filter(entry => entry.kind === "certificate");
    assert.equal(reads.length, 1);
    assert.equal(reads[0].path, resolve(certificatePath));
    assert.notEqual(reads[0].path, resolve(certificatePath.trim()));
    assert.equal(observed.enrollments.length, 1);
    assertNoSecrets(result, values);
  }
});

test("automatic IDs use Shanghai's calendar date and at most eight alphanumeric room characters", async () => {
  const { deps } = fixture();
  const result = await runFaceEnrollment(input({ room: "A座-1234567890" }), deps);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.personnelId, "FA12345672026112401020304050607");
  assert.match(result.output.personnelId, /^F[A-Za-z0-9]{0,8}\d{8}[a-f0-9]{14}$/);
  assert.ok(result.output.personnelId.length <= 32);
});

test("provided ID is preserved and simulation never forwards device configuration or reads a certificate", async () => {
  const { deps, observed } = fixture();
  deps.now = () => { throw Error("not needed for explicit ID"); };
  deps.randomBytes = () => { throw Error("not needed for explicit ID"); };
  const result = await runFaceEnrollment(deviceInput({ mode: "simulation", employeeNo: "EXPLICIT01", developmentTls: true, planTemplateNo: "9" }), deps);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.personnelId, "EXPLICIT01");
  assert.deepEqual(observed.connects, [{ mode: "simulation" }]);
  assert.deepEqual(observed.reads.map(entry => entry.kind), ["photo"]);
  assert.equal(observed.providerConfigs.length, 0);
  assertNoSecrets(result);
});

test("device mode uses explicit validated connection parameters and remains pending a site test", async () => {
  const { deps, observed } = fixture();
  const result = await runFaceEnrollment(deviceInput({ employeeNo: "DEVICE01" }), deps);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.outcome, "device-enrollment-confirmed-pending-site");
  assert.equal(result.output.mode, "device");
  assert.equal(result.output.siteVerification, "PENDING");
  assert.equal(result.output.enrollment.status, "ready");
  assert.equal(observed.connects.length, 1);
  assert.equal(observed.connects[0].developmentTls, false);
  assert.equal(observed.connects[0].planTemplateNo, "1");
  assert.deepEqual(observed.reads.map(entry => [entry.kind, entry.maxBytes]), [["photo", 200 * 1024], ["certificate", 64 * 1024]]);
  assert.equal(observed.enrollments.length, 1);
  assert.equal(observed.enrollments[0].validityMode, "unlimited");
  assert.equal(observed.closes, 1);
  assert.ok(observed.buffers.every(bytes => bytes.every(byte => byte === 0)));
  assertNoSecrets(result);
});

test("pending-site is successful device synchronization without claiming face modeling or a site pass", async () => {
  const provider = new SimulatedFaceProvider();
  const describe = provider.describe.bind(provider);
  provider.describe = async () => { const state = await describe(); state.capabilities.faceSearchSupported = false; return state; };
  const { deps } = fixture({ provider });
  const result = await runFaceEnrollment(deviceInput(), deps);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.enrollment.status, "pending-site");
  assert.equal(result.output.enrollment.faceModelingVerified, false);
  assert.equal(result.output.enrollment.faceAssociationConfirmed, true);
  assert.equal(result.output.siteVerification, "PENDING");
});

test("fixed validity requires explicit dates and still binds the service's all-day plan", async () => {
  const { deps, observed } = fixture();
  const result = await runFaceEnrollment(input({ validityMode: "fixed", validFrom: "2026-11-24T09:00", validTo: "2026-11-25T10:00" }), deps);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.validityMode, "fixed");
  assert.equal(result.output.enrollment.validFrom, "2026-11-24T09:00:00");
  assert.equal(result.output.enrollment.validTo, "2026-11-25T10:00:00");
  assert.equal(result.output.enrollment.accessPlanTemplateNo, "1");
  assert.equal(observed.enrollments[0].validityMode, "fixed");
});

test("single-person input, exact consent, modes and required fields are validated before file reads or connections", async () => {
  for (const invalid of [
    null, [], [input()], "not an object", input({ mode: "live" }), input({ mode: null }), input({ mode: "DEVICE" }),
    input({ consent: false }), input({ consent: undefined }), input({ consent: "true" }), input({ name: [] }), input({ name: "" }),
    input({ room: "" }), input({ room: [] }), input({ photoPath: null }), input({ employeeNo: ["ID"] }), input({ employeeNo: "../ID" }),
    input({ employeeNo: "x".repeat(33) }), input({ doorNo: 0 }), input({ doorNo: "1" }), input({ validityMode: "permanent" }),
    input({ validityMode: "fixed" }), input({ FDID: "1" }), input({ faceLibType: "blackFD" }),
    deviceInput({ origin: undefined }), deviceInput({ username: undefined }), deviceInput({ password: "" }), deviceInput({ certificatePath: undefined }),
    deviceInput({ developmentTls: "true" }), deviceInput({ planTemplateNo: "0" }), deviceInput({ expectedModel: null }),
    deviceInput({ employeeNo: "WITH_UNDERSCORE" }), deviceInput({ employeeNo: "WITH-HYPHEN" }),
  ]) {
    const { deps, observed } = fixture();
    const result = await runFaceEnrollment(invalid, deps);
    assert.equal(result.exitCode, 2);
    assert.equal(result.output.outcome, "invalid-input");
    assert.equal(result.output.error.code, "COMMAND_INPUT_INVALID");
    assert.equal(result.output.error.requiresInspection, false);
    assert.equal(observed.reads.length, 0);
    assert.equal(observed.creates, 0);
    assertNoSecrets(result);
  }
});

test("photo/certificate bounds and malformed contents fail locally with safe errors", async () => {
  for (const options of [
    { photoBytes: Buffer.alloc(0), expected: "PHOTO_FILE_INVALID" },
    { photoBytes: Buffer.from("not a JPEG"), expected: "PHOTO_FILE_INVALID" },
    { photoBytes: Buffer.alloc(FACE_PHOTO_LIMIT + 1), expected: "PHOTO_FILE_INVALID" },
    { certificateBytes: Buffer.alloc(0), expected: "CERTIFICATE_FILE_INVALID" },
    { certificateBytes: Buffer.alloc(64 * 1024 + 1), expected: "CERTIFICATE_FILE_INVALID" },
    { certificateBytes: Buffer.from("not a public certificate"), expected: "DEVICE_CONFIGURATION_INVALID" },
  ]) {
    const { deps, observed } = fixture(options);
    const result = await runFaceEnrollment(deviceInput(), deps);
    assert.equal(result.exitCode, 2);
    assert.equal(result.output.error.code, options.expected);
    assert.equal(observed.creates, 0);
    assert.equal(observed.connects.length, 0);
    assert.ok(observed.buffers.every(bytes => bytes.every(byte => byte === 0)));
    assertNoSecrets(result);
  }
});

test("the existing TLS client rejects invalid origins before a service can connect", async () => {
  for (const origin of ["http://synthetic.invalid", "https://user:pass@synthetic.invalid", "https://synthetic.invalid/path", "not a URL"]) {
    const { deps, observed } = fixture();
    const result = await runFaceEnrollment(deviceInput({ origin }), deps);
    assert.equal(result.exitCode, 2);
    assert.equal(result.output.error.code, "DEVICE_CONFIGURATION_INVALID");
    assert.equal(observed.creates, 0);
    assertNoSecrets(result);
  }
});

test("library ambiguity and unsupported doors stop after discovery and before enrollment", async () => {
  for (const [capabilities, overrides, code] of [
    [{ libraries: [], doorNumbers: [1] }, {}, "LIBRARY_SELECTION_REQUIRED"],
    [{ libraries: [{ FDID: "1", faceLibType: "blackFD" }, { FDID: "2", faceLibType: "blackFD" }], doorNumbers: [1] }, {}, "LIBRARY_SELECTION_REQUIRED"],
    [{ libraries: [{ FDID: "1", faceLibType: "infraredFD" }], doorNumbers: [1] }, {}, "LIBRARY_SELECTION_REQUIRED"],
    [{ libraries: [{ FDID: "1", faceLibType: "blackFD" }], doorNumbers: [2] }, {}, "DOOR_NOT_SUPPORTED"],
    [{ libraries: [{ FDID: "1", faceLibType: "blackFD" }], doorNumbers: [1] }, { FDID: "2", faceLibType: "blackFD" }, "LIBRARY_SELECTION_REQUIRED"],
  ]) {
    const { deps, observed } = fixture({ connect: () => ({ capabilities, device: { model: "SYNTHETIC", firmware: "V0.0" } }) });
    const result = await runFaceEnrollment(input(overrides), deps);
    assert.equal(result.exitCode, 2);
    assert.equal(result.output.error.code, code);
    assert.equal(observed.connects.length, 1);
    assert.equal(observed.enrollments.length, 0);
    assert.equal(observed.closes, 1);
  }
});

test("an explicit library pair is honored and caller plan proof is never forwarded", async () => {
  const { deps, observed } = fixture();
  const result = await runFaceEnrollment(input({
    FDID: "SIMULATION_FD_01", faceLibType: "blackFD", accessPlanTemplateNo: "99", accessPlanFingerprint: "f".repeat(64),
    allDayPlan: { templateNo: "99", fingerprint: "f".repeat(64) }, RightPlan: [{ doorNo: 1, planTemplateNo: "99" }],
  }), deps);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.enrollment.accessPlanTemplateNo, "1");
  for (const key of ["accessPlanTemplateNo", "accessPlanFingerprint", "allDayPlan", "RightPlan"]) assert.equal(observed.enrollments[0][key], undefined);
});

test("returned partial failure preserves its identifier and stage state without any automatic retry", async () => {
  const provider = new SimulatedFaceProvider();
  let uploads = 0, creates = 0, grants = 0;
  const create = provider.createPerson.bind(provider);
  provider.createPerson = async values => { creates += 1; return create(values); };
  provider.putFace = async () => { uploads += 1; throw new HttpError(502, `${deviceInput().password} ${input().photoPath} ${photo.toString("base64")}`); };
  provider.grantAccess = async () => { grants += 1; };
  const { deps, observed } = fixture({ provider });
  const result = await runFaceEnrollment(deviceInput({ employeeNo: "PARTIAL01" }), deps);
  assert.equal(result.exitCode, 4);
  assert.equal(result.output.outcome, "failed");
  assert.equal(result.output.personnelId, "PARTIAL01");
  assert.equal(result.output.enrollment.employeeNo, "PARTIAL01");
  assert.equal(result.output.enrollment.status, "failed");
  assert.equal(result.output.enrollment.steps[0].state, "success");
  assert.equal(result.output.enrollment.steps[1].state, "failed");
  assert.equal(result.output.error.requiresInspection, true);
  assert.deepEqual([creates, uploads, grants], [1, 1, 0]);
  assert.equal(observed.enrollments.length, 1);
  assert.equal(observed.closes, 1);
  assertNoSecrets(result);
});

test("connection and unexpected post-start exceptions are fixed messages without raw codes, stack, or paths", async () => {
  const secret = `${deviceInput().password} ${input().photoPath} ${photo.toString("base64")}`;
  for (const phase of ["connect", "enroll"]) {
    const failure = () => { const error = Error(secret); error.code = secret; throw error; };
    const { deps, observed } = fixture({ [phase]: failure });
    const result = await runFaceEnrollment(deviceInput({ employeeNo: "UNCERTAIN01" }), deps);
    assert.equal(result.exitCode, 5);
    assert.equal(result.output.personnelId, "UNCERTAIN01");
    assert.equal(result.output.outcome, "stopped");
    assert.equal(result.output.error.code, phase === "connect" ? "DEVICE_CONNECTION_FAILED" : "ENROLLMENT_STATE_UNCERTAIN");
    assert.equal(result.output.error.requiresInspection, phase === "enroll");
    assert.equal(observed.enrollments.length, phase === "enroll" ? 1 : 0);
    assert.equal(observed.closes, 1);
    assertNoSecrets(result);
    assert.ok(!JSON.stringify(result).includes("stack"));
  }
});

test("service input validation is reported as exit 2 and closes without a retry", async () => {
  const { deps, observed } = fixture({ enroll: () => { throw new HttpError(400, deviceInput().password); } });
  const result = await runFaceEnrollment(deviceInput(), deps);
  assert.equal(result.exitCode, 2);
  assert.equal(result.output.error.code, "ENROLLMENT_INPUT_INVALID");
  assert.equal(result.output.error.requiresInspection, false);
  assert.equal(observed.enrollments.length, 1);
  assert.equal(observed.closes, 1);
  assertNoSecrets(result);
});

test("output whitelists DTO fields and replaces untrusted error and step text", async () => {
  const secret = deviceInput().password;
  const { deps } = fixture({ enroll: values => ({
    ...values, mode: "device", status: "failed", id: "synthetic-row", password: secret, photoBase64: photo.toString("base64"),
    error: secret, steps: [{ key: "face", label: secret, state: "failed", message: secret, password: secret }],
  }) });
  const result = await runFaceEnrollment(deviceInput({ employeeNo: "SAFE01" }), deps);
  assert.equal(result.exitCode, 4);
  assert.equal(result.output.enrollment.employeeNo, "SAFE01");
  assert.equal(result.output.enrollment.steps[1].label, "上传人脸");
  assertNoSecrets(result);
});

test("device execution requires the trusted Windows platform and input cannot spoof it", async () => {
  const { deps, observed } = fixture();
  deps.platform = "linux";
  const result = await runFaceEnrollment(deviceInput({ platform: "win32" }), deps);
  assert.equal(result.exitCode, 2);
  assert.equal(result.output.error.code, "LOCAL_WINDOWS_REQUIRED");
  assert.equal(observed.reads.length, 0);
  assert.equal(observed.creates, 0);
  const simulation = await runFaceEnrollment(input({ employeeNo: "SIM_LOCAL-1", platform: "win32" }), deps);
  assert.equal(simulation.exitCode, 0);
  assert.equal(simulation.output.mode, "simulation");
});

test("UNC and Windows device-namespace paths are rejected before any injected or real file read", async () => {
  const slash = String.fromCharCode(92);
  const paths = [
    `${slash}${slash}server${slash}share${slash}photo.jpg`, "//server/share/photo.jpg",
    `${slash}${slash}?${slash}C:${slash}photo.jpg`, `${slash}${slash}.${slash}pipe${slash}photo`,
    `${slash}??${slash}C:${slash}photo.jpg`, "//?/C:/photo.jpg",
  ];
  for (const path of paths) {
    const { deps, observed } = fixture();
    const photoResult = await runFaceEnrollment(input({ photoPath: path }), deps);
    assert.equal(photoResult.exitCode, 2);
    assert.equal(photoResult.output.error.code, "PHOTO_FILE_INVALID");
    const certificateResult = await runFaceEnrollment(deviceInput({ certificatePath: path }), deps);
    assert.equal(certificateResult.exitCode, 2);
    assert.equal(certificateResult.output.error.code, "CERTIFICATE_FILE_INVALID");
    assert.equal(observed.reads.length, 0);
    assert.equal(observed.creates, 0);
  }
});

test("device discovery must exactly match the expected model before enrollment", async () => {
  const first = fixture({ model: "OTHER-SYNTHETIC" });
  const stopped = await runFaceEnrollment(deviceInput(), first.deps);
  assert.equal(stopped.exitCode, 5);
  assert.equal(stopped.output.error.code, "DEVICE_MODEL_MISMATCH");
  assert.equal(first.observed.enrollments.length, 0);
  assert.equal(first.observed.closes, 1);
  assert.equal(stopped.output.personnelId, "FTEST12052026112401020304050607");
  const explicit = fixture({ model: "OTHER-SYNTHETIC" });
  const accepted = await runFaceEnrollment(deviceInput({ expectedModel: "OTHER-SYNTHETIC" }), explicit.deps);
  assert.equal(accepted.exitCode, 0);
  assert.equal(explicit.observed.enrollments.length, 1);
  const simulation = fixture();
  assert.equal((await runFaceEnrollment(input({ expectedModel: "IGNORED" }), simulation.deps)).exitCode, 0);
});

function successfulRow(values) {
  const { employeeNo, name, doorNo, FDID, faceLibType, validityMode } = values;
  return {
    employeeNo, name, doorNo, FDID, faceLibType, validityMode, mode: "device", status: "ready", id: "synthetic-row",
    faceSubmitted: true, faceAssociationConfirmed: true, faceModelingVerified: true,
    accessPlanTemplateNo: "1", accessPlanFingerprint: "a".repeat(64),
    steps: ["person", "face", "access", "verify"].map(key => ({ key, state: "success" })),
  };
}

test("a returned DTO with another identity is never projected as this person's success or partial record", async () => {
  for (const patch of [
    { employeeNo: "OTHER01" }, { name: "另一合成人员" }, { mode: "simulation" }, { doorNo: 2 },
    { FDID: "OTHER" }, { faceLibType: "infraredFD" }, { validityMode: "fixed" },
    { employeeNo: "OTHER01", status: "failed" },
  ]) {
    const { deps, observed } = fixture({ enroll: values => ({ ...successfulRow(values), ...patch }) });
    const result = await runFaceEnrollment(deviceInput({ employeeNo: "EXPECTED01" }), deps);
    assert.equal(result.exitCode, 5);
    assert.equal(result.output.error.code, "INVALID_SERVICE_RESPONSE");
    assert.equal(result.output.error.requiresInspection, true);
    assert.equal(result.output.personnelId, "EXPECTED01");
    assert.equal(result.output.enrollment, null);
    assert.equal(observed.enrollments.length, 1);
    assert.equal(observed.closes, 1);
  }
});

test("successful status requires four unique successful stages, submitted association and complete plan proof", async () => {
  for (const patch of [
    { steps: [] }, { steps: undefined },
    { steps: ["person", "person", "access", "verify"].map(key => ({ key, state: "success" })) },
    { steps: ["person", "face", "access", "verify"].map(key => ({ key, state: key === "access" ? "failed" : "success" })) },
    { faceSubmitted: false }, { faceSubmitted: undefined }, { faceAssociationConfirmed: false },
    { accessPlanTemplateNo: undefined }, { accessPlanTemplateNo: "0" }, { accessPlanFingerprint: "not-a-fingerprint" },
    { status: "pending-site", faceAssociationConfirmed: undefined },
  ]) {
    const { deps, observed } = fixture({ enroll: values => ({ ...successfulRow(values), ...patch }) });
    const result = await runFaceEnrollment(deviceInput({ employeeNo: "PROOF01" }), deps);
    assert.equal(result.exitCode, 5);
    assert.equal(result.output.error.code, "INVALID_SERVICE_RESPONSE");
    assert.equal(result.output.error.requiresInspection, true);
    assert.equal(result.output.personnelId, "PROOF01");
    assert.equal(observed.enrollments.length, 1);
    assert.ok(observed.buffers.every(bytes => bytes.every(byte => byte === 0)));
  }
});

test("successful status must agree with its exact modeling verification boolean", async () => {
  for (const [status, faceModelingVerified] of [
    ["ready", false], ["ready", undefined], ["ready", "true"],
    ["pending-site", true], ["pending-site", undefined], ["pending-site", "false"],
  ]) {
    const { deps, observed } = fixture({ enroll: values => ({ ...successfulRow(values), status, faceModelingVerified }) });
    const result = await runFaceEnrollment(deviceInput({ employeeNo: "MODELING01" }), deps);
    assert.equal(result.exitCode, 5);
    assert.equal(result.output.error.code, "INVALID_SERVICE_RESPONSE");
    assert.equal(result.output.error.requiresInspection, true);
    assert.equal(result.output.personnelId, "MODELING01");
    assert.equal(result.output.enrollment, null);
    assert.equal(observed.enrollments.length, 1);
    assert.equal(observed.closes, 1);
  }
});

test("fixed successful DTO dates must exactly match this request with minute precision normalized to seconds", async () => {
  const request = deviceInput({ employeeNo: "FIXEDDTO01", validityMode: "fixed", validFrom: "2026-11-24T09:00", validTo: "2026-11-25T10:00:30" });
  for (const status of ["ready", "pending-site"]) {
    const complete = values => ({
      ...successfulRow(values), status, faceModelingVerified: status === "ready",
      validFrom: "2026-11-24T09:00:00", validTo: "2026-11-25T10:00:30",
    });
    const positive = fixture({ enroll: complete });
    assert.equal((await runFaceEnrollment(request, positive.deps)).exitCode, 0);
    for (const patch of [
      { validFrom: "2026-11-24T09:01:00" }, { validTo: "2026-11-25T10:00:00" },
      { validFrom: undefined }, { validTo: undefined },
      { validFrom: "2026-11-24T09:00" }, { validTo: "2026-11-25T10:00:30Z" },
    ]) {
      const { deps, observed } = fixture({ enroll: values => ({ ...complete(values), ...patch }) });
      const result = await runFaceEnrollment(request, deps);
      assert.equal(result.exitCode, 5);
      assert.equal(result.output.error.code, "INVALID_SERVICE_RESPONSE");
      assert.equal(result.output.error.requiresInspection, true);
      assert.equal(result.output.personnelId, "FIXEDDTO01");
      assert.equal(result.output.enrollment, null);
      assert.equal(observed.enrollments.length, 1);
      assert.ok(observed.buffers.every(bytes => bytes.every(byte => byte === 0)));
    }
  }
});

test("cleanup errors cannot produce success and owned buffers are still cleared", async () => {
  const { deps, observed } = fixture({ close: () => { throw Error(deviceInput().password); } });
  const result = await runFaceEnrollment(deviceInput(), deps);
  assert.equal(result.exitCode, 5);
  assert.equal(result.output.error.code, "CLEANUP_FAILED");
  assert.equal(result.output.error.requiresInspection, true);
  assert.equal(result.output.enrollment.status, "ready");
  assert.ok(observed.buffers.every(bytes => bytes.every(byte => byte === 0)));
  assertNoSecrets(result);
});

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "smartpm-face-command-"));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("smartpm-face-command-"));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("default file reader accepts a bounded synthetic JPEG and reads only local simulation input", async t => {
  const directory = await temporaryDirectory(t);
  const path = join(directory, "synthetic.jpg");
  const bytes = Buffer.alloc(FACE_PHOTO_LIMIT);
  photo.copy(bytes, 0, 0, 3);
  bytes[bytes.length - 2] = 0xff; bytes[bytes.length - 1] = 0xd9;
  await writeFile(path, bytes);
  const result = await runFaceEnrollment(input({ photoPath: path }), { now, randomBytes });
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.mode, "simulation");
  assert.equal(result.output.enrollment.status, "ready");
  assert.ok(!JSON.stringify(result).includes(directory));
});

test("default file reader rejects directories, missing files, and oversized files before creating a service", async t => {
  const directory = await temporaryDirectory(t);
  const subdirectory = join(directory, "directory.jpg");
  await mkdir(subdirectory);
  const oversized = join(directory, "oversized.jpg");
  await writeFile(oversized, Buffer.alloc(FACE_PHOTO_LIMIT + 1));
  for (const photoPath of [subdirectory, join(directory, "missing.jpg"), oversized]) {
    let creates = 0;
    const result = await runFaceEnrollment(input({ photoPath }), { now, randomBytes, createService: () => { creates += 1; throw Error("must not create"); } });
    assert.equal(result.exitCode, 2);
    assert.equal(result.output.error.code, "PHOTO_FILE_INVALID");
    assert.equal(creates, 0);
    assert.ok(!JSON.stringify(result).includes(directory));
  }
});
