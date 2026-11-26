'use strict';

// Install safe in-memory captured targets, then the existing no-forward guard,
// before importing any business module. Never initialize a real cloud SDK.
const fakes = globalThis.__DSH_D_NETWORK_GUARD__
  ? globalThis.__DSH_D_NETWORK_FAKES__ || null
  : require('./support/d-network-fakes.cjs');
const guard = globalThis.__DSH_D_NETWORK_GUARD__ || require('./support/d-network-guard.cjs');
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');

let door;
let worker;
const installed = guard.snapshot();
const fakeInstalled = fakes && fakes.snapshotCounts();

before(async () => {
  door = await import('../admin-web/lib/hikvision-door.mjs');
  worker = await import('../tools/signed-remote-worker/worker-runtime.mjs');
  guard.assertNoViolations(installed, 'signed remote module loading');
  if (fakes) assert.deepEqual(fakes.snapshotCounts(), fakeInstalled);
});

after(() => {
  guard.assertNoViolations(installed, 'signed remote complete offline suite');
  if (fakes) assert.deepEqual(fakes.snapshotCounts(), fakeInstalled);
});

const NOW = Date.parse('2026-11-26T04:00:00.000Z');
let serial = 0;
function task(extra = {}) {
  serial += 1;
  return {
    taskId: `synthetic-task-${serial}`, claimId: `synthetic-claim-${serial}`, revision: 2,
    contractId: 'synthetic-contract', doorBindingId: 'synthetic-binding',
    deviceKey: 'synthetic-device', doorNo: 7, expectedModel: 'SYNTHETIC-MODEL',
    validFrom: NOW - 1000, validUntil: NOW + 60000, expiresAt: NOW + 20000,
    ...extra,
  };
}
function config(extra = {}) {
  const value = {
    workerId: 'synthetic-worker', cloudEnv: 'synthetic-env', functionName: 'signedLeaseAccess',
    deviceKey: 'synthetic-device', expectedModel: 'SYNTHETIC-MODEL', allowedDoorNos: [7],
    sdkModulePath: '', device: {
      origin: 'https://synthetic.invalid', username: 'synthetic-user', password: 'synthetic-password',
      certificatePath: '/tmp/synthetic-public-certificate.pem', developmentTls: false,
    }, ...extra,
  };
  Object.defineProperties(value, {
    token: { value: 'synthetic-worker-token-0123456789abcdef', enumerable: false },
    secretId: { value: 'synthetic-cloud-id', enumerable: false },
    secretKey: { value: 'synthetic-cloud-key', enumerable: false },
  });
  return value;
}
function reply(body, status = 200) {
  return { status, headers: {}, body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) };
}
function xmlStatus(code = 1, status = 'OK', sub = 'ok') {
  return `<?xml version="1.0" encoding="UTF-8"?><ResponseStatus version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><statusCode>${code}</statusCode><statusString>${status}</statusString><subStatusCode>${sub}</subStatusCode></ResponseStatus>`;
}
function harness(claimed = task(), overrides = {}) {
  const calls = [];
  let openCalls = 0;
  const provider = {
    async verifyTarget(value) { calls.push(['verifyTarget', value]); },
    async openOnce(value) {
      openCalls += 1;
      calls.push(['openOnce', value]);
      return { status: 'device_confirmed', deviceStatusCode: '1' };
    },
    close() { calls.push(['close']); },
    ...overrides.provider,
  };
  const cloud = {
    async callFunction(action, payload) {
      calls.push([action, payload]);
      if (action === 'claimOpen') return { task: claimed };
      if (action === 'beginOpen') return { ...claimed, revision: claimed.revision + 1 };
      if (action === 'reportOpen') return { taskId: claimed.taskId, status: payload.status };
      throw new Error('unexpected cloud action');
    },
    ...overrides.cloud,
  };
  const execute = (extra = {}) => worker.processOnce({
    config: config(), cloud, nowMs: () => NOW,
    readCertificate: async () => Buffer.from('synthetic-certificate-bytes'),
    createProvider: async (options) => {
      calls.push(['createProvider', { developmentTls: options.developmentTls, absoluteDeadline: options.absoluteDeadline }]);
      return provider;
    },
    ...extra,
  });
  return { calls, provider, cloud, execute, openCount: () => openCalls };
}

