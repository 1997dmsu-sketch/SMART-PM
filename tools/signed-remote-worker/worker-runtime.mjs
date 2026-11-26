import { constants } from "node:fs";
import { open, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HikvisionClient } from "../../admin-web/lib/hikvision-client.mjs";
import { HikvisionDoorProvider } from "../../admin-web/lib/hikvision-door.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FUNCTION_NAME = "signedLeaseAccess";
const TASK_KEYS = Object.freeze(["taskId", "claimId", "revision", "deviceKey", "doorNo", "expectedModel", "validFrom", "validUntil", "expiresAt", "contractId", "doorBindingId"]);
const ACTIONS = Object.freeze(["claimOpen", "beginOpen", "reportOpen"]);
const consumedClaims = new Map();
const STOP_CLOUD_CODES = new Set(["WORKER_UNAUTHORIZED", "PROGRAM_DISABLED", "INVALID_INPUT", "CLOUD_CONFIGURATION_INVALID", "CLOUD_ACTION_INVALID"]);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const id = value => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\s\x00-\x1f\x7f<>]/.test(value);
const model = value => typeof value === "string" && /^[A-Za-z0-9_.()+ -]{1,128}$/.test(value);
const door = value => Number.isSafeInteger(value) && value >= 1 && value <= 65535;
const epoch = value => Number.isSafeInteger(value) && value > 0;
export class WorkerError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new WorkerError(code); };

function localPath(value) {
  if (typeof value !== "string" || !value || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value) || /^[\\/]{2}/.test(value) || /^\\\?\?\\/.test(value)) fail("LOCAL_PATH_INVALID");
  const path = resolve(value); if (/^[\\/]{2}/.test(path)) fail("LOCAL_PATH_INVALID"); return path;
}

function setSecret(object, key, value) {
  Object.defineProperty(object, key, { value, enumerable: false, writable: true });
}

/** No SDK or device initialization. Real material is read only on explicit CLI execution. */
export async function loadWorkerConfig({ configPath = join(ROOT, "worker.local.json"), env = process.env, readFileImpl = readFile } = {}) {
  let file;
  try { file = JSON.parse(String(await readFileImpl(localPath(configPath), "utf8"))); }
  catch { fail("LOCAL_CONFIG_INVALID"); }
  if (!isObject(file) || !isObject(file.device)) fail("LOCAL_CONFIG_INVALID");
  const allowed = ["workerId", "workerTokenEnv", "cloudEnv", "functionName", "deviceKey", "expectedModel", "allowedDoorNos", "sdkModulePath", "cloudSecretIdEnv", "cloudSecretKeyEnv", "device"];
  if (Object.keys(file).some(key => !allowed.includes(key)) || Object.keys(file.device).some(key => !["origin", "username", "password", "certificatePath", "developmentTls", "usernameEnv", "passwordEnv"].includes(key))) fail("LOCAL_CONFIG_INVALID");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(file.workerId || "") || !id(file.deviceKey) || !id(file.cloudEnv) || !model(file.expectedModel)) fail("LOCAL_CONFIG_INVALID");
  if (!Array.isArray(file.allowedDoorNos) || !file.allowedDoorNos.length || file.allowedDoorNos.length > 64 || !file.allowedDoorNos.every(door) || new Set(file.allowedDoorNos).size !== file.allowedDoorNos.length) fail("LOCAL_DOORS_INVALID");
  if (file.functionName !== undefined && file.functionName !== FUNCTION_NAME) fail("CLOUD_FUNCTION_INVALID");
  // There is intentionally no TLS-exception switch in this worker.
  if (file.device.developmentTls !== undefined && file.device.developmentTls !== false) fail("TLS_BYPASS_FORBIDDEN");
  let origin;
  try { origin = new URL(file.device.origin); } catch { fail("DEVICE_CONFIGURATION_INVALID"); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) fail("DEVICE_CONFIGURATION_INVALID");
  const envKey = (value, fallback) => {
    const key = value === undefined ? fallback : value;
    if (typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)) fail("LOCAL_CONFIG_INVALID");
    return key;
  };
  const token = env[envKey(file.workerTokenEnv, "SIGNED_REMOTE_WORKER_TOKEN")];
  const username = env[envKey(file.device.usernameEnv, "SIGNED_REMOTE_DEVICE_USERNAME")] ?? file.device.username;
  const password = env[envKey(file.device.passwordEnv, "SIGNED_REMOTE_DEVICE_PASSWORD")] ?? file.device.password;
  if (typeof token !== "string" || !/^[^\s\x00-\x1f\x7f]{32,256}$/.test(token)) fail("WORKER_TOKEN_INVALID");
  if (typeof username !== "string" || !username || /[:\x00-\x1f\x7f]/.test(username) || typeof password !== "string" || !password || /[\x00\r\n]/.test(password)) fail("DEVICE_CONFIGURATION_INVALID");
  const config = {
    workerId: file.workerId, cloudEnv: file.cloudEnv, functionName: FUNCTION_NAME,
    deviceKey: file.deviceKey, expectedModel: file.expectedModel,
    allowedDoorNos: Object.freeze([...file.allowedDoorNos]),
    sdkModulePath: file.sdkModulePath ? localPath(file.sdkModulePath) : "",
    device: { developmentTls: false },
  };
  for (const [key, value] of Object.entries({ token, secretId: env[envKey(file.cloudSecretIdEnv, "TENCENTCLOUD_SECRETID")] || "", secretKey: env[envKey(file.cloudSecretKeyEnv, "TENCENTCLOUD_SECRETKEY")] || "" })) setSecret(config, key, value);
  for (const [key, value] of Object.entries({ origin: origin.origin, username, password, certificatePath: localPath(file.device.certificatePath) })) setSecret(config.device, key, value);
  return config;
}

