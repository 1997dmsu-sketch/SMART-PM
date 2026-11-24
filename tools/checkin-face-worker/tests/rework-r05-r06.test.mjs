/**
 * R05/R06 场景矩阵（合成假云 + 计数假设备执行器，无监听、无真实网络）。
 *
 * 断言：前置拒绝 0 次执行器调用、合法路径恰好 1 次；云错误/重复 report/未知事实不触发第二次登记；
 * 过期/下载中到期/准备后撤权/改租期/改绑定/复核不可用均零执行；同一未失效快照正例。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkerConfig, WorkerConfigError } from '../worker-runtime.mjs';
import { AuthorizationError, authorizeTaskExecution } from '../execution-authorization.mjs';
import { main } from '../claim-and-enroll.mjs';

const TOKEN = 'SyntheticWorkerToken-0123456789abcdef';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0, 1, 0xff, 0xd9]);

const baseConfig = {
  cloudEnv: 'synthetic-cloud-env', workerId: 'synthetic-worker-01', deviceKey: 'device-key-stable',
  name: '合成人员', roomNote: '102',
  device: {
    origin: 'https://synthetic-device.invalid', certificatePath: 'C:/synthetic/private/public.cer',
    expectedModel: 'DS-K1T671BM', planTemplateNo: '1', developmentTls: false,
  },
};

async function config(overrides = {}) {
  return loadWorkerConfig({
    configPath: 'C:/synthetic/worker.local.json',
    env: {
      CHECKIN_FACE_WORKER_TOKEN: TOKEN,
      CHECKIN_FACE_DEVICE_USERNAME: 'synthetic-device-admin',
      CHECKIN_FACE_DEVICE_PASSWORD: 'synthetic-device-password-only',
    },
    readJsonFile: async () => JSON.stringify({ ...baseConfig, ...overrides }),
  });
}

function makeTask({ nowMs = Date.now(), ...overrides } = {}) {
  return {
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

const SUCCESS_OUTPUT = {
  protocolVersion: 1,
  outcome: 'device-enrollment-confirmed-pending-site',
  mode: 'device',
  validityMode: 'fixed',
  siteVerification: 'PENDING',
  enrollment: null,
};

/**
 * 计数假设备执行器 + 假云。begin 行为可配置：
 *   begin = 'ok' | {data} | {throw} | {reject}（云端非零码，带 cloudCode）
 */
function harness({ task, begin = 'ok', cfg = null, downloadDelayMs = 0, clock = null, reportThrows = false } = {}) {
  const calls = [];
  let executorCalls = 0;
  const executor = async () => { executorCalls += 1; return { exitCode: 0, output: SUCCESS_OUTPUT }; };
  const cloud = {
    callFunction: async (action, payload) => {
      calls.push({ action, payload });
      if (action === 'claimTask') return { task };
      if (action === 'beginTaskExecution') {
        if (begin === 'throw') throw new Error('synthetic network failure');
        if (begin === 'reject') { const error = new Error('cloud rejected'); error.cloudCode = 'EXECUTION_INVALIDATED'; throw error; }
        if (begin && typeof begin === 'object') return begin;
        return { task: authorizedSnapshot(task), authorizedAt: task.claimExpiresAt - 5000 };
      }
      if (action === 'reportTask') {
        if (reportThrows) throw new Error('report delivery failure');
        return { ok: true };
      }
      throw new Error(`unexpected action ${action}`);
    },
    downloadFile: async () => {
      calls.push({ action: 'downloadFile' });
      if (downloadDelayMs > 0) await new Promise((done) => setTimeout(done, downloadDelayMs));
      return Buffer.from(JPEG);
    },
  };
  const nowMs = () => (clock ? clock() : Date.now());
  return {
    calls,
    executorCalls: () => executorCalls,
    run: async () => main({
      argv: ['--once'], env: {}, loadConfig: async () => cfg, createClient: async () => cloud,
      platform: 'win32', stdout: { write: () => {} },
      runEnrollmentImpl: executor, nowMs,
    }),
  };
}

function silent(run) {
  const original = process.stderr.write;
  process.stderr.write = () => true;
  try { return run(); } finally { process.stderr.write = original; }
}

function lastReport(calls) {
  const reports = calls.filter((entry) => entry.action === 'reportTask');
  return reports[reports.length - 1]?.payload || null;
}

test('R05：任务缺/空/不同 deviceKey → 0 次执行器、0 次 begin、上报 exit 2（invalid-input）', async () => {
  const cfg = await config();
  const cases = [
    ['task-missing', { ...makeTask(), deviceKey: undefined }],
    ['task-empty', { ...makeTask(), deviceKey: '' }],
    ['task-different', { ...makeTask(), deviceKey: 'another-door-key' }],
  ];
  for (const [label, badTask] of cases) {
    const h = harness({ task: badTask, cfg });
    const code = await silent(() => h.run());
    assert.equal(code, 2, `${label} 应退出 2`);
    assert.equal(h.executorCalls(), 0, `${label} 前置拒绝必须 0 次执行器`);
    assert.deepEqual(h.calls.filter((e) => e.action !== 'downloadFile').map((e) => e.action), ['claimTask', 'reportTask'], `${label} 不得调用 begin`);
    assert.equal(lastReport(h.calls).exitCode, 2);
  }
});