test('only consistent protocol acknowledgements confirm a device command', () => {
  for (const body of [xmlStatus(), { statusCode: 1, statusString: 'OK', subStatusCode: 'ok' }]) {
    assert.deepEqual(door.parseDoorResponse(reply(body)), { status: 'device_confirmed', deviceStatusCode: '1' });
  }
  const unsafe = [
    '<html><body>OK</body></html>', '', 'not JSON or XML',
    '<ResponseStatus><statusCode>1</statusCode></ResponseStatus>',
    xmlStatus(1, 'Invalid Operation', 'ok'), xmlStatus(1, 'OK', 'notSupport'),
    xmlStatus(1).replace('<statusCode>1</statusCode>', '<statusCode>1</statusCode><statusCode>2</statusCode>'),
    '<!DOCTYPE ResponseStatus [<!ENTITY yes "1">]><ResponseStatus><statusCode>&yes;</statusCode><statusString>OK</statusString><subStatusCode>ok</subStatusCode></ResponseStatus>',
    '{"statusCode":1,"statusCode":2,"statusString":"OK","subStatusCode":"ok"}',
    '{"statusCode":2,"statusCode":1,"statusString":"OK","subStatusCode":"ok"}',
    '{"statusCode":1,"statusCode":1,"statusString":"OK","subStatusCode":"ok"}',
    { statusCode: 1, statusString: 'error', subStatusCode: 'ok' },
    { statusCode: 1, statusString: 'OK', subStatusCode: 'badParameters' },
    { statusCode: true, statusString: 'OK', subStatusCode: 'ok' },
    { statusCode: 1, statusString: 'OK', subStatusCode: 'ok', errorCode: 5 },
    { statusCode: 1, statusString: 'OK', subStatusCode: 'ok', errorMsg: 'rejected' },
    { statusCode: 1, statusString: 'OK', subStatusCode: 'ok', unknown: { statusCode: 2 } },
    { ResponseStatus: { statusCode: 1, statusString: 'OK', subStatusCode: 'ok' }, statusCode: 2 },
    xmlStatus().replace('<ResponseStatus version="2.0"', '<ResponseStatus version="2.0" version="bad"'),
    xmlStatus().replace('</ResponseStatus>', '<errorCode>5</errorCode></ResponseStatus>'),
    xmlStatus().replace('</ResponseStatus>', '<errorMsg>rejected</errorMsg></ResponseStatus>'),
    xmlStatus().replace('</ResponseStatus>', '<unknown><statusCode>2</statusCode></unknown></ResponseStatus>'),
    xmlStatus().replace('</ResponseStatus>', '<requestURL>/fixed</requestURL><requestURL>/changed</requestURL></ResponseStatus>'),
    xmlStatus() + '<ResponseStatus><statusCode>2</statusCode></ResponseStatus>',
  ];
  for (const body of unsafe) {
    let parsed;
    try { parsed = door.parseDoorResponse(reply(body)); } catch { continue; }
    assert.notEqual(parsed.status, 'device_confirmed', `must not confirm ${JSON.stringify(body)}`);
    assert.ok(Object.keys(parsed).every((key) => ['status', 'deviceStatusCode'].includes(key)));
  }
  assert.notEqual(door.parseDoorResponse(reply(xmlStatus(), 500)).status, 'device_confirmed');
  assert.notEqual(door.parseDoorResponse(reply(xmlStatus(), 302)).status, 'device_confirmed');
});

test('ordinary-open provider verifies the observed model, fixes its command and consumes the instance once', async () => {
  const requests = [];
  const provider = new door.HikvisionDoorProvider({
    async request(request) {
      requests.push(request);
      return request.method === 'GET'
        ? reply('<DeviceInfo><model>SYNTHETIC-MODEL</model></DeviceInfo>')
        : reply(xmlStatus());
    }, close() {},
  });
  await provider.verifyTarget({ expectedModel: 'SYNTHETIC-MODEL', doorNo: 7 });
  const outcome = await provider.openOnce({ doorNo: 7 });
  assert.equal(outcome.status, 'device_confirmed');
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].path, '/ISAPI/System/deviceInfo');
  const sent = requests.filter((r) => r.method === 'PUT');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, '/ISAPI/AccessControl/RemoteControl/door/7');
  assert.match(String(sent[0].body), /<cmd>open<\/cmd>/);
  assert.doesNotMatch(String(sent[0].body), /alwaysOpen|alwaysClose|close/);
  await provider.openOnce({ doorNo: 7 }).catch(() => {});
  assert.equal(requests.filter((r) => r.method === 'PUT').length, 1);
});

