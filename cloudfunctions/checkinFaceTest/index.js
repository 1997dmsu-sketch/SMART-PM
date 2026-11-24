'use strict';

/**
 * Single entry point for the check-in / face-enrollment experience test.
 *
 * Responses follow the project convention {code, data, msg} with code 0 for
 * success. This function never logs request bodies, responses, file ids,
 * worker tokens or any device material.
 */

const context = require('./lib/context');
const validate = require('./lib/validate');
const { ENVIRONMENT, createStore } = require('./lib/store');
const configGate = require('./lib/config');
const { CheckinFaceWorkflow } = require('./lib/workflow');

const SAFE_ERRORS = new Set(['ValidationError', 'ContextError', 'WorkflowError']);

function normalizeCode(error) {
  if (error && typeof error.code === 'string' && /^[A-Z_]{3,64}$/.test(error.code)) return error.code;
  return 'INTERNAL_ERROR';
}

/**
 * Build a testable main handler.
 * @param {{cloud?:object,db?:object,environment?:string,now?:Function}} deps
 */
function createMain(deps = {}) {
  const environment = typeof deps.environment === 'string' && deps.environment ? deps.environment : ENVIRONMENT;
  const now = typeof deps.now === 'function' ? deps.now : () => new Date();
  let cachedCloud = deps.cloud || null;
  let cachedDb = deps.db || null;

  function getCloud() {
    if (cachedCloud) return cachedCloud;
    // Loaded lazily so mocked tests and syntax checks do not need the SDK.
    const sdk = require('wx-server-sdk');
    sdk.init({ env: sdk.DYNAMIC_CURRENT_ENV });
    cachedCloud = sdk;
    return cachedCloud;
  }

  function getDb() {
    if (cachedDb) return cachedDb;
    cachedDb = getCloud().database();
    return cachedDb;
  }

  return async function main(event = {}) {
    try {
      const group = context.actionGroup(event && event.action);
      if (!group) throw new validate.ValidationError('UNKNOWN_ACTION', '不支持的操作');
      validate.validateEvent(event, group);
      const cloud = getCloud();
      const db = getDb();
      const store = createStore(db, { environment, now });
      const config = await configGate.loadConfig(store);
      const identity = context.resolveIdentity(event, { cloud, workerTokenHash: config.workerTokenHash });
      const workflow = new CheckinFaceWorkflow({ db, cloud, environment, now });

      let data;
      switch (identity.action) {
        case 'getConfig':
          data = await workflow.getConfig(identity.openid);
          break;
        case 'applyCheckin':
          data = await workflow.applyCheckin(identity.openid, event);
          break;
        case 'createFaceTask':
          data = await workflow.createFaceTask(identity.openid, event);
          break;
        case 'getMyTask':
          data = await workflow.getMyTask(identity.openid, event);
          break;
        case 'claimTask':
          data = await workflow.claimTask(identity.workerId);
          break;
        case 'beginTaskExecution':
          data = await workflow.beginTaskExecution(identity.workerId, event);
          break;
        case 'reportTask':
          data = await workflow.reportTask(event);
          break;
        default:
          throw new validate.ValidationError('UNKNOWN_ACTION', '不支持的操作');
      }
      return { code: 0, data, msg: '' };
    } catch (error) {
      const code = normalizeCode(error);
      const message = error && SAFE_ERRORS.has(error.name) && typeof error.message === 'string'
        ? error.message.slice(0, 200)
        : '服务处理失败';
      return { code, data: null, msg: message };
    }
  };
}

exports.main = createMain();
exports.createMain = createMain;
