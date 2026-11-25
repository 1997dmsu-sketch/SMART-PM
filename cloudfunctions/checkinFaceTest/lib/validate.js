'use strict';

/**
 * Strict input and device-output validation for the check-in / face-enrollment
 * test path. Unknown fields are rejected (not ignored); server-owned facts are
 * never taken from a client payload.
 */

class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

/** Fields that must never be accepted from a client, even as extra keys. */
const CLIENT_FORBIDDEN_FIELDS = Object.freeze([
  'approved', 'testMode', 'mode', 'validityMode', 'roomNo', 'roomId', 'houseId',
  'doorNo', 'employeeNo', 'validFrom', 'validTo', 'status', 'openid',
  'workerTokenHash', 'configRevision', 'leaseRevision', 'roomRevision',
]);

const ACTION_FIELDS = Object.freeze({
  getConfig: ['action'],
  applyCheckin: ['action', 'applicationVersion'],
  createFaceTask: ['action', 'applicationId', 'fileId', 'consent'],
  getMyTask: ['action', 'applicationId'],
  claimTask: ['action', 'workerToken', 'workerId'],
  beginTaskExecution: ['action', 'workerToken', 'workerId', 'taskId', 'claimId', 'revision'],
  reportTask: ['action', 'workerToken', 'taskId', 'claimId', 'revision', 'exitCode', 'output'],
});

// Only these output keys may be reported back by the local worker. Device
// device connection material (endpoint, account, credentials, certificates,
// pins, keys) is never accepted into the cloud, let alone persisted.
const OUTPUT_ALLOWED_FIELDS = Object.freeze([
  'protocolVersion', 'outcome', 'mode', 'personnelId', 'employeeNo', 'name',
  'doorNo', 'validityMode', 'validFrom', 'validTo', 'dailyHours',
  'siteVerification', 'roomNote', 'device', 'enrollment', 'steps', 'error',
  'accessPlanFingerprint', 'accessPlanTemplateNo', 'accessPlanName',
  'faceSubmitted', 'faceModelingVerified', 'faceAssociationConfirmed',
  'createdAt', 'updatedAt',
]);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reject every field outside the whitelist; forbidden client fields get a
 * dedicated error code for diagnostics without echoing their values.
 */
function assertAllowedFields(input, allowedFields, label, checkForbidden = true) {
  if (!isPlainObject(input)) throw new ValidationError('INVALID_PAYLOAD', `${label}格式无效`);
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      const code = checkForbidden && CLIENT_FORBIDDEN_FIELDS.includes(key)
        ? 'CLIENT_FIELD_FORBIDDEN' : 'UNKNOWN_FIELD';
      throw new ValidationError(code, `${label}不允许字段 ${key}`);
    }
  }
  return input;
}

// 微信平台在真机 callFunction 时注入的保留字段：显式放行、忽略其内容、绝不读取。
const PLATFORM_EVENT_FIELDS = Object.freeze(['tcbContext']);

/** @param {'miniprogram'|'worker'} group */
function validateEvent(event, group) {
  if (!isPlainObject(event) || typeof event.action !== 'string') {
    throw new ValidationError('INVALID_ACTION', '请求缺少有效的 action');
  }
  const action = event.action;
  const fields = ACTION_FIELDS[action];
  if (!fields) throw new ValidationError('UNKNOWN_ACTION', '不支持的操作');
  const workerOwned = action === 'claimTask' || action === 'beginTaskExecution' || action === 'reportTask';
  if (group === 'worker' && !workerOwned) throw new ValidationError('ACTION_FORBIDDEN', '该操作不允许 worker 调用');
  if (group === 'miniprogram' && workerOwned) throw new ValidationError('ACTION_FORBIDDEN', '该操作不允许小程序调用');
  return assertAllowedFields(event, [...fields, ...PLATFORM_EVENT_FIELDS], '请求');
}

function validateText(value, pattern, code, maxLength = 128) {
  if (typeof value !== 'string' || value.length > maxLength || !pattern.test(value)) {
    throw new ValidationError(code, '参数格式不正确');
  }
  return value;
}

