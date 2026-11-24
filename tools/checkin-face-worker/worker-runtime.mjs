/**
 * 本地受控 worker 运行时（B04）。
 *
 * 职责：
 *   1. 从 Git 忽略的 *.local.json 与环境变量读取 worker token 与设备材料；
 *   2. 构造 runFaceEnrollment 入参，显式 mode=device / validityMode=fixed /
 *      validFrom+validTo（来自云任务）/ doorNo（来自云端绑定）/ employeeNo（来自云任务）/ consent=true；
 *   3. 只做出站云函数调用（claimTask / reportTask），不监听任何端口、不反代 admin loopback；
 *   4. 所有日志脱敏，不输出密码、证书内容、照片内容、origin 主机或 worker token。
 *
 * 本模块不自动重试、不换人员编号、不删除任何设备残留。
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runFaceEnrollment } from "../../admin-web/lib/face-enrollment-command.mjs";

const DEFAULT_CONFIG_FILE = fileURLToPath(new URL("./checkin-face-worker.local.json", import.meta.url));
const DEFAULT_TOKEN_ENV = "CHECKIN_FACE_WORKER_TOKEN";
const DEFAULT_SECRET_ID_ENV = "TENCENTCLOUD_SECRETID";
const DEFAULT_SECRET_KEY_ENV = "TENCENTCLOUD_SECRETKEY";
const DEFAULT_FUNCTION_NAME = "checkinFaceTest";
/** R07：SDK 默认解析边界 = worker 自有 node_modules（本目录），不依赖偶然根 node_modules / NODE_PATH / admin-web 下层依赖。 */
const SDK_MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const ALLOWED_ACTIONS = Object.freeze(["claimTask", "reportTask", "beginTaskExecution"]);
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMPLOYEE_RE = /^[A-Za-z0-9]{1,32}$/;
// Cloud ids are deterministic and environment-anchored, e.g. "env|task|appId".
const ID_RE = /^[A-Za-z0-9_.:|-]{1,160}$/;
const KNOWN_OUTCOMES = new Set([
  "device-enrollment-confirmed-pending-site",
  "simulation-completed",
  "invalid-input",
  "failed",
  "stopped",
]);
const STOPPED_MESSAGE = "执行未完成，请人工核查设备现状；worker 不自动重试、不换号、不删除残留。";

/** 配置/任务缺项：对应登记命令 exitCode 2（预检失败，未启动业务写入）。 */
export class WorkerInputError extends Error {
  constructor(code, message, exitCode = 2) {
    super(message);
    this.name = "WorkerInputError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

/** 本地配置缺失或云调用失败：worker 进程级错误，不应伪装成设备结果。 */
export class WorkerConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkerConfigError";
    this.code = code;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyText(value, label, max = 2048) {
  if (typeof value !== "string") throw new WorkerInputError("WORKER_FIELD_INVALID", `${label} 缺失或不是字符串`);
  const text = value.trim();
  if (!text || text.length > max || /[\x00-\x1f\x7f]/.test(text)) {
    throw new WorkerInputError("WORKER_FIELD_INVALID", `${label} 格式无效`);
  }
  return text;
}

function localFilePath(value, label) {
  const text = nonEmptyText(value, label, 4096);
  if (/^[\\/]{2}/.test(text) || /^\\\?\?\\/.test(text)) {
    throw new WorkerInputError("WORKER_FIELD_INVALID", `${label} 必须是本机普通文件路径`);
  }
  let absolute;
  try {
    absolute = resolve(text);
  } catch {
    throw new WorkerInputError("WORKER_FIELD_INVALID", `${label} 必须是本机普通文件路径`);
  }
  if (/^[\\/]{2}/.test(absolute)) throw new WorkerInputError("WORKER_FIELD_INVALID", `${label} 必须是本机普通文件路径`);
  return absolute;
}

function requireField(object, key, validator, label) {
  if (!isObject(object) || !Object.hasOwn(object, key)) {
    throw new WorkerInputError("TASK_FIELD_MISSING", `${label} 缺失，拒绝执行`);
  }
  return validator(object[key], label);
}

function taskText(value, label) {
  return nonEmptyText(value, `任务字段 ${label}`, 256);
}

function taskId(value, label) {
  const text = taskText(value, label);
  if (!ID_RE.test(text)) throw new WorkerInputError("TASK_FIELD_INVALID", `任务字段 ${label} 格式无效`);
  return text;
}

function taskRevision(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new WorkerInputError("TASK_FIELD_INVALID", `任务字段 ${label} 必须是非负整数`);
  }
  return value;
}

function taskDoorNo(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new WorkerInputError("TASK_FIELD_INVALID", "任务门号 doorNo 必须是 1–65535 的整数；不使用默认门号 1");
  }
  return value;
}