function validateLocalTarget(config) {
  if (!isObject(config) || !id(config.deviceKey) || !model(config.expectedModel) || !Array.isArray(config.allowedDoorNos) || !config.allowedDoorNos.length || !config.allowedDoorNos.every(door) || !isObject(config.device) || config.device.developmentTls !== false) fail("LOCAL_TARGET_INVALID");
}

export function validateTask(task, config, nowMs) {
  validateLocalTarget(config);
  if (!isObject(task) || Object.keys(task).length !== TASK_KEYS.length || TASK_KEYS.some(key => !Object.hasOwn(task, key)) || Object.keys(task).some(key => !TASK_KEYS.includes(key))) fail("TASK_INVALID");
  for (const key of ["taskId", "claimId", "deviceKey", "contractId", "doorBindingId"]) if (!id(task[key])) fail("TASK_INVALID");
  if (!Number.isSafeInteger(task.revision) || task.revision < 1 || !model(task.expectedModel) || !door(task.doorNo)) fail("TASK_INVALID");
  if (task.deviceKey !== config.deviceKey || task.expectedModel !== config.expectedModel || !config.allowedDoorNos.includes(task.doorNo)) fail("TASK_TARGET_MISMATCH");
  if (!Number.isSafeInteger(task.validFrom) || ![task.validUntil, task.expiresAt, nowMs].every(epoch) || task.validFrom >= task.validUntil || task.expiresAt > task.validUntil) fail("TASK_TIME_INVALID");
  if (nowMs < task.validFrom || nowMs >= task.validUntil || nowMs >= task.expiresAt || task.expiresAt - nowMs > 30000) fail("TASK_EXPIRED");
  return task;
}

export function verifyBeginSnapshot(claimed, begun, config, nowMs) {
  validateTask(begun, config, nowMs);
  if (begun.revision !== claimed.revision + 1 || TASK_KEYS.some(key => key !== "revision" && begun[key] !== claimed[key])) fail("BEGIN_SNAPSHOT_MISMATCH");
  return begun;
}

