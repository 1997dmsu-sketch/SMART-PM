'use strict';

/**
 * State machine, idempotency and dispatch for the isolated test path.
 *
 * PHOTO_RECEIVED -> QUEUED_FOR_DISPATCH -> CLAIMED -> DEVICE_PROCESSING
 *   -> DEVICE_CONFIRMED -> PENDING_SITE_VERIFICATION
 * Exit branches: FAILED_REVIEW / UNKNOWN_RESULT / INVALIDATED. There is no
 * requeue action and no automatic resend; employeeNo is never rotated.
 *
 * Atomicity (R03/R04): every path that writes a task or application state
 * runs inside a real transaction whose authoritative gate is re-read from
 * the transaction context (point reads only). The business write and its
 * audit entry share the same transaction, so a failed commit rolls back both.
 * Task creation is create-only inside the transaction; a late creator can
 * never reset a claim or a terminal state. beginTaskExecution (R06) performs
 * the fresh pre-execution revalidation and advances CLAIMED ->
 * DEVICE_PROCESSING with revision + 1 exactly, never extending the claim.
 */

const { randomUUID } = require('node:crypto');
const { ids, COLLECTIONS, createStore } = require('./store');
const dates = require('./dates');
const validate = require('./validate');
const { sha256Hex } = require('./context');
const configGate = require('./config');

const STATUS = Object.freeze({
  PHOTO_RECEIVED: 'PHOTO_RECEIVED',
  QUEUED_FOR_DISPATCH: 'QUEUED_FOR_DISPATCH',
  CLAIMED: 'CLAIMED',
  DEVICE_PROCESSING: 'DEVICE_PROCESSING',
  DEVICE_CONFIRMED: 'DEVICE_CONFIRMED',
  PENDING_SITE_VERIFICATION: 'PENDING_SITE_VERIFICATION',
  FAILED_REVIEW: 'FAILED_REVIEW',
  UNKNOWN_RESULT: 'UNKNOWN_RESULT',
  INVALIDATED: 'INVALIDATED',
  NOT_FOUND: 'NOT_FOUND',
});

const DISPLAY_STATE = Object.freeze({
  PHOTO_RECEIVED: '照片已收件',
  QUEUED_FOR_DISPATCH: '等待下发',
  CLAIMED: '等待下发',
  DEVICE_PROCESSING: '设备处理中',
  DEVICE_CONFIRMED: '设备查询已确认',
  PENDING_SITE_VERIFICATION: '待现场刷脸验证',
  FAILED_REVIEW: '失败待核查',
  UNKNOWN_RESULT: '结果待核查',
  INVALIDATED: '已失效待核查',
  NOT_FOUND: '尚未上传照片',
});

const TERMINAL_STATUSES = Object.freeze([
  STATUS.PENDING_SITE_VERIFICATION, STATUS.DEVICE_CONFIRMED,
  STATUS.FAILED_REVIEW, STATUS.UNKNOWN_RESULT, STATUS.INVALIDATED,
]);
const CLAIM_TTL_MS = 10 * 60 * 1000;
const PHOTO_LIMIT_BYTES = 200 * 1024;

function error(code, message) {
  throw new configGate.WorkflowError(code, message);
}

// Bind idempotence to the complete validated report, including verify steps.
// Object property order is not a distinct report; array order remains factual.
function canonicalReportValue(value) {
  if (Array.isArray(value)) return value.map(canonicalReportValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalReportValue(value[key])]));
  }
  return value;
}