function taskDate(value, label) {
  const text = taskText(value, label);
  if (!DATETIME_RE.test(text)) {
    throw new WorkerInputError("TASK_FIELD_INVALID", `任务字段 ${label} 必须是 Asia/Shanghai 的 YYYY-MM-DDTHH:mm:ss；不自造日期`);
  }
  return text;
}

/** 只读取环境或本地文件中的非机密键；机密键以不可枚举属性保存，避免被 JSON.stringify 意外输出。 */
export async function loadWorkerConfig({
  configPath = DEFAULT_CONFIG_FILE,
  env = process.env,
  readJsonFile = readFile,
} = {}) {
  let file = {};
  try {
    const bytes = await readJsonFile(configPath, "utf8");
    const parsed = JSON.parse(String(bytes));
    if (!isObject(parsed)) throw new Error("config not object");
    file = parsed;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new WorkerConfigError("LOCAL_CONFIG_INVALID", "本地 worker 配置不是有效 JSON 对象");
    }
  }

  const deviceFile = isObject(file.device) ? file.device : {};
  const environment = typeof file.environment === "string" && file.environment.trim()
    ? file.environment.trim()
    : "checkin-face-test";
  const cloudEnv = typeof file.cloudEnv === "string" ? file.cloudEnv.trim() : "";
  const workerId = typeof file.workerId === "string" && file.workerId.trim() ? file.workerId.trim() : "";
  const deviceKey = typeof file.deviceKey === "string" && file.deviceKey.trim() ? file.deviceKey.trim() : "";
  let sdkModulePath = "";
  if (typeof file.sdkModulePath === "string" && file.sdkModulePath.trim()) {
    try {
      sdkModulePath = resolve(file.sdkModulePath.trim());
    } catch {
      throw new WorkerConfigError("SDK_MODULE_PATH_INVALID", "sdkModulePath 必须是本机普通目录路径");
    }
  }
  const functionName = typeof file.functionName === "string" && file.functionName.trim()
    ? file.functionName.trim()
    : DEFAULT_FUNCTION_NAME;
  const workerTokenEnv = typeof file.workerTokenEnv === "string" && file.workerTokenEnv.trim()
    ? file.workerTokenEnv.trim()
    : DEFAULT_TOKEN_ENV;
  const secretIdEnv = typeof file.cloudSecretIdEnv === "string" && file.cloudSecretIdEnv.trim()
    ? file.cloudSecretIdEnv.trim()
    : DEFAULT_SECRET_ID_ENV;
  const secretKeyEnv = typeof file.cloudSecretKeyEnv === "string" && file.cloudSecretKeyEnv.trim()
    ? file.cloudSecretKeyEnv.trim()
    : DEFAULT_SECRET_KEY_ENV;

  const workerToken = typeof env[workerTokenEnv] === "string" ? env[workerTokenEnv] : "";
  if (!workerToken || !workerToken.trim()) {
    throw new WorkerConfigError("WORKER_TOKEN_MISSING", `缺少 worker token，请设置环境变量 ${workerTokenEnv}`);
  }
  if (!/^[^\s\x00-\x1f\x7f]{8,256}$/.test(workerToken.trim())) {
    throw new WorkerConfigError("WORKER_TOKEN_INVALID", "worker token 格式无效");
  }
  if (!cloudEnv) throw new WorkerConfigError("CLOUD_ENV_MISSING", "本地配置缺少 cloudEnv");
  // R06 对齐清单 §2.1：workerId 格式预检（云端 INVALID_WORKER_ID 语义的本地失败关闭）。
  if (workerId && !/^[A-Za-z0-9_-]{1,64}$/.test(workerId)) {
    throw new WorkerConfigError("WORKER_ID_INVALID", "本地配置 workerId 格式无效（仅限字母数字、下划线、连字符，1–64 位）");
  }
  // R05：本地 deviceKey 必须明确、非空；缺失在配置加载即失败关闭（退出 1），不进领取/执行。
  if (!deviceKey) throw new WorkerConfigError("DEVICE_KEY_MISSING", "本地配置缺少非空 deviceKey；设备绑定校验要求本地与任务设备标识精确一致");

  const name = typeof file.name === "string" ? file.name.trim() : "";
  const roomNote = typeof file.roomNote === "string" ? file.roomNote.trim() : "102";
  const developmentTls = deviceFile.developmentTls === true;
  const planTemplateNo = typeof deviceFile.planTemplateNo === "string" ? deviceFile.planTemplateNo.trim() : "";
  const expectedModel = typeof deviceFile.expectedModel === "string" ? deviceFile.expectedModel.trim() : "";

  const config = {
    configPath: resolve(configPath),
    environment,
    cloudEnv,
    workerId,
    deviceKey,
    functionName,
    sdkModulePath,
    workerTokenEnv,
    cloudSecretIdEnv: secretIdEnv,
    cloudSecretKeyEnv: secretKeyEnv,
    name,
    roomNote,
    device: { developmentTls, planTemplateNo, expectedModel },
  };

  const secrets = {
    workerToken: workerToken.trim(),
    cloudSecretId: typeof env[secretIdEnv] === "string" ? env[secretIdEnv] : "",
    cloudSecretKey: typeof env[secretKeyEnv] === "string" ? env[secretKeyEnv] : "",
    deviceOrigin: typeof deviceFile.origin === "string" ? deviceFile.origin.trim() : "",
    deviceUsername: typeof env.CHECKIN_FACE_DEVICE_USERNAME === "string"
      ? env.CHECKIN_FACE_DEVICE_USERNAME
      : (typeof deviceFile.username === "string" ? deviceFile.username : ""),
    devicePassword: typeof env.CHECKIN_FACE_DEVICE_PASSWORD === "string"
      ? env.CHECKIN_FACE_DEVICE_PASSWORD
      : (typeof deviceFile.password === "string" ? deviceFile.password : ""),
    deviceCertificatePath: typeof deviceFile.certificatePath === "string" ? deviceFile.certificatePath.trim() : "",
  };
  for (const [key, value] of Object.entries(secrets)) {
    Object.defineProperty(key === "workerToken" || key.startsWith("cloudSecret") ? config : config.device, key, {
      value,
      enumerable: false,
      writable: true,
      configurable: false,
    });
  }
  return config;
}