/** A single opened ordinary file, bounded size, no symlink, stable metadata. */
export async function readPublicCertificate(path) {
  let handle, bytes;
  try {
    handle = await open(localPath(path), constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > 65536n) fail("CERTIFICATE_INVALID");
    bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
    while (length < bytes.length) { const read = await handle.read(bytes, length, bytes.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
    const after = await handle.stat({ bigint: true });
    if (length !== Number(before.size) || !after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) fail("CERTIFICATE_INVALID");
    const certificate = Buffer.from(bytes.subarray(0, length)); bytes.fill(0); return certificate;
  } catch { bytes?.fill(0); fail("CERTIFICATE_INVALID"); }
  finally { await handle?.close(); }
}

function correlated(claimed, begun) {
  return isObject(begun) && begun.taskId === claimed.taskId && begun.claimId === claimed.claimId && begun.revision === claimed.revision + 1;
}
const notExecuted = (code, stopLoop = false) => ({ status: "not_executed", code, reportAttempted: false, ...(stopLoop ? { stopLoop: true } : {}) });
function forgetExpiredClaims(now) {
  if (!epoch(now)) return;
  for (const [key, expiresAt] of consumedClaims) if (expiresAt <= now) consumedClaims.delete(key);
}
function stopForCloudError(error) { return error?.stopLoop === true || STOP_CLOUD_CODES.has(error?.code) || STOP_CLOUD_CODES.has(error?.cloudCode); }

/** One claim, one begin, at most one ordinary open, at most one report. No retry. */
export async function processOnce({ config, cloud, nowMs = () => Date.now(), createProvider = options => new HikvisionDoorProvider(new HikvisionClient(options)), readCertificate = readPublicCertificate, signal } = {}) {
  validateLocalTarget(config);
  if (!cloud || typeof cloud.callFunction !== "function" || !/^[A-Za-z0-9_-]{1,64}$/.test(config.workerId || "") || typeof config.token !== "string" || !config.token) fail("WORKER_CONFIGURATION_INVALID");
  if (signal?.aborted) return notExecuted("CANCELLED");
  forgetExpiredClaims(nowMs());
  let claimed;
  try { claimed = (await cloud.callFunction("claimOpen", { workerId: config.workerId, token: config.token }))?.task; }
  catch (error) { return notExecuted("CLAIM_UNAVAILABLE", stopForCloudError(error)); }
  if (claimed === null) return { status: "idle", reportAttempted: false };
  try { validateTask(claimed, config, nowMs()); } catch { return notExecuted("CLAIM_INVALID", true); }
  if (signal?.aborted) return notExecuted("CANCELLED");
  const claimKey = JSON.stringify([claimed.taskId, claimed.claimId]);
  if (consumedClaims.has(claimKey)) return notExecuted("DUPLICATE_CLAIM");
  // Entries can be forgotten only once their immutable deadline has elapsed;
  // such tasks fail validateTask before they can ever reach begin again.
  consumedClaims.set(claimKey, claimed.expiresAt);
  let begun;
  let result = { status: "failed", deviceStatusCode: null };
  let provider, certificate, code = "PRE_EXECUTION_FAILED";
  let cleanupFailed = false, earlyResult;
  const early = value => { earlyResult = value; return value; };
  const withCleanup = outcome => cleanupFailed ? {
    ...outcome, primaryCode: outcome.code, code: "CLEANUP_FAILED", cleanupCode: "CLEANUP_FAILED", cleanupFailed: true, stopLoop: true,
  } : outcome;
  try {
    // Finish potentially slow, read-only setup before the last authoritative
    // begin. A revocation during this GET is therefore seen by begin's fresh
    // transaction rather than leaving an old authorization across the GET.
    certificate = await readCertificate(config.device.certificatePath);
    if (!Buffer.isBuffer(certificate) || !certificate.length || certificate.length > 65536) fail("CERTIFICATE_INVALID");
    provider = await createProvider({
      origin: config.device.origin, username: config.device.username, password: config.device.password,
      certificate, developmentTls: false, absoluteDeadline: claimed.expiresAt,
      timeoutMs: Math.max(1, Math.min(5000, claimed.expiresAt - nowMs())), maxResponseBytes: 65536,
    });
    certificate.fill(0); certificate = null;
    if (!provider || typeof provider.verifyTarget !== "function" || typeof provider.openOnce !== "function" || typeof provider.close !== "function") fail("DEVICE_PROVIDER_INVALID");
    await provider.verifyTarget({ expectedModel: claimed.expectedModel, doorNo: claimed.doorNo });
    validateTask(claimed, config, nowMs());
    if (signal?.aborted) return early(notExecuted("CANCELLED"));
    try { begun = await cloud.callFunction("beginOpen", { workerId: config.workerId, token: config.token, taskId: claimed.taskId, claimId: claimed.claimId, revision: claimed.revision }); }
    catch (error) { return early(notExecuted("BEGIN_AUTH_UNAVAILABLE", stopForCloudError(error))); }
    if (!correlated(claimed, begun)) return early(notExecuted("BEGIN_SNAPSHOT_INVALID", true));
    try {
      verifyBeginSnapshot(claimed, begun, config, nowMs());
      if (signal?.aborted) fail("CANCELLED");
      // No setup or await between this last proof and the one logical open.
      code = "DEVICE_RESULT_UNKNOWN";
      try { result = await provider.openOnce({ doorNo: begun.doorNo }); }
      catch { result = { status: "unknown", deviceStatusCode: null }; }
      if (!isObject(result) || !["device_confirmed", "failed", "unknown"].includes(result.status)
        || (result.status === "device_confirmed" && result.deviceStatusCode !== "1")
        || (result.status === "unknown" && result.deviceStatusCode !== null)
        || (result.status === "failed" && result.deviceStatusCode !== null && !/^[2-7]$/.test(result.deviceStatusCode))) result = { status: "unknown", deviceStatusCode: null };
      code = result.status === "device_confirmed" ? "DEVICE_COMMAND_ACCEPTED" : result.status === "failed" ? "DEVICE_REJECTED" : "DEVICE_RESULT_UNKNOWN";
    } catch { /* Valid begin, but local final proof failed: report failure, no open. */ }
  } catch { return early(notExecuted("PREPARATION_FAILED", true)); }
  finally {
    certificate?.fill(0);
    try { await provider?.close(); }
    catch {
      cleanupFailed = true;
      // Preserve an already-selected pre-execution failure or cancellation.
      // No return from finally, no fabricated device report or raw error text.
      if (earlyResult) Object.assign(earlyResult, { cleanupCode: "CLEANUP_FAILED", cleanupFailed: true, stopLoop: true });
    }
  }
  const payload = { workerId: config.workerId, token: config.token, taskId: claimed.taskId, claimId: claimed.claimId, revision: begun.revision, status: result.status, deviceStatusCode: result.deviceStatusCode };
  try {
    await cloud.callFunction("reportOpen", payload);
    return withCleanup({ ...result, code, reportAttempted: true, reportDelivered: true });
  } catch (error) {
    return withCleanup({ ...result, code: "REPORT_UNAVAILABLE", reportAttempted: true, reportDelivered: false, ...(stopForCloudError(error) ? { stopLoop: true } : {}) });
  }
}

/** Resolve only the declared worker's own SDK installation (no ancestor fallback). */
export async function createCloudClient({ config, sdkFactory = null, workerRoot = ROOT } = {}) {
  if (!config || !id(config.cloudEnv) || (config.functionName !== undefined && config.functionName !== FUNCTION_NAME)) fail("CLOUD_CONFIGURATION_INVALID");
  let app;
  try {
    const args = { env: config.cloudEnv };
    if (config.secretId) args.secretId = config.secretId;
    if (config.secretKey) args.secretKey = config.secretKey;
    if (sdkFactory) app = await sdkFactory(args);
    else {
      const boundary = await realpath(config.sdkModulePath || workerRoot);
      const expected = await realpath(join(boundary, "node_modules", "@cloudbase", "node-sdk"));
      const packageRelative = relative(boundary, expected);
      if (!packageRelative.startsWith(`node_modules${sep}`) || isAbsolute(packageRelative)) fail("CLOUD_SDK_BOUNDARY_INVALID");
      const pkg = JSON.parse(await readFile(join(expected, "package.json"), "utf8"));
      if (pkg.name !== "@cloudbase/node-sdk" || pkg.version !== "3.18.7") fail("CLOUD_SDK_VERSION_INVALID");
      const modulePath = await realpath(createRequire(join(boundary, "package.json")).resolve("@cloudbase/node-sdk"));
      const inside = relative(expected, modulePath);
      if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) fail("CLOUD_SDK_BOUNDARY_INVALID");
      const module = await import(pathToFileURL(modulePath).href);
      app = (module.default || module).init(args);
    }
  } catch { fail("CLOUD_SDK_INITIALIZATION_FAILED"); }
  if (!app || typeof app.callFunction !== "function") fail("CLOUD_SDK_INITIALIZATION_FAILED");
  return {
    async callFunction(action, payload) {
      if (!ACTIONS.includes(action) || !isObject(payload) || Object.hasOwn(payload, "action")) fail("CLOUD_ACTION_INVALID");
      let result;
      try { const response = await app.callFunction({ name: FUNCTION_NAME, data: { ...payload, action } }); result = response?.result ?? response; }
      catch (cause) {
        const error = new WorkerError("CLOUD_CALL_UNAVAILABLE");
        // SDK credential/permission failures stop a long-running worker. No
        // provider error message or untrusted text is retained or printed.
        if ([401, 403].includes(cause?.statusCode ?? cause?.status) || /^(?:AUTH|CREDENTIAL|SIGNATURE|INVALID_SECRET)/i.test(String(cause?.code || ""))) error.stopLoop = true;
        throw error;
      }
      if (!isObject(result) || result.code !== 0 || !isObject(result.data)) {
        const error = new WorkerError("CLOUD_CALL_REJECTED");
        if (!isObject(result) || STOP_CLOUD_CODES.has(result.code)) error.stopLoop = true;
        throw error;
      }
      return result.data;
    },
  };
}

function pollDelay(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(done => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", finish); done(); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) finish();
  });
}

