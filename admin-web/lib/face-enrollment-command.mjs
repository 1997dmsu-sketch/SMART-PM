import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { randomBytes as secureRandomBytes } from "node:crypto";
import { resolve } from "node:path";
import { FaceEnrollmentService, FACE_PHOTO_LIMIT, decodeFacePhoto } from "./face-enrollment.mjs";
import { HikvisionClient } from "./hikvision-client.mjs";
import { HttpError } from "./model.mjs";

const CERTIFICATE_LIMIT = 64 * 1024;
const steps = { person: "建人", face: "上传人脸", access: "授权门", verify: "查询确认" };
const stoppedMessage = "设备登记未完成，请检查设备当前状态；不要自动重试。";

class CommandError extends Error {
  constructor(code, message, exitCode = 2, requiresInspection = false) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.requiresInspection = requiresInspection;
  }
}

function invalidInput() {
  throw new CommandError("COMMAND_INPUT_INVALID", "请提供单个人员的完整参数，并明确确认本人及照片已获授权。");
}

function text(value, maxBytes, { path = false } = {}) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > maxBytes || /[\x00-\x1f\x7f]/.test(value)) invalidInput();
  if (!path && /[\\/]/.test(value)) invalidInput();
  // Whitespace can name a different local file; never silently select that file.
  return path ? value : value.trim();
}

function localPath(path) {
  const absolute = resolve(path);
  if (/^[\\/]{2}/.test(path) || /^[\\/]{2}/.test(absolute) || /^\\\?\?\\/.test(path)) throw new Error();
  return absolute;
}

// A single opened handle supplies both metadata snapshots and all bytes. A
// bounded extra byte detects growth without ever reading an unbounded file.
async function readInputFile(path, { maxBytes }) {
  let handle, bytes, success = false;
  try {
    handle = await open(localPath(path), constants.O_RDONLY | (constants.O_NONBLOCK || 0));
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(maxBytes)) throw new Error();
    const size = Number(before.size);
    bytes = Buffer.alloc(size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!after.isFile() || length !== size || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error();
    await handle.close();
    handle = undefined;
    success = true;
    return bytes.subarray(0, size);
  } finally {
    if (!success) bytes?.fill(0);
    await handle?.close();
  }
}

function normalizeInput(input, now, randomBytes, platform) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalidInput();
  const mode = input.mode === undefined ? "simulation" : input.mode;
  if (!["simulation", "device"].includes(mode) || input.consent !== true) invalidInput();
  if (mode === "device" && platform !== "win32") throw new CommandError("LOCAL_WINDOWS_REQUIRED", "现场设备登记仅支持本机 Windows 执行。");
  const name = text(input.name, 128), room = text(input.room, 128);
  let photoPath = text(input.photoPath, 4096, { path: true });
  try { photoPath = localPath(photoPath); } catch { throw new CommandError("PHOTO_FILE_INVALID", "照片必须位于本机普通文件路径。"); }
  const doorNo = input.doorNo === undefined ? 1 : input.doorNo;
  if (!Number.isSafeInteger(doorNo) || doorNo < 1 || doorNo > 65535) invalidInput();
  const validityMode = input.validityMode === undefined ? "unlimited" : input.validityMode;
  if (!["fixed", "unlimited"].includes(validityMode)) invalidInput();
  const validFrom = validityMode === "fixed" ? text(input.validFrom, 64) : undefined;
  const validTo = validityMode === "fixed" ? text(input.validTo, 64) : undefined;
  let employeeNo = input.employeeNo;
  if (employeeNo === undefined) {
    const date = now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new CommandError("COMMAND_FAILED", "无法生成本次人员编号。", 5);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const datePart = ["year", "month", "day"].map(key => parts.find(part => part.type === key)?.value).join("");
    const random = randomBytes(7);
    if (!Buffer.isBuffer(random) || random.length !== 7 || !/^\d{8}$/.test(datePart)) throw new CommandError("COMMAND_FAILED", "无法生成本次人员编号。", 5);
    employeeNo = `F${room.replace(/[^A-Za-z0-9]/g, "").slice(0, 8)}${datePart}${random.toString("hex")}`;
  }
  if (typeof employeeNo !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(employeeNo)) invalidInput();
  if (mode === "device" && !/^[A-Za-z0-9]{1,32}$/.test(employeeNo)) invalidInput();
  const hasLibrary = input.FDID !== undefined || input.faceLibType !== undefined;
  const FDID = hasLibrary ? text(input.FDID, 128) : undefined;
  const faceLibType = hasLibrary ? text(input.faceLibType, 64) : undefined;
  let connection;
  if (mode === "device") {
    if (typeof input.username !== "string" || !input.username || typeof input.password !== "string" || !input.password) invalidInput();
    const origin = text(input.origin, 2048, { path: true });
    let certificatePath = text(input.certificatePath, 4096, { path: true });
    try { certificatePath = localPath(certificatePath); } catch { throw new CommandError("CERTIFICATE_FILE_INVALID", "公开证书必须位于本机普通文件路径。"); }
    const developmentTls = input.developmentTls === undefined ? false : input.developmentTls;
    const planTemplateNo = input.planTemplateNo === undefined ? "1" : input.planTemplateNo;
    if (typeof developmentTls !== "boolean" || typeof planTemplateNo !== "string" || !/^[1-9]\d{0,9}$/.test(planTemplateNo)) invalidInput();
    const expectedModel = text(input.expectedModel === undefined ? "DS-K1T671BM" : input.expectedModel, 128);
    connection = { origin, username: input.username, password: input.password, certificatePath, developmentTls, planTemplateNo, expectedModel };
  }
  return { mode, name, room, employeeNo, photoPath, doorNo, validityMode, validFrom, validTo, FDID, faceLibType, connection };
}

