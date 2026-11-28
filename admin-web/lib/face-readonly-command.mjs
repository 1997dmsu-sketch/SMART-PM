import { FaceReadonlyHost } from './face-readonly-host.mjs';
import { READONLY_POLICY_CODES } from './face-readonly-policy.mjs';

export const MAX_INPUT_BYTES = 32768;
const runners = new WeakSet();
const controlledRunners = new WeakSet();
const defaults = Object.freeze({ expectedModel: 'DS-K1T671BM', planTemplateNo: '1', maxRequests: 256, totalTimeoutMs: 120000, requestTimeoutMs: 5000 });
const knownCodes = new Set([
  ...READONLY_POLICY_CODES,
  'READONLY_INPUT', 'READONLY_OPTIONS', 'READONLY_OPERATION_DENIED', 'READONLY_LIFECYCLE', 'READONLY_BUSY',
  'READONLY_CLOSED', 'READONLY_FAILURE', 'READONLY_SESSION_TIMEOUT', 'READONLY_REQUEST_TIMEOUT', 'READONLY_MODEL', 'READONLY_OUTPUT',
  'HIKVISION_CONFIGURATION', 'HIKVISION_TLS_PIN', 'HIKVISION_AUTH_CHALLENGE', 'HIKVISION_TIMEOUT',
  'HIKVISION_TRANSPORT', 'HIKVISION_REDIRECT', 'HIKVISION_CLOSED', 'HIKVISION_REQUEST', 'HIKVISION_RESPONSE_SIZE',
  'LIVE_EXECUTION_LOCKED', 'COMMAND_CANCELLED', 'COMMAND_RUNNER_INVALID', 'COMMAND_PROTOCOL_INVALID',
]);
const rejectionCodes = new Set([
  'READONLY_INPUT', 'READONLY_OPTIONS', 'READONLY_OPERATION_DENIED', 'READONLY_BUDGET', 'READONLY_CONFIGURATION',
  'READONLY_MODEL', 'READONLY_DEVICE_ERROR', 'READONLY_HTTP', 'READONLY_LIBRARY', 'READONLY_REFERENCE',
  'READONLY_FACE_UNCONFIRMED', 'HIKVISION_CONFIGURATION', 'HIKVISION_TLS_PIN', 'HIKVISION_AUTH_CHALLENGE',
]);

export class ReadonlyInputError extends Error {
  constructor(code = 'COMMAND_INPUT_INVALID') { super('Readonly command input rejected.'); this.code = code; }
}
function stop(code) { return Object.assign(new Error('Readonly command stopped.'), { code }); }
function invalid() { throw new ReadonlyInputError(); }
const integer = (value, maximum) => Number.isSafeInteger(value) && value >= 1 && value <= maximum;
const clean = (value, maximum, empty = false) => typeof value === 'string' && (empty || value.length > 0)
  && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
const template = value => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));

function fields(value, allowed, required = []) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value'))
      || required.some(key => !Object.hasOwn(descriptors, key))) invalid();
    return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
  } catch { invalid(); }
}

