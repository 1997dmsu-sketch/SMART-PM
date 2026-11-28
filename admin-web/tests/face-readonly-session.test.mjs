import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  prepareReadonlySession, reviewReadonlySession, authorizeReadonlySession, executeReadonlySession,
} from '../lib/face-readonly-session.mjs';
import { createControlledReadonlyRunner, runFaceReadonly } from '../lib/face-readonly-command.mjs';
import { main } from '../face-readonly.mjs';
import { installFakeTransport, jsonReply, textReply, SYNTHETIC_PATHS as paths } from './fixtures/face-readonly-fake-transport.mjs';
import { SYNTHETIC_OTHER_CERT } from './fixtures/hikvision-synthetic-certificates.mjs';
import { installSessionNetworkGuard } from './fixtures/face-readonly-session-network-guard.mjs';
import {
  sessionInput, sessionExpectations, sessionResponses, sessionPeople, SESSION_TARGET, SESSION_SERIAL, SESSION_MODEL, SESSION_SECRET_MARKERS,
} from './fixtures/face-readonly-session-synthetic.mjs';

// Parent and children have independent deny-all guards. No test supplies a
// fake Host/provider, a real credential, or a transport proof as authorization.
let guard;
before(() => { guard = installSessionNetworkGuard(); });
after(() => { const snapshot = guard.snapshot(); guard.restore(); assert.equal(snapshot.attempts, 0, 'A real networking primitive was attempted'); });
const clone = value => structuredClone(value);
function assertSafe(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const marker of SESSION_SECRET_MARKERS) assert(!serialized.includes(marker), 'Session output exposed synthetic sensitive material');
  for (const field of ['origin', 'username', 'password', 'authorization', 'certificate', 'certificateBase64', 'certificatePath', 'photoBase64', 'photoBytes', 'faceURL', 'modelData', 'cardNo', 'expectedSpkiPin', 'expectedSerialNumber']) {
    assert(!serialized.includes(`"${field}"`), `Session output exposed denied field ${field}`);
  }
  assert.doesNotMatch(serialized, /(?:BEGIN (?:CERTIFICATE|PRIVATE KEY)|SYNTHETIC_SESSION_NETWORK_BLOCKED|\bat (?:main|file:\/\/))/);
}
function networkFor(t, options = {}) {
  const cleanups = [];
  const network = installFakeTransport({ after: cleanup => cleanups.push(cleanup) }, { responses: sessionResponses(), ...options });
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup(); });
  return network;
}
function zeroNetwork(network) {
  assert.deepEqual({ tls: network.tlsConnections, https: network.httpsCalls, http: network.httpRequests }, { tls: 0, https: 0, http: 0 });
}
async function prepared(input = sessionInput(), expected) {
  const expectations = expected ?? await sessionExpectations();
  const session = await prepareReadonlySession(input, expectations);
  const view = reviewReadonlySession(session);
  const token = authorizeReadonlySession(session, view);
  return { input, expectations, session, view, token };
}
async function codeOf(action) {
  try {
    const result = await action();
    assertSafe(result);
    return { code: result?.code ?? result?.output?.error?.code ?? result?.error?.code, result };
  } catch (error) {
    assertSafe({ code: error?.code, message: error?.message });
    return { code: error?.code, thrown: true };
  }
}
async function failure(action, expected) {
  const outcome = await codeOf(action);
  assert.equal(outcome.code, expected);
  if (outcome.result) {
    assert.equal(outcome.result.output.deleteAllowed, false);
    assert.equal(outcome.result.output.siteVerification, 'NOT_EXECUTED');
    const allowed = ['protocolVersion', 'mode', 'execution', 'operation', 'outcome', 'siteVerification', 'deleteAllowed', 'error'];
    if (expected === 'READONLY_COUNT_MISMATCH') allowed.push('observation');
    else assert.equal(Object.hasOwn(outcome.result.output, 'observation'), false);
    assert.deepEqual(Object.keys(outcome.result.output).sort(), allowed.sort());
  }
  return outcome;
}
async function replayBurned(context, network) {
  const before = { tls: network.tlsConnections, https: network.httpsCalls, http: network.httpRequests };
  await failure(() => executeReadonlySession(context.session, context.token, context.input), 'SESSION_AUTHORIZATION_USED');
  assert.deepEqual({ tls: network.tlsConnections, https: network.httpsCalls, http: network.httpRequests }, before);
}
function success(result) {
  assertSafe(result);
  assert.equal(result.exitCode, 0);
  const output = result.output;
  assert.equal(output.execution, 'controlled-readonly');
  assert.equal(output.outcome, 'controlled-readonly-completed');
  assert.equal(output.siteVerification, 'NOT_EXECUTED');
  assert.equal(output.deleteAllowed, false);
  assert.deepEqual(Object.keys(output).sort(), ['protocolVersion', 'mode', 'execution', 'operation', 'outcome', 'siteVerification', 'deleteAllowed', 'device', 'allDayPlan', 'total', 'complete', 'managementSearchObserved', 'people', 'readonly', 'verification'].sort());
  assert.equal(output.total, 9); assert.equal(output.complete, true); assert.equal(output.people.length, 9);
  assert.equal(new Set(output.people.map(person => person.employeeNo)).size, 9);
  assert(output.people.every(person => person.deleteAllowed === false));
  assert.equal(output.device.model, SESSION_MODEL);
  assert.deepEqual(Object.keys(output.device).sort(), ['model', 'firmware'].sort());
  assert.deepEqual(Object.keys(output.allDayPlan).sort(), ['templateNo', 'fingerprint', 'name', 'weekPlanNo', 'holidayGroupNos'].sort());
  for (const person of output.people) {
    assert.deepEqual(Object.keys(person).sort(), ['employeeNo', 'name', 'doorRight', 'RightPlan', 'Valid', 'faces', 'managementSearchObserved', 'deleteAllowed'].sort());
    for (const group of Object.values(person.faces)) for (const library of group.libraries) assert.deepEqual(Object.keys(library).sort(), ['FDID', 'status', 'recordStatus'].sort());
  }
  assert.deepEqual(output.verification, { status: 'CONFIRMED', FPID: SESSION_TARGET, faceLibType: 'blackFD', FDID: '1', inLibrary: true, actualCount: 9, expectedCount: 9 });
  return output;
}