test('provider cannot open before target verification or after wrong observed model/changed door', async () => {
  let put = 0;
  const client = { async request(r) { if (r.method === 'PUT') put += 1; return reply('<DeviceInfo><model>OTHER-MODEL</model></DeviceInfo>'); }, close() {} };
  const before = new door.HikvisionDoorProvider(client);
  await before.openOnce({ doorNo: 7 }).catch(() => {});
  const wrong = new door.HikvisionDoorProvider(client);
  await assert.rejects(wrong.verifyTarget({ expectedModel: 'SYNTHETIC-MODEL', doorNo: 7 }));
  await wrong.openOnce({ doorNo: 7 }).catch(() => {});
  const changed = new door.HikvisionDoorProvider({ async request() { return reply('<DeviceInfo><model>SYNTHETIC-MODEL</model></DeviceInfo>'); }, close() {} });
  await changed.verifyTarget({ expectedModel: 'SYNTHETIC-MODEL', doorNo: 7 });
  await changed.openOnce({ doorNo: 8 }).catch(() => {});
  assert.equal(put, 0);
});

test('a real provider consumes its one open even when the PUT transport throws', async () => {
  let put = 0;
  const provider = new door.HikvisionDoorProvider({
    async request(request) {
      if (request.method === 'GET') return reply('<DeviceInfo><model>SYNTHETIC-MODEL</model></DeviceInfo>');
      put += 1;
      throw Object.assign(new Error('synthetic lost PUT receipt'), { code: 'HIKVISION_TIMEOUT' });
    }, close() {},
  });
  await provider.verifyTarget({ expectedModel: 'SYNTHETIC-MODEL', doorNo: 7 });
  assert.deepEqual(await provider.openOnce({ doorNo: 7 }), { status: 'unknown', deviceStatusCode: null });
  await provider.openOnce({ doorNo: 7 }).catch(() => {});
  assert.equal(put, 1);
});

test('one claimed task causes one begin, one logical open and one safe report', async () => {
  const claimed = task({ expiresAt: NOW + 12345 });
  const run = harness(claimed);
  const result = await run.execute();
  assert.equal(run.openCount(), 1);
  assert.equal(run.calls.filter(([name]) => name === 'beginOpen').length, 1);
  const reports = run.calls.filter(([name]) => name === 'reportOpen');
  assert.equal(reports.length, 1);
  assert.equal(reports[0][1].status, 'device_confirmed');
  assert.equal(reports[0][1].deviceStatusCode, '1');
  assert.equal(reports[0][1].revision, run.calls.find(([name]) => name === 'beginOpen')[1].revision + 1);
  assert.equal(run.calls.find(([name]) => name === 'createProvider')[1].developmentTls, false);
  assert.equal(run.calls.find(([name]) => name === 'createProvider')[1].absoluteDeadline, claimed.expiresAt);
  assert.ok(run.calls.findIndex(([name]) => name === 'verifyTarget') < run.calls.findIndex(([name]) => name === 'beginOpen'));
  assert.equal(run.calls.findIndex(([name]) => name === 'beginOpen') + 1, run.calls.findIndex(([name]) => name === 'openOnce'));
  assert.equal(result.reportAttempted, true);
  const publicResult = JSON.stringify(result);
  for (const secret of ['synthetic-password', 'synthetic.invalid', 'synthetic-worker-token', 'synthetic-public-certificate']) assert.ok(!publicResult.includes(secret));
  await run.execute();
  assert.equal(run.openCount(), 1);
  assert.equal(run.calls.filter(([name]) => name === 'beginOpen').length, 1);
  assert.equal(run.calls.filter(([name]) => name === 'reportOpen').length, 1);
});

test('transport uncertainty yields one unknown report and never retries open', async () => {
  const run = harness(task(), { provider: { async openOnce() { run.calls.push(['openOnce']); throw Object.assign(new Error('synthetic timeout'), { code: 'HIKVISION_TIMEOUT' }); } } });
  const result = await run.execute();
  const reports = run.calls.filter(([name]) => name === 'reportOpen');
  assert.equal(reports.length, 1);
  assert.equal(reports[0][1].status, 'unknown');
  assert.equal(reports[0][1].deviceStatusCode, null);
  assert.equal(result.reportAttempted, true);
  await run.execute();
  assert.equal(run.calls.filter(([name]) => name === 'openOnce').length, 1);
  assert.equal(run.calls.filter(([name]) => name === 'reportOpen').length, 1);
});

