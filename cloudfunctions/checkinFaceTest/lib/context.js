'use strict';

/**
 * Caller identity for the test cloud function.
 *
 * Mini-program actions trust only cloud.getWXContext().OPENID. Worker actions
 * trust only a hashed, constant-time-compared worker token loaded from server
 * configuration. Neither channel can supply an identity claim in its payload.
 */

const { createHash, timingSafeEqual } = require('node:crypto');
const { ValidationError, validateToken } = require('./validate');

const MINIPROGRAM_ACTIONS = Object.freeze(['getConfig', 'applyCheckin', 'createFaceTask', 'getMyTask']);
const WORKER_ACTIONS = Object.freeze(['claimTask', 'beginTaskExecution', 'reportTask']);
const ALL_ACTIONS = Object.freeze([...MINIPROGRAM_ACTIONS, ...WORKER_ACTIONS]);

class ContextError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ContextError';
    this.code = code;
  }
}

/** @returns {string} lowercase SHA-256 hex digest. */
function sha256Hex(value) {
  if (typeof value !== 'string' || !value) throw new ContextError('INVALID_TOKEN', '凭据无效');
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests; never compares raw secrets. */
function constantTimeEqualHex(actualHex, expectedHex) {
  if (typeof actualHex !== 'string' || typeof expectedHex !== 'string') return false;
  if (!/^[a-f0-9]{64}$/i.test(actualHex) || !/^[a-f0-9]{64}$/i.test(expectedHex)) return false;
  const actual = Buffer.from(actualHex.toLowerCase(), 'hex');
  const expected = Buffer.from(expectedHex.toLowerCase(), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** @returns {'miniprogram'|'worker'|''} group for an action, '' when unknown. */
function actionGroup(action) {
  if (typeof action !== 'string') return '';
  if (MINIPROGRAM_ACTIONS.includes(action)) return 'miniprogram';
  if (WORKER_ACTIONS.includes(action)) return 'worker';
  return '';
}

/** @returns {string} openid from the trusted WeChat call context only. */
function getOpenId(cloud) {
  const context = cloud && typeof cloud.getWXContext === 'function' ? cloud.getWXContext() : null;
  const openid = context && context.OPENID;
  if (typeof openid !== 'string' || !openid || openid.length > 128) {
    throw new ContextError('OPENID_REQUIRED', '无法确认当前用户身份');
  }
  return openid;
}

/**
 * @returns {{kind:'worker',action:string,workerId:string,tokenDigest:string}}
 */
function authenticateWorker(event, expectedHash) {
  let token;
  try { token = validateToken(event && event.workerToken); }
  catch (error) { throw new ContextError('WORKER_UNAUTHORIZED', 'worker 凭据无效'); }
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
    throw new ContextError('WORKER_UNAUTHORIZED', 'worker 凭据未配置');
  }
  const tokenDigest = sha256Hex(token);
  if (!constantTimeEqualHex(tokenDigest, expectedHash)) {
    throw new ContextError('WORKER_UNAUTHORIZED', 'worker 凭据无效');
  }
  const workerId = typeof event.workerId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(event.workerId)
    ? event.workerId : '';
  return { kind: 'worker', action: event.action, workerId, tokenDigest };
}

/**
 * Resolve a validated event to a trusted identity.
 * @param {object} event already accepted by validate.validateEvent().
 * @param {{cloud:object,workerTokenHash:string}} deps
 */
function resolveIdentity(event, deps = {}) {
  if (!event || !ALL_ACTIONS.includes(event.action)) {
    throw new ContextError('UNKNOWN_ACTION', '不支持的操作');
  }
  if (actionGroup(event.action) === 'worker') return authenticateWorker(event, deps.workerTokenHash);
  const openid = getOpenId(deps.cloud);
  return { kind: 'miniprogram', action: event.action, openid };
}

module.exports = {
  MINIPROGRAM_ACTIONS,
  WORKER_ACTIONS,
  ALL_ACTIONS,
  ContextError,
  ValidationError,
  sha256Hex,
  constantTimeEqualHex,
  actionGroup,
  getOpenId,
  authenticateWorker,
  resolveIdentity,
};