/** 仅供日志使用的脱敏视图：键名与值都不得包含任何设备秘密。 */
export function safeConfigView(config) {
  return {
    environment: config?.environment || "",
    cloudEnv: config?.cloudEnv || "",
    workerId: config?.workerId || "",
    deviceKey: config?.deviceKey || "",
    functionName: config?.functionName || DEFAULT_FUNCTION_NAME,
    workerTokenEnv: config?.workerTokenEnv || DEFAULT_TOKEN_ENV,
  };
}

function collectSecrets(config, photoPath = "") {
  const values = [
    config?.workerToken,
    config?.cloudSecretId,
    config?.cloudSecretKey,
    config?.device?.deviceOrigin,
    config?.device?.deviceUsername,
    config?.device?.devicePassword,
    config?.device?.deviceCertificatePath,
    photoPath,
  ].filter((v) => typeof v === "string" && v.length >= 3);
  try {
    const origin = new URL(config?.device?.deviceOrigin || "");
    if (origin.host) values.push(origin.host, origin.hostname);
  } catch {
    // 非法 origin 会在 buildDeviceRequest 中被拒绝；这里只做日志脱敏。
  }
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

function safeString(value, secrets, max = 512) {
  if (typeof value !== "string") return "";
  let text = value.replace(/[\r\n\u2028\u2029]/g, " ");
  for (const secret of secrets) {
    if (secret.length >= 3) text = text.split(secret).join("[redacted]");
  }
  return text.slice(0, max);
}

function maskId(value) {
  const text = typeof value === "string" ? value : "";
  if (text.length <= 4) return "****";
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}

/** 结构化脱敏日志：只允许白名单字段，绝不传入任务原文、配置原文或命令输出原文。 */
export function safeLog(level, message, fields = {}, config = null) {
  const secrets = collectSecrets(config);
  const allowed = {
    taskId: (v) => maskId(v),
    claimId: (v) => maskId(v),
    revision: (v) => (Number.isSafeInteger(v) ? v : null),
    exitCode: (v) => ([0, 1, 2, 3, 4, 5].includes(v) ? v : null),
    outcome: (v) => (typeof v === "string" ? safeString(v, secrets, 64) : ""),
    mode: (v) => (v === "device" || v === "simulation" ? v : ""),
    validityMode: (v) => (v === "fixed" ? v : ""),
    doorNo: (v) => (Number.isSafeInteger(v) && v > 0 && v <= 65535 ? v : null),
    employeeNo: (v) => maskId(v),
    validFrom: (v) => (/^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? String(v) : ""),
    validTo: (v) => (/^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? String(v) : ""),
    code: (v) => (typeof v === "string" ? safeString(v, secrets, 64) : ""),
    workerId: (v) => (typeof v === "string" ? safeString(v, secrets, 64) : ""),
    environment: (v) => (typeof v === "string" ? safeString(v, secrets, 64) : ""),
  };
  const redacted = {};
  for (const [key, formatter] of Object.entries(allowed)) {
    if (fields[key] === undefined) continue;
    const value = formatter(fields[key]);
    if (value !== null && value !== "") redacted[key] = value;
  }
  const line = JSON.stringify({
    at: new Date().toISOString(),
    level: ["info", "warn", "error"].includes(level) ? level : "info",
    message: safeString(message, secrets, 160),
    ...redacted,
  });
  process.stderr.write(`${line}\n`);
}

function buildDeviceRequestCore(task, config) {
  if (!isObject(task)) throw new WorkerInputError("TASK_INVALID", "云任务格式无效");

  // 任务若试图改写模式/有效期语义，一律拒绝（不接受降级为模拟或长期模式）。
  if (task.mode !== undefined && task.mode !== "device") {
    throw new WorkerInputError("TASK_MODE_CONFLICT", "任务携带非 device 模式，拒绝执行");
  }
  if (task.validityMode !== undefined && task.validityMode !== "fixed") {
    throw new WorkerInputError("TASK_VALIDITY_CONFLICT", "任务携带非 fixed 有效期，拒绝执行");
  }

  const employeeNo = requireField(task, "employeeNo", (v) => {
    const text = taskText(v, "employeeNo");
    if (!EMPLOYEE_RE.test(text)) throw new WorkerInputError("TASK_FIELD_INVALID", "任务 employeeNo 格式无效");
    return text;
  }, "employeeNo");
  const validFrom = requireField(task, "validFrom", taskDate, "validFrom");
  const validTo = requireField(task, "validTo", taskDate, "validTo");
  const doorNo = requireField(task, "doorNo", taskDoorNo, "doorNo");
  if (validFrom > validTo) throw new WorkerInputError("TASK_DATE_ORDER", "任务租期起始晚于结束，拒绝执行");

  const device = config?.device || {};
  const origin = nonEmptyText(device.deviceOrigin, "设备 origin", 2048);
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new WorkerInputError("DEVICE_CONFIG_INVALID", "设备 origin 必须是明确 HTTPS 地址");
  }
  if (parsedOrigin.protocol !== "https:" || parsedOrigin.username || parsedOrigin.password) {
    throw new WorkerInputError("DEVICE_CONFIG_INVALID", "设备 origin 不得含账号密码，且必须使用 HTTPS");
  }
  const username = nonEmptyText(device.deviceUsername, "设备账号", 128);
  const password = nonEmptyText(device.devicePassword, "设备密码", 256);
  const certificatePath = localFilePath(device.deviceCertificatePath, "公开证书路径");
  const expectedModel = nonEmptyText(device.expectedModel || config?.expectedModel, "设备预期型号", 128);
  const planTemplateNo = device.planTemplateNo || "";
  if (planTemplateNo && !/^[1-9]\d{0,9}$/.test(planTemplateNo)) {
    throw new WorkerInputError("DEVICE_CONFIG_INVALID", "全天计划模板号格式无效");
  }
  // developmentTls 只是 TLS 校验模式，不绕过任何材料核验：型号/证书/门号/租期/全天计划校验独立保留。
  const developmentTls = device.developmentTls === true;

  const name = nonEmptyText(task.name || config?.name, "登记姓名", 128);
  const room = nonEmptyText(task.roomNote || task.room || config?.roomNote, "房号备注", 128);

  // R05：任务与本地 deviceKey 都必须明确、非空且精确一致；缺任一或不同立即拒绝（不进入执行器）。
  const taskDeviceKey = requireField(task, "deviceKey", taskText, "deviceKey");
  const configDeviceKey = typeof config?.deviceKey === "string" ? config.deviceKey.trim() : "";
  if (!configDeviceKey) {
    throw new WorkerInputError("DEVICE_KEY_MISSING", "本地配置缺少 deviceKey，拒绝执行");
  }
  if (taskDeviceKey !== configDeviceKey) {
    throw new WorkerInputError("DEVICE_KEY_CONFLICT", "任务设备标识与本地配置不一致，拒绝执行");
  }

  const request = {
    // 以下四项为硬要求：显式覆盖命令默认值，不接受任何缺省路径。
    mode: "device",
    validityMode: "fixed",
    consent: true,
    employeeNo,
    doorNo,
    validFrom,
    validTo,
    name,
    room,
    origin: parsedOrigin.href,
    username,
    password,
    certificatePath,
    developmentTls,
    expectedModel,
  };
  if (planTemplateNo) request.planTemplateNo = planTemplateNo;
  return request;
}

