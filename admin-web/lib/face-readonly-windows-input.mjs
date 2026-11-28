import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';

// Code-only offline adapter. Fake confirmation events are deliberately branded;
// neither a serialized decision nor this IPC is proof of a real human identity.
export const WINDOWS_INPUT_CODES = Object.freeze(['WINDOWS_INPUT_INVALID', 'WINDOWS_INPUT_PLATFORM',
  'WINDOWS_INPUT_USED', 'WINDOWS_INPUT_PROTOCOL', 'WINDOWS_INPUT_START', 'WINDOWS_INPUT_PROCESS',
  'WINDOWS_INPUT_TIMEOUT', 'WINDOWS_INPUT_INTERRUPTED', 'WINDOWS_INPUT_NO_DECISION', 'WINDOWS_INPUT_BINDING',
  'WINDOWS_INPUT_UTF8', 'WINDOWS_INPUT_SIZE', 'WINDOWS_INPUT_EXPECTATIONS', 'WINDOWS_INPUT_JSON',
  'WINDOWS_INPUT_LIFECYCLE', 'WINDOWS_INPUT_IO', 'WINDOWS_INPUT_RUNTIME', 'WINDOWS_INPUT_BOOTSTRAP',
  'WINDOWS_INPUT_TOO_LARGE', 'WINDOWS_INPUT_REVIEW', 'WINDOWS_INPUT_STATE', 'WINDOWS_INPUT_FAILURE', 'WINDOWS_INPUT_INCOMPLETE']);
