/**
 * C-R06-03: review-only synthetic observation of the actual worker main.
 * No project test runner, SDK, real config, network, device, or candidate writes.
 * Run only with review-network-guard.cjs preloaded.
 * Exit 0 means the asserted revision-loss defect was observed, not acceptance.
 */
import assert from 'node:assert/strict';
import { main } from '/workspace/SMART-PM-review-checkin-face-5398d1e/tools/checkin-face-worker/claim-and-enroll.mjs';

const BEFORE_DEADLINE = 1_800_000_000_000;
const DEADLINE = BEFORE_DEADLINE + 300_000;
const config = {
  environment: 'synthetic-review',
  cloudEnv: 'synthetic-cloud-env',
  workerId: 'synthetic-worker-01',
  workerToken: 'synthetic-review-token-only',
  deviceKey: 'device-key-stable',
  name: 'synthetic-person',
  roomNote: '102',
  device: {},
};
const task = {
  taskId: 'checkin-face-test|task|app-1',
  applicationId: 'checkin-face-test|application|app-1',
  claimId: '11111111-2222-4333-8444-555555555555',
  revision: 2,
  name: 'synthetic-person',
  employeeNo: 'F0123456789ABCDEF',
  doorNo: 7,
  validFrom: '2026-12-01T00:00:00',
  validTo: '2026-12-05T23:59:59',
  timezone: 'Asia/Shanghai',
  dailyHours: '24x7',
  deviceKey: config.deviceKey,
  fileId: 'cloud://synthetic/test-face/photo.jpg',
  cloudPath: 'test-face/checkin-face-test/openid/app-1/photo.jpg',
  accessPlanFingerprint: 'a'.repeat(64),
  claimExpiresAt: DEADLINE,
};
const snapshot = {
  ...task,
  status: 'DEVICE_PROCESSING',
  revision: 3,
  configRevision: 3,
  roomRevision: 5,
  leaseRevision: 7,
  roomBindingId: 'checkin-face-test|room|102',
  leaseSnapshotId: 'checkin-face-test|lease|1',
  workerId: config.workerId,
  authorizedAt: DEADLINE - 5_000,
};
const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0, 1, 0xff, 0xd9]);
const actions = [];
const times = [];
let beginCommitted = false;
let cloudRevision = 2;
let deviceCalls = 0;
let downloadCalls = 0;
let submittedReport = null;
let reportRejected = false;

const cloud = {
  async callFunction(action, payload) {
    actions.push(action);
    if (action === 'claimTask') {
      assert.equal(payload.workerId, config.workerId);
      return { task: structuredClone(task) };
    }
    if (action === 'beginTaskExecution') {
      assert.equal(payload.taskId, task.taskId);
      assert.equal(payload.claimId, task.claimId);
      assert.equal(payload.revision, 2);
      assert.equal(payload.workerId, config.workerId);
      assert.equal(cloudRevision, 2);
      // Synthetic authoritative commit before the actual authorization verifier returns.
      cloudRevision = 3;
      beginCommitted = true;
      return { task: structuredClone(snapshot), authorizedAt: snapshot.authorizedAt };
    }
    if (action === 'reportTask') {
      submittedReport = structuredClone(payload);
      if (payload.revision !== cloudRevision) {
        reportRejected = true;
        const error = new Error('synthetic revision conflict');
        error.code = 'REVISION_CONFLICT';
        error.cloudCode = 'REVISION_CONFLICT';
        throw error;
      }
      throw new Error('The expected defect was not observed: report used the current revision.');
    }
    throw new Error('Unexpected synthetic action');
  },
  async downloadFile(fileId) {
    assert.equal(fileId, task.fileId);
    downloadCalls++;
    return photo;
  },
};

const mainExitCode = await main({
  argv: ['--once'],
  env: {},
  loadConfig: async () => config,
  createClient: async () => cloud,
  platform: 'win32',
  runEnrollmentImpl: async () => {
    deviceCalls++;
    throw new Error('Device executor must not be reached by this synthetic probe.');
  },
  nowMs: () => {
    const value = beginCommitted ? DEADLINE : BEFORE_DEADLINE;
    times.push({ beginCommitted, value });
    return value;
  },
});

assert.deepEqual(actions, ['claimTask', 'beginTaskExecution', 'reportTask']);
assert.equal(downloadCalls, 1);
assert.deepEqual(times, [
  { beginCommitted: false, value: BEFORE_DEADLINE },
  { beginCommitted: false, value: BEFORE_DEADLINE },
  { beginCommitted: true, value: DEADLINE },
]);
assert.equal(cloudRevision, 3);
assert.equal(submittedReport?.revision, 2);
assert.equal(submittedReport?.exitCode, 5);
assert.equal(submittedReport?.output?.outcome, 'stopped');
assert.equal(submittedReport?.output?.error?.code, 'BEGIN_AUTH_EXPIRED');
assert.equal(reportRejected, true);
assert.equal(mainExitCode, 3);
assert.equal(deviceCalls, 0);
assert.equal(photo.every((value) => value === 0), true);

console.log(JSON.stringify({
  probe: 'C-R06-03',
  scope: 'synthetic-only-actual-worker-main',
  observation: 'defect-observed-not-acceptance',
  actions,
  nowMsCalls: times.length,
  nowMsBeforeBegin: times.filter((row) => !row.beginCommitted).length,
  finalNowEqualsDeadline: times.at(-1).value === DEADLINE,
  cloudPersistedRevision: cloudRevision,
  reportedRevision: submittedReport.revision,
  reportExitCode: submittedReport.exitCode,
  reportErrorCode: submittedReport.output.error.code,
  reportRejected,
  mainExitCode,
  deviceCalls,
  photoCleared: photo.every((value) => value === 0),
}));