/**
 * 构造登记命令入参（落盘照片路径版本，保留旧调用方兼容）。
 * 全部关键字段显式赋值；任何缺项立即抛错，不回落到命令默认的
 * simulation / 长期模式 / doorNo=1 / 自造 employeeNo。
 *
 * 注意：返回的 request 含设备秘密，只能直接交给 runFaceEnrollment，禁止写日志或上报。
 */
export function buildDeviceRequest(task, config, photoPath) {
  const request = buildDeviceRequestCore(task, config);
  request.photoPath = localFilePath(photoPath, "本机临时照片路径");
  return Object.freeze(request);
}

/** R08：内存照片版本——不含 photoPath，照片由适配层以 Buffer 直接驱动业务服务，不在本机落盘。 */
export function buildInMemoryDeviceRequest(task, config) {
  return Object.freeze(buildDeviceRequestCore(task, config));
}

/** R05：领取后、任何下载/执行前，任务与本地 deviceKey 必须非空且精确一致。 */
export function assertDeviceKeyMatch(task, config) {
  if (!isObject(task)) throw new WorkerInputError("TASK_INVALID", "云任务格式无效");
  const taskKey = requireField(task, "deviceKey", taskText, "deviceKey");
  const configKey = typeof config?.deviceKey === "string" ? config.deviceKey.trim() : "";
  if (!configKey) throw new WorkerInputError("DEVICE_KEY_MISSING", "本地配置缺少 deviceKey，拒绝执行");
  if (taskKey !== configKey) throw new WorkerInputError("DEVICE_KEY_CONFLICT", "任务设备标识与本地配置不一致，拒绝执行");
  return taskKey;
}