function validateApplicationVersion(value) {
  return validateText(value, /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'INVALID_VERSION');
}

function validateApplicationId(value) {
  return validateText(value, /^[A-Za-z0-9][A-Za-z0-9|._:-]{0,255}$/, 'INVALID_APPLICATION_ID', 256);
}

function validateWorkerId(value) {
  return validateText(value, /^[A-Za-z0-9_-]{1,64}$/, 'INVALID_WORKER_ID');
}

function validateConsent(value) {
  if (value !== true) throw new ValidationError('CONSENT_REQUIRED', '请确认本人照片用途');
  return true;
}

function validateToken(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 256) {
    throw new ValidationError('INVALID_WORKER_TOKEN', 'worker 凭据无效');
  }
  return value;
}

/**
 * Real-SDK fileID contract (R01). The single trusted namespace pattern is
 * shared with the admin configuration service so both ends validate the same
 * grammar. The admin page and server route require this exact definition.
 */
const STORAGE_NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FILE_ID_MAX_LENGTH = 512;
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,122}\.(jpe?g)$/i;

/**
 * Verify that a real SDK `cloud://<namespace>/<objectPath>` fileID belongs to
 * the trusted storage namespace and to the caller's own application, and that
 * the canonical object path is well-formed.
 *
 * Rejection classes:
 *  - not a string / empty / overlong / control chars / not cloud:// → INVALID_FILE_ID
 *    (a bare `test-face/…` path is no longer accepted);
 *  - namespace grammar mismatch or namespace !== trusted config → FILE_NAMESPACE_MISMATCH
 *    (cross-environment);
 *  - object path outside the server-issued prefix for this openid/applicationId
 *    → FILE_OWNERSHIP_MISMATCH (cross-user / cross-application);
 *  - malformed file name (separators, `..`, `%`, bad extension) → INVALID_FILE_ID;
 *  - server storageNamespace missing/ill-formed → STORAGE_NAMESPACE_UNCONFIGURED
 *    (fail closed).
 *
 * @param {string} fileId the unmodified fileID returned by wx.cloud.uploadFile.
 * @param {{environment:string,openid:string,applicationId:string,storageNamespace?:string}} ctx
 * @returns {{fileId:string,cloudPath:string,namespace:string,fileName:string}}
 */
function validateFileOwnership(fileId, { environment, openid, applicationId, storageNamespace }) {
  if (typeof fileId !== 'string' || !fileId || fileId.length > FILE_ID_MAX_LENGTH
    || /[\x00-\x1f\x7f\s]/.test(fileId)) {
    throw new ValidationError('INVALID_FILE_ID', '文件标识无效');
  }
  if (typeof storageNamespace !== 'string' || !storageNamespace
    || !STORAGE_NAMESPACE_PATTERN.test(storageNamespace)) {
    throw new ValidationError('STORAGE_NAMESPACE_UNCONFIGURED', '可信云存储命名空间未配置');
  }
  if (!fileId.startsWith('cloud://')) {
    throw new ValidationError('INVALID_FILE_ID', '文件标识不是云存储 fileID');
  }
  const rest = fileId.slice('cloud://'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) throw new ValidationError('INVALID_FILE_ID', '文件标识缺少对象路径');
  const namespace = rest.slice(0, slash);
  const objectPath = rest.slice(slash + 1);
  if (!STORAGE_NAMESPACE_PATTERN.test(namespace)) {
    throw new ValidationError('INVALID_FILE_ID', '文件标识命名空间无效');
  }
  if (namespace !== storageNamespace) {
    throw new ValidationError('FILE_NAMESPACE_MISMATCH', '文件不属于可信云存储命名空间');
  }
  if (!objectPath || objectPath.length > 384 || /[\x00-\x1f\x7f\s]/.test(objectPath)) {
    throw new ValidationError('INVALID_FILE_ID', '照片路径无效');
  }
  const prefix = `test-face/${environment}/${openid}/${applicationId}/`;
  if (!objectPath.startsWith(prefix)) {
    throw new ValidationError('FILE_OWNERSHIP_MISMATCH', '照片不属于本次申请');
  }
  const fileName = objectPath.slice(prefix.length);
  if (!FILE_NAME_PATTERN.test(fileName) || fileName.includes('..') || fileName.includes('%')) {
    throw new ValidationError('INVALID_FILE_ID', '照片路径无效');
  }
  return { fileId, cloudPath: objectPath, namespace, fileName };
}

