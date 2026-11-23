import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { TextDecoder, types } from "node:util";
import { fileURLToPath } from "node:url";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Internal closed local broker. No path, command, callback, configuration or
// credential is accepted from the caller, and no network transport is loaded.
const CHECKS = Object.freeze([
  "platformSupported", "identitySupported", "locationSupported", "ancestorHandlesHeld",
  "rootCreatedExclusive", "rootAclValid", "nativeIdentityValid", "rootEntriesValid",
  "filesCreatedExclusive", "fileAclsValid", "contentVerified", "flushVerified", "deleteSharingDenied",
]);
const COUNTS = Object.freeze(["directoriesCreated", "filesCreated", "bytesWritten", "bytesVerified", "flushes", "validationCalls"]);
const ROOT_GATES = CHECKS.filter((key) => !["filesCreatedExclusive", "fileAclsValid", "contentVerified", "flushVerified"].includes(key));
const IDS = Object.freeze(["deviceInfo", "acsCapabilities", "userInfoCapabilities", "fdlibCapabilities", "fdlibList", "fdlibCount"]);
const states = new WeakMap();
const HOST = fileURLToPath(new URL("../native-host.ps1", import.meta.url));
const WORKING_DIRECTORY = fileURLToPath(new URL("../../../", import.meta.url));
const WORKSPACE_PARENT = fileURLToPath(new URL("../../../../", import.meta.url));
const RESULT_KEYS = ["status", "code", "evidenceRef", "compilerRef", "checks", "counts", "newObjectStateUnverified", "retained", "closed"];