/** R06：领取任务身份字段校验，在下载前失败关闭（避免为坏任务下载材料）。 */
export function validateClaimedTask(task) {
  if (!isObject(task)) throw new WorkerInputError("TASK_INVALID", "claimTask 返回的任务格式无效");
  requireField(task, "taskId", taskId, "taskId");
  requireField(task, "claimId", taskId, "claimId");
  requireField(task, "revision", taskRevision, "revision");
  const claimExpiresAt = requireField(task, "claimExpiresAt", (v, label) => {
    if (!Number.isSafeInteger(v) || v <= 0) throw new WorkerInputError("TASK_FIELD_INVALID", `任务字段 ${label} 必须是正整数毫秒`);
    return v;
  }, "claimExpiresAt");
  requireField(task, "fileId", (v, label) => {
    const text = taskText(v, label);
    if (!text.startsWith("cloud://")) throw new WorkerInputError("FILE_ID_INVALID", `任务字段 ${label} 不属于云存储`);
    return text;
  }, "fileId");
  requireField(task, "employeeNo", (v) => {
    const text = taskText(v, "employeeNo");
    if (!EMPLOYEE_RE.test(text)) throw new WorkerInputError("TASK_FIELD_INVALID", "任务 employeeNo 格式无效");
    return text;
  }, "employeeNo");
  requireField(task, "doorNo", taskDoorNo, "doorNo");
  requireField(task, "validFrom", taskDate, "validFrom");
  requireField(task, "validTo", taskDate, "validTo");
  requireField(task, "accessPlanFingerprint", (v) => {
    const text = taskText(v, "accessPlanFingerprint");
    if (!/^[a-f0-9]{64}$/i.test(text)) throw new WorkerInputError("TASK_FIELD_INVALID", "任务 accessPlanFingerprint 必须是 64 位十六进制指纹");
    return text;
  }, "accessPlanFingerprint");
  return claimExpiresAt;
}