test('a lost begin receipt allows no opening or guessed report and closes the prepared provider', async () => {
  const calls = [];
  const claimed = task();
  const run = harness(claimed, { cloud: { async callFunction(action) { calls.push(action); if (action === 'claimOpen') return { task: claimed }; if (action === 'beginOpen') throw new Error('lost receipt'); throw new Error('must not report'); } } });
  const result = await run.execute();
  assert.equal(result.status, 'not_executed');
  assert.equal(result.code, 'BEGIN_AUTH_UNAVAILABLE');
  assert.equal(result.reportAttempted, false);
  assert.equal(run.openCount(), 0);
  assert.deepEqual(calls, ['claimOpen', 'beginOpen']);
  assert.equal(run.calls.filter(([name]) => name === 'close').length, 1);
});

test('wrong task device, model, door, expired deadline or expired lease never reaches begin/open', async () => {
  for (const change of [
    { deviceKey: 'wrong-device' }, { expectedModel: 'WRONG-MODEL' }, { doorNo: 8 }, { doorNo: 0 },
    { expiresAt: NOW }, { validUntil: NOW }, { validFrom: NOW + 1 },
    { origin: 'https://untrusted.invalid' }, { token: 'task-controlled-secret' }, { status: 'executing' },
  ]) {
    const run = harness(task(change));
    await run.execute();
    assert.equal(run.openCount(), 0);
    assert.equal(run.calls.filter(([name]) => name === 'beginOpen').length, 0);
    assert.equal(run.calls.filter(([name]) => name === 'createProvider').length, 0);
  }
  for (const validFrom of [0, -28800000]) {
    assert.equal(worker.validateTask(task({ validFrom }), config(), NOW).validFrom, validFrom,
      'a historic lease beginning at/before the Unix epoch may still be current');
  }
});

test('begin snapshot must match the claim exactly except one revision advance', async () => {
  for (const patch of [{ deviceKey: 'changed' }, { doorNo: 8 }, { expectedModel: 'changed' }, { expiresAt: NOW + 25000 }, { revision: 2 }, { validUntil: NOW + 90000 }, { claimId: 'other-claim' }, { contractId: 'other-contract' }, { doorBindingId: 'other-binding' }, { status: 'executing' }]) {
    const claimed = task();
    const run = harness(claimed, { cloud: { async callFunction(action, payload) {
      run.calls.push([action, payload]);
      if (action === 'claimOpen') return { task: claimed };
      if (action === 'beginOpen') return { ...claimed, revision: claimed.revision + 1, ...patch };
      if (action === 'reportOpen') return {};
      throw new Error('unexpected');
    } } });
    await run.execute();
    assert.equal(run.openCount(), 0);
    assert.equal(run.calls.filter(([name]) => name === 'createProvider').length, 1);
  }
});

test('a deadline reached during read-only target preparation blocks begin and open', async () => {
  let time = NOW;
  const claimed = task();
  const run = harness(claimed, { provider: { async verifyTarget() { time = claimed.expiresAt; } } });
  await run.execute({ nowMs: () => time });
  assert.equal(run.openCount(), 0);
  assert.equal(run.calls.filter(([name]) => name === 'beginOpen').length, 0);
  assert.equal(run.calls.filter(([name]) => name === 'reportOpen').length, 0);
  assert.equal(run.calls.filter(([name]) => name === 'close').length, 1);
});

test('revocation during read-only GET preparation is rejected by fresh begin before any PUT', async () => {
  const claimed = task();
  let revoked = false;
  const run = harness(claimed, {
    provider: { async verifyTarget() { run.calls.push(['verifyTarget']); revoked = true; } },
    cloud: { async callFunction(action, payload) {
      run.calls.push([action, payload]);
      if (action === 'claimOpen') return { task: claimed };
      if (action === 'beginOpen') { assert.equal(revoked, true); throw new Error('authoritative lease revoked during GET'); }
      throw new Error('must not report without begin authorization');
    } },
  });
  const result = await run.execute();
  assert.equal(result.status, 'not_executed');
  assert.equal(run.openCount(), 0);
  assert.equal(run.calls.filter(([name]) => name === 'beginOpen').length, 1);
  assert.equal(run.calls.filter(([name]) => name === 'reportOpen').length, 0);
  assert.equal(run.calls.filter(([name]) => name === 'close').length, 1);
});

