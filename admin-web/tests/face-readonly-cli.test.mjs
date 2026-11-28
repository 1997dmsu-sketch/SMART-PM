import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { main, MAX_INPUT_BYTES } from '../face-readonly.mjs';
import { createOfflineReadonlyRunner } from '../lib/face-readonly-command.mjs';
import { SYNTHETIC_PATHS as paths } from './fixtures/face-readonly-fake-transport.mjs';
import {
  syntheticCliInput, SYNTHETIC_SECRET_MARKERS,
} from './fixtures/face-readonly-cli-synthetic-input.mjs';

// All child processes have an independent deny-all network preload. Integration
// cases import the same production main and use its branded runner, real Host,
// provider, SDK and SPKI pin checks with only bottom TLS/HTTPS transport faked.
const cliPath = fileURLToPath(new URL('../face-readonly.mjs', import.meta.url));
const childPath = fileURLToPath(new URL('./fixtures/face-readonly-cli-child.mjs', import.meta.url));
const guardUrl = new URL('./fixtures/face-readonly-cli-network-guard.mjs', import.meta.url).href;
const outcomes = { 0: 'synthetic-readonly-completed', 2: 'invalid-input', 4: 'failed', 5: 'stopped' };
const baseKeys = ['protocolVersion', 'mode', 'execution', 'operation', 'outcome', 'siteVerification', 'deleteAllowed'];

function assertNoSecrets(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const marker of [...SYNTHETIC_SECRET_MARKERS, 'SYNTHETIC_ARG_SECRET_MARKER']) {
    assert(!serialized.includes(marker), 'Output exposed a fixed synthetic secret marker');
  }
  for (const key of ['origin', 'username', 'password', 'authorization', 'certificate', 'certificateBase64', 'certificatePath', 'photoBase64', 'photoBytes', 'faceURL', 'modelData', 'cardNo']) {
    assert(!serialized.includes(`"${key}"`), `Output exposed denied field ${key}`);
  }
  assert.doesNotMatch(serialized, /(?:SyntaxError|ReadonlyFaceError|HikvisionError|SYNTHETIC_NETWORK_GUARD_BLOCKED|\bat (?:main|file:\/\/))/);
}

function singleLine(stdout) {
  assert.equal(stdout.endsWith('\n'), true, 'stdout must terminate its one JSON line');
  assert.equal(stdout.split('\n').length, 2, 'stdout must contain exactly one JSON line');
  const output = JSON.parse(stdout);
  assertNoSecrets(output);
  return output;
}

function assertEnvelope(result, { exitCode, code, help = false }) {
  assert.equal(result.exitCode, exitCode);
  const output = singleLine(result.stdout);
  assert.equal(output.protocolVersion, 1);
  assert.equal(output.outcome, help ? 'help' : outcomes[exitCode]);
  if (!help) {
    assert.equal(output.mode, 'readonly');
    assert.equal(output.execution, 'offline');
    assert.equal(output.operation, 'list');
    assert.equal(output.siteVerification, 'NOT_EXECUTED');
    assert.equal(output.deleteAllowed, false);
  }
  if (code) {
    assert.equal(output.error.code, code);
    assert.deepEqual(Object.keys(output.error), ['code']);
    assert.equal(result.stderr, `${code}\n`);
    assert.deepEqual(Object.keys(output).sort(), [...baseKeys, 'error'].sort());
  } else assert.equal(result.stderr, '');
  assertNoSecrets(result.stderr);
  return output;
}

async function invoke({ input = syntheticCliInput(), chunks, stdin, argv = [], signal, runner } = {}) {
  const output = [], errors = [];
  const sink = target => ({ write(chunk, ...args) {
    target.push(String(chunk));
    queueMicrotask(() => args.find(arg => typeof arg === 'function')?.());
    return true;
  } });
  const exitCode = await main({
    argv, stdin: stdin ?? Readable.from(chunks ?? [Buffer.from(JSON.stringify(input))]),
    stdout: sink(output), stderr: sink(errors), signal, runner,
  });
  assert.equal(output.length, 1, 'main must write its JSON exactly once');
  return { exitCode, stdout: output.join(''), stderr: errors.join('') };
}