/** 生成上报载荷；只从任务取身份字段，不接收新 employeeNo / 新日期。 */
export function buildReportPayload(task, result, config) {
  const exitCode = result?.exitCode;
  if (![0, 2, 4, 5].includes(exitCode)) {
    throw new WorkerInputError("RESULT_INVALID", "登记结果退出码无效，未上报");
  }
  if (!isObject(result.output)) throw new WorkerInputError("RESULT_INVALID", "登记结果输出无效，未上报");
  return {
    workerToken: config?.workerToken || "",
    taskId: requireField(task, "taskId", taskId, "taskId"),
    claimId: requireField(task, "claimId", taskId, "claimId"),
    revision: requireField(task, "revision", taskRevision, "revision"),
    exitCode,
    output: result.output,
  };
}

/**
 * R09：清理结果进入整体终态。清理未确认（cleanupOk === false）时保留已发生/未知的设备事实
 * （output 中的 device/enrollment 原样保留），但整体记为 stopped（exitCode 5），绝不误报清理成功，
 * 也不因清理失败重发设备操作。
 */
export function applyCleanupResult(result, cleanupOk) {
  if (cleanupOk !== false) return result;
  const output = isObject(result?.output) ? { ...result.output } : {};
  return {
    exitCode: 5,
    output: {
      ...output,
      outcome: "stopped",
      error: {
        code: "CLEANUP_FAILED",
        message: "本地材料清理未确认完成；已保留设备事实，请人工核查，不自动重发。",
        requiresInspection: true,
      },
    },
  };
}

/** 输出白名单脱敏：只保留云端比对所需字段，剔除秘密与任意附加字段。 */
export function sanitizeEnrollmentOutput(output, config = null, photoPath = "") {
  const secrets = collectSecrets(config, photoPath);
  const source = isObject(output) ? output : {};
  const clean = {
    protocolVersion: 1,
    outcome: safeString(source.outcome, secrets, 64),
    mode: source.mode === "device" ? "device" : "",
    personnelId: safeString(source.personnelId, secrets, 64),
    roomNote: safeString(source.roomNote, secrets, 64),
    // 本链路永久固定为 fixed；任何其它值都会在 runEnrollment 中收敛为 stopped。
    validityMode: "fixed",
    dailyHours: "24x7",
    siteVerification: source.siteVerification === "PENDING" ? "PENDING" : "NOT_APPLICABLE",
    device: null,
    enrollment: null,
  };
  if (source.device && typeof source.device === "object") {
    clean.device = {
      model: safeString(source.device.model, secrets, 128),
      firmware: safeString(source.device.firmware, secrets, 128),
    };
  }
  const row = source.enrollment;
  if (row && typeof row === "object" && !Array.isArray(row)) {
    const enrollment = {};
    for (const key of [
      "employeeNo", "name", "doorNo", "FDID", "faceLibType", "mode", "status", "validityMode",
      "validFrom", "validTo", "accessPlanTemplateNo", "accessPlanFingerprint", "accessPlanName",
      "faceSubmitted", "faceModelingVerified", "faceAssociationConfirmed", "createdAt", "updatedAt",
    ]) {
      const value = row[key];
      if (typeof value === "string") enrollment[key] = safeString(value, secrets, 256);
      else if (typeof value === "boolean" || (Number.isSafeInteger(value) && value >= 0)) enrollment[key] = value;
    }
    if (Array.isArray(row.steps)) {
      enrollment.steps = row.steps.slice(0, 4).map((step) => ({
        key: safeString(step?.key, secrets, 32),
        label: safeString(step?.label, secrets, 32),
        state: ["pending", "running", "success", "failed"].includes(step?.state) ? step.state : "pending",
        message: safeString(step?.message, secrets, 256),
      }));
    }
    clean.enrollment = enrollment;
  }
  if (source.error && typeof source.error === "object") {
    clean.error = {
      code: safeString(source.error.code, secrets, 64) || "COMMAND_FAILED",
      message: safeString(source.error.message, secrets, 256) || "执行未完成，请人工检查。",
      requiresInspection: source.error.requiresInspection === true,
    };
  }
  return clean;
}

