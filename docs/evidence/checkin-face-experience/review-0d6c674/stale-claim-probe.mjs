import assert from 'node:assert/strict';
import { main } from '/workspace/SMART-PM-review-checkin-face-0d6c674/tools/checkin-face-worker/claim-and-enroll.mjs';
const calls = [];
const config = {
  environment: 'checkin-face-test', cloudEnv: 'synthetic-env', workerId: 'synthetic-worker',
  workerToken: 'synthetic-token-0123456789', deviceKey: 'synthetic-device-a', name: 'synthetic', roomNote: '102',
  device: { deviceOrigin: 'https://synthetic-device.invalid/', deviceUsername: 'synthetic', devicePassword: 'synthetic-only', deviceCertificatePath: '/synthetic/public.cer', expectedModel: 'DS-K1T671BM', planTemplateNo: '1', developmentTls: false },
};
const task = {
  taskId: 'synthetic|task', applicationId: 'synthetic|application', claimId: '11111111-2222-4333-8444-555555555555', revision: 2,
  name: 'synthetic', employeeNo: 'F0123456789ABCDEF', doorNo: 7,
  validFrom: '2026-12-01T00:00:00', validTo: '2026-12-05T23:59:59', timezone: 'Asia/Shanghai', dailyHours: '24x7',
  deviceKey: 'synthetic-device-a', fileId: 'cloud://synthetic-env.bucket/test-face/photo.jpg', accessPlanFingerprint: 'a'.repeat(64),
  claimExpiresAt: Date.now() - 1000,
};
let enrollmentCalls = 0;
const code = await main({
  argv: ['--once'], env: {}, platform: 'win32',
  dataDir: '/workspace/artifacts/checkin-face-review-0d6c674-20261124/stale-claim-owned-temp',
  loadConfig: async () => config,
  createClient: async () => ({
    callFunction: async (action) => { calls.push(action); return action === 'claimTask' ? { task } : {}; },
    downloadFile: async () => { calls.push('downloadFile'); return Buffer.from([255, 216, 255, 0]); },
  }),
  runEnrollmentImpl: async () => {
    calls.push('syntheticDeviceExecutor'); enrollmentCalls++;
    return { exitCode: 4, output: { protocolVersion: 1, outcome: 'failed', mode: 'device', validityMode: 'fixed', error: { code: 'SYNTHETIC_STOP', message: 'synthetic only' } } };
  },
});
assert.equal(enrollmentCalls, 1);
assert.deepEqual(calls, ['claimTask', 'downloadFile', 'syntheticDeviceExecutor', 'reportTask']);
console.log(JSON.stringify({ scope: 'synthetic-only-no-device-call', id: 'EXPIRED_CLAIM_EXECUTOR_REACHED', expiredBeforeExecution: true, enrollmentCalls, cloudActions: calls.filter(x => x === 'claimTask' || x === 'reportTask'), observedExitCode: code }, null, 2));
