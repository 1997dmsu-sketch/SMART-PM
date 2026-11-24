import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_INPUT_BYTES = 32 * 1024;
const OUTCOMES = new Map([[2, "invalid-input"], [4, "failed"], [5, "stopped"]]);
const STEP_LABELS = { person: "建人", face: "上传人脸", access: "授权门", verify: "查询确认" };
const STEP_STATES = new Set(["pending", "running", "success", "failed"]);
const HELP = {
  protocolVersion: 1,
  outcome: "help",
  usage: "node admin-web/face-enroll.mjs",
  input: "由调用方从内存经标准输入提供一个 JSON 对象，最多 32768 字节；默认 simulation。人员姓名、凭据和照片路径只放在标准输入中。",
  device: "设备模式须显式设置 mode=device；expectedModel 默认 DS-K1T671BM，可用非空字符串明确指定其他预期型号。",
  options: ["--help"],
};

class InputFailure extends Error {
  constructor(category) {
    super(category);
    this.category = category;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readInput(stdin) {
  const chunks = [];
  let length = 0;
  try {
    for await (const chunk of stdin) {
      if (typeof chunk !== "string" && !(chunk instanceof Uint8Array))
        throw new InputFailure("INPUT_INTERRUPTED");
      const chunkLength = typeof chunk === "string" ? Buffer.byteLength(chunk, "utf8") : chunk.byteLength;
      if (chunkLength > MAX_INPUT_BYTES - length)
        throw new InputFailure("INPUT_TOO_LARGE");
      const bytes = Buffer.from(chunk);
      chunks.push(bytes);
      length += bytes.length;
    }
  } catch (error) {
    if (error instanceof InputFailure) throw error;
    throw new InputFailure("INPUT_INTERRUPTED");
  }
  let input;
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length));
    input = JSON.parse(source);
  } catch {
    throw new InputFailure("INPUT_JSON_INVALID");
  }
  if (!isObject(input)) throw new InputFailure("INPUT_OBJECT_REQUIRED");
  if (input.mode === undefined) input.mode = "simulation";
  return input;
}

function sensitiveValues(input) {
  const values = new Set();
  const pending = [input];
  while (pending.length) {
    const current = pending.pop();
    for (const [key, value] of Object.entries(current)) {
      if (typeof value === "string" && value &&
          /password|username|credential|secret|token|(?:photo|certificate)(?:path|base64)/i.test(key))
        for (const candidate of [value, value.trim()])
          if (candidate) values.add(candidate.replace(/[\r\n\u2028\u2029]/g, " "));
      if (value && typeof value === "object") pending.push(value);
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

function safeText(value, secrets) {
  if (typeof value !== "string") return null;
  let text = value.replace(/[\r\n\u2028\u2029]/g, " ");
  for (const secret of secrets) {
    if (text === secret) text = "[redacted]";
    else if (secret.length >= 4) text = text.split(secret).join("[redacted]");
  }
  return text.slice(0, 1024);
}

function pickScalars(value, fields, secrets) {
  const output = {};
  if (!isObject(value)) return output;
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) continue;
    const item = value[field];
    if (typeof item === "string") output[field] = safeText(item, secrets);
    else if (item === null || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item)))
      output[field] = item;
  }
  return output;
}

function safeEnrollment(value, secrets) {
  if (!isObject(value)) return null;
  const row = pickScalars(value, [
    "id", "employeeNo", "name", "doorNo", "FDID", "faceLibType", "mode", "status",
    "validityMode", "validFrom", "validTo", "accessPlanTemplateNo", "accessPlanFingerprint",
    "accessPlanName", "faceSubmitted", "faceAssociationConfirmed", "faceModelingVerified", "createdAt", "updatedAt", "error",
  ], secrets);
  row.steps = Array.isArray(value.steps) ? value.steps.slice(0, 4).filter((step) =>
    isObject(step) && Object.hasOwn(STEP_LABELS, step.key) && STEP_STATES.has(step.state),
  ).map((step) => ({
    key: step.key,
    label: STEP_LABELS[step.key],
    state: step.state,
    message: safeText(step.message, secrets) || "",
  })) : [];
  return row;
}

