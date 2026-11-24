/**
 * worker 专用业务服务适配层（R08）：以受控内存照片直接驱动既有 FaceEnrollmentService，
 * 不在本机落盘任何照片文件。装配语义与 admin-web/lib/face-enrollment-command.mjs 的
 * runFaceEnrollment 保持一致（本适配层为新增 worker 专用业务服务，需交 Codex 内容复审）：
 *
 *   - 显式 mode=device / validityMode=fixed / consent=true（worker 构造入参已强制，本层再校验）；
 *   - 公开证书受限读取（单句柄、元数据快照前后一致、≤64 KiB、普通本地文件）；
 *   - 构造参数校验（仅解析证书与地址，不建 socket）→ 连接设备 describe → 型号核对 →
 *     唯一人脸库选择（含门号能力范围）→ service.enroll（内存 photoBase64；服务内部
 *     grantAccess 会再次核对设备全天计划模板与指纹——执行前指纹核验保留）→
 *     返回行白名单校验（employeeNo/name/doorNo/FDID/faceLibType/fixed 起止/全天计划指纹/建模状态）；
 *   - 未知/异常收敛为 exitCode 5 stopped；连接清理失败 → CLEANUP_FAILED（保留已确认设备事实）；
 *   - 内存照片与证书副本在返回前 fill(0)；不承诺字符串副本或进程内存的安全擦除效果。
 *
 * 差异说明：worker 链路人员编号必须由云任务显式下发，本适配层不自动生成编号（旧命令交互路径
 * 的自动编号不在 worker 链路）；photoPath 由受控内存 Buffer 取代，其余装配语义不降级。
 * 不改旧三个核心模块（face-enrollment-command.mjs / face-enrollment.mjs / hikvision-client.mjs）
 * 与 PowerShell 启动器。
 */

import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { FaceEnrollmentService, FACE_PHOTO_LIMIT, decodeFacePhoto } from "../../admin-web/lib/face-enrollment.mjs";
import { HikvisionClient } from "../../admin-web/lib/hikvision-client.mjs";
import { HttpError } from "../../admin-web/lib/model.mjs";

const CERTIFICATE_LIMIT = 64 * 1024;
const steps = { person: "建人", face: "上传人脸", access: "授权门", verify: "查询确认" };
const stoppedMessage = "设备登记未完成，请检查设备当前状态；不要自动重试。";

class AdapterError extends Error {
  constructor(code, message, exitCode = 2, requiresInspection = false) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
    this.exitCode = exitCode;
    this.requiresInspection = requiresInspection;
  }
}

function invalidInput() {
  throw new AdapterError("COMMAND_INPUT_INVALID", "请提供单个人员的完整参数，并明确确认本人及照片已获授权。");
}

function text(value, maxBytes, { path = false } = {}) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > maxBytes || /[\x00-\x1f\x7f]/.test(value)) invalidInput();
  if (!path && /[\\/]/.test(value)) invalidInput();
  // 空白可能指向另一个本地文件；绝不静默选择该文件。
  return path ? value : value.trim();
}

function localPath(path) {
  const absolute = resolve(path);
  if (/^[\\/]{2}/.test(path) || /^[\\/]{2}/.test(absolute) || /^\\\?\?\\/.test(path)) throw new Error();
  return absolute;
}

