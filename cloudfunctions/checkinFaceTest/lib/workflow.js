'use strict';

/**
 * State machine, idempotency and dispatch for the isolated test path.
 *
 * PHOTO_RECEIVED -> QUEUED_FOR_DISPATCH -> CLAIMED -> DEVICE_PROCESSING
 *   -> DEVICE_CONFIRMED -> PENDING_SITE_VERIFICATION
 * Exit branches: FAILED_REVIEW / UNKNOWN_RESULT / INVALIDATED. There is no
 * requeue action and no automatic resend; employeeNo is never rotated.
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
      phase: !configured ? '待配置' : (!allowlist || allowlist.status !== 'active' ? '不在测试名单' : '可申请'),
    };
  }

  /** Idempotent automatic approval for allowlisted test accounts only. */
  async applyCheckin(openid, input = {}) {
    const applicationVersion = validate.validateApplicationVersion(input.applicationVersion);
    return this.store.withTransaction(async (tx) => {
      const gate = await configGate.evaluateApply({
        store: tx, openid, applicationVersion, now: this.now(),
      });
      if (!gate.ok) {
        // A normal account keeps the existing offline/manual review route and
        // is never written into the test collections.
        if (gate.code === 'ACCOUNT_NOT_ALLOWED') {
          return { applicationId: '', result: 'pending_review', reason: '请走既有审核流程', idempotent: false };
        }
        error(gate.code, gate.reason);
      }
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
    const ownership = validate.validateFileOwnership(input.fileId, {
      environment: this.environment, openid, applicationId,
    });
    const application = await this.store.get(COLLECTIONS.APPLICATION, applicationId);
    if (!application || application.openid !== openid || application.result !== 'auto_approved') {
      error('APPLICATION_NOT_APPROVED', '未找到本人已通过的测试申请');
    }
    const gate = await configGate.evaluateApply({
      store: this.store, openid, applicationVersion: application.applicationVersion, now: this.now(),
    });
    if (!gate.ok) error(gate.code, gate.reason);
    await checkPhoto(this.cloud, ownership.fileId);

    const taskId = ids.taskId(this.environment, applicationId);
    const existing = await this.store.get(COLLECTIONS.TASK, taskId);
    if (existing) {
      if (existing.openid !== openid) error('TASK_FORBIDDEN', '任务不属于本人');
      if (TERMINAL_STATUSES.includes(existing.status)) error('TASK_ALREADY_CLAIMED', '任务已派发或已结束，不再重发');
      if (existing.status === STATUS.CLAIMED || existing.status === STATUS.DEVICE_PROCESSING) {
        error('TASK_ALREADY_CLAIMED', '任务已派发，不能重复提交');
      }
      if (existing.fileId !== ownership.fileId) {
        const ok = await this.store.updateIfRevision(COLLECTIONS.TASK, taskId, existing.revision, {
          fileId: ownership.fileId, cloudPath: ownership.cloudPath, photoUpdatedAt: this.time(),
        });
        if (!ok) error('REVISION_CONFLICT', '任务已被更新，请重试');
        await this.store.writeAudit({
          action: 'replaceFacePhoto', operator: openid, targetId: taskId,
          before: null, after: { taskId, cloudPath: ownership.cloudPath }, revision: existing.revision + 1,
          reason: '重传照片，人员编号保持不变',
        });
      }
      const updated = await this.store.get(COLLECTIONS.TASK, taskId);
      return { taskId, status: updated.status, room: updated.room, lease: updated.lease, cloudPath: updated.cloudPath };
    }

    const createdAt = this.time();
    const task = {
      _id: taskId,
      openid,
      applicationId,
      name: application.name || '测试用户',
      roomBindingId: gate.room._id,
      leaseSnapshotId: gate.lease._id,
      leaseRevision: gate.lease.revision,
      roomRevision: gate.room.revision,
      configRevision: gate.config.revision,
      employeeNo: application.employeeNo,
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
    await this.store.setById(COLLECTIONS.TASK, taskId, task);
    await this.store.writeAudit({
      action: 'createFaceTask', operator: openid, targetId: taskId,
      before: null, after: { taskId, status: task.status, employeeNo: task.employeeNo },
      revision: task.revision, reason: '照片收件并排队',
    });
    return { taskId, status: task.status, room: task.room, lease: task.lease, cloudPath: task.cloudPath };
  }

  /** Read-only polling view; no writes and no automatic resend. */
  async getMyTask(openid, input = {}) {
    const applicationId = validate.validateApplicationId(input.applicationId);
    const application = await this.store.get(COLLECTIONS.APPLICATION, applicationId);
    if (!application || application.openid !== openid) error('APPLICATION_FORBIDDEN', '未找到本人申请');
    const task = await this.store.get(COLLECTIONS.TASK, ids.taskId(this.environment, applicationId));
    const view = taskPublicView(task);
    if (!task) {
      view.cloudPath = `test-face/${this.environment}/${openid}/${applicationId}/photo.jpg`;
      view.room = application.room || null;
      view.lease = application.lease || null;
    }
    return view;
  }

  /** Worker-only claim with a fresh revalidation and CAS QUEUED -> CLAIMED. */
  async claimTask(workerId = '') {
    const config = await configGate.loadConfig(this.store);
    if (config.enabled !== true || config.dispatchEnabled !== true) {
      error('DISPATCH_DISABLED', '派发当前未启用');
    }
    const timestamp = this.time();
    const claimed = await this.store.list(COLLECTIONS.TASK, { environment: this.environment, status: STATUS.CLAIMED });
    for (const stale of claimed) {
      if (Number(stale.claimExpiresAt || 0) > timestamp) continue;
      const ok = await this.store.updateIfRevision(COLLECTIONS.TASK, stale._id, stale.revision, {
        status: STATUS.UNKNOWN_RESULT, resultCode: 'CLAIM_TIMEOUT', claimedAt: stale.claimExpiresAt || 0,
      });
      if (ok) {
        await this.store.writeAudit({
          action: 'claimTimeout', operator: workerId || 'worker', targetId: stale._id,
          before: { status: STATUS.CLAIMED }, after: { status: STATUS.UNKNOWN_RESULT },
          revision: stale.revision + 1, reason: '领取超时，保留人员编号与残留事实，不自动重发',
        });
      }
    }

    const queued = await this.store.list(COLLECTIONS.TASK, {
      environment: this.environment, status: STATUS.QUEUED_FOR_DISPATCH,
    });
    queued.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (const task of queued.slice(0, 10)) {
      const gate = await configGate.evaluateDispatch({ store: this.store, task, now: this.now() });
      if (!gate.ok) {
        const ok = await this.store.updateIfRevision(COLLECTIONS.TASK, task._id, task.revision, {
          status: STATUS.INVALIDATED, resultCode: gate.code,
        });
        if (ok) {
          await this.store.writeAudit({
            action: 'invalidateTask', operator: 'server', targetId: task._id,
            before: { status: task.status }, after: { status: STATUS.INVALIDATED },
            revision: task.revision + 1, reason: gate.reason,
          });
        }
        continue;
      }
      const claimId = randomUUID();
      const claimExpiresAt = timestamp + CLAIM_TTL_MS;
      const patch = {
        status: STATUS.CLAIMED, claimId, claimExpiresAt, workerId,
        claimedAt: timestamp, revision: task.revision + 1,
      };
      const ok = await this.store.updateIfRevision(COLLECTIONS.TASK, task._id, task.revision, patch);
      if (!ok) continue;
      return { task: workerTaskView(task, patch, claimId, claimExpiresAt) };
    }
    return { task: null };
  }

  /** Worker-only report with strict output comparison and CAS. */
  async reportTask(input = {}) {
    const report = validate.validateReportInput(input);
    const task = await this.store.get(COLLECTIONS.TASK, report.taskId);
    if (!task) error('TASK_NOT_FOUND', '任务不存在');
    if (task.claimId !== report.claimId) error('CLAIM_MISMATCH', '领取标识不匹配');

    const facts = validate.sanitizeOutputFacts(report.output);
    const fingerprint = sha256Hex(JSON.stringify({ exitCode: report.exitCode, facts }));
    if (TERMINAL_STATUSES.includes(task.status) && task.lastReportFingerprint === fingerprint) {
      return { taskId: task._id, status: task.status, idempotent: true };
    }
    if (task.revision !== report.revision) error('REVISION_CONFLICT', '任务版本不匹配');
    if (Number(task.claimExpiresAt || 0) < this.time()) {
      return this.#finishReport(task, report, fingerprint, STATUS.UNKNOWN_RESULT, 'CLAIM_TIMEOUT', facts);
    }
    const gate = await configGate.evaluateDispatch({ store: this.store, task, now: this.now() });
    if (!gate.ok) return this.#finishReport(task, report, fingerprint, STATUS.INVALIDATED, gate.code, facts);

    if (report.exitCode === 0) {
      const verified = validate.verifyDeviceOutput(report.output, {
        employeeNo: task.employeeNo,
        doorNo: task.doorNo,
        validFrom: task.validFrom,
        validTo: task.validTo,
        accessPlanFingerprint: task.accessPlanFingerprint,
        dailyHours: task.dailyHours,
      });
      if (!verified.verified) {
        return this.#finishReport(task, report, fingerprint, STATUS.FAILED_REVIEW, verified.code, facts);
      }
      const patch = await this.#writeReport(task, report, fingerprint, STATUS.PENDING_SITE_VERIFICATION, 'DEVICE_CONFIRMED', facts);
      return { taskId: task._id, status: patch.status, idempotent: false };
    }
    const resultCode = report.exitCode === 5 ? 'DEVICE_STATE_UNCERTAIN' : 'DEVICE_RESULT_FAILED';
    const status = report.exitCode === 5 || report.exitCode > 5 ? STATUS.UNKNOWN_RESULT : STATUS.FAILED_REVIEW;
    return this.#finishReport(task, report, fingerprint, status, resultCode, facts);
  }

  async #finishReport(task, report, fingerprint, status, resultCode, facts) {
    const result = await this.#writeReport(task, report, fingerprint, status, resultCode, facts);
    return { taskId: task._id, status: result.status, idempotent: false };
  }

  async #writeReport(task, report, fingerprint, status, resultCode, facts) {
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
      siteVerification: 'PENDING',
      faceModelingVerified: status === STATUS.PENDING_SITE_VERIFICATION && facts.faceModelingVerified === true,
      reportedAt: this.time(),
    };
    if (status === STATUS.PENDING_SITE_VERIFICATION) {
      patch.deviceConfirmedAt = this.time();
      patch.statusBeforeSiteVerification = STATUS.DEVICE_CONFIRMED;
    }
    const ok = await this.store.updateIfRevision(COLLECTIONS.TASK, task._id, report.revision, patch);
    if (!ok) {
      const current = await this.store.get(COLLECTIONS.TASK, task._id);
      if (current && current.status === status && current.lastReportFingerprint === fingerprint) {
        return { status: current.status, idempotent: true };
      }
      error('REVISION_CONFLICT', '任务版本不匹配');
    }
    await this.store.writeAudit({
      action: 'reportTask', operator: report.claimId, targetId: task._id,
      before: { status: task.status, revision: report.revision },
      after: { status, resultCode, employeeNo: task.employeeNo },
      revision: report.revision + 1,
      reason: status === STATUS.PENDING_SITE_VERIFICATION ? '设备查询已确认，仍待本人现场刷脸' : resultCode,
    });
    return { status, idempotent: false };
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
  checkPhoto,
  CheckinFaceWorkflow,
};
