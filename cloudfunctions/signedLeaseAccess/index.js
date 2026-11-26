'use strict';
const { closedInput } = require('./lib/identity-core');
const { createService, SAFE_ERROR_CODES } = require('./lib/service');
const { types } = require('node:util');
const ADMIN = new Set(['configureProgram', 'setDoorBinding', 'setWorker', 'confirmSignedLease', 'revokeLease', 'resolveUnknown', 'getAdminRecord']);
const WORKER = new Set(['claimOpen', 'beginOpen', 'reportOpen']);
const TENANT = new Set(['listDoors', 'requestOpen', 'getOpenResult']);
const FIELDS = Object.freeze({
  configureProgram: ['expectedRevision', 'enabled', 'dispatchEnabled'],
  setDoorBinding: ['bindingId', 'expectedRevision', 'houseId', 'displayName', 'deviceKey', 'doorNo', 'expectedModel', 'enabled'],
  setWorker: ['workerId', 'expectedRevision', 'deviceKey', 'tokenHash', 'enabled'],
  confirmSignedLease: ['contractId', 'expectedRevision', 'userId', 'houseId', 'doorBindingId', 'startDate', 'endDate', 'signedEvidenceRef'],
  revokeLease: ['contractId', 'expectedRevision', 'reason'], resolveUnknown: ['taskId', 'expectedRevision', 'reason'],
  getAdminRecord: ['kind', 'id'],
  listDoors: [], requestOpen: ['contractId', 'requestId'], getOpenResult: ['taskId'],
  claimOpen: ['workerId', 'token'], beginOpen: ['workerId', 'token', 'taskId', 'claimId', 'revision'],
  reportOpen: ['workerId', 'token', 'taskId', 'claimId', 'revision', 'status', 'deviceStatusCode'],
});
function createMain({ cloud, db, now = Date.now } = {}) {
  let sdk = cloud;
  return async (event = {}) => {
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event) || types.isProxy(event)) return { code: 'INVALID_INPUT', status: 400, msg: 'INVALID_INPUT' };
      const descriptor = Object.getOwnPropertyDescriptor(event, 'action');
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string'
        || !Object.hasOwn(FIELDS, descriptor.value)) return { code: 'INVALID_INPUT', status: 400, msg: 'INVALID_INPUT' };
      const action = descriptor.value;
      const input = closedInput(event, ['action', ...FIELDS[action]]);
      delete input.action;
      if (!sdk) { sdk = require('wx-server-sdk'); sdk.init({ env: sdk.DYNAMIC_CURRENT_ENV }); }
      const service = createService({ db: db || sdk.database(), now });
      let data;
      if (WORKER.has(action)) data = await service[action](input);
      else if (ADMIN.has(action)) data = await service[action](await service.verifiedAdmin(sdk.getWXContext()), input);
      else data = await service[action](sdk.getWXContext(), input);
      return { code: 0, data };
    } catch (error) {
      const safe = error && SAFE_ERROR_CODES.includes(error.code);
      const code = safe ? error.code : 'SERVICE_UNAVAILABLE';
      return { code, status: safe && error.status || 503, msg: code };
    }
  };
}
exports.createMain = createMain;
exports.main = createMain();
