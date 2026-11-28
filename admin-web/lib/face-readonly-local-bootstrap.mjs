import * as events from 'node:events';
import { types } from 'node:util';
import { Readable } from 'node:stream';
import { MAX_INPUT_BYTES, parseReadonlyInput, createControlledReadonlyRunner } from './face-readonly-command.mjs';
import { prepareReadonlySession, reviewReadonlySession, authorizeReadonlySession, SESSION_CODES } from './face-readonly-session.mjs';
import { READONLY_POLICY_CODES } from './face-readonly-policy.mjs';
import { main } from '../face-readonly.mjs';
import { randomUUID } from 'node:crypto';
import { createWindowsEvidenceStore, openWindowsEvidenceStore, checkWindowsEvidenceStore,
  writeWindowsEvidenceStore, sealWindowsEvidenceStore, closeWindowsEvidenceStore,
  inspectWindowsEvidenceStore, windowsEvidenceFailureSignal } from './face-readonly-windows-evidence.mjs';

// Code-only synthetic ports. These brands are not human authentication or a
// sandbox for arbitrary trusted JavaScript. The executable never installs them.
export const LOCAL_BOOTSTRAP_CODES = Object.freeze([
  'LOCAL_CONTEXT_INVALID', 'LOCAL_CONTEXT_USED', 'LOCAL_PORT_INVALID', 'LOCAL_OPTIONS_INVALID',
  'LOCAL_INPUT_INVALID', 'LOCAL_APPROVAL_INVALID', 'LOCAL_APPROVAL_DENIED', 'LOCAL_APPROVAL_USED',
  'LOCAL_APPROVAL_EXPIRED', 'LOCAL_IO_TIMEOUT', 'LOCAL_APPROVAL_TIMEOUT', 'LOCAL_EVIDENCE_INVALID',
  'LOCAL_EVIDENCE_EXISTS', 'LOCAL_EVIDENCE_REFERENCE', 'LOCAL_EVIDENCE_FAILURE', 'LOCAL_OUTPUT_INVALID', 'LOCAL_FAILURE',
]);
const known = new Set([...LOCAL_BOOTSTRAP_CODES, ...SESSION_CODES, ...READONLY_POLICY_CODES,
  'LIVE_EXECUTION_LOCKED', 'COMMAND_CANCELLED', 'COMMAND_INPUT_INVALID', 'COMMAND_PROTOCOL_INVALID', 'COMMAND_OUTPUT_FAILED',
  'INPUT_TOO_LARGE', 'INPUT_UTF8_INVALID', 'INPUT_JSON_INVALID', 'INPUT_DUPLICATE_KEY', 'INPUT_INTERRUPTED', 'INPUT_TIMEOUT',
  'READONLY_INPUT', 'READONLY_OPTIONS', 'READONLY_OPERATION_DENIED', 'READONLY_LIFECYCLE', 'READONLY_BUSY',
  'READONLY_CLOSED', 'READONLY_FAILURE', 'READONLY_SESSION_TIMEOUT', 'READONLY_REQUEST_TIMEOUT', 'READONLY_MODEL', 'READONLY_OUTPUT',
  'HIKVISION_CONFIGURATION', 'HIKVISION_TLS_PIN', 'HIKVISION_AUTH_CHALLENGE', 'HIKVISION_TIMEOUT', 'HIKVISION_TRANSPORT',
  'HIKVISION_REDIRECT', 'HIKVISION_CLOSED', 'HIKVISION_REQUEST', 'HIKVISION_RESPONSE_SIZE',
]);
const inputErrors = new Set(['LOCAL_INPUT_INVALID', 'LOCAL_OPTIONS_INVALID', 'COMMAND_INPUT_INVALID',
  'INPUT_TOO_LARGE', 'INPUT_UTF8_INVALID', 'INPUT_JSON_INVALID', 'INPUT_DUPLICATE_KEY', 'INPUT_INTERRUPTED', 'INPUT_TIMEOUT',
  'SESSION_INPUT_INVALID', 'SESSION_EXPECTATIONS_INVALID', 'SESSION_CERTIFICATE_INVALID']);
