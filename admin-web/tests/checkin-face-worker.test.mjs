/**
 * B05 / §6 — 本地受控 worker 构造与退出码合成测试。
 *
 * 断言显式 device+fixed、缺项拒绝、未知结果收敛为 5/stopped、
 * 一次 claim 一次 report 不重试、输出白名单脱敏、无监听端口/远程开门。
 * 本测试不接触真实门禁，也不代表现场刷脸通过。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  WorkerInputError,
  buildDeviceRequest,
  buildReportPayload,
  loadWorkerConfig,
  runEnrollment,
  safeConfigView,
  safeLog,
  sanitizeEnrollmentOutput,
} from '../../tools/checkin-face-worker/worker-runtime.mjs';
import { main } from '../../tools/checkin-face-worker/claim-and-enroll.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKEN = 'SyntheticWorkerToken-0123456789abcdef';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0, 1, 0xff, 0xd9]);

const localConfig = {
  cloudEnv: 'synthetic-cloud-env', workerId: 'synthetic-worker-01', deviceKey: 'device-key-stable',
  name: '合成人员', roomNote: '102',
  device: {
    origin: 'https://synthetic-device.invalid', certificatePath: 'C:/synthetic/private/public.cer',
    expectedModel: 'DS-K1T671BM', planTemplateNo: '1', developmentTls: false,
  },
};

async function config() {
  return loadWorkerConfig({
    configPath: 'C:/synthetic/worker.local.json',
    env: {
      CHECKIN_FACE_WORKER_TOKEN: TOKEN,
      CHECKIN_FACE_DEVICE_USERNAME: 'synthetic-device-admin',
      CHECKIN_FACE_DEVICE_PASSWORD: 'synthetic-device-password-only',
    },
    readJsonFile: async () => JSON.stringify(localConfig),
  });
}

const task = {
  taskId: 'checkin-face-test|task|app-1',
  applicationId: 'checkin-face-test|application|app-1',
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
  cloudPath: 'test-face/checkin-face-test/openid/app-1/photo.jpg',
  accessPlanFingerprint: 'a'.repeat(64),
};

async function withSilentStderr(run) {
  const original = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try { return { value: await run(), lines }; }
  finally { process.stderr.write = original; }
}

test('worker 读取本地配置：明文秘密不可枚举、日志视图不含秘密', async () => {
  const cfg = await config();
  assert.equal(cfg.workerToken, TOKEN);
  assert.equal(cfg.device.devicePassword, 'synthetic-device-password-only');
  assert.deepEqual(JSON.stringify(cfg).includes(TOKEN), false);
  assert.deepEqual(JSON.stringify(cfg.device).includes('synthetic-device-password-only'), false);
  const view = safeConfigView(cfg);
  assert.deepEqual(view, {
    environment: 'checkin-face-test', cloudEnv: 'synthetic-cloud-env', workerId: 'synthetic-worker-01',
    deviceKey: 'device-key-stable', functionName: 'checkinFaceTest', workerTokenEnv: 'CHECKIN_FACE_WORKER_TOKEN',
  });
  await assert.rejects(() => loadWorkerConfig({
    configPath: 'C:/synthetic/none.local.json', env: {},
    readJsonFile: async () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; },
  }), (error) => error.code === 'WORKER_TOKEN_MISSING');
});

test('buildDeviceRequest 显式 mode=device/validityMode=fixed，日期/门号/编号来自任务', async () => {
  const cfg = await config();
  const request = buildDeviceRequest(task, cfg, 'C:/synthetic/temp/photo.jpg');
  assert.equal(request.mode, 'device');
  assert.equal(request.validityMode, 'fixed');
  assert.equal(request.consent, true);
  assert.equal(request.employeeNo, task.employeeNo);
  assert.equal(request.doorNo, 7, '不得回落到命令默认门号 1');
  assert.equal(request.validFrom, task.validFrom);
  assert.equal(request.validTo, task.validTo);
  assert.equal(request.origin, 'https://synthetic-device.invalid/');
  assert.equal(request.password, 'synthetic-device-password-only');
  assert.equal(request.certificatePath, resolve('C:/synthetic/private/public.cer'));
  assert.equal(request.planTemplateNo, '1');
  assert.equal(Object.isFrozen(request), true);
  assert.deepEqual(Object.keys(request).sort(), [
    'certificatePath', 'consent', 'developmentTls', 'doorNo', 'employeeNo', 'expectedModel',
    'mode', 'name', 'origin', 'password', 'photoPath', 'planTemplateNo', 'room',
    'username', 'validFrom', 'validTo', 'validityMode',
  ].sort());
});

test('缺日期/门号/编号或任务试图降级 simulation/unlimited 均拒绝', async () => {
  const cfg = await config();
  const without = (row, key) => { const copy = { ...row }; delete copy[key]; return copy; };
  const cases = [
    [without(task, 'validFrom'), 'TASK_FIELD_MISSING'],
    [without(task, 'validTo'), 'TASK_FIELD_MISSING'],
    [without(task, 'doorNo'), 'TASK_FIELD_MISSING'],
    [without(task, 'employeeNo'), 'TASK_FIELD_MISSING'],
    [{ ...task, doorNo: 0 }, 'TASK_FIELD_INVALID'],
    [{ ...task, validFrom: '2026-12-01' }, 'TASK_FIELD_INVALID'],
    [{ ...task, mode: 'simulation' }, 'TASK_MODE_CONFLICT'],
    [{ ...task, validityMode: 'unlimited' }, 'TASK_VALIDITY_CONFLICT'],
    [{ ...task, validFrom: '2026-12-06T00:00:00' }, 'TASK_DATE_ORDER'],
  ];
  for (const [input, code] of cases) {
    let error = null;
    try { buildDeviceRequest(input, cfg, 'C:/synthetic/temp/p.jpg'); }
    catch (caught) { error = caught; }
    assert.ok(error instanceof WorkerInputError, `${code} 必须抛 WorkerInputError`);
    assert.equal(error.code, code, `${code} 期望`);
    assert.equal(error.exitCode, 2, '配置/任务缺项对应预检失败退出码 2');
  }
});

test('runEnrollment：未知 outcome / 非 device / 运行异常统一 exitCode 5 + stopped，不重试', async () => {
  const cfg = await config();
  let calls = 0;
  const output = {
    protocolVersion: 1, outcome: 'mystery-outcome', mode: 'device', validityMode: 'fixed',
    siteVerification: 'PENDING', enrollment: null,
  };
  const result = await runEnrollment(task, {
    run: async () => { calls += 1; return { exitCode: 3, output }; }, config: cfg,
  });
  assert.equal(calls, 1, '不得重试');
  assert.equal(result.exitCode, 5);
  assert.equal(result.output.outcome, 'stopped');
  assert.equal(result.output.error.code, 'UNKNOWN_RESULT');

  const simulation = await runEnrollment(task, {
    run: async () => ({ exitCode: 0, output: { ...output, outcome: 'simulation-completed', mode: 'simulation' } }), config: cfg,
  });
  assert.equal(simulation.exitCode, 5, 'simulation 不得被记作设备成功');
  assert.equal(simulation.output.outcome, 'stopped');

  const thrown = await runEnrollment(task, {
    run: async () => { throw new Error('device secret must not surface'); }, config: cfg,
  });
  assert.equal(thrown.exitCode, 5);
  assert.equal(thrown.output.outcome, 'stopped');
  assert.ok(!JSON.stringify(thrown).includes('device secret must not surface'));
});

test('buildReportPayload 只接受 0/2/4/5，字段仅从任务取，附加 employeeNo/日期不进载荷', async () => {
  const cfg = await config();
  for (const exitCode of [0, 2, 4, 5]) {
    const payload = buildReportPayload(task, { exitCode, output: { protocolVersion: 1, outcome: 'failed' } }, cfg);
    assert.equal(payload.workerToken, TOKEN);
    assert.deepEqual({ taskId: payload.taskId, claimId: payload.claimId, revision: payload.revision }, { taskId: task.taskId, claimId: task.claimId, revision: task.revision });
    assert.ok(!Object.hasOwn(payload, 'employeeNo'));
    assert.ok(!Object.hasOwn(payload, 'validFrom'));
    assert.ok(!Object.hasOwn(payload, 'validTo'));
  }
  for (const exitCode of [1, 3, 6, '0', undefined]) {
    assert.throws(() => buildReportPayload(task, { exitCode, output: {} }, cfg), WorkerInputError);
  }
});

test('sanitizeEnrollmentOutput 剔除附加键与设备秘密，device 段只留型号/固件', async () => {
  const cfg = await config();
  const raw = {
    protocolVersion: 99, outcome: 'failed', mode: 'device',
    password: 'synthetic-device-password-only', origin: 'https://synthetic-device.invalid', privateKey: 'synthetic-private-key',
    message: `token ${TOKEN} password synthetic-device-password-only`,
    device: { model: 'DS-K1T671BM', firmware: 'V3.3', origin: 'https://synthetic-device.invalid', password: 'synthetic-device-password-only' },
    enrollment: { employeeNo: task.employeeNo, faceAssociationConfirmed: true, steps: [{ key: 'verify', state: 'success', extra: 'x' }], injectedSecret: TOKEN },
    extraInjectedKey: 'drop-me',
  };
  const clean = sanitizeEnrollmentOutput(raw, cfg, 'C:/synthetic/temp/private-photo.jpg');
  assert.equal(clean.device.model, 'DS-K1T671BM');
  assert.deepEqual(Object.keys(clean.device).sort(), ['firmware', 'model']);
  assert.equal(clean.enrollment.employeeNo, task.employeeNo);
  assert.deepEqual(clean.enrollment.steps[0], { key: 'verify', label: '', state: 'success', message: '' });
  assert.ok(!Object.hasOwn(clean, 'password'));
  assert.ok(!Object.hasOwn(clean, 'origin'));
  assert.ok(!Object.hasOwn(clean, 'privateKey'));
  assert.ok(!Object.hasOwn(clean, 'extraInjectedKey'));
  assert.ok(!Object.hasOwn(clean.enrollment, 'injectedSecret'));
  const serialized = JSON.stringify(clean);
  for (const secret of [TOKEN, 'synthetic-device-password-only', 'https://synthetic-device.invalid', 'synthetic-private-key']) {
    assert.ok(!serialized.includes(secret), `输出泄漏 ${secret}`);
  }
});

test('safeLog 结构化脱敏：token/密码/origin/员工号不留明文', async () => {
  const cfg = await config();
  const { lines } = await withSilentStderr(async () => {
    safeLog('info', `worker token ${TOKEN} origin https://synthetic-device.invalid`, {
      taskId: task.taskId, employeeNo: task.employeeNo, workerId: 'synthetic-worker-01',
      password: 'synthetic-device-password-only', mode: 'device', validityMode: 'fixed',
      exitCode: 4, doorNo: 7,
    }, cfg);
  });
  assert.equal(lines.length, 1);
  const line = lines[0];
  for (const secret of [TOKEN, 'synthetic-device-password-only', 'https://synthetic-device.invalid', task.employeeNo, task.taskId, task.claimId]) {
    assert.ok(!line.includes(secret), `日志泄漏 ${secret}`);
  }
  assert.ok(!line.includes('password'), '白名单之外字段不得出现在日志');
  assert.match(line, /"validityMode":"fixed"/);
  assert.match(line, /"exitCode":4/);
});

test('worker 主流程一次 claim + 一次 report；退出码 4/5 按结果映射，不重试', async () => {
  for (const [exitCode, output, expected] of [
    [4, { protocolVersion: 1, outcome: 'failed', mode: 'device', validityMode: 'fixed', siteVerification: 'PENDING' }, 4],
    [5, { protocolVersion: 1, outcome: 'stopped', mode: 'device', validityMode: 'fixed', siteVerification: 'PENDING' }, 5],
  ]) {
    const dir = await mkdtemp(join(tmpdir(), 'checkin-face-worker-test-'));
    const actions = [];
    let runs = 0;
    const cfg = await config();
    const client = {
      callFunction: async (action, payload) => {
        actions.push({ action, payload });
        return action === 'claimTask' ? { task } : { ok: true };
      },
      downloadFile: async () => JPEG,
    };
    try {
      const { value: code, lines } = await withSilentStderr(() => main({
        argv: ['--once'], env: {}, loadConfig: async () => cfg, createClient: async () => client,
        dataDir: dir, platform: 'win32', stdout: { write: () => {} },
        runEnrollmentImpl: async () => { runs += 1; return { exitCode, output }; },
      }));
      assert.equal(code, expected);
      assert.equal(runs, 1);
      assert.deepEqual(actions.map((entry) => entry.action), ['claimTask', 'reportTask'], '一次 claim 一次 report，无重试');
      assert.equal(actions[0].payload.workerToken, TOKEN);
      assert.equal(actions[1].payload.exitCode, exitCode);
      assert.ok(!JSON.stringify(lines).includes(TOKEN));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test('worker 空闲只 claim 不 report；example JSON device 段全空；代码无监听/开门/重排队', async () => {
  const cfg = await config();
  const actions = [];
  const { value: code } = await withSilentStderr(() => main({
    argv: ['--once'], env: {}, loadConfig: async () => cfg,
    createClient: async () => ({ callFunction: async (action) => { actions.push(action); return { task: null }; }, downloadFile: async () => JPEG }),
    dataDir: join(tmpdir(), 'unused'), platform: 'win32', stdout: { write: () => {} },
  }));
  assert.equal(code, 0);
  assert.deepEqual(actions, ['claimTask']);

  const example = JSON.parse(await readFile(join(ROOT, 'tools/checkin-face-worker/worker-config.example.json'), 'utf8'));
  for (const [key, value] of Object.entries(example.device)) {
    assert.ok(value === '' || value === false, `example.device.${key} 必须留空，实际 ${JSON.stringify(value)}`);
  }
  for (const file of ['worker-runtime.mjs', 'claim-and-enroll.mjs']) {
    const source = await readFile(join(ROOT, 'tools/checkin-face-worker', file), 'utf8');
    assert.ok(!/createServer\s*\(|\.listen\s*\(|0\.0\.0\.0/.test(source), `${file} 不得开监听端口`);
    assert.ok(!/\bunlockDevice\s*\(|\bunlock\s*\(/.test(source), `${file} 不得远程开门`);
    assert.ok(!/\brequeue\b/i.test(source.replace(/(?:no|not|不)\s*requeue/gi, '')), `${file} 不得有 requeue 入口`);
  }
});