function freeze(value) {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function record(value, keys) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) throw 0;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw 0;
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some((key) => typeof key !== "string" || !keys.includes(key))) throw 0;
  const descriptors = Object.getOwnPropertyDescriptors(value), copy = Object.create(null);
  for (const key of keys) {
    const property = descriptors[key];
    if (!property || !property.enumerable || !Object.hasOwn(property, "value")) throw 0;
    copy[key] = property.value;
  }
  return copy;
}
function denseSix(value) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw 0;
  if (Object.getOwnPropertyDescriptor(value, "length")?.value !== 6 || Reflect.ownKeys(value).length !== 7) throw 0;
  return IDS.map((_id, index) => {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !property.enumerable || !Object.hasOwn(property, "value")) throw 0;
    return property.value;
  });
}
function syntheticSummary(value) {
  const data = record(value, ["schemaVersion", "phase", "status", "code", "counts", "stages", "allowReadStayedFalse"]);
  if (data.schemaVersion !== "hk-ai-08-offline-summary-v1" || data.phase !== "synthetic-offline-only" ||
      !["PASS", "FAIL"].includes(data.status) || typeof data.code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(data.code) ||
      (data.status === "PASS") !== (data.code === "OK") || data.allowReadStayedFalse !== true) throw 0;
  data.counts = record(data.counts, ["logicalEndpoints", "transmissions", "authRetries", "unknownEndpoints"]);
  for (const key of Object.keys(data.counts)) if (!Number.isSafeInteger(data.counts[key]) || data.counts[key] < 0 || data.counts[key] > (key === "transmissions" ? 12 : 6)) throw 0;
  data.stages = denseSix(data.stages).map((value, index) => {
    const stage = record(value, ["id", "state", "code", "httpStatus", "transmissions"]);
    if (stage.id !== IDS[index] || !["NOT_EXECUTED", "confirmed", "unsupported", "unknown", "blocked"].includes(stage.state) ||
        typeof stage.code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(stage.code) ||
        !Number.isInteger(stage.transmissions) || stage.transmissions < 0 || stage.transmissions > 2 ||
        (stage.httpStatus !== null && (!Number.isInteger(stage.httpStatus) || stage.httpStatus < 100 || stage.httpStatus > 599)) ||
        (stage.state === "NOT_EXECUTED" && (stage.code !== "NOT_EXECUTED" || stage.httpStatus !== null || stage.transmissions !== 0))) throw 0;
    return stage;
  });
  if (data.counts.logicalEndpoints !== data.stages.filter((stage) => stage.transmissions > 0).length ||
      data.counts.transmissions !== data.stages.reduce((count, stage) => count + stage.transmissions, 0) ||
      data.counts.authRetries !== data.stages.reduce((count, stage) => count + Math.max(0, stage.transmissions - 1), 0) ||
      data.counts.unknownEndpoints !== data.stages.filter((stage) => stage.state === "unknown").length) throw 0;
  return data;
}
function blank(evidenceRef = null, compilerRef = null) {
  return freeze({ status: "BLOCKED", code: "NATIVE_CAPABILITY_UNAVAILABLE", evidenceRef, compilerRef,
    checks: Object.fromEntries(CHECKS.map((key) => [key, false])), counts: Object.fromEntries(COUNTS.map((key) => [key, 0])),
    newObjectStateUnverified: false, retained: true, closed: false });
}
function outcome(state, status, code, uncertain = false) {
  const previous = state?.last || blank();
  return freeze({ ...previous, status, code, newObjectStateUnverified: previous.newObjectStateUnverified || uncertain });
}
function normalize(value, state) {
  const data = record(value, RESULT_KEYS);
  if (!["PASS", "FAIL", "BLOCKED"].includes(data.status) || typeof data.code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(data.code) ||
      (data.status === "PASS") !== (data.code === "OK") || data.evidenceRef !== state.evidenceRef || data.compilerRef !== state.compilerRef ||
      typeof data.newObjectStateUnverified !== "boolean" || data.retained !== true || typeof data.closed !== "boolean") throw 0;
  data.checks = record(data.checks, CHECKS); data.counts = record(data.counts, COUNTS);
  if (CHECKS.some((key) => typeof data.checks[key] !== "boolean") || COUNTS.some((key) => !Number.isSafeInteger(data.counts[key]) || data.counts[key] < 0)) throw 0;
  if (data.counts.directoriesCreated > 1 || data.counts.filesCreated > 2 || data.counts.flushes > 2 ||
      data.counts.bytesWritten > 200000 || data.counts.bytesVerified > 200000 || data.counts.validationCalls > 1000) throw 0;
  return freeze(data);
}
function stateFor(capability) {
  return capability !== null && typeof capability === "object" && !types.isProxy(capability) ? states.get(capability) : undefined;
}
function abortPending(state, code) {
  if (!state.terminalError) state.terminalError = code;
  state.last = outcome(state, "FAIL", state.terminalError, state.initSent);
  if (state.pending) { const pending = state.pending; state.pending = null; clearTimeout(pending.timer); pending.resolve(state.last); }
  if (!state.exited) { try { state.child.kill(); } catch { /* uncertain result remains explicit */ } }
}
function rpc(state, op, summary) {
  if (state.exited) return Promise.resolve(outcome(state, "FAIL", "NATIVE_WORKER_EXITED", state.initSent));
  if (state.pending) return Promise.resolve(outcome(state, "FAIL", "NATIVE_PROTOCOL_BUSY", true));
  return new Promise((resolve) => {
    const id = ++state.sequence;
    const timer = setTimeout(() => abortPending(state, "NATIVE_WORKER_TIMEOUT"), op === "init" ? 60000 : 15000);
    state.pending = { id, resolve, timer };
    if (op === "init") state.initSent = true;
    const request = summary === undefined ? { id, op } : { id, op, summary };
    state.child.stdin.write(`${JSON.stringify(request)}\n`, (error) => { if (error) abortPending(state, "NATIVE_STDIN_FAILED"); });
  });
}
function schedule(state, operation, work) {
  if (operation !== "close" && state.queued >= 16) return Promise.resolve(outcome(state, "FAIL", "NATIVE_PROTOCOL_BUSY", state.initSent));
  state.queued += 1;
  const promise = state.chain.then(async () => {
    state.busy = true; state.operation = operation;
    try { return await work(); }
    catch { state.last = outcome(state, "FAIL", "NATIVE_BROKER_FAILED", state.initSent); return state.last; }
    finally { state.busy = false; state.operation = "idle"; state.queued -= 1; }
  });
  state.chain = promise.then(() => undefined, () => undefined);
  return promise;
}
async function confirmExit(state) {
  if (!state.finished) {
    let timer; await Promise.race([state.exitPromise, new Promise((resolve) => { timer = setTimeout(resolve, 5000); })]); clearTimeout(timer);
  }
  if (!state.finished) {
    try { state.child.kill(); } catch { /* retain unknown state */ }
    let timer; await Promise.race([state.exitPromise, new Promise((resolve) => { timer = setTimeout(resolve, 5000); })]); clearTimeout(timer);
  }
  if (state.finished) state.last = freeze({ ...state.last, closed: true });
  else state.last = outcome(state, "FAIL", "NATIVE_WORKER_NOT_QUIESCENT", true);
  return state.last;
}
function captureChunk(state, kind, chunk) {
  const maximum = kind === "stdout" ? 262144 : 65536;
  state.observed[kind] += chunk.length;
  const remaining = maximum - state.captured[kind];
  if (remaining > 0) { const copy = Buffer.from(chunk.subarray(0, remaining)); state.chunks[kind].push(copy); state.captured[kind] += copy.length; }
  if (state.observed[kind] > maximum) { state.truncated[kind] = true; abortPending(state, "NATIVE_PIPE_LIMIT_EXCEEDED"); }
}
async function saveHostPipes(state, exitCode, signal) {
  const directory = join(WORKSPACE_PARENT, state.compilerRef);
  try {
    let info;
    try { info = await lstat(directory); }
    catch (error) { if (error?.code !== "ENOENT") throw 0; await mkdir(directory, { recursive: false, mode: 0o700 }); info = await lstat(directory); }
    if (!info.isDirectory() || info.isSymbolicLink()) throw 0;
    await writeFile(join(directory, "host.stdout.raw"), Buffer.concat(state.chunks.stdout), { flag: "wx" });
    await writeFile(join(directory, "host.stderr.raw"), Buffer.concat(state.chunks.stderr), { flag: "wx" });
    await writeFile(join(directory, "host.exitcode.txt"), `${exitCode === null ? "NOT_AVAILABLE" : exitCode}\n`, { flag: "wx" });
    const metadata = { evidenceRef: state.evidenceRef, compilerRef: state.compilerRef,
      stdoutBytesObserved: state.observed.stdout, stdoutBytesCaptured: state.captured.stdout,
      stderrBytesObserved: state.observed.stderr, stderrBytesCaptured: state.captured.stderr,
      stdoutTruncated: state.truncated.stdout, stderrTruncated: state.truncated.stderr,
      exitCode, signal, streamsComplete: !state.truncated.stdout && !state.truncated.stderr,
      source: "powershell-host-raw-pipes", deviceData: false };
    await writeFile(join(directory, "host-pipes.metadata.json"), `${JSON.stringify(metadata)}\n`, { flag: "wx" });
  } catch { state.last = outcome(state, "FAIL", "NATIVE_HOST_LOG_WRITE_FAILED", true); }
}

