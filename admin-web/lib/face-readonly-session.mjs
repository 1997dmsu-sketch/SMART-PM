import { createHash, timingSafeEqual, X509Certificate } from 'node:crypto';
import * as events from 'node:events';
import { types } from 'node:util';
import { normalizeReadonlyInput, safeReadonlyResult } from './face-readonly-command.mjs';
import { FaceReadonlyHost } from './face-readonly-host.mjs';
import { READONLY_POLICY_CODES } from './face-readonly-policy.mjs';

export const SESSION_CODES = Object.freeze([
  'SESSION_INPUT_INVALID', 'SESSION_EXPECTATIONS_INVALID', 'SESSION_CERTIFICATE_INVALID',
  'SESSION_PIN_MISMATCH', 'SESSION_INVALID', 'SESSION_REVIEW_INVALID',
  'SESSION_AUTHORIZATION_INVALID', 'SESSION_AUTHORIZATION_USED', 'SESSION_INPUT_MISMATCH',
  'SESSION_COUNT_MISMATCH', 'SESSION_TARGET_UNCONFIRMED',
]);

const inputCodes = new Set(['SESSION_INPUT_INVALID', 'SESSION_EXPECTATIONS_INVALID', 'SESSION_CERTIFICATE_INVALID']);
const rejectionCodes = new Set([
  ...SESSION_CODES.filter(code => !inputCodes.has(code)),
  'READONLY_INPUT', 'READONLY_OPTIONS', 'READONLY_OPERATION_DENIED', 'READONLY_BUDGET', 'READONLY_CONFIGURATION',
  'READONLY_MODEL', 'READONLY_IDENTITY', 'READONLY_PLAN_MISMATCH', 'READONLY_COUNT_MISMATCH',
  'READONLY_DEVICE_ERROR', 'READONLY_HTTP', 'READONLY_LIBRARY', 'READONLY_REFERENCE',
  'READONLY_FACE_UNCONFIRMED', 'HIKVISION_CONFIGURATION', 'HIKVISION_TLS_PIN', 'HIKVISION_AUTH_CHALLENGE',
]);
const knownCodes = new Set([
  ...SESSION_CODES, ...READONLY_POLICY_CODES,
  'READONLY_INPUT', 'READONLY_OPTIONS', 'READONLY_OPERATION_DENIED', 'READONLY_LIFECYCLE', 'READONLY_BUSY',
  'READONLY_CLOSED', 'READONLY_FAILURE', 'READONLY_SESSION_TIMEOUT', 'READONLY_REQUEST_TIMEOUT',
  'READONLY_MODEL', 'READONLY_IDENTITY', 'READONLY_PLAN_MISMATCH', 'READONLY_COUNT_MISMATCH', 'READONLY_OUTPUT',
  'HIKVISION_CONFIGURATION', 'HIKVISION_TLS_PIN', 'HIKVISION_AUTH_CHALLENGE', 'HIKVISION_TIMEOUT',
  'HIKVISION_TRANSPORT', 'HIKVISION_REDIRECT', 'HIKVISION_CLOSED', 'HIKVISION_REQUEST', 'HIKVISION_RESPONSE_SIZE',
  'COMMAND_CANCELLED', 'COMMAND_PROTOCOL_INVALID',
]);

const sessions = new WeakMap();
const reviews = new WeakMap();
const authorizations = new WeakMap();
const issuedSessions = new WeakSet();
const inputFields = ['operation', 'mode', 'config', 'options'];
const configFields = ['mode', 'origin', 'username', 'password', 'certificateBase64', 'developmentTls', 'planTemplateNo'];
const optionFields = ['expectedModel', 'planTemplateNo', 'maxRequests', 'totalTimeoutMs', 'requestTimeoutMs'];
const expectationFields = ['expectedSpkiPin', 'expectedSerialNumber', 'expectedPlanFingerprint', 'expectedCount', 'targetEmployeeNo', 'targetFDID'];
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const addAbortListener = events.addAbortListener;

function fault(code) {
  return Object.assign(new Error('Controlled readonly session rejected.'), { code: knownCodes.has(code) ? code : 'READONLY_FAILURE' });
}