const rejected = new Set(['LOCAL_APPROVAL_INVALID', 'LOCAL_APPROVAL_DENIED', 'LOCAL_APPROVAL_USED', 'LOCAL_APPROVAL_EXPIRED']);
const contexts = new WeakMap(), inputs = new WeakMap(), approvals = new WeakMap(), receivers = new WeakMap(), tickets = new WeakMap();
const references = new Set();
const then = Promise.prototype.then, aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
const copyBytes = Uint8Array.prototype.set;
const addAbortListener = events.addAbortListener;
const expectationKeys = ['expectedSpkiPin', 'expectedSerialNumber', 'expectedPlanFingerprint', 'expectedCount', 'targetEmployeeNo', 'targetFDID'];
let nextReference = 0;
const opaque = () => Object.freeze(Object.create(null));
function fault(code) { return Object.assign(new Error('Local readonly bootstrap stopped.'), { code: known.has(code) ? code : 'LOCAL_FAILURE' }); }
function codeOf(error) {
  try { if (!error || typeof error !== 'object' || types.isProxy(error)) return 'LOCAL_FAILURE';
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor && Object.hasOwn(descriptor, 'value') && known.has(descriptor.value) ? descriptor.value : 'LOCAL_FAILURE';
  } catch { return 'LOCAL_FAILURE'; }
}
function fields(value, allowed, required, code) {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fault(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !allowed.includes(key)
      || !Object.hasOwn(descriptors[key], 'value')) || required.some(key => !Object.hasOwn(descriptors, key))) throw fault(code);
    return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
  } catch { throw fault(code); }
}
function callback(value, code = 'LOCAL_PORT_INVALID') { if (typeof value !== 'function' || types.isProxy(value)) throw fault(code); return value; }
function signalValid(signal) {
  if (signal === undefined) return;
  try { if (!signal || typeof signal !== 'object' || types.isProxy(signal)) throw fault('LOCAL_OPTIONS_INVALID'); Reflect.apply(aborted, signal, []); }
  catch { throw fault('LOCAL_OPTIONS_INVALID'); }
}
function outputFailure(code, exitCode) {
  return { protocolVersion: 1, mode: 'readonly', execution: 'local-bootstrap-offline', operation: 'list',
    outcome: exitCode === 2 ? 'invalid-input' : exitCode === 4 ? 'failed' : 'stopped',
    siteVerification: 'NOT_EXECUTED', deleteAllowed: false, error: { code } };
}
const exitFor = code => inputErrors.has(code) ? 2 : rejected.has(code) ? 4 : 5;
function secretIn(text, secrets) { return typeof text === 'string' && secrets.some(secret => text.includes(secret)
  || /^[a-f0-9]{64}$/.test(secret) && text.toLowerCase().includes(secret)); }
function protectDynamicOutput(output, secrets) {
  // Fixed protocol keys and enums can legitimately equal a credential (for
  // example username=readonly). Only externally supplied DTO text is checked.
  const text = [output.device?.model, output.device?.firmware,
    output.allDayPlan?.templateNo, output.allDayPlan?.fingerprint,
    output.verification?.FPID, output.verification?.FDID];
  const rows = value => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw fault('LOCAL_OUTPUT_INVALID');
    return value;
  };
  text.push(...rows(output.allDayPlan?.holidayGroupNos));
  for (const person of rows(output.people)) {
    text.push(person?.employeeNo, person?.name, person?.doorRight, person?.Valid?.beginTime, person?.Valid?.endTime);
    for (const plan of rows(person?.RightPlan)) text.push(plan?.planTemplateNo);
    for (const type of ['blackFD', 'infraredFD']) {
      for (const library of rows(person?.faces?.[type]?.libraries)) text.push(library?.FDID);
    }
  }
  if (text.some(value => secretIn(value, secrets))) throw fault('LOCAL_OUTPUT_INVALID');
}

