/**
 * R08/R09 场景：内存照片适配层（计数假设备执行器）+ 清理纳入真实终态 + 无残留证明。
 * 全部合成字节与假证书；不读真实照片/配置/证书，无监听、无真实设备调用。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { FaceEnrollmentService } from '../../../admin-web/lib/face-enrollment.mjs';
import { HttpError } from '../../../admin-web/lib/model.mjs';
import { SYNTHETIC_CERT } from '../../../admin-web/tests/fixtures/hikvision-synthetic-certificates.mjs';
import { loadWorkerConfig, runEnrollment, buildInMemoryDeviceRequest } from '../worker-runtime.mjs';
import { runInMemoryEnrollment } from '../enrollment-adapter.mjs';
import { main } from '../claim-and-enroll.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url)); // tools/checkin-face-worker/tests
const WORKER_DIR = join(MODULE_DIR, '..');

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

test('R08：内存照片正例——模式/租期/门号/计划指纹保留，设备侧恰好各一次', async () => {
  const cfg = await config();
  const task = makeTask();
  const request = buildInMemoryDeviceRequest(task, cfg);
  const provider = new CountingDeviceProvider();
  const result = await runInMemoryEnrollment(request, {
    createService: () => new FaceEnrollmentService({ providerFactory: () => provider }),
    photoBuffer: JPEG,
    readBoundedFile: async () => Buffer.from(SYNTHETIC_CERT),
    commandDeps: { platform: 'win32' },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.outcome, 'device-enrollment-confirmed-pending-site');
  assert.equal(result.output.mode, 'device');
  assert.equal(result.output.validityMode, 'fixed');
  assert.equal(result.output.dailyHours, '24x7');
  assert.equal(result.output.siteVerification, 'PENDING');
  assert.equal(result.output.personnelId, task.employeeNo);
  assert.deepEqual(
    { createPerson: provider.calls.createPerson, putFace: provider.calls.putFace, grantAccess: provider.calls.grantAccess, describe: provider.calls.describe },
    { createPerson: 1, putFace: 1, grantAccess: 1, describe: 1 },
    '合法路径恰好各一次',
  );
  assert.equal(result.output.enrollment.employeeNo, task.employeeNo);
  assert.equal(result.output.enrollment.doorNo, 7);
  assert.equal(result.output.enrollment.validFrom, task.validFrom, '租期起止精确保留');
  assert.equal(result.output.enrollment.validTo, task.validTo);
  assert.equal(result.output.enrollment.accessPlanFingerprint, PLAN_FINGERPRINT, '全天计划指纹保留');
  assert.equal(result.output.enrollment.validityMode, 'fixed');
  assert.equal(result.output.enrollment.status, 'ready');
});

test('R08：证书受限读取走真实文件路径（合成证书字节，不读真实材料）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'checkin-face-cert-'));
  const certPath = join(dir, 'public.cer');
  await writeFile(certPath, SYNTHETIC_CERT, 'utf8');
  try {
    const cfg = await config({ certificatePath: certPath });
    const request = buildInMemoryDeviceRequest(makeTask(), cfg);
    const provider = new CountingDeviceProvider();
    // 默认 readBoundedFile 走真实受限读取（元数据快照校验）；createService 注入假设备执行器，不发真实连接。
    const direct = await runInMemoryEnrollment(request, {
      createService: () => new FaceEnrollmentService({ providerFactory: () => provider }),
      photoBuffer: JPEG,
      commandDeps: { platform: 'win32' },
    });
    assert.equal(direct.exitCode, 0);
    assert.equal(direct.output.outcome, 'device-enrollment-confirmed-pending-site');
    assert.equal(provider.calls.describe, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('R08：型号不符（含 developmentTls=true）仍拒绝，业务写入 0 次', async () => {
  const task = makeTask();
  for (const developmentTls of [false, true]) {
    const cfg = await config({ developmentTls });
    const request = buildInMemoryDeviceRequest(task, cfg);
    const provider = new CountingDeviceProvider({ model: 'OTHER-MODEL' });
    const result = await runInMemoryEnrollment(request, {
      createService: () => new FaceEnrollmentService({ providerFactory: () => provider }),
      photoBuffer: JPEG,
      readBoundedFile: async () => Buffer.from(SYNTHETIC_CERT),
      commandDeps: { platform: 'win32' },
    });
    assert.equal(result.exitCode, 5, `developmentTls=${developmentTls} 型号不符应退出 5`);
    assert.equal(result.output.error.code, 'DEVICE_MODEL_MISMATCH');
    assert.equal(provider.calls.createPerson + provider.calls.putFace + provider.calls.grantAccess, 0, '型号不符不得有任何业务写入');
    assert.equal(provider.calls.describe, 1);
  }
});

test('R08：唯一人脸库选择与门号能力独立校验（不改服务模块）', async () => {
  const cfg = await config();
  const request = buildInMemoryDeviceRequest(makeTask(), cfg);
  const noBlackFd = new CountingDeviceProvider({ libraries: [{ FDID: 'A', faceLibType: 'whiteFD' }, { FDID: 'B', faceLibType: 'whiteFD' }] });
  let result = await runInMemoryEnrollment(request, {
    createService: () => new FaceEnrollmentService({ providerFactory: () => noBlackFd }),
    photoBuffer: JPEG,
    readBoundedFile: async () => Buffer.from(SYNTHETIC_CERT),
    commandDeps: { platform: 'win32' },
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.output.error.code, 'LIBRARY_SELECTION_REQUIRED');
  assert.equal(noBlackFd.calls.createPerson + noBlackFd.calls.putFace + noBlackFd.calls.grantAccess, 0);

  const wrongDoor = new CountingDeviceProvider({ doorNumbers: [3] });
  result = await runInMemoryEnrollment(request, {
    createService: () => new FaceEnrollmentService({ providerFactory: () => wrongDoor }),
    photoBuffer: JPEG,
    readBoundedFile: async () => Buffer.from(SYNTHETIC_CERT),
    commandDeps: { platform: 'win32' },
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.output.error.code, 'DOOR_NOT_SUPPORTED');
  assert.equal(wrongDoor.calls.createPerson + wrongDoor.calls.putFace + wrongDoor.calls.grantAccess, 0);
});

test('R08：执行前指纹核验保留——设备计划在 describe 后变更 → failed(4)，不重试', async () => {
  const cfg = await config();
  const request = buildInMemoryDeviceRequest(makeTask(), cfg);
  const provider = new CountingDeviceProvider();
  const originalDescribe = provider.describe.bind(provider);
  provider.describe = async () => {
    const value = await originalDescribe();
    provider.planFingerprint = 'c'.repeat(64); // 模拟 describe 后设备全天计划被修改
    return value;
  };
  const result = await runInMemoryEnrollment(request, {
    createService: () => new FaceEnrollmentService({ providerFactory: () => provider }),
    photoBuffer: JPEG,
    readBoundedFile: async () => Buffer.from(SYNTHETIC_CERT),
    commandDeps: { platform: 'win32' },
  });
  assert.equal(result.exitCode, 4);
  assert.equal(result.output.outcome, 'failed');
  assert.equal(result.output.error.code, 'ENROLLMENT_FAILED');
  assert.equal(provider.calls.createPerson, 1, '人员创建已发生（保留事实）');
  assert.equal(provider.calls.putFace, 1);
  assert.equal(provider.calls.grantAccess, 1, '授权尝试一次后失败关闭，不重试');
});

test('R08：服务返回行不一致/未知 → INVALID_SERVICE_RESPONSE（5/stopped），不重试', async () => {
  const cfg = await config();
  const request = buildInMemoryDeviceRequest(makeTask(), cfg);
  const fakeService = {
    connect: async () => ({
      device: { model: 'DS-K1T671BM', firmware: 'V3.3.180' },
      capabilities: {
        allDayPlan: { templateNo: '1', fingerprint: PLAN_FINGERPRINT, name: '每天24小时', weekPlanNo: 1, holidayGroupNos: [] },
        libraries: [{ FDID: 'TEST_FD_01', faceLibType: 'blackFD' }],
        doorNumbers: [7],
        maxPhotoBytes: 200 * 1024,
      },
    }),
    enroll: async () => ({ status: 'ready', employeeNo: 'FWRONG' }),
    close: async () => {},
  };
  let enrollCalls = 0;
  const result = await runInMemoryEnrollment(request, {
    createService: () => ({ ...fakeService, enroll: async () => { enrollCalls += 1; return fakeService.enroll(); } }),
    photoBuffer: JPEG,
    readBoundedFile: async () => Buffer.from(SYNTHETIC_CERT),
    commandDeps: { platform: 'win32' },
  });
  assert.equal(result.exitCode, 5);
  assert.equal(result.output.outcome, 'stopped');
  assert.equal(result.output.error.code, 'INVALID_SERVICE_RESPONSE');
  assert.equal(enrollCalls, 1, '不得重试登记');
});

test('R09：连接清理失败 → CLEANUP_FAILED(5) 并保留已确认设备事实，不重发设备', async () => {
  const cfg = await config();
  const request = buildInMemoryDeviceRequest(makeTask(), cfg);
  const provider = new CountingDeviceProvider();
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  let closeCalls = 0;
  const originalClose = service.close.bind(service);
  service.close = () => { closeCalls += 1; originalClose(); throw new Error('synthetic close failure'); };
  const result = await runInMemoryEnrollment(request, {
    createService: () => service,
    photoBuffer: JPEG,
    readBoundedFile: async () => Buffer.from(SYNTHETIC_CERT),
    commandDeps: { platform: 'win32' },
  });
  assert.equal(closeCalls, 1);
  assert.equal(result.exitCode, 5);
  assert.equal(result.output.outcome, 'stopped');
  assert.equal(result.output.error.code, 'CLEANUP_FAILED');
  assert.equal(result.output.enrollment.employeeNo, 'F0123456789ABCDEF', '已发生设备事实保留');
  assert.equal(result.output.enrollment.status, 'ready');
  assert.equal(provider.calls.createPerson + provider.calls.putFace + provider.calls.grantAccess, 3, '设备操作各一次，不重发');
});

test('R09：worker 级内存释放失败 → 整体 5/CLEANUP_FAILED、执行器恰好 1 次、report 一次', async () => {
  const cfg = await config();
  const task = makeTask();
  const actions = [];
  let executorCalls = 0;
  const client = {
    callFunction: async (action, payload) => {
      actions.push({ action, payload });
      if (action === 'claimTask') return { task };
      if (action === 'beginTaskExecution') return { task: authorizedSnapshot(task), authorizedAt: task.claimExpiresAt - 5000 };
      return { ok: true };
    },
    downloadFile: async () => Buffer.from(JPEG),
  };
  const original = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const code = await main({
      argv: ['--once'], env: {}, loadConfig: async () => cfg, createClient: async () => client,
      platform: 'win32', stdout: { write: () => {} },
      runEnrollmentImpl: async () => {
        executorCalls += 1;
        return { exitCode: 0, output: { protocolVersion: 1, outcome: 'device-enrollment-confirmed-pending-site', mode: 'device', validityMode: 'fixed', siteVerification: 'PENDING', enrollment: { employeeNo: task.employeeNo, doorNo: 7 } } };
      },
      releasePhoto: async () => false,
    });
    assert.equal(code, 5);
    assert.equal(executorCalls, 1, '不得因清理失败重发设备');
    const report = actions.filter((entry) => entry.action === 'reportTask');
    assert.equal(report.length, 1);
    assert.equal(report[0].payload.exitCode, 5);
    assert.equal(report[0].payload.output.error.code, 'CLEANUP_FAILED');
    assert.equal(report[0].payload.output.enrollment.employeeNo, task.employeeNo, '设备事实保留');
    assert.ok(!Object.hasOwn(report[0].payload.output, 'cleanup'), '不得谎报清理成功字段');
  } finally {
    process.stderr.write = original;
  }
});

test('R08/R09：内存路径不产生任何照片文件/临时目录（worker 目录与测试目录均无残留）', async () => {
  const cfg = await config();
  const task = makeTask();
  const scratch = await mkdtemp(join(tmpdir(), 'checkin-face-nofile-'));
  const beforeWorker = new Set(await readdir(WORKER_DIR));
  const client = {
    callFunction: async (action, payload) => {
      if (action === 'claimTask') return { task };
      if (action === 'beginTaskExecution') return { task: authorizedSnapshot(task), authorizedAt: task.claimExpiresAt - 5000 };
      return { ok: true };
    },
    downloadFile: async () => Buffer.from(JPEG),
  };
  const original = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const code = await main({
      argv: ['--once'], env: {}, loadConfig: async () => cfg, createClient: async () => client,
      platform: 'win32', stdout: { write: () => {} },
      runEnrollmentImpl: async () => ({ exitCode: 0, output: { protocolVersion: 1, outcome: 'device-enrollment-confirmed-pending-site', mode: 'device', validityMode: 'fixed', siteVerification: 'PENDING', enrollment: null } }),
    });
    assert.equal(code, 0);
    const afterWorker = new Set(await readdir(WORKER_DIR));
    assert.deepEqual([...afterWorker].sort(), [...beforeWorker].sort(), 'worker 目录不得新增任何文件（无照片落盘）');
    assert.deepEqual(await readdir(scratch), [], '测试工作目录无任何残留');
    assert.ok(!afterWorker.has('.data'), '不得创建 .data 临时目录');
  } finally {
    process.stderr.write = original;
    await rm(scratch, { recursive: true, force: true });
  }
});

test('R08：runEnrollment 包装不绕过材料校验——证书读取失败关闭为 invalid-input(2)', async () => {
  const cfg = await config();
  const request = buildInMemoryDeviceRequest(makeTask(), cfg);
  const wrapped = await runEnrollment(request, {
    run: runInMemoryEnrollment,
    config: cfg,
    photoBuffer: JPEG,
    commandDeps: { platform: 'win32' },
  });
  assert.equal(wrapped.exitCode, 2);
  assert.equal(wrapped.output.outcome, 'invalid-input');
  assert.equal(wrapped.output.error.code, 'CERTIFICATE_FILE_INVALID');
});