test('a begin receipt delivered at the deadline still cannot authorize opening', async () => {
  const claimed = task();
  let time = NOW;
  const run = harness(claimed, { cloud: { async callFunction(action, payload) {
    run.calls.push([action, payload]);
    if (action === 'claimOpen') return { task: claimed };
    if (action === 'beginOpen') { time = claimed.expiresAt; return { ...claimed, revision: claimed.revision + 1 }; }
    if (action === 'reportOpen') return {};
    throw new Error('unexpected');
  } } });
  await run.execute({ nowMs: () => time });
  assert.equal(run.openCount(), 0);
  assert.equal(run.calls.filter(([name]) => name === 'beginOpen').length, 1);
  assert.equal(run.calls.filter(([name]) => name === 'reportOpen').length, 1);
  assert.equal(run.calls.find(([name]) => name === 'reportOpen')[1].status, 'failed');
});

test('failure delivering report does not repeat an already attempted command', async () => {
  const claimed = task();
  let reports = 0;
  const run = harness(claimed, { cloud: { async callFunction(action, payload) {
    run.calls.push([action, payload]);
    if (action === 'claimOpen') return { task: claimed };
    if (action === 'beginOpen') return { ...claimed, revision: claimed.revision + 1 };
    if (action === 'reportOpen') { reports += 1; throw new Error('report receipt lost'); }
    throw new Error('unexpected');
  } } });
  await run.execute().catch(() => {});
  await run.execute().catch(() => {});
  assert.equal(run.openCount(), 1);
  assert.equal(reports, 1);
});

test('CLI defaults and help never read secrets or initialize cloud/device clients', async () => {
  const unexpected = () => { throw new Error('default mode must not execute'); };
  for (const argv of [[], ['--help']]) {
    let output = '';
    const exitCode = await worker.main({ argv, loadConfig: unexpected, createCloud: unexpected, processOnceImpl: unexpected,
      stdout: { write(value) { output += value; } }, stderr: { write() {} } });
    assert.equal(exitCode, 0);
    assert.match(output, /execute-once/);
  }
});

test('configuration is explicit, hides material from serialization, and rejects TLS exceptions or guessed targets', async () => {
  const file = {
    workerId: 'synthetic-worker', workerTokenEnv: 'SYNTHETIC_SIGNED_TOKEN', cloudEnv: 'synthetic-env',
    functionName: 'signedLeaseAccess', deviceKey: 'synthetic-device', expectedModel: 'SYNTHETIC-MODEL',
    allowedDoorNos: [7], device: {
      origin: 'https://synthetic.invalid', username: 'synthetic-device-user', password: 'synthetic-password',
      certificatePath: '/tmp/synthetic-public-certificate.pem', developmentTls: false,
    },
  };
  const env = { SYNTHETIC_SIGNED_TOKEN: 'synthetic-worker-token-0123456789abcdef' };
  const load = (value) => worker.loadWorkerConfig({ configPath: '/tmp/synthetic-worker.local.json', env,
    readFileImpl: async () => JSON.stringify(value) });
  const loaded = await load(file);
  assert.equal(loaded.device.developmentTls, false);
  assert.equal(loaded.token, env.SYNTHETIC_SIGNED_TOKEN);
  assert.deepEqual(loaded.allowedDoorNos, [7]);
  const serialized = JSON.stringify(loaded);
  for (const secret of [env.SYNTHETIC_SIGNED_TOKEN, file.device.origin, file.device.username, file.device.password, file.device.certificatePath]) assert.ok(!serialized.includes(secret));
  for (const change of [
    { device: { ...file.device, developmentTls: true } },
    { device: { ...file.device, origin: 'http://synthetic.invalid' } },
    { allowedDoorNos: [] }, { allowedDoorNos: [7, 7] }, { allowedDoorNos: [0] },
    { expectedModel: '' }, { deviceKey: '' }, { functionName: 'unlock' },
  ]) await assert.rejects(load({ ...file, ...change }));
});