/**
 * 调用既有登记命令，并把任何未知结果收敛为 exitCode 5 / stopped / 需人工核查。
 * 不做业务重试、不换 employeeNo、不删除设备残留。
 */
export async function runEnrollment(request, { run = runFaceEnrollment, commandDeps = {}, config = null, photoPath = "", photoBuffer = null } = {}) {
  let raw;
  try {
    raw = await run(request, { config, photoPath, photoBuffer, commandDeps });
  } catch (error) {
    return {
      exitCode: 5,
      output: {
        protocolVersion: 1,
        outcome: "stopped",
        mode: "device",
        personnelId: request?.employeeNo || null,
        roomNote: null,
        validityMode: "fixed",
        dailyHours: "24x7",
        siteVerification: "PENDING",
        device: null,
        enrollment: null,
        error: { code: "WORKER_RUNNER_ERROR", message: STOPPED_MESSAGE, requiresInspection: true },
      },
    };
  }
  const exitCode = [0, 2, 4, 5].includes(raw?.exitCode) ? raw.exitCode : 5;
  const output = sanitizeEnrollmentOutput(raw?.output, config, photoPath);
  if (!KNOWN_OUTCOMES.has(output.outcome) || output.validityMode !== "fixed"
    || (exitCode === 0 && output.mode !== "device")
    || (exitCode === 2 && output.outcome !== "invalid-input")
    || (exitCode === 4 && output.outcome !== "failed")
    || (exitCode === 5 && output.outcome !== "stopped")) {
    return {
      exitCode: 5,
      output: {
        ...output,
        outcome: "stopped",
        error: { code: "UNKNOWN_RESULT", message: STOPPED_MESSAGE, requiresInspection: true },
      },
    };
  }
  return { exitCode, output };
}

/**
 * R07：加载 @cloudbase/node-sdk。默认解析边界严格限定为 worker 自有 node_modules
 * （tools/checkin-face-worker/node_modules），可经 sdkModulePath 显式指定其他本机边界；
 * 不向上探测偶然的根 node_modules、不使用 NODE_PATH。
 * 解析失败抛出带安装指引的 WorkerConfigError（失败关闭，未发起任何任务调用）。
 */
async function loadCloudbaseSdkModule(explicitModulePath = "") {
  const base = typeof explicitModulePath === "string" && explicitModulePath.trim()
    ? resolve(explicitModulePath.trim())
    : SDK_MODULE_DIR;
  const requireFrom = createRequire(join(base, "noop.js"));
  const candidate = join(base, "node_modules", "@cloudbase", "node-sdk");
  let resolvedPath;
  try {
    resolvedPath = requireFrom.resolve(candidate);
  } catch {
    throw new WorkerConfigError(
      "CLOUD_SDK_RESOLVE_FAILED",
      `@cloudbase/node-sdk 未在 worker 自有依赖目录 ${join(base, "node_modules")} 解析成功；请在 tools/checkin-face-worker 目录执行 npm install（安装说明见该目录 README），不要依赖项目根或 admin-web 的偶然 node_modules`,
    );
  }
  const loaded = await import(pathToFileURL(resolvedPath).href);
  return (loaded && (loaded.default || loaded)) || null;
}