test('R05：本地配置缺 deviceKey（main 注入路径）→ 0 次执行器、上报 exit 2', async () => {
  const cfgNoKey = { ...(await config()), deviceKey: '' };
  const h = harness({ task: makeTask(), cfg: cfgNoKey });
  const code = await silent(() => h.run());
  assert.equal(code, 2);
  assert.equal(h.executorCalls(), 0);
  assert.equal(lastReport(h.calls).exitCode, 2);
  assert.ok(lastReport(h.calls).output.error.code.includes('DEVICE_KEY'), '错误码须为 deviceKey 类');
});

test('R05：本地配置缺 deviceKey 在 loadWorkerConfig 即失败（WorkerConfigError）', async () => {
  await assert.rejects(() => config({ deviceKey: '   ' }), (error) => error instanceof WorkerConfigError && error.code === 'DEVICE_KEY_MISSING');
});

test('R06：领取时已过期 → 0 次执行器、0 次 begin、上报 exit 5 BEGIN_AUTH_EXPIRED', async () => {
  const cfg = await config();
  const expired = makeTask({ nowMs: Date.now(), claimExpiresAt: Date.now() - 1 });
  const h = harness({ task: expired, cfg });
  const code = await silent(() => h.run());
  assert.equal(code, 5);
  assert.equal(h.executorCalls(), 0);
  assert.equal(h.calls.filter((e) => e.action === 'beginTaskExecution').length, 0, '过期任务不得发起 begin');
  const report = lastReport(h.calls);
  assert.equal(report.exitCode, 5);
  assert.equal(report.output.error.code, 'BEGIN_AUTH_EXPIRED');
});

test('R06：下载中到期（可控时钟推进）→ 0 次执行器、0 次 begin、上报 exit 5', async () => {
  const cfg = await config();
  let clockValue = Date.now();
  const task = makeTask({ nowMs: clockValue, claimExpiresAt: clockValue + 500 });
  const h = harness({
    task, cfg, clock: () => clockValue,
    downloadDelayMs: 10,
  });
  // 下载完成后把时钟推到 claim 到期之后（模拟下载耗时至过期）。
  const code = await silent(async () => {
    const promise = h.run();
    setTimeout(() => { clockValue += 2000; }, 1);
    return promise;
  });
  assert.equal(code, 5);
  assert.equal(h.executorCalls(), 0);
  assert.equal(h.calls.filter((e) => e.action === 'beginTaskExecution').length, 0);
  assert.equal(lastReport(h.calls).output.error.code, 'BEGIN_AUTH_EXPIRED');
});

test('R06：准备后撤权/改租期/改绑定（快照字段不一致）→ 0 次执行器、上报 exit 5 BEGIN_SNAPSHOT_MISMATCH', async () => {
  const cfg = await config();
  const task = makeTask();
  const tampered = [
    ['改租期', { ...authorizedSnapshot(task), validTo: '2026-12-31T23:59:59' }],
    ['改绑定', { ...authorizedSnapshot(task), deviceKey: 'other-door-key' }],
    ['撤权状态未推进', { ...authorizedSnapshot(task), status: 'INVALIDATED' }],
  ];
  for (const [label, snapshot] of tampered) {
    const h = harness({ task, cfg, begin: { task: snapshot, authorizedAt: task.claimExpiresAt - 5000 } });
    const code = await silent(() => h.run());
    assert.equal(code, 5, `${label} 应退出 5`);
    assert.equal(h.executorCalls(), 0, `${label} 必须零执行`);
    assert.equal(h.calls.filter((e) => e.action === 'beginTaskExecution').length, 1, `${label} begin 恰好一次`);
    const report = lastReport(h.calls);
    assert.equal(report.exitCode, 5);
    assert.equal(report.output.error.code, 'BEGIN_SNAPSHOT_MISMATCH');
  }
});

test('R06：复核云端拒绝（非零码）→ BEGIN_AUTH_REJECTED:<云码>，0 次执行器，begin 不重试', async () => {
  const cfg = await config();
  const h = harness({ task: makeTask(), cfg, begin: 'reject' });
  const code = await silent(() => h.run());
  assert.equal(code, 5);
  assert.equal(h.executorCalls(), 0);
  assert.equal(h.calls.filter((e) => e.action === 'beginTaskExecution').length, 1, '拒绝后不得重试 begin');
  assert.equal(lastReport(h.calls).output.error.code, 'BEGIN_AUTH_REJECTED:EXECUTION_INVALIDATED');
});

