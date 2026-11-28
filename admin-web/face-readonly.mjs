import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_INPUT_BYTES = 32768;
const HELP = Object.freeze({ protocolVersion: 1, outcome: 'help', usage: 'node admin-web/face-readonly.mjs',
  input: 'One strict UTF-8 JSON object on stdin, at most 32768 bytes. operation=list; mode=offline.',
  mode: 'readonly', siteVerification: 'NOT_EXECUTED', liveExecution: 'LOCKED', options: ['--help'] });
const inputCodes = new Set(['INPUT_TOO_LARGE', 'INPUT_UTF8_INVALID', 'INPUT_JSON_INVALID', 'INPUT_DUPLICATE_KEY', 'INPUT_INTERRUPTED', 'INPUT_TIMEOUT', 'COMMAND_INPUT_INVALID']);

function localFailure(code, exitCode = 5) {
  return { exitCode, code, output: { protocolVersion: 1, mode: 'readonly', execution: 'offline', operation: 'list',
    outcome: exitCode === 2 ? 'invalid-input' : 'stopped', siteVerification: 'NOT_EXECUTED', deleteAllowed: false, error: { code } } };
}
function fault(code) { return Object.assign(new Error('Readonly command stopped.'), { code }); }
function caughtCode(error) { try { return error?.code; } catch { return undefined; } }

async function readInput(stdin, signal, timeoutMs) {
  let iterator, timer, cancel, completed = false;
  const chunks = [];
  let length = 0;
  const cancellation = new Promise((_, reject) => { cancel = reject; });
  cancellation.catch(() => {});
  const abort = () => cancel(fault('COMMAND_CANCELLED'));
  try {
    if (signal?.aborted) throw fault('COMMAND_CANCELLED');
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => cancel(fault('INPUT_TIMEOUT')), timeoutMs);
    if (!stdin || typeof stdin[Symbol.asyncIterator] !== 'function') throw fault('INPUT_INTERRUPTED');
    iterator = stdin[Symbol.asyncIterator]();
    while (true) {
      const step = await Promise.race([Promise.resolve().then(() => iterator.next()), cancellation]);
      if (!step || typeof step.done !== 'boolean') throw fault('INPUT_INTERRUPTED');
      if (step.done) { completed = true; break; }
      if (!(step.value instanceof Uint8Array)) throw fault('INPUT_INTERRUPTED');
      if (step.value.byteLength > MAX_INPUT_BYTES - length) throw fault('INPUT_TOO_LARGE');
      const bytes = Buffer.from(step.value);
      chunks.push(bytes); length += bytes.length;
    }
    return Buffer.concat(chunks, length);
  } catch (error) {
    if (['INPUT_TOO_LARGE', 'INPUT_TIMEOUT', 'COMMAND_CANCELLED'].includes(caughtCode(error))) throw error;
    throw fault('INPUT_INTERRUPTED');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    for (const chunk of chunks) chunk.fill(0);
    if (!completed) {
      try { stdin?.pause?.(); stdin?.destroy?.(); } catch { /* No stream diagnostics. */ }
      try { Promise.resolve(iterator?.return?.()).catch(() => {}); } catch { /* Do not wait for an interrupted iterator. */ }
    }
  }
}

function observeSink(sink) {
  let failed = false;
  const onError = () => { failed = true; };
  try { sink?.on?.('error', onError); } catch { failed = true; }
  return { failed: () => failed, close: () => { try { sink?.removeListener?.('error', onError); } catch { /* No sink diagnostics. */ } } };
}
async function writeLine(sink, value, watcher) {
  let timer;
  try {
    if (!sink || typeof sink.write !== 'function' || watcher.failed()) return false;
    const pending = new Promise((resolve, reject) => {
      let settled = false, invoking = true, callbackSeen = false, callbackError;
      let hasPromise = false, promiseDone = false, promiseFailed = false;
      const finish = () => {
        if (settled || invoking) return;
        if (callbackError || promiseFailed) { settled = true; reject(fault('COMMAND_OUTPUT_FAILED')); }
        else if (hasPromise ? promiseDone : callbackSeen) { settled = true; resolve(); }
      };
      const done = error => {
        callbackSeen = true;
        if (error && !callbackError) callbackError = error;
        finish();
      };
      try {
        const returned = sink.write(value, done);
        const then = returned?.then;
        if (typeof then === 'function') {
          hasPromise = true;
          Reflect.apply(then, returned, [
            () => { promiseDone = true; finish(); },
            () => { promiseFailed = true; finish(); },
          ]);
        }
      } catch {
        settled = true;
        reject(fault('COMMAND_OUTPUT_FAILED'));
        return;
      }
      // A synchronous callback is provisional until write/then registration
      // returns normally. An observed throw must dominate that earlier signal.
      invoking = false;
      finish();
      // Arity cannot tell whether a writer supports callbacks. Await the
      // callback/promise, with a fixed deadline even for a broken sink.
    });
    await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(fault('COMMAND_OUTPUT_FAILED')), 1000); })]);
    await new Promise(resolve => setImmediate(resolve));
    return !watcher.failed();
  } catch { return false; }
  finally { clearTimeout(timer); }
}