/** 与旧命令 readInputFile 同语义：单句柄读取，元数据快照前后一致，大小超限或文件变化即失败。 */
async function readBoundedFile(path, { maxBytes }) {
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

function normalizeInput(input, platform) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalidInput();
  const mode = input.mode === undefined ? "simulation" : input.mode;
  if (!["simulation", "device"].includes(mode) || input.consent !== true) invalidInput();
  if (mode === "device" && platform !== "win32") throw new AdapterError("LOCAL_WINDOWS_REQUIRED", "现场设备登记仅支持本机 Windows 执行。");
  const name = text(input.name, 128), room = text(input.room, 128);
  const doorNo = input.doorNo === undefined ? 1 : input.doorNo;
  if (!Number.isSafeInteger(doorNo) || doorNo < 1 || doorNo > 65535) invalidInput();
  // worker 链路有效期必须显式下发 fixed 并按租期起止；缺省即拒绝，不回落旧 unlimited 默认。
  const validityMode = input.validityMode;
  if (validityMode !== "fixed") invalidInput();
  const validFrom = validityMode === "fixed" ? text(input.validFrom, 64) : undefined;
  const validTo = validityMode === "fixed" ? text(input.validTo, 64) : undefined;
  // worker 链路编号必须显式下发；缺省即拒绝，不自动生成（不换号、不自造）。
  const employeeNo = input.employeeNo;
  if (typeof employeeNo !== "string" || !/^[A-Za-z0-9]{1,32}$/.test(employeeNo)) invalidInput();
  const accessPlanFingerprint = input.accessPlanFingerprint;
  if (typeof accessPlanFingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(accessPlanFingerprint)) invalidInput();
  const hasLibrary = input.FDID !== undefined || input.faceLibType !== undefined;
  const FDID = hasLibrary ? text(input.FDID, 128) : undefined;
  const faceLibType = hasLibrary ? text(input.faceLibType, 64) : undefined;
  let connection;
  if (mode === "device") {
    if (typeof input.username !== "string" || !input.username || typeof input.password !== "string" || !input.password) invalidInput();
    const origin = text(input.origin, 2048, { path: true });
    let certificatePath = text(input.certificatePath, 4096, { path: true });
    try { certificatePath = localPath(certificatePath); } catch { throw new AdapterError("CERTIFICATE_FILE_INVALID", "公开证书必须位于本机普通文件路径。"); }
    const developmentTls = input.developmentTls === undefined ? false : input.developmentTls;
    const planTemplateNo = input.planTemplateNo === undefined ? "1" : input.planTemplateNo;
    if (typeof developmentTls !== "boolean" || typeof planTemplateNo !== "string" || !/^[1-9]\d{0,9}$/.test(planTemplateNo)) invalidInput();
    const expectedModel = text(input.expectedModel === undefined ? "DS-K1T671BM" : input.expectedModel, 128);
    connection = { origin, username: input.username, password: input.password, certificatePath, developmentTls, planTemplateNo, expectedModel };
  }
  return { mode, name, room, employeeNo, doorNo, validityMode, validFrom, validTo, accessPlanFingerprint, FDID, faceLibType, connection };
}