test('explicit CLI execution is one-shot and check-config never initializes SDK', async () => {
  const calls = [];
  const deps = {
    async loadConfig() { calls.push('load'); return config(); },
    async createCloud() { calls.push('cloud'); return {}; },
    async processOnceImpl() { calls.push('process'); return { status: 'device_confirmed', reportDelivered: true, code: 'DEVICE_COMMAND_ACCEPTED' }; },
    async runLoopImpl(options) {
      calls.push('loop');
      assert.equal(options.signal.aborted, false);
      assert.equal(options.processOnceImpl, deps.processOnceImpl);
      return { status: 'stopped', code: 'CANCELLED' };
    },
    stdout: { write() {} }, stderr: { write() {} },
  };
  assert.equal(await worker.main({ ...deps, argv: ['--execute-once'] }), 0);
  assert.deepEqual(calls, ['load', 'cloud', 'process']);
  calls.length = 0;
  assert.equal(await worker.main({ ...deps, argv: ['--check-config'] }), 0);
  assert.deepEqual(calls, ['load']);
  calls.length = 0;
  assert.equal(await worker.main({ ...deps, argv: ['--execute-once', '--execute-once'] }), 1);
  assert.deepEqual(calls, []);
  const signalsBefore = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  assert.equal(await worker.main({ ...deps, argv: ['--execute-loop'] }), 0);
  assert.deepEqual(calls, ['load', 'cloud', 'loop']);
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], signalsBefore);
  for (const argv of [['--execute-loop', '--execute-once'], ['--execute-loop', '--check-config']]) {
    calls.length = 0;
    assert.equal(await worker.main({ ...deps, argv }), 1);
    assert.deepEqual(calls, []);
  }
});

test('fake cloud adapter has a closed action set and rejects failed SDK receipts', async () => {
  const calls = [];
  const cloud = await worker.createCloudClient({ config: config(), sdkFactory: async () => ({
    async callFunction(value) { calls.push(value); return { result: { code: 0, data: { task: null } } }; },
  }) });
  assert.deepEqual(await cloud.callFunction('claimOpen', { workerId: 'synthetic-worker', token: 'synthetic-token' }), { task: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'signedLeaseAccess');
  assert.equal(calls[0].data.action, 'claimOpen');
  await assert.rejects(cloud.callFunction('unlock', {}));
  await assert.rejects(cloud.callFunction('beginOpen', { action: 'reportOpen' }));
  assert.equal(calls.length, 1);
  const denied = await worker.createCloudClient({ config: config(), sdkFactory: async () => ({ async callFunction() { return { result: { code: 'DENIED', data: {} } }; } }) });
  await assert.rejects(denied.callFunction('claimOpen', {}));
  const unauthorized = await worker.createCloudClient({ config: config(), sdkFactory: async () => ({ async callFunction() { return { result: { code: 'WORKER_UNAUTHORIZED', data: {} } }; } }) });
  const stopped = await worker.processOnce({ config: config(), cloud: unauthorized, nowMs: () => NOW,
    createProvider() { throw new Error('authorization rejection must not initialize device'); },
    readCertificate() { throw new Error('authorization rejection must not read material'); },
  });
  assert.equal(stopped.status, 'not_executed');
  assert.equal(stopped.stopLoop, true);
  assert.equal(stopped.reportAttempted, false);
});

test('SDK loading uses only the fixed local package boundary and exact pinned version', async () => {
  const { mkdtemp, mkdir, writeFile, symlink, rm } = require('node:fs/promises');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const temporary = await mkdtemp(join(tmpdir(), 'signed-remote-sdk-test-'));
  const packageDir = join(temporary, 'node_modules', '@cloudbase', 'node-sdk');
  const child = join(temporary, 'worker');
  const beforeInit = globalThis.__SIGNED_REMOTE_FAKE_SDK_INIT__ || 0;
  try {
    await mkdir(packageDir, { recursive: true });
    await mkdir(child);
    await writeFile(join(temporary, 'package.json'), '{"private":true}');
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: '@cloudbase/node-sdk', version: '3.18.7', main: 'index.cjs' }));
    await writeFile(join(packageDir, 'index.cjs'), 'module.exports={init(){globalThis.__SIGNED_REMOTE_FAKE_SDK_INIT__=(globalThis.__SIGNED_REMOTE_FAKE_SDK_INIT__||0)+1;return {async callFunction(){return {result:{code:0,data:{task:null}}}}}}};');
    // A valid ancestor package must never satisfy an empty worker boundary.
    await assert.rejects(worker.createCloudClient({ config: config(), workerRoot: child }));
    assert.equal(globalThis.__SIGNED_REMOTE_FAKE_SDK_INIT__ || 0, beforeInit);
    await mkdir(join(child, 'node_modules', '@cloudbase'), { recursive: true });
    await symlink(packageDir, join(child, 'node_modules', '@cloudbase', 'node-sdk'), 'dir');
    await assert.rejects(worker.createCloudClient({ config: config(), workerRoot: child }));
    assert.equal(globalThis.__SIGNED_REMOTE_FAKE_SDK_INIT__ || 0, beforeInit);
    const cloud = await worker.createCloudClient({ config: config(), workerRoot: temporary });
    assert.deepEqual(await cloud.callFunction('claimOpen', {}), { task: null });
    assert.equal(globalThis.__SIGNED_REMOTE_FAKE_SDK_INIT__, beforeInit + 1);
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: '@cloudbase/node-sdk', version: '0.0.0', main: 'index.cjs' }));
    await assert.rejects(worker.createCloudClient({ config: config(), workerRoot: temporary }));
    assert.equal(globalThis.__SIGNED_REMOTE_FAKE_SDK_INIT__, beforeInit + 1);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('explicit loop processes unknown, duplicate claim and a new task sequentially without replaying an open', async () => {
  const first = task();
  const next = task();
  const controller = new AbortController();
  const queued = [first, first, next];
  const byId = new Map([[first.taskId, first], [next.taskId, next]]);
  const calls = [];
  let active = 0;
  let maxActive = 0;
  let opens = 0;
  let delays = 0;
  const cloud = {
    async callFunction(action, payload) {
      calls.push([action, payload]);
      if (action === 'claimOpen') return { task: queued.shift() || null };
      if (action === 'beginOpen') return { ...byId.get(payload.taskId), revision: payload.revision + 1 };
      if (action === 'reportOpen') return {};
      throw new Error('unexpected action');
    },
  };
  const result = await worker.runLoop({
    config: config(), cloud, signal: controller.signal,
    async delay(milliseconds, signal) {
      assert.equal(milliseconds, 1000);
      assert.equal(signal, controller.signal);
      assert.equal(active, 0, 'poll delay follows completion of the previous task');
      delays += 1;
      if (delays === 3) controller.abort();
    },
    async processOnceImpl(options) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        return await worker.processOnce({ ...options, nowMs: () => NOW,
          readCertificate: async () => Buffer.from('synthetic-certificate-bytes'),
          createProvider: async () => ({
            async verifyTarget() { await Promise.resolve(); },
            async openOnce() {
              opens += 1;
              await Promise.resolve();
              return opens === 1
                ? { status: 'unknown', deviceStatusCode: null }
                : { status: 'device_confirmed', deviceStatusCode: '1' };
            }, close() {},
          }),
        });
      } finally { active -= 1; }
    },
  });
  assert.deepEqual(result, { status: 'stopped', code: 'CANCELLED' });
  assert.equal(maxActive, 1);
  assert.equal(opens, 2);
  assert.equal(calls.filter(([name]) => name === 'claimOpen').length, 3);
  assert.equal(calls.filter(([name]) => name === 'beginOpen').length, 2);
  assert.deepEqual(calls.filter(([name]) => name === 'reportOpen').map(([, payload]) => [payload.taskId, payload.status]), [
    [first.taskId, 'unknown'], [next.taskId, 'device_confirmed'],
  ]);
  assert.equal(delays, 3);
});

