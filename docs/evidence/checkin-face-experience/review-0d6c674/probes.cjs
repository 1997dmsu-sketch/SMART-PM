'use strict';
// Synthetic review probes only. No SDK factory, device configuration or real secrets.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const root = '/workspace/SMART-PM-review-checkin-face-0d6c674';
const sourcePath = path.join(root, 'tests/checkin-face-cloud-workflow.test.cjs');
const source = fs.readFileSync(sourcePath, 'utf8');
const cut = source.indexOf("test('P0 守门：");
assert(cut > 0);
const exportsForProbe = '\nmodule.exports={MemoryDB,fixture,approvedFixture,queuedFixture,fileId,claim,TOKEN,ENV,OPENID,COLLECTIONS,ids};';
const sandbox = { require: createRequire(sourcePath), __dirname: path.dirname(sourcePath), module: { exports: {} }, Buffer, console };
new vm.Script(source.slice(0, cut) + exportsForProbe, { filename: sourcePath }).runInNewContext(sandbox);
const h = sandbox.module.exports;
const localRequire = createRequire(sourcePath);
const validation = localRequire('../cloudfunctions/checkinFaceTest/lib/validate.js');
const { createStore } = localRequire('../cloudfunctions/checkinFaceTest/lib/store.js');
const { STATUS } = localRequire('../cloudfunctions/checkinFaceTest/lib/workflow.js');
const observations = [];