function safeResult(result, input) {
  if (!isObject(result) || ![0, 2, 4, 5].includes(result.exitCode) || !isObject(result.output))
    throw Error("invalid result");
  if (result.exitCode === 0 &&
      (!["simulation", "device"].includes(result.output.mode) || result.output.mode !== input.mode))
    throw Error("inconsistent result mode");
  const mode = input.mode === "device" ? "device" : "simulation";
  const expectedOutcome = result.exitCode === 0
    ? mode === "device" ? "device-enrollment-confirmed-pending-site" : "simulation-completed"
    : OUTCOMES.get(result.exitCode);
  if (result.output.protocolVersion !== 1 || result.output.outcome !== expectedOutcome)
    throw Error("invalid result");
  const source = result.output;
  const secrets = sensitiveValues(input);
  const output = {
    protocolVersion: 1,
    outcome: source.outcome,
    mode,
    personnelId: safeText(source.personnelId, secrets),
    roomNote: safeText(source.roomNote, secrets),
    validityMode: source.validityMode === "unlimited" ? "unlimited" : "fixed",
    dailyHours: "24x7",
    siteVerification: mode === "device" ? "PENDING" : "NOT_APPLICABLE",
    device: isObject(source.device) ? {
      model: safeText(source.device.model, secrets) || "",
      firmware: safeText(source.device.firmware, secrets) || "",
    } : null,
    enrollment: safeEnrollment(source.enrollment, secrets),
  };
  if (isObject(source.error)) output.error = {
    code: safeText(source.error.code, secrets) || "COMMAND_FAILED",
    message: safeText(source.error.message, secrets) || "执行未完成，请人工检查。",
    requiresInspection: source.error.requiresInspection === true,
  };
  return { exitCode: result.exitCode, output };
}

function localFailure(category, stopped = false, input = {}) {
  return {
    exitCode: stopped ? 5 : 2,
    category,
    output: {
      protocolVersion: 1,
      outcome: stopped ? "stopped" : "invalid-input",
      mode: input.mode === "device" ? "device" : "simulation",
      personnelId: null,
      roomNote: null,
      validityMode: input.validityMode === "unlimited" ? "unlimited" : "fixed",
      dailyHours: "24x7",
      siteVerification: input.mode === "device" ? "PENDING" : "NOT_APPLICABLE",
      device: null,
      enrollment: null,
      error: {
        code: stopped ? "UNEXPECTED_RUNNER_ERROR" : "COMMAND_INPUT_INVALID",
        message: stopped ? "执行状态需要人工检查，未自动重试。" : "输入不符合命令要求。",
        requiresInspection: stopped,
      },
    },
  };
}

function write(sink, text) {
  try { sink.write(text); return true; }
  catch { return false; }
}

export async function main({
  argv = process.argv.slice(2), stdin = process.stdin, stdout = process.stdout,
  stderr = process.stderr, run,
} = {}) {
  if (argv.length === 1 && argv[0] === "--help")
    return write(stdout, `${JSON.stringify(HELP)}\n`) ? 0 : 5;

  let result;
  let input;
  if (argv.length) result = localFailure("UNSUPPORTED_ARGUMENTS");
  else {
    try { input = await readInput(stdin); }
    catch (error) { result = localFailure(error instanceof InputFailure ? error.category : "INPUT_INTERRUPTED"); }
  }
  if (!result) {
    try {
      const runner = run || (await import("./lib/face-enrollment-command.mjs")).runFaceEnrollment;
      result = safeResult(await runner(input), input);
    } catch {
      result = localFailure("UNEXPECTED_RUNNER_ERROR", true, input);
    }
  }
  if (result.exitCode) {
    const category = result.category || ({ 2: "COMMAND_INPUT_INVALID", 4: "ENROLLMENT_FAILED", 5: "COMMAND_STOPPED" })[result.exitCode];
    write(stderr, `${category}\n`);
  }
  return write(stdout, `${JSON.stringify(result.output)}\n`) ? result.exitCode : 5;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Broken output pipes must not reveal a stack or unhandled exception text.
  let pipeFailed = false;
  const onPipeError = () => { pipeFailed = true; process.exitCode = 5; };
  process.stdout.on("error", onPipeError);
  process.stderr.on("error", onPipeError);
  const exitCode = await main();
  process.exitCode = pipeFailed ? 5 : exitCode;
}