test('loop cancellation, idle and fatal/authentication outcomes stop without another claim', async () => {
  const alreadyStopped = new AbortController();
  alreadyStopped.abort();
  let calls = 0;
  assert.deepEqual(await worker.runLoop({ config: config(), cloud: {}, signal: alreadyStopped.signal,
    processOnceImpl: async () => { calls += 1; }, delay: async () => { throw new Error('must not delay'); },
  }), { status: 'stopped', code: 'CANCELLED' });
  assert.equal(calls, 0);

  const idle = new AbortController();
  calls = 0;
  assert.deepEqual(await worker.runLoop({ config: config(), cloud: {}, signal: idle.signal,
    processOnceImpl: async () => { calls += 1; return { status: 'idle' }; },
    delay: async (milliseconds) => { assert.equal(milliseconds, 1000); idle.abort(); },
  }), { status: 'stopped', code: 'CANCELLED' });
  assert.equal(calls, 1);

  const inFlight = new AbortController();
  let completed = false;
  let delivered = 0;
  calls = 0;
  assert.deepEqual(await worker.runLoop({ config: config(), cloud: {}, signal: inFlight.signal,
    processOnceImpl: async () => {
      calls += 1;
      inFlight.abort();
      await Promise.resolve();
      completed = true;
      return { status: 'device_confirmed', reportDelivered: true };
    },
    onResult(value) { assert.equal(completed, true); assert.equal(value.reportDelivered, true); delivered += 1; },
    delay: async () => { assert.equal(inFlight.signal.aborted, true); },
  }), { status: 'stopped', code: 'CANCELLED' });
  assert.equal(calls, 1);
  assert.equal(completed, true);
  assert.equal(delivered, 1);

  for (const outcome of ['auth', 'throw']) {
    calls = 0;
    let delays = 0;
    assert.deepEqual(await worker.runLoop({ config: config(), cloud: {}, signal: new AbortController().signal,
      processOnceImpl: async () => {
        calls += 1;
        if (outcome === 'throw') throw new Error('synthetic configuration failure');
        return { status: 'not_executed', code: 'WORKER_UNAUTHORIZED', stopLoop: true };
      }, delay: async () => { delays += 1; },
    }), { status: 'stopped', code: 'WORKER_STOPPED' });
    assert.equal(calls, 1);
    assert.equal(delays, 0);
  }
});