/** No reviver: duplicate decoded keys must be rejected before values are lost. */
function strictJson(source) {
  let offset = 0;
  const bad = () => { throw new ReadonlyInputError('INPUT_JSON_INVALID'); };
  const space = () => { while (/[ \t\r\n]/.test(source[offset] ?? '') && offset < source.length) offset++; };
  const string = () => {
    const start = offset++;
    while (offset < source.length) {
      const char = source[offset++];
      if (char === '"') {
        try { return JSON.parse(source.slice(start, offset)); } catch { bad(); }
      }
      if (char.charCodeAt(0) < 32) bad();
      if (char === '\\') {
        const escaped = source[offset++];
        if (escaped === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(offset, offset + 4))) bad();
          offset += 4;
        } else if (typeof escaped !== 'string' || !'"\\/bfnrt'.includes(escaped)) bad();
      }
    }
    bad();
  };
  const value = depth => {
    if (depth > 16) bad();
    space();
    const char = source[offset];
    if (char === '"') return string();
    if (char === '{') {
      offset++; space();
      const object = Object.create(null), keys = new Set();
      if (source[offset] === '}') { offset++; return object; }
      while (offset < source.length) {
        if (source[offset] !== '"') bad();
        const key = string();
        if (keys.has(key)) throw new ReadonlyInputError('INPUT_DUPLICATE_KEY');
        keys.add(key); space();
        if (source[offset++] !== ':') bad();
        object[key] = value(depth + 1); space();
        const separator = source[offset++];
        if (separator === '}') return object;
        if (separator !== ',') bad();
        space();
      }
      bad();
    }
    if (char === '[') {
      offset++; space();
      const array = [];
      if (source[offset] === ']') { offset++; return array; }
      while (offset < source.length) {
        array.push(value(depth + 1)); space();
        const separator = source[offset++];
        if (separator === ']') return array;
        if (separator !== ',') bad();
      }
      bad();
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(token, offset)) { offset += token.length; return result; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(offset));
    if (!number) bad();
    offset += number[0].length;
    const result = Number(number[0]);
    if (!Number.isFinite(result)) bad();
    return result;
  };
  const result = value(0);
  space();
  if (offset !== source.length) bad();
  return result;
}

export function normalizeReadonlyInput(input) {
  const root = fields(input, ['operation', 'mode', 'config', 'options'], ['operation', 'mode', 'config']);
  if (root.operation !== 'list' || root.mode !== 'offline') invalid();
  const config = fields(root.config, ['mode', 'origin', 'username', 'password', 'certificateBase64', 'developmentTls', 'planTemplateNo'],
    ['mode', 'origin', 'username', 'password', 'certificateBase64']);
  if (config.mode !== 'device' || !clean(config.origin, 512) || !clean(config.username, 1024)
    || !clean(config.password, 4096, true) || !clean(config.certificateBase64, MAX_INPUT_BYTES)
    || config.developmentTls !== undefined && typeof config.developmentTls !== 'boolean'
    || config.planTemplateNo !== undefined && !template(config.planTemplateNo)) invalid();
  let origin;
  try { origin = new URL(config.origin); } catch { invalid(); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) invalid();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(config.certificateBase64)
    || Buffer.from(config.certificateBase64, 'base64').toString('base64') !== config.certificateBase64) invalid();
  const selected = { ...defaults, ...fields(root.options === undefined ? {} : root.options,
    ['expectedModel', 'planTemplateNo', 'maxRequests', 'totalTimeoutMs', 'requestTimeoutMs']) };
  if (!clean(selected.expectedModel, 128) || !template(selected.planTemplateNo) || !integer(selected.maxRequests, 256)
    || !integer(selected.totalTimeoutMs, 120000) || !integer(selected.requestTimeoutMs, 5000)
    || config.planTemplateNo !== undefined && config.planTemplateNo !== selected.planTemplateNo) invalid();
  return Object.freeze({ operation: 'list', mode: 'offline', config: Object.freeze(config), options: Object.freeze(selected) });
}

export function parseReadonlyInput(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new ReadonlyInputError('INPUT_INTERRUPTED');
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new ReadonlyInputError('INPUT_TOO_LARGE');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new ReadonlyInputError('INPUT_UTF8_INVALID'); }
  return normalizeReadonlyInput(strictJson(source));
}

function base(outcome) {
  return { protocolVersion: 1, mode: 'readonly', execution: 'offline', operation: 'list', outcome, siteVerification: 'NOT_EXECUTED', deleteAllowed: false };
}
export function readonlyFailure(code, exitCode = 5) {
  return { exitCode, code, output: { ...base(exitCode === 2 ? 'invalid-input' : exitCode === 4 ? 'failed' : 'stopped'), error: { code } } };
}
function errorCode(error) {
  try { const code = error?.code; return typeof code === 'string' && knownCodes.has(code) ? code : 'READONLY_FAILURE'; }
  catch { return 'READONLY_FAILURE'; }
}

