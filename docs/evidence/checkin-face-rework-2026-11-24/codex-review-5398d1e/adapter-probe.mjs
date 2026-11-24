// Independent review probe, synthetic fixtures only. No candidate file changed.
// The fixtures/provider below are copied verbatim from the pinned candidate test before its first test registration.
import assert from 'node:assert/strict';
import { FaceEnrollmentService } from 'file:///workspace/SMART-PM-review-checkin-face-5398d1e/admin-web/lib/face-enrollment.mjs';
import { HttpError } from 'file:///workspace/SMART-PM-review-checkin-face-5398d1e/admin-web/lib/model.mjs';
import { SYNTHETIC_CERT } from 'file:///workspace/SMART-PM-review-checkin-face-5398d1e/admin-web/tests/fixtures/hikvision-synthetic-certificates.mjs';
import { loadWorkerConfig, buildInMemoryDeviceRequest } from 'file:///workspace/SMART-PM-review-checkin-face-5398d1e/tools/checkin-face-worker/worker-runtime.mjs';
import { runInMemoryEnrollment } from 'file:///workspace/SMART-PM-review-checkin-face-5398d1e/tools/checkin-face-worker/enrollment-adapter.mjs';

const TOKEN = 'SyntheticWorkerToken-0123456789abcdef';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0, 1, 0xff, 0xd9]);
const PLAN_FINGERPRINT = 'b'.repeat(64);

async function config(deviceOverrides = {}) {
  return loadWorkerConfig({
    configPath: 'C:/synthetic/worker.local.json',
    env: {
      CHECKIN_FACE_WORKER_TOKEN: TOKEN,
      CHECKIN_FACE_DEVICE_USERNAME: 'synthetic-device-admin',
      CHECKIN_FACE_DEVICE_PASSWORD: 'synthetic-device-password-only',
    },
    readJsonFile: async () => JSON.stringify({
      cloudEnv: 'synthetic-cloud-env', workerId: 'synthetic-worker-01', deviceKey: 'device-key-stable',
      name: '合成人员', roomNote: '102',
      device: {
        origin: 'https://synthetic-device.invalid', certificatePath: 'C:/synthetic/private/public.cer',
        expectedModel: 'DS-K1T671BM', planTemplateNo: '1', developmentTls: false,
        ...deviceOverrides,
      },
    }),
  });
}

function makeTask({ nowMs = Date.now(), ...overrides } = {}) {
  return {
    taskId: 'checkin-face-test|task|app-1',
    claimId: '11111111-2222-4333-8444-555555555555',
    revision: 2,
    name: '合成测试成员',
    employeeNo: 'F0123456789ABCDEF',
    doorNo: 7,
    validFrom: '2026-12-01T00:00:00',
    validTo: '2026-12-05T23:59:59',
    timezone: 'Asia/Shanghai',
    dailyHours: '24x7',
    deviceKey: 'device-key-stable',
    fileId: 'cloud://synthetic/test-face/photo.jpg',
    accessPlanFingerprint: PLAN_FINGERPRINT,
    claimExpiresAt: nowMs + 300_000,
    ...overrides,
  };
}

function authorizedSnapshot(claimed) {
  return {
    ...claimed,
    status: 'DEVICE_PROCESSING',
    revision: claimed.revision + 1,
    configRevision: 3,
    roomRevision: 5,
    leaseRevision: 7,
    roomBindingId: 'checkin-face-test|room|102',
    leaseSnapshotId: 'checkin-face-test|lease|1',
    workerId: 'synthetic-worker-01',
    authorizedAt: claimed.claimExpiresAt - 5000,
  };
}

