'use strict';
// Independent review-only synthetic probes. A successful assertion confirms a
// defect in this fixed candidate; it is not a product acceptance result.
// No live SDK, credentials, cloud, device, listener or worker CLI is used.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const ROOT = '/workspace/SMART-PM-review-checkin-face-5398d1e';
const testFile = path.join(ROOT, 'tests/checkin-face-cloud-workflow.test.cjs');
const source = fs.readFileSync(testFile, 'utf8');
const firstTest = source.indexOf("\ntest('");
assert.ok(firstTest > 0, 'fixture prefix must end before the first registered test');
const box = {
  require: createRequire(testFile), __dirname: path.dirname(testFile),
  __filename: testFile, module: { exports: {} }, exports: {},
  Buffer, Date, console, setTimeout, clearTimeout, structuredClone,
};
vm.runInNewContext(source.slice(0, firstTest) + `\nmodule.exports = {
  fixture, approvedFixture, queuedFixture, claimedFixture, claim, begin,
  fileId, successOutput, ENV, COLLECTIONS, ids, STATUS, TOKEN, WORKER_ID,
  NAMESPACE, OTHER_NAMESPACE, JPEG,
};`, box, { filename: testFile });
const F = box.module.exports;
function snapshot(ctx) {
  // Every collection is included; no fixed collection whitelist.
  return structuredClone([...ctx.db.collections].map(([name, rows]) => [name, [...rows]]));
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
const findings = [];
function record(id, before, after, observed) {
  findings.push({ id, result: 'EXPECTED_DEFECT_REPRODUCED',
    beforeSnapshotSha256: digest(before), afterSnapshotSha256: digest(after), observed });
}

async function namespaceChangesWhileDownloading() {
  const ctx = await F.approvedFixture();
  const before = snapshot(ctx);
  const entered = deferred();
  const release = deferred();
  ctx.cloud.downloadFile = async () => {
    entered.resolve();
    await release.promise;
    return { fileContent: F.JPEG };
  };
  const createPromise = ctx.main({ action: 'createFaceTask', applicationId: ctx.applicationId,
    fileId: F.fileId(ctx.applicationId), consent: true });
  await entered.promise;
  await ctx.admin.setStorageNamespace(F.OTHER_NAMESPACE);
  release.resolve();
  const created = await createPromise;
  assert.equal(created.code, 0);
  const claimed = await F.claim(ctx);
  assert.equal(claimed.code, 0);
  assert.ok(claimed.data.task);
  const begun = await F.begin(ctx, claimed.data.task);
  assert.equal(begun.code, 0);
  const currentConfig = ctx.db.row(F.COLLECTIONS.CONFIG, F.ids.configId(F.ENV));
  const task = ctx.taskFor(ctx.applicationId);
  assert.equal(currentConfig.storageNamespace, F.OTHER_NAMESPACE);
  assert.ok(task.fileId.startsWith(`cloud://${F.NAMESPACE}/`));
  assert.equal(task.configRevision, currentConfig.revision);
  assert.equal(task.status, F.STATUS.DEVICE_PROCESSING);
  record('CP01_NAMESPACE_TOCTOU', before, snapshot(ctx), {
    createCode: created.code, claimCode: claimed.code, beginCode: begun.code,
    taskStatus: task.status, currentRevisionPinned: task.configRevision === currentConfig.revision,
    taskNamespaceMatchesCurrentConfig: false,
  });
}

async function expiryEquality() {
  const ctx = await F.claimedFixture();
  const before = snapshot(ctx);
  const task = ctx.claimed.data.task;
  ctx.setNow(new Date(task.claimExpiresAt));
  const begun = await F.begin(ctx, task);
  assert.equal(begun.code, 0);
  assert.equal(begun.data.authorizedAt, task.claimExpiresAt);
  assert.equal(begun.data.task.status, F.STATUS.DEVICE_PROCESSING);
  record('CP02_EXPIRY_EQUALITY', before, snapshot(ctx), {
    beginCode: begun.code, authorizedExactlyAtDeadline: true,
    taskStatus: begun.data.task.status,
  });
}

async function directClaimedSuccessReport() {
  const ctx = await F.claimedFixture();
  const before = snapshot(ctx);
  const task = ctx.claimed.data.task;
  assert.equal(ctx.taskFor(ctx.applicationId).status, F.STATUS.CLAIMED);
  const report = await ctx.main({ action: 'reportTask', workerToken: F.TOKEN,
    taskId: task.taskId, claimId: task.claimId, revision: task.revision,
    exitCode: 0, output: F.successOutput(task) });
  assert.equal(report.code, 0);
  assert.equal(report.data.status, F.STATUS.PENDING_SITE_VERIFICATION);
  const beginAuditCount = ctx.db.rows(F.COLLECTIONS.AUDIT)
    .filter((row) => row.action === 'beginTaskExecution').length;
  assert.equal(beginAuditCount, 0);
  record('CP03_REPORT_BYPASSES_BEGIN', before, snapshot(ctx), {
    originalStatus: F.STATUS.CLAIMED, reportCode: report.code,
    resultingStatus: report.data.status, beginAuditCount,
  });
}

async function rewriteTerminalReport() {
  const ctx = await F.claimedFixture();
  const begun = await F.begin(ctx, ctx.claimed.data.task);
  assert.equal(begun.code, 0);
  const task = begun.data.task;
  const failed = await ctx.main({ action: 'reportTask', workerToken: F.TOKEN,
    taskId: task.taskId, claimId: task.claimId, revision: task.revision,
    exitCode: 4, output: { protocolVersion: 1, outcome: 'failed', mode: 'device',
      validityMode: 'fixed', siteVerification: 'PENDING' } });
  assert.equal(failed.code, 0);
  assert.equal(failed.data.status, F.STATUS.FAILED_REVIEW);
  const before = snapshot(ctx);
  const failedTask = ctx.taskFor(ctx.applicationId);
  const changed = await ctx.main({ action: 'reportTask', workerToken: F.TOKEN,
    taskId: task.taskId, claimId: task.claimId, revision: failedTask.revision,
    exitCode: 0, output: F.successOutput(task) });
  assert.equal(changed.code, 0);
  assert.equal(changed.data.status, F.STATUS.PENDING_SITE_VERIFICATION);
  record('CP04_TERMINAL_REPORT_REWRITE', before, snapshot(ctx), {
    originalStatus: failed.data.status, changedReportCode: changed.code,
    resultingStatus: changed.data.status,
    revisionAdvanced: ctx.taskFor(ctx.applicationId).revision === failedTask.revision + 1,
  });
}

async function emptyClaimWorkerThenDifferentBegin() {
  const ctx = await F.queuedFixture();
  const before = snapshot(ctx);
  const claimed = await ctx.main({ action: 'claimTask', workerToken: F.TOKEN });
  assert.equal(claimed.code, 0);
  assert.ok(claimed.data.task);
  assert.equal(ctx.taskFor(ctx.applicationId).workerId, '');
  const begun = await F.begin(ctx, claimed.data.task, { workerId: 'different-synthetic-worker' });
  assert.equal(begun.code, 0);
  assert.equal(begun.data.task.workerId, '');
  assert.equal(begun.data.task.status, F.STATUS.DEVICE_PROCESSING);
  record('CP05_EMPTY_CLAIM_WORKER', before, snapshot(ctx), {
    claimCode: claimed.code, storedWorkerIdEmpty: true,
    differentWorkerBeginCode: begun.code, taskStatus: begun.data.task.status,
  });
}

async function adminLostDisable() {
  const ctx = await F.fixture();
  const before = snapshot(ctx);
  const reachedSet = deferred();
  const releaseSet = deferred();
  const originalCollection = ctx.db.collection.bind(ctx.db);
  let intercept = true;
  ctx.db.collection = (name) => {
    const collection = originalCollection(name);
    if (name !== F.COLLECTIONS.CONFIG) return collection;
    const originalDoc = collection.doc;
    return { ...collection, doc(id) {
      const doc = originalDoc(id);
      return { ...doc, async set(argument) {
        if (intercept && argument.data.storageNamespace === F.OTHER_NAMESPACE) {
          intercept = false;
          reachedSet.resolve();
          await releaseSet.promise;
        }
        return doc.set(argument);
      } };
    } };
  };
  const namespacePromise = ctx.admin.setStorageNamespace(F.OTHER_NAMESPACE);
  await reachedSet.promise;
  await ctx.admin.setSwitch(false);
  const disabled = ctx.db.row(F.COLLECTIONS.CONFIG, F.ids.configId(F.ENV));
  assert.equal(disabled.enabled, false);
  releaseSet.resolve();
  await namespacePromise;
  const afterConfig = ctx.db.row(F.COLLECTIONS.CONFIG, F.ids.configId(F.ENV));
  assert.equal(afterConfig.enabled, true);
  assert.equal(afterConfig.revision, disabled.revision);
  const applied = await ctx.apply();
  assert.equal(applied.code, 0);
  assert.equal(applied.data.result, 'auto_approved');
  record('CP06_ADMIN_DISABLE_LOST', before, snapshot(ctx), {
    disabledCommitted: disabled.enabled === false,
    enabledAfterNonSwitchSetter: afterConfig.enabled,
    revisionReused: afterConfig.revision === disabled.revision,
    applicationResultAfterDisableWasLost: applied.data.result,
  });
}

(async () => {
  await namespaceChangesWhileDownloading();
  await expiryEquality();
  await directClaimedSuccessReport();
  await rewriteTerminalReport();
  await emptyClaimWorkerThenDifferentBegin();
  await adminLostDisable();
  console.log(JSON.stringify({ scope: 'synthetic-only-fixed-candidate-review',
    candidate: '5398d1e06769dc1be7e0c81e060084d412ae0665',
    interpretation: 'Exit zero means all expected defects were reproduced; not product acceptance.',
    fixturePrefixSha256: createHash('sha256').update(source.slice(0, firstTest)).digest('hex'),
    findings }, null, 2));
})().catch((error) => {
  console.error('SYNTHETIC_PROBE_ASSERTION_FAILED', error && error.stack);
  process.exitCode = 1;
});