function selectLibrary(capabilities, input) {
  const libraries = Array.isArray(capabilities?.libraries) ? capabilities.libraries : [];
  const candidates = libraries.filter(library => library && typeof library.FDID === "string" && typeof library.faceLibType === "string"
    && (input.FDID === undefined ? library.faceLibType === "blackFD" : library.FDID === input.FDID && library.faceLibType === input.faceLibType));
  if (candidates.length !== 1 || !/^[A-Za-z0-9_.:-]{1,128}$/.test(candidates[0].FDID) || !/^[A-Za-z0-9_-]{1,64}$/.test(candidates[0].faceLibType))
    throw new CommandError("LIBRARY_SELECTION_REQUIRED", "请明确选择设备返回的唯一人脸库。");
  if (!Array.isArray(capabilities.doorNumbers) || !capabilities.doorNumbers.includes(input.doorNo))
    throw new CommandError("DOOR_NOT_SUPPORTED", "所选门编号不在设备返回的能力范围内。");
  return { FDID: candidates[0].FDID, faceLibType: candidates[0].faceLibType };
}

function safeDevice(device, sensitive) {
  const output = {};
  for (const key of ["model", "firmware"]) {
    const value = device?.[key];
    if (typeof value === "string" && value.length <= 128 && /^[\p{L}\p{N} ._()+-]*$/u.test(value) && !sensitive.some(secret => secret && value.includes(secret))) output[key] = value;
  }
  return output;
}