/** Explicit opt-in outbound polling. Await each whole task before the next claim. */
export async function runLoop({ config, cloud, signal, delay = pollDelay, processOnceImpl = processOnce, onResult = () => {} } = {}) {
  if (![delay, processOnceImpl, onResult].every(value => typeof value === "function")) return { status: "stopped", code: "WORKER_STOPPED" };
  while (!signal?.aborted) {
    let result;
    try {
      result = await processOnceImpl({ config, cloud, signal });
      await onResult(result);
    } catch { return { status: "stopped", code: "WORKER_STOPPED" }; }
    if (!isObject(result) || result.stopLoop === true) return { status: "stopped", code: "WORKER_STOPPED" };
    if (signal?.aborted) break;
    try { await delay(1000, signal); }
    catch { return { status: "stopped", code: signal?.aborted ? "CANCELLED" : "WORKER_STOPPED" }; }
  }
  return { status: "stopped", code: "CANCELLED" };
}

function safeSummary(result) {
  const summary = { status: ["idle", "not_executed", "device_confirmed", "failed", "unknown"].includes(result?.status) ? result.status : "unknown", reportDelivered: result?.reportDelivered === true };
  if (/^[A-Z_]{3,64}$/.test(result?.code || "")) summary.code = result.code;
  for (const key of ["primaryCode", "cleanupCode"]) if (/^[A-Z_]{3,64}$/.test(result?.[key] || "")) summary[key] = result[key];
  if (result?.cleanupFailed === true) summary.cleanupFailed = true;
  return summary;
}