function safeResult(list, state, input) {
  if (!state || state.readonly?.blocked || state.readonly?.errorCode) throw stop(errorCode({ code: state?.readonly?.errorCode }));
  if (state.readonly?.status !== 'COMPLETE' || !integer(state.readonly.logicalRequests, input.options.maxRequests)
    || !list || list.complete !== true || !Number.isSafeInteger(list.total) || list.total < 0 || list.total > 1000
    || !Array.isArray(list.people) || list.people.length !== list.total) throw stop('COMMAND_PROTOCOL_INVALID');
  const sensitive = [input.config.origin, input.config.username, input.config.password, input.config.certificateBase64].filter(Boolean);
  const text = (value, maximum = 128) => typeof value === 'string' && value.length <= maximum
    && /^[\p{L}\p{N} ._()+,:@-]*$/u.test(value) && !sensitive.some(secret => value.includes(secret)) ? value : '';
  const requiredText = (value, maximum = 128) => {
    const selected = text(value, maximum);
    if (!selected) throw stop('READONLY_OUTPUT');
    return selected;
  };
  const plan = state.capabilities?.allDayPlan;
  if (!plan || plan.templateNo !== input.options.planTemplateNo || !/^[a-f0-9]{64}$/.test(plan.fingerprint)
    || !integer(plan.weekPlanNo, Number.MAX_SAFE_INTEGER) || !Array.isArray(plan.holidayGroupNos)
    || plan.holidayGroupNos.length > 4 || !plan.holidayGroupNos.every(template)
    || new Set(plan.holidayGroupNos).size !== plan.holidayGroupNos.length) throw stop('COMMAND_PROTOCOL_INVALID');
  const allDayPlan = { templateNo: requiredText(plan.templateNo), fingerprint: requiredText(plan.fingerprint, 64), name: '每天24小时',
    weekPlanNo: plan.weekPlanNo, holidayGroupNos: plan.holidayGroupNos.map(value => requiredText(value, 32)) };
  const status = value => ['present', 'absent', 'unknown', 'unsupported'].includes(value) ? value : 'unknown';
  const faces = source => Object.fromEntries(['blackFD', 'infraredFD'].map(type => {
    const group = source?.[type];
    if (!group || !Array.isArray(group.libraries) || group.libraries.length > 16) throw stop('COMMAND_PROTOCOL_INVALID');
    return [type, { status: status(group.status), libraries: group.libraries.map(row => ({
      FDID: requiredText(row.FDID, 64), status: status(row.status), recordStatus: status(row.recordStatus),
    })) }];
  }));
  const people = list.people.map(row => {
    if (!row || typeof row.employeeNo !== 'string' || !/^[A-Za-z0-9]{1,32}$/.test(row.employeeNo)
      || !Array.isArray(row.RightPlan) || row.RightPlan.length > 65535 || !row.Valid) throw stop('COMMAND_PROTOCOL_INVALID');
    return { employeeNo: requiredText(row.employeeNo, 32), name: text(row.name), doorRight: text(row.doorRight, 256),
      RightPlan: row.RightPlan.map(plan => ({ doorNo: Number.isSafeInteger(plan.doorNo) && plan.doorNo >= 1 && plan.doorNo <= 65535 ? plan.doorNo : null,
        planTemplateNo: requiredText(plan.planTemplateNo) })),
      Valid: { enable: typeof row.Valid.enable === 'boolean' ? row.Valid.enable : null,
        beginTime: text(row.Valid.beginTime, 64), endTime: text(row.Valid.endTime, 64) },
      faces: faces(row.faces), managementSearchObserved: row.managementSearchObserved === true, deleteAllowed: false };
  });
  return { exitCode: 0, output: { ...base('synthetic-readonly-completed'),
    device: { model: requiredText(state.device?.model), firmware: text(state.device?.firmware, 64) }, allDayPlan,
    total: list.total, complete: true, managementSearchObserved: list.managementSearchObserved === true, people,
    readonly: { status: 'COMPLETE', blocked: false, errorCode: null, logicalRequests: state.readonly.logicalRequests } } };
}