async function child({ scenario = 'success', input = syntheticCliInput(), bytes, production = false, argv = [], env = {} } = {}) {
  const args = ['--import', guardUrl, ...(production ? [cliPath, ...argv] : [childPath, scenario])];
  const childEnv = { ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}), ...env };
  return await new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, args, {
      cwd: fileURLToPath(new URL('../', import.meta.url)), env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    });
    let stdout = '', stderr = '';
    const reports = [];
    const timer = setTimeout(() => {
      processChild.kill();
      reject(new Error('Synthetic CLI child exceeded its bounded deadline'));
    }, 5000);
    const capture = stream => chunk => {
      if (stream === 'stdout') stdout += chunk;
      else stderr += chunk;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 262144) {
        processChild.kill();
        reject(new Error('Synthetic CLI child exceeded its output bound'));
      }
    };
    processChild.stdout.on('data', capture('stdout'));
    processChild.stderr.on('data', capture('stderr'));
    processChild.on('message', report => reports.push(report));
    processChild.once('error', error => { clearTimeout(timer); reject(error); });
    processChild.once('close', (exitCode, signal) => {
      try {
        clearTimeout(timer);
        assert.equal(signal, null, 'child must exit without a signal');
        const report = reports.find(item => item.kind === (production ? 'synthetic-network-guard' : 'synthetic-cli-harness'));
        assert(report, 'child did not report its independent network guard');
        assertNoSecrets({ stdout, stderr, reports });
        assert.equal(report.guard.attempts, 0, 'a real networking primitive was attempted');
        if (!production) {
          assert.equal(report.returnedExitCode, exitCode, 'raw process exit must equal main return value');
          assert.equal(report.network.earlyHttpRequests, 0, 'HTTP must wait for real SPKI pin verification');
          assert.equal(report.network.allSocketsDestroyed, true, 'the real Host must close the transport');
        }
        resolve({ exitCode, stdout, stderr, report });
      } catch (error) { reject(error); }
    });
    processChild.stdin.on('error', error => { if (error.code !== 'EPIPE') { clearTimeout(timer); reject(error); } });
    processChild.stdin.end(bytes ?? Buffer.from(JSON.stringify(input)));
  });
}

const assertNoTransport = result => {
  const { network } = result.report;
  assert.deepEqual({ http: network.httpRequests, https: network.httpsCalls, tls: network.tlsConnections }, { http: 0, https: 0, tls: 0 });
};