export function createLocalBootstrap(options = {}) {
  fields(options, [], [], 'LOCAL_OPTIONS_INVALID');
  const context = opaque(); contexts.set(context, { locked: true, used: false }); return context;
}
export function createSyntheticInputSource(options) {
  const data = fields(options, ['read'], ['read'], 'LOCAL_PORT_INVALID');
  const handle = opaque(); inputs.set(handle, callback(data.read)); return handle;
}
export function createSyntheticApprovalSource(options = {}) {
  const data = fields(options, ['request'], [], 'LOCAL_PORT_INVALID');
  const handle = opaque(); approvals.set(handle, data.request === undefined ? (_view, control) => control.reject() : callback(data.request)); return handle;
}
export function createSyntheticEvidenceReceiver(options = {}) {
  const data = fields(options, ['reference', 'onPhase'], [], 'LOCAL_PORT_INVALID');
  const reference = data.reference === undefined ? `LOCAL_EVIDENCE_${++nextReference}` : data.reference;
  if (typeof reference !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(reference)) throw fault('LOCAL_EVIDENCE_REFERENCE');
  const handle = opaque(); receivers.set(handle, { reference, publicReference: undefined, hook: data.onPhase === undefined ? () => undefined : callback(data.onPhase),
    opened: false, ready: false, sealed: false, closed: false, incomplete: false, records: [], phases: [] }); return handle;
}
export function createWindowsEvidenceReceiver(options) {
  const data = fields(options, ['baseDirectory', 'reference'], ['baseDirectory'], 'LOCAL_PORT_INVALID');
  const reference = data.reference === undefined ? `WINDOWS_EVIDENCE_${randomUUID().replaceAll('-', '')}` : data.reference;
  let native;
  try { native = createWindowsEvidenceStore({ baseDirectory: data.baseDirectory, reference }); }
  catch { throw fault('LOCAL_EVIDENCE_INVALID'); }
  const handle = opaque(); receivers.set(handle, { reference, publicReference: undefined, native,
    opened: false, ready: false, sealed: false, closed: false, incomplete: false, records: [], phases: [] }); return handle;
}
export function inspectSyntheticEvidenceReceiver(handle) {
  const state = receivers.get(handle); if (!state) throw fault('LOCAL_PORT_INVALID');
  return structuredClone({ ...(state.publicReference === undefined ? {} : { reference: state.publicReference }),
    opened: state.opened, ready: state.ready, sealed: state.sealed, closed: state.closed, incomplete: state.incomplete,
    records: state.records, phases: state.phases });
}
export function inspectWindowsEvidenceReceiver(handle) {
  const state = receivers.get(handle); if (!state?.native) throw fault('LOCAL_PORT_INVALID');
  return { ...inspectSyntheticEvidenceReceiver(handle), native: inspectWindowsEvidenceStore(state.native) };
}
export function createOfflineLocalBootstrap(options) {
  const data = fields(options, ['inputSource', 'approvalSource', 'evidenceReceiver', 'isTransportInstalled', 'options'],
    ['inputSource', 'approvalSource', 'evidenceReceiver', 'isTransportInstalled'], 'LOCAL_PORT_INVALID');
  if (!inputs.has(data.inputSource) || !approvals.has(data.approvalSource) || !receivers.has(data.evidenceReceiver)) throw fault('LOCAL_PORT_INVALID');
  callback(data.isTransportInstalled);
  const selected = { approvalTimeoutMs: 30000, ioTimeoutMs: 5000,
    ...fields(data.options === undefined ? {} : data.options, ['approvalTimeoutMs', 'ioTimeoutMs'], [], 'LOCAL_OPTIONS_INVALID') };
  if (!Number.isSafeInteger(selected.approvalTimeoutMs) || selected.approvalTimeoutMs < 1 || selected.approvalTimeoutMs > 30000
    || !Number.isSafeInteger(selected.ioTimeoutMs) || selected.ioTimeoutMs < 1 || selected.ioTimeoutMs > 5000) throw fault('LOCAL_OPTIONS_INVALID');
  const handle = opaque(); contexts.set(handle, Object.freeze({ ...data, options: Object.freeze(selected), state: { used: false }, locked: false })); return handle;
}