function hasJpegHeader(buffer) {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

/** Server-side photo check using wx.cloud.downloadFile when available. */
async function checkPhoto(cloud, fileId) {
  if (!cloud || typeof cloud.downloadFile !== 'function') return;
  let response;
  try { response = await cloud.downloadFile({ fileID: fileId }); }
  catch { error('PHOTO_INVALID', '照片读取失败，请重新上传'); }
  const raw = response && (response.fileContent || response.buffer || response.data);
  if (!raw) error('PHOTO_INVALID', '照片读取失败，请重新上传');
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (!buffer.length || buffer.length > PHOTO_LIMIT_BYTES || !hasJpegHeader(buffer)) {
    error('PHOTO_INVALID', '照片必须是未超过 200 KiB 的 JPEG');
  }
}

function applicationView(doc) {
  if (!doc) return null;
  return {
    applicationId: doc._id,
    result: doc.result,
    applicationVersion: doc.applicationVersion,
    employeeNo: doc.employeeNo,
    room: doc.room || null,
    lease: doc.lease || null,
  };
}

function taskPublicView(task) {
  if (!task) {
    return {
      taskId: '', status: STATUS.NOT_FOUND, state: DISPLAY_STATE.NOT_FOUND,
      cloudPath: '', room: null, lease: null, employeeNo: '',
      siteVerification: 'PENDING', deviceOutcome: null,
    };
  }
  return {
    taskId: task._id,
    status: task.status,
    state: DISPLAY_STATE[task.status] || '结果待核查',
    room: task.room || null,
    lease: task.lease || null,
    employeeNo: task.employeeNo || '',
    cloudPath: task.cloudPath || '',
    siteVerification: 'PENDING',
    deviceOutcome: task.deviceOutcome || null,
  };
}

function workerTaskView(task, patch, claimId, claimExpiresAt) {
  return {
    taskId: task._id,
    applicationId: task.applicationId,
    name: task.name || '',
    employeeNo: task.employeeNo,
    fileId: task.fileId,
    cloudPath: task.cloudPath,
    doorNo: task.doorNo,
    deviceKey: task.deviceKey || '',
    validFrom: task.validFrom,
    validTo: task.validTo,
    timezone: task.timezone,
    dailyHours: task.dailyHours,
    accessPlanFingerprint: task.accessPlanFingerprint || '',
    claimId,
    claimExpiresAt,
    revision: patch.revision,
  };
}

/**
 * Authoritative task snapshot returned by beginTaskExecution. It carries the
 * advanced revision and the ORIGINAL claimExpiresAt (never extended), plus
 * every business field the worker must re-verify against its claim/download,
 * and the config/room/lease association revisions that were re-checked.
 */
function authoritativeExecutionSnapshot(task, authorizedAt) {
  return {
    taskId: task._id,
    applicationId: task.applicationId,
    name: task.name || '',
    employeeNo: task.employeeNo,
    fileId: task.fileId,
    cloudPath: task.cloudPath,
    doorNo: task.doorNo,
    deviceKey: task.deviceKey || '',
    validFrom: task.validFrom,
    validTo: task.validTo,
    timezone: task.timezone,
    dailyHours: task.dailyHours,
    accessPlanFingerprint: task.accessPlanFingerprint || '',
    claimId: task.claimId,
    claimExpiresAt: task.claimExpiresAt || 0,
    status: task.status,
    revision: task.revision,
    configRevision: task.configRevision,
    roomRevision: task.roomRevision,
    leaseRevision: task.leaseRevision,
    roomBindingId: task.roomBindingId,
    leaseSnapshotId: task.leaseSnapshotId,
    workerId: task.workerId || '',
    authorizedAt,
  };
}

/**
 * Workflow service. All dependencies are injected so the same implementation
 * runs in the cloud function and in mocked tests.
 */
class CheckinFaceWorkflow {
  constructor({ db, cloud = null, environment = 'checkin-face-test', now = () => new Date() } = {}) {
    this.store = createStore(db, { environment, now });
    this.cloud = cloud;
    this.environment = environment;
    this.now = now;
    this.time = () => {
      const value = now();
      if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
      return Number.isFinite(Number(value)) ? Number(value) : 0;
    };
  }

  /** Read-only configuration display for the mini-program page. */
  async getConfig(openid) {
    const config = await configGate.loadConfig(this.store);
    const allowlist = await configGate.loadAllowlistEntry(this.store, openid);
    let room = null;
    try { room = await configGate.loadRoomBinding(this.store); }
    catch (issue) { if (issue.code !== 'ROOM_NOT_UNIQUE') throw issue; }
    const lease = await configGate.loadLease(this.store);
    const roomData = configGate.roomView(room) || {
      displayNo: '102', roomId: '', houseId: '', projectId: '', buildingId: '',
      projectName: '', buildingName: '',
    };
    const leaseData = configGate.leaseView(lease) || {
      status: '', startDate: '', endDate: '', validFrom: '', validTo: '',
      timezone: dates.TIMEZONE, dailyHours: dates.DAILY_HOURS,
    };
    const configured = !!room && !!lease && lease.status === 'active' && dates.isValidWindowSnapshot(lease);
    return {
      enabled: config.enabled === true,
      configured,
      accountEligible: !!allowlist && allowlist.status === 'active',
      room: roomData,
      lease: leaseData,
      applicationVersion: config.applicationVersion || '',
      storageNamespaceConfigured: typeof config.storageNamespace === 'string'
        && validate.STORAGE_NAMESPACE_PATTERN.test(config.storageNamespace),
      phase: !configured ? '待配置' : (!allowlist || allowlist.status !== 'active' ? '不在测试名单' : '可申请'),
    };
  }

  /** Idempotent automatic approval for allowlisted test accounts only. */
  async applyCheckin(openid, input = {}) {
    const applicationVersion = validate.validateApplicationVersion(input.applicationVersion);
    // Non-transactional preflight with full collection queries (102 uniqueness,
    // concurrent application scan). Any failure closes with zero writes.
    const preflight = await configGate.evaluateApply({
      store: this.store, openid, applicationVersion, now: this.now(), inTransaction: false,
    });
    if (!preflight.ok) {
      // A normal account keeps the existing offline/manual review route and
      // is never written into the test collections.
      if (preflight.code === 'ACCOUNT_NOT_ALLOWED') {
        return { applicationId: '', result: 'pending_review', reason: '请走既有审核流程', idempotent: false };
      }
      error(preflight.code, preflight.reason);
    }
    return this.store.withTransaction(async (tx) => {
      // Authoritative re-read: config/allowlist/room/lease point reads inside
      // the transaction; the write and audit share the same atomic boundary.
      const gate = await configGate.evaluateApply({
        store: tx, openid, applicationVersion, now: this.now(), inTransaction: true,
      });
      if (!gate.ok) error(gate.code, gate.reason);
      const applicationId = ids.applicationId(
        this.environment, openid, applicationVersion, gate.lease.revision, gate.room.revision,
      );
      const existing = await tx.get(COLLECTIONS.APPLICATION, applicationId);
      if (existing) {
        if (existing.openid !== openid || existing.applicationVersion !== applicationVersion
          || existing.leaseRevision !== gate.lease.revision || existing.roomRevision !== gate.room.revision) {
          error('APPLICATION_CONFLICT', '申请快照与当前配置冲突');
        }
        return { ...applicationView(existing), idempotent: true };
      }
      const employeeNo = `F${sha256Hex(`employee|${this.environment}|${openid}|${applicationId}`).slice(0, 16).toUpperCase()}`;
      const doc = {
        _id: applicationId,
        openid,
        applicationVersion,
        result: 'auto_approved',
        employeeNo,
        roomBindingId: gate.room._id,
        leaseSnapshotId: gate.lease._id,
        leaseRevision: gate.lease.revision,
        roomRevision: gate.room.revision,
        name: gate.allowlist.displayLabel || '测试用户',
        room: gate.roomView,
        lease: gate.leaseView,
        decisionReasons: ['allowlist_active', 'room_102_unique', 'lease_active', 'version_match'],
        createdAt: this.time(),
        revision: 1,
      };
      await tx.setById(COLLECTIONS.APPLICATION, applicationId, doc);
      await tx.writeAudit({
        action: 'applyCheckin', operator: openid, targetId: applicationId,
        before: null, after: { result: doc.result, applicationVersion, employeeNo: doc.employeeNo },
        revision: doc.revision, reason: 'auto_approved',
      });
      return { ...applicationView(doc), idempotent: false };
    });
  }

  /** Create or refresh a face task; the employeeNo is never changed. */
  async createFaceTask(openid, input = {}) {
    const applicationId = validate.validateApplicationId(input.applicationId);
    validate.validateConsent(input.consent);
    const config = await configGate.loadConfig(this.store);
    const ownership = validate.validateFileOwnership(input.fileId, {
      environment: this.environment, openid, applicationId,
      storageNamespace: config.storageNamespace,
    });
    const application = await this.store.get(COLLECTIONS.APPLICATION, applicationId);
    if (!application || application.openid !== openid || application.result !== 'auto_approved') {
      error('APPLICATION_NOT_APPROVED', '未找到本人已通过的测试申请');
    }
    const preflight = await configGate.evaluateApply({
      store: this.store, openid, applicationVersion: application.applicationVersion, now: this.now(),
      inTransaction: false,
    });
    if (!preflight.ok) error(preflight.code, preflight.reason);
    await checkPhoto(this.cloud, ownership.fileId);

    const taskId = ids.taskId(this.environment, applicationId);
    return this.store.withTransaction(async (tx) => {
      const applicationTx = await tx.get(COLLECTIONS.APPLICATION, applicationId);
      if (!applicationTx || applicationTx.openid !== openid || applicationTx.result !== 'auto_approved') {
        error('APPLICATION_NOT_APPROVED', '未找到本人已通过的测试申请');
      }
      const gate = await configGate.evaluateApply({
        store: tx, openid, applicationVersion: applicationTx.applicationVersion, now: this.now(),
        inTransaction: true,
      });
      if (!gate.ok) error(gate.code, gate.reason);

      // The asynchronous photo check may overlap an administrator changing
      // the trusted namespace. Rebind the SAME fileID to the authoritative
      // transaction snapshot; a fresh config revision alone is not proof.
      validate.validateFileOwnership(ownership.fileId, {
        environment: this.environment, openid, applicationId,
        storageNamespace: gate.config.storageNamespace,
      });

      const existing = await tx.get(COLLECTIONS.TASK, taskId);
      if (existing) {
        if (existing.openid !== openid) error('TASK_FORBIDDEN', '任务不属于本人');
        if (TERMINAL_STATUSES.includes(existing.status)) error('TASK_ALREADY_CLAIMED', '任务已派发或已结束，不再重发');
        if (existing.status === STATUS.CLAIMED || existing.status === STATUS.DEVICE_PROCESSING) {
          error('TASK_ALREADY_CLAIMED', '任务已派发，不能重复提交');
        }
        if (existing.fileId !== ownership.fileId) {
          const ok = await tx.updateIfRevision(COLLECTIONS.TASK, taskId, existing.revision, {
            fileId: ownership.fileId, cloudPath: ownership.cloudPath, photoUpdatedAt: this.time(),
          });
          if (!ok) error('REVISION_CONFLICT', '任务已被更新，请重试');
          await tx.writeAudit({
            action: 'replaceFacePhoto', operator: openid, targetId: taskId,
            before: null, after: { taskId, cloudPath: ownership.cloudPath }, revision: existing.revision + 1,
            reason: '重传照片，人员编号保持不变',
          });
        }
        const updated = await tx.get(COLLECTIONS.TASK, taskId);
        return { taskId, status: updated.status, room: updated.room, lease: updated.lease, cloudPath: updated.cloudPath };
      }

      // First creation is create-only inside the transaction: point-read
      // absent, then write, in the same atomic boundary. A concurrent
      // creator/claimer conflicts at commit, the transaction retries and the
      // retry takes the existing-task branch above — never resetting a claim,
      // a terminal state, a revision or the employeeNo.
      const createdAt = this.time();
      const task = {
        _id: taskId,
        openid,
        applicationId,
        name: applicationTx.name || '测试用户',
        roomBindingId: gate.room._id,
        leaseSnapshotId: gate.lease._id,
        leaseRevision: gate.lease.revision,
        roomRevision: gate.room.revision,
        configRevision: gate.config.revision,
        employeeNo: applicationTx.employeeNo,
        fileId: ownership.fileId,
        cloudPath: ownership.cloudPath,
        doorNo: gate.room.doorNo,
        deviceKey: gate.room.deviceKey || '',
        validFrom: gate.lease.validFrom,
        validTo: gate.lease.validTo,
        timezone: dates.TIMEZONE,
        dailyHours: dates.DAILY_HOURS,
        accessPlanFingerprint: gate.room.accessPlanFingerprint || gate.lease.accessPlanFingerprint || '',
        status: STATUS.QUEUED_FOR_DISPATCH,
        claimId: '',
        claimExpiresAt: 0,
        revision: 1,
        siteVerification: 'PENDING',
        deviceOutcome: null,
        room: gate.roomView,
        lease: gate.leaseView,
        createdAt,
      };
      await tx.setById(COLLECTIONS.TASK, taskId, task);
      await tx.writeAudit({
        action: 'createFaceTask', operator: openid, targetId: taskId,
        before: null, after: { taskId, status: task.status, employeeNo: task.employeeNo },
        revision: task.revision, reason: '照片收件并排队',
      });
      return { taskId, status: task.status, room: task.room, lease: task.lease, cloudPath: task.cloudPath };
    });
  }

  /** Read-only polling view; no writes and no automatic resend. */
  async getMyTask(openid, input = {}) {
    const applicationId = validate.validateApplicationId(input.applicationId);
    const application = await this.store.get(COLLECTIONS.APPLICATION, applicationId);
    if (!application || application.openid !== openid) error('APPLICATION_FORBIDDEN', '未找到本人申请');
    const task = await this.store.get(COLLECTIONS.TASK, ids.taskId(this.environment, applicationId));
    const view = taskPublicView(task);
    // Terminal facts remain readable; they never authorize a new upload.
    view.uploadEligible = false;
    if (task && TERMINAL_STATUSES.includes(task.status)) return view;
    if (application.result !== 'auto_approved') error('APPLICATION_NOT_APPROVED', '申请当前未通过');
    const gate = await configGate.evaluateApply({
      store: this.store, openid, applicationVersion: application.applicationVersion, now: this.now(),
    });
    if (!gate.ok) {
      error(gate.code === 'ACCOUNT_NOT_ALLOWED' ? 'ACCOUNT_NOT_ALLOWED' : 'APPLICATION_NOT_APPROVED', '申请当前不具备上传资格');
    }
    if (application.roomRevision !== gate.room.revision || application.leaseRevision !== gate.lease.revision) {
      error('APPLICATION_NOT_APPROVED', '申请关联快照已变化');
    }
    view.uploadEligible = !task || task.status === STATUS.QUEUED_FOR_DISPATCH;
    if (!task) {
      view.cloudPath = `test-face/${this.environment}/${openid}/${applicationId}/photo.jpg`;
      view.room = application.room || null;
      view.lease = application.lease || null;
    }
    return view;
  }

  /** Worker-only claim with a fresh revalidation and CAS QUEUED -> CLAIMED. */
  async claimTask(workerId = '') {
    validate.validateWorkerId(workerId);
    const config = await configGate.loadConfig(this.store);
    if (config.enabled !== true || config.dispatchEnabled !== true) {
      error('DISPATCH_DISABLED', '派发当前未启用');
    }
    const timestamp = this.time();

    // Timeout sweep: each stale candidate (CLAIMED, or DEVICE_PROCESSING
    // whose begin receipt was lost) is re-read inside a transaction and only
    // advanced when the re-read still matches; transition and audit share the
    // same atomic boundary.
    for (const staleStatus of [STATUS.CLAIMED, STATUS.DEVICE_PROCESSING]) {
      const staleList = await this.store.list(COLLECTIONS.TASK, {
        environment: this.environment, status: staleStatus,
      });
      for (const stale of staleList) {
        if (Number(stale.claimExpiresAt || 0) > timestamp) continue;
        await this.store.withTransaction(async (tx) => {
          const current = await tx.get(COLLECTIONS.TASK, stale._id);
          if (!current || current.status !== staleStatus || current.revision !== stale.revision) return;
          if (Number(current.claimExpiresAt || 0) > timestamp) return;
          await tx.setById(COLLECTIONS.TASK, current._id, {
            ...current,
            status: STATUS.UNKNOWN_RESULT,
            resultCode: 'CLAIM_TIMEOUT',
            claimedAt: current.claimExpiresAt || 0,
            revision: current.revision + 1,
          });
          await tx.writeAudit({
            action: 'claimTimeout', operator: workerId || 'worker', targetId: current._id,
            before: { status: staleStatus, revision: current.revision },
            after: { status: STATUS.UNKNOWN_RESULT, revision: current.revision + 1 },
            revision: current.revision + 1,
            reason: '领取超时，保留人员编号与残留事实，不自动重发',
          });
        });
      }
    }

    const queued = await this.store.list(COLLECTIONS.TASK, {
      environment: this.environment, status: STATUS.QUEUED_FOR_DISPATCH,
    });
    queued.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (const candidate of queued.slice(0, 10)) {
      const outcome = await this.store.withTransaction(async (tx) => {
        const current = await tx.get(COLLECTIONS.TASK, candidate._id);
        if (!current || current.status !== STATUS.QUEUED_FOR_DISPATCH || current.revision !== candidate.revision) {
          return { claimed: null };
        }
        const gate = await configGate.evaluateDispatch({
          store: tx, task: current, now: this.now(), inTransaction: true,
        });
        if (!gate.ok) {
          await tx.setById(COLLECTIONS.TASK, current._id, {
            ...current, status: STATUS.INVALIDATED, resultCode: gate.code, revision: current.revision + 1,
          });
          await tx.writeAudit({
            action: 'invalidateTask', operator: 'server', targetId: current._id,
            before: { status: current.status, revision: current.revision },
            after: { status: STATUS.INVALIDATED, revision: current.revision + 1 },
            revision: current.revision + 1, reason: gate.reason,
          });
          return { claimed: null };
        }
        const claimId = randomUUID();
        const claimExpiresAt = timestamp + CLAIM_TTL_MS;
        const patch = {
          status: STATUS.CLAIMED, claimId, claimExpiresAt, workerId,
          claimedAt: timestamp, revision: current.revision + 1,
        };
        await tx.setById(COLLECTIONS.TASK, current._id, { ...current, ...patch });
        await tx.writeAudit({
          action: 'claimTask', operator: workerId || 'worker', targetId: current._id,
          before: { status: current.status, revision: current.revision },
          after: { status: STATUS.CLAIMED, claimId, workerId, revision: patch.revision },
          revision: patch.revision, reason: '领取任务，等待执行前复核',
        });
        return { claimed: { task: workerTaskView(current, patch, claimId, claimExpiresAt) } };
      });
      if (outcome.claimed) return outcome.claimed;
    }
    return { task: null };
  }

  /**
   * Fresh pre-execution revalidation (R06 server side). Runs in a real
   * transaction: claim identity, worker identity, revision, expiry and every
   * authoritative gate are re-read from current state, then CLAIMED advances
   * to DEVICE_PROCESSING with revision exactly +1. The claim is never
   * extended, the lease is never touched and no new business target can be
   * supplied by the client.
   */
  async beginTaskExecution(workerId = '', input = {}) {
    const req = validate.validateBeginTaskExecutionInput(input);
    const outcome = await this.store.withTransaction(async (tx) => {
      const task = await tx.get(COLLECTIONS.TASK, req.taskId);
      if (!task) error('TASK_NOT_FOUND', '任务不存在');
      if (task.claimId !== req.claimId) error('CLAIM_MISMATCH', '领取标识不匹配');
      if (task.revision !== req.revision) error('REVISION_CONFLICT', '任务版本不匹配');
      if (task.status !== STATUS.CLAIMED) {
        if (task.status === STATUS.DEVICE_PROCESSING) {
          error('EXECUTION_ALREADY_STARTED', '任务已进入设备执行，不重复授权');
        }
        error('TASK_NOT_CLAIMED', '任务当前不在待执行状态');
      }
      if (!task.workerId || task.workerId !== workerId || req.workerId !== workerId) {
        error('WORKER_MISMATCH', 'worker 与领取者不一致');
      }
      const authorizedAt = this.time();
      if (Number(task.claimExpiresAt || 0) <= authorizedAt) {
        // The original claim expired: keep the unknown/possible device facts,
        // advance UNKNOWN_RESULT atomically, and refuse without extending.
        const next = {
          ...task, status: STATUS.UNKNOWN_RESULT, resultCode: 'CLAIM_TIMEOUT', revision: task.revision + 1,
        };
        await tx.setById(COLLECTIONS.TASK, req.taskId, next);
        await tx.writeAudit({
          action: 'beginTaskExecutionRejected', operator: workerId || 'worker', targetId: req.taskId,
          before: { status: task.status, revision: task.revision, claimId: task.claimId },
          after: { status: next.status, resultCode: 'CLAIM_TIMEOUT', revision: next.revision },
          revision: next.revision, reason: '执行前复核：领取已过期，不授权设备执行',
        });
        return { kind: 'reject', code: 'CLAIM_EXPIRED', message: '领取已过期，未授权设备执行' };
      }
      const gate = await configGate.evaluateDispatch({
        store: tx, task, now: this.now(), inTransaction: true,
      });
      if (!gate.ok) {
        const next = {
          ...task, status: STATUS.INVALIDATED, resultCode: gate.code, revision: task.revision + 1,
        };
        await tx.setById(COLLECTIONS.TASK, req.taskId, next);
        await tx.writeAudit({
          action: 'beginTaskExecutionRejected', operator: workerId || 'worker', targetId: req.taskId,
          before: { status: task.status, revision: task.revision, claimId: task.claimId },
          after: { status: next.status, resultCode: gate.code, revision: next.revision },
          revision: next.revision, reason: `执行前复核不通过：${gate.reason}`,
        });
        return { kind: 'reject', code: 'EXECUTION_INVALIDATED', message: '执行前复核不通过，未授权设备执行' };
      }
      const next = {
        ...task, status: STATUS.DEVICE_PROCESSING, revision: task.revision + 1,
      };
      await tx.setById(COLLECTIONS.TASK, req.taskId, next);
      await tx.writeAudit({
        action: 'beginTaskExecution', operator: workerId || 'worker', targetId: req.taskId,
        before: { status: task.status, revision: task.revision, claimId: task.claimId },
        after: { status: next.status, revision: next.revision },
        revision: next.revision, reason: '执行前复核通过，进入设备执行',
      });
      return { kind: 'ok', task: authoritativeExecutionSnapshot(next, authorizedAt), authorizedAt };
    });
    if (outcome.kind === 'reject') error(outcome.code, outcome.message);
    return { task: outcome.task, authorizedAt: outcome.authorizedAt };
  }

  /** Worker-only report with strict output comparison and CAS. */
  async reportTask(input = {}) {
    const report = validate.validateReportInput(input);
    const task = await this.store.get(COLLECTIONS.TASK, report.taskId);
    if (!task) error('TASK_NOT_FOUND', '任务不存在');
    if (task.claimId !== report.claimId) error('CLAIM_MISMATCH', '领取标识不匹配');

    const facts = validate.sanitizeOutputFacts(report.output);
    const fingerprint = sha256Hex(JSON.stringify({ exitCode: report.exitCode, output: canonicalReportValue(report.output) }));
    return this.store.withTransaction(async (tx) => {
      const current = await tx.get(COLLECTIONS.TASK, report.taskId);
      if (!current) error('TASK_NOT_FOUND', '任务不存在');
      if (current.claimId !== report.claimId) error('CLAIM_MISMATCH', '领取标识不匹配');
      if (TERMINAL_STATUSES.includes(current.status)) {
        if (current.lastReportFingerprint === fingerprint && current.lastReportRevision === report.revision) {
          return { taskId: current._id, status: current.status, idempotent: true };
        }
        error('REPORT_CONFLICT', '任务已有终态，不能覆盖原结果');
      }
      if (current.revision !== report.revision) error('REVISION_CONFLICT', '任务版本不匹配');
      if (current.status !== STATUS.DEVICE_PROCESSING) {
        // Downloads and local prechecks may fail before begin. Only their
        // closed failure shapes may consume CLAIMED; no claimed-only report
        // can assert device success or carry confirmed enrollment facts.
        const preExecutionFailure = current.status === STATUS.CLAIMED
          && ((report.exitCode === 2 && report.output.outcome === 'invalid-input')
            || (report.exitCode === 5 && report.output.outcome === 'stopped'))
          && report.output.mode === 'device' && report.output.validityMode === 'fixed'
          && (report.output.enrollment === undefined || report.output.enrollment === null)
          && facts.faceAssociationConfirmed !== true && facts.faceModelingVerified !== true;
        if (!preExecutionFailure) error('TASK_NOT_EXECUTING', '尚未取得设备执行授权，不能上报设备结果');
      }

      let status;
      let resultCode;
      if (Number(current.claimExpiresAt || 0) <= this.time()) {
        status = STATUS.UNKNOWN_RESULT;
        resultCode = 'CLAIM_TIMEOUT';
      } else {
        const gate = await configGate.evaluateDispatch({
          store: tx, task: current, now: this.now(), inTransaction: true,
        });
        if (!gate.ok) {
          status = STATUS.INVALIDATED;
          resultCode = gate.code;
        } else if (report.exitCode === 0) {
          const verified = validate.verifyDeviceOutput(report.output, {
            employeeNo: current.employeeNo,
            doorNo: current.doorNo,
            validFrom: current.validFrom,
            validTo: current.validTo,
            accessPlanFingerprint: current.accessPlanFingerprint,
            dailyHours: current.dailyHours,
          });
          if (!verified.verified) {
            status = STATUS.FAILED_REVIEW;
            resultCode = verified.code;
          } else {
            status = STATUS.PENDING_SITE_VERIFICATION;
            resultCode = 'DEVICE_CONFIRMED';
          }
        } else {
          resultCode = report.exitCode === 5 ? 'DEVICE_STATE_UNCERTAIN' : 'DEVICE_RESULT_FAILED';
          status = report.exitCode === 5 || report.exitCode > 5 ? STATUS.UNKNOWN_RESULT : STATUS.FAILED_REVIEW;
        }
      }

      const patch = {
        status,
        resultCode,
        deviceOutcome: {
          exitCode: report.exitCode,
          code: resultCode,
          outcome: typeof facts.outcome === 'string' ? facts.outcome : '',
          errorCode: facts.errorCode || '',
          reportedAt: this.time(),
        },
        outputFingerprint: fingerprint,
        lastReportFingerprint: fingerprint,
        lastReportRevision: report.revision,
        siteVerification: 'PENDING',
        faceModelingVerified: status === STATUS.PENDING_SITE_VERIFICATION && facts.faceModelingVerified === true,
        reportedAt: this.time(),
      };
      if (status === STATUS.PENDING_SITE_VERIFICATION) {
        patch.deviceConfirmedAt = this.time();
        patch.statusBeforeSiteVerification = STATUS.DEVICE_CONFIRMED;
      }
      await tx.setById(COLLECTIONS.TASK, current._id, { ...current, ...patch, revision: current.revision + 1 });
      await tx.writeAudit({
        action: 'reportTask', operator: report.claimId, targetId: current._id,
        before: { status: current.status, revision: report.revision },
        after: { status, resultCode, employeeNo: current.employeeNo },
        revision: report.revision + 1,
        reason: status === STATUS.PENDING_SITE_VERIFICATION ? '设备查询已确认，仍待本人现场刷脸' : resultCode,
      });
      return { taskId: current._id, status, idempotent: false };
    });
  }
}

module.exports = {
  STATUS,
  DISPLAY_STATE,
  TERMINAL_STATUSES,
  CLAIM_TTL_MS,
  PHOTO_LIMIT_BYTES,
  applicationView,
  taskPublicView,
  workerTaskView,
  authoritativeExecutionSnapshot,
  checkPhoto,
  CheckinFaceWorkflow,
};