export async function createNativeEvidenceBroker() {
  const evidenceRef = `hk-win-sink-${randomUUID().replaceAll("-", "")}`;
  const compilerRef = `hk-win-compile-${randomUUID().replaceAll("-", "")}`;
  if (process.platform !== "win32") return freeze({ ...blank(evidenceRef, compilerRef), code: "PLATFORM_UNSUPPORTED", capability: null });
  try { await lstat(join(WORKSPACE_PARENT, compilerRef)); return freeze({ ...blank(evidenceRef, compilerRef), code: "COMPILER_NAME_COLLISION", capability: null }); }
  catch (error) { if (error?.code !== "ENOENT") return freeze({ ...blank(evidenceRef, compilerRef), code: "COMPILER_LOCATION_UNAVAILABLE", capability: null }); }
  try {
    await writeFile(join(WORKSPACE_PARENT, `${compilerRef}.launch.json`), `${JSON.stringify({ compilerRef, evidenceRef, phase: "allocated-before-host-start" })}\n`, { flag: "wx" });
  } catch { return freeze({ ...blank(evidenceRef, compilerRef), status: "FAIL", code: "NATIVE_REFERENCE_JOURNAL_FAILED", capability: null }); }
  let child;
  try {
    child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", HOST, "-EvidenceRef", evidenceRef, "-CompilerRef", compilerRef], {
      cwd: WORKING_DIRECTORY, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch { return freeze({ ...blank(evidenceRef, compilerRef), code: "NATIVE_LAUNCH_BLOCKED", capability: null }); }
  let exitResolve;
  const state = { child, evidenceRef, compilerRef, last: blank(evidenceRef, compilerRef), pending: null, sequence: 0,
    initSent: false, exited: false, finished: false, exitCode: null, exitSignal: null, terminalError: null, intentionalClose: false, busy: false, operation: "idle", queued: 0, chain: Promise.resolve(),
    chunks: { stdout: [], stderr: [] }, captured: { stdout: 0, stderr: 0 }, observed: { stdout: 0, stderr: 0 }, truncated: { stdout: false, stderr: false },
    closing: null, text: "", decoder: new TextDecoder("utf-8", { fatal: true }),
    exitPromise: new Promise((resolve) => { exitResolve = resolve; }),
  };
  child.stdout.on("data", (chunk) => {
    captureChunk(state, "stdout", chunk);
    try {
      state.text += state.decoder.decode(chunk, { stream: true });
      if (state.text.length > 65536) throw 0;
      let end;
      while ((end = state.text.indexOf("\n")) >= 0) {
        const line = state.text.slice(0, end).replace(/\r$/, ""); state.text = state.text.slice(end + 1);
        const reply = record(JSON.parse(line), ["id", "native"]);
        if (!state.pending || reply.id !== state.pending.id) throw 0;
        const native = normalize(reply.native, state);
        const pending = state.pending; state.pending = null; clearTimeout(pending.timer); state.last = native; pending.resolve(native);
      }
    } catch { abortPending(state, "NATIVE_PROTOCOL_INVALID"); }
  });
  child.stderr.on("data", (chunk) => { captureChunk(state, "stderr", chunk); abortPending(state, "NATIVE_HOST_STDERR"); });
  child.stdin.on("error", () => abortPending(state, "NATIVE_STDIN_FAILED"));
  child.stdout.on("error", () => abortPending(state, "NATIVE_STDOUT_FAILED"));
  child.stderr.on("error", () => abortPending(state, "NATIVE_STDERR_FAILED"));
  child.on("error", () => abortPending(state, "NATIVE_LAUNCH_BLOCKED"));
  child.on("close", async (exitCode, signal) => {
    state.exited = true; state.exitCode = exitCode; state.exitSignal = signal;
    try { state.text += state.decoder.decode(); if (state.text !== "") throw 0; }
    catch { abortPending(state, "NATIVE_PROTOCOL_INVALID"); }
    if (state.pending) { const pending = state.pending; state.pending = null; clearTimeout(pending.timer); state.last = outcome(state, "FAIL", "NATIVE_WORKER_EXITED", state.initSent); pending.resolve(state.last); }
    else if (!state.intentionalClose && !state.terminalError) state.last = outcome(state, "FAIL", "NATIVE_WORKER_EXITED", state.initSent);
    if (state.last.status === "PASS" && (exitCode !== 0 || signal !== null)) state.last = outcome(state, "FAIL", "NATIVE_HOST_EXIT_FAILED", true);
    await saveHostPipes(state, exitCode, signal);
    state.finished = true; exitResolve();
  });
  let result = await rpc(state, "init");
  if (result.status === "PASS" && (ROOT_GATES.some((key) => result.checks[key] !== true) || result.counts.directoriesCreated !== 1 || result.counts.filesCreated !== 0 || result.newObjectStateUnverified || result.closed)) {
    state.last = outcome(state, "FAIL", "NATIVE_ROOT_GATE_INVALID", true); result = state.last;
  }
  if (result.status !== "PASS") {
    const primary = result;
    state.intentionalClose = true;
    if (!state.exited && !state.pending) { const closed = await rpc(state, "close"); if (closed.status !== "PASS" || !closed.closed) state.last = closed; }
    await confirmExit(state);
    if (!["NATIVE_WORKER_NOT_QUIESCENT", "NATIVE_HOST_LOG_WRITE_FAILED", "NATIVE_PROTOCOL_INVALID"].includes(state.last.code) && !(state.last.status === "FAIL" && primary.status === "BLOCKED")) {
      state.last = freeze({ ...state.last, status: primary.status, code: primary.code,
        newObjectStateUnverified: primary.newObjectStateUnverified || state.last.newObjectStateUnverified });
    }
    return freeze({ ...state.last, capability: null });
  }
  const capability = Object.freeze(Object.create(null)); states.set(capability, state);
  return freeze({ ...result, capability });
}
export async function validateNativeEvidence(capability) {
  const state = stateFor(capability);
  if (!state) return outcome(null, "FAIL", "INVALID_NATIVE_CAPABILITY");
  if (state.closing || state.last.closed) return outcome(state, "FAIL", "NATIVE_CAPABILITY_CLOSED");
  return schedule(state, "validate", () => rpc(state, "validate"));
}
export async function writeNativeEvidence(capability, summary) {
  const state = stateFor(capability);
  if (!state) return outcome(null, "FAIL", "INVALID_NATIVE_CAPABILITY");
  if (state.closing || state.last.closed) return outcome(state, "FAIL", "NATIVE_CAPABILITY_CLOSED");
  let copied;
  try { copied = syntheticSummary(summary); } catch { return outcome(state, "FAIL", "SUMMARY_INVALID"); }
  return schedule(state, "write", () => rpc(state, "write", copied));
}
export async function closeNativeEvidence(capability) {
  const state = stateFor(capability);
  if (!state) return outcome(null, "FAIL", "INVALID_NATIVE_CAPABILITY");
  if (state.closing) return state.closing;
  state.closing = schedule(state, "close", async () => {
    state.intentionalClose = true;
    if (!state.exited) await rpc(state, "close");
    return confirmExit(state);
  });
  return state.closing;
}
export function observeNativeEvidence(capability) {
  const state = stateFor(capability);
  const native = state ? state.last : outcome(null, "FAIL", "INVALID_NATIVE_CAPABILITY");
  return freeze({ ...native, busy: state ? state.busy : false, operation: state ? state.operation : "idle" });
}