test('R06：清单 §2.4 服务端码逐条原样映射为 BEGIN_AUTH_REJECTED:<码>（不编造服务端码）', async () => {
  const codes = [
    'WORKER_UNAUTHORIZED', 'INVALID_WORKER_TOKEN', 'INVALID_WORKER_ID', 'INVALID_TASK_ID',
    'INVALID_CLAIM_ID', 'INVALID_REVISION', 'CLIENT_FIELD_FORBIDDEN', 'UNKNOWN_FIELD',
    'TASK_NOT_FOUND', 'CLAIM_MISMATCH', 'REVISION_CONFLICT', 'WORKER_MISMATCH',
    'TASK_NOT_CLAIMED', 'EXECUTION_ALREADY_STARTED', 'CLAIM_EXPIRED', 'EXECUTION_INVALIDATED',
    'TRANSACTION_UNAVAILABLE', 'TX_UNSUPPORTED_QUERY', 'INTERNAL_ERROR',
  ];
  for (const serverCode of codes) {
    const cloud = {
      callFunction: async () => {
        const error = new Error('cloud rejected');
        error.cloudCode = serverCode;
        throw error;
      },
    };
    await assert.rejects(
      () => authorizeTaskExecution({ cloud, config: {}, task: makeTask(), workerId: 'synthetic-worker-01' }),
      (error) => error instanceof AuthorizationError && error.code === `BEGIN_AUTH_REJECTED:${serverCode}`,
      `${serverCode} 必须原样透传`,
    );
  }
  const weird = {
    callFunction: async () => {
      const error = new Error('cloud rejected');
      error.cloudCode = 'not a code!';
      throw error;
    },
  };
  await assert.rejects(
    () => authorizeTaskExecution({ cloud: weird, config: {}, task: makeTask(), workerId: 'synthetic-worker-01' }),
    (error) => error instanceof AuthorizationError && error.code === 'BEGIN_AUTH_REJECTED:CLOUD_REJECTED',
    '畸形码以本地兜底标签 CLOUD_REJECTED 表示，不冒充服务端码',
  );
  const network = {
    callFunction: async () => { throw new Error('network down'); },
  };
  await assert.rejects(
    () => authorizeTaskExecution({ cloud: network, config: {}, task: makeTask(), workerId: 'synthetic-worker-01' }),
    (error) => error instanceof AuthorizationError && error.code === 'BEGIN_AUTH_UNAVAILABLE',
  );
});

test('R06：复核不可用（网络失败/回执未知）→ BEGIN_AUTH_UNAVAILABLE，0 次执行器', async () => {
  const cfg = await config();
  const h = harness({ task: makeTask(), cfg, begin: 'throw' });
  const code = await silent(() => h.run());
  assert.equal(code, 5);
  assert.equal(h.executorCalls(), 0);
  assert.equal(h.calls.filter((e) => e.action === 'beginTaskExecution').length, 1);
  assert.equal(lastReport(h.calls).output.error.code, 'BEGIN_AUTH_UNAVAILABLE');
});

test('R06：复核返回缺字段/仅回显 → BEGIN_AUTH_UNAVAILABLE，0 次执行器', async () => {
  const cfg = await config();
  const task = makeTask();
  for (const begin of [{ ok: true }, { task: authorizedSnapshot(task) }, { authorizedAt: 123 }]) {
    const h = harness({ task, cfg, begin });
    const code = await silent(() => h.run());
    assert.equal(code, 5);
    assert.equal(h.executorCalls(), 0);
    assert.equal(lastReport(h.calls).output.error.code, 'BEGIN_AUTH_UNAVAILABLE');
  }
});

test('R06：同一未失效快照正例 → 执行器恰好 1 次、report revision+1、begin 请求只含规定字段', async () => {
  const cfg = await config();
  const task = makeTask();
  const h = harness({ task, cfg });
  const code = await silent(() => h.run());
  assert.equal(code, 0);
  assert.equal(h.executorCalls(), 1, '合法路径必须恰好 1 次执行器');
  const actions = h.calls.map((e) => e.action);
  assert.deepEqual(actions, ['claimTask', 'downloadFile', 'beginTaskExecution', 'reportTask']);
  const beginPayload = h.calls.find((e) => e.action === 'beginTaskExecution').payload;
  assert.deepEqual(Object.keys(beginPayload).sort(), ['claimId', 'revision', 'taskId', 'workerId', 'workerToken'].sort());
  assert.equal(beginPayload.workerToken, TOKEN);
  assert.equal(beginPayload.workerId, 'synthetic-worker-01');
  assert.equal(beginPayload.taskId, task.taskId);
  assert.equal(beginPayload.claimId, task.claimId);
  assert.equal(beginPayload.revision, task.revision);
  const report = lastReport(h.calls);
  assert.equal(report.exitCode, 0);
  assert.equal(report.revision, task.revision + 1, 'report 使用推进后 revision');
  assert.equal(report.output.outcome, 'device-enrollment-confirmed-pending-site');
});

test('R06：报告递送失败 → 恰好一次 report、执行器仍为 1 次、进程退出 3（不重发、不重试）', async () => {
  const cfg = await config();
  const h = harness({ task: makeTask(), cfg, reportThrows: true });
  const code = await silent(() => h.run());
  assert.equal(code, 3);
  assert.equal(h.executorCalls(), 1);
  assert.equal(h.calls.filter((e) => e.action === 'reportTask').length, 1, '上报失败不得重发');
});