export async function main({ argv = process.argv.slice(2), stdin = process.stdin, stdout = process.stdout, stderr = process.stderr,
  signal, inputTimeoutMs = 1000, runner } = {}) {
  const outputWatch = observeSink(stdout), errorWatch = observeSink(stderr);
  try {
    if (Array.isArray(argv) && argv.length === 1 && argv[0] === '--help') {
      if (await writeLine(stdout, `${JSON.stringify(HELP)}\n`, outputWatch)) return 0;
      await writeLine(stderr, 'COMMAND_OUTPUT_FAILED\n', errorWatch);
      return 5;
    }
    let result, bytes;
    if (!Array.isArray(argv) || argv.length) result = localFailure('UNSUPPORTED_ARGUMENTS', 2);
    else if (!Number.isSafeInteger(inputTimeoutMs) || inputTimeoutMs < 1 || inputTimeoutMs > 5000) result = localFailure('COMMAND_PROTOCOL_INVALID');
    else {
      try {
        bytes = await readInput(stdin, signal, inputTimeoutMs);
        const command = await import('./lib/face-readonly-command.mjs');
        const input = command.parseReadonlyInput(bytes);
        if (signal?.aborted) result = localFailure('COMMAND_CANCELLED');
        else result = await command.runFaceReadonly(input, { runner, signal });
      } catch (error) {
        const suppliedCode = caughtCode(error);
        const code = inputCodes.has(suppliedCode) ? suppliedCode : suppliedCode === 'COMMAND_CANCELLED' ? 'COMMAND_CANCELLED' : 'READONLY_FAILURE';
        result = localFailure(code, inputCodes.has(code) ? 2 : 5);
      } finally { bytes?.fill(0); }
    }
    if (!result.exitCode && signal?.aborted) result = localFailure('COMMAND_CANCELLED');
    let stderrOk = true;
    if (result.exitCode) stderrOk = await writeLine(stderr, `${result.code}\n`, errorWatch);
    if (!stderrOk) result = localFailure('COMMAND_OUTPUT_FAILED');
    if (!result.exitCode && signal?.aborted) {
      result = localFailure('COMMAND_CANCELLED');
      stderrOk = await writeLine(stderr, 'COMMAND_CANCELLED\n', errorWatch);
    }
    const stdoutOk = await writeLine(stdout, `${JSON.stringify(result.output)}\n`, outputWatch);
    if (!stdoutOk && stderrOk) await writeLine(stderr, 'COMMAND_OUTPUT_FAILED\n', errorWatch);
    if (stdoutOk && !result.exitCode && signal?.aborted) {
      result = localFailure('COMMAND_CANCELLED');
      stderrOk = await writeLine(stderr, 'COMMAND_CANCELLED\n', errorWatch);
    }
    return stdoutOk && stderrOk && !outputWatch.failed() && !errorWatch.failed() ? result.exitCode : 5;
  } catch {
    await writeLine(stderr, 'READONLY_FAILURE\n', errorWatch);
    await writeLine(stdout, `${JSON.stringify(localFailure('READONLY_FAILURE').output)}\n`, outputWatch);
    return 5;
  } finally { outputWatch.close(); errorWatch.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Installed before main and retained until process exit for delayed EPIPE.
  let pipeFailed = false;
  const pipeError = () => { pipeFailed = true; process.exitCode = 5; };
  process.stdout.on('error', pipeError); process.stderr.on('error', pipeError);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  const exitCode = await main({ signal: controller.signal });
  process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  process.stdin.pause();
  process.exitCode = pipeFailed ? 5 : exitCode;
}