function safeEnrollment(row, input, library) {
  const invalidResponse = () => { throw new CommandError("INVALID_SERVICE_RESPONSE", stoppedMessage, 5, true); };
  if (!row || typeof row !== "object" || Array.isArray(row) || !["ready", "pending-site", "failed"].includes(row.status)) invalidResponse();
  const expected = { employeeNo: input.employeeNo, name: input.name, mode: input.mode, doorNo: input.doorNo, FDID: library.FDID, faceLibType: library.faceLibType, validityMode: input.validityMode };
  if (!Object.entries(expected).every(([key, value]) => row[key] === value)) invalidResponse();
  const rowSteps = Array.isArray(row.steps) ? row.steps : [];
  if (row.status !== "failed" && (rowSteps.length !== 4 || !Object.keys(steps).every(key => rowSteps.filter(step => step?.key === key && step.state === "success").length === 1)
    || row.faceSubmitted !== true || row.faceAssociationConfirmed !== true
    || typeof row.accessPlanTemplateNo !== "string" || !/^[1-9]\d{0,9}$/.test(row.accessPlanTemplateNo)
    || typeof row.accessPlanFingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(row.accessPlanFingerprint))) invalidResponse();
  if (row.status !== "failed") {
    if (row.faceModelingVerified !== (row.status === "ready")) invalidResponse();
    if (input.validityMode === "fixed") {
      const validFrom = input.validFrom.length === 16 ? `${input.validFrom}:00` : input.validFrom;
      const validTo = input.validTo.length === 16 ? `${input.validTo}:00` : input.validTo;
      if (row.validFrom !== validFrom || row.validTo !== validTo) invalidResponse();
    }
  }
  const output = { employeeNo: input.employeeNo, name: input.name, doorNo: input.doorNo, ...library, validityMode: input.validityMode, mode: input.mode, status: row.status };
  if (typeof row.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(row.id)) output.id = row.id;
  for (const key of ["validFrom", "validTo"]) if (typeof row[key] === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(row[key])) output[key] = row[key];
  for (const key of ["createAttempted", "faceAttempted", "faceSubmitted", "faceModelingVerified", "faceAssociationConfirmed"]) if (typeof row[key] === "boolean") output[key] = row[key];
  for (const key of ["createdAt", "updatedAt"]) if (Number.isSafeInteger(row[key]) && row[key] >= 0) output[key] = row[key];
  if (typeof row.accessPlanTemplateNo === "string" && /^[1-9]\d{0,9}$/.test(row.accessPlanTemplateNo)) output.accessPlanTemplateNo = row.accessPlanTemplateNo;
  if (typeof row.accessPlanFingerprint === "string" && /^[a-f0-9]{64}$/i.test(row.accessPlanFingerprint)) output.accessPlanFingerprint = row.accessPlanFingerprint;
  if (output.accessPlanTemplateNo && output.accessPlanFingerprint) output.accessPlanName = "每天24小时";
  output.steps = Object.entries(steps).map(([key, label]) => {
    const source = rowSteps.find(step => step?.key === key);
    const state = ["pending", "running", "success", "failed"].includes(source?.state) ? source.state : "pending";
    let message = "";
    if (state === "failed") message = stoppedMessage;
    else if (state === "success") message = {
      person: "人员记录已建立", face: "照片已提交设备", access: "门权限及每天24小时计划已提交",
      verify: row.status === "ready" ? "人员、人脸建模和门权限已查询确认，待现场刷脸" : "人员、门权限和人脸关联已确认，建模状态需现场核验",
    }[key];
    return { key, label, state, message };
  });
  if (row.status === "failed") output.error = stoppedMessage;
  return output;
}