function selectLibrary(capabilities, input) {
  const libraries = Array.isArray(capabilities?.libraries) ? capabilities.libraries : [];
  const candidates = libraries.filter(library => library && typeof library.FDID === "string" && typeof library.faceLibType === "string"
    && (input.FDID === undefined ? library.faceLibType === "blackFD" : library.FDID === input.FDID && library.faceLibType === input.faceLibType));
  if (candidates.length !== 1 || !/^[A-Za-z0-9_.:-]{1,128}$/.test(candidates[0].FDID) || !/^[A-Za-z0-9_-]{1,64}$/.test(candidates[0].faceLibType))
    throw new AdapterError("LIBRARY_SELECTION_REQUIRED", "请明确选择设备返回的唯一人脸库。");
  if (!Array.isArray(capabilities.doorNumbers) || !capabilities.doorNumbers.includes(input.doorNo))
    throw new AdapterError("DOOR_NOT_SUPPORTED", "所选门编号不在设备返回的能力范围内。");
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
  const invalidResponse = () => { throw new AdapterError("INVALID_SERVICE_RESPONSE", stoppedMessage, 5, true); };
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

/**
 * 以内存照片执行一次登记；无业务重试、无远程开门、不删除设备残留。
 * deps：{ photoBuffer: Buffer（JPEG，≤200 KiB）, createService?, readBoundedFile?,
 *         commandDeps?: { platform } }。
 */
export async function runInMemoryEnrollment(request, deps = {}) {
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
    const read = deps.readBoundedFile || readBoundedFile;
    const platform = deps.commandDeps?.platform === undefined ? process.platform : deps.commandDeps.platform;
    if (typeof createService !== "function" || typeof read !== "function") throw new AdapterError("COMMAND_FAILED", "命令依赖配置无效。", 5);
    if (typeof platform !== "string") throw new AdapterError("COMMAND_FAILED", "命令依赖配置无效。", 5);
    normalized = normalizeInput(request, platform);
    Object.assign(context, { mode: normalized.mode, personnelId: normalized.employeeNo, roomNote: normalized.room, validityMode: normalized.validityMode,
      siteVerification: normalized.mode === "device" ? "PENDING" : "NOT_APPLICABLE" });
    phase = "photo";
    const source = deps.photoBuffer;
    if (!Buffer.isBuffer(source) || !source.length || source.length > FACE_PHOTO_LIMIT) {
      throw new AdapterError("PHOTO_INVALID", "照片缺失或超过 200 KiB，未执行设备登记。");
    }
    photo = decodeFacePhoto(source.toString("base64"));
    phase = "certificate";
    certificate = await read(normalized.connection.certificatePath, { maxBytes: CERTIFICATE_LIMIT });
    if (!Buffer.isBuffer(certificate) || !certificate.length || certificate.length > CERTIFICATE_LIMIT) throw new Error();
    phase = "configuration";
    // 构造参数校验只解析公开证书与地址，不打开任何 socket；真实连接归业务服务所有。
    const validationClient = new HikvisionClient({ ...normalized.connection, certificate });
    validationClient.close();
    phase = "connect";
    service = await createService();
    const state = await service.connect(normalized.mode === "device"
      ? { mode: "device", origin: normalized.connection.origin, username: normalized.connection.username, password: normalized.connection.password,
        certificate, developmentTls: normalized.connection.developmentTls, planTemplateNo: normalized.connection.planTemplateNo }
      : { mode: "simulation" });
    context.device = safeDevice(state?.device, [normalized.connection?.username, normalized.connection?.password]);
    if (normalized.mode === "device" && state?.device?.model !== normalized.connection.expectedModel)
      throw new AdapterError("DEVICE_MODEL_MISMATCH", "设备型号与本次明确目标不一致，未开始业务写入。", 5);
    const library = selectLibrary(state?.capabilities, normalized);
    // Bind the authoritative cloud authorization to the device plan before the
    // service can create a person, submit a face, or grant door access. The
    // service's own later plan recheck remains in force for subsequent changes.
    const actualPlan = state?.capabilities?.allDayPlan;
    if (typeof actualPlan?.fingerprint !== "string" || actualPlan.fingerprint !== normalized.accessPlanFingerprint) {
      throw new AdapterError("ACCESS_PLAN_MISMATCH", "设备每天24小时计划与获准任务不一致，未开始业务写入。", 5);
    }
    phase = "enroll";
    enrollmentStarted = true;
    const row = await service.enroll({
      employeeNo: normalized.employeeNo, name: normalized.name, doorNo: normalized.doorNo, ...library,
      validityMode: normalized.validityMode, ...(normalized.validityMode === "fixed" ? { validFrom: normalized.validFrom, validTo: normalized.validTo } : {}),
      photoBase64: photo.toString("base64"), consent: true,
    });
    context.enrollment = safeEnrollment(row, normalized, library);
    result = row.status === "failed"
      ? failure(new AdapterError("ENROLLMENT_FAILED", stoppedMessage, 4, normalized.mode === "device"))
      : { exitCode: 0, output: { ...context, outcome: normalized.mode === "device" ? "device-enrollment-confirmed-pending-site" : "simulation-completed" } };
  } catch (error) {
    if (error instanceof AdapterError) result = failure(error);
    else if (phase === "photo") result = failure(new AdapterError("PHOTO_INVALID", "照片必须是未超过 200 KiB 的有效 JPEG。"));
    else if (phase === "certificate") result = failure(new AdapterError("CERTIFICATE_FILE_INVALID", "公开证书必须是未变化的普通文件，且不超过64 KiB。"));
    else if (phase === "configuration") result = failure(new AdapterError("DEVICE_CONFIGURATION_INVALID", "设备地址、连接参数或公开证书无效。"));
    else if (phase === "enroll" && error instanceof HttpError && error.status === 400)
      result = failure(new AdapterError("ENROLLMENT_INPUT_INVALID", "人员参数未通过设备能力校验，未开始业务写入。"));
    else if (enrollmentStarted) result = failure(new AdapterError("ENROLLMENT_STATE_UNCERTAIN", stoppedMessage, 5, normalized?.mode === "device"));
    else result = failure(new AdapterError(phase === "connect" ? "DEVICE_CONNECTION_FAILED" : "COMMAND_FAILED", "执行已停止，未自动重试。", 5));
  } finally {
    let closeFailed = false;
    try { await service?.close(); }
    catch { closeFailed = true; }
    if (Buffer.isBuffer(photo)) photo.fill(0);
    if (Buffer.isBuffer(certificate)) certificate.fill(0);
    if (normalized?.connection) { normalized.connection.username = undefined; normalized.connection.password = undefined; }
    // R09：连接清理失败进入真实终态（保留已确认的设备事实），不报告干净完成。
    if (closeFailed) result = failure(new AdapterError("CLEANUP_FAILED", stoppedMessage, 5, enrollmentStarted && normalized?.mode === "device"));
  }
  return result;
}