// Inspect data descriptors only. In particular, reject proxies before performing
// any operation that could invoke their traps, even for the input's root object.
function record(value, allowed, required, code) {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fault(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !allowed.includes(key)
      || !Object.hasOwn(descriptors[key], 'value')) || required.some(key => !Object.hasOwn(descriptors, key))) throw fault(code);
    return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
  } catch { throw fault(code); }
}

function snapshotInput(input) {
  try {
    const data = record(input, inputFields, ['operation', 'mode', 'config'], 'SESSION_INPUT_INVALID');
    const config = record(data.config, configFields, ['mode', 'origin', 'username', 'password', 'certificateBase64'], 'SESSION_INPUT_INVALID');
    const options = record(data.options === undefined ? {} : data.options, optionFields, [], 'SESSION_INPUT_INVALID');
    const normalized = normalizeReadonlyInput({ operation: data.operation, mode: data.mode, config, options });
    return Object.freeze({ operation: normalized.operation, mode: normalized.mode,
      config: Object.freeze({ ...normalized.config }), options: Object.freeze({ ...normalized.options }) });
  } catch { throw fault('SESSION_INPUT_INVALID'); }
}

function snapshotExpectations(expectations) {
  const data = record(expectations, expectationFields, expectationFields, 'SESSION_EXPECTATIONS_INVALID');
  if (typeof data.expectedSpkiPin !== 'string' || !/^[a-f0-9]{64}$/.test(data.expectedSpkiPin)
    || typeof data.expectedSerialNumber !== 'string' || !data.expectedSerialNumber.length || data.expectedSerialNumber.length > 128
    || /[\x00-\x1f\x7f]/.test(data.expectedSerialNumber)
    || typeof data.expectedPlanFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(data.expectedPlanFingerprint)
    || !Number.isSafeInteger(data.expectedCount) || data.expectedCount < 1 || data.expectedCount > 1000
    || typeof data.targetEmployeeNo !== 'string' || !/^[A-Za-z0-9]{1,32}$/.test(data.targetEmployeeNo)
    || typeof data.targetFDID !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(data.targetFDID)) throw fault('SESSION_EXPECTATIONS_INVALID');
  return Object.freeze({ ...data });
}

function verifyCertificate(snapshot, expectations) {
  const certificate = Buffer.from(snapshot.config.certificateBase64, 'base64');
  let observedPin, expectedPin, publicKey;
  try {
    try {
      publicKey = new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' });
      observedPin = createHash('sha256').update(publicKey).digest();
    } catch { throw fault('SESSION_CERTIFICATE_INVALID'); }
    expectedPin = Buffer.from(expectations.expectedSpkiPin, 'hex');
    if (!timingSafeEqual(observedPin, expectedPin)) throw fault('SESSION_PIN_MISMATCH');
  } finally {
    certificate.fill(0); publicKey?.fill(0); observedPin?.fill(0); expectedPin?.fill(0);
  }
}