/**
 * beginTaskExecution request validation (R06 server side). The whitelist
 * contains no approval flag and no new business targets: the worker can only
 * name the exact claim it received (taskId/claimId/revision + workerId).
 * revision must be >= 2 because a CLAIMED task has advanced at least once.
 */
function validateBeginTaskExecutionInput(input) {
  assertAllowedFields(input, ACTION_FIELDS.beginTaskExecution, '开始执行');
  const taskId = validateText(input.taskId, /^[A-Za-z0-9][A-Za-z0-9|._:-]{0,255}$/, 'INVALID_TASK_ID', 256);
  const claimId = validateText(input.claimId, /^[A-Za-z0-9-]{16,80}$/, 'INVALID_CLAIM_ID', 80);
  const workerId = validateWorkerId(input.workerId);
  if (!Number.isSafeInteger(input.revision) || input.revision < 2) {
    throw new ValidationError('INVALID_REVISION', '任务版本无效');
  }
  validateToken(input.workerToken);
  return { taskId, claimId, workerId, revision: input.revision };
}

function validateReportInput(input) {
  assertAllowedFields(input, ACTION_FIELDS.reportTask, '上报');
  const taskId = validateText(input.taskId, /^[A-Za-z0-9][A-Za-z0-9|._:-]{0,255}$/, 'INVALID_TASK_ID', 256);
  const claimId = validateText(input.claimId, /^[A-Za-z0-9-]{16,80}$/, 'INVALID_CLAIM_ID', 80);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new ValidationError('INVALID_REVISION', '任务版本无效');
  if (!Number.isSafeInteger(input.exitCode) || input.exitCode < 0 || input.exitCode > 9) {
    throw new ValidationError('INVALID_EXIT_CODE', '执行结果无效');
  }
  if (!isPlainObject(input.output)) throw new ValidationError('INVALID_OUTPUT', '执行输出无效');
  // Nested device facts may legitimately reuse names such as `mode` or
  // `status`; only the outer client payload is subject to the client ban.
  assertAllowedFields(input.output, OUTPUT_ALLOWED_FIELDS, '执行输出', false);
  if (input.output.enrollment !== undefined && input.output.enrollment !== null) {
    assertAllowedFields(input.output.enrollment, [
      'employeeNo', 'name', 'doorNo', 'validFrom', 'validTo', 'validityMode', 'mode',
      'status', 'faceSubmitted', 'faceModelingVerified', 'faceAssociationConfirmed',
      'accessPlanTemplateNo', 'accessPlanFingerprint', 'accessPlanName',
      'FDID', 'faceLibType', 'steps', 'createAttempted', 'faceAttempted',
      'createdAt', 'updatedAt',
    ], '登记详情', false);
  }
  validateToken(input.workerToken);
  return { taskId, claimId, revision: input.revision, exitCode: input.exitCode, output: input.output };
}

/** Extract only non-sensitive facts, also used for failure/uncertain results. */
function sanitizeOutputFacts(output) {
  if (!isPlainObject(output)) return {};
  const enrollment = isPlainObject(output.enrollment) ? output.enrollment : {};
  const facts = {};
  for (const key of ['outcome', 'mode', 'personnelId', 'doorNo', 'validityMode', 'validFrom', 'validTo', 'dailyHours', 'siteVerification']) {
    const value = output[key];
    if (typeof value === 'string' && value.length <= 128) facts[key] = value;
    else if (typeof value === 'number' && Number.isSafeInteger(value)) facts[key] = value;
  }
  for (const key of ['employeeNo', 'doorNo', 'validFrom', 'validTo', 'faceModelingVerified', 'faceAssociationConfirmed', 'accessPlanFingerprint', 'status']) {
    // The enrollment adapter nests these facts; accept a flattened worker
    // report too, but never let a top-level value override a nested one.
    const value = enrollment[key] !== undefined ? enrollment[key] : output[key];
    if (typeof value === 'string' && value.length <= 128) facts[key] = value;
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value))) facts[key] = value;
  }
  if (isPlainObject(output.error) && typeof output.error.code === 'string' && output.error.code.length <= 64) {
    facts.errorCode = output.error.code;
  }
  return facts;
}