describe('face-readonly CLI bounded parsing and hard production lock', { concurrency: false }, () => {
  test('--help emits one safe line without reading stdin or starting its branded runner', async () => {
    const result = await child({ scenario: 'help-poison' });
    assertEnvelope(result, { exitCode: 0, help: true });
    assert.equal(result.report.counters.inputReads, 0);
    assert.equal(result.report.network.runnerCalls, 0);
    assertNoTransport(result);
  });

  test('unknown flags are rejected before stdin and never echoed', async () => {
    const result = await child({ scenario: 'arguments-poison' });
    assertEnvelope(result, { exitCode: 2, code: 'UNSUPPORTED_ARGUMENTS' });
    assert.equal(result.report.counters.inputReads, 0);
    assert.equal(result.report.network.runnerCalls, 0);
    assertNoTransport(result);
    for (const argv of [['--help', 'SYNTHETIC_ARG_SECRET_MARKER'], ['--input', 'SYNTHETIC_ARG_SECRET_MARKER'], ['--unlock-live']]) {
      const counter = { reads: 0 };
      const stdin = { [Symbol.asyncIterator]() { counter.reads += 1; throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'); } };
      assertEnvelope(await invoke({ argv, stdin }), { exitCode: 2, code: 'UNSUPPORTED_ARGUMENTS' });
      assert.equal(counter.reads, 0);
    }
  });

  test('the actual production executable stays locked with synthetic config and plausible unlock environment', async () => {
    const result = await child({ production: true, env: {
      NODE_ENV: 'test', FACE_READONLY_ALLOW_LIVE: 'true', FACE_READONLY_UNLOCK: '1',
      FACE_READONLY_RUNNER: 'synthetic', FACE_READONLY_OFFLINE: 'true',
      HIKVISION_ORIGIN: 'https://synthetic-env.invalid', HIKVISION_USERNAME: 'SYNTHETIC_CLI_USERNAME_SECRET_MARKER',
      HIKVISION_PASSWORD: 'SYNTHETIC_CLI_PASSWORD_SECRET_MARKER',
    } });
    assertEnvelope(result, { exitCode: 5, code: 'LIVE_EXECUTION_LOCKED' });
  });

  test('stdin cannot supply an unlock, runner, transport, operation, method, or path', async () => {
    const cases = [
      { allowLive: true }, { unlock: true }, { runner: 'synthetic' }, { transport: 'synthetic' },
      { method: 'PUT' }, { path: '/ISAPI/AccessControl/UserInfo/Record?format=json' },
      { operation: 'PUT' }, { operation: '/ISAPI/unknown' },
      { mode: 'device' },
    ];
    for (const extra of cases) {
      const result = await child({ input: { ...syntheticCliInput(), ...extra } });
      assertEnvelope(result, { exitCode: 2, code: 'COMMAND_INPUT_INVALID' });
      assert.equal(result.report.network.runnerCalls, 0);
      assertNoTransport(result);
    }
  });

  test('unknown nested config/options fields and factory injection are denied before transport', async () => {
    const valid = syntheticCliInput();
    for (const input of [
      { ...valid, config: { ...valid.config, certificatePath: 'SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER' } },
      { ...valid, config: { ...valid.config, clientFactory: 'SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER' } },
      { ...valid, options: { HostConstructor: 'SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER' } },
      { ...valid, options: { maxRequests: 257 } },
      { ...valid, options: { requestTimeoutMs: 5001 } },
    ]) {
      const result = await child({ input });
      assertEnvelope(result, { exitCode: 2, code: 'COMMAND_INPUT_INVALID' });
      assertNoTransport(result);
    }
  });

  test('duplicate JSON keys include escaped aliases at every input level', async () => {
    const valid = JSON.stringify(syntheticCliInput());
    for (const source of [
      valid.replace('"operation":"list"', '"operation":"list","operation":"list"'),
      valid.replace('"operation":"list"', '"operation":"list","operat\\u0069on":"list"'),
      valid.replace('"username":', '"user\\u006eame":"SYNTHETIC_CLI_USERNAME_SECRET_MARKER","username":'),
      valid.replace(/}$/, ',"options":{"maxRequests":2,"maxRequ\\u0065sts":3}}'),
    ]) {
      assertEnvelope(await invoke({ chunks: [Buffer.from(source)] }), { exitCode: 2, code: 'INPUT_DUPLICATE_KEY' });
    }
  });

  test('malformed JSON, nonobjects, and multiple JSON values cannot reach a runner', async () => {
    for (const source of ['', '{"SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER":', '{}{}', '{}\n{}', '[]', 'null', '"SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER"']) {
      const result = await invoke({ chunks: [Buffer.from(source)] });
      assert.equal(result.exitCode, 2);
      const output = singleLine(result.stdout);
      assert.equal(output.outcome, 'invalid-input');
      assert(['INPUT_JSON_INVALID', 'COMMAND_INPUT_INVALID'].includes(output.error.code));
      assert.equal(result.stderr, `${output.error.code}\n`);
    }
  });

  test('fatal UTF-8 validation rejects an incomplete E4 B8 sequence at EOF and split invalid sequences', async () => {
    for (const chunks of [
      [Buffer.from([0xe4, 0xb8])],
      [Buffer.from('{"name":"'), Buffer.from([0xe4]), Buffer.from([0xb8])],
      [Buffer.from([0xff])], [Buffer.from([0xc0, 0xaf])],
    ]) assertEnvelope(await invoke({ chunks }), { exitCode: 2, code: 'INPUT_UTF8_INVALID' });
  });

  test('the byte cap counts UTF-8 bytes, accepts its exact boundary, and rejects the first excess byte', async () => {
    assert.equal(MAX_INPUT_BYTES, 32768);
    const encoded = Buffer.from(JSON.stringify(syntheticCliInput()));
    const exact = Buffer.concat([encoded, Buffer.alloc(MAX_INPUT_BYTES - encoded.length, 0x20)]);
    assertEnvelope(await invoke({ chunks: [exact] }), { exitCode: 5, code: 'LIVE_EXECUTION_LOCKED' });
    assertEnvelope(await invoke({ chunks: [exact, Buffer.from(' ')] }), { exitCode: 2, code: 'INPUT_TOO_LARGE' });
    assertEnvelope(await invoke({ chunks: [Buffer.from('中'.repeat(Math.ceil(MAX_INPUT_BYTES / 3)))] }), { exitCode: 2, code: 'INPUT_TOO_LARGE' });
  });

  test('valid multibyte JSON can be split in the middle of a UTF-8 character', async () => {
    const source = Buffer.from(JSON.stringify(syntheticCliInput({ options: { expectedModel: '合成型号' } })));
    const first = source.indexOf(Buffer.from('合'));
    assert(first > 0);
    assertEnvelope(await invoke({ chunks: [source.subarray(0, first + 1), source.subarray(first + 1, first + 2), source.subarray(first + 2)] }), { exitCode: 5, code: 'LIVE_EXECUTION_LOCKED' });
  });

  test('input exceptions and a never-ending stream terminate with safe bounded input failures', async () => {
    const stdin = { async *[Symbol.asyncIterator]() { yield Buffer.from('{'); throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'); } };
    assertEnvelope(await invoke({ stdin }), { exitCode: 2, code: 'INPUT_INTERRUPTED' });
    const timed = await child({ scenario: 'input-timeout' });
    assertEnvelope(timed, { exitCode: 2, code: 'INPUT_TIMEOUT' });
    assertNoTransport(timed);
  });

  test('an input exception with a changing code getter cannot smuggle a secret into the protocol', async () => {
    let reads = 0;
    const hostile = Object.defineProperty({}, 'code', { get() {
      reads += 1;
      return reads === 1 ? 'INPUT_TIMEOUT' : reads === 2 ? 'INPUT_JSON_INVALID' : 'SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER';
    } });
    const stdin = { [Symbol.asyncIterator]() { return { next() { throw hostile; } }; } };
    const result = await invoke({ stdin });
    const output = singleLine(result.stdout);
    assert([2, 5].includes(result.exitCode));
    assert.equal(output.outcome, outcomes[result.exitCode]);
    assert.match(output.error.code, /^(?:INPUT_TIMEOUT|INPUT_JSON_INVALID|INPUT_INTERRUPTED|READONLY_FAILURE)$/);
    assert.equal(result.stderr, `${output.error.code}\n`);
    assertNoSecrets(result.stderr);
  });

  test('an unbranded runner is rejected without invocation or transport', async () => {
    const result = await child({ scenario: 'unbranded-runner' });
    assertEnvelope(result, { exitCode: 5, code: 'COMMAND_RUNNER_INVALID' });
    assert.equal(result.report.counters.unbrandedCalls, 0);
    assertNoTransport(result);
  });

  test('the offline factory rejects configurable Host constructors and non-function transport proofs', () => {
    for (const options of [
      {}, { isTransportInstalled: true }, { isTransportInstalled: () => true, HostConstructor: function SyntheticFakeHost() {} },
      { isTransportInstalled: () => true, origin: 'https://synthetic-injected.invalid' },
    ]) assert.throws(() => createOfflineReadonlyRunner(options));
  });
});

describe('face-readonly CLI synthetic child integration through the real Host and SDK', { concurrency: false }, () => {
  test('full pagination reads each synthetic person in each observed library and outputs only approved fields', async () => {
    const result = await child();
    const output = assertEnvelope(result, { exitCode: 0 });
    assert.deepEqual(Object.keys(output).sort(), [...baseKeys, 'device', 'allDayPlan', 'total', 'complete', 'managementSearchObserved', 'people', 'readonly'].sort());
    assert.deepEqual(Object.keys(output.device).sort(), ['firmware', 'model']);
    assert.equal(output.device.model, 'DS-K1T671BM');
    assert.equal(output.complete, true);
    assert.equal(output.total, 2);
    assert.equal(output.managementSearchObserved, true);
    assert.deepEqual(Object.keys(output.allDayPlan).sort(), ['templateNo', 'fingerprint', 'name', 'weekPlanNo', 'holidayGroupNos'].sort());
    assert.equal(output.allDayPlan.templateNo, '1');
    assert.equal(output.allDayPlan.name, '每天24小时');
    assert.equal(output.allDayPlan.weekPlanNo, 1);
    assert.deepEqual(output.allDayPlan.holidayGroupNos, ['32']);
    assert.match(output.allDayPlan.fingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(output.people.map(person => person.employeeNo), ['EMP1', 'EMP2']);
    for (const person of output.people) {
      assert.deepEqual(Object.keys(person).sort(), ['employeeNo', 'name', 'doorRight', 'RightPlan', 'Valid', 'faces', 'managementSearchObserved', 'deleteAllowed'].sort());
      assert.equal(person.deleteAllowed, false);
      assert.equal(person.managementSearchObserved, true);
      assert.equal(person.faces.blackFD.status, 'present');
      assert.equal(person.faces.infraredFD.status, 'present');
      assert.deepEqual(Object.keys(person.faces).sort(), ['blackFD', 'infraredFD']);
      for (const face of Object.values(person.faces)) {
        assert.deepEqual(Object.keys(face).sort(), ['libraries', 'status']);
        for (const library of face.libraries) assert.deepEqual(Object.keys(library).sort(), ['FDID', 'recordStatus', 'status']);
      }
      for (const plan of person.RightPlan) assert.deepEqual(Object.keys(plan).sort(), ['doorNo', 'planTemplateNo']);
      assert.deepEqual(Object.keys(person.Valid).sort(), ['beginTime', 'enable', 'endTime']);
    }
    assert.deepEqual(output.readonly, { status: 'COMPLETE', blocked: false, errorCode: null, logicalRequests: 15 });
    const { network } = result.report;
    assert.equal(network.httpRequests, 15);
    assert.equal(network.httpsCalls, 15);
    assert.equal(network.tlsConnections, 15);
    const pages = network.requests.filter(request => request.path === paths.people);
    assert.deepEqual(pages.map(request => request.searchResultPosition), [0, 1]);
    assert(pages.every(request => request.maxResults === 1));
    const faces = network.requests.filter(request => request.path === paths.faces);
    assert.deepEqual(faces.map(request => `${request.FPID}:${request.FDID}:${request.faceLibType}`).sort(), ['EMP1:1:blackFD', 'EMP1:2:infraredFD', 'EMP2:1:blackFD', 'EMP2:2:infraredFD']);
    assert(network.requests.every(request => request.method === 'GET' || request.method === 'POST' && [paths.people, paths.faces].includes(request.path)));
    for (const path of [paths.templateCapabilities, paths.template, paths.week, paths.holidayGroup, paths.holiday]) assert(network.requests.some(request => request.method === 'GET' && request.path === path));
  });

  test('synthetic credential values echoed in approved text fields are scrubbed', async () => {
    const result = await child({ scenario: 'secret-echo' });
    assertEnvelope(result, { exitCode: 0 });
    assert.equal(result.report.network.httpRequests, 15);
  });

  test('a secret that collides with a required identifier stops instead of reporting an empty completed projection', async () => {
    for (const password of ['1', 'EMP1']) {
      const valid = syntheticCliInput();
      const result = await child({ input: syntheticCliInput({ config: { ...valid.config, password } }) });
      const output = assertEnvelope(result, { exitCode: 5, code: 'READONLY_OUTPUT' });
      assert.equal(Object.hasOwn(output, 'people'), false);
      assert.equal(Object.hasOwn(output, 'allDayPlan'), false);
      assert.equal(Object.hasOwn(output, 'complete'), false);
      assert.equal(result.report.network.httpRequests, 15);
    }
  });

  for (const scenario of ['bad-pin', 'missing-peer']) test(`${scenario} runs real SPKI verification and sends zero HTTP`, async () => {
    const result = await child({ scenario });
    assertEnvelope(result, { exitCode: 4, code: 'HIKVISION_TLS_PIN' });
    assert.equal(result.report.network.tlsConnections, 1);
    assert.equal(result.report.network.httpsCalls, 1);
    assert.equal(result.report.network.httpRequests, 0);
    assert.deepEqual(result.report.network.requests, []);
  });

  test('a false synthetic-transport proof refuses the branded runner before SDK construction', async () => {
    const result = await child({ scenario: 'proof-false' });
    assertEnvelope(result, { exitCode: 5, code: 'LIVE_EXECUTION_LOCKED' });
    assertNoTransport(result);
  });

  for (const scenario of ['proof-throw-null', 'proof-throw-undefined']) test(`${scenario} cannot erase the first runner fault or produce an empty protocol`, async () => {
    const result = await child({ scenario });
    assertEnvelope(result, { exitCode: 5, code: 'READONLY_FAILURE' });
    assertNoTransport(result);
  });

  test('the logical budget latches before a second physical request', async () => {
    const result = await child({ input: syntheticCliInput({ options: { maxRequests: 1 } }) });
    assertEnvelope(result, { exitCode: 4, code: 'READONLY_BUDGET' });
    assert.equal(result.report.network.httpRequests, 1);
    assert.equal(result.report.network.tlsConnections, 1);
  });

  test('a real SDK face-read error trips the Host fuse and prevents later person/library reads', async () => {
    const result = await child({ scenario: 'face-error' });
    assertEnvelope(result, { exitCode: 5, code: 'HIKVISION_TRANSPORT' });
    // Nine describe/plan reads, two person pages, then the first face read.
    assert.equal(result.report.network.httpRequests, 12);
    assert.deepEqual(result.report.network.requests.map(request => request.path), [
      paths.device, paths.userCapabilities, paths.faceCapabilities, paths.libraries,
      paths.templateCapabilities, paths.template, paths.week, paths.holidayGroup, paths.holiday,
      paths.people, paths.people, paths.faces,
    ]);
    assert.equal(result.report.network.requests.filter(request => request.path === paths.people).length, 2);
    assert.equal(result.report.network.requests.filter(request => request.path === paths.faces).length, 1);
  });

  test('a stalled real SDK request times out and closes every synthetic socket', async () => {
    const result = await child({ scenario: 'request-timeout', input: syntheticCliInput({ options: { requestTimeoutMs: 20 } }) });
    assertEnvelope(result, { exitCode: 5, code: 'READONLY_REQUEST_TIMEOUT' });
    assert.equal(result.report.network.httpRequests, 1);
    assert.equal(result.report.network.tlsConnections, 1);
  });

  test('cancellation before input and during an SDK request uses stopped protocol and closes the Host', async () => {
    const before = await child({ scenario: 'cancel-before' });
    assertEnvelope(before, { exitCode: 5, code: 'COMMAND_CANCELLED' });
    assertNoTransport(before);
    const inflight = await child({ scenario: 'cancel-inflight' });
    assertEnvelope(inflight, { exitCode: 5, code: 'COMMAND_CANCELLED' });
    assert.equal(inflight.report.network.httpRequests, 1);
    assert.equal(inflight.report.network.tlsConnections, 1);
  });

  test('a cancellation at the physical output boundary cannot leave a zero process exit', async () => {
    const result = await child({ scenario: 'cancel-output-boundary' });
    assert.equal(result.exitCode, 5);
    assert.equal(result.stderr, 'COMMAND_CANCELLED\n');
    // Once write() receives a line, those bytes cannot be withdrawn. The exit
    // and fixed diagnostic dominate the already-submitted completion record.
    assert.equal(singleLine(result.stdout).outcome, 'synthetic-readonly-completed');
    assert.equal(result.report.network.httpRequests, 15);
    assert.equal(result.report.counters.stdoutWrites, 1);
  });

  test('a cancellation after the completed runner is observed before the stdout line is written', async () => {
    const result = await child({ scenario: 'cancel-before-output' });
    assertEnvelope(result, { exitCode: 5, code: 'COMMAND_CANCELLED' });
    assert.equal(result.report.network.httpRequests, 15);
    assert.equal(result.report.network.runnerCalls, 5);
    assert.equal(result.report.counters.stdoutWrites, 1);
  });

  for (const scenario of ['stdout-throw', 'stdout-throw-null', 'stdout-reject-undefined', 'stdout-callback', 'stdout-delayed-callback']) test(`${scenario} cannot turn a failed output write into process success`, async () => {
    const result = await child({ scenario });
    assert.equal(result.exitCode, 5);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'COMMAND_OUTPUT_FAILED\n');
    assert.equal(result.report.counters.stdoutWrites, 1);
  });

  test('a stderr write failure returns a stopped result and never retries the broken stream', async () => {
    const result = await child({ scenario: 'stderr-throw', input: {} });
    assert.equal(result.exitCode, 5);
    assert.equal(result.stderr, '');
    const output = singleLine(result.stdout);
    assert.equal(output.outcome, 'stopped');
    assert.equal(output.error.code, 'COMMAND_OUTPUT_FAILED');
    assert.equal(result.report.counters.stderrWrites, 1);
    assertNoTransport(result);
  });
});