function sameRecord(left, right) {
  const leftKeys = Object.keys(left).sort(), rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && Object.is(left[key], right[key]));
}
function sameInput(left, right) {
  return left.operation === right.operation && left.mode === right.mode
    && sameRecord(left.config, right.config) && sameRecord(left.options, right.options);
}
function safeCode(error) {
  try {
    if (!error || typeof error !== 'object' || types.isProxy(error)) return 'READONLY_FAILURE';
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor && Object.hasOwn(descriptor, 'value') && knownCodes.has(descriptor.value) ? descriptor.value : 'READONLY_FAILURE';
  } catch { return 'READONLY_FAILURE'; }
}
function base(outcome) {
  return { protocolVersion: 1, mode: 'readonly', execution: 'controlled-readonly', operation: 'list', outcome,
    siteVerification: 'NOT_EXECUTED', deleteAllowed: false };
}
function sensitiveValues(snapshot, expectations, includePlanFingerprint = false) {
  return [snapshot.config.origin, snapshot.config.username, snapshot.config.password, snapshot.config.certificateBase64,
    expectations.expectedSerialNumber, expectations.expectedSpkiPin,
    ...(includePlanFingerprint ? [expectations.expectedPlanFingerprint] : [])].filter(Boolean);
}
function containsSensitiveText(values, sensitive) {
  return values.some(value => typeof value === 'string' && sensitive.some(secret => value.includes(secret)
    || /^[a-f0-9]{64}$/.test(secret) && value.toLowerCase().includes(secret)));
}
function protectObservedText(output, snapshot, expectations) {
  const text = [output.device.model, output.device.firmware, output.allDayPlan.templateNo,
    output.allDayPlan.fingerprint, ...output.allDayPlan.holidayGroupNos];
  for (const person of output.people) {
    text.push(person.employeeNo, person.name, person.doorRight, person.Valid.beginTime, person.Valid.endTime,
      ...person.RightPlan.map(plan => plan.planTemplateNo));
    for (const type of ['blackFD', 'infraredFD']) text.push(...person.faces[type].libraries.map(library => library.FDID));
  }
  if (containsSensitiveText(text, sensitiveValues(snapshot, expectations))) throw fault('READONLY_OUTPUT');
}
function failureResult(error, observation) {
  const code = safeCode(error);
  const exitCode = inputCodes.has(code) ? 2 : rejectionCodes.has(code) ? 4 : 5;
  return { exitCode, code, output: { ...base(exitCode === 2 ? 'invalid-input' : exitCode === 4 ? 'failed' : 'stopped'),
    error: { code }, ...(code === 'READONLY_COUNT_MISMATCH' && observation ? { observation } : {}) } };
}

/** Prepare only in memory. Neither preparation nor review creates a host. */
export function prepareReadonlySession(input, expectations) {
  const snapshot = snapshotInput(input);
  const expected = snapshotExpectations(expectations);
  verifyCertificate(snapshot, expected);
  const view = Object.freeze({ protocolVersion: 1, mode: 'readonly', operation: 'list',
    expectedModel: snapshot.options.expectedModel, planTemplateNo: snapshot.options.planTemplateNo,
    expectedCount: expected.expectedCount, targetEmployeeNo: expected.targetEmployeeNo,
    targetFaceLibType: 'blackFD', targetFDID: expected.targetFDID });
  if (containsSensitiveText([view.expectedModel, view.planTemplateNo, view.targetEmployeeNo, view.targetFDID],
    sensitiveValues(snapshot, expected, true))) throw fault('SESSION_REVIEW_INVALID');
  const session = Object.freeze(Object.create(null));
  sessions.set(session, Object.freeze({ snapshot, expectations: expected, view }));
  reviews.set(view, session);
  return session;
}

export function reviewReadonlySession(session) {
  const data = sessions.get(session);
  if (!data) throw fault('SESSION_INVALID');
  return data.view;
}

/** A token is an identity capability, never an enumerable or serialized proof. */
export function authorizeReadonlySession(session, view) {
  const data = sessions.get(session);
  if (!data) throw fault('SESSION_INVALID');
  if (data.view !== view || reviews.get(view) !== session) throw fault('SESSION_REVIEW_INVALID');
  if (issuedSessions.has(session)) throw fault('SESSION_AUTHORIZATION_USED');
  const authorization = Object.freeze(Object.create(null));
  issuedSessions.add(session);
  authorizations.set(authorization, { session, view, used: false });
  return authorization;
}

function receipt(list, state, snapshot, expectations) {
  // Reuse the established DTO projection before interpreting any observed data.
  const projected = safeReadonlyResult(list, state, snapshot);
  if (projected.exitCode !== 0 || !projected.output) throw fault('COMMAND_PROTOCOL_INVALID');
  const observed = projected.output;
  protectObservedText(observed, snapshot, expectations);
  if (observed.total !== expectations.expectedCount) throw fault('SESSION_COUNT_MISMATCH');
  const people = observed.people.filter(person => person.employeeNo === expectations.targetEmployeeNo);
  if (people.length !== 1 || observed.managementSearchObserved !== true || people[0].managementSearchObserved !== true) throw fault('SESSION_TARGET_UNCONFIRMED');
  const libraries = people[0].faces.blackFD.libraries.filter(library => library.FDID === expectations.targetFDID);
  if (libraries.length !== 1 || libraries[0].status !== 'present' || libraries[0].recordStatus !== 'present') throw fault('SESSION_TARGET_UNCONFIRMED');
  return { exitCode: 0, output: { ...observed, ...base('controlled-readonly-completed'), verification: {
    status: 'CONFIRMED', FPID: people[0].employeeNo, faceLibType: 'blackFD', FDID: libraries[0].FDID,
    inLibrary: true, actualCount: observed.total, expectedCount: expectations.expectedCount,
  } } };
}

