import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';

// Fixed local native helper, never a caller-supplied executable/module/hook.
const helper = fileURLToPath(new URL('../../tools/hikvision-readonly-evidence/Invoke-WindowsEvidence.ps1', import.meta.url));
const stores = new WeakMap();
const roles = ['stdout', 'stderr', 'main-exit'];
const MAX_FRAME = 25165824, MAX_TEXT = 8388608, TIMEOUT_MS = 4500;
function fault(code) { return Object.assign(new Error('Windows evidence operation stopped.'), { code }); }
function record(value, allowed) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fault('NATIVE_EVIDENCE_INPUT');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value'))) throw fault('NATIVE_EVIDENCE_INPUT');
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function stateFor(handle) { const state = stores.get(handle); if (!state) throw fault('NATIVE_EVIDENCE_INPUT'); return state; }
function basePath(value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 190 || value !== value.trim()
    || !/^[A-Za-z]:[\\/]/.test(value) || /[\x00-\x1f<>"|?*]/.test(value) || value.slice(2).includes(':')) throw fault('NATIVE_EVIDENCE_INPUT');
  const parts = value.slice(3).split(/[\\/]/);
  if (parts.some(part => part === '.' || part === '..' || /[. ]$/.test(part)
    || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw fault('NATIVE_EVIDENCE_INPUT');
  return path.win32.resolve(value);
}
export function createWindowsEvidenceStore(options) {
  if (process.platform !== 'win32') throw fault('NATIVE_EVIDENCE_PLATFORM');
  const data = record(options, ['baseDirectory', 'reference']);
  const baseDirectory = basePath(data.baseDirectory), reference = data.reference;
  if (typeof reference !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(reference)
    || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(reference)) throw fault('NATIVE_EVIDENCE_INPUT');
  const handle = Object.freeze(Object.create(null));
  stores.set(handle, { baseDirectory, reference, child: null, nextId: 0, pending: null, carry: '',
    opened: false, sealed: false, closed: false, used: false, closeRequested: false, written: [], failureCode: null,
    failureController: new AbortController(), processExit: null, exitPromise: null });
  return handle;
}
function nativeCode(value) { return typeof value === 'string' && /^NATIVE_EVIDENCE_[A-Z0-9_]{1,48}$/.test(value) ? value : 'NATIVE_EVIDENCE_PROTOCOL'; }
function fail(state, code) {
  if (!state.failureCode) state.failureCode = nativeCode(code);
  if (state.pending) { const pending = state.pending; state.pending = null; clearTimeout(pending.timer); pending.reject(fault(state.failureCode)); }
  if (!state.failureController.signal.aborted) state.failureController.abort();
}
function terminate(state, code) { fail(state, code); if (state.child && !state.closed) state.child.kill(); }
function start(state) {
  const systemRoot = process.env.SystemRoot;
  if (typeof systemRoot !== 'string' || !/^[A-Za-z]:[\\/]/.test(systemRoot)) throw fault('NATIVE_EVIDENCE_START');
  const executable = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { SystemRoot: systemRoot, windir: systemRoot, ...(process.env.TEMP ? { TEMP: process.env.TEMP, TMP: process.env.TEMP } : {}) },
  });
  state.child = child;
  state.exitPromise = new Promise(resolve => {
    child.once('error', () => fail(state, 'NATIVE_EVIDENCE_START'));
    child.once('close', (exitCode, signal) => {
      state.closed = true; state.processExit = exitCode;
      if (signal || exitCode !== 0 || !state.closeRequested || state.pending || state.carry !== '') fail(state, 'NATIVE_EVIDENCE_PROCESS');
      resolve({ exitCode, signal });
    });
  });
  child.stdin.on('error', () => terminate(state, 'NATIVE_EVIDENCE_PROCESS'));
  child.stderr.on('data', () => terminate(state, 'NATIVE_EVIDENCE_PROCESS'));
  child.stdout.on('data', bytes => {
    // Helper responses are fixed ASCII envelopes; never print native stderr or
    // response text, which can include runtime/organization error details.
    if ([...bytes].some(byte => byte > 0x7f) || state.carry.length + bytes.length > 4096) { terminate(state, 'NATIVE_EVIDENCE_PROTOCOL'); return; }
    state.carry += bytes.toString('ascii');
    let newline;
    while ((newline = state.carry.indexOf('\n')) !== -1) {
      const line = state.carry.slice(0, newline).replace(/\r$/, ''); state.carry = state.carry.slice(newline + 1);
      let response;
      try { response = record(JSON.parse(line), ['id', 'ok', 'code']); }
      catch { terminate(state, 'NATIVE_EVIDENCE_PROTOCOL'); return; }
      const pending = state.pending;
      if (!pending || response.id !== pending.id || typeof response.ok !== 'boolean'
        || (response.ok && response.code !== undefined) || (!response.ok && typeof response.code !== 'string')) {
        terminate(state, 'NATIVE_EVIDENCE_PROTOCOL'); return;
      }
      state.pending = null; clearTimeout(pending.timer);
      if (!response.ok) { if (!state.failureCode) state.failureCode = nativeCode(response.code); pending.reject(fault(state.failureCode)); }
      else pending.resolve();
    }
  });
}
function request(state, op, fields = {}, closing = false) {
  if (!state.child || state.closed || state.pending || (!closing && state.failureCode)) {
    fail(state, 'NATIVE_EVIDENCE_STATE'); return Promise.reject(fault(state.failureCode));
  }
  const id = ++state.nextId, wire = Buffer.from(JSON.stringify({ id, op, ...fields }) + '\n');
  if (id > 8 || wire.length > MAX_FRAME) { fail(state, 'NATIVE_EVIDENCE_INPUT'); return Promise.reject(fault(state.failureCode)); }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => terminate(state, 'NATIVE_EVIDENCE_TIMEOUT'), closing ? 2000 : TIMEOUT_MS);
    state.pending = { id, resolve, reject, timer };
    state.child.stdin.write(wire, error => { wire.fill(0); if (error) terminate(state, 'NATIVE_EVIDENCE_PROCESS'); });
  });
}
export async function openWindowsEvidenceStore(handle) {
  const state = stateFor(handle);
  if (state.used || state.closed) { fail(state, 'NATIVE_EVIDENCE_STATE'); throw fault(state.failureCode); } state.used = true;
  try { start(state); await request(state, 'open', { baseDirectory: state.baseDirectory, reference: state.reference }); state.opened = true; }
  catch (error) { fail(state, error?.code ?? 'NATIVE_EVIDENCE_FAILURE'); throw fault(state.failureCode); }
}
export async function writeWindowsEvidenceStore(handle, role, text) {
  const state = stateFor(handle);
  if (!state.opened || state.sealed || state.closed || state.failureCode || role !== roles[state.written.length]) { fail(state, 'NATIVE_EVIDENCE_STATE'); throw fault(state.failureCode); }
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_TEXT || Buffer.from(text).toString('utf8') !== text
    || (role === 'main-exit' && !/^(?:0|2|4|5)\n$/.test(text))) { fail(state, 'NATIVE_EVIDENCE_INPUT'); throw fault(state.failureCode); }
  await request(state, 'write', { role, text }); state.written.push(role);
}
export async function sealWindowsEvidenceStore(handle) {
  const state = stateFor(handle);
  if (!state.opened || state.sealed || state.closed || state.written.length !== 3 || state.failureCode) { fail(state, 'NATIVE_EVIDENCE_STATE'); throw fault(state.failureCode); }
  await request(state, 'seal'); state.sealed = true;
}
export function closeWindowsEvidenceStore(handle) {
  const state = stateFor(handle);
  if (!state.closePromise) state.closePromise = closeNative(state);
  return state.closePromise;
}
async function closeNative(state) {
  state.used = true; state.closeRequested = true;
  if (!state.child) { state.closed = true; if (state.failureCode) throw fault(state.failureCode); return; }
  if (state.pending) terminate(state, 'NATIVE_EVIDENCE_INTERRUPTED');
  else if (!state.closed) {
    try { await request(state, 'close', {}, true); } catch (error) { fail(state, error?.code ?? 'NATIVE_EVIDENCE_FAILURE'); if (!state.closed) state.child.kill(); }
    state.child.stdin.end();
  }
  let timer;
  const result = await Promise.race([state.exitPromise, new Promise(resolve => { timer = setTimeout(() => {
    terminate(state, 'NATIVE_EVIDENCE_TIMEOUT'); resolve(null);
  }, 1500); })]); clearTimeout(timer);
  if (!result || result.exitCode !== 0 || result.signal || state.failureCode) throw fault(state.failureCode ?? 'NATIVE_EVIDENCE_PROCESS');
}
export async function checkWindowsEvidenceStore(handle) {
  const state = stateFor(handle);
  if (!state.opened || state.sealed || state.closed || state.failureCode) { fail(state, 'NATIVE_EVIDENCE_STATE'); throw fault(state.failureCode); }
  await request(state, 'check');
}
export function windowsEvidenceFailureSignal(handle) { return stateFor(handle).failureController.signal; }
export function inspectWindowsEvidenceStore(handle) {
  const state = stateFor(handle);
  return Object.freeze({ opened: state.opened, sealed: state.sealed, closed: state.closed,
    processExit: state.processExit, writtenRoles: Object.freeze([...state.written]),
    ...(state.failureCode ? { failureCode: state.failureCode } : {}) });
}