const known = new Set(WINDOWS_INPUT_CODES), adapters = new WeakMap(), events = new WeakMap();
const helper = fileURLToPath(new URL('../../tools/hikvision-readonly-input/Invoke-WindowsReadonlyInput.ps1', import.meta.url));
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
const setBytes = Uint8Array.prototype.set;
const expectationKeys = ['expectedSpkiPin', 'expectedSerialNumber', 'expectedPlanFingerprint', 'expectedCount', 'targetEmployeeNo', 'targetFDID'];
function fault(code) { return Object.assign(new Error('Windows private input stopped.'), { code: known.has(code) ? code : 'WINDOWS_INPUT_PROTOCOL' }); }
function fields(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fault('WINDOWS_INPUT_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value'))
    || required.some(key => !Object.hasOwn(descriptors, key))) throw fault('WINDOWS_INPUT_INVALID');
  return Object.fromEntries(Object.entries(descriptors).map(([key, d]) => [key, d.value]));
}
function copy(source, maximum) {
  if (!source || types.isProxy(source) || !types.isUint8Array(source)) throw fault('WINDOWS_INPUT_INVALID');
  const length = Reflect.apply(byteLength, source, []);
  if (length > maximum) throw fault('WINDOWS_INPUT_SIZE');
  const bytes = Buffer.alloc(length); Reflect.apply(setBytes, bytes, [source]); return bytes;
}
function stateFor(handle) { const state = adapters.get(handle); if (!state) throw fault('WINDOWS_INPUT_INVALID'); return state; }
export function createSyntheticWindowsConfirmation(options = {}) {
  const data = fields(options, ['decision']); const decision = data.decision ?? 'reject';
  if (!['approve', 'reject', 'cancel', 'none'].includes(decision)) throw fault('WINDOWS_INPUT_INVALID');
  const handle = Object.freeze(Object.create(null)); events.set(handle, decision); return handle;
}
export function createWindowsPrivateInputAdapter(options) {
  if (process.platform !== 'win32') throw fault('WINDOWS_INPUT_PLATFORM');
  const data = fields(options, ['inputBytes', 'expectationsBytes', 'confirmationEvent'], ['inputBytes', 'expectationsBytes']);
  if (data.confirmationEvent !== undefined && !events.has(data.confirmationEvent)) throw fault('WINDOWS_INPUT_INVALID');
  const input = copy(data.inputBytes, 32768), expected = copy(data.expectationsBytes, 8192);
  const handle = Object.freeze(Object.create(null));
  adapters.set(handle, { input, expected, event: data.confirmationEvent === undefined ? 'reject' : events.get(data.confirmationEvent),
    captureId: randomBytes(16).toString('hex'), challenge: null, claimed: false, readUsed: false, reviewUsed: false,
    captureCalls: 0, reviewCalls: 0, captured: false, reviewed: false, child: null, closed: false, closing: false,
    pending: null, nextId: 0, carry: '', failureCode: null, controller: new AbortController(), processExit: null }); return handle;
}
export function claimWindowsPrivateInputAdapter(handle) {
  const state = stateFor(handle);
  if (state.claimed || state.closed || state.readUsed) throw fault('WINDOWS_INPUT_USED'); state.claimed = true;
}
function fail(state, code) {
  if (!state.failureCode) state.failureCode = known.has(code) ? code : 'WINDOWS_INPUT_PROTOCOL';
  if (state.pending) { const p = state.pending; state.pending = null; clearTimeout(p.timer); p.reject(fault(state.failureCode)); }
  if (!state.controller.signal.aborted) state.controller.abort();
}
function kill(state, code) { fail(state, code); if (state.child && !state.closed) state.child.kill(); }
function start(state) {
  const systemRoot = process.env.SystemRoot;
  if (typeof systemRoot !== 'string' || !/^[A-Za-z]:[\\/]/.test(systemRoot)) throw fault('WINDOWS_INPUT_START');
  const child = spawn(path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { SystemRoot: systemRoot, windir: systemRoot, ...(process.env.TEMP ? { TEMP: process.env.TEMP, TMP: process.env.TEMP } : {}) } });
  state.child = child;
  state.exitPromise = new Promise(resolve => {
    child.once('error', () => fail(state, 'WINDOWS_INPUT_START'));
    child.once('close', (exitCode, signal) => { state.closed = true; state.processExit = exitCode;
      if (signal || exitCode !== 0 || !state.closing || state.pending || state.carry !== '') fail(state, 'WINDOWS_INPUT_PROCESS');
      resolve({ exitCode, signal }); });
  });
  child.stdin.on('error', () => kill(state, 'WINDOWS_INPUT_PROCESS'));
  child.stderr.on('data', () => kill(state, 'WINDOWS_INPUT_PROCESS'));
  child.stdout.on('data', bytes => {
    if ([...bytes].some(byte => byte > 127) || state.carry.length + bytes.length > 131072) { kill(state, 'WINDOWS_INPUT_PROTOCOL'); return; }
    state.carry += bytes.toString('ascii'); let newline;
    while ((newline = state.carry.indexOf('\n')) !== -1) {
      const line = state.carry.slice(0, newline).replace(/\r$/, ''); state.carry = state.carry.slice(newline + 1);
      const p = state.pending; let response;
      try { response = fields(JSON.parse(line), ['id', 'ok', 'code', 'captureId', 'inputBase64', 'expectationsBase64', 'challenge', 'reference', 'viewBase64', 'decision']); }
      catch { kill(state, 'WINDOWS_INPUT_PROTOCOL'); return; }
      if (!p || response.id !== p.id || typeof response.ok !== 'boolean') { kill(state, 'WINDOWS_INPUT_PROTOCOL'); return; }
      state.pending = null; clearTimeout(p.timer);
      if (!response.ok) {
        if (Reflect.ownKeys(response).some(key => !['id', 'ok', 'code'].includes(key)) || typeof response.code !== 'string') { fail(state, 'WINDOWS_INPUT_PROTOCOL'); p.reject(fault(state.failureCode)); }
        else { fail(state, response.code); p.reject(fault(state.failureCode)); }
      } else p.resolve(response);
    }
  });
}
function request(state, op, body = {}, closing = false) {
  if (!state.child || state.closed || state.pending || (!closing && state.failureCode)) { fail(state, 'WINDOWS_INPUT_LIFECYCLE'); return Promise.reject(fault(state.failureCode)); }
  const id = ++state.nextId, wire = Buffer.from(JSON.stringify({ id, op, ...body }) + '\n');
  if (id > 4 || wire.length > 131072) { fail(state, 'WINDOWS_INPUT_SIZE'); return Promise.reject(fault(state.failureCode)); }
  return new Promise((resolve, reject) => { const timer = setTimeout(() => kill(state, 'WINDOWS_INPUT_TIMEOUT'), closing ? 2000 : 4500);
    state.pending = { id, resolve, reject, timer }; state.child.stdin.write(wire, error => { wire.fill(0); if (error) kill(state, 'WINDOWS_INPUT_PROCESS'); }); });
}
function exact(response, keys) { if (Object.keys(response).length !== keys.length || keys.some(key => !Object.hasOwn(response, key))) throw fault('WINDOWS_INPUT_PROTOCOL'); }
export async function readWindowsPrivateInput(handle) {
  const state = stateFor(handle); if (!state.claimed || state.readUsed || state.closed || state.failureCode) { fail(state, 'WINDOWS_INPUT_USED'); throw fault(state.failureCode); }
  state.readUsed = true; state.captureCalls++;
  try {
    start(state);
    const inputBase64 = state.input.toString('base64'), expectationsBase64 = state.expected.toString('base64');
    const response = await request(state, 'capture', { captureId: state.captureId, inputBase64, expectationsBase64, event: state.event });
    exact(response, ['id', 'ok', 'captureId', 'inputBase64', 'expectationsBase64']);
    if (response.captureId !== state.captureId || response.inputBase64 !== inputBase64 || response.expectationsBase64 !== expectationsBase64) throw fault('WINDOWS_INPUT_BINDING');
    let expectations;
    try { expectations = fields(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(state.expected)), expectationKeys, expectationKeys); }
    catch { throw fault('WINDOWS_INPUT_EXPECTATIONS'); }
    state.captured = true; state.returnedBytes = Buffer.from(state.input);
    return { inputBytes: state.returnedBytes, expectations };
  } catch (error) { fail(state, error?.code); throw fault(state.failureCode); }
}
export async function reviewWindowsPrivateInput(handle, binding) {
  const state = stateFor(handle);
  if (!state.claimed || !state.captured || state.reviewUsed || state.closed || state.failureCode) { fail(state, 'WINDOWS_INPUT_USED'); throw fault(state.failureCode); }
  state.reviewUsed = true; state.reviewCalls++;
  try {
    const data = fields(binding, ['viewBytes', 'reference'], ['viewBytes', 'reference']), view = copy(data.viewBytes, 8192);
    if (typeof data.reference !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(data.reference)) throw fault('WINDOWS_INPUT_BINDING');
    state.challenge = randomBytes(16).toString('hex'); const viewBase64 = view.toString('base64'); view.fill(0);
    const response = await request(state, 'review', { captureId: state.captureId, challenge: state.challenge, reference: data.reference, viewBase64 });
    exact(response, ['id', 'ok', 'captureId', 'challenge', 'reference', 'viewBase64', 'decision']);
    if (response.captureId !== state.captureId || response.challenge !== state.challenge || response.reference !== data.reference
      || response.viewBase64 !== viewBase64 || !['approve', 'reject', 'cancel', 'none'].includes(response.decision)) throw fault('WINDOWS_INPUT_BINDING');
    state.reviewed = true;
    // A successful response is only a candidate until the private helper has
    // acknowledged close and exited cleanly, including all late pipe output.
    await closeWindowsPrivateInput(handle); return response.decision;
  } catch (error) { fail(state, error?.code); throw fault(state.failureCode); }
}
export function closeWindowsPrivateInput(handle) {
  const state = stateFor(handle); if (!state.closePromise) state.closePromise = close(state); return state.closePromise;
}
async function close(state) {
  state.closing = true; state.readUsed = true;
  try {
    if (!state.child) { state.closed = true; return; }
    if (state.pending) kill(state, 'WINDOWS_INPUT_INTERRUPTED');
    else if (!state.closed) {
      try { const r = await request(state, 'close', {}, true); exact(r, ['id', 'ok']); }
      catch (error) { fail(state, error?.code); if (!state.closed) state.child.kill(); }
      state.child.stdin.end();
    }
    let timer; const ended = await Promise.race([state.exitPromise, new Promise(resolve => { timer = setTimeout(() => { kill(state, 'WINDOWS_INPUT_TIMEOUT'); resolve(null); }, 1500); })]);clearTimeout(timer);
    if (!ended || ended.exitCode !== 0 || ended.signal || state.failureCode) throw fault(state.failureCode ?? 'WINDOWS_INPUT_PROCESS');
  } finally { state.input.fill(0); state.expected.fill(0); state.returnedBytes?.fill(0); state.captureId = null; state.challenge = null; state.carry = ''; }
}
export function windowsPrivateInputFailureSignal(handle) { return stateFor(handle).controller.signal; }
export function inspectWindowsPrivateInputAdapter(handle) {
  const s = stateFor(handle);return Object.freeze({ claimed: s.claimed, captured: s.captured, reviewed: s.reviewed,
    captureCalls: s.captureCalls, reviewCalls: s.reviewCalls, closed: s.closed, processExit: s.processExit,
    ...(s.failureCode ? { failureCode: s.failureCode } : {}) });
}