/**
 * 创建只做出站调用的云客户端。callFunction 的 payload 含 worker token，任何路径都不得记录它。
 */
export async function createCloudClient({
  config,
  env = process.env,
  cloudbaseFactory = null,
  sdkModulePath = null,
  logger = () => {},
} = {}) {
  if (!config?.cloudEnv) throw new WorkerConfigError("CLOUD_ENV_MISSING", "缺少云环境配置");
  const initArgs = { env: config.cloudEnv };
  if (config.cloudSecretId) initArgs.secretId = config.cloudSecretId;
  if (config.cloudSecretKey) initArgs.secretKey = config.cloudSecretKey;
  let app;
  try {
    if (typeof cloudbaseFactory === "function") app = await cloudbaseFactory(initArgs);
    else {
      const module = await loadCloudbaseSdkModule(sdkModulePath || config?.sdkModulePath);
      app = (module.default || module).init(initArgs);
    }
  } catch (error) {
    if (error instanceof WorkerConfigError) throw error;
    throw new WorkerConfigError("CLOUD_INIT_FAILED", "云客户端初始化失败，未发起任何任务调用");
  }
  if (!app || typeof app.callFunction !== "function" || typeof app.downloadFile !== "function") {
    throw new WorkerConfigError("CLOUD_INIT_FAILED", "云客户端缺少 callFunction/downloadFile 能力");
  }

  function callError(action, detail) {
    // detail 只可能是云函数返回的 code/msg，绝不含 worker token。
    const code = typeof detail?.code === "number" ? detail.code : -1;
    const msg = typeof detail?.msg === "string" ? detail.msg.slice(0, 200) : "云函数调用失败";
    logger("error", `cloud ${action} failed`, { code });
    return new WorkerConfigError("CLOUD_CALL_FAILED", `${action} 失败：${msg}`);
  }

  return {
    async callFunction(action, payload) {
      if (!ALLOWED_ACTIONS.includes(action)) {
        throw new WorkerConfigError("CLOUD_ACTION_INVALID", "worker 只允许 claimTask/reportTask/beginTaskExecution");
      }
      let response;
      try {
        response = await app.callFunction({
          name: config.functionName || DEFAULT_FUNCTION_NAME,
          data: { action, ...payload },
        });
      } catch {
        throw callError(action, null);
      }
      const result = response?.result ?? response;
      if (!isObject(result) || result.code !== 0) {
        // 附加云端闭式码，供执行前复核（R06）分类拒绝原因；网络失败不携带该码（回执未知）。
        const failureError = callError(action, result);
        if (isObject(result) && (typeof result.code === "number" || typeof result.code === "string")) {
          failureError.cloudCode = result.code;
        }
        if (isObject(result) && typeof result.msg === "string") failureError.cloudMsg = result.msg.slice(0, 200);
        throw failureError;
      }
      return isObject(result.data) ? result.data : {};
    },
    async downloadFile(fileId) {
      const id = nonEmptyText(fileId, "任务 fileId", 512);
      if (!id.startsWith("cloud://")) throw new WorkerInputError("FILE_ID_INVALID", "任务 fileId 不属于云存储");
      let response;
      try {
        response = await app.downloadFile({ fileID: id });
      } catch {
        throw new WorkerConfigError("CLOUD_DOWNLOAD_FAILED", "照片下载失败，未执行设备登记");
      }
      if (response?.code) throw new WorkerConfigError("CLOUD_DOWNLOAD_FAILED", "照片下载失败，未执行设备登记");
      const bytes = response?.fileContent;
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 200 * 1024) {
        throw new WorkerInputError("PHOTO_INVALID", "照片缺失或超过 200 KiB，未执行设备登记");
      }
      if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
        bytes.fill(0);
        throw new WorkerInputError("PHOTO_INVALID", "照片不是 JPEG，未执行设备登记");
      }
      return bytes;
    },
  };
}