export async function main({ argv = process.argv.slice(2), loadConfig = loadWorkerConfig, createCloud = createCloudClient, processOnceImpl = processOnce, runLoopImpl = runLoop, stdout = process.stdout, stderr = process.stderr } = {}) {
  let execute = false, loop = false, check = false, configPath;
  try {
    for (let index = 0; index < argv.length; index++) {
      if (argv[index] === "--execute-once" && !execute) execute = true;
      else if (argv[index] === "--execute-loop" && !loop) loop = true;
      else if (argv[index] === "--check-config" && !check) check = true;
      else if (argv[index] === "--config" && configPath === undefined && typeof argv[index + 1] === "string" && !argv[index + 1].startsWith("--")) configPath = argv[++index];
      else if (argv[index] === "--help" && argv.length === 1) { stdout.write("Use --check-config, --execute-once or --execute-loop [--config <local-file>]. Default: no execution.\n"); return 0; }
      else fail("CLI_ARGUMENT_INVALID");
    }
    if ([execute, loop, check].filter(Boolean).length > 1) fail("CLI_ARGUMENT_INVALID");
    if (!execute && !loop && !check) { stdout.write("No execution. Use --execute-once for one task or --execute-loop for outbound polling.\n"); return 0; }
    const config = await loadConfig({ ...(configPath === undefined ? {} : { configPath }) });
    if (check) { stdout.write("Configuration valid; no cloud or device operation performed.\n"); return 0; }
    const cloud = await createCloud({ config });
    if (loop) {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      try {
        const outcome = await runLoopImpl({ config, cloud, signal: controller.signal, processOnceImpl,
          onResult: result => { if (result?.status !== "idle") stdout.write(`${JSON.stringify(safeSummary(result))}\n`); } });
        stdout.write(`${JSON.stringify({ status: "stopped", code: outcome?.code === "CANCELLED" ? "CANCELLED" : "WORKER_STOPPED" })}\n`);
        return outcome?.code === "CANCELLED" ? 0 : 1;
      } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
    }
    const result = await processOnceImpl({ config, cloud });
    // Closed output whitelist: never stringify task, config, SDK error or body.
    const summary = safeSummary(result);
    stdout.write(`${JSON.stringify(summary)}\n`);
    return !result?.cleanupFailed && !result?.stopLoop && (summary.status === "idle" || (summary.status === "device_confirmed" && summary.reportDelivered)) ? 0 : 2;
  } catch {
    stderr.write("SIGNED_REMOTE_WORKER_STOPPED: no automatic retry.\n"); return 1;
  }
}