function verifyStepState(output) {
  // The local worker keeps the step list inside enrollment; accept a flat
  // report as well without weakening the required verify.state==='success'.
  const steps = output.steps
    || (isPlainObject(output.enrollment) ? output.enrollment.steps : undefined);
  if (Array.isArray(steps)) {
    const verify = steps.find((step) => isPlainObject(step) && step.key === 'verify');
    return !!verify && verify.state === 'success';
  }
  return isPlainObject(steps) && isPlainObject(steps.verify) && steps.verify.state === 'success';
}

/**
 * Confirm a successful device report item-by-item against the server snapshot.
 * @returns {{verified:boolean,code:string,facts:object}}
 */
function verifyDeviceOutput(output, snapshot) {
  const facts = sanitizeOutputFacts(output);
  if (!isPlainObject(snapshot)) return { verified: false, code: 'SNAPSHOT_MISSING', facts };
  if (output.mode !== 'device' || facts.mode !== 'device') return { verified: false, code: 'MODE_MISMATCH', facts };
  if (output.validityMode !== 'fixed' || facts.validityMode !== 'fixed') {
    return { verified: false, code: 'VALIDITY_MISMATCH', facts };
  }
  if (output.outcome !== 'device-enrollment-confirmed-pending-site') {
    return { verified: false, code: 'OUTCOME_NOT_CONFIRMED', facts };
  }
  const employeeNo = output.employeeNo ?? output.personnelId;
  if (typeof employeeNo !== 'string' || employeeNo !== snapshot.employeeNo) {
    return { verified: false, code: 'EMPLOYEE_NO_MISMATCH', facts };
  }
  const doorNo = output.doorNo ?? facts.doorNo;
  if (!Number.isSafeInteger(doorNo) || doorNo !== snapshot.doorNo) {
    return { verified: false, code: 'DOOR_MISMATCH', facts };
  }
  if (facts.validFrom !== snapshot.validFrom || facts.validTo !== snapshot.validTo) {
    return { verified: false, code: 'DATE_MISMATCH', facts };
  }
  if (facts.accessPlanFingerprint !== snapshot.accessPlanFingerprint || !/^[a-f0-9]{64}$/i.test(String(snapshot.accessPlanFingerprint || ''))) {
    return { verified: false, code: 'PLAN_FINGERPRINT_MISMATCH', facts };
  }
  if (facts.faceAssociationConfirmed !== true) {
    return { verified: false, code: 'FACE_ASSOCIATION_UNCONFIRMED', facts };
  }
  if (!verifyStepState(output)) return { verified: false, code: 'VERIFY_STEP_INCOMPLETE', facts };
  if (output.dailyHours !== undefined && output.dailyHours !== snapshot.dailyHours) {
    return { verified: false, code: 'DAILY_HOURS_MISMATCH', facts };
  }
  return { verified: true, code: '', facts };
}

module.exports = {
  ValidationError,
  CLIENT_FORBIDDEN_FIELDS,
  ACTION_FIELDS,
  OUTPUT_ALLOWED_FIELDS,
  STORAGE_NAMESPACE_PATTERN,
  FILE_ID_MAX_LENGTH,
  FILE_NAME_PATTERN,
  isPlainObject,
  assertAllowedFields,
  validateEvent,
  validateApplicationVersion,
  validateApplicationId,
  validateWorkerId,
  validateConsent,
  validateToken,
  validateFileOwnership,
  validateBeginTaskExecutionInput,
  validateReportInput,
  sanitizeOutputFacts,
  verifyDeviceOutput,
};