describe('controlled readonly session preparation and review', { concurrency: false }, () => {
  test('prepare and review are inert, opaque, frozen and redact all secret expectations', async t => {
    const network = networkFor(t);
    const context = await prepared();
    zeroNetwork(network);
    assert.deepEqual(Reflect.ownKeys(context.session), []);
    assert.deepEqual(Reflect.ownKeys(context.token), []);
    assert(Object.isFrozen(context.view));
    assertSafe(context.view);
    const allowed = ['protocolVersion', 'mode', 'operation', 'expectedModel', 'planTemplateNo', 'expectedCount', 'targetEmployeeNo', 'targetFaceLibType', 'targetFDID'];
    assert.deepEqual(Object.keys(context.view).sort(), allowed.sort());
    assert.equal(context.view.expectedModel, SESSION_MODEL);
    assert.equal(context.view.expectedCount, 9);
    assert.equal(context.view.targetEmployeeNo, SESSION_TARGET);
    assert.equal(context.view.targetFaceLibType, 'blackFD');
    assert.equal(context.view.targetFDID, '1');
    assert(!JSON.stringify(context.view).includes(context.expectations.expectedSpkiPin));
    assert(!JSON.stringify(context.view).includes(context.expectations.expectedPlanFingerprint));
  });

  test('all caller-owned input and expectation fields are snapshotted before review and execution', async t => {
    const network = networkFor(t);
    const input = sessionInput({ options: { expectedModel: SESSION_MODEL, planTemplateNo: '1', maxRequests: 256, totalTimeoutMs: 120000, requestTimeoutMs: 5000 } });
    input.config.planTemplateNo = '1';
    const expected = await sessionExpectations();
    const original = clone(input);
    const session = await prepareReadonlySession(input, expected);
    input.operation = 'mutated'; input.mode = 'mutated';
    for (const key of Object.keys(input.config)) input.config[key] = 'SYNTHETIC_MUTATION';
    for (const key of Object.keys(input.options)) input.options[key] = 'SYNTHETIC_MUTATION';
    for (const key of Object.keys(expected)) expected[key] = 'SYNTHETIC_MUTATION';
    const view = reviewReadonlySession(session);
    assert.equal(view.expectedCount, 9); assert.equal(view.expectedModel, SESSION_MODEL);
    assert.equal(view.targetEmployeeNo, SESSION_TARGET); assert.equal(view.targetFDID, '1');
    const token = authorizeReadonlySession(session, view);
    success(await executeReadonlySession(session, token, original));
    assert.equal(network.earlyHttpRequests, 0);
  });

  for (const [label, alter] of [
    ['operation', input => { input.operation = 'delete'; }],
    ['mode', input => { input.mode = 'controlled'; }],
    ['origin', input => { input.config.origin = 'https://other-synthetic.invalid'; }],
    ['username', input => { input.config.username = 'SYNTHETIC_OTHER_USERNAME'; }],
    ['password', input => { input.config.password = 'SYNTHETIC_OTHER_PASSWORD'; }],
    ['certificate', input => { input.config.certificateBase64 = Buffer.from(SYNTHETIC_OTHER_CERT).toString('base64'); }],
    ['TLS mode', input => { input.config.developmentTls = false; }],
    ['config plan template', input => { input.config.planTemplateNo = '2'; }],
    ['expected model', input => { input.options = { expectedModel: 'SYNTHETIC_OTHER_MODEL' }; }],
    ['option plan template', input => { input.options = { planTemplateNo: '2' }; }],
    ['request budget', input => { input.options = { maxRequests: 255 }; }],
    ['session timeout', input => { input.options = { totalTimeoutMs: 119999 }; }],
    ['request timeout', input => { input.options = { requestTimeoutMs: 4999 }; }],
  ]) test(`a different execution ${label} burns the authorization before any transport`, async t => {
    const network = networkFor(t);
    const context = await prepared();
    const altered = clone(context.input); alter(altered);
    const outcome = await codeOf(() => executeReadonlySession(context.session, context.token, altered));
    assert(['SESSION_INPUT_MISMATCH', 'SESSION_INPUT_INVALID'].includes(outcome.code));
    zeroNetwork(network);
    await replayBurned(context, network);
  });

  for (const field of ['expectedSpkiPin', 'expectedSerialNumber', 'expectedPlanFingerprint', 'expectedCount', 'targetEmployeeNo', 'targetFDID']) {
    test(`missing independent ${field} is rejected before transport`, async t => {
      const network = networkFor(t);
      const expected = await sessionExpectations(); delete expected[field];
      await failure(() => prepareReadonlySession(sessionInput(), expected), 'SESSION_EXPECTATIONS_INVALID');
      zeroNetwork(network);
    });
  }

  test('unknown fields, factories, accessors, arrays and malformed expectations cannot prepare a session', async t => {
    const network = networkFor(t);
    for (const extra of [{ transport: 'fake' }, { HostConstructor: () => {} }, { authorization: {} }, { expectedPeopleCount: 9 }]) {
      await failure(async () => prepareReadonlySession(sessionInput(), { ...await sessionExpectations(), ...extra }), 'SESSION_EXPECTATIONS_INVALID');
    }
    for (const change of [{ expectedSpkiPin: 'z'.repeat(64) }, { expectedPlanFingerprint: 'a'.repeat(63) }, { expectedSerialNumber: '' }, { expectedCount: 0 }, { expectedCount: 1001 }, { expectedCount: '9' }, { targetEmployeeNo: 'bad/id' }, { targetFDID: '' }]) {
      await failure(async () => prepareReadonlySession(sessionInput(), { ...await sessionExpectations(), ...change }), 'SESSION_EXPECTATIONS_INVALID');
    }
    let getterReads = 0;
    const expected = await sessionExpectations();
    Object.defineProperty(expected, 'expectedCount', { get() { getterReads++; throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'); } });
    await failure(() => prepareReadonlySession(sessionInput(), expected), 'SESSION_EXPECTATIONS_INVALID');
    assert.equal(getterReads, 0);
    await failure(() => prepareReadonlySession(sessionInput(), []), 'SESSION_EXPECTATIONS_INVALID');
    for (const alter of [input => { input.allowLive = true; }, input => { input.config.certificatePath = 'SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'; }, input => { input.options = { HostConstructor: () => {} }; }]) {
      const input = sessionInput(); alter(input);
      await failure(async () => prepareReadonlySession(input, await sessionExpectations()), 'SESSION_INPUT_INVALID');
    }
    zeroNetwork(network);
  });

  test('an independent wrong expected SPKI pin fails during in-memory preparation with zero TLS/HTTP', async t => {
    const network = networkFor(t);
    await failure(async () => prepareReadonlySession(sessionInput(), await sessionExpectations({ expectedSpkiPin: '0'.repeat(64) })), 'SESSION_PIN_MISMATCH');
    zeroNetwork(network);
  });

  test('missing and unparsable memory certificates fail before TLS or HTTP', async t => {
    const network = networkFor(t);
    const input = sessionInput(); delete input.config.certificateBase64;
    await failure(async () => prepareReadonlySession(input, await sessionExpectations()), 'SESSION_INPUT_INVALID');
    const malformed = sessionInput(); malformed.config.certificateBase64 = Buffer.from('SYNTHETIC_INVALID_CERTIFICATE').toString('base64');
    await failure(async () => prepareReadonlySession(malformed, await sessionExpectations()), 'SESSION_CERTIFICATE_INVALID');
    zeroNetwork(network);
  });

  test('root, nested and expectation proxies are rejected without invoking any trap', async t => {
    const network = networkFor(t);
    let traps = 0;
    const hostile = value => new Proxy(value, {
      getPrototypeOf() { traps++; throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'); },
      ownKeys() { traps++; throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'); },
      get() { traps++; throw new Error('SYNTHETIC_UNTRUSTED_FAILURE_SECRET_MARKER'); },
    });
    for (const wrap of [input => hostile(input), input => ({ ...input, config: hostile(input.config) }), input => ({ ...input, options: hostile({}) })]) {
      const input = wrap(sessionInput());
      await failure(async () => prepareReadonlySession(input, await sessionExpectations()), 'SESSION_INPUT_INVALID');
    }
    await failure(async () => prepareReadonlySession(sessionInput(), hostile(await sessionExpectations())), 'SESSION_EXPECTATIONS_INVALID');
    assert.equal(traps, 0); zeroNetwork(network);
  });

  test('review fields cannot re-label a credential or private expectation as safe metadata', async t => {
    const network = networkFor(t);
    for (const field of ['username', 'password']) {
      const input = sessionInput(); input.config[field] = SESSION_MODEL;
      await failure(async () => prepareReadonlySession(input, await sessionExpectations()), 'SESSION_REVIEW_INVALID');
    }
    const input = sessionInput(); input.options = { expectedModel: SESSION_SERIAL };
    await failure(async () => prepareReadonlySession(input, await sessionExpectations()), 'SESSION_REVIEW_INVALID');
    zeroNetwork(network);
  });
});

describe('controlled readonly brands and one-use authorization', { concurrency: false }, () => {
  test('forged sessions, cloned views and cross-session review views cannot authorize transport', async t => {
    const network = networkFor(t);
    const input = sessionInput(), expected = await sessionExpectations();
    const first = await prepareReadonlySession(input, expected), second = await prepareReadonlySession(input, expected);
    const view = reviewReadonlySession(first);
    await failure(() => reviewReadonlySession({}), 'SESSION_INVALID');
    for (const forged of [{ ...view }, clone(view), {}, Object.freeze({ ...view })]) await failure(() => authorizeReadonlySession(first, forged), 'SESSION_REVIEW_INVALID');
    await failure(() => authorizeReadonlySession(second, view), 'SESSION_REVIEW_INVALID');
    zeroNetwork(network);
    const token = authorizeReadonlySession(first, view);
    assert.deepEqual(Reflect.ownKeys(token), []);
    await failure(() => authorizeReadonlySession(first, view), 'SESSION_AUTHORIZATION_USED');
  });

  test('forged authorization cannot execute or consume a valid token', async t => {
    const network = networkFor(t);
    const context = await prepared();
    for (const forged of [{}, { ...context.token }, clone(context.token), null, 'SYNTHETIC_TOKEN']) {
      await failure(() => executeReadonlySession(context.session, forged, context.input), 'SESSION_AUTHORIZATION_INVALID');
    }
    zeroNetwork(network);
    success(await executeReadonlySession(context.session, context.token, context.input));
    await replayBurned(context, network);
  });

  test('using a valid token with another session burns that token before transport', async t => {
    const network = networkFor(t);
    const first = await prepared(), second = await prepared();
    await failure(() => executeReadonlySession(second.session, first.token, first.input), 'SESSION_AUTHORIZATION_INVALID');
    zeroNetwork(network);
    await replayBurned(first, network);
    success(await executeReadonlySession(second.session, second.token, second.input));
  });

  test('concurrent consumers produce one authorized execution and the loser sends zero further requests', async t => {
    const network = networkFor(t);
    const context = await prepared();
    const results = await Promise.all([
      codeOf(() => executeReadonlySession(context.session, context.token, context.input)),
      codeOf(() => executeReadonlySession(context.session, context.token, context.input)),
    ]);
    const completed = results.filter(item => item.result?.exitCode === 0), denied = results.filter(item => item.code === 'SESSION_AUTHORIZATION_USED');
    assert.equal(completed.length, 1); assert.equal(denied.length, 1);
    success(completed[0].result);
    assert.equal(network.requests.filter(request => request.path === paths.device).length, 1);
    assert.equal(network.requests.filter(request => request.path === paths.people).length, 9);
    assert.equal(network.requests.filter(request => request.path === paths.faces).length, 18);
    await replayBurned(context, network);
  });

  test('cancellation before execution burns the token with zero transport', async t => {
    const network = networkFor(t), context = await prepared();
    const controller = new AbortController(); controller.abort();
    await failure(() => executeReadonlySession(context.session, context.token, context.input, { signal: controller.signal }), 'COMMAND_CANCELLED');
    zeroNetwork(network);
    await replayBurned(context, network);
  });

  test('cancellation during an SDK request closes sockets and burns the token', async t => {
    const controller = new AbortController();
    const network = networkFor(t, { onRequest: () => { queueMicrotask(() => controller.abort()); return { type: 'timeout' }; } });
    const context = await prepared();
    await failure(() => executeReadonlySession(context.session, context.token, context.input, { signal: controller.signal }), 'COMMAND_CANCELLED');
    assert.equal(network.httpRequests, 1);
    assert(network.sockets.every(socket => socket.destroyed));
    await replayBurned(context, network);
  });

  for (const options of [{ HostConstructor: () => {} }, { transport: {} }, { signal: {} }, { signal: null }]) test('unknown execution options or a forged signal burn before transport', async t => {
    const network = networkFor(t), context = await prepared();
    await failure(() => executeReadonlySession(context.session, context.token, context.input, options), 'SESSION_INPUT_INVALID');
    zeroNetwork(network); await replayBurned(context, network);
  });
});

describe('controlled readonly real Host and SDK fail-closed checks', { concurrency: false }, () => {
  test('full pagination proves exactly nine unique people and the precise target library record', async t => {
    const network = networkFor(t), context = await prepared();
    success(await executeReadonlySession(context.session, context.token, context.input));
    assert.deepEqual(network.requests.filter(request => request.path === paths.people).map(request => request.json.UserInfoSearchCond.searchResultPosition), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const faces = network.requests.filter(request => request.path === paths.faces);
    assert.equal(faces.length, 18);
    assert.equal(new Set(faces.map(request => `${request.json.FPID}/${request.json.faceLibType}/${request.json.FDID}`)).size, 18);
    assert.equal(faces.filter(request => request.json.FPID === SESSION_TARGET && request.json.faceLibType === 'blackFD' && request.json.FDID === '1').length, 1);
    assert.equal(network.earlyHttpRequests, 0);
    assert(network.sockets.every(socket => socket.destroyed));
    const allowedGet = new Set(Object.values(paths).filter(path => ![paths.people, paths.faces].includes(path)));
    assert(network.requests.every(request => request.method === 'GET' && allowedGet.has(request.path) || request.method === 'POST' && [paths.people, paths.faces].includes(request.path)));
    await replayBurned(context, network);
  });

  for (const [label, peerCertificate] of [['mismatching peer SPKI', SYNTHETIC_OTHER_CERT], ['missing peer certificate', null]]) test(`${label} burns authorization and sends zero HTTP`, async t => {
    const network = networkFor(t, { peerCertificate }), context = await prepared();
    await failure(() => executeReadonlySession(context.session, context.token, context.input), 'HIKVISION_TLS_PIN');
    assert.equal(network.httpRequests, 0); assert.equal(network.tlsConnections, 1); assert.equal(network.earlyHttpRequests, 0);
    await replayBurned(context, network);
  });

  for (const [label, deviceXml] of [
    ['wrong serial', `<DeviceInfo><model>${SESSION_MODEL}</model><serialNumber>SYNTHETIC_OTHER_SERIAL</serialNumber></DeviceInfo>`],
    ['missing serial', `<DeviceInfo><model>${SESSION_MODEL}</model></DeviceInfo>`],
    ['nested serial', `<DeviceInfo><model>${SESSION_MODEL}</model><extension><serialNumber>${SESSION_SERIAL}</serialNumber></extension></DeviceInfo>`],
    ['duplicate serial', `<DeviceInfo><model>${SESSION_MODEL}</model><serialNumber>${SESSION_SERIAL}</serialNumber><serialNumber>${SESSION_SERIAL}</serialNumber></DeviceInfo>`],
    ['leading whitespace serial', `<DeviceInfo><model>${SESSION_MODEL}</model><serialNumber> ${SESSION_SERIAL}</serialNumber></DeviceInfo>`],
    ['trailing whitespace serial', `<DeviceInfo><model>${SESSION_MODEL}</model><serialNumber>${SESSION_SERIAL} </serialNumber></DeviceInfo>`],
  ]) test(`${label} stops at the first device response with no list or plan requests`, async t => {
    const network = networkFor(t, { responses: sessionResponses({ deviceXml }) }), context = await prepared();
    await failure(() => executeReadonlySession(context.session, context.token, context.input), 'READONLY_IDENTITY');
    assert.deepEqual(network.requests.map(request => request.path), [paths.device]);
    await replayBurned(context, network);
  });

  for (const [label, options, expectations, code] of [
    ['model mismatch', { model: 'SYNTHETIC_OTHER_MODEL' }, {}, 'READONLY_MODEL'],
    ['plan fingerprint mismatch', {}, { expectedPlanFingerprint: '0'.repeat(64) }, 'READONLY_PLAN_MISMATCH'],
  ]) test(`${label} prevents every person and face search`, async t => {
    const network = networkFor(t, { responses: sessionResponses(options) });
    const context = await prepared(sessionInput(), await sessionExpectations(expectations));
    await failure(() => executeReadonlySession(context.session, context.token, context.input), code);
    assert.equal(network.requests.filter(request => [paths.people, paths.faces].includes(request.path)).length, 0);
    await replayBurned(context, network);
  });

  for (const count of [8, 10]) test(`actual ${count} versus expected nine stops on the first people page before any face read`, async t => {
    const network = networkFor(t, { responses: sessionResponses({ count }) }), context = await prepared();
    const outcome = await failure(() => executeReadonlySession(context.session, context.token, context.input), 'READONLY_COUNT_MISMATCH');
    assert.deepEqual(outcome.result.output.observation, { actualCount: count, expectedCount: 9, complete: false });
    assert.equal(network.requests.filter(request => request.path === paths.people).length, 1);
    assert.equal(network.requests.filter(request => request.path === paths.faces).length, 0);
    await replayBurned(context, network);
  });

  test('an invalid first-page response status cannot produce a count-mismatch observation', async t => {
    const responses = sessionResponses();
    responses.set(`POST ${paths.people}`, jsonReply({ UserInfoSearch: {
      totalMatches: 8, numOfMatches: 1, UserInfo: [sessionPeople()[0]], responseStatusStrg: 'INVALID',
    } }));
    const network = networkFor(t, { responses }), context = await prepared();
    const outcome = await failure(() => executeReadonlySession(context.session, context.token, context.input), 'READONLY_PAGINATION');
    assert.equal(Object.hasOwn(outcome.result.output, 'observation'), false);
    assert.equal(network.requests.filter(request => request.path === paths.people).length, 1);
    assert.equal(network.requests.filter(request => request.path === paths.faces).length, 0);
    await replayBurned(context, network);
  });

  test('first-page rows exceeding total cannot produce a count-mismatch observation', async t => {
    const responses = sessionResponses();
    responses.set(`POST ${paths.people}`, jsonReply({ UserInfoSearch: {
      totalMatches: 0, numOfMatches: 1, UserInfo: [sessionPeople()[0]],
    } }));
    const network = networkFor(t, { responses }), context = await prepared();
    const outcome = await failure(() => executeReadonlySession(context.session, context.token, context.input), 'READONLY_PAGINATION');
    assert.equal(Object.hasOwn(outcome.result.output, 'observation'), false);
    assert.equal(network.requests.filter(request => request.path === paths.people).length, 1);
    assert.equal(network.requests.filter(request => request.path === paths.faces).length, 0);
    await replayBurned(context, network);
  });

  for (const [targetFace, code] of [['no', 'SESSION_TARGET_UNCONFIRMED'], ['absent', 'SESSION_TARGET_UNCONFIRMED'], ['missing', 'READONLY_FACE_UNCONFIRMED'], ['true', 'READONLY_FACE_UNCONFIRMED'], ['duplicate', 'READONLY_FACE_UNCONFIRMED'], ['other-fpid', 'READONLY_FACE_UNCONFIRMED']]) {
    test(`target blackFD ${targetFace} cannot be replaced by numOfFace or infrared presence`, async t => {
      const network = networkFor(t, { responses: sessionResponses({ targetFace }) }), context = await prepared();
      await failure(() => executeReadonlySession(context.session, context.token, context.input), code);
      assert.equal(network.requests.filter(request => request.path === paths.people).length, 9);
      await replayBurned(context, network);
    });
  }

  for (const [label, options, expectations] of [
    ['only infrared library', { libraries: [{ FDID: '2', faceLibType: 'infraredFD' }] }, {}],
    ['another blackFD FDID', {}, { targetFDID: '3' }],
    ['missing target person', { people: sessionPeople().map(person => person.employeeNo === SESSION_TARGET ? { ...person, employeeNo: 'SYNTHOTHER' } : person) }, {}],
  ]) test(`${label} cannot confirm the requested target`, async t => {
    const network = networkFor(t, { responses: sessionResponses(options) });
    const context = await prepared(sessionInput(), await sessionExpectations(expectations));
    await failure(() => executeReadonlySession(context.session, context.token, context.input), 'SESSION_TARGET_UNCONFIRMED');
    await replayBurned(context, network);
  });

  test('duplicate identities on later pages fail before any face search', async t => {
    const people = sessionPeople(); people[8].employeeNo = people[0].employeeNo;
    const network = networkFor(t, { responses: sessionResponses({ people }) }), context = await prepared();
    await failure(() => executeReadonlySession(context.session, context.token, context.input), 'READONLY_DUPLICATE');
    assert.equal(network.requests.filter(request => request.path === paths.faces).length, 0);
    await replayBurned(context, network);
  });

  for (const [label, options, input, code] of [
    ['logical request budget', {}, sessionInput({ options: { maxRequests: 1 } }), 'READONLY_BUDGET'],
    ['SDK transport exception', { onRequest: () => ({ type: 'error' }) }, sessionInput(), 'HIKVISION_TRANSPORT'],
    ['HTTP redirect', { onRequest: () => textReply('synthetic', 302, { location: 'https://never-follow.invalid' }) }, sessionInput(), 'HIKVISION_REDIRECT'],
    ['request timeout', { onRequest: () => ({ type: 'timeout' }) }, sessionInput({ options: { requestTimeoutMs: 10 } }), 'READONLY_REQUEST_TIMEOUT'],
    ['face search exception', { onRequest: request => request.path === paths.faces ? { type: 'error' } : undefined }, sessionInput(), 'HIKVISION_TRANSPORT'],
  ]) test(`${label} latches the fault, closes sockets, and cannot retry`, async t => {
    const network = networkFor(t, options), context = await prepared(input);
    await failure(() => executeReadonlySession(context.session, context.token, context.input), code);
    assert(network.sockets.every(socket => socket.destroyed));
    if (label === 'logical request budget') assert.equal(network.httpRequests, 1);
    if (label === 'face search exception') assert.equal(network.requests.filter(request => request.path === paths.faces).length, 1);
    await replayBurned(context, network);
  });

  test('malformed first page is a safe failure, with no face requests', async t => {
    const responses = sessionResponses(); responses.set(`POST ${paths.people}`, jsonReply({ UserInfoSearch: { totalMatches: 9, numOfMatches: 1, responseStatusStrg: 'MORE' } }));
    const network = networkFor(t, { responses }), context = await prepared();
    const outcome = await codeOf(() => executeReadonlySession(context.session, context.token, context.input));
    assert.match(outcome.code, /^READONLY_/);
    assert.equal(network.requests.filter(request => request.path === paths.people).length, 1);
    assert.equal(network.requests.filter(request => request.path === paths.faces).length, 0);
    await replayBurned(context, network);
  });

  test('vendor names containing configured credentials are removed from the approved person DTO', async t => {
    const input = sessionInput(), people = sessionPeople(); people[0].name = input.config.password;
    const network = networkFor(t, { responses: sessionResponses({ people }) }), context = await prepared(input);
    const output = success(await executeReadonlySession(context.session, context.token, context.input));
    assert.equal(output.people[0].name, ''); await replayBurned(context, network);
  });

  test('a vendor field containing private serial material fails safely and burns authorization', async t => {
    const people = sessionPeople(); people[0].name = SESSION_SERIAL;
    const network = networkFor(t, { responses: sessionResponses({ people }) }), context = await prepared();
    await failure(() => executeReadonlySession(context.session, context.token, context.input), 'READONLY_OUTPUT');
    await replayBurned(context, network);
  });
});

const cliPath = fileURLToPath(new URL('../face-readonly.mjs', import.meta.url));
const childPath = fileURLToPath(new URL('./fixtures/face-readonly-session-child.mjs', import.meta.url));
const guardUrl = new URL('./fixtures/face-readonly-cli-network-guard.mjs', import.meta.url).href;
async function child({ scenario = 'success', production = false, input = sessionInput(), env = {} } = {}) {
  const args = ['--import', guardUrl, production ? cliPath : childPath, ...(production ? [] : [scenario])];
  return new Promise((resolve, reject) => {
    const subprocess = spawn(process.execPath, args, { cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}), ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    let stdout = '', stderr = '';
    const reports = [];
    const timer = setTimeout(() => { subprocess.kill(); reject(new Error('Synthetic session child deadline exceeded')); }, 5000);
    const capture = target => bytes => {
      if (target === 'stdout') stdout += bytes; else stderr += bytes;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 262144) { subprocess.kill(); reject(new Error('Synthetic session child output limit exceeded')); }
    };
    subprocess.stdout.on('data', capture('stdout'));
    subprocess.stderr.on('data', capture('stderr'));
    subprocess.on('message', report => reports.push(report));
    subprocess.once('error', error => { clearTimeout(timer); reject(error); });
    subprocess.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      try {
        assert.equal(signal, null); assertSafe({ stdout, stderr, reports });
        assert.equal(stdout.split('\n').length, 2); assert(stdout.endsWith('\n'));
        const output = JSON.parse(stdout);
        if (output.error && output.error.code !== 'READONLY_COUNT_MISMATCH') assert.equal(Object.hasOwn(output, 'observation'), false);
        const report = reports.find(item => item.kind === (production ? 'synthetic-network-guard' : 'synthetic-session-harness'));
        assert(report); assert.equal(report.guard.attempts, 0);
        if (!production) {
          assert.equal(report.returnedExitCode, exitCode);
          assert.equal(report.retryHttpDelta, 0);
          assert.equal(report.replay.code ?? report.replay.output?.error?.code ?? report.replay.error?.code, 'SESSION_AUTHORIZATION_USED');
          assert.equal(report.network.earlyHttpRequests, 0);
          assert.equal(report.network.allSocketsDestroyed, true);
        }
        resolve({ exitCode, output, stdout, stderr, report });
      } catch (error) { reject(error); }
    });
    subprocess.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    subprocess.stdin.end(Buffer.from(JSON.stringify(input)));
  });
}

describe('controlled runner integration with the same production main', { concurrency: false }, () => {
  test('a real guarded child calls main with a registered controlled runner and preserves the readonly request boundary', async () => {
    const result = await child();
    success({ exitCode: result.exitCode, output: result.output });
    assert.equal(result.stderr, '');
    assert.equal(result.report.network.requests.filter(request => request.path === paths.people).length, 9);
    assert.equal(result.report.network.requests.filter(request => request.path === paths.faces).length, 18);
    const allowedGet = new Set(Object.values(paths).filter(path => ![paths.people, paths.faces].includes(path)));
    assert(result.report.network.requests.every(request => request.method === 'GET' && allowedGet.has(request.path) || request.method === 'POST' && [paths.people, paths.faces].includes(request.path)));
  });

  for (const [scenario, code, exitCode] of [['peer-pin', 'HIKVISION_TLS_PIN', 4], ['serial', 'READONLY_IDENTITY', 4], ['plan', 'READONLY_PLAN_MISMATCH', 4], ['count8', 'READONLY_COUNT_MISMATCH', 4], ['count10', 'READONLY_COUNT_MISMATCH', 4], ['target-no', 'SESSION_TARGET_UNCONFIRMED', 4], ['face-error', 'HIKVISION_TRANSPORT', 5], ['cancel-inflight', 'COMMAND_CANCELLED', 5]]) {
    test(`main emits one safe ${scenario} failure line and the raw process exit agrees`, async () => {
      const result = await child({ scenario });
      assert.equal(result.exitCode, exitCode);
      assert.deepEqual(result.output.error, { code });
      assert.equal(result.output.deleteAllowed, false); assert.equal(result.output.siteVerification, 'NOT_EXECUTED');
      const allowed = ['protocolVersion', 'mode', 'execution', 'operation', 'outcome', 'siteVerification', 'deleteAllowed', 'error'];
      if (scenario === 'count8' || scenario === 'count10') {
        allowed.push('observation');
        assert.deepEqual(result.output.observation, { actualCount: scenario === 'count8' ? 8 : 10, expectedCount: 9, complete: false });
        assert.equal(result.report.network.requests.filter(request => request.path === paths.people).length, 1);
        assert.equal(result.report.network.requests.filter(request => request.path === paths.faces).length, 0);
      } else assert.equal(Object.hasOwn(result.output, 'observation'), false);
      assert.deepEqual(Object.keys(result.output).sort(), allowed.sort());
      assert.equal(result.stderr, `${code}\n`);
    });
  }

  test('production executable remains locked despite plausible session or environment unlocks', async () => {
    const result = await child({ production: true, env: { NODE_ENV: 'test', FACE_READONLY_ALLOW_LIVE: 'true', FACE_READONLY_UNLOCK: '1', FACE_READONLY_CONTROLLED: 'true', FACE_READONLY_SESSION: 'synthetic', FACE_READONLY_AUTHORIZATION: 'synthetic' } });
    assert.equal(result.exitCode, 5); assert.deepEqual(result.output.error, { code: 'LIVE_EXECUTION_LOCKED' });
    assert.equal(result.output.execution, 'offline'); assert.equal(result.output.deleteAllowed, false);
    assert.equal(result.stderr, 'LIVE_EXECUTION_LOCKED\n');
  });

  test('unknown stdin authorization and factory fields remain invalid through actual main', async t => {
    const network = networkFor(t), context = await prepared();
    const runner = await createControlledReadonlyRunner({ session: context.session, authorization: context.token });
    for (const extra of [{ authorization: {} }, { session: {} }, { runner: 'controlled' }, { allowLive: true }]) {
      const chunks = [], errors = [];
      const sink = values => ({ write(value, ...args) { values.push(String(value)); queueMicrotask(() => args.find(arg => typeof arg === 'function')?.()); return true; } });
      const exitCode = await main({ argv: [], stdin: Readable.from([Buffer.from(JSON.stringify({ ...sessionInput(), ...extra }))]), stdout: sink(chunks), stderr: sink(errors), runner });
      assert.equal(exitCode, 2); assert.deepEqual(JSON.parse(chunks.join('')).error, { code: 'COMMAND_INPUT_INVALID' });
      assertSafe(chunks.join('')); assertSafe(errors.join(''));
    }
    zeroNetwork(network);
  });

  test('controlled runner factory accepts no caller replacement execute, Host, proof or transport', async () => {
    for (const extra of [{ executeReadonlySession: () => {} }, { HostConstructor: () => {} }, { isTransportInstalled: () => true }, { transport: {} }]) {
      await failure(() => createControlledReadonlyRunner({ session: {}, authorization: {}, ...extra }), 'COMMAND_RUNNER_INVALID');
    }
  });

  for (const scenario of ['invalid-input', 'pre-cancelled']) test(`the controlled runFaceReadonly bridge consumes ${scenario} attempts before its outer checks`, async t => {
    const network = networkFor(t), context = await prepared();
    const runner = await createControlledReadonlyRunner({ session: context.session, authorization: context.token });
    const controller = new AbortController();
    if (scenario === 'pre-cancelled') controller.abort();
    const input = scenario === 'invalid-input' ? { ...context.input, extra: true } : context.input;
    await failure(() => runFaceReadonly(input, { runner, signal: controller.signal }), scenario === 'invalid-input' ? 'SESSION_INPUT_INVALID' : 'COMMAND_CANCELLED');
    zeroNetwork(network); await replayBurned(context, network);
  });
});