test('cleanup failure preserves confirmed device facts, reports once, stops polling and makes CLI fail', async () => {
  const run = harness(task(), { provider: { close() { run.calls.push(['close']); throw new Error('synthetic cleanup failure'); } } });
  const controller = new AbortController();
  let delays = 0;
  let result;
  assert.deepEqual(await worker.runLoop({ config: config(), cloud: run.cloud, signal: controller.signal,
    processOnceImpl: () => run.execute(),
    onResult(value) { result = value; controller.abort(); },
    delay: async () => { delays += 1; controller.abort(); },
  }), { status: 'stopped', code: 'WORKER_STOPPED' });
  assert.equal(result.status, 'device_confirmed');
  assert.equal(result.deviceStatusCode, '1');
  assert.equal(result.code, 'CLEANUP_FAILED');
  assert.equal(result.primaryCode, 'DEVICE_COMMAND_ACCEPTED');
  assert.equal(result.cleanupFailed, true);
  assert.equal(result.stopLoop, true);
  assert.equal(result.reportAttempted, true);
  assert.equal(result.reportDelivered, true);
  assert.equal(run.openCount(), 1);
  assert.equal(run.calls.filter(([name]) => name === 'claimOpen').length, 1);
  assert.equal(run.calls.filter(([name]) => name === 'beginOpen').length, 1);
  assert.equal(run.calls.filter(([name]) => name === 'close').length, 1);
  const reports = run.calls.filter(([name]) => name === 'reportOpen');
  assert.equal(reports.length, 1);
  assert.equal(reports[0][1].status, 'device_confirmed');
  assert.equal(reports[0][1].deviceStatusCode, '1');
  assert.equal(delays, 0);
  let cliOutput = '';
  const exitCode = await worker.main({ argv: ['--execute-once'], loadConfig: async () => config(),
    createCloud: async () => ({}), processOnceImpl: async () => result,
    stdout: { write(value) { cliOutput += value; } }, stderr: { write() {} },
  });
  assert.notEqual(exitCode, 0, 'confirmed command receipt cannot hide a cleanup failure');
  const summary = JSON.parse(cliOutput);
  assert.equal(summary.cleanupFailed, true);
  assert.equal(summary.primaryCode, 'DEVICE_COMMAND_ACCEPTED');
});

test('cleanup failure after a lost begin receipt retains its cause and invents no device report', async () => {
  const claimed = task();
  const run = harness(claimed, {
    provider: { close() { run.calls.push(['close']); throw new Error('synthetic cleanup failure'); } },
    cloud: { async callFunction(action, payload) {
      run.calls.push([action, payload]);
      if (action === 'claimOpen') return { task: claimed };
      if (action === 'beginOpen') throw new Error('synthetic lost begin receipt');
      throw new Error('must not invent a report');
    } },
  });
  const result = await run.execute();
  assert.equal(result.status, 'not_executed');
  assert.equal(result.code, 'BEGIN_AUTH_UNAVAILABLE');
  assert.equal(result.cleanupCode, 'CLEANUP_FAILED');
  assert.equal(result.cleanupFailed, true);
  assert.equal(result.stopLoop, true);
  assert.equal(result.reportAttempted, false);
  assert.equal(run.openCount(), 0);
  assert.equal(run.calls.filter(([name]) => name === 'reportOpen').length, 0);
  assert.equal(run.calls.filter(([name]) => name === 'close').length, 1);
});