export async function runLocalBootstrap(handle, options = {}) {
  let context, receiver, signal, subscription, nativeSubscription, cancel, mainExitCode = null, mainResult, firstError, approvalLive = false, issued = false;
  let finalized = false, approvalDeadline, material, observedMain = false, allRecords = false, ownsReceiver = false;
  const controller = new AbortController();
  const cancellation = new Promise((_, reject) => { cancel = reject; }); cancellation.catch(() => {});
  const trip = error => { if (!firstError) firstError = fault(codeOf(error)); };
  const stop = error => { trip(error); approvalLive = false; controller.abort(); cancel(firstError); };
  const ensure = () => { if (signal && Reflect.apply(aborted, signal, [])) stop(fault('COMMAND_CANCELLED')); if (firstError) throw firstError; };
  const transport = () => { let valid = false; try { valid = context.isTransportInstalled() === true; } catch { /* Fixed category only. */ }
    if (!valid) throw fault('LIVE_EXECUTION_LOCKED'); };

  // Only synchronous validated values or genuine Promises are observed. Never
  // assimilate an arbitrary thenable, and never call an overridden .then getter.
  function step(fn, args, validate, timeoutMs, timeoutCode, { finishing = false, errorCode } = {}) {
    return new Promise((resolve, reject) => {
      let live = true;
      const deadline = performance.now() + timeoutMs;
      const finish = (error, value) => { if (!live) return; live = false; clearTimeout(timer); if (error) reject(error); else resolve(value); };
      const fail = (error, fromPort = true) => { const safe = fromPort && errorCode ? fault(errorCode) : fault(codeOf(error)); if (!finishing) stop(safe); finish(safe); };
      const timer = setTimeout(() => { const error = fault(timeoutCode); stop(error); finish(error); }, timeoutMs);
      const accept = value => { if (!live) return; try {
        if (performance.now() >= deadline) { const error = fault(timeoutCode); stop(error); finish(error); return; }
        if (!finishing) ensure(); finish(undefined, validate(value));
      } catch (error) { fail(error, false); } };
      if (!finishing) Reflect.apply(then, cancellation, [undefined, error => finish(error)]);
      try {
        if (!finishing) ensure();
        const value = Reflect.apply(fn, undefined, args);
        if (!types.isProxy(value) && types.isPromise(value)) {
          const descriptors = Object.getOwnPropertyDescriptors(value);
          // Native then consults constructor/species: do not invoke it on an
          // altered prototype or own constructor. For the remaining native
          // Promises, observe both settlements before rejecting their shape.
          // Never read an overridden .then; both no-ops return undefined so
          // the observer's derived Promise cannot assimilate a private value.
          if (Object.getPrototypeOf(value) !== Promise.prototype || Object.hasOwn(descriptors, 'constructor')) throw fault('LOCAL_FAILURE');
          if (Reflect.ownKeys(descriptors).some(key => key === 'then' || !Object.hasOwn(descriptors[key], 'value'))) {
            Reflect.apply(then, value, [() => {}, () => {}]);
            throw fault('LOCAL_FAILURE');
          }
          Reflect.apply(then, value, [accept, fail]);
        } else accept(value);
      } catch (error) { fail(error); }
    });
  }
  async function phase(name, role, finishing = false, text) {
    const item = Object.freeze({ phase: name, ...(role === undefined ? {} : { role }), reference: receiver.reference });
    receiver.phases.push({ phase: name, ...(role === undefined ? {} : { role }) });
    const action = receiver.native ? () => {
      if (name === 'open') return openWindowsEvidenceStore(receiver.native);
      if (name === 'check') return checkWindowsEvidenceStore(receiver.native);
      if (name === 'write') return writeWindowsEvidenceStore(receiver.native, role, text);
      if (name === 'seal') return sealWindowsEvidenceStore(receiver.native);
      if (name === 'close') return closeWindowsEvidenceStore(receiver.native);
      throw fault('LOCAL_EVIDENCE_INVALID');
    } : receiver.hook;
    await step(action, [item], value => { if (value !== undefined) throw fault('LOCAL_EVIDENCE_INVALID'); },
      context.options.ioTimeoutMs, 'LOCAL_IO_TIMEOUT', { finishing, errorCode: 'LOCAL_EVIDENCE_FAILURE' });
  }
  const snapshot = value => {
    const data = fields(value, ['inputBytes', 'expectations'], ['inputBytes', 'expectations'], 'LOCAL_INPUT_INVALID');
    if (!data.inputBytes || types.isProxy(data.inputBytes) || !types.isUint8Array(data.inputBytes)) throw fault('LOCAL_INPUT_INVALID');
    const length = Reflect.apply(byteLength, data.inputBytes, []);
    if (length > MAX_INPUT_BYTES) throw fault('INPUT_TOO_LARGE');
    const bytes = Buffer.alloc(length); Reflect.apply(copyBytes, bytes, [data.inputBytes]);
    try {
      const input = parseReadonlyInput(bytes);
      const expected = Object.freeze(fields(data.expectations, expectationKeys, expectationKeys, 'LOCAL_INPUT_INVALID'));
      const session = prepareReadonlySession(input, expected), view = reviewReadonlySession(session);
      const secrets = [input.config.origin, input.config.username, input.config.password, input.config.certificateBase64,
        expected.expectedSerialNumber, expected.expectedSpkiPin].filter(value => typeof value === 'string' && value.length);
      return { input, session, view, secrets };
    } finally { bytes.fill(0); }
  };
  try {
    context = contexts.get(handle); if (!context) throw fault('LOCAL_CONTEXT_INVALID');
    const state = context.state ?? context;
    if (state.used) throw fault('LOCAL_CONTEXT_USED');
    state.used = true;
    if (context.locked) throw fault('LIVE_EXECUTION_LOCKED');
    ({ signal } = fields(options, ['signal'], [], 'LOCAL_OPTIONS_INVALID')); signalValid(signal);
    if (signal) {
      if (typeof addAbortListener !== 'function' || typeof Symbol.dispose !== 'symbol') throw fault('LOCAL_FAILURE');
      subscription = addAbortListener(signal, () => stop(fault('COMMAND_CANCELLED')));
    }
    ensure(); transport();
    receiver = receivers.get(context.evidenceReceiver);
    if (receiver.opened) throw fault('LOCAL_EVIDENCE_EXISTS');
    material = await step(inputs.get(context.inputSource), [], snapshot, context.options.ioTimeoutMs, 'LOCAL_IO_TIMEOUT');
    ensure(); transport();
    if (receiver.opened || references.has(receiver.reference)) throw fault('LOCAL_EVIDENCE_EXISTS');
    if (secretIn(receiver.reference, material.secrets)) throw fault('LOCAL_EVIDENCE_REFERENCE');
    references.add(receiver.reference); receiver.opened = true; ownsReceiver = true; receiver.publicReference = receiver.reference;
    if (receiver.native) nativeSubscription = addAbortListener(windowsEvidenceFailureSignal(receiver.native), () => stop(fault('LOCAL_EVIDENCE_FAILURE')));
    await phase('open'); receiver.ready = true;
    ensure(); transport();
    approvalLive = true; approvalDeadline = performance.now() + context.options.approvalTimeoutMs;
    const decide = decision => candidate => {
      if (finalized) throw fault('LOCAL_APPROVAL_EXPIRED');
      if (!approvalLive || performance.now() >= approvalDeadline) { const error = fault('LOCAL_APPROVAL_EXPIRED'); stop(error); throw error; }
      if (issued) { const error = fault('LOCAL_APPROVAL_USED'); stop(error); throw error; }
      if (candidate !== undefined && candidate !== material.view) { const error = fault('LOCAL_APPROVAL_INVALID'); stop(error); throw error; }
      ensure(); issued = true;
      const ticket = opaque(); tickets.set(ticket, { context: handle, view: material.view, decision }); return ticket;
    };
    const control = Object.freeze({ approve: decide('approve'), reject: decide('reject') });
    const ticket = await step(approvals.get(context.approvalSource), [material.view, control], value => {
      if (performance.now() >= approvalDeadline) throw fault('LOCAL_APPROVAL_EXPIRED');
      const data = tickets.get(value);
      if (!data || data.context !== handle || data.view !== material.view) throw fault('LOCAL_APPROVAL_INVALID');
      return value;
    }, context.options.approvalTimeoutMs, 'LOCAL_APPROVAL_TIMEOUT');
    approvalLive = false; ensure(); transport();
    if (tickets.get(ticket).decision !== 'approve') throw fault('LOCAL_APPROVAL_DENIED');
    if (receiver.native) { await phase('check'); ensure(); transport(); }
    const authorization = authorizeReadonlySession(material.session, material.view);
    const runner = await createControlledReadonlyRunner({ session: material.session, authorization });
    ensure(); transport();
    const captured = { stdout: '', stderr: '' };
    const sink = role => ({ write(value, done) {
      if (typeof value !== 'string' || Buffer.byteLength(captured[role]) + Buffer.byteLength(value) > 8388608) {
        queueMicrotask(() => done(fault('LOCAL_OUTPUT_INVALID'))); return false;
      }
      captured[role] += value; queueMicrotask(() => done()); return true;
    } });
    const inputBytes = Buffer.from(JSON.stringify(material.input));
    try {
      mainExitCode = await step(main, [{ argv: [], stdin: Readable.from([inputBytes]), stdout: sink('stdout'), stderr: sink('stderr'),
        signal: controller.signal, runner }], value => { if (![0, 2, 4, 5].includes(value)) throw fault('LOCAL_OUTPUT_INVALID'); return value; },
      material.input.options.totalTimeoutMs + 2000, 'LOCAL_IO_TIMEOUT', { finishing: true });
    } finally { inputBytes.fill(0); }
    const stdout = captured.stdout, stderr = captured.stderr;
    if (!stdout.endsWith('\n') || stdout.split('\n').length !== 2) throw fault('LOCAL_OUTPUT_INVALID');
    let output; try { output = JSON.parse(stdout); } catch { throw fault('LOCAL_OUTPUT_INVALID'); }
    if (output?.protocolVersion !== 1 || output.mode !== 'readonly' || output.operation !== 'list'
      || output.siteVerification !== 'NOT_EXECUTED' || output.deleteAllowed !== false) throw fault('LOCAL_OUTPUT_INVALID');
    protectDynamicOutput(output, material.secrets);
    if (mainExitCode === 0) {
      if (output.outcome !== 'controlled-readonly-completed' || output.error !== undefined || stderr !== '') throw fault('LOCAL_OUTPUT_INVALID');
      mainResult = { exitCode: 0, output };
    } else {
      const code = output.error?.code;
      if (!known.has(code) || stderr !== `${code}\n`) throw fault('LOCAL_OUTPUT_INVALID');
      mainResult = { exitCode: mainExitCode, code, output }; trip(fault(code));
    }
    observedMain = true;
    for (const [role, text] of [['stdout', stdout], ['stderr', stderr], ['main-exit', `${mainExitCode}\n`]]) {
      if (receiver.records.some(record => record.role === role)) throw fault('LOCAL_EVIDENCE_EXISTS');
      await phase('write', role, true, text); receiver.records.push({ role, text });
    }
    await phase('seal', undefined, true); receiver.sealed = true; allRecords = true;
  } catch (error) { stop(error); }
  finally {
    approvalLive = false; controller.abort();
    if (ownsReceiver && !receiver.closed) {
      try { await phase('close', undefined, true); receiver.closed = true; } catch (error) { trip(error); }
    }
    if (subscription) { try { subscription[Symbol.dispose](); } catch (error) { trip(error); } }
    if (nativeSubscription) { try { nativeSubscription[Symbol.dispose](); } catch (error) { trip(error); } }
    finalized = true;
    if (ownsReceiver) receiver.incomplete = !(allRecords && receiver.sealed && receiver.closed);
  }
  const evidence = { ...(!ownsReceiver || receiver.publicReference === undefined ? {} : { reference: receiver.publicReference }),
    status: !ownsReceiver ? 'NOT_OPENED' : receiver.incomplete ? 'INCOMPLETE' : 'COMPLETE' };
  if (firstError) {
    const code = codeOf(firstError), preserved = observedMain && mainResult?.code === code ? mainResult : undefined;
    return { ...(preserved ?? { exitCode: exitFor(code), code, output: outputFailure(code, exitFor(code)) }), mainExitCode, evidence };
  }
  if (!mainResult || !observedMain || evidence.status !== 'COMPLETE') {
    const code = 'LOCAL_FAILURE'; return { exitCode: 5, code, output: outputFailure(code, 5), mainExitCode, evidence };
  }
  return { ...mainResult, mainExitCode, evidence };
}
