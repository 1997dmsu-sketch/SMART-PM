'use strict';

// Review-only synthetic UI reproduction. No real wx, cloud, timers or devices.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const root = '/workspace/SMART-PM-review-checkin-face-5398d1e';
const sourcePath = path.join(root, 'miniprogram/pages/face-enroll/index.js');
const source = fs.readFileSync(sourcePath);
const counters = { getConfig: 0, getMyTask: 0, chooseMedia: 0, upload: 0, create: 0, timers: 0 };
const snapshot = {
  status: 'NOT_FOUND',
  cloudPath: 'test-face/checkin-face-test/synthetic-user/synthetic-application/photo.jpg',
  room: { displayNo: '102', roomId: 'synthetic-room' },
  lease: { startDate: '2026-12-01', endDate: '2026-12-05' },
};
const api = {
  getCheckinFaceConfig: async () => {
    counters.getConfig++;
    return { enabled: true, configured: true, accountEligible: false, storageNamespaceConfigured: true };
  },
  getFaceTask: async () => { counters.getMyTask++; return structuredClone(snapshot); },
  uploadTestFace: async () => { counters.upload++; throw new Error('UNEXPECTED_FAKE_UPLOAD'); },
  createFaceTask: async () => { counters.create++; throw new Error('UNEXPECTED_FAKE_CREATE'); },
  isReviewChannelCode: code => ['APPLICATION_FORBIDDEN', 'APPLICATION_NOT_APPROVED', 'ACCOUNT_NOT_ALLOWED'].includes(code),
};
let captured;
const sandbox = {
  Page: config => { captured = config; },
  require: id => {
    if (id === '../../services/api') return api;
    if (id === '../../utils/layout') return { getNavigationLayout: () => ({}) };
    throw new Error('UNEXPECTED_IMPORT');
  },
  wx: {
    showToast: () => {},
    chooseMedia: () => { counters.chooseMedia++; throw new Error('UNEXPECTED_FAKE_MEDIA'); },
  },
  getApp: () => ({ globalData: {} }),
  setInterval: () => { counters.timers++; throw new Error('TIMERS_NOT_ALLOWED'); },
  clearInterval: () => { throw new Error('TIMERS_NOT_ALLOWED'); },
};
vm.runInNewContext(source.toString('utf8'), sandbox, { filename: sourcePath });
const page = Object.assign({}, captured, { data: JSON.parse(JSON.stringify(captured.data)) });
page.setData = function (patch, callback) {
  Object.assign(this.data, patch);
  if (callback) callback();
};
page._applicationId = 'synthetic-application';
page._destroyed = false;
page._fetching = false;

const stages = [];
function record(name) {
  stages.push({ name, reviewRequired: page.data.reviewRequired, showUpload: page.data.showUpload,
    canUpload: page.data.canUpload, cloudPathReady: page.data.cloudPathReady,
    counters: { ...counters } });
}

(async () => {
  page.applyTask(structuredClone(snapshot));
  page.onConsentChange({ detail: { value: ['consent'] } });
  record('before-revocation-check');

  // A revoked allowlist is observed by the real chooseAndUpload method.
  await page.chooseAndUpload();
  assert.equal(page.data.reviewRequired, true);
  assert.equal(page.data.showUpload, false);
  assert.equal(page.data.canUpload, false);
  record('revocation-rejected-upload');

  // Manually invoke the real polling method: no real interval is scheduled.
  await page.refreshTask();
  assert.equal(page.data.reviewRequired, false);
  assert.equal(page.data.showUpload, true);
  assert.equal(page.data.canUpload, true);
  record('old-owned-not-found-poll-reopened-upload');

  // Clicking again is still server-config gated, demonstrating no bypass.
  await page.chooseAndUpload();
  assert.equal(page.data.reviewRequired, true);
  assert.equal(page.data.showUpload, false);
  assert.equal(counters.chooseMedia, 0);
  assert.equal(counters.upload, 0);
  assert.equal(counters.create, 0);
  assert.equal(counters.timers, 0);
  record('second-click-rejected-again-no-upload');

  assert.deepEqual(fs.readFileSync(sourcePath), source);
  process.stdout.write(JSON.stringify({
    kind: 'synthetic-ui-state-regression-only',
    candidate: '5398d1e06769dc1be7e0c81e060084d412ae0665',
    sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
    pid: process.pid,
    reproduced: true,
    authorizationBypass: false,
    realWx: false,
    realTimers: 0,
    stages,
  }, null, 2) + '\n');
})().catch(error => {
  process.stderr.write(String(error.stack || error) + '\n');
  process.exitCode = 1;
});