/** Consume first, then validate all execution inputs; every attempt is final. */
export async function executeReadonlySession(session, authorization, input, options = {}) {
  let host, firstError, cancel, signal, expectedCount, observation, abortSubscription;
  const trip = error => { if (!firstError) firstError = fault(safeCode(error)); };
  const ensure = () => {
    if (signal && Reflect.apply(aborted, signal, [])) trip(fault('COMMAND_CANCELLED'));
    if (firstError) throw firstError;
  };
  const abort = () => {
    trip(fault('COMMAND_CANCELLED'));
    try { host?.close(); } catch { /* Cancellation remains the first fault. */ }
    cancel?.(firstError);
  };
  let result;
  try {
    const grant = authorizations.get(authorization);
    if (!grant) throw fault('SESSION_AUTHORIZATION_INVALID');
    if (grant.used) throw fault('SESSION_AUTHORIZATION_USED');
    grant.used = true;
    const data = sessions.get(session);
    if (!data || grant.session !== session || grant.view !== data.view || reviews.get(grant.view) !== session) throw fault('SESSION_AUTHORIZATION_INVALID');
    expectedCount = data.expectations.expectedCount;
    const laterInput = snapshotInput(input);
    if (!sameInput(data.snapshot, laterInput)) throw fault('SESSION_INPUT_MISMATCH');
    ({ signal } = record(options, ['signal'], [], 'SESSION_INPUT_INVALID'));
    if (signal !== undefined) {
      try {
        if (!signal || typeof signal !== 'object' || types.isProxy(signal)) throw fault('SESSION_INPUT_INVALID');
        Reflect.apply(aborted, signal, []);
      } catch { throw fault('SESSION_INPUT_INVALID'); }
    }
    const cancellation = new Promise((_, reject) => { cancel = reject; });
    cancellation.catch(() => {});
    if (signal) {
      // Ordinary abort listeners can be suppressed by stopImmediatePropagation.
      // Older Node 20 releases without this API must stop before creating a Host.
      if (typeof addAbortListener !== 'function' || typeof Symbol.dispose !== 'symbol') throw fault('READONLY_FAILURE');
      abortSubscription = addAbortListener(signal, abort);
    }
    ensure();
    host = new FaceReadonlyHost({ ...data.snapshot.options,
      expectedSerialNumber: data.expectations.expectedSerialNumber,
      expectedPlanFingerprint: data.expectations.expectedPlanFingerprint,
      expectedPeopleCount: data.expectations.expectedCount });
    ensure();
    await Promise.race([host.connect(data.snapshot.config), cancellation]);
    ensure();
    const list = await Promise.race([host.list(), cancellation]);
    ensure();
    result = receipt(list, host.state(), data.snapshot, data.expectations);
    ensure();
  } catch (error) {
    trip(error);
    if (safeCode(firstError) === 'READONLY_COUNT_MISMATCH' && host) {
      try {
        const count = record(host.state()?.readonly?.countMismatch, ['actualCount', 'expectedCount'],
          ['actualCount', 'expectedCount'], 'COMMAND_PROTOCOL_INVALID');
        if (Number.isSafeInteger(count.actualCount) && count.actualCount >= 0 && count.actualCount <= 1000
          && Number.isSafeInteger(count.expectedCount) && count.expectedCount >= 1 && count.expectedCount <= 1000
          && count.expectedCount === expectedCount && count.actualCount !== count.expectedCount) {
          observation = { actualCount: count.actualCount, expectedCount: count.expectedCount, complete: false };
        }
      } catch { /* Missing or invalid observations never become asserted counts. */ }
    }
  }
  finally {
    try { host?.close(); } catch (error) { trip(error); }
    if (abortSubscription) {
      try { abortSubscription[Symbol.dispose](); } catch (error) { trip(error); }
    }
  }
  return firstError ? failureResult(firstError, observation) : result;
}