// Shared projection only: this export does not authorize or start a session.
export { safeResult as safeReadonlyResult };

/** Code-only controlled capability; the executable entry never supplies it. */
export async function createControlledReadonlyRunner(options = {}) {
  let data;
  try { data = fields(options, ['session', 'authorization'], ['session', 'authorization']); }
  catch { throw stop('COMMAND_RUNNER_INVALID'); }
  const { executeReadonlySession } = await import('./face-readonly-session.mjs');
  const runner = (input, executionOptions) => executeReadonlySession(data.session, data.authorization, input, executionOptions);
  runners.add(runner);
  controlledRunners.add(runner);
  return Object.freeze(runner);
}

/** Code-only fixture capability. No transport, host, provider or request injection. */
export function createOfflineReadonlyRunner(options = {}) {
  let isTransportInstalled;
  try { ({ isTransportInstalled } = fields(options, ['isTransportInstalled'], ['isTransportInstalled'])); }
  catch { throw stop('COMMAND_RUNNER_INVALID'); }
  if (typeof isTransportInstalled !== 'function') throw stop('COMMAND_RUNNER_INVALID');
  const runner = async (input, { signal } = {}) => {
    let host, firstError, cancelled;
    const trip = error => { if (!firstError) firstError = stop(errorCode(error)); };
    const ensure = () => {
      if (signal?.aborted) trip(stop('COMMAND_CANCELLED'));
      if (firstError) throw firstError;
      if (isTransportInstalled() !== true) throw stop('LIVE_EXECUTION_LOCKED');
    };
    const abort = () => { trip(stop('COMMAND_CANCELLED')); try { host?.close(); } catch { /* The first fault dominates cleanup. */ } cancelled?.(firstError); };
    const cancellation = new Promise((_, reject) => { cancelled = reject; });
    // The promise always has an observer, even for an abort between operations.
    cancellation.catch(() => {});
    signal?.addEventListener('abort', abort, { once: true });
    let result;
    try {
      ensure();
      host = new FaceReadonlyHost(input.options);
      ensure();
      await Promise.race([host.connect(input.config), cancellation]);
      ensure();
      const list = await Promise.race([host.list(), cancellation]);
      ensure();
      const state = host.state();
      result = safeResult(list, state, input);
      ensure();
    } catch (error) { trip(error); }
    finally {
      try { host?.close(); } catch (error) { trip(error); }
      signal?.removeEventListener('abort', abort);
    }
    if (firstError) throw firstError;
    return result;
  };
  runners.add(runner);
  return Object.freeze(runner);
}

export async function runFaceReadonly(input, { runner, signal } = {}) {
  if (runner === undefined) return readonlyFailure('LIVE_EXECUTION_LOCKED');
  if (!runners.has(runner)) return readonlyFailure('COMMAND_RUNNER_INVALID');
  try {
    // Controlled attempts consume their grant before validation/cancellation.
    // Keep the legacy offline preflight ordering unchanged.
    if (controlledRunners.has(runner)) return await runner(input, { signal });
    const normalized = normalizeReadonlyInput(input);
    if (signal?.aborted) throw stop('COMMAND_CANCELLED');
    return await runner(normalized, { signal });
  } catch (error) {
    if (error instanceof ReadonlyInputError) return readonlyFailure(error.code, 2);
    const code = errorCode(error);
    return readonlyFailure(code, rejectionCodes.has(code) ? 4 : 5);
  }
}