/** 计数假设备执行器（模拟 HikvisionFaceProvider 语义，含全天计划指纹再核验）。 */
class CountingDeviceProvider {
  constructor({ model = 'DS-K1T671BM', libraries = [{ FDID: 'TEST_FD_01', faceLibType: 'blackFD' }], doorNumbers = [7], planFingerprint = PLAN_FINGERPRINT } = {}) {
    this.calls = { describe: 0, findPerson: 0, createPerson: 0, putFace: 0, grantAccess: 0, findFace: 0, close: 0 };
    this.people = new Map();
    this.faces = new Set();
    this.model = model;
    this.libraries = libraries;
    this.doorNumbers = doorNumbers;
    this.planFingerprint = planFingerprint;
  }
  async describe() {
    this.calls.describe += 1;
    return {
      device: { model: this.model, firmware: 'V3.3.180' },
      capabilities: {
        allDayPlan: { templateNo: '1', fingerprint: this.planFingerprint, name: '每天24小时', weekPlanNo: 1, holidayGroupNos: [] },
        libraries: this.libraries,
        doorNumbers: this.doorNumbers,
        maxPhotoBytes: 200 * 1024,
        photoLimitSource: 'guide-default',
        employeeNoMaxLength: 32,
        employeeNoPattern: '^[A-Za-z0-9]+$',
        nameMaxBytes: 128,
        timeRangeBegin: '2026-01-01T00:00:00',
        timeRangeEnd: '2027-12-31T23:59:59',
        longTermValiditySupported: true,
        userTypes: ['normal'],
        timeTypes: ['local'],
        faceFunctions: ['get', 'setup'],
        faceSearchSupported: true,
        personFaceCountSupported: true,
      },
    };
  }
  async findPerson(id) {
    this.calls.findPerson += 1;
    const row = this.people.get(id);
    return row ? structuredClone(row) : null;
  }
  async createPerson(person) {
    this.calls.createPerson += 1;
    this.people.set(person.employeeNo, {
      employeeNo: person.employeeNo, name: person.name,
      Valid: { enable: person.validityMode !== 'unlimited', beginTime: person.validFrom, endTime: person.validTo, timeType: 'local' },
      doorRight: '', numOfFace: 0,
    });
  }
  async putFace(person) {
    this.calls.putFace += 1;
    this.faces.add(person.employeeNo);
    this.people.get(person.employeeNo).numOfFace = 1;
  }
  async grantAccess(person) {
    this.calls.grantAccess += 1;
    if (person.accessPlanFingerprint !== this.planFingerprint) throw new HttpError(409, '每天24小时权限计划已变更，请断开后重新连接确认');
    Object.assign(this.people.get(person.employeeNo), {
      doorRight: String(person.doorNo),
      RightPlan: [{ doorNo: Number(person.doorNo), planTemplateNo: person.accessPlanTemplateNo }],
    });
  }
  async findFace(person) {
    this.calls.findFace += 1;
    return this.faces.has(person.employeeNo);
  }
  close() { this.calls.close += 1; }
}


const task = makeTask({ nowMs: 1000 });
const cfg = await config();
const request = buildInMemoryDeviceRequest(task, cfg);
assert.equal(task.accessPlanFingerprint, 'b'.repeat(64));
assert.equal(Object.hasOwn(request, 'accessPlanFingerprint'), false);
const provider = new CountingDeviceProvider({ planFingerprint: 'c'.repeat(64) });
const beforeTask = structuredClone(task);
const observed = await runInMemoryEnrollment(request, {
  createService: () => new FaceEnrollmentService({ providerFactory: () => provider }),
  photoBuffer: Buffer.from(JPEG),
  readBoundedFile: async () => Buffer.from(SYNTHETIC_CERT),
  commandDeps: { platform: 'win32' },
});
assert.deepEqual(task, beforeTask);
assert.equal(observed.exitCode, 0);
assert.equal(observed.output.outcome, 'device-enrollment-confirmed-pending-site');
assert.equal(observed.output.enrollment.accessPlanFingerprint, 'c'.repeat(64));
assert.deepEqual({
  describe: provider.calls.describe,
  createPerson: provider.calls.createPerson,
  putFace: provider.calls.putFace,
  grantAccess: provider.calls.grantAccess,
  close: provider.calls.close,
}, { describe: 1, createPerson: 1, putFace: 1, grantAccess: 1, close: 1 });
assert.notEqual(task.accessPlanFingerprint, observed.output.enrollment.accessPlanFingerprint);
console.log(JSON.stringify({
  probe: 'WA-01-authorized-plan-B-stable-provider-C',
  mode: 'synthetic-only-no-physical-device', pid: process.pid,
  taskFingerprintLabel: 'B', providerFingerprintLabel: 'C',
  requestHasAuthorizedFingerprint: Object.hasOwn(request, 'accessPlanFingerprint'),
  observedExitCode: observed.exitCode, observedOutcome: observed.output.outcome,
  deviceWriteCounters: { createPerson: provider.calls.createPerson, putFace: provider.calls.putFace, grantAccess: provider.calls.grantAccess },
  providerCloseCalls: provider.calls.close,
  mismatchAccepted: true,
}));
for (const [id, codePoint] of [
  ['ascii-leading-space', 0x20],
  ['u3000-leading-space', 0x3000],
]) {
  // Build the synthetic leading character without any file/configuration lookup.
  const sourcePath = String.fromCharCode(codePoint) + 'cert-dir/public.cer';
  const localCfg = await config({ certificatePath: sourcePath });
  const built = buildInMemoryDeviceRequest(makeTask({ nowMs: 1000 }), localCfg);
  assert.notEqual(sourcePath, sourcePath.trim());
  assert.equal(localCfg.device.deviceCertificatePath, sourcePath.trim());
  assert.notEqual(localCfg.device.deviceCertificatePath, sourcePath);
  assert.equal(built.certificatePath.endsWith('/cert-dir/public.cer'), true);
  assert.equal(built.certificatePath.includes(id === 'ascii-leading-space' ? '/ cert-dir/' : String.fromCharCode(0x3000)), false);
  // No adapter is invoked here: this branch only demonstrates the preceding input transformation.
  console.log(JSON.stringify({
    probe: 'WA-02-worker-certificate-path-trim', vector: id,
    mode: 'synthetic-config-only-no-certificate-read', pid: process.pid,
    originalDiffersFromTrimmed: true,
    loadedConfigurationEqualsTrimmed: true,
    builtRequestUsesTrimmedComponent: true,
    certificateReads: 0, providerCalls: 0,
  }));
}