/** Run exactly one enrollment; no business retry or remote-open operation. */
export async function runFaceEnrollment(input, deps = {}) {
  const context = { protocolVersion: 1, mode: "simulation", personnelId: null, roomNote: null, validityMode: "unlimited", dailyHours: "24x7", siteVerification: "NOT_APPLICABLE", device: null, enrollment: null };
  let normalized, service, photo, certificate, result;
  let phase = "input", enrollmentStarted = false;
  const failure = error => ({
    exitCode: error.exitCode,
    output: { ...context, outcome: error.exitCode === 2 ? "invalid-input" : error.exitCode === 4 ? "failed" : "stopped",
      error: { code: error.code, message: error.message, requiresInspection: error.requiresInspection } },
  });
  try {
    const createService = deps.createService || (() => new FaceEnrollmentService());
    const read = deps.readInputFile || readInputFile;
    const now = deps.now || (() => new Date());
    const randomBytes = deps.randomBytes || secureRandomBytes;
    const platform = deps.platform === undefined ? process.platform : deps.platform;
    if (![createService, read, now, randomBytes].every(value => typeof value === "function")) throw new CommandError("COMMAND_FAILED", "命令依赖配置无效。", 5);
    if (typeof platform !== "string") throw new CommandError("COMMAND_FAILED", "命令依赖配置无效。", 5);
    normalized = normalizeInput(input, now, randomBytes, platform);
    Object.assign(context, { mode: normalized.mode, personnelId: normalized.employeeNo, roomNote: normalized.room, validityMode: normalized.validityMode,
      siteVerification: normalized.mode === "device" ? "PENDING" : "NOT_APPLICABLE" });
    phase = "photo";
    photo = await read(normalized.photoPath, { maxBytes: FACE_PHOTO_LIMIT, kind: "photo" });
    if (!Buffer.isBuffer(photo) || !photo.length || photo.length > FACE_PHOTO_LIMIT) throw new Error();
    const validated = decodeFacePhoto(photo.toString("base64"));
    validated.fill(0);
    if (normalized.mode === "device") {
      phase = "certificate";
      certificate = await read(normalized.connection.certificatePath, { maxBytes: CERTIFICATE_LIMIT, kind: "certificate" });
      if (!Buffer.isBuffer(certificate) || !certificate.length || certificate.length > CERTIFICATE_LIMIT) throw new Error();
      phase = "configuration";
      // Constructor validation parses the public certificate and origin without
      // opening any socket. The real service owns the eventual connection.
      const validationClient = new HikvisionClient({ ...normalized.connection, certificate });
      validationClient.close();
    }
    phase = "connect";
    service = await createService();
    const state = await service.connect(normalized.mode === "device"
      ? { mode: "device", origin: normalized.connection.origin, username: normalized.connection.username, password: normalized.connection.password,
        certificate, developmentTls: normalized.connection.developmentTls, planTemplateNo: normalized.connection.planTemplateNo }
      : { mode: "simulation" });
    context.device = safeDevice(state?.device, [normalized.connection?.username, normalized.connection?.password]);
    if (normalized.mode === "device" && state?.device?.model !== normalized.connection.expectedModel)
      throw new CommandError("DEVICE_MODEL_MISMATCH", "设备型号与本次明确目标不一致，未开始业务写入。", 5);
    const library = selectLibrary(state?.capabilities, normalized);
    phase = "enroll";
    enrollmentStarted = true;
    const row = await service.enroll({
      employeeNo: normalized.employeeNo, name: normalized.name, doorNo: normalized.doorNo, ...library,
      validityMode: normalized.validityMode, ...(normalized.validityMode === "fixed" ? { validFrom: normalized.validFrom, validTo: normalized.validTo } : {}),
      photoBase64: photo.toString("base64"), consent: true,
    });
    context.enrollment = safeEnrollment(row, normalized, library);
    result = row.status === "failed"
      ? failure(new CommandError("ENROLLMENT_FAILED", stoppedMessage, 4, normalized.mode === "device"))
      : { exitCode: 0, output: { ...context, outcome: normalized.mode === "device" ? "device-enrollment-confirmed-pending-site" : "simulation-completed" } };
  } catch (error) {
    if (error instanceof CommandError) result = failure(error);
    else if (phase === "photo") result = failure(new CommandError("PHOTO_FILE_INVALID", "照片必须是未变化的普通 JPEG 文件，且不超过200 KiB。"));
    else if (phase === "certificate") result = failure(new CommandError("CERTIFICATE_FILE_INVALID", "公开证书必须是未变化的普通文件，且不超过64 KiB。"));
    else if (phase === "configuration") result = failure(new CommandError("DEVICE_CONFIGURATION_INVALID", "设备地址、连接参数或公开证书无效。"));
    else if (phase === "enroll" && error instanceof HttpError && error.status === 400)
      result = failure(new CommandError("ENROLLMENT_INPUT_INVALID", "人员参数未通过设备能力校验，未开始业务写入。"));
    else if (enrollmentStarted) result = failure(new CommandError("ENROLLMENT_STATE_UNCERTAIN", stoppedMessage, 5, normalized?.mode === "device"));
    else result = failure(new CommandError(phase === "connect" ? "DEVICE_CONNECTION_FAILED" : "COMMAND_FAILED", "执行已停止，未自动重试。", 5));
  } finally {
    try { await service?.close(); }
    catch { result = failure(new CommandError("CLEANUP_FAILED", stoppedMessage, 5, enrollmentStarted && normalized?.mode === "device")); }
    if (Buffer.isBuffer(photo)) photo.fill(0);
    if (Buffer.isBuffer(certificate)) certificate.fill(0);
    if (normalized?.connection) { normalized.connection.username = undefined; normalized.connection.password = undefined; }
  }
  return result;
}