async function main() {
  const worker = await import(pathToFileURL(path.join(root, 'tools/checkin-face-worker/worker-runtime.mjs')).href);
  const appId = 'checkin-face-test|application|synthetic';
  const plainId = `test-face/${h.ENV}/${h.OPENID}/${appId}/photo.jpg`;
  const cloudId = `cloud://synthetic-env.synthetic-bucket/${plainId}`;
  let cloudCode;
  try { validation.validateFileOwnership(cloudId, { environment: h.ENV, openid: h.OPENID, applicationId: appId }); cloudCode = 'ACCEPTED'; }
  catch (error) { cloudCode = error.code; }
  const plainAccepted = validation.validateFileOwnership(plainId, { environment: h.ENV, openid: h.OPENID, applicationId: appId }).fileId === plainId;
  const fakeClient = await worker.createCloudClient({
    config: { cloudEnv: 'synthetic-env' }, env: {},
    cloudbaseFactory: async () => ({ callFunction: async () => ({ code: 0, data: {} }), downloadFile: async () => ({ fileContent: Buffer.from([255, 216, 255, 0]) }) }),
  });
  let workerCode;
  try { await fakeClient.downloadFile(plainId); workerCode = 'ACCEPTED'; } catch (error) { workerCode = error.code; }
  assert.equal(cloudCode, 'FILE_OWNERSHIP_MISMATCH');
  assert.equal(plainAccepted, true);
  assert.equal(workerCode, 'FILE_ID_INVALID');
  observations.push({ id: 'FILE_ID_CONTRACT', realFormatCloudCode: cloudCode, plainCloudAccepted: plainAccepted, plainWorkerCode: workerCode });

  const routed = [];
  function spy(label) {
    return { collection(name) { return {
      doc(id) { return {
        get: async () => { routed.push(label + ':get'); return { data: { _id: id, revision: 1 } }; },
        set: async () => { routed.push(label + ':set'); },
      }; },
      get: async () => { routed.push(label + ':list'); return { data: [] }; },
      where() { return {
        get: async () => { routed.push(label + ':list'); return { data: [] }; },
        count: async () => { routed.push(label + ':count'); return { total: 0 }; },
      }; },
      add: async () => { routed.push(label + ':audit'); return { _id: 'synthetic-audit' }; },
    }; } };
  }
  const base = spy('base'); const transaction = spy('tx');
  base.runTransaction = async (work) => work(transaction);
  await createStore(base).withTransaction(async (store) => {
    await store.get('synthetic', 'row');
    await store.list('synthetic', { active: true });
    await store.count('synthetic', { active: true });
    await store.getById('synthetic', 'row');
    await store.writeAudit({ action: 'synthetic' });
    await store.setById('synthetic', 'written', { revision: 1 });
  });
  assert.deepEqual(routed, ['base:get', 'base:list', 'base:count', 'tx:get', 'base:audit', 'tx:set']);
  observations.push({ id: 'TRANSACTION_ROUTING', observed: routed, expectedScopeForAll: 'tx' });

  const ctx = await h.approvedFixture();
  const originalCollection = ctx.db.collection.bind(ctx.db);
  let creates = 0, releaseSecond, signalSecond;
  const held = new Promise(resolve => { releaseSecond = resolve; });
  const reached = new Promise(resolve => { signalSecond = resolve; });
  ctx.db.collection = function (name) {
    const collection = originalCollection(name);
    if (name !== h.COLLECTIONS.TASK) return collection;
    const originalDoc = collection.doc;
    collection.doc = function (id) {
      const doc = originalDoc(id);
      const originalSet = doc.set;
      doc.set = async function (arg) {
        if (arg.data.status === STATUS.QUEUED_FOR_DISPATCH && arg.data.revision === 1) {
          creates++;
          if (creates === 2) { signalSecond(); await held; }
        }
        return originalSet(arg);
      };
      return doc;
    };
    return collection;
  };
  const event = { action: 'createFaceTask', applicationId: ctx.applicationId, fileId: h.fileId(ctx.applicationId), consent: true };
  const firstCreate = ctx.main(event);
  const secondCreate = ctx.main(event);
  await reached;
  const firstCreated = await firstCreate;
  assert.equal(firstCreated.code, 0);
  const firstClaim = await h.claim(ctx);
  assert.equal(firstClaim.code, 0); assert(firstClaim.data.task);
  const claimedRow = ctx.taskFor(ctx.applicationId);
  releaseSecond();
  assert.equal((await secondCreate).code, 0);
  const resetRow = ctx.taskFor(ctx.applicationId);
  const secondClaim = await h.claim(ctx);
  assert.equal(secondClaim.code, 0); assert(secondClaim.data.task);
  assert.equal(claimedRow.status, STATUS.CLAIMED); assert.equal(claimedRow.revision, 2);
  assert.equal(resetRow.status, STATUS.QUEUED_FOR_DISPATCH); assert.equal(resetRow.revision, 1);
  assert.notEqual(firstClaim.data.task.claimId, secondClaim.data.task.claimId);
  observations.push({ id: 'CREATE_CLAIM_RACE', beforeDelayedCreate: { status: claimedRow.status, revision: claimedRow.revision }, afterDelayedCreate: { status: resetRow.status, revision: resetRow.revision }, successfulClaims: 2, differentClaimIds: true });

  const localConfig = {
    cloudEnv: 'synthetic-env', workerId: 'synthetic-worker', name: 'synthetic', roomNote: '102',
    device: { origin: 'https://device-b.invalid', certificatePath: '/synthetic/public.cer', expectedModel: 'DS-K1T671BM', planTemplateNo: '1', developmentTls: false },
  };
  const config = await worker.loadWorkerConfig({
    configPath: '/synthetic/worker.local.json', env: { CHECKIN_FACE_WORKER_TOKEN: 'synthetic-token-0123456789', CHECKIN_FACE_DEVICE_USERNAME: 'synthetic', CHECKIN_FACE_DEVICE_PASSWORD: 'synthetic-only' },
    readJsonFile: async () => JSON.stringify(localConfig),
  });
  const task = { taskId: 'synthetic|task', applicationId: 'synthetic|application', claimId: '11111111-2222-4333-8444-555555555555', revision: 2, name: 'synthetic', employeeNo: 'F0123456789ABCDEF', doorNo: 7, validFrom: '2026-12-01T00:00:00', validTo: '2026-12-05T23:59:59', timezone: 'Asia/Shanghai', dailyHours: '24x7', deviceKey: 'device-a', accessPlanFingerprint: 'a'.repeat(64) };
  const request = worker.buildDeviceRequest(task, config, '/synthetic/photo.jpg');
  assert.equal(config.deviceKey, ''); assert.equal(request.origin, 'https://device-b.invalid/');
  observations.push({ id: 'MISSING_LOCAL_DEVICE_BINDING', localDeviceKeyEmpty: true, taskHasDifferentDevice: true, requestToOtherSyntheticOriginAccepted: true });
  console.log(JSON.stringify({ scope: 'synthetic-review-probes-only', observations }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
